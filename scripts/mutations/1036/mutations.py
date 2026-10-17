"""1036 · D-036 · an agent waiting on its own helper says so, not *idle*.

⚑ **Why `1036`**: card D-00N's table is `100N`. D-036 is one DEV commit, `ea3cf258`, landed through
the frontend's merge `7d54be3b`: it conflicted with the `ui` card in `AgentCard.vue`.

## What it changed

The one state gains a seventh arm, `waiting-on-a-worker`, after *scheduled* and before *idle*: a
conversation otherwise idle while a piece it gave is still open reads *waiting on Ali (the owner of …)*,
each helper named once, *+N* for the rest. A stand-in counts what the conversations it replaced gave.
Every surface takes it from the host, and it moves when the fact moves.

 * `M1`–`M12` — killed by the landing's `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`
   (`M1` by two older files).

Designed read-only by a Sonnet 5.5 agent from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 12 of 12.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `7b046154` (the merges of `7d54be3b` and `4c598c4b`), none by a syntax, reference or type error.
  Each killer file ran green unmutated first.
"""

RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
AGENT_STATE = "apps/desktop/src/renderer/src/lib/agent-state.ts"
CONVERSATION_WAITS = "apps/desktop/src/renderer/src/lib/conversation-waits.ts"
AGENT_STATE_SHARED = "apps/desktop/src/shared/agent-state.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · The worker arm outranks the schedule: agentStateArm asks waitingOnAWorker before scheduled, so a conversation with a wake-up ahead and work out says 'waiting on X' and hides its schedule — killed by `the-one-state-ranks-its-six-facts-in-one-order.test.ts`, `three-surfaces-read-the-new-field.test.ts`",
        [
            (AGENT_STATE_SHARED, "  if (facts.scheduled) return 'scheduled'\n  if (facts.waitingOnAWorker) return 'waiting-on-a-worker'\n  return 'idle'\n", "  if (facts.waitingOnAWorker) return 'waiting-on-a-worker'\n  if (facts.scheduled) return 'scheduled'\n  return 'idle'\n"),
        ],
    ),
    (
        "M2 · agentStateOf never reaches the worker arm: the holders are named by the host but the derivation says idle, so every door and the push keep saying idle for a giver — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            (AGENT_STATE_SHARED, "    waitingOnAWorker: first !== undefined,\n", "    waitingOnAWorker: false,\n"),
        ],
    ),
    (
        "M3 · agentStateWords drops the ' +N': several holders read as the first alone, so a giver with two helpers names one and hides the other — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            # ⚑ **W4.584 · re-anchored in place, not retired** — the worker words now lead with a stopped piece or the first holder (`lead`); the plant still drops the ' +N'
            (AGENT_STATE_SHARED, "      return more.length === 0 ? lead : `${lead} +${String(more.length)}`\n", "      return lead\n"),
        ],
    ),
    (
        "M4 · The holders are not named once each: one conversation holding two open pieces is named twice, so the words say '+1' for a single helper — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033 reads the gives once (`gaveOut`), to name each holder by the oldest piece it holds from this one; the plant still names a holder of two pieces twice
            # ⚑ **W4.586 · re-anchored in place, not retired** — the holders are now named from the gives whose holder has not stopped with them (`stillWith`); the plant still names a holder of two pieces twice. Source-only, NOT VERIFIED.
            (RUNTIME_HOST, "    const workIsWith = [...new Set(stillWith.map((one) => one.owner))]\n", "    const workIsWith = stillWith.map((one) => one.owner)\n"),
        ],
    ),
    (
        "M5 · A give no longer marks its giver: the giver's kept work-out read stays empty, so the window is never told it is waiting on its helper — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            (RUNTIME_HOST, "    event.type === 'work_given' ||\n    event.type === 'work_replied' ||\n", "    event.type === 'work_replied' ||\n"),
        ],
    ),
    (
        "M6 · A reply no longer marks its giver: the giver keeps reading 'waiting on' a helper whose piece is answered — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            (RUNTIME_HOST, "    event.type === 'work_replied' ||\n    event.type === 'work_taken_back' ||\n", "    event.type === 'work_taken_back' ||\n"),
        ],
    ),
    (
        "M7 · A replacement no longer re-reads the work out of the old conversation and its stand-in: the stand-in keeps the empty read it derived while still starting and says idle for the work it inherited — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            (RUNTIME_HOST, "      this.theWorkItGaveMoved(conversation)\n      this.theWorkItGaveMoved(event.sessionId)\n", ""),
        ],
    ),
    (
        "M8 · A stand-in counts only the work it gave itself: the work the conversation it replaced gave is lost from its word — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            (RUNTIME_HOST, "      const read = this.theIdsItStandsFor(id)\n        .flatMap((one) => this.deps.store.piecesGivenBy(one, unread))\n", "      const read = [id]\n        .flatMap((one) => this.deps.store.piecesGivenBy(one, unread))\n"),
        ],
    ),
    (
        "M9 · A replaced conversation still counts the work it gave: the dead id and its stand-in both say 'waiting on' the same helper — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033 reads whether another conversation took its place once, for the gives and the owed answers; the plant still counts a replaced conversation's gives
            (RUNTIME_HOST, "    const gaveOut = itStandsForItself ? workOut(sessionId) : []\n", "    const gaveOut = workOut(sessionId)\n"),
        ],
    ),
    (
        "M10 · The giver's card counts a torn row in a HELPER's ledger on its own record: 'its record could not be read' is blamed on the giver — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            (RUNTIME_HOST, "    const ledger = this.oneLedgerReadPerAnswer(unread)\n    const workOut = this.oneWorkOutReadPerAnswer(rowsUnreadOnce())\n    return {\n      agent: slot.id,\n", "    const ledger = this.oneLedgerReadPerAnswer(unread)\n    const workOut = this.oneWorkOutReadPerAnswer(unread)\n    return {\n      agent: slot.id,\n"),
        ],
    ),
    (
        "M11 · The window reads the composition's own `waiting` instead of the host's verdict for the worker wait: a giver the host says holds open work reads idle on the rail, and a conversation holding none keeps a stale worker word — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            # ⚑ **W4.584 · re-anchored in place, not retired** — the worker wait now also counts the host's stopped pieces (`workOut`); the plant still reads the composition's own `waiting` instead of the host's verdict
            (CONVERSATION_WAITS, "  return workOut > 0 ? 'waiting-on-a-worker' : null\n", "  return row.waiting === 'waiting-on-a-worker' ? row.waiting : null\n"),
        ],
    ),
    (
        "M12 · facetsOfState draws the worker arm as plain idle: an agent-started conversation waiting on its helper is a green idle dot and counts as idle on the rail and the team roster — killed by `a-giver-says-who-holds-the-work-it-gave-out.render.test.ts`",
        [
            (AGENT_STATE, "    case 'waiting-on-a-worker':\n      return { doing: 'idle', waiting: 'waiting-on-a-worker' }\n", "    case 'waiting-on-a-worker':\n      return { doing: 'idle' }\n"),
        ],
    ),
]
