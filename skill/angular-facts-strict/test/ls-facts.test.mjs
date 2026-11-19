#!/usr/bin/env node
// Test of ls-facts.mjs on a tiny Angular app that this script writes into the temp folder (nothing else is needed).
//   node test/ls-facts.test.mjs [--keep]      exit code 0 when every check passes; --keep leaves the app on disk
// The app has what the script must get right: a generic component, a class that extends it, an input with an alias, a
// model(), an output, a service, a pipe, routes, an external and an inline template, decoys with the same names, and the
// workspace layout of a new Angular CLI: tsconfig.json lists no files, tsconfig.app.json and tsconfig.spec.json do.
// The last block starts the background server of --warm and stops it again with --warm-stop.
// The packages are the ones of the nearest node_modules above this file that holds @angular/core (linked, not copied).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "ls-facts.mjs");
const keep = process.argv.includes("--keep");
const packages = path.resolve(path.dirname(createRequire(import.meta.url).resolve("@angular/core/package.json")), "..", "..", "..");

const FILES = {
    "angular.json": JSON.stringify({ version: 1, projects: { app: { projectType: "application", root: "", sourceRoot: "src", architect: {
        build: { builder: "@angular/build:application", options: { tsConfig: "tsconfig.app.json" } },
        test: { builder: "@angular/build:karma", options: { tsConfig: "tsconfig.spec.json" } }
    } } } }, null, 2),
    "tsconfig.json": JSON.stringify({
        compilerOptions: { noEmit: true, strict: true, target: "ES2022", module: "ES2022", moduleResolution: "bundler", experimentalDecorators: true, skipLibCheck: true, lib: [ "ES2022", "dom" ] },
        angularCompilerOptions: { strictTemplates: true },
        files: [],
        references: [ { path: "./tsconfig.app.json" }, { path: "./tsconfig.spec.json" } ]
    }, null, 2),
    "tsconfig.app.json": JSON.stringify({ extends: "./tsconfig.json", include: [ "src/**/*.ts" ], exclude: [ "src/**/*.spec.ts" ] }, null, 2),
    "tsconfig.spec.json": JSON.stringify({ extends: "./tsconfig.json", include: [ "src/**/*.spec.ts" ] }, null, 2),
    "src/main.ts": `import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent);
`,
    "src/styles.css": `app-chip[tone] { color: red; }
`,
    "src/app/chip.component.ts": `import { Component, input, model, output } from "@angular/core";

@Component({
    selector: "app-chip",
    template: \`<span [class]="tone()">{{ value() }}</span>\`
})
export class ChipComponent<T> {
    tone = input<string>("plain");
    readonly size = input(1, { alias: "chipSize" });
    value = model<T>();
    picked = output<T>();

    reset(): void {
        this.value.set(undefined);
    }
}
`,
    "src/app/big-chip.component.ts": `import { Component } from "@angular/core";
import { ChipComponent } from "./chip.component";

@Component({
    selector: "app-big-chip",
    template: \`<b>{{ tone() }}</b>\`
})
export class BigChipComponent<T> extends ChipComponent<T> {}
`,
    "src/app/decoy.component.ts": `import { Component, input, output } from "@angular/core";

@Component({ selector: "app-decoy", template: "" })
export class DecoyComponent {
    tone = input("none");
    picked = output<string>();
}
`,
    "src/app/chip.service.ts": `import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class ChipService {
    count = 0;

    bump(by: number): void {
        this.count += by;
    }
}
`,
    "src/app/shout.pipe.ts": `import { Pipe, PipeTransform } from "@angular/core";

@Pipe({ name: "shout" })
export class ShoutPipe implements PipeTransform {
    transform(value: string): string {
        return value.toUpperCase();
    }
}
`,
    "src/app/list.component.html": `<app-chip [tone]="'cool'" />
@if (on) {
    <app-chip tone="x" />
}
<app-decoy tone="a" (picked)="on = !on" />
<div tone="decoy"></div>
`,
    "src/app/list.component.ts": `import { Component } from "@angular/core";
import { ChipComponent } from "./chip.component";
import { DecoyComponent } from "./decoy.component";

@Component({
    selector: "app-list",
    imports: [ ChipComponent, DecoyComponent ],
    templateUrl: "./list.component.html"
})
export class ListComponent {
    on = true;
}
`,
    "src/app/app.routes.ts": `import { Routes } from "@angular/router";
import { ListComponent } from "./list.component";

export const routes: Routes = [
    { path: "list", component: ListComponent },
    { path: "lazy", loadComponent: () => import("./list.component").then(loaded => loaded.ListComponent) }
];
`,
    "src/app/app.component.ts": `import { Component, inject, viewChild } from "@angular/core";
import { BigChipComponent } from "./big-chip.component";
import { ChipComponent } from "./chip.component";
import { ChipService } from "./chip.service";
import { ShoutPipe } from "./shout.pipe";
import { routes } from "./app.routes";

@Component({
    selector: "app-root",
    imports: [ ChipComponent, BigChipComponent, ShoutPipe ],
    template: \`
        <app-chip tone="warm" [chipSize]="2" [(value)]="chosen" (picked)="onPicked($event)" />
        <app-big-chip [tone]="tone" (picked)="onPicked($event)" />
        <p>{{ title | shout }}</p>
    \`
})
export class AppComponent {
    private readonly chips = inject(ChipService);
    readonly chip = viewChild(ChipComponent);
    readonly routeCount = routes.length;
    title = "chips";
    tone = "calm";
    chosen: string | undefined = undefined;

    onPicked(value: string): void {
        this.chips.bump(1);
        this.title = \`\${value} \${this.chips.count} \${this.chip()?.tone()}\`;
        this.chip()?.reset();
    }
}
`,
    "src/app/chip.component.spec.ts": `import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ChipComponent } from "./chip.component";

@Component({ imports: [ ChipComponent ], template: \`<app-chip [tone]="shade" />\` })
class HostComponent {
    shade = "dark";
}

export function chipSpec(): string {
    const created = TestBed.createComponent(ChipComponent<string>);
    created.componentRef.setInput("tone", "by name");
    const chip: ChipComponent<string> = created.componentInstance;
    TestBed.createComponent(HostComponent);
    return chip.tone();
}
`,
    "src/app/other.spec.ts": `export const unrelated = { tone: "a word that is not the input", bump: 1 };
`
};

