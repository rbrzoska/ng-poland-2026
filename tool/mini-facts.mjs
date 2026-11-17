// The whole idea in 25 lines of code: ask the Angular compiler's parser where an input of a component is used.
//   node tool/mini-facts.mjs app-pill disableTooltip fixture/src
// Reads external .html templates only and matches the tag by name. ng-facts.mjs is the grown-up version: inline templates,
// real selector matching, a summary of the values, and edits from a recipe.
import { readdirSync, readFileSync } from "node:fs";
import {
    parseTemplate, TmplAstRecursiveVisitor, tmplAstVisitAll
} from "@angular/compiler";

const [ tag, input, root = "src" ] = process.argv.slice(2);
let file, uses = 0;

class Finder extends TmplAstRecursiveVisitor {
    visitElement(element) {
        const bindings = [ ...element.inputs, ...element.attributes ];
        for (const binding of bindings) {
            if (element.name !== tag || binding.name !== input) continue;
            const line = binding.sourceSpan.start.line + 1;
            console.log(`${file}:${line}  ${binding.sourceSpan}`);
            uses++;
        }
        super.visitElement(element);
    }
}

for (const name of readdirSync(root, { recursive: true })) {
    if (!name.endsWith(".html")) continue;
    file = `${root}/${name}`;
    const { nodes } = parseTemplate(readFileSync(file, "utf8"), file);
    tmplAstVisitAll(new Finder(), nodes);
}
console.log(`${uses} uses of ${input} on <${tag}> in .html templates`);
