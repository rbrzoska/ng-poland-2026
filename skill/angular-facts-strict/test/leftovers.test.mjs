#!/usr/bin/env node
// Test of leftovers.mjs on a tiny hybrid app that this script writes into the temp folder. No package is needed: leftovers reads text.
//   node test/leftovers.test.mjs [--keep]      exit code 0 when every check passes; --keep leaves the app on disk and says where
// Every line of the app that leftovers must mark is written here with its mark next to it ("CHANGE", "?", or both twice for
// two places on one line); every other line must stay unmarked. The app holds what the script has to tell apart: a generic
// component with two selectors, a component and an attribute directive that extend it, other components with a member of the
// same name, a stand-in in a test, two test hosts with the same class name, stories, strings in code, style sheets, a
// downgraded component in AngularJS templates (kebab-case, a string glued from pieces, an AngularJS name that another class
// took), a document, and files that must not be read (assets, minified, build output, a generated line).
// Then the marked places are renamed and the script must print DONE and exit 0.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "leftovers.mjs");
const keep = process.argv.includes("--keep");
const base = mkdtempSync(path.join(os.tmpdir(), "angular-facts-leftovers-"));
const app = path.join(base, "shop");
const OLD = "quietMode";
const NEW = "calm";

/** Lines of a file: a plain string must stay unmarked, [ text, ...marks ] must get exactly these marks. */
const FILES = {
    "tsconfig.json": [ "{ \"compilerOptions\": { \"strict\": true }, \"include\": [ \"src/**/*.ts\" ] }" ],
    "src/app/lib/badge.component.ts": [
        "import { Component, model, SimpleChanges } from \"@angular/core\";",
        "@Component({",
        "    selector: \"app-badge, app-chip-badge\",",
        "    template: \"<span>{{ quietMode() }}</span>\",",
        [ "    styles: [ \":host([quietMode]) { opacity: .5 }\" ],", "CHANGE" ],
        [ "    host: { \"[attr.quietMode]\": \"quietMode()\" }", "?", "?" ],
        "})",
        "/**",
        " * A badge. The comment between the decorator and the class holds = and ; and { } on purpose.",
        [ " * @example <app-badge [quietMode]=\"true\"></app-badge>", "CHANGE" ],
        " */",
        "export class BadgeComponent<T extends Record<string, unknown>> {",
        "    quietMode = model(false);",
        "    label = \"quietMode\";",
        "    ngOnChanges(changes: SimpleChanges) {",
        [ "        if (changes.quietMode || changes[\"quietMode\"]) this.refresh();", "CHANGE", "CHANGE" ],
        "    }",
        "    refresh() { return this.quietMode(); }",
        "}"
    ],
    "src/app/lib/loud-badge.component.ts": [
        "import { Component, Directive } from \"@angular/core\";",
        "import { BadgeComponent } from \"./badge.component\";",
        "@Component({ selector: \"app-loud-badge\", template: \"\" })",
        "export class LoudBadgeComponent extends BadgeComponent<Record<string, { deep: number }>> {",
        "    readonly loud = true;",
        "}",
        "@Directive({ selector: \"button[appQuietBadge]\" })",
        "export class QuietBadgeDirective extends LoudBadgeComponent {}"
    ],
    "src/app/lib/others.ts": [
        "import { Component, Directive, Input, input } from \"@angular/core\";",
        "import { BadgeComponent } from \"./badge.component\";",
        "@Component({ selector: \"app-card\", template: \"\" })",
        "export class CardComponent { quietMode = input(false); }",
        "@Component({ selector: \"old-badge\", template: \"\" })",
        "export class OldBadgeComponent { @Input(\"quietMode\") silent = false; }",
        "@Directive({ selector: \"[appTip]\" })",
        "export class TipDirective { quietMode = input(false); }",
        "@Component({",
        "    selector: \"app-panel\",",
        "    template: \"\",",
        [ "    hostDirectives: [ { directive: BadgeComponent, inputs: [ \"quietMode\" ] } ]", "CHANGE" ],
        "})",
        "export class PanelComponent {}"
    ],
    "src/app/lib/tray.component.ts": [
        "import { Component, inputBinding, ViewContainerRef } from \"@angular/core\";",
        "import { BadgeComponent } from \"./badge.component\";",
        "import { LoudBadgeComponent } from \"./loud-badge.component\";",
        "import { CardComponent } from \"./others\";",
        "@Component({ selector: \"app-tray\", template: \"\" })",
        "export class TrayComponent {",
        "    constructor(private readonly host: ViewContainerRef) {}",
        "    fill() {",
        "        const badge = this.host.createComponent(BadgeComponent);",
        [ "        badge.setInput(\"quietMode\", true);", "CHANGE" ],
        "        const card = this.host.createComponent(CardComponent);",
        "        card.setInput(\"quietMode\", true);",
        [ "        this.host.createComponent(LoudBadgeComponent, { bindings: [ inputBinding(\"quietMode\", () => true) ] });", "CHANGE" ],
        "        const word = \"quietMode\";",
        "        return [ badge, card, word, { quietMode: 1 } ];",
        "    }",
        "}"
    ],
    "src/app/screens/home.component.ts": [
        "import { Component } from \"@angular/core\";",
        "@Component({",
        "    selector: \"app-home\",",
        "    template: `",
        [ "        <app-badge quietMode />", "CHANGE" ],
        [ "        <app-badge [quietMode]=\"quietMode\" />", "CHANGE" ],
        "        <app-loud-badge",
        "            label=\"two lines\"",
        [ "            [quietMode]=\"true\"></app-loud-badge>", "CHANGE" ],
        [ "        <app-chip-badge [(quietMode)]=\"quiet\" (quietModeChange)=\"log($event)\" />", "CHANGE", "CHANGE" ],
        [ "        <app-badge [tooltip]=\"'<b>bold</b>'\" quietMode></app-badge>", "CHANGE" ],
        [ "        <button appQuietBadge [quietMode]=\"quiet\">quiet</button>", "CHANGE" ],
        "        <button [quietMode]=\"quiet\">not the directive</button>",
        "        <app-card quietMode></app-card>",
        "        <app-card [quietMode]=\"quietMode\" />",
        "        <span appTip [quietMode]=\"true\"></span>",
        "        <app-unknown [quietMode]=\"quiet\"></app-unknown>",
        "        <app-badge data-quietMode=\"1\" [class.quietMode]=\"quiet\" />",
        [ "        <app-panel [quietMode]=\"quiet\" />", "?" ],
        [ "        <app-badge [attr.quietMode]=\"quiet\" />", "?" ],
        "        <p>quietMode is a word, {{ quietMode }} an expression</p>",
        "        @if (quietMode) { <b>on</b> }",
        "    `",
        "})",
        "export class HomeComponent {",
        "    // quietMode of this screen",
        "    quietMode = true;",
        "    quiet = false;",
        "    log(value: unknown) { return value; }",
        "}"
    ],
    "src/app/screens/list.component.ts": [
        "import { Component } from \"@angular/core\";",
        "@Component({ selector: \"app-list\", templateUrl: \"./list.component.html\", styleUrl: \"./list.component.scss\" })",
        "export class ListComponent { quietMode = false; }"
    ],
    "src/app/screens/list.component.html": [
        "<app-badge",
        [ "    quietMode", "CHANGE" ],
        "/>",
        "<!-- quietMode above is the badge's -->",
        "<app-card [quietMode]=\"quietMode\"></app-card>"
    ],
    // more than 12 places in one group: the listing is cut without --all
    "src/app/screens/many.component.ts": [
        "import { Component } from \"@angular/core\";",
        "@Component({ selector: \"app-many\", templateUrl: \"./many.component.html\" })",
        "export class ManyComponent {}"
    ],
    "src/app/screens/many.component.html": Array.from({ length: 14 }, (unused, index) => [ `<app-badge [quietMode]="${index % 2 === 0}" />`, "CHANGE" ]),
    "src/app/screens/list.component.scss": [
        ":host {",
        [ "    app-badge[quietMode] { color: gray; }", "CHANGE" ],
        "    app-loud-badge {",
        [ "        &[quietMode] { color: silver; }", "CHANGE" ],
        "    }",
        "    .row[quietMode] { color: red; }",
        [ "    [quietMode] { color: blue; }", "?" ],
        "    app-card[quietMode] { color: green; }",
        "    --quietMode-color: red;",
        "    .is-quietMode { color: var(--quietMode-color); }",
        "    /* app-badge[quietMode] in a comment */",
        "}"
    ],
    "src/styles.scss": [
        [ "app-badge[quietMode], app-loud-badge[quietMode=\"true\"] { padding: 0; }", "CHANGE", "CHANGE" ],
        "input[quietMode] { padding: 1px; }",
        ".touch-quietMode-size { padding: 2px; }"
    ],
    "src/app/ajs/module.ts": [
        "import angular from \"angular\";",
        "import { downgradeComponent } from \"@angular/upgrade/static\";",
        "import { BadgeComponent } from \"../lib/badge.component\";",
        "import { OldBadgeComponent } from \"../lib/others\";",
        "angular.module(\"shop\")",
        [ "    .directive(\"appBadge\", downgradeComponent({ component: BadgeComponent, inputs: [ \"quietMode\" ] }) as angular.IDirectiveFactory)", "CHANGE" ],
        "    .directive(\"legacyBadge\", downgradeComponent({ component: OldBadgeComponent, inputs: [ \"quietMode\" ] }) as angular.IDirectiveFactory)",
        "    .directive(\"appLoudBadge\", downgradeComponent({ component: OldBadgeComponent }) as angular.IDirectiveFactory)",
        "    .component(\"ajsBox\", {",
        "        bindings: { quietMode: \"<\" },",
        [ "        template: \"<app-badge [quiet-mode]=\\\"$ctrl.quietMode\\\"></app-badge>\"", "CHANGE" ],
        "    });"
    ],
    "src/app/ajs/legacy.html": [
        [ "<app-badge [quiet-mode]=\"$ctrl.quiet\" (quiet-mode-change)=\"$ctrl.log($event)\"></app-badge>", "CHANGE", "CHANGE" ],
        [ "<app-badge quiet-mode=\"true\"></app-badge>", "CHANGE" ],
        "<legacy-badge quiet-mode=\"true\"></legacy-badge>",
        "<app-loud-badge [quiet-mode]=\"$ctrl.quiet\"></app-loud-badge>",
        "<ajs-box quiet-mode=\"$ctrl.quiet\"></ajs-box>",
        "<md-button quiet-mode ng-quiet-mode=\"1\">from a library</md-button>"
    ],
    "src/app/ajs/legacy.js": [
        "angular.module(\"shop\").run(function ($compile, scope, id) {",
        [ "    var html = \"<app-badge [id]=\\\"'\" + id + \"'\\\" quiet-mode=\\\"true\\\"></app-badge>\";", "CHANGE" ],
        "    return $compile(html)(scope);",
        "});"
    ],
    "src/app/lib/badge.stories.ts": [
        "import { BadgeComponent } from \"./badge.component\";",
        [ "type Args = Pick<BadgeComponent<Record<string, unknown>>, \"quietMode\" | \"label\">;", "CHANGE" ],
        "const meta = {",
        "    component: BadgeComponent,",
        [ "    argTypes: { quietMode: { control: \"boolean\" } },", "CHANGE" ],
        [ "    args: { quietMode: false }", "CHANGE" ],
        "};",
        "export default meta;",
        "export const Quiet = {",
        [ "    args: { quietMode: true } as Args,", "CHANGE" ],
        [ "    render: (args: Args) => ({ props: args, template: `<app-badge [quietMode]=\"quietMode\" />` })", "CHANGE", "?" ],
        "};",
        [ "export const PIECE = `[quietMode]=\"true\"`;", "?" ]
    ],
    "src/app/lib/card.stories.ts": [
        "import { CardComponent } from \"./others\";",
        "export default { component: CardComponent, args: { quietMode: true } };"
    ],
    "src/app/lib/badge.component.spec.ts": [
        "import { Component } from \"@angular/core\";",
        "import { ComponentFixture } from \"@angular/core/testing\";",
        "import { render } from \"@testing-library/angular\";",
        "import { BadgeComponent } from \"./badge.component\";",
        "import { CardComponent } from \"./others\";",
        "@Component({ template: \"\" })",
        "class TestHostComponent { quietMode = false; }",
        "let fixture: ComponentFixture<BadgeComponent<Record<string, unknown>>>;",
        "it(\"mutes\", async () => {",
        [ "    fixture.componentRef.setInput(\"quietMode\", true);", "CHANGE" ],
        "    expect(fixture.componentInstance.quietMode()).toBe(true);",
        [ "    await render(BadgeComponent, { componentInputs: { quietMode: true } });", "CHANGE" ],
        "    await render(CardComponent, { inputs: { quietMode: true } });",
        [ "    expect(fixture.nativeElement.getAttribute(\"quietMode\")).toBeNull();", "?" ],
        "});",
        "function createComponent(inputs: { quietMode: boolean; }) { return inputs; }"
    ],
    "src/app/screens/home.component.spec.ts": [
        "import { Component, input } from \"@angular/core\";",
        "import { TestBed } from \"@angular/core/testing\";",
        "import { By } from \"@angular/platform-browser\";",
        "@Component({ selector: \"app-badge\", template: \"\" })",
        "class BadgeStubComponent {",
        [ "    quietMode = input(false);", "CHANGE" ],
        "}",
        [ "@Component({ template: `<app-badge [quietMode]=\"on\" />`, imports: [ BadgeStubComponent ] })", "CHANGE" ],
        "class TestHostComponent { on = true; quietMode = input(false); }",
        "it(\"renders\", () => {",
        "    const fixture = TestBed.createComponent(TestHostComponent);",
        "    fixture.componentRef.setInput(\"quietMode\", true);",
        "    const model = { type: 1,",
        "        quietMode: 2 };",
        [ "    expect(fixture.debugElement.query(By.css(\"app-badge[quietMode]\"))).toBeTruthy();", "CHANGE" ],
        "    return model;",
        "});"
    ],
    "README.md": [
        "# Shop",
        [ "Write `<app-badge quietMode>` for a quiet badge.", "CHANGE" ],
        "The word quietMode alone is prose."
    ],
    // not read: assets, minified files, build output, a line nobody wrote by hand
    "src/assets/vendor.js": [ "var html = \"<app-badge quietMode></app-badge>\";" ],
    "src/app/lib/bundle.min.js": [ "x.setInput(\"quietMode\",1);var html=\"<app-badge quietMode></app-badge>\";" ],
    "dist/index.html": [ "<app-badge quietMode></app-badge>" ],
    "src/app/lib/generated.ts": [
        "import { BadgeComponent } from \"./badge.component\";",
        `export const TABLE = [ ${"\"x\", ".repeat(500)}"<app-badge quietMode>" ];`,
        "export const USED = BadgeComponent;"
    ]
};

