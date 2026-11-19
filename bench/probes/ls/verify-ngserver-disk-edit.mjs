#!/usr/bin/env node
// verify-ngserver-disk-edit.mjs: VERIFIER probe (not part of the two spikes). The server spike listed as untested:
// "telling the server about files the agent edits on disk". An agent edits files with its own tools, not through LSP,
// so: start ngserver, open ONE file (didOpen), ask for references of PillComponent.disableTooltip, then write one more
// binding into (a) an external template that was never opened and (b) a .html that IS open in the server, straight to
// disk with no LSP notification, and ask again. Then send workspace/didChangeWatchedFiles and ask again.
// It WRITES into <root> and restores the files: run it only on a throw-away copy made by make-v1-copy.mjs whose
// tsconfig.json has "strictInputAccessModifiers": true.
//
// Run:  node bench/probes/ls/verify-ngserver-disk-edit.mjs <throw-away root> --server <dir with node_modules/@angular/language-server>
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../../..");
const argv = process.argv.slice(2);
const serverDir = path.resolve(argv[argv.indexOf("--server") + 1]);
const root = path.resolve(argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--server"));
if (root.startsWith(REPO + path.sep)) { console.error("refusing to write inside the repository"); process.exit(2); }
const probe = path.join(REPO, "node_modules");
const child = spawn(process.execPath, [ path.join(serverDir, "node_modules/@angular/language-server/index.js"), "--stdio", "--tsProbeLocations", probe, "--ngProbeLocations", probe ], { cwd: root, stdio: [ "pipe", "pipe", "inherit" ] });
let buffer = Buffer.alloc(0), nextId = 0;
const pending = new Map();
const write = message => { const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message })); child.stdin.write(Buffer.concat([ Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body ])); };
child.stdout.on("data", chunk => {
    buffer = Buffer.concat([ buffer, chunk ]);
    for (;;) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
        if (buffer.length < end + 4 + length) return;
        const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
        buffer = buffer.subarray(end + 4 + length);
        if (message.id !== undefined && message.method === undefined) { pending.get(message.id)?.(message); pending.delete(message.id); }
        else if (message.id !== undefined) write({ id: message.id, result: message.method === "workspace/configuration" ? message.params.items.map(() => ({})) : null });
    }
});
const request = (method, params) => new Promise(done => { const id = ++nextId; pending.set(id, done); write({ id, method, params }); });
const notify = (method, params) => write({ method, params });
const sleep = ms => new Promise(done => setTimeout(done, ms));
const uri = file => pathToFileURL(path.join(root, file)).href;

const PILL = "src/app/lib/pill.component.ts";
const CLOSED = "src/app/features/feature-1/feature-1.component.html";   // never opened in the server
const OPEN = "src/app/features/feature-2/feature-2.component.html";     // opened with didOpen, then changed on disk only
const original = { closed: readFileSync(path.join(root, CLOSED), "utf8"), open: readFileSync(path.join(root, OPEN), "utf8"), pill: readFileSync(path.join(root, PILL), "utf8") };
const before = original.pill.slice(0, original.pill.indexOf("disableTooltip ="));
const position = { line: before.split("\n").length - 1, character: before.length - before.lastIndexOf("\n") - 1 };
const refs = async () => ((await request("textDocument/references", { textDocument: { uri: uri(PILL) }, position, context: { includeDeclaration: true } })).result ?? []).length;
const EXTRA = `<app-pill label="Added by verifier" [disableTooltip]="true" />\n`;

try {
    await request("initialize", { processId: process.pid, rootUri: pathToFileURL(root).href, workspaceFolders: [ { uri: pathToFileURL(root).href, name: "root" } ], capabilities: { workspace: { configuration: true, didChangeWatchedFiles: { dynamicRegistration: true } } } });
    notify("initialized", {});
    notify("textDocument/didOpen", { textDocument: { uri: uri(PILL), languageId: "typescript", version: 1, text: original.pill } });
    notify("textDocument/didOpen", { textDocument: { uri: uri(OPEN), languageId: "html", version: 1, text: original.open } });
    const base = await refs();
    console.log(`baseline references of PillComponent.disableTooltip: ${base}`);

    writeFileSync(path.join(root, CLOSED), EXTRA + original.closed);
    console.log(`(a) wrote one more binding to disk into a template that is NOT open in the server; asked at once: ${await refs()} (fresh answer ${base + 1})`);
    for (const wait of [ 500, 2500 ]) { await sleep(wait); console.log(`    after ${wait} ms more: ${await refs()}`); }
    notify("workspace/didChangeWatchedFiles", { changes: [ { uri: uri(CLOSED), type: 2 } ] });
    await sleep(500);
    console.log(`    after workspace/didChangeWatchedFiles for that file + 500 ms: ${await refs()}`);

    writeFileSync(path.join(root, OPEN), EXTRA + original.open);
    await sleep(2500);
    console.log(`(b) wrote one more binding to disk into a template that IS open in the server (no didChange); after 2500 ms: ${await refs()} (fresh answer ${base + 2})`);
    notify("workspace/didChangeWatchedFiles", { changes: [ { uri: uri(OPEN), type: 2 } ] });
    await sleep(500);
    console.log(`    after workspace/didChangeWatchedFiles for it + 500 ms: ${await refs()}`);
    notify("textDocument/didChange", { textDocument: { uri: uri(OPEN), version: 2 }, contentChanges: [ { text: EXTRA + original.open } ] });
    await sleep(300);
    console.log(`    after textDocument/didChange with the full new text + 300 ms: ${await refs()}`);
} finally {
    writeFileSync(path.join(root, CLOSED), original.closed); writeFileSync(path.join(root, OPEN), original.open);
    child.kill();
}
process.exit(0);
