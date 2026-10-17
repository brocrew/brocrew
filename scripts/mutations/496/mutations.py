"""496 · the card a third party was holding — HO-034 §1, Slice 5.

🔴 **The ruling this table restores the absence of:** *"An agent may not end a conversation while a
person is being asked something in it. A person may."*

⛔ ***The person whose card evaporates is a different person from the one who clicked.*** ⚠️ A
permission answers *did anybody mean this*; an end means *end this agent*, and it does not mean
*void the pending decision that agent is waiting on* — **the caller was never shown that decision**.
🔴 **One consequence, two confirmations needed, one obtained.**

## ⚠️ What `493` measured, and what the repair is

⛔ **`interruptAgent` computes the target's state and asks `admitInterrupt` before touching the
provider; `endAgent` did not.** It asked `mayCommand`, then `assertMayReach('end', …)`, recorded the
ask and called `close` — and both adapters settle every pending request during close, so a parent
whose reach admitted settled a person's card with a gesture that person never saw.

⚑ **The repair is a rail at the same place in the same order**: entitlement, then the capability
floor, then `admitEnd` — **before `recordTheAsk`, so a refused end writes nothing at all.**

## ⛔ One vocabulary or two — the decision these rows guard

⚑ **`END_RAILS` is its own table carrying `INTERRUPT_RAILS`' word.** The WORD is shared under the
census's named exception (`what-an-agent-is-told-about-its-work.test.ts` §3), because one state of
the world must not have two names; the SENTENCE could not be, because a refusal states a fact about
THIS call and *"cutting into it"* is not a fact about an end. ⚠️ Rows M6–M9 are what keep both halves
true.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M2, M3, M4, M5 | `apps/desktop/test/the-card-a-third-party-was-holding.test.ts` §1 |
| M6, M7, M8, M9 | …the same file's §2, and `a-refusal-carries-its-remedy.test.ts` §1 |
| M10 | …§3, the person's arm in the same state |
| M11, M12 | …§4, the card that survives the refusal |
| M13, M14 | …§5, the remedy the sentence names |

## ⛔ What this table deliberately does NOT contain

 - ⛔ **No row on `settleAll`'s *nobody decided*.** `questions.ts` is right and `397` owns it: the
   ledger never lied, the ACT was the defect. A row there would restore somebody else's rule.
 - ⛔ **No row adding `that-conversation-has-not-started` or `that-conversation-has-already-ended`
   to this door.** The PO ruled ONE floor for ending; a row for either would assert a rule nobody
   has made. ⚑ M5 covers the direction that matters — a rail that refuses MORE than was ruled.
 - ⚠️ **No row on `carryEndRefusal` re-deriving its policy fields.** Both doors answer the same
   permanence and the same `null` remedy for this word, so copying the incoming payload instead of
   re-deriving it produces byte-identical output — *a mutation that changes nothing reports as a
   survivor*. ⛔ The property is real and it is asserted (§2's built-payload walk); what is missing
   is a state where the two readings diverge, and inventing one would be a second vocabulary.
 - ⚠️ **No row scoping the rail by the CALLER** (`sessionSpeakingAs(by) === null` ⇒ admit). That is
   not a defect restored, it is the OTHER design — HO-033 §2's shape — and 496 reports it as a
   finding rather than deciding it with a mutation.
"""

RAILS = "apps/desktop/src/main/runtime/end-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

