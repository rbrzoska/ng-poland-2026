// The task given to both agents; the tool lane gets TOOL_HINT appended. Shared by the UI and bench/agent.mjs.
export const TASK = "This is an Angular workspace. The component library was upgraded: `PillComponent` (src/app/lib/pill.component.ts) is now v2 and `src/app/lib/pill-tone.pipe.ts` was added, but the feature components still use the v1 API, so `npx ngc -p tsconfig.json` fails. "
    + "Migrate every usage of `<app-pill>` to v2: (1) `disableTooltip` → `tooltip` with the OPPOSITE meaning, negated minimally (`true`→`false`, `!x`→`x`, `x`→`!x`, `a > b`→`!(a > b)`); "
    + "(2) `variant` → `tone` with values info→neutral, success→positive, warning→caution, also inside `?:` expressions; where the value is not a literal, use the `pillTone` pipe (`[tone]=\"x | pillTone\"`) and add `PillTonePipe` to that component's `imports` (and its import statement); "
    + "(3) the `label` input was removed: move its value into the element content (`label=\"X\"` → `<app-pill …>X</app-pill>`, `[label]=\"e\"` → `{{ e }}`). "
    + "Do not change the library files or anything else: other components may have inputs with the same names. When done, `npx ngc -p tsconfig.json` must report no errors. Reply with one line when finished.";
export const TOOL_HINT = " A deterministic migration tool built on the Angular compiler is available — describe the API change as a small JSON spec and let the tool apply every edit; do not edit templates by hand: "
    + "`node ../tools/ng-facts.mjs migrate --help` prints the spec format; `node ../tools/ng-facts.mjs migrate <spec.json> --root .` is a dry run, add `--write` to apply; `node ../tools/ng-facts.mjs usages PillComponent --root .` lists every use.";

/** Second version of the tool: the spec goes inline (no file to write), the format is in the hint (no --help call), and --write verifies with the compiler itself. */
export const TOOL_V2_HINT = " A deterministic migration tool built on the Angular compiler is available — describe the API change as one JSON spec and the tool applies every edit, then checks the result with the compiler; do not edit templates by hand and do not write the spec to a file. "
    + "Run `node ../tools/ng-facts.mjs migrate '<spec>' --root . --write` with the spec inline in single quotes. Spec format: "
    + "`{\"component\":\"<Class>\",\"inputs\":{\"<old input>\":{\"rename\":\"<new>\",\"negate\":true},\"<old input>\":{\"rename\":\"<new>\",\"values\":{\"<old value>\":\"<new value>\"},\"otherwise\":{\"pipe\":\"<pipe name>\",\"import\":\"<PipeClass>\",\"from\":\"<path of the pipe file from the workspace root, without .ts>\"}},\"<old input>\":{\"toContent\":true}}}` — "
    + "`negate` flips a boolean binding minimally, `values` maps string literals (also inside `?:`), `otherwise` wraps values known only at runtime in the pipe and adds its import, `toContent` moves the value into the element content. "
    + "The tool prints what it changed, anything it could not decide, and the compiler's verdict (`ngc: 0 errors`), so there is no need to run ngc yourself.";

/** No tool is provided: the agent is only told the compiler is installed and asked to build its own codemod on it. */
export const OWN_CODEMOD_HINT = " The Angular compiler is installed in node_modules: `@angular/compiler` exports `parseTemplate`, which gives the exact source span of every element, attribute and binding. "
    + "Do not edit templates by hand or with regular expressions: write your own migration script on top of the compiler and run it.";

/** Same migration, but the mapping is not given: the agent has to work it out from the v1 source kept next to v2. */
export const DISCOVER_TASK = "This is an Angular workspace. The component library was upgraded: `PillComponent` (src/app/lib/pill.component.ts) is now v2 and `src/app/lib/pill-tone.pipe.ts` was added; the previous source is kept for reference in `src/app/lib/pill.component.v1.ts.txt`. "
    + "The feature components still use the v1 API, so `npx ngc -p tsconfig.json` fails. Work out what changed between v1 and v2 and migrate every usage of `<app-pill>` so that every pill looks and behaves exactly as before. "
    + "Conventions: negate boolean expressions minimally (`true`→`false`, `!x`→`x`, `x`→`!x`, `a > b`→`!(a > b)`); where a value is a string literal (also inside `?:`) write the new literal, and use the pipe only for values known at runtime. "
    + "Do not change the library files or anything else: other components may have inputs with the same names. When done, `npx ngc -p tsconfig.json` must report no errors. Reply with one line when finished.";

