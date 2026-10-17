"""620 · The two checks nothing runs — a gate outside the chain, and a name outside its constant.

⛔ **Both halves of this dispatch are one shape: a rule that was written, that is correct, and that
nothing exercises.** ⚑ `db:check` was a gate `ci` never called; `DEFAULT_PROFILE_LABEL` was a name
two sentences restated instead of reading.

## 🔴 A · what `db:check` actually guards, which is NOT what ordered it

⚠️ **D22 asked for `db:check` in the chain because a migration stamped in the past is applied
silently** (`a-generated-migration-can-be-silently-skipped`). ⛔ **Measured on this tree, that is
not what `drizzle-kit check` does.** It reads `meta/*_snapshot.json` and never opens
`meta/_journal.json`:

| what was planted in the journal | `db:check` | `pnpm run test` |
|---|---|---|
| last entry's `when` = its predecessor's (a TIE) | ⚑ `EXIT=0`, *Everything's fine* | ⛔ **3 assertions RED** |
| last entry's `when` = predecessor − 1 | ⚑ `EXIT=0`, *Everything's fine* | ⛔ **3 assertions RED** |

🔴 **The journal was already guarded.** `522`'s `test/a-stamp-that-skips.test.ts` reads the
committed journal inside the `test` step — §2's upgrade path, §2's defect-put-back row, and §3's
*every stamp is strictly above the one before it* — so the hole D22 names has been closed since
`522` and the brief's *"nothing in those ten steps reads the journal"* is not the case.

⛔ **What is guarded by NOTHING is the snapshot chain**, and that is why the step is still worth
adding. ⚑ Measured the same way, on the same tree:

| what was planted in `meta/` | `db:check` |
|---|---|
| `0042_snapshot.json`'s `prevId` set to `0041`'s (two snapshots, one parent) | ⛔ **`EXIT=1`** — *"[…0041…, …0042…] are pointing to a parent snapshot: …0041…/snapshot.json which is a collision."* |
| `0042_snapshot.json` with its `tables` key removed | ⛔ **`EXIT=1`** — *"…0042_snapshot.json data is malformed"* |
| the committed tree (the control) | ⚑ `EXIT=0` |

⚠️ **That collision is `532`/`533`'s merge one layer deeper.** `a-stamp-that-skips.test.ts` §3
catches the `.sql`-against-journal direction of that merge; the `prevId` chain is the direction
nothing looked at, and the next `db:generate` diffs against whichever snapshot sorts last.

## ⛔ B · why the rule that should have caught this did not

🔴 **`gates-in-the-chain.test.ts` exists to say *a gate outside the chain is a gate that rots*
(306), and it was GREEN on the tree that shipped the defect.** ⚑ Measured as a 2×2, by restoring
`7e096b4f`'s bytes:

| | old `ci` (no `db:check`) | new `ci` |
|---|---|---|
| **old instrument** | ⛔ **green, 8 passed** — the rule passing while the thing it prevents sits in the tree | ⚑ green, 8 passed |
| **new instrument** | ⛔ **RED, 4 failed** — *"@brobot2/desktop's db:check"* named in the orphan list | ⚑ green, 10 passed |

⚠️ **Its roster was scoped by where a gate's code lives** — root manifest only, and then
`.filter((gate) => gate.script !== '')`, which drops any gate whose command is a third-party
binary. ⛔ **Two of the eight `*:check` scripts this repository declares were invisible to it**, and
one of those two was the only gate actually outside the chain.

🔴 **That is `a-guard-scoped-by-where-things-live-today-expires-silently` (`HO-070` §2, standing
rule 27.1) for the fourth time** — after `SideRail.vue` (449), `project-roster.ts` (472) and
`team-roster.ts` (568) — ⚑ and its closing instruction is why the repair WIDENS the roster instead
of adding one name to it.

## ⚠️ C · what has NO row, said rather than left out

⛔ **No row mutating `gates-in-the-chain.test.ts`'s own derivation.** ⚑ A weakening of an
instrument is invisible to that instrument (`a-mutation-on-a-census-is-invisible-to-that-census`),
so the widening is held by the two controls INSIDE it — *a gate with no source of ours* and *a gate
in another manifest* — and by the 2×2 above, which is the measurement a row could not make.

⛔ **No row corrupting a snapshot to make `db:check` red.** ⚠️ The table runner applies text edits
and runs vitest killers; `db:check` is not a vitest project, so such a row could not be killed by
anything the runner knows how to run. ⚑ **The verdict is recorded in table A above instead** —
by hand, one plant at a time, restored from bytes — which is the same durable record a row's
killer file is (`verify-each-mutation-row-without-running-the-table`).

⛔ **No row on `592`'s own `homesFootnote` literal being wrong.** ⚑ It was not wrong; it was
UNDERIVED. `592` wrote `BroBot` by hand with its reason beside it, and `M6` is the row that keeps
the reading of the constant rather than the spelling of the word.

## 🔴 D · the D23 rows, and the one thing they are NOT about

⚠️ **`DEFAULT_PROJECT` is still the string `default` and every row below leaves it alone.** ⛔ One
word, two subjects (`two-questions-about-one-address`) — which is exactly why `592`'s sweep missed
its second sentence and why `M5`'s killer asserts the negative on the CLAIM (`offers \\`default\\``)
rather than on the word.
"""

