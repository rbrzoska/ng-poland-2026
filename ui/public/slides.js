const escapeHtml = text => String(text ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]);

const KEYWORDS = /^(const|let|var|function|return|if|else|for|of|in|new|export|import|from|class|readonly|await|async|throw|instanceof|continue|typeof|extends)$/;
const LITERALS = /^(true|false|null|undefined|this)$/;

function highlight(code) {
    const pattern = /(\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+\b)|(\b[A-Za-z_$][\w$]*\b)/g;
    let html = "";
    let last = 0;
    for (const match of code.matchAll(pattern)) {
        html += escapeHtml(code.slice(last, match.index));
        const [ text, comment, string, number, word ] = match;
        if (comment) html += `<span class="tok-c">${escapeHtml(text)}</span>`;
        else if (string) html += `<span class="tok-s">${escapeHtml(text)}</span>`;
        else if (number) html += `<span class="tok-n">${text}</span>`;
        else if (KEYWORDS.test(word)) html += `<span class="tok-k">${word}</span>`;
        else if (LITERALS.test(word)) html += `<span class="tok-n">${word}</span>`;
        else if (/^[A-Z]/.test(word)) html += `<span class="tok-t">${word}</span>`;
        else html += escapeHtml(text);
        last = match.index + text.length;
    }
    return html + escapeHtml(code.slice(last));
}

const code = (title, source, { tag = "", size = "", lang = "ts" } = {}) => `
    <div class="code"><div class="title"><span>${escapeHtml(title)}</span><span class="tag">${escapeHtml(tag)}</span></div>
    <pre class="${size}">${lang === "plain" ? escapeHtml(source) : highlight(source)}</pre></div>`;

