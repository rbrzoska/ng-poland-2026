#!/usr/bin/env node
// Tests of ng-facts.mjs and ajs-facts.mjs on a tiny hybrid workspace they build themselves in the temp folder: an app that is
// not at src/app, aliases, setters, signal inputs, a model, outputs, inheritance through a base class without a decorator,
// hostDirectives, a template written with backslashes, a template with a parse error, routes across files and through an
// NgModule, ui-router states with constant names, a dialog opened through a service, a downgraded component used in
// AngularJS templates in kebab-case. The packages come from the node_modules above this folder (or next to the scripts).
//   node test/parser.test.mjs            (from the skill folder; exit code 1 when a case fails)
//   node test/parser.test.mjs --keep     (leaves the temp folder in place and prints where it is)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = mkdtempSync(path.join(os.tmpdir(), "angular-facts-parser-"));
const root = path.join(base, "shop");
const APP = "web/app-src";

function write(file, content) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

write("angular.json", { projects: { shop: { root: "", sourceRoot: APP, architect: { build: { options: { tsConfig: "tsconfig.app.json" } } } } } });
write("tsconfig.json", "{\n  // comments are allowed here\n  \"compilerOptions\": { \"paths\": { \"@shop/*\": [ \"./web/app-src/*\" ] } }\n}\n");
write("tsconfig.app.json", { extends: "./tsconfig.json", files: [ `${APP}/main.ts` ] });

