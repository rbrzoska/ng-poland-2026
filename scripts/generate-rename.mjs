// Generates the "rename" experiment: rename/ (an Angular 22 application before the refactoring), rename-expected/ (the same
// application after PillComponent.disableTooltip was renamed to hideHint everywhere) and rename-key.json (every occurrence
// of the old name: the ones that must change, with their kind, and the ones that must stay). The key lies next to the two
// workspaces, never inside them, and no emitted file names this script, the key or the repository.
// One explicit model drives everything: files are rows of text with marked occurrences of the name, templates are trees of
// elements whose tag decides whether the input on them is the renamed one. Both trees are emitted from the same rows (only
// the marked targets differ) and the key is read off the marks, never off the emitted text. After writing, a self-test
// scans the files on disk with the TypeScript type checker and the Angular template parser, classifies every occurrence
// again without the model, and exits 1 when it disagrees with the key. It needs no network.
// Not every target is visible to a type checker: a few name the input in a string (componentRef.setInput("…")) or in a
// CSS attribute selector (app-pill[…]), so that no fact source finds all of them by construction; the same forms exist
// on the card, where they must stay.
//   node scripts/generate-rename.mjs             writes rename/, rename-expected/ and rename-key.json at the repository root
//   node scripts/generate-rename.mjs --compile   also runs ngc in both trees (both must exit 0)
//   OUT=<dir> writes somewhere else; node_modules must be reachable by walking up from <dir>
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CombinedRecursiveAstVisitor, ImplicitReceiver, parseTemplate, PropertyRead, TmplAstBoundAttribute } from "@angular/compiler";
import ts from "typescript";

const REPO = path.resolve(import.meta.dirname, "..");
const ROOT = process.env.OUT ? path.resolve(process.env.OUT) : REPO;
const BEFORE = "rename";
const AFTER = "rename-expected";
const KEY_FILE = path.join(ROOT, "rename-key.json");
const TASK = { component: "PillComponent", from: "disableTooltip", to: "hideHint" };
const FEATURES = 120;
const STYLES = 6;
/**
 * What a target is. The first five a type checker can see. "string" is the name inside a string that Angular resolves at
 * run time (componentRef.setInput("name", …)), "style" the name in a CSS attribute selector (app-pill[name]): no compiler
 * and no language service reports these two, a plain attribute ("static") only the language service does.
 */
const TARGET_KINDS = [ "declaration", "binding", "static", "template-read", "class-read", "string", "style" ];
const DECOY_KINDS = [ "other-component", "class-field", "comment", "text" ];
/** Strings the bench looks for in a recording to spot an agent that found the answers: none may be in a workspace. */
const LEAKS = [ AFTER, "rename-key", "generate-rename", path.basename(REPO) ];

// ---------------------------------------------------------------------------------------------------------------------
// Rows and marks. A file is a list of rows; a row is a list of parts; a part is literal text or a mark: one occurrence of
// the name, with what the key says about it. Literal text never contains the name (checked before anything is written).
// ---------------------------------------------------------------------------------------------------------------------
const target = (kind, on = null, inline = false) => ({ role: "target", kind, on, inline });
const decoy = (kind, on = null) => ({ role: "decoy", kind, on });
const isMark = part => typeof part === "object" && part !== null && "role" in part;
const partsOf = aRow => typeof aRow === "string" ? [ aRow ] : aRow;
const marksOf = aRow => partsOf(aRow).filter(isMark);

/** Tagged template for a whole file or a block of it: rows split at line breaks, marks kept where they stand. */
function source(strings, ...values) {
    const rows = [ [] ];
    const append = text => text.split("\n").forEach((piece, index) => {
        if (index > 0) rows.push([]);
        if (piece) rows.at(-1).push(piece);
    });
    strings.forEach((text, index) => {
        append(text);
        if (index >= values.length) return;
        if (isMark(values[index])) rows.at(-1).push(values[index]);
        else append(String(values[index]));
    });
    if (!rows[0].length) rows.shift();
    if (rows.length && !rows.at(-1).length) rows.pop();
    return rows;
}

/** Tagged template for one row, e.g. row`    return this.${target("class-read")}();` */
function row(strings, ...values) {
    const rows = source(strings, ...values);
    if (rows.length !== 1) throw new Error(`row\`…\` must be one line, got ${rows.length}`);
    return rows[0];
}

const textOfRow = (aRow, name) => partsOf(aRow).map(part => isMark(part) ? (part.role === "target" ? name : TASK.from) : part).join("");
const textOf = (rows, name) => rows.map(aRow => textOfRow(aRow, name)).join("\n") + "\n";

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 1: the components that have an input called TASK.from. "renamed" says whether it is the input of
// TASK.component (declared there or inherited from it): on those tags a use is a target, on the others it is a decoy.
// ---------------------------------------------------------------------------------------------------------------------
const INPUT_OWNERS = {
    "app-pill": { className: "PillComponent", file: "pill.component", renamed: true },
    "app-fancy-pill": { className: "FancyPillComponent", file: "fancy-pill.component", renamed: true },
    "app-status-pill": { className: "StatusPillComponent", file: "status-pill.component", renamed: true },
    "app-card": { className: "CardComponent", file: "card.component", renamed: false },
    "app-pill-legacy": { className: "PillLegacyComponent", file: "pill-legacy.component", renamed: false }
};
const RENAMED_TAGS = Object.keys(INPUT_OWNERS).filter(tag => INPUT_OWNERS[tag].renamed);

const PILL = source`
import { booleanAttribute, ChangeDetectionStrategy, Component, input } from "@angular/core";

export type PillVariant = "info" | "success" | "warning";

@Component({
    selector: "app-pill",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<span class="pill" [class]="variant()">{{ label() }}@if (!${target("template-read", null, true)}()) {<span class="hint">i</span>}</span>\`
})
export class PillComponent {
    readonly ${target("declaration")} = input(false, { transform: booleanAttribute });
    readonly label = input("");
    readonly variant = input<"info" | "success" | "warning">("info");
}
`;

const FANCY_PILL = source`
import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { PillComponent } from "./pill.component";

/** A pill with an icon in front. The label, the variant and the hint switch come from PillComponent. */
@Component({
    selector: "app-fancy-pill",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<span class="pill fancy" [class]="variant()"><i class="icon">{{ icon() }}</i>{{ label() }}@if (!${target("template-read", null, true)}()) {<span class="hint">i</span>}</span>\`
})
export class FancyPillComponent extends PillComponent {
    readonly icon = input("star");
}
`;

const STATUS_PILL = source`
import { ChangeDetectionStrategy, Component, computed } from "@angular/core";
import { PillComponent } from "./pill.component";

/** A pill for a state of the screen: it reads its label out loud and marks the hint with a question mark. */
@Component({
    selector: "app-status-pill",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<span class="pill status" [class]="variant()" [attr.aria-label]="spoken()">{{ label() }}@if (!${target("template-read", null, true)}()) {<span class="hint">?</span>}</span>\`
})
export class StatusPillComponent extends PillComponent {
    readonly spoken = computed(() => this.${target("class-read")}() ? this.label() : this.label() + ", a hint is available");
}
`;

