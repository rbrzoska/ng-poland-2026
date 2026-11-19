// Writes the three steps of the "search" slide of the five-minute deck: node deck/search-steps.mjs
//   search-1  what we look for          search-2  + Obelix: his prompt and log          search-3  + Asterix: his prompt and log
// The viewer has no in-slide steps, so one slide is built three times; run deck/five-min.mjs afterwards for the notes.
// The logs are the commands and outputs of recorded run 1 (results/recordings/agent-sonnet-run-1-*.ndjson), shortened;
// the pink notes after "←" are ours, not the agent's.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SLIDES = path.join(import.meta.dirname, "five-min/project/slides");
const MONO = "font-family:'JetBrains Mono', monospace";
const command = text => `<span style="color:#F2C230">&gt;</span> <span style="color:#FFFFFF">${text}</span>`;
const note = text => `<span style="color:#FF9AD5;font-family:Roboto, Arial, sans-serif;font-style:italic">← ${text}</span>`;
const dim = text => `<span style="color:#8E86A6">${text}</span>`;
const pad = count => "&#160;".repeat(count);

// One block per command with its output. In PowerPoint every block comes in on its own click (data-step);
// the prompt comes with the slide and the summary line with the last block.
const OBELIX_LOG = [
    [
        command("Grep \"app-pill|PillComponent\""),
        `${pad(2)}Output too large (30.8KB)`
    ],
    [
        command("grep -rcE \"&lt;app-pill([ &gt;/]|$)\" src"),
        `${pad(2)}420 ${pad(4)}${note("there are 440")}`
    ],
    [
        command("grep -rhoE \"&lt;app-pill[^&gt;]*&gt;?\" src | uniq -c"),
        `${pad(2)}100 &lt;app-pill label="…" variant="…" …/&gt;`,
        `${pad(3)}60 &lt;app-pill ${pad(4)}${note("tag split over lines")}`,
        `${pad(3)}40 &lt;app-pill … [disableTooltip]="count &gt;`,
        `${pad(22)}${note("cut at the \"&gt;\"")}`
    ],
    [
        command("python3 mig.py") + ` ${pad(2)}${note("his own regex program")}`
    ]
];
const ASTERIX_LOG = [
    [
        command("ng-facts usages PillComponent"),
        `${pad(2)}<b style="color:#9FE0B8">440 uses in 120 files</b> ${dim("(139 ms)")}`,
        `${pad(4)}feature-1.component.html:3 ${pad(1)}&lt;app-pill&gt;`,
        `${pad(4)}feature-1.component.html:4 ${pad(1)}&lt;app-pill&gt;`,
        `${pad(4)}feature-1.component.html:5 ${pad(1)}&lt;app-pill&gt;`,
        `${pad(4)}${dim("… +437 more")}`
    ],
    [
        command("ng-facts migrate spec.json --write"),
        `${pad(2)}440 elements, <b style="color:#9FE0B8">2680 edits</b> in 170 files,`,
        `${pad(2)}0 need a decision ${dim("(163 ms)")}`
    ]
];

const column = ({ shown, color, title, prompt, log, footer }) => `<div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0">
<p style="font-family:Bangers, 'Trebuchet MS', sans-serif;font-size:46px;line-height:1;color:${color}">${title}</p>
<p style="font-size:24px;line-height:1.35;color:#DCD6E8;background:#24102F;border:1px solid #3A1F4A;border-left:8px solid ${color};border-radius:12px;padding:12px 18px;visibility:${shown ? "visible" : "hidden"}"><b style="font-size:20px;letter-spacing:3px;color:#9AA4B5">PROMPT</b>&#160; ${prompt}</p>
<div style="flex:1;background:#0E0316;border:1px solid #3A1F4A;border-radius:16px;padding:20px 24px;visibility:${shown ? "visible" : "hidden"}">
${log.map((block, index) => `<p data-step="${index + 1}" style="${MONO};font-size:22px;line-height:1.5;color:#B9B2CC;white-space:nowrap">${block.join("<br>")}</p>`).join("\n")}
</div>
<p data-step="${log.length}" style="font-size:26px;color:#DCD6E8;visibility:${shown ? "visible" : "hidden"}">${footer}</p>
</div>`;

const slide = step => `<section id="search-${step}" data-transition="${step === 1 ? "fade" : "none"}" style="font-variant-ligatures:none;background:#170621;color:#F6F4FA;font-family:Roboto, Arial, sans-serif;padding:64px 112px;display:flex;flex-direction:column;justify-content:center;gap:20px">
<img src="/_blob/6b93647a1a02266a570b96ede142ca02" alt="NG Poland" style="position:absolute;right:16px;bottom:16px;width:100px;height:84px;object-fit:contain">
<p style="font-size:28px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#F230BF">The search · the agents' own log, from a recorded run</p>
<h2 style="font-family:Bangers, 'Trebuchet MS', sans-serif;font-size:84px;font-weight:400;line-height:1.04;letter-spacing:1px;color:#FFFFFF">Same task. <span style="color:#F230BF">Two ways to search.</span></h2>
<p style="font-size:34px;line-height:1.3;color:#FFFFFF;background:#2B1240;border:2px solid #A127F2;border-radius:16px;padding:14px 26px;align-self:flex-start"><span style="font-size:22px;letter-spacing:3px;text-transform:uppercase;color:#C98BFF">We are looking for</span>&#160;&#160; every <b style="${MONO};color:#F2C230">&lt;app-pill&gt;</b> and its old inputs: <b style="${MONO};color:#F2C230">disableTooltip</b>, <b style="${MONO};color:#F2C230">variant</b>, <b style="${MONO};color:#F2C230">label</b></p>
<div style="display:flex;gap:28px;align-items:stretch">
${column({ shown: step >= 2, color: "#FF6FA5", title: "Obelix · grep", prompt: "Migrate every &lt;app-pill&gt; to v2 …", log: OBELIX_LOG, footer: "<b>9 commands</b> · 10 trips to the model · 301 k tokens" })}
${column({ shown: step >= 3, color: "#C98BFF", title: "Asterix · the compiler", prompt: "the same + <span style=\"color:#F2C230\">“and use ng-facts script based on Angular Compiler”</span>", log: ASTERIX_LOG, footer: "<b>3 commands</b> · 4 trips to the model · 130 k tokens" })}
</div>
<aside></aside>
</section>
`;

for (const step of [ 1, 2, 3 ]) {
    const file = path.join(SLIDES, `search-${step}.html`);
    const notes = existsSync(file) ? readFileSync(file, "utf8").match(/<aside>[\s\S]*?<\/aside>/)?.[0] : null;
    writeFileSync(file, notes ? slide(step).replace("<aside></aside>", notes) : slide(step));
}
console.log("search-1, search-2, search-3 written");