write(`${APP}/main.ts`, `import { bootstrapApplication } from "@angular/platform-browser";
import { ShellComponent } from "./shell.component";
bootstrapApplication(ShellComponent);
`);
write(`${APP}/shell.component.ts`, `import { Component } from "@angular/core";
@Component({ selector: "app-shell", template: "<router-outlet /><app-card tip=\\"shell\\" [tipDelay]=\\"5\\"></app-card>" })
export class ShellComponent {}
`);
write(`${APP}/app.routes.ts`, `import { HomeComponent } from "./home/home.component";
export const appRoutes = [
    { path: "", component: HomeComponent },
    { path: "orders", loadChildren: () => import("./orders/orders.routes").then(m => m.ORDER_ROUTES) },
    { path: "admin", loadChildren: () => import("./admin/admin.module").then(m => m.AdminModule) },
    { path: "about", loadComponent: () => import("@shop/about/about.component") }
];
`);
write(`${APP}/orders/orders.routes.ts`, `import { OrderListComponent } from "./order-list.component";
import { OrderDetailComponent } from "./order-detail.component";
export const ORDER_ROUTES = [ { path: "", component: OrderListComponent, children: [ { path: ":id", component: OrderDetailComponent } ] } ];
`);
write(`${APP}/orders/order-list.component.ts`, `import { Component } from "@angular/core";
@Component({ selector: "app-order-list", templateUrl: "./order-list.component.html" })
export class OrderListComponent {}
`);
write(`${APP}/orders/order-list.component.html`, "<div><app-badge size=\"s\"></app-badge></span>\n<router-outlet />\n");
write(`${APP}/orders/order-detail.component.ts`, `import { Component, inject } from "@angular/core";
import { ConfirmService } from "../dialogs/confirm.service";
@Component({ selector: "app-order-detail", template: \`<app-text-field hint="h" /><app-text-field [hint]="x" />\` })
export class OrderDetailComponent {
    readonly confirm = inject(ConfirmService);
}
`);
write(`${APP}/dialogs/confirm.service.ts`, `import { ConfirmDialogComponent } from "./confirm-dialog.component";
export class ConfirmService {
    open(dialog: { open(component: unknown): void }) { dialog.open(ConfirmDialogComponent); }
}
`);
write(`${APP}/dialogs/confirm-dialog.component.ts`, `import { Component } from "@angular/core";
@Component({ selector: "app-confirm-dialog", template: "<app-badge text='sure?' />" })
export class ConfirmDialogComponent {}
`);
write(`${APP}/admin/admin.module.ts`, `import { NgModule } from "@angular/core";
import { RouterModule } from "@angular/router";
import { AdminPageComponent } from "./admin-page.component";
const adminRoutes = [ { path: "", component: AdminPageComponent } ];
@NgModule({ declarations: [ AdminPageComponent ], imports: [ RouterModule.forChild(adminRoutes) ] })
export class AdminModule {}
`);
write(`${APP}/admin/admin-page.component.ts`, `import { Component } from "@angular/core";
@Component({ selector: "app-admin-page", template: \`<span appFancyBadge size="s"></span><other-thing size="s"></other-thing>\` })
export class AdminPageComponent {}
@Component({ selector: "app-second-in-file", template: "" })
export class SecondInFileComponent {}
`);
write(`${APP}/about/about.component.ts`, `import { Component } from "@angular/core";
@Component({ selector: "app-about", template: \`<app-fancy-badge [size]="'m'" tone="x" />\` })
export default class AboutComponent {}
`);
write(`${APP}/home/home.component.ts`, `import { Component } from "@angular/core";
@Component({ selector: "app-home", templateUrl: "./home.component.html" })
export class HomeComponent { isOpen = false; }
`);
write(`${APP}/home/home.component.html`, `<app-badge text="Hi" i18n-text tone="red" size="s" [(open)]="isOpen" (picked)="pick()" (dismissed)="close()" #first></app-badge>
<p>{{ first.size() }} {{ first.label }}</p>
<app-badge [size]="wide ? 'm' : 's'" (openChange)="isOpen = $event" />
<a size="s">not a badge</a>
`);
write(`${APP}/ui/badge.component.ts`, `import { Component, EventEmitter, Input, Output, input, model, output } from "@angular/core";
@Component({ selector: "app-badge", template: "<b [class]=\\"size()\\">{{ label }}</b>" })
export class BadgeComponent {
    @Input("text") label = "";
    @Input({ alias: "tone", required: true }) set color(value: string) { this.tint = value; }
    readonly size = input<"s" | "m">("m");
    readonly open = model(false);
    @Output() picked = new EventEmitter<void>();
    readonly closed = output<void>({ alias: "dismissed" });
    tint = "";
    describe(): string { return this.size() + this.label; }
}
`);
write(`${APP}/ui/fancy-badge.component.ts`, `import { Component } from "@angular/core";
import { BadgeComponent } from "./badge.component";
@Component({ selector: "app-fancy-badge, [appFancyBadge]", template: \`<i>{{ size() }}</i>\` })
export class FancyBadgeComponent<T> extends BadgeComponent {
    value?: T;
}
`);
write(`${APP}/ui/base-field.ts`, `import { Input } from "@angular/core";
export abstract class BaseField { @Input() hint = ""; }
`);
write(`${APP}/ui/text-field.component.ts`, `import { Component } from "@angular/core";
import { BaseField } from "./base-field";
@Component({ selector: "app-text-field", template: "{{ hint }}" })
export class TextFieldComponent extends BaseField {}
`);
write(`${APP}/ui/tooltip.directive.ts`, `import { Directive, Input, input } from "@angular/core";
@Directive({ selector: "[appTip]" })
export class TooltipDirective {
    @Input() appTip = "";
    readonly tipDelay = input(0);
}
`);
write(`${APP}/ui/card.component.ts`, `import { Component } from "@angular/core";
import { TooltipDirective } from "./tooltip.directive";
const FOOTER = "<footer></footer>";
@Component({ selector: "app-card", hostDirectives: [ { directive: TooltipDirective, inputs: [ "tipDelay", "appTip: tip" ] } ], template: \`<section><ng-content />\${FOOTER}</section>\` })
export class CardComponent {}
`);
write(`${APP}/ui/unused.component.ts`, `import { Component } from "@angular/core";
@Component({ selector: "app-unused", template: "<app-unused-child />" })
export class UnusedComponent {}
@Component({ selector: "app-unused-child", template: "" })
export class UnusedChildComponent {}
`);
write(`${APP}/ui/badge.component.spec.ts`, `import { Component } from "@angular/core";
@Component({ template: \`<app-badge size="m" text="in a test" />\` })
class HostComponent {}
`);
write(`${APP}/ui/badge.stories.ts`, `export const Small = { render: (args: { tone: string }) => ({ props: args, template: \`<app-badge size="s" tone="\${args.tone}"></app-badge>\` }) };
`);
write(`${APP}/reports/names.ts`, `const ROOT = "shop";
export const NAMES = { ROOT, REPORTS: { MAIN: ROOT + ".reports", DAILY: \`\${ROOT}.reports.daily\` } } as const;
`);
write(`${APP}/reports/reports.states.ts`, `import { NAMES } from "./names";
import { ReportsComponent, DailyReportComponent } from "./reports.component";
export const reportStates = [
    { name: NAMES.ROOT, url: "/shop", abstract: true },
    { name: NAMES.REPORTS.MAIN, url: "/reports", component: ReportsComponent },
    { name: NAMES.REPORTS.DAILY, url: "/daily", component: DailyReportComponent }
];
`);
write(`${APP}/reports/reports.component.ts`, `import { Component } from "@angular/core";
@Component({ selector: "app-reports", template: "<ui-view></ui-view>" })
export class ReportsComponent {}
@Component({ selector: "app-daily-report", template: \`<app-badge text="daily" />\` })
export class DailyReportComponent {}
`);
write(`${APP}/ajs/module.ts`, `import { downgradeComponent } from "@angular/upgrade/static";
import { BadgeComponent } from "../ui/badge.component";
declare const angular: any;
angular.module("legacy", [])
    .directive("appBadge", downgradeComponent({ component: BadgeComponent, inputs: [ "text", "size" ], outputs: [ "picked" ] }) as any)
    .component("legacyPanel", { bindings: { title: "@" }, templateUrl: "ajs/legacy-panel.html" });
`);
write(`${APP}/ajs/legacy-panel.html`, `<div class="panel">
    <app-badge text="{{ $ctrl.title }}" [size]="'s'" (picked)="$ctrl.pick()"></app-badge>
    <app-badge bind-size="$ctrl.size" ng-if="$ctrl.wide"></app-badge>
</div>
`);
write(`${APP}/ajs/legacy-page.html`, "<legacy-panel title=\"Orders\"></legacy-panel>\n");

