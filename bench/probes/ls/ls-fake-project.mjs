#!/usr/bin/env node
// ls-fake-project.mjs: the OTHER way to host the Angular Language Service without an editor: no tsserver at all.
// A plain ts.createLanguageService() plus a hand-written stand-in for the ts.server.Project that the plugin's create()
// expects. The stand-in is wrapped in a Proxy that records every member the plugin touches, so the output answers
// "what is the least you must fake?". Experiment only: ls-probe.mjs (real ts.server.ProjectService) is the route to use.
//
// Run:  node bench/probes/ls/ls-fake-project.mjs <root> [Class.input] [--strict-input-access]
//       (<root> = directory with tsconfig.json; prints the reference count for the input and the members used)
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const slash = p => p.split(path.sep).join("/");
const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith("--"));
const ROOT = slash(path.resolve(positional[0] ?? "."));
const [ CLASS_NAME, INPUT_NAME ] = (positional[1] ?? "PillComponent.disableTooltip").split(".");
const TSCONFIG = `${ROOT}/tsconfig.json`;

const configOverlay = new Map();
if (argv.includes("--strict-input-access")) {
    const { config } = ts.parseConfigFileTextToJson(TSCONFIG, ts.sys.readFile(TSCONFIG));
    config.angularCompilerOptions = { ...config.angularCompilerOptions, strictInputAccessModifiers: true };
    configOverlay.set(TSCONFIG.toLowerCase(), JSON.stringify(config));
}
const readFile = (file, encoding) => configOverlay.get(slash(file).toLowerCase()) ?? ts.sys.readFile(file, encoding);
const parsed = ts.getParsedCommandLineOfConfigFile(TSCONFIG, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
const options = { ...parsed.options, allowNonTsExtensions: true };
const canonical = ts.createGetCanonicalFileName(ts.sys.useCaseSensitiveFileNames);
const toPath = file => ts.toPath(file, ROOT, canonical);

// ---- a script-info store: what tsserver's ScriptInfo gives the plugin (text, version, kind, edits)
class FakeScriptInfo {
    version = 1;
    constructor(fileName, text, scriptKind) { this.fileName = fileName; this.path = toPath(fileName); this.text = text; this.scriptKind = scriptKind; }
    getSnapshot() { return ts.ScriptSnapshot.fromString(this.text); }
    editContent(start, end, newText) { this.text = this.text.slice(0, start) + newText + this.text.slice(end); this.version++; projectVersion++; }
}
const infos = new Map();
const roots = new Set(parsed.fileNames.map(slash));
let projectVersion = 1;
const kindOf = file => (/\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.Unknown);
function info(fileName, create = true) {
    const key = toPath(fileName);
    if (!infos.has(key) && create && ts.sys.fileExists(fileName)) infos.set(key, new FakeScriptInfo(slash(fileName), ts.sys.readFile(fileName), kindOf(fileName)));
    return infos.get(key);
}

// ---- the TypeScript language service on a plain host
const languageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [ ...roots ].filter(f => /\.tsx?$/.test(f)),
    getScriptVersion: file => String(info(file)?.version ?? 0),
    getScriptSnapshot: file => info(file)?.getSnapshot(),
    getScriptKind: file => info(file)?.scriptKind ?? kindOf(file),
    getProjectVersion: () => String(projectVersion),
    getCurrentDirectory: () => ROOT,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: file => infos.has(toPath(file)) || ts.sys.fileExists(file),
    readFile, readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories, realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames
};
const tsLS = ts.createLanguageService(languageServiceHost, ts.createDocumentRegistry());

