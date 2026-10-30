"""3002 · the automatic reopen on a moved Claude sign-in, and F076 — `e0e93e6e`, `c006ea64`.

⛔ **The defect `e0e93e6e` fixed**: once this Mac's Claude login was renewed, a live conversation
still held the token it started with, so its turn gate refused everything sent to it, an agent's
words included, and a flush ENDED what was already held (`abandoned`). A team running at night
stopped until a person pressed Reopen on each conversation. ⚑ Now an agent's or the app's words are
held, never refused; the app reopens the conversation on the current sign-in as soon as that would
lose nothing (`whatAReopenWaitsFor`: no turn, no card, no background work, no planning); the sender
is told why it waits (`whyItWaitsForItsSignIn`, `A_REOPEN_WAITS_FOR`); a life that reads as moved on
again within ten minutes is left for a person (the loop guard); and the reopen says so,
`reopened.because: 'the-sign-in-moved-on'`, with a transcript line naming its cost.

⛔ **The defect `c006ea64` (F076) fixed**: a turn that failed on a refused login was reopened with
nothing sent in, so a wake for finished background work was lost. ⚑ The runtime marks the failed
turn (and the terminal status) `loginRefused`; the fold stalls what that turn drove `login_refused`;
the givers are told nothing while the reopen is decided, and are asked once it has been.

## ⚑ What a row here measures

 * ⚑ **M1–M2 are the defect, verbatim** — an agent's words refused like a person's, and the flush
   ending what it held.
 * ⚑ **M3–M6 are what the reopen waits for** — a running turn, a card, background work, planning,
   each dropped from `whatAReopenWaitsFor` in turn; ⚑ **M7** is background work's end releasing it.
 * ⚑ **M8 is the loop guard**; **M9** the sender's receipt saying why; **M10–M11** the reopen saying
   so, on the row and in the transcript.
 * ⚑ **M12–M14 are F076** — the runtime's `loginRefused`, the fold reading it off the `turn` row,
   and the givers asked again once the reopen is decided.

## ⛔ What this table cannot reach today

 * ⚠️ **`endPlanMode`'s `reopenForWhatWaits`** — planning's end releasing the reopen. The planning
   test pins only that planning holds it; no test ends the plan and waits for the reopen.
 * ⚠️ **`aReopenIsOwedFor` widened to a person's own words** — no test queues a person's words alone
   on a moved sign-in and asserts the app does NOT reopen for them.
 * ⚠️ **The loop guard's disarm** (`delete session.reopenedForWhatWaited` when the sign-in reads
   current) and its carry into a replacement (`replaced_by`) — no test reaches a second moved
   sign-in after a good one, nor a reopen that could never be made.
 * ⚠️ **F076's notice to the reopened conversation** (`aRefusedLoginStoppedText`,
   `whatItsFailedTurnWasFor`, the drop when the reopen fails), **the giver deferral itself**
   (`aReopenIsBeingDecidedFor.has(piece.owner)`), **the status arm's `onARefusedLogin`**, and
   **`theLoginSentence`** in `reply-rails.ts` — nothing drives `reopenOnARenewedSignIn` over a
   `loginRefused` failure, and the night's backlog plants only a `turn` row. ⚑ M14 is the one
   piece of the deferral a census pins.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
CLAUDE_RUNTIME = "packages/runtime/src/claude/claude-runtime.ts"

HELD = "a-moved-sign-in-holds-what-agents-send.test.ts"
SAYS_WHY = "a-reopen-by-itself-says-so-and-says-why.test.ts"
SUPERSEDE = "apps/desktop/test/sign-in-supersede.test.ts"
EVERY_DOOR = "the-hold-at-every-door.test.ts"
RUNTIME = "claude-runtime.test.ts"
BACKLOG = "a-nights-backlog-rehearsed.render.test.ts"
PUSH = "the-push-that-does-not-survive-a-launch.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # `🔴 an idle conversation is reopened at once, on the current sign-in, and the words are not
    # ended` — `said.structured` toMatchObject `{ outcome: 'ok' }` meets a refusal.
    (
        "M1 · an agent's words to a conversation whose sign-in moved on are refused, as a person's "
        f"are — the defect, verbatim · killed by `{HELD}`",
        # ⚑ Re-anchored in place, not retired — a person's words are carried too now, outside the
        # loop guard; the plant refuses everyone's, an agent's included, which is this defect.
        [(HOST,
          "    return !aPersonIsAsking(by) || !this.itsReopenDidNotHelp(session)\n",
          "    return false\n")],
    ),
    # `🔴 the sign-in moved on: no held message is ended — this app reopens it on the current one,
    # and once only` — no `reopened` ever comes, and the two held messages end `abandoned`.
    (
        "M2 · the flush that meets a moved sign-in ends every held message `abandoned` again, and "
        f"nothing is left for the reopen to carry — the defect, verbatim · killed by `{EVERY_DOOR}`",
        [(HOST,
          "      // carries them to the new start, which sends them first ({@link reopenForWhatWaits}).\n"
          "      return false\n",
          "      // carries them to the new start, which sends them first ({@link reopenForWhatWaits}).\n"
          "      if (error instanceof ItsSignInMovedOn && still.length > 0) {\n"
          "        for (const { queued } of still) {\n"
          "          this.takeQueued(session, queued)\n"
          "          this.publishOurs(session, {\n"
          "            type: 'message_unqueued',\n"
          "            messageId: queued.id,\n"
          "            reason: 'abandoned',\n"
          "            text: queued.text,\n"
          "            detail: 'the machine sign-in moved on while this message was waiting',\n"
          "            ...(queued.attachments.length > 0 ? { attachments: [...queued.attachments] } : {}),\n"
          "            ...queued.authorship,\n"
          "          })\n"
          "        }\n"
          "        this.theWorldMoved('work')\n"
          "        this.publishStateIfChanged(session)\n"
          "        return true\n"
          "      }\n"
          "      return false\n")],
    ),
    # `🔴 a turn in progress is not cut: the words are held, the receipt says the reopen comes when
    # the turn ends` — the receipt says the reopen is under way, and a `reopened` cuts the turn.
    (
        "M3 · a running turn is not something a reopen waits for — the app cuts it to reopen · "
        f"killed by `{HELD}`",
        [(HOST,
          "      status !== 'idle' ||\n"
          "      session.holdingQueue > 0 ||\n",
          "      session.holdingQueue > 0 ||\n")],
    ),
    # `🔴 a card waiting on a person holds the reopen until it is answered` — the receipt reads
    # "once its turn ends", not "once the question or permission it is waiting on is answered".
    (
        "M4 · a card waiting on a person is read as a turn, and the sender is told the wrong wait · "
        f"killed by `{HELD}`",
        [(HOST,
          "    if (status === 'waiting_permission') return 'a-person'\n",
          "")],
    ),
    # `⛔ work in the background holds the reopen, because a reopen would stop it — and its end
    # releases it` — the receipt lacks the background sentence, and the reopen stops the work.
    (
        "M5 · work running in the background does not hold the reopen — the app stops it to reopen · "
        f"killed by `{HELD}`",
        [(HOST,
          "    if (somethingRunning(session.background)) return 'its-background-work'\n",
          "")],
    ),
    # `⛔ planning holds the reopen, because a reopen would end the plan` — the receipt lacks
    # "once a person ends its planning", and a `reopened` ends the plan.
    (
        "M6 · planning does not hold the reopen — the app ends the plan to reopen · "
        f"killed by `{HELD}`",
        # ⚑ Re-anchored in place, not retired — planning is read as asked for now; the plant drops
        # the wait, which is this defect.
        [(HOST,
          "    if (session.handle.settings.planMode.requested) return 'its-planning'\n",
          "")],
    ),
    # `⛔ work in the background holds the reopen … — and its end releases it` — the last
    # `waitFor` ("the reopen once the work has ended") times out: nothing asks again.
    (
        "M7 · the background work's end does not ask again — the reopen held for it never comes · "
        f"killed by `{HELD}`",
        [(HOST,
          "    if (event.type === 'background_work') this.reopenForWhatWaits(session)\n",
          "")],
    ),
    # ⚠️ **M8 · dropped by W4.78 before it was committed**: the ten-minute loop guard defeated
    # (`return false`) makes `sign-in-supersede.test.ts` reopen without end — the test HANGS rather
    # than fails, so the row cannot be measured (it held a batch for 30 minutes). A bounded test of
    # the guard would make it a row.
    # `🔴 a turn in progress is not cut: …` — `said.text` lacks "This Mac’s Claude sign-in changed
    # after it started." (the idle case's receipt too).
    (
        "M9 · a receipt for words held for a moved sign-in says only *until it is free* — never "
        f"that the sign-in changed, nor what the reopen waits for · killed by `{HELD}`",
        [(HOST,
          # ⚑ **a helper stopped on a person · re-anchored in place, not retired** — the seam gained a reason between the sign-in's and the limit's (a person's answer its turn is stopped on) and spread over lines; the plant still drops the sign-in reason, so a receipt for words held for a moved sign-in says nothing of it
          "      this.whyItWaitsForItsSignIn(sessionId) ??\n      this.whyItWaitsForAPerson(sessionId, itsStopIsSaid) ??\n",
          "      this.whyItWaitsForAPerson(sessionId, itsStopIsSaid) ??\n")],
    ),
    # `🔴 an idle conversation is reopened at once, …` — `reopenedFor(receiver.id)` toEqual
    # `[{ type: 'reopened', because: 'the-sign-in-moved-on' }]` meets a bare `{ type: 'reopened' }`.
    (
        "M10 · the app's own reopen on the current sign-in is recorded as a plain reopen — the row "
        f"never says why · killed by `{HELD}`",
        [(HOST,
          # ⚑ **F098 · re-anchored in place, not retired** — the reopened row is built by spreads now, so it can also carry the sentence a start that brought it back from the archive writes; the same `why`, so M10 still drops the app's own reason.
          "      ...(why === undefined ? {} : { because: why }),\n",
          "      ...(because === undefined ? {} : { because }),\n")],
    ),
    # `🔴 a reopen for what waited draws one warning that names the cost` — no notice is drawn.
    (
        "M11 · the transcript draws no line for a reopen on the current sign-in — the lost "
        f"*allow for this session* approvals go unsaid · killed by `{SAYS_WHY}`",
        [(TRANSCRIPT,
          "      if (event.because === 'the-sign-in-moved-on') notice(state, 'warn', REOPENED_FOR_WHAT_WAITED)\n",
          "")],
    ),
    # `ends the session, fails the turn, and refuses to take another message` — the `failed` turn
    # and the `errored` status lack `loginRefused: true`.
    (
        "M12 · F076 — a turn Claude failed on a refused login is not marked `loginRefused` · "
        f"killed by `{RUNTIME}`",
        [(CLAUDE_RUNTIME,
          "            if (event.cause === 'auth_stale' || event.cause === 'auth') loginRefused = true\n",
          "")],
    ),
    # `reads digest, then queue, then attempts only the transcripts …` — `sess_stall_login_refused`'s
    # piece is `stalled` with `stalledBecause: 'turn_ended'`, not `'login_refused'`.
    (
        "M13 · F076 — the fold does not read `loginRefused` off a failed `turn` row: the work it "
        f"drove stalls *its turn ended* · killed by `{BACKLOG}`",
        [(TASKS,
          # ⚑ **W4.91 · re-anchored in place, not retired** — 05eb3115 added a second turn-end reading of loginRefused (a cut turn's); the row stays on the plain turn's
          "      theLimitItEndedOn(event, entry.at),\n        event.state === 'failed' && event.loginRefused === true,\n",
          "      theLimitItEndedOn(event, entry.at),\n        false,\n")],
    ),
    # `⛔ the triggers are named call sites, and each one is a thing that HAPPENED` — the census of
    # `tellWhoeverGaveTheWork` callers is one short.
    (
        "M14 · F076 — once the reopen after a refused login is decided, the givers held silent "
        f"through it are never asked again · killed by `{PUSH}`",
        [(HOST,
          "    else this.aReopenIsBeingDecidedFor.delete(sessionId)\n"
          "    this.tellWhoeverGaveTheWork(sessionId)\n",
          "    else this.aReopenIsBeingDecidedFor.delete(sessionId)\n")],
    ),
]
