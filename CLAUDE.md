# ng-poland-2026

Material for the NG Poland 2026 talk "Veni, Vidi, Compilavi" and the research behind it: agents answering questions
about Angular code from Angular's own tools (the compiler's template parser, the Angular Language Service) instead of
grep. `HANDOVER.md` describes the current research state.

## Agent skills

### Issue tracker

Issues and specs are local markdown files under `.scratch/` (git-ignored; the repo is public). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) as `Status:` lines. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
