// Live demo UI: runs the same migration (PillComponent v1 -> v2 across 120 components) in parallel lanes — find & replace,
// careful regex, the Angular compiler with a spec (ng-facts migrate), Claude with and without ng-facts — compiles each
// result with ngc, scores it against fixture-expected/, builds it with `ng build` and serves the built apps under
// /preview/<lane>/ next to the reference. Events stream to the page over SSE.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { carefulRegex, findAndReplace, SPEC_FILE } from "../bench/approaches.mjs";
import { TASK, TOOL_HINT } from "../bench/prompts.mjs";
import * as scoring from "../bench/score.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PORT ?? 4310);
const NG = path.join(ROOT, "node_modules/.bin/ng");
const NGC = path.join(ROOT, "node_modules/.bin/ngc");
const RESULTS_DIR = path.join(ROOT, "results");
const LAST_RUN_FILE = path.join(RESULTS_DIR, "ui-last-run.json");
const REPLAY_MAX_GAP_MS = 1200;
const MAX_LOG = 4000;
const BUILD_CONCURRENCY = 2;
const DEFAULT_FEATURES = 120;

const LANES = [
    { id: "expected", title: "Reference", subtitle: "the correct result, written by the generator", kind: "reference" },
    { id: "sed", title: "Find & replace", subtitle: "rename the attributes everywhere, hope for the best", kind: "text" },
    { id: "regex", title: "Careful regex", subtitle: "tag-scoped, negation, value map, label → content", kind: "text" },
    { id: "codemod", title: "Compiler + spec (execution only)", subtitle: "ng-facts migrate with a spec written beforehand — the part the agent with ng-facts hands to the compiler", kind: "codemod" },
    { id: "agent-grep", title: "Claude: files + grep", subtitle: "agent without facts", kind: "agent", tool: false },
    { id: "agent-facts", title: "Claude + ng-facts", subtitle: "agent with the compiler as a tool", kind: "agent", tool: true }
];

let state = restoredState() ?? freshState();
const clients = new Set();
const children = new Set();
const workspaceBases = new Set();
let buildSlots = BUILD_CONCURRENCY;
const buildQueue = [];

function freshState(config = {}) {
    return {
        runId: Date.now(),
        running: false,
        config,
        prep: { steps: {}, log: [], facts: null },
        lanes: Object.fromEntries(LANES.map(lane => [ lane.id, { ...lane, enabled: true, steps: {}, metrics: {}, log: [], workspace: null } ]))
    };
}

function readJson(file) {
    try {
        return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    } catch {
        return null;
    }
}

function persistRun() {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const snapshot = {
        runId: state.runId,
        finishedAt: new Date().toISOString(),
        config: state.config,
        prep: { facts: state.prep.facts, baselineErrors: state.prep.baselineErrors, steps: state.prep.steps },
        lanes: Object.fromEntries(Object.entries(state.lanes).map(([ id, lane ]) => [ id, { metrics: lane.metrics, steps: lane.steps } ]))
    };
    writeFileSync(LAST_RUN_FILE, JSON.stringify(snapshot, null, 2));
}

function restoredState() {
    const saved = readJson(LAST_RUN_FILE);
    if (!saved?.lanes) return null;
    const restored = freshState(saved.config ?? {});
    restored.runId = saved.runId ?? restored.runId;
    restored.restored = true;
    restored.finishedAt = saved.finishedAt;
    restored.prep.facts = saved.prep?.facts ?? null;
    restored.prep.baselineErrors = saved.prep?.baselineErrors;
    restored.prep.steps = saved.prep?.steps ?? {};
    for (const [ id, lane ] of Object.entries(restored.lanes)) {
        lane.enabled = lane.kind !== "agent" || restored.config.agents !== false;
        lane.metrics = saved.lanes[id]?.metrics ?? {};
        lane.steps = saved.lanes[id]?.steps ?? {};
        lane.log = [ { at: Date.now(), kind: "info", text: "restored from results/ui-last-run.json — no workspace/preview for this run" } ];
    }
    return restored;
}

function send(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) client.write(payload);
}

function target(lane) {
    return lane ? state.lanes[lane] : state.prep;
}

