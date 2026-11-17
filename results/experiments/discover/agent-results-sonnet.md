# Agent benchmark — sonnet — 2026-11-10

Task: same migration as bench/run.mjs, done by Claude Code headless (sonnet, claude-sonnet-5-5, budget cap $3 per arm, 120 feature components, task "discover", 3 runs: 0 with the arms in parallel, 3 one after another). Medians with (min–max) ranges; Time = wall clock from spawn to the agent's final result (an agent waiting on its own hung command pays for it); "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST (formatting does not count, unused extra imports do not count).

| Agent (sonnet) | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost | Correct / 640 | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files + grep only | 63 s (43–749) | 10 (7–14) | 361,622 (255,093–449,610) | 4,793 (3,418–6,277) | $0.20 ($0.15–$0.24) | 420 (300–540) | 220 (100–340) | 220 (100–340) | 0 | 0 | 3/3 |
| with ng-facts | 19 s (17–745) | 3 (3–11) | 96,866 (96,809–383,678) | 771 (712–2,631) | $0.06 ($0.06–$0.16) | 640 | 0 | 0 | 0 | 0 | 3/3 |

**tool arm: 3.3× faster, 3.1× cheaper, 6.2× fewer output tokens, 3.7× fewer input tokens, 3.3× fewer turns** (median of 3 runs)

## Runs

| Run | Agent | Started | Time | Turns | Tool calls | Input tokens | Output tokens | Cost | Correct | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct | Workspace |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | files + grep only | 2026-11-10 07:08 | 63 s | 10 | 9 | 361,622 | 4,793 | $0.20 | 540 | 100 | 100 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-aUltI1/workspace |
| 1 | with ng-facts | 2026-11-10 07:08 | 19 s | 3 | 2 | 96,866 | 712 | $0.06 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-VF8DBc/workspace |
| 2 | files + grep only | 2026-11-10 07:09 | 749 s | 14 | 12 | 449,610 | 6,277 | $0.24 | 420 | 220 | 220 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-NHb8it/workspace |
| 2 | with ng-facts | 2026-11-10 07:09 | 17 s | 3 | 2 | 96,809 | 771 | $0.06 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-tQOTIV/workspace |
| 3 | files + grep only | 2026-11-10 07:22 | 43 s | 7 | 6 | 255,093 | 3,418 | $0.15 | 300 | 340 | 340 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-z7tWgO/workspace |
| 3 | with ng-facts | 2026-11-10 07:22 | 745 s | 11 | 9 | 383,678 | 2,631 | $0.16 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-fQDQp5/workspace |

## Spec written by the tool agent (latest run, 5 lines)

```json
{"component":"PillComponent","inputs":{
"label":{"toContent":true},
"disableTooltip":{"rename":"tooltip","negate":true},
"variant":{"rename":"tone","values":{"info":"neutral","success":"positive","warning":"caution"},
"otherwise":{"pipe":"pillTone","import":"PillTonePipe","from":"src/app/lib/pill-tone.pipe"}}}}
```
