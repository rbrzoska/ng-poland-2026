const STEPS = {
    prep: [ [ "generate", "Generate workspace" ], [ "facts", "ng-facts usages" ], [ "baseline", "Baseline ngc" ] ],
    lane: [ [ "refactor", "Refactor" ], [ "ngc", "ngc" ], [ "score", "Diff" ], [ "build", "ng build" ] ]
};

let state = null;
let selectedLane = null;
const logPinned = new Map();

const elements = {
    form: document.getElementById("controls"),
    run: document.getElementById("run"),
    stop: document.getElementById("stop"),
    prepSteps: document.getElementById("prep-steps"),
    prepLog: document.getElementById("prep-log"),
    facts: document.getElementById("facts"),
    lanes: document.getElementById("lanes"),
    tabs: document.getElementById("tabs"),
    frameRef: document.getElementById("frame-ref"),
    frameLane: document.getElementById("frame-lane"),
    refCount: document.getElementById("ref-count"),
    laneCount: document.getElementById("lane-count"),
    laneName: document.getElementById("lane-name"),
    laneDiff: document.getElementById("lane-diff"),
    scoreboard: document.getElementById("scoreboard"),
    restoredBanner: document.getElementById("restored-banner")
};

const format = {
    number: value => value === undefined || value === null ? "—" : Number(value).toLocaleString("en"),
    tokens: value => value === undefined ? "—" : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value),
    cost: value => value === undefined ? "—" : `$${value.toFixed(2)}`,
    ms: ms => ms === undefined ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
};

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]);
}

function chip(label, step) {
    const status = step?.status ?? "pending";
    const detail = step?.detail ? ` · ${escapeHtml(step.detail)}` : "";
    return `<span class="chip ${status}">${label}${detail} <span class="ms">${status === "running" ? "" : format.ms(step?.ms)}</span></span>`;
}

function renderPrep() {
    elements.prepSteps.innerHTML = STEPS.prep.map(([ name, label ]) => chip(label, state.prep.steps[name])).join("");
    const facts = state.prep.facts;
    elements.facts.innerHTML = facts ? `
        <div class="fact"><div class="big">${format.number(facts.uses)}</div><div class="small">real bindings in ${facts.useFiles} files · ${facts.decoys} same-name decoys</div></div>
        <div class="fact win"><div class="big">~${format.number(facts.toolTokens)} tokens</div><div class="small">ng-facts answer · ${facts.ms} ms</div></div>
        <div class="fact lose"><div class="big">~${format.number(facts.grepTokens)} tokens</div><div class="small">grep + read: ${facts.grepFiles}/${facts.files} files, ${format.number(facts.grepLines)} matching lines</div></div>` : "";
}

function verdictOf(lane) {
    const metrics = lane.metrics;
    if (lane.kind === "reference") return lane.steps.build?.status === "ok" ? [ "win", "The right answer, built" ] : [ "", "" ];
    if (metrics.compileErrors) return [ "caught", `Caught by the compiler: ${metrics.compileErrors} errors` ];
    if (metrics.correct === undefined) return [ "", "" ];
    if (metrics.contract === "broken" && !metrics.pillsDiffer) return [ "fool", "Ils sont fous! Compiles and renders the same, but the API now lies" ];
    if (metrics.missed || metrics.wrong) {
        if (metrics.functionallyCorrect === true) return [ "win", `By Toutatis! Functionally correct (formatting differs on ${format.number(metrics.wrong + metrics.missed)} lines)` ];
        const elements = metrics.elementsWrong ? ` · ${format.number(metrics.elementsWrong)} elements differ in the compiler AST` : "";
        return [ "fool", `Ils sont fous! Compiles, but ${format.number(metrics.wrong + metrics.missed)} lines wrong${elements}` ];
    }
    if (metrics.contract === "broken") return [ "fool", "Ils sont fous! The API contract is broken" ];
    return [ "win", metrics.contract === "honoured" ? "By Toutatis! Correct, compiling, contract honoured" : "By Toutatis! Correct and compiling" ];
}

