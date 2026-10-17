"""318 · A memory you can watch happen — each row is THE DEFECT, put back verbatim (131).

⛔ **What 318 built, in one sentence.** A Codex agent writes a memory and the conversation showed
nothing — friction log F4, and F5 when the person said it again about recall. `316` measured why: the
memory tools are declared inside the code-mode `exec` surface and the app-server publishes no
`item/*` for a nested call, in any of fifteen config arms. So there is no event to render. ⚑ What
there IS is a **directory**: the store is on disk, the panel already reads it, and a turn is already
delimited in the ledger — so *"this name is in the store now and was not when this turn began"* is an
observation this app can make and stand behind, at a cost of one `readdir` at each end of a turn.

⚑ **And the brief's other half was wrong, which is why there is no row for it here.** 318 §2.2 asked
for a sentence saying *"reading is not observable"*. It is observable: measured on the wire against a
real `0.146.0` child, the app-server parses the model's own `<oai-mem-citation>` block into a
structured `memoryCitation` on the `agentMessage` item, strips it out of `text`, and publishes it —
and `codex/normalize.ts` reads only `text`. **The trace is discarded one function from the UI.** See
`packages/runtime/smoke/codex-memory-citation.smoke.ts`, which asserts all three facts with a control
arm. ⛔ **This table mutates none of that**, because 318 built none of it: the sentence that shipped
is about the PANEL (*"this is what the store holds, not what the agent has read from it"*), which is
true whichever way the citation lands, and `M11` is the row that holds it to being about the panel.

| rows | what they are |
|---|---|
| `M1`-`M4` | ⚑ **the observation** — the row that does not appear, the snapshot that is not taken, the diff that reports the wrong thing |
| `M15`-`M21` | ⚑ **the guards the adversarial pass over this dispatch's own diff produced** — see below |
| `M3`, `M4` | ⚠️ **nothing** — recorded as expected SURVIVORS with their measured reason, rather than left to read as gaps |
| `M5`-`M7` | ⛔ **the honesty** — a disk observation dressed as a tool call, a credential carried into the ledger, a cap that goes silent |
| `M8`-`M10` | ⚠️ **the reach** — hidden in the mode people read in, unbounded on replay, attributed to no turn |
| `M11`-`M13` | ⚑ **the two sentences and the gesture** — the panel's disclaimer, the tab hint, and the link that has to SET rather than toggle |

## ⛔ What this table cannot reach, said out loud

⚠️ **`M3` and `M4` are EQUIVALENT MUTANTS on a readable store, and they are recorded rather than
removed.** THREE writers advance the note snapshot — the registration seed (`M4`), the reseed at the
start of every turn (`M2`), and the quiet resync at every ending (`M3`) — and on a store that can be
listed they cannot disagree, because each overwrites the last before any diff reads it. ⛔ That was
not obvious and it was not argued: both rows were written expecting kills, both survived, and the
reason came out of chasing the survival. ⚑ **The redundancy is not dead code.** `noteNamesIn` answers
`null` for a store it could not list, and the reseed then FALLS BACK to whatever the earlier writers
left — so on the one path where the three can differ (`M18`), the belt-and-braces is the belt.

⚑ **Seven of the rows below — `M15` to `M21` — exist because an adversarial pass over this
dispatch's own uncommitted diff found seven real defects in it**, every one CONFIRMED against the
code: the row written below `deliver`'s dead-sink gate (lost, permanently, whenever a window closed
mid-turn), the boundary keyed on `idle` alone (lost on every turn that ended in an error), a claim
about "this turn" on an ending no turn opened, a refused listing read as an empty store, a size taken
through a link the row promises not to follow, one sentence blaming a symlink for six different
reasons, and a replay cap that went silent. They are rows now because they are guards now.

⚠️ **No row proves the row is HONEST**, and nothing in this repository can. `M5` catches the wording
being replaced with a claim about a tool call, because that exact string is asserted — but a third
wording that is subtly worse than both would pass every check here. The distinction between *"a file
appeared"* and *"the agent called a tool"* is checked by a person, and `M5` marks the boundary rather
than pretending to cover past it.

⚠️ **No row mutates `packages/runtime/**`.** 318 changed no adapter and no normaliser; the citation
finding is REPORTED, not built. A row that moved `normalize.ts` would be measuring the dispatch that
acts on that finding, not this one.

⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258, 262, 292, 300, 301, 306, 308 and 317, this table does
NOT mutate the harness it is run by, and it touches no other dispatch's table.
"""

NOTES = "apps/desktop/src/main/runtime/memory-notes.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"
ENTRY = "apps/desktop/src/renderer/src/components/MemoryNoteEntry.vue"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
STORE = "apps/desktop/src/main/db/session-store.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
DRAWER = "apps/desktop/src/renderer/src/lib/drawer.ts"
VIEW = "apps/desktop/src/renderer/src/components/TranscriptView.vue"

