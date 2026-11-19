#!/usr/bin/env node
// ajs-facts — structural facts about a hybrid AngularJS (1.x) + Angular application (ngUpgrade), computed with parsers (no LLM).
// Registrations on angular.module(...), $inject arrays, inline array annotations, $injector.get, $filter("x"), ui-router states,
// downgrades and UpgradeComponent wrappers are read from the TypeScript AST of every .js and .ts file. AngularJS templates
// (.html files and inline template strings) are read with the Angular compiler's HtmlParser and their expressions with its
// expression parser, where an AngularJS filter comes out as a pipe. Spec and story files (*.spec.*, *.test.*, *.stories.*) are ignored.
//   node ajs-facts.mjs summary [--root <dir>]
//   node ajs-facts.mjs list <components|directives|filters|services|downgrades|wrappers|states> [--unused] [--all] [--json]
//   node ajs-facts.mjs show <name> [--all]               (the fact card of one registered thing)
//   node ajs-facts.mjs usages <name> [--all]             (every use with file:line and the element or expression text)
//   node ajs-facts.mjs usages <name>.<attribute> [--all] (uses of one attribute of that element: an Angular input in kebab-case)
//   node ajs-facts.mjs --help
// --root is the folder that holds angular.json, a tsconfig or package.json; every source under it is read, because AngularJS
// code often lives outside the Angular source root. Exit code: 0 answered; 1 a wrong name, a wrong option or a missing package.
// Packages (typescript, @angular/compiler) are taken from the node_modules of --root, walking up, and then from the folder of
// this file, so the script may live outside the workspace. It never writes. Tests: node test/parser.test.mjs.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELP = `ajs-facts — facts about a hybrid AngularJS + Angular app, read with the TypeScript and Angular parsers (no text search).
  summary                      counts per kind and how many of each nothing uses
  list <kind> [--unused] [--under <folder>]
                               one line per item; kind: components | directives | filters | services | downgrades | wrappers | states;
                               --under keeps the items registered in a file of that folder and adds file:line to each line
  show <name>                  fact card: kind, file:line, bindings, template files, renders, filters applied, injects, twin, uses
  usages <name>                every use with file:line and the element or expression text; for a downgraded Angular
                               component also the attributes AngularJS templates put on it (inputs in kebab-case)
  usages <name>.<attribute>    the uses that carry one attribute, e.g. usages userCard.isActive finds is-active="…",
                               [is-active]="…" and bind-is-active="…" on <user-card> in AngularJS templates
Options: --root <dir> (default "."), --all (every line, not the first 12), --json (the index slice instead of text), --help.
--under <folder> is a path below --root (src/app/orders) or a piece of one (orders/); it belongs to list only.
Names: the registered camelCase name, its kebab-case element name, an Angular selector or a class name.
What counts as a use
  component   an element in an AngularJS template (.html file or inline template string), a ui-router state (component: "name"),
              or an UpgradeComponent wrapper whose selector is used in an Angular template
  directive   an element or attribute in an AngularJS template, according to its restrict
  filter      a pipe in an AngularJS template expression, $filter("name"), or an injected nameFilter
  service     an $inject array, an inline array annotation, $injector.get("name") or an Angular provider that upgrades it
