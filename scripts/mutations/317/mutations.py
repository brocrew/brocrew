"""317 · A sentence that went false — what the suite would notice if each finding came back.

# The findings this table exists to protect

🔴 **A comment that was measured, true, and cited two dispatches — and went false three dispatches
later without anybody touching it.** `instructions.ts` said Codex *"has no agent-written memory of
its own — so there is nothing to derive, nothing to read, and nothing to show"*, citing `165 §4` and
`156`. **`314` switched `[features] memories` and `[memories] dedicated_tools` on for every Codex
profile in this app.** From that commit the app was writing the gate that creates the memory and,
three functions away, telling the panel there was none. Every Codex session reported
`agentMemory: null`.

⚑ **That is friction log F4 from the user's side**: *"codex claimed calling
`memories__add_ad_hoc_note` but I didn't see any of that in the conversation UI."* `316` then
settled that the CALL cannot be rendered — the 0.146.0 app-server publishes no `item/*` for it — so
the remedy is the store, not the event: read what the agent wrote, and show it.

⛔ **And the panel's own label was the same defect one layer up.** *"agent memory — written by the
agent, loaded by Claude itself"* named one provider for a thing both of them now do.

⛔ **The store is not one file and must not be flattened into one.** `312` measured the tree on a
real child: `memory_summary.md` is INJECTED into every request, `MEMORY.md` and the ad-hoc notes are
read by the agent **only if it chooses to**, and `raw_memories.md` / `rollout_summaries/` are the
extraction pipeline's own working material. A panel that rendered all five the same way would be
claiming the model has read things it may never have opened — 009's rule, 305's defect.

# The groups

* **M1-M4 · the sentence, and the store it denied.** The branch itself, and each of the three kinds
  of file the ruling puts on the panel.
* **M5-M9 · injected versus merely on disk** (§2.2), in the reader, in the source of truth and on
  the panel.
* **M10-M11 · the label** (§2.3) — including the exact string `314` shipped, put back.
* **M12-M15 · the ruling about what is NOT shown** (§2.1), and the sentence that says so.
* **M16-M19 · the cost** (§3): the note bound, the byte budget, and 187 §2's own defect
  re-introduced into the new reader.
* **M20-M23 · links, enumeration and the shape.**
* **M24-M25 · found reviewing this diff**, not by a report: a dangling notes directory reported as a
  refusal, and a sentence naming a summary the profile does not have.

# ⚠️ What this table cannot reach

⛔ **The live smoke, which is the only thing that binds the PATH to the child.**
`packages/runtime/smoke/codex-memory-store.smoke.ts` is executed by no vitest project — the smoke
config is excluded from `pnpm run ci` — so **no row below can redden on it**. That matters here for
a specific reason: every unit assertion plants the store with `codexMemorySummary()` and finds it
with a reader that derives the same path from the same function, so **the whole suite passes
whatever that derivation is**. If `memories/` were `memory/`, nothing in this table would notice.
The probe is what closes it, and its run is in the response.

⛔ **`reach` is a claim about the PROVIDER, and only the wire can check it.** M5 and M6 flip the
labels and the suite reddens because unit tests spell the expected values out — a fixture in the
sense 301 means. That the summary really is injected and the handbook really is not was measured on
the wire by the same probe, arm A against arm B.

⛔ **The note sentence's ENGLISH is not checked and cannot be.** M14 and M15 remove clauses and the
tests notice, because they assert on substrings. A sentence that named the right files and described
their standing wrongly would survive, exactly as `308 M12` does one dispatch over.

# ⛔ NOT MEASURED

**Not one row below was applied.** They were verified to apply exactly once (`mutations.py
--dry-run .`) after prettier had formatted the tree — 296's lesson, because formatting moves anchors
— and `mutate.sh` on an idle machine is what finishes the job. Every predicted cell is written
`EXPECTED (NOT MEASURED)` so nothing here reads as a figure somebody took.

⚠️ Like the tables before it, this one does NOT mutate the harness it is run by.

⚑ **Seven anchors in OTHER tables went stale on this dispatch's edits and none was retired** (142):
`165 M13`, `165 M14`, `165 M15`, `170 M6`, `170 M7`, `170 M8`, `170 M10`. ⛔ **`165 M13`'s PREMISE
was overturned** — it asserts Codex is *"a provider with no agent-written memory at this pin"*, which
`314` made false — so it was re-aimed at the half that stayed (a Codex session must not be handed
CLAUDE's memory index) and the reversal is written into 165's own table beside it, with the LABEL
left exactly as it was. The other six moved with the code and say the same thing at their new
addresses. `pnpm run mutations:check` is what says no other anchor moved.
"""

