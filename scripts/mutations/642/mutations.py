"""642 · Who can I talk to, and does talking wake them.

⚑ **the person's ask, and he asked for the investigation FIRST:** *"when a conversation turn is ended,
the list_agents does not return that agent. can the list agent returns all agents including stopped
ones? and talking to an agent or assigning work should bring the agent back up? but we first need
to investigate whether this makes sense first."*

## 🔴 A · what the dispatch CHANGED, which is one sentence

⛔ **This is a READ-ONLY dispatch with one permitted repair** (its brief's §5): *if `list_agents`'
description does not say what it omits, fix that sentence.* ⚠️ **It did not**, so the description
gained three clauses — what the listing drops, that a dropped id is refused everywhere, and where
the other half lives. ⚑ **Nothing else in `src/` moved.**

## ⛔ B · why the rows below are mostly about code this dispatch did not write

🔴 **The two assertions that would otherwise be vacuous are §1.2 and §3.1**, and both are about
doors that were already there. ⚠️ **A test that measures untouched code needs its own rows or it is
a restatement**: `M3` makes the message door stop asking whether the conversation is still here,
`M4` makes a task row claim a live state for a holder that has ended. ⛔ **Neither is covered by an
existing table** — `433`'s rows are about REACH, and reach is a different question from *is the
slot still in the map*.

## ⚠️ C · what has NO row, said rather than left out

⛔ **No row on §1.1** — *a conversation whose TURN ended is still listed*. ⚑ There is no line to
mutate: the slot map is deleted from in exactly two places — `abandon`, for a reservation that
never became a session, and `finalize` — and a turn terminal never reaches either. 🔴 **A row would have to ADD a delete that does not exist**, which is a row
measuring a world rather than this one (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`,
recognised before it was written).

⛔ **No row on §1.3** — *a restart empties the listing*. ⚠️ The emptiness is structural: `slots` is
a `new Map()` per `RuntimeHost`, and nothing reads a previous process's. ⚑ Mutating the field
initialiser would not compile into a world where the old map survives; the fact is held by the
absence of a restore path, which §1.3 measures by building a SECOND host over the SAME store.

⛔ **No row on §2.1** — *`list_profiles` still names an identity whose only conversation ended*.
🔴 `profilesVisibleTo` reads `agent_identity` and never the slot map, so every mutation that would
make it under-report is one of `511 relay 2`'s rows, already written and already RED.

## 🔴 D · the anchor this dispatch corrected rather than retired

⛔ **`433`'s `M6` quotes the whole `list_agents` description line**, so the repair above made it
stale. ⚑ **Corrected in place** — the `orig` half now carries the sentence as it stands and the
`repl` half is unchanged, so the row still reverts to the pre-`433` wording it was written to
revert to. ⚠️ **Re-verified RED by hand against its own killer file**
(`correct-a-stale-mutation-anchor-dont-retire-it`, and
`a-corrected-anchor-keeps-a-verdict-it-never-earned` is why the re-verification is not optional).
"""

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

# ⚠️ **RE-ANCHORED at 692, not retired** — `WHAT_IT_DROPS` now reads the lines 692 left there; every row that uses it plants the same defect as before.
WHAT_IT_DROPS = (
    # ⚑ **T-002 · re-anchored in place, not retired** — D-007 rewrote the clause: ended conversations are now listed apart, saying how they ended, and what is still dropped is named after them. The row still removes the whole clause naming what the list holds and drops. Re-verified RED alone.
    " This is what the app is running now — plus each conversation you started that a quit of this app left open, whose state says open-nothing-running until your message starts it again. Listed apart, after them: each conversation you started that has ended, with how it ended and when — a crash of this app, its provider failing, or being ended — newest first; none of those can be reached, a person can reopen one, and spawn_agent starts a new conversation. Any other conversation that has ended, or one from an earlier run, is here only once it has been reopened. An id this list omits, or lists as ended, cannot be reached — every tool whose agent id comes from this list answers no-such-agent for it."
)

WHERE_THE_REST_IS = (
    " The agents themselves outlive their conversations — list_profiles names the ones you may "
    "start, and starting one opens a new conversation rather than waking the old one."
)

# ⚠️ **RE-ANCHORED at 692, not retired** — `THE_SLOT_LOOKUP` now reads the lines 692 left there; every row that uses it plants the same defect as before.
THE_SLOT_LOOKUP = (
    '    const target = slot ?? this.keptOpen(sessionId)\n    if (target === undefined || target === null) return false\n    if (target.id === me) return true'
)

