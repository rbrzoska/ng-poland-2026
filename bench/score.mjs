import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as ng from "@angular/compiler";
import ts from "typescript";
import { loadWorkspace } from "../tool/ng-facts.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE_ROOT = path.join(ROOT, "fixture");
const EXPECTED_ROOT = path.join(ROOT, "fixture-expected");
const MAX_DETAILS = 20;

export function sources(dir) {
    return readdirSync(dir, { recursive: true }).map(entry => path.join(dir, entry)).filter(file => /\.(ts|html)$/.test(file) && statSync(file).isFile());
}

/** Indices of `left` and `right` lines that belong to their longest common subsequence. */
function commonLines(left, right) {
    const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let row = left.length - 1; row >= 0; row--) {
        for (let column = right.length - 1; column >= 0; column--) {
            table[row][column] = left[row] === right[column] ? table[row + 1][column + 1] + 1 : Math.max(table[row + 1][column], table[row][column + 1]);
        }
    }
    const inLeft = new Set();
    const inRight = new Set();
    for (let row = 0, column = 0; row < left.length && column < right.length;) {
        if (left[row] === right[column]) {
            inLeft.add(row++);
            inRight.add(column++);
        } else if (table[row + 1][column] >= table[row][column + 1]) {
            row++;
        } else {
            column++;
        }
    }
    return { inLeft, inRight };
}

