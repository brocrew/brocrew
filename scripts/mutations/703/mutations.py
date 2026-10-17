"""703 · what a waker reads after its own act — `698` F-A, F-B, F-C.

⛔ **Ordered by the PM** from `698`'s own findings: a parent reading a held notice its own act had made
false (F-A); `agent-already-has-a-message-waiting`'s remedy false for a message the caller never sent
(F-B); a WAIT after the parent's own ending and own wake never set right (F-C).

## ⚠️ What a row here measures

 * ⚑ **M1–M8 and M19–M29 are F-A and F-C** — R32's taking back for each later fact: the call sites
   (the question, the two withdrawals, the landed answer, the answer to a question), the rule each
   fact reaches (every notice about the work and no other, all of them, a WAIT held left alone, a
   correction answering a READ stop kept, one opening on nothing taken on an answer), the reason on
   the row, the record of what each held correction opened on, the flush guard that leaves only the
   head, and F-C's WAIT arm with its opener — killed by `what-a-waker-reads-after-its-own-act.test.ts`
   §1 and §3. ⚑ **Since `711`, M3 and M24 are killed by `a-notice-that-cannot-be-true-is-replaced.test.ts`
   §1.1 and §2.1** — `711` moved the two findings they rested on there, as R48 and R49.
 * ⚑ **M9–M18 and M30–M36 are F-B** — the held rail split by whether the caller can WITHDRAW what is
   held: the derivation's three halves, the throw that carries it, the wake's, the tool's word, its
   price and its act, the sentence for a WORK call the next rail would refuse, the host's
   person-facing *"cancel it"* kept out of both doors, and each door still naming the held message —
   killed by §2.

## ⛔ What has NO row here, and who holds it instead

 * ⚠️ **The answer's *still waiting?* check** (`now.state === 'waiting-on-an-answer'`): no rig holds
   two questions about one piece of work across a reopen, so an answer that leaves it waiting is not
   reached. Stated, not dressed as a row.
 * ⚠️ **`respondUserInput`'s provider arm and `answerQuestion`'s provider arm**: the tests answer an
   app-held question through `answer_question`'s first arm; a provider-raised one is the same helper
   called beside the same row — unrigged. ⚑ **`respondUserInput`'s app-held arm is rigged since
   `711`** (a person's answer, `a-notice-that-cannot-be-true-is-replaced.test.ts` §2.3) and has its
   row there (`711` M27).
 * ⚠️ **`publishStateIfChanged` after a taking back** and **the chain placement** — as `690`'s and
   `699`'s own takings back: the harnesses' sinks drop `sendLiveness`, and no rig holds a telling
   step mid-flight across a fact.
 * ⚠️ **Rows that also turn census tests red** — `a-refusal-carries-its-remedy.test.ts` (M16, M17),
   `what-an-agent-is-told-about-its-work.test.ts` (M17), `the-act-inside-the-cut.test.ts` (M18,
   M32), `a-reach-you-can-see.test.ts` (M9, M15, M33 remove a `mayCommand(` call it counts) — so a
   table run cannot name the behaviour test that kills them; each was verified RED alone against
   the file its label names. ⚑ M37 keeps the wake's call and ORs it, so that census cannot see it.

## ⛔ T-003 · 19 of 42 rows retired by ruling (D-010, `8bc565fa`)

D-010 lifted the one-held-message limit: a busy conversation holds any number of messages, each
going as its own turn. It retired `agent-already-has-a-message-waiting` and
`a-message-you-cannot-withdraw-is-waiting`, `MessageAlreadyHeld`, `whatIsHeldAhead` and the wake's
*"a message waits there"* answer, and deleted their tests (`what-a-waker-reads-after-its-own-act`
§2). M9–M18, M30–M37 and M42 planted defects into that deleted code; each is retired beside it. They
are the record that the rail was built and measured, which is what makes its removal a decision.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

⚠️ M19, M20, M38 and M41's labels say the parent sends a *question* through message_agent; D-010
removed that kind (a question is `ask_question`, the test sends `follow-up`). Their anchors and
defects are unchanged.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"
QUEUED = "apps/desktop/src/main/runtime/queued-message.ts"
KILLER = "what-a-waker-reads-after-its-own-act.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §A · F-A — the work closing ────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 F-A undone · the parent withdraws its work and still reads *\"…It has not been "
        f"answered\"* about it · killed by `{KILLER}` §1.3",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: withdrawing a piece takes back the held notices that a later fact made false
        # (`takeBackWhatALaterFactMadeFalse(piece, 'withdrawn')`, R32), and §1.3 still pins it.
        # 5e931be8 folded `withdrawTask` and `withdrawFromAStoppedConversation` into the one
        # `takeBackPiece`, so the call is now a single line with `piece` in place of `task`, and the
        # plant deletes it. Killed by `what-a-waker-reads-after-its-own-act.test.ts`.
        [
            (HOST, "    this.takeBackWhatALaterFactMadeFalse(piece, 'withdrawn')\n", ''),
        ],
    ),
    (
        "M2 · 🔴 F-A undone · the holder answers and the parent reads *\"It has not been answered\"* "
        f"first · killed by `{KILLER}` §1.4",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: an answer that LANDED takes back the giver's now-false notices (`if
        # (REPLY_LANDED[delivered]) this.takeBackWhatALaterFactMadeFalse(piece, 'answered')`). The
        # line is unchanged apart from `task` becoming `piece`, so the plant deletes it and §1.4,
        # §1.5 and §1.12 pin it. Killed by `what-a-waker-reads-after-its-own-act.test.ts`.
        [
            (HOST, "    if (REPLY_LANDED[delivered]) this.takeBackWhatALaterFactMadeFalse(piece, 'answered')\n", ''),
        ],
    ),
    (
        "M3 · 🔴 an answer that did NOT land takes the push back and puts nothing in its place · the "
        "giver is left told nothing about an answer it will not be sent — R48's *not taken back with "
        "nothing in its place* · killed by `a-notice-that-cannot-be-true-is-replaced.test.ts` §1.1",
        # ⚠️ **RE-AIMED at 711, not retired.** It pinned `703`'s code pending the PM's choice (§1.8):
        # its mutant took the push back on an undelivered answer. R48 ruled exactly that AND a true
        # line after it, so the old mutant became the code's own first half wherever the push is
        # held as the answer lands — equivalent there, and different only when the push is held
        # after it (`711` §1.5, found by `711`'s review: its unconditional take-back then runs first
        # and the line never comes). The DEFECT its label names — told nothing — is planted now
        # where the line is queued, which every case reaches.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — R48 still holds: an
        # answer that could not be delivered gets ONE true line queued in place of the retracted
        # push. D-016 only removed the `giversProject` argument from
        # `anAnswerThatCouldNotBeDelivered` and `workAnswered`, so the same block is deleted with
        # today's shorter call.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — R48 still
        # holds: an answer that could not be delivered gets ONE true line in place of the retracted
        # push. `replaceWhatAnUndeliveredAnswerMadeFalse` still queues it with
        # `anAnswerThatCouldNotBeDelivered(piece, holder)`, but D-016 changed the arguments
        # (`piece`, `resources` in place of task, documentId). The plant deletes today's
        # queueMessage block and keeps `publishStateIfChanged(giver)`. Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (HOST, "        this.publishStateIfChanged(giver)\n        await this.queueMessage(\n          giver.id,\n          anAnswerThatCouldNotBeDelivered(piece, holder),\n          THE_APP_ITSELF,\n          [],\n          'notice',\n          { report: workAnswered(piece, input, resources) },\n        )\n", '        this.publishStateIfChanged(giver)\n'),
        ],
    ),
    (
        "M4 · ⛔ a later fact takes back EVERY held notice, about any work · another child's push is "
        f"never read · killed by `{KILLER}` §1.6",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a later fact takes back only the notices about THAT piece, so another child's
        # push is still read (§1.6). `theNoticesALaterFactMadeFalse` still opens with `const held =
        # this.theNoticesItWillStillRead(parent, piece.piece)` followed by `if (fact ===
        # 'asked-about-it') {`; only the argument names changed (task to piece, taskId to
        # piece.piece). The plant widens it to every notice in the mailbox. Killed by
        # `what-a-waker-reads-after-its-own-act.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule stands: a later fact must read only the notices about THIS work through
        # theNoticesItWillStillRead. D-016c added `'rebriefed'` to the WhatMadeItFalse type and to
        # the `if` on the next line, so the old two-line anchor matches nothing. The plant reads
        # every held notice of any work. Killed by `what-a-waker-reads-after-its-own-act.test.ts`.
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule still holds: takeBackWhatALaterFactMadeFalse takes back only the unread notices
        # about THIS piece, so another child's push is still read (test section 1.6). The old
        # two-line anchor is gone with theNoticesALaterFactMadeFalse, which the tree collapsed into
        # one line, `const unread = this.theNoticesItWillStillRead(parent, piece.piece)`. The plant
        # widens that read to every notice in the mailbox. Killed by
        # `what-a-waker-reads-after-its-own-act.test.ts`.
        [
            (HOST, '        const unread = this.theNoticesItWillStillRead(parent, piece.piece)\n', "        const unread = parent.mailbox.filter((one) => one.kind === 'notice')\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The label's subject was 'the correction behind the ending', a second notice held about the
        # same piece; the commit removed it ("Gone with it: the kept-open receipt and notices ...
        # the unwind of an ending, and every set-right, correction and wake take-back"), and the
        # anchor's second line `parent.correctionsHeld.delete(one.id)` no longer exists. The card
        # keeps only "its giver is told once, when it stalls", so a giver holds at most one notice
        # per piece, and no test holds two. The loop still exists as `for (const one of unread)`,
        # but planting `unread.slice(0, 1)` on it is an equivalent mutant. Its anchor is left stale,
        # so the census records it retired.
        "M5 · ⛔ only the FIRST notice about the work is taken back · the correction behind the ending "
        f"is still read · killed by `{KILLER}` §1.5",
        [(HOST, "        for (const one of unread) {\n          this.takeQueuedBack(parent, one, { reason: 'retracted', detail })\n          parent.correctionsHeld.delete(one.id)\n", "        for (const one of unread.slice(0, 1)) {\n          this.takeQueuedBack(parent, one, { reason: 'retracted', detail })\n          parent.correctionsHeld.delete(one.id)\n")],
    ),
    (
        "M6 · ⛔ the notice is ended as the giver's own cancel · the row says a person took back words "
        f"they sent · killed by `{KILLER}` §1.3",
        # ⚑ Landing D-016c (8d54d6dc, a stop changes nothing) · re-anchored in place, not retired —
        # The rule still holds: a notice taken back because a later fact made it false is ended as
        # `retracted` with the fact's detail, not as the giver's own cancel. The two-line anchor
        # lost its second line (`parent.correctionsHeld.delete(one.id)` is gone), and the loop is
        # now one line in takeBackWhatALaterFactMadeFalse. The plant drops the reason so
        # takeQueuedBack falls back to its default `{ reason: 'cancelled' }`. Killed by
        # `what-a-waker-reads-after-its-own-act.test.ts`.
        [
            (HOST, "        for (const one of unread) this.takeQueuedBack(parent, one, { reason: 'retracted', detail })\n", '        for (const one of unread) this.takeQueuedBack(parent, one)\n'),
        ],
    ),
    (
        "M7 · ⛔ the reason names the wrong fact · a withdrawal is said to be an answer · killed by "
        f"`{KILLER}` §1.3",
        [(REPLY, "  withdrawn: () => 'this conversation withdrew that work',\n", "  withdrawn: (holder) => `${holder} answered that work`,\n")],
    ),
    (
        "M8 · 🔴 F-A undone on a holder the QUIT left open · withdrawing its work leaves *\"it is still "
        f"open\"* to be read · killed by `{KILLER}` §1.9",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The defect
        # survives, but its second call site is gone. 5e931be8 merged the quit-left-open withdrawal
        # path into `takeBackPiece`, which has one call site with `const session = slot?.session ??
        # null` in scope. So the plant takes the notices back only when the holder has a live
        # session, which is exactly the holder the quit left open (session null) that §1.9 measures.
        # Killed by `what-a-waker-reads-after-its-own-act.test.ts`.
        [
            (HOST, "    this.takeBackWhatALaterFactMadeFalse(piece, 'withdrawn')\n", "    if (session !== null) this.takeBackWhatALaterFactMadeFalse(piece, 'withdrawn')\n"),
        ],
    ),
    # ── §B · F-B — a held message the caller cannot withdraw ─────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** Subject removed on purpose. The row
        # plants 'every held message is called withdrawable' in the MessageAlreadyHeld throw inside
        # queueAs. Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M9 · 🔴 F-B undone · every held message is called one the caller can withdraw · a person's is "
        f"answered *withdraw it, or ask about it* · killed by `{KILLER}` §2.1",
        [(HOST, "        whatIsHeldAhead(heldWork, askedBy, itsSlot !== undefined && mayCommand(itsSlot, by)),\n", "        'work-it-can-withdraw',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The derivation whatIsHeldAhead (and the
        # queuedBy field it compared) was deleted from queued-message.ts in 8bc565fa. Its anchor is
        # left stale, so the census records it retired (`anchor-absent`).
        "M10 · ⛔ whose it is goes unasked · the commanding parent is told to withdraw ANOTHER caller's "
        f"held work · killed by `{KILLER}` §2.6",
        [(QUEUED, "  return held.queuedBy === askedBy && held.taskId !== undefined && commandsIt\n", "  return held.taskId !== undefined && commandsIt\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** Same deleted derivation
        # (whatIsHeldAhead's taskId half) in queued-message.ts. It chose a word for a rail D-010
        # retired ("The one-held-message limit is gone", 8bc565fa). Killer §2.2b was deleted. Its
        # anchor is left stale, so the census records it retired (`anchor-absent`).
        "M11 · ⛔ whether it is WORK goes unasked · the caller's own QUESTION is called withdrawable, "
        f"which `withdraw_task` never reaches · killed by `{KILLER}` §2.2b",
        [(QUEUED, "  return held.queuedBy === askedBy && held.taskId !== undefined && commandsIt\n", "  return held.queuedBy === askedBy && commandsIt\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The tool's `error instanceof
        # MessageAlreadyHeld` branch and its `error.held === 'nothing-it-can-withdraw'` split were
        # removed from agent-tools.ts. 8bc565fa says a-message-you-cannot-withdraw-is-waiting is
        # "retired with the rule". Killer §2.1 was deleted. Its anchor is left stale, so the census
        # records it retired (`anchor-absent`).
        "M12 · 🔴 F-B undone at the tool · the word it was split from answers anyway · killed by "
        f"`{KILLER}` §2.1",
        [(TOOLS, "              if (error.held === 'nothing-it-can-withdraw') {\n", "              if (error.held !== error.held) {\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The
        # refuseTool('a-message-you-cannot-withdraw-is-waiting', {agent, holding:
        # error.heldMessageId}) call and the host's person-facing 'cancel it' sentence (the
        # MessageAlreadyHeld message) are both gone. Its anchor is left stale, so the census records
        # it retired (`anchor-absent`).
        "M13 · ⛔ the new word carries the host's *\"cancel it\"* — a person's act, no agent tool's · "
        f"killed by `{KILLER}` §2.1",
        [(TOOLS, "                  holding: error.heldMessageId,\n                })\n", "                  holding: error.heldMessageId,\n                  said,\n                })\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The wake's held-message answer ({agent,
        # holding} from aMessageWaitsThere) was removed. 8bc565fa: "...and so is the wake's \"a
        # message waits there\" answer." A_MESSAGE_ALREADY_WAITS_THERE and
        # RuntimeHost.aMessageWaitsThere are both deleted. Its anchor is left stale, so the census
        # records it retired (`anchor-absent`).
        "M14 · ⛔ the wake carries *\"cancel it\"* beside a message the caller cannot withdraw · killed "
        f"by `{KILLER}` §2.4",
        [(TOOLS, "                  : { agent, holding: outcome.holding }\n", "                  : { agent, holding: outcome.holding, said: outcome.said }\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The anchor was the
        # whatIsHeldAhead(held, me, …mayCommand…) call inside RuntimeHost.aMessageWaitsThere, which
        # D-010 deleted along with the wake's "a message waits there" answer (8bc565fa commit
        # message). Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M15 · ⛔ the wake calls every held message one the caller can withdraw · killed by "
        f"`{KILLER}` §2.4",
        [(HOST, "      whatIsHeldAhead(\n        held,\n        me,\n        itsSlot !== undefined && mayCommand(itsSlot, { ownerId: agentCallerId(me) }),\n      ),\n", "      'work-it-can-withdraw',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The TOOL_REMEDY entry for
        # 'a-message-you-cannot-withdraw-is-waiting' was removed: the word is no longer in
        # TOOL_REFUSALS, and 8bc565fa says it is "retired with the rule". Its anchor is left stale,
        # so the census records it retired (`anchor-absent`).
        "M16 · 🔴 the new word keeps the false act · *withdraw it, or ask about it* · killed by "
        f"`{KILLER}` §2.1",
        [(TOOLS, "  'a-message-you-cannot-withdraw-is-waiting': 'make-the-same-call-when-this-settles',\n", "  'a-message-you-cannot-withdraw-is-waiting': 'withdraw-the-work-or-ask-about-it',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The TOOL_PERMANENCE entry for the
        # retired word 'a-message-you-cannot-withdraw-is-waiting' was deleted with it (8bc565fa).
        # shared/refusals.ts:276 now reads "`a-message-you-cannot-withdraw-is-waiting` was one of
        # these from `703` until D-010". Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M17 · ⛔ the new word is priced *never* · a refusal that clears at the next turn says no retry "
        f"will work · killed by `{KILLER}` §2.1",
        [(TOOLS, "  'a-message-you-cannot-withdraw-is-waiting': 'while-this-holds',\n", "  'a-message-you-cannot-withdraw-is-waiting': 'permanent',\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The TOOL_SENTENCES entry for the
        # retired word was deleted from agent-tools.ts ('that agent holds a message withdraw_task
        # cannot take back…'). The word no longer exists (8bc565fa: "retired with the rule"), and
        # killer §2.1 was deleted. Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M18 · ⛔ the sentence loses its act and names the one it does not have · killed by "
        f"`{KILLER}` §2.1",
        [(TOOLS, "    'that agent holds a message withdraw_task cannot take back, not gone yet, so nothing was sent: make the same call again once it has gone.',\n", "    'that agent holds a message withdraw_task cannot take back, not gone yet, so nothing was sent: take it back with withdraw_task, or ask about it.',\n")],
    ),
    # ── §C · F-A — the parent's own question, the answer, the flush ──────────────────────────────
    (
        "M19 · 🔴 F-A undone for the brief's own case · the parent asks the holder about its work and "
        f"reads *\"…is not being worked on\"* while the holder answers it · killed by `{KILLER}` §1.1",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a `message_agent` that reaches the holder about a piece the caller gave takes
        # back the giver's 'not being worked on' notice (`host.takeBackWhatItsQuestionMadeFalse({
        # agent, piece: about.piece }, by)`). 5e931be8 dropped `OPENS_A_TASK[says]` (a message is a
        # note or a follow-up now) and renamed `taskId` to `piece`, so the condition is
        # `outcome.outcome === 'sent' && about !== null`. The plant deletes that block. Killed by
        # `what-a-waker-reads-after-its-own-act.test.ts`.
        [
            (TOOLS, "            if (outcome.outcome === 'sent' && about !== null) {\n              host.takeBackWhatItsQuestionMadeFalse({ agent, piece: about.piece }, by)\n            }\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The `aWaitIsHeld ? [] : held` filter is deleted along with the WAIT correction and the
        # set-right ending it protected ("every set-right, correction and wake take-back").
        # `theNoticesItWillStillRead` now returns every unread notice about the piece, and a
        # question takes all of them back. No correction exists to keep or to take back. Its anchor
        # is left stale, so the census records it retired.
        "M20 · ⛔ a question takes back a WAIT still true, and the ending it sets right with it · "
        f"killed by `{KILLER}` §1.1c",
        [(HOST, "      return aWaitIsHeld ? [] : held\n", "      return held\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # `HostedSession.correctionsHeld` and the `aStopIsAhead || correctionsHeld.get(one.id) !==
        # 'that-it-stopped'` loop are deleted, and "a correction drawn as a wait" is one of the four
        # subjects removed (the commit lists "every set-right, correction and wake take-back" as
        # gone). A stop, a reopen and a start send no correction, so there is none to take back on a
        # closing. Its anchor is left stale, so the census records it retired.
        "M21 · 🔴 a closing takes back the correction answering a stop the parent READ · its last word "
        f"stays *\"has ended\"* about a running conversation · killed by `{KILLER}` §1.6b",
        [(HOST, "      if (aStopIsAhead || parent.correctionsHeld.get(one.id) !== 'that-it-stopped')\n", "      if (aStopIsAhead || one !== undefined)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # Same removal as M21. `aStopIsAhead` and `correctionsHeld` (the record of which stop a held
        # correction answers) are gone with the corrections, and the closing's take-back is the
        # single `takeBackWhatALaterFactMadeFalse(piece, 'closed')` call. No correction whose stop
        # is being taken back can be kept. Its anchor is left stale, so the census records it
        # retired.
        "M22 · ⛔ a closing keeps the correction whose stop it is taking back · the correction is read "
        f"about an ending never read · killed by `{KILLER}` §1.5",
        [(HOST, "      if (aStopIsAhead || parent.correctionsHeld.get(one.id) !== 'that-it-stopped')\n", "      if (parent.correctionsHeld.get(one.id) !== 'that-it-stopped')\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects the parent's own answer to a waker's child taking back the WAIT
        # correction, and section 1.11 (its named killer) was already retired by D-017 (R4). The
        # commit removed the whole thing: "the unwind of an ending, and every set-right, correction
        # and wake take-back", and takeBackWhatAnAnswerMadeFalse and setRightAWait no longer exist.
        # The remaining rule, that the holder's answer takes back the giver's stall push, is section
        # 1.4 and is guarded by re-anchored rows M4 and M6. Its anchor is left stale, so the census
        # records it retired.
        "M23 · 🔴 the answer takes nothing back · a waker that answers its child reads *\"nobody has "
        f"answered\"* · killed by `{KILLER}` §1.11",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — §1.11's premise (a close
        # ending the question, then a wake) is gone, but the answer arm still takes back a WAIT
        # correction the answer made false, on the one path D-017 left (own end_agent, a person's
        # Reopen and Close, the parent's own wake). Killed by `a-giver-that-asked-was-told.test.ts`
        # §1.4 and `a-notice-that-cannot-be-true-is-replaced.test.ts` §2.2.
        [
            (HOST, '      // {@link takeBackWhatAnAnswerMadeFalse}.\n      this.takeBackWhatAnAnswerMadeFalse(request.askedBy)\n', '      // {@link takeBackWhatAnAnswerMadeFalse}.\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects an answer taking back the correction that sets right a stop after a
        # person's Reopen. The commit deleted that correction: "A stop, a reopen and a start tell
        # nobody anything and announce no work", along with "every set-right, correction and wake
        # take-back". Its anchor (theWaitsThatSetRightAStop / correctionsHeld) is gone from
        # runtime-host.ts, and section 1.5 now expects a single `retracted` for the stall notice.
        # Its anchor is left stale, so the census records it retired.
        "M24 · ⛔ the answer takes back a correction that sets right a stop · *\"has ended\"* is left "
        "uncorrected after a person's Reopen · killed by "
        "`a-notice-that-cannot-be-true-is-replaced.test.ts` §2.1 (`711` moved §1.10 there, as R49)",
        [(HOST, "          parent.correctionsHeld.get(one.id) === 'nothing',\n", "          one !== undefined,\n")],
    ),
    (
        "M25 · ⛔ a flush in flight blinds the take-back to the WHOLE mailbox · the notice behind the "
        f"head is read after the answer made it false · killed by `{KILLER}` §1.12",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 replaced `parent.flushing === null ? undefined : parent.mailbox[0]` with
        # `parent.handingOver.includes(one)`, since handingOver is now a turn's worth and `flushing`
        # is no longer in WhatAGiverHolds. The rule survives and is still §1.12's: while a handover
        # is on the wire, a notice behind it that a later fact made false must still be taken back.
        # The plant blinds the whole mailbox whenever a handover is in flight. Killed by
        # `what-a-waker-reads-after-its-own-act.test.ts`.
        [
            (HOST, '    return parent.mailbox.filter(\n      (one) =>\n        !parent.handingOver.includes(one) &&\n', '    if (parent.handingOver.length > 0) return []\n    return parent.mailbox.filter(\n      (one) =>\n        !parent.handingOver.includes(one) &&\n'),
        ],
    ),
    (
        "M26 · ⛔ the head a flush is handing over is taken back from under it — a stop the parent is "
        f"READING, and the correction that answers it with it · killed by `{KILLER}` §1.13",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The rule (what is on the wire cannot be taken back, so the head a flush is handing over
        # is excluded) survives as `!parent.handingOver.includes(one)`, now over a turn's worth. Its
        # old killer, §1.13, was retired by D-016c, and §1.12 cannot kill it because the withdrawn
        # piece there is not the head's, so the killer is 711's §1.4, where the answer lands while
        # the push is being handed over. Killed by
        # `a-notice-that-cannot-be-true-is-replaced.test.ts`.
        [
            (HOST, "        !parent.handingOver.includes(one) &&\n        one.kind === 'notice' &&\n", "        one.kind === 'notice' &&\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects recording what a held correction opened on, so that a correction
        # answering a READ stop is not taken back on a closing. Its killer, section 1.6b, was
        # retired by D-016c, and the correction it kept no longer exists: "a reopen sends no
        # correction and a second stop tells nobody anything". The state it read (correctionsHeld,
        # heldAsItEnded) is removed from runtime-host.ts. Its anchor is left stale, so the census
        # records it retired.
        "M27 · 🔴 what a held correction opened on is never recorded · a correction answering a READ "
        f"stop is taken back on a closing · killed by `{KILLER}` §1.6b",
        [(HOST, "      if (delivery.outcome === 'queued') parent.correctionsHeld.set(delivery.messageId, read)\n", "")],
    ),
    # ── §D · F-C ─────────────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was deleted.
        # `itsOwnEndingThenItsOwnWake` and `toldItNothing` no longer exist in runtime-host.ts (grep
        # finds neither), because D-017 removed `end_agent` and 'an agent is never dead'. The killer
        # test's header says: 'D-017 retired §3.1 and §3.3 with `end_agent`', and §3.3 was this
        # row's killer. Its anchor is left stale, so the census records it retired.
        "M28 · 🔴 F-C undone · its own ending then its own wake re-arms only a STALL · a WAIT is never "
        f"set right and the next ending never told · killed by `{KILLER}` §3.3",
        [(HOST, "    const itsOwnEndingThenItsOwnWake = toldItNothing && mark?.by === parent.id\n", "    const itsOwnEndingThenItsOwnWake = toldItNothing && itsOwnWake\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject was deleted and
        # the code now equals the mutant. `toldItNothing` is gone, and `setRightAWait` ends
        # `tookItBack && !itReadOne ? 'nothing' : 'that-it-stopped'`, which is exactly what this row
        # plants. The killer test's header says: 'D-017 retired §3.1 and §3.3 with `end_agent`'
        # (§3.3 was this row's killer), because nothing ends a conversation now and a parent is
        # never told nothing by an ending. Its anchor is left stale, so the census records it
        # retired.
        "M29 · ⛔ a parent told NOTHING is corrected *\"after you were told it had stopped\"* · killed "
        f"by `{KILLER}` §3.3",
        [(HOST, "      (tookItBack || toldItNothing) && !itReadOne ? 'nothing' : 'that-it-stopped',\n", "      tookItBack && !itReadOne ? 'nothing' : 'that-it-stopped',\n")],
    ),
    # ── §E · F-B — the review's cases ─────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The anchor was the third argument
        # (workStaysOpen) of `new MessageAlreadyHeld(…)` in queueAs. D-010 deleted both the throw
        # and the class's workStaysOpen field. Its anchor is left stale, so the census records it
        # retired (`anchor-absent`).
        "M30 · 🔴 a WORK call the next rail would refuse is told *\"once it has gone\"* · killed by "
        f"`{KILLER}` §2.6",
        [(HOST, "        assigning !== null &&\n          this.workAlreadyOpenIn(session.id, takesWorkFrom === 'one-caller' ? null : askedBy) !==\n            null,\n", "        false,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** Same deleted workStaysOpen argument to
        # the removed MessageAlreadyHeld throw (8bc565fa). The retired word's 'wait for open work'
        # sentence no longer exists for any call kind. Killer §2.6 was deleted. Its anchor is left
        # stale, so the census records it retired (`anchor-absent`).
        "M31 · ⛔ a QUESTION is told to wait for open work it never meets · killed by "
        f"`{KILLER}` §2.6",
        [(HOST, "        assigning !== null &&\n          this.workAlreadyOpenIn(", "        true &&\n          this.workAlreadyOpenIn(")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The tool's `error.workStaysOpen ? {
        # ...cannot, reason: OPEN_WORK_OUTLASTS_IT } : cannot` was deleted, and so were the
        # OPEN_WORK_OUTLASTS_IT constant and the a-message-you-cannot-withdraw-is-waiting branch
        # (8bc565fa: that word is "retired with the rule"). Its anchor is left stale, so the census
        # records it retired (`anchor-absent`).
        "M32 · ⛔ the tool drops the sentence for work that stays open · killed by "
        f"`{KILLER}` §2.6",
        [(TOOLS, "                  error.workStaysOpen ? { ...cannot, reason: OPEN_WORK_OUTLASTS_IT } : cannot,\n", "                  cannot,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The whatIsHeldAhead(heldWork, askedBy,
        # …mayCommand…) call in queueAs's MessageAlreadyHeld throw was deleted with the
        # one-held-message limit (8bc565fa). There is no longer a held-message word telling anyone
        # to withdraw. Killer §2.7 was deleted. Its anchor is left stale, so the census records it
        # retired (`anchor-absent`).
        "M33 · 🔴 a caller that does not command the receiver is told to withdraw its held work · "
        f"`withdraw_task` then refuses it · killed by `{KILLER}` §2.7",
        [(HOST, "        whatIsHeldAhead(heldWork, askedBy, itsSlot !== undefined && mayCommand(itsSlot, by)),\n", "        whatIsHeldAhead(heldWork, askedBy, true),\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The commandsIt conjunct lived in
        # whatIsHeldAhead, which was deleted from queued-message.ts in 8bc565fa along with the rail
        # it served. Killer §2.7 was deleted. Its anchor is left stale, so the census records it
        # retired (`anchor-absent`).
        "M34 · ⛔ the derivation drops whether the caller commands the receiver · killed by "
        f"`{KILLER}` §2.7",
        [(QUEUED, "  return held.queuedBy === askedBy && held.taskId !== undefined && commandsIt\n", "  return held.queuedBy === askedBy && held.taskId !== undefined\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).**
        # refuseTool('agent-already-has-a-message-waiting', {agent, holding: error.heldMessageId})
        # was deleted: the word is gone from TOOL_REFUSALS, TOOL_PERMANENCE, TOOL_REMEDY and
        # TOOL_SENTENCES. Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M35 · ⛔ the kept word's refusal names the AGENT instead of the held message · killed by "
        f"`{KILLER}` §2.5",
        [(TOOLS, "                refuseTool('agent-already-has-a-message-waiting', {\n                  agent,\n                  holding: error.heldMessageId,\n", "                refuseTool('agent-already-has-a-message-waiting', {\n                  agent,\n                  holding: agent,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The wake's own-work held answer
        # ({agent, holding, said}) was deleted with aMessageWaitsThere. 8bc565fa: "and so is the
        # wake's \"a message waits there\" answer." Killer §2.5 was deleted. Its anchor is left
        # stale, so the census records it retired (`anchor-absent`).
        "M36 · ⛔ the wake's own-work answer drops the held message's id · killed by "
        f"`{KILLER}` §2.5",
        [(TOOLS, "                  ? { agent, holding: outcome.holding, said: outcome.said }\n", "                  ? { agent, holding: 'a message', said: outcome.said }\n")],
    ),
    # ── §F · the review's second round ────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The anchor was the mayCommand argument
        # inside the deleted RuntimeHost.aMessageWaitsThere (wake → whatIsHeldAhead). D-010 retired
        # the wake's "a message waits there" answer (8bc565fa commit message). Killer §2.7b was
        # deleted. Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M37 · 🔴 the wake calls a non-commander's own held work withdrawable · it carries *\"cancel it\"* "
        f"to a caller `withdraw_task` refuses · killed by `{KILLER}` §2.7b",
        [(HOST, "        itsSlot !== undefined && mayCommand(itsSlot, { ownerId: agentCallerId(me) }),\n", "        itsSlot !== undefined && (mayCommand(itsSlot, { ownerId: agentCallerId(me) }) || true),\n")],
    ),
    (
        "M38 · ⛔ a question only HELD takes the push back · a still-true push is retracted as false · "
        f"killed by `{KILLER}` §1.1d",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: only a SENT question takes the push back, never one that is merely held (§1.1d).
        # The condition in `message_agent` is now `outcome.outcome === 'sent' && about !== null`,
        # with `!OPENS_A_TASK[says]` removed by 5e931be8. The plant drops the `'sent'` test. Killed
        # by `what-a-waker-reads-after-its-own-act.test.ts`.
        [
            (TOOLS, "            if (outcome.outcome === 'sent' && about !== null) {\n", '            if (about !== null) {\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Same retirement as M23, for the
        # interrupt arm: the test file's docblock explicitly names §1.11b as retired alongside
        # §1.11, with the identical cause ("a Close no longer ends an asking worker's question
        # (R4)"). The `takeBackWhatAnAnswerMadeFalse(session.id)` call inside `askTheWorkToStop`
        # still exists (interrupts still end open questions), but the specific defect this row
        # pinned — a waker reading "nobody has answered" about a question a Close ended, then
        # interrupting it — has no premise left to test against. Its anchor is left stale, so the
        # census records it retired.
        "M39 · 🔴 an interruption ends the question and takes nothing back · the waker reads *\"nobody "
        f"has answered\"* about a question its own interrupt ended · killed by `{KILLER}` §1.11b",
        [(HOST, "    // here and decided on the giver's chain, a step later, after the loop below has ended them.\n    this.takeBackWhatAnAnswerMadeFalse(session)\n", "    // here and decided on the giver's chain, a step later, after the loop below has ended them.\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects the position rule across two Close/Reopen cycles, where a stop held
        # anywhere must not take a correction answering a READ stop. Its killer, section 1.6c, was
        # retired with the corrections (D-016c). The commit says "a second stop tells nobody
        # anything" and removed "every set-right, correction and wake take-back", so there is no
        # second notice or correction to position. Its anchor is left stale, so the census records
        # it retired.
        "M40 · ⛔ a stop held ANYWHERE takes a correction answering a READ stop · across two cycles the "
        f"giver's last word stays *\"has ended\"* · killed by `{KILLER}` §1.6c",
        [(HOST, "    let aStopIsAhead = false\n", "    let aStopIsAhead = held.some((one) => one.authorship.work?.stalledBecause === 'conversation_ended')\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # The row protects the parent's question keying its exception on a STOP and not on a WAIT,
        # so that a waker's WAIT correction is not taken back by its own question. Section 1.1e was
        # retired with its premise by D-017 (R4), and the commit deleted the WAIT corrections and
        # the set-right machinery ("every set-right, correction and wake take-back"). The anchor
        # (theWaitsThatSetRightAStop / setRightAWait) is gone, and section 1.1f now covers the
        # question taking the stop's notice back. Its anchor is left stale, so the census records it
        # retired.
        "M41 · ⛔ the question's exception keys on a STOP, not a WAIT · a waker's WAIT correction is "
        f"taken back by its own question · killed by `{KILLER}` §1.1e",
        [(HOST, "        return report !== undefined && theWaitIn(report.state) !== null\n", "        return report?.state === 'stalled' && report.stalledBecause === 'conversation_ended'\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The anchor was the text of
        # OPEN_WORK_OUTLASTS_IT, the sentence carried under a-message-you-cannot-withdraw-is-waiting
        # for a WORK call. D-010 deleted the constant with that word (8bc565fa: "retired with the
        # rule"). Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M42 · ⛔ the open-work sentence drops the act that finishes the caller's own work · 429's *wait "
        f"for it to finish* again · killed by `{KILLER}` §2.6",
        # ⚠️ **RE-ANCHORED at 711, not retired.** `711` reordered the sentence so its whole act is
        # inside the cut (`703` F-B2); the clause this row drops is the same one.
        [(TOOLS, "once the work open there is finished (withdraw_task finishes yours) — that agent", "once the work open there is finished — that agent")],
    ),
]
