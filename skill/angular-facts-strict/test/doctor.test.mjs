#!/usr/bin/env node
// Tests of doctor.mjs on tiny workspaces it builds itself in the temp folder. No package is needed and nothing outside the temp
// folder is written: the workspaces hold stub packages (a package.json with a name and a version), which is all doctor reads.
//   node test/doctor.test.mjs            (from the skill folder; exit code 1 when a case fails)
//   node test/doctor.test.mjs --keep     (leaves the temp folder in place and prints where it is)
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCTOR = path.join(SKILL, "doctor.mjs");
const SCRIPTS = [ "ng-facts.mjs", "ajs-facts.mjs", "ls-facts.mjs", "leftovers.mjs" ];
const base = mkdtempSync(path.join(os.tmpdir(), "angular-facts-doctor-"));
/** A version no real package has, so a language service found above the skill folder never counts as the matching one. */
const CORE_VERSION = "99.1.2";

function write(file, content) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

function stubPackages(root, names) {
    for (const name of names) write(path.join(root, "node_modules", name, "package.json"), { name, version: name === "typescript" ? "9.9.9" : CORE_VERSION });
}

const COMPONENT = (name, extra = "") => `import { Component, input } from "@angular/core";\n@Component({ selector: "x-${name}", ${extra} })\nexport class ${name}Component { readonly label = input(""); }\n`;

/** A workspace with angular.json, a tsconfig with comments and an app in `sourceRoot`. */
function makeWorkspace(root, { sourceRoot = "src", packages = [ "typescript", "@angular/core", "@angular/compiler", "@angular/compiler-cli", "@angular/language-service" ], solution = false } = {}) {
    write(path.join(root, "angular.json"), { version: 1, projects: { sample: { projectType: "application", root: "", sourceRoot, architect: { build: { options: { tsConfig: "tsconfig.app.json" } } } } } });
    write(path.join(root, "tsconfig.json"), solution
        ? "// a solution config\n{ \"files\": [], \"references\": [ { \"path\": \"./tsconfig.app.json\" } ] }\n"
        : "/* comments are allowed here */\n{\n  \"compilerOptions\": { \"strict\": true, },\n  \"angularCompilerOptions\": { \"strictTemplates\": true }, // trailing comma above\n}\n");
    write(path.join(root, "tsconfig.app.json"), { extends: "./tsconfig.json", angularCompilerOptions: { strictInputAccessModifiers: true }, include: [ `${sourceRoot}/**/*.ts` ] });
    write(path.join(root, "package.json"), { name: "sample", dependencies: { "@angular/core": CORE_VERSION } });
    write(path.join(root, sourceRoot, "app", "one.component.ts"), COMPONENT("One", "templateUrl: \"./one.component.html\""));
    write(path.join(root, sourceRoot, "app", "one.component.html"), "<x-two [label]=\"title\" />\n");
    write(path.join(root, sourceRoot, "app", "two.component.ts"), COMPONENT("Two", "template: `<b>{{ label() }}</b>`"));
    write(path.join(root, sourceRoot, "app", "two.component.spec.ts"), "describe(\"two\", () => {});\n");
    write(path.join(root, sourceRoot, "app", "styles.scss"), "x-two[label] { color: red; }\n");
    stubPackages(root, packages);
    return root;
}

