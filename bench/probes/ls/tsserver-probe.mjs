// Probe, route A: drive TypeScript's tsserver with the Angular language-service plugin over stdio, with no editor,
// and record which requests the plugin answers inside templates (external .html and inline) and at an input declaration.
//
// Run from the repository root:
//   node bench/probes/ls/tsserver-probe.mjs                         # fixture/ (library v2, consumers still v1 = does not compile)
//   node bench/probes/ls/tsserver-probe.mjs --root fixture-expected # the migrated twin (compiles)
// Options:
//   --root <dir>        workspace with tsconfig.json (default fixture); absolute paths are fine
//   --points <json>     probe other positions: { "open": ["rel/file", …], "points": [{ "id", "what", "file", "after", "needle", "delta" }, …] }
//                       (make-scratch-workspace.mjs writes such a file)
//   --probe <dir>       load the plugin from <dir>/node_modules (default: this repository), to try another language-service version
//   --out <dir>         where the raw JSON of every response and the tsserver log go (default <os tmp>/ng-ls-probe)
//   --no-plugin         start tsserver without the Angular plugin (control run)
//   --no-html-ext       do not send `configure { extraFileExtensions: [.html] }` before opening the template
//   --html-first        open the .html before any .ts file (default: the .ts files first)
//   --auto-imports      leave tsserver's default includePackageJsonAutoImports on (default here: "off", as the Angular
//                       language server sets it; when on, tsserver first builds an auto-import project from node_modules)
//   --items <n>         how many items of each answer to print (default 2)
// Nothing is written inside the repository; no file of the workspace is changed (rename answers are locations only).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const root = resolve(repo, option("--root", "fixture"));
const rootPath = root.replace(/\\/g, "/");
const outDir = resolve(option("--out", join(tmpdir(), "ng-ls-probe")));
const items = Number(option("--items", "2"));
const probe = join(resolve(option("--probe", repo)), "node_modules");
mkdirSync(outDir, { recursive: true });
const tag = `tsserver-${basename(root)}${flag("--no-plugin") ? "-noplugin" : ""}${flag("--auto-imports") ? "-autoimports" : ""}${flag("--no-html-ext") ? "-nohtmlext" : ""}${flag("--html-first") ? "-htmlfirst" : ""}`;
const logFile = join(outDir, `${tag}.log`);

// ---------------------------------------------------------------- tsserver client (requests: one JSON per line; answers: Content-Length framed)
const serverArgs = [ join(repo, "node_modules/typescript/lib/tsserver.js"), "--logVerbosity", "verbose", "--logFile", logFile, "--disableAutomaticTypingAcquisition" ];
if (!flag("--no-plugin")) serverArgs.push("--globalPlugins", "@angular/language-service", "--pluginProbeLocations", probe);
const started = performance.now();
const child = spawn(process.execPath, serverArgs, { cwd: root, stdio: [ "pipe", "pipe", "pipe" ] });
let buffer = Buffer.alloc(0);
let seq = 0;
const pending = new Map();
const events = [];
child.stderr.on("data", chunk => process.stderr.write(`[tsserver stderr] ${chunk}`));
child.stdout.on("data", chunk => {
    buffer = Buffer.concat([ buffer, chunk ]);
    for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, headerEnd).toString())[1]);
        if (buffer.length < headerEnd + 4 + length) return;
        const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8"));
        buffer = buffer.subarray(headerEnd + 4 + length);
        if (message.type === "response" && pending.has(message.request_seq)) {
            const { done, at } = pending.get(message.request_seq);
            pending.delete(message.request_seq);
            done({ ...message, ms: Math.round(performance.now() - at) });
        } else if (message.type === "event") events.push({ at: Math.round(performance.now() - started), event: message.event, body: message.body });
    }
});
/** Sends a request and waits for its response. */
const request = (command, args, timeoutMs = 120000) => new Promise(done => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); done({ success: false, message: `NO RESPONSE in ${timeoutMs} ms`, ms: timeoutMs }); }, timeoutMs);
    pending.set(id, { at: performance.now(), done: answer => { clearTimeout(timer); done(answer); } });
    child.stdin.write(JSON.stringify({ seq: id, type: "request", command, arguments: args }) + "\n");
});
/** Sends a request that has no response (open, close). */
const notify = (command, args) => child.stdin.write(JSON.stringify({ seq: ++seq, type: "request", command, arguments: args }) + "\n");
/** Resident memory of the server process in MB (tasklist on Windows, ps elsewhere). */
const memory = () => {
    try {
        if (process.platform === "win32") return Math.round(Number(execFileSync("tasklist", [ "/FI", `PID eq ${child.pid}`, "/FO", "CSV", "/NH" ]).toString().split('","')[4].replace(/[^\d]/g, "")) / 1024);
        return Math.round(Number(execFileSync("ps", [ "-o", "rss=", "-p", String(child.pid) ]).toString()) / 1024);
    } catch { return NaN; }
};

