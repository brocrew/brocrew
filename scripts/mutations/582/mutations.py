"""582 · The layer that compiles and nothing feeds.

⛔ **`HO-073` §2:** *"There is no layer carrying anything the person wrote. The seam exists, compiles, and
nothing feeds it."* ⚑ **This dispatch built the two feeders `HO-009` §2.2 ruled** — a person's
editor and an agent's proposal — and the rows below are about the RAILS and the PROPERTIES that make
them safe, never about the wiring, which the compiler already refuses to let go missing.

## 🔴 A · the seam, and the one line that feeds it

⛔ **`M1` drops the feed**, which is the world `HO-073` §2 describes: a person writes a rule, saves
it, relaunches, and the agent is told nothing. ⚑ **`M2` reads the other end of the index** — so the
FIRST rule a person ever wrote is composed for ever and every save after it reaches the sheet and no
launch. ⚠️ **That is the worse half of `M1`**: the seam is fed, the editor works, the history is
right, and what the agent is told is a rule the person has already replaced.

## ⛔ B · versioned and revertable, which `HO-009` §1.2 makes the SAFETY property

> ⚠️ *"instruction drift — a worker quietly rewriting its own rules because one task went badly —
> and it is unrecoverable because nothing records what the rule used to be."*

🔴 **`M3` makes the allocator reissue the newest number**, and the second save RAISES on the derived
primary key. ⛔ *Never reissued* is a claim {@link OwnInstructionsVersion.version} makes in prose, and
this row is what makes it a database fact: `ins:<slug>:<version>` is the key, so two rows for one
number is a constraint violation rather than a state a reader has to cope with. ⚠️ **The FIRST draft
of this row was `COUNT(*) + 1` and it SURVIVED** — the two expressions agree on a table nothing
deletes, which is `a-comparison-tested-where-both-sides-agree-measures-nothing` bought by the
author of the row. ⚑ It is replaced rather than deleted, because the subject is real.

⛔ **`M4` takes the existence check off the write**, so a person — or an agent's relay — brings an
identity into existence by giving it a rule. ⚑ That is criterion 12 arriving through a fourth
configuration door, and it is the rail `setCapabilities`' `false` and `setAgentDisplayName`'s `null`
already hold on the three before it.

⚠️ **`M5` makes a revert REPLACE rather than append** — by taking `broughtBack` off the row, so the
history no longer records that this text came back and from where. ⛔ *What the rule used to be* is
still there; what is gone is *how it got here*, which is the half `HO-009` §1.2's second sentence is
about.

## 🔴 C · the ladder, and the two questions one field answers

⛔ **`M6` and `M7` are the two halves and each is wrong in a DIFFERENT direction**, which is why both
rows exist. `M6` lets a caller granted `propose` RELAY — the gate `HO-009` §2.2 opens for exactly
one holder, removed by a comparison; `M7` refuses the relay arm to everybody, so the one exception
the ruling makes is unreachable and BroBot's relay is a message again. ⚠️ **A single row on that
`if` would have measured only one of them** — `a-comparison-tested-where-both-sides-agree-measures-
nothing` asked about a ladder instead of about an equality.

⛔ **`M8` turns a refused relay into a silent PROPOSAL.** ⚑ That is the shape this door deliberately
refuses: quietly taking an argument and doing something else with it is `371`'s disclosure defect,
and on this argument the claim IS the authorization — so a model told its relay was accepted would
have been told this app trusted something it did not.

🔴 **`M9` asks the subject before the grant**, which is `refuse-on-entitlement-before-refusing-on-
existence` inverted: a caller with no grant learns which identities exist from the shape of its
refusal.

## ⚠️ D · what the ledger records, and what a person is shown

⛔ **`M10` records a relay as a person's own keystroke.** ⚑ The CHECK refuses the row — a version
written as `a-person` may carry no conversation and no claim — so this one is killed by the database
as well as by the fold, which is what makes the two provenance columns one fact rather than two.

⚠️ **`M11` folds an unreadable provenance to `a-person`**, so a hand-edited row makes this app assert
that the person wrote something he may never have seen. ⛔ 086 in the direction that reassures.

🔴 **`M12` lets a person's own save leave an older ask standing**, so they write their rules and then
approve a proposal on top of them — the act they performed LAST is not the one in force. ⚑
`superseded` exists for exactly this and `ENDING_MEANS` is what tells the asking agent.

⛔ **`M13` lets a blank version render an empty heading**, which is 086 in the other direction: a
bundle carrying `## Your own instructions` with nothing under it tells an agent there is a rule and
does not say what it is.

## ⛔ What this table does NOT cover

 1. **`composeProfileBundle`'s ordering and its factory half.** `377` owns those rows; this dispatch
    changed one heading string and fed one field.
 2. **`requireAPerson` itself.** `349` owns it; the rows here are about what the doors DO once it
    has held, and `the-rails-before-anything-can-reach-them.test.ts` is where the inventory lives.
 3. **`instructionContext`'s `profileSlug === null` arm.** ⚠️ It stops a conversation this app
    cannot NAME being fed a fallback identity's rules — `370`'s inference defect with a person's own
    words as the payload — and **no row here covers it**, because the only way to reach a null
    profile is an ADOPTED row and this dispatch's suite has no adoption harness. ⛔ **Said rather
    than papered over** (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`), and raised as a
    finding in the response.
 4. **The `written === null` line in the relay arm.** ⚠️ It is unreachable while `M9`'s rail holds —
    the identity would have to be removed between two reads inside one synchronous stretch — so no
    mutation on it can change an answer (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
    ⛔ The code says so rather than pretending a row covers it.
"""

