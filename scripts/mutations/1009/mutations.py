"""1009 · D-009 · agents ask each other by name, and the answer comes back (`6362c494`).

⚑ **Why `1009`** (T-002's rule): a table id must be a positive integer, so card D-00N's table is
`100N`.

F012: a question could go only to the asker's parent or a person, and an agent's question to a peer
had no way back. D-009 gave `ask_question` a third end (`an-agent`, a conversation the caller may
name, never itself; no task needed), `answer_question` a `cannot_answer`, a new `withdraw_question`,
a pass-up refusal for a question asked of you by name (ruling 2), a closing with no clock when the
recipient really ends (`recipient-ended`, the asker told), decision 4 (a quit no longer loses a
question), and no false stall notice for a taskless question.

Rows M1–M26 are the host, store and fold side; M27–M40 are the tool doors, the shared vocabulary
(`questions.ts`' fold), the digest and the app notice; M41–M45 were added after T-003's review.
Designed read-only by T-003 and verified one at a time.

## ⚠️ What has no row here, and why (host side)

- **The whole `tellTheAskersItEnded(session.id)` call.** Covered by M9 (the close) and M10 (the
  telling). Either half dark is already red on the same test.
- **`'question_withdrawn',` and `'question_recipient_ended',` in `selectRoutedRequestEvents`.** Both
  are pinned by a-question-finds-a-person.test.ts ('⛔ the store’s narrow read selects every type the
  routing fold acts on'). A row would mostly measure that census; the withdraw and ruling-5 tests
  would also go red.
- **The `stillOpen` widening** (`...this.deps.store.whatTheQuitClosed()` → `elsewhere` alone).
  Nearly equivalent. At a second launch the stranded re-route is masked, because
  `reopenTheQuestionsAQuitLeftOpen` routes the FIRST quit's abandoned row again (still `abandoned &&
  endedAt === last`). Only a quit teardown that wrote no terminal `status` could tell the
  difference. `nothing-waits-on-somebody-looking` pins only `settleStrandedRequests(this.now(),
  stillOpen)`.
- **The reopen sweep's `request.endedAt !== last`.** Nearly equivalent in reachable runs, since the
  fold ignores a second `request_routed` while one is open. What it guards is untested: a question
  abandoned by an earlier REAL ending, words lost to a restart, and a later quit. Thin-coverage
  note.
- **The reopen sweep's `went.is === 'the-person-the-channel-left-it-with'`.** Equivalent: a
  channel-refused request is always the provider's, and the raisedBy line (M24) already excludes it.
- **`selectLastTerminalStatusAt`'s `IN ('ended', 'errored')`.** Subsumed by M12.
- ⚑ **Rowed after review** (T-003's review disproved an equivalence first claimed here): the two
  `questionsThisAppHolds.delete(...)` calls are M41 and M42 (the PERSON's door, `respondUserInput`,
  reads the map and never asks whether the question is open), and answerQuestion's `keptOpen` guard
  is M43 (`675`'s crashed asker keeps its question open).
- **answerQuestion's `raisedBy === 'this-app'` resume guard.** Nearly equivalent: a provider's
  request of a quit-left asker is `abandoned`, and `admitAnswer` refuses it first.
- ⚑ **The recipient-ended sweep's `raisedBy !== 'this-app'` rail** is M44 (added after review).
- **raiseAQuestion's `|| input.who !== 'an-agent'`** (the host still requiring a task for the parent
  and a person). The tool layer (agent-tools.ts) refuses 'task_id is required' first,
  so a host row would survive every tool-driven test. It is defence in depth. A direct
  `host.raiseAQuestion({ taskId: null, who: 'the-parent', … })` test is missing.
- **`...(task === null ? {} : { taskId: task.taskId })`.** Its failure (a `''` taskId) lands in the
  same stall exemption M17/M18 measure.
- **question-rails.ts.** Not rowed:
  - the `It said:` line in `answerText` (same killer as M15);
  - the PERMANENCE/REMEDY entries of the three new rails (pinned by a-refusal-carries-its-remedy's
    counts 77/93);
  - the rail sentences and `recipientEndedText` wording (text; the card test quotes the sentence
    exactly).
- **`NULL_SESSION_STORE.reopenTheQuestionsAQuitLeftOpen: () => 0`.** A null double.

Two product observations, not rows:
- **(a) The person's answer door, after a quit (MEASURED by T-003).** `respondUserInput` still reads
  only the in-memory `questionsThisAppHolds`; D-009 gave only `answerQuestion` the ledger fallback
  `theWordsOf`. After a quit and relaunch the person-held question that 692 §6 says *comes back* is in
  the person's queue, and answering it throws `unknown session`; after reopening the asker it is
  refused *"the agent is no longer waiting for an answer to this"*, and it stays `open` in the queue.
  Reported to the PM as a DEV card.
- **(b) Ledger growth at every launch.** The reopen sweep appends a no-op `request_routed` per
  surviving question at every launch while the asker stays closed. The first quit's abandoned row
  keeps matching `abandoned && endedAt === last`, and the fold ignores the duplicate. It is
  harmless, but it grows the ledger once per launch.

## ⚠️ What has no row here, and why (tool side)

- **The `agent` argument swallowed by the addressing rail** (dropping `key !== ASK_AGENT_ARGUMENT
  &&` in ask_question's `REPLY_ADDRESSING_KEYS.filter`). It has the same killers and the same
  observable as M27: the third end is unreachable, `askBo` is refused. M27 covers it. `437 M3`
  (re-anchored by T-003) drops the whole filter beside it.
- **The ask door's `agent is required when who_answers is an-agent`**. This is an equivalent mutant
  at the edge: the host refuses `agent ?? ''` with `no-agent-you-can-ask-by-that-name`, so only the
  refusal's wording would change, and no test sends an-agent without `agent`.
- **The ask door's `task_id is required` for the parent or a person**. The host's `admitAsk(null,
  '')` refuses the same call (`no-open-work-by-that-name`), so the boundary holds either way. Only
  §1.4's `toContain('task_id is required')` string sees the difference. This is defence in depth,
  not a card boundary.
- **The `cannot_answer` empty-string check.** Thin coverage: no test sends an empty reason. Its
  REPLY_SUMMARY_LIMIT bound is M45 (added after review): without it an unbounded agent-written text
  reaches another conversation's turn, `437`'s bound missing at a new field.
- **The door half of `withdraw_question`**. Whose question, and whether it is open, are rails in
  `RuntimeHost.withdrawQuestion` on the other side. The door only passes `question` through. M35
  covers the fold half.
- **`TOOL_NAMES` `'withdraw_question'`, `TOOL_INPUT_ENUMS['pass_question_up:who_answers']` reverted
  to `QUESTION_RECIPIENT_INPUT`, `WENT_STANDS_FOR`'s new entry, and `RECIPIENT_MEANS['an-agent']`**.
  These rows would be killed only by censuses: the-five-tools 22, THE_SPLIT,
  a-question-names-who-it-is-for, every-tool-enum-is-documented. M33 covers the advertisement's
  behaviour. A `RECIPIENT_MEANS['an-agent']` copied from another member would likely SURVIVE: the
  sentence test compares the table with itself and it has no distinctness check. That is a minor
  model-facing gap.
- **transcript.ts `case 'question_withdrawn': case 'question_recipient_ended': return`**. This is an
  EQUIVALENT mutant at runtime. `foldEvent`'s `default` also returns without an item, so only tsc's
  `never` sees the removal. The transcript.test `adds: 0` rows cannot tell the two apart.
- **describe-event.ts's two new debug-drawer strings**. No test reads them. A change to '(per the
  transcript)' would survive. It is a plausible but low-value surface, noted here as thin coverage.
- **`anOpenQuestionAboutNoWork`'s three filters**:
  - Dropping `(asked.taskId ?? null) === null` is near-EQUIVALENT under criterion 13's one-open-task
    singleton. A worker's open question about work X coincides with X being its only open task, and
    a question outliving closed X is a narrow case.
  - Dropping `raisedBy === 'this-app'` makes a provider's user-input card (taskless) compose the
    worker's task as `waiting-on-an-answer` instead of `working`. That is arguably not a defect, and
    no test is on it.
  - Dropping `passedUpFrom === null` only changes precedence (`waiting-on-a-worker` →
    `waiting-on-an-answer`) for a mid-chain passer.
  - All three are unpinned, and the function has no unit test. Only the E2E positives behind M17, M20 and M38 touch it.
- **The recipient-ended word swapped to `abandoned`**. The same assertion kills it, and M36 (never
  closes) is the stronger defect.
- **The success payload's `agent` field and the success and decline sentences**. These are text
  only.
- **Stale prose** (comments, not rowable):
  - questions.ts `QuestionRecipient` docblock: 'two ends, and only two… An agent that wants a THIRD
    conversation's opinion sends it a message'.
  - `isQuestionRecipient`: 'Is this one of the two ends?'.
  - `WhereARequestWent`: 'one field, three arms'.
  - agent-tools answer_question `beyondItsRails` note: 'An answer into a conversation the caller
    started'.
  - Model-facing, and narrower than the new scope: list_questions' empty sentence 'no conversation
    you started has asked you anything'.

## Verification

T-003 verified every row alone with `verify_row.py` (applied, its own killer files run, restored
from bytes). The table has not been run.
- RED on D-009's own tests: M1–M19, M27–M30, M32–M37, M40.
- ⚠️ **Nine SURVIVED D-009's own tests, and T-003 added the missing test for each** (all RED now):
  - M20: the person's queue and the Work tab (the store's wait read) for a worker waiting on a peer;
  - M21: an answered or withdrawn question is not told again when its recipient ends;
  - M22: a child's question to its PARENT closes when the parent's conversation ends;
  - M31: answers and `cannot_answer` together on an OPEN question are refused;
  - all in `agents-ask-each-other.test.ts`;
  - M23, M24, M26: a model's own question (withdraw refused, not routed again after a quit, a
    decline said to the provider), in `a-models-own-question-stays-the-models.test.ts`;
  - M25: the notice row a ruling-5 asker receives carries its subject (`agents-ask-each-other`), and
    the third producer is pinned in `a-message-says-who-wrote-it.test.ts`'s census;
  - M39: a peer question is not counted as a person's decision, in
    `a-person-who-never-answered.test.ts` (asked of an agent a person opened, so the count does not
    depend on the order of two async chains).
- ⚑ **After T-003's review**: M38 re-aimed (it had planted M17 and M20 together) and RED on the
  card's tests; M43 RED on `what-a-close-does-that-a-reopen-never-undoes.test.ts`; M41, M42, M44 and
  M45 are new rows, each of which SURVIVED until T-003 added its test (a person's answer to a
  withdrawn question, to one whose recipient ended, a model's question kept open when its parent
  ends, the decline's length bound).
- ⚠️ Not a row, and reported to the PM: after a quit, a question addressed to a PERSON comes back in
  the person's queue but cannot be answered there (measured by T-003: `unknown session` before the
  asker is reopened, *"the agent is no longer waiting"* after), and the digest counts a question to a
  named agent under *"N questions travelled to a parent"*.
"""

