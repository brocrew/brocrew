#!/usr/bin/env python3
"""
165 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand** (157's dry-run corrupted three source files that way; 129's trap
and the pristine copy in `mutate.sh` are the reason this one cannot).

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on.

## What the table is about

⛔ **M1–M2 are the flag**, which is what the ticket asked for and only half of what was needed.

🔴 **M3–M5 are the half nobody knew about.** Removing the flag did not turn memory on; a live matrix
showed why. The SDK reads an OMITTED `systemPrompt` as an EMPTY one, so a session whose cwd held no
instruction file had no Claude Code preset at all — and therefore no memory section to enable. M3 is
that defect restored, and it is the most valuable row here: it was invisible for nine dispatches.

⛔ **M6–M8 are the derivation.** The sanitiser is the provider's, restated here, and each mutation is
a plausible-looking "improvement" that would silently point the app at a directory the CLI does not
use — M7 in particular is the one a lexical implementation gets wrong on macOS every time.

⛔ **M9–M12 are the read.** M9 is the one this design exists to prevent: appending a file the
provider already injected, which doubles it in the prompt and claims BroBot chose to send it. M12
removes the guarded reader, which is the symlink boundary the whole module was built around.

⛔ **M13–M16 are the surface** — 086 on the panel: an empty block, a lost author, a wrong order, and
a provider that has no such feature being shown one anyway.
"""

import sys
from pathlib import Path

RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"
AUTOMEM = "packages/runtime/src/claude/auto-memory.ts"
INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"

ADDITIONS = """    const additions: Record<string, string> = {
      CLAUDE_CONFIG_DIR: providerHome,
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    }
"""

# ⚑ 680 corrected this anchor in place (not retired): the literal gained `snapshot: false`, because
# 0.3.281's default records the prompt and ignores a later launch's `append`. M3 and M4 mutate the
# same statement they always did.
PRESET = """    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      ...(systemHint ? { append: systemHint } : {}),
      snapshot: false,
    }
"""

# The two template blocks M16 swaps. Taken from the file itself so the anchors cannot drift.
MEMORY_ROW = '      <!-- ⚑ FIRST, because it reaches the model first: the provider loads this inside its own preset\n           system prompt, and everything BroBot appends lands after that preset. The panel\'s order is\n           the prompt\'s order (165 §3). -->\n      <div\n        v-if="instructions.agentMemory"\n        class="item"\n        :data-cy="`injected-${instructions.agentMemory.kind}`"\n        :data-truncated="instructions.agentMemory.truncated"\n      >\n        <button\n          class="head"\n          type="button"\n          :aria-expanded="open.has(instructions.agentMemory.path)"\n          :data-cy="`injected-toggle-${instructions.agentMemory.kind}`"\n          @click="toggle(instructions.agentMemory.path)"\n        >\n          <svg class="chev" :class="{ down: open.has(instructions.agentMemory.path) }">\n            <use href="#i-chevron" />\n          </svg>\n          <span class="path">{{ instructions.agentMemory.path }}</span>\n        </button>\n        <div class="meta">\n          {{ LABELS[instructions.agentMemory.kind] }} ·\n          {{ bytesLabel(instructions.agentMemory.bytes) }}\n          <span\n            v-if="instructions.agentMemory.truncated"\n            class="cut"\n            :data-cy="`injected-truncated-${instructions.agentMemory.kind}`"\n          >\n            · cut at the size limit — this much was shown here\n          </span>\n        </div>\n        <DocumentBody\n          v-if="open.has(instructions.agentMemory.path)"\n          :source="instructions.agentMemory.text"\n          :filename="basename(instructions.agentMemory.path)"\n          compact\n        />\n      </div>\n\n'

INJECTED_LOOP = '      <!-- What WE read and appended. -->\n      <div\n        v-for="item in instructions.injected"\n        :key="item.path"\n        class="item"\n        :data-cy="`injected-${item.kind}`"\n        :data-truncated="item.truncated"\n      >\n        <button\n          class="head"\n          type="button"\n          :aria-expanded="open.has(item.path)"\n          :data-cy="`injected-toggle-${item.kind}`"\n          @click="toggle(item.path)"\n        >\n          <svg class="chev" :class="{ down: open.has(item.path) }"><use href="#i-chevron" /></svg>\n          <span class="path">{{ item.path }}</span>\n        </button>\n        <div class="meta">\n          {{ LABELS[item.kind] }} · {{ bytesLabel(item.bytes) }}\n          <!-- ⚠️ Truncation is stated where the text is, not in a footnote. The model got this much\n               and no more, and a file that was cut must never read as a file that was short. -->\n          <span v-if="item.truncated" class="cut" :data-cy="`injected-truncated-${item.kind}`">\n            · cut at the size limit — the model was given this much and no more\n          </span>\n        </div>\n        <DocumentBody\n          v-if="open.has(item.path)"\n          :source="item.text"\n          :filename="basename(item.path)"\n          compact\n        />\n      </div>\n\n'