SHARED = "apps/desktop/src/shared/own-instructions.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"

MUTATIONS = [
    # ---- A · the seam ---------------------------------------------------------------------------
    (
        "M1 · ⛔ **the seam is not fed** · `HO-073` §2's world restored — a person writes a rule, "
        "saves it, relaunches, and the agent is told nothing",
        [
            (
                HOST,
                "      configured: profileSlug === null ? null : this.deps.store.configuredLayerFor(profileSlug),",
                "      configured: null,",
            )
        ],
    ),
    (
        "M2 · ⚠️ **the launch renders the FIRST rule a person ever wrote, for ever** · `newestOf` "
        "reads the other end of the same index, so every save after the first reaches the sheet and "
        "no launch — which is `HO-073` §2's world with a working editor in front of it",
        [
            (
                STORE,
                "           FROM identity_instruction WHERE identity_id = ? ORDER BY version DESC LIMIT 1`,",
                "           FROM identity_instruction WHERE identity_id = ? ORDER BY version ASC LIMIT 1`,",
            )
        ],
    ),
    # ---- B · versioned and revertable ------------------------------------------------------------
    (
        "M3 · 🔴 **the allocator reissues the newest number** · the second save collides on the "
        "derived primary key and RAISES, which is the row proving that key is what makes *never "
        "reissued* a database fact rather than a sentence in a docblock",
        [
            (
                STORE,
                "        const version = (newest?.version ?? 0) + 1",
                "        const version = newest?.version ?? 1",
            )
        ],
    ),
    (
        "M4 · ⛔ **a rule brings an identity into existence** · criterion 12 arriving through a "
        "fourth configuration door, and the rail `setCapabilities`' `false` already holds on the "
        "three before it",
        # ⚑ **RE-ANCHORED at `625`**: `writeMemoryAmendment` makes the SAME criterion-12 check
        # with the same three lines, so the old anchor matched TWICE and the row went dark.
        # ⛔ **CORRECTED, not retired** — the subject is `writeOwnInstructions`' own existence rail
        # and it has not moved. ⚠️ **Widened with the line that follows it**, which names
        # `ownInstructionSql` and so belongs to this writer and to no other, and re-verified RED by
        # hand (`correct-a-stale-mutation-anchor-dont-retire-it`).
        #
        # 🔴 **The two checks are NOT extracted into one helper, deliberately.** They are the same
        # question asked by two doors, and `extracting-a-shared-guard-exports-its-policy` is what
        # that would cost: this row would then be asking *does ANY writer still refuse* instead of
        # *does this one*, and its verdict would no longer say which door the test caught.
        [
            (
                STORE,
                "        if (spawnSql().identityBySlug.get(foldProfileName(said.profileSlug)) === undefined) {\n"
                "          return null\n"
                "        }\n"
                "        const newest = ownInstructionSql().newestOf.get(rowId) as OwnInstructionRow | undefined\n",
                "        const newest = ownInstructionSql().newestOf.get(rowId) as OwnInstructionRow | undefined\n",
            )
        ],
    ),
    (
        "M5 · ⚠️ **a revert stops saying it is one** · the text comes back and the history no "
        "longer records where from, which is the half `HO-009` §1.2's second sentence is about",
        [
            (
                STORE,
                "          said.broughtBack,\n          at,",
                "          null,\n          at,",
            )
        ],
    ),
    # ---- C · the ladder --------------------------------------------------------------------------
    (
        "M6 · 🔴 **a caller granted `propose` may RELAY** · the gate `HO-009` §2.2 opens for exactly "
        "one holder, removed by a comparison — an agent writes a durable rule with no person in the "
        "loop, on the strength of its own claim",
        [
            (
                HOST,
                "    if (said.relaying && !mayRelayRules(allowed.canWriteRules)) {",
                "    if (false && said.relaying && !mayRelayRules(allowed.canWriteRules)) {",
            )
        ],
    ),
    (
        "M7 · ⛔ **nobody may relay** · the one exception `HO-009` §2.2 makes is unreachable, so "
        "*relayed from user* is a provenance nothing can write and BroBot's relay is a message "
        "again — which is the thing `HO-063` gap 4 exists to stop",
        [
            (
                HOST,
                "    if (said.relaying && !mayRelayRules(allowed.canWriteRules)) {",
                "    if (said.relaying) {",
            )
        ],
    ),
    (
        "M8 · ⛔ **a refused relay becomes a silent proposal** · `371`'s disclosure defect on the "
        "one argument where the claim IS the authorization: a model told its relay was accepted, "
        "about a claim this app decided not to trust",
        [
            (
                HOST,
                "      return no('may-not-relay-a-rule', { you: caller.profileId })\n",
                "      said = { ...said, relaying: false }\n",
            )
        ],
    ),
    (
        "M9 · 🔴 **the subject is asked before the grant** · "
        "`refuse-on-entitlement-before-refusing-on-existence` inverted — a caller with no grant "
        "learns which identities exist from the shape of its refusal",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # refuse-on-entitlement-before-refusing-on-existence still holds: proposeAgentRules asks the
        # grant (may-not-write-rules) before the subject (no-such-agent), and the test 'an identity
        # with NO grant meets the wall before its agent name is looked at' asserts it. The caller
        # lookup is now this.runningAs(me) (spawnFacts(by).liveParent(me) is gone), and the plant
        # inserts the subject-existence check above it. Killed by
        # `the-layer-a-person-writes.test.ts`.
        [
            (HOST, '    const caller = this.runningAs(me)\n    const allowed = caller === null ? null : this.deps.store.capabilitiesOf(caller.profileId)\n    // ⚠️ **`caller === null` is in the SAME condition**', "    const about0 = foldProfileName(said.about)\n    if (this.deps.store.capabilitiesOf(about0) === null) {\n      return no('no-such-agent', { agent: about0 })\n    }\n    const caller = this.runningAs(me)\n    const allowed = caller === null ? null : this.deps.store.capabilitiesOf(caller.profileId)\n    // ⚠️ **`caller === null` is in the SAME condition**"),
        ],
    ),
    # ---- D · what is recorded, and what is shown -------------------------------------------------
    (
        "M10 · ⛔ **a relay is recorded as a person's own keystroke** · killed by the CHECK as well "
        "as by the fold, which is what makes the two provenance columns one fact rather than two",
        [
            (
                HOST,
                "          whoWroteIt: 'relayed-from-user',",
                "          whoWroteIt: 'a-person',",
            )
        ],
    ),
    (
        "M11 · ⚠️ **an unreadable provenance folds to `a-person`** · a hand-edited row makes this "
        "app assert that the person wrote something he may never have seen — 086 in the direction that "
        "reassures",
        [
            (
                STORE,
                "      ? (stored as WhoWroteIt)\n      : 'an-agents-proposal'",
                "      ? (stored as WhoWroteIt)\n      : 'a-person'",
            )
        ],
    ),
    (
        "M12 · 🔴 **a person's own save leaves an older ask standing** · they write their rules and "
        "then approve a proposal on top of them, so the act they performed LAST is not the one in "
        "force",
        [
            (
                HOST,
                "    for (const waiting of this.deps.store.instructionAsksWaiting()) {\n"
                "      if (waiting.asked.about !== foldProfileName(profileSlug)) continue\n"
                "      this.endInstructionAsk(waiting.asked.askId, 'superseded', whoDidIt(by))\n"
                "    }\n",
                "",
            )
        ],
    ),
    (
        "M13 · ⛔ **a blank version renders an empty heading** · 086 in the other direction: the "
        "bundle tells an agent there is a rule and does not say what it is",
        [
            (
                SHARED,
                "  const text = inForce.text.trim()\n  return text === '' ? null : text",
                "  return inForce.text",
            )
        ],
    ),
]
