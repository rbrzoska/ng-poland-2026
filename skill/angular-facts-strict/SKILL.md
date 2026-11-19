---
name: angular-facts
description: In a repository with angular.json or @angular/core (also an AngularJS/ngUpgrade hybrid), facts from Angular's own parser and type checker instead of text search, plus a machine check that a change is finished. Use it BEFORE you search or edit, for ANY task that asks where a component, directive, pipe, input, output, service method or property, class or route is used; who calls something; which pages or screens show something; whether something (an unused input, a component) is dead or safe to delete; what breaks if it changes; or that renames, removes, moves or changes the API of any of these; or that asks what legacy AngularJS code is left or still uses it. Not only for renames. Not for React, Vue or TypeScript without Angular.
---

# Angular facts

The scripts here answer "where is this used?" and "is this change finished?" from Angular's own tools. Ask them first;
search by text only for what the table below says no script sees.
- `<skill>` is the folder this file is in. `<ws>` is the workspace folder that doctor prints.
- Every command is `node <skill>/<script>.mjs <command> … --root <ws>`. `--all` lists every place. `--help` explains a script.
- Exit code 0: answered. 1: a wrong name, option, moment or folder, or a missing package: fix the call. 2: NOT finished
  (NOT DONE, NOT DECIDED, NOT FINISHED): do what the last lines say, run it again.
- A `!` line says what the script could not read: repeat it in your answer. A `→ next:` line is one command to paste, a
  suggestion, not the procedure: the steps below decide what you run. Never run a command twice for one question.

## Start: once per task
`node <skill>/doctor.mjs --root <the folder of the app, or the repository root>`

It prints `<ws>`, AngularJS yes or no, the cost of a language-service command, one line per script, and `READY` or `NOT READY`
with the fix. An `npm install --prefix …` line: run that exact line once (it installs into the skill folder, not the app), then
doctor again; if you may not install, use the scripts marked `ok` and say so. A script marked `NOT IN THIS COPY` or
`NOT USABLE HERE`: wherever a step names it, run the command its line gives instead.

