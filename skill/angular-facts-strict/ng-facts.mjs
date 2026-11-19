#!/usr/bin/env node
// ng-facts — facts about the templates of an Angular workspace, and two codemods, computed with the Angular compiler's own
// template parser and the TypeScript parser. No type checker and no LLM: it answers in seconds and reads code that does not compile.
//   node ng-facts.mjs usages <selector|Class> [--all]                   every element of a component or directive, by input and folder
//   node ng-facts.mjs usages <Class>.<input|output> [--all]             every binding of one input or output, on the class and on
//                                                                       the classes that extend it
//   node ng-facts.mjs where <selector|Class> [--all]                    who renders it, and which routes and states can show it
//   node ng-facts.mjs unrouted [--all]                                  components nothing on screen leads to (dead code candidates)
//   node ng-facts.mjs rename-input <Class>.<old> <new> [--negate] [--write]
//   node ng-facts.mjs migrate <spec.json | '{…}'> [--write]             an API change described as data (migrate --help prints the format)
//   node ng-facts.mjs check [--project <tsconfig>]                      the compiler's verdict (ngc, no emit) in a few lines
//   node ng-facts.mjs --help
// Options: --root <dir> (default "."): the folder that holds angular.json or the tsconfig. Nothing is written without --write.
// Exit code: 0 answered; 1 a wrong name, a wrong option or a missing package; 2 the answer says the work is not finished
// (compiler errors, places that need a decision after --write).
// Packages (typescript, @angular/compiler, and @angular/compiler-cli for check) are taken from the node_modules of --root,
// walking up, and then from the folder of this file, so the script may live outside the workspace.
// Sources are the sourceRoot of every project in angular.json (every source under --root when there is no angular.json);
// spec and story files are read too and marked. Tests: node test/parser.test.mjs (it builds its own tiny workspace).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELP = `ng-facts — facts about the templates of an Angular workspace from the Angular compiler's template parser (no text search).
  usages <selector|Class> [--all]           every element of a component or directive with file:line, counted by input, by
                                            output and by folder; the classes that extend it are named
  usages <Class>.<input|output> [--all]     every binding of one input or output: bound, plain attribute, two-way, event; on
                                            the class, on classes that extend it (named per element) and through hostDirectives
  where <selector|Class> [--all]            who renders it (directly and through others), which routes and ui-router states can
                                            show it, whether AngularJS enters it (downgradeComponent), who names it in code
  unrouted [--all]                          components no route, state, bootstrap or downgrade leads to: dead code candidates
  rename-input <Class>.<old> <new> [--negate] [--write]
                                            renames an input (or output): the declaration, the reads in the class and its
                                            template, every binding on the class and on classes that extend it
  migrate <spec.json | '{…}'> [--write]     applies an API change described as data; migrate --help prints the format
  check [--project <tsconfig>] [--all]      runs the compiler (ngc, no emit) and prints its errors counted by code, with the
                                            first places of each; --all lists every place as file:line:column
Options: --root <dir> (default "."; the folder with angular.json or the tsconfig), --all (every line, not the first few),
--write (apply; without it every changing command is a dry run), --help.
<Class> is a class name; when two files declare a class of that name write <file>#<Class> (a path below --root).
It reads: @Component/@Directive classes (also in spec and story files, marked as such), signal inputs (input, input.required,
model), @Input/@Output with aliases and setters, inputs:/outputs: in the decorator, hostDirectives, inline and external templates,
route arrays (component, loadComponent, children, loadChildren across files) and ui-router states (component, views).
It does NOT see: TypeScript that reads a member through another object (viewChild, a template reference: ref.name()), names in
strings and style sheets, AngularJS templates, components created by a name built at run time. For those: ls-facts (types),
leftovers (text), ajs-facts (AngularJS). Lines that start with "!" say what it could not read: read them.
Exit code: 0 answered; 1 wrong name, option or missing package; 2 not finished (compiler errors, decisions left after --write).`;
const USAGE = "usage: ng-facts usages <selector|Class>[.<input|output>] [--all] | where <selector|Class> [--all] | unrouted [--all] | check [--project <tsconfig>] | rename-input <Class>.<old> <new> [--negate] [--write] | migrate <spec.json> [--write] | --help   [--root <dir>]";

const OWN_FOLDER = path.dirname(fileURLToPath(import.meta.url));
const SHOWN = 10;
const SKIPPED_FOLDERS = new Set([ "node_modules", "bower_components", "dist", "out-tsc", "coverage" ]);
const WORKSPACE_MARKERS = [ "angular.json", "tsconfig.json", "tsconfig.app.json", "tsconfig.base.json", "nx.json", "project.json" ];
const DECORATORS = new Set([ "Component", "Directive" ]);
const TEST_FILE = /\.(spec|test)\.ts$/;
const STORY_FILE = /\.stories\.ts$/;
/** Files worth a full parse for the classes: a decorated class or a class that extends another. The rest is parsed only on demand. */
const HOLDS_CLASSES = /@(?:Component|Directive)\s*\(|\bclass\b[^{;]*\bextends\b/;
const HOLDS_ROUTES = /\b(?:component|loadComponent|loadChildren|children|views)\s*:|bootstrapApplication|bootstrapModule|\bbootstrap\s*[:(]|downgradeComponent/;

/** A wrong name, a wrong option, a missing package: exit code 1, message only. */
class Problem extends Error {}

// The two parsers. They are loaded in loadPackages, from the workspace first: the script must not import a package statically.
let ts;
let ng;

const slash = file => file.split(path.sep).join("/");
const isDirectory = directory => statSync(directory, { throwIfNoEntry: false })?.isDirectory() ?? false;
const isA = (value, type) => typeof type === "function" && value instanceof type;
const plural = (count, word, ending = "s") => `${count} ${word}${count === 1 ? "" : ending}`;
const compact = (text, limit = 90) => {
    const single = String(text).replace(/\s+/g, " ").trim();
    return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
};
/** A path the reader can paste in any shell from any folder: absolute, forward slashes, in double quotes. */
const pasteable = file => `"${slash(path.resolve(file))}"`;

// ---------------------------------------------------------------------------------------------------------------------
// Packages and the workspace.

/** The file `name` resolves to from the workspace (walking up) or from this script's folder, and which of the two it was. */
function resolvePackage(name, root) {
    for (const from of [ root, OWN_FOLDER ]) {
        try {
            return { file: createRequire(path.join(from, "package.json")).resolve(name), from };
        } catch {
            // not here: try the next place
        }
    }
    return undefined;
}

/** What to do about a --root that is not the app's folder: doctor looks further down than this script and prints the folder to pass. */
const doctorHint = root => (existsSync(path.join(OWN_FOLDER, "doctor.mjs")) ? `\nNot the folder of the app? node "${slash(path.join(OWN_FOLDER, "doctor.mjs"))}" --root "${slash(path.resolve(root))}" finds it and prints the folder to pass as --root.` : "");

export async function loadPackages(root) {
    const found = { typescript: resolvePackage("typescript", root), "@angular/compiler": resolvePackage("@angular/compiler", root) };
    const missing = Object.keys(found).filter(name => !found[name]);
    if (missing.length) {
        throw new Problem(`cannot find ${missing.join(" and ")}: not in the node_modules of ${slash(root)} (or of a folder above it) and not in ${slash(OWN_FOLDER)}.\n`
            + `Install the packages of the workspace (npm ci there), or put them next to this script:\n  npm install --prefix "${slash(OWN_FOLDER)}" --no-save ${missing.join(" ")}${existsSync(path.join(root, "angular.json")) ? "" : doctorHint(root)}`);
    }
    ts = createRequire(import.meta.url)(found.typescript.file);
    ng = await import(pathToFileURL(found["@angular/compiler"].file).href);
    return found;
}

const readJson = file => ts.parseConfigFileTextToJson(file, readFileSync(file, "utf8")).config;

/**
 * The workspace a command is about: the folder with angular.json or a tsconfig. A --root that has neither but exactly one
 * child folder that does is replaced by that folder, and a note says so. Source folders come from the sourceRoot of every
 * project in angular.json; without angular.json every source under the workspace is read.
 */
export function locateRoot(rootArgument) {
    const asked = path.resolve(rootArgument);
    if (!isDirectory(asked)) throw new Problem(`--root ${rootArgument}: no such directory${String(rootArgument).includes("\"") ? " (a \" is part of the name: in PowerShell drop the backslash before the closing quote)" : ""}`);
    const marked = directory => WORKSPACE_MARKERS.some(name => existsSync(path.join(directory, name)));
    const notes = [];
    let root = asked;
    if (!marked(asked)) {
        const children = readdirSync(asked, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_FOLDERS.has(entry.name) && marked(path.join(asked, entry.name)));
        if (children.length === 1) {
            root = path.join(asked, children[0].name);
            notes.push(`${slash(asked)} holds no angular.json or tsconfig; its only folder that does is ${children[0].name}: that folder is used as the workspace`);
        } else if (children.length > 1) {
            throw new Problem(`--root ${rootArgument} holds no angular.json or tsconfig and ${children.length} of its folders do (${children.map(entry => entry.name).join(", ")}): name one of them with --root`);
        } else if (existsSync(path.join(asked, "package.json")) || isDirectory(path.join(asked, "src"))) {
            notes.push("no angular.json or tsconfig in the root: every source file under it is read");
        } else {
            throw new Problem(`--root ${rootArgument} holds no angular.json, no tsconfig and no src folder: point --root at the folder of the Angular workspace${doctorHint(rootArgument)}`);
        }
    }
    return { root, notes };
}

/** The located root with its source folders and the tsconfig its build uses (both from angular.json when there is one). */
export function findWorkspace(rootArgument) {
    const { root, notes } = locateRoot(rootArgument);
    const sourceRoots = [];
    let buildConfig;
    const angularJson = path.join(root, "angular.json");
    if (existsSync(angularJson)) {
        for (const project of Object.values(readJson(angularJson)?.projects ?? {})) {
            const folder = typeof project === "string" ? project : project?.root ?? "";
            const sourceRoot = path.resolve(root, typeof project === "object" && project?.sourceRoot ? project.sourceRoot : path.join(folder, "src"));
            if (isDirectory(sourceRoot)) sourceRoots.push(sourceRoot);
            else if (folder && isDirectory(path.resolve(root, folder))) sourceRoots.push(path.resolve(root, folder));
            const targets = typeof project === "object" ? project?.architect ?? project?.targets : undefined;
            buildConfig ??= targets?.build?.options?.tsConfig;
        }
    }
    const outermost = [ ...new Set(sourceRoots) ].filter((folder, _index, all) => !all.some(other => other !== folder && folder.startsWith(other + path.sep)));
    return { root, notes, sourceRoots: outermost.length ? outermost : [ root ], buildConfig };
}

/** baseUrl and paths of the workspace's tsconfig, to follow `import … from "src/app/x"` in route files. */
function pathMapping(root) {
    for (const name of [ "tsconfig.json", "tsconfig.base.json", "tsconfig.app.json" ]) {
        const file = path.join(root, name);
        if (!existsSync(file)) continue;
        try {
            const { options } = ts.parseJsonConfigFileContent(ts.readConfigFile(file, ts.sys.readFile).config ?? {}, { ...ts.sys, readDirectory: () => [] }, root, undefined, file);
            if (options.paths || options.baseUrl) return { paths: options.paths ?? {}, base: options.baseUrl ?? options.pathsBasePath ?? root };
        } catch {
            // a tsconfig that cannot be read maps nothing
        }
    }
    return { paths: {}, base: root };
}

function listSources(directory, found = []) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_FOLDERS.has(entry.name) && !entry.name.startsWith(".")) listSources(full, found);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) found.push(full);
    }
    return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// TypeScript side: classes, their decorator, inputs and outputs, read without running anything.

function unwrap(node) {
    let current = node;
    while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression?.(current))) current = current.expression;
    return current;
}

const textOfName = name => name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : undefined;
const stringOf = node => node && ts.isStringLiteralLike(node) ? node.text : undefined;
const decoratorsOf = node => (ts.canHaveDecorators?.(node) ? ts.getDecorators(node) : node.decorators) ?? [];

/** The value of `name` in an object literal: the initializer, or the identifier of a shorthand property. */
function propertyOf(object, name) {
    for (const property of object.properties) {
        if (textOfName(property.name) !== name) continue;
        if (ts.isPropertyAssignment(property)) return property.initializer;
        if (ts.isShorthandPropertyAssignment(property)) return property.name;
    }
    return undefined;
}

function decoratorCall(node, names = DECORATORS) {
    for (const decorator of decoratorsOf(node)) {
        const call = decorator.expression;
        if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && names.has(call.expression.text)) return call;
    }
    return undefined;
}

/** `X` for `X` and for `forwardRef(() => X)`. */
function classReference(node) {
    const value = node && unwrap(node);
    if (!value) return undefined;
    if (ts.isIdentifier(value)) return value.text;
    if (ts.isPropertyAccessExpression(value)) return value.name.text;
    if (ts.isCallExpression(value) && value.arguments[0] && (ts.isArrowFunction(value.arguments[0]) || ts.isFunctionExpression(value.arguments[0]))) {
        const body = value.arguments[0].body;
        return ts.isBlock(body) ? undefined : classReference(body);
    }
    return undefined;
}

/** One entry of `inputs: [ … ]` / `outputs: [ … ]`: "name", "name: alias" or { name, alias }. `node` is the string that holds the name. */
function exposedName(element) {
    const value = unwrap(element);
    if (ts.isStringLiteralLike(value)) {
        const [ name, alias ] = value.text.split(":").map(part => part.trim());
        return name ? { name, alias: alias || undefined, node: value } : undefined;
    }
    if (ts.isObjectLiteralExpression(value)) {
        const name = propertyOf(value, "name");
        const alias = propertyOf(value, "alias");
        return stringOf(name) ? { name: name.text, alias: stringOf(alias), node: name } : undefined;
    }
    return undefined;
}

const exposedList = (object, key) => {
    const list = object && propertyOf(object, key);
    return list && ts.isArrayLiteralExpression(unwrap(list)) ? unwrap(list).elements.map(exposedName).filter(Boolean) : [];
};

/** Inputs and outputs a class declares itself: signal functions, decorators on members, and the decorator's inputs:/outputs: lists. */
function membersOf(classNode, metadata) {
    const inputs = [];
    const outputs = [];
    const add = (list, entry) => {
        if (!list.some(existing => existing.name === entry.name)) list.push(entry);
    };
    for (const member of classNode.members) {
        const name = textOfName(member.name);
        if (name === undefined) continue;
        for (const decorator of decoratorsOf(member)) {
            const call = decorator.expression;
            if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || (call.expression.text !== "Input" && call.expression.text !== "Output")) continue;
            const argument = call.arguments[0] && unwrap(call.arguments[0]);
            const aliasNode = argument && ts.isStringLiteralLike(argument) ? argument : argument && ts.isObjectLiteralExpression(argument) && stringOf(propertyOf(argument, "alias")) !== undefined ? propertyOf(argument, "alias") : undefined;
            add(call.expression.text === "Input" ? inputs : outputs, { name, bindingName: aliasNode?.text ?? name, kind: "decorator", aliasNode });
        }
        const call = ts.isPropertyDeclaration(member) && member.initializer ? unwrap(member.initializer) : undefined;
        if (!call || !ts.isCallExpression(call)) continue;
        const callee = call.expression;
        const factory = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : "";
        const required = ts.isPropertyAccessExpression(callee) && callee.name.text === "required";
        const aliasIn = options => {
            const value = options && unwrap(options);
            const alias = value && ts.isObjectLiteralExpression(value) ? propertyOf(value, "alias") : undefined;
            return stringOf(alias) !== undefined ? alias : undefined;
        };
        if (factory === "input" || factory === "model") {
            const aliasNode = aliasIn(required ? call.arguments[0] : call.arguments[1]);
            const bindingName = aliasNode?.text ?? name;
            add(inputs, { name, bindingName, kind: factory === "model" ? "model" : "signal", aliasNode, call });
            if (factory === "model") add(outputs, { name: `${name}Change`, bindingName: `${bindingName}Change`, kind: "model", implicit: true });
        } else if (factory === "output" || factory === "outputFromObservable") {
            const aliasNode = aliasIn(factory === "output" ? call.arguments[0] : call.arguments[1]);
            add(outputs, { name, bindingName: aliasNode?.text ?? name, kind: "signal", aliasNode });
        }
    }
    for (const [ key, list ] of [ [ "inputs", inputs ], [ "outputs", outputs ] ]) {
        for (const exposed of exposedList(metadata, key)) add(list, { name: exposed.name, bindingName: exposed.alias ?? exposed.name, kind: "metadata", listNode: exposed.node });
    }
    return { inputs, outputs };
}

/**
 * The text a literal with backslashes stands for, and for every character of it the place in the written literal:
 * `"<a href=\"x\">"` is the template `<a href="x">`, and an edit has to land on the written characters.
 */
function unescapeLiteral(written) {
    const SIMPLE = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
    let text = "";
    const positions = [];
    for (let index = 0; index < written.length;) {
        const start = index;
        let character = written[index++];
        if (character === "\\" && index < written.length) {
            const next = written[index++];
            if (next === "\r" || next === "\n") {
                if (next === "\r" && written[index] === "\n") index++;
                continue;
            }
            const hex = next === "x" ? /^[0-9a-fA-F]{2}/.exec(written.slice(index)) : next === "u" ? /^(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/.exec(written.slice(index)) : null;
            if (hex) {
                character = String.fromCodePoint(parseInt(hex[0].replace(/[{}]/g, ""), 16));
                index += hex[0].length;
            } else character = SIMPLE[next] ?? next;
        }
        for (let unit = 0; unit < character.length; unit++) positions.push(start);
        text += character;
    }
    positions.push(written.length);
    return { text, positions };
}

/** `template: "…"` as text with its offset in the file; the `${…}` parts of a template literal are blanked, not guessed. */
function inlineTemplateSource(value, fileInfo) {
    const sourceFile = fileInfo.sourceFile;
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
        const offset = value.getStart(sourceFile) + 1;
        const written = fileInfo.text.slice(offset, value.getEnd() - 1);
        if (!written.includes("\\")) return { offset, text: written, blanked: 0 };
        return { offset, ...unescapeLiteral(written), quote: fileInfo.text[offset - 1], blanked: 0 };
    }
    if (!ts.isTemplateExpression(value)) return undefined;
    const offset = value.getStart(sourceFile) + 1;
    let text = fileInfo.text.slice(offset, value.getEnd() - 1);
    let previousEnd = value.head.getEnd();
    for (const span of value.templateSpans) {
        const from = previousEnd - 2 - offset;
        const to = span.literal.getStart(sourceFile) + 1 - offset;
        text = text.slice(0, from) + text.slice(from, to).replace(/[^\n\r]/g, " ") + text.slice(to);
        previousEnd = span.literal.getEnd();
    }
    return { offset, text, blanked: value.templateSpans.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// The workspace index: every class, every template, the selector matcher.

/**
 * Reads the workspace. `classes` holds every class of the parsed files by name (decorated or not: a base class counts);
 * `declarations` the @Component/@Directive classes; `templates` every template once, with the classes that own it.
 * Spec and story files are read too and marked (kind "test" / "story"): their templates bind inputs like any other.
 */
export function loadWorkspace(rootArgument) {
    const started = performance.now();
    const { root, notes, sourceRoots, buildConfig } = findWorkspace(rootArgument);
    const relative = file => slash(path.relative(root, file));
    const files = new Map();
    for (const sourceRoot of sourceRoots) {
        for (const file of listSources(sourceRoot)) {
            files.set(file, { file, shown: relative(file), text: readFileSync(file, "utf8"), kind: TEST_FILE.test(file) ? "test" : STORY_FILE.test(file) ? "story" : "app" });
        }
    }
    const workspace = {
        root, notes, sourceRoots, buildConfig, files, relative, started,
        classes: new Map(), declarations: [], templates: new Map(), unread: [], textCache: new Map(), lineCache: new Map()
    };
    workspace.textOf = file => {
        if (!workspace.textCache.has(file)) workspace.textCache.set(file, files.get(file)?.text ?? readFileSync(file, "utf8"));
        return workspace.textCache.get(file);
    };
    workspace.lineOf = (file, offset) => {
        let starts = workspace.lineCache.get(file);
        if (!starts) {
            const text = workspace.textOf(file);
            starts = [ 0 ];
            for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
            workspace.lineCache.set(file, starts);
        }
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= offset) low = middle;
            else high = middle - 1;
        }
        return low + 1;
    };
    workspace.parse = fileInfo => {
        fileInfo.sourceFile ??= ts.createSourceFile(fileInfo.file, fileInfo.text, ts.ScriptTarget.Latest, true);
        return fileInfo.sourceFile;
    };

    const read = new Set();
    const readClasses = fileInfo => {
        if (read.has(fileInfo)) return;
        read.add(fileInfo);
        const sourceFile = workspace.parse(fileInfo);
        sourceFile.forEachChild(function visit(node) {
            if (ts.isClassDeclaration(node) && node.name) readClass(workspace, node, fileInfo);
            else if (fileInfo.kind !== "app" && ts.isPropertyAssignment(node) && textOfName(node.name) === "template" && !insideDecorator(node)) {
                // a story's render function or a test's override: `template: "<my-thing …>"` outside any decorator
                const source = inlineTemplateSource(unwrap(node.initializer), fileInfo);
                if (source && source.text.includes("<")) addTemplate(workspace, { ...source, file: fileInfo.file, inline: true, kind: fileInfo.kind }, undefined);
            }
            node.forEachChild(visit);
        });
    };
    for (const fileInfo of files.values()) {
        if (HOLDS_CLASSES.test(fileInfo.text) || (fileInfo.kind !== "app" && fileInfo.text.includes("template"))) readClasses(fileInfo);
    }
    // A base class in a file that has no decorator and no "extends" was not parsed yet: find it by name, a few rounds deep.
    for (let round = 0; round < 6; round++) {
        const wanted = new Set();
        for (const list of workspace.classes.values()) for (const found of list) if (found.baseName && !workspace.classes.has(found.baseName)) wanted.add(found.baseName);
        if (!wanted.size) break;
        const pattern = new RegExp(`\\bclass\\s+(?:${[ ...wanted ].map(name => name.replace(/\$/g, "\\$")).join("|")})\\b`);
        const before = read.size;
        for (const fileInfo of files.values()) if (!read.has(fileInfo) && pattern.test(fileInfo.text)) readClasses(fileInfo);
        if (read.size === before) break;
    }

    workspace.files = files;
    workspace.matcher = new ng.SelectorMatcher();
    const unparsable = [];
    for (const declaration of workspace.declarations) {
        // a test's stand-in with the selector of the real component must not answer for it
        if (!declaration.selector || declaration.kind !== "app") continue;
        try {
            workspace.matcher.addSelectables(ng.CssSelector.parse(declaration.selector), declaration);
        } catch {
            unparsable.push(`${declaration.className} "${declaration.selector}"`);
        }
    }
    if (unparsable.length) notes.push(`${plural(unparsable.length, "selector")} could not be parsed, so no element matches them: ${unparsable.slice(0, 3).join(", ")}`);
    return workspace;
}

function insideDecorator(node) {
    for (let parent = node.parent; parent; parent = parent.parent) if (ts.isDecorator(parent)) return true;
    return false;
}

function readClass(workspace, node, fileInfo) {
    const call = decoratorCall(node);
    const metadata = call?.arguments[0] && ts.isObjectLiteralExpression(unwrap(call.arguments[0])) ? unwrap(call.arguments[0]) : undefined;
    const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
    const base = heritage && unwrap(heritage);
    const found = {
        className: node.name.text,
        file: fileInfo.file,
        fileInfo,
        kind: fileInfo.kind,
        classNode: node,
        decorator: call?.expression.text,
        baseName: base && ts.isIdentifier(base) ? base.text : base && ts.isPropertyAccessExpression(base) ? base.name.text : undefined,
        baseUnread: base && !ts.isIdentifier(base) && !ts.isPropertyAccessExpression(base) ? compact(base.getText(fileInfo.sourceFile), 60) : undefined,
        selector: metadata ? stringOf(propertyOf(metadata, "selector") && unwrap(propertyOf(metadata, "selector"))) : undefined,
        exportAs: metadata ? (stringOf(propertyOf(metadata, "exportAs") && unwrap(propertyOf(metadata, "exportAs"))) ?? "").split(",").map(name => name.trim()).filter(Boolean) : [],
        ...membersOf(node, metadata),
        hostDirectives: [],
        template: undefined
    };
    if (metadata) {
        const hosts = propertyOf(metadata, "hostDirectives");
        if (hosts && ts.isArrayLiteralExpression(unwrap(hosts))) {
            for (const element of unwrap(hosts).elements) {
                const value = unwrap(element);
                const object = ts.isObjectLiteralExpression(value) ? value : undefined;
                const className = classReference(object ? propertyOf(object, "directive") : value);
                if (className) found.hostDirectives.push({ className, inputs: exposedList(object, "inputs"), outputs: exposedList(object, "outputs") });
            }
        }
        const where = `${fileInfo.shown}:${workspace.lineOf(fileInfo.file, node.getStart(fileInfo.sourceFile))}`;
        const inline = propertyOf(metadata, "template");
        const url = propertyOf(metadata, "templateUrl");
        if (inline) {
            const source = inlineTemplateSource(unwrap(inline), fileInfo);
            if (source) found.template = addTemplate(workspace, { ...source, file: fileInfo.file, inline: true, kind: fileInfo.kind }, found);
            else workspace.unread.push(`${where} template of ${found.className} is not a string literal (${compact(unwrap(inline).getText(fileInfo.sourceFile), 40)})`);
        } else if (url) {
            const templateFile = stringOf(unwrap(url)) !== undefined ? path.resolve(path.dirname(fileInfo.file), unwrap(url).text) : undefined;
            if (!templateFile) workspace.unread.push(`${where} templateUrl of ${found.className} is not a string literal`);
            else if (!existsSync(templateFile)) workspace.unread.push(`${where} templateUrl of ${found.className} names a file that does not exist (${unwrap(url).text})`);
            else found.template = addTemplate(workspace, { file: templateFile, offset: 0, inline: false, kind: fileInfo.kind, blanked: 0 }, found);
        }
        if (call && propertyOf(metadata, "selector") && found.selector === undefined) workspace.notes.push(`${where} selector of ${found.className} is not a string literal: no element is matched to it`);
        workspace.declarations.push(found);
    } else if (call) {
        workspace.declarations.push(found);
    }
    workspace.classes.set(found.className, [ ...(workspace.classes.get(found.className) ?? []), found ]);
}

/** Registers a template once per place (a templateUrl shared by two classes is one template with two owners) and parses it. */
function addTemplate(workspace, source, owner) {
    const key = `${source.file}#${source.offset}`;
    let template = workspace.templates.get(key);
    if (!template) {
        const text = source.inline ? source.text : readFileSync(source.file, "utf8");
        if (!source.inline) workspace.textCache.set(source.file, text);
        template = { ...source, text, owners: [], nodes: [], errors: [] };
        try {
            const parsed = ng.parseTemplate(text, source.file, { preserveWhitespaces: true, alwaysAttemptHtmlToR3AstConversion: true });
            template.nodes = parsed.nodes;
            template.errors = (parsed.errors ?? []).map(error => ({ message: compact(error.msg ?? String(error), 80), offset: error.span?.start?.offset ?? 0 }));
        } catch (error) {
            template.errors = [ { message: compact(error.message, 80), offset: 0 } ];
        }
        workspace.templates.set(key, template);
    }
    if (owner) template.owners.push(owner);
    return template;
}

