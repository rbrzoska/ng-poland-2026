# angular-compiler-ai

Demo for the talk *Getafix's Potion: Feeding AI Agents with the Angular Compiler*.

Thesis: an AI agent should not type out hundreds of mechanical edits — and should not read hundreds of files to find them. It should **describe** the change; the Angular compiler knows every element, binding, expression and import, and can **apply** it deterministically, in milliseconds, for zero tokens.

Slides: https://rbrzoska.github.io/ng-poland-2026/ (built with `node deck/site.mjs` into `docs/`) · [PowerPoint](deck/out/veni-vidi-compilavi-five-min.pptx)

## Run it

```bash
npm install
npm run ui          # live demo UI on http://localhost:4310 (slides on /slides)
npm run demo        # or headless: generate the workspace + benchmark, ~5 s
```

## The task: migrate 120 components to a new component API

The workspace is an Angular 22 app. Its component library already ships `PillComponent` **v2** and a new `PillTonePipe`; 120 feature components still use **v1**, so `ngc` reports 700 errors. The migration (what `ng update` schematics do for Angular Material):

| v1 | v2 |
|---|---|
| `[disableTooltip]="!isActive"` | `[tooltip]="isActive"` — opposite meaning, negated minimally (`count > 3` → `!(count > 3)`) |
| `variant="success"` | `tone="positive"` (info→neutral, success→positive, warning→caution) |
| `[variant]="a ? 'success' : 'warning'"` | `[tone]="a ? 'positive' : 'caution'"` — only the literals change |
| `[variant]="statusVariant"` | `[tone]="statusVariant \| pillTone"` **and** `PillTonePipe` added to the component's `imports` + an `import` statement |
| `<app-pill label="Plain" />` | `<app-pill>Plain</app-pill>` — input → content projection, tag expanded |
| `<app-pill [label]="title" />` | `<app-pill>{{ title }}</app-pill>` |

The 120 components come in **six template styles**, so it reads like a real codebase rather than a generated one: canonical, compact with single-quoted values and odd spacing, one attribute per line with `/>` on its own line, pills inside `@for`, expressions with `?.`, `[]`, calls and `&&`, and two pills on one line. Traps built in: `<app-card>` has an input with the same name (must not change), `<app-pill-legacy>` is a different component on the old API that `<app-pill\b` matches, a class field, a comment and docs text with the same name, a `>` inside an attribute value, nested `?:`, and a quarter of the templates inline in `.ts` string literals.

## The tool: `ng-facts`

[tool/ng-facts.mjs](tool/ng-facts.mjs) — TypeScript AST + `@angular/compiler`:

- `usages <Class|selector>[.<input>]` — every binding with its values, plus same-named bindings that are **not** this input;
- `migrate <spec.json> [--write]` — applies an API migration described as data ([tool/specs/pill-v2.migration.json](tool/specs/pill-v2.migration.json), ~10 lines): rename, negate, map values (also inside `?:`), wrap non-literals in a pipe and add the pipe to the component's `imports`, move an input into content. `migrate --help` prints the spec format;
- `rename-input <Class>.<old> <new> [--negate]` — the simple case.

How it works: `parseTemplate()` gives the compiler's own template AST with exact spans; `SelectorMatcher` matches elements to components exactly as the compiler does; expression ASTs (`PrefixNot`, `LiteralPrimitive`, `Conditional`, `Binary`) decide negation and value mapping structurally; edits are applied on exact spans (attribute or whole line removed, `/>` expanded, decorator `imports` and import statements added), back to front, everything else byte-for-byte untouched. Anything it cannot decide goes to a "needs a decision" list.

On this workspace: **2 680 edits in 170 files, 80 imports added, ~130 ms, 0 decisions left, byte-identical to the answer key.**

## What is inside