"renders" lists the AngularJS components and directives a component's own template uses (ng-include partials followed);
downgraded Angular components are listed apart. "twin" is an Angular @Component whose selector equals the kebab-case name.
Comments, CSS classes and spec files never count. A row that ends with "(see note)" has something the tool could not read with
certainty: show <name> prints it, summary lists every note. Markup and names built at run time are not read at all.
Not seen: Angular templates beyond wrappers and twins (ng-facts), types (ls-facts), names in strings and styles (leftovers).`;

const OWN_FOLDER = path.dirname(fileURLToPath(import.meta.url));
const SHOWN = 12;
const WORKSPACE_MARKERS = [ "angular.json", "tsconfig.json", "tsconfig.app.json", "tsconfig.base.json", "nx.json", "project.json", "package.json" ];
const SKIPPED_DIRECTORIES = new Set([ "node_modules", "bower_components", "jspm_packages", "dist", "coverage", "out-tsc" ]);
/** Not sources: minified bundles and anything too large to be written by hand. */
const MINIFIED_FILE = /[.-]min\.[cm]?js$/;
const LARGEST_SOURCE = 1_500_000;

/** A wrong name, a wrong option, a missing package: exit code 1, message only. */
class Problem extends Error {}

// The two parsers. They are loaded in loadPackages, from the workspace first: the script must not import a package statically.
let ts;
let ng;
let htmlParser;
let expressionParser;

const slash = file => file.split(path.sep).join("/");
/** A path the reader can paste in any shell from any folder: absolute, forward slashes, in double quotes. */
const pasteable = file => `"${slash(path.resolve(file))}"`;

export async function loadPackages(root) {
    const found = {};
    for (const name of [ "typescript", "@angular/compiler" ]) {
        for (const from of [ root, OWN_FOLDER ]) {
            try {
                found[name] ??= createRequire(path.join(from, "package.json")).resolve(name);
            } catch {
                // not here: try the next place
            }
        }
    }
    const missing = [ "typescript", "@angular/compiler" ].filter(name => !found[name]);
    if (missing.length) {
        throw new Problem(`cannot find ${missing.join(" and ")}: not in the node_modules of ${slash(root)} (or of a folder above it) and not in ${slash(OWN_FOLDER)}.\n`
            + `Install the packages of the workspace (npm ci there), or put them next to this script:\n  npm install --prefix "${slash(OWN_FOLDER)}" --no-save ${missing.join(" ")}${existsSync(path.join(root, "angular.json")) || !existsSync(path.join(OWN_FOLDER, "doctor.mjs")) ? "" : `\nNot the folder of the app? node "${slash(path.join(OWN_FOLDER, "doctor.mjs"))}" --root "${slash(root)}" finds it and prints the folder to pass as --root.`}`);
    }
    ts = createRequire(import.meta.url)(found.typescript);
    ng = await import(pathToFileURL(found["@angular/compiler"]).href);
    htmlParser = new ng.HtmlParser();
    expressionParser = new ng.Parser(new ng.Lexer());
}

/**
 * The folder a command is about: --root when it holds angular.json, a tsconfig or package.json; else its only child folder
 * that does (said in a note); else --root itself when it holds sources at all.
 */
export function findWorkspace(rootArgument) {
    const asked = path.resolve(rootArgument);
    if (!statSync(asked, { throwIfNoEntry: false })?.isDirectory()) throw new Problem(`--root ${rootArgument}: no such directory`);
    const marked = directory => WORKSPACE_MARKERS.some(name => existsSync(path.join(directory, name)));
    if (marked(asked)) return { root: asked, notes: [] };
    const children = readdirSync(asked, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name) && marked(path.join(asked, entry.name)));
    if (children.length === 1) return { root: path.join(asked, children[0].name), notes: [ `${slash(asked)} holds no angular.json, tsconfig or package.json; its only folder that does is ${children[0].name}: that folder is used as the workspace` ] };
    if (children.length > 1) throw new Problem(`--root ${rootArgument} holds no angular.json, tsconfig or package.json and ${children.length} of its folders do (${children.map(entry => entry.name).join(", ")}): name one of them with --root`);
    return { root: asked, notes: [ "no angular.json, tsconfig or package.json in the root: every source file under it is read" ] };
}
const SPEC_FILE = /\.(?:spec|test|stories)\.[cm]?[jt]sx?$/;
const SOURCE_FILE = /\.[cm]?[jt]s$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
/**
 * What a TypeScript file must mention to hold anything this tool reads: AngularJS names, an Angular decorator with a template,
 * a downgrade or upgrade, a state-like object. Other .ts files (plain Angular services, models) are parsed only when an
 * import leads to them. Every .js file is read.
 */
const HOLDS_ANGULARJS = /angular\.|\$inject|\$injector|\$filter|\$state|\$templateCache|\$compile|\$provide|\$rootScope|\$scope|\$\w+Provider|\$parse|\$interpolate|\.\$(?:eval|evalAsync|watch|watchCollection)\b|@Component|@Directive|downgrade|UpgradeComponent|UpgradeModule|\.state\s*\(|\.module\s*\(|templateUrl|\btemplate\s*:|\bcomponent\s*:|\burl\s*:|ngInject|\brequire\s*\(/;
const REGISTRATIONS = new Set([ "component", "directive", "filter", "service", "factory", "controller", "provider", "constant", "value", "decorator" ]);
// Methods of an AngularJS module that return the module, so a chain of them still ends in the module it started from.
const MODULE_METHODS = new Set([ ...REGISTRATIONS, "config", "run", "animation", "info" ]);
// Registrations the lists are about: one of these on a receiver the tool cannot trace is worth a note.
const LISTED_REGISTRATIONS = new Set([ "component", "directive", "filter", "service", "factory" ]);
const EXPRESSION_CALLS = new Set([ "$eval", "$evalAsync", "$parse", "$interpolate", "$watch", "$watchCollection" ]);
const INJECTED_REGISTRATIONS = new Set([ "filter", "service", "factory", "controller", "provider", "decorator" ]);
const PROVIDER_OBJECTS = new Set([ "$provide", "$compileProvider", "$filterProvider", "$controllerProvider" ]);
const STATE_SHAPE = [ "url", "views", "abstract", "parent" ];
const STATE_INJECTED = [ "controller", "controllerProvider", "templateProvider", "onEnter", "onExit" ];
// Attributes of built-in directives whose value is a string (possibly with {{ }}), not an expression.
const TEXT_ATTRIBUTES = new Set([ "ngHref", "ngSrc", "ngSrcset", "ngBindTemplate", "ngSwitchWhen", "ngController", "ngApp", "ngForm", "ngTransclude", "ngTranscludeSlot", "ngMessage", "ngMessagesInclude", "ngList", "ngJq", "ngCloak", "ngNonBindable", "ngSwitchDefault", "ngView", "ngRepeatEnd", "ngStrictDi" ]);
const UI_EXPRESSION_ATTRIBUTES = new Set([ "uiSrefOpts", "uiState", "uiStateParams", "uiStateOpts" ]);
const NG_REPEAT = /^\s*([\s\S]+?)\s+in\s+([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+track\s+by\s+([\s\S]+?))?\s*$/;
const NG_OPTIONS = /^\s*([\s\S]+?)(?:\s+as\s+([\s\S]+?))?(?:\s+group\s+by\s+([\s\S]+?))?(?:\s+disable\s+when\s+([\s\S]+?))?\s+for\s+(?:[$\w]+|\(\s*[$\w]+\s*,\s*[$\w]+\s*\))\s+in\s+([\s\S]+?)(?:\s+track\s+by\s+([\s\S]+?))?\s*$/;
const BINDING = /^\s*([@&<=])\*?\??\s*([\w$]*)\s*$/;
const LIST_KINDS = [ "components", "directives", "filters", "services", "downgrades", "wrappers", "states" ];

/** userCard -> user-card, the way AngularJS derives the element name of a registration. */
export const kebabOf = name => name.replace(/[A-Z]/g, (letter, position) => (position ? "-" : "") + letter.toLowerCase());

// The HtmlParser writes <svg:rect> and <a:b> as ":svg:rect" and ":a:b"; only svg and math are real namespaces.
const withoutNamespace = name => name.replace(/^:([^:]*):/, (_match, namespace) => namespace === "svg" || namespace === "math" || namespace === "xlink" || namespace === "xml" ? "" : `${namespace}:`);

/** user-card, data-user-card, x-user:card -> userCard, the way AngularJS normalizes element and attribute names. */
export function normalizeName(raw) {
    return withoutNamespace(raw).toLowerCase().replace(/^(?:x|data)[:\-_]/, "").replace(/[:\-_]+(.)/g, (_match, letter) => letter.toUpperCase());
}

/**
 * An attribute as AngularJS templates write it on a downgraded Angular component, and the input or output it means:
 * is-active="x" and [is-active]="x" and bind-is-active="x" are the input isActive; (done) and on-done are the output done.
 */
export function bindingOf(raw) {
    const forms = [ [ /^\[\((.+)\)\]$/, "[(two-way)]" ], [ /^bindon-(.+)$/, "[(two-way)]" ], [ /^\[(.+)\]$/, "[bound]" ], [ /^bind-(.+)$/, "[bound]" ], [ /^\((.+)\)$/, "(event)" ], [ /^on-(.+)$/, "(event)" ] ];
    for (const [ pattern, form ] of forms) {
        const match = pattern.exec(raw);
        if (match) return { name: normalizeName(match[1]), form };
    }
    return { name: normalizeName(raw), form: "plain" };
}

const compact = (text, limit = 160) => {
    const single = text.replace(/\s+/g, " ").trim();
    return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
};
const countNewlines = text => text.split("\n").length - 1;

function lineIndex(text) {
    const starts = [ 0 ];
    for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) === 10) starts.push(index + 1);
    return offset => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= offset) low = middle;
            else high = middle - 1;
        }
        return low + 1;
    };
}

function listFiles(directory, skipped) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".") ? [] : listFiles(full, skipped);
        if (!entry.isFile() || !/\.(?:[cm]?[jt]s|html?)$/i.test(entry.name)) return [];
        if (MINIFIED_FILE.test(entry.name) || statSync(full).size > LARGEST_SOURCE) {
            skipped.push(full);
            return [];
        }
        return [ full ];
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// TypeScript side: small helpers that read values without running anything.

function unwrap(node) {
    let current = node;
    while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current))) current = current.expression;
    return current;
}

const propertyName = property => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : undefined;

/** The value node of `name` in an object literal: the initializer, the identifier of a shorthand property, or the method itself. */
function propertyOf(object, name) {
    for (const property of object.properties) {
        if (propertyName(property) !== name) continue;
        if (ts.isPropertyAssignment(property)) return property.initializer;
        if (ts.isShorthandPropertyAssignment(property)) return property.name;
        if (ts.isMethodDeclaration(property)) return property;
    }
    return undefined;
}

const isFunctionOrClass = node => Boolean(node) && (ts.isFunctionLike(node) || ts.isClassLike(node));

function insideDecorator(node) {
    for (let parent = node.parent; parent; parent = parent.parent) if (ts.isDecorator(parent)) return true;
    return false;
}

/** "./x" for require("./x"), undefined for anything else. */
function requiredModule(node) {
    const call = node && unwrap(node);
    if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "require" || call.arguments.length !== 1) return undefined;
    const [ specifier ] = call.arguments;
    return ts.isStringLiteralLike(specifier) ? specifier.text : undefined;
}

const scopeDeclarations = new WeakMap();

/** Names declared directly in a scope (source file, block or function): variables with an initializer, functions, classes, imports, parameters. */
function declaredIn(scope) {
    let found = scopeDeclarations.get(scope);
    if (found) return found;
    found = new Map();
    const add = (name, value) => {
        if (!found.has(name)) found.set(name, value);
    };
    if (ts.isFunctionLike(scope)) for (const parameter of scope.parameters ?? []) if (ts.isIdentifier(parameter.name)) add(parameter.name.text, { parameter });
    const statements = ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) ? scope.statements : [];
    for (const statement of statements) {
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                const module = declaration.initializer && requiredModule(declaration.initializer);
                if (ts.isIdentifier(declaration.name) && declaration.initializer) add(declaration.name.text, module === undefined ? { node: declaration.initializer } : { node: declaration.initializer, module, required: true });
                else if (ts.isObjectBindingPattern(declaration.name) && module !== undefined) {
                    for (const element of declaration.name.elements) {
                        const exported = element.propertyName ?? element.name;
                        if (ts.isIdentifier(element.name) && ts.isIdentifier(exported)) add(element.name.text, { module, exported: exported.text });
                    }
                }
            }
        } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
            add(statement.name.text, { node: statement });
        } else if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause) {
            const module = statement.moduleSpecifier.text;
            const { name, namedBindings } = statement.importClause;
            if (name) add(name.text, { module, exported: "default" });
            if (namedBindings && ts.isNamespaceImport(namedBindings)) add(namedBindings.name.text, { module, namespace: true });
            if (namedBindings && ts.isNamedImports(namedBindings)) for (const element of namedBindings.elements) add(element.name.text, { module, exported: (element.propertyName ?? element.name).text });
        }
    }
    scopeDeclarations.set(scope, found);
    return found;
}

const fileExports = new WeakMap();

/** What a source file exports, name -> value node; "default" is `export default x`, `export = x` or `module.exports = x`. */
function exportsOf(sourceFile) {
    let found = fileExports.get(sourceFile);
    if (found) return found;
    found = new Map();
    const has = (statement, kind) => ts.canHaveModifiers(statement) && Boolean(ts.getModifiers(statement)?.some(modifier => modifier.kind === kind));
    for (const statement of sourceFile.statements) {
        const exported = has(statement, ts.SyntaxKind.ExportKeyword);
        if (ts.isVariableStatement(statement) && exported) {
            for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) found.set(declaration.name.text, declaration.initializer);
        } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && exported) {
            const name = has(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : statement.name?.text;
            if (name) found.set(name, statement);
        } else if (ts.isExportAssignment(statement)) {
            found.set("default", statement.expression);
        } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
                const local = declaredIn(sourceFile).get((element.propertyName ?? element.name).text)?.node;
                if (local) found.set(element.name.text, local);
            }
        } else if (ts.isExpressionStatement(statement)) {
            const assignment = unwrap(statement.expression);
            if (!ts.isBinaryExpression(assignment) || assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isPropertyAccessExpression(assignment.left)) continue;
            const owner = assignment.left.expression.getText(sourceFile);
            if (owner === "module" && assignment.left.name.text === "exports") {
                found.set("default", assignment.right);
                const value = unwrap(assignment.right);
                if (ts.isObjectLiteralExpression(value)) for (const property of value.properties) if (propertyName(property) && propertyOf(value, propertyName(property))) found.set(propertyName(property), propertyOf(value, propertyName(property)));
            } else if (owner === "exports" || owner === "module.exports") {
                found.set(assignment.left.name.text, assignment.right);
            }
        }
    }
    fileExports.set(sourceFile, found);
    return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pass 1: every non-spec source file, one walk over its AST.

function scanSources(root, files, notes) {
    const sources = new Map();
    for (const absolute of files) {
        if (!SOURCE_FILE.test(absolute) || DECLARATION_FILE.test(absolute) || SPEC_FILE.test(absolute)) continue;
        const text = readFileSync(absolute, "utf8");
        const info = { absolute, file: path.relative(root, absolute).split(path.sep).join("/"), text, mentionsModule: /\.module\s*\(/.test(text), relevant: !/\.[cm]?ts$/.test(absolute) || HOLDS_ANGULARJS.test(text) };
        let parsed;
        Object.defineProperty(info, "sourceFile", { get: () => parsed ??= ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true) });
        info.lineAt = offset => info.sourceFile.getLineAndCharacterOfPosition(offset).line + 1;
        sources.set(absolute, info);
    }

    const raw = { sources, components: [], directives: [], filters: [], services: [], downgrades: [], others: [], states: [], sites: [], filterCalls: [], angular: [], inlineTemplates: new Map(), templateUrls: new Map(), cachedTemplates: [], codeExpressions: [], compiledMarkup: [] };
    const globalModules = new Map();
    const later = [];
    const injectAssignments = new Map();
    const getCalls = [];
    const injectorAliases = new Map();
    const stateObjects = new Map();
    const stateViews = new Set();
    const strayComponents = [];
    const implicitDone = new WeakSet();

    const lineOf = (node, fileInfo) => fileInfo.lineAt(node.getStart(fileInfo.sourceFile));
    const snippet = (node, fileInfo) => compact(node.getText(fileInfo.sourceFile), 120);
    const note = (fileInfo, node, message, subject) => notes.push({ file: fileInfo.file, line: lineOf(node, fileInfo), message, subject });
    const site = (name, kind, node, fileInfo) => raw.sites.push({ name, kind, file: fileInfo.file, line: lineOf(node, fileInfo), text: snippet(node, fileInfo) });

    function moduleFile(fileInfo, specifier) {
        if (!specifier.startsWith(".")) return undefined;
        const base = path.resolve(path.dirname(fileInfo.absolute), specifier);
        for (const candidate of [ base, `${base}.ts`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.js"), base.replace(/\.js$/, ".ts") ]) if (sources.has(candidate)) return sources.get(candidate);
        return undefined;
    }

    /** One export of a workspace file: an exported name, or any top-level declaration with that name (a script that shares its scope). */
    function exportOf(target, name) {
        const node = exportsOf(target.sourceFile).get(name) ?? (name === "default" ? undefined : declaredIn(target.sourceFile).get(name)?.node);
        return node ? { node, fileInfo: target } : undefined;
    }

    /**
     * The declaration an identifier refers to, looked up through the enclosing scopes and through relative imports: named, default
     * and namespace imports and require(). A namespace import comes back as { namespace: file }, to be read with resolveMember.
     */
    function resolveIdentifier(identifier, fileInfo) {
        for (let scope = identifier.parent; scope; scope = scope.parent) {
            if (!ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isModuleBlock(scope) && !ts.isFunctionLike(scope)) continue;
            const found = declaredIn(scope).get(identifier.text);
            if (!found) continue;
            if (found.parameter) return { parameter: found.parameter, fileInfo };
            if (found.module === undefined) return { node: found.node, fileInfo };
            const target = moduleFile(fileInfo, found.module);
            if (!target) return found.node ? { node: found.node, fileInfo } : undefined;
            if (found.exported !== undefined) return exportOf(target, found.exported);
            return (found.required && exportOf(target, "default")) || { namespace: target };
        }
        return undefined;
    }

    /** `owner.name` where owner is a namespace import, a required module or a constant object literal: the node behind that name. */
    function resolveMember(access, fileInfo, depth = 0) {
        const object = unwrap(access.expression);
        let owner;
        if (ts.isIdentifier(object)) owner = resolveIdentifier(object, fileInfo);
        else if (ts.isPropertyAccessExpression(object) && depth < 8) owner = resolveMember(object, fileInfo, depth + 1);
        else if (requiredModule(object) !== undefined) {
            const target = moduleFile(fileInfo, requiredModule(object));
            owner = target && (exportOf(target, "default") ?? { namespace: target });
        }
        if (owner?.namespace) return exportOf(owner.namespace, access.name.text);
        const value = owner?.node && depth < 8 ? resolve(owner.node, owner.fileInfo, depth + 1) : undefined;
        const property = value?.node && ts.isObjectLiteralExpression(value.node) ? propertyOf(value.node, access.name.text) : undefined;
        return property ? { node: property, fileInfo: value.fileInfo } : undefined;
    }

    /** Follows identifiers, imported names and require() to what they were declared as; the result is the last node that could be reached. */
    function resolve(node, fileInfo, depth = 0) {
        const value = unwrap(node);
        if (!value || depth >= 8) return { node: value, fileInfo };
        let target;
        if (ts.isIdentifier(value)) target = resolveIdentifier(value, fileInfo);
        else if (ts.isPropertyAccessExpression(value)) target = resolveMember(value, fileInfo, depth);
        else if (requiredModule(value) !== undefined) {
            const required = moduleFile(fileInfo, requiredModule(value));
            target = required && exportOf(required, "default");
        }
        return target?.node && target.node !== value ? resolve(target.node, target.fileInfo, depth + 1) : { node: value, fileInfo };
    }

    /** A constant string as pieces with their position in the file: literals, "a" + "b", [ "a", "b" ].join(""), constants. */
    function stringPieces(node, fileInfo, depth = 0) {
        const value = unwrap(node);
        if (!value || depth > 8) return undefined;
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
            const offset = value.getStart(fileInfo.sourceFile) + 1;
            const written = fileInfo.text.slice(offset, value.getEnd() - 1).replace(/\r\n/g, "\n");
            return [ { text: value.text, offset, fileInfo, raw: written === value.text } ];
        }
        if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = stringPieces(value.left, fileInfo, depth + 1);
            const right = left && stringPieces(value.right, fileInfo, depth + 1);
            return right ? [ ...left, ...right ] : undefined;
        }
        if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression) && value.expression.name.text === "join") {
            const list = unwrap(value.expression.expression);
            if (!ts.isArrayLiteralExpression(list)) return undefined;
            const separator = value.arguments.length ? stringPieces(value.arguments[0], fileInfo, depth + 1)?.map(piece => piece.text).join("") : ",";
            if (separator === undefined) return undefined;
            const joined = [];
            for (const element of list.elements) {
                const pieces = stringPieces(element, fileInfo, depth + 1);
                if (!pieces) return undefined;
                if (joined.length && separator) joined.push({ text: separator, offset: pieces[0].offset, fileInfo: pieces[0].fileInfo, raw: false });
                joined.push(...pieces);
            }
            return joined.length ? joined : undefined;
        }
        if (ts.isIdentifier(value)) {
            const target = resolveIdentifier(value, fileInfo);
            return target?.node ? stringPieces(target.node, target.fileInfo, depth + 1) : undefined;
        }
        return undefined;
    }

    const stringOf = (node, fileInfo) => node ? stringPieces(node, fileInfo)?.map(piece => piece.text).join("") : undefined;

    function inlineTemplate(pieces) {
        const [ first ] = pieces;
        return {
            id: `${first.fileInfo.file}#${first.offset}`,
            file: first.fileInfo.file,
            inline: true,
            text: pieces.map(piece => piece.text).join(""),
            lineAt: offset => {
                let consumed = 0;
                for (const piece of pieces) {
                    if (offset < consumed + piece.text.length || piece === pieces.at(-1)) {
                        const base = piece.fileInfo.lineAt(piece.offset);
                        return piece.raw ? base + countNewlines(piece.text.slice(0, Math.max(0, offset - consumed))) : base;
                    }
                    consumed += piece.text.length;
                }
                return first.fileInfo.lineAt(first.offset);
            }
        };
    }

    /** What a function, class or inline array annotation asks the injector for: $inject wins, then the array, then parameter names. */
    function injectionOf(node, fileInfo) {
        if (!node) return [];
        const target = resolve(node, fileInfo);
        let value = target.node;
        if (value && ts.isArrayLiteralExpression(value)) return value.elements.slice(0, -1).map(element => stringOf(element, target.fileInfo)).filter(Boolean);
        if (!isFunctionOrClass(value)) return [];
        const assigned = injectAssignments.get(value);
        if (assigned) return assigned;
        if (ts.isClassLike(value)) {
            const member = value.members.find(candidate => ts.isPropertyDeclaration(candidate) && propertyName(candidate) === "$inject" && candidate.initializer);
            const list = member && unwrap(member.initializer);
            if (list && ts.isArrayLiteralExpression(list)) return list.elements.map(element => stringOf(element, target.fileInfo)).filter(Boolean);
            value = value.members.find(candidate => ts.isConstructorDeclaration(candidate));
            if (!value) return [];
        }
        const names = value.parameters.filter(parameter => ts.isIdentifier(parameter.name)).map(parameter => parameter.name.text);
        if (!implicitDone.has(value)) {
            implicitDone.add(value);
            for (const parameter of value.parameters) if (ts.isIdentifier(parameter.name)) site(parameter.name.text, "implicit", parameter, target.fileInfo);
        }
        return names;
    }

    /** A name that no scope of its file declares: the module a script elsewhere keeps in a top-level variable (`var app = angular.module(...)`). */
    function globalModule(name) {
        if (!globalModules.has(name)) {
            globalModules.set(name, undefined);
            for (const candidate of sources.values()) {
                if (!candidate.mentionsModule) continue;
                const declared = declaredIn(candidate.sourceFile).get(name);
                const chain = declared?.node && !declared.module ? moduleChain(declared.node, candidate, 4) : undefined;
                if (chain && !chain.untraced) {
                    globalModules.set(name, chain);
                    break;
                }
            }
        }
        return globalModules.get(name);
    }

    /**
     * Is this receiver an angular.module(...) chain (or $provide and friends)? Returns the module name when it is written out.
     * { untraced: true } is a receiver that cannot be followed to its declaration but is used the way a module is: directly or
     * through module methods only, in a file that calls .module( or as a function parameter.
     */
    function moduleChain(expression, fileInfo, depth = 0) {
        let current = unwrap(expression);
        let moduleMethodsOnly = true;
        while (current && depth < 6) {
            if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
                if (current.expression.name.text === "module") return { module: stringOf(current.arguments[0], fileInfo) };
                if (!MODULE_METHODS.has(current.expression.name.text)) moduleMethodsOnly = false;
                current = unwrap(current.expression.expression);
                continue;
            }
            if (requiredModule(current) !== undefined) {
                const target = resolve(current, fileInfo);
                return target.node !== current ? moduleChain(target.node, target.fileInfo, depth + 1) : undefined;
            }
            if (ts.isIdentifier(current)) {
                if (PROVIDER_OBJECTS.has(current.text)) return {};
                const target = resolveIdentifier(current, fileInfo);
                if (target?.node) return moduleChain(target.node, target.fileInfo, depth + 1);
                if (!moduleMethodsOnly) return undefined;
                if (!target) {
                    const shared = globalModule(current.text);
                    if (shared) return shared;
                }
                return fileInfo.mentionsModule || target?.parameter ? { untraced: true } : undefined;
            }
            if (ts.isPropertyAccessExpression(current)) {
                const member = resolveMember(current, fileInfo, depth);
                if (member) return moduleChain(member.node, member.fileInfo, depth + 1);
                return moduleMethodsOnly && fileInfo.mentionsModule ? { untraced: true } : undefined;
            }
            return undefined;
        }
        return undefined;
    }

    const isCallTo = (node, name) => Boolean(node) && ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === name) || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name));

    function bindingsOf(node, fileInfo) {
        const target = node && resolve(node, fileInfo);
        const bindings = {};
        if (!target?.node || !ts.isObjectLiteralExpression(target.node)) return bindings;
        for (const property of target.node.properties) {
            const name = propertyName(property);
            const value = ts.isPropertyAssignment(property) ? stringOf(property.initializer, target.fileInfo) : undefined;
            if (name && value !== undefined) bindings[name] = value;
        }
        return bindings;
    }

    /** The object literal a directive factory returns (its definition object), if it can be found. */
    function returnedObject(node, fileInfo) {
        let target = resolve(node, fileInfo);
        if (target.node && ts.isArrayLiteralExpression(target.node) && target.node.elements.length) target = resolve(target.node.elements.at(-1), target.fileInfo);
        const factory = target.node;
        if (!factory || !ts.isFunctionLike(factory) || !factory.body) return undefined;
        if (!ts.isBlock(factory.body)) {
            const direct = resolve(factory.body, target.fileInfo);
            return direct.node && ts.isObjectLiteralExpression(direct.node) ? direct : undefined;
        }
        let found;
        factory.body.forEachChild(function visit(child) {
            if (found || ts.isFunctionLike(child)) return;
            if (ts.isReturnStatement(child) && child.expression) {
                const returned = resolve(child.expression, target.fileInfo);
                if (returned.node && ts.isObjectLiteralExpression(returned.node)) found = returned;
                return;
            }
            child.forEachChild(visit);
        });
        return found;
    }

    function registerOne(method, name, valueNode, anchor, fileInfo, chain) {
        const base = { name, file: fileInfo.file, line: lineOf(anchor, fileInfo), module: chain.module };
        const target = valueNode ? resolve(valueNode, fileInfo) : { node: undefined, fileInfo };
        const value = target.node;
        if (chain.untraced && LISTED_REGISTRATIONS.has(method)) note(fileInfo, anchor, `.${method}("${name}", ...) on a receiver that could not be traced to angular.module(...): indexed on the assumption that it is an AngularJS module`, name);
        if (isCallTo(value, "downgradeComponent")) {
            const options = unwrap(value.arguments[0]);
            const component = options && ts.isObjectLiteralExpression(options) ? propertyOf(options, "component") : undefined;
            const named = key => {
                const list = options && ts.isObjectLiteralExpression(options) ? propertyOf(options, key) : undefined;
                return list && ts.isArrayLiteralExpression(unwrap(list)) ? unwrap(list).elements.map(element => stringOf(element, target.fileInfo)).filter(Boolean) : undefined;
            };
            raw.downgrades.push({ ...base, kind: "component", className: component ? unwrap(component).getText(target.fileInfo.sourceFile) : "?", inputs: named("inputs"), outputs: named("outputs") });
            return;
        }
        if (isCallTo(value, "downgradeInjectable")) {
            raw.downgrades.push({ ...base, kind: "injectable", className: value.arguments[0] ? unwrap(value.arguments[0]).getText(target.fileInfo.sourceFile) : "?" });
            return;
        }
        if (method === "component") {
            // .component("name", new Definition()): the class's own property declarations are the definition.
            const instantiated = value && ts.isNewExpression(value) ? resolve(value.expression, target.fileInfo) : undefined;
            if (instantiated?.node && ts.isClassLike(instantiated.node)) {
                const definition = instantiated.node;
                const member = key => definition.members.find(candidate => ts.isPropertyDeclaration(candidate) && propertyName(candidate) === key && candidate.initializer)?.initializer;
                const pieces = member("template") && stringPieces(member("template"), instantiated.fileInfo);
                const url = member("templateUrl") && stringOf(member("templateUrl"), instantiated.fileInfo);
                if (pieces) raw.inlineTemplates.set(definition, inlineTemplate(pieces));
                if (url !== undefined) raw.templateUrls.set(definition, { url, file: instantiated.fileInfo.file, line: lineOf(member("templateUrl"), instantiated.fileInfo) });
                if (!pieces && url === undefined) note(fileInfo, anchor, `.component("${name}", new ${definition.name?.text ?? "class"}()) whose class declares no constant template or templateUrl: what it renders is unknown`, name);
                raw.components.push({ ...base, bindings: bindingsOf(member("bindings"), instantiated.fileInfo), injects: injectionOf(member("controller"), instantiated.fileInfo), definition });
                return;
            }
            if (!value || !ts.isObjectLiteralExpression(value)) {
                note(fileInfo, anchor, `.component("${name}", ...) whose definition is not an object literal: registered, but its template and bindings are unknown`, name);
                raw.components.push({ ...base, bindings: {}, injects: [], definition: undefined });
                return;
            }
            raw.components.push({ ...base, bindings: bindingsOf(propertyOf(value, "bindings"), target.fileInfo), injects: injectionOf(propertyOf(value, "controller"), target.fileInfo), definition: value });
            return;
        }
        if (method === "directive") {
            const definition = valueNode ? returnedObject(valueNode, fileInfo) : undefined;
            const object = definition?.node;
            const restrict = object ? stringOf(propertyOf(object, "restrict"), definition.fileInfo) : undefined;
            const scope = object && [ "scope", "bindToController" ].map(key => bindingsOf(propertyOf(object, key), definition.fileInfo)).reduce((all, part) => ({ ...all, ...part }), {});
            if (!object) note(fileInfo, anchor, `.directive("${name}", ...) whose definition object could not be read: restrict "EA" assumed`, name);
            raw.directives.push({ ...base, restrict: restrict ?? "EA", bindings: scope ?? {}, injects: [ ...injectionOf(valueNode, fileInfo), ...(object ? injectionOf(propertyOf(object, "controller"), definition.fileInfo) : []) ], definition: object });
            return;
        }
        const injects = INJECTED_REGISTRATIONS.has(method) ? injectionOf(valueNode, fileInfo) : [];
        if (method === "filter") raw.filters.push({ ...base, injects });
        else if (method === "service" || method === "factory") raw.services.push({ ...base, kind: method, injects, className: valueNode && ts.isIdentifier(valueNode) ? valueNode.text : undefined });
        else raw.others.push({ ...base, kind: method });
    }

    function register(call, callee, method, fileInfo) {
        const chain = moduleChain(callee.expression, fileInfo);
        const [ first, second ] = call.arguments;
        if (!chain) {
            const literal = first && unwrap(first);
            if (LISTED_REGISTRATIONS.has(method) && second && literal && ts.isStringLiteralLike(literal)) note(fileInfo, call, `.${method}("${literal.text}", ...) on a receiver that is not an AngularJS module as far as the tool can follow it (${compact(callee.expression.getText(fileInfo.sourceFile), 50)}): not indexed`, literal.text);
            return;
        }
        const only = first && unwrap(first);
        if (call.arguments.length === 1 && only && ts.isObjectLiteralExpression(only) && !chain.untraced) {
            for (const property of only.properties) {
                const name = propertyName(property);
                if (name) registerOne(method, name, propertyOf(only, name), property, fileInfo, chain);
            }
            return;
        }
        const name = stringOf(first, fileInfo);
        const factory = second && unwrap(second);
        if (chain.untraced && method === "filter" && !(factory && (ts.isFunctionLike(factory) || ts.isArrayLiteralExpression(factory) || ts.isIdentifier(factory)))) return;
        if (name === undefined || call.arguments.length < 2) {
            if (!chain.untraced) note(fileInfo, callee.name, `.${method}(...) on an AngularJS module with a name that is not a string constant: not indexed`);
            return;
        }
        registerOne(method, name, second, first, fileInfo, chain);
    }

    function registerState(nameNode, objectNode, fileInfo, anchor) {
        const target = resolve(objectNode, fileInfo);
        const object = target.node;
        if (!object || !ts.isObjectLiteralExpression(object)) {
            note(fileInfo, anchor, "ui-router state whose definition is not an object literal: not indexed");
            return;
        }
        if (stateObjects.has(object)) return;
        const written = nameNode ?? propertyOf(object, "name");
        const name = (nameNode && stringOf(nameNode, fileInfo)) ?? stringOf(propertyOf(object, "name"), target.fileInfo) ?? (written ? compact(unwrap(written).getText((nameNode ? fileInfo : target.fileInfo).sourceFile), 70) : "?");
        const named = nameNode ? fileInfo : target.fileInfo;
        const state = { name, file: named.file, line: lineOf(nameNode ?? object, named), components: [], views: [] };
        stateObjects.set(object, state);
        const url = stringOf(propertyOf(object, "url"), target.fileInfo);
        if (url !== undefined) state.url = url;
        const views = [ object ];
        const viewsNode = propertyOf(object, "views");
        const viewsObject = viewsNode && resolve(viewsNode, target.fileInfo).node;
        if (viewsObject && ts.isObjectLiteralExpression(viewsObject)) {
            for (const property of viewsObject.properties) {
                // the unnamed view is written "": an empty name is still a name
                const value = propertyName(property) !== undefined && propertyOf(viewsObject, propertyName(property));
                const view = value && resolve(value, target.fileInfo).node;
                if (view && ts.isObjectLiteralExpression(view)) views.push(view);
                else if (view && ts.isStringLiteralLike(view)) state.components.push({ name: view.text, line: lineOf(view, target.fileInfo) });
            }
        }
        for (const view of views) {
            stateViews.add(view);
            state.views.push(view);
            const component = propertyOf(view, "component");
            const componentName = component && stringOf(component, target.fileInfo);
            if (componentName !== undefined) state.components.push({ name: componentName, line: lineOf(component, target.fileInfo) });
            else if (component) state.componentClass = unwrap(component).getText(target.fileInfo.sourceFile);
            const controller = propertyOf(view, "controller");
            if (controller && !state.controller) state.controller = compact(stringOf(controller, target.fileInfo) ?? (ts.isIdentifier(unwrap(controller)) ? unwrap(controller).text : "inline function"), 60);
            for (const key of STATE_INJECTED) injectionOf(propertyOf(view, key), target.fileInfo);
        }
        const resolves = propertyOf(object, "resolve");
        const resolveObject = resolves && resolve(resolves, target.fileInfo).node;
        if (resolveObject && ts.isObjectLiteralExpression(resolveObject)) {
            for (const property of resolveObject.properties) {
                const value = propertyName(property) !== undefined && propertyOf(resolveObject, propertyName(property));
                if (!value) continue;
                const text = ts.isStringLiteralLike(unwrap(value)) ? unwrap(value).text : undefined;
                if (text !== undefined) site(text, "resolve", value, target.fileInfo);
                else injectionOf(value, target.fileInfo);
            }
        }
        raw.states.push(state);
    }

    function visitCall(call, fileInfo) {
        const callee = unwrap(call.expression);
        const [ first ] = call.arguments;
        if ((ts.isIdentifier(callee) && callee.text === "$filter") || (ts.isPropertyAccessExpression(callee) && callee.name.text === "$filter")) {
            const name = stringOf(first, fileInfo);
            if (name !== undefined) raw.filterCalls.push({ name, file: fileInfo.file, line: lineOf(call, fileInfo), text: snippet(call, fileInfo) });
            else if (first) note(fileInfo, call, "$filter(...) called with a name that is not a string constant: not counted as a use of any filter");
            return;
        }
        const called = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
        if (called === "$compile" || EXPRESSION_CALLS.has(called)) {
            const written = first && stringOf(first, fileInfo);
            if (written !== undefined && called === "$compile") raw.compiledMarkup.push({ markup: written, file: fileInfo.file, line: lineOf(call, fileInfo), text: snippet(call, fileInfo) });
            else if (written !== undefined) raw.codeExpressions.push({ names: scanFilters(written), file: fileInfo.file, line: lineOf(call, fileInfo), text: snippet(call, fileInfo) });
        }
        if (!ts.isPropertyAccessExpression(callee)) return;
        const method = callee.name.text;
        const receiverName = ts.isIdentifier(unwrap(callee.expression)) ? unwrap(callee.expression).text : ts.isPropertyAccessExpression(unwrap(callee.expression)) ? unwrap(callee.expression).name.text : undefined;
        if (method === "put" && receiverName === "$templateCache" && call.arguments.length > 1) {
            const identifier = stringOf(first, fileInfo);
            const pieces = stringPieces(call.arguments[1], fileInfo);
            if (identifier !== undefined && pieces) raw.cachedTemplates.push({ identifier, template: inlineTemplate(pieces) });
            else note(fileInfo, call, `$templateCache.put(...) whose name or markup is not a string constant (${snippet(call, fileInfo)}): that markup is not analysed`);
            return;
        }
        if (REGISTRATIONS.has(method)) later.push(() => register(call, callee, method, fileInfo));
        else if (method === "state" && first) later.push(() => {
            if (stringOf(first, fileInfo) !== undefined && call.arguments.length > 1) registerState(first, call.arguments[1], fileInfo, call);
            else if (ts.isObjectLiteralExpression(resolve(first, fileInfo).node ?? first)) registerState(undefined, first, fileInfo, call);
        });
        else if ((method === "run" || method === "config") && first) later.push(() => {
            if (moduleChain(callee.expression, fileInfo)) injectionOf(first, fileInfo);
        });
        else if (method === "get" && first) {
            const name = stringOf(first, fileInfo);
            if (name === undefined) return;
            const receiver = unwrap(callee.expression);
            const traced = (ts.isIdentifier(receiver) && receiver.text === "$injector") || (ts.isPropertyAccessExpression(receiver) && receiver.name.text === "$injector") || isCallTo(receiver, "injector") || (isCallTo(receiver, "inject") && injectorToken(receiver.arguments[0]));
            if (traced) site(name, "$injector.get", call, fileInfo);
            else getCalls.push({ name, call, receiver, fileInfo, traced: false });
        }
    }

    function visitAssignment(node, fileInfo) {
        if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isPropertyAccessExpression(node.left)) return;
        if ((node.left.name.text === "template" || node.left.name.text === "templateUrl") && fileInfo.mentionsModule && ts.isIdentifier(unwrap(node.left.expression))) {
            note(fileInfo, node, `${node.left.getText(fileInfo.sourceFile)} is assigned after the object was declared (${snippet(node.right, fileInfo)}): that markup is not analysed`);
            return;
        }
        if (node.left.name.text !== "$inject") return;
        const list = unwrap(node.right);
        if (!ts.isArrayLiteralExpression(list)) {
            note(fileInfo, node, "$inject assigned something that is not an array literal: its names are not counted");
            return;
        }
        const names = list.elements.map(element => stringOf(element, fileInfo)).filter(name => name !== undefined);
        list.elements.forEach(element => {
            const name = stringOf(element, fileInfo);
            if (name !== undefined) site(name, "$inject", element, fileInfo);
        });
        later.unshift(() => {
            const owner = resolve(node.left.expression, fileInfo).node;
            if (owner) injectAssignments.set(owner, names);
        });
    }

    function visitArray(list, fileInfo) {
        if (list.elements.length < 2) return;
        const last = unwrap(list.elements.at(-1));
        if (!list.elements.slice(0, -1).every(element => ts.isStringLiteralLike(unwrap(element)))) return;
        const annotated = isFunctionOrClass(last) || (ts.isIdentifier(last) && isFunctionOrClass(resolve(last, fileInfo).node));
        if (annotated) for (const element of list.elements.slice(0, -1)) site(unwrap(element).text, "array", element, fileInfo);
    }

    const injectorToken = node => {
        const value = node && unwrap(node);
        return Boolean(value) && ts.isStringLiteralLike(value) && value.text === "$injector";
    };
    const alias = (fileInfo, name) => {
        if (!injectorAliases.has(fileInfo)) injectorAliases.set(fileInfo, new Set());
        injectorAliases.get(fileInfo).add(name);
    };

    function visitObject(object, fileInfo) {
        const deps = propertyOf(object, "deps");
        const factory = propertyOf(object, "useFactory");
        if (deps && factory) later.push(() => {
            const list = resolve(deps, fileInfo).node;
            const position = list && ts.isArrayLiteralExpression(list) ? list.elements.findIndex(injectorToken) : -1;
            const target = resolve(factory, fileInfo);
            const parameter = position >= 0 && target.node && ts.isFunctionLike(target.node) ? target.node.parameters[position] : undefined;
            if (!parameter || !ts.isIdentifier(parameter.name)) return;
            for (const candidate of getCalls) {
                if (candidate.traced || candidate.fileInfo !== target.fileInfo || candidate.call.pos < target.node.pos || candidate.call.end > target.node.end) continue;
                if (!ts.isIdentifier(candidate.receiver) || candidate.receiver.text !== parameter.name.text) continue;
                candidate.traced = true;
                site(candidate.name, "upgrade-provider", candidate.call, candidate.fileInfo);
            }
        });
        // Everything below is about AngularJS definition objects; the metadata of an Angular decorator is read in visitClass.
        if (insideDecorator(object)) return;
        for (const property of object.properties) {
            const name = propertyName(property);
            if (name !== "template" && name !== "templateUrl") continue;
            const value = propertyOf(object, name);
            if (!value) continue;
            const pieces = stringPieces(value, fileInfo);
            const required = name === "template" && !pieces ? requiredModule(value) : undefined;
            if (required !== undefined && /\.html?$/i.test(required)) {
                raw.templateUrls.set(object, { url: required, file: fileInfo.file, line: lineOf(property, fileInfo) });
                continue;
            }
            if (name === "template" && pieces) raw.inlineTemplates.set(object, inlineTemplate(pieces));
            else if (name === "templateUrl" && pieces) raw.templateUrls.set(object, { url: pieces.map(piece => piece.text).join(""), file: fileInfo.file, line: lineOf(property, fileInfo) });
            else note(fileInfo, property, `${name} is not a string constant (${compact(unwrap(value).getText(fileInfo.sourceFile), 50)}): that markup is not analysed`);
        }
        const component = propertyOf(object, "component");
        if (component && ts.isStringLiteralLike(unwrap(component))) strayComponents.push({ object, name: unwrap(component).text, node: component, fileInfo });
        const hasName = stringOf(propertyOf(object, "name"), fileInfo) !== undefined;
        // { name: "Some vendor", url: "https://…" } is a link, not a state: the url of a state is a path
        const address = stringOf(propertyOf(object, "url"), fileInfo);
        const shaped = STATE_SHAPE.some(key => propertyOf(object, key) && (key !== "url" || address === undefined || /^(?:$|[/?^:{])/.test(address)));
        if (hasName && (shaped || (component && ts.isStringLiteralLike(unwrap(component))))) later.push(() => registerState(undefined, object, fileInfo, object));
    }

    function visitClass(node, fileInfo) {
        const extended = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
        const isWrapper = Boolean(extended) && /(^|\.)UpgradeComponent$/.test(extended.getText(fileInfo.sourceFile));
        let upgraded;
        if (isWrapper) {
            node.forEachChild(function visit(child) {
                if (upgraded === undefined && ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.SuperKeyword) upgraded = stringOf(child.arguments[0], fileInfo);
                child.forEachChild(visit);
            });
            if (upgraded === undefined) note(fileInfo, node, `${node.name?.text ?? "class"} extends UpgradeComponent but its super("name", ...) call could not be read`);
        }
        for (const decorator of ts.getDecorators(node) ?? []) {
            const call = decorator.expression;
            if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || (call.expression.text !== "Component" && call.expression.text !== "Directive")) continue;
            const metadata = call.arguments[0] && unwrap(call.arguments[0]);
            if (!metadata || !ts.isObjectLiteralExpression(metadata)) continue;
            const declaration = { className: node.name?.text ?? "(anonymous)", kind: call.expression.text, selector: stringOf(propertyOf(metadata, "selector"), fileInfo), file: fileInfo.file, line: lineOf(node, fileInfo), upgraded: isWrapper ? upgraded ?? "?" : undefined };
            const inline = propertyOf(metadata, "template");
            const url = stringOf(propertyOf(metadata, "templateUrl"), fileInfo);
            const pieces = inline && stringPieces(inline, fileInfo);
            if (pieces) declaration.template = inlineTemplate(pieces);
            else if (inline) note(fileInfo, inline, `template of ${declaration.className} is not a string constant: not analysed`);
            if (url !== undefined) declaration.templateFile = path.resolve(path.dirname(fileInfo.absolute), url);
            raw.angular.push(declaration);
        }
    }

    for (const fileInfo of sources.values()) {
        if (!fileInfo.relevant) continue;
        try {
            fileInfo.sourceFile.forEachChild(function visit(node) {
                if (ts.isCallExpression(node)) visitCall(node, fileInfo);
                else if (ts.isBinaryExpression(node)) visitAssignment(node, fileInfo);
                else if (ts.isArrayLiteralExpression(node)) visitArray(node, fileInfo);
                else if (ts.isObjectLiteralExpression(node)) visitObject(node, fileInfo);
                else if (ts.isClassDeclaration(node)) visitClass(node, fileInfo);
                else if (ts.isPropertyDeclaration(node) && propertyName(node) === "$inject" && node.initializer && ts.isArrayLiteralExpression(unwrap(node.initializer))) {
                    for (const element of unwrap(node.initializer).elements) {
                        const name = stringOf(element, fileInfo);
                        if (name !== undefined) site(name, "$inject", element, fileInfo);
                    }
                } else if (ts.isParameter(node) && ts.isIdentifier(node.name) && (ts.getDecorators(node) ?? []).some(decorator => isCallTo(decorator.expression, "Inject") && injectorToken(decorator.expression.arguments[0]))) {
                    alias(fileInfo, node.name.text);
                }
                if ((ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) && ts.isIdentifier(node.name) && node.initializer && isCallTo(unwrap(node.initializer), "inject") && injectorToken(unwrap(node.initializer).arguments[0])) alias(fileInfo, node.name.text);
                node.forEachChild(visit);
            });
        } catch (error) {
            notes.push({ file: fileInfo.file, line: 1, message: `could not be analysed completely: ${error.message}` });
        }
    }
    for (const task of later) {
        try {
            task();
        } catch (error) {
            notes.push({ file: "(tool)", line: 0, message: `a registration could not be read: ${error.message}` });
        }
    }
    for (const candidate of getCalls) {
        if (candidate.traced) continue;
        const names = injectorAliases.get(candidate.fileInfo);
        const receiver = candidate.receiver;
        const name = ts.isIdentifier(receiver) ? receiver.text : ts.isPropertyAccessExpression(receiver) ? receiver.name.text : undefined;
        if (names?.has(name)) {
            candidate.traced = true;
            site(candidate.name, "$injector.get", candidate.call, candidate.fileInfo);
        }
    }
    raw.untracedGets = getCalls.filter(candidate => !candidate.traced).map(candidate => ({ name: candidate.name, file: candidate.fileInfo.file, line: lineOf(candidate.call, candidate.fileInfo), text: snippet(candidate.call, candidate.fileInfo) }));
    raw.strayComponents = strayComponents.filter(entry => !stateViews.has(entry.object)).map(entry => ({ name: entry.name, file: entry.fileInfo.file, line: lineOf(entry.node, entry.fileInfo) }));
    return raw;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pass 2: AngularJS templates, read with the Angular compiler's HtmlParser and expression parser.


