// Generates hybrid/: a hybrid AngularJS (1.x) + Angular app glued together with ngUpgrade (a Roman camp admin), used by the
// "six migration-planning questions" benchmark. Nothing in it is ever built. The answer key (hybrid-key.json, next to the
// workspace, never inside it) is computed from the explicit model below, not from the generated text; after writing, a
// self-test re-derives the six answers by scanning the emitted files and exits 1 when model and emission disagree.
// Two more invariants are checked: the answers do not change when uses inside dead code are not counted (the task counts them),
// and the names marked plain in TRAPS (one unused thing per kind without any decoy) are mentioned nowhere but in their own files.
//   node scripts/generate-hybrid.mjs            (OUT=<dir> writes hybrid/ and hybrid-key.json somewhere else)
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HtmlParser, parseTemplate } from "@angular/compiler";
import ts from "typescript";

const ROOT = process.env.OUT ?? path.resolve(import.meta.dirname, "..");
const BASE = path.join(ROOT, "hybrid");
const KEY_FILE = path.join(ROOT, "hybrid-key.json");
const AJS = "src/app/ajs";
const BUILT_IN_FILTERS = new Set([ "orderBy", "filter", "limitTo", "uppercase", "lowercase", "date", "number", "currency", "json" ]);
const BUILT_IN_ELEMENTS = new Set([ "ng-include", "ui-view" ]);

const kebab = name => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const pascal = name => name[0].toUpperCase() + name.slice(1);
const words = text => (text ?? "").split(/\s+/).filter(Boolean);
const indent = (text, spaces) => text.split("\n").map(line => line ? " ".repeat(spaces) + line : line).join("\n");
const sorted = names => [ ...names ].sort();

/** "standardBearer*2 centurionCard" -> { standardBearer: 2, centurionCard: 1 } */
const counted = text => Object.fromEntries(words(text).map(word => [ word.split("*")[0], Number(word.split("*")[1] ?? 1) ]));

function dedent(text) {
    const rows = text.replace(/^\n/, "").replace(/\n[ \t]*$/, "").split("\n");
    const margin = Math.min(...rows.filter(row => row.trim()).map(row => row.match(/^ */)[0].length));
    return rows.map(row => row.slice(margin)).join("\n");
}

/** One AngularJS template and what the model says is in it; the text is checked against these facts before anything is written. */
function view(html, facts = {}) {
    return {
        html: dedent(html),
        renders: counted(facts.renders),
        directives: words(facts.directives),
        downgraded: words(facts.downgraded),
        filters: words(facts.filters),
        includes: words(facts.includes)
    };
}

