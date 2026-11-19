// Probe, route B: drive the Angular language server (@angular/language-server, the "ngserver" binary that the VS Code
// extension starts) over LSP stdio, with no editor, and record what it answers inside templates and at an input declaration.
//
// The server is NOT a dependency of this repository. Install it once into a scratch directory outside the repo:
//   mkdir %TEMP%\ngserver && cd %TEMP%\ngserver && npm init -y && npm install @angular/language-server@22.2.1
// Then, from the repository root:
//   node bench/probes/ls/ngserver-probe.mjs --server <that directory>                          # fixture/ (does not compile: library v2, consumers v1)
//   node bench/probes/ls/ngserver-probe.mjs --server <that directory> --root fixture-expected  # the migrated twin (compiles)
// Options:
//   --server <dir>      directory whose node_modules holds @angular/language-server (default <os tmp>/ngserver)
//   --root <dir>        workspace with tsconfig.json (default fixture); absolute paths are fine
//   --probe <dir>       take typescript and @angular/language-service from <dir>/node_modules (default: this repository)
//   --points <json>     probe other positions: { "open": ["rel/file", …], "points": [{ "id", "what", "file", "after", "needle", "delta" }, …] }
//   --out <dir>         where the raw JSON of every response and the server log go (default <os tmp>/ng-ls-probe)
//   --items <n>         how many items of each answer to print (default 2)
//   --new-name <name>   the name sent with textDocument/rename (default renamedByProbe)
// Nothing is written inside the repository; rename and code-action answers are workspace edits that are only printed.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const root = resolve(repo, option("--root", "fixture"));
const serverDir = resolve(option("--server", join(tmpdir(), "ngserver")));
const outDir = resolve(option("--out", join(tmpdir(), "ng-ls-probe")));
const items = Number(option("--items", "2"));
const newName = option("--new-name", "renamedByProbe");
const serverEntry = join(serverDir, "node_modules/@angular/language-server/index.js");
if (!existsSync(serverEntry)) {
    console.error(`@angular/language-server not found at ${serverEntry}\nInstall it outside the repository (see the header of this file) and pass --server <dir>.`);
    process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const tag = `ngserver-${basename(root)}`;
const logFile = join(outDir, `${tag}.log`);

// ---------------------------------------------------------------- LSP client (stdio, Content-Length framing both ways)
// TypeScript and @angular/language-service are taken from the repository's node_modules, as the editor extension prefers the workspace's versions.
// --probe <dir> takes them from <dir>/node_modules instead (for example the server's own directory, to try another language-service version).
const probe = join(resolve(option("--probe", repo)), "node_modules");
const serverArgs = [ serverEntry, "--stdio", "--tsProbeLocations", probe, "--ngProbeLocations", probe, "--logFile", logFile, "--logVerbosity", "verbose" ];
const started = performance.now();
const child = spawn(process.execPath, serverArgs, { cwd: root, stdio: [ "pipe", "pipe", "pipe" ] });
const sinceStart = () => Math.round(performance.now() - started);
let buffer = Buffer.alloc(0);
let nextId = 0;
const pending = new Map();
const notifications = [];
const serverRequests = [];
const diagnostics = new Map();
const waiters = [];
/** The server answers with file:///c%3A/… where Node writes file:///C:/… — compare them decoded and lower-cased. */
const sameUri = value => decodeURIComponent(value).toLowerCase();
/** Resident memory of the server process in MB (tasklist on Windows, ps elsewhere). */
const memory = () => {
    try {
        if (process.platform === "win32") return Math.round(Number(execFileSync("tasklist", [ "/FI", `PID eq ${child.pid}`, "/FO", "CSV", "/NH" ]).toString().split('","')[4].replace(/[^\d]/g, "")) / 1024);
        return Math.round(Number(execFileSync("ps", [ "-o", "rss=", "-p", String(child.pid) ]).toString()) / 1024);
    } catch { return NaN; }
};
child.stderr.on("data", chunk => process.stderr.write(`[ngserver stderr] ${chunk}`));
child.on("exit", code => { for (const { done } of pending.values()) done({ error: { message: `server exited with code ${code}` }, ms: -1 }); });
const write = message => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
    child.stdin.write(Buffer.concat([ Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body ]));
};
child.stdout.on("data", chunk => {
    buffer = Buffer.concat([ buffer, chunk ]);
    for (;;) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())[1]);
        if (buffer.length < headerEnd + 4 + length) return;
        const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString("utf8"));
        buffer = buffer.subarray(headerEnd + 4 + length);
        if (message.id !== undefined && message.method === undefined) {
            const entry = pending.get(message.id);
            pending.delete(message.id);
            entry?.done({ ...message, ms: Math.round(performance.now() - entry.at) });
        } else if (message.id !== undefined) {
            // A request from the server to the client: answer what an editor would answer.
            serverRequests.push({ at: sinceStart(), method: message.method, params: message.params });
            write({ id: message.id, result: message.method === "workspace/configuration" ? message.params.items.map(() => ({})) : null });
        } else {
            notifications.push({ at: sinceStart(), method: message.method, params: message.params });
            if (message.method === "textDocument/publishDiagnostics") diagnostics.set(sameUri(message.params.uri), message.params.diagnostics);
            for (const waiter of waiters.filter(waiter => waiter.method === message.method)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.done(true); }
        }
    }
});
const request = (method, params, timeoutMs = 120000) => new Promise(done => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); done({ error: { message: `NO RESPONSE in ${timeoutMs} ms` }, ms: timeoutMs }); }, timeoutMs);
    pending.set(id, { at: performance.now(), done: answer => { clearTimeout(timer); done(answer); } });
    write({ id, method, params });
});
const notify = (method, params) => write({ method, params });
const waitFor = (method, timeoutMs) => new Promise(done => {
    if (notifications.some(notification => notification.method === method)) return done(true);
    const waiter = { method, done };
    waiters.push(waiter);
    setTimeout(() => { if (waiters.includes(waiter)) { waiters.splice(waiters.indexOf(waiter), 1); done(false); } }, timeoutMs);
});

