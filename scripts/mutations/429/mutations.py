"""429 · taking work back, and never handing it over twice — each row is THE DEFECT, put back (131).

🔴 **HO-023 §5 and §4.3, and the PO put them in this order deliberately:**

> **§5:** *"The same piece of work is never handed over twice. … re-sending work that has already
> been answered is refused, naming what answered it."*
>
> **§4.3:** *"`withdraw_task` … composes with the fifth property exactly right: withdraw then
> reassign is legitimate; reassign without withdrawing is the duplicate."*

⚑ **Build the verb and the refusal together, or the refusal is a trap and the verb is a hole** — so
this table has rows for both halves and rows for the composition.

## ⛔ The measurement, and the window `415` could not reach

**`415` §6.3, live, on Claude:** a PM was told its task had stalled, called `list_tasks`, said
*"Resending the work"*, called `message_agent` — and the worker's reply for that very task landed
**one millisecond later**. The re-send became a second task with the first one's text.

⚠️ **`415`'s rail reads the RECEIVER's state, so at the instant a reply lands it is silent.** ⛔ And
`425`'s remedy for that rail said *wait* — the arm that walks a model into exactly this. ⚑ So the
window this dispatch closes is the one that OPENS when the work ends, and the word `425` shipped had
to change with it.

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · the carrier** (`M1`–`M4`) — the reference field: advertised, read through its constant, and
  defaulted through a named value rather than a literal.
- **§2 · the fifth property** (`M5`–`M9`) — the rail, the state it keys on, the facts it names, and
  the lookup that is the entitlement.
- **§3 · the verb** (`M10`–`M17`) — the fold, the narrow read, the held message, the flush rail, the
  two closed states and the row that says WHO.
- **§4 · the readers** (`M18`–`M20`) — the notice, its level, and the raw line.
- **§5 · the vocabulary** (`M21`, `M22`) — `425`'s biconditional, broken from each side by one of
  the rails this dispatch adds.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M20` | ⚑ **`run_suite`** — `apps/desktop/test/taking-work-back.test.ts` |
| `M11` also | ⚑ `test/a-task-you-can-see.test.ts` (the fold/select census) |
| `M18` also | ⚑ `test/transcript.test.ts` (the app-authored sweep, `adds: 1`) |
| `M21`, `M22` | ⚑ `test/a-refusal-carries-its-remedy.test.ts` (`425`'s biconditional) |

🔴 **`M10` is caught by this dispatch's own file and by NOTHING else, and that was MEASURED rather
than assumed.** ⛔ This table first claimed `a-task-you-can-see.test.ts` §7 for it as well, and the
row **SURVIVED** there: that census reads `event.type === '<name>'` matches out of the fold's SOURCE
and compares them to the statement's type list, so a branch whose BODY has been gutted still counts
as folded. ⚑ **It censuses the two lists against each other and never what either one does** — which
is exactly the shape `a-mutation-on-a-census-is-invisible-to-that-census` names, met from the other
side. ⚠️ `M11`, which deletes a type from the SQL list, is caught there as claimed.

⚠️ **Every row was applied ALONE and watched go red against the file named here, then the tree was
restored from bytes and the restore verified by hash** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

🔴 **And the first attempt at that verification was itself the defect it exists to prevent.** ⛔ The
runner used `mapfile` over `table_contract.py --files`, which prints one space-separated LINE — so
nothing was ever restored, every row ran on top of the last, and twenty-one mutations accumulated in
the working tree while the log reported REDs. ⚑ Every verdict above was re-measured from a clean
tree afterwards; `mutation-harness-owns-the-tree`, and the tell was a `cp` error nobody was reading.

## ⛔ What this table deliberately does NOT contain

⛔ **No row removing `task_id` from `message_agent`'s advertised `input`.** ⚑ The
`satisfies Readonly<Record<keyof MessageAgentArguments, z.ZodType>>` makes that a COMPILE error, and
a mutation that does not build measures nothing — `415` §2.4's device doing its job. ⚠️ `M1` measures
the half a type cannot: the argument being advertised as REQUIRED, which compiles and breaks every
caller that does not name a task.

⛔ **No row giving `withdraw_task` a `text` argument.** ⚑ `the-five-tools.test.ts` §5's census
requires that no name carrying a dispatch word advertises anything that could carry the work — and
the argument would have to be added to {@link WithdrawTaskArguments} first, which is the same compile
error one door over.

⛔ **No row on `MESSAGE_TASK_WHEN_UNSAID`'s VALUE.** ⚠️ The brief's alternative — *about the task this
child last held* — is not a value this constant can hold; it is an inference, and there is no
inference in the code to break. ⚑ `M2` measures the thing that IS checkable: the decision being read
from the constant rather than restated as a literal beside it.

⛔ **No row inside `refuseTool`, `refusalIn` or the recording wrapper.** Those are `341`'s, `405`'s
and `425`'s, and this dispatch added four members to a vocabulary they already carry.

## ⚑ ANCHOR CORRECTED IN PLACE BY 494

⛔ **`selectTaskEvents`' type list gained `'user_decision'`** — the second producer of an actor for
`TaskRow.stalledBy`, and a type the fold branches on has to be a type the statement selects.
⚠️ **The rule this row restores is unchanged**; only the bytes it anchors on moved. ⚑ `494` put the
new member on its OWN line so that `491 M6`, which anchors on the last two lines and is the only row
in this set whose table has been RUN, keeps the verdict it earned — *a corrected anchor keeps a
verdict it never earned*. This table is `unrun`, so the correction costs it nothing.
"""

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"

