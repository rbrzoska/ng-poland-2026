#!/usr/bin/env node
// ls-facts — type-checked facts and a rename for an Angular workspace, asked from the Angular Language Service (no LLM).
// The service runs inside this process: a ts.server.ProjectService (the object tsserver is built around) loads the project
// of <root>/tsconfig.json with @angular/language-service as its plugin, answers one command, and the process exits.
//   node tool/ls-facts.mjs refs <Class>.<member> [--all]             every reference of a class member, grouped and counted
//   node tool/ls-facts.mjs rename <Class>.<member> <new> [--write]   the rename at every reference (dry run without --write)
//   node tool/ls-facts.mjs check                                     the compiler's diagnostics for the whole project (it runs ngc)
//   node tool/ls-facts.mjs --help
// Options: --root <dir> (default "."), --project <tsconfig> (default tsconfig.json, relative to the root).
// <Class> may be written <file>#<Class> when two classes share a name. Exit code 1: a wrong name, or the compiler found an error.
// What the service does not return is said in a line that starts with "!": options switched on in memory (strictTemplates,
// strictInputAccessModifiers), bindings found with the template parser instead, templates it cannot read, other tsconfig files.
// The packages (typescript, @angular/language-service, @angular/compiler, @angular/compiler-cli) are taken from the first
// node_modules that has them, walking up from --root and then from this file. Nothing is written without --write.
// As a library: refs(root, "Class.member") and planRename(root, "Class.member", newName) return plain data.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHOWN_PER_GROUP = 8;
const HELP = `ls-facts — facts about an Angular workspace from the Angular Language Service: type-checked, no text search.
  refs <Class>.<member> [--all]            every reference of a class member (an input, a field, a method): the declaration,
                                           template bindings (external and inline templates, bound and static form, on the
                                           class and on classes that inherit it), reads in template expressions and
                                           TypeScript code. Grouped and counted, each as file:line plus the line;
                                           the first ${SHOWN_PER_GROUP} per group, --all lists every one
  rename <Class>.<member> <new> [--write]  plans the rename at every reference and prints the edits per group; --write
                                           applies them and runs the compiler (ngc) on the workspace
  check                                    the compiler's diagnostics for the whole project (it runs ngc), counted by message
Options: --root <dir> (default "."), --project <tsconfig> (default tsconfig.json; needed when tsconfig.json lists no files).
<Class> is a class name of the project (<file>#<Class> when two classes share the name); a member the class inherits is
followed to the class that declares it. Lines that start with "!" say what had to be done, or could not be done, to answer.
Exit code 1: a wrong name or file, or the compiler reported an error (after check and after rename --write).`;
const USAGE = "usage: ls-facts refs <Class>.<member> [--all] | rename <Class>.<member> <new> [--write] | check | --help   [--root <dir>] [--project <tsconfig>]";

const OWN_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const SHOWN_DIAGNOSTICS = 8;
const LINE_WIDTH = 160;
const TS_FILE = /\.[cm]?tsx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RESTRICTED_MODIFIERS = [ "readonly", "private", "protected" ];
const INPUT_KINDS = new Set([ "input()", "model()", "@Input()" ]);
const KIND_ORDER = [ "declaration", "binding", "static", "template-read", "class-read" ];

/** A mistake of the caller (a wrong name, a missing file): printed as one message, never as a stack trace. */
class UsageError extends Error {}

const slash = file => file.split(path.sep).join("/");
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const naturalOrder = (left, right) => left.localeCompare(right, "en", { numeric: true });
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- packages and the language service, in-process

/** typescript, the language service and the template parser, from the first node_modules above `root` or above this file. */
function loadPackages(root) {
    const directories = [ root, OWN_DIRECTORY ];
    const locate = name => {
        try {
            return nodeRequire.resolve(name, { paths: directories });
        } catch {
            throw new UsageError(`package ${name.replace(/\/package\.json$/, "")} not found in a node_modules above ${root} or above ${slash(OWN_DIRECTORY)}`);
        }
    };
    const languageService = locate("@angular/language-service");
    return {
        locate,
        ts: nodeRequire(locate("typescript")),
        ng: nodeRequire(locate("@angular/compiler")),
        languageService,
        languageServiceVersion: JSON.parse(readFileSync(locate("@angular/language-service/package.json"), "utf8")).version
    };
}

/** One of the angularCompilerOptions as the compiler sees it: the config's own value, else the one it extends. */
function angularCompilerOption(ts, tsconfig, name, seen = new Set()) {
    if (seen.has(tsconfig) || !existsSync(tsconfig)) return undefined;
    seen.add(tsconfig);
    const { config } = ts.readConfigFile(tsconfig, ts.sys.readFile);
    const own = config?.angularCompilerOptions?.[name];
    if (own !== undefined) return own;
    for (const parent of [ config?.extends ?? [] ].flat().reverse()) {
        let file;
        if (parent.startsWith(".") || path.isAbsolute(parent)) {
            file = path.resolve(path.dirname(tsconfig), parent);
            if (!existsSync(file) && !file.endsWith(".json")) file += ".json";
        } else {
            for (const candidate of [ parent, `${parent}.json`, `${parent}/tsconfig.json` ]) {
                try {
                    file = nodeRequire.resolve(candidate, { paths: [ path.dirname(tsconfig) ] });
                    break;
                } catch {
                    // try the next spelling
                }
            }
        }
        const inherited = file ? angularCompilerOption(ts, file, name, seen) : undefined;
        if (inherited !== undefined) return inherited;
    }
    return undefined;
}

/** The project a command is about: the root, the packages, the tsconfig and the source files it lists. Nothing is loaded yet. */
function locateProject(rootArgument, projectOption) {
    const root = slash(path.resolve(rootArgument));
    if (!existsSync(root)) throw new UsageError(`no such directory: ${root}`);
    const packages = loadPackages(root);
    const { ts } = packages;
    const tsconfig = slash(path.resolve(root, projectOption ?? "tsconfig.json"));
    const tsconfigName = slash(path.relative(root, tsconfig));
    const otherConfigs = readdirSync(root).filter(name => /^tsconfig.*\.json$/.test(name) && name !== tsconfigName);
    const found = otherConfigs.length ? ` (found here: ${otherConfigs.join(", ")})` : "";
    if (!existsSync(tsconfig)) throw new UsageError(`${tsconfigName} not found in ${root} — name the project with --project <tsconfig>${found}`);
    const parsed = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
    if (!parsed) throw new UsageError(`${tsconfigName} cannot be read as a tsconfig`);
    const rootFiles = parsed.fileNames.map(slash);
    if (rootFiles.length === 0) throw new UsageError(`${tsconfigName} lists no source files (a solution-style config) — name the project with --project <tsconfig>${found}`);
    return { root, packages, ts, tsconfig, tsconfigName, otherConfigs, rootFiles };
}

/**
 * Loads the project and returns the language service with what the commands need around it.
 * `forceStrict` switches two angularCompilerOptions on IN MEMORY when the project does not set them, because the service
 * returns fewer references without them: strictInputAccessModifiers (else no template binding of a readonly, private or
 * protected input is resolved) and strictTemplates (else bindings inside @if / @for blocks and ng-templates are not).
 */
