// Optional, costs API money: six migration-planning questions about hybrid/ (an AngularJS + Angular app, scripts/generate-hybrid.mjs),
// answered by an agent with and without ajs-facts. Questions only, no edits: a wrong name stays in the answer.
//   node bench/hybrid.mjs [--model sonnet] [--arms no-tool,tool] [--budget 3] [--runs 1] [--keep]
//   node bench/hybrid.mjs --check                 no API call: the six answers derived from tool/ajs-facts.mjs must equal hybrid-key.json
//   node bench/hybrid.mjs --score <workspace>     no API call: scores the answers.json of an existing workspace against the key
// The key (hybrid-key.json, next to the fixture, never inside it) comes from the generator's model; the tool reads only the files.
// Every agent run starts with the same cross-check as --check and refuses to run when the two disagree.
// Both arms work in a copy of the fixture with the same parser packages (typescript, @angular/compiler) copied next to it; nothing
// in a workspace links back to this repository, and the workspace is removed after scoring unless --keep is given.
// OUT=<dir> reads <dir>/hybrid and <dir>/hybrid-key.json instead of the ones in the repository root.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runClaude } from "./claude-run.mjs";
import { HYBRID_KEYS, HYBRID_TASK, HYBRID_TOOL_HINT } from "./prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = process.env.OUT ?? ROOT;
const HYBRID = path.join(OUT, "hybrid");
const KEY_FILE = path.join(OUT, "hybrid-key.json");
const TOOL_FILE = path.join(ROOT, "tool", "ajs-facts.mjs");
const RESULTS_DIR = path.join(ROOT, "results", "experiments", "hybrid");
const RECORDINGS_DIR = path.join(RESULTS_DIR, "recordings");
const ARM_LABELS = { "no-tool": "files, grep and shell", tool: "with ajs-facts" };
const ARM_HINTS = { "no-tool": "", tool: HYBRID_TOOL_HINT };
const GENERATE_FIRST = "run node scripts/generate-hybrid.mjs first";
const USAGE = "usage: node bench/hybrid.mjs [--model sonnet] [--arms no-tool,tool] [--budget 3] [--runs 1] [--keep] | --check | --score <workspace>";
/** What every workspace gets in ../node_modules (with whatever these depend on): the packages a real hybrid app has installed anyway. */
const WORKSPACE_PACKAGES = [ "@angular/compiler", "typescript" ];
/** Files of the fixture that are about the benchmark, not about the app: they stay behind. */
const NOT_COPIED = /(^|[/\\])(node_modules|answers\.json|hybrid-key\.json|README\.md)([/\\]|$)/;
const WORKSPACE_PREFIX = "ajs-facts-hybrid-";
/** The one question that is a count: how many elements render this component. */
const COUNTED_KEY = "standardBearerElements";
const COUNTED_COMPONENT = "standardBearer";
/** Counts of the key's "sizes" that the tool's index can confirm; the others (files, lines, Angular components) are not in the index. */
const INVENTORY = {
    ajsComponents: index => index.components.length,
    ajsDirectives: index => index.directives.length,
    ajsFilters: index => index.filters.length,
    ajsServices: index => index.services.length,
    downgradedComponents: index => index.downgrades.filter(downgrade => downgrade.kind === "component").length,
    downgradedInjectables: index => index.downgrades.filter(downgrade => downgrade.kind === "injectable").length,
    upgradeWrappers: index => index.wrappers.length,
    states: index => index.states.length
};

