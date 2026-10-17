"""618 · creation carries instructions.

⛔ **`HO-078` §4:** ⚑ ***"`create_agent` takes the new identity's own instructions — what it is for,
the operating model it works under, whatever scoping the creator can give it."*** 🔴 **And
`HO-078` §1.1, which is the half every row below is really pointed at:** ⛔ ***"The creator writes
the initial text; after that it is the person's, and an agent wanting to change it PROPOSES."***

## 🔴 The property every row here is pointed at

⛔ **A creator writes ONE version, it is recorded as EXACTLY what it is, and nothing about that act
can be spent twice.** ⚑ Three things can fail independently and each failure reads perfectly:
the text can reach the agent under a provenance that is a lie about a person; the write can happen
on a call that was not a creation; and the bound can be asked after the identity exists rather than
before.

## ⚑ Four claims

 1. **The fourth word exists and says what it means** (M1–M3). ⛔ `HO-094` §1 ruled the property
    and left the NAME and the SENTENCE to this dispatch — so the sentence is product text a person
    reads, and each of `HO-094` §1.1's three *why it is false* lines is a way it could go wrong.
 2. **The record is closed where no code can get past it** (M4–M5). 🔴 The vocabulary and *one
    write, at creation* are both CHECKs on `identity_instruction`, which is why `0042` is a table
    rebuild rather than an `ALTER`.
 3. **What is written is what happened** (M6–M8, M14). ⚠️ The provenance word, the conversation,
    the actor, and the identity the version belongs to — each is a separate fact and each can be
    wrong on its own.
 4. **The bound and the optionality** (M9–M13). ⛔ 16,000 is asked ABOVE the mint, omitting the
    field writes nothing at all, and the answer reports what was written rather than what was asked
    for.

## 🔴 The one a reader should look at first

⛔ **M6 writes the creator's text as `relayed-from-user`.** ⚑ Nothing throws, the agent is told
exactly the same rules, the sheet draws a perfectly ordinary row — and the row now tells the person *an
agent wrote this, saying you had given it the rule*. ⚠️ **About a rule he never gave and was never
asked about.** 🔴 That is the criterion-18 failure `HO-094` §1.1 names, arriving as a sentence that
looks like every other sentence in the table.

## ⛔ What this table does NOT cover, said out loud

 1. **The `propose`/`relay` flow** — `582` owns `proposeAgentRules`, `decideInstruction` and the
    `INSTRUCTION_ASKS` vocabulary, and `the-layer-a-person-writes` is its table. ⚑ `618` adds a
    writer beside them and changes neither.
 2. **The spawn rails in front of the door.** ⛔ `341`'s twelve rails, `486`'s standing wall and
    `598`'s creator provenance are `341`/`486`/`598`'s rows, and a row here that disarmed
    `mayCreateAgents` would be measuring their guard with this table's name on it. ⚠️ **What `618`
    owes is that a new ARGUMENT does not get past them**, and that is asserted — §5 of the killer
    file, where the same over-long call meets two different words depending only on the grant.
 3. **`OWN_INSTRUCTIONS_CHARS` itself.** ⚑ `582` derived it; M10 and M11 mutate the DOOR that
    enforces it, and the number is pinned by a literal in the test rather than by a row here
    (`a-bound-written-as-the-constant-cannot-pin-it`).

## 🔴 The gate map — which file kills which row, MEASURED

⚑ **MEASURED, one row at a time, and the table below was rewritten from the measurement** — the
first draft of it put M14 in §2 and M9 in §2 alone, and both were wrong.

| rows | killer section, measured |
|---|---|
| M1–M5, M14 | `apps/desktop/test/creation-carries-instructions.test.ts` §1 · the word, and the two CHECKs |
| M6–M8, M12–M13 | `…creation-carries-instructions.test.ts` §2 · what is written, and what the answer says |
| M9 | §1 **and** §2 · a version appears where none should, and it collides with §1's planted row |
| M10 | `…creation-carries-instructions.test.ts` §4 · the boundary |
| M11 | §4 **and** §5 · the bound, and the identity a refused call would have left behind |

⛔ **Eleven of fourteen are killed by exactly one section**; M9, M11 and M14 by two, and in each
case the second section is a different claim rather than the same one restated. ⚑ **Every row is
killed by ONE FILE**, which is what makes this table's coverage checkable rather than diffuse.

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun` and no verdict is claimed here. ⚑ Each red was
checked for the RIGHT reason: the output was searched for `SyntaxError`, `Transform failed` and
`error TS`, because a row red on a parse error measured nothing (`452 M8`).
"""

VOCAB = "apps/desktop/src/shared/own-instructions.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0042_creation_carries_instructions.sql"
MIGRATION_0000_THE_TREE = "apps/desktop/src/main/db/migrations/0000_the_tree.sql"

