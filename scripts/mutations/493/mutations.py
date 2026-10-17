"""493 · the verb a supervisor cannot reach.

🔴 **The composed regression is the reason these rows are novel.** It opens the shipped default
identity, creates and approves a project, explicitly spawns the shipped project-manager into it,
and asks the three verbs through their published tool doors. No SQL binding or invented grant is a
premise.

`M1` and `M2` distinguish two ways BroBot could have received global interrupt reach: its special
creation seed, or the ruled default every identity resolves. `M3` swaps only the message reader, so
the successful cross-project message proves it is not piggybacking on `can_interrupt`. Existing
374/375 rows already swap interrupt and end onto `can_message`; they are not duplicated here.

`M4` restores the separate disclosure defect found by the investigation: the `any` sentence again
claims interrupt/end may reach a conversation somebody else started, even though both doors require
the immutable command relationship before they read this grant.

## Gate map

| rows | killer |
|---|---|
| `M1`–`M3` | `apps/desktop/test/the-project-a-spawn-lands-in.test.ts` §7 |
| `M4` | `apps/desktop/test/the-text-a-child-is-actually-told.test.ts` and `apps/desktop/test/dom/capabilities-sheet.dom.test.ts` |

⚠️ The idle positive interrupt proves reach admission, not useful interruption. The useful working
window and the waiting-person refusal remain owned by
`the-interruption-that-looks-like-a-fault.test.ts`; no state rail is mutated here.
"""

WIRE = "apps/desktop/src/shared/runtime-ipc.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"

MUTATIONS = [
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row plants a canInterrupt: 'any'
        # line into BroBot's SEEDED_GRANTS entry. D-014 deleted SEEDED_GRANTS and stopped reading
        # can_interrupt. Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 BroBot is specially seeded with global interrupt reach · the ordinary path "
        "can interrupt and end its cross-project PM without any person's edit",
        [
            (
                WIRE,
                # ⚑ **Re-anchored by `553`, not retired** — the seed gained `canAssignWork`
                # (HO-060 §2.2) between the two lines this row has always pointed at. ⛔ The
                # defect is unchanged: BroBot is given the DESTRUCTIVE reach it is not given, and
                # `can_interrupt` is the one column both `549` and `553` left where it was.
                # ⚑ **Re-anchored again by `584`** (`HO-078` §1): the line BELOW the pair went
                # with the seeded spawn list, so the anchor is the line ABOVE instead. ⛔ The
                # defect is unchanged — BroBot is given the DESTRUCTIVE reach it is not given —
                # and `can_interrupt` is still the one column `549`, `553` and `584` all left
                # exactly where it was.
                # ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 narrowed the seeded
                # word from `any-this-app-does-not-seed` to `created-by-me`. ⛔ The defect
                # this row names is unchanged; only the value it quotes moved.
                "      canMessage: 'any',\n      canAssignWork: 'any',\n"
                "      canStaff: 'created-by-me',",
                "      canMessage: 'any',\n      canAssignWork: 'any',\n      canInterrupt: 'any',\n"
                "      canStaff: 'created-by-me',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is the canInterrupt field's
        # ruled default. D-014 removed that field from CAPABILITY_FIELDS, and interrupt no longer
        # reads any grant. Commit: 'End and interrupt reach the chain below the caller, with no
        # grant and no project floor.' Its anchor is left stale, so the census records it retired.
        "M2 · ⛔ `can_interrupt` is ruled global · every unchosen identity resolves to `any`, "
        "so the same ordinary refusal disappears without a BroBot-specific seed",
        [
            (
                CAPS,
                "    says: (held) => INTERRUPTION_REACH_ADMITS[held],\n"
                "    ruled: 'same-project',\n"
                "    narrowest: 'none',\n"
                "    vocabulary: [...MESSAGING_REACH],\n"
                "    whenItTakesEffect: null,\n"
                "  },\n"
                "  {\n"
                "    key: 'canCreateAgents',",
                "    says: (held) => INTERRUPTION_REACH_ADMITS[held],\n"
                "    ruled: 'any',\n"
                "    narrowest: 'none',\n"
                "    vocabulary: [...MESSAGING_REACH],\n"
                "    whenItTakesEffect: null,\n"
                "  },\n"
                "  {\n"
                "    key: 'canCreateAgents',",
            )
        ],
    ),
    (
        "M3 · 🔴 `message_agent` reads the interrupt column · BroBot's seeded global message "
        "grant becomes inert and the ordinary cross-project work is refused",
        [(RAILS, "  message: 'canMessage',", "  message: 'canInterrupt',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject is
        # INTERRUPTION_REACH_ADMITS['any'], the sheet's sentence for the word of a can_interrupt
        # grant. D-014 deleted that table along with the field ('with no grant and no project
        # floor'), so there is no grant word left to describe. ⚠️ The disclosure itself survives as
        # `interrupt_agent`'s description (*"one you created, or one that those agents created in
        # turn"*). `629` `M8` plants the narrowing there; the widening is asserted by
        # `a-stop-reaches-down-the-whole-chain.test.ts` (`below you`) and planted by no row. Its
        # anchor is left stale, so the census records it retired.
        "M4 · ⚠️ the interrupt disclosure claims the messaging widening · `any` again says "
        "it reaches a conversation whoever started it, while both destructive doors still ask "
        "about a relationship — ⚑ since `629` the SPAWN CHAIN for interrupting and the direct "
        "commander for ending, and `any` removes neither",
        # ⚑ **RE-POINTED at 629, not retired** (`HO-095` §4). ⛔ The sentence moved because the
        # relationship did; the row's DEFECT is unchanged and is now wider, because the mutant
        # drops BOTH composites this one sentence has to carry.
        [
            (
                CAPS,
                "  any:\n    'conversations below it in the chain that created them, in any project — and it may only ' +\n    'end one it started itself',",
                "  any: 'any conversation, in any project, whoever started it',",
            )
        ],
    ),
]
