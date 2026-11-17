# Hybrid benchmark — fable, claude-fable-5-1 — 2026-11-16

Six migration-planning questions about hybrid/, an AngularJS + Angular app joined with ngUpgrade (40 AngularJS components, 4 directives, 8 filters, 12 services, 14 ui-router states, 58 template files and 11 inline templates; 24 Angular components, 10 of them downgraded, 5 UpgradeComponent wrappers). No edits, so there is no compiler error to iterate against. 3 runs, arms one after another, budget cap $3 per arm. Ranges are min–max over the runs. Both arms work in a copy of the app with a shell, node and the typescript and @angular/compiler packages; the tool arm also gets tool/ajs-facts.mjs and is told about it.

How to read this. The answer key comes from the generator's model, and the generator re-derives it from the emitted files with separate scans. The six questions are the ones tool/ajs-facts.mjs was written to answer (TypeScript AST for the registrations, the Angular compiler's HTML and expression parsers for the templates): three are its `list --unused` output and three are columns of `list components`. So the tool arm shows whether an agent finds and relays those facts, and the tool agreeing with the key before every run is a consistency check, not independent evidence. Of the 12 names in the three "nothing uses it" answers, 9 are also mentioned somewhere that does not count (a comment, a CSS class, a spec file, the same name on the Angular side) and 3 are mentioned nowhere else. An array counts as right only when it equals the key exactly, so one slip in a list of 15 names fails that question; the per-run tables show which names were missing or extra.

| Agent | Runs with all six right | Answers right | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 3/3 | 6 / 6 | 119–121 s | 8 | 359,407–423,705 | 8,131–8,698 | $1.79–$1.91 |
| with ajs-facts | 2/3 | 5–6 / 6 | 60–73 s | 6–11 | 198,646–211,405 | 3,342–4,121 | $0.71–$0.83 |

## Answers per run

"missing" = a name of the key that the agent did not give, "extra" = a name the agent gave that is not in the key; for the count the wrong number is shown.

### Run 1

| Question | Key | files, grep and shell | with ajs-facts |
|---|---:|---|---|
| deadComponents | 6 names | right | right |
| leafComponents | 15 names | right | missing: cohortBanner |
| standardBearerElements | 9 | right | right |
| unusedFilters | 3 names | right | right |
| twinComponents | 5 names | right | right |
| unusedServices | 3 names | right | right |

### Run 2

| Question | Key | files, grep and shell | with ajs-facts |
|---|---:|---|---|
| deadComponents | 6 names | right | right |
| leafComponents | 15 names | right | right |
| standardBearerElements | 9 | right | right |
| unusedFilters | 3 names | right | right |
| twinComponents | 5 names | right | right |
| unusedServices | 3 names | right | right |

### Run 3

| Question | Key | files, grep and shell | with ajs-facts |
|---|---:|---|---|
| deadComponents | 6 names | right | right |
| leafComponents | 15 names | right | right |
| standardBearerElements | 9 | right | right |
| unusedFilters | 3 names | right | right |
| twinComponents | 5 names | right | right |
| unusedServices | 3 names | right | right |
