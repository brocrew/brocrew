"""375 · a floor under the most destructive verb — each row is THE DEFECT, put back (131).

⛔ **What this dispatch shipped is one line at one call site, and a vocabulary that had to grow to
carry it honestly.** `374` gated four verbs on two capabilities and wrote, in a docblock and in a
test, that `end_agent` was not one of them: *"`end_agent` is not gated by it and is not meant to
be."* ⚑ **HO-016 §1 ruled the opposite**, and the rule the whole change reduces to is one sentence:
**ending is strictly more destructive than interrupting, so it requires at least what interrupting
requires.**

⚠️ **The hierarchy is a TABLE and not a sentence.** `REACH_OF` maps three acts onto two columns, and
`RAILS_OF` maps the same three acts onto six rails — two per act, because a refusal states a fact
about the call that met it and *"it was left alone"* is false of a call that tried to end a
conversation.

🔴 **The safety property, stated in the direction the rows read.** The floor is a SECOND LINE at
`endAgent`'s own call site, asked strictly AFTER `mayCommand` has said yes. `M1` is the whole
dispatch missing; `M3` is the same line in the wrong ORDER, which is the entitlement-before-existence
half; `M12` is the same line in the wrong PLACE, which refuses after the teardown has already run.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M4`, `M12` | ⚑ **`run_suite`** — `apps/desktop/test/a-floor-under-the-most-destructive-verb.test.ts` §1-§4, §7 |
| `M5`-`M7` | ⚑ **`run_suite`** — the same file, §1, §5, §7 |
| `M8`, `M9` | ⚑ **`run_suite`** — the same file, §7 (the payload the tool publishes) · ⚑ landing D-014: that file is gone; `M9`'s killer is `a-refusal-you-can-see.test.ts` §3 |
| `M10`, `M11` | ⚑ **`run_suite`** — the same file, §8, and `test/dom/capabilities-sheet.dom.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the person exemption.** `assertMayReach` leaves on its first line for a caller that is
not an agent, and `374` `M13` is the row that makes that absence load-bearing. This dispatch reuses
the gate rather than adding a second one, so a row here would be one rule spelled in two tables.

⛔ **No row on `null === null`, on the unknown identity, or on the refusal naming the target's
project.** `374` `M8`, `M9` and `M14` own those readings inside `admitMessaging`; `375` added an act
to the table above them and changed none of them.

⛔ **No row on the DEFAULT.** `can_interrupt` defaults to `same-project` and `341` `M35` is the row
that keeps a corrupt value falling to the narrowest rather than to it. §0 of the suite measures the
default because HO-016 §1 asked; a mutation moving it would be a mutation on `374`'s descriptor.

⛔ **No row on `can_end`.** There is no such field, and HO-016 gave the reason — *"an option with no
acceptance case is a maintenance surface, not a capability."*
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
SCHEMA = "apps/desktop/src/shared/capabilities.ts"

# ⚠️ **The floor is anchored WITH the line above it**, because `assertMayReach` is called at five
# sites and an anchor that matches more than one proves nothing about which door it hit.
# ⚠️ **RE-ANCHORED at 692, not retired** — `FLOOR` now reads the lines 692 left there; every row that uses it plants the same defect as before.
FLOOR = (
    "    if (target === undefined || target === null || !mayCommand(target, by)) return 'no-such-agent'\n    this.assertMayReach('end', sessionId, by)"
)

MUTATIONS = [
    # ── the floor itself ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The defect is now D-014's decision. The
        # commit says 'End and interrupt reach the chain below the caller, with no grant and no
        # project floor'. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 there is no floor · `end_agent` goes through `mayCommand` alone again, so an "
        "identity a person refused interruption from destroys the conversation instead of cutting "
        "into it — HO-016 §1's ticket, put back",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks `end_agent`'s entitlement of `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
            (
                HOST,
                FLOOR,
                "    if (target === undefined || target === null || !mayCommand(target, by)) return 'no-such-agent'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted `end: 'canInterrupt'`
        # from REACH_OF, along with the whole `end` act of the messaging table. The commit says 'End
        # and interrupt reach the chain below the caller, with no grant', so the floor reads no
        # column at all. Its anchor is left stale, so the census records it retired.
        "M2 · 🔴 the floor reads the WRONG column · ending becomes a consequence of `can_message`, "
        "so revoking messaging protects a child from destruction and revoking interruption protects "
        "nothing at all",
        [(RAILS, "  end: 'canInterrupt',", "  end: 'canMessage',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The floor whose order this row inverts
        # was removed by D-014 ('no grant and no project floor'). endAgent's surviving order —
        # existence and entitlement both answer 'no-such-agent', and only then is the state asked —
        # is planted by `496` `M4`, re-anchored by this landing onto the entitlement check. Its
        # anchor is left stale, so the census records it retired.
        "M3 · ⛔ the floor is asked BEFORE `mayCommand` · a caller the floor refuses learns which "
        "ids it commands from the SHAPE of the refusal, which is 341's entitlement-before-existence "
        "ruling reached from the other side",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks `end_agent`'s entitlement of `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
            (
                HOST,
                FLOOR,
                "    this.assertMayReach('end', sessionId, by)\n    if (target === undefined || target === null || !mayCommand(target, by)) return 'no-such-agent'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row makes the end floor conditional
        # on a busy child, and D-014 removed that floor ('End and interrupt reach the chain below
        # the caller, with no grant and no project floor'). No assertMayReach('end') line remains to
        # guard. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 the floor only applies to a BUSY child · a rail that reads state before acting, "
        "which HO-016 called racy by construction — and the idle child is destroyed by exactly the "
        "identity a person refused the verb to",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks `end_agent`'s entitlement of `target`; `slot` may now be undefined past it, hence `slot?.`. The DEFECT this row plants is unchanged.
            (
                HOST,
                FLOOR,
                "    if (target === undefined || target === null || !mayCommand(target, by)) return 'no-such-agent'\n    if (slot?.session?.handle.status() === 'working')\n      this.assertMayReach('end', sessionId, by)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row moves the end floor below the
        # teardown, and D-014 removed that floor ('with no grant and no project floor'). endAgent
        # now goes from the entitlement straight to admitEnd (the target's state) and close(), with
        # no assertMayReach call to misplace. Its anchor is left stale, so the census records it
        # retired.
        "M12 · ⛔ the floor is asked AFTER the teardown · the refusal is perfect, names its rail, "
        "carries its permanence — and the conversation it says is still there is already gone",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks `end_agent`'s entitlement of `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
            (
                HOST,
                FLOOR + "\n",
                "    if (target === undefined || target === null || !mayCommand(target, by)) return 'no-such-agent'\n",
            ),
            (
                HOST,
                "    await this.close(sessionId, THE_APP_ITSELF)\n    return 'ended'",
                "    await this.close(sessionId, THE_APP_ITSELF)\n"
                "    this.assertMayReach('end', sessionId, by)\n"
                "    return 'ended'",
            ),
        ],
    ),
    # ── one rail or two ───────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the rails `may-not-end`,
        # `end-outside-your-project`, `may-not-interrupt` and `interrupt-outside-your-project`, and
        # RAILS_OF's `end` entry with them (diff: `-  end: { none: 'may-not-end', away:
        # 'end-outside-your-project' },`). Its anchor is left stale, so the census records it
        # retired.
        "M5 · ⛔ ending refuses under INTERRUPTING's rail · one sentence for two acts, so a caller "
        "that asked to end a conversation is told it *was left alone* and a model matching on the "
        "rail cannot tell which verb a person revoked",
        [
            (
                RAILS,
                "  end: { none: 'may-not-end', away: 'end-outside-your-project' },",
                "  end: { none: 'may-not-interrupt', away: 'interrupt-outside-your-project' },",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the rail 'may-not-end'
        # and its permanence entry (diff: `-  'may-not-end': 'until-a-person-changes-it',`), because
        # no grant gates ending. Its anchor is left stale, so the census records it retired.
        "M6 · ⚠️ `may-not-end` is PERMANENT · the caller is told to change the call when the only "
        "thing that could ever change the answer is a person, so it stops asking and does the work "
        "itself with a child it should have handed back",
        [
            (
                RAILS,
                "  'may-not-end': 'until-a-person-changes-it',",
                "  'may-not-end': 'permanent',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the rail
        # 'end-outside-your-project' ('End and interrupt reach the chain below the caller, with no
        # grant and no project floor'), so the permanence entry the row flips no longer exists. Its
        # anchor is left stale, so the census records it retired.
        "M7 · ⚠️ a project miss on the end door is reported as something a person can fix · the "
        "caller goes and asks for a grant when the remedy was in its own hands: name an agent in "
        "its own project",
        [
            (
                RAILS,
                # 🔴 **486 REVERSED the rule this row encoded** (HO-031 §2.5) — `374` M12's
                # correction, one act over. ⛔ The same `can_interrupt` value decides this rail and
                # `may-not-end`, and both clear on the same person's edit, so
                # `until-a-person-changes-it` is the true word and `permanent` is the defect.
                "  'end-outside-your-project': 'until-a-person-changes-it',",
                "  'end-outside-your-project': 'permanent',",
            )
        ],
    ),
    # ── what the tool publishes ───────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** end_agent no longer catches
        # MessagingRefused because endAgent no longer throws one. Its anchor is left stale, so the
        # census records it retired.
        "M8 · ⛔ the tool does not classify the refusal · a rule reaches the model as transport "
        "`-32603`, which tells it the tool is broken rather than that a person narrowed a grant — "
        "307's finding, at the one door 374 did not have to open",
        [
            (
                TOOLS,
                "            if (error instanceof MessagingRefused) {\n"
                "              const carried = carryMessageRefusal(error.refusal)\n"
                "              return answer(carried, `refused (${error.refusal.rail}): ${error.refusal.reason}`)\n"
                "            }\n"
                "            throw error\n"
                "          }\n"
                "          if (outcome === 'no-such-agent') {",
                "            throw error\n"
                "          }\n"
                "          if (outcome === 'no-such-agent') {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The row plants a blanket `.catch(() =>
        # 'no-such-agent')` around `host.endAgent(...)`, and `endAgent` no longer exists on the host
        # or in agent-tools.ts — it went with `end_agent` ("end_agent and resume_agent are gone").
        # The surviving tool, `interrupt_agent`, deliberately has no catch around
        # `host.interruptAgent(...)` ("Every refusal arrives as a value, so there is no catch
        # (395)"), so the blanket-classification defect has no live call site to reattach to. Its
        # anchor is left stale, so the census records it retired.
        "M9 · ⛔ the tool classifies EVERY throw as a refusal · a provider handle that went away is "
        "reported to the model as policy a person can widen, so it waits for a grant that would not "
        "have helped and never says the conversation broke",
        [
            (
                TOOLS,
                # ⚑ **NARROWED in place by `395`, not retired** (142's rule) — `interrupt_agent`
                # classified the same throw through the same helper, so the span had to say WHICH
                # door.
                # ⚑ Landing D-014 · re-anchored in place, not retired — D-014 removed the catch and
                # its rethrow along with the grant check, and wrote the row's principle at the call
                # (*"No catch: a teardown that failed is not a policy answer"*). The row now folds
                # every rejected end into `no-such-agent` at the one line that awaits it. Its killer
                # is `a-refusal-you-can-see.test.ts` §3, written by the landing.
                "          const outcome = await host.endAgent(agent, by)\n",
                "          const outcome = await host.endAgent(agent, by).catch(() => 'no-such-agent' as const)\n",
            )
        ],
    ),
    # ── the disclosure ────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 removed the `canInterrupt` field
        # and its 'May interrupt or end' label from CAPABILITY_FIELDS. The commit says the
        # can_interrupt column is 'unread and unwritten', and the card says 'the grants sheet has
        # six rows'. The label is no longer drawn anywhere. Its anchor is left stale, so the census
        # records it retired.
        "M10 · 🔴 the control does not NAME the second verb · the surface says *May interrupt*, "
        "governs ending, and reads as a guarantee it is not — HO-016 §1's actual finding, which was "
        "about the sheet rather than about the rail",
        [(SCHEMA, "    label: 'May interrupt or end',", "    label: 'May interrupt',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The help text belonged to the deleted
        # `canInterrupt` field; INTERRUPTION_REACH_ADMITS no longer exists in src. The commit says
        # the can_interrupt column stays in the schema 'unread and unwritten', and no grant gates
        # interrupting or ending. Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ the help text drops the coverage · a person is left to infer from a field name "
        "that setting this to none also stops an agent destroying its own children, which is the "
        "half of the disclosure a label alone cannot carry",
        [
            (
                SCHEMA,
                # ⚑ **Corrected in place by `395`, not retired** (142's rule). ⛔ `395` removed the
                # last clause — *"Interrupting is not a tool any agent has yet; ending is."* — because
                # it named the inventory and stopped being true the moment `interrupt_agent` was
                # published. ⚠️ **The DEFECT this row puts back is unchanged**: the two clauses that
                # carry the COVERAGE are the ones dropped, and they are the ones `§8` pins by name.
                # ⚑ **Re-anchored a SECOND time, by `449`**, which broke the string across lines and
                # appended the vocabulary walk this help never had. ⛔ **The two clauses the defect
                # drops are still exactly the two `§8` pins by name** — *which it may end* and *this
                # identity can do neither* — and the replacement keeps the reach sentence so the row
                # measures the COVERAGE clauses alone rather than the whole help string.
                "      'Which conversations this identity may cut into while they are working — and, because ' +\n      'ending one destroys more than cutting into it does, which it may end. Set this to none ' +\n      `and this identity can do neither. ${reachSentence(INTERRUPTION_REACH_ADMITS)}`,",
                "      'Which conversations this identity may cut into while they are working. ' +\n      `${reachSentence(INTERRUPTION_REACH_ADMITS)}`,",
            )
        ],
    ),
]
