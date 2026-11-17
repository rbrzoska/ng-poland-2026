# Evidence — every recorded agent run, as ranges

Generated 2026-11-16 by `node bench/evidence.mjs`. Every cell is min–max over the runs of that lane; nothing is averaged. Input tokens include cache reads. Wall clock runs from spawn to the agent's final answer, so an agent that hangs on its own shell command pays for it; model time is the part spent waiting for the model. "Functionally correct" = 0 ngc errors and 0 elements differing from the answer key in the compiler's AST; for the accessibility sweep: every target labelled, nothing else changed, 0 ngc errors.

## Migration, 120 components, mapping given in the task

claude-sonnet-5-5 · 8 runs, 3 of them with the arms in parallel

| Agent | Runs | Functionally correct | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 8 | 8/8 | 0 ngc errors, 0 elements wrong | 45–742 s | 39–104 s | 8–17 | 251 k–652 k | 3.3 k–7.8 k | $0.17–$0.32 |
| Asterix · ng-facts | 8 | 8/8 | 0 ngc errors, 0 elements wrong | 14–735 s | 9–164 s | 3–28 | 96 k–1606 k | 0.5 k–11 k | $0.06–$0.65 |

Same run, grep ÷ ng-facts (8 pairs): cost 0.3×–4.6×, input tokens 0.2×–5.0×, output tokens 0.4×–10.5×, turns 0.3×–4.3×, wall-clock time 0.1×–27.5×, model time 0.3×–5.5×.

## Migration, 30 components

claude-sonnet-5-5 · 3 runs, arms one after another

| Agent | Runs | Functionally correct | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 3 | 3/3 | 0 ngc errors, 0 elements wrong | 56–61 s | 50–54 s | 8–10 | 274 k–329 k | 4.7 k–4.8 k | $0.19–$0.22 |
| Asterix · ng-facts | 3 | 3/3 | 0 ngc errors, 0 elements wrong | 12–15 s | 7–10 s | 3 | 96 k | 0.4 k–0.6 k | $0.06 |

Same run, grep ÷ ng-facts (3 pairs): cost 3.3×–3.8×, input tokens 2.9×–3.4×, output tokens 8.5×–10.8×, turns 2.7×–3.3×, wall-clock time 4.1×–5.1×, model time 5.4×–7.7×.

## Migration, 480 components

claude-sonnet-5-5 · 3 runs, arms one after another

| Agent | Runs | Functionally correct | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 3 | 3/3 | 0 ngc errors, 0 elements wrong | 57–737 s | 48–119 s | 10–13 | 320 k–554 k | 4.1 k–5.5 k | $0.19–$0.29 |
| Asterix · ng-facts | 3 | 3/3 | 0 ngc errors, 0 elements wrong | 23–737 s | 16–77 s | 4–11 | 129 k–390 k | 0.9 k–2.0 k | $0.07–$0.17 |

Same run, grep ÷ ng-facts (3 pairs): cost 1.3×–4.0×, input tokens 0.9×–4.3×, output tokens 2.1×–6.1×, turns 1.0×–3.3×, wall-clock time 0.3×–32.0×, model time 0.7×–7.4×.

## Migration, 120 components, no tool: the agent builds its own codemod on the compiler

claude-sonnet-5-5 · 3 runs, arms one after another

| Agent | Runs | Functionally correct | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix told to write his own codemod on @angular/compiler | 3 | 2/3 | 0 ngc errors, 0–20 elements wrong | 93–96 s | 83–86 s | 6–10 | 224 k–403 k | 8.0 k–10 k | $0.23–$0.27 |

## Migration, 120 components, mapping NOT given: the agent derives it from the v1 source

claude-sonnet-5-5 · 3 runs, arms one after another

| Agent | Runs | Functionally correct | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 3 | 3/3 | 0 ngc errors, 0 elements wrong | 43–749 s | 37–122 s | 7–14 | 255 k–450 k | 3.4 k–6.3 k | $0.15–$0.24 |
| Asterix · ng-facts | 3 | 3/3 | 0 ngc errors, 0 elements wrong | 17–745 s | 11–53 s | 3–11 | 97 k–384 k | 0.7 k–2.6 k | $0.06–$0.16 |

