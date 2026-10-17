#!/usr/bin/env python3
"""
183 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

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

`realResolve` climbed to the deepest existing ancestor and treated EVERY `realpathSync` failure as
an absent component. 182 H1: that is right for an ordinary missing child and wrong for a symlink
whose target is missing, which throws identically. Two exploits followed — a write escaping into
`userData` through a dangling link in the workspace, and a CARDLESS write to the profile's own
`CLAUDE.md` through a dangling link inside `memory/`.

Row by row:

  * **M1** removes the distinction at its source — the reported defect, verbatim. Every guard
    downstream inherits it, which is the shape of the finding and the reason the table starts here.
  * **M2** asks `stat` instead of `lstat`. `stat` FOLLOWS the final component, so a dangling link
    reports `ENOENT` like an absence and the predicate is back where it started by a different
    route. ⚠️ 182's own words named `lstat`/`readlink`; this is the row that holds it to them.
  * **M3** narrows "absent" to `ENOENT` alone, so an honestly missing child under a plain file
    (`ENOTDIR`) becomes unresolvable — the OVER-refusal direction, which breaks ordinary work.
  * **M4** ⛔ **is the regression this dispatch actually SHIPPED and then measured.** The first
    version of the rule kept only `ENOENT`/`ENOTDIR`; `NAME_MAX` is 255, these guards resolve EVERY
    string in a tool input against a root, and ordinary prose is one component past it. `smoke:ui`
    step 41 denied a 272-byte `Bash` command and step 66 carded every memory write. ⚑ **No unit
    test could have caught it** — the existing `content` coverage pairs a short string with one of
    9,000 characters, and 9,000 is past `LONGEST_PLAUSIBLE_PATH`, so `canNameAFile` skips it before
    any of this runs. The live subset is what found it, and this row is what keeps it found.
  * **M5** puts `place` back to calling a dangling link `own` — 182 H1's exploit A at the predicate.
  * **M6** stops the wide scan REPORTING it, which is the only refusal `auto` cannot skip.
  * **M7** attests a dangling ROOT again — 182 H1's `attestedRoot` half.
  * **M8** restores the lexical fallback inside `writesOnlyWithin` — exploit B, verbatim: the
    cardless memory allow granted for a link to the profile's instruction file.
  * **M9** and **M10** remove the refusal from the guard hook and from `canUseTool` — 071's "one
    rule, both doors", one door at a time.
  * **M11** drops the unplaceable case from `strayed`, so a path-scoped exempt READ takes the
    cardless exit on a path nobody could resolve.
  * **M12** restores the lexical fallback in the Codex `sqlite_home` attestation — the SECOND COPY
    of the same climb, which §2's caller audit is what surfaced.
  * **M13** makes that attestation throw for every path instead, which refuses the ordinary
    not-yet-created SQLite home — the over-refusal twin of M12.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The two ROOT-level null handlings in `resolveRoots`** — dropping an unresolvable own root and
    falling back to the lexical spelling for an unresolvable protected root. ⚠️ **Neither is
    independently observable and no row here pretends otherwise**: every path under such a root
    carries the same dangling component and is refused on its own account. They exist so no
    comparison is ever made against a spelling nobody could confirm, and they are the reason the
    types are honest; the tests around them say only what they measure.
 2. **`EACCES` / `EPERM`.** The predicate refuses anything that is not provably absent, so a
    component inside a directory this process may not traverse is unresolvable. That is stated in
    `real-path.ts` as a named false positive; it is NOT asserted here, because a test would have to
    create an untraversable directory and the CI user is often able to traverse it anyway.
 3. **The real filesystem following the link.** Every row below is a decision this app makes. That
    `open` with `O_CREAT` writes through a dangling symlink is a POSIX fact, not something `ci`
    demonstrates — the tests assert the refusal, and `readlink`/`existsSync` pin what the write
    would have landed on.
 4. **Anything live.** No `smoke:ui` step drives a symlinked workspace, and none is added here.

⚠️ **Projects: `runtime` ONLY, derived from the files this table touches.** All four are under
`packages/runtime/src`. ⛔ **`desktop`, `dom`, `shared` and `scripts` are NOT run, and that is a
fact about the change**: 183 touched no renderer component, no main-process file and no shared type.
"""

