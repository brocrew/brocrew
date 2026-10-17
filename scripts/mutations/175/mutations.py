#!/usr/bin/env python3
"""
175 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What the table is about

⛔ **175 changes ONE source file.** §3 is the whole of this dispatch's app-side change: the watchdog
line names its top four spawned processes and dropped the rest silently, so `173` read `5.25 GB` in
the first clause of a sentence whose breakdown accounted for about `1.8 GB` and could not tell a long
tail of small children from one process nobody was naming. The tail is now a count and a sum.

  * **M1** deletes the tail — the defect exactly as `173` met it.
  * **M2** keeps the tail but reports a COUNT with no bytes, which is the tempting half-fix: it says
    how many were dropped and still leaves the arithmetic open.
  * **M3** sums the NAMED processes into the tail instead of the dropped ones, so the line adds up to
    something — just not to the total. A test that only checked "there is a tail" passes here.
  * **M4** puts the `slice` before the `sort`, which is the pre-existing ordering defect the old test
    guarded; it is in the table because the tail must not be what keeps that green.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **Everything in `scripts/ui-live-smoke.mjs`.** A smoke step is not run by `vitest` and cannot be
    mutated into a red here. 175's §1 second client, its rewritten timeout message, step `35`'s
    two-phase decode and step `35`'s new missing-file control are all LIVE assertions; what proves
    them is the run, and the runs are in the response doc with their scores.
 2. **The 90-second silence itself.** Whether the renderer, the browser process or the socket owns
    it is a fact about a running app under load; no mutation of this tree can red it.
 3. **The 5.25 GB observation.** §3 makes the sentence account for its own total. Whether the total
    is itself a defect is not this dispatch's question and is reported as an observation.
"""

import sys
from pathlib import Path

TREE = "apps/desktop/src/main/process-tree.ts"

MUTATIONS = [
    (
        "M1 · ⛔ 175 §3 · the dropped tail goes back to being silent — the line names four processes "
        "and says nothing about the rest, which is how 5.25 GB read as 1.8 GB",
        TREE,
        """  const rest = sorted.slice(limit)
  if (rest.length === 0) return named.join(' ')
  return [...named, `+${rest.length}more:${(totalBytes(rest) / 1024 ** 3).toFixed(2)}GB`].join(' ')""",
        """  return named.join(' ')""",
    ),
    (
        "M2 · ⚠️ the tail counts the processes it dropped and not their bytes — the half-fix: you "
        "learn that twenty were dropped and still cannot close the arithmetic",
        TREE,
        "`+${rest.length}more:${(totalBytes(rest) / 1024 ** 3).toFixed(2)}GB`",
        "`+${rest.length}more`",
    ),
    (
        "M3 · 🔴 the tail sums the processes it NAMED instead of the ones it dropped — a line that "
        "adds up, to the wrong number, which is worse than one that does not add up at all",
        TREE,
        "totalBytes(rest)",
        "totalBytes(sorted.slice(0, limit))",
    ),
    (
        "M4 · the slice comes before the sort again, so the four SMALLEST are named — in the table "
        "because a tail that states the remainder must not be what keeps the ordering green",
        TREE,
        """  const sorted = [...spawned].sort((a, b) => b.rssBytes - a.rssBytes)
  const named = sorted
    .slice(0, limit)""",
        """  const sorted = [...spawned].slice(0, limit).sort((a, b) => b.rssBytes - a.rssBytes)
  const named = sorted
    .slice(0, limit)""",
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, rel, find, replace = MUTATIONS[index]
    path = root / rel
    text = path.read_text(encoding="utf-8")
    hits = text.count(find)
    if hits != 1:
        print(f"!! anchor found {hits} times in {rel} — refusing", file=sys.stderr)
        return 1
    if not dry:
        path.write_text(text.replace(find, replace), encoding="utf-8")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--count":
        print(len(MUTATIONS))
        return 0
    if args and args[0] == "--name":
        print(MUTATIONS[int(args[1])][0])
        return 0
    dry = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]
    root = Path(args[0])
    if len(args) > 1:
        return apply(root, int(args[1]), dry)
    # No index: check every anchor without touching the tree (166 §11).
    bad = 0
    for i, (name, *_rest) in enumerate(MUTATIONS):
        result = apply(root, i, dry=True)
        print(f"{'ok  ' if result == 0 else 'BAD '} {name[:90]}")
        bad += result
    return bad


if __name__ == "__main__":
    raise SystemExit(main())
