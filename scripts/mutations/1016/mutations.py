"""1016 · D-016 · the tree — the landing's table, from its first commit on.

⚑ **Why `1016`**: card D-00N's table is `100N`. D-016 lands in several commits (D-016a, b, c); this
table grows with each.

## `bd70d693` · D-016a commit 1, projects and proposals go

Projects stop being something a person or a model meets, proposals go end to end, and
`takes_work_from` goes: the one-open-task rail refuses on ANY open task. The digest is one window over
every conversation an agent holds, `list_documents` takes no argument, and a task reads *Task #N*,
numbered in `default`. DEV wrote no new tests (the work model), so each group comes with the landing's:

 * `M1`–`M9`    **one open task, from anyone** — `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`.
 * `M10`–`M19`  **the digest is one window** — `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`.
 * `M20`–`M29`  **Task #N, from default** — `a-task-number-names-no-project-and-comes-from-default.test.ts`.

## `a5d66e92` · D-016a commit 2, a conversation is found by its agent, and every home lives under default

A conversation this app placed is the one with `provider_session.agent_identity_id`: the forest, the
digest window, the placed and held-by-no-agent counts, the task reads, `spawnedBy` and the binding all
read the identity, and nothing writes `agent_profile`, `agent_profile_id` or `home_project_segment`.
Every provider home lives under the one folder `HOME_FOLDER` (`default`). `M20` was re-anchored: the
binding read it planted into went, and the rule it guards did not.

 * `M30`–`M37`  **found by its agent** — `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`
   (and `the-digest-and-its-window`, `a-digest-over-two-agents-and-a-stranger-counts-each-once`, `who-called-whom`).
 * `M40`–`M49`  **one home folder** — `provider-homes`, `session-profile`, `profile-uniqueness`, `adopt-sessions`
   and `a-conversation-of-any-profile-lives-in-the-one-home-folder.test.ts`.

## `5e931be8` · D-016b commit 3, the tree

Work is a tree of pieces (W1, W1.1…): `give_work` replaces `spawn_agent`, a reply's files are resources,
and the database is ONE migration, `0000_the_tree`. Part 1 re-anchored `M1`, `M2`–`M4`, `M6`–`M9`,
`M22`–`M26` and `M34` onto the piece model and retired `M20` and `M21` (Task #N numbering went).
Part 2 adds, each with the landing's new test file:

 * `M50`–`M59`  **the give** — `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`.
 * `M60`–`M69`  **pieces** — `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`.
 * `M70`–`M79`  **take back and notes** — `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`.
 * `M80`–`M89`  **resources and the one migration** — `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`.

## `72b78a37` · D-016c commit 5, the giver's verbs

`update_work` gains `brief`, `close` and `resources` (giver only for the first two), and `give_work`
gains `inputs`. The commit re-anchored `M65`, `M67`, `M70`, `M71`, `M73`, `M81` and `M82` in place, and adds:

 * `M90`–`M99`  **the giver's verbs** — `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`.

## `8d54d6dc` · D-016c commit 5b, a stop changes nothing about a piece (the PM's rulings (b) and (c))

A process stopping changes nothing about a piece: it stalls on its turn's own cause, a stalled piece
refuses a give to a stopped, closing or reopening holder alike, and its giver is told once, when it
stalls; a stopping conversation is still the caller. Adds:

 * `M100`–`M109`  **a stop changes nothing** — `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`.

## `4a7f0fec` and `c1a79abe` · D-016c commits 6 and 7

Commit 6: `take_on_work` opens a piece a person gave under the caller's root, which reads *waiting on
you* and never stalls; a drive is judged per piece. Commit 7: an agent is named by its piece (a label
is accepted wherever an id is, one resolver, one unknown-id answer), and every sentence names another
conversation by its work. Both landed through the frontend's merge `8ca7d969`. Adds:

 * `M110`–`M119`  **a person's request** — `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`.
 * `M120`–`M129`  **named by its piece** — `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`.

Designed read-only by Sonnet 5.5 agents from the commit, the card and today's code; each row verified
alone by the landing agent.

## Verification

The landing agent verified every row alone with `verify_row.py` (applied, its own killer files run,
restored from bytes). The table has not been run.
- **RED: 25 of 25.** Each killer file ran green unmutated first.
- ⚠️ **Not rowed:** `M5` (the starting-receiver gate in `queueAs` asking the open-work rail): an
  equivalent mutant since D-017's `45a11477`. Every caller hands `queueAs` a running receiver, and a
  conversation that is not running is refused earlier by `refuseBeforeAStart`, which asks the same rail.

`a5d66e92` (D-016a commit 2): `M20` re-anchored, and `M30`–`M37` and `M40`–`M49` new — every one RED alone
by `verify_row.py` with its named killer, on `landing` over `bed8d556`, none by a syntax, reference or
type error.

`5e931be8` (D-016b, the tree): part 1 re-anchored `M1`–`M4`, `M6`–`M9`, `M22`–`M26` and `M34` and
retired `M20` and `M21`; part 2 added `M50`–`M89`. Every live row RED alone by `verify_row.py` with its
named killer on `landing` over `3743958a`, none by a syntax, reference or type error.

`72b78a37` (D-016c, the giver's verbs): `M65`, `M67`, `M70`, `M71`, `M73`, `M81` and `M82` re-anchored,
and `M90`–`M99` new. Every one RED alone by `verify_row.py` with its named killer on `landing` over
`1a567d8d`, none by a syntax, reference or type error.

`8d54d6dc` (D-016c, a stop changes nothing about a piece): `M100`–`M109` new, every one RED alone by
`verify_row.py` with its named killer on `landing` over `a2385f49`, none by a syntax, reference or type
error.

`4a7f0fec` and `c1a79abe` (D-016c commits 6 and 7, through `8ca7d969`): `M24`, `M55`, `M56`, `M59`,
`M65`, `M70`, `M72` and `M78` re-anchored, and `M110`–`M129` new. Every one RED alone by
`verify_row.py` with its named killer on `landing` over `eb79c31d`, none by a syntax, reference or type
error.
"""