const withoutNamespace = name => name.replace(/^:[^:]*:/, "");
const isStructural = node => isA(node, ng.TmplAstTemplate) && node.tagName !== "ng-template" && node.tagName != null;
const shownName = node => isA(node, ng.TmplAstTemplate) ? (isStructural(node) ? `${withoutNamespace(node.tagName)} *` : "ng-template") : withoutNamespace(node.name);

/** The selector an element is matched with, built the way the Angular compiler builds it (createCssSelectorFromNode). */
function selectorFor(node) {
    const selector = new ng.CssSelector();
    selector.setElement(isA(node, ng.TmplAstTemplate) ? "ng-template" : withoutNamespace(node.name));
    const add = (name, value) => {
        const plain = withoutNamespace(name);
        selector.addAttribute(plain, value);
        if (plain.toLowerCase() === "class") for (const className of value.trim().split(/\s+/)) if (className) selector.addClassName(className);
    };
    if (isStructural(node)) {
        for (const attribute of node.templateAttrs) add(attribute.name, "");
        return selector;
    }
    for (const attribute of node.attributes) add(attribute.name, attribute.value ?? "");
    for (const input of node.inputs) if (input.type === ng.BindingType.Property || input.type === ng.BindingType.TwoWay) add(input.name, "");
    for (const output of node.outputs) add(output.name, "");
    return selector;
}

/**
 * Everything of one template the commands ask about, found by one walk over the parser's nodes: the elements (and ng-templates)
 * with the classes their selector matches, every expression, and the names the template declares itself (#ref, let-x, @let, @for).
 */