function doctor(...args) {
    const run = spawnSync(process.execPath, [ DOCTOR, ...args ], { encoding: "utf8" });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const failures = [];
function check(name, condition, detail) {
    console.log(`${condition ? "ok  " : "FAIL"} ${name}`);
    if (!condition) failures.push(`${name}\n${detail}`);
}
const allScriptsHere = SCRIPTS.every(script => existsSync(path.join(SKILL, script)));

// 1. a complete workspace: counts, the chosen tsconfig, strictness read through comments, every package found in the workspace
{
    const root = makeWorkspace(path.join(base, "complete"));
    const { status, output } = doctor("--root", root);
    check("complete workspace: names the workspace folder", output.includes(`${root.split(path.sep).join("/")}\n             ← pass this folder as --root`), output);
    check("complete workspace: counts sources", /3 \.ts \(1 spec, 0 stories\), 1 \.html, 1 style files/.test(output), output);
    check("complete workspace: counts components and templates", /2 components/.test(output) && /1 in \.html files \(templateUrl\), 1 inline/.test(output), output);
    check("complete workspace: no AngularJS", /AngularJS\s+no:/.test(output), output);
    check("complete workspace: names the config that check compiles and why", output.includes("check compiles tsconfig.app.json (the build target of angular.json)"), output);
    check("complete workspace: strictness of that config, its own and through extends, read although the parent has comments and a trailing comma", /strictTemplates true, strictInputAccessModifiers true/.test(output), output);
    check("complete workspace: lists the tsconfig projects ls-facts chooses from", /here \(source files listed\): tsconfig\.app\.json \S+, tsconfig\.json \S+/.test(output), output);
    check("complete workspace: exit code follows the verdict", allScriptsHere ? status === 0 && output.includes("READY: every script can run") : status === 1 && output.includes("NOT READY"), output);
}

// 2. no language service in the workspace: exit 1 and the exact install line, into the skill folder, for the version of @angular/core
{
    const root = makeWorkspace(path.join(base, "no-service"), { packages: [ "typescript", "@angular/core", "@angular/compiler", "@angular/compiler-cli" ] });
    const { status, output } = doctor("--root", root);
    const installLine = `npm install --prefix "${SKILL.split(path.sep).join("/")}" --no-save @angular/language-service@${CORE_VERSION}`;
    check("no language service: exit 1", status === 1, output);
    check("no language service: the exact install line", output.includes(installLine), `${output}\nexpected: ${installLine}`);
    check("no language service: only ls-facts is blamed", /ls-facts\.mjs\s+CANNOT RUN/.test(output) && (!allScriptsHere || /leftovers\.mjs\s+ok/.test(output)), output);
}

// 3. no packages at all: the parser scripts cannot run either, and the fix is npm install in the workspace
{
    const root = makeWorkspace(path.join(base, "no-packages"), { packages: [ "@angular/core" ] });
    const { status, output } = doctor("--root", root);
    // typescript may still be found above the skill folder (a skill that lives inside a project): then nothing is missing for the parser
    const found = /typescript \S+\s+← skill folder/.test(output);
    check("no packages: exit 1", status === 1, output);
    check("no packages: says what to install, or found the package above the skill folder", found || /typescript is not installed: run npm install/.test(output), output);
}

// 3b. the app has no @angular/core of its own: one next to the skill does not count for ls-facts and check (they compile the app)
{
    const root = makeWorkspace(path.join(base, "no-core"), { packages: [ "typescript", "@angular/compiler", "@angular/compiler-cli", "@angular/language-service" ] });
    const { status, output } = doctor("--root", root);
    const coreNextToSkill = /@angular\/core \S+\s+← skill folder/.test(output);
    check("no @angular/core in the app: exit 1 and ls-facts blamed with npm install in the app",
        status === 1 && /ls-facts\.mjs\s+CANNOT RUN: @angular\/core is not installed( in the app)?/.test(output) && (!coreNextToSkill || /! the app has no node_modules with @angular\/core/.test(output)), output);
}

// 4. sources outside src/app, taken from angular.json
{
    const root = makeWorkspace(path.join(base, "elsewhere"), { sourceRoot: "projects/sample/code" });
    const { output } = doctor("--root", root);
    check("sourceRoot from angular.json: sources found in projects/sample/code", output.includes("projects/sample/code (angular.json): 3 .ts"), output);
}

// 5. a solution-style tsconfig.json (it lists no file and refers to the others): it is shown with 0 files, the build config is compiled
{
    const root = makeWorkspace(path.join(base, "solution"), { solution: true, packages: [ "@angular/core", "@angular/compiler", "@angular/compiler-cli", "@angular/language-service" ] });
    const { output } = doctor("--root", root);
    // The stub typescript cannot be loaded. A real one is found only when this skill folder sits inside a project that has it:
    // then the files are counted; else the counts are unknown and shown as "?".
    const counted = !/TypeScript NOT FOUND/.test(output);
    check("solution-style tsconfig.json: file counts per config (when TypeScript can be loaded), and the build config for check", (counted
        ? output.includes("tsconfig.app.json 3, tsconfig.json 0")
        : output.includes("tsconfig.app.json ?, tsconfig.json ?")) && output.includes("check compiles tsconfig.app.json"), output);
}

// 6. --root is the parent of the workspace: the one child with a config is used, and said
{
    const parent = path.join(base, "repository");
    const root = makeWorkspace(path.join(parent, "web-app"));
    mkdirSync(path.join(parent, "docs"), { recursive: true });
    const { output } = doctor("--root", parent);
    check("parent folder: uses the one Angular workspace below it and says so", output.includes(`${root.split(path.sep).join("/")}\n             ← pass this folder as --root`) && /! .*has no angular\.json: the one Angular workspace below it is used, web-app\//.test(output), output);
    makeWorkspace(path.join(parent, "admin-app"));
    const second = doctor("--root", parent);
    check("parent folder with two workspaces: exit 1 and both named", second.status === 1 && second.output.includes("admin-app, web-app"), second.output);
    // a repository that keeps the app two levels down and has a tsconfig of its own at the top
    const repository = path.join(base, "monorepo");
    const deep = makeWorkspace(path.join(repository, "website", "client"));
    write(path.join(repository, "tsconfig.json"), "{ \"files\": [] }\n");
    write(path.join(repository, "package.json"), { name: "monorepo" });
    const fromTop = doctor("--root", repository);
    check("repository root with its own tsconfig: the Angular workspace two levels down is used and said", fromTop.output.includes(`${deep.split(path.sep).join("/")}\n             ← pass this folder as --root`) && fromTop.output.includes("website/client/"), fromTop.output);
    const inside = doctor("--root", path.join(root, "src", "app"));
    check("a folder inside the workspace: exit 1 and the workspace named", inside.status === 1 && inside.output.includes("pass that folder as --root"), inside.output);
    // a project folder with a tsconfig of its own, inside the workspace: the workspace above is used
    write(path.join(root, "projects", "shop", "tsconfig.app.json"), { extends: "../../tsconfig.json" });
    const project = doctor("--root", path.join(root, "projects", "shop"));
    check("a project folder with its own tsconfig inside the workspace: the workspace above is named and used", project.output.includes(`${root.split(path.sep).join("/")}\n             ← pass this folder as --root`) && /is a project inside the workspace/.test(project.output), project.output);
}

// 6b. no tsconfig at all (an AngularJS app without TypeScript): READY, and ls-facts is NOT USABLE HERE with its replacements
{
    const root = path.join(base, "plain-angularjs");
    write(path.join(root, "package.json"), { name: "legacy", dependencies: { angular: "1.8.3" } });
    write(path.join(root, "src", "app.js"), "angular.module(\"legacy\", []);\n");
    stubPackages(root, [ "typescript", "@angular/core", "@angular/compiler", "@angular/compiler-cli", "@angular/language-service" ]);
    const plain = doctor("--root", root);
    check("no tsconfig: exit 0, READY, ls-facts NOT USABLE HERE", plain.status === 0 && /ls-facts\.mjs\s+NOT USABLE HERE/.test(plain.output) && /^READY: /m.test(plain.output), plain.output);
}

// 7. a hybrid app: AngularJS is seen, and the .html files Angular does not compile are counted
{
    const root = makeWorkspace(path.join(base, "hybrid"));
    write(path.join(root, "package.json"), { name: "sample", dependencies: { "@angular/core": CORE_VERSION, angular: "1.8.3" } });
    write(path.join(root, "src", "app", "ajs", "legacy.module.js"), "angular.module(\"legacy\", []).component(\"oldCard\", { templateUrl: \"old-card.html\" });\n");
    write(path.join(root, "src", "app", "ajs", "old-card.html"), "<x-two [label]=\"$ctrl.title\"></x-two>\n");
    write(path.join(root, "src", "app", "ajs", "downgrade.ts"), "import { downgradeComponent } from \"@angular/upgrade/static\";\nangular.module(\"legacy\").directive(\"xTwo\", downgradeComponent({ component: TwoComponent }));\n");
    const { output } = doctor("--root", root);
    check("hybrid: AngularJS yes with the version", /AngularJS\s+yes: angular 1\.8\.3 in package\.json, 2 files with angular\.module/.test(output) && output.includes("1 downgrade"), output);
    check("hybrid: counts the .html files Angular does not compile", output.includes("1 .html files are not the templateUrl of an Angular component"), output);
}

// 8. wrong calls
{
    const missing = doctor("--root", path.join(base, "nowhere"));
    check("a folder that does not exist: exit 1, one line", missing.status === 1 && /no such directory/.test(missing.output) && missing.output.trim().split("\n").length === 1, missing.output);
    const unknown = doctor("--frobnicate");
    check("an unknown option: exit 1 with the usage", unknown.status === 1 && unknown.output.includes("usage: node doctor.mjs"), unknown.output);
    const help = doctor("--help");
    check("--help: exit 0", help.status === 0 && help.output.includes("Exit code 0: READY"), help.output);
}

// 9. a copy of the skill that holds one fact script only: the missing one is no error, its line names what to run instead
if (allScriptsHere) {
    const root = path.join(base, "complete");
    const copyWith = (name, scripts) => {
        const folder = path.join(base, name);
        mkdirSync(folder, { recursive: true });
        for (const script of [ "doctor.mjs", ...scripts ]) cpSync(path.join(SKILL, script), path.join(folder, script));
        const run = spawnSync(process.execPath, [ path.join(folder, "doctor.mjs"), "--root", root ], { encoding: "utf8" });
        return { status: run.status, output: `${run.stdout}${run.stderr}` };
    };
    const parserOnly = copyWith("copy-parser", [ "ng-facts.mjs", "ajs-facts.mjs", "leftovers.mjs" ]);
    check("a copy without ls-facts.mjs: READY, exit 0, and the line of ls-facts names ng-facts usages, rename-input and check",
        parserOnly.status === 0 && /^READY: every script of this copy can run; 1 script is not in it/m.test(parserOnly.output) && /ls-facts\.mjs\s+NOT IN THIS COPY/.test(parserOnly.output)
        && parserOnly.output.includes("ng-facts usages <Class>.<name>") && parserOnly.output.includes("ng-facts rename-input") && parserOnly.output.includes("check → ng-facts check"), parserOnly.output);
    check("a copy without ls-facts.mjs: no line about the language service's cost", !/One ls-facts command/.test(parserOnly.output), parserOnly.output);
    const serviceOnly = copyWith("copy-service", [ "ls-facts.mjs", "ajs-facts.mjs", "leftovers.mjs" ]);
    check("a copy without ng-facts.mjs: its line names ls-facts refs and says what has no replacement",
        /ng-facts\.mjs\s+NOT IN THIS COPY/.test(serviceOnly.output) && serviceOnly.output.includes("ls-facts refs <Class>") && serviceOnly.output.includes("where, unrouted and migrate have no replacement"), serviceOnly.output);
    const neither = copyWith("copy-neither", [ "ajs-facts.mjs", "leftovers.mjs" ]);
    check("a copy without both fact scripts: NOT READY, exit 1", neither.status === 1 && /NOT READY: 2 scripts cannot run/.test(neither.output), neither.output);
    const noLeftovers = copyWith("copy-no-leftovers", [ "ng-facts.mjs", "ls-facts.mjs", "ajs-facts.mjs" ]);
    check("a copy without leftovers.mjs: NOT READY, exit 1 (nothing replaces it)", noLeftovers.status === 1 && /leftovers\.mjs\s+CANNOT RUN/.test(noLeftovers.output), noLeftovers.output);
    const lines = [ parserOnly, serviceOnly ].flatMap(run => run.output.split("\n"));
    const long = lines.filter(line => line.length > 160 && !line.startsWith("  node \""));
    const cut = lines.filter(line => /^ {17}\S.*…$/.test(line));
    check("a partial copy: no line longer than 160 characters, and no replacement line cut short", long.length === 0 && cut.length === 0, [ ...long, ...cut ].join("\n"));
}

// 10. every line fits a screen
{
    const { output } = doctor("--root", path.join(base, "complete"));
    // the one line that spells the command holds two full paths and is as long as they are
    const long = output.split("\n").filter(line => line.length > 160 && !line.startsWith("  node \""));
    check("no line longer than 160 characters, the command line aside", long.length === 0, long.join("\n"));
}

if (process.argv.includes("--keep")) console.log(`kept: ${base}`);
else rmSync(base, { recursive: true, force: true });
if (failures.length) {
    console.error(`\n${failures.length} failed:\n${failures.join("\n\n")}`);
    process.exit(1);
}
console.log("\nall doctor cases passed");
