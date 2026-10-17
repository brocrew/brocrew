"""610 · The roster that names nobody — each row is THE DEFECT, put back verbatim (131).

🔴 **What this dispatch closed.** the person asked Ali to relay a message to Ada. Ali answered *"I don't
see anyone named 'Ada' among the agents/conversations visible to me in this app… Could you clarify
who Ada is?"*, then — asked what it COULD see — *"Neither is named 'Ada' — that first one's ID just
happens to contain 'ada' as a substring, but it's not a person or an agent called Ada."*

⛔ **The app knew, and the same screen said so twice** (*SPAWNED THIS CONVERSATION · Ada*, *Task #2
from Ada*). ⚑ **Ali reasoned WELL on the data it had.** 🔴 The fix is code and not instructions —
standing rule 15 — and it is one field on `AgentCard`, derived through `agentName`.

## ⚠️ The hazard every row here is written against

⛔ **`agentName` has an input it must never be given**, stated twice in `runtime-ipc.ts`: *"a
conversation the sweep found in the user's own provider home has no profile at all, and calling it
BroBot would invent one."* ⚑ That conversation is one of THE PERSON'S, out of his `~/.claude` or
`~/.codex`, and `agentName(null, …)` answers **BroBot** about it.

🔴 **`M1` is the row that matters most, and it is invisible to every ordinary fixture**
(`a-comparison-tested-where-both-sides-agree-measures-nothing`). A named identity and a default one
give the SAME answer under either reading; the readings part only on a slot that names no profile
at all, which is why `§2` of the killer file holds a resume open to construct one.

## 🔴 Which gate can see each row

⚑ **Every row is caught by `run_suite`, in `apps/desktop/test/the-roster-that-names-nobody.test.ts`.
⛔ WHICH SECTION was MEASURED per row rather than reasoned about** — each row applied alone, each
section run alone against it:

| row | §1 the line | §2 cannot name | §3 his own | §4 every door | §5 the sentences |
|---|---|---|---|---|---|
| `M1` | | 🔴 | | | |
| `M2` | 🔴 | 🔴 | 🔴 | 🔴 | |
| `M3` | 🔴 | 🔴 | | 🔴 | |
| `M4` | | | 🔴 | 🔴 | |
| `M5` | 🔴 | | | | |
| `M6` | 🔴 | | | 🔴 | |
| `M7` | | 🔴 | | | |
| `M8` | | 🔴 | | | |
| `M9` | 🔴 | | | | |
| `M10` | | | | | 🔴 |
| `M11` | | | | | 🔴 |

⚑ **`M9` is the one row with a SECOND killer, measured the same way**:
`apps/desktop/test/a-row-that-says-who-is-in-it.test.ts` §1 also goes red, because that is
`agentName`'s own vocabulary file and the fold is `agentName`'s own line. ⛔ Every other row here
leaves it green.

🔴 **`M1` is killed by §2 and by NOTHING ELSE, which is the measurement this table exists for.**
⚑ Four sections exercise the naming and none of them can see it, because a named identity and a
default one give the same answer under either reading — `a-comparison-tested-where-both-sides-agree-
measures-nothing`, confirmed rather than asserted. ⚠️ `M5`, `M7` and `M8` are each single-section
rows for the same reason, one surface over.

⚠️ **Every row was applied ALONE, watched go red against the file named here, and restored from its
own saved bytes with a sha256 re-check** (`verify-each-mutation-row-without-running-the-table`).
⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row deleting `list_agents`' INVARIANT clause.** That is `433 M6` — re-anchored in this very
commit onto `610`'s rewritten sentence — and a second copy here would make one defect kill two
tables. ⚑ `M9` removes the clause `610` ADDED and leaves `433`'s in place, so the two rows fail
over different sentences in the same string.

⛔ **No row on `foundInUserHome`.** The brief asked for that predicate in front of `agentName`, and
`610` derived a different one: the SLOT already carries the answer, so no line in this dispatch
reads the ledger predicate and there is nothing here for a row to put back. ⚠️ **The ledger half is
asserted rather than mutated** — §3 of the killer file measures that a swept row's `profileId` is
`null` and that `resumeSession` refuses it before it can become a card — ⛔ because a row mutating
`session-store.ts` would be re-measuring `154`'s decision and not this one's.

⛔ **No row removing `AgentCard.whose` outright.** That mutant does not COMPILE — `whoseText` reads
the discriminant — so its red would come from `tsc` rather than from the product, which is the *"red
that proves nothing"* `414 M24` names. ⚑ **The rule is carried by the TYPE, and `M1` measures what
the type cannot**: a call site that resolves the forbidden `null` to a default before handing it
over, which compiles and is exactly the shape a lazier implementation would have shipped.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

MUTATIONS = [
    # ── §1 · the forbidden input ──────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the card resolves the slot's `null` to the default before "
        "asking, so a conversation swept out of THE PERSON'S OWN `~/.claude` is introduced to every "
        "model in this app as **BroBot** — `runtime-ipc.ts`'s forbidden input, reached through the "
        "one `??` that stands in front of it",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The rule is untouched: a
        # swept conversation's null profileId must never be resolved to the default before naming
        # it. D-017's cardReads() batching (R11) only renamed the roster argument from `roster` to
        # `reads.roster` at this same `cardFor` call site.
        [
            (HOST, '      whose: whoseConversationIs(slot.profileId ?? session?.profileId ?? null, reads.roster),', '      whose: whoseConversationIs(\n        slot.profileId ?? session?.profileId ?? DEFAULT_PROFILE_ID,\n        reads.roster,\n      ),'),
        ],
    ),
    (
        "M2 · 🔴 the NAME is the slug again · `agentName` stops being asked, so the card carries "
        "`ada` where the app has held `Ada` since that identity's first launch — the state Ali was "
        "reasoning in, restored without touching a single sentence a reader would check",
        [
            (
                HOST,
                "  return { is: 'an-identity-this-app-holds', profile, name: agentName(profile, roster) }",
                "  return { is: 'an-identity-this-app-holds', profile, name: profile }",
            )
        ],
    ),
    (
        "M3 · ⚠️ the LISTING is named against an empty roster · `agentName`'s `??` falls through to "
        "`profileLabel` for every row, so `list_agents` prints slugs and `list_projects` — which "
        "walks the same method — prints them too. ⛔ The one call that is not affected is "
        "`get_agent_status`, which is why `M4` is a separate row",
                # ⚑ **T-002 · re-anchored in place, not retired** — D-007 reads the roster the same
                # way in `childrenThatLeft`, so the anchor carries the listing's next line. Same
                # defect, in `agentsVisibleTo`. Re-verified RED alone.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — list_agents and
        # list_projects still share one roster read distinct from get_agent_status's, just moved
        # from a bare `agentIdentities()` call into `conversationsVisibleTo`'s own `cardReads()`
        # call (the listing's own copy, separate from `agentCard`'s fresh call). Emptying only the
        # listing's roster reproduces the same slugs-in-the-list defect while leaving the
        # single-card door correct.
        [
            (HOST, '  private conversationsVisibleTo(by: Caller, me: string | null): readonly VisibleConversation[] {\n    const reads = this.cardReads()\n    return [\n', '  private conversationsVisibleTo(by: Caller, me: string | null): readonly VisibleConversation[] {\n    const reads = { ...this.cardReads(), roster: [] as readonly AgentIdentity[] }\n    return [\n'),
        ],
    ),
    (
        "M4 · ⚠️ the CARD is named against an empty roster, alone · the half-fix: enumerating "
        "names people and inspecting names slugs, so a model that found Ada in a listing is told "
        "`ada` the moment it asks about her — `433`'s *enumerating and inspecting are ONE "
        "question*, broken in the direction no listing assertion can see",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired —
        # get_agent_status/agentCard's single-card roster read is still its own separate
        # `this.cardReads()` call, now at `agentCard`'s return line instead of a bare
        # `agentIdentities()` call. Emptying only that call's roster reproduces the half-fix defect
        # (listing named, single lookup slugged) without touching the listing path.
        [
            (HOST, '    return this.cardFor(slot, this.cardReads())', '    return this.cardFor(slot, { ...this.cardReads(), roster: [] as readonly AgentIdentity[] })'),
        ],
    ),
    # ── §2 · the line a model reads ───────────────────────────────────────────────────────────
    (
        "M5 · ⛔ the name a NOBODY gave is printed twice · `worker · worker` — the characters "
        "`profileText` spends its own rule avoiding one function down, and the reason the rule is "
        "here rather than in a reader: a line composed per surface is a second answer",
        [
            (
                TOOLS,
                "  return whose.name === whose.profile ? whose.profile : `${whose.name} (${whose.profile})`",
                "  return `${whose.name} (${whose.profile})`",
            )
        ],
    ),
    (
        "M6 · 🔴 the SLUG wins and the name is dropped · every row goes back to what Ali was "
        "shown, while the structured payload still carries the name — so the text half and the "
        "data half of one answer disagree about who an agent is",
        [
            (
                TOOLS,
                "  return whose.name === whose.profile ? whose.profile : `${whose.name} (${whose.profile})`",
                "  return whose.profile",
            )
        ],
    ),
    (
        "M7 · ⛔ the arm that cannot be named is OMITTED rather than rendered · the row becomes "
        "`sess_x ·  · starting`, and an absence drawn as a gap reads as *this one has none* — "
        "HO-024 §5.3 and `430`'s renderable unknowns, at the one row that is about a person's own "
        "conversation",
        [
            (
                TOOLS,
                "  if (whose.is !== 'an-identity-this-app-holds') return THIS_APP_CANNOT_NAME_IT",
                "  if (whose.is !== 'an-identity-this-app-holds') return ''",
            )
        ],
    ),
    (
        "M8 · 🔴 the arm that cannot be named is given BroBot's label · the invented name, arriving "
        "at the RENDERER instead of at the derivation — the same false sentence `M1` reaches "
        "through the card, proving the guard has to hold at both ends",
        [
            (
                TOOLS,
                "  if (whose.is !== 'an-identity-this-app-holds') return THIS_APP_CANNOT_NAME_IT",
                "  if (whose.is !== 'an-identity-this-app-holds') return 'BroBot'",
            )
        ],
    ),
    (
        "M9 · 🔴 the lookup compares a DIRECTORY spelling with a folded slug · the two sides come "
        "from different columns — `provider_session.profile_id` keeps what a person typed, "
        "`agent_identity.slug` is folded at the mint — so a conversation launched as `Dev` misses "
        "the row that names it and reports `Dev` while this app has held `Ada` since that "
        "identity's first launch. ⛔ Measured at `610`, and it is the same defect one fold away "
        "from the one the dispatch was sent to close",
        [
            (
                IPC,
                "  const slug = foldProfileName(profileId ?? DEFAULT_PROFILE_ID)",
                "  const slug = profileId ?? DEFAULT_PROFILE_ID",
            )
        ],
    ),
    # ── §3 · the sentences a model is handed ──────────────────────────────────────────────────
    # Re-anchored, NOT VERIFIED and HELD; its test reaches a held path.
    (
        "M10 · ⚠️ `list_agents` goes back to promising four fields and no name · the sentence was "
        "TRUE — *\"Reports id, project, profile, state and where each came from\"* — which is why "
        "every assertion in this tree passed while the row was unusable. ⛔ `530`'s clipped grant "
        "line, at the door that answers agents rather than people",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The list_agents
        # description still ends in the exact 'Reports who each one is…A conversation this app
        # cannot attribute is still listed…' sentence — verified verbatim in agent-tools.ts and
        # pinned by the-roster-that-names-nobody.test.ts §5 ('Reports who each one is — the name a
        # person gave that agent' / not.toContain('Reports id, project, profile, state')). Only the
        # string's quoting changed (the whole description became a template literal with
        # STOPPED_CONVERSATIONS_LISTED interpolated), so the anchor needs the backtick terminator
        # instead of a single quote.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule that
        # list_agents tells a model it reports who each one is, and not only four bare fields, still
        # holds and is pinned by the-roster-that-names-nobody.test.ts §5. D-016 removed `project`
        # from the sentence, so the anchor text changed. The plant puts back the true-but-useless
        # field list, with `project` dropped.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # list_agents description in agent-tools.ts still carries the roster words a model reads
        # (who each one is, the give_work profile slug, the conversation that started it, the work
        # it holds by label). The plant reverts it to the old terse 'id, profile, state and where
        # each came from' wording. Killed by `the-roster-that-names-nobody.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The list_agents description still tells a model who each one is, and
        # commit 7 now opens it with 'Each is named by the piece of work it owns'. The old anchor
        # was the sentence before that rewrite; the plant restores the terse 'id, profile, state and
        # where each came from' promise, the true-but-useless field list the label names. Killed by
        # `the-roster-that-names-nobody.test.ts`.
        [('apps/desktop/src/main/runtime/agent-tools.ts', 'Each is named by the piece of work it owns (the owner of W1.2 · its title), or by its id when it holds none, then who it is — the name a person gave that agent, and the profile slug give_work takes — its state, the conversation that started it, named the same way, and the work it holds: its own root, when a person gave it one, and its open pieces, by label. A conversation this app cannot attribute is still listed, and says so rather than being given a name.`,', 'Reports id, profile, state and where each came from.`,')],
    ),
    (
        "M11 · ⚠️ `get_agent_status` stops saying WHO · the clause `610` added is removed while the "
        "payload keeps the name, so a model reading the description has no reason to ask this door "
        "about an agent it cannot name — `a-number-can-survive-the-death-of-its-derivation`, in the "
        "direction where the sentence goes stale rather than the number",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — get_agent_status's
        # description still opens with 'Who one agent is, what it is doing right now, and where it
        # came from.' (now followed by a rewritten reach clause instead of the old 'It answers for
        # exactly the agents list_agents names.'). The row's rule — dropping the WHO clause while
        # the payload keeps the name — still applies; only the trailing sentence changed with
        # D-017's reach model.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — get_agent_status's
        # description was reworded to enumerate the six D-017 states inline, but it still opens with
        # the WHO clause bound to the reach clause exactly as 610 added it. Dropping 'Who one agent
        # is, ' plants the same stale-derivation defect the row names.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # describe-one-agent tool text still opens with 'Who one agent is, what it is doing right
        # now', which the roster test pins as the words a model reads. The plant strips the 'Who one
        # agent is' clause and leaves the sentence grammatical. Killed by
        # `the-roster-that-names-nobody.test.ts`.
        [
            (TOOLS, '        "Who one agent is, what it is doing right now — active,', '        "What one agent is doing right now — active,'),
        ],
    ),
]