// ---------------------------------------------------------------- positions: found by text; LSP positions are 0-based
const uri = file => pathToFileURL(join(root, file)).href;
const short = value => String(value).replace(pathToFileURL(root).href + "/", "").replace(root.replace(/\\/g, "/") + "/", "");
function locate(file, after, needle, delta = 0) {
    const text = readFileSync(join(root, file), "utf8");
    const from = after ? text.indexOf(after) : 0;
    const index = from < 0 ? -1 : text.indexOf(needle, from);
    if (index < 0) return null;
    const before = text.slice(0, index + delta);
    const line = before.split("\n").length - 1;
    return { file, uri: uri(file), position: { line, character: before.length - before.lastIndexOf("\n") - 1 }, lineText: text.split("\n")[line].trim().slice(0, 110) };
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
    open = [ card, pill, html, inline ];
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
points = points.filter(point => point.uri);

// ---------------------------------------------------------------- printing helpers
const raw = {};
const trim = value => {
    if (typeof value === "string") return value.length > 200 ? `${short(value).slice(0, 200)}…(${value.length} chars)` : short(value);
    if (Array.isArray(value)) return value.length > items ? [ ...value.slice(0, items).map(trim), `… +${value.length - items} more` ] : value.map(trim);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([ key, item ]) => [ short(key), trim(item) ]));
    return value;
};
const show = (label, answer, summary) => console.log(`  ${label.padEnd(26)} ${answer.error ? "ERR" : "ok "} ${String(answer.ms).padStart(5)} ms  ${answer.error ? `error: ${JSON.stringify(answer.error).slice(0, 300)}` : summary ?? JSON.stringify(trim(answer.result)).slice(0, 420)}`);
const where = locations => {
    const list = locations ?? [];
    const files = new Set(list.map(location => location.uri ?? location.targetUri));
    const inHtml = list.filter(location => (location.uri ?? location.targetUri).endsWith(".html")).length;
    return `${list.length} locations in ${files.size} files (${inHtml} in .html, ${list.length - inHtml} in .ts)`;
};
/** A WorkspaceEdit as { uri: edits[] }, whichever of the two LSP shapes the server used. */
const editsOf = edit => Object.fromEntries(edit?.changes ? Object.entries(edit.changes) : (edit?.documentChanges ?? []).map(change => [ change.textDocument.uri, change.edits ]));
const editSummary = edit => {
    const byFile = editsOf(edit);
    const count = Object.values(byFile).reduce((sum, list) => sum + list.length, 0);
    const inHtml = Object.entries(byFile).filter(([ file ]) => file.endsWith(".html")).reduce((sum, [ , list ]) => sum + list.length, 0);
    return `${count} edits in ${Object.keys(byFile).length} files (${inHtml} in .html, ${count - inHtml} in .ts)`;
};

