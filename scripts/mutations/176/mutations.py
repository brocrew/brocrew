#!/usr/bin/env python3
"""
176 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

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

176 replaced a control that seven instruments carried: a before/after hash of two or three named
files in the user's personal home. `174` collected the bill — three of its four reds were other
people's writes. The replacement asks *is anything of OURS in there?*, and all of it lives in
`scripts/lib/personal-home-guard.mjs`.

⛔ **A control that cannot fail is the whole failure class this dispatch is about**, so half the
table is about vacuity rather than about missed leaks:

  * **M1** makes `requireMarkers` return instead of throw on an empty list — a caller whose session
    id came back `undefined` gets a green scan forever, which is `129`'s trap exactly.
  * **M2** drops the length floor, so a two-character marker is accepted and matches everything.
  * **M3** matches a name EXACTLY instead of by substring: `<session id>.jsonl` no longer matches
    the session id, and neither does Codex's `rollout-<stamp>-<thread id>.jsonl`. Every leak this
    control was built for is filed under a name like that.
  * **M4** stops naming DIRECTORIES, so a project bucket for our cwd is invisible until a transcript
    lands in it — the leak's first observable moment is lost.
  * **M5** stops recursing, so anything below the top level is invisible. The retired control's own
    keyhole, rebuilt.
  * **M6** follows symlinks, which is not a missed leak but a walk that leaves the home entirely.
  * **M7** makes `filesContaining` silent about what it could not read, so a scan that read NOTHING
    reports the same clean result as a scan that read everything.
  * **M8** and **M9** 🔒 file a finding under the marker's VALUE where its label belongs, so
    `describeHits` prints it. One caller's needle is the machine's own refresh token, which makes
    these the mutations that put a credential into a CI log.

⚠️ **M8 is the SECOND version of that mutation, and the first one is worth recording.** It changed
`describeHits` to print `hit.value ?? hit.label` — and came back GREEN, because a `Hit` has no
`value` field and the fallback made it a no-op. ⛔ **A mutation that changes nothing is a green that
means nothing**, and it read exactly like a coverage gap until the diff was looked at. The safety
here is structural: the value never enters a `Hit` at all, so the mutation has to be applied where a
`Hit` is BUILT.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **All seven live instruments.** `probe:toolset`, `probe:auth-state`, `probe:model-effort`,
    `probe:handshake`, `smoke:codex`, `smoke:sweep` and `smoke:ui` step 21 are not run by `vitest`
    and cannot be mutated into a red here. What proves them is the run, and the runs are in the
    response doc with their scores — `probe:toolset` three times, per acceptance 6.
 2. **The three bounds of §3.** `probe:handshake`'s latency ceilings, `probe:model-effort`'s three
    findings and `probe:plan-mode`'s bisect biconditional are live assertions about a provider. No
    mutation of this tree can red them; the runs are what they rest on.
 3. **`archive-sweep.smoke.ts` §6.** The read-only proof is a smoke, for the same reason — and its
    subject is `sweepArchives`, which the unit tests already cover from the other side.
"""

import sys
from pathlib import Path

GUARD = "scripts/lib/personal-home-guard.mjs"

MUTATIONS = [
    (
        "M1 · ⛔ an empty marker list is accepted instead of refused — 129's trap: the caller's "
        "session id came back undefined and the scan is green forever",
        GUARD,
        """  if (!Array.isArray(markers) || markers.length === 0) {
    throw new Error('personal-home-guard: a scan with no markers is vacuous — pass at least one')
  }""",
        """  if (!Array.isArray(markers) || markers.length === 0) {
    return markers
  }""",
    ),
    (
        "M2 · ⚠️ the length floor goes, so a two-character marker is accepted and matches every "
        "file on the disk — a scan that always fires is as useless as one that never does",
        GUARD,
        "if (typeof marker?.value !== 'string' || marker.value.length < MIN_MARKER_LENGTH) {",
        "if (typeof marker?.value !== 'string' || marker.value.length < 0) {",
    ),
    (
        "M3 · 🔴 names are matched EXACTLY instead of by substring — `<session id>.jsonl` stops "
        "matching the session id, and so does every Codex `rollout-<stamp>-<thread id>.jsonl`",
        GUARD,
        "const marker = markers.find((m) => entry.name.includes(m.value))",
        "const marker = markers.find((m) => entry.name === m.value)",
    ),
    (
        "M4 · ⚠️ only FILES are named, so a project bucket carrying our cwd is invisible until a "
        "transcript lands in it — the first observable moment of a leak is lost",
        GUARD,
        """      const marker = markers.find((m) => entry.name.includes(m.value))
      if (marker) hits.push({ path: full, label: marker.label })""",
        """      const marker = entry.isDirectory()
        ? undefined
        : markers.find((m) => entry.name.includes(m.value))
      if (marker) hits.push({ path: full, label: marker.label })""",
    ),
    (
        "M5 · ⛔ the walk stops at the top level — the retired control's two-file keyhole, rebuilt: "
        "a leak into `projects/`, `todos/` or `tasks/` is not looked at",
        GUARD,
        "      if (entry.isDirectory()) walk(full, depth + 1)",
        "      if (entry.isDirectory() && depth < 0) walk(full, depth + 1)",
    ),
    (
        "M6 · the walk FOLLOWS symlinks — a personal home links out to plugin checkouts and "
        "worktrees, so this leaves the home and walks half the disk",
        GUARD,
        "      if (entry.isDirectory()) walk(full, depth + 1)\n    }\n  }\n  walk(root, 0)",
        "      if (entry.isDirectory() || entry.isSymbolicLink()) walk(full, depth + 1)\n    }\n  }\n  walk(root, 0)",
    ),
    (
        "M7 · ⚠️ the content scan goes silent about what it could NOT read — a scan that read "
        "nothing at all now reports exactly what a scan that read everything reports",
        GUARD,
        """    } catch {
      skipped.push(`${file} (absent or unreadable)`)
      continue
    }""",
        """    } catch {
      continue
    }""",
    ),
    (
        "M8 · 🔒 a finding carries the marker VALUE where its label belongs, so `describeHits` "
        "prints it — one caller's needle is the machine's own refresh token, and this is the "
        "mutation that writes a credential into a CI log",
        GUARD,
        "      if (text.includes(marker.value)) hits.push({ path: file, label: marker.label })",
        "      if (text.includes(marker.value)) hits.push({ path: file, label: marker.value })",
    ),
    (
        "M9 · 🔒 the same, on the path scan every one of the seven callers uses — the label is the "
        "only reason a failure message is safe to print, and this takes it away",
        GUARD,
        "      if (marker) hits.push({ path: full, label: marker.label })",
        "      if (marker) hits.push({ path: full, label: marker.value })",
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