function linesOf(file) {
    return (existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8") : "").split("\n");
}

/**
 * Compares a migrated copy of fixture/ with fixture-expected/, line-aligned by LCS (lines may be removed or merged).
 * correct/missed: expected lines that differ from the original and do / do not appear in the result;
 * wrong: result lines that are neither expected nor original, plus expected unchanged lines the result lost.
 * A candidate file that is missing counts as empty. `fixtureRoot`/`expectedRoot` default to the live repo copies.
 */
export function score(dir, { fixtureRoot = FIXTURE_ROOT, expectedRoot = EXPECTED_ROOT } = {}) {
    const totals = { shouldChange: 0, correct: 0, missed: 0, wrong: 0, filesExact: 0, files: 0 };
    for (const file of sources(path.join(fixtureRoot, "src"))) {
        const relative = path.relative(fixtureRoot, file);
        const before = linesOf(file);
        const expected = linesOf(path.join(expectedRoot, relative));
        const actual = linesOf(path.join(dir, relative));
        totals.files++;
        if (actual.join("\n") === expected.join("\n")) {
            totals.filesExact++;
        }
        const targets = commonLines(before, expected).inRight;
        const result = commonLines(actual, expected);
        const original = commonLines(actual, before).inLeft;
        expected.forEach((_line, index) => {
            const isTarget = !targets.has(index);
            if (isTarget) {
                totals.shouldChange++;
                if (result.inRight.has(index)) totals.correct++;
                else totals.missed++;
            } else if (!result.inRight.has(index)) {
                totals.wrong++;
            }
        });
        actual.forEach((_line, index) => {
            if (!result.inLeft.has(index) && !original.has(index)) totals.wrong++;
        });
    }
    return totals;
}

export function compile(dir) {
    try {
        execFileSync(path.join(ROOT, "node_modules/.bin/ngc"), [ "-p", path.join(dir, "tsconfig.json") ], { stdio: "pipe" });
        return 0;
    } catch (error) {
        const output = (String(error.stdout) + String(error.stderr)).replace(/\x1b\[[0-9;]*m/g, "");
        return output.match(/ - error (NG|TS)\d+/g)?.length ?? 1;
    }
}

const collapse = text => String(text ?? "").replace(/\s+/g, " ").trim();
const quote = value => `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Canonical text of an expression AST: single quotes, one space around operators, no other whitespace. */
function printExpression(node, source) {
    const print = child => printExpression(child, source);
    if (!node || node instanceof ng.EmptyExpr) return "";
    if (node instanceof ng.ThisReceiver) return "this";
    if (node instanceof ng.ImplicitReceiver) return "";
    if (node instanceof ng.LiteralPrimitive) return typeof node.value === "string" ? quote(node.value) : String(node.value);
    if (node instanceof ng.Unary) return `${node.operator}${print(node.expr)}`;
    if (node instanceof ng.Binary) return `${print(node.left)} ${node.operation} ${print(node.right)}`;
    if (node instanceof ng.Conditional) return `${print(node.condition)} ? ${print(node.trueExp)} : ${print(node.falseExp)}`;
    if (node instanceof ng.PrefixNot) return `!${print(node.expression)}`;
    if (node instanceof ng.TypeofExpression) return `typeof ${print(node.expression)}`;
    if (node instanceof ng.VoidExpression) return `void ${print(node.expression)}`;
    if (node instanceof ng.NonNullAssert) return `${print(node.expression)}!`;
    if (node instanceof ng.ParenthesizedExpression) return `(${print(node.expression)})`;
    if (node instanceof ng.PropertyRead || node instanceof ng.SafePropertyRead) {
        const receiver = print(node.receiver);
        return receiver ? `${receiver}${node instanceof ng.SafePropertyRead ? "?." : "."}${node.name}` : node.name;
    }
    if (node instanceof ng.KeyedRead || node instanceof ng.SafeKeyedRead) return `${print(node.receiver)}${node instanceof ng.SafeKeyedRead ? "?." : ""}[${print(node.key)}]`;
    if (node instanceof ng.Call || node instanceof ng.SafeCall) return `${print(node.receiver)}${node instanceof ng.SafeCall ? "?." : ""}(${node.args.map(print).join(", ")})`;
    if (node instanceof ng.BindingPipe) return `${print(node.exp)} | ${node.name}${node.args.map(argument => `:${print(argument)}`).join("")}`;
    if (node instanceof ng.LiteralArray) return `[${node.expressions.map(print).join(", ")}]`;
    if (node instanceof ng.LiteralMap) return `{${node.keys.map((key, index) => `${key.quoted ? quote(key.key) : key.key}: ${print(node.values[index])}`).join(", ")}}`;
    if (node instanceof ng.Chain) return node.expressions.map(print).join("; ");
    if (node instanceof ng.TemplateLiteral) return `\`${node.elements.map((element, index) => element.text + (node.expressions[index] ? `\${${print(node.expressions[index])}}` : "")).join("")}\``;
    if (node instanceof ng.TaggedTemplateLiteral) return `${print(node.tag)}${print(node.template)}`;
    return node.span ? collapse(String(source ?? "").slice(node.span.start, node.span.end)).replace(/\s/g, "") : "";
}

function expressionOf(value) {
    return value?.ast ? printExpression(value.ast, value.source) : collapse(value?.source);
}

function bindingKind(type) {
    return type === ng.BindingType.Property ? "" : `${ng.BindingType[type].toLowerCase()}.`;
}

function boundAttribute(binding) {
    const ast = binding.value?.ast;
    if (binding.type === ng.BindingType.Property && ast instanceof ng.LiteralPrimitive && typeof ast.value === "string") return `${binding.name}=${collapse(ast.value)}`;
    return `[${bindingKind(binding.type)}${binding.name}${binding.unit ? `.${binding.unit}` : ""}]=${expressionOf(binding.value)}`;
}

function bindingsOf(node) {
    const bindings = [];
    for (const attribute of [ ...(node.attributes ?? []), ...(node.templateAttrs ?? []), ...(node.inputs ?? []) ]) {
        bindings.push(attribute instanceof ng.TmplAstTextAttribute ? `${attribute.name}=${collapse(attribute.value)}` : boundAttribute(attribute));
    }
    for (const output of node.outputs ?? []) bindings.push(`(${output.name})=${expressionOf(output.handler)}`);
    for (const reference of node.references ?? []) bindings.push(`#${reference.name}=${collapse(reference.value)}`);
    for (const variable of node.variables ?? []) bindings.push(`let-${variable.name}=${collapse(variable.value)}`);
    return bindings.sort();
}

function textOf(node) {
    if (node instanceof ng.TmplAstText) return node.value;
    if (!(node instanceof ng.TmplAstBoundText)) return "";
    const interpolation = node.value?.ast;
    if (!(interpolation instanceof ng.Interpolation)) return node.value?.source ?? "";
    return interpolation.strings.map((text, index) => {
        const expression = interpolation.expressions[index];
        return text + (expression ? `{{${printExpression(expression, node.value.source)}}}` : "");
    }).join("");
}

function blockLabel(node) {
    if (node instanceof ng.TmplAstIfBlockBranch) return node.expression ? `@if(${expressionOf(node.expression)}${node.expressionAlias ? ` as ${node.expressionAlias.name}` : ""})` : "@else";
    if (node instanceof ng.TmplAstForLoopBlock) return `@for(${node.item.name} of ${expressionOf(node.expression)}; track ${expressionOf(node.trackBy)})`;
    if (node instanceof ng.TmplAstForLoopBlockEmpty) return "@empty";
    if (node instanceof ng.TmplAstSwitchBlock) return `@switch(${expressionOf(node.expression)})`;
    if (node instanceof ng.TmplAstSwitchBlockCase) return node.expression ? `@case(${expressionOf(node.expression)})` : "@default";
    if (node instanceof ng.TmplAstDeferredBlock) return "@defer";
    return `@${node.constructor.name.replace(/^TmplAst/, "").toLowerCase()}`;
}

function nestedBlocks(node) {
    if (node instanceof ng.TmplAstIfBlock) return node.branches;
    if (node instanceof ng.TmplAstSwitchBlock) return node.cases;
    if (node instanceof ng.TmplAstForLoopBlock) return [ ...(node.children ?? []), node.empty ].filter(Boolean);
    if (node instanceof ng.TmplAstDeferredBlock) return [ ...(node.children ?? []), node.placeholder, node.loading, node.error ].filter(Boolean);
    return node.children ?? [];
}

/** Every element of a template in document order, serialized independently of whitespace and attribute order, with its ancestor chain. */
function serializeElements(nodes, ancestors = [], out = []) {
    for (const node of nodes) {
        if (node instanceof ng.TmplAstElement || node instanceof ng.TmplAstTemplate || node instanceof ng.TmplAstContent) {
            const name = node.name ?? (node instanceof ng.TmplAstContent ? "ng-content" : "ng-template");
            const text = collapse((node.children ?? []).map(textOf).join(""));
            out.push(`${ancestors.length ? `${ancestors.join(" > ")} > ` : ""}<${[ name, ...bindingsOf(node) ].join(" ")}>${text}`);
            serializeElements(node.children ?? [], [ ...ancestors, name ], out);
        } else if (node instanceof ng.TmplAstText || node instanceof ng.TmplAstBoundText) {
            continue;
        } else if (node instanceof ng.TmplAstLetDeclaration) {
            out.push(`${ancestors.join(" > ")} @let ${node.name} = ${expressionOf(node.value)}`);
        } else if (nestedBlocks(node).length || node instanceof ng.TmplAstBlockNode) {
            const label = node instanceof ng.TmplAstIfBlock ? undefined : blockLabel(node);
            serializeElements(nestedBlocks(node), label ? [ ...ancestors, label ] : ancestors, out);
        }
    }
    return out;
}

function componentMetadata(classNode) {
    for (const decorator of ts.getDecorators(classNode) ?? []) {
        const call = decorator.expression;
        if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "Component" && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) return call.arguments[0];
    }
    return undefined;
}

