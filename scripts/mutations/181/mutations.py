#!/usr/bin/env python3
"""
181 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

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

A Codex approval card for a file write read `apply_patch` / `file` and named no file — measured live
by the PM. The approval params really do carry no paths; the `fileChange` item under the same
`itemId` does, and `pnpm run probe:file-approval-paths` measured it arriving **two frames earlier**
in four approvals across two runs. Three things changed:

  * the **card names every file** the patch will touch, and says so when it cannot (M1–M6);
  * a small **tracker** holds what each item said it would change (M7–M11);
  * the Changes tab's sentence **agrees with its own count** (M12–M13), and the hook it is read
    through is claimed by the tab-flow walk (M14).

Row by row:

  * **M1** puts the card's disclosure back to `reason || 'file'` — the reported defect, verbatim.
  * **M2** keeps the sentence and drops the PATHS from the scope, so the structured disclosure the
    card's `dl` renders — and the one Claude's file cards populate — goes back to empty.
  * **M3** claims full disclosure unconditionally: a card that was told nothing would stop warning.
  * **M4** is the opposite failure — every file named and the ⚠ banner still on it. ⛔ Both
    directions, because `underDisclosed` also decides whether the Changes tab counts this approval
    as a change it was never told the files of.
  * **M5** takes §1b's sentence back to the bare word: an empty disclosure that says nothing about
    being empty.
  * **M6** stops FEEDING the tracker — the correlation exists and nothing arrives at it.
  * **M7** lets an empty `changes` erase what we hold, so a card's files depend on frame order.
  * **M8** is the other half: never replace, so a revised patch is approved against its first draft.
  * **M9** drops `oldPath` on a rename — the file appears from nowhere.
  * **M10** calls an unreadable `PatchChangeKind` `modified`, which is a claim about a file the
    provider told us nothing about (the honest word is `touched`).
  * **M11** removes the bound on the map: 052's shape, on a per-item cache in a long conversation.
  * **M12** restores the grammar bug exactly — *"1 file change were approved"*.
  * **M13** breaks the agreement at the OTHER count, because a fix that only reads right at 1 is
    the same bug at 2.
  * **M14** takes the new hook out of the tab-flow table: the walk stops guarding it, and a future
    live step reading it off the wrong tab would assert against an absence it caused.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **That the `fileChange` item arrives BEFORE the approval carrying its paths.** That is a fact
    about the provider, measured on the wire by `packages/runtime/smoke/file-approval-paths.smoke.ts`
    — a SMOKE, which `pnpm run ci` never runs. Every column below is green or red against a fake
    transport that sends whatever the test tells it to, in whatever order.
 2. **The product-level string.** `permission-action: apply_patch` / `permission-detail: file` came
    out of the real app; nothing in `ci` drives a real Codex approval card, and no `smoke:ui` step
    reads `permission-detail` on a FILE card (step 41 reads a command one). The live evidence for
    §1 is the probe above plus the frame log in the response doc.
 3. **§3's instruction block.** `smoke:ui` step 69 is a live step and is absent from every column
    here for the same reason. It was run in the full pass.
 4. **`desktop`, `shared` and `scripts` are NOT run**, and that is a fact about the change: this
    table touches one adapter file, one new adapter module, one renderer component and one harness
    table, and the two projects that execute them are `runtime` and `dom`.
"""

import sys
from pathlib import Path

CODEX = "packages/runtime/src/codex/codex-runtime.ts"
TARGETS = "packages/runtime/src/codex/patch-targets.ts"
CHANGES = "apps/desktop/src/renderer/src/components/SessionChanges.vue"
TABFLOW = "scripts/lib/tab-flow.mjs"

MUTATIONS = [
    (
        # ⚑ 704 · anchor corrected in place: `704` removed the command arm's `reason` fallback and
        # prettier folded the ternary onto one line, so `        : fileDetail(targets)` moved, not died.
        "M1 · ⛔ the card says `file` again — the reported defect, verbatim",
        CODEX,
        " : fileDetail(targets)",
        " : readString(params, 'reason') || kind",
    ),
    (
        "M2 · ⛔ the paths never reach the scope — the disclosure block goes back to empty",
        CODEX,
        "    paths: unique([...targets.map((target) => target.path), ...(grantRoot ? [grantRoot] : [])]),",
        "    paths: unique([...(grantRoot ? [grantRoot] : [])]),",
    ),
    (
        "M3 · ⛔ full disclosure claimed even when nothing was named",
        CODEX,
        "    underDisclosed: targets.length === 0,",
        "    underDisclosed: false,",
    ),
    (
        "M4 · ⛔ …and the opposite: every file named and the ⚠ banner still on it",
        CODEX,
        "    underDisclosed: targets.length === 0,",
        "    underDisclosed: true,",
    ),
    (
        "M5 · ⛔ §1b's sentence goes back to a word that explains nothing",
        CODEX,
        "      'file change — the provider did not name the files this patch touches; ' +\n      'they appear in Changes once it has run'",
        "      'file change'",
    ),
    (
        "M6 · ⛔ the tracker is never fed — the correlation exists and nothing reaches it",
        CODEX,
        "    this.patches.note(method, params)\n",
        "",
    ),
    (
        "M7 · ⛔ an EMPTY changes array erases what we hold — the card's files depend on frame order",
        TARGETS,
        "    if (targets.length === 0) return\n",
        "",
    ),
    (
        "M8 · ⛔ …and never replaced: a revised patch is approved against its first draft",
        TARGETS,
        "    this.byItem.set(itemId, targets)",
        "    if (!this.byItem.has(itemId)) this.byItem.set(itemId, targets)",
    ),
    (
        "M9 · ⛔ a rename forgets where it came from — a file out of nowhere",
        TARGETS,
        "      ? { path: movePath, status: 'renamed', oldPath: path }",
        "      ? { path: movePath, status: 'renamed' }",
    ),
    (
        "M10 · ⛔ an unreadable kind is called `modified` — a claim about a file nobody described",
        TARGETS,
        "  return { path, status: 'touched' }",
        "  return { path, status: 'modified' }",
    ),
    (
        "M11 · ⛔ the per-item map is unbounded (052's shape, on a long conversation)",
        TARGETS,
        "    while (this.byItem.size > PatchTargets.MAX_ITEMS) {\n      const oldest = this.byItem.keys().next().value\n      if (oldest === undefined) break\n      this.byItem.delete(oldest)\n    }\n",
        "",
    ),
    (
        "M12 · ⛔ `1 file change were approved` — the grammar bug, restored",
        CHANGES,
        "    ? '1 file change was approved'",
        "    ? '1 file change were approved'",
    ),
    (
        "M13 · ⛔ …and the agreement broken at the OTHER count",
        CHANGES,
        "    : `${set.value.underDisclosed} file changes were approved`,",
        "    : `${set.value.underDisclosed} file change were approved`,",
    ),
    (
        "M14 · ⛔ the new hook leaves the tab-flow table — the walk stops guarding it",
        TABFLOW,
        "  'changes-under-disclosed-note': 'changes',\n",
        "",
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
