#!/usr/bin/env node
// ls-facts — type-checked facts and a rename for an Angular workspace, asked from the Angular Language Service (no LLM).
// The service runs inside this process: one ts.server.ProjectService (the object tsserver is built around) loads the
// tsconfig project(s) that hold the name with @angular/language-service as its plugin, answers one command and exits.
//   node ls-facts.mjs refs <Class>.<member> [--all]            every reference of a class member (input, output, method, field)
//   node ls-facts.mjs refs <Class> [--all]                     every reference of a class: templates, imports arrays, injections …
//   node ls-facts.mjs rename <Class>.<member> <new> [--write]  the rename at every reference (dry run without --write)
//   node ls-facts.mjs check                                    the compiler's verdict (ngc, no emit) on the build's tsconfig
//   node ls-facts.mjs --help
// Options: --root <dir> (default "."; the folder with angular.json or the tsconfig), --project <tsconfig> (one project only),
// --warm (refs and rename ask a server that this script starts in the background and that keeps the projects loaded; it
// reads changed files again before each answer and ends after 10 idle minutes; --warm-stop ends it at once).
// <Class> may be written <file>#<Class> when two classes share a name.
// Exit code: 0 answered; 1 a wrong name or a missing package (the message says what to do); 2 the answer says the work is
// not finished (the compiler found errors, or the rename left places that must be fixed by hand).
// Which tsconfig: every tsconfig*.json of the root, of angular.json and of "references" is a candidate; the files that hold
// the name and are connected to the class by imports are covered with as few projects as possible (one when one covers all).
// What the service does not return is said in lines that start with "!" (160 characters at most).
// Packages: typescript, @angular/compiler and @angular/compiler-cli come from the first node_modules above --root, then above
// this file. @angular/language-service is looked for above --root, then above this file; when it is missing the script prints
// the one npm command that installs the right version next to this file. Nothing is written without --write.
// LS_FACTS_TIMING=1 prints on the standard error where the time went (tsconfig scan, project load, references).
// As a library: refs(root, "Class.member" | "Class") and planRename(root, "Class.member", newName) return plain data.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";

const SHOWN_PER_GROUP = 8;
const HELP = `ls-facts — facts about an Angular workspace from the Angular Language Service: type-checked, no text search.
  refs <Class>.<member> [--all]            every reference of a class member (an input, an output, a method, a field): the
                                           declaration, template bindings (.html and inline, bound, static and event form, on
                                           the class and on classes that inherit it), reads in template expressions, and
                                           TypeScript code split into calls, reads, writes and object keys
  refs <Class> [--all]                     every reference of a class: elements in templates (by its selector), pipes, imports
                                           arrays, providers, injections, routes, extends, type positions, import statements
  rename <Class>.<member> <new> [--write]  plans the rename at every reference and prints the edits per group; --write
                                           applies them, then asks leftovers what text still carries the old name: exit 2
                                           and NOT DONE while anything is left. A member that a library declares too (a
                                           lifecycle hook, PipeTransform.transform) is refused: nothing is written
  check [--all]                            the compiler (ngc, no emit) on the tsconfig of the build, messages counted;
                                           --all lists every place of every message as file:line:column
Options: --root <dir> (default "."), --project <tsconfig> (answer from this project only), --all (list every place;
the default shows the first ${SHOWN_PER_GROUP} of a group), --warm (refs and rename: see Cost).
<Class> is a class name of the project (<file>#<Class> when two classes share the name); a member the class inherits is
followed to the class that declares it. Lines that start with "!" say what had to be done, or could not be done, to answer.
Exit code: 0 answered; 1 wrong name, missing package or tsconfig; 2 not finished (compiler errors, places left for you).
Cost: every command loads the project again. A small app answers in 3-10 s. An app of about 5,000 TypeScript files takes
30-45 s and 2.5 GB of memory for refs and for rename (one project), and one to two minutes for check (the whole compiler).
With --warm the first refs or rename starts a server in the background that keeps the project loaded (same memory) and
the next ones answer in a few seconds. The server reads again every file that changed on disk before it answers, starts
anew when a file was added or removed, and ends 10 minutes after the last call (LS_FACTS_WARM_MINUTES changes that;
ls-facts --warm-stop --root <dir> ends it at once). It listens on a named pipe (Windows) or on a socket file in
os.tmpdir()/ls-facts-<uid> that only this user can reach. A run without --warm reads everything from disk: use it when in doubt.
Only @angular/language-service is loaded as a plugin: a plugin a tsconfig names (compilerOptions.plugins) is never run.
The code must compile: in a broken project the service returns fewer references (run check first when in doubt).`;
const USAGE = "usage: ls-facts refs <Class>[.<member>] [--all] | rename <Class>.<member> <new> [--write] | check | --help   [--root <dir>] [--project <tsconfig>] [--warm]";

const slash = file => file.split(path.sep).join("/");
const OWN_FILE = fileURLToPath(import.meta.url);
const OWN_DIRECTORY = slash(path.dirname(OWN_FILE));
const nodeRequire = createRequire(import.meta.url);
const SHOWN_DIAGNOSTICS = 8;
const LINE_WIDTH = 160;
const HEAP_MEGABYTES = 8192;
const TS_FILE = /\.[cm]?tsx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const TEST_FILE = /\.(spec|test|stories|e2e|po)\.[cm]?[jt]sx?$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const RESTRICTED_MODIFIERS = [ "readonly", "private", "protected" ];
const INPUT_KINDS = new Set([ "input()", "model()", "@Input()" ]);
const KIND_ORDER = [ "declaration", "binding", "static", "template-read", "class-read" ];
const CLASS_GROUPS = [
    "declaration", "element in templates", "pipe in templates", "read in a template expression", "routes (component, loadComponent, loadChildren)",
    "imports: [ … ]", "declarations: [ … ]", "exports: [ … ]", "bootstrap: [ … ]",
    "hostDirectives: [ … ]", "providers", "injected (inject(), constructor parameter)", "extended by a class (extends)",
    "implemented by a class (implements)", "downgraded for AngularJS", "view and content queries", "created with new", "decorator metadata",
    "type positions", "other code (passed or read as a value)", "import and export statements"
];

/** With LS_FACTS_TIMING set: one line on the standard error per step, with the seconds since the previous one. */
let lastMark = performance.now();
function mark(step) {
    if (!process.env.LS_FACTS_TIMING) return;
    const now = performance.now();
    console.error(`[ls-facts] ${((now - lastMark) / 1000).toFixed(1).padStart(6)} s  ${step}`);
    lastMark = now;
}

/** A mistake of the caller or of the environment (a wrong name, a missing file or package): one message, exit code 1. */
class UsageError extends Error {}
/** The class is not part of the project that was asked: another project may still have it. */
class NotInProject extends UsageError {}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const naturalOrder = (left, right) => left.localeCompare(right, "en", { numeric: true });
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const isSource = file => TS_FILE.test(file) && !DECLARATION_FILE.test(file) && !file.includes("/node_modules/");
const quoted = text => (/^[\w./:@-]+$/.test(text) ? text : `"${text}"`);

// ---------------------------------------------------------------- the workspace, its packages and its tsconfig files

/** The folder that holds angular.json or a tsconfig: --root itself, or its only child folder that has one (said in a note). */
function workspaceRoot(rootArgument) {
    const given = slash(path.resolve(rootArgument));
    if (!existsSync(given)) throw new UsageError(`no such directory: ${given}${String(rootArgument).includes("\"") ? " (a \" is part of the name: in PowerShell drop the backslash before the closing quote)" : ""}`);
    const marked = directory => readdirSync(directory).some(name => name === "angular.json" || /^tsconfig.*\.json$/.test(name));
    if (marked(given)) return { root: given, note: null };
    const children = readdirSync(given, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".") && marked(path.join(given, entry.name)))
        .map(entry => entry.name);
    if (children.length === 1) return { root: `${given}/${children[0]}`, note: `--root has no angular.json and no tsconfig: its only child folder that has one is used, ${children[0]}/` };
    throw new UsageError(children.length
        ? `${given} has no angular.json and no tsconfig, and ${children.length} child folders have one (${children.join(", ")}): name one with --root`
        : `${given} has no angular.json and no tsconfig*.json: --root must be the folder of the Angular workspace${existsSync(`${OWN_DIRECTORY}/doctor.mjs`) ? `\nnode "${OWN_DIRECTORY}/doctor.mjs" --root "${given}" finds it and prints the folder to pass as --root.` : ""}`);
}

/** typescript and the Angular compiler packages: from the first node_modules above `root`, then above this file. */
function locatePackages(root) {
    const resolveFrom = (name, directory) => {
        try {
            return nodeRequire.resolve(name, { paths: [ directory ] });
        } catch {
            return null;
        }
    };
    const locate = name => {
        const found = resolveFrom(name, root) ?? resolveFrom(name, OWN_DIRECTORY);
        if (!found) throw new UsageError(`package ${name.replace(/\/package\.json$/, "")} not found in a node_modules above ${root} or above ${OWN_DIRECTORY}: run npm install in the workspace`);
        return found;
    };
    return { root, resolveFrom, locate, ts: nodeRequire(locate("typescript")) };
}

/**
 * Adds the template parser and the language service to the packages. The service must be of the same major version as the
 * app's @angular/core; an app rarely has it installed, so it may also sit in a node_modules next to this file.
 */
function withLanguageService(packages) {
    const { root, resolveFrom, locate } = packages;
    const versionAt = manifest => JSON.parse(readFileSync(manifest, "utf8")).version;
    const coreManifest = resolveFrom("@angular/core/package.json", root);
    if (!coreManifest) throw new UsageError(`no @angular/core in a node_modules above ${root}: --root must be an Angular workspace with its packages installed (npm install)`);
    const coreVersion = versionAt(coreManifest);
    const major = version => String(version).split(".")[0];
    const found = [ root, OWN_DIRECTORY ]
        .map(directory => ({ directory, manifest: resolveFrom("@angular/language-service/package.json", directory) }))
        .filter(candidate => candidate.manifest)
        .map(candidate => ({ ...candidate, version: versionAt(candidate.manifest) }));
    const fitting = found.find(candidate => major(candidate.version) === major(coreVersion));
    if (!fitting) {
        const install = `npm install --prefix "${OWN_DIRECTORY}" --no-save @angular/language-service@${coreVersion}`;
        throw new UsageError(found.length
            ? `@angular/language-service ${found[0].version} (${slash(path.dirname(found[0].manifest))}) does not fit this app's @angular/core ${coreVersion}. Install the fitting version next to this script:\n  ${install}`
            : `@angular/language-service is not installed: looked in node_modules above ${root} and above ${OWN_DIRECTORY}. Install the version of this app's @angular/core next to this script:\n  ${install}`);
    }
    return {
        ...packages,
        ng: nodeRequire(locate("@angular/compiler")),
        languageService: resolveFrom("@angular/language-service", fitting.directory),
        languageServiceVersion: fitting.version,
        coreVersion
    };
}

/** One of the angularCompilerOptions as the compiler sees it: the config's own value, else the one it extends. */
function angularCompilerOption(ts, tsconfig, name, seen = new Set()) {
    if (seen.has(tsconfig) || !existsSync(tsconfig)) return undefined;
    seen.add(tsconfig);
    const { config } = ts.readConfigFile(tsconfig, ts.sys.readFile);
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
        const inherited = file ? angularCompilerOption(ts, file, name, seen) : undefined;
        if (inherited !== undefined) return inherited;
    }
    return undefined;
}

/** The tsconfig files angular.json names: the one of the build target, the one of the test target, and all of them. */
function angularJsonConfigs(ts, root) {
    const file = path.join(root, "angular.json");
    const named = { build: null, test: null, all: [] };
    if (!existsSync(file)) return named;
    const { config } = ts.readConfigFile(file, ts.sys.readFile);
    for (const project of Object.values(config?.projects ?? {})) {
        for (const [ targetName, target ] of Object.entries(project?.architect ?? project?.targets ?? {})) {
            const values = [ target?.options?.tsConfig, ...Object.values(target?.configurations ?? {}).map(configuration => configuration?.tsConfig) ].flat();
            for (const value of values.filter(value => typeof value === "string")) {
                const tsconfig = slash(path.resolve(root, value));
                if (!existsSync(tsconfig)) continue;
                named.all.push(tsconfig);
                if (targetName === "build") named.build ??= tsconfig;
                if (targetName === "test") named.test ??= tsconfig;
            }
        }
    }
    return named;
}

const parseConfig = (ts, tsconfig) => ts.getParsedCommandLineOfConfigFile(tsconfig, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });

/** The tsconfig `check` compiles: the one named, else the build's (angular.json), else tsconfig.app.json, else tsconfig.json. */
function checkConfig(ts, root, projectOption) {
    const named = angularJsonConfigs(ts, root);
    const others = readdirSync(root).filter(name => /^tsconfig.*\.json$/.test(name));
    const pick = projectOption ? { tsconfig: slash(path.resolve(root, projectOption)), why: "named with --project" }
        : named.build ? { tsconfig: named.build, why: "the build's tsconfig in angular.json" }
        : existsSync(path.join(root, "tsconfig.app.json")) ? { tsconfig: `${root}/tsconfig.app.json`, why: "no build tsconfig in angular.json" }
        : { tsconfig: `${root}/tsconfig.json`, why: "the only candidate" };
    const name = slash(path.relative(root, pick.tsconfig));
    const found = others.length ? ` (found here: ${others.join(", ")})` : "";
    if (!existsSync(pick.tsconfig)) throw new UsageError(`${name} not found in ${root}: name the project with --project <tsconfig>${found}`);
    const parsed = parseConfig(ts, pick.tsconfig);
    if (!parsed?.fileNames.length) throw new UsageError(`${name} lists no source files (a solution-style config): name the project with --project <tsconfig>${found}`);
    return { ...pick, name };
}

// ---------------------------------------------------------------- one process, one server, as many projects as needed

/**
 * The workspace at `rootArgument` with a TypeScript server that is started on the first load(). Every project loaded through
 * it shares the server's script snapshots and document registry: a file two projects list is read and parsed once.
 */
