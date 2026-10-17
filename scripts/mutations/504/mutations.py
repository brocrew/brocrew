"""504 · the row he cannot press — `472` F1, both halves, and the bottom he has to find.

⛔ **What this table is aimed at.** `504` made four rules and every one of them is a rule a mutation
can delete while the compiler stays quiet:

 1. **The sentence that was false.** `SessionStore.find` drops a row with no usable provider ref —
    its own docblock says so since `172` — and `RuntimeHost.reopenSession` read that as *nothing was
    recorded*. `M1`–`M6` are the ways the repair rots: the false sentence restored, the row's own
    reason dropped or re-composed, and the refusal's two arms swapped.
 2. **The two fields, carried and never re-decided.** `reopenRefusalOf` is the expression the
    Library and the reopen list already share, and `504` gave it a third reader. `M7`–`M10` reopen
    each place a second opinion could grow.
 3. **The press.** The band asks `closed-threads.ts`'s own predicate and draws `taking-over.ts`'s own
    words. `M11`–`M16` are the four gestures collapsed, mis-ordered, or given a sentence that belongs
    to a different act.
 4. **The first anchor.** `useStickToBottom` followed CHANGES and never anchored at the START.
    `M17`–`M18` take the anchor away and take the rule away, which are opposite failures.
 5. **The age.** A poll that draws a plate must say how old the plate is. `M19`–`M20`.

🔴 **The fail-safe direction, stated once.** ⛔ Every row here fails TOWARD a confident false
sentence or a press that cannot work — a reopen offered on a row that will be refused, a refusal that
names the wrong reason, a live conversation wearing a recording's excuse. ⚑ That is the direction
`472` F1 was written about and the reason `472` chose silence over a guess.

⚠️ **`413 §4`'s rule is NOT in this table and its absence is deliberate.** Nothing `504` added draws
an id; the presses draw `taking-over.ts`'s sentences and the refusal draws the store's. A row
asserting *the id stays off this surface* would be a row nothing can make fail here.

⛔ **Four things this table deliberately does not contain.**
  · **No row for `readableRef`.** It is one derivation replacing two spellings of one fact; a
    mutation that inlines either spelling back is still the same verdict, which is
    `a-true-mutation-measures-nothing`.
  · **No row for `HAS_EVENTS_COLUMN`'s extraction.** Same shape: the SQL is byte-identical either
    way. ⚑ What IS killable is the `coalesce` inside it, and `M10` is that.
  · **No row for the Sessions page's *Resume* wording.** `504` found that disagreement and did not
    change it (`301` §5); a row here would pin a sentence this dispatch does not own.
  · **No row for a reopen's in-flight state on the band.** There is none to delete — it is reported
    on the rail row and the library row, and the response names the gap rather than half-closing it.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer files run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
REFUSAL = "apps/desktop/src/main/runtime/session-unavailable.ts"
ROSTER = "apps/desktop/src/renderer/src/lib/project-roster.ts"
THREADS = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
FOLLOW = "apps/desktop/src/renderer/src/composables/useStickToBottom.ts"
TEAM_ROSTER = "apps/desktop/src/renderer/src/lib/team-roster.ts"

# ⚑ The repair itself, whole — the two lines `472` F1's second half exists to have written.
THE_DOOR = (
    "      const recorded = this.deps.store.recordedOne(sessionId)\n"
    "      if (recorded === null) {"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the sentence a person reads when a reopen is refused ────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · `find` is read as *is this recorded* again, so a conversation "
        "this app placed and lost before its provider answered the handshake is told *\"There is no "
        "recording of this conversation to reopen\"* — about a row whose ledger it is holding and "
        "whose transcript the Sessions page opens (`472` F1, second half)",
        [(HOST, THE_DOOR, "      const recorded = null as RecordedSession | null\n      if (recorded === null) {")],
    ),
    (
        "M2 · ⛔ the row's REASON is dropped and the fallback always speaks · the refusal is no longer "
        "false and it is no longer useful either — `086`'s *the reason is the interesting part*, and "
        "the fallback exists for a case this arm cannot reach",
        [(HOST, "        { refusal: recorded.unresumableReason ?? undefined },", "        {},")],
    ),
    (
        "M3 · ⚠️ the boundary composes a SEVENTH sentence of its own · the exact thing "
        "`UnavailableContext.refusal` exists to prevent, and it arrives looking like a tidy-up: one "
        "hand-written sentence beside the store's six, free to explain a row differently from the "
        "list that refuses to offer it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives:
        # UnavailableContext.refusal is the single sentence source, and the boundary composes no
        # seventh sentence of its own. D-017b only changed the lead from 'did not reopen' to 'could
        # not continue', so the fallback line is now `BroBot2 could not continue this conversation:
        # ${said}.`; the plant swaps it for a hand-written sentence that drops the row's own reason.
        [
            (REFUSAL, '        : `BroCrew could not continue this conversation: ${said}.`', "        : 'BroCrew could not continue this conversation.'"),
        ],
    ),
    (
        "M4 · 🔴 the new code answers with the OLD code's sentence · one code, one sentence — this "
        "file says so three times — so sharing the words is sharing the lie `118`, `214` and `336` "
        "each refused in turn",
        [(REFUSAL, "      const said = context.refusal",
          "      return 'There is no recording of this conversation to reopen.'\n      const said = context.refusal")],
    ),
    (
        "M5 · ⛔ `canReopen` stops asking whether resume has an ADDRESS · a row whose ref is null or "
        "no longer parses is reported reopenable, so `reopenRefusalOf` takes the wrong arm and the "
        "band offers a press the host will refuse",
        [(STORE, "  return hasSomewhereToReopen(row) && readableRef(row) !== null",
          "  return hasSomewhereToReopen(row)")],
    ),
    (
        "M6 · ⚠️ the refusal fork loses its second arm · an app-owned adopted CHILD that CAN be "
        "reopened stops saying *another agent drove it, so there is no input end* — `118`'s measured "
        "defect, restored one function up from where it was fixed",
        [(STORE, "  return canReopen(row) ? whyNoDirectInput(row) : whyNotResumable(row)",
          "  return canReopen(row) ? null : whyNotResumable(row)")],
    ),
    # ── §2 · the two fields, carried rather than re-decided ──────────────────────────────────────
    (
        "M7 · 🔴 the store says nothing refuses a reopen · every recording on the band draws *Reopen "
        "the conversation*, including the ones the host refuses — which is `472`'s guess with the "
        "fields present and ignored",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The roster row that
        # carried `reopenRefusal` (`conversationsInProject`) was deleted, but the same refusal is
        # still carried by the Library's own row: `recordedOf` sets `unresumableReason:
        # reopenRefusalOf(row)`. D-016 re-pointed the-row-he-cannot-press tests at `recordedOne` for
        # exactly this, so the rule 'the store carries the row's own refusal' holds and is
        # re-planted there.
        [
            (STORE, '    unresumableReason: reopenRefusalOf(row),', '    unresumableReason: null,'),
        ],
    ),
    (
        "M8 · ⛔ every row claims to hold a transcript · a conversation with no ledger is offered "
        "*Read the recording* and opens an empty pane — `106`'s unwired control, and the row that "
        "should say *nothing of it was recorded* instead says nothing at all",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The roster row's
        # `hasTranscript: row.has_events !== 0` is gone, but the rule 'hasTranscript is the ledger
        # and not the row' survives in `describeRow`, which every recorded row spreads (D-016
        # comment in the test: 'asked of the Library's own read'). Planting `true` there makes every
        # recording claim a transcript. It is distinct from 151 M36 (false) and M37 (inverted). The
        # old 12-space anchor is gone and the 4-space line is now unique (count 1).
        [
            (STORE, '    hasTranscript: row.has_events !== 0,', '    hasTranscript: true,'),
        ],
    ),
    (
        "M9 · ⚠️ the HOST re-decides instead of carrying · the pair `recordedOf` promises can never "
        "disagree comes apart at the one boundary that was added to keep them together: a window is "
        "told a reopen is available while `reopenSession` refuses it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The old `reopenRefusal: row.reopenRefusal` carry was renamed: the
        # store's one answer (`reopenRefusalOf`, exposed as `unresumableReason`) is now handed to
        # the recorded hand-over's `describeUnavailable('cannot-be-reopened', { refusal: ... })`, so
        # the host still carries the row's sentence instead of re-deciding it. The plant drops it,
        # and `describeUnavailable` then falls to its generic sentence with no TypeError. It goes
        # red today on `adopt-sessions.test.ts` at
        # `expect(after.paneReason).toContain(after.refusal)`, because the pane says the generic
        # words while the reopen list and library still say the sub-agent sentence. The anchor is
        # unique in the file and no test change is needed.
        [
            (HOST, '              refusal: row.unresumableReason ?? undefined,', '              refusal: undefined,'),
        ],
    ),
    (
        "M10 · 🔴 `has_events` stops coalescing the generation · a session this app RAN rather than "
        "projected has no `derived_generation` row, so `g.active` is NULL, the EXISTS matches "
        "nothing, and the Read gesture leaves every row it is the answer for",
        [(STORE, "                                         AND events.generation = coalesce(g.active, 0)) AS has_events`",
          "                                         AND events.generation = g.active) AS has_events`")],
    ),
    # ── §3 · the four presses, and which act each one is ─────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b deletes `recordingGesture` and
        # the per-state gesture arms ('no Reopen / Take it over / Read the recording presses: one
        # press, "Open the conversation"'). The row's defect (the recording arm answering null, so
        # the row offers nothing) cannot be planted: `action` is unconditionally
        # OPEN_THE_CONVERSATION and the band test asserts no state can lack it. Its anchor is left
        # stale, so the census records it retired.
        "M11 · 🔴 `472`'s RULING restored with its premise gone · the recording arm answers `null` "
        "again, so the row a person came to the room to open goes back to offering nothing — the "
        "half of that ruling this dispatch was sent to end",
        [(ROSTER, "  return recordingGesture({ refusal: record.reopenRefusal, hasTranscript: record.hasTranscript })",
          "  return null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The subject (the order in which
        # `actionFor` asks the recording half versus the here-is half) is gone with `hereIsOf`,
        # `gestureOf` and `actionFor`. There is no gesture to choose per state any more, only
        # `action: OPEN_THE_CONVERSATION` on every row. Its anchor is left stale, so the census
        # records it retired.
        "M12 · ⛔ the recording half is asked FIRST · `421`'s rule inverted — a durable refusal is a "
        "fact about the RECORD, so a conversation this app is running right now is offered a reopen "
        "the host refuses because the id is live",
        [(ROSTER,
          "  if (here === 'nobody-is-watching') return 'take-over'\n"
          "  if (here === 'open-in-this-window') return 'open'\n"
          "  if (here === 'open-in-another-window') return null\n",
          "  if (here !== 'open-in-another-window')\n"
          "    return recordingGesture({ refusal: record.reopenRefusal, hasTranscript: record.hasTranscript })\n"
          "  if (here === 'nobody-is-watching') return 'take-over'\n"
          "  if (here === 'open-in-this-window') return 'open'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** project-roster.ts is deleted
        # (count_now -1); the-band-the-room-was-missing.test.ts says 'D-016 took the room out ...
        # every case about the band went with it'. No surface draws a per-row reopen refusal any
        # more. Its anchor is left stale, so the census records it retired.
        "M13 · ⚠️ the refusal is drawn on every row that has one · an app-owned adopted child that is "
        "WORKING wears *another agent drove it, so there is no input end to reopen* — the class "
        "`noteFor` calls *the most false sentence in this file*, one surface over",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # refusal is drawn only on a conversation nothing is running, and never on a row that is
        # working (no-input-end wording would be false there). The line moved from `recording ?
        # row.reopenRefusal : null` to `nothingRunsIt ? row.reopenRefusal : null`, and the band test
        # still asserts null for unwatched and in-a-window with the not-running control.
        [
            (ROSTER, '    refusal: nothingRunsIt ? row.reopenRefusal : null,', '    refusal: row.reopenRefusal,'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b deleted
        # `apps/desktop/src/renderer/src/lib/closed-threads.ts` (796 lines) together with
        # KeptOpenPane.vue and the open/closed/kept-open split of the rail and palette. The 'read'
        # predicate and the two surfaces it fed no longer exist (count_now -1: the file is gone).
        # Its anchor is left stale, so the census records it retired.
        "M14 · ⛔ the rail's predicate stops asking whether anything was recorded · `118`'s third "
        "case — *cannot, and we hold nothing* — collapses into *read*, and `106`'s row that can do "
        "nothing at all becomes a button onto an empty pane on BOTH surfaces at once",
        [(THREADS, "  return row.hasTranscript ? 'read' : null", "  return 'read'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The two wordings this row confuses
        # (REOPEN_THE_CONVERSATION and the take-over's words) were removed: D-017b's commit message
        # says 'no Reopen / Take it over / Read the recording presses: one press, "Open the
        # conversation"'. There is no `case 'reopen'` left in the roster to plant. Its anchor is
        # left stale, so the census records it retired.
        "M15 · 🔴 the reopen wears the TAKE-OVER's words · the two acts the PO asked to be kept apart "
        "— *Take it over and open it* is `claimSession` on a live conversation and a reopen is a "
        "launch — said as one sentence, which is criterion 20 broken in the direction that promises "
        "an adoption the press does not perform",
        [(ROSTER, "    case 'reopen':\n      return REOPEN_THE_CONVERSATION",
          "    case 'reopen':\n      return openingAction(false)")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b removed the `ended` facet from
        # the roster's plate input: SessionFacetInput has no `ended` and `told` is {phase, status,
        # activity, streaming, liveness}. The band test's new docblock reads 'the plate says nothing
        # about whether anything runs (05 rule 5)... a plate no longer draws one', and asserts two
        # rows of one status and two running states now draw ONE plate, the opposite of what this
        # row protected. Its anchor is left stale, so the census records it retired.
        "M16 · ⚠️ the plate is drawn off the COLUMN · `421` verbatim — `settleOrphanRuns` settles a "
        "crashed run to `idle`, so a live conversation and one a power cut ended three weeks ago "
        "wear the same avatar in the room a person judges the project from",
        # ⚑ **Anchor corrected at `588`**: the plate's inputs were hoisted out of the returned
        # object into a named `SessionFacetInput` (so ONE object feeds both the plate and the doing
        # word), which changed this line's indent from six spaces to four. ⛔ The SUBJECT is
        # untouched — `421` verbatim, the plate is the HOST's answer and never the column.
        [(ROSTER, "    ended: recording,", "    ended: row.status === 'ended',")],
    ),
    # ── §4 · the bottom, and the freshness of what is above it ───────────────────────────────────
    (
        "M17 · 🔴 THE DEFECT `504` §3 measured · the anchor at mount is gone, so a conversation whose "
        "transcript is already there opens at its FIRST line — measured at `scrollTop` 0 over a "
        "`scrollHeight` of 3 875, which is 3 375px above the words the person opened it for",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The mount anchor survives, but UI-006's 0f645e2f turned `onMounted(toNewest)` into a
        # callback that calls `toNewest()` and then starts a ResizeObserver, so the one-line anchor
        # is dark. The rule (a transcript already there at mount opens at its newest line) is
        # unchanged. The plant removes the mount-time `toNewest()` call only; the ResizeObserver
        # callback is delivered at the next frame, after the killer's single `await nextTick()`, so
        # the first assertion still sees scrollTop 0. Killed by
        # `the-bottom-he-has-to-find.dom.test.ts`.
        [
            (FOLLOW, "    toNewest()\n    if (el.value && typeof ResizeObserver !== 'undefined') {\n", "    if (el.value && typeof ResizeObserver !== 'undefined') {\n"),
        ],
    ),
    (
        "M18 · ⛔ the follow stops asking whether the reader is still at the bottom · the opposite "
        "failure to `M17` and the worse one: every new line yanks somebody who has scrolled up to "
        "read something, and `useOlderHistory`'s release stops being able to hold them",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives and is exercised by the same tests: the follow must not move a reader
        # who scrolled up. UI-011 (128203e6) and UI-006 rewrote the write into `toNewest`: `if
        # (stuck && node.scrollHeight - node.clientHeight - node.scrollTop >= 1) node.scrollTop =
        # node.scrollHeight`, so the old one-line anchor is dark. The plant drops the `stuck &&`
        # check and keeps the same-value guard. Killed by `the-bottom-he-has-to-find.dom.test.ts`,
        # `older-history.dom.test.ts`.
        [
            (FOLLOW, '    if (stuck && node.scrollHeight - node.clientHeight - node.scrollTop >= 1)\n', '    if (node.scrollHeight - node.clientHeight - node.scrollTop >= 1)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `< ROSTER_EVERY_MS` age threshold
        # was the project room band's (project-roster.ts, deleted); its test cases went with the
        # room. The Team page's `asOf` has no such threshold and the other thresholds
        # (working-together, live-signal) already have their own rows (547 and others). Its anchor
        # is left stale, so the census records it retired.
        "M19 · ⚠️ the age line loses its threshold · *Read 0s ago* on every paint of every room, "
        "which is the line stopping being information and becoming furniture — and the threshold is "
        "the poll's own cadence rather than a number somebody chose",
        [(ROSTER, "    asOf: input.now - reading.at < ROSTER_EVERY_MS ? null : agoWords(reading.at, input.now),",
          "    asOf: agoWords(reading.at, input.now),")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer: `the-team-page-says-how-old-its-reading-is.test.ts`
        # (the landing added it; no existing test observed this plant).
        "M20 · ⛔ the band stops saying how old its reading is · the plate stays and the sentence that "
        "makes it honest goes, so a surface that re-reads every thirty seconds looks exactly like the "
        "realtime one the person asked for and `467` §4 measured it cannot be",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule survives on the Team roster (`project-roster.ts` is gone):
        # `teamRoster` returns `asOf` and `TeamWorkspace.vue:600` draws it as `team-asof`. The plant
        # removes the sentence saying how old the reading is, and the anchor is unique. No test
        # asserts `asOf` today, because `the-avatar-is-the-status.test.ts` only mentions it in a
        # fixture comment even though its `team()` fixture already pins `now: AT` for that purpose.
        # The landing must add an assertion there, that `teamRoster(team({ beingDone: reading([], AT
        # - 90_000) })).asOf` equals `agoWords(AT - 90_000, AT)` and is not null, and that it is
        # null for `beingDone: null`. The plant is expected red on the first of those.
        [
            (TEAM_ROSTER, '    asOf: beingDone === null ? null : agoWords(beingDone.readAt, now),', '    asOf: null,'),
        ],
    ),
]
