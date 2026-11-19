---
name: angular-facts
description: Facts about this Angular workspace from Angular's own tools instead of text search. Use it BEFORE you search or edit whenever a task asks where a component, an input, an output or a class member is used, or asks to rename, remove or migrate one across templates and TypeScript.
---

# Angular facts

The scripts in this folder answer "where is this used?" from Angular's own tools. Ask them first. Search by text only for
what they cannot see, which is listed below. Run every command from the workspace root.

## The scripts

<!-- tool:ng-facts -->
### ng-facts: the compiler's template parser

`node .claude/skills/angular-facts/ng-facts.mjs <command> --root .`

- `usages <Class>.<input> [--all]` lists the template bindings of an input with file and line, bound and plain attribute form,
  external and inline templates. It ends with a line about the same name on other elements.
- `rename-input <Class>.<old> <new> [--write]` plans the rename of an input in the class and in its templates; `--write` applies it.
- `check` runs the compiler and prints its errors in a few lines.

It answers in under a second and works on code that does not compile. It knows templates only, one class at a time:
it does **not** follow `extends` (bindings on a component that inherits the input are listed as "other elements", not renamed)
and it does **not** see TypeScript code that reads the member. To list them, ask `usages <selector-of-the-subclass>.<input>` for each subclass.
<!-- /tool:ng-facts -->

<!-- tool:ls-facts -->
### ls-facts: the Angular Language Service, type-checked

`node .claude/skills/angular-facts/ls-facts.mjs <command> --root .`

- `refs <Class>.<member> [--all]` lists every reference of a class member: the declaration, template bindings on the class and
  on classes that inherit it, reads in template expressions and reads in TypeScript code. It ends with a count of the same
  word elsewhere.
- `rename <Class>.<member> <new> [--write]` plans the rename at every reference; `--write` applies it and runs the compiler.
- `check` runs the compiler and prints its errors, counted by message.

It follows types: inheritance, `viewChild`, services. It needs code that compiles and takes 5 to 10 seconds per command.
Lines that start with `!` say what it had to do, or could not do, to answer: read them.
<!-- /tool:ls-facts -->

<!-- tool:both -->
### Which one

Use ls-facts for the rename itself and for anything that depends on types. Use ng-facts for a quick count, for code that
does not compile yet, and as a second opinion: when the two disagree about a template binding, open the file.
<!-- /tool:both -->

## What no script sees

A name that is only text is invisible to a parser and to a type checker, and the compiler stays green when it is wrong:

- strings in code: `setInput("name", …)`, `inputs: ["name"]` and `hostDirectives` in decorator metadata, test harness calls;
- style sheets: attribute selectors such as `some-tag[name]`;
- a plain attribute (`<some-tag name>`) on an element the script did not match;
- files outside the compiled project: specs, stories, documentation.

## Renaming a member: the procedure

1. **Plan.** Run the rename without `--write` and read the groups and counts.
2. **Apply.** Run it again with `--write`.
3. **Look for what is left, one kind at a time.** The old name is usually still in the project hundreds of times, because
   other things share it. Do not read that whole list and never cut it with `head`: run these searches, each is short, and
   read every line of each:
   - strings in code: `git grep -nE "[\"'\`]<old>[\"'\`]" -- "*.ts"`
   - style selectors, in style sheets and in `styles:` of a component: `git grep -nE "[A-Za-z0-9_)*-]\[<old>"`
   - files outside the compiled project: `git grep -n "<old>" -- "*.spec.ts" "*.stories.ts" "*.md"`
   - anything a line of the script's output that starts with `!` says it left.

   Every hit is one of two things:
   - the same member on the class or on a class that extends it: change it by hand;
   - something else with the same name (another component's input, a class field, a comment, text): leave it.
   The element name in a selector, the class of the component that the code creates, and `extends` tell you which it is.
   Do not replace the word everywhere.
4. **Compile.** Run `check`. No errors is necessary, not sufficient: step 3 is the only check for names in text.
5. **Review.** `git diff --stat`, then say in your reply how many edits the script made, how many you made by hand and where.