function log(lane, kind, text) {
    const entry = { at: Date.now(), kind, text: String(text).replace(/\x1b\[[0-9;]*m/g, "") };
    const bucket = target(lane).log;
    bucket.push(entry);
    if (bucket.length > MAX_LOG) bucket.splice(0, bucket.length - MAX_LOG);
    send({ type: "log", lane, entry });
}

function step(lane, name, status, extra = {}) {
    const steps = target(lane).steps;
    const current = steps[name] ?? {};
    const now = Date.now();
    steps[name] = { ...current, status, ...extra, startedAt: status === "running" ? now : current.startedAt, ms: status === "running" ? undefined : now - (current.startedAt ?? now) };
    send({ type: "step", lane, name, step: steps[name] });
}

function metrics(lane, values) {
    Object.assign(state.lanes[lane].metrics, values);
    send({ type: "metrics", lane, metrics: state.lanes[lane].metrics });
}

function run(lane, command, args, options = {}) {
    return new Promise(resolve => {
        log(lane, "cmd", `$ ${[ path.basename(command), ...args ].join(" ")}`);
        const child = spawn(command, args, { cwd: options.cwd ?? ROOT, env: { ...process.env, NG_CLI_ANALYTICS: "false", FORCE_COLOR: "0", ...options.env } });
        children.add(child);
        let output = "";
        const onData = chunk => {
            const text = chunk.toString();
            output += text;
            if (options.onLine) for (const line of text.split("\n")) options.onLine(line);
            else for (const line of text.split("\n")) if (line.trim()) log(lane, options.kind ?? "out", line);
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("close", code => {
            children.delete(child);
            resolve({ code, output });
        });
    });
}

function prepareWorkspace(lane, sourceDir) {
    const base = mkdtempSync(path.join(os.tmpdir(), `ng-facts-ui-${lane}-`));
    workspaceBases.add(base);
    const workspace = path.join(base, "workspace");
    cpSync(sourceDir, workspace, { recursive: true, filter: source => !/[/\\](dist|out-tsc|\.angular)([/\\]|$)/.test(source) });
    symlinkSync(path.join(ROOT, "node_modules"), path.join(base, "node_modules"));
    state.lanes[lane].workspace = workspace;
    return { base, workspace };
}

const textRefactors = { sed: findAndReplace, regex: carefulRegex };

function summarizeToolUse(block) {
    const input = block.input ?? {};
    const detail = input.command ?? input.file_path ?? input.pattern ?? input.path ?? JSON.stringify(input).slice(0, 120);
    return `${block.name}: ${String(detail).replace(/\s+/g, " ").slice(0, 220)}`;
}

function toolResultText(content) {
    const text = Array.isArray(content) ? content.map(part => part.text ?? "").join(" ") : String(content ?? "");
    return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function parseSpec(text) {
    for (const candidate of [ text, text.replace(/\\"/g, "\"") ]) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && parsed.component && parsed.inputs) return candidate;
        } catch {
            continue;
        }
    }
    return null;
}

