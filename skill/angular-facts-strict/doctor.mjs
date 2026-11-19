#!/usr/bin/env node
// doctor — the first command of the angular-facts skill: can the scripts in this folder run on this workspace, and what will they read?
//   node doctor.mjs [--root <dir>] [--help]
// It finds the workspace (the folder with angular.json or a tsconfig), the source roots, the Angular version, how much there is
// (components, templates, AngularJS), which tsconfig projects the type-checked script chooses from, which one `check` compiles
// and why, strictTemplates and strictInputAccessModifiers, where every needed package was found, whether git is there, and what
// one language-service command will cost. It reads files and nothing else: no language service is started, nothing is compiled, nothing is written.
// Exit code 0: every script can run. Exit code 1: a script cannot run; the line that says so carries the fix.
// Packages are looked for in the node_modules folders above --root, then above this file. No package is imported statically,
// so this file starts anywhere, also where nothing is installed.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELP = `doctor — checks that the angular-facts scripts can run on a workspace and says what they will read. Run it once, first.
  node doctor.mjs [--root <dir>]
Prints: the workspace folder (pass it as --root to every script), the source roots, the Angular / TypeScript / Node versions,
counts of components, templates and style files, whether AngularJS is present, the tsconfig projects ls-facts chooses from,
the tsconfig "check" compiles and why, strictTemplates / strictInputAccessModifiers, where each package was found, git,
the cost of one language-service command, and one line per script: ok, or CANNOT RUN with the command that fixes it.
It reads files only: no language service, no compiler, no write. It takes about a second.
Options: --root <dir> (default "."), --help.
Exit code 0: READY, every script can run. 1: NOT READY, at least one script cannot run (the fix is printed), or a wrong --root.`;
const USAGE = "usage: node doctor.mjs [--root <dir>] [--help]";

const OWN_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const SCRIPTS = [ "ng-facts.mjs", "ajs-facts.mjs", "ls-facts.mjs", "leftovers.mjs" ];
/**
 * A copy of the skill may hold fewer fact scripts (one parser, one type checker). A script that is not there is no error:
 * its line says what to run in its place wherever a procedure names it, and what then stays unanswered. leftovers.mjs has no
 * replacement, and a copy without ng-facts.mjs and without ls-facts.mjs answers nothing: those are errors.
 */
const REPLACEMENTS = {
    "ls-facts.mjs": [
        "refs <Class>.<name> → ng-facts usages <Class>.<name> · refs <Class> → ng-facts usages <Class> and ng-facts where <Class>",
        "rename → ng-facts rename-input <Class>.<old> <new> [--write] (inputs and outputs only) · check → ng-facts check",
        "Nothing in this copy follows types: code that reads a member shows only as an error of ng-facts check."
    ],
    "ng-facts.mjs": [
        "usages <Class> → ls-facts refs <Class> · usages <Class>.<name> → ls-facts refs <Class>.<name>",
        "rename-input → ls-facts rename · check → ls-facts check",
        "where, unrouted and migrate have no replacement in this copy: say so in your answer."
    ],
    "ajs-facts.mjs": [
        "an input set from AngularJS templates → leftovers <Class>.<name> --before (its AngularJS group)",
        "The other AngularJS questions have no replacement in this copy: say so in your answer."
    ]
};
const SKIPPED_DIRECTORIES = new Set([ "node_modules", "bower_components", "dist", "out-tsc", "coverage", "tmp" ]);
const LINE_WIDTH = 160;
const LABEL_WIDTH = 13;
const SCRIPT_WIDTH = 15;
/** Node 22 is the oldest version the scripts are run on; they use Map.groupBy and import.meta.dirname. */
const NODE_MAJOR_NEEDED = 22;
/** A file this large is generated or minified, not a source: it is counted but not read. */
const LARGEST_SOURCE = 2_000_000;
/**
 * One language-service command (every command loads the project again), measured on two apps (a few hundred files and a few
 * thousand): about three seconds to start plus seven milliseconds a file, and 0.4 GB plus 0.45 MB a file. The compiler
 * (check) on the same two apps: about three seconds plus fifteen milliseconds a file. Rough figures: they say "seconds or
 * about a minute", not more.
 */
const COST = { baseSeconds: 3, secondsPerFile: 0.007, baseGigabytes: 0.4, gigabytesPerFile: 0.00045, checkBaseSeconds: 3, checkSecondsPerFile: 0.015 };

const slash = file => file.split(path.sep).join("/");
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const clip = text => (text.length > LINE_WIDTH ? `${text.slice(0, LINE_WIDTH - 1)}…` : text);

/** JSON with comments and trailing commas (tsconfig.json, angular.json), read without any package. Undefined when it is not JSON. */
function readLooseJson(file) {
    let text;
    try {
        text = readFileSync(file, "utf8").replace(/^﻿/, "");
    } catch {
        return undefined;
    }
    let plain = "";
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === "\"") {
            const start = index;
            for (index++; index < text.length && text[index] !== "\""; index++) if (text[index] === "\\") index++;
            plain += text.slice(start, index + 1);
        } else if (character === "/" && text[index + 1] === "/") {
            while (index < text.length && text[index] !== "\n") index++;
            plain += "\n";
        } else if (character === "/" && text[index + 1] === "*") {
            index = text.indexOf("*/", index + 2);
            if (index < 0) break;
            index++;
        } else {
            plain += character;
        }
    }
    try {
        return JSON.parse(plain.replace(/,(\s*[}\]])/g, "$1"));
    } catch {
        return undefined;
    }
}

const isConfigName = name => name === "angular.json" || /^tsconfig(\..+)?\.json$/.test(name);
const configsIn = directory => {
    try {
        return readdirSync(directory).filter(isConfigName).sort();
    } catch {
        return [];
    }
};
const childDirectories = directory => {
    try {
        return readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name))
            .map(entry => path.join(directory, entry.name));
    } catch {
        return [];
    }
};

/** The folders with an angular.json below `directory`, at most `depth` levels down. A workspace is not searched for another one. */
function angularWorkspacesBelow(directory, depth) {
    if (depth === 0) return [];
    return childDirectories(directory).flatMap(child => (existsSync(path.join(child, "angular.json")) ? [ child ] : angularWorkspacesBelow(child, depth - 1)));
}

/**
 * The workspace a --root means. The folder itself when it holds angular.json. A folder without one (the root of a repository
 * that keeps the app in a sub-folder) leads to the one Angular workspace below it, at most three levels down; that is said in
 * a note, because the other scripts look one level down only and must be given the folder printed here. Without any
 * angular.json: the folder itself when it has a tsconfig, else its only child folder that has one, else the folder itself
 * when it has sources (the scripts that read files still work). `problem` is set when no single folder can be named.
 */
function findWorkspace(rootArgument) {
    const asked = path.resolve(rootArgument);
    if (!existsSync(asked) || !statSync(asked).isDirectory()) {
        return { problem: `no such directory: ${slash(asked)}${rootArgument.includes("\"") ? " (a \" is part of the name: in PowerShell drop the backslash before the closing quote)" : ""}` };
    }
    const here = configsIn(asked);
    if (here.includes("angular.json")) return { root: asked, notes: [] };
    // a project folder inside a workspace (its own tsconfig, the angular.json above it): the workspace is the folder above
    for (let above = path.dirname(asked); above !== path.dirname(above); above = path.dirname(above)) {
        if (!existsSync(path.join(above, "angular.json"))) continue;
        if (here.length) return { root: above, notes: [ `${slash(asked)} is a project inside the workspace ${slash(above)} (its angular.json): that folder is used` ] };
        break;
    }
    const below = angularWorkspacesBelow(asked, 3);
    const shown = directory => slash(path.relative(asked, directory));
    if (below.length === 1) return { root: below[0], notes: [ `${slash(asked)} has no angular.json: the one Angular workspace below it is used, ${shown(below[0])}/` ] };
    if (here.length) return { root: asked, notes: below.length ? [ `${below.length} Angular workspaces are below this folder (${below.map(shown).join(", ")}): for one of them, pass it as --root` ] : [] };
    if (below.length > 1) return { problem: `${slash(asked)} has no angular.json, and ${below.length} folders below it have one: ${below.map(shown).join(", ")}. Pass one of them as --root.` };
    const children = childDirectories(asked).filter(directory => configsIn(directory).length);
    if (children.length === 1) return { root: children[0], notes: [ `${slash(asked)} has no angular.json or tsconfig: its only child folder that has one is used, ${shown(children[0])}/` ] };
    if (children.length > 1) {
        return { problem: `${slash(asked)} has no angular.json or tsconfig, and ${children.length} child folders have a tsconfig: ${children.map(shown).join(", ")}. Pass one of them as --root.` };
    }
    for (let above = path.dirname(asked); above !== path.dirname(above); above = path.dirname(above)) {
        if (existsSync(path.join(above, "angular.json"))) return { problem: `${slash(asked)} is inside the workspace ${slash(above)}: pass that folder as --root.` };
    }
    if (existsSync(path.join(asked, "src")) || existsSync(path.join(asked, "package.json"))) {
        return { root: asked, notes: [ "no angular.json and no tsconfig here: the scripts that read files work, the ones that compile do not" ] };
    }
    return { problem: `${slash(asked)} has no angular.json, no tsconfig and no src folder. Pass the folder of the Angular app as --root.` };
}

/** The folder of a package and its version, from the first node_modules above `root`, then above this file. */
function findPackage(name, root, fits = () => true) {
    let unfit;
    for (const [ start, origin ] of [ [ root, "workspace" ], [ OWN_DIRECTORY, "skill folder" ] ]) {
        for (let directory = start; ; directory = path.dirname(directory)) {
            const manifest = path.join(directory, "node_modules", name, "package.json");
            if (existsSync(manifest)) {
                let version = "?";
                try {
                    version = JSON.parse(readFileSync(manifest, "utf8")).version ?? "?";
                } catch {
                    // a manifest that cannot be read still proves the package is there
                }
                const found = { name, version, directory: path.dirname(manifest), origin };
                if (fits(found)) return found;
                unfit ??= { ...found, unfit: true };
                break;
            }
            if (path.dirname(directory) === directory) break;
        }
    }
    return unfit;
}

/** Every file under the source roots, by kind. Sources are read once: the counts below come from their text. */
function readSources(sourceRoots) {
    const files = { ts: [], html: [], style: [], js: [] };
    const seen = new Set();
    const walk = directory => {
        let entries;
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!seen.has(file)) {
                    seen.add(file);
                    walk(file);
                }
            } else if (/\.d\.[cm]?ts$/.test(entry.name)) {
                // declarations are not sources
            } else if (/\.[cm]?tsx?$/.test(entry.name)) files.ts.push(file);
            else if (/\.html?$/.test(entry.name)) files.html.push(file);
            else if (/\.(css|scss|sass|less)$/.test(entry.name)) files.style.push(file);
            else if (/\.[cm]?js$/.test(entry.name) && !/\.min\.js$/.test(entry.name)) files.js.push(file);
        }
    };
    for (const sourceRoot of sourceRoots) walk(sourceRoot);
    return files;
}

/** What the text of the sources says, counted with regular expressions: enough for "how much is there", not for an answer. */
function countSources(files) {
    const counts = {
        components: 0, directives: 0, pipes: 0, injectables: 0, modules: 0, externalTemplates: 0, inlineTemplates: 0,
        specs: 0, stories: 0, ajsModuleFiles: 0, upgradeFiles: 0, downgrades: 0, htmlOutsideAngular: 0
    };
    const count = (text, pattern) => text.match(pattern)?.length ?? 0;
    const templateFiles = new Set();
    for (const file of files.ts) {
        if (/\.(spec|test)\.[cm]?tsx?$/.test(file)) counts.specs++;
        if (/\.stories\.[cm]?tsx?$/.test(file)) counts.stories++;
        let text;
        try {
            if (statSync(file).size > LARGEST_SOURCE) continue;
            text = readFileSync(file, "utf8");
        } catch {
            continue;
        }
        if (text.includes("@")) {
            counts.components += count(text, /@Component\s*\(/g);
            counts.directives += count(text, /@Directive\s*\(/g);
            counts.pipes += count(text, /@Pipe\s*\(/g);
            counts.injectables += count(text, /@Injectable\s*\(/g);
            counts.modules += count(text, /@NgModule\s*\(/g);
        }
        if (text.includes("template")) {
            for (const match of text.matchAll(/\btemplateUrl\s*:\s*(["'`])([^"'`]+)\1/g)) {
                counts.externalTemplates++;
                templateFiles.add(path.resolve(path.dirname(file), match[2]));
            }
            counts.inlineTemplates += count(text, /\btemplate\s*:\s*["'`]/g);
        }
        if (/\bangular\s*\.\s*module\s*\(/.test(text)) counts.ajsModuleFiles++;
        if (text.includes("@angular/upgrade")) counts.upgradeFiles++;
        counts.downgrades += count(text, /\bdowngrade(Component|Injectable)\s*\(/g);
    }
    for (const file of files.js) {
        try {
            if (statSync(file).size <= LARGEST_SOURCE && /\bangular\s*\.\s*module\s*\(/.test(readFileSync(file, "utf8"))) counts.ajsModuleFiles++;
        } catch {
            // a file that cannot be read is not counted
        }
    }
    counts.htmlOutsideAngular = files.html.filter(file => !templateFiles.has(file)).length;
    return counts;
}

/** One of the angularCompilerOptions as the compiler sees it: the config's own value, else the value of the config it extends. */
function angularCompilerOption(tsconfig, name, seen = new Set()) {
    if (seen.has(tsconfig) || !existsSync(tsconfig)) return undefined;
    seen.add(tsconfig);
    const config = readLooseJson(tsconfig);
    const own = config?.angularCompilerOptions?.[name];
    if (own !== undefined) return own;
    for (const parent of [ config?.extends ?? [] ].flat().reverse()) {
        let file;
        if (parent.startsWith(".") || path.isAbsolute(parent)) {
            file = path.resolve(path.dirname(tsconfig), parent);
            if (!existsSync(file) && !file.endsWith(".json")) file += ".json";
        } else {
            for (const candidate of [ parent, `${parent}.json`, `${parent}/tsconfig.json` ]) {
                try {
                    file = nodeRequire.resolve(candidate, { paths: [ path.dirname(tsconfig) ] });
                    break;
                } catch {
                    // try the next spelling
                }
            }
        }
        const inherited = file ? angularCompilerOption(file, name, seen) : undefined;
        if (inherited !== undefined) return inherited;
    }
    return undefined;
}

/** How many source files (.ts, no declarations) a tsconfig lists, counted by TypeScript itself. Undefined without TypeScript. */
function filesOfConfig(ts, tsconfig) {
    if (!ts) return undefined;
    try {
        const parsed = ts.getParsedCommandLineOfConfigFile(tsconfig, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
        return parsed ? parsed.fileNames.filter(file => !/\.d\.[cm]?ts$/.test(file)).length : undefined;
    } catch {
        return undefined;
    }
}

/** The projects of angular.json: name, source root and the tsconfig of the build target. */
function angularProjects(root) {
    const config = readLooseJson(path.join(root, "angular.json"));
    if (!config?.projects) return [];
    return Object.entries(config.projects).map(([ name, project ]) => {
        const targets = project.architect ?? project.targets ?? {};
        const projectRoot = path.resolve(root, project.root ?? "");
        const buildConfig = targets.build?.options?.tsConfig;
        // every tsconfig the targets name (build, test, …): with a solution-style root tsconfig these are the projects
        const named = Object.values(targets).map(target => target?.options?.tsConfig).filter(file => typeof file === "string").map(file => path.resolve(root, file));
        return {
            name,
            kind: project.projectType ?? "application",
            sourceRoot: path.resolve(root, project.sourceRoot ?? path.join(project.root ?? "", "src")),
            buildConfig: typeof buildConfig === "string" ? path.resolve(root, buildConfig) : existsSync(path.join(projectRoot, "tsconfig.app.json")) ? path.join(projectRoot, "tsconfig.app.json") : undefined,
            configs: [ ...new Set(named) ].filter(file => existsSync(file))
        };
    });
}

/**
 * The tsconfig `check` compiles when no --project is given, by the rule of the scripts: the build target of angular.json,
 * else tsconfig.app.json, else tsconfig.json. Undefined when the workspace folder has none of them.
 */
function checkConfig(root, projects) {
    const build = projects.map(project => project.buildConfig).find(file => file && existsSync(file));
    if (build) return { file: build, why: "the build target of angular.json" };
    for (const [ name, why ] of [ [ "tsconfig.app.json", "no build tsconfig in angular.json" ], [ "tsconfig.json", "the only tsconfig" ] ]) {
        if (existsSync(path.join(root, name))) return { file: path.join(root, name), why };
    }
    return undefined;
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(HELP);
        return 0;
    }
    let rootArgument = ".";
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === "--root" && argv[index + 1]) rootArgument = argv[++index];
        else {
            console.error(`unknown argument: ${argv[index]}\n${USAGE}`);
            return 1;
        }
    }
    const started = performance.now();
    const workspace = findWorkspace(rootArgument);
    if (workspace.problem) {
        console.error(`doctor: ${workspace.problem}`);
        return 1;
    }
    const { root } = workspace;
    const skill = slash(OWN_DIRECTORY);
    const notes = [ ...workspace.notes ];
    const lines = [];
    const say = (label, text) => lines.push(clip(`${label.padEnd(LABEL_WIDTH)}${text}`));
    const absent = new Set(SCRIPTS.filter(script => !existsSync(path.join(OWN_DIRECTORY, script))));
    const hasTypeChecker = !absent.has("ls-facts.mjs");

    // ---- packages
    const packageNames = [ "typescript", "@angular/core", "@angular/compiler", "@angular/compiler-cli", "@angular/language-service" ];
    const packages = new Map(packageNames.map(name => [ name, findPackage(name, root) ]));
    const core = packages.get("@angular/core");
    const major = version => version.split(".")[0];
    // The service has to be of the app's major version: one that fits in the skill folder wins over one in the app that does not.
    const languageService = findPackage("@angular/language-service", root, found => !core || major(found.version) === major(core.version));
    packages.set("@angular/language-service", languageService);
    let ts;
    try {
        if (packages.get("typescript")) ts = nodeRequire(packages.get("typescript").directory);
    } catch {
        ts = undefined;
    }

    // ---- workspace, projects, sources
    const projects = angularProjects(root);
    const configs = configsIn(root).filter(name => name !== "angular.json").map(name => ({ name, file: path.join(root, name), files: filesOfConfig(ts, path.join(root, name)) }));
    const hasAngularJson = existsSync(path.join(root, "angular.json"));
    let sourceRoots = [ ...new Set(projects.map(project => project.sourceRoot).filter(existsSync)) ];
    let sourceRootsFrom = "angular.json";
    if (!sourceRoots.length) {
        sourceRoots = [ existsSync(path.join(root, "src")) ? path.join(root, "src") : root ];
        sourceRootsFrom = hasAngularJson ? "no sourceRoot in angular.json: the src folder" : "no angular.json: the src folder";
        if (sourceRoots[0] === root) sourceRootsFrom = "no angular.json and no src folder: the whole workspace";
    }
    const files = readSources(sourceRoots);
    const counts = countSources(files);
    const shownRoot = file => slash(path.relative(root, file)) || ".";

    // a path is never cut: the folder is the answer of this line
    lines.push(`${"workspace".padEnd(LABEL_WIDTH)}${slash(root)}`);
    say("", "← pass this folder as --root to every script, as it is written above");
    if (projects.length) say("projects", `${projects.slice(0, 6).map(project => `${project.name} (${project.kind}, sources in ${shownRoot(project.sourceRoot)})`).join(", ")}${projects.length > 6 ? `, … +${projects.length - 6} more` : ""}`);
    say("sources", `${sourceRoots.map(shownRoot).join(", ")} (${sourceRootsFrom}): ${files.ts.length} .ts (${counts.specs} spec, ${counts.stories} stories), ${files.html.length} .html, ${files.style.length} style files, ${files.js.length} .js`);
    say("Angular", `${core ? `@angular/core ${core.version}` : "@angular/core NOT FOUND"}, TypeScript ${packages.get("typescript")?.version ?? "NOT FOUND"}, Node ${process.versions.node}`);
    say("declared", `${plural(counts.components, "component")}, ${plural(counts.directives, "directive")}, ${plural(counts.pipes, "pipe")}, ${plural(counts.injectables, "injectable")}, ${plural(counts.modules, "NgModule")} (counted in text)`);
    say("templates", `${counts.externalTemplates} in .html files (templateUrl), ${counts.inlineTemplates} inline (template: "…", stories and specs included)`);

    // ---- AngularJS
    const manifest = readLooseJson(path.join(root, "package.json")) ?? {};
    const angularJsVersion = manifest.dependencies?.angular ?? manifest.devDependencies?.angular;
    const hasAngularJs = Boolean(angularJsVersion) || counts.ajsModuleFiles > 0 || counts.downgrades > 0;
    if (hasAngularJs) {
        say("AngularJS", `yes: ${angularJsVersion ? `angular ${angularJsVersion} in package.json, ` : ""}${plural(counts.ajsModuleFiles, "file")} with angular.module(…), ${plural(counts.downgrades, "downgrade")}, ${plural(counts.upgradeFiles, "file")} import @angular/upgrade`);
        say("", `${counts.htmlOutsideAngular} .html files are not the templateUrl of an Angular component: Angular does not compile them, leftovers.mjs reads them`);
    } else {
        say("AngularJS", "no: no angular package in package.json, no angular.module(…), no downgrade");
    }

    // ---- tsconfig and strictness
    const compiled = checkConfig(root, projects);
    // the tsconfigs angular.json names count as candidates too: a solution-style root tsconfig lists no file of its own
    const rootConfigFiles = new Set(configs.map(config => path.resolve(config.file)));
    const projectConfigs = [ ...new Set(projects.flatMap(project => project.configs)) ].filter(file => !rootConfigFiles.has(path.resolve(file)))
        .map(file => ({ name: shownRoot(file), file, files: filesOfConfig(ts, file) }));
    const candidates = [ ...configs, ...projectConfigs ].filter(config => config.files !== 0);
    if (configs.length || projectConfigs.length) {
        say("tsconfig", hasTypeChecker ? "ls-facts chooses per question: the fewest of these projects that hold the name. --project <tsconfig> forces one." : "check compiles one project; --project <tsconfig> names another.");
        if (configs.length) say("", `here (source files listed): ${configs.map(config => `${config.name} ${config.files ?? "?"}`).join(", ")}`);
        if (projectConfigs.length) say("", `named in angular.json (source files listed): ${projectConfigs.slice(0, 6).map(config => `${config.name} ${config.files ?? "?"}`).join(", ")}${projectConfigs.length > 6 ? ", …" : ""}`);
    } else {
        say("tsconfig", `none in the workspace folder: ${hasTypeChecker ? "ls-facts and check have" : "check has"} nothing to load`);
    }
    if (compiled) {
        const compiledName = shownRoot(compiled.file);
        const tests = configs.find(config => /spec|test/.test(config.name) && config.name !== compiledName);
        say("", `check compiles ${compiledName} (${compiled.why})${tests ? `; tests are not in it: check --project ${tests.name}` : ""}`);
        const strict = name => {
            const value = angularCompilerOption(compiled.file, name);
            return value === undefined ? "not set" : String(value);
        };
        const loose = [ "strictTemplates", "strictInputAccessModifiers" ].filter(name => strict(name) !== "true");
        const looseNote = loose.length ? ` — the compiler checks fewer bindings here${hasTypeChecker ? `; ls-facts switches ${loose.length === 1 ? "it" : "both"} on in memory and says so` : ""}` : "";
        say("strictness", `strictTemplates ${strict("strictTemplates")}, strictInputAccessModifiers ${strict("strictInputAccessModifiers")}${looseNote}`);
    }

    // ---- packages, git, cost
    for (const name of packageNames) {
        const found = packages.get(name);
        const label = name === packageNames[0] ? "packages" : "";
        // the folder stands on a line of its own, never cut
        if (found && `${name} ${found.version}  ← ${found.origin}: ${slash(found.directory)}`.length + LABEL_WIDTH <= LINE_WIDTH) say(label, `${name} ${found.version}  ← ${found.origin}: ${slash(found.directory)}`);
        else if (found) {
            say(label, `${name} ${found.version}  ← ${found.origin}:`);
            lines.push(`${"".padEnd(LABEL_WIDTH)}  ${slash(found.directory)}`);
        } else say(label, `${name}  NOT FOUND above ${slash(root)} or above ${skill}`);
    }
    const git = spawnSync("git", [ "rev-parse", "--is-inside-work-tree" ], { cwd: root, encoding: "utf8" });
    const hasGit = git.status === 0 && git.stdout.trim() === "true";
    say("git", hasGit ? "yes: review every change with git diff --stat" : "no (not a git work tree, or git is not installed): you cannot review changes with git diff; list the files you changed yourself");
    {
        // What one project loads: at most every source file, at least the ones that are not tests or stories.
        const most = files.ts.length;
        const least = Math.max(1, most - counts.specs - counts.stories);
        const seconds = count => COST.baseSeconds + count * COST.secondsPerFile;
        const gigabytes = count => (COST.baseGigabytes + count * COST.gigabytesPerFile).toFixed(1);
        const rounded = value => (value < 20 ? Math.ceil(value) : Math.round(value / 5) * 5);
        const range = (low, high, unit) => (low === high ? `${low} ${unit}` : `${low}-${high} ${unit}`);
        say("cost", hasTypeChecker
            ? `ng-facts, ajs-facts, leftovers: seconds. One ls-facts command: about ${range(rounded(seconds(least)), rounded(seconds(most)), "s")} and ${range(gigabytes(least), gigabytes(most), "GB")} of memory, every time`
            : "ng-facts, ajs-facts, leftovers: seconds");
        const checkSeconds = rounded(COST.checkBaseSeconds + least * COST.checkSecondsPerFile);
        say("", `(${least === most ? most : `${least}-${most}`} files). check (the whole compiler): about ${checkSeconds >= 90 ? `${Math.round(checkSeconds / 60)} min` : `${checkSeconds} s`}. Run one at a time and wait for it.`);
    }

    // ---- the verdict per script
    const problems = new Map(SCRIPTS.map(script => [ script, [] ]));
    const blame = (scripts, problem) => {
        for (const script of scripts) problems.get(script).push(problem);
    };
    const factScripts = [ "ng-facts.mjs", "ls-facts.mjs" ];
    for (const script of absent) {
        if (!(script in REPLACEMENTS)) blame([ script ], `${script} is not in ${skill}: copy the whole skill folder again`);
        else if (factScripts.includes(script) && factScripts.every(other => absent.has(other))) blame([ script ], `${script} is not in ${skill}, and neither is the other fact script: copy the whole skill folder again`);
    }
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor < NODE_MAJOR_NEEDED) blame(SCRIPTS, `Node ${process.versions.node} is too old: run the scripts with Node ${NODE_MAJOR_NEEDED} or newer`);
    const installHint = `run npm install (or npm ci) in ${slash(root)}`;
    for (const name of [ "typescript", "@angular/compiler" ]) {
        if (!packages.get(name)) blame([ "ng-facts.mjs", "ajs-facts.mjs", "ls-facts.mjs" ], `${name} is not installed: ${installHint}`);
    }
    if (!packages.get("@angular/compiler-cli")) blame([ "ls-facts.mjs" ], `@angular/compiler-cli is not installed: ${installHint}`);
    const installLine = `npm install --prefix "${skill}" --no-save @angular/language-service@${core?.version ?? "<version of @angular/core>"}`;
    if (!core) {
        blame([ "ls-facts.mjs" ], `@angular/core is not installed: ${installHint}`);
    } else if (core.origin !== "workspace") {
        // ls-facts and the compiler read the app's own packages: one next to the skill does not make the app's imports resolve.
        blame([ "ls-facts.mjs" ], `@angular/core is not installed in the app (only next to the skill): ${installHint}`);
        notes.push(`the app has no node_modules with @angular/core: check would only list "Cannot find module" errors; ${installHint}`);
    } else if (!languageService) {
        blame([ "ls-facts.mjs" ], `@angular/language-service is not installed. Install it into the skill folder (the app is not touched):\n${" ".repeat(SCRIPT_WIDTH + 2)}${installLine}`);
    } else if (languageService.unfit) {
        blame([ "ls-facts.mjs" ], `@angular/language-service ${languageService.version} does not fit @angular/core ${core.version}. Install the fitting one into the skill folder:\n${" ".repeat(SCRIPT_WIDTH + 2)}${installLine}`);
    }
    // no tsconfig at all (an AngularJS app without TypeScript): nothing to type-check here, which is a fact, not a fault to fix
    const noTypeScriptHere = !configs.length && !projectConfigs.length;
    if (noTypeScriptHere) notes.push("this workspace has no tsconfig: nothing is type-checked here, so ls-facts and check have nothing to load");
    else if (ts && !candidates.length) blame([ "ls-facts.mjs" ], "no tsconfig of the workspace lists a source file (angular.json names none either): add --project and the path of the app's tsconfig");
    if (!packages.get("@angular/compiler-cli") || !compiled) notes.push("check (the compiler's verdict) cannot run without @angular/compiler-cli and a tsconfig: the other commands of ng-facts do");

    // A script that looks fine on paper is started once with --help: a broken copy or a Node it cannot run on shows here.
    for (const script of SCRIPTS) {
        if (problems.get(script).length || absent.has(script)) continue;
        const probe = spawnSync(process.execPath, [ path.join(OWN_DIRECTORY, script), "--help" ], { encoding: "utf8", timeout: 10_000 });
        if (probe.status !== 0) {
            const said = `${probe.stderr ?? ""}${probe.stdout ?? ""}`.split("\n").map(line => line.trim()).find(line => /error|cannot|not found/i.test(line)) ?? probe.error?.message ?? `exit code ${probe.status}`;
            blame([ script ], `it does not start (node ${script} --help): ${said.slice(0, 110)}. Copy the whole skill folder again`);
        }
    }

    console.log(`angular-facts doctor (${Math.round(performance.now() - started)} ms, no language service started, nothing written)`);
    for (const line of lines) console.log(line);
    for (const note of notes) console.log(clip(`! ${note}`));
    console.log("scripts");
    let broken = 0;
    let replaced = 0;
    for (const script of SCRIPTS) {
        const found = problems.get(script);
        // A script that is not in this copy and has a replacement: the problems of that script (a missing package) are not this copy's.
        if (script === "ls-facts.mjs" && noTypeScriptHere && !absent.has(script)) {
            replaced++;
            console.log(`  ${script.padEnd(SCRIPT_WIDTH)}NOT USABLE HERE: this workspace has no tsconfig. Where a step names it, run instead:`);
            for (const line of REPLACEMENTS[script]) console.log(clip(`  ${"".padEnd(SCRIPT_WIDTH)}${line}`));
            continue;
        }
        if (absent.has(script) && !found.some(problem => problem.includes("copy the whole skill folder again"))) {
            replaced++;
            console.log(`  ${script.padEnd(SCRIPT_WIDTH)}NOT IN THIS COPY of the skill. Where a step names it, run instead:`);
            for (const line of REPLACEMENTS[script]) console.log(clip(`  ${"".padEnd(SCRIPT_WIDTH)}${line}`));
            continue;
        }
        if (found.length) broken++;
        console.log(`  ${script.padEnd(SCRIPT_WIDTH)}${found.length ? `CANNOT RUN: ${found[0]}` : "ok"}`);
        for (const more of found.slice(1)) console.log(`  ${"".padEnd(SCRIPT_WIDTH)}and: ${more}`);
    }
    const everyCommand = `  node "${skill}/<script>.mjs" <command> … --root "${slash(root)}"`;
    if (broken) {
        console.log(`NOT READY: ${plural(broken, "script")} cannot run. Do the fix printed above, then run doctor again. The scripts marked ok can be used now:`);
        console.log(everyCommand);
        return 1;
    }
    console.log(replaced
        ? `READY: every script of this copy can run; ${plural(replaced, "script")} ${replaced === 1 ? "is" : "are"} not in it or not usable here: use the replacement named above. Write every command as:`
        : "READY: every script can run. Write every command as:");
    console.log(everyCommand);
    console.log("→ next: the command that the table in SKILL.md names for your question");
    return 0;
}

process.exitCode = main();
