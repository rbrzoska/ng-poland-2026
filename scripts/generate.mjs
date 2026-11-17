// Generates a synthetic Angular workspace where the component library already ships PillComponent v2 while 120 feature
// components still use the v1 API (fixture/), plus the correctly migrated twin (fixture-expected/). Six template styles,
// an <app-pill-legacy> decoy and the traps listed in README.md make it look like a real codebase. OUT selects the output dir.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const FEATURES = Number(process.env.FEATURES ?? 120);
const ROOT = process.env.OUT ?? path.resolve(import.meta.dirname, "..");

const TSCONFIG = {
    compilerOptions: {
        outDir: "./out-tsc",
        rootDir: "./src",
        noEmit: true,
        strict: true,
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "bundler",
        experimentalDecorators: true,
        skipLibCheck: true,
        lib: [ "ES2022", "dom" ]
    },
    angularCompilerOptions: { strictTemplates: true, strictInjectionParameters: true },
    include: [ "src/**/*.ts" ]
};

const pill = () => `import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

export type PillTone = "neutral" | "positive" | "caution";

/** v1 values, kept so existing fields still compile — map them with PillTonePipe. */
export type PillVariant = "info" | "success" | "warning";

@Component({
    selector: "app-pill",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<span class="pill" [class]="tone()"><ng-content />@if (hasTooltip()) {<span class="hint">i</span>}</span>\`
})
export class PillComponent {
    readonly tone = input<PillTone>("neutral");
    readonly tooltip = input(true);
    readonly hasTooltip = computed(() => this.tooltip());
}
`;

const pillLegacy = () => `import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import type { PillVariant } from "./pill.component";

/** The old pill, kept for the legacy reports screen. Still on the v1 API on purpose — not part of the migration. */
@Component({
    selector: "app-pill-legacy",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<span class="pill legacy" [class]="variant()">{{ label() }}@if (!disableTooltip()) {<span class="hint">i</span>}</span>\`
})
export class PillLegacyComponent {
    readonly label = input("");
    readonly variant = input<PillVariant>("info");
    readonly disableTooltip = input(false);
}
`;

const pillTonePipe = () => `import { Pipe, type PipeTransform } from "@angular/core";
import type { PillTone, PillVariant } from "./pill.component";

const TONES: Record<PillVariant, PillTone> = { info: "neutral", success: "positive", warning: "caution" };

@Pipe({ name: "pillTone" })
export class PillTonePipe implements PipeTransform {
    transform(variant: PillVariant): PillTone {
        return TONES[variant];
    }
}
`;

const card = () => `import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
    selector: "app-card",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<section class="card" [attr.title]="disableTooltip() ? null : heading()"><h3>{{ heading() }}</h3><ng-content /></section>\`
})
export class CardComponent {
    readonly heading = input("");
    readonly disableTooltip = input(false);
}
`;

const STYLES = 6;
const styleOf = index => index % STYLES;
const usesLegacy = index => styleOf(index) === 1 || styleOf(index) === 5;
const needsPipeAfter = index => [ 0, 2, 3, 4 ].includes(styleOf(index)) && (styleOf(index) !== 0 || index % 2 === 0);

const ownFlag = [
    `    @if (disableTooltip) {`,
    `        <small>Own flag, unrelated to the pill input</small>`,
    `    }`
];

