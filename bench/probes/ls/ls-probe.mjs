#!/usr/bin/env node
// ls-probe.mjs: drives the Angular Language Service (@angular/language-service) from a plain Node process, no editor,
// and prints what it knows about one input of one component: references, rename locations, diagnostics, quick info,
// refactorings, with timings and memory. Research probe for "should an agent get its facts from the language service?".
//
// How it works: an in-process ts.server.ProjectService (the object tsserver itself is built around) opens the project
// of <root>/tsconfig.json and loads @angular/language-service as a global tsserver plugin. Nothing is faked: the plugin
// gets a real ts.server.ConfiguredProject. Only the server host is ours: ts.sys plus timers, no-op file watchers and a
// `require` hook so the plugin resolves from this repository's node_modules.
//
// Run (from the repository root; <root> is a directory with a tsconfig.json and node_modules reachable from it):
//   node bench/probes/ls/ls-probe.mjs <root>                       summary for PillComponent.disableTooltip
//   node bench/probes/ls/ls-probe.mjs <root> --input Class.field   another input (falls back to the first declared one)
//   --strict-input-access   overlay "strictInputAccessModifiers": true on the tsconfig IN MEMORY (finding of this probe:
//                           without it the service resolves no template binding of a `readonly` input)
//   --no-strict-input-access   the opposite overlay: force it to false (for an application that already sets it)
//   --route manual          do not register the plugin with tsserver; call the plugin's create() by hand
//   --rename <newName> [--write]     list (and with --write apply to disk) the findRenameLocations edits
//   --rename-from-references         when the service refuses the rename (it returns nothing), build the edits from the
//                                    references instead: every distinct place whose text is the old name
//   --refactor <name> [--at Class.field] [--write]   compute (and apply) one Angular refactoring through applyRefactoring
//   --no-ng-facts           skip the cross-check against tool/ng-facts.mjs
//   --auto-imports          keep tsserver's auto-import provider program (default here: off; it costs seconds and ~100 MB)
//   --json <file>           also write the full result as JSON (with the full list of references and rename locations)
//   --project <tsconfig>    the project to load, relative to <root> (default tsconfig.json). tsserver has no public way to
//                           load a config with another name (tsconfig.app.json): for an opened file it looks for tsconfig.json
//                           above it, and openExternalProject accepts only tsconfig.json / jsconfig.json too. So any other
//                           name goes through the internal ProjectService.createConfiguredProject, and no file is opened
//   --modules <dir[,dir]>   take typescript and @angular/language-service from <dir>/node_modules (default: this repository);
//                           the first directory that has the package wins, e.g. --modules <app>,<scratch dir with the service>
//   --no-diagnostics        skip getSemanticDiagnostics on every file (minutes on a big application)
// It never writes inside <root> unless --write is given. Use --write only on a throw-away copy.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseTemplate, TmplAstRecursiveVisitor, tmplAstVisitAll } from "@angular/compiler";

const require = createRequire(import.meta.url);
const tStart = performance.now();
const REPO = path.resolve(import.meta.dirname, "../../..");
const slash = p => p.split(path.sep).join("/");

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const VALUE_FLAGS = [ "--input", "--route", "--rename", "--refactor", "--at", "--json", "--project", "--modules" ];
const MODULE_DIRS = (option("--modules") ?? REPO).split(",").map(dir => path.resolve(dir));
const requireFrom = name => require(require.resolve(name, { paths: MODULE_DIRS }));
const ts = requireFrom("typescript");
const rootArg = argv.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(argv[i - 1]));
if (!rootArg) {
    console.error("usage: node bench/probes/ls/ls-probe.mjs <root> [--input Class.field] [--strict-input-access] [--route manual] [--rename <new> [--write]] [--refactor <name> [--at Class.field] [--write]] [--no-ng-facts] [--json <file>]");
    process.exit(2);
}
const ROOT = slash(path.resolve(rootArg));
const TSCONFIG = slash(path.resolve(ROOT, option("--project") ?? "tsconfig.json"));
const EXTERNAL = TSCONFIG !== `${ROOT}/tsconfig.json`; // not the file tsserver finds by itself
const [ CLASS_NAME, INPUT_NAME ] = (option("--input") ?? "PillComponent.disableTooltip").split(".");
const ROUTE = option("--route") ?? "plugin";
const result = { root: ROOT, route: ROUTE, versions: { typescript: ts.version, languageService: requireFrom("@angular/language-service/package.json").version, node: process.version } };
const timings = result.timings = {};
const ms = from => Math.round(performance.now() - from);
const out = (line = "") => console.log(line);
const rel = file => slash(path.relative(ROOT, file));

