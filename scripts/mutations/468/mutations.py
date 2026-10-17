"""468 · The press that shows nothing for five seconds — and what was actually in them.

⛔ **`453` weak point 1 is real and the brief's reading of it is not.** §9.5 pins *"a row settled
here is still in the view until a look says otherwise"* — with `settle: () => {}`, a stub, so
nothing it drives ever reaches the store. What it measures is that the module holds no
dismissed-list. ⚑ **The shipped app answers the press in ONE TICK**: `markSent` writes the record's
draft flag before the first await, `attentionQueue` reads it, and `207` M2's branch replaces the
buttons with *"An answer is already on its way"*.

## 🔴 The three phases of one press, and two of them were broken

| when | what the row did | rows |
|---|---|---|
| the click, same tick | correct since `207` M2 — and never asserted as a SIGHT | `M3` |
| the host answers, and the card here closes | ⛔ *"open it to answer"*, about a card answered from that row | `M1`, `M2`, `M4`-`M7` |
| the host answers · `refused` + `stillOpen` | ⛔ the buttons came back and said nothing | `M8`-`M10` |
| the badge nothing could clear | ⛔ a **NEEDS YOU** that can never reach zero | `M11`-`M14` |

⚠️ **The middle phase is the bulk of the five seconds.** The host publishes `user_decision`, the
record's fold closes the item, `isAwaitingAnswer` goes false, the request leaves `attentionQueue` —
and a row for a conversation this window HOLDS fell into `'not-in-this-window'`. 🔴 **A false
instruction is worse than silence**, and that is the sentence a person read for four-and-a-half of
the five seconds.

## ⛔ What this table deliberately does NOT contain

⚠️ **No row restoring an immediate second look after a press** (the brief's option B). It is not in
the code: the ledger stays the only authority on when a row LEAVES, and every row below is about
what the row SAYS while it is still there. ⛔ A row for code that was not written would report as a
survivor.

⚠️ **No row on `LOOK_EVERY_MS`.** `401` M10 anchors on that exact line and the cadence is derived
from `ESCALATION_WINDOW_MS`, not chosen — shortening it is refused by the brief and by the
constant's own docblock.

⚠️ **No row restoring the `sent` read this dispatch started with.** `answeredFromHere` reads
`RequestDraft.answered`, and the first draft read `sent` — which `noteAnswer` clears on every
failure, so a refusal that CLOSED a card took its key back out at the moment the card became
unanswerable and the row drew *"open it to answer"* over it. ⛔ `M7` is that row, spelled as the
widening rather than as the narrowing, because `if (true)` is the shape a reader can check against
the line beside it; a row swapping one field name for another would pass `table_contract` and read
as a rename.

⛔ **No row on the two doors' discarded `AnswerAck`.** `RuntimeBridge` answers one for all three
doors and the renderer store spends two of them on the card; `468` deliberately did NOT widen them,
because the item already carries the half a surface needs and a second path to one fact is a second
derivation free to disagree. That is a FINDING in the response, not a change, so there is nothing
here to mutate.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M4`, `M10` | ⚑ **`apps/desktop/test/dom/persons-queue.dom.test.ts`** §12 — what a person READS |
| `M1`, `M2`, `M3` | ⚑ **`apps/desktop/test/the-press-that-shows-nothing.test.ts`** §2 |
| `M5`, `M6`, `M7` | ⚑ **`apps/desktop/test/the-press-that-shows-nothing.test.ts`** §3 |
| `M8`, `M9` | ⚑ **`apps/desktop/test/the-press-that-shows-nothing.test.ts`** §4 |
| `M11`-`M14` | ⚑ **`apps/desktop/test/home-attention.test.ts`** and `the-press-that-shows-nothing.test.ts` §5 |
| `M15` | ⚑ **`apps/desktop/test/the-press-that-shows-nothing.test.ts`** §6 — the wiring, read as source |

⚠️ **The first draft of this table filed the projection's row under the DOM file, which imports
`AttentionRequest` as a type and never calls `attentionQueue`** — so the gate named for it could
not have seen it. ⛔ A gate map is a claim like any other and this one was wrong; found by this
dispatch's own review, which also found that the row was `M8`'s defect one hop upstream:
`AttentionRequest.refused` has exactly one consumer, so severing the producer and severing the
consumer are the same sentence disappearing. ⚑ **It was removed rather than re-anchored**, and the
row that took its number is the one decision in this diff that had an argument written for it and
no way to be wrong.
"""

QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
ATTENTION = "apps/desktop/src/renderer/src/lib/attention.ts"
CARD = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
HOME = "apps/desktop/src/renderer/src/lib/home-attention.ts"

MUTATIONS = [
    # ── §1 · the fifth member, and the sentence it replaced ─────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · the window's own answer stops being read, so a card this "
        "person answered from this row falls back to *not-in-this-window* — *\"open it to answer\"*, "
        "about a card that is over. ⛔ A false instruction for four of the five seconds",
        [
            (
                QUEUE,
                "            noAnswerHere: world.answeredFromHere.has(key)\n",
                "            noAnswerHere: false\n",
            )
        ],
    ),
    (
        "M2 · ⛔ every absent card reads as one this window answered · a card paged out of the "
        "window it belongs to — `106`'s own reachable case — is reported as settled, so a person is "
        "told to wait for a list to catch up with a press nobody made",
        [
            (
                QUEUE,
                "            noAnswerHere: world.answeredFromHere.has(key)\n",
                "            noAnswerHere: true\n",
            )
        ],
    ),
    (
        "M3 · 🔴 `207` M2's sentence is REPLACED rather than kept · the instant a person presses, a "
        "card that is still waiting is drawn as one that is over — *\"this list has not caught up\"* "
        "about a request the provider is still frozen on, and nothing says an answer is on its way",
        # ⚠️ **Aimed at the arm the press actually lands in**, and the first draft was not: it added
        # a disjunct to `live === undefined`, and every case in §2 already passes an empty live
        # projection, so the gate named for it could not see the row at all.
        [
            (
                QUEUE,
                "            { answers: [], limit: live.limit, noAnswerHere: 'answer-sent' }",
                "            { answers: [], limit: live.limit, noAnswerHere: 'no-longer-waiting' }",
            )
        ],
    ),
    (
        "M4 · 🔴 the sentence for it becomes the sentence it replaced · the vocabulary keeps five "
        "members and two of them say the same thing, which is `106`'s one shrug over four states "
        "with a fifth added to it",
        [
            (
                CARD,
                # ⛔ **619 · ANCHOR CORRECTED, not retired.** The sentence named a CARD and `619`
                # made a row with none reach this arm, so standing rule 8.1's sweep rewrote it.
                # ⚑ The row's SUBJECT is unchanged — *two members saying the same thing* — and it
                # was re-verified RED against the corrected anchor.
                "  'no-longer-waiting': 'That was answered from this window — this list has not caught up yet.',",
                "  'no-longer-waiting':\n"
                "    'This window holds that conversation and its card is not in the part on screen — open it to answer.',",
            )
        ],
    ),
    (
        "M5 · ⛔ the key loses its conversation · `answeredFromHere` is keyed on the request id "
        "alone, so a press in one conversation reports a row in ANOTHER as settled — the collision "
        "`itemKey` hardens against one file over, arriving through a set instead",
        [
            (
                ATTENTION,
                "      if (draft.answered) keys.add(`${record.sessionId}:${requestId}`)",
                "      if (draft.answered) keys.add(requestId)",
            )
        ],
    ),
    (
        "M6 · 🔴 the set stops being a READ · nothing is ever in it, so the branch is unreachable "
        "and the row goes back to the false sentence — the same defect as `M1` through the "
        "derivation rather than through the fold, which is what makes the extraction worth having",
        [(ATTENTION, "      if (draft.answered) keys.add(", "      if (false) keys.add(")],
    ),
    (
        "M7 · ⛔ every draft counts rather than the ANSWERED ones · a request a person merely typed "
        "into, and one the window holds and has never touched, are both reported as settled — so a "
        "card genuinely paged out of the window's own transcript reads *this list has not caught "
        "up* instead of naming the way in",
        [(ATTENTION, "      if (draft.answered) keys.add(", "      if (true) keys.add(")],
    ),
    (
        "M15 · 🔴 the derivation never reaches the running app · the one line that hands the set to "
        "the queue stops handing it, so every surface a PERSON sees goes back to *open it to "
        "answer* while every test in the suite passes — the shape `468`'s own review found "
        "unguarded, because nothing but `App.vue` mounts this screen",
        [
            (
                SCREEN,
                "      answeredFromHere: answered.value,",
                "      answeredFromHere: new Set<string>(),",
            )
        ],
    ),
    # ── §2 · the answer that bounced ────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 THE SECOND DEFECT, restored · the row stops carrying the refusal, so a person "
        "presses Allow, watches four controls vanish and come back, and is told nothing — while "
        "the host's own sentence sits on a card three surfaces away",
        [(QUEUE, "      refused: live?.refused ?? null,", "      refused: null,")],
    ),
    (
        "M9 · ⚠️ the refusal is drawn as LOUD as the summons · `.pq-refused` loses the weight the "
        "card it came from uses, so an account of a failed press reads like a second thing waiting "
        "on a person — and on the overlay copy, where `--waiting` is a near-black, `PersonsQueue`'s "
        "own docblock says what that costs",
        [
            (
                CARD,
                ".pq-refused {\n  color: var(--muted);",
                ".pq-refused {\n  color: var(--waiting-text-label);",
            )
        ],
    ),
    (
        "M10 · ⚠️ the refusal is drawn only where there are NO answers · which is every case but "
        "the one it is for: `noteAnswer` puts the request back on the table precisely when the card "
        "is still answerable, so the buttons are there and the reason is hidden behind them",
        [
            (
                CARD,
                '          <p v-if="row.refused" class="pq-refused"',
                '          <p v-if="row.refused && row.answers.length === 0" class="pq-refused"',
            )
        ],
    ),
    # ── §3 · the badge nothing could clear ──────────────────────────────────────────────────────
    (
        "M11 · 🔴 `453` WEAK POINT 3, restored · the seeded placeholders go back into the number a "
        "person reads as work, so NEEDS YOU is permanently non-zero and permanently amber on a "
        "seeded install — and the person's install is seeded",
        [(HOME, "  const total = live + onlyYou", "  const total = live + seeded + onlyYou")],
    ),
    (
        "M12 · ⛔ the same defect through `quiet` rather than through the total · the stat reads "
        "*Not known* over a screen that knows exactly what is on it, which is `086`'s disclosure "
        "spent on a state that is not a hole",
        [
            (
                HOME,
                "  const quiet = total === 0 && !unread",
                "  const quiet = total === 0 && !unread && seeded === 0",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row planted the removal of the
        # placeholder disclosure sentence in `home-attention.ts`. D-016 says 'Proposals go end to
        # end, with the demo seed, the renderer fixtures'. `seeded`, `placeholders` and
        # `andThePlaceholders` no longer exist in that file, so the seeded rows the sentence
        # disclosed are gone. Its anchor is left stale, so the census records it retired.
        "M13 · 🔴 `403`'s defect, repeated in the arm `468` ADDED · the placeholder sentence stops "
        "riding into the quiet arm, so a person reads *\"nothing needs you\"* over four amber rows "
        "with nothing anywhere saying what they are — which is `304` reopened by the dispatch that "
        "quoted the warning",
        [
            (
                HOME,
                "  const andThePlaceholders = seeded === 0 ? '' : ` ${placeholders}`",
                "  const andThePlaceholders = ''",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row planted the loss of the gate
        # on the placeholder disclosure (`seeded === 0`). The seed and its disclosure went with
        # 'Proposals go end to end, with the demo seed, the renderer fixtures' in bd70d693. There is
        # no seeded count left to gate on, so the 'The 0 project decisions below are seeded
        # placeholders' sentence cannot be produced. Its anchor is left stale, so the census records
        # it retired.
        "M14 · ⚠️ the disclosure loses its own gate · an install with no seed at all is told that "
        "*\"The 0 project decisions below are seeded placeholders\"*, which is a sentence about rows "
        "that are not there — `106` from the other side, on the one screen that is supposed to be "
        "quiet when nothing is happening",
        [
            (
                HOME,
                "  const andThePlaceholders = seeded === 0 ? '' : ` ${placeholders}`",
                "  const andThePlaceholders = ` ${placeholders}`",
            )
        ],
    ),
]
