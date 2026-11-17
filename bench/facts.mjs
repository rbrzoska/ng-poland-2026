// Optional, costs API money: impact-analysis questions about the fixture, answered by an agent with and without ng-facts.
//   node bench/facts.mjs [--model sonnet] [--arms no-tool,tool] [--budget 2] [--runs 1]
// No edits and no compiler error to iterate against: a wrong count stays in the answer. The answer key is derived from how
// scripts/generate.mjs builds each template style and cross-checked against the compiler before any agent runs.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findDeclaration, findUsages, loadWorkspace } from "../tool/ng-facts.mjs";
import { runClaude } from "./claude-run.mjs";
import { FACT_KEYS, FACTS_TASK, FACTS_TOOL_HINT } from "./prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS_DIR = path.join(ROOT, "results", "experiments", "facts");
const RECORDINGS_DIR = path.join(RESULTS_DIR, "recordings");
const ARM_LABELS = { "no-tool": "files + grep only", tool: "with ng-facts" };
const ARM_HINTS = { "no-tool": "", tool: FACTS_TOOL_HINT };

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(pair => pair.trim().split(/\s+/)));
const model = args.model ?? "sonnet";
const arms = (args.arms ?? "no-tool,tool").split(",");
const budget = args.budget ?? "2";
const runs = Number(args.runs ?? 1);

const STYLES = 6;
const PER_STYLE = {
    pills: [ 5, 4, 3, 3, 4, 3 ],
    legacy: [ 0, 1, 0, 0, 0, 1 ],
    literalWarning: [ 1, 1, 2, 0, 1, 0 ],
    nonLiteralVariant: [ 0, 0, 1, 1, 1, 0 ],
    withoutVariant: [ 2, 1, 0, 1, 0, 1 ]
};

/** Counts by construction: what each template style of the generator emits for feature `index`. */
function answerKey(features) {
    const key = Object.fromEntries(FACT_KEYS.map(name => [ name, 0 ]));
    for (let index = 1; index <= features; index++) {
        const style = index % STYLES;
        const canonicalNestedIsDynamic = style === 0 && index % 2 === 0;
        key.pillElements += PER_STYLE.pills[style];
        if (index % 4 === 0) key.pillElementsInInlineTemplates += PER_STYLE.pills[style];
        key.disableTooltipBindingsElsewhere += 1 + (index % 3 === 0 ? 1 : 0) + PER_STYLE.legacy[style];
        key.pillsWithLiteralWarning += PER_STYLE.literalWarning[style] + (style === 0 && !canonicalNestedIsDynamic ? 1 : 0);
        key.pillsWithNonLiteralVariant += PER_STYLE.nonLiteralVariant[style] + (canonicalNestedIsDynamic ? 1 : 0);
        key.pillsWithoutVariant += PER_STYLE.withoutVariant[style];
    }
    return key;
}

/** The same six numbers counted on the compiler's AST — a second derivation of the key. */
function compilerCount(root) {
    const workspace = loadWorkspace(root);
    const pill = findDeclaration(workspace, "PillComponent");
    const elements = findUsages(workspace, pill).uses;
    const variants = findUsages(workspace, pill, "variant").uses;
    const valueOf = entry => String(entry.binding.value?.source ?? entry.binding.value).trim();
    return {
        pillElements: elements.length,
        pillElementsInInlineTemplates: elements.filter(entry => entry.template.inline).length,
        disableTooltipBindingsElsewhere: findUsages(workspace, pill, "disableTooltip").decoys.length,
        pillsWithLiteralWarning: variants.filter(entry => valueOf(entry) === "warning" || valueOf(entry).includes("'warning'")).length,
        pillsWithNonLiteralVariant: variants.filter(entry => entry.binding.value?.source !== undefined && !valueOf(entry).includes("'")).length,
        pillsWithoutVariant: elements.length - variants.length
    };
}

function prepareWorkspace(arm) {
    const base = mkdtempSync(path.join(os.tmpdir(), `ng-facts-questions-${arm}-`));
    const workspace = path.join(base, "workspace");
    cpSync(path.join(ROOT, "fixture"), workspace, { recursive: true, filter: source => !/[/\\](dist|out-tsc|\.angular)([/\\]|$)/.test(source) });
    symlinkSync(path.join(ROOT, "node_modules"), path.join(base, "node_modules"));
    if (arm === "tool") cpSync(path.join(ROOT, "bench/tool-v1"), path.join(base, "tools"), { recursive: true });
    return workspace;
}

function readAnswers(workspace) {
    try {
        return JSON.parse(readFileSync(path.join(workspace, "answers.json"), "utf8"));
    } catch {
        return null;
    }
}

