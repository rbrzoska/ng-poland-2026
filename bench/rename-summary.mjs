// Summary tables of the rename benchmark, straight from the result files: node bench/rename-summary.mjs <model> [<model> …]
// A model is the name the runs were started with (--model), e.g. claude-sonnet-5-5. Prints one Markdown table per model:
// runs correct, cost, trips, wall-clock time, missed targets and collateral as lowest–highest, plus the total cost.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const RESULTS_DIR = path.resolve(import.meta.dirname, "..", "results", "experiments", "rename");
const ARMS = [ "no-tool", "ng-facts", "ls-facts", "skill-ng", "skill-ls", "skill-both", "strict-ng", "strict-ls", "strict-both" ];
const models = process.argv.slice(2);
if (!models.length) {
    console.error("usage: node bench/rename-summary.mjs <model> [<model> …]");
    process.exit(1);
}

const range = (values, format) => {
    if (!values.length) return "";
    const lowest = Math.min(...values);
    const highest = Math.max(...values);
    return lowest === highest ? format(lowest) : `${format(lowest)}–${format(highest)}`;
};
const money = value => `$${value.toFixed(2)}`;
const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let total = 0;
for (const model of models) {
    const pattern = new RegExp(`^rename-${escaped(model)}-run-\\d+\\.json$`);
    const records = readdirSync(RESULTS_DIR).filter(name => pattern.test(name)).map(name => JSON.parse(readFileSync(path.join(RESULTS_DIR, name), "utf8")));
    const ids = [ ...new Set(records.flatMap(record => Object.values(record.arms).map(row => row.modelId))) ];
    const budgets = [ ...new Set(records.map(record => record.budget)) ];
    console.log(`\n### ${model} (ran on ${ids.join(", ") || "?"}; ${records.length} run files; budget cap $${budgets.join(" / $")})\n`);
    console.log("| Lane | Correct | Cost | Trips | Time | Missed | Collateral |");
    console.log("|---|---|---|---|---|---|---|");
    for (const arm of ARMS) {
        const rows = records.map(record => record.arms[arm]).filter(Boolean);
        if (!rows.length) continue;
        total += rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
        const cells = [
            arm,
            `${rows.filter(row => row.functionallyCorrect).length} of ${rows.length}`,
            range(rows.map(row => row.costUsd ?? 0), money),
            range(rows.map(row => row.turns), String),
            range(rows.map(row => row.seconds), value => `${value} s`),
            range(rows.map(row => row.missed ?? 0), String),
            range(rows.map(row => row.collateral ?? 0), String)
        ];
        console.log(`| ${cells.join(" | ")} |`);
    }
}
console.log(`\nTotal cost of the listed runs: ${money(total)}`);
