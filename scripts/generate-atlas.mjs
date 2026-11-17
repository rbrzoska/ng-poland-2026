// Generates atlas/: a routed Angular app (a Roman camp admin, one feature area per province) used by the two tasks that are
// not a component migration — "which routes show this component?" and "label every icon button". The answer key
// (atlas-key.json, next to the workspace, never inside it) comes from the model below, not from the generated text.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.env.OUT ?? path.resolve(import.meta.dirname, "..");
const BASE = path.join(ROOT, "atlas");
const PROVINCES = [ "gallia", "britannia", "hispania", "germania", "aegyptus", "graecia", "dacia", "syria" ].slice(0, Number(process.env.PROVINCES ?? 8));

const pascal = text => text.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join("");

const WIDGET_CHILDREN = {
    tent: [],
    "tent-row": [ "tent" ],
    "tent-list": [ "tent-row" ],
    standard: [],
    "legion-card": [ "standard" ],
    "legion-roster": [ "legion-card" ],
    ration: [],
    "supply-table": [ "ration" ],
    toolbar: [],
    helmet: [],
    eagle: []
};

const ICONS = [
    { icon: "plus", handler: "add", words: "add|new|create" },
    { icon: "refresh", handler: "reload", words: "refresh|reload|update" },
    { icon: "trash", handler: "remove", words: "remove|delete|trash|discard" },
    { icon: "pencil", handler: "edit", words: "edit|rename|change|modify" },
    { icon: "search", handler: "find", words: "search|find|look" },
    { icon: "close", handler: "dismiss", words: "close|dismiss|hide|cancel" },
    { icon: "download", handler: "exportData", words: "export|download|save" },
    { icon: "flag", handler: "report", words: "flag|report|mark" }
];
const LABEL_STATES = [ "missing", "static", "missing-multiline", "bound", "static-multiline" ];

/** The pages of province number `index`: route path (null = not routed), parent route, the widgets its template renders. */
function pagesOf(index) {
    return [
        { key: "camps", path: "camps", widgets: [ "toolbar", "tent-list" ] },
        { key: "camp-detail", path: "camps/:id", lazy: true, widgets: [ "toolbar", "tent-row", ...(index % 4 !== 1 ? [ "supply-table" ] : []) ] },
        { key: "legions", path: "legions", widgets: [ "toolbar", "legion-roster" ] },
        { key: "legion-detail", path: "legions/:id", lazy: true, widgets: [ "legion-card", ...(index % 3 !== 0 ? [ "tent-list" ] : []) ] },
        { key: "supplies", path: "supplies", lazy: true, widgets: [ "toolbar", "supply-table" ] },
        { key: "map", path: "map", widgets: [ ...(index % 2 === 0 ? [ "tent" ] : []), "standard" ], decoyComment: index % 2 === 0 ? null : "<app-tent> pins were removed from this map" },
        { key: "reports", path: "reports", widgets: [ "toolbar" ], outlet: true },
        { key: "report-daily", path: "daily", parent: "reports", widgets: [ "legion-roster", ...(index % 2 === 1 ? [ "supply-table" ] : []) ] },
        { key: "report-losses", path: "losses", parent: "reports", widgets: [ index % 3 !== 1 ? "tent-list" : "supply-table" ], conditional: true },
        { key: "settings", path: "settings", widgets: [ "toolbar" ], unusedImport: "helmet", decoyString: "Rations are shown with <app-ration> on the supplies page" },
        { key: "archive", path: index % 4 === 3 ? "archive" : null, widgets: [ "helmet", "tent-list" ] }
    ];
}

function closure(widgets) {
    const seen = new Set();
    const visit = name => {
        if (seen.has(name)) return;
        seen.add(name);
        WIDGET_CHILDREN[name].forEach(visit);
    };
    widgets.forEach(visit);
    return seen;
}

const pageClass = (province, key) => `${pascal(province)}${pascal(key)}PageComponent`;
const widgetClass = name => `${pascal(name)}Component`;

