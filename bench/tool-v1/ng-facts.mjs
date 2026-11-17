#!/usr/bin/env node
// ng-facts — structural facts and a codemod for an Angular workspace, computed with the Angular compiler (no LLM).
//   ng-facts usages <selector|Class>[.<input>] [--root <dir>]
//   ng-facts rename-input <Class>.<old> <new> [--negate] [--write] [--root <dir>]
//   ng-facts migrate <spec.json> [--write] [--root <dir>]   (an API migration described as data, applied mechanically)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ng from "@angular/compiler";
import ts from "typescript";

const DECORATORS = new Set([ "Component", "Directive" ]);
const INPUT_FACTORIES = new Set([ "input", "model" ]);

function listSources(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : listSources(full);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") && !entry.name.endsWith(".d.ts") ? [ full ] : [];
    });
}

function decoratorCall(node) {
    for (const decorator of ts.getDecorators(node) ?? []) {
        const call = decorator.expression;
        if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && DECORATORS.has(call.expression.text)) return call;
    }
    return undefined;
}

function inputOf(member) {
    if (!ts.isPropertyDeclaration(member) || !member.initializer || !ts.isCallExpression(member.initializer)) return undefined;
    const callee = member.initializer.expression;
    const factory = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : "";
    if (!INPUT_FACTORIES.has(factory)) return undefined;
    const options = member.initializer.arguments.find(argument => ts.isObjectLiteralExpression(argument));
    const alias = options?.properties.find(property => property.name?.getText() === "alias")?.initializer;
    const name = member.name.getText();
    return { name, bindingName: alias && ts.isStringLiteral(alias) ? alias.text : name, member };
}

function templateSource(file, sourceFile, property) {
    const value = property.initializer;
    if (property.name.getText() === "template" && (ts.isNoSubstitutionTemplateLiteral(value) || ts.isStringLiteral(value))) {
        return { file, offset: value.getStart(sourceFile) + 1, text: value.getText(sourceFile).slice(1, -1), inline: true };
    }
    if (property.name.getText() === "templateUrl" && ts.isStringLiteral(value)) {
        const templateFile = path.resolve(path.dirname(file), value.text);
        return { file: templateFile, offset: 0, text: readFileSync(templateFile, "utf8"), inline: false };
    }
    return undefined;
}

/** Every @Component/@Directive with its selector, signal inputs and parsed template. */
export function loadWorkspace(root) {
    const declarations = [];
    for (const file of listSources(path.join(root, "src"))) {
        const text = readFileSync(file, "utf8");
        const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        sourceFile.forEachChild(function visit(node) {
            if (ts.isClassDeclaration(node) && node.name) {
                const call = decoratorCall(node);
                const metadata = call?.arguments[0];
                if (metadata && ts.isObjectLiteralExpression(metadata)) {
                    const selector = metadata.properties.find(property => property.name?.getText() === "selector")?.initializer;
                    const template = metadata.properties.map(property => ts.isPropertyAssignment(property) && templateSource(file, sourceFile, property)).find(Boolean);
                    declarations.push({
                        className: node.name.text,
                        file,
                        sourceFile,
                        classNode: node,
                        selector: selector && ts.isStringLiteral(selector) ? selector.text : undefined,
                        inputs: node.members.map(inputOf).filter(Boolean),
                        template: template ? { ...template, nodes: ng.parseTemplate(template.text, template.file, { preserveWhitespaces: true }).nodes } : undefined
                    });
                }
            }
            node.forEachChild(visit);
        });
    }
    const matcher = new ng.SelectorMatcher();
    for (const declaration of declarations) if (declaration.selector) matcher.addSelectables(ng.CssSelector.parse(declaration.selector), declaration);
    return { root, declarations, matcher };
}

class ElementCollector extends ng.TmplAstRecursiveVisitor {
    elements = [];
    visitElement(element) {
        this.elements.push(element);
        super.visitElement(element);
    }
}

function elementsOf(template) {
    const collector = new ElementCollector();
    ng.tmplAstVisitAll(collector, template.nodes);
    return collector.elements;
}