function specFromToolUse(block) {
    const input = block.input ?? {};
    const text = block.name === "Write" ? input.content : block.name === "Bash" ? input.command : undefined;
    if (typeof text !== "string" || !text.includes("inputs") || !text.includes("component")) return null;
    return parseSpec(text) ?? parseSpec(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

function agentStream(lane, elapsedMs) {
    const seen = new Set();
    const totals = { input: 0, output: 0, turns: 0, toolCalls: 0 };
    const finals = { input: 0, output: 0, turns: 0 };
    return line => {
        if (!line.trim()) return;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            log(lane, "out", line);
            return;
        }
        if (event.type === "system" && event.subtype === "init") log(lane, "info", `session started · model ${event.model}`);
        if (event.type === "assistant") {
            const message = event.message ?? {};
            if (message.id && !seen.has(message.id)) {
                seen.add(message.id);
                const usage = message.usage ?? {};
                totals.input += (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
                totals.output += usage.output_tokens ?? 0;
                totals.turns++;
            }
            for (const block of message.content ?? []) {
                if (block.type === "text" && block.text.trim()) log(lane, "agent", block.text.trim());
                if (block.type === "tool_use") {
                    totals.toolCalls++;
                    log(lane, "tool", summarizeToolUse(block));
                    const specText = specFromToolUse(block);
                    if (specText) {
                        metrics(lane, { specText, specLines: specText.trim().split("\n").length });
                        log(lane, "facts", `spec written by the agent:\n${specText.trim()}`);
                    }
                }
            }
            metrics(lane, { turns: totals.turns, toolCalls: totals.toolCalls, inputTokens: totals.input, outputTokens: totals.output, seconds: Math.round(elapsedMs() / 1000) });
        }
        if (event.type === "user") {
            for (const block of event.message?.content ?? []) if (block.type === "tool_result") log(lane, block.is_error ? "error" : "result", toolResultText(block.content));
        }
        if (event.type === "result") {
            const usage = event.usage ?? {};
            finals.turns += event.num_turns ?? 0;
            finals.input += (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
            finals.output += usage.output_tokens ?? 0;
            metrics(lane, {
                turns: finals.turns || totals.turns,
                costUsd: event.total_cost_usd,
                inputTokens: finals.input || totals.input,
                outputTokens: finals.output || totals.output,
                seconds: Math.round(elapsedMs() / 1000)
            });
            log(lane, event.is_error ? "error" : "info", `done · ${event.num_turns} turns · $${(event.total_cost_usd ?? 0).toFixed(2)} · ${String(event.result ?? "").slice(0, 200)}`);
        }
    };
}

async function runAgent(lane, base, workspace) {
    const config = state.config;
    if (state.lanes[lane].tool) cpSync(path.join(ROOT, "tool"), path.join(base, "tools"), { recursive: true, filter: source => !source.includes(`${path.sep}specs`) });
    const started = Date.now();
    const handle = agentStream(lane, () => Date.now() - started);
    let buffer = "";
    const prompt = TASK + (state.lanes[lane].tool ? TOOL_HINT : "");
    const result = await run(lane, "claude", [
        "-p", prompt, "--output-format", "stream-json", "--verbose", "--model", config.model, "--max-budget-usd", String(config.budget),
        "--setting-sources", "project", "--strict-mcp-config",
        "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash"
    ], {
        cwd: workspace,
        onLine: chunkLine => {
            buffer += chunkLine;
            try {
                JSON.parse(buffer);
                handle(buffer);
                buffer = "";
            } catch {
                if (!buffer.trim().startsWith("{")) {
                    handle(buffer);
                    buffer = "";
                }
            }
        }
    });
    return result.code === 0;
}

/** The recorded run of `arm` whose duration is closest to the median, so the replay shows a typical run, not the best one. */
function recordingFor(arm, model) {
    if (!existsSync(RESULTS_DIR)) return null;
    const target = readJson(path.join(RESULTS_DIR, `agent-summary-${model}.json`))?.arms?.[arm]?.seconds?.median;
    const records = readdirSync(RESULTS_DIR)
        .filter(name => name.startsWith(`agent-${model}-run-`) && name.endsWith(".json"))
        .map(name => readJson(path.join(RESULTS_DIR, name)))
        .filter(record => record?.arms?.[arm]?.recording && record.arms[arm].patch && existsSync(path.join(ROOT, record.arms[arm].recording)) && existsSync(path.join(ROOT, record.arms[arm].patch)));
    if (!records.length) return null;
    const distance = record => typeof target === "number" ? Math.abs(record.arms[arm].seconds - target) : 0;
    const best = records.sort((left, right) => distance(left) - distance(right) || right.run - left.run)[0];
    return { run: best.run, startedAt: best.startedAt, ...best.arms[arm] };
}

/** Offline stand-in for runAgent: streams a recorded Claude run at `replaySpeed` and re-applies the edits that agent made. */
async function replayAgent(lane, workspace) {
    const config = state.config;
    const arm = state.lanes[lane].tool ? "tool" : "no-tool";
    const recording = recordingFor(arm, config.model);
    if (!recording) {
        log(lane, "error", `no recorded ${arm} run for ${config.model} in results/ — record one with \`node bench/agent.mjs --model ${config.model}\` (needs the API) or untick “Replay recorded agents”`);
        return false;
    }
    const speed = config.replaySpeed;
    log(lane, "info", `replay · ${recording.recording} · run ${recording.run} recorded ${String(recording.startedAt).slice(0, 16).replace("T", " ")} · ${speed}× speed · the agent's own edits are re-applied from ${recording.patch}`);
    const runId = state.runId;
    let clock = 0;
    const handle = agentStream(lane, () => clock);
    for (const row of readFileSync(path.join(ROOT, recording.recording), "utf8").split("\n")) {
        if (!row.trim()) continue;
        const tab = row.indexOf("\t");
        const at = tab > 0 ? Number(JSON.parse(row.slice(0, tab)).at) : clock;
        await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(0, (at - clock) / speed), REPLAY_MAX_GAP_MS)));
        if (state.runId !== runId || !state.running) return false;
        clock = Math.max(clock, at);
        handle(tab > 0 ? row.slice(tab + 1) : row);
    }
    const applied = await run(lane, "patch", [ "-p1", "-s", "-N", "-d", workspace, "-i", path.join(ROOT, recording.patch) ]);
    return applied.code === 0;
}

