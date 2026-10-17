"""629 · A stop reaches down the whole chain.

⛔ **Ordered by `HO-095` §4, which is a RULING and not a finding:** *any agent above another in
the spawn chain may interrupt it.*

## 🔴 What it cost not to have it, measured on the clean-install run

⚠️ **Ali was driving the person's browser and the person asked BroBot to stop it.** ⚑ BroBot answered
CORRECTLY under the old rules — only a direct commander may interrupt — so it went through Ada,
who happened to be idle. 🔴 **Had Ada been mid-turn the stop would have queued behind her while
Ali kept going.** ⛔ A stop was only as fast as the busiest manager between the person and the
agent, and the thing being stopped was a browser on somebody's own machine.

## The row groups

 * `M1`-`M2`  🔴 **the reach** — the widening goes, or the walk stops one hop short, which is
               `an-exception-made-at-one-depth-of-a-walk` put back.
 * `M3`-`M4`  ⛔ **the walk's own bounds** — a conversation becomes its own ancestor, and the
               cycle half that no acyclic ledger can kill.
 * `M5`-`M6`  ⛔ **the scope** — ending gets the widening it was refused, and the capability
               FLOOR is skipped for the callers the ruling newly admits.
 * `M7`-`M9`  ⚠️ **the sentences, BOTH audiences** — the refusal, the tool description and the
               capability sheet each state a narrowing this app stopped enforcing.

## ⛔ `M4` is expected to survive, and the pair it belongs to is why

⚑ **The walk excludes its seed TWICE** — `depth > 0` and `id <> ?` — and on an acyclic chain
either alone suffices, so each is individually unkillable and `M3` removes both. ⚠️ **`id <> ?`
is the CYCLE half**: it exists for a ledger the rails cannot make — a hand-edited database, a
restored bundle, a repair that pointed a row at its own descendant — and no fixture in four
vitest projects can build one through a door. ⛔ Recorded as an expected survivor rather than
dropped, because a table that only carries rows it can kill has stopped measuring its own edges.

## ⚠️ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row reaches the run.** Every row here is killed by a unit assertion over a real
   three-tier chain built through the real `spawn_agent` door; what that proves is what the DOORS
   admit, not that a browser stopped.
 * ⚠️ **No row moves the ruled default of `can_interrupt`.** `M6` skips the floor and `M9` lies
   about it; neither widens it, because the default is a person's to set (`HO-016` §1) and
   `a-stop-reaches-down-the-whole-chain.test.ts` §3 measures what it refuses rather than changing
   it.
 * ⚠️ **No row on `mayCommand` itself.** Its sixteen questions are enumerated and counted by
   `a-reach-you-can-see.test.ts` §3, which `629` left green — that census is the evidence the
   other fifteen did not move, and a row here would be a second reading of it.

## ⚑ WRITTEN, not run

⛔ **Standing memory: writing rows is routine, RUNNING a table is rare and deliberate.** No
`mutations.txt` exists at this HEAD and its absence is the honest state.
"""