MUTATIONS = [
    # ── §1 · the fourth word, and what it says ────────────────────────────────────────────────
    (
        "M1 · 🔴 **THE WORD IS GONE** · `WHO_WROTE_IT` is back to `HO-009` §2.2's three, so `foldWhoWroteIt` no longer recognises what this app writes and every creator's version reads back as `an-agents-proposal`. ⛔ **The narrow fold is what makes this silent**: nothing throws, the sheet draws a sentence, and the sentence says a person approved something nobody ever saw",
        [(VOCAB, "  'relayed-from-user',\n  'its-creator',\n] as const", "  'relayed-from-user',\n] as const")],
    ),
    (
        "M2 · ⛔ the sentence stops saying nobody was asked · the clause `HO-094` §1.1 exists for. ⚑ A person reading the row learns WHO and WHEN and is not told the one thing the other three members each have an answer for — *you wrote it*, *you approved it*, *an agent says you said it*. ⚠️ **It is the only member whose honest answer on that axis is *nothing***, and this is the row that removes it",
        [
            (
                VOCAB,
                "    'the agent that created this one wrote this as it created it, before this agent had ever run — nobody asked you',",
                "    'the agent that created this one wrote this as it created it, before this agent had ever run',",
            )
        ],
    ),
    (
        "M3 · 🔴 **THE TRAP, WRITTEN OUT** · the new member's sentence becomes `an-agents-proposal`'s. ⛔ `HO-094` §1.1: *\"nothing was proposed and nothing was approved — criterion 18: a record may not assert a decision nobody made.\"* ⚠️ SEPARATE from M1 because the WORD survives here: the record still distinguishes the act and the sentence a person reads lies about it, which is the half a vocabulary census cannot see",
        [
            (
                VOCAB,
                "    'the agent that created this one wrote this as it created it, before this agent had ever run — nobody asked you',",
                "    'an agent proposed this and you approved it',",
            )
        ],
    ),
    # ── §2 · the record is closed in the database ─────────────────────────────────────────────
    (
        "M4 · ⛔ the `wrote_it` CHECK refuses the word this app writes · `0042`'s whole reason for being a table rebuild. ⚑ The failure is LOUD — a creation with rules raises at the INSERT — which is the right direction for a vocabulary rail to fail in, and the row exists to prove the migration is what admits the word rather than the reader",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # identity_instruction wrote_it CHECK survives as identity_instruction_wrote_it_ck in the
        # single 0000_the_tree.sql (line 99), still admitting 'its-creator' beside the three older
        # words. The old anchor named the deleted 0042 migration and the __new_identity_instruction
        # table, so the same edit is re-pointed at the plain column reference. Killed by
        # `creation-carries-instructions.test.ts`.
        [
            (MIGRATION_0000_THE_TREE, "in ('a-person', 'an-agents-proposal', 'relayed-from-user', 'its-creator')", "in ('a-person', 'an-agents-proposal', 'relayed-from-user')"),
        ],
    ),
    (
        "M5 · 🔴 **ONE WRITE, ONCE — GONE FROM THE DATABASE** · `identity_instruction_creator_is_first_ck` is what makes `HO-094` §1.2's *\"the new member describes one write, once; it grants nothing afterwards\"* true whatever code runs. ⛔ Without it the product rail (`agent-name-taken`) is the only thing standing, and a rail in one door is a rail one door away from being bypassed",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # identity_instruction_creator_is_first_ck survives as line 100 of 0000_the_tree.sql, the
        # database rail that makes 'its-creator' legal only at version 1. The plant deletes that
        # CONSTRAINT line; the line before it ends in a comma and the next CONSTRAINT follows, so
        # the SQL stays valid. Killed by `creation-carries-instructions.test.ts`.
        [
            (MIGRATION_0000_THE_TREE, '\tCONSTRAINT "identity_instruction_creator_is_first_ck" CHECK("identity_instruction"."wrote_it" <> \'its-creator\' or "identity_instruction"."version" = 1),\n', ''),
        ],
    ),
    # ── §3 · what is written is what happened ─────────────────────────────────────────────────
    (
        "M6 · 🔴 **A LIE ABOUT THE PERSON** · the creator's own text is recorded as `relayed-from-user`, so the sheet tells him *an agent wrote this, saying you had given it the rule* about a rule he never gave and was never asked about. ⛔ Nothing throws, the agent is told exactly the same rules, and the row is indistinguishable from an honest one. ⚑ `HO-094` §1.1: *\"only true when the person dictated the text, which he usually does not\"*",
        [(HOST, "              whoWroteIt: 'its-creator',", "              whoWroteIt: 'relayed-from-user',")],
    ),
    (
        "M7 · ⛔ the version names no conversation · `conversation_id` is `null`, which is the column's own spelling of *a person wrote it directly*. ⚠️ The provenance WORD still says a creator did it, so the row now carries two facts that cannot both be true — and `identity_instruction_person_said_nothing_ck` cannot catch it, because that CHECK is about `a-person` and this word is not one",
        [(HOST, "              conversation: me,", "              conversation: null,")],
    ),
    (
        "M8 · 🔴 **THE ACTOR GOES BACK TO BEING UNREADABLE** · `actorOf` is the repair `618` had to make before its own write meant anything: the column is JSON TEXT to this store and `actedByFrom`'s first line is `typeof stored !== 'object'`. ⛔ Restored to the pre-`618` spelling, every version of every identity's rules reads back as *the app itself* — which is what it did from `582` until this dispatch, silently, because no surface drew the field",
        # ⚑ **RE-ANCHORED at `625`**: `memoryAmendmentFrom` folds its own `by` column through the
        # same `actorOf`, so the bare literal matched TWICE and the row went dark. ⛔ **CORRECTED,
        # not retired** — the subject is `ownInstructionFrom`'s fold and it is exactly where it
        # was. ⚠️ **Widened with the line that follows it**, which reads a column only
        # `identity_instruction` has, and re-verified RED by hand
        # (`correct-a-stale-mutation-anchor-dont-retire-it`).
        [
            (
                STORE,
                "    by: actorOf(row.by),\n    conversation: row.conversation_id,",
                "    by: actedByFrom(row.by),\n    conversation: row.conversation_id,",
            )
        ],
    ),
    # ── §4 · the bound, the optionality, and the answer ───────────────────────────────────────
    (
        "M9 · ⛔ omitting the field writes an EMPTY version instead of none · `HO-078` §4.3's *an agent creating another without rules is the ordinary case*, broken in the direction that looks harmless. ⚑ *Nobody has ever written rules for this agent* and *somebody wrote some and took them away* become one state, and only the second has a date and an author",
        [
            (
                TOOLS,
                "            rules === undefined ? null : (rules as string),",
                "            (rules ?? '') as string,",
            )
        ],
    ),
    (
        "M10 · ⛔ the bound refuses a rule set AT 16,000 · `>` becomes `>=`, so the largest legal value is refused and the number a person reads in the door's own sentence is one more than the number it accepts. ⚠️ The classic off-by-one on a boundary, and it is invisible to any test that only sends something obviously too long",
        [
            (
                TOOLS,
                "            rules !== undefined &&\n            (typeof rules !== 'string' || rules.length > OWN_INSTRUCTIONS_CHARS)",
                "            rules !== undefined &&\n            (typeof rules !== 'string' || rules.length >= OWN_INSTRUCTIONS_CHARS)",
            )
        ],
    ),
    (
        "M11 · 🔴 **THE BOUND IS NOT ASKED AT ALL** · a 16,001-character rule set is written, and — because the length was the only thing standing between the argument and the mint — a caller that meant to be refused now leaves a durable identity behind. ⛔ That is criterion 12's own failure mode arriving through the argument that was meant to enrich the creation, and `HO-078` §4.2 asks for a reason a model can classify instead",
        [
            (
                TOOLS,
                "            rules !== undefined &&\n            (typeof rules !== 'string' || rules.length > OWN_INSTRUCTIONS_CHARS)\n          ) {",
                "            rules !== undefined &&\n            typeof rules !== 'string'\n          ) {",
            )
        ],
    ),
    (
        "M12 · ⛔ the answer always claims rules were written · `an-unenumerated-state-counts-as-success` in one field: a caller that sent none is told `written`, and the only way left to learn the truth is to read its own argument back — which is exactly the drift `a-report-must-be-computed-from-the-outcome` forbids",
        [
            (
                TOOLS,
                "              rules: wrote === null ? 'none-given' : 'written',",
                "              rules: 'written',",
            )
        ],
    ),
    # RETIRED: the former JSON/order/echo contract was removed.
    (
        "M13 · ⚠️ the sentence stops saying what happened to the rules · the payload still carries the discriminant, so a MODEL can still tell — and the provider's rendered answer, which is what a person reads in the transcript and what a model without a structured-output path sees, says nothing at all. ⚑ `489`/HO-031 §2.6: the two halves are composed once and must say the same thing · killed by `creation-carries-instructions.test.ts` (named by W4.78)",
        [
            (
                TOOLS,
                # ⚑ **W4.78 · re-anchored in place, not retired** — D-042 inserted the default-model clause between 'has been sent nothing.' and the rules clause, so the old three-line anchor no longer runs together; the plant blanks the same clause. Killer: creation-carries-instructions.test.ts:517 asserts the sentence.
                "                ? ' You sent no rules, so it has none.'\n",
                "                ? ''\n",
            )
        ],
    ),
    (
        "M14 · ⛔ the version is written for the CALLER instead of the new identity · `created.slug` becomes the creating conversation's id, which names no identity — so `writeOwnInstructions` refuses on its own existence rail, the creation succeeds, and the rules vanish with no error anywhere. ⚑ The `null` arm the host's own note calls unreachable is reachable here, which is what makes that note worth having",
        [(HOST, "              profileSlug: created.slug,", "              profileSlug: me,")],
    ),
]
