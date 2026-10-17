#!/usr/bin/env python3
"""
187 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a shell that is zsh. The pristine copy and the trap in `mutate.sh` are why this one
cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What this table is about

Three of 168's fourteen, all re-verified live at `a333ba3` by 182 §5, all put on the critical path by
the person's stated target (BroBot creates a project; the project's PM spawns agents itself through an MCP
tool; rules reach those agents through injected instruction files; several sessions share one home):

  * **M5** profile uniqueness was enforced in the RENDERER only — and a PM spawning through MCP
    never touches the renderer.
  * **M2** the instruction cap dropped the NEAREST rules, silently — and the rules ride on exactly
    that channel.
  * **M3** nothing bounded agent memory — and several sessions share one home.

Row by row:

  * **M1** gives the case-fold matcher a second, renderer-shaped answer: exact match only. This is
    169 §1's drift, made concrete — the launcher would still refuse `Developer` while the boundary
    let it through, which is the state 187 §1 found.
  * **M2** removes the boundary check entirely, leaving the renderer's copy as the only one. ⚑ The
    row that says whether the fix is at the layer the MCP caller will use.
  * **M3** makes the matcher case-SENSITIVE. Both ends still call one function, so both ends are
    wrong together — the failure a shared rule cannot rule out and only a corpus can.
  * **M4** stops an EXACT match short-circuiting, so on a tree holding BOTH `developer` and
    `Developer` — a case-sensitive volume, or a tree copied from one — a launch is answered with
    whichever variant the list happens to hold first, and a session is sent to the other profile's
    memory. ⚠️ **Red in ONE place, and that is honest**: on this machine's volume format the two
    spellings cannot coexist on disk, so only the matcher's own corpus can reach it.
  * **M5** returns `take` to its silent exit, so a file dropped for budget produces no row (168 M2,
    half 1).
  * **M6** goes back to charging FILE BYTES ONLY, so the emitted prompt exceeds the advertised cap by
    every header (168 M2, half 2). ⛔ **This row was GREEN on the table's first run**, and what it
    exposed was the FIXTURE: six 64 KiB files admit three under both accountings, so the emitted text
    fitted the cap either way and the assertion could not tell them apart. `fillToTheByte` sizes each
    file at `floor((256 KiB − preamble) / 4)` — the one band where the headers are what tips it over.
  * **M7** spends the budget in PROMPT order again, so the files nearest the agent are the first to
    vanish — the policy 187 §2 was asked to rule on.
  * **M8** drops the profile's own memory into the chain's priority order, so the identity is the
    first thing to give way rather than the last.
  * **M9** makes the renderer print `not read: over-budget`, which reports a refusal for a file the
    app read and chose not to send.
  * **M10** removes the memory bound from the adapter, so the cardless write is unbounded again
    (168 M3).
  * **M11** stops charging the file already on disk, so an `Edit` can grow one memory past the cap a
    kilobyte at a time.
  * **M12** counts an EXISTING file against the count bound, so a full directory can no longer be
    consolidated — the exact defect this table's own test caught in the first draft.
  * **M13** makes an unwalkable input pass instead of fail closed (`MAX_SCANNED_STRINGS`).
  * **M14** makes an unreadable directory read as empty — "we could not look" reported as "there is
    nothing there", in a predicate that GRANTS.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The three numbers themselves.** `MEMORY_FILE_CAP`, `MEMORY_FILE_LIMIT` and `MEMORY_TOTAL_CAP`
    are arguments from a measurement (the sixteen real memory directories on the PM's machine:
    largest 494 files / 1,510,609 bytes, largest single file 19,124 bytes). A mutation that doubled
    one would turn the tests that pin the boundary red and prove only that the tests read the same
    constant. What defends the numbers is the measurement, in the response doc and in the source.
 2. **Whether the profile rule is enforced on the path an MCP tool will really take.** That tool does
    not exist yet (Slice 3, the PO's). What is asserted is `executeRuntimeCommand` → `RuntimeHost`
    with no renderer in the process, which is the layer it will enter through.
 3. **The live drawer.** `smoke:ui` step 65 asserts the over-budget row end to end and is NOT run by
    this table — see the response doc for the cost and the judgement.
 4. **Anything about Codex.** 187 touched no Codex path: the instruction reader returns early for it
    and the memory bound is Claude's directory.

⚠️ **Projects: `runtime`, `desktop` AND `dom`** — derived from the files the table TOUCHES (147 M17,
149). `dom` is in for the first time in several dispatches because 187 changed two renderer
components: the launcher's clash check and the drawer's refusal wording. ⛔ **`shared` and `scripts`
are not run**: no `packages/shared` type moved, and the smoke script's own tests do not read any line
edited here.
"""

