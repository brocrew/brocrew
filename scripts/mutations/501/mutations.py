"""501 · the caller this app cannot name, recorded as a person — HO-037 §3, repaired at the WRITER.

🔴 **The ruling:** *"Repair `recordTheAsk`. A false actor in a durable record is worse than an
absent one."* ⛔ And `HO-029` §2.2's *do not backfill* was never in the way, because correcting a
known-false value to a known-true one is a repair rather than a fabrication.

## ⛔ The defect, and it was one derivation short

`RuntimeHost.recordTheAsk` wrote `by: speaking === null ? 'a-person' : 'an-agent'` — a NEGATIVE
test over `sessionSpeakingAs` alone, so **every caller that is neither a window nor a conversation
was written down as a person**. ⚑ `477` named that line as the defect inside `whoDidIt`'s own
docblock and deferred the repair on one ground — *"a two-member vocabulary has nowhere honest to
put one"* — which `494` ended by deriving `WhoStoppedIt`.

⚠️ **The row beside it already asked the right question.** `releaseProposalsOf` writes
`proposal_ended` with `by: whoDidIt(by)` from the same caller in the same synchronous stretch, and
its own comment says the two state *"the same fact"*. ⛔ For one kind of caller they did not: two
neighbouring ordinals named two different actors for one act.

## ⚑ What changed, in three places

 1. **The writer asks the one derivation** — `whoDidIt(by)` — and reads the word and the
    conversation off ONE discriminated union instead of two reads of `sessionSpeakingAs`.
 2. **The app is REFUSED rather than re-spelled.** `recordTheAsk` returns without writing when the
    actor is `the-app-itself` — the same opening `mayAnswerAsAHuman` has one producer over, and
    `395`'s own argument for removing the `this-app` member made true instead of claimed.
 3. **The reader stopped restating the vocabulary.** `SessionStore.actorOfTheAsk` decided
    membership with a hand-written `asked.by !== 'a-person' && asked.by !== 'an-agent'`; it asks
    `WHO_STOPPED_IT` now. ⛔ That one would not have gone red — it would have gone QUIET.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M3, M4 | `apps/desktop/test/the-interruption-that-looks-like-a-fault.test.ts` §6 |
| M2 | …the same file's *the APP asks nothing* test, and its paired positive |
| M1, M5 | `apps/desktop/test/state-a-supervisor-can-trust.test.ts` §1 (the reader's own word) |
| M5, M6 | `apps/desktop/test/the-act-this-app-knows-the-author-of.test.ts` §5, off a real store |

## ⛔ What this table deliberately does NOT contain

 - ⛔ **No row on `WorkInterruptedEvent.by`'s TYPE.** Narrowing it back to two words is a
    type-only edit and `vitest` strips types, so the row would record as a survivor and mean
    nothing — `074`'s rule about a guard that is deliberately uncovered. ⚑ The compiler is the
    instrument there, and `typecheck` runs ahead of `test` in the gate.
 - ⛔ **No row on `by: actor.who`.** `395 M6` owns that line and its anchor was CORRECTED IN PLACE
    by this dispatch; a second row on it would be two rows for one defect.
 - ⛔ **No row on the retirement of `WHO_ASKED_IT_TO_STOP`.** A deleted export is a compile error
    in four test files, which is a stronger instrument than a mutation and not a silent one.
 - ⚠️ **No row on the census assertions this dispatch wrote** — a mutation on a census is
    invisible to that census, so the row would measure the tests and not the code.

⛔ **Evidence standard.** Every row was applied ALONE against a byte-exact snapshot, its own killer
file run, and the tree restored and SHA-verified before the next. ⚠️ The table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no driver verdict is claimed here.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

MUTATIONS = [
    # ── §1 · the writer ─────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE WITHDRAWN SPELLING, BACK · the writer stops asking the one derivation and "
        "spells the actor itself again, so a caller this app has no word for is recorded as a "
        "person — `413` §3's dangerous default in a durable row, beside a `proposal_ended` row "
        "that names the same caller correctly",
        [
            (
                HOST,
                "    const actor = whoDidIt(by)\n    if (actor.who === 'the-app-itself') return\n",
                "    const speaking = sessionSpeakingAs(by)\n"
                "    const actor = (\n"
                "      speaking === null ? { who: 'a-person' } : { who: 'an-agent', agent: speaking }\n"
                "    ) as ActedBy\n",
            )
        ],
    ),
    (
        "M2 · ⛔ THE APP IS RECORDED AS AN ASKER · the refusal goes and the teardown writes a row "
        "whose actor `WhoStoppedIt` excludes — the member `395` drafted and removed, arriving "
        "through the door `mayCommand` admits the superuser at",
        [
            (
                HOST,
                "    if (actor.who === 'the-app-itself') return\n",
                "",
            )
        ],
    ),
    (
        "M3 · ⚠️ the refusal is inverted · only the app's own teardowns are written down and every "
        "real ask is dropped, so the one gesture this app records the author of records nobody",
        [
            (
                HOST,
                "    if (actor.who === 'the-app-itself') return\n",
                "    if (actor.who !== 'the-app-itself') return\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the asking CONVERSATION never reaches the row · `by` still says `an-agent` and the "
        "id is gone, so `WorkInterruptedEvent.agent`'s *present if and only if* is broken at the "
        "writer rather than at the reader — `484 M3`'s defect one side over",
        [
            (
                HOST,
                "      ...(actor.who === 'an-agent' ? { agent: actor.agent } : {}),\n",
                "",
            )
        ],
    ),
    # ── §2 · the reader that restated the vocabulary ────────────────────────────────────────────
    (
        "M5 · 🔴 THE HAND-WRITTEN PAIR, BACK · the store decides membership with the event's OLD "
        "two words, so the writer's third one is dropped and `AgentCard.lastAskToStop` answers "
        "*nobody asked* about an ask this app recorded — the quiet half of this dispatch",
        [
            (
                STORE,
                "    if (!(WHO_STOPPED_IT as readonly unknown[]).includes(asked.by)) return null\n",
                "    if (asked.by !== 'a-person' && asked.by !== 'an-agent') return null\n",
            )
        ],
    ),
    (
        "M6 · ⚠️ the ledger boundary is removed · a word from a build whose vocabulary has moved "
        "is reported as an actor instead of dropped, which is `isWhoDidIt`'s rule broken on the "
        "flat producer — the surface then prints a word this build has no sentence for",
        [
            (
                STORE,
                "    if (!(WHO_STOPPED_IT as readonly unknown[]).includes(asked.by)) return null\n",
                "",
            )
        ],
    ),
]