const CARD = source`
import { booleanAttribute, ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
    selector: "app-card",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<section class="card" [attr.title]="${decoy("other-component", "app-card")}() ? null : heading()"><h3>{{ heading() }}</h3><ng-content /></section>\`
})
export class CardComponent {
    readonly heading = input("");
    /** ${decoy("comment")}: the card shows no title hint. */
    readonly ${decoy("other-component", "app-card")} = input(false, { transform: booleanAttribute });
}
`;

const PILL_LEGACY = source`
import { ChangeDetectionStrategy, Component, Input } from "@angular/core";
import type { PillVariant } from "./pill.component";

/** The old pill of the reports screen. A component of its own with its own inputs: it does not extend PillComponent. */
@Component({
    selector: "app-pill-legacy",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<span class="pill legacy" [class]="variant">{{ label }}@if (!${decoy("other-component", "app-pill-legacy")}) {<span class="hint">i</span>}</span>\`
})
export class PillLegacyComponent {
    @Input() label = "";
    @Input() variant: PillVariant = "info";
    @Input() ${decoy("other-component", "app-pill-legacy")} = false;
}
`;

/** Components created in code get their inputs by name, in a string: no compiler checks that name. */
const PILL_TRAY = source`
import { ChangeDetectionStrategy, Component, viewChild, ViewContainerRef } from "@angular/core";
import { CardComponent } from "./card.component";
import { FancyPillComponent } from "./fancy-pill.component";
import { PillComponent } from "./pill.component";

/** Adds pills and cards at run time, for lists whose length no template knows. */
@Component({
    selector: "app-pill-tray",
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: \`<ng-container #slot />\`
})
export class PillTrayComponent {
    private readonly slot = viewChild.required("slot", { read: ViewContainerRef });

    addPill(label: string, quiet = false): void {
        const pill = this.slot().createComponent(PillComponent);
        pill.setInput("label", label);
        pill.setInput("${target("string", "app-pill")}", quiet);
    }

    addFancyPill(label: string, icon: string): void {
        const pill = this.slot().createComponent(FancyPillComponent);
        pill.setInput("label", label);
        pill.setInput("icon", icon);
        pill.setInput("${target("string", "app-fancy-pill")}", true);
    }

    addCard(heading: string): void {
        const card = this.slot().createComponent(CardComponent);
        card.setInput("heading", heading);
        card.setInput("${decoy("other-component", "app-card")}", true);
    }
}
`;

const HINT_DIRECTIVE = source`
import { booleanAttribute, Directive, input } from "@angular/core";

/**
 * Marks any element as having a hint. It has its own switch, hintDisabled,
 * and never looks at the ${decoy("comment")} flag of the card around it.
 */
@Directive({
    selector: "[appHint]",
    host: { "[class.has-hint]": "!hintDisabled()", "[attr.title]": "hintDisabled() ? null : appHint()" }
})
export class HintDirective {
    readonly appHint = input("");
    readonly hintDisabled = input(false, { transform: booleanAttribute });
}
`;

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 2: templates as trees. A child is a row of text, an element, a control-flow block or a few elements that
// share one line. An attribute is literal text or theInput(): the input called TASK.from, bare (static) or bound to an
// expression. Whether that is a target or a decoy follows from the tag of the element it sits on.
// ---------------------------------------------------------------------------------------------------------------------
const theInput = (expression, quote = "\"") => ({ input: true, expression, quote });
const el = (tag, attrs, options = {}) => ({ node: "element", tag, attrs, layout: "line", close: "self", gap: " ", hang: false, children: null, ...options });
const block = (open, children) => ({ node: "block", open, children });
const together = (...elements) => ({ node: "together", elements });

function elementRows(element, unit) {
    const { tag, attrs, layout, close, gap, hang, children } = element;
    const owner = INPUT_OWNERS[tag];
    const attrParts = attr => {
        if (typeof attr === "string") return [ attr ];
        if (!owner) throw new Error(`<${tag}> has no input called ${TASK.from}`);
        const form = attr.expression === undefined ? "static" : "binding";
        const occurrence = owner.renamed ? target(form, tag) : decoy("other-component", tag);
        return form === "static" ? [ occurrence ] : [ "[", occurrence, `]=${attr.quote}`, ...partsOf(attr.expression), attr.quote ];
    };
    const inside = children ? [ ...templateRows(children, unit, 1), [ `</${tag}>` ] ] : [];
    if (layout === "line") {
        const closing = children ? ">" : close === "pair" ? `></${tag}>` : close === "tight" ? "/>" : " />";
        return [ [ `<${tag}`, ...attrs.flatMap(attr => [ gap, ...attrParts(attr) ]), closing ], ...inside ];
    }
    // stacked: one attribute per line; the closing bracket hangs on its own line or sticks to the last attribute
    const opens = children || close === "pair";
    const attrRows = attrs.map(attr => [ unit, ...attrParts(attr) ]);
    if (hang) attrRows.push([ opens ? ">" : "/>" ]);
    else attrRows.at(-1).push(opens ? ">" : " />");
    return [ [ `<${tag}` ], ...attrRows, ...inside, ...(!children && close === "pair" ? [ [ `</${tag}>` ] ] : []) ];
}

function templateRows(nodes, unit, depth = 0) {
    const pad = unit.repeat(depth);
    return nodes.flatMap(node => {
        if (typeof node === "string" || Array.isArray(node)) return [ [ pad, ...partsOf(node) ] ];
        if (node.node === "block") return [ [ pad, ...partsOf(node.open) ], ...templateRows(node.children, unit, depth + 1), [ pad, "}" ] ];
        if (node.node === "together") {
            const rows = node.elements.map(element => elementRows(element, unit));
            if (rows.some(lines => lines.length !== 1)) throw new Error("elements that share a line must fit on one line each");
            return [ [ pad, ...rows.flatMap(lines => lines[0]) ] ];
        }
        return elementRows(node, unit).map(parts => [ pad, ...parts ]);
    });
}

/** Every element of a template, wherever it sits. */
function elementsOf(nodes) {
    return nodes.flatMap(node => {
        if (typeof node === "string" || Array.isArray(node)) return [];
        if (node.node === "block") return elementsOf(node.children);
        if (node.node === "together") return elementsOf(node.elements);
        return [ node, ...elementsOf(node.children ?? []) ];
    });
}

/** Uses of the input called TASK.from in a template, from the tree: [ { tag, form: "binding" | "static" } ]. */
const inputUses = nodes => elementsOf(nodes).flatMap(element => element.attrs.filter(attr => typeof attr !== "string")
    .map(attr => ({ tag: element.tag, form: attr.expression === undefined ? "static" : "binding" })));

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 3: 120 feature components in six template styles. What a feature has follows from its style (0-5) and
// its round (0-19) so that every trait is spread over all the styles.
// ---------------------------------------------------------------------------------------------------------------------
/** A paragraph that names the word as text: on the screens of every fourth round only, as an identifier in visible text is rare. */
const cardNote = feature => (feature.note ? [ row`<p class="hint">This card sets ${decoy("text")}: its title shows no hint.</p>` ] : []);
/** The card's own input, bound or (on some screens) as a plain attribute: the plain form is not a target on every element. */
const cardInput = feature => (feature.plainCard ? theInput() : theInput("true"));

