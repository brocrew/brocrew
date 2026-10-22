#!/usr/bin/env python3
"""
153 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

`suite` selects which vitest projects the runner uses: `node` (runtime + desktop) or `dom`.

⚠️ **Anchors are taken from the FORMATTED source.** 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the exact string the entry was anchored on. Every target here was
copied after the last format run, and `mutate.sh` refuses rather than reporting a green if one of
them stops matching.

⛔ **Three of these are the live defects 152 measured, put back byte for byte**: M1 (the newline
skip), M2 (a `content` counted as the path) and M18 (an approved plan resuming planning). If any of
them survives, this ticket did not close what it says it closed.
"""

import sys
from pathlib import Path

CONF = "packages/runtime/src/internal/confinement.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
HOMES = "apps/desktop/src/main/adopt/user-homes.ts"
INDEX = "apps/desktop/src/main/index.ts"
CWD = "apps/desktop/src/main/runtime/scratch-cwd.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"

# The predicate at the centre of §1, in both of its polarities.
CAN_NAME = (
    "  return value.length > 0 && value.length <= LONGEST_PLAUSIBLE_PATH && "
    "!value.includes('\\0')\n"
)

# The cwd guard, whole — removing the CALL is how the rule stops existing.
CWD_GUARD = """  try {
    assertNotPersonalProviderHome(cwd)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  let isDirectory: boolean
"""

