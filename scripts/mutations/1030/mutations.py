"""1030 · D-030 and delivery — 038b7f1b, with c118ae04 (and bcc2dde7, not killable today).

⛔ **The defect (D-030, F039)**: a reply sent while its giver could not take it was dropped. Any
throw on the way in (a start that failed or timed out, a quit in flight) ended it as
`reply_undelivered` in the replier's ledger, and the giver never heard its work was answered.
⚑ 038b7f1b: `deliverReplyTo` holds the words with `holdUntilItStarts` when `queueMessage` throws:
in the giver's mailbox while it runs (`held`), else in its ledger marked `forItsNextStart`
(`kept`, with the start's reason as `why`). `not-delivered` is left to a giver whose record would
not take the words. `whereTheReplyWent` says which in `reply_to_parent`'s receipt, and the launch
sweep (`selectStrandedMessages`) spares a kept row until a later `launched` row, and spares
whatever an `ended`/`errored` conversation held.
⚑ c118ae04: `answer_question` asks the asker's running turn to stop unless told `interrupt: false`,
and its receipt says when the answer waits behind a turn that was not stopped.

## ⚑ What a row here measures

 * ⚑ **M1 is the defect, verbatim** — the catch answers `not-delivered` whatever the words were.
 * ⚑ **M2–M5 are the kept road** — the reason beside `kept`, the `forItsNextStart` mark on the row,
   `kept` only once the row is down, and `kept` counted as landed (no `reply_undelivered` row).
 * ⚑ **M6 is the receipt** — `kept` said in its own words, never as *could not be told*.
 * ⚑ **M7–M9 are the launch sweep** — a kept row spared, released by a later `launched` row, and
   an ended conversation's held words kept.
 * ⚑ **M10–M12 are c118ae04** — the default stop, `interrupt: false` honoured, and the receipt
   saying the answer is held behind a turn that was not stopped.

## ⛔ What this table cannot reach

 * ⚠️ **bcc2dde7 (a question's notice taken back once its question is answered)** — the commit
   added no test, and no test today asserts `aQuestionNoticeALaterFactRetracted`'s words, a
   `retracted` ending on a `'question'` notice, `QueuedMessage.asks`, or `howItsQuestionEnded`.
 * ⚠️ **`errored` in the sweep's terminal set** — `a-reply-kept-…` drives `ended` only; dropping
   `'errored'` alone leaves every test green.
 * ⚠️ **The `its-mailbox` arm of the catch** (`held` for a failed delivery to a giver that still
   runs) and **the kept reply going to `theOneInItsPlace`** — no test drives a failed delivery into
   a running or replaced giver.
 * ⚠️ **`whyItWasNotDelivered`'s cause-chain walk and its log-only fallback** (*"could not be
   reached just now"*) — no test asserts either sentence.
 * ⚠️ **c118ae04's guards on the stop** — `a-person-started-its-turn`, `already-asked`, and a held
   answer with `interrupting` driving every piece: no test asserts any of them.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"

REPLY = "a-reply-and-its-absence.test.ts"
KEPT = "a-reply-kept-for-its-next-start-survives-the-launch.test.ts"
NOT_WORK = "a-question-is-not-work.test.ts"
R18 = "the-rest-of-r18-and-the-answer-with-no-bound.test.ts"
MESSAGE_NOW = "message-now-stops-the-turn-it-reads-in.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # REPLY · '⛔ a parent that cannot be started is named as such, with why, and the reply is kept
    # for its next start' — expect(landed.delivered).toBe('kept') reads 'not-delivered'.
    (
        "M1 · a delivery that throws drops the reply — the defect, verbatim: the giver whose start "
        f"failed never hears its work was answered · killed by `{REPLY}`",
        [(HOST,
          "      if (words === null) return { delivered: 'not-delivered', why: whyItWasNotDelivered(error) }\n",
          "      return { delivered: 'not-delivered', why: whyItWasNotDelivered(error) }\n")],
    ),
    # REPLY · '⛔ a parent that cannot be started …' — expect(landed.why).toMatch(/^This
    # conversation did not start: its provider could not bring it back/) reads undefined.
    (
        "M2 · a kept reply carries no reason — the replier is never told why its giver did not "
        f"take it now · killed by `{REPLY}`",
        [(HOST,
          "      if (where === 'its-ledger') return { delivered: 'kept', why: whyItWasNotDelivered(error) }\n",
          "      if (where === 'its-ledger') return { delivered: 'kept', why: null }\n")],
    ),
    # REPLY · '⛔ a parent that cannot be started …' — expect(kept[0]).toMatchObject({ …,
    # forItsNextStart: true }) finds no mark on the held row.
    (
        "M3 · words held while nothing runs are written without their `forItsNextStart` mark — the "
        f"next launch's sweep abandons the kept reply · killed by `{REPLY}`",
        [(HOST,
          "    } else down = this.appendIntoItsLedger(sessionId, { ...row, forItsNextStart: true })\n",
          "    } else down = this.appendIntoItsLedger(sessionId, row)\n")],
    ),
    # NOT_WORK · '🔴 a parent that cannot be started, and whose record will not take the words …' —
    # expect(replied.delivered).toBe('not-delivered') reads 'kept'.
    (
        "M4 · the hold says `its-ledger` though the row never went down — a reply nothing holds is "
        f"told `kept`, and no `reply_undelivered` row is written · killed by `{NOT_WORK}`",
        [(HOST,
          "    kept?.(down ? 'its-ledger' : 'nowhere', held.id)\n",
          "    kept?.('its-ledger', held.id)\n")],
    ),
    # REPLY · '⛔ a parent that cannot be started …' — expect(ledger(worker).filter(…
    # 'reply_undelivered')).toEqual([]) finds the row a kept reply must not write.
    (
        "M5 · `kept` is not counted as landed — a reply kept for its giver's next start is written "
        f"down as lost in the replier's ledger · killed by `{REPLY}`",
        [(RAILS,
          "  kept: true,\n",
          "  kept: false,\n")],
    ),
    # REPLY · '🔴 D-030 · the receipt says where the reply went: straight away, held, or kept for
    # the next start' — the kept receipt fails its regex and contains 'could not be told'.
    (
        "M6 · the receipt says a kept reply could not be told — the replier is sent to tell a person "
        f"about an answer its giver will read at its next start · killed by `{REPLY}`",
        # ⚑ W4.172 · re-anchored in place: the kept receipt now adds that a usage limit can only
        # make it later.
        [(TOOLS,
          "      return `kept on ${label}; ${giver} gets it when it next starts, or later if its provider’s usage limit holds then.${inItsPlace}`\n",
          "      return `${giver} could not be told: ${replied.why} Your answer stays on ${label}, "
          "where ${giver} can read it with list_tasks, but nothing will tell it to look: tell the "
          "person here.`\n")],
    ),
    # KEPT · '🔴 a message marked for its next start is left waiting — and still waits' —
    # settleStrandedMessages returns 1, not 0.
    (
        "M7 · the launch sweep ignores the `forItsNextStart` mark — a reply kept for a giver that "
        f"was not running is abandoned at the next launch, before any start sends it · killed by `{KEPT}`",
        [(STORE,
          # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the launch sweep became one pass per conversation in code; the plant still drops the check that spares a message kept for its giver's next start, so the launch abandons it
          "        if (one.for_its_next_start === 1 && lastStart <= one.ordinal) continue\n",
          "")],
    ),
    # KEPT · '⛔ the same message, once a life has started after it, is the sweep’s again' —
    # settleStrandedMessages returns 0, not 1.
    (
        "M8 · a kept message is spared for good — a later `launched` row never hands it back to the "
        f"sweep, so a crash after its start leaves it held forever · killed by `{KEPT}`",
        [(STORE,
          # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the launch sweep became one pass per conversation in code; the plant still stops a later launched row from handing a kept message back to the sweep, so it stays held for good
          "        if (one.for_its_next_start === 1 && lastStart <= one.ordinal) continue\n",
          "        if (one.for_its_next_start === 1) continue\n")],
    ),
    # KEPT · '⚑ a conversation whose life ended keeps what it held, marked or not' —
    # settleStrandedMessages returns 1, not 0.
    (
        "M9 · the sweep abandons what an ended conversation held — words its stop handed on for the "
        f"next start are ended as a crash's · killed by `{KEPT}`",
        [(STORE,
          # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the launch sweep became one pass per conversation in code; the plant still drops the skip for a conversation whose life ended, so what its stop handed on is ended as a crash's
          "      if (conversation.status === 'ended' || conversation.status === 'errored') continue\n",
          "")],
    ),
    # R18 · '⚑ THE CONTROL: an answer AT the bound is taken and arrives whole …' — the receipt
    # reads '… reads your answer when the turn it is running ends.' where it said the answer is
    # held and why its turn was not interrupted.
    (
        "M10 · `answer_question` asks no stop unless told `interrupt: true` — c118ae04's default "
        f"undone: an answer waits behind a turn that can run for hours · killed by `{R18}`",
        [(TOOLS,
          "              interrupt: interruptAsked !== false,\n",
          "              interrupt: interruptAsked === true,\n")],
    ),
    # MESSAGE_NOW · '⚑ …and the control: an answer with interrupt: false is held and stops
    # nothing' — asked_to_stop is true and a work_interrupted row is written.
    (
        "M11 · `interrupt: false` is ignored — an answerer that said to let the asker finish its "
        f"turn has that turn stopped anyway · killed by `{MESSAGE_NOW}`",
        [(TOOLS,
          "              interrupt: interruptAsked !== false,\n",
          "              interrupt: true,\n")],
    ),
    # R18 · '⚑ THE CONTROL: an answer AT the bound …' — the receipt reads '… has your answer and
    # can go on.' for an answer held behind a turn parked on a person's card.
    (
        "M12 · an answer held behind a turn that was not stopped is said to have arrived — the "
        f"answerer is told the asker has it and can go on · killed by `{R18}` · killed by `a-helper-stopped-on-a-persons-approval.test.ts`",
        [(TOOLS,
          "          const waitsForItsTurn = answered.held === true && answered.stop?.stop !== 'asked'\n",
          "          const waitsForItsTurn = false\n")],
    ),
]
