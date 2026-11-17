// Collects every recorded agent run into one table of ranges (min–max): node bench/evidence.mjs → bench/evidence.md.
// No API calls. Time is given twice: wall clock, and the part spent waiting for the model (read back from the recordings).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const RESULTS = path.join(ROOT, "results");
export const ARM_LABELS = { "no-tool": "Obelix · files + grep", tool: "Asterix · ng-facts", "tool-v2": "Asterix · ng-facts v2", "own-codemod": "Obelix told to write his own codemod on @angular/compiler" };

const SERIES = [
    { id: "baseline", title: "Migration, 120 components, mapping given in the task", dir: RESULTS, prefix: "agent-sonnet-run-" },
    { id: "scale-30", title: "Migration, 30 components", dir: path.join(RESULTS, "experiments/scale-30"), prefix: "agent-sonnet-run-" },
    { id: "scale-480", title: "Migration, 480 components", dir: path.join(RESULTS, "experiments/scale-480"), prefix: "agent-sonnet-run-" },
    { id: "own-codemod", title: "Migration, 120 components, no tool: the agent builds its own codemod on the compiler", dir: path.join(RESULTS, "experiments/own-codemod"), prefix: "agent-sonnet-run-" },
    { id: "discover", title: "Migration, 120 components, mapping NOT given: the agent derives it from the v1 source", dir: path.join(RESULTS, "experiments/discover"), prefix: "agent-sonnet-run-" },
    { id: "tool-v2", title: "Migration, 120 components, tool improved from the recordings: inline spec, format in the hint, built-in compiler check", dir: path.join(RESULTS, "experiments/tool-v2"), prefix: "agent-sonnet-run-" },
    { id: "haiku", title: "Migration, 120 components, smaller model (Haiku)", dir: path.join(RESULTS, "experiments/haiku"), prefix: "agent-haiku-run-" },
    { id: "facts", title: "Six impact-analysis questions about one component, 120 components, no edits", dir: path.join(RESULTS, "experiments/facts"), prefix: "facts-sonnet-run-", questions: 6 },
    { id: "atlas-blast", title: "Blast radius on a routed app (105 components): which routes can show a component, which components are dead — no edits; v1 = the tool as written for the migration, v2 = with the where and unrouted commands", dir: path.join(RESULTS, "experiments/atlas-blast"), prefix: "atlas-blast-sonnet-run-", questions: 4 },
    { id: "atlas-a11y", title: "Accessibility sweep on the same app: label the 75 icon buttons that have no accessible name — one judgement per place, tool unchanged", dir: path.join(RESULTS, "experiments/atlas-a11y"), prefix: "atlas-a11y-sonnet-run-", a11y: true },
    // bench/hybrid.mjs, one series per model; the tool in the "tool" lane is ajs-facts (tool/ajs-facts.mjs), not ng-facts.
    ...[ "Haiku", "Sonnet", "Opus", "Fable" ].map(model => ({
        id: `hybrid-${model.toLowerCase()}`,
        title: `Six migration-planning questions about a hybrid AngularJS + Angular app (40 AngularJS components), no edits - ${model}`,
        dir: path.join(RESULTS, "experiments/hybrid"),
        prefix: `hybrid-${model.toLowerCase()}-run-`,
        questions: 6,
        toolName: "ajs-facts"
    }))
];

/** The lane's label; a series whose tool is not ng-facts names its own tool in the same place. */
const armLabel = (series, arm) => (ARM_LABELS[arm] ?? arm).replace("ng-facts", series.toolName ?? "ng-facts");

export function range(values, format = value => String(Math.round(value))) {
    const numbers = values.filter(value => typeof value === "number" && Number.isFinite(value));
    if (!numbers.length) return "—";
    const low = format(Math.min(...numbers));
    const high = format(Math.max(...numbers));
    return low === high ? low : `${low}–${high}`;
}

export const money = value => `$${value.toFixed(2)}`;
export const thousands = value => `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} k`;
export const times = value => `${value.toFixed(1)}×`;

/** Seconds the run spent waiting for the model: the sum of `duration_api_ms` over the result events of its recording. */
function modelSeconds(row) {
    if (typeof row.modelSeconds === "number") return row.modelSeconds;
    const file = row.recording && path.join(ROOT, row.recording);
    if (!file || !existsSync(file)) return null;
    let total = 0;
    for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.includes('"type":"result"')) continue;
        try {
            total += JSON.parse(line.slice(line.indexOf("\t") + 1)).duration_api_ms ?? 0;
        } catch {
            continue;
        }
    }
    return total ? Math.round(total / 1000) : null;
}

