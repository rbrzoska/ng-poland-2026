// Optional, costs API money: the same migration done by a real AI agent (Claude Code, headless), with and without ng-facts.
//   node bench/agent.mjs [--model sonnet] [--arms no-tool,tool,own-codemod] [--budget 3] [--runs 1] [--parallel false|true]
//                        [--experiment <name>] [--features <n>] [--task migrate|discover]
// --experiment keeps the runs in results/experiments/<name>/ instead of the baseline files the UI replays; --features generates
// a fixture of that size for the experiment; --task discover withholds the mapping (the agent gets the v1 source instead).
// Each run snapshots fixture/ and fixture-expected/ first; each arm works in a fresh copy of that fixture (the answer key is not
// reachable from it) and is scored against the snapshot, so a UI run regenerating the fixture meanwhile cannot change the verdict.
// Every run is written to results/agent-<model>-run-<n>.json (numbers accumulate across invocations), the summary over all
// runs of the model to results/agent-summary-<model>.json and bench/agent-results-<model>.md.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runClaude } from "./claude-run.mjs";
import { DISCOVER_TASK, OWN_CODEMOD_HINT, PILL_V1_REFERENCE, TASK, TOOL_HINT, TOOL_V2_HINT } from "./prompts.mjs";
import * as scoring from "./score.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_FEATURES = 120;
const ARM_LABELS = { "no-tool": "files + grep only", tool: "with ng-facts", "tool-v2": "with ng-facts v2 (inline spec, built-in check)", "own-codemod": "own codemod on @angular/compiler (no tool given)" };
const ARM_HINTS = { "no-tool": "", tool: TOOL_HINT, "tool-v2": TOOL_V2_HINT, "own-codemod": OWN_CODEMOD_HINT };
const TASKS = { migrate: TASK, discover: DISCOVER_TASK };
/** The first version of the tool is kept frozen so later versions can be measured against it. */
const TOOL_SOURCES = { tool: "bench/tool-v1", "tool-v2": "tool" };
const STAT_METRICS = [ "seconds", "turns", "inputTokens", "outputTokens", "costUsd", "correct", "missed", "wrong", "compileErrors", "elementsWrong" ];
const RATIO_METRICS = [ "seconds", "costUsd", "outputTokens", "inputTokens", "turns" ];

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(pair => pair.trim().split(/\s+/)));
const model = args.model ?? "sonnet";
const arms = (args.arms ?? "no-tool,tool").split(",");
const budget = args.budget ?? "3";
const runs = Number(args.runs ?? 1);
const parallel = ["true", "1", "yes"].includes(String(args.parallel ?? "false").toLowerCase());
const experiment = args.experiment ?? null;
const features = Number(args.features ?? DEFAULT_FEATURES);
const task = args.task ?? "migrate";
const RESULTS_DIR = experiment ? path.join(ROOT, "results", "experiments", experiment) : path.join(ROOT, "results");
const RECORDINGS_DIR = path.join(RESULTS_DIR, "recordings");
const REPORT_FILE = experiment ? path.join(RESULTS_DIR, `agent-results-${model}.md`) : path.join(ROOT, `bench/agent-results-${model}.md`);
if (!experiment && (features !== DEFAULT_FEATURES || task !== "migrate" || arms.some(arm => arm !== "no-tool" && arm !== "tool"))) {
    console.error("--features, --task and extra arms need --experiment <name>: the baseline files feed the UI replay.");
    process.exit(1);
}
if (!TASKS[task] || arms.some(arm => !(arm in ARM_HINTS))) {
    console.error(`unknown task or arm — tasks: ${Object.keys(TASKS).join(", ")}; arms: ${Object.keys(ARM_HINTS).join(", ")}`);
    process.exit(1);
}

