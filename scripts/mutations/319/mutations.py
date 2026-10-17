"""319 · The citation we throw away — each row is THE DEFECT, put back verbatim (131).

⛔ **What 319 built, in one sentence.** When a Codex agent answers from memory, the app-server
publishes the model's own citation on the message item — the FILE, the LINE RANGE and a note about
how each one was used — and `codex/normalize.ts` read `text` and dropped the rest. This dispatch
reads it, bounds it, and draws it as a row under the answer.

⚑ **The finding this table is downstream of, because it decides what the rows are for.** `316` was
sent to find the wire trace of a memory call, enumerated item TYPES across fifteen config arms
looking for a tool item, found none, and reported the act *"invisible, permanently"*. `318`
re-measured with a control and found it as a FIELD on the item `316` had already seen. ⛔ **A filter
that counts kinds cannot see a property** — and the conclusion it produced then justified not looking
again. So several rows below are not about code that could break; they are about a claim that could
quietly become false again.

| rows | what they are |
|---|---|
| `M1`-`M4` | ⛔ **the defect, and the three ways to half-fix it** — the citation on the floor, and the row that keeps the file but loses the range, the note, or its place |
| `M5`-`M6` | ⚠️ **the bare row** — *"the agent used memory"* with nothing behind it, from the wire and from the ledger |
| `M7`-`M12` | ⚑ **the bound** — a wrong path shortened rather than dropped, a cap gone silent, a clip that overshoots into the schema, and a filter hardened on one capture |
| `M13`-`M17` | ⛔ **the replay path** (`216` §2) — the trust boundary nothing schema-parses |
| `M18`-`M22` | ⚠️ **the row on screen** — the honesty sentence, the mode people read in, the ids, and a range drawn from half a fact |
| `M23`-`M25` | ⛔ **the panel sentence** (`308`) — a door drawn where it does not open |
| `M26` | ⚑ **the taxonomy** — a citation counted as evidence the model is running |

## ⛔ What this table cannot reach, said out loud

⚠️ **No row can prove the reader derives the RIGHT FIELD.** Every unit assertion below feeds
`codexMemoryRecall` a `memoryCitation` typed into a fixture from the vendored protocol — the reader
proved against our own idea of the payload. ⛔ A row that renamed the field would go GREEN if the
fixture were renamed with it, and the fixture is in the same repository. The oracle has to be the
child's own output: `packages/runtime/smoke/codex-memory-citation.smoke.ts` streams a synthetic reply
into a real `0.146.0` app-server and asserts that BroBot's own normaliser turns what comes back into
`['assistant_message', 'memory_recall']`, with the control arm asserting the uncited answer produces
neither. ⚠️ **That probe is not part of `pnpm run ci`**, so this limit is real and is stated rather
than covered over — the same shape `317` recorded for the memory STORE's path.

⚠️ **No row proves the row is HONEST.** `M18` catches the provenance sentence being replaced with a
claim about a tool call, because that exact string is asserted — but a third wording subtly worse
than both would pass everything here. The distinction between *"the agent said it used this"* and
*"we watched it read this"* is checked by a person; `M18` marks the boundary rather than pretending
to cover past it. `318 M5` says the same thing about the sentence one row over.

⚑ **`M15` exists because an adversarial pass over this dispatch's own uncommitted diff found it** —
the replay bound's own comment forbade a silent cap while the code had one, because the type gate
dropped entries before `boundRecall` could count them. A payload of ten came back reporting seven.
It is a guard now.

⚠️ **No row mutates another dispatch's table, and none mutates the harness.** Like 240, 243, 247,
248, 250, 251, 254, 258, 262, 292, 300, 301, 306, 308, 317 and 318.
"""

RECALL = "packages/runtime/src/memory-recall.ts"
XNORM = "packages/runtime/src/codex/normalize.ts"
WORK = "packages/runtime/src/internal/provider-work.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
MODE = "apps/desktop/src/renderer/src/lib/transcript-mode.ts"
ROW = "apps/desktop/src/renderer/src/components/MemoryRecallEntry.vue"
PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
INSTR = "apps/desktop/src/main/runtime/instructions.ts"

