# Benchmark: migrate 120 Angular components to a new component API

The library ships `PillComponent` v2; consumers still use v1, so the workspace does not compile (700 ngc errors).
Migration: `disableTooltip` → `tooltip` (negated), `variant` → `tone` (values mapped, also inside `?:`; non-literal values get the `pillTone` pipe and `PillTonePipe` added to the component's imports), `label` → element content.
Referee: `ngc --strictTemplates`, a line-aligned diff against the correct result, and the Angular compiler's template AST compared element by element with the correct result (formatting-insensitive, expressions compared by structure; also checks each component's `imports` — a missing import counts, an extra unused one is only reported, as Angular itself only warns about it).

| Approach | Time | Lines to change | Correct | Missed | Wrong lines | Files exactly right | ngc errors (strictTemplates) | Elements wrong (compiler AST) | Functionally correct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| find & replace | 34 ms | 640 | 0 | 640 | 1600 | 7/217 | 700 | 940 | ✗ |
| careful regex (tag-scoped) | 23 ms | 640 | 220 | 420 | 280 | 47/217 | 220 | 460 | ✗ |
| Angular compiler + spec (ng-facts migrate) | 63 ms | 640 | 640 | 0 | 0 | 217/217 | 0 | 0 | ✓ |

Reading the consumers to do it by hand: 121 files, ~29,290 tokens. The tool's whole answer: ~36 tokens in 292 ms.
