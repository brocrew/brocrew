"""670 · The hold, at every door.

⛔ **Ordered from `657`'s own findings F-b, F-c, F-d and F-e.** `657` made a lost race HOLD at
`queueMessage`, so every agent and app door held, and the person's own doors did not.

## 🔴 A · what the dispatch CHANGED

⚑ **The person's three doors hold a lost race.** The composer's send (`send` → `sendAs`), the
interrupt-and-send's replacement, and the plan go-ahead each catch `TurnInProgress` BY CLASS and hand
the words to `queueAs(…, 'after-a-lost-race')`. The first two hold them as the caller's words, so the
flush stamps a person `human` and asks the attachment rule again. ⛔ The go-ahead holds them as
`THE_APP_ITSELF`'s, so the flush sends BroBot's sentence with no frame and no stamp, and writes the
`app_authored` row the direct send writes by hand. Every other failure still says what it always said.

⚑ **The latch holds arrivals** (from the review): `queueAs` reads a conversation whose person is
mid interrupt-and-send as busy, so a reply or a `message_agent` waits behind the replacement.

⚑ **F-d.** `runFlush` answers whether it ended its head without starting a turn (a vanished
attachment, or a sign-in that moved on), and `flushQueued` goes again when it did, bounded by the
mailbox. ⚑ **F-e.** The interrupt-and-send builds its row before the handover.

## ⛔ B · F-c was NOT done, and `M9` is the brief's own fix

⚠️ **Claude's *"the turn was stopped before its message could be sent"* is not a lost race.** It is
raised when `interrupt()` force-ended the turn this send had opened, so a person STOPPED it. Typing it
as `TurnInProgress` hands it to every hold, and the words go out after the person's next message: the
message they gave up on. `claude-runtime.test.ts`' `H5 · …and it is THIS turn` goes red under it too.

## ⚠️ C · rows this dispatch corrected elsewhere, and why none was retired

⚑ **Corrected in place and re-verified RED by hand**: `234 M1`, `234 M2`, `262 M36`, `414 M8`,
`414 M23`, `657 M7`. The shapes: `runFlush`'s early returns say `false` now (`234`); two handovers
sit in a `try` (`262`, `414`); and the interrupt-and-send builds its row before the handover as
`send` does, so `this.publishOurs(session, turn)` occurs twice and `657 M7` takes the line above it.
No subject died.

## ⚠️ D · what no row here can measure

⛔ **A held go-ahead is drawn as the person's queued message until it flushes.** `message_queued`
carries no attribution by `413`'s design, and the go-ahead is the one app-authored turn with no
subject. That is the renderer's to draw, and no host row can make it otherwise.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the composer's send ─────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the composer's send stops holding** · the defect this dispatch was ordered for, "
        "put back: a person who loses to an agent's turn is shown the adapter's sentence",
        [
            (
                HOST,
                "      if (how.ifItLosesTheRace === 'pass-it-on' || !(error instanceof TurnInProgress)) throw error\n",
                "      if (how.ifItLosesTheRace === 'pass-it-on' || error instanceof Error) throw error\n",
            )
        ],
    ),
    (
        # ⚑ Landing D-017 (45a11477) · killer:
        # `a-second-send-that-starts-the-conversation-is-held-behind-the-first.test.ts` (the landing
        # added it: the old killer only sends to a conversation already running).
        "M2 · 🔴 **the public door asks the body to pass a lost race on** · the hold is written and "
        "nothing reaches it, one word at the one line every person's send goes through",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The `hold-it` vs
        # `pass-it-on` race-handling mechanism in `sendAs` is byte-for-byte unchanged in behaviour;
        # D-017 only added a fast 'deliver now' branch ahead of it, so the public `send()` door's
        # one `return this.sendAs(...)` statement became a `const send = () => this.sendAs(...)`
        # closure passed into `deliverWhenItRuns`. The literal text minus the now-absent `return `
        # keyword is still unique and still the one path every ordinary person's send that can't go
        # in immediately funnels through.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The public send door's
        # hold-it/pass-it-on mechanism in `sendAs` is unchanged in behaviour; D-017 added a fast
        # 'deliver now' branch (with `onAStop`) ahead of it, so the old direct `return
        # this.sendAs(sessionId, ...)` split into an immediate call (now carrying `onAStop`) and a
        # `send = (to) => this.sendAs(to, ...)` closure used for a conversation that must start
        # first — the exact scenario the row's own killer test drives. The closure's literal text is
        # still unique and is the one path an ordinary send that cannot go in immediately funnels
        # through.
        [
            (HOST, "this.sendAs(to, text, by, attachments, { facts, ifItLosesTheRace: 'hold-it' })", "this.sendAs(to, text, by, attachments, { facts, ifItLosesTheRace: 'pass-it-on' })"),
        ],
    ),
    (
        "M3 · ⚠️ **the held send loses its attachments** · the words go out at the flush without the "
        "file the person attached, and the attachment rule is asked of nothing",
        [
            (
                HOST,
                "        by,\n        attachments,\n        'work',\n        how.facts,",
                "        by,\n        [],\n        'work',\n        how.facts,",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the held send is a NOTICE** · a person may not take a notice back, so the words "
        "they sent are theirs until they go and not a moment longer",
        [(HOST, "        'work',\n        how.facts,", "        'notice',\n        how.facts,")],
    ),
    (
        "M5 · 🔴 **the held send is ALSO recorded as a turn** · a `user_turn` for words the provider "
        "has not been handed, and a second one when they flush",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — D-017 threaded one extra
        # `how.onAStop` argument through the same `queueAs(..., 'after-a-lost-race', ...)` call in
        # `sendAs`'s catch branch, so the old literal no longer matches, but the `return`
        # immediately after that call — which stops execution from falling into the turn-publishing
        # code below — is untouched and still guards exactly the same fall-through.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule stands: after the lost-race hold in sendAs's catch branch the `return` still keeps
        # held words from falling into the `publishOurs(session, turn)` below. D-016c changed the
        # re-queue call's last argument to `how.onAStop === undefined ? undefined : again`, so the
        # old `how.onAStop,` line matches nothing; the new anchor carries that line. The plant
        # removes the same `return`. Killed by `the-hold-at-every-door.test.ts`.
        [
            (HOST, "        'after-a-lost-race',\n        how.onAStop === undefined ? undefined : again,\n      )\n      return\n    }\n    // A turn is where a queued mode change", "        'after-a-lost-race',\n        how.onAStop === undefined ? undefined : again,\n      )\n    }\n    // A turn is where a queued mode change"),
        ],
    ),
    (
        "M6 · 🔴 **the composer's send holds EVERY failure, not only the typed race** · a turn a "
        "person STOPPED is held and sent after their next message (by CLASS, never by text)",
        [
            (
                HOST,
                "      if (how.ifItLosesTheRace === 'pass-it-on' || !(error instanceof TurnInProgress)) throw error\n",
                "      if (how.ifItLosesTheRace === 'pass-it-on' || !(error instanceof Error)) throw error\n",
            )
        ],
    ),
    # ── B · the interrupt-and-send ──────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 **the interrupt-and-send's replacement is refused again** · the running turn is "
        "already gone and the words the person wanted instead are refused with the adapter's sentence",
        [
            (
                HOST,
                "      if (!(error instanceof TurnInProgress)) throw error\n      await this.queueAs(\n        session.id,",
                "      if (error instanceof Error) throw error\n      await this.queueAs(\n        session.id,",
            )
        ],
    ),
    (
        "M8 · ⚠️ **the held replacement is ALSO recorded as a turn** · the ledger says the person's "
        "words were sent while they wait behind somebody else's",
        [
            (
                HOST,
                "        'after-a-lost-race',\n      )\n      return\n    }\n    // ⚠️ **Was missing, and 077",
                "        'after-a-lost-race',\n      )\n    }\n    // ⚠️ **Was missing, and 077",
            )
        ],
    ),
    # ── C · `657` F-c, the brief's own fix ──────────────────────────────────────────────────────
    (
        "M9 · ⛔ **THE BRIEF'S F-c FIX · Claude's pre-push stop is typed as a lost race** · every "
        "hold takes it, and a message whose turn a person STOPPED is sent after their next one",
        [
            (
                CLAUDE,
                "    if (this.terminated || this.machine.activeTurnId !== turnId) {\n"
                "      throw new Error('the turn was stopped before its message could be sent')",
                "    if (this.terminated || this.machine.activeTurnId !== turnId) {\n"
                "      if (!this.terminated && this.machine.activeTurnId !== null) throw this.machine.refusedTurn()\n"
                "      throw new Error('the turn was stopped before its message could be sent')",
            )
        ],
    ),
    # ── D · the plan go-ahead ───────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 **the go-ahead's lost race is a failure again** · the plan is released and the "
        "person is told the go-ahead was not sent, because another sender won by a microtask",
        [
            (
                HOST,
                "      if (error instanceof TurnInProgress) {\n        try {",
                "      if (error === undefined) {\n        try {",
            )
        ],
    ),
    (
        "M11 · ⛔ **the go-ahead holds EVERY failure** · an adapter that refused the go-ahead for a "
        "reason other than a race is answered with a hold, and the person is told nothing went wrong "
        "(a conversation that ended is still refused by the hold's own gates)",
        [
            (
                HOST,
                "      if (error instanceof TurnInProgress) {\n        try {",
                "      if (error instanceof Error) {\n        try {",
            )
        ],
    ),
    (
        "M12 · 🔴 **the held go-ahead is the PRESSER's words** · it flushes framed as the person's, "
        "stamped `human`, and recorded as a turn they typed: `278` §1 and `662` M10 at once",
        [
            (
                HOST,
                "            THE_APP_ITSELF,\n            [],\n            'work',",
                "            by,\n            [],\n            'work',",
            )
        ],
    ),
    (
        "M13 · ⚠️ **a held go-ahead is reported as not sent** · the person is told to type their next "
        "message while the go-ahead waits to go",
        [
            (
                HOST,
                "        return\n      }\n      // ⚑ **Anything else is a real failure**",
                "      }\n      // ⚑ **Anything else is a real failure**",
            )
        ],
    ),
    # ── E · `657` F-d ───────────────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 **a flush that ends its head without a turn does not go again** · `657` F-d put "
        "back: a message held behind it waits on a free conversation for a boundary that never comes",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The rule survives and the line is still there, only renamed by D-027
        # (`endedItsHeadWithoutATurn` is now `endedWhatItTookWithoutATurn`): a flush that ended what
        # it took without starting a turn must flush again. It is now reachable only for what a take
        # leaves behind: a person's command (which goes alone), anything past 64, or a message that
        # arrived mid-flush. the-hold-at-every-door §4 was re-aimed because the follower now goes in
        # the head's own take, and DEV removed the one case that reached the repeat (DEV writes no
        # tests), so no test was red under this plant. The landing added it: killed by
        # `a-command-left-behind-by-a-flush-that-started-no-turn-goes-at-once.test.ts`, RED alone.
        [
            (HOST, '        if (endedWhatItTookWithoutATurn) this.flushQueued(session)\n', ''),
        ],
    ),
    (
        "M15 · ⚠️ **a vanished attachment is reported as a turn started** · the one head ending the "
        "repeat is for, answered wrong",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 (2f080601) moved the vanished-attachment ending out of runFlush into readyToGo,
        # which returns null; runFlush now answers `true` ("ended what it took without a turn") on
        # `if (going.length === 0) return true`. The rule survives (the repeat flush is still owed
        # to whatever is left behind), but D-027 puts every follower in the head's own take, so no
        # existing test left a message behind a fully-ended take, and the row SURVIVED. The landing
        # added that case: killed by
        # `a-command-left-behind-by-a-flush-that-started-no-turn-goes-at-once.test.ts`, RED alone.
        [
            (HOST, '    // after it may go now.\n    if (going.length === 0) return true\n', '    // after it may go now.\n    if (going.length === 0) return false\n'),
        ],
    ),
    (
        "M16 · ⚠️ **a sign-in that moved on is reported as a turn started** · every message behind "
        "the first waits for teardown to be told the same thing",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · the anchor still applies, but D-027
        # puts every follower in the head's own take, so no test left a message behind and the row
        # SURVIVED. The landing added that case: killed by
        # `a-command-left-behind-by-a-flush-that-started-no-turn-goes-at-once.test.ts`, RED alone.
        [
            (
                HOST,
                "        // each of them the same way, now, rather than at teardown.\n        return true",
                "        // each of them the same way, now, rather than at teardown.\n        return false",
            )
        ],
    ),
    (
        "M17 · ⛔ **the repeat is unbounded** · a head LEFT waiting (a sign-in read that did not "
        "answer) is flushed again at once, and again, instead of at the next boundary",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — D-027 renamed the flush's answer variable (`endedItsHeadWithoutATurn` became
        # `endedWhatItTookWithoutATurn`), so the anchor went dark; the rule (the repeat is bounded:
        # only a flush that ended what it took without a turn goes again) is unchanged. §4's
        # 'bounded the other way' case is untouched by D-027 and still pins it: a sign-in read that
        # fails leaves both held messages waiting, and the flush must ask once. Killed by
        # `the-hold-at-every-door.test.ts`.
        [
            (HOST, '        if (endedWhatItTookWithoutATurn) this.flushQueued(session)\n', '        this.flushQueued(session)\n'),
        ],
    ),
    # ── G · the latch, from the review ────────────────────────────────────────────────────────────
    (
        "M19 · 🔴 **an arrival takes the turn from a person's interrupt-and-send** · the review's "
        "finding put back: a reply lands in the gap, the replacement loses after the turn it "
        "replaced is gone, and with the person's own message queued it is REFUSED",
        [
            (
                HOST,
                # ⚑ **RE-ANCHORED at `698`, not retired**: the read is `itTakesAMessageStraightIn`'s
                # one-line `return` now (`690` F-1). The latch clause still goes.
                "    return mode === 'as-it-finds-it' && session.handle.status() === 'idle' && !session.holdingQueue\n",
                "    return mode === 'as-it-finds-it' && session.handle.status() === 'idle'\n",
            )
        ],
    ),
    # ── F · `657` F-e ───────────────────────────────────────────────────────────────────────────
    (
        "M18 · 🔴 **the interrupt-and-send reads who sent it AFTER the handover** · `657` F-e put "
        "back: a read that fails there reports a delivered interruption as failed · killed by `the-hold-at-every-door.test.ts` (named by W4.139)",
        [
                # ⚑ **713 · corrected in place** (standing rule 27): the interrupting handover hands over
                # its first gate's answer (`decided`, `708` H-4), so the call gained an argument. Same
                # rule, same replacement; re-verified RED alone, killer named in 713's response.
                # ⚑ **W4.136 · re-anchored in place, not retired** — F033 gave handToProvider the piece the words drive (null here), so the call reads one argument longer
                # ⚑ **W4.147 · re-anchored in place, not retired** — F088 gave handToProvider the piece an agent's note or follow-up names, after the piece the words drive, and prettier put the call on one argument per line; same rule, same plant (null here): the plant still moves the read of who sent it after the handover
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Current-turn fencing changed this boundary; the original defect and killer are preserved. No plant or table run. Held: running it needs W4 written lift.
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Current-handoff association changed this boundary; the same interrupting-authorship removal or unframed send defect and killer remain. No plant or table run. Held: running it needs W4 written lift.
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Current-handoff association changed this boundary; the same interrupting-authorship removal or unframed send defect and killer remain. No plant or table run. Held: running it needs W4 written lift.
                # ⚑ **W4.475 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The interrupting handover now also hands over its turn row, whose authorship says whose turn it is; the plant still drops that authorship from the row before the handover and reads it after, at the publish, so the same defect and killer stand. With the plant, the row handed over also reads as a person's. No plant or table run.
                # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Retain the original deferred interrupting-authorship read together with edit0 and preserve current-handoff association. No plant or table run. Held: running it needs W4 written lift.
            ('apps/desktop/src/main/runtime/runtime-host.ts', "      ...whoseWordsTheseAre(by, this.profileOf),\n    }\n    if (\n      aPersonIsAsking(by) &&\n      sessionSpeakingAs(by) === null &&\n      TURN_ATTRIBUTION_KEYS.every((key) => turn[key] === undefined)\n    )\n      this.declineMoveOffersFromText(session.id, by)\n    const moveHandoff = this.beginMoveHandoff(\n      session,\n      TURN_ATTRIBUTION_KEYS.every((key) => key === 'movedFrom' || turn[key] === undefined),\n    )\n    const personalWorkTurnBefore = session.personalWorkTurn\n    const personalHandover = session.personalHandover + 1\n    try {\n      await this.handToProvider(\n        session,\n        text,\n        handed.paths,\n        null,\n        null,\n        null,\n        this.originOf(by),\n        turn,\n        decided,\n      )", "    }\n    if (\n      aPersonIsAsking(by) &&\n      sessionSpeakingAs(by) === null &&\n      TURN_ATTRIBUTION_KEYS.every((key) => turn[key] === undefined)\n    )\n      this.declineMoveOffersFromText(session.id, by)\n    const moveHandoff = this.beginMoveHandoff(\n      session,\n      TURN_ATTRIBUTION_KEYS.every((key) => key === 'movedFrom' || turn[key] === undefined),\n    )\n    const personalWorkTurnBefore = session.personalWorkTurn\n    const personalHandover = session.personalHandover + 1\n    try {\n      await this.handToProvider(\n        session,\n        text,\n        handed.paths,\n        null,\n        null,\n        null,\n        this.originOf(by),\n        turn,\n        decided,\n      )"),
            ('apps/desktop/src/main/runtime/runtime-host.ts', '    // refused to send while a turn ran — so no user could reach it, and nobody noticed.\n    this.publishStateIfChanged(session)\n    this.publishOurs(session, turn, undefined, moveHandoff, personalHandover)\n', '    // refused to send while a turn ran — so no user could reach it, and nobody noticed.\n    this.publishStateIfChanged(session)\n    this.publishOurs(session, { ...turn, ...whoseWordsTheseAre(by, this.profileOf) }, undefined, moveHandoff, personalHandover)\n'),
        ],
    ),
]
