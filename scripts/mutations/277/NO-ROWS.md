# 277 · why this directory has no `mutations.py`

⛔ **`277` §4 asks for mutation rows. `277` §4 also says that if phase one lands on option (b) —
keep the queue — the right dispatch _"ships no product code"_. It landed on (b), so there is no
behaviour here to kill, and this file is the refusal rather than an absence somebody has to guess
at.**

`scripts/mutations/census.py` discovers tables with
`p.is_dir() and (p / "mutations.py").exists()`, so a directory without one is invisible to
`pnpm run mutations:check` and to `CENSUS.md`. That is deliberate: the census counts tables that
make claims, and 277 makes none.

## What 277 changed, and why none of it is mutable

| change                                                                              | mutable?                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/runtime/runtime-host.ts` — the `queued` docblock, corrected  | ⛔ a comment. No behaviour, no test, nothing to kill.                                                                                                       |
| `packages/runtime/src/runtime.ts` — `SessionHandle.interrupt`'s docblock, corrected | ⛔ same.                                                                                                                                                    |
| `packages/runtime/smoke/steer-probe.smoke.ts` — the instrument                      | ⚠️ no vitest project runs `smoke/**`, so every row over it would survive **by construction** — the structural survivor `241 M10` and `275 M28` both record. |
| `package.json` — one `probe:steer` script                                           | ⛔ not code.                                                                                                                                                |

⚠️ **A table of guaranteed survivors is worse than no table.** `238`'s finding is a row sitting
green beside prose insisting it must die; writing four such rows here so the directory looks like
its neighbours would manufacture exactly that, and `252`'s phantom survivor (`old == new`) is the
same failure by a shorter route. `269` added a tripwire on ordinary growth precisely so this
directory is not padded.

## What DOES gate 277's conclusion

⚑ **The conclusion is that the app's two existing gestures — the app-side queue and
interrupt-and-send — are the answer, and both are already pinned by live steps ON CODEX**, which is
the provider whose `turn/steer` was in question:

- **step 47** — _"a message queued mid-turn waits, then sends as its own turn (077)"_, `provider: 'codex'`
- **step 48** — _"interrupt-and-send stops the turn and takes the new message (077)"_, same session

Adding a third step would duplicate them. ⚠️ What 277 owes instead is that those two still pass at
this commit, which its response records.

The measurement itself is replayable by anyone at this commit: `pnpm run probe:steer`
(`STEER_ONLY=A,B,C,D,E` selects sections). ⛔ **That is the artefact `145 LOW 2` asks for** — a
claim nobody can replay is a claim — and it is the instrument, not a mutation table, because what
277 produced is a ruling rather than a behaviour.
