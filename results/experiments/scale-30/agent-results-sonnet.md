# Agent benchmark — sonnet — 2026-11-10

Task: same migration as bench/run.mjs, done by Claude Code headless (sonnet, claude-sonnet-5-5, budget cap $3 per arm, 30 feature components, task "migrate", 3 runs: 0 with the arms in parallel, 3 one after another). Medians with (min–max) ranges; Time = wall clock from spawn to the agent's final result (an agent waiting on its own hung command pays for it); "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST (formatting does not count, unused extra imports do not count).

| Agent (sonnet) | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost | Correct / 160 | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files + grep only | 61 s (56–61) | 9 (8–10) | 293,778 (274,117–328,781) | 4,741 (4,677–4,819) | $0.20 ($0.19–$0.22) | 120 (110–135) | 40 (25–50) | 40 (25–60) | 0 | 0 | 3/3 |
| with ng-facts | 13 s (12–15) | 3 | 95,637 (95,636–95,778) | 449 (441–567) | $0.06 ($0.06–$0.06) | 160 | 0 | 0 | 0 | 0 | 3/3 |

**tool arm: 4.7× faster, 3.6× cheaper, 10.6× fewer output tokens, 3.1× fewer input tokens, 3× fewer turns** (median of 3 runs)

## Runs

| Run | Agent | Started | Time | Turns | Tool calls | Input tokens | Output tokens | Cost | Correct | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct | Workspace |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | files + grep only | 2026-11-10 06:27 | 61 s | 9 | 8 | 293,778 | 4,741 | $0.20 | 120 | 40 | 40 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-pisKlS/workspace |
| 1 | with ng-facts | 2026-11-10 06:27 | 12 s | 3 | 2 | 95,637 | 441 | $0.06 | 160 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-zxemnz/workspace |
| 2 | files + grep only | 2026-11-10 06:29 | 56 s | 10 | 9 | 328,781 | 4,819 | $0.22 | 110 | 50 | 60 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-h3Ladu/workspace |
| 2 | with ng-facts | 2026-11-10 06:29 | 13 s | 3 | 2 | 95,778 | 567 | $0.06 | 160 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-2Y0pNm/workspace |
| 3 | files + grep only | 2026-11-10 06:30 | 61 s | 8 | 7 | 274,117 | 4,677 | $0.19 | 135 | 25 | 25 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-jYpumy/workspace |
| 3 | with ng-facts | 2026-11-10 06:30 | 15 s | 3 | 2 | 95,636 | 449 | $0.06 | 160 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-2BCKya/workspace |

## Spec written by the tool agent (latest run, 4 lines)

```json
{"component":"PillComponent","inputs":{
"disableTooltip":{"rename":"tooltip","negate":true},
"variant":{"rename":"tone","values":{"info":"neutral","success":"positive","warning":"caution"},"otherwise":{"pipe":"pillTone","import":"PillTonePipe","from":"src/app/lib/pill-tone.pipe"}},
"label":{"toContent":true}}}
```