function scan(workspace, template) {
    if (template.scanned) return template.scanned;
    const elements = [];
    const expressions = [];
    const references = [];
    const locals = new Set();
    const seen = new Set();
    const visit = value => {
        if (!value || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (isA(value, ng.AST)) {
            expressions.push(value);
            return;
        }
        if (isA(value, ng.TmplAstElement) || isA(value, ng.TmplAstTemplate)) {
            const matched = [];
            workspace.matcher.match(selectorFor(value), (_selector, declaration) => {
                if (!matched.includes(declaration)) matched.push(declaration);
            });
            elements.push({ node: value, matched });
            for (const reference of value.references ?? []) references.push({ name: reference.name, value: reference.value ?? "", matched });
        }
        if (isA(value, ng.TmplAstVariable) || isA(value, ng.TmplAstReference) || isA(value, ng.TmplAstLetDeclaration)) locals.add(value.name);
        for (const [ key, child ] of Object.entries(value)) if (key !== "i18n" && !key.endsWith("Span")) visit(child);
    };
    visit(template.nodes);
    template.scanned = { elements, expressions, references, locals };
    return template.scanned;
}

/** What could not be read, as lines that start with "!": never silently skipped. */
function readingNotes(workspace, all) {
    const lines = workspace.notes.map(note => `! ${note}`);
    const broken = [ ...workspace.templates.values() ].filter(template => template.errors.length);
    const list = (title, entries) => {
        if (!entries.length) return;
        if (all) lines.push(`! ${title}:`, ...entries.map(entry => `!   ${entry}`));
        else lines.push(`! ${title}: ${entries[0]}${entries.length > 1 ? ` … +${entries.length - 1} more (--all names every one)` : ""}`);
    };
    const inTests = broken.filter(template => template.kind !== "app").length;
    list(`${plural(broken.length, "template")} with parse errors${inTests ? ` (${inTests} in tests and stories)` : ""}, only the part the parser could read is counted`, broken.map(template => `${workspace.relative(template.file)}:${workspace.lineOf(template.file, absolute(template, Math.min(template.errors[0].offset, template.text.length)))} ${template.errors[0].message}${template.errors.length > 1 ? ` (+${template.errors.length - 1} more)` : ""}`).sort((left, right) => Number(/\.(spec|test|stories)\.ts:/.test(left)) - Number(/\.(spec|test|stories)\.ts:/.test(right))));
    list(`${plural(workspace.unread.length, "template")} not read at all`, workspace.unread);
    const blanked = [ ...workspace.templates.values() ].filter(template => template.blanked);
    if (blanked.length) lines.push(`! ${plural(blanked.length, "inline template")} built with \${…}: the fixed text is read, the inserted parts are not (${workspace.relative(blanked[0].file)}${blanked.length > 1 ? ", …" : ""})`);
    return lines;
}

const statsOf = workspace => `${Math.round(performance.now() - workspace.started)} ms; ${workspace.declarations.length} components and directives, ${workspace.templates.size} templates`;

/** The class the user named: a class name, a selector as written, or the element or attribute name of a selector. */
export function findDeclaration(workspace, asked) {
    // "<file>#<Class>": the class of that name declared in that file (a path below the workspace, or the end of one)
    const hash = asked.lastIndexOf("#");
    const name = hash > 0 ? asked.slice(hash + 1) : asked;
    const inFile = hash > 0 ? slash(asked.slice(0, hash)).replace(/^\.\//, "") : null;
    if (inFile !== null) {
        const there = (workspace.classes.get(name) ?? []).filter(candidate => `/${workspace.relative(candidate.file)}`.endsWith(`/${inFile}`));
        if (there.length === 1) return there[0];
        throw new Problem(`no class "${name}" in a file "${inFile}" (${(workspace.classes.get(name) ?? []).map(candidate => workspace.relative(candidate.file)).join(", ") || "no class of that name"}). Write <file>#<Class> with a path below ${slash(workspace.root)}.`);
    }
    const named = workspace.classes.get(name) ?? [];
    const bySelector = workspace.declarations.filter(declaration => declaration.selector && (declaration.selector === name || declaration.selector.split(",").some(part => part.trim() === name || part.trim() === `[${name}]`)));
    const found = [ ...named, ...bySelector.filter(declaration => !named.includes(declaration)) ].sort((left, right) => Number(right.kind === "app") - Number(left.kind === "app") || Number(Boolean(right.decorator)) - Number(Boolean(left.decorator)));
    if (!found.length && named.length === 0 && [ ...(workspace.files?.values() ?? []) ].some(fileInfo => fileInfo.text.includes(`class ${name}`) && new RegExp(`\\bclass\\s+${name.replace(/\$/g, "\\$")}\\b`).test(fileInfo.text))) {
        const refs = existsSync(path.join(OWN_FOLDER, "ls-facts.mjs")) ? `node ${pasteable(path.join(OWN_FOLDER, "ls-facts.mjs"))} refs ${name} --root ${pasteable(workspace.root)}` : `git -C ${pasteable(workspace.root)} grep -n -w ${name}`;
        throw new Problem(`${name} is a class of this workspace but no component or directive (a service?): this script answers for components and directives. For ${name}: ${refs}`);
    }
    if (!found.length) {
        const wanted = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        const close = workspace.declarations.filter(declaration => declaration.kind === "app" && (declaration.className.toLowerCase().includes(wanted) || (declaration.selector ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(wanted))).slice(0, 12);
        throw new Problem(`no component or directive "${name}" among ${workspace.declarations.length} in ${slash(workspace.root)}.${close.length ? ` Close names: ${close.map(declaration => `${declaration.className}${declaration.selector ? ` <${declaration.selector}>` : ""}`).join(", ")}.` : " Give a class name or a selector."}`);
    }
    // two classes of the app with this very name: a guess would answer for the wrong one, so the reader says which
    const sameNameInApp = named.filter(candidate => candidate.kind === "app");
    if (sameNameInApp.length > 1) throw new Problem(`${sameNameInApp.length} classes are named ${name}: say which one, as ${sameNameInApp.map(candidate => `${workspace.relative(candidate.file)}#${name}`).join(" or ")}`);
    if (found.length > 1) workspace.notes.push(`${found.length} classes answer to "${name}": ${found.map(candidate => `${candidate.className} (${workspace.relative(candidate.file)})`).join(", ")}; the first one is used. For another one write <file>#<Class>`);
    return found[0];
}

const titleOf = declaration => `${declaration.className}${declaration.selector ? ` <${declaration.selector}>` : ""}`;

/** The class a base name refers to: the one in the file the subclass imports it from when two classes share the name. */
function baseOf(workspace, found) {
    const candidates = found.baseName ? workspace.classes.get(found.baseName) ?? [] : [];
    if (candidates.length < 2) return candidates[0];
    const imported = new RegExp(`import[^;]*\\b${found.baseName}\\b[^;]*from\\s*["']([^"']+)["']`).exec(found.fileInfo.text)?.[1];
    const tail = imported?.replace(/^[./]+/, "").replace(/\.[jt]s$/, "");
    return (tail && candidates.find(candidate => slash(candidate.file).replace(/\.ts$/, "").endsWith(tail))) ?? candidates.find(candidate => candidate.file === found.file) ?? candidates[0];
}

/** The class and every class that extends it, directly or through others. */
function familyOf(workspace, root) {
    const family = new Set([ root ]);
    for (let grew = true; grew;) {
        grew = false;
        for (const list of workspace.classes.values()) {
            for (const candidate of list) {
                if (!family.has(candidate) && candidate.baseName && family.has(baseOf(workspace, candidate))) {
                    family.add(candidate);
                    grew = true;
                }
            }
        }
    }
    return family;
}

/** The input and/or output `name` of a class, looked up through what it extends: by member name or by binding name (alias). */
function memberOf(workspace, declaration, name) {
    for (let current = declaration, depth = 0; current && depth < 20; current = baseOf(workspace, current), depth++) {
        const input = current.inputs.find(candidate => candidate.name === name || candidate.bindingName === name);
        const output = current.outputs.find(candidate => candidate.name === name || candidate.bindingName === name);
        if (input || output) return { declaring: current, input, output };
    }
    return undefined;
}

/** Every input and output a class has, its own and the inherited ones (the nearest declaration of a name wins). */
function allMembers(workspace, declaration) {
    const inputs = new Map();
    const outputs = new Map();
    for (let current = declaration, depth = 0; current && depth < 20; current = baseOf(workspace, current), depth++) {
        for (const input of current.inputs) if (!inputs.has(input.bindingName)) inputs.set(input.bindingName, input);
        for (const output of current.outputs) if (!outputs.has(output.bindingName)) outputs.set(output.bindingName, output);
    }
    return { inputs, outputs };
}

/**
 * Where a binding name reaches a member: on the elements of the declaring class, of every class that extends it, and of every
 * component that exposes it through hostDirectives (under the exposed name). One carrier per class, with the reason.
 */
function carriersOf(workspace, declaring, bindingName, list) {
    const family = familyOf(workspace, declaring);
    const carriers = new Map();
    for (const member of family) carriers.set(member, { name: bindingName, why: member === declaring ? "" : `${member.className} extends ${declaring.className}` });
    const exposures = [];
    for (const host of workspace.declarations) {
        for (const hostDirective of host.hostDirectives) {
            const target = (workspace.classes.get(hostDirective.className) ?? []).find(candidate => family.has(candidate));
            const exposed = target && hostDirective[list].find(entry => entry.name === bindingName);
            if (!exposed) continue;
            exposures.push({ host, exposed });
            for (const member of familyOf(workspace, host)) if (!carriers.has(member)) carriers.set(member, { name: exposed.alias ?? exposed.name, why: `hostDirectives of ${host.className}`, exposed });
        }
    }
    return { family, carriers, exposures };
}

const isProperty = input => input.type === ng.BindingType.Property || input.type === ng.BindingType.TwoWay;

/** Bindings of an input name on one element: plain attribute, [bound], [(two-way)], or a key of a structural directive. */
function inputBindings(node, name) {
    if (isStructural(node)) return node.templateAttrs.filter(attribute => attribute.name === name).map(binding => ({ binding, form: "structural" }));
    return [
        ...node.attributes.filter(attribute => attribute.name === name).map(binding => ({ binding, form: "plain" })),
        ...node.inputs.filter(input => input.name === name && isProperty(input)).map(binding => ({ binding, form: binding.type === ng.BindingType.TwoWay ? "two-way" : "bound" }))
    ];
}

/** Bindings of an output name on one element: (event), or the [(two-way)] form that listens to <name>Change. */
function outputBindings(node, name) {
    if (isStructural(node)) return [];
    return node.outputs.filter(output => output.name === name).map(binding => ({ binding, form: binding.type === ng.ParsedEventType.TwoWay ? "two-way" : "event" }));
}

/** A place of the template's text as a place in its file (through the map of a literal that was written with backslashes). */
const absolute = (template, offset) => template.offset + (template.positions ? template.positions[offset] : offset);
/** Text that goes into a template: escaped again when the template is a literal that was written with backslashes. */
const asWritten = (template, text) => template.quote ? text.replace(/\\/g, "\\\\").replaceAll(template.quote, `\\${template.quote}`).replace(/\r?\n/g, "\\n") : text;

/**
 * Reads of a member through a template reference: `<my-thing #ref>` … `ref.name`. The reference is the component when the
 * element is one (or the directive named by #ref="exportAs"); a name that two elements of one template give to different
 * things is left out and returned as `unclear`.
 */
function referenceReads(workspace, family, memberName) {
    const reads = [];
    const unclear = [];
    for (const template of workspace.templates.values()) {
        const { references, expressions } = scan(workspace, template);
        if (!references.length) continue;
        const ours = reference => reference.matched.some(declaration => family.has(declaration) && (reference.value ? declaration.exportAs.includes(reference.value) : declaration.decorator === "Component"));
        const names = new Map();
        for (const reference of references) names.set(reference.name, [ ...(names.get(reference.name) ?? []), ours(reference) ]);
        if (![ ...names.values() ].some(list => list.includes(true))) continue;
        const parents = new Map();
        for (const expression of expressions) {
            walkExpression(expression, (node, parent) => {
                parents.set(node, parent);
                if (!(isA(node, ng.PropertyRead) || isA(node, ng.SafePropertyRead)) || node.name !== memberName) return;
                const receiver = node.receiver;
                if (!isA(receiver, ng.PropertyRead) || !isA(receiver.receiver, ng.ImplicitReceiver) || !names.get(receiver.name)?.includes(true)) return;
                const call = isA(parent, ng.Call) && parent.receiver === node ? parent : undefined;
                const entry = { template, node, call, not: call && isA(parents.get(call), ng.PrefixNot) ? parents.get(call) : undefined, reference: receiver.name };
                (names.get(receiver.name).includes(false) ? unclear : reads).push(entry);
            });
        }
    }
    return { reads, unclear };
}

const describeRead = (workspace, { template, node, reference }) => `${workspace.relative(template.file)}:${workspace.lineOf(template.file, absolute(template, node.nameSpan.start))}  ${reference}.${node.name}${template.kind === "app" ? "" : `  (${template.kind})`}`;

function valueOf(binding) {
    const value = binding.handler ?? binding.value;
    return compact(typeof value === "string" ? value : value?.source ?? "", 70);
}

function describe(workspace, entry) {
    const { template, node, binding, form } = entry;
    const offset = absolute(template, (binding?.keySpan ?? binding?.sourceSpan ?? node.startSourceSpan ?? node.sourceSpan).start.offset);
    const place = `${workspace.relative(template.file)}:${workspace.lineOf(template.file, offset)}`;
    const marks = `${template.kind === "app" ? "" : `  (${template.kind})`}${entry.why ? `  (${entry.why})` : ""}`;
    if (!binding) {
        const tag = node.startSourceSpan ?? node.sourceSpan;
        return `${place}  ${compact(template.text.slice(tag.start.offset, tag.end.offset), 110)}${marks}`;
    }
    const written = form === "plain" ? (binding.value ? `${binding.name}="${valueOf(binding)}"` : binding.name) : form === "bound" ? `[${binding.name}]="${valueOf(binding)}"` : form === "two-way" ? `[(${binding.name.replace(/Change$/, "")})]="${valueOf(binding)}"` : form === "event" ? `(${binding.name})="${valueOf(binding)}"` : `*… ${binding.name}`;
    return `${place}  <${shownName(node)}>  ${written}${marks}`;
}

/**
 * Bindings of one input or output in every template. `uses` are on elements that carry the member (the class, its subclasses,
 * hosts that expose it); `others` carry the same name on elements that match none of them.
 */
export function findBindings(workspace, declaring, member, list) {
    const { family, carriers, exposures } = carriersOf(workspace, declaring, member.bindingName, list);
    const uses = [];
    const others = [];
    const names = new Set([ ...carriers.values() ].map(carrier => carrier.name));
    const bindingsOf = list === "inputs" ? inputBindings : outputBindings;
    for (const template of workspace.templates.values()) {
        for (const { node, matched } of scan(workspace, template).elements) {
            const done = new Set();
            for (const declaration of matched) {
                const carrier = carriers.get(declaration);
                if (!carrier) continue;
                for (const found of bindingsOf(node, carrier.name)) {
                    if (done.has(found.binding)) continue;
                    done.add(found.binding);
                    uses.push({ template, node, ...found, carrier: declaration, why: carrier.why });
                }
            }
            if (matched.some(declaration => carriers.has(declaration))) continue;
            for (const name of names) for (const found of bindingsOf(node, name)) others.push({ template, node, ...found });
        }
    }
    return { family, carriers, exposures, uses, others };
}

function countBy(entries, keyOf) {
    const counts = new Map();
    for (const entry of entries) counts.set(keyOf(entry), (counts.get(keyOf(entry)) ?? 0) + 1);
    return [ ...counts ].sort((left, right) => right[1] - left[1]);
}

const counted = (pairs, limit = 8) => `${pairs.slice(0, limit).map(([ key, count ]) => `${key} ×${count}`).join(", ")}${pairs.length > limit ? `, … +${pairs.length - limit} more` : ""}`;
/** Counts per folder, cut at the deepest level that still gives a short list (at most 12 folders). */
function byFolder(workspace, entries) {
    const folders = entries.map(entry => workspace.relative(entry.template.file).split("/").slice(0, -1));
    let depth = Math.max(1, ...folders.map(folder => folder.length));
    const at = level => countBy(folders, folder => folder.slice(0, level).join("/") || ".");
    while (depth > 1 && at(depth).length > 12) depth--;
    return at(depth);
}

function printList(lines, all, more = "--all lists every one") {
    const shown = all ? lines : lines.slice(0, SHOWN);
    for (const line of shown) console.log(`  ${line}`);
    if (lines.length > shown.length) console.log(`  … +${lines.length - shown.length} more (${more})`);
}

const NOT_SEEN = "Not seen here: TypeScript that reads the member through another object (viewChild, a parameter), names in strings and styles, AngularJS templates";

// ---------------------------------------------------------------------------------------------------------------------
// usages

function usagesOfClass(workspace, owner, flags) {
    const family = familyOf(workspace, owner);
    const uses = [];
    const inherited = new Map();
    for (const template of workspace.templates.values()) {
        for (const { node, matched } of scan(workspace, template).elements) {
            if (matched.includes(owner)) uses.push({ template, node });
            else for (const declaration of matched) if (family.has(declaration)) inherited.set(declaration, (inherited.get(declaration) ?? 0) + 1);
        }
    }
    const files = new Set(uses.map(entry => entry.template.file));
    const outside = uses.filter(entry => entry.template.kind !== "app").length;
    // a downgraded class has uses in AngularJS templates too: the headline says that they are not in its count
    const downgradedAs = downgradesOf(workspace, family).find(downgrade => downgrade.name);
    const angularJsPart = downgradedAs ? ` in Angular templates (+ AngularJS: not counted here, run ajs-facts usages ${downgradedAs.name})` : "";
    console.log(`${titleOf(owner)}  ${workspace.relative(owner.file)}: ${plural(uses.length, "element")} in ${plural(files.size, downgradedAs ? "Angular template" : "template")}${angularJsPart.replace(" in Angular templates", "")}${outside ? `, ${outside} of them in tests and stories` : ""} (${statsOf(workspace)})`);
    if (!owner.selector) console.log(`! ${owner.className} has no selector of its own${owner.decorator ? "" : " and no @Component/@Directive decorator"}: nothing can be an element of it; see the classes that extend it`);
    const { inputs, outputs } = allMembers(workspace, owner);
    const inputCounts = countBy(uses.flatMap(entry => [ ...inputs.keys() ].filter(name => inputBindings(entry.node, name).length)), name => name);
    const outputCounts = countBy(uses.flatMap(entry => [ ...outputs.keys() ].filter(name => outputBindings(entry.node, name).length)), name => name);
    const neverBound = [ ...inputs.keys() ].filter(name => !inputCounts.some(([ used ]) => used === name));
    const silent = [ ...outputs.keys() ].filter(name => !outputCounts.some(([ used ]) => used === name));
    if (inputs.size) console.log(`By input (${inputs.size} declared): ${counted(inputCounts, flags.all ? Infinity : 12) || "none is bound"}${neverBound.length ? `; never bound: ${neverBound.slice(0, flags.all ? Infinity : 8).join(", ")}${!flags.all && neverBound.length > 8 ? ", …" : ""}` : ""}`);
    if (outputs.size) console.log(`By output (${outputs.size} declared): ${counted(outputCounts, flags.all ? Infinity : 12) || "none is listened to"}${silent.length ? `; never listened to: ${silent.slice(0, flags.all ? Infinity : 8).join(", ")}${!flags.all && silent.length > 8 ? ", …" : ""}` : ""}`);
    // What templates bind on these elements that the class does not declare: in code that is half-way through a change the
    // answer to "who uses which input" is here (the compiler rejects such a binding unless a directive on the element takes it).
    const undeclared = countBy(uses.flatMap(entry => (isStructural(entry.node) ? [] : [
        ...new Set(entry.node.inputs.filter(input => isProperty(input) && !inputs.has(input.name) && !outputs.has(`${input.name}Change`)).map(input => `[${input.name}]`)),
        ...new Set(entry.node.outputs.filter(output => !outputs.has(output.name) && !/^[a-z]+$/.test(output.name)).map(output => `(${output.name})`))
    ])), name => name);
    if (undeclared.length) console.log(`Bound on these elements, but no input or output of ${owner.className}: ${counted(undeclared, flags.all ? Infinity : 8)} — another directive on the element, an HTML property, or a binding the compiler rejects (check says which)`);
    if (uses.length) console.log(`By folder: ${counted(byFolder(workspace, uses), flags.all ? Infinity : 8)}`);
    printList(uses.map(entry => describe(workspace, entry)), flags.all);
    if (inherited.size) console.log(`Classes that extend it are components of their own, not counted above: ${[ ...inherited ].map(([ declaration, count ]) => `${titleOf(declaration)} ×${count}`).join(", ")}`);
    const silentFamily = [ ...family ].filter(member => member !== owner && !inherited.has(member));
    if (silentFamily.length) console.log(`Classes that extend it and have no element in any template: ${silentFamily.map(member => member.className).slice(0, 8).join(", ")}${silentFamily.length > 8 ? ", …" : ""}`);
    const sharing = workspace.declarations.filter(declaration => declaration !== owner && declaration.kind === "app" && declaration.selector && declaration.selector === owner.selector);
    if (sharing.length) console.log(`! ${sharing.map(declaration => declaration.className).join(", ")} ${sharing.length === 1 ? "has" : "have"} the same selector: a parser cannot tell which class an element means (that depends on the imports of each component)`);
    for (const line of [ ...readingNotes(workspace, flags.all), ...angularJsLines(workspace, family) ]) console.log(line);
    console.log("Not seen here: elements created in code (createComponent, a dialog service), AngularJS templates, tests that build markup at run time");
    console.log(`→ next: node ${pasteable(path.join(OWN_FOLDER, "ng-facts.mjs"))} where ${owner.className} --root ${pasteable(workspace.root)}   (the screens that show it; one input or output: usages ${owner.className}.NAME)`);
}

function usagesOfMember(workspace, asked, name, flags) {
    let found = memberOf(workspace, asked, name);
    if (!found) {
        const { inputs, outputs } = allMembers(workspace, asked);
        const declared = `Inputs: ${[ ...inputs.keys() ].join(", ") || "none"}. Outputs: ${[ ...outputs.keys() ].join(", ") || "none"}.`;
        // Code half-way through a change: the class no longer (or not yet) declares the name, and templates still bind it.
        // Those bindings are the answer; an attribute nobody writes on these elements is a wrong name.
        const undeclared = { name, bindingName: name, kind: "undeclared" };
        if (!findBindings(workspace, asked, undeclared, "inputs").uses.length) {
            const base = asked.baseName && !baseOf(workspace, asked) ? ` It extends ${asked.baseName}, which is not a class of this workspace (a library?): its inputs are not known here.` : "";
            throw new Problem(`${asked.className} has no input or output "${name}". ${declared}${base}`);
        }
        console.log(`! ${asked.className} declares no input or output "${name}" (${declared.slice(0, -1)}): below are the attributes of that name on its elements. The compiler rejects the bound ones, unless a directive on the element takes them.`);
        found = { declaring: asked, input: undeclared, output: undefined };
    }
    const { declaring, input, output } = found;
    const groups = [];
    if (input) groups.push({ list: "inputs", member: input, label: `${input.kind === "undeclared" ? "not declared on the class" : input.kind === "decorator" ? "@Input" : input.kind === "metadata" ? "inputs: [ ]" : `${input.kind} input`}` });
    if (output) groups.push({ list: "outputs", member: output, label: output.implicit ? "the change event of a model input" : output.kind === "decorator" ? "@Output" : output.kind === "metadata" ? "outputs: [ ]" : "output" });
    if (input?.kind === "model" && !groups.some(group => group.list === "outputs")) groups.push({ list: "outputs", member: declaring.outputs.find(candidate => candidate.implicit && candidate.name === `${input.name}Change`), label: "the change event of the model input" });
    let first = true;
    for (const { list, member, label } of groups) {
        const { family, carriers, uses, others, exposures } = findBindings(workspace, declaring, member, list);
        const files = new Set(uses.map(entry => entry.template.file));
        const outside = uses.filter(entry => entry.template.kind !== "app").length;
        const alias = member.bindingName !== member.name ? `, bound as "${member.bindingName}"` : "";
        console.log(`${declaring.className}.${member.name} (${label}${alias}): ${plural(uses.length, "binding")} in ${plural(files.size, "template")}${outside ? `, ${outside} of them in tests and stories` : ""}${first ? ` (${statsOf(workspace)})` : ""}`);
        if (first && declaring !== asked) console.log(`! ${asked.className} inherits it from ${declaring.className}: the answer is about the declaration, so it covers ${declaring.className} and every class that extends it`);
        first = false;
        const perClass = countBy(uses, entry => entry.carrier).map(([ declaration, count ]) => `${titleOf(declaration)} ×${count}${carriers.get(declaration).why ? ` (${carriers.get(declaration).why})` : ""}`);
        if (perClass.length) console.log(`On: ${perClass.join(", ")}`);
        const unused = [ ...family ].filter(member2 => member2 !== declaring && member2.selector && !uses.some(entry => entry.carrier === member2));
        if (unused.length) console.log(`Classes that extend ${declaring.className} with no binding of it: ${unused.map(titleOf).slice(0, 8).join(", ")}${unused.length > 8 ? ", …" : ""}`);
        for (const { host, exposed } of exposures) console.log(`Exposed through hostDirectives of ${host.className} as "${exposed.alias ?? exposed.name}" (${workspace.relative(host.file)}:${workspace.lineOf(host.file, exposed.node.getStart(host.fileInfo.sourceFile))})`);
        if (uses.length) {
            console.log(`Forms: ${counted(countBy(uses, entry => entry.form === "plain" ? "plain attribute" : entry.form === "bound" ? "[bound]" : entry.form === "two-way" ? "[(two-way)]" : entry.form === "event" ? "(event)" : "structural (*)"))}`);
            console.log(`Values: ${counted(countBy(uses, entry => valueOf(entry.binding) || "(no value)"), flags.all ? Infinity : 8)}`);
            console.log(`By folder: ${counted(byFolder(workspace, uses), flags.all ? Infinity : 8)}`);
        }
        printList(uses.map(entry => describe(workspace, entry)), flags.all);
        const strangers = countBy(others, entry => `<${shownName(entry.node)}>`);
        console.log(`Same name on other elements: ${others.length ? `${plural(others.length, "binding")} on ${counted(strangers, flags.all ? Infinity : 6)}` : "none"}${others.length ? ` — not this ${list === "inputs" ? "input" : "output"}: these elements match no class of the family above` : ""}`);
    }
    const { reads, unclear } = referenceReads(workspace, familyOf(workspace, declaring), (input ?? output).name);
    if (reads.length + unclear.length) {
        console.log(`Read through a template reference (#ref … ref.${(input ?? output).name}): ${reads.length}${unclear.length ? `, and ${unclear.length} where the reference name is used for two different things` : ""}`);
        printList([ ...reads, ...unclear ].map(entry => describeRead(workspace, entry)), flags.all);
    }
    for (const line of [ ...readingNotes(workspace, flags.all), ...angularJsLines(workspace, familyOf(workspace, declaring), (input ?? output).bindingName) ]) console.log(line);
    console.log(NOT_SEEN);
    const self = pasteable(path.join(OWN_FOLDER, "ng-facts.mjs"));
    if (input?.kind === "undeclared") console.log(`→ next: node ${self} migrate --help   (change these bindings to the API the class has now, with a spec)`);
    else if (sibling("ls-facts.mjs")) console.log(`→ next: node ${sibling("ls-facts.mjs")} refs ${declaring.className}.${name} --root ${pasteable(workspace.root)}   (the type-checked references: TypeScript too)`);
    else if (sibling("leftovers.mjs")) console.log(`→ next: node ${sibling("leftovers.mjs")} ${declaring.className}.${name} --before --root ${pasteable(workspace.root)}   (the places in text: strings, styles, AngularJS)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// rename-input

function negateExpression(ast, templateText) {
    const sourceOf = node => templateText.slice(node.sourceSpan.start, node.sourceSpan.end);
    if (isA(ast, ng.PrefixNot)) return sourceOf(isA(ast.expression, ng.ParenthesizedExpression) ? ast.expression.expression : ast.expression);
    if (isA(ast, ng.LiteralPrimitive) && typeof ast.value === "boolean") return String(!ast.value);
    const simple = isA(ast, ng.PropertyRead) || isA(ast, ng.SafePropertyRead) || isA(ast, ng.Call) || isA(ast, ng.KeyedRead) || isA(ast, ng.ParenthesizedExpression);
    return simple ? `!${sourceOf(ast)}` : `!(${sourceOf(ast)})`;
}

function walkExpression(ast, visit, parent = undefined) {
    if (!isA(ast, ng.AST)) return;
    visit(ast, parent);
    for (const value of Object.values(ast)) {
        if (isA(value, ng.AST)) walkExpression(value, visit, ast);
        else if (Array.isArray(value)) for (const item of value) walkExpression(item, visit, ast);
    }
}

function applyEdits(edits) {
    for (const [ file, fileEdits ] of Map.groupBy(edits, entry => entry.file)) {
        let text = readFileSync(file, "utf8");
        for (const entry of fileEdits.sort((left, right) => right.start - left.start || right.end - left.end)) text = text.slice(0, entry.start) + entry.text + text.slice(entry.end);
        writeFileSync(file, text);
    }
}

/** Drops exact duplicates (a template shared by two classes) and refuses edits that overlap. */
function settleEdits(workspace, edits) {
    const unique = [ ...new Map(edits.map(entry => [ `${entry.file}#${entry.start}#${entry.end}#${entry.text}`, entry ])).values() ];
    const sorted = [ ...unique ].sort((left, right) => left.file.localeCompare(right.file) || left.start - right.start);
    for (let index = 1; index < sorted.length; index++) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (previous.file === current.file && current.start < previous.end) throw new Problem(`two edits overlap in ${workspace.relative(current.file)}:${workspace.lineOf(current.file, current.start)}: nothing was written`);
    }
    return unique;
}

/**
 * Codemod: renames an input (or output) where the parser can decide it: the declaration (or its alias, or its name in
 * inputs: [ ]), `this.<name>` in the class and in every class that extends it, reads in their own templates, every binding on
 * their elements, hostDirectives lists, and (name)Change for a model. Returns the edits by group; `write` applies them.
 */
export function renameMember(workspace, asked, oldName, newName, { negate = false, write = false } = {}) {
    const found = memberOf(workspace, asked, oldName);
    if (!found) {
        const { inputs, outputs } = allMembers(workspace, asked);
        throw new Problem(`${asked.className} has no input or output "${oldName}". Inputs: ${[ ...inputs.keys() ].join(", ") || "none"}. Outputs: ${[ ...outputs.keys() ].join(", ") || "none"}.${asked.baseName && !baseOf(workspace, asked) ? ` It extends ${asked.baseName}, which is not a class of this workspace.` : ""}`);
    }
    const { declaring } = found;
    const isInput = Boolean(found.input);
    const member = isInput ? found.input : found.output;
    const list = isInput ? "inputs" : "outputs";
    if (member.implicit) throw new Problem(`${oldName} is the change event of the model input ${member.name.replace(/Change$/, "")}: rename the model input, its event follows`);
    if (negate && !isInput) throw new Problem("--negate is for inputs: an output has no value to negate");
    // An aliased member has two names: the alias is what templates bind, the member name is what the class reads.
    const aliased = member.bindingName !== member.name;
    const renameBinding = member.bindingName === oldName;
    const renameInClass = member.name === oldName;
    const edits = [];
    const decisions = [];
    const groups = { declaration: 0, "reads in the class": 0, "reads in its own template": 0, "reads through a template reference": 0, bindings: 0, "lists in decorators": 0 };
    const edit = (group, file, start, end, text) => {
        edits.push({ file, start, end, text, group });
        groups[group]++;
    };
    const { family, carriers, exposures, uses, others } = findBindings(workspace, declaring, member, list);
    // the new name must be free on the declaring class, its bases and every class that extends it: two members would become one
    if (renameInClass) {
        const bases = [];
        for (let current = baseOf(workspace, declaring), depth = 0; current && depth < 20; current = baseOf(workspace, current), depth++) bases.push(current);
        const taken = [ ...family, ...bases ].filter(owner => owner.classNode.members.some(candidate => textOfName(candidate.name) === newName));
        if (taken.length) throw new Problem(`${taken.map(owner => owner.className).join(", ")} already ${taken.length === 1 ? "has" : "have"} a member "${newName}": choose another name`);
    }
    // a binding that another directive on the same element takes too: renamed, that directive loses it (the compiler stays green)
    if (renameBinding && isInput) {
        for (const use of uses) {
            const element = scan(workspace, use.template).elements.find(entry => entry.node === use.node);
            const other = element?.matched.find(declaration => !family.has(declaration) && allMembers(workspace, declaration).inputs.has(member.bindingName));
            if (other) decisions.push(`${describe(workspace, use)} — ${other.className} on the same element takes "${member.bindingName}" too: renamed, it loses this binding; decide`);
        }
        const ownSelector = declaring.selector && new RegExp(`\\[\\s*${oldName.replace(/[$]/g, "\\$")}\\s*[\\]=~|^$*]`).test(declaring.selector);
        if (ownSelector) decisions.push(`${workspace.relative(declaring.file)} the selector ${declaring.selector} of ${declaring.className} is the input's own name and is NOT renamed: elements bound as [${newName}] no longer match it; decide`);
    }

    if (aliased && renameBinding && member.aliasNode) edit("declaration", declaring.file, member.aliasNode.getStart(declaring.fileInfo.sourceFile) + 1, member.aliasNode.getEnd() - 1, newName);
    if (member.kind === "metadata" && member.listNode) {
        const start = member.listNode.getStart(declaring.fileInfo.sourceFile) + 1;
        const lead = /^\s*/.exec(member.listNode.text)[0].length;
        edit("lists in decorators", declaring.file, start + lead, start + lead + oldName.length, newName);
    }
    if (renameInClass) {
        for (const owner of family) {
            const sourceFile = owner.fileInfo.sourceFile;
            for (const candidate of owner.classNode.members) {
                if (textOfName(candidate.name) !== oldName || !ts.isIdentifier(candidate.name)) continue;
                edit(owner === declaring ? "declaration" : "reads in the class", owner.file, candidate.name.getStart(sourceFile), candidate.name.getEnd(), newName);
                const [ firstArgument ] = owner === declaring && member.call ? member.call.arguments : [];
                if (negate && firstArgument && (firstArgument.kind === ts.SyntaxKind.TrueKeyword || firstArgument.kind === ts.SyntaxKind.FalseKeyword)) {
                    edit("declaration", owner.file, firstArgument.getStart(sourceFile), firstArgument.getEnd(), firstArgument.kind === ts.SyntaxKind.TrueKeyword ? "false" : "true");
                }
            }
            owner.classNode.forEachChild(function visit(node) {
                if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === oldName) {
                    const call = ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : undefined;
                    if (!negate) edit("reads in the class", owner.file, node.name.getStart(sourceFile), node.name.getEnd(), newName);
                    else if (call && ts.isPrefixUnaryExpression(call.parent) && call.parent.operator === ts.SyntaxKind.ExclamationToken) edit("reads in the class", owner.file, call.parent.getStart(sourceFile), call.parent.getEnd(), `this.${newName}()`);
                    else if (call) edit("reads in the class", owner.file, call.getStart(sourceFile), call.getEnd(), `!this.${newName}()`);
                    else {
                        edit("reads in the class", owner.file, node.name.getStart(sourceFile), node.name.getEnd(), newName);
                        decisions.push(`${workspace.relative(owner.file)}:${workspace.lineOf(owner.file, node.getStart(sourceFile))} this.${oldName} is renamed but not negated: it is not a signal read, decide what the code means now`);
                    }
                }
                node.forEachChild(visit);
            });
            const template = owner.template;
            if (!template) continue;
            const { expressions, locals } = scan(workspace, template);
            if (locals.has(oldName)) {
                decisions.push(`${workspace.relative(template.file)}:${workspace.lineOf(template.file, template.offset)} the template of ${owner.className} declares its own "${oldName}" (#ref, let or @for): its reads were left alone, check them`);
                continue;
            }
            const parents = new Map();
            for (const expression of expressions) {
                walkExpression(expression, (node, parent) => {
                    parents.set(node, parent);
                    if (!isA(node, ng.PropertyRead) || node.name !== oldName || !isA(node.receiver, ng.ImplicitReceiver)) return;
                    const call = isA(parent, ng.Call) && parent.receiver === node ? parent : undefined;
                    if (!negate || !call) {
                        edit("reads in its own template", template.file, absolute(template, node.nameSpan.start), absolute(template, node.nameSpan.end), newName);
                        if (negate) decisions.push(`${workspace.relative(template.file)}:${workspace.lineOf(template.file, absolute(template, node.nameSpan.start))} ${oldName} is renamed but not negated: it is not a signal read`);
                        return;
                    }
                    const target = isA(parents.get(call), ng.PrefixNot) ? parents.get(call) : call;
                    edit("reads in its own template", template.file, absolute(template, target.sourceSpan.start), absolute(template, target.sourceSpan.end), target === call ? `!${newName}()` : `${newName}()`);
                });
            }
        }
    }
    if (renameInClass) {
        const { reads, unclear } = referenceReads(workspace, family, oldName);
        for (const read of reads) {
            const { template, node, call, not } = read;
            const group = "reads through a template reference";
            if (!negate) edit(group, template.file, absolute(template, node.nameSpan.start), absolute(template, node.nameSpan.end), newName);
            else if (call) {
                const target = not ?? call;
                const receiver = template.text.slice(node.receiver.sourceSpan.start, node.receiver.sourceSpan.end);
                edit(group, template.file, absolute(template, target.sourceSpan.start), absolute(template, target.sourceSpan.end), `${not ? "" : "!"}${receiver}.${newName}()`);
            } else {
                edit(group, template.file, absolute(template, node.nameSpan.start), absolute(template, node.nameSpan.end), newName);
                decisions.push(`${describeRead(workspace, read)} is renamed but not negated: it is not a signal read`);
            }
        }
        for (const read of unclear) decisions.push(`${describeRead(workspace, read)} — the template gives the name #${read.reference} to two different things: rename it by hand if it is this member`);
    }
    if (renameBinding) {
        for (const use of uses) {
            const { template, binding, form, node } = use;
            if (carriers.get(use.carrier).exposed?.alias) continue;
            if (form === "structural") {
                decisions.push(`${describe(workspace, use)} — a key of a structural directive (*… ${binding.name}): rename it by hand`);
                continue;
            }
            if (form === "two-way" && list === "outputs") {
                decisions.push(`${describe(workspace, use)} — a two-way binding listens to this output under the name of its input: decide by hand`);
                continue;
            }
            if (negate && form !== "bound") {
                decisions.push(`${describe(workspace, use)} — ${form === "plain" ? "a plain attribute" : "a two-way binding"} cannot be negated`);
                continue;
            }
            edit("bindings", template.file, absolute(template, binding.keySpan.start.offset), absolute(template, binding.keySpan.end.offset), newName);
            if (negate) edit("bindings", template.file, absolute(template, binding.valueSpan.start.offset), absolute(template, binding.valueSpan.end.offset), asWritten(template, negateExpression(binding.value.ast, template.text)));
            // i18n-<name> marks the same attribute for translation and never reaches the parser's attribute list
            const tagStart = absolute(template, node.startSourceSpan.start.offset);
            const tag = workspace.textOf(template.file).slice(tagStart, absolute(template, node.startSourceSpan.end.offset));
            for (const match of tag.matchAll(new RegExp(`(?<=\\s)i18n-${oldName}(?=[\\s=>/])`, "g"))) edit("bindings", template.file, tagStart + match.index + 5, tagStart + match.index + 5 + oldName.length, newName);
        }
        for (const { host, exposed } of exposures) {
            const start = exposed.node.getStart(host.fileInfo.sourceFile) + 1;
            const lead = /^\s*/.exec(exposed.node.text)[0].length;
            edit("lists in decorators", host.file, start + lead, start + lead + oldName.length, newName);
        }
        // downgradeComponent({ component: X, inputs: [ "name" ] }): the same kind of list, for an AngularJS host
        for (const downgrade of downgradesOf(workspace, family)) {
            for (const exposed of downgrade[list]) {
                if (exposed.name !== oldName) continue;
                const start = exposed.node.getStart(downgrade.fileInfo.sourceFile) + 1;
                const lead = /^\s*/.exec(exposed.node.text)[0].length;
                edit("lists in decorators", downgrade.fileInfo.file, start + lead, start + lead + oldName.length, newName);
            }
        }
        if (isInput && member.kind === "model") {
            const change = { ...member, name: `${member.name}Change`, bindingName: `${member.bindingName}Change` };
            for (const use of findBindings(workspace, declaring, change, "outputs").uses) {
                if (use.form === "event") edit("bindings", use.template.file, absolute(use.template, use.binding.keySpan.start.offset), absolute(use.template, use.binding.keySpan.end.offset), `${newName}Change`);
            }
        }
    }
    const settled = settleEdits(workspace, edits);
    if (write) applyEdits(settled);
    return { declaring, member, isInput, aliased, renameBinding, renameInClass, family, carriers, uses, others, edits: settled, groups, files: new Set(settled.map(entry => entry.file)), decisions };
}

/**
 * downgradeComponent({ component: X, inputs: [ … ], outputs: [ … ] }) calls for the given classes, with the name AngularJS
 * knows the component by when the call is the argument of .directive("name", …).
 */
function downgradesOf(workspace, family) {
    const names = new Set([ ...family ].map(member => member.className));
    const found = [];
    for (const fileInfo of workspace.files.values()) {
        if (fileInfo.kind !== "app" || !fileInfo.text.includes("downgradeComponent")) continue;
        workspace.parse(fileInfo).forEachChild(function visit(node) {
            const options = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "downgradeComponent" && node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
            const className = options && ts.isObjectLiteralExpression(options) ? classReference(propertyOf(options, "component")) : undefined;
            if (className && names.has(className)) {
                let outer = node.parent;
                while (outer && (ts.isAsExpression(outer) || ts.isParenthesizedExpression(outer))) outer = outer.parent;
                const registered = outer && ts.isCallExpression(outer) && ts.isPropertyAccessExpression(outer.expression) && outer.expression.name.text === "directive" ? stringOf(outer.arguments[0]) : undefined;
                found.push({ className, name: registered, fileInfo, line: workspace.lineOf(fileInfo.file, node.getStart(fileInfo.sourceFile)), inputs: exposedList(options, "inputs"), outputs: exposedList(options, "outputs") });
            }
            node.forEachChild(visit);
        });
    }
    return found;
}

const kebab = name => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

/** leftovers.mjs of this folder for one member, as its one --json line (verdict and counts). */
function leftoversVerdict(member, root) {
    const run = spawnSync(process.execPath, [ path.join(OWN_FOLDER, "leftovers.mjs"), member, "--root", root, "--json" ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    try {
        return JSON.parse(run.stdout.trim().split("\n").at(-1));
    } catch {
        return { failed: `${run.stderr}${run.stdout}`.trim().split("\n")[0] || `exit code ${run.status}` };
    }
}

/** Another script of this folder as a path to paste, or null when this copy of the skill does not hold it: a "→ next:" line never names a script that is not there. */
const sibling = name => (existsSync(path.join(OWN_FOLDER, name)) ? pasteable(path.join(OWN_FOLDER, name)) : null);
/** The line that sends the reader to the AngularJS side when a class of the family is downgraded; nothing when none is. */
function angularJsLines(workspace, family, memberName) {
    const downgrades = downgradesOf(workspace, family);
    if (!downgrades.length) return [];
    const named = downgrades.map(downgrade => `${downgrade.className} as "${downgrade.name ?? "?"}" (${downgrade.fileInfo.shown}:${downgrade.line})`);
    const first = downgrades.find(downgrade => downgrade.name) ?? downgrades[0];
    const warning = `! AngularJS uses it too, and its templates are not read here: downgraded ${named.join(", ")}${memberName ? `; there the name is written in kebab-case (${kebab(memberName)}="…")` : ""}`;
    if (!sibling("ajs-facts.mjs")) return [ warning ];
    return [ warning, `→ next: node ${sibling("ajs-facts.mjs")} usages ${first.name ?? first.className}${memberName ? `.${memberName}` : ""} --root ${pasteable(workspace.root)}   (the AngularJS side)` ];
}

// ---------------------------------------------------------------------------------------------------------------------
// migrate

export const MIGRATION_SPEC_HELP = `Migration spec (JSON):
{
  "component": "ButtonComponent",                     // class or selector of the component whose API changed
  "inputs": {
    "isPrimary": { "rename": "primary" },             // rename the binding
    "disabledState": { "rename": "enabled", "negate": true },   // rename + negate the value (!x, true->false, a > b -> !(a > b))
    "kind": {                                          // rename + map string values (static attribute, or literals inside ?: )
      "rename": "appearance",
      "values": { "big": "large", "small": "compact" },
      "otherwise": { "pipe": "appearance", "import": "AppearancePipe", "from": "src/app/lib/appearance.pipe" }
    },                                                 // non-literal values: wrap in the pipe and add it to the component imports
    "text": { "toContent": true }                      // drop the input, move its value into the element content (<x>value</x>)
  }
}
It edits the elements of the component and of every class that extends it, in templates only: change the class itself by hand
(or with rename-input) first or after. Every place it cannot decide is printed as "needs a decision".`;

function literalLeaves(ast) {
    if (isA(ast, ng.LiteralPrimitive) && typeof ast.value === "string") return [ ast ];
    if (isA(ast, ng.ParenthesizedExpression)) return literalLeaves(ast.expression);
    if (isA(ast, ng.Conditional)) {
        const left = literalLeaves(ast.trueExp);
        const right = literalLeaves(ast.falseExp);
        return left && right ? [ ...left, ...right ] : null;
    }
    return null;
}

function removalRange(text, start, end) {
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", end);
    if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd < 0 ? text.length : lineEnd).trim()) return [ lineStart, lineEnd < 0 ? text.length : lineEnd + 1 ];
    let from = start;
    while (from > 0 && text[from - 1] === " ") from--;
    return [ from, end ];
}

function importEdits(declaration, importName, fromRoot, root) {
    const sourceFile = declaration.fileInfo.sourceFile;
    const metadata = decoratorCall(declaration.classNode)?.arguments[0];
    const importsProperty = metadata && ts.isObjectLiteralExpression(metadata) ? metadata.properties.find(property => textOfName(property.name) === "imports") : undefined;
    const edits = [];
    if (!importsProperty || !ts.isArrayLiteralExpression(importsProperty.initializer)) return { edits, decision: `${declaration.className}: no imports array to add ${importName} to (declared in an NgModule?): add it by hand` };
    const elements = importsProperty.initializer.elements;
    if (elements.some(element => element.getText(sourceFile) === importName)) return { edits };
    const last = elements.at(-1);
    edits.push(last
        ? { file: declaration.file, start: last.getEnd(), end: last.getEnd(), text: `, ${importName}` }
        : { file: declaration.file, start: importsProperty.initializer.getStart(sourceFile) + 1, end: importsProperty.initializer.getStart(sourceFile) + 1, text: ` ${importName} ` });
    const alreadyImported = sourceFile.statements.some(statement => ts.isImportDeclaration(statement) && statement.importClause?.namedBindings?.elements?.some(element => element.name.text === importName));
    if (!alreadyImported) {
        let specifier = slash(path.relative(path.dirname(declaration.file), path.join(root, fromRoot)));
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        const lastImport = sourceFile.statements.filter(statement => ts.isImportDeclaration(statement)).at(-1);
        const at = lastImport ? lastImport.getEnd() : 0;
        edits.push({ file: declaration.file, start: at, end: at, text: `${lastImport ? "\n" : ""}import { ${importName} } from "${specifier}";${lastImport ? "" : "\n"}` });
    }
    return { edits };
}

/** Applies an API migration described as data to every element of `spec.component` (and of classes that extend it), using the compiler's template AST. */
export function migrate(workspace, spec, { write = false } = {}) {
    if (!spec || typeof spec.component !== "string" || !spec.inputs || typeof spec.inputs !== "object") throw new Problem(`the spec needs "component" and "inputs".\n${MIGRATION_SPEC_HELP}`);
    const owner = findDeclaration(workspace, spec.component);
    const family = familyOf(workspace, owner);
    const edits = [];
    const decisions = [];
    const needsImport = new Map();
    let elements = 0;

    for (const template of workspace.templates.values()) {
        const text = workspace.textOf(template.file);
        const at = offset => absolute(template, offset);
        const where = node => `${workspace.relative(template.file)}:${workspace.lineOf(template.file, at(node.sourceSpan.start.offset))}`;
        const firstEdit = edits.length;
        for (const { node: element, matched } of scan(workspace, template).elements) {
            if (!matched.some(declaration => family.has(declaration)) || isA(element, ng.TmplAstTemplate)) continue;
            elements++;
            let content;
            for (const [ name, rule ] of Object.entries(spec.inputs)) {
                const attribute = element.attributes.find(candidate => candidate.name === name);
                const bound = element.inputs.find(candidate => candidate.name === name && isProperty(candidate));
                const binding = bound ?? attribute;
                if (!binding) continue;
                if (rule.toContent) {
                    content = bound ? `{{ ${bound.value.source.trim()} }}` : attribute.value;
                    const [ start, end ] = removalRange(text, at(binding.sourceSpan.start.offset), at(binding.sourceSpan.end.offset));
                    edits.push({ file: template.file, start, end, text: "" });
                    continue;
                }
                if (rule.rename) edits.push({ file: template.file, start: at(binding.keySpan.start.offset), end: at(binding.keySpan.end.offset), text: rule.rename });
                if (attribute && !bound) {
                    if (rule.values) {
                        const mapped = rule.values[attribute.value];
                        if (mapped === undefined) decisions.push(`${where(attribute)} ${name}="${attribute.value}" has no mapping`);
                        else edits.push({ file: template.file, start: at(attribute.valueSpan.start.offset), end: at(attribute.valueSpan.end.offset), text: mapped });
                    } else if (rule.negate) {
                        decisions.push(`${where(attribute)} static ${name}="${attribute.value}" cannot be negated`);
                    }
                    continue;
                }
                if (rule.negate) edits.push({ file: template.file, start: at(bound.valueSpan.start.offset), end: at(bound.valueSpan.end.offset), text: negateExpression(bound.value.ast, template.text) });
                if (rule.values) {
                    const leaves = literalLeaves(bound.value.ast);
                    if (leaves && leaves.every(leaf => rule.values[leaf.value] !== undefined)) {
                        for (const leaf of leaves) {
                            const quote = template.text[leaf.sourceSpan.start];
                            edits.push({ file: template.file, start: at(leaf.sourceSpan.start), end: at(leaf.sourceSpan.end), text: `${quote}${rule.values[leaf.value]}${quote}` });
                        }
                    } else if (rule.otherwise?.pipe) {
                        edits.push({ file: template.file, start: at(bound.valueSpan.end.offset), end: at(bound.valueSpan.end.offset), text: ` | ${rule.otherwise.pipe}` });
                        for (const templateOwner of template.owners) needsImport.set(templateOwner, rule.otherwise);
                        if (!template.owners.length) decisions.push(`${where(bound)} the pipe ${rule.otherwise.pipe} was added in a ${template.kind} template: import it there by hand`);
                    } else {
                        decisions.push(leaves
                            ? `${where(bound)} [${name}]="${bound.value.source.trim()}": a literal the spec's "values" has no entry for, and there is no fallback`
                            : `${where(bound)} [${name}]="${bound.value.source.trim()}" is not a literal and has no fallback`);
                    }
                }
            }
            if (content !== undefined) {
                const startEnd = at(element.startSourceSpan.end.offset);
                const selfClosing = text.slice(at(element.startSourceSpan.start.offset), startEnd).endsWith("/>");
                if (selfClosing) {
                    let from = startEnd - 2;
                    while (from > 0 && /\s/.test(text[from - 1])) from--;
                    edits.push({ file: template.file, start: from, end: startEnd, text: `>${content}</${element.name}>` });
                } else if (element.children.every(child => isA(child, ng.TmplAstText) && !child.value.trim())) {
                    edits.push({ file: template.file, start: startEnd, end: at(element.endSourceSpan.start.offset), text: content });
                } else {
                    decisions.push(`${where({ sourceSpan: element.startSourceSpan })} <${element.name}> already has content; cannot move the value in`);
                }
            }
        }
        for (let index = firstEdit; index < edits.length; index++) edits[index].text = asWritten(template, edits[index].text);
    }

    for (const [ declaration, target ] of needsImport) {
        const result = importEdits(declaration, target.import, target.from, workspace.root);
        edits.push(...result.edits);
        if (result.decision) decisions.push(result.decision);
    }
    const settled = settleEdits(workspace, edits);
    if (write) applyEdits(settled);
    return { owner, family, elements, edits: settled, files: new Set(settled.map(entry => entry.file)), imports: needsImport.size, decisions };
}

// ---------------------------------------------------------------------------------------------------------------------
// where / unrouted: who renders whom, routes, ui-router states, bootstrap, downgrades, and who names a class in code.

/** Who renders whom, from application templates only (a test host or a story is not a screen). */
function renderGraph(workspace) {
    const parents = new Map(workspace.declarations.map(declaration => [ declaration, new Set() ]));
    const children = new Map(workspace.declarations.map(declaration => [ declaration, new Set() ]));
    const outside = new Map();
    for (const template of workspace.templates.values()) {
        for (const { matched } of scan(workspace, template).elements) {
            for (const rendered of matched) {
                if (template.kind !== "app") outside.set(rendered, (outside.get(rendered) ?? 0) + 1);
                else for (const owner of template.owners) {
                    if (owner === rendered) continue;
                    parents.get(rendered).add(owner);
                    children.get(owner).add(rendered);
                }
            }
        }
    }
    return { parents, children, outside };
}

function reachable(start, ...edgeMaps) {
    const seen = new Set();
    const queue = [ ...start ];
    while (queue.length) {
        const node = queue.pop();
        if (seen.has(node)) continue;
        seen.add(node);
        for (const edges of edgeMaps) for (const next of edges.get(node) ?? []) queue.push(next);
    }
    return seen;
}

/**
 * Entry points read from the sources: Angular router arrays (component, loadComponent, children, loadChildren followed across
 * files and through NgModules), ui-router state objects (name + component/views; parents by the dots of the name),
 * bootstrapApplication / bootstrap: [ ], and downgradeComponent({ component }) for an AngularJS host.
 */
function entryPoints(workspace) {
    const mapping = pathMapping(workspace.root);
    const candidates = [ ...workspace.files.values() ].filter(fileInfo => fileInfo.kind === "app" && HOLDS_ROUTES.test(fileInfo.text));
    const topLevel = new WeakMap();

    const moduleFile = (specifier, fromFile) => {
        const clean = specifier.replace(/\.[cm]?js$/, "");
        const tryBase = base => [ `${base}.ts`, path.join(base, "index.ts"), base ].map(candidate => workspace.files.get(path.normalize(candidate))).find(Boolean);
        if (clean.startsWith(".")) return tryBase(path.resolve(path.dirname(fromFile), clean));
        for (const [ pattern, targets ] of Object.entries(mapping.paths)) {
            const [ prefix, suffix = "" ] = pattern.split("*");
            if (!(pattern.includes("*") ? clean.startsWith(prefix) && clean.endsWith(suffix) : clean === pattern)) continue;
            const star = pattern.includes("*") ? clean.slice(prefix.length, clean.length - suffix.length) : "";
            for (const target of targets) {
                const found = tryBase(path.resolve(mapping.base, target.replace("*", star)));
                if (found) return found;
            }
        }
        return tryBase(path.resolve(mapping.base, clean));
    };

    /** Top-level names of a file: variables, classes, imports and re-exports. */
    const namesOf = fileInfo => {
        const sourceFile = workspace.parse(fileInfo);
        let names = topLevel.get(sourceFile);
        if (names) return names;
        names = { local: new Map(), imported: new Map(), reexports: [], defaultExport: undefined };
        for (const statement of sourceFile.statements) {
            if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) names.local.set(declaration.name.text, declaration.initializer);
            } else if (ts.isClassDeclaration(statement) && statement.name) {
                names.local.set(statement.name.text, statement);
                if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) names.defaultExport = statement;
            } else if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause) {
                const { name, namedBindings } = statement.importClause;
                if (name) names.imported.set(name.text, { specifier: statement.moduleSpecifier.text, exported: "default" });
                if (namedBindings && ts.isNamedImports(namedBindings)) for (const element of namedBindings.elements) names.imported.set(element.name.text, { specifier: statement.moduleSpecifier.text, exported: (element.propertyName ?? element.name).text });
            } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
                names.reexports.push({ specifier: statement.moduleSpecifier.text, names: statement.exportClause && ts.isNamedExports(statement.exportClause) ? new Map(statement.exportClause.elements.map(element => [ element.name.text, (element.propertyName ?? element.name).text ])) : undefined });
            } else if (ts.isExportAssignment(statement)) {
                names.defaultExport = statement.expression;
            }
        }
        topLevel.set(sourceFile, names);
        return names;
    };

    /** The declaration behind an exported name of a file, through re-exports (barrels). */
    const exportOf = (fileInfo, name, depth = 0) => {
        if (!fileInfo || depth > 6) return undefined;
        const names = namesOf(fileInfo);
        if (name === "default" && names.defaultExport) return follow(names.defaultExport, fileInfo, depth + 1);
        if (names.local.has(name)) return { node: names.local.get(name), fileInfo };
        for (const reexport of names.reexports) {
            if (reexport.names && !reexport.names.has(name)) continue;
            const found = exportOf(moduleFile(reexport.specifier, fileInfo.file), reexport.names?.get(name) ?? name, depth + 1);
            if (found) return found;
        }
        return undefined;
    };

    /** Follows an identifier (local or imported) to the expression or class it names; anything else is returned as it is. */
    const follow = (node, fileInfo, depth = 0) => {
        const value = unwrap(node);
        if (!value || !ts.isIdentifier(value) || depth > 6) return { node: value, fileInfo };
        const names = namesOf(fileInfo);
        if (names.local.has(value.text)) return follow(names.local.get(value.text), fileInfo, depth + 1);
        const imported = names.imported.get(value.text);
        const target = imported && exportOf(moduleFile(imported.specifier, fileInfo.file), imported.exported, depth + 1);
        return target ? follow(target.node, target.fileInfo, depth + 1) : { node: value, fileInfo };
    };

    /** `{ … }`, also behind `as const` and Object.freeze({ … }). */
    const objectLiteralOf = node => {
        const value = node && unwrap(node);
        if (value && ts.isCallExpression(value) && value.arguments.length === 1) return objectLiteralOf(value.arguments[0]);
        return value && ts.isObjectLiteralExpression(value) ? value : undefined;
    };

    /** A constant string: a literal, `A.B.C` through constant objects (also in other files), a template literal of those. */
    const constantString = (node, fileInfo, depth = 0) => {
        const value = unwrap(node);
        if (!value || depth > 40) return undefined;
        if (ts.isStringLiteralLike(value)) return value.text;
        if (ts.isIdentifier(value)) {
            const target = follow(value, fileInfo);
            return target.node && target.node !== value ? constantString(target.node, target.fileInfo, depth + 1) : undefined;
        }
        if (ts.isPropertyAccessExpression(value)) {
            const owner = follow(value.expression, fileInfo);
            const object = owner.node && ts.isPropertyAccessExpression(owner.node) ? constantObject(owner.node, owner.fileInfo, depth + 1) : owner;
            const literal = objectLiteralOf(object?.node);
            const property = literal ? propertyOf(literal, value.name.text) : undefined;
            return property ? constantString(property, object.fileInfo, depth + 1) : undefined;
        }
        if (ts.isTemplateExpression(value)) {
            let text = value.head.text;
            for (const span of value.templateSpans) {
                const part = constantString(span.expression, fileInfo, depth + 1);
                if (part === undefined) return undefined;
                text += part + span.literal.text;
            }
            return text;
        }
        if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = constantString(value.left, fileInfo, depth + 1);
            const right = constantString(value.right, fileInfo, depth + 1);
            return left !== undefined && right !== undefined ? left + right : undefined;
        }
        return undefined;
    };
    const constantObject = (access, fileInfo, depth) => {
        if (depth > 40) return undefined;
        const owner = follow(access.expression, fileInfo);
        const object = owner.node && ts.isPropertyAccessExpression(owner.node) ? constantObject(owner.node, owner.fileInfo, depth + 1) : owner;
        const literal = objectLiteralOf(object?.node);
        const property = literal ? propertyOf(literal, access.name.text) : undefined;
        return property ? follow(property, object.fileInfo) : undefined;
    };

    const ROUTE_KEYS = [ "component", "loadComponent", "children", "loadChildren", "redirectTo" ];
    const isRoute = node => ts.isObjectLiteralExpression(node) && propertyOf(node, "path") !== undefined;
    const isRouteArray = node => ts.isArrayLiteralExpression(node) && node.elements.some(isRoute) && node.elements.every(element => isRoute(element) || ts.isSpreadElement(element)) && node.elements.some(element => isRoute(element) && ROUTE_KEYS.some(key => propertyOf(element, key)));
    const isState = node => ts.isObjectLiteralExpression(node) && propertyOf(node, "name") !== undefined && propertyOf(node, "path") === undefined && [ "url", "component", "views", "abstract" ].some(key => propertyOf(node, key));

    const routeArrays = [];
    const states = [];
    const bootstrapped = [];
    const downgraded = [];
    const entryFiles = new Set();
    for (const fileInfo of candidates) {
        if (/bootstrapApplication|bootstrapModule|\.bootstrap\s*\(/.test(fileInfo.text)) entryFiles.add(fileInfo);
        const sourceFile = workspace.parse(fileInfo);
        const lineOf = node => workspace.lineOf(fileInfo.file, node.getStart(sourceFile));
        sourceFile.forEachChild(function visit(node) {
            if (isRouteArray(node)) {
                routeArrays.push({ node, fileInfo });
                entryFiles.add(fileInfo);
            } else if (isState(node)) {
                entryFiles.add(fileInfo);
                const component = propertyOf(node, "component");
                const views = propertyOf(node, "views");
                const components = [];
                if (component && classReference(component) && !ts.isStringLiteralLike(unwrap(component))) components.push(classReference(component));
                if (views && ts.isObjectLiteralExpression(unwrap(views))) {
                    for (const view of unwrap(views).properties) {
                        if (!ts.isPropertyAssignment(view)) continue;
                        const value = unwrap(view.initializer);
                        const named = ts.isObjectLiteralExpression(value) ? propertyOf(value, "component") : value;
                        if (named && !ts.isStringLiteralLike(unwrap(named)) && classReference(named)) components.push(classReference(named));
                    }
                }
                const nameNode = propertyOf(node, "name");
                const name = constantString(nameNode, fileInfo);
                const parent = propertyOf(node, "parent");
                states.push({
                    name: name ?? compact(nameNode.getText(sourceFile), 70), resolved: name !== undefined, url: constantString(propertyOf(node, "url"), fileInfo),
                    parent: parent ? constantString(parent, fileInfo) : undefined, components, file: fileInfo.shown, line: lineOf(node)
                });
            } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
                if (node.expression.text === "bootstrapApplication" && classReference(node.arguments[0])) bootstrapped.push(classReference(node.arguments[0]));
                if (node.expression.text === "downgradeComponent" && node.arguments[0] && ts.isObjectLiteralExpression(unwrap(node.arguments[0]))) {
                    const className = classReference(propertyOf(unwrap(node.arguments[0]), "component"));
                    let outer = node.parent;
                    while (outer && (ts.isAsExpression(outer) || ts.isParenthesizedExpression(outer))) outer = outer.parent;
                    const registered = outer && ts.isCallExpression(outer) && ts.isPropertyAccessExpression(outer.expression) && outer.expression.name.text === "directive" ? stringOf(outer.arguments[0]) : undefined;
                    if (className) downgraded.push({ className, name: registered, file: fileInfo.shown, line: lineOf(node) });
                    entryFiles.add(fileInfo);
                }
            } else if (ts.isPropertyAssignment(node) && textOfName(node.name) === "bootstrap" && ts.isArrayLiteralExpression(unwrap(node.initializer)) && insideDecorator(node)) {
                for (const element of unwrap(node.initializer).elements) if (classReference(element)) bootstrapped.push(classReference(element));
            }
            node.forEachChild(visit);
        });
    }

    /** `() => import("./x").then(m => m.Name)`: the file and the exported name ("default" without a then). */
    const lazyTarget = (node, fileInfo) => {
        let specifier;
        let exported = "default";
        (function visit(child) {
            if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && child.arguments[0] && ts.isStringLiteralLike(child.arguments[0])) specifier = child.arguments[0].text;
            if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === "then" && child.arguments[0] && ts.isArrowFunction(child.arguments[0])) {
                const body = unwrap(child.arguments[0].body);
                if (body && ts.isPropertyAccessExpression(body)) exported = body.name.text;
            }
            child.forEachChild(visit);
        })(node);
        return specifier ? { target: moduleFile(specifier, fileInfo.file), exported } : undefined;
    };

    /** The route arrays behind `children:` / `loadChildren:` / a spread: an array, or the forRoot/forChild arrays of an NgModule. */
    const arraysBehind = (node, fileInfo, depth = 0) => {
        const value = unwrap(node);
        if (!value || depth > 6) return [];
        if (ts.isArrayLiteralExpression(value)) return [ { node: value, fileInfo } ];
        if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
            const lazy = lazyTarget(value, fileInfo);
            const target = lazy?.target && exportOf(lazy.target, lazy.exported);
            return target ? arraysBehind(target.node, target.fileInfo, depth + 1) : [];
        }
        if (ts.isIdentifier(value)) {
            const target = follow(value, fileInfo);
            return target.node && target.node !== value ? arraysBehind(target.node, target.fileInfo, depth + 1) : [];
        }
        if (ts.isClassDeclaration(value)) {
            const metadata = decoratorCall(value, new Set([ "NgModule" ]))?.arguments[0];
            const imports = metadata && ts.isObjectLiteralExpression(metadata) ? propertyOf(metadata, "imports") : undefined;
            if (!imports || !ts.isArrayLiteralExpression(unwrap(imports))) return [];
            return unwrap(imports).elements.flatMap(element => arraysBehind(element, fileInfo, depth + 1));
        }
        if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && /^for(Root|Child)$/.test(value.expression.name.text) && value.arguments[0]) return arraysBehind(value.arguments[0], fileInfo, depth + 1);
        return [];
    };

    const componentOf = (route, fileInfo) => {
        const eager = propertyOf(route, "component");
        if (eager) return classReference(eager);
        const lazy = propertyOf(route, "loadComponent");
        const found = lazy && lazyTarget(lazy, fileInfo);
        if (!found) return undefined;
        if (found.exported !== "default") return found.exported;
        const target = found.target && exportOf(found.target, "default");
        return target?.node && ts.isClassDeclaration(target.node) ? target.node.name?.text : undefined;
    };
    const childrenOf = (route, fileInfo) => [ propertyOf(route, "children"), propertyOf(route, "loadChildren") ].filter(Boolean).flatMap(node => arraysBehind(node, fileInfo));

    const nested = new Set();
    for (const { node, fileInfo } of routeArrays) {
        for (const element of node.elements) {
            const behind = ts.isSpreadElement(element) ? arraysBehind(element.expression, fileInfo) : childrenOf(element, fileInfo);
            for (const child of behind) nested.add(child.node);
        }
    }
    const routes = [];
    const walking = new Set();
    const walk = (array, fileInfo, prefix, mounted) => {
        if (walking.has(array) || walking.size > 40) return;
        walking.add(array);
        for (const element of array.elements) {
            if (ts.isSpreadElement(element)) {
                for (const behind of arraysBehind(element.expression, fileInfo)) walk(behind.node, behind.fileInfo, prefix, mounted);
                continue;
            }
            if (!isRoute(element)) continue;
            const segment = propertyOf(element, "path");
            const text = constantString(segment, fileInfo) ?? `{${compact(segment.getText(fileInfo.sourceFile), 30)}}`;
            const full = [ prefix, text ].filter(Boolean).join("/");
            const component = componentOf(element, fileInfo);
            const onScreen = component ? [ ...mounted, component ] : mounted;
            if (component) routes.push({ label: `/${full}`, components: onScreen, file: fileInfo.shown, line: workspace.lineOf(fileInfo.file, element.getStart(fileInfo.sourceFile)) });
            for (const behind of childrenOf(element, fileInfo)) walk(behind.node, behind.fileInfo, full, onScreen);
        }
        walking.delete(array);
    };
    for (const { node, fileInfo } of routeArrays) if (!nested.has(node)) walk(node, fileInfo, "", []);

    // ui-router: a state is shown inside the view of its parent, so the parents' components are on screen with it.
    const byName = new Map(states.filter(state => state.resolved).map(state => [ state.name, state ]));
    const parentOf = state => byName.get(state.parent ?? (state.resolved && state.name.includes(".") ? state.name.slice(0, state.name.lastIndexOf(".")) : ""));
    for (const state of states) {
        if (!state.components.length) continue;
        const chain = [];
        for (let current = state, depth = 0; current && depth < 20; current = parentOf(current), depth++) chain.unshift(current);
        const url = chain.map(link => link.url ?? "").join("");
        routes.push({ label: `state ${state.name}${url ? ` (${url})` : ""}`, components: chain.flatMap(link => link.components), file: state.file, line: state.line, state: true });
    }
    return { routes, bootstrapped, downgraded, entryFiles, stateCount: routes.filter(route => route.state).length };
}