/** What some features have besides the pills of their style: pills that inherit the input, a flag of their own, a hint. */
function extras(feature) {
    const { round, index } = feature;
    const nodes = [];
    if (feature.fancy) {
        // on some screens the pill has a name in the template (#fancyRef) and an expression reads the input through it
        const named = feature.refRead ? [ `#fancyRef` ] : [];
        nodes.push([
            el("app-fancy-pill", [ ...named, `label="Fancy"`, `icon="star"`, theInput("!isActive") ]),
            el("app-fancy-pill", [ ...named, `icon="bolt"`, `label="Fancy"`, theInput() ], { close: "pair" }),
            el("app-fancy-pill", [ ...named, `[icon]="count > 2 ? 'bolt' : 'star'"`, theInput("count > 5"), `label="Fancy"` ], { layout: "stacked" })
        ][Math.floor(round / 2) % 3]);
        if (feature.refRead) nodes.push(row`<small>Fancy hint: {{ fancyRef.${target("template-read")}() ? 'off' : 'on' }}</small>`);
    }
    if (feature.status) {
        nodes.push(round % 2 === 0
            ? el("app-status-pill", [ `label="Status"`, `[variant]="statusVariant"`, theInput("count === 0") ])
            : el("app-status-pill", [ theInput(), `label="Status"`, `variant="success"` ], { close: "pair" }));
    }
    if (feature.ownFlag && feature.ownFlagUse === 0) nodes.push(block(row`@if (${decoy("class-field")}) {`, [ `<small>Hints are switched off on this screen</small>` ]));
    if (feature.ownFlag && feature.ownFlagUse === 1) nodes.push(row`<small>Screen hints: {{ ${decoy("class-field")} ? 'off' : 'on' }}</small>`);
    if (feature.hint) nodes.push(`<small appHint="More about feature ${index}" [hintDisabled]="!isActive">More</small>`);
    return nodes;
}

function afterCard(feature) {
    if (feature.ownFlag && feature.ownFlagUse === 2) return [ el("app-card", [ `heading="Screen flag"`, theInput(row`${decoy("class-field")}`) ]) ];
    // the same read through a template name, on the card: its own input, not the pill's
    if (feature.secondCard && feature.cardRefRead) return [
        el("app-card", [ `#summary`, `heading="Summary"`, theInput("!isActive") ]),
        row`<small>Summary hint: {{ summary.${decoy("other-component", "app-card")}() ? 'off' : 'on' }}</small>`
    ];
    if (feature.secondCard) return [ el("app-card", [ `heading="Summary"`, theInput("!isActive") ]) ];
    return [];
}

function canonical(feature) {
    const nested = feature.round % 2 === 1
        ? el("app-pill", [ `variant="warning"`, `label="Nested"`, theInput() ])
        : el("app-pill", [ `[variant]="statusVariant"`, `label="Nested"`, theInput("false") ]);
    return [
        el("app-card", [ `heading="Feature ${feature.index}"`, cardInput(feature) ], { children: [
            ...cardNote(feature),
            el("app-pill", [ `label="Plain"`, theInput() ]),
            el("app-pill", [ `variant="success"`, `label="Active"`, theInput("!isActive") ]),
            el("app-pill", [ `[label]="count > 3 ? 'Many' : title"`, theInput("count > 3") ]),
            el("app-pill", [ `[variant]="isActive ? 'success' : 'warning'"`, `label="Multi-line"`, theInput("isActive") ], { layout: "stacked", close: "pair" }),
            block("@if (isActive) {", [ nested ]),
            ...extras(feature)
        ] }),
        ...afterCard(feature)
    ];
}

function compact(feature) {
    return [
        el("app-card", [ `heading="Feature ${feature.index}"`, cardInput(feature) ], { children: [
            ...cardNote(feature),
            el("app-pill", [ theInput(), `label='Plain'` ], { close: "tight" }),
            el("app-pill", [ `variant="success"`, theInput("!isActive", "'"), `label="Active"` ], { gap: "  ", close: "tight" }),
            el("app-pill", [ theInput("count > 3"), `[label]="title"`, `variant="info"` ]),
            el("app-pill", [ `[variant]="isActive ? 'success' : 'warning'"`, `label="Multi-line"`, feature.round % 2 === 1 ? theInput() : theInput("isActive") ], { close: "pair" }),
            block("@if (isActive) {", [ el("app-pill-legacy", [ `label="Legacy"`, `variant="info"`, theInput("true") ]) ]),
            ...extras(feature)
        ] }),
        ...afterCard(feature)
    ];
}

function oneAttributePerLine(feature) {
    return [
        el("app-card", [ `heading="Feature ${feature.index}"`, cardInput(feature) ], { layout: "stacked", hang: true, children: [
            row`<!-- ${decoy("comment")} above is the card's flag: no hint on the title -->`,
            el("app-pill", [ `label="Plain"`, `variant="warning"`, theInput() ], { layout: "stacked", hang: true }),
            el("app-pill", [ `[label]="title"`, `[variant]="count > 3 ? 'success' : isActive ? 'warning' : 'info'"`, theInput("!(isActive && count > 1)") ], { layout: "stacked", hang: true }),
            el("app-pill", [ `[variant]="statusVariant"`, `label="Nested"`, theInput("false") ]),
            ...extras(feature)
        ] }),
        ...afterCard(feature)
    ];
}

function loop(feature) {
    return [
        el("app-card", [ `heading="Feature ${feature.index}"`, cardInput(feature) ], { children: [
            ...cardNote(feature),
            block("@for (item of items; track item.id) {", [ el("app-pill", [ `[label]="item.name"`, `[variant]="item.variant"`, theInput("item.hidden") ]) ]),
            el("app-pill", [ `label="Plain"`, theInput() ]),
            el("app-pill", [ `variant="success"`, `label="Active"`, feature.round % 4 === 2 ? theInput() : theInput("!isActive") ]),
            ...extras(feature)
        ] }),
        ...afterCard(feature)
    ];
}

function expressions(feature) {
    return [
        el("app-card", [ `heading="Feature ${feature.index}"`, theInput("!isActive") ], { children: [
            ...cardNote(feature),
            el("app-pill", [ `label="Quiet"`, `variant="info"`, theInput("user?.prefs?.quiet") ]),
            el("app-pill", [ `[label]="title"`, `[variant]="statusVariant"`, theInput("items.length === 0") ]),
            el("app-pill", [ `label="Keyed"`, `variant="warning"`, theInput("flags['hidden']") ]),
            el("app-pill", [ `label="Called"`, `[variant]="count > 2 ? 'success' : 'info'"`, theInput("isHidden() && count > 2") ]),
            ...extras(feature)
        ] }),
        ...afterCard(feature)
    ];
}

function wide(feature) {
    return [
        el("app-card", [ `heading="Feature ${feature.index}"`, cardInput(feature) ], { children: [
            ...cardNote(feature),
            el("div", [ `class="row"` ], { children: [
                together(
                    el("app-pill", [ `label="Info"`, `variant="info"`, theInput() ]),
                    el("app-pill", [ `label="Active"`, `variant="success"`, feature.round % 4 === 3 ? theInput() : theInput("!isActive") ])
                ),
                el("app-pill-legacy", [ `[label]="title"`, `[variant]="statusVariant"`, theInput("count > 3") ])
            ] }),
            el("app-pill", [ `[label]="title"`, feature.round % 2 === 1 ? theInput() : theInput("count > 3") ]),
            ...extras(feature)
        ] }),
        ...afterCard(feature)
    ];
}

