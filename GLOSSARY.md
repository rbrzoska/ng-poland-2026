# Angular facts for agents

Research and tooling that let AI agents answer questions about an Angular application, and change it, from Angular's own
parser and type checker instead of text search.

## Language

**Fact source**:
A script that answers a question about the application from Angular's own template parser, the Angular Language Service
or the AngularJS registrations, never from text search alone.
_Avoid_: tool (too broad), MCP

**Impact**:
Everything that names a component or member before it is changed or removed: its type-checked references plus its
leftovers.
_Avoid_: blast radius, usages (only part of it)

**Leftover**:
A place that still names a changed or removed component or member and that no compiler checks: a name in a string, a
style selector, an AngularJS template, plain JavaScript, a spec, story or document.
_Avoid_: residue, remaining usage

**Gate**:
A machine check at the end of a procedure that says whether the work is finished, by exit code and a DONE or NOT DONE
line, so that "finished" never rests on the agent's own judgement or on a green compiler.
_Avoid_: check (too broad), validation

## AJS removal

**AJS removal**:
Deleting an application's AngularJS code and replacing what it did with modern Angular, until nothing AngularJS is left.
It comes in two kinds: screen removal and store migration.
_Avoid_: AngularJS migration, JS migration, upgrade (confused with ngUpgrade), modernization

**Screen removal**:
An AJS removal in which a screen, dialog or wizard is rewritten as Angular components and its AngularJS components,
templates, controllers and states are deleted.
_Avoid_: rewrite, port

**Store migration**:
An AJS removal in which the legacy AngularJS data layer (the shared store and its NgRx slices) is replaced by API
services and signal stores, while the screens that read it stay.
_Avoid_: store removal, state refactor

**Legacy store**:
The shared data store of the AngularJS era that both AngularJS and Angular screens read and write, together with the
store slices it keeps per kind of resource.
_Avoid_: old store, Redux store, global state

**Bridge**:
Code that keeps a legacy store slice filled from the new data layer, only so that screens not yet migrated keep working;
it is removed with the last reader of that slice.
_Avoid_: shim, adapter, workaround

**Expected reader**:
A place that still reads a migrated resource from the legacy store and is allowed to for now, with the reason and the
change that will remove it. Any other reader is a defect.
_Avoid_: allowed usage, exception

**Replay**:
Running a finished, merged AJS removal again from the state before it, so that an agent's result can be compared with
what the team actually merged.
_Avoid_: rerun, backtest

**Modernization**:
Moving existing Angular code to newer Angular APIs (signal inputs, outputs and queries, built-in control flow,
standalone components, `inject()`).
_Avoid_: migration (reserved for AngularJS migration)