// ---------------------------------------------------------------- the session
const timeline = [];
const mark = label => timeline.push(`${label}: ${sinceStart()} ms after spawn`);
console.log(`# ngserver probe — root ${relative(repo, root) || root}, @angular/language-server ${JSON.parse(readFileSync(join(dirname(serverEntry), "package.json"), "utf8")).version}`);
console.log(`# @angular/language-service ${JSON.parse(readFileSync(join(probe, "@angular/language-service/package.json"), "utf8")).version} and typescript ${JSON.parse(readFileSync(join(probe, "typescript/package.json"), "utf8")).version} from ${probe}`);
console.log(`# command: node ${serverArgs.map(arg => arg.replace(repo, ".").replace(serverDir, "<server>").replace(/\\/g, "/")).join(" ")}`);

const initialize = raw.initialize = await request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(root).href,
    workspaceFolders: [ { uri: pathToFileURL(root).href, name: basename(root) } ],
    capabilities: {
        workspace: { configuration: true, workspaceEdit: { documentChanges: true } },
        textDocument: { rename: { prepareSupport: true }, codeAction: { resolveSupport: { properties: [ "edit" ] }, dataSupport: true, codeActionLiteralSupport: { codeActionKind: { valueSet: [ "quickfix", "refactor" ] } } }, hover: { contentFormat: [ "markdown", "plaintext" ] }, publishDiagnostics: {} },
        window: { workDoneProgress: true }
    }
});
mark("initialize answered");
console.log(`\n## start`);
show("initialize", initialize, `capabilities: ${Object.keys(initialize.result?.capabilities ?? {}).join(", ")}`);
notify("initialized", {});
for (const file of open) notify("textDocument/didOpen", { textDocument: { uri: uri(file), languageId: file.endsWith(".html") ? "html" : "typescript", version: 1, text: readFileSync(join(root, file), "utf8") } });
mark(`didOpen sent for ${open.length} files`);

// First real answer: who uses the first probed symbol?  (project load + Angular analysis + type-check of the templates)
const first = raw["first-references"] = await request("textDocument/references", { textDocument: { uri: points[0].uri }, position: points[0].position, context: { includeDeclaration: true } });
mark(`first semantic answer (textDocument/references at ${points[0].id})`);
show("first references (cold)", first, where(first.result));
const loaded = await waitFor("angular/projectLoadingFinish", 5000);
console.log(`  angular/projectLoadingFinish ${loaded ? `received ${notifications.find(notification => notification.method === "angular/projectLoadingFinish").at} ms after spawn` : "NOT received"}; angular/projectLanguageService: ${JSON.stringify(notifications.filter(notification => notification.method === "angular/projectLanguageService").map(notification => trim(notification.params)))}`);

for (const point of points) {
    console.log(`\n## ${point.id} — ${point.what}\n  at ${point.file}:${point.position.line + 1}:${point.position.character + 1} (LSP ${point.position.line}:${point.position.character})   ${point.lineText}`);
    const at = { textDocument: { uri: point.uri }, position: point.position };
    const answers = raw[point.id] = {};

    const hover = answers.hover = await request("textDocument/hover", at);
    show("hover", hover, hover.result ? JSON.stringify(trim(hover.result)).slice(0, 330) : "null");

    const definition = answers.definition = await request("textDocument/definition", at);
    show("definition", definition, definition.result ? JSON.stringify(trim(definition.result)).slice(0, 420) : "null");

    const type = answers.typeDefinition = await request("textDocument/typeDefinition", at);
    show("typeDefinition", type, type.result ? JSON.stringify(trim(type.result)).slice(0, 260) : "null");

    const references = answers.references = await request("textDocument/references", { ...at, context: { includeDeclaration: true } });
    show("references", references, references.result ? where(references.result) : "null");
    for (const location of (references.result ?? []).slice(0, items)) console.log(`      ${JSON.stringify(trim(location))}`);

    const prepare = answers.prepareRename = await request("textDocument/prepareRename", at);
    show("prepareRename", prepare, prepare.result ? JSON.stringify(prepare.result) : "null");

    const rename = answers.rename = await request("textDocument/rename", { ...at, newName });
    show(`rename → ${newName}`, rename, rename.result ? editSummary(rename.result) : "null");
    for (const [ file, edits ] of Object.entries(editsOf(rename.result)).slice(0, items)) console.log(`      ${short(file)}: ${JSON.stringify(trim(edits))}`);

    // Code actions: the refactorings offered at the position, plus the quick fixes for the diagnostics that touch it.
    const here = (diagnostics.get(sameUri(point.uri)) ?? []).filter(diagnostic => diagnostic.range.start.line <= point.position.line && diagnostic.range.end.line >= point.position.line);
    const actions = answers.codeAction = await request("textDocument/codeAction", { textDocument: { uri: point.uri }, range: { start: point.position, end: point.position }, context: { diagnostics: here } });
    show(`codeAction (${here.length} diag.)`, actions, actions.result ? `${actions.result.length} actions: ${JSON.stringify(actions.result.map(action => `${action.kind}: ${action.title}`)).slice(0, 330)}` : "null");
    const refactor = (actions.result ?? []).find(action => action.data?.refactor);
    if (refactor) {
        const resolved = answers.codeActionResolve = await request("codeAction/resolve", refactor);
        show("codeAction/resolve", resolved, resolved.result?.edit ? `"${refactor.title}" → ${editSummary(resolved.result.edit)}` : `no edit: ${JSON.stringify(trim(resolved.result)).slice(0, 200)}`);
        for (const [ file, edits ] of Object.entries(editsOf(resolved.result?.edit)).slice(0, items + 2)) console.log(`      ${short(file)}: ${JSON.stringify(trim(edits)).slice(0, 420)}`);
    }
    const fix = (actions.result ?? []).find(action => action.kind === "quickfix" && action.edit);
    if (fix) for (const [ file, edits ] of Object.entries(editsOf(fix.edit)).slice(0, items)) console.log(`      quick fix "${fix.title}" → ${short(file)}: ${JSON.stringify(trim(edits)).slice(0, 300)}`);
}

