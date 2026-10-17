"""474 · what a request is about, and whose it is — `463`'s F4 and F2, each row the defect restored.

⛔ **Two findings, one subject, and both are about a value that already existed.**

 1. **F4 · the exact task edge was written and then discarded.** `437` put
    `question_asked.taskId` into the asker's own ledger; `466` drew it in the digest; the person's
    reader dropped it in SQL and then told a person *"which of it this is about is not recorded"*
    over a row whose ledger said exactly which. ⚑ `M7`–`M14` are the ways it goes back to being
    discarded, and `M15`–`M17` are the ways a person stops being told.
 2. **F2 · request correlation was project-global on a session-local id.** A provider mints its
    request ids per conversation — Codex's `requestKey` renders the first server request of every
    connection `number:1` — and two folds in this app cross conversations. ⚑ `M1`–`M6` put each of
    them back on a bare id.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row moves a task or proposal id onto a pair to measure a COLLISION.** `db/ids.ts` mints
both as uuids, so the folds that key on them cannot collide and a row narrowing one would measure
nothing about correctness — `a-true-mutation-measures-nothing`. ⚑ The census that keeps that true is
in the node suite, on `db/ids.ts` itself, where it fails the day one of those starts coming off a
provider.

⚠️ **`474` relay 1 changed what such a row measures, and `M21`–`M23` are the difference.** The
relay put ONE account on `digest.ts`'s `key` — *a collection keys `(conversation, id)` unless every
id it can hold was minted by this process* — and a census that partitions every keyed writer in the
fold. 🔴 **So pairing a bare key is no longer a no-op that nothing can see**: it is a field on the
wrong side of a stated rule, and the census is what says so.

⛔ **No row spells `NOTHING_NAMED_THE_WORK` out instead of deriving it.** The derived value and the
literal `{ is: 'nothing-recorded-it' }` are the same bytes after `JSON.stringify`, which is
`a-mutation-that-changes-nothing-reports-as-a-survivor` — `471 M21` paid for that lesson. ⚑ `M14`
moves the value instead, which is a difference a reader can see.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer file run, and the tree restored from bytes and compared — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

DIGEST = "apps/desktop/src/main/runtime/digest.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
COMPONENT = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
QUEUED = "apps/desktop/src/main/runtime/queued-message.ts"
QUESTION_CARD = "apps/desktop/src/renderer/src/lib/question-card.ts"

# ⚑ The fold's whole body, so a row can move the ORDER it reads its two inputs in.
THE_FOLD = (
    "  const found = named === null ? null : find(named)\n"
    "  if (found !== null) return { is: 'the-asker-named-it', work: found }\n"
    "  return { is: named === null ? 'nothing-recorded-it' : 'named-work-nothing-answers-to' }\n"
)

# ⚑ The one arm that carries work, whole — the edge as a person reads it.
THE_EDGE_DRAWN = (
    "      return held === ''\n"
    "        ? `This is about ${saidWork(about.work)}.`\n"
    "        : `This is about ${saidWork(about.work)} — that conversation is working on ${held}.`\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · whose request is it — the pair `463` F2 asked for ──────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · every routing in a project is filed under a BARE provider "
        "id. ⛔ Two Codex conversations blocked on their first question both carry `number:1`, so "
        "one conversation's routing and another's are one row and the `open-is-not-waiting` gap "
        "counts one where there are two",
        [(DIGEST, "        tally.routed.add(key(row.sessionId, event.requestId))",
          "        tally.routed.add(event.requestId)")],
    ),
    (
        "M2 · 🔴 the TRAVELLED set goes back to a bare id · the population *which work is this "
        "about* may be asked of, merged across conversations — so one conversation's question "
        "closes another's `question-without-work` gap and a digest reports an attribution nobody "
        "made",
        [(DIGEST, "          tally.travelled.add(key(row.sessionId, event.requestId))",
          "          tally.travelled.add(event.requestId)")],
    ),
    (
        "M3 · 🔴 an ANSWER in one conversation ends an open request in another · `user_decision` "
        "files its ending under a bare id, so a person reading *nothing this digest reads ended "
        "one* is told that a request nobody has answered is settled",
        [(DIGEST,
          "        bump(tally, 'request-answered', row.at, null)\n"
          "        tally.ended.add(key(row.sessionId, event.requestId))",
          "        bump(tally, 'request-answered', row.at, null)\n"
          "        tally.ended.add(event.requestId)")],
    ),
    (
        "M4 · 🔴 one conversation's `question_asked` names another conversation's work · the edge "
        "`437` wrote is filed under a bare id, so the gap it closes is closed for a request that "
        "was never named — the digest asserting an attribution that is not in any ledger",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the digest's question_asked arm still files a routed request into
        # questionsNamingWork by the (conversation, request) pair, and the partition census still
        # names that collection PAIRED. Only the local binding changed (the pair is now held in
        # `asked`), so the plant puts the bare request id back at that one writer. Killed by
        # `what-a-request-is-about-and-whose-it-is.test.ts`.
        [
            (DIGEST, '        tally.questionsNamingWork.add(asked)\n', '        tally.questionsNamingWork.add(event.requestId)\n'),
        ],
    ),
    (
        "M5 · ⛔ the joiner becomes a byte an id CAN contain · `requestKey` renders a Codex id "
        "`number:1`, so `(sess_a, number:1)` and `(sess_a:number, 1)` become one key — the pair "
        "restored in form and lost in fact, which is the failure a NUL exists to prevent",
        [(DIGEST, "  return parts.join('\\u0000')", "  return parts.join(':')")],
    ),
    (
        "M6 · 🔴 the chain refuses on a request id from ANOTHER conversation's namespace · a "
        "parent whose open question shares a descendant's session-local id is read as a cycle, so "
        "the walk stops at hop one and the queue draws *the chain above this could not be "
        "followed* over a chain that is perfectly followable",
        [(QUESTIONS,
          "    if (seen.has(next.askedBy)) return { links, endsWithAPerson: false }\n"
          "    seen.add(next.askedBy)\n",
          "    if (seen.has(next.askedBy) || seen.has(next.requestId)) {\n"
          "      return { links, endsWithAPerson: false }\n"
          "    }\n"
          "    seen.add(next.askedBy)\n"
          "    seen.add(next.requestId)\n")],
    ),
    # ── §2 · what a request is about — the edge `463` F4 found discarded ─────────────────────────
    (
        "M7 · 🔴 THE DEFECT, restored · the store stops SELECTING the task a question named. ⛔ "
        "This is where the value actually fell out: `437` wrote it, `466` read it, and the "
        "person's reader asked for `id`, `prompt` and `questions` and nothing else — so the "
        "surface stated an absence about a fact the database was holding",
        # ⚠️ **611 · CORRECTED IN PLACE** — the statement gained two columns for a passed-up
        # question (HO-088 §3.2), so this line now ends with a comma.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # selectQuestionsRaised in session-store.ts still selects the piece out of the
        # question_asked payload, and that column is what carries the edge to the person's queue.
        # The line survives byte for byte; it only moved, so the plant deletes the select of
        # `$.piece`. Killed by `what-a-request-is-about-and-whose-it-is.test.ts`.
        [
            (STORE, "            json_extract(payload, '$.piece') AS piece,\n", ''),
        ],
    ),
    (
        "M8 · ⛔ the store selects the task and the READER drops it · the column arrives and the "
        "row is built without it, which is the same discard one layer up and the shape a census "
        "over the SQL alone cannot see",
        # ⛔ **603 · ANCHOR CORRECTED IN PLACE, not retired.** The body moved out of the
        # `questionsRaisedIn` door and into the local `questionsRaisedInSession`, so a second reader
        # (the Work tab's composition) could share it — one indent level out, same lines, same rule.
        # Re-verified RED by hand.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — wordsIn still
        # copies the selected piece onto the raised-question record (`piece: row.piece`), so the
        # edge exists at the store and can be dropped there. Only the field name changed from the
        # task to the piece, and the plant nulls it at the copy. Killed by
        # `what-a-request-is-about-and-whose-it-is.test.ts`.
        # ⚑ Re-anchored in place, not retired — the copy moved into `aQuestionRaisedIn`, the one
        # reader of a raised question's row, one indent level out; the plant still nulls it there.
        [
            (STORE, '        piece: row.piece,\n', '        piece: null,\n'),
        ],
    ),
    (
        "M9 · 🔴 the person's reader stops ASKING · `questionsForAPerson` folds `null` instead of "
        "the asker's own question row, so every row reads *nothing this app records says which "
        "work this is about* — `463` F4's exact sentence, restored. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 602 — the lookup was hoisted into a `raised` const so a "
        "SECOND question could be asked of the same map entry (`HowItWasRaised`). ⛔ Same subject, "
        "same defect, same kill: the task edge is dropped on the way into `aboutTheWork`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # runtime-host.ts still hands aboutTheWork the piece the asker named, read off the
        # raised-question record, and the arm is chosen from what was found. The plant hands it
        # null, which makes every row read as 'nothing recorded it', and only the argument name
        # changed. Killed by `what-a-request-is-about-and-whose-it-is.test.ts`.
        [
            (HOST, 'aboutTheWork(raised?.piece ?? null, (id) =>', 'aboutTheWork(null, (id) =>'),
        ],
    ),
    (
        "M10 · 🔴 the fold reads the WORD before the WORK · a row that named a task claims the "
        "strong arm whether or not anything answers to it, so *this is about #3* is drawn over "
        "work this app never found — the pair `471`'s `folderIsOf` exists to make unconstructable",
        [(QUESTIONS, THE_FOLD,
          "  const found = named === null ? null : find(named)\n"
          "  if (named !== null) return { is: 'the-asker-named-it', work: found ?? { number: 0, projectSlug: '' } }\n"
          "  return { is: 'nothing-recorded-it' }\n")],
    ),
    (
        "M11 · ⛔ an edge this app could not follow becomes an edge that was never written · the "
        "two absences fold into one word, so a short read is reported as a fact about the ledger "
        "— HO-024 §5.3, and the reason this vocabulary has three members rather than two",
        [(QUESTIONS,
          "  return { is: named === null ? 'nothing-recorded-it' : 'named-work-nothing-answers-to' }",
          "  return { is: 'nothing-recorded-it' }")],
    ),
    (
        "M12 · ⛔ `workNamed` asks the OPEN predicate · a question a parent answers a day later "
        "stops naming the work it was about the moment that work finishes, so the edge decays "
        "into *no assignment answers to it* — a sentence about this app's filter wearing the "
        "clothes of a sentence about the ledger",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — workNamed in
        # shared/tasks.ts still deliberately does not filter by TASK_IS_OPEN, and section 5 pins
        # that it finds ended work while openWorkOf does not. The plant puts the open filter back in
        # front of the find, which is the label's defect in piece words. Killed by
        # `what-a-request-is-about-and-whose-it-is.test.ts`.
        [
            (TASKS, '  const found = pieces.find((one) => one.piece === piece)\n', '  const found = pieces.filter((one) => TASK_IS_OPEN[one.state]).find((one) => one.piece === piece)\n'),
        ],
    ),
    (
        "M13 · 🔴 `workNamed` answers with the conversation's FIRST task whatever it was asked · "
        "an id that names nothing resolves to whichever work happens to be there, which is "
        "`463` §11's *This is about #5 when only one task happened to be open* built into the fold",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — workNamed
        # still answers null for an id nothing answers to, never a guess at a row. The plant makes
        # it return the first piece whatever was named, on the same line the piece-model rewrite
        # moved. Killed by `what-a-request-is-about-and-whose-it-is.test.ts`.
        [
            (TASKS, '  const found = pieces.find((one) => one.piece === piece)\n', '  const found = pieces[0]\n'),
        ],
    ),
    (
        "M14 · ⛔ a permission and a proposal claim to name work · the value every population that "
        "CANNOT name work carries becomes the strong arm, so a card about a command approval "
        "tells a person it is about `#0` — a fabricated edge on the two populations that have no "
        "task id to read at all",
        [(QUESTIONS, "export const NOTHING_NAMED_THE_WORK: AboutWork = aboutTheWork(null, () => null)",
          "export const NOTHING_NAMED_THE_WORK: AboutWork = aboutTheWork('task_0', () => ({\n"
          "  number: 0,\n"
          "  projectSlug: '',\n"
          "}))")],
    ),
    # ── §3 · what a person is told ──────────────────────────────────────────────────────────────
    (
        "M15 · 🔴 the card stops DRAWING the edge · the arm that names the work says what every "
        "arm used to say, so the ledger carries the answer and the one surface a person reads "
        "goes on claiming it is not recorded — `463` F4 with the fix in the host and not on screen",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives, reshaped: where the asker named the piece (`about.is ===
        # 'the-asker-named-it'`), the card must say it. bb5b9b7e moved that from a sentence in
        # PersonsQueue.vue to the QuestionCard head via `questionOnTheQueue`'s `piece`, and the
        # tests were re-aimed at `question-piece`. The plant makes the card stop drawing the edge
        # (`piece: null`). Killed by `what-a-request-is-about-and-whose-it-is.render.test.ts`,
        # `one-task-one-name.dom.test.ts`.
        [
            (QUESTION_CARD, "    piece: row.about.is === 'the-asker-named-it' ? row.about.work.label : null,\n", '    piece: null,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The subject, a
        # person-facing sentence that draws the named edge beside the conversation's other open
        # work, was removed on purpose by bb5b9b7e (UI-009): "The sentences that explained the
        # machinery go (... the piece line on questions ...)". PersonsQueue.vue's docblock says: no
        # "This is about W2 — that conversation is working on W2", and `workWords` is down to one
        # arm on a decision's row. The re-aimed render test states "UI-009 · no question row draws a
        # work line", so nothing remains where the edge could replace the other work. Its anchor is
        # left stale, so the census records it retired.
        "M16 · ⚠️ the edge REPLACES the conversation's other work · a person moving a blocked "
        "conversation is shown the one task the question named and nothing else it is holding, "
        "which narrows criterion 20's list to answer a question nobody asked",
        [(COMPONENT, THE_EDGE_DRAWN,
          "      return `This is about ${saidWork(about.work)}.`\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The subject,
        # the middle arm of `workWords` telling an unfollowable edge ('named the piece of work this
        # is about and no piece this app can read answers to it') from a missing one, was cut on
        # purpose by bb5b9b7e (UI-009): "one arm is left", with the question arms drawn as
        # QuestionCard. Both absent arms now draw no piece and no sentence, and the
        # unfollowable-names-no-piece case is pinned by
        # what-a-request-is-about-and-whose-it-is.render.test.ts. There is no sentence left to
        # collapse into another. Its anchor is left stale, so the census records it retired.
        "M17 · ⛔ an unfollowable edge reads as no edge · the middle arm borrows the sentence for "
        "*nothing recorded it*, so the two absences this dispatch separated come back as one and "
        "a person cannot tell a short read from a fact about the ledger",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # PersonsQueue.vue's workWords still has three arms, and the middle one still says the asker
        # named a piece this app cannot follow, apart from 'nothing recorded it'. The plant makes
        # the middle arm borrow the third arm's two sentences, so the two absences read as one
        # again. Killed by `what-a-request-is-about-and-whose-it-is.render.test.ts`.
        [
            (COMPONENT, "      return held === ''\n        ? 'The conversation that asked named the piece of work this is about, and no piece this app can read answers to it.'\n        : `The conversation that asked named the piece of work this is about and no piece this app can read answers to it — it is working on ${held}.`\n", "      return held === ''\n        ? 'No piece of work is recorded for the conversation that asked.'\n        : `That conversation is working on ${held} — which of it this is about is not recorded.`\n"),
        ],
    ),
    # ── §4 · the other reader `463` F4 named ────────────────────────────────────────────────────
    (
        "M18 · 🔴 the transcript stops drawing the edge · `question_asked` goes back to drawing "
        "nothing, so the conversation shows a worker stopping with no subject and the "
        "`task_<uuid4>` in its own tool call is the only trace of which work it was about",
        # ⚠️ **611 · CORRECTED IN PLACE** — `event.taskId` is optional now (HO-088 §3.2), so the
        # line after the case label moved. The row's subject — the arm drawing nothing — is
        # unchanged, and it is anchored on the label alone rather than on a line that moves.
        [(TRANSCRIPT,
          "    case 'question_asked': {\n",
          "    case 'question_asked': {\n      return\n")],
    ),
    (
        "M19 · ⛔ the transcript INVENTS a number · work assigned before the retained suffix "
        "begins is drawn as `#0` rather than said to be older than this transcript, which is a "
        "digest's *the honest absence of it* rule broken on the other reader",
        # ⚠️ **611 · CORRECTED IN PLACE** — the ternary gained a third arm for a passed-up
        # question (HO-088 §3.2), and the two arms this row is about are unchanged.
        # ⚠️ **672 · re-anchored** — the known-number arm asks `taskCalled` now (*asked about Task #3*);
        # the invented number is the same defect in the card's spelling.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # transcript's question_asked arm still refuses to invent a piece: a row whose label is not
        # one it can spell says 'asked about a piece of work' and names none. The plant draws an
        # invented label (W0) instead, which is the label's invented-number defect in the card's
        # piece spelling. Killed by `what-a-request-is-about-and-whose-it-is.test.ts`.
        [
            (TRANSCRIPT, "              : 'asked about a piece of work',\n", '              : `asked about W0`,\n'),
        ],
    ),
    (
        "M20 · ⛔ the assignment stops leaving its number behind · the transcript can no longer "
        "turn a task id into a word, so every question a conversation asks reads as being about "
        "work older than the transcript — the honest sentence, made unconditional and therefore "
        "false",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds, reshaped. The old label described a task id turned into a number
        # word. In the piece model the same rule is that the `work_given` arm leaves the piece's
        # LABEL and TITLE behind (`state.piecesGiven.set(event.piece, given)`), which are what name
        # the piece on the rows that follow: the reply's card (`work_replied`), the lost-reply
        # notice (`reply_undelivered`) and a relayed turn's opened line. (The question_asked arm
        # reads its own row's label, which is 474:M19's separate row.) The plant deletes the set, so
        # every later row reads a miss and the card and notice say 'no label' and not W1.2. `given`
        # is still used by the arms below, so nothing dangles. Killed by
        # `the-three-sentences-beside-the-cards.test.ts`.
        [
            (TRANSCRIPT, '      state.piecesGiven.set(event.piece, given)\n', ''),
        ],
    ),
    # ── §6 · 474 relay 1 · the account, and the partition that makes it a rule ──────────────────
    (
        "M21 · ⛔ `475`'s BARE key is paired on reflex · both ends move together, so the join still "
        "works and no sentence changes — which is exactly why the rule had to be written down. ⚑ A "
        "field keyed against its own id's provenance is the drift this relay exists to stop, and "
        "the partition census is the only thing that can see it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — byMessage is
        # still a BARE collection in the digest (a msg_<uuid> is minted in this process), and the
        # partition census still pins that. The plant pairs both ends with key(), so the join still
        # works and only the census can see the drift; the anchors moved because the value is now
        # the named piece. Killed by `what-a-request-is-about-and-whose-it-is.test.ts`.
        [
            (DIGEST, '        if (event.messageId !== undefined) tally.byMessage.set(event.messageId, named)\n', '        if (event.messageId !== undefined) tally.byMessage.set(key(row.sessionId, event.messageId), named)\n'),
            (DIGEST, '        const held = tally.byMessage.get(event.messageId)\n', '        const held = tally.byMessage.get(key(row.sessionId, event.messageId))\n'),
        ],
    ),
    (
        "M22 · 🔴 a native child's reading is filed under a BARE provider id · `sub_agent.agentId` "
        "is a `z.string()` a provider chooses, so two conversations' children of the same name are "
        "max-merged into one reading — the arithmetic mistake `466`'s joiner exists to prevent, "
        "reached through the one writer whose key is built at its CALL SITE",
        [(DIGEST,
          "        reportUsage(tally, key(row.sessionId, event.agentId), event.usage?.tokens)",
          "        reportUsage(tally, event.agentId, event.usage?.tokens)")],
    ),
    (
        "M23 · ⛔ the held message's name stops being a uuid · `msg_<uuid4>` becomes a clock "
        "reading, so two messages minted in one millisecond share a name and `byMessage` joins one "
        "task's beginning to another's ending. ⚠️ It is the sentence `475`'s bare key rests on, and "
        "until this relay nothing tested it",
        [(QUEUED,
          "export const newQueuedMessageId = (): string => `msg_${randomUUID()}`",
          "export const newQueuedMessageId = (): string => `msg_${String(Date.now())}`")],
    ),
]
