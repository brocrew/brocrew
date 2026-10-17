"""632 · A child's state, which 547 F1 refused to guess — each row is THE DEFECT, put back (131).

⛔ **What 632 fixed, in one sentence.** `547` F1 declined to put a status on a child card because
{@link SpawnEdge} carries `running` and not `status`, and those answer different questions — so
every conversation on the Working Together band drew `081`'s faceless ring. ⚑ `575` and `593` built
the missing fact three weeks later and two other bands have drawn plates from it since; this is the
third caller, and it composes nothing of its own.

| rows | what they are |
|---|---|
| `M1`-`M3` | 🔴 **the read** — the row dropped, the wrong row taken, and the refusal keeping a refinement it must drop |
| `M4`-`M6` | ⛔ **the withholding** — the one decision `whatAPlateCanDraw` makes, undone three ways |
| `M7`-`M9` | ⚑ **the two absences** — a recipient card given a state, the parent losing its own, and the map built per card |
| `M10`-`M11` | ⚠️ **the word and its age** — a second derivation, and an age with no line to date |

## ⛔ What this table cannot reach, said out loud

⚠️ **No row mutates `what-is-being-done.ts` or `agent-state.ts`.** `575`, `588` and `593` own those
and their own tables measure them; a row here would be measuring somebody else's work, and
`whatAPlateCanDraw`'s withholding is pinned by `what-each-agent-is-doing.test.ts`.

⚠️ **No row covers `621`'s wait.** ⛔ This dispatch deliberately does not carry
`whatEachConversationIsWaitingOn` onto a plate — `621` §5.2 ruled that `waiting-on-a-worker` asks
nobody for anything, so mapping it onto `Needing` would draw an amber *needs you* on a conversation
nobody is waiting on. ⚑ A row for a thing that was not built is a row that measures nothing.

⚠️ **No row makes `nothing-has-arrived` arrive from a real launch.** It is the interval between a
registration and the first event, which no fixture holds deterministically; the suite replaces that
ONE row of a real reading and says so, and `M4` is what kills a band that stopped inheriting the
decision.
"""

BAND = "apps/desktop/src/renderer/src/lib/working-together.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

