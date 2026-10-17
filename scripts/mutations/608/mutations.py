"""608 · The turn that no longer waits — B1, and what carries the rule once the hold is gone.

⛔ **The ruling is `HO-084` §4 and it is one sentence:** *"`HO-082` §2 said a question outlives the
turn that asked it, and §3 said `437`'s reason for holding the turn open no longer holds, because a
task now has a condition distinct from its lifecycle. So the blocking goes."*

## 🔴 What this dispatch REMOVED, because that decides what these rows have to kill

⚠️ **`437` parked the worker's tool call on a promise for five minutes**, and the argument was
written down rather than omitted: *"A verb that returned immediately would end the turn, and the
fold would then say `stalled` with `turn_ended`: 'its turn ended and it replied nothing', which is
FALSE of a worker that asked."* ⛔ **The hold bought exactly one thing: it kept the fold from
lying.** ⚑ `603` built the word the fold was missing — `TaskState.asking`, composed above both folds
— so the sentence is now answered by what every surface READS.

🔴 **So a mutation that restores the hold is NOT what this table is for.** ⛔ The hold's absence is
a DELETION, and a deletion is guarded by the things that now have to work without it. ⚠️ Every row
below is one of those things, and each was load-bearing only after the wait went:

 - the worker's turn used to keep its own question in front of somebody · now the ESCALATION does
 - the answer used to come back as the call's result · now it is a TURN, through `deliverAnswer`
 - the parent used to be told by a promise settling · now by the routing row and the words

## ⛔ A · the three writes, which are the whole of what the verb does now

⚑ **`394`'s durability was always the durable half and is now the ONLY half.** ⚠️ `M1` and `M2` are
the two ways it can be broken while the call still answers `ok` — which is the shape that matters,
because a verb that returns successfully having recorded nothing looks identical from the caller.

⛔ **`M3` is the escalation**, and it is this dispatch's sharpest row. 🔴 **While the call waited,
the worker's own parked turn was a mechanism**: a task that never came back was visible as a
conversation that never came back. ⚠️ Now the worker asks, ends its turn and carries on, so nothing
about the app's behaviour changes when nobody answers — and `armEscalationLook` is the only thing
that gets a PERSON told. ⛔ `589`'s row reached the person because that look fired.

## 🔴 B · the delivery, which is now the only way an answer EVER arrives

⚠️ **`591` built two routes and `608` deleted one**, so the surviving route carries every answer
rather than the late ones. ⛔ **`M4` is the PERSON's door** — `437`'s bound was derived from *ask →
escalate → a person is told → the person answers*, and a person whose answer goes nowhere is `589`'s
defect with the refusal removed and nothing built in its place.

⚑ **The AGENT's door has NO row here and that is deliberate**: `591 M4` already restores exactly
that defect, and `608` corrected its anchor in place rather than writing a second row on the same
line (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`, in the other direction).

## ⚠️ C · the entry, which stopped being a promise and became the route

⛔ **`M5` deletes the map entry.** ⚑ `437` found that a DELETED entry made a late answer fall
through to `handle.respondUserInput` with an id no provider ever minted — a model meeting a
transport error instead of a rule (`307`). 🔴 **That was a bug about late answers; since `608` every
answer is late**, so the entry is on the path of every single one.

## 🔴 D · the sentences, because a rule is proven by VIOLATING it

⛔ **`M6` and `M7` put back the two clauses the sweep removed** (standing rule 8.1, `498`'s closure).
⚠️ **`M7` is the worse of the two and it is not a description**: `reply-rails` renders a line into
every work message INSTRUCTING a model to *wait for the answer*, and after `608` that is an
instruction to do something this app does not let it do — `HO-070` §3's *a stale description of the
MECHANISM is an agent that stops asking*.

⛔ **`M8` puts a constant back in the payload.** ⚑ `answered: false` on every call is a fact a model
reads and can never act on, which is `a-positive-assertion-must-differ-from-the-default` pointed at
a tool's output rather than at a test.

## ⛔ What has NO row, said rather than left out

⚠️ **No row restoring the hold.** ⛔ It would need the constant, the promise, the timer and the
race — four files of edits — and what it would measure is `437`'s table, which already holds `M1`
against exactly that behaviour and is retired BY this dispatch with its reason named.

⚠️ **No row on the composition.** ⛔ `composeWaitingOnAnAnswer` is `603`'s and its nine rows are in
that table; `608` changed nothing about it and a row here would measure somebody else's work.

⚠️ **No row on `PROPOSAL_BOUND_MS`'s value.** ⛔ Nothing in this dispatch turns on the number — the
wait it bounds is `HO-090` §5's and was not touched — and a row that changed it would measure
`441`'s table. ⚑ What `608` did to it is a MOVE, and a move is guarded by a census
(`the-turn-that-no-longer-waits.test.ts` §4), because a mutation cannot express *this literal used
to be an import*.
"""

