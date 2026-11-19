# Change a component's API in many templates with a spec: every step

Use this when the inputs of a component change in a way a rename cannot express (a value is negated, values are mapped to
new ones, an input moves into the element's content) and every template that uses the component has to follow.
The change is written once as data; the script applies it to every element of the component, and of every class that
extends it, with the compiler's template parser. Only a rename: do not use this, use procedure 3 of SKILL.md.
`<skill>` is the skill folder, `<ws>` the workspace folder doctor printed.

## 1. Know what there is (nothing is edited)

- `node <skill>/ng-facts.mjs usages <Class> --root <ws>`: how many elements, in how many templates, which inputs they bind.
- For every input that changes: `node <skill>/ng-facts.mjs usages <Class>.<input> --root <ws>`. Read the "Forms" and "Values"
  lines: they show how many are plain attributes, and which values are plain text and which are expressions.
  The class was changed first and no longer declares the old input: the command still lists the attributes of that name on
  its elements and says so in a `!` line; `usages <Class>` names them in its line "Bound on these elements, but no input".
Gate: exit 0. Keep the number of elements. Exit 1 "has no input or output": no element carries that name; check the spelling.

## 2. Write the spec

`node <skill>/ng-facts.mjs migrate --help` prints the format with one example per kind of rule. The rules per input:

| Rule | Meaning |
|---|---|
| `"rename": "<new>"` | the binding gets the new name |
| `"rename": "<new>", "negate": true` | new name, and the value is negated (`x` becomes `!x`, `true` becomes `false`) |
| `"rename": "<new>", "values": { "<old value>": "<new value>" }` | new name, and plain string values are mapped |
| `"otherwise": { "pipe": …, "import": …, "from": … }` | values that are not plain strings are wrapped in this pipe, and the pipe is imported |
| `"toContent": true` | the input goes away; its value moves between the element's tags |

Write the spec to a file in `<ws>` (for example `<ws>/api-change.migration.json`). Delete the file at the end, unless the user wants to keep it.

## 3. Dry run

`node <skill>/ng-facts.mjs migrate <spec file> --root <ws>`

Read the first line (elements, edits, files) and every `needs a decision` line (`--all` lists every one). Each is a place
the spec does not cover: a value with no mapping, a plain attribute that cannot be negated, an element that already has content.
Either extend the spec and run the dry run again, or leave the place for step 5.
Gate: exit 0, and the number of elements is the number from step 1 plus the elements of classes that extend `<Class>`.

## 4. Apply

`node <skill>/ng-facts.mjs migrate <spec file> --root <ws> --write`

Gate: it prints `verify: nothing left to migrate`. Exit 0: no decision is left. Exit 2: `needs a decision` places are left;
they are step 5. If it prints that edits would still apply: do not run it again blindly; open one of the files it names.

## 5. By hand: what the spec does not cover

- Every `needs a decision` place: open it and make the edit the new API needs. Put each in the report.
- The class of the component itself: the script edits the users, not the component. Change its inputs to the new API by hand
  (or, for a pure rename of one input, `node <skill>/ls-facts.mjs rename <Class>.<old> <new> --root <ws> --write` BEFORE step 4
  and leave that input out of the spec).
- TypeScript code that reads or sets a changed input: the compiler lists the reads in step 7, `leftovers` the strings in step 6.

## 6. Leftovers, once per renamed or removed input

`node <skill>/leftovers.mjs <Class>.<old input> --root <ws>`

Edit each `CHANGE` place by hand, decide each `?` with `<skill>/reference/deciding.md` (left on purpose: `--decided <file:line>`),
run it again. Gate: `DONE`, exit 0, for every input the spec renames or removes.

## 7. The last gate and the report

`node <skill>/leftovers.mjs <Class>.<old input> --root <ws> --final` for the last renamed or removed input (it runs the
compiler too). Gate: `FINISHED`, exit 0. The spec renamed or removed no input: `node <skill>/ls-facts.mjs check --root <ws>`,
gate `0 errors`, exit 0.
Then `git -C <ws> diff --stat` and the report table from SKILL.md. Every `needs a decision` place is in it: changed by hand,
or not decided.

## Limits to say in the report

- Templates with parse errors are named by the script in `!` lines; what the parser could not read was not migrated.
- Elements created in code or written in AngularJS templates are not migrated. `leftovers` lists the AngularJS ones.
- A negated or mapped value changes behaviour, and no compiler checks that it is right: name the screens to test
  (`node <skill>/ng-facts.mjs where <Class> --root <ws>`).
- Two migrations must not run at the same time in one workspace. The script refuses the second one.