/**
 * Class names in code, as text: which application file declares a class, and which other files name it outside import lines
 * and outside imports/declarations/exports lists (a dialog opened with a service, createComponent, a lazy import, "extends").
 * Text only, so it errs on the side of "named".
 */
function codeIndex(workspace) {
    if (workspace.code) return workspace.code;
    const declaredIn = new Map();
    const classesOf = new Map();
    for (const fileInfo of workspace.files.values()) {
        if (fileInfo.kind !== "app") continue;
        for (const match of fileInfo.text.matchAll(/\bclass\s+([A-Z][\w$]*)/g)) {
            (declaredIn.get(match[1]) ?? declaredIn.set(match[1], new Set()).get(match[1])).add(fileInfo);
            (classesOf.get(fileInfo) ?? classesOf.set(fileInfo, new Set()).get(fileInfo)).add(match[1]);
        }
    }
    const blank = match => match.replace(/[^\n]/g, " ");
    const mentions = new Map();
    const namedBy = new Map();
    for (const fileInfo of workspace.files.values()) {
        if (fileInfo.kind !== "app") continue;
        const code = fileInfo.text
            .replace(/^[ \t]*(?:import|export)\b[^;=]*?\bfrom\s*["'][^"']*["'];?/gm, blank)
            .replace(/\b(?:imports|declarations|exports)\s*:\s*\[[^\]]*\]/g, blank);
        const found = new Map();
        for (const match of code.matchAll(/(?<![\w$])[A-Z][\w$]*/g)) {
            const files = declaredIn.get(match[0]);
            if (!files || files.has(fileInfo)) continue;
            // "class B extends A" names A without creating it: remembered apart, and a later real use in the file wins
            const inherits = /\bextends\s+$/.test(code.slice(Math.max(0, match.index - 12), match.index));
            const known = found.get(match[0]);
            if (known && (!known.inherits || inherits)) continue;
            if (known) Object.assign(known, { offset: match.index, inherits });
            else {
                found.set(match[0], { fileInfo, offset: match.index, inherits });
                (namedBy.get(match[0]) ?? namedBy.set(match[0], []).get(match[0])).push(found.get(match[0]));
            }
        }
        if (found.size) mentions.set(fileInfo, found);
    }
    workspace.code = { declaredIn, classesOf, mentions, namedBy };
    return workspace.code;
}

