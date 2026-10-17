"""393 · a reply, and its absence — each row is THE DEFECT, put back (131).

🔴 **S2 and S3 in one dispatch, because a reply and its absence are one detection.** The brief's own
sentence: *"what makes a reply findable is exactly what makes its absence detectable."* ⛔ **`silent`
existed before this dispatch and measured nothing** — it fired on every ordinary turn ending, because
there was no reply for a task to be missing. The rows below protect the two halves of what changed:
**a reply closes its task and reaches the conversation that gave the work**, and **a task that ended
without one is still visible, still open, and still not called a failure.**

## ⛔ The ruling every addressing row protects

**HO-015 §1.3, confirmed emphatically by the PO:** *"`reply_to_parent` quotes the task id ONLY. The
runtime derives and validates the destination from the durable task edge. The model names which task
it is finishing, never who to send it to."* ⚠️ **`371` shipped the opposite defect** — a
`parentSessionId` silently OVERRIDDEN rather than refused, *"enforcement was right and disclosure was
wrong, and the caller was told its argument was taken."* `M3` is that defect put back.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M2`, `M7` | ⚑ **`run_suite`** — `apps/desktop/test/a-reply-and-its-absence.test.ts` §2 and §7, and `a-task-you-can-see.test.ts` §7's fold/statement census |
| `M3`-`M4`, `M6`, `M8`-`M9` | ⚑ **`run_suite`** — `a-reply-and-its-absence.test.ts` §1, §4 and §5 |
| `M5` | ⚑ **`run_suite`** — `a-reply-and-its-absence.test.ts` §5 (since `710`: the delivered turn carries no agent's kind, the child's ledger no receipt, and a child narrowed to no reach is still heard), and `a-task-you-can-see.test.ts`'s mint census, which pins the bytes |

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `tasksAssignedBy`'s `.filter(...)`.** It re-checks, through the fold, the predicate the
SQL already applied — and **no product sequence can make the two disagree today**: `commandedBy` is
fixed at reservation, so one conversation has exactly one commander and every task in one ledger
carries one `assignedBy`. ⚠️ A row here would be *"a comparison tested where both sides agree"*,
which is how three of `341`'s rows survived. **The filter is defence in depth and the response doc
says so rather than this table pretending to measure it.**

⛔ **No row that makes `silent` a failure.** S3 owns *"a turn that ends without a reply FAILS the
task"* and `393` deliberately did not rule it. A row asserting the opposite would pin a decision this
dispatch declined to make.

⛔ **No row on the delivery arms individually.** `no-conversation`, `held` and
`parent-is-holding-a-message` are all demonstrated in §5, but each is a WORD in a returned union
rather than a rule: swapping two of them is caught by the same assertion that reads any of them, and
three rows would be three spellings of `M5`'s question without `M5`'s teeth.

⚠️ **No row on `not-delivered`.** No product sequence reaches it — it is the arm that catches a throw
on the way in — and a table must not claim a demonstration the suite does not have.

## ⚑ ANCHOR CORRECTED IN PLACE BY 494

⛔ **`selectTaskEvents`' type list gained `'user_decision'`** — the second producer of an actor for
`TaskRow.stalledBy`, and a type the fold branches on has to be a type the statement selects.
⚠️ **The rule this row restores is unchanged**; only the bytes it anchors on moved. ⚑ `494` put the
new member on its OWN line so that `491 M6`, which anchors on the last two lines and is the only row
in this set whose table has been RUN, keeps the verdict it earned — *a corrected anchor keeps a
verdict it never earned*. This table is `unrun`, so the correction costs it nothing.
"""