/** Files for other questions: each one names its query, and its lines carry the marks of that query only. */
const EXTRA = {
    "HintService.show": {
        "src/app/lib/hint.service.ts": [ "export class HintService {", "    show() { return 1; }", "}" ],
        "src/app/ajs/hints.module.ts": [ "import * as angular from \"angular\";", "import { HintService } from \"../lib/hint.service\";", "angular.module(\"shop\").service(\"hints\", HintService);" ],
        "src/app/ajs/hint-screen.js": [ "angular.module(\"shop\").controller(\"HintCtrl\", function (hints, panel) {", [ "    hints.show();", "CHANGE" ], [ "    panel.show();", "?" ], "});" ],
        "src/app/ajs/other-screen.js": [ "angular.module(\"shop\").controller(\"OtherCtrl\", function (dialog) {", "    dialog.show();", "});" ],
        "src/app/lib/hint.service.spec.ts": [ "import { HintService } from \"./hint.service\";", "const providers = [", [ "    { provide: HintService, useValue: { show: () => 0 } }", "CHANGE" ], "];" ]
    },
    "PickListComponent.selectedChange": {
        "src/app/lib/pick-list.component.ts": [ "import { Component, input, output } from \"@angular/core\";", "@Component({ selector: \"app-pick-list\", templateUrl: \"./pick-list.component.html\" })", "export class PickListComponent {", "    selected = input<string[]>([]);", "    selectedChange = output<string[]>();", "}" ],
        "src/app/lib/pick-list.component.html": [ "<ul></ul>" ],
        "src/app/screens/lists.component.html": [ [ "<app-pick-list [(selected)]=\"picked\"></app-pick-list>", "CHANGE" ], [ "<app-pick-list (selectedChange)=\"pick($event)\"></app-pick-list>", "CHANGE" ], "<other-list [(selected)]=\"picked\"></other-list>" ],
        "src/app/screens/lists.component.ts": [ "import { Component } from \"@angular/core\";", "@Component({ selector: \"app-lists\", templateUrl: \"./lists.component.html\" })", "export class ListsComponent { picked = []; pick() {} }" ]
    },
    "TipTextDirective.text": {
        "src/app/lib/tip-text.directive.ts": [ "import { Directive, Input } from \"@angular/core\";", [ "@Directive({ selector: \"[tip-text]\" })", "?" ], "export class TipTextDirective {", "    @Input(\"tip-text\") text = \"\";", "}" ],
        "src/app/screens/tips.component.ts": [ "import { Component } from \"@angular/core\";", "@Component({", "    selector: \"app-tips\",", [ "    template: \"<span [tip-text]=\\\"'hello'\\\"></span>\"", "CHANGE" ], "})", "export class TipsComponent {}" ]
    }
};
for (const extraFiles of Object.values(EXTRA)) Object.assign(FILES, extraFiles);
const extraFileNames = new Set(Object.values(EXTRA).flatMap(Object.keys));
function expectedOf(query) {
    const marks = { CHANGE: new Map(), "?": new Map() };
    for (const [ file, lines ] of Object.entries(EXTRA[query])) {
        lines.forEach((line, index) => {
            if (typeof line !== "string") for (const mark of line.slice(1)) marks[mark].set(`${file}:${index + 1}`, (marks[mark].get(`${file}:${index + 1}`) ?? 0) + 1);
        });
    }
    return marks;
}

