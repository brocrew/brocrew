#!/usr/bin/env python3
"""
170 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

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

⛔ **One root cause: `O_NOFOLLOW` protects only the FINAL path component, and every guard written
since 153 read as if it protected the path.** 168 found three exploits of that one fact and they land
in three different places, so the table is grouped by where the fix went rather than by the finding.

⛔ **M1–M3 are §1: the attested exemption root** (168 H2). `<providerHome>/memory -> <providerHome>`
turned 166's cardless memory exemption into an exemption for the whole profile home, because every
comparison `writesOnlyWithin` makes is against the root it was handed and a redirected root satisfies
all of them by construction. M1 is the defect; M2 and M3 are the two ways the fix can be too strict,
which matter because the failure they produce is a card on every ordinary memory write.

⛔ **M4–M10 are §2: a source the user cannot see** (168 H3). The pinned CLI loads
`memory/MEMORY.md` with `stat`, not `lstat`, so a symlinked index is in the model's prompt before
BroBot is asked anything — while BroBot refused it and `readAgentMemory` collapsed the refusal to
`null`. Two separate defects: the silence (M6, M7) and the refusal itself (M4, M5). M8–M10 are the
disclosure that makes following honest, mutated in all three layers it passes through.

⛔ **M11–M12 are §3 and §4: the lexical comparison** (168 H4, plus one the class audit found).
`/tmp/home-alias -> $HOME` is not lexically below the personal home, so the chain's exclusion never
fired and the personal `~/.claude/CLAUDE.md` went into the prompt under the alias's name. M12 is the
same mistake in the workspace label, where it is a provenance lie rather than a disclosure.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The regular-file check under `follow`.** Relaxing it is a real defect — a link to a FIFO with
    no writer blocks the launch forever — and it is exactly the reason it cannot be mutated here: the
    failure mode is a HUNG suite, not a red one, and a harness that hangs reports nothing at all.
    169's M3 taught the general form of this (a mutation must leave a tree that still behaves); the
    guard is asserted positively instead, by `a link to a FIFO is still refused`.
 2. **`claudeAutoMemoryDir` itself.** It stays a plain `join` on purpose — it is the value SENT to
    the CLI as `settings.autoMemoryDirectory` and the path shown in the drawer, so attesting it at
    the source would hand the provider a different directory from the one this app names. The
    attestation belongs where a DECISION is made, and M1 is that place.
 3. **The comment-only change in `claude-runtime.ts`.** The exemption call site is unchanged; the
    attestation was folded into `writesOnlyWithin` precisely so no call site has to remember it.
    There is nothing there to break that M1 does not already break.
 4. **H1.** It is `171`'s, by the dispatch's own scope ruling.
"""

import sys
from pathlib import Path

CONFINEMENT = "packages/runtime/src/internal/confinement.ts"
INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"