## The question → the command
| The task asks | Run (each with `--root <ws>`) | It does not see |
|---|---|---|
| Who uses this component or directive? | `ng-facts usages <selector or Class>` | AngularJS templates (`ajs-facts usages`), elements created in code (`ls-facts refs <Class>`), the selector in style sheets (`git -C <ws> grep -n -w <selector> -- "*.css" "*.scss"`) |
| Who binds this input or output? | `ng-facts usages <Class>.<name>`, then `ls-facts refs <Class>.<name>` | names in text: `leftovers <Class>.<name> --before` |
| Who calls this method, reads or writes this property, uses this service member? | `ls-facts refs <Class>.<member>`, then `leftovers <Class>.<member> --before` | values typed `any`, code that does not compile |
| Where is this class, service or pipe used (templates, imports, injection, routes, types)? | `ls-facts refs <Class>` | the name in strings, files of no tsconfig |
| Who uses this function, constant (a store action or selector, a token), interface or enum? | no script: `git -C <ws> grep -n -w <name>`, and say it is a text search | |
| On which screens (routes, ui-router states) is this shown? | `ng-facts where <selector or Class>` (components and directives only) | routes and states built at run time |
| Is this component dead? Which ones are? | `ng-facts where <Class>` (all candidates: `ng-facts unrouted`), then `ls-facts refs <Class>` for each; with AngularJS also `ajs-facts usages <selector>` | a component picked by a string |
| Is this input or output dead? | `ls-facts refs <Class>.<name>`: its line "Text only" must say 0 and 0 | nothing more: both sources are in it |
| What breaks if I change or remove this? | procedure 2 | |
| Rename an input, output, method or property | procedure 3 | |
| Remove an input, an output or a component | procedure 4 | |
| Change a component's API in many templates | procedure 5 (`ng-facts migrate`) | TypeScript code, names in text |
| Move a class to another file | `<skill>/reference/move.md` | |
| What in AngularJS still uses this? What is left of AngularJS here? | procedure 6 (`ajs-facts`) | markup and names built at run time |
| Does the app compile? | `ls-facts check` (the build's project; `--all` lists every error place) | specs and stories (not in the build), every name that is only text |

## Which script when
- **ng-facts**: the compiler's template parser. Seconds. Works on code that does not compile. Knows templates, selectors,
  inputs, outputs, `extends`, routes and states. Does not see TypeScript code that reads a member through another object.
- **ls-facts**: the Angular Language Service, type-checked: inheritance, generics, services, TypeScript and templates together.
  Needs code that compiles. Slow on a big app (doctor says how slow): one command at a time, never in a loop or in parallel.
  `--warm` keeps the project loaded for 10 minutes: add it only if the user asks for it.
- **ajs-facts**: the AngularJS side of a hybrid app: registrations, AngularJS templates, states, downgraded Angular classes.
- **leftovers**: plain text: names in strings, styles, AngularJS templates, `.js` code, specs, stories, documents. Marks each
  place `CHANGE`, `leave` or `?`. Before a change pass `--before`; after it the OLD name. Its first word is the verdict.

## What no compiler sees, and what no script sees
- A name that is only text stays wrong while the compiler is green: `setInput("name")`, `inputs: ["name"]`, `args: { name: … }`,
  `some-tag[name]` in a style sheet, `my-name="…"` in an AngularJS template, `service.name()` in a `.js` file.
  **A green compiler is not proof. Only `leftovers … --final` printing `FINISHED` is.**
- No script sees: markup and names built at run time, a component picked by a string, values typed `any`, code outside this workspace.

## Rules for every task
1. Do not cut script output with `head` or `tail`. The first line is the verdict and the counts; read on for the places.
2. Do not replace a word everywhere (`sed`, find-and-replace in files). Other things share the name. Edit only a place a script listed.
3. Do not stop at a green compiler. Do not skip a gate. A gate is a command that must exit 0 before you go on.
4. Every number in your answer is copied from a script's output. Say which script printed it.

## Procedures

**1. Answer a usage question** (nothing is edited)
1. Run the command from the table. Gate: exit 0.
2. An input, an output or a component: the second source too (`ls-facts refs …` after `ng-facts usages …`). Numbers differ:
   say both and why (ng-facts counts story and test templates, ls-facts TypeScript code); list what you cannot explain.
3. A member: `leftovers <Class>.<name> --before`. A component in an app with AngularJS: `ajs-facts usages <selector>`. Gate: exit 0.
4. Answer: the counts per group, `file:line` of the places asked about, which script said what, every `!` line.

**2. Before changing or removing a member: impact** (nothing is edited)
1. `ls-facts refs <Class>.<member>`: everything the type checker ties to the member, and one line "Text only" with the places
   only text shows. Gate: exit 0. Exit 1 "no member": the name is wrong; fix it now.
2. `leftovers <Class>.<member> --before`: those text places, each `file:line` (strings, styles, AngularJS templates, `.js`
   code, stories, tests). An input or an output: also `ng-facts usages <Class>.<member>` (it reads story templates). Gate: exit 0.
3. A component or a directive: `ng-facts where <Class>` (screens to test). A service: who injects it is `ls-facts refs <Class>`.
4. Report: type-checked references per group, text-only places (`CHANGE` and `?`, each `file:line`), screens.

**3. Rename a member** — every step: `<skill>/reference/rename.md`
1. Procedure 2. Keep its counts.
2. Plan: `ls-facts rename <Class>.<old> <new>`. Read every `!` line. Gate: exit 0.
3. Apply: the same command with `--write`. Its first line says "written". `--write` is never the last step: exit 2 and
   `NOT DONE` is the usual answer here (text places the service cannot see, or a place that needs your decision): go to step 4.
   No language service: `ng-facts rename-input <Class>.<old> <new> --write` (inputs and outputs only), then `ng-facts check --all`.
4. `leftovers <Class>.<old>`. Edit each `CHANGE` place by hand: that line, that name, nothing else. A `?` place, and a place in
   a `*.stories.ts` or `*.spec.ts` file: read `<skill>/reference/deciding.md` first (there one place can mean two edits).
   Run it again. `NOT DONE`: go on with the list. `NOT DECIDED`: decide each `?`; one you leave on purpose goes into
   `--decided <file:line>`. Gate: it prints `DONE` and exits 0.
5. Last gate: `leftovers <Class>.<old> --final` (same `--decided`); it runs the compiler too. Gate: `FINISHED`, exit 0. An error
   names a place: fix it, run it again. Each spec or story you edited: `git -C <ws> diff -- <file>`, "reviewed by diff, not compiled".

**4. Remove an input, an output or a component** — every step: `<skill>/reference/remove.md`
1. Procedure 2 (a component: the "dead" row of the table). Something still uses it: stop and report the uses; if the task says
   to remove them too, remove each listed use first. 2. Remove the declaration. 3. `leftovers <Class>.<name>` until `DONE`,
   exit 0. 4. `leftovers <Class>.<name> --final`: `FINISHED`, exit 0. 5. Report table.

**5. Change a component's API with a spec** — every step: `<skill>/reference/migrate.md`
1. `ng-facts migrate --help` prints the spec format; write the spec to a file. 2. Dry run: `ng-facts migrate <spec.json>`; read
   every `needs a decision` line. 3. The same with `--write`. Gate: it prints `nothing left to migrate`; exit 2 means decisions
   are left: make them by hand. 4. For each renamed or removed input: `leftovers <Class>.<old>` until `DONE`.
5. `leftovers <Class>.<old> --final`: `FINISHED`, exit 0 (no input renamed: `ls-facts check`, `0 errors`). 6. Report table.

**6. AngularJS questions** (nothing is edited) — every step: `<skill>/reference/angularjs.md`
1. `ajs-facts summary`: counts per kind. `ajs-facts list <components|directives|filters|services|downgrades|wrappers|states>`;
   add `--unused` for what nothing uses, `--under <folder>` for what one feature folder registers.
2. One thing: `ajs-facts show <name>` (its card) and `ajs-facts usages <name>` (every use, `file:line`). Gate: exit 0.
3. An Angular input in an AngularJS template (kebab-case): `ajs-facts usages <name>.<input>`. A service method called from
   AngularJS code: `leftovers <Class>.<method> --before` (group "AngularJS code in .js files").

## The report: after every change, this table
| | count | where |
|---|---|---|
| changed by a script | n | the command and the groups it printed |
| changed by hand | n | each `file:line` |
| left on purpose | n | each `file:line` (your `--decided` places) and what it is instead |
| not decided | n | each `file:line` and what you saw: the user decides |
| gates | | `leftovers --final`: FINISHED or NOT FINISHED · `git diff --stat`: files changed |

## When something goes wrong
- `@angular/language-service` is not installed: run the `npm install --prefix …` line the script prints, once. Until then
  use ng-facts, leftovers and `ls-facts check` (check needs no language service), and say so in the report.
- The code does not compile: ls-facts returns fewer references. Use ng-facts, fix what `ls-facts check` lists, then ask ls-facts.
- "lists no source files" or "name the project": add `--project <tsconfig>` with a config doctor listed. Slow: wait, as doctor said.
- `!` "templates with parse errors" or "not read at all": the answer does not cover those files. Read the ones your task is about; name the others.
- "no class", "no member", "several classes answer to": copy the name from its source file; two classes share it: `<file>#<Class>`.
  leftovers "still declares … --before" or "declares no member": the wrong name for the moment: fix the call as the line says.