// ---------------------------------------------------------------- positions: found by text, so the script survives a regenerated fixture
const abs = file => `${rootPath}/${file}`;
const short = value => String(value).replaceAll(`${rootPath}/`, "");
/** 1-based line/offset of `needle` (+delta characters) after the first occurrence of `after`. */
function locate(file, after, needle, delta = 0) {
    const text = readFileSync(join(root, file), "utf8");
    const from = after ? text.indexOf(after) : 0;
    const index = from < 0 ? -1 : text.indexOf(needle, from);
    if (index < 0) return null;
    const before = text.slice(0, index + delta);
    const line = before.split("\n").length;
    return { rel: file, file: abs(file), line, offset: before.length - before.lastIndexOf("\n"), lineText: text.split("\n")[line - 1].trim().slice(0, 110) };
}
let open;
let points;
if (option("--points")) {
    const custom = JSON.parse(readFileSync(resolve(option("--points")), "utf8"));
    open = custom.open;
    points = custom.points.map(point => ({ id: point.id, what: point.what, ...locate(point.file, point.after ?? "", point.needle, point.delta ?? 0) }));
} else {
    const html = "src/app/features/feature-1/feature-1.component.html";
    const inline = "src/app/features/feature-4/feature-4.component.ts";
    const pill = "src/app/lib/pill.component.ts";
    const card = "src/app/lib/card.component.ts";
    // In fixture/ the consumers still bind the v1 input name, which PillComponent v2 no longer declares.
    const pillInput = readFileSync(join(root, html), "utf8").includes("[tooltip]") ? "tooltip" : "disableTooltip";
    open = [ card, pill, html.replace(".html", ".ts"), inline, html ];
    points = [
        { id: "decl-card-input", what: "library class: declaration of CardComponent.disableTooltip (signal input)", ...locate(card, "export class CardComponent", "disableTooltip =", 0) },
        { id: "html-pill-input", what: `external template: [${pillInput}] on <app-pill>`, ...locate(html, "<app-pill ", `[${pillInput}]`, 1) },
        { id: "html-card-input", what: "external template: [disableTooltip] on <app-card>", ...locate(html, "<app-card ", "[disableTooltip]", 1) },
        { id: "html-pill-tag", what: "external template: tag name of <app-pill>", ...locate(html, "", "<app-pill ", 1) },
        { id: "html-expression", what: "external template: component field `isActive` inside a binding expression", ...locate(html, "<app-pill ", "isActive", 1) },
        { id: "inline-pill-input", what: `inline template: [${pillInput}] on <app-pill>`, ...locate(inline, "<app-pill ", `[${pillInput}]`, 1) },
        { id: "inline-card-input", what: "inline template: [disableTooltip] on <app-card>", ...locate(inline, "<app-card ", "[disableTooltip]", 1) },
        { id: "inline-expression", what: "inline template: method call `isHidden()` inside a binding expression", ...locate(inline, "<app-pill ", "isHidden()", 1) },
        { id: "decl-pill-tooltip", what: "library class: declaration of PillComponent.tooltip (signal input)", ...locate(pill, "export class PillComponent", "tooltip =", 0) },
        { id: "decl-pill-class", what: "library class: the name PillComponent", ...locate(pill, "", "class PillComponent", 6) }
    ];
}
points = points.filter(point => point.file);
const html = open.find(file => file.endsWith(".html"));
const htmlOwner = html?.replace(/\.html$/, ".ts");

