"""678 · Draw what main now hands you — `671`'s facts drawn, the other conversation's draft kept, two
sentences made true, and the other re-reads priced and the material two bounded.

⚑ **The PM's §1:** `671` put four facts on the wire for the cards and one count on five walks, and
none was drawn — the words on `message_sent` (F-G1), the task a turn opened (F-G2), a recording's own
agent (F-G4a), the folded fallback (F-G5a), `rowsUnread` (F-R18a–d). **§2 (R26):** a reopen from the
grant sheet must KEEP the other conversation's draft. **§3:** *"would fail in the runtime with 'a
turn is in progress'"* and *"Create it from the rail"*. **§4:** price the other re-reads; coalesce
what is material; land `672`'s burst harness as a pin on reads per act.

## 🔴 What has to be killable

 * `M1`–`M7` ⚑ **F-G1**: the fold drops the words, or the cut; the card reads the arguments over the
   host's words; the cut is inferred rather than read; the cut line goes back to `…`; its words
   change; the Events tab's `cut` goes quiet.
 * `M8`–`M14` ⚑ **F-G2**: the turn never joined; the held order never numbered; the idle order never
   numbered; a person's turn takes a task; the card's words always *Task*; the card drawn nowhere; the
   Events tab forgets the task.
 * `M15`–`M18` ⚑ **F-G4a**: a recording names nobody; the name not handed to the cards; the replies
   headed with the provider; a recording this app did not run named *BroBot* (the invent-one trap).
 * `M19`–`M29` 🔴 **F-R18**: the second half of the sentence dropped; a sentence at zero; each surface's
   fold handing no sentence (forest, Work tab, band ×2, stalled band, project room); the Work tab's
   empty line back over unread rows; the band's heading gone over a list that lost every row; the
   queue's section not opening for the count alone.
 * `M30`–`M36` 🔴 **R26**: the hold not in the sweep's keep list; a refused reopen's wait dropped; the
   wait never parked; the wait never released; overlapping holds released by the first; the screen's
   gesture outside the hold; the draft row back to *lost*.
 * `M37`–`M40` ⚑ **§3**: the refusal back to *the rail*; the label and the button apart; the switch
   named by a word nothing carries; the no-row sentence's clause gone.
 * `M45`–`M46` 🔴 **found by review**: the stalled band's page gate; the page calling itself quiet over it.
 * `M41`–`M44` ⚑ **§4**: the workspace and the room read unwrapped; the conversations arm no longer
   reading either, which the reads-per-act table claims it does.

## ⛔ What this table cannot reach

 * ⚠️ **F-G5a** is a deletion — four renderer folds of an already-folded name — and nothing it removed
   can be put back as a defect: `agentName` folds whatever it is handed. The census in
   `the-three-sentences-beside-the-cards.test.ts` §3 refuses a second fold; that is a claim about the
   code's SHAPE, and a mutation of a census is invisible to it.
 * ⚠️ **The cost of a read** — `678` §4 priced it (a machine number, standing rule 22); the table
   pins the COUNT, through `reads-per-act.test.ts`.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
alone with `scripts/mutations/verify_row.py` — one row, its killer file, restored from bytes — in an
isolated worktree, never the tree the person's dev server watches, and no `mutations.txt` exists.
"""

from __future__ import annotations

LIB = "apps/desktop/src/renderer/src/lib"
COMPONENTS = "apps/desktop/src/renderer/src/components"
ROWS_UNREAD = "apps/desktop/src/renderer/src/lib/rows-unread.ts"
THE_FOREST = "apps/desktop/src/renderer/src/lib/the-forest.ts"
WORK_GIVEN_OUT = "apps/desktop/src/renderer/src/lib/work-given-out.ts"
WORKING_TOGETHER = "apps/desktop/src/renderer/src/lib/working-together.ts"
PERSONS_QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
PROJECT_ROSTER = "apps/desktop/src/renderer/src/lib/project-roster.ts"
PERSONSQUEUE = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
RELAYED_TURN = "apps/desktop/src/renderer/src/lib/relayed-turn.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
DESCRIBE_EVENT = "apps/desktop/src/renderer/src/lib/describe-event.ts"
WAITINGONYOU = "apps/desktop/src/renderer/src/components/WaitingOnYou.vue"
OUTGOINGENTRY = "apps/desktop/src/renderer/src/components/OutgoingEntry.vue"

