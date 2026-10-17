#!/usr/bin/env python3
"""
184 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What this table is about

The wire declares three identities on every frame that can teach {@link PatchTargets} anything —
`threadId`, `turnId`, `itemId` — and on the approval that reads it back. 181 kept ONE. 182 H3: a
late, foreign or simply older frame reusing an active item id put a benign path on a card about a
dangerous one, with `underDisclosed: false` beside it; and `item/fileChange/patchUpdated` reached the
tracker from OUTSIDE the turn gate, so a stream of unique foreign ids could also just evict the entry
the running turn needed.

Row by row:

  * **M1** collapses the key back to `itemId` alone — the reported defect, verbatim, and the row the
    whole table is about. ⚑ Note which tests it turns red: the ones about a LATER TURN, not the ones
    about a foreign frame. That is the point — the gate and the key answer different questions.
  * **M2** stops the key requiring a thread and a turn, so a frame that declared neither is filed
    under empty ids and a request that declares neither reads it back. ⚠️ **Both halves are needed to
    observe it**, which is why the test asserts the pair rather than the drop — and why each lookup
    in that test mirrors, field for field, what its frame declared. A lookup that names something
    different misses whether the entry was stored or not, which is a green over nothing.
  * **M9** and **M10** drop ONE half of that requirement each (the thread, then the turn), for the
    same reason M6/M7 exist: a single guard covering two fields is two claims, and a table that only
    reverts both at once cannot tell which of them the tests are holding.
  * **M3** is the OVER-refusal twin: the record keeps its identity and the lookup throws hers away,
    so every file card in the app goes back to *"the provider did not name the files"*. 181's whole
    win, lost the other way — the direction 183 shipped and had to measure its way out of.
  * **M4** takes `item/fileChange/patchUpdated` back out of `TURN_SCOPED_METHODS` — 182 H3's ungated
    half. ⚑ The three-field key still refuses to CONFUSE a foreign frame with the active one, so the
    only thing that turns red is eviction: 70 unique foreign ids fill the 64-entry map and the live
    turn's entry is gone. That is exactly the second route 182 named, and this row is the proof the
    key alone does not close it.
  * **M5** joins the three parts without the length prefixes, so `('a|b','c')` and `('a','b|c')`
    become one entry — the id-collision class 045 already paid for once, in a key whose every part
    is an opaque provider string.
  * **M6** and **M7** drop ONE field each (the turn, then the thread), so each of the two has to earn
    its place on its own evidence rather than as half of a phrase.
  * **M8** reads the identities off the ITEM instead of off the notification that wraps it — the
    mistake the shape invites, since `ItemStartedNotification` is `{item, threadId, turnId}` and the
    id being read is `item.id`. Nothing is ever recorded, and every file card goes blank.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The wire.** That a real `item/started` declares the same `(threadId, turnId)` as the approval
    two frames later is what makes a three-field key sound, and no unit test can establish it — a
    unit test supplies both halves of the correlation itself. `probe:file-approval-paths` measured
    it — **three runs, 383 frames, six approvals, MATCH on every one** — and it is the instrument
    that would catch this fix going wrong, not `ci`.
 2. **The 64-entry bound in the ordinary case.** M4 proves foreign frames can evict. That the CURRENT
    turn's entry cannot be evicted before its approval reads it is an argument about frame ORDER —
    the two are two frames apart, measured — and a test that recorded 64 items inside that window
    would be asserting against a wire that does not exist.
 3. **Anything live.** `smoke:ui` cannot see this change: no step reads what a card names
    (`permission-action` / `permission-what` are never queried and `underDisclosed` is captured and
    never asserted), so a pass proves nothing about the key either way. Stated, not skipped.

⚠️ **Projects: `runtime` ONLY, derived from the files this table touches.** Both are under
`packages/runtime/src`. ⛔ **`desktop`, `dom`, `shared` and `scripts` are NOT run, and that is a fact
about the change**: 184 touched no renderer component, no main-process file and no shared type.
"""

from __future__ import annotations

import sys
from pathlib import Path

TARGETS = "packages/runtime/src/codex/patch-targets.ts"
RUNTIME = "packages/runtime/src/codex/codex-runtime.ts"

MUTATIONS = [
    (
        "M1 · ⛔ the key is `itemId` alone again — 182 H3's defect, verbatim",
        TARGETS,
        "  return identityKey(threadId, turnId, itemId)",
        "  return itemId",
    ),
    (
        "M2 · ⛔ a frame that declared no thread and no turn is filed under empty ids",
        TARGETS,
        "  if (!threadId || !turnId || !itemId) return null",
        "  if (!itemId) return null",
    ),
    (
        "M3 · ⛔ the LOOKUP throws its identity away — every file card goes blank again",
        TARGETS,
        "    const key = keyOf(params, readString(params, 'itemId'))",
        "    const key = identityKey('', '', readString(params, 'itemId'))",
    ),
    (
        "M4 · ⛔ `patchUpdated` leaves the turn gate — foreign frames evict the live entry",
        RUNTIME,
        "  'item/fileChange/patchUpdated',\n",
        "",
    ),
    (
        "M5 · ⛔ the three parts are joined without length prefixes — two triples, one key",
        TARGETS,
        "  return `${threadId.length}:${threadId}|${turnId.length}:${turnId}|${itemId}`",
        "  return `${threadId}|${turnId}|${itemId}`",
    ),
    (
        "M6 · ⛔ the TURN drops out of the key — a later turn inherits the earlier one's files",
        TARGETS,
        "  return identityKey(threadId, turnId, itemId)",
        "  return identityKey(threadId, '', itemId)",
    ),
    (
        "M7 · ⛔ the THREAD drops out of the key — a child thread answers for the parent",
        TARGETS,
        "  return identityKey(threadId, turnId, itemId)",
        "  return identityKey('', turnId, itemId)",
    ),
    (
        "M8 · ⛔ the identities are read off the ITEM instead of the notification wrapping it",
        TARGETS,
        "      if (typeof id === 'string') this.record(keyOf(params, id), targetsIn(item['changes']))",
        "      if (typeof id === 'string') this.record(keyOf(item, id), targetsIn(item['changes']))",
    ),
    (
        "M9 · ⛔ only the THREAD stops being required — half of M2, on its own evidence",
        TARGETS,
        "  if (!threadId || !turnId || !itemId) return null",
        "  if (!turnId || !itemId) return null",
    ),
    (
        "M10 · ⛔ only the TURN stops being required — the other half",
        TARGETS,
        "  if (!threadId || !turnId || !itemId) return null",
        "  if (!threadId || !itemId) return null",
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
    if args and args[0] == "--files":
        print(" ".join(sorted({rel for _n, rel, *_r in MUTATIONS})))
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