HOST = 'apps/desktop/src/main/runtime/runtime-host.ts'
TASKS = 'apps/desktop/src/shared/tasks.ts'
STORE = 'apps/desktop/src/main/db/session-store.ts'
QUESTIONS = 'apps/desktop/src/shared/questions.ts'
TOOLS = 'apps/desktop/src/main/runtime/agent-tools.ts'
DIGEST = 'apps/desktop/src/main/runtime/digest.ts'
NOTICE = 'apps/desktop/src/shared/app-notice.ts'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **THE DEFECT, restored (F012): the question reaches the peer, but the peer's answer has no way back.** The routing names the asker's giver (or nobody, for a question about no task) as the one who answers, not the agent named. So the peer is sent the words, `list_questions` does not show it, and its `answer_question` is refused. · killed by `agents-ask-each-other.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A question to
        # a named agent is routed to that agent and no other; `request_routed` still carries
        # `parent: answerer` where the answerer is the agent named. The plant routes an agent
        # question to the piece's giver instead, and to nobody when the question names no piece.
        # Killed by `agents-ask-each-other.test.ts`.
        [
            (HOST, '      ...(answerer === null ? {} : { parent: answerer }),\n', "      ...(input.who === 'an-agent'\n        ? piece === null || piece.giver === null\n          ? {}\n          : { parent: piece.giver }\n        : answerer === null\n          ? {}\n          : { parent: answerer }),\n"),
        ],
    ),
    (
        'M2 · ⛔ **the delivery half: a question to an agent by name is routed to it but never delivered.** Only `the-parent` is summoned, so the peer is never told it is being asked. · killed by `agents-ask-each-other.test.ts`',
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The delivery
        # of a question to the agent it was asked of survives in `if (answerer !== null && (went ===
        # 'the-parent' || went === 'an-agent'))`. The plant delivers only to a parent, so a peer
        # question is recorded and never told to the peer. Killed by
        # `agents-ask-each-other.test.ts`.
        [
            (HOST, "    if (answerer !== null && (went === 'the-parent' || went === 'an-agent')) {\n", "    if (answerer !== null && went === 'the-parent') {\n"),
        ],
    ),
    (
        "M3 · ⛔ **ruling: a peer question needs no task, broken.** The host admits a question only against the caller's own open work again, whoever it is for, so an agent that holds no work cannot ask a peer anything. · killed by `agents-ask-each-other.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a peer question needs no piece at the door survives as `if (input.piece !== null ||
        # aboutWork)`, where `aboutWork` is false for an agent-to-agent question. The plant runs the
        # piece admission for every question, so a peer question about no piece is refused
        # `no-piece-to-ask-about`. Killed by `agents-ask-each-other.test.ts`.
        [
            (HOST, '    if (input.piece !== null || aboutWork) {\n', '    {\n'),
        ],
    ),
    (
        "M4 · ⛔ **'never itself', dropped: an agent may address a question to itself by name.** `withinMessagingReach` admits the caller's own id (its `me` clause), so the reach check alone lets it through. · killed by `agents-ask-each-other.test.ts`",
        [
            (HOST, "agent === '' || agent === speaking ||", "agent === '' ||"),
        ],
    ),
    (
        "M5 · ⛔ **'only an agent the asker may name', dropped.** Any id is accepted, including one that is no conversation at all or one outside the caller's messaging reach. The question is routed to it and 'asked'. · killed by `agents-ask-each-other.test.ts`",
        [
            (HOST, ' || !this.withinMessagingReach(agent, by, speaking)) {\n', ') {\n'),
        ],
    ),
    (
        "M6 · ⛔ **ruling 2 narrowed: a question asked of you by name may be passed up to a PERSON.** Only a pass to the parent is refused, so the one asked can hand its peer's question to the person instead of answering it or saying it cannot. · killed by `agents-ask-each-other.test.ts`",
        [
            (HOST, "    if (request.went.is === 'the-agent-the-asker-named') {\n", "    if (request.went.is === 'the-agent-the-asker-named' && input.who === 'the-parent') {\n"),
        ],
    ),
    (
        'M7 · 🔴 **withdraw_question answers ok and closes nothing.** No `question_withdrawn` row is written, so the question stays open, the asker still reads waiting, and a late answer is still taken. · killed by `agents-ask-each-other.test.ts`',
        [
            (HOST, "    this.publishOurs(session, { type: 'question_withdrawn', requestId: input.requestId })\n", '    void session\n'),
        ],
    ),
    (
        "M8 · ⛔ **'only its own OPEN question': an asker may withdraw a question that has already ended.** The door checks only that it asked it, so a second withdrawal, or one of an answered question, reports ok. · killed by `agents-ask-each-other.test.ts`",
        [
            (HOST, '    if (!open || asked', '    if (asked'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The whole 'recipient really ends →
        # close question → tell asker' sweep is gone: `question_recipient_ended`,
        # `tellTheAskersItEnded`, `tellTheAskerNobodyWillAnswer` and the `endedByItsParent` field it
        # read all have zero occurrences in the post-commit file (present in 5206d835^). D-017
        # abolished 'ending' itself (`end_agent` is gone), and the new test
        # `agents-ask-each-other.test.ts` §3b is titled exactly 'a recipient the quit is closing
        # owes nothing yet: the question stays open, and nobody is told' — the old defect
        # description is now the ruled behaviour. Its anchor is left stale, so the census records it
        # retired.
        "M9 · 🔴 **no clock and no ending either: the recipient's conversation really ends and the question stays OPEN.** The asker is told, but nothing closes the question (`question_recipient_ended` is never written). It keeps reading 'waiting on an answer' forever, and a later answer could still be taken. · killed by `agents-ask-each-other.test.ts`",
        [
            (HOST, "        this.publishOurs(asker, {\n          type: 'question_recipient_ended',\n          requestId: request.requestId,\n          recipient,\n        })\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `tellTheAskerNobodyWillAnswer` (the
        # function M10's plant neutralized) no longer exists anywhere in runtime-host.ts; it was
        # part of the same 'recipient ended' sweep M9 protected, deleted because nothing can really
        # end a conversation any more (end_agent is gone). `agents-ask-each-other.test.ts` §2 now
        # asserts the opposite: 'the recipient's conversation STOPS — the question stays open, the
        # asker is told nothing'. Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 **the recipient ends: the question is closed but the asker is never told.** The notice `tellTheAskerNobodyWillAnswer` queues is not sent, so the asker's turn never learns it must ask someone else. · killed by `agents-ask-each-other.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `tellTheAskersItEnded`
        # still notifies a running asker via `tellTheAskerNobodyWillAnswer` when its recipient ended
        # (only reformatted: the inline object literal became the pre-built `question` variable).
        # Swallowing that call plants the same silent-drop defect.
        [
            (HOST, '        void this.tellTheAskerNobodyWillAnswer(asker.id, recipient, question)\n', '        void ((..._told: unknown[]) => undefined)(asker.id, recipient, question)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `session.endedByItsParent` is gone from
        # the codebase entirely (checked via grep; present pre-commit, absent post-commit), so there
        # is no 'quit's teardown vs. parent-ending' distinction left to blur.
        # `agents-ask-each-other.test.ts` §3b's title — 'the quit's own teardown is not the
        # recipient's ending' — is the direct, deliberate descendant of this exact finding, now
        # asserted as the rule rather than guarded against as a defect. Its anchor is left stale, so
        # the census records it retired.
        "M11 · 🔴 **decision 4, crossed: a quit's own teardown is read as the recipient's ending.** Every question owed by a conversation the quit is closing is closed `recipient-ended`, and its still-running askers are told nobody will answer, although the quit leaves the recipient open. · killed by `agents-ask-each-other.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The mechanism changed
        # shape (blocklist `!theQuitWasClosing` → allowlist `endedByItsParent !== null`) but the
        # rule the row protects is unchanged and now has its own dedicated test: '§3b · the quit's
        # own teardown is not the recipient's ending' (agents-ask-each-other.test.ts:766). Making
        # the call unconditional again crosses a quit's teardown with a real ending, exactly as the
        # old row did.
        [
            (HOST, '    if (session.endedByItsParent !== null) this.tellTheAskersItEnded(session.id)\n', '    this.tellTheAskersItEnded(session.id)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Ruling 14 deleted the launch
        # sweep `reopenTheQuestionsAQuitLeftOpen` on purpose (c3-rulings.md: "R16's
        # reopenTheQuestionsAQuitLeftOpen goes"; spec: "constructor sweep ... deleted (ruling 14)").
        # A question now survives a stop by D-017 R3/R4, so the row's subject is gone. Its anchor is
        # left stale, so the census records it retired.
        "M12 · 🔴 **decision 4, the launch half: a question does NOT survive a quit.** The launch never routes again the app's own questions that the quit's ending abandoned, so they come back `abandoned`: still listed, but as over, unanswerable, and gone from the person's queue. · killed by `agents-ask-each-other.test.ts` and `a-restart-keeps-what-was-open.test.ts`",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The commit only wraps
        # this call with a skip-counter (rowsUnreadOnce()/sayTheSweep) for D-017's own ledger-skip
        # reporting; the launch still calls reopenTheQuestionsAQuitLeftOpen exactly once,
        # unconditionally, so D-009's rule that a quit-left-open question is routed again at launch
        # is untouched. Hardcoding the result to 0 (dropping the real call) still plants 'the launch
        # never routes again' exactly as before.
        [
            (HOST, '    const kept = this.deps.store.reopenTheQuestionsAQuitLeftOpen(this.now(), keptSkipped)\n', '    const kept = 0\n'),
        ],
    ),
    (
        # ⚑ Landing D-017 (45a11477) · killer:
        # `an-answer-to-a-quit-left-asker-really-starts-it.test.ts` (the landing added it; the old
        # killer no longer reaches this start).
        "M13 · 🔴 **decision 4, the answer half: an answer to an asker the quit left open does not start it.** The asker has no session, so the peer's answer is refused 'the conversation that asked has gone', although the question survived the quit. · killed by `agents-ask-each-other.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Decision 4's answer half
        # is now the single `ensureRunning(asker, window, null)` call inside `deliverAnswer`'s
        # not-running branch — the direct successor of the old `resumeSession(request.askedBy,
        # null)` call. Replacing the real start with a no-op plants the same 'an answer to a
        # quit-left-open asker does not start it' defect.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) took ensureRunning's third argument away. Killer §3 'its answer starts the asker' still waits for the answer to reach Ada after a quit.
            (HOST, "      await this.ensureRunning(asker, window)\n", "      await Promise.resolve(asker)\n"),
        ],
    ),
    (
        "M14 · 🔴 **decision 4, the words half: after a restart the app no longer knows a surviving question is its own.** `theWordsOf` stops reading the asker's `question_asked` row, so the answer is forwarded to the asker's PROVIDER as if the provider had raised it, and the provider refuses it (not pending). · killed by `agents-ask-each-other.test.ts`",
        [
            (HOST, "    if (asked?.raisedBy !== 'this-app') return undefined\n", "    if (asked?.raisedBy !== 'this-app' || held === undefined) return undefined\n"),
        ],
    ),
    (
        "M15 · ⛔ **'says it cannot', silenced: the asker is told the peer declined, but never WHY.** The `cannot_answer` reason is dropped on the way back. · killed by `agents-ask-each-other.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The `cannot` reason is
        # still threaded into `deliverAnswer`'s last argument (now inside a ternary rather than a
        # bare call); dropping it silences why the peer declined, exactly as before.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 added deliverAnswer's window and stopAs parameters after `said`; the reason is dropped by passing null in its slot so stopAs keeps its position. Killer still asserts 'It said: I have never seen that schema' reaches the asker.
            (HOST, "          : this.deliverAnswer(words, request.requestId, speaking, null, cannot, null, stopAs)\n", "          : this.deliverAnswer(words, request.requestId, speaking, null, null, null, stopAs)\n"),
        ],
    ),
    (
        'M16 · ⚠️ **a decline is recorded as an ANSWER.** `cannot_answer` closes the question `answered`, so every surface reads that the peer answered when it said it could not. · killed by `agents-ask-each-other.test.ts`',
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The app-raised branch
        # still writes the decline through `decideAQuestionThisAppAsked(..., 'rejected', by)` (the
        # provider-raised branch was split into its own `writeIntoItsLedger` call by this commit,
        # but the agent-to-agent branch this row's killer test exercises is unchanged in shape).
        # Recording it as `'answered'` plants the same defect.
        [
            (HOST, "        this.decideAQuestionThisAppAsked(request.askedBy, request.requestId, 'rejected', by)\n", "        this.decideAQuestionThisAppAsked(request.askedBy, request.requestId, 'answered', by)\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Plan R14 (D-016): "a
        # question about no piece holds nothing", and `anAnswerAboutNoWork` /
        # `anOpenQuestionAboutNoWork` were deleted on purpose. The killer's comment says "609's
        # composition case (an open question about no work holds every piece its asker holds) went
        # with anAnswerAboutNoWork." Its anchor is left stale, so the census records it retired.
        "M17 · 🔴 **a peer question sends the asker's giver a FALSE stall notice.** The host's wait read never counts an open question about no work, so a worker that asked a peer mid-work reads `stalled` when its turn ends and its giver is pushed 'not being worked on'. An idle asker reads as waiting on nothing. · killed by `agents-ask-each-other.test.ts`",
        [
            (HOST, '        anAnswerAboutNoWork: anOpenQuestionAboutNoWork(routings, raised),\n', '        anAnswerAboutNoWork: false,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The taskless-peer-question
        # wait was reversed on purpose by plan R14: `openQuestionsByWork` skips a question naming no
        # piece, and its docstring says "Until D-016 such a question held every task its asker had;
        # a piece now waits only on a question about itself." The row protected the old rule. Its
        # anchor is left stale, so the census records it retired.
        "M18 · 🔴 **the per-task reading ignores an open question about no work.** `composeWhatEachTaskIsWaitingOn` asks only whether THIS row has a question, so a peer-asking holder's work reads `stalled` on list_tasks, the Work tab and the stall push. · killed by `agents-ask-each-other.test.ts` and `the-conversation-that-is-waiting.test.ts`",
        [
            (TASKS, '      outstanding.answers.has(task.taskId) || outstanding.anAnswerAboutNoWork,\n', '      outstanding.answers.has(task.taskId),\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Plan R14 removed the rule
        # that an answer about no work moves every piece its asker holds; `anAnswerAboutNoWork` is
        # gone from `composeWhatEachPieceIsWaitingOn`, which now reads only
        # `outstanding.answers.has(piece.piece)`. The killer's comment records that 609's
        # composition case went with it. Its anchor is left stale, so the census records it retired.
        'M19 · ⚠️ **the conversation-level reading ignores an open question about no work.** An agent that asked a peer and holds no work reads as waiting on nothing on the Team plates and the rail. · killed by `agents-ask-each-other.test.ts` and `the-conversation-that-is-waiting.test.ts`',
        [
            (TASKS, '  return whichWait(outstanding.answers.size > 0 || outstanding.anAnswerAboutNoWork, outstanding)\n', '  return whichWait(outstanding.answers.size > 0, outstanding)\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Plan R14: a question about
        # no piece holds nothing, and `anOpenQuestionAboutNoWork` was deleted on purpose
        # (`theWaitAConversationIsIn` now reads `answers.size > 0` only). The rule the row protected
        # is reversed, not moved. Its anchor is left stale, so the census records it retired.
        "M20 · ⚠️ **the person's queue and the Work tab still call a peer-asking worker's work stalled.** The STORE's wait read (`whatThisConversationIsWaitingOn`, behind `workGivenOutBy`, the placed forest and `stalledWorkNobodyWasToldAbout`) never counts an open question about no work, while list_tasks (the host's read) says `waiting-on-an-answer`. The two disagree · killed by `agents-ask-each-other.test.ts` (the test T-003 added)",
        [
            (STORE, '      anAnswerAboutNoWork: anOpenQuestionAboutNoWork(routings, raised),\n', '      anAnswerAboutNoWork: false,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** This plant weakened the
        # `REQUEST_IS_OPEN` guard inside the same 'recipient ended' sweep that M9-M11 protect; that
        # whole sweep (and the loop it lived in) is deleted along with
        # `end_agent`/`endedByItsParent`. There is nothing left in runtime-host.ts iterating routed
        # requests to close them on a conversation 'really ending'. Its anchor is left stale, so the
        # census records it retired.
        "M21 · ⚠️ **an ANSWERED question's asker is told 'nobody will answer it' when the answerer later ends.** The recipient-ended sweep drops its open-state guard, so it re-closes (a fold no-op) and notifies for every question ever routed to the ending conversation, answered or withdrawn ones included · killed by `agents-ask-each-other.test.ts` (the test T-003 added)",
        [
            (HOST, "        if (!REQUEST_IS_OPEN[request.state]) continue\n        if (request.went.is !== 'the-agent-the-asker-named'", "        if (request.went.is !== 'the-agent-the-asker-named'"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** Same dead sweep as M21 — the `went.is
        # !== 'the-agent-the-asker-named' && ... !== 'the-parent'` filter lived inside
        # `tellTheAskersItEnded`, which is gone. Ruling 5's peer/parent distinction has nothing left
        # to apply to now that nothing ends a conversation. Its anchor is left stale, so the census
        # records it retired.
        "M22 · ⚠️ **ruling 5 applied to a peer only: a child's question to its PARENT stays open forever when the parent's conversation really ends.** The sweep closes only `the-agent-the-asker-named`, so the child keeps waiting on an answer nobody will give, and is never told · killed by `agents-ask-each-other.test.ts` (the test T-003 added)",
        [
            (HOST, "        if (request.went.is !== 'the-agent-the-asker-named' && request.went.is !== 'the-parent') {\n", "        if (request.went.is !== 'the-agent-the-asker-named') {\n"),
        ],
    ),
    (
        "M23 · ⚠️ **an asker may 'withdraw' a PROVIDER's own request.** The door checks only that the id is an open routing in the caller's ledger, not that this app raised it, so a model's live user-input card is written `withdrawn` while the provider is still parked on it · killed by `a-models-own-question-stays-the-models.test.ts` (the test T-003 added)",
        [
            (HOST, " || asked?.raisedBy !== 'this-app') return refused\n", ') return refused\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** It was the guard inside the
        # deleted launch reopen sweep (ruling 14), so its subject was removed on purpose. What
        # survives is D-017 R4, a question this app asked outlives a stop, which is a different line
        # (see other_notes for a suggested plant). Its anchor is left stale, so the census records
        # it retired.
        "M24 · ⚠️ **the launch routes again a PROVIDER's request a quit abandoned.** A model's user-input question comes back `open` after the relaunch, with no provider holding it. The parent is offered it in `list_questions` · killed by `a-models-own-question-stays-the-models.test.ts` (the test T-003 added)",
        [
            (STORE, "        if (raised.get(request.requestId)?.raisedBy !== 'this-app') continue\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** The `appNotice:
        # 'a-question-that-will-not-be-answered'` notice this row's plant strips the subject from
        # does not exist anywhere in the current file (grep for the literal string returns nothing)
        # — it was written only by the now-deleted `tellTheAskerNobodyWillAnswer`. There is no
        # 'nobody will answer' notice left to mis-author. Its anchor is left stale, so the census
        # records it retired.
        "M25 · ⚠️ **the 'nobody will answer' notice is written with no SUBJECT.** Without `appNotice: 'a-question-that-will-not-be-answered'` it is a subjectless app-authored turn, which the transcript fold routes to the plan go-ahead's ContinuationItem and caption, not to the notice that says the app wrote it · killed by `agents-ask-each-other.test.ts` (the row a ruling-5 asker receives) and `a-message-says-who-wrote-it.test.ts` (the producer census)",
        [
            (HOST, "        { appNotice: 'a-question-that-will-not-be-answered' },\n", '        {},\n'),
        ],
    ),
    (
        "M26 · ⚠️ **cannot_answer on a PROVIDER's request is recorded `rejected` but never sent to the provider.** The ledger says it was declined, while the asker's model stays parked on the request forever · killed by `a-models-own-question-stays-the-models.test.ts` (the test T-003 added)",
        [
            # ⚑ **a declined question keeps its reason · re-anchored in place, not retired** — the call now hands the provider the decline's reason too; the row still removes the whole call
            (HOST, "          await session.handle.respondUserInput(request.requestId, {\n            kind: 'reject',\n            reason: cannot,\n          })\n", "          await Promise.resolve(request.requestId)\n"),
        ],
    ),
    (
        'M27 · 🔴 **THE DEFECT, restored (F012): no third end.** `QUESTION_RECIPIENTS` loses `an-agent`, so `ask_question` refuses `who_answers: \'an-agent\'` as malformed. An agent can reach a peer only through `message_agent`, and nothing carries the peer\'s reply back: Ana\'s answer to *"the person says hi"* stays in her own transcript. · killed by `agents-ask-each-other.test.ts`',
        [
            (QUESTIONS, "  'an-agent',\n] as const satisfies readonly QuestionRecipient[]", '] as const satisfies readonly QuestionRecipient[]'),
        ],
    ),
    (
        'M28 · 🔴 **a peer question needs a task again** (plan §3.2 crossed). In the `an-agent` branch the door requires `task_id` the way the other two ends do. An agent that holds no work, or asks about none of it, cannot ask a peer at all. · killed by `agents-ask-each-other.test.ts`',
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — A peer
        # question must name the piece it is about or the door refuses it as malformed for an
        # agent-to-agent ask; the `ask_question` validator still accepts an absent piece for
        # `an-agent`. The plant makes the piece mandatory for `an-agent`, so a pieceless peer
        # question is `malformed-request`. Killed by `agents-ask-each-other.test.ts`.
        [
            # ⚑ **602 · re-anchored in place, not retired** — Declared-field diagnostics replace the old problem string; the same guard still permits pieceless peer questions, and the mutation makes their piece mandatory. Source-only, NOT VERIFIED.
            (TOOLS, "          if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {\n            if (typeof piece !== 'string') wrongType(ASK_PIECE_ARGUMENT)", "          if (who === 'an-agent' ? typeof piece !== 'string' || piece.length === 0 : piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {\n            if (typeof piece !== 'string') wrongType(ASK_PIECE_ARGUMENT)"),
        ],
    ),
    (
        "M29 · ⛔ **an agent named beside the parent or a person is silently ignored.** `ask_question {who_answers: 'the-parent', agent: X}` is no longer refused, and the question goes to the parent while the model believes it asked X. `agent` left `REPLY_ADDRESSING_KEYS`' filter in D-009, so this check is the only thing that still refuses it for the other two ends. · killed by `a-question-a-worker-can-ask.test.ts`",
        [
            (TOOLS, '            if (agent !== undefined) {', '            if (false && agent !== undefined) {'),
        ],
    ),
    (
        "M30 · 🔴 **the decline's reason is dropped at the door.** `answer_question {cannot_answer}` reaches the host as an empty answer (`cannot: null`), so the one asked cannot say it can't answer. It is refused for a missing part, and the asker is never told why. · killed by `agents-ask-each-other.test.ts`",
        [
            (TOOLS, "              cannot: typeof cannot === 'string' ? cannot : null,", '              cannot: null,'),
        ],
    ),
    (
        "M31 · ⛔ **an answer and a reason together are accepted, and the answer is silently dropped.** The door's 'give answers or cannot_answer, not both' guard is gone. A call carrying both takes the host's decline branch, so the asker is told the question was declined when an answer was given · killed by `agents-ask-each-other.test.ts` (the test T-003 added)",
        [
            (TOOLS, '            if (args.answers !== undefined) {', '            if (false && args.answers !== undefined) {'),
        ],
    ),
    (
        "M32 · ⛔ **ruling 2 crossed: a question asked of an agent by name reads as its parent's.** `whereItWent` loses the `an-agent` arm, so the routing falls through to `the-parent`, and the host's by-name pass-up rail (`went.is === 'the-agent-the-asker-named'`) never fires. The one asked can pass a peer's question up to a person. · killed by `agents-ask-each-other.test.ts` and `a-question-names-who-it-is-for.test.ts`",
        [
            (QUESTIONS, "  if (event.to === 'an-agent') return { is: 'the-agent-the-asker-named', to: 'an-agent' }\n", ''),
        ],
    ),
    (
        "M33 · ⛔ **ruling 2's vocabulary widened: `PASS_UP_RECIPIENTS` gains `an-agent`.** `pass_question_up` advertises and accepts passing a question to 'an agent', with no field to name which. A parent-routed question passed that way is routed `to: 'an-agent'` with the passer's parent as `parent`, and it is never delivered. · killed by `a-question-names-who-it-is-for.test.ts` and `agents-ask-each-other.test.ts` and `every-tool-enum-is-documented.test.ts`",
        [
            (QUESTIONS, "export const PASS_UP_RECIPIENTS = [\n  'the-parent',\n  'a-person',\n] as const", "export const PASS_UP_RECIPIENTS = [\n  'the-parent',\n  'a-person',\n  'an-agent',\n] as const"),
        ],
    ),
    (
        "M34 · ⛔ **the pass-up door validates against the ASK vocabulary** (the pre-D-009 line). `pass_question_up` admits `who_answers: 'an-agent'` at the door, and only the host's by-name rail stands between a pass-up and an undelivered hop to 'an agent'. For a parent-routed question that rail does not apply. · killed by `agents-ask-each-other.test.ts`",
        [
            (TOOLS, '          if (!isPassUpRecipient(who)) {', '          if (!isQuestionRecipient(who)) {'),
        ],
    ),
    (
        "M35 · 🔴 **the asker cannot really withdraw (ruling 5).** The fold ignores `question_withdrawn`, so the host writes the row and says 'withdrawn', but the question stays `open`. A late answer is admitted and reaches the asker, which is the thing withdrawal promised could not happen. · killed by `agents-ask-each-other.test.ts`",
        [
            (QUESTIONS, "      settle(event.requestId, 'withdrawn', entry.at)\n", ''),
        ],
    ),
    (
        "M36 · 🔴 **no clock, and no ending either: the recipient's end never closes the question** (ruling 5). The fold ignores `question_recipient_ended`, so the asker is sent the notice but its question stays `open` and it reads *waiting on an answer* for ever. That is the unbounded wait the ruling replaced a timeout with an ending to prevent. · killed by `agents-ask-each-other.test.ts`",
        [
            (QUESTIONS, "      settle(event.requestId, 'recipient-ended', entry.at)\n", ''),
        ],
    ),
    (
        "M37 · ⛔ **`recipient-ended` counts as still OPEN.** `REQUEST_IS_OPEN['recipient-ended']` becomes true, so a question nobody is left to answer keeps its asker *waiting on an answer*, and every reader that closes by the table (`admitAnswer`, the wait composition, the person's queue) treats it as live. · killed by `a-question-does-not-expire-on-a-clock.test.ts` and `a-question-finds-a-person.test.ts` and `agents-ask-each-other.test.ts`",
        [
            (QUESTIONS, "  'recipient-ended': false,\n}", "  'recipient-ended': true,\n}"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Plan R14:
        # `openQuestionsByWork` skips questions naming no piece, and the "open question about no
        # work holds every piece" rule went with `anOpenQuestionAboutNoWork`. Table 591's
        # `THE_OPENNESS` already plants the open filter of `openQuestionsByWork`, so the surviving
        # piece-named rule is covered. Its anchor is left stale, so the census records it retired.
        "M38 · ⛔ **a CLOSED taskless peer question still counts as a wait** · an answered, withdrawn or recipient-ended question keeps its asker reading `waiting-on-an-answer` for ever, so a stall it really has is never told (re-aimed by T-003's review: it had planted M17 and M20 together) · killed by `agents-ask-each-other.test.ts`",
        [
            (QUESTIONS, '    if (!REQUEST_IS_OPEN[request.state]) return false\n    const asked = raised.get(request.requestId)\n', '    const asked = raised.get(request.requestId)\n'),
        ],
    ),
    (
        "M39 · ⛔ **the digest counts a peer question as a DECISION a person must make.** D-009's widening is reverted, so `to: 'an-agent'` falls into the refused-channel arm: `decision-raised` is bumped, and `countWord(tally.because, undefined)` records an 'undefined' reason in the person's night summary · killed by `a-person-who-never-answered.test.ts` (the test T-003 added)",
        [
            (DIGEST, "        if (went.is === 'the-parent' || went.is === 'the-agent-the-asker-named') {", "        if (went.is === 'the-parent') {"),
        ],
    ),
    (
        "M40 · ⛔ **the recipient-ended notice carries the ANSWER's caption.** `NOTICE_MEANS['a-question-that-will-not-be-answered']` is copied from `an-answer-to-a-question`. An asker whose recipient ended without answering is shown, under the app's mark, that its question *was answered*. · killed by `a-message-says-who-wrote-it.test.ts`",
        [
            (NOTICE, "    'This app put these words here because the conversation a question from this conversation was ' +\n    'for ended without answering it. You did not write them, and they were not sent on anybody’s behalf.',", "    'This app put these words here because a question this conversation had asked was answered. ' +\n    'You did not write them, and they were not sent on anybody’s behalf.',"),
        ],
    ),
    (
        "M41 · ⛔ **a withdrawn question can still be answered at the PERSON's door** · the app keeps holding its words, so `respondUserInput` takes a person's answer to a question its asker took back, and delivers it · killed by `agents-ask-each-other.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The in-memory
        # `questionsThisAppHolds` gate this row targeted is gone; the same rule ('a withdrawn
        # question can still be answered at the person's door must be refused') now lives entirely
        # in the ledger fold — `question_withdrawn` → `settle(id, 'withdrawn', at)` in
        # shared/questions.ts, read back by `admitAnswer`/`REQUEST_IS_OPEN` at the person's door.
        # Dropping that settle call re-opens exactly the same hole one layer down.
        [
            (QUESTIONS, "      settle(event.requestId, 'withdrawn', entry.at)\n", ''),
        ],
    ),
    (
        "M42 · ⛔ **a question whose recipient ended can still be answered at the PERSON's door** · the sweep closes it and keeps holding its words, so `respondUserInput` takes an answer to a question the asker was told nobody will answer · killed by `agents-ask-each-other.test.ts`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same relocation as M41:
        # the sweep's `question_recipient_ended` write is folded into `request.state` via
        # `settle(id, 'recipient-ended', at)` in shared/questions.ts, which `admitAnswer` reads at
        # the person's door. Dropping that settle call plants the same 'a question whose recipient
        # ended can still be answered at the PERSON's door' defect.
        [
            (QUESTIONS, "      settle(event.requestId, 'recipient-ended', entry.at)\n", ''),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** The commit's own decision list makes
        # this the intended behaviour, not a bug: 'A stop is not an ending: a Close, a reload, a
        # provider failure or a quit hands the messages it held to the next start; only a cut
        # handover is abandoned.' A provider failure (crash) is now explicitly one of the stop-types
        # decision 4 covers, on the same footing as a quit-left-open conversation —
        # `deliverAnswer`'s unconditional `ensureRunning` (see M13) restarts ANY stopped asker,
        # crashed or not, by design. Its anchor is left stale, so the census records it retired.
        "M43 · ⛔ **an answer restarts an asker that CRASHED** · decision 4's start, meant for a conversation a quit left open, is given to one whose stream failed (`675`: its question stays open), so it is restarted silently to take the answer · killed by `what-a-close-does-that-a-reopen-never-undoes.test.ts`",
        [
            (HOST, '      session === null &&\n      this.keptOpen(request.askedBy) !== null &&\n', '      session === null &&\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):**
        # `a-models-own-question-stays-the-models.test.ts`'s own docblock says it in as many words:
        # "D-017: nothing ends a conversation (`end_agent` is gone), so ruling 5's sweep, which
        # closed this app's questions when their recipient ended, has nothing left to answer; a stop
        # is what is measured." The `asked?.raisedBy !== 'this-app'` guard this row protected lived
        # in that same deleted sweep. Its anchor is left stale, so the census records it retired.
        "M44 · ⛔ **a model's own question is closed `recipient-ended` when its parent's conversation ends** · the sweep drops its this-app rail, so the child is told nobody will answer while its model is still parked on the card · killed by `a-models-own-question-stays-the-models.test.ts`",
        [
            (HOST, "        if (asked?.raisedBy !== 'this-app') continue\n", '        if (asked === undefined) continue\n'),
        ],
    ),
    (
        "M45 · ⛔ **the decline's reason is unbounded** · an agent-written `cannot_answer` of any length reaches the asker's turn, `437`/`676`'s hole at the new door · killed by `agents-ask-each-other.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 809e0e66 moved the cannot_answer length check out of agent-tools' argument validation into RuntimeHost (answer-too-long, refused before anything is written); the plant disables that guard so a reason of any length reaches the asker. Killer still asserts it (agents-ask-each-other.test.ts: 1281 units refused with answer-too-long, argument cannot_answer). (moved from agent-tools.ts)
            ("apps/desktop/src/main/runtime/runtime-host.ts", "    if (cannot !== null && cannot.length > REPLY_SUMMARY_LIMIT) {\n", "    if (false) {\n"),
        ],
    ),
]