function metricCells(lane) {
    const metrics = lane.metrics;
    const cells = [];
    if (lane.kind === "agent") {
        cells.push([ "Time", metrics.seconds !== undefined ? `${metrics.seconds} s` : "—" ], [ "Turns", format.number(metrics.turns) ], [ "Input tokens", format.tokens(metrics.inputTokens) ], [ "Cost", format.cost(metrics.costUsd) ]);
    } else if (lane.kind !== "reference") {
        cells.push([ "Time", metrics.seconds !== undefined ? `${metrics.seconds} s` : "—" ], [ "Turns", "0" ], [ "Tokens", "0" ], [ "Cost", "$0.00" ]);
    }
    const scored = metrics.correct !== undefined;
    if (lane.kind !== "reference") {
        cells.push(
            [ "Correct", scored ? `${metrics.correct}/${metrics.shouldChange}` : "—", scored && metrics.correct === metrics.shouldChange ? "good" : scored ? "bad" : "" ],
            [ "Missed", scored ? format.number(metrics.missed) : "—", metrics.missed ? "bad" : scored ? "good" : "" ],
            [ "Wrong edits", scored ? format.number(metrics.wrong) : "—", metrics.wrong ? "bad" : scored ? "good" : "" ],
            [ "ngc errors", format.number(metrics.compileErrors), metrics.compileErrors ? "bad" : metrics.compileErrors === 0 ? "good" : "" ]
        );
    } else {
        cells.push([ "Role", "answer key" ], [ "ngc errors", format.number(metrics.compileErrors), metrics.compileErrors === 0 ? "good" : "" ], [ "Edits", "—" ], [ "Tokens", "—" ]);
    }
    return cells.map(([ name, value, tone = "" ]) => `<div class="metric ${tone}"><div class="value">${value}</div><div class="name">${name}</div></div>`).join("");
}

function renderLane(id) {
    const lane = state.lanes[id];
    let card = document.getElementById(`lane-${id}`);
    if (!card) {
        card = document.createElement("article");
        card.id = `lane-${id}`;
        card.className = "lane";
        card.innerHTML = `
            <div class="lane-head"><div><h3></h3><div class="sub"></div></div><span class="badge"></span></div>
            <div class="chips"></div>
            <div class="metrics"></div>
            <div class="spec"></div>
            <div class="log"></div>
            <div class="verdict"></div>`;
        elements.lanes.append(card);
        const log = card.querySelector(".log");
        log.addEventListener("scroll", () => logPinned.set(id, log.scrollTop + log.clientHeight >= log.scrollHeight - 20));
    }
    card.classList.toggle("disabled", !lane.enabled);
    card.querySelector("h3").textContent = lane.title;
    card.querySelector(".sub").textContent = lane.subtitle;
    const badge = card.querySelector(".badge");
    badge.textContent = lane.kind === "agent" ? `agent · ${state.config.model ?? "sonnet"}${state.config.replay ? " · replay" : ""}` : lane.kind;
    badge.className = `badge ${lane.kind}`;
    const steps = lane.kind === "reference" ? STEPS.lane.filter(([ name ]) => name !== "refactor" && name !== "score") : STEPS.lane;
    card.querySelector(".chips").innerHTML = steps.map(([ name, label ]) => chip(label, lane.steps[name])).join("");
    card.querySelector(".metrics").innerHTML = metricCells(lane);
    renderSpec(card.querySelector(".spec"), lane);
    const [ tone, text ] = verdictOf(lane);
    const verdict = card.querySelector(".verdict");
    verdict.className = `verdict ${tone}`;
    verdict.innerHTML = `<span>${escapeHtml(text)}</span>${lane.preview ? `<button type="button" data-open="${id}">Open app</button>` : ""}`;
}

function renderSpec(container, lane) {
    const specText = lane.kind === "agent" ? lane.metrics.specText : undefined;
    if (container.dataset.spec === (specText ?? "")) return;
    container.dataset.spec = specText ?? "";
    container.innerHTML = specText ? `<details><summary>Spec written by the agent (${format.number(lane.metrics.specLines ?? specText.trim().split("\n").length)} lines)</summary><pre>${escapeHtml(specText.trim())}</pre></details>` : "";
}

function appendLog(container, entry, laneId) {
    const line = document.createElement("span");
    line.className = `line ${entry.kind}`;
    line.textContent = entry.text;
    container.append(line, "\n");
    while (container.childNodes.length > 3000) container.firstChild.remove();
    if (logPinned.get(laneId) !== false) container.scrollTop = container.scrollHeight;
}

function laneLog(id) {
    return id ? document.querySelector(`#lane-${id} .log`) : elements.prepLog;
}

