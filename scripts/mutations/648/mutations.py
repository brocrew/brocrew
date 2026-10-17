"""648 · A task row that lies about its holder.

⚑ **Three findings from three seats, and they are one subject.** `list_tasks` is the only
agent-facing reader on the LEDGER side of the line — every other one is bounded by the slot map —
so it is the only place a stale ledger fact and a live slot fact sit in the same row.

> **What a task row promises, stated once:** every field on it must be true AT THE MOMENT IT IS
> READ, and a `stalledBecause` must be true of EVERY producer of that cause.

## 🔴 A · what the dispatch CHANGED

⛔ **Two behaviours and one sentence.**

 1. **`runFlush` ends a held message whose refusal can never clear** (`643` F1). The Claude
    sign-in latch never resets and nothing re-drives the flush, so *another attempt at the next
    turn boundary* was a promise that arm could not keep; the message now takes the ending the
    vanished-attachment branch three lines above it already takes.
 2. **The fold puts back the stall a conversation's ENDING displaced** (`646` F1). The overwrite
    to `conversation_ended` is right while the conversation is ended and false once it is
    reopened, so the displaced cause is kept and restored off the `status` row the reopen already
    writes — no new event type, no migration.
 3. **`message_never_sent`'s sentence stopped naming one of its four producers.** It said *the app
    stopped before the message carrying it was sent*, which is false of a vanished attachment path
    and false of item 1. It is now the member's own headline: *the message carrying it was never
    sent*.

## ⛔ B · what has NO row, said rather than left out

⚠️ **No row on the `message_unqueued: 'sent'` branch's two new `null`s** (`stalledAt`, `stalledBy`).
🔴 **Nothing can kill it**: every path that stalls a task also ends its held message, so no fold
has yet had a `stalled` row whose message then went out, and the branch's three-field clear is
unreachable today. ⛔ A row there would report as a survivor for ever and say nothing —
`a-line-no-mutation-can-kill-is-not-carrying-its-rule`, recognised before it was written rather
than after a run.

⚠️ **No row on `unwindTheEnding`'s `was.stalledBecause === null` arm.** Same reason, one function
over: every open task is stalled before a `status: ended` can land — a `working` task's turn is
force-ended by `close()` and a `waiting` task's message is abandoned by `runFinalize` — so the arm
is a stated no-op rather than a branch a test can walk.

⚠️ **No row on §3.2** — *the one collapse that stays collapsed*. ⛔ It is an ABSENCE of a
distinction, and a mutation that added one would be measuring a world this dispatch argued against
rather than this one.

🔴 **No row on `stalledBeforeTheEnding.clear()`, and this one was WRITTEN, RUN and REMOVED rather
than reasoned away.** ⛔ **It survived.** ⚠️ **Why, derived afterwards:** the map is re-`set` for
every open task at every ending, so a second ending's snapshot always replaces the first before
anything reads it; a task that left `open` in between is skipped by `unwindTheEnding`'s own
`open.get` guard; and every later non-terminal `status` finds the row already restored and returns.
⚑ **So the line changes no answer and only bounds the work a long-lived fold does per `status`
row** — it is kept for that and for what it says, and it is recorded here as unmeasured rather than
left to report as a survivor in somebody else's run
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).

## 🔴 C · the killers

`apps/desktop/test/a-task-row-that-lies-about-its-holder.test.ts` — §1.1 for the flush, §1.3 for
the sentence, §2.1 and §2.4 for the fold. ⚑ Each row was verified RED by hand against its own
killer file, anchor count `== 1`, restored from saved bytes.
"""

TASKS = "apps/desktop/src/shared/tasks.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

THE_RESTORE = "    const next: TaskRow = { ...held.row, ...was }"

THE_SNAPSHOT = "          stalledBecause: held.row.stalledBecause,"

# ⚑ **Corrected in place by `673`**, which gave the branch a second trigger (the host's `reopened`
# row); every row built from this constant keeps its meaning.
THE_RESTORE_BRANCH = (
    "    if ((event.type === 'status' || event.type === 'reopened') && stalledBeforeTheEnding.size > 0) {"
)

THE_PERMANENT_REFUSAL = (
    "      if (session.handle.signInSuperseded === true && this.holdsQueued(session, queued)) {"
)

THE_REASON_ON_THE_ENDING = "          detail: THE_SIGN_IN_MOVED_ON,\n"