// ---------------------------------------------------------------- printing helpers
const raw = {};
const trim = value => {
    if (typeof value === "string") return value.length > 160 ? `${short(value).slice(0, 160)}…(${value.length} chars)` : short(value);
    if (Array.isArray(value)) return value.length > items ? [ ...value.slice(0, items).map(trim), `… +${value.length - items} more` ] : value.map(trim);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([ key, item ]) => [ key, trim(item) ]));
    return value;
};
const show = (label, answer, summary) => console.log(`  ${label.padEnd(28)} ${answer.success ? "ok " : "ERR"} ${String(answer.ms).padStart(5)} ms  ${summary ?? ""}${answer.success ? "" : `  message: ${JSON.stringify(answer.message)}`}`);
const kinds = spans => {
    const files = new Set(spans.map(span => span.file));
    const inHtml = spans.filter(span => span.file.endsWith(".html")).length;
    const inShim = spans.filter(span => span.file.endsWith(".ngtypecheck.ts")).length;
    return `${spans.length} locations in ${files.size} files (${inHtml} in .html, ${spans.length - inHtml - inShim} in real .ts${inShim ? `, ${inShim} in generated *.ngtypecheck.ts that are not on disk` : ""})`;
};
const renameSpans = body => body.locs.flatMap(group => group.locs.map(loc => ({ file: group.file, ...loc })));

// ---------------------------------------------------------------- the session
const pluginVersion = flag("--no-plugin") ? "OFF" : `@angular/language-service ${JSON.parse(readFileSync(join(probe, "@angular/language-service/package.json"), "utf8")).version}`;
console.log(`# tsserver probe — root ${relative(repo, root).startsWith("..") ? root : relative(repo, root)}, plugin ${pluginVersion}, typescript ${JSON.parse(readFileSync(join(repo, "node_modules/typescript/package.json"), "utf8")).version}`);
console.log(`# command: node ${serverArgs.map(arg => arg.replace(repo, ".").replace(/\\/g, "/")).join(" ")}`);
const timeline = [];
const mark = label => timeline.push(`${label}: ${Math.round(performance.now() - started)} ms after spawn`);

const status = await request("status", {});
mark("first response of the process (status)");
console.log(`\n## start\n  status: ${JSON.stringify(status.body)}`);
{
    // What the Angular language server does in-process: tell the project service that .html is a file it may open,
    // and switch off the auto-import project (useless to an agent, and by far the largest part of a cold start).
    const configuration = { hostInfo: "ng-poland-probe" };
    if (!flag("--no-html-ext")) configuration.extraFileExtensions = [ { extension: ".html", isMixedContent: false, scriptKind: 0 } ];
    if (!flag("--auto-imports")) configuration.preferences = { includePackageJsonAutoImports: "off" };
    const configured = await request("configure", configuration);
    show("configure", configured, JSON.stringify(configuration));
}
const ordered = flag("--html-first") ? [ ...open.filter(file => file.endsWith(".html")), ...open.filter(file => !file.endsWith(".html")) ] : [ ...open.filter(file => !file.endsWith(".html")), ...open.filter(file => file.endsWith(".html")) ];
for (const file of ordered) notify("open", { file: abs(file), projectRootPath: rootPath });

// First real answer: who uses the first probed symbol?  (project load; the plugin is NOT asked by tsserver's `references`, see below)
const firstPoint = points[0];
const first = raw["first-references"] = await request("references", { file: firstPoint.file, line: firstPoint.line, offset: firstPoint.offset });
mark(`first answer (references at ${firstPoint.id}, ${first.ms} ms of it inside the request)`);
show("first references (cold)", first, first.success ? kinds(first.body.refs) : "");
const firstRename = raw["first-rename"] = await request("rename", { file: firstPoint.file, line: firstPoint.line, offset: firstPoint.offset, findInComments: false, findInStrings: false });
mark(`first answer that goes through the Angular plugin (rename at ${firstPoint.id}, ${firstRename.ms} ms inside the request)`);
show("first rename (cold)", firstRename, firstRename.success ? `canRename=${firstRename.body.info.canRename}  ${kinds(renameSpans(firstRename.body))}` : "");