function openSession(rootArgument) {
    const { root, note: rootNote } = workspaceRoot(rootArgument);
    const packages = withLanguageService(locatePackages(root));
    const { ts } = packages;
    const fileKey = file => (ts.sys.useCaseSensitiveFileNames ? slash(file) : slash(file).toLowerCase());
    const relative = file => slash(path.relative(root, file));
    const overlay = new Map();
    const timers = new Set();
    const immediates = new Set();
    const diskTexts = new Map();
    const texts = new Map();
    const lineStarts = new Map();
    const workspaces = new Map();
    const projects = new Map();
    const stamps = new Map();
    let projectService, cover, signature;
    const stampOf = file => {
        try {
            const stat = statSync(file);
            return `${stat.mtimeMs}:${stat.size}`;
        } catch {
            return null;
        }
    };
    const stamp = file => {
        const now = stampOf(file);
        if (now !== null) stamps.set(slash(file), now);
    };
    // what decides which packages are installed: a change there is a reason to start again (see refresh)
    for (const name of [ "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "node_modules/.package-lock.json", "angular.json" ]) stamp(`${root}/${name}`);

    const startServer = () => {
        // The server host is ours: ts.sys, timers that can be cleared at the end, no file watchers, and the plugin we located.
        const host = {
            ...ts.sys,
            // every file outside node_modules is stamped (time and size) just before the server reads it
            readFile: (file, encoding) => {
                if (!file.includes("/node_modules/")) stamp(file);
                return overlay.get(fileKey(file)) ?? ts.sys.readFile(file, encoding);
            },
            setTimeout: (callback, delay, ...rest) => {
                const timer = setTimeout(callback, delay, ...rest);
                timers.add(timer);
                return timer;
            },
            clearTimeout: timer => {
                timers.delete(timer);
                clearTimeout(timer);
            },
            setImmediate: (callback, ...rest) => {
                const immediate = setImmediate(callback, ...rest);
                immediates.add(immediate);
                return immediate;
            },
            clearImmediate: immediate => {
                immediates.delete(immediate);
                clearImmediate(immediate);
            },
            watchFile: () => ({ close() {} }),
            watchDirectory: () => ({ close() {} }),
            // Only the Angular Language Service is loaded as a plugin. A plugin a tsconfig names (compilerOptions.plugins)
            // is code of the project that runs inside this process: it is never loaded here.
            require: (_initialDirectory, moduleName) => {
                if (moduleName !== "@angular/language-service") return { module: undefined, error: new Error(`plugin ${moduleName} is not loaded by ls-facts`) };
                try {
                    const modulePath = packages.languageService;
                    return { module: nodeRequire(modulePath), modulePath, error: undefined };
                } catch (error) {
                    return { module: undefined, error };
                }
            }
        };
        const logger = { close() {}, hasLevel: () => false, loggingEnabled: () => false, perftrc() {}, info() {}, startGroup() {}, endGroup() {}, msg() {}, getLogFileName: () => undefined };
        const service = new ts.server.ProjectService({
            host, logger,
            cancellationToken: ts.server.nullCancellationToken,
            useSingleInferredProject: true,
            useInferredProjectPerProjectRoot: false,
            typingsInstaller: ts.server.nullTypingsInstaller,
            session: undefined,
            globalPlugins: [ "@angular/language-service" ],
            pluginProbeLocations: [ root ],
            allowLocalPluginLoads: false
        });
        // tsserver would also build a second program for auto-import suggestions (seconds and ~100 MB): nobody asks for them here.
        service.setHostConfiguration({ preferences: { includePackageJsonAutoImports: "off" } });
        return service;
    };

    /** The text the service works on (its own snapshot), else the file on disk. */
    const textOf = file => {
        if (!texts.has(file)) {
            const snapshot = projectService?.getScriptInfo(file)?.getSnapshot();
            texts.set(file, snapshot ? snapshot.getText(0, snapshot.getLength()) : (ts.sys.readFile(file) ?? ""));
        }
        return texts.get(file);
    };
    /** 1-based line and column of an offset, and the text of that line. */
    const positionOf = (file, offset) => {
        const text = textOf(file);
        if (!lineStarts.has(file)) {
            const starts = [ 0 ];
            for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
            lineStarts.set(file, starts);
        }
        const starts = lineStarts.get(file);
        let low = 0, high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= offset) low = middle;
            else high = middle - 1;
        }
        const end = low + 1 < starts.length ? starts[low + 1] - 1 : text.length;
        return { line: low + 1, column: offset - starts[low] + 1, lineText: text.slice(starts[low], end).replace(/\r$/, "") };
    };

    /**
     * Loads the project of one tsconfig (once) and returns its language service with what the commands need around it.
     * Two angularCompilerOptions are switched on IN MEMORY when the project does not set them, because the service returns
     * fewer references without them: strictInputAccessModifiers (else no template binding of a readonly, private or
     * protected input is resolved) and strictTemplates (else bindings inside @if / @for blocks and ng-templates are not).
     */
    const load = tsconfigPath => {
        const tsconfig = slash(tsconfigPath), key = fileKey(tsconfig);
        if (workspaces.has(key)) return workspaces.get(key);
        const tsconfigName = relative(tsconfig);
        const forced = [ "strictInputAccessModifiers", "strictTemplates" ].filter(name => angularCompilerOption(ts, tsconfig, name) !== true);
        // The service is strict about templates on its own unless the project says "strictTemplates": false: only that is news.
        const strictTemplatesForced = forced.includes("strictTemplates") && angularCompilerOption(ts, tsconfig, "strictTemplates") === false;
        if (forced.length) {
            const { config } = ts.parseConfigFileTextToJson(tsconfig, ts.sys.readFile(tsconfig));
            config.angularCompilerOptions = { ...config.angularCompilerOptions, ...Object.fromEntries(forced.map(name => [ name, true ])) };
            overlay.set(key, JSON.stringify(config));
        }
        projectService ??= startServer();
        // tsserver opens a project when a file of it is opened, and finds only a config named tsconfig.json that way. The
        // internal createConfiguredProject takes any tsconfig and needs no open file, so that nothing is held in memory apart.
        let project = projects.get(key);
        if (project) project.updateGraph();
        else if (typeof projectService.createConfiguredProject === "function") {
            project = projectService.createConfiguredProject(ts.server.toNormalizedPath(tsconfig), "ls-facts");
            try {
                projectService.externalProjectToConfiguredProjectMap?.set(`${tsconfig}#ls-facts`, new Set([ project ]));
            } catch {
                // only keeps the project from being collected when a file is closed, which this script never does
            }
            project.updateGraph();
        } else if (path.basename(tsconfig) === "tsconfig.json") {
            const first = parseConfig(ts, tsconfig)?.fileNames.map(slash).find(isSource);
            if (first) {
                projectService.openClientFile(first);
                const opened = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(first), true);
                if (opened?.projectKind === ts.server.ProjectKind.Configured && fileKey(opened.getProjectName()) === key) project = opened;
            }
        }
        if (!project) throw new UsageError(`TypeScript ${ts.version} cannot load ${tsconfigName} in-process`);
        projects.set(key, project);
        mark(`project ${tsconfigName} loaded`);
        const service = project.getLanguageService();
        if (typeof service.getTcb !== "function") throw new UsageError("the Angular Language Service plugin did not load into the TypeScript server");
        const program = service.getProgram();
        mark("program and Angular analysis ready");
        const workspace = {
            session, packages, ts, ng: packages.ng, root, tsconfig, tsconfigName, project, service, program,
            checker: program.getTypeChecker(),
            strictInputAccessForced: forced.includes("strictInputAccessModifiers"), strictTemplatesForced,
            textOf, positionOf, fileKey, relative,
            templateRegions: session.templateRegions, opaqueTemplates: session.opaqueTemplates, brokenTemplates: session.brokenTemplates,
            /**
             * The project's own sources: every .ts file of the program outside node_modules (a config may list one entry file
             * only). Once the service has analysed the project the program also holds the external templates and the
             * type-check files: neither is a source file …
             */
            sourceFiles: () => service.getProgram().getSourceFiles().filter(sourceFile => !sourceFile.isDeclarationFile).map(sourceFile => slash(sourceFile.fileName)).filter(file => TS_FILE.test(file) && !file.includes("/node_modules/") && !file.includes(".ngtypecheck.")),
            /** … and, once the service has analysed the project, its external templates. */
            externalTemplates: () => project.getScriptInfos().map(info => slash(info.fileName)).filter(file => !TS_FILE.test(file) && /\.(html?|svg)$/.test(file) && !file.includes("/node_modules/"))
        };
        workspaces.set(key, workspace);
        return workspace;
    };

    const session = {
        root, rootNote, packages, ts, ng: packages.ng, fileKey, relative, workspaces, load, textOf, positionOf,
        templateRegions: new Map(), opaqueTemplates: new Map(), brokenTemplates: new Set(),
        diskText(file) {
            const key = fileKey(file);
            if (!diskTexts.has(key)) diskTexts.set(key, ts.sys.readFile(file));
            return diskTexts.get(key);
        },
        isLoaded: tsconfig => projects.has(fileKey(tsconfig)),
        cover() {
            if (!cover) {
                cover = buildCover(session);
                signature ??= cover.signature;
            }
            return cover;
        },
        /**
         * For a process that answers more than once: brings the loaded projects up to date with the disk. A file the server
         * has read and that changed since is read again. Returns null when that was enough, else the reason why a fresh
         * process is needed: a source file was added or removed, or a file changed that is not a source (a tsconfig, a
         * package.json, a lock file) — the server keeps what it resolved from those, and nothing here watches directories.
         */
        refresh() {
            if (!projectService) return null;
            const changed = [];
            for (const [ file, known ] of stamps) {
                const now = stampOf(file);
                if (now === known) continue;
                const info = now === null ? null : projectService.getScriptInfo(file);
                if (!info) return `${relative(file)} ${now === null ? "was removed" : "changed"}`;
                changed.push(info);
            }
            for (const cache of [ diskTexts, texts, lineStarts, workspaces, session.templateRegions, session.opaqueTemplates, session.brokenTemplates ]) cache.clear();
            cover = undefined;
            if (session.cover().signature !== signature) return "a source file was added or removed";
            for (const info of changed) info.reloadFromFile();
            return null;
        },
        dispose() {
            for (const timer of timers) clearTimeout(timer);
            for (const immediate of immediates) clearImmediate(immediate);
        }
    };
    return session;
}

// ---------------------------------------------------------------- which tsconfig project(s) to load

/**
 * Every tsconfig of the workspace that lists source files (next to the root, named in angular.json, or referenced), each
 * with the files it reaches: its root files and what they import, followed with a cheap resolver (relative paths, "paths"
 * and baseUrl; no package is opened). That is an estimate: after a project is loaded, its real file list is what counts.
 */
