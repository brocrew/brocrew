"""322 · The half of Claude's memory nobody lists — each row is THE DEFECT, put back verbatim (131).

⛔ **What 322 built, in one sentence.** The instructions panel listed `MEMORY.md` for a Claude
profile and nothing else; Claude keeps one memory per file beside that index exactly as Codex keeps
ad-hoc notes, so a real profile on the person's machine had **two of three files and 1,954 of 2,159 bytes
in the store and off the screen**. This dispatch reads the directory, lists what is in it, and says
which single file the provider actually puts in the prompt.

⚑ **Why it is a defect and not a missing feature, which is what several rows below protect.** `318`
shipped *"Nothing here says which of these the agent has actually looked up"* under those rows. Its
*"these"* reads as the store. **A list that is one file in three had already made it false**, before
`319`'s recall row was even considered — so the rows about the label, the reach word and the sentence
are not cosmetic: they are what keeps the panel's own claim true.

| rows | what they are |
|---|---|
| `M1`-`M4` | ⛔ **the defect, and the three ways to half-list it** — the index alone, the index counted twice, the whole store with no reach word, and one row's worth of the store |
| `M5`-`M8` | ⚑ **the enumeration guards** (`169` §1's shared block) — a dangling link called a refusal, and each half of the two link policies |
| `M9`-`M12` | ⚠️ **order, cap and budget** (`187` §2, `317` §3) — the order that is not this store's, the cap gone, the count gone silent, and the index no longer granted first |
| `M13`-`M15` | ⛔ **the sentence** — the empty state `§4` protects, the blank index, and the index's job |
| `M16`-`M18` | ⚠️ **the panel** — the label, the reuse `086` rules against, and the word that says what is in the prompt |
| `M19`-`M20` | ⚑ **the vocabulary** — the index admitted as one of its own entries, and the format filter |
| `M21`-`M22` | ⛔ **found writing this diff** — the duplicated broken-link row, and a redirect refused as `not-a-regular-file` |
| `M23` | 🔒 **the Codex control** (`§4`) — `317`'s ruling still asserted after its enumeration moved |

## ⛔ What this table cannot reach, said out loud

⚠️ **No row can prove which files the PROVIDER actually puts in the prompt.** Every assertion below
runs against a directory this repository created, and the `reach` word on each row is a claim about
a different process. ⛔ A row that made every file `'prompt'` would go green in `ci` and would be
telling the user the model has read things it has never opened — `009`'s rule and `305`'s defect, in
the one place `ci` structurally cannot see. **The oracle has to be the child**:
`packages/runtime/smoke/claude-memory-topics.smoke.ts` runs three arms against a real `2.1.218`
child in one session and asserts the boundary from both sides — a token that exists only in
`MEMORY.md` answered with no tool at all, the same store's topic token never known while nothing was
opened, and that token fetched with an ordinary `Read` once the child was told it could look.
⚠️ **That probe is not part of `pnpm run ci`**, so the limit is real and is stated rather than
covered over — the same shape `317` and `319` recorded for their own halves of this store.

⚠️ **And one boundary in it can MOVE without anything here changing.** The pinned binary can attach
up to five memory files to a turn on its own (`vIy` → `{type:"relevant_memories"}`), gated behind
`z1e()` — a server-side feature flag defaulting off, or `CLAUDE_MEMORY_STORES`, which
`buildChildEnv`'s allow-list does not carry. The day that flag turns on for this account a topic
file could reach the model unasked and `'on-request'` would be understating it. ⛔ **No mutation can
catch that**; the probe re-measures it, and `isClaudeMemoryTopic`'s note names it.

⚠️ **No row mutates another dispatch's table, and none mutates the harness.** Like 240, 243, 247,
248, 250, 251, 254, 258, 262, 292, 300, 301, 306, 308, 317, 318 and 319.
"""

INSTR = "apps/desktop/src/main/runtime/instructions.ts"
VOCAB = "packages/runtime/src/claude/auto-memory.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"