const owner = async file => {
    const info = await request("projectInfo", { file: abs(file), needFileNameList: false });
    return info.success ? short(info.body.configFileName) : `ERR ${info.message}`;
};
console.log("\n## which project owns each opened file");
for (const file of open) console.log(`  ${file}: ${await owner(file)}`);
if (html) {
    // The external template is not in tsconfig's "include"; tsserver alone puts it into an inferred project. It joins the
    // component's project only after the Angular plugin has analysed that project and reported the template as an external
    // file, and tsserver has refreshed the project. So: ask once right away, then wait until the owner changes.
    const early = points.find(point => point.rel === html && /expression/.test(point.id)) ?? points.find(point => point.rel === html);
    const quick = await request("quickinfo", { file: early.file, line: early.line, offset: early.offset });
    show("quickinfo in .html, at once", quick, quick.success ? quick.body.displayString : "");
    const waitFrom = performance.now();
    const diagnostics = await request("semanticDiagnosticsSync", { file: abs(htmlOwner) });
    show("diagnostics of its owner .ts", diagnostics, diagnostics.success ? `${diagnostics.body.length} diagnostics` : "");
    let project = await owner(html);
    while (project !== "tsconfig.json" && performance.now() - waitFrom < 15000) {
        await new Promise(done => setTimeout(done, 100));
        project = await owner(html);
    }
    console.log(`  ${html} is now in: ${project} (${Math.round(performance.now() - waitFrom)} ms after asking for the owner's diagnostics)`);
    mark("external template attached to the component's project");
    const again = await request("quickinfo", { file: early.file, line: early.line, offset: early.offset });
    show("quickinfo in .html, after", again, again.success ? again.body.displayString : "");
}
console.log(`  plugin lines in the log: ${existsSync(logFile) ? [ ...new Set([ ...readFileSync(logFile, "utf8").matchAll(/(Enabling plugin|Loading global plugin|Plugin validation succeeded|Failed to load module|Couldn't find) ?([^\r\n]*)/g) ].map(match => match[0].slice(0, 90))) ].join(" | ") : "no log"}`);

for (const point of points) {
    console.log(`\n## ${point.id} — ${point.what}\n  at ${point.rel}:${point.line}:${point.offset}   ${point.lineText}`);
    const at = { file: point.file, line: point.line, offset: point.offset };
    const answers = raw[point.id] = {};

    const quick = answers.quickinfo = await request("quickinfo", at);
    show("quickinfo", quick, quick.success ? JSON.stringify({ kind: quick.body.kind, displayString: quick.body.displayString, documentation: quick.body.documentation }).slice(0, 230) : "");

    const definition = answers.definitionAndBoundSpan = await request("definitionAndBoundSpan", at);
    show("definitionAndBoundSpan", definition, definition.success ? JSON.stringify(trim(definition.body)).slice(0, 330) : "");

    const references = answers.references = await request("references", at);
    show("references", references, references.success ? `${kinds(references.body.refs)}  symbolName=${JSON.stringify(references.body.symbolName).slice(0, 40)}` : "");
    if (references.success) for (const ref of references.body.refs.slice(0, items)) console.log(`      ${JSON.stringify(trim(ref))}`);

    const rename = answers.rename = await request("rename", { ...at, findInComments: false, findInStrings: false });
    if (rename.success) {
        const info = rename.body.info;
        show("rename", rename, `canRename=${info.canRename}${info.canRename ? ` displayName=${JSON.stringify(info.displayName)} kind=${JSON.stringify(info.kind)} triggerSpan=${JSON.stringify(info.triggerSpan)}  ${kinds(renameSpans(rename.body))}` : ` reason=${JSON.stringify(info.localizedErrorMessage)}`}`);
        for (const group of rename.body.locs.slice(0, items)) console.log(`      ${JSON.stringify(trim(group))}`);
    } else show("rename", rename);

    const refactors = answers.getApplicableRefactors = await request("getApplicableRefactors", { ...at, triggerReason: "invoked" });
    show("getApplicableRefactors", refactors, refactors.success ? JSON.stringify(trim(refactors.body)).slice(0, 330) : "");
    if (refactors.success && refactors.body.length) {
        const refactor = refactors.body[0];
        const edits = answers.getEditsForRefactor = await request("getEditsForRefactor", { ...at, refactor: refactor.name, action: refactor.actions[0]?.name ?? refactor.name });
        show("getEditsForRefactor", edits, `refactor=${refactor.name}  ${edits.success ? JSON.stringify(trim(edits.body)).slice(0, 300) : ""}`);
    }
}