/** The whole picture `where` and `unrouted` answer from. */
function screens(workspace) {
    const graph = renderGraph(workspace);
    const entries = entryPoints(workspace);
    const code = codeIndex(workspace);
    const componentsIn = Map.groupBy(workspace.declarations.filter(declaration => declaration.kind === "app"), declaration => declaration.fileInfo);
    const namedBy = declaration => code.namedBy.get(declaration.className) ?? [];
    const openerCache = new Map();
    /**
     * Components that may create this one from code: a component whose file names the class, or, when the naming file
     * holds no component (a dialog service), a component whose file names a class of that file, up to three such files
     * deep (a service that calls a service). Value: the file that names the class.
     */
    const openersOf = declaration => {
        if (openerCache.has(declaration)) return openerCache.get(declaration);
        const openers = new Map();
        const add = (fileInfo, through) => {
            for (const opener of componentsIn.get(fileInfo) ?? []) if (opener !== declaration && !graph.parents.get(declaration)?.has(opener) && !openers.has(opener)) openers.set(opener, through);
        };
        for (const { fileInfo, inherits } of namedBy(declaration)) {
            if (inherits) continue;
            const seen = new Set([ fileInfo ]);
            let level = [ fileInfo ];
            for (let depth = 0; level.length && depth < 4; depth++) {
                const next = [];
                for (const current of level) {
                    if (componentsIn.has(current)) {
                        add(current, fileInfo.shown);
                        continue;
                    }
                    for (const className of code.classesOf.get(current) ?? []) {
                        for (const user of code.namedBy.get(className) ?? []) {
                            if (user.inherits || seen.has(user.fileInfo)) continue;
                            seen.add(user.fileInfo);
                            next.push(user.fileInfo);
                        }
                    }
                }
                level = next;
            }
        }
        openerCache.set(declaration, openers);
        return openers;
    };
    const routed = new Set(entries.routes.flatMap(route => route.components));
    const downgraded = new Set(entries.downgraded.map(entry => entry.className));
    const entryNames = new Set([ ...routed, ...downgraded, ...entries.bootstrapped ]);
    return { graph, entries, code, componentsIn, namedBy, openersOf, routed, downgraded, entryNames };
}

