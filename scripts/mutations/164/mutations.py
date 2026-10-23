#!/usr/bin/env python3
"""
164 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand** (157's dry-run corrupted three source files that way; 129's trap
and the pristine copy in `mutate.sh` are the reason this one cannot).

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on.

## What the table is about

⛔ **M1–M5 are the capability, and M1 is the state this ticket found the app in.** The launch option
is the whole fix: `Grep` and `Glob` were exempt in the floor and absent from the session, so the
exemption named two tools that could not be called. ⚠️ **M3 is the one that matters most** — it buys
the same two tools with `allowedTools`, which reaches the same list and removes `canUseTool` from
their path. It is the cheaper-looking option, the SDK warns about it by name, and a table without it
would leave the choice looking arbitrary.

⛔ **M6–M9 are 086 on the refusal sentence**: one string covering three different refusals, which is
the state the live tester reported (*"'may not run commands' reads oddly as the reason a SUBAGENT
was blocked"*).

⛔ **M10 lets the `Explore` subagent in** — by the argument in the model's own input, which is the
shape of exemption this floor exists to refuse.

⛔ **M11–M12 are the false label** (§3.2), in both directions: the workspace file claiming to be
checked into a codebase, and the distinction collapsing the other way so every project file gets the
workspace's wording.

⛔ **M13–M14 are §4's documented boundary** — the sentence going entirely, and the sentence reaching
only Claude, which would leave the Codex profile with an isolation nobody told it about.
"""

import sys
from pathlib import Path

RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"
INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
WORKSPACE = "apps/desktop/src/main/runtime/workspace.ts"

# ⚑ **W4.480 · re-anchored in place, not retired** — NOT VERIFIED; source-only. Held: running it needs W4’s written lift. Built-in skills moved the anchor; original defect, ID and killer retained.
VOCABULARY_LINE = "      tools: [...SEARCH_TOOLS_VOCABULARY, ...(builtInSkills ? ['Skill'] : [])],\n"

CLAUSE_BODY = """  if (FILE_TOOLS.has(toolName)) return 'change files other than its own plan file'
  if (toolName === 'Bash' || toolName === 'KillShell') return 'run commands'
  if (SPAWN_TOOLS.has(toolName)) return 'start another agent to do it'
  if (toolName === 'WebFetch' || toolName === 'WebSearch') return 'reach the network'
  return `use ${toolName}`
"""

