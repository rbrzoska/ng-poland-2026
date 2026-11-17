// Optional, costs API money: two tasks on atlas/ (a routed app, scripts/generate-atlas.mjs) that are not a component migration,
// each done by an agent with and without ng-facts. The tool is used as it is — neither task was in mind when it was written.
//   node bench/atlas.mjs --task blast|a11y [--model sonnet] [--arms no-tool,tool] [--budget 3] [--runs 1]
//   node bench/atlas.mjs --task blast|a11y --score <workspace>     scores an existing workspace, no API call
// blast: "which routes show this component, also through other components?" — questions only, the key comes from the generator's model.
// a11y:  "give every icon button without an accessible name a label" — one judgement per place, scored on the compiler's AST.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ng from "@angular/compiler";
import { findDeclaration, findUsages, loadWorkspace } from "../tool/ng-facts.mjs";
import { runClaude } from "./claude-run.mjs";
import { compile } from "./score.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ATLAS = path.join(ROOT, "atlas");
const ARM_LABELS = { "no-tool": "files + grep only", tool: "with ng-facts v1", "tool-v2": "with ng-facts v2" };
/** The first version of the tool is kept frozen so later versions can be measured against it. */
const TOOL_SOURCES = { tool: "bench/tool-v1", "tool-v2": "tool" };

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(pair => pair.trim().split(/\s+/)));
const task = args.task;
const model = args.model ?? "sonnet";
const arms = (args.arms ?? "no-tool,tool").split(",");
const budget = args.budget ?? "3";
const runs = Number(args.runs ?? 1);

const BLAST_KEYS = [ "tentRoutes", "rationRoutes", "helmetRoutes", "unroutedComponents" ];
const WORKSPACE = "This is an Angular workspace: a routed app (src/app/app.routes.ts plus one routes file per province under src/app/provinces/; standalone components; templates are external .html files or inline `template:` strings in .ts files). ";
const PROMPTS = {
    blast: WORKSPACE + "We are about to change some shared components and need the blast radius. Do not modify any source file. Answer: "
        + "(1) `tentRoutes`: the full path of every route whose page can show `<app-tent>` (TentComponent) on screen in some state of the page, directly or through other components the page renders; "
        + "(2) `rationRoutes`: the same for `<app-ration>` (RationComponent); "
        + "(3) `helmetRoutes`: the same for `<app-helmet>` (HelmetComponent); "
        + "(4) `unroutedComponents`: the class names of all components that no route can ever show — pages no route points to, and components rendered only by those (the root AppComponent is always on screen and does not count). "
        + "Full paths look like `gallia/camps/:id` or `gallia/reports/daily`: province prefix, no leading slash; a redirect is not a route. "
        + "Write the answers to `answers.json` in the workspace root as one JSON object with exactly these four keys, each an array of strings, then reply with one line.",
    a11y: WORKSPACE + "Accessibility task: `IconButtonComponent` (`<app-icon-button>`, src/app/ui/icon-button.component.ts) renders a button that contains only an icon; its `label` input is the accessible name. Some usages set no `label`. "
        + "Add a short, meaningful static `label` (two to four words saying what the button does, judged from its icon and handler) to every `<app-icon-button>` that has none. "
        + "Do not touch usages that already set `label` in any form, other components (some have an input with the same name), or anything else. `npx ngc -p tsconfig.json` must still report no errors. Reply with one line when finished."
};
const TOOL_HINTS = {
    blast: " A fact tool built on the Angular compiler is available — prefer it to text search: `node ../tools/ng-facts.mjs usages <selector|Class> --root . --all` lists every template element the compiler matches to that component, with the file and line of each use — that is, which components render it.",
    a11y: " A fact tool built on the Angular compiler is available — prefer it to text search: `node ../tools/ng-facts.mjs usages IconButtonComponent --root . --all` lists every `<app-icon-button>` the compiler finds, with the file and line where the element starts; `node ../tools/ng-facts.mjs usages IconButtonComponent.label --root . --all` lists the ones that already set `label`, with the line of that attribute and its value."
};
const TOOL_V2_HINTS = {
    blast: " A fact tool built on the Angular compiler is available — prefer it to text search: `node ../tools/ng-facts.mjs where <selector|Class> --root .` lists the components that render it, directly and through others, and every route whose page can show it; `node ../tools/ng-facts.mjs unrouted --root .` lists the components no route can ever show; `node ../tools/ng-facts.mjs usages <selector|Class> --root . --all` lists every use with its file and line.",
    a11y: TOOL_HINTS.a11y
};
const HINTS = { "no-tool": { blast: "", a11y: "" }, tool: TOOL_HINTS, "tool-v2": TOOL_V2_HINTS };
if (!PROMPTS[task]) {
    console.error("usage: node bench/atlas.mjs --task blast|a11y [--model sonnet] [--arms no-tool,tool] [--budget 3] [--runs 1]");
    process.exit(1);
}
const RESULTS_DIR = path.join(ROOT, "results", "experiments", `atlas-${task}`);
const RECORDINGS_DIR = path.join(RESULTS_DIR, "recordings");