function canonical(index, after) {
    const nested = index % 2 === 0
        ? (after ? `<app-pill [tone]="statusVariant | pillTone" [tooltip]="true">Nested</app-pill>` : `<app-pill [variant]="statusVariant" label="Nested" [disableTooltip]="false" />`)
        : (after ? `<app-pill tone="caution" [tooltip]="true">Nested</app-pill>` : `<app-pill variant="warning" label="Nested" [disableTooltip]="false" />`);
    return [
        `<app-card heading="Feature ${index}" [disableTooltip]="true">`,
        `    <p class="hint">Set disableTooltip on a pill to hide its hint.</p>`,
        after ? `    <app-pill [tooltip]="false">Plain</app-pill>` : `    <app-pill label="Plain" [disableTooltip]="true" />`,
        after ? `    <app-pill tone="positive" [tooltip]="isActive">Active</app-pill>` : `    <app-pill variant="success" label="Active" [disableTooltip]="!isActive" />`,
        after ? `    <app-pill [tooltip]="!(count > 3)">{{ title }}</app-pill>` : `    <app-pill [label]="title" [disableTooltip]="count > 3" />`,
        `    <app-pill`,
        after ? `        [tone]="isActive ? 'positive' : 'caution'"` : `        [variant]="isActive ? 'success' : 'warning'"`,
        ...(after ? [ `        [tooltip]="!isActive">Multi-line</app-pill>` ] : [ `        label="Multi-line"`, `        [disableTooltip]="isActive">`, `    </app-pill>` ]),
        `    @if (isActive) {`,
        `        ${nested}`,
        `    }`,
        ...ownFlag,
        `</app-card>`
    ];
}

function compact(index, after) {
    return [
        `<app-card heading="Feature ${index}" [disableTooltip]="true">`,
        `  <p class="hint">Set disableTooltip on a pill to hide its hint.</p>`,
        after ? `  <app-pill [tooltip]='false'>Plain</app-pill>` : `  <app-pill [disableTooltip]='true' label='Plain'/>`,
        after ? `  <app-pill  tone="positive"  [tooltip]="isActive">Active</app-pill>` : `  <app-pill  variant="success"  [disableTooltip]="!isActive"  label="Active"/>`,
        after ? `  <app-pill [tooltip]="!(count > 3)" tone="neutral">{{ title }}</app-pill>` : `  <app-pill [disableTooltip]="count > 3" [label]="title" variant="info" />`,
        after ? `  <app-pill [tone]="isActive ? 'positive' : 'caution'" [tooltip]="!isActive">Multi-line</app-pill>` : `  <app-pill [variant]="isActive ? 'success' : 'warning'" label="Multi-line" [disableTooltip]="isActive"></app-pill>`,
        `  @if (isActive) {`,
        `    <app-pill-legacy label="Legacy" variant="info" [disableTooltip]="true" />`,
        `  }`,
        `  @if (disableTooltip) {`,
        `    <small>Own flag, unrelated to the pill input</small>`,
        `  }`,
        `</app-card>`
    ];
}

function oneAttributePerLine(index, after) {
    return [
        `<app-card heading="Feature ${index}" [disableTooltip]="true">`,
        `    <!-- disableTooltip here is the card's flag; pills carry their own -->`,
        `    <app-pill`,
        ...(after ? [] : [ `        label="Plain"` ]),
        after ? `        tone="caution"` : `        variant="warning"`,
        after ? `        [tooltip]="false">Plain</app-pill>` : `        [disableTooltip]="true"`,
        ...(after ? [] : [ `    />` ]),
        `    <app-pill`,
        ...(after ? [] : [ `        [label]="title"` ]),
        after ? `        [tone]="count > 3 ? 'positive' : isActive ? 'caution' : 'neutral'"` : `        [variant]="count > 3 ? 'success' : isActive ? 'warning' : 'info'"`,
        after ? `        [tooltip]="isActive && count > 1">{{ title }}</app-pill>` : `        [disableTooltip]="!(isActive && count > 1)"`,
        ...(after ? [] : [ `    />` ]),
        after ? `    <app-pill [tone]="statusVariant | pillTone" [tooltip]="true">Nested</app-pill>` : `    <app-pill [variant]="statusVariant" label="Nested" [disableTooltip]="false" />`,
        ...ownFlag,
        `</app-card>`
    ];
}

function loop(index, after) {
    return [
        `<app-card heading="Feature ${index}" [disableTooltip]="true">`,
        `    <p class="hint">Set disableTooltip on a pill to hide its hint.</p>`,
        `    @for (item of items; track item.id) {`,
        after ? `        <app-pill [tone]="item.variant | pillTone" [tooltip]="!item.hidden">{{ item.name }}</app-pill>` : `        <app-pill [label]="item.name" [variant]="item.variant" [disableTooltip]="item.hidden" />`,
        `    }`,
        after ? `    <app-pill [tooltip]="false">Plain</app-pill>` : `    <app-pill label="Plain" [disableTooltip]="true" />`,
        after ? `    <app-pill tone="positive" [tooltip]="isActive">Active</app-pill>` : `    <app-pill variant="success" label="Active" [disableTooltip]="!isActive" />`,
        `    @if (disableTooltip) { <small>Own flag, unrelated to the pill input</small> }`,
        `</app-card>`
    ];
}

