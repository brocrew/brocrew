#!/usr/bin/env python3
"""
166 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand** (157's dry-run corrupted three source files that way; 129's trap
and the pristine copy in `mutate.sh` are the reason this one cannot).

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on.

## What the table is about

⛔ **M1–M4 are §1: WHERE the memory lives.** 165 shipped the provider's per-cwd default and the person
ruled against it, so every row here is a way the directory quietly goes back to being scoped by the
working directory — including M3, which is the one 106's own comment predicted: a second flag setting
arrives and the assignment that was correct with one setting silently deletes it.

⛔ **M5–M10 are §2: the card that must not appear, and the boundary that must.** M5 brings the card
back. M6–M7 widen the exemption — one to the whole provider home, one to the `startsWith` test 032
forbids — and M8–M10 move it up past a guard it must stay below. ⚠️ **Position is the whole ruling
here**: the same six lines are correct where they are and a security defect three lines earlier.

⛔ **M11 is §3**: the drawer looks for the file where it used to be, so the surface 165 built goes
blank the moment 166 moves it — the failure that would look like "the feature does not work".

⛔ **What this table CANNOT catch**: whether the provider HONOURS `settings.autoMemoryDirectory`, and
whether an allowing hook really suppresses the card. M1 and M5 redden because tests assert the
OPTIONS and the hook's own return value. Both are proven against a real login in
`smoke/auto-memory-probe.smoke.ts` — four sessions and a five-arm lever matrix.
"""

import sys
from pathlib import Path

RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"
AUTOMEM = "packages/runtime/src/claude/auto-memory.ts"
INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"

# The launch option, verbatim from `optionsFor`.
# ⚑ **740 · re-anchored, not retired** (M1, M3, M4): `flagSettingsFor` takes the launch's folder now,
# for the project's kept rules (R99); each mutation removes the same line it always did.
# ⚑ W4.189 · re-anchored in place: the launch builds its flag settings through the handle, which keeps
# the kept rules it read for the work folders; the setting is the same.
# ⚑ **the independent location module · re-anchored in place, not retired** — a launch reads its kept rules before it builds its options, so the setting takes what was read; the mutation still removes the launch option
# Cleanup now has its own spread. Remove only the memory/kept-rules setting under test.
SETTINGS_LINE = "        ...handle.launchFlagSettings(providerHome, kept),\n"

# §2's carve-out, verbatim. The three `MOVE_*` mutations delete this and re-insert it higher up, so
# the block is a constant: an anchor written twice is an anchor that drifts once.
MEMORY_ALLOW = """            if (
              FILE_TOOLS.has(input.tool_name) &&
              writesOnlyWithin(input.tool_input, claudeAutoMemoryDir(confinement.providerHome))
            ) {
              return allowFor('brobot2 lets this profile keep its own memory without asking')
            }
"""

# The three guards it must stay BELOW, in the order they appear.
USER_INPUT_GUARD = """            if (USER_INPUT_TOOLS.has(input.tool_name)) {
"""

PROTECTED_SCAN = """            const scan = scanForProtected(input.tool_input, confinement)
"""

PLAN_FLOOR = """            if (
              planning() &&
"""