MUTATIONS = [
    # ---- §1 · the attested exemption root -------------------------------------------------------
    (
        "M1 · 🔴 168 H2 · the exemption root stops being attested, so `memory -> <providerHome>` "
        "widens the cardless write to the whole profile home — instructions, config, anything "
        "addressed through the alias",
        [
            (
                CONFINEMENT,
                "  const root = attestedRoot(derived)\n  if (root === null) return false\n",
                "  const root = derived\n",
            )
        ],
    ),
    (
        "M2 · the attestation resolves the PARENT lexically, so a provider home under macOS's "
        "`/var/folders/…` (really `/private/var/…`) is never attested and every ordinary memory "
        "write is carded — the fix, too strict",
        [
            (
                CONFINEMENT,
                "  const asDerived = join(realResolve(dirname(absolute)), basename(absolute))\n",
                "  const asDerived = join(resolve(dirname(absolute)), basename(absolute))\n",
            )
        ],
    ),
    (
        "M3 · the attestation requires the root to EXIST, so the FIRST write into `memory/` or "
        "`plans/` — the one that creates the directory, and the whole case the carve-out is for — "
        "raises a card",
        [
            (
                CONFINEMENT,
                "  return realResolve(absolute) === asDerived ? absolute : null\n",
                "  try {\n"
                "    return realpathSync(absolute) === asDerived ? absolute : null\n"
                "  } catch {\n"
                "    return null\n"
                "  }\n",
            )
        ],
    ),
    # ---- §2 · a source the user cannot see -------------------------------------------------------
    (
        "M4 · ⛔ 168 H3 · the agent-memory read stops following, so the symlinked index the PROVIDER "
        "already loaded is refused here — no visibility and no protection, which is the state the "
        "ruling exists to end",
        [
            (
                INSTRUCTIONS,
                # ⚑ Corrected in place at `733` (rule 27): the reader has no `follow` option since `733` — every read
                # follows — so this one line is the index's AND the walk's. The rule it measures holds.
                "    seen = statSync(path)\n",
                "    seen = lstatSync(path)\n",
            )
        ],
    ),
    (
        "M5 · the same refusal from the OTHER guard — `stat` still follows but `O_NOFOLLOW` is kept, "
        "so the kernel refuses at `open` instead of the `lstat` refusing at step 1 (the pair 158 "
        "built deliberately, so both halves are measured)",
        [
            (
                INSTRUCTIONS,
                # ⚑ Corrected in place at `733` (rule 27): `O_NOFOLLOW` went with the `follow` option (`733`); the
                # mutation puts it back at `open`, the half of the pair this row always measured.
                "    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))\n",
                "    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | constants.O_NOFOLLOW)\n",
            )
        ],
    ),
    # ⚑ **BOTH ANCHORS CORRECTED IN PLACE BY 314** (142), and M7's SUBJECT moved with it. 170 wrote
    # one ternary; 314 §3 split it, because a dangling link is no longer treated as an absence.
    #
    # ⚑ **AND AGAIN BY 317** — M6, M7, M8 and M10, none of them a premise change this time. `317`
    # turned `agentMemory` into a LIST because 314 gave Codex a memory store of several files, so
    # `readAgentMemory`'s body moved wholesale into `readMemoryStore`, which loops. Every claim
    # below is the claim it always was, aimed at the same line under its new name: `path` became
    # `candidate.path`, a `return` became a `declare(...)` plus `continue`, the panel's row became a
    # `v-for` item. ⛔ **The recorded RED was measured against the OLD text** — `CENSUS.md`'s
    # per-file digests are what make that checkable, and re-running is the only thing that makes
    # these verdicts current.
    (
        "M6 · ⛔ THE SILENCE · every read failure collapses to `null` again, so a `MEMORY.md` the "
        "provider loaded and BroBot could not read looks exactly like a session with no memory",
        [
            (
                INSTRUCTIONS,
                "      declare({ path: candidate.path, reason: read.reason })\n      continue\n",
                "      continue\n",
            )
        ],
    ),
    # ⛔ **M7's premise was OVERTURNED by 314 §3, and the row is corrected rather than retired.**
    #
    # It used to read: *"a DANGLING link becomes a refusal, so the panel warns about a file that
    # steered nothing — the provider's own `stat` failed the same way."* That was right about the
    # PROMPT and wrong about the PANEL. 312 measured a real Claude child following a `memory/
    # MEMORY.md` symlink out of the provider home; when the target later disappears — a `/tmp` target
    # after a reboot, which is the state one real profile is in — the read is ENOENT, `absent` is
    # silent, and the panel says nothing at all about a profile that HAD a memory and now does not.
    # So a broken link is disclosed now, deliberately.
    #
    # ⚑ **What survives is the discipline M7 was defending, narrowed to the case 314 left standing:
    # an ABSENCE must stay silent.** The edit below is the same defect it always was — a warning
    # about a file that steered nothing — aimed at the half where that is still true, and it is
    # killed by the same kind of assertion (the silent-home controls) rather than by a new one.
    (
        "M7 · …and the other polarity: a plain ABSENCE becomes a refusal, so a profile that has "
        "never written a memory is warned about a file nobody created — 086 in the other direction "
        "(⚑ premise corrected by 314 §3: a broken LINK is now disclosed on purpose; an absence is "
        "not a link, and this is the half that stayed)",
        [
            (
                INSTRUCTIONS,
                "        const broken = brokenMemoryLink(candidate.path)\n"
                "        if (broken !== null) declare(broken)\n        continue\n",
                "        declare({ path: candidate.path, reason: read.reason })\n        continue\n",
            )
        ],
    ),
    (
        "M8 · the redirection is compared against the LEXICAL provider home, so every ordinary macOS "
        "session reports a link that is not there — the `/var` → `/private/var` trap, in the "
        "false-positive direction",
        [
            (
                INSTRUCTIONS,
                "      derived: claudeAutoMemoryIndex(realPath(providerHome)),\n",
                "      derived: claudeAutoMemoryIndex(providerHome),\n",
            )
        ],
    ),
    (
        "M9 · the READER stops reporting where it really read from, so nothing downstream can "
        "disclose the redirection — the text is shown under a path it did not come from",
        [
            (
                INSTRUCTIONS,
                # ⚑ Corrected in place at `733` (rule 27): `real` is returned on every read since `733`.
                "    return { ok: true, text, bytes: total, truncated, real: realPath(path) }\n",
                "    return { ok: true, text, bytes: total, truncated }\n",
            )
        ],
    ),
    (
        "M10 · the DRAWER's link line renders nothing — the read is honest and the panel is not, "
        "which is the same defect one layer up",
        # ⚠️ The span's CONTENT is emptied rather than the element deleted: this `v-if` has no
        # `v-else` today, but 169's M3 removed a branch that did and three suites stopped COLLECTING
        # instead of failing. Emptying is the form that cannot become a compiler measurement.
        [
            (
                PANEL,
            # ⚑ **583 · the anchor's BYTES moved and its subject did not** (standing rule 27,
            # `correct-a-stale-mutation-anchor-dont-retire-it`). 583 put the address and the link behind the row press — `item` became `block`, and the
            # indentation with it. The element and the defect are unchanged.
            # ⛔ **Corrected in place and re-verified RED by hand** — a corrected anchor keeps a
            # verdict it never earned until somebody re-takes it.
            # ⚑ **733 · moved again, subject unchanged** (rule 27): the line now says WHO followed the
            # link — the provider for the agent's memory, BroBot for a file it appends.
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "                · a link —\n                {{\n                  block.kind.startsWith('agent-memory')\n                    ? 'the provider followed it and read'\n                    : 'BroCrew followed it and read'\n                }}\n                <span class=\"path\">{{ block.link }}</span>\n",
                "\n",
            )
        ],
    ),
    # ---- §3 / §4 · the lexical comparison --------------------------------------------------------
    (
        "M11 · 🔴 168 H4 · the chain's home exclusion drops the real-form test, so a cwd under "
        "`/tmp/home-alias -> $HOME` walks to the alias and BroBot appends the personal "
        "`~/.claude/CLAUDE.md` under a path that names nothing personal",
        [
            (
                INSTRUCTIONS,
                "    if (isHomeOrAbove(dir, homeResolved) || isHomeOrAbove(realPath(dir), homeReal)) break\n",
                "    if (isHomeOrAbove(dir, homeResolved)) break\n",
            )
        ],
    ),
    (
        "M12 · §4 · the workspace label goes back to a lexical compare, so BroBot's OWN generated "
        "file reached through an aliased cwd is presented as project memory the user wrote",
        [
            (
                INSTRUCTIONS,
                "  return workspaceFile !== undefined && realPath(path) === realPath(workspaceFile)\n",
                "  return workspaceFile !== undefined && resolve(path) === resolve(workspaceFile)\n",
            )
        ],
    ),
]