function renderTabs() {
    const built = Object.values(state.lanes).filter(lane => lane.preview && lane.kind !== "reference");
    elements.tabs.innerHTML = built.map(lane => `<button type="button" data-tab="${lane.id}" class="${lane.id === selectedLane ? "active" : ""}">${escapeHtml(lane.title)}</button>`).join("");
}

function renderScoreboard() {
    const rows = Object.values(state.lanes).filter(lane => lane.kind !== "reference" && lane.enabled);
    const cell = (value, good) => `<td class="${good === undefined ? "" : good ? "good" : "bad"}">${value}</td>`;
    elements.scoreboard.innerHTML = `
        <thead><tr><th>Lane</th><th>Time</th><th>Turns</th><th>Input tokens</th><th>Output tokens</th><th>Cost</th><th>Correct</th><th>Missed</th><th>Wrong edits</th><th>ngc errors</th><th>Elements wrong (AST)</th><th>Functionally correct</th><th>Pills differing in the built app</th><th>API contract</th></tr></thead>
        <tbody>${rows.map(lane => {
            const metrics = lane.metrics;
            const scored = metrics.correct !== undefined;
            return `<tr><td>${escapeHtml(lane.title)}</td>
                <td>${metrics.seconds !== undefined ? `${metrics.seconds} s` : "—"}</td>
                <td>${lane.kind === "agent" ? format.number(metrics.turns) : "0"}</td>
                <td>${lane.kind === "agent" ? format.tokens(metrics.inputTokens) : "0"}</td>
                <td>${lane.kind === "agent" ? format.tokens(metrics.outputTokens) : "0"}</td>
                <td>${lane.kind === "agent" ? format.cost(metrics.costUsd) : "$0.00"}</td>
                ${cell(scored ? `${metrics.correct}/${metrics.shouldChange}` : "—", scored ? metrics.correct === metrics.shouldChange : undefined)}
                ${cell(scored ? metrics.missed : "—", scored ? !metrics.missed : undefined)}
                ${cell(scored ? metrics.wrong : "—", scored ? !metrics.wrong : undefined)}
                ${cell(format.number(metrics.compileErrors), metrics.compileErrors === undefined ? undefined : metrics.compileErrors === 0)}
                ${cell(metrics.elementsWrong === undefined ? "—" : `${format.number(metrics.elementsWrong)}/${format.number(metrics.elements)}`, metrics.elementsWrong === undefined ? undefined : metrics.elementsWrong === 0)}
                ${cell(metrics.functionallyCorrect === undefined ? "—" : metrics.functionallyCorrect ? "✓" : "✗", metrics.functionallyCorrect)}
                ${cell(metrics.pillsDiffer ?? "—", metrics.pillsDiffer === undefined ? undefined : metrics.pillsDiffer === 0)}
                ${cell(metrics.contract ?? "—", metrics.contract === undefined ? undefined : metrics.contract === "honoured")}</tr>`;
        }).join("")}</tbody>`;
}

function renderAll() {
    renderPrep();
    for (const id of Object.keys(state.lanes)) renderLane(id);
    elements.prepLog.innerHTML = "";
    for (const entry of state.prep.log) appendLog(elements.prepLog, entry, null);
    for (const [ id, lane ] of Object.entries(state.lanes)) {
        const container = laneLog(id);
        container.innerHTML = "";
        for (const entry of lane.log) appendLog(container, entry, id);
    }
    renderTabs();
    renderScoreboard();
    elements.restoredBanner.hidden = !state.restored;
    elements.run.disabled = state.running;
    elements.stop.disabled = !state.running;
}

function waitForApp(frame) {
    return new Promise(resolve => {
        const started = Date.now();
        const poll = () => {
            const document = frame.contentDocument;
            const counter = document?.querySelector("[data-testid=hint-count]");
            const pills = document?.querySelectorAll("app-pill") ?? [];
            const contract = document?.querySelector("[data-testid=contract-card]");
            if (counter && pills.length && /^[0-9]/.test(counter.textContent.trim()) && contract && contract.textContent !== "…" || Date.now() - started > 10000) return resolve(document);
            setTimeout(poll, 150);
        };
        poll();
    });
}

