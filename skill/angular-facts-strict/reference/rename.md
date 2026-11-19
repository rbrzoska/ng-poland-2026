# Rename a member (input, output, method, property): every step

`<skill>` is the skill folder, `<ws>` the workspace folder doctor printed, `<Class>.<old>` the member, `<new>` the new name.
Do the steps in order. A step is finished when its gate holds. Do not go on before that.

## 0. Before

1. `node <skill>/doctor.mjs --root <ws>` if you have not run it in this task. Gate: `READY`, or you know which scripts are `ok`.
2. `git -C <ws> status --short`. Write down the files that are already changed: they are not yours. (Doctor says "git: no": skip.)

## 1. Impact (nothing is edited)

1. `node <skill>/ls-facts.mjs refs <Class>.<old> --root <ws>`
2. `node <skill>/leftovers.mjs <Class>.<old> --root <ws> --before`

Keep the number of references from 1 and the number of `CHANGE` and `?` places from 2.
Gate: both exit 0. Exit 1 with "no class", "no member" or "declares no member": the name is wrong. Fix the name. Do not go on with a guess.

## 2. Plan

`node <skill>/ls-facts.mjs rename <Class>.<old> <new> --root <ws>`

It prints the edits per group and writes nothing. Read every line that starts with `!`:

| The `!` line says | What you do |
|---|---|
| "added by the template parser", with places | they are part of the rename; after step 3 open each listed place and see that it has the new name |
| "with syntax errors" | after step 3 open that template; a binding of `<Class>` that still has the old name: change it by hand |
| "in a template built from an expression … look by hand" | open each listed place; it is this member: change the name by hand after step 3 |
| "under a derived name … NOT renamed, fix by hand" | after step 3 change each listed place by hand (step 3 also ends with `NOT DONE` and exit 2 for these) |
| "inherits `<old>` from `<Base>`" | the rename changes the member of `<Base>`, so every class that extends `<Base>` changes too. The task meant only `<Class>`: stop and ask |
| "uses the alias … which stays" | nothing: templates bind the alias, and the alias does not change |
| "(`<old>`Change) … becomes (`<new>`Change)" | nothing: the event of a `model()` is renamed with it |
| "edited files are outside `<tsconfig>`, the project check compiles (specs, stories): check cannot vouch for them" | `check` compiles the build only: in step 5 read the diff of each of those files yourself and write "reviewed by diff, not compiled" in the report |
| "outside `<tsconfig>` hold the name … drop --project" | run the command again without `--project` |
| "no tsconfig could load … read by hand" | open the listed files; `leftovers` in step 4 judges them too |
| "switched on in memory", "the service returned N entries for M places", "findRenameLocations returned … built from the references" | nothing: this is how the answer was made complete |
| "also feed `<Other>`.`<old>` on the same element" | one attribute feeds two directives. After step 3 decide each listed place: keep the old name there too (add an attribute) or accept that `<Other>` loses it; ask when unsure. Name each place in the report |
| "the selector … is the input's own name and is NOT renamed" | the directive is matched by `[<old>]`. Ask the user whether the selector changes too; leftovers marks it `?` |

Exit 1 "is also declared outside the workspace's own sources": the member implements or overrides a library member (a lifecycle
hook, `PipeTransform.transform`). It cannot be renamed alone. Stop and tell the user.

Gate: exit 0, and the number of edits is close to the number of references from step 1 (the same, or lower by the places a
`!` line explains). Exit 1 "already has a member": the new name is taken. Stop and ask the user for another name.

## 3. Apply

`node <skill>/ls-facts.mjs rename <Class>.<old> <new> --root <ws> --write`

The first line says "written". Then it runs `leftovers` itself and says what is left: `--write` is never the last step.
- `NOT DONE: N places in text still carry …` and exit 2: the usual case. Go to step 4; `leftovers` lists them.
- `NOT DONE: … under a derived name` or `… need your decision`: change or decide each listed place by hand, then go to step 4.
- Exit 0 and "leftovers finds no place": go to step 5.
Gate: the first line says "written" (exit 0 or 2). Exit 1: nothing was written; read the line.