from pathlib import Path

INSTRUCTIONS = "apps/desktop/src/main/runtime/instructions.ts"
STORE = "packages/runtime/src/codex/memory-store.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"

# The panel's `reach` line, quoted whole so M9 can remove it without touching the rows around it.
# ⚑ **583 · the anchor's BYTES moved and its subject did not** (standing rule 27,
# `correct-a-stale-mutation-anchor-dont-retire-it`). ⛔ **And it became TWO edits**: 583 split
# the reach word into a short CHIP a person reads at rest and the full `REACH_WORDS` sentence
# behind the row press. ⚠️ **A row that deleted only one of them would leave the other saying
# it**, which is the row measuring nothing — so M9 takes both, which is the defect it was
# written for: the reader is honest and the screen says nothing about reach anywhere.
# ⛔ **Corrected in place and re-verified RED by hand.**
REACH_CHIP_LINE = (
    "            <span v-if=\"block.reach\" class=\"chip\" :data-cy=\"`memory-reach-${block.reach}`\">\n"
    "              {{ REACH_CHIP[block.reach] ?? block.reach }}\n"
    "            </span>\n"
)
REACH_SAYS_LINE = (
    '            <div v-if="block.reach" class="muted" :data-cy="`memory-reach-says-${block.reach}`">\n'
    "              {{ REACH_WORDS[block.reach] ?? block.reach }}\n"
    "            </div>\n"
)

