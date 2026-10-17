"""387 · the explanation that stopped matching — each row is THE DEFECT, put back (131).

🔴 **A test went red with its subject and its suite byte-identical to the commit that shipped them.**
`git diff 21e022f..529649c -- scripts/lib/ scripts/test/` is empty; `360` wrote both files and
nothing has touched either since. ⛔ **What changed was the `node` on the `PATH`**, and nothing in
the repo was reading the version it declares.

## ⚑ The two facts this table protects

⛔ **`fs.rmSync` is the JS `rimraf` on Node 20 and 22 and a C++ binding on 24, and they fail
differently.** Measured on this machine, one fixture, an unremovable file behind a `0500` directory:

```
  v20.19.3 / v22.22.0   EACCES      10 survivors   0 directories emptied
  v24.0.2               ENOTEMPTY    6 survivors   1 directory emptied
```

⛔ **`Date.now()` floors to the integer millisecond and an mtime does not.** Measured: 200 files each
written and then followed by a `Date.now()` reading — **193 of 200** carried an `mtimeMs` at or above
a stamp taken AFTER the write, median `+0.49ms`, on both runtimes. Every one of them would have been
reported as *"written 0ms AFTER the removal was asked — so something was still WRITING"*, which is
`360`'s false accusation arriving by arithmetic instead of by directories.

🔴 **The safety property, in the direction the rows read.** Nothing here widens what an agent may do.
What is protected is that **a removal never accuses a writer it cannot be certain of** (`M1`), that
**it does not stop naming one it can** (`M2`), and that **the gate refuses to measure a function
other than the one the repo ships** (`M3`-`M5`).

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M2` | ⚑ **`run_suite`** — `scripts/test/owned-teardown.test.mjs`, the millisecond pair |
| `M3`-`M5` | ⚑ **`run_suite`** — `scripts/test/engine-check.test.mjs` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row that puts the millisecond back on the DIRECTORY filter.** `360`'s `M16` already owns
*"the directories are counted and never mentioned"*, and the threshold on that side is `>= askedAt`
exactly as it was before this dispatch — the line is byte-identical, so a row here would be `360`'s
row rewritten against a line that did not move.

⛔ **No row on the per-entry rendering.** `360`'s `M17` owns *"the summary and the list under it say
different things"*, and `387` re-anchored it onto the derived form rather than adding a second row
about the same sentence.

⛔ **No row that makes `theRuntimeThisFixtureNeeds` pass on Node 20.** It is a precondition inside a
test, and a mutation table measures the product. ⚠️ The rule it states is `M3`-`M5`'s, where the
product actually enforces it; a row in a test file would be a mutation on a census, invisible to the
census.

⚠️ **No row on the `ps` `state` shape** in `owned-process.test.mjs`. `387` replaced an equality
against a second live reading with a shape and a control — that is a test correction, and the field
it protects is `333`'s, whose rows already stand.
"""

TEARDOWN = "scripts/lib/owned-teardown.mjs"
ENGINE = "scripts/engine-check.mjs"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the millisecond Date.now() throws away ───────────────────────────────────────────
    (
        "M1 · 🔴 the file filter loses its headroom, so an entry stamped inside the ask's OWN "
        "millisecond is an accusation · measured at 193 of 200 writes, and it is 360's false "
        "*“something was still WRITING”* reached by arithmetic instead of by directories",
        [
            (
                TEARDOWN,
                "    (entry) => entry.isDirectory !== true && entry.mtimeMs >= askedAt + A_WHOLE_MILLISECOND,",
                "    (entry) => entry.isDirectory !== true && entry.mtimeMs >= askedAt,",
            )
        ],
    ),
    (
        "M2 · ⛔ the headroom grows into a blindfold, so a survivor a real writer touched a whole "
        "second after the ask is filed as a slow unlink · the rule is *“accuse only what you are "
        "sure of”*, never *“accuse nothing”*",
        [
            (
                TEARDOWN,
                "const A_WHOLE_MILLISECOND = 1",
                "const A_WHOLE_MILLISECOND = 120_000",
            )
        ],
    ),
    # ── §2 · the gate measures the function this repo ships ───────────────────────────────────
    (
        "M3 · 🔴 the runtime check always answers *“fine”*, so `pnpm run ci` runs on whatever "
        "`node` happens to be first on the PATH · this is the hole the dispatch was named after: "
        "three days red, with the subject and its suite byte-identical to the commit that shipped "
        "them",
        [(ENGINE, "  if (atLeast(version, minimum)) return null", "  if (true) return null")],
    ),
    (
        "M4 · ⛔ a range it cannot read is waved through instead of refused · `325`'s `holdersOf` "
        "returned `[]` on any failure and the caller read that as *“nothing holds the port”*; a "
        "version check that answers *“fine”* to a range it never parsed is the same defect",
        [
            (
                ENGINE,
                "  if (match === null) {\n    throw new Error(",
                "  if (match === null) {\n    return [0, 0, 0]\n    throw new Error(",
            )
        ],
    ),
    (
        "M5 · ⚠️ `.nvmrc` and `engines.node` are allowed to disagree, so the remedy the message "
        "prints — *“use the `.nvmrc`”* — sends a person to a version the gate will refuse next",
        [
            (
                ENGINE,
                "  if (pinned === null || pinned < minimum[0]) {",
                "  if (false) {",
            )
        ],
    ),
]
