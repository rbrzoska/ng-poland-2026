# Handover: language service, the rename benchmark and the `angular-facts` skill

Written on 2026-11-18, last updated that evening (about 20:00), branch `research/language-service`.
**Nothing of this work is committed.** No background job is running.

## 1. The question

After the talk, someone from the Angular core team suggested the Angular Language Service as a fact source for agents
(search, queries, refactoring). Three steps so far:

1. An investigation of the language service without an editor (committed earlier on this branch, `bench/probes/ls/`).
2. A measurement at agent level: one refactoring, done by agents with three fact sources (this document, sections 2 to 4).
3. A skill around the scripts, meant for everyday tasks on a real application, not only for renames (section 5).

## 2. The rename benchmark

**The job:** rename the input `PillComponent.disableTooltip` to `hideHint` everywhere in a generated app that compiles,
and nowhere else. The app has components that extend `PillComponent`, plain attributes, inline templates, reads in
TypeScript, and the name inside strings (`setInput("…")`) and CSS selectors.

**The key:** 588 places that must change in 141 files, 385 places with the same word that must stay. It comes from the
generator's model. A reviewer recounted it by hand and with his own script: no difference.

| File | What it is |
|---|---|
| `scripts/generate-rename.mjs` | writes `rename/`, `rename-expected/`, `rename-key.json` (all three git-ignored) |
| `bench/rename.mjs` | runner and judge: `--check`, `--score <workspace>`, `--self-test`, or a paid run |
| `bench/rename-summary.mjs` | tables from the result files: `node bench/rename-summary.mjs <model> …` |
| `bench/prompts.mjs` | `RENAME_TASK` and the two tool hints |
| `tool/ls-facts.mjs` | new: `refs`, `rename`, `check` on the Angular Language Service |
| `tool/ng-facts.mjs` | changed: plain attributes are renamed, `check` works on Windows, honest wording about `extends` |
| `skill/angular-facts/SKILL.md` | the first skill (procedure only), used by the `skill-*` lanes |
| `results/experiments/rename/` | result files, recordings, one report per model |

**Lanes** (the same task text for all):

| Lane | What the agent gets |
|---|---|
| `no-tool` | files, grep and a shell |
| `ng-facts` | plus a few lines in the prompt about the parser script |
| `ls-facts` | plus a few lines in the prompt about the language-service script |
| `skill-ng`, `skill-ls`, `skill-both` | no line in the prompt; a project skill in `.claude/skills/angular-facts` with the named script(s) |

**What each script does alone** (one command, no agent): `ng-facts rename-input` leaves 146 of 588 (inherited
components, reads in code, strings, styles) and 24 compiler errors; `ls-facts rename` leaves 5 of 588 (two strings,
three CSS selectors) and a green compiler. 183 of the 588 places give no compiler error when missed.

**How to run** (paid; from Git Bash; the first line is needed inside a Claude desktop session):

```bash
unset $(env | grep -E "^(ANTHROPIC|CLAUDE)" | cut -d= -f1)
node bench/rename.mjs --model claude-sonnet-5-5 --arms no-tool,ng-facts,ls-facts,skill-ng,skill-ls,skill-both --runs 3 --budget 100
```

## 3. Results, first series: OLD models

The first series was started with the aliases `haiku`, `sonnet`, `opus`, `fable`. The CLI of that day (2.1.268) resolved
them to old models. Keep these numbers as a direction only. Cost is what the CLI reported. Three runs per cell unless
the "Correct" column says otherwise.

