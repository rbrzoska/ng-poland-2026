// Writes a tiny Angular workspace OUTSIDE the repository for the language-service probes, with the cases fixture/ does not
// have: an input inherited from a base class, decorator @Input() next to signal input(), an aliased input, a plain static
// attribute, a same-named input on another component (decoy) and an attribute directive. Also writes points.json, the
// list of positions that tsserver-probe.mjs and ngserver-probe.mjs take with --points.
//
// Run from the repository root:
//   node bench/probes/ls/make-scratch-workspace.mjs [<dir>]        # default <os tmp>/ng-ls-scratch
//   node bench/probes/ls/ngserver-probe.mjs --server <dir with @angular/language-server> --root <dir> --points <dir>/points.json
//   node bench/probes/ls/tsserver-probe.mjs --root <dir> --points <dir>/points.json
// The workspace gets a node_modules junction to this repository's node_modules (no install, nothing copied).
// When done, remove that junction with a plain `rmdir <dir>\node_modules` (NOT a recursive delete, which would follow it
// into the repository's node_modules); running this script again puts it back.
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = resolve(process.argv[2] ?? join(tmpdir(), "ng-ls-scratch"));
if (existsSync(join(dir, "src"))) rmSync(join(dir, "src"), { recursive: true });
const write = (file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text.replace(/^\n/, "")); };
if (!existsSync(join(dir, "node_modules"))) { mkdirSync(dir, { recursive: true }); symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"), "junction"); }

write("tsconfig.json", JSON.stringify({
    compilerOptions: { rootDir: "./src", noEmit: true, strict: true, target: "ES2022", module: "ES2022", moduleResolution: "bundler", experimentalDecorators: true, skipLibCheck: true, lib: [ "ES2022", "dom" ] },
    angularCompilerOptions: { strictTemplates: true, strictInjectionParameters: true },
    include: [ "src/**/*.ts" ]
}, null, 2));

write("src/app/lib/base-badge.ts", `
import { Directive, Input, input } from "@angular/core";

@Directive()
export abstract class BaseBadge {
    /** Decorator input declared on the base class. */
    @Input() label = "";
    /** Signal input declared on the base class. */
    readonly size = input<"s" | "m">("m");
}
`);
write("src/app/lib/badge.component.ts", `
import { Component, Input } from "@angular/core";
import { BaseBadge } from "./base-badge";

@Component({ selector: "app-badge", template: \`<b [class.off]="disabled">{{ label }} {{ size() }} {{ variant }}</b>\` })
export class BadgeComponent extends BaseBadge {
    /** Public name is "kind", the field is "variant". */
    @Input({ alias: "kind" }) variant: "info" | "warn" = "info";
    @Input() disabled = false;
}
`);
write("src/app/lib/chip.component.ts", `
import { Component, Input } from "@angular/core";

/** Decoy: an unrelated component with an input of the same name. */
@Component({ selector: "app-chip", template: \`<i>{{ label }}</i>\` })
export class ChipComponent {
    @Input() label = "";
}
`);
write("src/app/lib/tip.directive.ts", `
import { Directive, Input } from "@angular/core";

@Directive({ selector: "[appTip]" })
export class TipDirective {
    @Input() appTip = "";
}
`);
write("src/app/home.component.ts", `
import { Component } from "@angular/core";
import { BadgeComponent } from "./lib/badge.component";
import { ChipComponent } from "./lib/chip.component";
import { TipDirective } from "./lib/tip.directive";

@Component({
    selector: "app-home",
    imports: [ BadgeComponent, ChipComponent, TipDirective ],
    template: \`
        <app-badge label="Static" [size]="'s'" kind="warn" />
        <app-badge [label]="title" [disabled]="off" appTip="hello" />
        <app-chip label="Decoy" />
    \`
})
export class HomeComponent {
    title = "Home";
    off = false;
}
`);
write("src/app/list.component.ts", `
import { Component } from "@angular/core";
import { BadgeComponent } from "./lib/badge.component";
import { ChipComponent } from "./lib/chip.component";

@Component({ selector: "app-list", imports: [ BadgeComponent, ChipComponent ], templateUrl: "./list.component.html" })
export class ListComponent {
    title = "List";
}
`);
write("src/app/list.component.html", `
<app-badge [label]="title" [kind]="'info'" [size]="'m'" />
<app-chip [label]="title" />
`);
write("src/main.ts", `
import { bootstrapApplication } from "@angular/platform-browser";
import { HomeComponent } from "./app/home.component";
import { ListComponent } from "./app/list.component";

export const pages = [ HomeComponent, ListComponent ];
bootstrapApplication(HomeComponent).catch(error => console.error(error));
`);

const base = "src/app/lib/base-badge.ts";
const badge = "src/app/lib/badge.component.ts";
const home = "src/app/home.component.ts";
const list = "src/app/list.component.html";
write("points.json", JSON.stringify({
    open: [ base, badge, "src/app/lib/chip.component.ts", home, "src/app/list.component.ts", list ],
    points: [
        { id: "decl-base-label", what: "base class: @Input() label, inherited by BadgeComponent", file: base, after: "@Input()", needle: "label", delta: 0 },
        { id: "decl-base-size", what: "base class: signal input size, inherited by BadgeComponent", file: base, after: "readonly", needle: "size", delta: 0 },
        { id: "decl-badge-variant", what: "BadgeComponent: @Input({ alias: \"kind\" }) variant", file: badge, after: "alias", needle: "variant", delta: 0 },
        { id: "decl-badge-disabled", what: "BadgeComponent: @Input() disabled (own, decorator)", file: badge, after: "@Input() disabled", needle: "disabled", delta: 0 },
        { id: "decl-badge-class", what: "the class name BadgeComponent", file: badge, after: "", needle: "class BadgeComponent", delta: 6 },
        { id: "inline-static-label", what: "inline template: static attribute label=\"Static\" on <app-badge> (inherited @Input)", file: home, after: "<app-badge ", needle: "label=", delta: 1 },
        { id: "inline-bound-label", what: "inline template: [label] on <app-badge> (inherited @Input)", file: home, after: "<app-badge ", needle: "[label]", delta: 1 },
        { id: "inline-bound-size", what: "inline template: [size] on <app-badge> (inherited signal input)", file: home, after: "<app-badge ", needle: "[size]", delta: 1 },
        { id: "inline-alias-kind", what: "inline template: static attribute kind=\"warn\" (alias of variant)", file: home, after: "<app-badge ", needle: "kind=", delta: 1 },
        { id: "inline-bound-disabled", what: "inline template: [disabled] on <app-badge> (own @Input)", file: home, after: "<app-badge ", needle: "[disabled]", delta: 1 },
        { id: "inline-directive", what: "inline template: appTip=\"hello\" (attribute directive + its input)", file: home, after: "<app-badge ", needle: "appTip", delta: 1 },
        { id: "inline-decoy-label", what: "inline template: label=\"Decoy\" on <app-chip> (other component, same input name)", file: home, after: "<app-chip ", needle: "label=", delta: 1 },
        { id: "html-bound-label", what: "external template: [label] on <app-badge> (inherited @Input)", file: list, after: "<app-badge ", needle: "[label]", delta: 1 },
        { id: "html-bound-size", what: "external template: [size] on <app-badge> (inherited signal input)", file: list, after: "<app-badge ", needle: "[size]", delta: 1 }
    ]
}, null, 2));
console.log(`scratch workspace written to ${dir}\npoints: ${join(dir, "points.json")}`);