if (!existsSync(ATLAS)) execFileSync("node", [ path.join(ROOT, "scripts/generate-atlas.mjs") ], { stdio: "inherit" });
const key = JSON.parse(readFileSync(path.join(ROOT, "atlas-key.json"), "utf8"));

class ElementCollector extends ng.TmplAstRecursiveVisitor {
    elements = [];
    visitElement(element) {
        this.elements.push(element);
        super.visitElement(element);
    }
}

function elementsOf(declaration) {
    const collector = new ElementCollector();
    if (declaration.template) ng.tmplAstVisitAll(collector, declaration.template.nodes);
    return collector.elements;
}

const sourceOf = value => String(value?.source ?? value ?? "").trim();
const bindingsOf = element => new Map([
    ...element.attributes.map(attribute => [ attribute.name, `="${attribute.value}"` ]),
    ...element.inputs.map(input => [ input.name, `[]="${sourceOf(input.value)}"` ]),
    ...element.outputs.map(output => [ `(${output.name})`, sourceOf(output.handler) ])
]);
const sameBindings = (left, right) => left.size === right.size && [ ...left ].every(([ name, value ]) => right.get(name) === value);

/** Which routed pages render `selector`, found by walking "who renders whom" on the compiler's AST up to the page classes. */
function compilerRoutes(workspace, selector) {
    const pages = new Set();
    const seen = new Set();
    const climb = declaration => {
        if (seen.has(declaration)) return;
        seen.add(declaration);
        if (declaration.className.endsWith("PageComponent")) pages.add(declaration.className);
        for (const use of findUsages(workspace, declaration).uses) climb(use.declaration);
    };
    climb(findDeclaration(workspace, selector));
    return pages;
}

/** The generator's model and the compiler must agree before any agent is asked: same page count per component, same unlabelled buttons. */
function crossCheck() {
    const workspace = loadWorkspace(ATLAS);
    const unrouted = new Set(key.unroutedComponents);
    const routedPages = selector => [ ...compilerRoutes(workspace, selector) ].filter(name => !unrouted.has(name)).length;
    const unlabelled = workspace.declarations.flatMap(elementsOf).filter(element => element.name === "app-icon-button" && !bindingsOf(element).has("label")).length;
    const checks = [
        [ "tent", routedPages("app-tent"), key.tentRoutes.length ],
        [ "ration", routedPages("app-ration"), key.rationRoutes.length ],
        [ "helmet", routedPages("app-helmet"), key.helmetRoutes.length ],
        [ "unlabelled icon buttons", unlabelled, key.unlabelledIconButtons ]
    ];
    const wrong = checks.filter(([ , counted, expected ]) => counted !== expected);
    if (wrong.length) {
        console.error(`generator model and compiler disagree: ${wrong.map(([ name, counted, expected ]) => `${name} ${counted} vs ${expected}`).join(", ")}`);
        process.exit(1);
    }
    console.log(`answer key confirmed by the compiler: <app-tent> on ${key.tentRoutes.length} routes, <app-ration> on ${key.rationRoutes.length}, <app-helmet> on ${key.helmetRoutes.length}, ${key.unroutedComponents.length} unrouted components, ${key.unlabelledIconButtons} of ${key.iconButtons} icon buttons without a label`);
}

