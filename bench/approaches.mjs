// The non-agent ways to migrate fixture/ from Pill v1 to v2, shared by bench/run.mjs and the UI.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadWorkspace, migrate } from "../tool/ng-facts.mjs";
import { sources } from "./score.mjs";

export const SPEC_FILE = path.resolve(import.meta.dirname, "../tool/specs/pill-v2.migration.json");
const TONES = { info: "neutral", success: "positive", warning: "caution" };

const negateText = value => {
    const trimmed = value.trim();
    if (trimmed === "true" || trimmed === "false") return String(trimmed !== "true");
    if (trimmed.startsWith("!")) return trimmed.slice(1);
    return /^[\w.]+$/.test(trimmed) ? `!${trimmed}` : `!(${trimmed})`;
};

/** Bulk text replacement: what a quick find & replace (or a hurried agent with sed) does. */
export function findAndReplace(workspace) {
    let occurrences = 0;
    let files = 0;
    for (const file of sources(path.join(workspace, "src"))) {
        if (file.includes(`${path.sep}lib${path.sep}`)) continue;
        const text = readFileSync(file, "utf8");
        const next = text.replaceAll("disableTooltip", "tooltip").replaceAll("[variant]=", "[tone]=").replaceAll(" variant=", " tone=");
        if (next === text) continue;
        occurrences += text.split("disableTooltip").length - 1;
        files++;
        writeFileSync(file, next);
    }
    return `replaced disableTooltip → tooltip, variant → tone (${occurrences} disableTooltip occurrences in ${files} files); label left alone`;
}

/** Tag-scoped regexes with negation, value mapping and label → content: the best a text approach can reasonably do. */
export function carefulRegex(workspace) {
    let tags = 0;
    for (const file of sources(path.join(workspace, "src"))) {
        if (file.includes(`${path.sep}lib${path.sep}`)) continue;
        const text = readFileSync(file, "utf8");
        const next = text.replace(/<app-pill\b[^>]*>(\s*<\/app-pill>)?/g, (match, closing) => {
            tags++;
            let tag = closing ? match.slice(0, match.length - closing.length) : match;
            let content = "";
            tag = tag.replace(/\s*\[label\]="([^"]*)"/, (_all, expression) => {
                content = `{{ ${expression.trim()} }}`;
                return "";
            }).replace(/\s*label="([^"]*)"/, (_all, value) => {
                content = value;
                return "";
            });
            tag = tag.replace(/\[disableTooltip\]="([^"]*)"/, (_all, value) => `[tooltip]="${negateText(value)}"`)
                .replace(/(\s)variant="(\w+)"/, (_all, space, value) => `${space}tone="${TONES[value] ?? value}"`)
                .replace(/\[variant\]="([^"]*)"/, (_all, expression) => `[tone]="${expression.replace(/'(\w+)'/g, (_quoted, value) => `'${TONES[value] ?? value}'`)}"`);
            if (tag.endsWith("/>")) return `${tag.replace(/\s*\/>$/, ">")}${content}</app-pill>`;
            return closing ? `${tag}${content}</app-pill>` : tag;
        });
        if (next !== text) writeFileSync(file, next);
    }
    return `rewrote ${tags} <app-pill …> start tags matched by /<app-pill\\b[^>]*>/`;
}

/** The Angular compiler + a declarative spec: ng-facts migrate. */
export function compilerMigration(workspace) {
    const spec = JSON.parse(readFileSync(SPEC_FILE, "utf8"));
    const result = migrate(loadWorkspace(workspace), spec, { write: true });
    return `ng-facts migrate: ${result.elements} elements, ${result.edits.length} edits in ${result.files.size} files, ${result.imports} imports added, ${result.decisions.length} decisions`;
}
