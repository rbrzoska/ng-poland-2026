// One slideshow page for the five-minute deck, shared by the GitHub Pages build (deck/site.mjs) and the
// local draft server (deck/serve.mjs).
//
// Audience view: arrow keys, click, swipe, F full screen, B black screen, #n in the address for a slide.
// Presenter view (P, or ?presenter in the address): like PowerPoint's Presenter View — current slide,
// next slide, speaker notes with the second each sentence should start at, a timer, the clock and
// how far ahead or behind plan you are. Both windows follow each other through a BroadcastChannel.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const DECK = import.meta.dirname;
export const SOURCE = path.join(DECK, "five-min/project");
const SLIDE = { width: 1920, height: 1080 };

/** Image file in deck/assets/blob for every /_blob/<id> reference used by the five-minute slides. */
export function imageFiles() {
    const fullDeckIds = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(DECK, "five-min/assets.json"), "utf8"))).map(([ full, own ]) => [ own.split("/").pop(), full ]));
    const blobs = Object.fromEntries(readdirSync(path.join(DECK, "assets/blob")).map(name => [ name.split(".")[0], name ]));
    return id => blobs[fullDeckIds[id] ?? id];
}

/**
 * Notes format (inside each slide's <aside>):
 *   [0:42] Sentence to say, starting at that second of the talk.
 *   [0:42] ✂ Sentence you drop first when you run late.
 *   → Stage direction (click, pause, look at the audience).
 *   Any other line is a quiet tip.
 */
export function parseNotes(text) {
    return text.trim().split("\n").map(line => line.trim()).filter(Boolean).map(line => {
        const timed = line.match(/^\[(\d+):(\d{2})\]\s*(✂\s*)?(.*)$/);
        if (timed) return { kind: "say", at: Number(timed[1]) * 60 + Number(timed[2]), cut: Boolean(timed[3]), text: timed[4] };
        if (line.startsWith("→")) return { kind: "do", text: line.slice(1).trim() };
        return { kind: "tip", text: line };
    });
}

/**
 * The whole page as a string. image(id) → URL of the image; slides: "all" or "talk" (only the slides before the appendix);
 * notes: include speaker notes; presenter: include the presenter view (off for the public page); reloadUrl: server-sent
 * events that reload the page.
 */
