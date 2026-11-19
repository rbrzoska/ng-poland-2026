# Rename benchmark — claude-haiku-5-5, claude-haiku-5-5 — 2026-11-18

One refactoring on rename/ (scripts/generate-rename.mjs): rename the input `PillComponent.disableTooltip` to `hideHint` everywhere, and nowhere else. The key lists 588 places that must change (binding 362, static 178, class-read 24, template-read 18, style 3, string 2, declaration 1; by element: app-pill 442, app-fancy-pill 62, no element 43, app-status-pill 41) in 141 files, and 385 places where the same word must stay (other-component 231, class-field 86, comment 42, text 26). 6 runs, arms one after another, budget cap $100 per arm. Ranges are lowest–highest over the runs. Every arm works in a copy of the app (a git repository with one commit) with a shell, node and the app's packages; a tool arm also gets its one tool in ../tools and a few lines about it (bench/prompts.mjs); a skill arm gets no such lines: its workspace holds a project skill (.claude/skills/angular-facts: SKILL.md from skill/angular-facts plus the named scripts) that the agent has to pick up on its own; a strict skill arm is the same with the next version of the skill (skill/angular-facts-strict: SKILL.md as written, doctor, leftovers, ajs-facts, reference/ and the named scripts).

How to read this. A run is correct when the compiler reports no error, no target was missed and nothing that had to stay was changed. Only the rename = correct, and no other line of the app differs from the expected app (the task says "do not change anything else"); a file the agent added does not count. Missed targets = places of the key where the old name was not replaced by the new one. Collateral = places with the same word that had to stay and were changed. Other lines = lines of the app that differ from the expected app in something other than the name at a place of the key (a rewritten expression, an edited library file). Trips = requests to the model; tokens sent include the cached ones.

What the numbers can and cannot show. The key comes from the generator's model, not from a tool; before every run it is checked against both trees. No tool has to agree with it: what each tool's rename command leaves when it is run alone is in the table "The tools alone". Of the 588 targets, 183 (178 static, 2 string, 3 style) leave no compiler error when they are missed, so "the compiler is green" proves the other 405 only. Both tools have a `check` command that prints the compiler's errors in a few lines; the arm without a tool reads the raw output of ngc, which is far longer for a broken app, so trips, tokens and cost of that arm include reading it. The app is generated and regular: one signal input, strict templates, one level of inheritance, every component with its own element tag. The result says how the arms do on this app, not how robust a tool is on other code.

| Agent | Runs correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 14–27 | 634,472–1,151,207 | 13,157–24,852 | $0.02–$0.04 |
| with ng-facts (parser) | 2/3 | 2/3 | 0–3 | 0 | 0 | 0 | 19–26 | 947,043–1,416,091 | 21,273–25,309 | $0.03–$0.04 |
| with ls-facts (language service) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 8–13 | 325,266–363,765 | 3,197–4,268 | $0.01–$0.01 |
| skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 16–20 | 530,961–957,322 | 9,625–12,174 | $0.02–$0.03 |
| skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 12–13 | 264,696–268,753 | 2,848–3,172 | $0.01–$0.01 |
| skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 10–13 | 267,248–300,372 | 2,492–3,029 | $0.01–$0.01 |
| strict skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 13–20 | 466,181–618,942 | 6,066–6,822 | $0.01–$0.02 |
| strict skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 15–17 | 432,079–479,773 | 3,544–3,983 | $0.01–$0.01 |
| strict skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 14–15 | 358,481–468,820 | 2,915–3,514 | $0.01–$0.01 |

## The tools alone

One command, no agent, on the untouched app: what an agent of that arm gets for its first tool call.

| Command | Correct | Missed targets | Collateral | Other lines | ngc errors | Time |
|---|---|---|---|---:|---:|---:|
| `node ../tools/ng-facts.mjs rename-input PillComponent.disableTooltip hideHint --root . --write` | **no** | 146 (binding 62, static 38, class-read 24, template-read 17, style 3, string 2; app-fancy-pill 62, app-status-pill 41, no element 41, app-pill 2) | 0 | 0 | 24 | 0.9 s |
| `node ../tools/ls-facts.mjs rename PillComponent.disableTooltip hideHint --root . --write` | **no** | 5 (style 3, string 2; app-fancy-pill 2, app-pill 2, app-status-pill 1) | 0 | 0 | 0 | 13 s |

## Runs