MIGRATION_0000_THE_TREE = "apps/desktop/src/main/db/migrations/0000_the_tree.sql"
_JOURNAL = "apps/desktop/src/main/db/migrations/meta/_journal.json"
SESSION_STORE = "apps/desktop/src/main/db/session-store.ts"
INDEX = "apps/desktop/src/main/index.ts"
RESOURCES = "apps/desktop/src/main/resources/resources.ts"
AGENT_TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
DIGEST = "apps/desktop/src/main/runtime/digest.ts"
PROVIDER_HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"
QUESTION_RAILS = "apps/desktop/src/main/runtime/question-rails.ts"
REPLY_RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SPAWN_RAILS = "apps/desktop/src/main/runtime/spawn-rails.ts"
DIGEST_CARD_VUE = "apps/desktop/src/renderer/src/components/DigestCard.vue"
DIGEST_LIB = "apps/desktop/src/renderer/src/lib/digest.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
SESSION_MACHINE = "packages/runtime/src/internal/session-machine.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · The one-open rail counts only a task being WORKED as open: a stalled, waiting or parked task no longer blocks more work (a hand-written state instead of TASK_IS_OPEN) — killed by `a-question-is-not-work.test.ts`, `a-retry-that-works-and-names-not-folders.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. The subject of M1 is what counts as open: a stalled, waiting or
        # parked piece must still count, so it can block more work. The one-open rail and
        # workAlreadyOpenIn are gone, but the definition of open now lives in
        # SessionStore.openPiecesOf (TASK_IS_OPEN filter), which the stall rule reads through
        # giveFacts().stalledIn. The plant restores the label's defect at that seam by narrowing the
        # filter to state === 'working'. It differs from 415:M7 (which narrows the cause filter
        # inside stalledIn) and from 415:M6 (which drops the filter), because it changes the store's
        # own read of open. It compiles: the value is a plain string comparison and TASK_IS_OPEN
        # stays used elsewhere. Killed by `a-question-is-not-work.test.ts`,
        # `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`.
        [
            (SESSION_STORE, "      return piecesOfSession(owner, unread?.in(owner)).filter((piece) => TASK_IS_OPEN[piece.state])\n", "      return piecesOfSession(owner, unread?.in(owner)).filter((piece) => piece.state === 'working')\n"),
        ],
    ),
    (
        "M2 · The rail on a RUNNING receiver never refuses: the open-work throw in queueAs is dropped, so an idle child holding a task is given a second — killed by `a-question-is-not-work.test.ts`, `one-session-and-a-queue.test.ts`, `hold-the-second-message.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The one-open
        # rail is gone, but the rule that an idle conversation holding stalled work takes no more
        # survives as R2 step 6 in `admitGive` (`its-work-has-stalled`), and the old killers now pin
        # it. The plant drops that refusal so a stalled helper is given a second piece. Killed by
        # `a-question-is-not-work.test.ts`, `one-session-and-a-queue.test.ts`,
        # `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            # ⚑ **W4.495 · re-homed onto the give's answer in the host, not retired** — F146: the stalls a give names are read when its answer is formed (`stallsIn`), not admitted by the rail, so the same defect lands there. NOT VERIFIED
            # ⚑ **W4.495 · re-anchored in place, not retired** — the stalls a give names are now read from the pieces the giver, or a conversation it took the place of, gave; the same defect on that line. NOT VERIFIED
            # ⚑ **parallel-workers · re-anchored in place, not retired** — Parallel-worker selection moves or repeats this text. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
            (RUNTIME_HOST, "        const stalled = this.stallsIn(owner, giving.giver).filter(\n          (one) => one.label !== giving.label,\n        )\n", "        const stalled: readonly AStallAGiveNames[] = []\n"),
        ],
    ),
    (
        "M3 · Nothing refuses before a start: a stopped child holding open work is started for a message that is only then refused, so a provider is spent on it — killed by `a-restart-keeps-what-was-open.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The pre-start
        # `WorkAlreadyOpen` refusal left the product; `queued-message.ts` says "`WorkAlreadyOpen`
        # until D-016: a busy conversation takes a piece of work now, and only a stalled one refuses
        # it - a rail `give_work` asks before anything is sent", and
        # `a-restart-keeps-what-was-open.test.ts` records that its pre-start test is gone. The throw
        # the plant removes does not exist. Its anchor is left stale, so the census records it
        # retired.
        [
            (RUNTIME_HOST, "if (open !== null) throw new WorkAlreadyOpen(open.taskId, open.number)", "if (open !== null) void open"),
        ],
    ),
    (
        "M4 · The open-work rail before a start also refuses a follow-up or question (the work-only condition is dropped), so a stopped child holding work can no longer be woken by its parent's follow-up — killed by `a-retry-that-works-and-names-not-folders.test.ts`, `wake-one-conversation.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The open-work rail before a
        # start, with its `OPENS_A_TASK[says]` condition and `workAlreadyOpenIn`, was deleted with
        # `agent-already-has-work-open` ("D-016 retired `agent-already-has-work-open`" in
        # `refusals.ts`). The killers' own comments say "the open-work rail is gone" and §1.1/§1.3
        # "are gone with their subject", and a give's stall rule is asked before any send, not as a
        # message kind. Its anchor is left stale, so the census records it retired.
        [
            (RUNTIME_HOST, "      if (OPENS_A_TASK[says]) {\n        const open = this.workAlreadyOpenIn(sessionId)", "      if (true) {\n        const open = this.workAlreadyOpenIn(sessionId)"),
        ],
    ),
    (
        "M6 · The open-work rail also refuses a follow-up, a question and a person, not only work (the assigning-is-null exemption is dropped) — killed by `a-question-is-not-work.test.ts`, `one-session-and-a-queue.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The `assigning === null`
        # exemption belonged to `queueAs`'s open-work throw, which 5e931be8 removed: "a busy
        # conversation takes a piece of work now, and only a stalled one refuses it"
        # (`queued-message.ts`). The stall rule is asked only of `give_work`, so there is no line
        # that could also refuse a follow-up, question or person. Its anchor is left stale, so the
        # census records it retired.
        [
            (RUNTIME_HOST, "const openWork = assigning === null ? null : this.workAlreadyOpenIn(session.id)", "const openWork = this.workAlreadyOpenIn(session.id)"),
        ],
    ),
    (
        "M7 · The refusal names the wrong task: holding carries the receiver's id instead of the held task's id — killed by `a-question-is-not-work.test.ts`, `a-restart-keeps-what-was-open.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The refusal
        # still names the held work: `its-work-has-stalled` carries `stalled`, the labels of the
        # stalled pieces, built in `giveFacts.stalledIn`. The plant names the receiver's id
        # (`one.owner`) instead of the piece's label. Killed by `a-question-is-not-work.test.ts`,
        # `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`,
        # `one-session-and-a-queue.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: a give is no longer refused over a stall; its answer names the stalled piece, so the same defect lands on that answer. NOT VERIFIED
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: the stalls a give names are read when its answer is formed, every cause with its words, so the same defect lands on that reading. NOT VERIFIED
            (RUNTIME_HOST, "        ? [{ label: one.label, cause: one.stalledBecause }]\n", "        ? [{ label: one.owner, cause: one.stalledBecause }]\n"),
        ],
    ),
    (
        "M8 · The refusal says a project again: the agent-already-has-work-open detail regrows a project key beside holding and number — killed by `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The refusal's
        # detail is still a closed set, now `its-work-has-stalled` with exactly `profileId` and
        # `stalled`, pinned by `Object.keys(detail).sort()`. The plant regrows a `project` key
        # beside them. Killed by
        # `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`.
        [
            # ⚑ **W4.495 · re-homed onto the give's answer, not retired** — F146: a give is no longer refused over a stall; its answer carries the stalled labels beside a closed set of facts, pinned by `Object.keys(given.structured).sort()`, so the plant regrows a `project` key there. NOT VERIFIED. Killed by `a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts`.
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: the stalls a give names are read when its answer is formed, every cause with its words, so the same defect lands on that reading. NOT VERIFIED
            (AGENT_TOOLS, "              ...(stalled.length === 0 ? {} : { stalled: stalled.map((one) => one.label) }),\n", "              ...(stalled.length === 0 ? {} : { stalled: stalled.map((one) => one.label), project: 'default' }),\n"),
        ],
    ),
    (
        "M9 · The open-work rail counts only the CALLER's own open tasks again: a task another conversation gave no longer blocks (the relaxation D-016 took out, restored at both sites) — killed by `the-survivors-the-tree-landing-left.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place after a refuted retirement —
        # The refutation holds. The old rule was: open work counts whoever gave it, and a piece
        # another conversation gave still blocks. In the piece model that is the stall rule reading
        # openPiecesOf(found), the pieces the FOUND conversation OWNS, with no filter on
        # piece.giver. Because helperAs(giver, profile) resolves through theIdsItStandsFor (the R10
        # replacement chain), the conversation found for a giver can hold a stalled piece that a
        # predecessor of that giver gave. The plant restores the relaxation by counting only pieces
        # whose giver is the current speaker (the exact defect). NO existing test fails: every case
        # in the killer file, and every case in one-session-and-a-queue.test.ts, has one giver only,
        # and a second caller can never reach the first caller's helper (D-016). MISSING TEST (add
        # to a-conversation-holding-open-work-takes-no-more-from-anyone.test.ts). It builds a giver
        # A that gives a helper W a piece; in auto mode the turn ends, so the piece stalls and W
        # keeps it open. It then makes A unreopenable so that a replacement A' stands in its place
        # (whatever fixture the R10 replacement tests use), and A' calls give_work to the same
        # profile. It asserts that helperAs finds W, that the give is refused with rail
        # 'its-work-has-stalled', that detail.stalled is [the label of the piece A gave, not A'],
        # and that nothing was sent to W. Paired positive: after A' follows up the piece or
        # withdraws it, the same give is admitted. The plant makes the refused assertion fail,
        # because piece.giver is A and not A'. ⚠️ No test kills it yet: the landing owes one (D-016b
        # part 2).
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — `stalledIn` in giveFacts
        # deliberately reads every stalled piece the speaking conversation stands for, not only
        # those it gave itself (D-017 R10: helperAs searches all ids the giver stands for). The
        # plant adds `one.giver === speaking &&`, so a replaced giver PM' is no longer refused for
        # the pieces its predecessor gave. Nothing pins this: the R10 tests check what the
        # replacement carries, never that a give to the same worker is refused. The test replaces
        # the PM, has PM' give to the same worker and asserts an `its-work-has-stalled` refusal
        # naming the label of the piece PM gave. Paired positive: once PM' takes that piece back
        # (withdraw_task), the same give is admitted. Killed by
        # `the-survivors-the-tree-landing-left.test.ts`.
        [
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: the stalls a give names are read when its answer is formed, from the pieces the giver or a conversation it took the place of gave. The plant keeps only the current giver's own, so a replacement is no longer told of its predecessor's stalled piece while an ordinary giver's still is. NOT VERIFIED
            (RUNTIME_HOST, "      fromIt.has(one.giver) && one.state === 'stalled' && one.stalledBecause !== null\n", "      one.giver === giver && one.state === 'stalled' && one.stalledBecause !== null\n"),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity draws per-piece lines instead, and says a walk it could not finish as "read in part".
        "M10 · the view fills an unspellable walk word with an empty string instead of null, so a walk this build cannot spell reads as an answer and the card draws an empty covers line — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts` — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (DIGEST_LIB, "    covers: walkCovers(digest.read.walk),\n", "    covers: walkCovers(digest.read.walk) ?? '',\n"),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity draws per-piece lines instead, and says a walk it could not finish as "read in part".
        "M11 · the card draws its covers line whether or not the view has a sentence, so a walk word with no sentence prints an empty paragraph under the limit — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts` — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (DIGEST_CARD_VUE, "<p v-if=\"view.covers !== null\" class=\"digest-note\" data-cy=\"digest-covers\">", "<p class=\"digest-note\" data-cy=\"digest-covers\">"),
        ],
    ),
    (
        "M12 · the host reads `sessions` as the number of rows the window returned instead of the number of distinct conversations that recorded something — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts` — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (RUNTIME_HOST, "        sessions: new Set(read.rows.map((row) => row.sessionId)).size,\n", "        sessions: read.rows.length,\n"),
        ],
    ),
    (
        "M13 · the digest's `ledgers` also counts the conversations no agent holds, so the card says it opened ledgers it cannot read while heldByNoAgent says they are uncovered — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts` — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (SESSION_STORE, "      const ledgers = (countPlacedConversations.get() as { n: number }).n\n      let rowsUnread = 0\n", "      const ledgers =\n        (countPlacedConversations.get() as { n: number }).n +\n        (countConversationsHeldByNoAgent.get() as { n: number }).n\n      let rowsUnread = 0\n"),
        ],
    ),
    (
        "M14 · the host reading stops carrying the count of conversations held by no agent and always says zero, so a person is never told part of the ledger is outside the digest — killed by `the-digest-and-its-window.test.ts` — killed by `the-digest-and-its-window.test.ts`, `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (RUNTIME_HOST, "      heldByNoAgent: this.deps.store.conversationsHeldByNoAgent(),\n      cost: { totalMs: +(performance.now() - started).toFixed(2) },\n", "      heldByNoAgent: 0,\n      cost: { totalMs: +(performance.now() - started).toFixed(2) },\n"),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity draws per-piece lines instead, and says a walk it could not finish as "read in part".
        "M15 · the view drops the reading's heldByNoAgent and always carries zero, so the card never says a conversation is outside its digest — killed by `digest-card.render.test.ts` — killed by `digest-card.render.test.ts`, `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (DIGEST_LIB, "    heldByNoAgent: reading.heldByNoAgent,\n", "    heldByNoAgent: 0,\n"),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity draws per-piece lines instead, and says a walk it could not finish as "read in part".
        "M16 · the held-by-no-agent note loses its singular, so one conversation reads '1 conversations are held by no agent … covers them' — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts` — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (DIGEST_CARD_VUE, "{{ view.heldByNoAgent === 1 ? 'conversation is' : 'conversations are' }}", "{{ 'conversations are' }}"),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity draws per-piece lines instead, and says a walk it could not finish as "read in part".
        "M17 · the withheld sentence loses its plural, so two withheld lines read '2 line was withheld … how it knew it' — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts` — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (DIGEST_CARD_VUE, "{{ view.withheld === 1 ? 'line was' : 'lines were' }}", "{{ 'line was' }}"),
        ],
    ),
    (
        "M18 · the source-unreadable gap drops its second sentence about a dropped row having nothing to stand in for it, so the D-016 wording is silently shortened — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts` — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`, `a-nights-backlog-rehearsed.render.test.ts`",
        [
            (DIGEST, "Nothing records why, and a row this app dropped is a row nothing else here can stand in for.", "Nothing records why."),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity draws per-piece lines instead, and says a walk it could not finish as "read in part".
        "M19 · the card heading loses its singular, so a window over one conversation reads '1 of 1 conversations recorded something in this window' — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts` — killed by `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (DIGEST_CARD_VUE, "{{ view.read.ledgers === 1 ? 'conversation' : 'conversations' }}", "{{ 'conversations' }}"),
        ],
    ),
    (
        "M20 · ⛔ **the holder's binding names the project a task is numbered in** · identityOf carries the binding's project again and workBeingAssigned takes it over `default`, so a holder an old database placed elsewhere is numbered from that project's own sequence and one giver can hold two different Task #5s — killed by `a-task-number-names-no-project-and-comes-from-default.test.ts`",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — a5d66e92 removed
        # the binding read this row planted into (identityOf now reads only the identity), and the rule it guards
        # still holds: a holder an OLD database bound in another project is numbered in default. The plant puts
        # the binding read back, over the identity SELECT, and hands its project to workBeingAssigned.
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** 5e931be8 removed projects
        # and the binding: "the project, proposal, binding, home and document tables go", and
        # `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts` says
        # "`0000_the_tree` dropped the old `agent_profile` binding table". The plant's
        # `agent_profile`/`project` join and `projectSlug` no longer exist, and task numbers are now
        # labels (W1.1), so nothing is numbered in a project. Its anchor is left stale, so the
        # census records it retired.
        [
            (SESSION_STORE, "`SELECT identity.slug AS profile_slug\n           FROM provider_session s\n           JOIN agent_identity identity ON identity.id = s.agent_identity_id\n          WHERE s.id = ?`", "`SELECT identity.slug AS profile_slug, p.slug AS project_slug\n           FROM provider_session s\n           JOIN agent_identity identity ON identity.id = s.agent_identity_id\n           LEFT JOIN agent_profile ap ON ap.id = s.agent_profile_id\n           LEFT JOIN project p ON p.id = ap.project_id\n          WHERE s.id = ?`"),
            (SESSION_STORE, "return row === undefined ? null : { profileSlug: row.profile_slug }", "return row === undefined ? null : { profileSlug: row.profile_slug, projectSlug: (row as { project_slug?: string | null }).project_slug ?? undefined }"),
            (RUNTIME_HOST, "      projectSlug: DEFAULT_PROJECT_ID,\n    }\n  }", "      projectSlug: (identity as { projectSlug?: string }).projectSlug ?? DEFAULT_PROJECT_ID,\n    }\n  }"),
        ],
    ),
    (
        "M21 · ⛔ **list_tasks says the project again** · every task row in list_tasks (both given_to_you and you_gave_out) grows a `project` key beside the number, which D-016 removed with the word 'in <project>' — killed by `a-task-number-names-no-project-and-comes-from-default.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Projects and `Task #N`
        # numbering were retired on purpose; the killer's header says "The project numbering,
        # `list_documents` and the `(task, project)` pair ... are gone, and the cases about them
        # with them", and the commit says "cases whose subject went are deleted". No surviving test
        # pins the key set of `piecePayload` rows, so a `project` key has no killer to go red. Its
        # anchor is left stale, so the census records it retired.
        [
            (AGENT_TOOLS, "): Readonly<Record<string, unknown>> => ({\n  task: task.taskId,\n  number: task.number,\n  state: task.state,", "): Readonly<Record<string, unknown>> => ({\n  task: task.taskId,\n  number: task.number,\n  project: 'default',\n  state: task.state,"),
        ],
    ),
    (
        "M22 · ⛔ **a list_tasks line says where the task is numbered** · taskText writes 'Task #N in default <id> · …' so the model reads a project it can no longer name in any tool — killed by `a-task-is-task-n-where-a-person-reads-it.test.ts`, `a-task-number-names-no-project-and-comes-from-default.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — `taskText`
        # became `pieceText`, and the rule that a list_tasks line reads `<label> · <title> · <state>
        # ... · <brief line>` with nothing sitting between them survives in
        # `a-task-is-task-n-where-a-person-reads-it.test.ts`. The plant puts ` in default` after the
        # title. Killed by `a-task-is-task-n-where-a-person-reads-it.test.ts`.
        [
            # ⚑ **lists return what is open · re-anchored in place, not retired** — a piece that is over now has a short line of its own on the same pattern, so the anchor names the open piece's line by its next line; the plant still puts ` in default` after the title
            (AGENT_TOOLS, "  return `  ${pieceLine(piece.label, piece.title)} · ${piece.state}${\n    wait !== null\n", "  return `  ${pieceLine(piece.label, piece.title)} in default · ${piece.state}${\n    wait !== null\n"),
        ],
    ),
    (
        "M23 · ⛔ **the 'already answered' withdrawal refusal names a project** · withdrawalDetail's answered arm adds `project` beside number, so the closed set of facts a refusal states grows a key D-016 removed — killed by `a-task-number-names-no-project-and-comes-from-default.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired —
        # `withdrawalDetail` is now `takeBackDetail`, and its 'already answered' arm still states a
        # closed set of the piece's facts (`piece`, `label`, `answered`, `resources`, `at`) with no
        # project; the killer's first case pins it. The plant adds a `project` key to that arm.
        # Killed by `a-task-number-names-no-project-and-comes-from-default.test.ts`.
        [
            (AGENT_TOOLS, "        piece,\n        label: refused.label,\n        ...(refused.outcome === null ? {} : { answered: refused.outcome }),", "        piece,\n        project: 'default',\n        label: refused.label,\n        ...(refused.outcome === null ? {} : { answered: refused.outcome }),"),
        ],
    ),
    (
        "M24 · ⛔ **the answer a parent reads names a project** · replyText's first line says 'Task #N in default (task_…) was answered by …', the one sentence every parent is handed when work comes back — killed by `a-task-number-names-no-project-and-comes-from-default.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The sentence a
        # parent is handed when work comes back survives as `replyText` in `reply-rails.ts`
        # (`<label> · <title> was answered by <holder>: <outcome>.`), pinned whole by the killer's
        # second case. The plant inserts ` in default` after the piece line. Killed by
        # `a-task-number-names-no-project-and-comes-from-default.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The sentence a parent is handed when work comes back is now
        # `replyText` in reply-rails.ts, `<label> · <title> was answered by <holder>: <outcome>.`,
        # and the killer pins the whole sentence with `toBe`. The plant inserts ` in default` after
        # the piece line, which is the label's defect (the answer names a project). The old 'Task #N
        # in default' wording went with tasks. Killed by
        # `a-task-number-names-no-project-and-comes-from-default.test.ts`.
        [
            (REPLY_RAILS, "`${pieceLine(piece.label, piece.title)} was answered by ${holder}: ${reply.outcome}.`,", "`${pieceLine(piece.label, piece.title)} in default was answered by ${holder}: ${reply.outcome}.`,"),
        ],
    ),
    (
        "M25 · ⛔ **list_documents takes a project again** · the tool advertises an optional `project` argument that D-016 removed, and ignores it, so a model can ask for a scope this app no longer has — killed by `a-task-number-names-no-project-and-comes-from-default.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** Documents were retired end
        # to end: the commit says "list_documents is gone and read_document reads a resource", and
        # the killer's header lists `list_documents` among what is gone. The `input: {}` /
        # `host.listDocuments()` text the plant edits no longer exists. Its anchor is left stale, so
        # the census records it retired.
        [
            (AGENT_TOOLS, "      input: {},\n      call: () =>\n        guarded(async () => {\n          const listing = host.listDocuments()", "      input: { project: z.string().optional() },\n      call: () =>\n        guarded(async () => {\n          const listing = host.listDocuments()"),
        ],
    ),
    (
        "M26 · ⛔ **the (task, project) pair ignores the project a legacy task recorded** · the number lookup compares the asked project to the constant 'default' instead of the payload's projectSlug, so a task an old database numbered elsewhere can no longer register its reply's document — killed by `a-task-number-names-no-project-and-comes-from-default.test.ts`",
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The `(task, project)` pair
        # and the `$.projectSlug` lookup went with projects and tasks: the killer's header says "the
        # `(task, project)` pair an old ledger's assignment wrote are gone, and the cases about them
        # with them". A reply's files are now resources kept under `<userData>/resources/<sha256>/`,
        # so the json_extract clause has no counterpart. Its anchor is left stale, so the census
        # records it retired.
        [
            (SESSION_STORE, "              AND json_extract(assigned.payload, '$.projectSlug') = ?)", "              AND 'default' = ?)"),
        ],
    ),
    (
        "M30 · The digest window drops its placed-conversation filter, so a conversation no agent holds has its events read into the digest — killed by `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`, `the-digest-and-its-window.test.ts`, `a-digest-over-two-agents-and-a-stranger-counts-each-once.test.ts`",
        [
            (SESSION_STORE, "WHERE s.agent_identity_id IS NOT NULL\n        AND e.created_at >= ? AND e.created_at < ?", "WHERE e.created_at >= ? AND e.created_at < ?"),
        ],
    ),
    (
        "M31 · The digest window keys its placed filter on the caller's directory name (profile_id) instead of the identity, so a pre-profile placed conversation drops out of the digest — killed by `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`",
        [
            (SESSION_STORE, "WHERE s.agent_identity_id IS NOT NULL\n        AND e.created_at >= ?", "WHERE s.profile_id IS NOT NULL\n        AND e.created_at >= ?"),
        ],
    ),
    (
        "M32 · The placed-conversation count keys on the directory name (profile_id IS NOT NULL) instead of the identity, so a pre-profile placed conversation is counted as held by no agent — killed by `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`",
        [
            (SESSION_STORE, "SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NOT NULL", "SELECT count(*) AS n FROM provider_session WHERE profile_id IS NOT NULL"),
        ],
    ),
    (
        "M33 · The forest joins a conversation to its identity by directory name (identity.slug = profile_id) instead of by agent_identity_id, so a mixed-case or pre-profile conversation falls out of the forest — killed by `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`",
        [
            (SESSION_STORE, "       JOIN agent_identity identity ON identity.id = provider_session.agent_identity_id\n      ORDER BY provider_session.updated_at DESC", "       JOIN agent_identity identity ON identity.slug = provider_session.profile_id\n      ORDER BY provider_session.updated_at DESC"),
        ],
    ),
    (
        "M34 · spawnedBy answers the child's directory spelling (profile_id) instead of its identity slug, so a child of any other case reads as 'Worker' not 'worker' — killed by `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # `spawnedBy` answers the child's agent identity slug and never the directory spelling
        # survives; the query lost its `spawn_reason` column, so only the anchor moved. The plant
        # selects `s.profile_id` (still a column in 0000_the_tree) as the identity. Killed by
        # `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`.
        [
            (SESSION_STORE, "`SELECT s.id AS id, s.provider AS provider, identity.slug AS identity", "`SELECT s.id AS id, s.provider AS provider, s.profile_id AS identity"),
        ],
    ),
    (
        "M35 · conversationBinding answers the directory spelling (profile_id) instead of the identity slug, so the binding of a mixed-case or pre-profile conversation is wrong — killed by `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`",
        [
            (SESSION_STORE, "SELECT s.provider AS provider, identity.slug AS identity", "SELECT s.provider AS provider, s.profile_id AS identity"),
        ],
    ),
    (
        "M36 · conversationBinding joins identities with an INNER JOIN, so a conversation no agent holds reads as no such conversation and its child list and breadcrumb vanish — killed by `a-conversation-is-found-by-its-agent-and-not-by-its-directory-name.test.ts`",
        [
            (SESSION_STORE, "           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id\n          WHERE s.id = ?", "           JOIN agent_identity identity ON identity.id = s.agent_identity_id\n          WHERE s.id = ?"),
        ],
    ),
    (
        "M37 · spawnedBy joins identities with an INNER JOIN, so a child no agent holds vanishes from its parent's child list — killed by `who-called-whom.test.ts`",
        [
            (SESSION_STORE, "           LEFT JOIN agent_identity identity ON identity.id = s.agent_identity_id\n          WHERE s.parent_session_id = ?", "           JOIN agent_identity identity ON identity.id = s.agent_identity_id\n          WHERE s.parent_session_id = ?"),
        ],
    ),
    (
        "M40 · HOME_FOLDER names a folder other than 'default', so every home is derived and listed in a folder no conversation ever ran in — killed by `provider-homes.test.ts`, `session-profile.test.ts`",
        [
            (PROVIDER_HOMES, "export const HOME_FOLDER = 'default'", "export const HOME_FOLDER = 'homes'"),
        ],
    ),
    (
        "M41 · deriveProviderHome drops the folder and lays the home at <root>/<profile>/<provider>, so a home is created and resumed outside the one folder — killed by `provider-homes.test.ts`, `session-profile.test.ts`",
        [
            (PROVIDER_HOMES, "return join(providerHomesRoot(userData), HOME_FOLDER, identity.profileId, identity.provider)", "return join(providerHomesRoot(userData), identity.profileId, identity.provider)"),
        ],
    ),
    (
        "M42 · listProviderHomes walks every folder under the managed root, not only `default`, so a home this app never laid down is listed and adopted as if it were under `default` — killed by `provider-homes.test.ts`, `profile-uniqueness.test.ts`",
        [
            # This row follows the same behavior after provider facts moved into the registry.
            # ⚑ **provider registry · re-anchored in place, not retired** — The schema now validates directory names; scanning beside the managed home folder still adopts homes this app did not create.
            ("apps/desktop/src/main/runtime/provider-homes.ts", "  const root = join(providerHomesRoot(userData), HOME_FOLDER)\n  if (!existsSync(root)) return []\n\n  const homes: ExistingProviderHome[] = []\n  for (const profileId of subdirectories(root)) {\n    if (!isPathSegment(profileId)) continue\n    for (const provider of subdirectories(join(root, profileId))) {\n      const parsed = providerSchema.safeParse(provider)\n      if (!parsed.success) continue\n      homes.push({ profileId, provider: parsed.data, path: join(root, profileId, provider) })\n    }\n  }\n  return homes\n", "  const root = providerHomesRoot(userData)\n  if (!existsSync(root)) return []\n\n  const homes: ExistingProviderHome[] = []\n  for (const folder of subdirectories(root)) {\n    for (const profileId of subdirectories(join(root, folder))) {\n      if (!isPathSegment(profileId)) continue\n      for (const provider of subdirectories(join(root, folder, profileId))) {\n        const parsed = providerSchema.safeParse(provider)\n        if (!parsed.success) continue\n        homes.push({ profileId, provider: parsed.data, path: join(root, folder, profileId, provider) })\n      }\n    }\n  }\n  return homes\n"),
        ],
    ),
    (
        "M43 · the path listProviderHomes reports for a home omits the `default` folder, so adoption looks for the conversation where no home lies — killed by `adopt-sessions.test.ts`",
        [
            # This row follows the same behavior after provider facts moved into the registry.
            # ⚑ **provider registry · re-anchored in place, not retired** — Only the validated provider expression changed; dropping the managed folder from the returned path restores the same fault.
            ("apps/desktop/src/main/runtime/provider-homes.ts", "      homes.push({ profileId, provider: parsed.data, path: join(root, profileId, provider) })\n", "      homes.push({ profileId, provider: parsed.data, path: join(providerHomesRoot(userData), profileId, provider) })\n"),
        ],
    ),
    (
        "M44 · resume prepares the default profile's home whatever profile the row recorded, so a conversation of another profile reopens in a home it never ran in — killed by `session-profile.test.ts`",
        [
            (RUNTIME_HOST, "await this.prepareAHome(\n      row.provider,\n      profileId,\n", "await this.prepareAHome(\n      row.provider,\n      DEFAULT_PROFILE_ID,\n"),
        ],
    ),
    (
        "M45 · resume of a row with no recorded profile uses the folder's own name 'default' as the profile, so it reopens in default/default instead of the default profile's home — killed by `session-profile.test.ts`",
        [
            (RUNTIME_HOST, "const profileId = row.profileId ?? DEFAULT_PROFILE_ID\n    const { home: providerHome, loginRenewed } = await this.prepareAHome(", "const profileId = row.profileId ?? 'default'\n    const { home: providerHome, loginRenewed } = await this.prepareAHome("),
        ],
    ),
    (
        "M46 · providerHomeFor answers the default profile's home for every session, so an ended conversation of another profile has its config, transcript and files read from the wrong home — killed by `a-conversation-of-any-profile-lives-in-the-one-home-folder.test.ts`",
        [
            (RUNTIME_HOST, "return this.deps.providerHomePath(session.provider, session.profileId ?? DEFAULT_PROFILE_ID)", "return this.deps.providerHomePath(session.provider, DEFAULT_PROFILE_ID)"),
        ],
    ),
    (
        "M47 · credentialHome keeps its profileId validation but returns a path without the `default` folder, so a credential gesture is admitted under a key that is not the home it writes — killed by `a-conversation-of-any-profile-lives-in-the-one-home-folder.test.ts`",
        [
            (PROVIDER_HOMES, "    credentialHome(provider, profileId) {\n      return deriveProviderHome(userData, { profileId, provider })\n    },", "    credentialHome(provider, profileId) {\n      deriveProviderHome(userData, { profileId, provider })\n      return join(providerHomesRoot(userData), profileId, provider)\n    },"),
        ],
    ),
    (
        "M48 · main's providerHomePath seam ignores the profile it is given and always derives the default profile's home — killed by `a-conversation-of-any-profile-lives-in-the-one-home-folder.test.ts`",
        [
            (INDEX, "    providerHomePath: (provider, profileId) =>\n      deriveProviderHome(userData, { profileId, provider }),", "    providerHomePath: (provider, _profileId) =>\n      deriveProviderHome(userData, { profileId: 'brobot', provider }),"),
        ],
    ),
    (
        "M49 · main's prepareProviderHome seam ignores the profile it is given and always provisions the default profile's home — killed by `a-conversation-of-any-profile-lives-in-the-one-home-folder.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — the API-keys work (5fecec18) added a third argument `{ apiKey, codexKey }` to the call; the plant keeps it and hard-codes the default profile. Killer's PREPARE_SEAM census already spells the new call.
            (INDEX, "    prepareProviderHome: async (provider, profileId) => {\n      await transcriptRetention?.beforeLaunch()\n      return prepareProviderHome(userData, { profileId, provider }, homeSeams)\n    },", "    prepareProviderHome: async (provider, _profileId) => {\n      await transcriptRetention?.beforeLaunch()\n      return prepareProviderHome(userData, { profileId: 'brobot', provider }, homeSeams)\n    },"),
        ],
    ),
    (
        "M50 · `new: true` given to an agent the giver already has a conversation with is no longer refused `that-profile-exists`: the give reuses the old conversation, so a \"new\" agent is handed the old one's memory — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        [
            (SPAWN_RAILS, "    if (asked.new === true) return no('that-profile-exists', { profileId: asked.profile })", "    if (asked.new === true && (false as boolean)) return no('that-profile-exists', { profileId: asked.profile })"),
        ],
    ),
    (
        "M51 · `new: true` given to an existing agent the giver has no conversation with starts a conversation instead of being refused `that-profile-exists` — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        [
            (SPAWN_RAILS, "  if (known && asked.new === true) return no('that-profile-exists', { profileId: asked.profile })", "  if (known && asked.new === true && (false as boolean)) return no('that-profile-exists', { profileId: asked.profile })"),
        ],
    ),
    (
        "M52 · A giver without the grant to create agents that asks for `new` is no longer refused `may-not-create-agents`: the give goes on and the launch makes the agent — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        [
            (SPAWN_RAILS, "  if (asked.new === true && !known && creator === null) {", "  if (asked.new === true && !known && creator === null && (false as boolean)) {"),
        ],
    ),
    (
        "M53 · The agent a `new: true` give makes is written by the launch and not by the give: it is recorded as made by this app, never by the giver that asked for it — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        [
            (SPAWN_RAILS, "      creating: creator === null ? null : { slug: foldProfileName(asked.profile), by: creator },", "      creating: null,"),
        ],
    ),
    (
        "M54 · An agent a `new: true` give creates is started under the spelling the giver typed, not its folded name, so `provider_session.profile_id` reads `Archivist` beside an identity `archivist` — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        [
            (SPAWN_RAILS, "    profileId: known ? asked.profile : foldProfileName(asked.profile),", "    profileId: asked.profile,"),
        ],
    ),
    (
        "M55 · A giver holding SEVERAL pieces that names none is not asked to name one: the give is hung under the first piece it holds — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — D-022 F030 restructured the inference in `admitGive`: only pieces
        # whose brief has reached the giver count (`received`), the one its turn drives is picked,
        # and otherwise it refuses with `name-the-piece-you-give-from`, so `held.length === 1` is
        # gone. The plant falls back to `received[0]` when no received piece is driven, which hangs
        # the give under the first piece held, the label's defect. The killer is red on landing
        # before any plant and needs its fixture fixed first (see other_notes). Killed by
        # `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`.
        [
            (SPAWN_RAILS, "          ? received.find((one) => one.piece === drives)\n", "          ? (received.find((one) => one.piece === drives) ?? received[0])\n"),
        ],
    ),
    (
        "M56 · A giver holding NO piece is told to name one, from an empty list, instead of being told it holds nothing to give from — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The old `held.length === 0` branch is now the `received.length > 1 ?
        # name-the-piece-you-give-from : no-piece-to-give-from` ternary that ends the inference in
        # `admitGive`. The plant makes the test `received.length !== 1`, so a giver holding nothing
        # is told to name one from an empty list instead of being told it has nothing to give from.
        # The killer's second test, 'a giver holding no piece is told it has nothing to give from',
        # expects `no-piece-to-give-from` and is green at baseline. Killed by
        # `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`.
        [
            (SPAWN_RAILS, "      return received.length > 1\n        ? no('name-the-piece-you-give-from', { held: received.map((one) => one.label) })\n", "      return received.length !== 1\n        ? no('name-the-piece-you-give-from', { held: received.map((one) => one.label) })\n"),
        ],
    ),
    (
        "M57 · A giver that names the piece it gives from by its `work_…` id is refused `no-piece-you-hold-by-that-name`: only the label is read — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        [
            (SPAWN_RAILS, "    const named = held.find((one) => one.piece === asked.piece || one.label === asked.piece)", "    const named = held.find((one) => one.label === asked.piece)"),
        ],
    ),
    (
        "M58 · A give that names a folder to an agent the giver already has a conversation with never says what became of the folder — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        # ⚑ W4.189 · re-anchored in place, not retired — the folder is granted for that piece now,
        # where it used to be reported unused; the plant drops the grant, so the answer says nothing
        # of the folder it named.
        [
            (SPAWN_RAILS, "      if (folder.ok) grant = folder.path\n", "      if (false) grant = folder.path\n"),
        ],
    ),
    (
        "M59 · A brief held behind a turn lists its own piece among the work its sender \"gave you\", so the tag reads `who is giving you W1.2 · Title and gave you W1.1 and W1.2` — killed by `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — `whereTheSenderStands` still lists the work its sender gave the
        # reader, and the plant drops the `one.piece !== handing?.piece` exclusion from the filter
        # (the old `giver.has(one.giver) && ...` text gained a null check, so the anchor moved). A
        # brief held behind a turn then lists its own piece among the work the sender 'gave you',
        # and the tag reads '... and gave you W1.1 and W1.2'. The tag test is red on landing before
        # any plant because it still expects `'queued'` (see other_notes). Killed by
        # `a-new-agent-is-asked-for-by-name-and-a-give-names-the-piece-it-hangs-under.test.ts`.
        [
            (RUNTIME_HOST, "      .filter((one) => one.giver !== null && giver.has(one.giver) && one.piece !== handing?.piece)", "      .filter((one) => one.giver !== null && giver.has(one.giver))"),
        ],
    ),
    (
        "M60 · a retitle or a status line on a still-open piece is written to the row list but not to the open entry, so the piece's title or line is lost when the piece settles — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        [
            (TASKS, "if (open.has(event.piece)) open.set(event.piece, { row: next, index })", "if (open.has(event.piece)) void index"),
        ],
    ),
    (
        # Same defect on its current subject; source-only, NOT VERIFIED.
        "M61 · a root's title and status are read from the OLDEST line instead of the newest — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        [
            (SESSION_STORE, "            AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?\n          ORDER BY ordinal DESC", "            AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?\n          ORDER BY ordinal ASC"),
        ],
    ),
    (
        # Same defect on its current subject; source-only, NOT VERIFIED.
        "M62 · a root's lines are read without the valid-JSON guard, so one torn line stops the read of the whole root — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        [
            (SESSION_STORE, "            AND type = ?\n            AND CASE WHEN json_valid(payload) THEN CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END END = ?", "            AND type = ?\n            AND CASE WHEN json_type(payload, '$.piece') = 'text' AND length(CAST(json_extract(payload, '$.piece') AS BLOB)) BETWEEN 1 AND 512 THEN json_extract(payload, '$.piece') END = ?"),
        ],
    ),
    (
        "M63 · update_work lets anyone through the entitlement gate, so a stranger or the worker can write to a root or a piece that is not theirs — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        [
            (RUNTIME_HOST, "if (root ? !itsOwner : !itsGiver && !itsOwner) return notFound", "if (false) return notFound"),
        ],
    ),
    (
        "M64 · a piece's record is shown to a conversation that neither owns nor gave it — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        # ⚑ Landing D-024, D-020 and D-021 · re-anchored in place, not retired — The rule survives: a
        # stranger gets `no-piece-by-that-name` for a piece's record. D-024 R2 widened the entitlement to
        # a conversation of the holder's or giver's own profile (`itsProfiles`), so the gate is now `if
        # (!itsOwner && !itsGiver && !itsProfiles) return ...`, and DEV's note says the plant should void
        # `itsProfiles` too. The killer's stranger case (a person opened as 'stranger', no shared profile)
        # still expects the refusal, so removing the whole gate reddens it. Killed by
        # `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`.
        [
            (RUNTIME_HOST, "if (!itsOwner && !itsGiver && !itsProfiles) return { is: 'no-piece-by-that-name' }", "void itsOwner\n    void itsGiver\n    void itsProfiles"),
        ],
    ),
    (
        "M65 · the owner of a piece may name it as well as the giver — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule stands: only the giver names a given piece, and the owner is refused with
        # `the-giver-names-a-piece`. D-016c turned the block into a one-line `return refused(...)`
        # with a shared `named`, so the old `{`-ending line matches nothing. The plant lets the
        # owner name it as well. Killed by
        # `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The rule stands: only the giver names a given piece, and its owner is
        # refused with `the-giver-names-a-piece`. D-016c turned the block into a one-line `return
        # refused(...)` with a shared `named`, so the old `{`-ending anchor matches nothing. The
        # plant adds `&& !itsOwner` to the refusing condition in `updateWork`, so the owner may name
        # it too and the killer's owner refusal (line 393) is no longer given. Killed by
        # `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`.
        [
            # ⚑ **W4.150 · re-anchored in place, not retired** — F090 asks the title rule once, as a named boolean, so a piece that has ended is refused as one before whose act a title is; the plant still lets the owner name the piece as well as its giver
            (RUNTIME_HOST, "    const aTitleOnlyItsGiverGives = input.title !== null && !itsGiver && row.givenBy !== null\n", "    const aTitleOnlyItsGiverGives = input.title !== null && !itsGiver && !itsOwner && row.givenBy !== null\n"),
        ],
    ),
    (
        "M66 · a status may be set on a piece that has answered, so the reply's words can be overwritten after the end — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        [
            (RUNTIME_HOST, "    if (folded !== undefined && !TASK_IS_OPEN[folded.state]) {\n      // ⚑ **F059 — how it ended, when and by whom**, as `reply_to_parent`'s refusal says it.\n      const endedBy = folded.endedBy", "    if (folded !== undefined && folded.state === 'withdrawn') {\n      // ⚑ **F059 — how it ended, when and by whom**, as `reply_to_parent`'s refusal says it.\n      const endedBy = folded.endedBy"),
        ],
    ),
    (
        "M67 · a title cannot be set on a piece that has ended (the end-of-piece rule is applied to titles as well as statuses) — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # ended-piece check no longer hangs off `input.status !== null && !root`; D-016c reads the
        # folded piece once, in `folded = root || (input.status === null && !rebriefs &&
        # !input.close && !keeps) ? undefined : ...`, and refuses `that-piece-has-ended` on it. The
        # subject (a title still goes through on an ended piece) is unchanged, so the plant makes a
        # title also trigger the read, and the refusal follows. Killed by
        # `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`.
        [
            ('apps/desktop/src/main/runtime/runtime-host.ts', '      root || (input.status === null && !revises && !input.close && !keeps)\n', '      root || (input.status === null && input.title === null && !revises && !input.close && !keeps)\n'),
        ],
    ),
    (
        "M68 · a reply's summary is no longer the piece's status line — killed by `small-true-words-for-the-model-and-the-lists.test.ts`, `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        [
            (TASKS, "statusLine: { text: event.summary, by: owner, at: entry.at },", "statusLine: null,"),
        ],
    ),
    (
        "M69 · a title or status of any length is accepted, so an over-long line is stored whole — killed by `a-root-is-titled-and-a-piece-says-where-it-stands.test.ts`",
        [
            (AGENT_TOOLS, "if (trimmed === '' || trimmed.length > most) {", "if (trimmed === '') {"),
        ],
    ),
    (
        "M70 · The owner of a taken-back piece is told even when it was replaced: the tell is sent to whichever conversation now stands in its place, which never held the piece — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # take-back tell now goes through anAppNoticeToItsHolder and toItsHolderAlone, where the
        # replaced-owner guard is doubled: `if (this.theOneInItsPlace(holder) !== holder) return
        # null` at the top, and a `to === holder ? queueAs : Promise.reject(...)` inside `deliver`.
        # Removing only the top line is an equivalent mutant (the reject makes the tell fail and
        # told is still false), so the row carries two edits that together send the tell to
        # whichever conversation now stands in the owner's place. Killed by
        # `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`.
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The replaced-owner guard in `toItsHolderAlone` is doubled: `if
        # (this.theOneInItsPlace(holder) !== holder) return null` at the top and the `to === holder
        # ? atTheHolder : Promise.reject(...)` inside `deliver`. Both edits are needed, since
        # removing only the top line is an equivalent mutant, and together they let the tell go to
        # whichever conversation now stands in the owner's place. The killer asserts the removed
        # `.told` field at lines 364 and 396, so it is red on landing and must be re-aimed to
        # `delivery` (see other_notes). Killed by
        # `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`.
        [
            (RUNTIME_HOST, "    if (this.theOneInItsPlace(holder) !== holder) return null\n", ""),
            # ⚑ **W4.78 · re-anchored in place, not retired** — 34a00442 replaced the plain Error with `new ItsPlaceWasTaken(to, holder, piece.label)`; edit 0 (`if (this.theOneInItsPlace(holder) !== holder) return null`) still applies once. Killer still asserts delivery 'not-delivered' and no take-back notice in the replacement.
            (RUNTIME_HOST, "      to === holder\n        ? atTheHolder(to, onAStop)\n        : Promise.reject(new ItsPlaceWasTaken(to, holder, piece.label))\n", "      atTheHolder(to, onAStop)\n"),
        ],
    ),
    (
        "M71 · The tell never says what the owner still holds under the piece: the clause listing its open pieces is dropped — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # clause listing the owner's still-open pieces moved out of the tell into the shared
        # itsOpenPiecesAreStillYours (used by both take-back and close) and now reads `...take each
        # back with withdraw_task, or close it with update_work, if it is no longer needed.`, so the
        # old inline block matches nothing. The plant makes that helper always return `[]`, so the
        # tell never says what the owner still holds. Killed by
        # `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`.
        [
            (RUNTIME_HOST, "    return stillOpen.length === 0\n      ? []\n      : [\n          `Its open pieces ${stillOpen.join(', ')} are still yours: take each back with withdraw_task, or close it with update_work, if it is no longer needed.`,\n        ]\n", "    return stillOpen.length === 0 ? [] : []\n"),
        ],
    ),
    (
        "M72 · A take-back always reports its owner as told, even when the tell was skipped or failed — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The take-back answer's field is now `delivery: await
        # this.tellItsOwnerItWasTakenBack(...)` (D-022 replaced `told: true` with `delivery:
        # sent|held|not-delivered`), so the old `told:` anchor is gone. The plant forces `delivery`
        # to `'sent'` whenever the tell returned a truthy value, so a tell that was skipped or
        # failed is reported as delivered. The killer's 'has been told.' and 'could not be told'
        # text assertions are still valid. Killed by
        # `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 34a00442 made the tell return a Told object ({delivery, whyNotTold?}) that is spread into the answer; the plant overrides delivery with 'sent' after the spread. Killer still asserts delivery 'not-delivered' and 'could not be told' for a replaced owner.
            (RUNTIME_HOST, "      ...(await this.tellItsOwnerItWasTakenBack(piece, asAgent)),\n", "      ...(await this.tellItsOwnerItWasTakenBack(piece, asAgent)),\n      delivery: 'sent',\n"),
        ],
    ),
    (
        "M73 · The tell no longer tells the owner to stop or not to reply_to_parent: it only says who took the piece back — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # stop sentence ` Stop working on it and do not reply_to_parent about it.` now occurs twice,
        # in the take-back tell and in the new close tell (`tellItsOwnerItWasClosed`), so the old
        # bare string matches twice. The new anchor starts at `took back ${pieceLine(...)}.` and is
        # unique (count 1); the plant removes the sentence from the take-back tell only. Killed by
        # `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`.
        [
            (RUNTIME_HOST, "took back ${pieceLine(piece.label, piece.title)}. Stop working on it and do not reply_to_parent about it.`,", "took back ${pieceLine(piece.label, piece.title)}.`,"),
        ],
    ),
    (
        "M74 · A follow-up naming the sender's own root is refused with the wrong word: not-a-piece-you-gave instead of that-is-your-own-work — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        [
            (AGENT_TOOLS, "                  : it.is === 'its-root'\n                    ? refuseTool('that-is-your-own-work', { piece: it.piece, label: it.label })\n                    : refuseTool('not-a-piece-you-gave', { agent, piece: named }),\n", "                  : refuseTool('not-a-piece-you-gave', { agent, piece: named }),\n"),
        ],
    ),
    (
        "M75 · A note naming a piece that is not the sender's to name is refused with the follow-up's word (not-a-piece-you-gave) instead of no-piece-by-that-name — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        [
            (AGENT_TOOLS, "            if (it.is === 'none') {\n              return refusalAnswer(refuseTool('no-piece-by-that-name', { piece: named }))\n            }\n", "            if (it.is === 'none') {\n              return refusalAnswer(refuseTool('not-a-piece-you-gave', { agent, piece: named }))\n            }\n"),
        ],
    ),
    (
        "M76 · An ask that names no piece gets the wrong word: the two branches of noPieceToAskAbout are swapped, so several held says there is no piece and none held says to name one — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        [
            (QUESTION_RAILS, "  return held.length > 1\n    ? refuseQuestion('name-the-piece-you-ask-about', { held })\n    : refuseQuestion('no-piece-to-ask-about')\n", "  return held.length > 1\n    ? refuseQuestion('no-piece-to-ask-about')\n    : refuseQuestion('name-the-piece-you-ask-about', { held })\n"),
        ],
    ),
    (
        "M77 · A question for the giver of a conversation's own root is no longer routed to a person: it goes to 'the-parent', which nobody gave — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        [
            (RUNTIME_HOST, "input.who === 'the-parent' && piece !== null && piece.giver === null ? 'a-person' : input.who", "input.who"),
        ],
    ),
    (
        "M78 · The answer to a question about a conversation's own root says the work was not handed back but names reply_to_parent, as for a given piece: aboutItsRoot is always false — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        # ⚑ Landing D-016c commits 6–7 and D-022 (4a7f0fec, c1a79abe, 37228461) · re-anchored in
        # place, not retired — The answer about a conversation's own root is decided by
        # `aboutItsRoot`, which is now `piece !== null && piece.root` (the old `piece.giver ===
        # null` test is gone, since a person's piece also has `giver === null`). The plant makes it
        # always false, so the answer says the work was not handed back and names reply_to_parent,
        # as for a given piece. The killer asserts "this conversation's own work is a person's" for
        # the root and 'reply_to_parent is what does that' for a worker. Killed by
        # `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`.
        [
            (RUNTIME_HOST, "      aboutItsRoot: piece !== null && piece.root,\n", "      aboutItsRoot: false,\n"),
        ],
    ),
    (
        "M79 · The tell lists every piece under the taken-back one, including ones already withdrawn or answered, as still the owner's to take back — killed by `a-take-back-tells-its-owner-and-a-note-names-what-it-is-about.test.ts`",
        [
            (RUNTIME_HOST, "    const stillOpen = openWorkOf(\n      this.childrenOnTheRecord(piece.piece, this.oneWaitReadPerAnswer(), rowsUnreadOnce()),\n    ).map((child) => child.label)\n", "    const stillOpen = this.childrenOnTheRecord(\n      piece.piece,\n      this.oneWaitReadPerAnswer(),\n      rowsUnreadOnce(),\n    ).map((child) => child.label)\n"),
        ],
    ),
    (
        "M80 · a reply records its file with the wrong role: the row says 'input' (a thing the piece was given) for a file the replier MADE — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        [
            (RUNTIME_HOST, "              role: 'made',\n", "              role: 'input',\n"),
        ],
    ),
    (
        "M81 · the size column counts characters, not bytes: bytes: file.bytes.toString('utf8').length — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # size column of a reply's files is still `bytes: file.bytes.length` in replyToParent, but
        # the same line now occurs in three places (a reply, the give's inputs, update_work's
        # files), and the 14-space form is a substring of the 18-space one, so the old string
        # matches twice. The new anchor adds the reply's own next line `addedBy: speaking,` (count
        # 1); the plant counts characters, not bytes. Killed by
        # `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`.
        [
            (RUNTIME_HOST, "              bytes: file.bytes.length,\n              addedBy: speaking,\n", "              bytes: file.bytes.toString('utf8').length,\n              addedBy: speaking,\n"),
        ],
    ),
    (
        "M82 · the reply's file cap is off by one: eleven files are accepted where the limit says ten — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # cap check `paths.length > MAX_RESOURCES_PER_REPLY)` now appears in reply_to_parent and in
        # update_work's new `resources` argument, so the old string matches twice. The new anchor
        # continues into the reply's named `resource_paths` problem and is unique (count 1);
        # the plant is the same off-by-one. Killed by
        # `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`.
        [
            # ⚑ **619 · re-anchored in place, not retired** — NOT VERIFIED. The cap diagnostic now uses named-field problems; the same eleven-for-ten off-by-one changes only the cap guard.
            (AGENT_TOOLS, "paths.length > MAX_RESOURCES_PER_REPLY) {\n            problem(\n              'resource_paths',", "paths.length > MAX_RESOURCES_PER_REPLY + 1) {\n            problem(\n              'resource_paths',"),
        ],
    ),
    (
        "M83 · a file is KEPT as it is read, so a reply refused on a later file leaves the earlier files kept — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        [
            (RUNTIME_HOST, "      if (!read.ok) return read\n      files.push(read)\n", "      if (!read.ok) return read\n      files.push(read)\n      keepResource(root, read)\n"),
        ],
    ),
    (
        "M84 · the writer takes the hash and the name as they come: the lowercase-sha-256 and one-segment guard in keepResource is gone — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        [
            (RESOURCES, "  if (!SHA256_HEX.test(offered.sha256) || !isOneSegment(offered.name)) {\n    return { ok: false, problem: 'write-failed' }\n  }\n", "  // planted: the hash and the name are taken as they come\n"),
        ],
    ),
    (
        "M85 · the bytes are rewritten on the way in: line endings normalised and invalid UTF-8 replaced, then hashed and kept consistently, so the reader cannot tell — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        [
            (RESOURCES, "    bytes = readBounded(fd, stat.size)\n", "    bytes = Buffer.from(readBounded(fd, stat.size).toString('utf8').replace(/\\r\\n/g, '\\n'))\n"),
        ],
    ),
    (
        "M86 · the max_depth CHECK admits one past the capability count: BETWEEN 0 AND 65 — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        [
            (MIGRATION_0000_THE_TREE, "BETWEEN 0 AND 64)", "BETWEEN 0 AND 65)"),
        ],
    ),
    (
        "M87 · the can_write_rules CHECK admits a word from another column's vocabulary: 'any' — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        [
            (MIGRATION_0000_THE_TREE, "IN ('none', 'propose', 'relay'))", "IN ('none', 'propose', 'relay', 'any'))"),
        ],
    ),
    (
        "M88 · events_work_idx lists six of the seven piece events: work_closed is dropped from the partial index — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        [
            (MIGRATION_0000_THE_TREE, "'work_rebriefed', 'work_closed');", "'work_rebriefed');"),
        ],
    ),
    (
        "M89 · the tree's migration stamp ties the last old build's stamp, so an old database file is silently skipped and accepted instead of refused — killed by `a-reply-keeps-the-files-it-was-handed-exactly-as-they-were.test.ts`",
        [
            (_JOURNAL, "\"when\": 1790676652301,", "\"when\": 1790366221584,"),
        ],
    ),
    (
        "M90 · a close takes the held brief back BEFORE it writes work_closed, so the piece folds withdrawn instead of closed — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        # ⚑ Re-anchored in place, not retired — `work_closed` is now written by `endThePiece`, in one
        # transaction with the endings of the questions passed up about the piece. The rule survives:
        # the held brief is taken back only after that row, and the plant still moves it before it.
        [
            (RUNTIME_HOST, "      this.endThePiece(\n        row.owner,\n        { type: 'work_closed', piece: row.piece, by: caller },\n        'work-closed',\n        copies.copies,\n      )\n      // ⛔ **After `work_closed`, never before** — see this method's docblock.\n      const tookBackTheMessage = this.takeBackTheHeldMessages(folded, held)", "      const tookBackTheMessage = this.takeBackTheHeldMessages(folded, held)\n      this.endThePiece(\n        row.owner,\n        { type: 'work_closed', piece: row.piece, by: caller },\n        'work-closed',\n        copies.copies,\n      )"),
        ],
    ),
    (
        "M91 · the fold settles a work_closed piece as withdrawn, so a closed piece reads as one taken back — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        # ⚑ Landing PE-006, D-018 and D-025 · re-anchored in place, not retired — D-025 (b1bd62db) gave
        # `settle` an actor, so the `work_closed` arm is now `settle(event.piece, 'closed', entry.at,
        # event.by)` and the old anchor no longer matches. The rule survives: a closed piece must not read
        # as one taken back, and the killer still asserts state 'closed' and not 'withdrawn'. The plant
        # keeps `event.by`, which differs from DEV's note that suggests leaving it out. Keeping it makes
        # the state the only difference, so the row cannot go red because the actor went missing. Killed
        # by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`.
        [
            (TASKS, "settle(event.piece, 'closed', entry.at, event.by)", "settle(event.piece, 'withdrawn', entry.at, event.by)"),
        ],
    ),
    (
        "M92 · a piece's close ends its owner's open questions as work-withdrawn (a take-back) instead of work-closed — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            (QUESTIONS, "settle(requestId, 'work-closed', entry.at)", "settle(requestId, 'work-withdrawn', entry.at)"),
        ],
    ),
    (
        "M93 · update_work keeps every file as what the owner made, so a giver's files are not inputs and the owner is not told of them — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            (RUNTIME_HOST, "const role: ResourceRole = itsGiver ? 'input' : 'made'", "const role: ResourceRole = 'made'"),
        ],
    ),
    (
        "M94 · the owner of a piece may brief or close it, not only the giver who gave it — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            ('apps/desktop/src/main/runtime/runtime-host.ts', '    if (\n      (revises && !itsGiver && !(itsOwner && row.givenBy === null)) ||\n      (input.close && !itsGiver)\n    ) {', '    if (\n      (revises && !itsGiver && !itsOwner) ||\n      (input.close && !itsGiver && !itsOwner)\n    ) {'),
        ],
    ),
    (
        "M95 · a new brief is delivered to its owner but never written to the ledger, so the piece keeps the old brief — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            ('apps/desktop/src/main/runtime/runtime-host.ts', "    if (revises) {\n      this.writeIntoItsLedger(row.owner, {\n        type: 'work_rebriefed',", "    if (revises && input.close) {\n      this.writeIntoItsLedger(row.owner, {\n        type: 'work_rebriefed',"),
        ],
    ),
    (
        "M96 · the ended-piece rail is asked only for a status, so a new brief or a close of an answered, withdrawn or closed piece goes through — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            (RUNTIME_HOST, "    if (folded !== undefined && !TASK_IS_OPEN[folded.state]) {\n      // ⚑ **F059 — how it ended, when and by whom**, as `reply_to_parent`'s refusal says it.\n      const endedBy = folded.endedBy", "    if (folded !== undefined && input.status !== null && !TASK_IS_OPEN[folded.state]) {\n      // ⚑ **F059 — how it ended, when and by whom**, as `reply_to_parent`'s refusal says it.\n      const endedBy = folded.endedBy"),
        ],
    ),
    (
        "M97 · a close that comes with a new brief is accepted instead of refused as a contradiction — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            ('apps/desktop/src/main/runtime/agent-tools.ts', 'if (closes && (brief !== undefined || condition !== undefined)) {', 'if (closes && (brief !== undefined || condition !== undefined) && paths !== undefined) {'),
            ('apps/desktop/src/main/runtime/runtime-host.ts', '    if (input.close && (input.brief !== null || input.definitionOfDone != null))', '    if (input.close && (input.brief !== null || input.definitionOfDone != null) && input.resources.length > 0)'),
        ],
    ),
    (
        "M98 · give_work drops the files named as inputs, so the piece is given with none — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            (RUNTIME_HOST, "const kept = this.keptFor(admission.giver, asked.inputs ?? [])", "const kept = this.keptFor(admission.giver, [])"),
        ],
    ),
    (
        "M99 · a close no longer takes back the giver's held 'is not being worked on' push about the piece — killed by `the-giver-briefs-closes-and-hands-files-to-a-piece-it-gave.test.ts`",
        [
            (RUNTIME_HOST, "      this.takeBackWhatALaterFactMadeFalse(folded, 'closed')\n      closed = { tookBackTheMessage, endedQuestions }", "      closed = { tookBackTheMessage, endedQuestions }"),
        ],
    ),
    (
        "M100 · a burst a stop or a close cuts ends on no `turn` row of its own, so the `idle` ahead of the close's `ended` is all that is left of it — killed by `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            # ⚑ **F080 · re-anchored in place, not retired** — F080 replaced `closingABurst`: a burst a stop or a close cuts now ends on its own `turn` row, and this row is what keeps it from reading as a wake that ended by itself.
            (SESSION_MACHINE, "    this.say({ type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' })\n", ""),
        ],
    ),
    (
        "M101 · every close is treated as cutting a burst, so a turn a close cuts loses its `idle` and goes from `turn` straight to `ended` — killed by `session-machine.test.ts`, `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            # ⚑ **F080 · re-anchored in place, not retired** — F080 removed `closingABurst`; the same defect, every close treated as cutting a burst, is a close that publishes no `idle`.
            (SESSION_MACHINE, "    // `turn → idle → ended` as a turn does; until F080 it had no row and its status was its record.\n    return 'idle'\n", "    // `turn → idle → ended` as a turn does; until F080 it had no row and its status was its record.\n    return this._state === 'closing' ? null : 'idle'\n"),
        ],
    ),
    (
        "M102 · a stop that cuts a background wake (the provider is `working`, no turn is open) ends nothing, so the wake's piece is left reading working with nothing behind it — killed by `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            (TASKS, "if (driving || aTurnIsOpen) endOfDrive(true, entry.at)", "if (aTurnIsOpen) endOfDrive(true, entry.at)"),
        ],
    ),
    (
        "M103 · a stop that cuts a drive is read as that drive ending by itself, so the piece stalls `turn_ended` where the turn was interrupted — killed by `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            (TASKS, "if (driving || aTurnIsOpen) endOfDrive(true, entry.at)", "if (driving || aTurnIsOpen) endOfDrive(false, entry.at)"),
        ],
    ),
    (
        "M104 · a command that ran in the background is still counted after the stop that killed it, so its piece is told to be in the background and never stalls — killed by `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            (TASKS, "      inTheBackground.clear()\n      if (driving || aTurnIsOpen) endOfDrive(true, entry.at)\n", "      if (driving || aTurnIsOpen) endOfDrive(true, entry.at)\n"),
        ],
    ),
    (
        "M105 · a stop clears the piece's schedules along with its commands, so a schedule that survives a resume no longer holds the piece — killed by `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — F076 put `theStopWasARefusedLogin = false` between endOfDrive and backgroundMoved, and backgroundMoved now takes the stopped commands; the plant clears the schedule at the same point (after endOfDrive, before backgroundMoved). Killer's '🔴 a schedule survives a stop' case still asserts it.
            (TASKS, "      if (driving || aTurnIsOpen) endOfDrive(true, entry.at)\n      theStopWasARefusedLogin = false\n", "      if (driving || aTurnIsOpen) endOfDrive(true, entry.at)\n      scheduled.clear()\n      theStopWasARefusedLogin = false\n"),
        ],
    ),
    (
        "M106 · a stop that cuts an open turn with no `working` written no longer ends it, so the piece is left as the turn left it — killed by `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            (TASKS, "if (driving || aTurnIsOpen) endOfDrive(true, entry.at)", "if (driving) endOfDrive(true, entry.at)"),
        ],
    ),
    (
        "M107 · a conversation whose process is stopping speaks as no conversation again, so its give_work, create_agent and propose_agent_rules are answered as if from nobody — killed by `the-question-every-teardown-asks.test.ts`, `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            (RUNTIME_HOST, "  private runningAs(sessionId: string): GivingConversation | null {\n    const session = this.slots.get(sessionId)?.session\n", "  private runningAs(sessionId: string): GivingConversation | null {\n    const slot = this.slots.get(sessionId)\n    if (slot !== undefined && onItsWayOut(slot)) return null\n    const session = slot?.session\n"),
        ],
    ),
    (
        "M108 · propose_agent_rules passes the grant for a stopping caller and then refuses it at the session read, so the request is never put in front of a person — killed by `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            (RUNTIME_HOST, "    const session = this.slots.get(me)?.session ?? null\n    // ⚠️ **A caller mid-tool-call has a session in this host", "    const itsSlot = this.slots.get(me)\n    const session = itsSlot !== undefined && onItsWayOut(itsSlot) ? null : (itsSlot?.session ?? null)\n    // ⚠️ **A caller mid-tool-call has a session in this host"),
        ],
    ),
    (
        "M109 · a piece stalled because its turn was interrupted no longer refuses a give, so a holder whose turn a Close cut is handed more work — killed by `a-stop-cuts-the-drive-and-a-stalled-piece-stays-stalled.test.ts`",
        [
            # ⚑ **F074 · re-anchored in place, not retired** — F074 · `provider_limited` joined the stalls that refuse a give; the row still lets an interrupted turn's stall admit one.
            # ⚑ **F074 · re-anchored in place, not retired** — F074 · `provider_limited` left the stalls that refuse a give again (a follow-up at the limit is held, so the refusal could not be met before the reset); the anchor is the row's own again.
            # ⚑ **W4.495 · re-homed onto the give's answer in the host, not retired** — F146: the stalls a give names are read when its answer is formed (`stallsIn`), not admitted by the rail, so the same defect lands there. NOT VERIFIED
            # ⚑ **W4.495 · re-anchored in place, not retired** — the stalls a give names are now read from the pieces the giver, or a conversation it took the place of, gave; the same defect on that line. NOT VERIFIED
            (RUNTIME_HOST, "      fromIt.has(one.giver) && one.state === 'stalled' && one.stalledBecause !== null\n", "      fromIt.has(one.giver) && one.state === 'stalled' && one.stalledBecause !== null && one.stalledBecause !== 'turn_interrupted'\n"),
        ],
    ),
    (
        "M110 · A drive that ends over a piece a person gave stalls it with the turn's cause, as it does a piece a conversation gave: it never waits on the person — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — the stall call gained stopped/limit/login arguments (background_stopped, F074, F076); same branch in endedWithItOpen, every caller hands it a working piece so the plant stalls a person's piece too.
            # ⚑ **W4.652 · re-anchored in place, not retired** — the branch now also stalls a person's piece whose drive their own words did not open, or that ended any other way; the plant still stalls every working piece, so the one left waiting on the person after their own turn stalls too.
            (TASKS, "      held.row.giver !== null ||\n      !aPersonWroteIt ||\n", "      held.row.giver !== null ||\n      held.row.state === 'working' ||\n      !aPersonWroteIt ||\n"),
        ],
    ),
    (
        "M111 · A stall on a piece a person gave counts as one its giver can be told of: the predicate no longer asks whether a conversation gave the piece — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            (TASKS, "  return stalledWithACause(piece) && givenByAConversation(piece)", "  return stalledWithACause(piece)"),
        ],
    ),
    (
        "M112 · A turn opening on the owner does not drive a piece waiting on the person: the wait is treated as a state a person's own piece can never leave — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            (TASKS, "      if (held.row.state !== 'waiting-on-the-person-who-asked') {", "      if (held.row.state !== 'waiting-on-the-person-who-asked' || held.row.giver === null) {"),
        ],
    ),
    (
        "M113 · take_on_work records the caller itself as the giver of the piece it took on, instead of a person — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            ('apps/desktop/src/main/runtime/runtime-host.ts', '        giver: null,\n        title: asked.title,', '        giver: session.id,\n        title: asked.title,'),
        ],
    ),
    (
        "M114 · A give that names no piece counts the caller's root among the pieces it holds, so a caller that took work on can no longer tell which one it gives from — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            (SPAWN_RAILS, "    const received = held.filter((one) => !one.root && one.received)", "    const received = held.filter((one) => one.received)"),
        ],
    ),
    (
        "M115 · A piece is one deeper for every hop up to its root, even when a person gave it: work taken on for a person no longer counts as depth 0 — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            (SESSION_STORE, "      return chainUp(row).findIndex((one) => one.given_by_session_id === null)", "      return chainUp(row).length - 1"),
        ],
    ),
    (
        "M116 · The owner of a piece it took on for a person may not retitle it: the title check treats every non-root piece as named by its giver — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            # ⚑ **W4.150 · re-anchored in place, not retired** — F090 asks the title rule once, as a named boolean; the plant still treats every non-root piece as named by its giver, so the owner of work taken on for a person may not retitle it
            (RUNTIME_HOST, "    const aTitleOnlyItsGiverGives = input.title !== null && !itsGiver && row.givenBy !== null", "    const aTitleOnlyItsGiverGives = input.title !== null && !root && !itsGiver"),
        ],
    ),
    (
        "M117 · The reply to a piece a person gave says it was held for a giver: the early return reports delivered 'held' for a delivery that goes nowhere — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            (RUNTIME_HOST, "        resources: resources.map((one) => one.resource),\n        ...(replied.resultDocument === undefined ? {} : { resultDocument: replied.resultDocument }),\n        delivered: null,", "        resources: resources.map((one) => one.resource),\n        ...(replied.resultDocument === undefined ? {} : { resultDocument: replied.resultDocument }),\n        delivered: 'held',"),
        ],
    ),
    (
        "M118 · A question for the giver of a piece the asker took on for a person is routed to 'the-parent', which nobody gave: only a root goes to a person — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            (RUNTIME_HOST, "input.who === 'the-parent' && piece !== null && piece.giver === null ? 'a-person' : input.who", "input.who === 'the-parent' && piece !== null && piece.root ? 'a-person' : input.who"),
        ],
    ),
    (
        "M119 · The launch sweep names a piece that waits on the person as undriven, so every relaunch writes a work_restarted row about work nobody stalled — killed by `a-request-the-person-makes-is-a-piece-that-waits-on-them.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — the sweep's filter was reformatted onto its own line (piecesOfSession(...).filter(\n (piece) => ...,\n)) when the job-wake carve-out was added; same predicate.
            # ⚑ **W4.495 · re-anchored in place, not retired** — F146: the sweep also judges a piece parked on purpose by the state under its mark, and the filter is three lines now; the same mutation on it. NOT VERIFIED
            (SESSION_STORE, "            (piece) =>\n              piece.state === 'waiting' ||\n              piece.state === 'working' ||\n              piece.parkedOver === 'working',\n", "            (piece) =>\n              piece.state === 'waiting' ||\n              piece.state === 'working' ||\n              piece.parkedOver === 'working' ||\n              piece.state === 'waiting-on-the-person-who-asked',\n"),
        ],
    ),
    (
        "M120 · an address that is out of the caller's reach is resolved anyway, so a label of a conversation the caller may not reach meets the reach rail instead of the door's own unknown-id path and discloses that the conversation exists — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        [
            (RUNTIME_HOST, "    return admitted ? owner : address\n", "    return owner\n"),
        ],
    ),
    (
        "M121 · the resolver never turns a label into its owner, so a quoted label is treated as an unknown id at every door that takes an agent — killed by `a-question-is-known-by-who-asked-it.test.ts`, `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        [
            (RUNTIME_HOST, "    return admitted ? owner : address\n", "    return address\n"),
        ],
    ),
    (
        "M122 · a root's owner is named by its label alone, forgetting the title a person gave the root, so a renamed root still reads 'the owner of W1' — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        # ⚑ Landing D-026, PE-007 and the ui files batch · re-anchored in place, not retired — The rule
        # survives: workThatNames names a root's owner by label and by the title a person gave the root.
        # D-026 (1ba9c001) replaced newestRootTitle with titleNow (the one line that decides a piece's
        # title: newest work_retitled, else the title as given), so only the call changed; this matches
        # the commit message's own landing note. The new anchor `title: titleNow(root, generation) }` is
        # in workThatNames once, and the plant (title: null) is the same mutation as before. Killed by
        # `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`.
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033 moved the root's naming into theRootThatNames, which the name now and the name about one piece both read; the plant still forgets the title a person gave the root
            ('apps/desktop/src/main/db/session-store.ts', '          title: titleNow(root, generation),', '          title: null,'),
        ],
    ),
    (
        "M123 · the interrupt widening is off, so a caller that may not message can no longer interrupt, by label, a conversation it may interrupt — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        [
            (RUNTIME_HOST, "(reach === 'interrupting' && this.mayInterrupt(", "(false && this.mayInterrupt("),
        ],
    ),
    (
        "M124 · the transcript-reading widening is off, so a caller that may not message can no longer read, by label, the transcript of a conversation it may read — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        [
            (RUNTIME_HOST, "(reach === 'reading' && me !== null && this.mayReadTheTranscriptOf(owner, me))", "false"),
        ],
    ),
    (
        "M125 · a title of only spaces is no longer blank, so a person's rename to '   ' writes an empty title instead of a-title-is-one-line — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        [
            (RUNTIME_HOST, "    if (trimmed === '') return refused('a-title-is-one-line')\n", "    if (title === '') return refused('a-title-is-one-line')\n"),
        ],
    ),
    (
        "M126 · a person may rename a piece a conversation gave, so a conversation's name for its own piece is overwritten from the header — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        [
            (RUNTIME_HOST, "    if (row.givenBy !== null) return refused('a-conversation-names-that-piece')\n", "    if (row.givenBy !== null && false) return refused('a-conversation-names-that-piece')\n"),
        ],
    ),
    (
        "M127 · a person's rename is written and answered but never announced, so no window re-reads the list and the header, rail and palette keep the old title — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`, `work-moved-and-nothing-announced-it.test.ts`",
        [
            (RUNTIME_HOST, "      () => this.theWorldMoved('work'),\n    )\n    return { ok: true, piece: row.piece, label: row.label, title: trimmed }", "      () => undefined,\n    )\n    return { ok: true, piece: row.piece, label: row.label, title: trimmed }"),
        ],
    ),
    (
        "M128 · a conversation is named by the newest piece it ever held even when an older one is still open, so closing the newer piece leaves the name on the ended one — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        [
            # ⚑ **W4.136 · re-anchored in place, not retired** — F033 moved the choice into `shared/tasks.ts`'s `theWorkThatNamesItAmong`, shared with the plate's ended-last rule; the plant still names a conversation by the newest piece it ever held while an older one is open
            (TASKS, "  const open = held.filter((piece) => TASK_IS_OPEN[piece.state])\n  const newest = open.at(-1)\n", "  const open = held.filter((piece) => TASK_IS_OPEN[piece.state])\n  const newest = held.at(-1)\n"),
        ],
    ),
    (
        "M129 · the memoised name of a conversation is kept after its ledger grows, so a piece renamed or closed by its giver is still named by its old title — killed by `a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts`",
        [
            (SESSION_STORE, " && known.through === through", ""),
        ],
    ),
]
