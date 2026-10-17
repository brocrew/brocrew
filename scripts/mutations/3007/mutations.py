"""3007 · answers and interrupts on dev — 809e0e66, 3a9c1bbc, 7cb67680, 34a00442.

⛔ **The subject**: four dev commits about what an answer and an interrupt leave behind.

 * 809e0e66 — an answer (or a `cannot_answer` reason) longer than `REPLY_SUMMARY_LIMIT` is refused
   with `answer-too-long` before anything is recorded, saying the length, the limit and what to do;
   the question stays open and the same caller answers again (question-rails.ts, runtime-host.ts).
 * 3a9c1bbc — a piece its owner goes back to after an interrupt reads `working` again
   (shared/tasks.ts' `derivePieces`: `cutByAnInterrupt`, `goBackToWhatTheInterruptCut`,
   `restoreTheEarlierStalls`, and the owner's own status line driving its piece).
 * 7cb67680 — no "not being worked on" notice for work an interrupt cut while the turn it made room
   for may still go back to it (`aTurnMayGoBackToIt`, `aDeliveryIsAboutToDriveIt`), and a person's
   stop-and-send letting go of its hold asks the givers again.
 * 34a00442 — the agent tools say what really happened: a stop's turn
   (`a-turn-that-ended-earlier`), who interrupted, why a holder was not told, a give that gave
   nothing, the last turn's opening, model names via `sameModel`.

## ⚑ What a row here measures

 * ⚑ **M1–M7 are `answer-too-long` (809e0e66)** — the refusal's detail on each door (which words,
   how long), its permanence and remedy, and the sentence that says the numbers and the act.
   ⚠️ The bound itself, the `cannot_answer` guard, the whole-answer sum, labels, blanks and the
   not-asked filter are already rowed by `676` (THE_BOUND, THE_BUDGET_SPENT, THE_LABEL_KEPT,
   THE_BLANK, THE_ASKED_PARTS, THE_PROVIDER_ANSWERS, THE_HELD_ANSWERS, the `notAsked.length` row)
   and `1009` (M-row on `cannot.length > REPLY_SUMMARY_LIMIT`), so none of those anchors is reused.
 * ⚑ **M8 is 7cb67680** — the release of a person's stop-and-send hold asks the givers again.
 * ⚑ **M9 is 34a00442** — an ask that stopped a turn with another after it reads
   `a-turn-that-ended-earlier`, not `no-turn-was-running` (the defect, verbatim).

## ⛔ What this table cannot reach today

 * ⚠️ **All of 3a9c1bbc** — the commit added no test, and no existing test drives an interrupt that
   makes room for a brief and then goes back to the cut piece, nor an owner's own `update_work`
   status line moving a stalled piece to `working`. Dropping `goBackToWhatTheInterruptCut()`,
   `restoreTheEarlierStalls()` or the status-line `drivenAgain` changes nothing any test reads.
 * ⚠️ **7cb67680's `aDeliveryIsAboutToDriveIt` holds** (`holdingQueue > 0`, `mayGoBack &&
   aTurnRunsIn`, `wordsMayGoBack`) and the fold's `aTurnMayGoBackToIt` mark — no test reads the
   mark or a deferred notice; the only assertion the commit added is the call-site list M8 uses.
 * ⚠️ **34a00442's other sayings** — `whyNotTold` (a-take-back… asserts only *"could not be
   told"*, true before and after), `held_because`, `label_not_used` / `AGiveThatGaveNothing`,
   `last_turn_took` / *"Its last turn ran from"*, `startedAt`: no test reads any of them.
   ⚠️ **`sameModel`** (case- and space-blind ids in `theListedRow`, `runsOnText`, the hand-added
   dedupe) — every test names a model in the list's own spelling, so `===` in its place is not
   seen (`2007` says the same of `theFormSends`). ⚠️ **Who asked the stop on an answer's line**
   (`whoAskedTheStop`) — `message-now-stops-the-turn-it-reads-in` checks only that the stop line
   is there, which `3001` M10 already rows.
 * ⚠️ **809e0e66's order — missing parts refused before length** — no test answers a held
   question both too long and with a part missing.
 * ⚠️ **The `answer_question` description stating the limit** — no test reads it.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/question-rails.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

R18 = "the-rest-of-r18-and-the-answer-with-no-bound.test.ts"
ASK = "agents-ask-each-other.test.ts"
PUSH = "the-push-that-does-not-survive-a-launch.test.ts"
TRUST = "state-a-supervisor-can-trust.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # R18 '🔴 HELD branch: ONE unit over is refused with the length, the limit and what to do — …' —
    # `detail: { question, argument: 'answers', limit: 1280, was: 1281 }` and the text
    # 'shorten your answer, or put the long form in a file and name its full path in your answer'.
    (
        "M1 · an answer too long is refused as if its REASON were too long — the detail names "
        "`cannot_answer` and the caller is told to shorten a reason it never gave · "
        f"killed by `{R18}`",
        [(HOST,
          "          argument: 'answers',\n",
          "          argument: 'cannot_answer',\n")],
    ),
    # ASK '⛔ a decline’s reason is bounded like every reply: one unit over is refused, …' —
    # `detail` toMatchObject `{ argument: 'cannot_answer', limit: 1280, was: 1281 }`.
    (
        "M2 · a reason too long is refused as if the ANSWER were too long — the detail names "
        f"`answers` on a call that sent none · killed by `{ASK}`",
        [(HOST,
          "          argument: 'cannot_answer',\n",
          "          argument: 'answers',\n")],
    ),
    # R18 '🔴 HELD branch: ONE unit over …' — `was: 1281`, and the text
    # '1281 units long and an answer may carry at most 1280'.
    (
        "M3 · the refusal says how far OVER the bound the answer was, not how long it was — "
        f"`was` reads 1 for an answer of 1281 units · killed by `{R18}`",
        [(HOST,
          "          was: measured.units,\n",
          "          was: measured.units - REPLY_SUMMARY_LIMIT,\n")],
    ),
    # R18 '🔴 HELD branch: ONE unit over …' — `retryable: true`. ⚑ Also
    # a-refusal-carries-its-remedy.test.ts ('🔴 the rails that carry a remedy …', 16 retryable).
    (
        "M4 · `answer-too-long` is permanent — a model is told no retry will pass, when the same "
        f"call with shorter words lands · killed by `{R18}`",
        [(RAILS,
          "  'answer-too-long': 'while-this-holds',\n",
          "  'answer-too-long': 'permanent',\n")],
    ),
    # R18 '🔴 HELD branch: ONE unit over …' — `remedy: 'shorten-the-answer-or-put-the-long-form-in-a-file'`.
    # ⚑ Also a-refusal-carries-its-remedy.test.ts (the remedy's one membership).
    (
        "M5 · the refusal borrows `summary-too-long`'s remedy — *attach the long form*, an act "
        f"`answer_question` has no argument for · killed by `{R18}`",
        [(RAILS,
          "  'answer-too-long': 'shorten-the-answer-or-put-the-long-form-in-a-file',\n",
          "  'answer-too-long': 'shorten-the-summary-and-attach-the-long-form',\n")],
    ),
    # R18 '🔴 HELD branch: ONE unit over …' — the text must contain
    # '1281 units long and an answer may carry at most 1280'.
    (
        "M6 · the refusal's sentence leaves out the length and the limit — the rail's bare words "
        f"whatever the detail holds · killed by `{R18}`",
        [(RAILS,
          # ⚑ **W4.91 · re-anchored in place, not retired** — 39c9978d added a third arm to the reason, so the choice is a nested conditional now
          "        ? answerTooLongSentence(detail)\n",
          "        ? QUESTION_SENTENCES[rail]\n")],
    ),
    # ASK '⛔ a decline’s reason is bounded like every reply: …' — the reason must contain
    # 'It is 1281 units long and a reason may be at most 1280' and 'name its full path in
    # cannot_answer'. ⚑ Also R18's HELD branch and the-act-inside-the-cut.test.ts (arms /2, /3).
    (
        "M7 · the sentence picks the wrong words for the door — a long reason is told to shorten "
        f"its answer, a long answer its reason · killed by `{ASK}`",
        [(RAILS,
          "  return detail.argument === 'cannot_answer'\n",
          "  return detail.argument === 'answers'\n")],
    ),
    # PUSH '⛔ the triggers are named call sites, and each one is a thing that HAPPENED' —
    # `callers('tellWhoeverGaveTheWork')` toEqual a list holding
    # 'if (session.holdingQueue === 0) this.tellWhoeverGaveTheWork(session.id)'.
    (
        "M8 · a person's stop-and-send letting go of its hold asks nobody again — the notice it "
        "held back is said by nothing when the send is refused (F075, 7cb67680) · "
        f"killed by `{PUSH}`",
        [(HOST,
          "      if (session.holdingQueue === 0) this.tellWhoeverGaveTheWork(session.id)\n",
          "")],
    ),
    # TRUST '⛔ every member of `WHERE_AN_ASK_LANDED` is reached by something — …' — the `landed-d`
    # case (a Stop of a running turn, then a turn after it) must read 'a-turn-that-ended-earlier'.
    (
        "M9 · a stop asked while a turn ran, with another turn after it, reads "
        "`no-turn-was-running` — the defect 34a00442 fixed, verbatim · "
        f"killed by `{TRUST}`",
        [(STORE,
          "            : 'a-turn-that-ended-earlier'\n",
          "            : 'no-turn-was-running'\n")],
    ),
]
