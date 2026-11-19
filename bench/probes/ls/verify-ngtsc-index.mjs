#!/usr/bin/env node
// verify-ngtsc-index.mjs: VERIFIER probe (not part of the two spikes). The source-reading report named a third route that
// nobody ran: no language service at all, just @angular/compiler-cli's NgtscProgram and its whole-program template index
// (program.getIndexedComponents()). This script runs it and answers "who binds input X, grouped by the consuming class"
// WITHOUT a cursor position, so the result can be compared with ng-facts and with the language service.
// Read-only: nothing is written anywhere.
//
// Run:  node bench/probes/ls/verify-ngtsc-index.mjs <root with tsconfig.json> [inputName=disableTooltip]
import { createRequire } from "node:module";
import path from "node:path";
import { NgtscProgram, readConfiguration, createCompilerHost } from "@angular/compiler-cli";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const t0 = performance.now();
const root = path.resolve(process.argv[2]);
const inputName = process.argv[3] ?? "disableTooltip";
const config = readConfiguration(path.join(root, "tsconfig.json"));
const host = createCompilerHost({ options: config.options });
const program = new NgtscProgram(config.rootNames, config.options, host);
const tProgram = performance.now();
const indexed = program.getIndexedComponents();
const tIndex = performance.now();

const KIND = { Element: 2, Template: 3, Attribute: 4, Input: 10, Output: 11 };
const className = node => node?.name?.text ?? "?";
const bound = new Map();      // "<consumer class>" -> count of [inputName] bindings the index links to that class
const unlinked = { count: 0 };
const elementsWith = new Map(); // tag -> { withStaticAttr, directives }
let components = 0, external = 0, errors = 0;
for (const [ , component ] of indexed) {
    components++;
    if (component.template.fileUrl !== component.fileUrl) external++;
    errors += component.errors.length;
    for (const id of component.template.identifiers) {
        if (id.kind === KIND.Input && id.name === inputName) {
            if (id.target) bound.set(className(id.target.node), (bound.get(className(id.target.node)) ?? 0) + 1);
            else unlinked.count++;
        }
        if (id.kind === KIND.Element || id.kind === KIND.Template) {
            const hasStatic = [ ...id.attributes ].some(a => a.name === inputName);
            if (!hasStatic) continue;
            const key = `<${id.name}> → ${[ ...id.usedDirectives ].map(d => className(d.node)).join(", ") || "no directive"}`;
            elementsWith.set(key, (elementsWith.get(key) ?? 0) + 1);
        }
    }
}
// --dump <ComponentClass>: list every identifier the index holds for that component's template, and the first index error
if (process.argv.includes("--dump")) {
    const want = process.argv[process.argv.indexOf("--dump") + 1];
    const KINDS = [ "Property", "Method", "Element", "Template", "Attribute", "Reference", "Variable", "LetDeclaration", "Component", "Directive", "Input", "Output", "Pipe" ];
    let shown = 0;
    for (const [ , component ] of indexed) {
        if (component.errors.length && shown++ < 1) console.log(`first index error (in ${component.name}): ${String(component.errors[0].message ?? component.errors[0]).slice(0, 300)}`);
        if (component.name !== want) continue;
        for (const id of component.template.identifiers) console.log(`  ${component.name}: ${KINDS[id.kind]} ${id.name} @${id.span.start}${id.target ? ` target=${className(id.target.node) !== "?" ? className(id.target.node) : KINDS[id.target.kind] ?? "?"}` : ""}${id.usedDirectives ? ` directives=[${[ ...id.usedDirectives ].map(d => className(d.node))}] attributes=[${[ ...id.attributes ].map(a => a.name)}]` : ""}`);
    }
}
const diagnostics = program.getNgSemanticDiagnostics();
const tDiag = performance.now();
console.log(`NgtscProgram on ${root}: ${config.rootNames.length} root files; ${components} indexed components (${external} with an external template), ${errors} index errors`);
console.log(`[${inputName}] bindings linked to a consuming class: ${[ ...bound ].map(([ name, n ]) => `${name} ×${n}`).join(", ") || "none"}; not linked to any directive: ${unlinked.count}`);
console.log(`static attributes named ${inputName} (no brackets), by element and matched directives: ${[ ...elementsWith ].map(([ key, n ]) => `${key} ×${n}`).join("; ") || "none"}`);
console.log(`Angular + TypeScript semantic diagnostics of the whole program: ${diagnostics.length}`);
console.log(`time: create program ${Math.round(tProgram - t0)} ms, analysis + index ${Math.round(tIndex - tProgram)} ms, all diagnostics ${Math.round(tDiag - tIndex)} ms; total ${Math.round(tDiag - t0)} ms (${Math.round(process.uptime() * 1000)} ms since process start); peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