let failed = 0;
function run(script, ...args) {
    const result = spawnSync(process.execPath, [ path.join(SKILL, script), ...args ], { encoding: "utf8", cwd: base });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
}
function expect(name, result, code, ...patterns) {
    const missing = patterns.filter(pattern => !(pattern instanceof RegExp ? pattern.test(result.out) : result.out.includes(pattern)));
    const ok = result.code === code && !missing.length;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     exit code ${result.code} (expected ${code})${missing.length ? `; not in the output: ${missing.map(String).join(" | ")}` : ""}\n${result.out.split("\n").map(line => `     | ${line}`).join("\n")}`}`);
}
const ng = (...args) => run("ng-facts.mjs", ...args, "--root", root);
const ajs = (...args) => run("ajs-facts.mjs", ...args, "--root", root);

// --- ng-facts: reading
expect("usages of a class: elements, inputs by alias, tests and stories counted apart", ng("usages", "BadgeComponent"), 0,
    /BadgeComponent <app-badge>.*: 7 elements in 6 Angular templates \(\+ AngularJS: not counted here, run ajs-facts usages appBadge\), 2 of them in tests and stories/, "By input (4 declared): size ×5, text ×4, tone ×2, open ×1", "By output (3 declared): openChange ×2, picked ×1, dismissed ×1",
    "FancyBadgeComponent <app-fancy-badge, [appFancyBadge]> ×2", /1 template with parse errors.*order-list\.component\.html:1/, /2 inline templates built with \$\{…\}/);
