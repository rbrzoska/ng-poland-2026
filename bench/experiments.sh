#!/bin/sh
# The full evidence series behind the talk's numbers. Costs API money (roughly $15–20 on Sonnet) and takes 2–3 hours:
# every arm runs one after another so the wall-clock times do not share a rate limit or a CPU.
#   sh bench/experiments.sh            # everything
#   sh bench/experiments.sh facts      # one block: baseline | facts | scale | own-codemod | discover | haiku | atlas | v2 | hybrid
# The hybrid block (AngularJS + Angular app, bench/hybrid.mjs) runs on three models, three runs each, capped at $3 per arm.
# Afterwards: node bench/evidence.mjs (the table), node deck/evidence-slides.mjs and node deck/five-min.mjs (the slides).
set -u
cd "$(dirname "$0")/.."
only="${1:-all}"
wants() { [ "$only" = all ] || [ "$only" = "$1" ]; }

wants baseline    && node bench/agent.mjs --runs 5
wants facts       && node bench/facts.mjs --runs 5
wants scale       && node bench/agent.mjs --experiment scale-30 --features 30 --runs 3
wants scale       && node bench/agent.mjs --experiment scale-480 --features 480 --runs 3
wants own-codemod && node bench/agent.mjs --experiment own-codemod --arms own-codemod --runs 3
wants discover    && node bench/agent.mjs --experiment discover --task discover --runs 3
wants haiku       && node bench/agent.mjs --experiment haiku --model haiku --runs 3
wants atlas       && node bench/atlas.mjs --task blast --runs 5
wants atlas       && node bench/atlas.mjs --task a11y --runs 5
wants v2          && node bench/atlas.mjs --task blast --arms tool-v2 --runs 5
wants v2          && node bench/agent.mjs --experiment tool-v2 --arms tool-v2 --runs 5
wants hybrid      && node scripts/generate-hybrid.mjs && for model in haiku sonnet opus; do node bench/hybrid.mjs --model "$model" --runs 3; done
echo "experiments finished: $only"
