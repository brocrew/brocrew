"""732 · a retry that works, and names, not folders — `681` F-a, `729` F-1, `730` F-4.

⛔ **Ordered by the PM** (the closing wave, #4): `681` F-a (under R30b, a caller told *not started*
retried into `agent-already-has-work-open` — the receiver's open work answered only after the start),
`729` F-1 (under R41, the stalled-work band named the holder and the giver by their FOLDER) and `730`
F-4 (`work_interrupted` carried the asker's session id alone, so a transcript could not name it).

## ⚠️ What a row here measures

 * ⚑ **M1–M6 are `681` F-a** — `message_agent`'s gate asks a STARTING receiver's open work
   before *not started* (M1), for a starting receiver only (M2: asked of a running one it answers
   ahead of the held-message rail, criterion 13), about THIS caller's work when the receiver takes
   work from many (M3), for work and not a question (M4), for nobody's words but an agent's work (M5),
   and after the policy walls (M6) — killed by `a-retry-that-works-and-names-not-folders.test.ts` §1, and
   M2 by the held-message rail's own tests.
 * ⚑ **M7–M8 are `729` F-1** — the band names the giver (M7) and the holder (M8) by identity, not by
   the folder `nameForAPerson` read (`folderOf` since `734`) — killed by §2. ⚑ `557 M7` (the id handed back) and `729 M25`
   (a memo outliving one look) hold the other two ways the naming can fail.
 * ⚑ **M9–M12 are `730` F-4** — the ask records WHO asked, the identity beside the conversation (M9),
   as the slug and never a display name frozen onto the row (M10, `relayedFromProfile`'s rule); and
   the store's door keeps it only by the slug's own rule (M11) and only beside a conversation (M12)
   — killed by §3. ⚑ **M14**: a person's ask given an identity at the WRITER — the store's door strips
   it from the persisted copy (no conversation beside it), so only the LIVE row shows it, and §3.3
   asserts that row too (`732`'s review, round two).
 * ⚑ **M13 is `732`'s review** — at ONE-caller breadth any open work refuses anybody, so a second
   caller reaching a starting child is refused for the parent's piece — killed by §1.6.

## ⛔ What has NO row here, and why

 * ⚠️ **`545 M20`** (the relayer's bound taken out of `boundStoredEvent`'s chain) now also takes out
   this dispatch's asker bound, which is an arm of the same function — M11 and M12 measure it on
   their own.
 * ⚠️ **Work a MESSAGE is starting the receiver with** (`startWhatTheQuitClosed`, found by `732`'s
   review) — not read at all, and stated on `refuseWorkAStartingReceiverHolds`: there is no code to
   mutate.
 * ⚠️ **The person half of the guard alone** (`giver === null`) — measured an EQUIVALENT: the first
   M5 dropped it alone and SURVIVED. `queueMessage`'s `says` is read only for an agent, and only
   `message_agent` passes one; every other caller — a person's window, the app's own replies and
   notices — declares `MESSAGE_KIND_WHEN_UNSAID`, which is `question`, so `OPENS_A_TASK` returns
   first. ⚑ The half stays as `workBeingAssigned`'s own first question, spelled where the breadth
   needs a giver; M5 now deletes the whole guard, which §1.4 and §1.2 see.
 * ⚠️ **The prose rows** — docblocks, which no test reads (standing rule 19).
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
SPAWN_RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
RETRY = "a-retry-that-works-and-names-not-folders.test.ts"
HELD = "a-question-is-not-work.test.ts"

THE_GATE = (
    "      this.assertMayReach('message', sessionId, by)\n"
    "      takesWorkFrom = this.howManyCallersItTakesWorkFrom(receiver.id)\n"
    "      this.assertMayAssign(sessionId, by, says, takesWorkFrom)\n"
    "      if (stillStarting(receiver)) {\n"
    "        this.refuseWorkAStartingReceiverHolds(receiver.id, by, says, takesWorkFrom)\n"
    "      }\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · `681` F-a — a starting receiver's open work, before *not started* ────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The defect was a parent told 'not
        # started' whose retry then met agent-already-has-work-open. D-017 R1 (45a11477) says:
        # '"Still starting" and "still closing" are no longer refusals: the delivery waits out the
        # start', so no state produces that answer. The gate's `if (stillStarting(receiver))` branch
        # in queueAs is dead code (queueAs runs only on a running receiver), and the arrival rail
        # that replaced it (refuseBeforeAStart) is covered by 692 M14/M15/M17. Its anchor is left
        # stale, so the census records it retired.
        "M1 · 🔴 `681` F-a back · the gate no longer asks a STARTING receiver's open work, so a parent "
        "that woke its child and gave it more is told *not started* — and the retry meets "
        f"`agent-already-has-work-open` · killed by `{RETRY}`",
        [(HOST, "      if (stillStarting(receiver)) {\n        this.refuseWorkAStartingReceiverHolds(receiver.id, by, says, takesWorkFrom)\n      }\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label's premise is a running
        # receiver where the open-work rail 'answers ahead of the held-message rail' (criterion 13).
        # D-010 removed that held-message rail, so there is nothing for it to answer ahead of. The
        # `stillStarting(receiver)` branch this row edited is also unreachable since D-017 R1, so
        # the plant has no behaviour to change. Its anchor is left stale, so the census records it
        # retired.
        "M2 · ⛔ the rail is asked of a RUNNING receiver in the gate too · it then answers ahead of the "
        "held-message rail, and a caller whose own work is held is told *work is open* where criterion "
        f"13 names the held message · killed by `{HELD}`",
        [(HOST, "      if (stillStarting(receiver)) {\n", "      if (receiver.session !== undefined) {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's defect is 'ANY open work
        # refuses a receiver that takes work from many callers', which is now the rule by design.
        # D-016a (bd70d693) removed takes_work_from end to end: 'takes_work_from (the one-open-task
        # rail now refuses on any open task)'. Refusing on any open task is the decision, not a
        # defect. Its anchor is left stale, so the census records it retired.
        "M3 · ⛔ ANY open work refuses a starting receiver that takes work from many callers · another "
        f"caller is refused where its running self is admitted · killed by `{RETRY}`",
        [(HOST, "    const held = this.workAlreadyOpenIn(receiver, breadth === 'one-caller' ? null : giver)\n", "    const held = this.workAlreadyOpenIn(receiver, null)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The one-open-piece rail on a
        # work message went with the work message: `message_agent` is now "a note or a follow-up
        # naming a piece", and `refuseBeforeAStart` reads no open work at all. The killer's own
        # comment says "§1.1 and §1.3 are gone with their subject (D-016) ... both rails left with
        # the work message." Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ a QUESTION meets the rail · the investigate half is refused for as long as the start "
        f"takes (HO-021 §1) · killed by `{RETRY}`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # QUESTION (HO-021 §1, the investigate half) never meets the one-piece-of-work rail, even
        # before a start. The guard `!OPENS_A_TASK[says]` moved into refuseBeforeAStart, the arrival
        # rail for a conversation that is not running (D-017 R1). Making that rail ask every message
        # refuses §1.2's question to the woken child at once, so it no longer waits for the start.
        [
            (HOST, '      if (OPENS_A_TASK[says]) {\n        const open = this.workAlreadyOpenIn(sessionId)\n', '      {\n        const open = this.workAlreadyOpenIn(sessionId)\n'),
        ],
    ),
    (
        "M5 · ⛔ no guard at all · anybody's words meet the agent's rail — a person typing while their "
        "Reopen starts the child is refused *work is open* over work an agent gave, and so is a "
        f"question · killed by `{RETRY}`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # rail is about work an AGENT gives, and a person's words to a conversation being started
        # never meet it. In refuseBeforeAStart that guard is structural, because the person's branch
        # returns before the open-work read. Planting the read ahead of that return makes a person
        # typing into a child their Reopen is starting meet the agent's rail, which is the label's
        # defect.
        [
            (HOST, '    if (theSurfaceAsking(by) === null) return\n    if (!hasSomethingToSend(text, attachments.length)) throw new Error(NOTHING_TO_SEND)\n', '    const heldWork = this.workAlreadyOpenIn(sessionId)\n    if (heldWork !== null) throw new WorkAlreadyOpen(heldWork.taskId, heldWork.number)\n    if (theSurfaceAsking(by) === null) return\n    if (!hasSomethingToSend(text, attachments.length)) throw new Error(NOTHING_TO_SEND)\n'),
        ],
    ),
    (
        "M6 · ⛔ the open work answers BEFORE the walls · a parent a person narrowed to giving no work "
        f"is told to withdraw or ask about work it may no longer give · killed by `{RETRY}`",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The order survives: walls (reach,
        # then assignment) before a starting receiver's open-work read. A parent a person narrowed
        # with `canAssignWork: 'none'` still exists after D-014. Re-verified RED alone.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # walls (reach, then the assignment wall) answer BEFORE the receiver's open work, so a
        # parent narrowed to giving no work is not told to withdraw work it may no longer give. That
        # order now lives in refuseBeforeAStart's agent branch. Moving the open-work read above
        # assertMayReach and assertMayAssign reverses it, and the killer's §1.5 and §1.3 see
        # agent-already-has-work-open where a wall's rail is expected.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # the walls (the `mayGiveWork` grant) answer before the stall rule survives; `admitGive`
        # still asks step 3 (wall) before step 6 (`its-work-has-stalled`). The plant asks the stall
        # rule of the found conversation before the wall refusal is returned, so a caller without
        # the grant and with a stalled helper is told `its-work-has-stalled`. Killed by
        # `a-retry-that-works-and-names-not-folders.test.ts`.
        [
            (SPAWN_RAILS, '  // 3 · the grant on giving, asked of the caller alone.\n  const wall = facts.mayGiveWork()\n  if (wall !== null) return { ok: false, refusal: wall }\n', "  // 3 · the grant on giving, asked of the caller alone.\n  const wall = facts.mayGiveWork()\n  const foundEarly = facts.helperAs(giving.sessionId, asked.profile)\n  if (foundEarly !== null) {\n    const stalledEarly = facts.stalledIn(foundEarly)\n    if (stalledEarly.length > 0) {\n      return no('its-work-has-stalled', { profileId: asked.profile, stalled: stalledEarly })\n    }\n  }\n  if (wall !== null) return { ok: false, refusal: wall }\n"),
        ],
    ),
    # ── §B · `729` F-1 — the band's holder and giver, by name ────────────────────────────────────
    (
        "M7 · 🔴 `729` F-1 back for the GIVER · the band says *\"…and brobot-workspace — which gave it "
        f"out —\"* · killed by `{RETRY}`",
        # ⚠️ **734 · RE-ANCHORED, the subject unchanged**: `nameForAPerson` names the agent since `734`
        # and takes the roster; the folder read is `folderOf`, which is what this plants.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Words the
        # model reads must name the giver by its name, not its folder; the `giverName` a piece
        # carries is still composed with `whatToCall(piece.giver)`. The plant puts the folder in its
        # place, which is the defect the label names. Killed by
        # `a-retry-that-works-and-names-not-folders.test.ts`.
        [
            (HOST, '            giverName: whatToCall(piece.giver),\n', '            giverName: this.folderOf(piece.giver),\n'),
        ],
    ),
    (
        "M8 · 🔴 `729` F-1 back for the HOLDER · the band says *\"…with brobot-workspace is not being "
        f"worked on\"* · killed by `{RETRY}`",
        # ⚠️ **734 · RE-ANCHORED**, as M7.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The owner side
        # of the same rule survives: `ownerName` is composed with `whatToCall(piece.owner)`, and a
        # folder in its place is a model-visible word that names a folder. The plant swaps in the
        # folder. Killed by `a-retry-that-works-and-names-not-folders.test.ts`.
        [
            (HOST, '            ownerName: whatToCall(piece.owner),\n', '            ownerName: this.folderOf(piece.owner),\n'),
        ],
    ),
    # ── §C · `730` F-4 — the ask says WHO asked ───────────────────────────────────────────────────
    (
        "M9 · 🔴 `730` F-4 back · the ask records the asker's conversation alone, so no surface can "
        f"NAME the agent (since `737` the transcript says only *an agent*) · killed by `{RETRY}`",
        # ⚠️ **734 · RE-ANCHORED, the subject unchanged**: the identity comes from ONE builder now
        # (`theIdentityThatAsked`, shared with `stop_unanswered`), so the ask drops its spread.
        [(HOST, "      ...this.theIdentityThatAsked(actor),\n", "")],
    ),
    (
        "M10 · ⛔ a DISPLAY NAME where the identity goes · the row freezes *Grace*, and after a rename the "
        f"transcript names one agent two ways (`relayedFromProfile`'s rule) · killed by `{RETRY}`",
        # ⚠️ **734 · RE-ANCHORED, the subject unchanged** — in the one builder, so it freezes the name
        # onto `stop_unanswered` too, which `734`'s own §2 sees as well.
        [(HOST, "    return itsIdentity === null ? {} : { agentProfile: itsIdentity.profileSlug }\n",
          "    return itsIdentity === null\n      ? {}\n      : { agentProfile: agentName(itsIdentity.profileSlug, this.deps.store.agentIdentities()) }\n")],
    ),
    (
        "M11 · ⛔ the replay bound keeps what is not a slug · an imported ledger puts any words where a "
        f"person will read a name · killed by `{RETRY}`",
        [(STORE, "    if (typeof asker === 'string' && isPathSegment(asker) && typeof event.agent === 'string') {\n",
          "    if (typeof asker === 'string' && typeof event.agent === 'string') {\n")],
    ),
    (
        "M12 · ⛔ the replay bound keeps an identity with no conversation beside it · a row names an "
        f"agent nothing can join on · killed by `{RETRY}`",
        [(STORE, "    if (typeof asker === 'string' && isPathSegment(asker) && typeof event.agent === 'string') {\n",
          "    if (typeof asker === 'string' && isPathSegment(asker)) {\n")],
    ),
    # ── §D · `732`'s review — the one-caller half of the breadth ─────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** It plants the one-caller breadth
        # distinction (`breadth === 'one-caller' ? null : giver`) on a starting receiver. D-016a
        # deleted `takes_work_from`, `howManyCallersItTakesWorkFrom` and the `giver` argument, and
        # `workAlreadyOpenIn(sessionId)` now takes one argument and reads any open task. There is no
        # breadth left to get wrong. Its anchor is left stale, so the census records it retired.
        "M13 · 🔴 a starting ONE-CALLER receiver refuses only the caller's own work · a second caller "
        "reaching it is told *not started*, and its retry meets the parent's open work — `681` F-a again "
        f"· killed by `{RETRY}`",
        [(HOST, "    const held = this.workAlreadyOpenIn(receiver, breadth === 'one-caller' ? null : giver)\n",
          "    const held = this.workAlreadyOpenIn(receiver, giver)\n")],
    ),
    (
        "M14 · ⛔ a PERSON's Stop is written with an identity · the writer names the stopped worker "
        "itself, and the live window is told an agent asked — the stored copy is stripped, so only the "
        f"live row shows it · killed by `{RETRY}`",
        # ⚠️ **734 · RE-ANCHORED, the subject unchanged**: the builder takes the actor alone, so the
        # defect is planted where the ask calls it — the stopped conversation handed in as the asker.
        [(HOST, "      ...this.theIdentityThatAsked(actor),\n",
          "      ...this.theIdentityThatAsked(\n        actor.who === 'an-agent'\n          ? actor\n          : { who: 'an-agent', agent: typeof session === 'string' ? session : session.id },\n      ),\n")],
    ),
]