function expressions(index, after) {
    return [
        `<app-card heading="Feature ${index}" [disableTooltip]="!isActive">`,
        `    <p class="hint">Set disableTooltip on a pill to hide its hint.</p>`,
        after ? `    <app-pill tone="neutral" [tooltip]="!user?.prefs?.quiet">Quiet</app-pill>` : `    <app-pill label="Quiet" variant="info" [disableTooltip]="user?.prefs?.quiet" />`,
        after ? `    <app-pill [tone]="statusVariant | pillTone" [tooltip]="!(items.length === 0)">{{ title }}</app-pill>` : `    <app-pill [label]="title" [variant]="statusVariant" [disableTooltip]="items.length === 0" />`,
        after ? `    <app-pill tone="caution" [tooltip]="!flags['hidden']">Keyed</app-pill>` : `    <app-pill label="Keyed" variant="warning" [disableTooltip]="flags['hidden']" />`,
        after ? `    <app-pill tone="positive" [tooltip]="!isHidden()">Called</app-pill>` : `    <app-pill label="Called" variant="success" [disableTooltip]="isHidden()" />`,
        ...ownFlag,
        `</app-card>`
    ];
}

function wide(index, after) {
    return [
        `<app-card heading="Feature ${index}" [disableTooltip]="true">`,
        `    <p class="hint">Set disableTooltip on a pill to hide its hint.</p>`,
        `    <div class="row">`,
        after ? `        <app-pill tone="neutral" [tooltip]="false">Info</app-pill><app-pill tone="positive" [tooltip]="isActive">Active</app-pill>` : `        <app-pill label="Info" variant="info" [disableTooltip]="true" /><app-pill label="Active" variant="success" [disableTooltip]="!isActive" />`,
        `        <app-pill-legacy [label]="title" [variant]="statusVariant" [disableTooltip]="count > 3" />`,
        `    </div>`,
        after ? `    <app-pill [tooltip]="!(count > 3)">{{ title }}</app-pill>` : `    <app-pill [label]="title" [disableTooltip]="count > 3" />`,
        ...ownFlag,
        `</app-card>`
    ];
}

const STYLE_TEMPLATES = [ canonical, compact, oneAttributePerLine, loop, expressions, wide ];

function featureTemplate(index, after) {
    const lines = STYLE_TEMPLATES[styleOf(index)](index, after);
    if (index % 3 === 0) lines.push(`<app-card heading="Decoy only" [disableTooltip]="!isActive" />`);
    return lines.join("\n") + "\n";
}

function featureComponent(index, after, inline) {
    const name = `Feature${String(index).padStart(3, "0")}Component`;
    const template = featureTemplate(index, after);
    const needsPipe = after && needsPipeAfter(index);
    const legacy = usesLegacy(index);
    const templateField = inline
        ? `    template: \`\n${template.replace(/^/gm, "        ").trimEnd()}\n    \``
        : `    templateUrl: "./feature-${index}.component.html"`;
    const fields = [
        `    isActive = ${index % 2 === 0};`,
        `    count = ${index % 7};`,
        `    disableTooltip = ${index % 2 === 1};`,
        `    title = "Title ${index}";`,
        `    statusVariant: PillVariant = "${index % 4 === 0 ? "warning" : "success"}";`
    ];
    if (styleOf(index) === 3 || styleOf(index) === 4) fields.push(`    items: { id: number; name: string; variant: PillVariant; hidden: boolean }[] = [ { id: 1, name: "Alpha", variant: "info", hidden: false }, { id: 2, name: "Beta", variant: "warning", hidden: ${index % 2 === 0} } ];`);
    if (styleOf(index) === 4) fields.push(`    user?: { prefs?: { quiet: boolean } } = { prefs: { quiet: ${index % 2 === 1} } };`, `    flags: Record<string, boolean> = { hidden: ${index % 3 === 0} };`, `    isHidden(): boolean {\n        return this.count > 4;\n    }`);
    return `import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CardComponent } from "../../lib/card.component";
import { PillComponent, type PillVariant } from "../../lib/pill.component";${legacy ? `\nimport { PillLegacyComponent } from "../../lib/pill-legacy.component";` : ""}${needsPipe ? `\nimport { PillTonePipe } from "../../lib/pill-tone.pipe";` : ""}

@Component({
    selector: "app-feature-${index}",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ PillComponent, CardComponent${legacy ? ", PillLegacyComponent" : ""}${needsPipe ? ", PillTonePipe" : ""} ],
${templateField}
})
export class ${name} {
${fields.join("\n")}
}
`;
}

