// Renders single slides of the five-minute deck to PNG files, to look at one slide without building anything else:
//   node deck/shot.mjs results models        -> prints the path of one 1920x1080 PNG per slide id
// Uses headless Chrome (CHROME=<path> overrides) and the same page rules as the PowerPoint export. Safe to run in parallel.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DECK = import.meta.dirname;
const SOURCE = path.join(DECK, "five-min/project");
const CHROME = process.env.CHROME ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const OUT = path.join(os.tmpdir(), "deck-shots");

const deck = JSON.parse(readFileSync(path.join(SOURCE, "deck.json"), "utf8"));
const fullDeckIds = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(DECK, "five-min/assets.json"), "utf8"))).map(([ full, own ]) => [ own.split("/").pop(), full ]));
const blobs = Object.fromEntries(readdirSync(path.join(DECK, "assets/blob")).map(name => [ name.split(".")[0], name ]));
const localImages = html => html.replace(/\/_blob\/([0-9a-f]{32})/g, (match, id) => pathToFileURL(path.join(DECK, "assets/blob", blobs[fullDeckIds[id] ?? id] ?? "missing")).href);

mkdirSync(OUT, { recursive: true });
for (const id of process.argv.slice(2)) {
    const file = path.join(SOURCE, `slides/${id}.html`);
    if (!existsSync(file)) {
        console.error(`${id}: no such slide (${file})`);
        process.exitCode = 1;
        continue;
    }
    const work = mkdtempSync(path.join(os.tmpdir(), "deck-shot-"));
    const page = path.join(work, "page.html");
    writeFileSync(page, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${Object.values(deck.faces).map(face => `<link rel="stylesheet" href="${face.href}">`).join("\n")}
<style>
html, body { margin: 0; background: #000; }
p, h1, h2, h3, ul { margin: 0; }
ul { padding-left: 1.1em; }
table { border-collapse: collapse; width: 100%; }
td, th { padding: 10px 18px; }
aside { display: none; }
.frame { width: 1920px; height: 1080px; position: absolute; left: 0; top: 0; overflow: hidden; }
.frame > section { position: absolute; inset: 0; box-sizing: border-box; }
</style>
</head>
<body><div class="frame">${localImages(readFileSync(file, "utf8"))}</div></body>
</html>
`);
    const target = path.join(OUT, `${id}.png`);
    const run = spawnSync(CHROME, [ "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1920,1080", "--force-device-scale-factor=1", "--virtual-time-budget=8000", `--user-data-dir=${path.join(work, "profile")}`, `--screenshot=${target}`, pathToFileURL(page).href ], { stdio: "ignore", timeout: 60000 });
    if (run.status === 0 && existsSync(target)) console.log(target);
    else {
        console.error(`${id}: Chrome did not write a screenshot`);
        process.exitCode = 1;
    }
}