**No language service** (doctor said `ls-facts.mjs CANNOT RUN` and you may not install it, or `NOT IN THIS COPY`), for an
input or an output. This replaces steps 2 and 3:
1. `node <skill>/ng-facts.mjs rename-input <Class>.<old> <new> --root <ws>`, read the counts, then the same with `--write`
   (it ends with exit 2 and `NOT DONE`: the compiler and leftovers still have to speak).
   It renames the declaration, the reads in the class and in its own template, and every binding, also on components that
   extend `<Class>`. It does not see TypeScript code that reads the member through another object.
2. `node <skill>/ls-facts.mjs check --root <ws> --all` (`ls-facts.mjs` is not in this copy: `node <skill>/ng-facts.mjs check
   --root <ws> --all`, the same compiler). Each `file:line:column` it lists under "Property '`<old>`' does not exist" is such
   a read: change the name at that place, nothing else. Run it again (a line with two reads shows the second one only now),
   until it prints `0 errors`. Then go on with step 4: the compiler has not seen the strings and the styles.
A method or a property without the language service: change the declaration by hand, then fix every error `check` prints, the same way.

## 4. Leftovers: the places no compiler checks

`node <skill>/leftovers.mjs <Class>.<old> --root <ws>`

- `CHANGE` places: edit each one by hand: the name on that line, nothing else. A line listed twice holds two places: change both.
- A `CHANGE` place in a `*.stories.ts` or `*.spec.ts` file: first read "Stories and tests" in `<skill>/reference/deciding.md`.
  A story template line `[old]="old"` is listed twice: change both sides (`[new]="new"`).
- `?` places: decide each one with `<skill>/reference/deciding.md`. Changed: it disappears. Left on purpose: add it to the
  command as `--decided <file:line>` (several: `--decided a.ts:3,b.html:7`); the script then lists it as decided.
- `leave` counts: nothing to do. They are other things with the same name.
- "+N more": run it with `--all` to see every place.

Run the same command again after your edits.
Gate: it prints `DONE` and exits 0. `NOT DONE` and exit 2: `CHANGE` places are left. `NOT DECIDED` and exit 2: a `?` is open.
Go on with them. Do not skip to step 5.

## 5. The last gate: text and compiler together

`node <skill>/leftovers.mjs <Class>.<old> --root <ws> --final` (with the same `--decided` as in step 4)

It runs step 4 again and then the compiler (`check`). Gate: `FINISHED`, exit 0. It takes as long as doctor said for `check`.
Run it once, wait for it, never two at once. `NOT FINISHED`: the compiler lists its places as `file:line:column` (add `--all`
for every place): fix each place, run it again.
An error that does not name `<old>` or `<new>`, in a file that `git -C <ws> diff --stat` does not list, was there before
your change: do not fix it. Put it in the report as "error not from this change" with its `file:line`.

`check` compiles the build's project. Spec and story files are not in it, and no gate of this procedure compiles them.
For each spec or story file that step 3 named ("check cannot vouch for them") or that you edited in step 4:
`git -C <ws> diff -- <file>`. Every changed line must change the name and nothing else. Write in the report
"specs and stories: reviewed by diff, not compiled", with the files.
Only when the user asks for the tests to be compiled: `node <skill>/ls-facts.mjs check --root <ws> --project <the test
tsconfig doctor named>`. On a big app it can take many minutes, and it often lists errors that were there before (components
that exist only inside a test). Report only the errors that name `<old>` or `<new>`; never fix the others.

## 6. Review and report

1. `git -C <ws> diff --stat`. Every file in it comes from step 3 or step 4. A file you cannot explain: read its diff; undo
   what the task did not ask for.
2. Write the report table from SKILL.md: changed by a script (the number of edits step 3 printed, per group), changed by hand
   (each `file:line`), left on purpose (each `--decided` place and what it is), not decided, and the gate
   (`leftovers --final`: FINISHED).

## What a rename does not do

- It does not rename the file, the class or the selector.
- It does not change prose in documents. `leftovers` lists the documents that name the member: decide with the user.
- In an AngularJS template the name is written in kebab-case (`[old-name]`, `(old-name)`). Only `leftovers` lists those.