from __future__ import annotations

import sys
from pathlib import Path

REALPATH = "packages/runtime/src/internal/real-path.ts"
CONFINE = "packages/runtime/src/internal/confinement.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
AUTH = "packages/runtime/src/internal/auth.ts"

# The unresolvable-path and strayed-read refusals no longer exist. These rows retain their absent
# anchors and are recorded retired, rather than being aimed at a different product rule.
MUTATIONS = [
    (
        "M1 · ⛔ every failure is an absence again — the reported defect, verbatim",
        REALPATH,
        "      if (!isAbsentComponent(head)) return null\n",
        "",
    ),
    (
        "M2 · ⛔ `stat` instead of `lstat` — it follows the link, so the distinction is erased",
        REALPATH,
        "import { lstatSync, realpathSync } from 'node:fs'",
        "import { statSync as lstatSync, realpathSync } from 'node:fs'",
    ),
    (
        "M3 · ⛔ a missing child under a plain file stops being absent (ENOTDIR dropped)",
        REALPATH,
        "    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'",
        "    return code === 'ENOENT'",
    ),
    (
        "M4 · ⛔ ordinary prose becomes a link nobody can follow — the regression 183 SHIPPED",
        REALPATH,
        "    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENAMETOOLONG'",
        "    return code === 'ENOENT' || code === 'ENOTDIR'",
    ),
    (
        "M5 · ⛔ exploit A — a dangling link in the workspace is `own` again",
        CONFINE,
        "  if (real === null) return 'unresolvable'",
        "  if (real === null) return 'own'",
    ),
    (
        "M6 · ⛔ the wide scan stops reporting it — the one refusal `auto` cannot skip",
        CONFINE,
        "        else if (placement === 'unresolvable') unresolvable.push(node)\n",
        "",
    ),
    (
        "M7 · ⛔ a dangling ROOT is attested again — 182 H1's `attestedRoot` half",
        CONFINE,
        "  if (parent === null || real === null) return null\n"
        "  return real === join(parent, basename(absolute)) ? absolute : null",
        "  if (parent === null) return null\n"
        "  return real === null || real === join(parent, basename(absolute)) ? absolute : null",
    ),
    (
        "M8 · ⛔ exploit B — the lexical fallback returns and the cardless memory allow with it",
        CONFINE,
        "      const real = realResolve(lexical)",
        "      const real = realResolve(lexical) ?? lexical",
    ),
    (
        "M9 · ⛔ the guard hook stops refusing it (door one of two)",
        CLAUDE,
        "            if (scan.unresolvable.length > 0) return denyFor(unresolvableMessage(scan.unresolvable))\n",
        "",
    ),
    (
        "M10 · ⛔ …and `canUseTool` stops refusing it (door two of two)",
        CLAUDE,
        "        if (scan.unresolvable.length > 0) {\n"
        "          return Promise.resolve({\n"
        "            behavior: 'deny',\n"
        "            message: unresolvableMessage(scan.unresolvable),\n"
        "          })\n"
        "        }\n",
        "",
    ),
    (
        "M11 · ⛔ a path-scoped exempt READ takes the cardless exit on a path nobody could place",
        CLAUDE,
        "              (placed.outside.length > 0 || placed.unresolvable.length > 0)",
        "              placed.outside.length > 0",
    ),
    (
        "M12 · ⛔ the SECOND copy of the climb — `sqlite_home` guesses lexically again",
        AUTH,
        "  const target = realResolve(resolve(providerHome, value))",
        "  const target = realResolve(resolve(providerHome, value)) ?? resolve(providerHome, value)",
    ),
    (
        "M13 · ⛔ …and the over-refusal twin: no Codex home may be created on first use",
        AUTH,
        "  if (home === null || target === null) {",
        "  if (true) {",
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
