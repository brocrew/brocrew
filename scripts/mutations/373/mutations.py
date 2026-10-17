"""373 · A parent that survives a restart — each row is THE DEFECT, put back (131).

⛔ **What this dispatch changed is two lines and a store read**, and every row below is one of them
untold. `resumeSession` reserves the slot for a reopened conversation; before this it wrote
`commandedBy: null` and `spawnedBy: null` there, so a parent that had commissioned a conversation
could never speak to it again once the app had been closed. It now RE-DERIVES both from the
provenance triple `341` writes — `parent_session_id`, `spawned_at`, `spawn_reason`, one transaction —
and the identity it derives is `agentCallerId(parent)`, the exact string that parent's own toolset
presents.

⚑ **Nothing is persisted and nothing is restored.** `commandedBy` still dies with the process; a row
names a PARENT and records nothing about who commanded the child, so the rule is one sentence in both
directions: **the commander a resume derives is the parent, always.**

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M6` | ⚑ **`run_suite`** — `apps/desktop/test/a-parent-that-survives-a-restart.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `hasACommander`'s reopen arm.** It is `349` `M11`, whose anchor and label this
dispatch corrected in place: the line reads the slot and 373 is what made the slot's answer vary.
Writing a second row against the same line would be one rule spelled in two tables.

⛔ **No row widening `mayCommand`, `mayControl` or `mayAnswerAsAHuman`.** `340` owns all three and
this dispatch touched none of them — that is the safety property, and `§3` of the suite presses it
rather than a row asserting a rule 373 did not ship.

⛔ **No row on the `agentCallerId` census.** `§4` reads which FILES may mint the identity, and the
rows below all live inside one of those two files: a row that changed a call site's ARGUMENT would
turn that test red for a reason it does not claim, which is why the census was narrowed to the file
set before this table was written.

⛔ **No row on `spawnProvenance`'s all-three-or-none guard.** It is `341`'s line and `341`'s table;
this dispatch is its second reader, not its author.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

DERIVED_COMMANDER = (
    "            commandedBy: provenance === null ? null : agentCallerId(provenance.parentSessionId),"
)
DERIVED_PARENT = "            spawnedBy: provenance?.parentSessionId ?? null,"

MUTATIONS = [
    # ── the derivation itself ──────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 the derivation is gone and a reopen is commanded by nobody again · the whole "
        "dispatch undone — a PM that comes back after a restart can see its own workers and speak "
        "to none of them, with the provenance row still sitting there naming it as their parent",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reopened child is commanded by its parent, derived from the ledger
        # (`store.parentOf`) at reservation in `resumeSession`. The `provenance` read is now
        # `parent`, and the anchor is the reserve line in `resumeSession` (14-space indent, unique;
        # `aStoppedConversation` has the same text at another indent). The plant makes a reopen
        # commanded by nobody again. Killed by `a-parent-that-survives-a-restart.test.ts`.
        [
            (HOST, '              commandedBy: parent === null ? null : agentCallerId(parent),\n', '              commandedBy: null,\n'),
        ],
    ),
    (
        "M2 · ⛔ the live half is left null while the entitlement is derived · a restart becomes the "
        "way to reset a concurrency bound: reopen the three children a parent already had, and it "
        "may spawn its whole allowance a second time",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the live `spawnedBy` half is set from the ledger at reservation (`spawnedBy:
        # parent`) and the card shows it after a reopen. The `liveChildrenOf` concurrency bound in
        # the label is gone with `max_concurrent`, so the visible consequence now is the card's
        # `spawnedBy` (and `helperAs`' slot lookup). The plant leaves the half null while the
        # commander is derived. Killed by `a-parent-that-survives-a-restart.test.ts`.
        [
            (HOST, '              spawnedBy: parent,\n', '              spawnedBy: null,\n'),
        ],
    ),
    # ── the identity it derives ────────────────────────────────────────────────────────────────
    (
        "M3 · 🔴 the CHILD is named instead of the parent · a conversation would come back "
        "commanding itself, which is the capability `347` refused to put inside `mayCommand` — a "
        "session that could give ITSELF a turn is a loop nobody bounded",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the derived commander is the PARENT's `agent:<parent>`, and a session that could
        # command itself is the loop `347` refused. The anchor is the same unique `resumeSession`
        # reserve line. The plant names the child (`sessionId`) in the parent's place. Killed by
        # `a-parent-that-survives-a-restart.test.ts`.
        [
            (HOST, '              commandedBy: parent === null ? null : agentCallerId(parent),\n', '              commandedBy: parent === null ? null : agentCallerId(sessionId),\n'),
        ],
    ),
    (
        "M4 · ⛔ the namespace is dropped and the bare session id is stored · `347`'s two namespaces "
        "stop being disjoint, so anything able to spell a session id is that session — the forgery "
        "`agentCallerId` exists to make impossible",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `agentCallerId` keeps the agent namespace disjoint from bare session ids, and §2
        # asserts that `{ ownerId: pm }` is refused. Only the variable changed
        # (`provenance.parentSessionId` became `parent`). The plant stores the bare parent session
        # id. Killed by `a-parent-that-survives-a-restart.test.ts`.
        [
            (HOST, '              commandedBy: parent === null ? null : agentCallerId(parent),\n', '              commandedBy: parent === null ? null : parent,\n'),
        ],
    ),
    # ── who it is derived FOR ──────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ a conversation nobody spawned comes back commanded by the window that reopened it · "
        "the derivation applied where there is no parent — a person's own work would disclose that "
        "somebody else can send into it, which is criterion 9 in the direction that teaches a "
        "reader to ignore the pill",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a conversation nobody spawned comes back commanded by nobody. §2 '⛔ a
        # conversation nobody spawned comes back commanded by nobody, and discloses it' and §7
        # assert it. `sink` is now nullable, so the plant reads `sink?.ownerId ?? null`, the
        # reopening window, where the parent is absent. Killed by
        # `a-parent-that-survives-a-restart.test.ts`.
        [
            (HOST, '              commandedBy: parent === null ? null : agentCallerId(parent),\n', '              commandedBy: parent === null ? (sink?.ownerId ?? null) : agentCallerId(parent),\n'),
        ],
    ),
    (
        "M6 · ⛔ the reopened child is recorded as its own parent · `liveChildrenOf` then counts "
        "nothing for the conversation that actually asked for it, so the bound is silently zero for "
        "every parent whose children were reopened — the same hole as `M2` reached by a wrong "
        "answer rather than by no answer",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the reopened child's live `spawnedBy` must name its parent, and the card asserts
        # `spawnedBy: pm` after a reopen. The `liveChildrenOf` bound in the label is gone, but the
        # wrong-answer half of the defect still shows on the card. The plant records the child as
        # its own parent. Killed by `a-parent-that-survives-a-restart.test.ts`.
        [
            (HOST, '              spawnedBy: parent,\n', '              spawnedBy: parent === null ? null : sessionId,\n'),
        ],
    ),
]