/** Label state of button `slot` on page `pageIndex` of province `index` — spread so every state appears in every province. */
const buttonsOf = (index, pageIndex) => [ 0, 1 ].map(slot => ({
    ...ICONS[(index + pageIndex * 3 + slot * 5) % ICONS.length],
    state: LABEL_STATES[(index * 3 + pageIndex * 2 + slot) % LABEL_STATES.length]
}));

function iconButton(button, indent, subject) {
    const pad = " ".repeat(indent);
    const label = `${pascal(button.handler === "exportData" ? "export" : button.handler)} ${subject}`;
    const press = `(press)="${button.handler}()"`;
    if (button.state === "missing") return [ `${pad}<app-icon-button icon="${button.icon}" ${press} />` ];
    if (button.state === "static") return [ `${pad}<app-icon-button icon="${button.icon}" label="${label}" ${press} />` ];
    if (button.state === "bound") return [ `${pad}<app-icon-button icon="${button.icon}" [label]="actionLabel" ${press}></app-icon-button>` ];
    return [
        `${pad}<app-icon-button`,
        `${pad}    icon="${button.icon}"`,
        ...(button.state === "static-multiline" ? [ `${pad}    label="${label}"` ] : []),
        `${pad}    ${press}`,
        `${pad}/>`
    ];
}

const widgetTag = (name, indent) => {
    const pad = " ".repeat(indent);
    const inputs = { tent: ` name="Praetorium"`, "tent-row": ` name="Praetorium"`, standard: ` legion="X Fretensis"`, "legion-card": ` legion="X Fretensis"`, ration: ` [grain]="12"` };
    return `${pad}<app-${name}${inputs[name] ?? ""} />`;
};

function pageTemplate(province, index, page, pageIndex) {
    const title = `${pascal(page.key).replace(/([a-z])([A-Z])/g, "$1 $2")} of ${pascal(province)}`;
    const widgets = page.widgets.map(name => widgetTag(name, page.conditional ? 8 : 4));
    return [
        `<app-panel label="${title}">`,
        `    <app-icon-button-group>`,
        ...buttonsOf(index, pageIndex).flatMap(button => iconButton(button, 8, page.key.replace("-", " "))),
        `    </app-icon-button-group>`,
        `    <button type="button" aria-label="Show or hide details" (click)="expanded = !expanded">?</button>`,
        ...(page.decoyComment ? [ `    <!-- ${page.decoyComment} -->` ] : []),
        ...(page.conditional ? [ `    @if (expanded) {`, ...widgets, `    }` ] : widgets),
        ...(page.outlet ? [ `    <router-outlet />` ] : []),
        `</app-panel>`
    ].join("\n") + "\n";
}

function pageComponent(province, index, page, pageIndex) {
    const inline = (index + pageIndex) % 3 === 0;
    const template = pageTemplate(province, index, page, pageIndex);
    const widgets = [ ...new Set([ ...page.widgets, ...(page.unusedImport ? [ page.unusedImport ] : []) ]) ];
    const handlers = [ ...new Set(buttonsOf(index, pageIndex).map(button => button.handler)) ];
    const imports = [ "PanelComponent", "IconButtonComponent", "IconButtonGroupComponent", ...widgets.map(widgetClass), ...(page.outlet ? [ "RouterOutlet" ] : []) ];
    return `import { ChangeDetectionStrategy, Component } from "@angular/core";${page.outlet ? `\nimport { RouterOutlet } from "@angular/router";` : ""}
import { IconButtonGroupComponent } from "../../ui/icon-button-group.component";
import { IconButtonComponent } from "../../ui/icon-button.component";
import { PanelComponent } from "../../ui/panel.component";
${widgets.map(name => `import { ${widgetClass(name)} } from "../../widgets/${name}.component";`).join("\n")}

@Component({
    selector: "app-${province}-${page.key}-page",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ ${imports.join(", ")} ],
${inline ? `    template: \`\n${template.replace(/^/gm, "        ").trimEnd()}\n    \`` : `    templateUrl: "./${page.key}.page.html"`}
})
export class ${pageClass(province, page.key)} {
    readonly actionLabel = "Act on ${page.key.replace("-", " ")}";
    expanded = ${index % 2 === 0};${page.decoyString ? `\n    readonly hint = "${page.decoyString}";` : ""}
${handlers.map(name => `    ${name}(): void {}`).join("\n")}
}
`;
}

function provinceRoutes(province, index) {
    const pages = pagesOf(index);
    const entry = page => {
        const target = page.lazy
            ? `loadComponent: () => import("./${page.key}.page").then(module => module.${pageClass(province, page.key)})`
            : `component: ${pageClass(province, page.key)}`;
        const children = pages.filter(child => child.parent === page.key && child.path !== null);
        return `{ path: "${page.path}", ${target}${children.length ? `, children: [ ${children.map(entry).join(", ")} ]` : ""} }`;
    };
    const routed = pages.filter(page => page.path !== null);
    return `import type { Routes } from "@angular/router";
