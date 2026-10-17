"""690 · the wake says only what is true — `675` F-a and F-h, and PM ruling R32 (`673` F-1).

⛔ **Ordered by the PM**: `resume_agent` answered *running — message_agent reaches it* about a
conversation `message_agent` refuses (F-a), and told a caller that asked to wake ITSELF that *"a
conversation cannot give itself work"* (F-h); and R32 lets the app withdraw its own unread notice when
a later fact makes it false, under its own reason word (`retracted`), and say so.

## ⚠️ What a row here measures

 * ⚑ **M1–M6 are F-a**: the wake asking what a message would meet at all, each of the two guards it
   asks (the message door's own, in its order), the message door's `detail.said` carried whole, and
   the wake's own sentence with its load-bearing clause — killed by
   `the-wake-says-only-what-is-true.test.ts` §1.
 * ⚑ **M7 is F-h** — the self-wake told the table's give-work sentence again, killed by §2.
 * ⚑ **M8–M15 are R32** — the retraction at all, only for the parent that woke the child, every held
   notice rather than the first, the app's own word and its detail, the `its-own-wake` receipt that
   re-arms the next ending, a person's cancel keeping its own word, and the sentence's reason clause —
   killed by `what-a-wake-still-says-wrong.test.ts` §2.7, §2.14, §2.15 and §2.16.
 * ⚑ **M16–M20 were added for the review's findings**: reach before state, *running* asked again
   after the sign-in read, only this task's notices, a retraction that cannot throw, and the table's
   act carried at the wake.

## ⛔ What this table cannot reach

 * ⚠️ **The flush-in-flight guard** (`theNoticesItHasNotRead`'s first line) — `cancelQueuedMessage`'s
   shipped ruling, carried: a notice on the wire is not taken back. ⛔ No test reaches a reopen whose
   telling chain runs while that same parent's flush is suspended mid-handover, so no row claims it.
 * ⚠️ **The renderer's drawing of `retracted`** — none is new: the row falls to the existing *not sent ·
   detail* arm, and its own treatment is the frontend's (the response's GAP).

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

M17 was corrected in place: D-010 deleted the wake's held-message answer, so the `return` after the
sign-in read now answers `that-conversation-is-running` itself. The older note above it (*the `return`
asks the held-work rail first*) describes code D-010 deleted.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · F-a — the wake answers what the message door answers ────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** F-a's wake-mirrors-message-door pairing
        # is gone: `resume_agent` no longer exists, so there is no wake left to "ask nothing of the
        # conversation's state" or answer *running*. `the-wake-says-only-what-is-true.test.ts`'s own
        # docblock says exactly this — "D-017 (commit 3) removed `resume_agent`: ... there is no
        # wake left to say anything" — and marks its §1.3/§1.4 (the wake's *running* word for a
        # child `message_agent` reaches) retired; only the message-door half (§1.1, §1.2, kept)
        # survives. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 F-a undone · the wake asks nothing of the conversation's state, so a running child "
        "message_agent refuses is answered *running — message_agent reaches it* again · killed by "
        "`the-wake-says-only-what-is-true.test.ts`",
        [(HOST, "          this.aReachRefusal(sessionId, by) ?? (await this.whatAMessageWouldMeet(slot.session))\n", "          this.aReachRefusal(sessionId, by)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The sign-in guard this row removes
        # belonged to the wake's own reachability check (a `return null` path paired with
        # `aReachRefusal`/`whatAMessageWouldMeet`, both of which no longer exist anywhere in
        # `apps/desktop/src/main`). The test file explicitly retires this as "the census that
        # derived the wake's guards from the message door's" (§1.5, gone with `resume_agent` in
        # commit 3); the surviving sign-in test (§1.1) instead calls `message_agent` directly and
        # checks its own refusal. Its anchor is left stale, so the census records it retired.
        "M2 · 🔴 the sign-in guard not asked · a child whose Claude sign-in moved on reads *running* at "
        "the wake while message_agent refuses it · killed by "
        "`the-wake-says-only-what-is-true.test.ts`",
        [(HOST, "      await this.assertSignInCurrent(session, 'queue')\n      return null\n", "      return null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same removed wake-guard census as M2
        # (§1.5), this time the "errored in place" state guard.
        # `assertAcceptsMessages`/`assertSignInCurrent` still exist, but only inside
        # `assertCanTakeTurn`, the ordinary send/queue gate — not paired with any wake-side mirror,
        # since there is no wake. The surviving §1.2 test now calls `message_agent` on an errored
        # child directly and asserts it starts and delivers, with no wake-side comparison left to
        # break. Its anchor is left stale, so the census records it retired.
        "M3 · 🔴 the state guard not asked · a child errored in place reads *running* at the wake while "
        "message_agent says it is over · killed by `the-wake-says-only-what-is-true.test.ts`",
        [(HOST, "      this.assertAcceptsMessages(session, 'queue')\n      await this.assertSignInCurrent(session, 'queue')\n", "      await this.assertSignInCurrent(session, 'queue')\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** This plants the defect that the wake's
        # `detail.said` stops matching `message_agent`'s — but there is no wake `detail.said` any
        # more to diverge, since `resume_agent` is gone. F-a's whole point (the wake's answer
        # mirrors the message door's) is retired wholesale; the surviving §1.1 test asserts
        # `message_agent`'s own `detail.said` in isolation, with nothing to compare it against. Its
        # anchor is left stale, so the census records it retired.
        "M4 · ⛔ the message door's sentence not carried · the wake's `detail.said` is its own and no "
        "longer the one message_agent gives for the same conversation · killed by "
        "`the-wake-says-only-what-is-true.test.ts`",
        [(TOOLS, "                ...refuseTool('agent-cannot-take-a-message', { agent, said: outcome.said }),\n", "                ...refuseTool('agent-cannot-take-a-message', { agent, said: 'cannot queue' }),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `IT_CANNOT_TAKE_A_MESSAGE_EITHER` — the
        # constant this row blanks — does not exist anywhere in the current source; it was the
        # wake's own sentence for "the message was not queued" about a call that sent none, part of
        # the F-a wake/message-door pairing the test file marks retired with `resume_agent` (commit
        # 3). Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ the table's sentence at the wake · *the message was not queued* about a call that sent "
        "no message · killed by `the-wake-says-only-what-is-true.test.ts`",
        [(TOOLS, "                reason: IT_CANNOT_TAKE_A_MESSAGE_EITHER,\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** This targets the wake's own refusal
        # sentence ("a caller told *not woken* ... message_agent is refused too"), which existed
        # only because `resume_agent` could answer "not woken" while pointing at `message_agent` as
        # the other verb. With `resume_agent` gone there is no "not woken" sentence left to lose its
        # clause; §1's surviving tests check only `message_agent`'s own refusal wording. Its anchor
        # is left stale, so the census records it retired.
        "M6 · ⚠️ the wake's sentence loses its door · it no longer says message_agent is refused too, so "
        "a caller told *not woken* reaches for the other verb · killed by "
        "`the-wake-says-only-what-is-true.test.ts`",
        [(TOOLS, "so it was not woken, and message_agent is refused too: somebody else", "so it was not woken: somebody else")],
    ),
    # ── §B · F-h — a wake of itself ──────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `A_WAKE_OF_ITSELF` — the constant this
        # row blanks — is absent from the current tree. This is F-h §2.1, "a WAKE of itself and its
        # own sentence", which the test file explicitly marks retired with `resume_agent` (commit
        # 3); only §2.2, `message_agent` to itself (`that-agent-is-you`), survives, and is unrelated
        # to this constant. Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 F-h undone · a caller that asked to wake itself is told *a conversation cannot give "
        "itself work* again · killed by `the-wake-says-only-what-is-true.test.ts`",
        [(TOOLS, "              reason: A_WAKE_OF_ITSELF,\n", "")],
    ),
    # ── §C · R32 — the app takes back its own unread notice ──────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # R32 is the wake take-back: the waker's unread `has ended` notice is retracted at its own
        # wake, and it is the subject of this row. The commit removed it on purpose: "Gone with it:
        # ... every set-right, correction and wake take-back". `retractWhatItsWakeMadeFalse`,
        # `publishItsOwnWake` and `theNoticesItHasNotRead` are gone, and
        # what-a-wake-still-says-wrong.test.ts keeps only sections 1.2 and 3. Its anchor is left
        # stale, so the census records it retired.
        "M8 · 🔴 R32 undone · the waker's unread *has ended* is corrected behind rather than taken back, "
        "and a waker that messaged its child in the same turn reads it and *still not being worked on* "
        "· killed by `what-a-wake-still-says-wrong.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R32 (a waker's
        # unread 'has ended' is TAKEN BACK, not corrected behind) survives unchanged in
        # `setRightANoticeAReopenMadeFalse`, with the row's `task` now a `piece`
        # (`theNoticesItHasNotRead(parent, piece.piece)`). Forcing `unread` to empty leaves the
        # notice standing and the correction is sent behind it, so the retraction receipts and the
        # 'retracted' endings the wake tests assert are missing. Killed by
        # `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, '      const unread = itsOwnWake ? this.theNoticesItHasNotRead(parent, piece.piece) : []\n', '      const unread: QueuedMessage[] = []\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row plants the removal of the `itsOwnWake` guard in `setRightANoticeAReopenMadeFalse`,
        # which the commit deleted along with `wokenBy` and `theNoticesItHasNotRead`. The card
        # removes on purpose "every set-right, correction and wake take-back": "A stop, a reopen and
        # a start tell nobody anything", so no held ending is taken back for a person's Reopen and
        # no parent is told anything came back. Its anchor is left stale, so the census records it
        # retired.
        "M9 · ⛔ R32 for EVERY parent · a held ending a PERSON's Reopen made false is taken back too, and "
        "the parent that did not wake the child is never told it came back · killed by "
        "`what-a-wake-still-says-wrong.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The 'only the
        # parent that woke the child retracts' rule (R32 is not for EVERY parent) is unchanged; only
        # `task.taskId` became `piece.piece`. Dropping the `itsOwnWake` guard makes a person's
        # Reopen also take back the held ending, so the parent that did not wake the child is never
        # told it came back, which the person-Reopen arm asserts. Killed by
        # `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, '      const unread = itsOwnWake ? this.theNoticesItHasNotRead(parent, piece.piece) : []\n', '      const unread = this.theNoticesItHasNotRead(parent, piece.piece)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about the wake take-back retracting only the first of several held notices. The
        # take-back loop (`theNoticesItHasNotRead` in `retractWhatItsWakeMadeFalse`) was removed as
        # "every set-right, correction and wake take-back". The surviving later-fact take-back,
        # `theNoticesItWillStillRead`, serves 703 and not the wake, so this label describes nothing
        # left. Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the first notice only · a waker holding two endings and a correction between them reads "
        "the last two after its own wake · killed by `what-a-wake-still-says-wrong.test.ts`",
        # ⚑ **Anchor corrected in place by `703`**, whose first draft spelled the same one-line loop;
        # the line after it now only makes the wake's certain (the loop `703` landed is braced).
        # Re-verified RED individually
        # against `what-a-wake-still-says-wrong.test.ts`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The retraction
        # loop still takes back every unread notice of the piece; the row's `task` is now `piece` in
        # the `publishItsOwnWake(parent, piece)` line. Limiting the loop to the first notice leaves
        # the second ending standing, which the three-endings-and-a-correction arm asserts. Killed
        # by `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, "    for (const one of unread) this.takeQueuedBack(parent, one, { reason: 'retracted', detail })\n    this.publishItsOwnWake(parent, piece)\n", "    for (const one of unread.slice(0, 1))\n      this.takeQueuedBack(parent, one, { reason: 'retracted', detail })\n    this.publishItsOwnWake(parent, piece)\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about the wake take-back ending the notice as `cancelled`, which reads as a
        # person's act. There is no wake take-back left, since the commit removed "every set-right,
        # correction and wake take-back", so the app no longer ends a notice on the waker's behalf
        # and the `cancelled` wording has no source. Its anchor is left stale, so the census records
        # it retired.
        "M11 · 🔴 the app's act in a person's word · the notice is ended `cancelled`, which says a person "
        "took it back · killed by `what-a-wake-still-says-wrong.test.ts`",
        # ⚑ **Anchor corrected in place by `703`** — as `M10`. Re-verified RED individually
        # against `what-a-wake-still-says-wrong.test.ts`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The ending is
        # still taken back with `{ reason: 'retracted', detail }` so a person is not told they took
        # it back; the anchor is the same two lines with `task` renamed `piece`. Dropping the reason
        # falls to `takeQueuedBack`'s default `cancelled` (a person's word), which the
        # retracted-ending assertions catch. Killed by `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, "    for (const one of unread) this.takeQueuedBack(parent, one, { reason: 'retracted', detail })\n    this.publishItsOwnWake(parent, piece)\n", '    for (const one of unread) this.takeQueuedBack(parent, one)\n    this.publishItsOwnWake(parent, piece)\n'),
        ],
    ),
    (
        "M12 · ⛔ it does not say so · the ending row carries no detail, so nothing names the later fact "
        "that made the notice false · killed by `what-a-wake-still-says-wrong.test.ts`",
        [(HOST, "      ...(why.reason === 'retracted' ? { detail: why.detail } : {}),\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about the its-own-wake receipt written after the retraction, so that the next
        # ending is told. Both the retraction and the receipt are gone: "The only receipt written is
        # pushed". The giver is told once, when the piece stalls, so no later receipt can leave a
        # next ending untold. Its anchor is left stale, so the census records it retired.
        "M13 · 🔴 no receipt after the retraction · the last standing report is the `pushed` one, so the "
        "NEXT ending is never told · killed by `what-a-wake-still-says-wrong.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # 'its-own-wake' receipt after the retraction is still written by `publishItsOwnWake(parent,
        # piece)`, so the next ending is told; only `task` became `piece`. Removing that call leaves
        # `pushed` as the last standing report and the wait for the receipt times out. Killed by
        # `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, "    for (const one of unread) this.takeQueuedBack(parent, one, { reason: 'retracted', detail })\n    this.publishItsOwnWake(parent, piece)\n", "    for (const one of unread) this.takeQueuedBack(parent, one, { reason: 'retracted', detail })\n"),
        ],
    ),
    (
        "M14 · ⛔ a person's cancel in the app's word · `takeQueuedBack`'s default becomes the retraction, "
        "so a person taking their own words back reads as the app's act · killed by "
        "`what-a-wake-still-says-wrong.test.ts`",
        [(HOST, "    why: HowItWasTakenBack = { reason: 'cancelled' },\n", "    why: HowItWasTakenBack = { reason: 'retracted', detail: 'taken back' },\n")],
    ),
    (
        "M15 · ⚠️ the sentence loses its why · the row says the app took the notice back and not that it "
        "had stopped being true · killed by `what-a-wake-still-says-wrong.test.ts` · killed by `a-notice-that-cannot-be-true-is-replaced.test.ts` (named by W4.78)",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — R32's rule (a taken-back
        # notice's sentence must say WHY, not just that it was retracted) is unchanged and
        # `anEndingItsOwnWakeRetracted` still exists with the same shape; only the vocabulary
        # changed with D-017's stop/start model ('woke ... after it ended' became 'started ... again
        # after it stopped'). The row's old exact string is gone purely because of that wording
        # update.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # A retirement was refuted: the rule survives. 8d54d6dc deleted
        # `anEndingItsOwnWakeRetracted`, but every taken-back notice is still worded by
        # `aNoticeALaterFactRetracted`, which must say WHY it was taken back. The plant drops
        # `because it was no longer true`. Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`,
        # `what-a-waker-reads-after-its-own-act.test.ts`,
        # `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — the prefix was hoisted into the TAKEN_BACK_UNREAD constant (shared with the question-retraction line); the plant drops 'because it was no longer true' from aNoticeALaterFactRetracted only. ⚠️ The labelled killer what-a-wake-still-says-wrong.test.ts no longer asserts this sentence (no 'no longer true'/'taken back' in it); a-notice-that-cannot-be-true-is-replaced.test.ts:227 (TAKEN_BACK_ANSWERED regex) and what-a-waker-reads-after-its-own-act.test.ts:274-309 do.
            (REPLY, "  return `${TAKEN_BACK_UNREAD}: ${WHAT_MADE_IT_FALSE[fact](holder)}`\n", "  return `taken back by this app before it was read: ${WHAT_MADE_IT_FALSE[fact](holder)}`\n"),
        ],
    ),
    # ── §D · what the review of `690` found ──────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `aReachRefusal` and
        # `whatAMessageWouldMeet` — both functions this row reorders — do not exist anywhere in
        # `apps/desktop/src/main` any more. They were the wake-side ordering check (reach-refusal
        # before the message-door's own check) that the test file's §1.5 note ("the census that
        # derived the wake's guards from the message door's") retires along with `resume_agent`. Its
        # anchor is left stale, so the census records it retired.
        "M16 · ⛔ state before reach · a child both walls refuse is answered with the state's word, "
        "which the message door — reach first — never gives this caller, and the sign-in bar is "
        "published for a conversation the caller cannot reach · killed by "
        "`the-wake-says-only-what-is-true.test.ts`",
        [(HOST, "          this.aReachRefusal(sessionId, by) ?? (await this.whatAMessageWouldMeet(slot.session))\n", "          (await this.whatAMessageWouldMeet(slot.session)) ?? this.aReachRefusal(sessionId, by)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The `that-conversation-is-running` rail
        # this row's edit exposes (by dropping the `runsNow` guard around it) does not appear
        # anywhere in the current source. It was the wake's own "running" verdict, decided racily
        # before the sign-in read — part of F-a's wake/message-door pairing, retired with
        # `resume_agent` per the test file's docblock. Its anchor is left stale, so the census
        # records it retired.
        "M17 · 🔴 *running* decided before the sign-in read · a teardown that starts during it is "
        "answered *running — message_agent reaches it*, and message_agent refuses it *still closing* "
        "· killed by `the-wake-says-only-what-is-true.test.ts`",
        # ⚑ **RE-ANCHORED at `698`, not retired**: the `return` asks the held-work rail first
        # (`690` F-1). The row still drops the re-ask, and answers what the re-ask guards.
        # ⚑ **T-003 · re-anchored in place, not retired** — D-010 deleted the wake's held-message answer; the row still drops the re-check after the sign-in read, so *running* is decided before it. Re-verified RED alone.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The rule this row
        # protects — `wakeSession` must re-check whether the conversation is still running AFTER the
        # async sign-in read, not trust a stale verdict from before it, because a teardown can start
        # mid-wait — is unchanged and the same code block still exists (with an inline comment
        # updated only to reflect that a still-closing conversation is now waited out and started
        # rather than refused). `runningStateOf(sessionId) !== 'not-running'` was renamed to the
        # equivalent `runsNow(sessionId)` (D-017 · R1), which is why the row's old exact string no
        # longer matches.
        [
            (HOST, "        if (this.runsNow(sessionId)) {\n          return said('that-conversation-is-running')\n        }\n", "        return said('that-conversation-is-running')\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row's rule is that the wake take-back retracts only this task's notices, not every
        # notice held. The take-back is removed ("every set-right, correction and wake take-back").
        # The one surviving per-piece filter, in `theNoticesItWillStillRead`, serves the 703
        # later-fact take-back and is owned by 703:M4's rule, so a re-anchor here would duplicate
        # 703:M4. Its anchor is left stale, so the census records it retired.
        "M18 · ⛔ every notice taken back, not this task's · a waker holding *has ended* about two "
        "children wakes one, and is never told the other ended · killed by "
        "`what-a-wake-still-says-wrong.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'Only this
        # task's notices are taken back' is now 'only this piece's': `theNoticesItHasNotRead`
        # filters on `one.authorship.work?.piece === piece` (was `work?.taskId === taskId`).
        # Widening it to any work notice takes back a notice about another child too, so that child
        # is never told it ended; the two-children arm asserts this. Killed by
        # `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, "      (one) => one.kind === 'notice' && one.authorship.work?.piece === piece,\n", "      (one) => one.kind === 'notice' && one.authorship.work !== undefined,\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row is about the wake retraction throwing on a failed name read and rejecting the
        # parent's telling chain. The retraction (`retractWhatItsWakeMadeFalse`) is removed with
        # "every set-right, correction and wake take-back", so that throw path no longer exists. The
        # telling chain no longer runs a name read at a wake. Its anchor is left stale, so the
        # census records it retired.
        "M19 · 🔴 the retraction can throw · a name read that fails rejects the parent's telling "
        "chain, and every later notice to that parent is unsent for the life of its slot · killed by "
        "`what-a-wake-still-says-wrong.test.ts`",
        # ⚑ **RE-ANCHORED at `698`, not retired**: the retraction answers whether it took anything
        # back (R37's opener reads it), so the `catch` returns `false`. The row still lets it throw.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 'The
        # retraction can throw' is unchanged in kind: `retractWhatItsWakeMadeFalse` still wraps
        # `anEndingItsOwnWakeRetracted(this.whatToCallTheConversation(piece.owner))` in try/catch,
        # warns, and returns false. Only the names moved (`task.assignedTo` to `piece.owner`,
        # `task.taskId` to `piece.piece`). Un-guarding it lets a failing name read reject the
        # parent's telling chain, which section 2.18 asserts by requiring the next ending to still
        # be told. Killed by `what-a-wake-still-says-wrong.test.ts`.
        [
            (HOST, '    let detail: string\n    try {\n      detail = anEndingItsOwnWakeRetracted(this.whatToCallTheConversation(piece.owner))\n    } catch (error) {\n      console.warn(\n        `runtime host could not take back what ${parent.id} was told about ${piece.piece}: ${errorMessage(\n          error,\n        )}`,\n      )\n      return false\n    }\n', '    const detail = anEndingItsOwnWakeRetracted(this.whatToCallTheConversation(piece.owner))\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** "a caller told *not woken,
        # message_agent refused too*" is literally the wake's own sentence (again referencing the
        # same retired "not woken" wording as M6); with `resume_agent` gone there is no wake reply
        # to drop the table's act from. The test file's kept half (§1.1/§1.2, §2.2) never produces
        # or checks this sentence. Its anchor is left stale, so the census records it retired.
        "M20 · ⚠️ the wake drops the table's act · a caller told *not woken, message_agent refused "
        "too* is not told who must act, though the price says a person · killed by "
        "`the-wake-says-only-what-is-true.test.ts`",
        [(TOOLS, "message_agent is refused too: somebody else has to put it right. The detail says why.", "message_agent is refused too. The detail says why.")],
    ),
]