function countCompileErrors(output) {
    return output.match(/error[^\n]*?(NG|TS)\d+/g)?.length ?? 0;
}

function acquireBuildSlot() {
    if (buildSlots > 0) {
        buildSlots--;
        return Promise.resolve();
    }
    return new Promise(resolve => buildQueue.push(resolve));
}

function releaseBuildSlot() {
    const next = buildQueue.shift();
    if (next) next();
    else buildSlots++;
}

async function runLane(lane) {
    const info = state.lanes[lane];
    const runId = state.runId;
    const alive = () => state.runId === runId && state.running;
    const sourceDir = path.join(ROOT, info.kind === "reference" ? "fixture-expected" : "fixture");
    const { base, workspace } = prepareWorkspace(lane, sourceDir);
    log(lane, "info", `workspace: ${workspace}`);

    if (info.kind !== "reference") {
        step(lane, "refactor", "running");
        const started = Date.now();
        let ok = true;
        if (info.kind === "text") log(lane, "out", textRefactors[lane](workspace));
        if (info.kind === "codemod") {
            log(lane, "facts", `spec: ${readFileSync(SPEC_FILE, "utf8").replace(/\s+/g, " ")}`);
            ok = (await run(lane, "node", [ path.join(ROOT, "tool/ng-facts.mjs"), "migrate", SPEC_FILE, "--write", "--root", workspace ])).code === 0;
        }
        if (info.kind === "agent") ok = state.config.replay ? await replayAgent(lane, workspace) : await runAgent(lane, base, workspace);
        if (info.kind !== "agent") metrics(lane, { seconds: Math.round((Date.now() - started) / 100) / 10 });
        step(lane, "refactor", ok ? "ok" : "fail");
        if (!alive()) return;
    }

    step(lane, "ngc", "running");
    const compiled = await run(lane, NGC, [ "-p", path.join(workspace, "tsconfig.json") ], { kind: "compiler" });
    const compileErrors = compiled.code === 0 ? 0 : Math.max(1, countCompileErrors(compiled.output));
    if (compiled.code === 0) log(lane, "ok", "ngc --strictTemplates: 0 errors");
    metrics(lane, { compileErrors });
    step(lane, "ngc", compileErrors ? "fail" : "ok", { detail: `${compileErrors} errors` });
    if (!alive()) return;

    step(lane, "score", "running");
    const result = scoring.score(workspace);
    metrics(lane, { correct: result.correct, missed: result.missed, wrong: result.wrong, shouldChange: result.shouldChange, filesExact: result.filesExact, files: result.files });
    log(lane, result.missed || result.wrong ? "error" : "ok", `diff vs reference: ${result.correct}/${result.shouldChange} correct, ${result.missed} missed, ${result.wrong} wrong edits, ${result.filesExact}/${result.files} files identical`);
    try {
        const semantic = scoring.semanticScore?.(workspace);
        if (semantic) {
            metrics(lane, { elements: semantic.elements, elementsWrong: semantic.elementsWrong, functionallyCorrect: compileErrors === 0 && semantic.elementsWrong === 0 });
            log(lane, semantic.elementsWrong ? "error" : "ok", `compiler AST vs reference: ${semantic.elements} elements, ${semantic.elementsWrong} differ`);
            for (const detail of semantic.details ?? []) log(lane, "error", detail);
            if (semantic.extraImports) log(lane, "info", `${semantic.extraImports} unused identifiers added to @Component imports (Angular only warns — not counted)`);
        }
    } catch (error) {
        log(lane, "error", `semantic score failed: ${error.message}`);
    }
    step(lane, "score", result.missed || result.wrong ? "fail" : "ok");
    if (compileErrors) {
        step(lane, "build", "skip", { detail: "does not compile" });
        return;
    }

    step(lane, "build", "queued");
    await acquireBuildSlot();
    try {
        if (!alive()) return;
        step(lane, "build", "running");
        const built = await run(lane, NG, [ "build", "--base-href", `/preview/${lane}/` ], { cwd: workspace, kind: "build" });
        step(lane, "build", built.code === 0 ? "ok" : "fail");
        if (built.code === 0) {
            info.preview = `/preview/${lane}/`;
            send({ type: "preview", lane, url: info.preview });
        }
    } finally {
        releaseBuildSlot();
    }
}