function buildCover(session) {
    const { ts, root, fileKey } = session;
    const named = angularJsonConfigs(ts, root);
    const queue = [ ...readdirSync(root).filter(name => /^tsconfig.*\.json$/.test(name)).map(name => `${root}/${name}`), ...named.all ];
    const candidates = [];
    const seenConfigs = new Set();
    const parseCandidate = tsconfig => {
        const parsed = parseConfig(ts, tsconfig);
        if (!parsed) return null;
        for (const reference of parsed.projectReferences ?? []) {
            const referenced = slash(reference.path);
            queue.push(referenced.endsWith(".json") ? referenced : `${referenced}/tsconfig.json`);
        }
        return { tsconfig, name: session.relative(tsconfig), options: parsed.options, rootFiles: parsed.fileNames.map(slash).filter(isSource), reach: null };
    };
    while (queue.length) {
        const tsconfig = slash(queue.shift());
        if (seenConfigs.has(fileKey(tsconfig)) || !existsSync(tsconfig)) continue;
        seenConfigs.add(fileKey(tsconfig));
        const candidate = parseCandidate(tsconfig);
        if (candidate?.rootFiles.length) candidates.push(candidate);
    }

    const universe = new Map();
    const edges = new Map();
    const specifiers = new Map();
    const existing = new Map();
    const fileExists = file => {
        const key = fileKey(file);
        if (!existing.has(key)) existing.set(key, universe.has(key) || ts.sys.fileExists(file));
        return existing.get(key);
    };
    const resolveBase = base => {
        const spellings = [ base.replace(/\.([cm]?)js$/, ".$1ts"), base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts`, `${base}/index.ts`, `${base}/index.tsx` ];
        return spellings.find(file => isSource(file) && fileExists(file)) ?? null;
    };
    const resolveImport = (specifier, from, candidate) => {
        const bases = [];
        if (specifier.startsWith(".")) bases.push(path.resolve(path.dirname(from), specifier));
        else {
            const { paths: mapped, baseUrl, pathsBasePath } = candidate.options;
            const base = pathsBasePath ?? baseUrl ?? path.dirname(candidate.tsconfig);
            for (const [ pattern, targets ] of Object.entries(mapped ?? {})) {
                const star = pattern.indexOf("*");
                const tail = star < 0 ? "" : pattern.slice(star + 1);
                const matched = star < 0 ? (pattern === specifier ? "" : null)
                    : specifier.length >= pattern.length - 1 && specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(tail) ? specifier.slice(star, specifier.length - tail.length)
                    : null;
                if (matched !== null) for (const target of targets) bases.push(path.resolve(base, target.replace("*", matched)));
            }
            if (baseUrl) bases.push(path.resolve(baseUrl, specifier));
        }
        for (const base of bases) {
            const found = resolveBase(slash(base));
            if (found) return found;
        }
        return null;
    };
    const resolved = new Map();
    const importsOf = (file, key, candidate) => {
        const cacheKey = `${candidate.resolution}|${key}`;
        if (!resolved.has(cacheKey)) {
            if (!specifiers.has(key)) specifiers.set(key, ts.preProcessFile(session.diskText(file) ?? "", true, true).importedFiles.map(imported => imported.fileName));
            resolved.set(cacheKey, specifiers.get(key).map(specifier => resolveImport(specifier, file, candidate)).filter(Boolean));
        }
        return resolved.get(cacheKey);
    };
    const reachOf = candidate => {
        const reach = new Map();
        const stack = [ ...candidate.rootFiles ];
        while (stack.length) {
            const file = stack.pop(), key = fileKey(file);
            if (reach.has(key)) continue;
            reach.set(key, file);
            universe.set(key, file);
            if (!edges.has(key)) edges.set(key, new Set());
            for (const target of importsOf(file, key, candidate)) {
                edges.get(key).add(fileKey(target));
                if (!reach.has(fileKey(target))) stack.push(target);
            }
        }
        return reach;
    };
    const prepare = candidate => {
        candidate.resolution = JSON.stringify([ candidate.options.paths ?? null, candidate.options.baseUrl ?? null, candidate.options.pathsBasePath ?? path.dirname(candidate.tsconfig) ]);
        candidate.reach = reachOf(candidate);
        return candidate;
    };
    mark(`${candidates.length} tsconfig files parsed`);
    candidates.forEach(prepare);
    mark(`imports followed in ${universe.size} files`);

    // templateUrl: "…" ties a template file to the .ts file that owns it: a name in the template is a reason to load its owner
    const templates = new Map();
    const templatesOf = (key, file) => {
        if (!templates.has(key)) {
            const text = session.diskText(file) ?? "";
            templates.set(key, text.includes("templateUrl") ? [ ...text.matchAll(/templateUrl\s*:\s*(["'`])([^"'`]+)\1/g) ].map(match => slash(path.resolve(path.dirname(file), match[2]))) : []);
        }
        return templates.get(key);
    };

    return {
        candidates, universe, build: named.build, test: named.test,
        /** Changes when a source file is added to or removed from what the tsconfig files reach. */
        signature: createHash("sha1").update([ ...universe.keys() ].sort().join("\n")).update(candidates.map(candidate => `${candidate.name}:${candidate.rootFiles.length}`).join("|")).digest("hex"),
        /** The candidate of a tsconfig named on the command line; it need not be one the workspace knows. */
        named(projectOption) {
            const tsconfig = slash(path.resolve(root, projectOption));
            const others = candidates.map(candidate => candidate.name);
            const found = others.length ? ` (found here: ${others.join(", ")})` : "";
            if (!existsSync(tsconfig)) throw new UsageError(`${session.relative(tsconfig)} not found in ${root}: name the project with --project <tsconfig>${found}`);
            const known = candidates.find(candidate => fileKey(candidate.tsconfig) === fileKey(tsconfig));
            if (known) return known;
            const candidate = parseCandidate(tsconfig);
            if (!candidate?.rootFiles.length) throw new UsageError(`${session.relative(tsconfig)} lists no source files (a solution-style config): name another with --project <tsconfig>${found}`);
            return prepare(candidate);
        },
        /** Files that declare a class of this name, by text; `fileHint` keeps the ones whose path ends with it. */
        declaring(className, fileHint) {
            const pattern = new RegExp(`\\bclass\\s+${escapeRegExp(className)}(?![\\w$])`);
            const found = new Map();
            for (const [ key, file ] of universe) {
                if (fileHint !== null && !`/${session.relative(file)}`.toLowerCase().endsWith(`/${fileHint}`.toLowerCase())) continue;
                if (pattern.test(session.diskText(file) ?? "")) found.set(key, file);
            }
            return found;
        },
        classNames() {
            const names = new Set();
            for (const file of universe.values()) for (const match of (session.diskText(file) ?? "").matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
            return [ ...names ];
        },
        /**
         * The files that can hold a reference to something declared in `declaring`: the files that import one of them,
         * directly or through other files, and everything those files import (a template names a component its module
         * provides, not its own file).
         */
        connected(declaring) {
            const importers = new Map();
            for (const [ from, targets ] of edges) for (const target of targets) (importers.get(target) ?? importers.set(target, []).get(target)).push(from);
            const walk = (start, next) => {
                const seen = new Set(start);
                const stack = [ ...start ];
                while (stack.length) for (const key of next(stack.pop())) if (!seen.has(key)) {
                    seen.add(key);
                    stack.push(key);
                }
                return seen;
            };
            const above = walk([ ...declaring.keys() ], key => importers.get(key) ?? []);
            return walk([ ...above ], key => edges.get(key) ?? []);
        },
        /** Files whose text, or whose template file, holds one of the words (as the start of a name). */
        holding(words) {
            const pattern = new RegExp(words.map(word => `(?<![\\w$])${escapeRegExp(word)}`).join("|"));
            const found = new Map();
            for (const [ key, file ] of universe) {
                if (pattern.test(session.diskText(file) ?? "") || templatesOf(key, file).some(template => pattern.test(session.diskText(template) ?? ""))) found.set(key, file);
            }
            return found;
        },
        /** The .ts files that own a template file. */
        ownersOf(template) {
            const wanted = fileKey(template);
            return [ ...universe ].filter(([ key, file ]) => templatesOf(key, file).some(owned => fileKey(owned) === wanted)).map(([ , file ]) => file);
        },
        /**
         * The next project to load: the one that reaches most of `remaining` (file keys); of equals one that this process
         * has loaded already (the warm server), then the smaller one. With `must`, only a project that reaches one of those
         * files; without, only a project that adds something.
         */
        choose({ remaining, must = null, exclude = new Set() }) {
            let best = null;
            for (const candidate of candidates) {
                if (exclude.has(candidate) || (must && ![ ...must.keys() ].some(key => candidate.reach.has(key)))) continue;
                let score = 0;
                for (const key of remaining) if (candidate.reach.has(key)) score++;
                if (!must && score === 0) continue;
                const entry = { candidate, score, loaded: session.isLoaded(candidate.tsconfig) };
                const better = !best || score > best.score || (score === best.score && (entry.loaded > best.loaded || (entry.loaded === best.loaded && candidate.reach.size < best.candidate.reach.size)));
                if (better) best = entry;
            }
            return best?.candidate ?? null;
        }
    };
}

/** `Class`, `Class.member` or `path/file.ts#Class.member` -> its parts. */
function parseTarget(targetText) {
    const whole = String(targetText ?? "");
    const fileHint = whole.includes("#") ? slash(whole.slice(0, whole.lastIndexOf("#"))).replace(/^\.\//, "") : null;
    const [ className, memberName = null, ...extra ] = whole.slice(whole.lastIndexOf("#") + 1).split(".");
    const selectorHint = /^[a-z][\w]*-[\w-]*$/.test(className ?? "") ? `. "${className}" looks like a selector: give its class (ng-facts usages ${className} prints it)` : "";
    if (!IDENTIFIER.test(className ?? "") || (memberName !== null && !memberName) || extra.length) throw new UsageError(`expected <Class>.<member> or <Class> (or <file>#<Class>…), got "${whole}"${selectorHint}`);
    return { whole, fileHint, className, memberName };
}

function noClassMessage(names, className, where) {
    const all = [ ...new Set(names) ];
    const strip = name => name.toLowerCase().replace(/(component|directive|service|pipe|module)$/, "");
    const wanted = strip(className);
    const close = all.filter(name => name.toLowerCase().includes(wanted) || (strip(name) && wanted.includes(strip(name)))).sort(naturalOrder);
    return `no class "${className}" in ${where} (${all.length} classes read).${close.length ? ` Close names: ${close.slice(0, 12).join(", ")}${close.length > 12 ? ", …" : ""}.` : ""}`;
}

/**
 * Runs `visit(workspace, targetText)` in as few projects as cover the files that hold the name: first the project that has
 * the class and most of those files, then, while files are left that a project not yet loaded reaches, the one that
 * reaches most of them. With --project only that project is asked. `wordsOf(result)` gives the names to look for once the
 * target is known (an alias, a selector). Returns the results, the projects by name and the notes about what is not covered.
 */
function acrossProjects(session, targetText, projectOption, visit, wordsOf) {
    const parsed = parseTarget(targetText);
    const cover = session.cover();
    if (!cover.candidates.length && !projectOption) throw new UsageError(`no tsconfig in ${session.root} lists source files: name the project with --project <tsconfig>`);
    const declaring = cover.declaring(parsed.className, parsed.fileHint);
    const connected = cover.connected(declaring);
    const holders = words => new Map([ ...cover.holding(words) ].filter(([ key ]) => connected.has(key)));
    let words = [ parsed.memberName ?? parsed.className ];

    let first;
    if (projectOption) first = cover.named(projectOption);
    else {
        if (!declaring.size) throw new UsageError(noClassMessage(cover.classNames(), parsed.className, `the tsconfig projects of ${session.root}`));
        first = cover.choose({ remaining: [ ...holders(words).keys() ], must: declaring });
    }
    const results = [];
    const loaded = new Set();
    const covered = new Set();
    const ask = (candidate, text) => {
        loaded.add(candidate);
        const workspace = session.load(candidate.tsconfig);
        const result = visit(workspace, text);
        for (const sourceFile of workspace.service.getProgram().getSourceFiles()) covered.add(session.fileKey(sourceFile.fileName));
        results.push({ workspace, result, name: candidate.name });
        return result;
    };
    mark(`first project chosen: ${first.name}`);
    const { target } = ask(first, targetText);
    words = [ ...new Set([ ...words, ...wordsOf(target) ]) ];
    const exact = `${session.relative(target.file)}#${target.declaredIn}${target.memberName ? `.${target.memberName}` : ""}`;
    const left = () => [ ...holders(words) ].filter(([ key ]) => !covered.has(key));
    for (let remaining = left(); !projectOption && remaining.length; remaining = left()) {
        const next = cover.choose({ remaining: remaining.map(([ key ]) => key), exclude: loaded });
        if (!next) break;
        try {
            ask(next, exact);
        } catch (error) {
            // a project that holds the word in a file of its own but not the class has nothing to add
            if (!(error instanceof NotInProject)) throw error;
            for (const key of next.reach.keys()) covered.add(key);
        }
    }

    const notes = [];
    const some = files => `${files.slice(0, 2).map(file => session.relative(file)).join(", ")}${files.length > 2 ? ", …" : ""}`;
    const outside = left().map(([ , file ]) => file);
    if (outside.length && projectOption) {
        const by = cover.candidates.filter(candidate => !loaded.has(candidate))
            .map(candidate => ({ name: candidate.name, count: outside.filter(file => candidate.reach.has(session.fileKey(file))).length }))
            .filter(entry => entry.count).sort((a, b) => b.count - a.count).slice(0, 3).map(entry => `${entry.name} ×${entry.count}`);
        notes.push(`${plural(outside.length, "file")} outside ${first.name} hold${outside.length === 1 ? "s" : ""} the name (${by.join(", ") || some(outside)}): not in this answer — drop --project to cover them`);
    } else if (outside.length) notes.push(`${plural(outside.length, "file")} hold${outside.length === 1 ? "s" : ""} the name but no tsconfig could load ${outside.length === 1 ? "it" : "them"} (${some(outside)}): read by hand`);
    const apart = [ ...cover.holding(words) ].filter(([ key ]) => !covered.has(key) && !connected.has(key)).map(([ , file ]) => file);
    if (apart.length) notes.push(`${plural(apart.length, "file")} of other tsconfigs hold${apart.length === 1 ? "s" : ""} the word but no import connects ${apart.length === 1 ? "it" : "them"} to ${target.declaredIn}: not loaded (e.g. ${session.relative(apart[0])})`);
    return { results, target, words, projects: results.map(entry => entry.name), notes, cover };
}

// ---------------------------------------------------------------- templates: where a reference is

/**
 * What the template parser reads in a template. `keys`: offset of every attribute name of a start tag ->
 * { end, tag, tagStart, form, element, property }. `element` is what a selector is matched against (the tag and its
 * attributes); `property` says that a bound attribute sets a property ([name] or [(name)]), not a class, a style or an
 * attribute. `elements`: every start tag as { tag, tagStart, tagEnd, element }. `errors` counts what the parser could not read.
 */
function attributeKeys(ng, text, file, range) {
    const keys = new Map();
    const elements = [];
    const setsProperty = input => input.type === ng.BindingType.Property || input.type === ng.BindingType.TwoWay;
    const collect = (element, tagStart, attributes, form) => {
        for (const attribute of attributes) {
            if (attribute.keySpan) keys.set(attribute.keySpan.start.offset, { end: attribute.keySpan.end.offset, tag: element.tag, tagStart, form, element, property: form === "bound" && setsProperty(attribute) });
        }
    };
    const collectAll = (tag, node) => {
        const tagStart = node.startSourceSpan.start.offset;
        const element = { tag, attributes: node.attributes.map(attribute => [ attribute.name, attribute.value ?? "" ]), inputs: node.inputs.filter(setsProperty).map(input => input.name) };
        elements.push({ tag, tagStart, tagEnd: node.startSourceSpan.end.offset, element });
        collect(element, tagStart, node.outputs, "event");
        collect(element, tagStart, node.inputs, "bound");
        collect(element, tagStart, node.attributes, "static");
    };
    const visitor = new (class extends ng.TmplAstRecursiveVisitor {
        visitElement(element) {
            collectAll(element.name, element);
            super.visitElement(element);
        }
        visitTemplate(template) {
            if (template.tagName === "ng-template") collectAll("ng-template", template);
            super.visitTemplate(template);
        }
    })();
    let errors = 0;
    try {
        const parsed = ng.parseTemplate(text, file, { preserveWhitespaces: true, ...(range ? { range, escapedString: true } : {}) });
        errors = parsed.errors?.length ?? 0;
        ng.tmplAstVisitAll(visitor, parsed.nodes);
    } catch {
        // a template the parser gives up on has no attribute names to offer; its references count as expressions
        errors = 1;
    }
    return { keys, elements, errors };
}

/** The template regions of a file: the whole file for a template file, the `template:` strings of decorators for a .ts file. */
function templateRegionsOf(workspace, file) {
    if (workspace.templateRegions.has(file)) return workspace.templateRegions.get(file);
    const { ts, ng } = workspace;
    const text = workspace.textOf(file);
    const regions = [];
    const add = (region, range) => {
        const { keys, elements, errors } = attributeKeys(ng, text, file, range);
        if (errors) workspace.brokenTemplates.add(file);
        regions.push({ ...region, keys, elements });
    };
    if (!TS_FILE.test(file)) {
        add({ start: 0, end: text.length, external: true });
    } else if (text.includes("template")) {
        const sourceFile = workspace.program.getSourceFile(file) ?? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        const opaque = [];
        const visit = node => {
            // The key may be quoted ("template": …). A template that is not one plain string (`…${x}…`, "a" + b) is not read
            // by the service at all: kept apart, so that the name inside it can be reported instead of passed over.
            if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) && node.name.text === "template" && ts.findAncestor(node, ts.isDecorator)) {
                if (ts.isStringLiteralLike(node.initializer)) {
                    const start = node.initializer.getStart(sourceFile) + 1, end = node.initializer.end - 1;
                    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
                    add({ start, end, external: false }, { startPos: start, startLine: line, startCol: character, endPos: end });
                } else if (!ts.isIdentifier(node.initializer)) opaque.push({ start: node.initializer.getStart(sourceFile), end: node.initializer.end });
            }
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        if (opaque.length) workspace.opaqueTemplates.set(file, opaque);
    }
    workspace.templateRegions.set(file, regions);
    return regions;
}

const regionAt = (workspace, file, offset) => templateRegionsOf(workspace, file).find(candidate => offset >= candidate.start && offset < candidate.end);

/**
 * One place the service pointed at: the offset of the NAME, what is written there and what kind of place it is.
 * For an input of a generic component the service also returns the whole attribute (`[name]="…"`): narrowed to the name.
 */
function placeOf(workspace, fileName, textSpan) {
    const file = slash(fileName), text = workspace.textOf(file);
    const spanText = text.slice(textSpan.start, textSpan.start + textSpan.length);
    const region = regionAt(workspace, file, textSpan.start);
    if (!region) return { workspace, file, offset: textSpan.start, name: spanText, kind: "class-read", on: null, form: null, inline: false, whole: false };
    const whole = !IDENTIFIER.test(spanText);
    let offset = textSpan.start;
    if (whole) {
        const inside = [ ...region.keys.keys() ].filter(key => key >= textSpan.start && key < textSpan.start + textSpan.length);
        offset = inside.length ? Math.min(...inside) : textSpan.start + /^[^\w$]*/.exec(spanText)[0].length;
    }
    const key = region.keys.get(offset);
    const name = key ? text.slice(offset, key.end) : whole ? /^[\w$]*/.exec(text.slice(offset))[0] : spanText;
    if (!key) return { workspace, file, offset, name, kind: "template-read", on: null, form: null, inline: !region.external, whole };
    const form = key.form === "bound" && text.slice(offset - 2, offset) === "[(" ? "two-way" : key.form;
    return { workspace, file, offset, name, kind: form === "static" ? "static" : "binding", on: key.tag, tagStart: key.tagStart, form, inline: !region.external, whole };
}

// ---------------------------------------------------------------- the class and its member (TypeScript AST and checker)

function findClasses(workspace, className) {
    const { ts, program } = workspace;
    const found = [];
    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile || sourceFile.fileName.includes(".ngtypecheck.") || sourceFile.fileName.includes("/node_modules/")) continue;
        if (className !== undefined && !sourceFile.text.includes(className)) continue;
        const visit = node => {
            if (ts.isClassDeclaration(node) && node.name && (className === undefined || node.name.text === className)) found.push({ sourceFile, node });
            ts.forEachChild(node, visit);
        };
        visit(sourceFile);
    }
    return found;
}

const nameOfMember = (ts, node) => (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name)) ? node.name.text : undefined);

/** Named members a class declares itself, constructor parameter properties included. */
function ownMembers(ts, classNode) {
    return classNode.members.flatMap(member => {
        if (ts.isConstructorDeclaration(member)) return member.parameters.filter(parameter => ts.getModifiers(parameter)?.length && nameOfMember(ts, parameter));
        return nameOfMember(ts, member) ? [ member ] : [];
    });
}

