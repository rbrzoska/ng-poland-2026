// Generates the "Gaul, 50 BC" map app: a magnifier over the map shows the Gaulish village, while the Roman garrisons
// are declared with the TentComponent v1 API, which the v2 map no longer draws (gaul/fixture/). gaul/fixture-expected/
// is the migrated twin where every tent shows up. Same migration shape as the Pill scenario, so ng-facts runs it from a spec.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const GARRISONS = Number(process.env.GARRISONS ?? 120);
const ROOT = import.meta.dirname;
const SITES = JSON.parse(readFileSync(path.join(ROOT, "sites.json"), "utf8"));
const VILLAGE = { x: 140, y: 528 };

const OUTPOSTS = [
    { name: "Totorum", unit: "auxilia", cloth: "yellow", site: { x: 150, y: 628 }, hasEagle: true },
    { name: "Aquarium", unit: "legio", cloth: "red-white", site: { x: 102, y: 590 }, hasEagle: false },
    { name: "Laudanum", unit: "equites", cloth: "yellow-white", site: { x: 205, y: 582 }, hasEagle: false },
    { name: "Compendium", unit: "praetoria", cloth: "red-yellow", site: { x: 222, y: 512 }, hasEagle: true }
];

const STEMS = [ "Castell", "Fort", "Vall", "Lup", "Ferr", "Prat", "Mont", "Pont", "Sax", "Turr", "Vill", "Silv", "Coll", "Port", "Sol", "Ven", "Font", "Rot", "Cal", "Dur" ];
const ENDINGS = [ "um", "ium", "orum", "anum", "icum", "ellum" ];
const garrisonName = index => STEMS[index % STEMS.length] + ENDINGS[Math.floor(index / STEMS.length) % ENDINGS.length] + (index >= STEMS.length * ENDINGS.length ? ` ${roman(Math.floor(index / (STEMS.length * ENDINGS.length)) + 1)}` : "");

function roman(value) {
    const digits = [ [ 10, "X" ], [ 9, "IX" ], [ 5, "V" ], [ 4, "IV" ], [ 1, "I" ] ];
    let result = "";
    for (const [ amount, letters ] of digits) while (value >= amount) { result += letters; value -= amount; }
    return result;
}

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

const TSCONFIG_APP = { extends: "./tsconfig.json", compilerOptions: { noEmit: false, outDir: "./out-tsc/app" }, files: [ "src/main.ts" ], include: [] };

const ANGULAR_JSON = {
    $schema: "../../node_modules/@angular/cli/lib/config/schema.json",
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
                    options: { browser: "src/main.ts", index: "src/index.html", tsConfig: "tsconfig.app.json", styles: [ "src/styles.css" ], assets: [ { glob: "**/*", input: "public" } ], outputPath: "dist", optimization: true, sourceMap: false, outputHashing: "all" },
                    configurations: { development: { optimization: false, sourceMap: true, outputHashing: "none" } }
                },
                serve: {
                    builder: "@angular/build:dev-server",
                    options: { buildTarget: "demo:build:development" }
                }
            }
        }
    }
};

const MAIN = `import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, { providers: [ provideZonelessChangeDetection() ] }).catch(error => console.error(error));
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Gaul, 50 BC</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <app-root></app-root>
</body>
</html>
`;

