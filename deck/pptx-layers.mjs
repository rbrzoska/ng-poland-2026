// Step 1 of the PowerPoint export: node deck/pptx-layers.mjs, then python3 deck/pptx-build.py
// Renders the five-minute deck in headless Chrome and cuts every slide into picture layers (a background plus one
// transparent PNG per heading, card, table row, list item and illustration) so PowerPoint can animate them one by one
// and the slides look the same on a machine without the deck's fonts. Writes deck/out/pptx/manifest.json.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DECK = import.meta.dirname;
const SOURCE = path.join(DECK, "five-min/project");
// PPTX_TEXT=1: text is not baked into the pictures; every line of text is written to the manifest with its font,
// size, colour and place, so the PowerPoint builder can put real, editable text boxes there (deck/out/pptx-text).
const TEXT = process.env.PPTX_TEXT === "1";
const OUT = path.join(DECK, TEXT ? "out/pptx-text" : "out/pptx");
const CHROME = process.env.CHROME ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const SLIDE = { width: 1920, height: 1080 };
const PIXEL_RATIO = 2;

const deck = JSON.parse(readFileSync(path.join(SOURCE, "deck.json"), "utf8"));
const fullDeckIds = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(DECK, "five-min/assets.json"), "utf8"))).map(([ full, own ]) => [ own.split("/").pop(), full ]));
const blobs = Object.fromEntries(readdirSync(path.join(DECK, "assets/blob")).map(name => [ name.split(".")[0], name ]));
const localImages = html => html.replace(/\/_blob\/([0-9a-f]{32})/g, (match, id) => `../../assets/blob/${blobs[fullDeckIds[id] ?? id]}`);
const sources = deck.order.map(id => ({ id, html: readFileSync(path.join(SOURCE, `slides/${id}.html`), "utf8") }));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const pageFile = path.join(OUT, "page.html");
writeFileSync(pageFile, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${Object.values(deck.faces).map(face => `<link rel="stylesheet" href="${face.href}">`).join("\n")}
<style>
html, body { margin: 0; }
p, h1, h2, h3, ul { margin: 0; }
ul { padding-left: 1.1em; }
table { border-collapse: collapse; width: 100%; }
td, th { padding: 10px 18px; }
aside { display: none; }
.frame { width: ${SLIDE.width}px; height: ${SLIDE.height}px; position: absolute; left: 0; top: 0; overflow: hidden; display: none; }
.frame.current { display: block; }
.frame > section { position: absolute; inset: 0; box-sizing: border-box; }
html.layer, html.layer body { background: transparent; }
html.layer .frame.current section, html.layer .frame.current section * { visibility: hidden !important; }
html.layer .frame.current section [data-show], html.layer .frame.current section [data-show] *, html.layer .frame.current section [data-show-self] { visibility: visible !important; }
html.base .frame.current section [data-unit], html.base .frame.current section [data-unit] * { visibility: hidden !important; }
/* a highlight that comes in on a click is its own layer: the text under it is drawn plain */
html.layer mark[data-step]:not([data-show]) { background: transparent !important; color: inherit !important; }
/* text mode: the picture of a layer keeps its boxes and fills, the letters are left out */
html.notext .frame.current section [data-show], html.notext .frame.current section [data-show] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
html.notext .frame.current section [data-show][style*="background-clip:text"], html.notext .frame.current section [data-show] [style*="background-clip:text"] { background: none !important; }
</style>
</head>
<body>
${sources.map(source => `<div class="frame" data-slide="${source.id}">${localImages(source.html)}</div>`).join("\n")}
</body>
</html>
`);

/** Runs in the page: marks the animated units of the current slide and returns their boxes in reading order. */
function collectUnits(slide) {
    const section = document.querySelector(".frame.current section");
    const units = [];
    const isPainted = element => {
        const style = getComputedStyle(element);
        const hasFill = style.backgroundColor !== "rgba(0, 0, 0, 0)" || (style.backgroundImage !== "none" && style.webkitBackgroundClip !== "text");
        const hasBorder = [ "Top", "Right", "Bottom", "Left" ].some(side => parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== "none");
        return hasFill || hasBorder || style.boxShadow !== "none";
    };
    const hasOwnText = element => [ ...element.childNodes ].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const boxOf = (element, withDescendants) => {
        const rects = [ element, ...(withDescendants ? element.querySelectorAll("*") : []) ].map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height);
        if (!rects.length) return null;
        const left = Math.max(0, Math.floor(Math.min(...rects.map(rect => rect.left)) - 2));
        const top = Math.max(0, Math.floor(Math.min(...rects.map(rect => rect.top)) - 2));
        const right = Math.min(slide.width, Math.ceil(Math.max(...rects.map(rect => rect.right)) + 2));
        const bottom = Math.min(slide.height, Math.ceil(Math.max(...rects.map(rect => rect.bottom)) + 2));
        return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
    };
    const add = (element, kind, shellOnly = false) => {
        const box = boxOf(element, !shellOnly);
        if (!box) return;
        element.setAttribute("data-unit", String(units.length));
        // data-step="n" on the element or an ancestor: the layer comes in on the n-th click instead of with the slide
        const step = Number(element.closest("[data-step]")?.getAttribute("data-step") ?? 0);
        units.push({ kind, shellOnly, box, step, text: (shellOnly ? "" : element.getAttribute("alt") ?? element.textContent).replace(/\s+/g, " ").trim() });
    };
    const kindOfImage = element => {
        const box = element.getBoundingClientRect();
        const pinned = getComputedStyle(element).position === "absolute";
        const isBadge = pinned && box.width <= 130 && box.height <= 130;
        const isBackdrop = box.width * box.height >= 0.3 * slide.width * slide.height;
        return isBadge || isBackdrop ? null : "image";
    };
    const walk = parent => {
        for (const element of parent.children) {
            const tag = element.tagName;
            if (tag === "ASIDE" || getComputedStyle(element).visibility === "hidden") continue;
            if (tag === "IMG") {
                const kind = kindOfImage(element);
                if (kind) add(element, kind);
            } else if (tag === "H1" || tag === "H2") add(element, "title");
            else if (tag === "TABLE") {
                add(element, "frame", true);
                for (const row of element.rows) add(row, "row");
            } else if (tag === "UL" || tag === "OL") for (const item of element.children) add(item, "item");
            else if (tag === "DIV" && !isPainted(element) && !hasOwnText(element)) walk(element);
            else if (tag === "DIV" && element.querySelector("[data-step]")) {
                // a box whose parts come in on clicks: the empty box is one layer, each part its own
                add(element, "frame", true);
                walk(element);
            } else if (tag === "DIV" && getComputedStyle(element).borderTopLeftRadius === "50%") add(element, "image");
            else if (tag === "DIV") add(element, "card");
            else if (tag === "P" && getComputedStyle(element).textTransform === "uppercase") add(element, "kicker");
            else add(element, "text");
        }
    };
    walk(section);
    for (const highlight of section.querySelectorAll("mark[data-step]")) add(highlight, "text");
    return { title: (section.querySelector("h1, h2")?.textContent ?? "").replace(/\s+/g, " ").trim(), units };
}

/** Runs in the page: every line of text of one unit, as runs with font, size, colour and the place of the line. */
function collectText(unitIndex) {
    const root = document.querySelector('.frame.current [data-unit="' + unitIndex + '"]');
    const hex = value => {
        const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
        if (parts.length < 3 || (parts.length > 3 && parts[3] === 0)) return null;
        return parts.slice(0, 3).map(part => Math.round(part).toString(16).padStart(2, "0")).join("").toUpperCase();
    };
    const fragments = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        const style = getComputedStyle(parent);
        if (style.display === "none") continue;
        const clipped = parent.closest('[style*="background-clip:text"]');
        const gradient = clipped ? (getComputedStyle(clipped).backgroundImage.match(/rgba?\([^)]*\)/g) ?? []).map(hex).filter(Boolean) : [];
        const look = {
            family: style.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
            size: parseFloat(style.fontSize),
            bold: Number(style.fontWeight) >= 600,
            italic: style.fontStyle === "italic",
            colour: hex(style.color) ?? "000000",
            gradient: gradient.length >= 2 ? [ gradient[0], gradient[gradient.length - 1] ] : null,
            spacing: parseFloat(style.letterSpacing) || 0
        };
        const upper = style.textTransform === "uppercase";
        const raw = node.textContent;
        const range = document.createRange();
        let current = null;
        for (let index = 0; index < raw.length; index++) {
            const code = raw.charCodeAt(index);
            const length = code >= 0xD800 && code <= 0xDBFF ? 2 : 1;
            range.setStart(node, index);
            range.setEnd(node, index + length);
            const rect = range.getClientRects()[0];
            let character = raw.slice(index, index + length);
            index += length - 1;
            if (!rect || rect.width === 0) continue;
            if (/\s/.test(character) && character !== " ") character = " ";
            if (upper) character = character.toUpperCase();
            if (current && Math.abs(current.top - rect.top) < rect.height * 0.5) {
                current.text += character;
                current.right = rect.right;
            } else {
                if (current) fragments.push(current);
                current = { ...look, text: character, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
            }
        }
        if (current) fragments.push(current);
    }
    // Fragments of one size that sit next to each other on one line become one line of runs.
    const sameLook = (one, other) => one.family === other.family && one.size === other.size && one.bold === other.bold && one.italic === other.italic && one.colour === other.colour && String(one.gradient) === String(other.gradient) && one.spacing === other.spacing;
    const lines = [];
    for (const fragment of fragments.sort((one, other) => Math.abs(one.top - other.top) < 2 ? one.left - other.left : one.top - other.top)) {
        const line = lines.find(candidate => Math.abs(candidate.size - fragment.size) < 0.5 && Math.abs(candidate.top - fragment.top) < fragment.size * 0.4 && fragment.left - candidate.right < fragment.size * 0.6 && fragment.left - candidate.right > -2);
        if (!line) {
            lines.push({ size: fragment.size, top: fragment.top, left: fragment.left, right: fragment.right, bottom: fragment.bottom, runs: [ fragment ] });
            continue;
        }
        const last = line.runs[line.runs.length - 1];
        if (sameLook(last, fragment)) last.text += fragment.text;
        else line.runs.push(fragment);
        line.right = fragment.right;
        line.bottom = Math.max(line.bottom, fragment.bottom);
    }
    return lines.map(line => {
        const runs = line.runs.map(({ text, family, size, bold, italic, colour, gradient, spacing }) => ({ text, family, size, bold, italic, colour, gradient, spacing }));
        runs[0].text = runs[0].text.replace(/^ +/, "");
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ +$/, "");
        return { x: Math.round(line.left * 10) / 10, y: Math.round(line.top * 10) / 10, width: Math.round((line.right - line.left) * 10) / 10, height: Math.round((line.bottom - line.top) * 10) / 10, runs: runs.filter(run => run.text) };
    }).filter(line => line.runs.some(run => run.text.trim()));
}

const chrome = spawn(CHROME, [ "--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "deck-pptx-"))}`, "about:blank" ], { stdio: [ "ignore", "ignore", "pipe" ] });
const browserUrl = await new Promise((resolve, reject) => {
    let log = "";
    chrome.stderr.on("data", chunk => {
        log += chunk;
        const found = log.match(/DevTools listening on (ws:\/\/\S+)/);
        if (found) resolve(found[1]);
    });
    chrome.on("exit", () => reject(new Error("Chrome exited before DevTools was ready")));
});
try {
    const port = new URL(browserUrl).port;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error("cannot connect to Chrome"));
    });
    const pending = new Map();
    const listeners = new Map();
    let lastId = 0;
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        } else listeners.get(message.method)?.();
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        pending.set(++lastId, { resolve, reject });
        socket.send(JSON.stringify({ id: lastId, method, params }));
    });
    const evaluate = async expression => {
        const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
        return result.value;
    };
    const capture = async (file, clip, format) => {
        const { data } = await send("Page.captureScreenshot", { format, ...(format === "jpeg" ? { quality: 92 } : {}), clip: { ...clip, scale: 1 } });
        writeFileSync(path.join(OUT, file), Buffer.from(data, "base64"));
    };

    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { ...SLIDE, deviceScaleFactor: PIXEL_RATIO, mobile: false });
    const loaded = new Promise(resolve => listeners.set("Page.loadEventFired", resolve));
    await send("Page.navigate", { url: pathToFileURL(pageFile).href });
    await loaded;
    const families = JSON.stringify(Object.values(deck.faces).map(face => face.family));
    await evaluate(`Promise.all([ ...${families}.flatMap(family => [ 400, 500, 600, 700 ].map(weight => document.fonts.load(weight + ' 40px "' + family + '"'))), ...[ ...document.images ].map(image => image.decode().catch(() => null)) ]).then(() => true)`);
    const missingFonts = await evaluate(`${families}.filter(family => !document.fonts.check('40px "' + family + '"'))`);
    if (missingFonts.length) throw new Error(`fonts did not load: ${missingFonts.join(", ")}`);

    const manifest = [];
    for (const [ index, source ] of sources.entries()) {
        const name = String(index + 1).padStart(2, "0");
        await evaluate(`document.querySelector(".frame.current")?.classList.remove("current"); document.querySelector('.frame[data-slide="${source.id}"]').classList.add("current"); document.fonts.ready.then(() => true)`);
        const { title, units } = await evaluate(`(${collectUnits})(${JSON.stringify(SLIDE)})`);

        await evaluate(`document.documentElement.className = "base"; true`);
        await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 255, g: 255, b: 255, a: 1 } });
        await capture(`${name}-base.jpg`, { x: 0, y: 0, ...SLIDE }, "jpeg");

        await evaluate(`document.documentElement.className = "layer"; true`);
        await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
        for (const [ unitIndex, unit ] of units.entries()) {
            const attribute = unit.shellOnly ? "data-show-self" : "data-show";
            unit.file = `${name}-${String(unitIndex + 1).padStart(2, "0")}-${unit.kind}.png`;
            await evaluate(`document.querySelector('.frame.current [data-unit="${unitIndex}"]').setAttribute("${attribute}", ""); true`);
            const asText = TEXT && !unit.shellOnly && unit.kind !== "image";
            if (asText) {
                unit.lines = await evaluate(`(${collectText})(${unitIndex})`);
                await evaluate(`document.documentElement.classList.add("notext"); true`);
            }
            await capture(unit.file, unit.box, "png");
            if (asText) await evaluate(`document.documentElement.classList.remove("notext"); true`);
            await evaluate(`document.querySelector('.frame.current [data-unit="${unitIndex}"]').removeAttribute("${attribute}"); true`);
        }
        await evaluate(`document.documentElement.className = ""; true`);
        await capture(`${name}-full.jpg`, { x: 0, y: 0, ...SLIDE }, "jpeg");

        const notes = source.html.match(/<aside>([\s\S]*?)<\/aside>/)?.[1].trim() ?? "";
        manifest.push({ id: source.id, title, notes, base: `${name}-base.jpg`, full: `${name}-full.jpg`, units });
        console.log(`${name} ${source.id}: ${units.length} layers`);
    }
    writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ title: deck.title, slide: SLIDE, slides: manifest }, null, 2) + "\n");
    socket.close();
} finally {
    chrome.kill();
}