export const PILL_V1_REFERENCE = `import { ChangeDetectionStrategy, Component, input } from "@angular/core";

export type PillVariant = "info" | "success" | "warning";

/** PillComponent v1 — reference only, not compiled. */
@Component({
    selector: "app-pill",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<span class="pill" [class]="variant()">{{ label() }}@if (!disableTooltip()) {<span class="hint">i</span>}</span>\`
})
export class PillComponent {
    readonly label = input("");
    readonly variant = input<PillVariant>("info");
    readonly disableTooltip = input(false);
}
`;

export const FACT_KEYS = [ "pillElements", "pillElementsInInlineTemplates", "disableTooltipBindingsElsewhere", "pillsWithLiteralWarning", "pillsWithNonLiteralVariant", "pillsWithoutVariant" ];

/** Impact analysis before the migration: questions only, no edits, so there is no compiler error to iterate against. */
export const FACTS_TASK = "This is an Angular workspace (standalone components; templates are external .html files or inline `template:` strings in .ts files). Before migrating `PillComponent` (`<app-pill>`, src/app/lib/pill.component.ts — a different component from `<app-pill-legacy>`) we need to know how it is used. Do not modify any source file. Answer for the whole workspace: "
    + "(1) `pillElements`: how many `<app-pill>` elements are there in all component templates; "
    + "(2) `pillElementsInInlineTemplates`: how many of those are in inline templates; "
    + "(3) `disableTooltipBindingsElsewhere`: how many template elements that are NOT `<app-pill>` set an attribute or input named `disableTooltip`; "
    + "(4) `pillsWithLiteralWarning`: how many `<app-pill>` elements can receive the literal value `warning` for `variant` — as a static attribute or as a string literal anywhere inside the bound expression; "
    + "(5) `pillsWithNonLiteralVariant`: how many `<app-pill>` elements bind `variant` to an expression that contains no string literal (the value is known only at runtime); "
    + "(6) `pillsWithoutVariant`: how many `<app-pill>` elements do not set `variant` at all. "
    + "Write the answers to `answers.json` in the workspace root as one JSON object with exactly these six integer keys, then reply with one line.";
export const FACTS_TOOL_HINT = " A fact tool built on the Angular compiler is available — prefer it to text search: `node ../tools/ng-facts.mjs usages <selector|Class>[.<input>] --root . [--all]` lists every element the compiler matches to that component; with an input name it lists every binding with its value, a summary of the values, and the same-named bindings on other elements. `--all` prints every use instead of the first eight.";

export const HYBRID_KEYS = [ "deadComponents", "leafComponents", "standardBearerElements", "unusedFilters", "twinComponents", "unusedServices" ];

/** Migration planning on hybrid/ (an AngularJS + Angular app, scripts/generate-hybrid.mjs): questions only, no edits. The definitions are the ones the answer key is built from. */
export const HYBRID_TASK = "This is a hybrid AngularJS + Angular app (ngUpgrade). The AngularJS code lives under src/app/ajs: .js and .ts files that register things on `angular.module(...)`; AngularJS templates are the .html files under src/app/ajs and inline `template:` strings in those files. The Angular code is everything else under src/app. "
    + "Nothing is built dynamically: there is no `$compile` of generated markup and no string-built names, every use is written literally. Spec files (*.spec.ts, *.spec.js) are tests: they never count as a use or as a definition. Commented-out markup and names in comments, CSS classes or ids are not uses either. A use counts wherever it is written, also inside a component that is itself dead or a service that nothing injects. Do not modify any source file. "
    + "We are planning the migration of the AngularJS code to Angular and need six facts about the whole app: "
    + "(1) `deadComponents` (array): AngularJS components (registered with `.component(\"name\", ...)`) that nothing renders. A component is rendered if (a) its element (`<kebab-name>`) appears in any AngularJS template, (b) a ui-router state names it (`component: \"name\"`), or (c) an Angular UpgradeComponent wrapper for it exists AND that wrapper's selector is used in some Angular template. "
    + "(2) `leafComponents` (array): AngularJS components whose own template contains no element or attribute that is another AngularJS component or an AngularJS directive registered in this app. A partial pulled in with `ng-include` is part of the template. Downgraded Angular components (registered with `downgradeComponent`) and built-in `ng-*` / `ui-*` directives do not count, so a component that only renders those is still a leaf. "
    + "(3) `standardBearerElements` (integer): how many elements in AngularJS templates render the AngularJS component `standardBearer`. "
    + "(4) `unusedFilters` (array): AngularJS filters (registered with `.filter(\"name\", ...)`) that are never applied: not in any AngularJS template expression (`... | name`), not through `$filter(\"name\")`, and not injected as `nameFilter`. "
    + "(5) `twinComponents` (array): AngularJS components that already have an Angular replacement: an Angular `@Component` (an UpgradeComponent wrapper directive is not a replacement) whose selector is exactly the component's kebab-case name, with no prefix (`app-<kebab-name>` is a different selector). "
    + "(6) `unusedServices` (array): AngularJS services and factories defined in AngularJS code (`.service(` / `.factory(`; registrations made with `downgradeInjectable` are Angular services and do not count) that nothing injects: not in any `$inject` array or inline array annotation, not through `$injector.get(\"name\")` - neither on the AngularJS side nor in an Angular provider that upgrades it (`useFactory: i => i.get(\"name\")`, `deps: [ \"$injector\" ]`). "
    + "Write the answers to `answers.json` in the workspace root as one JSON object with exactly these six keys. Every array holds the camelCase names exactly as they are written in the registration call, in any order; `standardBearerElements` is a number. Then reply with one line.";