async function runArm(arm, label, key, number) {
    const workspace = prepareWorkspace(arm);
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    const recordingFile = path.join(RECORDINGS_DIR, `facts-${model}-run-${number}-${arm}.ndjson`);
    console.log(`${label} ${arm}: started`);
    const run = await runClaude({ prompt: FACTS_TASK + ARM_HINTS[arm], cwd: workspace, model, budget, recordingFile });
    const answers = readAnswers(workspace);
    const wrongKeys = FACT_KEYS.filter(name => answers?.[name] !== key[name]);
    const row = { ...run, answers, correctAnswers: FACT_KEYS.length - wrongKeys.length, wrongKeys, allCorrect: wrongKeys.length === 0, workspace, recording: path.relative(ROOT, recordingFile) };
    console.log(`${label} ${arm}: done · ${row.seconds} s · $${(row.costUsd ?? 0).toFixed(2)} · ${row.turns} turns · ${row.correctAnswers}/${FACT_KEYS.length} answers right${wrongKeys.length ? ` · wrong: ${wrongKeys.map(name => `${name}=${answers?.[name] ?? "—"} (key ${key[name]})`).join(", ")}` : ""}${row.error ? ` · ERROR ${row.error}` : ""}`);
    return row;
}

function runFiles() {
    mkdirSync(RESULTS_DIR, { recursive: true });
    return readdirSync(RESULTS_DIR)
        .map(name => ({ name, number: Number(name.match(new RegExp(`^facts-${model}-run-(\\d+)\\.json$`))?.[1]) }))
        .filter(entry => Number.isInteger(entry.number))
        .sort((left, right) => left.number - right.number);
}

function range(values, format = value => String(value)) {
    const numbers = values.filter(value => typeof value === "number");
    if (!numbers.length) return "?";
    const low = Math.min(...numbers);
    const high = Math.max(...numbers);
    return low === high ? format(low) : `${format(low)}–${format(high)}`;
}

function report(records, key) {
    const money = value => `$${value.toFixed(2)}`;
    const thousands = value => Math.round(value).toLocaleString("en");
    const armNames = Object.keys(ARM_LABELS).filter(arm => records.some(record => record.arms[arm]));
    const summary = armNames.map(arm => {
        const rows = records.map(record => record.arms[arm]).filter(Boolean);
        return `| ${ARM_LABELS[arm]} | ${rows.filter(row => row.allCorrect).length}/${rows.length} | ${range(rows.map(row => row.correctAnswers))} / ${FACT_KEYS.length} | ${range(rows.map(row => row.seconds))} s | ${range(rows.map(row => row.turns))} | ${range(rows.map(row => row.inputTokens), thousands)} | ${range(rows.map(row => row.outputTokens), thousands)} | ${range(rows.map(row => row.costUsd), money)} |`;
    });
    const perQuestion = FACT_KEYS.map(name => `| ${name} | ${key[name]} | ${armNames.map(arm => records.map(record => record.arms[arm]?.answers?.[name] ?? "—").join(", ")).join(" | ")} |`);
    const modelIds = [ ...new Set(records.flatMap(record => Object.values(record.arms).map(row => row.modelId).filter(Boolean))) ];
    return `# Facts benchmark — ${[ model, ...modelIds ].join(", ")} — ${new Date().toISOString().slice(0, 10)}\n\nSix impact-analysis questions about \`<app-pill>\` in fixture/ (no edits, so no compiler error to iterate against), ${records.length} run${records.length === 1 ? "" : "s"}, arms one after another, budget cap $${budget} per arm. Ranges are min–max over the runs. The answer key is derived from the generator's template styles and cross-checked against the compiler's AST.\n\n| Agent | Runs with all six right | Answers right | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${summary.join("\n")}\n\n## Answers per run\n\n| Question | Key | ${armNames.map(arm => ARM_LABELS[arm]).join(" | ")} |\n|---|---:|${armNames.map(() => "---").join("|")}|\n${perQuestion.join("\n")}\n`;
}

const features = readdirSync(path.join(ROOT, "fixture/src/app/features")).length;
const key = answerKey(features);
const counted = compilerCount(path.join(ROOT, "fixture"));
const disagreements = FACT_KEYS.filter(name => key[name] !== counted[name]);
if (disagreements.length) {
    console.error(`answer key and compiler disagree: ${disagreements.map(name => `${name} ${key[name]} vs ${counted[name]}`).join(", ")}`);
    process.exit(1);
}
console.log(`answer key (${features} features, confirmed by the compiler): ${JSON.stringify(key)}`);

for (let index = 0; index < runs; index++) {
    const number = 1 + (runFiles().at(-1)?.number ?? 0);
    const label = `[facts run ${number}]`;
    const rows = {};
    for (const arm of arms) rows[arm] = await runArm(arm, label, key, number);
    writeFileSync(path.join(RESULTS_DIR, `facts-${model}-run-${number}.json`), JSON.stringify({ model, run: number, startedAt: new Date().toISOString(), features, key, arms: rows }, null, 2) + "\n");
}
const records = runFiles().map(entry => JSON.parse(readFileSync(path.join(RESULTS_DIR, entry.name), "utf8")));
if (records.length) {
    const text = report(records, key);
    writeFileSync(path.join(RESULTS_DIR, `facts-results-${model}.md`), text);
    console.log("\n" + text);
}