FOLD = f"{LIB}/transcript.ts"
OUT = f"{LIB}/outgoing-card.ts"
DESCRIBE = f"{LIB}/describe-event.ts"
RELAYED = f"{LIB}/relayed-turn.ts"
UNREAD = f"{LIB}/rows-unread.ts"
FOREST = f"{LIB}/the-forest.ts"
WORK = f"{LIB}/work-given-out.ts"
TOGETHER = f"{LIB}/working-together.ts"
PQ = f"{LIB}/persons-queue.ts"
ROSTER = f"{LIB}/project-roster.ts"
DRAFTS = f"{LIB}/drafts.ts"
REOPENING = f"{LIB}/reopening.ts"
STORE = f"{LIB}/agent-store.ts"
WHERE = f"{LIB}/where-agents-are-created.ts"
OUTGOING = f"{COMPONENTS}/OutgoingEntry.vue"
RELAYED_ENTRY = f"{COMPONENTS}/RelayedEntry.vue"
READING = f"{COMPONENTS}/ReadingPane.vue"
BAND = f"{COMPONENTS}/WorkingTogether.vue"
QUEUE = f"{COMPONENTS}/PersonsQueue.vue"
TEAM = f"{COMPONENTS}/TeamWorkspace.vue"
SHEET = f"{COMPONENTS}/CapabilitiesSheet.vue"
SCREEN = f"{COMPONENTS}/RuntimeScreen.vue"
WAITING = f"{COMPONENTS}/WaitingOnYou.vue"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── F-G1 · the words on the receipt ──────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the fold drops the host's words** · the card falls back to the arguments' 200 — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The message_sent object moved two spaces left; keep the same field omission or trust-boundary bypass.
        [(FOLD, "        text: typeof event.text === 'string' ? event.text : null,",
          "        text: null,")],
    ),
    (
        "M2 · 🔴 **the fold drops the cut** · 1,280 of a longer message drawn as the whole — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The message_sent object moved two spaces left; keep the same field omission or trust-boundary bypass.
        [(FOLD, "        clipped: typeof event.text === 'string' && event.clipped === true,",
          "        clipped: false,")],
    ),
    (
        "M3 · ⚑ **the card reads the arguments over the host's words** · `671`'s field folded and ignored — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        [(OUT, "  const recorded = sent?.text ?? null\n", "  const recorded: string | null = null\n")],
    ),
    (
        "M4 · ⛔ **the cut inferred, not read** · the host's `clipped` ignored, so a cut message reads whole — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        [(OUT, "    bodyIsCut: recorded === null ? excerpt?.cut === true : sent?.clipped === true,",
          "    bodyIsCut: recorded === null ? excerpt?.cut === true : false,")],
    ),
    (
        "M5 · 🔴 **the cut back to an ellipsis** · `…` under the words — a mark the author could have typed — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The old one-line `<p ... data-cy="outgoing-cut">{{ BODY_WAS_CUT }}</p>` was reshaped by
        # UI-011 (128203e6), which put a press (`outgoing-read-whole`) beside the sentence inside
        # the same `<p>`. The rule survives: a cut body says so in words, never `…`. The plain-note
        # arm is now `<template v-else>{{ BODY_WAS_CUT }}</template>`, which is what a message_agent
        # card draws because only give cards carry a wholeBrief. Killed by
        # `what-main-now-hands-you.dom.test.ts`.
        [
            (OUTGOINGENTRY, '<template v-else>{{ BODY_WAS_CUT }}</template>', '<template v-else>…</template>'),
        ],
    ),
    (
        "M6 · ⚑ **the cut line in other words than MemoryNoteEntry's** · two ways to say one thing — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        [(OUT, "export const BODY_WAS_CUT = 'Cut at the size limit — this much of it is shown here.'",
          "export const BODY_WAS_CUT = 'Shortened.'")],
    ),
    (
        "M7 · ⚑ **the Events tab's cut goes quiet** · *1280 chars* reads as a message that long — "
        "killed by `what-main-now-hands-you.test.ts`",
        [(DESCRIBE, "chars${event.clipped === true ? ', cut' : ''}`", "chars`")],
    ),
    # ── F-G2 · the task a turn opened ────────────────────────────────────────────────────────
    (
        "M8 · 🔴 **the turn never joined** · the incoming card cannot say it arrived as work — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 688: the call hands the turn's own number too (`687` H6); the row — the
        # turn never joined — is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (an
        # incoming brief's card must say which piece it gave, joined in the idle order) survives:
        # `taskId`/`openedATask` became `piece`/`openedAPiece`, called from the user_turn arm with
        # the turn's own label. The plant deletes that call so an idle brief's card never joins its
        # piece. Killed by `what-main-now-hands-you.dom.test.ts`.
        [
            (TRANSCRIPT, '        openedAPiece(state, event.piece, event.label)\n', ''),
        ],
    ),
    (
        "M9 · 🔴 **the held order never numbered** · the row came first and the card says only *Task* — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The held order
        # (the give row arrives first, the brief flushes after) still exists as `given` in
        # `state.piecesGiven`; `openedAPiece` reads its title in that branch, so the old 'numbered
        # from the held row' rule is now 'titled from the held row'. The plant drops the title
        # spread there, so the held card says only its label. Killed by
        # `what-main-now-hands-you.dom.test.ts`.
        [
            (TRANSCRIPT, '    ...(given?.title === undefined ? {} : { title: given.title }),\n', ''),
        ],
    ),
    (
        "M10 · 🔴 **the idle order never numbered** · the turn came first and waits for ever — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The idle order
        # (turn first, the give row later) still parks the turn in `briefsAwaitingTheirTitle` and
        # the `work_given` arm fills it. The plant removes the fill (`turn.opened = {
        # ...turn.opened, ...given }`), so the turn waits forever with its label only. Killed by
        # `what-main-now-hands-you.dom.test.ts`.
        [
            (TRANSCRIPT, '        turn.opened = { ...turn.opened, ...given }\n', ''),
        ],
    ),
    (
        "M11 · ⛔ **a person's turn takes a task** · a hand-edited row's key lands on any item — "
        "killed by `what-main-now-hands-you.test.ts`",
        [(FOLD, "  const turn = state.items[state.items.length - 1]\n  if (turn?.kind !== 'relayed') return\n",
          "  const turn = state.items[state.items.length - 1] as RelayedItem | undefined\n  if (turn === undefined) return\n")],
    ),
    (
        "M12 · ⚑ **the card's words always *Task*** · the number read and never said — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 718 — `707` GAP-2: the reader also spells a project it is
        # handed (`elsewhere`, the sender's card). The defect planted is unchanged: *Task* always.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The card's opener word
        # is still read by `opened.number` (D-016 only dropped the `elsewhere` branch and the
        # `taskCalledIn` case), so the row's subject survives and the old `old` no longer exists.
        # The plant is re-cut on the two lines that remain, so the card always says 'Task' whatever
        # number is read.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The card's
        # words are still spelled in one place, `pieceSays` in relayed-turn.ts, which returns
        # `pieceLine(label, title)` or 'Piece' when no label is in view. The plant makes it always
        # answer 'Piece', the analogue of 'always Task'. Killed by
        # `what-main-now-hands-you.dom.test.ts`.
        [
            (RELAYED_TURN, "  return piece.label === undefined ? 'Piece' : pieceLine(piece.label, piece.title ?? null)\n", "  return 'Piece'\n"),
        ],
    ),
    (
        "M13 · 🔴 **the card draws it nowhere** · folded, joined, and not on screen — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        [(RELAYED_ENTRY, '<strong v-if="opened !== null" class="task" data-cy="relayed-task">',
          '<strong v-if="false" class="task" data-cy="relayed-task">')],
    ),
    (
        "M14 · ⚑ **the Events tab forgets the task** · the two streams cannot be joined by it — "
        "killed by `what-main-now-hands-you.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The Events tab
        # still prints the joining id on the user_turn line, now ' · gives <piece>' where it was ' ·
        # opened <taskId>'. The plant blanks it so the two streams cannot be joined by it. Killed by
        # `what-main-now-hands-you.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # Events tab still prints the piece a user_turn's words brief, but D-016c changed the
        # printed word from `gives` to `briefs` (a new brief is also a brief), so the old template
        # fragment matches nothing. The new anchor uses `briefs`, and the plant drops the fragment
        # so the two streams cannot be joined by the piece. Killed by
        # `what-main-now-hands-you.test.ts`.
        [
            (DESCRIBE_EVENT, "        event.piece === undefined ? '' : ` · briefs ${event.piece}`\n      } ${", "        ''\n      } ${"),
        ],
    ),
    # ── F-G4a · a recording names its own agent ──────────────────────────────────────────────
    (
        "M15 · 🔴 **a recording names nobody** · *this conversation* on a recording of ours — "
        "killed by `the-three-sentences-beside-the-cards.dom.test.ts`",
        [(READING, "  props.entry.profileId === undefined\n    ? null\n    : agentName(props.entry.profileId, props.identities ?? null),",
          "  props.entry.profileId === undefined\n    ? null\n    : null,")],
    ),
    (
        "M16 · ⚑ **the name not handed to the cards** · the replies named, the cards not — "
        "killed by `the-three-sentences-beside-the-cards.dom.test.ts`",
        [(READING, '      :own-agent="ownAgent"\n', "")],
    ),
    (
        "M17 · ⚑ **the replies headed with the provider** · *Ada to BroBot* over replies headed *claude* — "
        "killed by `the-three-sentences-beside-the-cards.dom.test.ts`",
        [(READING, "const who = computed(() => ownAgent.value ?? props.entry.provider)",
          "const who = computed(() => props.entry.provider)")],
    ),
    (
        "M18 · ⛔ **the invent-one trap** · a recording this app did not run named *BroBot* — "
        "killed by `the-three-sentences-beside-the-cards.dom.test.ts`",
        [(READING, "  props.entry.profileId === undefined\n    ? null\n",
          "  props.entry.profileId === undefined\n    ? agentName(null, props.identities ?? null)\n")],
    ),
    # ── F-R18 · one count, one sentence ──────────────────────────────────────────────────────
    (
        "M19 · 🔴 **the second half dropped** · *a piece of work may be missing* and nothing about a wrong state — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — Main's rule that the
        # sentence carries BOTH halves (missing work, or wrong state) is unchanged; D-017 only added
        # a sibling clause for skipped ledgers that reuses the same phrase. Anchoring on
        # `rowsUnreadSays`'s own return (the base sentence every surface still gets through
        # `unreadSays`) and dropping its second half reproduces the M19 defect everywhere the count
        # is nonzero.
        [
            (ROWS_UNREAD, '  return `${rowsOfTheRecord(count)} could not be read, so a piece of work may be missing here, or its state may be wrong.`', '  return `${rowsOfTheRecord(count)} could not be read, so a piece of work may be missing here.`'),
        ],
    ),
    (
        "M20 · ⛔ **a sentence at zero** · *0 rows could not be read* over a clean walk — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        [(UNREAD, "  if (!(count > 0)) return null\n", "  if (count < 0) return null\n")],
    ),
    (
        "M21 · ⚑ **the forest's line says nothing** · the lead over an empty sentence — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The forest still must
        # draw a `short` sentence for unread rows; the call site just switched from `rowsUnreadSays`
        # to the D-017 wrapper `unreadSays`. Same substitution (drop the call, draw `null`) plants
        # the identical 'the lead over an empty sentence' defect at its new call site.
        [
            (THE_FOREST, '      short: unreadSays(forest.nodes.rowsUnread, forest.nodes.ledgersSkipped),', '      short: null,'),
        ],
    ),
    (
        "M22 · ⚑ **the Work tab's line says nothing** — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — Same rule, same
        # substitution, at the Work tab's call site, which also moved from `rowsUnreadSays` to
        # `unreadSays`.
        [
            (WORK_GIVEN_OUT, '    short: unreadSays(reading.walk.rowsUnread, reading.walk.ledgersSkipped),', '    short: null,'),
        ],
    ),
    (
        "M23 · 🔴 **the Work tab's empty line over unread rows** · *has not given anybody work* beside *may be missing* — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — 678's own guard ('never
        # say gave-nobody-work over rows it could not read') survives; the compound just grew a
        # fifth D-017 conjunct for skipped ledgers. Dropping the original `!(rowsUnread > 0)`
        # conjunct (leaving the new ledgersSkipped one and `doubt === null` intact) reproduces the
        # exact original defect, distinct from 508 M11's doubt-guard drop.
        [
            (WORK_GIVEN_OUT, '    empty:\n      doubt === null &&\n      rows.length === 0 &&\n      !(reading.walk.rowsUnread > 0) &&\n      // ⚑ **D-017 · R8** — nor over a record it skipped whole.\n      !((reading.walk.ledgersSkipped ?? 0) > 0)\n        ? NOTHING_GIVEN_OUT\n        : null,\n', '    empty:\n      doubt === null &&\n      rows.length === 0 &&\n      // ⚑ **D-017 · R8** — nor over a record it skipped whole.\n      !((reading.walk.ledgersSkipped ?? 0) > 0)\n        ? NOTHING_GIVEN_OUT\n        : null,\n'),
        ],
    ),
    (
        "M24 · 🔴 **the band's *Assigned by it* count drawn by nothing** — `671`'s count, folded and dropped — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The band's 'Assigned by
        # it' count must still be drawn by the sentence helper; the call moved from `rowsUnreadSays`
        # to `unreadSays(gaveOut.short, gaveOut.skipped)`. Same drop-to-null substitution plants the
        # identical 'drawn by nothing' defect at the new call site.
        [
            (WORKING_TOGETHER, '    gaveOutShort: unreadSays(gaveOut.short, gaveOut.skipped),', '    gaveOutShort: null,'),
        ],
    ),
    (
        "M25 · 🔴 **the band's *Assigned to it* count drawn by nothing** — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — Same rule for the
        # 'Assigned to it' count, whose call site likewise moved to `unreadSays(tookIn.short,
        # tookIn.skipped)`.
        [
            (WORKING_TOGETHER, '    tookInShort: unreadSays(tookIn.short, tookIn.skipped),', '    tookInShort: null,'),
        ],
    ),
    (
        "M26 · ⚑ **the heading gone over a list that lost every row** · *here* names nothing — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing ui batch 1 · re-anchored in place, not retired — `a03bf2f0` drew the heading only
        # above the "rows could not be read" line (`v-if="view.gaveOutShort"`). The plant makes the
        # heading ask for a row too, so it vanishes over a list that lost every row while the
        # sentence that says *here* stays.
        [
            (
                BAND,
                '<p v-if="view.gaveOutShort" class="tgroup" data-cy="cast-tasks-heading">Assigned by it</p>',
                '<p v-if="view.tasks.length && view.gaveOutShort" class="tgroup" data-cy="cast-tasks-heading">Assigned by it</p>',
            )
        ],
    ),
    (
        "M27 · 🔴 **the stalled walk's count dropped** · the band draws nothing for rows it could not read — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The stalled band must
        # still draw a count for rows it could not read; the assignment moved from `short:
        # rowsUnreadSays(...)` to `short: unreadSays(stalledWorkForAPerson.rowsUnread,
        # stalledWorkForAPerson.ledgersSkipped)`. Deleting the whole (now two-argument) line
        # reproduces the exact original 'count dropped' defect.
        [
            (PERSONS_QUEUE, '    unread: !lastLookAnswered,\n    short: unreadSays(stalledWorkForAPerson.rowsUnread, stalledWorkForAPerson.ledgersSkipped),\n', '    unread: !lastLookAnswered,\n'),
        ],
    ),
    (
        "M28 · 🔴 **the queue does not open for the count alone** · an all-clear over rows nobody read — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The two clauses
        # (`stalled?.unread`, `stalled?.short`) are untouched in substance, but D-017 appended a new
        # final disjunct `(props.floating && asksSaySomething)` to the same `v-if`, so
        # `!!stalled?.short` is no longer the last clause and now carries a trailing `||` — the
        # row's old anchor (no trailing `||`) no longer matches. The rule (the queue must open for
        # the stalled count alone, not just for rows) is unchanged.
        [
            (PERSONSQUEUE, '      stalled?.unread === true ||\n      !!stalled?.short ||\n', ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The plant sits in
        # `apps/desktop/src/renderer/src/lib/project-roster.ts`, which D-016 deleted with the
        # project room (commit bd70d693: 'the project rooms, board, sheet and picker ... are
        # removed'). There is no project-room count left for any sentence to carry, so the row has
        # no subject to re-anchor. Its anchor is left stale, so the census records it retired.
        "M29 · ⚑ **the project room's count in no sentence** — "
        "killed by `what-main-now-hands-you.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The project room must
        # still draw a sentence for `unread`; its call site also moved to
        # `unreadSays(walk.rowsUnread, walk.ledgersSkipped)`. Same drop-to-null substitution plants
        # the identical 'count in no sentence' defect, and `what-main-now-hands-you.test.ts` still
        # asserts `view?.short` equals the sentence helper's output.
        [
            (PROJECT_ROSTER, '    short: unreadSays(walk.rowsUnread, walk.ledgersSkipped),', '    short: null,'),
        ],
    ),
    # ── R26 · the draft survives the reopen ──────────────────────────────────────────────────
    (
        "M30 · 🔴 **the hold kept nothing** · a reopen from the grant sheet deletes the other conversation's draft again — "
        "killed by `a-reopen-keeps-the-draft.test.ts`",
        [(DRAFTS, "        ...holding.map(draftKey),\n", "")],
    ),
    (
        "M31 · 🔴 **a refused reopen's wait keeps nothing** · the person asked for a reopen, and lost their typing — "
        "killed by `a-reopen-keeps-the-draft.test.ts`",
        [(DRAFTS, "        ...waiting.map(draftKey),\n", "")],
    ),
    (
        "M32 · ⛔ **the wait never parked** · a refused reopen releases the hold into an ordinary sweep — "
        "killed by `a-reopen-keeps-the-draft.test.ts`",
        [(DRAFTS, "        if (!back && !open().some((each) => each.sessionId === sessionId)) untilOpen.add(sessionId)\n", "")],
    ),
    (
        "M33 · ⛔ **the wait never released** · once open again, an ordinary close no longer takes the draft (`019`) — "
        "killed by `a-reopen-keeps-the-draft.test.ts`",
        [(DRAFTS, "        if (live.some((each) => each.sessionId === sessionId)) untilOpen.delete(sessionId)\n", "")],
    ),
    (
        "M34 · ⚑ **overlapping holds released by the first** · a count read as a flag — "
        "killed by `a-reopen-keeps-the-draft.test.ts`",
        [(DRAFTS, "        if (left === 0) held.delete(sessionId)\n        else held.set(sessionId, left)\n",
          "        held.delete(sessionId)\n")],
    ),
    (
        "M35 · 🔴 **the screen's gesture outside the hold** · the rule in `lib`, and the screen not using it — "
        "killed by `a-grant-that-waits-for-the-next-launch.test.ts`",
        # ⚠️ **Corrected by `678`'s review** — the first cut replaced the opener alone, so the gesture
        # was RETURNED and never called: a larger defect than the label names. ⚑ Now the gesture runs,
        # close and resume both, with no hold — exactly *outside the hold*.
        [(SCREEN, "  return draftSweep.reopening(sessionId, async () => {\n",
          "  return ((_id: string, gesture: () => Promise<boolean>) => gesture())(sessionId, async () => {\n")],
    ),
    (
        "M36 · 🔴 **the draft row back to *lost*** · the table says the reopen clears it, under a sentence that says it keeps it — "
        "killed by `what-a-reopen-costs.test.ts`",
        [(REOPENING, "    what: 'what is typed or attached in the message box',\n    becomes: 'kept',",
          "    what: 'what is typed or attached in the message box',\n    becomes: 'lost',")],
    ),
    # ── §3 · the control, by the words on it ─────────────────────────────────────────────────
    (
        "M37 · 🔴 **the refusal back to *the rail*** · a word nothing in this app is labelled — "
        "killed by `what-main-now-hands-you.test.ts`",
        [(STORE, "          return `There is no agent identity called ${profileId}, so there is nothing to configure. Create it ${WHERE_AGENTS_ARE_CREATED}, or one appears once a conversation has run as it.`\n        }\n        // ⛔ **Patched FIRST",
          "          return `There is no agent identity called ${profileId}, so there is nothing to configure. Create it from the rail, or one appears once a conversation has run as it.`\n        }\n        // ⛔ **Patched FIRST")],
    ),
    (
        "M38 · ⚑ **the label and the button apart** · the sentence names a control the page draws in other words — "
        "killed by `what-main-now-hands-you.test.ts`",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the create button became a shared primary button with its attributes and label on separate lines; the plant still types a label other than the constant the sentence names
        [(TEAM, "        data-cy=\"team-create\"\n        @click=\"emit('create')\"\n      >\n        {{ NEW_AGENT }}\n      </button>", "        data-cy=\"team-create\"\n        @click=\"emit('create')\"\n      >\n        Add agent\n      </button>")],
    ),
    (
        "M39 · ⚑ **the switch named by a word nothing carries** · *Press “” to switch it back on* — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        [(SHEET, "const switchIsCalled = computed(() => spawnSafetyView(store.identities.value, false)?.heading ?? '')",
          "const switchIsCalled = computed(() => '')")],
    ),
    (
        "M40 · ⚑ **the no-row sentence stops saying where** · *There is no agent identity* and nothing to do — "
        "killed by `what-main-now-hands-you.dom.test.ts`",
        [(SHEET, "      {{ WHERE_AGENTS_ARE_CREATED }}, or one appears once a conversation has run as it.",
          "      somewhere, or one appears once a conversation has run as it.")],
    ),
    # ── §4 · the material re-reads, one at a time ────────────────────────────────────────────
    (
        "M41 · 🔴 **the workspace read unwrapped** · 155 ms per `conversations` announcement, six in an ending — "
        "killed by `one-read-at-a-time.test.ts`",
        [(SCREEN, "const readTheWorkspace = oneReadAtATime(readTheWorkspaceOnce)",
          "const readTheWorkspace = readTheWorkspaceOnce")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `readTheRoom` / `readTheRoomOnce` no
        # longer exist in `RuntimeScreen.vue`: the room read was the project room's read, and D-016
        # removed the project rooms. The plant's `old` has count 0 and there is no other
        # one-read-at-a-time wrapper for this call to re-anchor on. Its anchor is left stale, so the
        # census records it retired.
        "M42 · 🔴 **the room read unwrapped** · 88 ms per announcement while a room is on screen — "
        "killed by `one-read-at-a-time.test.ts`",
        [(SCREEN, "const readTheRoom = oneReadAtATime(readTheRoomOnce)",
          "const readTheRoom = readTheRoomOnce")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `void readTheRoom()` call that the
        # conversations arm made is gone together with `readTheRoom` when D-016 removed the project
        # rooms. The reads-per-act pin has nothing left to name here, so the row is retired rather
        # than re-cut. Its anchor is left stale, so the census records it retired.
        "M43 · ⚑ **the conversations arm stops reading the room** · the table §2 feeds says it does — "
        "the source pin `678`'s review found running to the end of the file — "
        "killed by `reads-per-act.test.ts`",
        [(SCREEN, "      void readTheRoom()\n", "")],
    ),
    (
        "M44 · ⚑ **the conversations arm stops reading the workspace** — "
        "killed by `reads-per-act.test.ts`",
        [(SCREEN, "      void readTheWorkspace()\n", "")],
    ),
    (
        "M45 · 🔴 **stopped work never reaches Waiting on you** · the page mounts the queue for requests "
        "and walls only, so the stalled band — and its unread-rows line — is read on no page a person "
        "goes to (`678`'s review) — killed by `one-count-one-sentence.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The old `providersSaySomething || stallSaysSomething` gate was rewritten by UI-009.
        # WaitingOnYou.vue now mounts the queue under `<template v-if="personsRows > 0 ||
        # attention.unread || stallSaysSomething">`, so the rule that stopped work reaches Waiting
        # on you survives and the plant drops its last disjunct. The label's unread-rows line now
        # also opens the page through `attention.unread` (mayBeShort), so what the plant loses is
        # the stalled-work-alone case. Killed by `one-count-one-sentence.dom.test.ts`.
        [
            (WAITINGONYOU, '<template v-if="personsRows > 0 || attention.unread || stallSaysSomething">', '<template v-if="personsRows > 0 || attention.unread">'),
        ],
    ),
    (
        "M46 · 🔴 **the page calls itself quiet over the stall line** · *The workspace is quiet* directly "
        "above *a piece of work may be missing here* (`678`'s review) — "
        "killed by `one-count-one-sentence.dom.test.ts`",
        # ⚠️ **Re-aimed at the queue's one field** — the first cut named the holes at the page's call
        # site, and `persons-queue.test.ts` §9.6 refused it: both call sites read ONE derived field.
        [(f"{LIB}/persons-queue.ts",
          # ⚑ **W4.584 · re-anchored in place, not retired** — the stopped band's two holes follow the stall band's in the queue's one field; the plant still drops the stall band's holes from it
          "      stalled.value?.unread === true ||\n      (stalled.value?.short ?? null) !== null ||\n      stopped",
          "      stopped")],
    ),
]