/** Writes the app into a new temp folder and links the packages; returns the folder that holds the workspace folder. */
function writeApp() {
    const base = mkdtempSync(path.join(os.tmpdir(), "ls-facts-test-"));
    const root = path.join(base, "app");
    for (const [ file, text ] of Object.entries(FILES)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    symlinkSync(path.join(packages, "node_modules"), path.join(base, "node_modules"), "junction");
    return { base, root };
}

function removeApp(base) {
    const link = path.join(base, "node_modules");
    try {
        rmdirSync(link);
    } catch {
        try {
            unlinkSync(link);
        } catch {
            // the link is gone already
        }
    }
    if (!existsSync(link)) rmSync(base, { recursive: true, force: true });
}

let failed = 0;
function check(what, condition, detail = "") {
    if (!condition) failed++;
    console.log(`${condition ? "ok  " : "FAIL"} ${what}${condition || !detail ? "" : `\n     ${String(detail).split("\n").join("\n     ")}`}`);
}
const run = (root, ...args) => {
    const result = spawnSync(process.execPath, [ SCRIPT, ...args, "--root", root ], { encoding: "utf8", env: { ...process.env, LS_FACTS_WARM_MINUTES: "2" } });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
};
const countOf = (answer, label) => answer.groups.find(group => group.label === label)?.count ?? 0;
const labels = answer => answer.groups.map(group => `${group.label}: ${group.count}`).join("; ");

const { base, root } = writeApp();
try {
    const { refs, planRename } = await import(pathToFileURL(SCRIPT).href);

    // an input of a generic component, with a subclass, a spec project and decoys
    const tone = refs(root, "ChipComponent.tone");
    check("tone: both projects are loaded, the app first", tone.projects.join(" + ") === "tsconfig.app.json + tsconfig.spec.json", tone.projects.join(" + "));
    check("tone: 10 references, each once", tone.references.length === 10 && new Set(tone.references.map(place => `${place.file}@${place.offset}`)).size === 10, labels(tone));
    check("tone: bound on <app-chip> 2 (one of them in the spec)", countOf(tone, "bound on <app-chip>") === 2 && tone.references.some(place => place.file.endsWith(".spec.ts") && place.kind === "binding"), labels(tone));
    check("tone: static on <app-chip> 2, one inside @if", countOf(tone, "static attribute on <app-chip>") === 2, labels(tone));
    check("tone: the inherited use on <app-big-chip> is found", countOf(tone, "bound on <app-big-chip>") === 1, labels(tone));
    check("tone: template reads 2 and TypeScript reads 2", countOf(tone, "read in a template expression") === 2 && countOf(tone, "read in TypeScript code") === 2, labels(tone));
    check("tone: no decoy (<app-decoy tone>, <div tone>, the other spec)", !tone.references.some(place => /decoy|other\.spec/.test(place.file) || place.on === "div" || place.on === "app-decoy"));
    check("tone: every edit names the member only", tone.references.every(place => place.text.includes("tone")));


    // an output, a service method, a service field
    const picked = refs(root, "ChipComponent.picked");
    check("output: event on <app-chip> 1 and on <app-big-chip> 1", countOf(picked, "event on <app-chip>") === 1 && countOf(picked, "event on <app-big-chip>") === 1 && picked.references.length === 3, labels(picked));
    const bump = refs(root, "ChipService.bump");
    check("method: called once in TypeScript code", countOf(bump, "called in TypeScript code") === 1 && bump.references.length === 2, labels(bump));
    check("method: a spec that holds the word but imports nothing of the class does not load the spec project, and is named",
        bump.projects.join(" + ") === "tsconfig.app.json" && bump.notes.some(note => note.includes("no import connects")), `${bump.projects.join(" + ")}\n${bump.notes.join("\n")}`);
    const count = refs(root, "ChipService.count");
    check("field: written once, read once", countOf(count, "written in TypeScript code") === 1 && countOf(count, "read in TypeScript code") === 1, labels(count));

    // classes
    const chip = refs(root, "ChipComponent");
    check("class: 4 elements in templates, the spec's host included", countOf(chip, "element in templates") === 4, labels(chip));
    check("class: imports arrays 3, extends 1, a view query 1", countOf(chip, "imports: [ … ]") === 3 && countOf(chip, "extended by a class (extends)") === 1 && countOf(chip, "view and content queries") === 1, labels(chip));
    const pipe = refs(root, "ShoutPipe");
    check("pipe: used once in a template", countOf(pipe, "pipe in templates") === 1, labels(pipe));
    const list = refs(root, "ListComponent");
    check("class: 2 route uses (component and loadComponent)", countOf(list, "routes (component, loadComponent, loadChildren)") === 2, labels(list));
    const service = refs(root, "ChipService");
    check("service: injected once", countOf(service, "injected (inject(), constructor parameter)") === 1, labels(service));

    // one project only
    const appOnly = refs(root, "ChipComponent.tone", { project: "tsconfig.app.json" });
    check("--project: 8 references and a note about the file outside", appOnly.references.length === 8 && appOnly.notes.some(note => note.includes("drop --project")), `${appOnly.references.length}\n${appOnly.notes.join("\n")}`);

    // the command line: output shape, notes, exit codes
    const shown = run(root, "refs", "ChipComponent.tone");
    const notes = shown.out.split("\n").filter(line => line.startsWith("!"));
    check("refs prints, exit code 0", shown.code === 0 && shown.out.includes("10 references in"), shown.out);
    check("every ! line is at most 160 characters", notes.length > 0 && notes.every(line => line.length <= 160), notes.join("\n"));
    check("refs names leftovers --before as the next step", /→ next: node .*leftovers\.mjs.* ChipComponent\.tone --before --root /.test(shown.out) || !existsSync(path.join(HERE, "..", "leftovers.mjs")), shown.out.split("\n").at(-2));
    const fromParent = run(base, "refs", "ChipService.bump");
    check("--root one folder above: the only child with a tsconfig is used, and said", fromParent.code === 0 && fromParent.out.includes("its only child folder"), fromParent.out);
    const wrongClass = run(root, "refs", "ChipComponen.tone");
    check("a wrong class name: exit code 1 and close names", wrongClass.code === 1 && wrongClass.out.includes("ChipComponent"), wrongClass.out);
    const wrongMember = run(root, "refs", "ChipComponent.tune");
    check("a wrong member name: exit code 1 and the members", wrongMember.code === 1 && wrongMember.out.includes("tone (input())"), wrongMember.out);
    check("--help: exit code 0", run(root, "--help").code === 0);

    // rename: the plan, then written into a copy
    const plan = planRename(root, "ChipComponent.tone", "mood");
    check("rename plan: 10 edits, built from the references of a generic class", plan.edits.length === 10 && plan.edits.every(edit => edit.newText === "mood" && edit.length === 4), `${plan.edits.length} edits, source ${plan.source}`);
    const aliased = planRename(root, "ChipComponent.size", "width");
    check("rename of an aliased input: the alias in the template stays", aliased.edits.length === 1 && aliased.skipped.length === 1 && aliased.notes.some(note => note.includes("alias")), aliased.notes.join("\n"));
    const model = planRename(root, "ChipComponent.value", "content");
    check("rename of a model(): [(value)] becomes [(content)]", model.edits.some(edit => edit.form === "two-way" && edit.newText === "content"), JSON.stringify(model.edits.map(edit => [ edit.file, edit.form, edit.newText ])));
    check("rename onto an existing member is refused", (() => {
        try {
            planRename(root, "ChipComponent.tone", "size");
            return false;
        } catch (error) {
            return /already has a member/.test(error.message);
        }
    })());

    const copy = path.join(base, "written");
    cpSync(root, copy, { recursive: true });
    const written = run(copy, "rename", "ChipComponent.tone", "mood", "--write");
    const after = file => readFileSync(path.join(copy, file), "utf8");
    check("rename --write: written, then exit code 2 and NOT DONE for the 2 text places it cannot see (a string and a style)", written.code === 2 && written.out.includes("10 edits in 5 files — written") && /^NOT DONE: 2 places in text still carry tone/m.test(written.out), written.out);
    check("rename --write: the last line names leftovers with absolute quoted paths", /→ next: node "[^"]*leftovers\.mjs" ChipComponent\.tone --root "[^"]+"/.test(written.out.trim().split("\n").at(-1)) || !existsSync(path.join(HERE, "..", "leftovers.mjs")), written.out.split("\n").slice(-3).join("\n"));
    check("rename --write: the spec file outside the build's tsconfig is named", written.out.includes("1 edited file is outside tsconfig.app.json"), written.out);
    check("written: the subclass element and the spec's host template", after("src/app/app.component.ts").includes(`<app-big-chip [mood]="tone"`) && after("src/app/chip.component.spec.ts").includes(`<app-chip [mood]="shade" />`));
    check("written: decoys, the string and the style selector are untouched", after("src/app/list.component.html").includes(`<app-decoy tone="a"`) && after("src/app/list.component.html").includes(`<div tone="decoy">`)
        && after("src/app/chip.component.spec.ts").includes(`setInput("tone"`) && after("src/styles.css").includes("app-chip[tone]") && after("src/app/decoy.component.ts").includes("tone = input"));
    const compiled = run(copy, "check");
    check("check after the rename: 0 errors on the build's tsconfig, exit code 0", compiled.code === 0 && compiled.out.includes("check: 0 errors (ngc -p tsconfig.app.json"), compiled.out);
    const specs = run(copy, "check", "--project", "tsconfig.spec.json");
    check("check --project tsconfig.spec.json: 0 errors", specs.code === 0 && specs.out.includes("check: 0 errors"), specs.out);
    writeFileSync(path.join(copy, "src/app/list.component.html"), after("src/app/list.component.html").replace(`[mood]="'cool'"`, `[tone]="'cool'"`));
    const broken = run(copy, "check");
    check("check on a binding that was left behind: exit code 2 and NOT DONE", broken.code === 2 && broken.out.includes("NOT DONE") && broken.out.includes("NG8002"), broken.out);

    // --warm: a server that stays. Every answer must be the one a fresh process gives, also after files changed on disk.
    const warmRoot = path.join(base, "warm");
    cpSync(root, warmRoot, { recursive: true });
    const inWarm = file => path.join(warmRoot, file);
    const plain = text => text.split("\n").filter(line => !line.startsWith("! the warm server")).join("\n").replace(/; [\d.]+ s[^)\n]*\)/, ")");
    const both = (...args) => {
        const warm = run(warmRoot, ...args, "--warm"), cold = run(warmRoot, ...args);
        return { same: plain(warm.out) === plain(cold.out) && warm.code === cold.code, warm: warm.out, detail: `--- warm\n${warm.out}\n--- plain\n${cold.out}` };
    };
    try {
        const first = both("refs", "ChipComponent.tone");
        check("--warm: the first answer starts the server and equals a plain run", first.same && first.warm.includes("warm server started"), first.detail);
        const second = both("refs", "ChipComponent.tone");
        check("--warm: the second answer comes from the running server", second.same && /s, warm\)/.test(second.warm), second.detail);
        writeFileSync(inWarm("src/app/list.component.html"), `${readFileSync(inWarm("src/app/list.component.html"), "utf8")}<app-chip [tone]="'late'" />\n`);
        const third = both("refs", "ChipComponent.tone");
        check("--warm: a binding added to an external template on disk is found", third.same && third.warm.includes("11 references"), third.detail);
        writeFileSync(inWarm("src/app/app.component.ts"), readFileSync(inWarm("src/app/app.component.ts"), "utf8").replace("<p>{{", `<app-chip [tone]="title" /><p>{{`));
        const fourth = both("refs", "ChipComponent.tone");
        check("--warm: a binding added to an inline template on disk is found", fourth.same && fourth.warm.includes("12 references") && /s, warm\)/.test(fourth.warm), fourth.detail);
        const wrong = run(warmRoot, "refs", "ChipComponent.tune", "--warm");
        check("--warm: a wrong member name is exit code 1, and the server goes on", wrong.code === 1 && wrong.out.includes("has no member"), wrong.out);
        writeFileSync(inWarm("src/app/late.component.ts"), `import { Component } from "@angular/core";\nimport { ChipComponent } from "./chip.component";\n\n@Component({ selector: "app-late", imports: [ ChipComponent ], template: \`<app-chip tone="late" />\` })\nexport class LateComponent {}\n`);
        const fifth = both("refs", "ChipComponent.tone");
        check("--warm: a new file starts the server again, and its binding is found", fifth.same && fifth.warm.includes("13 references") && fifth.warm.includes("started again: a source file was added or removed"), fifth.detail);
        const renamed = run(warmRoot, "rename", "ChipComponent.tone", "mood", "--write", "--warm");
        check("--warm: rename --write through the server", renamed.code === 2 && renamed.out.includes("13 edits in 6 files — written"), renamed.out);
        const sixth = both("refs", "ChipComponent.mood");
        check("--warm: the files the rename wrote are read again", sixth.same && sixth.warm.includes("13 references") && /s, warm\)/.test(sixth.warm), sixth.detail);
        rmSync(inWarm("src/app/late.component.ts"));
        const seventh = both("refs", "ChipComponent.mood");
        check("--warm: a removed file starts the server again", seventh.same && seventh.warm.includes("12 references") && seventh.warm.includes("started again"), seventh.detail);
    } finally {
        const stopped = run(warmRoot, "--warm-stop");
        check("--warm-stop ends the server", stopped.out.includes("was stopped"), stopped.out);
        check("--warm-stop when no server runs says so", run(warmRoot, "--warm-stop").out.includes("no warm server"));
    }
} finally {
    if (keep) console.log(`kept: ${base}`);
    else removeApp(base);
}
console.log(failed ? `${failed} checks FAILED` : "all checks passed");
process.exit(failed ? 1 : 0);