function openWorkspace(rootArgument, { project: projectOption, forceStrict = false } = {}) {
    const located = locateProject(rootArgument, projectOption);
    const { root, packages, ts, tsconfig, tsconfigName, rootFiles } = located;

    const fileKey = file => (ts.sys.useCaseSensitiveFileNames ? slash(file) : slash(file).toLowerCase());
    const overlay = new Map();
    const forced = forceStrict ? [ "strictInputAccessModifiers", "strictTemplates" ].filter(name => angularCompilerOption(ts, tsconfig, name) !== true) : [];
    const strictInputAccessForced = forced.includes("strictInputAccessModifiers");
    // The service is strict about templates on its own unless the project says "strictTemplates": false: only that is news.
    const strictTemplatesForced = forced.includes("strictTemplates") && angularCompilerOption(ts, tsconfig, "strictTemplates") === false;
    if (forced.length) {
        const { config } = ts.parseConfigFileTextToJson(tsconfig, ts.sys.readFile(tsconfig));
        config.angularCompilerOptions = { ...config.angularCompilerOptions, ...Object.fromEntries(forced.map(name => [ name, true ])) };
        overlay.set(fileKey(tsconfig), JSON.stringify(config));
    }

    // The server host is ours: ts.sys, timers that can be cleared at the end, no file watchers, and the plugin we located.
    const timers = new Set();
    const immediates = new Set();
    const host = {
        ...ts.sys,
        readFile: (file, encoding) => overlay.get(fileKey(file)) ?? ts.sys.readFile(file, encoding),
        setTimeout: (callback, delay, ...rest) => {
            const timer = setTimeout(callback, delay, ...rest);
            timers.add(timer);
            return timer;
        },
        clearTimeout: timer => {
            timers.delete(timer);
            clearTimeout(timer);
        },
        setImmediate: (callback, ...rest) => {
            const immediate = setImmediate(callback, ...rest);
            immediates.add(immediate);
            return immediate;
        },
        clearImmediate: immediate => {
            immediates.delete(immediate);
            clearImmediate(immediate);
        },
        watchFile: () => ({ close() {} }),
        watchDirectory: () => ({ close() {} }),
        require: (_initialDirectory, moduleName) => {
            try {
                const modulePath = moduleName === "@angular/language-service" ? packages.languageService : packages.locate(moduleName);
                return { module: nodeRequire(modulePath), modulePath, error: undefined };
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
        globalPlugins: [ "@angular/language-service" ],
        pluginProbeLocations: [ root ],
        allowLocalPluginLoads: false
    });
    // tsserver would also build a second program for auto-import suggestions (seconds and ~100 MB): nobody asks for them here.
    projectService.setHostConfiguration({ preferences: { includePackageJsonAutoImports: "off" } });

    // A configured project exists once a file of it is open. tsserver finds only a config named tsconfig.json that way; any
    // other name (--project tsconfig.app.json) goes through the internal createConfiguredProject, with no file opened.
    const samePath = (left, right) => fileKey(left) === fileKey(right);
    let project;
    if (path.basename(tsconfig) === "tsconfig.json") {
        const first = rootFiles.find(file => !DECLARATION_FILE.test(file)) ?? rootFiles[0];
        projectService.openClientFile(first);
        const opened = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(first), true);
        if (opened?.projectKind === ts.server.ProjectKind.Configured && samePath(opened.getProjectName(), tsconfig)) project = opened;
        else projectService.closeClientFile(first);
    }
    if (!project) {
        if (typeof projectService.createConfiguredProject !== "function") throw new UsageError(`TypeScript ${ts.version} cannot load ${tsconfigName} in-process: only a config named tsconfig.json`);
        project = projectService.createConfiguredProject(ts.server.toNormalizedPath(tsconfig), "ls-facts --project");
        projectService.externalProjectToConfiguredProjectMap?.set(`${root}/ls-facts.external-project`, new Set([ project ]));
        project.updateGraph();
    }
    const service = project.getLanguageService();
    if (typeof service.getTcb !== "function") throw new UsageError("the Angular Language Service plugin did not load into the TypeScript server");
    const program = service.getProgram();

    const texts = new Map();
    const textOf = file => {
        if (!texts.has(file)) {
            const snapshot = project.getScriptInfo(file)?.getSnapshot();
            texts.set(file, snapshot ? snapshot.getText(0, snapshot.getLength()) : (ts.sys.readFile(file) ?? ""));
        }
        return texts.get(file);
    };
    const lineStarts = new Map();
    /** 1-based line and column of an offset, and the text of that line. */
    const positionOf = (file, offset) => {
        const text = textOf(file);
        if (!lineStarts.has(file)) {
            const starts = [ 0 ];
            for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
            lineStarts.set(file, starts);
        }
        const starts = lineStarts.get(file);
        let low = 0, high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= offset) low = middle;
            else high = middle - 1;
        }
        const end = low + 1 < starts.length ? starts[low + 1] - 1 : text.length;
        return { line: low + 1, column: offset - starts[low] + 1, lineText: text.slice(starts[low], end).replace(/\r$/, "") };
    };

    return {
        packages, ts, ng: packages.ng, root, tsconfig, tsconfigName, otherConfigs: located.otherConfigs, project, service, program,
        checker: program.getTypeChecker(),
        strictInputAccessForced, strictTemplatesForced, textOf, positionOf, fileKey,
        templateRegions: new Map(),
        opaqueTemplates: new Map(),
        brokenTemplates: new Set(),
        relative: file => slash(path.relative(root, file)),
        /**
         * The project's own sources: every .ts file of the program outside node_modules (a config may list one entry file
         * only). Once the service has analysed the project the program also holds the external templates and the
         * type-check files: neither is a source file …
         */
        sourceFiles: () => service.getProgram().getSourceFiles().filter(sourceFile => !sourceFile.isDeclarationFile).map(sourceFile => slash(sourceFile.fileName)).filter(file => TS_FILE.test(file) && !file.includes("/node_modules/") && !file.includes(".ngtypecheck.")),
        /** … and, once the service has analysed the project, its external templates. */
        externalTemplates: () => project.getScriptInfos().map(info => slash(info.fileName)).filter(file => !TS_FILE.test(file) && /\.(html?|svg)$/.test(file) && !file.includes("/node_modules/")),
        dispose() {
            for (const timer of timers) clearTimeout(timer);
            for (const immediate of immediates) clearImmediate(immediate);
        }
    };
}

// ---------------------------------------------------------------- templates: where a reference is

/**
 * Attribute names of every start tag in a template: offset of the name -> { end, tag, tagStart, form, element, property }.
 * `element` is what a selector is matched against (the tag and its attributes); `property` says that a bound attribute sets
 * a property ([name] or [(name)]), not a class, a style or an attribute. `errors` counts what the parser could not read.
 */
function attributeKeys(ng, text, file, range) {
    const keys = new Map();
    const setsProperty = input => input.type === ng.BindingType.Property || input.type === ng.BindingType.TwoWay;
    const collect = (element, tagStart, attributes, form) => {
        for (const attribute of attributes) {
            if (attribute.keySpan) keys.set(attribute.keySpan.start.offset, { end: attribute.keySpan.end.offset, tag: element.tag, tagStart, form, element, property: form === "bound" && setsProperty(attribute) });
        }
    };
    const collectAll = (tag, node) => {
        const tagStart = node.startSourceSpan.start.offset;
        const element = { tag, attributes: node.attributes.map(attribute => [ attribute.name, attribute.value ?? "" ]), inputs: node.inputs.filter(setsProperty).map(input => input.name) };
        collect(element, tagStart, node.outputs, "event");
        collect(element, tagStart, node.inputs, "bound");
        collect(element, tagStart, node.attributes, "static");
    };
    const visitor = new (class extends ng.TmplAstRecursiveVisitor {
        visitElement(element) {
            collectAll(element.name, element);
            super.visitElement(element);
        }
        visitTemplate(template) {
            if (template.tagName === "ng-template") collectAll("ng-template", template);
            super.visitTemplate(template);
        }
    })();
    let errors = 0;
    try {
        const parsed = ng.parseTemplate(text, file, { preserveWhitespaces: true, ...(range ? { range, escapedString: true } : {}) });
        errors = parsed.errors?.length ?? 0;
        ng.tmplAstVisitAll(visitor, parsed.nodes);
    } catch {
        // a template the parser gives up on has no attribute names to offer; its references count as expressions
        errors = 1;
    }
    return { keys, errors };
}