expect("usages by selector and by attribute name of a selector", ng("usages", "appFancyBadge"), 0, "FancyBadgeComponent <app-fancy-badge, [appFancyBadge]>", ": 2 elements in 2 templates");
expect("a signal input: the class, the classes that extend it, a decoy left out", ng("usages", "BadgeComponent.size"), 0,
    "BadgeComponent.size (signal input): 7 bindings in 6 templates, 2 of them in tests and stories", "BadgeComponent <app-badge> ×5", "FancyBadgeComponent <app-fancy-badge, [appFancyBadge]> ×2 (FancyBadgeComponent extends BadgeComponent)",
    "Same name on other elements: 2 bindings on", "<other-thing> ×1", "<a> ×1", "Read through a template reference (#ref … ref.size): 1");
expect("asked on the subclass: answered for the declaring class", ng("usages", "FancyBadgeComponent.size"), 0, "! FancyBadgeComponent inherits it from BadgeComponent", "7 bindings");
expect("an alias is found by the member name and by the binding name", ng("usages", "BadgeComponent.label"), 0, "BadgeComponent.label (@Input, bound as \"text\"): 4 bindings", "Read through a template reference (#ref … ref.label): 1");
expect("an @Input on a setter with an alias object", ng("usages", "BadgeComponent.tone"), 0, "BadgeComponent.color (@Input, bound as \"tone\"): 3 bindings");
expect("a model: bindings and its change event", ng("usages", "BadgeComponent.open"), 0, "BadgeComponent.open (model input): 1 binding", "[(two-way)] ×1", "BadgeComponent.openChange (the change event of the model input): 2 bindings");
expect("an output with an alias", ng("usages", "BadgeComponent.dismissed"), 0, "BadgeComponent.closed (output, bound as \"dismissed\"): 1 binding", "(event) ×1");
expect("an input of a base class that has no decorator", ng("usages", "TextFieldComponent.hint"), 0, "BaseField.hint (@Input): 2 bindings", "TextFieldComponent <app-text-field> ×2 (TextFieldComponent extends BaseField)", "plain attribute ×1", "[bound] ×1");
expect("hostDirectives: bindings on the host under the exposed name", ng("usages", "TooltipDirective.tipDelay"), 0, "1 binding", "CardComponent <app-card> ×1 (hostDirectives of CardComponent)", "Exposed through hostDirectives of CardComponent as \"tipDelay\"");
expect("hostDirectives: an exposed alias", ng("usages", "TooltipDirective.appTip"), 0, "CardComponent <app-card> ×1 (hostDirectives of CardComponent)", "tip=\"shell\"");
expect("an unknown name names the close ones", ng("usages", "BadgComponent"), 1, "no component or directive \"BadgComponent\"");
expect("an unknown member lists the inputs and outputs", ng("usages", "BadgeComponent.nope"), 1, "Inputs: text, tone, size, open. Outputs: openChange, picked, dismissed.");

// --- ng-facts: screens
const whereBadge = ng("where", "BadgeComponent", "--all");
expect("where: routes across files, a template with a parse error, states with constant names, a dialog, AngularJS", whereBadge, 0,
    "4 of 7 routes and states show it through templates", "  /  web", "  /orders  web", "  /orders/:id  web/app-src/orders/orders.routes.ts:3",
    "state shop.reports.daily (/shop/reports/daily)", "it is downgraded as \"appBadge\"", "Extended by 1 class");
expect("where: a route that shows only the subclass is not listed", { code: /\/admin|\/about/.test(whereBadge.out) ? 1 : 0, out: whereBadge.out }, 0);
expect("where: a dialog opened through a service", ng("where", "ConfirmDialogComponent"), 0, "May be created from code by (1): OrderDetailComponent (named in web/app-src/dialogs/confirm.service.ts)", "0 of 7 routes and states show it through templates, 1 more may open it from code");
expect("where: through an NgModule and through a default export", ng("where", "FancyBadgeComponent"), 0, "  /admin  web/app-src/admin/admin.module.ts:4", "  /about  web/app-src/app.routes.ts:6");
expect("where: a route component of its own", ng("where", "app-daily-report"), 0, "It is itself the component of: state shop.reports.daily (/shop/reports/daily)");
expect("unrouted: only what nothing leads to; a dialog opened through a service is not listed", ng("unrouted"), 0,
    "3 of 17 components and directives are not reached", "5 routes, 2 states, 1 bootstrapped, 1 downgraded", "UnusedComponent  web/app-src/ui/unused.component.ts", "SecondInFileComponent", /3\. Rendered only by components of this list: 1[\s\S]*UnusedChildComponent/);