/** The repo fixture for the default size; any other size is generated once into the temp dir. */
function fixtureSource() {
    if (features === DEFAULT_FEATURES) return ROOT;
    const out = path.join(os.tmpdir(), `ng-facts-fixture-${features}`);
    if (!existsSync(path.join(out, "fixture-expected"))) execFileSync("node", [ path.join(ROOT, "scripts/generate.mjs") ], { env: { ...process.env, OUT: out, FEATURES: String(features) }, stdio: "inherit" });
    return out;
}
const SOURCE = fixtureSource();

const withoutBuildOutput = source => !/[/\\](dist|out-tsc|\.angular)([/\\]|$)/.test(source);

function snapshotReference() {
    const base = mkdtempSync(path.join(os.tmpdir(), "ng-facts-agent-reference-"));
    const reference = { base, fixtureRoot: path.join(base, "fixture"), expectedRoot: path.join(base, "fixture-expected") };
    cpSync(path.join(SOURCE, "fixture"), reference.fixtureRoot, { recursive: true, filter: withoutBuildOutput });
    cpSync(path.join(SOURCE, "fixture-expected"), reference.expectedRoot, { recursive: true, filter: withoutBuildOutput });
    reference.features = readdirSync(path.join(reference.fixtureRoot, "src/app/features")).length;
    return reference;
}

function prepareWorkspace(arm, reference) {
    const base = mkdtempSync(path.join(os.tmpdir(), `ng-facts-agent-${arm}-`));
    const workspace = path.join(base, "workspace");
    cpSync(reference.fixtureRoot, workspace, { recursive: true });
    symlinkSync(path.join(ROOT, "node_modules"), path.join(base, "node_modules"));
    if (arm in TOOL_SOURCES) cpSync(path.join(ROOT, TOOL_SOURCES[arm]), path.join(base, "tools"), { recursive: true, filter: source => !source.includes(`${path.sep}specs`) });
    if (task === "discover") writeFileSync(path.join(workspace, "src/app/lib/pill.component.v1.ts.txt"), PILL_V1_REFERENCE);
    return workspace;
}

function looksLikeSpec(text) {
    try {
        const parsed = JSON.parse(text);
        return Boolean(parsed) && typeof parsed === "object" && "component" in parsed && "inputs" in parsed;
    } catch {
        return false;
    }
}

function specFromToolUse(block) {
    const input = block.input ?? {};
    if (block.name === "Write" && typeof input.content === "string" && looksLikeSpec(input.content)) return input.content;
    if (block.name === "Bash" && typeof input.command === "string" && input.command.includes("inputs") && input.command.includes("component")) {
        const heredoc = input.command.match(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\s*$/m);
        const candidate = heredoc ? heredoc[2] : input.command.slice(input.command.indexOf("{"), input.command.lastIndexOf("}") + 1);
        return looksLikeSpec(candidate) ? candidate : null;
    }
    return null;
}