| Run | Agent | Correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost | Time | Remarks |
|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 21 | 1,151,207 | 24,852 | $0.04 | 173 s | claude-haiku-5-5 |
| 1 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 21 | 947,043 | 21,273 | $0.03 | 180 s | claude-haiku-5-5; tool commands: ng-facts 5 |
| 1 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 13 | 332,737 | 4,268 | $0.01 | 98 s | claude-haiku-5-5; tool commands: ls-facts 4 |
| 1 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 17 | 583,462 | 9,625 | $0.02 | 171 s | claude-haiku-5-5; tool commands: ng-facts 4, skill 1 |
| 1 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 12 | 265,618 | 3,120 | $0.01 | 83 s | claude-haiku-5-5; tool commands: ls-facts 4, skill 1 |
| 1 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 13 | 300,372 | 3,029 | $0.01 | 69 s | claude-haiku-5-5; tool commands: ls-facts 3, skill 1 |
| 2 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 27 | 634,472 | 14,614 | $0.02 | 101 s | claude-haiku-5-5 |
| 2 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 19 | 1,047,807 | 22,923 | $0.03 | 177 s | claude-haiku-5-5; tool commands: ng-facts 3 |
| 2 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 8 | 325,266 | 3,197 | $0.01 | 69 s | claude-haiku-5-5; tool commands: ls-facts 4 |
| 2 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 20 | 957,322 | 11,232 | $0.03 | 109 s | claude-haiku-5-5; tool commands: ng-facts 6, skill 1 |
| 2 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 12 | 264,696 | 2,848 | $0.01 | 60 s | claude-haiku-5-5; tool commands: ls-facts 3, skill 1 |
| 2 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 10 | 267,248 | 2,492 | $0.01 | 64 s | claude-haiku-5-5; tool commands: ls-facts 3, skill 1 |
| 3 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 14 | 672,959 | 13,157 | $0.02 | 108 s | claude-haiku-5-5 |
| 3 | with ng-facts (parser) | **no** | **no** | 3 (style 3; app-fancy-pill 1, app-pill 1, app-status-pill 1) | 0 | 0 | 0 | 26 | 1,416,091 | 25,309 | $0.04 | 243 s | claude-haiku-5-5; tool commands: ng-facts 8 |
| 3 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 11 | 363,765 | 4,221 | $0.01 | 81 s | claude-haiku-5-5; tool commands: ls-facts 3 |
| 3 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 16 | 530,961 | 12,174 | $0.02 | 125 s | claude-haiku-5-5; tool commands: ng-facts 3, skill 1 |
| 3 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 13 | 268,753 | 3,172 | $0.01 | 71 s | claude-haiku-5-5; tool commands: ls-facts 3, skill 1 |
| 3 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 13 | 271,577 | 3,013 | $0.01 | 72 s | claude-haiku-5-5; tool commands: ls-facts 4, skill 1 |
| 4 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 13 | 466,181 | 6,066 | $0.01 | 90 s | claude-haiku-5-5; tool commands: ng-facts 5, leftovers 4, doctor 1, skill 1 |
| 4 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 15 | 432,079 | 3,544 | $0.01 | 71 s | claude-haiku-5-5; tool commands: leftovers 3, ls-facts 3, doctor 1, skill 1 |
| 4 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 14 | 387,382 | 3,480 | $0.01 | 86 s | claude-haiku-5-5; tool commands: leftovers 3, ls-facts 3, doctor 1, ng-facts 1, skill 1 |
| 5 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 20 | 618,942 | 6,390 | $0.02 | 100 s | claude-haiku-5-5; tool commands: leftovers 4, ng-facts 3, doctor 1, skill 1 |
| 5 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 17 | 479,773 | 3,983 | $0.01 | 84 s | claude-haiku-5-5; tool commands: leftovers 5, ls-facts 4, doctor 1, skill 1 |
| 5 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 14 | 358,481 | 2,915 | $0.01 | 67 s | claude-haiku-5-5; tool commands: leftovers 3, ls-facts 3, doctor 1, ng-facts 1, skill 1 |
| 6 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 17 | 579,497 | 6,822 | $0.02 | 92 s | claude-haiku-5-5; tool commands: ng-facts 5, leftovers 4, doctor 1, skill 1 |
| 6 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 16 | 476,188 | 3,894 | $0.01 | 78 s | claude-haiku-5-5; tool commands: leftovers 6, ls-facts 3, doctor 1, skill 1 |
| 6 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 15 | 468,820 | 3,514 | $0.01 | 76 s | claude-haiku-5-5; tool commands: leftovers 3, ls-facts 3, doctor 1, ng-facts 1, skill 1 |
