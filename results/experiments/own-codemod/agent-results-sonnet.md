# Agent benchmark — sonnet — 2026-11-10

Task: same migration as bench/run.mjs, done by Claude Code headless (sonnet, claude-sonnet-5-5, budget cap $3 per arm, 120 feature components, task "migrate", 3 runs: 0 with the arms in parallel, 3 one after another). Medians with (min–max) ranges; Time = wall clock from spawn to the agent's final result (an agent waiting on its own hung command pays for it); "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST (formatting does not count, unused extra imports do not count).

| Agent (sonnet) | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost | Correct / 640 | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| own codemod on @angular/compiler (no tool given) | 94 s (93–96) | 7 (6–10) | 295,612 (223,553–402,855) | 9,541 (8,021–10,348) | $0.25 ($0.23–$0.27) | 640 (600–640) | 0 (0–40) | 0 (0–40) | 0 | 0 (0–20) | 2/3 |

## Runs

| Run | Agent | Started | Time | Turns | Tool calls | Input tokens | Output tokens | Cost | Correct | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct | Workspace |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | own codemod on @angular/compiler (no tool given) | 2026-11-10 07:03 | 96 s | 10 | 9 | 402,855 | 8,021 | $0.25 | 600 | 40 | 40 | 0 | 20 | no | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-own-codemod-j1CW3p/workspace |
| 2 | own codemod on @angular/compiler (no tool given) | 2026-11-10 07:05 | 94 s | 6 | 5 | 223,553 | 9,541 | $0.23 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-own-codemod-Emx3bT/workspace |
| 3 | own codemod on @angular/compiler (no tool given) | 2026-11-10 07:06 | 93 s | 7 | 6 | 295,612 | 10,348 | $0.27 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-own-codemod-GuPV0G/workspace |
