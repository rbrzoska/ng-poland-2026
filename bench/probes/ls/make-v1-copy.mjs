#!/usr/bin/env node
// make-v1-copy.mjs: builds a throw-away, COMPILING copy of fixture/ for the language-service probe (ls-probe.mjs).
// fixture/ itself does not compile on purpose (library is PillComponent v2, the 120 feature templates still use v1),
// so a type-checking tool has nothing to resolve there. This script copies it and puts PillComponent v1 back
// (PILL_V1_REFERENCE from bench/prompts.mjs), with two changes needed to compile under strictTemplates:
//   - disableTooltip is input<boolean | undefined>(false)  (20 templates bind `user?.prefs?.quiet`)
//   - the PillTone type stays exported (pill-tone.pipe.ts imports it)
// It also links <out>/node_modules to this repository's node_modules (a junction on Windows).
//
// Run:  node bench/probes/ls/make-v1-copy.mjs <outDir> [--extras] [--from <fixture dir>]
//   --extras adds src/app/extra/: FancyPillComponent extends PillComponent (inheritance), a demo component that uses the
//            inherited input in a template and reads the input from class code, a class-side read inside PillComponent,
//            and a decorator-style OldBadgeComponent (@Input, @ViewChild) for the signal-migration refactorings.
// Then:  node bench/probes/ls/ls-probe.mjs <outDir>/fixture --strict-input-access
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PILL_V1_REFERENCE } from "../../prompts.mjs";

const REPO = path.resolve(import.meta.dirname, "../../..");
const argv = process.argv.slice(2);
const out = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--from");
if (!out) { console.error("usage: node bench/probes/ls/make-v1-copy.mjs <outDir> [--extras] [--from <fixture dir>]"); process.exit(2); }
const from = argv.includes("--from") ? path.resolve(argv[argv.indexOf("--from") + 1]) : path.join(REPO, "fixture");
const root = path.join(path.resolve(out), "fixture");
if (path.resolve(out).startsWith(REPO + path.sep)) { console.error("refusing to write inside the repository: give a directory under the temp directory"); process.exit(2); }

rmSync(root, { recursive: true, force: true });
mkdirSync(path.resolve(out), { recursive: true });
cpSync(from, root, { recursive: true });
if (!existsSync(path.join(path.resolve(out), "node_modules"))) symlinkSync(path.join(REPO, "node_modules"), path.join(path.resolve(out), "node_modules"), "junction");

const app = path.join(root, "src/app");
let pill = PILL_V1_REFERENCE
    .replace("readonly disableTooltip = input(false);", "readonly disableTooltip = input<boolean | undefined>(false);")
    + `\n/** kept so pill-tone.pipe.ts compiles against v1 */\nexport type PillTone = "neutral" | "positive" | "caution";\n`;

if (argv.includes("--extras")) {
    pill = pill
        .replace("import { ChangeDetectionStrategy, Component, input }", "import { ChangeDetectionStrategy, Component, computed, input }")
        .replace("    readonly disableTooltip = input<boolean | undefined>(false);", "    readonly disableTooltip = input<boolean | undefined>(false);\n    /** class-side read of the input, inside the declaring class */\n    readonly hasHint = computed(() => !this.disableTooltip());");
    mkdirSync(path.join(app, "extra"), { recursive: true });
    writeFileSync(path.join(app, "extra/fancy-pill.component.ts"), `import { ChangeDetectionStrategy, Component } from "@angular/core";
import { PillComponent } from "../lib/pill.component";

/** Inherits label, variant and disableTooltip from PillComponent; declares none of them itself. */
@Component({
    selector: "app-fancy-pill",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<b class="fancy" [class]="variant()">{{ label() }}@if (!disableTooltip()) {<span class="hint">!</span>}</b>\`
})
export class FancyPillComponent extends PillComponent {
}
`);
    writeFileSync(path.join(app, "extra/inherit-demo.component.html"), `<app-fancy-pill label="Fancy" [disableTooltip]="quiet" />
<app-fancy-pill label="Fancy two" variant="warning" [disableTooltip]="!quiet"></app-fancy-pill>
<app-pill #first label="Plain" [disableTooltip]="true" />
<app-old-badge [text]="title" [count]="3" />
`);
    writeFileSync(path.join(app, "extra/inherit-demo.component.ts"), `import { ChangeDetectionStrategy, Component, computed, viewChild } from "@angular/core";
import { PillComponent } from "../lib/pill.component";
import { FancyPillComponent } from "./fancy-pill.component";
import { OldBadgeComponent } from "./old-badge.component";

@Component({
    selector: "app-inherit-demo",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ PillComponent, FancyPillComponent, OldBadgeComponent ],
    templateUrl: "./inherit-demo.component.html"
})
export class InheritDemoComponent {
    quiet = false;
    title = "Demo";
    readonly first = viewChild.required(PillComponent);
    /** class-side read of the input, from another file */
    readonly firstIsQuiet = computed(() => this.first().disableTooltip() === true);
}
`);
    writeFileSync(path.join(app, "extra/old-badge.component.ts"), `import { Component, ElementRef, Input, ViewChild } from "@angular/core";

/** Decorator-style component: the target for the signal-migration refactorings. */
@Component({
    selector: "app-old-badge",
    template: \`<i #el [title]="text">{{ text }} ({{ count + 1 }})</i>\`
})
export class OldBadgeComponent {
    @Input() text = "";
    @Input({ required: true }) count!: number;
    @ViewChild("el") el!: ElementRef<HTMLElement>;

    describe(): string {
        return this.text + " x" + this.count + (this.el ? "" : "?");
    }
}
`);
}
writeFileSync(path.join(app, "lib/pill.component.ts"), pill);
console.log(`wrote ${root}${argv.includes("--extras") ? " (with src/app/extra/)" : ""}; PillComponent v1:\n${readFileSync(path.join(app, "lib/pill.component.ts"), "utf8")}`);
