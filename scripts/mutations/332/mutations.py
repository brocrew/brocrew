"""332 · The memory that is in the prompt, and on no row — each row is THE DEFECT, put back verbatim (131).

⛔ **What 332 fixed, in one sentence.** Claude's memory index is in the system prompt from the first
token of every session, every answer is silently informed by it, and no row anywhere in the
conversation said so — so the person, four screenshots deep, reported the RECALL as broken: *"the issue is
that the recalling part is not showing any tool calls or anything"*.

## ⚑ Why half of that ticket has no rows here, and must not

⛔ **The recall half is closed and correct.** 318 measured that this CLI preloads the index into its
own system prompt with no memory tool and no citation; 319 ruled that a recall row on this provider
would have to be INVENTED. His test was `what is my name?` and there was no tool call because there
was no lookup. ⚠️ **No row in this table asserts a recall, and none may be added**: the whole design
turns on the launch fact being sayable *without* claiming a reading.

## 🔴 The measurement that changed the shape, and the row that models the alternative

330 put `system/init.memory_paths.auto` on the record, and §1 of this dispatch expected it to key
this row. ⛔ **It cannot: Claude's `system/init` arrives on the MESSAGE stream, on the first turn**
(`claude-runtime.ts` — *"Claude's ref only arrives on the message stream"*), so at session creation
there is no such frame and a row keyed on it would appear UNDER the user's first message instead of
above it. ⚑ The launch row therefore rests on the launch-time disk read the panel already rests on —
one derivation, asserted by `M4`'s killer, so the conversation and the drawer cannot come apart.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M3`, `M8` | ⚑ **`run_suite`** — `apps/desktop/test/memory-loaded-host.test.ts` |
| `M2`, `M4`-`M7` | ⚑ **`run_suite`** — `apps/desktop/test/instructions.test.ts` |
| `M9`-`M12` | ⚑ **`run_suite`** — `apps/desktop/test/citation-bound.test.ts` |
| `M13`-`M14` | ⚑ **`run_suite`** — the DOM file below |
| `M15` | ⚑ **`run_suite`** — the DOM file below (`isVisibleIn`, both modes) |
| `M16`-`M25` | ⚑ **`run_suite`** — `apps/desktop/test/dom/the-memory-that-is-in-the-prompt.dom.test.ts` |
| `M26` | ⚑ **`run_suite`** — `apps/desktop/test/transcript.test.ts` (the app-authored sweep) |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row moves the publish out of `onRegistered` to after the pump starts.** The defect is real —
the row would stop being ordinal 0 — but with a `FakeRuntime` nothing provably arrives in that gap,
so the row would change behaviour no test can observe and record as a SURVIVOR that is really a
no-op (`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ `M8` covers the observable half:
recorded but never sent, which is 318's *"reached the ledger and not the sink"* inverted.

⛔ **No row deletes `case 'memoryLoaded'` from `isVisibleIn`.** The `default` arm of that switch
returns `true`, so deleting the case changes nothing at runtime — it is a COMPILE error instead,
held by `const exhaustive: never`. `M15` is the behavioural row.

⛔ **No row adds `memory_loaded` to `CONTENT_EVENTS`.** It is published at ordinal 0, before any turn
of the session exists, so `turnFor` finds no turn either way: the mutation is a semantic no-op and
would report as a phantom survivor. The ruling is written down in `session-store.ts` instead.

⛔ **No row touches `recallsReported`.** 319 owns that flag and 332 does not reopen it.

## ⚠️ 604 · three anchors were CORRECTED, not retired

⛔ **`M2`, `M5` and `M12` all anchor on lines that gained `MemoryLoadedEvent.lookedAt`.** ⚑ The
defect each one models is unchanged, so the anchor was made true rather than the row retired
(`correct-a-stale-mutation-anchor-dont-retire-it`). ⚠️ **A corrected anchor keeps a verdict it never
earned**, so all three were re-run against their named killer file after the correction and are
recorded in 604's response.

## ⚑ What the per-row killer check changed, before this table was ever run

⚠️ **Two rows survived their killer on the first pass and BOTH were the check working.** `M10` was a
semantic no-op — dropping the `typeof` guard leaves `(42).length <= 4096` false, so the answer never
moved, and it would have recorded as a survivor that meant nothing. `M22` deletes the line naming the
store directory, and the DOM assertion passed anyway **because the full path one element down
contains that directory too**: the test said *"the row names the store"* and could not tell the
readable line from the record. ⛔ The component grew `data-cy="memory-loaded-name"` so the assertion
is about the element it is about. A `--dry-run` proves an anchor applies once and can see neither.
"""