export function buildPage({ image, slides: which = "all", notes = true, presenter = true, reloadUrl = null, talkSeconds = 300 }) {
    const deck = JSON.parse(readFileSync(path.join(SOURCE, "deck.json"), "utf8"));
    const talkCount = deck.order.indexOf(deck.sections?.backup?.start ?? "");
    const order = which === "talk" && talkCount > 0 ? deck.order.slice(0, talkCount) : deck.order;
    const slides = order.map(id => {
        const html = readFileSync(path.join(SOURCE, `slides/${id}.html`), "utf8").replace(/\/_blob\/([0-9a-f]{32})/g, (reference, blob) => image(blob) ?? reference);
        const aside = html.match(/<aside>([\s\S]*?)<\/aside>/)?.[1] ?? "";
        return { id, html: html.replace(/<aside>[\s\S]*?<\/aside>/g, ""), notes: notes ? parseNotes(aside) : [] };
    });
    const data = { talkCount: talkCount > 0 ? Math.min(talkCount, slides.length) : slides.length, talkSeconds, presenter, notes: slides.map(slide => slide.notes), ids: slides.map(slide => slide.id) };
    const frames = slides.map(slide => `<div class="frame" data-id="${slide.id}">${slide.html}</div>`).join("\n");
    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Veni, Vidi, Compilavi · NG Poland 2026</title>
<meta name="description" content="Teaching AI agents to use the Angular compiler: slides of Rafał Brzoska's lightning talk at NG Poland 2026.">
${Object.values(deck.faces).map(face => `<link rel="stylesheet" href="${face.href}">`).join("\n")}
<style>
html, body { margin: 0; height: 100%; background: #0d0312; overflow: hidden; }
p, h1, h2, h3, ul { margin: 0; }
ul { padding-left: 1.1em; }
table { border-collapse: collapse; width: 100%; }
td, th { padding: 10px 18px; }
.slides { position: absolute; width: ${SLIDE.width}px; height: ${SLIDE.height}px; transform-origin: 0 0; }
.frame { position: absolute; inset: 0; overflow: hidden; opacity: 0; visibility: hidden; transition: opacity .25s, visibility .25s; }
.frame.current { opacity: 1; visibility: visible; }
.frame > section { position: absolute; inset: 0; box-sizing: border-box; }
#stage { left: 50%; top: 50%; cursor: pointer; }
#counter { position: fixed; left: 10px; bottom: 6px; font: 12px/1 Roboto, Arial, sans-serif; color: #fff; opacity: .45; }
#black { position: fixed; inset: 0; background: #000; display: none; z-index: 5; }
body.black #black { display: block; }

/* Presenter view */
#presenter { display: none; }
body.presenter #stage, body.presenter #counter { display: none; }
body.presenter { background: #17141c; color: #ece8f2; font: 16px/1.35 Roboto, Arial, sans-serif; }
body.presenter #presenter { display: grid; position: fixed; inset: 0; grid-template-columns: 1fr minmax(380px, 34%); grid-template-rows: auto 1fr auto; gap: 14px; padding: 14px; box-sizing: border-box; }
#bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 22px; }
#timer { font: 700 44px/1 "JetBrains Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
#timer.paused { opacity: .45; }
#plan { font-size: 18px; padding: 6px 12px; border-radius: 6px; background: #2a2533; }
#plan.ahead { background: #1d4a33; } #plan.late { background: #6b1f2c; } #plan.over { background: #b0102a; }
#clock { margin-left: auto; font: 600 22px/1 "JetBrains Mono", Consolas, monospace; opacity: .7; }
#bar button, #nav button { background: #2f2938; color: inherit; border: 1px solid #4a4256; border-radius: 6px; padding: 8px 14px; font: inherit; cursor: pointer; }
#bar button:hover, #nav button:hover { background: #3d3549; }
.view { position: relative; overflow: hidden; background: #000; border-radius: 4px; }
#now-view { align-self: start; aspect-ratio: 16 / 9; outline: 3px solid #F230BF; }
#side { display: grid; grid-template-rows: auto auto 1fr; gap: 10px; min-height: 0; }
#next-label, #notes-label { font-size: 13px; letter-spacing: 2px; text-transform: uppercase; opacity: .6; }
#next-view { aspect-ratio: 16 / 9; opacity: .9; }
#next-view.end::after { content: "End of the talk — backup slides follow"; position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.75); font-size: 18px; }
#notes { overflow-y: auto; font-size: 25px; line-height: 1.38; padding-right: 8px; min-height: 0; }
#notes .say { display: grid; grid-template-columns: 4.1em 1fr; gap: 6px; padding: 5px 8px; border-radius: 6px; margin-bottom: 4px; }
#notes .say .at { font: 600 20px/1.7 "JetBrains Mono", Consolas, monospace; color: #b9a8cf; }
#notes .say.done { opacity: .45; }
#notes .say.now { background: #3b2350; outline: 2px solid #F230BF; }
#notes .say.cut .text::before { content: "✂ "; color: #f0b54a; }
#notes .say.cut .text { color: #d8cfe4; font-style: italic; }
#notes .do { color: #7fd6a4; font-size: 20px; padding: 3px 8px; }
#notes .tip { color: #a99fb6; font-size: 18px; padding: 3px 8px; }
#notes .empty { opacity: .5; font-size: 18px; }
#nav { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; }
#position { font-size: 18px; opacity: .8; }
#keys { margin-left: auto; font-size: 13px; opacity: .5; }
</style>
</head>
<body>
<main id="stage" class="slides">
${frames}
</main>
<div id="counter"></div>
<div id="black"></div>
<div id="presenter">
  <div id="bar">
    <span id="timer" class="paused">0:00</span>
    <button id="toggle">Start</button><button id="reset">Reset</button>
    <span id="plan">plan: —</span>
    <span id="clock"></span>
  </div>
  <div id="now-view" class="view"></div>
  <div id="side">
    <div id="next-label">Next</div>
    <div id="next-view" class="view"></div>
    <div id="notes"></div>
  </div>
  <div id="nav">
    <button id="prev">◀ Back</button><button id="next">Next ▶</button>
    <span id="position"></span>
    <button id="audience">Open audience window</button>
    <span id="keys">← → slides · T timer · R reset · B black screen · F full screen</span>
  </div>
</div>
<script>
const DATA = ${JSON.stringify(data).replace(/</g, "\\u003c")};
const W = ${SLIDE.width}, H = ${SLIDE.height};
const presenter = DATA.presenter && new URLSearchParams(location.search).has("presenter");
const stage = document.getElementById("stage");
const frames = [ ...stage.querySelectorAll(".frame") ];
const channel = "BroadcastChannel" in window ? new BroadcastChannel("veni-vidi-compilavi") : null;
let current = 0;

// Time is shared through localStorage so a reload (live draft edits) keeps the timer running.
const TIMER_KEY = "vvc-timer";
const loadTimer = () => { try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || { start: null, elapsed: 0 }; } catch { return { start: null, elapsed: 0 }; } };
const saveTimer = timer => { try { localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); } catch {} };
let timer = loadTimer();
const elapsed = () => (timer.elapsed + (timer.start ? Date.now() - timer.start : 0)) / 1000;
const clock = seconds => (seconds < 0 ? "−" : "") + Math.floor(Math.abs(seconds) / 60) + ":" + String(Math.floor(Math.abs(seconds) % 60)).padStart(2, "0");

function fit(box, slides, width, height) {
    const scale = Math.min(width / W, height / H);
    slides.style.transform = "translate(" + (width - W * scale) / 2 + "px, " + (height - H * scale) / 2 + "px) scale(" + scale + ")";
}
const fitStage = () => {
    const scale = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = "translate(" + -W / 2 * scale + "px, " + -H / 2 * scale + "px) scale(" + scale + ")";
};

function show(index, { broadcast = true } = {}) {
    current = Math.max(0, Math.min(frames.length - 1, index));
    frames.forEach((frame, position) => frame.classList.toggle("current", position === current));
    document.getElementById("counter").textContent = current + 1 + " / " + frames.length;
    history.replaceState(null, "", location.search + "#" + (current + 1));
    if (broadcast && channel) channel.postMessage({ type: "show", index: current });
    if (presenter) renderPresenter();
}

// ---------- presenter ----------
let nowSlides, nextSlides;
function cloneDeck(target) {
    const copy = stage.cloneNode(true);
    copy.removeAttribute("id");
    copy.style.cursor = "default";
    target.appendChild(copy);
    new ResizeObserver(() => fit(target, copy, target.clientWidth, target.clientHeight)).observe(target);
    return copy;
}
function showIn(copy, index) {
    [ ...copy.children ].forEach((frame, position) => {
        frame.style.transition = "none";
        frame.classList.toggle("current", position === index);
    });
}
function slideWindow(index) {
    const says = DATA.notes[index].filter(line => line.kind === "say");
    if (!says.length) return null;
    // "→ Click to … at 1:23." gives the planned moment to leave the slide; otherwise the next slide's first sentence.
    const leave = DATA.notes[index].filter(line => line.kind === "do").map(line => line.text.match(/at (\\d+):(\\d{2})/)).filter(Boolean).pop();
    const nextSays = (DATA.notes[index + 1] || []).filter(line => line.kind === "say");
    const end = leave ? Number(leave[1]) * 60 + Number(leave[2]) : nextSays.length ? nextSays[0].at : index + 1 >= DATA.talkCount ? DATA.talkSeconds : null;
    return { start: says[0].at, end };
}
function renderPresenter() {
    showIn(nowSlides, current);
    showIn(nextSlides, current + 1);
    document.getElementById("next-view").classList.toggle("end", current + 1 >= DATA.talkCount);
    const isTalk = current < DATA.talkCount;
    document.getElementById("position").textContent = isTalk ? "Slide " + (current + 1) + " of " + DATA.talkCount : "Backup " + (current + 1 - DATA.talkCount) + " of " + (frames.length - DATA.talkCount);
    const notes = document.getElementById("notes");
    const lines = DATA.notes[current];
    notes.innerHTML = lines.length ? "" : '<div class="empty">No notes on this slide.</div>';
    for (const line of lines) {
        const row = document.createElement("div");
        row.className = line.kind + (line.cut ? " cut" : "");
        if (line.kind === "say") {
            row.dataset.at = line.at;
            row.innerHTML = '<span class="at"></span><span class="text"></span>';
            row.querySelector(".at").textContent = clock(line.at);
            row.querySelector(".text").textContent = line.text;
        } else row.textContent = (line.kind === "do" ? "→ " : "") + line.text;
        notes.appendChild(row);
    }
    notes.scrollTop = 0;
    tick();
}
function tick() {
    const seconds = elapsed();
    const timerEl = document.getElementById("timer");
    timerEl.textContent = clock(seconds);
    timerEl.classList.toggle("paused", !timer.start);
    document.getElementById("toggle").textContent = timer.start ? "Pause" : seconds ? "Resume" : "Start";
    document.getElementById("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const plan = document.getElementById("plan");
    const window_ = slideWindow(current);
    plan.className = "";
    if (current >= DATA.talkCount) plan.textContent = "backup slide";
    else if (!window_) plan.textContent = "plan: —";
    else {
        const left = (window_.end ?? window_.start) - seconds;
        const ahead = window_.start - seconds;
        if (seconds > DATA.talkSeconds) { plan.textContent = "OVER TIME by " + clock(seconds - DATA.talkSeconds); plan.className = "over"; }
        else if (window_.end !== null && seconds > window_.end) { plan.textContent = "behind plan by " + clock(seconds - window_.end) + " — cut ✂ lines"; plan.className = "late"; }
        else if (ahead > 3) { plan.textContent = "ahead of plan by " + clock(ahead) + " — slow down"; plan.className = "ahead"; }
        else plan.textContent = "on plan · move on at " + clock(window_.end ?? window_.start) + " (" + clock(left) + " left)";
    }
    const rows = [ ...document.querySelectorAll("#notes .say") ];
    let active = null;
    rows.forEach(row => { if (Number(row.dataset.at) <= seconds) active = row; });
    rows.forEach(row => {
        row.classList.toggle("now", row === active);
        row.classList.toggle("done", active !== null && Number(row.dataset.at) < Number(active.dataset.at));
    });
}
function toggleTimer() {
    timer = timer.start ? { start: null, elapsed: timer.elapsed + Date.now() - timer.start } : { start: Date.now(), elapsed: timer.elapsed };
    saveTimer(timer); tick();
}
function resetTimer() { timer = { start: null, elapsed: 0 }; saveTimer(timer); tick(); }

function openAudience() {
    window.open(location.pathname + "#" + (current + 1), "vvc-audience", "popup,width=1280,height=720");
}
function setBlack(on, broadcast = true) {
    document.body.classList.toggle("black", on);
    if (broadcast && channel) channel.postMessage({ type: "black", on });
}

// ---------- input ----------
const FORWARD = [ "ArrowRight", "ArrowDown", "PageDown", " ", "Enter" ];
const BACK = [ "ArrowLeft", "ArrowUp", "PageUp", "Backspace" ];
addEventListener("keydown", event => {
    if (event.target.tagName === "BUTTON" && (event.key === " " || event.key === "Enter")) event.preventDefault();
    if (FORWARD.includes(event.key)) {
        if (presenter && !timer.start && !timer.elapsed) toggleTimer();
        show(current + 1);
    }
    else if (BACK.includes(event.key)) show(current - 1);
    else if (event.key === "Home") show(0);
    else if (event.key === "End") show(frames.length - 1);
    else if (event.key === "f" || event.key === "F") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    else if (event.key === "b" || event.key === "B" || event.key === ".") setBlack(!document.body.classList.contains("black"));
    else if (presenter && (event.key === "t" || event.key === "T")) toggleTimer();
    else if (presenter && (event.key === "r" || event.key === "R")) resetTimer();
    else if (DATA.presenter && !presenter && (event.key === "p" || event.key === "P")) window.open(location.pathname + "?presenter#" + (current + 1), "vvc-presenter", "popup,width=1400,height=850");
});
if (channel) channel.onmessage = ({ data }) => {
    if (data.type === "show" && data.index !== current) show(data.index, { broadcast: false });
    if (data.type === "black") setBlack(data.on, false);
    if (data.type === "hello" && presenter) channel.postMessage({ type: "show", index: current });
};

if (presenter) {
    document.body.classList.add("presenter");
    document.title = "Presenter · " + document.title;
    nowSlides = cloneDeck(document.getElementById("now-view"));
    nextSlides = cloneDeck(document.getElementById("next-view"));
    document.getElementById("prev").onclick = () => show(current - 1);
    document.getElementById("next").onclick = () => { if (!timer.start && !timer.elapsed) toggleTimer(); show(current + 1); };
    document.getElementById("toggle").onclick = toggleTimer;
    document.getElementById("reset").onclick = resetTimer;
    document.getElementById("audience").onclick = openAudience;
    setInterval(tick, 250);
    addEventListener("storage", event => { if (event.key === TIMER_KEY) { timer = loadTimer(); tick(); } });
} else {
    stage.addEventListener("click", event => show(current + (event.clientX < innerWidth / 3 ? -1 : 1)));
    let touchStart = null;
    addEventListener("touchstart", event => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
    addEventListener("touchend", event => {
        const distance = event.changedTouches[0].clientX - touchStart;
        if (Math.abs(distance) > 40) show(current + (distance < 0 ? 1 : -1));
    }, { passive: true });
    addEventListener("resize", fitStage);
    fitStage();
}
const fromAddress = () => show((parseInt(location.hash.slice(1), 10) || 1) - 1, { broadcast: false });
addEventListener("hashchange", fromAddress);
fromAddress();
if (channel && !presenter) channel.postMessage({ type: "hello" });
${reloadUrl ? `new EventSource(${JSON.stringify(reloadUrl)}).addEventListener("change", () => location.reload());` : ""}
</script>
</body>
</html>
`;
    // The public page carries no presenter view at all: neither its styles nor its markup.
    return presenter ? page : page.replace(/\n\/\* Presenter view \*\/[\s\S]*?(?=<\/style>)/, "\n").replace(/<div id="presenter">[\s\S]*?\n<\/div>\n(?=<script>)/, "");
}