MUTATIONS = [
    # ── the defect, and the three ways to half-list it ─────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the reader goes back to one candidate, so a Claude profile "
        "reports its index and nothing else — the state `main` was in before this dispatch, and the "
        "reason friction log F8 says the panel under-reports the provider the person is NOT testing",
        [
            (
                INSTR,
                "    ...topics.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({\n"
                "      path: join(dir, name),\n"
                "      derived: join(realDir, name),\n"
                "      kind: 'agent-memory-topic' as const,\n",
                "    ...[].slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name: string) => ({\n"
                "      path: join(dir, name),\n"
                "      derived: join(realDir, name),\n"
                "      kind: 'agent-memory-topic' as const,\n",
            )
        ],
    ),
    (
        "M2 · 🔴 the index is admitted as one of its own entries, so a store holding one memory "
        "reports two and `MEMORY.md` is drawn twice — once as the file the provider injects and "
        "once as a memory it does not",
        [
            (
                INSTR,
                "  return { names: listed.names.filter(isClaudeMemoryTopic), refused: listed.refused }",
                "  return { names: listed.names, refused: listed.refused }",
            )
        ],
    ),
    (
        "M3 · ⚠️ every row in the store claims the provider put it in the prompt. ⛔ `317` §2.2 and "
        "`009`: a panel that renders a file the agent has never opened as something the model knows "
        "is worse than one that shows nothing — and the probe measured this child answering *'the "
        "actual codename value isn't shown in the memory index provided to me'*",
        [
            (
                INSTR,
                "      kind: 'agent-memory-topic' as const,\n"
                "      // ⚠️ Availability, never comprehension — the same word Codex's notes get, for the same\n"
                "      // reason: the file is in the store and the agent can open it. Saying the model \"has\" it\n"
                "      // would be 305's defect with a friendlier face.\n"
                "      reach: 'on-request' as const,",
                "      kind: 'agent-memory-topic' as const,\n"
                "      reach: 'prompt' as const,",
            )
        ],
    ),
    (
        "M4 · ⚠️ the store is listed one file deep — `slice(0, 1)` — so a profile with an index and "
        "twenty memories shows the index and one memory. ⛔ It is `M1` wearing a number instead of "
        "an absence, and the note sentence's count is what would have to catch it",
        [
            (
                INSTR,
                "    ...topics.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({",
                "    ...topics.names.slice(0, 1).map((name) => ({",
            )
        ],
    ),
    # ── the enumeration guards ────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ a memory directory whose link leads NOWHERE is reported as `symlink`, so *'not "
        "read: symlink'* sends somebody looking for a decision the app never made — `314` §3's "
        "rule, on the shared block `322` extracted it into",
        [
            (
                INSTR,
                "    const broken = brokenMemoryLink(dir)\n"
                "    if (broken !== null) return { names: [], refused: broken }\n",
                "",
            )
        ],
    ),
    (
        "M6 · 🔴 a WORKING `memory/` link is refused rather than enumerated, so a profile pointed at "
        "another disk on purpose gets `314` §3's row back — the one that told somebody their memory "
        "was gone — on a store this app has already read the index out of",
        [
            (
                INSTR,
                "    if (!followLink) return { names: [], refused: { path: dir, reason: 'symlink' } }",
                "    return { names: [], refused: { path: dir, reason: 'symlink' } }",
            )
        ],
    ),
    (
        "M7 · ⛔ the OTHER half of the same policy: Codex's ad-hoc `notes/` link is followed too, so "
        "`notes -> ~/Documents` has this app listing and reading a directory nobody's provider ever "
        "walked and the whole store's shape comes from the link — `317`'s ruling, which `§4` says "
        "may not be re-decided here",
        [
            (
                INSTR,
                "  const listed = memoryDirNames(notesDir, false)",
                "  const listed = memoryDirNames(notesDir, true)",
            )
        ],
    ),
    (
        "M8 · ⚠️ a SUBDIRECTORY named `*.md` is listed as a memory, so the provider's own skills "
        "folder — or anything a person put in the store — is read as a file the agent filed and "
        "opened as a document",
        [
            (
                INSTR,
                "      .filter((entry) => !entry.isDirectory() && entry.name.endsWith('.md'))",
                "      .filter((entry) => entry.name.endsWith('.md'))",
            )
        ],
    ),
    # ── order, cap and budget ─────────────────────────────────────────────────────────────────
    (
        "M9 · ⚠️ Claude's memories are listed newest-name-first, which is Codex's order and is not "
        "an order this store has: these names are subjects, not timestamps, and the provider's own "
        "instruction is *'organize memory semantically by topic, not chronologically'*",
        [
            (
                INSTR,
                "  const listed = memoryDirNames(dir, true)\n"
                "  return { names: listed.names.filter(isClaudeMemoryTopic), refused: listed.refused }",
                "  const listed = memoryDirNames(dir, true)\n"
                "  return {\n"
                "    names: [...listed.names].reverse().filter(isClaudeMemoryTopic),\n"
                "    refused: listed.refused,\n"
                "  }",
            )
        ],
    ),
    (
        "M10 · ⛔ the listing cap is gone, so a store of a thousand memories is a thousand rows in a "
        "drawer whose whole design is *'the paths are the disclosure'* — `317` §3's judgement, "
        "which `322` inherited rather than re-made",
        [
            (
                INSTR,
                "    ...topics.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({",
                "    ...topics.names.map((name) => ({",
            )
        ],
    ),
    (
        "M11 · ⚠️ the cap goes SILENT — what did not fit is dropped without a count, which is "
        "`187` §2's own defect in the field whose documented job is to let the list above be read as "
        "complete",
        [
            (
                INSTR,
                "  if (read.topicsFound > read.topicsListed) {\n"
                "    parts.push(`${read.topicsListed} of ${read.topicsFound} memories are listed here, by name.`)\n"
                "  }\n",
                "",
            )
        ],
    ),
    (
        "M12 · 🔴 the memories are granted the byte budget BEFORE the index, so a store of large "
        "topic files evicts the one file the model was actually given and the panel shows twenty "
        "things the agent might read and not the thing it was told",
        [
            (
                INSTR,
                "  const read = readMemoryStore([\n"
                "    {\n"
                "      path: claudeAutoMemoryIndex(providerHome),\n"
                "      derived: claudeAutoMemoryIndex(realPath(providerHome)),\n"
                "      kind: 'agent-memory',",
                "  const read = readMemoryStore([\n"
                "    ...topics.names.slice(0, AGENT_MEMORY_NOTES_SHOWN).map((name) => ({\n"
                "      path: join(dir, name),\n"
                "      derived: join(realDir, name),\n"
                "      kind: 'agent-memory-topic' as const,\n"
                "      reach: 'on-request' as const,\n"
                "    })),\n"
                "    {\n"
                "      path: claudeAutoMemoryIndex(providerHome),\n"
                "      derived: claudeAutoMemoryIndex(realPath(providerHome)),\n"
                "      kind: 'agent-memory',",
            )
        ],
    ),
    # ── the sentence ──────────────────────────────────────────────────────────────────────────
    (
        "M13 · ⛔ the sentence is emitted for a profile with NO memories, so a fresh profile is told "
        "about an index pointing at files it does not have — `086` in the other direction, `§4`'s "
        "*'must render exactly as it does today'*, and `317` M25's own defect class",
        [
            (
                INSTR,
                "  if (read.dir === null || read.topicsFound === 0) return ''",
                "  if (read.dir === null) return ''",
            )
        ],
    ),
    (
        "M14 · ⚠️ a BLANK `MEMORY.md` is described as a file this profile does not have, sending "
        "somebody looking for a file they are standing on. ⛔ The reader skips an empty file, and "
        "the provider's own prompt in that state says *'Your MEMORY.md is currently empty'*",
        [
            (
                INSTR,
                "        `Nothing in ${read.dir} reaches the model on its own yet: ${AUTO_MEMORY_INDEX} is the ` +\n"
                "        'only file the provider puts in front of it, and there is nothing in this profile’s. The ' +\n"
                "        'agent reads what is here only if it chooses to.',",
                "        `Nothing in ${read.dir} is in front of the model yet — ${AUTO_MEMORY_INDEX} is the ` +\n"
                "        'only file the provider puts there and this profile has none, so the agent reads what ' +\n"
                "        'is here only if it chooses to.',",
            )
        ],
    ),
    (
        "M15 · ⚑ the sentence stops saying what `MEMORY.md` IS, so the panel lists an index and a "
        "pile of files beside it with nothing saying how the two are related — `§3.2`'s question, "
        "answered by silence",
        [
            (
                INSTR,
                "      ? `${AUTO_MEMORY_INDEX} in ${read.dir} is an index the provider puts in front of the ` +\n"
                "        'model; the memories it points at are separate files beside it, which the agent reads ' +\n"
                "        'only if it chooses to.'",
                "      ? `${read.dir} holds this profile's memory.`",
            )
        ],
    ),
    # ── the panel ─────────────────────────────────────────────────────────────────────────────
    (
        "M16 · ⛔ a memory the agent filed is labelled as a note somebody ASKED for. ⚠️ That "
        "sentence is Codex's `memories__add_ad_hoc_note` exactly and is false of a file this "
        "provider tells the model to write unprompted — `086`: a reader who cannot tell two "
        "provenances apart edits the wrong file",
        [
            (
                PANEL,
                "  'agent-memory-topic': 'agent memory — one memory the agent filed, in its own file',",
                "  'agent-memory-topic': 'agent memory — a note the agent was asked to write',",
            )
        ],
    ),
    (
        "M17 · ⚠️ the KIND is dropped from the contract and the topic rows reuse `agent-memory`, so "
        "every file in the store is labelled *'loaded by the provider'* — which is true of exactly "
        "one of them, and is the claim `M3` makes in the reader",
        [
            (
                INSTR,
                "      kind: 'agent-memory-topic' as const,",
                "      kind: 'agent-memory' as const,",
            )
        ],
    ),
    (
        "M18 · ⛔ the reach line is drawn only for the file in the prompt, so the memories beside it "
        "carry no word at all and read as things the model was given — the silence `317` §2.2 "
        "added this line to remove",
        [
            (
                PANEL,
                # ⚑ **583 · the anchor's bytes moved and its subject did not** (standing rule 27).
                # ⚠️ **And the claim is narrower than it was, which is said rather than left to be
                # read off the old title** (found reviewing 583's own diff): 583 split the reach
                # word into a CHIP at rest and the full `REACH_WORDS` sentence behind the row's
                # press, and this row narrows the chip only. ⛔ So the defect it now plants is the
                # one a person meets without pressing anything — every memory beside the one in
                # the prompt carries no word AT REST — and `317` M9 is the row that takes both.
                '            <span v-if="block.reach" class="chip" :data-cy="`memory-reach-${block.reach}`">',
                '            <span v-if="block.reach === \'prompt\'" class="chip" :data-cy="`memory-reach-${block.reach}`">',
            )
        ],
    ),
    # ── the vocabulary ────────────────────────────────────────────────────────────────────────
    (
        "M19 · ⚑ `isClaudeMemoryTopic` admits the index, which is `M2` at the other end of the same "
        "rule: this is the provider fact, in the runtime package, and the reader is the caller that "
        "trusts it",
        [
            (
                VOCAB,
                "  if (name === AUTO_MEMORY_INDEX) return false",
                "",
            )
        ],
    ),
    (
        "M20 · ⚠️ anything in the memory directory counts as a memory — `.DS_Store`, a stray "
        "`settings.json`, a log — so the panel reports files nobody wrote as memories and opens "
        "them as documents. ⛔ The provider dictates Markdown with frontmatter",
        [
            (
                VOCAB,
                "  return name.endsWith('.md')\n}",
                "  return true\n}",
            )
        ],
    ),
    # ── found writing this diff ───────────────────────────────────────────────────────────────
    (
        "M21 · ⛔ FOUND WRITING THIS DIFF · a DANGLING `memory/` link is reported twice — once by "
        "the leaf read walking up to the directory and once by the listing that met the same broken "
        "link — so the one panel whose job is to be readable carries the same fact on two rows",
        [
            (
                INSTR,
                "  if (topics.refused !== null && !read.refused.some((row) => row.path === topics.refused?.path)) {",
                "  if (topics.refused !== null) {",
            )
        ],
    ),
    (
        "M22 · ⛔ FOUND WRITING THIS DIFF · the directory check runs on the LINK rather than on what "
        "it points at, so every working redirect is refused as `not-a-regular-file` — `M6`'s row "
        "under a different word, and this one is silent about being a link at all",
        [
            (
                INSTR,
                "  const target = seen.isSymbolicLink() ? safeStat(dir) : seen",
                "  const target = seen",
            )
        ],
    ),
    # ── the Codex control ─────────────────────────────────────────────────────────────────────
    (
        "M23 · 🔒 THE CONTROL (`§4`) · the shared block sorts DESCENDING, so both stores come out "
        "backwards at once — Claude's memories newest-name-first and Codex's notes oldest-first, "
        "because `adHocNotes` reverses what it is handed. ⚠️ It is the one row here that proves "
        "`322` did not quietly re-decide the other provider's half while refactoring under it, and "
        "the only one whose defect lands on both",
        [
            (
                INSTR,
                "      .map((entry) => entry.name)\n      .sort()\n",
                "      .map((entry) => entry.name)\n      .sort()\n      .reverse()\n",
            )
        ],
    ),
]