from __future__ import annotations

PKG = "package.json"
CLI = "scripts/clean-base.mjs"
LIB = "scripts/lib/clean-base.mjs"

# ⚠️ **RE-ANCHORED at 706, not retired.** `706` put `gate-only:check` (the tests that start
# `clean-base`, run only by the gate) between `mutations:check` and `test`, so the chain this row
# names is one step longer. ⚑ The DEFECT each row plants is unchanged: `db:check` leaves the chain
# (`M1`), or runs after `test` (`M3`). Re-verified RED alone with `verify_row.py`.
# ⚑ **launch item 8 · re-anchored in place, not retired** — the leak guard put `leak:check` second
# in the chain; `M1`'s defect is unchanged.
CI_CHAIN = (
    '"ci": "pnpm run engine:check && pnpm run leak:check && pnpm run typecheck && pnpm run lint && '
    "pnpm run format:check && pnpm run db:check && pnpm run mutations:check && "
    "pnpm run gate-only:check && pnpm run test"
)
DELEGATION = '"db:check": "pnpm --filter @brobot2/desktop db:check"'
LABEL = "export const DEFAULT_PROFILE_LABEL = 'BroBot'"
NEXT_LAUNCH = (
    "      `${opening} and no profiles: ${HOMES_DIRNAME}/ is gone, so the launcher offers ` +\n"
    "      `${DEFAULT_PROFILE_LABEL}'s own profile and nothing else. ` +"
)
FOOTNOTE = (
    "        ? `      afterwards the launcher would offer ${DEFAULT_PROFILE_LABEL}'s own profile, "
    "and nothing else`"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the gate, back outside the chain ───────────────────────────────────────────────────
    (
        "M1 · 🔴 **the gate leaves the chain and the chain says nothing** · `db:check` is dropped "
        "from `ci`, which is the tree `main` carried until this dispatch. ⛔ The snapshot chain "
        "goes unguarded — a `prevId` collision, which is what two branches generating from one "
        "base leave behind (`532`/`533`), passes all eleven remaining steps — and the next "
        "`db:generate` diffs against whichever snapshot sorts last. ⚑ **This is the row the whole "
        "dispatch exists for**, and the instrument that kills it had to be widened before it "
        "could: measured on `7e096b4f`, the previous version of "
        "`gates-in-the-chain.test.ts` was GREEN on exactly this text",
        [(PKG, CI_CHAIN, CI_CHAIN.replace(" && pnpm run db:check", ""))],
    ),
    (
        "M2 · ⛔ **the delegation points at a package that does not exist** · the root script "
        "survives, is still in the chain, and reaches nothing. ⚠️ **A distinct failure from `M1`**: "
        "there the gate is unreferenced, here it is referenced by a name no manifest answers to — "
        "and `pnpm --filter` on an unmatched selector is not an error. ⚑ It is the row that proves "
        "coverage is decided by FOLLOWING the delegation rather than by a bare script name two "
        "manifests can both declare (`a-file-level-contains-cannot-tell-sibling-declarations-apart`)",
        [(PKG, DELEGATION, '"db:check": "pnpm --filter @brobot2/nothing db:check"')],
    ),
    (
        "M3 · ⚠️ **the cheap check moves behind the expensive one** · `db:check` runs after `test`, "
        "so a two-second consistency failure is reported two minutes late and only when the suite "
        "happens to pass. ⛔ The step is still in the chain and still red on a real defect, which "
        "is why this needs its own row: the rule being broken is *the cheap consistency checks "
        "fail fast together*, and nothing about a green run can see it",
        [
            (
                PKG,
                # ⚠️ **RE-ANCHORED at 706, not retired** — see `CI_CHAIN`'s note.
                "pnpm run db:check && pnpm run mutations:check && pnpm run gate-only:check && "
                "pnpm run test",
                "pnpm run mutations:check && pnpm run gate-only:check && pnpm run test && "
                "pnpm run db:check",
            )
        ],
    ),
    # ── B · the name, back outside its constant ────────────────────────────────────────────────
    # ⛔ **706 · M4–M6 were killed ONLY by `scripts/gate-only/clean-base.test.mjs`** until `717` (M5 and M6 still are), which spawns
    # `clean-base` and so runs only inside `pnpm run ci` — and `ci` never applies a row. ⚠️ Until
    # `717` (below), no instrument could re-verify these three RED (`verify_row.py` refuses the killer, a table run
    # cannot reach it); they keep the verdicts they last earned (`706`'s response doc asks for a ruling).
    # ⚑ **717 · R45 split that file, and `M4` is back**: §2's label test moved to
    # `scripts/test/clean-base-without-running-it.test.mjs`, and `M4` went RED alone against it (its
    # label names it now). ⛔ `M5` and `M6` SURVIVED it — their only killer still spawns the script.
    (
        "M4 · 🔴 **the copied label drifts from the product's own** · this `.mjs` has no build step "
        "for `runtime-ipc.ts`, so the spelling is copied and held in step by a test — the boundary "
        "`PATH_SEGMENT`, `BUNDLE_NAME` and `DEFAULT_PROJECT` already cross in this same file. ⛔ "
        "With the pin gone a reset would tell a person, in its last line, the name of a profile "
        "the launcher does not have. ⚑ The plant is a plausible drift and not a nonsense string: "
        "`Brobot` is what a careless fold of the slug produces — killed by `clean-base-without-running-it.test.mjs`",
        [(LIB, LABEL, "export const DEFAULT_PROFILE_LABEL = 'Brobot'")],
    ),
    (
        "M5 · ⛔ **the last line a person reads before relaunching names `default` again** · this "
        "is D23 exactly as it stood: the sentence `592` renamed the profile out from under and its "
        "sweep could not find, because the claim is split across a `+` at a line break and the "
        "backtick is escaped inside a template literal. ⚠️ **Three greps missed it and the fourth "
        "found it only because a control proved the first three were broken** "
        "(`a-negative-is-only-as-strong-as-the-search-shape`). ⚑ The killer asserts the CLAIM and "
        "not the word — the same line says *one default project* and always will",
        [
            (
                CLI,
                NEXT_LAUNCH,
                "      `${opening} and no profiles: ${HOMES_DIRNAME}/ is gone, so the launcher "
                "offers \\`default\\` ` +\n      `and nothing else. ` +",
            )
        ],
    ),
    (
        "M6 · ⚠️ **the other sentence stops reading the constant** · `592` repaired this one and "
        "wrote the name as a literal, which was correct and undefended: with the read replaced by "
        "a word, the two sentences can disagree about what this app is called and nothing notices. "
        "⛔ **The plant is the OLD word rather than a different capitalisation**, because a literal "
        "equal to the constant's current value is a mutation that changes nothing and reports as a "
        "survivor (`a-mutation-that-changes-nothing-reports-as-a-survivor`)",
        [
            (
                CLI,
                FOOTNOTE,
                "        ? `      afterwards the launcher would offer \\`default\\`, and nothing else`",
            )
        ],
    ),
]
