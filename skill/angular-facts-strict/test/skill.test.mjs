#!/usr/bin/env node
// Keeps the skill text and the scripts in step: SKILL.md and reference/*.md must name only scripts, commands, options and
// output lines that exist. A procedure whose gate waits for a line no script prints would never end, or end too early.
//   node test/skill.test.mjs            (from anywhere; exit code 1 when a check fails)
// It starts every script with --help (no package is needed for that) and reads the script sources as text. Nothing is written.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = [ "doctor", "ng-facts", "ajs-facts", "ls-facts", "leftovers" ];
/** The commands of each script that the text may name. */
const COMMANDS = {
    "ng-facts": [ "usages", "where", "unrouted", "check", "rename-input", "migrate" ],
    "ajs-facts": [ "summary", "list", "show", "usages" ],
    "ls-facts": [ "refs", "rename", "check" ]
};
/** Lines the procedures wait for (their gates), and the script whose source must hold them. */
const GATE_LINES = [
    [ "leftovers", "DONE" ],
    [ "leftovers", "NOT DONE" ],
    [ "leftovers", "NOT DECIDED" ],
    [ "leftovers", "FINISHED" ],
    [ "leftovers", "NOT FINISHED" ],
    [ "leftovers", "still declares" ],
    [ "ls-facts", "Text only" ],
    [ "ls-facts", "need${plan.decisions.length === 1 ? \"s\" : \"\"} your decision" ],
    [ "doctor", "NOT USABLE HERE" ],
    [ "leftovers", "CHANGE" ],
    [ "leftovers", "leave" ],
    [ "ls-facts", "0 errors" ],
    [ "ls-facts", "NOT DONE" ],
    [ "ls-facts", "written" ],
    [ "ls-facts", "under a derived name" ],
    [ "ls-facts", "added by the template parser" ],
    [ "ls-facts", "check cannot vouch for" ],
    [ "ls-facts", "already has a member" ],
    [ "ng-facts", "nothing left to migrate" ],
    [ "ng-facts", "needs a decision" ],
    [ "ng-facts", "AngularJS can show it" ],
    [ "ng-facts", "has no input or output" ],
    [ "ng-facts", "no component or directive" ],
    [ "ajs-facts", "nothing registered on the AngularJS side" ],
    [ "ajs-facts", "(see note)" ],
    [ "doctor", "READY" ],
    [ "doctor", "NOT READY" ],
    [ "doctor", "NOT IN THIS COPY" ],
    [ "ng-facts", "0 errors" ],
    [ "leftovers", "the right side of" ],
    [ "doctor", "npm install --prefix" ]
];
/** Options the text passes, and the script whose --help must explain them. */
const OPTIONS = [
    [ "leftovers", "--before" ], [ "leftovers", "--all" ], [ "leftovers", "--final" ], [ "leftovers", "--decided" ], [ "leftovers", "--gone" ], [ "ls-facts", "--write" ], [ "ls-facts", "--project" ], [ "ls-facts", "--all" ], [ "ls-facts", "--warm" ],
    [ "ng-facts", "--write" ], [ "ng-facts", "--all" ], [ "ajs-facts", "--unused" ], [ "ajs-facts", "--under" ], [ "ng-facts", "--project" ], [ "ajs-facts", "--json" ], [ "ajs-facts", "--all" ]
];
const MOST_LINES = 130;

const failures = [];
function check(name, condition, detail = "") {
    console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
    if (!condition) failures.push(`${name}${detail ? `\n  ${detail}` : ""}`);
}

const documents = [ "SKILL.md", ...readdirSync(path.join(SKILL, "reference")).filter(name => name.endsWith(".md")).map(name => `reference/${name}`) ];
const textOf = Object.fromEntries(documents.map(name => [ name, readFileSync(path.join(SKILL, name), "utf8") ]));
const sourceOf = Object.fromEntries(SCRIPTS.map(script => [ script, existsSync(path.join(SKILL, `${script}.mjs`)) ? readFileSync(path.join(SKILL, `${script}.mjs`), "utf8") : "" ]));
const helpOf = Object.fromEntries(SCRIPTS.map(script => {
    const run = spawnSync(process.execPath, [ path.join(SKILL, `${script}.mjs`), "--help" ], { encoding: "utf8", timeout: 20_000 });
    return [ script, { status: run.status, text: `${run.stdout ?? ""}${run.stderr ?? ""}` } ];
}));

// 1. the front matter and the size of SKILL.md
{
    const skill = textOf["SKILL.md"];
    const frontMatter = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    const description = frontMatter.match(/^description: (.*)$/m)?.[1] ?? "";
    check("SKILL.md: the name is angular-facts", /^name: angular-facts$/m.test(frontMatter));
    check("SKILL.md: the description fits the limit of 1024 characters and is about more than renames", description.length > 200 && description.length <= 1024 && /dead|delete/.test(description) && /AngularJS/.test(description), `${description.length} characters`);
    const lines = skill.split("\n").length - 1;
    check(`SKILL.md: at most ${MOST_LINES} lines`, lines <= MOST_LINES, `${lines} lines`);
    for (const word of [ "head", "sed", "green compiler", "gate", "DONE", "exit 0", "doctor.mjs" ]) check(`SKILL.md says: ${word}`, skill.includes(word));
}