# ⛔ **Anchored on code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
NAMED = "          const named = args[MESSAGE_TASK_ARGUMENT]\n"
DEFAULTED = "          const about = named ?? MESSAGE_TASK_WHEN_UNSAID\n"
SHAPE = (
    "          if (named !== undefined && (typeof named !== 'string' || named.length === 0)) {\n"
)
LOOKUP = (
    "            const about_ = theTaskYouGave(host.tasksVisibleTo(me).assigned, me, agent, about)\n"
)
KEYED = "            if (OPENS_A_TASK[says] && about_.state === 'answered') {\n"
NAMES_THE_REPLY = (
    "                  number: about_.number,\n"
    "                  ...(about_.outcome === null ? {} : { answered: about_.outcome }),\n"
)
PREDICATE = (
    "      (one) => one.taskId === taskId && one.assignedBy === by && one.assignedTo === agent,\n"
)
FOLD = "      settle(event.taskId, 'withdrawn', entry.at)\n"
# ⚑ Re-anchored by `491`, which added `user_turn` to the same narrow fold read.
NARROW = (
    # ⚑ Re-anchored by `724` (R84), which added `reply_undelivered` on its own line after `reopened`; the row is unchanged.
    # ⚑ **T-002 · re-anchored in place, not retired** — D-005a added `message_queued` to the list on a line of its own; the row still drops the same type. Re-verified RED alone.
    # ⚑ **T-003 · re-anchored in place, not retired** — D-013 appended `background_work` and `scheduled_work` to the list; the row still drops the same type. Re-verified RED alone.
    "        AND type IN ('task_assigned', 'task_replied', 'task_withdrawn', 'message_unqueued',\n                     'user_decision',\n                     'reopened',\n                     'reply_undelivered',\n                     'message_queued',\n                     'work_restarted', 'request_routed', 'request_stranded', 'user_turn', 'turn',\n                     'status', 'work_interrupted',\n                     'background_work',\n                     'scheduled_work')"
)
GIVES_BACK = "      this.takeQueuedBack(session, held)\n"
MID_FLIGHT = (
    # ⚑ **710 · re-anchored in place, not retired** — `710` (`707` F-1) gave the refusal the task's project; the row still deletes the in-flight guard.
    "      if (session.flushing) {\n        return {\n          ok: false,\n          refused: {\n            rail: 'that-work-is-being-sent',\n            number: task.number,\n            projectSlug: task.projectSlug,\n          },\n        }\n      }\n"
)
CLOSED = "    if (!TASK_IS_OPEN[task.state]) {\n      if (task.state === 'withdrawn') {\n"
WHO = "      withdrawnBy: asAgent,\n"
OUTCOME = "      tookBackTheMessage: held !== undefined,\n"
NOTICE = (
    "      notice(state, 'warn', `${event.withdrawnBy} took this work back — it is no longer owed`)\n"
)
RAW = "      return `${event.taskId} · taken back by ${event.withdrawnBy} (ours)`\n"
REMEDY = "  'that-work-is-being-sent': 'make-the-same-call-when-this-settles',\n"
PERMANENCE = "  'that-task-was-already-answered': 'permanent',\n"

