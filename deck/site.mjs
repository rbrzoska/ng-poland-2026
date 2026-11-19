// Builds the web versions of the deck: node deck/site.mjs
//   docs/index.html        MAIN, the talk alone      -> https://rbrzoska.github.io/ng-poland-2026/
//   docs/full/index.html   FULL, talk + appendix     -> https://rbrzoska.github.io/ng-poland-2026/full/
//   presenter/*.html       the same two decks with speaker notes and the presenter view (P); kept on this machine only
// The public pages carry no speaker notes and no presenter view. Images are copied next to each set of pages.
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DECK, buildPage, imageFiles } from "./viewer.mjs";

const ROOT = path.join(DECK, "..");
const file = imageFiles();
const NAME = "veni-vidi-compilavi";

/** Writes one page; images go to <folder>/assets and are referenced relative to the page. */
function write({ folder, page, toAssets, ...options }) {
    const assets = path.join(folder, "assets");
    mkdirSync(assets, { recursive: true });
    mkdirSync(path.dirname(path.join(folder, page)), { recursive: true });
    const html = buildPage({
        ...options,
        image: id => {
            const name = file(id);
            if (!name) throw new Error(`no local image for /_blob/${id}`);
            copyFileSync(path.join(DECK, "assets/blob", name), path.join(assets, name));
            return `${toAssets}/${name}`;
        }
    });
    writeFileSync(path.join(folder, page), html);
    console.log(`${path.relative(ROOT, path.join(folder, page))}: ${(html.match(/class="frame"/g) ?? []).length} slides${options.presenter === false ? "" : ", with notes and presenter view"}`);
}

const SITE = path.join(ROOT, "docs");
rmSync(path.join(SITE, "assets"), { recursive: true, force: true });
rmSync(path.join(SITE, "full"), { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
writeFileSync(path.join(SITE, ".nojekyll"), "");
write({ folder: SITE, page: "index.html", toAssets: "assets", slides: "talk", notes: false, presenter: false });
write({ folder: SITE, page: "full/index.html", toAssets: "../assets", slides: "all", notes: false, presenter: false });
console.log(`docs/assets: ${readdirSync(path.join(SITE, "assets")).length} images`);

const LOCAL = path.join(ROOT, "presenter");
rmSync(path.join(LOCAL, "assets"), { recursive: true, force: true });
write({ folder: LOCAL, page: `${NAME}-main-presenter.html`, toAssets: "assets", slides: "talk" });
write({ folder: LOCAL, page: `${NAME}-full-presenter.html`, toAssets: "assets", slides: "all" });