Same run, grep ÷ ng-facts (3 pairs): cost 1.0×–3.8×, input tokens 0.7×–4.6×, output tokens 1.3×–8.1×, turns 0.6×–4.7×, wall-clock time 0.1×–44.1×, model time 0.7×–11.1×.

## Migration, 120 components, tool improved from the recordings: inline spec, format in the hint, built-in compiler check

claude-sonnet-5-5 · 5 runs, arms one after another

| Agent | Runs | Functionally correct | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Asterix · ng-facts v2 | 5 | 5/5 | 0 ngc errors, 0 elements wrong | 9–17 s | 5–13 s | 2 | 63 k | 0.3 k | $0.05 |

## Migration, 120 components, smaller model (Haiku)

claude-haiku-5-5 · 3 runs, arms one after another

| Agent | Runs | Functionally correct | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 3 | 1/3 | 0 ngc errors, 0–20 elements wrong | 87–178 s | 81–163 s | 13–26 | 610 k–1494 k | 16 k–29 k | $0.02–$0.04 |
| Asterix · ng-facts | 3 | 3/3 | 0 ngc errors, 0 elements wrong | 17–27 s | 12–21 s | 6–7 | 205 k–212 k | 2.0 k–2.9 k | $0.01 |

Same run, grep ÷ ng-facts (3 pairs): cost 4.4×–6.9×, input tokens 3.0×–7.0×, output tokens 7.7×–10.7×, turns 2.2×–3.7×, wall-clock time 5.1×–6.6×, model time 6.8×–7.8×.

## Six impact-analysis questions about one component, 120 components, no edits

claude-sonnet-5-5 · 5 runs, arms one after another

| Agent | Runs | All answers right | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 5 | 3/5 | 5–6 of 6 answers | 30–750 s | 26–126 s | 5–11 | 183 k–398 k | 2.4 k–5.2 k | $0.13–$0.20 |
| Asterix · ng-facts | 5 | 5/5 | 6 of 6 answers | 22–27 s | 18–20 s | 4–6 | 132 k–170 k | 1.2 k–1.5 k | $0.08–$0.10 |

Same run, grep ÷ ng-facts (5 pairs): cost 1.6×–2.3×, input tokens 1.2×–2.4×, output tokens 1.6×–4.2×, turns 0.8×–2.2×, wall-clock time 1.1×–31.3×, model time 1.4×–7.0×.

## Blast radius on a routed app (105 components): which routes can show a component, which components are dead — no edits; v1 = the tool as written for the migration, v2 = with the where and unrouted commands

claude-sonnet-5-5 · 10 runs, arms one after another

| Agent | Runs | All answers right | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 5 | 5/5 | 4 of 4 answers | 53–64 s | 47–59 s | 7–10 | 358 k–474 k | 3.8 k–5.0 k | $0.24–$0.35 |
| Asterix · ng-facts | 5 | 4/5 | 2–4 of 4 answers | 73–110 s | 46–76 s | 8–11 | 320 k–479 k | 4.0 k–5.0 k | $0.19–$0.28 |
| Asterix · ng-facts v2 | 5 | 5/5 | 4 of 4 answers | 13–30 s | 9–24 s | 3–4 | 98 k–132 k | 0.7 k–1.1 k | $0.06–$0.08 |

Same run, grep ÷ ng-facts (5 pairs): cost 1.0×–1.8×, input tokens 1.0×–1.2×, output tokens 0.8×–1.0×, turns 0.8×–1.1×, wall-clock time 0.5×–0.9×, model time 0.6×–1.1×.

## Accessibility sweep on the same app: label the 75 icon buttons that have no accessible name — one judgement per place, tool unchanged

claude-sonnet-5-5 · 5 runs, arms one after another

| Agent | Runs | Functionally correct | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 5 | 4/5 | 0–37 still unlabelled, 0 collateral changes, 0 implausible labels, 0 ngc errors | 22–738 s | 17–59 s | 4–12 | 158 k–459 k | 1.5 k–3.5 k | $0.13–$0.22 |
| Asterix · ng-facts | 5 | 4/5 | 0–1 still unlabelled, 0 collateral changes, 0 implausible labels, 0 ngc errors | 24–172 s | 19–45 s | 4–9 | 167 k–355 k | 1.9 k–3.3 k | $0.13–$0.20 |