// ---------------------------------------------------------------- the language service, in-process
function createLanguageService() {
    const overlay = new Map();
    if (flag("--strict-input-access") || flag("--no-strict-input-access")) {
        const { config } = ts.parseConfigFileTextToJson(TSCONFIG, ts.sys.readFile(TSCONFIG));
        config.angularCompilerOptions = { ...config.angularCompilerOptions, strictInputAccessModifiers: flag("--strict-input-access") };
        overlay.set(TSCONFIG.toLowerCase(), JSON.stringify(config));
    }
    const host = {
        ...ts.sys,
        readFile: (file, encoding) => overlay.get(slash(file).toLowerCase()) ?? ts.sys.readFile(file, encoding),
        setTimeout, clearTimeout, setImmediate, clearImmediate,
        watchFile: () => ({ close() {} }),
        watchDirectory: () => ({ close() {} }),
        // tsserver loads plugins through host.require(<probe location>, <module name>)
        require(initialDir, moduleName) {
            try {
                const modulePath = require.resolve(moduleName, { paths: [ initialDir ] });
                return { module: require(modulePath), modulePath, error: undefined };
            } catch (error) {
                return { module: undefined, error };
            }
        }
    };
    const logger = { close() {}, hasLevel: () => false, loggingEnabled: () => false, perftrc() {}, info() {}, startGroup() {}, endGroup() {}, msg() {}, getLogFileName: () => undefined };
    const projectService = new ts.server.ProjectService({
        host, logger,
        cancellationToken: ts.server.nullCancellationToken,
        useSingleInferredProject: true,
        useInferredProjectPerProjectRoot: false,
        typingsInstaller: ts.server.nullTypingsInstaller,
        session: undefined,
        globalPlugins: ROUTE === "plugin" ? [ "@angular/language-service" ] : [],
        pluginProbeLocations: MODULE_DIRS,
        allowLocalPluginLoads: false
    });
    // tsserver also builds a second program for auto-import suggestions from the nearest package.json (here: +3.6 s and
    // +100 MB on fixture/). An agent never asks for completions with auto-imports, so switch it off. --auto-imports keeps it.
    if (!flag("--auto-imports")) projectService.setHostConfiguration({ preferences: { includePackageJsonAutoImports: "off" } });
    // A configured project exists only once a file of it is open: open the first root file of the tsconfig.
    const parsed = ts.getParsedCommandLineOfConfigFile(TSCONFIG, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
    if (!parsed || parsed.fileNames.length === 0) throw new Error(`no source files for ${TSCONFIG}`);
    const tOpen = performance.now();
    let project;
    if (EXTERNAL) {
        // Internal API (see --project above). No file is opened: an opened file would make tsserver load the nearest
        // tsconfig.json as well (a second program). The map entry keeps the project from being collected as an orphan.
        project = projectService.createConfiguredProject(ts.server.toNormalizedPath(TSCONFIG), "ls-probe --project");
        projectService.externalProjectToConfiguredProjectMap.set(`${ROOT}/ls-probe.external-project`, new Set([ project ]));
        project.updateGraph();
    } else {
        const opened = projectService.openClientFile(parsed.fileNames[0]);
        project = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(parsed.fileNames[0]), true);
        if (project.projectKind !== ts.server.ProjectKind.Configured) throw new Error(`expected a configured project, got kind ${project.projectKind} (config: ${opened.configFileName})`);
        if (slash(project.getProjectName()) !== TSCONFIG) throw new Error(`${parsed.fileNames[0]} landed in ${project.getProjectName()}, not in ${TSCONFIG}`);
    }
    timings.openClientFileMs = ms(tOpen); // builds the TypeScript program and loads the plugin
    let ls = project.getLanguageService();
    if (ROUTE === "manual") {
        const plugin = requireFrom("@angular/language-service")({ typescript: ts });
        ls = plugin.create({ project, languageService: ls, languageServiceHost: project, serverHost: host, config: {} });
    }
    if (typeof ls.getTcb !== "function") throw new Error("the Angular plugin did not wrap the language service (getTcb is missing)");
    return { projectService, project, ls, rootFiles: parsed.fileNames.map(slash) };
}

let t = performance.now();
const { projectService, project, ls, rootFiles } = createLanguageService();
timings.createProjectMs = ms(t);
const program = ls.getProgram();
result.project = { rootFiles: rootFiles.length, programFiles: program.getSourceFiles().length, strictInputAccessOverlay: flag("--strict-input-access") ? true : flag("--no-strict-input-access") ? false : undefined };

// ---------------------------------------------------------------- helpers: text, positions, templates
const textCache = new Map();
function textOf(file) {
    if (!textCache.has(file)) {
        const info = project.getScriptInfo(file);
        const snapshot = info?.getSnapshot();
        textCache.set(file, snapshot ? snapshot.getText(0, snapshot.getLength()) : (ts.sys.readFile(file) ?? ""));
    }
    return textCache.get(file);
}
const lineOf = (file, offset) => textOf(file).slice(0, offset).split("\n").length;
const at = (file, offset) => `${rel(file)}:${lineOf(file, offset)}`;