# The protected-path scan and its second door are no longer product behavior. These rows retain
# absent anchors because their planted behavior is now intended; the census records them as retired
# rather than pretending they still guard a refusal.
MUTATIONS = [
    # ---- §1 · a path with a newline -------------------------------------------------------------
    (
        "M1 · THE 152 §4.5 DEFECT · a newline is a skip again, so a real path is never examined",
        "node",
        [
            (
                CONF,
                CAN_NAME,
                "  return (\n    value.length > 0 &&\n    value.length <= LONGEST_PLAUSIBLE_PATH &&\n"
                "    !value.includes('\\n') &&\n    !value.includes('\\0')\n  )\n",
            )
        ],
    ),
    (
        "M2 · THE OTHER HALF · a `content` field is counted as the path that proves the write",
        "node",
        [(CONF, "      if (isAbsolute(node)) named += 1", "      named += 1")],
    ),
    (
        "M3 · an unresolvable path in a write-shaped tool goes back to being an exemption",
        "node",
        [(CONF, "      if (node.includes('\\0')) return false\n", "")],
    ),
    (
        "M4 · …and the over-long case flips the other way, refusing every real plan document",
        "node",
        [(CONF, "      if (!canNameAFile(node)) return true", "      if (!canNameAFile(node)) return false")],
    ),
    (
        "M5 · a relative string stops being resolved, so an escape rides in beside the plan file",
        "node",
        [
            (
                CONF,
                "      if (!canNameAFile(node)) return true\n",
                "      if (!canNameAFile(node) || !isAbsolute(node)) return true\n",
            )
        ],
    ),
    (
        "M6 · a call naming NO path is vacuously allowed again (150's rule)",
        "node",
        [(CONF, "  return walk(input) && named > 0", "  return walk(input)")],
    ),
    (
        "M7 · the refusal tells the model that the user's own folder is BroBot2's data (086)",
        "node",
        [
            (
                CONF,
                "    `${which} is not this conversation's to reach. BroBot2 keeps both its own data and your ` +\n"
                "    `providers' own folders out of every session, in every mode.`",
                "    `${which} belongs to BroBot2 itself, not to this conversation. ` +\n"
                "    `The app refuses its own data directory to every session, in every mode.`",
            )
        ],
    ),
    # ---- §2 · the personal homes ----------------------------------------------------------------
    (
        "M8 · the homes are protected only once they already exist — absent on the machine that needs it",
        "node",
        [
            (
                HOMES,
                "  ].map((path) => resolve(path))",
                "  ].filter((path) => existsSync(path)).map((path) => resolve(path))",
            )
        ],
    ),
    (
        "M9 · a relocation REPLACES the canonical home instead of being added to it",
        "node",
        [
            (
                HOMES,
                "    join(home, '.claude'),\n    join(home, '.codex'),\n",
                "",
            )
        ],
    ),
    (
        "M10 · the same directory is listed twice, so the set is not a set",
        "node",
        [(HOMES, "  return [...new Set(paths)]", "  return paths")],
    ),
    (
        "M11 · the personal homes REPLACE the app's own data root — 071's hole, reopened",
        "node",
        [
            (
                INDEX,
                "    protectedRoots: () => [userData, ...protectedUserHomes()],",
                "    protectedRoots: () => [...protectedUserHomes()],",
            )
        ],
    ),
    (
        "M12 · …and the whole fix is unwired: the app stops handing them over at all",
        "node",
        [
            (
                INDEX,
                "    protectedRoots: () => [userData, ...protectedUserHomes()],",
                "    protectedRoots: () => [userData],",
            )
        ],
    ),
    (
        "M13 · a personal home raises a CARD instead of being refused (031's fatigue rule) · "
        "⚑ REPLACEMENT CORRECTED IN PLACE BY 700: `askFor` takes a key since 700, so the ask carrying "
        "the refusal's own message is written out whole",
        "node",
        [
            (
                CLAUDE,
                "            if (scan.refused.length > 0) return denyFor(refusalMessage(scan.refused))",
                "            if (scan.refused.length > 0) return { hookSpecificOutput: { hookEventName: "
                "'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: "
                "refusalMessage(scan.refused) } }",
            )
        ],
    ),
    (
        "M14 · the SECOND door stops repeating the refusal (071's one rule, both doors)",
        "node",
        [
            (
                CLAUDE,
                "        const scan = scanForProtected(toolInput, confinement)\n"
                "        if (scan.refused.length > 0) {\n"
                "          return Promise.resolve({ behavior: 'deny', message: refusalMessage(scan.refused) })\n"
                "        }\n",
                "",
            )
        ],
    ),
    # ---- §2.1 · a personal home as a working directory -------------------------------------------
    (
        "M15 · a personal provider home may be chosen as a cwd again",
        "node",
        [(CWD, CWD_GUARD, "  let isDirectory: boolean\n")],
    ),
    (
        "M16 · only the home ITSELF is refused, so a directory inside one is fine",
        "node",
        [
            (
                CWD,
                "    if (within(resolve(home), resolve(cwd)) || within(real(home), real(cwd))) {",
                "    if (resolve(home) === resolve(cwd)) {",
            )
        ],
    ),
    (
        "M17 · the check moves below the existence probe, so an absent home says 'create it'",
        "node",
        [
            (
                CWD,
                CWD_GUARD,
                "  let isDirectory: boolean\n",
            ),
            (
                CWD,
                "  try {\n    assertNotAppData(userData, cwd)\n",
                "  try {\n    assertNotAppData(userData, cwd)\n    assertNotPersonalProviderHome(cwd)\n",
            ),
        ],
    ),
    # ---- §3 · what a reopened session comes back as ----------------------------------------------
    (
        "M18 · THE 152 §4.4 DEFECT · an approved plan resumes planning, floor back up",
        "node",
        [
            (
                CLAUDE,
                "      const stillPlanning = options.planMode === true && options.planModeEnded !== true",
                "      const stillPlanning = options.planMode === true",
            )
        ],
    ),
    (
        "M19 · …and the inverse: nothing ever comes back planning, so 030 is undone",
        "node",
        [
            (
                CLAUDE,
                "      const stillPlanning = options.planMode === true && options.planModeEnded !== true",
                "      const stillPlanning = false",
            )
        ],
    ),
    (
        "M20 · the HANDLE is told it is planning while the provider is told it is not",
        "node",
        [
            (
                CLAUDE,
                "        options.model,\n        stillPlanning,\n",
                "        options.model,\n        options.planMode,\n",
            )
        ],
    ),
    # ⚑ **741 · M21's anchor corrected, not retired**: the comment above `stillPlanning` was
    # rewritten for R99 (corrected — a reopen leaves planning); the mutation is the same one, and it
    # now puts the provider back into plan mode on EVERY reopen of a row that planned.
    (
        "M21 · …and the mirror: the PROVIDER is put back into plan mode while the floor is down · killed by `plan-floor-durable.test.ts` (named by W4.78)",
        "node",
        [
            (
                CLAUDE,
                # ⚑ **W4.78 · re-anchored in place, not retired** — same line, two spaces less indent: 39862830 lifted the optionsFor call out of the query literal into `const built = this.optionsFor(...)`
                "        // reopened conversation does not resume planning, as the CLI's own resume does not.\n        stillPlanning,\n",
                "        // reopened conversation does not resume planning, as the CLI's own resume does not.\n        options.planMode,\n",
            )
        ],
    ),
    # ---- §4 · the string 151 left ----------------------------------------------------------------
    (
        "M22 · the jargon returns to the first place a user meets it",
        "dom",
        [
            (
                RAIL,
                # ⚠️ **Re-anchored at `531`, not retired** — the subject is still here.
                # `531` measured this sentence cut by 182 px in a 131 px column and gave it
                # `class="says"` and a `:title`, which moved the bytes this row quoted. ⛔ The
                # anchor now carries the pair, so the mutation still reverts the whole sentence
                # rather than leaving a tooltip disagreeing with the line under it.
                #
                # 🔴 **This table is `complete`, so the correction cost a verdict its recorded
                # run had EARNED against text that no longer exists** —
                # `a-corrected-anchor-keeps-a-verdict-it-never-earned`. ⛔ `census.py` moves the
                # row fingerprint and leaves the run-state alone, so nothing in the gate says
                # so; `531` F6 boards that. ⚑ **Re-earned by hand instead**: this row applied
                # alone against `apps/desktop/test/provider-home-words.test.ts`, watched RED
                # (1 failed / 6 passed), and the file restored from bytes with a SHA-256
                # re-check. The killer is unchanged — the replacement still says *your provider
                # homes*, which is the phrase that file exists to refuse.
                # The approved plain subtitle replaces the former words; the plant still reintroduces provider-home jargon.
                "<small class=\"says\" title=\"Includes chats from Claude and Codex on this computer.\"\n              >Includes chats from Claude and Codex on this computer.</small\n",
                "<small\n"
                '              class="says"\n'
                '              title="Everything here, and everything in your provider homes"\n'
                '              >Everything here, and everything in your provider homes</small\n',
            )
        ],
    ),
]


def main() -> int:
    if sys.argv[1] == "--count":
        print(len(MUTATIONS))
        return 0
    if sys.argv[1] == "--name":
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    if sys.argv[1] == "--suite":
        print(MUTATIONS[int(sys.argv[2])][1])
        return 0

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(f"MUTATION DID NOT APPLY: {rel} matched {found} times, expected 1", file=sys.stderr)
            return 2
        path.write_text(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