function whereCommand(workspace, owner, flags) {
    const { graph, entries, componentsIn, namedBy, openersOf, routed, downgraded, entryNames } = screens(workspace);
    const throughTemplates = reachable([ owner ], graph.parents);
    const ancestors = new Set();
    for (const queue = [ owner ]; queue.length;) {
        const declaration = queue.pop();
        if (ancestors.has(declaration)) continue;
        ancestors.add(declaration);
        queue.push(...(graph.parents.get(declaration) ?? []), ...openersOf(declaration).keys());
    }
    const namesOf = set => new Set([ ...set ].map(declaration => declaration.className));
    const templateNames = namesOf(throughTemplates);
    const names = namesOf(ancestors);
    const showing = entries.routes.filter(route => route.components.some(name => names.has(name)));
    const certain = showing.filter(route => route.components.some(name => templateNames.has(name)));
    const direct = [ ...(graph.parents.get(owner) ?? []) ];
    const limit = flags.all ? Infinity : SHOWN;
    const some = (list, shown = limit) => `${list.slice(0, shown).join(", ")}${list.length > shown ? `, … +${list.length - shown} more (--all)` : ""}`;
    console.log(`${titleOf(owner)}  ${workspace.relative(owner.file)}: rendered directly by ${plural(direct.length, "component")}, through others by ${throughTemplates.size - 1 - direct.length} more; ${certain.length} of ${entries.routes.length} routes and states show it through templates${showing.length > certain.length ? `, ${showing.length - certain.length} more may open it from code` : ""} (${statsOf(workspace)})`);
    console.log(`Rendered directly by (${direct.length}): ${some(direct.map(declaration => declaration.className).sort()) || "nothing: no application template holds an element of it"}`);
    const openers = [ ...openersOf(owner) ];
    if (openers.length) console.log(`May be created from code by (${openers.length}): ${some(openers.map(([ opener, through ]) => `${opener.className} (named in ${through})`), flags.all ? Infinity : 5)}`);
    const elsewhere = namedBy(owner).filter(({ fileInfo, inherits }) => !inherits && !componentsIn.has(fileInfo) && !openers.some(([ , through ]) => through === fileInfo.shown));
    if (elsewhere.length) console.log(`Named in ${plural(elsewhere.length, "other file")} that lead${elsewhere.length === 1 ? "s" : ""} to no component (a route file, a module, a map): ${some(elsewhere.map(({ fileInfo, offset }) => `${fileInfo.shown}:${workspace.lineOf(fileInfo.file, offset)}`), flags.all ? Infinity : 4)}`);
    const heirs = [ ...familyOf(workspace, owner) ].filter(member => member !== owner);
    if (heirs.length) console.log(`Extended by ${plural(heirs.length, "class", "es")}, each a component of its own (ask where for it): ${some(heirs.map(titleOf), flags.all ? Infinity : 5)}`);
    const own = entries.routes.filter(route => route.components.at(-1) === owner.className);
    if (own.length) console.log(`It is itself the component of: ${some(own.map(route => route.label), flags.all ? Infinity : 6)}`);
    console.log(`Routes and states that can show it (${showing.length}):${showing.length ? "" : " none found"}`);
    printList(showing.map(route => `${route.label}  ${route.file}:${route.line}${certain.includes(route) ? "" : "  (from code, by name: approximate)"}`), flags.all);
    const ajs = entries.downgraded.filter(entry => names.has(entry.className));
    if (ajs.length) {
        const self = ajs.filter(entry => entry.className === owner.className);
        console.log(`AngularJS can show it too: ${self.length ? `it is downgraded as ${self.map(entry => `"${entry.name ?? "?"}" (${entry.file}:${entry.line})`).join(", ")}` : `${plural(ajs.length, "downgraded component")} lead${ajs.length === 1 ? "s" : ""} to it: ${some(ajs.map(entry => `${entry.className} as "${entry.name ?? "?"}"`), flags.all ? Infinity : 5)}`}`);
        if (sibling("ajs-facts.mjs")) console.log(`→ next: node ${sibling("ajs-facts.mjs")} usages ${(self[0] ?? ajs[0]).name ?? (self[0] ?? ajs[0]).className} --root ${pasteable(workspace.root)}   (the AngularJS templates and states that use the downgraded name)`);
    }
    const inShell = entries.bootstrapped.filter(name => names.has(name));
    if (inShell.length) console.log(`${inShell.join(", ")} is bootstrapped and leads to it: it can be on screen without any route`);
    const deadEnds = [ ...ancestors ].filter(declaration => declaration !== owner && !graph.parents.get(declaration).size && !openersOf(declaration).size && !entryNames.has(declaration.className));
    if (deadEnds.length) console.log(`Also rendered by ${plural(deadEnds.length, "component")} this script found no way to (no parent, no route, not named in code it can follow): ${some(deadEnds.map(declaration => declaration.className).sort())}`);
    if (graph.outside.get(owner)) console.log(`In tests and stories: ${plural(graph.outside.get(owner), "element")} (not screens)`);
    if (!showing.length && !ajs.length && !inShell.length && !routed.has(owner.className) && !downgraded.has(owner.className)) console.log("! no route, state, bootstrap or downgrade leads to it through templates and code names: it may be dead, or opened in a way this script does not read");
    for (const line of readingNotes(workspace, flags.all)) console.log(line);
    console.log("Not seen here: routes and states built at run time, AngularJS states (ajs-facts list states), components picked by a string or a token map");
}