from __future__ import annotations

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
SHEET = "apps/desktop/src/shared/capabilities.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the reach ─────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **THE RULING GOES · only a direct commander may interrupt** · the entitlement is "
        "`mayCommand` alone again, so BroBot cannot stop Ali and the stop has to travel through "
        "Ada — ⛔ **as fast as the busiest manager between the person and the agent**, which is "
        "`HO-095` §4's whole subject and a SAFETY defect rather than a convenience one: the thing "
        "being stopped was a browser on the person's own machine",
            # ⚑ **RE-ANCHORED at `681`, not retired** — the chain is read through
            # `ancestorsAsItWillRun`, which falls back to a starting conversation's reservation
            # (PM ruling R30b), and the shorter call let the formatter put the clause on one line.
            # ⛔ The DEFECT this row plants is unchanged: `mayCommand` alone. Re-applied and re-run
            # individually after the correction.
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks the interrupt entitlement of `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — HO-095 §4's ruling (any
        # agent above another in the spawn chain may interrupt it) is untouched by D-017;
        # `interruptAgent` was restructured around
        # `no-such-agent`/`theOneInItsPlace`/`commandedNow`, but the entitlement is still exactly
        # `mayCommand(...) || mayInterruptDownTheChain(...)`. Dropping the second disjunct
        # reproduces 'only a direct commander may interrupt' verbatim.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — HO-095 section 4 (any agent above another in the spawn chain may
        # interrupt it) still holds; D-016c commit 7 extracted the entitlement into the private
        # method mayInterrupt, which now returns the two predicates directly instead of assigning a
        # local. The plant drops the mayInterruptDownTheChain disjunct, so only a direct commander
        # may interrupt again. Killed by `a-stop-reaches-down-the-whole-chain.test.ts`.
        [
            (HOST, '    return (\n      (target !== undefined && target !== null && mayCommand(this.commandedNow(target), by)) ||\n      mayInterruptDownTheChain(\n        by,\n        this.ancestorsAsItWillRun(sessionId).map((above) => this.theOneInItsPlace(above)),\n      )\n    )\n', '    return target !== undefined && target !== null && mayCommand(this.commandedNow(target), by)\n'),
        ],
    ),
    (
        "M2 · 🔴 **the walk stops at the DIRECT parent** · the reach widens by exactly nothing, "
        "because a direct parent already commanded its child — ⛔ `an-exception-made-at-one-depth-"
        "of-a-walk` put back as a one-character edit, and the shape `HO-095` §4 exists to remove: "
        "a rule made at one of two depths is a rule nobody can rely on. ⚠️ **Every assertion about "
        "the direct case still passes**, which is what makes depth ≥ 2 the only arm that can see it",
        [
            (
                STORE,
                "         SELECT id FROM ancestry WHERE depth > 0 AND id <> ? ORDER BY depth`,",
                "         SELECT id FROM ancestry WHERE depth = 1 AND id <> ? ORDER BY depth`,",
            )
        ],
    ),
    # ── B · the walk's own bounds ─────────────────────────────────────────────────────────────
    (
        "M3 · ⛔ **a conversation becomes its own ancestor** · the seed row is left in the answer, "
        "so `mayInterruptDownTheChain` admits a conversation interrupting ITSELF — ⚠️ not a safety "
        "hole on its own, and it is the one shape that proves the walk is about *above another* "
        "rather than *anywhere in the chain*. ⚑ **BOTH clauses go, because either alone suffices "
        "on an acyclic ledger** — see the docstring, and `M4` for the half that cannot be killed",
        [
            (
                STORE,
                "         SELECT id FROM ancestry WHERE depth > 0 AND id <> ? ORDER BY depth`,",
                "         SELECT id FROM ancestry ORDER BY depth`,",
            )
        ],
    ),
    (
        "M4 · ⛔ **EXPECTED SURVIVOR · the CYCLE half goes** · `id <> ?` exists for a ledger the "
        "rails cannot make — a hand-edited database, a restored bundle, a repair that pointed a "
        "row at its own descendant — where the 64-hop walk comes back round and lists the seed as "
        "its own ancestor. ⚠️ **No fixture can build one through a door**, so nothing in four "
        "vitest projects reaches it; kept because a table that only carries rows it can kill has "
        "stopped measuring its own edges",
        [
            (
                STORE,
                "         SELECT id FROM ancestry WHERE depth > 0 AND id <> ? ORDER BY depth`,",
                "         SELECT id FROM ancestry WHERE depth > 0 ORDER BY depth`,",
            )
        ],
    ),
    # ── C · the scope ─────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** This row plants 'ending reaches down
        # the chain', and D-014 made that the rule. Its anchor is left stale, so the census records
        # it retired.
        "M5 · 🔴 **ENDING gets the widening it was refused** · a grandparent destroys a "
        "grandchild's conversation, which `HO-058` §3 keeps with the direct commander and the PO "
        "priced in one line: *Stopping is a safety act and is recoverable… Ending is permanent and "
        "taking another manager's staff is a management act; neither needs to be fast, both stay "
        "narrow.* ⛔ The single most expensive way to over-read this ruling",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 asks `end_agent`'s entitlement of `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
            (
                HOST,
                "    if (target === undefined || target === null || !mayCommand(target, by)) return 'no-such-agent'",
                "    if (\n      target === undefined ||\n      target === null ||\n      !(\n        mayCommand(target, by) ||\n        mayInterruptDownTheChain(by, this.deps.store.ancestorsOf(sessionId))\n      )\n    )\n      return 'no-such-agent'",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The can_interrupt floor this row skips
        # no longer exists. D-014 says end and interrupt ask 'no grant and no project floor', so
        # interruptAgent has no `assertMayReach('interrupt', ...)`, and can_interrupt is one of the
        # six columns left 'unread and unwritten'. Its anchor is left stale, so the census records
        # it retired.
        "M6 · ⛔ **the capability FLOOR is skipped for exactly the callers the ruling admits** · "
        "`can_interrupt` is asked only of a direct commander, so an identity a person set to "
        "`none` reaches every conversation below it in the chain — ⚠️ **a grant a person REMOVED, "
        "silently restored by a relationship**, which is standing rule 11 in the direction that "
        "matters and `HO-016` §1's floor with a hole cut in it for the new arm alone",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 put the kept-open answer between the floor and `const session`. The DEFECT this row plants is unchanged.
            (
                HOST,
                "    this.assertMayReach('interrupt', sessionId, by)\n    if (slot === undefined) return { ok: true, agent: sessionId, state: 'open-nothing-running' }\n    const session = slot.session",
                "    if (mayCommand(target, by)) this.assertMayReach('interrupt', sessionId, by)\n    if (slot === undefined) return { ok: true, agent: sessionId, state: 'open-nothing-running' }\n    const session = slot.session",
            )
        ],
    ),
    # ── D · the sentences, both audiences ─────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted the refusal this row
        # edits: the `interrupt-outside-your-project` case, along with `may-not-interrupt`,
        # `may-not-end` and `end-outside-your-project`, is gone from describeMessageRail. Its anchor
        # is left stale, so the census records it retired.
        "M7 · ⚠️ **the REFUSAL states the narrowing again** · *you may only cut into conversations "
        "you started yourself* reaches a model that was refused by the PROJECT rail — ⛔ a "
        "sentence teaching a rule this app stopped enforcing, in the one place a refused caller "
        "actually reads, which is criterion 18 at the rails rather than on a surface",
        [
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
            (
                RAILS,
                "        'agents below you in the project you are working in: you may only cut into ' +\n        'conversations below you in the chain that created them, and only while they are in ' +\n        'that project.'",
                "        'agents you started in the project you are working in: you may only cut into ' +\n        'conversations you started yourself, and only while they are in ' +\n        'that project.'",
            ),
        ],
    ),
    (
        "M8 · ⚠️ **the TOOL DESCRIPTION states it** · `interrupt_agent` says *an agent you created* "
        "again, so a model reading its own toolset is told not to try the act this app admits — "
        "⛔ `402`'s defect pointed the other way, and standing rule 8.1's both-audiences half: the "
        "person's sheet and the model's description are one claim in two places",
        [
            (
                TOOLS,
                "        'Stop what an agent below you is doing right now — one you created, or one that those agents created in turn.",
                "        'Stop what an agent you created is doing right now.",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** D-014 deleted
        # `INTERRUPTION_REACH_ADMITS`, the can_interrupt help text on the sheet, and the column is
        # 'unread and unwritten'. The card says 'the grants sheet has six rows' (maxDepth,
        # canMessage, canAssignWork, canCreateAgents, takesWorkFrom, canWriteRules). Its anchor is
        # left stale, so the census records it retired.
        "M9 · ⚠️ **the CAPABILITY SHEET states it** · the sentence a person reads before choosing "
        "`can_interrupt` promises *only conversations it started itself*, which is a guarantee "
        "this app no longer makes — ⛔ `HO-016` §1's own finding on this field's NAME (*'May "
        "interrupt none' reads as a guarantee it is not*) arriving one row down, in its help text",
        [
            (
                SHEET,
                "  'same-project':\n"
                "    'conversations below it in the chain that created them, and only while they are in the ' +\n"
                "    'project it is working in — and it may only end one it started itself',\n"
                "  any:\n"
                "    'conversations below it in the chain that created them, in any project — and it may only ' +\n"
                "    'end one it started itself',",
                "  'same-project':\n"
                "    'only conversations it started itself, and only while they are in the project it is working in',\n"
                "  any: 'only conversations it started itself, in any project',",
            )
        ],
    ),
]