/** The template regions of a file: the whole file for a template file, the `template:` strings of decorators for a .ts file. */
function templateRegionsOf(workspace, file) {
    if (workspace.templateRegions.has(file)) return workspace.templateRegions.get(file);
    const { ts, ng } = workspace;
    const text = workspace.textOf(file);
    const regions = [];
    const add = (region, range) => {
        const { keys, errors } = attributeKeys(ng, text, file, range);
        if (errors) workspace.brokenTemplates.add(file);
        regions.push({ ...region, keys });
    };
    if (!TS_FILE.test(file)) {
        add({ start: 0, end: text.length, external: true });
    } else if (text.includes("template")) {
        const sourceFile = workspace.program.getSourceFile(file) ?? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const opaque = [];
        const visit = node => {
            // The key may be quoted ("template": …). A template that is not one plain string (`…${x}…`, "a" + b) is not read
            // by the service at all: kept apart, so that the name inside it can be reported instead of passed over.
            if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) && node.name.text === "template" && ts.findAncestor(node, ts.isDecorator)) {
                if (ts.isStringLiteralLike(node.initializer)) {
                    const start = node.initializer.getStart(sourceFile) + 1, end = node.initializer.end - 1;
                    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
                    add({ start, end, external: false }, { startPos: start, startLine: line, startCol: character, endPos: end });
                } else if (!ts.isIdentifier(node.initializer)) opaque.push({ start: node.initializer.getStart(sourceFile), end: node.initializer.end });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        if (opaque.length) workspace.opaqueTemplates.set(file, opaque);
    }
    workspace.templateRegions.set(file, regions);
    return regions;
}

/**
 * One place the service pointed at: the offset of the NAME, what is written there and what kind of place it is.
 * For an input of a generic component the service also returns the whole attribute (`[name]="…"`): narrowed to the name.
 */
function placeOf(workspace, fileName, textSpan) {
    const file = slash(fileName), text = workspace.textOf(file);
    const spanText = text.slice(textSpan.start, textSpan.start + textSpan.length);
    const region = templateRegionsOf(workspace, file).find(candidate => textSpan.start >= candidate.start && textSpan.start < candidate.end);
    if (!region) return { file, offset: textSpan.start, name: spanText, kind: "class-read", on: null, form: null, inline: false, whole: false };
    const whole = !IDENTIFIER.test(spanText);
    let offset = textSpan.start;
    if (whole) {
        const inside = [ ...region.keys.keys() ].filter(key => key >= textSpan.start && key < textSpan.start + textSpan.length);
        offset = inside.length ? Math.min(...inside) : textSpan.start + /^[^\w$]*/.exec(spanText)[0].length;
    }
    const key = region.keys.get(offset);
    const name = key ? text.slice(offset, key.end) : whole ? /^[\w$]*/.exec(text.slice(offset))[0] : spanText;
    if (!key) return { file, offset, name, kind: "template-read", on: null, form: null, inline: !region.external, whole };
    const form = key.form === "bound" && text.slice(offset - 2, offset) === "[(" ? "two-way" : key.form;
    return { file, offset, name, kind: form === "static" ? "static" : "binding", on: key.tag, tagStart: key.tagStart, form, inline: !region.external, whole };
}

// ---------------------------------------------------------------- the class and its member (TypeScript AST and checker)

function findClasses(workspace, className) {
    const { ts, program } = workspace;
    const found = [];
    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(".ngtypecheck.") || sourceFile.fileName.includes("/node_modules/")) continue;
        if (className !== undefined && !sourceFile.text.includes(className)) continue;
        const visit = node => {
            if (ts.isClassDeclaration(node) && node.name && (className === undefined || node.name.text === className)) found.push({ sourceFile, node });
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    return found;
}

const nameOfMember = (ts, node) => (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name)) ? node.name.text : undefined);

/** Named members a class declares itself, constructor parameter properties included. */
function ownMembers(ts, classNode) {
    return classNode.members.flatMap(member => {
        if (ts.isConstructorDeclaration(member)) return member.parameters.filter(parameter => ts.getModifiers(parameter)?.length && nameOfMember(ts, parameter));
        return nameOfMember(ts, member) ? [ member ] : [];
    });
}

