"""3001 · message now, and answers at once — `ec9ac862`, `e419c240`, `c118ae04`.

⛔ **The subject**: `message_agent` and `answer_question` can stop the receiver's running turn so it
reads the words now. `ec9ac862` added `interrupt` to both. The words are held first, then the turn is
asked to stop, on `interrupt_agent`'s rails and only for a receiver below the sender. The receiver is
told who asked, the receipt says what became of the stop, and the agent's own questions stay open.
`e419c240` let a verb's permission class depend on the call (`beyondItsRailsWhen`, read through
`beyondItsRailsOf` by both adapters' floors), so a message that stops a turn raises the card
`interrupt_agent` raises. `c118ae04` made an answer stop the asker's turn by default
(`interrupt: false` lets it finish), took the card off answers, and made the receipt say when an
answer waits behind a turn that was not stopped.

## ⚑ What a row here measures

 * ⚑ **M1–M3 are the per-call class** (`e419c240`): `beyondItsRailsOf` reads the call's arguments,
   and each adapter's floor asks it rather than the verb's own word.
 * ⚑ **M4–M5 are which calls a person is asked about**: `message_agent` with interrupt is carded,
   and an answer never is, whatever `interrupt` says (`c118ae04` removed the `ec9ac862` reading).
 * ⚑ **M6–M8 are the host's half of a message sent now**: the not-below-you refusal, the stop
   itself, and an idle receiver that needs none.
 * ⚑ **M9–M10 are the receiver's line**, on a sender's message and on the app's answer notice.
 * ⚑ **M11–M12 are the answer's default** (`c118ae04`): it stops unless told `false`, and `false`
   stops nothing.
 * ⚑ **M13–M14 are the answer's receipt**: an answer held behind a turn that was not stopped is not
   said to have arrived, and a turn parked on a person's card is named as that.

## ⛔ What this table cannot reach

 * ⚠️ **Hold first, stop second** in `messageAgentNow`: swapping the order is not a one-line
   mutation, and no test watches a stop that comes before anything is held.
 * ⚠️ **The agent's own questions stay open across the stop** (`askTheWorkToStop(…, true)` and
   its `raisedBy === 'this-app'` skip). In the one test that stops an asker, the question the answer
   closes is already closed, and no test stops a turn whose other questions are still open. The
   receiver's line saying so is pinned (M9/M10), but the ledger rows are not.
 * ⚠️ **The mark cleared on stop and restart** (`delete …interrupting` on a failed stop request,
   on the hand-on to a next life, and on what a restart keeps): no test restarts or fails a stop
   after a message sent now.
 * ⚠️ **A peer's answer waits** (`stopForAnAnswer`'s `mayInterrupt`, giving `not-below-you` for
   answers): every test answer comes from the asker's own giver.
 * ⚠️ **`already-asked` and `a-person-started-its-turn`** (`c118ae04`): no test answers a turn that
   was already asked to stop or that a person's own words opened.
 * ⚠️ **The turn the stop opens carries on with what it cut** (`askedForTheStop`, `derivePieces`'
   `theCutTurnDrove`): no test reads a piece's state across a stop for held words.
   `finished-and-finished-with-a-question.test.ts` only bounds the publish block's length, and
   removing the field shortens the block.
 * ⚠️ **A person's answer in the window asks no stop**, and **the `not-needed` receipt left
   unsaid on an answer**: no test reads either.
 * ⚠️ **`message_agent`'s non-boolean `interrupt` refused as malformed**: only `answer_question`'s
   is tested.
"""

RAILS_OF = "packages/runtime/src/agent-tools.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"