const unroutedText = ng("unrouted", "--all").out;
expect("unrouted: the dialog and the shell are alive", { code: /ConfirmDialogComponent|ShellComponent|CardComponent/.test(unroutedText) ? 1 : 0, out: unroutedText }, 0);

// --- ajs-facts (before anything is renamed)
expect("ajs summary", ajs("summary"), 0, /components\s+1\s+unused 0/, /downgrades\s+1\s+unused 0/);
expect("a downgraded component used in AngularJS templates, with its attributes in kebab-case", ajs("usages", "appBadge"), 0,
    "downgraded Angular component appBadge <app-badge> (BadgeComponent): 2 uses", "size ×2 ([bound] ×2)", "ng-if ×1", "the downgrade call names inputs: text, size; outputs: picked");
expect("one attribute of a downgraded component, three ways to write it", ajs("usages", "app-badge.size"), 0, "2 uses of the attribute size on 2 elements", "[size]=\"'s'\"", "bind-size=\"$ctrl.size\"", "the downgrade call names it");
expect("an AngularJS component and one binding of it", ajs("usages", "legacyPanel.title"), 0, "component legacyPanel.title: 1 use of the attribute title", "title=\"Orders\"");
expect("show: the card of an AngularJS component", ajs("show", "legacy-panel"), 0, "component legacyPanel  <legacy-panel>", "renders downgraded Angular components: appBadge");
expect("an unknown AngularJS name", ajs("usages", "nothingHere"), 1, "nothing registered on the AngularJS side");
expect("ajs --help", run("ajs-facts.mjs", "--help"), 0, "usages <name>.<attribute>");

// --- ng-facts: rename (dry run, then on the files)
expect("rename dry run: every group counted, nothing written", ng("rename-input", "BadgeComponent.size", "width"), 0,
    "rename-input BadgeComponent.size → width: 13 edits in 9 files, 0 need a decision — dry run, nothing written", /declaration\s+1/, /reads in the class\s+1/, /reads in its own template\s+2/, /reads through a template reference\s+1/, /bindings\s+7/,
    "left alone: 2 bindings of the same name", /→ next: node "[^"]*ng-facts\.mjs" rename-input BadgeComponent\.size width --write --root "/);
