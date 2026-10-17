#!/usr/bin/env python3
"""
158 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run did, with a `git checkout` loop, and one of its
paths was untracked — so git aborted the whole checkout every iteration and 22 mutations accumulated
silently. ⚠️ 158 adds TWO untracked source files (`instructions.ts`, `SessionInstructions.vue`), so
that trap is live again.

⚠️ **Anchors are taken from the FORMATTED source** (147 M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on). Every target here was copied after
the last format run.

## What the table is about

158 has three subjects and the table is grouped by them.

- **§1 · 🔒 the reader is a security boundary.** Closing "BroBot never loads a repo's `CLAUDE.md`"
  means this app now opens files chosen by a directory the agent itself can WRITE. M1–M8 are that
  boundary, one guard at a time.
- **§2 · what loads, and from where.** M9–M14: the walk 156 measured, and the paths it measured.
- **§3 · if we inject it, he can see it.** M15–M19: the disclosure. An injection nobody can see is
  the state 158 exists to end, so a mutation that keeps the model informed and the user in the dark
  must be RED.

⚠️ **Two mutations are expected GREEN and are here anyway** (M3, M4). They remove the second and
third guards on the symlink path — `O_NOFOLLOW` and the `ino`/`dev` compare — which only matter in
the window BETWEEN the `lstat` and the `open`. No test in this repo can stage that race, so their
green is a true statement about the suite rather than about the code, and it is worth having on the
record: the layered guards are defence in depth, and only the first layer is under test.

⛔ **One mutation is deliberately ABSENT and the reason is the finding.** Removing *both*
regular-file checks would be caught by the directory case — and would then HANG the run forever on
the FIFO case, because `open()` on a named pipe with no writer blocks and no test timeout can
interrupt a blocking syscall in the worker. That is precisely why the `lstat` check is placed before
the `open` rather than after it. M5 and M6 remove the two checks SEPARATELY, which is safe, and each
is green because the other still catches its case.
"""

import sys
from pathlib import Path

INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
INDEX = "apps/desktop/src/main/index.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
VIEW = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
# ⚑ **583 · where rule 2 lives now** — see M21.
GROUPS = "apps/desktop/src/renderer/src/lib/whose-groups.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · 🔒 the reader ---------------------------------------------------------------------
    (
        "M1 · 🔒 the SYMLINK refusal is gone, so a `CLAUDE.md` the agent planted pointing at a "
        "credential file is read into the next launch's prompt",
        [
            (
                INSTRUCTIONS,
                "  if (link.isSymbolicLink()) return { ok: false, reason: 'symlink' }\n",
                "",
            )
        ],
    ),
    # A linked .claude directory is followed. This row retains the removed refusal as its absent
    # anchor and is retired; a dangling link still has its own disclosure check.
    (
        "M2 · …and the symlinked `.claude` DIRECTORY is followed, which redirects the whole lookup "
        "while the leaf looks perfectly ordinary",
        [
            (
                INSTRUCTIONS,
                "      if (stat.isSymbolicLink()) refused.push({ path: dot, reason: 'symlink' })\n"
                "      else dotUsable = stat.isDirectory()",
                "      dotUsable = stat.isDirectory() || stat.isSymbolicLink()",
            )
        ],
    ),
    (
        "M3 · ⚠️ `O_NOFOLLOW` is dropped — the kernel's independent guard, expected GREEN because no "
        "test can stage the lstat→open race",
        [
            (
                INSTRUCTIONS,
                "    fd = openSync(path, constants.O_RDONLY | O_NOFOLLOW)",
                "    fd = openSync(path, constants.O_RDONLY)",
            )
        ],
    ),
    (
        "M4 · ⚠️ …and the descriptor-identity compare goes too, so a file swapped in that same "
        "window is read — also expected GREEN, for the same reason",
        [
            (
                INSTRUCTIONS,
                "    if (held.ino !== link.ino || held.dev !== link.dev) return { ok: false, reason: 'symlink' }\n",
                "",
            )
        ],
    ),
    (
        "M5 · the `lstat` non-regular check admits directories (FIFOs still refused, or this would "
        "hang) — the `fstat` backstop is what has to catch it",
        [
            (
                INSTRUCTIONS,
                "  if (!link.isFile()) return { ok: false, reason: 'not-a-regular-file' }",
                "  if (!link.isFile() && !link.isDirectory())\n"
                "    return { ok: false, reason: 'not-a-regular-file' }",
            )
        ],
    ),
    (
        "M6 · …and the other way round: the `fstat` check goes, leaving only the `lstat` one",
        [
            (
                INSTRUCTIONS,
                "    if (!held.isFile()) return { ok: false, reason: 'not-a-regular-file' }\n",
                "",
            )
        ],
    ),
    (
        "M7 · ⛔ the byte cap is not applied at all, so a 40 MB file named CLAUDE.md rides every "
        "request of the conversation",
        [
            (
                INSTRUCTIONS,
                "      const room = cap - total",
                "      const room = Number.POSITIVE_INFINITY",
            )
        ],
    ),
    (
        "M8 · …and the cap still applies but TRUNCATION is never reported, so a file that was cut "
        "reads as a file that was short",
        [
            (
                INSTRUCTIONS,
                "        truncated = read > room || readSync(fd, buffer, 0, 1, null) > 0",
                "        truncated = false",
            )
        ],
    ),
    (
        "M9 · strict UTF-8 becomes lenient, so invalid bytes reach the model as replacement "
        "characters instead of being refused",
        [
            (
                INSTRUCTIONS,
                "      text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))",
                "      text = new TextDecoder('utf-8').decode(Buffer.concat(chunks))",
            )
        ],
    ),
    # ---- §2 · what loads, and from where --------------------------------------------------------
    (
        "M10 · ⛔ the HOME boundary is removed, so the walk climbs to the filesystem root and reads "
        "the user's personal ~/CLAUDE.md and ~/.claude/CLAUDE.md",
        [
            (
                INSTRUCTIONS,
                "    if (isHomeOrAbove(dir, homeResolved)) break",
                "    if (dir === '/') break",
            )
        ],
    ),
    (
        "M11 · only the cwd is read and no ancestors, so a repo whose CLAUDE.md sits at its root "
        "loads nothing (the CLI loads it)",
        [
            (
                INSTRUCTIONS,
                "    chain.unshift(dir)\n"
                "    const parent = dirname(dir)\n"
                "    if (parent === dir) break // the filesystem root, for a cwd that is not under home at all\n"
                "    dir = parent",
                "    chain.unshift(dir)\n    break",
            )
        ],
    ),
    (
        "M12 · the `.claude/CLAUDE.md` spelling is dropped — 156's control measured BOTH at every "
        "level",
        [
            (
                INSTRUCTIONS,
                # ⚑ Corrected in place at `733` (rule 27): the block became one line when a linked
                # `.claude` stopped being refused. The rule — both spellings, at every level — holds.
                "    if (dotUsable) take(nested, kindFor(nested, inputs.workspaceFile))\n",
                "    if (false && dotUsable) take(nested, kindFor(nested, inputs.workspaceFile))\n",
            )
        ],
    ),
    (
        # ⚠️ **Anchor corrected by `377`, and the ROW is untouched.** That dispatch added a second
        # walk to this file — `codexConventionChain`, the repository bridge — which also unshifts, so
        # the bare line now matches twice. ⛔ The subject is still `projectInstructionChain`'s order;
        # the home-boundary `break` above it is what pins which of the two walks this row is about.
        "M13 · the chain is innermost-first, so the deepest file loses the prompt position the CLI "
        "gives it",
        [
            (
                INSTRUCTIONS,
                "    if (isHomeOrAbove(dir, homeResolved) || isHomeOrAbove(realPath(dir), homeReal)) break\n    chain.unshift(dir)",
                "    if (isHomeOrAbove(dir, homeResolved) || isHomeOrAbove(realPath(dir), homeReal)) break\n    chain.push(dir)",
            )
        ],
    ),
    (
        "M14 · ⛔ profile memory is read from `<home>/.claude/CLAUDE.md` — the path 156 §1 measured "
        "as the WRONG one",
        [
            (
                INSTRUCTIONS,
                "  take(join(inputs.providerHome, INSTRUCTION_FILENAME), 'profile-memory')",
                "  take(\n"
                "    join(inputs.providerHome, INSTRUCTION_DOTDIR, INSTRUCTION_FILENAME),\n"
                "    'profile-memory',\n"
                "  )",
            )
        ],
    ),
    (
        "M15 · Codex is injected for as well, duplicating the files it already reads itself",
        [
            (
                INSTRUCTIONS,
                "  if (inputs.provider !== 'claude') {\n"
                "    return { injected, provider: [], refused, note: NOTE_PROVIDER_READS_ITS_OWN }\n"
                "  }\n",
                "",
            )
        ],
    ),
    # ---- §2 · resume, the half 156 named --------------------------------------------------------
    (
        "M16 · ⛔ 056 IS BACK · resume passes no hint, so a reopened conversation forgets who it is",
        [
            (
                HOST,
                "        ...(instructions?.systemHint ? { systemHint: instructions.systemHint } : {}),\n",
                "",
            )
        ],
    ),
    (
        "M17 · …and the Claude adapter drops it one layer down, where 056's `undefined` used to sit · killed by `claude-runtime.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — same argument, re-indented when 39862830 lifted resume's optionsFor call into `const built = ...`; occurs once
        [(CLAUDE, "        options.systemHint,", "        undefined,")],
    ),
    (
        "M18 · 🔒 the door opens — `settingSources: ['project']`, the one thing 156 §5 ruled out",
        # Anchored on the comment above it: `settingSources: []` appears twice in this file, and the
        # other one is the model-discovery probe, which launches nothing.
        [
            (
                CLAUDE,
                "      // in BOTH modes. Yolo drops prompting; it does not un-isolate the profile or leak auth.\n"
                "      settingSources: [],",
                "      // in BOTH modes. Yolo drops prompting; it does not un-isolate the profile or leak auth.\n"
                "      settingSources: ['project'],",
            )
        ],
    ),
    # ---- §3 · if we inject it, he can see it ----------------------------------------------------
    (
        "M19 · ⛔ THE 158 STATE · the text is injected and the renderer is told nothing, which is "
        "exactly what 156 §4 measured — on BOTH hand-over paths",
        [
            (
                HOST,
                "      // What this session was told, ours and the provider's (158) — read at launch, disclosed here,\n"
                "      // and never refreshed while it runs. See {@link instructionsFor}.\n"
                "      instructions: instructionsFor(session),",
                "      instructions: NO_INSTRUCTIONS,",
            ),
            (
                HOST,
                "      // ⚠️ Off the SESSION, so a re-attach and a reopen answer identically (158): a reopen read the\n"
                "      // files a moment ago, a re-attach reports what the running session was launched with, and\n"
                "      // neither re-reads to fill this in.\n"
                "      instructions: instructionsFor(session),",
                "      instructions: NO_INSTRUCTIONS,",
            ),
        ],
    ),
    (
        "M20 · Codex's reported sources are dropped again — the 'no runtime consumer' state",
        [
            (
                CODEX,
                "    this._instructionSources = readStringArray(response, 'instructionSources')",
                "    this._instructionSources = undefined",
            )
        ],
    ),
    (
        "M21 · a session told NOTHING renders the block anyway — an empty section, 086 in the other "
        "direction",
        [
            # ⚑ **583 · the anchor's BYTES moved and its subject did not** (standing rule 27,
            # `correct-a-stale-mutation-anchor-dont-retire-it`). The `anything` boolean gated ONE block over four empty lists; 583 gave every group its
            # own gate, so the same rule is now per heading instead of per panel — and the row asks
            # the same question: with the gate open, does an empty group draw a heading anyway?
            # ⛔ **Corrected in place and re-verified RED by hand** — a corrected anchor keeps a
            # verdict it never earned until somebody re-takes it.
            (
                GROUPS,
                "      drawn: whose === 'configured' || whose === 'learned' || mine.length > 0 || held.length > 0,\n",
                "      drawn: true,\n",
            )
        ],
    ),
    (
        "M22 · the provider's list is presented without saying it is the PROVIDER's, so BroBot "
        "appears to have chosen files it never read",
        [
            # ⚑ **Anchor corrected by 356, not retired** — the defect is unchanged and so is the
            # element it deletes. 356 §1 moved the long form of this sentence behind the block's own
            # disclosure and left a LABEL on the panel; 357 had separately found the old wording
            # claiming more than its oracle proves. The row still asks the same question: with this
            # element gone, does anything on the panel say the list is the provider's?
            (
                VIEW,
                '          <div class="muted lead" data-cy="provider-instructions-lead">\n            Reported by the provider.\n          </div>\n',
                "",
            )
        ],
    ),
    (
        # ⚑ Label corrected at `733`: it named *"the planted symlink M1 is about"*, and since `733` a
        # working link is followed — the file the reader could not read is a loop, a FIFO, bad bytes.
        "M23 · a refused file is skipped in silence, so a file the reader could not read — a loop of "
        "links, a FIFO, bad bytes — leaves no trace on screen",
        [
            (
                INSTRUCTIONS,
                # ⚑ Corrected in place at `733` (rule 27): a refusal is pushed as `said` now, because a link to
                # nothing is disclosed from the `absent` arm too. The rule — a refused file is a row — holds.
                "      if (said !== null) refused.push(said)\n",
                "",
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

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(
                f"MUTATION DID NOT APPLY: {rel} matched {found} times, expected 1", file=sys.stderr
            )
            return 2
        path.write_text(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