READ_MEMORY = """  const path = claudeAutoMemoryIndex(providerHome, cwd)
  const read = readInstructionFile(path)
  if (!read.ok || read.text.trim() === '') return null
"""

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · the flag ------------------------------------------------------------------------
    (
        "M1 · ⛔ 026 IS BACK · the flag returns and the feature the person asked for is off again",
        [
            (
                RUNTIME,
                "      CLAUDE_CONFIG_DIR: providerHome,\n",
                "      CLAUDE_CONFIG_DIR: providerHome,\n      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',\n",
            )
        ],
    ),
    (
        "M2 · …or it returns as '0' — a meaning that depends on the CLI's coercion rather than on us",
        [
            (
                RUNTIME,
                "      CLAUDE_CONFIG_DIR: providerHome,\n",
                "      CLAUDE_CONFIG_DIR: providerHome,\n      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',\n",
            )
        ],
    ),
    # ---- the preset, which is the half that was invisible --------------------------------------
    (
        "M3 · 🔴 THE INVISIBLE ONE · the preset goes back to being conditional, so a session with no "
        "instruction file gets an EMPTY system prompt and no memory section",
        [(RUNTIME, PRESET, "    if (systemHint) {\n" + PRESET.rstrip("\n") + "\n    }\n")],
    ),
    (
        "M4 · …or the preset is sent as a bare string, which REPLACES it and strips the tool and "
        "permission instructions 001 depends on",
        [(RUNTIME, PRESET, "    options.systemPrompt = systemHint ?? ''\n")],
    ),
    (
        "M5 · `append: ''` when there is no hint — appending nothing and appending an empty string "
        "are different statements, and 158's drawer reports the second",
        [
            (
                RUNTIME,
                "      ...(systemHint ? { append: systemHint } : {}),\n",
                "      append: systemHint ?? '',\n",
            )
        ],
    ),
    # ---- §1 · the derivation --------------------------------------------------------------------
    # RETIREMENT APPROVED — 165 M6: anchor-absent; removed by fe8807828. The unused cwd/project-name
    # sanitizer, realpath and 200-character cap/hash were deleted because they came from reading Claude
    # Code's bundle. Actual memory remains profile-scoped at providerHome/memory (already since 166); that
    # path has no cwd sanitizer/cap to guard. Definition retained as historical evidence; no row
    # execution.
    (
        "M6 · the sanitiser 'improves' on the provider and keeps hyphens and underscores — every "
        "path with one now names a directory the CLI never writes to",
        [
            (
                AUTOMEM,
                "  const flat = path.replace(/[^a-zA-Z0-9]/g, '-')\n",
                "  const flat = path.replace(/[^a-zA-Z0-9\\-_]/g, '-')\n",
            )
        ],
    ),
    # RETIREMENT APPROVED — 165 M7: anchor-absent; removed by fe8807828. The unused cwd/project-name
    # sanitizer, realpath and 200-character cap/hash were deleted because they came from reading Claude
    # Code's bundle. Actual memory remains profile-scoped at providerHome/memory (already since 166); that
    # path has no cwd sanitizer/cap to guard. Definition retained as historical evidence; no row
    # execution.
    (
        "M7 · ⛔ the cwd is no longer REAL-PATHED · on macOS every /var path looks in an empty "
        "directory and a written memory reads as missing",
        [
            (
                AUTOMEM,
                "  let real = cwd\n  try {\n    real = realpathSync(cwd)\n  } catch {\n",
                "  const real = cwd\n  try {\n  } catch {\n",
            )
        ],
    ),
    # RETIREMENT APPROVED — 165 M8: anchor-absent; removed by fe8807828. The unused cwd/project-name
    # sanitizer, realpath and 200-character cap/hash were deleted because they came from reading Claude
    # Code's bundle. Actual memory remains profile-scoped at providerHome/memory (already since 166); that
    # path has no cwd sanitizer/cap to guard. Definition retained as historical evidence; no row
    # execution.
    (
        "M8 · the 200-character cap goes, so two long paths that differ stop being told apart",
        [(AUTOMEM, "  if (flat.length <= FLAT_NAME_CAP) return flat\n", "  return flat\n")],
    ),
    # ---- §2 · the read ---------------------------------------------------------------------------
    (
        "M9 · 🔴 the memory is APPENDED as well as shown · the provider already sent it, so the "
        "model gets it twice and the panel claims BroBot chose to send it",
        [
            (
                INSTRUCTIONS,
                "  return {\n    injected,\n    agentMemory: readAgentMemory(inputs.providerHome, inputs.cwd),\n",
                "  const memory = readAgentMemory(inputs.providerHome, inputs.cwd)\n"
                "  if (memory) injected.push(memory)\n"
                "  return {\n    injected,\n    agentMemory: memory,\n",
            )
        ],
    ),
    (
        "M10 · …or it is charged to the APPEND budget it never spends, silently shrinking the "
        "profile and project memory that is actually appended",
        [
            (
                INSTRUCTIONS,
                "  const read = readInstructionFile(path)\n",
                "  const read = readInstructionFile(path, 0)\n",
            )
        ],
    ),
    (
        "M11 · an EMPTY index becomes an item — a heading over no text, 086 in the other direction",
        [
            (
                INSTRUCTIONS,
                "  if (!read.ok || read.text.trim() === '') return null\n",
                "  if (!read.ok) return null\n",
            )
        ],
    ),
    (
        "M12 · 🔒 the guarded reader is bypassed · a SYMLINKED MEMORY.md is followed, which is the "
        "attack the whole module exists to refuse",
        [
            (
                INSTRUCTIONS,
                READ_MEMORY,
                "  const path = claudeAutoMemoryIndex(providerHome, cwd)\n"
                "  let raw: string\n"
                "  try {\n"
                "    raw = readFileSync(path, 'utf8')\n"
                "  } catch {\n"
                "    return null\n"
                "  }\n"
                "  const read = { ok: true as const, text: raw, bytes: raw.length, truncated: false }\n"
                "  if (read.text.trim() === '') return null\n",
            ),
            (
                INSTRUCTIONS,
                "import { closeSync, constants, fstatSync, lstatSync, openSync, readSync",
                "import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync",
            ),
        ],
    ),
    # ⛔ **M13's PREMISE was overturned by 317, and the row is re-aimed rather than retired** (the
    # third case in 142's rule, the one 314 wrote down). Its label says Codex is *"a provider with no
    # agent-written memory at this pin"*, which 165 measured and which was true for three dispatches.
    # **314 switched Codex's memory on**, so reading memory for Codex is now correct behaviour and an
    # anchor restored to the old text would assert something the product deliberately no longer does.
    # ⚠️ The LABEL is left exactly as written (§5): editing it would hide that a ruling was reversed.
    #
    # ⚑ **What survives is the half 317 kept**: a Codex session must not be handed CLAUDE's memory
    # index. `claudeAutoMemoryIndex` is a fact about a different provider's directory scheme, and
    # reading it here would put another agent's memory on this panel. Same kind of defect — a
    # provider read with the wrong provider's derivation — killed by `instructions.test.ts`'s
    # *"does not read CLAUDE's index for a Codex session"*.
    (
        "M13 · Codex is read for too, a provider with no agent-written memory at this pin",
        [
            (
                INSTRUCTIONS,
                "    const codex = readCodexAgentMemory(inputs.providerHome)\n",
                "    const codex = {\n"
                "      ...readCodexAgentMemory(inputs.providerHome),\n"
                "      memory: readAgentMemory(inputs.providerHome).memory,\n"
                "    }\n",
            )
        ],
    ),
    # ---- §2 · the surface -------------------------------------------------------------------------
    (
        "M14 · the panel's 'is there anything' test goes back to `!== null`, so a session shape "
        "without the field renders an EMPTY instructions block",
        [
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 317** (142). The truthiness test moved into the
            # `agentMemory` computed when the field became a LIST, and this is the same claim at its
            # new address: the component must normalise what it is handed rather than trust the
            # type. ⛔ **The recorded RED was measured against the OLD text.**
            (
                PANEL,
                "const agentMemory = computed(() =>\n"
                "  Array.isArray(props.instructions.agentMemory) ? props.instructions.agentMemory : [],\n)",
                "const agentMemory = computed(() => props.instructions.agentMemory)",
            )
        ],
    ),
    (
        "M15 · the label stops naming the AGENT as the author — three provenances, one word",
        [
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 317** (142). The label lost the provider NAME —
            # *"loaded by Claude itself"* went false at 314, when the other provider grew a memory —
            # and kept the AUTHOR, which is the half this row is about.
            (
                PANEL,
                "  'agent-memory': 'agent memory — written by the agent, loaded by the provider',",
                "  'agent-memory': 'agent memory',",
            )
        ],
    ),
    (
        "M16 · the memory row renders AFTER what BroBot appended, so the panel's order stops "
        "describing the order the model receives them in",
        # ⚠️ The first version of this row set `style="order: 9"` and survived — the parent is not a
        # flex container, so it changed nothing at all. A mutation that is a no-op is not a missing
        # assertion, it is a bad mutation. This one MOVES the block, which is the real defect.
        [
            (PANEL, MEMORY_ROW, ""),
            (PANEL, INJECTED_LOOP, INJECTED_LOOP + MEMORY_ROW),
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
