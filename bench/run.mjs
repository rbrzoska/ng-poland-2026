// Benchmark: migrate fixture/ (library already on PillComponent v2, consumers still on v1) three ways,
// scored against fixture-expected/ and judged by the Angular compiler (ngc, strictTemplates).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { carefulRegex, compilerMigration, findAndReplace } from "./approaches.mjs";
import { compile, score, semanticScore, sources } from "./score.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORK = path.join(ROOT, ".work");

const approaches = {
    "find & replace": findAndReplace,
    "careful regex (tag-scoped)": carefulRegex,
    "Angular compiler + spec (ng-facts migrate)": compilerMigration
};

function prepare(name) {
    const target = path.join(WORK, name.replace(/\W+/g, "-").toLowerCase());
    rmSync(target, { recursive: true, force: true });
    cpSync(path.join(ROOT, "fixture"), target, { recursive: true, filter: source => !/[/\\](dist|\.angular)([/\\]|$)/.test(source) });
    return target;
}

function contextCost() {
    const files = sources(path.join(ROOT, "fixture", "src"));
    const consumers = files.filter(file => /<app-pill|app-pill/.test(readFileSync(file, "utf8")) && !file.includes(`${path.sep}lib${path.sep}`));
    const chars = consumers.reduce((sum, file) => sum + readFileSync(file, "utf8").length, 0);
    const started = performance.now();
    const output = execFileSync("node", [ path.join(ROOT, "tool/ng-facts.mjs"), "migrate", path.join(ROOT, "tool/specs/pill-v2.migration.json"), "--root", path.join(ROOT, "fixture") ], { encoding: "utf8" });
    return { files: consumers.length, readTokens: Math.round(chars / 4), toolTokens: Math.round(output.length / 4), toolMs: Math.round(performance.now() - started) };
}

if (!existsSync(path.join(ROOT, "fixture-expected"))) execFileSync("node", [ path.join(ROOT, "scripts/generate.mjs") ], { stdio: "inherit" });

const rows = [];
for (const [ name, apply ] of Object.entries(approaches)) {
    const dir = prepare(name);
    const started = performance.now();
    apply(dir);
    const ms = Math.round(performance.now() - started);
    const compileErrors = compile(dir);
    const { elementsWrong } = semanticScore(dir);
    rows.push({ name, ms, ...score(dir), elementsWrong, compileErrors, functionallyCorrect: compileErrors === 0 && elementsWrong === 0 });
}
const context = contextCost();
const baseline = compile(path.join(ROOT, "fixture"));

const table = [
    "| Approach | Time | Lines to change | Correct | Missed | Wrong lines | Files exactly right | ngc errors (strictTemplates) | Elements wrong (compiler AST) | Functionally correct |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|",
    ...rows.map(row => `| ${row.name} | ${row.ms} ms | ${row.shouldChange} | ${row.correct} | ${row.missed} | ${row.wrong} | ${row.filesExact}/${row.files} | ${row.compileErrors} | ${row.elementsWrong} | ${row.functionallyCorrect ? "✓" : "✗"} |`)
].join("\n");

const report = `# Benchmark: migrate 120 Angular components to a new component API

The library ships \`PillComponent\` v2; consumers still use v1, so the workspace does not compile (${baseline} ngc errors).
Migration: \`disableTooltip\` → \`tooltip\` (negated), \`variant\` → \`tone\` (values mapped, also inside \`?:\`; non-literal values get the \`pillTone\` pipe and \`PillTonePipe\` added to the component's imports), \`label\` → element content.
Referee: \`ngc --strictTemplates\`, a line-aligned diff against the correct result, and the Angular compiler's template AST compared element by element with the correct result (formatting-insensitive, expressions compared by structure; also checks each component's \`imports\` — a missing import counts, an extra unused one is only reported, as Angular itself only warns about it).

${table}

Reading the consumers to do it by hand: ${context.files} files, ~${context.readTokens.toLocaleString("en")} tokens. The tool's whole answer: ~${context.toolTokens} tokens in ${context.toolMs} ms.
`;
writeFileSync(path.join(ROOT, "bench/results.md"), report);
console.log(report);