THE_SENTENCE = "  message_never_sent: 'the message carrying it was never sent.',"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the flush that could never succeed ─────────────────────────────────────────────────
    (
        "M1 · 🔴 **the flush goes back to leaving it queued for ever** · the test for a refusal "
        "that can never clear is inverted, so a superseded sign-in falls through to the bare "
        "`return` again. ⛔ **This is `643` F1 exactly**: the task sits `waiting` with "
        "`stalled_because: null` and `given_to_is: 'idle'` while the message it names cannot move, "
        "and nothing wakes another attempt — `checkSignIn` latches and only a `status: idle` the "
        "refused turn never produces re-drives the flush. ⚠️ **What a parent would do with it**: "
        "read a row that looks perfectly normal and go on waiting",
        # ⚑ Landing D-027, the ui stretch to 3ef68f7f and D-038 · re-anchored in place, not retired
        # — The rule survives and D-027 only changed the guard's second conjunct:
        # `this.holdsQueued(session, queued)` became `still.length > 0` in runFlush's catch, because
        # a flush now takes several messages. The latch test `signInSuperseded === true` that ends
        # every still-held message (instead of leaving it queued for ever) is unchanged. The plant
        # inverts it as before, so a superseded sign-in falls through to `return false` and the held
        # message is never ended. Killed by `a-task-row-that-lies-about-its-holder.test.ts`,
        # `the-hold-at-every-door.test.ts`.
        [
            (HOST, '      if (session.handle.signInSuperseded === true && still.length > 0) {', '      if (session.handle.signInSuperseded !== true && still.length > 0) {'),
        ],
    ),
    (
        "M2 · ⛔ **the ending stops saying WHY** · the `detail` is dropped and the row falls back to "
        "the bare `abandoned`, which renders as *the conversation ended underneath it*. ⚑ **That "
        "is false here and the field exists for exactly this** — {@link "
        "UnqueuedMessageEvent.detail} was built at `216` because `abandoned` was written for one "
        "cause and three now reach it. 🔴 A person offered their words back under a sentence about "
        "a conversation that did not end is `340`'s *a reason answering with another reason's "
        "sentence*, on the one surface that was holding those words",
        [(HOST, THE_REASON_ON_THE_ENDING, "")],
    ),
    (
        "M3 · ⚠️ **the cause goes back to naming one of its four producers** · the sentence "
        "`624` replaced one member over is restored here. ⛔ **`message_never_sent` is reached by a "
        "clean quit, by the launch after a crash, by a vanished attachment path and — since this "
        "dispatch — by a flush a superseded sign-in refused**, and only the first two are the app "
        "stopping. 🔴 **A cause is only as true as its widest producer**, and a parent reading *the "
        "app stopped* about a running app is the row lying in a second field",
        [(TASKS, THE_SENTENCE, "  message_never_sent: 'the app stopped before the message carrying it was sent.',")],
    ),
    # ── B · the reopen that puts the displaced cause back ──────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # This row put back a defect in the unwind that restored a displaced `conversation_ended`
        # cause on reopen. Commit 8d54d6dc says 'Gone with it: ... the unwind of an ending, and
        # every set-right, correction and wake take-back', and 'There is no conversation_ended stall
        # cause'. `unwindTheEnding` and `stalledBeforeTheEnding` no longer exist in src, so nothing
        # is left to plant. Its anchor is left stale, so the census records it retired.
        "M4 · 🔴 **the restore becomes a no-op** · the recorded stall is spread away and the row is "
        "written back exactly as it was found. ⛔ **`646` F1 measured what that reads like**: "
        "`stalled_because: 'conversation_ended'` beside `given_to_is: 'idle'`, about a "
        "conversation `list_agents` names and every door answers for. ⚠️ **Two fields of one row "
        "contradicting each other**, which is the whole subject of this dispatch",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: when an ending is unwound, the row gets back the stall cause it had displaced,
        # so a reopened piece never shows conversation_ended beside a live holder state.
        # unwindTheEnding in shared/tasks.ts still builds the next row as held.row spread over the
        # remembered cause. The plant drops the remembered cause. Killed by
        # `a-task-row-that-lies-about-its-holder.test.ts`.
        [
            (TASKS, '    const next: PieceRow = { ...held.row, ...was }', '    const next: PieceRow = { ...held.row }'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # This row broke the snapshot the unwind put back (`stalledBeforeTheEnding`, the remembered
        # cause). D-016c removed the unwind of an ending, so the fold keeps no displaced cause and
        # writes no `conversation_ended` over it. The subject was removed on purpose: 'There is no
        # conversation_ended stall cause'. Its anchor is left stale, so the census records it
        # retired.
        "M5 · ⛔ **the snapshot records no cause, so there is nothing to put back** · the fold goes "
        "on overwriting with `conversation_ended` and keeps nothing. ⚑ **A different half of the "
        "same repair from `M4`** — that one breaks the writer, this one breaks the memory — and "
        "the pair is what makes *keep it, then spend it* two facts rather than one line. 🔴 The "
        "restore's own `was.stalledBecause === null` arm then swallows every task silently, which "
        "is why a row that only broke the writer would not have measured this",
        [(TASKS, THE_SNAPSHOT, "          stalledBecause: null,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016c, 8d54d6dc, a stop changes nothing about a piece):**
        # This row was a one-off bound (`size > 0` becomes `size > 1`) on the restore branch of the
        # unwind, and that branch is gone. The commit lists 'the unwind of an ending' among what was
        # removed, and a close and a reopen now leave the cause the turn wrote. Its anchor is left
        # stale, so the census records it retired.
        "M6 · ⚠️ **the restore branch is one off and never fires for a single task** · `size > 0` "
        "becomes `size > 1`, so a conversation holding ONE piece of work — which is the ordinary "
        "shape, and the only one `takesWorkFrom: 'one-caller'` permits — keeps the stale cause "
        "while a conversation holding two is repaired. ⛔ **A bound written just past the common "
        "case is the defect that ships**: every test with one task goes red and the code reads as "
        "though it works",
        [
            (
                TASKS,
                THE_RESTORE_BRANCH,
                "    if ((event.type === 'status' || event.type === 'reopened') && stalledBeforeTheEnding.size > 1) {",
            )
        ],
    ),
]
