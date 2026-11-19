# Whose name is this? How to decide a place by hand

Use this for every line `leftovers` marks `?`, and before every edit you make by hand.
`<Class>.<name>` is the member the task is about.

## The forms a member name takes

| Where | How the name is written | Who checks it |
|---|---|---|
| Angular template, bound | `[name]="…"`, `[(name)]="…"`; an output: `(name)="…"`; a `model()`: also `(nameChange)="…"` | compiler, ng-facts, ls-facts |
| Angular template, plain attribute | `<some-tag name>` or `<some-tag name="text">` | ng-facts, ls-facts; the compiler does NOT |
| AngularJS template (a `.html` file Angular does not compile) | kebab-case: `[my-name]="…"`, `my-name="…"`, `(my-name)="…"`, `bind-my-name`, `on-my-name` | only leftovers |
| TypeScript code | `thing.name`, `thing.name()`, `this.name.set(…)` | compiler, ls-facts |
| A string in code | `setInput("name", …)`, `inputs: ["name"]`, `inputs: ["name: alias"]` in `hostDirectives`, `@HostBinding("attr.name")`, `By.css("some-tag[name]")` | only leftovers |
| A story or a test | `args: { name: … }`, `componentInputs: { name: … }`, `componentProperties`, `props` | only leftovers |
| A style sheet, or `styles:` of a component | `some-tag[name]`, `[name]`, `.some-class[name]` | only leftovers |
| Documentation | the name in prose or in a code sample | nobody: decide with the user |

## The decision, step by step

1. Find what the place talks about: the element (the tag the attribute sits on, or the tag before `[name]` in a style
   selector) or the class (the component a test creates, the `component:` of a story, the `directive:` of a host directive).
2. An element: ask which class owns the tag. `node <skill>/ng-facts.mjs usages <tag> --root <ws>` prints the class and its
   file in the first line. "no component or directive" and exit 1: the tag is not an Angular component of this project.
3. The class is `<Class>`, or a class that extends it (`leftovers` prints the family in its second line; the other scripts
   print "extends `<Class>`"): it is the member. **Change it.**
4. The class is something else, or the tag is a plain HTML element: it only shares the name. **Leave it** and put it in the
   report under "left on purpose" with the class you found.
5. You cannot find the element or the class (a string built at run time, prose, a tag nobody declares): do not guess.
   Leave it and put it in the report under "not decided" with the line you saw.

## How to edit by hand

- Change the name on that line only. Keep the form: `[old]` becomes `[new]`, `old-name` becomes `new-name` in an AngularJS
  template, `"old"` becomes `"new"` in a string.
- One place, one edit. Never run a replace over a file or a folder.
- After the edits run the same `leftovers` command again. A `?` you leave on purpose (step 4) or cannot decide (step 5) goes
  into the command as `--decided <file:line>` and into the report. It is finished when it prints `DONE` and exits 0;
  `NOT DECIDED` means a `?` is still open.

## Cases that fool a reader

- **Alias.** `input({ alias: "shown" })` or `@Input("shown")`: templates bind `shown`, code reads the member name.
  Renaming the member does not change templates while the alias stays; `ls-facts rename` says so in a `!` line.
- **Two-way.** A `model()` named `value` is bound as `[(value)]`, `[value]` and `(valueChange)`. A rename changes all three forms.
- **Declared again in a subclass.** A class that extends `<Class>` and declares the same name again has a member of its own.
  Do not decide alone whether it is part of the task: put it under "not decided".
- **Two owners on one element.** `<some-tag [name]>` where a directive on the same element also has an input `name`: the one
  attribute feeds both. Changing it for one breaks the other: put it under "not decided".
- **A word inside a longer word.** `name-size`, `nameChange`, `--name`, `data-name` are other names. Leave them, except
  `(nameChange)` of a `model()` (the row above).
- **The same line twice.** A line that `leftovers` lists twice holds the name twice (two selectors, two attributes): two places.

## Stories and tests: two cases where one place means two edits

No compiler reads a template that is a string in a story or a test, so nothing warns you here.

- **A story template reads the keys of `args`.** In a `*.stories.ts` file the template string is fed from `args`
  (`args: { name: … }`, `argTypes: { name: … }`). The type-checked rename renames those keys (its group "set as a key of an
  object literal", in spec/stories files). Then in the template string of that file the same word on the RIGHT side of a
  binding is that key and must follow: `[old]="old"` becomes `[new]="new"`, both sides. `leftovers` lists such a line
  twice: once for the left side, once for the right side ("the right side of … reads …"). The right side is `?` while the
  file still has a key `old` (it follows that key) and `CHANGE` once the key is renamed.
- **A test stub stands in for the component.** A stub class in a spec with the same selector has its own copy of the member;
  `leftovers` marks it `CHANGE` ("stands in for … in a test"). After you rename it, the spec's own code that reads the stub
  (`stub.old()`, `setInput("old", …)` on the stub) must follow too.

After editing such a file by hand, run `git -C <ws> grep -n -w "<old>" -- <that file>` (doctor said "git: no":
`grep -n -w "<old>" <that file>`). Every line it still prints must be something you can name (another component's
attribute, a comment, a field of the test's own host component). Put those under "left on purpose".
`check` compiles the build only: a spec or a story is in no gate. Its diff (`git -C <ws> diff -- <that file>`) is the review;
write "reviewed by diff, not compiled" in the report.