expect("where for a service: exit 1, and it names the command that answers for a class", ng("where", "ConfirmService"), 1, "is a class of this workspace but no component or directive", "refs ConfirmService --root");
expect("rename-input to a name the class already has: exit 1, nothing written", ng("rename-input", "BadgeComponent.size", "label"), 1, "already has a member \"label\"");
expect("rename --write: exit 2 (never the last step) and the next commands named", ng("rename-input", "BadgeComponent.size", "width", "--write"), 2, "written", "leftovers.mjs\" BadgeComponent.size --root", "check --root");
const read = file => readFileSync(path.join(root, file), "utf8");
const after = [
    [ "the declaration", `${APP}/ui/badge.component.ts`, "readonly width = input<" ],
    [ "this.size() in the class", `${APP}/ui/badge.component.ts`, "return this.width() + this.label" ],
    [ "the class's own template, written with backslashes", `${APP}/ui/badge.component.ts`, "<b [class]=\\\"width()\\\">" ],
    [ "the subclass's template", `${APP}/ui/fancy-badge.component.ts`, "<i>{{ width() }}</i>" ],
    [ "a plain attribute and a read through #first", `${APP}/home/home.component.html`, /tone="red" width="s"[\s\S]*first\.width\(\)[\s\S]*<app-badge \[width\]="wide/ ],
    [ "the decoy on <a>", `${APP}/home/home.component.html`, "<a size=\"s\">" ],
    [ "the subclass element and the decoy element", `${APP}/admin/admin-page.component.ts`, "<span appFancyBadge width=\"s\"></span><other-thing size=\"s\">" ],
    [ "a template with a parse error", `${APP}/orders/order-list.component.html`, "<app-badge width=\"s\">" ],
    [ "a test host", `${APP}/ui/badge.component.spec.ts`, "<app-badge width=\"m\"" ],
    [ "a story with ${…}", `${APP}/ui/badge.stories.ts`, "<app-badge width=\"s\" tone=\"${args.tone}\">" ]
];
for (const [ name, file, wanted ] of after) expect(`after the rename: ${name}`, { code: 0, out: read(file) }, 0, wanted);
expect("after the rename: the list of the downgrade call is renamed, the AngularJS templates are left for leftovers", { code: 0, out: read(`${APP}/ajs/module.ts`) + read(`${APP}/ajs/legacy-panel.html`) }, 0, "inputs: [ \"text\", \"width\" ]", "[size]=\"'s'\"", "bind-size");
expect("usages says that AngularJS binds it too, in kebab-case", ng("usages", "BadgeComponent.tone"), 0, "! AngularJS uses it too, and its templates are not read here: downgraded BadgeComponent as \"appBadge\"", "ajs-facts.mjs\" usages appBadge.tone --root");
expect("rename of an alias: the alias and the bindings, not the member", ng("rename-input", "BadgeComponent.text", "caption", "--write"), 2, "\"text\" is the alias of the member label", /bindings\s+5/);
expect("after the alias rename", { code: 0, out: read(`${APP}/ui/badge.component.ts`) + read(`${APP}/home/home.component.html`) + read(`${APP}/ajs/module.ts`) }, 0, "@Input(\"caption\") label = \"\";", "caption=\"Hi\" i18n-caption", "inputs: [ \"caption\", \"width\" ]");
expect("rename through hostDirectives: the list in the decorator and the binding on the host", ng("rename-input", "TooltipDirective.tipDelay", "tipWait", "--write"), 2, /lists in decorators\s+1/, /bindings\s+1/);
expect("after the hostDirectives rename", { code: 0, out: read(`${APP}/ui/card.component.ts`) + read(`${APP}/shell.component.ts`) }, 0, "inputs: [ \"tipWait\", \"appTip: tip\" ]", "[tipWait]=\\\"5\\\"");
expect("rename of a model renames its change event", ng("rename-input", "BadgeComponent.open", "expanded", "--write"), 2, /bindings\s+2/);
expect("after the model rename", { code: 0, out: read(`${APP}/home/home.component.html`) }, 0, "[(expanded)]=\"isOpen\"", "(expandedChange)=\"isOpen = $event\"");
expect("migrate: a dry run counts, an unreadable spec is a usage error", ng("migrate", "{\"component\":\"BadgeComponent\",\"inputs\":{\"width\":{\"rename\":\"scale\",\"values\":{\"s\":\"small\",\"m\":\"medium\"}}}}"), 0, /migrate BadgeComponent: \d+ elements \(with 1 classes that extend it\), \d+ edits/, "dry run");
expect("migrate with a broken spec", ng("migrate", "{nope"), 1, "the migration spec cannot be read");
expect("usage errors exit with 1", run("ng-facts.mjs", "usages", "--root", path.join(base, "missing")), 1, "no such directory");
expect("--help", run("ng-facts.mjs", "--help"), 0, "usages <Class>.<input|output>", "Exit code");
expect("a --root one level above the workspace is replaced by its only workspace folder", run("ng-facts.mjs", "usages", "app-card", "--root", base), 0, "its only folder that does is shop", "CardComponent <app-card>");

if (process.argv.includes("--keep")) console.log(`kept: ${base}`);
else rmSync(base, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
