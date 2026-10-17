"""644 · Two sentences that name no door.

⛔ **Backlog `D29`, dispatched from `642`'s F2 and F3.** Two person-visible strings that answered
correctly and left a caller with nothing to do next — and the dispatch's own §3.2 asked for a row
per string, each verified RED by hand.

## 🔴 A · what the dispatch CHANGED

⚑ **`list_agents`' EMPTY answer became TWO answers**, because the empty branch is two branches.
⛔ **Measured here rather than assumed**: `withinMessagingReach` answers `true` for
`slot.id === me` before it asks any grant, so an UNFILTERED listing always names at least the
caller — it is empty only once the caller's own slot has left the map. ⚠️ **The branch a running
caller can empty is the FILTERED one**, and there the four words that shipped were not
under-reporting but wrong: the caller can see several, just none in the project it named. 🔴 So one
pointer could not have been right for both arms, which is what the dispatch's §1.3 asked about —
*if the pointer can be wrong for some callers, either condition it or word it so it is never a
promise.*

⚑ **`TOOL_SENTENCES['no-such-agent']` gained the performable act `628` says a `permanent` refusal
owes**, and lost a clause that was FALSE rather than merely unactionable: *"An agent you spawned is
one you may reach"*, said about a child this very caller spawned and ended.

## ⛔ B · what has NO row, said rather than left out

🔴 **No row on the `remedy` field.** ⚠️ The dispatch's §4.2 forbids touching `TOOL_REMEDY` and the
permanence table, and `644` did not: `two-sentences-that-name-no-door.test.ts` §2.2 asserts
`permanent`, `retryable: false` and `remedy: null` are still what a caller gets, so a change there
is already red without a row of this table's own.

🔴 **No row on `factory-text.ts`'s degradation table.** ⛔ Its row quotes the words both arms still
open with, so the quotation is now a PREFIX of a longer answer and its claim — that discovery meets
no rail — is untouched. ⚠️ **It was left alone on instruction** (§4.4), and
`the-sentence-a-withdrawn-ruling-left-behind.test.ts` §4 is the census that holds it.

## ⚠️ C · the control this table repaired rather than retired

⛔ **`the-sentence-a-withdrawn-ruling-left-behind.test.ts`'s source control pinned the empty answer
as a whole quoted literal**, and the reword took the closing quote off it. ⚑ **Corrected in place
to the OPENING quote**, which is still a rename detector for the five words the degradation table
credits, and proven necessary: the pre-`644` form was run against the post-`644` source and went
red on exactly that line, with the other 22 assertions in the file green
(`correct-a-stale-mutation-anchor-dont-retire-it`).
"""

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

THE_ROSTER_POINTER = (
    "                ? 'no agents you can see — list_profiles names the ones you may start'"
)

THE_WIDENING_POINTER = (
    "                : 'no agents you can see in that project — the same call with no project "
    "names every one you can see'"
)

WHICH_ARM = (
    '                // could not have been right for both ways of reaching it"*.\n'
    "                wanted === null"
)

THE_REFUSAL = (
    "    'there is no agent by that name that you may reach, so nothing was done to it. "
    "list_agents names the ones you can reach; list_profiles names the ones you may start.',"
)

THE_REFUSAL_BEFORE_644 = (
    "    'there is no agent by that name that you may reach, so nothing was done to it. "
    "An agent you spawned is one you may reach.',"
)

