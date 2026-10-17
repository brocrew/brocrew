"""619 · answer it where you were told.

⛔ **`HO-093` §3.1, `HO-082` repair 2** — and the defect is the person's own sentence:

> ⛔ ***"it says I need to approve something but there is nothing to approve"***

⚑ **`589` measured him following that instruction and finding nothing.** A question
`ask_question` raised draws no card — `transcript.ts` folds `question_asked` into a notice —
so `attentionQueue` makes no item, `world.answerable` never holds one, and the one surface that
listed the row could offer nothing but a sentence saying why it could not be answered.

## 🔴 What this dispatch changed, in one line

⚑ **The asker's own choices, which were already in the asker's own ledger, now reach the row and
are pressed there** — through `RuntimeHost.respondUserInput`'s held branch, which has been the
person's door for an app-held question since `437` and had no caller.

## ⛔ Five claims, and a table pushed on one would pass a repair that traded another

 1. **The FOLD refuses three things and offers one** (M1–M5). ⚠️ A read that missed, a provider's
    question, and a shape `AttentionLimit` already rules out — `multiple` and `free-form`.
 2. **The LADDER splits on the offer, above the window** (M6–M7). 🔴 A question with nothing to
    press says so whether or not anybody holds it, because a take-over would not put a button on
    it.
 3. **The four conditions on a pressable row** (M8–M9). ⛔ `held` is *may this window answer at
    all*; `answeredFromHere` is *has it already*, and it is the whole of the once-only guard.
 4. **The PAYLOAD is what the button says** (M10–M11, M13). ⚠️ The label is both the word and the
    value, the part is the asker's, and the DOOR is chosen by a fact on the row.
 5. **The WORDS** (M14–M16). ⚑ Two sentences rewritten and one button widened, each read where a
    person reads it.

## 🔴 The one a reader should look at first

⛔ **M9 takes `answeredFromHere` out of the gate** and nothing about it looks wrong: every button
still works, every sentence is still true, and the only thing that changes is that the row keeps
four live controls for the five seconds between the press and the next ledger walk. ⚑ **The
worker is then handed one question's answer twice** — `591 M6`'s shape, arriving through a
surface instead of through a promise — because `RuntimeHost.respondUserInput`'s held branch asks
completeness and ownership and does not ask whether it has already answered.

## ⛔ What this table does NOT cover, said out loud

 1. **The ladder's four inherited arms** — `scripts/mutations/434` and `602` own them, and their
    four anchors were CORRECTED in place by this dispatch rather than retired
    (`correct-a-stale-mutation-anchor-dont-retire-it`): `434 M6`, `434 M7`, `602 M8`, `602 M9`,
    plus `602 M17`'s sentence and `468 M4`'s.
 2. **The null-prototype map in `settleFromTheQueue`.** ⚠️ `Object.create(null)` → `{}` is a
    row this dispatch deliberately does NOT have: the key is `__proto__` only for a passed-up
    question whose ORIGINAL provider minted that id, and no fixture in this repository can build
    one — `a-mutation-that-changes-nothing-reports-as-a-survivor` with the change real and the
    observation impossible. ⛔ The guard is `146`'s and is written for the same reason
    `RuntimeHost.answerQuestion` writes it.
 3. **`transcript.ts`'s notice.** ⚑ `602`'s ruling, untouched: this dispatch adds an answer path
    in the QUEUE and invents no card.
 4. **The legacy bare-string option.** ⚠️ `userInputOptionSchema` carries a string arm for rows
    written before `143`, and `questionsRaisedInSession` CASTS rather than parses — so a
    passed-up question copied from a pre-`143` `user_input_request` could in principle carry one.
    ⛔ No row, because no such request can still be open: `settleStrandedRequests` closes every
    open routing at construction, and `143` predates every `question_asked` row this app has ever
    written. ⚑ A guard nothing can reach is `a-line-no-mutation-can-kill-is-not-carrying-its-rule`.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1–M5 | `apps/desktop/test/answer-it-where-you-were-told.test.ts` §1 · the fold, each refusal as the same call one fact over |
| M6–M9 | `…/answer-it-where-you-were-told.test.ts` §2 and §3 · the ladder, the gate and the once-only press |
| M10 | `…/answer-it-where-you-were-told.test.ts` §2 · and `test/dom/answer-it-where-you-were-told.dom.test.ts` §1, where the press is read off a real button |
| M11 | `…/answer-it-where-you-were-told.test.ts` §2 · *the row carries the offer itself*, which is the field the door reads and nothing else can see |
| M12 | `apps/desktop/test/a-question-a-worker-can-ask.test.ts` · a person's one-string answer, reaching the worker as a word |
| M13 | `apps/desktop/test/persons-queue.test.ts` · the shell census, re-aimed by this dispatch |
| M14–M16 | `test/dom/answer-it-where-you-were-told.dom.test.ts` §1–§3 · the words and the button, read where a person reads them |
| M17 | `apps/desktop/test/a-question-a-worker-can-ask.test.ts` · the whole hop, from the verb's argument to the row |

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit and hashed —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver** (the person, 2026-09-04), so `CENSUS.md` records it `unrun` and no verdict is claimed
here. ⚑ **Each red was checked for the RIGHT reason**: the runner's output was searched for
`SyntaxError`, `Transform failed` and `error TS`, because a row red on a parse error measured
nothing (`452 M8`).
"""

