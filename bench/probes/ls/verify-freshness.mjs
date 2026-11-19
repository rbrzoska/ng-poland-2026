#!/usr/bin/env node
// verify-freshness.mjs: VERIFIER probe (not part of the two spikes). Asks the questions the spikes left open about a
// long-lived Angular Language Service process that an agent keeps asking while it edits files:
//   1. in-memory overlay that ADDS a binding: does the next references query return one more entry?
//   2. an edit written to DISK without telling the service: is the answer stale? (host without file watchers, as in ls-probe.mjs)
//   3. the same with real file watchers (ts.sys.watchFile / watchDirectory) and a short wait
//   4. ways to refresh after a disk edit: open+close the file, projectService.reloadProjects()
//   5. a template with a syntax error (unclosed element, broken expression): do references elsewhere survive, what is reported?
//   6. a .ts file with a TypeScript syntax error next to an inline template
// It WRITES into <root> (and restores the files it touched): run it only on a throw-away copy made by make-v1-copy.mjs
// whose tsconfig.json has "strictInputAccessModifiers": true (otherwise readonly inputs resolve to nothing).
//
// Run:  node bench/probes/ls/verify-freshness.mjs <throw-away root> [--ls <dir whose node_modules has @angular/language-service>]
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const REPO = path.resolve(import.meta.dirname, "../../..");
const slash = p => p.split(path.sep).join("/");
const argv = process.argv.slice(2);
const ROOT = slash(path.resolve(argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ls")));
if (ROOT.startsWith(slash(REPO) + "/")) { console.error("refusing to write inside the repository"); process.exit(2); }
const LS_DIR = argv.includes("--ls") ? path.resolve(argv[argv.indexOf("--ls") + 1]) : REPO;
const TSCONFIG = `${ROOT}/tsconfig.json`;
const sleep = ms => new Promise(done => setTimeout(done, ms));

function start({ watchers }) {
    const host = {
        ...ts.sys,
        setTimeout, clearTimeout, setImmediate, clearImmediate,
        ...(watchers ? {} : { watchFile: () => ({ close() {} }), watchDirectory: () => ({ close() {} }) }),
        require(initialDir, moduleName) {
            try { const modulePath = require.resolve(moduleName, { paths: [ initialDir ] }); return { module: require(modulePath), modulePath, error: undefined }; }
            catch (error) { return { module: undefined, error }; }
        }
    };
    const logger = { close() {}, hasLevel: () => false, loggingEnabled: () => false, perftrc() {}, info() {}, startGroup() {}, endGroup() {}, msg() {}, getLogFileName: () => undefined };
    const projectService = new ts.server.ProjectService({ host, logger, cancellationToken: ts.server.nullCancellationToken, useSingleInferredProject: true, useInferredProjectPerProjectRoot: false, typingsInstaller: ts.server.nullTypingsInstaller, session: undefined, globalPlugins: [ "@angular/language-service" ], pluginProbeLocations: [ LS_DIR ], allowLocalPluginLoads: false });
    projectService.setHostConfiguration({ preferences: { includePackageJsonAutoImports: "off" } });
    const parsed = ts.getParsedCommandLineOfConfigFile(TSCONFIG, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
    const anchor = parsed.fileNames[0];
    projectService.openClientFile(anchor);
    const project = () => projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(anchor), true);
    return { projectService, ls: () => project().getLanguageService(), project };
}

const PILL = `${ROOT}/src/app/lib/pill.component.ts`;
const HTML = `${ROOT}/src/app/features/feature-1/feature-1.component.html`;
const INLINE = `${ROOT}/src/app/features/feature-4/feature-4.component.ts`;
const declPos = () => readFileSync(PILL, "utf8").indexOf("disableTooltip =");
const refs = s => (s.ls().getReferencesAtPosition(PILL, declPos()) ?? []).length;
const inFile = (s, file) => (s.ls().getReferencesAtPosition(PILL, declPos()) ?? []).filter(r => slash(r.fileName) === file).length;
const diags = (s, file) => s.ls().getSemanticDiagnostics(file).map(d => `${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 90)}`);
const original = { html: readFileSync(HTML, "utf8"), inline: readFileSync(INLINE, "utf8") };
const EXTRA = `<app-pill label="Added by verifier" [disableTooltip]="true" />\n`;
const version = require(require.resolve("@angular/language-service/package.json", { paths: [ LS_DIR ] })).version;
console.log(`@angular/language-service ${version}, TypeScript ${ts.version}, root ${ROOT}`);

try {
    // ---- 1. in-memory overlay
    let s = start({ watchers: false });
    const base = refs(s);
    console.log(`\n[1] baseline references of PillComponent.disableTooltip: ${base} (${inFile(s, HTML)} in feature-1.component.html)`);
    s.projectService.openClientFile(HTML, EXTRA + original.html);
    console.log(`    after an in-memory overlay that adds one <app-pill [disableTooltip]>: ${refs(s)} (expected ${base + 1})`);
    s.projectService.closeClientFile(HTML);
    console.log(`    after closeClientFile (overlay dropped, disk unchanged): ${refs(s)} (expected ${base})`);

    // ---- 2. disk edit, no watchers, service not told
    writeFileSync(HTML, EXTRA + original.html);
    console.log(`\n[2] host WITHOUT file watchers; wrote one more binding to disk, service not told: ${refs(s)} (fresh answer would be ${base + 1})`);
    writeFileSync(INLINE, original.inline.replace("<app-pill ", `<app-pill label="Added inline" [disableTooltip]="false" /><app-pill `));
    console.log(`    also wrote one more binding into an inline template (.ts) on disk: ${refs(s)} (fresh answer would be ${base + 2})`);
    // ---- 4. ways to refresh
    s.projectService.openClientFile(HTML); s.projectService.closeClientFile(HTML);
    console.log(`[4] after openClientFile+closeClientFile of the .html (no content given, so it is read from disk): ${refs(s)}`);
    s.projectService.openClientFile(INLINE); s.projectService.closeClientFile(INLINE);
    console.log(`    after the same for the .ts with the inline template: ${refs(s)} (fresh answer ${base + 2})`);
    const t0 = performance.now();
    s.projectService.reloadProjects();
    console.log(`    after projectService.reloadProjects() (both disk edits still in place): ${refs(s)} (fresh answer ${base + 2}; ${Math.round(performance.now() - t0)} ms for reload + query)`);
    writeFileSync(HTML, original.html); writeFileSync(INLINE, original.inline);
    console.log(`    restored both files on disk, service not told: ${refs(s)} (fresh answer ${base})`);

    // ---- 3. real watchers
    s = start({ watchers: true });
    console.log(`\n[3] host WITH ts.sys file watchers; baseline: ${refs(s)}`);
    writeFileSync(HTML, EXTRA + original.html);
    console.log(`    wrote one more binding to the .html on disk; asked at once: ${refs(s)}`);
    for (const wait of [ 300, 1000, 3000 ]) { await sleep(wait); console.log(`    after waiting ${wait} ms more (event loop free): ${refs(s)} (fresh answer ${base + 1})`); }
    writeFileSync(INLINE, original.inline.replace("<app-pill ", `<app-pill label="Added inline" [disableTooltip]="false" /><app-pill `));
    console.log(`    wrote one more binding into the inline template (.ts) on disk; asked at once: ${refs(s)}`);
    for (const wait of [ 300, 1000, 3000 ]) { await sleep(wait); console.log(`    after waiting ${wait} ms more: ${refs(s)} (fresh answer ${base + 2})`); }
    writeFileSync(HTML, original.html); writeFileSync(INLINE, original.inline);
    await sleep(3000);
    console.log(`    restored both; after 3000 ms: ${refs(s)} (fresh answer ${base})`);

    // ---- 5. template syntax errors (in memory)
    console.log(`\n[5] template syntax errors, as in-memory overlays of feature-1.component.html (it holds ${inFile(s, HTML)} of the ${base} references)`);
    const cases = {
        "unclosed element (<div> never closed, prepended)": "<div>\n" + original.html,
        "broken binding expression ([disableTooltip]=\"count >\" on the first pill)": original.html.replace(/\[disableTooltip\]=(['"])[^'"]*\1/, `[disableTooltip]="count >"`),
        "unterminated attribute quote on the first pill": original.html.replace(/\[disableTooltip\]=(['"])([^'"]*)\1/, `[disableTooltip]="$2`),
        "unclosed @if block appended": original.html + "\n@if (isActive) {\n<span>x</span>\n"
    };
    for (const [ label, text ] of Object.entries(cases)) {
        s.projectService.openClientFile(HTML, text);
        const total = refs(s), here = inFile(s, HTML), d = diags(s, HTML);
        console.log(`    ${label}: references ${total} (${here} in this file); diagnostics of the file: ${d.length}${d.length ? ` — ${d.slice(0, 2).join(" | ")}` : ""}`);
        s.projectService.closeClientFile(HTML);
    }
    console.log(`    overlay closed again: ${refs(s)}`);

    // ---- 6. TypeScript syntax error in a file with an inline template (in memory)
    const brokenTs = original.inline.replace(/export class (\w+) \{/, "export class $1 {\n    broken = ;");
    s.projectService.openClientFile(INLINE, brokenTs);
    const d6 = diags(s, INLINE), syn = s.ls().getSyntacticDiagnostics(INLINE).length;
    console.log(`\n[6] TypeScript syntax error ("broken = ;") in feature-4.component.ts (inline template): references ${refs(s)} (${inFile(s, INLINE)} in this file); ${syn} syntactic and ${d6.length} semantic diagnostics${d6.length ? ` — ${d6[0]}` : ""}`);
    s.projectService.closeClientFile(INLINE);
} finally {
    writeFileSync(HTML, original.html); writeFileSync(INLINE, original.inline);
}
process.exit(0);
