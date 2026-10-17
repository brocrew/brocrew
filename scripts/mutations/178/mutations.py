#!/usr/bin/env python3
"""
178 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## ⛔ What this table is about, and why it is ONE file

178 wrote four live smoke steps. **`scripts/ui-live-smoke.mjs` is not in `vitest`** — it drives a
windowed Electron app against the real provider — so no mutation of it can turn a suite red, and
pretending otherwise would be the "silence that looks like approval" the tab-flow walk itself exists
to remove. The four steps are proved by having been RUN, step by step, in the response doc.

What DID land in `vitest` is one thing: the walk's ownership table gained the instructions block.
That block has been on the Info tab since 158 and `scripts/lib/tab-flow.mjs` had never heard of it,
because nothing had ever read it — `session-instructions` appeared **zero** times in both live
scripts. So a step reading it off Events would have found `null` and asserted against an absence it
caused, which is precisely the class 097 built the walk for, left open on the one block whose entire
subject is disclosure. Step 65 is the first read; these six mutations are what say the guard is real.

## 🔴 527 · ALL SIX ROWS RE-AIMED, because the block left the tab

⛔ **`HO-050` §1.1 split the Info tab into an index and a wide sheet.** The composition, the layers,
the memory rows, the provider list and their two folds are on `AgentInstructionsSheet`, which
`ConversationPane` raises on the overlay layer — so `session-instructions`, `injected-` and
`refused-instruction` are no longer drawer-body hooks and their entries came OUT of `TAB_OF_HOOK`.
⚠️ **Every row below anchored on one of those entries and went dark in one commit.**

⚑ **Retirement is reported and correction is not automatic** (`HO-050` §3; standing rule 27;
`a-corrected-anchor-keeps-a-verdict-it-never-earned`). ⛔ **The CLAIMS are unchanged** — each row
still says the thing it always said — and each has been re-pointed at the part of this tab that
still carries it, then re-applied ALONE and watched red. 🔴 **M4 is the one whose claim MOVED**, and
it moved because the world created a new hazard: the table's old direction is now guarded by the
hooks' absence, and the direction that can hurt is a hook left filed under a tab that no longer
mounts it — which makes the walk fail a CORRECT step and invites somebody to delete the guard.

  * **M1** drops the index ENTRY's entry. The walk goes back to not knowing the door is an Info
    press — and the door is now the only way to everything this table was written about.
  * **M2** drops the `config-file-` family, so the per-FILE rows — the ones carrying the paths — are
    unguarded while the `session-config` container around them still is. ⚑ A table can be half right.
  * **M3** files the entry under `context` instead of `info`. ⛔ **This is not an invented slip:
    `174 §5c` calls it "the Context tab's instructions block", and it is the Info tab.** The wrong
    belief is in the ticket this dispatch was written from, so the table has to be able to reject it.
  * **M4** files a hook that LEFT the drawer body back under `info` — 097's class with the sign
    flipped. The walk would send a step to a tab that mounts nothing of it, the read would find
    `null`, and the step would assert against an absence it caused.
  * **M5** writes the family prefix without its trailing dash. Every entry ends in `-` on purpose:
    without it a family starts swallowing hooks that are their own. ⚠️ **This is the one row `dom`
    stays GREEN on, and that is right rather than a hole**: `config-file` still `startsWith`-matches
    `config-file-auth.json`, so the OWNERSHIP answer is unchanged and the component test — which
    only asks who owns what — has nothing to notice. What M5 breaks is an invariant about the table's
    shape, and the invariant lives in `scripts`. Two tests, two different questions, and the split is
    visible in the table.
  * **M6** misspells the family as `config-files-`, which matches nothing. The walk must key on the
    name the app really renders, not on a plausible one.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **All four new smoke steps — 65, 66, 67 and 68.** They are live: a windowed app, a real Claude
    login, seven provider turns between them. `vitest` never runs them and no mutation here can red
    one. ⚑ What proves them is that each was executed and its output recorded — and two of them were
    RED first, which is the only reason the greens mean anything.
 2. **The reload in step 65.** That the launcher's profile menu is re-read after a launch rather than
    on mount is a fact about `RuntimeScreen`, measured by the step failing without it. There is no
    unit surface for "a menu populated by an IPC call the renderer has not re-issued".
 3. **Whether the five new entries are the RIGHT hooks to guard** — that is, whether the walk now
    covers everything the instructions block draws. The added DOM test asks the component for the
    hooks it really mounts and requires the table to claim each one, which is as close as a test
    gets; what it cannot see is a hook the FIXTURE does not reach, and the fixture is one state.

 ⚑ **The first run of this table had `dom` GREEN on all six**, because `drawerProps` renders an
 EMPTY instructions block on purpose (rule 2: a session told nothing extra renders nothing at all),
 so the new rows landed in the conformance test's `unrendered` list. That made the whole guard a
 hand-written test agreeing with a hand-written table — a name mistyped in both would have passed.
 The DOM test that mounts the populated state was added because the table said so.
"""

import sys
from pathlib import Path

WALK = "scripts/lib/tab-flow.mjs"

MUTATIONS = [
    (
        "M1 · ⛔ the index ENTRY loses its entry — the walk stops knowing the door is an Info press "
        "(527: re-aimed from `session-instructions`, which left the drawer body)",
        WALK,
        "  'told-index': 'info',\n",
        "",
    ),
    (
        "M2 · ⛔ the `config-file-` family goes — the container is guarded and the FILE rows are not "
        "(527: re-aimed from `injected-`, which left with its block)",
        WALK,
        "  'config-file-': 'info',\n",
        "",
    ),
    (
        "M3 · ⛔ filed under `context` — the wrong belief 174 §5c actually wrote down",
        WALK,
        "  'told-index': 'info',",
        "  'told-index': 'context',",
    ),
    (
        "M4 · ⛔ a hook that LEFT the drawer body is filed back under `info` — 097's class with the "
        "sign flipped, so the walk fails a CORRECT step (527: the hazard the split created)",
        WALK,
        "  'told-index': 'info',\n",
        "  'told-index': 'info',\n  'session-instructions': 'info',\n",
    ),
    (
        "M5 · ⚠️ the family prefix loses its trailing dash — a family that swallows its neighbours",
        WALK,
        "  'config-file-': 'info',",
        "  'config-file': 'info',",
    ),
    (
        "M6 · ⚠️ the family is misspelled `config-files-` — a plausible name that matches nothing",
        WALK,
        "  'config-file-': 'info',",
        "  'config-files-': 'info',",
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