const STYLES = `:root { color-scheme: light; --ink: #2b2416; --paper: #f4ecd4; --gold: #f3d34a; --roman: #b3201a; }
body { margin: 0; background: #d9cfb0; color: var(--ink); font-family: Georgia, "Times New Roman", serif; }
.page { min-height: 100dvh; box-sizing: border-box; padding: 16px; display: flex; gap: 24px; align-items: center; justify-content: center; }
app-gaul-map { display: block; flex: none; }
.board { position: relative; height: min(calc(100dvh - 32px), calc((100vw - 380px) * 1.419)); aspect-ratio: 1184 / 1680; overflow: hidden; touch-action: none; cursor: crosshair; user-select: none; box-shadow: 0 12px 40px rgb(43 36 22 / 0.35); outline: none; }
.board:focus-visible { box-shadow: 0 0 0 3px var(--roman), 0 12px 40px rgb(43 36 22 / 0.35); }
.board > .map { display: block; width: 100%; height: 100%; }
.lens { position: absolute; border-radius: 50%; overflow: hidden; transform: translate(-50%, -50%); pointer-events: none; background: #bfe0ee; }
.lens-view { position: absolute; left: 0; top: 0; width: 1184px; height: 1680px; transform-origin: 0 0; }
.lens-view > img { position: absolute; inset: 0; width: 100%; height: 100%; }
.frame { position: absolute; pointer-events: none; filter: drop-shadow(4px 8px 6px rgb(0 0 0 / 0.35)); }
.caption { position: absolute; left: 0; bottom: 0; width: 58%; margin: 0; padding: 12px 14px; box-sizing: border-box; background: #fff; font: 13px/1.4 system-ui, sans-serif; }
.village { position: absolute; transform: translate(-50%, -50%); display: grid; justify-items: center; }
.village img { width: 84px; display: block; }
.village-name { margin-top: -4px; font: 700 8px/1 Georgia, serif; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink); text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
.camp { position: absolute; transform: translate(-50%, -50%); width: 78px; display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-end; gap: 2px 4px; }
.tent { position: relative; display: grid; justify-items: center; }
.tent img { height: 28px; display: block; }
.tent-name { margin-top: 1px; padding: 0 2px; background: var(--gold); border: 0.5px solid var(--ink); font: 700 6px/1.2 Georgia, serif; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; }
.tent-name:empty { display: none; }
.vexillum { position: absolute; left: 56%; top: -9px; width: 1.2px; height: 14px; background: #6b4a1d; }
.vexillum::after { content: ""; position: absolute; left: 1.2px; top: 1px; width: 8px; height: 6px; background: var(--roman); border: 0.5px solid #e0b44a; }
.signum { position: absolute; left: 50%; top: -18px; width: 2px; height: 22px; background: #c9a227; }
.signum::before { content: ""; position: absolute; left: -4px; top: 0; width: 10px; height: 7px; background: var(--roman); border: 1px solid #c9a227; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.panel { width: 320px; display: grid; gap: 14px; }
.panel h1 { margin: 0; font-size: 26px; letter-spacing: 0.02em; }
.panel p { margin: 0; }
.tally { font-size: 15px; }
.tally b { font-size: 30px; color: var(--roman); }
.hint { font: 13px/1.4 system-ui, sans-serif; color: #5c5038; }
.contract { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; padding: 8px 10px; background: var(--paper); border: 1px dashed #a8976a; border-radius: 8px; font: 12px/1.35 system-ui, sans-serif; }
.contract-stage { position: relative; display: grid; place-items: center; width: 40px; height: 40px; }
.contract-stage .camp { left: 50%; top: 60%; width: auto; }
@media (max-width: 860px) {
    .page { flex-direction: column; }
    .board { height: auto; width: calc(100vw - 32px); }
    .panel { width: calc(100vw - 32px); }
    .caption { font-size: 11px; padding: 8px 10px; }
}
`;

const mapPoint = () => `export interface MapPoint {
    readonly x: number;
    readonly y: number;
}
`;

