# Agent benchmark — sonnet — 2026-11-10

Task: same migration as bench/run.mjs, done by Claude Code headless (sonnet, claude-sonnet-5-5, budget cap $3 per arm, 120 feature components, task "migrate", 8 runs: 3 with the arms in parallel, 5 one after another). Medians with (min–max) ranges; Time = wall clock from spawn to the agent's final result (an agent waiting on its own hung command pays for it); "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST (formatting does not count, unused extra imports do not count).

| Agent (sonnet) | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost | Correct / 640 | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files + grep only | 58 s (45–742) | 10 (8–17) | 288,317 (251,454–651,722) | 4,956 (3,253–7,818) | $0.19 ($0.17–$0.32) | 490 (400–560) | 150 (80–240) | 150 (80–240) | 0 | 0 | 8/8 |
| with ng-facts | 26 s (14–735) | 4 (3–28) | 129,540 (95,698–1,605,901) | 773 (486–11,033) | $0.07 ($0.06–$0.65) | 640 | 0 | 0 | 0 | 0 | 8/8 |

**tool arm: 2.3× faster, 2.7× cheaper, 6.4× fewer output tokens, 2.2× fewer input tokens, 2.4× fewer turns** (median of 8 runs)

## Runs

| Run | Agent | Started | Time | Turns | Tool calls | Input tokens | Output tokens | Cost | Correct | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct | Workspace |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | files + grep only | 2026-11-03 09:39 | 59 s | 10 | 9 | 296,052 | 5,340 | $0.18 | 540 | 100 | 100 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-VH73qI/workspace |
| 1 | with ng-facts | 2026-11-03 09:39 | 30 s | 4 | 3 | 129,409 | 552 | $0.07 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-7dX9WL/workspace |
| 2 | files + grep only | 2026-11-03 09:40 | 201 s | 17 | 16 | 651,722 | 7,818 | $0.32 | 560 | 80 | 80 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-7Dh4i0/workspace |
| 2 | with ng-facts | 2026-11-03 09:40 | 24 s | 4 | 3 | 129,671 | 745 | $0.07 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-AV1UUp/workspace |
| 3 | files + grep only | 2026-11-03 09:43 | 742 s | 13 | 11 | 427,824 | 5,086 | $0.22 | 400 | 240 | 240 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-ym0O3O/workspace |
| 3 | with ng-facts | 2026-11-03 09:43 | 27 s | 6 | 5 | 164,559 | 996 | $0.08 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-QPV3po/workspace |
| 4 | files + grep only | 2026-11-10 05:39 | 51 s | 8 | 7 | 273,184 | 4,940 | $0.19 | 440 | 200 | 200 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-Hovd9Z/workspace |
| 4 | with ng-facts | 2026-11-10 05:39 | 705 s | 28 | 27 | 1,605,901 | 11,033 | $0.65 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-smHmg4/workspace |
| 5 | files + grep only | 2026-11-10 05:52 | 168 s | 9 | 8 | 275,424 | 4,972 | $0.19 | 540 | 100 | 100 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-4Gj6nb/workspace |
| 5 | with ng-facts | 2026-11-10 05:52 | 14 s | 3 | 2 | 95,698 | 486 | $0.06 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-eKbBYW/workspace |
| 6 | files + grep only | 2026-11-10 05:55 | 45 s | 8 | 7 | 280,582 | 3,253 | $0.18 | 400 | 240 | 240 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-hU2JYM/workspace |
| 6 | with ng-facts | 2026-11-10 05:55 | 17 s | 4 | 3 | 128,924 | 801 | $0.07 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-ca5g4S/workspace |
| 7 | files + grep only | 2026-11-10 05:56 | 55 s | 9 | 8 | 251,454 | 4,774 | $0.17 | 560 | 80 | 80 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-aJ0qg0/workspace |
| 7 | with ng-facts | 2026-11-10 05:56 | 18 s | 3 | 2 | 95,865 | 651 | $0.06 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-4lye6B/workspace |
| 8 | files + grep only | 2026-11-10 05:57 | 57 s | 10 | 9 | 309,841 | 4,877 | $0.19 | 420 | 220 | 220 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-jyllLQ/workspace |
| 8 | with ng-facts | 2026-11-10 05:57 | 735 s | 5 | 3 | 163,562 | 1,108 | $0.09 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-nd1UMc/workspace |

## Spec written by the tool agent (latest run, 4 lines)

```json
{"component":"PillComponent","inputs":{
"disableTooltip":{"rename":"tooltip","negate":true},
"variant":{"rename":"tone","values":{"info":"neutral","success":"positive","warning":"caution"},"otherwise":{"pipe":"pillTone","import":"PillTonePipe","from":"src/app/lib/pill-tone.pipe"}},
"label":{"toContent":true}}}
```
