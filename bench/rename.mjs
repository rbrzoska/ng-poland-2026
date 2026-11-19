// Optional, costs API money: one refactoring on rename/ (scripts/generate-rename.mjs), done by an agent with three fact sources:
// none (files, grep and shell), tool/ng-facts.mjs (the Angular compiler's parser) and tool/ls-facts.mjs (the Angular Language Service).
// The job (RENAME_TASK in bench/prompts.mjs): rename the input PillComponent.disableTooltip to hideHint everywhere, and nowhere else.
//   node bench/rename.mjs [--model sonnet] [--arms no-tool,ng-facts,ls-facts] [--budget 3] [--runs 1] [--keep]
//   node bench/rename.mjs --check               no API call: rename/ and rename-expected/ compile; the key applied to rename/ gives
//                                               rename-expected/; each tool is then run from inside a workspace the way its hint says:
//                                               `check` must give the compiler's verdict, and the tool's own rename command, alone, is
//                                               judged against the key. What a tool misses is REPORTED for both tools and fails nothing:
//                                               the key holds targets no parser and no type checker sees (names in strings and styles)
//   node bench/rename.mjs --score <workspace>   no API call: judges an existing workspace against the key and prints the verdict as JSON
//   node bench/rename.mjs --self-test [--keep]  no API call: builds a tiny app with a key in the temp directory and judges seven hand-made
//                                               results (perfect, missed inherited use, renamed decoys, compile error, moved lines, CRLF,
//                                               every name right but an expression changed)
// The key (rename-key.json, next to the app, never inside it) comes from the generator's model, not from a tool. Every agent run starts
// with the same cross-check as --check and refuses to run when the key and the two trees disagree or a tool of a chosen arm does not
// start; no tool has to agree with the key. What each tool's rename command leaves when run alone is written into the result file.
// Each arm works in <temp>/workspace, a copy of rename/ with one commit in a fresh git repository; <temp>/node_modules links to copies
// of the app's packages kept OUTSIDE this repository (a link to the repository's node_modules would lead to the key), and a tool arm
// gets its one tool in <temp>/tools. rename-expected/ and the key are never copied; a run whose recording mentions them, the generator,
// this repository or another workspace is flagged in its row and left out of the summary.
// OUT=<dir> reads <dir>/rename, <dir>/rename-expected and <dir>/rename-key.json instead of the ones in the repository root.
// LS_FACTS=<file> checks and hands out that file instead of tool/ls-facts.mjs (another version of the tool, or a stand-in for a test).
// The arms strict-ng, strict-ls and strict-both measure the next version of the skill (skill/angular-facts-strict): the workspace
// gets .claude/skills/angular-facts with SKILL.md as it is written, doctor.mjs, leftovers.mjs, ajs-facts.mjs, reference/ and the
// arm's fact script(s) from that folder; the prompt says nothing about it. --check also starts every script of the three
// strict folders from inside a workspace; an agent run does that for the strict arms it was asked to run.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runClaude } from "./claude-run.mjs";
import { RENAME_LS_FACTS_HINT, RENAME_NG_FACTS_HINT, RENAME_TASK } from "./prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.resolve(process.env.OUT ?? ROOT);
const NG_FACTS = path.join(ROOT, "tool", "ng-facts.mjs");
const LS_FACTS = path.resolve(process.env.LS_FACTS ?? path.join(ROOT, "tool", "ls-facts.mjs"));
const RESULTS_DIR = path.join(ROOT, "results", "experiments", "rename");
const RECORDINGS_DIR = path.join(RESULTS_DIR, "recordings");
const ARM_LABELS = {
    "no-tool": "files, grep and shell", "ng-facts": "with ng-facts (parser)", "ls-facts": "with ls-facts (language service)",
    "skill-ng": "skill with ng-facts", "skill-ls": "skill with ls-facts", "skill-both": "skill with both scripts",
    "strict-ng": "strict skill with ng-facts", "strict-ls": "strict skill with ls-facts", "strict-both": "strict skill with both scripts"
};
const ARM_HINTS = {
    "no-tool": "", "ng-facts": RENAME_NG_FACTS_HINT, "ls-facts": RENAME_LS_FACTS_HINT, "skill-ng": "", "skill-ls": "", "skill-both": "",
    "strict-ng": "", "strict-ls": "", "strict-both": ""
};
/**
 * A skill arm gets no line about a tool in its prompt: the workspace holds a project skill (.claude/skills/angular-facts: SKILL.md
 * from skill/angular-facts plus the scripts named here), and the agent has to find and follow it on its own.
 */
const ARM_SKILL = { "skill-ng": [ "ng-facts" ], "skill-ls": [ "ls-facts" ], "skill-both": [ "ng-facts", "ls-facts" ] };
const SKILL_SOURCE = path.join(ROOT, "skill", "angular-facts", "SKILL.md");
const SKILL_FOLDER = path.join(".claude", "skills", "angular-facts");
/**
 * A strict-skill arm gets the next version of the skill (skill/angular-facts-strict) as the project skill, again without a
 * line in its prompt: SKILL.md as it is written (nothing is cut out of it: the skill tells the agent to run doctor, and doctor
 * says which scripts this copy holds), what every copy has (STRICT_SKILL_ALWAYS) and the fact scripts named here.
 */
const ARM_STRICT = { "strict-ng": [ "ng-facts" ], "strict-ls": [ "ls-facts" ], "strict-both": [ "ng-facts", "ls-facts" ] };
const STRICT_SKILL_SOURCE = path.join(ROOT, "skill", "angular-facts-strict");
const STRICT_SKILL_ALWAYS = [ "SKILL.md", "doctor.mjs", "leftovers.mjs", "ajs-facts.mjs", "reference" ];
/** The scripts whose runs are counted per arm in `toolRuns`: the two tools, and what only the strict skill has. */
const COUNTED_SCRIPTS = [ "ng-facts", "ls-facts", "ajs-facts", "leftovers", "doctor" ];
/** The one file a tool arm finds in ../tools: an arm must not come across the other arm's tool. */
const ARM_TOOLS = { "ng-facts": NG_FACTS, "ls-facts": LS_FACTS };
const GENERATE_FIRST = "run node scripts/generate-rename.mjs first";
const USAGE = "usage: node bench/rename.mjs [--model sonnet] [--arms no-tool,ng-facts,ls-facts] [--budget 3] [--runs 1] [--keep] | --check | --score <workspace> | --self-test [--keep]";
const WORKSPACE_PREFIX = "rename-bench-";
/** What every workspace finds in ../node_modules, with whatever these depend on: the packages the app's package.json needs to compile, and the language service. */
const WORKSPACE_PACKAGES = [ "@angular/common", "@angular/compiler", "@angular/compiler-cli", "@angular/core", "@angular/language-service", "@angular/platform-browser", "rxjs", "tslib", "typescript" ];
const PACKAGES_PREFIX = "rename-bench-packages-";
const PACKAGES_COMPLETE = ".copied";
/** The rename command of each tool, as its hint spells it; run alone in a workspace it shows what the tool does without an agent. */
const TOOL_RENAME = { "ng-facts": task => [ "rename-input", `${task.component}.${task.from}`, task.to, "--root", ".", "--write" ], "ls-facts": task => [ "rename", `${task.component}.${task.from}`, task.to, "--root", ".", "--write" ] };
/** Kinds of target that leave no compiler error when they are missed: the compiler does not look at plain attributes, strings and style sheets. */
const UNSEEN_BY_COMPILER = [ "static", "string", "style" ];
/** Directories that are not part of the app: packages and build output. Files and directories whose name starts with a dot are skipped too. */
const NOT_THE_APP = new Set([ "node_modules", "out-tsc", "dist" ]);
/** Strings that have no business in a recording: the expected tree, the key and the generator. */
const KEY_MARKERS = [ "rename-expected", "rename-key", "generate-rename" ];
const MAX_EXAMPLES = 8;
const UNLISTED = { kind: "unlisted", on: null };

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

const slash = file => file.split(path.sep).join("/");
const unixLines = text => text.replace(/\r\n/g, "\n");
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const sameList = (left, right) => left.length === right.length && left.every((entry, index) => entry === right[index]);
const occurrences = (text, word) => text.split(word).length - 1;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** { static: 3, binding: 1 } as "static 3, binding 1", biggest first. */
function spelled(counts) {
    return Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([ name, count ]) => `${name} ${count}`).join(", ");
}

function countBy(entries, nameOf) {
    const counts = {};
    for (const entry of entries) counts[nameOf(entry)] = (counts[nameOf(entry)] ?? 0) + 1;
    return counts;
}

const tagOf = entry => entry.on ?? "no element";
const placeText = place => `${place.file}:${place.line} ${place.kind}${place.on ? ` on <${place.on}>` : ""}`;

/** Every file of an app as "relative/path" -> text with Unix line ends. Packages, build output and dot-files are not the app. */
export function readTree(directory) {
    const files = new Map();
    const walk = (current, prefix) => {
        for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
            if (entry.name.startsWith(".") || NOT_THE_APP.has(entry.name)) continue;
            if (entry.isDirectory()) walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
            else if (entry.isFile()) files.set(`${prefix}${entry.name}`, unixLines(readFileSync(path.join(current, entry.name), "utf8")));
        }
    };
    walk(directory, "");
    return files;
}

/**
 * The app before, the app after and the key, read once: a run is judged against what it started from, also when the generator
 * runs again meanwhile. Throws with the reason when a piece is missing or the key is not the agreed shape.
 */
