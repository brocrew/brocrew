#!/usr/bin/env python3
"""306's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **`306` is one line of `package.json` and a rule.** `301` built `pnpm run fixture:check` — the
instrument that proves a placeholder surface follows a CHANGED fixture, HO-002 §5 acceptance #6 —
and could not put it in `ci`, because `241 M11`, `271 M26` and `271 M27` between them pinned
`build && window:check && quit:check"` as one contiguous string and `301` §5 forbade correcting
another dispatch's table. So the instrument written because a mechanism nobody exercised turned out
to be broken was itself run by nothing.

⚑ **The one-line edit is not the deliverable.** Three rows in three dispatches have now been broken
by ordinary growth at the same spot — each anchored on text ending at the `ci` value's closing
quote, which is the one place a gate is ever appended — and each time the repair was to re-state,
per instrument, that it is in the chain. `apps/desktop/test/gates-in-the-chain.test.ts` states the
rule ONCE and DERIVES it from `package.json`, so a fourth instrument is covered without anybody
remembering to add a test. Most of the rows below are about that file.

| rows | the defect is caught by |
|---|---|
| `M1`-`M2` | ⚑ **`desktop`** — the chain itself: the gate removed, and the gate moved before `build` |
| `M3`-`M5` | ⚑ **`desktop`** — the rule weakened until it stops discriminating |
| `M6`-`M7` | ⚠️ **nothing** — they make a guard assert nothing, and this repository has no test of its tests. Recorded as expected SURVIVED with the reason, rather than left to read as a gap |

## ⛔ What this table cannot reach, said out loud

⚠️ **No row here is killed by `fixture:check` itself**, and not for want of trying: `mutate.sh` can
only print product channels the census can parse, and `census.py`'s `CHANNEL_RESULT` accepts exactly
one name — `window`, added by `241`. A `fixture` column would make this table's artefact
unparseable and the table `partial-or-invalid`. ⛔ `298` is rebuilding the runner; widening that
vocabulary is its business, not a change to make from here.

⚑ **So the gate's own failure is demonstrated OUTSIDE this table**, in `306`'s response: a per-path
memo planted in `apps/desktop/src/main/demo-seed.ts` — negating the one property that file's docblock
claims in as many words, *"read on every call rather than cached"* — passes `typecheck`, `lint`,
`format:check`, `mutations:check`, **all 5,788 tests**, `build`, `window:check` and `quit:check`, and
reddens `pnpm run ci` at `fixture:check` alone.

⚠️ **This table does NOT mutate `scripts/fixture-follow-check.mjs`.** `301 M22`-`M26` already own
those five strings; `306` gave them a killer by pinning them in `gates-in-the-chain.test.ts`, and a
second table asserting the same propositions would be evidence about nothing new.

⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258, 262, 292, 300 and 301, this table does NOT mutate the
harness it is run by, and it touches no other dispatch's table.
"""

from __future__ import annotations

import sys
from pathlib import Path

