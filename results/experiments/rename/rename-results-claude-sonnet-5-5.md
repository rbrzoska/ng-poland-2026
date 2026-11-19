# Rename benchmark — claude-sonnet-5-5, claude-sonnet-5-5 — 2026-11-18

One refactoring on rename/ (scripts/generate-rename.mjs): rename the input `PillComponent.disableTooltip` to `hideHint` everywhere, and nowhere else. The key lists 588 places that must change (binding 362, static 178, class-read 24, template-read 18, style 3, string 2, declaration 1; by element: app-pill 442, app-fancy-pill 62, no element 43, app-status-pill 41) in 141 files, and 385 places where the same word must stay (other-component 231, class-field 86, comment 42, text 26). 7 runs, arms one after another, budget cap $100 per arm. Ranges are lowest–highest over the runs. Every arm works in a copy of the app (a git repository with one commit) with a shell, node and the app's packages; a tool arm also gets its one tool in ../tools and a few lines about it (bench/prompts.mjs); a skill arm gets no such lines: its workspace holds a project skill (.claude/skills/angular-facts: SKILL.md from skill/angular-facts plus the named scripts) that the agent has to pick up on its own; a strict skill arm is the same with the next version of the skill (skill/angular-facts-strict: SKILL.md as written, doctor, leftovers, ajs-facts, reference/ and the named scripts).

How to read this. A run is correct when the compiler reports no error, no target was missed and nothing that had to stay was changed. Only the rename = correct, and no other line of the app differs from the expected app (the task says "do not change anything else"); a file the agent added does not count. Missed targets = places of the key where the old name was not replaced by the new one. Collateral = places with the same word that had to stay and were changed. Other lines = lines of the app that differ from the expected app in something other than the name at a place of the key (a rewritten expression, an edited library file). Trips = requests to the model; tokens sent include the cached ones.

What the numbers can and cannot show. The key comes from the generator's model, not from a tool; before every run it is checked against both trees. No tool has to agree with it: what each tool's rename command leaves when it is run alone is in the table "The tools alone". Of the 588 targets, 183 (178 static, 2 string, 3 style) leave no compiler error when they are missed, so "the compiler is green" proves the other 405 only. Both tools have a `check` command that prints the compiler's errors in a few lines; the arm without a tool reads the raw output of ngc, which is far longer for a broken app, so trips, tokens and cost of that arm include reading it. The app is generated and regular: one signal input, strict templates, one level of inheritance, every component with its own element tag. The result says how the arms do on this app, not how robust a tool is on other code.

| Agent | Runs correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 4/4 | 4/4 | 0 | 0 | 0 | 0 | 7–12 | 203,717–365,116 | 3,250–4,164 | $0.12–$0.16 |
| with ng-facts (parser) | 2/3 | 2/3 | 0–38 | 0 | 0 | 0 | 8–11 | 256,203–545,833 | 3,210–4,305 | $0.16–$0.28 |
| with ls-facts (language service) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 5 | 135,887–137,280 | 757–885 | $0.07–$0.07 |
| skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 13–20 | 369,621–857,912 | 3,669–5,585 | $0.15–$0.34 |
| skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 7 | 155,609–156,063 | 754–802 | $0.06–$0.07 |
| skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 7 | 157,261–157,505 | 710–812 | $0.06–$0.07 |
| strict skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 8–9 | 236,331–267,363 | 1,540–2,162 | $0.11–$0.15 |
| strict skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 6 | 147,386–149,089 | 663–735 | $0.08–$0.09 |
| strict skill with both scripts | 4/4 | 4/4 | 0 | 0 | 0 | 0 | 6 | 146,922–148,569 | 638–774 | $0.08–$0.08 |

## The tools alone

One command, no agent, on the untouched app: what an agent of that arm gets for its first tool call.

| Command | Correct | Missed targets | Collateral | Other lines | ngc errors | Time |
|---|---|---|---|---:|---:|---:|
| `node ../tools/ng-facts.mjs rename-input PillComponent.disableTooltip hideHint --root . --write` | **no** | 146 (binding 62, static 38, class-read 24, template-read 17, style 3, string 2; app-fancy-pill 62, app-status-pill 41, no element 41, app-pill 2) | 0 | 0 | 24 | 0.9 s |
| `node ../tools/ls-facts.mjs rename PillComponent.disableTooltip hideHint --root . --write` | **no** | 5 (style 3, string 2; app-fancy-pill 2, app-pill 2, app-status-pill 1) | 0 | 0 | 0 | 12.9 s |

## Runs