const STYLE_TEMPLATES = [ canonical, compact, oneAttributePerLine, loop, expressions, wide ];

/** Class code of the 20 features that hold a pill as a view child and read its input. */
function readerRows(feature) {
    const read = () => target("class-read");
    const variants = feature.fancy ? [
        [
            `    private readonly fancy = viewChild(FancyPillComponent);`,
            `    readonly allQuiet = computed(() => {`,
            ...(feature.ownFlag ? [ row`        if (!this.${decoy("class-field")}) return false;` ] : []),
            row`        return this.fancy()?.${read()}() === true;`,
            `    });`
        ],
        [
            `    readonly fancy = viewChild.required(FancyPillComponent);`,
            ``,
            `    describeFancy(): string {`,
            `        const fancy = this.fancy();`,
            row`        return fancy.${read()}() ? "quiet" : fancy.label();`,
            `    }`
        ],
        [
            `    private readonly fancy = viewChild.required(FancyPillComponent);`,
            `    private readonly firstPill = viewChild.required(PillComponent);`,
            ``,
            `    hintCount(): number {`,
            row`        const hidden = [ this.fancy().${read()}(), this.firstPill().${read()}() ];`,
            `        return hidden.filter(value => !value).length;`,
            `    }`
        ]
    ] : [
        [
            `    private readonly firstPill = viewChild(PillComponent);`,
            `    private readonly card = viewChild(CardComponent);`,
            `    readonly quiet = computed(() => {`,
            ...(feature.ownFlag ? [ row`        if (this.${decoy("class-field")}) return true;` ] : []),
            row`        const card = this.card()?.${decoy("other-component", "app-card")}() ?? false;`,
            row`        const pill = this.firstPill()?.${read()}() ?? false;`,
            `        return card || pill;`,
            `    });`
        ],
        [
            `    readonly firstPill = viewChild(PillComponent);`,
            row`    readonly hintHidden = computed(() => this.firstPill()?.${read()}() ?? false);`
        ],
        [
            `    private readonly pills = viewChildren(PillComponent);`,
            ``,
            `    quietPills(): number {`,
            row`        return this.pills().filter(pill => pill.${read()}()).length;`,
            `    }`
        ]
    ];
    return variants[feature.style % variants.length];
}

function classRows(feature) {
    const { index, style, round } = feature;
    const rows = [
        `    isActive = ${index % 2 === 0};`,
        `    count = ${index % 7};`,
        `    title = "Title ${index}";`,
        `    statusVariant: PillVariant = "${index % 4 === 0 ? "warning" : "success"}";`
    ];
    if (feature.ownFlag) {
        if (round % 2 === 0) rows.push(row`    // ${decoy("comment")} is the switch of this screen; the card and the pills have theirs`);
        rows.push(row`    ${decoy("class-field")} = ${index % 2 === 1};`);
    }
    if (style === 3 || style === 4) rows.push(`    items: { id: number; name: string; variant: PillVariant; hidden: boolean }[] = [ { id: 1, name: "Alpha", variant: "info", hidden: false }, { id: 2, name: "Beta", variant: "warning", hidden: ${index % 2 === 0} } ];`);
    if (style === 4) {
        rows.push(
            `    user?: { prefs?: { quiet: boolean } } = { prefs: { quiet: ${index % 2 === 1} } };`,
            `    flags: Record<string, boolean> = { hidden: ${index % 3 === 0} };`,
            ``,
            `    isHidden(): boolean {`,
            `        return this.count > 4;`,
            `    }`
        );
    }
    if (feature.classReader) rows.push(``, ...readerRows(feature));
    return rows;
}

function featureModel(index) {
    const style = (index - 1) % STYLES;
    const round = Math.floor((index - 1) / STYLES);
    const feature = {
        index,
        style,
        round,
        className: `Feature${String(index).padStart(3, "0")}Component`,
        unit: style === 1 ? "  " : "    ",
        inline: (round + style) % 4 === 0,
        ownFlag: (round + style) % 3 === 0,
        ownFlagUse: Math.floor(round / 3) % 3,
        fancy: (round + style) % 2 === 0,
        status: (round + 2 * style) % 3 === 1,
        secondCard: (round + style) % 3 === 1,
        hint: round % 5 === 4,
        classReader: (round + 2 * style) % 6 === 3,
        note: round % 4 === 0,
        plainCard: (round + 2 * style) % 5 === 0,
        cardRefRead: round % 4 === 2
    };
    feature.refRead = feature.fancy && round % 4 === 1;
    feature.template = STYLE_TEMPLATES[style](feature);
    feature.classRows = classRows(feature);
    return feature;
}

const MODEL = Array.from({ length: FEATURES }, (_, position) => featureModel(position + 1));

// ---------------------------------------------------------------------------------------------------------------------
// Emission: the rows of every file, from the model.
// ---------------------------------------------------------------------------------------------------------------------
function featureSource(feature) {
    const { index } = feature;
    const tags = new Set(elementsOf(feature.template).map(element => element.tag));
    const used = Object.keys(INPUT_OWNERS).filter(tag => tags.has(tag)).map(tag => INPUT_OWNERS[tag]);
    const classText = textOf(feature.classRows, TASK.from);
    const core = [ "ChangeDetectionStrategy", "Component", ...[ "computed", "viewChild", "viewChildren" ].filter(name => classText.includes(`${name}(`) || classText.includes(`${name}.required(`)) ];
    const imports = [
        ...used.map(owner => ({ file: owner.file, names: owner.className === TASK.component ? `${owner.className}, type PillVariant` : owner.className })),
        ...(feature.hint ? [ { file: "hint.directive", names: "HintDirective" } ] : [])
    ].sort((left, right) => (left.file < right.file ? -1 : 1));
    const template = feature.inline
        ? [ "    template: `", ...templateRows(feature.template, feature.unit).map(parts => [ "        ", ...parts.map(part => isMark(part) && part.role === "target" ? { ...part, inline: true } : part) ]), "    `" ]
        : [ `    templateUrl: "./feature-${index}.component.html"` ];
    return [
        `import { ${core.join(", ")} } from "@angular/core";`,
        ...imports.map(entry => `import { ${entry.names} } from "../../lib/${entry.file}";`),
        ``,
        `@Component({`,
        `    selector: "app-feature-${index}",`,
        `    changeDetection: ChangeDetectionStrategy.OnPush,`,
        `    imports: [ ${[ ...used.map(owner => owner.className), ...(feature.hint ? [ "HintDirective" ] : []) ].join(", ")} ],`,
        ...template,
        `})`,
        `export class ${feature.className} {`,
        ...feature.classRows,
        `}`
    ];
}