// 2. every script starts, and every file the text points to exists
for (const script of SCRIPTS) check(`${script}.mjs --help starts and exits 0`, helpOf[script].status === 0, helpOf[script].text.split("\n")[0]);
for (const [ name, text ] of Object.entries(textOf)) {
    const references = [ ...text.matchAll(/<skill>\/(reference\/[\w-]+\.md)/g) ].map(match => match[1]);
    const missing = [ ...new Set(references) ].filter(reference => !existsSync(path.join(SKILL, reference)));
    check(`${name}: every reference file it names exists`, missing.length === 0, missing.join(", "));
    const scripts = [ ...text.matchAll(/<skill>\/([\w-]+)\.mjs/g) ].map(match => match[1]);
    const unknown = [ ...new Set(scripts) ].filter(script => !SCRIPTS.includes(script));
    check(`${name}: every script it names is one of the five`, unknown.length === 0, unknown.join(", "));
}
const linked = new Set([ ...textOf["SKILL.md"].matchAll(/<skill>\/(reference\/[\w-]+\.md)/g) ].map(match => match[1]));
const orphans = documents.filter(name => name.startsWith("reference/") && !linked.has(name));
check("SKILL.md links every file in reference/", orphans.length === 0, orphans.join(", "));

// 3. every command the text names is a command of that script, and is in its --help
for (const [ name, text ] of Object.entries(textOf)) {
    const wrong = [];
    // only what is written as code counts: `ng-facts usages …` and `node <skill>/ng-facts.mjs usages …`
    const code = [ ...text.matchAll(/`([^`\n]+)`/g) ].map(match => match[1]);
    for (const [ script, commands ] of Object.entries(COMMANDS)) {
        for (const span of code) {
            for (const match of span.matchAll(new RegExp(`(?:^|[\\s/])${script}(?:\\.mjs)? ([a-z][a-z-]+)`, "g"))) {
                const command = match[1];
                if (!commands.includes(command)) wrong.push(`${script} ${command}`);
                else if (!helpOf[script].text.includes(command)) wrong.push(`${script} ${command} (not in --help)`);
            }
        }
    }
    check(`${name}: names only commands the scripts have`, wrong.length === 0, [ ...new Set(wrong) ].join(", "));
}

// 4. the lines the gates wait for are printed by the scripts, and the options are explained by --help
for (const [ script, line ] of GATE_LINES) check(`${script}.mjs can print "${line}"`, sourceOf[script].includes(line));
for (const [ script, option ] of OPTIONS) check(`${script}.mjs --help explains ${option}`, helpOf[script].text.includes(option));
for (const kind of [ "components", "directives", "filters", "services", "downgrades", "wrappers", "states" ]) check(`ajs-facts list knows the kind ${kind}`, helpOf["ajs-facts"].text.includes(kind));

// 4b. a "→ next:" line is pasted as it is: one command with no placeholder (<…>, […], a|b, …), or plain words without "node"
for (const script of SCRIPTS) {
    const bad = [];
    for (const [ number, line ] of sourceOf[script].split("\n").entries()) {
        const at = line.search(/→ (?:next|then): /);
        if (at === -1 || /^\s*(?:\/\/|\*)/.test(line)) continue;
        // the printed text: interpolations (${…}, nested once) out, then up to the comment in parentheses or the end of the literal
        let printed = line.slice(at + 8);
        for (let round = 0; round < 3; round++) printed = printed.replace(/\$\{[^{}]*\}/g, "X");
        printed = printed.split(/ {3}\(|`|"\)|\\n/)[0];
        // a command starts the line (node …, or a variable that holds "node …"); a placeholder is never part of it
        if (/[<>|…]|\[--/.test(printed) || (/\bnode\b/.test(printed) && !/^\s*node /.test(printed))) bad.push(`${script}.mjs:${number + 1} ${printed.trim().slice(0, 90)}`);
    }
    check(`${script}.mjs: every "→ next:" line is one pasteable command or plain words`, bad.length === 0, bad.join("\n  "));
}
for (const script of [ "ng-facts", "ajs-facts", "ls-facts", "leftovers" ]) {
    check(`${script}.mjs: commands it prints carry absolute paths in double quotes`, /pasteable = file => `"\$\{slash\(path\.resolve\(file\)\)\}"`|node "\$\{OWN_DIRECTORY\}|node "\$\{slash\(path\.join\(OWN_DIRECTORY/.test(sourceOf[script]));
}

// 5. the exit codes the text relies on are the ones the scripts document
for (const script of [ "ng-facts", "ls-facts", "leftovers" ]) check(`${script}.mjs --help documents exit code 2 for unfinished work`, /Exit code[^\n]*2/.test(helpOf[script].text) || /\b2\b[^\n]*not finished|2 = NOT DONE/.test(helpOf[script].text), helpOf[script].text.split("\n").filter(line => /Exit code/.test(line)).join(" | "));

if (failures.length) {
    console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
    process.exit(1);
}
console.log("\nthe skill text and the scripts agree");