function hintPattern(document) {
    return [ ...(document?.querySelectorAll(".grid app-pill") ?? []) ].map(pill => {
        const span = pill.querySelector(".pill");
        const tone = [ ...(span?.classList ?? []) ].filter(name => name !== "pill").join(".");
        const hint = pill.querySelector(".hint");
        const text = (span?.textContent ?? "").slice(0, (span?.textContent ?? "").length - (hint?.textContent.length ?? 0)).trim();
        return `${hint ? "hint" : "-"}|${tone}|${text}`;
    });
}

const hasHint = signature => signature.startsWith("hint");

function contractOf(document) {
    const pill = document?.querySelector("[data-testid=contract-pill]")?.textContent ?? "";
    const card = document?.querySelector("[data-testid=contract-card]")?.textContent ?? "";
    const broken = [ pill.includes("✗") && "pill", card.includes("✗") && "card" ].filter(Boolean);
    return { contract: broken.length ? "broken" : "honoured", contractDetail: broken.length ? `broken: ${broken.join(", ")}` : "honoured" };
}

let referencePattern = null;

function inspect(url) {
    return new Promise(resolve => {
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:absolute;width:1200px;height:800px;left:-5000px;top:0;";
        frame.addEventListener("load", () => waitForApp(frame).then(doc => {
            const result = { pattern: hintPattern(doc), ...contractOf(doc) };
            frame.remove();
            resolve(result);
        }), { once: true });
        frame.src = `${url}?inspect=${Date.now()}`;
        document.body.append(frame);
    });
}

async function inspectLane(id) {
    const lane = state.lanes[id];
    if (!lane.preview || !referencePattern) return;
    const result = await inspect(lane.preview);
    const differ = result.pattern.reduce((sum, hint, index) => sum + (hint !== referencePattern[index] ? 1 : 0), 0) + Math.abs(result.pattern.length - referencePattern.length);
    lane.metrics = { ...lane.metrics, pillsDiffer: differ, contract: result.contract, contractDetail: result.contractDetail };
    renderLane(id);
    renderScoreboard();
}

async function onPreview(id) {
    if (id === "expected") {
        referencePattern = (await inspect(state.lanes.expected.preview)).pattern;
        for (const lane of Object.values(state.lanes)) if (lane.kind !== "reference" && lane.preview) await inspectLane(lane.id);
    } else {
        await inspectLane(id);
    }
}

async function showCompare(id) {
    selectedLane = id;
    renderTabs();
    const lane = state.lanes[id];
    elements.laneName.textContent = lane.title;
    elements.laneDiff.textContent = "loading…";
    elements.laneDiff.className = "diff";
    const reference = state.lanes.expected;
    if (reference.preview && elements.frameRef.dataset.src !== reference.preview) {
        elements.frameRef.dataset.src = reference.preview;
        elements.frameRef.src = reference.preview;
    }
    elements.frameLane.src = `${lane.preview}?t=${Date.now()}`;
    const [ referenceDocument, laneDocument ] = await Promise.all([ waitForApp(elements.frameRef), new Promise(resolve => elements.frameLane.addEventListener("load", () => waitForApp(elements.frameLane).then(resolve), { once: true })) ]);
    const expected = hintPattern(referenceDocument);
    const actual = hintPattern(laneDocument);
    const contract = contractOf(laneDocument);
    elements.refCount.textContent = `${expected.filter(hasHint).length} of ${expected.length} pills with a tooltip · contract ${contractOf(referenceDocument).contractDetail}`;
    elements.laneCount.textContent = `${actual.filter(hasHint).length} of ${actual.length} pills with a tooltip · contract ${contract.contractDetail}`;
    const pills = [ ...laneDocument.querySelectorAll(".grid app-pill") ];
    let differ = 0;
    pills.forEach((pill, index) => {
        const mismatch = actual[index] !== expected[index];
        if (mismatch) differ++;
        pill.style.outline = mismatch ? "3px solid #e53935" : "";
        pill.style.borderRadius = mismatch ? "999px" : "";
    });
    for (const box of laneDocument.querySelectorAll(".contract")) box.style.outline = box.querySelector("b")?.textContent.includes("✗") ? "3px solid #e53935" : "";
    const broken = contract.contract === "broken";
    elements.laneDiff.textContent = differ ? `${differ} pills differ from the reference (text, tone or tooltip)${broken ? " · API contract broken" : ""}` : broken ? "renders the same — but the API contract is broken" : "identical to the reference";
    elements.laneDiff.className = `diff ${differ || broken ? "differs" : "same"}`;
    lane.metrics = { ...lane.metrics, pillsDiffer: differ, ...contract };
    renderLane(id);
    renderScoreboard();
}

