#!/usr/bin/env node
// leftovers — every place that names a class member in TEXT, and whose it is. No Angular package is needed: it reads files
// with regular expressions and a small lexer, so it sees what no compiler checks: a name in a string, in a style selector,
// in an AngularJS template, in a test, a story or a document.
//   node leftovers.mjs <Class>.<name> [--root <dir>] [--all]             after a rename or a removal: what still carries the old name
//   node leftovers.mjs <Class>.<name> [--root <dir>] [--all] --before    before a change: the places a type checker will not show
//   node leftovers.mjs <Class>.<name> [--root <dir>] --final             after the change: this check, then the compiler; one verdict
//   --decided <file:line>,…   "?" places the reader decided to leave; --json one line for another script (ls-facts uses it)
//   node leftovers.mjs <Class>.<name> [--root <dir>] --leave             also what was left, by element and class: to check the reasons
//   node leftovers.mjs --help
// It knows the class, the classes that extend it (also when the member is declared on a base class), their selectors (element,
// attribute and class selectors, "a, b"), the names AngularJS gives to downgraded components, the stand-ins tests declare with
// the same selector, and which file is the template or the style sheet of which component. Every place gets one mark:
//   CHANGE  the name on that class or on a class that extends it: the work is not finished
//   leave   the same name on something else (printed as counts with the reason)
//   ?       the text does not say whose it is: read the place
// It does not judge reads in TypeScript code and in template expressions (the compiler does) and says how many it passed over.
// Exit code: 2 while a CHANGE or an undecided "?" is left (0 with --before), 1 for a wrong name, moment or folder, 0 otherwise.
// It never edits a file.
// Lines that start with "!" say what it had to assume. Works from any folder: node <this folder>/leftovers.mjs … --root <workspace>
// Test: node test/leftovers.test.mjs (it builds its own tiny app in the temp folder).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHOWN_PER_GROUP = 12;
const LINE_WIDTH = 160;
/** A line longer than this is minified or generated: nobody edits it by hand, so it is not read. */
const LONG_LINE = 2000;
const MAX_FILE_SIZE = 2_000_000;
const USAGE = "usage: node leftovers.mjs <Class>.<name> [--root <dir>] [--all] [--leave] [--before | --final] [--decided <file:line>,…] | --help";
const HELP = `leftovers — every place that names a class member in text, and whose it is. Reads text only: no Angular package needed.
  node leftovers.mjs <Class>.<name> --root <dir> --before   before a change: the places a type checker will not show (exit 0)
  node leftovers.mjs <Class>.<name> --root <dir>            after a rename or a removal: what still carries the OLD name
  node leftovers.mjs <Class>.<name> --root <dir> --final    the same, then the compiler (check): FINISHED or NOT FINISHED
<Class> is a component, a directive, a service or a base class of the project (<file>#<Class> when two classes share the name);
<name> is an input, an output or another member; an alias with "-" is accepted as it is written.
The name is checked: before the change the class must declare it, after the change it must not (pass the OLD name).
Marks:  CHANGE  the name on <Class> or on a class that extends it          (each one is listed with file:line and the reason)
        leave   the same name on something else                            (counted, with the reason)
        ?       the text does not say whose it is: read the place          (each one is listed)
It looks at: strings in code (setInput("…"), inputs: ["…"], hostDirectives, downgradeComponent, host bindings, selectors in
strings), keys of args / argTypes / componentInputs / useValue in tests and stories, SimpleChanges keys, style selectors (tag[name],
:host([name]), &[name]), plain and bound attributes by element, [(x)] for an output xChange, AngularJS templates (kebab-case,
by the downgraded name), calls in .js files through the name AngularJS injects a service under, tests, stories and documents.
A member with an alias: --before reads the alias too. It does not judge reads in TypeScript code or template expressions: the compiler does.
Not read: node_modules, dist, out-tsc, coverage, storybook-static, bazel-out, assets, vendor, third_party, at the root also
build, tmp, public; minified files and lines over ${LONG_LINE} characters.
Options: --root <dir> the workspace (default "."; a folder inside it is refused unless --loose), --all every place instead of
         the first ${SHOWN_PER_GROUP} per group, --leave one line for each thing that was left, --decided <file:line>,… the "?"
         places you decided to leave (they are named as decided), --gone the name is right although nothing writes it any more.
Exit code: 2 = NOT DONE (a CHANGE is left) or NOT DECIDED (a "?" is open) or NOT FINISHED · 1 = wrong name, wrong moment or
folder · 0 = DONE / FINISHED, or --before.`;

const OWN_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_FILES = [ "angular.json", "tsconfig.json", "tsconfig.app.json", "tsconfig.base.json" ];
const SKIPPED_ANYWHERE = new Set([ "node_modules", "dist", "out-tsc", "coverage", "storybook-static", "bazel-out", "assets", "vendor", "third_party" ]);
const SKIPPED_AT_ROOT = new Set([ "build", "tmp", "public" ]);
const READ_DOT_DIRECTORIES = new Set([ ".storybook" ]);
const READ = /\.(?:[cm]?[jt]sx?|html?|s?css|sass|less|mdx?)$/;
const GENERATED = /\.min\.[a-z]+$|\.bundle\.js$/;
const SCRIPT = /\.[cm]?[jt]sx?$/;
const TYPESCRIPT = /\.[cm]?tsx?$/;
const STYLE = /\.(?:s?css|sass|less)$/;
const MARKDOWN = /\.mdx?$/;
/** Files the app's own build does not compile: tests, stories, fixtures, documents. */
const OUTSIDE = /\.(?:spec|test|stories|story|e2e|po|fixtures?|mocks?|harness|cy)\.[a-z]+$|\.mdx?$|(?:^|\/)(?:e2e|cypress|playwright|docs?|testing|__tests__|__mocks__|\.storybook)\//;
const ANGULARJS_CODE = /\bangular\s*\.\s*module\b|\bfrom\s+["']angular["']|\bIComponentOptions\b|\b(?:ng|angular)\.I[A-Z]\w+/;
/** Object keys that hold the inputs of a component in a test or a story, and where the component is named. */
const STORY_KEYS = new Set([ "args", "argTypes" ]);
const INPUT_BAG_KEYS = new Set([ "componentInputs", "componentProperties", "componentProps", "inputs" ]);
const RENDER_CALLS = new Set([ "render", "createComponent", "mount" ]);
const BINDING_CALLS = new Set([ "inputBinding", "outputBinding", "twoWayBinding" ]);
const SELECTOR_CALLS = new Set([ "css", "querySelector", "querySelectorAll", "closest", "matches", "locator", "$", "$$", "query", "queryAll", "find", "get" ]);
const DECLARING_CALLS = new Set([ "Input", "Output", "input", "output", "model", "required" ]);

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const slash = file => file.split(path.sep).join("/");
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const kebabCase = text => text.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const camelCase = text => text.replace(/-([a-z0-9])/g, (whole, letter) => letter.toUpperCase());
const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const cut = (text, width) => (text.length > width ? `${text.slice(0, width - 1)}…` : text);

function fail(message) {
    console.error(message);
    process.exit(1);
}

// ---------------------------------------------------------------- arguments and the workspace

const tokens = process.argv.slice(2);
if (tokens.includes("--help") || tokens.includes("-h")) {
    console.log(HELP);
    process.exit(0);
}
/** Options that take a value, and the plain switches. */
const VALUE_OPTIONS = [ "--root", "--decided", "--alias-of" ];
const SWITCHES = [ "--all", "--before", "--leave", "--final", "--gone", "--loose", "--json" ];
const valueAt = new Set(tokens.flatMap((token, index) => (VALUE_OPTIONS.includes(token) ? [ index + 1 ] : [])));
const unknownFlag = tokens.find((token, index) => token.startsWith("-") && !valueAt.has(index) && ![ ...VALUE_OPTIONS, ...SWITCHES ].includes(token));
if (unknownFlag) fail(`unknown option ${unknownFlag}\n${USAGE}`);
for (const option of VALUE_OPTIONS) {
    const at = tokens.indexOf(option);
    if (at !== -1 && (tokens[at + 1] ?? "--").startsWith("--")) fail(`${option} needs a value\n${USAGE}`);
}
const valuesOf = option => tokens.flatMap((token, index) => (token === option ? [ tokens[index + 1] ] : []));
const rootIndex = tokens.indexOf("--root");
const givenRoot = rootIndex === -1 ? "." : tokens[rootIndex + 1];
const listAll = tokens.includes("--all");
const before = tokens.includes("--before");
const listLeave = tokens.includes("--leave");
const final = tokens.includes("--final");
const json = tokens.includes("--json");
/** "file:line" places the reader has decided (a "?" that stays on purpose): they no longer hold the verdict back */
const decidedPlaces = valuesOf("--decided").flatMap(value => value.split(",")).map(place => place.trim().split("\\").join("/").replace(/^\.\//, "")).filter(Boolean);
/** set by the script itself when it reads the alias of a member: the name of the member whose alias this is */
const aliasOf = valuesOf("--alias-of")[0] ?? null;
if (final && before) fail(`--final is the last check after a change; --before is before it: give one of them\n${USAGE}`);
const positional = tokens.filter((token, index) => !token.startsWith("-") && !valueAt.has(index));
// "<file>#<Class>.<name>" names the class of one file when several files declare a class of that name
const askedFile = (positional[0] ?? "").includes("#") ? positional[0].slice(0, positional[0].lastIndexOf("#")).split("\\").join("/").replace(/^\.\//, "") : null;
const [ className, name, ...tooMany ] = (positional[0] ?? "").slice((positional[0] ?? "").lastIndexOf("#") + 1).split(".");
// a name with "-" is the public name (alias) of an input or output: templates bind it as it is written
if (positional.length !== 1 || tooMany.length || !/^[A-Za-z_$][\w$]*$/.test(className ?? "") || !/^[A-Za-z_$][\w$]*(?:-[\w$]+)*$/.test(name ?? "")) {
    const selector = /^[a-z][\w]*-[\w-]*$/.test(className ?? "") ? `\n  "${className}" looks like a selector: give the class (ng-facts usages ${className} prints it)` : "";
    fail(`${USAGE}\n  <Class>.<name>: the class and the member, for example ButtonComponent.disabled (after a rename: the OLD name)${selector}`);
}

const notes = [];
const note = text => notes.push(cut(`! ${text}`, LINE_WIDTH));
/** What to say when a --root value carries a stray quote: PowerShell reads \" before the closing quote as a quote. */
const quoteHint = value => (value.includes("\"") ? " (a \" is part of the folder name: in PowerShell drop the backslash before the closing quote)" : "");

/** --root itself when it holds angular.json or a tsconfig, else its only child folder that does. */
function findWorkspace(directory) {
    const holdsWorkspace = folder => WORKSPACE_FILES.some(file => existsSync(path.join(folder, file)));
    const holdsAnyWorkspaceFile = folder => {
        try {
            return readdirSync(folder).some(file => file === "angular.json" || /^tsconfig.*\.json$/.test(file));
        } catch {
            return false;
        }
    };
    if (!existsSync(directory) || !statSync(directory).isDirectory()) fail(`--root ${givenRoot}: no such folder${quoteHint(givenRoot)}`);
    if (holdsWorkspace(directory)) return directory;
    // a folder inside the workspace: the verdict would cover only that subtree, so the workspace is named instead
    if (!tokens.includes("--loose")) {
        for (let parent = path.dirname(directory); parent !== path.dirname(parent); parent = path.dirname(parent)) {
            if (!holdsAnyWorkspaceFile(parent)) continue;
            fail(`--root ${givenRoot} is inside the workspace ${slash(parent)}: pass --root "${slash(parent)}" (a verdict for a part of it would miss the rest; --loose reads only this folder)`);
        }
    }
    const children = readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_ANYWHERE.has(entry.name) && holdsWorkspace(path.join(directory, entry.name)))
        .map(entry => entry.name);
    if (children.length === 1) {
        note(`--root ${givenRoot} has no angular.json or tsconfig.json; its only folder that has one is used: ${children[0]}/`);
        return path.join(directory, children[0]);
    }
    if (children.length) return fail(`--root ${givenRoot} has no angular.json or tsconfig.json, and ${children.length} of its folders do (${children.slice(0, 6).join(", ")}): give the workspace folder`);
    // text can be read anywhere: a folder with sources and no workspace file is read as it is, and a line says so
    note(`--root ${givenRoot} has no angular.json or tsconfig.json: every source file under it is read as it is`);
    return directory;
}

const root = findWorkspace(path.resolve(givenRoot));
const skippedFolders = [];

function filesUnder(directory, atRoot) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith(".") ? !READ_DOT_DIRECTORIES.has(entry.name) : SKIPPED_ANYWHERE.has(entry.name) || (atRoot && SKIPPED_AT_ROOT.has(entry.name))) {
                if (!entry.name.startsWith(".") && entry.name !== "node_modules") skippedFolders.push(`${slash(path.relative(root, file))}/`);
                return [];
            }
            return filesUnder(file, false);
        }
        if (!entry.isFile() || !READ.test(entry.name) || GENERATED.test(entry.name) || statSync(file).size > MAX_FILE_SIZE) return [];
        return [ file ];
    });
}