from __future__ import annotations

import sys
from pathlib import Path

SHARED = "apps/desktop/src/shared/runtime-ipc.ts"
HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"
INSTR = "apps/desktop/src/main/runtime/instructions.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
# ⚑ F093 · the refusal words moved out of the panel into one table both surfaces read.
REFUSALS = "apps/desktop/src/renderer/src/lib/refusal-words.ts"
BOUND = "packages/runtime/src/internal/memory-bound.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"

MUTATIONS = [
    # ── §1 · M5, profile uniqueness ────────────────────────────────────────────────────────────
    (
        "M1  · ⛔ the matcher answers exact-only, so the two ends drift again (169 §1)",
        SHARED,
        "  if (existing.includes(name)) return name\n"
        "  const folded = name.toLowerCase()\n"
        "  return existing.find((id) => id.toLowerCase() === folded) ?? null",
        "  return existing.includes(name) ? name : null",
    ),
    (
        "M2  · ⛔ the boundary stops asking — the renderer is the only rule again",
        HOMES,
        "  const owner = profileAlreadyNamed(profileId, existing)\n"
        "  if (owner === null || owner === profileId) return",
        "  const owner = profileAlreadyNamed(profileId, existing)\n  if (owner !== null) return",
    ),
    (
        "M3  · ⛔ the matcher is case-SENSITIVE — one rule, wrong at both ends",
        SHARED,
        "  const folded = name.toLowerCase()\n"
        "  return existing.find((id) => id.toLowerCase() === folded) ?? null",
        "  return existing.find((id) => id === name) ?? null",
    ),
    (
        "M4  · ⛔ the exact spelling stops winning on a tree that holds both variants",
        SHARED,
        "  if (existing.includes(name)) return name\n",
        "",
    ),
    # ── §2 · M2, the instruction cap ───────────────────────────────────────────────────────────
    (
        "M5  · ⛔ a file dropped for budget produces NO row again (168 M2, half 1)",
        INSTR,
        "    if (!granted.has(item)) refused.push({ path: item.path, reason: 'over-budget' })",
        "    if (!granted.has(item)) continue",
    ),
    (
        "M6  · ⛔ the budget counts FILE BYTES ONLY — the cap and the emitted text disagree again",
        INSTR,
        "    const cost = item.bytes + byteLength(blockHeader(item)) + byteLength(BLOCK_SEPARATOR)",
        "    const cost = item.bytes",
    ),
    (
        "M7  · ⛔ the budget is spent in PROMPT order — the nearest rules vanish first",
        INSTR,
        "    ...candidates.filter((item) => item.kind !== 'profile-memory').reverse(),",
        "    ...candidates.filter((item) => item.kind !== 'profile-memory'),",
    ),
    (
        "M8  · ⛔ the profile's own memory loses its priority — identity gives way first",
        INSTR,
        "    ...candidates.filter((item) => item.kind === 'profile-memory'),\n"
        "    ...candidates.filter((item) => item.kind !== 'profile-memory').reverse(),",
        "    ...[...candidates].reverse(),",
    ),
    (
        "M9  · ⛔ the drawer calls a budget drop 'not read', which is not what happened",
        REFUSALS,
        "  return REFUSAL_WORDS[reason] ?? `not read: ${reason}`",
        "  return `not read: ${reason}`",
    ),
    # ── §3 · M3, the agent-memory bound ────────────────────────────────────────────────────────
    (
        "M10 · ⛔ the cardless memory write is unbounded again (168 M3)",
        CLAUDE,
        "              const breach = memoryBoundBreach(input.tool_input, memoryDir)\n"
        "              if (breach !== null) return denyFor(memoryBoundMessage(breach, memoryDir))\n",
        "",
    ),
    (
        "M11 · ⛔ the file already on disk is not charged — an Edit grows past the cap in steps",
        BOUND,
        "  if (payload.bytes + existing > MEMORY_FILE_CAP) return 'file-bytes'",
        "  if (payload.bytes > MEMORY_FILE_CAP) return 'file-bytes'",
    ),
    (
        "M12 · ⛔ an EXISTING file spends the count bound — a full directory cannot be consolidated",
        BOUND,
        "  if (held.files >= MEMORY_FILE_LIMIT && targets.some((path) => !isRegularFile(path))) {",
        "  if (held.files >= MEMORY_FILE_LIMIT) {",
    ),
    (
        "M13 · ⛔ an input too large to walk passes instead of failing closed",
        BOUND,
        "  if (payload === null) return 'file-bytes'",
        "  if (payload === null) return null",
    ),
    (
        "M14 · ⛔ a directory that cannot be read is reported as empty",
        BOUND,
        "  if (held === null) return 'total-bytes'",
        "  if (held === null) return null",
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