| Model | Lane | Correct | Cost per run | Time per run |
|---|---|---|---|---|
| claude-haiku-4-5 | no-tool | 0 of 3 | $0.52–1.74 | 256–1251 s |
| | ng-facts | 0 of 3 | $1.03–1.51 | 656–1226 s |
| | ls-facts | 0 of 3 (always the same 5 left) | $0.03–0.05 | 32–41 s |
| | skill-ng | 0 of 3 | $0.44–1.71 | 256–985 s |
| | skill-ls | 3 of 3 | $0.10–0.19 | 65–91 s |
| | skill-both | 2 of 3 | $0.09–0.82 | 74–564 s |
| claude-sonnet-5 | no-tool | 4 of 6 (two runs cut by a $3 cap) | $0.84–3.09 | 270–508 s |
| | ng-facts | 3 of 3 | $0.87–1.31 | 260–401 s |
| | ls-facts | 3 of 3 | $0.43–0.53 | 92–123 s |
| | skill-ng | 3 of 3 | $1.05–1.28 | 343–383 s |
| | skill-ls | 3 of 3 | $0.21–0.25 | 99–107 s |
| | skill-both | 3 of 3 | $0.24–0.28 | 107–122 s |
| claude-opus-5 | no-tool | 3 of 3 | $1.31–1.60 | 211–254 s |
| | ng-facts | 3 of 3 | $1.39–1.91 | 257–329 s |
| | ls-facts | 3 of 3 | $0.43–0.67 | 86–112 s |
| | skill-ng | 3 of 3 | $1.29–1.51 | 224–231 s |
| | skill-ls | 3 of 3 | $0.46–0.86 | 90–134 s |
| | skill-both | 3 of 3 | $0.59–0.71 | 107–140 s |
| claude-fable-5-1 | no-tool | 3 of 3 | $1.67–2.76 | 192–356 s |
| | ng-facts | 3 of 3 | $1.45–1.77 | 211–321 s |
| | ls-facts | 3 of 3 | $0.65–0.76 | 121–142 s |
| | skill-ng | 3 of 3 | $1.00–1.47 | 167–214 s |
| | skill-ls | 3 of 3 | $0.56–0.62 | 84–99 s |
| | skill-both | 3 of 3 | $0.53–0.59 | 82–133 s |

Total cost of this series: about $71.

What it showed:

- **The language-service script was the cheapest and fastest lane on every model**, two to three times cheaper than grep.
- **The parser script did not pay off on this task** for strong models: it leaves a quarter of the work, and the agent
  finishes it by hand.
- **The weak model stopped at a green compiler.** Haiku 4.5 with `ls-facts` ran one command, read "ngc: 0 errors" and
  reported done, three times out of three, leaving the two strings and three CSS selectors the task text names.
- **A skill fixed that**, but only its second version. With the first version Haiku loaded the skill and followed it,
  then cut the list of leftovers with `head -20` and saw only decoys. The second version replaces the one big search by
  three short, targeted ones (strings, style selectors, files outside the project). That run is kept apart as
  `rename-haiku-run-4.skill-v1.json`.
- **A skill does not save a weak script**: Haiku with the skill and only `ng-facts` still failed three of three.
- **Two scripts can confuse a weak model**: with both, Haiku once took the worse path.
- **On Sonnet the skill halved the cost** of the `ls-facts` lane. On Opus and Fable it changed nothing.

Notes on the data: the reports `rename-results-haiku.md` etc. leave two Haiku rows out of their summary because the
recording "mentions another workspace". It is a false alarm (the agent typed its own workspace path without
separators); the pattern is fixed in `bench/rename.mjs`, and the table above counts those rows.

## 4. Results, second series: CURRENT models (finished)

Run on 2026-11-18 from 13:15 with full model ids on CLI 2.1.318; six lanes, three runs each, no cost cap, all 72 runs
finished. Total cost: $18.58. The tables come from:

```bash
node bench/rename-summary.mjs claude-haiku-5-5 claude-sonnet-5-5 claude-opus-5-5 claude-fable-5-2
```

