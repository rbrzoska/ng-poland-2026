# Rename benchmark — opus, claude-opus-5 — 2026-11-18

One refactoring on rename/ (scripts/generate-rename.mjs): rename the input `PillComponent.disableTooltip` to `hideHint` everywhere, and nowhere else. The key lists 588 places that must change (binding 362, static 178, class-read 24, template-read 18, style 3, string 2, declaration 1; by element: app-pill 442, app-fancy-pill 62, no element 43, app-status-pill 41) in 141 files, and 385 places where the same word must stay (other-component 231, class-field 86, comment 42, text 26). 6 runs, arms one after another, budget cap $100 per arm. Ranges are lowest–highest over the runs. Every arm works in a copy of the app (a git repository with one commit) with a shell, node and the app's packages; a tool arm also gets its one tool in ../tools and a few lines about it (bench/prompts.mjs); a skill arm gets no such lines: its workspace holds a project skill (.claude/skills/angular-facts: SKILL.md from skill/angular-facts plus the named scripts) that the agent has to pick up on its own.

How to read this. A run is correct when the compiler reports no error, no target was missed and nothing that had to stay was changed. Only the rename = correct, and no other line of the app differs from the expected app (the task says "do not change anything else"); a file the agent added does not count. Missed targets = places of the key where the old name was not replaced by the new one. Collateral = places with the same word that had to stay and were changed. Other lines = lines of the app that differ from the expected app in something other than the name at a place of the key (a rewritten expression, an edited library file). Trips = requests to the model; tokens sent include the cached ones.

What the numbers can and cannot show. The key comes from the generator's model, not from a tool; before every run it is checked against both trees. No tool has to agree with it: what each tool's rename command leaves when it is run alone is in the table "The tools alone". Of the 588 targets, 183 (178 static, 2 string, 3 style) leave no compiler error when they are missed, so "the compiler is green" proves the other 405 only. Both tools have a `check` command that prints the compiler's errors in a few lines; the arm without a tool reads the raw output of ngc, which is far longer for a broken app, so trips, tokens and cost of that arm include reading it. The app is generated and regular: one signal input, strict templates, one level of inheritance, every component with its own element tag. The result says how the arms do on this app, not how robust a tool is on other code.

| Agent | Runs correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 25–41 | 1,075,623–1,339,057 | 13,879–16,328 | $1.31–$1.60 |
| with ng-facts (parser) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 23–44 | 814,625–1,700,502 | 17,308–21,878 | $1.39–$1.91 |
| with ls-facts (language service) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 17–20 | 290,026–453,012 | 3,967–4,682 | $0.43–$0.67 |
| skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 36–44 | 1,114,008–1,383,886 | 13,289–15,100 | $1.29–$1.51 |
| skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 15–27 | 386,071–834,789 | 3,544–5,530 | $0.46–$0.86 |
| skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 19–24 | 432,072–536,837 | 5,366–6,071 | $0.59–$0.71 |

## The tools alone

One command, no agent, on the untouched app: what an agent of that arm gets for its first tool call.

| Command | Correct | Missed targets | Collateral | Other lines | ngc errors | Time |
|---|---|---|---|---:|---:|---:|
| `node ../tools/ng-facts.mjs rename-input PillComponent.disableTooltip hideHint --root . --write` | **no** | 146 (binding 62, static 38, class-read 24, template-read 17, style 3, string 2; app-fancy-pill 62, app-status-pill 41, no element 41, app-pill 2) | 0 | 0 | 24 | 1 s |
| `node ../tools/ls-facts.mjs rename PillComponent.disableTooltip hideHint --root . --write` | **no** | 5 (style 3, string 2; app-fancy-pill 2, app-pill 2, app-status-pill 1) | 0 | 0 | 0 | 9.7 s |

## Runs

| Run | Agent | Correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost | Time | Remarks |
|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 41 | 1,224,832 | 16,328 | $1.60 | 224 s | claude-opus-5 |
| 1 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 23 | 814,625 | 18,082 | $1.39 | 257 s | claude-opus-5; tool commands: ng-facts 5 |
| 1 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 20 | 410,441 | 4,682 | $0.53 | 112 s | claude-opus-5; tool commands: ls-facts 5 |
| 2 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 27 | 1,339,057 | 15,809 | $1.58 | 254 s | claude-opus-5 |
| 2 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 42 | 1,426,674 | 17,308 | $1.69 | 274 s | claude-opus-5; tool commands: ng-facts 8 |
| 2 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 17 | 290,026 | 3,967 | $0.43 | 86 s | claude-opus-5; tool commands: ls-facts 3 |
| 3 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 25 | 1,075,623 | 13,879 | $1.31 | 211 s | claude-opus-5 |
| 3 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 44 | 1,700,502 | 21,878 | $1.91 | 329 s | claude-opus-5; tool commands: ng-facts 11 |
| 3 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 17 | 453,012 | 4,397 | $0.67 | 104 s | claude-opus-5; tool commands: ls-facts 3 |
| 4 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 44 | 1,383,886 | 15,100 | $1.51 | 231 s | claude-opus-5; tool commands: ng-facts 7, skill 1 |
| 4 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 18 | 524,296 | 4,795 | $0.62 | 119 s | claude-opus-5; tool commands: ls-facts 2, skill 1 |
| 4 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 19 | 442,245 | 5,366 | $0.59 | 121 s | claude-opus-5; tool commands: ls-facts 3, ng-facts 1, skill 1 |
| 5 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 39 | 1,162,752 | 14,734 | $1.41 | 226 s | claude-opus-5; tool commands: ng-facts 9, skill 1 |
| 5 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 15 | 386,071 | 3,544 | $0.46 | 90 s | claude-opus-5; tool commands: ls-facts 3, skill 1 |
| 5 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 20 | 536,837 | 6,071 | $0.71 | 140 s | claude-opus-5; tool commands: ls-facts 2, ng-facts 2, skill 1 |
| 6 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 36 | 1,114,008 | 13,289 | $1.29 | 224 s | claude-opus-5; tool commands: ng-facts 7, skill 1 |
| 6 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 27 | 834,789 | 5,530 | $0.86 | 134 s | claude-opus-5; tool commands: ls-facts 3, skill 1 |
| 6 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 24 | 432,072 | 5,466 | $0.64 | 107 s | claude-opus-5; tool commands: ls-facts 2, ng-facts 1, skill 1 |