MUTATIONS = [
    # ---- §1 · where the memory lives -------------------------------------------------------------
    (
        "M1 · ⛔ THE FEATURE · the launch option goes, so the provider derives the per-cwd directory "
        "again and the same developer meets a blank memory in the next repository",
        [(RUNTIME, SETTINGS_LINE, "")],
    ),
    (
        "M2 · the directory becomes the provider HOME itself — a plausible simplification that also "
        "widens §2's exemption to every file in the home, including settings.json",
        [
            (
                AUTOMEM,
                "  return join(providerHome, 'memory')\n",
                "  return providerHome\n",
            )
        ],
    ),
    (
        "M3 · 🔴 106's OWN PREDICTION · the ultracode line assigns instead of merging, so every "
        "ultracode session silently loses its memory directory",
        [
            (
                RUNTIME,
                # ⚑ W4.189 · re-anchored in place: ultracode merges onto the settings optionsFor built.
                "      options.settings = { ...options.settings, ultracode: true }\n",
                "      options.settings = { ultracode: true }\n",
            )
        ],
    ),
    (
        "M4 · the model probe stops sending it, so ONE profile has two answers to where it remembers",
        # ⚑ W4.189 · re-anchored in place: the probe passes the kept rules it read.
        # ⚑ **the independent location module · re-anchored in place, not retired** — the model list reads its kept rules before it builds its options; the mutation still removes the probe's setting
        [(RUNTIME, "        ...flagSettingsFor(providerHome, kept),\n", "")],
    ),
    # ---- §2 · the card, and the boundary ---------------------------------------------------------
    (
        "M5 · ⛔ THE CARD IS BACK · `continue` instead of `allow`, which hands the call to the rule "
        "engine and publishes the permission request 166 exists to remove",
        [
            (
                RUNTIME,
                "              return allowFor('brobot2 lets this profile keep its own memory without asking')\n",
                "              return { continue: true }\n",
            )
        ],
    ),
    (
        "M6 · the exemption widens from the memory directory to the whole provider home — plans, "
        "CLAUDE.md and settings.json all stop raising cards",
        [
            (
                RUNTIME,
                "              writesOnlyWithin(input.tool_input, claudeAutoMemoryDir(confinement.providerHome))\n",
                "              writesOnlyWithin(input.tool_input, confinement.providerHome)\n",
            )
        ],
    ),
    (
        "M7 · ⛔ 032's SECOND PREDICATE · containment becomes a `startsWith` on `file_path`, so the "
        "prefix trap opens and every other string in the input stops being examined",
        [
            (
                RUNTIME,
                "              writesOnlyWithin(input.tool_input, claudeAutoMemoryDir(confinement.providerHome))\n",
                "              String((input.tool_input as { file_path?: unknown })?.file_path ?? '').startsWith(\n"
                "                claudeAutoMemoryDir(confinement.providerHome),\n"
                "              )\n",
            )
        ],
    ),
    (
        "M8 · the exemption moves ABOVE the plan-mode floor, so a planning session writes outside "
        "its plan file — 150's carve-out widened by association",
        [(RUNTIME, MEMORY_ALLOW, ""), (RUNTIME, PLAN_FLOOR, MEMORY_ALLOW + PLAN_FLOOR)],
    ),
    (
        "M9 · it moves ABOVE the protected-path refusal, so a symlink out of the memory directory "
        "carries a write into the credential store with nothing to click",
        [(RUNTIME, MEMORY_ALLOW, ""), (RUNTIME, PROTECTED_SCAN, MEMORY_ALLOW + PROTECTED_SCAN)],
    ),
    (
        "M10 · it moves ABOVE 063's question routing, so a question can be answered by the app "
        "instead of by the user by naming a path inside the memory directory",
        [(RUNTIME, MEMORY_ALLOW, ""), (RUNTIME, USER_INPUT_GUARD, MEMORY_ALLOW + USER_INPUT_GUARD)],
    ),
    # ---- §3 · the surface -------------------------------------------------------------------------
    (
        "M11 · the drawer keeps looking where the memory USED to be, so the surface 165 built goes "
        "blank the moment 166 moves the file",
        [
            (
                INSTRUCTIONS,
                "import { claudeAutoMemoryIndex } from '@brobot2/runtime'\n",
                "import { providerDefaultAutoMemoryDir } from '@brobot2/runtime'\n",
            ),
            (
                INSTRUCTIONS,
                "function readAgentMemory(providerHome: string): InjectedInstruction | null {\n"
                "  const path = claudeAutoMemoryIndex(providerHome)\n",
                "function readAgentMemory(providerHome: string): InjectedInstruction | null {\n"
                "  const path = join(providerDefaultAutoMemoryDir(providerHome, process.cwd()), 'MEMORY.md')\n",
            ),
        ],
    ),
]


def apply(root: Path, index: int) -> bool:
    _, edits = MUTATIONS[index]
    staged: list[tuple[Path, str]] = []
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        seen = text.count(old)
        if seen != 1:
            print(f"    !! anchor found {seen} times in {rel}: {old[:70]!r}", file=sys.stderr)
            return False
        staged.append((path, text.replace(old, new, 1)))
        # Later edits in the same mutation must see the earlier ones.
        path.write_text(staged[-1][1])
    return True


def main() -> int:
    if sys.argv[1:2] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if sys.argv[1:2] == ["--name"]:
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    root, index = Path(sys.argv[1]), int(sys.argv[2])
    return 0 if apply(root, index) else 1


if __name__ == "__main__":
    raise SystemExit(main())