function matchedDeclarations(workspace, element) {
    const selector = new ng.CssSelector();
    selector.setElement(element.name);
    for (const attribute of element.attributes) selector.addAttribute(attribute.name, attribute.value);
    for (const input of element.inputs) if (input.type === ng.BindingType.Property) selector.addAttribute(input.name, "");
    const matched = [];
    workspace.matcher.match(selector, (_selector, declaration) => matched.push(declaration));
    return matched;
}

function lineOf(text, offset) {
    let line = 1;
    for (let index = 0; index < offset; index++) if (text.charCodeAt(index) === 10) line++;
    return line;
}

export function findDeclaration(workspace, name) {
    const found = workspace.declarations.find(declaration => declaration.className === name || declaration.selector === name);
    if (!found) throw new Error(`no component/directive "${name}" — known: ${workspace.declarations.filter(declaration => declaration.selector && !declaration.selector.startsWith("app-feature")).map(declaration => declaration.selector).join(", ")}`);
    return found;
}

/** Bindings of `<owner>.<input>` in every template, plus same-named bindings on other elements (decoys). */
export function findUsages(workspace, owner, inputName) {
    const uses = [];
    const decoys = [];
    for (const declaration of workspace.declarations) {
        if (!declaration.template) continue;
        for (const element of elementsOf(declaration.template)) {
            const isOwner = matchedDeclarations(workspace, element).includes(owner);
            if (!isOwner && !inputName) continue;
            if (!inputName) {
                uses.push({ declaration, template: declaration.template, element });
                continue;
            }
            for (const binding of [ ...element.inputs, ...element.attributes ]) {
                if (binding.name === inputName) (isOwner ? uses : decoys).push({ declaration, template: declaration.template, element, binding });
            }
        }
    }
    return { uses, decoys };
}

function absolute(template, offset) {
    return template.offset + offset;
}

function describe(workspace, entry) {
    const { template, element, binding } = entry;
    const fileText = template.inline ? readFileSync(template.file, "utf8") : template.text;
    const offset = absolute(template, (binding?.keySpan ?? element.startSourceSpan).start.offset);
    const value = binding ? (binding.value?.source ?? binding.value ?? "") : "";
    return `${path.relative(workspace.root, template.file)}:${lineOf(fileText, offset)}  <${element.name}>${binding ? `  ${binding instanceof ng.TmplAstTextAttribute ? binding.name : `[${binding.name}]`}="${String(value).trim()}"` : ""}`;
}

function negateExpression(ast, templateText) {
    const sourceOf = node => templateText.slice(node.sourceSpan.start, node.sourceSpan.end);
    if (ast instanceof ng.PrefixNot) return sourceOf(ast.expression instanceof ng.ParenthesizedExpression ? ast.expression.expression : ast.expression);
    if (ast instanceof ng.LiteralPrimitive && typeof ast.value === "boolean") return String(!ast.value);
    const simple = ast instanceof ng.PropertyRead || ast instanceof ng.SafePropertyRead || ast instanceof ng.Call || ast instanceof ng.KeyedRead || ast instanceof ng.ParenthesizedExpression;
    return simple ? `!${sourceOf(ast)}` : `!(${sourceOf(ast)})`;
}

function walkExpression(ast, visit, parent = undefined) {
    if (!(ast instanceof ng.AST)) return;
    visit(ast, parent);
    for (const value of Object.values(ast)) {
        if (value instanceof ng.AST) walkExpression(value, visit, ast);
        else if (Array.isArray(value)) for (const item of value) walkExpression(item, visit, ast);
    }
}

class ExpressionCollector extends ng.TmplAstRecursiveVisitor {
    expressions = [];
    visitBoundAttribute(attribute) { this.expressions.push(attribute.value); }
    visitBoundText(text) { this.expressions.push(text.value); }
    visitBoundEvent(event) { this.expressions.push(event.handler); }
    visitIfBlockBranch(branch) { if (branch.expression) this.expressions.push(branch.expression); super.visitIfBlockBranch(branch); }
    visitForLoopBlock(block) { this.expressions.push(block.expression); super.visitForLoopBlock(block); }
    visitSwitchBlock(block) { this.expressions.push(block.expression); super.visitSwitchBlock(block); }
}