TASKS = "apps/desktop/src/shared/tasks.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the fold: a reply closes a task, and an absence is not an answer ──────────────────
    (
        "M1 · 🔴 a reply lands as SILENCE · the app records the agent's answer and then reports "
        "that the agent said nothing — the exact sentence `360`'s cousin, one subject over, and the "
        "state a parent would wait in for ever",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: an agent's reply must fold to a closed, answered piece. The fold arm for
        # `work_replied` in derivePieces settles the piece with `settle(event.piece, 'answered',
        # ...)`. The old plant used the `silent` state, which no longer exists (TASK_STATES has only
        # the two closed states, answered and withdrawn), so the plant settles it as `working`,
        # which is a valid state where the reply is recorded and the piece stays open, so the parent
        # is left waiting. Killed by `a-reply-and-its-absence.test.ts`,
        # `a-task-you-can-see.test.ts`.
        # ⚑ Landing PE-006, D-018 and D-025 · re-anchored in place, not retired — D-025 (b1bd62db)
        # made `settle` take the actor as its fourth argument, so the `work_replied` arm now reads
        # `settle(event.piece, 'answered', entry.at, owner, {` and the old one-argument anchor no
        # longer matches. The rule survives unchanged: a reply must fold to a closed `answered`
        # piece. The plant settles it as `working`, which is open, so the reply is recorded and the
        # parent waits for ever. This is the edit DEV's landing note gave for 393 M1. Killed by
        # `a-reply-and-its-absence.test.ts`, `a-task-you-can-see.test.ts`.
        [
            (TASKS, "      settle(event.piece, 'answered', entry.at, owner, {", "      settle(event.piece, 'working', entry.at, owner, {"),
        ],
    ),
    (
        "M2 · ⛔ an answered task is still OPEN · a second reply becomes an append, the first "
        "answer a parent already read is overwritten, and no ending is ever stamped — §4.3 asked "
        "for this to be a permanent refusal and this is it not being one",
        [
            (
                TASKS,
                "  answered: false,",
                "  answered: true,",
            )
        ],
    ),
    # ── §2 · the addressing ruling ────────────────────────────────────────────────────────────
    (
        "M3 · 🔴 an aimed reply is accepted · every spelling of a destination passes through "
        "unrefused, which is `371`'s defect from the other side — HO-015 §1.3: *a model-supplied "
        "parent address is an addressing primitive an agent could aim*",
                # ⚠️ **Re-anchored by `437`, never retired.** That dispatch published `ask_parent`,
                # which refuses the SAME `REPLY_ADDRESSING_KEYS` list from its own `call`, so the
                # bare line matched twice and `census.py` reported DID NOT APPLY. ⛔ A row anchored
                # on a line that stopped being unique is corrected, not dropped —
                # `correct-a-stale-mutation-anchor-dont-retire-it`.
                # ⚑ **The DEFECT is unchanged**: the reply door stops refusing an aimed address. The
                # extra line is the last line of `393`'s OWN COMMENT above the call — its prose, not
                # `437`'s — which is what makes the anchor the REPLY's and keeps the replacement a
                # real behaviour change rather than a comment edit that would report as a survivor.
                # ⚠️ **So editing that sentence retires this row**, and the rule that applies then is
                # `correct-a-stale-mutation-anchor-dont-retire-it` — the same one that brought it
                # here. ⛔ A structural anchor would be better and there is none: the two call sites
                # are byte-identical for several lines in every direction.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the piece model: `reply_to_parent` refuses any model-supplied destination key
        # (HO-015 §1.3). The refusal is driven by `aimed`, the filter of REPLY_ADDRESSING_KEYS over
        # the args in the `reply_to_parent` tool, so the plant makes it an empty list. Every
        # spelling of a destination then passes unrefused. The anchor includes the comment line
        # above it, because the bare `const aimed = ...` line also appears at two other sites.
        # Killed by `a-reply-and-its-absence.test.ts`.
        [
            (TOOLS, '          // being refused is an INTENT.\n          const aimed = REPLY_ADDRESSING_KEYS.filter((key) => Object.hasOwn(args, key))\n', '          // being refused is an INTENT.\n          const aimed: string[] = []\n'),
        ],
    ),
    (
        # ⚑ **710 · `707` F-5 — the label's consequence CORRECTED, and its killer named.** Since `553`
        # a message that declares no kind is a QUESTION, so the child-as-caller mints nothing and §5's
        # mint assertions pass under this mutant too — it survived its documented killer. ⛔ What the
        # mutant DOES, measured: the parent's turn carries the child's declared `says`, the child's
        # ledger gains a `message_sent` receipt, and a child a person narrowed to `can_message: none`
        # has its answer refused at the words door (`not-delivered`). §5 now asserts all three.
        "M5 · 🔴 the reply is delivered AS THE CHILD instead of as the app · the app's words arrive "
        "as the child's (a declared kind on the parent's turn, a receipt in the child's ledger), and a "
        "child a person narrowed to no reach is never heard · killed by `a-reply-and-its-absence.test.ts`",
                # ⚑ **707 · re-anchored in place, not retired** — R40 gave `replyText` the giver's project; the row still delivers the reply as the child.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: the app
        # delivers a child's reply to its giver as itself, not as the child. `replyText` lost its
        # fourth (giver's project) argument, so only the anchor changed. The plant hands `{ ownerId:
        # agentCallerId(task.assignedTo) }` where `THE_APP_ITSELF` stood, and both names are already
        # in scope.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the reply reaches the giver as THE_APP_ITSELF, not as the worker. The delivery
        # is `deliverReplyTo` in runtime-host.ts, which calls `queueMessage(piece.giver,
        # replyText(...), THE_APP_ITSELF, ...)`. The plant delivers it as the replying agent
        # instead, using `{ ownerId: agentCallerId(piece.owner) }`. `agentCallerId` exists and is
        # already imported in the host, so this is a valid, runnable defect. Killed by
        # `a-reply-and-its-absence.test.ts`, `a-task-you-can-see.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the giver hears a reply as the app
        # (THE_APP_ITSELF), not as the replying child. `replyText` now takes the owner's name and
        # `aNewBriefWaited`, so the anchor is the tail of that call, and the plant hands `{ ownerId:
        # agentCallerId(piece.owner) }` where `THE_APP_ITSELF` stood. Killed by
        # `a-reply-and-its-absence.test.ts`, `a-task-you-can-see.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 038b7f1b (D-030) composes the reply into `words` before queueMessage, so the call no longer ends in replyText(..., aNewBriefWaited); the caller argument now follows `words.text`. Killer (710 / 707 F-5 tests) still asserts no message_sent receipt in the replier and delivered 'sent' for a no-reach child.
            (HOST, "        words.text,\n        THE_APP_ITSELF,\n", "        words.text,\n        { ownerId: agentCallerId(piece.owner) },\n"),
        ],
    ),
    # ── §3 · the bounds and the endings ───────────────────────────────────────────────────────
    (
        "M4 · ⛔ the summary bound stops holding · a reply a hundred times longer than the "
        "measured maximum is inlined into a parent's turn, and `353`'s 740-unit measurement stops "
        "bounding anything",
        [
            (
                RAILS,
                "export const REPLY_SUMMARY_LIMIT = 1_280",
                "export const REPLY_SUMMARY_LIMIT = 128_000",
            )
        ],
    ),
    (
        "M9 · ⚠️ *a task is finished once* becomes retryable · the payload tells a model to try "
        "again at something that can never succeed, which is the permanence table getting its one "
        "job backwards (`341`'s reading, and §4.3 asked for this to be stated in the payload)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: replying to a piece that has already ended can never succeed, so the rail is
        # permanent. The PERMANENCE table in reply-rails.ts records `'piece-already-ended':
        # 'permanent'`. The plant flips it to `'while-this-holds'`, so the payload tells a model to
        # retry something that cannot succeed. Killed by `a-reply-and-its-absence.test.ts`.
        [
            (RAILS, "  'piece-already-ended': 'permanent',", "  'piece-already-ended': 'while-this-holds',"),
        ],
    ),
    (
        "M6 · 🔴 a failed ingest closes the task anyway · the reply is recorded with no document "
        "and no body, and `380`'s own sentence — *nothing was registered and the task is still "
        "open* — becomes false in the one caller it was written for",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reply whose resources fail to be kept is refused, records nothing, and leaves
        # the piece open. The old plant assigned `documentId = null`, which has no analogue now (the
        # documents are gone, and a TypeError inside `record()` is swallowed and would leave the
        # piece open for the wrong reason). The plant rebinds `kept` so that a failed ingest falls
        # back to an empty file list. The reply is then recorded with no resource and the piece
        # closes. Killed by `a-reply-and-its-absence.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule survives: a refused resource must refuse the reply and record nothing. replyToParent
        # now calls keptFor(speaking, input.resourcePaths) and returns kept.refusal. The plant
        # swallows the refusal and carries on with an empty file list, so a reply with a bad file is
        # recorded anyway. Killed by `a-reply-and-its-absence.test.ts`.
        [
            # ⚑ **640 · re-anchored in place, not retired** — NOT VERIFIED. Reply-specific unsupported-kind words expand the same ingest-refusal guard; the replacement still swallows a failed ingest and records a reply with an empty file list.
            (HOST, "    const kept = this.keptFor(speaking, input.resourcePaths, (files) => {\n      if (resultIndex < 0) return null\n      const form = files[resultIndex]?.form\n      return form === 'markdown' || form === 'page'\n        ? null\n        : refuseReply('result-document-not-returned', {\n            path: input.resultDocument,\n            resultDocumentProblem: 'not-document',\n          })\n    })\n    if (!kept.ok) {\n      return {\n        ok: false,\n        refusal:\n          kept.refusal.rail === 'resource-not-a-form-this-app-keeps'\n            ? {\n                ...kept.refusal,\n                reason: replyUnkeptFileReason(kept.refusal.detail.path),\n              }\n            : kept.refusal,\n      }\n    }\n", "    const asked = this.keptFor(speaking, input.resourcePaths, (files) => {\n      if (resultIndex < 0) return null\n      const form = files[resultIndex]?.form\n      return form === 'markdown' || form === 'page'\n        ? null\n        : refuseReply('result-document-not-returned', {\n            path: input.resultDocument,\n            resultDocumentProblem: 'not-document',\n          })\n    })\n    const kept: { readonly files: readonly OfferedFile[] } = asked.ok ? asked : { files: [] }\n"),
        ],
    ),
    # ── §4 · the readers ──────────────────────────────────────────────────────────────────────
    (
        "M7 · 🔴 the narrow read stops selecting the reply · every answered task derives as "
        "`silent` ON THE REPLAYED PATH ONLY, with the live path right — the drift the "
        "fold/statement census in `a-task-you-can-see.test.ts` §7 exists to catch. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
                # ⚑ **Re-anchored by `398` and again by `400`**, which retired `work_quiet` and
                # added three types to the same list. ⛔ The ROW is unchanged: it still drops
                # `task_replied`, so every answered task derives as `stalled` on the replayed path.
                # ⚠️ The row's sentence says `silent`, which is the word `400` retired into `stalled`
                # — the DEFECT is the same and only the name of the state it produces has moved.
                # Re-verified RED individually.
                # ⚑ **Re-anchored by `429`**, which added `task_withdrawn`. ⛔ The ROW is unchanged:
                # it still drops `task_replied`, so every answered task derives as `stalled` on the
                # replayed path. Re-verified RED individually.
                # ⚑ Re-anchored by `491`, which added `user_turn`; the row still removes only
                # `task_replied`.
                # ⚑ Re-anchored by `724` (R84), which added `reply_undelivered` on its own line after `reopened`; the row is unchanged.
                # ⚑ **T-002 · re-anchored in place, not retired** — D-005a added `message_queued` to the list on a line of its own; the row still drops the same type. Re-verified RED alone.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-013 appended `background_work` and `scheduled_work` to the list; the row still drops the same type. Re-verified RED alone.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same shared IN-list, same
        # reason the anchor went dark (the added `'replaced_by',` line), and the row's own note
        # already points at the live killer ("the fold/statement census in
        # a-task-you-can-see.test.ts §7"). Dropping `'task_replied'` still derives every answered
        # task as `silent` on the replayed path only.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the narrow read must select the reply so the replayed path folds it. It is the
        # OUTER `AND type IN (...)` list of `selectPieceEvents` in session-store.ts, which the
        # a-task-you-can-see §7 census reads. The plant drops `'work_replied'` from that list, so an
        # answered piece derives as unanswered after a replay while the live path is right. The
        # two-line anchor is needed because the list's first line also appears in the sub-select.
        # Killed by `a-task-you-can-see.test.ts`, `a-reply-and-its-absence.test.ts`.
        [
            (STORE, "        AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',\n                     'work_status_set', 'work_rebriefed', 'work_closed', 'message_unqueued',\n", "        AND type IN ('work_given', 'work_taken_back', 'work_retitled',\n                     'work_status_set', 'work_rebriefed', 'work_closed', 'message_unqueued',\n"),
        ],
    ),
    (
        "M8 · ⛔ `list_tasks` answers the two directions the wrong way round · a worker is told it "
        "gave out the work it was given, and a parent is told nothing was ever assigned — the "
        "reader `393` §5 rests on, reporting the opposite of what it holds",
                # ⚑ **484 · anchor corrected, not retired.** The payload takes a second argument now —
                # what the conversation holding the row is doing — so the two calls are arrows. ⛔ The ROW
                # still swaps the two halves and was re-verified RED.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `list_tasks` reports what you hold and what you gave in the right directions.
        # The board payload now uses the keys `you_hold` (root plus hold) and `you_gave`, so the
        # plant swaps the two sources under those keys. A worker is then told it gave out the work
        # it was given, and a parent is told nothing was assigned. Killed by
        # `a-reply-and-its-absence.test.ts`.
        [
            # ⚑ **lists return what is open · re-anchored in place, not retired** — the board now lists each half through listedOf, so the plant swaps the two sources there; a worker is still told it gave out the work it was given, and a parent that nothing was assigned
            (TOOLS, "            const hold = listedFrom(board.hold, false)\n            const gave = listedFrom(board.gave, true)\n", "            const hold = listedFrom(board.gave, false)\n            const gave = listedFrom(board.hold, true)\n"),
        ],
    ),
    # ── §5 · the sentence a person's agent actually reads ─────────────────────────────────────
    (
        "M10 · ⚠️ the worker text starts DESCRIBING again · it asserts what the app does with "
        "silence — a ruling S3 owns and `393` declined to make — which is HO-015 §2's *one mistake "
        "made eight times* arriving for the ninth",
                # ⚑ **T-002 · re-anchored in place, not retired** — PE-003 moved the reply rule into
                # the one set every agent reads (*If you cannot finish, reply with what is blocked or
                # failed and why*). The row still adds what the app does with silence. Re-verified
                # RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the worker's text must not describe what the app does with silence, because
        # 'recorded as a failure' is in NOT_IN_THE_FACTORY_TEXT (factory-text.ts). The worker
        # sentence is now `'reply with what is blocked or failed and why.'`. The plant appends the
        # forbidden description to it. Killed by `what-reaches-a-person-is-short.test.ts`,
        # `a-check-in-is-a-question.test.ts`.
        # ⚑ Landing PE-004 (758d967c) · re-anchored in place, not retired — PE-004 re-wrapped the
        # worker sentence (it now also names a summary and resources), so its tail `failed and why.`
        # sits on its own line. The plant still appends what the app does with silence. Killed by
        # `what-reaches-a-person-is-short.test.ts`, `a-check-in-is-a-question.test.ts`.
        # ⚑ Landing PE-006, D-018 and D-025 · re-anchored in place, not retired — PE-006 (3c0c4280)
        # rewrote the worker-reply sentence in `sharedAgentRules`; its tail is now `of what is done
        # or blocked and why. Put the long form in a file and hand its path back as a resource.`, so
        # the old `failed and why.` anchor is gone. The rule survives: the factory text must not
        # describe what the app does with silence, and 'recorded as a failure' is still in
        # NOT_IN_THE_FACTORY_TEXT. The plant appends that description to the new tail. Killed by
        # `what-reaches-a-person-is-short.test.ts`, `a-check-in-is-a-question.test.ts`.
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The
        # rule survives: the factory text must not describe what the app does with silence, and
        # 'recorded as a failure' is still in NOT_IN_THE_FACTORY_TEXT (factory-text.ts:260). PE-007
        # (03a0a207) re-wrapped the worker-reply sentence in sharedAgentRules, so the old anchor
        # ('of what is done or blocked and why. Put the long form in a file...') is gone; the
        # sentence now ends on its own line `'form in a file and hand its path back as a
        # resource.',` (once). The plant appends the forbidden description to that tail, which
        # reaches every composed bundle via sharedAgentRules. Killed by
        # `what-reaches-a-person-is-short.test.ts`, `a-check-in-is-a-question.test.ts`.
        [
            # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the v6 core replaced "How you work" and "Rules"; the same mutation, applied to the core's sentence that carries the rule
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
            # ⚑ **W4.601 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v17 appends two sentences to the core paragraph that carries the rule, so its tail moved; the plant still appends what the app does with silence to that paragraph
            # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
            # ⚑ **W4.669 · re-anchored in place, not retired** — verified RED alone (verify_row; 377 M4 by a plant against `a-check-in-is-a-question.test.ts` §1, whose §2 waits on request_action). v22 rewords the core sentence this row's defect lives in; the same defect, applied to the v22 sentence that carries it
            (FACTORY, "    'person or project facts. Use relevant skills; report missing guidance and continue ' +\n    'permitted work.',\n", "    'person or project facts. Use relevant skills; report missing guidance and continue ' +\n    'permitted work. If you do not reply, the task is recorded as a failure.',\n"),
        ],
    ),
]