function metadataProperty(metadata, name) {
    return metadata?.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText() === name)?.initializer;
}

/** Relative module specifiers are keyed by the file they resolve to (relative to `root`), so `./../lib/x` equals `../lib/x` and `../lib/x.ts`. */
function moduleKey(sourceFile, module, root) {
    if (!module.startsWith(".")) return module;
    return path.relative(root, path.resolve(path.dirname(sourceFile.fileName), module)).replace(/\.ts$/, "");
}

/** `identifiers`: the @Component `imports` array; `specifiers`: import bindings keyed `<name> from <module key>`, valued as written. */
function importsOf(sourceFile, classNode, root) {
    const metadataImports = metadataProperty(componentMetadata(classNode), "imports");
    const identifiers = metadataImports && ts.isArrayLiteralExpression(metadataImports) ? metadataImports.elements.map(element => element.getText(sourceFile)) : [];
    const specifiers = new Map();
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const module = statement.moduleSpecifier.text;
        const key = moduleKey(sourceFile, module, root);
        const clause = statement.importClause;
        if (clause?.name) specifiers.set(`default from ${key}`, `import ${clause.name.text} from "${module}"`);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) specifiers.set(`* from ${key}`, `import * as ${clause.namedBindings.name.text} from "${module}"`);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const element of clause.namedBindings.elements) specifiers.set(`${(element.propertyName ?? element.name).text} from ${key}`, `import { ${element.getText(sourceFile)} } from "${module}"`);
        }
    }
    return { identifiers: new Set(identifiers), specifiers };
}

function templateOf(file, sourceFile, metadata) {
    const inline = metadataProperty(metadata, "template");
    if (inline && (ts.isNoSubstitutionTemplateLiteral(inline) || ts.isStringLiteral(inline))) return { file, text: inline.getText(sourceFile).slice(1, -1) };
    const url = metadataProperty(metadata, "templateUrl");
    if (url && ts.isStringLiteral(url)) {
        const templateFile = path.resolve(path.dirname(file), url.text);
        if (!existsSync(templateFile)) throw new Error(`template ${path.basename(templateFile)} is missing`);
        return { file: templateFile, text: readFileSync(templateFile, "utf8") };
    }
    return undefined;
}

