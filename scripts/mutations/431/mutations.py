"""431 · the message that crosses a project — each row is THE DEFECT, put back (131).

🔴 **HO-024 §4 row 6:** *"A cross-project message is refused in the product, not only in a
constructed control."* ⚑ **And HO-022 §3's other half**, which the seed writes down in its own
`why`: *"BroBot talks to a project manager in every project."*

⛔ **Until this dispatch neither half was reachable, and the rail was not what stopped it.** `430`
measured the door: `message_agent` resolved an entitlement through `agentCard` → `mayCommand`, a
project manager a PERSON opened in another project is neither BroBot's owner nor its recorded
commander, and *"the product creation door can put a PM in project B but cannot make BroBot command
it."* ⚠️ **So `can_message: 'any'` was read by nothing** — `admitMessaging` sat one gate further in,
over a set in which sender and target projects are equal by construction, which is
`a-rule-measured-only-where-both-readings-agree` in the app rather than in a test.

## ⚠️ The hazard these rows are written against

⛔ **`a-comparison-tested-where-both-sides-agree-measures-nothing`, which the brief named as the
direct one: *"a row that swaps one project for the same project measures nothing."*** ⚑ **`M1`–`M6`
and `M13` are measured against a fixture holding TWO callers in ONE project and ONE target in
another** — `a-message-that-crosses-a-project.test.ts` §1 — so a row that widened or narrowed both
readings together would still be caught by the half it got wrong. ⚠️ `M4` is the row that exists for
this specifically: it moves `same-project` to the value `any` has, and it is killed by the caller
that must STILL be refused rather than by the one that must be admitted.

⚠️ **`M7`–`M12`, `M14` and `M15` are NOT measured against that fixture and do not need to be**: they
are about clauses that have nothing to do with a project — a caller reaching itself, a caller being
told about itself, two shapes of missing row, a missing slot, and the gate's own delegation. ⛔ Their
killers are §2's bounds, and each is named in the table below.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M6`, `M13`–`M15` | ⚑ **`run_suite`** — `a-message-that-crosses-a-project.test.ts` §1 and §2 |
| `M7`–`M8` | ⚑ **`run_suite`** — §2's self-message and `the-five-tools.test.ts` §3's `that-agent-is-you` |
| `M9`, `M12` | ⚑ **`run_suite`** — §2's two absences: a conversation with no `agent_profile` row, and a placed one whose `agent_identity` row cannot be read |
| `M10`–`M11` | ⚑ **`run_suite`** — §2's `end_agent`/`interrupt_agent` pair and §3's source census |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `admitMessaging` itself.** `374` `M8`–`M12` own that function and they still apply;
what `431` changed is which callers ever reach it. ⚑ **`374`'s `'any'` arm gained its first
DISTINGUISHING case here.** It was reachable before — BroBot spawns a project manager and messages
it — but sender and target projects were equal on every reachable call, so `'any'` and
`same-project` gave the same answer and the arm was measured only where both readings agree.

⛔ **The non-leak is carried by the SHAPE and `M4` is what puts a crack in it.** The door answers one
boolean, so *not within your reach* and *there is no such conversation* are one value; `M4` widens the
grant so a `same-project` caller gets PAST that boolean and meets `admitMessaging`, which answers
`message-outside-your-project` for the real conversation and — because the ghost id has no slot and
never reaches it — `no-such-agent` for the one that never was. ⚑ **So §1's leak test is one of `M4`'s
killers**, and the row measures a disclosure as well as a widening.

⛔ **No row restoring `agentCard` to `list_agents` or `get_agent_status`.** ⚠️ **This read *"they
were never moved"* and `433` §B moved them** — both readers ask `withinMessagingReach` now, on the
ruling *a caller may SEE exactly what it may SEND to*. ⛔ **The rows that put that back are `433 M1`
and `433 M2`**, which is where they belong: they measure `433`'s decision and not `431`'s, and a copy
here would make one defect kill two tables.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

THE_DOOR = "          if (!host.withinMessagingReach(agent, by, me)) {"
THE_GATE = "    const session = this.requireToMessage(sessionId, by)"
THE_GRANT = "    return reachesWhatItDidNotStart(allowed.canMessage)"

# ⚑ **708 · anchors corrected in place, not retired** (standing rule 27): `R42` handed every turn
# gate a `from`, so each `assertCanTakeTurn(` call gained that key and most now span several
# lines; the rows below that named a gate call were re-spelled to it and each re-verified RED
# alone, with its killer named in 708's response.
MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── the door and the two gates ─────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · the door asks for a CARD again, so the entitlement it "
        "resolves is `mayCommand` and criterion 6's positive half goes back to being unreachable: "
        "BroBot is told there is no agent by that name, about the one conversation its grant exists "
        "for",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The literal call site is
        # gone: D-017 R12 moved the door's reach check out of agent-tools.ts entirely into
        # `RuntimeHost.whyItIsOutOfReach`, which now calls `withinMessagingReach` itself. The row's
        # original vehicle (swap to `agentCard(...) === null`) no longer diverges — by 433
        # `agentCard` itself is proven to gate on the exact same `withinMessagingReach` call for
        # every id, live or stopped — so re-anchoring there would plant a defect no test can see. I
        # re-anchored instead on the underlying rule (the door must honour the wide `canMessage`
        # grant, not narrow to `mayCommand`) by narrowing `whyItIsOutOfReach`'s own entry gate to
        # self-or-`mayCommand` only, reusing `withinMessagingReach`'s own target-resolution so the
        # plant stays type-safe. Flagging lower confidence: I could not execute the suite to confirm
        # this specific substitution goes red.
        [
            (HOST, '    if (this.withinMessagingReach(sessionId, by, me)) return null\n', '    const forCommand = this.slots.get(sessionId) ?? this.startable(sessionId)\n    if (\n      forCommand !== undefined &&\n      forCommand !== null &&\n      (forCommand.id === me || mayCommand(this.commandedNow(forCommand), by))\n    )\n      return null\n'),
        ],
    ),
    (
        "M2 · ⛔ `queueMessage`'s gate reverts · the door admits and the host refuses two lines "
        "later — the exact shape `430` found, and the one that reaches a model as a window's "
        "sentence wrapped in `agent-cannot-take-a-message` rather than as a policy answer",
        # ⚑ **Re-anchored by `553`, not retired.** HO-060 §2 put `assertMayAssign` on this run —
        # a SECOND gate over a SECOND column — so the anchor gained a line and the defect is
        # unchanged: this row reverts the ENTITLEMENT, and what it measures is that the door and
        # the host ask one question. Re-applied and re-run individually after the correction.
        #
        # ⚑ **Re-anchored AGAIN by `565 relay 1`, and again not retired.** HO-066 §2.3 gave that
        # second gate a third arm, read off the RECEIVER, and the read is hoisted onto this run so
        # all three of its readers take one value. ⛔ The anchor gained a line and lost nothing:
        # this row still reverts the ENTITLEMENT and still measures that the door and the host ask
        # one question. Re-applied and re-run individually after the correction.
        #
        # ⚑ **RE-ANCHORED a THIRD time at `681`, not retired.** PM ruling R30b asks the walls INSIDE
        # the entitlement's gate, before *not started*, so the run is one call with the walls in its
        # closure. ⛔ This row still reverts the ENTITLEMENT — to `requireToCommand`'s own gate,
        # `assertMayCommand`, spelled as `sessionFor`'s gate so the walls are still asked — and
        # still measures that the door and the host ask one question. Re-applied and re-run
        # individually after the correction.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the door and the host must ask one entitlement question. queueAs still calls
        # `requireToMessage(sessionId, by, () => { if (says !== null) this.assertMayReach(...) })`.
        # The plant reverts the entitlement to `assertMayCommand` inside a plain sessionFor and
        # keeps the walls, so a cross-project caller the door admits is refused two lines later.
        # Killed by `a-message-that-crosses-a-project.test.ts`.
        [
            (HOST, "    const session = this.requireToMessage(sessionId, by, () => {\n      if (says !== null) this.assertMayReach('message', sessionId, by)\n    })\n", "    const session = this.sessionFor(sessionId, (receiver) => {\n      this.assertMayCommand(receiver, by)\n      if (says !== null) this.assertMayReach('message', sessionId, by)\n    })\n"),
        ],
    ),
    (
        "M3 · ⚠️ `send`'s gate reverts and `queueMessage`'s does not · the half-fix, and the one "
        "that passes every held-message case and fails every delivered one: `queueMessage` "
        "delegates to `send` on the idle path, so an admitted caller meets a stricter gate inside "
        "the method that already admitted it",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — queueMessage no longer
        # delegates to send at all (D-017 rebuilt both around `queueAs`/`deliverWhenItRuns`), but
        # queueAs's idle branch still calls `sendAs`, and sendAs's own gate is still
        # `this.requireToMessage(sessionId, by)` — the exact pairing the row protects (queueAs's
        # outer gate and sendAs's inner gate must agree). Reverting sendAs's line to
        # requireToCommand reproduces the same half-fix: a caller queueAs's own requireToMessage
        # admitted meets a stricter gate two lines into sendAs on the idle/delivered path.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: sendAs, which queueAs's idle path calls, must ask the same gate as queueAs.
        # sendAs's gate is still `this.requireToMessage(sessionId, by)`. The plant reverts it to
        # requireToCommand, the half-fix where a caller queueAs admitted meets a stricter gate on
        # the delivered path. Killed by `a-message-that-crosses-a-project.test.ts`.
        [
            (HOST, '    const session = this.requireToMessage(sessionId, by)\n', '    const session = this.requireToCommand(sessionId, by)\n'),
        ],
    ),
    # ── the grant, at each reading ─────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants the `same-project:
        # true` entry of the reach table, and that reach no longer exists: `MESSAGING_REACH` is now
        # `['none','any']`. Commit bd70d693: "same-project reach ... removed" (the card lists
        # `same-project` reach among the deliberate removals), so there is no widening left to
        # plant. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 `same-project` reaches past what it started too · the widening nobody ruled, and "
        "the row this table exists to make measurable: every identity may then put words into a "
        "conversation in its project that it did not open — a person's own, included — and the "
        "caller that must STILL be refused is what kills it, not the one that must be admitted",
        [(RAILS,
          "  none: false,\n  'same-project': false,\n  any: true,",
          "  none: false,\n  'same-project': true,\n  any: true,")],
    ),
    (
        "M5 · ⛔ the reach reads the wrong column · `can_interrupt` where `can_message` belongs — "
        "HO-006 §4.3's *\"two grants, two gates\"* collapsed into one, so the word a person set for "
        "cutting into a conversation decides who may speak to it",
        [(HOST, THE_GRANT, "    return reachesWhatItDidNotStart(allowed.canInterrupt)")],
    ),
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks `mayCommand` of `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
    (
        "M6 · ⚠️ the grant REPLACES `mayCommand` instead of joining it · the shape a disjunct "
        "arrives in when the old clause is lost with it: a parent holding the ruled default can no "
        "longer message the child it spawned a moment ago, and the capability rails it was built to "
        "narrow become unreachable",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — D-017 R10 routes a
        # commander that could never be reopened through its replacement (`commandedNow`); the
        # disjunct that a parent reaches what it started is unchanged.
        [
            (HOST, '    if (mayCommand(this.commandedNow(target), by)) return true\n', ''),
        ],
    ),
    # ── the two clauses about the caller itself ────────────────────────────────────────────────
    (
        "M7 · ⛔ a conversation may reach ITSELF through the grant · the loop no door offers, opened "
        "in the predicate — an identity with a global reach queues its own words into its own "
        "mailbox, and the tool's `that-agent-is-you` is the only thing left standing in front of it",
        [(HOST,
          "    if (speaking === null || speaking === sessionId) return false",
          "    if (speaking === null) return false")],
    ),
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 reads the self arm off `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
    (
        "M8 · ⚠️ the caller stops being told about ITSELF · `424`'s split undone from underneath, "
        "and since `433` §B routed the readers through this predicate the SAME deletion also drops "
        "the caller's own row out of `list_agents` — so the defect is now *a self-message is "
        "`no-such-agent` about an id the caller can no longer see either*, which is `422`'s finding "
        "with its advertisement removed as well",
        [(HOST, '    if (target.id === me) return true\n', '')],
    ),
    (
        "M12 · ⚠️ the identity row's ABSENCE becomes the ruled defaults · the fallback that looks "
        "tidy and is the widening `unknown-profile` refuses one door over: a conversation whose "
        "identity row cannot be read is handed whatever the app rules today, so a grant nobody made "
        "decides who it may reach",
        [(HOST, "    if (allowed === null) return false", "    if (allowed === null) return true")],
    ),
    (
        "M9 · 🔴 an identity this app cannot place is ADMITTED · `admitMessaging`'s own direction "
        "reversed one gate earlier — a conversation swept out of the user's own home, with no "
        "`agent_profile` row and therefore no grant anybody made, reaching every conversation in "
        "the app",
        [(HOST, "    if (mine === null) return false", "    if (mine === null) return true")],
    ),
    # ── the widening that must NOT travel ──────────────────────────────────────────────────────
    (
        "M13 · ⛔ the ONE positive is taken away · `any` stops reaching past what its holder started, "
        "so the whole dispatch is undone from the table rather than from the gate: every other line "
        "stays exactly where it is and criterion 6's capability half goes back to being unreachable",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The reach table is now
        # `{ none: false, any: true }` because `same-project` was removed (D-016a). The positive
        # still exists, so setting `any: false` takes it away as the label says, and the old anchor
        # only lost the middle line. Tests that grant `canMessage: 'any'` and expect a foreign
        # conversation to be visible or admitted go red.
        [
            (RAILS, '  none: false,\n  any: true,\n', '  none: false,\n  any: false,\n'),
        ],
    ),
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 reads `target` (the slot, or what the quit closed) at the reach's first question. The DEFECT this row plants is unchanged.
    (
        "M14 · ⚠️ a missing slot is ADMITTED · the fold that carries the non-leak, opened from the "
        "other end: an id that was never a session passes the door and dies inside the host, so the "
        "caller can tell a conversation that exists from one that never did by the SHAPE of what "
        "comes back",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — withinMessagingReach's
        # fold still admits a missing slot with `false` (refused) rather than `true`; only the
        # fallback changed from the quit-only `this.keptOpen(sessionId)` to D-017's
        # `this.startable(sessionId)`, per the R2 comment right above the line. The non-leak
        # property the row protects — a conversation that never existed answers identically to one
        # this caller cannot reach — is unchanged.
        [
            (HOST, '    const target = this.slots.get(sessionId) ?? this.startable(sessionId)\n    if (target === undefined || target === null) return false\n    if (target.id === me) return true', '    const target = this.slots.get(sessionId) ?? this.startable(sessionId)\n    if (target === undefined || target === null) return true\n    if (target.id === me) return true'),
        ],
    ),
    (
        "M15 · ⛔ the gate stops delegating to its own question · `requireToMessage` keeps its name "
        "and asks `assertMayCommand`, which is the shape a widening arrives in when somebody makes "
        "the two gates agree again — every call site still reads correctly and the reach is gone",
        # ⚑ **RE-ANCHORED at `681`, not retired** — the gate also asks the walls a door hands it
        # (PM ruling R30b), so its body is a block now. ⛔ The DEFECT is unchanged: the gate asks
        # `assertMayCommand`. Re-applied and re-run individually after the correction.
        [(HOST,
          "    return this.sessionFor(sessionId, (slot) => {\n      this.assertMayMessage(slot, by)\n",
          "    return this.sessionFor(sessionId, (slot) => {\n      this.assertMayCommand(slot, by)\n")],
    ),
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks `end_agent`'s entitlement of `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The row's entire subject is
        # `end_agent`'s own entitlement check widening to include `withinMessagingReach`. `endAgent`
        # and the `end_agent` tool are gone (confirmed: no occurrence anywhere in runtime-host.ts or
        # agent-tools.ts; the one remaining mention is a comment noting its removal).
        # `interruptAgent`, the verb that took its place, is deliberately NOT widened by
        # `withinMessagingReach` — its entitlement is `mayCommand ‖ mayInterruptDownTheChain`, per
        # the documented HO-095 §4 chain ruling — and interrupting a turn is reversible, not the
        # destructive act the row was written against. Its anchor is left stale, so the census
        # records it retired.
        "M10 · 🔴 `end_agent` takes the wider question · the trap `430` named in as many words — "
        "*\"widening `mayCommand` globally would also widen other commands and is not the price of "
        "this criterion\"* — arriving one verb at a time instead of all at once, so an identity "
        "granted a reach may DESTROY a conversation in another project",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: `endAgent` asks a
        # relationship (commander, or the chain above), never the message reach. The killer §2 was
        # re-aimed by D-014 to say so, and it still runs with canMessage 'any'. Re-verified RED
        # alone.
        [
            (HOST, "    if (\n      !mayCommand(target, by) &&\n      !mayInterruptDownTheChain(by, this.ancestorsAsItWillRun(sessionId))\n    ) {\n      return 'no-such-agent'\n    }\n", "    if (\n      !mayCommand(target, by) &&\n      !mayInterruptDownTheChain(by, this.ancestorsAsItWillRun(sessionId)) &&\n      !this.withinMessagingReach(sessionId, by)\n    ) {\n      return 'no-such-agent'\n    }\n"),
        ],
    ),
    (
        "M11 · ⛔ `sendInterrupting` takes the wider gate · the same trap on the verb HO-006 §4.3 "
        "made a capability of its own: cutting into a conversation in another project, which is "
        "exactly what `431` §2.1.1 forbids and which no behaviour test can see today because no "
        "toolset reaches that verb",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives:
        # `sendInterrupting` still asks the strict `requireToCommand`, and §3's census still pins
        # exactly two `requireToMessage` callers and four `requireToCommand` calls. Re-verified RED
        # alone.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — sendInterrupting still
        # asks requireToCommand (the strict, project-scoped gate), listed explicitly today as one of
        # requireToCommand's siblings beside cancelQueuedMessage and interrupt. D-017 R1 only
        # inserted a new idle short-circuit (`if (!this.runsNow(sessionId) && theSurfaceAsking(by)
        # !== null) return this.send(...)`) and a window-take call before that line, so the old
        # anchor (which assumed the gate line came right after the signature) no longer matches, but
        # the gate itself is untouched.
        [
            (HOST, '    this.aPersonsWindowTakesIt(sessionId, theSurfaceAsking(by))\n    const session = this.requireToCommand(sessionId, by)\n', '    this.aPersonsWindowTakesIt(sessionId, theSurfaceAsking(by))\n    const session = this.requireToMessage(sessionId, by)\n'),
        ],
    ),
]
