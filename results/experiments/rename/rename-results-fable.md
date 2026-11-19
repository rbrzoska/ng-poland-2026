# Rename benchmark — fable, claude-fable-5-1 — 2026-11-18

One refactoring on rename/ (scripts/generate-rename.mjs): rename the input `PillComponent.disableTooltip` to `hideHint` everywhere, and nowhere else. The key lists 588 places that must change (binding 362, static 178, class-read 24, template-read 18, style 3, string 2, declaration 1; by element: app-pill 442, app-fancy-pill 62, no element 43, app-status-pill 41) in 141 files, and 385 places where the same word must stay (other-component 231, class-field 86, comment 42, text 26). 3 runs, arms one after another, budget cap $100 per arm. Ranges are lowest–highest over the runs. Every arm works in a copy of the app (a git repository with one commit) with a shell, node and the app's packages; a tool arm also gets its one tool in ../tools and a few lines about it (bench/prompts.mjs); a skill arm gets no such lines: its workspace holds a project skill (.claude/skills/angular-facts: SKILL.md from skill/angular-facts plus the named scripts) that the agent has to pick up on its own.

How to read this. A run is correct when the compiler reports no error, no target was missed and nothing that had to stay was changed. Only the rename = correct, and no other line of the app differs from the expected app (the task says "do not change anything else"); a file the agent added does not count. Missed targets = places of the key where the old name was not replaced by the new one. Collateral = places with the same word that had to stay and were changed. Other lines = lines of the app that differ from the expected app in something other than the name at a place of the key (a rewritten expression, an edited library file). Trips = requests to the model; tokens sent include the cached ones.

What the numbers can and cannot show. The key comes from the generator's model, not from a tool; before every run it is checked against both trees. No tool has to agree with it: what each tool's rename command leaves when it is run alone is in the table "The tools alone". Of the 588 targets, 183 (178 static, 2 string, 3 style) leave no compiler error when they are missed, so "the compiler is green" proves the other 405 only. Both tools have a `check` command that prints the compiler's errors in a few lines; the arm without a tool reads the raw output of ngc, which is far longer for a broken app, so trips, tokens and cost of that arm include reading it. The app is generated and regular: one signal input, strict templates, one level of inheritance, every component with its own element tag. The result says how the arms do on this app, not how robust a tool is on other code.

| Agent | Runs correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 18–36 | 543,000–917,689 | 9,595–21,995 | $1.67–$2.76 |
| with ng-facts (parser) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 18–32 | 568,877–739,145 | 9,196–14,975 | $1.45–$1.77 |
| with ls-facts (language service) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 19–20 | 309,206–337,770 | 3,344–3,844 | $0.65–$0.76 |
| skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 15–35 | 472,875–626,064 | 5,678–8,909 | $1.00–$1.47 |
| skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 17–19 | 275,976–277,601 | 2,752–3,570 | $0.56–$0.62 |
| skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 13–14 | 250,812–286,926 | 2,787–3,059 | $0.53–$0.59 |

## The tools alone

One command, no agent, on the untouched app: what an agent of that arm gets for its first tool call.

| Command | Correct | Missed targets | Collateral | Other lines | ngc errors | Time |
|---|---|---|---|---:|---:|---:|
| `node ../tools/ng-facts.mjs rename-input PillComponent.disableTooltip hideHint --root . --write` | **no** | 146 (binding 62, static 38, class-read 24, template-read 17, style 3, string 2; app-fancy-pill 62, app-status-pill 41, no element 41, app-pill 2) | 0 | 0 | 24 | 1 s |
| `node ../tools/ls-facts.mjs rename PillComponent.disableTooltip hideHint --root . --write` | **no** | 5 (style 3, string 2; app-fancy-pill 2, app-pill 2, app-status-pill 1) | 0 | 0 | 0 | 9.6 s |

## Runs

| Run | Agent | Correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost | Time | Remarks |
|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 31 | 917,689 | 21,995 | $2.76 | 356 s | claude-fable-5-1 |
| 1 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 20 | 568,877 | 10,083 | $1.45 | 264 s | claude-fable-5-1; tool commands: ng-facts 6 |
| 1 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 19 | 327,992 | 3,344 | $0.68 | 121 s | claude-fable-5-1; tool commands: ls-facts 3 |
| 1 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 15 | 472,875 | 5,678 | $1.00 | 174 s | claude-fable-5-1; tool commands: ng-facts 5, skill 1 |
| 1 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 19 | 276,667 | 2,945 | $0.57 | 97 s | claude-fable-5-1; tool commands: ls-facts 2, skill 1 |
| 1 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 14 | 286,926 | 2,993 | $0.59 | 133 s | claude-fable-5-1; tool commands: ls-facts 2, ng-facts 1, skill 1 |
| 2 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 36 | 561,368 | 11,171 | $1.90 | 192 s | claude-fable-5-1 |
| 2 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 32 | 679,781 | 9,196 | $1.50 | 211 s | claude-fable-5-1; tool commands: ng-facts 6 |
| 2 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 20 | 337,770 | 3,844 | $0.65 | 140 s | claude-fable-5-1; tool commands: ls-facts 4 |
| 2 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 35 | 626,064 | 8,909 | $1.47 | 214 s | claude-fable-5-1; tool commands: ng-facts 6, skill 1 |
| 2 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 17 | 275,976 | 2,752 | $0.56 | 99 s | claude-fable-5-1; tool commands: ls-facts 2, skill 1 |
| 2 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 13 | 250,812 | 2,787 | $0.53 | 109 s | claude-fable-5-1; tool commands: ls-facts 2, skill 1 |
| 3 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 18 | 543,000 | 9,595 | $1.67 | 217 s | claude-fable-5-1 |
| 3 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 18 | 739,145 | 14,975 | $1.77 | 321 s | claude-fable-5-1; tool commands: ng-facts 7 |
| 3 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 20 | 309,206 | 3,784 | $0.76 | 142 s | claude-fable-5-1; tool commands: ls-facts 4 |
| 3 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 28 | 543,057 | 7,310 | $1.22 | 167 s | claude-fable-5-1; tool commands: ng-facts 5, skill 1 |
| 3 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 18 | 277,601 | 3,570 | $0.62 | 84 s | claude-fable-5-1; tool commands: ls-facts 2, skill 1 |
| 3 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 14 | 283,242 | 3,059 | $0.59 | 82 s | claude-fable-5-1; tool commands: ls-facts 2, skill 1 |