/** What a member is, in the words of its author: input(), @Input(), field, method … and its modifiers. */
function describeMember(ts, member) {
    const sourceFile = member.getSourceFile();
    const decorators = (ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []).map(decorator => /^\w+/.exec(decorator.expression.getText(sourceFile))?.[0]);
    const initializer = ts.isPropertyDeclaration(member) ? member.initializer?.getText(sourceFile) ?? "" : "";
    const factory = /^(input|model|output)(\.required)?\s*[<(]/.exec(initializer)?.[1];
    const kind = decorators.includes("Input") ? "@Input()"
        : decorators.includes("Output") ? "@Output()"
        : factory ? `${factory}()`
        : ts.isParameter(member) ? "constructor parameter"
        : ts.isMethodDeclaration(member) ? "method"
        : ts.isGetAccessor(member) || ts.isSetAccessor(member) ? "accessor"
        : "field";
    const modifiers = (ts.canHaveModifiers(member) ? ts.getModifiers(member) ?? [] : []).map(modifier => modifier.getText(sourceFile));
    // the public name of an input when it is not the member's own: input(…, { alias: "x" }), @Input("x"), @Input({ alias: "x" })
    const inputDecorator = (ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []).map(decorator => decorator.expression.getText(sourceFile)).find(text => /^Input\b/.test(text)) ?? "";
    const alias = /\balias\s*:\s*["'`]([^"'`]+)["'`]/.exec(factory ? initializer : inputDecorator)?.[1] ?? /^Input\(\s*["'`]([^"'`]+)["'`]/.exec(inputDecorator)?.[1] ?? null;
    return { kind, modifiers, alias };
}

/** Does the class behind `classNode` extend the class `base`, directly or through other classes? Asked from the type checker. */
function inheritsFrom(workspace, classNode, base) {
    const { checker } = workspace;
    const symbol = classNode.name && checker.getSymbolAtLocation(classNode.name);
    const wanted = base.name && checker.getSymbolAtLocation(base.name);
    if (!symbol || !wanted || symbol === wanted) return false;
    const seen = new Set();
    const reaches = type => {
        if (seen.has(type)) return false;
        seen.add(type);
        return (type.getBaseTypes?.() ?? []).some(parent => parent.getSymbol() === wanted || reaches(parent));
    };
    try {
        return reaches(checker.getDeclaredTypeOfSymbol(symbol));
    } catch {
        return false;
    }
}

const classOfMember = (ts, member) => (ts.isParameter(member) ? member.parent.parent : member.parent);

/**
 * `Class.member` -> the declaration the references are asked from; a member the class inherits is followed to its declaring
 * class. `path/file.ts#Class.member` picks the class of that file when two classes share a name; `unambiguous` refuses to guess.
 */
function resolveTarget(workspace, targetText, { unambiguous = false } = {}) {
    const { ts, checker } = workspace;
    const whole = String(targetText ?? "");
    const fileHint = whole.includes("#") ? slash(whole.slice(0, whole.lastIndexOf("#"))).replace(/^\.\//, "") : null;
    const [ className, memberName, ...extra ] = whole.slice(whole.lastIndexOf("#") + 1).split(".");
    if (!className || !memberName || extra.length) throw new UsageError(`expected <Class>.<member> (or <file>#<Class>.<member>), got "${whole}"`);
    const named = findClasses(workspace, className);
    const inFile = candidate => fileHint === null || `/${workspace.relative(candidate.sourceFile.fileName)}`.toLowerCase().endsWith(`/${fileHint}`.toLowerCase());
    const classes = named.filter(inFile);
    if (named.length && !classes.length) throw new UsageError(`no class "${className}" in a file ${fileHint}: it is declared in ${named.map(other => workspace.relative(other.sourceFile.fileName)).join(", ")}`);
    if (classes.length > 1 && unambiguous) throw new UsageError(`${classes.length} classes are named ${className}: say which one, as ${classes.map(other => `${workspace.relative(other.sourceFile.fileName)}#${className}.${memberName}`).join(" or ")}`);
    if (classes.length === 0) {
        const all = [ ...new Set(findClasses(workspace).map(candidate => candidate.node.name.text)) ];
        const wanted = className.toLowerCase().replace(/(component|directive|service)$/, "");
        const close = all.filter(name => name.toLowerCase().includes(wanted) || wanted.includes(name.toLowerCase().replace(/(component|directive|service)$/, ""))).sort(naturalOrder);
        throw new UsageError(`no class "${className}" in the project (${workspace.tsconfigName}, ${all.length} classes).${close.length ? ` Close names: ${close.slice(0, 12).join(", ")}${close.length > 12 ? ", …" : ""}.` : ""}`);
    }
    const [ cls, ...others ] = classes;
    const notes = [];
    if (others.length) notes.push(`${classes.length} classes are named ${className}: this is the one in ${workspace.relative(cls.sourceFile.fileName)}; for another write ${others.map(other => `${workspace.relative(other.sourceFile.fileName)}#${className}.${memberName}`).join(" or ")}`);

    const symbol = checker.getSymbolAtLocation(cls.node.name);
    const instanceType = symbol ? checker.getDeclaredTypeOfSymbol(symbol) : undefined;
    const staticType = symbol ? checker.getTypeOfSymbolAtLocation(symbol, cls.node) : undefined;
    const usable = declaration => declaration?.name && (ts.isClassElement(declaration) || ts.isParameter(declaration)) && ts.isClassLike(classOfMember(ts, declaration));
    let member = ownMembers(ts, cls.node).find(candidate => nameOfMember(ts, candidate) === memberName);
    if (!member) {
        const inherited = instanceType?.getProperty(memberName) ?? staticType?.getProperty(memberName);
        member = [ inherited?.valueDeclaration, ...(inherited?.declarations ?? []) ].find(usable);
    }
    if (!member) {
        const own = ownMembers(ts, cls.node).map(candidate => `${nameOfMember(ts, candidate)} (${describeMember(ts, candidate).kind})`);
        const inherited = new Map();
        for (const property of instanceType?.getProperties() ?? []) {
            const declaration = [ property.valueDeclaration, ...(property.declarations ?? []) ].find(usable);
            if (!declaration || declaration.getSourceFile().isDeclarationFile || classOfMember(ts, declaration) === cls.node) continue;
            const owner = classOfMember(ts, declaration).name?.text ?? "a base class";
            inherited.set(owner, [ ...(inherited.get(owner) ?? []), property.name ]);
        }
        const position = workspace.positionOf(slash(cls.sourceFile.fileName), cls.node.name.getStart(cls.sourceFile));
        throw new UsageError([
            `${className} (${workspace.relative(cls.sourceFile.fileName)}:${position.line}) has no member "${memberName}".`,
            `Members: ${[ ...new Set(own) ].join(", ") || "none of its own"}.`,
            ...[ ...inherited ].map(([ owner, names ]) => `Inherited from ${owner}: ${names.join(", ")}.`)
        ].join("\n"));
    }

    const declaringClass = classOfMember(ts, member);
    const sourceFile = member.getSourceFile();
    const file = slash(sourceFile.fileName);
    const position = member.name.getStart(sourceFile);
    const { kind, modifiers, alias } = describeMember(ts, member);
    return {
        className, memberName, kind, modifiers, alias, file, position, notes,
        line: workspace.positionOf(file, position).line,
        declaredIn: declaringClass.name?.text ?? className,
        selector: ts.isClassDeclaration(declaringClass) ? selectorOf(ts, declaringClass) : null,
        isInput: INPUT_KINDS.has(kind),
        inLibrary: sourceFile.isDeclarationFile || file.includes("/node_modules/"),
        declaringClass
    };
}

/** "<class behind the tag>, extends <class that declares the member>" for a tag, when the service knows its class. */
function ownerOfTag(workspace, target, place, cache) {
    if (cache.has(place.on)) return cache.get(place.on);
    const { ts } = workspace;
    let owner = null;
    try {
        const info = workspace.service.getQuickInfoAtPosition(place.file, place.tagStart + 1);
        const name = /^\((?:component|directive)\)\s+([\w$]+)/.exec(info?.displayParts?.map(part => part.text).join("") ?? "")?.[1];
        if (name && name !== target.declaredIn) {
            let current = findClasses(workspace, name)[0]?.node, inherits = false;
            for (let depth = 0; current && depth < 12 && !inherits; depth++) {
                const base = current.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0].expression.getText(current.getSourceFile());
                inherits = base === target.declaredIn;
                current = base ? findClasses(workspace, base)[0]?.node : undefined;
            }
            owner = inherits ? `${name}, extends ${target.declaredIn}` : name;
        }
    } catch {
        // no owner to show
    }
    cache.set(place.on, owner);
    return owner;
}

// ---------------------------------------------------------------- references

const keyOfPlace = place => `${place.file}@${place.offset}`;
const labelOfGroup = place => (place.kind === "declaration" ? "declaration"
    : place.kind === "binding" ? `${place.form} on <${place.on}>`
    : place.kind === "static" ? `static attribute on <${place.on}>`
    : place.kind === "template-read" ? "read in a template expression"
    : "TypeScript code");
const wordPattern = (word, flags = "") => new RegExp(`(?<![\\w$])${escapeRegExp(word)}(?![\\w$])`, flags);
const shownPlaces = (workspace, places, most = 4) => `${places.slice(0, most).map(place => `${workspace.relative(place.file)}:${place.line}${place.name ? ` ${place.name}` : ""}`).join(", ")}${places.length > most ? ", …" : ""}`;

/** The selector a class is given in its @Component / @Directive decorator, as written. */
function selectorOf(ts, node) {
    return /selector\s*:\s*["'`]([^"'`]+)["'`]/.exec((ts.getDecorators(node) ?? []).map(decorator => decorator.getText(node.getSourceFile())).join("\n"))?.[1] ?? null;
}

/**
 * Bindings of an input that the service did not return, found with the template parser: an attribute with the input's name
 * on an element that matches the selector of the declaring class or of a class that extends it. The service loses these for
 * an input declared with a transform in a decorator, and in a template it does not type-check; the compiler reports the
 * bound form afterwards, the static form (a plain attribute) nobody would.
 */
function bindingsFromParser(workspace, target, known) {
    const { ts, ng } = workspace;
    if (!target.isInput || target.alias || !ts.isClassDeclaration(target.declaringClass)) return [];
    const matcher = new ng.SelectorMatcher();
    let selectables = 0;
    for (const { node } of findClasses(workspace)) {
        const selector = selectorOf(ts, node);
        if (!selector || (node !== target.declaringClass && !inheritsFrom(workspace, node, target.declaringClass))) continue;
        try {
            matcher.addSelectables(ng.CssSelector.parse(selector), node.name.text);
            selectables++;
        } catch {
            // a selector the parser does not accept matches nothing
        }
    }
    if (!selectables) return [];
    const found = [];
    for (const file of [ ...workspace.sourceFiles(), ...workspace.externalTemplates() ]) {
        const text = workspace.textOf(file);
        if (!text.includes(target.memberName)) continue;
        for (const region of templateRegionsOf(workspace, file)) {
            for (const [ offset, key ] of region.keys) {
                if (known.has(`${file}@${offset}`) || text.slice(offset, key.end) !== target.memberName || (key.form !== "static" && !key.property)) continue;
                const selector = new ng.CssSelector();
                selector.setElement(key.element.tag);
                for (const [ name, value ] of key.element.attributes) selector.addAttribute(name, value);
                for (const name of key.element.inputs) selector.addAttribute(name, "");
                let owner = null;
                matcher.match(selector, (_selector, className) => {
                    owner ??= className;
                });
                if (!owner) continue;
                const form = key.form === "bound" && text.slice(offset - 2, offset) === "[(" ? "two-way" : key.form;
                found.push({ file, offset, name: target.memberName, kind: form === "static" ? "static" : "binding", on: key.tag, tagStart: key.tagStart, form, inline: !region.external, whole: false, fromParser: owner });
            }
        }
    }
    return found;
}

/** Every distinct place of the member, the declaration first: what the service returns, plus what only the parser sees. */
function collectPlaces(workspace, target) {
    const entries = (workspace.service.getReferencesAtPosition(target.file, target.position) ?? []).filter(entry => !entry.fileName.includes(".ngtypecheck."));
    const byKey = new Map();
    let whole = 0;
    for (const entry of entries) {
        const place = placeOf(workspace, entry.fileName, entry.textSpan);
        if (place.whole) whole++;
        if (!byKey.has(keyOfPlace(place))) byKey.set(keyOfPlace(place), place);
    }
    const declarationKey = `${target.file}@${target.position}`;
    byKey.set(declarationKey, { ...(byKey.get(declarationKey) ?? { file: target.file, offset: target.position, name: target.memberName, on: null, form: null, inline: false, whole: false }), kind: "declaration" });
    const fromParser = bindingsFromParser(workspace, target, new Set(byKey.keys()));
    for (const place of fromParser) byKey.set(keyOfPlace(place), place);
    const places = [ ...byKey.values() ].sort((left, right) => naturalOrder(left.file, right.file) || left.offset - right.offset);
    for (const place of places) Object.assign(place, workspace.positionOf(place.file, place.offset));
    return { places, returned: entries.length, whole, fromParser };
}

function groupsOf(workspace, target, places) {
    const owners = new Map();
    const groups = [ ...Map.groupBy(places, labelOfGroup) ].map(([ label, list ]) => ({
        label, kind: list[0].kind, on: list[0].on,
        owner: list[0].on && list[0].tagStart !== undefined ? ownerOfTag(workspace, target, list[0], owners) : null,
        count: list.length,
        inline: list.filter(place => place.inline).length,
        places: list
    }));
    return groups.sort((left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) || right.count - left.count || naturalOrder(left.label, right.label));
}

/**
 * The same word in the project's files at places that are NOT a reference: attribute names per tag, and the rest. `unread`
 * lists the ones inside a template that is built from an expression, which neither the service nor the parser reads.
 */
function sameWordElsewhere(workspace, name, referenceKeys) {
    const pattern = wordPattern(name, "g");
    const attributes = new Map();
    const files = new Set();
    const unread = [];
    let other = 0;
    for (const file of [ ...workspace.sourceFiles(), ...workspace.externalTemplates() ]) {
        const text = workspace.textOf(file);
        if (!text.includes(name)) continue;
        const regions = templateRegionsOf(workspace, file);
        const opaque = workspace.opaqueTemplates.get(file) ?? [];
        for (const match of text.matchAll(pattern)) {
            if (referenceKeys.has(`${file}@${match.index}`)) continue;
            files.add(file);
            const key = regions.find(region => match.index >= region.start && match.index < region.end)?.keys.get(match.index);
            if (key) attributes.set(key.tag, (attributes.get(key.tag) ?? 0) + 1);
            else other++;
            if (opaque.some(region => match.index >= region.start && match.index < region.end)) unread.push({ file, offset: match.index, ...workspace.positionOf(file, match.index) });
        }
    }
    const onTags = [ ...attributes ].sort((left, right) => right[1] - left[1]).map(([ tag, count ]) => ({ tag, count }));
    return { total: other + onTags.reduce((sum, entry) => sum + entry.count, 0), files: files.size, attributes: onTags, other, unread };
}

/**
 * The other tsconfig files of the workspace (next to this one, or referenced from it or from the root tsconfig.json), each
 * with the source files that only it lists and that hold `word`: spec files, mostly. This project's answer does not cover them.
 */
function otherProjectsHolding(workspace, word) {
    const { ts, root, fileKey } = workspace;
    const candidates = new Map(workspace.otherConfigs.map(name => [ fileKey(path.join(root, name)), slash(path.join(root, name)) ]));
    for (const config of [ workspace.tsconfig, slash(path.join(root, "tsconfig.json")) ]) {
        if (!existsSync(config)) continue;
        for (const reference of ts.readConfigFile(config, ts.sys.readFile).config?.references ?? []) {
            const referenced = slash(path.resolve(path.dirname(config), String(reference?.path ?? "")));
            const file = referenced.endsWith(".json") ? referenced : `${referenced}/tsconfig.json`;
            candidates.set(fileKey(file), file);
        }
    }
    candidates.delete(fileKey(workspace.tsconfig));
    const own = new Set(workspace.program.getSourceFiles().map(sourceFile => fileKey(sourceFile.fileName)));
    const pattern = wordPattern(word);
    const found = [];
    for (const tsconfig of candidates.values()) {
        if (!existsSync(tsconfig)) continue;
        const parsed = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
        const files = (parsed?.fileNames ?? []).map(slash).filter(file => !DECLARATION_FILE.test(file) && !file.includes("/node_modules/") && !own.has(fileKey(file)) && pattern.test(ts.sys.readFile(file) ?? ""));
        if (files.length) found.push({ tsconfig, name: slash(path.relative(root, tsconfig)), files });
    }
    return found;
}

const outsideFiles = (workspace, other) => `${other.name} lists ${plural(other.files.length, "file")} that ${workspace.tsconfigName} does not and that hold${other.files.length === 1 ? "s" : ""} the name (${other.files.slice(0, 3).map(workspace.relative).join(", ")}${other.files.length > 3 ? ", …" : ""})`;

const plainTarget = (workspace, target) => ({ class: target.className, member: target.memberName, kind: target.kind, modifiers: target.modifiers, alias: target.alias, declaredIn: target.declaredIn, selector: target.selector, file: workspace.relative(target.file), line: target.line });
const plainPlace = (workspace, place) => ({ file: workspace.relative(place.file), line: place.line, column: place.column, offset: place.offset, kind: place.kind, on: place.on, form: place.form, inline: place.inline, text: place.lineText.trim() });
const plainGroups = (workspace, groups) => groups.map(group => ({ label: group.label, kind: group.kind, on: group.on, owner: group.owner, count: group.count, inline: group.inline, places: group.places.map(place => plainPlace(workspace, place)) }));

/** Notes that every answer about a member starts with: what the tool had to do to get a complete answer, and what it could not do. */
function notesFor(workspace, target, collected, elsewhere) {
    const notes = [ ...target.notes ];
    const name = `${target.declaredIn}.${target.memberName}`;
    if (target.declaredIn !== target.className) notes.push(`${target.className} inherits ${target.memberName} from ${target.declaredIn}: these are the references of that one declaration`);
    const restricted = target.modifiers.filter(modifier => RESTRICTED_MODIFIERS.includes(modifier));
    if (workspace.strictInputAccessForced && target.isInput && restricted.length)
        notes.push(`${name} is a ${restricted.join(" ")} input and ${workspace.tsconfigName} does not set strictInputAccessModifiers: the service then sees no template binding, so the option was switched on in memory for this answer (nothing written)`);
    if (workspace.strictTemplatesForced)
        notes.push(`${workspace.tsconfigName} sets strictTemplates to false: the service then returns no binding inside @if / @for blocks and ng-templates, so the option was switched on in memory for this answer (nothing written)`);
    if (collected.returned > collected.places.length - collected.fromParser.length || collected.whole)
        notes.push(`the service returned ${collected.returned} entries for ${plural(collected.places.length - collected.fromParser.length, "place")} (${collected.whole} as a whole attribute, not the name): every place is counted once, at the name`);
    if (collected.fromParser.length) {
        const tags = [ ...Map.groupBy(collected.fromParser, place => `<${place.on}> (${place.fromParser})`) ].map(([ tag, list ]) => `${tag} ×${list.length}`).join(", ");
        notes.push(`${plural(collected.fromParser.length, "binding")} of ${target.memberName} on ${tags} ${collected.fromParser.length === 1 ? "was" : "were"} not among the service's references: found with the template parser, by the selector of ${target.declaredIn} and of the classes that extend it, and added — look at them (${shownPlaces(workspace, collected.fromParser, 3)})`);
    }
    const broken = [ ...new Set(collected.places.map(place => place.file).filter(file => workspace.brokenTemplates.has(file))) ];
    if (broken.length) notes.push(`${plural(broken.length, "template")} with syntax errors (${broken.slice(0, 3).map(workspace.relative).join(", ")}${broken.length > 3 ? ", …" : ""}): the places in ${broken.length === 1 ? "it" : "them"} are found, but a binding there may be listed as a read`);
    if (elsewhere.unread.length)
        notes.push(`${plural(elsewhere.unread.length, "occurrence")} of "${target.memberName}" in a template that is built from an expression (\`…\${x}…\` or a concatenation): the service does not read such a template, so ${elsewhere.unread.length === 1 ? "it is" : "they are"} not among the references — look by hand: ${shownPlaces(workspace, elsewhere.unread)}`);
    return notes;
}

function referencesOf(workspace, targetText, options) {
    const target = resolveTarget(workspace, targetText, options);
    const collected = collectPlaces(workspace, target);
    const elsewhere = sameWordElsewhere(workspace, target.memberName, new Set(collected.places.map(keyOfPlace)));
    return { target, collected, places: collected.places, elsewhere, notes: notesFor(workspace, target, collected, elsewhere) };
}

/** What `refs` says about the other projects of the workspace: their files are not part of this answer. */
const otherProjectNotes = (workspace, target) => otherProjectsHolding(workspace, target.memberName).map(other => `${outsideFiles(workspace, other)}: not part of this answer — refs with --project ${other.name} lists their references; rename covers them`);

/**
 * Every reference of `Class.member` in the workspace at `root`, as plain data:
 * { target, references: [ { file, line, column, offset, kind, on, form, inline, text } ], groups, files, sameWordElsewhere, notes }.
 * kind: "declaration" | "binding" | "static" | "template-read" | "class-read"; on: the element tag of a binding, else null.
 */
export function refs(root, targetText, { project } = {}) {
    const workspace = openWorkspace(root, { project, forceStrict: true });
    try {
        const { target, places, elsewhere, notes } = referencesOf(workspace, targetText);
        return {
            target: plainTarget(workspace, target),
            references: places.map(place => plainPlace(workspace, place)),
            groups: plainGroups(workspace, groupsOf(workspace, target, places)),
            files: new Set(places.map(place => place.file)).size,
            sameWordElsewhere: { ...elsewhere, unread: elsewhere.unread.map(place => ({ file: workspace.relative(place.file), line: place.line })) },
            notes: [ ...notes, ...otherProjectNotes(workspace, target) ]
        };
    } finally {
        workspace.dispose();
    }
}

// ---------------------------------------------------------------- rename

/** The innermost TypeScript node at an offset. */
function nodeAt(ts, sourceFile, offset) {
    let found;
    const visit = node => {
        if (offset < node.getStart(sourceFile) || offset >= node.end) return;
        found = node;
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}

/** `{ name }` (an object literal or a destructuring pattern) must become `{ newName: name }`: the local name stays. */
function isShorthand(workspace, place) {
    const { ts } = workspace;
    const sourceFile = workspace.program.getSourceFile(place.file);
    const node = sourceFile && nodeAt(ts, sourceFile, place.offset);
    if (!node?.parent) return false;
    return (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node)
        || (ts.isBindingElement(node.parent) && !node.parent.propertyName && node.parent.name === node && ts.isObjectBindingPattern(node.parent.parent));
}

/** A place in TypeScript code that names a local variable or parameter, not a member. */
function isLocalName(workspace, place) {
    const { ts, checker } = workspace;
    if (place.kind !== "class-read") return false;
    const sourceFile = workspace.program.getSourceFile(place.file);
    const node = sourceFile && nodeAt(ts, sourceFile, place.offset);
    const symbol = node && ts.isIdentifier(node) && !isShorthand(workspace, place) ? checker.getSymbolAtLocation(node) : undefined;
    return Boolean(symbol && symbol.flags & ts.SymbolFlags.Variable);
}

/** The rename inside one project: the edits, and the references that are written under another name. */
function planOf(workspace, targetText, newName, options) {
    const { target, places, notes } = referencesOf(workspace, targetText, options);
    const { ts, service, checker } = workspace;
    const name = `${target.declaredIn}.${target.memberName}`;
    if (!IDENTIFIER.test(String(newName ?? ""))) throw new UsageError(`"${newName ?? ""}" is not a name a class member can have`);
    if (newName === target.memberName) throw new UsageError(`${name} already has that name`);
    if (target.inLibrary) throw new UsageError(`${name} is declared in ${workspace.relative(target.file)}, outside the project's own sources: it cannot be renamed here`);
    const declaringSymbol = target.declaringClass.name && checker.getSymbolAtLocation(target.declaringClass.name);
    if (declaringSymbol && checker.getDeclaredTypeOfSymbol(declaringSymbol).getProperty(newName)) throw new UsageError(`${target.declaredIn} already has a member "${newName}"`);
    // a class that extends the declaring one may have the new name already: the two members would become one
    const taken = findClasses(workspace).filter(({ node }) => inheritsFrom(workspace, node, target.declaringClass) && ownMembers(ts, node).some(member => nameOfMember(ts, member) === newName));
    if (taken.length) throw new UsageError(`${taken.map(({ node }) => node.name.text).join(", ")} (${taken.length === 1 ? "extends" : "extend"} ${target.declaredIn}) already ${taken.length === 1 ? "has" : "have"} a member "${newName}"`);

    // What the service itself would rename. It gives up on the whole rename when one location does not map back to the
    // name (generic components), and may return fewer places than it has references: the references are the base then.
    const info = service.getRenameInfo(target.file, target.position, {});
    const locations = info.canRename ? (service.findRenameLocations(target.file, target.position, false, false, {}) ?? []).filter(location => !location.fileName.includes(".ngtypecheck.")) : [];
    const fromService = new Map();
    for (const location of locations) {
        const place = { ...placeOf(workspace, location.fileName, location.textSpan), prefixText: location.prefixText, suffixText: location.suffixText };
        if (!fromService.has(keyOfPlace(place))) fromService.set(keyOfPlace(place), place);
    }
    // Places only the service's rename has. Without the prefix/suffix preference (the plugin does not pass it on) TypeScript
    // renames a local name bound by shorthand ({ name } = pill) together with the member: such a local keeps its name here,
    // the shorthand is written out instead. Anything else the service wants renamed is taken over.
    const byKey = new Map(places.map(place => [ keyOfPlace(place), place ]));
    let localNames = 0;
    for (const [ key, place ] of fromService) {
        if (byKey.has(key)) Object.assign(byKey.get(key), { prefixText: place.prefixText, suffixText: place.suffixText });
        else if (isLocalName(workspace, place)) localNames++;
        else byKey.set(key, { ...place, ...workspace.positionOf(place.file, place.offset) });
    }
    const all = [ ...byKey.values() ].sort((left, right) => naturalOrder(left.file, right.file) || left.offset - right.offset);
    const renameable = all.filter(place => place.name === target.memberName);
    const covered = renameable.filter(place => fromService.has(keyOfPlace(place))).length;
    const source = covered === renameable.length ? "rename-locations" : "references";
    if (source === "references")
        notes.push(`findRenameLocations returned ${covered} of the ${plural(renameable.length, "referenced place")}${info.canRename ? "" : ` (${info.localizedErrorMessage ?? "it refuses this rename"})`}: the rename is built from the references instead`);

    // References written under another name. An alias stays as it is. The event of a model() — (<name>Change) — follows the
    // member. Any other name is derived from the member's by Angular (a key of a structural directive, say): renaming the
    // member breaks that binding, and this tool does not know the new spelling.
    const otherNames = all.filter(place => place.name !== target.memberName);
    const aliased = otherNames.filter(place => target.alias !== null && place.name === target.alias);
    const events = otherNames.filter(place => target.kind === "model()" && place.form === "event" && place.name === `${target.memberName}Change`);
    const derived = otherNames.filter(place => !aliased.includes(place) && !events.includes(place));
    if (aliased.length) notes.push(`${plural(aliased.length, "binding")} use${aliased.length === 1 ? "s" : ""} the alias "${target.alias}", which stays: nothing to rename there`);
    if (events.length) notes.push(`${plural(events.length, "event binding")} (${target.memberName}Change) of this model() ${events.length === 1 ? "becomes" : "become"} (${newName}Change)`);
    if (derived.length) notes.push(`${plural(derived.length, "place")} bind${derived.length === 1 ? "s" : ""} ${name} under a name derived from it and ${derived.length === 1 ? "is" : "are"} NOT renamed: ${shownPlaces(workspace, derived)} — after the rename ${derived.length === 1 ? "it no longer binds" : "they no longer bind"}; fix by hand`);
    // the old way to widen the type an input accepts is a static member named after it: it follows the input
    const acceptName = `ngAcceptInputType_${target.memberName}`;
    const accept = target.isInput ? ownMembers(ts, target.declaringClass).find(member => nameOfMember(ts, member) === acceptName) : undefined;
    if (accept) {
        const offset = accept.name.getStart(accept.getSourceFile());
        events.push({ file: target.file, offset, name: acceptName, kind: "class-read", on: null, form: null, inline: false, whole: false, ...workspace.positionOf(target.file, offset), follows: `ngAcceptInputType_${newName}` });
        notes.push(`the static member ${acceptName} of ${target.declaredIn} becomes ngAcceptInputType_${newName}`);
    }

    let shorthands = 0;
    const edits = [
        ...renameable.map(place => {
            const shorthand = TS_FILE.test(place.file) && place.kind === "class-read" && !place.prefixText && !place.suffixText && isShorthand(workspace, place);
            if (shorthand) shorthands++;
            return { ...place, length: target.memberName.length, newText: `${place.prefixText ?? ""}${newName}${place.suffixText ?? (shorthand ? `: ${target.memberName}` : "")}` };
        }),
        ...events.map(place => ({ ...place, length: place.name.length, newText: place.follows ?? `${newName}Change` }))
    ];
    if (shorthands) notes.push(`${plural(shorthands, "shorthand use")} ({ ${target.memberName} }) ${shorthands === 1 ? "becomes" : "become"} { ${newName}: ${target.memberName} }: the local name stays${localNames ? ` (${plural(localNames, "use")} of it untouched)` : ""}`);
    return { target, newName, edits, skipped: [ ...aliased, ...derived ], source, renameLocations: fromService.size, notes };
}

/**
 * The rename in the whole workspace: the project that was named, then every other tsconfig whose own files hold the name
 * (spec files, mostly), each loaded in turn. `projects` lists the tsconfig files that were covered besides the first.
 */
function planEverywhere(workspace, targetText, newName, options) {
    const plan = planOf(workspace, targetText, newName, options);
    const known = new Set([ ...plan.edits, ...plan.skipped ].map(keyOfPlace));
    const exactTarget = `${workspace.relative(plan.target.file)}#${plan.target.declaredIn}.${plan.target.memberName}`;
    plan.projects = [];
    for (const other of otherProjectsHolding(workspace, plan.target.memberName)) {
        let second;
        try {
            second = openWorkspace(workspace.root, { project: other.name, forceStrict: true });
            const more = planOf(second, exactTarget, newName);
            const fresh = list => list.filter(place => !known.has(keyOfPlace(place)));
            const edits = fresh(more.edits), skipped = fresh(more.skipped);
            for (const place of [ ...edits, ...skipped ]) known.add(keyOfPlace(place));
            plan.edits.push(...edits);
            plan.skipped.push(...skipped);
            plan.projects.push({ name: other.name, tsconfig: other.tsconfig, edits: edits.length });
            plan.notes.push(`${outsideFiles(workspace, other)}: analysed as well, ${plural(edits.length, "more edit")} in ${plural(new Set(edits.map(edit => edit.file)).size, "file")}${skipped.length ? `, ${plural(skipped.length, "place")} under another name left (${shownPlaces(workspace, skipped)})` : ""}`);
        } catch (error) {
            if (!(error instanceof UsageError)) throw error;
            plan.notes.push(`${outsideFiles(workspace, other)}: NOT covered (${error.message.split("\n")[0]}) — look at them by hand`);
        } finally {
            second?.dispose();
        }
    }
    plan.edits.sort((left, right) => naturalOrder(left.file, right.file) || left.offset - right.offset);
    return plan;
}

/**
 * Writes the edits, last one first in every file; refuses a file that does not hold the old name where it was read, and
 * then writes nothing at all. The service reads a file without its byte order mark: the mark is set aside and put back.
 */
function applyEdits(edits) {
    const byFile = Map.groupBy(edits, edit => edit.file);
    const texts = new Map();
    for (const [ file, list ] of byFile) {
        const bytes = readFileSync(file);
        if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) throw new UsageError(`${file} is stored as UTF-16, this tool writes UTF-8 only: nothing written`);
        const stored = bytes.toString("utf8");
        const mark = stored.startsWith("﻿") ? "﻿" : "";
        let text = stored.slice(mark.length);
        for (const edit of [ ...list ].sort((left, right) => right.offset - left.offset)) {
            if (text.slice(edit.offset, edit.offset + edit.length) !== edit.name) throw new UsageError(`${file} on disk is not the text that was analysed (line ${edit.line}): nothing written`);
            text = text.slice(0, edit.offset) + edit.newText + text.slice(edit.offset + edit.length);
        }
        texts.set(file, mark + text);
    }
    for (const [ file, text ] of texts) writeFileSync(file, text);
    return byFile.size;
}

/** The compiler's verdict on the project that was renamed in, and on every other project the rename reached. */
function verdictsAfterWrite(workspace, plan) {
    const verdicts = [ compilerVerdict(workspace.packages, workspace.root, workspace.tsconfig, "ngc") ];
    for (const other of plan.projects) verdicts.push(compilerVerdict(workspace.packages, workspace.root, other.tsconfig, `ngc -p ${other.name}`));
    return verdicts;
}

/**
 * The rename of `Class.member` to `newName` at every reference, as plain data (nothing is written unless `write` is set):
 * { target, newName, edits: [ { file, line, column, offset, length, newText, kind, on, form, inline, text } ], groups, files,
 *   source: "rename-locations" | "references", renameLocations, skipped, projects, written, compiler, compilerClean, notes }.
 */
export function planRename(root, targetText, newName, { project, write = false } = {}) {
    const workspace = openWorkspace(root, { project, forceStrict: true });
    try {
        const plan = planEverywhere(workspace, targetText, newName, { unambiguous: write });
        const plainEdit = edit => ({ ...plainPlace(workspace, edit), length: edit.length, newText: edit.newText });
        const written = write ? applyEdits(plan.edits) > 0 : false;
        const verdicts = written ? verdictsAfterWrite(workspace, plan) : [];
        return {
            target: plainTarget(workspace, plan.target),
            newName,
            edits: plan.edits.map(plainEdit),
            groups: plainGroups(workspace, groupsOf(workspace, plan.target, plan.edits)),
            files: new Set(plan.edits.map(edit => edit.file)).size,
            source: plan.source,
            renameLocations: plan.renameLocations,
            skipped: plan.skipped.map(place => ({ ...plainPlace(workspace, place), name: place.name })),
            projects: plan.projects.map(other => other.name),
            written,
            compiler: written ? verdicts.map(verdict => verdict.text).join("\n") : null,
            compilerClean: written ? verdicts.every(verdict => verdict.clean) : null,
            notes: plan.notes
        };
    } finally {
        workspace.dispose();
    }
}

// ---------------------------------------------------------------- the compiler's verdict

/** Runs the workspace's ngc (no emit) on one tsconfig: its errors and warnings as { file, line, column, code, message, error }. */
function runCompiler(packages, root, tsconfig) {
    let ngc;
    try {
        const manifest = packages.locate("@angular/compiler-cli/package.json");
        ngc = path.resolve(path.dirname(manifest), JSON.parse(readFileSync(manifest, "utf8")).bin.ngc);
    } catch {
        return { list: [], failure: "@angular/compiler-cli not found in node_modules — run the compiler yourself" };
    }
    const run = spawnSync(process.execPath, [ ngc, "-p", tsconfig, "--noEmit" ], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
    const list = [ ...output.matchAll(/^(?:(.+?)[:(](\d+)[:,](\d+)\)? ?[-:] )?(error|warning) ((?:NG|TS)\d+): (.*)$/gm) ]
        .map(([ , file, line, column, level, code, message ]) => ({ file: file ? slash(file) : "", line, column, code, message, error: level === "error" }));
    const named = list.some(diagnostic => diagnostic.error);
    return { list, failure: run.status === 0 || named ? null : `failed without an error it could name — ${output.trim().split("\n")[0] || run.error?.message || `exit code ${run.status}`}` };
}

/** The compiler's answer in a few lines (the raw output of a broken workspace is huge): { text, clean }. */
function compilerVerdict(packages, root, tsconfig, label) {
    const { list, failure } = runCompiler(packages, root, tsconfig);
    if (failure) return { text: `${label}: ${failure}`, clean: false };
    const errors = list.filter(diagnostic => diagnostic.error);
    if (!errors.length) return { text: `${label}: 0 errors`, clean: true };
    const byCode = [ ...Map.groupBy(errors, error => error.code) ].map(([ code, group ]) => `${code} ×${group.length}`).join(", ");
    const kinds = [ ...Map.groupBy(errors, error => `${error.code} ${error.message}`).values() ].sort((left, right) => right.length - left.length);
    const shown = kinds.slice(0, 5).map(([ first, ...rest ]) => `  ${first.file ? `${first.file}:${first.line}:${first.column} ` : ""}${first.code} ${first.message}${rest.length ? ` (+${rest.length} more like it)` : ""}`);
    return { text: [ `${label}: ${plural(errors.length, "error")} in ${plural(new Set(errors.map(error => error.file)).size, "file")} — ${byCode}`, ...shown, ...(kinds.length > 5 ? [ `  … and ${kinds.length - 5} more kinds of error` ] : []) ].join("\n"), clean: false };
}

// ---------------------------------------------------------------- command line

function parseArgs(argv) {
    const flags = { root: ".", project: undefined, all: false, write: false, help: false };
    const positional = [];
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--root" || argument === "--project") {
            if (argv[index + 1] === undefined) throw new UsageError(`${argument} needs a value\n${USAGE}`);
            flags[argument.slice(2)] = argv[++index];
        } else if (argument === "--all" || argument === "--write" || argument === "--help") flags[argument.slice(2)] = true;
        else if (argument === "-h") flags.help = true;
        else if (argument.startsWith("--")) throw new UsageError(`unknown option ${argument}\n${USAGE}`);
        else positional.push(argument);
    }
    return { flags, positional };
}

const cut = text => (text.length > LINE_WIDTH ? `${text.slice(0, LINE_WIDTH - 1)}…` : text);
const whereOf = group => (group.kind === "declaration" || group.kind === "class-read" ? ""
    : group.inline === 0 ? " (in .html files)"
    : group.inline === group.count ? " (in inline templates)"
    : ` (${group.count - group.inline} in .html files, ${group.inline} in inline templates)`);
const headerOf = (workspace, target) => `${target.declaredIn}.${target.memberName} — ${[ ...target.modifiers, target.kind ].join(" ")}${target.alias ? ` with the alias "${target.alias}"` : ""}, declared at ${workspace.relative(target.file)}:${target.line}${target.selector ? `, selector ${target.selector}` : ""}`;

/** `check`: the compiler itself (ngc) on the project, its messages counted. Returns false when there is an error. */
function printCheck(flags, print, elapsed) {
    const { packages, root, tsconfig, tsconfigName } = locateProject(flags.root, flags.project);
    const { list, failure } = runCompiler(packages, root, tsconfig);
    const scope = `ngc -p ${tsconfigName}; ${elapsed()}`;
    if (failure) {
        print(`check: the compiler ${failure} (${scope})`);
        return false;
    }
    const errors = list.filter(diagnostic => diagnostic.error);
    const warnings = list.length - errors.length;
    if (!list.length) {
        print(`check: 0 errors (${scope})`);
        return true;
    }
    const byCode = [ ...Map.groupBy(list, diagnostic => diagnostic.code) ].sort((left, right) => right[1].length - left[1].length).map(([ code, group ]) => `${code} ×${group.length}`).join(", ");
    print(`check: ${plural(errors.length, "error")}${warnings ? ` and ${plural(warnings, "warning")}` : ""} in ${plural(new Set(list.map(diagnostic => diagnostic.file)).size, "file")} — ${byCode} (${scope})`);
    const kinds = [ ...Map.groupBy(list, diagnostic => `${diagnostic.code} ${diagnostic.message}`).values() ].sort((left, right) => right.length - left.length);
    for (const [ first, ...more ] of kinds.slice(0, SHOWN_DIAGNOSTICS)) {
        print(cut(`  ${String(more.length + 1).padStart(4)} × ${first.error ? "" : "warning "}${first.code} ${first.message}`));
        print(cut(`         ${first.file}:${first.line}:${first.column}${more.length ? `, ${more.slice(0, 3).map(diagnostic => `${diagnostic.file}:${diagnostic.line}`).join(", ")}${more.length > 3 ? `, … +${more.length - 3}` : ""}` : ""}`));
    }
    if (kinds.length > SHOWN_DIAGNOSTICS) print(`  … and ${kinds.length - SHOWN_DIAGNOSTICS} more kinds of message`);
    return errors.length === 0;
}

/** Answers one command on the standard output. Returns false when the compiler it ran reported an error. */
function main(argv) {
    const started = performance.now();
    const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)} s`;
    const { flags, positional } = parseArgs(argv);
    const [ command, ...rest ] = positional;
    const print = line => console.log(line);
    if (flags.help || command === "help") {
        print(HELP);
        return true;
    }
    if (![ "refs", "rename", "check" ].includes(command)) throw new UsageError(USAGE);
    if (command === "check") return printCheck(flags, print, elapsed);

    const workspace = openWorkspace(flags.root, { project: flags.project, forceStrict: true });
    const servedBy = `Angular Language Service ${workspace.packages.languageServiceVersion}, type-checked`;
    try {
        if (command === "refs") {
            const { target, places, elsewhere, notes } = referencesOf(workspace, rest[0]);
            const groups = groupsOf(workspace, target, places);
            print(headerOf(workspace, target));
            print(`${plural(places.length, "reference")} in ${plural(new Set(places.map(place => place.file)).size, "file")} (${servedBy}; ${elapsed()})`);
            for (const note of [ ...notes, ...otherProjectNotes(workspace, target) ]) print(`! ${note}`);
            for (const group of groups) {
                print(`${group.label}: ${group.count}${whereOf(group)}${group.owner ? ` — ${group.owner}` : ""}`);
                const shown = flags.all ? group.places : group.places.slice(0, SHOWN_PER_GROUP);
                for (const place of shown) print(cut(`  ${workspace.relative(place.file)}:${place.line}  ${place.lineText.trim()}`));
                if (group.count > shown.length) print(`  … +${group.count - shown.length} more (--all lists every one)`);
            }
            if (elsewhere.total) {
                const parts = [ elsewhere.attributes.length ? `attributes on ${elsewhere.attributes.map(entry => `<${entry.tag}> ×${entry.count}`).join(", ")}` : "", elsewhere.other ? `${elsewhere.other} in other code, comments and text` : "" ].filter(Boolean);
                print(`Same word elsewhere in the project, not a reference of this member: ${elsewhere.total} in ${plural(elsewhere.files, "file")} — ${parts.join("; ")}`);
            }
            print(`→ rename everywhere: ls-facts rename ${target.declaredIn}.${target.memberName} <newName> [--write]`);
            return true;
        }

        const plan = planEverywhere(workspace, rest[0], rest[1], { unambiguous: flags.write });
        const files = new Set(plan.edits.map(edit => edit.file)).size;
        // written first, said afterwards: a file that cannot be written stops the command before it claims anything
        if (flags.write) applyEdits(plan.edits);
        print(`rename ${plan.target.declaredIn}.${plan.target.memberName} → ${plan.newName}: ${plural(plan.edits.length, "edit")} in ${plural(files, "file")} — ${flags.write ? "written" : "dry run, add --write"} (${servedBy}; ${elapsed()})`);
        for (const note of plan.notes) print(`! ${note}`);
        for (const group of groupsOf(workspace, plan.target, plan.edits)) {
            const [ first ] = group.places;
            print(`  ${String(group.count).padStart(4)}  ${group.label}${whereOf(group)}${group.owner ? ` — ${group.owner}` : ""}   e.g. ${workspace.relative(first.file)}:${first.line}`);
        }
        if (!flags.write) return true;
        const verdicts = verdictsAfterWrite(workspace, plan);
        for (const verdict of verdicts) print(verdict.text);
        return verdicts.every(verdict => verdict.clean);
    } finally {
        workspace.dispose();
    }
}

const invokedDirectly = () => {
    try {
        return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
};
if (invokedDirectly()) {
    try {
        // exit code 1 also when the compiler this command ran found an error: `… && next step` must not go on then
        if (!main(process.argv.slice(2))) process.exitCode = 1;
    } catch (error) {
        // A wrong name or a missing file is an answer, not a crash: one message on the standard output, exit code 1.
        console.log(error instanceof UsageError ? error.message : `ls-facts failed: ${error?.stack ?? error}`);
        process.exitCode = 1;
    }
    // Nothing of the language service may keep the process alive once the answer is printed.
    setTimeout(() => process.exit(), 1500).unref();
}