const appComponent = () => source`
import { ChangeDetectionStrategy, Component } from "@angular/core";
${MODEL.map(feature => `import { ${feature.className} } from "./features/feature-${feature.index}/feature-${feature.index}.component";`).join("\n")}
import { PillTrayComponent } from "./lib/pill-tray.component";

@Component({
    selector: "app-root",
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ ${MODEL.map(feature => feature.className).join(", ")}, PillTrayComponent ],
    template: \`
        <div class="page">
            <div class="summary">
                <h1>Pill village</h1>
                <span class="count">{{ screens }} screens</span>
                <span class="help">{{ help }}</span>
                <app-pill-tray #tray />
                <button type="button" (click)="tray.addPill('New', true)">Add a pill</button>
                <button type="button" (click)="tray.addFancyPill('New', 'bolt')">Add a fancy pill</button>
                <button type="button" (click)="tray.addCard('New')">Add a card</button>
            </div>
            <div class="grid">
${MODEL.map(feature => `                <app-feature-${feature.index} />`).join("\n")}
            </div>
        </div>
    \`
})
export class AppComponent {
    readonly screens = ${FEATURES};
    readonly help = "A card with ${decoy("text")} shows no hint on its title.";
}
`;

const PACKAGE_JSON = {
    name: "pill-village",
    version: "1.0.0",
    private: true,
    scripts: { check: "ngc -p tsconfig.json", build: "ng build" },
    dependencies: {
        "@angular/common": "22.2.1",
        "@angular/compiler": "22.2.1",
        "@angular/core": "22.2.1",
        "@angular/platform-browser": "22.2.1",
        rxjs: "7.8.2",
        tslib: "2.8.1"
    },
    devDependencies: { "@angular/build": "22.2.1", "@angular/cli": "22.2.1", "@angular/compiler-cli": "22.2.1", typescript: "6.0.3" }
};

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
    angularCompilerOptions: { strictTemplates: true, strictInjectionParameters: true, strictInputAccessModifiers: true },
    include: [ "src/**/*.ts" ]
};

const TSCONFIG_APP = { extends: "./tsconfig.json", compilerOptions: { noEmit: false, outDir: "./out-tsc/app" }, files: [ "src/main.ts" ], include: [] };

const ANGULAR_JSON = {
    $schema: "./node_modules/@angular/cli/lib/config/schema.json",
    version: 1,
    cli: { analytics: false },
    projects: {
        "pill-village": {
            projectType: "application",
            root: "",
            sourceRoot: "src",
            architect: {
                build: {
                    builder: "@angular/build:application",
                    options: { browser: "src/main.ts", index: "src/index.html", tsConfig: "tsconfig.app.json", styles: [ "src/styles.css" ], outputPath: "dist" }
                }
            }
        }
    }
};

