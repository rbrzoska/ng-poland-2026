# Rename benchmark — sonnet, claude-sonnet-5 — 2026-11-18

One refactoring on rename/ (scripts/generate-rename.mjs): rename the input `PillComponent.disableTooltip` to `hideHint` everywhere, and nowhere else. The key lists 588 places that must change (binding 362, static 178, class-read 24, template-read 18, style 3, string 2, declaration 1; by element: app-pill 442, app-fancy-pill 62, no element 43, app-status-pill 41) in 141 files, and 385 places where the same word must stay (other-component 231, class-field 86, comment 42, text 26). 6 runs, arms one after another, budget cap $100 per arm. Ranges are lowest–highest over the runs. Every arm works in a copy of the app (a git repository with one commit) with a shell, node and the app's packages; a tool arm also gets its one tool in ../tools and a few lines about it (bench/prompts.mjs); a skill arm gets no such lines: its workspace holds a project skill (.claude/skills/angular-facts: SKILL.md from skill/angular-facts plus the named scripts) that the agent has to pick up on its own.

How to read this. A run is correct when the compiler reports no error, no target was missed and nothing that had to stay was changed. Only the rename = correct, and no other line of the app differs from the expected app (the task says "do not change anything else"); a file the agent added does not count. Missed targets = places of the key where the old name was not replaced by the new one. Collateral = places with the same word that had to stay and were changed. Other lines = lines of the app that differ from the expected app in something other than the name at a place of the key (a rewritten expression, an edited library file). Trips = requests to the model; tokens sent include the cached ones.

What the numbers can and cannot show. The key comes from the generator's model, not from a tool; before every run it is checked against both trees. No tool has to agree with it: what each tool's rename command leaves when it is run alone is in the table "The tools alone". Of the 588 targets, 183 (178 static, 2 string, 3 style) leave no compiler error when they are missed, so "the compiler is green" proves the other 405 only. Both tools have a `check` command that prints the compiler's errors in a few lines; the arm without a tool reads the raw output of ngc, which is far longer for a broken app, so trips, tokens and cost of that arm include reading it. The app is generated and regular: one signal input, strict templates, one level of inheritance, every component with its own element tag. The result says how the arms do on this app, not how robust a tool is on other code.

| Agent | Runs correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 4/6 | 4/6 | 0–62 | 0 | 0 | 0–3 | 31–58 | 685,226–3,566,791 | 21,651–27,398 | $0.84–$3.09 |
| with ng-facts (parser) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 45–78 | 2,196,286–3,527,058 | 19,878–28,552 | $0.87–$1.31 |
| with ls-facts (language service) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 15–18 | 870,461–1,227,021 | 4,027–5,539 | $0.43–$0.53 |
| skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 62–96 | 2,605,686–3,541,678 | 18,188–26,055 | $1.05–$1.28 |
| skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 16–22 | 439,694–572,657 | 4,282–4,680 | $0.21–$0.25 |
| skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 19–26 | 542,199–675,799 | 4,214–6,088 | $0.24–$0.28 |

## The tools alone

One command, no agent, on the untouched app: what an agent of that arm gets for its first tool call.

| Command | Correct | Missed targets | Collateral | Other lines | ngc errors | Time |
|---|---|---|---|---:|---:|---:|
| `node ../tools/ng-facts.mjs rename-input PillComponent.disableTooltip hideHint --root . --write` | **no** | 146 (binding 62, static 38, class-read 24, template-read 17, style 3, string 2; app-fancy-pill 62, app-status-pill 41, no element 41, app-pill 2) | 0 | 0 | 24 | 1 s |
| `node ../tools/ls-facts.mjs rename PillComponent.disableTooltip hideHint --root . --write` | **no** | 5 (style 3, string 2; app-fancy-pill 2, app-pill 2, app-status-pill 1) | 0 | 0 | 0 | 9.7 s |

## Runs

| Run | Agent | Correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost | Time | Remarks |
|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | files, grep and shell | **no** | **no** | 14 (binding 8, static 5, class-read 1; app-pill 10, app-fancy-pill 2, app-status-pill 1, no element 1) | 0 | 0 | 1 | 35 | 685,226 | 21,760 | $3.09 | 329 s | claude-sonnet-5; ended with an error: agent reported an error |
| 1 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 45 | 2,196,286 | 19,878 | $0.87 | 260 s | claude-sonnet-5; tool commands: ng-facts 4 |
| 1 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 18 | 1,107,414 | 5,539 | $0.52 | 115 s | claude-sonnet-5; tool commands: ls-facts 3 |
| 2 | files, grep and shell | **no** | **no** | 62 (binding 36, static 21, class-read 3, template-read 2; app-pill 45, app-fancy-pill 7, app-status-pill 5, no element 5) | 0 | 0 | 3 | 31 | 978,739 | 26,898 | $3.06 | 377 s | claude-sonnet-5 |
| 2 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 67 | 3,527,058 | 25,052 | $1.29 | 348 s | claude-sonnet-5; tool commands: ng-facts 8 |
| 2 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 15 | 870,461 | 4,027 | $0.43 | 92 s | claude-sonnet-5; tool commands: ls-facts 3 |
| 3 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 46 | 2,879,670 | 21,800 | $1.17 | 301 s | claude-sonnet-5 |
| 3 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 78 | 3,461,497 | 28,552 | $1.31 | 401 s | claude-sonnet-5; tool commands: ng-facts 9 |
| 3 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 18 | 1,227,021 | 4,726 | $0.53 | 123 s | claude-sonnet-5; tool commands: ls-facts 5 |
| 4 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 39 | 1,645,046 | 25,229 | $0.89 | 326 s | claude-sonnet-5 |
| 4 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 62 | 3,189,739 | 18,188 | $1.14 | 343 s | claude-sonnet-5; tool commands: ng-facts 8, skill 1 |
| 4 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 22 | 572,657 | 4,680 | $0.25 | 99 s | claude-sonnet-5; tool commands: ls-facts 2, skill 1 |
| 4 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 26 | 571,492 | 6,088 | $0.28 | 122 s | claude-sonnet-5; tool commands: ls-facts 3, ng-facts 1, skill 1 |
| 5 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 58 | 3,566,791 | 27,398 | $1.32 | 508 s | claude-sonnet-5; 1 file added |
| 5 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 96 | 2,605,686 | 24,904 | $1.05 | 347 s | claude-sonnet-5; tool commands: ng-facts 10, skill 1 |
| 5 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 19 | 533,668 | 4,282 | $0.24 | 107 s | claude-sonnet-5; tool commands: ls-facts 3, skill 1 |
| 5 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 19 | 675,799 | 4,494 | $0.28 | 107 s | claude-sonnet-5; tool commands: ls-facts 2, skill 1 |
| 6 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 48 | 1,779,857 | 21,651 | $0.84 | 270 s | claude-sonnet-5 |
| 6 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 71 | 3,541,678 | 26,055 | $1.28 | 383 s | claude-sonnet-5; tool commands: ng-facts 10, skill 1 |
| 6 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 16 | 439,694 | 4,337 | $0.21 | 103 s | claude-sonnet-5; tool commands: ls-facts 3, skill 1 |
| 6 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 19 | 542,199 | 4,214 | $0.24 | 119 s | claude-sonnet-5; tool commands: ls-facts 4, skill 1 |
