"""602 · scope the pane's claim to what it can answer.

⛔ **`589`'s repair 3, `HO-082` §4.3** — and §1 of the brief asked for a MEASUREMENT before a
repair, because `591` had landed in between and might have closed it. ⚑ **It had not**: `591`
bounded a question's CLOCK (`HO-082` §2) and these three sentences are about what a surface
COUNTED.

## 🔴 The three sentences, and every one of them was true of the code

| surface | what it said | what was true |
|---|---|---|
| the conversation pane | *"No permissions, questions or proposals **have been raised here**"* | a question had been raised here, by this app, and the notice saying so was six lines up |
| the queue's top line | *"This takes you to the card; **the card is where you answer**"* | there is no card, in this window or any other |
| the queue's row | *"its card is not in the part on screen — **open it to answer**"* | same, and this is the one `589` watched a person follow |

## ⚑ Five claims, and a table pushed on one would pass a repair that traded another

 1. **The WORD is read off the raising ROW** (M1–M5). ⛔ Not off `taskId`, which answers a
    different question and agrees only by accident of the wire today —
    `widening-a-predicate-widens-every-question-its-field-answers`.
 2. **The FOLD from raised to card** (M6–M7). ⚠️ Three arms, and the unknown is carried rather
    than resolved.
 3. **The LADDER** (M8–M9, M18). 🔴 `not-yours-yet` and `not-in-this-window` both say *its card*
    out loud, so the new arm has to outrank BOTH.
 4. **The OTHER TWO POPULATIONS keep their card** (M10–M11). ⛔ A decision never travelled and a
    proposal draws its own item; a widening that took *open it to answer* off them would break two
    working controls to fix one.
 5. **The WORDS** (M12–M17). ⚑ The pane's heading and the queue's two sentences, each read where a
    person reads it.

## 🔴 The one a reader should look at first

⛔ **M6 puts the defect back in one table cell** — `'this-app': 'was-drawn'` — and nothing about it
is obviously wrong. ⚑ It typechecks, every population keeps its sentence, and the only thing that
changes is that a person is told to open a card that has never existed.

## ⛔ What this table does NOT cover, said out loud

 1. **The five-arm heading ladder** (`noLedger` / `partial` / `stale` / `rowsDropped`) —
    `scripts/mutations/434` and `453` own it. ⚑ `602` added nothing to it, which is §2 of the
    brief honoured rather than a gap here.
 2. **`aboutTheWork` and `AboutWork`** — `scripts/mutations/474` owns that vocabulary. ⛔ M2 is
    here anyway, because reading `about` to answer THIS question is the coupling `602` refused.
 3. **`AttentionQueue.vue`'s own copy.** ⚠️ Measured in the suite's §6 and reported as a finding;
    §6 of the brief says to name it and ask, so nothing here changes it.
 4. **`591`'s ledger work.** ⚑ Gated and on `main`.

## 🔴 The gate map — which file kills which row

| rows | killer |
|---|---|
| M1, M4, M5 | `apps/desktop/test/scope-the-panes-claim.test.ts` §1 · the real store and the real host |
| M2, M3 | ⚠️ **§3's source census** — ⛔ **M2 is invisible to every behavioural test**: on any fixture this app can build, `taskId != null` and `type == 'question_asked'` give the same answer, which is `a-comparison-tested-where-both-sides-agree`. The census is what refuses the coupling itself |
| M6, M7 | `…scope-the-panes-claim.test.ts` §3 and §4 |
| M8–M11, M18 | `…scope-the-panes-claim.test.ts` §4 · the ladder and the two populations that keep their card |
| M12–M14 | `…scope-the-panes-claim.test.ts` §5 · the line above the rows |
| M15–M16 | `…scope-the-panes-claim.test.ts` §2 · the pane, literal and meaning |
| M17 | `…dom/scope-the-panes-claim.dom.test.ts` · the row's own sentence, read where a person reads it |

⛔ **Evidence, and it is the method rather than a claim.** Every row was applied ALONE, its killer
file run, and the tree restored from the bytes kept before the edit and hashed —
`verify-each-mutation-row-without-running-the-table`. ⚠️ **The whole table has NOT been run under
the driver**, so `CENSUS.md` records it `unrun` and no verdict is claimed here. ⚑ **18 of 18 are
RED, and each was checked for the RIGHT reason**: the runner's output was searched for
`SyntaxError`, `Transform failed` and `error TS`, because a row red on a parse error measured
nothing (`452 M8`).
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
PANEL = "apps/desktop/src/renderer/src/lib/session-panel.ts"
CARD = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
QUESTION_CARD = "apps/desktop/src/renderer/src/lib/question-card.ts"

MUTATIONS = [
    (
        "M1 · ⛔ the statement stops selecting the row's own type · `row.type` is then `undefined` and the ternary below it answers `the-provider` for every row, including the app's — ⚡ the value is still READ, so nothing is a type error",
        [
            (
                STORE,
                '            type AS type,\n',
                '',
            ),
        ],
    ),
    (
        "M2 · 🔴 the coupling `602` refused · the word is read off `taskId` instead of off the row that raised it. ⛔ **It answers correctly on every fixture this app can build**, and goes false the day a provider question carries a task id — which `WorkInHand`'s own note says is expected",
        [
            (
                STORE,
                "raisedBy: row.type === 'question_asked' ? 'this-app' : 'the-provider',",
                "raisedBy: row.taskId !== null ? 'this-app' : 'the-provider',",
            ),
        ],
    ),
    (
        "M3 · ⚠️ a third type joins the statement · the ternary is exhaustive ONLY because the `WHERE` above admits two, so a permission now enters the raised map wearing `the-provider` — rule 20's *a category defined by the PIPE*",
        [
            (
                STORE,
                "        AND type IN ('user_input_request', 'question_asked')",
                "        AND type IN ('user_input_request', 'question_asked', 'permission_request')",
            ),
        ],
    ),
    (
        "M4 · ⛔ the honest third answer is resolved into a known · a routing whose raising row this read could not find is reported as the provider's, so a surface says *there is a card* about a state nothing established",
        [
            (
                HOST,
                "raisedBy: raised?.raisedBy ?? 'nothing-says',",
                "raisedBy: raised?.raisedBy ?? 'the-provider',",
            ),
        ],
    ),
    (
        'M5 · 🔴 the word is asserted rather than carried · every escalated row claims the app raised it, so a provider question a person CAN answer is drawn as one with no card',
        [
            (
                HOST,
                "raisedBy: raised?.raisedBy ?? 'nothing-says',",
                "raisedBy: 'this-app',",
            ),
        ],
    ),
    (
        'M6 · 🔴 **the defect, restored in one table cell** · a question `ask_parent` raised is folded as having a card, and every sentence goes back to telling a person to open one that has never existed',
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # UI-009 deleted the `A_CARD_TO_OPEN` table and `'no-card-was-drawn'` ("a question this app
        # raised has its card above"); the same fold now lives in the one expression `one.raisedBy
        # === 'this-app' ? { offered: one.offered } : null`. The plant gives the app's own question
        # no card of its own, so it falls to the ladder and its sentences send a person to 'open it
        # to answer' again; scope-the-panes-claim.test.ts §3 was re-pointed to pin exactly this.
        # Suggested label: "a question `ask_parent` raised is no longer its own card on the queue
        # and falls back to the card-sending sentences". Killed by `scope-the-panes-claim.test.ts`,
        # `scope-the-panes-claim.dom.test.ts`.
        [
            (QUEUE, "        one.raisedBy === 'this-app' ? { offered: one.offered } : null,\n", '        null,\n'),
        ],
    ),
    (
        'M7 · ⚠️ an unknown is spelled as an absence · a read that could not find the raising row now claims there is no card — `an-unenumerated-state-counts-as-success` with the two states swapped',
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The `'nothing-says': 'nothing-says'` cell is gone with the table, but the rule (an unknown
        # is carried as unknown, never resolved into a claim) survives: the test §3 comment says
        # 'the unknown included, which is not folded into this app's'. The plant widens the
        # app-question test to everything that is not the provider's, so a read that could not find
        # the raising row is drawn as the app's own card. Suggested label: "an unknown is spelled as
        # this app's own question · a read that could not find the raising row now claims the card
        # is drawn on the row". Killed by `scope-the-panes-claim.test.ts`,
        # `answer-it-where-you-were-told.test.ts`.
        [
            (QUEUE, "        one.raisedBy === 'this-app' ? { offered: one.offered } : null,\n", "        one.raisedBy !== 'the-provider' ? { offered: one.offered } : null,\n"),
        ],
    ),
    (
        'M8 · ⛔ the arm leaves the ladder · a cardless row falls through to the two window questions, both of which say *its card*',
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — 45a11477 itself
        # simplified the cardless arm (removed the `offered === null ? ... :
        # 'take-it-over-to-answer'` sub-ternary, per D-017 R6/619), and wrapped everything in a new
        # `answeredFromHere` outer check — so the old multi-line literal no longer matches. The
        # outer shape (cardless arm vs. the two held/not-held window arms) is untouched, and
        # dropping the cardless arm entirely still makes a cardless row fall through to a 'its card'
        # sentence.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The cardless arm (`'no-card-was-drawn'`) left the ladder on purpose, but its successor is
        # the first arm of `settling`, `question !== null ? { answers: [], limit: null,
        # noAnswerHere: null }`, which outranks both window questions that say 'its card'. The plant
        # takes that arm out, so an app question falls to 'not-in-this-window' / 'not-yours-yet'
        # under its own card; §4 and the dom sweeps pin it. Suggested label: "the arm leaves the
        # ladder · a question this app asked falls through to the two window questions, both of
        # which say its card". Killed by `scope-the-panes-claim.test.ts`,
        # `answer-it-where-you-were-told.test.ts`, `answer-it-where-you-were-told.dom.test.ts`.
        [
            (QUEUE, '      question !== null\n        ? // ⚑ **The card answers it**', '      false\n        ? // ⚑ **The card answers it**'),
        ],
    ),
    (
        'M9 · 🔴 the arm is ordered BELOW the window question · the conversation the person had open is exactly the held case, so the row he pressed goes straight back to *open it to answer*',
        # A held app question must outrank the window-question arm. Adding !held sends its own
        # visible card to not-in-this-window while leaving an unheld question unchanged; that is the
        # scope-routing defect this row tests.
        [
            (QUEUE, '    const settling =\n      question !== null\n', '    const settling =\n      question !== null && !held\n'),
        ],
    ),
    (
        "M10 · ⛔ a permission that never travelled is told it has no card · the provider raised it in the asker's own conversation and the transcript drew it there, so this takes a working control away from a whole population",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The decision population's hard-coded 'was-drawn' is now its last `place(...)` argument,
        # `null`, under the comment that a permission's card is in the asker's own transcript. The
        # rule survives, mirrored: a decision must not be folded into this app's question card,
        # which would take its Allow/Deny answers away (`answers: []`). The plant hands it `{
        # offered: null }`. Suggested label: "a permission is folded as a question this app asked ·
        # it is drawn as that card and loses its working answers". Killed by
        # `scope-the-panes-claim.test.ts`.
        [
            (QUEUE, '        // defect, and `permissionOffer` already decides it, on the live row.\n        null,\n', '        // defect, and `permissionOffer` already decides it, on the live row.\n        { offered: null },\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row is about the
        # `project_proposed` population folding into a `proposal` item on the persons queue.
        # Proposals were removed end to end (commit message), and persons-queue.ts now has only the
        # question population and the decision (permission) population. The anchor comment is gone.
        # Its anchor is left stale, so the census records it retired.
        'M11 · ⛔ a proposal is told it has no card · `project_proposed` folds into a `proposal` item, which is the item `sessionPanel` counts and `attention.ts` projects',
        [
            (
                QUEUE,
                "        // item, which is the item `sessionPanel` counts and `attention.ts` projects.\n        'was-drawn',",
                "        // item, which is the item `sessionPanel` counts and `attention.ts` projects.\n        'was-never-drawn',",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The queue's top
        # line and its `someHaveNoCard` test were deleted by UI-009 (bb5b9b7e): "The sentences that
        # explained the machinery go (... the page's long intro)". `someHaveNoCard`,
        # `NOT_EVERY_ROW_HAS_A_CARD` and the `persons-queue-line` hook are gone from src, and
        # scope-the-panes-claim.test.ts says "§5 is retired with what it measured", so there is no
        # line to invert. Its anchor is left stale, so the census records it retired.
        'M12 · ⚠️ the test is inverted · the top line keeps its promise over a cardless list and drops it over a carded one — the sentence is exactly wrong in both directions at once',
        [
            (
                QUEUE,
                "  const someHaveNoCard = asked.some((one) => A_CARD_TO_OPEN[one.raisedBy] === 'was-never-drawn')",
                "  const someHaveNoCard = asked.some((one) => A_CARD_TO_OPEN[one.raisedBy] === 'was-drawn')",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** Same deleted
        # line as M12: `const someHaveNoCard = asked.some(...)` is gone (`git log -S` names
        # bb5b9b7e), removed with the line above the rows that "explained the machinery". The dom
        # test now asserts `m.all('persons-queue-line')` is empty for every population, so no
        # some/every choice remains. Its anchor is left stale, so the census records it retired.
        'M13 · 🔴 `every` rather than `some` · one cardless row beside a carded one is no longer enough, and the line goes back to promising a card over a list where one row has none',
        [
            (
                QUEUE,
                "  const someHaveNoCard = asked.some((one) => A_CARD_TO_OPEN[one.raisedBy] === 'was-never-drawn')",
                "  const someHaveNoCard = asked.every((one) => A_CARD_TO_OPEN[one.raisedBy] === 'was-never-drawn')",
            ),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):**
        # `NOT_EVERY_ROW_HAS_A_CARD` ('This takes you to the conversation; not every row here has a
        # card...') was deleted by UI-009 (bb5b9b7e) with the top line, per "The sentences that
        # explained the machinery go". The plant's anchor is absent from src and no surface says it.
        # Its anchor is left stale, so the census records it retired.
        'M14 · ⛔ the tail promises a card again · the constant is put back to the sentence `589` measured, with the branch that chooses it left in place',
        [
            (
                QUEUE,
                "const NOT_EVERY_ROW_HAS_A_CARD =\n  'This takes you to the conversation; not every row here has a card, and each row says which.'",
                "const NOT_EVERY_ROW_HAS_A_CARD = 'This takes you to the card; the card is where you answer.'",
            ),
        ],
    ),
    (
        "M15 · 🔴 **the pane's claim, back to the words that shipped** · the heading denies that a question was raised here, six lines under the app's own notice saying one was",
        [
            (
                PANEL,
                ')} are on a card here`',
                ')} have been raised here`',
            ),
        ],
    ),
    (
        'M16 · ⚠️ the scoping word goes · the heading names the populations and says nothing about what it looked at, which is the caveat-free form §3.1 refused and the bare denial it refused as well',
        [
            (
                PANEL,
                ')} are on a card here`',
                ')} here`',
            ),
        ],
    ),
    (
        "M17 · 🔴 the row's own sentence sends a person to a card again · the arm survives, the fold survives, and the only thing that changes is the instruction a person reads and follows",
                # ⛔ **619 · ANCHOR CORRECTED, not retired.** Standing rule 8.1's sweep rewrote
                # this sentence: `619` gave the arm an answer path, so *no card to open* stopped
                # being the whole reason a person cannot act and the words had to say what is
                # left — a question asked in free-form. ⚑ The row's SUBJECT is untouched — the
                # sentence sends a person to a card again — and it was re-verified RED here.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The 'no-card-was-drawn' sentence is gone (UI-009), but the rule ("no sentence a row an app
        # question can reach sends a person to a card") is still pinned by the dom sweeps. The one
        # sentence such a row now gives, when this window holds none of its words, is
        # `WORDS_NOT_HERE` in lib/question-card.ts, so the plant puts the old 'its card is not in
        # the part on screen — open it to answer' sentence back there. Suggested label: "the card's
        # own sentence for words held elsewhere sends a person to a card again". Killed by
        # `scope-the-panes-claim.dom.test.ts`, `answer-it-where-you-were-told.dom.test.ts`.
        # ⚑ W4.59 (D-046's window half) · re-anchored in place: the row's words now come from the
        # person's list, so the one sentence left is `WORDS_NOT_FOUND`, for a row the host found no
        # words for. The plant is unchanged in kind — the card's sentence sends a person to a card.
        [
            # ⚑ **W4.428 · re-anchored in place, not retired** — the sentence now names the product BroCrew and the formatter wraps it after the equals sign; the row plants the same defect.
            (QUESTION_CARD, "export const WORDS_NOT_FOUND =\n  'BroCrew couldn’t find the question’s words. Open the asking conversation to read them.'\n", "export const WORDS_NOT_FOUND =\n  'This window holds that conversation and its card is not in the part on screen — open it to answer.'\n"),
        ],
    ),
    (
        "M18 · ⛔ the question population loses the fold · every escalated row is placed as though a card exists, which is what the code did before `602` and is the state §1's measurement found",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # `A_CARD_TO_OPEN[one.raisedBy]` was the question population's fold; it is now the ternary
        # `one.raisedBy === 'this-app' ? { offered: one.offered } : null`. The plant drops the
        # condition so every escalated question is placed as this app's own card without reading
        # what raised it (a provider's and an unknown too), which §3 and §4 refuse. Suggested label:
        # "the question population loses the fold · every escalated row is drawn as the app's own
        # question card". Killed by `scope-the-panes-claim.test.ts`,
        # `answer-it-where-you-were-told.test.ts`.
        [
            (QUEUE, "        one.raisedBy === 'this-app' ? { offered: one.offered } : null,\n", '        { offered: one.offered },\n'),
        ],
    ),
]