const gaulMap = () => `import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, linkedSignal, signal, viewChild } from "@angular/core";
import type { MapPoint } from "./map-point";

const MAP = { width: 1184, height: 1680 };
const FRAME = { width: 800, centerX: 466, centerY: 334.7, innerRadius: 297.6 };
const ZOOM = 2.6;
const LENS_SHARE = 0.42;
const KEY_STEPS: Record<string, MapPoint> = { ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 }, ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 } };

@Component({
    selector: "app-gaul-map",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`
        <div #board class="board" tabindex="0" (pointerdown)="follow($event)" (pointermove)="follow($event)" (keydown)="nudge($event)">
            <img class="map" src="map.webp" alt="Map of Gaul, 50 BC" draggable="false" />
            <ng-content select=".overlay" />
            <div class="lens" [style.left.px]="lens().x" [style.top.px]="lens().y" [style.width.px]="lens().diameter" [style.height.px]="lens().diameter">
                <div class="lens-view" [style.transform]="lens().transform">
                    <img src="map.webp" alt="" draggable="false" />
                    <ng-content />
                </div>
            </div>
            <img class="frame" src="magnifier.webp" alt="" draggable="false" [style.left.px]="lens().frameLeft" [style.top.px]="lens().frameTop" [style.width.px]="lens().frameWidth" />
        </div>
    \`
})
export class GaulMapComponent {
    readonly start = input<MapPoint>({ x: MAP.width / 2, y: MAP.height / 2 });

    private readonly board = viewChild.required<ElementRef<HTMLElement>>("board");
    private readonly width = signal(0);
    private readonly focus = linkedSignal(() => this.start());

    protected readonly lens = computed(() => {
        const scale = this.width() / MAP.width;
        const zoom = scale * ZOOM;
        const diameter = Math.round(this.width() * LENS_SHARE);
        const frameScale = (diameter / 2) * 0.98 / FRAME.innerRadius;
        const { x, y } = this.focus();
        return {
            x: x * scale,
            y: y * scale,
            diameter,
            transform: \`translate(\${diameter / 2 - x * zoom}px, \${diameter / 2 - y * zoom}px) scale(\${zoom})\`,
            frameLeft: x * scale - FRAME.centerX * frameScale,
            frameTop: y * scale - FRAME.centerY * frameScale,
            frameWidth: FRAME.width * frameScale
        };
    });

    constructor() {
        const destroyRef = inject(DestroyRef);
        afterNextRender(() => {
            const element = this.board().nativeElement;
            const observer = new ResizeObserver(() => this.width.set(element.clientWidth));
            observer.observe(element);
            destroyRef.onDestroy(() => observer.disconnect());
        });
    }

    protected follow(event: PointerEvent): void {
        const rect = this.board().nativeElement.getBoundingClientRect();
        const scale = rect.width / MAP.width;
        this.moveTo({ x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale });
    }

    protected nudge(event: KeyboardEvent): void {
        const step = KEY_STEPS[event.key];
        if (!step) return;
        event.preventDefault();
        this.moveTo({ x: this.focus().x + step.x, y: this.focus().y + step.y });
    }

    private moveTo(point: MapPoint): void {
        this.focus.set({ x: Math.min(MAP.width, Math.max(0, point.x)), y: Math.min(MAP.height, Math.max(0, point.y)) });
    }
}
`;

const village = () => `import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import type { MapPoint } from "./map-point";

@Component({
    selector: "app-village",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<div class="village" [style.left.px]="at().x" [style.top.px]="at().y"><img src="village.webp" alt="" /><span class="village-name">{{ label() }}</span></div>\`
})
export class VillageComponent {
    readonly at = input.required<MapPoint>();
    readonly label = input("");
}
`;

const camp = () => `import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import type { MapPoint } from "./map-point";

@Component({
    selector: "app-camp",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<div class="camp" [style.left.px]="at().x" [style.top.px]="at().y">@if (!hideFlag()) {<span class="signum"></span>}<ng-content /></div>\`
})
export class CampComponent {
    readonly at = input.required<MapPoint>();
    readonly hideFlag = input(false);
}
`;