def apply(root: Path, index: int) -> bool:
    _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        seen = text.count(old)
        if seen != 1:
            print(f"    !! anchor found {seen} times in {rel}: {old[:70]!r}", file=sys.stderr)
            return False
        # Later edits in the same mutation must see the earlier ones.
        path.write_text(text.replace(old, new, 1))
    return True


def main() -> int:
    if sys.argv[1:2] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if sys.argv[1:2] == ["--name"]:
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    # ⚠️ **The dry-run is HERE, in Python, and it touches nothing** (166 §11). It counts the anchor
    # in the tree exactly as `apply` would and reports every miss at once, so a table with a reflowed
    # anchor is found before a long run reports `DID NOT APPLY` at mutation nine.
    if sys.argv[1:2] == ["--dry-run"]:
        root = Path(sys.argv[2])
        bad = 0
        for i, (name, edits) in enumerate(MUTATIONS):
            for rel, old, _ in edits:
                seen = (root / rel).read_text().count(old)
                if seen != 1:
                    bad += 1
                    print(f"M{i + 1} anchor x{seen} in {rel}: {old[:70]!r}")
                    print(f"   {name[:100]}")
        print(f"checked {len(MUTATIONS)} bad {bad}")
        return 1 if bad else 0
    root, index = Path(sys.argv[1]), int(sys.argv[2])
    return 0 if apply(root, index) else 1


if __name__ == "__main__":
    raise SystemExit(main())
