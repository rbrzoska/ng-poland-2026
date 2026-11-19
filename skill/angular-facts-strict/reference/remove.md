# Remove an input, an output or a component: every step

`<skill>` is the skill folder, `<ws>` the workspace folder doctor printed. Do the steps in order; each ends with a gate.
Removing is safe only when the scripts show no use, or when every use they list is removed first.

## A. Remove an input or an output: `<Class>.<name>`

1. **Impact.** Nothing is edited.
   - `node <skill>/ls-facts.mjs refs <Class>.<name> --root <ws>`
   - `node <skill>/leftovers.mjs <Class>.<name> --root <ws> --before`
   Gate: both exit 0. Exit 1 "no member" or "declares no member": the name is wrong; fix it.
   Write down the counts: bindings and plain attributes, reads in templates, reads in TypeScript, text places (`CHANGE`, `?`).
2. **Decide.** `refs` lists only the declaration (and reads inside `<Class>` itself), and its line "Text only" says 0 to
   change, 0 to look at: the member is dead; go to step 4. A line "NOT dead" means text still names it. Anything else: the member is used. The task says to remove it with its uses:
   go to step 3. The task only asks whether it can be removed: stop here and report the uses.
3. **Remove the uses**, from `node <skill>/ng-facts.mjs usages <Class>.<name> --root <ws> --all` and the lists of step 1:
   - a binding or a plain attribute: delete that attribute from the element, on that line only;
   - a read in TypeScript code or in a template expression outside `<Class>`: that code needs a decision. Do not delete
     logic you do not understand: put the place under "not decided" and ask;
   - code inside `<Class>` that reads the member: it goes with the declaration in step 4.
   Gate: `node <skill>/ng-facts.mjs usages <Class>.<name> --root <ws>` prints 0 bindings. (After step 4 the same command
   answers "has no input or output" with exit 1 when no element carries the name any more: that is the same result.)
4. **Remove the declaration** in the class: the `input()`, `output()`, `model()`, `@Input()` or `@Output()` line, the code
   in the class and in its own template that read it, and an import that only it used.
5. **Leftovers.** `node <skill>/leftovers.mjs <Class>.<name> --root <ws>`. Every `CHANGE` place still names the removed
   member: remove the name there (the attribute, the `setInput` call, the key in `args`, the entry in `inputs: […]`, the
   style selector). Decide each `?` with `<skill>/reference/deciding.md`; one you leave on purpose goes into
   `--decided <file:line>`. Run it again. Gate: it prints `DONE` and exits 0 (`NOT DONE` / `NOT DECIDED`: go on).
6. **The last gate.** `node <skill>/leftovers.mjs <Class>.<name> --root <ws> --final` (same `--decided`): leftovers again,
   then the compiler. Gate: `FINISHED`, exit 0. A compiler error names a line that still reads the member: a use from step 3.
7. **Report** with the table from SKILL.md.

## B. Remove a component or a directive: `<Class>` with the selector `<selector>`

1. **Is it used?** Nothing is edited.
   - `node <skill>/ng-facts.mjs usages <Class> --root <ws>`: its elements in Angular templates (also in tests and stories, marked).
   - `node <skill>/ng-facts.mjs where <Class> --root <ws>`: who renders it, the routes and states that show it, whether
     AngularJS enters it, who names it in code.
   - `node <skill>/ls-facts.mjs refs <Class> --root <ws>`: imports arrays, routes, dialogs and `createComponent`, queries,
     injection, `extends`, types.
   - `where` printed "AngularJS can show it" or doctor said "AngularJS: yes":
     `node <skill>/ajs-facts.mjs usages <selector> --root <ws>`: AngularJS templates and states, where no Angular tool looks.
   Gate: all exit 0.
2. **Decide.** Nothing is listed outside the component's own files (its class file, template, spec, story): it is dead; go on.
   Something uses it: stop and report the uses, unless the task says to remove those too (then remove each listed place first
   and repeat step 1).
3. **Remove.** Delete the class file, its template, its style file, its spec and its story. Remove the class from every
   `imports: […]`, `declarations: […]`, `exports: […]`, barrel file (`index.ts`) and route that `refs <Class>` listed.
   A downgraded component: also its registration (`downgradeComponent`), which `ajs-facts show <selector>` names.
4. **Text.** No script judges a class name or a selector in a string, so search once for each. Both commands must print nothing:
   - `git -C <ws> grep -nE "(^|[^A-Za-z0-9_$])<Class>([^A-Za-z0-9_$]|$)"`
   - `git -C <ws> grep -nE "(^|[^A-Za-z0-9_-])<selector>([^A-Za-z0-9_-]|$)"`
   (Doctor said "git: no": `grep -rnE "<the same pattern>" <ws>/src`.)
   A hybrid app: search the camelCase name of the selector too (`my-thing` is registered as `myThing`).
   Each line they print still names the component: remove it, or put it in the report under "left on purpose" with the reason.
   Gate: both exit 1 with no output, or every printed line is in the report.
5. **Compile.** `node <skill>/ls-facts.mjs check --root <ws>`. Gate: `0 errors`, exit 0.
6. **Report** with the table from SKILL.md. Name the routes and states from step 1: they are the screens to test.

## What "dead" means here, and what it does not

- `ng-facts unrouted` prints three lists: (1) in no template and named by no other file: the strongest candidates;
  (2) named only by code nothing reaches; (3) rendered only by components of the list. It reads templates, routes, states,
  bootstrap and downgrades, and matches class names in code as text. A component picked by a string or built at run time
  is alive although it is listed. Confirm each candidate with `ls-facts refs <Class>` before you call it dead.
- A component used only by its own spec or story is dead for the app. Say that the spec and the story go with it.
- A library: something outside this workspace may use it. The scripts cannot see that. Say so.