MUTATIONS = [
    # ── §1 · the carrier ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ the reference is advertised as REQUIRED · every caller that does not name a task is "
        "malformed, so `415`'s whole roster of existing callers breaks and the decision `429` §2.1 "
        "made — that an omitted reference means *not about any task* — is unspellable at the door. "
        "⚑ A type cannot catch this: `z.string()` satisfies the same `Record` that `z.string()."
        "optional()` does",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The reference
        # argument is now `piece` on message_agent, still optional (a note may name none), and the
        # test pins `required` false. Dropping `.optional()` makes every note without a piece
        # malformed at the door, the same defect the row planted on `task_id`. Killed by
        # `taking-work-back.test.ts`.
        [
            # NOT VERIFIED: typed input wrapping shifted indentation; the same defect is retained.
            (TOOLS, "          piece: z\n            .string()\n            .optional()\n            .describe(\n              'The piece this is about, by its label", "          piece: z\n            .string()\n            .describe(\n              'The piece this is about, by its label"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** MESSAGE_TASK_WHEN_UNSAID and
        # its default went with the kind that sent work; the test file says '`429` §2.1's decision,
        # re-ruled by D-016 ... went with the kind that sent work'. The 5e931be8 commit message:
        # 'message_agent is a note or a follow-up naming a piece', so a follow-up with no piece is
        # malformed and a note with none means no piece, with no default constant left to read. Its
        # anchor is left stale, so the census records it retired.
        "M2 · 🔴 the default stops being read from its constant · the decision `429` §2.1 argues at "
        "length lives in a literal beside the call site, so the two can disagree the day either "
        "moves — the brief's own instruction was to *pin the decision with a test rather than a "
        "literal*, and this is the literal put back",
        [(TOOLS, DEFAULTED, "          const about = named ?? null\n")],
    ),
    (
        "M3 · ⚠️ the handler reads the advertised name as a STRING · the compile-enforced pair "
        "`415` §2.4 built is broken at the read end: renaming the argument in the interface leaves "
        "this line reading the old spelling and the build stays green",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the handler must read the advertised name through MESSAGE_PIECE_ARGUMENT, not as
        # a string. The line is now `const named = args[MESSAGE_PIECE_ARGUMENT]`; the constant is
        # 'piece'. Killed by `taking-work-back.test.ts`.
        [
            (TOOLS, '          const named = args[MESSAGE_PIECE_ARGUMENT]\n', "          const named = args['piece']\n"),
        ],
    ),
    (
        "M4 · ⛔ a reference of the wrong SHAPE is answered with the receiver's sentence · "
        "`task_id: 7` reaches the lookup, finds nothing and comes back as *that is not a task you "
        "gave that agent* — a sentence about work that was never looked for, for a fault in the "
        "caller's own arguments. ⚑ 340's finding: a reason answering with another reason's sentence",
        [(TOOLS, SHAPE, "          if (false) {\n")],
    ),
    # ── §2 · the fifth property ──────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The rail keyed on the held
        # task's state (`OPENS_A_TASK[says] && about_.state === ...`) went with `kind=work` on
        # message_agent; 5e931be8 says 'message_agent is a note or a follow-up naming a piece' and
        # 'spawn_agent is gone'. taking-work-back.test.ts says `that-task-was-already-answered` 'is
        # no longer reachable from message_agent, and the same words given again are a NEW piece by
        # ruling'. Its anchor is left stale, so the census records it retired.
        "M5 · 🔴 THE PROPERTY, INVERTED · the rail fires on the wrong closed state, so re-sending "
        "work that was ANSWERED is admitted — which is `415` §6.3's duplicate, exactly — and the "
        "sequence HO-023 §4.3 calls legitimate, withdraw then reassign, is refused instead. ⛔ Both "
        "halves of the ruling, swapped, by one word",
        [(TOOLS, KEYED, "            if (OPENS_A_TASK[says] && about_.state === 'withdrawn') {\n")],
    ),
    (
        "M6 · ⛔ a QUESTION about answered work is refused · HO-020 §2.2's *investigate* half deleted "
        "by the rail meant to protect the assignment half — the exact defect HO-021 §1 named when it "
        "ruled that a rail keyed on the held task alone *enforces the letter of HO-020 §2.2 by "
        "deleting its investigate half*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives and the test states it: a follow-up about finished work is HO-020 §2.2's
        # investigate half and must be admitted, because the reference is read and the state is not.
        # The state-keyed rail is gone, so the plant puts one back in whatAPieceIsTo, the lookup
        # only message_agent uses. It answers `none` for an answered piece, and the handler then
        # refuses the follow-up as not-a-piece-you-gave. Killed by `taking-work-back.test.ts`.
        [
            (HOST, "    const row = this.pieceNamed(spelled)\n    if (row === null) return { is: 'none' }\n", "    const row = this.pieceNamed(spelled)\n    if (row === null) return { is: 'none' }\n    if (\n      this.deps.store.piecesOwnedBy(row.owner).find((one) => one.piece === row.piece)?.state ===\n      'answered'\n    ) {\n      return { is: 'none' }\n    }\n"),
        ],
    ),
    (
        "M7 · 🔴 the refusal stops NAMING what answered it · HO-023 §5's second clause is the half "
        "the PO wrote into the property — *refused, naming what answered it* — and without it a "
        "parent is told only *no* about work it cannot see the reply to, which is the state the live "
        "measurement's PM was already in when it re-sent",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The half of
        # HO-023 §5 that says 'refused, naming what answered it' survives on withdraw_task's
        # answered-piece refusal, which is built in takeBackDetail. The plant drops the outcome that
        # answered it from that refusal's facts. Killed by `taking-work-back.test.ts`.
        [
            (TOOLS, '        ...(refused.outcome === null ? {} : { answered: refused.outcome }),\n', ''),
        ],
    ),
    (
        "M8 · ⛔ the lookup ignores WHICH AGENT the task was given to · a parent holding two children "
        "can name one child's task while messaging the other, and the reference resolves — so the "
        "rail answers about work that is not the receiver's, and *that is not a task you gave that "
        "agent* stops being reachable at all",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the piece lookup must distinguish the agent the piece was given to. It now sits
        # in whatAPieceIsTo as `theOneInItsPlace(row.owner) === theOneInItsPlace(agent) ?
        # 'given-to-it' : 'given-to-another'`. The plant makes every piece the caller gave count as
        # given to whichever agent is named. Killed by `taking-work-back.test.ts`.
        [
            (HOST, '          this.theOneInItsPlace(row.owner) === this.theOneInItsPlace(agent)\n', '          true\n'),
        ],
    ),
    (
        "M9 · 🔴 the lookup trusts the rows it was handed · `tasksAssignedBy`'s own rule — *the fold "
        "decides, not the predicate that found the ledger* — is dropped one layer up, so a caller "
        "that supplies rows from anywhere widens what this answers by choosing its input. ⚑ The "
        "entitlement stops being structural and becomes a property of one query's WHERE clause",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the lookup is the entitlement, so the piece's giver must be the caller or one it
        # stands for. The plant drops the giver check in whatAPieceIsTo, so any conversation naming
        # another's piece is treated as its giver. Dropping the same check in takeBackPiece would
        # survive because mayCommand still refuses, so the plant sits in the lookup. Killed by
        # `one-session-and-a-queue.test.ts`, `a-parent-that-survives-a-restart.test.ts`.
        [
            (HOST, '    if (row.givenBy !== null && this.theIdsItStandsFor(sender).includes(row.givenBy)) {\n', '    if (row.givenBy !== null) {\n'),
        ],
    ),
    # ── §3 · the verb ────────────────────────────────────────────────────────────────────────
    (
        "M10 · ⛔ the fold ignores the withdrawal · the row is written, stored and drawn and changes "
        "no task state at all, so the receiver's work slot is still held, "
        "`agent-already-has-work-open` still refuses, and the one verb that ends that condition "
        "appears to have done nothing",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the fold must act on the take-back. In the piece model the arm is `if
        # (event.type === 'work_taken_back')` in derivePieces, ending `settle(event.piece,
        # 'withdrawn', entry.at)`. The plant leaves the row written and stored but changes no
        # piece's state. Killed by `taking-work-back.test.ts`.
        # ⚑ Landing PE-006, D-018 and D-025 · re-anchored in place, not retired — D-025 (b1bd62db)
        # added the actor argument, so the `work_taken_back` arm is now `settle(event.piece,
        # 'withdrawn', entry.at, event.by)` and the old anchor no longer matches. The rule survives:
        # the fold must act on a take-back. The held-brief cancel arm at line 2615 is `settle(piece,
        # 'withdrawn', entry.at, null)`, so the new anchor is unique. The plant leaves the row
        # written but changes no piece, as before. This is the edit DEV's landing note gave for 429
        # M10. Killed by `taking-work-back.test.ts`.
        [
            (TASKS, "      settle(event.piece, 'withdrawn', entry.at, event.by)\n", '      void event.piece\n'),
        ],
    ),
    (
        "M11 · 🔴 the narrow read does not select it · a task a parent took back derives OPEN after a "
        "restart — silently, on the REPLAYED path only, which is every path a restart takes — while "
        "the live path is right, so the two readings of one ledger disagree and only one is ever seen. ⚑ ANCHOR CORRECTED IN PLACE BY 494",
                # ⚑ Re-anchored by `491`; this row still removes only `task_withdrawn`.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — 494 already re-anchored
        # this once; the rule — `selectTaskEvents`'s narrow, replayed read must include
        # `task_withdrawn` or a taken-back task derives OPEN after a restart — is unchanged. The
        # literal moved only because D-017 R10 inserted a `'replaced_by'` line into the same type
        # list; dropping `task_withdrawn` from today's list reproduces the exact same silent
        # replay-only disagreement.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: selectPieceEvents' narrow replayed read must select every type the fold acts on,
        # or a taken-back piece derives open after a restart. The type list now begins
        # `'work_given', 'work_replied', 'work_taken_back', ...`. The plant drops 'work_taken_back'
        # from that first list only; the two-line anchor is unique, the shorter fragment matches two
        # statements. Killed by `a-task-you-can-see.test.ts`, `taking-work-back.test.ts`.
        [
            (STORE, "        AND type IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled',\n                     'work_status_set', 'work_rebriefed', 'work_closed', 'message_unqueued',\n", "        AND type IN ('work_given', 'work_replied', 'work_retitled',\n                     'work_status_set', 'work_rebriefed', 'work_closed', 'message_unqueued',\n"),
        ],
    ),
    (
        "M12 · ⛔ the held message is left behind · `folding-one-derivation-leaves-its-neighbour`, "
        "which is the hazard `429` §3 names by name: the WORK is taken back and the WORDS are not, "
        "so the flush hands the child a turn naming a task that is already `withdrawn` and its "
        "`reply_to_parent` meets `task-already-ended` for work it was told to do one second earlier",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a take-back must take the held messages carrying the piece out of the mailbox.
        # That loop is now in takeBackTheHeldMessages, which take-back and update_work close share.
        # The plant walks the messages and takes none back, so tookBackTheMessage is still true but
        # the brief stays queued and reaches the provider. Killed by `taking-work-back.test.ts`.
        [
            (HOST, '      for (const one of taken) this.takeQueuedBack(session, one)\n', '      for (const one of taken) void one\n'),
        ],
    ),
    (
        "M13 · 🔴 a flush already in flight is taken back anyway · `cancelQueuedMessage`'s shipped "
        "ruling is broken one door over — *a flush already in flight cannot be cancelled, and saying "
        "otherwise would be a lie in the ledger* — so the transcript holds `cancelled` and `sent` for "
        "one message, because `runFlush` captured the text into a local before it suspended",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — withdrawTask still
        # carries cancelQueuedMessage's exact rule — a flush already in flight cannot be taken back
        # — just reshaped by D-017 R3 to `inTheMailbox !== undefined && session.flushing` (the extra
        # clause distinguishes a mailbox message from one already handed on to the next start). The
        # write-both-cancelled-and-sent hazard is unchanged; only the condition's prefix moved.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The flush-in-flight rail
        # in `withdrawTask` is still there, but its refusal payload lost `projectSlug` (D-016a:
        # 'Task #N'), so the old block no longer matches. Deleting the block keeps the defect: a
        # message being flushed is taken back anyway and the ledger holds cancelled and sent.
        # taking-work-back.test.ts still asserts `that-work-is-being-sent`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a brief whose flush is already in flight is refused, not taken back.
        # takeBackPiece still has the `inTheMailbox !== undefined && session.flushing` check
        # returning `that-work-is-being-sent`. The plant deletes the check. Killed by
        # `taking-work-back.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a brief whose flush is in flight cannot be taken back. D-016c moved the check
        # out of takeBackPiece into whereItsHolderStands, which take-back and close share. The plant
        # deletes the check, so the flush is taken back anyway. Killed by
        # `taking-work-back.test.ts`.
        [
            # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run.
            (HOST, "    const held = this.theHeldMessagesCarrying(piece, slot)\n    if (held.inTheMailbox.length > 0 && held.session?.flushing != null) {\n      return { ok: false, because: 'that-work-is-being-sent' }\n    }\n", "    const held = this.theHeldMessagesCarrying(piece, slot)\n"),
        ],
    ),
    (
        "M14 · ⛔ an ANSWERED task is withdrawn silently · `429` §3.1's ruling deleted: *it is "
        "already closed; withdrawing it is a different claim about history*. ⚠️ The row would be "
        "written over work somebody DID, and the reply that closed it stops being the thing that "
        "closed it",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: an answered piece is refused. The guard is still `if
        # (!TASK_IS_OPEN[piece.state])` in takeBackPiece, choosing between the taken-back and
        # answered rails. The plant narrows it to `withdrawn` only, so an answered piece falls
        # through and is taken back. Killed by `taking-work-back.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: an answered piece is refused, not taken back. takeBackPiece still guards with
        # !TASK_IS_OPEN[piece.state], now with separate withdrawn, closed and answered arms. The
        # plant narrows the guard to withdrawn only, so an answered piece falls through and is taken
        # back. Killed by `taking-work-back.test.ts`.
        [
            (HOST, "    if (!TASK_IS_OPEN[piece.state]) {\n      if (piece.state === 'withdrawn') {\n", "    if (piece.state === 'withdrawn') {\n      if (piece.state === 'withdrawn') {\n"),
        ],
    ),
    (
        "M15 · ⚠️ the two closed states share ONE word · a parent told *that was already answered* "
        "about work it took back itself goes looking for a reply nobody wrote — 340's finding, a "
        "reason answering with another reason's sentence, between two rails one line apart",
                # ⚑ **710 · re-anchored in place, not retired** — `710` (`707` F-1) gave both closed arms the task's project; the row still answers a withdrawn task in the answered word.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The withdrawn rail is
        # unchanged except that `projectSlug` left its payload, so the old anchor stopped matching.
        # Answering the withdrawn state with the answered rail's word (plus the three fields that
        # variant carries, so no shape error) keeps the defect: the two closed states share one
        # word. taking-work-back.test.ts still requires the two rails to differ.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a second take-back is refused with its own rail, not the answered one, because
        # they are different claims about history (340's finding). The plant makes the withdrawn arm
        # answer with the answered rail's shape. Killed by `taking-work-back.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a second take-back gets its own rail (that-piece-was-already-taken-back), not
        # the answered one. The refusal now sits inside a multi-line object with a trailing comma,
        # so the old anchor ending in two closing braces does not match. The shorter anchor, without
        # the braces, matches once. The plant answers the withdrawn state in the answered rail's
        # shape. Killed by `taking-work-back.test.ts`.
        [
            (HOST, "rail: 'that-piece-was-already-taken-back', label: piece.label }", "rail: 'that-piece-was-already-answered', label: piece.label, outcome: null, resources: [], endedAt: null }"),
        ],
    ),
    (
        "M16 · 🔴 the answer reports the PLAN instead of the OUTCOME · `tookBackTheMessage` is "
        "computed from the task row's `messageId`, which survives the message being SENT — so a "
        "withdrawal of `working` work tells its caller the words were taken back when they were "
        "already read. ⛔ `a-report-must-be-computed-from-the-outcome`, in the one field that answers "
        "*did anybody see this*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the answer reports the outcome, not the plan. takeBackPiece computes
        # `tookBackTheMessage` as a `let` from what actually happened, and the PieceRow keeps its
        # messageId after the brief is sent. The plant reports `piece.messageId !== null` instead,
        # so a take-back of already-sent work claims the words were taken back. Killed by
        # `taking-work-back.test.ts`.
        [
            (HOST, '      tookBackTheMessage,\n', '      tookBackTheMessage: piece.messageId !== null,\n'),
        ],
    ),
    (
        "M17 · ⛔ the durable row names the wrong conversation · `withdrawnBy` carries the CHILD, so "
        "the one fact `message_unqueued` could never carry — who took the work back — is recorded as "
        "the conversation it was taken FROM, and every reader of that ledger reads a child that "
        "withdrew its own work",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the durable row must say who took the work back. The event is now
        # `work_taken_back { piece, by }` and the write sets `by: asAgent`. The plant records the
        # piece's owner (the child) instead of the taker. Killed by `taking-work-back.test.ts`.
        [
            (HOST, '      by: asAgent,\n', '      by: piece.owner,\n'),
        ],
    ),
    # ── §4 · the readers ─────────────────────────────────────────────────────────────────────
    (
        "M18 · 🔴 the child's transcript says nothing · a withdrawal has no neighbour — nothing "
        "arrives, no tool is called and nothing it is doing stops — so without this line the "
        "transcript is BYTE-IDENTICAL for work the conversation owes and work that was taken away "
        "from it. ⚑ `405`'s argument for the refusal row, one subject over",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # `notice(state, 'warn', ...)` line in transcript.ts went on purpose: transcript.ts now says
        # 'No item — D-016 draws nothing' for work_taken_back, and transcript.test.ts pins `adds:
        # 0`. The rule still holds: a take-back must not leave the owner's transcript byte-identical
        # to work it still owes. It now lives in tellItsOwnerItWasTakenBack (plan ruling 8, an
        # `a-piece-taken-back` app notice turn), so the plant sends no notice. Killed by
        # `taking-work-back.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: the owner must be told when its piece is taken back, since the ledger draws
        # nothing for it. tellItsOwnerItWasTakenBack now calls anAppNoticeToItsHolder(piece, text,
        # 'a-piece-taken-back') instead of queueMessage. The plant sends no notice and answers told
        # false. Killed by `taking-work-back.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule survives: the owner must be told when its piece is taken
        # back, since the ledger draws nothing for it. `tellItsOwnerItWasTakenBack` now returns
        # `deliveryOf(await this.anAppNoticeToItsHolder(...))`, and the plant sends no notice and
        # answers 'not-delivered'. Killed by `taking-work-back.test.ts`.
        [
            (HOST, "      return deliveryOf(await this.anAppNoticeToItsHolder(piece, text, 'a-piece-taken-back'))\n", "      void text\n      return 'not-delivered'\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row planted the level of
        # the transcript notice, `warn` to `info`, which the reading view drops. That notice is
        # gone: transcript.ts draws nothing for work_taken_back and transcript.test.ts pins `adds:
        # 0`. The owner is told by an `a-piece-taken-back` app-notice turn, which transcript-mode.ts
        # shows in BOTH modes with its own return, so there is no level left to demote. Its anchor
        # is left stale, so the census records it retired.
        "M19 · ⚠️ the notice is `info` · `transcript-mode.ts` drops `info` in the READING view, "
        "which is the view a person actually reads — so the row is drawn in the tab a debugger opens "
        "and invisible in the one everybody else uses. ⛔ HO-019 §4's invisibility, one event over",
        [(TRANSCRIPT, NOTICE, NOTICE.replace("'warn'", "'info'"))],
    ),
    (
        "M20 · ⛔ the raw stream drops who took it back · the Events tab is where a reader checks "
        "what the ROW carried, and the field that makes this row more than a cancelled message is "
        "the one it stops showing",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the raw Events line for the take-back must keep who took it back.
        # describe-event.ts now returns `${event.piece} · taken back by ${event.by} (ours)`. The
        # plant drops the actor. Killed by `taking-work-back.test.ts`.
        [
            (DESCRIBE, '      return `${event.piece} · taken back by ${event.by} (ours)`\n', '      return `${event.piece} · taken back (ours)`\n'),
        ],
    ),
    # ── §5 · the vocabulary `425` closed ─────────────────────────────────────────────────────
    (
        "M21 · 🔴 `425`'s biconditional, broken from the RETRYABLE side · the one rail this dispatch "
        "adds that this app CAN retry promises nothing, so a caller told *the message is on the "
        "wire* is left with no act — and the act is real, measured, and lands on a different arm of "
        "the same verb",
        [(TOOLS, REMEDY, "  'that-work-is-being-sent': null,\n")],
    ),
    (
        "M22 · ⛔ `425`'s biconditional, broken from the PERMANENT side · a task somebody ANSWERED is "
        "priced `while-this-holds`, so the refusal promises a retry that can never work — `422` "
        "row 8's defect, on a rail added after the dispatch that deleted it — and the exhaustive "
        "remedy table then has a retryable rail carrying nothing",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — 425's
        # biconditional, permanent side, survives: the answered rail is renamed
        # `that-piece-was-already-answered` and priced `'permanent'` at ~line 1494 of the permanence
        # table. The plant prices it `while-this-holds` while its remedy stays null, so the refusal
        # promises a retry that can never work. Killed by `a-refusal-carries-its-remedy.test.ts`,
        # `taking-work-back.test.ts`.
        [
            (TOOLS, "  'that-piece-was-already-answered': 'permanent',\n", "  'that-piece-was-already-answered': 'while-this-holds',\n"),
        ],
    ),
]