document.addEventListener("click", event => {
    const open = event.target.closest("[data-open]")?.dataset.open;
    const tab = event.target.closest("[data-tab]")?.dataset.tab;
    if (open || tab) {
        showCompare(open ?? tab);
        if (open) document.getElementById("compare").scrollIntoView({ behavior: "smooth" });
    }
});

elements.form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(elements.form);
    elements.run.disabled = true;
    await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ features: data.get("features"), model: data.get("model"), budget: data.get("budget"), agents: data.get("agents") === "on", replay: data.get("replay") === "on" }) });
});

elements.stop.addEventListener("click", () => fetch("/api/stop", { method: "POST" }));
document.getElementById("reset").addEventListener("click", () => fetch("/api/reset", { method: "POST" }));

const events = new EventSource("/events");
events.onmessage = message => {
    const event = JSON.parse(message.data);
    if (event.type === "state") {
        state = event.state;
        selectedLane = null;
        referencePattern = null;
        elements.lanes.innerHTML = "";
        logPinned.clear();
        elements.frameRef.removeAttribute("src");
        delete elements.frameRef.dataset.src;
        elements.frameLane.removeAttribute("src");
        renderAll();
        return;
    }
    if (!state) return;
    if (event.type === "log") {
        (event.lane ? state.lanes[event.lane].log : state.prep.log).push(event.entry);
        appendLog(laneLog(event.lane), event.entry, event.lane);
    }
    if (event.type === "step") {
        (event.lane ? state.lanes[event.lane].steps : state.prep.steps)[event.name] = event.step;
        event.lane ? renderLane(event.lane) : renderPrep();
    }
    if (event.type === "metrics") {
        state.lanes[event.lane].metrics = { ...state.lanes[event.lane].metrics, ...event.metrics };
        renderLane(event.lane);
        renderScoreboard();
    }
    if (event.type === "facts") {
        state.prep.facts = event.facts;
        renderPrep();
    }
    if (event.type === "preview") {
        state.lanes[event.lane].preview = event.url;
        renderLane(event.lane);
        renderTabs();
        onPreview(event.lane);
        const firstBuilt = Object.values(state.lanes).find(lane => lane.preview && lane.kind !== "reference");
        if (!selectedLane && firstBuilt && state.lanes.expected.preview) showCompare(firstBuilt.id);
    }
    if (event.type === "done") {
        state.running = false;
        elements.run.disabled = false;
        elements.stop.disabled = true;
    }
};

function renderCode(target, text, other, kind) {
    const lines = text.replace(/\n$/, "").split("\n");
    const otherSet = new Set(other?.replace(/\n$/, "").split("\n") ?? []);
    target.innerHTML = lines.map((line, index) => {
        const changed = other !== undefined && !otherSet.has(line);
        return `<span class="row ${changed ? kind : ""}"><span class="no">${index + 1}</span>${escapeHtml(line)}</span>`;
    }).join("");
}

async function loadBriefingCode() {
    const response = await fetch("/api/source");
    if (!response.ok) return;
    const source = await response.json();
    if (!source.template.before) return;
    renderCode(document.getElementById("code-template-before"), source.template.before, source.template.after, "removed");
    renderCode(document.getElementById("code-template-after"), source.template.after, source.template.before, "added");
    renderCode(document.getElementById("code-feature-before"), source.feature.before, source.feature.after, "removed");
    renderCode(document.getElementById("code-feature-after"), source.feature.after, source.feature.before, "added");
    renderCode(document.getElementById("code-pill"), source.pill);
    renderCode(document.getElementById("code-spec"), source.spec);
    for (const element of document.querySelectorAll("[data-stat]")) element.textContent = source.stats[element.dataset.stat];
}

document.querySelector(".briefing-tabs").addEventListener("click", event => {
    const tab = event.target.closest("[data-brief]");
    if (!tab) return;
    for (const button of document.querySelectorAll("[data-brief]")) button.classList.toggle("active", button === tab);
    for (const panel of document.querySelectorAll(".brief-panel")) panel.classList.toggle("active", panel.dataset.panel === tab.dataset.brief);
    if (tab.dataset.brief === "code") loadBriefingCode();
});

loadBriefingCode();