console.log("\n## diagnostics pushed by the server (textDocument/publishDiagnostics) for the opened files");
await new Promise(done => setTimeout(done, 1500));
for (const file of open) {
    const list = diagnostics.get(sameUri(uri(file)));
    console.log(`  ${file}: ${list === undefined ? "nothing published" : `${list.length} diagnostics`}`);
    for (const diagnostic of (list ?? []).slice(0, items)) console.log(`      ${JSON.stringify(trim(diagnostic)).slice(0, 330)}`);
}
raw.diagnostics = Object.fromEntries(diagnostics);

console.log("\n## Angular-specific requests (not part of LSP)");
const template = open.find(file => file.endsWith(".html"));
const component = points.find(point => point.id.startsWith("inline")) ?? points.find(point => point.file.endsWith(".ts"));
for (const [ method, params ] of [
    ...(template ? [ [ "angular/getComponentsWithTemplateFile", { textDocument: { uri: uri(template) } } ], [ "textDocument/documentSymbol", { textDocument: { uri: uri(template) } } ], [ "textDocument/codeLens", { textDocument: { uri: uri(template) } } ] ] : []),
    [ "angular/getTemplateLocationForComponent", { textDocument: { uri: component.uri }, position: component.position } ],
    [ "angular/getTcb", { textDocument: { uri: component.uri }, position: component.position } ],
    [ "angular/isAngularCoreInOwningProject", { textDocument: { uri: component.uri } } ],
    [ "workspace/symbol", { query: "PillComponent" } ]
]) {
    const answer = raw[method] = await request(method, params, 20000);
    show(method.replace("textDocument/", ""), answer);
}

console.log("\n## warm timings (same process, project already analysed)");
for (const point of points.filter(point => point.id.startsWith("decl")).slice(0, 3)) {
    const references = await request("textDocument/references", { textDocument: { uri: point.uri }, position: point.position, context: { includeDeclaration: true } });
    show(`references ${point.id}`.slice(0, 26), references, where(references.result));
    const rename = await request("textDocument/rename", { textDocument: { uri: point.uri }, position: point.position, newName });
    show(`rename ${point.id}`.slice(0, 26), rename, rename.result ? editSummary(rename.result) : "null");
}

console.log(`\n## timeline\n  ${timeline.join("\n  ")}`);
console.log(`  notifications from the server: ${[ ...new Set(notifications.map(notification => notification.method)) ].join(", ")}`);
console.log(`  requests from the server to the client: ${[ ...new Set(serverRequests.map(item => item.method)) ].join(", ") || "none"}`);
console.log(`  memory of the server process at the end: ${memory()} MB`);
console.log(`  raw answers: ${join(outDir, `${tag}.json`)}; log: ${logFile}`);
writeFileSync(join(outDir, `${tag}.json`), JSON.stringify({ root, serverArgs, points, timeline, notifications: notifications.map(notification => ({ at: notification.at, method: notification.method })), serverRequests, raw }, null, 1));
await request("shutdown", null, 5000);
notify("exit", null);
setTimeout(() => child.kill(), 500).unref();
