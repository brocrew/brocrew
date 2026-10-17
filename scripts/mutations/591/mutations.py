"""591 · A question does not expire on a clock — each row is THE DEFECT, put back verbatim (131).

⛔ **The ruling is `HO-082` §2, and it is one sentence:** *a question outlives the turn that asked
it, and an answer given hours later reaches the agent. What ends a question is an event — answered,
or its work withdrawn or ended — and NEVER elapsed time.*

## 🔴 What the defect actually was, because it decides what these rows have to kill

⚠️ **`questionsThisAppHolds.waiting` was a SECOND ending vocabulary, in memory.** The queue folds
`REQUEST_IS_OPEN` over the ledger; both answer doors refused on the flag; after `ASK_BOUND_MS` the
two disagreed for ever — the row said somebody owed an answer and every door said nobody was
waiting. ⛔ **Nothing was written down**, so the only gesture that cleared the row was
`End conversation`, which is not an answer (`589`, HO-082 §1).

⚑ **So the repair has two halves and the rows are grouped by them:** the doors stop ending a
question (A, B), and the one act that genuinely ends one starts writing it down (C).

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M2`, `M3` | ⚑ **`run_suite desktop`** — `a-question-does-not-expire-on-a-clock.test.ts` §1, §2 |
| `M4`, `M5`, `M6`, `M7` | ⚑ **`run_suite desktop`** — §1 and its CONTROL, §2 |
| `M8`–`M13` | ⚑ **`run_suite desktop`** — §3 and its two controls, §5 |
| `M14`, `M15`, `M16` | ⚑ **`run_suite desktop`** — §6, and §1's `question_is` |

⚑ **Every row was applied and run ONE AT A TIME** — apply, run the killer file, restore from bytes,
checksum — rather than by running the table.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `441`'s proposal hold.** `proposalsThisAppHolds` carries a `waiting` flag of the same
shape, and `proposeProject`'s own review caught this defect there five weeks before `437` shipped it
here: *"the first draft flipped `waiting` to false in a `finally`, so after five minutes the card
went on drawing Approve while `decideProposal` refused it for ever."* ⚑ **That code is correct as it
stands**, and a row that broke it would be measuring `441`'s rule rather than this one. ⚠️ HO-082
§4.2 re-prices the proposal half after this lands.

⛔ **No row that makes the `finally` DELETE the map entry instead of flipping the flag.** `437 M7`
already owns that subject from the other side — it forces `held` to `undefined` at the answer door —
and a second spelling of *the entry is gone* would be two rows for one rule.

## 🔴 608 · FOUR ROWS RETIRED, and every one of them was about the WAIT (HO-084 §4)

⚑ **`608` removed `ask_parent`'s hold, the bound behind it, and the promise this table's flag
described.** ⛔ Four rows lost their subject outright, and each is named with what it measured
rather than left to a reader of `CENSUS.md`:

 - **`M6`** · *the words are delivered EVEN WHEN a turn is still waiting, so a worker gets its
   answer twice.* ⛔ **No turn is ever waiting**, so there is no second delivery to make and no
   branch to remove. ⚑ The single route it guarded one half of is `M4`'s, corrected in place.
 - **`M13`** · *the worker's held call is not released when the work is taken back.* ⛔ **No call
   is held.** ⚑ A withdrawal owes the ENDING and nothing else, and `608`'s own §3 measures that
   nothing is delivered to the worker by one.
 - **`M15`** · *`questionIs` is asserted rather than rendered.* ⛔ **The field is gone.** It read
   the routing row AFTER a five-minute race; nothing is awaited between the writes and the return,
   so it could only ever have answered `open` — `a-positive-assertion-must-differ-from-the-default`.
 - **`M18`** · *the post-wait ledger read goes back to being FATAL.* ⛔ **The read is gone**, which
   is stronger than the guard `591` wrapped it in. ⚠️ The hazard is recorded in `runtime-host.ts`
   where the method stood, so the next dispatch to add such a read meets the measurement.

⚠️ **The other five rows this dispatch touched were CORRECTED IN PLACE and re-verified RED by
hand** — `M2`, `M3`, `M4`, `M7` here and `441 M24` — and each carries its own note.
🔴 **`M4` got stronger**: it restored a defect about LATE answers, and since `608` every answer is
late.

⛔ **No row on `ASK_BOUND_MS`'s VALUE.** The number is not the defect and HO-082 §1 says so in as
many words: *neither was set as an answer to how long should a person have.* ⚑ A row that changed
five minutes to fifty would pass every test in this suite, which is the measurement that the bound
was never what any of this turned on.
"""

