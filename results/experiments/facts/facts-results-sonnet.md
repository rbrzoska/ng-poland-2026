# Facts benchmark — sonnet, claude-sonnet-5-5 — 2026-11-10

Six impact-analysis questions about `<app-pill>` in fixture/ (no edits, so no compiler error to iterate against), 5 runs, arms one after another, budget cap $2 per arm. Ranges are min–max over the runs. The answer key is derived from the generator's template styles and cross-checked against the compiler's AST.

| Agent | Runs with all six right | Answers right | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| files + grep only | 3/5 | 5–6 / 6 | 30–750 s | 5–11 | 182,634–397,924 | 2,431–5,189 | $0.13–$0.20 |
| with ng-facts | 5/5 | 6 / 6 | 22–27 s | 4–6 | 132,386–170,459 | 1,209–1,504 | $0.08–$0.10 |

## Answers per run

| Question | Key | files + grep only | with ng-facts |
|---|---:|---|---|
| pillElements | 440 | 440, 440, 440, 440, 440 | 440, 440, 440, 440, 440 |
| pillElementsInInlineTemplates | 120 | 120, 120, 120, 120, 120 | 120, 120, 120, 120, 120 |
| disableTooltipBindingsElsewhere | 200 | 200, 200, 200, 200, 200 | 200, 200, 200, 200, 200 |
| pillsWithLiteralWarning | 100 | 100, 100, 100, 60, 60 | 100, 100, 100, 100, 100 |
| pillsWithNonLiteralVariant | 80 | 80, 80, 80, 80, 80 | 80, 80, 80, 80, 80 |
| pillsWithoutVariant | 100 | 100, 100, 100, 100, 100 | 100, 100, 100, 100, 100 |