function unroutedCommand(workspace, flags) {
    const { graph, entries, code, componentsIn, namedBy, entryNames } = screens(workspace);
    const app = workspace.declarations.filter(declaration => declaration.kind === "app" && (declaration.selector || declaration.template));
    // Forward from the entry points: what a live component renders is live; the code of a live component's file runs, and
    // so does the file of every class that code names; a component named by running code is live (a dialog, an "extends").
    const liveFiles = new Set();
    const live = new Set();
    const queue = [ ...workspace.declarations.filter(declaration => declaration.kind === "app" && entryNames.has(declaration.className)), ...entries.entryFiles ];
    while (queue.length) {
        const item = queue.pop();
        if (item.classNode) {
            if (live.has(item)) continue;
            live.add(item);
            queue.push(item.fileInfo, ...(graph.children.get(item) ?? []));
        } else {
            if (liveFiles.has(item)) continue;
            liveFiles.add(item);
            for (const className of code.mentions.get(item)?.keys() ?? []) {
                queue.push(...code.declaredIn.get(className));
                for (const fileInfo of code.declaredIn.get(className)) queue.push(...(componentsIn.get(fileInfo) ?? []).filter(declaration => declaration.className === className));
            }
        }
    }
    const unreached = app.filter(declaration => !live.has(declaration));
    const place = declaration => `${declaration.className}  ${workspace.relative(declaration.file)}`;
    const roots = unreached.filter(declaration => !graph.parents.get(declaration).size);
    const silent = roots.filter(declaration => !namedBy(declaration).length);
    const namedOnly = roots.filter(declaration => namedBy(declaration).length);
    const inside = unreached.filter(declaration => !roots.includes(declaration));
    console.log(`${unreached.length} of ${app.length} components and directives are not reached from any entry point: ${entries.routes.length - entries.stateCount} routes, ${entries.stateCount} states, ${entries.bootstrapped.length} bootstrapped, ${entries.downgraded.length} downgraded for AngularJS (${statsOf(workspace)})`);
    console.log(`\n1. In no template and named by no other TypeScript file: ${silent.length} — the strongest dead code candidates`);
    printList(silent.map(declaration => `${place(declaration)}${graph.outside.get(declaration) ? "  (only in tests and stories)" : ""}`), flags.all);
    console.log(`\n2. In no template, named only by code that nothing reaches either: ${namedOnly.length} — dead if that code is`);
    printList(namedOnly.map(declaration => {
        const [ first, ...rest ] = namedBy(declaration);
        return `${place(declaration)}  ← ${first.fileInfo.shown}:${workspace.lineOf(first.fileInfo.file, first.offset)}${rest.length ? ` (+${rest.length} more)` : ""}`;
    }), flags.all);
    console.log(`\n3. Rendered only by components of this list: ${inside.length} — dead only if their parents are`);
    printList(inside.map(declaration => `${place(declaration)}  ← ${[ ...graph.parents.get(declaration) ].map(parent => parent.className).slice(0, 3).join(", ")}`), flags.all);
    for (const line of readingNotes(workspace, flags.all)) console.log(line);
    console.log("\nHow it decides: live = an entry point, what a live template renders, and every class a live file names in code (text match,");
    console.log("so a dialog opened through a service counts). Not seen: entry points built at run time, a component picked by a string,");
    console.log("AngularJS states and templates beyond the downgrade itself, tests, libraries that use this workspace.");
    const firstCandidate = [ ...silent, ...namedOnly, ...inside ][0];
    if (firstCandidate && sibling("ls-facts.mjs")) console.log(`→ next: node ${sibling("ls-facts.mjs")} refs ${firstCandidate.className} --root ${pasteable(workspace.root)}   (before deleting one, ask the type checker; the same for each candidate)`);
    else if (firstCandidate) console.log(`→ next: node ${sibling("ng-facts.mjs")} where ${firstCandidate.className} --root ${pasteable(workspace.root)}   (before deleting one: who renders it; the same for each candidate)`);
}