/** Unified diff of the agent's workspace against the fixture it started from, replayable with `patch -p1` (the UI's offline mode). */
function savePatch(fixtureRoot, workspace, file) {
    const links = mkdtempSync(path.join(os.tmpdir(), "ng-facts-agent-diff-"));
    symlinkSync(fixtureRoot, path.join(links, "a"));
    symlinkSync(workspace, path.join(links, "b"));
    const diff = spawnSync("diff", [ "-ruN", "-x", "out-tsc", "-x", "dist", "-x", ".angular", "-x", "node_modules", "a", "b" ], { cwd: links, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    rmSync(links, { recursive: true, force: true });
    if (diff.status > 1) return null;
    writeFileSync(file, diff.stdout);
    return path.relative(ROOT, file);
}

function scoreWorkspace(workspace, reference) {
    const compileErrors = scoring.compile(workspace);
    const semantic = scoring.semanticScore(workspace, { expectedRoot: reference.expectedRoot });
    return {
        ...scoring.score(workspace, reference),
        compileErrors,
        elements: semantic.elements,
        elementsWrong: semantic.elementsWrong,
        extraImports: semantic.extraImports,
        functionallyCorrect: compileErrors === 0 && semantic.elementsWrong === 0
    };
}

async function runArm(arm, label, reference, number) {
    const workspace = prepareWorkspace(arm, reference);
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    const recordingFile = path.join(RECORDINGS_DIR, `agent-${model}-run-${number}-${arm}.ndjson`);
    let specText = null;
    console.log(`${label} ${arm}: started`);
    const run = await runClaude({
        prompt: TASKS[task] + ARM_HINTS[arm],
        cwd: workspace,
        model,
        budget,
        recordingFile,
        onToolUse: block => { specText = specFromToolUse(block) ?? specText; }
    });
    const row = {
        ...run,
        shouldChange: null, correct: null, missed: null, wrong: null, filesExact: null, files: null,
        compileErrors: null, elements: null, elementsWrong: null, extraImports: null, functionallyCorrect: false,
        specText,
        workspace,
        recording: path.relative(ROOT, recordingFile)
    };
    try {
        row.patch = savePatch(reference.fixtureRoot, workspace, recordingFile.replace(/\.ndjson$/, ".patch"));
        Object.assign(row, scoreWorkspace(workspace, reference));
    } catch (error) {
        row.error = [ row.error, `scoring failed: ${String(error.message ?? error).slice(0, 300)}` ].filter(Boolean).join(" · ");
    }
    console.log(`${label} ${arm}: done · ${row.seconds} s · ${money(row.costUsd)} · ${row.turns} turns · ${row.correct ?? "?"}/${row.shouldChange ?? "?"} correct · ${row.compileErrors ?? "?"} ngc errors · ${row.elementsWrong ?? "?"} elements wrong${row.error ? ` · ERROR ${row.error}` : ""}`);
    return row;
}

async function runOnce(label, number) {
    const startedAt = new Date().toISOString();
    const reference = snapshotReference();
    if (reference.features !== features) console.warn(`${label} the fixture has ${reference.features} features, not ${features} — run \`node scripts/generate.mjs\` first for comparable numbers`);
    const rows = {};
    try {
        if (parallel) {
            const results = await Promise.all(arms.map(arm => runArm(arm, label, reference, number)));
            arms.forEach((arm, index) => { rows[arm] = results[index]; });
        } else {
            for (const arm of arms) rows[arm] = await runArm(arm, label, reference, number);
        }
    } finally {
        rmSync(reference.base, { recursive: true, force: true });
    }
    return { model, run: undefined, startedAt, budget: Number(budget), features: reference.features, task, parallel, arms: rows };
}

function runFiles() {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const pattern = new RegExp(`^agent-${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-run-(\\d+)\\.json$`);
    return readdirSync(RESULTS_DIR)
        .map(name => ({ name, number: Number(name.match(pattern)?.[1]) }))
        .filter(entry => Number.isInteger(entry.number))
        .sort((left, right) => left.number - right.number);
}

function nextRunNumber() {
    return 1 + (runFiles().at(-1)?.number ?? 0);
}

function median(values) {
    const sorted = [ ...values ].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function stats(values) {
    const numbers = values.filter(value => typeof value === "number" && Number.isFinite(value));
    if (!numbers.length) return { median: null, min: null, max: null };
    return { median: median(numbers), min: Math.min(...numbers), max: Math.max(...numbers) };
}

/** Arms present in the run files, known arms first — the summary covers every recorded arm, not only the ones of this invocation. */
function armsOf(records) {
    const present = new Set(records.flatMap(record => Object.keys(record.arms ?? {})));
    return [ ...Object.keys(ARM_LABELS), ...present ].filter((arm, index, all) => present.has(arm) && all.indexOf(arm) === index);
}

/** Medians cover only arms that ended with a result event; crashed arms are counted in `failedRuns` and listed under Errors. */
function armStats(records, arm) {
    const armRows = records.map(record => record.arms?.[arm]).filter(Boolean);
    const scored = armRows.filter(row => typeof row.costUsd === "number");
    const result = Object.fromEntries(STAT_METRICS.map(metric => [ metric, stats(scored.map(row => row[metric])) ]));
    result.functionallyCorrectRuns = scored.filter(row => row.functionallyCorrect).length;
    result.failedRuns = armRows.length - scored.length;
    result.shouldChange = scored.find(row => typeof row.shouldChange === "number")?.shouldChange ?? null;
    return result;
}

function ratio(numerator, denominator) {
    if (typeof numerator !== "number" || typeof denominator !== "number" || !denominator) return null;
    return Math.round(numerator / denominator * 10) / 10;
}

function summarize(records) {
    const armSummaries = Object.fromEntries(armsOf(records).map(arm => [ arm, armStats(records, arm) ]));
    const ratios = Object.fromEntries(RATIO_METRICS.map(metric => [ metric, ratio(armSummaries["no-tool"]?.[metric].median, armSummaries.tool?.[metric].median) ]));
    const specText = [ ...records ].reverse().map(record => record.arms?.tool?.specText).find(text => typeof text === "string") ?? null;
    const modelIds = [ ...new Set(records.flatMap(record => Object.values(record.arms ?? {}).map(row => row.modelId).filter(Boolean))) ];
    const parallelRuns = records.filter(record => record.parallel ?? true).length;
    return { model, modelIds, experiment, task, features, runs: records.length, parallelRuns, updatedAt: new Date().toISOString(), arms: armSummaries, ratios, specText, specLines: specText ? specText.trim().split("\n").length : 0 };
}

function money(value) {
    return typeof value === "number" ? `$${value.toFixed(2)}` : "?";
}

function count(value) {
    return typeof value === "number" ? Math.round(value).toLocaleString("en") : "?";
}

function ranged(stat, format = count, unit = "") {
    if (stat.median === null) return "?";
    const range = stat.min === stat.max ? "" : ` (${format(stat.min)}–${format(stat.max)})`;
    return `${format(stat.median)}${unit}${range}`;
}

function markdown(summary, records) {
    const recordArms = Object.keys(summary.arms);
    const shouldChange = Object.values(summary.arms).find(arm => arm.shouldChange !== null)?.shouldChange ?? "?";
    const medians = [
        `| Agent (${model}) | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost | Correct / ${shouldChange} | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct |`,
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
        ...recordArms.map(arm => {
            const stat = summary.arms[arm];
            const scoredRuns = records.filter(record => typeof record.arms?.[arm]?.costUsd === "number").length;
            return `| ${ARM_LABELS[arm] ?? arm} | ${ranged(stat.seconds, count, " s")} | ${ranged(stat.turns)} | ${ranged(stat.inputTokens)} | ${ranged(stat.outputTokens)} | ${ranged(stat.costUsd, money)} | ${ranged(stat.correct)} | ${ranged(stat.missed)} | ${ranged(stat.wrong)} | ${ranged(stat.compileErrors)} | ${ranged(stat.elementsWrong)} | ${stat.functionallyCorrectRuns}/${scoredRuns} |`;
        })
    ].join("\n");
    const ratios = summary.ratios;
    const scoredRuns = summary.runs - Math.max(0, ...recordArms.map(arm => summary.arms[arm].failedRuns));
    const ratioLine = ratios.seconds === null ? "" : `\n**tool arm: ${ratios.seconds}× faster, ${ratios.costUsd ?? "?"}× cheaper, ${ratios.outputTokens ?? "?"}× fewer output tokens, ${ratios.inputTokens ?? "?"}× fewer input tokens, ${ratios.turns ?? "?"}× fewer turns** (median of ${scoredRuns}${scoredRuns === summary.runs ? "" : ` of ${summary.runs}`} run${summary.runs === 1 ? "" : "s"})\n`;
    const failed = recordArms.filter(arm => summary.arms[arm].failedRuns).map(arm => `${summary.arms[arm].failedRuns} ${ARM_LABELS[arm] ?? arm} run${summary.arms[arm].failedRuns === 1 ? "" : "s"}`);
    const failedLine = failed.length ? `\n_${failed.join(" and ")} ended without a result event and are excluded from the medians — see Errors._\n` : "";
    const perRun = [
        "| Run | Agent | Started | Time | Turns | Tool calls | Input tokens | Output tokens | Cost | Correct | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct | Workspace |",
        "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|",
        ...records.flatMap(record => recordArms.filter(arm => record.arms?.[arm]).map(arm => {
            const row = record.arms[arm];
            return `| ${record.run} | ${ARM_LABELS[arm] ?? arm} | ${record.startedAt.slice(0, 16).replace("T", " ")} | ${row.seconds} s | ${row.turns ?? "?"} | ${row.toolCalls ?? "?"} | ${count(row.inputTokens)} | ${count(row.outputTokens)} | ${money(row.costUsd)} | ${row.correct ?? "?"} | ${row.missed ?? "?"} | ${row.wrong ?? "?"} | ${row.compileErrors ?? "?"} | ${row.elementsWrong ?? "?"} | ${row.functionallyCorrect ? "yes" : "no"} | ${row.workspace} |`;
        }))
    ].join("\n");
    const errors = records.flatMap(record => recordArms.filter(arm => record.arms?.[arm]?.error).map(arm => `- run ${record.run}, ${arm}: ${record.arms[arm].error}`)).join("\n");
    const spec = summary.specText ? `\n## Spec written by the tool agent (latest run, ${summary.specLines} lines)\n\n\`\`\`json\n${summary.specText.trim()}\n\`\`\`\n` : "";
    return `# Agent benchmark — ${model} — ${summary.updatedAt.slice(0, 10)}\n\nTask: same migration as bench/run.mjs, done by Claude Code headless (${[ model, ...summary.modelIds ].join(", ")}, budget cap $${budget} per arm, ${summary.features} feature components, task "${summary.task}", ${summary.runs} run${summary.runs === 1 ? "" : "s"}: ${summary.parallelRuns} with the arms in parallel, ${summary.runs - summary.parallelRuns} one after another). Medians with (min–max) ranges; Time = wall clock from spawn to the agent's final result (an agent waiting on its own hung command pays for it); "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST (formatting does not count, unused extra imports do not count).\n\n${medians}\n${ratioLine}${failedLine}\n## Runs\n\n${perRun}\n${errors ? `\n## Errors\n\n${errors}\n` : ""}${spec}`;
}

function recomputeSummary() {
    const records = runFiles().map(entry => JSON.parse(readFileSync(path.join(RESULTS_DIR, entry.name), "utf8")));
    const summary = summarize(records);
    writeFileSync(path.join(RESULTS_DIR, `agent-summary-${model}.json`), JSON.stringify(summary, null, 2) + "\n");
    const report = markdown(summary, records);
    writeFileSync(REPORT_FILE, report);
    return report;
}

if (!existsSync(path.join(SOURCE, "fixture-expected"))) {
    console.error("fixture-expected/ is missing: run `npm run generate` first.");
    process.exit(1);
}

let report = runs === 0 ? recomputeSummary() : "";
for (let index = 0; index < runs; index++) {
    const number = nextRunNumber();
    const label = `[run ${number}]`;
    const record = await runOnce(label, number);
    record.run = number;
    writeFileSync(path.join(RESULTS_DIR, `agent-${model}-run-${number}.json`), JSON.stringify(record, null, 2) + "\n");
    report = recomputeSummary();
    console.log(`${label} written ${path.relative(ROOT, RESULTS_DIR)}/agent-${model}-run-${number}.json, summary over ${runFiles().length} run(s) recomputed`);
}
console.log("\n" + report);