function loadSeries(series) {
    const isFacts = Boolean(series.questions);
    const records = !existsSync(series.dir) ? [] : readdirSync(series.dir)
        .filter(name => name.startsWith(series.prefix) && name.endsWith(".json"))
        .map(name => JSON.parse(readFileSync(path.join(series.dir, name), "utf8")))
        .sort((left, right) => left.run - right.run);
    for (const record of records) for (const row of Object.values(record.arms)) row.modelSeconds = modelSeconds(row);
    const present = new Set(records.flatMap(record => Object.keys(record.arms)));
    const armNames = [ ...Object.keys(ARM_LABELS).filter(arm => present.has(arm)), ...[ ...present ].filter(arm => !(arm in ARM_LABELS)) ];
    const arms = Object.fromEntries(armNames.map(arm => {
        const runs = records.map(record => record.arms[arm]).filter(row => row && typeof row.costUsd === "number");
        return [ arm, { runs, correctRuns: runs.filter(row => (isFacts ? row.allCorrect : row.functionallyCorrect)).length, of: metric => runs.map(row => row[metric]) } ];
    }));
    const pairs = records.filter(record => typeof record.arms["no-tool"]?.costUsd === "number" && typeof record.arms.tool?.costUsd === "number");
    const ratios = metric => pairs.map(record => record.arms["no-tool"][metric] / record.arms.tool[metric]);
    return {
        ...series,
        isFacts,
        records,
        arms,
        pairs,
        ratios,
        parallelRuns: records.filter(record => record.parallel ?? series.id === "baseline").length,
        modelIds: [ ...new Set(records.flatMap(record => Object.values(record.arms).map(row => row.modelId).filter(Boolean))) ]
    };
}

/** Every series keyed by id; `arms[arm].of(metric)` lists that metric over the arm's runs, `ratios(metric)` the per-run grep ÷ ng-facts. */
export function collect() {
    return Object.fromEntries(SERIES.map(series => [ series.id, loadSeries(series) ]));
}

function section(series) {
    if (!series.records.length) return `## ${series.title}\n\n_No runs recorded._\n`;
    const rows = Object.entries(series.arms).map(([ arm, data ]) => {
        const quality = series.isFacts ? `${range(data.of("correctAnswers"))} of ${series.questions} answers`
            : series.a11y ? `${range(data.of("stillMissing"))} still unlabelled, ${range(data.of("collateral"))} collateral changes, ${range(data.of("implausible"))} implausible labels, ${range(data.of("compileErrors"))} ngc errors`
            : `${range(data.of("compileErrors"))} ngc errors, ${range(data.of("elementsWrong"))} elements wrong`;
        return `| ${armLabel(series, arm)} | ${data.runs.length} | ${data.correctRuns}/${data.runs.length} | ${quality} | ${range(data.of("seconds"))} s | ${range(data.of("modelSeconds"))} s | ${range(data.of("turns"))} | ${range(data.of("inputTokens"), thousands)} | ${range(data.of("outputTokens"), thousands)} | ${range(data.of("costUsd"), money)} |`;
    });
    const ratio = metric => range(series.ratios(metric), times);
    const ratios = series.pairs.length ? `\nSame run, grep ÷ ${series.toolName ?? "ng-facts"} (${series.pairs.length} pairs): cost ${ratio("costUsd")}, input tokens ${ratio("inputTokens")}, output tokens ${ratio("outputTokens")}, turns ${ratio("turns")}, wall-clock time ${ratio("seconds")}, model time ${ratio("modelSeconds")}.\n` : "";
    const order = series.parallelRuns ? `, ${series.parallelRuns} of them with the arms in parallel` : ", arms one after another";
    return `## ${series.title}\n\n${series.modelIds.join(", ")} · ${series.records.length} run${series.records.length === 1 ? "" : "s"}${order}\n\n| Agent | Runs | ${series.isFacts ? "All answers right" : "Functionally correct"} | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |\n|---|---:|---:|---|---:|---:|---:|---:|---:|---:|\n${rows.join("\n")}\n${ratios}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const text = `# Evidence — every recorded agent run, as ranges\n\nGenerated ${new Date().toISOString().slice(0, 10)} by \`node bench/evidence.mjs\`. Every cell is min–max over the runs of that lane; nothing is averaged. Input tokens include cache reads. Wall clock runs from spawn to the agent's final answer, so an agent that hangs on its own shell command pays for it; model time is the part spent waiting for the model. "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST; for the accessibility sweep: every target labelled, nothing else changed, 0 ngc errors.\n\n${Object.values(collect()).map(section).join("\n")}`;
    writeFileSync(path.join(ROOT, "bench/evidence.md"), text);
    console.log(text);
}