// ---- the stand-in for ts.server.Project; `used` records what the plugin really touches
const used = new Set();
const recording = (name, object) => new Proxy(object, { get(target, key) { if (typeof key === "string") used.add(`${name}.${key}`); return target[key]; } });
const logger = { hasLevel: () => false, loggingEnabled: () => false, info() {}, perftrc() {}, msg() {}, startGroup() {}, endGroup() {}, close() {}, getLogFileName: () => undefined };
const serverHost = recording("projectService.host", { ...ts.sys, readFile, watchFile: () => ({ close() {} }), watchDirectory: () => ({ close() {} }) });
const projectService = recording("projectService", {
    host: serverHost, logger, toPath, toCanonicalFileName: canonical,
    getScriptInfo: file => info(file, false),
    getOrCreateScriptInfoForNormalizedPath(fileName, _openedByClient, fileContent, scriptKind) {
        const key = toPath(fileName);
        if (!infos.has(key)) infos.set(key, new FakeScriptInfo(slash(fileName), fileContent ?? ts.sys.readFile(fileName) ?? "", scriptKind ?? kindOf(fileName)));
        return infos.get(key);
    }
});
const project = recording("project", Object.assign(Object.create(ts.server.ConfiguredProject.prototype), {
    projectKind: ts.server.ProjectKind.Configured,
    projectService,
    getCompilerOptions: () => options, getCompilationSettings: () => options,
    getConfigFilePath: () => TSCONFIG, getProjectName: () => TSCONFIG, getCurrentDirectory: () => ROOT,
    getLanguageService: () => tsLS,
    getSourceFile: filePath => tsLS.getProgram().getSourceFileByPath(filePath),
    getScriptInfo: file => info(file, false),
    getScriptVersion: file => String(info(file)?.version ?? 0),          // creates the info, as tsserver does
    getScriptInfos: () => [ ...infos.values() ],
    containsScriptInfo: scriptInfo => roots.has(scriptInfo.fileName),
    isRoot: scriptInfo => roots.has(scriptInfo.fileName),
    addRoot(scriptInfo) { roots.add(scriptInfo.fileName); projectVersion++; },
    hasRoots: () => roots.size > 0,
    fileExists: file => infos.has(toPath(file)) || ts.sys.fileExists(file),
    readFile, realpath: ts.sys.realpath,
    setProjectErrors() {}, log() {}
}));
// The prototype matters: the plugin reads angularCompilerOptions only when `project instanceof ts.server.ConfiguredProject`.
// With a plain object it silently continues with {} (no strictTemplates, no strictInputAccessModifiers).

const plugin = require("@angular/language-service")({ typescript: ts });
let ls, failure;
const t0 = performance.now();
try {
    ls = plugin.create({ project, languageService: tsLS, languageServiceHost, serverHost, config: {} });
    const pill = [ ...roots ].find(f => ts.sys.readFile(f).includes(`class ${CLASS_NAME} `));
    const text = ts.sys.readFile(pill);
    const pos = text.search(new RegExp(`\\b${INPUT_NAME}\\s*[=!:]`));
    const references = ls.getReferencesAtPosition(pill, pos) ?? [];
    const html = references.filter(r => r.fileName.endsWith(".html")).length;
    console.log(`fake project route: getReferencesAtPosition(${CLASS_NAME}.${INPUT_NAME}) → ${references.length} entries (${html} in .html, ${references.length - html} in .ts) in ${Math.round(performance.now() - t0)} ms`);
    const template = references.find(r => r.fileName.endsWith(".html"));
    if (template) {
        const quick = ls.getQuickInfoAtPosition(template.fileName, template.textSpan.start);
        console.log(`quick info at ${slash(path.relative(ROOT, template.fileName))}@${template.textSpan.start}: ${quick?.displayParts?.map(p => p.text).join("") ?? "undefined"}`);
        console.log(`rename locations: ${ls.findRenameLocations(pill, pos, false, false, {})?.length ?? 0}; diagnostics of that template: ${ls.getSemanticDiagnostics(template.fileName).length}`);
    }
} catch (error) {
    failure = error;
    console.log(`fake project route FAILED: ${error.stack?.split("\n").slice(0, 6).join("\n")}`);
}
const members = [ ...used ].sort();
console.log(`members of the stand-in the plugin touched (${members.length}): ${members.join(", ")}`);
console.log(`script infos held: ${infos.size} (${[ ...infos.values() ].filter(i => i.fileName.includes(".ngtypecheck.")).length} type-check files, ${[ ...infos.values() ].filter(i => i.fileName.endsWith(".html")).length} templates); peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
process.exit(failure ? 1 : 0);