| Model | Lane | Correct | Cost per run | Trips | Time per run |
|---|---|---|---|---|---|
| claude-haiku-5-5 | no-tool | 3 of 3 | $0.02–0.04 | 14–27 | 101–173 s |
| | ng-facts | 2 of 3 (one run left 3) | $0.03–0.04 | 19–26 | 177–243 s |
| | ls-facts | 3 of 3 | $0.01 | 8–13 | 69–98 s |
| | skill-ng | 3 of 3 | $0.02–0.03 | 16–20 | 109–171 s |
| | skill-ls | 3 of 3 | $0.01 | 12–13 | 60–83 s |
| | skill-both | 3 of 3 | $0.01 | 10–13 | 64–72 s |
| claude-sonnet-5-5 | no-tool | 3 of 3 | $0.13–0.16 | 8–12 | 53–107 s |
| | ng-facts | 2 of 3 (one run left 38) | $0.16–0.28 | 8–11 | 99–195 s |
| | ls-facts | 3 of 3 | $0.07 | 5 | 52–58 s |
| | skill-ng | 3 of 3 | $0.15–0.34 | 13–20 | 119–170 s |
| | skill-ls | 3 of 3 | $0.06–0.07 | 7 | 39–42 s |
| | skill-both | 3 of 3 | $0.06–0.07 | 7 | 33–42 s |
| claude-opus-5-5 | no-tool | 3 of 3 | $0.31–0.55 | 9–19 | 79–126 s |
| | ng-facts | 3 of 3 | $0.47–0.52 | 14–16 | 151–216 s |
| | ls-facts | 3 of 3 | $0.17–0.29 | 6–18 | 85–95 s |
| | skill-ng | 3 of 3 | $0.40–0.62 | 16–30 | 219–253 s |
| | skill-ls | 3 of 3 | $0.15–0.16 | 8–9 | 54–59 s |
| | skill-both | 3 of 3 | $0.15–0.17 | 7–10 | 56–59 s |
| claude-fable-5-2 | no-tool | 3 of 3 | $0.67–0.98 | 9–11 | 74–114 s |
| | ng-facts | 3 of 3 | $0.62–0.88 | 6–10 | 92–145 s |
| | ls-facts | 3 of 3 | $0.38–0.46 | 5–6 | 71–76 s |
| | skill-ng | 3 of 3 | $0.61–1.05 | 9–22 | 93–204 s |
| | skill-ls | 3 of 3 | $0.27–0.30 | 7–8 | 52–65 s |
| | skill-both | 3 of 3 | $0.27–0.31 | 7 | 50–65 s |

What it shows:

- **The task no longer separates the lanes by correctness.** 70 of 72 runs are correct, grep alone included: Haiku 5.5
  does the whole rename without a tool for $0.02–0.04.
- **Both failures are the `ng-facts` hint lane** (Sonnet 5.5 left 38 plain attributes on the inherited components,
  Haiku 5.5 left 3). A script with a blind spot can do harm that grep alone does not. The same script inside the skill
  (`skill-ng`) was correct 12 of 12 times: the procedure makes the agent look for what the script left.
- **The language-service lanes cost about half of grep and take about half the time**, and the skill makes them a
  little cheaper and steadier again: Sonnet 5.5 $0.06–0.07 against $0.13–0.16, Opus 5.5 $0.15–0.16 against $0.31–0.55,
  Fable 5.2 $0.27–0.30 against $0.67–0.98.
- **The parser script never pays off here**: `ng-facts` and `skill-ng` cost as much as grep or more, and take longer.
- Against the first series the same task costs a fraction on the current models (Sonnet without a tool: $0.13–0.16
  against $0.84–1.32 on Sonnet 5).

The benchmark needs a harder task or a bigger, less regular app before it says more about current models (section 7).
Three runs per cell: read the ranges as a direction, not as exact numbers.

## 5. The skill

**Goal (Rafał, 2026-11-18):** one skill for everyday tasks on a real Angular application, not only migrations, tight
enough that an agent does not forget an edge case. He wants to try it on his own tasks.

| Folder | State |
|---|---|
| `skill/angular-facts/` | first skill: `SKILL.md` only, procedure for a rename with targeted searches. Used by the `skill-*` lanes. Do not edit while a measurement runs. |
| `skill/angular-facts-strict/` | the next version, being built by a workflow (section 6). Self-contained folder. |

What the strict version is meant to hold (the contract given to the builders):

- `SKILL.md`: a table from question to command (who uses this component, input, output or method; which screens show
  it; is it dead; what breaks if I change or remove it; rename; migrate an API; what in AngularJS still uses it),
  which script when, what no script sees, and numbered procedures that each end in a machine check.
