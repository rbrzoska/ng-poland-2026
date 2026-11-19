// Rebuilds the slides that carry measured numbers from the recorded runs: node deck/evidence-slides.mjs
// Every number is a min–max range over the runs of a lane (bench/evidence.mjs); rerun after recording more runs.
// It overwrites typist, spec, race, otherjobs, method, scaling and steelman in deck/project/slides — edit their wording here.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { collect } from "../bench/evidence.mjs";

const SLIDES = path.join(import.meta.dirname, "project/slides");
const E = collect();

const LOGO = `<img src="/_blob/756f2525b48eaa36095d0a128c642db9" alt="NG Poland" style="position:absolute;right:16px;bottom:16px;width:100px;height:84px;object-fit:contain">`;
const BANGERS = "font-family:Bangers, 'Trebuchet MS', sans-serif";
const MONO = "font-family:'JetBrains Mono', 'Courier New', monospace";
const GRADIENT_TEXT = "background:linear-gradient(120deg, #F230BF, #C41633);background-clip:text;-webkit-text-fill-color:transparent;color:#F230BF";
const OBELIX = `<span style="color:#C41633"><b>Obelix</b></span>`;
const ASTERIX = `<span style="color:#F230BF"><b>Asterix</b></span>`;
const OBELIX_DARK = `<span style="color:#FF6FA5"><b>Obelix</b></span>`;
const eyebrow = text => `<p style="font-size:28px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#F230BF">${text}</p>`;
const heading = (text, size = 84, extra = "") => `<h2 style="${BANGERS};font-size:${size}px;font-weight:400;line-height:1.04;letter-spacing:1px;${extra}">${text}</h2>`;

