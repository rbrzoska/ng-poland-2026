// Builds the five-minute stage version of the deck next to the full one: node deck/five-min.mjs
//   deck/five-min/project/   the slides to speak over, each with the spoken script as speaker notes ([m:ss] = the second
//                            the sentence starts at), followed by every other slide of the full deck as backup
//   deck/script.md           the same script to rehearse with a stopwatch
// Slides in deck/five-min/project/slides are edited in place; a slide missing there is seeded from deck/project.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DECK = import.meta.dirname;
const SOURCE = path.join(DECK, "project");
const TARGET = path.join(DECK, "five-min/project");
const WORDS_PER_SECOND = 2.0;
const BREATH_SECONDS = 0.5;
const SLIDE_CHANGE_SECONDS = 1.5;

// The spoken talk. "say" sentences get the second they should start at; "do" lines are stage directions
// (a pause costs its seconds); sentences in CUT_FIRST are marked ✂ and dropped first when running late.
// Simple English on purpose: short sentences, common words, round numbers that are easy to say.
const SCRIPT = [
    { slide: "cover", title: "Cover", say: [
        "Ave! Veni, vidi, compilavi.",
        "And please do not ask your AI what the last word means."
    ] },
    { slide: "about", title: "About me", say: [
        "My name is Rafał. For some time now, I have commanded legions of AI agents.",
        "We conquer new provinces on the front. The frontend, of course.",
        "And our unbeatable weapon is Angular."
    ] },
    { slide: "bigapp", title: "One big app", say: [
        "This is our Angular app. Hundreds of components. Thousands of inputs.",
        { do: "Click: the mission.", seconds: 0 },
        "One mission is waiting in it: a breaking change.",
        "We send an AI agent. And the agent starts to read files."
    ] },
    { slide: "mission", title: "The mission and two heroes", say: [
        "Here is the mission. The design system shipped version two of one shared component: the pill.",
        "Three inputs changed. Four hundred forty places to fix.",
        "I have two heroes for this. Same model, two ways to work.",
        { do: "Click: Obelix.", seconds: 0 },
        "Obelix is strong, and always hungry. He eats tokens, and he takes his time.",
        { do: "Click: Asterix.", seconds: 0 },
        "Asterix is small, and smart. He drinks a magic potion, and he needs much less.",
        "You can tell by their weight."
    ] },
    { slide: "search-1", title: "The search: the task", say: [
        "First, they must find every pill, and its three old inputs.",
        "Both heroes get the same task."
    ] },
    { slide: "search-2", title: "The search: Obelix", say: [
        "Obelix goes first. Here is his prompt.",
        { do: "Click: his first grep.", seconds: 0 },
        "He greps. The output is too large.",
        { do: "Click: the count.", seconds: 0 },
        "He counts four hundred twenty pills. There are four hundred forty.",
        { do: "Click: the broken matches.", seconds: 0 },
        "Some tags are split over lines. Some are cut at a greater-than sign.",
        { do: "Click: his own program.", seconds: 0 },
        "So he writes his own regex program."
    ] },
    { slide: "search-3", title: "The search: Asterix", say: [
        "Now Asterix. His prompt has one more sentence: use the ng-facts script, based on the Angular compiler.",
        { do: "Click: his question.", seconds: 0 },
        "He asks one question. The answer: every pill, with file and line.",
        { do: "Click: the recipe.", seconds: 0 },
        "Then he writes one short recipe, and the tool makes every edit.",
        "Three commands. Obelix needed nine."
    ] },
    { slide: "ngfacts", title: "What is in the potion", say: [
        "So what is in the potion? Our druids brewed it: the Angular core team. It is the compiler.",
        "And you drink it with a few lines of code.",
        { do: "Click: point 1.", seconds: 0 },
        "One: the compiler's parser reads the template. No regex.",
        { do: "Click: point 2.", seconds: 0 },
        "Two: we keep only the tag and the input we asked for. No wrong hits.",
        { do: "Click: point 3.", seconds: 0 },
        "Three: we print file and line. So the agent reads less, and asks less.",
        { do: "Click: the motto.", seconds: 0 },
        "The compiler reads. The script answers. The agent decides."
    ] },
    { slide: "results", title: "Does it pay off", say: [
        "Does it pay off? Both heroes finish the mission, eight times out of eight.",
        "Obelix pays seventeen cents or more. Asterix, mostly under ten.",
        { do: "Click: the small model.", seconds: 0 },
        "And a small, cheap model? Alone, it was right once in three runs. With the potion: three of three.",
        "Honest note: the potion gives facts, not judgement."
    ] },
    { slide: "village", title: "Your turn", say: [
        "But forget my numbers. Take the idea home.",
        "The potion is already in your node modules.",
        { do: "Click: step 1.", seconds: 0 },
        "Copy twenty-five lines. They work for any component and any input.",
        { do: "Click: step 2.", seconds: 0 },
        "Need another answer? What is dead, what is left of AngularJS? Ask your agent to add a command.",
        { do: "Click: step 3.", seconds: 0 },
        "Then tell it: before you search, run the script.",
        "Do not make your agent search. Give it the answer."
    ] },
    { slide: "thanks", title: "Thank you", say: [
        "One note: I simplified the scripts and the logs, to fit five minutes.",
        "Veni, vidi, compilavi: the agents came, the agents saw, the compiler conquered.",
        "These agents are crazy! Thank you!"
    ] }
];
// Dropped first when running late, in this order.
const CUT_FIRST = new Set([
    "Some tags are split over lines. Some are cut at a greater-than sign.",
    "Honest note: the potion gives facts, not judgement.",
    "We send an AI agent. And the agent starts to read files.",
    "Veni, vidi, compilavi: the agents came, the agents saw, the compiler conquered."
]);