MUTATIONS = [
    # ── §1 · the rail itself ────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** M1 planted its defect in end-rails.ts's
        # admitEnd gate, and that whole file (236 lines) is deleted by 5206d835 — `ls` confirms it
        # no longer exists and no symbol named admitEnd remains anywhere in the tree. The commit
        # message says so directly: "end_agent and resume_agent are gone (21 tools). Nothing ends a
        # conversation." There is no successor door that admits/refuses an END call to re-anchor
        # this to. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 THE DEFECT, restored · the door admits every state, so a parent whose reach admits "
        "ends a child parked on a person's card and that card is settled by a gesture the person "
        "never saw — `493`'s measurement exactly",
        [
            (
                RAILS,
                "  if (status === 'waiting_permission') return refuseEnd('a-person-is-being-asked', { agent })\n  return null\n",
                "  return null\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same end-rails.ts/admitEnd subject as
        # M1 ("the rail is never asked"), and end-rails.ts is fully deleted along with the endAgent
        # call site in runtime-host.ts that used to invoke admitEnd. The card (D-017) states this
        # was removed on purpose: "end_agent and resume_agent go. Nothing ends a conversation." Its
        # anchor is left stale, so the census records it retired.
        "M2 · ⛔ the rail is never ASKED · the vocabulary exists, the sentence is right, and the verb "
        "walks past it — a door that answers nothing is the shape `341` calls a rail nobody proved "
        "can fail",
        [
            (
                HOST,
                "    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) return refusal\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Plants "the refusal is returned and the
        # teardown runs anyway" around admitEnd's call in the (former) endAgent method; endAgent,
        # admitEnd and the whole END teardown path are gone from runtime-host.ts. Retired for the
        # same reason as M1/M2 — the subject was deliberately removed, not reshaped. Its anchor is
        # left stale, so the census records it retired.
        "M3 · ⛔ the refusal is returned and the teardown runs ANYWAY · the payload says the card was "
        "protected and the conversation is gone — the one shape that satisfies a refusal assertion "
        "while performing the act",
        [
            (
                HOST,
                "    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) return refusal\n",
                "    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) {\n      await this.close(sessionId, THE_APP_ITSELF)\n      return refusal\n    }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Targets the entitlement-before-state
        # ordering inside the (former) endAgent method, using mayCommand/mayInterruptDownTheChain
        # around admitEnd. endAgent no longer exists; interruptAgent has its own, separately-tested
        # entitlement check that this row never named or covered. Retire rather than re-target onto
        # a different tool's door. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 the state is asked BEFORE the capability floor · `341` inverted at this door — a "
        "caller a person never granted `can_interrupt` learns that somebody is being asked something "
        "in a conversation it may not touch",
        # ⚑ Landing D-014 · re-anchored in place, not retired (landing review) — D-014 deleted the
        # grant floor, not 341's order at the end door: a caller refused on entitlement (the chain
        # below it) learns nothing of the target's state. Re-verified RED alone.
        [
            (HOST, "    if (\n      !mayCommand(target, by) &&\n      !mayInterruptDownTheChain(by, this.ancestorsAsItWillRun(sessionId))\n    ) {\n      return 'no-such-agent'\n    }\n    if (slot === undefined) return this.endWhatTheQuitClosed(sessionId, by)\n", "    const entitled =\n      mayCommand(target, by) || mayInterruptDownTheChain(by, this.ancestorsAsItWillRun(sessionId))\n    if (slot === undefined) return entitled ? this.endWhatTheQuitClosed(sessionId, by) : 'no-such-agent'\n"),
            (HOST, '    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) return refusal\n', "    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) return refusal\n    if (!entitled) return 'no-such-agent'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Widens end-rails.ts's
        # 'waiting_permission' refusal to also cover 'working' — end-rails.ts is deleted entire, so
        # there is no END rail left to over-widen. The card's decision 2 ("end_agent and
        # resume_agent go") removed this door on purpose. Its anchor is left stale, so the census
        # records it retired.
        "M5 · ⚠️ the rail refuses MORE than was ruled · a child that is merely WORKING can no longer "
        "be ended by the parent that made it, which is the widening §4 of the brief forbids and the "
        "one a door written from a status name rather than from the ruling would produce",
        [
            (
                RAILS,
                "  if (status === 'waiting_permission') return refuseEnd('a-person-is-being-asked', { agent })\n",
                "  if (status === 'waiting_permission' || status === 'working')\n    return refuseEnd('a-person-is-being-asked', { agent })\n",
            )
        ],
    ),
    # ── §2 · one word, two tables ───────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Plants a permanence-word collision
        # ('until-a-person-changes-it' vs 'while-this-holds') inside end-rails.ts's own
        # REMEDY/PERMANENCE table for the END door. That file and its 'a-person-is-being-asked'
        # END-specific entry are gone; interrupt-rails.ts keeps its own same-named rail with its own
        # already-correct 'until-a-person-changes-it' entry, which is a different door's table, not
        # this row's subject. Its anchor is left stale, so the census records it retired.
        "M6 · ⛔ the shared word means two things · `until-a-person-changes-it` at one door and "
        "`while-this-holds` at the other, which is the *one word, two things* `374` refuses and "
        "`419` bought the shared-name exception by measuring",
        [
            (
                RAILS,
                "  'a-person-is-being-asked': 'until-a-person-changes-it',\n",
                "  'a-person-is-being-asked': 'while-this-holds',\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Plants a wrong remedy word on
        # end-rails.ts's REMEDY table for the END door's 'a-person-is-being-asked' rail.
        # end-rails.ts is deleted; interrupt-rails.ts's own remedy table for the same rail name is
        # untouched and already correctly `null`, and was never this row's subject. Its anchor is
        # left stale, so the census records it retired.
        "M7 · 🔴 the rail carries a remedy it cannot keep · `withdraw-the-work-or-ask-about-it` in "
        "the field a model reads as *the act that clears THIS call* — and withdrawing leaves the "
        "child parked on the card, so the identical call meets this rail again",
        [
            (
                RAILS,
                "const REMEDY: Readonly<Record<EndRail, RefusalRemedy | null>> = {\n  'a-person-is-being-asked': null,\n}",
                "const REMEDY: Readonly<Record<EndRail, RefusalRemedy | null>> = {\n  'a-person-is-being-asked': 'withdraw-the-work-or-ask-about-it',\n}",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Strips the withdraw_task remedy clause
        # out of end-rails.ts's END sentence. end-rails.ts and its sentence table are deleted
        # outright; the surviving interrupt-rails.ts sentence for 'a-person-is-being-asked' was
        # independently rewritten by this same commit (D-017 §'424') and is a different string this
        # row never targeted. Its anchor is left stale, so the census records it retired.
        "M8 · ⚠️ the sentence stops naming the act · the way out the PO named — *withdraw the work, "
        "or wait for the person* — goes, and with `remedy` correctly `null` the refusal then carries "
        "it nowhere at all",
        # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing D-014 · re-anchored in place, not retired — D-014 rewrote
        # END_SENTENCES['a-person-is-being-asked'] so it no longer tells the ender to withdraw.
        # Re-verified RED alone.
        [
            (RAILS, ' Nothing was ended: carry on with something else, or say that you are blocked on it. Whoever gave it the work can take it back with withdraw_task, and their question stays where it is. Ending it now', ' Nothing was ended. Ending it now'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Plants the END door's sentence copying
        # the INTERRUPT door's wording — a defect that can only exist while both doors exist side by
        # side. end-rails.ts is deleted, so there is no second copy of the sentence left to corrupt;
        # the interrupt-rails.ts sentence is the only one and is not a copy of anything. Its anchor
        # is left stale, so the census records it retired.
        "M9 · ⛔ the end door speaks the INTERRUPT door's sentence · a caller that asked to END is "
        "told *cutting into it* and *Nothing was interrupted* — a fact about a call it did not make, "
        "which is HO-015 §2, and the one clause a shared member could never have carried",
        # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing D-014 · re-anchored in place, not retired — D-014 reworded the end sentence's
        # middle, so the old anchor is gone. The rule is unchanged: the end door must not say the
        # interrupt door's 'Nothing was interrupted' or 'cutting into it'. Re-verified RED alone.
        [
            (RAILS, "    'that conversation is waiting for a person’s answer. Nothing was ended: carry on with something else, or say that you are blocked on it. Whoever gave it the work can take it back with withdraw_task, and their question stays where it is. Ending it now would throw that question away and answer it as a refusal on their behalf;", "    'that conversation is waiting for a person’s answer. Nothing was interrupted: carry on with something else, or say that you are blocked on it. Whoever gave it the work can take it back with withdraw_task, and their question stays where it is. Cutting into it now would throw that question away and answer it as a refusal;"),
        ],
    ),
    # ── §3 · the person's arm ───────────────────────────────────────────────────────────────────
    (
        "M10 · 🔴 the PERSON is refused too · the rail moves onto `close`, which is the door a "
        "person's press actually reaches — *an agent may not, a person may* collapses into *nobody "
        "may*, and a card becomes a thing no gesture in this app can get past",
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 gave `close` a no-slot branch; the anchor is that branch's close and the check after it. The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # a-person-is-being-asked rail refuses the agent's interrupt but a person's `host.close`
        # must still stop the conversation. D-017b removed the `forgetTheQuitOf` branches, so the
        # anchor is now the one-line `if (!slot) return Promise.resolve()` plus the assertMayControl
        # line; the plant makes close a no-op while waiting_permission.
        [
            (HOST, '    if (!slot) return Promise.resolve()\n    this.assertMayControl(slot, by)\n', "    if (!slot) return Promise.resolve()\n    this.assertMayControl(slot, by)\n    if (slot.session !== null && slot.session.handle.status() === 'waiting_permission')\n      return Promise.resolve()\n"),
        ],
    ),
    # ── §4 · the card the refusal was protecting ────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Plants "the refusal tears the card down
        # on its way out" around `admitEnd(sessionId, status)` in runtime-host.ts's (former)
        # endAgent method. `admitEnd` no longer exists anywhere in the tree (grep confirms zero
        # hits) because endAgent itself is gone with end_agent (commit: "end_agent and resume_agent
        # are gone"). Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ the refusal tears the card down on its way out · the call is refused, the payload "
        "is right, and the thing it exists to protect is settled anyway — the shape that passes a "
        "refusal assertion and fails the person",
        [
            (
                HOST,
                "    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) return refusal\n",
                "    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) {\n      if (slot.session !== null) slot.session.handle.interrupt()\n      return refusal\n    }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same call site as M11 (`admitEnd`
        # inside endAgent), plants recordTheAsk running ahead of the refusal. Both `admitEnd` and
        # `endAgent` are gone; there is no END call left for withdrawTask's ordering rule to be
        # broken at. Its anchor is left stale, so the census records it retired.
        "M12 · ⚠️ a refused end writes the ask anyway · `recordTheAsk` moves above the rail, so the "
        "ledger holds *somebody asked this work to stop* about a call that was refused — "
        "`withdrawTask`'s ordering rule broken at a second venue",
        [
            (
                HOST,
                "    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) return refusal\n",
                "    if (slot.session !== null) this.recordTheAsk(slot.session, by)\n    const refusal = admitEnd(sessionId, status)\n    if (refusal !== null) return refusal\n",
            )
        ],
    ),
    # ── §5 · what the tool hands back ───────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Plants the tool answering ok over a
        # refusal by deleting the `carryEndRefusal`/`typeof outcome !== 'string'` branch in
        # agent-tools.ts's end_agent handler. Verified: that exact block, `carryEndRefusal`, and the
        # `end_agent` tool definition are all absent from agent-tools.ts (grep/count all return
        # zero) — the tool is one of the 21 gone per the commit message. Its anchor is left stale,
        # so the census records it retired.
        "M13 · 🔴 the tool answers `ok` over the refusal · the host refuses, the arm that carries it "
        "goes, and `end_agent` tells a model *that agent has ended* about a conversation that is "
        "still there with its card open — criterion 15's shape at the newest door",
        [
            (
                TOOLS,
                "          if (typeof outcome !== 'string') {\n            const carried = carryEndRefusal(outcome)\n            return answer(carried, `refused (${outcome.rail}): ${outcome.reason}`)\n          }\n",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Plants a drifted refusal sentence in
        # the same end_agent tool-answer line agent-tools.ts used to have (`return answer(carried,
        # ...)`). Confirmed absent by exact-string count (0) — the whole end_agent tool handler,
        # including this line, was deleted with the tool itself. Its anchor is left stale, so the
        # census records it retired.
        "M14 · ⚠️ the two halves are written twice · the text a person reads is composed beside the "
        "payload a model reads instead of from it — `492`'s criterion 20 defect, one door over, and "
        "the sentence that drifts is the one further from the table",
        [
            (
                TOOLS,
                "            return answer(carried, `refused (${outcome.rail}): ${outcome.reason}`)\n",
                "            return answer(carried, `refused (${outcome.rail}): that agent is busy right now.`)\n",
            )
        ],
    ),
]
