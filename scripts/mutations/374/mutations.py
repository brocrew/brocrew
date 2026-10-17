"""374 · the rails a message passes — each row is THE DEFECT, put back (131).

⛔ **What this dispatch shipped is one gate, called from four verbs, over two capabilities**, and
every row below is one of those facts untold. `can_message` was a column `341` landed and nothing
branched on — `341` said so in a test, and `374` flipped that test — and `can_interrupt` did not
exist. The rule the whole thing reduces to is one sentence: **a capability here NARROWS what
`mayCommand` already allows and can never widen it**, so `'any'` is *no further narrowing* rather
than a key to the app.

⚠️ **`431` made the second half of that sentence false and left every row here standing.** `'any'`
now also admits a conversation the caller did not start, through `RuntimeHost.withinMessagingReach`
at the message door — so the rule these rows measure is *the capability still NARROWS what the
entitlement admits*, and the entitlement is no longer `mayCommand` alone for `message`. ⛔ **No row
was re-anchored and none needed to be**: every one of them is about `admitMessaging`, which is
unchanged, and `431` is what finally gave the `'any'` arm a product-path killer.

⚑ **The safety property, stated in the direction the rows read.** A person is never asked the
question at all — `sessionSpeakingAs` decodes only `agent:<id>`, so a window and `THE_APP_ITSELF`
leave the gate on its first line. That is an ABSENCE of a question rather than an exemption, and
`M11` is what makes the absence load-bearing rather than decorative.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6` | ⚑ **`run_suite`** — `apps/desktop/test/the-rails-a-message-passes.test.ts` §1-§3, §5 |
| `M7`-`M11`, `M14` | ⚑ **`run_suite`** — the same file, §2, §4 and §7 |
| `M12` | ⚑ **`run_suite`** — the same file, §6 (the permanence set) |
| `M13` | ⚑ **`run_suite`** — the same file, §1 (*a PERSON is never asked the question*) |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the fold.** `parseChoice` is `341`'s `parseCanMessage` generalised, and its
narrowest-not-ruled rule is `341` `M35` — whose anchor `374` CORRECTED rather than retired. A second
row on the same line would be one rule spelled in two tables.

⛔ **No row widening `mayCommand`, `mayControl` or `mayAnswerAsAHuman`.** `340` and `349` own those
and `374` touched none of them — that is the safety property, and §5 of the suite presses it rather
than a row asserting a rule this dispatch did not ship.

⛔ **No row on `cwd-outside-parent`, `spawn-must-prompt` or the admission token.** `371`, `366` and
`341` own them; §5 re-asserts them against the new gate because a second door is exactly where a
first one goes quiet, but the ROWS stay in the tables that measure them.

⛔ **No row on criterion 6's unreachability.** The census in §4 asserts that nothing in `src/main`
places a session in a project; a mutation that made one would be a mutation on a feature this
dispatch did not build.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"

# ⚠️ **Each gate line is anchored WITH its neighbour**, because the line on its own occurs three
# times in the host and an anchor that matches more than once proves nothing about which door it hit.
SEND_GATE = (
    "    this.assertMayReach('message', sessionId, by)\n"
    "    await this.assertCanTakeTurn(session, 'send', {\n      text,\n      attached: attachments.length,\n      from: this.originOf(by),\n    })"
)
# ⚑ **Corrected in place by `553`, which put HO-060 §2's SECOND gate between the two lines** —
# `142`'s rule again, and the same one `395` and `397` applied to `INTERRUPT_GATE`: the row names
# the same defect, its span moved, so it is re-anchored rather than retired. ⛔ **The replacement
# drops `assertMayReach` and KEEPS `assertMayAssign`**, so the mutation is still exactly *the queue
# door stops asking whether this identity may MESSAGE at all* and is not quietly two defects.
# ⚠️ **`553` kept the four lines of that run CONTIGUOUS for this reason**, and said so at the
# source: an anchor that spans prose goes stale every time somebody edits a sentence.
#
# ⚑ **Re-anchored again by `565 relay 1`, and again not retired** (142's rule, a third time on this
# constant). HO-066 §2.3 gave the assignment gate a third arm read off the RECEIVER, so the run
# gained `const takesWorkFrom = …` and the gate call gained an argument. ⛔ **The replacement still
# drops `assertMayReach` and KEEPS everything else**, so the row is still exactly *the queue door
# stops asking whether this identity may MESSAGE at all* and is not quietly two defects.
# Re-applied and re-run individually after the correction.
# ⚑ **RE-ANCHORED at `681`, not retired** — PM ruling R30b asks `queueMessage`'s walls INSIDE the
# entitlement's gate, before *not started*, so the capability line sits in that closure now and the
# breadth read beside it is spelled off the receiver's slot. ⛔ The DEFECT M1 plants is unchanged:
# the queue door stops asking the messaging capability. Re-applied and re-run after the correction.
QUEUE_GATE = (
    "      this.assertMayReach('message', sessionId, by)\n"
    "      takesWorkFrom = this.howManyCallersItTakesWorkFrom(receiver.id)\n"
)
QUEUE_GATE_REPLACEMENT = "      takesWorkFrom = this.howManyCallersItTakesWorkFrom(receiver.id)\n"
BOTH_GATES = (
    "    this.assertMayReach('interrupt', sessionId, by)\n"
    "    this.assertMayReach('message', sessionId, by)"
)
# ⚑ **Corrected in place by `395`, which put the *"who asked"* row between the gate and the call**
# — `142`'s rule: the row still names the same defect and its span moved, so it is re-anchored rather
# than retired. The replacement drops the gate and keeps the recording, so the mutation is still
# exactly *"the interrupt door stops asking"* and nothing else.
# ⚑ **Corrected AGAIN by `397`**, same rule and the same claim: the person's door now reaches the
# provider through `askTheWorkToStop`, the one path that records the ask and writes the endings for
# the questions the stop threw away. The replacement drops the gate and keeps the act, so the row is
# still exactly *"the interrupt door stops asking"*.
# ⚑ **720 · ANCHOR CORRECTED in place (standing rule 27), the subject untouched** — `709` F-6
# bounded the Stop door, so the ask is held in `stopping` and raced against the wait instead of
# awaited on this line. The defect is the same: the door stops asking whether the caller may
# interrupt. Re-verified RED alone after the correction.
INTERRUPT_GATE = (
    # ⚑ **723 · re-anchored in place, not retired** — 723's second-press check (R83) sits between the interrupt gate and the ask; the row still deletes the gate at the Stop door
    "    this.assertMayReach('interrupt', sessionId, by)\n    // 🔴 **723 · R83 — a second press joins the first ask**: *\"a second press does not queue a second"
)

# ⚑ **708 · anchors corrected in place, not retired** (standing rule 27): `R42` handed every turn
# gate a `from`, so each `assertCanTakeTurn(` call gained that key and most now span several
# lines; the rows below that named a gate call were re-spelled to it and each re-verified RED
# alone, with its killer named in 708's response.
MUTATIONS = [
    # ── the four doors the gate is called from ────────────────────────────────────────────────
    (
        "M1 · 🔴 the QUEUE door stops asking · an agent a person revoked messaging from hands its "
        "worker a task anyway, and the only thing that ever said no is a column nobody reads",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule still holds:
        # the queue door must ask `assertMayReach('message', ...)` inside `queueAs`'s
        # `requireToMessage` callback, so an agent whose `can_message` a person set to `none` cannot
        # hand its worker a task through `host.queueMessage`. The old anchor (`takesWorkFrom =
        # howManyCallersItTakesWorkFrom(...)`) went with `takes_work_from`; today the gate line sits
        # above `assertMayAssign`, which returns early for the default `note` kind, so nothing else
        # refuses. The `message_agent` tool has its own `mayReachAtAll` wall, so the killers are the
        # host-level `queueMessage` cases.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the queue door asks `can_message` through `assertMayReach('message', ...)`. That
        # now sits inside the `requireToMessage` walls callback of `queueAs`, guarded by `says !==
        # null` because a give's brief passes none. The `assertMayAssign` lines are gone. The plant
        # drops the callback so the busy-receiver queue path stops asking. Killed by
        # `the-rails-a-message-passes.test.ts`.
        [
            (HOST, "    const session = this.requireToMessage(sessionId, by, () => {\n      if (says !== null) this.assertMayReach('message', sessionId, by)\n    })\n", '    const session = this.requireToMessage(sessionId, by)\n'),
        ],
    ),
    (
        "M2 · 🔴 the SEND door stops asking · the idle path is the one `message_agent` actually "
        "takes when a child is not busy, so this is the hole under the tool rather than beside it",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The idle send path in
        # `queueAs` still asks `assertMayReach('message', …)` right before `assertCanTakeTurn`, just
        # now inside a `try` block D-017 added for the R1 stop-and-retry logic. Removing the
        # `assertMayReach` line reproduces the same hole under `message_agent`'s idle branch.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `send` (and `queueMessage` on an idle receiver, which delegates to it) asks
        # `can_message` at `sendAs`. The old gate line is now the `if (how.ifItLosesTheRace !==
        # 'pass-it-on' || how.says !== null)` block, which spares only a give's brief. The plant
        # deletes the block, so the idle and direct send path stops asking. Killed by
        # `the-rails-a-message-passes.test.ts`.
        [
            (HOST, "    if (how.ifItLosesTheRace !== 'pass-it-on' || how.says !== null) {\n      this.assertMayReach('message', sessionId, by)\n    }\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The defect is now D-014's decision. The
        # commit says 'End and interrupt reach the chain below the caller, with no grant and no
        # project floor', and `assertMayReach('interrupt', …)` is gone from `interrupt()`. Its
        # anchor is left stale, so the census records it retired.
        "M3 · 🔴 the INTERRUPT door stops asking · an agent granted nothing throws away whatever "
        "another conversation was in the middle of, which HO-006 calls the act worth granting apart",
        [(HOST, INTERRUPT_GATE, "    // 🔴 **723 · R83 — a second press joins the first ask**: *\"a second press does not queue a second")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The defect this row plants
        # (sendInterrupting asks only the message gate, no interrupt grant) is exactly what D-014
        # shipped. Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ `sendInterrupting` asks only whether it may SEND · the verb that cancels an "
        "in-flight tool call is reachable by an identity refused exactly that",
        [(HOST, BOTH_GATES, "    this.assertMayReach('message', sessionId, by)")],
    ),
    (
        "M5 · ⛔ `sendInterrupting` asks only whether it may INTERRUPT · words get delivered by the "
        "one verb that never asked whether this identity may deliver any",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives. sendInterrupting
        # still asks the message capability ('⛔ **The message capability, because this verb delivers
        # words** (374)'), and no later gate on its normal path re-asks it. Re-verified RED alone.
        [
            (HOST, "    // A call refused here never raises `holdingQueue`, so it never has to be released.\n    this.assertMayReach('message', sessionId, by)\n", '    // A call refused here never raises `holdingQueue`, so it never has to be released.\n'),
        ],
    ),
    (
        "M6 · ⚠️ the fifth commanding verb is gated too · a person narrowing a grant strands the "
        "message already held, because the caller that put it there may no longer take it back",
                # ⚑ **Anchor corrected in place by `394`, not retired** (142's rule) — the cancel
                # finds its message in the MAILBOX now. ⛔ **The DEFECT is unchanged**: the fifth
                # commanding verb gains the gate its own docblock says it must not have.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `cancelQueuedMessage`
        # still deliberately has no `assertMayReach` gate — the rule that a narrowed grant must not
        # strand an already-queued message is untouched by D-017's R3 handed-on-messages work.
        # Inserting the gate right after `requireToCommand` reproduces the same over-widening this
        # row protects against.
        [
            (HOST, '  async cancelQueuedMessage(sessionId: string, messageId: string, by: Caller): Promise<void> {\n    const session = this.requireToCommand(sessionId, by)\n    // ⚑ **D-017 · R3 — a conversation on its way out has handed what it held on** to its next start', "  async cancelQueuedMessage(sessionId: string, messageId: string, by: Caller): Promise<void> {\n    const session = this.requireToCommand(sessionId, by)\n    this.assertMayReach('message', sessionId, by)\n    // ⚑ **D-017 · R3 — a conversation on its way out has handed what it held on** to its next start"),
        ],
    ),
    # ── one gate or two ───────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the `interrupt:
        # 'canInterrupt'` row from REACH_OF on purpose, together with `interrupt`/`end` in RAILS_OF
        # and the may-not-interrupt rails. Its anchor is left stale, so the census records it
        # retired.
        "M7 · 🔴 both acts read ONE capability · `can_interrupt` becomes a consequence of "
        "`can_message`, which is the exact thing HO-006 §4.3 ruled it must not be",
        [(RAILS, "  interrupt: 'canInterrupt',", "  interrupt: 'canMessage',")],
    ),
    # ── the readings inside the door ──────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label plants `null === null` in
        # the project comparison that decided whether two conversations share a place, and D-016a
        # removed that comparison along with `same-project` reach. `MessagingReach` is now `'none' |
        # 'any'`, `admitMessaging` and `refuseAway` are gone, and no code compares two projects any
        # more. Commit bd70d693: "same-project reach and the project argument on spawn_agent and
        # list_agents are removed." Its anchor is left stale, so the census records it retired.
        "M8 · ⛔ two conversations this app cannot place count as the SAME place · `null === null` "
        "is true in JavaScript and false as an answer, and the widening is silent",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives. admitMessaging's
        # `same-project` branch still treats an unknown project on either side as a miss, and
        # canMessage 'same-project' is still a value a person can set. Re-verified RED alone.
        [
            (RAILS, '  // thereby in the same place, and the safe reading of *we cannot tell* is *not yours to reach*.\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine !== null && theirs !== null && mine === theirs) return null', '  // thereby in the same place, and the safe reading of *we cannot tell* is *not yours to reach*.\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine === theirs) return null'),
        ],
    ),
    (
        "M9 · 🔴 an identity this app cannot find gets the RULED grant · a conversation attributed "
        "to no profile of ours is handed `same-project`, which is a grant nobody made",
                # ⚠️ The ruled default written as its LITERAL and not as `DEFAULT_CAPABILITIES`,
                # which this module does not import: a replacement that throws `ReferenceError`
                # would be red for a reason that is not the defect.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule still holds: an
        # identity with no `agent_profile` capabilities must be refused, never handed a grant nobody
        # made. `same-project` no longer exists, so the plant hands it the only widening left,
        # `any`, at the same spot in `admitReachAtAll` (`allowed === null`). The rule is still
        # pinned by the section 1 'cannot place' test and the section 7 'no capabilities at all'
        # test.
        [
            (RAILS, '  if (allowed === null) return refuseMessage(RAIL_OF[act])\n  const reach: MessagingReach = allowed[REACH_OF[act]]\n', "  const reach: MessagingReach = allowed === null ? 'any' : allowed[REACH_OF[act]]\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about `same-project`
        # collapsing into `any`, and D-016a deleted `same-project` from the reach vocabulary on
        # purpose. The section 6 test now pins `MESSAGING_REACH` equal to `['none', 'any']`, so
        # there is no third word left to collapse and no default grant that silently widens. Commit
        # bd70d693: "same-project reach ... removed". Its anchor is left stale, so the census
        # records it retired.
        "M10 · ⛔ `same-project` collapses into `any` · the one sentence this door is built around — "
        "*a capability here NARROWS and can never widen* — stops being true, and every grant a "
        "person ever set to the default silently reaches everywhere",
        [
            (
                # ⚑ **486 corrected this anchor and not this rule.** The line read
                # `if (reach === 'any') return null`; the wall that answers `none` moved into
                # `admitReachAtAll`, so the surviving guard is the one that decides whether a
                # project is read at all. ⛔ The mutation is the same act as before — admit
                # `same-project` outright — spelled against the line that now carries it.
                # ⚑ **LENGTHENED by `553` and not moved.** `admitAssignment` opens with the same
                # guard — the two doors deliberately share one fall-through shape — so the short
                # form matched twice and a row that matches twice applies to nothing. ⛔ The three
                # lines below are `admitMessaging`'s and nobody else's.
                RAILS,
                "  if (reach !== 'same-project') return null\n"
                "  // ⚑ **`same-project`, and an unknown project on EITHER side is a miss.**",
                "  if (reach === 'any' || reach === 'same-project') return null\n"
                "  // ⚑ **`same-project`, and an unknown project on EITHER side is a miss.**",
            )
        ],
    ),
    (
        "M11 · ⚠️ the payload states a grant that was never read · an identity with no row is told "
        "`reach: none`, so a model reports a column value to a person whose sheet shows another",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule still holds:
        # the refusal for an identity with no row must not state a `reach` that was never read, or a
        # model would tell a person their sheet says `none`. Only the anchor moved: the line is now
        # `refuseMessage(RAIL_OF[act])` in `admitReachAtAll`, and the plant adds `{ reach: 'none' }`
        # there. The same 'cannot place' test asserts `detail.reach` is undefined.
        [
            (RAILS, '  if (allowed === null) return refuseMessage(RAIL_OF[act])', "  if (allowed === null) return refuseMessage(RAIL_OF[act], { reach: 'none' })"),
        ],
    ),
    (
        "M12 · ⚠️ a project miss is reported as something a person can fix · the caller is sent to "
        "ask for a grant when the remedy is in its own hands: name an agent in its own project",
                # 🔴 **486 REVERSED the rule this row encoded, and corrected the row rather than
                # leaving it retired** (HO-031 §2.5). ⛔ It read *"a project miss is reported as
                # something a person can fix"* and mutated `permanent` into
                # `until-a-person-changes-it` — and `486` then measured that the second word is the
                # TRUE one: `admitMessaging` reaches this rail only where a person has set the
                # column to `same-project`, so widening it to `any` admits the identical call.
                # ⚑ **The row still guards the same line and now runs the other way.**
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. The project rail is gone, but PERMANENCE still
        # prices the may-not-* rails 'until-a-person-changes-it'. Planting 'may-not-message' as
        # 'permanent' (not may-not-assign-work, which 486 M13 already plants) should go red in §1
        # 'an identity that may spawn but may not message is refused BY NAME' (`refused.permanence`
        # toBe 'until-a-person-changes-it') and in §6 'every rail has one permanence' (the
        # permanent-rail list would be two rails, not just assign-work-to-one-you-did-not-start).
        # The label's 'project miss' wording is stale, so re-word it as 'a grant-clearable refusal
        # priced permanent'.
        [
            (RAILS, "  'may-not-message': 'until-a-person-changes-it',", "  'may-not-message': 'permanent',"),
        ],
    ),
    # ── who the gate is for ───────────────────────────────────────────────────────────────────
    (
        "M13 · 🔴 a PERSON is gated by the conversation they are typing into · HO-007's *\"the "
        "human unrestricted\"* becomes *\"the human restricted by whatever the agent was granted\"*",
            # ⚠️ **RE-ANCHORED at 675, not retired.** 675 took the question `admitMessaging` answers into `reachRefusalOf`, so a check that only needs to KNOW asks it without logging; the defect is planted in both halves, since a person returns early from the door before it is asked; The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule still holds
        # (HO-007, the human unrestricted): a person typing into a conversation must never be gated
        # by that conversation's own grant, and the section 1 test 'a PERSON is never asked the
        # question' still pins it. `reachRefusalOf` and `admitMessaging` are gone and
        # `mayReachAtAll` has no `sessionId`, so the old two-edit plant would throw a
        # ReferenceError. The new plant is one edit in `assertMayReach`, which decodes the caller as
        # `sessionSpeakingAs(by) ?? sessionId` and asks the gate as that conversation.
        [
            (HOST, '    const speaking = sessionSpeakingAs(by)\n    if (speaking === null) return\n    const refusal = this.mayReachAtAll(act, by)\n', '    const speaking = sessionSpeakingAs(by) ?? sessionId\n    const refusal = this.mayReachAtAll(act, { ownerId: agentCallerId(speaking) })\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label is about the away refusal
        # naming the target's project instead of the caller's, and that refusal (`refuseAway`, the
        # outside-your-project rail and its project detail) was deleted by D-016a. The surviving
        # `may-not-message` payload carries `reach` and `agent` only, with no project field to swap.
        # Commit bd70d693: "same-project reach ... removed". Its anchor is left stale, so the census
        # records it retired.
        "M14 · ⛔ the refusal names the TARGET's project instead of the caller's · a gate that says "
        "*not yours to reach* becomes the reader that tells you where it went",
        # ⚑ **CORRECTED by `553`, and it stayed at THIS door.** The payload expression
        # moved into `refuseAway`, which takes only the caller's project — so the defect
        # this row names cannot be written inside that helper at all, and the line that
        # can still write it is the CALL, where both values are in scope. ⛔ **The anchor
        # is two lines because `admitAssignment` ends with the identical call**, and a row
        # that matches twice applies to nothing. ⚠️ `553 M16` is the same rule at that
        # other door — two call sites, two rows, one rule.
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives. admitMessaging
        # still refuses `same-project` misses through refuseAway with the caller's project.
        # Re-verified RED alone.
        [
            (RAILS, '  // thereby in the same place, and the safe reading of *we cannot tell* is *not yours to reach*.\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine !== null && theirs !== null && mine === theirs) return null\n  return refuseAway(rails.away, reach, mine)', '  // thereby in the same place, and the safe reading of *we cannot tell* is *not yours to reach*.\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine !== null && theirs !== null && mine === theirs) return null\n  return refuseAway(rails.away, reach, theirs)'),
        ],
    ),
]