const partial = (file, html, facts) => ({ file, ...view(html, facts) });
const includeOf = id => `<ng-include src="'app/ajs/${PARTIALS[id].file}'"></ng-include>`;

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 1: ng-include partials (every one is included by a component template, a state template or another partial).
// ---------------------------------------------------------------------------------------------------------------------
const PARTIALS = {
    legionCardFooter: partial("features/legions/partials/legion-card-footer.html", `
        <footer class="legion-card__footer">
            <span class="standard-bearer">{{ ::$ctrl.legion.bearerName || 'no bearer' }}</span>
            <span>{{ ::$ctrl.legion.pay | denarii:'short' | padLeft:8 }}</span>
            <small ng-if="$ctrl.legion.founded">since {{ ::$ctrl.legion.founded | date:'yyyy' }}</small>
        </footer>
    `, { filters: "denarii padLeft" }),
    cohortLegend: partial("features/legions/partials/cohort-legend.html", `
        <p class="cohort-legend">
            <span class="cohort-legend__mark cohort-legend__mark--full"></span> full strength
            <span class="cohort-legend__mark"></span> under {{ $ctrl.cohortSize }} men
        </p>
    `),
    centurionContact: partial("features/legions/partials/centurion-contact.html", `
        <address class="centurion-contact">
            <a ng-href="mailto:{{ ::$ctrl.centurion.email }}">{{ ::$ctrl.centurion.email }}</a>
            <span ng-if="$ctrl.centurion.tent">tent {{ ::$ctrl.centurion.tent }}</span>
        </address>
    `),
    legionHonours: partial("features/legions/partials/legion-honours.html", `
        <div class="legion-honours" ng-if="$ctrl.legion.honours.length">
            <h4>Honours</h4>
            <standard-bearer legion="$ctrl.legion" label="{{ $ctrl.legion.honours.length }} honours" type="'laurel'"></standard-bearer>
            <ul>
                <li ng-repeat="honour in $ctrl.legion.honours">{{ ::honour.year }} - {{ ::honour.title }}</li>
            </ul>
        </div>
    `, { renders: "standardBearer" }),
    rationTotals: partial("features/rations/partials/ration-totals.html", `
        <div class="ration-totals">
            <span>Total</span>
            <strong>{{ ::$ctrl.total | denarii:'short' | padLeft:6 }}</strong>
            <span ng-bind="$ctrl.legend || 'Rations | this month'"></span>
        </div>
    `, { filters: "denarii padLeft" }),
    rationRowActions: partial("features/rations/partials/ration-row-actions.html", `
        <span class="ration-row-actions">
            <button type="button" tooltip-hint="Edit this ration" ui-sref="rations.ledger({ rationId: $ctrl.ration.id })">Edit</button>
            <button type="button"
                    confirm-click="$ctrl.remove()"
                    confirm-message="Remove {{ ::$ctrl.ration.name }}?">Remove</button>
        </span>
    `, { directives: "tooltipHint confirmClick" }),
    gaugeScale: partial("features/rations/partials/gauge-scale.html", `
        <ol class="gauge-scale">
            <li ng-repeat="mark in [ 0, 25, 50, 75, 100 ]"
                ng-class="{ 'gauge-scale__mark--reached': $ctrl.level >= mark }">{{ ::mark }}</li>
        </ol>
    `),
    supplyNotes: partial("features/rations/partials/supply-notes.html", `
        <div class="supply-notes">
            <p ng-repeat="note in $ctrl.notes | limitTo:3">{{ ::note.text }}</p>
            <p ng-if="!$ctrl.notes.length">No notes from the quartermaster.</p>
        </div>
    `),
    grainStoreContent: partial("features/rations/partials/grain-store-content.html", `
        <div class="grain-store">
            <h4>{{ ::$ctrl.store.name }}</h4>
            <progress max="100" value="{{ $ctrl.store.fill }}"></progress>
            <small>{{ $ctrl.store.fill }}% full, checked {{ $ctrl.store.checkedAt | date:'shortDate' }}</small>
        </div>
    `),
    denariiLedgerLines: partial("features/rations/partials/denarii-ledger-lines.html", `
        <div class="ledger__line" ng-repeat="entry in $ctrl.entries track by $index">
            <span>{{ ::entry.title }}</span>
            <amount-input value="entry.amount" name="entry-{{ $index }}" on-change="$ctrl.recount()"></amount-input>
        </div>
    `, { renders: "amountInput" }),
    armoryToolbar: partial("features/armory/partials/armory-toolbar.html", `
        <div class="armory-toolbar">
            <a ui-sref="armory.helmets" ui-sref-active="active">Helmets</a>
            <a ui-sref="armory.shields" ui-sref-active="active">Shields</a>
            <button type="button" ng-click="$ctrl.recount()" ng-disabled="$ctrl.counting">Recount</button>
        </div>
    `),
    armoryInventoryContent: partial("features/armory/partials/armory-inventory-content.html", `
        <div class="armory-inventory helmet-rack">
            <helmet-badge ng-repeat="helmet in $ctrl.items.helmets track by helmet.id" helmet="helmet" size="large"></helmet-badge>
            <p>{{ $ctrl.items.helmets.length }} helmets, {{ $ctrl.items.shields.length }} shields</p>
        </div>
    `, { renders: "helmetBadge" }),
    helmetSizes: partial("features/armory/partials/helmet-sizes.html", `
        <select name="size" ng-model="$ctrl.size" ng-options="size.id as size.label for size in $ctrl.sizes">
            <option value="">Any size</option>
        </select>
    `),
    shieldLegend: partial("features/armory/partials/shield-legend.html", `
        <p class="shield-legend">
            <span class="shield-badge shield-badge--sample"></span> painted
            <span class="shield-badge"></span> plain
        </p>
    `),
    patrolFilters: partial("features/patrols/partials/patrol-filters.html", `
        <form class="patrol-filters" name="patrolFilters">
            <input type="search" name="query" placeholder="Search the log" ng-model="$ctrl.query" auto-focus>
            <label><input type="checkbox" ng-model="$ctrl.nightOnly"> night patrols only</label>
        </form>
    `, { directives: "autoFocus" }),
    reportBody: partial("features/patrols/partials/report-body.html", `
        <div class="report-body">
            <p ng-repeat="line in $ctrl.report.lines track by $index">{{ ::line }}</p>
            <ng-include src="'app/ajs/features/patrols/partials/report-signature.html'"></ng-include>
        </div>
    `, { includes: "reportSignature" }),
    reportSignature: partial("features/patrols/partials/report-signature.html", `
        <footer class="report-signature">
            <centurion-card centurion="$ctrl.report.author" compact="true"></centurion-card>
            <span>{{ ::$ctrl.report.sealedWith }}</span>
        </footer>
    `, { renders: "centurionCard" }),
    watchLegend: partial("features/patrols/partials/watch-legend.html", `
        <p class="watch-legend">
            Four watches a night, three hours each. Camp time: {{ $ctrl.now }}
        </p>
    `),
    emptyList: partial("components/partials/empty-list.html", `
        <p class="empty-list">
            Nothing to show yet.
        </p>
    `),
    campFooter: partial("components/partials/camp-footer.html", `
        <footer class="camp-footer">
            <a ui-sref="legions.list">Back to the legions</a>
            <span>Castra, {{ $ctrl.today | date:'mediumDate' }}</span>
        </footer>
    `)
};

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 2: the 40 AngularJS components. `kind` is how the template is given (url = templateUrl, inline = a
// template: string, include = a template: string that is only an ng-include of a partial); init and methods are written
// once in the .js dialect and translated for the class controllers of the .ts files.
// ---------------------------------------------------------------------------------------------------------------------
function ajsComponent(name, dir, spec) {
    const kind = spec.kind ?? "url";
    const html = kind === "include" ? includeOf(spec.facts.includes) : spec.html;
    return {
        name, dir, kind,
        lang: spec.lang ?? "js",
        module: spec.module ?? "castra.core",
        quote: spec.quote ?? "double",
        about: spec.about,
        bindings: spec.bindings ?? {},
        injects: spec.injects ?? [],
        notes: spec.notes ?? [],
        locals: spec.locals ?? [],
        init: spec.init ?? [],
        methods: spec.methods ?? [],
        file: kind === "url" ? `${dir}/${kebab(name)}.html` : null,
        view: view(html, spec.facts)
    };
}

const COMPONENTS = [
    // --- legions ---
    ajsComponent("legionDashboard", "features/legions", {
        about: "The legions page: every legion in camp with its cohorts.",
        injects: [ "legionService", "cohortStore", "$state" ],
        init: [
            `$ctrl.loading = true;`,
            `legionService.list().then(function (legions) {`,
            `    $ctrl.legions = legions;`,
            `    $ctrl.firstLegion = legions[0];`,
            `    $ctrl.loading = false;`,
            `});`,
            `$ctrl.cohorts = cohortStore.all();`
        ],
        methods: [ [ "open", "legion", [ `$state.go("legions.detail", { legionId: legion.id });` ] ] ],
        facts: { renders: "campHeader sectionTitle legionCard standardBearer cohortTable standardBearerList", downgraded: "loadingSpinner" },
        html: `
            <camp-header title="Legions" active="'legions'"></camp-header>
            <loading-spinner ng-if="$ctrl.loading" [size]="'large'"></loading-spinner>
            <div class="legion-dashboard" ng-if="!$ctrl.loading">
                <section-title label="Legions in camp" type="primary"></section-title>
                <legion-card ng-repeat="legion in $ctrl.legions | orderBy:'number' track by legion.id"
                             legion="legion"
                             on-open="$ctrl.open(legion)"></legion-card>
                <standard-bearer
                    legion="$ctrl.firstLegion"
                    label="First legion"
                    type="'eagle'"
                ></standard-bearer>
                <cohort-table cohorts="$ctrl.cohorts" page-size="10"></cohort-table>
                <standard-bearer-list legions="$ctrl.legions"></standard-bearer-list>
            </div>
        `
    }),
    ajsComponent("legionCard", "features/legions/components", {
        about: "One legion as a card: its standards, its commander and its pay.",
        bindings: { legion: "<", onOpen: "&" },
        init: [ `$ctrl.expanded = false;` ],
        methods: [ [ "toggle", "", [ `$ctrl.expanded = !$ctrl.expanded;` ] ] ],
        facts: { renders: "standardBearer*2 centurionCard", downgraded: "legionBadge", includes: "legionCardFooter" },
        html: `
            <article class="legion-card" ng-class="{ 'legion-card--active': $ctrl.legion.active }" ng-click="$ctrl.onOpen()">
                <header><standard-bearer legion="$ctrl.legion" type="'eagle'"></standard-bearer> <standard-bearer legion="$ctrl.legion" type="'vexillum'" label="{{ ::$ctrl.legion.motto }}"></standard-bearer></header>
                <h3>{{ ::$ctrl.legion.name }} <legion-badge [legion]="$ctrl.legion"></legion-badge></h3>
                <centurion-card centurion="$ctrl.legion.commander" compact="true"></centurion-card>
                <div ng-include="'app/ajs/features/legions/partials/legion-card-footer.html'"></div>
            </article>
        `
    }),
    ajsComponent("legionStats", "features/legions/components", {
        lang: "ts",
        about: "Strength, supplies and pay chest of one legion. Angular screens render it through its upgrade wrapper.",
        bindings: { legion: "<" },
        injects: [ "legionService", "$scope" ],
        init: [
            `$ctrl.cohortSize = 480;`,
            `legionService.totals($ctrl.legion.id).then(function (totals) {`,
            `    $ctrl.totals = totals;`,
            `});`
        ],
        facts: { downgraded: "supplyMeter denariiAmount", filters: "denarii" },
        html: `
            <dl class="legion-stats">
                <dt>Strength</dt>
                <dd>{{ $ctrl.legion.strength | number }} of {{ $ctrl.cohortSize * 10 }}</dd>
                <dt>Supplies</dt>
                <dd><supply-meter [level]="$ctrl.legion.supplyLevel" [warn-below]="20"></supply-meter></dd>
                <dt>Pay chest</dt>
                <dd><denarii-amount [amount]="$ctrl.legion.payChest"></denarii-amount> ({{ ::$ctrl.legion.payChest | denarii }})</dd>
            </dl>
        `
    }),
    ajsComponent("cohortTable", "features/legions/components", {
        about: "The cohorts of a legion, one page at a time.",
        bindings: { cohorts: "<", pageSize: "<" },
        init: [
            `$ctrl.page = 1;`,
            `$ctrl.pages = Math.ceil($ctrl.cohorts.length / $ctrl.pageSize);`,
            `$ctrl.cohortSize = 480;`
        ],
        methods: [ [ "go", "page", [ `$ctrl.page = page;` ] ] ],
        facts: { renders: "cohortRow pagerControl", directives: "stickyHeader", includes: "emptyList cohortLegend" },
        html: `
            <!-- <standard-bearer legion="$ctrl.legion"></standard-bearer> moved to the legion roster -->
            <div class="cohort-table" sticky-header="top">
                <ol>
                    <li ng-repeat="cohort in $ctrl.cohorts | limitTo:$ctrl.pageSize track by cohort.id">
                        <cohort-row cohort="cohort" name="{{ ::cohort.name }}"></cohort-row>
                    </li>
                </ol>
                <ng-include src="'app/ajs/components/partials/empty-list.html'" ng-if="!$ctrl.cohorts.length"></ng-include>
                <div ng-include="'app/ajs/features/legions/partials/cohort-legend.html'"></div>
                <pager-control page="$ctrl.page" pages="$ctrl.pages" on-change="$ctrl.go(page)"></pager-control>
            </div>
        `
    }),
    ajsComponent("cohortRow", "features/legions/components", {
        about: "One cohort in the cohort table.",
        bindings: { cohort: "<", name: "@?" },
        injects: [ "legionNameFilter" ],
        notes: [ `cohortSize is the nominal strength of a cohort; the cohortSize filter used to print it as "480 men".` ],
        init: [
            `$ctrl.cohortSize = 480;`,
            `$ctrl.legionTitle = legionNameFilter($ctrl.cohort.legionId);`
        ],
        facts: { directives: "tooltipHint" },
        html: `
            <div class="cohort-row" tooltip-hint="{{ ::$ctrl.cohort.motto }}">
                <strong>{{ ::$ctrl.name }}</strong>
                <span>{{ ::$ctrl.legionTitle }}</span>
                <span ng-class="{ 'cohort-row__men--low': $ctrl.cohort.men < $ctrl.cohortSize }">{{ $ctrl.cohort.men }}</span>
            </div>
        `
    }),
    ajsComponent("cohortBanner", "features/legions/components", {
        lang: "ts",
        about: "The emblem and the name of a cohort.",
        bindings: { cohort: "<" },
        injects: [ "legionService" ],
        init: [ `$ctrl.legion = legionService.cached($ctrl.cohort.legionId);` ],
        html: `
            <div class="cohort-banner">
                <img ng-src="{{ ::$ctrl.cohort.emblemUrl }}" alt="">
                <span class="cohort-banner__name">{{ ::$ctrl.cohort.name | uppercase }}</span>
            </div>
        `
    }),
    ajsComponent("centurionCard", "features/legions/components", {
        lang: "ts",
        about: "A centurion with his rank; the compact form leaves the contact details out.",
        bindings: { centurion: "<", compact: "<" },
        injects: [ "$element" ],
        init: [ `$element.addClass("centurion-card-host");` ],
        facts: { downgraded: "rankInsignia", includes: "centurionContact" },
        html: `
            <div class="centurion-card" ng-class="{ 'centurion-card--compact': $ctrl.compact }">
                <rank-insignia [rank]="$ctrl.centurion.rank"></rank-insignia>
                <span class="centurion-card__name">{{ ::$ctrl.centurion.name }}</span>
                <ng-include src="'app/ajs/features/legions/partials/centurion-contact.html'" ng-if="!$ctrl.compact"></ng-include>
            </div>
        `
    }),
    ajsComponent("standardBearer", "features/legions/components", {
        about: "The standard of a legion with an optional caption.",
        bindings: { legion: "<", label: "@?", type: "<" },
        init: [ `$ctrl.type = $ctrl.type || "eagle";` ],
        html: `
            <span class="standard-bearer" ng-class="'standard-bearer--' + $ctrl.type">
                <i class="icon icon-standard" aria-hidden="true"></i>
                <span ng-if="$ctrl.label">{{ $ctrl.label }}</span>
                <span ng-if="!$ctrl.label">{{ ::$ctrl.legion.name }}</span>
            </span>
        `
    }),
    ajsComponent("standardBearerList", "features/legions/components", {
        about: "The standards of several legions in one list.",
        bindings: { legions: "<" },
        injects: [ "legionService" ],
        locals: [ `var standardsRegistry = {};` ],
        methods: [ [ "typeOf", "legion", [
            `if (!standardsRegistry[legion.id]) {`,
            `    standardsRegistry[legion.id] = legionService.standardOf(legion);`,
            `}`,
            `return standardsRegistry[legion.id];`
        ] ] ],
        facts: { renders: "standardBearer" },
        html: `
            <ul class="standard-bearer-list">
                <li ng-repeat="legion in $ctrl.legions track by legion.id">
                    <standard-bearer legion="legion" type="$ctrl.typeOf(legion)"></standard-bearer>
                </li>
            </ul>
        `
    }),
    ajsComponent("legionRoster", "features/legions/components", {
        kind: "inline",
        quote: "backtick",
        about: "A short roster: the standard of the first legion and a card per legion.",
        bindings: { legions: "<", onPick: "&" },
        facts: { renders: "standardBearer legionCard" },
        html: `
            <div class="legion-roster">
                <standard-bearer legion="$ctrl.legions[0]" type="'eagle'"></standard-bearer>
                <legion-card ng-repeat="legion in $ctrl.legions track by legion.id" legion="legion" on-open="$ctrl.onPick({ legion: legion })"></legion-card>
            </div>
        `
    }),
    // --- rations ---
    ajsComponent("rationBoard", "features/rations", {
        about: "The rations page: today's rations next to the state of the stores.",
        injects: [ "rationService", "supplyLedger", "$state" ],
        init: [
            `rationService.list().then(function (rations) {`,
            `    $ctrl.rations = rations;`,
            `});`,
            `$ctrl.ledger = supplyLedger.current();`,
            `$ctrl.store = rationService.grainStore();`
        ],
        methods: [ [ "select", "ration", [ `$state.go("rations.ledger", { rationId: ration.id });` ] ] ],
        facts: { renders: "campHeader sectionTitle rationTable supplyGauge grainStore", downgraded: "campAlert" },
        html: `
            <camp-header title="Rations" active="'rations'"></camp-header>
            <div class="ration-board">
                <section-title label="Daily rations" name="rations"></section-title>
                <ration-table rations="$ctrl.rations" on-select="$ctrl.select(ration)"></ration-table>
                <aside>
                    <supply-gauge level="$ctrl.ledger.level" label="Grain"></supply-gauge>
                    <grain-store store="$ctrl.store"></grain-store>
                    <camp-alert ng-if="$ctrl.ledger.level < 20" [message]="'Grain is running low'" [severity]="'warning'"></camp-alert>
                </aside>
                <ui-view></ui-view>
            </div>
        `
    }),
    ajsComponent("rationTable", "features/rations/components", {
        about: "Rations as rows, with a total underneath.",
        bindings: { rations: "<", onSelect: "&" },
        init: [
            `$ctrl.page = 1;`,
            `$ctrl.pages = Math.ceil($ctrl.rations.length / 20);`,
            `$ctrl.query = "";`,
            `$ctrl.total = $ctrl.rations.reduce(function (sum, ration) {`,
            `    return sum + ration.cost;`,
            `}, 0);`
        ],
        methods: [ [ "go", "page", [ `$ctrl.page = page;` ] ] ],
        facts: { renders: "rationRow pagerControl", directives: "stickyHeader", includes: "emptyList rationTotals" },
        html: `
            <div class="ration-table" sticky-header>
                <div class="ration-table__head">
                    <span>Ration</span><span>Weight</span><span>Cost</span>
                </div>
                <ration-row
                    ng-repeat="ration in $ctrl.rations | filter:$ctrl.query | orderBy:'name' track by ration.id"
                    ration="ration"
                    label="{{ ::ration.name }}"
                    on-select="$ctrl.onSelect({ ration: ration })"
                ></ration-row>
                <ng-include src="'app/ajs/components/partials/empty-list.html'" ng-if="!$ctrl.rations.length"></ng-include>
                <div ng-include="'app/ajs/features/rations/partials/ration-totals.html'"></div>
                <pager-control page="$ctrl.page" pages="$ctrl.pages" on-change="$ctrl.go(page)"></pager-control>
            </div>
        `
    }),
    ajsComponent("rationRow", "features/rations/components", {
        about: "One ration: what it is, how much of it and what it costs.",
        bindings: { ration: "<", onSelect: "&", label: "@?" },
        injects: [ "rationService", "$state" ],
        methods: [
            [ "update", "value", [ `rationService.setAmount($ctrl.ration.id, value);` ] ],
            [ "remove", "", [
                `rationService.remove($ctrl.ration.id).then(function () {`,
                `    $state.reload();`,
                `});`
            ] ]
        ],
        facts: { renders: "amountInput", downgraded: "rationCard", filters: "denarii", includes: "rationRowActions" },
        html: `
            <div class="ration-row" ng-click="$ctrl.onSelect()">
                <span class="ration-row__name">{{ ::$ctrl.label || $ctrl.ration.name }}</span>
                <ration-card [ration]="$ctrl.ration" (selected)="$ctrl.onSelect()"></ration-card>
                <amount-input value="$ctrl.ration.amount" name="amount" type="number" on-change="$ctrl.update(value)"></amount-input>
                <span class="ration-row__cost">{{ $ctrl.ration.cost | denarii }}</span>
                <ng-include src="'app/ajs/features/rations/partials/ration-row-actions.html'"></ng-include>
            </div>
        `
    }),
    ajsComponent("amountInput", "features/rations/components", {
        about: "A number field for an amount of denarii.",
        bindings: { value: "=", name: "@?", type: "@?", onChange: "&" },
        init: [ `$ctrl.type = $ctrl.type || "number";` ],
        html: `
            <label class="amount-input">
                <input type="{{ $ctrl.type || 'number' }}"
                       name="{{ ::$ctrl.name }}"
                       ng-model="$ctrl.value"
                       ng-model-options="{ debounce: 300 }"
                       ng-change="$ctrl.onChange({ value: $ctrl.value })">
                <span class="amount-input__unit">den.</span>
            </label>
        `
    }),
    ajsComponent("supplyGauge", "features/rations/components", {
        lang: "ts",
        about: "How full a store is, on a scale from 0 to 100.",
        bindings: { level: "<", label: "@?" },
        injects: [ "supplyService" ],
        init: [ `$ctrl.warnBelow = supplyService.warningLevel();` ],
        facts: { downgraded: "supplyMeter", includes: "gaugeScale" },
        html: `
            <div class="supply-gauge">
                <span class="supply-gauge__label" ng-if="$ctrl.label">{{ $ctrl.label }}</span>
                <supply-meter [level]="$ctrl.level" [warn-below]="$ctrl.warnBelow"></supply-meter>
                <ng-include src="'app/ajs/features/rations/partials/gauge-scale.html'"></ng-include>
            </div>
        `
    }),
    ajsComponent("supplyOverview", "features/rations/components", {
        about: "Grain, wine and crates at a glance.",
        injects: [ "rationService", "supplyService", "notificationHub" ],
        init: [
            `$ctrl.grainLevel = supplyService.level("grain");`,
            `$ctrl.wineLevel = supplyService.level("wine");`,
            `$ctrl.notes = [];`,
            `$ctrl.crates = [];`,
            `rationService.list().then(function (rations) {`,
            `    $ctrl.rations = rations;`,
            `});`,
            `notificationHub.info("Supply overview opened");`
        ],
        facts: { renders: "sectionTitle supplyGauge*2 rationSummary supplyCrate", includes: "supplyNotes" },
        html: `
            <section class="supply-overview">
                <section-title label="Supply overview"></section-title>
                <supply-gauge level="$ctrl.grainLevel" label="Grain"></supply-gauge>
                <supply-gauge level="$ctrl.wineLevel" label="Wine"></supply-gauge>
                <ration-summary rations="$ctrl.rations"></ration-summary>
                <supply-crate ng-repeat="crate in $ctrl.crates" crate="crate"></supply-crate>
                <div ng-include="'app/ajs/features/rations/partials/supply-notes.html'"></div>
            </section>
        `
    }),
    ajsComponent("rationSummary", "features/rations/components", {
        kind: "inline",
        about: "One line that sums the rations up.",
        bindings: { rations: "<" },
        methods: [ [ "weight", "", [
            `return $ctrl.rations.reduce(function (sum, ration) {`,
            `    return sum + ration.weight;`,
            `}, 0);`
        ] ] ],
        facts: { filters: "rationUnit" },
        html: `<p class="ration-summary">{{ $ctrl.rations.length }} rations, {{ $ctrl.weight() | rationUnit:'modius' }} in store</p>`
    }),
    ajsComponent("grainStore", "features/rations/components", {
        kind: "include",
        about: "The granary: a thin wrapper around its partial.",
        bindings: { store: "<" },
        facts: { includes: "grainStoreContent" }
    }),
    ajsComponent("denariiLedger", "features/rations/components", {
        about: "The pay ledger with an editable amount per line.",
        bindings: { entries: "<" },
        injects: [ "rationService" ],
        init: [ `$ctrl.recount();` ],
        methods: [ [ "recount", "", [ `$ctrl.balance = rationService.balanceOf($ctrl.entries);` ] ] ],
        facts: { filters: "denarii", includes: "denariiLedgerLines" },
        html: `
            <div class="ledger">
                <h4>Pay ledger</h4>
                <div ng-include="'app/ajs/features/rations/partials/denarii-ledger-lines.html'"></div>
                <p>Balance: {{ $ctrl.balance | denarii:'long' }}</p>
            </div>
        `
    }),
    ajsComponent("supplyCrate", "features/rations/components", {
        about: "A crate in the store; opening it is confirmed first.",
        bindings: { crate: "<" },
        injects: [ "notificationHub" ],
        methods: [ [ "open", "", [ `notificationHub.info("Crate " + $ctrl.crate.label + " opened");` ] ] ],
        facts: { directives: "confirmClick" },
        html: `
            <div class="supply-crate">
                <span>{{ ::$ctrl.crate.label }}</span>
                <span>{{ $ctrl.crate.weight | number:1 }} lb</span>
                <button type="button" confirm-click="$ctrl.open()">Open</button>
            </div>
        `
    }),
    // --- armory ---
    ajsComponent("armoryPage", "features/armory", {
        about: "The armory page: helmets, shields and swords in stock.",
        injects: [ "armoryService", "$state" ],
        init: [
            `$ctrl.counting = false;`,
            `armoryService.inventory().then(function (items) {`,
            `    $ctrl.items = items;`,
            `    $ctrl.shields = items.shields;`,
            `    $ctrl.gladii = items.gladii;`,
            `});`
        ],
        methods: [ [ "recount", "", [
            `$ctrl.counting = true;`,
            `armoryService.inventory().then(function () {`,
            `    $state.reload();`,
            `});`
        ] ] ],
        facts: { renders: "campHeader armoryInventory gladiusCounter shieldList standardBearer", includes: "armoryToolbar" },
        html: `
            <camp-header title="Armory" active="'armory'"></camp-header>
            <div class="armory-page">
                <div ng-include="'app/ajs/features/armory/partials/armory-toolbar.html'"></div>
                <armory-inventory items="$ctrl.items"></armory-inventory>
                <gladius-counter count="$ctrl.gladii" label="Gladii"></gladius-counter>
                <shield-list shields="$ctrl.shields" ng-if="$ctrl.shields.length"></shield-list>
                <standard-bearer legion="$ctrl.guardLegion" type="'guard'"></standard-bearer>
                <ui-view></ui-view>
            </div>
        `
    }),
    ajsComponent("helmetBadge", "features/armory/components", {
        kind: "inline",
        quote: "backtick",
        about: "A helmet with the name of the legionary it was issued to.",
        bindings: { helmet: "<", size: "@?" },
        facts: { renders: "helmetIcon" },
        html: `
            <span class="helmet-badge">
                <helmet-icon type="$ctrl.helmet.type" size="{{ $ctrl.size || 'small' }}"></helmet-icon>
                {{ ::$ctrl.helmet.owner }}
            </span>
        `
    }),
    ajsComponent("helmetIcon", "features/armory/components", {
        about: "The helmet pictogram.",
        bindings: { type: "<", size: "@?" },
        html: `
            <i class="helmet-icon helmet-icon--{{ $ctrl.size || 'small' }}"
               ng-class="'helmet-icon--' + $ctrl.type"
               aria-hidden="true"></i>
        `
    }),
    ajsComponent("helmetRack", "features/armory/components", {
        about: "Helmets on a rack, one hook per helmet.",
        bindings: { helmets: "<" },
        injects: [ "armoryService" ],
        init: [ `$ctrl.helmets = $ctrl.helmets || armoryService.cachedHelmets();` ],
        facts: { directives: "tooltipHint" },
        html: `
            <ul class="rack">
                <li ng-repeat="helmet in $ctrl.helmets track by helmet.id" tooltip-hint="{{ ::helmet.owner }}">
                    {{ ::helmet.type | uppercase }}
                </li>
            </ul>
        `
    }),
    ajsComponent("shieldList", "features/armory/components", {
        about: "Every shield in the armory, ordered by cohort.",
        bindings: { shields: "<" },
        injects: [ "armoryService" ],
        notes: [ `shieldWall rendered the same shields in two rows; it was dropped from the armory page.` ],
        init: [
            `$ctrl.page = 1;`,
            `$ctrl.pages = armoryService.pageCount($ctrl.shields);`
        ],
        methods: [ [ "go", "page", [ `$ctrl.page = page;` ] ] ],
        facts: { renders: "shieldBadge pagerControl", includes: "emptyList shieldLegend" },
        html: `
            <div class="shield-list">
                <shield-badge ng-repeat="shield in $ctrl.shields | orderBy:[ 'cohort', 'number' ] track by shield.id" shield="shield"></shield-badge>
                <ng-include src="'app/ajs/components/partials/empty-list.html'" ng-if="!$ctrl.shields.length"></ng-include>
                <div ng-include="'app/ajs/features/armory/partials/shield-legend.html'"></div>
                <pager-control page="$ctrl.page" pages="$ctrl.pages" on-change="$ctrl.go(page)"></pager-control>
            </div>
        `
    }),
    ajsComponent("shieldBadge", "features/armory/components", {
        about: "A shield with its cohort and number.",
        bindings: { shield: "<", label: "@?" },
        html: `
            <span class="shield-badge" ng-class="{ 'shield-badge--painted': $ctrl.shield.painted }" title="{{ ::$ctrl.label }}">
                {{ ::$ctrl.shield.cohort }}-{{ ::$ctrl.shield.number }}
            </span>
        `
    }),
    ajsComponent("shieldWall", "features/armory/components", {
        lang: "ts",
        about: "Shields in two rows, the way a testudo is drawn up.",
        bindings: { shields: "<" },
        injects: [ "armoryService" ],
        init: [
            `$ctrl.front = armoryService.frontRow($ctrl.shields);`,
            `$ctrl.rear = armoryService.rearRow($ctrl.shields);`
        ],
        facts: { renders: "shieldBadge*2" },
        html: `
            <div class="wall">
                <shield-badge ng-repeat="shield in $ctrl.front" shield="shield" label="front"></shield-badge>
                <shield-badge ng-repeat="shield in $ctrl.rear" shield="shield" label="rear"></shield-badge>
            </div>
        `
    }),
    ajsComponent("armoryInventory", "features/armory/components", {
        kind: "include",
        about: "What is in the armory: a thin wrapper around its partial.",
        bindings: { items: "<" },
        facts: { includes: "armoryInventoryContent" }
    }),
    ajsComponent("gladiusCounter", "features/armory/components", {
        lang: "ts",
        about: "A count with plus and minus buttons.",
        bindings: { count: "<", label: "@?" },
        methods: [ [ "step", "delta", [ `$ctrl.count = Math.max(0, $ctrl.count + delta);` ] ] ],
        html: `
            <div class="gladius-counter">
                <span class="gladius-counter__label">{{ $ctrl.label || 'Swords' }}</span>
                <output>{{ $ctrl.count | number }}</output>
                <button type="button" ng-click="$ctrl.step(1)">+</button>
                <button type="button" ng-click="$ctrl.step(-1)" ng-disabled="$ctrl.count <= 0">-</button>
            </div>
        `
    }),
    // --- patrols ---
    ajsComponent("patrolBoard", "features/patrols", {
        about: "The patrols page: the log, the watches and the tents.",
        injects: [ "patrolService", "reportCache", "$state" ],
        init: [
            `$ctrl.query = "";`,
            `$ctrl.nightOnly = false;`,
            `patrolService.entries().then(function (entries) {`,
            `    $ctrl.entries = entries;`,
            `});`,
            `$ctrl.watches = patrolService.watches();`,
            `$ctrl.tents = reportCache.get("tents") || [];`
        ],
        methods: [ [ "pickTent", "tent", [ `$state.go("patrols.map", { tentId: tent.id });` ] ] ],
        facts: { renders: "campHeader patrolLogEntry watchSchedule tentMap standardBearer", includes: "patrolFilters emptyList" },
        html: `
            <camp-header title="Patrols" active="'patrols'"></camp-header>
            <div class="patrol-board">
                <ng-include src="'app/ajs/features/patrols/partials/patrol-filters.html'"></ng-include>
                <patrol-log-entry ng-repeat="entry in $ctrl.entries | filter:$ctrl.query track by entry.id" entry="entry"></patrol-log-entry>
                <ng-include src="'app/ajs/components/partials/empty-list.html'" ng-if="!$ctrl.entries.length"></ng-include>
                <watch-schedule watches="$ctrl.watches"></watch-schedule>
                <tent-map tents="$ctrl.tents" on-pick="$ctrl.pickTent(tent)"></tent-map>
                <standard-bearer legion="$ctrl.dutyLegion" label="On duty" type="'duty'"></standard-bearer>
                <ui-view></ui-view>
            </div>
        `
    }),
    ajsComponent("patrolLog", "features/patrols/components", {
        about: "The patrol log as a plain list of entries.",
        bindings: { entries: "<" },
        injects: [ "patrolService" ],
        init: [ `$ctrl.entries = $ctrl.entries || patrolService.cachedEntries();` ],
        facts: { renders: "patrolLogEntry" },
        html: `
            <div class="log">
                <h4>{{ $ctrl.entries.length }} entries</h4>
                <patrol-log-entry ng-repeat="entry in $ctrl.entries track by entry.id" entry="entry"></patrol-log-entry>
            </div>
        `
    }),
    ajsComponent("patrolLogEntry", "features/patrols/components", {
        about: "One line of the patrol log.",
        bindings: { entry: "<" },
        injects: [ "patrolService" ],
        methods: [ [ "dismiss", "", [ `patrolService.dismiss($ctrl.entry.id);` ] ] ],
        facts: { directives: "confirmClick", downgraded: "dateStamp" },
        html: `
            <div class="patrol-log-entry" ng-class="{ 'patrol-log-entry--night': $ctrl.entry.night }">
                <date-stamp [value]="$ctrl.entry.at"></date-stamp>
                <span>{{ ::$ctrl.entry.route }} - {{ ::$ctrl.entry.leader || 'unassigned' }}</span>
                <button type="button" confirm-click="$ctrl.dismiss()">Dismiss</button>
            </div>
        `
    }),
    ajsComponent("tentMap", "features/patrols/components", {
        lang: "ts",
        about: "The tents of the camp, row by row.",
        bindings: { tents: "<", onPick: "&" },
        injects: [ "patrolService" ],
        init: [ `$ctrl.rows = patrolService.rowsOf($ctrl.tents);` ],
        facts: { renders: "tentRow" },
        html: `
            <div class="tent-map">
                <tent-row ng-repeat="row in $ctrl.rows track by $index" tents="row" name="row-{{ $index }}"></tent-row>
                <p class="tent-map__hint" ng-if="!$ctrl.rows.length">No tents pitched yet.</p>
            </div>
        `
    }),
    ajsComponent("tentRow", "features/patrols/components", {
        about: "One row of tents.",
        bindings: { tents: "<", name: "@?" },
        methods: [ [ "pick", "tent", [ `tent.taken = !tent.taken;` ] ] ],
        html: `
            <div class="tent-row" data-name="{{ ::$ctrl.name }}">
                <button type="button" name="tent" class="tent-row__tent" ng-repeat="tent in $ctrl.tents" ng-click="$ctrl.pick(tent)" ng-class="{ 'tent-row__tent--taken': tent.taken }">
                    {{ ::tent.number }}
                </button>
            </div>
        `
    }),
    ajsComponent("tentInspector", "features/patrols/components", {
        about: "A single tent with the number of beds taken.",
        bindings: { tent: "<" },
        injects: [ "patrolService" ],
        init: [ `$ctrl.tent = $ctrl.tent || patrolService.firstTent();` ],
        facts: { renders: "tentRow" },
        html: `
            <div class="tent-inspector">
                <tent-row tents="[ $ctrl.tent ]" name="inspected"></tent-row>
                <p>{{ $ctrl.tent.occupants }} of {{ $ctrl.tent.capacity }} beds taken</p>
            </div>
        `
    }),
    ajsComponent("reportPanel", "features/patrols/components", {
        about: "A patrol report: title, date and the body with the signature.",
        bindings: { report: "<" },
        injects: [ "reportCache" ],
        init: [ `reportCache.put($ctrl.report.id, $ctrl.report);` ],
        facts: { downgraded: "dateStamp", includes: "reportBody" },
        html: `
            <article class="report-panel">
                <h3>{{ ::$ctrl.report.title }}</h3>
                <date-stamp [value]="$ctrl.report.filedAt"></date-stamp>
                <div ng-include="'app/ajs/features/patrols/partials/report-body.html'"></div>
            </article>
        `
    }),
    ajsComponent("watchSchedule", "features/patrols/components", {
        lang: "ts",
        about: "The night watches and the legion that stands them.",
        bindings: { watches: "<" },
        injects: [ "patrolService", "$interval" ],
        init: [
            `$ctrl.start = "18:00";`,
            `$ctrl.now = patrolService.campTime();`,
            `$interval(function () {`,
            `    $ctrl.now = patrolService.campTime();`,
            `}, 60000);`
        ],
        facts: { renders: "standardBearer", directives: "autoFocus", includes: "watchLegend" },
        html: `
            <div class="watch-schedule">
                <input type="time" name="start" ng-model="$ctrl.start" auto-focus>
                <ol>
                    <li ng-repeat="watch in $ctrl.watches track by watch.id">{{ ::watch.name }}: {{ watch.start }} - {{ watch.end }}</li>
                </ol>
                <standard-bearer legion="$ctrl.watchLegion" type="'watch'"></standard-bearer>
                <div ng-include="'app/ajs/features/patrols/partials/watch-legend.html'"></div>
            </div>
        `
    }),
    // --- shared ---
    ajsComponent("campHeader", "components", {
        module: "castra",
        about: "The header of every page with the links between the areas.",
        bindings: { title: "@", active: "<" },
        injects: [ "$state" ],
        methods: [ [ "isActive", "name", [ `return $state.includes(name);` ] ] ],
        html: `
            <nav class="camp-header">
                <h1>{{ ::$ctrl.title }}</h1>
                <a ui-sref="legions.list" ng-class="{ active: $ctrl.active === 'legions' }">Legions</a>
                <a ui-sref="rations" ng-class="{ active: $ctrl.active === 'rations' }">Rations</a>
                <a ui-sref="armory" ng-class="{ active: $ctrl.active === 'armory' }">Armory</a>
                <a ui-sref="patrols" ng-class="{ active: $ctrl.active === 'patrols' }">Patrols</a>
            </nav>
        `
    }),
    ajsComponent("sectionTitle", "components", {
        kind: "inline",
        about: "A section heading.",
        bindings: { label: "@", type: "@?", name: "@?" },
        html: `<h2 class="section-title section-title--{{ $ctrl.type || 'primary' }}" id="{{ ::$ctrl.name }}">{{ $ctrl.label }}</h2>`
    }),
    ajsComponent("pagerControl", "components", {
        about: "Previous and next page buttons.",
        bindings: { page: "<", pages: "<", onChange: "&" },
        html: `
            <div class="pager-control" ng-if="$ctrl.pages > 1">
                <button type="button" title="Previous page" ng-click="$ctrl.onChange({ page: $ctrl.page - 1 })" ng-disabled="$ctrl.page <= 1">&lsaquo;</button>
                <span>{{ $ctrl.page }} / {{ $ctrl.pages }}</span>
                <button type="button" title="Next page" ng-click="$ctrl.onChange({ page: $ctrl.page + 1 })" ng-disabled="$ctrl.page >= $ctrl.pages">&rsaquo;</button>
            </div>
        `
    })
];

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 3: attribute directives, filters, services and factories of the AngularJS side.
// ---------------------------------------------------------------------------------------------------------------------
const DIRECTIVES = [
    { name: "tooltipHint", injects: [ "$timeout" ], about: "Shows the given text as a hint once the pointer rests on the element.", link: [
        `element.on("mouseenter", function () {`,
        `    $timeout(function () {`,
        `        element.attr("title", attrs.tooltipHint);`,
        `    }, 300);`,
        `});`
    ] },
    { name: "autoFocus", injects: [ "$timeout" ], about: "Moves the focus to the element as soon as it is rendered.", link: [
        `$timeout(function () {`,
        `    element[0].focus();`,
        `});`
    ] },
    { name: "confirmClick", injects: [ "$window" ], about: "Asks before it runs the expression of a click.", link: [
        `element.on("click", function () {`,
        `    if ($window.confirm(attrs.confirmMessage || "Are you sure?")) {`,
        `        scope.$apply(attrs.confirmClick);`,
        `    }`,
        `});`
    ] },
    { name: "stickyHeader", injects: [ "$window", "$document" ], about: "Keeps the head of a long list in view while the page scrolls.", link: [
        `var offset = attrs.stickyHeader === "top" ? 0 : 48;`,
        `angular.element($window).on("scroll", function () {`,
        `    element.toggleClass("is-stuck", $document[0].documentElement.scrollTop > offset);`,
        `});`
    ] }
];

const FILTERS = [
    { name: "denarii", file: "castra", params: "value, mode", injects: [], body: [
        `var amount = Number(value) || 0;`,
        `return mode === "short" ? amount + " den." : amount + " denarii";`
    ] },
    { name: "padLeft", file: "castra", params: "value, width", injects: [], body: [
        `var text = String(value);`,
        `while (text.length < width) {`,
        `    text = " " + text;`,
        `}`,
        `return text;`
    ] },
    { name: "romanNumeral", file: "castra", params: "value", injects: [], body: [
        `var numerals = [ "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X" ];`,
        `return value > 10 ? "X" + numerals[value - 10] : numerals[value];`
    ] },
    { name: "legionName", file: "castra", params: "legionId", injects: [ "legionService" ], body: [
        `var legion = legionService.cached(legionId);`,
        `return legion ? legionService.title(legion) : "unknown legion";`
    ] },
    { name: "cohortSize", file: "castra", params: "value", injects: [], body: [
        `return (Number(value) || 0) + " men";`
    ] },
    { name: "rationUnit", file: "format", params: "value, unit", injects: [], body: [
        `return (Number(value) || 0).toFixed(1) + " " + unit;`
    ] },
    { name: "shortDate", file: "format", params: "value", injects: [], body: [
        `return value ? new Date(value).toLocaleDateString() : "";`
    ] },
    { name: "truncate", file: "format", params: "value, length", injects: [], body: [
        `var text = String(value || "");`,
        `return text.length > length ? text.slice(0, length) + "..." : text;`
    ] }
];
const FILTER_FILES = {
    castra: { file: "filters/castra.filters.js", about: "The filters every camp screen uses." },
    format: { file: "filters/format.filters.js", about: "Formatting filters for units, dates and long texts." }
};

const fetch = url => [
    `return $http.get(${url}).then(function (response) {`,
    `    return response.data;`,
    `});`
];

/** kind = how it is registered; annotated = registered with an inline array annotation instead of $inject. */
const SERVICES = [
    { name: "legionService", kind: "service", injects: [ "$http", "$filter" ], filterCalls: [ "romanNumeral" ],
        about: "Legions and their cohorts, loaded once and kept in memory.",
        locals: [ `var cache = {};` ],
        notes: [ `standardsRegistry used to keep the standards; they now arrive with each legion.` ],
        methods: [
            [ "list", "", [
                `return $http.get("/api/legions").then(function (response) {`,
                `    response.data.forEach(function (legion) {`,
                `        cache[legion.id] = legion;`,
                `    });`,
                `    return response.data;`,
                `});`
            ] ],
            [ "find", "legionId", fetch(`"/api/legions/" + legionId`) ],
            [ "cached", "legionId", [ `return cache[legionId];` ] ],
            [ "title", "legion", [ `return "Legio " + $filter("romanNumeral")(legion.number) + " " + legion.name;` ] ],
            [ "totals", "legionId", fetch(`"/api/legions/" + legionId + "/totals"`) ],
            [ "standardOf", "legion", [ `return legion.number === 1 ? "eagle" : "vexillum";` ] ]
        ] },
    { name: "rationService", kind: "service", injects: [ "$http", "$q" ],
        about: "Rations and the ledger lines that pay for them.",
        methods: [
            [ "list", "", fetch(`"/api/rations"`) ],
            [ "setAmount", "rationId, amount", [ `return $http.put("/api/rations/" + rationId, { amount: amount });` ] ],
            [ "remove", "rationId", [ `return $http.delete("/api/rations/" + rationId);` ] ],
            [ "save", "entry", [ `return entry.title ? $http.post("/api/ledger", entry) : $q.reject("title");` ] ],
            [ "balanceOf", "entries", [
                `return entries.reduce(function (sum, entry) {`,
                `    return sum + entry.amount;`,
                `}, 0);`
            ] ],
            [ "grainStore", "", [ `return { name: "Horreum", fill: 64, checkedAt: null };` ] ]
        ] },
    { name: "armoryService", kind: "service", injects: [ "$http" ],
        about: "Helmets, shields and swords of the armory.",
        locals: [ `var helmets = [];` ],
        methods: [
            [ "inventory", "", [
                `return $http.get("/api/armory").then(function (response) {`,
                `    helmets = response.data.helmets;`,
                `    return response.data;`,
                `});`
            ] ],
            [ "shields", "", fetch(`"/api/armory/shields"`) ],
            [ "cachedHelmets", "", [ `return helmets;` ] ],
            [ "frontRow", "shields", [ `return shields.slice(0, Math.ceil(shields.length / 2));` ] ],
            [ "rearRow", "shields", [ `return shields.slice(Math.ceil(shields.length / 2));` ] ],
            [ "pageCount", "items", [ `return Math.ceil(items.length / 20);` ] ]
        ] },
    { name: "patrolService", kind: "service", injects: [ "$http", "$injector" ], injectorGets: [ "campClock" ],
        about: "The patrol log, the night watches and the tents.",
        locals: [ `var entries = [];` ],
        methods: [
            [ "entries", "", [
                `return $http.get("/api/patrols").then(function (response) {`,
                `    entries = response.data;`,
                `    return entries;`,
                `});`
            ] ],
            [ "cachedEntries", "", [ `return entries;` ] ],
            [ "dismiss", "entryId", [ `return $http.delete("/api/patrols/" + entryId);` ] ],
            [ "watches", "", [ `return [ { id: 1, name: "Prima vigilia", start: "18:00", end: "21:00" } ];` ] ],
            [ "tents", "", fetch(`"/api/tents"`) ],
            [ "rowsOf", "tents", [
                `var rows = [];`,
                `for (var index = 0; index < tents.length; index += 8) {`,
                `    rows.push(tents.slice(index, index + 8));`,
                `}`,
                `return rows;`
            ] ],
            [ "firstTent", "", [ `return { number: 1, occupants: 0, capacity: 8 };` ] ],
            [ "campTime", "", [
                `// Looked up when it is needed: the clock starts its timer as soon as it is created.`,
                `return $injector.get("campClock").now();`
            ] ]
        ] },
    { name: "treasuryService", kind: "service", injects: [ "$http" ],
        about: "The pay chest of the camp.",
        locals: [ `var balance = 0;` ],
        methods: [
            [ "balance", "", [ `return balance;` ] ],
            [ "pay", "legionId, amount", [
                `balance -= amount;`,
                `return $http.post("/api/treasury/pay", { legionId: legionId, amount: amount });`
            ] ]
        ] },
    { name: "standardsRegistry", kind: "service", injects: [ "$http", "legionService" ],
        about: "Which standard belongs to which legion.",
        methods: [
            [ "all", "", fetch(`"/api/standards"`) ],
            [ "forLegion", "legionId", [ `return legionService.standardOf(legionService.cached(legionId));` ] ]
        ] },
    { name: "reportCache", kind: "factory", injects: [ "$cacheFactory" ],
        about: "Patrol reports that were already opened.",
        locals: [ `var cache = $cacheFactory("reports");` ],
        methods: [
            [ "get", "key", [ `return cache.get(key);` ] ],
            [ "put", "key, value", [ `return cache.put(key, value);` ] ]
        ] },
    { name: "supplyLedger", kind: "factory", annotated: true, injects: [ "$http", "treasuryService" ],
        about: "The level of the stores next to the money left to refill them.",
        locals: [ `var level = 50;` ],
        methods: [
            [ "current", "", [ `return { level: level, balance: treasuryService.balance() };` ] ],
            [ "refresh", "", [
                `return $http.get("/api/supplies/level").then(function (response) {`,
                `    level = response.data.level;`,
                `    return level;`,
                `});`
            ] ]
        ] },
    { name: "campClock", kind: "factory", injects: [ "$interval" ],
        about: "The time in camp, refreshed once a minute.",
        locals: [ `var time = "06:00";`, `$interval(tick, 60000);` ],
        methods: [
            [ "now", "", [ `return time;` ] ],
            [ "tick", "", [ `time = new Date().toTimeString().slice(0, 5);` ] ]
        ] },
    { name: "legacyReports", kind: "factory", injects: [ "$http", "reportCache" ],
        about: "Reports in the old format. The Angular treasury page still reads them.",
        methods: [
            [ "latest", "", fetch(`"/api/reports/latest"`) ],
            [ "find", "reportId", [ `return reportCache.get(reportId) || $http.get("/api/reports/" + reportId);` ] ]
        ] },
    { name: "tentAllocator", kind: "factory", injects: [ "patrolService" ],
        about: "Finds free tents for a cohort.",
        methods: [
            [ "allocate", "cohort", [
                `return patrolService.tents().then(function (tents) {`,
                `    return tents.filter(function (tent) {`,
                `        return !tent.taken;`,
                `    }).slice(0, cohort.tents);`,
                `});`
            ] ]
        ] },
    { name: "messengerQueue", kind: "factory", injects: [ "$timeout" ],
        about: "Messages for the couriers, sent in batches.",
        locals: [ `var queue = [];` ],
        methods: [
            [ "push", "message", [ `queue.push(message);` ] ],
            [ "flush", "", [
                `return $timeout(function () {`,
                `    queue.length = 0;`,
                `}, 500);`
            ] ]
        ] }
];

/** The run block of the application module: one more inline array annotation. */
const RUN_BLOCK = { injects: [ "$rootScope", "notificationHub" ] };

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 4: ui-router states, four routing files. A state shows a component by name, a template file with a
// controller, or an inline template.
// ---------------------------------------------------------------------------------------------------------------------
const ROUTING = [
    { area: "legions", controllers: [
        { name: "LegionDetailController", injects: [ "legion", "legionService", "$state" ], body: [
            `$ctrl.legion = legion;`,
            `$ctrl.neighbours = [];`,
            `$ctrl.today = Date.now();`,
            ``,
            `legionService.list().then(function (legions) {`,
            `    $ctrl.neighbours = legions.filter(function (other) {`,
            `        return other.id !== legion.id;`,
            `    });`,
            `});`,
            ``,
            `$ctrl.pick = function (picked) {`,
            `    $state.go("legions.detail", { legionId: picked.id });`,
            `};`,
            ``,
            `$ctrl.refresh = function () {`,
            `    $state.reload();`,
            `};`
        ] }
    ], states: [
        { name: "legions", url: "/legions", abstract: true, inline: view(`<ui-view></ui-view>`) },
        { name: "legions.list", url: "", component: "legionDashboard" },
        { name: "legions.detail", url: "/:legionId", controller: "LegionDetailController",
            resolve: [ [ "legion", [ "$stateParams", "legionService" ], `return legionService.find($stateParams.legionId);` ] ],
            view: partial("features/legions/legion-detail.html", `
                <camp-header title="Legion" active="'legions'"></camp-header>
                <section class="legion-detail">
                    <section-title label="{{ ::$ctrl.legion.name }}" type="primary"></section-title>
                    <legion-roster legions="[ $ctrl.legion ]" on-pick="$ctrl.pick(legion)"></legion-roster>
                    <cohort-table cohorts="$ctrl.legion.cohorts" page-size="5"></cohort-table>
                    <standard-bearer-list legions="$ctrl.neighbours"></standard-bearer-list>
                    <roll-call [legion-id]="$ctrl.legion.id" (closed)="$ctrl.refresh()"></roll-call>
                    <div ng-include="'app/ajs/features/legions/partials/legion-honours.html'"></div>
                </section>
                <ng-include src="'app/ajs/components/partials/camp-footer.html'"></ng-include>
            `, { renders: "campHeader sectionTitle legionRoster cohortTable standardBearerList", downgraded: "rollCall", includes: "legionHonours campFooter" }) },
        { name: "legions.standards", url: "/standards",
            resolve: [ [ "legions", [ "legionService" ], `return legionService.list();` ] ],
            inline: view(`<standard-bearer-list legions="$resolve.legions"></standard-bearer-list>`, { renders: "standardBearerList" }) }
    ] },
    { area: "rations", controllers: [
        { name: "RationLedgerController", injects: [ "rationService", "$stateParams" ], body: [
            `$ctrl.entry = { title: "", amount: 0, rationId: $stateParams.rationId };`,
            `$ctrl.saving = false;`,
            `$ctrl.notes = [];`,
            ``,
            `rationService.list().then(function (rations) {`,
            `    $ctrl.rations = rations;`,
            `});`,
            ``,
            `$ctrl.touch = function () {`,
            `    $ctrl.dirty = true;`,
            `};`,
            ``,
            `$ctrl.save = function () {`,
            `    $ctrl.saving = true;`,
            `    rationService.save($ctrl.entry).finally(function () {`,
            `        $ctrl.saving = false;`,
            `    });`,
            `};`
        ] }
    ], states: [
        { name: "rations", url: "/rations", component: "rationBoard" },
        { name: "rations.ledger", url: "/ledger/:rationId", controller: "RationLedgerController",
            view: partial("features/rations/ration-ledger-page.html", `
                <div class="ration-ledger" id="ration-ledger">
                    <section-title label="Ration ledger" type="secondary"></section-title>
                    <form name="ledgerForm" ng-submit="$ctrl.save()">
                        <input type="text" name="title" ng-model="$ctrl.entry.title" auto-focus>
                        <amount-input value="$ctrl.entry.amount" name="amount" on-change="$ctrl.touch()"></amount-input>
                        <button type="submit" ng-disabled="ledgerForm.$invalid || $ctrl.saving">Save</button>
                    </form>
                    <ration-summary rations="$ctrl.rations"></ration-summary>
                    <ng-include src="'app/ajs/features/rations/partials/supply-notes.html'"></ng-include>
                </div>
            `, { renders: "sectionTitle amountInput rationSummary", directives: "autoFocus", includes: "supplyNotes" }) },
        { name: "rations.supply", url: "/supply", inline: view(`<supply-overview></supply-overview>`, { renders: "supplyOverview" }) },
        { name: "treasury", url: "/treasury", inline: view(`<treasury-page></treasury-page>`, { downgraded: "treasuryPage" }) }
    ] },
    { area: "armory", controllers: [
        { name: "HelmetsPageController", injects: [ "armoryService" ], body: [
            `$ctrl.helmets = armoryService.cachedHelmets();`,
            `$ctrl.spare = 0;`,
            `$ctrl.size = "";`,
            `$ctrl.sizes = [ { id: "s", label: "Small" }, { id: "m", label: "Medium" }, { id: "l", label: "Large" } ];`
        ] }
    ], states: [
        { name: "armory", url: "/armory", component: "armoryPage" },
        { name: "armory.helmets", url: "/helmets", controller: "HelmetsPageController",
            view: partial("features/armory/helmets-page.html", `
                <section class="helmets-page">
                    <!-- <helmet-rack> was here -->
                    <section-title label="Helmets" type="secondary"></section-title>
                    <helmet-badge ng-repeat="helmet in $ctrl.helmets | filter:{ issued: true } track by helmet.id" helmet="helmet"></helmet-badge>
                    <gladius-counter count="$ctrl.spare" label="Spare helmets"></gladius-counter>
                    <div ng-include="'app/ajs/features/armory/partials/helmet-sizes.html'"></div>
                </section>
            `, { renders: "sectionTitle helmetBadge gladiusCounter", includes: "helmetSizes" }) },
        { name: "armory.shields", url: "/shields", component: "shieldList",
            resolve: [ [ "shields", [ "armoryService" ], `return armoryService.shields();` ] ] }
    ] },
    { area: "patrols", controllers: [
        { name: "ReportsPageController", injects: [ "reportCache", "patrolService" ], body: [
            `$ctrl.reports = reportCache.get("reports") || [];`,
            `$ctrl.latest = patrolService.cachedEntries()[0];`,
            `$ctrl.today = Date.now();`
        ] }
    ], states: [
        { name: "patrols", url: "/patrols", component: "patrolBoard" },
        { name: "patrols.reports", url: "/reports", controller: "ReportsPageController",
            view: partial("features/patrols/reports-page.html", `
                <section class="reports-page">
                    <section-title label="Patrol reports" type="secondary"></section-title>
                    <report-panel ng-repeat="report in $ctrl.reports track by report.id" report="report"></report-panel>
                    <patrol-log-entry entry="$ctrl.latest" ng-if="$ctrl.latest"></patrol-log-entry>
                </section>
                <ng-include src="'app/ajs/components/partials/camp-footer.html'"></ng-include>
            `, { renders: "sectionTitle reportPanel patrolLogEntry", includes: "campFooter" }) },
        { name: "patrols.map", url: "/map?tentId",
            resolve: [ [ "tents", [ "patrolService" ], `return patrolService.tents();` ] ],
            inline: view(`<tent-map tents="$resolve.tents"></tent-map>`, { renders: "tentMap" }) }
    ] }
];
const STATES = ROUTING.flatMap(routing => routing.states);

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 5: the Angular side. 24 standalone components (10 of them downgraded for AngularJS templates, 5 of them
// twins of an AngularJS component: same kebab name, not downgraded), 4 downgraded services, 5 UpgradeComponent wrappers,
// the upgrade providers. `uses` are the custom elements of the template, checked against the text like the AngularJS facts.
// ---------------------------------------------------------------------------------------------------------------------
const angularComponent = (className, selector, dir, spec) => ({
    className, selector, dir,
    base: selector.replace(/^app-/, ""),
    downgradedAs: spec.downgradedAs ?? null,
    external: spec.external ?? false,
    members: spec.members ?? [],
    imports: spec.imports ?? [],
    uses: counted(spec.uses),
    template: dedent(spec.template)
});

const ANGULAR_COMPONENTS = [
    angularComponent("RationCardComponent", "ration-card", "features/rations", {
        downgradedAs: "rationCard", external: true, imports: [ "SupplyMeterComponent", "DenariiAmountComponent" ], uses: "supply-meter denarii-amount",
        members: [ `readonly ration = input.required<any>();`, `readonly selected = output<any>();` ],
        template: `
            <div class="ration-card" (click)="selected.emit(ration())">
                <strong>{{ ration().name }}</strong>
                <supply-meter [level]="ration().stock" [warnBelow]="10" />
                <denarii-amount [amount]="ration().cost" />
            </div>
        `
    }),
    angularComponent("SupplyMeterComponent", "supply-meter", "features/rations", {
        downgradedAs: "supplyMeter",
        members: [ `readonly level = input.required<number>();`, `readonly warnBelow = input(20);` ],
        template: `<meter min="0" max="100" [value]="level()" [class.low]="level() < warnBelow()"></meter>`
    }),
    angularComponent("AmountInputComponent", "amount-input", "features/rations", {
        members: [ `readonly value = input(0);`, `readonly name = input("");`, `readonly changed = output<number>();` ],
        template: `<label class="amount-input"><input type="number" [name]="name()" [value]="value()" (input)="changed.emit($any($event.target).valueAsNumber)" /><span>den.</span></label>`
    }),
    angularComponent("SupplyForecastComponent", "app-supply-forecast", "features/rations", {
        external: true, imports: [ "SupplyGaugeDirective", "CenturionCardDirective" ], uses: "supply-gauge centurion-card",
        members: [ `readonly stores = signal<any[]>([]);`, `readonly quartermaster = signal<any>(null);` ],
        template: `
            <section class="supply-forecast">
                <h3>Forecast</h3>
                @for (store of stores(); track store.id) {
                    <supply-gauge [level]="store.level" [label]="store.name" />
                }
                <centurion-card [centurion]="quartermaster()" [compact]="true" />
            </section>
        `
    }),
    angularComponent("TreasuryPageComponent", "app-treasury-page", "features/treasury", {
        downgradedAs: "treasuryPage", external: true,
        imports: [ "CampHeaderComponent", "StandardBearerComponent", "AmountInputComponent", "DenariiAmountComponent", "QuartermasterPanelComponent", "SupplyForecastComponent", "ShortDatePipe" ],
        uses: "app-camp-header standard-bearer amount-input denarii-amount app-quartermaster-panel app-supply-forecast",
        members: [
            `private readonly reports = inject(LegacyReports);`,
            `readonly payLegion = signal<any>(null);`,
            `readonly payout = signal(0);`,
            `readonly balance = signal(0);`,
            `readonly auditedAt = signal<string | null>(null);`
        ],
        template: `
            <app-camp-header title="Treasury" />
            <section class="treasury-page">
                <standard-bearer [legion]="payLegion()" label="Paymaster" />
                <amount-input name="payout" [value]="payout()" (changed)="payout.set($event)" />
                <denarii-amount [amount]="balance()" />
                <p>Last audit: {{ auditedAt() | shortDate }}</p>
                <app-quartermaster-panel />
                <app-supply-forecast />
            </section>
        `
    }),
    angularComponent("DenariiAmountComponent", "denarii-amount", "features/treasury", {
        downgradedAs: "denariiAmount", imports: [ "DecimalPipe" ],
        members: [ `readonly amount = input(0);` ],
        template: `<span class="denarii-amount">{{ amount() | number: "1.0-0" }} den.</span>`
    }),
    angularComponent("QuartermasterPanelComponent", "app-quartermaster-panel", "features/treasury", {
        imports: [ "EmptyStateComponent" ], uses: "app-empty-state",
        template: `<aside class="quartermaster-panel"><h4>Quartermaster</h4><app-empty-state message="No open requests" /></aside>`
    }),
    angularComponent("LegionBadgeComponent", "app-legion-badge", "features/legions", {
        downgradedAs: "legionBadge",
        members: [ `readonly legion = input.required<any>();` ],
        template: `<span class="legion-badge">{{ legion().number }}</span>`
    }),
    angularComponent("LegionCardComponent", "app-legion-card", "features/legions", {
        imports: [ "LegionBadgeComponent" ], uses: "app-legion-badge",
        members: [ `readonly legion = input.required<any>();` ],
        template: `<article class="legion-card"><h3>{{ legion().name }}</h3><app-legion-badge [legion]="legion()" /></article>`
    }),
    angularComponent("RollCallComponent", "app-roll-call", "features/legions", {
        downgradedAs: "rollCall", external: true, imports: [ "StandardBearerComponent", "LegionStatsDirective", "ShortDatePipe" ], uses: "standard-bearer legion-stats",
        members: [
            `readonly legionId = input.required<number>();`,
            `readonly closed = output<void>();`,
            `readonly legion = signal<any>(null);`,
            `readonly calledAt = signal<string | null>(null);`
        ],
        template: `
            <section class="roll-call">
                <standard-bearer [legion]="legion()" type="eagle" />
                <legion-stats [legion]="legion()" />
                @if (legion(); as current) {
                    <p>{{ current.name }} answered the roll call on {{ calledAt() | shortDate }}</p>
                }
                <button type="button" (click)="closed.emit()">Close</button>
            </section>
        `
    }),
    angularComponent("StandardBearerComponent", "standard-bearer", "features/legions", {
        members: [ `readonly legion = input<any>(null);`, `readonly label = input("");`, `readonly type = input("eagle");` ],
        template: `<span class="standard-bearer" [class]="'standard-bearer--' + type()">{{ label() || legion()?.name }}</span>`
    }),
    angularComponent("StandardsGalleryComponent", "app-standards-gallery", "features/legions", {
        external: true, imports: [ "StandardBearerComponent", "EmptyStateComponent" ], uses: "standard-bearer*2 app-empty-state",
        members: [ `readonly legions = input<any[]>([]);`, `readonly guard = input<any>(null);` ],
        template: `
            <div class="standards-gallery">
                @for (legion of legions(); track legion.id) {
                    <standard-bearer [legion]="legion" [label]="legion.motto" />
                } @empty {
                    <app-empty-state message="No standards on display" />
                }
                <standard-bearer [legion]="guard()" type="guard" />
            </div>
        `
    }),
    angularComponent("RankInsigniaComponent", "rank-insignia", "features/legions", {
        downgradedAs: "rankInsignia",
        members: [ `readonly rank = input("");` ],
        template: `<span class="rank-insignia" [attr.data-rank]="rank()">{{ rank() }}</span>`
    }),
    angularComponent("HelmetIconComponent", "helmet-icon", "features/armory", {
        members: [ `readonly type = input("galea");`, `readonly size = input("small");` ],
        template: `<i class="helmet-icon" [class]="'helmet-icon--' + type()" aria-hidden="true"></i>`
    }),
    angularComponent("ShieldBadgeComponent", "shield-badge", "features/armory", {
        members: [ `readonly shield = input.required<any>();` ],
        template: `<span class="shield-badge" [class.shield-badge--painted]="shield().painted">{{ shield().cohort }}-{{ shield().number }}</span>`
    }),
    angularComponent("ArmorySummaryComponent", "app-armory-summary", "features/armory", {
        imports: [ "HelmetIconComponent", "ShieldBadgeComponent" ], uses: "helmet-icon shield-badge",
        members: [ `readonly shields = input<any[]>([]);` ],
        template: `
            <section class="armory-summary">
                <helmet-icon type="galea" size="large" />
                @for (shield of shields(); track shield.id) {
                    <shield-badge [shield]="shield" />
                }
            </section>
        `
    }),
    angularComponent("TentRowComponent", "tent-row", "features/patrols", {
        members: [ `readonly tents = input<any[]>([]);` ],
        template: `
            @for (tent of tents(); track tent.number) {
                <button type="button" class="tent-row__tent" [class.taken]="tent.taken">{{ tent.number }}</button>
            }
        `
    }),
    angularComponent("TentGridComponent", "app-tent-grid", "features/patrols", {
        imports: [ "TentRowComponent" ], uses: "tent-row",
        members: [ `readonly rows = input<any[][]>([]);` ],
        template: `
            @for (row of rows(); track $index) {
                <tent-row [tents]="row" />
            }
        `
    }),
    angularComponent("PatrolTimelineComponent", "app-patrol-timeline", "features/patrols", {
        imports: [ "DateStampComponent" ], uses: "date-stamp",
        members: [ `readonly entries = input<any[]>([]);` ],
        template: `
            <ol class="patrol-timeline">
                @for (entry of entries(); track entry.id) {
                    <li><date-stamp [value]="entry.at" /> {{ entry.route }}</li>
                }
            </ol>
        `
    }),
    angularComponent("CampAlertComponent", "camp-alert", "features/camp", {
        downgradedAs: "campAlert",
        members: [ `readonly message = input("");`, `readonly severity = input("info");` ],
        template: `<p class="camp-alert" [class]="'camp-alert--' + severity()" role="alert">{{ message() }}</p>`
    }),
    angularComponent("DateStampComponent", "date-stamp", "features/camp", {
        downgradedAs: "dateStamp", imports: [ "ShortDatePipe" ],
        members: [ `readonly value = input<string | null>(null);` ],
        template: `<time class="date-stamp">{{ value() | shortDate }}</time>`
    }),
    angularComponent("LoadingSpinnerComponent", "app-loading-spinner", "features/camp", {
        downgradedAs: "loadingSpinner",
        members: [ `readonly size = input("small");` ],
        template: `<span class="loading-spinner" [class]="'loading-spinner--' + size()" role="status"></span>`
    }),
    angularComponent("EmptyStateComponent", "app-empty-state", "features/camp", {
        members: [ `readonly message = input("");` ],
        template: `<p class="empty-state">{{ message() }}</p>`
    }),
    angularComponent("CampHeaderComponent", "app-camp-header", "features/camp", {
        members: [ `readonly title = input("");` ],
        template: `<header class="camp-header"><h1>{{ title() }}</h1></header>`
    })
];

const ANGULAR_SERVICES = [
    { className: "SupplyService", file: "features/rations/supply.service", downgradedAs: "supplyService", about: "Levels of the stores.", body: [
        `private readonly levels = signal<Record<string, number>>({ grain: 64, wine: 31 });`,
        ``,
        `level(store: string): number {`,
        `    return this.levels()[store] ?? 0;`,
        `}`,
        ``,
        `warningLevel(): number {`,
        `    return 20;`,
        `}`
    ] },
    { className: "CohortStore", file: "features/legions/cohort.store", downgradedAs: "cohortStore", about: "The cohorts that are in camp right now.", body: [
        `private readonly cohorts = signal<any[]>([]);`,
        ``,
        `all(): any[] {`,
        `    return this.cohorts();`,
        `}`
    ] },
    { className: "NotificationHub", file: "features/camp/notification-hub.service", downgradedAs: "notificationHub", about: "Messages shown to the officer on duty.", body: [
        `readonly messages = signal<string[]>([]);`,
        ``,
        `info(message: string): void {`,
        `    this.messages.update(messages => [ ...messages, message ]);`,
        `}`,
        ``,
        `error(message: string): void {`,
        `    this.messages.update(messages => [ ...messages, "Error: " + message ]);`,
        `}`
    ] },
    { className: "FeatureFlags", file: "features/camp/feature-flags.service", downgradedAs: "featureFlags", about: "Switches for screens that are still being moved to Angular.", body: [
        `private readonly flags = signal<Record<string, boolean>>({});`,
        ``,
        `isOn(flag: string): boolean {`,
        `    return this.flags()[flag] ?? false;`,
        `}`
    ] }
];

/** UpgradeComponent wrappers: the selector is the kebab name of the AngularJS component by design, so they are not twins. */
const WRAPPERS = [ "legionStats", "cohortBanner", "centurionCard", "supplyGauge", "tentMap" ].map(ajsName => ({
    ajsName,
    selector: kebab(ajsName),
    className: `${pascal(ajsName)}Directive`,
    file: `shared/upgraded/${kebab(ajsName)}.directive`
}));

/** AngularJS things handed to Angular code through $injector; only the first one is a service registered in this app's AngularJS code alone. */
const UPGRADE_PROVIDERS = [
    { token: "LegacyReports", ajsName: "legacyReports", method: "latest(): Promise<unknown[]>" },
    { token: "LegacyLegions", ajsName: "legionService", method: "list(): Promise<unknown[]>" },
    { token: "LegacyState", ajsName: "$state", method: "go(state: string, params?: object): void" }
];

const PIPES = [ { className: "ShortDatePipe", name: "shortDate", file: "shared/pipes/short-date.pipe" } ];

// ---------------------------------------------------------------------------------------------------------------------
// The model, part 6: spec files (never a use, never a definition) and the traps the key reports. Every trap names the
// emitted text that makes it a trap; the self-test fails when that text is not in the fixture.
// ---------------------------------------------------------------------------------------------------------------------
const SPECS = {
    [`${AJS}/features/legions/components/legion-card.spec.js`]: `// Unit test of the legionCard component.
describe("legionCard", function () {
    var $compile, $rootScope;

    beforeEach(module("castra.core"));
    beforeEach(inject(function (_$compile_, _$rootScope_) {
        $compile = _$compile_;
        $rootScope = _$rootScope_;
    }));

    it("renders the name of the legion next to its standard", function () {
        var scope = $rootScope.$new();
        scope.legion = { id: 13, name: "Gemina", number: 13 };
        var element = $compile("<div><legion-card legion=\\"legion\\"></legion-card><standard-bearer legion=\\"legion\\"></standard-bearer></div>")(scope);
        scope.$digest();
        expect(element.text()).toContain("Gemina");
    });
});
`,
    [`${AJS}/features/patrols/components/tent-inspector.spec.js`]: `// Unit test of the tentInspector component.
describe("tentInspector", function () {
    var $compile, $rootScope;

    beforeEach(module("castra.core"));
    beforeEach(inject(function (_$compile_, _$rootScope_) {
        $compile = _$compile_;
        $rootScope = _$rootScope_;
    }));

    it("shows how many beds are taken", function () {
        var scope = $rootScope.$new();
        scope.tent = { number: 4, occupants: 6, capacity: 8 };
        var element = $compile("<tent-inspector tent=\\"tent\\"></tent-inspector>")(scope);
        scope.$digest();
        expect(element.text()).toContain("6 of 8 beds taken");
    });
});
`,
    [`${AJS}/services/tent-allocator.spec.js`]: `// Unit test of the tentAllocator factory.
describe("tentAllocator", function () {
    var tentAllocator, $filter;

    beforeEach(module("castra.core"));
    beforeEach(inject(function (_tentAllocator_, $injector) {
        tentAllocator = _tentAllocator_;
        $filter = $injector.get("$filter");
        expect($injector.get("tentAllocator")).toBe(tentAllocator);
    }));

    it("is created", function () {
        expect(tentAllocator.allocate).toBeDefined();
    });

    it("can print the day a tent was pitched", function () {
        expect($filter("shortDate")(null)).toBe("");
    });
});

Stub.$inject = [ "tentAllocator" ];

function Stub (tentAllocator) {
    this.allocate = tentAllocator.allocate;
}
`,
    "src/app/features/legions/roll-call.component.spec.ts": `// Unit test of RollCallComponent with stand-ins for what the page puts around it.
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { CohortBannerDirective } from "../../shared/upgraded/cohort-banner.directive";
import { RollCallComponent } from "./roll-call.component";

@Component({ selector: "cohort-table", template: "" })
class CohortTableStubComponent {}

@Component({
    imports: [ RollCallComponent, CohortBannerDirective, CohortTableStubComponent ],
    template: \`<app-roll-call [legionId]="13" /><cohort-banner [cohort]="cohort" /><cohort-table />\`
})
class HostComponent {
    cohort = { name: "Prima", legionId: 13 };
}

describe("RollCallComponent", () => {
    it("renders inside a host", () => {
        const fixture = TestBed.createComponent(HostComponent);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector("app-roll-call")).not.toBeNull();
    });
});
`
};

const ajsFile = relative => `${AJS}/${relative}`;
const TRAPS = [
    { question: "deadComponents", name: "helmetRack", why: "dead: <helmet-rack> appears only in an HTML comment and helmet-rack only as a CSS class",
        evidence: [ [ ajsFile("features/armory/helmets-page.html"), "<!-- <helmet-rack> was here -->" ], [ ajsFile("features/armory/partials/armory-inventory-content.html"), `class="armory-inventory helmet-rack"` ] ] },
    { question: "deadComponents", name: "shieldWall", why: "dead: the name appears only in a JS comment of another component",
        evidence: [ [ ajsFile("features/armory/components/shield-list.js"), "// shieldWall rendered" ] ] },
    { question: "deadComponents", name: "denariiLedger", why: "dead, and plainly so: nothing outside its own files mentions it (a control case without a decoy)", plain: true, evidence: [] },
    { question: "deadComponents", name: "patrolLog", why: "dead: <patrol-log-entry> is a different registered component whose tag only starts with patrol-log",
        evidence: [ [ ajsFile("features/patrols/patrol-board.html"), "<patrol-log-entry " ], [ ajsFile("features/patrols/components/patrol-log-entry.js"), `.component("patrolLogEntry"` ] ] },
    { question: "deadComponents", name: "tentInspector", why: "dead: <tent-inspector> is compiled only in a spec file",
        evidence: [ [ ajsFile("features/patrols/components/tent-inspector.spec.js"), "<tent-inspector " ] ] },
    { question: "deadComponents", name: "tentInspector", why: "still a component: tent-inspector.js and tent-inspector.html contain the letters \"spec\" (inSPECtor) but are not spec files; only *.spec.js and *.spec.ts are",
        evidence: [ [ ajsFile("features/patrols/components/tent-inspector.js"), `.component("tentInspector"` ] ] },
    { question: "deadComponents", name: "cohortBanner", why: "dead: it has an UpgradeComponent wrapper, but no Angular template uses <cohort-banner> (only a spec file does)",
        evidence: [ [ "src/app/shared/upgraded/cohort-banner.directive.ts", `super("cohortBanner"` ], [ "src/app/features/legions/roll-call.component.spec.ts", "<cohort-banner " ] ] },
    { question: "deadComponents", name: "legionDashboard", why: "alive: used only through a ui-router state (component: \"legionDashboard\")",
        evidence: [ [ ajsFile("features/legions/legions.routing.js"), `component: "legionDashboard"` ] ] },
    { question: "deadComponents", name: "helmetIcon", why: "alive: used only inside the inline template: string of helmetBadge",
        evidence: [ [ ajsFile("features/armory/components/helmet-badge.js"), "<helmet-icon " ] ] },
    { question: "deadComponents", name: "supplyOverview", why: "alive: used only in the inline template of the state rations.supply",
        evidence: [ [ ajsFile("features/rations/rations.routing.js"), `template: "<supply-overview></supply-overview>"` ] ] },
    { question: "deadComponents", name: "legionStats", why: "alive: used only through its UpgradeComponent wrapper, whose selector an Angular template uses",
        evidence: [ [ "src/app/shared/upgraded/legion-stats.directive.ts", `super("legionStats"` ], [ "src/app/features/legions/roll-call.component.html", "<legion-stats " ] ] },
    { question: "deadComponents", name: "tentMap", why: "alive although no Angular template uses its wrapper: an AngularJS template and a state's inline template render it",
        evidence: [ [ "src/app/shared/upgraded/tent-map.directive.ts", `super("tentMap"` ], [ ajsFile("features/patrols/patrols.routing.js"), "<tent-map " ] ] },
    { question: "leafComponents", name: "legionStats", why: "leaf: renders only downgraded Angular components (<supply-meter>, <denarii-amount>)",
        evidence: [ [ ajsFile("features/legions/components/legion-stats.html"), "<supply-meter " ] ] },
    { question: "leafComponents", name: "centurionCard", why: "leaf: a downgraded Angular component plus an ng-include partial with native elements only",
        evidence: [ [ ajsFile("features/legions/components/centurion-card.html"), "<rank-insignia " ] ] },
    { question: "leafComponents", name: "supplyGauge", why: "leaf: a downgraded Angular component plus an ng-include partial with native elements only",
        evidence: [ [ ajsFile("features/rations/components/supply-gauge.html"), "<supply-meter " ] ] },
    { question: "leafComponents", name: "cohortRow", why: "not a leaf: its only AngularJS dependency is the attribute directive tooltip-hint",
        evidence: [ [ ajsFile("features/legions/components/cohort-row.html"), "tooltip-hint=" ] ] },
    { question: "leafComponents", name: "supplyCrate", why: "not a leaf: its only AngularJS dependency is the attribute directive confirm-click",
        evidence: [ [ ajsFile("features/rations/components/supply-crate.html"), "confirm-click=" ] ] },
    { question: "leafComponents", name: "armoryInventory", why: "not a leaf: its template is only an ng-include, and the partial renders <helmet-badge>",
        evidence: [ [ ajsFile("features/armory/components/armory-inventory.js"), "<ng-include src=" ], [ ajsFile("features/armory/partials/armory-inventory-content.html"), "<helmet-badge " ] ] },
    { question: "leafComponents", name: "grainStore", why: "leaf: its template is only an ng-include, and the partial has native elements only",
        evidence: [ [ ajsFile("features/rations/components/grain-store.js"), "<ng-include src=" ] ] },
    { question: "leafComponents", name: "reportPanel", why: "not a leaf: a partial included by its partial renders <centurion-card> (two levels of ng-include)",
        evidence: [ [ ajsFile("features/patrols/partials/report-body.html"), "report-signature.html" ], [ ajsFile("features/patrols/partials/report-signature.html"), "<centurion-card " ] ] },
    { question: "leafComponents", name: "campHeader", why: "leaf: ui-sref and ng-class are built-in directives",
        evidence: [ [ ajsFile("components/camp-header.html"), "ui-sref=" ] ] },
    { question: "leafComponents", name: "amountInput", why: "leaf: its bindings name and type are also native attributes of the <input> in its template",
        evidence: [ [ ajsFile("features/rations/components/amount-input.js"), `name: "@?"` ], [ ajsFile("features/rations/components/amount-input.html"), `<input type=` ] ] },
    { question: "leafComponents", name: "sectionTitle", why: "leaf: bindings label, type and name are native attribute names; the template is an inline string",
        evidence: [ [ ajsFile("components/section-title.js"), `label: "@", type: "@?", name: "@?"` ] ] },
    { question: "standardBearerElements", name: "legionCard", why: "counted: two <standard-bearer> elements on one line",
        evidence: [ [ ajsFile("features/legions/components/legion-card.html"), "</standard-bearer> <standard-bearer " ] ] },
    { question: "standardBearerElements", name: "legionDashboard", why: "counted: attributes spread over several lines",
        evidence: [ [ ajsFile("features/legions/legion-dashboard.html"), "<standard-bearer\n" ] ] },
    { question: "standardBearerElements", name: "legionRoster", why: "counted: inside an inline template: string",
        evidence: [ [ ajsFile("features/legions/components/legion-roster.js"), "<standard-bearer " ] ] },
    { question: "standardBearerElements", name: "legion-honours.html", why: "counted: inside an ng-include partial",
        evidence: [ [ ajsFile("features/legions/partials/legion-honours.html"), "<standard-bearer " ] ] },
    { question: "standardBearerElements", name: "standardBearerList", why: "not counted: <standard-bearer-list> is a different registered component",
        evidence: [ [ ajsFile("features/legions/legion-dashboard.html"), "<standard-bearer-list " ], [ ajsFile("features/legions/legion-detail.html"), "<standard-bearer-list " ] ] },
    { question: "standardBearerElements", name: "StandardBearerComponent", why: "not counted: <standard-bearer> in Angular templates is the Angular twin",
        evidence: [ [ "src/app/features/legions/standards-gallery.component.html", "<standard-bearer " ], [ "src/app/features/legions/roll-call.component.html", "<standard-bearer " ], [ "src/app/features/treasury/treasury-page.component.html", "<standard-bearer " ] ] },
    { question: "standardBearerElements", name: "cohort-table.html", why: "not counted: the element is inside an HTML comment",
        evidence: [ [ ajsFile("features/legions/components/cohort-table.html"), "<!-- <standard-bearer " ] ] },
    { question: "standardBearerElements", name: "legion-card.spec.js", why: "not counted: compiled in a spec file",
        evidence: [ [ ajsFile("features/legions/components/legion-card.spec.js"), "<standard-bearer " ] ] },
    { question: "standardBearerElements", name: "legion-card-footer.html", why: "not counted: class=\"standard-bearer\" is a CSS class",
        evidence: [ [ ajsFile("features/legions/partials/legion-card-footer.html"), `class="standard-bearer"` ] ] },
    { question: "unusedFilters", name: "romanNumeral", why: "used: only through $filter(\"romanNumeral\") in a service",
        evidence: [ [ ajsFile("services/legion-service.js"), `$filter("romanNumeral")` ] ] },
    { question: "unusedFilters", name: "legionName", why: "used: only by injection as legionNameFilter in an $inject array",
        evidence: [ [ ajsFile("features/legions/components/cohort-row.js"), `$inject = [ "legionNameFilter" ]` ] ] },
    { question: "unusedFilters", name: "rationUnit", why: "used: only inside an inline template: string",
        evidence: [ [ ajsFile("features/rations/components/ration-summary.js"), "| rationUnit:'modius'" ] ] },
    { question: "unusedFilters", name: "cohortSize", why: "unused: cohortSize is also a controller property ({{ $ctrl.cohortSize }}) and is mentioned in a comment",
        evidence: [ [ ajsFile("features/legions/partials/cohort-legend.html"), "{{ $ctrl.cohortSize }}" ], [ ajsFile("features/legions/components/cohort-row.js"), "the cohortSize filter" ] ] },
    { question: "unusedFilters", name: "shortDate", why: "unused: 'shortDate' is an argument of the built-in date filter, the name of an Angular pipe and used through $filter only in a spec file",
        evidence: [ [ ajsFile("features/rations/partials/grain-store-content.html"), "| date:'shortDate'" ], [ "src/app/shared/pipes/short-date.pipe.ts", `name: "shortDate"` ], [ ajsFile("services/tent-allocator.spec.js"), `$filter("shortDate")` ] ] },
    { question: "unusedFilters", name: "truncate", why: "unused, and plainly so: nothing but its registration mentions it (a control case without a decoy)", plain: true, evidence: [] },
    { question: "unusedFilters", name: "ration-totals.html", why: "no filter there: the | of 'Rations | this month' is inside a string literal, right after a || operator and next to a real filter chain",
        evidence: [ [ ajsFile("features/rations/partials/ration-totals.html"), "$ctrl.legend || 'Rations | this month'" ] ] },
    { question: "twinComponents", name: "standardBearer", why: "twin: StandardBearerComponent has the selector standard-bearer and is not downgraded",
        evidence: [ [ "src/app/features/legions/standard-bearer.component.ts", `selector: "standard-bearer"` ] ] },
    { question: "twinComponents", name: "legionCard", why: "not a twin: the Angular component's selector is app-legion-card",
        evidence: [ [ "src/app/features/legions/legion-card.component.ts", `selector: "app-legion-card"` ] ] },
    { question: "twinComponents", name: "campHeader", why: "not a twin: the Angular component's selector is app-camp-header",
        evidence: [ [ "src/app/features/camp/camp-header.component.ts", `selector: "app-camp-header"` ] ] },
    { question: "twinComponents", name: "cohortTable", why: "not a twin: the @Component with the selector cohort-table is a mock in a spec file",
        evidence: [ [ "src/app/features/legions/roll-call.component.spec.ts", `@Component({ selector: "cohort-table"` ] ] },
    { question: "twinComponents", name: "centurionCard", why: "not a twin: the selector centurion-card belongs to an UpgradeComponent wrapper directive, not to a component",
        evidence: [ [ "src/app/shared/upgraded/centurion-card.directive.ts", `@Directive({ selector: "centurion-card" })` ] ] },
    { question: "unusedServices", name: "treasuryService", why: "used: injected only through an inline array annotation",
        evidence: [ [ ajsFile("services/supply-ledger.js"), `[ "$http", "treasuryService", function ($http, treasuryService) {` ] ] },
    { question: "unusedServices", name: "campClock", why: "used: only through $injector.get(\"campClock\") in AngularJS code",
        evidence: [ [ ajsFile("services/patrol-service.js"), `$injector.get("campClock")` ] ] },
    { question: "unusedServices", name: "legacyReports", why: "used: only from Angular, through an upgrade provider that reads it from $injector",
        evidence: [ [ "src/app/shared/upgraded/ajs-providers.ts", `useFactory: (i: any) => i.get("legacyReports"), deps: [ "$injector" ]` ] ] },
    { question: "unusedServices", name: "standardsRegistry", why: "unused: the name appears in a comment and as a local variable of a controller",
        evidence: [ [ ajsFile("services/legion-service.js"), "// standardsRegistry used to" ], [ ajsFile("features/legions/components/standard-bearer-list.js"), "var standardsRegistry = {};" ] ] },
    { question: "unusedServices", name: "tentAllocator", why: "unused: injected only in a spec file",
        evidence: [ [ ajsFile("services/tent-allocator.spec.js"), `$injector.get("tentAllocator")` ] ] },
    { question: "unusedServices", name: "messengerQueue", why: "unused, and plainly so: nothing outside its own file mentions it (a control case without a decoy)", plain: true, evidence: [] },
    { question: "unusedServices", name: "featureFlags", why: "never in the answer: nothing injects it, but it is an Angular service registered with downgradeInjectable",
        evidence: [ [ ajsFile("core/module.ts"), `.factory("featureFlags", downgradeInjectable(FeatureFlags))` ] ] }
];

// ---------------------------------------------------------------------------------------------------------------------
// The answer key, computed from the model alone.
// ---------------------------------------------------------------------------------------------------------------------
const stateViews = () => STATES.flatMap(state => [ state.view, state.inline ].filter(Boolean));
const ajsViews = () => [ ...COMPONENTS.map(component => component.view), ...Object.values(PARTIALS), ...stateViews() ];

/** A view plus every partial it pulls in with ng-include, directly or through another partial. */
function withIncludes(start, seen = new Set()) {
    if (seen.has(start)) return seen;
    seen.add(start);
    start.includes.forEach(id => withIncludes(PARTIALS[id], seen));
    return seen;
}

function answerKey() {
    const views = ajsViews();
    const wrapperInUse = wrapper => ANGULAR_COMPONENTS.some(component => component.uses[wrapper.selector] > 0);
    const rendered = name => views.some(candidate => candidate.renders[name] > 0)
        || STATES.some(state => state.component === name)
        || WRAPPERS.some(wrapper => wrapper.ajsName === name && wrapperInUse(wrapper));
    const isLeaf = component => [ ...withIncludes(component.view) ].every(part => Object.keys(part.renders).length === 0 && part.directives.length === 0);

    const injectionSites = [
        ...COMPONENTS, ...SERVICES, ...DIRECTIVES, ...FILTERS, RUN_BLOCK,
        ...ROUTING.flatMap(routing => routing.controllers),
        ...STATES.flatMap(state => (state.resolve ?? []).map(([ , injects ]) => ({ injects })))
    ];
    const injected = new Set(injectionSites.flatMap(site => site.injects));
    const fromInjector = new Set([ ...SERVICES.flatMap(service => service.injectorGets ?? []), ...UPGRADE_PROVIDERS.map(provider => provider.ajsName) ]);
    const appliedFilters = new Set([ ...views.flatMap(candidate => candidate.filters), ...SERVICES.flatMap(service => service.filterCalls ?? []) ]);

    return {
        deadComponents: sorted(COMPONENTS.filter(component => !rendered(component.name)).map(component => component.name)),
        leafComponents: sorted(COMPONENTS.filter(isLeaf).map(component => component.name)),
        standardBearerElements: views.reduce((sum, candidate) => sum + (candidate.renders.standardBearer ?? 0), 0),
        unusedFilters: sorted(FILTERS.filter(filter => !appliedFilters.has(filter.name) && !injected.has(`${filter.name}Filter`)).map(filter => filter.name)),
        twinComponents: sorted(COMPONENTS.filter(component => ANGULAR_COMPONENTS.some(candidate => candidate.selector === kebab(component.name))).map(component => component.name)),
        unusedServices: sorted(SERVICES.filter(service => !injected.has(service.name) && !fromInjector.has(service.name)).map(service => service.name))
    };
}

/**
 * The task counts a use wherever it is written, also inside a component that is itself dead or a service that nothing injects.
 * A reader may take "nothing renders it" the stricter way, where only uses reachable from live code count. The fixture is built
 * so that both readings give the same answers; this recomputes them the stricter way and reports every difference.
 */
function strictReadingProblems(answers) {
    const wrapperInUse = wrapper => ANGULAR_COMPONENTS.some(component => component.uses[wrapper.selector] > 0);
    const live = { components: new Set(), services: new Set(), filters: new Set() };
    const liveCount = () => live.components.size + live.services.size + live.filters.size;
    const rootSites = [ ...DIRECTIVES, RUN_BLOCK, ...ROUTING.flatMap(routing => routing.controllers), ...STATES.flatMap(state => (state.resolve ?? []).map(([ , injects ]) => ({ injects }))) ];
    let views = [];
    for (let before = -1; before !== liveCount();) {
        before = liveCount();
        const liveServices = SERVICES.filter(service => live.services.has(service.name));
        views = [ ...new Set([ ...stateViews(), ...COMPONENTS.filter(component => live.components.has(component.name)).map(component => component.view) ].flatMap(start => [ ...withIncludes(start) ])) ];
        const injected = new Set([ ...rootSites, ...COMPONENTS.filter(component => live.components.has(component.name)), ...liveServices, ...FILTERS.filter(filter => live.filters.has(filter.name)) ].flatMap(site => site.injects));
        for (const { name } of COMPONENTS) {
            if (views.some(candidate => candidate.renders[name] > 0) || STATES.some(state => state.component === name) || WRAPPERS.some(wrapper => wrapper.ajsName === name && wrapperInUse(wrapper))) live.components.add(name);
        }
        for (const { name } of SERVICES) {
            if (injected.has(name) || liveServices.some(service => (service.injectorGets ?? []).includes(name)) || UPGRADE_PROVIDERS.some(provider => provider.ajsName === name)) live.services.add(name);
        }
        for (const { name } of FILTERS) {
            if (views.some(candidate => candidate.filters.includes(name)) || liveServices.some(service => (service.filterCalls ?? []).includes(name)) || injected.has(`${name}Filter`)) live.filters.add(name);
        }
    }
    views = [ ...new Set([ ...stateViews(), ...COMPONENTS.filter(component => live.components.has(component.name)).map(component => component.view) ].flatMap(start => [ ...withIncludes(start) ])) ];
    const strict = {
        deadComponents: sorted(COMPONENTS.filter(component => !live.components.has(component.name)).map(component => component.name)),
        standardBearerElements: views.reduce((sum, candidate) => sum + (candidate.renders.standardBearer ?? 0), 0),
        unusedFilters: sorted(FILTERS.filter(filter => !live.filters.has(filter.name)).map(filter => filter.name)),
        unusedServices: sorted(SERVICES.filter(service => !live.services.has(service.name)).map(service => service.name))
    };
    return Object.keys(strict)
        .filter(question => JSON.stringify(strict[question]) !== JSON.stringify(answers[question]))
        .map(question => `${question}: ${JSON.stringify(answers[question])} as the task defines it, ${JSON.stringify(strict[question])} when uses inside dead code are not counted`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Emission: AngularJS side.
// ---------------------------------------------------------------------------------------------------------------------
const stringList = names => names.length ? `[ ${names.map(name => `"${name}"`).join(", ")} ]` : "[]";
const bindingsLiteral = bindings => `{ ${Object.entries(bindings).map(([ name, mode ]) => `${name}: "${mode}"`).join(", ")} }`;
const templateUrl = file => `app/ajs/${file}`;

function templateProperty(component, key) {
    if (component.kind === "url") return `${key("templateUrl")} "${templateUrl(component.file)}"`;
    if (component.quote === "backtick") return `${key("template")} \`\n${indent(component.view.html, 12)}\n        \``;
    return `${key("template")} ${JSON.stringify(component.view.html)}`;
}

function javascriptComponent(component, index) {
    const aligned = index % 3 !== 0;
    const controller = aligned ? "Controller" : `${pascal(component.name)}Controller`;
    const hasController = component.injects.length + component.init.length + component.methods.length + component.locals.length > 0;
    const key = name => aligned ? `${name.padEnd(11)}:` : `${name}:`;
    const properties = [
        templateProperty(component, key),
        ...(hasController ? [ `${key("controller")} ${controller}` ] : []),
        ...(Object.keys(component.bindings).length ? [ `${key("bindings")} ${bindingsLiteral(component.bindings)}` ] : [])
    ];
    const out = [
        `// ${component.about}`,
        `angular.module("${component.module}")`,
        `    .component("${component.name}", {`,
        properties.map(property => `        ${property}`).join(",\n"),
        `    });`
    ];
    if (hasController) {
        if (component.injects.length) out.push("", `${controller}.$inject = ${stringList(component.injects)};`);
        out.push("", `function ${controller} (${component.injects.join(", ")}) {`, `    var $ctrl = this;`);
        component.locals.forEach(local => out.push(`    ${local}`));
        component.notes.forEach(note => out.push(`    // ${note}`));
        if (component.init.length) out.push("", `    $ctrl.$onInit = function () {`, ...component.init.map(line => `        ${line}`), `    };`);
        for (const [ method, params, body ] of component.methods) out.push("", `    $ctrl.${method} = function (${params}) {`, ...body.map(line => `        ${line}`), `    };`);
        out.push(`}`);
    }
    return out.join("\n") + "\n";
}

/** The .js dialect of init and method lines rewritten for a class controller: $ctrl -> this, injected names -> this.name, arrow callbacks. */
function toTypeScript(line, injects) {
    let text = line
        .replace(/\$ctrl\./g, "this.")
        .replace(/function \(([^)]*)\) \{/g, (_match, params) => `(${words(params.replace(/,/g, " ")).map(name => `${name}: any`).join(", ")}) => {`);
    for (const name of injects) text = text.replace(new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?=[.(])`, "g"), `this.${name}`);
    return text;
}

function typescriptComponent(component) {
    const className = `${pascal(component.name)}Controller`;
    const convert = line => toTypeScript(line, component.injects);
    const bodies = [ ...component.init, ...component.methods.flatMap(([ , , body ]) => body) ];
    const assigned = [ ...new Set(bodies.flatMap(line => [ ...line.matchAll(/\$ctrl\.(\w+) =(?!=)/g) ].map(match => match[1]))) ].filter(name => !(name in component.bindings));
    const out = [
        `// ${component.about}`,
        `import * as angular from "angular";`,
        ``,
        ...component.notes.map(note => `// ${note}`),
        `class ${className} implements angular.IController {`,
        `    static $inject${component.injects.length ? "" : ": string[]"} = ${stringList(component.injects)};`,
        ``,
        ...[ ...Object.keys(component.bindings), ...assigned ].map(name => `    ${name}: any;`)
    ];
    if (component.injects.length) out.push("", `    constructor(${component.injects.map(name => `private ${name}: any`).join(", ")}) {}`);
    if (component.init.length) out.push("", `    $onInit(): void {`, ...component.init.map(line => `        ${convert(line)}`), `    }`);
    for (const [ method, params, body ] of component.methods) {
        const typed = words(params.replace(/,/g, " ")).map(name => `${name}: any`).join(", ");
        out.push("", `    ${method}(${typed}): ${body.some(line => line.startsWith("return")) ? "any" : "void"} {`, ...body.map(line => `        ${convert(line)}`), `    }`);
    }
    out.push(
        `}`,
        ``,
        `angular.module("${component.module}")`,
        `    .component("${component.name}", {`,
        [ templateProperty(component, name => `${name}:`), `controller: ${className}`, `bindings: ${bindingsLiteral(component.bindings)}` ].map(property => `        ${property}`).join(",\n"),
        `    });`
    );
    return out.join("\n") + "\n";
}

function directiveFile(directive) {
    return [
        `// ${directive.about}`,
        `angular.module("castra.core")`,
        `    .directive("${directive.name}", Directive);`,
        ``,
        `Directive.$inject = ${stringList(directive.injects)};`,
        ``,
        `function Directive (${directive.injects.join(", ")}) {`,
        `    return {`,
        `        restrict: "A",`,
        `        link    : link`,
        `    };`,
        ``,
        `    function link (scope, element, attrs) {`,
        ...directive.link.map(line => `        ${line}`),
        `    }`,
        `}`
    ].join("\n") + "\n";
}

function filterFile(group) {
    const registrations = FILTERS.filter(filter => filter.file === group).map(filter => {
        const inner = [ `return function (${filter.params}) {`, ...filter.body.map(line => `    ${line}`), `};` ];
        return filter.injects.length
            ? [ `    .filter("${filter.name}", [ ${filter.injects.map(name => `"${name}"`).join(", ")}, function (${filter.injects.join(", ")}) {`, ...inner.map(line => `        ${line}`), `    } ])` ]
            : [ `    .filter("${filter.name}", function () {`, ...inner.map(line => `        ${line}`), `    })` ];
    });
    return [ `// ${FILTER_FILES[group].about}`, `angular.module("castra.core")`, registrations.map(rows => rows.join("\n")).join("\n") + ";" ].join("\n") + "\n";
}

function serviceFile(service) {
    const pad = service.annotated ? "        " : "    ";
    const body = [];
    if (service.kind === "service") {
        body.push(`var service = this;`, ...(service.locals ?? []), ...(service.notes ?? []).map(note => `// ${note}`));
        for (const [ method, params, rows ] of service.methods) body.push("", `service.${method} = function (${params}) {`, ...rows.map(line => `    ${line}`), `};`);
    } else {
        body.push(...(service.locals ?? []), ...(service.notes ?? []).map(note => `// ${note}`), ...(service.locals?.length ? [ "" ] : []));
        body.push(`return {`, service.methods.map(([ method ]) => `    ${method}: ${method}`).join(",\n"), `};`);
        for (const [ method, params, rows ] of service.methods) body.push("", `function ${method} (${params}) {`, ...rows.map(line => `    ${line}`), `}`);
    }
    const inner = body.join("\n").split("\n").map(line => line ? pad + line : line);
    const functionName = service.kind === "service" ? pascal(service.name) : service.name;
    const head = service.annotated
        ? [
            `angular.module("castra.core")`,
            `    .${service.kind}("${service.name}", [ ${service.injects.map(name => `"${name}"`).join(", ")}, function (${service.injects.join(", ")}) {`,
            ...inner,
            `    } ]);`
        ]
        : [
            `angular.module("castra.core")`,
            `    .${service.kind}("${service.name}", ${functionName});`,
            ``,
            `${functionName}.$inject = ${stringList(service.injects)};`,
            ``,
            `function ${functionName} (${service.injects.join(", ")}) {`,
            ...inner,
            `}`
        ];
    return [ `// ${service.about}`, ...head ].join("\n") + "\n";
}

function routingFile(routing) {
    const stateLines = state => {
        const properties = [];
        if (state.abstract) properties.push(`abstract: true`);
        properties.push(`url: "${state.url}"`);
        if (state.component) properties.push(`component: "${state.component}"`);
        if (state.view) properties.push(`templateUrl: "${templateUrl(state.view.file)}"`, `controller: ${state.controller}`, `controllerAs: "$ctrl"`);
        if (state.inline) properties.push(`template: ${JSON.stringify(state.inline.html)}`);
        if (state.resolve) {
            properties.push([
                `resolve: {`,
                state.resolve.map(([ name, injects, body ]) => [
                    `    ${name}: [ ${injects.map(inject => `"${inject}"`).join(", ")}, function (${injects.join(", ")}) {`,
                    `        ${body}`,
                    `    } ]`
                ].join("\n")).join(",\n"),
                `}`
            ].join("\n"));
        }
        return [ `        .state("${state.name}", {`, indent(properties.join(",\n"), 12), `        })` ].join("\n");
    };
    const out = [
        `// ui-router states of the ${routing.area} area.`,
        `angular.module("castra")`,
        `    .config(config);`,
        ``,
        `config.$inject = [ "$stateProvider" ];`,
        ``,
        `function config ($stateProvider) {`,
        `    $stateProvider`,
        routing.states.map(stateLines).join("\n") + ";",
        `}`
    ];
    for (const controller of routing.controllers) {
        out.push(
            "",
            `${controller.name}.$inject = ${stringList(controller.injects)};`,
            "",
            `function ${controller.name} (${controller.injects.join(", ")}) {`,
            `    var $ctrl = this;`,
            "",
            ...controller.body.map(line => line ? `    ${line}` : line),
            `}`
        );
    }
    return out.join("\n") + "\n";
}

const CASTRA_MODULE = `// The AngularJS application module: everything registered on castra.core plus the ui-router states.
angular.module("castra", [ "castra.core", "ui.router" ])
    .run([ ${RUN_BLOCK.injects.map(name => `"${name}"`).join(", ")}, function (${RUN_BLOCK.injects.join(", ")}) {
        $rootScope.$on("$stateChangeError", function (event, toState) {
            notificationHub.error("Could not open " + toState.name);
        });
    } ]);
`;

// ---------------------------------------------------------------------------------------------------------------------
// Emission: Angular side.
// ---------------------------------------------------------------------------------------------------------------------
const CLASS_FILES = Object.fromEntries([
    ...ANGULAR_COMPONENTS.map(component => [ component.className, `${component.dir}/${component.base}.component` ]),
    ...ANGULAR_SERVICES.map(service => [ service.className, service.file ]),
    ...WRAPPERS.map(wrapper => [ wrapper.className, wrapper.file ]),
    ...PIPES.map(pipe => [ pipe.className, pipe.file ]),
    ...UPGRADE_PROVIDERS.map(provider => [ provider.token, "shared/upgraded/ajs-providers" ])
]);
const PACKAGE_CLASSES = { DecimalPipe: "@angular/common" };

/** Import statements for `classNames` as seen from the file `from` (both relative to src/app, without extension). */
function importLines(from, classNames) {
    const specifier = className => {
        if (PACKAGE_CLASSES[className]) return PACKAGE_CLASSES[className];
        const relative = path.posix.relative(path.posix.dirname(from), CLASS_FILES[className]);
        return relative.startsWith(".") ? relative : `./${relative}`;
    };
    return classNames.map(className => ({ className, from: specifier(className) }))
        .sort((left, right) => left.from.localeCompare(right.from) || left.className.localeCompare(right.className))
        .map(entry => `import { ${entry.className} } from "${entry.from}";`);
}

function angularComponentFile(component) {
    const file = CLASS_FILES[component.className];
    const body = component.members.join("\n");
    const core = [ "ChangeDetectionStrategy", "Component", ...[ "inject", "input", "output", "signal" ].filter(name => new RegExp(`\\b${name}[.(<]`).test(body)) ];
    const injected = [ ...body.matchAll(/inject\((\w+)\)/g) ].map(match => match[1]);
    const multiline = component.template.includes("\n");
    const template = component.external
        ? `    templateUrl: "./${component.base}.component.html"`
        : multiline ? `    template: \`\n${indent(component.template, 8)}\n    \`` : `    template: \`${component.template}\``;
    return [
        `import { ${core.join(", ")} } from "@angular/core";`,
        ...importLines(file, [ ...component.imports, ...injected ]),
        ``,
        `@Component({`,
        `    selector: "${component.selector}",`,
        `    changeDetection: ChangeDetectionStrategy.OnPush,`,
        ...(component.imports.length ? [ `    imports: [ ${component.imports.join(", ")} ],` ] : []),
        template,
        `})`,
        component.members.length ? `export class ${component.className} {\n${indent(body, 4)}\n}` : `export class ${component.className} {}`
    ].join("\n") + "\n";
}

const angularServiceFile = service => [
    `import { Injectable, signal } from "@angular/core";`,
    ``,
    `/** ${service.about} AngularJS code injects it as "${service.downgradedAs}". */`,
    `@Injectable({ providedIn: "root" })`,
    `export class ${service.className} {`,
    ...service.body.map(line => line ? `    ${line}` : line),
    `}`
].join("\n") + "\n";

function wrapperFile(wrapper) {
    const component = COMPONENTS.find(candidate => candidate.name === wrapper.ajsName);
    const inputs = Object.entries(component.bindings).filter(([ , mode ]) => mode !== "&").map(([ name ]) => name);
    const outputs = Object.entries(component.bindings).filter(([ , mode ]) => mode === "&").map(([ name ]) => name);
    const core = [ "Directive", "ElementRef", ...(outputs.length ? [ "EventEmitter" ] : []), "Injector", "Input", ...(outputs.length ? [ "Output" ] : []), "inject" ];
    return [
        `import { ${core.join(", ")} } from "@angular/core";`,
        `import { UpgradeComponent } from "@angular/upgrade/static";`,
        ``,
        `/** Lets Angular templates render the AngularJS component ${wrapper.ajsName}. */`,
        `@Directive({ selector: "${wrapper.selector}" })`,
        `export class ${wrapper.className} extends UpgradeComponent {`,
        ...inputs.map(name => `    @Input() ${name}: unknown;`),
        ...outputs.map(name => `    @Output() ${name} = new EventEmitter<unknown>();`),
        ``,
        `    constructor() {`,
        `        super("${wrapper.ajsName}", inject(ElementRef), inject(Injector));`,
        `    }`,
        `}`
    ].join("\n") + "\n";
}

const AJS_PROVIDERS = `// AngularJS services that Angular code still needs. Each one is read from the AngularJS injector under its registered name.
${UPGRADE_PROVIDERS.map(provider => `
export abstract class ${provider.token} {
    abstract ${provider.method};
}`).join("\n")}

export const ajsProviders = [
${UPGRADE_PROVIDERS.map(provider => `    { provide: ${provider.token}, useFactory: (i: any) => i.get("${provider.ajsName}"), deps: [ "$injector" ] }`).join(",\n")}
];
`;

const pipeFile = pipe => `import { Pipe, PipeTransform } from "@angular/core";

/** The Angular counterpart of the AngularJS filter with the same name. */
@Pipe({ name: "${pipe.name}" })
export class ${pipe.className} implements PipeTransform {
    transform(value: string | number | null): string {
        return value ? new Date(value).toLocaleDateString() : "";
    }
}
`;

function coreModuleFile() {
    const downgraded = ANGULAR_COMPONENTS.filter(component => component.downgradedAs);
    return [
        `// The AngularJS core module. Every Angular component and service that AngularJS code may use is downgraded here.`,
        `import * as angular from "angular";`,
        `import { downgradeComponent, downgradeInjectable } from "@angular/upgrade/static";`,
        ...importLines("ajs/core/module", [ ...downgraded.map(component => component.className), ...ANGULAR_SERVICES.map(service => service.className) ]),
        ``,
        `angular.module("castra.core", [])`,
        ...downgraded.map(component => `    .directive("${component.downgradedAs}", downgradeComponent({ component: ${component.className} }) as angular.IDirectiveFactory)`),
        ANGULAR_SERVICES.map(service => `    .factory("${service.downgradedAs}", downgradeInjectable(${service.className}))`).join("\n") + ";"
    ].join("\n") + "\n";
}

const APP_MODULE = `import { DoBootstrap, NgModule } from "@angular/core";
import { BrowserModule } from "@angular/platform-browser";
import { UpgradeModule } from "@angular/upgrade/static";
import { ajsProviders } from "./shared/upgraded/ajs-providers";
import "./ajs/core/module";
import "./ajs/castra.module";

/** The Angular shell: it owns the page and starts the AngularJS application "castra" inside it through ngUpgrade. */
@NgModule({
    imports: [ BrowserModule, UpgradeModule ],
    providers: [ ...ajsProviders ]
})
export class AppModule implements DoBootstrap {
    constructor(private readonly upgrade: UpgradeModule) {}

    ngDoBootstrap(): void {
        this.upgrade.bootstrap(document.documentElement, [ "castra" ]);
    }
}
`;

const PACKAGE_JSON = JSON.stringify({
    name: "castra-hybrid",
    version: "1.0.0",
    private: true,
    description: "A hybrid AngularJS + Angular app (ngUpgrade). Generated fixture, never installed or built.",
    dependencies: {
        "@angular/common": "22.2.1",
        "@angular/compiler": "22.2.1",
        "@angular/core": "22.2.1",
        "@angular/platform-browser": "22.2.1",
        "@angular/upgrade": "22.2.1",
        "@uirouter/angularjs": "1.1.2",
        angular: "1.8.3",
        rxjs: "7.8.2",
        tslib: "2.8.1"
    },
    devDependencies: { "@types/angular": "1.8.9", typescript: "6.0.3" }
}, null, 2) + "\n";

const README = `Generated by scripts/generate-hybrid.mjs; do not edit by hand.
Never installed or built: it is read by a benchmark that asks migration-planning questions.
It imitates a hybrid app: AngularJS 1.8 code under src/app/ajs, Angular 22 code in the rest of src/app, joined with ngUpgrade.
`;

/** Every file of the fixture: path relative to hybrid/ -> content. */
function fixtureFiles() {
    const files = new Map();
    const put = (relative, content) => {
        if (files.has(relative)) throw new Error(`two files want the path ${relative}`);
        files.set(relative, content.endsWith("\n") ? content : content + "\n");
    };
    put("package.json", PACKAGE_JSON);
    put("README.md", README);
    put("src/app/app.module.ts", APP_MODULE);
    put(ajsFile("castra.module.js"), CASTRA_MODULE);
    put(ajsFile("core/module.ts"), coreModuleFile());
    let scriptIndex = 0;
    for (const component of COMPONENTS) {
        const source = component.lang === "ts" ? typescriptComponent(component) : javascriptComponent(component, scriptIndex++);
        put(ajsFile(`${component.dir}/${kebab(component.name)}.${component.lang}`), source);
        if (component.file) put(ajsFile(component.file), component.view.html);
    }
    for (const entry of [ ...Object.values(PARTIALS), ...STATES.map(state => state.view).filter(Boolean) ]) put(ajsFile(entry.file), entry.html);
    for (const routing of ROUTING) put(ajsFile(`features/${routing.area}/${routing.area}.routing.js`), routingFile(routing));
    for (const directive of DIRECTIVES) put(ajsFile(`directives/${kebab(directive.name)}.js`), directiveFile(directive));
    for (const group of Object.keys(FILTER_FILES)) put(ajsFile(FILTER_FILES[group].file), filterFile(group));
    for (const service of SERVICES) put(ajsFile(`services/${kebab(service.name)}.js`), serviceFile(service));
    for (const component of ANGULAR_COMPONENTS) {
        put(`src/app/${CLASS_FILES[component.className]}.ts`, angularComponentFile(component));
        if (component.external) put(`src/app/${CLASS_FILES[component.className]}.html`, component.template);
    }
    for (const service of ANGULAR_SERVICES) put(`src/app/${service.file}.ts`, angularServiceFile(service));
    for (const wrapper of WRAPPERS) put(`src/app/${wrapper.file}.ts`, wrapperFile(wrapper));
    for (const pipe of PIPES) put(`src/app/${pipe.file}.ts`, pipeFile(pipe));
    put("src/app/shared/upgraded/ajs-providers.ts", AJS_PROVIDERS);
    for (const [ relative, content ] of Object.entries(SPECS)) put(relative, content);
    return files;
}

// ---------------------------------------------------------------------------------------------------------------------
// Checks. scanMarkup is the only thing they share: what the HTML parser sees in a piece of markup.
// ---------------------------------------------------------------------------------------------------------------------
function scanMarkup(text, { blocks = false } = {}) {
    const parsed = new HtmlParser().parse(text, "template.html", { tokenizeBlocks: blocks });
    const found = { errors: parsed.errors.map(error => error.msg), elements: [], attributes: [], includes: [], expressions: [] };
    const interpolations = value => [ ...value.matchAll(/\{\{([\s\S]*?)\}\}/g) ].map(match => match[1]);
    const visit = nodes => {
        for (const node of nodes) {
            if (node.attrs && typeof node.name === "string") {
                found.elements.push(node.name);
                for (const attribute of node.attrs) {
                    found.attributes.push(attribute.name);
                    found.expressions.push(...(attribute.value.includes("{{") ? interpolations(attribute.value) : [ attribute.value ]));
                    const includes = attribute.name === "ng-include" || (node.name === "ng-include" && attribute.name === "src");
                    if (includes) found.includes.push(attribute.value.trim().replace(/^'|'$/g, ""));
                }
            } else if (typeof node.value === "string" && !node.constructor.name.includes("Comment")) {
                found.expressions.push(...interpolations(node.value));
            }
            if (Array.isArray(node.children)) visit(node.children);
        }
    };
    visit(parsed.rootNodes);
    return found;
}

/** Names that follow a single "|" outside string literals: the filters an AngularJS expression applies. */
function filtersOf(expression) {
    const withoutStrings = expression.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
    return [ ...withoutStrings.matchAll(/(?<!\|)\|(?!\|)\s*([A-Za-z_$][\w$]*)/g) ].map(match => match[1]);
}

const sameList = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

/** Before anything is written: sizes of the contract, and every template text against the facts the model states about it. */
function checkModel() {
    const problems = [];
    const expect = (label, actual, wanted) => { if (actual !== wanted) problems.push(`${label}: ${actual}, the contract wants ${wanted}`); };
    expect("AngularJS components", COMPONENTS.length, 40);
    expect("AngularJS components in .js", COMPONENTS.filter(component => component.lang === "js").length, 32);
    expect("AngularJS components with templateUrl", COMPONENTS.filter(component => component.kind === "url").length, 34);
    expect("ng-include wrapper components", COMPONENTS.filter(component => component.kind === "include").length, 2);
    expect("AngularJS directives", DIRECTIVES.length, 4);
    expect("AngularJS filters", FILTERS.length, 8);
    expect("AngularJS services", SERVICES.filter(service => service.kind === "service").length, 6);
    expect("AngularJS factories", SERVICES.filter(service => service.kind === "factory").length, 6);
    expect("downgraded components", ANGULAR_COMPONENTS.filter(component => component.downgradedAs).length, 10);
    expect("downgraded injectables", ANGULAR_SERVICES.length, 4);
    expect("Angular components", ANGULAR_COMPONENTS.length, 24);
    expect("UpgradeComponent wrappers", WRAPPERS.length, 5);
    expect("routing files", ROUTING.length, 4);
    if (STATES.length < 12 || STATES.length > 14) problems.push(`${STATES.length} states, the contract wants 12 to 14`);
    const everyName = [ ...COMPONENTS, ...DIRECTIVES, ...FILTERS, ...SERVICES ].map(entry => entry.name).concat(ANGULAR_COMPONENTS.flatMap(component => component.downgradedAs ?? []), ANGULAR_SERVICES.map(service => service.downgradedAs));
    for (const name of everyName) if (everyName.filter(other => other === name).length > 1) problems.push(`the name ${name} is registered twice`);

    const componentByTag = new Map(COMPONENTS.map(component => [ kebab(component.name), component.name ]));
    const downgradedByTag = new Map(ANGULAR_COMPONENTS.filter(component => component.downgradedAs).map(component => [ kebab(component.downgradedAs), component.downgradedAs ]));
    const directiveByAttribute = new Map(DIRECTIVES.map(directive => [ kebab(directive.name), directive.name ]));
    const partialByUrl = new Map(Object.entries(PARTIALS).map(([ id, entry ]) => [ templateUrl(entry.file), id ]));
    const filterNames = new Set(FILTERS.map(filter => filter.name));
    const labelled = [
        ...COMPONENTS.map(component => [ `component ${component.name}`, component.view ]),
        ...Object.entries(PARTIALS).map(([ id, entry ]) => [ `partial ${id}`, entry ]),
        ...STATES.flatMap(state => [ state.view, state.inline ].filter(Boolean).map(entry => [ `state ${state.name}`, entry ]))
    ];
    for (const [ label, entry ] of labelled) {
        const found = scanMarkup(entry.html);
        found.errors.forEach(error => problems.push(`${label}: ${error}`));
        const renders = {};
        const downgraded = new Set();
        for (const tag of found.elements) {
            if (componentByTag.has(tag)) renders[componentByTag.get(tag)] = (renders[componentByTag.get(tag)] ?? 0) + 1;
            else if (downgradedByTag.has(tag)) downgraded.add(downgradedByTag.get(tag));
            else if (tag.includes("-") && !BUILT_IN_ELEMENTS.has(tag)) problems.push(`${label}: <${tag}> is not registered anywhere`);
        }
        const directives = [ ...new Set(found.attributes.filter(name => directiveByAttribute.has(name)).map(name => directiveByAttribute.get(name))) ];
        const applied = [ ...new Set(found.expressions.flatMap(filtersOf)) ];
        applied.filter(name => !filterNames.has(name) && !BUILT_IN_FILTERS.has(name)).forEach(name => problems.push(`${label}: the filter ${name} is not registered anywhere`));
        found.includes.filter(url => !partialByUrl.has(url)).forEach(url => problems.push(`${label}: ng-include of ${url}, which is not a partial of the model`));
        const includes = found.includes.filter(url => partialByUrl.has(url)).map(url => partialByUrl.get(url));
        const compare = (what, declared, scanned) => { if (!sameList(declared, scanned)) problems.push(`${label}: the model says ${what} [${sorted(declared)}], the text has [${sorted(scanned)}]`); };
        compare("renders", Object.entries(entry.renders).map(([ name, count ]) => `${name}*${count}`), Object.entries(renders).map(([ name, count ]) => `${name}*${count}`));
        compare("downgraded", entry.downgraded, [ ...downgraded ]);
        compare("directives", entry.directives, directives);
        compare("filters", entry.filters, applied.filter(name => filterNames.has(name)));
        compare("includes", entry.includes, includes);
    }
    const included = new Set(labelled.flatMap(([ , entry ]) => entry.includes));
    Object.keys(PARTIALS).filter(id => !included.has(id)).forEach(id => problems.push(`partial ${id} is included by nothing`));

    const knownSelectors = new Set([ ...ANGULAR_COMPONENTS.map(component => component.selector), ...WRAPPERS.map(wrapper => wrapper.selector) ]);
    for (const component of ANGULAR_COMPONENTS) {
        const found = scanMarkup(component.template, { blocks: true });
        parseTemplate(component.template, `${component.base}.component.html`).errors?.forEach(error => problems.push(`${component.className}: ${error.msg}`));
        const uses = {};
        for (const tag of found.elements.filter(name => name.includes("-"))) {
            if (!knownSelectors.has(tag)) problems.push(`${component.className}: <${tag}> matches no Angular component or wrapper`);
            uses[tag] = (uses[tag] ?? 0) + 1;
        }
        if (!sameList(Object.entries(component.uses).map(pair => pair.join("*")), Object.entries(uses).map(pair => pair.join("*")))) {
            problems.push(`${component.className}: the model says uses ${JSON.stringify(component.uses)}, the text has ${JSON.stringify(uses)}`);
        }
        for (const className of component.imports) if (!CLASS_FILES[className] && !PACKAGE_CLASSES[className]) problems.push(`${component.className} imports the unknown class ${className}`);
    }
    return problems;
}

function listFiles(dir) {
    return readdirSync(dir, { withFileTypes: true })
        .sort((left, right) => (left.name < right.name ? -1 : 1))
        .flatMap(entry => entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [ path.join(dir, entry.name) ]);
}

/** After writing: syntax of every emitted file, then the six answers once more, from the files on disk with question-specific scans. */
function selfTest(key, traps) {
    const problems = [];
    const sources = listFiles(BASE).map(file => ({ relative: path.relative(BASE, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));
    const isSpec = source => /\.spec\.(ts|js)$/.test(source.relative);
    const isCode = source => /\.(ts|js)$/.test(source.relative);
    const inAjs = source => source.relative.startsWith(`${AJS}/`);
    const syntaxTrees = new Map();
    for (const source of sources.filter(isCode)) {
        const tree = ts.createSourceFile(source.relative, source.text, ts.ScriptTarget.Latest, true, source.relative.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
        syntaxTrees.set(source, tree);
        for (const diagnostic of tree.parseDiagnostics ?? []) problems.push(`${source.relative}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
    }
    /** String-valued `template:` properties of a source file, with the name of the .component(...) registration around them, if any. */
    const inlineTemplates = source => {
        const found = [];
        const visit = (node, owner) => {
            let inside = owner;
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "component" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) inside = node.arguments[0].text;
            if (ts.isPropertyAssignment(node) && node.name.getText() === "template" && ts.isStringLiteralLike(node.initializer)) found.push({ owner: inside, text: node.initializer.text });
            ts.forEachChild(node, child => visit(child, inside));
        };
        visit(syntaxTrees.get(source), null);
        return found;
    };

    const ajsCode = sources.filter(source => inAjs(source) && isCode(source) && !isSpec(source));
    const ajsHtml = sources.filter(source => inAjs(source) && source.relative.endsWith(".html"));
    const angularCode = sources.filter(source => source.relative.startsWith("src/") && !inAjs(source) && isCode(source) && !isSpec(source));
    const angularHtml = sources.filter(source => source.relative.startsWith("src/") && !inAjs(source) && source.relative.endsWith(".html"));
    const inAjsCode = pattern => ajsCode.flatMap(source => [ ...source.text.matchAll(pattern) ].map(match => match[1]));
    const quoted = text => [ ...text.matchAll(/"([^"]+)"/g) ].map(match => match[1]);

    const htmlByUrl = new Map(ajsHtml.map(source => [ `app/ajs/${source.relative.slice(AJS.length + 1)}`, scanMarkup(source.text) ]));
    ajsHtml.forEach(source => htmlByUrl.get(`app/ajs/${source.relative.slice(AJS.length + 1)}`).errors.forEach(error => problems.push(`${source.relative}: ${error}`)));
    const ajsInline = ajsCode.flatMap(source => inlineTemplates(source).map(entry => ({ ...entry, scan: scanMarkup(entry.text) })));
    ajsInline.forEach(entry => entry.scan.errors.forEach(error => problems.push(`inline template of ${entry.owner ?? "a state"}: ${error}`)));
    const ajsScans = [ ...htmlByUrl.values(), ...ajsInline.map(entry => entry.scan) ];
    const angularTemplates = [ ...angularHtml.map(source => ({ label: source.relative, text: source.text })), ...angularCode.flatMap(source => inlineTemplates(source).map(entry => ({ label: source.relative, text: entry.text }))) ];
    for (const template of angularTemplates) parseTemplate(template.text, template.label).errors?.forEach(error => problems.push(`${template.label}: ${error.msg}`));
    const angularTags = new Set(angularTemplates.flatMap(template => scanMarkup(template.text, { blocks: true }).elements));

    const references = new Set([ ...ajsCode, ...ajsHtml ].flatMap(source => [ ...source.text.matchAll(/app\/ajs\/[\w/.-]+\.html/g) ].map(match => match[0])));
    [ ...references ].filter(url => !htmlByUrl.has(url)).forEach(url => problems.push(`${url} is referenced but was not emitted`));
    [ ...htmlByUrl.keys() ].filter(url => !references.has(url)).forEach(url => problems.push(`${url} is an orphan template: nothing references it`));

    const components = inAjsCode(/\.component\(\s*"(\w+)"/g);
    const directives = inAjsCode(/\.directive\(\s*"(\w+)",\s*(?!\s|downgradeComponent)/g);
    const filters = inAjsCode(/\.filter\(\s*"(\w+)"/g);
    const services = inAjsCode(/\.(?:service|factory)\(\s*"(\w+)",\s*(?!\s|downgradeInjectable)/g);
    const downgradedComponents = inAjsCode(/\.directive\(\s*"(\w+)",\s*downgradeComponent/g);
    const downgradedInjectables = inAjsCode(/\.factory\(\s*"(\w+)",\s*downgradeInjectable/g);
    const angularSelectors = angularCode.flatMap(source => [ ...source.text.matchAll(/@Component\(\{\s*selector:\s*"([^"]+)"/g) ].map(match => match[1]));
    const wrappers = angularCode.filter(source => source.text.includes("extends UpgradeComponent")).map(source => ({ selector: source.text.match(/selector:\s*"([^"]+)"/)[1], ajsName: source.text.match(/super\(\s*"(\w+)"/)[1] }));
    const states = inAjsCode(/\.state\(\s*"([\w.]+)"/g);
    const count = (label, actual, wanted) => { if (actual !== wanted) problems.push(`emitted ${label}: ${actual}, the model has ${wanted}`); };
    count("AngularJS components", components.length, COMPONENTS.length);
    count("AngularJS directives", directives.length, DIRECTIVES.length);
    count("AngularJS filters", filters.length, FILTERS.length);
    count("AngularJS services and factories", services.length, SERVICES.length);
    count("downgraded components", downgradedComponents.length, 10);
    count("downgraded injectables", downgradedInjectables.length, 4);
    count("Angular components", angularSelectors.length, ANGULAR_COMPONENTS.length);
    count("UpgradeComponent wrappers", wrappers.length, WRAPPERS.length);
    count("states", states.length, STATES.length);

    // 1. dead components: no element in an AngularJS template, no state names it, no wrapper that an Angular template uses.
    const ajsTagCounts = new Map();
    ajsScans.flatMap(scan => scan.elements).forEach(tag => ajsTagCounts.set(tag, (ajsTagCounts.get(tag) ?? 0) + 1));
    const stateComponents = new Set(inAjsCode(/\bcomponent\s*:\s*"(\w+)"/g));
    const wrapped = new Set(wrappers.filter(wrapper => angularTags.has(wrapper.selector)).map(wrapper => wrapper.ajsName));
    const deadComponents = components.filter(name => !ajsTagCounts.has(kebab(name)) && !stateComponents.has(name) && !wrapped.has(name));

    // 2. leaves: follow templateUrl / template and every ng-include, look for a registered component tag or directive attribute.
    const componentTags = new Set(components.map(kebab));
    const directiveAttributes = new Set(directives.map(kebab));
    const urlOfComponent = new Map(ajsCode.flatMap(source => [ ...source.text.matchAll(/\.component\(\s*"(\w+)",\s*\{\s*templateUrl\s*:\s*"([^"]+)"/g) ].map(match => [ match[1], match[2] ])));
    const inlineOfComponent = new Map(ajsInline.filter(entry => entry.owner).map(entry => [ entry.owner, entry.scan ]));
    const usesAjs = (scan, seen = new Set()) => {
        if (!scan || seen.has(scan)) return false;
        seen.add(scan);
        return scan.elements.some(tag => componentTags.has(tag)) || scan.attributes.some(name => directiveAttributes.has(name)) || scan.includes.some(url => usesAjs(htmlByUrl.get(url), seen));
    };
    const leafComponents = components.filter(name => {
        const scan = urlOfComponent.has(name) ? htmlByUrl.get(urlOfComponent.get(name)) : inlineOfComponent.get(name);
        if (!scan) problems.push(`no template found for the emitted component ${name}`);
        return scan && !usesAjs(scan);
    });

    // 4. filters: "| name" in a template expression, $filter("name"), or "nameFilter" as a string in AngularJS code.
    const applied = new Set([ ...ajsScans.flatMap(scan => scan.expressions.flatMap(filtersOf)), ...inAjsCode(/\$filter\(\s*"(\w+)"\s*\)/g), ...inAjsCode(/"(\w+)Filter"/g) ]);
    // 5. twins: an emitted @Component (spec files and wrapper directives are not in angularSelectors) with the kebab name as selector.
    const twinComponents = components.filter(name => angularSelectors.includes(kebab(name)));
    // 6. services: $inject arrays, inline array annotations, $injector.get on the AngularJS side, i.get("name") on the Angular side.
    const injected = new Set([
        ...ajsCode.flatMap(source => [ ...source.text.matchAll(/\$inject(?::\s*string\[\])?\s*=\s*\[([^\]]*)\]/g) ].flatMap(match => quoted(match[1]))),
        ...ajsCode.flatMap(source => [ ...source.text.matchAll(/\[\s*((?:"[^"]+",\s*)+)function\b/g) ].flatMap(match => quoted(match[1]))),
        ...inAjsCode(/\$injector\.get\(\s*"([\w$]+)"\s*\)/g),
        ...angularCode.flatMap(source => [ ...source.text.matchAll(/\.get\(\s*"([\w$]+)"\s*\)/g) ].map(match => match[1]))
    ]);

    const rederived = {
        deadComponents: sorted(deadComponents),
        leafComponents: sorted(leafComponents),
        standardBearerElements: ajsTagCounts.get("standard-bearer") ?? 0,
        unusedFilters: sorted(filters.filter(name => !applied.has(name))),
        twinComponents: sorted(twinComponents),
        unusedServices: sorted(services.filter(name => !injected.has(name)))
    };
    for (const question of Object.keys(key)) {
        if (JSON.stringify(rederived[question]) === JSON.stringify(key[question])) continue;
        const detail = Array.isArray(key[question])
            ? `only in the key [${key[question].filter(name => !rederived[question].includes(name))}], only in the files [${rederived[question].filter(name => !key[question].includes(name))}]`
            : `the key says ${key[question]}, the files have ${rederived[question]}`;
        problems.push(`${question}: model and emitted files disagree - ${detail}`);
    }

    const textOf = new Map(sources.map(source => [ source.relative, source.text ]));
    for (const trap of traps) {
        for (const [ relative, snippet ] of trap.evidence) {
            if (!textOf.get(relative)?.includes(snippet)) problems.push(`trap ${trap.question}/${trap.name}: ${relative} does not contain ${JSON.stringify(snippet)}`);
        }
    }
    for (const trap of traps.filter(candidate => candidate.plain)) {
        const own = kebab(trap.name);
        const mention = new RegExp(`(?<![\\w-])(?:${trap.name}|${own})(?![\\w])`);
        const registration = new RegExp(`\\.(?:component|filter|service|factory)\\(\\s*"${trap.name}"`);
        for (const source of sources.filter(candidate => !path.posix.basename(candidate.relative).startsWith(own))) {
            source.text.split("\n").forEach((line, index) => {
                if (mention.test(line) && !registration.test(line)) problems.push(`control case ${trap.name} is mentioned in ${source.relative}:${index + 1}, so it is not a plain case`);
            });
        }
    }
    const hash = createHash("sha256");
    sources.forEach(source => hash.update(source.relative).update("\0").update(source.text).update("\0"));
    return { problems, treeHash: hash.digest("hex").slice(0, 16) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Run: check the model, write the fixture and the key, test what was written.
// ---------------------------------------------------------------------------------------------------------------------
function fail(title, problems) {
    console.error(`generate-hybrid: ${title}`);
    problems.forEach(problem => console.error(`  - ${problem}`));
    process.exit(1);
}

const modelProblems = checkModel();
if (modelProblems.length) fail("the model does not hold together, nothing was written", modelProblems);

const answers = answerKey();
const TARGET_SIZES = { deadComponents: [ 6, 6 ], leafComponents: [ 13, 16 ], standardBearerElements: [ 9, 9 ], unusedFilters: [ 3, 3 ], twinComponents: [ 5, 5 ], unusedServices: [ 3, 3 ] };
const sizeProblems = Object.entries(TARGET_SIZES).flatMap(([ question, [ least, most ] ]) => {
    const size = Array.isArray(answers[question]) ? answers[question].length : answers[question];
    return size < least || size > most ? [ `${question}: ${size}, the contract wants ${least === most ? least : `${least} to ${most}`}` ] : [];
});
if (sizeProblems.length) fail("the answers of the model miss the target sizes, nothing was written", sizeProblems);
const readingProblems = strictReadingProblems(answers);
if (readingProblems.length) fail("an answer depends on whether a use inside dead code counts, nothing was written", readingProblems);

const files = fixtureFiles();
rmSync(BASE, { recursive: true, force: true });
for (const [ relative, content ] of files) {
    const target = path.join(BASE, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
}

const ajsSources = [ ...files ].filter(([ relative ]) => relative.startsWith(`${AJS}/`) && !/\.spec\.(ts|js)$/.test(relative));
const sizes = {
    ajsComponents: COMPONENTS.length,
    ajsDirectives: DIRECTIVES.length,
    ajsFilters: FILTERS.length,
    ajsServices: SERVICES.length,
    downgradedComponents: ANGULAR_COMPONENTS.filter(component => component.downgradedAs).length,
    downgradedInjectables: ANGULAR_SERVICES.length,
    angularComponents: ANGULAR_COMPONENTS.length,
    upgradeWrappers: WRAPPERS.length,
    states: STATES.length,
    ajsTemplates: ajsSources.filter(([ relative ]) => relative.endsWith(".html")).length,
    ajsInlineTemplates: COMPONENTS.filter(component => component.kind !== "url").length + STATES.filter(state => state.inline).length,
    ajsFiles: ajsSources.length,
    ajsLines: ajsSources.reduce((sum, [ , content ]) => sum + content.split("\n").length - 1, 0)
};
writeFileSync(KEY_FILE, JSON.stringify({ answers, sizes, traps: TRAPS.map(({ question, name, why, plain }) => ({ question, name, why, ...(plain ? { plain } : {}) })) }, null, 2) + "\n");

const { problems, treeHash } = selfTest(answers, TRAPS);
if (problems.length) fail("the emitted files do not agree with the model (hybrid-key.json is not to be trusted)", problems);

console.log(`hybrid/: ${sizes.ajsComponents} AngularJS components (${answers.deadComponents.length} dead, ${answers.leafComponents.length} leaves, ${answers.twinComponents.length} with an Angular twin), `
    + `${sizes.ajsFilters} filters (${answers.unusedFilters.length} unused), ${sizes.ajsServices} services (${answers.unusedServices.length} unused), ${answers.standardBearerElements} <standard-bearer> elements; `
    + `${sizes.states} states, ${sizes.ajsTemplates} AngularJS template files and ${sizes.ajsInlineTemplates} inline templates, ${sizes.ajsFiles} files and ${sizes.ajsLines} lines under ${AJS}; ${TRAPS.length} traps; self-test passed, tree sha256 ${treeHash}`);
