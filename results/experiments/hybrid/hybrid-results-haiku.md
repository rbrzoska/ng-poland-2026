# Hybrid benchmark — haiku, claude-haiku-4-5-20251001 — 2026-11-16

Six migration-planning questions about hybrid/, an AngularJS + Angular app joined with ngUpgrade (40 AngularJS components, 4 directives, 8 filters, 12 services, 14 ui-router states, 58 template files and 11 inline templates; 24 Angular components, 10 of them downgraded, 5 UpgradeComponent wrappers). No edits, so there is no compiler error to iterate against. 3 runs, arms one after another, budget cap $3 per arm. Ranges are min–max over the runs. Both arms work in a copy of the app with a shell, node and the typescript and @angular/compiler packages; the tool arm also gets tool/ajs-facts.mjs and is told about it.

How to read this. The answer key comes from the generator's model, and the generator re-derives it from the emitted files with separate scans. The six questions are the ones tool/ajs-facts.mjs was written to answer (TypeScript AST for the registrations, the Angular compiler's HTML and expression parsers for the templates): three are its `list --unused` output and three are columns of `list components`. So the tool arm shows whether an agent finds and relays those facts, and the tool agreeing with the key before every run is a consistency check, not independent evidence. Of the 12 names in the three "nothing uses it" answers, 9 are also mentioned somewhere that does not count (a comment, a CSS class, a spec file, the same name on the Angular side) and 3 are mentioned nowhere else. An array counts as right only when it equals the key exactly, so one slip in a list of 15 names fails that question; the per-run tables show which names were missing or extra.

| Agent | Runs with all six right | Answers right | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| files, grep and shell | 0/3 | 2–3 / 6 | 278–390 s | 5–90 | 144,488–2,476,754 | 2,164–24,857 | $0.63–$1.03 |
| with ajs-facts | 1/3 | 5–6 / 6 | 56–65 s | 9–12 | 237,004–428,185 | 4,045–6,525 | $0.13–$0.13 |

## Answers per run

"missing" = a name of the key that the agent did not give, "extra" = a name the agent gave that is not in the key; for the count the wrong number is shown.

### Run 1

| Question | Key | files, grep and shell | with ajs-facts |
|---|---:|---|---|
| deadComponents | 6 names | missing: helmetRack, patrolLog; extra: supplyOverview | right |
| leafComponents | 15 names | missing: centurionCard, cohortBanner, legionStats; extra: cohortRow, helmetRack, patrolLogEntry, supplyCrate | missing: centurionCard, legionStats, supplyGauge |
| standardBearerElements | 9 | right | right |
| unusedFilters | 3 names | right | right |
| twinComponents | 5 names | missing: amountInput, standardBearer, tentRow | right |
| unusedServices | 3 names | missing: messengerQueue, standardsRegistry, tentAllocator; extra: featureFlags | right |

### Run 2

| Question | Key | files, grep and shell | with ajs-facts |
|---|---:|---|---|
| deadComponents | 6 names | missing: cohortBanner, denariiLedger, helmetRack, patrolLog, shieldWall, tentInspector; extra: helmetBadge, legionRoster, reportPanel | right |
| leafComponents | 15 names | missing: centurionCard, grainStore, legionStats, supplyGauge; extra: denariiLedger | missing: campHeader, legionStats, rationSummary, standardBearer |
| standardBearerElements | 9 | right | right |
| unusedFilters | 3 names | right | right |
| twinComponents | 5 names | right | right |
| unusedServices | 3 names | missing: tentAllocator | right |

### Run 3

| Question | Key | files, grep and shell | with ajs-facts |
|---|---:|---|---|
| deadComponents | 6 names | missing: cohortBanner, helmetRack, patrolLog, tentInspector | right |
| leafComponents | 15 names | missing: amountInput, campHeader, centurionCard, cohortBanner, gladiusCounter, grainStore, helmetIcon, legionStats, pagerControl, rationSummary, shieldBadge, standardBearer, supplyGauge, tentRow | right |
| standardBearerElements | 9 | right | right |
| unusedFilters | 3 names | missing: shortDate | right |
| twinComponents | 5 names | right | right |
| unusedServices | 3 names | missing: tentAllocator; extra: legacyReports | right |