const MAIN = `import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, { providers: [ provideZonelessChangeDetection() ] }).catch(error => console.error(error));`;

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
</html>`;

/** A plain attribute stays on the element in the page, so a style sheet can select by it: the name in the selector is the input's. */
const STYLES_CSS = source`:root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
body { margin: 0; background: #f4f1e8; color: #2b2416; }
.page { padding: 20px; }
.summary { display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; margin-bottom: 16px; }
.summary h1 { font-size: 20px; margin: 0; }
.summary .count { font-size: 15px; padding: 4px 10px; border-radius: 999px; background: #2b2416; color: #f4f1e8; }
.summary .help { font-size: 12px; color: #8a7d5c; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.card { background: #fffdf7; border: 1px solid #d9cfb4; border-radius: 10px; padding: 10px 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.card h3 { width: 100%; margin: 0 0 4px; font-size: 13px; }
.card p.hint, .card small { width: 100%; margin: 0; font-size: 11px; color: #8a7d5c; }
.card .row { display: flex; gap: 6px; flex-wrap: wrap; width: 100%; }
.has-hint { text-decoration: underline dotted; }
.pill { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #e6e9f5; color: #23306b; }
.pill.success { background: #dff3e4; color: #1d5c33; }
.pill.warning { background: #fbecd2; color: #7a4a07; }
.pill.fancy .icon { font-style: normal; font-size: 10px; opacity: 0.7; }
.pill.status { border: 1px solid currentColor; }
.pill.legacy { border: 1px dashed #8a7d5c; background: #f1ede2; color: #5c5038; }
.pill .hint { display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; background: #c0392b; color: #fff; font-size: 10px; font-weight: 700; }
app-pill[${target("style", "app-pill")}] .pill, app-fancy-pill[${target("style", "app-fancy-pill")}] .pill { padding-right: 10px; }
app-status-pill[${target("style", "app-status-pill")}] .pill { border-style: dashed; }
app-card[${decoy("other-component", "app-card")}] h3 { text-decoration: none; }`;

/** Every file of the workspace: path relative to its root -> rows. */
function workspaceFiles() {
    const files = new Map();
    const put = (relative, rows) => {
        if (files.has(relative)) throw new Error(`two files want the path ${relative}`);
        files.set(relative, typeof rows === "string" ? rows.split("\n") : rows);
    };
    put("package.json", JSON.stringify(PACKAGE_JSON, null, 2));
    put("tsconfig.json", JSON.stringify(TSCONFIG, null, 2));
    put("tsconfig.app.json", JSON.stringify(TSCONFIG_APP, null, 2));
    put("angular.json", JSON.stringify(ANGULAR_JSON, null, 2));
    put("src/main.ts", MAIN);
    put("src/index.html", INDEX_HTML);
    put("src/styles.css", STYLES_CSS);
    put("src/app/app.component.ts", appComponent());
    put("src/app/lib/pill.component.ts", PILL);
    put("src/app/lib/fancy-pill.component.ts", FANCY_PILL);
    put("src/app/lib/status-pill.component.ts", STATUS_PILL);
    put("src/app/lib/card.component.ts", CARD);
    put("src/app/lib/pill-legacy.component.ts", PILL_LEGACY);
    put("src/app/lib/hint.directive.ts", HINT_DIRECTIVE);
    put("src/app/lib/pill-tray.component.ts", PILL_TRAY);
    for (const feature of MODEL) {
        const base = `src/app/features/feature-${feature.index}/feature-${feature.index}.component`;
        put(`${base}.ts`, featureSource(feature));
        if (!feature.inline) put(`${base}.html`, templateRows(feature.template, feature.unit));
    }
    return files;
}

// ---------------------------------------------------------------------------------------------------------------------
// The key, read off the marks; and what the model has to satisfy before anything is written.
// ---------------------------------------------------------------------------------------------------------------------
const tally = (names, values) => Object.fromEntries(names.map(name => [ name, values.filter(value => value === name).length ]));

function answerKey(files) {
    const targets = [];
    const decoys = [];
    for (const relative of [ ...files.keys() ].sort()) {
        files.get(relative).forEach((aRow, position) => marksOf(aRow).forEach(mark => {
            if (mark.role === "target") targets.push({ file: relative, line: position + 1, kind: mark.kind, on: mark.on, inline: mark.inline });
            else decoys.push({ file: relative, line: position + 1, kind: mark.kind, on: mark.on });
        }));
    }
    const counts = {
        targets: targets.length,
        byKind: tally(TARGET_KINDS, targets.map(entry => entry.kind)),
        byTag: tally(RENAMED_TAGS, targets.map(entry => entry.on)),
        decoys: decoys.length,
        decoysByKind: tally(DECOY_KINDS, decoys.map(entry => entry.kind)),
        files: files.size,
        targetFiles: new Set(targets.map(entry => entry.file)).size
    };
    return { task: TASK, targets, decoys, counts };
}

function checkModel(files) {
    const problems = [];
    for (const [ relative, rows ] of files) {
        rows.forEach((aRow, position) => {
            const where = `${relative}:${position + 1}`;
            const literal = partsOf(aRow).filter(part => !isMark(part)).join("\u0000");
            if (literal.includes("\n")) problems.push(`${where}: a row spans two lines`);
            if (literal.includes(TASK.from) || literal.includes(TASK.to)) problems.push(`${where}: the name stands in literal text, without a mark`);
            const roles = new Set(marksOf(aRow).map(mark => mark.role));
            if (roles.size > 1) problems.push(`${where}: a target and a decoy share the line`);
            for (const mark of marksOf(aRow)) if (!(mark.role === "target" ? TARGET_KINDS : DECOY_KINDS).includes(mark.kind)) problems.push(`${where}: unknown kind ${mark.kind}`);
            for (const leak of LEAKS) if (literal.includes(leak)) problems.push(`${where}: mentions ${leak}`);
        });
    }
    for (const feature of MODEL.filter(candidate => candidate.inline)) {
        if (/`|\$\{/.test(textOf(templateRows(feature.template, feature.unit), TASK.from))) problems.push(`feature ${feature.index}: its inline template would end the template string`);
    }
    // sizes of the contract, counted on the template trees and the traits, not on the rows
    const uses = MODEL.flatMap(feature => inputUses(feature.template));
    const count = (tag, form) => uses.filter(use => use.tag === tag && (!form || use.form === form)).length;
    const sizes = {
        "features": [ MODEL.length, 120 ],
        "features with an inline template": [ MODEL.filter(feature => feature.inline).length, 30 ],
        "features with a class field of that name": [ MODEL.filter(feature => feature.ownFlag).length, 40 ],
        "features that read the input in class code": [ MODEL.filter(feature => feature.classReader).length, 20 ],
        "<app-pill> uses": [ count("app-pill"), 440 ],
        "<app-pill> bound": [ count("app-pill", "binding"), 300 ],
        "<app-pill> static": [ count("app-pill", "static"), 140 ],
        "<app-fancy-pill> uses": [ count("app-fancy-pill"), 60 ],
        "<app-status-pill> uses": [ count("app-status-pill"), 40 ],
        "<app-card> uses, at least one per feature": [ Math.min(count("app-card"), 120), 120 ],
        "<app-pill-legacy> uses": [ count("app-pill-legacy"), 40 ]
    };
    for (const [ what, [ got, wanted ] ] of Object.entries(sizes)) if (got !== wanted) problems.push(`${what}: ${got}, the contract wants ${wanted}`);
    for (const tag of [ "app-fancy-pill", "app-status-pill" ]) if (!count(tag, "binding") || !count(tag, "static")) problems.push(`<${tag}> wants a mix of bound and static uses`);
    for (const feature of MODEL) if (feature.classReader && !marksOf(feature.classRows.flat()).some(mark => mark.kind === "class-read")) problems.push(`feature ${feature.index} should read the input in class code`);
    return { problems, uses };
}

// ---------------------------------------------------------------------------------------------------------------------
// Self-test: the files on disk, classified again without the model. TypeScript's type checker says which class declares
// the member behind an identifier; the Angular template parser says where a template holds attributes, text, comments and
// reads; a tag leads to its class through the selector found in the decorator.
// ---------------------------------------------------------------------------------------------------------------------
function listFiles(dir) {
    return readdirSync(dir, { withFileTypes: true })
        .sort((left, right) => (left.name < right.name ? -1 : 1))
        .flatMap(entry => entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [ path.join(dir, entry.name) ]);
}

const slash = file => file.split(path.sep).join("/");
const offsetsOf = (text, from = 0, to = text.length) => [ ...text.slice(from, to).matchAll(new RegExp(TASK.from, "g")) ].map(match => from + match.index);

/** The names a template gives to its elements (#name), each with the tag it stands on. */
class TemplateNames extends CombinedRecursiveAstVisitor {
    names = new Map();

    visitElement(element) {
        for (const reference of element.references) this.names.set(reference.name, element.name);
        super.visitElement(element);
    }
}

class TemplateOccurrences extends CombinedRecursiveAstVisitor {
    constructor(text, names, record) {
        super();
        this.text = text;
        this.names = names;
        this.record = record;
    }

    visitElement(element) {
        for (const attribute of [ ...element.attributes, ...element.inputs ]) {
            if (attribute.name === TASK.from) this.record(attribute.keySpan.start.offset, { place: attribute instanceof TmplAstBoundAttribute ? "binding" : "static", tag: element.name });
        }
        super.visitElement(element);
    }

    visitText(text) {
        for (const offset of offsetsOf(this.text, text.sourceSpan.start.offset, text.sourceSpan.end.offset)) this.record(offset, { place: "text" });
    }

    visitPropertyRead(ast, context) {
        if (ast.name === TASK.from && ast.receiver instanceof ImplicitReceiver) this.record(ast.nameSpan.start, { place: "template-read" });
        // name.member, where #name stands on an element of the template: a member of that element's component
        const through = ast.receiver instanceof PropertyRead && ast.receiver.receiver instanceof ImplicitReceiver ? this.names.get(ast.receiver.name) : undefined;
        if (ast.name === TASK.from && through) this.record(ast.nameSpan.start, { place: "template-read", through });
        return super.visitPropertyRead(ast, context);
    }
}

/** Every occurrence of the name in the workspace at `base`, as the key would list it: [ { file, line, role, kind, on, inline } ]. */
function scanWorkspace(base) {
    const problems = [];
    const found = [];
    const parsed = ts.getParsedCommandLineOfConfigFile(path.join(base, "tsconfig.json"), undefined, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => problems.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")) });
    if (!parsed) return { problems, found };
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    const checker = program.getTypeChecker();
    const relative = file => slash(path.relative(base, file));
    const sources = program.getSourceFiles().filter(sourceFile => !sourceFile.isDeclarationFile && !relative(sourceFile.fileName).startsWith(".."));
    for (const sourceFile of sources) {
        for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) problems.push(`${relative(sourceFile.fileName)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }

    // classes with a decorator: their selector and their template
    const selectorOf = new Map();
    const classOfTag = new Map();
    const templates = [];
    const inlineSpans = new Map(sources.map(sourceFile => [ sourceFile, [] ]));
    for (const sourceFile of sources) {
        ts.forEachChild(sourceFile, node => {
            if (!ts.isClassDeclaration(node)) return;
            const call = (ts.getDecorators(node) ?? []).map(decorator => decorator.expression).find(expression => ts.isCallExpression(expression) && [ "Component", "Directive" ].includes(expression.expression.getText(sourceFile)));
            const metadata = call?.arguments[0];
            if (!metadata || !ts.isObjectLiteralExpression(metadata)) return;
            for (const property of metadata.properties) {
                const name = property.name?.getText(sourceFile);
                const value = property.initializer;
                if (name === "selector") {
                    selectorOf.set(node, value.text);
                    classOfTag.set(value.text, node);
                }
                if (name === "template") {
                    const start = value.getStart(sourceFile) + 1;
                    inlineSpans.get(sourceFile).push([ start, value.getEnd() - 1 ]);
                    templates.push({ file: relative(sourceFile.fileName), text: sourceFile.text.slice(start, value.getEnd() - 1), lineAt: offset => sourceFile.getLineAndCharacterOfPosition(start + offset).line + 1, owner: node, inline: true });
                }
                if (name === "templateUrl") {
                    const file = path.resolve(path.dirname(sourceFile.fileName), value.text);
                    const text = readFileSync(file, "utf8");
                    templates.push({ file: relative(file), text, lineAt: offset => text.slice(0, offset).split("\n").length, owner: node, inline: false });
                }
            }
        });
    }

    const memberOf = classDeclaration => checker.getPropertyOfType(checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(classDeclaration.name)), TASK.from)?.valueDeclaration;
    /** What the key should say about one use of a member, given the class that declares it. */
    const classify = (member, kind, tag) => {
        const owner = member.parent;
        const isInput = (ts.getDecorators(member) ?? []).some(decorator => /^Input\b/.test(decorator.expression.getText()))
            || Boolean(member.initializer && ts.isCallExpression(member.initializer) && /^input\b/.test(member.initializer.expression.getText()));
        if (owner.name.text === TASK.component) return { role: "target", kind, on: tag ?? null };
        return isInput ? { role: "decoy", kind: "other-component", on: tag ?? selectorOf.get(owner) ?? null } : { role: "decoy", kind: "class-field", on: null };
    };

    // TypeScript code: identifiers through the checker, string literals as text, everything between tokens as comments
    for (const sourceFile of sources) {
        const file = relative(sourceFile.fileName);
        for (const offset of offsetsOf(sourceFile.text)) {
            if (inlineSpans.get(sourceFile).some(([ start, end ]) => start <= offset && offset < end)) continue;
            const line = sourceFile.getLineAndCharacterOfPosition(offset).line + 1;
            let node = sourceFile;
            for (;;) {
                const child = ts.forEachChild(node, candidate => candidate.getStart(sourceFile) <= offset && offset < candidate.getEnd() ? candidate : undefined);
                if (!child) break;
                node = child;
            }
            if (ts.isStringLiteralLike(node)) {
                // ref.setInput("name", …): the string names an input of the component the reference was created for
                const call = node.parent;
                const named = ts.isCallExpression(call) && call.arguments[0] === node && node.text === TASK.from && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "setInput";
                const created = named ? checker.getTypeArguments(checker.getTypeAtLocation(call.expression.expression))[0]?.getSymbol()?.valueDeclaration : undefined;
                const member = created && ts.isClassDeclaration(created) ? memberOf(created) : undefined;
                if (named && !member) problems.push(`${file}:${line}: setInput("${TASK.from}") on a reference whose component the type checker does not know`);
                else if (member) found.push({ file, line, inline: false, ...classify(member, "string", selectorOf.get(created)) });
                else found.push({ file, line, role: "decoy", kind: "text", on: null });
            } else if (!ts.isIdentifier(node)) found.push({ file, line, role: "decoy", kind: "comment", on: null });
            else {
                const member = checker.getSymbolAtLocation(node)?.valueDeclaration;
                if (!member || !ts.isPropertyDeclaration(member) || !ts.isClassDeclaration(member.parent)) problems.push(`${file}:${line}: the type checker does not know which class member this ${TASK.from} is`);
                else found.push({ file, line, inline: false, ...classify(member, member.name === node ? "declaration" : "class-read") });
            }
        }
    }

    // templates
    const templateFiles = new Set(templates.map(template => template.file));
    for (const template of templates) {
        const result = parseTemplate(template.text, template.file, { preserveWhitespaces: true, collectCommentNodes: true });
        for (const error of result.errors ?? []) problems.push(`${template.file}: ${error.msg}`);
        const seen = new Map();
        const names = new TemplateNames();
        names.visitAllTemplateNodes(result.nodes);
        new TemplateOccurrences(template.text, names.names, (offset, occurrence) => seen.set(offset, occurrence)).visitAllTemplateNodes(result.nodes);
        for (const comment of result.commentNodes ?? []) {
            for (const offset of offsetsOf(template.text, comment.sourceSpan.start.offset, comment.sourceSpan.end.offset)) seen.set(offset, { place: "comment" });
        }
        for (const offset of offsetsOf(template.text)) {
            const line = template.lineAt(offset);
            const occurrence = seen.get(offset);
            if (!occurrence) problems.push(`${template.file}:${line}: an occurrence the template parser does not explain`);
            else if (occurrence.place === "text" || occurrence.place === "comment") found.push({ file: template.file, line, role: "decoy", kind: occurrence.place, on: null });
            else {
                const holder = occurrence.tag || occurrence.through ? classOfTag.get(occurrence.tag ?? occurrence.through) : template.owner;
                const member = holder && memberOf(holder);
                if (!member) problems.push(`${template.file}:${line}: no class member behind this ${TASK.from}${occurrence.tag ? ` on <${occurrence.tag}>` : ""}`);
                else found.push({ file: template.file, line, inline: template.inline, ...classify(member, occurrence.place, occurrence.tag) });
            }
        }
        if (seen.size !== offsetsOf(template.text).length) problems.push(`${template.file}: the template parser reports ${seen.size} occurrences, the text has ${offsetsOf(template.text).length}`);
    }

    // style sheets: the name as an attribute selector on a tag, tag[name], belongs to the component behind that tag
    // (a plain attribute stays on the element in the page); the name must not stand anywhere else
    for (const file of listFiles(base)) {
        const name = relative(file);
        if (name.endsWith(".ts") || templateFiles.has(name)) continue;
        const text = readFileSync(file, "utf8");
        for (const offset of offsetsOf(text)) {
            const line = text.slice(0, offset).split("\n").length;
            const tag = name.endsWith(".css") && text[offset + TASK.from.length] === "]" ? /([a-z][\w-]*)\[$/.exec(text.slice(0, offset))?.[1] : undefined;
            const member = tag && classOfTag.has(tag) ? memberOf(classOfTag.get(tag)) : undefined;
            if (member) found.push({ file: name, line, inline: false, ...classify(member, "style", tag) });
            else problems.push(`${name}:${line}: holds the name, and is neither TypeScript, nor a template of a component, nor a selector tag[${TASK.from}] of a component that has such an input`);
        }
    }
    return { problems, found };
}

function selfTest(key) {
    const problems = [];
    const read = base => new Map(listFiles(path.join(ROOT, base)).map(file => [ slash(path.relative(path.join(ROOT, base), file)), readFileSync(file, "utf8") ]));
    const before = read(BEFORE);
    const after = read(AFTER);

    // 1. the text: every occurrence is in the key, a target line holds nothing but targets, the new name is new
    const listed = new Map();
    const note = (entry, role) => {
        const id = `${entry.file}:${entry.line}`;
        listed.set(id, { targets: 0, decoys: 0, ...listed.get(id) });
        listed.get(id)[role] += 1;
    };
    key.targets.forEach(entry => note(entry, "targets"));
    key.decoys.forEach(entry => note(entry, "decoys"));
    for (const [ file, text ] of before) {
        if (text.includes(TASK.to)) problems.push(`${BEFORE}/${file}: already holds ${TASK.to}`);
        for (const leak of LEAKS) if (text.includes(leak)) problems.push(`${BEFORE}/${file}: mentions ${leak}`);
        text.split("\n").forEach((line, position) => {
            const entry = listed.get(`${file}:${position + 1}`) ?? { targets: 0, decoys: 0 };
            const occurrences = offsetsOf(line).length;
            if (occurrences !== entry.targets + entry.decoys) problems.push(`${file}:${position + 1}: ${occurrences} occurrences in the file, ${entry.targets + entry.decoys} in the key`);
            if (entry.targets && entry.decoys) problems.push(`${file}:${position + 1}: a target and a decoy share the line`);
            listed.delete(`${file}:${position + 1}`);
        });
    }
    for (const id of listed.keys()) problems.push(`${id}: in the key, but there is no such line`);

    // 2. applying the key to the tree before gives the tree after, byte for byte
    if ([ ...before.keys() ].join("\n") !== [ ...after.keys() ].join("\n")) problems.push(`${BEFORE}/ and ${AFTER}/ do not hold the same files`);
    for (const [ file, text ] of before) {
        const wanted = new Map();
        key.targets.filter(entry => entry.file === file).forEach(entry => wanted.set(entry.line, (wanted.get(entry.line) ?? 0) + 1));
        const applied = text.split("\n").map((line, position) => {
            let left = wanted.get(position + 1) ?? 0;
            return line.replace(new RegExp(TASK.from, "g"), match => left-- > 0 ? TASK.to : match);
        }).join("\n");
        if (applied !== after.get(file)) problems.push(`${file}: the key applied to ${BEFORE}/ does not give ${AFTER}/`);
    }

    // 3. the meaning: every occurrence classified again from the files, compared with the key as a multiset
    const scan = scanWorkspace(path.join(ROOT, BEFORE));
    problems.push(...scan.problems);
    const idOf = (entry, role) => `${entry.file}:${entry.line} ${role} ${entry.kind} on ${entry.on}${role === "target" ? ` inline ${entry.inline}` : ""}`;
    const fromKey = [ ...key.targets.map(entry => idOf(entry, "target")), ...key.decoys.map(entry => idOf(entry, "decoy")) ].sort();
    const fromFiles = scan.found.map(entry => idOf(entry, entry.role)).sort();
    const surplus = (left, right) => {
        const pool = new Map();
        right.forEach(id => pool.set(id, (pool.get(id) ?? 0) + 1));
        return left.filter(id => {
            if (!pool.get(id)) return true;
            pool.set(id, pool.get(id) - 1);
            return false;
        });
    };
    surplus(fromKey, fromFiles).forEach(id => problems.push(`in the key, not found in the files: ${id}`));
    surplus(fromFiles, fromKey).forEach(id => problems.push(`found in the files, not in the key: ${id}`));

    // 4. the counts of the key, derived once more from the scan
    const scanned = role => scan.found.filter(entry => entry.role === role);
    const rederived = {
        targets: scanned("target").length,
        byKind: tally(TARGET_KINDS, scanned("target").map(entry => entry.kind)),
        byTag: tally(RENAMED_TAGS, scanned("target").map(entry => entry.on)),
        decoys: scanned("decoy").length,
        decoysByKind: tally(DECOY_KINDS, scanned("decoy").map(entry => entry.kind)),
        files: before.size,
        targetFiles: new Set(scanned("target").map(entry => entry.file)).size
    };
    if (JSON.stringify(rederived) !== JSON.stringify(key.counts)) problems.push(`counts from the files ${JSON.stringify(rederived)} differ from the key ${JSON.stringify(key.counts)}`);

    const hash = createHash("sha256");
    for (const [ base, tree ] of [ [ BEFORE, before ], [ AFTER, after ] ]) tree.forEach((text, file) => hash.update(base).update("\0").update(file).update("\0").update(text).update("\0"));
    hash.update(readFileSync(KEY_FILE, "utf8"));
    return { problems, treeHash: hash.digest("hex").slice(0, 16) };
}

/** ngc -p tsconfig.json in one tree; the compiler is found by walking up, as node itself would. */
function compile(base) {
    let directory = path.join(ROOT, base);
    const bin = "node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js";
    while (!existsSync(path.join(directory, bin)) && path.dirname(directory) !== directory) directory = path.dirname(directory);
    if (!existsSync(path.join(directory, bin))) return `${base}/: ngc not found above it`;
    const run = spawnSync(process.execPath, [ path.join(directory, bin), "-p", "tsconfig.json" ], { cwd: path.join(ROOT, base), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "").trim();
    return run.status === 0 ? undefined : `${base}/: ngc exit ${run.status}\n${output.split("\n").slice(0, 30).join("\n")}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Run: check the model, write both trees and the key, test what was written.
// ---------------------------------------------------------------------------------------------------------------------
function fail(title, problems) {
    console.error(`generate-rename: ${title}`);
    problems.slice(0, 40).forEach(problem => console.error(`  - ${problem}`));
    if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
    process.exit(1);
}

const files = workspaceFiles();
const model = checkModel(files);
if (model.problems.length) fail("the model does not hold together, nothing was written", model.problems);

const key = answerKey(files);
for (const [ base, name ] of [ [ BEFORE, TASK.from ], [ AFTER, TASK.to ] ]) {
    rmSync(path.join(ROOT, base), { recursive: true, force: true });
    for (const [ relative, rows ] of files) {
        const file = path.join(ROOT, base, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, textOf(rows, name));
    }
}
writeFileSync(KEY_FILE, JSON.stringify(key, null, 2) + "\n");

const { problems, treeHash } = selfTest(key);
if (problems.length) fail("the emitted files do not agree with the model (rename-key.json is not to be trusted)", problems);

if (process.argv.includes("--compile")) {
    const failures = [ BEFORE, AFTER ].map(compile).filter(Boolean);
    if (failures.length) fail("a tree does not compile", failures);
}

const { counts } = key;
const inlineTargets = key.targets.filter(entry => entry.inline).length;
console.log(`${BEFORE}/ and ${AFTER}/ (${TASK.component}.${TASK.from} -> ${TASK.to}): ${FEATURES} features in ${STYLES} template styles, ${MODEL.filter(feature => feature.inline).length} with an inline template; `
    + `${counts.targets} targets in ${counts.targetFiles} of ${counts.files} files (${TARGET_KINDS.map(kind => `${counts.byKind[kind]} ${kind}`).join(", ")}; ${RENAMED_TAGS.map(tag => `${counts.byTag[tag]} on <${tag}>`).join(", ")}; ${inlineTargets} in inline templates), `
    + `${counts.decoys} decoys (${DECOY_KINDS.map(kind => `${counts.decoysByKind[kind]} ${kind}`).join(", ")}); self-test passed${process.argv.includes("--compile") ? ", ngc exit 0 in both trees" : ""}, sha256 ${treeHash}`);