const files = filesUnder(root, true).map(file => ({ shown: slash(path.relative(root, file)), text: readFileSync(file, "utf8"), classes: [], decorators: [] }));
const fileByName = new Map(files.map(file => [ file.shown, file ]));
if (!files.length) fail(`--root ${givenRoot}: no source file to read (.ts, .js, .html, style sheets, .md)`);

// ---------------------------------------------------------------- reading text: strings, brackets, lines

/** The index after the string that opens at `index`; a line end closes an unfinished one. */
function stringEnd(text, index) {
    const quote = text[index];
    for (let position = index + 1; position < text.length; position++) {
        const char = text[position];
        if (char === "\\") position++;
        else if (char === quote) return position + 1;
        else if (char === "\n") return position;
    }
    return text.length;
}

/** The index after the template literal that opens at `index`, over nested ${ … }. */
function templateEnd(text, index) {
    for (let position = index + 1; position < text.length; position++) {
        const char = text[position];
        if (char === "\\") position++;
        else if (char === "`") return position + 1;
        else if (char === "$" && text[position + 1] === "{") position = balancedEnd(text, position + 1) - 1;
    }
    return text.length;
}

/** The index after the bracket that closes the one at `index`; strings and comments are skipped. */
function balancedEnd(text, index) {
    let depth = 0;
    for (let position = index; position < text.length; position++) {
        const char = text[position];
        if (char === "\"" || char === "'") position = stringEnd(text, position) - 1;
        else if (char === "`") position = templateEnd(text, position) - 1;
        else if (char === "/" && text[position + 1] === "/") position = (text.indexOf("\n", position) + 1 || text.length + 1) - 1;
        else if (char === "/" && text[position + 1] === "*") position = text.indexOf("*/", position + 2) + 1 || text.length;
        else if (char === "(" || char === "[" || char === "{") depth++;
        else if ((char === ")" || char === "]" || char === "}") && --depth === 0) return position + 1;
    }
    return text.length;
}

/** True when a "/" at `index` starts a regular expression and not a division. */
function regexStartsAt(text, index) {
    let back = index - 1;
    while (back >= 0 && /\s/.test(text[back])) back--;
    if (back < 0 || "(,=:[!&|?{;+-*%<>~^".includes(text[back])) return true;
    const word = /[A-Za-z]/.test(text[back]) ? text.slice(Math.max(0, back - 9), back + 1).match(/[A-Za-z]+$/)[0] : "";
    return [ "return", "typeof", "case", "void", "delete", "throw", "in", "of", "else", "do" ].includes(word);
}

/** The index after the regular expression that opens at `index`, or -1 when the line ends first. */
function regexEnd(text, index) {
    let inClass = false;
    for (let position = index + 1; position < text.length; position++) {
        const char = text[position];
        if (char === "\n") return -1;
        if (char === "\\") position++;
        else if (char === "[") inClass = true;
        else if (char === "]") inClass = false;
        else if (char === "/" && !inClass) return position + 1;
    }
    return -1;
}

/**
 * One pass over TypeScript or JavaScript. For every offset of `offsets` (ascending) it says where the offset is: in code, in a
 * string (which one) or in a comment, and which brackets are open around it. `zones` are all strings and comments, in order.
 */
function lexAt(text, offsets) {
    const contexts = new Array(offsets.length);
    const zones = [];
    const stack = [];
    let next = 0;
    const take = (until, zone, string) => {
        while (next < offsets.length && offsets[next] < until) contexts[next++] = { zone, string, stack: stack.slice(-6) };
    };
    /** The text of a template literal from `position` to its end or to the next "${"; returns where code goes on. */
    const templateText = (position, string) => {
        const from = position;
        for (; position < text.length; position++) {
            const char = text[position];
            if (char === "\\") position++;
            else if (char === "`" || (char === "$" && text[position + 1] === "{")) break;
        }
        take(Math.min(position + 1, text.length), "string", string);
        zones.push([ from, position ]);
        if (text[position] === "`" || position >= text.length) {
            string.end = Math.min(position, text.length);
            return position + 1;
        }
        stack.push({ open: "${", at: position + 1, string });
        return position + 2;
    };
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        if (char === "/" && (text[index + 1] === "/" || text[index + 1] === "*")) {
            let end = text[index + 1] === "/" ? text.indexOf("\n", index) : text.indexOf("*/", index + 2);
            end = end === -1 ? text.length : end + (text[index + 1] === "/" ? 0 : 2);
            take(end, "comment", { start: index, end, quote: "" });
            zones.push([ index, end ]);
            index = end;
            continue;
        }
        if (char === "\"" || char === "'") {
            const end = stringEnd(text, index);
            take(end, "string", { start: index + 1, end: text[end - 1] === char && end - 1 > index ? end - 1 : end, quote: char });
            zones.push([ index, end ]);
            index = end;
            continue;
        }
        if (char === "`") {
            index = templateText(index + 1, { start: index + 1, end: text.length, quote: "`" });
            continue;
        }
        if (char === "/" && regexStartsAt(text, index)) {
            const end = regexEnd(text, index);
            if (end !== -1) {
                take(end, "string", { start: index + 1, end: end - 1, quote: "/" });
                zones.push([ index, end ]);
                index = end;
                continue;
            }
        }
        while (next < offsets.length && offsets[next] <= index) contexts[next++] = { zone: "code", string: null, stack: stack.slice(-6) };
        if (char === "(" || char === "[" || char === "{") stack.push({ open: char, at: index });
        else if (char === ")" || char === "]" || char === "}") {
            const top = stack.at(-1);
            if (top?.open === "${" && char === "}") {
                stack.pop();
                index = templateText(index + 1, top.string);
                continue;
            }
            const opener = char === ")" ? "(" : char === "]" ? "[" : "{";
            const match = stack.findLastIndex(entry => entry.open === opener || entry.open === "${");
            if (match !== -1 && stack[match].open === opener && stack.length - match <= 3) stack.length = match;
        }
        index++;
    }
    take(Infinity, "code", null);
    return { contexts, zones };
}