const ANGULAR_JSON = {
    $schema: "./node_modules/@angular/cli/lib/config/schema.json",
    version: 1,
    cli: { analytics: false },
    projects: {
        demo: {
            projectType: "application",
            root: "",
            sourceRoot: "src",
            architect: {
                build: {
                    builder: "@angular/build:application",
                    options: { browser: "src/main.ts", index: "src/index.html", tsConfig: "tsconfig.app.json", styles: [ "src/styles.css" ], outputPath: "dist", optimization: true, sourceMap: false, outputHashing: "all" }
                }
            }
        }
    }
};

const TSCONFIG_APP = { extends: "./tsconfig.json", compilerOptions: { noEmit: false, outDir: "./out-tsc/app" }, files: [ "src/main.ts" ], include: [] };

const MAIN = `import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, { providers: [ provideZonelessChangeDetection() ] }).catch(error => console.error(error));
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Pill village</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <app-root></app-root>
</body>
</html>
`;

const STYLES_CSS = `:root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin: 0; background: #f4f1e8; color: #2b2416; }
.page { padding: 20px; }
.summary { display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; margin-bottom: 16px; }
.summary h1 { font-size: 20px; margin: 0; }
.summary .count { font-size: 15px; padding: 4px 10px; border-radius: 999px; background: #2b2416; color: #f4f1e8; }
.contracts { display: grid; gap: 6px; margin-bottom: 16px; }
.contract { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 13px; background: #fffdf7; border: 1px dashed #b9a978; border-radius: 10px; padding: 6px 10px; }
.contract .card { padding: 2px 8px; }
.contract .card h3 { margin: 0; width: auto; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.card { background: #fffdf7; border: 1px solid #d9cfb4; border-radius: 10px; padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.card h3 { width: 100%; margin: 0 0 4px; font-size: 13px; }
.card p.hint, .card small { width: 100%; margin: 0; font-size: 11px; color: #8a7d5c; }
.card .row { display: flex; gap: 6px; flex-wrap: wrap; width: 100%; }
.pill { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #e6e9f5; color: #23306b; }
.pill.positive { background: #dff3e4; color: #1d5c33; }
.pill.caution { background: #fbecd2; color: #7a4a07; }
.pill.legacy { border: 1px dashed #8a7d5c; background: #f1ede2; color: #5c5038; }
.pill.legacy.success { background: #e4efe6; }
.pill.legacy.warning { background: #f6ecd9; }
.pill .hint { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; background: #c0392b; color: #fff; font-size: 10px; font-weight: 700; }
`;

