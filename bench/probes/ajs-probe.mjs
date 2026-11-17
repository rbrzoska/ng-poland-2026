// Probe: what does @angular/compiler make of an AngularJS (1.x) template?
import { parseTemplate, HtmlParser, Lexer, Parser } from "@angular/compiler";

const template = `
<div class="orders" ng-if="$ctrl.orders.length">
  <order-row ng-repeat="order in $ctrl.orders | filter:{status:'open'} | orderBy:'-date' track by order.id"
             order="order" on-select="$ctrl.select(order, $event)" disabled="::$ctrl.locked"></order-row>
  <span ng-bind="::$ctrl.total | currency:'EUR'"></span>
  <a ui-sref="orders.detail({ id: order.id })" ng-class="{active: $ctrl.isActive(order)}">{{ ::order.name | uppercase }}</a>
  <input ng-model="$ctrl.query" ng-model-options="{ debounce: 300 }">
</div>`;

// 1. Full Angular template parse
const full = parseTemplate(template, "orders.html", { preserveWhitespaces: false });
console.log("parseTemplate errors:", (full.errors || []).length);
for (const e of full.errors || []) console.log("  -", e.msg.split("\n")[0]);

// 2. Plain HTML parse: elements + attributes with source spans
const html = new HtmlParser().parse(template, "orders.html");
console.log("HtmlParser errors:", html.errors.length);
const walk = (nodes, depth = 0) => {
    for (const n of nodes) {
        if (n.name && n.attrs) {
            console.log("  ".repeat(depth) + `<${n.name}> @${n.sourceSpan.start.line + 1}:${n.sourceSpan.start.col}  attrs: ${n.attrs.map(a => a.name).join(", ")}`);
            walk(n.children, depth + 1);
        }
    }
};
walk(html.rootNodes);

// 3. Expression parser on AngularJS expressions
const parser = new Parser(new Lexer());
const tryExpr = (label, src) => {
    try {
        const ast = parser.parseBinding(src, full.nodes[0].sourceSpan, 0);
        console.log(`${label.padEnd(28)} ${ast.errors.length ? "ERR " + ast.errors[0].message.split("\n")[0].slice(0, 90) : "ok  → " + ast.ast.constructor.name}`);
    } catch (err) { console.log(label.padEnd(28), "THROW", String(err.message).slice(0, 90)); }
};
tryExpr("member call", "$ctrl.select(order, $event)");
tryExpr("filter with arg", "$ctrl.total | currency:'EUR'");
tryExpr("filter chain + object arg", "$ctrl.orders | filter:{status:'open'} | orderBy:'-date'");
tryExpr("one-time ::", "::$ctrl.locked");
tryExpr("ng-repeat micro-syntax", "order in $ctrl.orders track by order.id");
tryExpr("ng-class object", "{active: $ctrl.isActive(order)}");
tryExpr("ui-sref state call", "orders.detail({ id: order.id })");