WORKSPACE_SENTENCE = """
Your instructions are this profile's own: BroBot runs each agent profile from its own provider home,
so the instruction files that apply here are the ones in this workspace and in that home, and the
personal CLAUDE.md in the machine's home directory is deliberately not among them.
"""

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · the capability ------------------------------------------------------------------
    (
        "M1 · ⛔ 150 IS BACK · the launch option goes, so the session has no search tool at all and "
        "the floor goes on exempting two names that cannot be called",
        [(RUNTIME, VOCABULARY_LINE, "")],
    ),
    (
        "M2 · `preset:default` is dropped — `--tools Grep,Glob` NARROWS the pool, so plan mode gets "
        "its search by taking Read/Write/Bash away from every session",
        [
            (
                RUNTIME,
                "const SEARCH_TOOLS_VOCABULARY: readonly string[] = ['preset:default', 'Grep', 'Glob']",
                "const SEARCH_TOOLS_VOCABULARY: readonly string[] = ['Grep', 'Glob']",
            )
        ],
    ),
    (
        "M3 · ⚠️ the vocabulary is bought with `allowedTools` instead · same two tools, and "
        "`canUseTool` is no longer invoked for either (001 non-negotiable 1)",
        [(RUNTIME, VOCABULARY_LINE, "      allowedTools: ['Grep', 'Glob'],\n")],
    ),
    (
        "M4 · only `preset:default` survives — an option that looks configured and adds nothing",
        [
            (
                RUNTIME,
                "const SEARCH_TOOLS_VOCABULARY: readonly string[] = ['preset:default', 'Grep', 'Glob']",
                "const SEARCH_TOOLS_VOCABULARY: readonly string[] = ['preset:default']",
            )
        ],
    ),
    (
        "M5 · the vocabulary is set only for a session LAUNCHED planning — one that enters plan mode "
        "mid-conversation keeps the toolset of the session it used to be",
        [
            (
                RUNTIME,
                VOCABULARY_LINE,
                "      ...(planMode === true ? { tools: [...SEARCH_TOOLS_VOCABULARY] } : {}),\n",
            )
        ],
    ),
    # ---- §2 · what the refusal SAYS -----------------------------------------------------------
    (
        "M6 · ⛔ one string for three refusals IS BACK · every refusal says 'may not run commands'",
        [(RUNTIME, CLAUSE_BODY, "  void toolName\n  return 'run commands'\n")],
    ),
    (
        "M7 · a refused WRITE is told it may not run commands",
        [
            (
                RUNTIME,
                "  if (FILE_TOOLS.has(toolName)) return 'change files other than its own plan file'\n",
                "",
            )
        ],
    ),
    (
        "M8 · a refused SUBAGENT is told it may not run commands — the tester's own sentence",
        [(RUNTIME, "  if (SPAWN_TOOLS.has(toolName)) return 'start another agent to do it'\n", "")],
    ),
    (
        "M9 · a tool the app has never heard of is given a story it cannot support",
        [(RUNTIME, "  return `use ${toolName}`\n", "  return 'reach the network'\n")],
    ),
    # ---- §1.3 · the Explore ruling -------------------------------------------------------------
    (
        "M10 · ⛔ the `Explore` subagent is let in · `Task` joins the exemptions, so a floor decides "
        "what a spawned agent may do by reading a string in the model's own input",
        [(RUNTIME, "  'ToolSearch',\n", "  'ToolSearch',\n  'Task',\n")],
    ),
    # ---- §3.2 · the label the model reads ------------------------------------------------------
    (
        "M11 · ⛔ the generated workspace file claims to be checked into a codebase again, three "
        "lines above the CLI saying the directory is not a repository",
        [
            ("apps/desktop/src/main/providers/instruction-composition.ts", "  if (kind === 'workspace-instructions') return 'generated by BroCrew for this workspace'\n", ""),
        ],
    ),
    (
        "M12 · …and the collapse the other way: every project file is labelled BroBot's own",
        [
            ("apps/desktop/src/main/providers/instruction-composition.ts", "  if (kind === 'workspace-instructions') return 'generated by BroCrew for this workspace'\n", "  if (kind !== 'profile-memory') return 'generated by BroCrew for this workspace'\n"),
        ],
    ),
    # ---- §4 · the documented boundary ----------------------------------------------------------
    # Re-anchored to retained migration text; NOT VERIFIED and HELD.
    (
        "M13 · ⛔ the isolation goes back to being silent — true, unstated, and therefore a guardrail "
        "the user believes is there",
        [(WORKSPACE, WORKSPACE_SENTENCE, "\n")],
    ),
    # Retired: the edited operation or wording was deleted, rather than moved.
    # RETIREMENT APPROVED — 164 M14: anchor-absent; removed by 58398c57a. Generated workspace instruction
    # publication and its published-pair content/path were removed.
    # workspaceInstructionFiles/workspaceOwnFilesIn now return []; the two conversation rules are in
    # factory text and marked legacy files are removed. Atomic publishOwnFile remains for other owners,
    # but mutating it would not recreate the eliminated workspace launch publication. Definition retained
    # as historical evidence; no row execution.
    (
        "M14 · …or it is stated to Claude only, leaving the Codex profile isolated and untold",
        [
            (
                WORKSPACE,
                "  return `${header}\\n\\n${WORKSPACE_INSTRUCTIONS}`",
                "  return provider === 'claude'\n"
                "    ? `${header}\\n\\n${WORKSPACE_INSTRUCTIONS}`\n"
                "    : `${header}\\n\\n${WORKSPACE_INSTRUCTIONS.replace(\n"
                "        \"\\nYour instructions are this profile's own\",\n"
                "        '\\nOMITTED',\n"
                "      )}`",
            )
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
    for path, text in staged:
        path.write_text(text)
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