const appComponent = count => {
    const range = Array.from({ length: count }, (_, index) => index + 1);
    const className = index => `Feature${String(index).padStart(3, "0")}Component`;
    return `import { NgComponentOutlet } from "@angular/common";
import { afterNextRender, ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { CardComponent } from "./lib/card.component";
import { PillComponent } from "./lib/pill.component";
${range.map(index => `import { ${className(index)} } from "./features/feature-${index}/feature-${index}.component";`).join("\n")}

@Component({
    selector: "app-root",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ NgComponentOutlet, ${range.map(className).join(", ")} ],
    template: \`
        <div class="page">
            <div class="summary">
                <h1>Pill village</h1>
                <span class="count" data-testid="hint-count">{{ hints() }} pills show a hint</span>
                <span class="count">{{ pills() }} pills</span>
            </div>
            <div class="contracts">
                <div class="contract" data-contract="pill">
                    <span>API contract: <code>&lt;app-pill [tooltip]="true"&gt;</code> shows a hint</span>
                    <ng-container *ngComponentOutlet="pill; inputs: { tooltip: true }" />
                    <b data-testid="contract-pill">{{ pillContract() }}</b>
                </div>
                <div class="contract" data-contract="card">
                    <span>API contract (external consumer): <code>&lt;app-card [{{ cardInputName }}]="true"&gt;</code> has no tooltip</span>
                    <ng-container *ngComponentOutlet="card; inputs: cardInputs" />
                    <b data-testid="contract-card">{{ cardContract() }}</b>
                </div>
            </div>
            <div class="grid">
${range.map(index => `                <app-feature-${index} />`).join("\n")}
            </div>
        </div>
    \`
})
export class AppComponent {
    readonly pill = PillComponent;
    readonly card = CardComponent;
    readonly cardInputName = [ "disable", "Tooltip" ].join("");
    readonly cardInputs = { heading: "Contract", [this.cardInputName]: true };
    readonly hints = signal(0);
    readonly pills = signal(0);
    readonly pillContract = signal("…");
    readonly cardContract = signal("…");

    constructor() {
        afterNextRender(() => {
            this.hints.set(document.querySelectorAll(".grid app-pill .hint").length);
            this.pills.set(document.querySelectorAll(".grid app-pill").length);
            this.pillContract.set(document.querySelector("[data-contract=pill] app-pill .hint") ? "✓ honoured" : "✗ broken");
            const contractCard = document.querySelector("[data-contract=card] .card");
            this.cardContract.set(!contractCard || contractCard.hasAttribute("title") ? "✗ broken" : "✓ honoured");
        });
    }
}
`;
};

function write(base, relPath, content) {
    const target = path.join(ROOT, base, relPath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
}

for (const [ base, after ] of [ [ "fixture", false ], [ "fixture-expected", true ] ]) {
    rmSync(path.join(ROOT, base, "src"), { recursive: true, force: true });
    write(base, "tsconfig.json", JSON.stringify(TSCONFIG, null, 2) + "\n");
    write(base, "tsconfig.app.json", JSON.stringify(TSCONFIG_APP, null, 2) + "\n");
    write(base, "angular.json", JSON.stringify(ANGULAR_JSON, null, 2) + "\n");
    write(base, "src/main.ts", MAIN);
    write(base, "src/index.html", INDEX_HTML);
    write(base, "src/styles.css", STYLES_CSS);
    write(base, "src/app/app.component.ts", appComponent(FEATURES));
    write(base, "src/app/lib/pill.component.ts", pill());
    write(base, "src/app/lib/pill-legacy.component.ts", pillLegacy());
    write(base, "src/app/lib/pill-tone.pipe.ts", pillTonePipe());
    write(base, "src/app/lib/card.component.ts", card());
    for (let index = 1; index <= FEATURES; index++) {
        const inline = index % 4 === 0;
        write(base, `src/app/features/feature-${index}/feature-${index}.component.ts`, featureComponent(index, after, inline));
        if (!inline) write(base, `src/app/features/feature-${index}/feature-${index}.component.html`, featureTemplate(index, after));
    }
}
const pills = Array.from({ length: FEATURES }, (_, index) => STYLE_TEMPLATES[styleOf(index + 1)](index + 1, false).join("\n").match(/<app-pill[\s>]/g)?.length ?? 0).reduce((sum, count) => sum + count, 0);
console.log(`fixture/ (library v2, consumers v1) and fixture-expected/ (migrated): ${FEATURES} features in ${STYLES} template styles, ${pills} <app-pill> elements to migrate, ${Array.from({ length: FEATURES }, (_, index) => needsPipeAfter(index + 1)).filter(Boolean).length} need PillTonePipe imported, <app-card> and <app-pill-legacy> decoys`);