- `doctor.mjs`: first step; finds the workspace and tsconfig, says where each package was found, and prints the exact
  install line when `@angular/language-service` is missing.
- `ng-facts.mjs`, `ajs-facts.mjs`: packages resolved from `--root` (they used to die outside the app folder);
  `ng-facts` follows `extends`.
- `ls-facts.mjs`: language-service lookup with install hint, cheaper `rename` on an app with several tsconfigs,
  `refs <Class>`.
- `leftovers.mjs <Class>.<oldName>`: text-based on purpose. It reads classes, `extends` and selectors and marks every
  place that still carries the old name as CHANGE, leave or "?", including strings, style selectors, plain attributes,
  AngularJS templates and files outside the compiled project. It prints `NOT DONE` and exits with code 2 while a
  CHANGE is left.
- `reference/*.md`: longer procedures (rename, remove, migrate, move, AngularJS, deciding).
- `test/*.test.mjs`: one per script.

**State on the evening of 2026-11-18:** built, integrated, reviewed by three reviewers and fixed (everything after the
build ran on Opus 5.5). The reviewers reported 37 findings, 4 of them blockers; 32 are fixed, 4 in part, 1 rejected.
The worst ones, all fixed: `ls-facts rename --write` could edit files inside `node_modules`; after `rename --write`
the script exited 0 and said "written" although work was left; `leftovers` said DONE while "?" places were left;
`leftovers` did not see calls from plain AngularJS `.js` code or two-way bindings that depend on an output's name.

Checked by me afterwards: the five test scripts in `test/` pass, `node bench/rename.mjs --self-test` and `--check`
pass, and no name from the private application is in the repository. I have **not** read the scripts line by line.

Still open, from the fixer's own report:

- `ls-facts refs` and `leftovers` still print 40 to 90 lines by default, not one screen.
- A misspelled old name after a rename can still give a false DONE.
- Spec and story files are compiled by no gate; only the diff review covers them.
- In the fix round `rename --write` followed by the full compiler was not run again on the real application
  (the integration round before it did run it, to DONE and 0 errors).
- `ng-facts migrate` has no check for a binding shared by a component and a directive.

The scripts were also tried on a copy of a large real application. What broke there is the reason for most of the
contract above. Those findings name private code and are kept outside this repository, in Claude's project memory
(`angular-facts-real-app-findings.md`). No name, path or number from that application may enter this repository.

### The strict skill in the benchmark

Lanes `strict-ng`, `strict-ls`, `strict-both`: no line in the prompt; the workspace holds the whole strict folder as a
project skill with the named script(s). Three runs each on the three current models, no Fable (Rafał's rule from
2026-11-18: the strongest model for tests is Opus 5.5).

| Model | Lane | Correct | Cost per run | Trips | Time per run |
|---|---|---|---|---|---|
| claude-haiku-5-5 | strict-ng | 3 of 3 | $0.01–0.02 | 13–20 | 90–100 s |
| | strict-ls | 3 of 3 | $0.01 | 15–17 | 71–84 s |
| | strict-both | 3 of 3 | $0.01 | 14–15 | 67–86 s |
| claude-sonnet-5-5 | strict-ng | 3 of 3 | $0.11–0.15 | 8–9 | 59–108 s |
| | strict-ls | 3 of 3 | $0.08–0.09 | 6 | 37–46 s |
| | strict-both | 3 of 3 | $0.08 | 6 | 38–57 s |
| claude-opus-5-5 | strict-ng | 3 of 3 | $0.25–0.36 | 9–16 | 54–81 s |
| | strict-ls | 3 of 3 | $0.26–0.31 | 12–13 | 55–67 s |
| | strict-both | 3 of 3 | $0.25–0.29 | 12–13 | 57–90 s |

- **27 of 27 correct.** Every run loaded the skill, ran `doctor` once, the rename script, and `leftovers` two to six
  times: the gates are followed, also by Haiku.
- **The parser lane is no longer the slow one.** With `ng-facts` following `extends`, `strict-ng` on Opus 5.5 takes
  54–81 s and $0.25–0.36, against 219–253 s and $0.40–0.62 for `skill-ng`.
