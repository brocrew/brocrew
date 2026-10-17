"""421 · a live conversation is never drawn as ended — each row is THE DEFECT, put back (131).

🔴 **HO-023 §2.3, in the PO's words:**

> *"Listing it under **Closed conversations**, labelling it **ended**, and offering **Reopen** —
> then refusing the reopen by naming **a window that does not exist** — is four surfaces lying in
> sequence. `ownerId === null` means nobody holds it, and the app already knows the right gesture.
> `store.claim()` is the door that works and it has one call site. **Give it the others.**"*

## ⛔ The defect, in one sentence

**Nothing on the wire said whether this app is RUNNING a recorded row**, so every surface that reads
the two list commands answered from the ledger alone — and a conversation an agent had just started
is a ledger row like any other. ⚠️ `closed-threads.ts` then built every plate `ended: true`, under a
comment claiming `hideOpen` guaranteed the list held nothing the app was running. **`hideOpen` is
`props.open`: the ids ONE WINDOW holds.**

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · the field** (`M1`–`M5`). `RunningState` is answered from the slot map, because the column
  cannot answer it: `settleOrphanRuns` settles a crashed run to **`idle`**, so a live conversation
  and one a power cut ended three weeks ago say the same word. Rows here point the discriminant at
  each of the states it tells apart, and at the two edges — a slot still opening and one on its way
  out — where `not-running` is a ruling rather than a rounding.
- **§2 · what the fold does with it** (`M6`–`M9`): the plate, both gesture arms, and the note.
- **§3 · the words** (`M10`, `M11`). ⛔ The fork lives in `taking-over.ts` because `persons-queue.ts`
  and the rail must name one gesture one way; a row collapses it, and a row makes the take-over row
  say the sentence a recording says.
- **§4 · the refusals** (`M12`–`M14`): the two `SessionUnavailable` sites that used to name a window
  that does not exist, and the sentence itself.
- **§5 · the surfaces** (`M15`–`M17`): the rail's two sections and the palette's band and action.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M5`, `M12`–`M14` | ⚑ **`run_suite`** — `apps/desktop/test/a-live-conversation-is-never-drawn-as-ended.test.ts`, `test/the-door-a-session-can-be-created-through.test.ts`, `test/session-unavailable.test.ts` |
| `M6`–`M11` | ⚑ **`run_suite`** — `apps/desktop/test/closed-threads.test.ts`, `test/two-sessions-of-one-agent.demo.test.ts` |
| `M15`–`M17` | ⚑ **`run_dom`** — `apps/desktop/test/dom/a-live-conversation-is-never-drawn-as-ended.dom.test.ts`, and `test/command-palette.test.ts` for the band |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `hideOpen`.** It is not the defect and it was not removed: it answers *"do I already
have this on screen"*, which is the one question a per-window filter is entitled to decide, and
`closed-threads.test.ts` pins it. A row would price `090`'s rule again, in the dispatch that proved
it was being asked the wrong question rather than the wrong way.

⛔ **No row on the live-session rail or on `end_agent`'s floor.** `416` owns the first and `375` the
second; `418` priced both and this dispatch changed neither.

⛔ **No row making the unresumable half read `not-running`.** It would survive, and the reason is
worth writing down rather than hiding: `FakeRuntime` hands a provider ref back at start, so a LIVE
row with no ref — which is every Claude conversation for the whole of its first turn — is not
reachable in a host test. ⚑ `M5` points that mapper the other way instead, which a test can see, and
the fold's own reading of that half is `closed-threads.test.ts`'s.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
THREADS = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
WORDS = "apps/desktop/src/renderer/src/lib/taking-over.ts"
UNAVAILABLE = "apps/desktop/src/main/runtime/session-unavailable.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
PALETTE = "apps/desktop/src/renderer/src/lib/command-palette.ts"
AGENT_STATE = "apps/desktop/src/renderer/src/lib/agent-state.ts"

MUTATIONS = [
    # ── §1 · the field ────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the host says it is running NOTHING, so every surface is "
        "back to reading the ledger alone — which is the state `418` measured the person's own rail in",
        [(HOST,
          "    return slot.ownerId === null ? 'unwatched' : 'in-a-window'",
          "    return 'not-running'")],
    ),
    (
        "M2 · ⛔ the owner stops deciding · a conversation a WINDOW is running is offered as one "
        "nobody is watching, so a person is invited to take over something they are already looking "
        "at in another window — 062's refusal, dressed as an invitation",
        [(HOST,
          "    return slot.ownerId === null ? 'unwatched' : 'in-a-window'",
          "    return 'unwatched'")],
    ),
    (
        "M3 · ⚠️ a slot that is on its way OUT is reported running · the take-over is then offered "
        "over a teardown, `claimSession` refuses it `still-closing`, and the reopen that WOULD have "
        "worked (075 waits a teardown out) is the gesture the row no longer has",
        [(HOST,
          # ⚠️ **ANCHOR CORRECTED IN PLACE BY 659** — the three facts are `onItsWayOut` now; the
          # subject is unchanged, and the row was re-verified RED by hand against its killer.
          "    if (onItsWayOut(slot)) {\n      return 'not-running'\n    }",
          "    if (false) {\n      return 'not-running'\n    }")],
    ),
    (
        "M4 · ⛔ a row this host has no slot for is reported running · every conversation a crash or "
        "a power cut left behind is offered a take-over, and every one of those is refused "
        "`not-running` — the careless fix this dispatch's control exists to catch",
        [(HOST,
          "    const slot = this.slots.get(sessionId)\n    if (slot === undefined) return 'not-running'",
          "    const slot = this.slots.get(sessionId)\n    if (slot === undefined) return 'unwatched'")],
    ),
    (
        "M5 · ⚑ the half with no provider ref stops asking · `unresumableSessions` answers a "
        "constant, so the list a live Claude session sits in for the whole of its first turn "
        "describes every row the same way",
        # ⚠️ **RE-ANCHORED at 699, not retired.** 699 gave the unresumable half a second field, so the mapper is a block now; the row still makes `running` a constant. The DEFECT this row plants is unchanged.
        [(HOST,
          "      running: this.runningStateOf(row.sessionId),\n",
          "      running: 'unwatched' as const,\n")],
    ),
    # ── §2 · what the fold does with it ───────────────────────────────────────────────────────
    (
        "M6 · 🔴 the plate goes back to being a statement about the LIST · `ended: true` for every "
        "row, which is the line HO-023 §2.3 ruled on and the word the person read over a provider that "
        "was mid-answer",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives and
        # D-017b's own test states it: a row's plate must never say ended for a conversation that is
        # not over ("the plate is the host's state, never ENDED"). `closed-threads.ts` and its
        # `ended: row.running === 'not-running'` are deleted, so the plant puts `being: 'ended'`
        # back on the plate facets that every host-listed row now takes from `facetsOfState` (the
        # idle and active arms).
        [
            (AGENT_STATE, "    case 'idle':\n      return { doing: 'idle' }\n", "    case 'idle':\n      return { doing: 'idle', being: 'ended' }\n"),
            (AGENT_STATE, "    case 'active':\n      return { doing: 'working' }\n", "    case 'active':\n      return { doing: 'working', being: 'ended' }\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is gone: there is no
        # `gesture` (take-over or reopen) to pick, so no wrong verb can be offered. D-017b: "no
        # Reopen / Take it over / Read the recording presses: one press, 'Open the conversation'",
        # and the host's new `look` door opens a conversation whatever its process is doing. Its
        # anchor is left stale, so the census records it retired.
        "M7 · ⛔ the wrong verb, put back · a conversation the app is running is offered a REOPEN, "
        "which the host refuses every time because the id is live",
        [(THREADS,
          "    return row.running === 'unwatched' ? 'take-over' : null",
          "    return row.running === 'unwatched' ? 'reopen' : null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is gone: a conversation
        # another window holds is no longer offered a take-over, because no row offers one. D-017b:
        # "one press, 'Open the conversation'" for every row, and the row says only `open in another
        # window` (OPEN_IN_ANOTHER_WINDOW), never a gesture. Its anchor is left stale, so the census
        # records it retired.
        "M8 · ⚠️ a conversation another WINDOW holds is offered a take-over · `mayClaim` is true "
        "only of a null owner, so the press is refused `already-open-elsewhere` — a control that "
        "cannot act, which is `118`'s rule pointed the other way",
        [(THREADS,
          "    return row.running === 'unwatched' ? 'take-over' : null",
          "    return 'take-over'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is gone: the per-row note
        # arm ("nothing of it was recorded, so there is nothing to open") lived in
        # closed-threads.ts, which D-017b deleted. Its card line: "No sentence says whether a
        # process runs", and a row now says only the host's one state (conversation-list.ts: "Never
        # whether a process runs (05 rule 5)"). Its anchor is left stale, so the census records it
        # retired.
        "M9 · ⛔ the running arm stops outranking the record · a live conversation falls through to "
        "the recording's own note, and a row a window holds reads *nothing of it was recorded, so "
        "there is nothing to open* about a provider that is answering right now",
        [(THREADS, "  if (row.running !== 'not-running') {\n    return row.running === 'unwatched'",
          "  if (false) {\n    return row.running === 'unwatched'")],
    ),
    # ── §3 · the words ────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b removed the fork on purpose.
        # `openingAction` is deleted and taking-over.ts exports only OPEN_THE_CONVERSATION: "there
        # is one press now... a row offers one gesture, in one sentence". The old words for the
        # gesture, Take it over and open it, "each named what a process was doing, which a person no
        # longer has to know (05 rule 5)". Its anchor is left stale, so the census records it
        # retired.
        "M10 · 🔴 the fork collapses · both surfaces say *Open the conversation* for a conversation "
        "this window does not hold, so the one press that takes something over from an agent "
        "announces itself as an ordinary open",
        [(WORDS, "  return held ? 'Open the conversation' : 'Take it over and open it'",
          "  return 'Open the conversation'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject is gone:
        # `NOT_OPEN_IN_ANY_WINDOW` and the per-row `note` field no longer exist. D-017b: "no
        # heading, no gesture and no word per split" (conversation-list.ts), and "No sentence says
        # whether a process runs" (commit message). Its anchor is left stale, so the census records
        # it retired.
        "M11 · ⚠️ the row stops saying what is wrong with it · *nobody is watching it* becomes the "
        "same elapsed-time note a closed row carries, so the two populations read alike again in "
        "the one line `151` gives a row",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — D-017 renamed the
        # unwatched row's note to `NOT_OPEN_IN_ANY_WINDOW` (*not open in any window*, F024: never a
        # process fact); the two arms still say two different things, and `closed-threads.test.ts`
        # pins the unwatched one.
        [
            (THREADS, '          note: NOT_OPEN_IN_ANY_WINDOW,', '          note: OPEN_IN_ANOTHER_WINDOW,'),
        ],
    ),
    # ── §4 · the refusals ─────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 the reopen names a window that does not exist again · `418`'s second measured "
        "string, restored: *This conversation is already open in another window. Switch to that "
        "window to carry on with it* — about a conversation `ownerId === null` says nobody holds",
        [(HOST,
          "        existing.ownerId === null\n          ? 'held-by-nobody'\n          : existing.ownerId === ownerId",
          "        existing.ownerId === null\n          ? 'already-open-elsewhere'\n          : existing.ownerId === ownerId")],
    ),
    (
        "M13 · ⛔ the person's Close names it too · the third gesture on an agent-spawned "
        "conversation goes back to *it belongs to another window… switch to that window to answer "
        "it, send to it, or close it*",
        [(HOST, "        slot.ownerId === null ? 'held-by-nobody' : 'not-yours',", "        'not-yours',")],
    ),
    (
        "M14 · ⚠️ the code survives and its SENTENCE does not · the refusal is told apart correctly "
        "and reads the words of the one it was split from, which is the failure three docblocks in "
        "this file were written to prevent and the one a code-only check cannot see",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The rule —
        # `held-by-nobody` must carry its OWN sentence, never the one `not-yours` was split from —
        # still holds and is still asserted by session-unavailable.test.ts's 'no two reasons share a
        # sentence' test, complete with its own docblock at the site warning against exactly this.
        # Only the wording moved (D-017 · F024 rewrote `held-by-nobody`'s sentence to drop 'nobody
        # is watching it'); the not-yours sentence it must not collapse into is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives and
        # the test is unchanged: `held-by-nobody` must carry its own sentence, never the one
        # `not-yours` was split from, asserted by "no two reasons share a sentence" in
        # session-unavailable.test.ts. Only the wording moved again, to "No window holds this
        # conversation, so nothing was done to it...", so the plant swaps in the exact `not-yours`
        # sentence.
        [
            (UNAVAILABLE, "      return 'No window holds this conversation, so nothing was done to it. Take it over by pressing its row, then send to it or answer it.'", "      return 'This conversation belongs to another window, so nothing was sent to it. Switch to that window to answer it or send to it.'"),
        ],
    ),
    # ── §5 · the surfaces ─────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The section this row empties is
        # deleted: `foldedRows`, the *Running* section and the *Closed conversations* heading are
        # gone. D-017b: "One Conversations list in the rail and the palette, each row with the
        # shared state: no open / closed / kept-open split". Its anchor is left stale, so the census
        # records it retired.
        "M15 · 🔴 the section that tells the truth stops holding anything · every row falls back "
        "under *Closed conversations*, which is the heading this dispatch is named after",
        [(RAIL,
          "  foldedRows.value.filter((row) => row.running !== 'not-running'),",
          "  foldedRows.value.filter(() => false),")],
    ),
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 keeps what the quit closed out of the closed list; the row still points the split the wrong way. The DEFECT this row plants is unchanged.
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The split it points the wrong way is
        # deleted with the closed list (`foldedRows`, `keptOpen`). D-017b: "no open / closed /
        # kept-open split"; the rail's `rows` is one list, and the dom test asserts there is no
        # `rail-running-unwatched` or `rail-closed-conversations` section at all. Its anchor is left
        # stale, so the census records it retired.
        "M16 · ⛔ the closed list swallows the running rows again · the split is pointed the wrong "
        "way, so a conversation an agent started is drawn under the heading that says it is over",
        [(RAIL,
          "  foldedRows.value.filter((row) => row.running === 'not-running' && !row.keptOpen),",
          '  foldedRows.value.filter(() => true),')],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The palette no longer has a `takeOver`
        # arm or a `read` action: PaletteAction is just `select`, and PALETTE_GROUPS lost the
        # `running` and `closed` bands. The card line in command-palette.ts: "every conversation in
        # the rail's one list, one row each — pressing any of them opens it in its full view,
        # whatever it is doing, so there is one band and one action." Its anchor is left stale, so
        # the census records it retired.
        "M17 · ⚠️ the palette offers a READ of a live conversation · a transcript window over a "
        "conversation that is still being written, in the band that says it is closed — the binary "
        "fork this dispatch had to make exhaustive",
        [(PALETTE, "    const takeOver = row.gesture === 'take-over'", "    const takeOver = false")],
    ),
]