const numbers = values => values.filter(value => typeof value === "number" && Number.isFinite(value));
function span(values, format) {
    const list = numbers(values);
    if (!list.length) return "—";
    const low = format(Math.min(...list));
    const high = format(Math.max(...list));
    return low === high ? low : `${low}–${high}`;
}
const plain = value => String(Math.round(value));
const cents = values => (numbers(values).some(value => value < 0.02) ? value => value.toFixed(3) : value => value.toFixed(2));
const usd = values => `$${span(values, cents(values))}`;
const tokens = values => {
    const list = numbers(values);
    if (!list.length) return "—";
    if (Math.max(...list) >= 1e6) return `${span(list, value => (value / 1e6).toFixed(1))} M`;
    return `${span(list, value => (value / 1000).toFixed(Math.max(...list) < 10000 ? 1 : 0))} k`;
};
const seconds = values => `${span(values, plain)} s`;
const times = values => `${span(values, value => value.toFixed(1))}×`;
const median = values => {
    const sorted = [ ...numbers(values) ].sort((left, right) => left - right);
    return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

/** The runs of one lane, split into the bulk and the ones that cost more than twice the lane's median. */
function lane(series, arm) {
    const data = E[series]?.arms[arm];
    const runs = data?.runs ?? [];
    const typical = median(runs.map(run => run.costUsd));
    const derailed = runs.filter(run => run.costUsd > 2 * typical);
    const bulk = runs.filter(run => !derailed.includes(run));
    const cell = (metric, format) => (derailed.length ? `${format(bulk.map(run => run[metric]))} · ${derailed.length === 1 ? "once" : `${derailed.length} times`} ${format(derailed.map(run => run[metric]))}` : format(runs.map(run => run[metric])));
    return { runs, bulk, derailed, correct: `${data?.correctRuns ?? 0} of ${runs.length}`, cell, of: metric => runs.map(run => run[metric]), bulkOf: metric => bulk.map(run => run[metric]) };
}

const allRuns = Object.values(E).flatMap(series => Object.values(series.arms).flatMap(arm => arm.runs));
const hungRuns = allRuns.filter(run => typeof run.modelSeconds === "number" && run.seconds - run.modelSeconds >= 100);
const pairStats = series => {
    const ratios = E[series].ratios("costUsd");
    const cheaper = ratios.filter(ratio => ratio > 1);
    return { pairs: ratios.length, cheaper: cheaper.length, cheaperBy: times(cheaper), all: times(ratios) };
};

const obelix = lane("baseline", "no-tool");
const asterix = lane("baseline", "tool");
const baselinePairs = pairStats("baseline");

const cellStyle = "padding:12px 18px";
const row = (cells, background, bold = false) => `<tr style="background:${background}">${cells.map((cell, index) => `<td style="${cellStyle};${index ? "text-align:right;white-space:nowrap" : ""}${bold ? ";font-weight:700" : ""}">${cell}</td>`).join("")}</tr>`;
const headerRow = (cells, widths) => `<tr style="background:#EEF0F5">${cells.map((cell, index) => `<th style="width:${widths[index]}%;text-align:${index ? "right" : "left"};${cellStyle}">${cell}</th>`).join("")}</tr>`;
const table = (rows, size = 26) => `<table style="font-size:${size}px;color:#1F2533;border:1px solid #E3E0EC;font-variant-numeric:tabular-nums">\n${rows.join("\n")}\n</table>`;
const good = text => `<span style="color:#1B7F4A">${text}</span>`;
const bad = text => `<span style="color:#C41633">${text}</span>`;
const verdict = (correctRuns, total) => (correctRuns === total ? good(`${correctRuns} of ${total}`) : bad(`${correctRuns} of ${total}`));
const laneVerdict = (series, arm) => verdict(E[series].arms[arm]?.correctRuns ?? 0, E[series].arms[arm]?.runs.length ?? 0);

const slides = {};

slides.typist = `<section id="typist" data-transition="fade" style="background:#170621;color:#F6F4FA;font-family:Roboto, Arial, sans-serif;padding:128px;display:flex;flex-direction:column;gap:40px">
${LOGO}
${eyebrow("Two ways to visit a million Roman camps")}
${heading("Send Obelix, or send Asterix with the potion?", 92, "width:1500px;color:#FFFFFF")}
<div style="display:flex;gap:32px">
<div style="flex:1;display:flex;flex-direction:column;gap:16px;background:#24102F;padding:40px 44px;border:1px solid #3A1F4A;border-top:6px solid #C41633;border-radius:20px">
<h3 style="${BANGERS};font-size:40px;font-weight:400;color:#FF6FA5">Obelix · the agent with files + grep</h3>
<ul style="font-size:30px;line-height:1.4;color:#C7C9DD">
<li>greps for the pills, then improvises a regex script, a new one every time</li>
<li>bangs it against the compiler until it stops complaining: ${span(obelix.of("turns"), plain)} turns</li>
<li>reads ${tokens(obelix.of("inputTokens"))} tokens on the way</li>
<li>gets there: correct in ${obelix.correct} runs</li>
</ul>
</div>
<div style="flex:1;display:flex;flex-direction:column;gap:16px;background:#24102F;padding:40px 44px;border:1px solid #3A1F4A;border-top:6px solid #A127F2;border-radius:20px">
<h3 style="${BANGERS};font-size:40px;font-weight:400;color:#C98BFF">Asterix · the agent with ng-facts</h3>
<ul style="font-size:30px;line-height:1.4;color:#C7C9DD">
<li>thinks first: reads the v2 API, once</li>
<li>describes the change in four lines</li>
<li>drinks the potion: the compiler applies 2 680 edits in 0.1–0.2 s</li>
<li>${span(asterix.bulkOf("turns"), plain)} turns, ${tokens(asterix.bulkOf("inputTokens"))} tokens${asterix.derailed.length ? ", unless he trips" : ""}; correct in ${asterix.correct}</li>
</ul>
</div>
</div>
<p style="font-size:32px;line-height:1.4;color:#C7C9DD">Both use the compiler. ${OBELIX_DARK} as the referee after the fight. Asterix as the map before it.</p>
<aside>Be fair to Obelix: in the recordings he never types the edits by hand, he writes a sed or perl script and iterates on the ngc errors, and he ends correct every time. What differs is how much context he burns getting there. Numbers are min–max over ${obelix.runs.length} runs per lane.</aside>
</section>
`;

slides.spec = `<section id="spec" data-transition="fade" style="background:#FFFFFF;color:#1F2533;font-family:Roboto, Arial, sans-serif;padding:128px;display:flex;flex-direction:column;gap:36px">
${LOGO}
${eyebrow("Asterix’s whole output")}
${heading("One small spec. That was the job.", 88)}
<div style="display:flex;gap:40px">
<div style="width:1104px;background:#170621;padding:36px 40px;border-radius:20px">
<p style="${MONO};font-size:20px;line-height:1.55;color:#F6F4FA;white-space:nowrap">{<br>&#160;&#160;"component": "PillComponent",<br>&#160;&#160;"inputs": {<br>&#160;&#160;&#160;&#160;"disableTooltip": { "rename": "tooltip", "negate": true },<br>&#160;&#160;&#160;&#160;"variant": {<br>&#160;&#160;&#160;&#160;&#160;&#160;"rename": "tone",<br>&#160;&#160;&#160;&#160;&#160;&#160;"values": { "info": "neutral", "success": "positive", "warning": "caution" },<br>&#160;&#160;&#160;&#160;&#160;&#160;"otherwise": { "pipe": "pillTone", "import": "PillTonePipe",<br>&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;&#160;"from": "src/app/lib/pill-tone.pipe" }<br>&#160;&#160;&#160;&#160;},<br>&#160;&#160;&#160;&#160;"label": { "toContent": true }<br>&#160;&#160;}<br>}</p>
</div>
<div style="width:520px;display:flex;flex-direction:column;gap:20px">
<div style="display:flex;flex-direction:column;gap:4px;background:#F6F4FA;padding:24px 28px;border:1px solid #E3E0EC;border-radius:16px">
<p style="${BANGERS};font-size:72px;font-weight:400;line-height:1;${GRADIENT_TEXT}">2 680</p>
<p style="font-size:26px;color:#40485A">edits in 170 files, 80 components get a new import</p>
</div>
<div style="display:flex;flex-direction:column;gap:4px;background:#F6F4FA;padding:24px 28px;border:1px solid #E3E0EC;border-radius:16px">
<p style="${BANGERS};font-size:72px;font-weight:400;line-height:1;${GRADIENT_TEXT}">0.1–0.2 s</p>
<p style="font-size:26px;color:#40485A">for the compiler to apply it, 0 decisions left</p>
</div>
<div style="display:flex;flex-direction:column;gap:4px;background:#F6F4FA;padding:24px 28px;border:1px solid #E3E0EC;border-radius:16px">
<p style="${BANGERS};font-size:72px;font-weight:400;line-height:1;${GRADIENT_TEXT}">${tokens(asterix.bulkOf("outputTokens"))}</p>
<p style="font-size:26px;color:#40485A">output tokens for the whole task; Obelix writes ${tokens(obelix.of("outputTokens"))}</p>
</div>
</div>
</div>
<aside>Shown pretty-printed; the agent writes it as four lines. In the main race the task text gives the mapping, so the spec is close to a transcription. When the mapping is withheld and the agent gets only the v1 source, it still writes the same spec: ${E.discover.arms.tool?.correctRuns ?? 0} of ${E.discover.arms.tool?.runs.length ?? 0} runs correct, see the backup slides.</aside>
</section>
`;

const haikuObelix = lane("haiku", "no-tool");
const haikuAsterix = lane("haiku", "tool");
const v2 = lane("tool-v2", "tool-v2");
const hung = data => data.runs.filter(run => typeof run.modelSeconds === "number" && run.seconds - run.modelSeconds >= 100).length;
const raceColumns = [ "Lane", "Correct runs", "Cost", "Tokens sent", "Turns", "Model time" ];
slides.race = `<section id="race" data-transition="fade" style="background:#F6F4FA;color:#1F2533;font-family:Roboto, Arial, sans-serif;padding:112px 128px 128px;display:flex;flex-direction:column;gap:28px">
${LOGO}
${eyebrow(`The race · same task, same prompt, ${obelix.runs.length} runs per lane`)}
${heading(`Same answer. <span style="color:#A127F2">Usually a third of the bill.</span>`, 84, "width:1500px")}
${table([
        headerRow(raceColumns, [ 27, 11, 19, 19, 11, 13 ]),
        row([ "Scripts alone: find &amp; replace, regex", bad("0 of 2"), "$0", "—", "—", "—" ], "#FFFFFF"),
        row([ "The potion alone, spec given", good("execution only"), "$0", "—", "—", "0.1–0.2 s" ], "#F9F7FC"),
        row([ `${OBELIX} · Sonnet, files + grep`, laneVerdict("baseline", "no-tool"), obelix.cell("costUsd", usd), obelix.cell("inputTokens", tokens), obelix.cell("turns", values => span(values, plain)), obelix.cell("modelSeconds", seconds) ], "#FFFFFF"),
        row([ `${ASTERIX} · Sonnet, ng-facts`, laneVerdict("baseline", "tool"), asterix.cell("costUsd", usd), asterix.cell("inputTokens", tokens), asterix.cell("turns", values => span(values, plain)), asterix.cell("modelSeconds", seconds) ], "#F3E6FB", true),
        row([ `${ASTERIX} · Sonnet, ng-facts improved from the recordings`, laneVerdict("tool-v2", "tool-v2"), v2.cell("costUsd", usd), v2.cell("inputTokens", tokens), v2.cell("turns", values => span(values, plain)), v2.cell("modelSeconds", seconds) ], "#F3E6FB", true),
        row([ `${OBELIX} · Haiku, files + grep`, laneVerdict("haiku", "no-tool"), haikuObelix.cell("costUsd", usd), haikuObelix.cell("inputTokens", tokens), haikuObelix.cell("turns", values => span(values, plain)), haikuObelix.cell("modelSeconds", seconds) ], "#FFFFFF"),
        row([ `${ASTERIX} · Haiku, ng-facts`, laneVerdict("haiku", "tool"), haikuAsterix.cell("costUsd", usd), haikuAsterix.cell("inputTokens", tokens), haikuAsterix.cell("turns", values => span(values, plain)), haikuAsterix.cell("modelSeconds", seconds) ], "#F3E6FB", true)
    ], 24)}
<p style="font-size:25px;line-height:1.4;color:#40485A;width:1560px">Every cell is the lowest and the highest run, nothing is averaged. On Sonnet ${ASTERIX} was cheaper in ${baselinePairs.cheaper} of ${baselinePairs.pairs} pairs, by ${baselinePairs.cheaperBy}.${asterix.derailed.length ? ` In the other he tripped over a stray shell command of his own, ran the migration twice at once and rebuilt the damage by hand: correct in the end, at ${usd(asterix.derailed.map(run => run.costUsd))}.` : ""} Wall clock is left out on purpose: in ${hungRuns.length} of ${allRuns.length} recorded runs, in both lanes, an agent sat 2–12 minutes on a command of its own.</p>
<aside>Lead with cost and context, not speed. “Correct” means 0 ngc errors and 0 elements differing from the answer key in the compiler’s AST. The two script lanes end with 220 and 700 compiler errors. The Haiku rows are three runs each: the small model with the potion is right every time for about half a cent, without it it is wrong more often than not. Say “lowest to highest of N runs” out loud.</aside>
</section>
`;

const jobRow = (label, series, arm, quality, highlight = false) => {
    const data = lane(series, arm);
    if (!data.runs.length) return row([ label, "not measured yet", "", "", "", "" ], "#FFFFFF");
    return row([ label, `${laneVerdict(series, arm)} · ${quality(data)}`, usd(data.of("costUsd")), tokens(data.of("inputTokens")), span(data.of("turns"), plain), seconds(data.of("modelSeconds")) ], highlight ? "#F3E6FB" : "#FFFFFF", highlight);
};
const answersRight = questions => data => `${span(data.of("correctAnswers"), plain)} of ${questions} answers`;
const sweepQuality = data => `${span(data.of("stillMissing"), plain)} left unlabelled`;
const blastGrep = lane("atlas-blast", "no-tool");
const blastV2 = lane("atlas-blast", "tool-v2");
const cheaperRange = (expensive, cheap) => (expensive.length && cheap.length ? `${(Math.min(...expensive) / Math.max(...cheap)).toFixed(0)} to ${(Math.max(...expensive) / Math.min(...cheap)).toFixed(0)} times` : "—");
slides.otherjobs = `<section id="otherjobs" data-transition="fade" style="background:#FFFFFF;color:#1F2533;font-family:Roboto, Arial, sans-serif;padding:104px 128px 128px;display:flex;flex-direction:column;gap:24px">
${LOGO}
${eyebrow("Not only migrations · three other everyday jobs, five runs per lane")}
${heading(`A win, a lesson and a draw`, 80, "width:1560px")}
${table([
        headerRow([ "Job and lane", "Runs fully right", "Cost", "Tokens sent", "Turns", "Model time" ], [ 44, 22, 9, 10, 6, 9 ]),
        `<tr style="background:#EEF0F5"><td style="${cellStyle};font-weight:700" >1 · Six questions before a change: how is this component used?</td><td></td><td></td><td></td><td></td><td></td></tr>`,
        jobRow(`${OBELIX} · files + grep`, "facts", "no-tool", answersRight(6)),
        jobRow(`${ASTERIX} · compiler facts`, "facts", "tool", answersRight(6), true),
        `<tr style="background:#EEF0F5"><td style="${cellStyle};font-weight:700">2 · Blast radius: which of 82 routes can show this component?</td><td></td><td></td><td></td><td></td><td></td></tr>`,
        jobRow(`${OBELIX} · files + grep`, "atlas-blast", "no-tool", answersRight(4)),
        jobRow(`${ASTERIX} · tool lists direct uses only`, "atlas-blast", "tool", answersRight(4)),
        jobRow(`${ASTERIX} · tool answers the whole question`, "atlas-blast", "tool-v2", answersRight(4), true),
        `<tr style="background:#EEF0F5"><td style="${cellStyle};font-weight:700">3 · Label 75 icon buttons that have no accessible name</td><td></td><td></td><td></td><td></td><td></td></tr>`,
        jobRow(`${OBELIX} · files + grep`, "atlas-a11y", "no-tool", sweepQuality),
        jobRow(`${ASTERIX} · compiler facts`, "atlas-a11y", "tool", sweepQuality)
    ], 23)}
<p style="font-size:24px;line-height:1.4;color:#40485A;width:1600px"><b>Win:</b> nothing shouts when a count is off, and grep miscounts. <b>Lesson:</b> a tool that only lists direct uses leaves the agent to assemble the answer and buys nothing; once the compiler answers the whole question the bill is ${cheaperRange(numbers(blastGrep.of("costUsd")), numbers(blastV2.of("costUsd")))} lower. <b>Draw:</b> ${OBELIX} scripts the labels too. Jobs 2 and 3 run on a different app, a routed admin of 105 components.</p>
<aside>This is the slide for “is it only good for refactoring?”. Job 1: the grep agent misses string literals inside ternaries (60 instead of 100). Job 2 is the honest one: our first tool was written for the migration and did not help here; we added one command that walks “who renders whom” up to the routes, and then it did. Job 3: both lanes turn “icon → label” into a rule, so there is nothing for the compiler to add; say so.</aside>
</section>
`;

const scaleRow = (label, series) => {
    const grep = lane(series, "no-tool");
    const tool = lane(series, "tool");
    const ratios = pairStats(series);
    return row([ label, `${grep.runs.length}`, usd(grep.of("costUsd")), usd(tool.of("costUsd")), ratios.all, tokens(grep.of("inputTokens")), tokens(tool.of("inputTokens")) ], label.startsWith("120") ? "#F3E6FB" : "#FFFFFF");
};
slides.scaling = `<section id="scaling" data-transition="fade" style="background:#F6F4FA;color:#1F2533;font-family:Roboto, Arial, sans-serif;padding:112px 128px 128px;display:flex;flex-direction:column;gap:32px">
${LOGO}
${eyebrow("Backup · does the bill grow with the codebase?")}
${heading("Sixteen times the code. The same bill, for both.", 84, "width:1560px")}
${table([
        headerRow([ "Components to migrate", "Runs", `Obelix cost`, `Asterix cost`, "Obelix ÷ Asterix", "Obelix context", "Asterix context" ], [ 22, 8, 14, 14, 16, 13, 13 ]),
        scaleRow("30 components · 110 pills", "scale-30"),
        scaleRow("120 components · 440 pills", "baseline"),
        scaleRow("480 components · 1 760 pills", "scale-480")
    ], 27)}
<p style="font-size:28px;line-height:1.4;color:#40485A;width:1560px">We expected ${OBELIX}’s bill to grow with the repository. It does not: he writes a script, and a script does not care how many files it runs over. What the potion buys is a lower and steadier bill at every size, not a different growth curve.</p>
<aside>This slide retires a claim we started with (“the agent types every edit, so output grows with the codebase”). Ratios are per pair, lowest to highest; a ratio below 1.5 is a run where the tool agent lost minutes to its own stray command.</aside>
</section>
`;

const own = lane("own-codemod", "own-codemod");
const discoverGrep = lane("discover", "no-tool");
const discoverTool = lane("discover", "tool");
slides.steelman = `<section id="steelman" data-transition="fade" style="background:#FFFFFF;color:#1F2533;font-family:Roboto, Arial, sans-serif;padding:112px 128px 128px;display:flex;flex-direction:column;gap:28px">
${LOGO}
${eyebrow("Backup · the fair objections, measured")}
${heading("What if Obelix gets smarter, or Asterix gets less help?", 76, "width:1600px")}
${table([
        headerRow([ "Variant, 120 components", "Correct runs", "Cost", "Tokens sent", "Turns", "Model time" ], [ 40, 12, 14, 14, 8, 12 ]),
        row([ "No tool, but told the compiler is in node_modules: “write your own codemod”", laneVerdict("own-codemod", "own-codemod"), usd(own.of("costUsd")), tokens(own.of("inputTokens")), span(own.of("turns"), plain), seconds(own.of("modelSeconds")) ], "#FFFFFF"),
        row([ `Mapping withheld, only the v1 source given · ${OBELIX}`, laneVerdict("discover", "no-tool"), usd(discoverGrep.of("costUsd")), tokens(discoverGrep.of("inputTokens")), span(discoverGrep.of("turns"), plain), seconds(discoverGrep.of("modelSeconds")) ], "#F9F7FC"),
        row([ `Mapping withheld, only the v1 source given · ${ASTERIX}`, laneVerdict("discover", "tool"), discoverTool.cell("costUsd", usd), discoverTool.cell("inputTokens", tokens), discoverTool.cell("turns", values => span(values, plain)), discoverTool.cell("modelSeconds", seconds) ], "#F3E6FB", true),
        row([ `For reference · ${ASTERIX}, mapping given`, laneVerdict("baseline", "tool"), asterix.cell("costUsd", usd), asterix.cell("inputTokens", tokens), asterix.cell("turns", values => span(values, plain)), asterix.cell("modelSeconds", seconds) ], "#FFFFFF")
    ], 25)}
<p style="font-size:26px;line-height:1.4;color:#40485A;width:1560px">Knowing the compiler is there is not the same as having a tool built on it: writing the codemod on the spot cost as much as the regex route and left wrong elements in one run of three. And the agent really does decide: with the mapping withheld it derived the same spec from the old source every time.</p>
<aside>Own codemod: the agent wrote ${tokens(own.of("outputTokens"))} output tokens of script each time. This lane is also the closest thing we have to “what does the tool cost to build”: roughly one grep-style run, every time, instead of once.</aside>
</section>
`;

const sonnetId = E.baseline.modelIds.join(", ") || "claude-sonnet";
const haikuId = E.haiku.modelIds.join(", ") || "claude-haiku";
const cliVersions = [ ...new Set(allRuns.map(run => run.cliVersion).filter(Boolean)) ].join(", ");
slides.method = `<section id="method" data-transition="fade" style="background:#170621;color:#F6F4FA;font-family:Roboto, Arial, sans-serif;padding:112px 128px 128px;display:flex;flex-direction:column;gap:32px">
${LOGO}
${eyebrow("Backup · how it was measured, and what it does not show")}
${heading("Read the small print before you quote us", 84, "width:1560px;color:#FFFFFF")}
<div style="display:flex;gap:32px">
<div style="flex:1;display:flex;flex-direction:column;gap:14px;background:#24102F;padding:36px 40px;border:1px solid #3A1F4A;border-top:6px solid #A127F2;border-radius:20px">
<h3 style="${BANGERS};font-size:40px;font-weight:400;color:#C98BFF">How</h3>
<ul style="font-size:26px;line-height:1.4;color:#C7C9DD">
<li>Claude Code headless${cliVersions ? ` ${cliVersions}` : ""}, ${sonnetId} and ${haikuId}, ${allRuns.length} agent runs in all</li>
<li>same task text for both lanes; the tool lane gets one extra paragraph and no spec</li>
<li>lanes run one after another; every run is recorded and replayable</li>
<li>referees: ngc with strict templates, then the compiler’s AST compared with an answer key the generator builds on its own</li>
<li>every number is lowest–highest of the runs; nothing is averaged</li>
</ul>
</div>
<div style="flex:1;display:flex;flex-direction:column;gap:14px;background:#24102F;padding:36px 40px;border:1px solid #3A1F4A;border-top:6px solid #C41633;border-radius:20px">
<h3 style="${BANGERS};font-size:40px;font-weight:400;color:#FF6FA5">What it does not show</h3>
<ul style="font-size:26px;line-height:1.4;color:#C7C9DD">
<li>the repos are synthetic and written by the tool’s author; no real codebase yet</li>
<li>one agent harness; three to eight runs per lane</li>
<li>the migration spec format covers exactly this kind of change</li>
<li>writing the tool is not on the bill; it rests on @angular/compiler, which is private API</li>
<li>agents trip: ${hungRuns.length} of ${allRuns.length} runs lost minutes to a command of their own, in both lanes</li>
</ul>
</div>
</div>
<aside>If someone asks “did you cherry-pick?”: every run is in results/, the tables come from bench/evidence.mjs, and the one run where the tool agent cost more than the grep agent is on the race slide.</aside>
</section>
`;

const stageRow = (name, series, arm, data, highlight) => `<tr style="background:${highlight ? "#F3E6FB" : "#FFFFFF"}"><td style="padding:22px 26px${highlight ? ";font-weight:700" : ""}">${name}</td><td style="padding:22px 26px;text-align:right;white-space:nowrap${highlight ? ";font-weight:700" : ""}">${laneVerdict(series, arm)}</td><td style="padding:22px 26px;text-align:right;white-space:nowrap${highlight ? ";font-weight:700" : ""}">${data.cell("costUsd", usd)}</td><td style="padding:22px 26px;text-align:right;white-space:nowrap${highlight ? ";font-weight:700" : ""}">${data.cell("inputTokens", tokens)}</td></tr>`;
slides["race-stage"] = `<section id="race-stage" data-transition="fade" style="background:#F6F4FA;color:#1F2533;font-family:Roboto, Arial, sans-serif;padding:112px 128px 128px;display:flex;flex-direction:column;gap:36px">
${LOGO}
${eyebrow(`The race · same task, same prompt, ${obelix.runs.length} runs each`)}
${heading(`Same answer. <span style="color:#A127F2">Usually a third of the bill.</span>`, 96, "width:1560px")}
<table style="font-size:34px;color:#1F2533;border:1px solid #E3E0EC;font-variant-numeric:tabular-nums">
<tr style="background:#EEF0F5"><th style="width:46%;text-align:left;padding:18px 26px">Who</th><th style="width:16%;text-align:right;padding:18px 26px">Correct runs</th><th style="width:20%;text-align:right;padding:18px 26px">Cost</th><th style="width:18%;text-align:right;padding:18px 26px">Tokens sent</th></tr>
${stageRow(`${OBELIX} · files + grep`, "baseline", "no-tool", obelix, false)}
${stageRow(`${ASTERIX} · the compiler`, "baseline", "tool", asterix, true)}
${stageRow(`${OBELIX} on a small, cheap model`, "haiku", "no-tool", haikuObelix, false)}
${stageRow(`${ASTERIX} on a small, cheap model`, "haiku", "tool", haikuAsterix, true)}
</table>
<p style="font-size:28px;line-height:1.4;color:#40485A;width:1560px">Lowest to highest of the runs, nothing averaged. The full table, the method and the small print are in the backup slides.</p>
<aside>Stage version of the race: four rows. The full table with scripts, turns and model time is the backup slide “race”.</aside>
</section>
`;

const factsGrep = lane("facts", "no-tool");
const factsTool = lane("facts", "tool");
const factCard = (who, verdictHtml, cost, border) => `<div style="flex:1;display:flex;flex-direction:column;gap:10px;background:#F6F4FA;padding:36px 44px;border:1px solid #E3E0EC;border-top:8px solid ${border};border-radius:20px">
<h3 style="${BANGERS};font-size:44px;font-weight:400;color:#1F2533">${who}</h3>
<p style="${BANGERS};font-size:112px;font-weight:400;line-height:1">${verdictHtml}</p>
<p style="font-size:32px;line-height:1.35;color:#40485A">runs with all six answers right · ${cost} a run</p>
</div>`;
slides["questions-stage"] = `<section id="questions-stage" data-transition="fade" style="background:#FFFFFF;color:#1F2533;font-family:Roboto, Arial, sans-serif;padding:112px 128px 128px;display:flex;flex-direction:column;gap:36px">
${LOGO}
${eyebrow(`Not only migrations · six questions about the code, ${factsGrep.runs.length} runs each`)}
${heading(`Ask the potion a question. <span style="color:#A127F2">It does not guess.</span>`, 92, "width:1560px")}
<div style="display:flex;gap:32px">
${factCard(`${OBELIX} · files + grep`, laneVerdict("facts", "no-tool"), usd(factsGrep.of("costUsd")), "#C41633")}
${factCard(`${ASTERIX} · the compiler`, laneVerdict("facts", "tool"), usd(factsTool.of("costUsd")), "#A127F2")}
</div>
<p style="font-size:32px;line-height:1.4;color:#40485A;width:1560px">“Can we delete the <b>warning</b> variant?” Grep counted 60 places. There are 100: the rest hide inside <span style="${MONO};font-size:0.88em;font-weight:600;color:#7A1FC2;background:#EFE4FB;padding:2px 10px;border-radius:8px;white-space:nowrap">a ? 'success' : 'warning'</span>. A migration forgives, because the compiler shouts. A question does not.</p>
<aside>Stage version: only the six-question test, which is fully measured. The other two jobs (blast radius on a routed app, accessibility sweep) join the backup slide “otherjobs” when their runs are in.</aside>
</section>
`;

const v1Blast = lane("atlas-blast", "tool");
const v2Blast = lane("atlas-blast", "tool-v2");
const versionRow = (label, series, arm, data, highlight) => row([ label, laneVerdict(series, arm), data.cell("costUsd", usd), data.cell("turns", values => span(values, plain)), data.cell("modelSeconds", seconds), `${hung(data)} of ${data.runs.length}` ], highlight ? "#F3E6FB" : "#FFFFFF", highlight);
slides.toolv2 = `<section id="toolv2" data-transition="fade" style="background:#F6F4FA;color:#1F2533;font-family:Roboto, Arial, sans-serif;padding:112px 128px 128px;display:flex;flex-direction:column;gap:28px">
${LOGO}
${eyebrow("Backup · we read the recordings, then fixed the tool")}
${heading("Three small changes, measured again", 84, "width:1560px")}
${table([
        headerRow([ "Lane", "Correct runs", "Cost", "Turns", "Model time", "Runs that hung" ], [ 40, 12, 16, 10, 12, 10 ]),
        versionRow("Migration · tool as first written", "baseline", "tool", asterix, false),
        versionRow("Migration · improved tool", "tool-v2", "tool-v2", v2, true),
        versionRow("Blast radius · tool as first written", "atlas-blast", "tool", v1Blast, false),
        versionRow("Blast radius · improved tool", "atlas-blast", "tool-v2", v2Blast, true)
    ], 27)}
<div style="display:flex;gap:24px">
<div style="flex:1;display:flex;flex-direction:column;gap:8px;background:#FFFFFF;padding:24px 28px;border:1px solid #E3E0EC;border-left:8px solid #A127F2;border-radius:16px"><h3 style="${BANGERS};font-size:34px;font-weight:400">Answer the whole question</h3><p style="font-size:24px;line-height:1.4;color:#40485A">One command walks “who renders whom” up to the routes, instead of listing direct uses for the agent to chain.</p></div>
<div style="flex:1;display:flex;flex-direction:column;gap:8px;background:#FFFFFF;padding:24px 28px;border:1px solid #E3E0EC;border-left:8px solid #F230BF;border-radius:16px"><h3 style="${BANGERS};font-size:34px;font-weight:400">Nothing to write to disk</h3><p style="font-size:24px;line-height:1.4;color:#40485A">The recipe goes inline. Every hang we recorded started with the agent writing a file through the shell.</p></div>
<div style="flex:1;display:flex;flex-direction:column;gap:8px;background:#FFFFFF;padding:24px 28px;border:1px solid #E3E0EC;border-left:8px solid #C41633;border-radius:16px"><h3 style="${BANGERS};font-size:34px;font-weight:400">The verdict comes back with the result</h3><p style="font-size:24px;line-height:1.4;color:#40485A">The compiler’s answer in three lines instead of 700 KB of raw output, and a lock so two writes cannot collide.</p></div>
</div>
<aside>The point for the audience: the tool is not magic either, it has to be designed for how an agent actually behaves. We found all three changes by replaying recorded runs, not by guessing. The first version is kept frozen in bench/tool-v1 so the comparison is repeatable.</aside>
</section>
`;

for (const [ id, html ] of Object.entries(slides)) writeFileSync(path.join(SLIDES, `${id}.html`), html);
console.log(`rewrote ${Object.keys(slides).join(", ")} from ${allRuns.length} recorded runs (${hungRuns.length} of them hung on a command of their own)`);