/** What stands before an open bracket: the function called, the key or variable an object or array is given to, "index:x" for x[…]. */
function labelOf(text, entry) {
    if (entry.label !== undefined) return entry.label;
    const before = text.slice(Math.max(0, entry.at - 200), entry.at);
    let label = "";
    // "function render(" declares a function: only a call counts
    if (entry.open === "(") label = before.match(/(?<!\bfunction\s+)(?<![\w$])([\w$]+)\s*(?:<[^()]*>)?\s*$/)?.[1] ?? "";
    else if (entry.open !== "${") {
        const key = before.match(/(?:([\w$]+)|["'`]([^"'`\n]*)["'`])\s*\??\s*:\s*$/);
        const variable = key ? null : before.match(/([\w$]+)\s*(?::[^=;(){}]*)?=\s*$/);
        const indexed = key || variable || entry.open !== "[" ? null : before.match(/([\w$]+)\s*$/);
        label = key ? key[1] ?? key[2] : variable ? variable[1] : indexed ? `index:${indexed[1]}` : "";
    }
    entry.label = label;
    return label;
}

function inZone(zones, index) {
    let low = 0;
    let high = zones.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (zones[middle][1] <= index) low = middle + 1;
        else if (zones[middle][0] > index) high = middle - 1;
        else return true;
    }
    return false;
}

function lineStartsOf(file) {
    if (!file.lineStarts) {
        file.lineStarts = [ 0 ];
        for (let index = file.text.indexOf("\n"); index !== -1; index = file.text.indexOf("\n", index + 1)) file.lineStarts.push(index + 1);
    }
    return file.lineStarts;
}

/** The line that holds `offset`: its number from 0, its start and its end. */
function lineAt(file, offset) {
    const starts = lineStartsOf(file);
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle] <= offset) low = middle;
        else high = middle - 1;
    }
    return { number: low, start: starts[low], end: (starts[low + 1] ?? file.text.length + 1) - 1 };
}

// ---------------------------------------------------------------- reading markup: one opening tag and its attributes

/** The opening tag that starts at `start` ("<name"): its name, where it ends, and every attribute with the place of its name. */
function readTag(text, start) {
    const tagName = text.slice(start + 1, start + 80).match(/^[a-zA-Z][\w:-]*/)?.[0];
    if (!tagName) return null;
    const limit = Math.min(text.length, start + 8000);
    const attributes = [];
    let position = start + 1 + tagName.length;
    while (position < limit) {
        const char = text[position];
        if (char === ">") return { name: tagName, start, end: position + 1, attributes };
        if (char === "<") return { name: tagName, start, end: position, attributes };
        if (/\s/.test(char) || char === "/") {
            position++;
            continue;
        }
        const nameStart = position;
        while (position < limit && !/[\s=>]/.test(text[position]) && !(text[position] === "/" && text[position + 1] === ">")) position++;
        const attribute = { raw: text.slice(nameStart, position), start: nameStart, end: position, value: null };
        let after = position;
        while (after < limit && /\s/.test(text[after])) after++;
        if (text[after] === "=") {
            after++;
            while (after < limit && /\s/.test(text[after])) after++;
            // \" inside a JavaScript string is the quote of the markup; the bare " around it belongs to JavaScript
            const escaped = text[after] === "\\" && (text[after + 1] === "\"" || text[after + 1] === "'");
            const quote = text[escaped ? after + 1 : after];
            if (quote === "\"" || quote === "'") {
                const open = escaped ? after + 1 : after;
                const close = text.indexOf(escaped ? `\\${quote}` : quote, open + 1);
                if (close === -1 || close > limit) return { name: tagName, start, end: limit, attributes };
                attribute.value = text.slice(open + 1, close);
                position = close + (escaped ? 2 : 1);
            } else {
                position = after;
                while (position < limit && !/[\s>]/.test(text[position])) position++;
                attribute.value = text.slice(after, position);
            }
        }
        attributes.push(attribute);
    }
    return { name: tagName, start, end: limit, attributes };
}

/**
 * The opening tag that holds `offset`, and the attribute whose NAME holds it (null inside a value or between attributes).
 * `isText(index)` says whether a "<" may start markup (in a script: only inside a string or a comment).
 */
function tagAt(text, offset, floor, isText) {
    let from = offset;
    for (let attempt = 0; attempt < 8; attempt++) {
        const start = text.lastIndexOf("<", from - 1);
        if (start === -1 || start < floor || offset - start > 8000) return null;
        from = start;
        if (!/[a-zA-Z]/.test(text[start + 1] ?? "") || (isText && !isText(start))) continue;
        const tag = readTag(text, start);
        // a tag that closed before the offset may have been text inside a quoted value of an earlier tag: look further back
        if (!tag || offset >= tag.end) continue;
        return { tag, attribute: tag.attributes.find(found => offset >= found.start && offset < found.end) ?? null };
    }
    return null;
}

/** The names a tag carries, without the binding brackets: what an attribute selector is matched against. */
function namesOn(tag) {
    tag.names ??= new Set(tag.attributes.map(attribute => attribute.raw.replace(/^(?:\[\(|\[|\(|\*|bind-|bindon-|on-)/, "").replace(/(?:\)\]|\]|\))$/, "")));
    return tag.names;
}

function classesOn(tag) {
    tag.classList ??= (tag.attributes.find(attribute => attribute.raw === "class")?.value ?? "").split(/\s+/);
    return tag.classList;
}

// ---------------------------------------------------------------- the classes of the project, their selectors, the family

const CLASS_DECLARATION = /(?:^|[\n;})])[ \t]*((?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:declare\s+)?class\s+([A-Za-z_$][\w$]*))/g;

/** The index after the type parameters that open at `index` ("<"). */
function afterTypeParameters(text, index) {
    let depth = 0;
    for (let position = index; position < Math.min(text.length, index + 3000); position++) {
        if (text[position] === "<") depth++;
        else if (text[position] === ">" && text[position - 1] !== "=" && --depth === 0) return position + 1;
    }
    return index;
}

/** "a, b[c]" as alternatives: the element, the attributes and the classes each one asks for. */
function alternativesOf(selector) {
    return selector.split(",").map(part => part.trim()).filter(Boolean).map(part => {
        const bare = part.replace(/:not\([^)]*\)/g, "");
        return {
            text: part,
            element: bare.match(/^[a-zA-Z][\w-]*/)?.[0] ?? null,
            attributes: [ ...bare.matchAll(/\[\s*([\w-]+)[^\]]*\]/g) ].map(found => found[1]),
            classes: [ ...bare.replace(/\[[^\]]*\]/g, "").matchAll(/\.([\w-]+)/g) ].map(found => found[1])
        };
    });
}

const stringsIn = text => [ ...text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g) ].map(found => found[2]);

/** A path written in a decorator (templateUrl, styleUrl), as the file of the project it names. */
function resolveFrom(file, url) {
    const candidates = [ path.posix.join(path.posix.dirname(file.shown), url), path.posix.normalize(url), path.posix.join("src", url) ];
    return candidates.find(candidate => fileByName.has(candidate)) ?? null;
}

const classesByName = new Map();
/** Where the body of a class ends: the bracket that closes its "{". */
const bodyEndOf = declared => (declared.bodyEnd ??= declared.bodyOpen === -1 ? declared.file.text.length : balancedEnd(declared.file.text, declared.bodyOpen));
const templateOwner = new Map();
const styleOwner = new Map();
/** every downgradeComponent({ component: X }) call: the class, and the AngularJS name it is registered under when the text says it */
const downgradeCalls = [];
/** files with a @Component or @Directive this script could not tie to a class */
const unreadDecorators = [];
/** kebab-case element name in AngularJS templates → the Angular class registered with downgradeComponent */
const downgraded = new Map();
/** kebab-case names of components and directives written in AngularJS itself */
const angularJsOwn = new Set();

for (const file of files) {
    if (!SCRIPT.test(file.shown)) continue;
    const { text } = file;
    if (text.includes("downgradeComponent")) {
        for (const call of text.matchAll(/\bdowngradeComponent\s*\(\s*(?:\{\s*component\s*:\s*([\w$]+))?/g)) {
            const ahead = text.slice(Math.max(0, call.index - 200), call.index);
            // .directive("name", downgradeComponent(…))   or   const made = downgradeComponent(…); … .directive("name", made)
            const variable = ahead.match(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*$/)?.[1];
            const registered = ahead.match(/\.directive\(\s*["'`]([\w$]+)["'`]\s*,\s*$/)?.[1]
                ?? (variable ? text.match(new RegExp(`\\.directive\\(\\s*["'\`]([\\w$]+)["'\`]\\s*,\\s*${escapeRegExp(variable)}\\b`))?.[1] : null);
            downgradeCalls.push({ component: call[1] ?? null, registered: registered ?? null });
            if (registered && call[1]) downgraded.set(kebabCase(registered), { component: call[1], file });
        }
    }
    if (text.includes(".component(") || text.includes(".directive(")) {
        for (const found of text.matchAll(/\.(?:component|directive)\(\s*["'`]([\w$]+)["'`]\s*,(?!\s*downgradeComponent)/g)) angularJsOwn.add(kebabCase(found[1]));
    }
    if (!TYPESCRIPT.test(file.shown) || !text.includes("class ")) continue;
    for (const found of text.matchAll(CLASS_DECLARATION)) {
        const start = found.index + found[0].length - found[1].length;
        let position = start + found[1].length;
        while (/\s/.test(text[position] ?? "")) position++;
        if (text[position] === "<") position = afterTypeParameters(text, position);
        const extended = text.slice(position, position + 300).match(/^\s*extends\s+([A-Za-z_$][\w$.]*)\s*/);
        // the "{" of the body: after the type arguments of the base class, which may hold braces of their own
        let bodyOpen = position + (extended?.[0].length ?? 0);
        if (text[bodyOpen] === "<") bodyOpen = afterTypeParameters(text, bodyOpen);
        bodyOpen = text.indexOf("{", bodyOpen);
        const declared = { name: found[2], base: extended?.[1].split(".").at(-1) ?? null, file, start, bodyOpen, selector: null, alternatives: [], unreadable: false, decorator: null, inputLists: [] };
        file.classes.push(declared);
        classesByName.set(declared.name, [ ...classesByName.get(declared.name) ?? [], declared ]);
    }
    if (!text.includes("@Component") && !text.includes("@Directive")) continue;
    for (const found of text.matchAll(/@(Component|Directive)\s*\(/g)) {
        const open = found.index + found[0].length - 1;
        const end = balancedEnd(text, open);
        const owner = file.classes.find(declared => declared.start >= end);
        // between the decorator and its class: other decorators, modifiers and comments only
        const between = owner ? text.slice(end, owner.start).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "") : "";
        if (!owner || between.length > 400 || /[;{}=]/.test(between)) {
            if (/(?:^|\n)[ \t]*$/.test(text.slice(Math.max(0, found.index - 200), found.index))) unreadDecorators.push(file.shown);
            continue;
        }
        const metadata = text.slice(open + 1, end - 1);
        owner.decorator = { start: open, end, kind: found[1] };
        file.decorators.push({ start: open, end, owner, component: found[1] === "Component" });
        const selector = metadata.match(/(?:^|[,{\s])selector\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/);
        if (selector) {
            owner.selector = selector[2];
            owner.alternatives = alternativesOf(selector[2]);
        }
        owner.unreadable = selector ? owner.alternatives.some(alternative => !alternative.element && !alternative.attributes.length && !alternative.classes.length) : /(?:^|[,{\s])selector\s*:/.test(metadata);
        const templateUrl = metadata.match(/\btemplateUrl\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
        const template = templateUrl ? resolveFrom(file, templateUrl) : null;
        if (template) templateOwner.set(template, owner);
        owner.template = template ? fileByName.get(template).text : /\btemplate\s*:/.test(metadata) ? metadata : null;
        for (const list of metadata.matchAll(/\bstyleUrls?\s*:\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/g)) {
            for (const url of stringsIn(list[1])) {
                const style = resolveFrom(file, url);
                if (style) styleOwner.set(style, owner);
            }
        }
        // { directive: X, inputs: [ "a", "b: c" ] } in hostDirectives: the names X shows on this class's element
        for (const entry of metadata.matchAll(/\{[^{}]*\bdirective\s*:\s*([\w$]+)[^{}]*\}/g)) {
            const exposed = [ ...entry[0].matchAll(/\b(?:inputs|outputs)\s*:\s*\[([^\]]*)\]/g) ].flatMap(list => stringsIn(list[1]));
            owner.inputLists.push({ directive: entry[1], exposed: exposed.map(text => text.split(":").at(-1).trim()) });
        }
    }
}

/** Several classes carry the name and the text does not say which one is meant. */
const AMBIGUOUS = { name: "?", ambiguous: true };

/** The declaration a class name written in `file` means: the one in that file, the one it imports, the only one outside tests. */
function resolveClass(found, file) {
    const candidates = classesByName.get(found);
    if (!candidates) return null;
    if (candidates.length === 1) return candidates[0];
    const own = candidates.find(declared => declared.file === file);
    if (own) return own;
    const imported = file.text.match(new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\b${escapeRegExp(found)}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`))?.[1];
    if (imported) {
        const bases = [ path.posix.join(path.posix.dirname(file.shown), imported), path.posix.normalize(imported) ];
        const named = candidates.find(declared => bases.some(base => [ `${base}.ts`, `${base}/index.ts`, base ].includes(declared.file.shown)));
        if (named) return named;
    }
    const real = candidates.filter(declared => !OUTSIDE.test(declared.file.shown));
    return real.length === 1 ? real[0] : AMBIGUOUS;
}

function baseOf(declared) {
    if (declared.baseClass === undefined) {
        const resolved = declared.base ? resolveClass(declared.base, declared.file) : null;
        declared.baseClass = resolved?.ambiguous ? null : resolved;
    }
    return declared.baseClass;
}
function ancestorsOf(declared) {
    if (!declared.ancestors) {
        declared.ancestors = [];
        for (let current = baseOf(declared); current && !declared.ancestors.includes(current) && declared.ancestors.length < 30; current = baseOf(current)) declared.ancestors.push(current);
    }
    return declared.ancestors;
}
const MEMBER_START = "(?:^|\\n)[ \\t]*(?:@[\\w$.]+\\s*(?:\\([^\\n]*\\))?[ \\t]*)*(?:(?:public|protected|private|readonly|override|static|declare|accessor|abstract|async)\\s+)*(?:(?:get|set)\\s+)?\\*?";
/** The start of a member line at the indentation of the class's members. */
function memberStart(declared) {
    const body = declared.file.text.slice(declared.start, bodyEndOf(declared));
    const indent = body.match(/\{[^\n]*\n(?:\s*\n)*([ \t]+)\S/)?.[1];
    return { body, start: indent ? MEMBER_START.replace("[ \\t]*", `${indent}(?![ \\t])`) : MEMBER_START };
}
/** True when the class has a member of that name: a line at the indentation of the class's members, or a parameter property. */
function declaresMember(declared, member) {
    const { body, start } = memberStart(declared);
    return new RegExp(`${start}${escapeRegExp(member)}\\s*[!?]?\\s*[=:;(<]`).test(body)
        || new RegExp(`\\bconstructor\\s*\\([^)]*\\b(?:public|protected|private|readonly)\\s+(?:readonly\\s+)?${escapeRegExp(member)}\\b`).test(body);
}
/** The names of the members a class declares (approximately: lines at the members' indentation). */
function memberNamesOf(declared) {
    const { body, start } = memberStart(declared);
    return [ ...body.matchAll(new RegExp(`${start}([A-Za-z_$][\\w$]*)\\s*[!?]?\\s*[=:;(<]`, "g")) ].map(found => found[1]).filter(found => found !== "constructor");
}
/** The member of the class whose public name (alias) is `alias`, or null. */
function memberWithAlias(declared, alias) {
    const body = declared.file.text.slice(declared.start, bodyEndOf(declared));
    const quotedAlias = `["'\`]${escapeRegExp(alias)}["'\`]`;
    return body.match(new RegExp(`${MEMBER_START}([\\w$]+)\\s*=\\s*(?:input|model|output)\\b[^\\n;]*\\balias\\s*:\\s*${quotedAlias}`))?.[1]
        ?? body.match(new RegExp(`@(?:Input|Output)\\(\\s*(?:\\{[^}]*\\balias\\s*:\\s*)?${quotedAlias}[^\\n]*?\\)\\s*(?:(?:public|protected|readonly|override|set)\\s+)*([\\w$]+)`))?.[1]
        ?? null;
}
/** The alias (public name) of a member of the class, or null. */
function aliasOfMember(declared, member) {
    const body = declared.file.text.slice(declared.start, bodyEndOf(declared));
    return body.match(new RegExp(`${MEMBER_START}${escapeRegExp(member)}\\s*=\\s*(?:input|model|output)\\b[^\\n;]*\\balias\\s*:\\s*["'\`]([^"'\`]+)["'\`]`))?.[1]
        ?? body.match(new RegExp(`@(?:Input|Output)\\(\\s*(?:\\{[^}]*\\balias\\s*:\\s*)?["'\`]([^"'\`]+)["'\`][^\\n]*\\)\\s*(?:(?:public|protected|readonly|override|set)\\s+)*${escapeRegExp(member)}\\b`))?.[1]
        ?? null;
}
/** Edit distance of two short names, to name a close member when the asked one does not exist. */
function distance(left, right) {
    const row = Array.from({ length: right.length + 1 }, (unused, index) => index);
    for (let i = 1; i <= left.length; i++) {
        let diagonal = row[0];
        row[0] = i;
        for (let j = 1; j <= right.length; j++) {
            const above = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (left[i - 1].toLowerCase() === right[j - 1].toLowerCase() ? 0 : 1));
            diagonal = above;
        }
    }
    return row[right.length];
}

const named = classesByName.get(className);
if (!named) {
    const close = [ ...classesByName.keys() ].filter(found => found.toLowerCase().includes(className.toLowerCase().replace(/(component|directive)$/, ""))).slice(0, 12);
    fail(`no class ${className} under ${slash(path.relative(process.cwd(), root)) || "."}${close.length ? `. Close names: ${close.join(", ")}` : ` (${classesByName.size} classes read)`}`);
}
// A name that tests reuse (a stand-in, a host) means the class of the app, not the ones in tests.
const outsideTests = named.filter(declared => !OUTSIDE.test(declared.file.shown));
// an absolute <file> is read relative to the workspace
const askedRelative = askedFile !== null && path.isAbsolute(askedFile) ? slash(path.relative(root, askedFile)) : askedFile;
const inAskedFile = askedFile === null ? null : named.filter(declared => `/${declared.file.shown}`.endsWith(`/${askedRelative}`));
if (inAskedFile && inAskedFile.length !== 1) fail(`no class ${className} in a file "${askedFile}" (it is declared in: ${named.map(declared => declared.file.shown).join(", ")})`);
const asked = inAskedFile ?? (outsideTests.length ? outsideTests : named);
if (asked.length > 1) fail(`${asked.length} classes are named ${className}: say which one, as ${asked.slice(0, 4).map(declared => `${declared.file.shown}#${className}.${name}`).join(" or ")}`);

// The member may be declared on a base class: then every class that extends that base carries it.
const lineage = [ asked[0], ...ancestorsOf(asked[0]) ];
const declaredOn = lineage.find(declared => declaresMember(declared, name)) ?? null;
const roots = declaredOn && declaredOn !== asked[0] ? [ declaredOn ] : asked;
const rootClass = roots[0].name;
const allClasses = [ ...classesByName.values() ].flat();
const family = new Set(allClasses.filter(declared => roots.includes(declared) || ancestorsOf(declared).some(ancestor => roots.includes(ancestor))));
/** Classes that share a base class with <Class>, used when the text no longer says where the member was declared. */
const relatives = new Set();
const sharedBase = declaredOn ? null : ancestorsOf(asked[0])[0] ?? null;
if (sharedBase) {
    const bases = ancestorsOf(asked[0]);
    for (const declared of allClasses) {
        if (!family.has(declared) && (bases.includes(declared) || ancestorsOf(declared).some(ancestor => bases.includes(ancestor)))) relatives.add(declared);
    }
}
const familyAlternatives = [ ...family ].flatMap(declared => declared.alternatives.map(alternative => ({ ...alternative, owner: declared })));
const unreadableSelectors = [ ...family ].filter(declared => declared.unreadable).map(declared => declared.name);
const familyElements = new Set(familyAlternatives.map(alternative => alternative.element).filter(Boolean));
/** element name → the classes that declare it */
const elements = new Map();
/** classes outside the family that show the member through hostDirectives → the class of the family they show */
const exposers = new Map();
/** classes outside the family that declare an element of the family (a stand-in in a test, or a second component) → that selector of the family */
const twins = new Map();
for (const declared of allClasses) {
    for (const alternative of declared.alternatives) {
        if (!alternative.element) continue;
        elements.set(alternative.element, [ ...elements.get(alternative.element) ?? [], declared ]);
        if (!family.has(declared) && familyElements.has(alternative.element)) twins.set(declared, familyAlternatives.find(found => found.element === alternative.element));
    }
    if (family.has(declared)) continue;
    const through = declared.inputLists.find(list => list.exposed.includes(name) && family.has(resolveClass(list.directive, declared.file)));
    if (through) exposers.set(declared, through.directive);
}
for (const declared of allClasses) {
    const exposing = family.has(declared) ? null : ancestorsOf(declared).find(ancestor => exposers.has(ancestor));
    if (exposing) exposers.set(declared, exposers.get(exposing));
}
const hasAngularJs = downgraded.size > 0 || angularJsOwn.size > 0;
/** downgradeComponent calls that may give the family an AngularJS name this script cannot read */
const unreadDowngrades = downgradeCalls.filter(call => !call.registered && (!call.component || [ ...family, ...relatives ].some(declared => declared.name === call.component))).length;
const kebabName = kebabCase(name);
const changeName = `${name}Change`;
const changeDeclared = [ ...family ].some(declared => declaresMember(declared, changeName));
const familyNames = [ ...new Set([ ...family ].map(declared => declared.name)) ];
const familyMention = new RegExp(`(?<![\\w$-])(?:${[ ...familyNames, ...familyElements ].map(escapeRegExp).join("|")})(?![\\w$-])`);
const mentionsFamily = file => (file.mentions ??= familyMention.test(file.text));
const elementPattern = [ ...familyElements ].map(escapeRegExp).join("|") || "\\0";
const familyMarkup = new RegExp(`<(?:${elementPattern})(?![\\w-])|(?<![\\w$-])(?:${familyAlternatives.filter(alternative => !alternative.element).flatMap(alternative => alternative.attributes).map(escapeRegExp).join("|") || "\\0"})(?![\\w$-])`);

const describe = declared => (roots.includes(declared) ? declared.name : `${declared.name}, which extends ${rootClass}`);

/** AngularJS names under which a class of the family is injected: .service("x", Class), .factory("x", downgradeInjectable(Class)) */
const injectedNames = new Set();
for (const file of files) {
    if (!SCRIPT.test(file.shown) || !/\.(?:service|factory|provider)\s*\(/.test(file.text)) continue;
    for (const found of file.text.matchAll(/\.(?:service|factory|provider)\(\s*["'`]([\w$]+)["'`]\s*,\s*(?:downgradeInjectable\s*\(\s*)?([A-Za-z_$][\w$]*)/g)) {
        if (familyNames.includes(found[2])) injectedNames.add(found[1]);
    }
}
const injectedPattern = injectedNames.size ? new RegExp(`(?<![\\w$])(?:${[ ...injectedNames ].map(escapeRegExp).join("|")})(?![\\w$])`) : null;
/** JavaScript is type-checked only with checkJs: without it no compiler reads a .js file */
const jsChecked = readdirSync(root).filter(file => /^tsconfig.*\.json$/.test(file)).some(file => /"checkJs"\s*:\s*true/.test(readFileSync(path.join(root, file), "utf8")));
const uncheckedCode = file => SCRIPT.test(file.shown) && !TYPESCRIPT.test(file.shown) && !jsChecked;
/** [(base)] needs the output baseChange by its name: renaming or removing that output breaks the two-way binding */
const twoWayBase = name.endsWith("Change") && name.length > 6 && [ ...family ].some(declared => declaresMember(declared, name.slice(0, -6))) ? name.slice(0, -6) : null;

if (declaredOn && declaredOn !== asked[0]) note(`${name} is declared on ${rootClass}, a base class of ${className}: places on every class that extends ${rootClass} are marked CHANGE`);
if (relatives.size) note(`${className} extends ${sharedBase.name}. If ${name} was declared on ${sharedBase.name}, places on its other classes count too: they are marked ?`);
if (unreadDecorators.length) note(`${plural(unreadDecorators.length, "decorator")} not tied to a class (${unreadDecorators[0]}${unreadDecorators.length > 1 ? ", …" : ""}): their elements count as not declared`);
if (unreadableSelectors.length) note(`the selector of ${unreadableSelectors.slice(0, 3).join(", ")} is not a plain string: elements nobody declares are marked ? instead of leave`);
if (unreadDowngrades > 0) note(`${plural(unreadDowngrades, "downgradeComponent call")} without a readable AngularJS name: unknown elements in AngularJS templates are marked ?`);
// ---- is this the right name for the moment? Before a change the member exists; after it, it does not.
/** the public name templates bind when the member has an alias: read too, under its own heading */
let memberAlias = null;
/** the member whose public name `name` is, when `name` is an alias */
const aliasedMember = lineage.map(declared => memberWithAlias(declared, name)).find(Boolean) ?? null;
for (const declared of family) {
    const alias = aliasOfMember(declared, name);
    if (alias && alias !== name) memberAlias = alias;
}
const lineageComplete = !lineage.at(-1).base;
const memberList = [ ...new Set(lineage.flatMap(memberNamesOf)) ];
const closeMembers = memberList.filter(found => found !== name && (distance(found, name) <= 2 || found.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(found.toLowerCase()))).slice(0, 5);
if (aliasOf === null) {
    const stillThere = declaredOn ? `${declaredOn.name} still declares ${name}` : aliasedMember ? `"${name}" is still the alias of ${className}.${aliasedMember}` : null;
    if (!before && stillThere) {
        fail(`${stillThere}: this is before the change. Before: add --before. After a rename: pass the OLD name, not the new one.`);
    }
    if (before && !stillThere && lineageComplete) {
        fail(`${className} declares no member ${name}${closeMembers.length ? `. Close members: ${closeMembers.join(", ")}` : ""}. A wrong name? After the change: run it without --before.`);
    }
}

// ---- an alias: templates, setInput and styles use the public name. Read it too (before a change), with this same script.
let aliasReport = null;
if (aliasOf === null && memberAlias && memberAlias !== name && before) {
    const child = spawnSync(process.execPath, [ fileURLToPath(import.meta.url), `${askedFile ? `${askedFile}#` : ""}${className}.${memberAlias}`, "--root", root, "--alias-of", name, ...tokens.filter(token => [ "--before", "--all", "--leave" ].includes(token)), "--json" ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    aliasReport = { stdout: child.stdout ?? "", stderr: child.stderr ?? "", status: child.status ?? 1 };
    note(`${name} has the alias "${memberAlias}": templates, setInput and styles use that name. Its places are listed below, under "the alias"`);
}

// ---------------------------------------------------------------- verdicts

const change = why => ({ mark: "CHANGE", why });
const question = why => ({ mark: "?", why });
const leave = (category, detail) => ({ mark: "leave", category, detail });

/** Whose is a class the text names? `declared` comes from resolveClass: a declaration, null (not a class of the project) or AMBIGUOUS. */
function classVerdict(declared, what) {
    if (!declared) return question(`${what} a component this script cannot find: read the place`);
    if (declared.ambiguous) return question(`${what} a class whose name several files declare: read which one`);
    if (family.has(declared)) return change(`${what} ${describe(declared)}`);
    if (relatives.has(declared)) return question(`${what} ${declared.name}, which shares the base class ${sharedBase.name} with ${className}`);
    if (exposers.has(declared)) return question(`${what} ${declared.name}, which shows ${exposers.get(declared)}.${name} through hostDirectives`);
    return leave("other classes", declared.name);
}

const selectorMatches = (alternative, tag) => (alternative.element === null || alternative.element === tag.name)
    && alternative.attributes.every(attribute => namesOn(tag).has(attribute))
    && alternative.classes.every(found => classesOn(tag).includes(found))
    && (alternative.element !== null || alternative.attributes.length + alternative.classes.length > 0);

/** The classes that declare an element as seen from `file`: one in the same file first (a stand-in in a test), else the app's own. */
function elementOwners(tag, file) {
    const all = (elements.get(tag.name) ?? []).filter(declared => declared.alternatives.some(alternative => alternative.element === tag.name && selectorMatches(alternative, tag)));
    const own = all.filter(declared => declared.file === file);
    if (own.length) return own;
    const real = all.filter(declared => !OUTSIDE.test(declared.file.shown));
    return real.length ? real : all;
}

/** Whose is an attribute on this tag? `world` is "angular" (a template Angular compiles) or "angularjs". */
function elementVerdict(tag, world, file) {
    const shown = `<${tag.name}>`;
    if (world === "angularjs") {
        const registration = downgraded.get(tag.name);
        const registered = registration ? resolveClass(registration.component, registration.file) : null;
        if (registered?.ambiguous) return question(`${shown} in AngularJS is the downgraded ${registration.component}, a name several files declare`);
        if (registered && family.has(registered)) return change(`${shown} in AngularJS is the downgraded ${describe(registered)}`);
        if (registered && relatives.has(registered)) return question(`${shown} in AngularJS is the downgraded ${registered.name}, which shares the base class ${sharedBase.name} with ${className}`);
        if (registration) return leave(`AngularJS: the element is another downgraded class${familyElements.has(tag.name) ? `, not ${className}` : ""}`, `${shown} ${registration.component}`);
        if (angularJsOwn.has(tag.name)) return leave("AngularJS components and directives", shown);
    }
    const owners = elementOwners(tag, file);
    const matched = familyAlternatives.find(alternative => selectorMatches(alternative, tag) && (alternative.element === null || owners.includes(alternative.owner)));
    if (matched) {
        const second = matched.element ? owners.find(declared => !family.has(declared)) : null;
        if (second) return question(`two classes declare ${shown}: ${matched.owner.name} and ${second.name}`);
        const how = matched.element ? `${shown} is` : `<${tag.name || "…"} ${matched.attributes[0] ?? `class="${matched.classes[0]}"`}> carries`;
        return change(`${how} ${describe(matched.owner)}${world === "angularjs" ? " (in a file Angular does not compile)" : ""}`);
    }
    const standIn = owners.find(declared => twins.has(declared) && OUTSIDE.test(declared.file.shown));
    if (standIn) return change(`${shown} here is ${standIn.name}, which stands in for ${twins.get(standIn).owner.name} in this test (same selector)`);
    const exposing = owners.find(declared => exposers.has(declared));
    if (exposing) return question(`${shown} is ${exposing.name}, which shows ${exposers.get(exposing)}.${name} through hostDirectives: it follows unless the old name is kept as an alias`);
    const related = owners.find(declared => relatives.has(declared));
    if (related) return question(`${shown} is ${related.name}, which shares the base class ${sharedBase.name} with ${className}`);
    if (owners.length) return leave("other components", `${shown} ${owners[0].name}`);
    if (!tag.name.includes("-")) return leave("plain HTML elements", shown);
    if (unreadableSelectors.length || (world === "angularjs" && unreadDowngrades > 0)) return question(`nobody in this project declares ${shown}`);
    return leave("elements this project does not declare (a library or AngularJS)", shown);
}

/** What an attribute name says about the member: "plain", "bound", "two-way", "event", "attr" (a DOM attribute), "pair" ((nameChange)), or null. */
function attributeForm(raw, world) {
    let core = raw.replace(/\\$/, "");
    let form = "plain";
    if (core.startsWith("[(") && core.endsWith(")]")) [ core, form ] = [ core.slice(2, -2), "two-way" ];
    else if (core.startsWith("[") && core.endsWith("]")) [ core, form ] = [ core.slice(1, -1), "bound" ];
    else if (core.startsWith("(") && core.endsWith(")")) [ core, form ] = [ core.slice(1, -1), "event" ];
    else if (core.startsWith("bindon-")) [ core, form ] = [ core.slice(7), "two-way" ];
    else if (core.startsWith("bind-")) [ core, form ] = [ core.slice(5), "bound" ];
    else if (core.startsWith("on-")) [ core, form ] = [ core.slice(3), "event" ];
    if (form === "bound" && core.startsWith("attr.")) [ core, form ] = [ core.slice(5), "attr" ];
    if (world === "angularjs") core = camelCase(core);
    if (core === name) return form;
    return core === changeName && form === "event" && !changeDeclared ? "pair" : null;
}

// ---------------------------------------------------------------- the scan

const GROUPS = [ "string", "style", "angularjs", "unchecked", "attribute", "binding", "outside" ];
const groups = Object.fromEntries(GROUPS.map(group => [ group, [] ]));
const notJudged = { code: 0, codeFiles: new Set(), unchecked: 0, uncheckedFiles: new Set(), text: 0, textFiles: new Set(), strings: 0, comments: 0, longLines: 0, testReads: 0, testReadFiles: new Set() };
let total = 0;

function add(group, file, offset, verdict) {
    const placed = OUTSIDE.test(file.shown) ? "outside" : group;
    const entry = { file, offset, group: placed, ...verdict };
    groups[placed].push(entry);
    return entry;
}
function skipCode(file) {
    if (uncheckedCode(file)) {
        notJudged.unchecked++;
        notJudged.uncheckedFiles.add(file.shown);
        return null;
    }
    notJudged.code++;
    notJudged.codeFiles.add(file.shown);
    return null;
}
function skipText(file) {
    notJudged.text++;
    notJudged.textFiles.add(file.shown);
    return null;
}

/** A place inside an opening tag: an attribute named after the member gets its group and verdict, anything else is counted. */
function markupHit(file, offset, found, world) {
    if (!found.attribute) return skipText(file);
    const form = attributeForm(found.attribute.raw, world);
    if (!form) return add(world === "angularjs" ? "angularjs" : "attribute", file, offset, leave("other attribute names that hold the word", found.attribute.raw.replace(/\\$/, "")));
    let verdict = elementVerdict(found.tag, world, file);
    if (verdict.mark === "CHANGE" && form === "attr") verdict = question(`${verdict.why}: [attr.${name}] sets a DOM attribute of that name, not the member. A style selector may need it`);
    if (verdict.mark === "CHANGE" && form === "pair") verdict.why += `: (${changeName}) is the other half of [(${name})]`;
    if (form === "pair" && verdict.mark === "leave") return skipText(file);
    return add(world === "angularjs" ? "angularjs" : form === "plain" ? "attribute" : "binding", file, offset, verdict);
}

/** (nameChange) at `offset`: a place only when it is an event on an element of the family. */
function pairHit(file, offset, found, world) {
    if (found?.attribute && attributeForm(found.attribute.raw, world) === "pair") markupHit(file, offset, found, world);
}

/** [(base)] at `offset` when the member is the output baseChange: a place only on an element of the family. */
function twoWayHit(file, offset, found, world) {
    const raw = found?.attribute?.raw.replace(/\\$/, "");
    if (raw !== `[(${twoWayBase})]` && raw !== `bindon-${twoWayBase}`) return;
    const verdict = elementVerdict(found.tag, world, file);
    if (verdict.mark === "leave") return;
    total++;
    if (verdict.mark === "CHANGE") verdict.why += `: [(${twoWayBase})] listens to the output ${name} by its name`;
    add("binding", file, offset, verdict);
}

const markupWorld = file => (templateOwner.has(file.shown) || MARKDOWN.test(file.shown) || !hasAngularJs ? "angular" : "angularjs");

function scanMarkup(file, offsets) {
    const world = markupWorld(file);
    const { text } = file;
    for (const offset of offsets) {
        if (file.pairs.has(offset)) {
            pairHit(file, offset, tagAt(text, offset, 0, null), world);
            continue;
        }
        if (file.twoWays.has(offset)) {
            twoWayHit(file, offset, tagAt(text, offset, 0, null), world);
            continue;
        }
        if (text.startsWith(kebabName, offset) && kebabName !== name && world !== "angularjs") continue;
        total++;
        const comment = text.lastIndexOf("<!--", offset);
        const inComment = comment !== -1 && text.indexOf("-->", comment) > offset;
        const found = tagAt(text, offset, inComment ? comment + 4 : 0, null);
        if (!found) {
            if (inComment) notJudged.comments++;
            else skipText(file);
            continue;
        }
        const entry = markupHit(file, offset, found, world);
        if (inComment && entry?.mark === "CHANGE") entry.why += " (commented out)";
    }
}

// ---- style sheets

/** Comments blanked out, every offset kept. */
function withoutStyleComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\/|(?<![:\w])\/\/[^\n]*/g, comment => " ".repeat(comment.length));
}

/** The selectors of the block that holds `index`: the text before the nearest "{" that is still open. */
function parentSelectors(text, index) {
    let depth = 0;
    for (let position = index - 1; position >= 0 && index - position < 20000; position--) {
        if (text[position] === "}") depth++;
        else if (text[position] === "{" && text[position - 1] !== "#") {
            if (depth-- > 0) continue;
            let start = position;
            while (start > 0 && !/[;{}]/.test(text[start - 1])) start--;
            return { selectors: text.slice(start, position).split(",").map(part => part.trim().split(/[\s>+~]+/).at(-1)).filter(Boolean), at: start };
        }
    }
    return null;
}

const carriedClasses = new Map();
/** True when an element of the family may carry the CSS class: the class is written in a file of the family or on one of its tags. */
function familyCarries(token) {
    if (!carriedClasses.has(token)) {
        const wordOf = new RegExp(`(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`);
        const onTag = new RegExp(`<(?:${elementPattern})(?![\\w-])[^>]*?(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`);
        const inFamilyFiles = [ ...family ].some(declared => wordOf.test(declared.file.text) || (typeof declared.template === "string" && wordOf.test(declared.template)));
        carriedClasses.set(token, inFamilyFiles || familyElements.size === 0 || files.some(file => file.text.includes(token) && mentionsFamily(file) && onTag.test(file.text)));
    }
    return carriedClasses.get(token);
}

/**
 * Whose is `[name]` in a selector? `compound` is what stands before the bracket without a space (some-tag, .x, &, :host( ),
 * `owner` the component whose style sheet this is (null for a global sheet or a selector in a string), `at` where the selector starts.
 */
function selectorVerdict(file, text, at, compound, owner, depth = 0) {
    if (/#\{|\$/.test(compound)) return question("the selector is built from a variable");
    if (/^:host\b/.test(compound)) return owner ? classVerdict(owner, ":host is") : question(":host of a style sheet no component names");
    if (compound.startsWith("&")) {
        const parent = depth < 6 ? parentSelectors(text, at) : null;
        if (!parent?.selectors.length) return question("& with no parent selector found");
        const verdicts = parent.selectors.map(selector => selectorVerdict(file, text, parent.at, selector + compound.slice(1), owner, depth + 1));
        return verdicts.find(verdict => verdict.mark === "CHANGE") ?? verdicts.find(verdict => verdict.mark === "?") ?? verdicts[0];
    }
    const bare = compound.replace(/:not\([^)]*\)?/g, "").replace(/::?[\w-]+(?:\([^)]*\)?)?/g, "");
    const tagName = bare.match(/^[a-zA-Z][\w-]*/)?.[0] ?? "";
    const pseudoTag = {
        name: tagName,
        names: new Set([ ...bare.matchAll(/\[\s*([\w-]+)/g) ].map(found => found[1])),
        classList: [ ...bare.replace(/\[[^\]]*\]?/g, "").matchAll(/\.([\w-]+)/g) ].map(found => found[1]),
        attributes: []
    };
    if (tagName || familyAlternatives.some(alternative => selectorMatches(alternative, pseudoTag))) return elementVerdict(pseudoTag, "angular", file);
    if (pseudoTag.classList.length && !pseudoTag.classList.some(familyCarries)) return leave("class selectors whose class no element of the family carries", `.${pseudoTag.classList[0]}`);
    if (!owner) return question("an attribute selector with no element name: it styles any element with that attribute");
    if (/::ng-deep|:host-context/.test(text.slice(Math.max(0, at - 300), at))) return question(`an attribute selector with no element name, under ::ng-deep in the styles of ${owner.name}`);
    if (owner.template === null || familyMarkup.test(owner.template)) return question(`an attribute selector with no element name, in the styles of ${owner.name}, whose template holds an element of ${rootClass}`);
    return leave("style sheets of components whose template holds no such element", owner.name);
}

/** `[name]` at `offset` (the name) inside selector text: the verdict, or null when it is not an attribute selector. */
function selectorAt(file, text, offset, owner) {
    let open = offset - 1;
    while (open >= 0 && (text[open] === " " || text[open] === "\t")) open--;
    let after = offset + name.length;
    while (text[after] === " " || text[after] === "\t") after++;
    if (text[open] !== "[" || !/[\]=~|^$*]/.test(text[after] ?? "")) return null;
    // [name]="…" is a binding, not a selector
    if (text[after] === "]" && /^\s*=/.test(text.slice(after + 1, after + 4))) return null;
    let start = open;
    while (start > 0 && !/[\s,{};>+~"'`]/.test(text[start - 1])) start--;
    return selectorVerdict(file, text, start, text.slice(start, open), owner);
}

function scanStyle(file, offsets) {
    const text = withoutStyleComments(file.text);
    const owner = styleOwner.get(file.shown) ?? null;
    for (const offset of offsets) {
        total++;
        if (text[offset] === " " && file.text[offset] !== " ") {
            notJudged.comments++;
            continue;
        }
        const verdict = /[\w$-]/.test(text[offset - 1] ?? "") || /[\w$-]/.test(text[offset + name.length] ?? "") ? null : selectorAt(file, text, offset, owner);
        if (verdict) add("style", file, offset, verdict);
        else skipText(file);
    }
}

// ---- TypeScript and JavaScript

const classAt = (file, offset) => file.decorators.find(decorator => offset >= decorator.start && offset < decorator.end)?.owner
    ?? file.classes.findLast(declared => declared.start <= offset && offset < bodyEndOf(declared)) ?? null;

/** The nearest match of `pattern` (one capture: a class name) above `offset`, else the first one in the file. */
function nearestAbove(text, offset, pattern) {
    const found = [ ...text.matchAll(pattern) ];
    return (found.findLast(match => match.index < offset) ?? found[0])?.[1] ?? null;
}

/** The component a `x.y.setInput(` talks to: what the variable at the start of the chain was created from or typed as. */
function receiverOwner(text, callAt) {
    const chain = text.slice(Math.max(0, callAt - 200), callAt).match(/(?:\bthis\s*\.\s*)?([A-Za-z_$][\w$]*)(?:\s*[?!]?\.\s*[\w$]+(?:\(\))?)*\s*[?!]?\.\s*setInput\s*$/)?.[1];
    if (chain) {
        const variable = escapeRegExp(chain);
        const created = nearestAbove(text, callAt, new RegExp(`\\b${variable}\\b\\s*(?:[!?]?:[^=;\\n]*)?=[^;\\n]*?\\bcreateComponent\\s*(?:<[^>()]*>)?\\(\\s*([A-Za-z_$][\\w$]*)`, "g"))
            ?? nearestAbove(text, callAt, new RegExp(`\\b${variable}\\b\\s*[!?]?:\\s*(?:ComponentFixture|ComponentRef)\\s*<\\s*([A-Za-z_$][\\w$]*)`, "g"));
        if (created) return created;
    }
    return nearestAbove(text, callAt, /\b(?:createComponent\s*(?:<[^>()]*>)?\(|ComponentRef<|ComponentFixture<)\s*([A-Za-z_$][\w$]*)/g);
}

/** The first argument of the nearest render( / createComponent( call that is open around the place. */
function renderedClass(text, stack) {
    const call = stack.findLast(entry => entry.open === "(" && RENDER_CALLS.has(labelOf(text, entry)));
    return call ? text.slice(call.at + 1, call.at + 120).match(/^\s*([A-Za-z_$][\w$]*)/)?.[1] ?? null : null;
}

/** The text of an object literal without what is nested in it: its own keys and their plain values. */
function ownKeys(text) {
    for (let round = 0; round < 12; round++) {
        const flatter = text.replace(/\{[^{}]*\}|\[[^[\]]*\]|\([^()]*\)/g, "");
        if (flatter === text) break;
        text = flatter;
    }
    return text;
}

function countString() {
    notJudged.strings++;
    return null;
}

/** X["name"] or Pick<X, "name">: a type that names the member. The compiler checks it, but only in a file the app's build compiles. */
function typeKey(file, offset, typeName, how) {
    const owner = resolveClass(typeName, file);
    if (!owner || !OUTSIDE.test(file.shown)) return skipCode(file);
    const verdict = classVerdict(owner, `a key in ${how} of`);
    if (verdict.mark === "CHANGE") verdict.why += ": checked only by the type check of the tests or stories";
    return add("string", file, offset, verdict);
}

/** The name inside a string of TypeScript or JavaScript that is not markup: what the code around it says about whose it is. */
function stringHit(file, offset, context) {
    const { text } = file;
    const { string, stack } = context;
    const content = text.slice(string.start, string.end).trim();
    const top = stack.at(-1);
    const label = top ? labelOf(text, top) : "";
    const enclosing = classAt(file, offset);
    const whole = content === name;
    const first = new RegExp(`^${escapeRegExp(name)}\\s*(?::|$)`).test(content);
    const aliased = new RegExp(`:\\s*${escapeRegExp(name)}$`).test(content);
    const inFamily = enclosing !== null && family.has(enclosing);
    const end = offset + name.length;
    if (whole && top?.open === "(" && label === "setInput") return add("string", file, offset, classVerdict(resolveClass(receiverOwner(text, top.at), file), "setInput on"));
    if (whole && top?.open === "(" && BINDING_CALLS.has(label)) return add("string", file, offset, classVerdict(resolveClass(renderedClass(text, stack) ?? receiverOwner(text, top.at), file), `${label} on`));
    if ((first || aliased) && top?.open === "[" && (label === "inputs" || label === "outputs")) {
        const holder = stack.at(-2);
        const sibling = holder?.open === "{" ? ownKeys(text.slice(holder.at + 1, balancedEnd(text, holder.at) - 1)).match(/\b(?:directive|component)\s*:\s*([A-Za-z_$][\w$]*)/)?.[1] : null;
        const owner = sibling ? resolveClass(sibling, file) : enclosing;
        if (!owner) return countString();
        if (first) return add("string", file, offset, classVerdict(owner, `${label}: [ … ] of`));
        if (family.has(owner)) return add("string", file, offset, question(`"${content}" keeps ${name} as the public name of a member of ${owner.name}: fine when that is on purpose`));
        return countString();
    }
    if (whole && inFamily && (label === "alias" || (top?.open === "(" && DECLARING_CALLS.has(label)) || /\balias\s*:\s*$/.test(text.slice(Math.max(0, string.start - 20), string.start - 1)))) {
        // read for the alias of a member: this is that member's own declaration
        if (aliasOf !== null) return skipCode(file);
        return add("string", file, offset, question(`an alias: "${name}" stays the public name of a member of ${enclosing.name}. Fine when that is on purpose`));
    }
    if (inFamily && (content === `attr.${name}` || whole) && top?.open === "(" && (label === "HostBinding" || label === "HostListener")) {
        return add("string", file, offset, question(`a host binding of ${enclosing.name} with the same name: it sets a DOM attribute or property, not the member`));
    }
    if (inFamily && stack.some(entry => entry.open === "{" && labelOf(text, entry) === "host") && file.decorators.some(decorator => offset >= decorator.start && offset < decorator.end)) {
        return add("string", file, offset, question(`host: { … } of ${enclosing.name}: an expression here is checked by the compiler only with typeCheckHostBindings`));
    }
    if (whole && top?.open === "[" && label.startsWith("index:")) {
        if (inFamily && changesParameters(enclosing).has(label.slice(6))) return add("string", file, offset, change(`a SimpleChanges key in ${describe(enclosing)}: no compiler checks it`));
        return typeKey(file, offset, label.slice(6), "[ … ]");
    }
    const picked = whole ? text.slice(Math.max(0, string.start - 200), string.start - 1).match(/\b(Pick|Omit)<\s*([A-Za-z_$][\w$]*)\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*,[^;<>]*$/) : null;
    if (picked) return typeKey(file, offset, picked[2], `${picked[1]}<…>`);
    // [name]="…", (name)="…", [(name)]="…" with no tag around it: a piece of a template kept in a string
    const wrapped = (text[offset - 1] === "[" && text[end] === "]") || (text[offset - 1] === "(" && text[end] === ")");
    if (wrapped && /^\]?\s*=\s*\\?["']/.test(text.slice(end + 1, end + 8))) {
        return add("binding", file, offset, question("a binding in a piece of template with no element around it: read which element it is put on"));
    }
    if (!/[\w$-]/.test(text[offset - 1] ?? "") && !/[\w$-]/.test(text[end] ?? "")) {
        const decorator = file.decorators.find(found => offset >= found.start && offset < found.end);
        // selector: "[name]" of a decorator is how that class is matched, not a style
        if (decorator && /\bselector\s*:\s*$/.test(text.slice(Math.max(0, string.start - 30), string.start - 1)) && text[offset - 1] === "[") {
            if (family.has(decorator.owner)) return add("string", file, offset, question(`the selector of ${decorator.owner.name} itself: [${name}] is how it is matched. Renaming the input does not rename the selector: decide whether it changes too`));
            return add("string", file, offset, leave("selectors of other classes", decorator.owner.name));
        }
        const verdict = selectorAt(file, text, offset, decorator?.owner ?? null);
        // prose may hold [name] too: an undecided one counts only where the string is given to something that takes a selector
        if (verdict && (verdict.mark !== "?" || decorator || (top?.open === "(" && SELECTOR_CALLS.has(label) && mentionsFamily(file)))) return add("style", file, offset, verdict);
        if (verdict) return countString();
    }
    if ((whole || first) && OUTSIDE.test(file.shown) && mentionsFamily(file)) {
        return add("string", file, offset, question(`a string in a test or story that names ${rootClass}: the text does not say whether it is the member`));
    }
    return whole || first ? countString() : skipText(file);
}

/** The names under which a class reads its SimpleChanges: the parameter of ngOnChanges and anything typed SimpleChanges. */
function changesParameters(declared) {
    if (!declared.changes) {
        const body = declared.file.text.slice(declared.start, bodyEndOf(declared));
        declared.changes = new Set([ ...body.matchAll(/\bngOnChanges\s*\(\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*:\s*SimpleChanges\b/g) ].map(found => found[1] ?? found[2]));
    }
    return declared.changes;
}

/** The name in code: a key of args / componentInputs in a test or story, a SimpleChanges key, the member of a stand-in; else the compiler's. */
function codeHit(file, offset, context) {
    const { text } = file;
    let after = offset + name.length;
    while (/\s/.test(text[after] ?? "")) after++;
    let back = offset - 1;
    while (back >= 0 && /\s/.test(text[back])) back--;
    const top = context.stack.at(-1);
    const enclosing = classAt(file, offset);
    const inFamily = enclosing !== null && family.has(enclosing);
    const isKey = top?.open === "{" && (text[back] === "{" || text[back] === ",") && ((text[after] === ":" && text[after + 1] !== ":") || text[after] === "," || text[after] === "}");
    if (isKey) {
        const label = labelOf(text, top);
        if (STORY_KEYS.has(label)) {
            const owner = resolveClass(nearestAbove(text, offset, /\bcomponent\s*:\s*([A-Za-z_$][\w$]*)/g), file);
            if (owner || mentionsFamily(file)) return add("string", file, offset, classVerdict(owner, `a key of ${label}: { … } in a story of`));
        }
        if (INPUT_BAG_KEYS.has(label)) {
            // "inputs" is a common word: it counts only inside a render( … ) call; the longer names count anywhere
            const rendered = renderedClass(text, context.stack);
            const owner = resolveClass(rendered ?? nearestAbove(text, offset, /\b(?:render|createComponent|mount)\s*(?:<[^>()]*>)?\(\s*([A-Za-z_$][\w$]*)/g), file);
            if (label === "inputs" ? rendered !== null && owner !== null : owner !== null || mentionsFamily(file)) return add("string", file, offset, classVerdict(owner, `a key of ${label}: { … } given to`));
        }
        // { provide: X, useValue: { name: … } }: a hand-written stand-in for X; nothing checks its keys against X
        if (label === "useValue" || label === "useFactory") {
            const holder = context.stack.at(-2);
            const provided = holder?.open === "{" ? ownKeys(text.slice(holder.at + 1, balancedEnd(text, holder.at) - 1)).match(/\bprovide\s*:\s*([A-Za-z_$][\w$]*)/)?.[1] : null;
            const owner = provided ? resolveClass(provided, file) : null;
            if (owner) return add("string", file, offset, classVerdict(owner, `a key of ${label}: { … } that stands in for`));
        }
        if (label === "props" && mentionsFamily(file)) {
            return add("string", file, offset, question(`a key of props: { … } next to a template in a file that names ${rootClass}: it follows when the template binds it by that name`));
        }
        // ngOnChanges({ name }: SimpleChanges)
        if (inFamily && /\bngOnChanges\s*\(\s*$/.test(text.slice(Math.max(0, top.at - 30), top.at))) {
            return add("string", file, offset, change(`a SimpleChanges key in ${describe(enclosing)}: no compiler checks it`));
        }
    }
    if (text[back] === "." && inFamily) {
        const receiver = text.slice(Math.max(0, back - 60), back).match(/([A-Za-z_$][\w$]*)\s*\??$/)?.[1];
        if (receiver && changesParameters(enclosing).has(receiver)) return add("string", file, offset, change(`a SimpleChanges key in ${describe(enclosing)}: no compiler checks it`));
    }
    if (enclosing && twins.has(enclosing) && /[!?=:;(<]/.test(text[after] ?? "")) {
        const line = lineAt(file, offset);
        if (new RegExp(`${MEMBER_START}$`).test(`\n${text.slice(line.start, offset)}`)) {
            return add("string", file, offset, OUTSIDE.test(file.shown)
                ? change(`${enclosing.name} stands in for ${twins.get(enclosing).owner.name} in a test (same selector ${twins.get(enclosing).element}): its member follows`)
                : question(`${enclosing.name} declares the selector ${twins.get(enclosing).element} too: a second component with a member of the same name`));
        }
    }
    // .js code: no compiler reads it. A call through the name AngularJS injects the class under is the member.
    if (text[back] === "." && uncheckedCode(file) && !OUTSIDE.test(file.shown)) {
        const receiver = text.slice(Math.max(0, back - 60), back).match(/([A-Za-z_$][\w$]*)\s*\??$/)?.[1];
        if (receiver && injectedNames.has(receiver)) return add("unchecked", file, offset, change(`${receiver}.${name}: AngularJS injects ${rootClass} as ${receiver}`));
        if (injectedPattern?.test(text)) return add("unchecked", file, offset, question(`.${name} in a file that injects ${[ ...injectedNames ].join(" or ")} (${rootClass}): read whose member it is`));
    }
    if (text[back] === "." && OUTSIDE.test(file.shown) && mentionsFamily(file)) {
        notJudged.testReads++;
        notJudged.testReadFiles.add(file.shown);
    }
    return skipCode(file);
}

/**
 * A story template is fed from the story's args: on an element of the family, a bare `name` on the right side of a binding
 * ([x]="name", {{ name }} inside a value) reads the key `name` of args, and that key is the member, so a rename renames
 * the key. No compiler reads the template string. While the file still has a key of that name the read is a question (it
 * follows the key); once the key is gone the read points at nothing: CHANGE. Returns false when the place is not such a read.
 */
const STORY_FILE = /\.stor(?:y|ies)\.[a-z]+$/;
function storyRead(file, offset, found, world, isText) {
    const { text } = file;
    const holder = found.tag.attributes.findLast(attribute => attribute.value !== null && attribute.end <= offset);
    if (!holder || (!/^[[(*]/.test(holder.raw) && !holder.value.includes("{{"))) return false;
    const valueStart = text.indexOf(holder.value, holder.end);
    const at = offset - valueStart;
    if (valueStart === -1 || at < 0 || at + name.length > holder.value.length) return false;
    // a member of something else (x.name), a text in quotes ('name') and a call (name()) are not the key of args
    if (/[\w$.'"]/.test(holder.value[at - 1] ?? "") || /[\w$'"(]/.test(holder.value[at + name.length] ?? "")) return false;
    if (elementVerdict(found.tag, world, file).mark !== "CHANGE") return false;
    const key = new RegExp(`(?<![\\w$.])${escapeRegExp(name)}\\s*(?::(?!:)|[,}])`, "g");
    const hasKey = [ ...text.matchAll(key) ].some(match => !isText(match.index));
    add("binding", file, offset, hasKey
        ? question(`the right side of ${holder.raw}="…" on <${found.tag.name}> reads the key ${name} of this story's args: when that key is renamed, rename this read too`)
        : change(`the right side of ${holder.raw}="…" on <${found.tag.name}> reads ${name} from this story's args, which have no key ${name} (any more): it follows the renamed key`));
    return true;
}

function scanScript(file, offsets) {
    const { text } = file;
    const { contexts, zones } = lexAt(text, offsets);
    const isText = index => inZone(zones, index);
    const angularJsFile = !OUTSIDE.test(file.shown) && (!TYPESCRIPT.test(file.shown) || ANGULARJS_CODE.test(text));
    offsets.forEach((offset, position) => {
        const context = contexts[position];
        const kebab = kebabName !== name && text.startsWith(kebabName, offset);
        const inComponent = file.decorators.some(decorator => decorator.component && offset >= decorator.start && offset < decorator.end);
        const world = hasAngularJs && angularJsFile && !inComponent ? "angularjs" : "angular";
        if (file.pairs.has(offset) || file.twoWays.has(offset)) {
            const hit = file.pairs.has(offset) ? pairHit : twoWayHit;
            if (context.zone !== "code") hit(file, offset, tagAt(text, offset, context.string.quote === "`" || context.zone === "comment" ? context.string.start : Math.max(0, offset - 3000), isText), world);
            return;
        }
        if (kebab && (world !== "angularjs" || context.zone === "code")) return;
        total++;
        if (context.zone === "code") return void codeHit(file, offset, context);
        const floor = context.string.quote === "`" || context.zone === "comment" ? context.string.start : Math.max(0, offset - 3000);
        const found = tagAt(text, offset, floor, isText);
        // in a "…" string a tag may be glued from pieces, and what looks like one may be code: only an exact attribute counts
        const markup = found?.attribute && (context.string.quote === "`" || context.zone === "comment" || attributeForm(found.attribute.raw, world));
        if (markup) {
            const entry = markupHit(file, offset, found, world);
            if (context.zone === "comment" && entry?.mark === "CHANGE") entry.why += " (in a comment: documentation)";
            return;
        }
        if (found && !found.attribute && context.string.quote === "`") {
            if (STORY_FILE.test(file.shown) && storyRead(file, offset, found, world, isText)) return;
            return void skipText(file);
        }
        if (context.zone === "comment") return void notJudged.comments++;
        if (kebab) return void skipText(file);
        stringHit(file, offset, context);
    });
}

const word = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`, "g");
const kebabWord = kebabName === name ? null : new RegExp(`(?<![\\w$-])${escapeRegExp(kebabName)}(?![\\w$-])`, "g");
/** (nameChange), the other half of [(name)]: looked for only on elements, and only when no class of the family declares a member of that name */
const pairWord = changeDeclared ? null : new RegExp(`(?<![\\w$-])(?:${escapeRegExp(changeName)}|${escapeRegExp(kebabCase(changeName))})(?![\\w$-])`, "g");
/** [(base)] and bindon-base, when the member is the output baseChange of a two-way pair */
const twoWayWord = twoWayBase ? new RegExp(`(?<=\\[\\(|bindon-)${escapeRegExp(twoWayBase)}(?![\\w$-])`, "g") : null;

for (const file of files) {
    const hasName = file.text.includes(name);
    const hasKebab = kebabWord !== null && hasAngularJs && !STYLE.test(file.shown) && file.text.includes(kebabName);
    const hasTwoWay = twoWayWord !== null && (file.text.includes(`[(${twoWayBase})]`) || file.text.includes(`bindon-${twoWayBase}`));
    file.pairs = new Set();
    file.twoWays = new Set();
    if (!hasName && !hasKebab && !hasTwoWay) continue;
    let offsets = hasName ? [ ...file.text.matchAll(word) ].map(found => found.index) : [];
    if (hasKebab) offsets.push(...[ ...file.text.matchAll(kebabWord) ].map(found => found.index));
    file.pairs = new Set(pairWord && !STYLE.test(file.shown) ? [ ...file.text.matchAll(pairWord) ].map(found => found.index) : []);
    file.twoWays = new Set(twoWayWord && !STYLE.test(file.shown) ? [ ...file.text.matchAll(twoWayWord) ].map(found => found.index) : []);
    offsets = [ ...offsets, ...file.pairs, ...file.twoWays ].sort((left, right) => left - right);
    // minified and generated lines are not read
    const starts = offsets.length ? lineStartsOf(file) : [];
    if (starts.some((start, index) => (starts[index + 1] ?? file.text.length) - start > LONG_LINE)) {
        const kept = offsets.filter(offset => {
            const line = lineAt(file, offset);
            return line.end - line.start <= LONG_LINE;
        });
        notJudged.longLines += offsets.length - kept.length;
        offsets = kept;
    }
    if (!offsets.length) continue;
    if (STYLE.test(file.shown)) scanStyle(file, offsets);
    else if (SCRIPT.test(file.shown)) scanScript(file, offsets);
    else scanMarkup(file, offsets);
}

// ---------------------------------------------------------------- the report

const TITLES = {
    string: "names in strings and keys — setInput(\"…\"), inputs: [\"…\"], args: { … }, useValue: { … }, SimpleChanges: no compiler checks these",
    style: "style selectors — tag[name], :host([name]), selectors in strings: no compiler checks these",
    angularjs: "AngularJS templates — files and strings Angular does not compile: no compiler checks these",
    unchecked: "AngularJS code in .js files — no tsconfig has checkJs, so no compiler checks these",
    attribute: `plain attributes — <tag ${name}> in templates Angular compiles: the compiler does not check these`,
    binding: `bound attributes — [${name}], (${name}), [(${name})] in templates Angular compiles${before ? ": the type-checked script sees these too" : ""}`,
    outside: "tests, stories, fixtures and documents — not part of the app's build"
};
const everything = GROUPS.flatMap(group => groups[group]);
const whereOf = entry => `${entry.file.shown}:${lineAt(entry.file, entry.offset).number + 1}`;
const matchesPlace = (place, entry) => whereOf(entry) === place || whereOf(entry).endsWith(`/${place}`);
// a "?" the reader has decided (--decided file:line) no longer holds the verdict back; a CHANGE always does
for (const entry of everything) if (entry.mark === "?" && decidedPlaces.some(place => matchesPlace(place, entry))) entry.mark = "decided";
for (const place of decidedPlaces) {
    if (!everything.some(entry => entry.mark === "decided" && matchesPlace(place, entry))) note(`--decided ${place}: no place marked ? is there (a CHANGE place cannot be decided away)`);
}
const count = mark => everything.filter(entry => entry.mark === mark).length;
const filesOf = mark => new Set(everything.filter(entry => entry.mark === mark).map(entry => entry.file.shown)).size;
const judgedElsewhere = notJudged.code + notJudged.unchecked + notJudged.text + notJudged.strings + notJudged.comments;
const membersShown = [ ...family ].filter(declared => !roots.includes(declared));
const withSelector = declared => `${declared.name}${declared.selector ? ` <${declared.selector}>` : ""}`;
const changes = count("CHANGE");
const questions = count("?");
const decided = count("decided");

// after a change, a name that nothing declares and nothing writes is most likely a wrong name
if (!before && aliasOf === null && total === 0 && !declaredOn && !aliasedMember && closeMembers.length && !tokens.includes("--gone")) {
    fail(`nothing in this workspace declares or writes ${name}. Close members of ${className}: ${closeMembers.join(", ")}. A wrong name? If ${name} is right and every place of it is already changed, add --gone`);
}

const verdict = before ? "IMPACT" : changes ? "NOT DONE" : questions ? "NOT DECIDED" : "DONE";
const exitCode = before ? 0 : verdict === "DONE" ? 0 : 2;
/** the places under the alias, read by this same script (before a change) */
const aliasCounts = aliasReport && aliasReport.status !== 1 ? JSON.parse(aliasReport.stdout.trim().split("\n").at(-1) || "{}") : null;

if (json) {
    // one line for another script (ls-facts prints it next to its own answer); the same verdict as the text
    const places = everything.filter(entry => entry.mark !== "leave").map(entry => ({ mark: entry.mark, group: entry.group, place: whereOf(entry), why: entry.why }));
    console.log(JSON.stringify({ verdict, change: changes, question: questions, decided, leave: count("leave"), notJudged: judgedElsewhere, unchecked: notJudged.unchecked, places, alias: aliasCounts }));
    process.exit(exitCode);
}

const counts = `${changes} CHANGE (${plural(filesOf("CHANGE"), "file")}), ${questions} to look at${decided ? `, ${decided} decided by you` : ""}, ${count("leave")} belong to something else, ${judgedElsewhere} not judged here`;
console.log(before
    ? `${verdict} — ${className}.${name} in text: ${counts.replace(" CHANGE ", " places would have to change ")}`
    : `${verdict} — ${className}.${name} is still written ${total} times: ${counts}`);
console.log(cut(`family: ${withSelector(roots[0])}${membersShown.length ? `; extended by ${membersShown.length} class${membersShown.length === 1 ? "" : "es"}: ${membersShown.slice(0, 4).map(withSelector).join(", ")}${membersShown.length > 4 ? ", …" : ""}` : "; no class extends it"}`, LINE_WIDTH * 2));
for (const text of notes) console.log(text);

function placeOf(entry) {
    const where = whereOf(entry);
    const line = lineAt(entry.file, entry.offset);
    // the place is never cut: only the code after it
    return `${where}  ${cut(entry.file.text.slice(line.start, line.end).trim(), Math.max(60, 190 - where.length))}`;
}

/** "other components ×192 (<app-card> CardComponent ×152, …); plain HTML elements ×20 (<a> ×18, …)" */
function leaveSummary(entries) {
    const categories = new Map();
    for (const entry of entries) {
        const details = categories.get(entry.category) ?? new Map();
        bump(details, entry.detail);
        categories.set(entry.category, details);
    }
    const sum = details => [ ...details.values() ].reduce((left, right) => left + right, 0);
    return [ ...categories ].sort((left, right) => sum(right[1]) - sum(left[1])).map(([ category, details ]) => {
        const sorted = [ ...details ].sort((left, right) => right[1] - left[1]);
        const examples = sorted.slice(0, 2).map(([ detail, times ]) => `${detail} ×${times}`).join(", ");
        return `${category} ×${sum(details)} (${examples}${sorted.length > 2 ? ", …" : ""})`;
    }).join("; ");
}

/** --leave: one line for each thing that was left, with how often and the first place, so that a reader can check the reasons. */
function leaveLines(entries) {
    const things = new Map();
    for (const entry of entries) {
        const key = `${entry.category}: ${entry.detail}`;
        things.set(key, { times: (things.get(key)?.times ?? 0) + 1, first: things.get(key)?.first ?? entry });
    }
    return [ ...things ].sort((left, right) => right[1].times - left[1].times)
        .map(([ key, { times, first } ]) => cut(`          ×${String(times).padEnd(5)} ${key}   e.g. ${whereOf(first)}`, LINE_WIDTH * 2));
}

for (const group of GROUPS) {
    const entries = groups[group];
    if (!entries.length) continue;
    console.log(`\n${TITLES[group]}`);
    for (const mark of [ "CHANGE", "?", "decided" ]) {
        // places with the same reason stand together, the most frequent reason first
        const reasons = new Map();
        for (const entry of entries) if (entry.mark === mark) bump(reasons, entry.why);
        const marked = entries.filter(entry => entry.mark === mark).sort((left, right) => reasons.get(right.why) - reasons.get(left.why));
        const listed = listAll || mark === "decided" ? marked : marked.slice(0, SHOWN_PER_GROUP);
        // the reason stands once, above the places it is the reason for
        listed.forEach((entry, index) => {
            if (entry.why !== listed[index - 1]?.why) console.log(`  — ${entry.why}:`);
            console.log(`  ${mark.padEnd(7)} ${placeOf(entry)}`);
        });
        if (marked.length > listed.length) {
            const inFiles = new Map();
            for (const entry of marked.slice(listed.length)) bump(inFiles, entry.file.shown);
            console.log(`  ${mark.padEnd(7)} … +${marked.length - listed.length} more in ${plural(inFiles.size, "file")}; --all lists every one`);
        }
    }
    const left = entries.filter(entry => entry.mark === "leave");
    if (left.length) console.log(cut(`  leave   ${left.length}: ${leaveSummary(left)}`, LINE_WIDTH * 2));
    if (listLeave) for (const line of leaveLines(left)) console.log(line);
}

if (aliasReport) {
    console.log(`\nthe alias "${memberAlias}" — the places that name it in text: ${aliasCounts ? `${aliasCounts.change} CHANGE, ${aliasCounts.question} to look at, ${aliasCounts.leave} belong to something else` : `not read: ${aliasReport.stderr.trim().split("\n")[0]}`}`);
    const aliasPlaces = (aliasCounts?.places ?? []).filter(entry => entry.mark !== "decided");
    for (const entry of listAll ? aliasPlaces : aliasPlaces.slice(0, SHOWN_PER_GROUP)) console.log(cut(`  ${entry.mark.padEnd(7)} ${entry.place}  — ${entry.why}`, LINE_WIDTH * 2));
    if (!listAll && aliasPlaces.length > SHOWN_PER_GROUP) console.log(`  … +${aliasPlaces.length - SHOWN_PER_GROUP} more; --all lists every one`);
}

const parts = [];
if (notJudged.code) parts.push(`${notJudged.code} in TypeScript code in ${plural(notJudged.codeFiles.size, "file")} (reads of a member and other things with that name: the compiler checks them)`);
if (notJudged.unchecked) parts.push(`${notJudged.unchecked} in .js code in ${plural(notJudged.uncheckedFiles.size, "file")} that NO compiler checks${injectedNames.size ? ` (none of them goes through ${[ ...injectedNames ].join(" or ")})` : ""}`);
if (notJudged.text) parts.push(`${notJudged.text} in template expressions and text in ${plural(notJudged.textFiles.size, "file")}`);
if (notJudged.strings) parts.push(`${notJudged.strings} strings "${name}" with no component in reach`);
if (notJudged.comments) parts.push(`${notJudged.comments} in comments`);
if (parts.length) console.log(`\nnot judged here: ${parts.join("; ")}`);
if (notJudged.unchecked && listAll) console.log(`  .js files: ${[ ...notJudged.uncheckedFiles ].join(", ")}`);
if (notJudged.unchecked && !injectedNames.size && !roots[0].selector && !roots[0].decorator) {
    console.log(cut(`! ${rootClass} is not registered with AngularJS here (.service/.factory): a .js read of .${name} would go through another name`, LINE_WIDTH));
}
if (notJudged.testReads) {
    console.log(`! ${plural(notJudged.testReads, "read")} of .${name} in tests and stories that name ${rootClass}: left to the tests' own type check (${plural(notJudged.testReadFiles.size, "file")}${listAll ? "" : "; --all lists them"})`);
    if (listAll) console.log(`  ${[ ...notJudged.testReadFiles ].join(", ")}`);
}
if (notJudged.longLines || skippedFolders.length) {
    const folders = skippedFolders.length ? `folders ${skippedFolders.slice(0, 4).join(", ")}${skippedFolders.length > 4 ? ` and ${skippedFolders.length - 4} more` : ""}` : "";
    console.log(cut(`not read: ${[ folders, notJudged.longLines ? `${notJudged.longLines} places on lines over ${LONG_LINE} characters (minified)` : "" ].filter(Boolean).join("; ")}`, LINE_WIDTH));
}

/** A next command as one line an agent can paste in any shell: absolute paths, in double quotes, no placeholder. */
const nextCommand = (file, command) => (existsSync(path.join(OWN_DIRECTORY, file)) ? `node "${slash(path.join(OWN_DIRECTORY, file))}" ${command} --root "${slash(root)}"` : null);
const askedText = `${askedFile ? `${askedFile}#` : ""}${className}.${name}`;
const deciding = slash(path.join(OWN_DIRECTORY, "reference", "deciding.md"));
const questionLine = questions ? ` ${questions} places marked "?" are not decided yet.` : "";

if (before) {
    const aliasPart = aliasCounts ? ` The alias "${memberAlias}" adds ${aliasCounts.change} CHANGE and ${aliasCounts.question} "?" places (listed above).` : "";
    console.log(`\nIMPACT: ${changes} places in text would have to change with ${rootClass}.${name}; a type checker shows none of the strings, styles, AngularJS templates, tests and documents above.${aliasPart}${questionLine}`);
    const where = roots[0].selector ? nextCommand("ng-facts.mjs", `where ${rootClass}`) : null;
    if (where) console.log(`→ next: ${where}   (the screens to test afterwards; then write the impact report)`);
    process.exit(0);
}
if (changes) {
    console.log(`\nNOT DONE: ${plural(changes, "place")} still ${changes === 1 ? "carries" : "carry"} ${name} of ${rootClass} or of a class that extends it. Change each CHANGE line by hand (do not replace the word everywhere), then run this command again.${questionLine}`);
    if (final) console.log("NOT FINISHED: leftovers is not DONE, so the compiler was not run.");
    process.exit(2);
}
if (questions) {
    console.log(`\nNOT DECIDED: ${plural(questions, "place")} marked "?" ${questions === 1 ? "is" : "are"} not decided. For each one read ${deciding}: change it, or leave it on purpose and add --decided <file:line> (several: a comma between them), then run this command again. Each decided place goes in your report as "left on purpose".`);
    if (final) console.log("NOT FINISHED: leftovers is not DONE, so the compiler was not run.");
    process.exit(2);
}
const decidedLine = decided ? ` ${decided} places decided by you (--decided): name each one in your report as "left on purpose".` : "";
console.log(`\nDONE: no place this script can judge still carries ${name} of ${rootClass}.${decidedLine}`);
const decidedOption = decidedPlaces.length ? ` --decided "${decidedPlaces.join(",")}"` : "";
if (!final) {
    const finalCommand = nextCommand("leftovers.mjs", `${askedText}${decidedOption} --final`);
    console.log(`→ next: ${finalCommand}   (this check again plus the compiler: FINISHED is the last gate)`);
    process.exit(0);
}

// --final: the compiler too, so that one command and one line say whether the change is finished
const checker = [ "ls-facts.mjs", "ng-facts.mjs" ].find(file => existsSync(path.join(OWN_DIRECTORY, file)));
if (!checker) fail("--final needs ls-facts.mjs or ng-facts.mjs next to this script, for the compiler");
console.log(`\nthe compiler: node ${checker} check (on a big app it takes as long as doctor said)`);
const compiled = spawnSync(process.execPath, [ path.join(OWN_DIRECTORY, checker), "check", "--root", root, ...(listAll ? [ "--all" ] : []) ], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
for (const line of `${compiled.stdout ?? ""}${compiled.stderr ?? ""}`.trim().split("\n")) if (line && !line.startsWith("→ ")) console.log(`  ${line}`);
if (compiled.status === 0) {
    console.log(`\nFINISHED: leftovers DONE and the compiler has 0 errors.${decidedLine} Specs and stories are not compiled by check: review their diff.`);
    process.exit(0);
}
console.log(`\nNOT FINISHED: ${compiled.status === 2 ? "the compiler lists errors: fix each place it names, then run this command again" : "the compiler could not run: fix what it says above, then run this command again"}.`);
process.exit(compiled.status === 2 ? 2 : 1);
