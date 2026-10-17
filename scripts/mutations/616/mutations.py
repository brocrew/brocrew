"""616 · The proposal that stops holding — a proposal ends when it is decided, never on a clock.

⛔ **The ruling is `HO-093` §2 and it is one sentence:** *"A proposal ends when it is decided or
withdrawn. Never on a clock."* ⚑ **The fourth clock removed for that reason** — `HO-018` §2.1 for
tasks, `HO-082` §2 for questions, `HO-088` §3.1 for escalation, and this.

## 🔴 What this table has to guard, and it is not the same thing `615`'s guards

⚠️ **`615` built the CARRIER and its rows are about whether a decision arrives, once.** ⛔ **This
dispatch removed the WAIT**, and the rows below are about the three ways that goes wrong:

 - ⛔ **the hold comes back** — as a status, as a timer, or as a card that is dead on arrival
   (`M1`, `M2`, `M3`);
 - ⛔ **the carrier stops being exactly one** — `591 M6` re-created from the other side, now that
   there is no guard left to stop it (`M4`);
 - ⛔ **the WORDS stop being honest** — a description that promises a wait, an answer that loses
   the one act it carries, or a field that can only ever hold one value (`M5`, `M6`, `M7`);
 - ⛔ **the release stops closing the hold** it no longer settles a promise for (`M8`).

## ⚑ A · why `M1` is the one to read first

🔴 **`446`'s repair is deliberately reversed by this dispatch and `M1` is what keeps the reversal
honest.** ⛔ `446` joined `441`'s parked call to the wait count the permission and question brokers
use, so a conversation with a card in front of a person reported `waiting_permission` rather than
`working`. ⚠️ **`SessionHandle.waitForAPerson`'s own contract is *a call in this conversation is
parked on a person right now*** — taken immediately before an `await`, released immediately after —
and `395` ruled against putting a second meaning into that counter. ⚑ **With no `await` there is
nothing for it to describe**, and taking it anyway publishes a 0 → 1 → 0 edge in one synchronous
stretch.

⛔ **What that costs is REPORTED rather than repaired** (standing rule 14): `admitInterrupt` reads
the status, so `a-person-is-being-asked` was what stopped an agent's `interrupt_agent` throwing
away a card a person was looking at. ⚠️ That rail only ever covered the first five minutes — after
`441`'s bound fired the status came back and the interruption was admitted — 🔴 **and this dispatch
takes that window to zero.** ⚑ Closing it means asking the DURABLE question at that door
(`aPersonOwesADecisionIn`), which is a ruling about when an agent may interrupt.

## ⚠️ B · `M2` is killed by a CENSUS and that is deliberate

⛔ **A behavioural row for a five-minute wait costs five minutes of wall clock**, and a vitest
timeout is not a measurement of anything (standing rule 22 — *a wall-clock bound reports the
machine, not the code*). ⚑ **The right instrument for *a timer came back* is a source census**,
which is the shape `608` used for `askBoundMs` and which this dispatch's §5 uses by name:
`bodyOf(hostCode, 'async proposeProject(')` may contain no `setTimeout`, no `Promise.race` and no
`waitForAPerson`. ⚠️ The row plants a SHORT wait on purpose, so that a table run cannot hang.

## 🔴 C · the ORDERING row that was drafted, APPLIED, and did not ship

⛔ **`M5` was going to be *the words go out before the row is durable*** — `393`'s ordering, and
what `615`'s microtask note becomes once there is only one carrier. ⚠️ **It was written, applied
to the tree, and SURVIVED.** ⚑ Both statements run in one synchronous stretch and
`deliverDecision` suspends at its first `await` before `queueMessage` writes anything, so swapping
them changes nothing any reader outside the method can see.

🔴 **It is recorded here rather than shipped green** (`a-mutation-that-changes-nothing-reports-as-a-survivor`;
`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⛔ **And the test that would have been its
killer was CORRECTED rather than left claiming the measurement** — `the-proposal-that-stops-holding.test.ts`
§4 now says in its own words that the statement order is not observable from out here, and pins
what is: the press does not wait on the mailbox, and the door is synchronous.

⚑ **`479`'s own docblock reached the same conclusion about this door before `616` existed**, which
is the tell that this is the door's shape and not this dispatch's omission.

## ⛔ D · what else has NO row, said rather than left out

⚠️ **No row making `decideProposal` `async`, and none inserting an `await` into it.** ⛔ Both are
the hazard `615`'s microtask note named and `616` re-aimed — but an `await` in a synchronous method
does not parse, and `async` plus a `Promise` return breaks every call site at once, so the run
would go red for *the file did not build* rather than for the rule. ⚑ **The rule is pinned by a
census instead** — §4's `not.toContain('async decideProposal(')` beside a body with no `await ` —
which is the right instrument for a shape (`a-source-census-must-strip-prose-before-it-asserts`).

⚠️ **No row deleting the delivery outright and none making it approvals-only.** ⛔ Those are
`615 M1` and `615 M4`, whose anchors this dispatch CORRECTED onto the unconditional line rather
than retiring (`correct-a-stale-mutation-anchor-dont-retire-it`) — and both were re-verified by
hand afterwards, because `a-corrected-anchor-keeps-a-verdict-it-never-earned`.

⚠️ **`M4` doubles the delivery SEQUENTIALLY and not by repeating the line, and that is measured.**
⛔ Two `void`ed calls in one tick both read the receiver as idle, both call `send`, and the second
throws into `deliverDecision`'s own `catch` — so the words are dropped with a `console.warn` and
the ledger holds ONE turn. ⚑ **The row would have SURVIVED written that way**, which is worth
knowing on its own: a second carrier racing the first at this seam loses silently rather than
reaching a model twice. ⚠️ A second carrier added LATER — which is the shape `591 M6` describes —
does land, and that is what `M4` plants.

⚠️ **No row restoring `PROPOSAL_BOUND_MS` as a constant.** ⛔ It has no reader to restore it for:
a bound nothing reads is dead code and the census that would catch it (§5) is the same one `M2`
attacks from the live side.

⚠️ **No row on the `withdrawn` arm reaching nobody.** ⛔ That is a FINDING of this dispatch and not
a rule it enforces: `whatTheDecisionMeans`' third sentence now has no reader, and the assertions
holding that gap open are in `a-project-he-described.test.ts` and
`what-approving-a-proposal-actually-does.test.ts` §7, written as inverted defect assertions.
⚑ A mutation row would say this app has decided the silence is correct, and it has not.
"""