const fmt = {
    number: value => value === undefined || value === null ? "—" : Number(value).toLocaleString("en"),
    tokens: value => value == null ? "—" : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value),
    cost: value => value == null ? "—" : `$${value.toFixed(2)}`,
    seconds: value => value == null ? "—" : `${value} s`,
    multiple: value => value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1).replace(/\.0$/, "")}×`
};

function promptHtml(text) {
    return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

const USE_CASES = [
    [ "Change", "Design system v2 lands", "Rename, negate and remap inputs in 440 elements across 170 files — the demo you just saw." ],
    [ "Facts", "Can I drop <code>size=\"xl\"</code>?", "Every <code>[size]</code> on <code>&lt;app-dialog&gt;</code> with its value. Zero uses → delete. Same for unbound inputs and never-rendered components." ],
    [ "Facts", "Where is this on screen?", "The ticket says “the map”. Route → component tree → the slot your content lands in." ],
    [ "Facts", "A catalog for agents", "Inputs, types, slots and real usage examples of every component → Storybook stories and an MCP for agents." ],
    [ "Guard · Change", "Accessibility sweep", "Icon buttons without <code>aria-label</code>, <code>img</code> without <code>alt</code>, <code>(click)</code> on a <code>div</code>. Fix the label from the tooltip text." ],
    [ "Change", "Stable test IDs", "<code>data-testid</code> on every input and button in forms, named after <code>formControlName</code>. Playwright stops guessing." ],
    [ "Change", "i18n extraction", "Hard-coded text and attributes → translation keys + <code>en.json</code>; interpolations become parameters." ],
    [ "Guard", "Design system in CI", "Raw <code>&lt;button&gt;</code>, inline styles or hex colours where a DS component or token exists → fail with file:line." ],
    [ "Facts", "Security review", "Every <code>[innerHTML]</code>, <code>bypassSecurityTrust*</code> and dynamic <code>[href]</code>, with the expression that feeds it." ],
    [ "Change", "Feature-flag cleanup", "Flag is at 100%: keep the <code>@if</code> branch, drop <code>@else</code>, remove imports nobody needs any more." ]
];

const cell = (text, tone = "") => `<td class="${tone}">${text}</td>`;
const row = (cells, hero = false) => `<tr${hero ? " class=\"hero\"" : ""}>${cells.join("")}</tr>`;
const stat = (stats, formatter, rangeFormatter = formatter) => stats?.median == null ? "—" : stats.min === stats.max || stats.min == null || stats.max == null ? formatter(stats.median) : `${formatter(stats.median)} <small>(${rangeFormatter(stats.min)}–${rangeFormatter(stats.max)})</small>`;
const verdictCell = passed => passed == null ? cell("—") : passed ? cell("✓", "good") : cell("✗", "bad");
const functionallyCorrect = metrics => metrics.functionallyCorrect ?? (metrics.compileErrors != null && metrics.elementsWrong != null ? metrics.compileErrors === 0 && metrics.elementsWrong === 0 : undefined);
const scoredRuns = (arm, runs) => runs - (arm.failedRuns ?? 0);
const armPassed = (arm, runs) => scoredRuns(arm, runs) > 0 ? arm.functionallyCorrectRuns === scoredRuns(arm, runs) : undefined;
const bothAgentsFinished = (grep, withFacts) => grep.correct != null && withFacts.correct != null;

function resultsSlide(data, lanes) {
    const { sed, regex, codemod, grep, withFacts } = lanes;
    const summary = data.summary?.arms?.["no-tool"] && data.summary?.arms?.tool ? data.summary : null;
    const live = bothAgentsFinished(grep, withFacts);
    const value = (metrics, key, formatter = fmt.number) => metrics[key] == null ? "—" : formatter(metrics[key]);
    const correct = metrics => metrics.correct == null ? "—" : `${metrics.correct}/${metrics.shouldChange}`;
    const correctTone = (actual, expected) => actual == null ? "" : actual === expected ? "good" : "bad";
    const errorsTone = errors => errors == null ? "" : errors ? "bad" : "good";
    const laneRow = (label, metrics, hero = false, time = value(metrics, "seconds", fmt.seconds)) => row([
        cell(label), cell(time), cell(value(metrics, "turns")), cell(value(metrics, "inputTokens", fmt.tokens)), cell(value(metrics, "outputTokens", fmt.tokens)), cell(value(metrics, "costUsd", fmt.cost)),
        cell(correct(metrics), correctTone(metrics.correct, metrics.shouldChange)), cell(value(metrics, "compileErrors"), errorsTone(metrics.compileErrors)), verdictCell(functionallyCorrect(metrics))
    ], hero);
    const deterministicRow = (label, metrics) => laneRow(label, { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, ...metrics }, false, "&lt; 1 s");
    const summaryRow = (label, arm, hero = false) => row([
        cell(label), cell(stat(arm.seconds, fmt.seconds, String)), cell(stat(arm.turns, fmt.number)), cell(stat(arm.inputTokens, fmt.tokens)), cell(stat(arm.outputTokens, fmt.tokens)), cell(stat(arm.costUsd, fmt.cost)),
        cell(stat(arm.correct, median => `${fmt.number(median)}/${fmt.number(arm.shouldChange)}`, fmt.number), correctTone(arm.correct?.median, arm.shouldChange)), cell(stat(arm.compileErrors, fmt.number), errorsTone(arm.compileErrors?.median)), verdictCell(armPassed(arm, summary.runs))
    ], hero);

    const agentRows = summary
        ? summaryRow("Claude — files + grep", summary.arms["no-tool"]) + summaryRow("Claude + ng-facts", summary.arms.tool, true)
        : laneRow("Claude — files + grep", grep) + laneRow("Claude + ng-facts", withFacts, true);
    const ratios = summary ? summary.ratios ?? {} : { seconds: grep.seconds / withFacts.seconds, costUsd: grep.costUsd / withFacts.costUsd, outputTokens: grep.outputTokens / withFacts.outputTokens, inputTokens: grep.inputTokens / withFacts.inputTokens, turns: grep.turns / withFacts.turns };
    const runs = summary ? summary.runs : 1;
    const scored = summary ? Math.min(scoredRuns(summary.arms["no-tool"], runs), scoredRuns(summary.arms.tool, runs)) : 1;
    const sameAnswer = summary ? armPassed(summary.arms["no-tool"], runs) === true && armPassed(summary.arms.tool, runs) === true : functionallyCorrect(grep) !== false;
    const eyebrow = summary ? `Results · ${scored === 1 ? "one run" : `median of ${scored} runs`} on this machine` : live ? `Results · this machine, ${data.restored ? "restored from the last run" : "last run"}` : "Results · run the cauldron to fill the agent rows";
    const heading = summary || live ? `${sameAnswer ? "Same answer." : "The right answer."} ${fmt.multiple(ratios.seconds)} faster, ${fmt.multiple(ratios.costUsd)} cheaper.` : "Mechanical work belongs to the compiler";
    const variance = scored === 1 ? " One run — expect variance." : ` Medians of ${scored} runs, ranges in brackets.`;
    const explanation = summary || live ? `${fmt.multiple(ratios.outputTokens)} fewer output tokens, ${fmt.multiple(ratios.inputTokens)} fewer input tokens, ${fmt.multiple(ratios.turns)} fewer turns.${variance}` : "Agent rows appear after a run with “Run Claude agents” ticked.";

    return `<div class="eyebrow">${eyebrow}</div>
         <h2>${heading}</h2>
         <table class="results">
            <thead><tr><th>Lane</th><th>Time</th><th>Turns</th><th>Input tokens</th><th>Output tokens</th><th>Cost</th><th>Correct lines</th><th>ngc errors</th><th>Functionally correct</th></tr></thead>
            <tbody>
                ${deterministicRow("Find &amp; replace", sed)}
                ${deterministicRow("Careful regex", regex)}
                ${deterministicRow("Compiler + spec someone already wrote (execution only)", codemod)}
                ${agentRows}
            </tbody>
         </table>
         <p>${explanation}</p>`;
}

function specSlide(data, lanes) {
    const { grep, withFacts } = lanes;
    const summary = data.summary?.arms?.["no-tool"] && data.summary?.arms?.tool ? data.summary : null;
    const specText = summary?.specText ?? withFacts.specText ?? null;
    const source = specText ?? data.snippets?.spec ?? "";
    const lines = (specText ? summary?.specLines ?? withFacts.specLines : undefined) ?? source.trim().split("\n").length;
    const tag = specText ? `written by the agent · ${lines} lines` : "hand-written spec — run the cauldron with agents to see the agent's own";
    const live = bothAgentsFinished(grep, withFacts);
    const toolTokens = summary ? summary.arms.tool.outputTokens?.median : live ? withFacts.outputTokens : undefined;
    const grepTokens = summary ? summary.arms["no-tool"].outputTokens?.median : live ? grep.outputTokens : undefined;
    const ratio = summary ? summary.ratios?.outputTokens : grepTokens && toolTokens ? grepTokens / toolTokens : undefined;
    return `<div class="eyebrow">The agent's whole output</div>
         <h2>${fmt.number(lines)} lines. That was the job.</h2>
         <div class="cols wide-left spec">
            ${code(specText ? "pill-v2.migration.json — as the agent wrote it" : "tool/specs/pill-v2.migration.json", source, { tag, size: lines > 20 ? "tiny" : lines > 14 ? "small" : "" })}
            <div class="big-numbers column">
                <div class="number good"><div class="value">${fmt.tokens(toolTokens)}</div><div class="label">output tokens · Claude + ng-facts${summary ? " (median)" : ""}</div></div>
                <div class="number bad"><div class="value">${fmt.tokens(grepTokens)}</div><div class="label">output tokens · Claude with files + grep${summary ? " (median)" : ""}</div></div>
                <div class="number"><div class="value">${fmt.multiple(ratio)}</div><div class="label">fewer tokens typed by the model</div></div>
            </div>
         </div>
         <p>The compiler turned those lines into <b>${fmt.number(data.editCount ?? 3360)} edits</b> in <b>${fmt.number(data.migrateMs ?? 130)} ms</b>.</p>`;
}

function slides(data) {
    const facts = data.facts ?? { uses: 440, useFiles: 120, decoys: 200, grepTokens: 30000, grepFiles: 120, files: 217 };
    const lane = id => data.lanes?.[id]?.metrics ?? {};
    const lanes = { sed: lane("sed"), regex: lane("regex"), codemod: lane("codemod"), grep: lane("agent-grep"), withFacts: lane("agent-facts") };
    const snippets = data.snippets ?? {};

    return [
        `<div class="eyebrow">Angular compiler × AI agents</div>
         <h1>Getafix's Potion</h1>
         <p class="lead">Let the agent describe the change. Let the Angular compiler make it.</p>
         <div class="foot"><span>ng-facts · @angular/compiler · TypeScript AST</span><span>5 minutes · by Toutatis</span></div>`,

        `<div class="eyebrow">The year is 2026. All of the monorepo is occupied by AI agents…</div>
         <h2>…and a library just shipped a breaking v2</h2>
         <div class="big-numbers">
            <div class="number"><div class="value">${fmt.number(facts.uses)}</div><div class="label"><code>&lt;app-pill&gt;</code> elements in ${facts.useFiles} components to migrate</div></div>
            <div class="number bad"><div class="value">${fmt.number(data.baselineErrors ?? 700)}</div><div class="label">ngc errors after the upgrade</div></div>
            <div class="number bad"><div class="value">~${fmt.tokens(facts.grepTokens)}</div><div class="label">tokens just to read the consumers</div></div>
         </div>
         <ul>
            <li>An agent can do it — by reading every file and typing every edit. Thousands of output tokens, dozens of turns.</li>
            <li>Same names everywhere: <code>&lt;app-card&gt;</code>, class fields and docs also say <code>disableTooltip</code>.</li>
            <li>Every guess costs a turn; every turn re-reads the whole context.</li>
         </ul>`,

        `<div class="eyebrow">The task · PillComponent v1 → v2</div>
         <h2>Not a rename — an API migration</h2>
         <div class="pairs" style="font-size:26px">
            <span class="before">[disableTooltip]="!isActive"</span><span class="arrow">→</span><span class="after">[tooltip]="isActive"</span>
            <span class="before">[disableTooltip]="count &gt; 3"</span><span class="arrow">→</span><span class="after">[tooltip]="!(count &gt; 3)"</span>
            <span class="before">variant="success"</span><span class="arrow">→</span><span class="after">tone="positive"</span>
            <span class="before">[variant]="a ? 'success' : 'warning'"</span><span class="arrow">→</span><span class="after">[tone]="a ? 'positive' : 'caution'"</span>
            <span class="before">[variant]="statusVariant"</span><span class="arrow">→</span><span class="after">[tone]="statusVariant | pillTone" <span style="color:var(--gold)">+ import in .ts</span></span>
            <span class="before">&lt;app-pill label="Plain" /&gt;</span><span class="arrow">→</span><span class="after">&lt;app-pill&gt;Plain&lt;/app-pill&gt;</span>
            <span class="before">&lt;app-pill [label]="title" /&gt;</span><span class="arrow">→</span><span class="after">&lt;app-pill&gt;{{ title }}&lt;/app-pill&gt;</span>
         </div>
         <p><b>And nothing else.</b> <code>&lt;app-card&gt;</code> keeps its own <code>disableTooltip</code>.</p>`,

        `<div class="eyebrow">The traps — straight from real codebases</div>
         <h2>Why text tools break</h2>
         <div class="cols wide-left">
            ${code("features/feature-6/feature-6.component.html (v1)", `<app-card heading="Feature 6" [disableTooltip]="true">      // ① other component
    <app-pill label="Plain" [disableTooltip]="true" />       // ② input → content
    <app-pill [label]="title" [disableTooltip]="count > 3" /> // ③ '>' in a value
    <app-pill
        [variant]="isActive ? 'success' : 'warning'"         // ④ literals in ?:
        label="Multi-line"
        [disableTooltip]="isActive">
    </app-pill>
    <app-pill [variant]="statusVariant" … />                  // ⑤ needs pipe + TS import
    @if (disableTooltip) { … }                               // ⑥ own class field
</app-card>`, { size: "small" })}
            <div class="stack">
                <p>① same input name on <code>&lt;app-card&gt;</code></p>
                <p>② the tag must be expanded</p>
                <p>③ <code>&lt;app-pill[^&gt;]*&gt;</code> stops mid-tag</p>
                <p>④ change literals, keep the condition</p>
                <p>⑤ a template edit that needs a <b>TypeScript</b> edit</p>
                <p>⑥ a class field, not the input</p>
            </div>
         </div>`,

        `<div class="eyebrow">The idea</div>
         <h2>The migration is <span style="color:var(--gold)">data</span>. The compiler applies it.</h2>
         <div class="cols wide-right">
            ${code("tool/specs/pill-v2.migration.json", snippets.spec ?? "", { tag: "≈ 10 lines" })}
            <div class="stack">
                <p><code>rename</code> + <code>negate</code> — flip the meaning by expression structure</p>
                <p><code>values</code> — map string literals, even inside <code>?:</code></p>
                <p><code>otherwise.pipe</code> — non-literals get the pipe, the component gets the import</p>
                <p><code>toContent</code> — input becomes content projection</p>
                <p>Who writes it? The library author — <b>or the agent</b>, from the v2 code. That is all the agent has to output.</p>
            </div>
         </div>`,

        `<div class="eyebrow">ng-facts · find · SelectorMatcher</div>
         <h2>Which component is this element?</h2>
         <div class="cols wide-left">
            ${code("tool/ng-facts.mjs — matchedDeclarations()", snippets.matcher ?? "", { tag: "live from the source" })}
            <div class="stack">
                <p>Templates come from <code>parseTemplate()</code> — the compiler's own parser, with exact spans.</p>
                <p>Each element is matched to components with <b>the compiler's selector matching</b>.</p>
                <p><code>&lt;app-card [disableTooltip]&gt;</code> never matches <code>PillComponent</code>. No heuristics.</p>
            </div>
         </div>`,

        `<div class="eyebrow">ng-facts · values · expression AST</div>
         <h2>Negate and map by structure, not by string</h2>
         <div class="cols">
            ${code("negateExpression()", snippets.negate ?? "", { size: "small", tag: "live from the source" })}
            ${code("literalLeaves()", snippets.leaves ?? "", { size: "small", tag: "live from the source" })}
         </div>
         <p><code>!isActive</code> → <code>isActive</code> · <code>count &gt; 3</code> → <code>!(count &gt; 3)</code> · <code>a ? 'success' : 'warning'</code> → only the two literals change.</p>`,

        `<div class="eyebrow">ng-facts · structure · input → content projection</div>
         <h2>Edits that change the shape of the template</h2>
         <div class="cols">
            ${code("removalRange() — drop the attribute, or its whole line", snippets.removal ?? "", { size: "small", tag: "live from the source" })}
            ${code("expand <x … /> into <x …>value</x>", snippets.toContent ?? "", { size: "tiny", tag: "live from the source" })}
         </div>`,

        `<div class="eyebrow">ng-facts · beyond the template · TypeScript AST</div>
         <h2>A template change that needs a TypeScript change</h2>
         <div class="cols wide-left">
            ${code("importEdits() — add PillTonePipe to @Component.imports + the import", snippets.imports ?? "", { size: "small", tag: "live from the source" })}
            <div class="stack">
                <p><code>[tone]="statusVariant | pillTone"</code> compiles only if the component imports the pipe.</p>
                <p>The tool edits the decorator's <code>imports</code> array and adds the <code>import</code> statement — for exactly the 60 components that need it.</p>
                <p>Text tools cannot know which components those are.</p>
            </div>
         </div>`,

        `<div class="eyebrow">The tool, in the terminal</div>
         <h2>Facts in milliseconds, the migration in one command</h2>
         <div class="stack">
            ${code("$ ng-facts usages PillComponent.disableTooltip", data.output?.usages ?? "", { lang: "plain", size: "tiny" })}
            ${code("$ ng-facts migrate pill-v2.migration.json", data.output?.dryRun ?? "", { lang: "plain", size: "small" })}
         </div>`,

        `<div class="eyebrow">Two agents, one task</div>
         <h2>The only difference is one paragraph</h2>
         <div class="cols">
            <div class="prompt">
                <div class="who"><span class="avatar">A</span> Claude — files + grep</div>
                <div class="text" style="font-size:16px">${promptHtml(data.prompts?.task)}</div>
            </div>
            <div class="prompt">
                <div class="who"><span class="avatar">B</span> Claude + ng-facts</div>
                <div class="text muted">Same task as A, word for word — plus:</div>
                <div class="text added">${promptHtml(data.prompts?.toolHint?.trim())}</div>
                <div class="text muted">The ready-made spec is <b>not</b> provided — the agent writes its own.</div>
            </div>
         </div>`,

        `<div class="eyebrow">Fere libenter homines id quod volunt credunt — Caesar, De Bello Gallico III.18</div>
         <h2>A green build is not a correct build</h2>
         <div class="vs">
            <div class="side bad">
                <h3>Find &amp; replace, scenario 1: compiles, renders identically, the API lies</h3>
                <ul>
                    <li><code>[tooltip]="true"</code> now <b>hides</b> the tooltip — the name flipped, the meaning did not.</li>
                    <li><code>&lt;app-card&gt;</code> lost its own <code>disableTooltip</code> input — an external consumer breaks at runtime.</li>
                    <li><code>ngc</code>: 0 errors. Pixels: 0 different. Wrong lines: 1 125.</li>
                </ul>
            </div>
            <div class="side good">
                <h3>So the compiler is the first referee — not the only one</h3>
                <ul>
                    <li><code>ngc --strictTemplates</code> checks the shape of every binding, not its meaning.</li>
                    <li>A line diff against the answer key, and every pill rendered next to the reference.</li>
                    <li>An API contract in the built app: <code>[tooltip]="true"</code> must show a hint, the card consumer must keep working.</li>
                </ul>
            </div>
         </div>`,

        `<div class="eyebrow">How it is judged</div>
         <h2>Four referees — the compiler is only the first</h2>
         <div class="judges">
            <div class="step"><div class="n">ngc --strictTemplates</div><p>v1 binding on v2 = <code>NG8002</code>; wrong value type = type error.</p></div>
            <div class="step"><div class="n">Diff vs answer key</div><p>Line-aligned: correct, missed, wrong lines.</p></div>
            <div class="step"><div class="n">ng build + render</div><p>Every pill in the built app: text, tone and tooltip vs the reference.</p></div>
            <div class="step"><div class="n">API contract</div><p><code>[tooltip]="true"</code> shows a hint; an external <code>&lt;app-card&gt;</code> consumer keeps working.</p></div>
         </div>`,

        resultsSlide(data, lanes),

        specSlide(data, lanes),

        `<div class="eyebrow">Ils sont fous, ces Romains!</div>
         <div class="quote">Why make a language model type out ${fmt.number(data.editCount ?? 3360)} edits?<small>It can describe the change in ten lines. The compiler knows every element, every expression, every import — and applies it in ${fmt.number(data.migrateMs ?? 130)} ms, byte for byte.</small></div>
         <div class="vs">
            <div class="side bad"><h3>Agent as a typist</h3><p>Reads every consumer, writes every edit, re-reads after each turn. Output tokens grow with the codebase.</p></div>
            <div class="side good"><h3>Agent as an architect</h3><p>Reads the v2 API, writes the spec, runs the tool, checks <code>ngc</code>. Output tokens stay the size of the change.</p></div>
         </div>`,

        `<div class="eyebrow">Gallia est omnis divisa in partes tres · facts, changes, guards</div>
         <h2>Ten everyday jobs for the Angular compiler</h2>
         <div class="cases">
            ${USE_CASES.map(([ kind, title, text ], index) => `<div class="case ${kind.split(" ")[0].toLowerCase()}"><div class="case-head"><span class="case-n">${index + 1}</span><span class="case-kind">${kind}</span></div><h3>${title}</h3><p>${text}</p></div>`).join("")}
         </div>
         <div class="legend"><span class="facts">Facts</span> answer a question about the code · <span class="change">Change</span> applies a rule everywhere · <span class="guard">Guard</span> fails CI with file:line</div>`,

        `<div class="eyebrow">The potion, in three ingredients</div>
         <h2>Give your agents the compiler</h2>
         <div class="steps">
            <div class="step"><div class="n">1 · Facts from the AST</div><p><code>parseTemplate</code> + <code>SelectorMatcher</code>: who uses what, with which values — and what only looks the same.</p></div>
            <div class="step"><div class="n">2 · Changes as data</div><p>Renames, negations, value maps, input → content, imports: a spec the compiler applies mechanically.</p></div>
            <div class="step"><div class="n">3 · Agent decides, compiler judges</div><p>The agent writes the spec and handles the decisions; <code>ngc</code>, a diff and a contract check the result.</p></div>
         </div>
         <div class="foot"><span>angular-compiler-ai · ng-facts</span><span>By Toutatis — it works.</span></div>`
    ];
}

const stage = document.getElementById("stage");
let current = Math.max(0, Number(location.hash.slice(1)) - 1 || 0);
let total = 0;

function fit() {
    const scale = Math.min(window.innerWidth / 1640, (window.innerHeight - 44) / 940);
    stage.style.transform = `scale(${scale})`;
}

function show(index) {
    current = Math.min(Math.max(index, 0), total - 1);
    for (const [ position, slide ] of [ ...stage.children ].entries()) slide.classList.toggle("active", position === current);
    document.getElementById("counter").textContent = `${current + 1} / ${total}`;
    document.getElementById("progress").style.width = `${((current + 1) / total) * 100}%`;
    history.replaceState(null, "", `#${current + 1}`);
}

async function load() {
    const data = await fetch("/api/slides").then(response => response.json()).catch(() => ({}));
    let html;
    try {
        html = slides(data);
    } catch (error) {
        console.error("slides could not be rendered from the results data, showing the deck without them", error);
        html = slides({});
    }
    total = html.length;
    stage.innerHTML = html.map(content => `<section class="slide">${content}</section>`).join("");
    show(current);
}

document.addEventListener("keydown", event => {
    if ([ "ArrowRight", "PageDown", " " ].includes(event.key)) show(current + 1);
    if ([ "ArrowLeft", "PageUp" ].includes(event.key)) show(current - 1);
    if (event.key === "Home") show(0);
    if (event.key === "End") show(total - 1);
    if (event.key.toLowerCase() === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    if (event.key.toLowerCase() === "r") load();
});
stage.addEventListener("click", event => show(current + (event.clientX > window.innerWidth / 2 ? 1 : -1)));
window.addEventListener("resize", fit);
fit();
load();