| Run | Agent | Correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost | Time | Remarks |
|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 8 | 260,141 | 3,358 | $0.15 | 60 s | claude-sonnet-5-5 |
| 1 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 8 | 256,203 | 3,262 | $0.16 | 99 s | claude-sonnet-5-5; tool commands: ng-facts 3 |
| 1 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 5 | 136,955 | 885 | $0.07 | 58 s | claude-sonnet-5-5; tool commands: ls-facts 1 |
| 1 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 15 | 434,546 | 3,669 | $0.16 | 170 s | claude-sonnet-5-5; tool commands: ng-facts 4, skill 1 |
| 1 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 7 | 155,901 | 754 | $0.07 | 42 s | claude-sonnet-5-5; tool commands: ls-facts 1, skill 1 |
| 1 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 7 | 157,362 | 749 | $0.07 | 42 s | claude-sonnet-5-5; tool commands: ls-facts 1, skill 1 |
| 2 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 12 | 365,116 | 4,164 | $0.16 | 107 s | claude-sonnet-5-5 |
| 2 | with ng-facts (parser) | **no** | **no** | 38 (static 38; app-status-pill 20, app-fancy-pill 18) | 0 | 0 | 0 | 11 | 545,833 | 3,210 | $0.28 | 195 s | claude-sonnet-5-5; tool commands: ng-facts 1 |
| 2 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 5 | 135,887 | 757 | $0.07 | 52 s | claude-sonnet-5-5; tool commands: ls-facts 2 |
| 2 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 20 | 857,912 | 5,585 | $0.34 | 152 s | claude-sonnet-5-5; tool commands: ng-facts 6, skill 1 |
| 2 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 7 | 156,063 | 802 | $0.07 | 42 s | claude-sonnet-5-5; tool commands: ls-facts 1, skill 1 |
| 2 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 7 | 157,505 | 812 | $0.07 | 40 s | claude-sonnet-5-5; tool commands: ls-facts 1, skill 1 |
| 3 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 8 | 236,100 | 3,721 | $0.13 | 53 s | claude-sonnet-5-5 |
| 3 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 11 | 425,568 | 4,305 | $0.21 | 128 s | claude-sonnet-5-5; tool commands: ng-facts 1 |
| 3 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 5 | 137,280 | 794 | $0.07 | 52 s | claude-sonnet-5-5; tool commands: ls-facts 1 |
| 3 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 13 | 369,621 | 3,752 | $0.15 | 119 s | claude-sonnet-5-5; tool commands: ng-facts 3, skill 1 |
| 3 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 7 | 155,609 | 800 | $0.06 | 39 s | claude-sonnet-5-5; tool commands: ls-facts 1, skill 1 |
| 3 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 7 | 157,261 | 710 | $0.06 | 33 s | claude-sonnet-5-5; tool commands: ls-facts 1, skill 1 |
| 4 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 8 | 236,331 | 1,718 | $0.14 | 108 s | claude-sonnet-5-5; tool commands: leftovers 2, ng-facts 2, doctor 1, ls-facts 1, skill 1 |
| 4 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 6 | 149,057 | 735 | $0.09 | 46 s | claude-sonnet-5-5; tool commands: leftovers 2, ls-facts 2, doctor 1, skill 1 |
| 4 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 6 | 148,569 | 638 | $0.08 | 57 s | claude-sonnet-5-5; tool commands: leftovers 2, ls-facts 2, doctor 1, skill 1 |
| 5 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 9 | 239,194 | 1,540 | $0.11 | 59 s | claude-sonnet-5-5; tool commands: ng-facts 3, leftovers 2, doctor 1, skill 1 |
| 5 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 6 | 149,089 | 663 | $0.09 | 42 s | claude-sonnet-5-5; tool commands: leftovers 2, ls-facts 2, doctor 1, skill 1 |
| 5 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 6 | 146,971 | 774 | $0.08 | 38 s | claude-sonnet-5-5; tool commands: leftovers 2, doctor 1, ls-facts 1, skill 1 |
| 6 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 9 | 267,363 | 2,162 | $0.15 | 65 s | claude-sonnet-5-5; tool commands: leftovers 2, ng-facts 2, doctor 1, ls-facts 1, skill 1 |
| 6 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 6 | 147,386 | 708 | $0.08 | 37 s | claude-sonnet-5-5; tool commands: leftovers 2, doctor 1, ls-facts 1, skill 1 |
| 6 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 6 | 148,511 | 672 | $0.08 | 42 s | claude-sonnet-5-5; tool commands: leftovers 2, ls-facts 2, doctor 1, skill 1 |
| 7 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 7 | 203,717 | 3,250 | $0.12 | 56 s | claude-sonnet-5-5 |
| 7 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 6 | 146,922 | 718 | $0.08 | 38 s | claude-sonnet-5-5; tool commands: leftovers 2, doctor 1, ls-facts 1, skill 1 |