SHARED = "apps/desktop/src/shared/questions.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
CARD = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
QUESTION_CARD = "apps/desktop/src/renderer/src/lib/question-card.ts"

MUTATIONS = [
    (
        "M1 · ⛔ a PROVIDER's question is offered here too · the card that already offers it and "
        "this row both compose an answer, which is `214 §3`'s defect — two surfaces deciding what "
        "one request offers — and the queue's copy is the one with no live row behind it",
        [
            (
                SHARED,
                "  if (raised.raisedBy !== 'this-app') return null\n",
                "",
            ),
        ],
    ),
    (
        "M2 · ⚠️ a question of MANY parts offers its first one · `AttentionLimit`'s `'multiple'` "
        "says why that is not an answer — *one click cannot answer two, and answering one is not "
        "an answer* — and a passed-up question carrying a provider's parts is how it arrives",
        [
            (
                SHARED,
                "  if (raised.questions.length !== 1) return null\n",
                "",
            ),
        ],
    ),
    (
        "M3 · 🔴 a FREE-FORM question grows buttons with no labels on them · `AttentionLimit`'s "
        "`'free-form'` — *no options at all, so there is nothing to click; the answer is typed* — "
        "and the row then draws an empty control block instead of saying why there is none",
        [
            (
                SHARED,
                "  if (options.length === 0) return null\n",
                "",
            ),
        ],
    ),
    (
        "M4 · ⚠️ an empty label becomes a button · `ask_question` bounds the options' total LENGTH "
        "and refuses nothing for being empty, so a model may offer a choice with no word on it — "
        "`106`'s control that cannot say what it does",
        [
            (
                SHARED,
                ".filter((label) => label !== '')",
                "",
            ),
        ],
    ),
    (
        "M5 · ⛔ the part is SPELLED instead of read · every answer is filed under `answer`, which "
        "is right for a question this app composed and wrong for one passed up from a provider "
        "that named its own ids — and `respondUserInput`'s completeness rail then refuses it as "
        "*no answer was given for …*",
        [
            (
                SHARED,
                "  return { part: part.id, options }",
                "  return { part: 'answer', options }",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The ternary `card === 'was-never-drawn'
        # ? offered === null ? 'no-card-was-drawn' : 'take-it-over-to-answer' : …` is gone. D-017 R6
        # deliberately removed the offered-gated split at this site: an app-raised question with
        # options now goes through the new `pressableHere` branch (buttons drawn directly, bypassing
        # this arm), and 'take-it-over-to-answer' was retired outright ('the host now finds the
        # question in the asker's LEDGER…so there is no gesture to name',
        # answer-it-where-you-were-told.test.ts §3). The reachable set is now exactly
        # ['no-card-was-drawn','no-longer-waiting'], pinned by that test's §4. Its anchor is left
        # stale, so the census records it retired.
        "M6 · 🔴 the cardless arm stops splitting · a question with choices on it is told there is "
        "nothing to press and nobody to press it, which is `589`'s row with the repair removed "
        "and every other sentence still true",
        [
            (
                QUEUE,
                "                : card === 'was-never-drawn'\n"
                "                  ? offered === null\n"
                "                    ? 'no-card-was-drawn'\n"
                "                    : 'take-it-over-to-answer'\n",
                "                : card === 'was-never-drawn'\n"
                "                  ? offered === null\n"
                "                    ? 'no-card-was-drawn'\n"
                "                    : 'no-card-was-drawn'\n",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Same removed ternary as M6 (the
        # offered-based split between 'no-card-was-drawn' and 'take-it-over-to-answer' inside the
        # was-never-drawn arm). D-017 R6 deleted 'take-it-over-to-answer' as a value entirely and
        # moved the offered-with-options case to the new `pressableHere` gate, so there is no longer
        # a split here to invert. Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ the split is INVERTED · a free-form question offers a take-over that would change "
        "nothing, and a question with choices is told there is nothing to press — both sentences "
        "are grammatical and both are the wrong one",
        [
            (
                QUEUE,
                "                  ? offered === null\n"
                "                    ? 'no-card-was-drawn'\n"
                "                    : 'take-it-over-to-answer'\n",
                "                  ? offered === null\n"
                "                    ? 'take-it-over-to-answer'\n"
                "                    : 'no-card-was-drawn'\n",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The mutation's 'new' text — dropping
        # `held &&` from the pressableHere gate — is exactly what today's code already does: `live
        # === undefined && offered !== null && !world.answeredFromHere.has(key)`. D-017 R6
        # explicitly rules 'whether this window HOLDS the asker is no longer asked' (comment at
        # persons-queue.ts:1615-1618, and answer-it-where-you-were-told.test.ts §3 'nobody holding
        # it draws the answers here too — no take-over first'). The row's defect is now the shipped
        # decision. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 the gate stops asking whether this window HOLDS it · buttons are drawn on a row "
        "`requireToAnswer` will refuse by name, so the press fails and the row says nothing about "
        "why — `106` on a control that looked live and was not",
        [
            (
                QUEUE,
                "      live === undefined && held && offered !== null && !world.answeredFromHere.has(key)",
                "      live === undefined && offered !== null && !world.answeredFromHere.has(key)",
            ),
        ],
    ),
    (
        "M9 · 🔴 **the once-only guard goes** · the row keeps four live controls for the five "
        "seconds between the press and the next ledger walk, and `RuntimeHost.respondUserInput`'s "
        "held branch asks completeness and ownership and never asks whether it has already "
        "answered — so a second press hands the worker one question's answer twice. ⛔ `591 M6`'s "
        "shape, arriving through a surface instead of through a promise",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The once-only guard
        # `!world.answeredFromHere.has(key)` still guards `pressableHere`; only the co-located `held
        # &&` clause (M8's subject) was removed by D-017 R6. Re-anchored to the current expression
        # with `held` gone and the same guard dropped.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # UI-009 (bb5b9b7e) replaced the queue's own buttons (`pressableHere`) with QuestionCard,
        # but the once-only rule survives: `answeredFromHere` is still read per row, now as
        # `question.sent`, and `questionOnTheQueue` turns it into the *answer sent* state so a
        # second press is not offered. The plant forces `sent` false, so the card stays open for the
        # five seconds before the next ledger walk. Killed by
        # `answer-it-where-you-were-told.test.ts`.
        [
            (QUEUE, '            sent: world.answeredFromHere.has(key),', '            sent: false,'),
        ],
    ),
    (
        "M10 · ⛔ the button sends the PART instead of the label · `answerToForward` matches a sent "
        "answer against the option's own label, so every press is refused as *not one of the "
        "responses this request offers* — and the word on the button is still right",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # `pressableHere` and the queue's own buttons are gone; a press now goes through
        # `oneAnswer(part, label)` in lib/question-card.ts, filed under the asker's part. The rule
        # (the label is both the word and the payload, or `answerToForward` refuses it) is pinned by
        # the re-pointed test 'each press files the label it shows under the asker's part'. The
        # plant sends the part id instead of the label. Killed by
        # `answer-it-where-you-were-told.test.ts`, `answer-it-where-you-were-told.dom.test.ts`.
        [
            (QUESTION_CARD, '  answers[part.id] = [`${label}`]\n', '  answers[part.id] = [`${part.id}`]\n'),
        ],
    ),
    (
        "M11 · 🔴 the row drops the offer and keeps the buttons · the queue draws perfectly and "
        "every press goes down the PROVIDER branch, where `needsYou` holds nothing for it and the "
        "person is told *that card is no longer on this window* — a defect invisible to every "
        "assertion about what is drawn",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The `offered` field is
        # still carried whole and unconditionally into the row (persons-queue.ts, right after
        # `noAnswerHere: settling.noAnswerHere…`), and it is still what drives `pressableHere`'s
        # buttons — only the comment beside it (previously citing the now-retired
        # 'take-it-over-to-answer') was reworded. Forcing it to null still kills the buttons for a
        # cardless/offered question, which is the rule the row protects, even though the exact
        # 'PROVIDER branch' mechanics in the label's narrative no longer apply verbatim
        # post-restructuring.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The row's own `offered` field is gone (UI-009), but the host's offer still reaches the row
        # through `AppQuestion.offered`, which `questionOnTheQueue` turns into the card's one part
        # whenever this window holds none of the words (D-046). The plant drops it (`offered:
        # null`), so the card is drawn with no choices, which the dom test and §2 'the row carries
        # the offer itself' pin. The label's PROVIDER-branch mechanism is obsolete; suggested label:
        # "the row drops the offer · where the words are not here, the card is drawn with nothing to
        # press". Killed by `answer-it-where-you-were-told.test.ts`,
        # `answer-it-where-you-were-told.dom.test.ts`.
        [
            (QUEUE, '            offered: askedHere.offered,\n', '            offered: null,\n'),
        ],
    ),
    (
        "M12 · 🔴 the string spread comes back · `UserInputResponse.answers` admits a bare string "
        "and every single-select surface in this app sends one, so the worker is told its question "
        "was answered *Y, e, s*",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The exact code (`answer:
        # typeof answer === 'string' ? [answer] : [...answer],`) is unchanged by this commit; only
        # its indentation shifted (12 spaces now, not 14), which made the row's literal anchor miss.
        # Same defect, same location, same killer.
        [
            (HOST, "            answer: typeof answer === 'string' ? [answer] : [...answer],", '            answer: [...answer],'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The door choice
        # was `if (row.offered !== null)` inside `settleFromTheQueue`; UI-009 (bb5b9b7e: "One card
        # (QuestionCard, lib/question-card.ts) now does both") removed `PersonsQueueRow.offered` and
        # that branch. A question's answer now goes by its own door `answerFromTheQueue` and a
        # provider decision by `settleFromTheQueue`, chosen by the template (`v-if="row.question"`);
        # the docblock reads "a question this app asked is not settled here", so there is no
        # decision-vs-row choice left to invert. A second agent found the door's choice moved onto
        # the question gate in persons-queue.ts (`one.raisedBy === 'this-app' ? { offered:
        # one.offered } : null`); planting that gate wide is 602 M18's plant, so the row is retired
        # rather than duplicated. Its anchor is left stale, so the census records it retired.
        "M13 · ⛔ the door is chosen by the DECISION instead of by the row · `decision.kind === "
        "'answer'` is true of every provider question in this list too, so a provider card's "
        "answer goes into the app-held branch the moment its live row is missing for any of the "
        "ordinary reasons — a send that looks completely correct and reaches the wrong request",
        [
            (
                SCREEN,
                "  if (row.offered !== null) {",
                "  if (decision.kind === 'answer') {",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** PersonsQueue.vue's take-over button is
        # now gated solely on `row.noAnswerHere === 'not-yours-yet'`, and the file's own comment
        # says why: 'D-017 · R6 — a question this app asked is answered on its row whoever holds the
        # conversation, so it needs no take-over.' The 'take-it-over-to-answer' arm this row
        # targeted no longer exists anywhere in NoAnswerHere or this template — it was deliberately
        # removed, not merely renamed. Its anchor is left stale, so the census records it retired.
        "M14 · ⚠️ the take-over button loses the arm that names it · the row says *take it over and "
        "its answers appear on this row* and offers no way to do it, which is `106` with an "
        "encouraging sentence over an absent control",
        [
            (
                CARD,
                "                row.noAnswerHere === 'not-yours-yet' ||\n"
                "                row.noAnswerHere === 'take-it-over-to-answer'",
                "                row.noAnswerHere === 'not-yours-yet'",
            ),
        ],
    ),
    (
        "M15 · 🔴 the sentence after a press names a CARD again · the row a person sees for five "
        "seconds after answering a question that has no card tells them about one — `602`'s false "
        "instruction arriving through the door this dispatch opened, which is what this "
        "dispatch's own photograph found",
        [
            (
                CARD,
                "  'no-longer-waiting': 'That was answered from this window — this list has not caught up yet.',",
                "  'no-longer-waiting': 'That card is no longer waiting — this list has not caught up yet.',",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The 'no card to
        # open' / 'offers no choices to press' sentence was the `'no-card-was-drawn'` entry of
        # NO_ANSWER_HERE_WORDS, which UI-009 deleted ("`'no-card-was-drawn'` is gone — a question
        # this app asked is answered on its own card ... or in the person's own words"). The
        # two-reason split it protected no longer exists. The single sentence left for such a row is
        # `WORDS_NOT_FOUND` (W4.59; it was `WORDS_NOT_HERE`), covered by 602 M17's re-anchor; a second plant there would be pinned
        # only by the same literal. Its anchor is left stale, so the census records it retired.
        "M16 · ⛔ the cardless sentence goes back to describing a population it no longer covers · "
        "*no card to open* was the whole reason a person could not act, and since this dispatch it "
        "is only half of one — the other half is a question asked in free-form",
        [
            (
                CARD,
                "    'That question offers no choices to press, so there is nothing here to answer it with and no card to open — the conversation it went to can answer it in its own words.',",
                "    'This app raised that question on an agent’s behalf, so it has no card to open — the conversation it went to is what can answer it.',",
            ),
        ],
    ),
    (
        "M17 · 🔴 the host stops spending the read it already makes · the fold is intact, the row "
        "type is intact, every unit test of both still passes, and the queue never offers anything "
        "— `a-census-that-asks-for-the-import-must-ask-for-the-call`, one layer up",
        [
            (
                HOST,
                "          offered: whatTheAskerOffered(raised),",
                "          offered: null,",
            ),
        ],
    ),
]