function walkExpression(ast, visit) {
    if (!(ast instanceof ng.AST)) return;
    visit(ast);
    for (const value of Object.values(ast)) {
        if (value instanceof ng.AST) walkExpression(value, visit);
        else if (Array.isArray(value)) for (const item of value) walkExpression(item, visit);
    }
}

/** Filter names by a scan that only knows string literals and "||": the cross-check and the fallback for the expression parser. */
export function scanFilters(text) {
    const names = [];
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (character === "'" || character === "\"") {
            for (index++; index < text.length && text[index] !== character; index++) if (text[index] === "\\") index++;
            continue;
        }
        if (character !== "|") continue;
        if (text[index + 1] === "|") {
            index++;
            continue;
        }
        const match = /^\s*([A-Za-z_$][\w$]*)/.exec(text.slice(index + 1));
        if (match) names.push(match[1]);
    }
    return names;
}

/**
 * The filters applied in one AngularJS expression. The Angular expression parser reads it (binding first, then action for
 * assignments and "a(); b()"); the one-time "::" prefix is stripped first. When the parser gives up, or disagrees with the
 * scan, the scan's names are used as well and the place is reported.
 */
function filtersIn(source, span, context, where, tolerant = false) {
    let text = source.trim();
    if (text.startsWith("::")) text = text.slice(2).trim();
    if (!text) return [];
    const scanned = scanFilters(text);
    let parsed;
    for (const mode of [ "parseBinding", "parseAction" ]) {
        try {
            const result = expressionParser[mode](text, span, 0);
            if (result.errors.length) continue;
            const names = [];
            walkExpression(result, node => {
                if (node instanceof ng.BindingPipe) names.push(node.name);
            });
            parsed = { names, mode };
            break;
        } catch {
            // falls through to the scan
        }
    }
    if (parsed && [ ...parsed.names ].sort().join() === [ ...scanned ].sort().join()) {
        context.stats[parsed.mode === "parseBinding" ? "parsed" : "parsedAsAction"]++;
        return parsed.names;
    }
    if (tolerant && !parsed) return [];
    context.stats.scanned++;
    const names = [ ...new Set([ ...(parsed?.names ?? []), ...scanned ]) ];
    context.note(where.file, where.line, `expression the Angular expression parser does not accept as written; filter names taken from a conservative scan (${names.join(", ") || "none"}): ${compact(text, 90)}`);
    return names;
}