PKG = "package.json"
GATES = "apps/desktop/test/gates-in-the-chain.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── the chain ─────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row removes `fixture:check` from
        # the ci chain, and D-016 deleted that gate on purpose: package.json lost the
        # `fixture:check` script and its chain entry, and gates-in-the-chain.test.ts now says 'D-016
        # deleted `fixture:check` and `scripts/fixture-follow-check.mjs`: the demo seed it followed
        # into Home is gone'. The same chain-membership rule for the two surviving launchers is held
        # by 241 M10 and 271 M26/M27, whose package.json anchors each count 1 today. Its anchor is
        # left stale, so the census records it retired.
        "M1 · ⛔ `fixture:check` leaves the ci chain — 306's whole subject, put back. The instrument "
        "still exists, still passes when run by hand, and guards nothing: *'a correct policy that "
        "nothing calls leaves the defect exactly where it was'*. ⚑ This is the state `301` shipped "
        "and reported, and the state acceptance #6 was written to catch",
        [(PKG, " && pnpm run fixture:check", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row moves `fixture:check` before
        # `build`, and that gate no longer exists: it is deleted from package.json and
        # scripts/fixture-follow-check.mjs is deleted. The 'launcher runs after build' rule stays
        # derived over the remaining gates in gates-in-the-chain.test.ts and is planted by 241 M11
        # and 306 M4. Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ …and the subtler one, which is `241 M11`'s defect at the new gate: it runs BEFORE "
        "`build`, so it launches whatever the last run left on disk and reports a green about a "
        "bundle that is not the one under test",
        [
            (
                PKG,
                "pnpm run build && pnpm run window:check && pnpm run quit:check && pnpm run fixture:check",
                "pnpm run fixture:check && pnpm run build && pnpm run window:check && pnpm run quit:check",
            )
        ],
    ),
    # ── the rule, weakened until it stops discriminating ──────────────────────────────────────
    (
        "M3 · 🔴 the roster stops being DERIVED and becomes the gates somebody remembered — which is "
        "the whole defect this file exists to end. `fixture:check` was invisible to the two "
        "per-instrument assertions in `one-app.test.ts` for exactly this reason, and so would the "
        "fifth gate be",
        [
            (
                GATES,
                "  .filter(([name]) => name.endsWith(':check'))",
                "  .filter(([name]) => ['window:check', 'quit:check'].includes(name))",
            )
        ],
    ),
    (
        "M4 · ⛔ the after-`build` comparison is inverted, so the rule complains about the gates that "
        "are correctly placed and passes the one that is not. ⚑ A row about the DIRECTION rather "
        "than the existence of the check: `241 M11` is the defect it is guarding",
        [
            (
                GATES,
                "      return CI.indexOf(`pnpm run ${gate.name}`) < build",
                "      return CI.indexOf(`pnpm run ${gate.name}`) > build",
            )
        ],
    ),
    (
        "M5 · 🔴 the opt-out sentence widens to something nearly every file contains, so ANY gate "
        "can leave the chain by saying nothing in particular — the rule survives as text and stops "
        "discriminating. ⚠️ Killed only by the NEGATIVE control (a gate that must NOT satisfy the "
        "sentence); every positive assertion in the file passes on the mutant",
        [(GATES, "const SAYS_WHY_NOT = 'NOT part of `pnpm run ci`'", "const SAYS_WHY_NOT = 'ci'")],
    ),
    # ── the instrument, weakened from the inside ──────────────────────────────────────────────
    (
        "M6 · ⚠️ the chain rule is computed over NOTHING — `193`'s vacuity in the guard written to "
        "stop a gate rotting outside the chain: every gate could leave and the assertion would "
        "still print an empty list. ⛔ EXPECTED SURVIVED: this repository has no test of its tests, "
        "and the row is here so that absence is recorded rather than inferred",
        [
            (
                GATES,
                "    const orphaned = GATES.filter(",
                "    const orphaned = GATES.filter(() => false).filter(",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `describe('…and the fixture
        # instrument cannot quietly ask for less (301 M22-M26)')` block with the `toBe(1)` pins was
        # deleted in the commit, as the diff shows ('The instrument's own "cannot quietly ask for
        # less" block went with it'). Nothing in gates-in-the-chain.test.ts contains the anchor any
        # more (count 0), and the file it pinned is deleted. Its anchor is left stale, so the census
        # records it retired.
        "M7 · ⚠️ the five pins on `fixture-follow-check.mjs` stop asserting a count, so a weakened "
        "instrument — `301 M22`-`M26`, every one of them — passes the guard that was added to kill "
        "it. ⛔ EXPECTED SURVIVED, same reason as `M6`",
        [
            (
                GATES,
                "`${needle} is no longer in the check, or is no longer unique`).toBe(1)",
                "`${needle} is no longer in the check, or is no longer unique`).toBeGreaterThanOrEqual(0)",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name.split(' ·')[0]}: anchor found {hits}x in {rel} (expected exactly 1)")
            return 1
        if find == replace:
            print(f"!! {name.split(' ·')[0]}: replacement equals the original in {rel} — a no-op row")
            return 1
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
