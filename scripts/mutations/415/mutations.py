"""415 · a question is not work — each row is THE DEFECT, put back (131).

🔴 **HO-021 §1, and the measurement that produced it.** `412` shipped HO-020's stall rule — *"never
answer a stall with another piece of work"* — and measured it on both providers:

> ⛔ Claude's BroBot **held the rule on disk and broke it three times**. Codex's project manager
> **obeyed it exactly** — *"can you resume the already-assigned task without receiving a new piece of
> work?"* — **and the app recorded that question as task #4.**

⚑ **Obedience produced the same outcome as disobedience**, so the rule was never the variable. That
is standing rule 15, and it is why this table is about `workBeingAssigned` rather than about text.

## ⛔ The defect, in one sentence

**`workBeingAssigned` asked ONE question — does the caller decode to `agent:` — and answered *this is
work* for every message that did.** ⚠️ So a nudge was a task, a question about a task was a task, and
HO-020's *"one piece of work became five tasks"* is five MESSAGES rather than five assignments.

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · the caller DECLARES.** HO-021 §4: the flag was in the PO's own tool sketch and never reached
  the specification, so the build inferred and inference was impossible. `M1` is the rule ignored,
  `M2` is the default pointed the other way — the LOST TASK direction that module argues against —
  and `M3`/`M4` are the two halves of *a model was told*: the key the handler reads, and the
  vocabulary the schema advertises.
- **§2 · the rail**, and every key it could have had instead. ⛔ `M6` is HO-021 §1's own named trap —
  *"a rail keyed on the held task alone enforces the letter of HO-020 §2.2 by deleting its
  investigate half"* — and `M7` is the hole the singleton could not see: *"an idle child with an open
  task has an empty slot and accepts more."*
- **§3 · the reply**, protected above the rest (HO-021 §5: *"the one failure mode with no signal"*).
- **§4 · what a model is TOLD about the message**, which is the half relay 1 caught: `412`'s line
  calls every agent-to-agent message *a piece of work*, and that is true only while every one of them
  mints a task.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M3`, `M5`–`M16` | ⚑ **`run_suite`** — `apps/desktop/test/a-question-is-not-work.test.ts` |
| `M4` | ⚑ **`run_suite`** — that file and `apps/desktop/test/every-tool-enum-is-documented.test.ts` |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## 🔴 One row survived its first check, and the survivor was the ASSERTION

⛔ **`M4` first passed** — the advertised description stopped enumerating the vocabulary and the
suite did not notice. ⚠️ Its first repair named the derived joined list, rather than letting a
neighbouring sentence satisfy the same words.

⚑ **`490` made the stronger invariant structural:** the shared enum helper publishes the closed
vocabulary and one complete sentence per member. `M4` now replaces that one call with a raw enum and
a generic description, leaving the members visible while deleting what each means. Both the
door-specific test and the all-tool census make that row red.

## ⛔ What this table deliberately does NOT contain

⛔ **No row on `MailboxKind`.** `394`'s vocabulary decides whether a SECOND message may be HELD and
this dispatch did not touch it: a declared question still takes the work slot, so `394`'s own table
still owns every reading of it. ⚠️ The one line that moved — the singleton, above the branch — is
`394` `M6`, re-anchored by this dispatch and re-run RED.

⛔ **No row on the ORDER of the two refusals beyond `M8`.** The ordering is one `if` above another,
and a row per permutation would be three rows pricing one decision.

⛔ **No row asserting a model obeys anything.** `412` is the reason: the instruction was obeyed and
the outcome was identical.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 made the kind required and retired the held-work singleton: M8 and M13 are retired by ruling
(M13's `parent-is-holding-a-message` is gone: a reply is held beside a parent's message). ⚠️ M3's label
says an absent declaration *goes on answering `ok`*; since D-010 it is refused, and M3 is still RED on
§1 for the question/work split.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
REPLY = "apps/desktop/src/main/runtime/reply-rails.ts"
SPAWN_RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"

MUTATIONS = [
    # ── §1 · the caller declares ──────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The subject is gone:
        # c3-spec.md says "`AgentMessageKind` loses 'work': `AGENT_MESSAGE_KINDS = ['note',
        # 'follow-up']`, and `OPENS_A_TASK` is deleted", so there is no declaration table for `if
        # (!OPENS_A_TASK[says]) return null` to read. a-question-is-not-work.test.ts §1 records the
        # replacement: "D-016 · the declaration is the VERB now: `message_agent` hands nothing over
        # whatever its kind, and `give_work` is the one call that opens a piece", and `queueMessage`
        # cannot carry `giving` by type (`Omit<TurnFacts,'giving'> & { giving?: never }`), so the
        # defect of a message opening a task has no seam left to plant. Its anchor is left stale, so
        # the census records it retired.
        "M1 · 🔴 THE DEFECT, verbatim · the declaration is READ and then ignored, so every message "
        "from an agent opens a task again — HO-020's cascade, and the state Codex's project manager "
        "obeyed the stall rule into",
        [(HOST, "    if (!OPENS_A_TASK[says]) return null", "    void says")],
    ),
    (
        # 🔴 **RETIRED BY RULING at `553`, and it is retired in the honest direction: this row's
        # REPLACEMENT is now the product.** ⛔ HO-060 §3 reversed `415`'s decision — *"`kind`
        # defaulting to `work` means a model that simply sends a message assigns work; that is
        # backwards wherever it happens, including between a parent and its own child"* — so the
        # world this row put back is the world that shipped. ⚑ **A mutation whose replacement is
        # the current source measures nothing** (`a-true-mutation-measures-nothing`), and
        # correcting it in place would mean writing the OPPOSITE defect under `415`'s sentence.
        # ⚠️ **`553 M11` is that opposite defect, in `553`'s own table, with HO-060 §3 quoted** —
        # so the rule still has a row; what is gone is this row's subject.
        "M2 · ⛔ the default points the other way · an assignment made without the argument opens NO "
        "task: nothing on a board, `reply_to_parent` refused `no-task-by-that-name` for ever, and no "
        "stall to push — the losing direction `MESSAGE_KIND_WHEN_UNSAID` exists to argue",
        [(TASKS, "export const MESSAGE_KIND_WHEN_UNSAID: AgentMessageKind = 'work'",
          "export const MESSAGE_KIND_WHEN_UNSAID: AgentMessageKind = 'question'")],
    ),
    (
        "M3 · ⛔ the handler reads a key the schema does not advertise · every declaration is absent, "
        "every message is work, and the tool goes on answering `ok` — the failure a green test "
        "cannot see, because the behaviour it measures is the DEFAULT's",
        [(TOOLS, "          const declared = args[MESSAGE_KIND_ARGUMENT]",
          "          const declared = args['message_kind']")],
    ),
    (
        "M4 · ⚠️ the advertised enum keeps its members but loses every member's sentence · the "
        "argument exists and the handler reads it, but a model is never told what either choice "
        "means",
        # ⚑ **Re-anchored by `553`, not retired.** HO-060 §2/§3 rewrote what this argument's
        # third string SAYS — the default is `question` now and the sentence names the
        # relationship work needs — and the row is about the argument having a sentence AT
        # ALL. ⛔ The replacement is unchanged; only the bytes it replaces moved.
        #
        # ⚑ **Re-anchored AGAIN by `565 relay 1`, same rule and the same claim.** HO-066 §2.3
        # made the third arm reachable, so the sentence names it — and it corrected the
        # neighbouring clause, which said an agent with work open is never given a second and
        # has not been true for a `'many-callers'` receiver since `440`. ⛔ The replacement is
        # still unchanged: this row is about the argument having a sentence AT ALL.
        # ⚑ **T-003 · re-anchored in place, not retired** — D-010 rewrote the enum's third string (the kind is required); the row still drops every member's sentence. Re-verified RED alone.
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: every advertised
        # enum member must carry its sentence, and the call must be a `documentedToolEnum` call.
        # Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds: the `kind` argument of `message_agent` must be advertised with its vocabulary and a
        # sentence for each member, and a-question-is-not-work.test.ts 'the argument is ADVERTISED'
        # still asserts the joined list and 'There is no default'. Only the help text moved (D-016
        # dropped `work`, so the sentence now says a note goes anywhere and a follow-up names a
        # piece). The plant is the same as before: the enum keeps its members and loses the
        # documented helper and its sentences. Killed by `a-question-is-not-work.test.ts`,
        # `every-tool-enum-is-documented.test.ts`.
        [
            # NOT VERIFIED: typed input wrapping shifted indentation; the same defect is retained.
            (TOOLS, "          kind: documentedToolEnum(\n            TOOL_INPUT_ENUMS['message_agent:kind'],\n            'What this message is.',\n            'There is no default: say which. A note can go to any agent you may message; a follow-up ' +\n              'goes only to an agent you gave a piece to, and names that piece.',\n          ).optional(),", "          kind: agentToolStringEnum(TOOL_INPUT_ENUMS['message_agent:kind'].members)\n            .describe('What this message is.')\n            .optional(),"),
        ],
    ),
    # ── §2 · the rail ─────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The one-open-task rail was
        # removed on purpose: c3-spec.md says "`assertMayAssign` and `OPENS_A_TASK` are deleted, and
        # so are the `workAlreadyOpenIn` / `WorkAlreadyOpen` checks and
        # `refuseWorkAStartingReceiverHolds`", and `workBeingAssigned` and `assigning` no longer
        # exist in src. a-question-is-not-work.test.ts records that 'a give to a busy child is held'
        # and that the D-010 open-work tests are 'gone with its subject (D-016)', so a person typing
        # into a child holding open work can no longer be refused by that rail. Its anchor is left
        # stale, so the census records it retired.
        "M5 · 🔴 the rail loses `assigning !== null` · a PERSON typing into a child that holds open "
        "work is refused at the composer, which is the app telling somebody they may not talk to "
        "their own agent",
          # ⚑ **Re-anchored by `440`**, which gave `workAlreadyOpenIn` a second argument and split
          # the expression over four lines. ⛔ **The DEFECT is unchanged**: `assigning !== null`
          # goes, so a PERSON typing into a child that holds open work is refused at the composer.
          # ⚠️ The replacement keeps `440`'s argument, so this row measures the exemption and not
          # the caller narrowing beside it. Re-verified RED individually.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: a person
        # typing into a child that holds open work must not be refused. `takes_work_from` is gone,
        # so the rail is now `assigning === null ? null : this.workAlreadyOpenIn(session.id)`. The
        # plant drops the `assigning === null` half.
        [
            (HOST, '    const openWork = assigning === null ? null : this.workAlreadyOpenIn(session.id)', '    const openWork = this.workAlreadyOpenIn(session.id)'),
        ],
    ),
    (
        "M6 · ⛔ HO-021 §1's NAMED TRAP · the key becomes *this child has a task*, so the "
        "investigating question is refused too — *which enforces the letter of HO-020 §2.2 by "
        "deleting its investigate half. That would be worse than the defect, because it would look "
        "correct*",
          # ⚑ **Re-anchored by `440`**, which gave this reader a `from` clause and split its body.
          # ⛔ **The DEFECT is unchanged**: the predicate stops reading `TASK_IS_OPEN`, so the key
          # becomes *this child has a task* and the investigating question is refused too.
          # Re-verified RED individually.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: *open*
        # is decided by `TASK_IS_OPEN`, not by 'this child has a task'. `workAlreadyOpenIn` lost its
        # `from` filter with `takes_work_from`, and it is now a one-line `.find((one) =>
        # TASK_IS_OPEN[one.state]) ?? null`. The plant makes the key 'the child has any task' by
        # taking the first task in any state.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. HO-021's named trap: do not key the refusal on 'this child has open
        # work'. Today the rule is that only a STALL (state stalled, with a cause in
        # A_STALL_THAT_REFUSES_A_GIVE) refuses a give, and a busy or waiting helper takes the next
        # give, held until it is free. The plant drops the whole filter in giveFacts().stalledIn, so
        # every open piece refuses and a busy helper is refused too. This differs from 415:M7 (which
        # changes only the state test to 'working') and from 1016:M1 (which changes the store's
        # definition of open). The A_STALL_THAT_REFUSES_A_GIVE import becomes unused, which is
        # harmless: no tsconfig sets noUnusedLocals and vitest does not typecheck. Killed by
        # `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`,
        # `one-session-and-a-queue.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: the stalls a give names are read when its answer is formed, every cause with its words, so the same defect lands on that reading. NOT VERIFIED
            # ⚑ **W4.495 · re-anchored in place, not retired** — the stalls a give names are now read from the pieces the giver, or a conversation it took the place of, gave; the same defect on that line. NOT VERIFIED
            (HOST, "      fromIt.has(one.giver) && one.state === 'stalled' && one.stalledBecause !== null\n", "      fromIt.has(one.giver)\n"),
        ],
    ),
    (
        "M7 · 🔴 *open* narrows to *being driven* · a STALLED child accepts more work, which is the "
        "exact state HO-020 measured and HO-018 §2.1 put inside `TASK_IS_OPEN` on purpose",
          # ⚑ **Re-anchored by `440`** for `M6`'s reason and with `M6`'s defect untouched: *open*
          # narrows to *being driven*, so a STALLED child accepts more work. Re-verified RED
          # individually.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: a
        # stalled child, which is open work by HO-018 section 2.1, must still refuse more work. It
        # is the same one-line reader `workAlreadyOpenIn`. The plant narrows *open* to `state ===
        # 'working'`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the stall rule that replaced the one-open-task rail: a child whose piece
        # STALLED must still be refused a further give, and only 'working' narrowing would let it
        # through. The plant narrows `giveFacts().stalledIn`'s filter from `stalled` to `working`,
        # so the giver's stalled piece no longer refuses (`its-work-has-stalled`). This is the same
        # defect (a STALLED child accepts more work) at the seam that now owns it. Killed by
        # `a-question-is-not-work.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: the stalls a give names are read when its answer is formed, every cause with its words, so the same defect lands on that reading. NOT VERIFIED
            # ⚑ **W4.495 · re-anchored in place, not retired** — the stalls a give names are now read from the pieces the giver, or a conversation it took the place of, gave; the same defect on that line. NOT VERIFIED
            (HOST, "      fromIt.has(one.giver) && one.state === 'stalled' && one.stalledBecause !== null\n", "      fromIt.has(one.giver) && one.state === 'working' && one.stalledBecause !== null\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** D-010 deliberately removed the subject.
        # M8 swaps the order of two refusals: the held-work singleton
        # (`agent-already-has-a-message-waiting`, the `heldWork` / `theWorkAHoldWaitsBehind` block)
        # and the open-work rail. D-010 deleted the singleton and its words. Its anchor is left
        # stale, so the census records it retired (`anchor-absent`).
        "M8 · ⛔ the two refusals swap · this rail answers first, every held WORK message has a task "
        "of its own, and `agent-already-has-a-message-waiting` becomes a word no agent can reach — "
        "criterion 13 still true and no longer demonstrable",
        [(HOST,
          # ⚑ **Re-anchored by `440`**, which rewrote the `find` above the `if`. ⛔ **The DEFECT is
          # unchanged and the anchor is now the `if` ALONE**: the held-work rail only fires when no
          # task is open, so the open-work rail answers first, every held WORK message has a task of
          # its own, and `agent-already-has-a-message-waiting` becomes a word no agent can reach.
          # ⚠️ Anchoring the `if` by itself is the STRUCTURAL anchor this row should always have
          # had — the four lines above it were never part of the defect. Re-verified RED
          # individually.
          # ⚑ **…and corrected in place by `703`**, which put a comment and a second argument inside
          # the block — so the anchor is the `if` line alone, the structural anchor the note above
          # names. Re-verified RED individually against `a-question-is-not-work.test.ts`.
          "    if (heldWork !== undefined) {\n",
          "    if (heldWork !== undefined && this.workAlreadyOpenIn(session.id) === null) {\n")],
    ),
    (
        "M9 · ⚠️ the refusal names the AGENT instead of the task it is refusing on behalf of · two "
        "strings in one payload and only one of them is the answer — `354` `M17`'s shape, one rail "
        "over",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. The rule is that the refusal payload names the PIECE it refuses on
        # behalf of, not the agent. Its-work-has-stalled carries `stalled`, the labels of the
        # stalled pieces, and the sentence and the retry both read that list. The plant puts the
        # found CONVERSATION (the agent, a sess_ id) into `stalled` instead of the piece labels: two
        # strings in one payload, and only one is the answer. It type-checks: `found` is a non-null
        # string inside the branch. Killed by `a-question-is-not-work.test.ts`,
        # `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`,
        # `one-session-and-a-queue.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            # ⚑ **W4.495 · re-homed onto the give's answer in the host, not retired** — F146: the stalls a give names are read when its answer is formed (`stallsIn`), not admitted by the rail, so the same defect lands there. NOT VERIFIED
            (HOST, "        ...(stalled.length === 0 ? {} : { stalled }),\n", "        ...(stalled.length === 0 ? {} : { stalled: [{ label: owner, cause: 'turn_ended' as const }] }),\n"),
        ],
    ),
    (
        "M10 · ⛔ the refusal becomes PERMANENT · a caller is told no retry will ever pass, so a "
        "child that answers its work is never given any more — a rail that outlives the fact it is "
        "about",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. The rule is that the refusal is retryable, `while-this-holds`: the
        # giver's own follow-up or take-back clears it, and the rail's remedy says so. It lives in
        # PERMANENCE in spawn-rails.ts, and the old map entry for agent-already-has-work-open became
        # its-work-has-stalled. The plant makes it 'permanent', so a caller is told no retry will
        # ever pass. It is a one-word change to a member of the closed union and compiles. Killed by
        # `a-question-is-not-work.test.ts`,
        # `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`,
        # `what-an-agent-is-told-about-its-work.test.ts`,
        # `the-rails-before-anything-can-reach-them.test.ts`,
        # `a-refusal-carries-its-remedy.test.ts`.
        [
            # ⚑ **W4.495 · re-homed onto the give in the host, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece. The plant refuses the give over the stall again, with a typed PERMANENT rail, so a caller is told no retry will ever pass. NOT VERIFIED
            # ⚑ **parallel-workers · re-anchored in place, not retired** — Parallel-worker selection moves or repeats this text. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
            (HOST, "        let delivered: QueueOutcome\n        try {\n          delivered = await this.theBriefTo(goes.conversation, asked.brief, by, deliver)\n", "        if (this.stallsIn(goes.conversation, giving.giver).length > 0) return { ok: false, refusal: refuse('that-profile-exists', { profileId: asked.profile }) }\n        let delivered: QueueOutcome\n        try {\n          delivered = await this.theBriefTo(goes.conversation, asked.brief, by, deliver)\n"),
        ],
    ),
    (
        "M11 · ⚠️ the sentence stops naming the remedy · a parent refused *give it more* is left "
        "with `interrupt_agent` and `end_agent`, the two verbs that destroy rather than find out — "
        "HO-020 §2.2's *investigate* half deleted by prose instead of by a key",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
                # ⚑ **T-003 · re-anchored in place, not retired** — D-010 reworded the open-work sentence (a follow-up, or ask_question); the row still drops the remedy. Re-verified RED alone.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. The rule is that the sentence must name the remedy (follow up the
        # piece, or take it back with withdraw_task), so a giver is not left with the verbs that
        # destroy rather than find out. Today it is the its-work-has-stalled arm of describeRail.
        # The plant deletes the two remedy lines and keeps the facts, so the sentence reads
        # '“profile” still holds it from you, and its turn ended or was stopped with that work open,
        # so nothing was given.' `it` is still used by the remaining line, and labelsSaid stays
        # referenced elsewhere in the file. Killed by `a-question-is-not-work.test.ts`,
        # `the-act-inside-the-cut.test.ts`, `a-refusal-carries-its-remedy.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            (SPAWN_RAILS, "not being worked on: follow ${them} up with message_agent (kind follow-up), or take ${them} back with withdraw_task.`", "not being worked on.`"),
        ],
    ),
    # ── §3 · the reply ────────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 a reply that LANDED is recorded as undelivered · the parent is holding it and will "
        "read it at the next turn boundary, and the child's transcript says it never arrived — a "
        "false signal is worse than none, because somebody acts on it",
        [(REPLY, "  held: true,", "  held: false,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** D-010 deliberately removed the subject.
        # M13 flips `REPLY_LANDED['parent-is-holding-a-message']`, where a parent already holding a
        # message refuses a reply. Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M13 · ⛔ the silence comes back for the case `393` named · a parent already holding a "
        "message refuses the delivery and nothing anywhere says so — *a parent with two children "
        "that both finish while it is busy hears from one of them*",
        [(REPLY, "  'parent-is-holding-a-message': false,", "  'parent-is-holding-a-message': true,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 45a11477):** D-010 and D-017 together collapsed
        # `ReplyDelivery` to exactly `['sent', 'held', 'not-delivered']` with `REPLY_LANDED =
        # {sent:true, held:true, 'not-delivered':false}` (reply-rails.ts) — the old distinct
        # failures this row names ('parent-is-gone', 'parent-is-holding-a-message',
        # 'no-conversation') are explicitly gone per that file's own comments. So on the only branch
        # that writes this row (`!REPLY_LANDED[attempt.delivered]`), `attempt.delivered` can only
        # ever be the literal `'not-delivered'`; `because: attempt.delivered` and `because:
        # 'not-delivered'` are now provably identical in every reachable case, making the plant an
        # unkillable no-op rather than a real defect. Its anchor is left stale, so the census
        # records it retired.
        "M14 · ⚠️ the row stops saying WHICH failure it was · one constant for three outcomes, so "
        "*the parent has gone*, *the parent is holding a message* and *something else went wrong* "
        "read identically to the person who has to act on it",
        [(HOST, "        because: delivered,", "        because: 'not-delivered',")],
    ),
    (
        "M15 · ⛔ the record is written into the PARENT's ledger · the one case it exists for — a "
        "parent that is not running at all — is the one case that then writes nothing, which is the "
        "shape `400` measured about a push that hangs off a pump",
        [(HOST, "      this.publishOurs(replier, {\n        type: 'reply_undelivered',",
          "      this.publishOurs(this.slots.get(task.assignedBy)?.session ?? replier, {\n        type: 'reply_undelivered',")],
    ),
    # ── §4 · what the model is told about the message ─────────────────────────────────────────
    (
        "M16 · 🔴 relay 1's hazard, put back · an id is minted for EVERY message, so a question and a "
        "person's own turn arrive carrying *Finish this piece of work by calling reply_to_parent* "
        "for a task no row was ever written for — the app stops minting and the words go on saying "
        "it did · killed by `a-question-is-not-work.test.ts` (named by W4.78)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The mechanism
        # changed but the rule holds: a message that gives no piece must not carry the 'Finish it by
        # calling reply_to_parent with piece …' line. Minting (`newTaskId`) is deleted (c3-spec.md),
        # and the finishing line now comes from `handing?.label` in `handToProvider`, which is null
        # unless the message carries `giving`. The plant makes every message carry a piece label no
        # row was written for, which is the row's outcome (the words say a piece was given while no
        # piece exists). Killed by `a-question-is-not-work.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: a question is not work, so a plain message does not name a piece.
        # handToProvider now passes handing, which is {label, inputs} or null, to
        # messageNamingThePiece. The plant substitutes a made-up piece W9 when handing is null.
        # Killed by `a-question-is-not-work.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — ec9ac862 added `interrupting,` before the closing paren of messageNamingItsSender; messageNamingThePiece still takes {label, inputs}. Killer: 'a follow-up carries no finishing line' (expects no 'Finish it by calling reply_to_parent with piece ').
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033: where the sender stands is also told the piece the words drive
            # ⚑ **W4.147 · re-anchored in place, not retired** — F088: where the sender stands is also told the piece the words name; the plant still makes every message carry a piece label no row was written for
            (HOST, "        (sender) => this.whereTheSenderStands(sender, session.id, handing, drives, about),\n        interrupting,\n      ),\n      handing,\n    )\n", "        (sender) => this.whereTheSenderStands(sender, session.id, handing, drives, about),\n        interrupting,\n      ),\n      handing ?? { label: 'W9', inputs: [] },\n    )\n"),
        ],
    ),
]