const tent = () => `import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

export type TentCloth = "red-white" | "yellow" | "yellow-white" | "red-yellow";

/** v1 values, kept so existing fields still compile — map them with TentClothPipe. */
export type TentUnit = "legio" | "auxilia" | "equites" | "praetoria";

/**
 * v2: a tent is drawn from its \`cloth\`, flies a vexillum when \`flag\` is set and shows its projected content as the name.
 * The v1 inputs still compile for one release, but the v2 map does not draw tents declared with them.
 */
@Component({
    selector: "app-tent",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`@if (image(); as source) {<span class="tent"><img [src]="source" alt="" />@if (flag()) {<span class="vexillum"></span>}<span class="tent-name"><ng-content /></span></span>}\`
})
export class TentComponent {
    readonly cloth = input<TentCloth>();
    readonly flag = input(false);
    /** @deprecated v1, ignored by the v2 map — use \`cloth\`. */
    readonly unit = input<TentUnit>();
    /** @deprecated v1, ignored by the v2 map — use \`flag\` (inverted). */
    readonly hideFlag = input(false);
    /** @deprecated v1, ignored by the v2 map — project the name as content. */
    readonly label = input("");

    protected readonly image = computed(() => {
        const cloth = this.cloth();
        return cloth ? \`tents/\${cloth}.webp\` : null;
    });
}
`;

const tentClothPipe = () => `import { Pipe, type PipeTransform } from "@angular/core";
import type { TentCloth, TentUnit } from "./tent.component";

const CLOTHS: Record<TentUnit, TentCloth> = { legio: "red-white", auxilia: "yellow", equites: "yellow-white", praetoria: "red-yellow" };

@Pipe({ name: "tentCloth" })
export class TentClothPipe implements PipeTransform {
    transform(unit: TentUnit): TentCloth {
        return CLOTHS[unit];
    }
}
`;

const isOutpost = index => index <= OUTPOSTS.length;
const usesFieldUnit = index => !isOutpost(index) && index % 2 === 0;

function outpostTemplate(index, after) {
    const { name, unit, cloth } = OUTPOSTS[index - 1];
    return [
        `<app-camp [at]="site" [hideFlag]="true">`,
        after ? `    <app-tent cloth="${cloth}" [flag]="hasEagle">${name}</app-tent>` : `    <app-tent label="${name}" unit="${unit}" [hideFlag]="!hasEagle" />`,
        `</app-camp>`
    ].join("\n") + "\n";
}

function garrisonTemplate(index, after) {
    const name = garrisonName(index - OUTPOSTS.length - 1);
    const numeral = roman((index % 30) + 1);
    const nested = usesFieldUnit(index)
        ? (after ? `<app-tent [cloth]="reserveUnit | tentCloth" [flag]="false" />` : `<app-tent [unit]="reserveUnit" [hideFlag]="true" />`)
        : (after ? `<app-tent cloth="yellow-white" [flag]="false" />` : `<app-tent unit="equites" [hideFlag]="true" />`);
    return [
        `<app-camp [at]="site" [hideFlag]="true">`,
        `    <span class="sr-only">Set hideFlag on a tent to strike its vexillum.</span>`,
        after ? `    <app-tent cloth="red-yellow" [flag]="true">${name}</app-tent>` : `    <app-tent label="${name}" unit="praetoria" [hideFlag]="false" />`,
        after ? `    <app-tent cloth="red-white" [flag]="isCommand" />` : `    <app-tent unit="legio" [hideFlag]="!isCommand" />`,
        after ? `    <app-tent cloth="yellow" [flag]="!(cohorts > 3)">{{ motto }}</app-tent>` : `    <app-tent [label]="motto" unit="auxilia" [hideFlag]="cohorts > 3" />`,
        `    <app-tent`,
        after ? `        [cloth]="isCommand ? 'red-white' : 'yellow-white'"` : `        [unit]="isCommand ? 'legio' : 'equites'"`,
        ...(after ? [ `        [flag]="!isCommand">${numeral}</app-tent>` ] : [ `        label="${numeral}"`, `        [hideFlag]="isCommand">`, `    </app-tent>` ]),
        `    @if (isGarrisoned) {`,
        `        ${nested}`,
        `    }`,
        `    @if (hideFlag) {`,
        `        <span class="sr-only">Own field, unrelated to the tent input</span>`,
        `    }`,
        `</app-camp>`
    ].join("\n") + "\n";
}