/** Start tags of every element in a template text: [{ start, end, tag }] with offsets shifted by `base`. */
function startTags(templateText, base, url) {
    const tags = [];
    const visitor = new (class extends TmplAstRecursiveVisitor {
        visitElement(element) {
            tags.push({ start: base + element.startSourceSpan.start.offset, end: base + element.startSourceSpan.end.offset, tag: element.name });
            super.visitElement(element);
        }
    })();
    tmplAstVisitAll(visitor, parseTemplate(templateText, url, { preserveWhitespaces: true }).nodes);
    return tags;
}
const templateCache = new Map();
/** For a file: the template regions it holds (whole file for .html, `template:` literals of decorators for .ts). */
function templatesOf(file) {
    if (templateCache.has(file)) return templateCache.get(file);
    const text = textOf(file);
    const regions = [];
    if (!/\.[cm]?tsx?$/.test(file)) {
        regions.push({ start: 0, end: text.length, tags: startTags(text, 0, file) });
    } else {
        const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const visit = node => {
            if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "template" && ts.isStringLiteralLike(node.initializer) && ts.findAncestor(node, ts.isDecorator)) {
                const start = node.initializer.getStart(sourceFile) + 1, end = node.initializer.end - 1;
                regions.push({ start, end, tags: startTags(text.slice(start, end), start, file) });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    templateCache.set(file, regions);
    return regions;
}
/** Where a reference is: { where: "html" | "inline" | "ts", tag?: element whose start tag holds it (null = an expression elsewhere in the template) }. */
function classify(entry) {
    const file = slash(entry.fileName), start = entry.textSpan.start;
    const region = templatesOf(file).find(r => start >= r.start && start < r.end);
    if (!region) return { where: "ts", nameOffset: start };
    const text = textOf(file), spanText = text.slice(start, start + entry.textSpan.length);
    // For an input of a GENERIC component the service returns every binding twice: the attribute name and the whole
    // attribute (`name="…"`, `[name]="…"`; the second one comes from the type-constructor call in the type-check block).
    const whole = /^(\[\(|\[|\()?[\w.-]+\)?\]?\s*=/.test(spanText);
    const offset = whole ? start + /^[[(]*/.exec(spanText)[0].length : start; // where the name starts
    const length = whole ? /^[\w.-]+/.exec(text.slice(offset))[0].length : entry.textSpan.length;
    // An attribute NAME inside a start tag (`[name]=`, `name=`, `(name)=`) is a binding on that element; anything else
    // (an identifier inside an attribute value, an interpolation, a block expression) is an expression.
    const before = text[offset - 1], after = text[offset + length];
    const isAttributeName = /[\s[(]/.test(before ?? "") && /[\s\]=)/>]/.test(after ?? "");
    const tag = isAttributeName ? region.tags.find(e => offset >= e.start && offset < e.end)?.tag ?? null : null;
    // how the attribute is written: [name] / [(name)] / (name), or a plain static attribute name="…"
    const form = !tag ? undefined : before === "[" ? "bound" : before === "(" ? (text[offset - 2] === "[" ? "two-way" : "event") : "static";
    return { where: file.endsWith(".html") ? "html" : "inline", tag, form, whole, nameOffset: offset };
}
/** Counts per kind of place; a place returned twice (name + whole attribute) counts once. */
function summarize(entries, declaration) {
    const groups = new Map(), seen = new Set();
    for (const entry of entries) {
        const c = classify(entry);
        const place = `${slash(entry.fileName)}@${c.nameOffset}`;
        if (seen.has(place)) continue;
        seen.add(place);
        const isDeclaration = slash(entry.fileName) === declaration.file && entry.textSpan.start === declaration.pos;
        const key = c.where === "ts" ? (isDeclaration ? "declaration" : "class-side code (.ts)") : `${c.where === "html" ? "external .html" : "inline template in .ts"}: ${c.tag ? `${c.form} binding on <${c.tag}>` : "expression (a read, not a binding)"}`;
        groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    return Object.fromEntries([ ...groups ].sort());
}
const printGroups = groups => { for (const [ key, count ] of Object.entries(groups)) out(`    ${String(count).padStart(5)}  ${key}`); };
const flat = message => ts.flattenDiagnosticMessageText(message, " ").replace(/\s+/g, " ");

// ---------------------------------------------------------------- find the input declaration (TypeScript AST only)
function findClass(name) {
    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(".ngtypecheck.")) continue;
        let found;
        const visit = node => { if (ts.isClassDeclaration(node) && node.name?.text === name) found = node; else if (!found) ts.forEachChild(node, visit); };
        visit(sourceFile);
        if (found) return { sourceFile, node: found };
    }
}
function inputsOf(cls) {
    const inputs = [];
    for (const member of cls.node.members) {
        if (!ts.isPropertyDeclaration(member) && !ts.isSetAccessor(member)) continue;
        const decorated = (ts.getDecorators(member) ?? []).some(d => /^Input\b/.test(d.expression.getText(cls.sourceFile)));
        const initializer = ts.isPropertyDeclaration(member) ? member.initializer?.getText(cls.sourceFile) ?? "" : "";
        const signal = /^(input|model)(\.required)?\s*[<(]/.test(initializer);
        if (!decorated && !signal) continue;
        inputs.push({ name: member.name.getText(cls.sourceFile), pos: member.name.getStart(cls.sourceFile), kind: decorated ? "@Input()" : "input()", modifiers: (ts.getModifiers(member) ?? []).map(m => m.getText(cls.sourceFile)) });
    }
    return inputs;
}
function locate(className, inputName) {
    const cls = findClass(className);
    if (!cls) return { error: `class ${className} not found in the program` };
    const inputs = inputsOf(cls);
    const selector = /selector\s*:\s*["'`]([^"'`]+)["'`]/.exec(cls.node.getText(cls.sourceFile))?.[1];
    const base = cls.node.heritageClauses?.find(h => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0].expression.getText(cls.sourceFile);
    return { file: slash(cls.sourceFile.fileName), className, selector, base, inputs, input: inputs.find(i => i.name === inputName) };
}
let target = locate(CLASS_NAME, INPUT_NAME);
if (target.error) { console.error(target.error); process.exit(1); }
out(`Angular Language Service ${result.versions.languageService} in-process (TypeScript ${ts.version}, Node ${process.version}), route: ${ROUTE === "plugin" ? "ts.server.ProjectService + global plugin" : "ts.server.ProjectService + plugin.create() by hand"}`);
out(`project: ${rel(TSCONFIG) || "tsconfig.json"}${EXTERNAL ? " (loaded through the internal createConfiguredProject, no file opened)" : ""} in ${ROOT}: ${rootFiles.length} root files, ${program.getSourceFiles().length} files in the program${flag("--strict-input-access") ? "  [strictInputAccessModifiers forced to true in memory]" : flag("--no-strict-input-access") ? "  [strictInputAccessModifiers forced to false in memory]" : ""}`);
if (!target.input) {
    out(`\n! ${CLASS_NAME} (${rel(target.file)}) declares no input "${INPUT_NAME}"${target.base ? ` (it extends ${target.base}: an inherited input is declared there)` : ""}. Declared inputs: ${target.inputs.map(i => i.name).join(", ") || "none"}.`);
    if (target.inputs.length === 0) process.exit(1);
    target.input = target.inputs[0];
    out(`  Continuing with "${target.input.name}".`);
}
const declaration = { file: target.file, pos: target.input.pos };
result.target = { class: CLASS_NAME, selector: target.selector, input: target.input.name, kind: target.input.kind, modifiers: target.input.modifiers, declaredAt: at(declaration.file, declaration.pos) };
out(`\ntarget: ${CLASS_NAME}.${target.input.name}  <${target.selector}>  ${target.input.modifiers.join(" ")} ${target.input.kind}  declared at ${result.target.declaredAt}`);

// ---------------------------------------------------------------- (a)(b)(c) references from the declaration
t = performance.now();
const references = ls.getReferencesAtPosition(declaration.file, declaration.pos) ?? [];
timings.firstReferencesMs = ms(t);
timings.coldTotalMs = ms(tStart);
timings.processUptimeAtFirstAnswerMs = Math.round(process.uptime() * 1000); // includes Node start-up and module loading
const groups = summarize(references, declaration);
// `offset` is where the NAME starts (for a whole-attribute entry that is inside the returned span)
const locate_ = r => { const c = classify(r), file = slash(r.fileName); return { ...c, file, offset: c.nameOffset, text: textOf(file).slice(r.textSpan.start, r.textSpan.start + r.textSpan.length) }; };
const distinct = places => { const byPlace = new Map(); for (const r of places) { const key = `${r.file}@${r.offset}`; if (!byPlace.has(key) || byPlace.get(key).whole) byPlace.set(key, r); } return [ ...byPlace.values() ]; };
const allEntries = references.map(locate_);
const located = distinct(allEntries);
const wholeEntries = allEntries.filter(r => r.whole);
const onSelector = located.filter(r => r.tag === target.selector);
const onOtherElements = located.filter(r => r.where !== "ts" && r.tag && r.tag !== target.selector);
const listed = places => places.map(r => ({ file: rel(r.file), line: lineOf(r.file, r.offset), offset: r.offset, where: r.where, tag: r.tag ?? undefined, form: r.form, whole: r.whole || undefined, text: r.text }));
result.references = { total: references.length, distinct: located.length, wholeAttributeEntries: wholeEntries.length, groups, list: listed(allEntries), bindingsOnSelector: onSelector.length, inHtml: onSelector.filter(r => r.where === "html").length, inInline: onSelector.filter(r => r.where === "inline").length, bindingsOnOtherElements: onOtherElements.length, files: new Set(located.map(r => r.file)).size };
out(`\n[references] getReferencesAtPosition(declaration): ${references.length} entries${located.length !== references.length ? ` = ${located.length} distinct places` : ""} in ${result.references.files} files  (${timings.firstReferencesMs} ms, first query = Angular analysis + all type-check blocks)`);
printGroups(groups);
if (wholeEntries.length) {
    out(`  ! ${wholeEntries.length} entries are a whole attribute (${JSON.stringify(wholeEntries[0].text)}), not the name: ${references.length - located.length} bindings were returned twice. The counts above are distinct places.`);
    const tcb = ls.getTcb(wholeEntries[0].file, wholeEntries[0].offset);
    const lines = (tcb?.content ?? "").split("\n").filter(line => new RegExp(`\\b${target.input.name}\\b`).test(line));
    result.references.typeCheckBlockLines = lines.slice(0, 4).map(line => line.trim().slice(0, 260));
    out(`    type-check block of ${at(wholeEntries[0].file, wholeEntries[0].offset)}: ${lines.length} lines mention "${target.input.name}", e.g.`);
    for (const line of result.references.typeCheckBlockLines) out(`      ${line}`);
}
out(`  bindings on <${target.selector}>: ${onSelector.length} (${result.references.inHtml} in external .html, ${result.references.inInline} in inline templates); on any other element: ${onOtherElements.length}`);
if (onSelector.length === 0 && target.input.kind === "input()" && target.input.modifiers.some(m => [ "readonly", "private", "protected" ].includes(m)) && !flag("--strict-input-access"))
    out(`  ! no template binding found. The field is ${target.input.modifiers.join(" ")}: the type-check block then goes through a temporary variable the service cannot map back. Re-run with --strict-input-access.`);

// same-named bindings in the workspace that are NOT references (text search would return them)
const sameName = { total: 0, byTag: {} };
const referenceKeys = new Set(located.map(r => `${r.file}@${r.offset}`));
for (const file of [ ...new Set([ ...rootFiles, ...project.getScriptInfos().map(i => slash(i.fileName)).filter(f => f.endsWith(".html")) ]) ]) {
    if (file.includes("/node_modules/") || file.includes(".ngtypecheck.")) continue;
    const text = textOf(file), pattern = new RegExp(`\\b${target.input.name}\\b`, "g");
    for (const region of templatesOf(file)) {
        for (const tag of region.tags) {
            pattern.lastIndex = tag.start;
            for (let m; (m = pattern.exec(text)) && m.index < tag.end;) {
                const before = text[m.index - 1];
                if (before !== "[" && before !== " " && before !== "\n" && before !== "\t" && before !== "(") continue; // an attribute name, not a value
                if (referenceKeys.has(`${file}@${m.index}`)) continue;
                sameName.total++;
                sameName.byTag[tag.tag] = (sameName.byTag[tag.tag] ?? 0) + 1;
            }
        }
    }
}
result.sameNameNotReferenced = sameName;
out(`  same-named attributes in templates NOT returned as references: ${sameName.total}${sameName.total ? ` (${Object.entries(sameName.byTag).map(([ tag, n ]) => `<${tag}> ×${n}`).join(", ")})` : ""}`);

// ---------------------------------------------------------------- cross-check with the parser-only tool
if (!flag("--no-ng-facts")) {
    const t0 = performance.now();
    const run = spawnSync(process.execPath, [ path.join(REPO, "tool/ng-facts.mjs"), "usages", `${CLASS_NAME}.${target.input.name}`, "--root", ROOT, "--all" ], { encoding: "utf8", maxBuffer: 64 << 20 });
    const ngFactsMs = ms(t0);
    const lines = run.stdout.split("\n");
    const mine = new Map(), theirs = new Map();
    const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
    for (const line of lines) { const m = /^\s+(\S+?):(\d+)\s+<([^>]+)>\s/.exec(line); if (m) bump(theirs, `${slash(m[1].replaceAll("\\", "/"))}:${m[2]}`); }
    for (const r of onSelector) bump(mine, at(r.file, r.offset));
    let same = 0, onlyLs = 0, onlyNgFacts = 0;
    for (const key of new Set([ ...mine.keys(), ...theirs.keys() ])) { const a = mine.get(key) ?? 0, b = theirs.get(key) ?? 0; same += Math.min(a, b); onlyLs += Math.max(0, a - b); onlyNgFacts += Math.max(0, b - a); }
    result.ngFacts = { headline: lines[0], sameNameLine: lines.find(l => l.startsWith("Same name elsewhere")) ?? null, uses: [ ...theirs.values() ].reduce((a, b) => a + b, 0), sameFileLine: same, onlyLanguageService: onlyLs, onlyNgFacts, wallMs: ngFactsMs };
    out(`\n[ng-facts] ${lines[0]}`);
    if (result.ngFacts.sameNameLine) out(`  ${result.ngFacts.sameNameLine}`);
    out(`  same file:line in both: ${same}; only language service: ${onlyLs}; only ng-facts: ${onlyNgFacts}  (ng-facts as a separate process: ${ngFactsMs} ms wall)`);
}

// ---------------------------------------------------------------- references asked from a template position
const firstUse = onSelector[0] ?? located.find(r => r.where !== "ts");
if (firstUse) {
    t = performance.now();
    const fromTemplate = ls.getReferencesAtPosition(firstUse.file, firstUse.offset) ?? [];
    result.referencesFromTemplate = { at: at(firstUse.file, firstUse.offset), total: fromTemplate.length, ms: ms(t) };
    out(`\n[references from a template] at ${result.referencesFromTemplate.at}: ${fromTemplate.length} entries (${result.referencesFromTemplate.ms} ms)`);
}

// ---------------------------------------------------------------- (d) rename
t = performance.now();
const renameInfo = ls.getRenameInfo(declaration.file, declaration.pos, {});
const renameLocations = renameInfo.canRename ? (ls.findRenameLocations(declaration.file, declaration.pos, false, false, {}) ?? []) : [];
result.rename = { canRename: renameInfo.canRename, reason: renameInfo.localizedErrorMessage, total: renameLocations.length, groups: summarize(renameLocations, declaration), list: listed(renameLocations.map(locate_)), files: new Set(renameLocations.map(r => r.fileName)).size, ms: ms(t) };
out(`\n[rename] getRenameInfo: canRename=${renameInfo.canRename}${renameInfo.canRename ? "" : ` (${renameInfo.localizedErrorMessage})`}; findRenameLocations: ${renameLocations.length} locations in ${result.rename.files} files (${result.rename.ms} ms)`);
printGroups(result.rename.groups);
const newName = option("--rename");
if (renameInfo.canRename && renameLocations.length === 0) {
    result.rename.refused = true;
    out(`  ! refused without a message: getRenameInfo says the symbol can be renamed, findRenameLocations returns nothing.${wholeEntries.length ? ` The service gives up on the whole rename as soon as one location in a type-check block maps to template text other than "${target.input.name}", and here ${wholeEntries.length} do (the whole-attribute entries above).` : ""}`);
    if (flag("--rename-from-references")) {
        // Fallback: one edit per distinct reference whose text is exactly the old name (no prefixText/suffixText handling).
        const edits = located.filter(r => textOf(r.file).slice(r.offset, r.offset + target.input.name.length) === target.input.name);
        const byFile = new Map();
        for (const edit of edits) byFile.set(edit.file, [ ...(byFile.get(edit.file) ?? []), edit ]);
        if (newName) for (const [ file, list ] of byFile) {
            let text = textOf(file);
            for (const edit of list.sort((a, b) => b.offset - a.offset)) text = text.slice(0, edit.offset) + newName + text.slice(edit.offset + target.input.name.length);
            if (flag("--write")) writeFileSync(file, text);
        }
        result.rename.fromReferences = { edits: edits.length, files: byFile.size, skipped: located.length - edits.length, groups: Object.fromEntries(Object.entries(Object.groupBy(edits, r => r.where)).map(([ where, list ]) => [ where, list.length ])), newName, written: Boolean(newName && flag("--write")) };
        out(`  fallback --rename-from-references: ${edits.length} edits in ${byFile.size} files (${Object.entries(result.rename.fromReferences.groups).map(([ where, n ]) => `${n} ${where}`).join(", ")}; ${located.length - edits.length} places skipped: text is not the name)${newName ? `  ${flag("--write") ? "WROTE" : "dry run (add --write)"} → "${newName}"` : ""}`);
    }
}
if (newName && renameLocations.length) {
    const byFile = new Map();
    for (const location of renameLocations) byFile.set(location.fileName, [ ...(byFile.get(location.fileName) ?? []), location ]);
    for (const [ file, locations ] of byFile) {
        let text = textOf(slash(file));
        for (const location of locations.sort((a, b) => b.textSpan.start - a.textSpan.start))
            text = text.slice(0, location.textSpan.start) + (location.prefixText ?? "") + newName + (location.suffixText ?? "") + text.slice(location.textSpan.start + location.textSpan.length);
        if (flag("--write")) writeFileSync(file, text);
    }
    result.rename.applied = { newName, files: byFile.size, written: flag("--write") };
    out(`  ${flag("--write") ? "WROTE" : "would write (dry run, add --write)"}: ${renameLocations.length} edits → "${newName}" in ${byFile.size} files`);
}

// ---------------------------------------------------------------- (e) diagnostics for the whole project
t = performance.now();
const diagnostics = [];
const templateFiles = project.getScriptInfos().map(i => slash(i.fileName)).filter(f => f.endsWith(".html") && !f.includes("/node_modules/"));
const sourceFiles = rootFiles.filter(f => !f.includes(".ngtypecheck."));
const diagnosed = flag("--no-diagnostics") ? [] : [ ...sourceFiles, ...templateFiles ];
for (const file of diagnosed) for (const d of ls.getSemanticDiagnostics(file)) diagnostics.push({ asked: file, d });
const unique = new Map();
for (const { d } of diagnostics) unique.set(`${d.file?.fileName}@${d.start}@${d.code}`, d);
const byCode = {};
for (const d of unique.values()) byCode[d.code] = (byCode[d.code] ?? 0) + 1;
result.diagnostics = { skipped: flag("--no-diagnostics"), filesAsked: diagnosed.length, tsFiles: sourceFiles.length, htmlFiles: templateFiles.length, returned: diagnostics.length, unique: unique.size, byCode, ms: ms(t), first: [ ...unique.values() ].slice(0, 3).map(d => `${d.file ? at(slash(d.file.fileName), d.start) : "?"} ${d.source ?? "ts"}(${d.code}): ${flat(d.messageText).slice(0, 180)}`) };
if (flag("--no-diagnostics")) out(`\n[diagnostics] skipped (--no-diagnostics); the project has ${sourceFiles.length} .ts root files and ${templateFiles.length} external templates`);
else out(`\n[diagnostics] getSemanticDiagnostics on ${sourceFiles.length} .ts + ${templateFiles.length} .html files: ${unique.size} distinct diagnostics (${result.diagnostics.ms} ms)${unique.size ? `, by code: ${Object.entries(byCode).map(([ code, n ]) => `${code} ×${n}`).join(", ")}` : ""}`);
for (const line of result.diagnostics.first) out(`    ${line}`);
const firstDiagnostic = [ ...unique.values() ][0];
if (firstDiagnostic?.file) {
    const fixes = ls.getCodeFixesAtPosition(firstDiagnostic.file.fileName, firstDiagnostic.start, firstDiagnostic.start + firstDiagnostic.length, [ firstDiagnostic.code ], {}, {});
    result.diagnostics.codeFixesForFirst = fixes.map(f => f.description);
    out(`    code fixes offered for the first one: ${fixes.length ? fixes.map(f => f.description).join(" | ") : "none"}`);
}

// ---------------------------------------------------------------- (e) quick info, definition
const part = info => info ? `${info.displayParts?.map(p => p.text).join("")}${info.documentation?.length ? `  /** ${info.documentation.map(p => p.text).join(" ")} */` : ""}` : "undefined (no answer)";
const anyTag = (() => {
    for (const file of [ ...templateFiles, ...sourceFiles ]) for (const region of templatesOf(file)) { const tag = region.tags.find(e => e.tag === target.selector); if (tag) return { file, tag }; }
})();
if (anyTag) {
    const text = textOf(anyTag.file), tagText = text.slice(anyTag.tag.start, anyTag.tag.end);
    const bindingMatch = new RegExp(`[\\[\\s]${target.input.name}\\b`).exec(tagText);
    t = performance.now();
    const elementInfo = ls.getQuickInfoAtPosition(anyTag.file, anyTag.tag.start + 2);
    const bindingInfo = bindingMatch ? ls.getQuickInfoAtPosition(anyTag.file, anyTag.tag.start + bindingMatch.index + 1) : undefined;
    const definition = bindingMatch ? ls.getDefinitionAndBoundSpan(anyTag.file, anyTag.tag.start + bindingMatch.index + 1) : undefined;
    result.quickInfo = { at: at(anyTag.file, anyTag.tag.start), element: part(elementInfo), binding: bindingMatch ? part(bindingInfo) : "(this element does not set the input)", definition: definition?.definitions?.map(d => at(slash(d.fileName), d.textSpan.start)) ?? [], ms: ms(t) };
    out(`\n[quick info] at ${result.quickInfo.at}  ${tagText.replace(/\s+/g, " ").slice(0, 90)}`);
    out(`    element <${target.selector}>: ${result.quickInfo.element}`);
    out(`    binding ${target.input.name}: ${result.quickInfo.binding}`);
    out(`    go to definition from the binding: ${result.quickInfo.definition.join(", ") || "undefined (no answer)"}`);
}

// ---------------------------------------------------------------- (e) refactorings
const refactorTarget = (() => {
    const [ className, field ] = (option("--at") ?? `${CLASS_NAME}.${target.input.name}`).split(".");
    const found = locate(className, field);
    if (found.input) return { file: found.file, pos: found.input.pos, label: `${className}.${field}`, kind: found.input.kind };
    // not an input: any other class member will do (for example a @ViewChild field for the signal-query refactorings)
    const cls = findClass(className);
    const member = cls?.node.members.find(m => m.name?.getText(cls.sourceFile) === field);
    return member ? { file: slash(cls.sourceFile.fileName), pos: member.name.getStart(cls.sourceFile), label: `${className}.${field}`, kind: (ts.getDecorators(member) ?? []).map(d => d.getText(cls.sourceFile).replace(/\(.*$/s, "()")).join(" ") || "member" } : null;
})();
if (refactorTarget) {
    t = performance.now();
    const applicable = ls.getApplicableRefactors(refactorTarget.file, refactorTarget.pos, {}) ?? [];
    result.refactors = { at: refactorTarget.label, kind: refactorTarget.kind, offered: applicable.map(r => ({ name: r.name, description: r.description })), ms: ms(t) };
    out(`\n[refactorings] getApplicableRefactors at ${refactorTarget.label} (${refactorTarget.kind}): ${applicable.length ? "" : "none"}  (${result.refactors.ms} ms)`);
    for (const r of applicable) out(`    ${r.name}: ${r.description}`);
    const wanted = option("--refactor");
    if (wanted) {
        try {
            const viaTs = ls.getEditsForRefactor(refactorTarget.file, {}, refactorTarget.pos, wanted, wanted, {});
            result.refactors.getEditsForRefactor = viaTs ? `${viaTs.edits.length} file edits` : "undefined";
        } catch (error) {
            result.refactors.getEditsForRefactor = `threw: ${String(error.message).split("\n")[0]}`;
        }
        out(`    standard getEditsForRefactor("${wanted}"): ${result.refactors.getEditsForRefactor}`);
        t = performance.now();
        const progress = [];
        const applied = await ls.applyRefactoring(refactorTarget.file, refactorTarget.pos, wanted, (percentage, message) => progress.push(`${percentage}% ${message}`));
        const edits = applied?.edits ?? [];
        result.refactors.applyRefactoring = { name: wanted, ms: ms(t), files: edits.length, textChanges: edits.reduce((n, e) => n + e.textChanges.length, 0), errorMessage: applied?.errorMessage, warningMessage: applied?.warningMessage, progress, written: flag("--write"), fileNames: edits.map(e => rel(slash(e.fileName))) };
        out(`    Angular applyRefactoring("${wanted}"): ${applied === undefined ? "undefined (unknown refactoring)" : `${result.refactors.applyRefactoring.textChanges} text changes in ${edits.length} files`} (${result.refactors.applyRefactoring.ms} ms)${applied?.errorMessage ? `  error: ${applied.errorMessage}` : ""}${applied?.warningMessage ? `  warning: ${applied.warningMessage}` : ""}`);
        for (const edit of edits) {
            const file = slash(edit.fileName);
            let text = textOf(file);
            out(`      ${rel(file)}: ${edit.textChanges.length} changes`);
            for (const change of [ ...edit.textChanges ].sort((a, b) => b.span.start - a.span.start)) {
                if (edits.length <= 6) out(`        @${lineOf(file, change.span.start)} ${JSON.stringify(text.slice(change.span.start, change.span.start + change.span.length)).slice(0, 70)} → ${JSON.stringify(change.newText).slice(0, 90)}`);
                text = text.slice(0, change.span.start) + change.newText + text.slice(change.span.start + change.span.length);
            }
            if (flag("--write")) writeFileSync(file, text);
        }
        if (edits.length) out(`    ${flag("--write") ? "WROTE the edits" : "dry run (add --write to apply)"}`);
    }
}

// ---------------------------------------------------------------- warm timings: same questions again, and after an in-memory edit
const median = values => [ ...values ].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const timeIt = (fn, runs = 5) => { const samples = []; for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); samples.push(performance.now() - t0); } return Math.round(median(samples) * 10) / 10; };
timings.warm = {
    referencesFromDeclarationMs: timeIt(() => ls.getReferencesAtPosition(declaration.file, declaration.pos)),
    findRenameLocationsMs: renameInfo.canRename ? timeIt(() => ls.findRenameLocations(declaration.file, declaration.pos, false, false, {})) : null,
    quickInfoMs: anyTag ? timeIt(() => ls.getQuickInfoAtPosition(anyTag.file, anyTag.tag.start + 2)) : null,
    diagnosticsOneFileMs: anyTag ? timeIt(() => ls.getSemanticDiagnostics(anyTag.file)) : null
};
// An agent edits a file, then asks again: overlay one template in memory (nothing is written) and repeat the query.
if (anyTag) {
    const original = textOf(anyTag.file);
    const edited = original.slice(0, anyTag.tag.start) + `<${target.selector}></${target.selector}>` + original.slice(anyTag.tag.start);
    const inserted = edited.length - original.length;
    t = performance.now();
    // With --project the file is edited in place in memory: opening it would make tsserver load the nearest tsconfig.json too.
    if (EXTERNAL) project.getScriptInfo(anyTag.file).editContent(anyTag.tag.start, anyTag.tag.start, edited.slice(anyTag.tag.start, anyTag.tag.start + inserted));
    else projectService.openClientFile(anyTag.file, edited);
    const afterEdit = ls.getReferencesAtPosition(declaration.file, declaration.pos) ?? [];
    timings.afterInMemoryEdit = { referencesMs: ms(t), entries: afterEdit.length };
    t = performance.now();
    timings.afterInMemoryEdit.diagnosticsOfEditedFileMs = (ls.getSemanticDiagnostics(anyTag.file), ms(t));
    if (EXTERNAL) project.getScriptInfo(anyTag.file).editContent(anyTag.tag.start, anyTag.tag.start + inserted, "");
    else projectService.closeClientFile(anyTag.file);
}
const memory = process.memoryUsage();
const mb = bytes => Math.round(bytes / 1048576);
result.memory = { peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024), rssMb: mb(memory.rss), heapUsedMb: mb(memory.heapUsed), heapTotalMb: mb(memory.heapTotal) };
out(`\n[cost] cold: load + create project ${timings.createProjectMs} ms (openClientFile ${timings.openClientFileMs} ms), first references ${timings.firstReferencesMs} ms, total to first answer ${timings.coldTotalMs} ms (${timings.processUptimeAtFirstAnswerMs} ms since the process started)`);
out(`       warm (median of 5): references ${timings.warm.referencesFromDeclarationMs} ms, rename locations ${timings.warm.findRenameLocationsMs ?? "-"} ms, quick info ${timings.warm.quickInfoMs ?? "-"} ms, diagnostics of one file ${timings.warm.diagnosticsOneFileMs ?? "-"} ms`);
if (timings.afterInMemoryEdit) out(`       after an in-memory edit of one template: references again ${timings.afterInMemoryEdit.referencesMs} ms (${timings.afterInMemoryEdit.entries} entries), diagnostics of that file ${timings.afterInMemoryEdit.diagnosticsOfEditedFileMs} ms`);
out(`       memory: peak RSS ${result.memory.peakRssMb} MB, heap used ${result.memory.heapUsedMb} MB of ${result.memory.heapTotalMb} MB`);

if (option("--json")) writeFileSync(option("--json"), JSON.stringify(result, null, 2));
process.exit(0);
