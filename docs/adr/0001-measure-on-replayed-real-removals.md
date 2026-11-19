# Measure the skill on replayed real removals, not on a generated app

Status: accepted, 2026-11-19

## Context

Until now the skill was measured on generated applications with an answer key (`bench/rename.mjs`). On current models
(Haiku, Sonnet and Opus 5.5) that benchmark no longer separates the lanes: 70 of 72 runs were correct with or without
the skill, grep alone included. It measures cost, not whether the skill prevents mistakes.

The real work the skill is meant for is AJS removal in a large private hybrid application, where the team has already
merged a series of screen removals and store migrations as pull requests.

## Decision

The main measurement becomes a **replay**: each merged AJS removal pull request is run again by an agent from the
commit before it, with the task text the team had, with and without the skill, on Sonnet 5.5 and Opus 5.5. A run is
judged by the gate (nothing names the removed code), the compiler and the tests of the area, and by comparing the
behaviour it covers with the merged pull request (by a model on every run, by a person on a sample).

The generated benchmarks stay, as regression tests of the scripts.

## Consequences

- Results come from code that cannot be published. The replay harness, the private application's tasks and the
  results live outside this repository; only the method and anonymous summary numbers may enter it.
- The answer is no longer one exact tree: two correct removals can differ. The judgement of behaviour coverage is
  softer than the old key, and a person reviews part of it.
- Results are not comparable with the earlier generated-app series.
