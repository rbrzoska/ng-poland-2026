# Move a class to another file or folder: every step

A move changes import paths. The compiler checks every import, so the compiler is the gate here. What it does not check
is a path written as text. `<skill>` is the skill folder, `<ws>` the workspace folder doctor printed.

1. **Who imports it.** `node <skill>/ls-facts.mjs refs <Class> --root <ws> --all`. Keep the files of its group "import and
   export statements". Run `node <skill>/ng-facts.mjs where <Class> --root <ws>` and keep the routes and states. Gate: exit 0.
2. **Move.** `git -C <ws> mv <old file> <new file>`, and the same for its template, style file, spec and story.
   (Doctor said "git: no": move the files with the shell.)
3. **Fix the paths.**
   - in the moved file: its own relative imports, `templateUrl`, `styleUrl` / `styleUrls`;
   - in every file from step 1: the import path of the class;
   - a lazy route (`loadComponent: () => import("…")`, `loadChildren`) and a barrel file (`index.ts`) that names the old path.
4. **Compile.** `node <skill>/ls-facts.mjs check --root <ws>`. Every error names a file and a line with a path that is
   still old: fix that line, run it again. Gate: 0 errors, exit 0.
5. **Text.** Search for the old path without the extension. This must print nothing:
   `git -C <ws> grep -n "<old path without extension>"`
   A line it prints is a path in text (a test setup, a story glob, documentation, a build config): change it, or put it in the
   report under "left on purpose" with the reason. Gate: exit 1 with no output, or every printed line is in the report.
6. **Still shown.** `node <skill>/ng-facts.mjs where <Class> --root <ws>` must list the same routes as before the move.
7. **Report** with the table from SKILL.md.

A move does not rename the class or the selector. For that, the selector and the class name are in templates, strings and
styles: use `ng-facts usages <selector>` for the elements and the two searches of `<skill>/reference/remove.md`, part B step 4.
