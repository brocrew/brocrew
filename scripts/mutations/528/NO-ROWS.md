# 528 · why this directory has no `mutations.py`

⛔ **`528` §5 asks for a check and its tests. Every line `528` wrote lives in a file the mutation
harness is forbidden to touch, so a table here could hold no row that measured anything.** This file
is the refusal rather than an absence somebody has to guess at, following `277`.

`scripts/mutations/census.py` discovers tables with `(p / "mutations.py").is_file()`, so a directory
without one is invisible to `pnpm run mutations:check` and to `CENSUS.md`.

## What 528 changed, and why none of it is mutable

| change                                                                                       | mutable?                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/mutations/census.py` — the retirement rail, its vocabulary, the refusal, `--retire` | ⛔ **a protected evidence authority.** Measured at this commit: `is_protected_authority(REPO, "scripts/mutations/census.py")` → `True`, and `validate_authority` on a row naming it raises `the runner cannot mutate its own evidence authority: scripts/mutations/census.py`. A `528/mutations.py` carrying such a row would fail `census.py --check`'s own definition preflight, so the table could never be censused, let alone run. |
| `scripts/test/mutation-census.test.mjs` — the planted retirement, the controls               | ⛔ same list, same measurement → `True`. And `a-mutation-on-a-census-is-invisible-to-that-census`: a row that WEAKENED an assertion here would pass the assertion it weakened.                                                                                                                                                                                                                                                          |
| `scripts/mutations/README.md` — the integrator's paragraph                                   | ⚠️ not protected, and not code. No test can go red on it, so every row over it would survive by construction.                                                                                                                                                                                                                                                                                                                           |
| `scripts/mutations/CENSUS.md`, `scripts/mutations/ATTESTATION.json`                          | ⛔ protected, and generated.                                                                                                                                                                                                                                                                                                                                                                                                            |

⚠️ **A table of guaranteed survivors is worse than no table** — `238`'s finding, and `277` refused
the same padding for the same reason.

## What DOES gate 528's conclusion

⚑ **The rail is measured by violating it, which is the only measurement available to a file the
harness may not mutate** (standing rule 20; `498` is the precedent).

`scripts/test/mutation-census.test.mjs` §`a retirement is announced, never absorbed (528, HO-050 §3)`
builds one disposable tree, plants three rows going dark in three different ways beside one already
recorded as retired, and drives **the real `census.py`** over it. Its last stage drives the **same
planted state** through a copy of `census.py` whose refusal has been turned back into a print —
`469`'s shape, a step that passed either way — and records that the copy then writes and exits `0`
while printing the identical words. That A/B is the control the mutation harness cannot provide.

⛔ **It is not a substitute for a table and is not reported as one.** It measures one rail, from one
direction, on one weakening chosen by hand.