const expected = { CHANGE: new Map(), "?": new Map() };
for (const [ file, lines ] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    writeFileSync(path.join(app, file), `${lines.map(line => (typeof line === "string" ? line : line[0])).join("\n")}\n`);
    lines.forEach((line, index) => {
        if (typeof line === "string" || extraFileNames.has(file)) return;
        for (const mark of line.slice(1)) expected[mark].set(`${file}:${index + 1}`, (expected[mark].get(`${file}:${index + 1}`) ?? 0) + 1);
    });
}

let failures = 0;
function check(what, passed, detail = "") {
    if (!passed) failures++;
    console.log(`${passed ? "ok  " : "FAIL"} ${what}${passed || !detail ? "" : `\n       ${detail}`}`);
}

function run(...args) {
    const result = spawnSync(process.execPath, [ SCRIPT, ...args ], { encoding: "utf8", cwd: base });
    const marks = { CHANGE: new Map(), "?": new Map() };
    for (const line of result.stdout.split("\n")) {
        const place = line.match(/^ {2}(CHANGE|\?) +(\S+):(\d+) {2}/);
        if (place) marks[place[1]].set(`${place[2]}:${place[3]}`, (marks[place[1]].get(`${place[2]}:${place[3]}`) ?? 0) + 1);
    }
    return { ...result, marks };
}