- **The gates cost something on a task the model already gets right.** `strict-ls` is a little dearer than `skill-ls`
  (Opus 5.5 $0.26–0.31 against $0.15–0.16, Sonnet 5.5 $0.08–0.09 against $0.06–0.07): more steps for the same result.
  Whether they pay off shows only on a task where the lighter lanes fail, which this benchmark no longer is.

## 6. Background jobs

None. The second measurement series, the skill workflow (`wf_dc807bac-01e`) and the strict series all finished on
2026-11-18. The workflow was stopped once at 13:59 and resumed on Opus 5.5; the computer slept several times during the
day (each time the jobs simply stood still), so wall-clock durations of the workflow mean nothing.

Left behind outside the repository: copies of the real application and of the skill in WSL under `/tmp` (`vf-*`,
`fix-*`, `factcheck-*`), and raw outputs with private names in the session's scratchpad. Both may be deleted.

## 7. Next steps

1. Done: second series (section 4), the strict skill and its measurement (section 5).
2. Rafał: read `skill/angular-facts-strict/SKILL.md` and try the skill on one real task (see "Install" below). This is
   the test that matters now; the generated benchmark no longer tells the lanes apart.
3. Decide: make `skill/angular-facts-strict/` the one skill (replace `skill/angular-facts/`), and whether `tool/*.mjs`
   stay as the talk's versions or are replaced by the hardened scripts.
4. Make the benchmark harder for current models: a task where a green compiler and a clean grep are both wrong (a
   removal, a change of meaning, an AngularJS template in the way), a larger and less regular app, or questions
   instead of edits. `bench/facts.mjs` and `bench/hybrid.mjs` have question benchmarks with keys; they need a skill lane.
5. Close the open points of section 5.
6. Commit on `research/language-service` (`rename/`, `rename-expected/`, `rename-key.json` are ignored on purpose;
   the recordings hold local temp paths with the Windows user name).
7. Optional: write up the three language-service issues for the Angular core team (rename refused on a generic
   component with doubled references; `readonly` inputs invisible without `strictInputAccessModifiers`; a silently
   partial rename). The generic one needs a small repro without company code.

### Install as a personal skill (nothing lands in the application's repository)

In the environment where the application lives (for a checkout in WSL: inside WSL):

```bash
mkdir -p ~/.claude/skills && cp -r /mnt/c/projects/ng-poland-2026/skill/angular-facts-strict ~/.claude/skills/angular-facts
```

```bash
node ~/.claude/skills/angular-facts/doctor.mjs --root <folder with angular.json>
```

`doctor` prints READY, or the one `npm install --prefix … @angular/language-service@<version>` line that installs the
language service next to the skill. Then start Claude Code in the application and give it a task; the skill's
description makes it load for questions about usage and for changes, removals, renames and AngularJS leftovers.
Expect the first language-service call on a large application to take about half a minute and a few GB of memory.

## 8. Things that cost time, so they do not cost it again

- **Model ids:** pass full ids (`claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-2`), never
  aliases, and check with a one-word call which model answered. Opus 5.5 needs CLI 2.1.280 or newer, Fable 5.2 needs
  2.1.290 or newer.
- **No cost cap:** a `--budget 3` cap cut two Sonnet runs and made them look like failures. Use `--budget 100`; cost and
  tokens are recorded anyway.
- **Sleep:** the desktop app keeps the computer awake only during a turn. Background runs stall when Windows sleeps.
- **Files a running measurement reads from disk at every arm:** `tool/*.mjs`, `skill/angular-facts/SKILL.md`, `rename/`.
  Do not edit them while it runs. `bench/rename.mjs` itself is loaded once and may be edited.
- **Two measurement processes for the same model** pick the same run number and overwrite each other.
- **Inside a Claude desktop session** the child CLI needs the session's `CLAUDE*` and `ANTHROPIC*` variables removed.
- **Agents on Windows** lose a few trips on shell quoting and on PowerShell commands that need approval; it is the same
  for every lane.