from __future__ import annotations

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"

# ⚠️ **RE-ANCHORED at 679, not retired.** The entry is keyed by the ASKER and the id (`questionKey`,
# 675 F-b); the DEFECT M5 plants — no entry at all — is unchanged.
# ⚑ **T-003 · re-anchored in place, not retired** — D-009 made the entry's task optional (a peer question); the row still drops the app's own record of the question. Re-verified RED alone.
# ⚠️ **T-003's review: this row now plants only the PERSON's-door half of M5's label.** Since D-009
# the agent's door (`answer_question`) reads the words through `theWordsOf`, which falls back to the
# ledger's `question_asked` row, so it no longer depends on this entry. The person's door
# (`respondUserInput`) and the map's other readers still fall through; the person case in
# `the-turn-that-no-longer-waits.test.ts` §2 is what kills it.
THE_ENTRY = "    this.questionsThisAppHolds.set(questionKey(speaking, requestId), {\n      asked: speaking,\n      taskId: task?.taskId ?? null,\n      parts: questions.map((one) => one.id),\n      prompt: input.question,\n    })\n"

# ⚠️ **611 · CORRECTED IN PLACE, never retired.** The delivery is inside `HO-088` §2's guard —
# a question is only carried UPWARD when upward is where its asker addressed it — so the call is
# two spaces over. ⛔ Its subject is unchanged: deleting it leaves the routing row durable and
# nothing ever tells the parent to look.
# ⚑ **T-003 · re-anchored in place, not retired** — D-009 widened the guard to a named agent. The row now narrows it to the named agent, so the PARENT is never delivered its question (deleting the whole call would also silence the named agent, wider than the label). Re-verified RED alone.
THE_DELIVERY = "    if (input.who === 'the-parent' || input.who === 'an-agent') {\n      void this.deliverQuestion(speaking, answerer, {"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the three writes ───────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the routing row is never written** · the question row lands in the worker's own "
        "ledger and nothing says who owes the answer. ⛔ `394`'s ruling — *a durable row that "
        "waited on somebody being there to read it would be lost exactly when the parent went "
        "first* — deleted, and the call still answers `ok`: the worker is told its question was "
        "recorded, and no parent can ever find it",
                # ⚠️ **611 · CORRECTED IN PLACE** — the row records what the asker DECLARED
                # (HO-088 §2), so the literal became `input.who`. The row's subject is unchanged.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 writes `parent: answerer`; the row still drops the routing row. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — raiseAQuestion
        # in runtime-host.ts still writes a request_routed row with to: went for every ask_question,
        # and 611 keeps it (omitting parent when answerer is null). The plant deletes the routing
        # row, so a question is no longer recorded as routed anywhere. Killed by
        # `the-turn-that-no-longer-waits.test.ts`, `a-question-names-who-it-is-for.test.ts`.
        [
            (HOST, "    this.publishOurs(session, {\n      type: 'request_routed',\n      requestId,\n      to: went,\n      // ⚑ **611 · omitted when there is none** — a root's question, which no conversation gave.\n      ...(answerer === null ? {} : { parent: answerer }),\n    })\n", ''),
        ],
    ),
    (
        "M2 · ⛔ **the question is never DELIVERED to the parent** · the routing row is durable so "
        "`list_questions` still names it, and nothing ever tells the parent to look. ⚠️ A parent "
        "that is running is the ordinary case and it would sit there with a decision in front of "
        "it that it has no reason to make — the *nobody waits forever in silence* half of "
        "criterion 4, one direction over",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The delivery
        # guard in raiseAQuestion still delivers a question to the parent's conversation via
        # deliverQuestion when went is 'the-parent' or 'an-agent' and an answerer exists. The plant
        # narrows it to an-agent only, so the parent is never told and cannot answer. Killed by
        # `a-question-a-worker-can-ask.test.ts`, `a-question-names-who-it-is-for.test.ts`.
        [
            (HOST, "    if (answerer !== null && (went === 'the-parent' || went === 'an-agent')) {\n", "    if (answerer !== null && went === 'an-agent') {\n"),
        ],
    ),
    # ── ⛔ RETIRED BY 612 · the arming is DELETED, and the row's own sentence is why ───────────
    #
    # 🔴 **This row said `armEscalationLook()` was *the LAST mechanism that gets a PERSON told*.**
    # ⛔ `HO-088` §3.1 then ruled that mechanism out: *"A clock deciding that Ada did not answer is
    # the same defect as a clock deciding a child failed."* ⚑ **So `612` deleted the call, the look,
    # the sweep and the constant** — there is no line left to delete and nothing moved.
    #
    # ⚠️ **What replaced it is not another mechanism but an ACT**: `611`'s `pass_question_up`, which
    # a parent performs deliberately, and an asker's own `who_answers`. ⛔ **The rule this row was
    # protecting — a question nobody answers must still reach a person — is `612`'s whole subject**,
    # carried by `the-two-clocks.test.ts` §5 and by `612 M1`/`M2` for every question a pre-`612`
    # deadline already told somebody about.
    (
        "M3 · ⛔ RETIRED BY 612 (the arming is deleted) · **the escalation is never armed**, and since `608` that is the LAST mechanism that "
        "gets a PERSON told. ⛔ While the call waited, a question nobody answered was visible as a "
        "worker that never came back; now the worker asks, ends its turn and carries on, so "
        "nothing about the app's behaviour changes at all — the row that reached the person in `589` "
        "would never have been raised",
        [
            (
                HOST,
                # ⚠️ **Anchored through the comment above it**, because `routeRequest` arms the same
                # look and a bare call site matches twice — `a-source-census-that-pins-a-line-kills-
                # every-row-on-it`, met at the mutation layer instead.
                # ⚠️ **611 · CORRECTED IN PLACE** — the arming is inside `HO-088` §2's guard and
                # `611` wrote a paragraph between the old anchor's comment and the call. ⛔ The
                # anchor is still the comment ABOVE it rather than a bare call site, because
                # `routeRequest` arms the same look and a bare site matches twice.
                "      // look for it would be a timer whose only possible finding is *nothing*.\n"
                "      this.armEscalationLook()\n",
                "      // look for it would be a timer whose only possible finding is *nothing*.\n",
            )
        ],
    ),
    # ── B · the delivery ───────────────────────────────────────────────────────────────────────
    (
        "M4 · 🔴 **a PERSON's answer goes nowhere** · the ending is written, the card leaves the "
        "queue, and the worker is never told. ⛔ This is the door `437`'s bound was derived to "
        "reach — *ask → escalate → a person is told → the person answers* — and it is `589`'s "
        "defect with the refusal removed and the delivery never built: a person answers, and the "
        "only thing that happens is that their queue gets shorter",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Targets the very same
        # call as 591:M7 (`aPersonAnswersAQuestionThisAppAsked`'s `deliverAnswer`), which now takes
        # six args instead of four and is assigned rather than fire-and-forgotten — but dropping the
        # delivery (an ended row with the worker never told) is unchanged from the original defect.
        [
            (HOST, 'const delivered = this.deliverAnswer(asked, requestId, null, said, null, theSurfaceAsking(by))', 'const delivered = Promise.resolve(null)'),
        ],
    ),
    # ── C · the entry ──────────────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ **the app forgets it raised the question** · with no entry, both answer doors fall "
        "through to `handle.respondUserInput` with an id no provider ever minted. ⚑ `437` found "
        "this once and it was a bug about LATE answers; since `608` every answer is late, so the "
        "entry is on the path of every one — and what a model meets is a transport error instead "
        "of a rule (`307`, the shape `395` spent a dispatch removing)",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The in-memory
        # `questionsThisAppHolds.set(...)` registration is gone (see 591:M2), replaced by a
        # `publishOurs(session, { type: 'question_asked', ... })` ledger write in `raiseAQuestion`
        # that plays the same role: it is what lets `theWordsOf`/`admitAnswer` later recognise the
        # request as one this app raised. Deleting that write still plants 'the app forgets it
        # raised the question', so both answer doors fall through and try to answer a provider
        # request id that was never minted.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — raiseAQuestion
        # still publishes question_asked (with piece and label when the question is about a piece)
        # carrying the prompt and questions; the ledger row is what the fold and the window read.
        # The plant deletes it, so a question leaves no asked-row. Killed by
        # `the-turn-that-no-longer-waits.test.ts`, `a-question-names-who-it-is-for.test.ts`.
        [
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. The Move addition changed the surrounding text; the original defect and killer stay. No plant or table run.
            # ⚑ **W4.652 · re-anchored in place, not retired** — a to-do (`request_action`) is a question that carries its files, so the block gained its field; the plant still deletes the asked-row.
            (HOST, "    this.publishOurs(session, {\n      type: 'question_asked',\n      ...(move === undefined ? {} : { move }),\n      ...(input.action === undefined ? {} : { action: input.action }),\n      requestId,\n      // ⚑ **D-009** — absent for a peer question about no piece (`QuestionAskedEvent.piece`).\n      ...(piece === null ? {} : { piece: piece.piece, label: piece.label }),\n      prompt: input.question,\n      questions,\n    })\n", ""),
        ],
    ),
    # ── D · the sentences ──────────────────────────────────────────────────────────────────────
    (
        "M6 · ⚠️ **the tool advertises the wait again** · *and wait for the answer*, restored to "
        "the description a model reads before it calls. ⛔ The verb returns at once, so a model is "
        "told a fact about the mechanism that is false — `HO-070` §3's *a stale description of the "
        "MECHANISM is an agent that stops asking* — and the clause that says where the answer "
        "actually goes is what it displaces",
        [
            (
                TOOLS,
                # ⚠️ **611 · CORRECTED IN PLACE** — the opening clause stopped naming the
                # recipient, because `who_answers` names it now (HO-088 §2). ⛔ The row's subject
                # — the wait clause returning to a description a model reads — is unchanged.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 rewrote the description's opening; the row still advertises the wait. Re-verified RED alone.
                "'Ask a question and get the answer back. Say who answers it",
                "'Ask a question and get the answer back, and wait for the answer. Say who answers it",
            )
        ],
    ),
    (
        "M7 · 🔴 **the line every work message carries INSTRUCTS a wait again** · and this one is "
        "not a description. ⛔ `reply-rails` renders it into the words that hand work over, so "
        "every worker in the app is told to call `ask_parent` *and wait for the answer* — an "
        "instruction to do something this app no longer lets it do, on the one surface `437` chose "
        "precisely because a rendered sentence cannot be wrong about which parent",
                # ⚠️ **611 · CORRECTED IN PLACE** — the rendered line names `ask_question` and
                # its required argument (HO-088 §2). The row's subject — the line INSTRUCTING a
                # wait again — is unchanged, and this is still the one surface that renders it.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The line every
        # work message carries (messageNamingThePiece in reply-rails.ts) still says who_answers
        # 'keeps the work yours' and must not instruct a wait, since the turn no longer waits on a
        # question. The plant puts 'and wait for the answer' back into the words a model reads.
        # Killed by `the-turn-that-no-longer-waits.test.ts`.
        [
            (RAILS, '`who_answers — that keeps the work yours', '`who_answers, and wait for the answer — that keeps the work yours'),
        ],
    ),
    (
        "M8 · ⛔ **a constant comes back into the payload** · `answered: false` on every successful "
        "call, for ever. ⚑ It was true while the verb raced an answer and is now a field a model "
        "must read and can never act on — `a-positive-assertion-must-differ-from-the-default` "
        "pointed at a tool's output — and its presence invites exactly the branch `437` wrote two "
        "sentences for",
                # ⚠️ **611 · CORRECTED IN PLACE** — the payload gained `went_to`, which is the
                # one field this call's outcome varies in (HO-088 §2). ⛔ The row's subject — a
                # CONSTANT coming back — is unchanged, and `went_to` is not one.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-009 split the success payload over lines; the row still puts the constant back. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # ask_question tool result in agent-tools.ts still returns exactly outcome, question and
        # went_to, with nothing that describes a wait. The plant adds an 'answered: false' field,
        # which is the old wait-shaped payload. Killed by `the-turn-that-no-longer-waits.test.ts`.
        [
            (TOOLS, '              went_to: asked.went,\n', '              went_to: asked.went,\n              answered: false,\n'),
        ],
    ),
]