from __future__ import annotations

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RAILS = "apps/desktop/src/main/runtime/question-rails.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

# ⚠️ **The agent door's branch, anchored on the line that OPENS it** — the bare `if (held !==
# undefined) {` appears once, and the comment above it is this dispatch's own prose, so the anchor
# moves only when this row's subject does.
THE_AGENT_DOOR = (
    "    // here to refuse. What the bound decides is where the answer GOES, one branch below.\n"
    "    if (held !== undefined) {"
)

# ⚠️ **The two routes, which is the whole of the delivery half.**
THE_TWO_ROUTES = (
    "      if (held.aTurnIsWaiting) {\n"
    "        // ⚠️ **Set here rather than left to `askTheParent`'s `finally`**, which is what its two\n"
    "        // siblings — {@link askTheWorkToStop}'s release and the person's door — already do: the\n"
    "        // invariant then holds at the line that breaks it instead of on a microtask in another\n"
    "        // method.\n"
    "        held.aTurnIsWaiting = false\n"
    "        held.settle(said)\n"
    "      } else {\n"
    "        void this.deliverAnswer(held, request.requestId, speaking, said)\n"
    "      }"
)

THE_PERSONS_ROUTES = (
    "      const aTurnWasWaiting = holding.aTurnIsWaiting\n"
    "      holding.aTurnIsWaiting = false\n"
    "      if (aTurnWasWaiting) holding.settle(said)\n"
    "      else void this.deliverAnswer(holding, requestId, null, said)"
)

THE_LANE = (
    "        THE_APP_ITSELF,\n"
    "        [],\n"
    "        'notice',\n"
    "        answeredBy === null ? {} : { carriedFor: answeredBy },"
)

THE_ENDING = "    const ended = this.endTheQuestionsAbout(session, task.taskId)"

# ⛔ **603 · CORRECTED IN PLACE, not retired.** `603` moved the pairing of a request with the work
# it names into `openQuestionsByWork`, which `endTheQuestionsAbout` and the composition now share —
# so the `continue` this anchored became a lookup. ⚡ The SUBJECT is the same: this door must end the
# questions about THIS task and not every question the worker has open. Re-verified RED by hand.
THE_JOIN = "    const open = byWork.get(taskId) ?? []"

# ⛔ **603 · CORRECTED IN PLACE, and it CROSSED A FILE.** The openness check moved out of this
# door's loop and into `openQuestionsByWork` in `shared/questions.ts`, which `endTheQuestionsAbout`
# and `composeWaitingOnAnAnswer` both resolve. 🔴 **The row got STRONGER rather than weaker**: one
# mutation now takes down the door that ENDS a question and the read that REPORTS it, which is the
# measurement that they are one rule. ⚠️ `603` wrote no row of its own on this line for that reason.
# Re-verified RED by hand.
THE_OPENNESS = "    if (!REQUEST_IS_OPEN[request.state]) continue\n    const named"

THE_RELEASE = (
    "      const held = this.questionsThisAppHolds.get(request.requestId)\n"
    "      if (held !== undefined && held.aTurnIsWaiting) {\n"
    "        held.aTurnIsWaiting = false\n"
    "        held.settle(null)\n"
    "      }\n"
    "    }\n"
    "    return ended"
)

# ⚑ **T-003 · re-anchored in place, not retired** — D-009 appended `recipient-ended` after this entry; the row still makes `work-withdrawn` open. Re-verified RED alone.
THE_TABLE = "  'work-withdrawn': false,"

THE_FOLD = (
    "      settle(event.requestId, 'work-withdrawn', entry.at)\n"
    "      continue\n"
    "    }\n"
    "    if (event.type === 'request_interrupted') {"
)

# \u26a1 **Re-anchored by 591's own gate** \u2014 the expression moved into
# `RuntimeHost.whatBecameOfTheQuestion` when the gate's third run found it could read a CLOSED
# store. \u26d4 The row is unchanged: the call asserts `open` instead of rendering the ledger's word.
THE_ROW_READ = "        questionIs: this.whatBecameOfTheQuestion(speaking, requestId),"

