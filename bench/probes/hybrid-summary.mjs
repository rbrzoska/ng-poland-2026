// One line per model and lane for the hybrid experiment: node bench/probes/hybrid-summary.mjs
// Reads results/experiments/hybrid/hybrid-<model>-run-<n>.json; every figure is lowest–highest over the runs, nothing averaged.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const directory = path.resolve(import.meta.dirname, "../../results/experiments/hybrid");
const lanes = {};
for (const name of readdirSync(directory).filter(file => /^hybrid-.*-run-\d+\.json$/.test(file))) {
    const record = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
    for (const [ arm, row ] of Object.entries(record.arms)) (lanes[`${record.model}|${arm}`] ??= []).push(row);
}
const range = (values, format = value => String(value)) => {
    const low = Math.min(...values);
    const high = Math.max(...values);
    return low === high ? format(low) : `${format(low)}–${format(high)}`;
};
for (const [ lane, rows ] of Object.entries(lanes).sort()) {
    console.log([
        lane.padEnd(16),
        `all six right ${rows.filter(row => row.allCorrect).length}/${rows.length}`,
        `answers right ${range(rows.map(row => row.correctAnswers))}/6`,
        `cost $${range(rows.map(row => row.costUsd), value => value.toFixed(2))}`,
        `turns ${range(rows.map(row => row.turns))}`,
        `sent ${range(rows.map(row => Math.round(row.inputTokens / 1000)))}k`,
        `written ${range(rows.map(row => Math.round(row.outputTokens / 100) / 10))}k`,
        `seconds ${range(rows.map(row => row.seconds))}`,
        [ ...new Set(rows.map(row => row.modelId)) ].join(","),
        rows.map(row => row.wrongKeys?.join("+") || "ok").join(" | ")
    ].join("  "));
}