/** What a member is, in the words of its author: input(), @Input(), output(), field, method … and its modifiers. */
function describeMember(ts, member) {
    const sourceFile = member.getSourceFile();
    const decorators = (ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []).map(decorator => /^\w+/.exec(decorator.expression.getText(sourceFile))?.[0]);
    const initializer = ts.isPropertyDeclaration(member) ? member.initializer?.getText(sourceFile) ?? "" : "";
    const factory = /^(input|model|output)(\.required)?\s*[<(]/.exec(initializer)?.[1];
    const kind = decorators.includes("Input") ? "@Input()"
        : decorators.includes("Output") ? "@Output()"
        : factory ? `${factory}()`
        : ts.isParameter(member) ? "constructor parameter"
        : ts.isMethodDeclaration(member) ? "method"
        : ts.isGetAccessor(member) || ts.isSetAccessor(member) ? "accessor"
        : "field";
    const modifiers = (ts.canHaveModifiers(member) ? ts.getModifiers(member) ?? [] : []).map(modifier => modifier.getText(sourceFile));
    // the public name of an input when it is not the member's own: input(…, { alias: "x" }), @Input("x"), @Input({ alias: "x" })
    const inputDecorator = (ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []).map(decorator => decorator.expression.getText(sourceFile)).find(text => /^(Input|Output)\b/.test(text)) ?? "";
    const alias = /\balias\s*:\s*["'`]([^"'`]+)["'`]/.exec(factory ? initializer : inputDecorator)?.[1] ?? /^(?:Input|Output)\(\s*["'`]([^"'`]+)["'`]/.exec(inputDecorator)?.[1] ?? null;
    return { kind, modifiers, alias };
}

/** Does the class behind `classNode` extend the class `base`, directly or through other classes? Asked from the type checker. */
function inheritsFrom(workspace, classNode, base) {
    const { checker } = workspace;
    const symbol = classNode.name && checker.getSymbolAtLocation(classNode.name);
    const wanted = base.name && checker.getSymbolAtLocation(base.name);
    if (!symbol || !wanted || symbol === wanted) return false;
    const seen = new Set();
    const reaches = type => {
        if (seen.has(type)) return false;
        seen.add(type);
        return (type.getBaseTypes?.() ?? []).some(parent => parent.getSymbol() === wanted || reaches(parent));
    };
    try {
        return reaches(checker.getDeclaredTypeOfSymbol(symbol));
    } catch {
        return false;
    }
}

const classOfMember = (ts, member) => (ts.isParameter(member) ? member.parent.parent : member.parent);

/** The text of the first decorator of a class that is one of Angular's, and its name: { name: "Component", text }. */
function angularDecorator(ts, node) {
    for (const decorator of ts.getDecorators(node) ?? []) {
        const text = decorator.getText(node.getSourceFile());
        const name = /^@(Component|Directive|Pipe|Injectable|NgModule)\b/.exec(text)?.[1];
        if (name) return { name, text };
    }
    return null;
}

/** The selector a class is given in its @Component / @Directive decorator, as written. */
function selectorOf(ts, node) {
    return /selector\s*:\s*["'`]([^"'`]+)["'`]/.exec((ts.getDecorators(node) ?? []).map(decorator => decorator.getText(node.getSourceFile())).join("\n"))?.[1] ?? null;
}

/** The class a target names: the one in the file of the hint when two classes share the name; `unambiguous` refuses to guess. */
function resolveClass(workspace, parsed, { unambiguous = false } = {}) {
    const { className, memberName, fileHint } = parsed;
    const rest = memberName ? `.${memberName}` : "";
    const named = findClasses(workspace, className);
    const hint = fileHint !== null && path.isAbsolute(fileHint) ? workspace.relative(fileHint) : fileHint;
    const inFile = candidate => hint === null || `/${workspace.relative(candidate.sourceFile.fileName)}`.toLowerCase().endsWith(`/${hint.replace(/^\.\//, "")}`.toLowerCase());
    const classes = named.filter(inFile);
    if (named.length && !classes.length) throw new NotInProject(`no class "${className}" in a file ${fileHint}: it is declared in ${named.map(other => workspace.relative(other.sourceFile.fileName)).join(", ")}`);
    if (classes.length > 1 && unambiguous) throw new UsageError(`${classes.length} classes are named ${className}: say which one, as ${classes.map(other => `${workspace.relative(other.sourceFile.fileName)}#${className}${rest}`).join(" or ")}`);
    if (classes.length === 0) throw new NotInProject(noClassMessage(findClasses(workspace).map(candidate => candidate.node.name.text), className, `the project ${workspace.tsconfigName}`));
    const [ cls, ...others ] = classes;
    const notes = others.length ? [ `${classes.length} classes are named ${className}: this is ${workspace.relative(cls.sourceFile.fileName)}; for another write ${others.map(other => `${workspace.relative(other.sourceFile.fileName)}#${className}${rest}`).join(" or ")}` ] : [];
    return { cls, notes };
}

/**
 * `Class.member` -> the declaration the references are asked from; a member the class inherits is followed to its declaring
 * class. `Class` alone -> the class itself (memberName is null).
 */
function resolveTarget(workspace, targetText, options) {
    const { ts, checker } = workspace;
    const parsed = parseTarget(targetText);
    const { className, memberName } = parsed;
    const { cls, notes } = resolveClass(workspace, parsed, options);
    if (memberName === null) {
        const sourceFile = cls.sourceFile, file = slash(sourceFile.fileName), position = cls.node.name.getStart(sourceFile);
        const decorator = angularDecorator(ts, cls.node);
        return {
            className, memberName: null, kind: decorator ? `@${decorator.name}` : "class", modifiers: [], alias: null, file, position, notes,
            line: workspace.positionOf(file, position).line, declaredIn: className,
            selector: decorator && decorator.name !== "Pipe" ? selectorOf(ts, cls.node) : null,
            pipeName: decorator?.name === "Pipe" ? /\bname\s*:\s*["'`]([^"'`]+)["'`]/.exec(decorator.text)?.[1] ?? null : null,
            isInput: false, inLibrary: false, declaringClass: cls.node, generic: Boolean(cls.node.typeParameters?.length)
        };
    }

    const symbol = checker.getSymbolAtLocation(cls.node.name);
    const instanceType = symbol ? checker.getDeclaredTypeOfSymbol(symbol) : undefined;
    const staticType = symbol ? checker.getTypeOfSymbolAtLocation(symbol, cls.node) : undefined;
    const usable = declaration => declaration?.name && (ts.isClassElement(declaration) || ts.isParameter(declaration)) && ts.isClassLike(classOfMember(ts, declaration));
    let member = ownMembers(ts, cls.node).find(candidate => nameOfMember(ts, candidate) === memberName);
    if (!member) {
        const inherited = instanceType?.getProperty(memberName) ?? staticType?.getProperty(memberName);
        member = [ inherited?.valueDeclaration, ...(inherited?.declarations ?? []) ].find(usable);
    }
    if (!member) {
        const own = ownMembers(ts, cls.node).map(candidate => `${nameOfMember(ts, candidate)} (${describeMember(ts, candidate).kind})`);
        const inherited = new Map();
        for (const property of instanceType?.getProperties() ?? []) {
            const declaration = [ property.valueDeclaration, ...(property.declarations ?? []) ].find(usable);
            if (!declaration || declaration.getSourceFile().isDeclarationFile || classOfMember(ts, declaration) === cls.node) continue;
            const owner = classOfMember(ts, declaration).name?.text ?? "a base class";
            inherited.set(owner, [ ...(inherited.get(owner) ?? []), property.name ]);
        }
        const position = workspace.positionOf(slash(cls.sourceFile.fileName), cls.node.name.getStart(cls.sourceFile));
        const aliased = ownMembers(ts, cls.node).find(candidate => describeMember(ts, candidate).alias === memberName);
        if (aliased) {
            throw new UsageError(`"${memberName}" is the alias of ${className}.${nameOfMember(ts, aliased)}: templates bind the alias, TypeScript uses ${nameOfMember(ts, aliased)}. Ask for ${className}.${nameOfMember(ts, aliased)}` +
                ` (its references include the alias bindings). To rename the alias itself: ng-facts.mjs rename-input ${className}.${memberName} <new alias>`);
        }
        throw new UsageError([
            `${className} (${workspace.relative(cls.sourceFile.fileName)}:${position.line}) has no member "${memberName}".`,
            `Members: ${[ ...new Set(own) ].join(", ") || "none of its own"}.`,
            ...[ ...inherited ].map(([ owner, names ]) => `Inherited from ${owner}: ${names.join(", ")}.`)
        ].join("\n"));
    }

    const declaringClass = classOfMember(ts, member);
    const sourceFile = member.getSourceFile();
    const file = slash(sourceFile.fileName);
    const position = member.name.getStart(sourceFile);
    const { kind, modifiers, alias } = describeMember(ts, member);
    return {
        className, memberName, kind, modifiers, alias, file, position, notes,
        line: workspace.positionOf(file, position).line,
        declaredIn: declaringClass.name?.text ?? className,
        selector: ts.isClassDeclaration(declaringClass) ? selectorOf(ts, declaringClass) : null,
        pipeName: null,
        isInput: INPUT_KINDS.has(kind),
        inLibrary: sourceFile.isDeclarationFile || file.includes("/node_modules/"),
        declaringClass
    };
}

/** The names under which a target can stand in a file, besides its own: an alias, the parts of a selector, a pipe's name. */
function wordsOfTarget(workspace, target) {
    const words = [];
    if (target.alias) words.push(target.alias);
    if (target.pipeName) words.push(target.pipeName);
    if (target.memberName === null && target.selector) {
        try {
            for (const selector of workspace.ng.CssSelector.parse(target.selector)) {
                if (selector.element && selector.element !== "*") words.push(selector.element);
                for (let index = 0; index < selector.attrs.length; index += 2) words.push(selector.attrs[index]);
            }
        } catch {
            // a selector the parser does not accept gives no words
        }
    }
    // a structural directive binds its inputs under a short key: *appFor="let x of list" is the input appForOf
    const attribute = /^\[([\w$]+)\]$/.exec(target.selector ?? "")?.[1];
    if (target.isInput && attribute && target.memberName.startsWith(attribute) && target.memberName.length > attribute.length) words.push(target.memberName[attribute.length].toLowerCase() + target.memberName.slice(attribute.length + 1));
    return words;
}

/** "<class behind the tag>, extends <class that declares the member>" for a tag, when the service knows its class. */
function ownerOfTag(target, place, cache) {
    if (cache.has(place.on)) return cache.get(place.on);
    const { workspace } = place;
    const { ts } = workspace;
    let owner = null;
    try {
        const info = workspace.service.getQuickInfoAtPosition(place.file, place.tagStart + 1);
        const name = /^\((?:component|directive)\)\s+([\w$]+)/.exec(info?.displayParts?.map(part => part.text).join("") ?? "")?.[1];
        if (name && name !== target.declaredIn) {
            let current = findClasses(workspace, name)[0]?.node, inherits = false;
            for (let depth = 0; current && depth < 12 && !inherits; depth++) {
                const base = current.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0].expression.getText(current.getSourceFile());
                inherits = base === target.declaredIn;
                current = base ? findClasses(workspace, base)[0]?.node : undefined;
            }
            owner = inherits ? `${name}, extends ${target.declaredIn}` : name;
        }
    } catch {
        // no owner to show
    }
    cache.set(place.on, owner);
    return owner;
}

// ---------------------------------------------------------------- references of a member

const keyOfPlace = place => `${place.file}@${place.offset}`;
const USE_LABELS = {
    call: "called in TypeScript code", read: "read in TypeScript code", write: "written in TypeScript code",
    key: "set as a key of an object literal in TypeScript code", redeclared: "declared again (an override, or a member of an interface)"
};
const labelOfGroup = place => (place.label ? place.label
    : place.kind === "declaration" ? "declaration"
    : place.kind === "binding" ? `${place.form} on <${place.on}>`
    : place.kind === "static" ? `static attribute on <${place.on}>`
    : place.kind === "template-read" ? "read in a template expression"
    : USE_LABELS[place.use] ?? "TypeScript code");
const wordPattern = (word, flags = "") => new RegExp(`(?<![\\w$])${escapeRegExp(word)}(?![\\w$])`, flags);
const shownPlaces = (session, places, most = 3) => `${places.slice(0, most).map(place => `${session.relative(place.file)}:${place.line}`).join(", ")}${places.length > most ? ", …" : ""}`;

/** The innermost TypeScript node at an offset. */
function nodeAt(ts, sourceFile, offset) {
    let found;
    const visit = node => {
        if (offset < node.getStart(sourceFile) || offset >= node.end) return;
        found = node;
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}

/** How TypeScript code uses a member at a place: "call", "read", "write", "key" (of an object literal) or "redeclared". */
function useOfMember(workspace, target, place) {
    const { ts } = workspace;
    const sourceFile = workspace.program.getSourceFile(place.file);
    const node = sourceFile && nodeAt(ts, sourceFile, place.offset);
    const parent = node?.parent;
    if (!parent) return "read";
    if ((ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isElementAccessExpression(parent) && parent.argumentExpression === node)) {
        const outer = parent.parent;
        if (ts.isCallExpression(outer) && outer.expression === parent) return target.kind === "method" ? "call" : "read";
        if (ts.isBinaryExpression(outer) && outer.left === parent && outer.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && outer.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return "write";
        if ((ts.isPrefixUnaryExpression(outer) || ts.isPostfixUnaryExpression(outer)) && (outer.operator === ts.SyntaxKind.PlusPlusToken || outer.operator === ts.SyntaxKind.MinusMinusToken)) return "write";
        return "read";
    }
    if ((ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) && parent.name === node) return "key";
    if ((ts.isClassElement(parent) || ts.isTypeElement(parent) || ts.isParameter(parent)) && parent.name === node) return "redeclared";
    return "read";
}

/**
 * Bindings of an input that the service did not return, found with the template parser: an attribute with the input's name
 * on an element that matches the selector of the declaring class or of a class that extends it. The service loses these for
 * an input declared with a transform in a decorator, and in a template it does not type-check; the compiler reports the
 * bound form afterwards, the static form (a plain attribute) nobody would.
 */
function bindingsFromParser(workspace, target, known) {
    const { ts, ng } = workspace;
    if (!target.isInput || target.alias || !ts.isClassDeclaration(target.declaringClass)) return [];
    const matcher = new ng.SelectorMatcher();
    let selectables = 0;
    for (const { node } of findClasses(workspace)) {
        const selector = selectorOf(ts, node);
        if (!selector || (node !== target.declaringClass && !inheritsFrom(workspace, node, target.declaringClass))) continue;
        try {
            matcher.addSelectables(ng.CssSelector.parse(selector), node.name.text);
            selectables++;
        } catch {
            // a selector the parser does not accept matches nothing
        }
    }
    if (!selectables) return [];
    const found = [];
    for (const file of [ ...workspace.sourceFiles(), ...workspace.externalTemplates() ]) {
        const text = workspace.textOf(file);
        if (!text.includes(target.memberName)) continue;
        for (const region of templateRegionsOf(workspace, file)) {
            for (const [ offset, key ] of region.keys) {
                if (known.has(`${file}@${offset}`) || text.slice(offset, key.end) !== target.memberName || (key.form !== "static" && !key.property)) continue;
                const owner = matchedBy(ng, matcher, key.element);
                if (!owner) continue;
                const form = key.form === "bound" && text.slice(offset - 2, offset) === "[(" ? "two-way" : key.form;
                found.push({ workspace, file, offset, name: target.memberName, kind: form === "static" ? "static" : "binding", on: key.tag, tagStart: key.tagStart, form, inline: !region.external, whole: false, fromParser: owner });
            }
        }
    }
    return found;
}

/**
 * Bindings of the input that another directive on the same element takes too: an input of the same public name on a class
 * (outside the target's family) whose selector the element matches. A rename moves the binding away from that directive as
 * well, and the compiler stays green: each such place needs a decision.
 */
function sharedBindings(workspace, target, places) {
    const { ts, ng } = workspace;
    if (!target.isInput || !ts.isClassDeclaration(target.declaringClass)) return [];
    const publicName = target.alias ?? target.memberName;
    const matcher = new ng.SelectorMatcher();
    let selectables = 0;
    for (const { node, sourceFile } of findClasses(workspace)) {
        // a stand-in in a spec or a story (same selector) is not on the app's elements
        if (TEST_FILE.test(sourceFile.fileName)) continue;
        if (node === target.declaringClass || inheritsFrom(workspace, node, target.declaringClass) || inheritsFrom(workspace, target.declaringClass, node)) continue;
        const selector = selectorOf(ts, node);
        if (!selector) continue;
        const takes = ownMembers(ts, node).some(member => {
            const { kind, alias } = describeMember(ts, member);
            return INPUT_KINDS.has(kind) && (alias ?? nameOfMember(ts, member)) === publicName;
        });
        if (!takes) continue;
        try {
            matcher.addSelectables(ng.CssSelector.parse(selector), node.name.text);
            selectables++;
        } catch {
            // a selector the parser does not accept matches nothing
        }
    }
    if (!selectables) return [];
    return places.flatMap(place => {
        if (place.kind !== "binding" && place.kind !== "static") return [];
        const key = regionAt(workspace, place.file, place.offset)?.keys.get(place.offset);
        const owner = key ? matchedBy(ng, matcher, key.element) : null;
        return owner ? [ { ...place, sharedWith: owner } ] : [];
    });
}

/** The first selectable of a matcher that the element of a template matches, or null. */
function matchedBy(ng, matcher, element) {
    const selector = new ng.CssSelector();
    selector.setElement(element.tag);
    for (const [ name, value ] of element.attributes) selector.addAttribute(name, value);
    for (const name of element.inputs) selector.addAttribute(name, "");
    let owner = null;
    matcher.match(selector, (_selector, className) => {
        owner ??= className;
    });
    return owner;
}

/** Every distinct place of the member, the declaration first: what the service returns, plus what only the parser sees. */
function collectPlaces(workspace, target) {
    const entries = (workspace.service.getReferencesAtPosition(target.file, target.position) ?? []).filter(entry => !entry.fileName.includes(".ngtypecheck."));
    const byKey = new Map();
    let whole = 0;
    for (const entry of entries) {
        const place = placeOf(workspace, entry.fileName, entry.textSpan);
        if (place.whole) whole++;
        if (!byKey.has(keyOfPlace(place))) byKey.set(keyOfPlace(place), place);
    }
    const declarationKey = `${target.file}@${target.position}`;
    byKey.set(declarationKey, { ...(byKey.get(declarationKey) ?? { workspace, file: target.file, offset: target.position, name: target.memberName, on: null, form: null, inline: false, whole: false }), kind: "declaration" });
    const fromService = byKey.size;
    mark(`${entries.length} references from the service`);
    const fromParser = bindingsFromParser(workspace, target, new Set(byKey.keys()));
    mark("templates read with the parser");
    for (const place of fromParser) byKey.set(keyOfPlace(place), place);
    const places = [ ...byKey.values() ];
    for (const place of places) {
        Object.assign(place, workspace.positionOf(place.file, place.offset));
        if (place.kind === "class-read") place.use = useOfMember(workspace, target, place);
    }
    return { places, returned: entries.length, fromService, whole, fromParser };
}

// ---------------------------------------------------------------- references of a class

/** What TypeScript code does with a class name at a place: the label of the group it is listed under. */
function useOfClass(workspace, place) {
    const { ts } = workspace;
    const sourceFile = workspace.program.getSourceFile(place.file);
    const node = sourceFile && nodeAt(ts, sourceFile, place.offset);
    const parent = node?.parent;
    if (!parent) return "other code (passed or read as a value)";
    if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isExportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isExportAssignment(parent)) return "import and export statements";
    const heritage = ts.findAncestor(node, ts.isHeritageClause);
    if (heritage && heritage.types.some(type => node.getStart(sourceFile) >= type.expression.getStart(sourceFile) && node.end <= type.expression.end)) return heritage.token === ts.SyntaxKind.ExtendsKeyword ? "extended by a class (extends)" : "implemented by a class (implements)";
    const nameOf = expression => (ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : "");
    const call = ts.findAncestor(node, candidate => ts.isCallExpression(candidate) && candidate.arguments.some(argument => node.getStart(sourceFile) >= argument.getStart(sourceFile) && node.end <= argument.end));
    const callee = call ? nameOf(call.expression) : "";
    const decorator = ts.findAncestor(node, ts.isDecorator);
    const decoratorName = decorator ? nameOf(ts.isCallExpression(decorator.expression) ? decorator.expression.expression : decorator.expression) : "";
    if (callee === "inject" || decoratorName === "Inject") return "injected (inject(), constructor parameter)";
    if (/^downgrade(Component|Injectable|Module)$/.test(callee)) return "downgraded for AngularJS";
    if (/^(viewChild|viewChildren|contentChild|contentChildren|required)$/.test(callee) || /^(ViewChild|ViewChildren|ContentChild|ContentChildren)$/.test(decoratorName)) return "view and content queries";
    const property = ts.findAncestor(node, candidate => ts.isPropertyAssignment(candidate) && (ts.isIdentifier(candidate.name) || ts.isStringLiteralLike(candidate.name)));
    const propertyName = property?.name.text ?? "";
    // the lists of a decorator, and the same lists where a test changes them (TestBed, overrideComponent)
    if ([ "imports", "declarations", "exports", "bootstrap", "hostDirectives" ].includes(propertyName)) return `${propertyName}: [ … ]`;
    if (decorator && property) return /^(providers|viewProviders|useClass|useExisting|provide|deps)$/.test(propertyName) ? "providers" : "decorator metadata";
    const routeLike = property && ts.isObjectLiteralExpression(property.parent) && property.parent.properties.some(other => other.name && [ "path", "loadComponent", "loadChildren", "children" ].includes(other.name.getText(sourceFile)));
    const lazy = ts.findAncestor(node, candidate => ts.isPropertyAssignment(candidate) && /^(loadComponent|loadChildren)$/.test(candidate.name.getText(sourceFile)));
    if (lazy || (propertyName === "component" && routeLike)) return "routes (component, loadComponent, loadChildren)";
    if (/^(providers|viewProviders|useClass|useExisting|provide|deps)$/.test(propertyName)) return "providers";
    const type = ts.findAncestor(node, ts.isTypeNode);
    if (type && ts.isParameter(type.parent) && ts.isConstructorDeclaration(type.parent.parent) && type.parent.type === type) return "injected (inject(), constructor parameter)";
    if (ts.isNewExpression(parent) && parent.expression === node) return "created with new";
    if (type) return "type positions";
    return "other code (passed or read as a value)";
}

/** Elements that match the selector of the class, in every template of the project: found with the template parser. */
function elementsFromParser(workspace, target, known) {
    const { ng } = workspace;
    if (!target.selector) return [];
    const matcher = new ng.SelectorMatcher();
    let selectors;
    try {
        selectors = ng.CssSelector.parse(target.selector);
        matcher.addSelectables(selectors, target.className);
    } catch {
        return [];
    }
    const tokens = selectors.flatMap(selector => [ selector.element, ...selector.attrs.filter((_value, index) => index % 2 === 0), ...selector.classNames ]).filter(token => token && token !== "*");
    const found = [];
    for (const file of [ ...workspace.sourceFiles(), ...workspace.externalTemplates() ]) {
        const text = workspace.textOf(file);
        if (tokens.length && !tokens.some(token => text.includes(token))) continue;
        for (const region of templateRegionsOf(workspace, file)) {
            for (const element of region.elements) {
                if (known.has(`${file}@${element.tagStart}`) || !matchedBy(ng, matcher, element.element)) continue;
                found.push({ workspace, file, offset: element.tagStart, name: element.tag, kind: "template", label: "element in templates", on: element.tag, tagStart: element.tagStart, form: null, inline: !region.external, whole: false, fromParser: target.className });
            }
        }
    }
    return found;
}

/** `| name` in the templates of the project, for a pipe: found by text inside the template regions. */
function pipesFromParser(workspace, target, known) {
    if (!target.pipeName) return [];
    const pattern = new RegExp(`(?<!\\|)\\|\\s*${escapeRegExp(target.pipeName)}(?![\\w$])`, "g");
    const found = [];
    for (const file of [ ...workspace.sourceFiles(), ...workspace.externalTemplates() ]) {
        const text = workspace.textOf(file);
        if (!text.includes(target.pipeName)) continue;
        for (const region of templateRegionsOf(workspace, file)) {
            for (const match of text.slice(region.start, region.end).matchAll(pattern)) {
                const offset = region.start + match.index + match[0].length - target.pipeName.length;
                if (known.has(`${file}@${offset}`)) continue;
                found.push({ workspace, file, offset, name: target.pipeName, kind: "template", label: "pipe in templates", on: null, form: null, inline: !region.external, whole: false, fromParser: target.className });
            }
        }
    }
    return found;
}

/** Every distinct place that references a class: what the service returns, plus the template uses only the parser sees. */
function collectClassPlaces(workspace, target) {
    const entries = (workspace.service.getReferencesAtPosition(target.file, target.position) ?? []).filter(entry => !entry.fileName.includes(".ngtypecheck."));
    const byKey = new Map();
    for (const entry of entries) {
        const file = slash(entry.fileName), start = entry.textSpan.start;
        const region = regionAt(workspace, file, start);
        let place;
        if (region) {
            // in a template the service points at the start tag of the element the class is on, or at the name of a pipe
            const element = region.elements.findLast(candidate => candidate.tagStart <= start && start < candidate.tagEnd);
            const text = workspace.textOf(file).slice(start, start + entry.textSpan.length);
            place = element ? { workspace, file, offset: element.tagStart, name: element.tag, kind: "template", label: "element in templates", on: element.tag, tagStart: element.tagStart, form: null, inline: !region.external, whole: false }
                : { workspace, file, offset: start, name: text, kind: "template", label: target.pipeName && text === target.pipeName ? "pipe in templates" : "read in a template expression", on: null, form: null, inline: !region.external, whole: false };
        } else {
            place = { workspace, file, offset: start, name: target.className, kind: "class-read", on: null, form: null, inline: false, whole: false };
            place.label = useOfClass(workspace, place);
        }
        if (!byKey.has(keyOfPlace(place))) byKey.set(keyOfPlace(place), place);
    }
    const declarationKey = `${target.file}@${target.position}`;
    byKey.set(declarationKey, { workspace, file: target.file, offset: target.position, name: target.className, kind: "declaration", label: "declaration", on: null, form: null, inline: false, whole: false });
    const fromService = byKey.size;
    const known = new Set(byKey.keys());
    const fromParser = [ ...elementsFromParser(workspace, target, known), ...pipesFromParser(workspace, target, known) ];
    for (const place of fromParser) byKey.set(keyOfPlace(place), place);
    const places = [ ...byKey.values() ];
    for (const place of places) Object.assign(place, workspace.positionOf(place.file, place.offset));
    return { places, returned: entries.length, fromService, whole: 0, fromParser };
}

// ---------------------------------------------------------------- the answer of one project, and of all that were needed

/** The references of a target inside one project. */
function referencesIn(workspace, targetText, options) {
    const target = resolveTarget(workspace, targetText, options);
    const collected = target.memberName === null ? collectClassPlaces(workspace, target) : collectPlaces(workspace, target);
    return { target, collected, places: collected.places };
}

function groupsOf(target, places) {
    const owners = new Map();
    const order = group => (target.memberName === null ? CLASS_GROUPS.indexOf(group.label) : KIND_ORDER.indexOf(group.kind));
    const groups = [ ...Map.groupBy(places, labelOfGroup) ].map(([ label, list ]) => ({
        label, kind: list[0].kind, on: list[0].on,
        owner: target.memberName !== null && list[0].on && list[0].tagStart !== undefined ? ownerOfTag(target, list[0], owners) : null,
        count: list.length,
        inline: list.filter(place => place.inline).length,
        tests: list.filter(place => TEST_FILE.test(place.file)).length,
        places: list
    }));
    return groups.sort((left, right) => order(left) - order(right) || right.count - left.count || naturalOrder(left.label, right.label));
}

/**
 * The same word in the projects' files at places that are NOT a reference: attribute names per tag, and the rest. `unread`
 * lists the ones inside a template that is built from an expression, which neither the service nor the parser reads.
 */
function sameWordElsewhere(session, workspaces, name, referenceKeys) {
    const pattern = wordPattern(name, "g");
    const attributes = new Map();
    const files = new Set();
    const unread = [];
    const seen = new Set();
    let other = 0;
    for (const workspace of workspaces) {
        for (const file of [ ...workspace.sourceFiles(), ...workspace.externalTemplates() ]) {
            if (seen.has(file)) continue;
            seen.add(file);
            const text = session.textOf(file);
            if (!text.includes(name)) continue;
            const regions = templateRegionsOf(workspace, file);
            const opaque = session.opaqueTemplates.get(file) ?? [];
            for (const match of text.matchAll(pattern)) {
                if (referenceKeys.has(`${file}@${match.index}`)) continue;
                files.add(file);
                const key = regions.find(region => match.index >= region.start && match.index < region.end)?.keys.get(match.index);
                if (key) attributes.set(key.tag, (attributes.get(key.tag) ?? 0) + 1);
                else other++;
                // data-testid holds "data" but is another attribute: only the name standing alone counts
                const partOfLongerName = text[match.index - 1] === "-" || text[match.index + name.length] === "-";
                if (!partOfLongerName && opaque.some(region => match.index >= region.start && match.index < region.end)) unread.push({ file, offset: match.index, ...session.positionOf(file, match.index) });
            }
        }
    }
    const onTags = [ ...attributes ].sort((left, right) => right[1] - left[1]).map(([ tag, count ]) => ({ tag, count }));
    return { total: other + onTags.reduce((sum, entry) => sum + entry.count, 0), files: files.size, attributes: onTags, other, unread };
}

const sortPlaces = places => places.sort((left, right) => naturalOrder(left.file, right.file) || left.offset - right.offset);
const plainTarget = (session, target) => ({ class: target.className, member: target.memberName, kind: target.kind, modifiers: target.modifiers, alias: target.alias, declaredIn: target.declaredIn, selector: target.selector, file: session.relative(target.file), line: target.line });
const plainPlace = (session, place) => ({ file: session.relative(place.file), line: place.line, column: place.column, offset: place.offset, kind: place.kind, on: place.on, form: place.form, inline: place.inline, text: place.lineText.trim() });
const plainGroups = (session, groups) => groups.map(group => ({ label: group.label, kind: group.kind, on: group.on, owner: group.owner, count: group.count, inline: group.inline, places: group.places.map(place => plainPlace(session, place)) }));

/** Notes every answer starts with: what the tool had to do to get a complete answer, and what it could not do. Short ones. */
function notesFor(session, across, places, elsewhere) {
    const { target } = across;
    const [ first ] = across.results;
    const notes = [ session.rootNote, session.warmNote, ...target.notes ].filter(Boolean);
    const collected = across.results.map(entry => entry.result.collected);
    if (target.memberName !== null) {
        if (target.declaredIn !== target.className) notes.push(`${target.className} inherits ${target.memberName} from ${target.declaredIn}: these are the references of that one declaration`);
        const restricted = target.modifiers.filter(modifier => RESTRICTED_MODIFIERS.includes(modifier));
        if (across.results.some(entry => entry.workspace.strictInputAccessForced) && target.isInput && restricted.length)
            notes.push(`strictInputAccessModifiers switched on in memory: without it the service sees no binding of a ${restricted.join(" ")} input (nothing written)`);
    }
    const lax = across.results.filter(entry => entry.workspace.strictTemplatesForced).map(entry => entry.name);
    if (lax.length) notes.push(`strictTemplates is false in ${lax.join(", ")}: switched on in memory, else bindings inside @if, @for and ng-template are lost (nothing written)`);
    const { returned, fromService, whole } = first.result.collected;
    if (target.memberName !== null && (returned > fromService || whole))
        notes.push(`the service returned ${returned} entries for ${plural(fromService, "place")} (${whole} as a whole attribute, not the name): each place is counted once, at the name`);
    const fromParser = [ ...new Map(collected.flatMap(entry => entry.fromParser).map(place => [ keyOfPlace(place), place ])).values() ];
    if (fromParser.length && target.memberName !== null) {
        const tags = [ ...Map.groupBy(fromParser, place => `<${place.on}>`) ].map(([ tag, list ]) => `${tag} ×${list.length}`).join(", ");
        notes.push(`${plural(fromParser.length, "binding")} on ${tags} not returned by the service: added by the template parser (selector match), look at ${fromParser.length === 1 ? "it" : "them"}: ${shownPlaces(session, fromParser)}`);
    } else if (fromParser.length) {
        const none = !places.some(place => place.kind === "template" && !place.fromParser);
        notes.push(`${plural(fromParser.length, "template use")} not returned by the service${none ? (target.generic ? " (none for this class, as for every generic class)" : " (it returned none for this class)") : ""}: added by the template parser, by ${target.pipeName ? "pipe name" : "selector"}`);
    }
    const broken = [ ...new Set(places.map(place => place.file).filter(file => session.brokenTemplates.has(file))) ];
    if (broken.length) notes.push(`${plural(broken.length, "template")} with syntax errors (${broken.slice(0, 2).map(session.relative).join(", ")}${broken.length > 2 ? ", …" : ""}): its places are found, but a binding may be listed as a read`);
    if (elsewhere.unread.length)
        notes.push(`${plural(elsewhere.unread.length, "occurrence")} of the name in a template built from an expression (\`…\${x}…\`): the service does not read it, look by hand: ${shownPlaces(session, elsewhere.unread)}`);
    return [ ...notes, ...across.notes ];
}

/** The references of a target in the workspace: asked in as few projects as hold the name, every place once. */
function referencesEverywhere(session, targetText, { project, unambiguous } = {}) {
    const across = acrossProjects(session, targetText, project, (workspace, text) => referencesIn(workspace, text, { unambiguous }), target => wordsOfTarget(session, target));
    const byKey = new Map();
    for (const { result } of across.results) for (const place of result.places) if (!byKey.has(keyOfPlace(place)) || place.kind === "declaration") byKey.set(keyOfPlace(place), place);
    const places = sortPlaces([ ...byKey.values() ]);
    const { target } = across;
    const elsewhere = sameWordElsewhere(session, across.results.map(entry => entry.workspace), target.memberName ?? target.className, new Set(byKey.keys()));
    mark("same word elsewhere counted");
    return { target, places, elsewhere, projects: across.projects, notes: notesFor(session, across, places, elsewhere) };
}

/**
 * Every reference of `Class.member`, or of `Class`, in the workspace at `root`, as plain data:
 * { target, references: [ { file, line, column, offset, kind, on, form, inline, text } ], groups, files, projects, sameWordElsewhere, notes }.
 * kind: "declaration" | "binding" | "static" | "template-read" | "class-read" | "template"; on: the element tag, else null.
 */
export function refs(root, targetText, { project } = {}) {
    const session = openSession(root);
    try {
        const { target, places, elsewhere, projects, notes } = referencesEverywhere(session, targetText, { project });
        return {
            target: plainTarget(session, target),
            references: places.map(place => plainPlace(session, place)),
            groups: plainGroups(session, groupsOf(target, places)),
            files: new Set(places.map(place => place.file)).size,
            projects,
            sameWordElsewhere: { ...elsewhere, unread: elsewhere.unread.map(place => ({ file: session.relative(place.file), line: place.line })) },
            notes
        };
    } finally {
        session.dispose();
    }
}

// ---------------------------------------------------------------- rename

/** `{ name }` (an object literal or a destructuring pattern) must become `{ newName: name }`: the local name stays. */
function isShorthand(workspace, place) {
    const { ts } = workspace;
    const sourceFile = workspace.program.getSourceFile(place.file);
    const node = sourceFile && nodeAt(ts, sourceFile, place.offset);
    if (!node?.parent) return false;
    return (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node)
        || (ts.isBindingElement(node.parent) && !node.parent.propertyName && node.parent.name === node && ts.isObjectBindingPattern(node.parent.parent));
}

/** A place in TypeScript code that names a local variable or parameter, not a member. */
function isLocalName(workspace, place) {
    const { ts, checker } = workspace;
    if (place.kind !== "class-read") return false;
    const sourceFile = workspace.program.getSourceFile(place.file);
    const node = sourceFile && nodeAt(ts, sourceFile, place.offset);
    const symbol = node && ts.isIdentifier(node) && !isShorthand(workspace, place) ? checker.getSymbolAtLocation(node) : undefined;
    return Boolean(symbol && symbol.flags & ts.SymbolFlags.Variable);
}

/** The rename inside one project: the edits, the references that are written under another name, and what was done to get there. */
function planIn(workspace, targetText, newName, options) {
    const { target, collected, places } = referencesIn(workspace, targetText, options);
    const { ts, service, checker, session } = workspace;
    const name = `${target.declaredIn}.${target.memberName}`;
    const notes = [];
    if (newName === target.memberName) throw new UsageError(`${name} already has that name`);
    if (target.inLibrary) throw new UsageError(`${name} is declared in ${workspace.relative(target.file)}, outside the project's own sources: it cannot be renamed here`);
    const declaringSymbol = target.declaringClass.name && checker.getSymbolAtLocation(target.declaringClass.name);
    if (declaringSymbol && checker.getDeclaredTypeOfSymbol(declaringSymbol).getProperty(newName)) throw new UsageError(`${target.declaredIn} already has a member "${newName}"`);
    // a class that extends the declaring one may have the new name already: the two members would become one
    const taken = findClasses(workspace).filter(({ node }) => inheritsFrom(workspace, node, target.declaringClass) && ownMembers(ts, node).some(member => nameOfMember(ts, member) === newName));
    if (taken.length) throw new UsageError(`${taken.map(({ node }) => node.name.text).join(", ")} (${taken.length === 1 ? "extends" : "extend"} ${target.declaredIn}) already ${taken.length === 1 ? "has" : "have"} a member "${newName}"`);

    // What the service itself would rename. It gives up on the whole rename when one location does not map back to the
    // name (generic components), and may return fewer places than it has references: the references are the base then.
    const info = service.getRenameInfo(target.file, target.position, {});
    const locations = info.canRename ? (service.findRenameLocations(target.file, target.position, false, false, {}) ?? []).filter(location => !location.fileName.includes(".ngtypecheck.")) : [];
    const fromService = new Map();
    for (const location of locations) {
        const place = { ...placeOf(workspace, location.fileName, location.textSpan), prefixText: location.prefixText, suffixText: location.suffixText };
        if (!fromService.has(keyOfPlace(place))) fromService.set(keyOfPlace(place), place);
    }
    // Places only the service's rename has. Without the prefix/suffix preference (the plugin does not pass it on) TypeScript
    // renames a local name bound by shorthand ({ name } = item) together with the member: such a local keeps its name here,
    // the shorthand is written out instead. Anything else the service wants renamed is taken over.
    const byKey = new Map(places.map(place => [ keyOfPlace(place), place ]));
    let localNames = 0;
    for (const [ key, place ] of fromService) {
        if (byKey.has(key)) Object.assign(byKey.get(key), { prefixText: place.prefixText, suffixText: place.suffixText });
        else if (isLocalName(workspace, place)) localNames++;
        else byKey.set(key, { ...place, ...workspace.positionOf(place.file, place.offset) });
    }
    const all = sortPlaces([ ...byKey.values() ]);
    const renameable = all.filter(place => place.name === target.memberName);
    const covered = renameable.filter(place => fromService.has(keyOfPlace(place))).length;
    const source = covered === renameable.length ? "rename-locations" : "references";
    if (source === "references") notes.push(`findRenameLocations returned ${covered} of ${plural(renameable.length, "place")}${info.canRename ? "" : " (it refuses this rename)"}: the rename is built from the references`);

    // References written under another name. An alias stays as it is. The event of a model() — (<name>Change) — follows the
    // member. Any other name is derived from the member's by Angular (a key of a structural directive, say): renaming the
    // member breaks that binding, and this tool does not know the new spelling.
    const otherNames = all.filter(place => place.name !== target.memberName);
    const aliased = otherNames.filter(place => target.alias !== null && place.name === target.alias);
    const events = otherNames.filter(place => target.kind === "model()" && place.form === "event" && place.name === `${target.memberName}Change`);
    const derived = otherNames.filter(place => !aliased.includes(place) && !events.includes(place));
    if (aliased.length) notes.push(`${plural(aliased.length, "binding")} use${aliased.length === 1 ? "s" : ""} the alias "${target.alias}", which stays: nothing to rename there`);
    if (events.length) notes.push(`${plural(events.length, "event binding")} (${target.memberName}Change) of this model() ${events.length === 1 ? "becomes" : "become"} (${newName}Change)`);
    if (derived.length) notes.push(`${plural(derived.length, "place")} bind${derived.length === 1 ? "s" : ""} it under a derived name and ${derived.length === 1 ? "is" : "are"} NOT renamed, fix by hand: ${shownPlaces(session, derived)}`);
    // the old way to widen the type an input accepts is a static member named after it: it follows the input
    const acceptName = `ngAcceptInputType_${target.memberName}`;
    const accept = target.isInput ? ownMembers(ts, target.declaringClass).find(member => nameOfMember(ts, member) === acceptName) : undefined;
    if (accept) {
        const offset = accept.name.getStart(accept.getSourceFile());
        events.push({ workspace, file: target.file, offset, name: acceptName, kind: "class-read", use: "redeclared", on: null, form: null, inline: false, whole: false, ...workspace.positionOf(target.file, offset), follows: `ngAcceptInputType_${newName}` });
        notes.push(`the static member ${acceptName} of ${target.declaredIn} becomes ngAcceptInputType_${newName}`);
    }

    let shorthands = 0;
    const edits = [
        ...renameable.map(place => {
            const shorthand = TS_FILE.test(place.file) && place.kind === "class-read" && !place.prefixText && !place.suffixText && isShorthand(workspace, place);
            if (shorthand) shorthands++;
            return { ...place, length: target.memberName.length, newText: `${place.prefixText ?? ""}${newName}${place.suffixText ?? (shorthand ? `: ${target.memberName}` : "")}` };
        }),
        ...events.map(place => ({ ...place, length: place.name.length, newText: place.follows ?? `${newName}Change` }))
    ];
    if (shorthands) notes.push(`${plural(shorthands, "shorthand use")} ({ ${target.memberName} }) ${shorthands === 1 ? "becomes" : "become"} { ${newName}: ${target.memberName} }: the local name stays${localNames ? ` (${plural(localNames, "use")} of it untouched)` : ""}`);
    // a binding that another directive on the element takes too, and a selector that is the input's own name: decisions
    const shared = sharedBindings(workspace, target, renameable);
    if (shared.length) {
        const owners = [ ...new Set(shared.map(place => place.sharedWith)) ].join(", ");
        notes.push(`${plural(shared.length, "binding")} also feed${shared.length === 1 ? "s" : ""} ${owners}.${target.alias ?? target.memberName} on the same element: renamed, ${owners} loses ${shared.length === 1 ? "it" : "them"}; decide each: ${shownPlaces(session, shared)}`);
    }
    const ownSelector = target.selector && target.alias === null && new RegExp(`\\[\\s*${escapeRegExp(target.memberName)}\\s*[\\]=~|^$*]`).test(target.selector);
    if (ownSelector) notes.push(`the selector ${target.selector} of ${target.declaredIn} is the input's own name and is NOT renamed: elements bound as [${newName}] no longer match it; decide`);
    const decisions = [ ...shared, ...(ownSelector ? [ { file: target.file, line: target.line, offset: target.position, sharedWith: "selector" } ] : []) ];
    return { target, collected, places, edits, skipped: [ ...aliased, ...derived ], derived, decisions, source, renameLocations: fromService.size, planNotes: notes };
}

/** The rename in the whole workspace: planned in as few projects as hold the name, every edit once. */
function planEverywhere(session, targetText, newName, { project, unambiguous } = {}) {
    if (parseTarget(targetText).memberName === null) throw new UsageError(`rename takes <Class>.<member> <newName>; a class itself is not renamed by this script\n${USAGE}`);
    if (!IDENTIFIER.test(String(newName ?? ""))) throw new UsageError(`"${newName ?? ""}" is not a name a class member can have`);
    const across = acrossProjects(session, targetText, project, (workspace, text) => planIn(workspace, text, newName, { unambiguous }), target => wordsOfTarget(session, target));
    const merged = list => sortPlaces([ ...new Map(across.results.flatMap(entry => entry.result[list]).map(place => [ keyOfPlace(place), place ])).values() ]);
    const edits = merged("edits"), skipped = merged("skipped"), derived = merged("derived"), decisions = merged("decisions");
    // a member that implements or overrides a library one (a lifecycle hook, PipeTransform.transform) has references in
    // node_modules: a rename would edit the library, which no task asks for. Refused before anything is written.
    const foreign = edits.filter(edit => /(?:^|\/)node_modules\//.test(edit.file) || /\.d\.[cm]?ts$/.test(edit.file) ||!insideFolder(session.root, edit.file));
    if (foreign.length) {
        const member = `${across.target.declaredIn}.${across.target.memberName}`;
        throw new UsageError(`${member} is also declared outside the workspace's own sources (${plural(foreign.length, "place")}, e.g. ${foreign[0].file.includes("/node_modules/") ? foreign[0].file.slice(foreign[0].file.lastIndexOf("/node_modules/") + 1) : session.relative(foreign[0].file)}:${foreign[0].line}): it implements or overrides a library member. A rename would edit the library: nothing written`);
    }
    const references = sortPlaces([ ...new Map(across.results.flatMap(entry => entry.result.places).map(place => [ keyOfPlace(place), place ])).values() ]);
    const elsewhere = sameWordElsewhere(session, across.results.map(entry => entry.workspace), across.target.memberName, new Set(references.map(keyOfPlace)));
    const [ first ] = across.results;
    const notes = [ ...new Set([ ...notesFor(session, across, references, elsewhere), ...across.results.flatMap(entry => entry.result.planNotes) ]) ];
    return { target: across.target, newName, edits, skipped, derived, decisions, source: first.result.source, renameLocations: first.result.renameLocations, projects: across.projects, cover: across.cover, notes };
}

/** True when `file` is inside `folder` (both absolute). */
const insideFolder = (folder, file) => {
    const relative = path.relative(folder, file);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

/**
 * Writes the edits, last one first in every file; refuses a file that does not hold the old name where it was read, and
 * then writes nothing at all. The service reads a file without its byte order mark: the mark is set aside and put back.
 */
function applyEdits(edits, root) {
    const byFile = Map.groupBy(edits, edit => edit.file);
    for (const file of byFile.keys()) {
        if (/(?:^|\/)node_modules\//.test(file) ||!insideFolder(root, file)) throw new UsageError(`${file} is outside the workspace or in node_modules: nothing written`);
    }
    const texts = new Map();
    for (const [ file, list ] of byFile) {
        const bytes = readFileSync(file);
        if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) throw new UsageError(`${file} is stored as UTF-16, this tool writes UTF-8 only: nothing written`);
        const stored = bytes.toString("utf8");
        const mark = stored.startsWith("﻿") ? "﻿" : "";
        let text = stored.slice(mark.length);
        for (const edit of [ ...list ].sort((left, right) => right.offset - left.offset)) {
            if (text.slice(edit.offset, edit.offset + edit.length) !== edit.name) throw new UsageError(`${file} on disk is not the text that was analysed (line ${edit.line}): nothing written`);
            text = text.slice(0, edit.offset) + edit.newText + text.slice(edit.offset + edit.length);
        }
        texts.set(file, mark + text);
    }
    for (const [ file, text ] of texts) writeFileSync(file, text);
    return byFile.size;
}

/**
 * Which of the edited files the compiler of `check` does not see: `check` compiles the build's tsconfig, and a spec or a
 * story is not part of it. Returns the note that says so. (The tsconfig of the tests is not offered as a second check:
 * in a real app ngc often reports errors there that the test builder does not, before any change.)
 */
function compiledBy(session, plan) {
    const { cover } = plan;
    const { ts, root, fileKey } = session;
    let build;
    try {
        build = checkConfig(ts, root, undefined);
    } catch {
        return [];
    }
    const reachOf = tsconfig => cover.candidates.find(candidate => fileKey(candidate.tsconfig) === fileKey(tsconfig))?.reach;
    const buildReach = reachOf(build.tsconfig);
    if (!buildReach) return [];
    const edited = [ ...new Set(plan.edits.map(edit => edit.file)) ];
    const sources = [ ...new Set(edited.flatMap(file => (TS_FILE.test(file) ? [ file ] : cover.ownersOf(file)))) ];
    const outside = sources.filter(file => !buildReach.has(fileKey(file)));
    if (!outside.length) return [];
    const some = `${session.relative(outside[0])}${outside.length > 1 ? ", …" : ""}`;
    return [ `${plural(outside.length, "edited file")} ${outside.length === 1 ? "is" : "are"} outside ${build.name}, the project check compiles (specs, stories): check cannot vouch for ${outside.length === 1 ? "it" : "them"} (${some})` ];
}

/**
 * The rename of `Class.member` to `newName` at every reference, as plain data (nothing is written unless `write` is set):
 * { target, newName, edits: [ { file, line, column, offset, length, newText, kind, on, form, inline, text } ], groups, files,
 *   source: "rename-locations" | "references", renameLocations, skipped, projects, written, notes }.
 * The compiler is not run: `compiler` and `compilerClean` stay null (run check, after the text places are done).
 */
export function planRename(root, targetText, newName, { project, write = false } = {}) {
    const session = openSession(root);
    try {
        const plan = planEverywhere(session, targetText, newName, { project, unambiguous: write });
        const plainEdit = edit => ({ ...plainPlace(session, edit), length: edit.length, newText: edit.newText });
        const written = write ? applyEdits(plan.edits, session.root) > 0 : false;
        return {
            target: plainTarget(session, plan.target),
            newName,
            edits: plan.edits.map(plainEdit),
            groups: plainGroups(session, groupsOf(plan.target, plan.edits)),
            files: new Set(plan.edits.map(edit => edit.file)).size,
            source: plan.source,
            renameLocations: plan.renameLocations,
            skipped: plan.skipped.map(place => ({ ...plainPlace(session, place), name: place.name })),
            projects: plan.projects,
            written,
            compiler: null,
            compilerClean: null,
            notes: plan.notes
        };
    } finally {
        session.dispose();
    }
}

// ---------------------------------------------------------------- the compiler's verdict

/** Megabytes of heap a child process may use: the default limit of Node is too small for a big app. */
const heapForChild = () => Math.min(HEAP_MEGABYTES, Math.floor(os.totalmem() / 2 ** 20 * 0.75));

/** Runs the workspace's ngc (no emit) on one tsconfig: its errors and warnings as { file, line, column, code, message, error }. */
function runCompiler(packages, root, tsconfig) {
    // ngc prints a place relative to the tsconfig's folder: shown relative to --root like every other place
    const fromRoot = file => {
        if (!file) return "";
        const candidates = [ path.resolve(root, file), path.resolve(path.dirname(path.resolve(root, tsconfig)), file) ];
        const found = candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
        return slash(path.relative(root, found)) || slash(file);
    };
    let ngc;
    try {
        const manifest = packages.locate("@angular/compiler-cli/package.json");
        ngc = path.resolve(path.dirname(manifest), JSON.parse(readFileSync(manifest, "utf8")).bin.ngc);
    } catch {
        return { list: [], failure: "could not run: @angular/compiler-cli not found in node_modules — run the workspace's own build instead" };
    }
    const run = spawnSync(process.execPath, [ `--max-old-space-size=${heapForChild()}`, ngc, "-p", tsconfig, "--noEmit" ], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
    const list = [ ...output.matchAll(/^(?:(.+?)[:(](\d+)[:,](\d+)\)? ?[-:] )?(error|warning) ((?:NG|TS)\d+): (.*)$/gm) ]
        .map(([ , file, line, column, level, code, message ]) => ({ file: fromRoot(file), line, column, code, message, error: level === "error" }));
    const named = list.some(diagnostic => diagnostic.error);
    return { list, failure: run.status === 0 || named ? null : `failed without an error it could name — ${output.trim().split("\n")[0] || run.error?.message || `exit code ${run.status}`}` };
}

// ---------------------------------------------------------------- command line

function parseArgs(argv) {
    const flags = { root: ".", project: undefined, all: false, write: false, help: false, warm: false, serve: false, "warm-stop": false };
    const positional = [];
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--root" || argument === "--project") {
            if (argv[index + 1] === undefined) throw new UsageError(`${argument} needs a value\n${USAGE}`);
            flags[argument.slice(2)] = argv[++index];
        } else if ([ "--all", "--write", "--help", "--warm", "--serve", "--warm-stop" ].includes(argument)) flags[argument.slice(2)] = true;
        else if (argument === "-h") flags.help = true;
        else if (argument.startsWith("--")) throw new UsageError(`unknown option ${argument}\n${USAGE}`);
        else positional.push(argument);
    }
    return { flags, positional };
}

/** The command word of the arguments, or undefined when they cannot be read (the command itself then says why). */
function commandOf(argv) {
    try {
        return parseArgs(argv).positional[0];
    } catch {
        return undefined;
    }
}

const cut = text => (text.length > LINE_WIDTH ? `${text.slice(0, LINE_WIDTH - 1)}…` : text);
/** A place and its code on one line: the place (file:line) is never cut, only the code after it. */
const placeLine = (where, code) => `${where}  ${code.length > Math.max(40, LINE_WIDTH - where.length - 2) ? `${code.slice(0, Math.max(40, LINE_WIDTH - where.length - 2) - 1)}…` : code}`;
/** A note as lines that start with "!", none longer than the line width: a long note goes on in the next line. */
function noteLines(note) {
    const lines = [];
    let rest = String(note).replace(/\s+/g, " ").trim();
    for (let prefix = "! "; rest; prefix = "!   ") {
        const room = LINE_WIDTH - prefix.length;
        let length = rest.length <= room ? rest.length : rest.lastIndexOf(" ", room);
        if (length <= 0) length = room;
        lines.push(prefix + rest.slice(0, length).trimEnd());
        rest = rest.slice(length).trimStart();
    }
    return lines;
}
const whereOf = group => (group.kind === "declaration" || group.kind === "class-read" ? ""
    : group.inline === 0 ? " (in .html files)"
    : group.inline === group.count ? " (in inline templates)"
    : ` (${group.count - group.inline} in .html files, ${group.inline} in inline templates)`);
const testsOf = group => (group.tests && group.kind !== "declaration" ? ` — ${group.tests === group.count ? "all" : group.tests} in spec/stories files` : "");
const headerOf = (session, target) => (target.memberName === null
    ? `${target.className} — ${target.kind}, declared at ${session.relative(target.file)}:${target.line}${target.selector ? `, selector ${target.selector}` : ""}${target.pipeName ? `, pipe name ${target.pipeName}` : ""}`
    : `${target.declaredIn}.${target.memberName} — ${[ ...target.modifiers, target.kind ].join(" ")}${target.alias ? ` with the alias "${target.alias}"` : ""}, declared at ${session.relative(target.file)}:${target.line}${target.selector ? `, selector ${target.selector}` : ""}`);
/** A command of this skill folder as an agent can paste it: node "<folder>/<script>" <arguments> --root <as given>. */
const commandLine = (script, parts, flags) => `node "${OWN_DIRECTORY}/${script}" ${parts.join(" ")} --root "${slash(path.resolve(flags.rootShown ?? flags.root))}"`;
const UNSEEN = "strings (setInput(\"…\"), inputs: [ \"…\" ]), style selectors, AngularJS templates, files of no tsconfig";

/** leftovers.mjs of this folder for one member, as its one --json line; null when the script is not there. */
function leftoversCounts(member, root, before) {
    const script = `${OWN_DIRECTORY}/leftovers.mjs`;
    if (!existsSync(script)) return null;
    const run = spawnSync(process.execPath, [ script, member, "--root", root, "--json", ...(before ? [ "--before" ] : []) ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    try {
        return JSON.parse(run.stdout.trim().split("\n").at(-1));
    } catch {
        return { failed: `${run.stderr}${run.stdout}`.trim().split("\n")[0] || `exit code ${run.status}` };
    }
}
const TEXT_GROUPS = { string: "strings and keys", style: "style selectors", angularjs: "AngularJS templates", unchecked: ".js code", outside: "tests, stories and documents" };
/** One line: the places of a member that only text shows (leftovers), by kind. Bindings in templates the service reads are left out. */
function textOnlyLine(counts) {
    if (!counts) return null;
    if (counts.failed) return `Text only (leftovers): could not run — ${counts.failed}`;
    const places = [ ...counts.places, ...(counts.alias?.places ?? []) ].filter(place => TEXT_GROUPS[place.group] && place.mark !== "decided");
    const kinds = [ ...Map.groupBy(places, place => TEXT_GROUPS[place.group]) ].map(([ kind, list ]) => `${kind} ×${list.length}`).join(", ");
    const change = places.filter(place => place.mark === "CHANGE").length;
    return `Text only, the service does not see these (leftovers): ${change} to change, ${places.length - change} to look at${kinds ? ` — ${kinds}` : ""}`;
}

/** `check`: the compiler itself (ngc) on the build's tsconfig, its messages counted. Exit code 0 clean, 2 errors, 1 it did not run. */
function printCheck(flags, print, elapsed) {
    const { root, note } = workspaceRoot(flags.root);
    const packages = locatePackages(root);
    const config = checkConfig(packages.ts, root, flags.project);
    const { list, failure } = runCompiler(packages, root, config.tsconfig);
    const scope = `ngc -p ${config.name}, ${config.why}; ${elapsed()}`;
    const notes = [ note, flags.project ? null : `only ${config.name} is compiled: files outside it (specs, stories) are not checked here` ].filter(Boolean);
    if (failure) {
        print(`check: the compiler ${failure} (${scope})`);
        return 1;
    }
    const errors = list.filter(diagnostic => diagnostic.error);
    const warnings = list.length - errors.length;
    if (!list.length) {
        print(`check: 0 errors (${scope})`);
        for (const line of notes.flatMap(noteLines)) print(line);
        return 0;
    }
    const byCode = [ ...Map.groupBy(list, diagnostic => diagnostic.code) ].sort((left, right) => right[1].length - left[1].length).map(([ code, group ]) => `${code} ×${group.length}`).join(", ");
    print(`check: ${plural(errors.length, "error")}${warnings ? ` and ${plural(warnings, "warning")}` : ""} in ${plural(new Set(list.map(diagnostic => diagnostic.file)).size, "file")} — ${byCode} (${scope})`);
    for (const line of notes.flatMap(noteLines)) print(line);
    const kinds = [ ...Map.groupBy(list, diagnostic => `${diagnostic.code} ${diagnostic.message}`).values() ].sort((left, right) => right.length - left.length);
    for (const [ first, ...more ] of flags.all ? kinds : kinds.slice(0, SHOWN_DIAGNOSTICS)) {
        print(cut(`  ${String(more.length + 1).padStart(4)} × ${first.error ? "" : "warning "}${first.code} ${first.message}`));
        // every place on a line of its own with --all: a rename that left reads in code is finished from this list
        if (flags.all) for (const diagnostic of [ first, ...more ]) print(`         ${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`);
        else print(`         ${first.file}:${first.line}:${first.column}${more.length ? `, ${more.slice(0, 2).map(diagnostic => `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`).join(", ")}${more.length > 2 ? `, … +${more.length - 2} more (--all lists every place)` : ""}` : ""}`);
    }
    if (!flags.all && kinds.length > SHOWN_DIAGNOSTICS) print(`  … and ${kinds.length - SHOWN_DIAGNOSTICS} more kinds of message (--all lists every one)`);
    if (errors.length) print("NOT DONE: the compiler reports errors. Fix them and run check again.");
    return errors.length ? 2 : 0;
}

function printRefs(session, flags, print, servedBy, targetText) {
    const { target, places, elsewhere, projects, notes } = referencesEverywhere(session, targetText, { project: flags.project, unambiguous: true });
    const groups = groupsOf(target, places);
    const ofClass = target.memberName === null;
    print(headerOf(session, target));
    const files = new Set(places.map(place => place.file)).size;
    if (ofClass) {
        const outside = places.filter(place => place.file !== target.file && place.label !== "import and export statements");
        const inTests = outside.filter(place => TEST_FILE.test(place.file)).length;
        print(`${plural(places.length, "reference")} in ${plural(files, "file")}; outside its own file, import statements aside: ${outside.length}${inTests ? ` (${inTests} in spec/stories files)` : ""} (${servedBy(projects)})`);
    } else print(`${plural(places.length, "reference")} in ${plural(files, "file")} (${servedBy(projects)})`);
    const member = ofClass ? null : `${target.declaredIn}.${target.memberName}`;
    const textOnly = ofClass ? null : textOnlyLine(leftoversCounts(member, session.root, true));
    if (textOnly) print(textOnly);
    if (!ofClass && places.every(place => place.kind === "declaration") && textOnly && !/: 0 to change, 0 to look at/.test(textOnly)) print("! only the declaration is a reference, but text names it: NOT dead, see the line above");
    for (const line of notes.flatMap(noteLines)) print(line);
    for (const group of groups) {
        const tags = ofClass && group.label === "element in templates" ? ` — ${[ ...Map.groupBy(group.places, place => place.on) ].map(([ tag, list ]) => `<${tag}> ×${list.length}`).slice(0, 6).join(", ")}` : "";
        print(`${group.label}: ${group.count}${whereOf(group)}${group.owner ? ` — ${group.owner}` : ""}${tags}${testsOf(group)}`);
        // the import statements of a class say little: two of them are enough to keep the answer on one screen
        const shown = flags.all ? group.places : group.places.slice(0, group.label === "import and export statements" ? 2 : SHOWN_PER_GROUP);
        for (const place of shown) print(placeLine(`  ${session.relative(place.file)}:${place.line}`, place.lineText.trim()));
        if (group.count > shown.length) print(`  … +${group.count - shown.length} more (--all lists every one)`);
    }
    if (elsewhere.total) {
        const parts = [ elsewhere.attributes.length ? `attributes on ${elsewhere.attributes.slice(0, 6).map(entry => `<${entry.tag}> ×${entry.count}`).join(", ")}${elsewhere.attributes.length > 6 ? ", …" : ""}` : "", elsewhere.other ? `${elsewhere.other} in other code, comments and text` : "" ].filter(Boolean);
        print(cut(`Same word elsewhere in the project, not a reference: ${elsewhere.total} in ${plural(elsewhere.files, "file")} — ${parts.join("; ")}`));
    }
    print(ofClass ? "Not seen by the service: the class name or its selector in strings, style sheets, AngularJS templates, story templates, files of no tsconfig."
        : `Not seen by the service: the name in ${UNSEEN}, story templates (render: template strings).`);
    if (!ofClass && existsSync(`${OWN_DIRECTORY}/leftovers.mjs`)) print(`→ next: ${commandLine("leftovers.mjs", [ member, "--before" ], flags)}   (lists the text-only places; once per question)`);
    else if (ofClass && target.kind === "@Component" && existsSync(`${OWN_DIRECTORY}/ng-facts.mjs`)) print(`→ next: ${commandLine("ng-facts.mjs", [ "where", target.className ], flags)}   (the routes that show it)`);
    return 0;
}

function printRename(session, flags, print, servedBy, targetText, newName) {
    const plan = planEverywhere(session, targetText, newName, { project: flags.project, unambiguous: flags.write });
    const files = new Set(plan.edits.map(edit => edit.file)).size;
    const member = `${plan.target.declaredIn}.${plan.target.memberName}`;
    // written first, said afterwards: a file that cannot be written stops the command before it claims anything
    if (flags.write) applyEdits(plan.edits, session.root);
    print(`rename ${member} → ${plan.newName}: ${plural(plan.edits.length, "edit")} in ${plural(files, "file")} — ${flags.write ? "written" : "dry run, nothing written"} (${servedBy(plan.projects)})`);
    for (const line of [ ...plan.notes, ...compiledBy(session, plan) ].flatMap(noteLines)) print(line);
    for (const group of groupsOf(plan.target, plan.edits)) {
        const [ first ] = group.places;
        const line = `  ${String(group.count).padStart(4)}  ${group.label}${whereOf(group)}${group.owner ? ` — ${group.owner}` : ""}${testsOf(group)}`;
        const example = `e.g. ${session.relative(first.file)}:${first.line}`;
        if (line.length + 3 + example.length <= LINE_WIDTH) print(`${line}   ${example}`);
        else {
            print(cut(line));
            print(cut(`        ${example}`));
        }
    }
    const ownCommand = [ "rename", targetText, newName, ...(flags.project ? [ "--project", flags.project ] : []), ...(flags.warm ? [ "--warm" ] : []) ];
    if (!flags.write) {
        print(`→ next: ${commandLine("ls-facts.mjs", [ ...ownCommand, "--write" ], flags)}`);
        return 0;
    }
    if (plan.derived.length) print(`NOT DONE: ${plural(plan.derived.length, "place")} listed above bind${plan.derived.length === 1 ? "s" : ""} ${member} under a derived name and ${plan.derived.length === 1 ? "was" : "were"} not renamed. Fix by hand.`);
    if (plan.decisions.length) print(`NOT DONE: ${plural(plan.decisions.length, "place")} named in the "!" lines above (another directive on the element, or the selector) need${plan.decisions.length === 1 ? "s" : ""} your decision: change or undo each by hand, and name it in your report.`);
    // --write is never the last step: what the service cannot see is read now, and the exit code says whether work is left
    const left = leftoversCounts(member, session.root, false);
    if (!left) {
        print(`NOT DONE: the service does not see the old name in ${UNSEEN}: search those for "${plan.target.memberName}" and change the ones of ${member}.`);
        print(`→ then: ${commandLine("ls-facts.mjs", [ "check" ], flags)}   (the compiler)`);
        return 2;
    }
    if (left.failed) print(`NOT DONE: leftovers could not check the text (${left.failed}).`);
    else if (left.verdict === "DONE" && !plan.derived.length && !plan.decisions.length) {
        print(`Text: leftovers finds no place that still carries ${plan.target.memberName} (strings, styles, AngularJS templates, stories).`);
        print(`→ next: ${commandLine("leftovers.mjs", [ member, "--final" ], flags)}   (the last gate: leftovers again plus the compiler)`);
        return 0;
    } else if (left.verdict !== "DONE") print(`NOT DONE: ${left.change} places in text still carry ${plan.target.memberName} and ${left.question} are not decided (strings, styles, AngularJS templates, stories): the service cannot see them.`);
    print(`→ next: ${commandLine("leftovers.mjs", [ member ], flags)}   (it lists them; repeat until it prints DONE)`);
    return 2;
}

/**
 * Answers one command through `print` (the standard output unless given) and returns the exit code. A process that stays
 * (the warm server) passes its own session, the root as the caller typed it, and what to say after the elapsed time.
 */
function runCommand(argv, { print = line => console.log(line), session: given = null, rootShown = null, warm = "", started = performance.now() } = {}) {
    const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)} s${warm}`;
    const { flags, positional } = parseArgs(argv);
    if (rootShown !== null) Object.assign(flags, { rootShown, warm: true });
    const [ command, ...rest ] = positional;
    if (flags.help || command === "help") {
        print(HELP);
        return 0;
    }
    if (![ "refs", "rename", "check" ].includes(command)) throw new UsageError(USAGE);
    if (command === "check") return printCheck(flags, print, elapsed);
    if (rest[0] === undefined || (command === "rename" && rest[1] === undefined)) throw new UsageError(USAGE);

    const session = given ?? openSession(flags.root);
    const servedBy = projects => `Angular Language Service ${session.packages.languageServiceVersion}, type-checked, ${projects.join(" + ")}; ${elapsed()}`;
    try {
        return command === "refs" ? printRefs(session, flags, print, servedBy, rest[0]) : printRename(session, flags, print, servedBy, rest[0], rest[1]);
    } finally {
        if (!given) session.dispose();
    }
}

// ---------------------------------------------------------------- --warm: a server that keeps the projects loaded

const warmMinutes = () => Math.max(0.05, Number(process.env.LS_FACTS_WARM_MINUTES) || 10);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Where the warm server of a workspace listens: a named pipe on Windows, else a socket file only this user can reach. */
function warmAddress(root) {
    const id = createHash("sha1").update(`${process.platform === "win32" ? root.toLowerCase() : root}|${OWN_FILE}|${statSync(OWN_FILE).mtimeMs}`).digest("hex").slice(0, 16);
    if (process.platform === "win32") return `\\\\.\\pipe\\ls-facts-${id}`;
    const directory = path.join(os.tmpdir(), `ls-facts-${os.userInfo().uid}`);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return path.join(directory, `${id}.sock`);
}

const connectTo = address => new Promise(resolve => {
    const socket = net.connect(address);
    socket.once("connect", () => resolve(socket));
    socket.once("error", () => resolve(null));
});

/** Sends one request (a line of JSON) and resolves with the answer, or with null when the connection ends without one. */
const askServer = (socket, request) => new Promise(resolve => {
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", chunk => {
        received += chunk;
    });
    socket.on("error", () => resolve(null));
    socket.on("close", () => {
        try {
            resolve(JSON.parse(received));
        } catch {
            resolve(null);
        }
    });
    socket.write(`${JSON.stringify(request)}\n`);
});

/**
 * The server behind --warm: one process per workspace and per version of this file, started by the first --warm command.
 * It keeps the projects loaded, answers one request at a time and ends when nobody asked for LS_FACTS_WARM_MINUTES
 * (10) minutes. Before every answer it compares the files it has read with the disk (session.refresh): a changed file is
 * read again; when a file was added or removed, or a tsconfig or package file changed, it says so and ends, and the
 * caller starts a new one.
 */
function serveWarm(argv) {
    const { root } = workspaceRoot(parseArgs(argv).flags.root);
    const address = warmAddress(root);
    let session = null, timer = null, queue = Promise.resolve();
    const rest = () => {
        clearTimeout(timer);
        timer = setTimeout(() => process.exit(0), warmMinutes() * 60_000);
    };
    const answer = request => {
        if (request.stop) return { output: "", code: 0, exit: true };
        const lines = [];
        const started = performance.now();
        try {
            const reason = session?.refresh() ?? null;
            if (reason) return { restart: reason, exit: true };
            session ??= openSession(root);
            session.warmNote = request.note ?? null;
            const warm = request.started ? `, warm server started: it stays ${warmMinutes()} min after the last call` : ", warm";
            const code = runCommand(request.argv, { print: line => lines.push(line), session, rootShown: request.rootShown, warm, started });
            return { output: lines.join("\n"), code };
        } catch (error) {
            if (error instanceof UsageError) return { output: [ ...lines, error.message ].join("\n"), code: 1 };
            return { output: [ ...lines, `ls-facts failed: ${error?.stack ?? error}` ].join("\n"), code: 1, exit: true };
        }
    };
    const server = net.createServer({ allowHalfOpen: true }, socket => {
        let received = "";
        socket.setEncoding("utf8");
        socket.on("error", () => {});
        socket.on("data", chunk => {
            received += chunk;
            const end = received.indexOf("\n");
            if (end < 0) return;
            const line = received.slice(0, end);
            received = "";
            queue = queue.then(() => {
                clearTimeout(timer);
                let reply;
                try {
                    reply = answer(JSON.parse(line));
                } catch (error) {
                    reply = { output: `ls-facts failed: ${error?.stack ?? error}`, code: 1, exit: true };
                }
                if (reply.exit) socket.end(JSON.stringify(reply), () => process.exit(0));
                else {
                    socket.end(JSON.stringify(reply));
                    rest();
                }
            });
        });
    });
    server.on("error", () => process.exit(0));
    process.on("exit", () => {
        if (process.platform !== "win32") {
            try {
                unlinkSync(address);
            } catch {
                // the socket file is gone already
            }
        }
    });
    connectTo(address).then(alive => {
        // another server of this workspace answers already
        if (alive) {
            alive.destroy();
            process.exit(0);
        }
        if (process.platform !== "win32" && existsSync(address)) unlinkSync(address);
        server.listen(address, rest);
    });
}

/** The arguments as the server needs them: no --warm and no --root (the caller adds the root as a full path). */
function forwardedArguments(argv) {
    const forwarded = [];
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === "--warm") continue;
        if (argv[index] === "--root") index++;
        else forwarded.push(argv[index]);
    }
    return forwarded;
}

/** `--warm`: asks the server of this workspace, starting it when none answers. Falls back to a plain run without it. */
async function warmClient(argv) {
    const { flags } = parseArgs(argv);
    const { root } = workspaceRoot(flags.root);
    // a missing package is said here, not inside a server nobody sees
    withLanguageService(locatePackages(root));
    const address = warmAddress(root);
    const request = { argv: [ ...forwardedArguments(argv), "--root", root ], rootShown: root, started: false, note: null };
    for (let attempt = 0; attempt < 3; attempt++) {
        let socket = await connectTo(address);
        if (!socket) {
            spawn(process.execPath, [ `--max-old-space-size=${heapForChild()}`, OWN_FILE, "--serve", "--root", root ], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, LS_FACTS_HEAP: "serve" } }).unref();
            request.started = true;
            for (let tries = 0; tries < 100 && !socket; tries++) {
                await sleep(150);
                socket = await connectTo(address);
            }
            if (!socket) break;
        }
        const reply = await askServer(socket, request);
        if (reply?.restart) {
            request.note = `the warm server was started again: ${reply.restart}`;
            await sleep(300);
            continue;
        }
        if (!reply) break;
        if (reply.output) console.log(reply.output);
        return reply.code;
    }
    console.log("! the warm server gave no answer: this run is without it");
    return spawnSync(process.execPath, [ OWN_FILE, ...argv.filter(argument => argument !== "--warm") ], { stdio: "inherit" }).status ?? 1;
}

/** `--warm-stop`: ends the warm server of this workspace, when there is one. */
async function stopWarm(argv) {
    const { root } = workspaceRoot(parseArgs(argv).flags.root);
    const socket = await connectTo(warmAddress(root));
    if (socket) await askServer(socket, { stop: true });
    console.log(socket ? `the warm server of ${root} was stopped` : `no warm server is running for ${root}`);
    return 0;
}

/**
 * A big project does not fit into Node's default heap (about 4 GB): refs and rename run in a child process with a larger
 * one. Returns true when the child was started; it gets the same arguments, the same streams and the signals sent here.
 */
function rerunWithLargerHeap(argv) {
    const wanted = heapForChild();
    if (process.env.LS_FACTS_HEAP || ![ "refs", "rename" ].includes(commandOf(argv)) || v8.getHeapStatistics().heap_size_limit / 2 ** 20 >= wanted - 256) return false;
    const child = spawn(process.execPath, [ `--max-old-space-size=${wanted}`, ...process.execArgv, OWN_FILE, ...argv ], { stdio: "inherit", env: { ...process.env, LS_FACTS_HEAP: String(wanted) } });
    for (const signal of [ "SIGINT", "SIGTERM", "SIGHUP" ]) process.on(signal, () => child.kill(signal));
    child.on("error", error => {
        console.log(`ls-facts could not start node again with a larger heap: ${error.message}`);
        process.exit(1);
    });
    child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
    return true;
}

const invokedDirectly = () => {
    try {
        return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(OWN_FILE);
    } catch {
        return false;
    }
};
if (invokedDirectly()) {
    const argv = process.argv.slice(2);
    const finish = code => {
        process.exitCode = code;
        // Nothing of the language service may keep the process alive once the answer is printed.
        setTimeout(() => process.exit(), 1500).unref();
    };
    // A wrong name or a missing file is an answer, not a crash: one message on the standard output, exit code 1.
    const fail = error => {
        console.log(error instanceof UsageError ? error.message : `ls-facts failed: ${error?.stack ?? error}`);
        finish(1);
    };
    const asksService = [ "refs", "rename" ].includes(commandOf(argv)) && !argv.includes("--help") && !argv.includes("-h");
    try {
        if (argv.includes("--serve")) serveWarm(argv);
        else if (argv.includes("--warm-stop")) stopWarm(argv).then(finish, fail);
        else if (argv.includes("--warm") && asksService) warmClient(argv).then(finish, fail);
        else if (!rerunWithLargerHeap(argv)) finish(runCommand(argv));
    } catch (error) {
        fail(error);
    }
}
