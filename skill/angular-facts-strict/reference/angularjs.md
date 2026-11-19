# AngularJS questions in a hybrid app: every step

A hybrid app runs AngularJS (1.x) and Angular together through ngUpgrade. Doctor says "AngularJS: yes" for such an app.
`ajs-facts` reads the AngularJS side: registrations on `angular.module(…)`, AngularJS templates, ui-router states, Angular
classes downgraded for AngularJS, and AngularJS components wrapped for Angular.
`<skill>` is the skill folder, `<ws>` the workspace folder doctor printed. Nothing here edits a file.

## The question → the command

| The task asks | Run (each with `--root <ws>`) |
|---|---|
| How much AngularJS is left? | `ajs-facts summary` |
| Which AngularJS components / directives / filters / services exist? | `ajs-facts list components` (or `directives`, `filters`, `services`) |
| Which of them does nothing use? | `ajs-facts list <kind> --unused` |
| Which Angular classes are downgraded for AngularJS? | `ajs-facts list downgrades` |
| Which AngularJS components are wrapped for Angular? | `ajs-facts list wrappers` |
| Which ui-router states exist, and what does each show? | `ajs-facts list states` |
| Everything about one thing | `ajs-facts show <name>` |
| Every use of one thing, `file:line` | `ajs-facts usages <name>` |
| Does AngularJS still use this Angular component? | `ajs-facts usages <selector or Class>` |
| Which AngularJS templates set this input of an Angular component? | `ajs-facts usages <name>.<input>`, and `leftovers <Class>.<input> --before` |
| Which Angular screens does AngularJS enter? | `ng-facts where <Class>`: its line "AngularJS can show it" |

`<name>` is the registered camelCase name, its kebab-case element name, an Angular selector or a class name.
`--all` lists every row; without it a list shows the first 12. `list <kind> --under <folder>` keeps the rows registered in
that folder and prints the `file:line` of each.

## Procedure: what is left of AngularJS in one feature (one folder)

1. `node <skill>/ajs-facts.mjs summary --root <ws>`. Keep the counts per kind and the "notes" line.
2. Ask for the rows of the folder, once per kind (`components`, `directives`, `filters`, `services`, `downgrades`,
   `wrappers`, `states`):

   `node <skill>/ajs-facts.mjs list <kind> --under <folder> --all --root <ws>`

   `<folder>` is the path of the feature below `<ws>` (for example `src/app/orders`). Each line is one registration in a
   file of that folder: its name, the number of uses and its `file:line`. "0 … registered under": none of that kind.
3. For each printed name: `node <skill>/ajs-facts.mjs show <name> --root <ws>`. The card says what it renders, what it
   injects, whether an Angular twin exists, and every use with `file:line`.
4. Answer with a table: name, kind, `file:line`, number of uses, used from outside the folder (yes/no, from the card), Angular twin (yes/no).
Gate: every command exits 0, and every row of your table comes from a line of step 2 or a card of step 3.
A registration counts for the folder its file is in. A thing registered elsewhere and only used here is not in these lists:
`ajs-facts usages <name>` shows where it is used.

## Procedure: can this AngularJS thing be deleted?

1. `node <skill>/ajs-facts.mjs show <name> --root <ws>`. Gate: exit 0.
2. The card says "used 0 times" and has no note: nothing the reader can see uses it. Say what the reader cannot see (below).
3. It has uses: list them with `file:line`. It can go only after each use is gone.
4. Deleting it is a change: afterwards `node <skill>/ajs-facts.mjs usages <name> --root <ws>` must answer that the name is
   not registered any more, and `node <skill>/ls-facts.mjs check --root <ws>` must print `0 errors`.

## Procedure: an Angular component that AngularJS still uses

1. `node <skill>/ajs-facts.mjs usages <selector> --root <ws>`: the AngularJS templates and states that use the downgraded
   component, and the attributes they put on it.
2. `node <skill>/ng-facts.mjs usages <selector> --root <ws>`: the Angular templates that use it.
3. Before changing an input of it: `node <skill>/ajs-facts.mjs usages <name>.<input> --root <ws>` and
   `node <skill>/leftovers.mjs <Class>.<input> --root <ws> --before`. AngularJS templates write the input in kebab-case
   (`[my-input]="…"`, `my-input="…"`, `bind-my-input="…"`). No compiler checks those files: a rename or a removal there is by
   hand, and `leftovers` printing `DONE` afterwards is the only proof.

## What the reader does not see

- Markup and names built at run time (`$compile` of a string put together in code, a template fetched from a server).
- A name passed through a variable to `$injector.get(…)` or `$filter(…)`.
- A row that ends with "(see note)": the script met something it could not read with certainty. `show <name>` prints the note;
  read it and repeat it in your answer.
- Comments, CSS classes and spec files never count as a use.