| Path | What |
|---|---|
| [scripts/generate.mjs](scripts/generate.mjs) | Generates `fixture/` (library v2, consumers v1, runnable Angular app with an API-contract panel) and `fixture-expected/` (the correct migration) |
| [tool/](tool/ng-facts.mjs) | `ng-facts` and the Pill v2 migration spec |
| [bench/approaches.mjs](bench/approaches.mjs) | Find & replace, careful regex, compiler + spec |
| [bench/run.mjs](bench/run.mjs) | Deterministic benchmark → [bench/results.md](bench/results.md) |
| [bench/score.mjs](bench/score.mjs) | Referees: line diff vs the answer key and `semanticScore` — the compiler's template AST compared element by element (formatting-blind) |
| [bench/agent.mjs](bench/agent.mjs) | Optional: Claude Code headless, with and without `ng-facts`, `--runs N` with medians → `results/` — **costs API money** |
| [bench/prompts.mjs](bench/prompts.mjs) | The agent task and the one-paragraph tool hint |
| [bench/facts.mjs](bench/facts.mjs) | Optional: six impact-analysis questions about one component, answered with and without `ng-facts` — **costs API money** |
| [bench/atlas.mjs](bench/atlas.mjs) | Optional: two jobs that are not a migration, on the routed app from [scripts/generate-atlas.mjs](scripts/generate-atlas.mjs): blast radius ("which routes can show this component?") and an accessibility sweep — **costs API money** |
| [bench/experiments.sh](bench/experiments.sh) | The whole evidence series in one command (2–3 hours, roughly $15–20) |
| [bench/evidence.mjs](bench/evidence.mjs) | Every recorded run as min–max ranges → [bench/evidence.md](bench/evidence.md); no API calls |
| [bench/tool-v1/](bench/tool-v1/ng-facts.mjs) | The tool as first written, frozen, so later versions are measured against it |
| [deck/](deck/) | Sources of the talk's slides: `evidence-slides.mjs` rebuilds the slides that carry numbers from `results/`, `five-min.mjs` builds the five-minute stage version with the spoken script as speaker notes, `render.mjs` renders an offline page and a PDF |
| [results/](results/) | Agent runs (`agent-<model>-run-<n>.json`), the summary with medians, and `recordings/` (stream + patch of every run, replayed by the UI offline) |
| [ui/](ui/server.mjs) | Live UI (Getafix's Cauldron) and slides |

## Results (deterministic lanes, 120 components, 640 lines / 440 elements to change)

| Approach | Correct lines | Wrong lines | ngc errors | Elements wrong (compiler AST) | Functionally correct |
|---|---:|---:|---:|---:|:---:|
| find & replace | 0 | 1 600 | 700 | 940 | ✗ |
| careful regex (tag-scoped) | 220 | 280 | 220 | 460 | ✗ |
| **compiler + spec (`ng-facts migrate`), execution only** | **640** | 0 | **0** | **0** | ✓ |

The compiler lane runs a spec that was written beforehand, so its ~0.15 s is the cost of *executing* a migration, not of deciding it — in the agent race that deciding costs the ng-facts agent ~27 s of wall clock. "Functionally correct" = 0 `ngc` errors **and** 0 elements that differ from the answer key in the compiler's own AST. The line diff still counts formatting; the AST referee does not — an agent that puts `Multi-line` on its own line is wrong by the line diff and right by the compiler.

Agents (Claude Code headless, the tool agent has to **write the spec itself**, no answer key reachable): every recorded run is summarised as lowest–highest ranges in [bench/evidence.md](bench/evidence.md); nothing is averaged. In short: both agents end functionally correct in every migration run; the agent with `ng-facts` was cheaper in 7 of 8 pairs (2.2–4.6×) and read a third of the context, and once cost more because it tripped over its own shell command. The cost does **not** grow with the repository for either agent (30, 120 and 480 components). Asked six questions about the code instead of migrating it, the grep agent miscounted in 2 of 5 runs and the `ng-facts` agent in none. A small model (Haiku) with the tool was right in 3 of 3 runs, without it in 1 of 3. On two jobs the tool was not written for — blast radius and an accessibility sweep — the first version bought nothing; after adding `where`/`unrouted` (and inline specs, a write lock and a built-in compiler check) the blast-radius bill fell to a quarter and the migration to 2 turns. Wall-clock times are not quoted: in about one run in five an agent hung for minutes on a command of its own, in either lane.

## Live UI — Getafix's Cauldron

`npm run ui`, then **Brew the potion**:

1. generate the workspace, ask `ng-facts` for the facts, compile the baseline (700 errors);
2. six lanes in parallel — reference, find & replace, careful regex, compiler + spec, **Claude (your `claude` CLI, headless) with files + grep**, **Claude + ng-facts** — every tool call, result, turn and token streamed live, and the spec the agent writes is captured as it is written;
3. each result: `ngc --strictTemplates`, line diff and compiler-AST diff vs the answer key, `ng build`, served under `/preview/<lane>/`;
4. every built app compared pill by pill with the reference (text, tone, tooltip; red frame = different) and checked against the API contract; scoreboard with time, turns, input/output tokens, cost, correctness, elements wrong and "functionally correct".

**Offline on stage:** leave **Replay recorded agents** ticked. The agent lanes then stream a recorded run from `results/recordings/` at 10× speed (the run closest to the median, so a typical one) and re-apply that agent's own edits from the recorded patch; `ngc`, the diffs and `ng build` still run for real, locally. No network, no `claude` CLI, no Google Fonts. Untick it to run live agents. A finished run is saved to `results/ui-last-run.json` and shown again after a server restart.

**Reset** stops everything and deletes the temporary workspaces. Untick "Run Claude agents" for a free 15-second run. Live agents run in a temporary copy (no answer key, no ready-made spec), with `Read/Edit/Write/Glob/Grep/Bash`, no MCP servers, no user settings and a `--max-budget-usd` cap.

**Slides** (`/slides`, ← → to navigate, F full screen, R reload data): 18 slides with live snippets from `ng-facts`, the migration spec, real tool output, both prompts, the agent's own spec and the medians from `results/`. A designed deck with the Asterix artwork lives in Claude (see SUMMARY.md).

## Gaul, 50 BC — a side scenario (`gaul/`, not part of the talk)

A magnifier slides over the map of Gaul. On the starting app (`gaul/fixture/`) the lens shows only the Gaulish village: the 120 Roman garrisons (4 outposts around the village plus 116 camps across Gaul, 584 `<app-tent>` elements) are declared with the TentComponent v1 API, which still compiles but is no longer drawn by the v2 map. The task is to make the Romans show up, i.e. migrate every tent to v2 — the same migration shape as Pill:

| v1 (not drawn) | v2 (drawn) |
|---|---|
| `[hideFlag]="!isCommand"` | `[flag]="isCommand"` (vexillum on the tent) |
| `unit="praetoria"`, `[unit]="isCommand ? 'legio' : 'equites'"` | `cloth="red-yellow"`, `[cloth]="isCommand ? 'red-white' : 'yellow-white'"` |
| `[unit]="reserveUnit"` | `[cloth]="reserveUnit \| tentCloth"` + `TentClothPipe` import |
| `label="Totorum"`, `[label]="motto"` | `<app-tent …>Totorum</app-tent>`, `{{ motto }}` as content |

Traps: `<app-camp [hideFlag]>` and `<app-village label>` share input names, every garrison has its own `hideFlag` field, the baseline is green (`ngc` 0 errors, 0 of 545 tents drawn), and an external consumer of `CampComponent` uses a runtime input name.

```bash
npm run gaul:generate      # gaul/fixture (v1, no tents) and gaul/fixture-expected (migrated)
npm run gaul:before        # http://localhost:4321
npm run gaul:after         # http://localhost:4322
npm run gaul:migrate -- --write   # ng-facts with tool/specs/tent-v2.migration.json: 3 272 edits, ~0.2 s, byte for byte = fixture-expected
```

Assets in `gaul/assets/` are trimmed and converted to WebP (~330 KB in total); `gaul/sites.json` holds camp positions sampled on land from the map.