// ---------------------------------------------------------------------------------------------------------------------
// check, the write lock, the command line.

/** One writer at a time: two codemods interleaving their edits corrupt the files they share. */
function withWriteLock(root, action) {
    const lock = path.join(root, ".ng-facts.lock");
    if (existsSync(lock)) {
        const owner = Number(readFileSync(lock, "utf8"));
        let alive = Number.isInteger(owner);
        try {
            if (alive) process.kill(owner, 0);
        } catch {
            alive = false;
        }
        if (alive) throw new Problem(`another ng-facts write is running in this workspace (pid ${owner}) — wait for it, do not start a second one`);
    }
    writeFileSync(lock, String(process.pid));
    try {
        return action();
    } finally {
        rmSync(lock, { force: true });
    }
}

/** The tsconfig the compiler is run on: --project, else the build target of angular.json, else tsconfig.app.json, else tsconfig.json. */
function compilerProject(workspace, projectOption) {
    const candidates = [
        [ projectOption, "--project" ],
        [ workspace.buildConfig, "the build target in angular.json" ],
        [ "tsconfig.app.json", "tsconfig.app.json exists" ],
        [ "tsconfig.json", "the only tsconfig" ]
    ];
    for (const [ name, why ] of candidates) {
        if (!name) continue;
        const file = path.resolve(workspace.root, name);
        if (existsSync(file)) return { file, why };
        if (why === "--project") throw new Problem(`--project ${name}: no such file in ${slash(workspace.root)}`);
    }
    throw new Problem(`no tsconfig in ${slash(workspace.root)}: name one with --project <tsconfig>`);
}

/** Runs ngc (no emit) and answers in a few lines: the raw output of a broken workspace runs to hundreds of kilobytes. */
function compilerVerdict(workspace, projectOption, all = false) {
    const project = compilerProject(workspace, projectOption);
    // node starts the compiler's own script: node_modules/.bin/ngc is a shell script that Windows cannot start as a program
    const manifestPath = path.join("node_modules", "@angular", "compiler-cli", "package.json");
    let manifest;
    for (const from of [ workspace.root, OWN_FOLDER ]) {
        for (let directory = from; !manifest; directory = path.dirname(directory)) {
            if (existsSync(path.join(directory, manifestPath))) manifest = path.join(directory, manifestPath);
            if (path.dirname(directory) === directory) break;
        }
    }
    if (!manifest) throw new Problem(`cannot find @angular/compiler-cli in the node_modules of ${slash(workspace.root)} (or above) or of ${slash(OWN_FOLDER)}: install the packages of the workspace (npm ci there)`);
    const ngc = path.resolve(path.dirname(manifest), JSON.parse(readFileSync(manifest, "utf8")).bin.ngc);
    const started = performance.now();
    const run = spawnSync(process.execPath, [ ngc, "-p", project.file, "--noEmit" ], { cwd: workspace.root, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    const seconds = `${((performance.now() - started) / 1000).toFixed(1)} s`;
    const name = workspace.relative(project.file);
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
    const errors = [ ...output.matchAll(/^(.+?)[:(](\d+)[:,](\d+)\)?(?: -|:) error ((?:NG|TS)-?\d+): (.*)$/gm) ].map(([ , file, line, column, code, message ]) => ({ file: slash(path.isAbsolute(file) ? path.relative(workspace.root, file) : file), line, column, code, message }));
    const bare = [ ...output.matchAll(/^error ((?:NG|TS)-?\d+): (.*)$/gm) ].map(([ , code, message ]) => ({ code, message }));
    const head = `ngc -p ${name} (${project.why}), no emit, ${seconds}`;
    if (!errors.length && !bare.length && run.status === 0) return { ok: true, text: `${head}: 0 errors` };
    if (!errors.length) {
        const first = bare[0] ? `${bare[0].code} ${bare[0].message}` : run.error ? run.error.message : output.trim().split("\n")[0] ?? `exit code ${run.status}`;
        const hint = bare[0]?.code === "TS18003" ? "\n! this tsconfig lists no files: add --project and the path of a tsconfig that does" : "";
        return { ok: false, text: `${head}: failed — ${compact(first, 200)}${hint}` };
    }
    const byCode = [ ...Map.groupBy(errors, error => error.code) ].map(([ code, list ]) => `${code} ×${list.length}`).join(", ");
    const kinds = [ ...Map.groupBy(errors, error => `${error.code} ${error.message}`).values() ];
    // one line per kind of message, then its places: the first three, or every one with --all (a rename is finished from this list)
    const shown = (all ? kinds : kinds.slice(0, 6)).flatMap(list => [
        `  ${String(list.length).padStart(4)} × ${list[0].code} ${compact(list[0].message, 140)}`,
        ...(all ? list : list.slice(0, 3)).map(error => `         ${error.file}:${error.line}:${error.column}`),
        ...(!all && list.length > 3 ? [ `         … +${list.length - 3} more (--all lists every place)` ] : [])
    ]);
    return { ok: false, text: [ `${head}: ${plural(errors.length, "error")} in ${plural(new Set(errors.map(error => error.file)).size, "file")} — ${byCode}`, ...shown, ...(!all && kinds.length > 6 ? [ `  … and ${kinds.length - 6} more kinds of error (--all lists every one)` ] : []) ].join("\n") };
}

function parseArgs(argv) {
    const flags = { root: ".", negate: false, write: false, all: false, help: false, project: undefined };
    const positional = [];
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        const valueOf2 = name => {
            if (argv[index + 1] === undefined || argv[index + 1].startsWith("--")) throw new Problem(`${name} needs a value\n${USAGE}`);
            return argv[++index];
        };
        if (argument === "--root") flags.root = valueOf2("--root");
        else if (argument.startsWith("--root=")) flags.root = argument.slice(7);
        else if (argument === "--project") flags.project = valueOf2("--project");
        else if (argument.startsWith("--project=")) flags.project = argument.slice(10);
        else if (argument === "--negate") flags.negate = true;
        else if (argument === "--write") flags.write = true;
        else if (argument === "--all") flags.all = true;
        else if (argument === "--help" || argument === "-h") flags.help = true;
        else if (argument.startsWith("--")) throw new Problem(`unknown option ${argument}\n${USAGE}`);
        else positional.push(argument);
    }
    return { flags, positional };
}

/** "Class.member" or a selector: a selector may hold dots itself, so a name that is known as a whole wins. */
function splitTarget(workspace, target) {
    const known = workspace.classes.has(target) || workspace.declarations.some(declaration => declaration.selector === target);
    const dot = target.lastIndexOf(".");
    // "<file>#<Class>" and "<file>#<Class>.<member>": the dots of the file name are not the one before the member
    if (known || dot <= 0 || dot < target.lastIndexOf("#")) return [ target, undefined ];
    return [ target.slice(0, dot), target.slice(dot + 1) ];
}

async function main() {
    const [ command, ...rest ] = process.argv.slice(2);
    const { flags, positional } = parseArgs(rest);
    if (!command || command === "--help" || command === "-h" || command === "help" || (flags.help && command !== "migrate")) {
        console.log(HELP);
        return 0;
    }
    if (command === "migrate" && (flags.help || !positional[0])) {
        console.log(MIGRATION_SPEC_HELP);
        return 0;
    }
    if (![ "usages", "where", "unrouted", "check", "rename-input", "migrate" ].includes(command)) throw new Problem(`unknown command "${command}"\n${USAGE}`);
    await loadPackages(locateRoot(flags.root).root);
    const self = pasteable(path.join(OWN_FOLDER, "ng-facts.mjs"));

    if (command === "check") {
        const workspace = findWorkspace(flags.root);
        workspace.relative = file => slash(path.relative(workspace.root, file));
        for (const note of workspace.notes) console.log(`! ${note}`);
        const verdict = compilerVerdict(workspace, flags.project, flags.all);
        console.log(verdict.text);
        console.log(verdict.ok ? "A compiler without errors is necessary, not sufficient: names in strings, styles and AngularJS templates are not compiled." : "NOT DONE: the compiler reports errors. Fix them and run check again.");
        return verdict.ok ? 0 : 2;
    }

    const workspace = loadWorkspace(flags.root);
    const rootShown = pasteable(workspace.root);

    if (command === "usages") {
        if (!positional[0]) throw new Problem(`usages of what? give a class, a selector, or <Class>.<input|output>\n${USAGE}`);
        const [ target, memberName ] = splitTarget(workspace, positional[0]);
        const owner = findDeclaration(workspace, target);
        if (memberName) usagesOfMember(workspace, owner, memberName, flags);
        else usagesOfClass(workspace, owner, flags);
        return 0;
    }

    if (command === "rename-input") {
        const [ target, oldName ] = splitTarget(workspace, positional[0] ?? "");
        const newName = positional[1];
        if (!oldName || !newName) throw new Problem(`rename-input needs <Class>.<old> and <new>\n${USAGE}`);
        if (!/^[A-Za-z_$][\w$]*$/.test(newName)) throw new Problem(`"${newName}" is not a name a class member can have`);
        const owner = findDeclaration(workspace, target);
        const result = flags.write ? withWriteLock(workspace.root, () => renameMember(workspace, owner, oldName, newName, flags)) : renameMember(workspace, owner, oldName, newName, flags);
        const { declaring, member } = result;
        console.log(`rename-input ${declaring.className}.${oldName} → ${newName}${flags.negate ? " (negated)" : ""}: ${plural(result.edits.length, "edit")} in ${plural(result.files.size, "file")}, ${result.decisions.length} need a decision — ${flags.write ? "written" : "dry run, nothing written"} (${statsOf(workspace)})`);
        if (declaring !== owner) console.log(`! ${owner.className} inherits ${oldName} from ${declaring.className}: the rename is done on ${declaring.className} and on every class that extends it`);
        if (!result.isInput) console.log(`! ${oldName} is an output: its (event) bindings are renamed`);
        if (result.aliased && result.renameBinding) console.log(`! "${oldName}" is the alias of the member ${member.name}: the alias and the bindings are renamed, the member keeps its name`);
        if (result.aliased && !result.renameBinding) console.log(`! the member ${oldName} is bound in templates under its alias "${member.bindingName}": the member and its reads are renamed, the bindings stay`);
        for (const [ group, count ] of Object.entries(result.groups)) if (count) console.log(`  ${group.padEnd(26)} ${count}`);
        const perClass = countBy(result.uses, entry => entry.carrier).map(([ declaration, count ]) => `${titleOf(declaration)} ×${count}${result.carriers.get(declaration).why ? ` (${result.carriers.get(declaration).why})` : ""}`);
        if (perClass.length) console.log(`  bindings are on: ${perClass.join(", ")}`);
        if (result.others.length) console.log(`  left alone: ${plural(result.others.length, "binding")} of the same name on ${counted(countBy(result.others, entry => `<${shownName(entry.node)}>`), 6)} (not this class or a class that extends it)`);
        for (const decision of flags.all ? result.decisions : result.decisions.slice(0, SHOWN)) console.log(`  needs a decision: ${decision}`);
        if (result.decisions.length > SHOWN && !flags.all) console.log(`  … +${result.decisions.length - SHOWN} more (--all lists every one)`);
        // the AngularJS templates are leftovers' to list: only the warning here, one "→ next" line at the end
        for (const line of [ ...readingNotes(workspace, flags.all), ...angularJsLines(workspace, result.family, result.renameBinding ? oldName : undefined).filter(text => text.startsWith("!")) ]) console.log(line);
        console.log(`${NOT_SEEN}.`);
        if (!flags.write) {
            console.log(`→ next: node ${self} rename-input ${declaring.className}.${oldName} ${newName} --write --root ${rootShown}${sibling("ls-facts.mjs") ? "   (ls-facts rename does the same type-checked, TypeScript reads included)" : ""}`);
            return 0;
        }
        if (result.decisions.length) console.log(`NOT DONE: ${plural(result.decisions.length, "place")} above need${result.decisions.length === 1 ? "s" : ""} a decision: change ${result.decisions.length === 1 ? "it" : "them"} by hand.`);
        // --write is never the last step: TypeScript reads are the compiler's to list, the text places leftovers'
        const left = sibling("leftovers.mjs") ? leftoversVerdict(`${declaring.className}.${oldName}`, workspace.root) : null;
        if (left?.failed) console.log(`NOT DONE: leftovers could not check the text (${left.failed}).`);
        else if (left && left.verdict !== "DONE") console.log(`NOT DONE: ${left.change} places in text still carry ${oldName} and ${left.question} are not decided (strings, styles, AngularJS templates, stories).`);
        console.log(`NOT DONE until the compiler says so: TypeScript that reads it through another object is not renamed here; check lists each such read as "Property '${oldName}' does not exist".`);
        console.log(`→ next: node ${self} check --root ${rootShown} --all   (change the name at each place it lists; again until 0 errors)`);
        if (sibling("leftovers.mjs")) console.log(`→ then: node ${sibling("leftovers.mjs")} ${declaring.className}.${oldName} --root ${rootShown}   (until it prints DONE; last: the same with --final)`);
        return 2;
    }

    if (command === "where") {
        if (!positional[0]) throw new Problem(`where is what? give a class or a selector\n${USAGE}`);
        whereCommand(workspace, findDeclaration(workspace, positional[0]), flags);
        return 0;
    }

    if (command === "unrouted") {
        unroutedCommand(workspace, flags);
        return 0;
    }

    // migrate
    const inline = positional[0].trim().startsWith("{");
    let spec;
    try {
        spec = JSON.parse(inline ? positional[0] : readFileSync(path.resolve(positional[0]), "utf8"));
    } catch (error) {
        throw new Problem(`the migration spec cannot be read (${error.message})\n${MIGRATION_SPEC_HELP}`);
    }
    const result = flags.write ? withWriteLock(workspace.root, () => migrate(workspace, spec, flags)) : migrate(workspace, spec, flags);
    console.log(`migrate ${result.owner.className}: ${plural(result.elements, "element")}${result.family.size > 1 ? ` (with ${result.family.size - 1} classes that extend it)` : ""}, ${plural(result.edits.length, "edit")} in ${plural(result.files.size, "file")}, ${result.imports} components get a new import, ${result.decisions.length} need a decision — ${flags.write ? "written" : "dry run, nothing written"} (${statsOf(workspace)})`);
    for (const decision of flags.all ? result.decisions : result.decisions.slice(0, SHOWN)) console.log(`  needs a decision: ${decision}`);
    if (result.decisions.length > SHOWN && !flags.all) console.log(`  … +${result.decisions.length - SHOWN} more (--all lists every one)`);
    for (const line of readingNotes(workspace, flags.all)) console.log(line);
    if (!flags.write) {
        console.log(inline ? "→ next: the same command with --write added" : `→ next: node ${self} migrate ${pasteable(path.resolve(positional[0]))} --write --root ${rootShown}`);
        return 0;
    }
    const left = migrate(loadWorkspace(flags.root), spec).edits.length;
    console.log(left ? `verify: NOT DONE, ${plural(left, "edit")} would still apply — read them with a dry run before running it again` : "verify: nothing left to migrate in templates");
    console.log(`Not seen here: the class of the component itself, TypeScript that sets these inputs (setInput, a test), names in strings and styles.\n→ next: node ${self} check --root ${rootShown}`);
    return left || result.decisions.length ? 2 : 0;
}

/** Was this file started as the program (not imported)? Real paths are compared, so a start through a link still counts. */
function startedDirectly() {
    if (typeof import.meta.main === "boolean") return import.meta.main;
    if (!process.argv[1]) return false;
    const real = file => {
        try {
            return realpathSync(file);
        } catch {
            return path.resolve(file);
        }
    };
    const [ started, own ] = [ real(process.argv[1]), real(fileURLToPath(import.meta.url)) ];
    return process.platform === "win32" ? started.toLowerCase() === own.toLowerCase() : started === own;
}

if (startedDirectly()) {
    try {
        process.exitCode = await main();
    } catch (error) {
        if (!(error instanceof Problem)) console.error(`ng-facts failed, this is a bug in the script, not an answer: ${error.stack ?? error.message}`);
        else console.error(error.message);
        process.exitCode = 1;
    }
}
