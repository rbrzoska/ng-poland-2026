// Renders the deck sources (deck/project) to one self-contained page and a PDF, without claude.ai:
//   node deck/render.mjs        → deck/out/deck.html and deck/out/deck.pdf (one 1920×1080 page per slide)
// Images come from deck/assets/blob/<asset id>.<ext>; the PDF needs Google Chrome (run headless with a throwaway profile).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DECK = import.meta.dirname;
const OUT = path.join(DECK, "out");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const deck = JSON.parse(readFileSync(path.join(DECK, "project/deck.json"), "utf8"));
const blobs = Object.fromEntries(readdirSync(path.join(DECK, "assets/blob")).map(name => [ name.split(".")[0], name ]));
const localImages = html => html.replace(/\/_blob\/([0-9a-f]{32})/g, (match, id) => (blobs[id] ? `../assets/blob/${blobs[id]}` : match));
const withoutNotes = html => html.replace(/<aside>[\s\S]*?<\/aside>/g, "");

const slides = deck.order.map(id => `<div class="frame">${withoutNotes(localImages(readFileSync(path.join(DECK, `project/slides/${id}.html`), "utf8")))}</div>`);
const fonts = Object.values(deck.faces).map(face => `<link rel="stylesheet" href="${face.href}">`).join("\n");
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${deck.title}</title>
${fonts}
<style>
@page { size: 1920px 1080px; margin: 0; }
html, body { margin: 0; background: #2b2b2b; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
p, h1, h2, h3, ul { margin: 0; }
ul { padding-left: 1.1em; }
table { border-collapse: collapse; width: 100%; }
td, th { padding: 10px 18px; }
.frame { width: 1920px; height: 1080px; position: relative; overflow: hidden; break-after: page; margin: 0 auto 24px; }
.frame > section { position: absolute; inset: 0; box-sizing: border-box; }
@media print { html, body { background: none; } .frame { margin: 0; } }
</style>
</head>
<body>
${slides.join("\n")}
</body>
</html>
`;
mkdirSync(OUT, { recursive: true });
const htmlFile = path.join(OUT, "deck.html");
writeFileSync(htmlFile, page);
console.log(`deck/out/deck.html: ${slides.length} slides`);

if (existsSync(CHROME)) {
    const pdfFile = path.join(OUT, "deck.pdf");
    execFileSync(CHROME, [
        "--headless=new",
        "--disable-gpu",
        `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "deck-pdf-"))}`,
        "--no-pdf-header-footer",
        "--virtual-time-budget=20000",
        `--print-to-pdf=${pdfFile}`,
        pathToFileURL(htmlFile).href
    ], { stdio: "ignore" });
    console.log("deck/out/deck.pdf written");
} else {
    console.log("Google Chrome not found — open deck/out/deck.html and print it to PDF");
}
