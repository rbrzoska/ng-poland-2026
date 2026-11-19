# Rename benchmark — claude-opus-5-5, claude-opus-5-5 — 2026-11-18

One refactoring on rename/ (scripts/generate-rename.mjs): rename the input `PillComponent.disableTooltip` to `hideHint` everywhere, and nowhere else. The key lists 588 places that must change (binding 362, static 178, class-read 24, template-read 18, style 3, string 2, declaration 1; by element: app-pill 442, app-fancy-pill 62, no element 43, app-status-pill 41) in 141 files, and 385 places where the same word must stay (other-component 231, class-field 86, comment 42, text 26). 6 runs, arms one after another, budget cap $100 per arm. Ranges are lowest–highest over the runs. Every arm works in a copy of the app (a git repository with one commit) with a shell, node and the app's packages; a tool arm also gets its one tool in ../tools and a few lines about it (bench/prompts.mjs); a skill arm gets no such lines: its workspace holds a project skill (.claude/skills/angular-facts: SKILL.md from skill/angular-facts plus the named scripts) that the agent has to pick up on its own; a strict skill arm is the same with the next version of the skill (skill/angular-facts-strict: SKILL.md as written, doctor, leftovers, ajs-facts, reference/ and the named scripts).

How to read this. A run is correct when the compiler reports no error, no target was missed and nothing that had to stay was changed. Only the rename = correct, and no other line of the app differs from the expected app (the task says "do not change anything else"); a file the agent added does not count. Missed targets = places of the key where the old name was not replaced by the new one. Collateral = places with the same word that had to stay and were changed. Other lines = lines of the app that differ from the expected app in something other than the name at a place of the key (a rewritten expression, an edited library file). Trips = requests to the model; tokens sent include the cached ones.

What the numbers can and cannot show. The key comes from the generator's model, not from a tool; before every run it is checked against both trees. No tool has to agree with it: what each tool's rename command leaves when it is run alone is in the table "The tools alone". Of the 588 targets, 183 (178 static, 2 string, 3 style) leave no compiler error when they are missed, so "the compiler is green" proves the other 405 only. Both tools have a `check` command that prints the compiler's errors in a few lines; the arm without a tool reads the raw output of ngc, which is far longer for a broken app, so trips, tokens and cost of that arm include reading it. The app is generated and regular: one signal input, strict templates, one level of inheritance, every component with its own element tag. The result says how the arms do on this app, not how robust a tool is on other code.

| Agent | Runs correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 9–19 | 299,296–767,263 | 3,554–5,569 | $0.31–$0.55 |
| with ng-facts (parser) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 14–16 | 542,366–643,634 | 5,600–6,194 | $0.47–$0.52 |
| with ls-facts (language service) | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 6–18 | 163,934–357,823 | 1,648–3,388 | $0.17–$0.29 |
| skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 16–30 | 504,795–1,016,046 | 4,557–7,794 | $0.40–$0.62 |
| skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 8–9 | 159,891–185,965 | 1,019–1,166 | $0.15–$0.16 |
| skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 7–10 | 160,661–190,609 | 1,009–1,182 | $0.15–$0.17 |
| strict skill with ng-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 9–16 | 263,732–403,381 | 1,550–3,219 | $0.25–$0.36 |
| strict skill with ls-facts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 12–13 | 282,479–325,723 | 1,837–2,087 | $0.26–$0.31 |
| strict skill with both scripts | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 12–13 | 282,813–304,824 | 1,823–1,949 | $0.25–$0.29 |

## The tools alone

One command, no agent, on the untouched app: what an agent of that arm gets for its first tool call.

| Command | Correct | Missed targets | Collateral | Other lines | ngc errors | Time |
|---|---|---|---|---:|---:|---:|
| `node ../tools/ng-facts.mjs rename-input PillComponent.disableTooltip hideHint --root . --write` | **no** | 146 (binding 62, static 38, class-read 24, template-read 17, style 3, string 2; app-fancy-pill 62, app-status-pill 41, no element 41, app-pill 2) | 0 | 0 | 24 | 0.9 s |
| `node ../tools/ls-facts.mjs rename PillComponent.disableTooltip hideHint --root . --write` | **no** | 5 (style 3, string 2; app-fancy-pill 2, app-pill 2, app-status-pill 1) | 0 | 0 | 0 | 12.8 s |

## Runs