MUTATIONS = [
    # ── the defect, and the three ways to half-fix it ──────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the message arm goes back to reading `text` and nothing "
        "else, so the file, the line range and the note the provider published are dropped one "
        "function from the UI — the state `main` was in before this dispatch, and the reason "
        "friction log F5 says *'I still don't see anything when the agent recalls memory'*",
        [
            (
                XNORM,
                # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 builds the message first (it may carry questions); the mutation is the same, the recall is dropped
                "    return recall ? [message, recall] : [message]",
                "    return [message]",
            )
        ],
    ),
    (
        "M2 · 🔴 the LINE RANGE is never carried, so a row names a file and cannot say which part of "
        "it. ⚠️ `319` §1.1: all three came off the wire, and a row that keeps one of them has thrown "
        "away most of what made it worth showing",
        [
            (
                XNORM,
                "      ...(ranged ? { lineStart, lineEnd } : {}),",
                "",
            )
        ],
    ),
    (
        "M3 · ⚠️ the agent's own note about HOW it used the file is dropped. ⛔ It is the one part of "
        "the citation that says something a path cannot — *'the user's full name'*, *'weekly report "
        "format'* — and without it the row is a file list",
        [
            (
                XNORM,
                "      ...(note ? { note } : {}),",
                "",
            )
        ],
    ),
    (
        "M4 · ⚠️ the recall is emitted BEFORE the message, so its position depends on a channel the "
        "reader cannot see: the fold finalizes a STREAMED assistant block in place, so the row lands "
        "above the answer when nothing streamed and below it when something did. ⛔ One payload, two "
        "layouts",
        [
            (
                XNORM,
                # ⚑ **provider-followups-1 · re-anchored in place, not retired** — provider follow-ups 1 builds the message first; the mutation is the same, the recall goes above the answer
                "    return recall ? [message, recall] : [message]",
                "    return recall ? [recall, message] : [message]",
            )
        ],
    ),
    # ── the bare row ──────────────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ a citation from which NOTHING survived still emits an event, so a shape change from "
        "a future pin draws a heading announcing a recall with no file, no range and no note behind "
        "it. ⚠️ That is the bare *'the agent used memory'* row `319` §1.1 rules out by name",
        [
            (
                XNORM,
                "  if (bound.entries.length === 0) return null",
                "",
            )
        ],
    ),
    (
        "M6 · ⚠️ the same bare row from the LEDGER instead of the wire. ⛔ The adapter cannot emit "
        "one; a stored row written by a build whose caps differed can, and the fold is the only "
        "thing that sees it",
        [
            (
                FOLD,
                "      if (event.entries.length === 0) return\n      state.items.push({\n        kind: 'memoryRecall',",
                "      state.items.push({\n        kind: 'memoryRecall',",
            )
        ],
    ),
    # ── the bound ─────────────────────────────────────────────────────────────────────────────
    (
        "M7 · ⛔ a path too long to be a path is kept instead of dropped, so a row invites a person "
        "to go looking in the store for a name that is not there. ⚠️ `boundCommands`' own ruling "
        "about a command's NAME, at the field that answers *'which memory?'*",
        [
            (
                RECALL,
                "    .filter((row) => row.path.trim() !== '' && row.path.length <= MAX_RECALL_PATH)",
                "    .filter((row) => row.path.trim() !== '')",
            )
        ],
    ),
    (
        "M8 · ⚠️ the shortfall goes silent: a citation naming thirty files shows twenty and reads as "
        "complete. ⛔ `092` §4's rule at the one event whose list is written by a model",
        [
            (
                RECALL,
                "    dropped: sentEntries.length - entries.length,",
                "    dropped: 0,",
            )
        ],
    ),
    (
        "M9 · ⛔ the note's clip overshoots the bound by one character — `normalize.ts`'s `truncate` "
        "semantic where an INCLUSIVE one is declared. ⚠️ The row then fails its own schema at "
        "`toWireEvent`, degrades to `unknown`, and the citation is lost in silence: the exact reason "
        "`MAX_COMMAND_TEXT` is a round number and not 201",
        [
            (
                RECALL,
                "      ...(row.note && row.note.trim() !== '' ? { note: clip(row.note, MAX_RECALL_NOTE) } : {}),",
                "      ...(row.note && row.note.trim() !== ''\n"
                "        ? { note: `${row.note.slice(0, MAX_RECALL_NOTE)}…` }\n"
                "        : {}),",
            )
        ],
    ),
    (
        "M10 · ⚠️ duplicate session ids are kept, so the count on the row inflates — the provider's "
        "own instruction to the model is *'include unique ids only; do not repeat ids'*, and this "
        "row is where that contract is honoured",
        [
            (
                RECALL,
                "    if (!unique.includes(id)) unique.push(id)",
                "    unique.push(id)",
            )
        ],
    ),
    (
        "M11 · ⚠️ the id cap goes silent, so *'it also named 2 earlier sessions'* is drawn under a "
        "citation that named twenty-two. ⛔ `092` §4 at the one number on the row a person cannot "
        "check any other way",
        [
            (
                RECALL,
                "    threadsDropped: unusable + Math.max(0, unique.length - MAX_RECALL_THREADS),",
                "    threadsDropped: 0,",
            )
        ],
    ),
    (
        "M12 · ⛔ the ids are hardened on the SHAPE one capture happened to have. ⚠️ The provider says "
        "they *'should look like UUIDs'* — a should, in an instruction to a model — and a filter "
        "built on that goes quiet the day the shape moves, with nothing to say it did. "
        "`absence-in-a-capture-is-not-absence`, as a row",
        [
            (
                RECALL,
                "    if (id.trim() === '') continue",
                "    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) continue",
            )
        ],
    ),
    (
        "M27 · ⛔ an id too long to carry is dropped WITHOUT being counted, so *'it also named 2 "
        "earlier sessions'* is drawn under a citation that named three. ⚠️ Found reviewing this "
        "dispatch's own diff: the surface adds `threadIds.length` and `threadsDropped` to make that "
        "number, so an uncounted drop is `092` §4 at the one figure on the row nothing else checks",
        [
            (
                RECALL,
                "    if (id.length > MAX_THREAD_ID) {\n      unusable += 1\n      continue\n    }",
                "    if (id.length > MAX_THREAD_ID) continue",
            )
        ],
    ),
    # ── the replay path ───────────────────────────────────────────────────────────────────────
    (
        "M13 · ⛔ the stored-event bound is dropped, so a ledger row written by a later build — or "
        "edited — hands the renderer an unbounded array of unbounded strings to paint into the DOM. "
        "⚠️ `216` §2's rule at the second event on this union whose strings a MODEL wrote",
        [
            (
                STORE,
                "    const bound = boundRecall(sent, storedThreadIds(event.threadIds))",
                "    const bound = { entries: sent, dropped: 0, threadIds: [], threadsDropped: 0 }",
            )
        ],
    ),
    (
        "M14 · ⚠️ the TYPE gate goes, so a stored entry whose `path` is a number reaches "
        "`row.path.length` and throws — and `toPersistedEvents` skips the row. ⛔ The citation "
        "vanishes from a replayed conversation with nothing anywhere to say why",
        [
            (
                STORE,
                "        typeof each === 'object' && each !== null && typeof each['path'] === 'string',",
                "        each !== null && each !== undefined,",
            )
        ],
    ),
    (
        "M15 · ⛔ the replay cap goes silent again, in the term this dispatch shipped WITHOUT until "
        "an adversarial pass over its own diff found it: the type gate drops what cannot be an entry "
        "at all before `boundRecall` can count it, so a payload of ten came back reporting seven — "
        "`092` §4's defect inside the block whose own comment forbids it",
        [
            (
                STORE,
                "      (claimed - sent.length) +\n",
                "",
            )
        ],
    ),
    (
        "M28 · ⛔ the bounded fields are merely OVERRIDDEN instead of stripped, so a stored row whose "
        "every id was too long to carry keeps the original unbounded array — the conditional does "
        "not fire on exactly the path that matters, and the payload this bound exists to stop rides "
        "into the renderer. ⚠️ Found reviewing this dispatch's own diff; `boundHandedPaths` one bound "
        "up is where the destructure idiom comes from",
        [
            (
                STORE,
                "    const {\n"
                "      threadIds: _storedIds,\n"
                "      dropped: _storedDropped,\n"
                "      threadsDropped: _storedThreadsDropped,\n"
                "      ...rest\n"
                "    } = event\n"
                "    void _storedIds\n"
                "    void _storedDropped\n"
                "    void _storedThreadsDropped\n"
                "    return {\n"
                "      ...rest,",
                "    return {\n"
                "      ...event,",
            )
        ],
    ),
    (
        "M16 · ⚠️ the stored entry is SPREAD instead of constructed, so an edited row's fifth key of "
        "any size rides the payload into the renderer. ⛔ The rule `boundMemoryNotes` records one "
        "function over: `{ ...each }` keeps the lengths and nothing else",
        [
            (
                STORE,
                "      return {\n"
                "        path: each['path'] as string,\n"
                "        ...(ranged ? { lineStart: start as number, lineEnd: end as number } : {}),\n"
                "        ...(typeof each['note'] === 'string' ? { note: each['note'] } : {}),\n"
                "      }",
                "      return { ...each, path: each['path'] as string } as MemoryRecallEntry",
            )
        ],
    ),
    (
        "M17 · ⚠️ a replayed range is trusted rather than re-checked, so a stored row draws `234-3` "
        "or `lines 1–9` from two strings — a range no LIVE citation could ever have produced. ⛔ The "
        "adapter's rule and the ledger's must be the same rule",
        [
            (
                STORE,
                "      const ranged =\n"
                "        typeof start === 'number' &&\n"
                "        typeof end === 'number' &&\n"
                "        Number.isInteger(start) &&\n"
                "        Number.isInteger(end) &&\n"
                "        start >= 0 &&\n"
                "        end >= start",
                "      const ranged = start !== undefined && end !== undefined",
            )
        ],
    ),
    # ── the row on screen ─────────────────────────────────────────────────────────────────────
    (
        "M18 · ⛔ the provenance sentence becomes a claim nobody can support — *the agent read these "
        "files* — where what the provider published is the model's own account of what it used. "
        "⚠️ `009`'s rule and `305`'s defect: a disclosure must not say we saw what we were told",
        [
            (
                ROW,
                "      The provider reported this with the reply — the agent’s own account of what it used, not a\n"
                "      tool call.",
                "      The agent read these files from its memory before answering.",
            )
        ],
    ),
    (
        "M19 · ⚠️ the row is hidden in the mode people read in. ⛔ Friction log F5 is a person saying "
        "he cannot see a recall happen, and a row only a debug toggle reveals is a row that does not "
        "answer him — `318 M8`'s defect on the read side",
        [
            (
                MODE,
                "    case 'memoryRecall':\n      return true",
                "    case 'memoryRecall':\n      return mode === 'debug'",
            )
        ],
    ),
    (
        "M20 · ⛔ the raw session ids are drawn. ⚠️ They are UUIDs the MODEL transcribed out of text "
        "files, the provider's own instruction calls that list *'for us to track'* while calling the "
        "entries *'for rendering'*, and nothing in this app can open one — `106`: a thing on screen "
        "that looks like a handle and that nothing can act on",
        [
            (
                ROW,
                # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
                "      It also named {{ earlier }} earlier {{ earlier === 1 ? 'session' : 'sessions' }} of its own —\n      BroCrew does not read those, so it cannot say which.",
                "      It also drew on {{ (props.item.threadIds ?? []).join(', ') }}.",
            )
        ],
    ),
    (
        "M21 · ⚠️ the entry cap goes silent ON SCREEN, so a citation naming thirty files shows twenty "
        "and reads as complete. ⛔ The same `092` §4 defect `M8` forbids on the wire, at the surface "
        "where nothing else can catch it",
        [
            (
                ROW,
                "    <p v-if=\"props.item.dropped\" class=\"mr-aside\" data-cy=\"memory-recall-dropped\">",
                "    <p v-if=\"false\" class=\"mr-aside\" data-cy=\"memory-recall-dropped\">",
            )
        ],
    ),
    (
        "M22 · ⛔ a range is drawn from half a fact, so a citation the provider gave no usable "
        "numbers for renders `lines undefined–undefined`. ⚠️ `074`: never print a measurement nobody "
        "made, at the one field on this row that is a number",
        [
            (
                ROW,
                "  if (entry.lineStart === undefined || entry.lineEnd === undefined) return null",
                "",
            )
        ],
    ),
    # ── the panel sentence ────────────────────────────────────────────────────────────────────
    (
        "M23 · ⛔ the panel promises a recall row to EVERY session, including the provider that "
        "publishes no citation at all — `318` measured that its CLI preloads the memory index into "
        "its own prompt with no tool and no citation. ⚠️ `308`'s defect on `308`'s own surface: a "
        "disclosure promising what this app does not do",
        [
            (
                PANEL,
                '        <span v-if="instructions.recallsReported" data-cy="memory-store-recall-is-shown">',
                '        <span data-cy="memory-store-recall-is-shown">',
            )
        ],
    ),
    (
        "M24 · ⚠️ the same promise made one layer earlier, where the provider is actually known: the "
        "flag is set for a provider that reports nothing. ⛔ `false` here is a MEASUREMENT rather "
        "than a gap, and a row that flips it is a panel telling a user to watch for something that "
        "will never come",
        [
            (
                INSTR,
                # ⚑ **Anchor corrected in place at 330, not retired** (142, and
                # `correct-a-stale-mutation-anchor-dont-retire-it`). It reached through to the
                # function's closing braces to be unique; 330 added a SECOND flag to this same
                # return — `writesReported` — so those braces stopped being adjacent and the row went
                # red on a change that has nothing to do with what it protects. ⛔ The mutation is
                # unchanged: still the Claude branch's `recallsReported` flipped to a promise this
                # wire cannot keep. The line alone is unique here (the other site says `true`).
                "    recallsReported: false,",
                "    recallsReported: true,",
            )
        ],
    ),
    (
        "M25 · ⚠️ `318`'s clause is deleted rather than kept, leaving only the pointer. ⛔ Its "
        "literal claim survived `319` and is the reason the line exists at all — this panel reports "
        "a STORE and never a reading (`009`, `305`) — so a version that says only *'it says so in "
        "the conversation'* has dropped the true half to make room for the new one (`142`)",
        [
            (
                PANEL,
                "        Nothing here says which of these the agent has actually looked up.\n",
                "",
            )
        ],
    ),
    # ── the taxonomy ──────────────────────────────────────────────────────────────────────────
    (
        "M26 · ⚑ a citation is counted as evidence the MODEL is running. ⚠️ It is emitted from the "
        "same `agentMessage` item as the `assistant_message` beside it and from nothing else, so the "
        "turn it would prove is already proved one event over — `061` finding 6 in its quietest "
        "form: one fact, one owner",
        [
            (
                WORK,
                "const PROVIDER_WORK = new Set<RuntimeEvent['type']>([\n  'assistant_delta',",
                "const PROVIDER_WORK = new Set<RuntimeEvent['type']>([\n  'memory_recall',\n  'assistant_delta',",
            )
        ],
    ),
]
