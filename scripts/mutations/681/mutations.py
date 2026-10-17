"""681 · a starting child is already in its project — PM ruling R30.

⛔ **Ordered by `657` F-a and `650` F1.** A parent could not end its own child while that child was
still starting: the boundary read the TARGET's project off its committed `agent_profile` row, and a
reservation has none until `store.create` runs at registration — so the ruled `same-project` reach
refused `end-outside-your-project`, permanently. And `message_agent` answered
`that-conversation-has-not-started` ahead of the walls a running target would be refused by, so a
caller narrowed only on giving work was told to retry and then met `may-not-assign-work`.

## ⚑ What a row here measures

 * ⚑ **M1, M11 are the reservation carrying the project (R30a)** — the bag's field, and the launch
   reading the reservation's own local rather than a value of its own.
 * ⚑ **M2 is the reader's order** — the row first, the reservation only while the slot starts. ⚠️ Since
   the second bound, a reader that skipped the row places no REGISTERED conversation at all, so every
   arm with a running target kills it; §6, a REOPENED child whose reservation carries no project, is
   the arm that kills it for the reason the row comes first. ⚑ **M13 is the other bound** — the
   reservation answers only while the slot STARTS — killed only by a child whose row failed to
   write (§7).
 * ⚑ **M3–M7 are each wall that reads a TARGET** — the boundary (`end`, `interrupt`, `message`), the
   assignment, the receiver's breadth, the card and the `profile-already-live` key — each put back on
   the row alone.
 * ⚑ **M8–M10 are R30b** — the walls before *not started* at `message_agent`, the gate that asks
   them, and the wake door. ⚑ **M12 is R30b one wall EARLIER** — `interrupt_agent`'s chain-walk
   entitlement, which read a starting grandchild's missing provenance rows as *nobody's*.

## ⛔ What this table cannot reach

 * ⚠️ **A reopen's reservation carries no project** (`projectSlug: null`) and has no row: its own
   binding row answers first, from the first instant, so no mutation of that value can be observed.
 * ⚠️ **The whole-or-nothing clause of `targetAsItWillRun`** — a slot with an identity and no place —
   has no path to it that `681`'s sweep found; the conservative reading is stated, not measured.
 * ⚠️ **`459 M2`** (the fail-open arm of the `profile-already-live` key) is not this table's, and its
   killer moved: a starting blocker is placed now, so what it measures is the REQUESTER's null — a
   parent in no project — which `a-starting-child-is-already-in-its-project.test.ts` §4 plants.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

KILLER = "a-starting-child-is-already-in-its-project.test.ts"

# ⚑ `message_agent`'s gate run, as R30b ordered it — the walls asked INSIDE the entitlement's gate.
# ⚠️ **732 · RE-ANCHORED, the subject unchanged**: the run gained a starting receiver's open-work
# read (`681` F-a) before its close, and M8's reversal takes that with it — asked after *not started*,
# it is never reached, which is the reversal's own consequence.
THE_WALLS_FIRST = (
    "    let takesWorkFrom!: CallerBreadth\n"
    "    const session = this.requireToMessage(sessionId, by, (receiver) => {\n"
    "      this.assertMayReach('message', sessionId, by)\n"
    "      takesWorkFrom = this.howManyCallersItTakesWorkFrom(receiver.id)\n"
    "      this.assertMayAssign(sessionId, by, says, takesWorkFrom)\n"
    "      if (stillStarting(receiver)) {\n"
    "        this.refuseWorkAStartingReceiverHolds(receiver.id, by, says, takesWorkFrom)\n"
    "      }\n"
    "    })\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** R30a's subject is gone: the commit
        # says 'the project rooms, board, sheet and picker, project folders and their rails,
        # same-project reach and the project argument on spawn_agent and list_agents are removed',
        # and the killer's header now reads 'D-016 - projects are gone, and with them R30a's
        # subject: a reservation carries no project because nothing places a conversation in one'.
        # `SessionSlot.projectSlug` and the reservation's `projectSlug` no longer exist, so the
        # plant has no anchor. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 THE DEFECT, restored at the reservation · a create reserves NO project, so a starting "
        "child is somewhere unknown and the parent's own `end_agent` meets `end-outside-your-project` · "
        f"killed by `{KILLER}`",
        [(HOST, "          // (R30a). See {@link SessionSlot.projectSlug}.\n          projectSlug,\n",
          "          // (R30a). See {@link SessionSlot.projectSlug}.\n          projectSlug: null,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The reader that skipped the row in
        # favour of the reservation (`targetAsItWillRun`) is deleted with R30a, whose subject was
        # where a starting child is placed. The commit removes 'same-project reach and the project
        # argument on spawn_agent and list_agents', and the killer header says 'projects are gone,
        # and with them R30a's subject'. Its anchor is left stale, so the census records it retired.
        "M2 · ⚠️ the reader skips the ROW · every target is answered from its reservation alone, so "
        "every REGISTERED conversation (the reservation answers only while it starts), a reopened one "
        "(which reserves no project because its row names one) and every one not open in this "
        "process read as placed nowhere · killed by "
        "`a-starting-child-is-already-in-its-project.test.ts`",
        [(HOST, "    if (row !== null) return row\n    const slot = this.slots.get(sessionId)\n",
          "    const slot = this.slots.get(sessionId)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The boundary this plant made read the
        # row alone (`end-outside-your-project`, fed by `targetAsItWillRun`) is gone: `end_agent`
        # and the project boundary were removed, and the commit removes 'same-project reach'. The
        # killer's header says 'D-016 - projects are gone, and with them R30a's subject'. Its anchor
        # is left stale, so the census records it retired.
        "M3 · 🔴 the BOUNDARY reads the row alone again · `657` F-a: a parent's `end_agent` on its own "
        "starting child is refused `end-outside-your-project`, and `interrupt_agent` meets the "
        f"boundary where it would have said not started · killed by `{KILLER}`",
        [(HOST, "      // 🔴 **681 · the TARGET as it will run** (R30a) — a starting child is in its project already.\n"
                "      this.targetAsItWillRun(sessionId),",
          "      // 🔴 **681 · the TARGET as it will run** (R30a) — a starting child is in its project already.\n"
          "      this.deps.store.identityOf(sessionId),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The assignment wall that reads the
        # receiver's project (`assign-work-outside-your-project`) no longer exists;
        # `assertMayAssign` now asks `mayCommand` and no project. The commit removes 'same-project
        # reach', and the killer header says 'D-016 - projects are gone, and with them R30a's
        # subject'. Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ the ASSIGNMENT wall reads the row alone · with the walls asked before *not started*, a "
        "same-project parent giving work to its own starting child is refused "
        f"`assign-work-outside-your-project` — permanently, where it should be told to retry · killed by `{KILLER}`",
        [(HOST, "      // 🔴 **681 · the receiver as it will run** (R30a) — see {@link targetAsItWillRun}.\n"
                "      this.targetAsItWillRun(sessionId),",
          "      // 🔴 **681 · the receiver as it will run** (R30a) — see {@link targetAsItWillRun}.\n"
          "      this.deps.store.identityOf(sessionId),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `howManyCallersItTakesWorkFrom` and
        # the `breadth` it returned were deleted by D-016 (the commit: 'takes_work_from (the
        # one-open-task rail now refuses on any open task)'). There is no receiver breadth left to
        # read off the row or the reservation. Its anchor is left stale, so the census records it
        # retired.
        "M5 · ⚠️ the receiver's BREADTH reads the row alone · a starting receiver that takes work from "
        "anybody reads as `'one-caller'`, so a caller with no relationship is refused permanently where "
        f"its running self admits it · killed by `{KILLER}`",
        [(HOST, "    const identity = this.targetAsItWillRun(sessionId)\n    const allowed",
          "    const identity = this.deps.store.identityOf(sessionId)\n    const allowed")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The card no longer names a project,
        # and `list_agents(project)` and `list_projects` are removed (commit: 'create_project and
        # list_projects ... the project argument on spawn_agent and list_agents are removed').
        # `targetAsItWillRun(slot.id)` is not in the card builder any more, so the plant has no
        # anchor. Its anchor is left stale, so the census records it retired.
        "M6 · ⛔ the CARD reads the row alone · a starting child's card names no project, so "
        "`list_agents(project)` drops it and `list_projects` counts it nowhere · killed by "
        f"`{KILLER}`",
        [(HOST, "    const identity = this.targetAsItWillRun(slot.id)\n",
          "    const identity = this.deps.store.identityOf(slot.id)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `profile-already-live` key read
        # the project of a starting slot (`?.projectSlug`); with `SessionSlot.projectSlug` and the
        # reservation's project gone, one identity cannot be placed into two projects and the cost
        # R459 named is not restorable. The killer header says 'D-016 - projects are gone, and with
        # them R30a's subject'. Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 the `profile-already-live` key reads the row alone · `459`'s cost restored: one parent "
        f"placing one identity into two projects in one tick is refused the second · killed by `{KILLER}`",
        [(HOST, "          const its = this.targetAsItWillRun(slot.id)?.projectSlug ?? null",
          "          const its = this.deps.store.identityOf(slot.id)?.projectSlug ?? null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The order this plant reversed (walls
        # before *has it started*) is no longer a refusal to reverse: D-017 R1 made 'still starting'
        # never a refusal for a caller the start serves, and D-016 removed `takesWorkFrom` from
        # `queueAs`'s gate. R30b's order is now held by 692 M14/M15/M17 and 1017 M141, and the
        # killer's starting-child case goes through `refuseBeforeAStart`, where the walls answer
        # first. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 R30b reversed · `message_agent` asks *has it started* BEFORE its walls, so `650` F1's "
        "narrowed caller is told to retry and then meets `may-not-assign-work` when the launch lands · "
        f"killed by `{KILLER}`",
        # ⚑ Landing D-014 · re-anchored in place, not retired — R30b survives: walls answer before
        # 'not started'. Re-verified RED alone.
        [
            (HOST, "    let takesWorkFrom!: CallerBreadth\n    const session = this.requireToMessage(sessionId, by, (receiver) => {\n      this.assertMayReach('message', sessionId, by)\n      takesWorkFrom = this.howManyCallersItTakesWorkFrom(receiver.id)\n      this.assertMayAssign(sessionId, by, says)\n      if (stillStarting(receiver)) {\n        this.refuseWorkAStartingReceiverHolds(receiver.id, by, says, takesWorkFrom)\n      }\n    })\n", "    const session = this.requireToMessage(sessionId, by)\n    this.assertMayReach('message', sessionId, by)\n    const takesWorkFrom = this.howManyCallersItTakesWorkFrom(session.id)\n    this.assertMayAssign(sessionId, by, says)\n"),
        ],
    ),
    (
        "M9 · ⛔ the gate stops asking the walls it is handed · `message_agent` meets no boundary and no "
        f"assignment wall at all, starting or running · killed by `{KILLER}`",
        [(HOST, "      this.assertMayMessage(slot, by)\n      walls(slot)\n",
          "      this.assertMayMessage(slot, by)\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The exact anchored line —
        # `whyThisCallerMayNotWakeIt`'s `return this.aReachRefusal(sessionId, by) ??
        # said('that-conversation-has-not-started')` inside `wakeSession` — is deleted wholesale
        # with the wake fold and `resume_agent`. The rule it also happened to express (boundary
        # before 'not started') is independently and already enforced by `message_agent`'s own
        # pre-existing gate: `host.whyItIsOutOfReach(agent, by, me)` is asked first,
        # unconditionally, before any running/starting/stopped branching — confirmed still green and
        # still exercised for a starting child in
        # `a-starting-child-is-already-in-its-project.test.ts` §3b, a check this commit did not
        # touch and that was never this row's subject. Its anchor is left stale, so the census
        # records it retired.
        "M10 · ⚠️ the WAKE door says *not started* ahead of the boundary · a `same-project` parent is told "
        f"to retry `resume_agent` on a starting child in another project · killed by `{KILLER}`",
        [(HOST, "        return this.aReachRefusal(sessionId, by) ?? said('that-conversation-has-not-started')",
          "        return said('that-conversation-has-not-started')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The launch no longer passes a reserved
        # `projectSlug` to `startSession` (`startSession(slot, input, sink, spawn, projectSlug)`
        # lost the argument), so a spawn cannot reserve one project and land in another. R30a's
        # subject is removed, per the killer header 'D-016 - projects are gone, and with them R30a's
        # subject'. Its anchor is left stale, so the census records it retired.
        "M11 · ⛔ the launch stops reading the reservation's own local · a spawn into `beta` reserves "
        "`beta` and lands in the pinned project, so the claim a starting slot made and the row it "
        f"registers under disagree · killed by `{KILLER}`",
        [(HOST, "      return await this.startSession(slot, input, sink ?? NO_SURFACE, spawn, projectSlug)",
          "      return await this.startSession(slot, input, sink ?? NO_SURFACE, spawn, DEFAULT_PROJECT_ID)")],
    ),
    (
        "M12 · 🔴 the chain walk stops at the ledger · a grandparent's `interrupt_agent` on a grandchild "
        "still starting is refused `no-such-agent`, permanently, where its running self is reached · "
        f"killed by `{KILLER}`",
        [(HOST, "    if (parent === null) return recorded\n    return [parent, ...this.ancestorsAsItWillRun(parent)]",
          "    return recorded")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The reservation answering after
        # registration was a question of which project a running child is named in, and
        # `workBeingAssigned` refusing 'not attributed to any project'. Both are gone with the
        # projects (commit: 'project folders and their rails, same-project reach ... removed'), and
        # `targetAsItWillRun` with its `slot.session !== null` guard no longer exists. Its anchor is
        # left stale, so the census records it retired.
        "M13 · ⚠️ the reservation answers AFTER registration too · a running child whose row `record` "
        "failed to write is named in its reservation's project by its card — while `workBeingAssigned`, "
        "which writes against the row, refuses work as *not attributed to any project* · killed by "
        f"`{KILLER}`",
        [(HOST, "    if (slot === undefined || slot.session !== null) return null\n",
          "    if (slot === undefined) return null\n")],
    ),
]