/** Codemod: rename an input of `owner` everywhere it is bound, optionally negating the meaning. Returns edits; `write` applies them. */
export function renameInput(workspace, owner, oldName, newName, { negate = false, write = false } = {}) {
    const input = owner.inputs.find(candidate => candidate.name === oldName);
    if (!input) throw new Error(`${owner.className} has no signal input "${oldName}" — inputs: ${owner.inputs.map(candidate => candidate.name).join(", ")}`);
    const edits = [];
    const decisions = [];
    const sourceFile = owner.sourceFile;
    const edit = (file, start, end, text) => edits.push({ file, start, end, text });

    edit(owner.file, input.member.name.getStart(sourceFile), input.member.name.getEnd(), newName);
    const [ firstArgument ] = input.member.initializer.arguments;
    if (negate && firstArgument && (firstArgument.kind === ts.SyntaxKind.TrueKeyword || firstArgument.kind === ts.SyntaxKind.FalseKeyword)) {
        edit(owner.file, firstArgument.getStart(sourceFile), firstArgument.getEnd(), firstArgument.kind === ts.SyntaxKind.TrueKeyword ? "false" : "true");
    }
    owner.classNode.forEachChild(function visit(node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword && node.expression.name.text === oldName) {
            const read = `this.${newName}()`;
            const parent = node.parent;
            if (negate && ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken) edit(owner.file, parent.getStart(sourceFile), parent.getEnd(), read);
            else edit(owner.file, node.getStart(sourceFile), node.getEnd(), negate ? `!${read}` : read);
        }
        node.forEachChild(visit);
    });

    if (owner.template) {
        const collector = new ExpressionCollector();
        ng.tmplAstVisitAll(collector, owner.template.nodes);
        for (const expression of collector.expressions) {
            walkExpression(expression, (node, parent) => {
                if (!(node instanceof ng.Call) || !(node.receiver instanceof ng.PropertyRead) || node.receiver.name !== oldName || !(node.receiver.receiver instanceof ng.ImplicitReceiver)) return;
                const read = `${newName}()`;
                const target = negate && parent instanceof ng.PrefixNot ? parent : node;
                edit(owner.template.file, absolute(owner.template, target.sourceSpan.start), absolute(owner.template, target.sourceSpan.end), negate && target === node ? `!${read}` : read);
            });
        }
    }

    const { uses } = findUsages(workspace, owner, input.bindingName);
    for (const { template, binding } of uses) {
        if (binding instanceof ng.TmplAstTextAttribute) {
            decisions.push(binding);
            continue;
        }
        edit(template.file, absolute(template, binding.keySpan.start.offset), absolute(template, binding.keySpan.end.offset), newName);
        if (negate) edit(template.file, absolute(template, binding.valueSpan.start.offset), absolute(template, binding.valueSpan.end.offset), negateExpression(binding.value.ast, template.text));
    }

    if (write) {
        const byFile = Map.groupBy(edits, entry => entry.file);
        for (const [ file, fileEdits ] of byFile) {
            let text = readFileSync(file, "utf8");
            for (const entry of fileEdits.sort((left, right) => right.start - left.start)) text = text.slice(0, entry.start) + entry.text + text.slice(entry.end);
            writeFileSync(file, text);
        }
    }
    return { edits, files: new Set(edits.map(entry => entry.file)), uses: uses.length, decisions };
}

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
}`;

function literalLeaves(ast) {
    if (ast instanceof ng.LiteralPrimitive && typeof ast.value === "string") return [ ast ];
    if (ast instanceof ng.ParenthesizedExpression) return literalLeaves(ast.expression);
    if (ast instanceof ng.Conditional) {
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
    const sourceFile = declaration.sourceFile;
    const metadata = decoratorCall(declaration.classNode)?.arguments[0];
    const importsProperty = metadata?.properties.find(property => property.name?.getText() === "imports");
    const edits = [];
    if (!importsProperty || !ts.isArrayLiteralExpression(importsProperty.initializer)) return { edits, decision: `${declaration.className}: no imports array to add ${importName} to` };
    const elements = importsProperty.initializer.elements;
    if (elements.some(element => element.getText(sourceFile) === importName)) return { edits };
    const last = elements.at(-1);
    edits.push(last
        ? { file: declaration.file, start: last.getEnd(), end: last.getEnd(), text: `, ${importName}` }
        : { file: declaration.file, start: importsProperty.initializer.getStart(sourceFile) + 1, end: importsProperty.initializer.getStart(sourceFile) + 1, text: ` ${importName} ` });
    const alreadyImported = sourceFile.statements.some(statement => ts.isImportDeclaration(statement) && statement.importClause?.namedBindings?.elements?.some(element => element.name.text === importName));
    if (!alreadyImported) {
        let specifier = path.relative(path.dirname(declaration.file), path.join(root, fromRoot)).split(path.sep).join("/");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        const lastImport = sourceFile.statements.filter(statement => ts.isImportDeclaration(statement)).at(-1);
        const at = lastImport ? lastImport.getEnd() : 0;
        edits.push({ file: declaration.file, start: at, end: at, text: `${lastImport ? "\n" : ""}import { ${importName} } from "${specifier}";${lastImport ? "" : "\n"}` });
    }
    return { edits };
}

/** Applies an API migration described as data to every element of `spec.component`, using the compiler's template AST. */
export function migrate(workspace, spec, { write = false } = {}) {
    const owner = findDeclaration(workspace, spec.component);
    const edits = [];
    const decisions = [];
    const needsImport = new Map();
    let elements = 0;
    const fileTexts = new Map();
    const fileText = file => {
        if (!fileTexts.has(file)) fileTexts.set(file, readFileSync(file, "utf8"));
        return fileTexts.get(file);
    };

    for (const declaration of workspace.declarations) {
        const template = declaration.template;
        if (!template) continue;
        const text = fileText(template.file);
        const at = offset => absolute(template, offset);
        const where = node => `${path.relative(workspace.root, template.file)}:${lineOf(text, at(node.sourceSpan.start.offset))}`;
        for (const element of elementsOf(template)) {
            if (!matchedDeclarations(workspace, element).includes(owner)) continue;
            elements++;
            let content;
            for (const [ name, rule ] of Object.entries(spec.inputs)) {
                const attribute = element.attributes.find(candidate => candidate.name === name);
                const bound = element.inputs.find(candidate => candidate.name === name && candidate.type === ng.BindingType.Property);
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
                        for (const templateOwner of workspace.index?.ownersOf?.(template) ?? workspace.declarations.filter(candidate => candidate.template === template)) needsImport.set(templateOwner, rule.otherwise);
                    } else {
                        decisions.push(`${where(bound)} [${name}]="${bound.value.source.trim()}" is not a literal and has no fallback`);
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
                } else if (element.children.every(child => child instanceof ng.TmplAstText && !child.value.trim())) {
                    edits.push({ file: template.file, start: startEnd, end: at(element.endSourceSpan.start.offset), text: content });
                } else {
                    decisions.push(`${where(element.startSourceSpan ? { sourceSpan: element.startSourceSpan } : element)} <${element.name}> already has content; cannot move the value in`);
                }
            }
        }
    }

    for (const [ declaration, target ] of needsImport) {
        const result = importEdits(declaration, target.import, target.from, workspace.root);
        edits.push(...result.edits);
        if (result.decision) decisions.push(result.decision);
    }

    const sorted = [ ...edits ].sort((left, right) => left.file.localeCompare(right.file) || left.start - right.start);
    for (let index = 1; index < sorted.length; index++) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (previous.file === current.file && current.start < previous.end) throw new Error(`overlapping edits in ${path.relative(workspace.root, current.file)} at ${current.start}`);
    }
    if (write) {
        for (const [ file, fileEdits ] of Map.groupBy(edits, entry => entry.file)) {
            let text = readFileSync(file, "utf8");
            for (const entry of fileEdits.sort((left, right) => right.start - left.start || right.end - left.end)) text = text.slice(0, entry.start) + entry.text + text.slice(entry.end);
            writeFileSync(file, text);
        }
    }
    return { elements, edits, files: new Set(edits.map(entry => entry.file)), imports: needsImport.size, decisions };
}

function parseArgs(argv) {
    const flags = { root: "fixture", negate: false, write: false, all: false };
    const positional = [];
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === "--root") flags.root = argv[++index];
        else if (argv[index] === "--negate") flags.negate = true;
        else if (argv[index] === "--write") flags.write = true;
        else if (argv[index] === "--all") flags.all = true;
        else positional.push(argv[index]);
    }
    return { flags, positional };
}

function main() {
    const [ command, ...rest ] = process.argv.slice(2);
    const { flags, positional } = parseArgs(rest);
    if (command === "migrate" && (!positional[0] || positional[0] === "--help")) {
        console.log(MIGRATION_SPEC_HELP);
        return;
    }
    const started = performance.now();
    const workspace = loadWorkspace(path.resolve(flags.root));
    const elapsed = () => `${Math.round(performance.now() - started)} ms`;

    if (command === "usages") {
        const [ target, inputName ] = positional[0].split(".");
        const owner = findDeclaration(workspace, target);
        const { uses, decoys } = findUsages(workspace, owner, inputName);
        const files = new Set(uses.map(entry => entry.template.file));
        console.log(`${owner.className} <${owner.selector}>${inputName ? `.${inputName}` : ""}: ${uses.length} uses in ${files.size} files (${elapsed()}, ${workspace.declarations.length} declarations)`);
        const shown = flags.all ? uses : uses.slice(0, 8);
        for (const entry of shown) console.log(`  ${describe(workspace, entry)}`);
        if (uses.length > shown.length) console.log(`  … +${uses.length - shown.length} more (--all lists every use)`);
        if (inputName) {
            const values = Map.groupBy(uses, entry => String(entry.binding.value?.source ?? entry.binding.value).trim());
            console.log(`Values: ${[ ...values ].map(([ value, list ]) => `${value} ×${list.length}`).join(", ")}`);
            console.log(`Same name elsewhere (NOT this input — do not touch): ${decoys.length} bindings on ${[ ...new Set(decoys.map(entry => `<${entry.element.name}>`)) ].join(", ") || "—"}`);
            console.log(`→ rename everywhere: ng-facts rename-input ${owner.className}.${inputName} <newName> [--negate] --write`);
        }
        return;
    }

    if (command === "rename-input") {
        const [ target, oldName ] = positional[0].split(".");
        const owner = findDeclaration(workspace, target);
        const result = renameInput(workspace, owner, oldName, positional[1], flags);
        console.log(`rename-input ${owner.className}.${oldName} → ${positional[1]}${flags.negate ? " (negated)" : ""}: ${result.edits.length} edits in ${result.files.size} files, ${result.uses} bindings, ${result.decisions.length} need a decision — ${flags.write ? "written" : "dry run, add --write"} (${elapsed()})`);
        return;
    }

    if (command === "migrate") {
        const spec = JSON.parse(readFileSync(path.resolve(positional[0]), "utf8"));
        const result = migrate(workspace, spec, flags);
        console.log(`migrate ${spec.component}: ${result.elements} elements, ${result.edits.length} edits in ${result.files.size} files, ${result.imports} components get a new import, ${result.decisions.length} need a decision — ${flags.write ? "written" : "dry run, add --write"} (${elapsed()})`);
        for (const decision of result.decisions.slice(0, 20)) console.log(`  needs a decision: ${decision}`);
        return;
    }

    console.log("usage: ng-facts usages <selector|Class>[.<input>] [--all] | rename-input <Class>.<old> <new> [--negate] [--write] | migrate <spec.json> [--write] | migrate --help   [--root <dir>]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