# ⚠️ **RE-ANCHORED at 692, not retired** — `THE_CALLER_SEES_ITSELF` now reads the lines 692 left there; every row that uses it plants the same defect as before.
THE_CALLER_SEES_ITSELF = '    if (target.id === me) return true'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the empty listing, one arm at a time ───────────────────────────────────────────────
    (
        "M1 · 🔴 **the empty listing names no door again** · the UNFILTERED arm goes back to the "
        "four words that shipped until `644`. ⛔ **This is the exact branch `factory-text.ts`'s "
        "degradation table credits as the quiet one** — a successful answer carrying nothing, "
        "which is `an-unenumerated-state-counts-as-success` wearing an `ok`. ⚠️ **What a person "
        "sees**: BroBot is told *no agents you can see*, has no reason to believe the population "
        "it wanted is answered by a different door, and reports that there is nobody to talk to",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — D-016a removed the
        # filtered arm but kept the unfiltered empty answer, which still names list_profiles as the
        # door. The old anchor moved because the ternary '?' is now a comment line above the string;
        # plant the four-word answer on the string alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the sentence for an empty list_agents names the door (list_profiles) rather than
        # only stating there is nobody. The 'no agents you can see' sentence still carries the
        # list_profiles clause in agent-tools.ts. The plant drops the clause. Killed by
        # `two-sentences-that-name-no-door.test.ts`.
        [
            (TOOLS, "'no agents you can see — list_profiles names every agent this app holds'", "'no agents you can see'"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The mutated arm was the FILTERED empty
        # answer ('no agents you can see in that project — the same call with no project names every
        # one you can'), which existed only for list_agents' project argument. bd70d693: "the
        # project argument on spawn_agent and list_agents are removed"; the test file says "there
        # were two arms; the filtered one went with list_agents' project argument". Its anchor is
        # left stale, so the census records it retired.
        "M2 · ⛔ **a caller that named a project is told it can see nothing at all** · the FILTERED "
        "arm answers the unfiltered sentence, which is the defect `644` found while deriving the "
        "branch rather than the one it was sent for. ⚑ **It is not under-reporting, it is wrong**: "
        "the caller can see several agents and is told it can see none, with no word about the "
        "argument that narrowed the answer. 🔴 A model that believed it would stop asking rather "
        "than widen",
        [(TOOLS, THE_WIDENING_POINTER, "                : 'no agents you can see'")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The swapped arms were selected by the
        # `wanted` project filter, which no longer exists (0 hits in agent-tools.ts) because D-016a
        # removed list_agents' project argument ("the project argument on spawn_agent and
        # list_agents are removed"). With one arm left there is nothing to swap. Its anchor is left
        # stale, so the census records it retired.
        "M3 · ⚠️ **the two arms are swapped** · the caller that named a project is handed the "
        "roster pointer, and the caller that named none is told to drop a project it never sent. "
        "⛔ **The row exists because a conditioned sentence has a SECOND way to be wrong**: each "
        "arm can be right and still be attached to the other branch, and a `toContain` on one "
        "answer alone would pass through the swap. ⚑ `a-comparison-tested-where-both-sides-agree` "
        "is what it is written against — §1.1 and §1.2 assert the two arms in the same file, and "
        "each asserts the OTHER arm's clause is absent",
        [
            (
                TOOLS,
                WHICH_ARM,
                '                // could not have been right for both ways of reaching it"*.\n'
                "                wanted !== null",
            )
        ],
    ),
    # ── B · the refusal that named no door ─────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Its premise — a spawned child whose
        # conversation has ENDED being refused no-such-agent — is gone by construction: nothing ends
        # a conversation any more (end_agent removed), and D-017 redefined no-such-agent to mean
        # only 'no conversation has that id'. The live sentence was rewritten entirely ('no
        # conversation has that id...'), and `two-sentences-that-name-no-door.test.ts` §2.1 now
        # explicitly asserts `THE_CLAIM_THAT_WAS_FALSE` ('An agent you spawned is one you may
        # reach') stays absent — the false-claim scenario this row reverts to can no longer arise on
        # the tested path. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 **the refusal goes back to the sentence that was false about its own subject** · "
        "both doors leave and *An agent you spawned is one you may reach* returns. ⛔ **`642` F3 "
        "read it as unactionable and it is worse than that**: a spawned child whose conversation "
        "has ENDED is refused by every door that takes an id from `list_agents`, so the clause is refuted by the "
        "commonest path to this rail — which §2.1 walks, with the parent doing the spawning and "
        "the ending. ⚠️ **`628`'s invariant is what the row protects**: a `permanent` refusal "
        "carries no `remedy`, so a sentence with no act in it leaves a caller nothing at all",
        # ⚑ Landing D-014 · re-anchored in place, not retired — TOOL_SENTENCES['no-such-agent']
        # survives with both doors. D-014 changed one word in it ('the ones you can reach' became
        # 'the ones you can see'), which staled the table's THE_REFUSAL constant. Re-verified RED
        # alone.
        [
            (TOOLS, "    'there is no agent by that name that you may reach, so nothing was done to it. list_agents names the ones you can see; list_profiles names the ones you may start.',", "    'there is no agent by that name that you may reach, so nothing was done to it. An agent you spawned is one you may reach.',"),
        ],
    ),
    (
        "M5 · ⛔ **half the act survives** · the sentence still says where working ids come from "
        "and no longer says where an identity could be STARTED. ⚑ **The two clauses answer two "
        "populations** — conversations this app is running, and identities that outlive them — "
        "and `HO-068` §2.2 already ruled that the second is `list_profiles`' to answer. 🔴 A row "
        "on the pair alone would have passed on this, which is why it is separate from `M4`: a "
        "caller whose listing is empty gets a door that names nothing and stops",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The rule survives: the
        # no-such-agent sentence must still name BOTH populations — where reachable ids come from
        # (list_agents) and where an identity could be started (list_profiles) — just reworded for
        # D-017's redefinition. The live sentence still carries both clauses, and dropping the
        # list_profiles clause reproduces 'half the act survives' exactly.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the sentence a refused message_agent gives names list_profiles as the door for
        # an agent the caller cannot reach. That clause is still in the tool sentence that ends
        # 'list_agents names the ones you can reach'. The plant drops the list_profiles half. Killed
        # by `two-sentences-that-name-no-door.test.ts`.
        [
            (TOOLS, "list_agents names the ones you can reach; list_profiles names every agent this app holds.',", "list_agents names the ones you can reach.',"),
        ],
    ),
    # ── C · the premise §1.2's negative rests on ───────────────────────────────────────────────
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 reads the self arm off `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
    (
        "M6 · ⚠️ **a caller stops being able to see its own conversation** · the self arm of "
        "`withinMessagingReach` answers `false` and the listing is folded through the grant alone. "
        "⛔ **This is the premise §1.2's negative rests on, and without a row it is a claim rather "
        "than a measurement**: the unfiltered empty branch is unreachable *because* this line "
        "answers before any grant is read, so a world where it does not is a world where the "
        "sentence `644` wrote for the caller-has-ended window is the ordinary answer. ⚑ It is one "
        "line of the three `642 M3` quotes and a different mutation on them — that row admits an "
        "id the map no longer holds; this one drops an id the map does hold",
        [(HOST, THE_CALLER_SEES_ITSELF, '    if (target.id === me) return false')],
    ),
]