async function runPrep() {
    const config = state.config;
    step(null, "generate", "running");
    const generated = await run(null, "node", [ path.join(ROOT, "scripts/generate.mjs") ], { env: { FEATURES: String(config.features) } });
    step(null, "generate", generated.code === 0 ? "ok" : "fail");
    if (generated.code !== 0) return false;

    step(null, "facts", "running");
    const facts = await run(null, "node", [ path.join(ROOT, "tool/ng-facts.mjs"), "usages", "PillComponent.disableTooltip", "--root", path.join(ROOT, "fixture") ], { kind: "facts" });
    const files = scoring.sources(path.join(ROOT, "fixture/src"));
    const grepFiles = files.filter(file => /app-pill|disableTooltip/.test(readFileSync(file, "utf8")));
    const grepChars = grepFiles.reduce((sum, file) => sum + statSync(file).size, 0);
    const grepLines = files.reduce((sum, file) => sum + readFileSync(file, "utf8").split("\n").filter(line => line.includes("disableTooltip")).length, 0);
    const [ , uses, useFiles, ms ] = facts.output.match(/: (\d+) uses in (\d+) files \((\d+) ms/) ?? [];
    const decoys = facts.output.match(/do not touch\): (\d+)/)?.[1];
    state.prep.facts = { uses: Number(uses), useFiles: Number(useFiles), ms: Number(ms), decoys: Number(decoys), toolTokens: Math.round(facts.output.length / 4), grepFiles: grepFiles.length, grepLines, grepTokens: Math.round(grepChars / 4), files: files.length };
    send({ type: "facts", facts: state.prep.facts });
    step(null, "facts", facts.code === 0 ? "ok" : "fail");

    step(null, "baseline", "running");
    const baseline = await run(null, NGC, [ "-p", path.join(ROOT, "fixture/tsconfig.json") ], { onLine: () => {} });
    const baselineErrors = baseline.code === 0 ? 0 : Math.max(1, countCompileErrors(baseline.output));
    log(null, "info", `library on v2, consumers on v1: ngc --strictTemplates reports ${baselineErrors} errors — fixing them is the migration's job`);
    state.prep.baselineErrors = baselineErrors;
    step(null, "baseline", "ok", { detail: `${baselineErrors} errors before migration` });
    return true;
}

async function startRun(config) {
    state = freshState(config);
    const runId = state.runId;
    state.running = true;
    for (const lane of LANES) state.lanes[lane.id].enabled = lane.kind !== "agent" || config.agents;
    send({ type: "state", state });
    const ok = await runPrep();
    if (ok) await Promise.all(LANES.filter(lane => state.lanes[lane.id].enabled).map(lane => runLane(lane.id).catch(error => log(lane.id, "error", error.stack ?? error))));
    if (state.runId !== runId) return;
    if (config.features !== DEFAULT_FEATURES) {
        log(null, "info", `restoring fixture/ to ${DEFAULT_FEATURES} features (the slides and bench/agent.mjs expect the full workspace)`);
        await run(null, "node", [ path.join(ROOT, "scripts/generate.mjs") ], { env: { FEATURES: String(DEFAULT_FEATURES) }, onLine: () => {} });
    }
    if (state.runId !== runId) return;
    state.running = false;
    persistRun();
    send({ type: "done" });
}