/** The places where two maps of "file:line" → times differ, as text. */
function difference(wanted, got) {
    const places = [ ...new Set([ ...wanted.keys(), ...got.keys() ]) ].filter(place => (wanted.get(place) ?? 0) !== (got.get(place) ?? 0));
    return places.map(place => `${place} expected ${wanted.get(place) ?? 0}, got ${got.get(place) ?? 0}`).join(" | ");
}
const sum = map => [ ...map.values() ].reduce((left, right) => left + right, 0);

// ---- before the rename: every marked line, and no other
const first = run(`BadgeComponent.${OLD}`, "--root", "shop", "--all", "--before");
check(`CHANGE: the ${sum(expected.CHANGE)} marked places and no other`, difference(expected.CHANGE, first.marks.CHANGE) === "", difference(expected.CHANGE, first.marks.CHANGE));
check(`?: the ${sum(expected["?"])} marked places and no other`, difference(expected["?"], first.marks["?"]) === "", difference(expected["?"], first.marks["?"]));
check("the verdict is the first word of the first line", first.stdout.startsWith("IMPACT — "), first.stdout.split("\n")[0]);
{
    const refused = run(`BadgeComponent.${OLD}`, "--root", "shop");
    check("without --before while the class still declares the member: exit code 1, and it says to add --before", refused.status === 1 && /still declares quietMode.*--before/.test(refused.stderr), refused.stderr.slice(0, 200));
    const typo = run("BadgeComponent.quietMod", "--root", "shop", "--before");
    check("--before with a name the class does not declare: exit code 1 and the close member", typo.status === 1 && /declares no member quietMod\. Close members: quietMode/.test(typo.stderr), typo.stderr.slice(0, 200));
    const misspelled = run("BadgeComponent.quietMod", "--root", "shop");
    check("a name that nothing declares or writes, close to a member: exit code 1 and the close member",
        misspelled.status === 1 && /declares or writes quietMod\. Close members of BadgeComponent: quietMode/.test(misspelled.stderr), `exit ${misspelled.status} ${misspelled.stderr.slice(0, 200)}`);
    const inside = run(`BadgeComponent.${OLD}`, "--root", "shop/src/app", "--before");
    check("--root inside the workspace: exit code 1, and the workspace is named", inside.status === 1 && /is inside the workspace .*shop: pass --root/.test(inside.stderr), inside.stderr.slice(0, 200));
}
for (const query of Object.keys(EXTRA)) {
    const result = run(query, "--root", "shop", "--all", "--before");
    const wanted = expectedOf(query);
    // the places of an alias are read by the script itself and listed under their own heading, in the same form
    const got = result.marks;
    check(`${query} --before: CHANGE exactly the marked places`, difference(wanted.CHANGE, got.CHANGE) === "", difference(wanted.CHANGE, got.CHANGE) || result.stderr.slice(0, 200));
    check(`${query} --before: ? exactly the marked places`, difference(wanted["?"], got["?"]) === "", difference(wanted["?"], got["?"]));
}
check("a .js file with no call through the injected name: counted as code NO compiler checks", /1 in \.js code in 1 file that NO compiler checks/.test(run("HintService.show", "--root", "shop", "--before").stdout));
check("nothing on stderr", first.stderr === "", first.stderr.slice(0, 300));
check("files that are not read are named", /^not read: folders .*src\/assets\//m.test(first.stdout) && /1 places on lines over/.test(first.stdout), first.stdout.split("\n").find(line => line.startsWith("not read")) ?? "no such line");
check("the family is printed with its selectors", /^family: BadgeComponent <app-badge, app-chip-badge>; extended by 2 classes/m.test(first.stdout), first.stdout.split("\n")[1]);

const short = run(`BadgeComponent.${OLD}`, "--root", "shop", "--before");
const longest = Math.max(...short.stdout.split("\n").map(line => line.length));
check("without --all: at most 12 places per mark in a group, the rest counted", short.stdout.split("\n").filter(line => /^ {2}CHANGE {2}… \+\d+ more/.test(line)).length >= 1 && sum(short.marks.CHANGE) < sum(expected.CHANGE));
check("no line longer than 330 characters", longest <= 330, `longest ${longest}`);

// ---- the same question asked for a class that inherits the member, and from the folder above the workspace
const inherited = run(`LoudBadgeComponent.${OLD}`, "--root", "shop", "--all", "--before");
check("a member declared on the base class: the base's family is judged, and a line says so",
    difference(expected.CHANGE, inherited.marks.CHANGE) === "" && /^! quietMode is declared on BadgeComponent, a base class of LoudBadgeComponent/m.test(inherited.stdout),
    difference(expected.CHANGE, inherited.marks.CHANGE) || inherited.stdout.split("\n").slice(0, 4).join(" / "));
const above = run(`BadgeComponent.${OLD}`, "--root", ".", "--all", "--before");
check("--root one folder above the workspace: the only workspace below is used, and a line says so",
    difference(expected.CHANGE, above.marks.CHANGE) === "" && /^! --root \. has no angular\.json or tsconfig\.json/m.test(above.stdout), above.stdout.split("\n").slice(0, 4).join(" / ") + above.stderr);

// ---- --before: the same places as impact, never exit 2
const impact = run(`BadgeComponent.${OLD}`, "--root", "shop", "--all", "--before");
check("--before: the same places, exit code 0, IMPACT instead of NOT DONE",
    impact.status === 0 && difference(expected.CHANGE, impact.marks.CHANGE) === "" && /^IMPACT: /m.test(impact.stdout) && !/NOT DONE/.test(impact.stdout), `exit ${impact.status}`);

// ---- --leave: what was left, by thing
const audit = run(`BadgeComponent.${OLD}`, "--root", "shop", "--leave", "--before");
for (const thing of [ "other components: <app-card> CardComponent", "plain HTML elements: <button>", "other classes: CardComponent", "other classes: TestHostComponent",
    "AngularJS: the element is another downgraded class, not BadgeComponent: <app-loud-badge> OldBadgeComponent", "AngularJS: the element is another downgraded class: <legacy-badge> OldBadgeComponent",
    "AngularJS components and directives: <ajs-box>", "elements this project does not declare (a library or AngularJS): <app-unknown>", "class selectors whose class no element of the family carries: .row" ]) {
    check(`--leave names "${thing}"`, audit.stdout.includes(thing));
}

// ---- wrong calls
check("an unknown class: exit code 1 and close names", (() => { const result = run(`Badge.${OLD}`, "--root", "shop", "--before"); return result.status === 1 && /no class Badge .*Close names: .*BadgeComponent/.test(result.stderr); })());
check("no member given: exit code 1 and the usage", (() => { const result = run("BadgeComponent", "--root", "shop"); return result.status === 1 && result.stderr.startsWith("usage: "); })());
check("an unknown option: exit code 1", run(`BadgeComponent.${OLD}`, "--root", "shop", "--write").status === 1);
check("a folder that does not exist: exit code 1", run(`BadgeComponent.${OLD}`, "--root", "nowhere").status === 1);
check("--help: exit code 0", (() => { const result = run("--help"); return result.status === 0 && result.stdout.includes("--before"); })());

// ---- the declaration renamed, nothing else yet: every CHANGE is left, NOT DONE and exit code 2
{
    const declarationFile = path.join(app, "src/app/lib/badge.component.ts");
    const original = readFileSync(declarationFile, "utf8");
    writeFileSync(declarationFile, original.replace(`${OLD} = model(false)`, `${NEW} = model(false)`));
    const half = run(`BadgeComponent.${OLD}`, "--root", "shop", "--all");
    check("the declaration renamed only: the same CHANGE places, NOT DONE first and last, exit code 2",
        half.status === 2 && difference(expected.CHANGE, half.marks.CHANGE) === "" && half.stdout.startsWith("NOT DONE — ") && /^NOT DONE: /m.test(half.stdout),
        `exit ${half.status} ${difference(expected.CHANGE, half.marks.CHANGE)} ${half.stderr.slice(0, 200)}`);
    writeFileSync(declarationFile, original);
}

// ---- the rename, by hand: the old name is replaced on the lines marked CHANGE and nowhere else
for (const [ file, lines ] of Object.entries(FILES)) {
    if (!lines.some(line => typeof line !== "string" && line.includes("CHANGE"))) continue;
    const renamed = lines.map(line => {
        const text = typeof line === "string" ? line : line[0];
        return typeof line !== "string" && line.includes("CHANGE") ? text.replaceAll(OLD, NEW).replaceAll("quiet-mode", NEW) : text;
    });
    writeFileSync(path.join(app, file), `${renamed.join("\n")}\n`);
}
// the declaration and its reads are the compiler's part: the rename tool has done them before leftovers runs
const declaration = path.join(app, "src/app/lib/badge.component.ts");
writeFileSync(declaration, readFileSync(declaration, "utf8").replace(`${OLD} = model(false)`, `${NEW} = model(false)`).replace(`this.${OLD}()`, `this.${NEW}()`));
const after = run(`BadgeComponent.${OLD}`, "--root", "shop", "--all");
check("after the rename: no CHANGE, but NOT DECIDED and exit code 2 while a ? is open", after.status === 2 && sum(after.marks.CHANGE) === 0 && /^NOT DECIDED: /m.test(after.stdout) && !/^DONE: /m.test(after.stdout), `exit ${after.status}, CHANGE ${[ ...after.marks.CHANGE.keys() ].join(" | ")}`);
check("after the rename: the ? places that were not edited are still listed", sum(after.marks["?"]) >= 4, `? ${sum(after.marks["?"])}`);
const decided = run(`BadgeComponent.${OLD}`, "--root", "shop", "--all", "--decided", [ ...after.marks["?"].keys() ].join(","));
check("--decided with every ? place: DONE, exit code 0, the decided places named", decided.status === 0 && /^DONE: /m.test(decided.stdout) && /decided by you/.test(decided.stdout), `exit ${decided.status}`);
const nextLine = decided.stdout.split("\n").find(line => line.startsWith("→ next: ")) ?? "";
check("after DONE: the next command is one pasteable line with absolute quoted paths and --final",
    /^→ next: node "[^"]*leftovers\.mjs" BadgeComponent\.quietMode --decided "[^"]+" --final --root "[^"]+"/.test(nextLine) && !/[<>|…]|\[--/.test(nextLine.replace(/ {3}\(.*$/, "")), nextLine);
const newName = run(`BadgeComponent.${NEW}`, "--root", "shop");
check("the NEW name after the rename: exit code 1, it says to pass the old one", newName.status === 1 && /still declares calm.*OLD name/.test(newName.stderr), newName.stderr.slice(0, 200));

// ---- a story template whose args key was renamed, but whose read on the right side of the binding was not
{
    const story = path.join(app, "src/app/lib/badge.stories.ts");
    const renamedStory = readFileSync(story, "utf8");
    writeFileSync(story, renamedStory.replace(`[${NEW}]="${NEW}"`, `[${NEW}]="${OLD}"`));
    const halfDone = run(`BadgeComponent.${OLD}`, "--root", "shop", "--all");
    const line = renamedStory.split("\n").findIndex(text => text.includes(`[${NEW}]="${NEW}"`)) + 1;
    check("a story template that still reads the old key of args on the right side: CHANGE, NOT DONE, exit code 2",
        halfDone.status === 2 && halfDone.marks.CHANGE.get(`src/app/lib/badge.stories.ts:${line}`) === 1 && sum(halfDone.marks.CHANGE) === 1 && /which have no key/.test(halfDone.stdout),
        `exit ${halfDone.status}, CHANGE ${[ ...halfDone.marks.CHANGE.keys() ].join(" | ")}`);
    writeFileSync(story, renamedStory);
}

if (keep) console.log(`kept: ${base}`);
else rmSync(base, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