${routed.filter(page => !page.lazy).map(page => `import { ${pageClass(province, page.key)} } from "./${page.key}.page";`).join("\n")}

export const ${province.toUpperCase()}_ROUTES: Routes = [
${routed.filter(page => !page.parent).map(page => `    ${entry(page)}`).join(",\n")}
];
`;
}

const APP_ROUTES = () => `import type { Routes } from "@angular/router";
${PROVINCES.filter((_province, index) => index % 2 === 0).map(province => `import { ${province.toUpperCase()}_ROUTES } from "./provinces/${province}/${province}.routes";`).join("\n")}

export const routes: Routes = [
    { path: "", pathMatch: "full", redirectTo: "${PROVINCES[0]}/camps" },
${PROVINCES.map((province, index) => index % 2 === 0
        ? `    { path: "${province}", children: ${province.toUpperCase()}_ROUTES }`
        : `    { path: "${province}", loadChildren: () => import("./provinces/${province}/${province}.routes").then(module => module.${province.toUpperCase()}_ROUTES) }`).join(",\n")}
];
`;

const component = (selector, className, body, template, imports = [], importLines = []) => `import { ChangeDetectionStrategy, Component${/\binput\b/.test(body) ? ", input" : ""}${/\boutput\b/.test(body) ? ", output" : ""} } from "@angular/core";
${importLines.join("\n")}${importLines.length ? "\n" : ""}
@Component({
    selector: "${selector}",
    changeDetection: ChangeDetectionStrategy.OnPush,${imports.length ? `\n    imports: [ ${imports.join(", ")} ],` : ""}
    template: \`${template}\`
})
export class ${className} {${body ? `\n${body}\n` : ""}}
`;

const ui = (file, name) => `import { ${name} } from "../ui/${file}.component";`;
const widget = name => `import { ${widgetClass(name)} } from "./${name}.component";`;

const FILES = {
    "src/app/ui/icon.component.ts": component("app-icon", "IconComponent", `    readonly name = input.required<string>();`, `<span class="icon" aria-hidden="true">{{ name() }}</span>`),
    "src/app/ui/icon-button.component.ts": component("app-icon-button", "IconButtonComponent",
        `    readonly icon = input.required<string>();\n    /** The accessible name: an icon alone says nothing to a screen reader. */\n    readonly label = input("");\n    readonly press = output<void>();`,
        `<button type="button" [attr.aria-label]="label() || null" (click)="press.emit()"><app-icon [name]="icon()" /></button>`,
        [ "IconComponent" ], [ `import { IconComponent } from "./icon.component";` ]),
    "src/app/ui/icon-button-group.component.ts": component("app-icon-button-group", "IconButtonGroupComponent", "", `<div class="group" role="group"><ng-content /></div>`),
    "src/app/ui/panel.component.ts": component("app-panel", "PanelComponent", `    readonly label = input("");`, `<section class="panel"><h2>{{ label() }}</h2><ng-content /></section>`),
    "src/app/widgets/tent.component.ts": component("app-tent", "TentComponent", `    readonly name = input("");`, `<span class="tent">{{ name() }}</span>`),
    "src/app/widgets/tent-row.component.ts": component("app-tent-row", "TentRowComponent",
        `    readonly name = input("");\n    edit(): void {}\n    remove(): void {}`,
        `<div class="row"><app-tent [name]="name()" /><app-icon-button icon="pencil" label="Rename tent" (press)="edit()" /><app-icon-button icon="trash" (press)="remove()" /></div>`,
        [ "TentComponent", "IconButtonComponent" ], [ ui("icon-button", "IconButtonComponent"), widget("tent") ]),
    "src/app/widgets/tent-list.component.ts": component("app-tent-list", "TentListComponent",
        `    readonly tents = [ "Praetorium", "Quaestorium", "Valetudinarium" ];\n    add(): void {}`,
        `\n        @for (tent of tents; track tent) {\n            <app-tent-row [name]="tent" />\n        }\n        <app-icon-button\n            icon="plus"\n            (press)="add()"\n        />\n    `,
        [ "TentRowComponent", "IconButtonComponent" ], [ ui("icon-button", "IconButtonComponent"), widget("tent-row") ]),
    "src/app/widgets/standard.component.ts": component("app-standard", "StandardComponent", `    readonly legion = input("");`, `<span class="standard">{{ legion() }}</span>`),
    "src/app/widgets/legion-card.component.ts": component("app-legion-card", "LegionCardComponent",
        `    readonly legion = input("");\n    report(): void {}`,
        `<app-panel [label]="legion()"><app-standard [legion]="legion()" /><app-icon-button icon="flag" label="Report legion" (press)="report()" /></app-panel>`,
        [ "PanelComponent", "StandardComponent", "IconButtonComponent" ], [ ui("icon-button", "IconButtonComponent"), ui("panel", "PanelComponent"), widget("standard") ]),
    "src/app/widgets/legion-roster.component.ts": component("app-legion-roster", "LegionRosterComponent",
        `    readonly legions = [ "X Fretensis", "XIII Gemina" ];`,
        `@for (legion of legions; track legion) { <app-legion-card [legion]="legion" /> }`,
        [ "LegionCardComponent" ], [ widget("legion-card") ]),
    "src/app/widgets/ration.component.ts": component("app-ration", "RationComponent", `    readonly grain = input(0);`, `<span class="ration">{{ grain() }} modii</span>`),
    "src/app/widgets/supply-table.component.ts": component("app-supply-table", "SupplyTableComponent",
        `    readonly rows = [ 12, 30, 7 ];\n    exportData(): void {}`,
        `\n        <ul>\n            @for (row of rows; track row) {\n                <li><app-ration [grain]="row" /></li>\n            }\n        </ul>\n        <app-icon-button icon="download" (press)="exportData()" />\n    `,
        [ "RationComponent", "IconButtonComponent" ], [ ui("icon-button", "IconButtonComponent"), widget("ration") ]),
    "src/app/widgets/toolbar.component.ts": component("app-toolbar", "ToolbarComponent",
        `    find(): void {}\n    reload(): void {}\n    dismiss(): void {}`,
        `\n        <app-icon-button-group>\n            <app-icon-button icon="search" label="Search" (press)="find()" />\n            <app-icon-button icon="refresh" (press)="reload()" />\n            <app-icon-button\n                icon="close"\n                (press)="dismiss()"\n            />\n        </app-icon-button-group>\n    `,
        [ "IconButtonComponent", "IconButtonGroupComponent" ], [ ui("icon-button-group", "IconButtonGroupComponent"), ui("icon-button", "IconButtonComponent") ]),
    "src/app/widgets/helmet.component.ts": component("app-helmet", "HelmetComponent", "", `<span class="helmet">galea</span>`),
    "src/app/widgets/eagle.component.ts": component("app-eagle", "EagleComponent", "", `<span class="eagle">aquila</span>`),
    "src/app/old-dashboard.page.ts": component("app-old-dashboard-page", "OldDashboardPageComponent", "",
        `<app-legion-roster /><app-eagle /><app-ration [grain]="3" />`,
        [ "LegionRosterComponent", "EagleComponent", "RationComponent" ],
        [ `import { EagleComponent } from "./widgets/eagle.component";`, `import { LegionRosterComponent } from "./widgets/legion-roster.component";`, `import { RationComponent } from "./widgets/ration.component";` ]),
    "src/app/app.component.ts": `import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
    selector: "app-root",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ RouterOutlet ],
    template: \`<h1>Castra</h1><router-outlet />\`
})
export class AppComponent {}
`,
    "src/main.ts": `import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/app.routes";

bootstrapApplication(AppComponent, { providers: [ provideZonelessChangeDetection(), provideRouter(routes) ] }).catch(error => console.error(error));
`,
    "tsconfig.json": JSON.stringify({
        compilerOptions: { outDir: "./out-tsc", rootDir: "./src", noEmit: true, strict: true, target: "ES2022", module: "ES2022", moduleResolution: "bundler", experimentalDecorators: true, skipLibCheck: true, lib: [ "ES2022", "dom" ] },
        angularCompilerOptions: { strictTemplates: true, strictInjectionParameters: true },
        include: [ "src/**/*.ts" ]
    }, null, 2) + "\n"
};

const SHARED_WIDGET_BUTTONS = { total: 8, unlabelled: 5 };

function answerKey() {
    const key = { tentRoutes: [], rationRoutes: [], helmetRoutes: [], unroutedComponents: [ "OldDashboardPageComponent" ], iconButtons: SHARED_WIDGET_BUTTONS.total, unlabelledIconButtons: SHARED_WIDGET_BUTTONS.unlabelled };
    const shownAnywhere = new Set();
    PROVINCES.forEach((province, index) => {
        const pages = pagesOf(index);
        pages.forEach((page, pageIndex) => {
            const buttons = buttonsOf(index, pageIndex);
            key.iconButtons += buttons.length;
            key.unlabelledIconButtons += buttons.filter(button => button.state.startsWith("missing")).length;
            if (page.path === null) {
                key.unroutedComponents.push(pageClass(province, page.key));
                return;
            }
            const full = [ province, ...(page.parent ? [ pages.find(parent => parent.key === page.parent).path ] : []), page.path ].join("/");
            const shown = closure(page.widgets);
            shown.forEach(name => shownAnywhere.add(name));
            if (shown.has("tent")) key.tentRoutes.push(full);
            if (shown.has("ration")) key.rationRoutes.push(full);
            if (shown.has("helmet")) key.helmetRoutes.push(full);
        });
    });
    key.unroutedComponents.push(...Object.keys(WIDGET_CHILDREN).filter(name => !shownAnywhere.has(name)).map(widgetClass));
    return key;
}

rmSync(path.join(BASE, "src"), { recursive: true, force: true });
const write = (relative, content) => {
    const target = path.join(BASE, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
};
for (const [ relative, content ] of Object.entries(FILES)) write(relative, content);
write("src/app/app.routes.ts", APP_ROUTES());
PROVINCES.forEach((province, index) => {
    write(`src/app/provinces/${province}/${province}.routes.ts`, provinceRoutes(province, index));
    pagesOf(index).forEach((page, pageIndex) => {
        write(`src/app/provinces/${province}/${page.key}.page.ts`, pageComponent(province, index, page, pageIndex));
        if ((index + pageIndex) % 3 !== 0) write(`src/app/provinces/${province}/${page.key}.page.html`, pageTemplate(province, index, page, pageIndex));
    });
});
const key = answerKey();
writeFileSync(path.join(ROOT, "atlas-key.json"), JSON.stringify({ provinces: PROVINCES.length, icons: ICONS, ...key }, null, 2) + "\n");
console.log(`atlas/: ${PROVINCES.length} provinces, ${PROVINCES.length * 11 + 17} components, ${key.iconButtons} icon buttons (${key.unlabelledIconButtons} without a label); <app-tent> on ${key.tentRoutes.length} routes, <app-ration> on ${key.rationRoutes.length}, <app-helmet> on ${key.helmetRoutes.length}; ${key.unroutedComponents.length} components no route shows`);