CARDED = "a-verb-can-be-carded-for-some-calls-only.test.ts"
CLAUDE_KILLER = "claude-runtime.test.ts"
CODEX_KILLER = "codex-runtime.test.ts"
NOW = "message-now-stops-the-turn-it-reads-in.test.ts"
R18 = "the-rest-of-r18-and-the-answer-with-no-bound.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # 'a tool that reads the call says more for the calls that ask for more, and its word for the rest'
    # — `beyondItsRailsOf(reading, { interrupt: true })` is 'it-destroys-work-in-flight'.
    (
        "M1 · a call's class is always the verb's own word: the reading of the call's arguments is "
        f"never asked · killed by `{CARDED}`",
        [(RAILS_OF,
          "  return tool.beyondItsRailsWhen(args as Readonly<Record<string, unknown>>)\n",
          "  return tool.beyondItsRails\n")],
    ),
    # '🔴 a verb that stops a turn only when asked to: allowed without interrupt, carded with it' —
    # `floor(name, { interrupt: true })` must be `{ continue: true }`, not an allow.
    (
        "M2 · the Claude floor reads the verb's word, not the call's: a message that stops a turn is "
        f"allowed with no card in ask mode · killed by `{CLAUDE_KILLER}`",
        [(CLAUDE,
          "      tool !== undefined && beyondItsRailsOf(tool, toolInput) === 'nothing-its-rails-do-not-cover'\n",
          "      tool !== undefined && tool.beyondItsRails === 'nothing-its-rails-do-not-cover'\n")],
    ),
    # 'a verb carded for some calls only' › '🔴 without interrupt it runs with no card, and with
    # interrupt it cards and waits' — the second call must raise a `permission_request`.
    (
        "M3 · the Codex floor reads the verb's word, not the call's: a message that stops a turn runs "
        f"with no card in ask mode · killed by `{CODEX_KILLER}`",
        [(CODEX,
          "      beyondItsRailsOf(offered, call.arguments) === 'nothing-its-rails-do-not-cover'\n",
          "      offered.beyondItsRails === 'nothing-its-rails-do-not-cover'\n")],
    ),
    # '🔴 interrupt classes message_agent as destroying work in flight — and an answer never asks a
    # person (c118ae04)' — `message.beyondItsRailsWhen?.({ interrupt: true })`.
    (
        "M4 · message_agent with interrupt is classed as needing no card, so a turn is cut with no "
        f"person asked · killed by `{NOW}`",
        [(TOOLS,
          "        args[MESSAGE_INTERRUPT_ARGUMENT] === true\n"
          "          ? 'it-destroys-work-in-flight'\n",
          "        args[MESSAGE_INTERRUPT_ARGUMENT] === true\n"
          "          ? 'nothing-its-rails-do-not-cover'\n")],
    ),
    # The same test: every `answerQuestion.beyondItsRailsWhen?.(args) ?? beyondItsRails`, for
    # `{ interrupt: true }` too, is 'nothing-its-rails-do-not-cover'.
    (
        "M5 · answer_question is carded again when it says interrupt: true (the ec9ac862 reading "
        f"c118ae04 took out), so an answer waits for a person's click · killed by `{NOW}`",
        # NOT VERIFIED: the typed input wrapper moved; the same conditional card is added.
        [(TOOLS,
          "      beyondItsRails: 'nothing-its-rails-do-not-cover',\n"
          "      input: Object.fromEntries(\n"
          "        Object.entries({\n"
          "          [ANSWER_QUESTION_ARGUMENT]: z\n",
          "      beyondItsRails: 'nothing-its-rails-do-not-cover',\n"
          "      beyondItsRailsWhen: (args) =>\n"
          "        args[ANSWER_INTERRUPT_ARGUMENT] === true\n"
          "          ? 'it-destroys-work-in-flight'\n"
          "          : 'nothing-its-rails-do-not-cover',\n"
          "      input: Object.fromEntries(\n"
          "        Object.entries({\n"
          "          [ANSWER_QUESTION_ARGUMENT]: z\n")],
    ),
    # '⛔ an agent that is not below the sender is refused, nothing is sent, and the refusal says how
    # to send it plainly' — Ali's interrupting message to Ada must be `refused`.
    (
        "M6 · a message sent now skips the not-below-you check: a child may stop its giver's turn, and "
        f"the message is sent · killed by `{NOW}`",
        [(HOST,
          "    if (!this.mayInterrupt(this.theOneInItsPlace(sessionId), by)) {\n"
          "      return { ok: false, refusal: 'not-below-you' }\n"
          "    }\n"
          "    const delivery = await this.queueMessage(sessionId, text, by, [], 'work', facts, says)\n",
          "    const delivery = await this.queueMessage(sessionId, text, by, [], 'work', facts, says)\n")],
    ),
    # '🔴 the message is held, the running turn is asked to stop, and the receipt says so and promises
    # no timing' — `said.asked_to_stop` is true and a `work_interrupted` is recorded.
    (
        "M7 · a message sent now is held but its stop is never asked: the receiver's turn runs on and "
        f"the receipt says nothing needed stopping · killed by `{NOW}`",
        [(HOST,
          # ⚑ **W4.135 · re-anchored in place, not retired** — W4.135 · F084 now waits for the stop's ending (withWhatItsStopLeft); the plant still never asks the stop and says nothing needed stopping
          "      stop: this.stopForTheMessageHeldAs(delivery.messageId, by),\n",
          "      stop: { stop: 'not-needed' as const, askedOf: null },\n")],
    ),
    # '⛔ a conversation that is idle needs no stop, and the receipt says nothing was interrupted' —
    # `asked_to_stop` false and `not_stopped_because` 'not-needed'.
    (
        "M8 · a message that went straight to an idle receiver is reported as having stopped its turn "
        f"· killed by `{NOW}`",
        [(HOST,
          "    if (delivery.outcome === 'sent')\n"
          "      return { ok: true, delivery, stop: 'not-needed', askedOf: null }\n",
          "    if (delivery.outcome === 'sent')\n"
          "      return { ok: true, delivery, stop: 'asked', askedOf: null }\n")],
    ),
    # '🔴 the message is held, the running turn is asked to stop, …' — what Ali is handed must contain
    # 'asked for the turn you were in to be stopped'.
    (
        "M9 · the receiver of a message that stopped its turn is not told who asked for the stop "
        f"· killed by `{NOW}`",
        [(ORIGIN,
          "  const stopped = interrupting === undefined ? '' : `\\n\\n${theStopBehindIt(who)}`\n",
          "  const stopped = ''\n")],
    ),
    # '🔴 an answer that asks for it stops the asker’s turn, and the asker reads who asked and that its
    # questions stay open' — the asker is handed the stop line on the app's answer notice.
    (
        "M10 · an answer that stopped the asker's turn arrives with no line saying who stopped it or "
        f"that its questions are still open · killed by `{NOW}`",
        [(ORIGIN,
          "    return interrupting === undefined\n"
          "      ? text\n",
          "    return true\n"
          "      ? text\n")],
    ),
    # '⚑ THE CONTROL: an answer AT the bound is taken and arrives whole, …' — an answer with no
    # `interrupt` must ask the stop, so its receipt names the person's card that refused it.
    (
        "M11 · an answer stops the asker's turn only when it says interrupt: true, the pre-c118ae04 "
        f"default, so a plain answer waits behind the whole turn · killed by `{R18}`",
        [(TOOLS,
          "              interrupt: interruptAsked !== false,\n",
          "              interrupt: interruptAsked === true,\n")],
    ),
    # '⚑ …and the control: an answer with interrupt: false is held and stops nothing' —
    # `asked_to_stop` undefined and no `work_interrupted`.
    (
        "M12 · interrupt: false on an answer is ignored, and the asker's turn is stopped anyway "
        f"· killed by `{NOW}`",
        [(TOOLS,
          "              interrupt: interruptAsked !== false,\n",
          "              interrupt: true,\n")],
    ),
    # '⚑ THE CONTROL: …' — the receipt must be 'Your answer is held for …', never '… has your answer
    # and can go on'.
    (
        "M13 · an answer held behind a turn that was not stopped is reported as already with the asker "
        f"· killed by `{R18}` · killed by `a-helper-stopped-on-a-persons-approval.test.ts`",
        [(TOOLS,
          "          const waitsForItsTurn = answered.held === true && answered.stop?.stop !== 'asked'\n",
          "          const waitsForItsTurn = false\n")],
    ),
    # '⚑ THE CONTROL: …' — the receipt's reason must be that the turn waits for a person's answer.
    (
        "M14 · a turn parked on a person's card is reported as one that could not be asked to stop, "
        f"and the receipt points to interrupt_agent · killed by `{R18}`",
        [(HOST,
          "      if (refusal.rail === 'a-person-is-being-asked') {\n"
          "        return { stop: 'a-person-is-being-asked', askedOf: null }\n"
          "      }\n"
          "      if (refusal.rail === 'it-is-waiting-on-an-answer') {\n",
          "      if (refusal.rail === 'it-is-waiting-on-an-answer') {\n")],
    ),
]
