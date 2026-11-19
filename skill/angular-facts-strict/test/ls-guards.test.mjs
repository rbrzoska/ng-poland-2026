#!/usr/bin/env node
// Test of the guards of ls-facts.mjs on a tiny workspace this script writes into the temp folder: a rename that would edit a
// library, a binding two directives share, a selector that is the input's own name, an alias asked as a member, a tsconfig
// plugin that must never run, and compiler places shown relative to --root when the tsconfig is in a project folder.
//   node test/ls-guards.test.mjs [--keep]      exit code 0 when every check passes; --keep leaves the workspace on disk
// The packages are the ones of the nearest node_modules above this file that holds @angular/core (linked, not copied).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "ls-facts.mjs");
const keep = process.argv.includes("--keep");
const packages = path.resolve(path.dirname(createRequire(import.meta.url).resolve("@angular/core/package.json")), "..", "..", "..");
const base = mkdtempSync(path.join(os.tmpdir(), "ls-guards-"));
const root = path.join(base, "shop");
const marker = path.join(base, "plugin-ran");

const FILES = {
    "angular.json": JSON.stringify({ version: 1, projects: { shop: { projectType: "application", root: "projects/shop", sourceRoot: "projects/shop/src",
        architect: { build: { options: { tsConfig: "projects/shop/tsconfig.app.json" } } } } } }),
    "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022", module: "ES2022", moduleResolution: "bundler", skipLibCheck: true, lib: [ "ES2022", "dom" ],
            plugins: [ { name: "planted-plugin" } ] },
        angularCompilerOptions: { strictTemplates: true }
    }),
    "projects/shop/tsconfig.app.json": JSON.stringify({ extends: "../../tsconfig.json", files: [ "src/main.ts" ] }),
    "node_modules/planted-plugin/package.json": JSON.stringify({ name: "planted-plugin", version: "1.0.0", main: "index.js" }),
    "node_modules/planted-plugin/index.js": `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran");\nmodule.exports = () => ({ create: info => info.languageService });\n`,
    "projects/shop/src/main.ts": `import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent);
`,
    "projects/shop/src/app/tag.component.ts": `import { Component, Input, input } from "@angular/core";

@Component({ selector: "a-x", template: "<span>{{ label() }} {{ color }}</span>" })
export class TagComponent {
    label = input("");
    @Input({ alias: "tone" }) color = "grey";
}
`,
    "projects/shop/src/app/label.directive.ts": `import { Directive, input } from "@angular/core";

@Directive({ selector: "[label]" })
export class LabelDirective {
    label = input("");
}
`,
    "projects/shop/src/app/shout.pipe.ts": `import { Pipe, PipeTransform } from "@angular/core";

@Pipe({ name: "shout" })
export class ShoutPipe implements PipeTransform {
    transform(value: string): string {
        return value.toUpperCase();
    }
}
`,
    "projects/shop/src/app/app.component.ts": `import { Component } from "@angular/core";
import { LabelDirective } from "./label.directive";
import { ShoutPipe } from "./shout.pipe";
import { TagComponent } from "./tag.component";

@Component({
    selector: "shop-root",
    imports: [ TagComponent, LabelDirective, ShoutPipe ],
    template: \`<a-x [label]="title | shout" [tone]="'blue'"></a-x><p label="only the directive"></p>\`
})
export class AppComponent {
    title = "shop";
}
`
};

for (const [ file, text ] of Object.entries(FILES)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
}
symlinkSync(path.join(packages, "node_modules"), path.join(base, "node_modules"), "junction");

let failures = 0;
function check(what, passed, detail = "") {
    if (!passed) failures++;
    console.log(`${passed ? "ok  " : "FAIL"} ${what}${passed || !detail ? "" : `\n       ${String(detail).split("\n").join("\n       ")}`}`);
}
const run = (...args) => {
    const result = spawnSync(process.execPath, [ SCRIPT, ...args, "--root", root ], { encoding: "utf8", timeout: 300_000 });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
};
const hashOf = file => createHash("sha1").update(readFileSync(file)).digest("hex");

// a member that implements a library one: refused before anything is written
{
    const pipe = path.join(root, "projects/shop/src/app/shout.pipe.ts");
    const before = hashOf(pipe);
    const refused = run("rename", "ShoutPipe.transform", "shoutIt", "--write");
    check("rename of a member a library declares too: exit 1, nothing written", refused.code === 1 && /is also declared outside the workspace's own sources/.test(refused.out) && hashOf(pipe) === before, refused.out);
    check("the refusal names the library file from node_modules on, not a long relative path", /e\.g\. node_modules\/@angular\/[\w-]+\//.test(refused.out), refused.out);
}

// one attribute that feeds two directives, and a selector that is the input's own name
{
    const shared = run("rename", "TagComponent.label", "caption");
    check("a binding another directive takes too: a ! line names LabelDirective and the place", /bindings? also feeds? LabelDirective\.label on the same element/.test(shared.out) && /app\.component\.ts:9/.test(shared.out), shared.out);
    const own = run("rename", "LabelDirective.label", "caption");
    check("an input whose name is its directive's selector: a ! line says the selector is not renamed", /the selector \[label\] of LabelDirective is the input's own name and is NOT renamed/.test(own.out), own.out);
}

// an alias asked as if it were a member
{
    const alias = run("refs", "TagComponent.tone");
    check("an alias asked as a member: exit 1, and it names the member", alias.code === 1 && /"tone" is the alias of TagComponent\.color/.test(alias.out), alias.out);
}

// a plugin that a tsconfig names never runs
check("a tsconfig plugin is not loaded by refs or rename", !existsSync(marker), "the planted plugin wrote its marker");

// compiler places relative to --root, also when the tsconfig is in a project folder
{
    const app = path.join(root, "projects/shop/src/app/app.component.ts");
    writeFileSync(app, readFileSync(app, "utf8").replace("title = \"shop\";", "title: number = \"shop\";"));
    const checked = run("check", "--all");
    check("check: an error place is relative to --root (projects/shop/src/…), not to the tsconfig folder", checked.code === 2 && /^\s+projects\/shop\/src\/app\/app\.component\.ts:\d+:\d+/m.test(checked.out), checked.out);
}

// the junction goes first, so that nothing behind it is ever removed
if (keep) console.log(`kept: ${base}`);
else {
    const link = path.join(base, "node_modules");
    if (lstatSync(link).isSymbolicLink() || readdirSync(base).includes("node_modules")) unlinkSync(link);
    rmSync(base, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
