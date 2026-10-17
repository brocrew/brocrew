"""437 · the question a worker can ask its parent — each row is THE DEFECT, put back (12).

🔴 **Criterion 29, and `436` measured that none of the three routes a reader would reach for works.**
`message_agent` upward is refused `no-such-agent`; Codex's native `request_user_input` is
Plan-mode-only by its own description; and `reply_to_parent(outcome:'blocked')` CLOSES the task, so
it is a report that needs reassigning rather than an answer that resumes the work.

⛔ **The property:** *a worker that needs a decision from its parent can ask for one, keep its task
open, and carry on when the answer arrives.*

## ⚑ The ruling these rows are written around

**A worker blocked on a question is `working`, and no vocabulary grew a member to say so.** The verb
HOLDS THE TURN — which is what a provider-raised question has always done — so `deriveTasks` never
reaches its stall branch. ⛔ **`M1` is the row that makes that a claim rather than a label**: a verb
that returned immediately would end the turn, and the task would derive `stalled` with `turn_ended`
— *"its turn ended and it replied nothing"*, which is false of a worker that asked.

## ⚠️ The hazards these rows are written against

⛔ **`a-comparison-tested-where-both-sides-agree-measures-nothing`.** `M2` is the row that needs it
most: the spawn edge and the task edge give the SAME answer for every ordinary worker, so a fixture
in which its spawner also gave it the work could not tell them apart. ⚑ `§4` builds the one shape
where they disagree — a second parent, which `431` made possible — and asserts the premise before it
asserts the consequence.

⛔ **`an-unenumerated-state-counts-as-success`.** `M8` turns an expiry into a REFUSAL. Both arms are
*not answered*, so a test that only asked *did it come back with an answer* would pass either way;
what separates them is that one says the ask was performed and the other says it was not.

⛔ **`a-narrowing-is-opt-in-at-the-call-site-too`, in the direction this dispatch did NOT go.** `M11`
is the design that was refused: widen `withinMessagingReach` so a worker may address its parent.
⚠️ It is a row rather than a paragraph because it is the plausible alternative, and the thing that
refuses it is a test rather than an argument.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M7`, `M10`, `M12` | ⚑ **`run_suite`** — `a-question-a-worker-can-ask.test.ts` §1 |
| `M3`, `M11` | ⚑ **`run_suite`** — `a-question-a-worker-can-ask.test.ts` §2 |
| `M6` | ⚑ **`run_suite`** — `a-question-a-worker-can-ask.test.ts` §3 |
| `M2` | ⚑ **`run_suite`** — `a-question-a-worker-can-ask.test.ts` §4, the only section where the two edges disagree |
| `M8` | ⚑ **`run_suite`** — `a-question-a-worker-can-ask.test.ts` §5 |
| `M4`, `M5` | ⚑ **`run_suite`** — `a-question-a-worker-can-ask.test.ts` §6 |
| `M9` | ⚑ **`run_suite`** — `a-question-a-worker-can-ask.test.ts` §7 |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

⚠️ **`M3` reported SURVIVED once and the report was wrong, not the row.** A second verifier was
running over the same worktree at the same time — re-checking `393 M3` after its re-anchor — and one
harness restored its snapshot while the other held a mutation applied. ⛔ **`mutation-harness-owns-
the-tree`**: re-run alone, it is RED. 🔴 **A survivor is evidence about the CODE only if nothing else
was editing the code**, which is a precondition a run does not check for you.

## ⛔ What this table deliberately does NOT contain

⛔ **No row inside `withinMessagingReach` or `mayCommand`.** `437` did not touch either, which is the
whole of §2 — a row there would measure `431`'s decision and not this one. ⚑ `M11` is the opposite
shape: it ADDS a clause, which is the change this dispatch refused to make.

## ⚠️ `M5` SURVIVED on its first run, and the test moved rather than the row

⛔ **`theTaskYouWereGiven`'s `assignedTo` comparison cannot fail through the door.** `tasksOf` folds
the caller's own ledger and `deriveTasks` stamps every row it produces with the ledger it read, so
the clause is always true for any caller that reached it through `ask_parent`. ⚑ The whole suite
passed with it deleted.

⛔ **The clause is right and the test was missing.** `theTaskYouGave` keeps the identical re-check one
door over and says why — *"the fold decides, not the predicate that found the ledger… a caller that
passed rows from somewhere else must not be able to widen what this answers by choosing its input."*
⚠️ **So the hazard was put on the path the code walks**: `§6` now calls the predicate DIRECTLY with a
row belonging to another conversation, which is the only place a caller really can choose the input.
🔴 **A line no mutation can kill is not carrying its rule** — and the answer was to make the rule
reachable, never to delete the line or retire the row.

## 🔴 608 · TWO ROWS RETIRED, and they are the behaviour this dispatch shipped (HO-084 §4)

⛔ **`M1` was THE DEFECT of this whole table** — *the verb does not HOLD the turn, it returns the
moment the question is delivered* — and `608` made that the behaviour. ⚑ `437` held the turn open
because `TASK_STATES` had no word for *waiting on an answer* and the fold would otherwise have said
*its turn ended and it replied nothing*; `603` built the word, `HO-084` §4 ruled the blocking goes,
and the sentence `M1` protected is now answered by `composeWaitingOnAnAnswer` at every surface.
⚠️ **The row is retired rather than inverted**: what it asserted is no longer a defect, and a row
that measures the current behaviour is not a mutation.

⛔ **`M8` went with it** — *an expiry becomes a REFUSAL*. ⚑ There is no expiry: the call returns
`ok` the moment its three durable writes are made, and standing rule 13's distinction is trivially
satisfied because nothing is waited on. ⚠️ **What replaced both is `608`'s own table**, whose rows
are about the things that now have to work without the hold: the three writes, the escalation, and
the one delivery route that carries every answer.

⛔ **No row on `newAskedQuestionId`'s prefix.** The dispatch branch is a MAP lookup and never a test
on the id's spelling, so a mutation stripping `req_` changes nothing any reader can see — and
`a-line-no-mutation-can-kill-is-not-carrying-its-rule` says to notice that rather than to write an
unkillable row. ⚠️ The prefix is a name, not a type test, and the docblock says so.

⛔ **No row on the escalation arm.** `armEscalationLook` is `398`'s and the ask calls it unchanged;
its rows are in that table.

⛔ **No row putting a remedy on `no-open-work-by-that-name`.** HO-025 §1 allows one on a permanent
rail and this one still must not carry it: the rail folds three causes, so any remedy would be true
of one and false of the others — the `document-registry-unavailable` shape `425` withdrew.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

THE_HOLD = "        given = await Promise.race([answered, expiry])"
# ⚠️ **Three lines in this file read `parent: task.assignedBy` and only one of them is this verb's**
# — the reply's delivery and the ask's return carry it too. ⛔ An anchor that matched all three would
# be a row that cannot be applied at all, which is the failure `verify-each-mutation-row-without-
# running-the-table` catches before a table is ever run.
# ⚠️ **611 · CORRECTED IN PLACE, never retired.** The row records what the asker DECLARED
# (HO-088 §2), so the literal became `input.who`. ⛔ The edge this constant names — the PARENT on
# the routing, read off the task rather than from spawn provenance — is unchanged.
THE_EDGE = (
    # ⚑ **T-003 · re-anchored in place, not retired** — D-009 routes by `answerer` (a named agent, or the task's giver); the row still routes the task-bearing ends by the spawn edge. Re-verified RED alone.
    "      type: 'request_routed',\n      requestId,\n      to: input.who,\n      parent: answerer,"
)
THE_OPENNESS = (
    "      (one) => one.taskId === taskId && one.assignedTo === me && TASK_IS_OPEN[one.state],"
)
THE_LANE = "        'question',"
# ⚠️ **RE-ANCHORED at 679, not retired.** Until 679 two sites read this map by the bare
# `request.requestId`, so the anchor carried the sentence above the ANSWER door's lookup to be unique.
# ⚑ Since 679 every reader asks with the ASKER and the id (`questionKey`, 675 F-b), and the answer
# door's lookup is the only `const held = …` there is — unique on its own line, as the runner
# requires (this dispatch's review corrected the two sentences that said otherwise). The DEFECT M7
# plants is unchanged.
# ⚑ **T-003 · re-anchored in place, not retired** — D-009 moved the lookup into `theWordsOf`; the row still drops the app-held branch at the answer door. Re-verified RED alone.
THE_APP_HELD = "    const held = this.theWordsOf(request.askedBy, request.requestId)"
THE_WORDS = "        AND type IN ('user_input_request', 'question_asked')"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── the ruling itself ──────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT the whole ruling rests on · the verb does not HOLD the turn — it returns "
        "the moment the question is delivered. ⛔ The worker's turn then ends with the question "
        "outstanding, `deriveTasks` stalls the task at `turn_ended`, and the parent is told *its "
        "turn ended and it replied nothing* about a worker that asked it something",
        [(HOST, THE_HOLD, "        given = null")],
    ),
    (
        "M2 · 🔴 THE DEFECT at the EDGE · the question is routed by the SPAWN edge instead of the "
        "task edge, which is `routeRequest`'s derivation reused where it does not belong. ⚠️ "
        "Invisible for every ordinary worker and wrong exactly when `431`'s second parent arrives: "
        "the conversation that gave the work is never told, and the one that merely started the "
        "worker is asked to decide something it knows nothing about",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. The rule is that a question is routed by the TASK edge (the piece's
        # giver, through theOneInItsPlace), not by the SPAWN edge
        # (provider_session.parent_session_id, written once by writeParent at start and never
        # re-parented). The routing is still raiseAQuestion's request_routed.parent (`answerer`),
        # and only `an-agent` overrides it. The plant routes the ledger's parent by the spawn edge
        # for the-parent questions, keeping the D-009 an-agent arm. The two edges coincide for every
        # ordinary worker and differ only when the giver was replaced (R10): the task edge names the
        # replacement, the spawn edge the dead predecessor. It is not visible through
        # list_questions, because that reader spans the predecessor chain
        # (questionsRoutedToWhatItStandsFor), so it is observable only in the worker's own ledger
        # request_routed.parent. NO existing test builds a replaced giver and then reads the
        # worker's request_routed.parent. MISSING TEST (a-question-a-worker-can-ask.test.ts or
        # a-question-names-who-it-is-for.test.ts). A gives worker W a piece (W is started by A, so
        # parentOf(W) === A). A is made unreopenable so that theOneInItsPlace(A) names a replacement
        # A'. W calls ask_question who 'the-parent' about the piece. It asserts W's ledger has
        # request_routed with parent === A' (and not A), and that the question is delivered to A'.
        # Paired positive: with no replacement, parent === A on both edges, so the assertion cannot
        # pass by accident. ⚠️ No test kills it yet: the landing owes one (D-016b part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — The rule is real and nothing
        # pins it: a worker's question must be routed in its own ledger (request_routed.parent) by
        # the TASK edge, meaning the one in the giver's place after an R10 replacement, and never by
        # the SPAWN edge (store.parentOf), which stays the dead predecessor. list_questions spans
        # the predecessor chain, so no reader other than the worker's own ledger row can see the
        # difference. Keep the plant as written; it only differs when the giver was replaced, so the
        # paired positive is the same call with no replacement. Killed by
        # `what-the-tree-landing-left-unpinned.test.ts`.
        [
            (HOST, '      ...(answerer === null ? {} : { parent: answerer }),\n', "      ...(answerer === null\n        ? {}\n        : {\n            parent:\n              input.who === 'an-agent'\n                ? answerer\n                : (this.deps.store.parentOf(speaking) ?? answerer),\n          }),\n"),
        ],
    ),
    # ── the shape of the door ──────────────────────────────────────────────────────────────────
    (
        "M3 · ⛔ the addressing rail is dropped · a worker may aim its question, which is exactly the "
        "primitive HO-015 §1.3 refuses — *\"the model names which task it is finishing, never who to "
        "send it to\"* — and `371`'s defect arriving at a second door",
        [
            (
                TOOLS,
                # ⚠️ **Both doors refuse the same list, so the comment above the call is what makes
                # this anchor the ASK's.** ⛔ `reply_to_parent`'s copy is `393`'s and is not this
                # dispatch's to mutate.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 lets ask_question own an `agent` argument, so the filter skips it; the row still drops the addressing rail. Re-verified RED alone.
                "          const aimed = REPLY_ADDRESSING_KEYS.filter(\n            (key) => key !== ASK_AGENT_ARGUMENT && Object.hasOwn(args, key),\n          )",
                "          const aimed: string[] = []",
            )
        ],
    ),
    (
        "M4 · ⛔ closed work is admitted · `theTaskYouWereGiven` stops folding openness in, so a "
        "worker can ask about work it has already answered or the parent has already taken back — "
        "a question whose answer can reach nothing, and a routing row that will escalate to a person "
        "about work nobody owes",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the ask door is entitled only by OPEN work, so an ask naming a finished piece is
        # refused no-open-work-by-that-name (section 6 cause 3). The held set is now built in
        # heldBy() from openPiecesOf, and the plant widens it to every piece the conversation owns
        # via piecesOwnedBy, so an answered piece is found and the refusal disappears. Killed by
        # `a-question-a-worker-can-ask.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: only OPEN work entitles an ask, so a finished
        # piece is refused `no-open-work-by-that-name`. `heldBy` now builds the set from
        # `openPiecesOf(conversation)`, and the plant widens it to every piece the conversation owns
        # (`piecesOwnedBy`), so an answered piece is found and admitted. Killed by
        # `a-question-a-worker-can-ask.test.ts`.
        [
            (HOST, '      ...this.deps.store.openPiecesOf(conversation).map((one) => ({\n        piece: one.piece,\n', '      ...this.deps.store.piecesOwnedBy(conversation).map((one) => ({\n        piece: one.piece,\n'),
        ],
    ),
    (
        "M5 · 🔴 the lookup stops being the entitlement · the `assignedTo` comparison goes, so a "
        "worker that spells another conversation's task id asks ITS parent a question. ⛔ "
        "`refuse-on-entitlement-before-refusing-on-existence` deleted at the one door that had made "
        "it structural rather than ordered",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a piece is askable only if THIS conversation holds it, so a name that is another
        # conversation's piece is refused no-open-work-by-that-name (section 6 cause 2, notMine).
        # The plant looks the spelled name up in the whole work table through pieceNamed, ignoring
        # who holds it, so the piece is found and admitAsk lets the ask through. The object literal
        # keeps piece, label and giver so nothing throws. Killed by
        # `a-question-a-worker-can-ask.test.ts`.
        [
            (HOST, '? (held.find((one) => one.piece === input.piece || one.label === input.piece) ?? null)', '? ((named) => named === null ? null : { piece: named.piece, label: named.label, giver: named.givenBy })(this.pieceNamed(input.piece))'),
        ],
    ),
    # ── the lane ───────────────────────────────────────────────────────────────────────────────
    (
        "M6 · 🔴 the question takes the WORK slot · `436`'s second half, put back: the question is "
        "delivered as `work`, so a parent already holding a message refuses it and the worker that "
        "asked is blocked for ever. ⛔ It is also `354`'s singleton doing exactly what it was built "
        "to do, to the one kind of message that may never be dropped",
        [(HOST, THE_LANE, "        'work',")],
    ),
    (
        "M7 · ⛔ the app-held answer is forwarded to the provider · the branch goes, so "
        "`answer_question` calls `respondUserInput` with an id no provider ever minted. ⚠️ The "
        "adapter refuses it, the parent is told its answer cannot be sent, and the worker waits out "
        "the whole bound for an answer that was given",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The variable the row
        # forces to undefined (renamed from `held` to `words` at its point of assignment, with
        # `const held = words` re-deriving the old name further down) still gates the same branch:
        # `theWordsOf`'s result decides whether an app-held question is answered locally or
        # forwarded to a provider that never minted the id. Only the variable's name at its
        # declaration changed.
        [
            (HOST, '    const words = this.theWordsOf(request.askedBy, request.requestId)', '    const words = undefined'),
        ],
    ),
    # ── the bound ──────────────────────────────────────────────────────────────────────────────
    (
        "M8 · ⛔ an expiry becomes a REFUSAL · *nobody answered yet* and *your call was wrong* "
        "become one word. ⚑ Standing rule 13's own distinction deleted: the ask WAS performed, the "
        "routing row is open, the parent can still answer it — and the model is told its call failed "
        "and taught to stop using the verb",
        [
            (
                HOST,
                "      return {\n        ok: true,\n        question: requestId,",
                "      if (given === null) {\n        return {\n          ok: false,\n          "
                "refusal: refuseQuestion('question-has-already-ended', { question: requestId }),\n"
                "        }\n      }\n      return {\n        ok: true,\n        question: requestId,",
            )
        ],
    ),
    # ── the words ──────────────────────────────────────────────────────────────────────────────
    (
        "M9 · ⛔ the words go missing · `questionsRaisedIn` reads only the provider's row again, so a "
        "question this app raised lists with `words: null`. ⚑ That is `396`'s own gap restored one "
        "origin over — *a parent handed only ids knows a question exists and cannot answer it* — and "
        "it bites hardest after a resume, when the message carrying the words is gone",
        [(STORE, THE_WORDS, "        AND type IN ('user_input_request')")],
    ),
    (
        "M10 · ⛔ the ending is never written · the `user_decision` row on the app-held branch goes, "
        "so the request derives `open` for ever. ⚠️ `list_questions` goes on naming a question "
        "nobody is waiting for, and the escalation sweep eventually tells a PERSON about a decision "
        "that was made",
                # \u26a1 **477 re-anchored this in place** \u2014 the row grew the actor HO-029 \u00a72.1
                # requires. \u26a1 **591 re-anchored it again**: the settle stopped following the row
                # directly, because a late answer now takes the OTHER route
                # (`RuntimeHost.deliverAnswer`) and the branch that chooses sits between them.
                # \u26d4 The rule is unchanged and is the one that matters most here: the app-held
                # branch must write the ending, whichever route the answer then takes.
                # Re-verified RED individually.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The app-held branch's
        # user_decision write the row protects still exists, just consolidated: answerQuestion's
        # held-answered branch now calls the shared `decideAQuestionThisAppAsked(...)` (which itself
        # does the writeIntoItsLedger write) instead of inlining `this.publishOurs(session, {...})`.
        # Removing that call still deletes the row entirely, exactly as the original mutation did.
        [
            (HOST, "      // 🔴 **477 · the caller, at the moment the answer is taken** — and `speaking` above is\n      // already this same derivation, so the row and the entitlement cannot disagree about who\n      // is answering. ⛔ Never `input`: no tool argument reaches this field.\n      this.decideAQuestionThisAppAsked(request.askedBy, request.requestId, 'answered', by)\n", ''),
        ],
    ),
    # ── the design that was refused ────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 the reach is widened instead · the alternative design, put back: a fourth clause "
        "in `withinMessagingReach` admitting the conversation that gave this caller work. ⛔ It "
        "delivers the criterion and takes `message_agent` with it — a worker could then assign WORK "
        "to its parent — which is why `437` built the verb on the task edge and moved no gate at all",
        [
            # ⚠️ **RE-ANCHORED at 692, not retired.** 692 reads the self arm off `target` (the slot, or what the quit closed). The DEFECT this row plants is unchanged.
            (
                HOST,
                '    if (target.id === me) return true',
                '    if (target.id === me) return true\n    {\n      const asking = sessionSpeakingAs(by)\n      if (\n        asking !== null &&\n        this.deps.store\n          .tasksOf(asking)\n          .some((one) => TASK_IS_OPEN[one.state] && one.assignedBy === sessionId)\n      ) {\n        return true\n      }\n    }',
            )
        ],
    ),
    (
        # ⚑ **710 · the consequence CORRECTED** (`707` F-5's class, found by `710`'s review): since
        # `553` a message that declares no kind is a QUESTION, so `workBeingAssigned` answers null for
        # the worker as caller too; what the mutant does is deliver the app's words as the worker's.
        "M12 · ⛔ the question is delivered as the WORKER rather than as the app · the app's routed "
        "words arrive as the worker's — its declared kind on the parent's turn, its receipt, its "
        "reach asked",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the app's routed question is delivered as the app,
        # not as the worker. `questionText` now takes `{called, address}` and the call ends in `{
        # carriedFor: asked, ...about }`, so the anchor is the tail of the call and the plant hands
        # `{ ownerId: `agent:${asked}` }` in place of `THE_APP_ITSELF`. Killed by
        # `a-question-a-worker-can-ask.test.ts`, `a-question-finds-a-person.test.ts`.
        [
            (HOST, "        THE_APP_ITSELF,\n        [],\n        'question',\n        { carriedFor: asked, ...about },\n      )", "        { ownerId: `agent:${asked}` },\n        [],\n        'question',\n        { carriedFor: asked, ...about },\n      )"),
        ],
    ),
]