function scoreBlast(workspace) {
    let answers = null;
    try {
        answers = JSON.parse(readFileSync(path.join(workspace, "answers.json"), "utf8"));
    } catch {
        answers = null;
    }
    const perKey = Object.fromEntries(BLAST_KEYS.map(name => {
        const given = new Set(Array.isArray(answers?.[name]) ? answers[name].map(entry => String(entry).replace(/^\//, "")) : []);
        const expected = new Set(key[name]);
        return [ name, { missing: [ ...expected ].filter(entry => !given.has(entry)).length, extra: [ ...given ].filter(entry => !expected.has(entry)).length, expected: expected.size } ];
    }));
    const wrongKeys = BLAST_KEYS.filter(name => perKey[name].missing || perKey[name].extra);
    return { answers, perKey, wrongKeys, correctAnswers: BLAST_KEYS.length - wrongKeys.length, allCorrect: wrongKeys.length === 0 };
}

function scoreA11y(workspace) {
    const before = loadWorkspace(ATLAS);
    const after = loadWorkspace(workspace);
    const words = Object.fromEntries(key.icons.map(entry => [ entry.icon, new RegExp(entry.words, "i") ]));
    const totals = { targets: 0, labelled: 0, stillMissing: 0, implausible: 0, collateral: 0 };
    for (const original of before.declarations) {
        const candidate = after.declarations.find(declaration => declaration.className === original.className);
        const originalElements = elementsOf(original);
        const candidateElements = candidate ? elementsOf(candidate) : [];
        const sameShape = originalElements.length === candidateElements.length && originalElements.every((element, index) => element.name === candidateElements[index].name);
        originalElements.forEach((element, index) => {
            const was = bindingsOf(element);
            const isTarget = element.name === "app-icon-button" && !was.has("label");
            if (isTarget) totals.targets++;
            if (!sameShape) {
                if (isTarget) totals.stillMissing++;
                else if (index === 0) totals.collateral++;
                return;
            }
            const now = bindingsOf(candidateElements[index]);
            if (!isTarget) {
                if (!sameBindings(was, now)) totals.collateral++;
                return;
            }
            const label = now.get("label");
            now.delete("label");
            if (!sameBindings(was, now)) totals.collateral++;
            if (!label || label === `=""` || label === `[]=""`) {
                totals.stillMissing++;
                return;
            }
            totals.labelled++;
            const icon = was.get("icon")?.slice(2, -1);
            if (label.startsWith("=") && !words[icon]?.test(label)) totals.implausible++;
        });
    }
    const compileErrors = compile(workspace);
    return { ...totals, compileErrors, functionallyCorrect: totals.stillMissing === 0 && totals.collateral === 0 && compileErrors === 0 };
}

function prepareWorkspace(arm) {
    const base = mkdtempSync(path.join(os.tmpdir(), `ng-facts-atlas-${task}-${arm}-`));
    const workspace = path.join(base, "workspace");
    cpSync(ATLAS, workspace, { recursive: true, filter: source => !/[/\\](dist|out-tsc|\.angular)([/\\]|$)/.test(source) });
    symlinkSync(path.join(ROOT, "node_modules"), path.join(base, "node_modules"));
    if (arm in TOOL_SOURCES) cpSync(path.join(ROOT, TOOL_SOURCES[arm]), path.join(base, "tools"), { recursive: true, filter: source => !source.includes(`${path.sep}specs`) });
    return workspace;
}

async function runArm(arm, label, number) {
    const workspace = prepareWorkspace(arm);
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    const recordingFile = path.join(RECORDINGS_DIR, `atlas-${task}-${model}-run-${number}-${arm}.ndjson`);
    console.log(`${label} ${arm}: started`);
    const run = await runClaude({ prompt: PROMPTS[task] + HINTS[arm][task], cwd: workspace, model, budget, recordingFile });
    const row = { ...run, ...(task === "blast" ? scoreBlast(workspace) : scoreA11y(workspace)), workspace, recording: path.relative(ROOT, recordingFile) };
    const verdict = task === "blast"
        ? `${row.correctAnswers}/${BLAST_KEYS.length} answers right${row.wrongKeys.length ? ` · wrong: ${row.wrongKeys.map(name => `${name} (${row.perKey[name].missing} missing, ${row.perKey[name].extra} extra of ${row.perKey[name].expected})`).join(", ")}` : ""}`
        : `${row.labelled}/${row.targets} labelled · ${row.stillMissing} still missing · ${row.implausible} implausible · ${row.collateral} collateral changes · ${row.compileErrors} ngc errors`;
    console.log(`${label} ${arm}: done · ${row.seconds} s · $${(row.costUsd ?? 0).toFixed(2)} · ${row.turns} turns · ${verdict}${row.error ? ` · ERROR ${row.error}` : ""}`);
    return row;
}

function runFiles() {
    mkdirSync(RESULTS_DIR, { recursive: true });
    return readdirSync(RESULTS_DIR)
        .map(name => ({ name, number: Number(name.match(new RegExp(`^atlas-${task}-${model}-run-(\\d+)\\.json$`))?.[1]) }))
        .filter(entry => Number.isInteger(entry.number))
        .sort((left, right) => left.number - right.number);
}

crossCheck();
if (args.score) {
    console.log(JSON.stringify(task === "blast" ? scoreBlast(path.resolve(args.score)) : scoreA11y(path.resolve(args.score)), null, 2));
    process.exit(0);
}
for (let index = 0; index < runs; index++) {
    const number = 1 + (runFiles().at(-1)?.number ?? 0);
    const label = `[atlas ${task} run ${number}]`;
    const rows = {};
    for (const arm of arms) rows[arm] = await runArm(arm, label, number);
    writeFileSync(path.join(RESULTS_DIR, `atlas-${task}-${model}-run-${number}.json`), JSON.stringify({ model, task, run: number, startedAt: new Date().toISOString(), provinces: key.provinces, arms: rows }, null, 2) + "\n");
}
console.log(`${runFiles().length} run(s) of atlas ${task} recorded in ${path.relative(ROOT, RESULTS_DIR)} (${Object.values(ARM_LABELS).join(" / ")}) — node bench/evidence.mjs for the table`);