function candidateComponent(file, className) {
    const text = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    let classNode;
    sourceFile.forEachChild(function visit(node) {
        if (ts.isClassDeclaration(node) && node.name?.text === className) classNode = node;
        else node.forEachChild(visit);
    });
    if (!classNode) throw new Error(`class ${className} is missing`);
    const template = templateOf(file, sourceFile, componentMetadata(classNode));
    if (!template) return { sourceFile, classNode, elements: [] };
    const parsed = ng.parseTemplate(template.text, template.file, { preserveWhitespaces: true });
    if (parsed.errors?.length) throw new Error(`template does not parse: ${collapse(parsed.errors[0].msg)}`);
    return { sourceFile, classNode, elements: serializeElements(parsed.nodes) };
}

function setDifference(left, right) {
    return [ ...left ].filter(item => !right.has(item));
}

function specifiersFor(specifiers, name) {
    const found = [ ...specifiers ].filter(([ key ]) => key.startsWith(`${name} from `)).map(([ , written ]) => written);
    return found.length ? found.join(", ") : "(no import)";
}

/**
 * Compares a migrated copy of fixture/ with fixture-expected/ through the Angular compiler's template AST and the TypeScript AST:
 * every element (name, bindings, direct text, enclosing blocks) must have an identical counterpart in the same order, and every
 * component must keep the expected decorator `imports` identifiers and import specifiers. Formatting, whitespace, attribute order,
 * quote style and spacing inside expressions do not count. Extra `imports` identifiers are counted in `extraImports` only
 * (Angular warns about unused imports, it does not fail), missing ones make the component wrong.
 */
export function semanticScore(dir, { expectedRoot = EXPECTED_ROOT } = {}) {
    const totals = { elements: 0, elementsWrong: 0, extraImports: 0, filesSemanticallyEqual: 0, files: 0, details: [] };
    const detail = text => { if (totals.details.length < MAX_DETAILS) totals.details.push(text); };
    for (const declaration of loadWorkspace(expectedRoot).declarations) {
        const relative = path.relative(expectedRoot, declaration.file);
        const expectedElements = serializeElements(declaration.template?.nodes ?? []);
        const expectedImports = importsOf(declaration.sourceFile, declaration.classNode, expectedRoot);
        totals.files++;
        totals.elements += expectedElements.length;
        let wrong = 0;
        try {
            const candidateFile = path.join(dir, relative);
            if (!existsSync(candidateFile) || !statSync(candidateFile).isFile()) throw new Error("file is missing");
            const candidate = candidateComponent(candidateFile, declaration.className);
            const aligned = commonLines(expectedElements, candidate.elements);
            const unmatchedExpected = expectedElements.filter((_element, index) => !aligned.inLeft.has(index));
            const unmatchedCandidate = candidate.elements.filter((_element, index) => !aligned.inRight.has(index));
            wrong += Math.max(unmatchedExpected.length, unmatchedCandidate.length);
            for (let index = 0; index < Math.max(unmatchedExpected.length, unmatchedCandidate.length); index++) {
                detail(`${relative}: expected ${unmatchedExpected[index] ?? "(no element)"} / got ${unmatchedCandidate[index] ?? "(no element)"}`);
            }
            const candidateImports = importsOf(candidate.sourceFile, candidate.classNode, dir);
            const missingIdentifiers = setDifference(expectedImports.identifiers, candidateImports.identifiers);
            const missingSpecifiers = setDifference(expectedImports.specifiers.keys(), new Set(candidateImports.specifiers.keys()));
            if (missingIdentifiers.length || missingSpecifiers.length) wrong++;
            if (missingIdentifiers.length) detail(`${relative}: expected ${missingIdentifiers.join(", ")} in @Component imports / got [ ${[ ...candidateImports.identifiers ].join(", ")} ]`);
            for (const key of missingSpecifiers) detail(`${relative}: expected ${expectedImports.specifiers.get(key)} / got ${specifiersFor(candidateImports.specifiers, key.split(" from ")[0])}`);
            totals.extraImports += setDifference(candidateImports.identifiers, expectedImports.identifiers).length;
        } catch (error) {
            wrong += expectedElements.length || 1;
            detail(`${relative}: ${error.message}`);
        }
        totals.elementsWrong += wrong;
        if (wrong === 0) totals.filesSemanticallyEqual++;
    }
    return totals;
}
