"""395 · the interruption that looks like a provider fault — each row is THE DEFECT, put back.

🔴 **S5, and the requirement is not *"interrupting works"*.** ⛔ **Interrupt a turn and the provider
stops mid-sentence, which is what a provider dying looks like** — so the deliverable is that an
interruption is DISTINGUISHABLE from a fault **at every place either one can be observed**, and half
the rows below make one of those places stop being able to tell.

⚑ **The finding the table is shaped around**: `turn.state === 'interrupted'` has FOUR producers and
names none of them, so the discriminator is a PAIR of neighbouring rows and the actor is a row this
app did not write until this dispatch. `340` named that gap and deferred it — *"naming the agent that
asked for it needs an event that says so, and inventing one here would be this dispatch writing the
tools dispatch's vocabulary"* — and this is the tools dispatch.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M4` | ⚑ **`run_suite`** — `apps/desktop/test/the-interruption-that-looks-like-a-fault.test.ts` §1 |
| `M5`-`M8` | ⚑ **`run_suite`** — the same file's §4 and §7 |
| `M9`-`M13` | ⚑ **`run_suite`** — §2 and §3 |
| `M14`-`M16` | ⚑ **`run_suite`** — §1, §4 and §7, plus `a-task-you-can-see.test.ts`'s surface census |

## ⚑ 492 · one anchor corrected in place, and what that costs the verdict

⛔ **`M14`'s anchor moved because `492` made the claim shared bytes.** `HO-032` §1 turned a person's
Cancel on a Codex agent-tool card into a real `turn/interrupt`, so the card and `interrupt_agent`
now perform one act — and HO-030 §2 is why they may not describe it in two ways. The sentence
composes `${ASKED_TO_STOP}` from `shared/how-work-stopped.ts`; ⚑ **the ROW is unchanged and was
re-verified RED by hand.** ⚠️ **The recorded verdict for this table was measured against the OLD
text**, which is what the `⚑ ANCHOR CORRECTED IN PLACE BY 492` suffix exists to say; this table is
`unrun`, so nothing was re-blessed.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the fold reading `error.fatal` instead of every error.** It looks like a real
weakening and it is a NO-OP: `faulted` is only ever consulted when the turn ended `interrupted`, and
the one path that emits a non-fatal error (`completeTurn`'s `failed` arm) closes the turn as `failed`
— so both readings agree everywhere a product sequence can reach. ⚑ *A comparison tested where both
sides agree measures nothing*, and a row whose replacement changes no answer records as a survivor
while meaning nothing.

⛔ **No row on `NO_SURFACE.alive`.** `349` already argued why there is none — flipping it changes no
observable behaviour — and this dispatch's own finding about the mailbox flush living under that
gate is stated in the suite rather than pinned as a rule, because the repair is the mailbox's
dispatch to make.

⛔ **No row that makes `interrupt_agent` refuse an IDLE child.** That is `M11`'s neighbour and it is
the same rule from the other side; two rows would be two spellings of one question.

⚠️ **No row on the `sendInterrupting` absence.** Publishing a second interrupting verb is an addition
rather than a weakening, and the assertion that holds it is `the-rails-a-message-passes.test.ts` §9's
`not.toContain`, which a mutation on this side could not reach.

## ⚑ ANCHOR CORRECTED IN PLACE BY 494 (M4)

⛔ **`stoppedBy` reads `WHO_DID_IT_SAYS` since `494`**, because a stop reading may now name a third
actor — `a-caller-this-app-cannot-name`, which `UserDecisionEvent.by` can carry and
`work_interrupted.by` cannot. ⚠️ **The defect M4 restores is the same one**: every actor answers
*a person*, so an agent's interruption is reported to a person as their own and the transcript's one
distinguishing line becomes a lie. ⚑ The anchor moved with the signature; the rule did not.
"""