/** {{ ... }} parts of a text or attribute value, found the way AngularJS's $interpolate finds them. */
function interpolations(value) {
    const parts = [];
    for (let start = value.indexOf("{{"); start >= 0; start = value.indexOf("{{", start)) {
        const end = value.indexOf("}}", start + 2);
        if (end < 0) break;
        parts.push({ expression: value.slice(start + 2, end), index: start });
        start = end + 2;
    }
    return parts;
}

function attributeKind(element, attribute, registry) {
    const { raw, name } = attribute;
    if (/^[[(]/.test(raw)) return "expression";
    if (registry.downgradedComponents.has(element.name) && /^(bind-|on-|bindon-)/.test(raw)) return "expression";
    if (name === "ngRepeat" || name === "ngRepeatStart") return "repeat";
    if (name === "ngOptions") return "options";
    if (name === "uiSref") return "sref";
    if (element.name === "ngInclude" && name === "src") return "expression";
    if (name === "on" && (element.name === "ngSwitch" || element.attributes.some(other => other.name === "ngSwitch"))) return "expression";
    if (name === "for" && (element.name === "ngMessages" || element.attributes.some(other => other.name === "ngMessages"))) return "expression";
    if (name === "ngPattern" && attribute.value.trim().startsWith("/")) return "text";
    if (TEXT_ATTRIBUTES.has(name) || /^ngAttr[A-Z]/.test(name)) return "text";
    if (/^ng[A-Z]/.test(name) || UI_EXPRESSION_ATTRIBUTES.has(name)) return "expression";
    for (const owner of registry.bindingOwners(element)) {
        const type = owner.attributeBindings.get(name);
        if (type) return type === "@" ? "text" : "expression";
    }
    if (registry.directives.has(name)) return "maybe";
    return /[A-Z]/.test(name) && !name.startsWith("aria") ? "maybe" : "text";
}

function readTemplate(template, context) {
    const facts = { elements: [], filterUses: [], includes: [], scriptTemplates: [] };
    const { registry } = context;

    const readMarkup = (text, lineAt) => {
        let parsed;
        try {
            parsed = htmlParser.parse(text, template.file, { tokenizeExpansionForms: false, tokenizeBlocks: false, tokenizeLet: false });
        } catch (error) {
            context.note(template.file, lineAt(0), `HTML could not be parsed: ${error.message}`);
            return;
        }
        for (const error of parsed.errors.slice(0, 3)) context.note(template.file, lineAt(error.span.start.offset), `HTML parser: ${compact(error.msg, 100)}`);

        const expression = (source, node, line, shown, tolerant) => {
            for (const name of filtersIn(source, node.sourceSpan, context, { file: template.file, line }, tolerant)) facts.filterUses.push({ name, line, text: shown });
        };
        const interpolated = (value, node, line) => {
            for (const part of interpolations(value)) expression(part.expression, node, line + countNewlines(value.slice(0, part.index)), compact(`{{${part.expression}}}`, 140));
        };

        const readAttribute = (element, attribute, node) => {
            const { value, line } = attribute;
            const shown = compact(`${attribute.raw}="${value}"`, 140);
            const kind = attributeKind(element, attribute, registry);
            if (kind === "expression" && !value.includes("{{")) expression(value, node, line, shown);
            else if (kind === "repeat" || kind === "options") {
                const match = (kind === "repeat" ? NG_REPEAT : NG_OPTIONS).exec(value);
                if (!match) {
                    context.note(template.file, line, `${attribute.raw} micro-syntax not recognized, filter names taken from a scan: ${compact(value, 90)}`);
                    for (const name of scanFilters(value)) facts.filterUses.push({ name, line, text: shown });
                    return;
                }
                const parts = kind === "repeat" ? [ match[2], match[4] ] : match.slice(1);
                for (const part of parts) if (part) expression(part, node, line, shown);
            } else if (kind === "sref") {
                const parameters = /^[^(]*\(([\s\S]*)\)\s*$/.exec(value);
                if (parameters && parameters[1].trim()) expression(parameters[1], node, line, shown);
                interpolated(value, node, line);
            } else if (kind === "maybe" && !value.includes("{{")) expression(value, node, line, shown, true);
            else interpolated(value, node, line);
        };

        const visit = nodes => {
            for (const node of nodes) {
                if (node instanceof ng.Text) {
                    interpolated(node.value, node, lineAt(node.sourceSpan.start.offset));
                    continue;
                }
                if (!(node instanceof ng.Element)) {
                    if (Array.isArray(node.children)) visit(node.children);
                    continue;
                }
                const start = node.startSourceSpan ?? node.sourceSpan;
                const tag = withoutNamespace(node.name).toLowerCase();
                const element = {
                    name: normalizeName(tag),
                    tag,
                    line: lineAt(start.start.offset),
                    text: compact(text.slice(start.start.offset, start.end.offset)),
                    attributes: node.attrs.map(attribute => ({ raw: withoutNamespace(attribute.name), name: normalizeName(attribute.name), value: attribute.value ?? "", line: lineAt(attribute.sourceSpan.start.offset) }))
                };
                facts.elements.push(element);
                element.attributes.forEach((attribute, index) => readAttribute(element, attribute, node.attrs[index]));

                const include = element.name === "ngInclude" ? element.attributes.find(attribute => attribute.name === "src") : element.attributes.find(attribute => attribute.name === "ngInclude");
                if (include) {
                    const literal = /^\s*(['"])([^'"]+)\1\s*$/.exec(include.value);
                    if (literal) facts.includes.push({ url: literal[2], line: include.line });
                    else context.note(template.file, include.line, `ng-include whose source is not a string literal (${compact(include.value, 60)}): the partial is not followed`);
                }
                const messages = element.attributes.find(attribute => attribute.name === "ngMessagesInclude");
                if (messages) facts.includes.push({ url: messages.value.trim(), line: messages.line });

                const type = element.attributes.find(attribute => attribute.name === "type")?.value;
                if (tag === "script") {
                    const [ child ] = node.children;
                    if (type === "text/ng-template" && child instanceof ng.Text) {
                        const identifier = element.attributes.find(attribute => attribute.name === "id")?.value;
                        if (identifier) facts.scriptTemplates.push(identifier);
                        readMarkup(child.value, offset => lineAt(child.sourceSpan.start.offset + offset));
                    }
                } else visit(node.children);
            }
        };
        visit(parsed.rootNodes);
    };

    readMarkup(template.text, template.lineAt);
    return facts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Angular templates: only who uses which selector (UpgradeComponent wrappers, and the Angular twin of an AngularJS name).

let ElementCollector;

/** The visitor class can only be made once the compiler package is loaded. */
function elementCollector() {
    ElementCollector ??= class extends ng.TmplAstRecursiveVisitor {
        elements = [];
        visitElement(element) {
            this.elements.push(element);
            super.visitElement(element);
        }
    };
    return new ElementCollector();
}

function angularElements(template, notes) {
    try {
        const collector = elementCollector();
        ng.tmplAstVisitAll(collector, ng.parseTemplate(template.text, template.file, { preserveWhitespaces: false }).nodes);
        return collector.elements.map(element => {
            const start = element.startSourceSpan ?? element.sourceSpan;
            return { element, name: element.name, file: template.file, line: template.lineAt(start.start.offset), text: compact(template.text.slice(start.start.offset, start.end.offset)) };
        });
    } catch (error) {
        notes.push({ file: template.file, line: 1, message: `Angular template could not be parsed: ${error.message}` });
        return [];
    }
}

// ---------------------------------------------------------------------------------------------------------------------

/** The whole index of a hybrid workspace: see the header of this file and --help for what each list holds. */
export function loadHybrid(root) {
    const workspace = findWorkspace(root);
    const absoluteRoot = workspace.root;
    const relative = absolute => path.relative(absoluteRoot, absolute).split(path.sep).join("/");
    const notes = [];
    const skippedFiles = [];
    const files = listFiles(absoluteRoot, skippedFiles);
    const raw = scanSources(absoluteRoot, files, notes);
    const stats = { sourceFiles: raw.sources.size, parsed: 0, parsedAsAction: 0, scanned: 0 };

    // Which .html files are Angular templates (named by a @Component templateUrl); every other .html is an AngularJS template.
    const angularTemplateFiles = new Set(raw.angular.map(declaration => declaration.templateFile).filter(Boolean));
    const htmlTemplates = new Map();
    for (const absolute of files) {
        if (!/\.html?$/i.test(absolute) || angularTemplateFiles.has(absolute)) continue;
        const text = readFileSync(absolute, "utf8");
        htmlTemplates.set(relative(absolute), { id: relative(absolute), file: relative(absolute), inline: false, text, lineAt: lineIndex(text) });
    }

    const byName = list => {
        const map = new Map();
        for (const item of list) map.set(item.name, [ ...(map.get(item.name) ?? []), item ]);
        return map;
    };
    const attributeBindings = bindings => new Map(Object.entries(bindings).flatMap(([ key, value ]) => {
        const match = BINDING.exec(value);
        return match ? [ [ match[2] || key, match[1] ] ] : [];
    }));
    for (const item of [ ...raw.components, ...raw.directives ]) item.attributeBindings = attributeBindings(item.bindings);
    const components = byName(raw.components);
    const directives = byName(raw.directives);
    const downgradedComponents = byName(raw.downgrades.filter(downgrade => downgrade.kind === "component"));
    for (const [ kind, map ] of [ [ "component", components ], [ "directive", directives ], [ "filter", byName(raw.filters) ], [ "service", byName(raw.services) ] ]) {
        for (const [ name, list ] of map) if (list.length > 1) notes.push({ file: list[1].file, line: list[1].line, message: `${kind} "${name}" is registered ${list.length} times`, subject: name });
    }

    const directivesOn = element => {
        const matched = [];
        for (const candidate of raw.directives) {
            const asElement = candidate.restrict.includes("E") && candidate.name === element.name;
            const asAttribute = candidate.restrict.includes("A") && element.attributes.some(attribute => attribute.name === candidate.name);
            const asClass = candidate.restrict.includes("C") && element.attributes.some(attribute => attribute.name === "class" && attribute.value.split(/\s+/).some(token => token && normalizeName(token) === candidate.name));
            if (asElement || asAttribute || asClass) matched.push(candidate);
        }
        return matched;
    };
    const registry = {
        directives,
        downgradedComponents,
        bindingOwners: element => [ ...(components.get(element.name) ?? []), ...directivesOn(element) ].filter(owner => owner.attributeBindings.size)
    };

    const context = { registry, stats, note: (file, line, message) => notes.push({ file, line, message }) };
    const templates = [ ...htmlTemplates.values(), ...raw.inlineTemplates.values(), ...raw.cachedTemplates.map(cached => cached.template) ];
    const scriptTemplates = new Map();
    for (const template of templates) {
        template.facts = readTemplate(template, context);
        for (const identifier of template.facts.scriptTemplates) scriptTemplates.set(identifier, template);
    }
    for (const cached of raw.cachedTemplates) scriptTemplates.set(cached.identifier, cached.template);

    const referenced = new Set();
    /**
     * The template a templateUrl or ng-include names. A URL that starts with ./ or ../ is read relative to the file that names it;
     * any other URL is a path from some base the tool does not know, so it is matched by its end, and when several files match
     * the choice is reported instead of made silently.
     */
    const templateFor = (url, where) => {
        const clean = url.replace(/\\/g, "/").split(/[?#]/)[0];
        const wanted = clean.replace(/^(\.?\/)+/, "");
        const beside = path.posix.join(path.posix.dirname(where.file), clean);
        let found = scriptTemplates.get(url) ?? (/^\.\.?\//.test(clean) ? htmlTemplates.get(beside) : undefined) ?? htmlTemplates.get(wanted);
        if (!found) {
            const matches = [ ...htmlTemplates.keys() ].filter(candidate => candidate.endsWith(`/${wanted}`)).sort((left, right) => left.length - right.length || left.localeCompare(right));
            const chosen = matches.includes(beside) ? beside : matches[0];
            if (matches.length > 1) notes.push({ file: where.file, line: where.line, subject: where.subject, message: `"${url}" fits ${matches.length} template files (${matches.join(", ")}): ${chosen} was taken` });
            found = chosen ? htmlTemplates.get(chosen) : htmlTemplates.get(beside);
        }
        if (found) referenced.add(found);
        return found;
    };
    for (const template of templates) {
        for (const include of template.facts.includes) {
            include.template = templateFor(include.url, { file: template.file, line: include.line });
            if (!include.template) notes.push({ file: template.file, line: include.line, message: `ng-include of "${include.url}": no such template file in this workspace` });
        }
    }
    const urlTemplate = new Map();
    for (const [ object, reference ] of raw.templateUrls) {
        const found = templateFor(reference.url, { ...reference, subject: [ ...raw.components, ...raw.directives ].find(item => item.definition === object)?.name });
        if (found) urlTemplate.set(object, found);
        else notes.push({ file: reference.file, line: reference.line, subject: [ ...raw.components, ...raw.directives ].find(item => item.definition === object)?.name, message: `templateUrl "${reference.url}": no such template file in this workspace` });
    }

    const closureOf = own => {
        const seen = new Set();
        const visit = template => {
            if (!template || seen.has(template)) return;
            seen.add(template);
            for (const include of template.facts.includes) visit(include.template);
        };
        own.forEach(visit);
        return [ ...seen ];
    };
    const ownTemplates = definition => definition ? [ urlTemplate.get(definition), raw.inlineTemplates.get(definition) ].filter(Boolean) : [];
    const renderFacts = (item, own) => {
        const closure = closureOf(own);
        const renders = new Set();
        const rendersDowngraded = new Set();
        const filters = new Set();
        let rendersItself = false;
        for (const template of closure) {
            for (const element of template.facts.elements) {
                for (const rendered of [ ...(components.get(element.name) ?? []), ...directivesOn(element) ]) {
                    if (rendered.name === item.name) rendersItself = true;
                    else renders.add(rendered.name);
                }
                if (downgradedComponents.has(element.name)) rendersDowngraded.add(element.name);
            }
            for (const use of template.facts.filterUses) filters.add(use.name);
        }
        return {
            templateFiles: closure.filter(template => !template.inline).map(template => template.file),
            inline: own.some(template => template.inline),
            renders: [ ...renders ].sort(),
            rendersDowngraded: [ ...rendersDowngraded ].sort(),
            filters: [ ...filters ].sort(),
            ...(rendersItself ? { rendersItself } : {}),
            ...(own.length ? {} : { templateMissing: true })
        };
    };

    // Uses in AngularJS templates: one entry per element (components, directives, downgraded components) or per pipe (filters).
    const uses = { component: new Map(), directive: new Map(), downgrade: new Map(), filter: new Map() };
    const use = (kind, name, entry) => uses[kind].set(name, [ ...(uses[kind].get(name) ?? []), entry ]);
    for (const template of templates) {
        for (const element of template.facts.elements) {
            const entry = { kind: "template", file: template.file, line: element.line, text: element.text };
            const withAttributes = () => ({ ...entry, attributes: element.attributes.map(attribute => ({ ...bindingOf(attribute.raw), raw: attribute.raw, value: attribute.value, line: attribute.line })) });
            if (components.has(element.name)) use("component", element.name, withAttributes());
            if (downgradedComponents.has(element.name)) use("downgrade", element.name, { ...entry, attributes: element.attributes.map(attribute => ({ ...bindingOf(attribute.raw), raw: attribute.raw, value: attribute.value, line: attribute.line })) });
            for (const directive of new Set(directivesOn(element).map(candidate => candidate.name))) use("directive", directive, entry);
        }
        for (const filterUse of template.facts.filterUses) use("filter", filterUse.name, { kind: "template", file: template.file, line: filterUse.line, text: filterUse.text });
    }

    // Angular side: wrappers and their uses in Angular templates, and Angular components by selector.
    const angularUses = [];
    for (const declaration of raw.angular) {
        let template = declaration.template;
        if (!template && declaration.templateFile) {
            try {
                const text = readFileSync(declaration.templateFile, "utf8");
                template = { file: relative(declaration.templateFile), text, lineAt: lineIndex(text) };
            } catch {
                notes.push({ file: declaration.file, line: declaration.line, message: `templateUrl of ${declaration.className} cannot be read` });
            }
        }
        if (template && declaration.upgraded === undefined) angularUses.push(...angularElements(template, notes));
    }
    const wrappers = raw.angular.filter(declaration => declaration.upgraded !== undefined).map(declaration => ({ selector: declaration.selector ?? "?", ajsName: declaration.upgraded, className: declaration.className, file: declaration.file, line: declaration.line, usedBy: [] }));
    const matcher = new ng.SelectorMatcher();
    for (const wrapper of wrappers) {
        try {
            matcher.addSelectables(ng.CssSelector.parse(wrapper.selector), wrapper);
        } catch {
            notes.push({ file: wrapper.file, line: wrapper.line, message: `selector "${wrapper.selector}" of ${wrapper.className} could not be parsed` });
        }
    }
    for (const entry of angularUses) {
        const selector = new ng.CssSelector();
        selector.setElement(entry.name);
        for (const attribute of entry.element.attributes ?? []) selector.addAttribute(attribute.name, attribute.value ?? "");
        for (const input of entry.element.inputs ?? []) selector.addAttribute(input.name, "");
        matcher.match(selector, (_selector, wrapper) => wrapper.usedBy.push({ kind: "angular-template", file: entry.file, line: entry.line, text: entry.text }));
    }
    const angularComponents = raw.angular.filter(declaration => declaration.kind === "Component" && declaration.upgraded === undefined && declaration.selector);
    const twinOf = kebab => angularComponents.find(declaration => declaration.selector.split(",").some(part => part.trim() === kebab));

    const ordered = list => [ ...list ].sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
    const sites = name => raw.sites.filter(entry => entry.name === name).map(({ kind, file, line, text }) => ({ kind, file, line, text }));
    const byNameOrder = (left, right) => left.name.localeCompare(right.name) || left.file.localeCompare(right.file);

    const index = {
        root: absoluteRoot,
        workspaceNotes: workspace.notes,
        skippedFiles: skippedFiles.map(relative),
        components: raw.components.map(component => {
            const kebab = kebabOf(component.name);
            const twin = twinOf(kebab);
            const stateUses = raw.states.flatMap(state => state.components.filter(named => named.name === component.name).map(named => ({ kind: "state", file: state.file, line: named.line, text: `state ${state.name}` })));
            const wrapperUses = wrappers.filter(wrapper => wrapper.ajsName === component.name && wrapper.usedBy.length).map(wrapper => ({ kind: "wrapper", file: wrapper.file, line: wrapper.line, text: `${wrapper.className} <${wrapper.selector}>, used in ${wrapper.usedBy.length} Angular template element${wrapper.usedBy.length === 1 ? "" : "s"}` }));
            return {
                name: component.name,
                kebab,
                file: component.file,
                line: component.line,
                module: component.module,
                ...renderFacts(component, ownTemplates(component.definition)),
                bindings: component.bindings,
                injects: component.injects,
                usedBy: [ ...ordered(uses.component.get(component.name) ?? []), ...ordered(stateUses), ...wrapperUses ],
                twin: twin ? { className: twin.className, file: twin.file, line: twin.line } : null
            };
        }).sort(byNameOrder),
        directives: raw.directives.map(directive => ({
            name: directive.name,
            kebab: kebabOf(directive.name),
            file: directive.file,
            line: directive.line,
            restrict: directive.restrict,
            ...(ownTemplates(directive.definition).length ? renderFacts(directive, ownTemplates(directive.definition)) : {}),
            injects: directive.injects,
            usedBy: ordered(uses.directive.get(directive.name) ?? [])
        })).sort(byNameOrder),
        filters: raw.filters.map(filter => ({
            name: filter.name,
            file: filter.file,
            line: filter.line,
            injects: filter.injects,
            usedBy: [
                ...ordered(uses.filter.get(filter.name) ?? []),
                ...ordered(raw.filterCalls.filter(call => call.name === filter.name).map(call => ({ kind: "$filter", file: call.file, line: call.line, text: call.text }))),
                ...ordered(sites(`${filter.name}Filter`).map(entry => ({ ...entry, kind: "inject", text: `${filter.name}Filter injected (${entry.kind})` })))
            ]
        })).sort(byNameOrder),
        services: raw.services.map(service => ({ name: service.name, kind: service.kind, className: service.className, file: service.file, line: service.line, injects: service.injects, usedBy: ordered(sites(service.name)) })).sort(byNameOrder),
        downgrades: raw.downgrades.map(downgrade => ({
            name: downgrade.name,
            kind: downgrade.kind,
            ...(downgrade.kind === "component" ? { kebab: kebabOf(downgrade.name) } : {}),
            className: downgrade.className,
            ...(downgrade.inputs ? { inputs: downgrade.inputs } : {}),
            ...(downgrade.outputs ? { outputs: downgrade.outputs } : {}),
            file: downgrade.file,
            line: downgrade.line,
            usedBy: downgrade.kind === "component" ? ordered(uses.downgrade.get(downgrade.name) ?? []) : ordered(sites(downgrade.name))
        })).sort(byNameOrder),
        wrappers: wrappers.map(wrapper => ({ ...wrapper, usedBy: ordered(wrapper.usedBy) })).sort((left, right) => left.selector.localeCompare(right.selector)),
        states: raw.states.map(state => {
            const templateFiles = state.views.map(view => urlTemplate.get(view)?.file).filter(Boolean);
            return {
                name: state.name,
                file: state.file,
                line: state.line,
                ...(state.url !== undefined ? { url: state.url } : {}),
                ...(state.components.length ? { component: state.components[0].name } : {}),
                ...(state.components.length > 1 ? { components: state.components.map(named => named.name) } : {}),
                ...(state.componentClass ? { componentClass: state.componentClass } : {}),
                ...(templateFiles.length ? { templateFile: templateFiles[0] } : {}),
                ...(state.views.some(view => raw.inlineTemplates.has(view)) ? { inline: true } : {}),
                ...(state.controller ? { controller: state.controller } : {})
            };
        }).sort(byNameOrder),
        others: raw.others.map(({ name, kind, file, line }) => ({ name, kind, file, line })).sort(byNameOrder),
        angularUses: angularUses.map(({ name, file, line, text }) => ({ name, file, line, text })),
        angular: raw.angular.filter(declaration => declaration.upgraded === undefined).map(({ className, kind, selector, file, line }) => ({ className, kind, selector, file, line })),
        notes: [],
        stats: { ...stats, ajsTemplateFiles: htmlTemplates.size, inlineTemplates: raw.inlineTemplates.size + raw.cachedTemplates.length, angularDeclarations: raw.angular.length, unreferencedTemplateFiles: [ ...htmlTemplates.values() ].filter(template => !referenced.has(template)).map(template => template.file).sort() }
    };

    const registeredFilters = new Set(raw.filters.map(filter => filter.name));
    for (const call of raw.codeExpressions) {
        for (const name of new Set(call.names.filter(candidate => registeredFilters.has(candidate)))) notes.push({ file: call.file, line: call.line, subject: name, message: `${call.text}: an expression in code that seems to apply the filter ${name}; expressions in code are not read, so it is not counted as a use` });
    }
    for (const call of raw.compiledMarkup) {
        const tags = new Set([ ...call.markup.matchAll(/<\s*([a-zA-Z][\w:-]*)/g) ].map(match => normalizeName(match[1])));
        const named = [ ...tags ].filter(tag => components.has(tag) || directives.has(tag));
        for (const name of named) notes.push({ file: call.file, line: call.line, subject: name, message: `${call.text}: markup compiled in code that seems to render ${name}; it is not counted as a use` });
        if (!named.length && tags.size) notes.push({ file: call.file, line: call.line, message: `${call.text}: markup compiled in code is not analysed` });
    }
    const registeredServices = new Set([ ...raw.services, ...raw.downgrades ].map(item => item.name));
    for (const call of raw.untracedGets) if (registeredServices.has(call.name)) notes.push({ file: call.file, line: call.line, subject: call.name, message: `${call.text}: a .get("${call.name}") whose receiver could not be traced to $injector; not counted as a use` });
    for (const stray of raw.strayComponents) if (components.has(stray.name)) notes.push({ file: stray.file, line: stray.line, subject: stray.name, message: `component: "${stray.name}" in an object that is not a ui-router state; not counted as a use` });
    for (const state of index.states) {
        for (const name of state.components ?? (state.component ? [ state.component ] : [])) if (!components.has(name)) notes.push({ file: state.file, line: state.line, subject: name, message: `state ${state.name} names component "${name}", which is not a registered AngularJS component` });
    }
    const seen = new Set();
    for (const entry of notes) {
        const key = `${entry.file}:${entry.line}:${entry.message}`;
        if (!seen.has(key)) index.notes.push(entry);
        seen.add(key);
    }
    return index;
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line.

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const orDash = list => list.length ? list.join(", ") : "-";
const place = item => `${item.file}:${item.line}`;

function columns(rows, aligned = Infinity) {
    const widths = [];
    for (const row of rows) row.forEach((cell, position) => {
        widths[position] = Math.max(widths[position] ?? 0, cell.length);
    });
    return rows.map(row => row.filter((cell, position) => cell || position < aligned).map((cell, position) => position < aligned && position < row.length - 1 ? cell.padEnd(widths[position]) : cell).join("  ").trimEnd());
}

function useCounts(item) {
    const counts = new Map();
    for (const entry of item.usedBy ?? []) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
    return [ ...counts ].map(([ kind, count ]) => `${count} ${kind}`).join(", ");
}

function listRow(kind, item, noted = false) {
    const cells = listCells(kind, item);
    return noted ? [ ...cells, "(see note)" ] : cells;
}

function listCells(kind, item) {
    const usesCell = `uses ${item.usedBy?.length ?? 0}`;
    if (kind === "components") return [ item.name, item.kebab, useCounts(item) ? `${usesCell} (${useCounts(item)})` : usesCell, `renders: ${item.templateMissing ? "? (no template could be read)" : orDash(item.renders)}`, `twin: ${item.twin ? item.twin.className : "-"}`, item.rendersDowngraded.length ? `downgraded: ${item.rendersDowngraded.join(", ")}` : "" ];
    if (kind === "directives") return [ item.name, item.kebab, `restrict ${item.restrict}`, usesCell ];
    if (kind === "filters") return [ item.name, usesCell, useCounts(item) ? `(${useCounts(item)})` : "" ];
    if (kind === "services") return [ item.name, item.kind, usesCell, useCounts(item) ? `(${useCounts(item)})` : "" ];
    if (kind === "downgrades") return [ item.name, item.kind, item.className, usesCell ];
    if (kind === "wrappers") return [ item.selector, `wraps ${item.ajsName}`, item.className, `uses ${item.usedBy.length} (elements in Angular templates)` ];
    return [ item.name, item.component ? `component: ${(item.components ?? [ item.component ]).join(", ")}` : item.componentClass ? `component: ${item.componentClass} (Angular class)` : item.templateFile ? `templateUrl: ${item.templateFile}` : item.inline ? "inline template" : "no view", place(item) ];
}

function useLines(usedBy) {
    return columns(usedBy.map(entry => [ `    ${entry.kind}`, place(entry), entry.text ?? "" ]));
}

/** The Angular template elements behind a component's "wrapper" uses. */
function wrapperUseLines(index, component) {
    return index.wrappers.filter(wrapper => wrapper.ajsName === component.name && wrapper.usedBy.length).flatMap(wrapper => useLines(wrapper.usedBy.map(entry => ({ ...entry, kind: `  through <${wrapper.selector}>` }))));
}

function card(index, kind, item, withUses, all = false) {
    const lines = [];
    const notes = index.notes.filter(entry => entry.subject !== undefined && (entry.subject === item.name || entry.subject === item.ajsName));
    if (kind === "components") {
        const elements = item.usedBy.filter(entry => entry.kind === "template").length;
        lines.push(`component ${item.name}  <${item.kebab}>  ${place(item)}${item.module ? `  module ${item.module}` : ""}`);
        lines.push(`  bindings: ${orDash(Object.entries(item.bindings).map(([ name, type ]) => `${name} "${type}"`))}`);
        lines.push(`  template: ${[ ...(item.inline ? [ `inline string in ${item.file}` ] : []), ...item.templateFiles ].join(", ") || "none could be read, so what it renders is unknown"}`);
        const read = list => item.templateMissing ? "? (no template could be read)" : orDash(list);
        lines.push(`  renders (AngularJS components and directives in its template): ${read(item.renders)}${item.rendersItself ? "  (also renders itself)" : ""}`);
        lines.push(`  renders downgraded Angular components: ${read(item.rendersDowngraded)}`);
        lines.push(`  filters applied: ${read(item.filters)}`);
        lines.push(`  injects: ${orDash(item.injects)}`);
        lines.push(`  twin (Angular @Component with selector "${item.kebab}"): ${item.twin ? `${item.twin.className}  ${place(item.twin)}` : "-"}`);
        const wrapper = index.wrappers.find(candidate => candidate.ajsName === item.name);
        if (wrapper) lines.push(`  upgrade wrapper: ${wrapper.className} <${wrapper.selector}>  ${place(wrapper)}  used by ${plural(wrapper.usedBy.length, "element")} in Angular templates${wrapper.usedBy.length ? "" : " (so it does not count as a use)"}`);
        lines.push(`  used ${plural(item.usedBy.length, "time")}: ${plural(elements, "element")} in AngularJS templates, ${plural(item.usedBy.filter(entry => entry.kind === "state").length, "state")}, ${plural(item.usedBy.filter(entry => entry.kind === "wrapper").length, "used wrapper")}`);
    } else if (kind === "directives") {
        lines.push(`directive ${item.name}  ${item.kebab}  restrict "${item.restrict}"  ${place(item)}`);
        if (item.renders) lines.push(`  template: ${[ ...(item.inline ? [ `inline string in ${item.file}` ] : []), ...item.templateFiles ].join(", ")}  renders: ${orDash(item.renders)}  filters applied: ${orDash(item.filters)}`);
        lines.push(`  injects: ${orDash(item.injects)}`);
        lines.push(`  used ${plural(item.usedBy.length, "time")} in AngularJS templates`);
    } else if (kind === "filters") {
        lines.push(`filter ${item.name}  ${place(item)}`);
        lines.push(`  injects: ${orDash(item.injects)}`);
        lines.push(`  used ${plural(item.usedBy.length, "time")}${item.usedBy.length ? `: ${useCounts(item)}` : " (no template expression, no $filter call, no injection)"}`);
    } else if (kind === "services") {
        lines.push(`${item.kind} ${item.name}  ${place(item)}`);
        lines.push(`  injects: ${orDash(item.injects)}`);
        lines.push(`  injected ${plural(item.usedBy.length, "time")}${item.usedBy.length ? `: ${useCounts(item)}` : " (no $inject array, no inline array annotation, no $injector.get, no upgrade provider)"}`);
    } else if (kind === "downgrades") {
        lines.push(`downgraded Angular ${item.kind} ${item.name}${item.kebab ? `  <${item.kebab}>` : ""}  class ${item.className}  ${place(item)}`);
        if (item.inputs || item.outputs) lines.push(`  the downgrade call names inputs: ${orDash(item.inputs ?? [])}; outputs: ${orDash(item.outputs ?? [])}`);
        lines.push(`  used ${plural(item.usedBy.length, "time")} on the AngularJS side`);
    } else if (kind === "wrappers") {
        lines.push(`upgrade wrapper ${item.className}  <${item.selector}>  wraps AngularJS component ${item.ajsName}  ${place(item)}`);
        lines.push(`  used by ${plural(item.usedBy.length, "element")} in Angular templates`);
    } else {
        lines.push(`state ${item.name}  ${place(item)}${item.url !== undefined ? `  url ${item.url}` : ""}`);
        lines.push(`  view: ${listRow("states", item)[1]}${item.controller ? `  controller: ${item.controller}` : ""}`);
    }
    if (withUses && item.usedBy?.length) lines.push(...limited(useLines(item.usedBy), all));
    if (withUses && kind === "components") lines.push(...limited(wrapperUseLines(index, item), all));
    if (kind === "components" || kind === "downgrades") {
        const attributes = attributeCounts(item);
        if (attributes.length) lines.push(`  attributes on these elements (as written): ${attributes.slice(0, all ? Infinity : 16).join(", ")}${!all && attributes.length > 16 ? `, … +${attributes.length - 16} more` : ""}`);
    }
    if (kind === "components" && item.twin) lines.push(`  not counted: ${plural(index.angularUses.filter(entry => entry.name === item.kebab).length, "element")} <${item.kebab}> in Angular templates, which render the Angular twin ${item.twin.className}`);
    for (const entry of notes) lines.push(`  note: ${place(entry)}  ${entry.message}`);
    return lines;
}

function findByName(index, name) {
    const camel = name.includes("-") ? normalizeName(name) : name;
    const found = [];
    for (const kind of LIST_KINDS) {
        for (const item of index[kind]) {
            const names = kind === "wrappers" ? [ item.selector, item.className ] : [ item.name, item.kebab, item.className, item.twin?.className ];
            if (names.includes(name) || names.includes(camel)) found.push({ kind, item });
        }
    }
    // A wrapper is shown inside the card of the component it wraps; on its own only when that component is not among the matches.
    const shown = new Set(found.filter(entry => entry.kind === "components").map(entry => entry.item.name));
    for (const wrapper of index.wrappers) if (wrapper.ajsName === camel && !found.some(entry => entry.item === wrapper)) found.push({ kind: "wrappers", item: wrapper });
    return found.filter(entry => entry.kind !== "wrappers" || !shown.has(entry.item.ajsName));
}

const sameAttribute = (left, right) => left.toLowerCase().replace(/[-_:]/g, "") === right.toLowerCase().replace(/[-_:]/g, "");
const writtenAttribute = attribute => `${attribute.raw}${attribute.value ? `="${compact(attribute.value, 60)}"` : ""}`;

/** The attributes AngularJS templates put on the elements of a component, counted by name: `state-params ×5 ([bound] ×5)`. */
/** The attribute names on the elements of an item, the most used first. */
function attributeNamesOf(item) {
    const counts = new Map();
    for (const use of item.usedBy ?? []) for (const attribute of use.attributes ?? []) counts.set(attribute.name, (counts.get(attribute.name) ?? 0) + 1);
    return [ ...counts ].sort((left, right) => right[1] - left[1]).map(([ name ]) => name);
}

function attributeCounts(item) {
    const counts = new Map();
    for (const use of item.usedBy ?? []) {
        for (const attribute of use.attributes ?? []) {
            const entry = counts.get(attribute.name) ?? counts.set(attribute.name, { total: 0, forms: new Map() }).get(attribute.name);
            entry.total++;
            entry.forms.set(attribute.form, (entry.forms.get(attribute.form) ?? 0) + 1);
        }
    }
    return [ ...counts ].sort((left, right) => right[1].total - left[1].total).map(([ name, { total, forms } ]) => {
        const other = [ ...forms ].filter(([ form ]) => form !== "plain").map(([ form, count ]) => `${form} ×${count}`);
        return `${kebabOf(name)} ×${total}${other.length ? ` (${other.join(", ")})` : ""}`;
    });
}

function limited(lines, all, indent = "    ") {
    if (all || lines.length <= SHOWN) return lines;
    return [ ...lines.slice(0, SHOWN), `${indent}… +${lines.length - SHOWN} more (--all lists every one)` ];
}

function parseArguments(argv) {
    const flags = { root: ".", unused: false, json: false, help: false, all: false, under: undefined };
    const positional = [];
    for (let position = 0; position < argv.length; position++) {
        const argument = argv[position];
        if (argument === "--root") {
            if (argv[position + 1] === undefined || argv[position + 1].startsWith("--")) throw new Problem("--root needs a directory");
            flags.root = argv[++position];
        }
        else if (argument.startsWith("--root=")) flags.root = argument.slice(7);
        else if (argument === "--under") {
            if (argv[position + 1] === undefined || argv[position + 1].startsWith("--")) throw new Problem("--under needs a folder, e.g. --under src/app/orders");
            flags.under = argv[++position];
        }
        else if (argument.startsWith("--under=")) flags.under = argument.slice(8);
        else if (argument === "--unused") flags.unused = true;
        else if (argument === "--json") flags.json = true;
        else if (argument === "--all") flags.all = true;
        else if (argument === "--help" || argument === "-h") flags.help = true;
        else if (argument.startsWith("--")) throw new Problem(`unknown option ${argument} (options: --root <dir>, --unused, --under <folder>, --all, --json, --help)`);
        else positional.push(argument);
    }
    return { flags, positional };
}

async function main() {
    const { flags, positional } = parseArguments(process.argv.slice(2));
    const [ command, target ] = positional;
    if (flags.help || !command || command === "help") {
        console.log(HELP);
        return;
    }
    if (![ "summary", "list", "show", "usages" ].includes(command)) throw new Problem(`unknown command "${command}"\n${HELP}`);
    if (!statSync(path.resolve(flags.root), { throwIfNoEntry: false })?.isDirectory()) throw new Problem(`--root ${flags.root}: no such directory`);
    await loadPackages(path.resolve(flags.root));
    const started = performance.now();
    const index = loadHybrid(flags.root);
    if (!index.stats.sourceFiles) {
        const doctor = existsSync(path.join(OWN_FOLDER, "doctor.mjs")) ? ` node "${slash(path.join(OWN_FOLDER, "doctor.mjs"))}" --root "${slash(path.resolve(flags.root))}" finds it and prints the folder to pass.` : "";
        throw new Problem(`no source file under ${slash(path.resolve(flags.root))}: --root must be the folder of the app.${doctor}`);
    }
    const elapsed = `${Math.round(performance.now() - started)} ms`;
    const print = value => console.log(JSON.stringify(value, null, 2));
    const self = `node ${pasteable(fileURLToPath(import.meta.url))}`;
    const rootShown = pasteable(index.root);
    const footnotes = () => {
        for (const note of index.workspaceNotes) console.log(`! ${note}`);
        if (index.skippedFiles.length) console.log(`! ${plural(index.skippedFiles.length, "file")} not read (minified or larger than ${LARGEST_SOURCE / 1_000_000} MB): ${index.skippedFiles.slice(0, 3).join(", ")}${index.skippedFiles.length > 3 ? ", …" : ""}`);
    };

    if (command === "summary") {
        const unused = kind => index[kind].filter(item => !item.usedBy.length).length;
        const kinds = (kind, values) => values.map(value => `${index[kind].filter(item => item.kind === value).length} ${value}`).join(", ");
        if (flags.json) return print({ ...Object.fromEntries(LIST_KINDS.map(kind => [ kind, { count: index[kind].length, ...(kind === "states" ? {} : { unused: unused(kind) }) } ])), stats: index.stats, notes: index.notes.length });
        const { stats } = index;
        console.log(`${plural(stats.sourceFiles, "source file")} (spec files ignored), ${plural(stats.ajsTemplateFiles, "AngularJS template file")} and ${plural(stats.inlineTemplates, "inline template")}, ${stats.angularDeclarations} Angular @Component/@Directive classes (${elapsed})`);
        console.log(columns([
            [ "components", String(index.components.length), `unused ${unused("components")}`, "AngularJS .component(...)" ],
            [ "directives", String(index.directives.length), `unused ${unused("directives")}`, "AngularJS .directive(...)" ],
            [ "filters", String(index.filters.length), `unused ${unused("filters")}`, "AngularJS .filter(...)" ],
            [ "services", String(index.services.length), `unused ${unused("services")}`, `AngularJS ${kinds("services", [ "service", "factory" ])}` ],
            [ "downgrades", String(index.downgrades.length), `unused ${unused("downgrades")}`, `Angular classes registered on the AngularJS side: ${kinds("downgrades", [ "component", "injectable" ])}` ],
            [ "wrappers", String(index.wrappers.length), `unused ${unused("wrappers")}`, "UpgradeComponent directives; unused = selector in no Angular template" ],
            [ "states", String(index.states.length), "", "ui-router states" ]
        ]).join("\n"));
        console.log(`expressions: ${stats.parsed + stats.parsedAsAction} read by the Angular expression parser (${stats.parsedAsAction} of them as actions), ${stats.scanned} by the fallback scan`);
        if (stats.unreferencedTemplateFiles.length) console.log(`template files nothing references (${stats.unreferencedTemplateFiles.length}): ${stats.unreferencedTemplateFiles.slice(0, flags.all ? Infinity : 6).join(", ")}${!flags.all && stats.unreferencedTemplateFiles.length > 6 ? ", … (--all)" : ""}`);
        console.log(index.notes.length ? `notes (${index.notes.length}), things the tool could not read with certainty:` : "notes: 0 (the tool met nothing it could not read; markup and names built at run time are outside what it reads)");
        for (const line of limited(index.notes.map(entry => `  ${place(entry)}  ${compact(entry.message, 200)}`), flags.all, "  ")) console.log(line);
        footnotes();
        console.log(`→ next: ${self} list components --root ${rootShown}   (or directives, filters, services, downgrades, wrappers, states; --unused: what nothing uses)`);
        return undefined;
    }

    if (command === "list") {
        if (!LIST_KINDS.includes(target)) throw new Problem(`list what? one of: ${LIST_KINDS.join(", ")}`);
        if (flags.unused && target === "states") throw new Problem("list states --unused: a state has no uses to count; list states prints every state");
        // --under <folder>: the rows registered in a file of that folder (a path below the workspace, or a piece of one), each with its place
        const under = flags.under === undefined ? null : `${slash(path.isAbsolute(flags.under) ? path.relative(index.root, flags.under) : path.normalize(flags.under)).replace(/^(\.\/)+/, "").replace(/\/+$/, "")}/`;
        const inFolder = item => under === null || `/${slash(String(item.file ?? ""))}`.includes(`/${under}`);
        const items = index[target].filter(item => (!flags.unused || !item.usedBy.length) && inFolder(item));
        if (flags.json) return print(items);
        console.log(`${items.length} ${flags.unused ? "unused " : ""}${target}${under === null ? "" : ` registered under ${under}`}${flags.unused || under !== null ? ` of ${index[target].length}` : ""} (${elapsed})`);
        const noted = new Set(index.notes.map(entry => entry.subject).filter(Boolean));
        const rowOf = item => [ ...listRow(target, item, noted.has(item.name) || noted.has(item.ajsName)), ...(under === null || target === "states" ? [] : [ place(item) ]) ];
        if (items.length) console.log(limited(columns(items.map(rowOf), target === "components" ? 3 : Infinity), flags.all, "").join("\n"));
        footnotes();
        if (items.length) console.log(`→ next: ${self} show ${items[0].name ?? items[0].selector ?? items[0].className} --root ${rootShown}   (the card of one of them)`);
        return undefined;
    }

    if (!target) throw new Problem(`${command} what? give a registered name, an element name, a selector or a class name`);
    // "name.attribute": the uses of one attribute. A name that is registered as a whole wins (a selector may hold a dot).
    let found = findByName(index, target);
    let attributeName;
    if (!found.length && command === "usages" && target.lastIndexOf(".") > 0) {
        attributeName = target.slice(target.lastIndexOf(".") + 1);
        found = findByName(index, target.slice(0, target.lastIndexOf(".")));
    }
    // An Angular selector: AngularJS knows the class under the name it was downgraded with, which may differ from the selector.
    const asked = attributeName ? target.slice(0, target.lastIndexOf(".")) : target;
    const angular = found.length ? undefined : index.angular.find(declaration => declaration.className === asked || (declaration.selector ?? "").split(",").some(part => part.trim() === asked));
    if (angular) found = index.downgrades.filter(item => item.className === angular.className).map(item => ({ kind: "downgrades", item }));
    if (!found.length) {
        // An Angular class that is not downgraded is a full answer, not a wrong name: AngularJS cannot use it.
        if (angular && !flags.json) {
            console.log(`Angular ${angular.kind.toLowerCase()} ${angular.className}${angular.selector ? ` <${angular.selector}>` : ""}  ${place(angular)}: 0 uses on the AngularJS side (${elapsed})`);
            console.log("  it is not registered with downgradeComponent and no AngularJS component has its name, so no AngularJS template can render it");
            if (existsSync(path.join(OWN_FOLDER, "ng-facts.mjs"))) console.log(`→ next: node ${pasteable(path.join(OWN_FOLDER, "ng-facts.mjs"))} usages ${angular.className} --root ${rootShown}   (its uses in Angular templates)`);
            footnotes();
            return undefined;
        }
        const wanted = (attributeName ? target.slice(0, target.lastIndexOf(".")) : target).toLowerCase().replace(/-/g, "");
        const close = LIST_KINDS.flatMap(kind => index[kind].map(item => item.name ?? item.selector)).filter(name => name.toLowerCase().includes(wanted)).slice(0, 10);
        throw new Problem(`nothing registered on the AngularJS side as "${target}", and no Angular component or directive has that class name or selector${close.length ? ` — similar: ${close.join(", ")}` : ""}.`);
    }
    if (flags.json) return print(found.map(({ kind, item }) => ({ kind, ...item })));
    for (const { kind, item } of found) {
        if (command === "show") {
            console.log(card(index, kind, item, true, flags.all).join("\n"));
            continue;
        }
        const label = kind === "wrappers" ? `upgrade wrapper <${item.selector}> (${item.className})` : kind === "downgrades" ? `downgraded Angular ${item.kind} ${item.name}${item.kebab ? ` <${item.kebab}>` : ""} (${item.className})` : `${kind === "services" ? item.kind : kind.slice(0, -1)} ${item.name}`;
        if (attributeName) {
            if (kind === "services" || (kind === "downgrades" && item.kind === "injectable")) {
                const member = item.className ? `${item.className}.${attributeName}` : null;
                const leftovers = path.join(OWN_FOLDER, "leftovers.mjs");
                throw new Problem(`${label} is a service: this script reads registrations and templates, not the calls ${item.name}.${attributeName}(…) in code.${member && existsSync(leftovers) ? ` They are listed by: node ${pasteable(leftovers)} ${member} --before --root ${rootShown}` : " Search the AngularJS sources for that call."}`);
            }
            if (kind !== "components" && kind !== "downgrades") {
                console.log(`${label}: attributes are counted for components and downgraded components only`);
                continue;
            }
            const carrying = item.usedBy.flatMap(use => (use.attributes ?? []).filter(attribute => sameAttribute(attribute.name, attributeName)).map(attribute => ({ use, attribute })));
            const forms = new Map();
            for (const { attribute } of carrying) forms.set(attribute.form, (forms.get(attribute.form) ?? 0) + 1);
            console.log(`${label}.${attributeName}: ${plural(carrying.length, "use")} of the attribute ${kebabOf(carrying[0]?.attribute.name ?? attributeName)} on ${plural(item.usedBy.filter(use => use.attributes).length, "element")} in AngularJS templates${carrying.length ? ` — ${[ ...forms ].map(([ form, count ]) => `${form} ×${count}`).join(", ")}` : ""} (${elapsed})`);
            const listed = item.inputs || item.outputs ? [ ...(item.inputs ?? []), ...(item.outputs ?? []) ] : undefined;
            if (listed) console.log(`  the downgrade call ${listed.some(name => sameAttribute(name, attributeName)) ? "names it" : "does not name it"} in its inputs/outputs (${place(item)}): a rename has to change that string too`);
            for (const line of limited(columns(carrying.map(({ use, attribute }) => [ `    ${place({ file: use.file, line: attribute.line })}`, `<${item.kebab}>`, writtenAttribute(attribute) ])), flags.all)) console.log(line);
            if (!carrying.length) {
                const present = attributeCounts(item);
                console.log(`  attributes these elements do carry: ${present.slice(0, 20).join(", ") || "none"}`);
            }
            console.log("  Not seen here: Angular templates (ng-facts usages <Class>.<input>), markup built in code, names in strings (leftovers).");
            continue;
        }
        console.log(`${label}: ${plural(item.usedBy?.length ?? 0, "use")}${useCounts(item) ? ` (${useCounts(item)})` : ""} (${elapsed})`);
        if (item.usedBy?.length) console.log(limited(useLines(item.usedBy), flags.all).join("\n"));
        if (kind === "components" && wrapperUseLines(index, item).length) console.log(limited(wrapperUseLines(index, item), flags.all).join("\n"));
        if (kind === "components" && item.twin) console.log(`  not counted: ${plural(index.angularUses.filter(entry => entry.name === item.kebab).length, "element")} <${item.kebab}> in Angular templates, which render the Angular twin ${item.twin.className}`);
        if (kind === "components" || kind === "downgrades") {
            const attributes = attributeCounts(item);
            if (attributes.length) console.log(`  attributes on these elements (as written, AngularJS and HTML ones included): ${attributes.slice(0, flags.all ? Infinity : 16).join(", ")}${!flags.all && attributes.length > 16 ? `, … +${attributes.length - 16} more` : ""}`);
            if (item.inputs || item.outputs) console.log(`  the downgrade call names inputs: ${orDash(item.inputs ?? [])}; outputs: ${orDash(item.outputs ?? [])}`);
            const firstAttribute = attributeNamesOf(item)[0];
            if (firstAttribute) console.log(`→ next: ${self} usages ${item.name}.${firstAttribute} --root ${rootShown}   (one attribute; the same with another name)`);
            if (attributes.length && kind === "downgrades" && existsSync(path.join(OWN_FOLDER, "ng-facts.mjs"))) console.log(`→ then: node ${pasteable(path.join(OWN_FOLDER, "ng-facts.mjs"))} usages ${item.className} --root ${rootShown}   (the Angular side)`);
        }
        for (const entry of index.notes.filter(candidate => candidate.subject === item.name)) console.log(`  note: ${place(entry)}  ${entry.message}`);
    }
    footnotes();
    return undefined;
}

/** Was this file started as the program (not imported)? Asked of node where it can say; otherwise by comparing real paths, so that a start through a symbolic link or a junction still counts. */
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
        await main();
    } catch (error) {
        console.error(error instanceof Problem ? error.message : `ajs-facts failed, this is a bug in the script, not an answer: ${error.stack ?? error.message}`);
        process.exitCode = 1;
    }
}