MUTATIONS = [
    # ── the read ──────────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **MAIN'S BEHAVIOUR BEFORE 632, PUT BACK** · the reading carries no doing words at "
        "all, so every child draws the faceless ring however much this app knows. ⛔ `547` F1's "
        "state, which the person asked about twice",
        [
            (
                SCREEN,
                "    cast.reading.value = { ...reading, atWork: doing }",
                "    cast.reading.value = { ...reading, atWork: null }",
            )
        ],
    ),
    (
        "M2 · ⛔ a REFUSED read keeps the doing words it was told to drop, so a kept card wears a "
        "tool name from a minute ago. ⚠️ `beingDone`'s own rule broken: a refinement is not a list, "
        "and stale is worse than absent here",
        [
            (
                SCREEN,
                "      ? { ...cast.reading.value, answered: false, atWork: null }",
                "      ? { ...cast.reading.value, answered: false }",
            )
        ],
    ),
    (
        "M3 · ⚠️ the two reads go in SERIES, so a whole IPC round trip lands between the cards and "
        "the words they wear. ⛔ `588`'s argument one surface over — a band whose halves were read a "
        "round trip apart draws an age true of only one of them",
        # Start the activity request only after the relationship read returns.
        [
            (SCREEN, 'const doingPending = store.whatIsBeingDone()', 'const doingPending = answerPending.then(() => store.whatIsBeingDone())'),
        ],
    ),
    # ── the withholding ───────────────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 the recorded status is read STRAIGHT off the row, so `whatAPlateCanDraw`'s one "
        "decision is skipped. ⛔ A conversation this app has been told NOTHING about then draws "
        "`idle` — `a-door-that-answers-before-it-can-know`, and the exact sentence `HO-095` §5.1 and "
        "`EXT-014` §5 misled the person with an hour apart",
        [
            (
                BAND,
                "  const plate = atWork === null ? null : whatAPlateCanDraw(atWork, atWork.status)",
                "  const plate =\n"
                "    atWork === null\n"
                "      ? null\n"
                "      : { status: atWork.status, activity: activityOf(atWork.told), streaming: atWork.streaming }",
            )
        ],
    ),
    (
        "M5 · ⛔ a band with NO reading falls back to `idle` instead of saying nothing, so a cold "
        "window and a refused read both claim every child is idle. ⚑ The faceless ring is `099` §3's "
        "own answer to *no word from the host* and this deletes it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule holds: a card
        # with no reading must stay faceless (`unknown`), not fall back to `idle`. `plateOf` now
        # takes `nothingRunsIt` and only says `idle` for a conversation the host reports as not
        # running, and the plant makes the fallback unconditional, so a cold window, a withheld
        # status and the never-read recipient all draw `idle` again.
        [
            (BAND, "    status: plate?.status ?? (nothingRunsIt ? ('idle' as const) : null),", "    status: plate?.status ?? 'idle',"),
        ],
    ),
    (
        "M6 · ⚠️ the streaming flag is dropped, so a child whose model is mid-reply draws the tool "
        "it finished with. ⛔ `089`'s defect exactly — *\"running Bash\"* printed into the middle of "
        "the answer — reintroduced at a band that never had it",
        [
            (
                BAND,
                "    streaming: plate?.streaming ?? false,",
                "    streaming: false,",
            )
        ],
    ),
    # ── the two absences ──────────────────────────────────────────────────────────────────────
    (
        "M7 · ⛔ a RECIPIENT card claims to be WORKING, so a conversation the spawn walk never read "
        "acquires a state from a read that was not about it. ⚠️ `547`'s rule: *inventing a `running` "
        "for it would be this band answering a question the read did not ask*",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule holds:
        # `recipientCard` (a conversation the spawn walk never read) must carry no state of its own.
        # `plateOf`'s signature lost its `running` flag, so the plant now writes the WORKING claim
        # directly into the card: a `working` facet set through `sessionFacets` and a `working`
        # ActivityLine, which is what the old `plateOf(true, ...)` plus line did. Both edits
        # together give the card a state the read was not about.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: `recipientCard` is built from a work edge alone and must carry no state, because no
        # session row was read for it. Edit 1 is unchanged. Edit 2's anchor lost `since: null,` when
        # D-016 dropped `since` and `reason` from `CastCard`, so it now anchors on the two surviving
        # fields plus `work,`. Killed by `a-childs-state.test.ts`.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — Half the row survives: a recipient card (a conversation the spawn walk never
        # read) must wear the faceless plate and not claim a state from a read that was not about
        # it. b8782af0 removed `doing` and `doingSince`, so only the plate edit remains (`facets:
        # plateOf(false, null)`). a-childs-state.test.ts asserts `outsider.facets.doing` is
        # `unknown` for the planted work edge; a plate built from status `working` reads `working`.
        # Killed by `a-childs-state.test.ts`.
        [
            (BAND, '    facets: plateOf(false, null),', "    facets: sessionFacets({ phase: null, status: 'working', activity: null, streaming: false, liveness: null }),"),
        ],
    ),
    (
        "M8 · ⚑ the PARENT card loses its state, so the big avatar goes back to the faceless ring "
        "while every child below it wears one. ⛔ the person's sentence names the big avatar first, and "
        "a band where only half the rows can speak is the half-fix `547` already shipped · killed by `a-childs-state.test.ts` (named by W4.78)",
                # 631 · ⚑ **the parent's card moved into `parentCardOf`** — `SessionPanel` draws
                # that same card above the big avatar, so the fold and the panel share ONE
                # derivation. ⛔ The row's claim is unchanged: strip `atWork` and the parent loses
                # its state. ⚠️ Anchor corrected, row re-verified RED.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rule survives: the PARENT card must wear a plate too, which `parentCardOf`
        # still builds (the panel draws it as the way up). b8782af0 dropped the relation and
        # `readAt` arguments, so the call is now `cardOf(read.parent, input, [], atWork)`.
        # a-childs-state.test.ts asserts the parent's `facets.doing` is `idle`; with a null reading
        # and a running parent the plate reads `unknown`. Killed by `a-childs-state.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — cardOf lost its `work` argument when beeac349 removed the given-out lines; the parent card's atWork is now the third argument.
            (BAND, "  return cardOf(read.parent, input, atWork)\n", "  return cardOf(read.parent, input, null)\n"),
        ],
    ),
    (
        "M9 · 🔴 the reading is keyed by IDENTITY instead of by conversation, so two conversations "
        "of one identity collide and a child wears its sibling's state. ⛔ `547`'s own rule at the "
        "top of this file: *a card is a CONVERSATION, not an identity* — and `543` §0 plants exactly "
        "that case",
        [
            (
                # 631 · ⚑ **the derivation was written TWICE and is now `atWorkOf`** — the view
                # and `parentCardOf` both need it, and two matching lines protect neither.
                # ⛔ The row's claim is unchanged: key by identity and two conversations of one
                # identity collide. ⚠️ Anchor corrected, row re-verified RED.
                BAND,
                "  return reading.atWork === null ? null : byConversation(reading.atWork)",
                "  return reading.atWork === null\n"
                "    ? null\n"
                "    : new Map(reading.atWork.conversations.map((one) => [one.identity, one]))",
            )
        ],
    ),
    # ── the word and its age ──────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):**
        # b8782af0: "Out: CastCard's `elsewhere`, `says`, `relation`, `because`, `provider`, `doing`
        # and `doingSince`". `plateOf` now returns only the facets, with no `activityLine` call, so
        # the card has no line for a second input object to disagree with. Its anchor is left stale,
        # so the census records it retired.
        "M10 · 🔴 the word is derived from its OWN object rather than from the one the plate is "
        "built from, so a card's face and its line can disagree about one conversation. ⛔ `089`'s "
        "defect at its source, and `project-roster.ts`' rule is *ONE input object feeds both*",
        [
            (
                BAND,
                "  const doing = activityLine(told)",
                "  const doing = activityLine({ ...told, streaming: false })",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-029, D-036, D-031 and D-039 through 7d54be3b):** b8782af0
        # removed the field on purpose: "Out: CastCard's ... `doing` and `doingSince`", and the
        # `agoWords` age with them. There is no `doingSince` left to write for a card with no line.
        # Its anchor is left stale, so the census records it retired.
        "M11 · ⚠️ the age is written whenever there is a reading, so a card with no line still "
        "carries a `doingSince`. ⛔ An age for a thing that is not being said is a field a later "
        "reader trusts — and `547`'s own `asOf` is the shape that rule comes from",
        [
            (
                BAND,
                "    doingSince: doing === null || atWork === null ? null : agoWords(atWork.since, at),",
                "    doingSince: atWork === null ? null : agoWords(atWork.since, at),",
            )
        ],
    ),
]