const template = (index, after) => isOutpost(index) ? outpostTemplate(index, after) : garrisonTemplate(index, after);
const className = index => `Garrison${String(index).padStart(3, "0")}Component`;
const siteOf = index => {
    if (isOutpost(index)) return OUTPOSTS[index - 1].site;
    const [ x, y ] = SITES[(index - OUTPOSTS.length - 1) % SITES.length];
    return { x, y };
};

function garrisonComponent(index, after, inline) {
    const needsPipe = after && usesFieldUnit(index);
    const site = siteOf(index);
    const templateField = inline
        ? `    template: \`\n${template(index, after).replace(/^/gm, "        ").trimEnd()}\n    \``
        : `    templateUrl: "./garrison-${index}.component.html"`;
    const fields = isOutpost(index)
        ? [ `    hasEagle = ${OUTPOSTS[index - 1].hasEagle};` ]
        : [
            `    isCommand = ${index % 2 === 0};`,
            `    cohorts = ${index % 7};`,
            `    hideFlag = ${index % 2 === 1};`,
            `    isGarrisoned = ${index % 3 !== 0};`,
            `    motto = "${index % 5 === 0 ? "SPQR" : ""}";`,
            `    reserveUnit: TentUnit = "${index % 4 === 0 ? "praetoria" : "auxilia"}";`
        ];
    return `import { ChangeDetectionStrategy, Component } from "@angular/core";
import { CampComponent } from "../../lib/camp.component";
import type { MapPoint } from "../../lib/map-point";
import { TentComponent, type TentUnit } from "../../lib/tent.component";${needsPipe ? `\nimport { TentClothPipe } from "../../lib/tent-cloth.pipe";` : ""}

@Component({
    selector: "app-garrison-${index}",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ CampComponent, TentComponent${needsPipe ? ", TentClothPipe" : ""} ],
${templateField}
})
export class ${className(index)} {
    readonly site: MapPoint = { x: ${site.x}, y: ${site.y} };
${fields.join("\n")}
}
`;
}

