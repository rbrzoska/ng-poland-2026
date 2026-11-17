# Agent benchmark — sonnet — 2026-11-10

Task: same migration as bench/run.mjs, done by Claude Code headless (sonnet, claude-sonnet-5-5, budget cap $3 per arm, 480 feature components, task "migrate", 3 runs: 0 with the arms in parallel, 3 one after another). Medians with (min–max) ranges; Time = wall clock from spawn to the agent's final result (an agent waiting on its own hung command pays for it); "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST (formatting does not count, unused extra imports do not count).

| Agent (sonnet) | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost | Correct / 2560 | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files + grep only | 187 s (57–737) | 11 (10–13) | 459,429 (320,049–554,041) | 5,485 (4,065–5,542) | $0.27 ($0.19–$0.29) | 1,360 (80–1,760) | 1,200 (800–2,480) | 1,200 (800–2,640) | 0 | 0 | 3/3 |
| with ng-facts | 163 s (23–737) | 10 (4–11) | 341,196 (129,137–390,007) | 1,900 (898–1,957) | $0.14 ($0.07–$0.17) | 2,560 | 0 | 0 | 0 | 0 | 3/3 |

**tool arm: 1.1× faster, 1.9× cheaper, 2.9× fewer output tokens, 1.3× fewer input tokens, 1.1× fewer turns** (median of 3 runs)

## Runs

| Run | Agent | Started | Time | Turns | Tool calls | Input tokens | Output tokens | Cost | Correct | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct | Workspace |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | files + grep only | 2026-11-10 06:31 | 57 s | 10 | 9 | 320,049 | 4,065 | $0.19 | 80 | 2480 | 2640 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-ceHMBa/workspace |
| 1 | with ng-facts | 2026-11-10 06:31 | 163 s | 10 | 9 | 341,196 | 1,900 | $0.14 | 2560 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-eRWBMx/workspace |
| 2 | files + grep only | 2026-11-10 06:35 | 737 s | 13 | 11 | 554,041 | 5,485 | $0.29 | 1360 | 1200 | 1200 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-xoxvGw/workspace |
| 2 | with ng-facts | 2026-11-10 06:35 | 23 s | 4 | 3 | 129,137 | 898 | $0.07 | 2560 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-t4wi1o/workspace |
| 3 | files + grep only | 2026-11-10 06:48 | 187 s | 11 | 10 | 459,429 | 5,542 | $0.27 | 1760 | 800 | 800 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-S0pxxq/workspace |
| 3 | with ng-facts | 2026-11-10 06:48 | 737 s | 11 | 9 | 390,007 | 1,957 | $0.17 | 2560 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-zX0pTL/workspace |

## Spec written by the tool agent (latest run, 4 lines)

```json
{"component":"PillComponent","inputs":{
"disableTooltip":{"rename":"tooltip","negate":true},
"variant":{"rename":"tone","values":{"info":"neutral","success":"positive","warning":"caution"},"otherwise":{"pipe":"pillTone","import":"PillTonePipe","from":"src/app/lib/pill-tone.pipe"}},
"label":{"toContent":true}}}
```