/** `--name value` pairs and bare `--flag`s (stored as true). */
function parseArguments(tokens) {
    const parsed = {};
    for (let position = 0; position < tokens.length; position++) {
        if (!tokens[position].startsWith("--")) continue;
        const next = tokens[position + 1];
        const hasValue = next !== undefined && !next.startsWith("--");
        parsed[tokens[position].slice(2)] = hasValue ? next : true;
        if (hasValue) position++;
    }
    return parsed;
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

const sorted = names => [ ...names ].sort();
const namesOf = entries => sorted(entries.map(entry => entry.name));

/**
 * The six answers read off the index of tool/ajs-facts.mjs, one line per definition in the task:
 * dead = no use at all (the tool adds a "wrapper" use only when the wrapper's selector is used in an Angular template),
 * leaf = the template renders no AngularJS component or directive, twin = an Angular @Component with the same selector.
 */
export function deriveAnswers(index) {
    const counted = index.components.find(component => component.name === COUNTED_COMPONENT);
    return {
        deadComponents: namesOf(index.components.filter(component => component.usedBy.length === 0)),
        leafComponents: namesOf(index.components.filter(component => !component.templateMissing && component.renders.length === 0)),
        standardBearerElements: counted ? counted.usedBy.filter(use => use.kind === "template").length : null,
        unusedFilters: namesOf(index.filters.filter(filter => filter.usedBy.length === 0)),
        twinComponents: namesOf(index.components.filter(component => component.twin)),
        unusedServices: namesOf(index.services.filter(service => service.usedBy.length === 0))
    };
}

/**
 * Arrays are compared as sets of strings (order-free, exact names), the count exactly. Per question: right or wrong, and for the
 * arrays which names of the key are missing from the answer and which names in the answer are not in the key.
 */
export function scoreAnswers(answers, key, problem) {
    const details = Object.fromEntries(HYBRID_KEYS.map(name => {
        const expected = key[name];
        const given = answers?.[name];
        if (!Array.isArray(expected)) return [ name, { right: given === expected, expected, given: given ?? null, ...(problem ? { note: problem } : {}) } ];
        if (!Array.isArray(given)) return [ name, { right: false, expected: expected.length, missing: sorted(expected), extra: [], note: problem ?? (given === undefined ? "no answer" : "the answer is not an array") } ];
        const givenNames = new Set(given.map(entry => (typeof entry === "string" ? entry : JSON.stringify(entry))));
        const expectedNames = new Set(expected);
        const missing = sorted(expected.filter(entry => !givenNames.has(entry)));
        const extra = sorted([ ...givenNames ].filter(entry => !expectedNames.has(entry)));
        return [ name, { right: missing.length === 0 && extra.length === 0, expected: expected.length, missing, extra } ];
    }));
    const wrongKeys = HYBRID_KEYS.filter(name => !details[name].right);
    return { answers: answers ?? null, ...(problem ? { answersProblem: problem } : {}), correctAnswers: HYBRID_KEYS.length - wrongKeys.length, wrongKeys, details, allCorrect: wrongKeys.length === 0 };
}

/** One wrong question in words: "deadComponents: missing a, b; extra c" or "standardBearerElements: 11 (key 9)". */
function describe(name, detail) {
    if (!("missing" in detail)) return `${name}: ${detail.given === null ? detail.note ?? "no answer" : JSON.stringify(detail.given)} (key ${detail.expected})`;
    if (detail.note) return `${name}: ${detail.note} (key has ${detail.expected})`;
    const parts = [ detail.missing.length ? `missing ${detail.missing.join(", ")}` : "", detail.extra.length ? `extra ${detail.extra.join(", ")}` : "" ].filter(Boolean);
    return `${name}: ${parts.join("; ")}`;
}

function loadKey() {
    if (!existsSync(KEY_FILE)) fail(`${path.relative(ROOT, KEY_FILE) || KEY_FILE} is missing: ${GENERATE_FIRST}`);
    let key;
    try {
        key = JSON.parse(readFileSync(KEY_FILE, "utf8"));
    } catch (error) {
        fail(`${KEY_FILE} is not valid JSON (${error.message}): ${GENERATE_FIRST}`);
    }
    const absent = HYBRID_KEYS.filter(name => key.answers?.[name] === undefined);
    if (absent.length) fail(`${KEY_FILE} has no answer for ${absent.join(", ")}: ${GENERATE_FIRST}`);
    return key;
}

/** The generator's model and the parsers must agree before any agent is asked: the six answers, derived twice. */
async function crossCheck(key) {
    if (!existsSync(path.join(HYBRID, "src"))) fail(`${path.relative(ROOT, HYBRID) || HYBRID}/ is missing: ${GENERATE_FIRST}`);
    if (!existsSync(TOOL_FILE)) fail("tool/ajs-facts.mjs is missing: the answer key cannot be confirmed without the tool");
    let index;
    try {
        const { loadHybrid } = await import(pathToFileURL(TOOL_FILE).href);
        index = loadHybrid(HYBRID);
    } catch (error) {
        fail(`tool/ajs-facts.mjs could not read ${HYBRID}: ${error.stack ?? error}`);
    }
    const verdict = scoreAnswers(deriveAnswers(index), key.answers);
    const inventory = Object.entries(INVENTORY)
        .map(([ name, count ]) => [ name, count(index), key.sizes?.[name] ])
        .filter(([ , counted, expected ]) => expected !== undefined && counted !== expected);
    if (index.notes?.length) console.warn(`note: the tool could not read ${index.notes.length} place${index.notes.length === 1 ? "" : "s"} of the fixture with certainty (node tool/ajs-facts.mjs summary --root ${path.relative(ROOT, HYBRID) || HYBRID} lists them)`);
    if (inventory.length) console.warn(`note: the tool and the generator count the app differently (tool vs key): ${inventory.map(([ name, counted, expected ]) => `${name} ${counted} vs ${expected}`).join(", ")}`);
    if (!verdict.allCorrect) {
        console.error(`answer key and tool disagree on ${verdict.wrongKeys.length} of ${HYBRID_KEYS.length} questions ("missing" = in the key but not found by the tool, "extra" = found by the tool but not in the key):`);
        for (const name of verdict.wrongKeys) {
            const detail = verdict.details[name];
            console.error(`  ${"missing" in detail ? describe(name, detail) : `${name}: tool ${detail.given ?? "found no such component"}, key ${detail.expected}`}`);
        }
        process.exit(1);
    }
    const sizes = HYBRID_KEYS.map(name => `${name} ${Array.isArray(key.answers[name]) ? key.answers[name].length : key.answers[name]}`).join(", ");
    console.log(`key confirmed by the tool: ${sizes}`);
}

/**
 * The answers.json of a workspace as { answers, problem }: a missing file, text that is not JSON and JSON that is not an object are
 * three different problems, not three silent zeros. A byte order mark and UTF-16 (what Windows PowerShell 5.1 writes) are read.
 */
export function readAnswers(workspace) {
    const file = path.join(workspace, "answers.json");
    if (!existsSync(file)) return { answers: null, problem: "no answers.json" };
    try {
        const bytes = readFileSync(file);
        const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString("utf16le") : bytes.toString("utf8");
        const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
        const isObject = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
        return isObject ? { answers: parsed } : { answers: null, problem: "answers.json is not a JSON object" };
    } catch (error) {
        return { answers: null, problem: `answers.json is not valid JSON (${compactMessage(error.message)})` };
    }
}

const compactMessage = message => String(message).replace(/\s+/g, " ").slice(0, 80);

/** The parser packages and everything they depend on, as real copies: a link would lead from the workspace back to this repository. */
function copyPackages(target) {
    const queue = [ ...WORKSPACE_PACKAGES ];
    const copied = new Set();
    while (queue.length) {
        const name = queue.pop();
        if (copied.has(name)) continue;
        copied.add(name);
        const source = path.join(ROOT, "node_modules", name);
        cpSync(source, path.join(target, name), { recursive: true, dereference: true });
        queue.push(...Object.keys(JSON.parse(readFileSync(path.join(source, "package.json"), "utf8")).dependencies ?? {}));
    }
}

/**
 * <base>/workspace is a copy of hybrid/ without its README (which names the generator), <base>/node_modules holds copies of the
 * parser packages for both arms, <base>/tools the tool (tool arm only). The key, the generator and the repository stay behind.
 */
export function prepareWorkspace(arm) {
    const base = mkdtempSync(path.join(os.tmpdir(), `${WORKSPACE_PREFIX}${arm}-`));
    const workspace = path.join(base, "workspace");
    cpSync(HYBRID, workspace, { recursive: true, filter: source => !NOT_COPIED.test(path.relative(HYBRID, source)) });
    copyPackages(path.join(base, "node_modules"));
    if (arm === "tool") cpSync(path.join(ROOT, "tool"), path.join(base, "tools"), { recursive: true, filter: source => !source.includes(`${path.sep}specs`) });
    return workspace;
}

/**
 * Signs in a recording that the agent looked outside its workspace: the key, the generator, this repository or the workspace of
 * another run. Nothing is decided here; the run is flagged so that a person reads the recording before the result is used.
 */
export function outsideWorkspace(recordingFile, workspace) {
    let text;
    try {
        text = readFileSync(recordingFile, "utf8");
    } catch {
        return [];
    }
    const flat = text.replace(/\\+/g, "/").toLowerCase();
    const own = path.basename(path.dirname(workspace)).toLowerCase();
    const found = [ "hybrid-key", "generate-hybrid" ].filter(marker => flat.includes(marker));
    if (flat.includes(ROOT.split(path.sep).join("/").toLowerCase())) found.push("the path of this repository");
    const others = [ ...new Set(flat.match(new RegExp(`${WORKSPACE_PREFIX}(?:no-tool|tool)-[a-z0-9]+`, "g")) ?? []) ].filter(name => name !== own);
    if (others.length) found.push(`another workspace (${others.join(", ")})`);
    return found;
}

async function runArm(arm, label, key, number, settings) {
    const workspace = prepareWorkspace(arm);
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    const recordingFile = path.join(RECORDINGS_DIR, `hybrid-${settings.model}-run-${number}-${arm}.ndjson`);
    console.log(`${label} ${arm}: started`);
    const run = await runClaude({ prompt: HYBRID_TASK + ARM_HINTS[arm], cwd: workspace, model: settings.model, budget: settings.budget, recordingFile });
    const { answers, problem } = readAnswers(workspace);
    const outside = outsideWorkspace(recordingFile, workspace);
    // No result event at all (the CLI did not start, or died): nothing was measured, so the row is kept apart from the counted runs.
    const invalid = Boolean(run.error) && run.costUsd === null && answers === null;
    const row = { ...run, ...scoreAnswers(answers, key.answers, problem), ...(invalid ? { invalid } : {}), ...(outside.length ? { outsideWorkspace: outside } : {}), workspace, workspaceKept: settings.keep, recording: path.relative(ROOT, recordingFile) };
    if (!settings.keep) {
        try {
            rmSync(path.dirname(workspace), { recursive: true, force: true, maxRetries: 3 });
        } catch (error) {
            console.warn(`${label} ${arm}: could not remove ${path.dirname(workspace)} (${error.message})`);
        }
    }
    if (outside.length) console.warn(`${label} ${arm}: the recording mentions ${outside.join(", ")}: read it before using this result`);
    const wrong = row.wrongKeys.length ? ` · wrong: ${row.wrongKeys.map(name => describe(name, row.details[name])).join(" | ")}` : "";
    console.log(`${label} ${arm}: done · ${row.seconds} s · $${(row.costUsd ?? 0).toFixed(2)} · ${row.turns} turns · ${row.correctAnswers}/${HYBRID_KEYS.length} answers right${wrong}${row.error ? ` · ERROR ${row.error}` : ""}${invalid ? " · NOT COUNTED (no result from the agent)" : ""}`);
    return row;
}

function runFiles(model) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    return readdirSync(RESULTS_DIR)
        .map(name => ({ name, number: Number(name.match(new RegExp(`^hybrid-${model}-run-(\\d+)\\.json$`))?.[1]) }))
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

/** One cell of the per-run table: "right", the wrong number, or the names that are missing and extra. */
function answerCell(row, name) {
    const detail = row?.details?.[name];
    if (!detail) return "—";
    if (detail.right) return "right";
    if (!("missing" in detail)) return `**${detail.given === null ? detail.note ?? "no answer" : JSON.stringify(detail.given)}**`;
    if (detail.note) return `**${detail.note}**`;
    return [ detail.missing.length ? `missing: ${detail.missing.join(", ")}` : "", detail.extra.length ? `extra: ${detail.extra.join(", ")}` : "" ].filter(Boolean).join("; ");
}

export function report(records, key, settings) {
    const money = value => `$${value.toFixed(2)}`;
    const thousands = value => Math.round(value).toLocaleString("en");
    const keyCell = value => (Array.isArray(value) ? `${value.length} name${value.length === 1 ? "" : "s"}` : String(value));
    const armNames = Object.keys(ARM_LABELS).filter(arm => records.some(record => record.arms[arm]));
    const summary = armNames.map(arm => {
        const rows = records.map(record => record.arms[arm]).filter(Boolean);
        return `| ${ARM_LABELS[arm]} | ${rows.filter(row => row.allCorrect).length}/${rows.length} | ${range(rows.map(row => row.correctAnswers))} / ${HYBRID_KEYS.length} | ${range(rows.map(row => row.seconds))} s | ${range(rows.map(row => row.turns))} | ${range(rows.map(row => row.inputTokens), thousands)} | ${range(rows.map(row => row.outputTokens), thousands)} | ${range(rows.map(row => row.costUsd), money)} |`;
    });
    const perRun = records.map(record => {
        const present = armNames.filter(arm => record.arms[arm]);
        const lines = HYBRID_KEYS.map(name => `| ${name} | ${keyCell((record.key ?? key.answers)[name])} | ${present.map(arm => answerCell(record.arms[arm], name)).join(" | ")} |`);
        const remarks = [
            ...present.filter(arm => record.arms[arm].error).map(arm => `- ${ARM_LABELS[arm]}: the agent ended with an error${record.arms[arm].answers ? "" : " before it wrote its answers, so every question counts as wrong"}: ${record.arms[arm].error}`),
            ...present.filter(arm => !record.arms[arm].error && record.arms[arm].answersProblem).map(arm => `- ${ARM_LABELS[arm]}: ${record.arms[arm].answersProblem}`),
            ...present.filter(arm => record.arms[arm].outsideWorkspace?.length).map(arm => `- ${ARM_LABELS[arm]}: the recording mentions ${record.arms[arm].outsideWorkspace.join(", ")}; read it before using this row`),
            ...Object.entries(record.invalidArms ?? {}).map(([ arm, row ]) => `- ${ARM_LABELS[arm] ?? arm}: not counted, the agent produced no result: ${row.error}`)
        ];
        return `### Run ${record.run}\n\n| Question | Key | ${present.map(arm => ARM_LABELS[arm]).join(" | ")} |\n|---|---:|${present.map(() => "---").join("|")}|\n${lines.join("\n")}\n${remarks.length ? `\n${remarks.join("\n")}\n` : ""}`;
    });
    const sizes = key.sizes ?? {};
    const app = `${sizes.ajsComponents ?? "?"} AngularJS components, ${sizes.ajsDirectives ?? "?"} directives, ${sizes.ajsFilters ?? "?"} filters, ${sizes.ajsServices ?? "?"} services, ${sizes.states ?? "?"} ui-router states, ${sizes.ajsTemplates ?? "?"} template files and ${sizes.ajsInlineTemplates ?? "?"} inline templates; ${sizes.angularComponents ?? "?"} Angular components, ${sizes.downgradedComponents ?? "?"} of them downgraded, ${sizes.upgradeWrappers ?? "?"} UpgradeComponent wrappers`;
    const modelIds = [ ...new Set(records.flatMap(record => Object.values(record.arms).map(row => row.modelId).filter(Boolean))) ];
    const unused = [ "deadComponents", "unusedFilters", "unusedServices" ];
    const unusedNames = unused.reduce((sum, name) => sum + key.answers[name].length, 0);
    const plain = (key.traps ?? []).filter(trap => trap.plain && unused.includes(trap.question)).length;
    const erred = records.flatMap(record => Object.values(record.arms)).filter(row => row.error && !row.answers).length;
    const notCounted = records.reduce((sum, record) => sum + Object.keys(record.invalidArms ?? {}).length, 0);
    return `# Hybrid benchmark — ${[ settings.model, ...modelIds ].join(", ")} — ${new Date().toISOString().slice(0, 10)}\n\n`
        + `Six migration-planning questions about hybrid/, an AngularJS + Angular app joined with ngUpgrade (${app}). No edits, so there is no compiler error to iterate against. `
        + `${records.length} run${records.length === 1 ? "" : "s"}, arms one after another, budget cap $${settings.budget} per arm. Ranges are min–max over the runs. `
        + "Both arms work in a copy of the app with a shell, node and the typescript and @angular/compiler packages; the tool arm also gets tool/ajs-facts.mjs and is told about it.\n\n"
        + "How to read this. The answer key comes from the generator's model, and the generator re-derives it from the emitted files with separate scans. "
        + "The six questions are the ones tool/ajs-facts.mjs was written to answer (TypeScript AST for the registrations, the Angular compiler's HTML and expression parsers for the templates): three are its `list --unused` output and three are columns of `list components`. "
        + "So the tool arm shows whether an agent finds and relays those facts, and the tool agreeing with the key before every run is a consistency check, not independent evidence. "
        + `Of the ${unusedNames} names in the three "nothing uses it" answers, ${unusedNames - plain} are also mentioned somewhere that does not count (a comment, a CSS class, a spec file, the same name on the Angular side) and ${plain} are mentioned nowhere else. `
        + "An array counts as right only when it equals the key exactly, so one slip in a list of 15 names fails that question; the per-run tables show which names were missing or extra."
        + `${erred ? ` ${erred} arm run${erred === 1 ? "" : "s"} ended with an error before writing answers (for example the budget cap) and count${erred === 1 ? "s" : ""} as 0 of ${HYBRID_KEYS.length}; they are marked under their run.` : ""}`
        + `${notCounted ? ` ${notCounted} arm run${notCounted === 1 ? "" : "s"} produced no result at all and ${notCounted === 1 ? "is" : "are"} not counted.` : ""}\n\n`
        + `| Agent | Runs with all six right | Answers right | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${summary.join("\n")}\n\n`
        + `## Answers per run\n\n"missing" = a name of the key that the agent did not give, "extra" = a name the agent gave that is not in the key; for the count the wrong number is shown.\n\n${perRun.join("\n")}`;
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    const settings = { model: String(args.model ?? "sonnet"), budget: String(args.budget ?? "3"), keep: Boolean(args.keep) };
    const arms = String(args.arms ?? "no-tool,tool").split(",");
    const runs = Number(args.runs ?? 1);
    if (args.help || arms.some(arm => !(arm in ARM_LABELS)) || !Number.isInteger(runs) || runs < 1 || args.score === true) fail(USAGE);

    const key = loadKey();
    if (args.score) {
        const workspace = path.resolve(args.score);
        const { answers, problem } = readAnswers(workspace);
        if (problem) console.error(`${problem} in ${workspace}: every question counts as wrong`);
        console.log(JSON.stringify(scoreAnswers(answers, key.answers, problem), null, 2));
        return;
    }
    await crossCheck(key);
    if (args.check) return;

    for (let index = 0; index < runs; index++) {
        const number = 1 + (runFiles(settings.model).at(-1)?.number ?? 0);
        const label = `[hybrid run ${number}]`;
        const rows = {};
        const invalidArms = {};
        for (const arm of arms) {
            const row = await runArm(arm, label, key, number, settings);
            (row.invalid ? invalidArms : rows)[arm] = row;
        }
        if (!Object.keys(rows).length) fail(`${label}: no arm produced a result (${Object.values(invalidArms).map(row => row.error).join(" | ")}); nothing was written`);
        const record = { model: settings.model, run: number, startedAt: new Date().toISOString(), sizes: key.sizes ?? null, key: key.answers, arms: rows, ...(Object.keys(invalidArms).length ? { invalidArms } : {}) };
        writeFileSync(path.join(RESULTS_DIR, `hybrid-${settings.model}-run-${number}.json`), JSON.stringify(record, null, 2) + "\n");
    }
    const records = runFiles(settings.model).map(entry => JSON.parse(readFileSync(path.join(RESULTS_DIR, entry.name), "utf8")));
    if (records.length) {
        const text = report(records, key, settings);
        writeFileSync(path.join(RESULTS_DIR, `hybrid-results-${settings.model}.md`), text);
        console.log("\n" + text);
    }
}

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) await main();