THE_HOLDERS_STATE = "            const state = host.agentCard(row.assignedTo, by, me)?.state ?? null"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the sentence this dispatch added ───────────────────────────────────────────────────
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 added the kept-open clause; the row still removes the whole clause naming what the list drops. The DEFECT this row plants is unchanged.
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** D-017 redefined `no-such-agent` to mean
        # only 'no conversation has that id at all' (R12); the docblock over `list_agents` was
        # rewritten accordingly: "Cut at CONVERSATIONS_LISTED... an id it omits is still one
        # get_agent_status and message_agent take... no-such-agent is said only about an id no
        # conversation has." Card line: "no-such-agent means only an id with no conversation; an
        # existing one out of reach gets the reach refusal message_agent meets." The scenario the
        # row plants (omitting the 'answer no-such-agent for one you may not [reach]' clause) is no
        # longer a true statement to omit. Its anchor is left stale, so the census records it
        # retired.
        "M1 · 🔴 **the listing stops saying what it DROPS** · the clause naming the ended "
        "conversation, the earlier run and the refusal that follows is removed, which is the "
        "description exactly as `433` shipped it. ⛔ **This is the defect the person met**: a model "
        "reads *every conversation this app will let you name*, finds an agent it knows exists "
        "missing, and concludes the agent is gone rather than that the LISTING is bounded. "
        "⚠️ `an-unenumerated-state-counts-as-success`, in a tool description",
        # list_agents must explain that an omitted ID may still be reachable. Removing that clause
        # hides a live capability from the model; the listing-description test pins the surviving
        # clause.
        [
            (TOOLS, ' An id it omits can still be one you reach: message_agent and get_agent_status take any id you may reach, and answer no-such-agent for one you may not.', ''),
        ],
    ),
    (
        "M2 · ⛔ **the other half stops being NAMED** · the clause pointing at `list_profiles` is "
        "removed and the listing says what it omits without saying where the omitted half lives. "
        "⚑ **That is the half `HO-068` §2.2 already ruled on** — *\"list_profiles is the surface "
        "that should have settled it\"* — and `511 relay 2` measured what a model does when a "
        "listing answers short and names no next door: it believes the short answer and reports "
        "the task blocked. 🔴 A refusal's remedy could not carry this (`no-such-agent` is "
        "`permanent` and `TOOL_REMEDY` is `null` for it, with two stated reasons), so the "
        "SENTENCE is the only place it can be said",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The list_agents
        # description still names list_profiles as the door for the other half ('The agents
        # themselves outlive their conversations — list_profiles names the ones you may start, and
        # starting one opens a new conversation.'), just trimmed of the retired 'rather than waking
        # the old one' clause (D-016/D-017 dropped the old-conversation-waking framing). Removing
        # the whole clause recreates the same unnamed-remedy defect the row protects.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: list_agents tells a caller that the agents outlive their conversations and that
        # list_profiles names every agent the app holds, so the caller has a door for an agent it
        # cannot reach. That closing sentence is still in the list_agents description. Removing it
        # leaves a description that names no such door. Killed by `who-can-i-talk-to.test.ts`.
        [
            (TOOLS, ' The agents themselves outlive their conversations — list_profiles names every agent this app holds.', ''),
        ],
    ),
    # ── B · the doors the sentence makes a promise about ───────────────────────────────────────
    # ⚠️ **RE-ANCHORED at 692, not retired.** 692 reads `target` (the slot, or what the quit closed) at the reach's first question. The DEFECT this row plants is unchanged.
    (
        # ⚑ Landing D-017 (45a11477) · killer: `a-message-that-crosses-a-project.test.ts`.
        "M3 · 🔴 **a door stops asking whether the conversation is still here** · the slot lookup "
        "that folds *not yours* and *not there* into one `no-such-agent` admits an id the map no "
        "longer holds. ⛔ **The new sentence claims this by name** — *an id this list omits cannot be "
        "reached, every tool whose agent id comes from this list answers no-such-agent for it* — and standing rule 5 says a "
        "claim with no test is a comment. ⚠️ **What a person would see**: `message_agent` against "
        "an ended conversation stops refusing and starts failing somewhere further in, where the "
        "answer is a transport error rather than a rail a model can read",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `withinMessagingReach`'s
        # target-null branch is the direct descendant of the row's old slot-lookup: `const target =
        # this.slots.get(sessionId) ?? this.startable(sessionId); if (target === undefined || target
        # === null) return false; if (target.id === me) return true`. Only `keptOpen(sessionId)` was
        # renamed to `startable(sessionId)` (and `slot` inlined) by D-017; the shape and the rule
        # ('a door must still ask whether the conversation exists before granting reach') are
        # unchanged, and a nearby comment even restates the pre-D-017 invariant.
        [
            (HOST, '    const target = this.slots.get(sessionId) ?? this.startable(sessionId)\n    if (target === undefined || target === null) return false\n    if (target.id === me) return true', '    const target = this.slots.get(sessionId) ?? this.startable(sessionId)\n    if (target === undefined || target === null) return true\n    if (target.id === me) return true'),
        ],
    ),
    (
        "M4 · ⚠️ **a task row claims a live state for a holder that has ended** · `given_to_is` "
        "stops being the card reader's answer and reports a state of its own. ⛔ **§3.1 is the "
        "finding this dispatch did NOT repair and the row is what keeps it measured**: "
        "`list_tasks` reads the LEDGER, so it names `given_to` for work whose conversation is "
        "gone, and the only thing telling a parent that the holder is unreachable is this field "
        "being null. 🔴 A parent reading `working` there would message an id every door refuses "
        "and have been told, by this app, that it was there to message",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the state a supervisor reads on given_to_is comes from the live agent card, not
        # a default. The join is ownerIs, via host.agentCard. The plant replaces the lookup with a
        # constant 'idle', not a null fallback, because no test drives a null card and a '?? idle'
        # plant would survive. Killed by `state-a-supervisor-can-trust.test.ts`.
        [
            # ⚑ **a helper stopped on a person · re-anchored in place, not retired** — list_tasks now keeps each holder's whole card and reads the state off it; the plant still replaces the live state with a constant 'idle'
            (TOOLS, "          const ownerIs = (row: PieceRow): AgentCard['state'] | null => cardOf(row)?.state ?? null", "          const ownerIs = (row: PieceRow): AgentCard['state'] | null => 'idle' as AgentCard['state'] | null"),
        ],
    ),
]