function resetRun() {
    for (const child of children) child.kill("SIGTERM");
    for (const base of workspaceBases) rmSync(base, { recursive: true, force: true });
    workspaceBases.clear();
    buildQueue.length = 0;
    buildSlots = BUILD_CONCURRENCY;
    state = freshState();
    send({ type: "state", state });
}

function stopRun() {
    if (!state.running) return false;
    for (const child of children) child.kill("SIGTERM");
    state.running = false;
    send({ type: "done", stopped: true });
    return true;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png" };

function serveFile(response, file) {
    if (!existsSync(file) || !statSync(file).isFile()) {
        response.writeHead(404).end("not found");
        return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(file).pipe(response);
}

function readBody(request) {
    return new Promise(resolve => {
        let body = "";
        request.on("data", chunk => body += chunk);
        request.on("end", () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                resolve(null);
            }
        });
    });
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/events") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        response.write(`data: ${JSON.stringify({ type: "state", state })}\n\n`);
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
    }
    if (url.pathname === "/api/run" && request.method === "POST") {
        if (state.running) return response.writeHead(409).end("already running");
        const body = await readBody(request);
        if (!body || typeof body !== "object") return response.writeHead(400).end("invalid json");
        const config = {
            features: Math.min(Math.max(Number(body.features) || 120, 10), 1000),
            model: [ "sonnet", "opus", "haiku" ].includes(body.model) ? body.model : "sonnet",
            budget: Math.min(Math.max(Number(body.budget) || 3, 0.5), 20),
            agents: body.agents !== false,
            replay: body.replay === true,
            replaySpeed: Math.min(Math.max(Number(body.replaySpeed) || 10, 1), 100)
        };
        startRun(config);
        return response.writeHead(202).end("started");
    }
    if (url.pathname === "/api/reset" && request.method === "POST") {
        resetRun();
        return response.writeHead(200).end("reset");
    }
    if (url.pathname === "/api/stop" && request.method === "POST") {
        return stopRun() ? response.writeHead(200).end("stopped") : response.writeHead(409).end("not running");
    }
    if (url.pathname === "/api/slides") {
        const tool = readFileSync(path.join(ROOT, "tool/ng-facts.mjs"), "utf8");
        const fn = name => {
            const start = tool.search(new RegExp(`^(export )?function ${name}\\(`, "m"));
            if (start < 0) return "";
            const end = tool.indexOf("\n}\n", start);
            return tool.slice(start, end + 2);
        };
        const between = (from, to) => {
            const start = tool.indexOf(from);
            const end = tool.indexOf(to, start);
            return start < 0 || end < 0 ? "" : tool.slice(start, end).replace(/^ {4}/gm, "").trimEnd();
        };
        let usages = "";
        try {
            usages = execFileSync("node", [ path.join(ROOT, "tool/ng-facts.mjs"), "usages", "PillComponent.disableTooltip", "--root", path.join(ROOT, "fixture") ], { encoding: "utf8" });
        } catch (error) {
            usages = String(error.stdout ?? error.message);
        }
        let dryRun = "";
        try {
            dryRun = execFileSync("node", [ path.join(ROOT, "tool/ng-facts.mjs"), "migrate", SPEC_FILE, "--root", path.join(ROOT, "fixture") ], { encoding: "utf8" });
        } catch (error) {
            dryRun = String(error.stdout ?? error.message);
        }
        const body = {
            snippets: {
                load: between("export function loadWorkspace", "    const matcher = new ng.SelectorMatcher();"),
                matcher: fn("matchedDeclarations"),
                negate: fn("negateExpression"),
                consumers: between("const { uses } = findUsages(", "    if (write) {"),
                write: between("if (write) {", "    return { edits"),
                leaves: fn("literalLeaves"),
                removal: fn("removalRange"),
                toContent: between("if (content !== undefined) {", "    for (const [ declaration, target ] of needsImport)"),
                values: between("if (rule.values) {\n                    const leaves", "            }\n            if (content !== undefined)"),
                imports: between("const elements = importsProperty.initializer.elements;", "    return { edits };\n}"),
                spec: readFileSync(SPEC_FILE, "utf8").trim(),
                toolLines: tool.split("\n").length
            },
            prompts: { task: TASK, toolHint: TOOL_HINT },
            output: { usages: usages.trim(), dryRun: dryRun.trim() },
            lanes: Object.fromEntries(Object.entries(state.lanes).map(([ id, lane ]) => [ id, { title: lane.title, kind: lane.kind, enabled: lane.enabled, metrics: lane.metrics } ])),
            facts: state.prep.facts,
            baselineErrors: state.prep.baselineErrors,
            editCount: Number(dryRun.match(/(\d+) edits/)?.[1]) || undefined,
            migrateMs: Number(dryRun.match(/\((\d+) ms\)/)?.[1]) || undefined,
            config: state.config,
            summary: readJson(path.join(RESULTS_DIR, `agent-summary-${state.config.model ?? "sonnet"}.json`)),
            restored: state.restored ?? false
        };
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return response.end(JSON.stringify(body));
    }
    if (url.pathname === "/api/results") {
        const body = { summary: readJson(path.join(RESULTS_DIR, `agent-summary-${state.config.model ?? "sonnet"}.json`)), lastRun: readJson(LAST_RUN_FILE) };
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return response.end(JSON.stringify(body));
    }
    if (url.pathname === "/slides") return serveFile(response, path.join(import.meta.dirname, "public/slides.html"));
    if (url.pathname === "/api/source") {
        const read = (base, relPath) => {
            const file = path.join(ROOT, base, relPath);
            return existsSync(file) ? readFileSync(file, "utf8") : "";
        };
        const fixtureSources = existsSync(path.join(ROOT, "fixture/src")) ? scoring.sources(path.join(ROOT, "fixture/src")) : [];
        const body = {
            pill: read("fixture", "src/app/lib/pill.component.ts"),
            pipe: read("fixture", "src/app/lib/pill-tone.pipe.ts"),
            card: read("fixture", "src/app/lib/card.component.ts"),
            template: { before: read("fixture", "src/app/features/feature-6/feature-6.component.html"), after: read("fixture-expected", "src/app/features/feature-6/feature-6.component.html") },
            feature: { before: read("fixture", "src/app/features/feature-6/feature-6.component.ts"), after: read("fixture-expected", "src/app/features/feature-6/feature-6.component.ts") },
            spec: readFileSync(SPEC_FILE, "utf8"),
            stats: { files: fixtureSources.length, features: fixtureSources.filter(file => file.endsWith(".component.ts") && file.includes("/features/")).length }
        };
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return response.end(JSON.stringify(body));
    }
    const preview = url.pathname.match(/^\/preview\/([\w-]+)(\/.*)?$/);
    if (preview) {
        const lane = state.lanes[preview[1]];
        if (!lane?.workspace) return response.writeHead(404).end("no build");
        if (!preview[2]) return response.writeHead(302, { location: `/preview/${preview[1]}/` }).end();
        const root = path.join(lane.workspace, "dist/browser");
        const requested = path.normalize(path.join(root, decodeURIComponent(preview[2])));
        if (!requested.startsWith(root)) return response.writeHead(403).end();
        return serveFile(response, existsSync(requested) && statSync(requested).isFile() ? requested : path.join(root, "index.html"));
    }
    const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.normalize(path.join(import.meta.dirname, "public", asset));
    if (!file.startsWith(path.join(import.meta.dirname, "public"))) return response.writeHead(403).end();
    return serveFile(response, file);
});

mkdirSync(path.join(import.meta.dirname, "public"), { recursive: true });
const featuresDir = path.join(ROOT, "fixture/src/app/features");
if (!existsSync(featuresDir) || readdirSync(featuresDir).length !== DEFAULT_FEATURES) {
    console.log(`fixture/ is not at ${DEFAULT_FEATURES} features — regenerating`);
    execFileSync("node", [ path.join(ROOT, "scripts/generate.mjs") ], { env: { ...process.env, FEATURES: String(DEFAULT_FEATURES) }, stdio: "ignore" });
}
server.listen(PORT, () => console.log(`Getafix's Cauldron on http://localhost:${PORT}`));