FOLD = "apps/desktop/src/shared/how-work-stopped.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/interrupt-rails.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
ENDING = "apps/desktop/src/renderer/src/lib/ending.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the reading ──────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 a provider that died mid-Stop reads as a clean stop · the fold drops the fault "
        "half, so `terminalizeErrored`'s `interrupted` — written when a FATAL error lands on a turn "
        "an interrupt was already requested for — is reported as somebody stopping it and the dead "
        "provider disappears",
        [
            (
                FOLD,
                "    ended === 'interrupted'\n      ? faulted\n        ? 'it-was-stopped-and-it-faulted'\n        : 'it-was-stopped'",
                "    ended === 'interrupted'\n      ? 'it-was-stopped'",
            )
        ],
    ),
    (
        "M2 · ⛔ the FIRST ask wins · a turn asked to stop twice — a person after an agent, which is "
        "the ordinary way a parent's child gets stopped — reports the agent for ever, and the "
        "person who pressed the button is told somebody else did it",
        [
            (
                FOLD,
                "    if (event.type === 'work_interrupted') {\n      asked = event.by",
                "    if (event.type === 'work_interrupted') {\n      asked = asked ?? event.by",
            )
        ],
    ),
    (
        "M3 · 🔴 the sentence `222` shipped, restored · *you* stopped it, said about a teardown, an "
        "`end_agent` and a provider that crashed after a Stop was requested — the false actor this "
        "dispatch was written to remove",
        [
            (
                ENDING,
                "  interrupted: 'its last turn was stopped before it finished',",
                "  interrupted: 'you stopped its last turn before it finished',",
            )
        ],
    ),
    (
        "M4 · ⛔ every actor is a person · `stoppedBy` answers *a person* whoever asked, so an "
        "agent's interruption is reported to a person as their own and the transcript's one "
        "distinguishing line becomes a lie. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
        [
            (
                FOLD,
                "  return by === 'an-agent' ? (agent ?? WHO_DID_IT_SAYS['an-agent']) : WHO_DID_IT_SAYS[by]",
                "  return agent ?? 'a person'",
            )
        ],
    ),
    # ── §2 · the record ───────────────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 the ask is written AFTER the provider is asked · on Codex `interrupt()` awaits an "
        "answer that may never arrive (709: not a `turn/completed`), so the row is missing from "
        "exactly the session "
        "somebody is trying to explain — and on both providers it lands after the terminal, so "
        "`events.turn_id` puts it on no turn and `lastTurnStop` cannot see it · killed by `the-interruption-that-looks-like-a-fault.test.ts` (named by W4.78)",
        # ⚑ **Re-anchored in place by `397`** (142's rule, and the claim is untouched): the ask and
        # the provider call moved together into `RuntimeHost.askTheWorkToStop`, which is now the ONE
        # path to `SessionHandle.interrupt()`. ⛔ The row still inverts exactly those two lines; it
        # needs the method to become `async` because the original returns the provider's promise
        # rather than awaiting it.
        [
            (
                HOST,
                # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 gave askTheWorkToStop a third parameter (keepsWhatThisAppAsked) and a `raised` read before the ask, so the signature spans lines; the plant still makes it async and drops the ask here, and edit 1 (`    return session.handle.interrupt()\n  }` -> await, then recordTheAsk) still applies once. Killer: §4 'the ask lands INSIDE the turn it stops, ahead of the terminal' and §7 'the ask is recorded BEFORE the provider is asked'.
                "  private askTheWorkToStop(\n    session: HostedSession,\n    by: Caller,\n    /** Questions this app asked for it stay open: the stop only makes way for words to it. */\n    keepsWhatThisAppAsked = false,\n  ): Promise<void> {\n    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null\n    this.recordTheAsk(session, by)\n",
                "  private async askTheWorkToStop(\n    session: HostedSession,\n    by: Caller,\n    /** Questions this app asked for it stay open: the stop only makes way for words to it. */\n    keepsWhatThisAppAsked = false,\n  ): Promise<void> {\n    const raised = keepsWhatThisAppAsked ? this.deps.store.questionsRaisedIn(session.id) : null\n",
            ),
            (
                HOST,
                "    return session.handle.interrupt()\n  }",
                "    await session.handle.interrupt()\n    this.recordTheAsk(session, by)\n  }",
            ),
        ],
    ),
    (
        "M6 · ⛔ the ask names a person whoever asked · the one row that carries the actor is "
        "written with the wrong one, so every agent-driven stop is recorded as a person's — 039's "
        "defect with a different actor, which is the exact widening `noteUserCommand` refuses. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 501, which replaced the ternary this row used to name "
        "with `whoDidIt`'s answer; the defect and the kill are unchanged",
        [
            (
                HOST,
                "      by: actor.who,",
                "      by: 'a-person',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The row plants a defect inside a forced
        # teardown that both stops a turn AND ends a busy child's conversation — `endAgent`'s
        # `forceEnd` path. That path is gone: nothing in this app ends a conversation any more
        # ("Nothing ends a conversation... interrupt_agent stops a turn"), `recordTheAsk`'s only
        # remaining caller (`askTheWorkToStop`) is used solely by true interrupts (person's Stop,
        # interrupt-and-send, `interrupt_agent`), none of which end anything, so "a parent agent
        # destroying a busy child" no longer exists as an act. Its anchor is left stale, so the
        # census records it retired.
        "M7 · 🔴 `end_agent` records nothing · the teardown still calls `forceEnd` and still writes "
        "`turn:'interrupted'`, so a parent agent destroying a busy child leaves an ending with "
        "nobody attached to it — the state the ending sentence was lying about",
        [
            (
                HOST,
                "    if (slot.session !== null) this.recordTheAsk(slot.session, by)",
                "    void slot",
            )
        ],
    ),
    (
        "M8 · ⛔ the agent door records nothing · the tool answers `ok`, the turn ends "
        "`interrupted`, and no row anywhere says a parent asked for it — the ledger back to what "
        "`340` measured and deferred",
        # ⚑ **Re-anchored in place by `397`** (142's rule): the agent door reaches the provider
        # through `askTheWorkToStop` now, so *"this door records nothing"* is expressed by making it
        # skip that method rather than by deleting a line it no longer holds. ⛔ The defect is the
        # same one and the claim is unchanged.
        # ⚑ **Re-anchored in place by `709`** — interrupt-and-send now races the same call against
        # the same bound (`704` H-8), so the line appears twice; the leading newline and the
        # four-space indent name `interruptAgent`'s copy, and the claim is unchanged.
        [
            (
                HOST,
                "\n    const asked = this.askTheWorkToStop(session, by)\n",
                "\n    const asked = session.handle.interrupt()\n",
            )
        ],
    ),
    # ── §3 · the rails ────────────────────────────────────────────────────────────────────────
    (
        "M9 · 🔴 a parent may cut into a child a PERSON is being asked something in · both adapters "
        "`settleRequests()` inside `interrupt()` and the broker safe-REJECTS every pending card, so "
        "this is an agent denying a permission on a person's behalf — HO-005 Q2 arriving through a "
        "verb `394` never looked at, and the settling writes no row at all",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — An agent still must never
        # be able to cut into a child a PERSON is being asked something in — the rule is unchanged —
        # but the single-line check was restructured by D-017 · R19 into a block that also branches
        # on whether the card was routed to another conversation (`askedOf`). When `askedOf ===
        # null` (asked of a person) it still must refuse `a-person-is-being-asked`.
        [
            (RAILS, "  if (status === 'waiting_permission') {\n    return askedOf === null\n      ? refuseInterrupt('a-person-is-being-asked', { agent })\n      : refuseInterrupt('it-is-waiting-on-an-answer', { agent, askedOf })\n  }", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The capability floor,
        # assertMayReach('interrupt', ...) reading can_interrupt, was removed on purpose (commit:
        # "End and interrupt reach the chain below the caller, with no grant and no project floor").
        # Its anchor is left stale, so the census records it retired.
        "M10 · ⛔ the target's state is asked BEFORE the capability floor · a caller with no grant "
        "learns that somebody is being asked something inside a conversation it may not touch, "
        "which is the disclosure every gate in this app is ordered to prevent",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 put the kept-open answer between the floor and `const session`. The DEFECT this row plants is unchanged.
            (
                HOST,
                "    this.assertMayReach('interrupt', sessionId, by)\n    if (slot === undefined) return { ok: true, agent: sessionId, state: 'open-nothing-running' }\n    const session = slot.session",
                "    if (slot === undefined) return { ok: true, agent: sessionId, state: 'open-nothing-running' }\n    const session = slot.session",
            ),
            (
                HOST,
                "    if (refusal !== null) return { ok: false, refusal }\n    // ⚑ Narrowed by the rails above: a null session reached `that-conversation-has-not-started`.",
                "    if (refusal !== null) return { ok: false, refusal }\n    this.assertMayReach('interrupt', sessionId, by)",
            ),
        ],
    ),
    (
        "M11 · ⛔ an idle conversation is refused · a rail that reads state before acting is racy by "
        "construction — the child can begin a turn between the read and the call — and HO-016 §1 "
        "named that shape as the reason the FLOOR is unconditional",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The HO-016 §1 floor is
        # untouched and its own comment is still in the file verbatim ("idle is admitted, and it is
        # not a fourth rail" / "who may interrupt is never conditional on the target's state"): a
        # rail that refuses based on a racy state read would let the entitlement floor stop being
        # unconditional. The literal single-line anchor moved because the waiting_permission branch
        # became a block (R19); the fix is to add an idle-refusal branch after it, exactly mirroring
        # the original plant.
        [
            (RAILS, "  if (status === 'waiting_permission') {\n    return askedOf === null\n      ? refuseInterrupt('a-person-is-being-asked', { agent })\n      : refuseInterrupt('it-is-waiting-on-an-answer', { agent, askedOf })\n  }", "  if (status === 'waiting_permission') {\n    return askedOf === null\n      ? refuseInterrupt('a-person-is-being-asked', { agent })\n      : refuseInterrupt('it-is-waiting-on-an-answer', { agent, askedOf })\n  }\n  if (status === 'idle') return refuseInterrupt('that-conversation-has-not-started', { agent })"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The rail this row targets,
        # `'that-conversation-has-already-ended'`, is gone from `INTERRUPT_RAILS` entirely — the
        # vocabulary now has only `a-person-is-being-asked`, `it-is-waiting-on-an-answer`,
        # `not-below-you`, `that-conversation-has-not-started`. A test in
        # the-interruption-that-looks-like-a-fault.test.ts says so explicitly: "It was refused
        # `that-conversation-has-already-ended`; nothing ends a conversation any more, and a stopped
        # one is started again by a message." There is no ending state left for a refusal to under-
        # or over-describe. Its anchor is left stale, so the census records it retired.
        "M12 · ⛔ the refusal does not name the ending · a caller is told a conversation is over and "
        "not whether it finished or broke, which is `393`'s and `394`'s rule and this dispatch's "
        "whole subject arriving in a payload",
        [
            (
                RAILS,
                "    return refuseInterrupt('that-conversation-has-already-ended', { agent, state: status })",
                "    return refuseInterrupt('that-conversation-has-already-ended', { agent })",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The floor this row made conditional is
        # gone (commit: "with no grant and no project floor"; can_interrupt is "unread and
        # unwritten"). No person-set grant can be refused, so the race it described (a caller a
        # person refused) cannot happen. Its anchor is left stale, so the census records it retired.
        "M13 · 🔴 the FLOOR is made conditional on the target being busy · HO-016 §1 refused this in "
        "as many words, and the reason is not leniency: the check and the act are two moments, so a "
        "child that starts a turn between them is interrupted by a caller a person refused",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 put the kept-open answer between the floor and `const session`. The DEFECT this row plants is unchanged.
            (
                HOST,
                "    this.assertMayReach('interrupt', sessionId, by)\n    if (slot === undefined) return { ok: true, agent: sessionId, state: 'open-nothing-running' }\n    const session = slot.session",
                "    if (slot === undefined) return { ok: true, agent: sessionId, state: 'open-nothing-running' }\n    const session = slot.session\n    if (session !== null && session.handle.status() !== 'idle')\n      this.assertMayReach('interrupt', sessionId, by)",
            )
        ],
    ),
    # ── §4 · the answer, and what it may not claim ────────────────────────────────────────────
    (
        "M14 · 🔴 the tool answers `stopped` · Claude forces its own terminal and Codex awaits an "
        "answer that may never arrive (709: not a `turn/completed`), so a payload claiming the work "
        "has ended is false "
        "on one of the two providers — `stopBackgroundWork`'s ruling (233/240) inverted "
        "⚑ ANCHOR CORRECTED IN PLACE BY 492",
                # ⚑ **492 · anchor corrected, not retired.** The CLAIM is now shared bytes with the
                # permission card's Cancel, which performs the same act since `HO-032` §1, so the
                # sentence composes `${ASKED_TO_STOP}` instead of spelling it. ⛔ The ROW is
                # unchanged — the tool goes back to answering `stopped` — and it now has a second
                # killer, `492`'s own `not.toContain('was stopped')` beside `395`'s.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The
        # stopBackgroundWork-precedent rule is unchanged and still documented at length on
        # `interruptAgent` itself: `interrupt_agent` must answer `asked`, never `stopped`, because
        # Codex's interrupt awaits an answer that may never arrive. The literal object/text moved
        # only because the variable was renamed from `outcome.state` to the derived `now`
        # (`agentStateWords(outcome.state)`).
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: `interrupt_agent` answers 'asked to stop' (asked:
        # true), never 'stopped', because a provider's interrupt may never complete. The answer now
        # composes `${ASKED_TO_STOP}` inside `answer(...)`, so the plant puts back `stopped: true`
        # and 'was stopped'. Killed by `the-interruption-that-looks-like-a-fault.test.ts`,
        # `make-the-word-mean-one-thing.test.ts`.
        [
            (TOOLS, "          return answer(\n            { outcome: 'ok', agent: outcome.agent, asked: true, state: now },\n            `${called} was ${ASKED_TO_STOP}. Its state now: ${now}.`,\n          )", "          return answer(\n            { outcome: 'ok', agent: outcome.agent, stopped: true, state: now },\n            `${called} was stopped. Its state now: ${now}.`,\n          )"),
        ],
    ),
    (
        "M15 · ⛔ the wait is unbounded · a child whose app-server never ANSWERS `turn/interrupt` "
        "holds its PARENT's turn open for ever, inside a tool call the parent cannot get out of — "
        "the deadline releases the waiter, not the work (185)",
        # ⚑ **Re-anchored in place by `709`** — `runSendInterrupting` now races the same promise
        # against the same bound (`704` H-8); the leading newline and the four-space indent name
        # `interruptAgent`'s. ⚠️ **And the label corrected**: it said *"accepted `turn/interrupt`
        # and never completed"*, but the adapter awaits the RPC's ANSWER, so an app-server that
        # accepts it releases the wait — the one that never answers is the one that holds it.
        [
            (
                HOST,
                "\n    await settledWithin(asked, this.interruptWaitMs)\n",
                "\n    await asked\n",
            )
        ],
    ),
    (
        "M16 · 🔴 the card stops carrying the ending · `AgentCard.state` is `idle` after a fault and "
        "after an interruption alike, so the one surface a parent has can no longer tell *somebody "
        "stopped this* from *this broke* — §1's requirement failing at the place it was written for",
        [
            (
                HOST,
                # ⚑ **484 · anchor corrected, not retired.** The field says which turn it is about now
                # — `lastEndedTurn`, with the moment it closed — and the reader is named for the same
                # question. ⛔ The ROW is unchanged: the card stops carrying the ending. Re-verified RED.
                # ⚑ 676 · anchor CORRECTED, not retired: the read now takes the card's unread set.
                "      lastEndedTurn: this.deps.store.lastEndedTurn(slot.id, unread),",
                "      lastEndedTurn: null,",
            )
        ],
    ),
    (
        "M17 · ⛔ the transcript draws nothing for the ask · `user_command`'s ledger-only ruling "
        "applied to the one gesture whose consequence does not show its cause, so a person reads "
        "`turn interrupted` and cannot learn that their agent's parent did it",
        [
            (
                TRANSCRIPT,
                # ⚑ **Re-anchored in place by `709`** (R43): the notice draws the ASK in
                # `ASKED_TO_STOP`'s words now; the row still removes it.
                # ⚑ **…and by `737`** (`734` F-2): the notice carries the ask's facts so the transcript can
                # name the agent (`askedToStopSays`); the row still removes it.
                "      state.items.push({\n        kind: 'notice',\n        id: nextId(state, 'notice'),\n        level: 'warn',\n        text: askedToStopSays(askedToStop, null),\n        askedToStop,\n      })\n      return",
                "      return",
            )
        ],
    ),
]
