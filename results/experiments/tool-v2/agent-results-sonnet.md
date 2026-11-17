# Agent benchmark — sonnet — 2026-11-10

Task: same migration as bench/run.mjs, done by Claude Code headless (sonnet, claude-sonnet-5-5, budget cap $3 per arm, 120 feature components, task "migrate", 5 runs: 0 with the arms in parallel, 5 one after another). Medians with (min–max) ranges; Time = wall clock from spawn to the agent's final result (an agent waiting on its own hung command pays for it); "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST (formatting does not count, unused extra imports do not count).

| Agent (sonnet) | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost | Correct / 640 | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| with ng-facts v2 (inline spec, built-in check) | 12 s (9–17) | 2 | 63,362 (63,348–63,373) | 296 (265–298) | $0.05 ($0.05–$0.05) | 640 | 0 | 0 | 0 | 0 | 5/5 |

## Runs

| Run | Agent | Started | Time | Turns | Tool calls | Input tokens | Output tokens | Cost | Correct | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct | Workspace |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | with ng-facts v2 (inline spec, built-in check) | 2026-11-10 08:50 | 12 s | 2 | 1 | 63,368 | 265 | $0.05 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-v2-3IRG0b/workspace |
| 2 | with ng-facts v2 (inline spec, built-in check) | 2026-11-10 08:50 | 17 s | 2 | 1 | 63,348 | 298 | $0.05 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-v2-nApobF/workspace |
| 3 | with ng-facts v2 (inline spec, built-in check) | 2026-11-10 08:51 | 9 s | 2 | 1 | 63,362 | 298 | $0.05 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-v2-IgjiE6/workspace |
| 4 | with ng-facts v2 (inline spec, built-in check) | 2026-11-10 08:51 | 15 s | 2 | 1 | 63,362 | 296 | $0.05 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-v2-eMZQwp/workspace |
| 5 | with ng-facts v2 (inline spec, built-in check) | 2026-11-10 08:51 | 9 s | 2 | 1 | 63,373 | 283 | $0.05 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-v2-pg3eJg/workspace |