from __future__ import annotations

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

HOLD = "    this.proposalsThisAppHolds.set(proposalId, { session: me, waiting: true })"
DELIVERY = "    void this.deliverDecision(sessionId, proposal, ending, created)"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the hold, coming back ──────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The hold this row guards
        # (`proposalsThisAppHolds`, the `proposeProject` verb and its `waitForAPerson` question) was
        # deleted with proposals; nothing in runtime-host.ts holds a proposal any more. Commit
        # bd70d693: "Proposals go end to end"; the anchor line is gone and no other
        # conversation-holds-a-card call shares its shape. Its anchor is left stale, so the census
        # records it retired.
        "M1 · 🔴 **the conversation says a person is being asked, with nothing blocked** · the app "
        "joins the wait count again for a call that returns immediately, so the wire publishes "
        "`waiting_permission` for a conversation that is free to work. ⛔ The composer freezes on "
        "a proposal nobody is held by, the stall watchdog stays disarmed, and `admitInterrupt` "
        "refuses every agent with a sentence about a question that is not being waited on. ⚑ It "
        "is `395`'s ruling broken from the other direction — one counter, two meanings — and "
        "`waitForAPerson`'s own contract says the hold may not outlive the `await` it was taken "
        "before",
        [(HOST, HOLD, HOLD + "\n    session.handle.waitForAPerson()")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `proposeProject` and `create_project`
        # no longer exist, so there is no verb whose body could grow a clock again. bd70d693:
        # "create_project and list_projects ... are removed. Proposals go end to end". Its anchor is
        # left stale, so the census records it retired.
        "M2 · ⛔ **a clock comes back into the verb** · the call waits again before it answers, so "
        "a proposer's turn is held open for as long as somebody chose — which is the whole of what "
        "`HO-093` §2 removed, whatever the number is. ⚠️ **Killed by a source census on purpose**: "
        "a row that planted the real five minutes would cost five minutes of wall clock and "
        "report the machine rather than the code (standing rule 22), so the wait planted here is "
        "short and the instrument is `§5`'s body reader — no `setTimeout`, no `Promise.race`, no "
        "`waitForAPerson` inside `proposeProject`",
        [
            (
                HOST,
                "    return { ok: true, proposalId, slug }\n",
                "    await new Promise((resolve) => setTimeout(resolve, 250))\n"
                "    return { ok: true, proposalId, slug }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The proposal hold map and the card
        # whose door refused a dead hold are deleted with proposals (bd70d693, "Proposals go end to
        # end"); `proposalsThisAppHolds` has no remaining reference in apps/desktop/src. Its anchor
        # is left stale, so the census records it retired.
        "M3 · ⚠️ **the card is dead on arrival** · the hold is created already closed, so the "
        "proposal is published, drawn, and refused by its own door the instant anybody presses — "
        "*nobody is waiting for an answer to that any more*, about a card that has been on screen "
        "for one second. ⛔ **This is `441 M17`'s rule in the shape it survives in**: that row "
        "made the BOUND close the hold and its subject went with the bound, and a hold that is "
        "never open is the same defect with the clock set to zero. ⚑ Criterion 21 is *his "
        "approval as the only gate* and this makes it no gate at all",
        [(HOST, HOLD, "    this.proposalsThisAppHolds.set(proposalId, { session: me, waiting: false })")],
    ),
    # ── B · the carrier, which is now unguarded by construction ────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The proposal decision carrier
        # (`deliverDecision`, `decideProposal`) went with proposals, so there is no approval press
        # to double-deliver. The surviving carriers (answer delivery, work report) are other rows'
        # subjects, not this defect. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 **the proposer is told TWICE for one press** · the decision goes out on two "
        "deliveries, so one person's Approve becomes two turns in the proposer's ledger and a "
        "model reads *the project exists now* twice with nothing to tell it they are one event. "
        "⛔ **This is `591 M6` by name** — *the words are delivered EVEN WHEN a turn is still "
        "waiting, so a worker gets its answer twice* — and it is `HO-093` §3.1's whole question: "
        "`615` kept `aCallIsStillWaiting` to stop exactly this, and the answer is that the flag "
        "could go because the OTHER carrier went. ⚑ With one carrier the count is the guard, so "
        "the count is what a row has to attack",
        [
            (
                HOST,
                DELIVERY + "\n",
                "    void this.deliverDecision(sessionId, proposal, ending, created).then(() =>\n"
                "      this.deliverDecision(sessionId, proposal, ending, created),\n"
                "    )\n",
            )
        ],
    ),
    # ── D · the words a model reads, which standing rule 8.1 owed ──────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `create_project` tool description
        # is deleted; agent-tools.ts has no 'Put a new piece of work in front of the person'
        # sentence (only `propose_agent_rules`, an instruction arm that is a different feature).
        # bd70d693: "create_project and list_projects ... are removed". Its anchor is left stale, so
        # the census records it retired.
        "M5 · ⚠️ **the description promises a wait it does not take** · `create_project` tells a "
        "model the call waits while a person decides and returns what they decided, which is what "
        "it said until this dispatch and is now false in both halves. ⛔ **A verb that returns "
        "without the thing its name promises, and does not say so, reads as a verb that failed** — "
        "so a model meets an answer with no decision in it and reasonably concludes something went "
        "wrong. ⚑ Standing rule 8.1: the sweep for sentences describing the OLD behaviour is part "
        "of implementing a ruling, not a follow-up",
        [
            (
                TOOLS,
                "        'Put a new piece of work in front of the person you are talking to. Nothing is created unless they approve:",
                "        'Put a new piece of work in front of the person you are talking to, and wait while they decide. Nothing is created unless they approve:",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The sentence 'Do not propose it again
        # ...' belonged to `create_project`'s answer, which is gone with the verb (bd70d693). No
        # other tool answer carries that clause. Its anchor is left stale, so the census records it
        # retired.
        "M6 · 🔴 **the answer loses the one act it carries** · the model is told its proposal is in "
        "front of somebody and not told to leave it alone, so it reasonably proposes the same work "
        "again and puts a SECOND card in front of a person who has not answered the first. ⛔ "
        "`441` §2.2 wrote that clause for exactly this, and `616` made it load-bearing: the call "
        "used to say *nobody has answered yet* after five minutes of waiting, and now says it "
        "immediately — so the instruction not to retry is the only thing standing between one "
        "proposal and a queue of them",
        [
            (
                TOOLS,
                " Do not propose it again — that would put a second decision in front of them for the same work.",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The payload with `outcome: 'ok',
        # proposal, stored_name` was `create_project`'s answer and is deleted; there is no
        # `decision: 'nobody-answered'` field to re-add. bd70d693 removed the verb and proposals end
        # to end. Its anchor is left stale, so the census records it retired.
        "M7 · ⚠️ **a word that can only have one value comes back onto the payload** · the answer "
        "reports `decision: 'nobody-answered'` on every call this app will ever make, because "
        "nobody can have decided by the time it returns. ⛔ **`608`'s sentence, one verb over**: a "
        "payload field whose value never varies is a fact a model has to read and can never act "
        "on — and this one is worse than useless, because it is a word ABOUT a decision, in a "
        "payload a supervisor may quote hours after the decision was taken",
        [
            (
                TOOLS,
                "            { outcome: 'ok', proposal: outcome.proposalId, stored_name: outcome.slug },",
                "            {\n"
                "              outcome: 'ok',\n"
                "              proposal: outcome.proposalId,\n"
                "              stored_name: outcome.slug,\n"
                "              decision: 'nobody-answered',\n"
                "            },",
            )
        ],
    ),
    # ── E · the release, whose promise went and whose flag did not ─────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The release loop that cleared
        # `held.waiting` on a stopped conversation's proposal hold is deleted with
        # `proposalsThisAppHolds` (bd70d693 diff removes the map and its `.get(proposal.proposalId)`
        # release). The question-release path is a different table's subject. Its anchor is left
        # stale, so the census records it retired.
        "M8 · ⛔ **a stopped conversation goes on holding its proposal** · the row says `withdrawn` "
        "and this host's map still says `waiting`, so the one-at-a-time rail refuses every new "
        "proposal that conversation makes for the rest of the process — *only their answering the "
        "first one ends this*, about a card belonging to a turn the person already stopped. ⚑ "
        "**`441` gave this loop its reason in as many words** and `616` is where it becomes the "
        "loop's ONLY job: the promise it used to settle went with the hold, so the flag is all "
        "that is left and a row that stopped writing it would look like a loop doing nothing",
        [(HOST, "      if (held !== undefined) held.waiting = false\n", "")],
    ),
]