INSTR = "apps/desktop/src/main/runtime/instructions.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"
ENTRY = "apps/desktop/src/renderer/src/components/MemoryLoadedEntry.vue"
VIEW = "apps/desktop/src/renderer/src/components/TranscriptView.vue"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"

MUTATIONS = [
    # ── the defect itself ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the launch says nothing again — the conversation opens with "
        "the profile's memory in the prompt and no row anywhere says so",
        [
            (
                HOST,
                "        if (instructions?.memoryLoaded) this.publishOurs(registered, instructions.memoryLoaded)",
                "",
            )
        ],
    ),
    (
        "M2 · ⛔ the reader never finds a launch fact · the same silence one layer down, where a "
        "host test alone would not see it",
        [
            (
                INSTR,
                "  return {\n"
                "    type: 'memory_loaded',\n"
                "    index: index.path,\n"
                "    beside: read.topicsFound,\n"
                "    lookedAt: read.lookedAt,\n"
                "  }",
                "  return null",
            )
        ],
    ),
    (
        "M3 · ⛔ a RESUME says it again · a launch stated twice reads as a recurrence, which is the "
        "per-answer reading §1 forbids — and the second row is about a life the reader is not in",
        [
            (
                HOST,
                "    this.record(session, () => this.deps.store.reopened(sessionId, this.now()))",
                "    if (instructions?.memoryLoaded) this.publishOurs(session, instructions.memoryLoaded)\n"
                "    this.record(session, () => this.deps.store.reopened(sessionId, this.now()))",
            )
        ],
    ),
    # ── the gate: what earns a row at all ─────────────────────────────────────────────────────
    (
        "M4 · ⛔ the gate stops being 'is it in the PROMPT' · the first file in the store wins, so a "
        "profile with topic files and no index claims an index nobody was given (317 M25's lesson)",
        [
            (
                INSTR,
                "  const index = read.memory.find((item) => item.reach === 'prompt')",
                "  const index = read.memory[0]",
            )
        ],
    ),
    (
        "M5 · ⛔ the count becomes the PANEL's list · a store of forty is reported as twenty with "
        "nothing on screen to say so — 092 §4's silent cap, in the row that exists to say memory is "
        "in play",
        [(INSTR, "beside: read.topicsFound,", "beside: read.topicsListed,")],
    ),
    (
        "M6 · ⛔ Codex gets the row too · 310's defect rebuilt — one sentence stretched over two "
        "providers whose injected file is a different KIND of thing, and 332 §2.5 ruled it out",
        [
            (
                INSTR,
                "      memoryLoaded: null,",
                "      memoryLoaded: {\n"
                "        type: 'memory_loaded',\n"
                "        index: join(inputs.providerHome, 'memories', 'memory_summary.md'),\n"
                "        beside: 0,\n"
                "      },",
            )
        ],
    ),
    (
        "M7 · ⛔ an EMPTY index still claims the prompt · the reader drops a blank file, so this "
        "would say a file is in front of the model while the provider's own prompt says it is empty",
        [
            (
                INSTR,
                "  const index = read.memory.find((item) => item.reach === 'prompt')\n"
                "  if (index === undefined) return null",
                "  const index = read.memory.find((item) => item.reach === 'prompt')\n"
                "  if (index === undefined) {\n"
                "    return { type: 'memory_loaded', index: read.dir ?? '', beside: read.topicsFound }\n"
                "  }",
            )
        ],
    ),
    (
        "M8 · ⛔ recorded but never SENT · 318's finding inverted: the ledger is perfect and the "
        "conversation on screen shows nothing, which is the state a person is actually in",
        [
            (
                HOST,
                "this.publishOurs(registered, instructions.memoryLoaded)",
                "this.recordOurs(registered, instructions.memoryLoaded)",
            )
        ],
    ),
    # ── replay is a trust boundary ────────────────────────────────────────────────────────────
    (
        "M9 · ⛔ the stored path is unbounded · a ledger row written by a later build, or edited, "
        "hands the renderer an unbounded string to paint (216 §2)",
        [
            (
                STORE,
                "      event.index.length <= MAX_STORED_PATH_CHARS",
                "      event.index.length <= Number.MAX_SAFE_INTEGER",
            )
        ],
    ),
    (
        "M10 · ⛔ the bound checks only that SOMETHING is there · `index: 42` reaches the row, which "
        "is the broadly-cast payload arriving unchecked (216 §2)",
        [
            (
                STORE,
                "    const usable =\n"
                "      typeof event.index === 'string' &&\n"
                "      event.index.length > 0 &&\n"
                "      event.index.length <= MAX_STORED_PATH_CHARS",
                "    const usable = event.index !== undefined && event.index !== ''",
            )
        ],
    ),
    (
        "M11 · ⛔ the count is trusted as stored · `-3`, `NaN` and `Infinity` reach a sentence that "
        "prints them as a number of memories",
        [
            (
                STORE,
                "        ? Math.floor(event.beside)\n        : 0",
                "        ? Math.floor(event.beside)\n        : (event.beside as number)",
            )
        ],
    ),
    (
        "M12 · ⛔ the bound SPREADS instead of constructing · every undeclared key on a stored "
        "payload rides into the renderer, which is the rule its two neighbours in this function state",
        [
            (
                STORE,
                "    return {\n"
                "      type: 'memory_loaded',\n"
                "      index: usable ? event.index : '',\n"
                "      beside,\n"
                "      ...(lookedAt === undefined ? {} : { lookedAt }),\n"
                "    }",
                "    return { ...event, index: usable ? event.index : '', beside }",
            )
        ],
    ),
    # ── the fold ──────────────────────────────────────────────────────────────────────────────
    (
        "M13 · ⛔ a row with no file still draws · a heading claiming memory is in the prompt with "
        "nothing behind it — `106`, and the bare 'the agent used memory' row 319 §1.1 rules out",
        [(FOLD, "      if (event.index === '') return\n", "")],
    ),
    (
        "M14 · ⛔ the fold drops the count · every store reads as having nothing beside its index, "
        "so the one number the row is allowed to give is silently zero",
        [(FOLD, "        beside: event.beside,", "        beside: 0,")],
    ),
    # ── where it is shown ─────────────────────────────────────────────────────────────────────
    (
        "M15 · ⛔ hidden in the reading view · a row only a debug toggle reveals is a row the person "
        "who filed F15 would still not have found — and this one sits at the TOP of a conversation",
        [(MODE, "    case 'memoryLoaded':\n      return true", "    case 'memoryLoaded':\n      return mode === 'debug'")],
    ),
    # ── the sentence, which is the whole deliverable ──────────────────────────────────────────
    (
        "M16 · ⛔ the heading says the memories were loaded FOR THIS ANSWER · the exact hostile "
        "reading §1 names, and a recall this provider publishes nothing to support",
        [
            (
                ENTRY,
                "        This conversation opened with this profile’s memory index in the prompt",
                "        This profile’s memories were looked up for this answer",
            )
        ],
    ),
    (
        "M17 · ⛔ the row stops saying it is not a tool call · app-authored work presented in the "
        "provider's voice, which is the line `MemoryNoteEntry` was written to hold",
        [(ENTRY, " Nothing here is a tool call.", "")],
    ),
    (
        "M18 · ⛔ the reading is attributed to the AGENT · 'the agent has read' replaces 322's "
        "'only if it chooses to', turning availability into comprehension (305's defect)",
        [
            (
                ENTRY,
                # ⚑ **Re-anchored at 601**, which scoped the count to the window it was taken in
                # ("… as this session was launched —"). ⛔ The RULE is unchanged and is the reason the row
                # was not retired: 322's *only if it chooses to* is availability, and this turns it
                # into comprehension (305's defect). See
                # `a-retirement-is-about-the-subject-not-the-bytes`.
                "      it in this store as this session was launched — which the agent reads only if it chooses to.",
                "      it in this store as this session was launched — all of which the agent has read.",
            )
        ],
    ),
    (
        "M19 · ⛔ a store with nothing beside its index says '0 memories' · 317's empty state "
        "rendered as news, in the row whose whole job is to be worth reading",
        [(ENTRY, 'v-if="props.item.beside > 0"', 'v-if="props.item.beside >= 0"')],
    ),
    (
        "M20 · ⛔ one memory is reported in the plural · a count sentence that is wrong about the "
        "smallest store there is",
        [
            (
                ENTRY,
                # ⚑ **Re-anchored at 601**: the clause went PAST-tense when the count was scoped
                # to this app's look. ⛔ The rule is the same one — a count sentence that is wrong
                # about the smallest store there is.
                "{{ props.item.beside === 1 ? 'memory sat' : 'memories sat' }}",
                "{{ 'memories sat' }}",
            )
        ],
    ),
    (
        "M21 · ⛔ the whole path is gone · the row names a filename every store shares and no store "
        "in particular, which is the claim §1 says it IS allowed to make, withdrawn",
        [
            (
                ENTRY,
                '    <div class="ml-path" data-cy="memory-loaded-path">{{ props.item.index }}</div>',
                '    <div class="ml-path" data-cy="memory-loaded-path">{{ indexName }}</div>',
            )
        ],
    ),
    (
        "M22 · ⛔ the store directory disappears from the name line · `MEMORY.md` alone, which is "
        "true of every profile on the machine",
        [(ENTRY, '      <span v-if="store" class="ml-in">in {{ store }}</span>\n', "")],
    ),
    (
        "M23 · ⛔ the link is drawn where nothing can act on it · `106` — a control that does nothing "
        "when pressed, on `ReadingPane`'s imported conversations",
        [(ENTRY, 'v-if="props.canOpenStore"', 'v-if="true"')],
    ),
    (
        "M24 · ⛔ the link raises nothing · it looks identical on screen and the drawer never opens, "
        "which is the failure a render test cannot see",
        [(ENTRY, '@click="emit(\'openInstructions\')"', '@click="() => {}"')],
    ),
    (
        "M25 · ⛔ the pane stops passing the door through · the surface that CAN open the drawer "
        "draws no way to it, so 332 §2.3's one affordance is gone",
        [
            (
                VIEW,
                # ⚑ **Anchor corrected at `587`, subject unmoved** — the list folds into ROWS and the
                # chain reads `row.item`. Re-verified RED by hand at the correction
                # (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
                '          v-else-if="row.item.kind === \'memoryLoaded\'"\n'
                '          :item="row.item"\n'
                '          :can-open-store="props.canOpenStore"',
                '          v-else-if="row.item.kind === \'memoryLoaded\'"\n'
                '          :item="row.item"\n'
                '          :can-open-store="false"',
            )
        ],
    ),
    # ── the raw stream ────────────────────────────────────────────────────────────────────────
    (
        "M26 · ⛔ the Events tab says nothing about the row · the one tab whose job is 'what the "
        "app really recorded' prints an empty line for it",
        [
            (
                DESCRIBE,
                "      return `memory index in the prompt · ${event.index} · ${event.beside} beside it`",
                "      return ''",
            )
        ],
    ),
]