export const HYBRID_TOOL_HINT = " A fact tool built on the TypeScript and Angular parsers is available at `node ../tools/ajs-facts.mjs` - prefer it to text search. "
    + "`node ../tools/ajs-facts.mjs summary --root .` prints how many components, directives, filters, services, downgrades, wrappers and states are registered and how many of each are unused; "
    + "`node ../tools/ajs-facts.mjs list <components|directives|filters|services|downgrades|wrappers|states> --root . [--unused] [--json]` prints one line per registered thing with the facts that matter: its number of uses and, for a component, what its template renders and its Angular twin. "
    + "`node ../tools/ajs-facts.mjs show <name> --root .` prints the fact card of one registered thing, and `node ../tools/ajs-facts.mjs usages <name> --root .` every use with file, line and the element or expression text.";

/** One refactoring on rename/ (scripts/generate-rename.mjs): rename an input of a shared component. Every arm of bench/rename.mjs gets this text; a tool arm gets one of the two hints appended. */
export const RENAME_TASK = "This is an Angular workspace (standalone components; templates are external .html files or inline `template:` strings in .ts files). "
    + "Rename one input of a shared component everywhere: the input `disableTooltip` of `PillComponent` (`<app-pill>`, src/app/lib/pill.component.ts) gets the new name `hideHint`. Its meaning stays the same. "
    + "\"Everywhere\" covers: (1) the declaration; (2) every template binding of this input, in external .html files and in inline templates, in the bound form (`[disableTooltip]=\"...\"`) and in the plain attribute form (`disableTooltip` with no value), on every component that has this input, including components that extend `PillComponent`; (3) every expression that reads this input, in TypeScript code and in templates; (4) every place that names this input in a string or in a style sheet: `setInput(\"disableTooltip\", ...)` on such a component created in code, and CSS selectors such as `app-pill[disableTooltip]`. "
    + "Do not change anything else: other components have their own input with the same name, some classes have a field with the same name, and the word also appears in comments and text. All of those must stay as they are. "
    + "The app compiles now and must compile after the rename. When done, `npx ngc -p tsconfig.json` must report no errors. Reply with one line when finished.";
export const RENAME_NG_FACTS_HINT = " A tool built on the Angular compiler's parser is available at `node ../tools/ng-facts.mjs`. "
    + "`node ../tools/ng-facts.mjs usages <Class>.<input> --root . [--all]` lists the template bindings of an input with file and line, counted, the first eight unless `--all`; "
    + "`node ../tools/ng-facts.mjs rename-input <Class>.<old> <new> --root . [--write]` plans the rename and prints how many edits in how many files, and applies them with `--write`; "
    + "`node ../tools/ng-facts.mjs check --root .` runs the compiler and prints its errors in a few lines. "
    + "Check the result with the compiler.";
export const RENAME_LS_FACTS_HINT = " A tool built on the Angular Language Service (type-checked) is available at `node ../tools/ls-facts.mjs`. "
    + "`node ../tools/ls-facts.mjs refs <Class>.<member> --root . [--all]` lists the references of a class member with file and line, grouped and counted, the first eight per group unless `--all`; "
    + "`node ../tools/ls-facts.mjs rename <Class>.<member> <new> --root . [--write]` plans the rename and prints how many edits in how many files, and applies them with `--write`; "
    + "`node ../tools/ls-facts.mjs check --root .` runs the compiler and prints its errors, counted by message. "
    + "Check the result with the compiler.";