export function loadReference(out = OUT) {
    const paths = { before: path.join(out, "rename"), expected: path.join(out, "rename-expected"), keyFile: path.join(out, "rename-key.json") };
    const shown = file => slash(path.relative(ROOT, file)) || file;
    for (const tree of [ paths.before, paths.expected ]) if (!existsSync(path.join(tree, "tsconfig.json"))) throw new Error(`${shown(tree)}/ is missing or has no tsconfig.json: ${GENERATE_FIRST}`);
    if (!existsSync(paths.keyFile)) throw new Error(`${shown(paths.keyFile)} is missing: ${GENERATE_FIRST}`);
    let key;
    try {
        key = JSON.parse(readFileSync(paths.keyFile, "utf8"));
    } catch (error) {
        throw new Error(`${shown(paths.keyFile)} is not valid JSON (${error.message}): ${GENERATE_FIRST}`);
    }
    const task = key.task ?? {};
    const wrong = [
        ...[ "component", "from", "to" ].filter(name => typeof task[name] !== "string" || !task[name]).map(name => `task.${name} is not a name`),
        ...[ "targets", "decoys" ].filter(name => !Array.isArray(key[name])).map(name => `${name} is not an array`),
        ...[ "targets", "decoys" ].filter(name => Array.isArray(key[name]) && key[name].some(entry => typeof entry?.file !== "string" || !Number.isInteger(entry.line) || entry.line < 1)).map(name => `an entry of ${name} has no file or no line number`)
    ];
    if (!wrong.length && (task.from.includes(task.to) || task.to.includes(task.from))) wrong.push("one name contains the other, so occurrences cannot be told apart");
    if (!wrong.length && !key.targets.length) wrong.push("targets is empty");
    if (wrong.length) throw new Error(`${shown(paths.keyFile)} is not a rename key (${wrong.join("; ")}): ${GENERATE_FIRST}`);
    const tidy = entry => ({ ...entry, file: slash(path.normalize(entry.file)).replace(/^\.\//, ""), kind: entry.kind ?? "unknown", on: entry.on ?? null });
    return { paths, key: { ...key, targets: key.targets.map(tidy), decoys: key.decoys.map(tidy) }, before: readTree(paths.before), expected: readTree(paths.expected) };
}

/** The sizes written into every result file: from the key's lists, with the generator's own counts kept next to them when it gave any. */
function countsOf(key) {
    return {
        targets: key.targets.length,
        byKind: countBy(key.targets, entry => entry.kind),
        byTag: countBy(key.targets, tagOf),
        decoys: key.decoys.length,
        decoysByKind: countBy(key.decoys, entry => entry.kind),
        targetFiles: new Set(key.targets.map(entry => entry.file)).size,
        files: key.counts?.files ?? null
    };
}

/** The key by file and line: { targets, decoys } in the order the key lists them. */
function listedByFile(key) {
    const files = new Map();
    const lineOf = entry => {
        if (!files.has(entry.file)) files.set(entry.file, new Map());
        const lines = files.get(entry.file);
        if (!lines.has(entry.line)) lines.set(entry.line, { targets: [], decoys: [] });
        return lines.get(entry.line);
    };
    for (const entry of key.targets) lineOf(entry).targets.push(entry);
    for (const entry of key.decoys) lineOf(entry).decoys.push(entry);
    return files;
}

/** A text cut at every occurrence of the old or the new name: the pieces between them, and which of the two names stands in each gap. */
function slotsOf(text, task) {
    const parts = text.split(new RegExp(`(${escapeRegExp(task.from)}|${escapeRegExp(task.to)})`));
    return { between: parts.filter((_part, index) => index % 2 === 0), names: parts.filter((_part, index) => index % 2 === 1) };
}

/**
 * Every occurrence of the old name in one file of the app before, in reading order, with what the key says about it. On a line
 * the key lists n times as a target, the first n occurrences are the targets; every other occurrence must stay (a decoy), also
 * one the key forgot to list ("unlisted"). `slot` counts the names on the line, `slotInFile` the names in the whole file.
 */
function placesOf(file, beforeLines, listed, task) {
    const places = [];
    let namesBefore = 0;
    beforeLines.forEach((text, index) => {
        const names = slotsOf(text, task).names;
        const here = listed?.get(index + 1) ?? { targets: [], decoys: [] };
        let seen = 0;
        names.forEach((name, slot) => {
            if (name !== task.from) return;
            const target = seen < here.targets.length;
            const entry = target ? here.targets[seen] : here.decoys[seen - here.targets.length] ?? UNLISTED;
            places.push({ file, line: index + 1, slot, slotInFile: namesBefore + slot, target, kind: entry.kind, on: entry.on });
            seen++;
        });
        namesBefore += names.length;
    });
    return places;
}

/**
 * rename/ with the key applied in memory: on every target line the old name becomes the new one once per time the key lists
 * the line, first occurrences first. `problems` names what makes the key unusable; `unlisted` the occurrences of the old name
 * that the key lists neither as a target nor as a decoy (the judge still counts them as decoys).
 */
export function applyKey(reference) {
    const { key, before } = reference;
    const { from, to } = key.task;
    const listed = listedByFile(key);
    const problems = [];
    const unlisted = [];
    const applied = new Map();
    for (const [ file, lines ] of listed) if (!before.has(file)) problems.push(`${file}: the key lists ${plural(lines.size, "line")} of a file that rename/ does not have`);
    for (const [ file, text ] of before) {
        const lines = text.split("\n");
        const fileLines = listed.get(file) ?? new Map();
        for (const [ line, here ] of fileLines) {
            if (line > lines.length) problems.push(`${file}:${line}: the key lists a line after the end of the file (${lines.length} lines)`);
            else if (occurrences(lines[line - 1], from) < here.targets.length + here.decoys.length) problems.push(`${file}:${line}: the key lists ${here.targets.length + here.decoys.length} occurrence(s) of ${from}, the line has ${occurrences(lines[line - 1], from)}`);
            else if (here.targets.length && here.decoys.length) problems.push(`${file}:${line}: the key lists a target and a decoy on the same line`);
        }
        lines.forEach((content, index) => {
            const here = fileLines.get(index + 1) ?? { targets: [], decoys: [] };
            const extra = occurrences(content, from) - here.targets.length - here.decoys.length;
            if (extra > 0) unlisted.push(`${file}:${index + 1}${extra > 1 ? ` (${extra})` : ""}`);
            let left = here.targets.length;
            if (left) lines[index] = content.replaceAll(from, found => (left-- > 0 ? to : found));
        });
        applied.set(file, lines.join("\n"));
    }
    return { applied, problems, unlisted };
}

/** Where two trees differ, one line of words per file: a file only one of them has, or the first line that is not the same. */
function treeDifferences(left, right, leftName, rightName) {
    const differences = [];
    for (const file of [ ...new Set([ ...left.keys(), ...right.keys() ]) ].sort()) {
        if (!left.has(file) || !right.has(file)) {
            differences.push(`${file}: only in ${left.has(file) ? leftName : rightName}`);
            continue;
        }
        if (left.get(file) === right.get(file)) continue;
        const leftLines = left.get(file).split("\n");
        const rightLines = right.get(file).split("\n");
        const line = leftLines.findIndex((text, index) => text !== rightLines[index]);
        const at = line < 0 ? leftLines.length : line;
        differences.push(`${file}:${at + 1}: ${leftName} has "${(leftLines[at] ?? "(no line)").trim().slice(0, 90)}", ${rightName} has "${(rightLines[at] ?? "(no line)").trim().slice(0, 90)}"`);
    }
    return differences;
}

/** The compiler's entry script, found the way node finds a package: in node_modules next to the workspace or above it, else in this repository. */
function ngcScript(workspace) {
    const packageOf = directory => path.join(directory, "node_modules", "@angular", "compiler-cli");
    let directory = path.resolve(workspace);
    while (!existsSync(path.join(packageOf(directory), "package.json")) && path.dirname(directory) !== directory) directory = path.dirname(directory);
    const home = existsSync(path.join(packageOf(directory), "package.json")) ? packageOf(directory) : packageOf(ROOT);
    return path.join(home, JSON.parse(readFileSync(path.join(home, "package.json"), "utf8")).bin.ngc);
}

/** ngc -p tsconfig.json in a workspace: its exit code, how many errors it printed (colours stripped) and the first three of them. */
export function compile(workspace) {
    const tsconfig = path.join(workspace, "tsconfig.json");
    if (!existsSync(tsconfig)) return { ngcExit: 1, ngcErrors: 1, ngcFirstErrors: [ "tsconfig.json is missing" ] };
    const run = spawnSync(process.execPath, [ ngcScript(workspace), "-p", tsconfig ], { cwd: workspace, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}${run.error ? String(run.error.message ?? run.error) : ""}`.replace(/\x1b\[[0-9;]*m/g, "");
    const errors = output.split("\n").filter(line => /\berror (?:NG|TS)\d+:/.test(line));
    const ngcExit = run.status ?? 1;
    const shown = errors.length || ngcExit === 0 ? errors : [ output.trim().split("\n")[0] || "ngc failed without output" ];
    return { ngcExit, ngcErrors: errors.length || (ngcExit === 0 ? 0 : 1), ngcFirstErrors: shown.slice(0, 3).map(line => line.trim().slice(0, 240)) };
}

/** Occurrences by position: the piece of text is otherwise unchanged, so each one is still the old name or has become the new one. */
function settleInPlace(places, namesNow, slotOf, task, tally) {
    for (const place of places) {
        const now = namesNow[slotOf(place)];
        if (place.target && now !== task.to) tally.missed.push(place);
        if (!place.target && now !== task.from) tally.collateral.push(place);
    }
}

/**
 * Occurrences by count, for a piece of text that changed in more than the name: how many old names are left and how many new
 * ones appeared. Which occurrence is which can no longer be told, so the last ones of the piece take the blame.
 */
function settleByCount(places, textBefore, textNow, task, tally) {
    const targets = places.filter(place => place.target);
    const decoys = places.filter(place => !place.target);
    const oldLeft = occurrences(textNow, task.from);
    const renamed = clamp(occurrences(textNow, task.to) - occurrences(textBefore, task.to), 0, targets.length);
    const hits = Math.min(renamed, targets.length - clamp(oldLeft - decoys.length, 0, targets.length));
    tally.missed.push(...targets.slice(hits));
    tally.collateral.push(...decoys.slice(clamp(oldLeft, 0, decoys.length)));
}

/** How many lines one text has that the other has not, the old and the new name counting as the same word. */
function looseLineDifference(expectedLines, actualLines, task) {
    const balance = new Map();
    for (const line of expectedLines) balance.set(line.replaceAll(task.to, task.from), (balance.get(line.replaceAll(task.to, task.from)) ?? 0) + 1);
    for (const line of actualLines) balance.set(line.replaceAll(task.to, task.from), (balance.get(line.replaceAll(task.to, task.from)) ?? 0) - 1);
    const counts = [ ...balance.values() ];
    return Math.max(counts.reduce((sum, count) => sum + Math.max(0, count), 0), counts.reduce((sum, count) => sum + Math.max(0, -count), 0));
}

/**
 * A result (files as readTree gives them) against the key, without the compiler:
 * missed = targets where the old name is not replaced by the new one, collateral = occurrences that had to stay and did not,
 * otherChanges = changedLines + addedFiles: changedLines are lines of the app that differ from rename-expected/ in something
 * other than the name at a listed place (a rewritten expression, an edited library template, a removed file counts once),
 * addedFiles are files the app did not have (a helper script left behind).
 * A file with the same number of lines as before is compared line by line; a file whose lines moved is compared as a whole,
 * occurrence by occurrence, and named in `unalignedFiles`.
 */
export function compareWithKey(actual, reference) {
    const { key, before, expected } = reference;
    const task = key.task;
    const listed = listedByFile(key);
    const tally = { missed: [], collateral: [], changedLines: 0, addedFiles: 0, otherExamples: [], unalignedFiles: [] };
    const other = (where, count = 1) => {
        tally.changedLines += count;
        tally.otherExamples.push(where);
    };
    for (const [ file, expectedText ] of expected) {
        const beforeText = before.get(file) ?? expectedText;
        const beforeLines = beforeText.split("\n");
        const places = placesOf(file, beforeLines, listed.get(file), task);
        if (!actual.has(file)) {
            tally.missed.push(...places.filter(place => place.target));
            tally.collateral.push(...places.filter(place => !place.target));
            other(`${file}: removed`);
            continue;
        }
        const actualText = actual.get(file);
        if (actualText === expectedText) continue;
        const expectedLines = expectedText.split("\n");
        const actualLines = actualText.split("\n");
        if (actualLines.length !== beforeLines.length) {
            const namesNow = slotsOf(actualText, task).names;
            if (namesNow.length === slotsOf(beforeText, task).names.length) settleInPlace(places, namesNow, place => place.slotInFile, task, tally);
            else settleByCount(places, beforeText, actualText, task, tally);
            tally.unalignedFiles.push(file);
            const lines = looseLineDifference(expectedLines, actualLines, task);
            if (lines) other(`${file}: ${plural(lines, "line")} added, removed or rewritten`, lines);
            continue;
        }
        const placesByLine = Map.groupBy(places, place => place.line);
        actualLines.forEach((text, index) => {
            if (text === expectedLines[index]) return;
            const here = placesByLine.get(index + 1) ?? [];
            const settledBefore = tally.missed.length + tally.collateral.length;
            const now = slotsOf(text, task);
            const inPlace = sameList(now.between, slotsOf(beforeLines[index], task).between);
            if (inPlace) settleInPlace(here, now.names, place => place.slot, task, tally);
            else settleByCount(here, beforeLines[index], text, task, tally);
            if (!inPlace || tally.missed.length + tally.collateral.length === settledBefore) other(`${file}:${index + 1}`);
        });
    }
    for (const file of actual.keys()) {
        if (expected.has(file)) continue;
        tally.addedFiles++;
        tally.otherExamples.push(`${file}: added`);
    }
    return {
        targets: key.targets.length,
        missed: tally.missed.length,
        missedByKind: countBy(tally.missed, place => place.kind),
        missedByTag: countBy(tally.missed, tagOf),
        missedExamples: tally.missed.slice(0, MAX_EXAMPLES).map(placeText),
        decoys: key.decoys.length,
        collateral: tally.collateral.length,
        collateralByKind: countBy(tally.collateral, place => place.kind),
        collateralExamples: tally.collateral.slice(0, MAX_EXAMPLES).map(placeText),
        otherChanges: tally.changedLines + tally.addedFiles,
        changedLines: tally.changedLines,
        addedFiles: tally.addedFiles,
        otherExamples: tally.otherExamples.slice(0, MAX_EXAMPLES),
        unalignedFiles: tally.unalignedFiles
    };
}

/**
 * The verdict on a workspace: the compiler (1), missed targets (2), collateral (3), other changes (4). Correct = (1), (2) and (3)
 * are clean. That says nothing about the rest of the app: a run that renames every name and also rewrites an expression is
 * "correct". `onlyTheRename` is the stricter verdict the task asks for ("do not change anything else"): correct, and no line of
 * the app differs from the expected one. A file that was added (a script the agent wrote) does not count against it.
 */
export function judge(workspace, reference) {
    const compiled = compile(workspace);
    const compared = compareWithKey(readTree(workspace), reference);
    const functionallyCorrect = compiled.ngcExit === 0 && compared.missed === 0 && compared.collateral === 0;
    return { ...compiled, ...compared, functionallyCorrect, onlyTheRename: functionallyCorrect && compared.changedLines === 0 };
}

/** One verdict in words, for the console. */
function verdictLine(verdict) {
    const missed = verdict.missed ? ` (${spelled(verdict.missedByKind)}; ${spelled(verdict.missedByTag)})` : "";
    const collateral = verdict.collateral ? ` (${spelled(verdict.collateralByKind)})` : "";
    const rest = verdict.functionallyCorrect && !verdict.onlyTheRename ? `, but ${plural(verdict.changedLines, "other line")} of the app changed` : "";
    return `missed ${verdict.missed}/${verdict.targets}${missed} · collateral ${verdict.collateral}${collateral} · other changes ${verdict.otherChanges} · ngc ${plural(verdict.ngcErrors, "error")} · ${verdict.functionallyCorrect ? "correct" : "NOT correct"}${rest}`;
}

const withoutPackagesAndBuildOutput = source => !/[/\\](node_modules|out-tsc|dist|\.angular|\.git)([/\\]|$)/.test(source);

/** Removes a temp directory of this bench. A link to node_modules inside it goes as a link: what it points to is never entered. */
function removeDirectory(directory, label) {
    try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
        console.warn(`${label}: could not remove ${directory} (${error.message})`);
    }
}

/** The package.json of every package installed inside a package (its own node_modules, at any depth). */
function nestedManifests(packageDirectory) {
    const modules = path.join(packageDirectory, "node_modules");
    if (!existsSync(modules)) return [];
    const directories = readdirSync(modules, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
        .flatMap(entry => (entry.name.startsWith("@") ? readdirSync(path.join(modules, entry.name)).map(name => path.join(modules, entry.name, name)) : [ path.join(modules, entry.name) ]));
    return directories.filter(directory => existsSync(path.join(directory, "package.json")))
        .flatMap(directory => [ JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")), ...nestedManifests(directory) ]);
}

/**
 * A node_modules directory OUTSIDE this repository with real copies of the workspace packages and of everything they depend on,
 * made once per package-lock.json and then reused. Every workspace links to it. A link to the repository's own node_modules
 * would do for the compiler, but its parent directory is the repository: `ls ../node_modules/..` would show the key, the
 * expected tree, the generator and the other arm's tool.
 */
export function packagesDirectory() {
    const modules = path.join(ROOT, "node_modules");
    const lockFile = [ path.join(ROOT, "package-lock.json"), path.join(modules, ".package-lock.json") ].find(file => existsSync(file));
    const stamp = createHash("sha256").update(WORKSPACE_PACKAGES.join(",")).update(lockFile ? readFileSync(lockFile) : "").digest("hex").slice(0, 12);
    const home = path.join(os.tmpdir(), `${PACKAGES_PREFIX}${stamp}`);
    if (existsSync(path.join(home, "node_modules", PACKAGES_COMPLETE))) return path.join(home, "node_modules");

    const started = performance.now();
    const building = `${home}.${process.pid}`;
    const target = path.join(building, "node_modules");
    rmSync(building, { recursive: true, force: true });
    const queue = [ ...WORKSPACE_PACKAGES ];
    const copied = new Set();
    const commands = [];
    while (queue.length) {
        const name = queue.pop();
        const source = path.join(modules, name);
        if (copied.has(name) || !existsSync(path.join(source, "package.json"))) continue;
        copied.add(name);
        cpSync(source, path.join(target, name), { recursive: true, dereference: true });
        const manifest = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
        commands.push(...(typeof manifest.bin === "string" ? [ name.split("/").at(-1) ] : Object.keys(manifest.bin ?? {})));
        // what the package needs, and what the packages nested inside it need: node looks for those at the top as well
        for (const needs of [ manifest, ...nestedManifests(source) ]) queue.push(...Object.keys({ ...needs.dependencies, ...needs.peerDependencies }));
    }
    // node_modules/.bin, so that `npx ngc` finds the compiler: a script per command on Windows, a relative link elsewhere
    mkdirSync(path.join(target, ".bin"), { recursive: true });
    for (const command of commands) {
        for (const suffix of [ "", ".cmd", ".ps1" ]) {
            const source = path.join(modules, ".bin", `${command}${suffix}`);
            if (!existsSync(source)) continue;
            if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), path.join(target, ".bin", `${command}${suffix}`));
            else cpSync(source, path.join(target, ".bin", `${command}${suffix}`));
        }
    }
    writeFileSync(path.join(target, PACKAGES_COMPLETE), "");
    try {
        renameSync(building, home);
    } catch {
        // another run made the same copy meanwhile: use that one
        removeDirectory(building, "copy of the packages");
    }
    if (!existsSync(path.join(home, "node_modules", PACKAGES_COMPLETE))) throw new Error(`could not put the workspace packages into ${home}`);
    console.log(`copied ${plural(copied.size, "package")} from node_modules to ${home} (${Math.round((performance.now() - started) / 1000)} s, once per package-lock.json): workspaces link there, not into this repository`);
    return path.join(home, "node_modules");
}

/** One commit that holds the app as it was handed over, so that the agent can look at its own diff like in any real repository. Skipped when git is missing. */
function commitWorkspace(workspace) {
    const git = args => spawnSync("git", [ "-c", "user.name=Workspace", "-c", "user.email=workspace@example.invalid", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args ], { cwd: workspace, encoding: "utf8" });
    if (git([ "init", "--quiet" ]).status !== 0) return false;
    // line ends stay as the files have them, whatever this machine's git is set to: a diff shows the agent's changes only
    git([ "config", "core.autocrlf", "false" ]);
    git([ "add", "--all" ]);
    return git([ "commit", "--quiet", "--no-verify", "-m", "The app before the change" ]).status === 0;
}

/**
 * <base>/workspace is a copy of rename/, <base>/node_modules a link to the copied packages (a junction on Windows) so that ngc
 * and the tools run, <base>/tools holds the arm's tool (tool arms only). rename-expected/ and the key stay behind, and nothing in
 * <base> leads back to this repository. `git` makes the workspace a repository with one commit (for agent runs).
 */
/** SKILL.md for a workspace that holds only `tools`: the blocks about a script that is not there are taken out. */
export function skillText(tools) {
    const kept = block => (block === "both" ? tools.length > 1 : tools.includes(block));
    return readFileSync(SKILL_SOURCE, "utf8")
        .replace(/<!-- tool:([a-z-]+) -->\n([\s\S]*?)<!-- \/tool:\1 -->\n\n?/g, (match, block, body) => (kept(block) ? `${body}\n` : ""))
        .replace(/\n{3,}/g, "\n\n");
}

/** What the skill folder of a strict arm holds, as names inside skill/angular-facts-strict (reference is a folder). */
export function strictSkillFiles(arm) {
    return [ ...STRICT_SKILL_ALWAYS, ...ARM_STRICT[arm].map(tool => `${tool}.mjs`) ];
}

export function prepareWorkspace(arm, reference, { git = false } = {}) {
    const base = mkdtempSync(path.join(os.tmpdir(), `${WORKSPACE_PREFIX}${arm}-`));
    const workspace = path.join(base, "workspace");
    cpSync(reference.paths.before, workspace, { recursive: true, filter: withoutPackagesAndBuildOutput });
    symlinkSync(packagesDirectory(), path.join(base, "node_modules"), "junction");
    if (arm in ARM_TOOLS) {
        mkdirSync(path.join(base, "tools"));
        cpSync(ARM_TOOLS[arm], path.join(base, "tools", `${arm}.mjs`));
    }
    if (arm in ARM_SKILL) {
        const folder = path.join(workspace, SKILL_FOLDER);
        mkdirSync(folder, { recursive: true });
        writeFileSync(path.join(folder, "SKILL.md"), skillText(ARM_SKILL[arm]));
        for (const tool of ARM_SKILL[arm]) cpSync(ARM_TOOLS[tool], path.join(folder, `${tool}.mjs`));
    }
    if (arm in ARM_STRICT) {
        const folder = path.join(workspace, SKILL_FOLDER);
        mkdirSync(folder, { recursive: true });
        for (const name of strictSkillFiles(arm)) cpSync(path.join(STRICT_SKILL_SOURCE, name), path.join(folder, name), { recursive: true });
    }
    if (git) commitWorkspace(workspace);
    return workspace;
}

/**
 * Signs in a recording that the agent looked outside its workspace: the expected tree, the key, the generator, this repository or
 * the workspace of another run. Nothing can be proven from a string, so the run is flagged: its row says so, and the summary
 * leaves it out until a person has read the recording. The workspace's packages are copies outside this repository, so no
 * honest compiler message can name it.
 */
export function outsideWorkspace(recordingFile, workspace) {
    let text;
    try {
        text = readFileSync(recordingFile, "utf8");
    } catch {
        return [];
    }
    const flat = text.replace(/\\+/g, "/").toLowerCase();
    // the repository as Windows and node write it (c:/…) and as Git Bash writes it (/c/…)
    const repository = [ slash(ROOT).toLowerCase(), slash(ROOT).toLowerCase().replace(/^([a-z]):/, "/$1") ];
    const own = path.basename(path.dirname(workspace)).toLowerCase();
    const found = KEY_MARKERS.filter(marker => flat.includes(marker));
    if (repository.some(form => flat.includes(form))) found.push("the path of this repository");
    const others = [ ...new Set(flat.match(new RegExp(`${WORKSPACE_PREFIX}(?:${Object.keys(ARM_LABELS).join("|")})-[a-z0-9]{6}`, "g")) ?? []) ].filter(name => name !== own);
    if (others.length) found.push(`another workspace (${others.join(", ")})`);
    return found;
}

function shapeOf(value) {
    if (Array.isArray(value)) return `an array of ${value.length}${value.length ? `, first entry with ${Object.keys(value[0] ?? {}).join(", ") || "no fields"}` : ""}`;
    if (value && typeof value === "object") return `an object with ${Object.keys(value).join(", ") || "no fields"}`;
    return String(value);
}

/**
 * The edits of a planRename result as { file, line, start, end, text }. The contract fixes "plain data", not the field names, so
 * the usual spellings are read: a list under edits / locations / changes (or the result itself), flat or grouped by file; a line
 * number given, or worked out from the start offset. Returns null when no such list is found.
 */
function planEdits(plan, reference) {
    const list = Array.isArray(plan) ? plan : [ "edits", "locations", "changes", "renames" ].map(name => plan?.[name]).find(Array.isArray);
    if (!list) return null;
    const flat = list.flatMap(entry => (Array.isArray(entry?.edits) ? entry.edits.map(edit => ({ file: entry.file ?? entry.fileName, ...edit })) : [ entry ]));
    const known = new Map([ ...reference.before.keys() ].map(file => [ file.toLowerCase(), file ]));
    const edits = [];
    for (const entry of flat) {
        const named = entry?.file ?? entry?.fileName ?? entry?.path;
        if (typeof named !== "string") return null;
        const relative = slash(path.isAbsolute(named) ? path.relative(reference.paths.before, named) : path.normalize(named));
        const file = known.get(relative.toLowerCase()) ?? relative;
        const start = [ entry.start, entry.offset, entry.pos, entry.textSpan?.start, entry.span?.start ].find(Number.isInteger);
        const length = [ entry.length, entry.textSpan?.length, entry.span?.length ].find(Number.isInteger);
        const end = Number.isInteger(entry.end) ? entry.end : start !== undefined && length !== undefined ? start + length : undefined;
        const text = [ entry.newText, entry.replacement, entry.text ].find(value => typeof value === "string");
        const onDisk = path.join(reference.paths.before, file);
        const line = Number.isInteger(entry.line) ? entry.line : start !== undefined && existsSync(onDisk) ? readFileSync(onDisk, "utf8").slice(0, start).split("\n").length : undefined;
        if (line === undefined) return null;
        edits.push({ file, line, start, end, text });
    }
    return edits;
}

/**
 * tool/ls-facts.mjs as a library: the plan of planRename, compared with the key place by place. The differences are printed by
 * kind and decide nothing: the key holds targets a type checker cannot see. A problem is only a tool that gives no plan at all.
 */
async function comparePlanWithKey(reference) {
    const { key } = reference;
    const member = `${key.task.component}.${key.task.from}`;
    const toolName = slash(path.relative(ROOT, LS_FACTS));
    let plan;
    try {
        const tool = await import(pathToFileURL(LS_FACTS).href);
        if (typeof tool.planRename !== "function") return [ `${toolName} exports no planRename (it exports: ${Object.keys(tool).join(", ") || "nothing"})` ];
        plan = await tool.planRename(reference.paths.before, member, key.task.to);
    } catch (error) {
        return [ `${toolName} planRename(${member}) failed on ${reference.paths.before}: ${error?.stack ?? error}` ];
    }
    const edits = planEdits(plan, reference);
    if (!edits) return [ `${toolName} planRename returned ${shapeOf(plan)}: this check reads a list "edits" of { file, line or offset, length, newText }` ];
    for (const note of [ plan?.notes, plan?.warnings ].filter(Array.isArray).flat().slice(0, 5)) console.log(`  ls-facts says: ${String(note).slice(0, 200)}`);

    const planned = countBy(edits, edit => `${edit.file}:${edit.line}`);
    const listed = listedByFile(key);
    const missing = [];
    const extra = [];
    for (const [ file, lines ] of listed) {
        for (const [ line, here ] of lines) {
            const count = planned[`${file}:${line}`] ?? 0;
            delete planned[`${file}:${line}`];
            missing.push(...here.targets.slice(count).map(entry => ({ ...entry, file, line })));
            for (let more = here.targets.length; more < count; more++) extra.push({ ...(here.decoys[more - here.targets.length] ?? { kind: "twice on a target line", on: null }), file, line });
        }
    }
    for (const [ where, count ] of Object.entries(planned)) for (let more = 0; more < count; more++) extra.push({ file: where.slice(0, where.lastIndexOf(":")), line: Number(where.slice(where.lastIndexOf(":") + 1)), kind: "not in the key", on: null });
    console.log(`ls-facts planRename: ${plural(edits.length, "edit")} in ${plural(new Set(edits.map(edit => edit.file)).size, "file")}; of the key's ${plural(key.targets.length, "target")} it plans ${key.targets.length - missing.length}`
        + `${missing.length ? `, not ${missing.length} (${spelled(countBy(missing, entry => entry.kind))}; ${spelled(countBy(missing, tagOf))}): ${missing.slice(0, MAX_EXAMPLES).map(placeText).join(", ")}` : ""}`
        + `${extra.length ? `; ${plural(extra.length, "edit")} the key does not want (${spelled(countBy(extra, entry => entry.kind))}): ${extra.slice(0, MAX_EXAMPLES).map(placeText).join(", ")}` : "; no edit the key does not want"}`);
    return [];
}

/** A tool run the way an agent runs it: from inside a workspace, as node ../tools/<arm>.mjs. */
function runTool(workspace, arm, args) {
    const run = spawnSync(process.execPath, [ `../tools/${arm}.mjs`, ...args ], { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}${run.error?.message ?? ""}`.trim();
    return { status: run.status, output, firstLine: output.split("\n")[0] };
}

/**
 * One tool from inside a workspace, the way the agent of that arm can use it, and the same for both tools. Two things must hold,
 * or the arm would pay for a defect that has nothing to do with its fact source: `check` gives the compiler's verdict on the
 * untouched app, and the rename command of the hint starts. What that one command leaves behind is judged like an agent's
 * result and returned as `alone`: it is reported and recorded, and fails nothing.
 */
function checkTool(arm, reference) {
    const toolFile = ARM_TOOLS[arm];
    if (!existsSync(toolFile)) return { problems: [ `${slash(path.relative(ROOT, toolFile))} is missing` ], alone: null };
    const problems = [];
    const workspace = prepareWorkspace(arm, reference);
    try {
        const checked = runTool(workspace, arm, [ "check", "--root", "." ]);
        if (checked.status !== 0 || !/^(ngc|check): 0 errors/.test(checked.output)) problems.push(`"node ../tools/${arm}.mjs check --root ." does not give the compiler's verdict on the untouched app (it prints "${checked.firstLine.slice(0, 160)}", exit code ${checked.status}); the hint of the ${arm} arm names this command`);
        const command = TOOL_RENAME[arm](reference.key.task);
        const started = performance.now();
        const renamed = runTool(workspace, arm, command);
        const seconds = Math.round((performance.now() - started) / 100) / 10;
        if (!renamed.firstLine.startsWith("rename")) return { problems: [ ...problems, `"node ../tools/${arm}.mjs ${command.join(" ")}" does not start in a workspace: ${renamed.output.slice(0, 400) || `exit code ${renamed.status}`}` ], alone: null };
        const verdict = judge(workspace, reference);
        console.log(`${arm} alone says: ${renamed.firstLine.slice(0, 200)}`);
        console.log(`${arm} alone (one command, no agent), judged: ${verdictLine(verdict)}`);
        if (verdict.missed) console.log(`  not renamed, first ones: ${verdict.missedExamples.join(", ")}`);
        if (verdict.collateral) console.log(`  changed although it had to stay: ${verdict.collateralExamples.join(", ")}`);
        if (verdict.ngcErrors) console.log(`  first compiler error: ${verdict.ngcFirstErrors[0]}`);
        return { problems, alone: { command: `node ../tools/${arm}.mjs ${command.join(" ")}`, seconds, exitCode: renamed.status, ...verdict } };
    } finally {
        removeDirectory(path.dirname(workspace), `check of ${arm}`);
    }
}

/**
 * The skill folder of a strict arm from inside a workspace, the way its agent starts: doctor must exit 0 and call every
 * script of this copy `ok`, every script must answer --help, the compiler command the copy has (ls-facts check, else
 * ng-facts check) must give "0 errors" on the untouched app, and leftovers must answer for the member of the task (--before,
 * so nothing counts as unfinished). Nothing is renamed and nothing is judged: the skill is a procedure for an agent.
 */
function checkStrictSkill(arm, reference) {
    const problems = [];
    const missing = strictSkillFiles(arm).filter(name => !existsSync(path.join(STRICT_SKILL_SOURCE, name)));
    if (missing.length) return [ `skill/angular-facts-strict has no ${missing.join(", ")}: the ${arm} arm cannot be set up` ];
    const workspace = prepareWorkspace(arm, reference);
    const skill = slash(SKILL_FOLDER);
    const run = (script, args) => {
        const result = spawnSync(process.execPath, [ `${skill}/${script}.mjs`, ...args ], { cwd: workspace, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
        return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`.trim() };
    };
    const said = result => `it prints "${result.output.split("\n").at(-1).slice(0, 160)}", exit code ${result.status}`;
    try {
        const scripts = strictSkillFiles(arm).filter(name => name.endsWith(".mjs")).map(name => name.slice(0, -4));
        const doctor = run("doctor", [ "--root", "." ]);
        const notOk = scripts.filter(script => script !== "doctor" && !new RegExp(`^\\s*${escapeRegExp(script)}\\.mjs\\s+ok\\b`, "m").test(doctor.output));
        if (doctor.status !== 0 || notOk.length) problems.push(`${arm}: "node ${skill}/doctor.mjs --root ." does not call the workspace ready (${said(doctor)}${notOk.length ? `; not ok: ${notOk.join(", ")}` : ""})`);
        for (const script of scripts) {
            const help = run(script, [ "--help" ]);
            if (help.status !== 0) problems.push(`${arm}: "node ${skill}/${script}.mjs --help" does not start (${said(help)})`);
        }
        const compiler = scripts.includes("ls-facts") ? "ls-facts" : "ng-facts";
        const checked = run(compiler, [ "check", "--root", "." ]);
        if (checked.status !== 0 || !/\b0 errors\b/.test(checked.output)) problems.push(`${arm}: "node ${skill}/${compiler}.mjs check --root ." does not give the compiler's verdict on the untouched app (${said(checked)})`);
        const member = `${reference.key.task.component}.${reference.key.task.from}`;
        const before = run("leftovers", [ member, "--root", ".", "--before" ]);
        if (before.status !== 0) problems.push(`${arm}: "node ${skill}/leftovers.mjs ${member} --root . --before" fails (${said(before)})`);
        const verdict = doctor.output.split("\n").find(line => /^(READY|NOT READY)/.test(line))?.slice(0, 90) ?? said(doctor);
        console.log(`${arm}: .claude/skills/angular-facts holds ${strictSkillFiles(arm).join(", ")}; doctor: ${verdict}; ${compiler} check: ${checked.output.split("\n")[0].slice(0, 110)}`);
    } finally {
        removeDirectory(path.dirname(workspace), `check of ${arm}`);
    }
    return problems;
}

/**
 * The cross-check of --check, also run before every agent run. `problems` is empty when the key and the two trees agree and the
 * tools start; `toolsAlone` holds, per tool, the verdict on its rename command run alone. `tools` names the tool arms whose tool
 * must start (all of them for --check); the tool of an arm that is not run is still tried, and its problem printed as a note.
 * `strictArms` names the strict-skill arms whose skill folder must start (all three for --check, none when no such arm is run).
 */
export async function crossCheck(reference, tools = Object.keys(ARM_TOOLS), strictArms = Object.keys(ARM_STRICT)) {
    const { key, paths } = reference;
    const problems = [];
    const counts = countsOf(key);
    console.log(`key: ${key.task.component}.${key.task.from} -> ${key.task.to}, ${plural(counts.targets, "target")} (${spelled(counts.byKind)}; ${spelled(counts.byTag)}) in ${plural(counts.targetFiles, "file")}, ${plural(counts.decoys, "decoy")} (${spelled(counts.decoysByKind) || "none"})`);
    for (const [ name, count ] of [ [ "targets", counts.targets ], [ "decoys", counts.decoys ], [ "targetFiles", counts.targetFiles ] ]) {
        if (key.counts?.[name] !== undefined && key.counts[name] !== count) problems.push(`the key's counts.${name} says ${key.counts[name]}, its lists give ${count}`);
    }

    for (const [ name, tree ] of [ [ "rename/", paths.before ], [ "rename-expected/", paths.expected ] ]) {
        const started = performance.now();
        const compiled = compile(tree);
        if (compiled.ngcExit === 0) console.log(`${name} compiles: ngc exit 0 (${Math.round((performance.now() - started) / 1000)} s)`);
        else problems.push(`${name} does not compile: ngc exit ${compiled.ngcExit}, ${plural(compiled.ngcErrors, "error")}, first: ${compiled.ngcFirstErrors[0] ?? "?"}`);
    }

    const { applied, problems: keyProblems, unlisted } = applyKey(reference);
    const differences = treeDifferences(applied, reference.expected, "rename + key", "rename-expected");
    if (keyProblems.length) problems.push(`the key does not fit rename/ in ${plural(keyProblems.length, "place")}: ${keyProblems.slice(0, 5).join(" | ")}`);
    if (differences.length) problems.push(`the key applied to rename/ differs from rename-expected/ in ${plural(differences.length, "file")}: ${differences.slice(0, 5).join(" | ")}`);
    if (!keyProblems.length && !differences.length) console.log(`the key applied to rename/ in memory gives exactly rename-expected/ (${plural(applied.size, "file")})`);
    if (unlisted.length) console.warn(`note: ${plural(unlisted.length, "line")} of rename/ hold the word ${key.task.from} without being in the key; the judge counts a change there as collateral of kind "unlisted": ${unlisted.slice(0, 5).join(", ")}`);

    const toolsAlone = {};
    for (const arm of Object.keys(ARM_TOOLS)) {
        let found;
        try {
            const checked = checkTool(arm, reference);
            found = checked.problems;
            if (checked.alone) toolsAlone[arm] = checked.alone;
            if (arm === "ls-facts" && !found.length) found = await comparePlanWithKey(reference);
        } catch (error) {
            found = [ `the check of ${arm} failed: ${error?.stack ?? error}` ];
        }
        if (tools.includes(arm)) problems.push(...found);
        else for (const problem of found) console.warn(`note (the ${arm} arm is not run): ${problem}`);
    }
    for (const arm of strictArms) {
        try {
            problems.push(...checkStrictSkill(arm, reference));
        } catch (error) {
            problems.push(`the check of ${arm} failed: ${error?.stack ?? error}`);
        }
    }
    return { problems, toolsAlone };
}

async function runArm(arm, label, reference, number, settings) {
    const workspace = prepareWorkspace(arm, reference, { git: true });
    mkdirSync(RECORDINGS_DIR, { recursive: true });
    const recordingFile = path.join(RECORDINGS_DIR, `rename-${settings.model}-run-${number}-${arm}.ndjson`);
    const toolRuns = {};
    console.log(`${label} ${arm}: started`);
    const run = await runClaude({
        prompt: RENAME_TASK + ARM_HINTS[arm],
        cwd: workspace,
        model: settings.model,
        budget: settings.budget,
        recordingFile,
        extraTools: arm in ARM_SKILL || arm in ARM_STRICT ? [ "Skill" ] : [],
        onToolUse: block => {
            for (const tool of COUNTED_SCRIPTS) if (block.name === "Bash" && String(block.input?.command ?? "").includes(`${tool}.mjs`)) toolRuns[tool] = (toolRuns[tool] ?? 0) + 1;
            if (block.name === "Skill" || (block.name === "Read" && /SKILL\.md/i.test(String(block.input?.file_path ?? "")))) toolRuns.skill = (toolRuns.skill ?? 0) + 1;
        }
    });
    let verdict;
    try {
        verdict = judge(workspace, reference);
    } catch (error) {
        verdict = { functionallyCorrect: false, judgeError: String(error?.message ?? error).slice(0, 300) };
    }
    const outside = outsideWorkspace(recordingFile, workspace);
    // No result event at all (the CLI did not start, or died): nothing was measured, so the row is kept apart from the counted runs.
    const invalid = Boolean(run.error) && run.costUsd === null;
    const row = { ...run, ...verdict, toolRuns, ...(invalid ? { invalid } : {}), ...(outside.length ? { outsideWorkspace: outside } : {}), workspace, workspaceKept: settings.keep, recording: slash(path.relative(ROOT, recordingFile)) };
    if (!settings.keep) removeDirectory(path.dirname(workspace), `${label} ${arm}`);
    if (outside.length) console.warn(`${label} ${arm}: the recording mentions ${outside.join(", ")}: the run is left out of the summary, read the recording before using it`);
    console.log(`${label} ${arm}: done · ${row.seconds} s · $${(row.costUsd ?? 0).toFixed(2)} · ${row.turns} trips · ${verdict.judgeError ? `NOT JUDGED (${verdict.judgeError})` : verdictLine(verdict)}${row.error ? ` · ERROR ${row.error}` : ""}${invalid ? " · NOT COUNTED (no result from the agent)" : ""}`);
    return row;
}

function runFiles(model) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    return readdirSync(RESULTS_DIR)
        .map(name => ({ name, number: Number(name.match(new RegExp(`^rename-${escapeRegExp(model)}-run-(\\d+)\\.json$`))?.[1]) }))
        .filter(entry => Number.isInteger(entry.number))
        .sort((left, right) => left.number - right.number);
}

/** "3" when every run gave 3, "3–7" otherwise: the lowest and the highest value over the runs. */
function range(values, format = value => String(value)) {
    const numbers = values.filter(value => typeof value === "number");
    if (!numbers.length) return "?";
    const low = Math.min(...numbers);
    const high = Math.max(...numbers);
    return low === high ? format(low) : `${format(low)}–${format(high)}`;
}

export function report(records, counts, settings) {
    const money = value => `$${value.toFixed(2)}`;
    const thousands = value => Math.round(value).toLocaleString("en");
    const cell = (value, format = String) => (typeof value === "number" ? format(value) : "?");
    const flagged = row => Boolean(row.outsideWorkspace?.length);
    const armNames = Object.keys(ARM_LABELS).filter(arm => records.some(record => record.arms[arm]));
    // a run whose recording points outside its workspace is shown in the list of runs and left out of the summary
    const summary = armNames.map(arm => {
        const rows = records.map(record => record.arms[arm]).filter(row => row && !flagged(row));
        if (!rows.length) return `| ${ARM_LABELS[arm]} | no run counted | | | | | | | | | |`;
        return `| ${ARM_LABELS[arm]} | ${rows.filter(row => row.functionallyCorrect).length}/${rows.length} | ${rows.filter(row => row.onlyTheRename).length}/${rows.length} | ${range(rows.map(row => row.missed))} | ${range(rows.map(row => row.collateral))} | ${range(rows.map(row => row.changedLines))} | ${range(rows.map(row => row.ngcErrors))} | ${range(rows.map(row => row.turns))} | ${range(rows.map(row => row.inputTokens), thousands)} | ${range(rows.map(row => row.outputTokens), thousands)} | ${range(rows.map(row => row.costUsd), money)} |`;
    });
    const remarksOf = row => [
        row.modelId ?? "",
        row.error ? `ended with an error: ${row.error}` : "",
        row.judgeError ? `could not be judged: ${row.judgeError}` : "",
        row.unalignedFiles?.length ? `lines moved in ${plural(row.unalignedFiles.length, "file")}, compared as whole files` : "",
        row.addedFiles ? `${plural(row.addedFiles, "file")} added` : "",
        Object.keys(row.toolRuns ?? {}).length ? `tool commands: ${spelled(row.toolRuns)}` : "",
        flagged(row) ? `NOT IN THE SUMMARY: the recording mentions ${row.outsideWorkspace.join(", ")}; read it before using this row` : ""
    ].filter(Boolean).join("; ").replace(/\s*\n\s*/g, " ").replaceAll("|", "/");
    const missedOf = row => (row.missed ? `${row.missed} (${spelled(row.missedByKind)}; ${spelled(row.missedByTag)})` : cell(row.missed));
    const collateralOf = row => (row.collateral ? `${row.collateral} (${spelled(row.collateralByKind)})` : cell(row.collateral));
    const perRun = records.flatMap(record => armNames.filter(arm => record.arms[arm]).map(arm => {
        const row = record.arms[arm];
        return `| ${record.run} | ${ARM_LABELS[arm]} | ${row.functionallyCorrect ? "yes" : "**no**"} | ${row.onlyTheRename ? "yes" : "**no**"} | ${missedOf(row)} | ${collateralOf(row)} | ${cell(row.changedLines)} | ${cell(row.ngcErrors)} | ${cell(row.turns)} | ${cell(row.inputTokens, thousands)} | ${cell(row.outputTokens, thousands)} | ${cell(row.costUsd, money)} | ${cell(row.seconds)} s | ${remarksOf(row)} |`;
    }));
    // the tools without an agent, as the last run recorded them: one command each
    const alone = records.findLast(record => record.toolsAlone && Object.keys(record.toolsAlone).length)?.toolsAlone ?? {};
    const aloneRows = Object.keys(ARM_TOOLS).filter(arm => alone[arm]).map(arm => `| \`${alone[arm].command}\` | ${alone[arm].functionallyCorrect ? "yes" : "**no**"} | ${missedOf(alone[arm])} | ${collateralOf(alone[arm])} | ${cell(alone[arm].changedLines)} | ${cell(alone[arm].ngcErrors)} | ${cell(alone[arm].seconds)} s |`);
    const notCounted = records.flatMap(record => Object.entries(record.invalidArms ?? {}).map(([ arm, row ]) => `- run ${record.run}, ${ARM_LABELS[arm] ?? arm}: not counted, the agent produced no result: ${String(row.error).replace(/\s+/g, " ")}`));
    const leftOut = records.reduce((sum, record) => sum + Object.values(record.arms).filter(flagged).length, 0);
    const modelIds = [ ...new Set(records.flatMap(record => Object.values(record.arms).map(row => row.modelId).filter(Boolean))) ];
    const task = records.at(-1)?.task ?? { component: "PillComponent", from: "disableTooltip", to: "hideHint" };
    const unseen = UNSEEN_BY_COMPILER.filter(kind => counts.byKind?.[kind]);
    const unseenCount = unseen.reduce((sum, kind) => sum + counts.byKind[kind], 0);
    return `# Rename benchmark — ${[ settings.model, ...modelIds ].join(", ")} — ${new Date().toISOString().slice(0, 10)}\n\n`
        + `One refactoring on rename/ (scripts/generate-rename.mjs): rename the input \`${task.component}.${task.from}\` to \`${task.to}\` everywhere, and nowhere else. `
        + `The key lists ${plural(counts.targets, "place")} that must change (${spelled(counts.byKind)}; by element: ${spelled(counts.byTag)}) in ${plural(counts.targetFiles, "file")}, and ${plural(counts.decoys, "place")} where the same word must stay (${spelled(counts.decoysByKind ?? {}) || "none"}). `
        + `${plural(records.length, "run")}, arms one after another, budget cap $${settings.budget} per arm. Ranges are lowest–highest over the runs. `
        + "Every arm works in a copy of the app (a git repository with one commit) with a shell, node and the app's packages; a tool arm also gets its one tool in ../tools and a few lines about it (bench/prompts.mjs); a skill arm gets no such lines: its workspace holds a project skill (.claude/skills/angular-facts: SKILL.md from skill/angular-facts plus the named scripts) that the agent has to pick up on its own; a strict skill arm is the same with the next version of the skill (skill/angular-facts-strict: SKILL.md as written, doctor, leftovers, ajs-facts, reference/ and the named scripts).\n\n"
        + "How to read this. A run is correct when the compiler reports no error, no target was missed and nothing that had to stay was changed. "
        + "Only the rename = correct, and no other line of the app differs from the expected app (the task says \"do not change anything else\"); a file the agent added does not count. "
        + "Missed targets = places of the key where the old name was not replaced by the new one. Collateral = places with the same word that had to stay and were changed. "
        + "Other lines = lines of the app that differ from the expected app in something other than the name at a place of the key (a rewritten expression, an edited library file). "
        + "Trips = requests to the model; tokens sent include the cached ones.\n\n"
        + "What the numbers can and cannot show. "
        + "The key comes from the generator's model, not from a tool; before every run it is checked against both trees. No tool has to agree with it: what each tool's rename command leaves when it is run alone is in the table \"The tools alone\". "
        + `${unseenCount ? `Of the ${counts.targets} targets, ${unseenCount} (${unseen.map(kind => `${counts.byKind[kind]} ${kind}`).join(", ")}) leave no compiler error when they are missed, so "the compiler is green" proves the other ${counts.targets - unseenCount} only. ` : ""}`
        + "Both tools have a `check` command that prints the compiler's errors in a few lines; the arm without a tool reads the raw output of ngc, which is far longer for a broken app, so trips, tokens and cost of that arm include reading it. "
        + "The app is generated and regular: one signal input, strict templates, one level of inheritance, every component with its own element tag. The result says how the arms do on this app, not how robust a tool is on other code."
        + `${notCounted.length ? ` ${plural(notCounted.length, "arm run")} produced no result at all and ${notCounted.length === 1 ? "is" : "are"} not counted.` : ""}`
        + `${leftOut ? ` ${plural(leftOut, "run")} ${leftOut === 1 ? "is" : "are"} left out of the summary because the recording mentions something outside the workspace; see the remarks.` : ""}\n\n`
        + `| Agent | Runs correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${summary.join("\n")}\n\n`
        + `${aloneRows.length ? `## The tools alone\n\nOne command, no agent, on the untouched app: what an agent of that arm gets for its first tool call.\n\n| Command | Correct | Missed targets | Collateral | Other lines | ngc errors | Time |\n|---|---|---|---|---:|---:|---:|\n${aloneRows.join("\n")}\n\n` : ""}`
        + "## Runs\n\n| Run | Agent | Correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost | Time | Remarks |\n|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|\n"
        + `${perRun.join("\n")}\n${notCounted.length ? `\n${notCounted.join("\n")}\n` : ""}`;
}

/** A tiny app for --self-test. %T:kind:element% marks an occurrence that must change, %D:kind:element% one that must stay. */
const SELF_TEST_TASK = { component: "PillComponent", from: "disableTooltip", to: "hideHint" };
const SELF_TEST_FILES = {
    "package.json": `{\n  "name": "rename-self-test",\n  "version": "0.0.0",\n  "private": true\n}\n`,
    "tsconfig.json": `${JSON.stringify({
        compilerOptions: { rootDir: "./src", noEmit: true, strict: true, target: "ES2022", module: "ES2022", moduleResolution: "bundler", experimentalDecorators: true, skipLibCheck: true, lib: [ "ES2022", "dom" ] },
        angularCompilerOptions: { strictTemplates: true, strictInjectionParameters: true, strictInputAccessModifiers: true },
        include: [ "src/**/*.ts" ]
    }, null, 2)}\n`,
    "src/main.ts": `import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent).catch(error => console.error(error));
`,
    "src/app/app.component.ts": `import { ChangeDetectionStrategy, Component } from "@angular/core";
import { FeatureOneComponent } from "./features/feature-1/feature-1.component";
import { FeatureTwoComponent } from "./features/feature-2/feature-2.component";

@Component({
    selector: "app-root",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ FeatureOneComponent, FeatureTwoComponent ],
    template: \`<h1>{{ title }}</h1><app-feature-1 /><app-feature-2 />\`
})
export class AppComponent {
    readonly title = "rename self-test";
}
`,
    "src/app/lib/pill.component.ts": `import { booleanAttribute, ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
    selector: "app-pill",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<span class="pill" [class]="variant()">{{ label() }}@if (!%T:template-read:%()) {<span class="hint">i</span>}</span>\`
})
export class PillComponent {
    readonly %T:declaration:% = input(false, { transform: booleanAttribute });
    readonly label = input("");
    readonly variant = input<"info" | "success" | "warning">("info");
}
`,
    "src/app/lib/fancy-pill.component.ts": `import { ChangeDetectionStrategy, Component, computed } from "@angular/core";
import { PillComponent } from "./pill.component";

/** Inherits every input of PillComponent and declares none of them. */
@Component({
    selector: "app-fancy-pill",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<b [class]="variant()">{{ label() }}@if (!%T:template-read:%()) {<i>!</i>}</b>\`
})
export class FancyPillComponent extends PillComponent {
    readonly quiet = computed(() => this.%T:class-read:%());
}
`,
    "src/app/lib/card.component.ts": `import { booleanAttribute, ChangeDetectionStrategy, Component, input } from "@angular/core";

/** Another component: its %D:comment:% input is not the pill's. */
@Component({
    selector: "app-card",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<section>@if (!%D:other-component:app-card%()) {<small>i</small>}<ng-content /></section>\`
})
export class CardComponent {
    readonly %D:other-component:app-card% = input(false, { transform: booleanAttribute });
}
`,
    "src/app/features/feature-1/feature-1.component.html": `<!-- %D:comment:% on the card is the card's own input -->
<app-card [%D:other-component:app-card%]="muted">
    <app-pill label="A" [%T:binding:app-pill%]="muted" />
    <app-pill
        label="B"
        %T:static:app-pill%
    />
    <app-fancy-pill label="C" [%T:binding:app-fancy-pill%]="count > 2" />
    <app-pill label="D" [%T:binding:app-pill%]="true" /> <app-pill label="E" [%T:binding:app-pill%]="!muted" />
</app-card>
@if (%D:class-field:%) {
    <p>{{ %D:class-field:% }}</p>
}
`,
    "src/app/features/feature-1/feature-1.component.ts": `import { ChangeDetectionStrategy, Component, computed, viewChild } from "@angular/core";
import { CardComponent } from "../../lib/card.component";
import { FancyPillComponent } from "../../lib/fancy-pill.component";
import { PillComponent } from "../../lib/pill.component";

@Component({
    selector: "app-feature-1",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ CardComponent, FancyPillComponent, PillComponent ],
    templateUrl: "./feature-1.component.html"
})
export class FeatureOneComponent {
    readonly %D:class-field:% = "a class field with the same name";
    readonly muted = false;
    readonly count = 3;
    readonly firstPill = viewChild(PillComponent);
    readonly firstIsQuiet = computed(() => this.firstPill()?.%T:class-read:%() ?? false);
}
`,
    "src/app/features/feature-2/feature-2.component.ts": `import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CardComponent } from "../../lib/card.component";
import { FancyPillComponent } from "../../lib/fancy-pill.component";
import { PillComponent } from "../../lib/pill.component";

@Component({
    selector: "app-feature-2",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ CardComponent, FancyPillComponent, PillComponent ],
    template: \`
        <app-pill label="F" [%T:binding:app-pill%]="items.length > 1" />
        <app-fancy-pill label="G" %T:static:app-fancy-pill% />
        <app-card %D:other-component:app-card%>{{ note }}</app-card>
    \`
})
export class FeatureTwoComponent {
    readonly items = [ "one", "two" ];
    readonly note = "%D:text:% is only a word here";
}
`
};

/** Writes <out>/rename, <out>/rename-expected and <out>/rename-key.json from SELF_TEST_FILES, and links <out>/node_modules. */
function writeSelfTestApp(out) {
    const token = /%([TD]):([\w-]+):([\w-]*)%/g;
    const { from, to } = SELF_TEST_TASK;
    const key = { task: SELF_TEST_TASK, targets: [], decoys: [] };
    for (const [ file, text ] of Object.entries(SELF_TEST_FILES)) {
        text.split("\n").forEach((line, index) => {
            for (const [ , type, kind, on ] of line.matchAll(token)) {
                const inline = file.endsWith(".ts") && [ "binding", "static", "template-read" ].includes(kind);
                (type === "T" ? key.targets : key.decoys).push(type === "T" ? { file, line: index + 1, kind, on: on || null, inline } : { file, line: index + 1, kind, on: on || null });
            }
        });
        for (const [ tree, name ] of [ [ "rename", from ], [ "rename-expected", to ] ]) {
            mkdirSync(path.dirname(path.join(out, tree, file)), { recursive: true });
            writeFileSync(path.join(out, tree, file), text.replace(token, (_token, type) => (type === "T" ? name : from)));
        }
    }
    key.counts = { targets: key.targets.length, byKind: countBy(key.targets, entry => entry.kind), byTag: countBy(key.targets, entry => String(entry.on)), decoys: key.decoys.length, files: Object.keys(SELF_TEST_FILES).length, targetFiles: new Set(key.targets.map(entry => entry.file)).size };
    writeFileSync(path.join(out, "rename-key.json"), `${JSON.stringify(key, null, 2)}\n`);
    symlinkSync(packagesDirectory(), path.join(out, "node_modules"), "junction");
}

/** Seven results made by hand from the expected tree, and the verdict the judge must give on each. */
const SELF_TEST_CASES = [
    { name: "perfect", change: () => {}, expect: { ngcExit: 0, ngcErrors: 0, missed: 0, collateral: 0, otherChanges: 0, functionallyCorrect: true, onlyTheRename: true } },
    {
        name: "missed inherited use (and one of two on a line)",
        change: edit => edit("src/app/features/feature-1/feature-1.component.html", text => text.replace(`[hideHint]="count > 2"`, `[disableTooltip]="count > 2"`).replace(`[hideHint]="!muted"`, `[disableTooltip]="!muted"`)),
        expect: { compiles: false, missed: 2, missedByKind: { binding: 2 }, missedByTag: { "app-fancy-pill": 1, "app-pill": 1 }, collateral: 0, otherChanges: 0, functionallyCorrect: false }
    },
    {
        name: "renamed decoys (a class field, its reads, a comment)",
        change: edit => {
            edit("src/app/features/feature-1/feature-1.component.ts", text => text.replace("readonly disableTooltip =", "readonly hideHint ="));
            edit("src/app/features/feature-1/feature-1.component.html", text => text.replace("<!-- disableTooltip", "<!-- hideHint").replace("@if (disableTooltip)", "@if (hideHint)").replace("{{ disableTooltip }}", "{{ hideHint }}"));
        },
        expect: { ngcExit: 0, ngcErrors: 0, missed: 0, collateral: 4, collateralByKind: { "class-field": 3, comment: 1 }, otherChanges: 0, functionallyCorrect: false }
    },
    {
        name: "does not compile (a type error in a file without targets)",
        change: edit => edit("src/app/app.component.ts", text => text.replace("readonly title =", "readonly title: number =")),
        expect: { compiles: false, ngcErrors: 1, missed: 0, collateral: 0, otherChanges: 1, functionallyCorrect: false }
    },
    {
        name: "lines moved, one static attribute left (the compiler does not see it)",
        change: edit => edit("src/app/features/feature-1/feature-1.component.html", text => `\n${text.replace("        hideHint\n", "        disableTooltip\n")}`),
        expect: { ngcExit: 0, ngcErrors: 0, missed: 1, missedByKind: { static: 1 }, missedByTag: { "app-pill": 1 }, collateral: 0, otherChanges: 1, unalignedFiles: [ "src/app/features/feature-1/feature-1.component.html" ], functionallyCorrect: false }
    },
    { name: "perfect, written with Windows line ends", change: (_edit, files) => { for (const [ file, text ] of files) files.set(file, text.replace(/\n/g, "\r\n")); }, expect: { ngcExit: 0, missed: 0, collateral: 0, otherChanges: 0, functionallyCorrect: true, onlyTheRename: true } },
    {
        name: "every name right, but an expression inverted, a library template edited and a script left behind",
        change: (edit, files) => {
            edit("src/app/features/feature-1/feature-1.component.html", text => text.replace(`[hideHint]="!muted"`, `[hideHint]="muted"`));
            edit("src/app/lib/card.component.ts", text => text.replace("<small>i</small>", "<small>?</small>"));
            files.set("rename-all.mjs", "// a helper the agent wrote\n");
        },
        expect: { ngcExit: 0, missed: 0, collateral: 0, otherChanges: 3, changedLines: 2, addedFiles: 1, functionallyCorrect: true, onlyTheRename: false }
    }
];

/** Builds the tiny app, checks that its key reproduces its expected tree, and judges the seven hand-made results. Exit code 1 on any surprise. */
function selfTest(keep) {
    const out = mkdtempSync(path.join(os.tmpdir(), "rename-self-test-"));
    writeSelfTestApp(out);
    const reference = loadReference(out);
    const failures = [];
    const { applied, problems, unlisted } = applyKey(reference);
    const differences = [ ...problems, ...unlisted.map(where => `${where}: not in the key`), ...treeDifferences(applied, reference.expected, "rename + key", "rename-expected") ];
    console.log(`${differences.length ? "FAILED" : "ok"}: the key (${plural(reference.key.targets.length, "target")}, ${plural(reference.key.decoys.length, "decoy")}) applied to the tiny app gives its expected tree${differences.length ? `: ${differences.join(" | ")}` : ""}`);
    if (differences.length) failures.push("key");
    SELF_TEST_CASES.forEach((testCase, index) => {
        const files = new Map(Object.keys(SELF_TEST_FILES).map(file => [ file, readFileSync(path.join(out, "rename-expected", file), "utf8") ]));
        testCase.change((file, change) => {
            const changed = change(files.get(file));
            if (changed === files.get(file)) throw new Error(`self-test case "${testCase.name}" changes nothing in ${file}`);
            files.set(file, changed);
        }, files);
        const workspace = path.join(out, "cases", `case-${index + 1}`, "workspace");
        for (const [ file, text ] of files) {
            mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
            writeFileSync(path.join(workspace, file), text);
        }
        const verdict = judge(workspace, reference);
        const { compiles, ...exact } = testCase.expect;
        const written = value => JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).sort() : value);
        const wrong = Object.entries(exact).filter(([ name, value ]) => written(verdict[name]) !== written(value)).map(([ name, value ]) => `${name} is ${JSON.stringify(verdict[name])}, expected ${JSON.stringify(value)}`);
        if (compiles === false && (verdict.ngcExit === 0 || verdict.ngcErrors < 1)) wrong.push(`ngc exit ${verdict.ngcExit} with ${verdict.ngcErrors} errors, expected a failing compile`);
        console.log(`${wrong.length ? "FAILED" : "ok"}: ${testCase.name}: ${verdictLine(verdict)}${wrong.length ? `\n  ${wrong.join("\n  ")}` : ""}`);
        if (wrong.length) failures.push(testCase.name);
    });
    if (keep) console.log(`kept ${out}: OUT="${out}" node bench/rename.mjs --check runs the cross-check on this tiny app, --score "${path.join(out, "cases", "case-2", "workspace")}" judges one case`);
    else removeDirectory(out, "self-test");
    if (failures.length) fail(`self-test: ${failures.length} of ${SELF_TEST_CASES.length + 1} checks failed`);
    console.log(`self-test: ${SELF_TEST_CASES.length + 1} checks passed`);
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    const settings = { model: String(args.model ?? "sonnet"), budget: String(args.budget ?? "3"), keep: Boolean(args.keep) };
    const arms = String(args.arms ?? Object.keys(ARM_LABELS).join(",")).split(",");
    const runs = Number(args.runs ?? 1);
    if (args.help || arms.some(arm => !(arm in ARM_LABELS)) || !Number.isInteger(runs) || runs < 1 || args.score === true) fail(USAGE);
    if (args["self-test"]) return selfTest(settings.keep);

    let reference;
    try {
        reference = loadReference();
    } catch (error) {
        fail(error.message);
    }
    if (args.score) {
        const workspace = path.resolve(args.score);
        if (!existsSync(workspace)) fail(`${workspace} does not exist`);
        console.log(JSON.stringify(judge(workspace, reference), null, 2));
        return;
    }
    const { problems, toolsAlone } = await crossCheck(
        reference,
        args.check ? Object.keys(ARM_TOOLS) : [ ...new Set(arms.flatMap(arm => ARM_SKILL[arm] ?? (arm in ARM_TOOLS ? [ arm ] : []))) ],
        args.check ? Object.keys(ARM_STRICT) : arms.filter(arm => arm in ARM_STRICT)
    );
    if (problems.length) fail(`${plural(problems.length, "problem")}${args.check ? "" : ": no agent was started"}\n${problems.map(problem => `  FAILED: ${problem}`).join("\n")}`);
    console.log(args.check ? "check passed" : "cross-check passed");
    if (args.check) return;

    const counts = countsOf(reference.key);
    for (let index = 0; index < runs; index++) {
        const number = 1 + (runFiles(settings.model).at(-1)?.number ?? 0);
        const label = `[rename run ${number}]`;
        const startedAt = new Date().toISOString();
        const rows = {};
        const invalidArms = {};
        for (const arm of arms) {
            const row = await runArm(arm, label, reference, number, settings);
            (row.invalid ? invalidArms : rows)[arm] = row;
        }
        if (!Object.keys(rows).length) fail(`${label}: no arm produced a result (${Object.values(invalidArms).map(row => row.error).join(" | ")}); nothing was written`);
        const record = { model: settings.model, run: number, startedAt, budget: Number(settings.budget), task: reference.key.task, counts, toolsAlone, arms: rows, ...(Object.keys(invalidArms).length ? { invalidArms } : {}) };
        writeFileSync(path.join(RESULTS_DIR, `rename-${settings.model}-run-${number}.json`), JSON.stringify(record, null, 2) + "\n");
    }
    const records = runFiles(settings.model).map(entry => JSON.parse(readFileSync(path.join(RESULTS_DIR, entry.name), "utf8")));
    if (records.length) {
        const text = report(records, counts, settings);
        writeFileSync(path.join(RESULTS_DIR, `rename-results-${settings.model}.md`), text);
        console.log("\n" + text);
    }
}

if (import.meta.main ?? process.argv[1] === fileURLToPath(import.meta.url)) {
    await main();
    // The language service that --check loads in-process may leave timers behind: do not wait for them once the work is done.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
}