| Run | Agent | Correct | Only the rename | Missed targets | Collateral | Other lines | ngc errors | Trips | Tokens sent | Tokens written | Cost | Time | Remarks |
|---:|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 9 | 299,296 | 3,554 | $0.31 | 90 s | claude-opus-5-5 |
| 1 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 16 | 643,634 | 6,194 | $0.52 | 216 s | claude-opus-5-5; tool commands: ng-facts 4 |
| 1 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 18 | 357,823 | 3,131 | $0.29 | 90 s | claude-opus-5-5; tool commands: ls-facts 4 |
| 1 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 30 | 1,016,046 | 7,794 | $0.62 | 253 s | claude-opus-5-5; tool commands: ng-facts 11, skill 1 |
| 1 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 8 | 161,270 | 1,166 | $0.16 | 56 s | claude-opus-5-5; tool commands: ls-facts 3, skill 1 |
| 1 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 9 | 188,583 | 1,182 | $0.16 | 59 s | claude-opus-5-5; tool commands: ls-facts 2, skill 1 |
| 2 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 19 | 767,263 | 5,569 | $0.55 | 126 s | claude-opus-5-5; 1 file added |
| 2 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 15 | 581,526 | 5,605 | $0.47 | 161 s | claude-opus-5-5; tool commands: ng-facts 5 |
| 2 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 6 | 163,934 | 1,648 | $0.17 | 85 s | claude-opus-5-5; tool commands: ls-facts 3 |
| 2 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 16 | 504,795 | 4,557 | $0.40 | 226 s | claude-opus-5-5; tool commands: ng-facts 6, skill 1 |
| 2 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 8 | 185,965 | 1,019 | $0.15 | 54 s | claude-opus-5-5; tool commands: ls-facts 3, skill 1 |
| 2 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 7 | 160,661 | 1,009 | $0.15 | 58 s | claude-opus-5-5; tool commands: ls-facts 3, skill 1 |
| 3 | files, grep and shell | yes | yes | 0 | 0 | 0 | 0 | 10 | 329,597 | 4,619 | $0.36 | 79 s | claude-opus-5-5 |
| 3 | with ng-facts (parser) | yes | yes | 0 | 0 | 0 | 0 | 14 | 542,366 | 5,600 | $0.47 | 151 s | claude-opus-5-5; tool commands: ng-facts 4 |
| 3 | with ls-facts (language service) | yes | yes | 0 | 0 | 0 | 0 | 18 | 324,508 | 3,388 | $0.27 | 95 s | claude-opus-5-5; tool commands: ls-facts 3 |
| 3 | skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 24 | 823,091 | 6,810 | $0.58 | 219 s | claude-opus-5-5; tool commands: ng-facts 7, skill 1 |
| 3 | skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 9 | 159,891 | 1,162 | $0.15 | 59 s | claude-opus-5-5; tool commands: ls-facts 3, skill 1 |
| 3 | skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 10 | 190,609 | 1,135 | $0.17 | 56 s | claude-opus-5-5; tool commands: ls-facts 3, skill 1 |
| 4 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 11 | 346,141 | 2,990 | $0.32 | 81 s | claude-opus-5-5; tool commands: leftovers 4, ng-facts 3, doctor 1, skill 1 |
| 4 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 13 | 290,631 | 1,959 | $0.26 | 65 s | claude-opus-5-5; tool commands: leftovers 3, ls-facts 3, doctor 1, skill 1 |
| 4 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 13 | 287,275 | 1,949 | $0.25 | 90 s | claude-opus-5-5; tool commands: leftovers 3, ls-facts 2, doctor 1, skill 1 |
| 5 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 16 | 403,381 | 3,219 | $0.36 | 70 s | claude-opus-5-5; tool commands: ng-facts 3, leftovers 2, doctor 1, skill 1 |
| 5 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 13 | 325,723 | 2,087 | $0.31 | 67 s | claude-opus-5-5; tool commands: ls-facts 3, leftovers 2, doctor 1, skill 1 |
| 5 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 12 | 282,813 | 1,888 | $0.29 | 57 s | claude-opus-5-5; tool commands: leftovers 2, ls-facts 2, doctor 1, skill 1 |
| 6 | strict skill with ng-facts | yes | yes | 0 | 0 | 0 | 0 | 9 | 263,732 | 1,550 | $0.25 | 54 s | claude-opus-5-5; tool commands: leftovers 2, ng-facts 2, doctor 1, skill 1 |
| 6 | strict skill with ls-facts | yes | yes | 0 | 0 | 0 | 0 | 12 | 282,479 | 1,837 | $0.29 | 55 s | claude-opus-5-5; tool commands: leftovers 2, ls-facts 2, doctor 1, skill 1 |
| 6 | strict skill with both scripts | yes | yes | 0 | 0 | 0 | 0 | 13 | 304,824 | 1,823 | $0.27 | 66 s | claude-opus-5-5; tool commands: leftovers 4, ls-facts 2, doctor 1, skill 1 |
