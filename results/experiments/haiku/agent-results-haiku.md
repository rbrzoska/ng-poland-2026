# Agent benchmark — haiku — 2026-11-10

Task: same migration as bench/run.mjs, done by Claude Code headless (haiku, claude-haiku-5-5, budget cap $3 per arm, 120 feature components, task "migrate", 3 runs: 0 with the arms in parallel, 3 one after another). Medians with (min–max) ranges; Time = wall clock from spawn to the agent's final result (an agent waiting on its own hung command pays for it); "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST (formatting does not count, unused extra imports do not count).

| Agent (haiku) | Time | Turns | Input tokens (incl. cache) | Output tokens | Cost | Correct / 640 | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| files + grep only | 122 s (87–178) | 16 (13–26) | 735,680 (609,971–1,494,022) | 24,662 (15,594–29,384) | $0.03 ($0.02–$0.04) | 420 (280–640) | 220 (0–360) | 220 (0–400) | 0 | 20 (0–20) | 1/3 |
| with ng-facts | 20 s (17–27) | 6 (6–7) | 206,599 (204,639–211,959) | 2,307 (2,027–2,895) | $0.01 ($0.01–$0.01) | 640 | 0 | 0 | 0 | 0 | 3/3 |

**tool arm: 6.1× faster, 4.7× cheaper, 10.7× fewer output tokens, 3.6× fewer input tokens, 2.7× fewer turns** (median of 3 runs)

## Runs

| Run | Agent | Started | Time | Turns | Tool calls | Input tokens | Output tokens | Cost | Correct | Missed | Wrong lines | ngc errors | Elements wrong | Functionally correct | Workspace |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | files + grep only | 2026-11-10 07:36 | 178 s | 26 | 25 | 1,494,022 | 29,384 | $0.04 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-BotFwa/workspace |
| 1 | with ng-facts | 2026-11-10 07:36 | 27 s | 7 | 6 | 211,959 | 2,895 | $0.01 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-4Acmuc/workspace |
| 2 | files + grep only | 2026-11-10 07:39 | 122 s | 13 | 12 | 609,971 | 24,662 | $0.03 | 280 | 360 | 400 | 0 | 20 | no | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-SzfGVF/workspace |
| 2 | with ng-facts | 2026-11-10 07:39 | 20 s | 6 | 5 | 206,599 | 2,307 | $0.01 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-G7idRS/workspace |
| 3 | files + grep only | 2026-11-10 07:41 | 87 s | 16 | 15 | 735,680 | 15,594 | $0.02 | 420 | 220 | 220 | 0 | 20 | no | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-no-tool-DqMVd2/workspace |
| 3 | with ng-facts | 2026-11-10 07:41 | 17 s | 6 | 5 | 204,639 | 2,027 | $0.01 | 640 | 0 | 0 | 0 | 0 | yes | /var/folders/tb/68tnh0pn5619ks87wpp1gqmc0000gp/T/ng-facts-agent-tool-3gKBXl/workspace |

## Spec written by the tool agent (latest run, 12 lines)

```json
{
  "component": "PillComponent",
  "inputs": {
    "disableTooltip": { "rename": "tooltip", "negate": true },
    "variant": {
      "rename": "tone",
      "values": { "info": "neutral", "success": "positive", "warning": "caution" },
      "otherwise": { "pipe": "pillTone", "import": "PillTonePipe", "from": "src/app/lib/pill-tone.pipe" }
    },
    "label": { "toContent": true }
  }
}
```