console.log("\n## diagnostics (semanticDiagnosticsSync) and the code fixes offered for the first one");
for (const file of open) {
    const diagnostics = raw[`diagnostics ${file}`] = await request("semanticDiagnosticsSync", { file: abs(file), includeLinePosition: false });
    show(`diagnostics ${basename(file)}`.slice(0, 28), diagnostics, diagnostics.success ? `${basename(file)}: ${diagnostics.body.length} diagnostics` : "");
    if (!diagnostics.success) continue;
    for (const diagnostic of diagnostics.body.slice(0, items)) console.log(`      ${JSON.stringify(trim(diagnostic)).slice(0, 330)}`);
    const firstDiagnostic = diagnostics.body[0];
    if (firstDiagnostic) {
        const fixes = raw[`codefixes ${file}`] = await request("getCodeFixes", { file: abs(file), startLine: firstDiagnostic.start.line, startOffset: firstDiagnostic.start.offset, endLine: firstDiagnostic.end.line, endOffset: firstDiagnostic.end.offset, errorCodes: [ firstDiagnostic.code ] });
        show("  getCodeFixes", fixes, fixes.success ? JSON.stringify(trim(fixes.body)).slice(0, 300) : "");
    }
}

console.log("\n## requests that do not need a position (how a wrapper could get from a name to a position)");
for (const [ command, args ] of [
    [ "navto", { searchValue: "PillComponent", maxResultCount: 5, file: points[0].file } ],
    [ "navto", { searchValue: points[0].lineText.match(/(\w+)\s*=/)?.[1] ?? "label", maxResultCount: 8, file: points[0].file } ],
    ...(html ? [ [ "navtree", { file: abs(html) } ] ] : [])
]) {
    const answer = raw[`${command} ${args.searchValue ?? ""}`] = await request(command, args);
    show(`${command} ${args.searchValue ?? basename(args.file)}`.slice(0, 28), answer, answer.success ? JSON.stringify(trim(answer.body)).slice(0, 420) : "");
}

console.log("\n## warm timings (same process, project already analysed)");
for (const point of points.filter(point => point.id.startsWith("decl")).slice(0, 3)) {
    const at = { file: point.file, line: point.line, offset: point.offset };
    const references = await request("references", at);
    show(`references ${point.id}`.slice(0, 28), references, references.success ? kinds(references.body.refs) : "");
    const rename = await request("rename", { ...at, findInComments: false, findInStrings: false });
    show(`rename ${point.id}`.slice(0, 28), rename, rename.success ? `canRename=${rename.body.info.canRename}  ${kinds(renameSpans(rename.body))}` : "");
}

console.log(`\n## timeline\n  ${timeline.join("\n  ")}`);
console.log(`  events received: ${[ ...new Set(events.map(event => event.event)) ].join(", ") || "none"}`);
console.log(`  memory of the tsserver process at the end: ${memory()} MB`);
console.log(`  raw answers: ${join(outDir, `${tag}.json`)}; log: ${logFile}`);
writeFileSync(join(outDir, `${tag}.json`), JSON.stringify({ root, serverArgs, points, timeline, events: events.map(event => ({ at: event.at, event: event.event })), raw }, null, 1));
child.stdin.end();
child.kill();