const wordsIn = sentence => sentence.match(/[\p{L}\p{N}']+/gu)?.length ?? 0;
// A string may hold two or three short sentences: every sentence gets its own breath.
const sentencesIn = line => Math.max(1, line.match(/[.!?]+(?=\s|$)/g)?.length ?? 0);
const secondsFor = line => (typeof line === "string" ? wordsIn(line) / WORDS_PER_SECOND + BREATH_SECONDS * sentencesIn(line) : line.seconds);
const clock = seconds => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;

// Every line gets the second of the talk it should start at; a slide change costs SLIDE_CHANGE_SECONDS first.
let elapsed = 0;
const timed = SCRIPT.map((entry, index) => {
    const start = elapsed;
    if (index > 0) elapsed += SLIDE_CHANGE_SECONDS;
    const lines = entry.say.map(line => {
        const at = elapsed;
        elapsed += secondsFor(line);
        return typeof line === "string" ? { kind: "say", text: line, at, cut: CUT_FIRST.has(line) } : { kind: "do", text: line.do, at };
    });
    return { ...entry, lines, start, end: elapsed, duration: elapsed - start };
});
const spokenLines = timed.flatMap(entry => entry.lines).filter(line => line.kind === "say");
const totalWords = spokenLines.reduce((sum, line) => sum + wordsIn(line.text), 0);
const savedByCuts = spokenLines.filter(line => line.cut).reduce((sum, line) => sum + secondsFor(line.text), 0);

const full = JSON.parse(readFileSync(path.join(SOURCE, "deck.json"), "utf8"));
const spoken = timed.map(entry => entry.slide);
// The appendix of the FULL deck: the rest of the research, in reading order. MAIN is the spoken slides alone.
const APPENDIX = [ "appendix", "method", "traps", "spec", "race", "scaling", "steelman", "toolv2", "questions-stage", "blast", "a11y", "angularjs", "models", "tools", "limits", "reproduce" ];
const backup = APPENDIX.filter(id => {
    const there = existsSync(path.join(TARGET, `slides/${id}.html`));
    if (!there) console.warn(`appendix slide ${id} is not written yet: left out`);
    return there;
});
const assetsFile = path.join(DECK, "five-min/assets.json");
const assets = existsSync(assetsFile) ? JSON.parse(readFileSync(assetsFile, "utf8")) : {};
const ownAssets = html => html.replace(/\/_blob\/([0-9a-f]{32})/g, (match, id) => assets[id] ?? match);
// The five-minute slides are edited in place (deck/five-min/project/slides); the full deck only seeds a slide that is missing.
const slideSource = id => {
    const own = path.join(TARGET, `slides/${id}.html`);
    if (existsSync(own)) return readFileSync(own, "utf8");
    return ownAssets(readFileSync(path.join(SOURCE, `slides/${id}.html`), "utf8"));
};

mkdirSync(path.join(TARGET, "slides"), { recursive: true });
for (const [ index, entry ] of timed.entries()) {
    const next = timed[index + 1];
    const notes = [
        ...entry.lines.map(line => line.kind === "say" ? `[${clock(line.at)}] ${line.cut ? "✂ " : ""}${line.text}` : `→ ${line.text}`),
        next ? `→ Click to “${next.title}” at ${clock(entry.end)}.` : `→ Done at ${clock(entry.end)}. Smile, wait for the applause.`
    ].join("\n");
    const html = slideSource(entry.slide);
    const withNotes = /<aside>[\s\S]*?<\/aside>/.test(html) ? html.replace(/<aside>[\s\S]*?<\/aside>/, `<aside>${notes}</aside>`) : html.replace(/<\/section>\s*$/, `<aside>${notes}</aside>\n</section>\n`);
    writeFileSync(path.join(TARGET, `slides/${entry.slide}.html`), withNotes);
}
writeFileSync(path.join(TARGET, "deck.json"), JSON.stringify({
    ...full,
    title: "Veni, Vidi, Compilavi · five minutes",
    createdOnFiles: { v: 1, at: "2026-11-10T08:30:00Z" },
    order: [ ...spoken, ...backup ],
    sections: {
        talk: { description: `The five-minute talk: ${spoken.length} slides, about ${clock(elapsed)} of speaking; the spoken script with the second each sentence starts at is in the speaker notes.`, start: spoken[0] },
        backup: { description: "The appendix of the full deck: the rest of the research.", start: backup[0] }
    }
}, null, 2) + "\n");

const script = [
    "# Veni, Vidi, Compilavi — what to say, and when",
    "",
    `Generated by \`node deck/five-min.mjs\`. Rehearse with the presenter view: \`node deck/serve.mjs\`, open http://localhost:4400 and press **P**.`,
    "",
    `Timing model: ${WORDS_PER_SECOND} words per second (about ${Math.round(WORDS_PER_SECOND * 60)} words a minute, a slow, clear pace), ${BREATH_SECONDS} s of breath after every sentence (also inside a line that holds two or three), ${SLIDE_CHANGE_SECONDS} s for every slide change. Numbers are written out so they count as the words you actually say.`,
    "",
    `**${totalWords} words, about ${clock(elapsed)} of a 5:00 slot.** Sentences marked ✂ save about ${Math.round(savedByCuts)} s if you run late.`,
    "",
    ...timed.flatMap((entry, index) => [
        `## ${index + 1}. ${entry.title} · ${clock(entry.start)}–${clock(entry.end)}`,
        "",
        ...entry.lines.map(line => line.kind === "say" ? `- **${clock(line.at)}** ${line.cut ? "✂ " : ""}${line.text}` : `- *${line.text}*`),
        ""
    ])
].join("\n");
writeFileSync(path.join(DECK, "script.md"), script);
console.log(`five-minute deck: ${spoken.length} spoken slides (${totalWords} words, about ${clock(elapsed)}), ${backup.length} backup slides; script in deck/script.md`);
for (const entry of timed) console.log(`  ${clock(entry.start)}–${clock(entry.end)}  ${entry.title} (${Math.round(entry.duration)} s)`);