const appComponent = count => {
    const range = Array.from({ length: count }, (_, index) => index + 1);
    return `import { NgComponentOutlet } from "@angular/common";
import { afterNextRender, ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { CampComponent } from "./lib/camp.component";
import { GaulMapComponent } from "./lib/gaul-map.component";
import type { MapPoint } from "./lib/map-point";
import { TentComponent } from "./lib/tent.component";
import { VillageComponent } from "./lib/village.component";
${range.map(index => `import { ${className(index)} } from "./features/garrison-${index}/garrison-${index}.component";`).join("\n")}

@Component({
    selector: "app-root",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ NgComponentOutlet, GaulMapComponent, VillageComponent, ${range.map(className).join(", ")} ],
    template: \`
        <div class="page">
            <app-gaul-map [start]="lookout">
                <p class="overlay caption">50 BC. Gaul is entirely occupied by the Romans. Well, not entirely… or so this map would have you believe. Move the magnifier around.</p>
                <app-village [at]="village" label="Gaulish village" />
${range.map(index => `                <app-garrison-${index} />`).join("\n")}
            </app-gaul-map>
            <aside class="panel">
                <h1>Gaul, 50 BC</h1>
                <p class="tally" data-testid="tent-count"><b>{{ drawn() }}</b> of {{ declared() }} Roman tents on the map</p>
                <p class="tally" data-testid="flag-count"><b>{{ flags() }}</b> vexilla raised</p>
                <p class="hint">Move the mouse, drag a finger or use the arrow keys to slide the magnifier across Gaul.</p>
                <div class="contract" data-contract="tent">
                    <span>API contract: <code>&lt;app-tent [flag]="true"&gt;</code> raises a vexillum</span>
                    <span class="contract-stage"><ng-container *ngComponentOutlet="tent; inputs: tentInputs" /></span>
                    <b data-testid="contract-tent">{{ tentContract() }}</b>
                </div>
                <div class="contract" data-contract="camp">
                    <span>API contract (external consumer): <code>&lt;app-camp [{{ campInputName }}]="true"&gt;</code> plants no signum</span>
                    <span class="contract-stage"><ng-container *ngComponentOutlet="camp; inputs: campInputs" /></span>
                    <b data-testid="contract-camp">{{ campContract() }}</b>
                </div>
            </aside>
        </div>
    \`
})
export class AppComponent {
    readonly village: MapPoint = { x: ${VILLAGE.x}, y: ${VILLAGE.y} };
    readonly lookout: MapPoint = { x: 158, y: 566 };
    readonly tent = TentComponent;
    readonly camp = CampComponent;
    readonly tentInputs = { cloth: "red-white", flag: true };
    readonly campInputName = [ "hide", "Flag" ].join("");
    readonly campInputs = { at: { x: 0, y: 0 }, [this.campInputName]: true };
    readonly drawn = signal(0);
    readonly declared = signal(0);
    readonly flags = signal(0);
    readonly tentContract = signal("…");
    readonly campContract = signal("…");

    constructor() {
        afterNextRender(() => {
            this.drawn.set(document.querySelectorAll(".lens-view app-tent .tent").length);
            this.declared.set(document.querySelectorAll(".lens-view app-tent").length);
            this.flags.set(document.querySelectorAll(".lens-view app-tent .vexillum").length);
            this.tentContract.set(document.querySelector("[data-contract=tent] .vexillum") ? "✓ honoured" : "✗ broken");
            this.campContract.set(document.querySelector("[data-contract=camp] .signum") ? "✗ broken" : "✓ honoured");
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
    rmSync(path.join(ROOT, base, "public"), { recursive: true, force: true });
    cpSync(path.join(ROOT, "assets"), path.join(ROOT, base, "public"), { recursive: true });
    write(base, "tsconfig.json", JSON.stringify(TSCONFIG, null, 2) + "\n");
    write(base, "tsconfig.app.json", JSON.stringify(TSCONFIG_APP, null, 2) + "\n");
    write(base, "angular.json", JSON.stringify(ANGULAR_JSON, null, 2) + "\n");
    write(base, "src/main.ts", MAIN);
    write(base, "src/index.html", INDEX_HTML);
    write(base, "src/styles.css", STYLES);
    write(base, "src/app/app.component.ts", appComponent(GARRISONS));
    write(base, "src/app/lib/map-point.ts", mapPoint());
    write(base, "src/app/lib/gaul-map.component.ts", gaulMap());
    write(base, "src/app/lib/village.component.ts", village());
    write(base, "src/app/lib/camp.component.ts", camp());
    write(base, "src/app/lib/tent.component.ts", tent());
    write(base, "src/app/lib/tent-cloth.pipe.ts", tentClothPipe());
    for (let index = 1; index <= GARRISONS; index++) {
        const inline = index % 4 === 0;
        write(base, `src/app/features/garrison-${index}/garrison-${index}.component.ts`, garrisonComponent(index, after, inline));
        if (!inline) write(base, `src/app/features/garrison-${index}/garrison-${index}.component.html`, template(index, after));
    }
}

const garrisons = GARRISONS - OUTPOSTS.length;
const tents = OUTPOSTS.length + garrisons * 5;
console.log(`gaul/fixture/ (tents on the v1 API, not drawn) and gaul/fixture-expected/ (migrated): ${GARRISONS} garrisons (${OUTPOSTS.length} outposts around the village), ${tents} <app-tent> elements in templates, ${Math.floor(garrisons / 2)} need TentClothPipe imported`);