MUTATIONS = [
    # ── the observation ───────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the turn boundary stops looking, so a note is written and "
        "the conversation says nothing — friction log F4 exactly, and the state `main` was in "
        "before this dispatch",
        # ⚠️ **Corrected IN PLACE by `320` (142), label untouched.** `320` split the observation from
        # the delivery — the call is now a `const note = … ? this.recordMemoryNotes(session) : null`
        # above the sink gate plus a `this.emit(session, note)` below it — so the one-line anchor this
        # row was written against no longer exists. The DEFECT is unchanged and is still `main`'s
        # prior state: the turn boundary stops looking, and nothing is observed, recorded or sent.
        # ⛔ **Both halves name `this.emit`, not `session.sink.send`**, which is the correction the
        # adversarial pass over `320`'s diff made to this correction: an earlier draft re-anchored on
        # a `sink.send` that `320` never shipped, so both rows matched zero times and
        # `mutations:check` went red — a row re-anchored to a draft protects nothing.
        [
            (
                HOST,
                "    const note =\n"
                "      event.type === 'status' && TURN_ENDINGS.has(event.state)\n"
                "        ? this.recordMemoryNotes(session)\n"
                "        : null\n",
                "",
            ),
            (HOST, "    if (note !== null) this.emit(session, note)\n", ""),
        ],
    ),
    (
        "M2 · 🔴 the opening snapshot is never retaken at the start of a turn, so the window the row "
        "names runs from the previous ENDING rather than from this turn's beginning. ⚠️ A note "
        "another session in the same profile wrote between two turns is then announced in a "
        "conversation that had nothing to do with it — `085`'s shared-memory boundary, claimed",
        [
            (
                HOST,
                "      session.memoryNotes = noteNamesIn(session.memoryNoteDir) ?? session.memoryNotes",
                "      session.memoryNotes = session.memoryNotes",
            )
        ],
    ),
    (
        "M3 · ⚠️ the quiet resync goes, so the snapshot advances only on the boundaries that "
        "published a row. ⛔ EXPECTED SURVIVED, and MEASURED rather than argued: the `user_turn` "
        "reseed writes the same value before any later diff can read it, so on a readable store the "
        "two writers cannot disagree. ⚑ It is not dead code — it is the value the reseed FALLS BACK "
        "TO when the store cannot be listed, which is the one path `M18` is about",
        [
            (
                HOST,
                "    session.memoryNotes = names",
                "    if (event !== null) session.memoryNotes = names",
            )
        ],
    ),
    (
        "M4 · ⚠️ the store is seeded EMPTY at registration. ⛔ EXPECTED SURVIVED, and the reason was "
        "found by MEASURING this row rather than by reading it: a fresh session publishes `idle` "
        "before it is ever sent anything, and the quiet resync (`M3`) repairs the snapshot at that "
        "ending — so the empty seed is never the value any diff is taken against. ⚑ Three writers, "
        "and only the `user_turn` reseed is load-bearing on a readable store",
        [
            (
                HOST,
                "      memoryNotes: noteNamesIn(noteDir) ?? new Set<string>(),",
                "      memoryNotes: new Set<string>(),",
            )
        ],
    ),
    # ── the honesty ───────────────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ the row claims a tool call. ⚑ **This is the claim 318 exists to NOT make**: nothing "
        "on any wire reported this, we read a directory — and a conversation that says the "
        "provider announced a call it never announced is `009`'s rule broken and `305`'s defect "
        "repeated, in the surface that was built to repair them",
        [
            (
                ENTRY,
                "      Seen on disk between the start and the end of this turn — not reported as a tool call.",
                "      The agent called its memory tool and wrote this note.",
            )
        ],
    ),
    # The note reader follows links, so adding its former follow argument would be a no-op. This row
    # instead mutates the per-note size cap, a distinct live rule; link following is tested
    # separately.
    (
        "M6 · ⚠️ the note row is read at the INSTRUCTION cap (64 KiB), not the note's own (4 KiB) — "
        "a long note is carried whole into a durable ledger row, and the row's `truncated` never "
        "fires",
        [
            (
                NOTES,
                "  const read = readInstructionFile(path, MEMORY_NOTE_TEXT_CAP)",
                "  const read = readInstructionFile(path)",
            )
        ],
    ),
    (
        "M7 · ⚠️ the per-event cap goes silent — twenty notes are shown and ten are dropped with "
        "nothing said, so a short list reads as a whole one. ⛔ `092` §4's rule, in the row whose "
        "whole subject is what the agent decided to keep",
        [
            (
                NOTES,
                "    event: { type: 'memory_note', notes, ...(dropped > 0 ? { dropped } : {}) },",
                "    event: { type: 'memory_note', notes },",
            )
        ],
    ),
    # ── what it watches, and where it reaches ─────────────────────────────────────────────────
    (
        "M8 · ⛔ the OTHER provider is watched too, so a memory write that already produced a "
        "`tool_call` naming the file path and a `file_change` row beside it becomes eligible for a "
        "second, weaker claim about the same act. ⚑ `035`'s duplicate, and 318 §2.1's "
        "misattribution arriving from the opposite side — the gate is measured in "
        "`claude/normalize.ts`, not assumed",
        [
            (
                NOTES,
                "  claude: null,\n  codex: { dir: codexAdHocNotesDir },",
                "  claude: { dir: codexAdHocNotesDir },\n  codex: { dir: codexAdHocNotesDir },",
            )
        ],
    ),
    (
        "M9 · 🔴 the row is hidden in the mode people read in. ⛔ `transcript-mode.ts` drops `info` "
        "notices in `normal`, which is exactly why this is its own item kind — and a `false` here "
        "restores the original complaint with the feature built: the note is on disk, the row "
        "exists, and the reader who filed F4 still sees nothing",
        [
            (
                MODE,
                "    case 'memoryNote':\n      return true",
                "    case 'memoryNote':\n      return mode === 'debug'",
            )
        ],
    ),
    (
        "M10 · ⛔ the stored-event bound is dropped, so a ledger row written by a later build — or "
        "edited — hands the renderer an unbounded array of unbounded strings on replay. ⚠️ `216` "
        "§2's rule at the one event on this union that carries file CONTENT",
        [
            (
                STORE,
                "    const notes = boundMemoryNotes(event.notes)",
                "    const notes = (event.notes ?? []) as MemoryNoteSeen[]",
            )
        ],
    ),
    # ── the two sentences and the gesture ─────────────────────────────────────────────────────
    (
        "M11 · ⛔ the panel's disclaimer becomes a claim about the PROVIDER rather than about the "
        "panel — *'a read leaves no trace anywhere'*. ⚑ **Measured false**: the app-server parses "
        "the model's citation block into `memoryCitation`, strips it from `text` and publishes it, "
        "and we drop it in `normalize.ts`. A panel blaming the provider for a line we have not "
        "written is `308`'s defect exactly, on the surface `308` cleaned",
        [
            (
                PANEL,
                "        Nothing here says which of these the agent has actually looked up.",
                "        Reading a memory leaves no trace anywhere — the provider reports nothing.",
            )
        ],
    ),
    (
        "M12 · ⚠️ the link SETS one half and toggles the other, so pressing *'See the whole store'* "
        "on a conversation whose drawer is already open SHUTS it. ⛔ The plumbing gap this dispatch "
        "found: `toggleDrawer` is a flip and `update:drawerTab` only lands while the drawer is "
        "open, so there was no way to say *'show me that'* at all",
        [
            (
                SCREEN,
                "                drawerOpen = true\n                drawerTab = 'info'",
                "                drawerOpen = !drawerOpen\n                drawerTab = 'info'",
            )
        ],
    ),
    (
        "M13 · ⚠️ the tab hint goes back to naming everything on the Info tab except the one thing "
        "people go looking for. ⛔ `317` put the whole memory store there and this sentence went on "
        "describing the tab it used to be — which is the tooltip half of why the answer was three "
        "clicks away and nobody found it",
        [
            (
                DRAWER,
                "    hint: 'Paths, the profile and its own folder, config, what this profile remembers, and the session ref',",
                "    hint: 'Paths, the profile and its own folder, config and the session ref',",
            )
        ],
    ),
    (
        "M14 · ⛔ the transcript stops drawing the row at all — the component survives, correct and "
        "unmounted, while the fold keeps producing items nothing renders. ⚠️ The failure mode a "
        "`v-if` ladder has and a compiler does not catch: `TranscriptView`'s chain has no "
        "exhaustiveness check, so a kind with no arm falls to `UnknownEntry` in silence",
        [
            (
                VIEW,
                '        <MemoryNoteEntry\n          v-else-if="row.item.kind === \'memoryNote\'"',
                '      <MemoryNoteEntry\n        v-else-if="false"',
            )
        ],
    ),
    # ── the seven guards the adversarial pass over this dispatch's own diff produced ──────────
    (
        "M15 · 🔴 the observation moves back BELOW `deliver`'s `if (!session.sink.alive) return`, "
        "so the durable row is written only while a window happens to be attached. ⛔ Closing the "
        "window on a turn that had just written a memory loses the row, and loses it PERMANENTLY — "
        "the next turn retakes the snapshot it would have been measured against. ⚑ Against "
        "`deliver`'s own stated rule that a row is written whether or not anyone is listening",
        # ⚠️ **Corrected IN PLACE by `320` (142), label untouched.** Same defect, expressed against the
        # split `320` introduced: what moves below the gate is now the OBSERVATION AND THE RECORDING
        # (`recordMemoryNotes`), which is precisely what this row has always been about. ⛔ The
        # delivery stays ordered in the mutated tree — and goes through `this.emit`, deliberately, so
        # the mutant differs from the shipped code in DURABILITY ALONE and cannot be killed by
        # `320`'s ordering tests instead of by `318`'s.
        [
            (
                HOST,
                # ⚑ **Anchor corrected in place by `394`** — that dispatch put its own
                # above-the-gate recording (`routeRequest`) between this block and the sink gate, so
                # the span this row read no longer ends where it did. ⛔ **The DEFECT is unchanged**:
                # the observation and the recording move BELOW `if (!session.sink.alive) return`.
                "    const note =\n"
                "      event.type === 'status' && TURN_ENDINGS.has(event.state)\n"
                "        ? this.recordMemoryNotes(session)\n"
                "        : null\n",
                "",
            ),
            (
                HOST,
                "    if (note !== null) this.emit(session, note)",
                "    if (event.type === 'status' && TURN_ENDINGS.has(event.state)) {\n"
                "      const note = this.recordMemoryNotes(session)\n"
                "      if (note !== null) this.emit(session, note)\n"
                "    }",
            ),
        ],
    ),
    (
        "M16 · ⛔ the boundary narrows to `idle` alone, so a turn that ends `errored` — a child that "
        "dies mid-turn never publishes an idle at all — loses its note for good. ⚠️ `session-store` "
        "already closes the turn ROW on `ended`/`errored`; an observation keyed on the happy path is "
        "one that is missing exactly when something went wrong",
        [
            (
                HOST,
                "const TURN_ENDINGS: ReadonlySet<SessionStatus> = new Set<SessionStatus>([\n  'idle',\n  'ended',\n  'errored',\n])",
                "const TURN_ENDINGS: ReadonlySet<SessionStatus> = new Set<SessionStatus>(['idle'])",
            )
        ],
    ),
    (
        "M17 · ⛔ the row is published for an ending no turn of ours opened, so its sentence — "
        "*'between the start and the end of this turn'* — measures from the session's registration "
        "instead. ⚑ An unbounded window of another session's writes, narrated as this turn's",
        [
            # ⚠️ **Corrected IN PLACE by `320` (142), label untouched** — `recordMemoryNotes` returns a
            # message now, so the bare `return` this row deleted is a `return null`. Same two lines,
            # same defect: the gate that refuses to narrate a window no turn of ours opened.
            (HOST, "    if (!session.turnOpened) return null\n    session.turnOpened = false\n", "")],
    ),
    (
        "M18 · 🔴 a store that could not be LISTED reads as an empty one, so the next successful "
        "listing reports the profile's entire memory as having appeared during one turn. ⛔ One "
        "transient `EMFILE` at a boundary publishes a year of notes into whatever conversation is "
        "open — `074`'s third state (we did not look) collapsed into the second (there is nothing)",
        [
            (NOTES, "  if (listed.refused !== null) return null\n", ""),
        ],
    ),
    # The note row reports its followed target’s size and text. The lstat-only import anchor is
    # gone, so retain the row as retired. The surviving isFile guard still decides whether a size is
    # printed and has separate coverage.
    (
        "M19 · ⛔ the size FOLLOWS the link the reader refuses to follow, so a note that is a symlink "
        "prints the byte count of the file at the far end — one line above a sentence promising this "
        "row does not look there. ⚠️ A true number about the wrong file is worse than no number",
        [
            (
                NOTES,
                "    return seen.isFile() ? { bytes: seen.size } : {}",
                "    return { bytes: statSync(path).size }",
            ),
            (NOTES, "import { lstatSync } from 'node:fs'", "import { lstatSync, statSync } from 'node:fs'"),
        ],
    ),
    (
        "M20 · ⚠️ every unreadable note is explained as a symlink again, which is true of one of the "
        "six reasons the reader can give and false for the other five — sending a person looking for "
        "a link that is not there. ⛔ `086` in the direction that costs a search",
        [
            (
                ENTRY,
                "        Its text is not shown here — {{ unreadWords(note.unread ?? 'unreadable') }}.",
                "        Its text is not shown here — this row does not follow links into the store.",
            )
        ],
    ),
    (
        "M21 · ⚠️ the REPLAY cap goes silent: a stored row cut to the per-event bound comes back "
        "showing fewer notes with no count of what went. ⛔ The same `092` §4 defect `M7` forbids on "
        "the way in, on the way out — where nothing else can see it",
        [
            (
                STORE,
                "    const cut = Math.max(0, boundedLength(event.notes) - notes.length)",
                "    const cut = 0",
            )
        ],
    ),
]