Same run, grep ÷ ng-facts (5 pairs): cost 0.6×–1.7×, input tokens 0.4×–2.5×, output tokens 0.5×–1.8×, turns 0.4×–2.4×, wall-clock time 0.1×–30.6×, model time 0.4×–3.1×.

## Six migration-planning questions about a hybrid AngularJS + Angular app (40 AngularJS components), no edits - Haiku

claude-haiku-4-5-20251001 · 3 runs, arms one after another

| Agent | Runs | All answers right | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 3 | 0/3 | 2–3 of 6 answers | 278–390 s | 286–604 s | 5–90 | 144 k–2477 k | 2.2 k–25 k | $0.63–$1.03 |
| Asterix · ajs-facts | 3 | 1/3 | 5–6 of 6 answers | 56–65 s | 37–51 s | 9–12 | 237 k–428 k | 4.0 k–6.5 k | $0.13 |

Same run, grep ÷ ajs-facts (3 pairs): cost 4.8×–7.9×, input tokens 0.6×–5.8×, output tokens 0.3×–6.1×, turns 0.5×–7.5×, wall-clock time 5.0×–6.4×, model time 5.6×–14.2×.

## Six migration-planning questions about a hybrid AngularJS + Angular app (40 AngularJS components), no edits - Sonnet

claude-sonnet-5 · 3 runs, arms one after another

| Agent | Runs | All answers right | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 3 | 3/3 | 6 of 6 answers | 392–424 s | 361–392 s | 32–176 | 1984 k–2369 k | 31 k–44 k | $1.11–$1.30 |
| Asterix · ajs-facts | 3 | 3/3 | 6 of 6 answers | 98–148 s | 69–128 s | 6–24 | 252 k–703 k | 6.5 k–9.8 k | $0.22–$0.45 |

Same run, grep ÷ ajs-facts (3 pairs): cost 2.8×–5.1×, input tokens 3.2×–7.9×, output tokens 3.1×–6.0×, turns 2.3×–17.8×, wall-clock time 2.9×–4.1×, model time 3.1×–5.5×.

## Six migration-planning questions about a hybrid AngularJS + Angular app (40 AngularJS components), no edits - Opus

claude-opus-5 · 3 runs, arms one after another

| Agent | Runs | All answers right | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 3 | 3/3 | 6 of 6 answers | 158–175 s | 133–145 s | 9–13 | 505 k–738 k | 12 k–13 k | $1.21–$1.38 |
| Asterix · ajs-facts | 3 | 3/3 | 6 of 6 answers | 70–96 s | 45–63 s | 9–12 | 183 k–276 k | 4.0 k–5.3 k | $0.41–$0.54 |

Same run, grep ÷ ajs-facts (3 pairs): cost 2.3×–3.1×, input tokens 1.9×–3.3×, output tokens 2.3×–3.2×, turns 0.8×–1.3×, wall-clock time 1.8×–2.5×, model time 2.3×–3.2×.

## Six migration-planning questions about a hybrid AngularJS + Angular app (40 AngularJS components), no edits - Fable

claude-fable-5-1 · 3 runs, arms one after another

| Agent | Runs | All answers right | Quality | Wall clock | Model time | Turns | Input tokens | Output tokens | Cost |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| Obelix · files + grep | 3 | 3/3 | 6 of 6 answers | 119–121 s | 97–98 s | 8 | 359 k–424 k | 8.1 k–8.7 k | $1.79–$1.91 |
| Asterix · ajs-facts | 3 | 2/3 | 5–6 of 6 answers | 60–73 s | 43–54 s | 6–11 | 199 k–211 k | 3.3 k–4.1 k | $0.71–$0.83 |

Same run, grep ÷ ajs-facts (3 pairs): cost 2.3×–2.5×, input tokens 1.8×–2.1×, output tokens 2.0×–2.4×, turns 0.7×–1.3×, wall-clock time 1.7×–2.0×, model time 1.8×–2.3×.