MUTATIONS = [
    # ── §1 · the sentence, and the store it denied ────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the Codex branch reports no agent memory again, so a "
        "profile whose agent wrote a note when a person asked it to shows nothing anywhere in the "
        "app — friction log F4, shipped "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                # ⚠️ **Narrowed in place, not retired** (332, per 142). The anchor reached through
                # `return {` and the two lines under it, and 332 wrapped that object in a
                # `{ memoryLoaded, instructions: { … } }` and re-indented it — so the row went red
                # about a shape change rather than about its own defect. ⛔ **The mutation is
                # unchanged**: `agentMemory` is emptied, which is the Codex branch reporting no
                # agent memory again, which is F4 shipped. The line below is unique in the file.
                "        agentMemory: codex.memory,",
                "        agentMemory: [],",
            )
        ],
    ),
    (
        "M2 · ⛔ the AD-HOC NOTES are dropped from the store, so the one file a person explicitly "
        "asked the agent to write is the one the panel does not show "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                "    ...notes.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({\n",
                "    ...notes.names.slice(0, 0).map((name) => ({\n",
            )
        ],
    ),
    (
        "M3 · the INJECTED summary is dropped, so the only file the model was actually given is the "
        "only one missing from the panel — the person's standing rule, inverted "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                STORE,
                "  {\n    at: [CODEX_MEMORY_SUMMARY],\n    reach: 'prompt',\n",
                "  {\n    at: [CODEX_MEMORY_SUMMARY + '.disabled'],\n    reach: 'prompt',\n",
            )
        ],
    ),
    (
        "M4 · the CONSOLIDATED handbook is dropped, so `MEMORY.md` — the thing a person means by "
        "\"what does it remember\" — is invisible while its summary is not "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                STORE,
                "  {\n    at: [CODEX_MEMORY_INDEX],\n    reach: 'on-request',\n",
                "  {\n    at: [CODEX_MEMORY_INDEX + '.disabled'],\n    reach: 'on-request',\n",
            )
        ],
    ),
    # ── §2 · injected versus merely on disk ───────────────────────────────────
    (
        "M5 · 🔴 009 · every memory row claims to be IN THE PROMPT, so a note the model has never "
        "opened is presented as something it knows — 305's defect with a friendlier face "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom red",
        # ⚠️ **Anchor corrected in place at 322** (142), not retired: `322` gave Claude's store the
        # same shape, so this one line now exists twice and the row is spelled as BOTH of them —
        # which is what keeps the label's *"every memory row"* literally true rather than narrowing
        # the row to the store it was written against.
        [
            (
                INSTRUCTIONS,
                "      kind: 'agent-memory-note' as const,\n"
                "      // ⚠️ Availability, never comprehension: the note is in the store and the agent can search it.\n"
                "      // Saying the model \"has\" it would be 305's defect with a friendlier face.\n"
                "      reach: 'on-request' as const,\n",
                "      kind: 'agent-memory-note' as const,\n"
                "      reach: 'prompt' as const,\n",
            ),
            (
                INSTRUCTIONS,
                "      kind: 'agent-memory-topic' as const,\n"
                "      // ⚠️ Availability, never comprehension — the same word Codex's notes get, for the same\n"
                "      // reason: the file is in the store and the agent can open it. Saying the model \"has\" it\n"
                "      // would be 305's defect with a friendlier face.\n"
                "      reach: 'on-request' as const,\n",
                "      kind: 'agent-memory-topic' as const,\n"
                "      reach: 'prompt' as const,\n",
            ),
        ],
    ),
    (
        "M6 · …and the other polarity: nothing is marked as in the prompt, so the one file the "
        "provider really did inject reads as something the agent might get round to "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                STORE,
                "    at: [CODEX_MEMORY_SUMMARY],\n    reach: 'prompt',\n",
                "    at: [CODEX_MEMORY_SUMMARY],\n    reach: 'on-request',\n",
            )
        ],
    ),
    (
        "M7 · CLAUDE's index stops saying it is in the prompt, so the provider that has injected it "
        "since 165 is the one the panel is vague about "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 8a3eb8d25 reworded the comment without changing memory-index injection; still misclassify the index as on-request.
                "      // anything: a real child answered from it with no tool call.\n      reach: 'prompt',\n",
                "      // anything: a real child answered from it with no tool call.\n      reach: 'on-request',\n",
            )
        ],
    ),
    (
        "M8 · the reader stops carrying `reach` at all, so the distinction exists in the type and "
        "nowhere a user can see it "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom red",
        [
            (
                INSTRUCTIONS,
                "      truncated: read.truncated,\n      reach: candidate.reach,\n",
                "      truncated: read.truncated,\n",
            )
        ],
    ),
    (
        "M9 · the PANEL stops drawing the reach line — the reader is honest and the screen is not, "
        "which is the same defect one layer up "
        "· EXPECTED (NOT MEASURED): desktop GREEN, dom red",
        # ⚠️ The span's CONTENT is not emptied here, the whole element goes: unlike 170 M10 this
        # `v-if` sits between two other spans, so removing it cannot silently break the template.
        [(PANEL, REACH_CHIP_LINE, ""), (PANEL, REACH_SAYS_LINE, "")],
    ),
    # ── §3 · the label ────────────────────────────────────────────────────────
    (
        "M10 · 🔴 THE SECOND DEFECT, verbatim · the label names CLAUDE again — 314's exact string, "
        "true when written and false for every Codex session since "
        "· EXPECTED (NOT MEASURED): desktop red (disclosure), dom red",
        [
            (
                PANEL,
                "  'agent-memory': 'agent memory — written by the agent, loaded by the provider',",
                "  'agent-memory': 'agent memory — written by the agent, loaded by Claude itself',",
            )
        ],
    ),
    (
        "M11 · a note stops saying somebody ASKED for it, so the row the person went looking for reads "
        "as something the agent decided by itself — 086's three provenances become two "
        "· EXPECTED (NOT MEASURED): desktop red (disclosure), dom red",
        [
            (
                PANEL,
                "  'agent-memory-note': 'agent memory — a note the agent was asked to write',",
                "  'agent-memory-note': 'agent memory',",
            )
        ],
    ),
    # ── §4 · the ruling about what is NOT shown ───────────────────────────────
    (
        "M12 · 🔴 §2.1 reversed · the extraction pipeline's own dump is rendered as \"what the agent "
        "remembers\", inventing a standing it does not have — and a person who edits it is editing "
        "an input phase 2 rewrites "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                STORE,
                "export const CODEX_MEMORY_STORE_FILES: readonly CodexMemoryStoreFile[] = [\n",
                "export const CODEX_MEMORY_STORE_FILES: readonly CodexMemoryStoreFile[] = [\n"
                "  {\n"
                "    at: [CODEX_RAW_MEMORIES],\n"
                "    reach: 'on-request',\n"
                "    what: 'the pipeline dump, rendered as though it were a memory',\n"
                "  },\n",
            )
        ],
    ),
    (
        "M13 · …and the pipeline files stop being NAMED, so the list reads as everything there is "
        "and the store looks three files deep — silence about what was excluded "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                STORE,
                "export const CODEX_MEMORY_PIPELINE_FILES: readonly string[] = [\n"
                "  CODEX_RAW_MEMORIES,\n"
                "  `${CODEX_ROLLOUT_SUMMARIES}/`,\n"
                "]\n",
                "export const CODEX_MEMORY_PIPELINE_FILES: readonly string[] = []\n",
            )
        ],
    ),
    (
        "M14 · the pipeline clause becomes unconditional, so a fresh profile is told about two "
        "files it does not have — the sentence stops being a measurement "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                "    pipeline: CODEX_MEMORY_PIPELINE_FILES.filter((name) => existsSync(join(dir, name))),\n",
                "    pipeline: [...CODEX_MEMORY_PIPELINE_FILES],\n",
            )
        ],
    ),
    (
        "M15 · the whole store sentence goes, so the panel shows three files out of five and says "
        "nothing about where they are or what is missing "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
                # ⚠️ **Anchor corrected by `377`**, which gave this note a second argument so it can
                # name the leaf the app published for Codex to read. ⛔ The row is unchanged: it
                # still replaces the whole store sentence with the bare provider one.
        # ⚑ Landing D-024, D-020 and D-021 · re-anchored in place, not retired — The rule survives:
        # a Codex launch's note must say where the memory store is and what is missing (the store
        # sentence built by codexMemoryNote). D-024 only gave codexMemoryNote a third argument
        # (`inputs.thisConversation !== undefined`) so the anchor line changed; the label's defect
        # is unchanged. The corrected plant replaces the whole call with the two bare
        # provider-reads-its-own leads, still choosing NOTE_SENDS_ONLY_THIS_CONVERSATION when a
        # conversation block exists so D-024's lead is untouched and only the store sentence goes.
        # Killed by `instructions.test.ts`.
        [
            (INSTRUCTIONS, '        note: codexMemoryNote(codex, inputs.bundle, inputs.thisConversation !== undefined),\n', '        note: inputs.thisConversation !== undefined ? NOTE_SENDS_ONLY_THIS_CONVERSATION : NOTE_PROVIDER_READS_ITS_OWN,\n'),
        ],
    ),
    # ── §5 · the cost ─────────────────────────────────────────────────────────
    (
        "M16 · the note bound is removed, so a store of a thousand one-line notes puts a thousand "
        "rows on a drawer whose whole design is \"the paths are the disclosure\" "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                "    ...notes.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({\n",
                "    ...notes.names.map((name) => ({\n",
            )
        ],
    ),
    (
        "M17 · the byte budget is removed, so a profile with a large memory store ships megabytes "
        "over IPC and holds them for the life of the session "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (INSTRUCTIONS, "    if (read.bytes > budget) continue\n", "")],
    ),
    (
        "M18 · what was left out stops being COUNTED, so a store bigger than the bound looks "
        "exactly like one that fits — 187 §2's silence, in the field that replaced its rows "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                "  if (read.notesFound > read.notesListed) {\n"
                "    parts.push(`${read.notesListed} of ${read.notesFound} notes are listed here, newest first.`)\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M19 · 🔴 187 §2's own defect, re-introduced into the new reader · each file is read at "
        "what is LEFT of the budget instead of at the per-file cap, so \"there is no room left\" and "
        "\"there is no file there\" become the same answer again "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                # ⚑ Corrected in place at `733` (rule 27): the reader lost its `follow` argument (every read follows).
                # ⚠️ **Measured at `733`, and it SURVIVES** — against `instructions.test.ts` here and at
                # `main` @ `980ec721` with its old anchor alike. Table 317 is `unrun`; this is a gap
                # 733 found, not one it made.
                "    const read = readInstructionFile(candidate.path, INSTRUCTION_FILE_CAP)\n",
                "    const read = readInstructionFile(candidate.path, Math.min(INSTRUCTION_FILE_CAP, budget))\n",
            )
        ],
    ),
    # ── §6 · links, enumeration and the shape ─────────────────────────────────
    (
        "M20 · 🔒 the ad-hoc notes DIRECTORY is followed, so `notes -> ~/Documents` has this app "
        "enumerating and reading a directory no provider ever looked at, and the store's whole "
        "shape comes from the link "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        # ⚠️ `lstat` → `stat` rather than deleting the refusal: deleting it falls through to the
        # regular-file test, which refuses a symlink for a DIFFERENT reason and would have made this
        # row red about something it is not about. This one really follows the link.
        # ⚠️ **Anchor corrected in place at 322** (142): the enumeration moved into the shared
        # `memoryDirNames`, so the parameter is `dir`. ⛔ The DEFECT is unchanged — following the
        # link here is exactly what this row is about, and it is still Codex's notes directory that
        # ends up enumerated through one.
        [
            (
                INSTRUCTIONS,
                "    seen = lstatSync(dir)\n",
                "    seen = statSync(dir)\n",
            )
        ],
    ),
    # Every reader follows links; there is no follow argument for this row to remove. The current
    # deciding line has its own mutation, so keep this absent anchor recorded as retired rather than
    # duplicate that row.
    (
        "M21 · the guarded reader stops FOLLOWING, so 170 §2 is reversed for both providers at "
        "once: a redirected memory is in the model's prompt and absent from the panel "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                "    const read = readInstructionFile(candidate.path, INSTRUCTION_FILE_CAP, true)\n",
                "    const read = readInstructionFile(candidate.path, INSTRUCTION_FILE_CAP)\n",
            )
        ],
    ),
    (
        "M22 · the refusal de-duplication goes, so one broken `memories/` link is reported once per "
        "file the reader looked for underneath it — the same finding, three times "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        [
            (
                INSTRUCTIONS,
                "    if (reported.has(row.path)) return\n    reported.add(row.path)\n",
                "",
            )
        ],
    ),
    (
        "M23 · the notes sort OLDEST first, so the twenty rows shown are the twenty a person has "
        "forgotten and the note they just asked for is the one dropped "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        # ⚠️ **Anchor corrected in place at 322** (142): `322` extracted the guards into
        # `memoryDirNames` and left the ORDER with each caller, so 317's `.reverse()` now lives in
        # `adHocNotes` itself. ⛔ Same edit, same defect, one function up.
        [
            (
                INSTRUCTIONS,
                "  return { names: [...listed.names].reverse(), refused: listed.refused }",
                "  return { names: listed.names, refused: listed.refused }",
            )
        ],
    ),
    # ── §7 · found reviewing this diff ────────────────────────────────────────
    (
        "M24 · ⚑ FOUND REVIEWING THIS DIFF · a notes directory whose link leads NOWHERE is reported "
        "as `symlink`, so \"not read: symlink\" sends somebody looking for a decision the app never "
        "made — 314 §3's rule, missed on the one path 317 added "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        # ⚠️ **Anchor corrected in place at 322** (142): the parameter is `dir` since the guards
        # became shared. ⛔ The row still deletes the branch, and a dangling notes directory is
        # still reported as a decision the app never made.
        [
            (
                INSTRUCTIONS,
                "    const broken = brokenMemoryLink(dir)\n"
                "    if (broken !== null) return { names: [], refused: broken }\n",
                "",
            )
        ],
    ),
    (
        "M25 · ⚑ FOUND REVIEWING THIS DIFF · the sentence names `memory_summary.md` as the file in "
        "front of the model whether or not this profile has one, sending a reader whose agent has "
        "only written notes to look for a file that does not exist — 317's own defect class, inside "
        "317's own addition "
        "· EXPECTED (NOT MEASURED): desktop red (instructions), dom GREEN",
        # ⚠️ **Anchor corrected in place at 322** (142): Claude's reader now computes the same
        # field, so the line alone matched twice. Spelled with the `pipeline` line beneath it, which
        # only this store has — ⛔ the row is about CODEX's sentence and must stay pointed at it.
        [
            (
                INSTRUCTIONS,
                "    injects: read.memory.some((item) => item.reach === 'prompt'),\n"
                "    pipeline: CODEX_MEMORY_PIPELINE_FILES.filter((name) => existsSync(join(dir, name))),\n",
                "    injects: true,\n"
                "    pipeline: CODEX_MEMORY_PIPELINE_FILES.filter((name) => existsSync(join(dir, name))),\n",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found, and 268 §2 found one that had reached a committed table.
        if find == replace:
            print(f"!! {name}: the replacement is identical to the anchor — this row is a no-op")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        edits = sum(len(edits) for _name, edits in MUTATIONS)
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(
            f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} rows apply exactly once ({edits} edit anchors)"
        )
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
