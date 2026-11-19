# Rename benchmark — claude-fable-5-2, claude-fable-5-2 — 2026-11-18

One refactoring on rename/ (scripts/generate-rename.mjs): rename the input `PillComponent.disableTooltip` to `hideHint` everywhere, and nowhere else. The key lists 588 places that must change (binding 362, static 178, class-read 24, template-read 18, style 3, string 2, declaration 1; by element: app-pill 442, app-fancy-pill 62, no element 43, app-status-pill 41) in 141 files, and 385 places where the same word must stay (other-component 231, class-field 86, comment 42, text 26). 3 runs, arms one after another, budget cap $100 per arm. Ranges are lowest–highest over the runs. Every arm works in a copy of the app (a git repository with one commit) with a shell, node and the app's packages; a tool arm also gets its one tool in ../tools and a few lines about it (bench/prompts.mjs); a skill arm gets no such lines: its workspace holds a project skill (.claude/skills/angular-facts: SKILL.md from skill/angular-facts plus the named scripts) that the agent has to pick up on its own.

How to read this. A run is correct when the compiler reports no error, no target was missed and nothing that had to stay was changed. Only the rename = correct, and no other line of the app differs from the expected app (the task says "do not change anything else"); a file the agent added does not count. Missed targets = places of the key where the old name was not replaced by the new one. Collateral = places with the same word that had to stay and were changed. Other lines = lines of the app that differ from the expected app in something other than the name at a place of the key (a rewritten expression, an edited library file). Trips = requests to the model; tokens sent include the cached ones.

What the numbers can and cannot show. The key comes from the generator's model, not from a tool; before every run it is checked against both trees. No tool has to agree with it: what each tool's rename command leaves when it is run alone is in the table "The tools alone". Of the 588 targets, 183 (178 static, 2 string, 3 style) leave no compiler error when they are missed, so "the compiler is green" proves the other 405 only. Both tools have a `check` command that prints the compiler's errors in a few lines; the arm without a tool reads the raw output of ngc, which is far longer for a broken app, so trips, tokens and cost of that arm include reading it. The app is generated and regular: one signal input, strict templates, one level of inheritance, every component with its own element tag. The result says how the arms do on this app, not how robust a tool is on other code.

| Agent | Runs correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 9–11 | 333,870–379,616 | 3,389–4,027 | $0.67–$0.98 |
| with ng-facts (parser) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 6–10 | 218,975–440,689 | 3,506–5,145 | $0.62–$0.88 |
| with ls-facts (language service) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 5–6 | 159,462–171,375 | 1,346–1,891 | $0.38–$0.46 |
| skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 9–22 | 270,964–751,179 | 3,707–8,881 | $0.61–$1.05 |
| skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 7–8 | 158,640–162,355 | 1,037–1,356 | $0.27–$0.30 |
| skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 7 | 134,449–165,438 | 1,162–1,236 | $0.27–$0.31 |

## The tools alone

One command, no agent, on the untouched app: what an agent of that arm gets for its first tool call.

| Command | Correct | Missed targets | Collateral | Other lines | ngc errors | Time |
|---|---|---|---|---:|---:|---:|
| `node ../tools/ng-facts.mjs rename-input PillComponent.disableTooltip hideHint --root . --write` | **no** | 146 (binding 62, static 38, class-read 24, template-read 17, style 3, string 2; app-fancy-pill 62, app-status-pill 41, no element 41, app-pill 2) | 0 | 0 | 24 | 1.1 s |
| `node ../tools/ls-facts.mjs rename PillComponent.disableTooltip hideHint --root . --write` | **no** | 5 (style 3, string 2; app-fancy-pill 2, app-pill 2, app-status-pill 1) | 0 | 0 | 0 | 15.2 s |

## Runs

| Run | Agent | Correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost | Time | Remarks |
|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 9 | 379,616 | 4,027 | $0.98 | 114 s | claude-fable-5-2 |
| 1 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 6 | 218,975 | 3,506 | $0.63 | 98 s | claude-fable-5-2; tool commands: ng-facts 3 |
| 1 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 6 | 164,689 | 1,891 | $0.45 | 76 s | claude-fable-5-2; tool commands: ls-facts 2 |
| 1 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 22 | 751,179 | 8,881 | $1.05 | 204 s | claude-fable-5-2; tool commands: ng-facts 4, skill 1 |
| 1 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 7 | 162,355 | 1,311 | $0.30 | 65 s | claude-fable-5-2; tool commands: ls-facts 2, skill 1 |
| 1 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 7 | 134,449 | 1,162 | $0.27 | 50 s | claude-fable-5-2; tool commands: ls-facts 1, skill 1 |
| 2 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 11 | 333,870 | 3,389 | $0.67 | 79 s | claude-fable-5-2 |
| 2 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 10 | 440,689 | 5,145 | $0.88 | 145 s | claude-fable-5-2; tool commands: ng-facts 4 |
| 2 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 5 | 171,375 | 1,430 | $0.46 | 71 s | claude-fable-5-2; tool commands: ls-facts 1 |
| 2 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 10 | 295,567 | 3,707 | $0.61 | 98 s | claude-fable-5-2; tool commands: ng-facts 3, skill 1 |
| 2 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 7 | 158,640 | 1,356 | $0.27 | 58 s | claude-fable-5-2; tool commands: ls-facts 1, skill 1 |
| 2 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 7 | 161,549 | 1,224 | $0.28 | 59 s | claude-fable-5-2; tool commands: ls-facts 2, skill 1 |
| 3 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 10 | 356,081 | 3,495 | $0.87 | 74 s | claude-fable-5-2 |
| 3 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 6 | 225,256 | 3,561 | $0.62 | 92 s | claude-fable-5-2; tool commands: ng-facts 3 |
| 3 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 6 | 159,462 | 1,346 | $0.38 | 74 s | claude-fable-5-2; tool commands: ls-facts 1 |
| 3 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 9 | 270,964 | 3,728 | $0.65 | 93 s | claude-fable-5-2; tool commands: ng-facts 4, skill 1 |
| 3 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 8 | 160,370 | 1,037 | $0.27 | 52 s | claude-fable-5-2; tool commands: ls-facts 2, skill 1 |
| 3 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 7 | 165,438 | 1,236 | $0.31 | 65 s | claude-fable-5-2; tool commands: ls-facts 2, skill 1 |