THE_UNREADABLE = (
    "    try {\n"
    "      return (\n"
    "        this.deps.store.routedRequestsOf(sessionId).find((one) => one.requestId === requestId)\n"
    "          ?.state ?? 'abandoned'\n"
    "      )\n"
    "    } catch (error) {\n"
    "      console.warn(\n"
    "        `runtime host could not read what became of ${requestId}: ${errorMessage(error)}`,\n"
    "      )\n"
    "      return 'abandoned'\n"
    "    }"
)

THE_REPLAY = (
    # ⚑ **T-003 · re-anchored in place, not retired** — D-009 appended two question types after this line; the row still drops `request_work_withdrawn`. Re-verified RED alone.
    "                     'request_interrupted', 'request_work_withdrawn', 'request_escalated',"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the bound stops ending the question ────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim: the agent's answer door refuses a late answer on the "
        "in-memory flag again. ⛔ The routing row goes on saying somebody owes an answer while the "
        "door says nobody is waiting, and the only gesture that clears the queue row is ending the "
        "conversation — `589`'s measurement, restored",
        [
            (
                HOST,
                THE_AGENT_DOOR,
                "    if (held !== undefined && !held.aTurnIsWaiting) {\n"
                "      return {\n"
                "        ok: false,\n"
                "        refusal: refuseQuestion('question-has-already-ended', { question: request.requestId }),\n"
                "      }\n"
                "    }\n"
                "    if (held !== undefined) {",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** Commit 45a11477 deletes
        # `questionsThisAppHolds` entirely (confirmed in the diff — every reference is a `-` line),
        # replacing the in-memory, bound-based holding map with a ledger-derived check (`theWordsOf`
        # + `admitAnswer`/`REQUEST_IS_OPEN`). The surrounding code now carries its own docblock
        # quoting the exact ruling this row's defect violates: 'HO-082 §2.2 ruled the vocabulary ...
        # and NEVER on elapsed time ... there is nothing here to refuse' — the row's subject was
        # removed on purpose and its defect is now the documented decision. Its anchor is left
        # stale, so the census records it retired.
        "M2 · 🔴 THE DEFECT at the PERSON's door, which is the worse half: the last step of the "
        "chain `ASK_BOUND_MS` is derived from — *ask → escalate → a person is told → the person "
        "answers* — is closed by the bound itself. ⚠️ This is the exact call the person made fifteen "
        "minutes late",
        [
            # A late answer must not be refused merely because the question is no longer waiting.
            # The held branch is keyed by the conversation and question ID and opens on holding !==
            # undefined; mutate that live door without adding a redundant session comparison.
            (
                HOST,
                "    const holding = this.questionsThisAppHolds.get(questionKey(sessionId, requestId))\n"
                "    if (holding !== undefined) {",
                "    const holding = this.questionsThisAppHolds.get(questionKey(sessionId, requestId))\n"
                "    if (holding !== undefined) {\n"
                "      return {\n"
                "        outcome: 'refused',\n"
                "        reason: 'nobody is waiting for an answer to that any more',\n"
                "        stillOpen: false,\n"
                "      }",
            )
        ],
    ),
    (
        "M3 · ⛔ the flag is read as *has this ended* by the SENTENCE instead of by a rail, so a "
        "worker whose question is still open is told it ended. ⚑ The sentence is the only thing a "
        "model has, and `591`'s whole point is that it is chosen by the ROW",
            # ⛔ **608 · CORRECTED IN PLACE, not retired.** `591` gave `ask_parent` TWO sentences
            # and a predicate to choose between them; `608` left one outcome and one sentence
            # (`HO-084` §4), so the row moved from the CHOICE to the sentence itself. ⚑ The
            # subject is unchanged: a worker whose question is still open is told it ended, which
            # is the only thing a model has to go on. Re-verified RED by hand.
                # ⚠️ **611 · CORRECTED IN PLACE** — the sentence names where it went (HO-088 §2).
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 rewrote the text before this clause (a named agent); the row still tells an open question's asker it ended. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: the sentence an asker reads for a still-open question must say it is still theirs
        # to answer, not that it ended. The old anchor's front half is stale (the recipient is now
        # `agent ${…}` or asked.went), so the plant anchors on the surviving 'as ${asked.question}.
        # It is still theirs to answer' and swaps in the ended sentence. Killed by
        # `a-question-does-not-expire-on-a-clock.test.ts`, `the-turn-that-no-longer-waits.test.ts`.
        [
            (TOOLS, 'as ${asked.question}. It is still theirs to answer', 'as ${asked.question}. It has already ended, so no answer to it is coming'),
        ],
    ),
    # ── B · the answer has to REACH the agent ──────────────────────────────────────────────────
    (
        "M4 · 🔴 THE OTHER HALF, verbatim: the ending is written and the worker is never told. ⛔ A "
        "repair that only stopped refusing would look right from the ledger and from the queue, and "
        "the agent that asked would carry on for ever having heard nothing — HO-082 §2's sentence "
        "*an answer given hours later reaches the agent* deleted while every state assertion passes · killed by `a-question-does-not-expire-on-a-clock.test.ts` (named by W4.78)",
            # ⛔ **608 · CORRECTED IN PLACE, not retired.** The delivery stopped being the `else`
            # of a branch and became the whole of the door (`HO-084` §4), so only its INDENT moved.
            # 🔴 **The row got STRONGER**: it used to restore a defect about LATE answers, and
            # since `608` every answer is late — this one mutation now silences every answer any
            # parent ever gives. Re-verified RED by hand.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The fire-and-forget `void
        # this.deliverAnswer(...)` became `const told = this.deliverAnswer(...)` (D-017 needs the
        # `kept` result to report a failed start back to the caller), so the literal no longer
        # matches, but silently skipping the delivery still plants 'the ending is written and the
        # worker is never told' exactly as before.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 added the window/stopAs arguments; the result is now destructured ({kept, stop, held}), so the plant resolves the same 'nothing to report' shape the decline branch uses (null would throw on destructuring rather than silently tell nobody). Killer: §1 'the answer arrives as a turn the worker reads' (591's own file).
            (HOST, "      const told = this.deliverAnswer(held, request.requestId, speaking, said, null, null, stopAs)\n", "      const told = Promise.resolve({ kept: null, stop: null, held: false })\n"),
        ],
    ),
    (
        "M5 · ⛔ the answer takes the WORK lane, so criterion 13's singleton refuses it to a busy "
        "worker — and a worker that asked a question and carried on working is busy BECAUSE it "
        "stopped waiting. ⚑ The answer is dropped exactly in the case it exists for",
        # ⚑ **RE-POINTED at 624, not retired** — the line after `'notice',` is now a comment
        # block (`624` gave the person-answered arm a SUBJECT, `HO-095` §6.1), so the two-line
        # anchor stopped applying. ⛔ The row's subject is unchanged: the answer takes the WORK
        # lane. `correct-a-stale-mutation-anchor-dont-retire-it`, and the table is `unrun`, so no
        # verdict is inherited.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same call, same 'notice'
        # kind literal, untouched by the rewrite (only surrounding retry/catch logic was added
        # around it). Swapping to 'work' still routes a busy-worker's answer into criterion 13's
        # work singleton instead of the notice lane, which is the exact defect the row names.
        [
            (HOST, "await this.queueMessage(asker, text, THE_APP_ITSELF, [], 'notice', facts)", "await this.queueMessage(asker, text, THE_APP_ITSELF, [], 'work', facts)"),
        ],
    ),
    (
        "M6 · ⛔ the words are delivered EVEN WHEN a turn is still waiting, so a worker gets its "
        "answer twice — once as the tool's result and once as a turn it must now interpret. ⚑ The "
        "control is the only thing that can see this: every state assertion in §1 still passes",
        [
            (
                HOST,
                THE_TWO_ROUTES,
                "      if (held.aTurnIsWaiting) {\n"
                "        held.aTurnIsWaiting = false\n"
                "        held.settle(said)\n"
                "      }\n"
                "      void this.deliverAnswer(held, request.requestId, speaking, said)",
            )
        ],
    ),
    (
        "M7 · ⚠️ a PERSON's answer is attributed to the conversation that asked it, so the worker "
        "reads *you answered your own question*. ⚑ `null` means a person and is not the string — a "
        "row that passes a name here is the shape `ChainHop.on` refuses one column over",
            # ⛔ **608 · CORRECTED IN PLACE, not retired.** The `else` went when the person's door
            # stopped choosing between two routes (`HO-084` §4); the argument this row is about —
            # `null` means a PERSON and is not the string — is untouched. Re-verified RED by hand.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — This call moved into the
        # new D-017 function `aPersonAnswersAQuestionThisAppAsked` and grew two trailing args, so
        # the 4-arg literal no longer matches, but the docblock right above it still states '`null`
        # for the answerer is a PERSON' — substituting the asker's own id for `null` still makes the
        # worker read 'you answered your own question'.
        [
            (HOST, 'const delivered = this.deliverAnswer(asked, requestId, null, said, null, theSurfaceAsking(by))', 'const delivered = this.deliverAnswer(asked, requestId, askedBy, said, null, theSurfaceAsking(by))'),
        ],
    ),
    # ── C · the ending a withdrawal owes ───────────────────────────────────────────────────────
    (
        "M8 · 🔴 THE DEFECT `HO-082` §4.1 is about, verbatim: `withdraw_task` writes "
        "`task_withdrawn` and nothing about the questions raised under it. ⛔ The row derives `open` "
        "for ever, the attention queue counts it, and it is now WORSE than before `591` — the "
        "question stays answerable about work that no longer exists",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The only change is
        # cosmetic: the local variable is now dereferenced as `session.id` instead of a bare
        # `session`. `withdrawTask` (the `withdraw_task` tool handler) is otherwise unchanged, and
        # zeroing `ended` still plants HO-082 §4.1's exact defect: an ending written with no notice
        # to the questions raised under it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The label (withdraw_task writes the ending and nothing about the questions raised under
        # it) survives: takeBackPiece in runtime-host.ts counts the open questions ended under the
        # piece via openQuestionsByWork(routedRequestsOf, questionsRaisedIn).get(piece.piece) and
        # reports it as endedQuestions. Plant: replace that count with 0, the direct analogue of the
        # old 'const ended = 0'. Killers: a-question-does-not-expire-on-a-clock.test.ts asserts
        # took.endedQuestions toBe(1) in three places, with a toBe(0) control;
        # the-turn-that-no-longer-waits.test.ts asserts toBe(1). Not a duplicate of the landing
        # agent's re-anchored 591:M9 (fold join) and M12 (fold loop), which plant different lines.
        # Killed by `a-question-does-not-expire-on-a-clock.test.ts`,
        # `the-turn-that-no-longer-waits.test.ts`.
        [
            (HOST, '    const endedQuestions =\n      openQuestionsByWork(\n        this.deps.store.routedRequestsOf(piece.owner),\n        this.deps.store.questionsRaisedIn(piece.owner),\n      ).get(piece.piece)?.length ?? 0\n', '    const endedQuestions = 0\n'),
        ],
    ),
    (
        "M9 · ⛔ the join is the LEDGER's rather than the TASK's, so one withdrawal ends every "
        "question the worker is waiting on — including ones about work nobody touched. ⚑ Only a "
        "control with two questions in one ledger can see it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # holds: a take-back ends only the questions about THAT piece, and the control test keeps a
        # question about another piece open in the same ledger. The join moved from
        # byWork.get(taskId) in the deleted endTheQuestionsAbout to the fold's
        # pieceOf.get(requestId) === event.piece; the plant ends every open question that names any
        # piece. Killed by `a-question-does-not-expire-on-a-clock.test.ts`.
        [
            (QUESTIONS, "if (pieceOf.get(requestId) === event.piece) settle(requestId, 'work-withdrawn', entry.at)", "if (pieceOf.has(requestId)) settle(requestId, 'work-withdrawn', entry.at)"),
        ],
    ),
    (
        "M10 · ⛔ the openness check goes, so an ending is written over a question somebody already "
        "answered. ⚠️ The FOLD is idempotent so the state does not move — what moves is the COUNT "
        "the parent is told, and a report computed from the plan rather than from the outcome is "
        "standing rule 13's own defect",
        [(QUESTIONS, THE_OPENNESS, "    const named")],
    ),
    (
        "M11 · ⛔ the new state is OPEN in the one table every queue folds through, so the row a "
        "person could never clear is back — with a word beside it that says it ended. ⚑ "
        "`REQUEST_IS_OPEN` is a closed table precisely so this is a decision and not an omission",
        [(QUESTIONS, THE_TABLE, "  'work-withdrawn': true,")],
    ),
    (
        "M12 · 🔴 the fold does not read the event, so the row is written and nothing derives from "
        "it — an instrument that goes quiet without saying so. ⚠️ The write still looks right in "
        "the Events tab and the queue goes on counting the question for ever",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule (the
        # questions fold must act on the ending, or the write derives nothing and the queue counts
        # the question for ever) survives: request_work_withdrawn became work_taken_back, and the
        # fold's branch in shared/questions.ts ends every open request whose question named that
        # piece with 'work-withdrawn'. The plant deletes the loop so the branch reads the event and
        # does nothing. Killed by `a-question-does-not-expire-on-a-clock.test.ts`,
        # `the-turn-that-no-longer-waits.test.ts`.
        [
            (QUESTIONS, "      for (const requestId of [...open.keys()]) {\n        if (pieceOf.get(requestId) === event.piece) settle(requestId, 'work-withdrawn', entry.at)\n      }\n      continue", '      continue'),
        ],
    ),
    (
        "M13 · ⛔ the worker's held call is not released, so the ledger asserts an ending the app "
        "has not performed: the row reads `work-withdrawn` while `ask_parent` goes on holding the "
        "worker's turn for the whole bound. ⚑ `437`'s own finding, one act over",
        [
            (
                HOST,
                THE_RELEASE,
                "      void this.questionsThisAppHolds\n    }\n    return ended",
            )
        ],
    ),
    # ── D · the words the row chooses ──────────────────────────────────────────────────────────
    (
        "M14 · ⛔ the expiry sentence goes back to the one that was true before `591` — *carry on, "
        "or ask again*, with nothing about the question still being theirs. ⚑ A model told only "
        "that nobody answered has no reason to believe an answer can still arrive, which is the "
        "behaviour `HO-082` §2 exists to change and the one thing a sentence CAN close",
        [
            (
                TOOLS,
                # ⚠️ **611 · CORRECTED IN PLACE** — *The question* became *It*, because the
                # sentence before it now names the recipient.
                "It is still theirs to answer — an answer given later reaches you as a message rather than as this call's result. ",
                "",
            )
        ],
    ),
    (
        "M15 · 🔴 `questionIs` is asserted rather than rendered — the call reports `open` whatever "
        "the ledger says, so a question whose work was withdrawn gets the *still theirs* sentence "
        "and a model is sent to wait for an answer nobody will ever give. ⚑ `HO-070` §3's rule: if "
        "a line can be rendered from the thing, render it",
        [(HOST, THE_ROW_READ, "        questionIs: 'open',")],
    ),
    (
        "M18 · 🔴 the post-wait ledger read goes back to being FATAL · `askTheParent` did no store "
        "read after its race until `591`, and the three things that settle that race all fire at "
        "moments the app may be going away — a teardown releases every held ask and closes the "
        "database in the same breath. ⛔ The released call then reaches a model as a transport "
        "error instead of an answer (`307`), and only while quitting, which is the hardest state "
        "to reproduce on purpose. ⚑ Found by this dispatch's own gate, with every test passing",
        [
            (
                HOST,
                THE_UNREADABLE,
                "    return (\n"
                "      this.deps.store.routedRequestsOf(sessionId).find((one) => one.requestId === requestId)\n"
                "        ?.state ?? 'abandoned'\n"
                "    )",
            )
        ],
    ),
    (
        "M16 · ⛔ `list_questions` prints the bare word for the new ending, and a reader would as "
        "likely conclude the ASKING model retracted its own question — the one thing that did not "
        "happen. ⚑ `396` and `397` both added a sentence for exactly this reason",
        [
            (
                TOOLS,
                "  'work-withdrawn':\n"
                "    'the work it was about was taken back, so nothing is left to decide — that conversation is still there, and list_tasks says what it holds now',\n",
                "",
            )
        ],
    ),
    # ── E · the replay ─────────────────────────────────────────────────────────────────────────
    (
        "M17 · 🔴 the narrow replay query does not select the new type, so the ending reads as *that "
        "event never happened* — silently, and only on the replayed path, which is every path after "
        "a restart. ⚑ The query's own docblock names this census as the thing that makes forgetting "
        "impossible; this row is that claim being measured",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The census in
        # a-question-finds-a-person.test.ts still makes forgetting a folded type impossible, and the
        # fold still branches on the ending type, now work_taken_back (D-016 replaced
        # request_work_withdrawn with the take-back's own row). The plant drops it from
        # selectRoutedRequestEvents' narrow replay query. Killed by
        # `a-question-finds-a-person.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a taken-back piece must end its owner's questions, so the questions fold must
        # be able to see work_taken_back. The IN list has grown a member, so the old anchor stopped
        # matching, but the short list fragment still occurs once. The plant drops work_taken_back
        # from that statement's list. Killed by `a-question-finds-a-person.test.ts`.
        [
            # Source-only NOT VERIFIED: omit the same take-back from the shared replay list.
            (STORE, "  'request_interrupted',\n  'work_taken_back',\n  'work_closed',\n", "  'request_interrupted',\n  'work_closed',\n"),
        ],
    ),
]
