"""603 · Waiting on an answer is not stalled — the join, and the four surfaces that read it.

⛔ **The ruling is `HO-091` §1 and it is one sentence:** *"Compose once, above both folds. Every
surface that reports a task's state reads that one composition."*

## 🔴 What the defect is, because it decides what these rows have to kill

⚠️ **A worker calls `ask_parent`. The verb holds its turn open — `437` built that, and `591`
re-derived it rather than assuming it — and the hold is the only thing standing between a parent and
a false sentence.** ⛔ **It does not cover the whole case.** `ASK_BOUND_MS` ends the CALL at five
minutes and, since `591`, leaves the QUESTION open; the worker's turn then ends, `deriveTasks`
stalls the task `turn_ended`, and the parent is pushed *"its turn ended and it replied nothing"*
about a worker waiting on an answer that parent can still give.

⚑ **`HO-085` §2 measured the vocabulary:** five states and five causes, *"not one of them is waiting
on an answer"*. ⛔ **So the rows below are about a WORD that did not exist and a JOIN that had
nowhere to live** — never about the wiring: the composition has one declaration and every reader
resolves it, so a row that broke a call site would be killed by the compiler and would measure
nothing.

## ⛔ A · the join itself

⚠️ **`M1` is the row the brief asked for by name** — *"a mutation row that makes the composition
return the RAW fold; if that survives, the join is not carrying the rule."* ⚑ It is the widest row
here on purpose: every surface in the app that reports a task's state resolves through this one
function, so a survivor would mean the whole dispatch is unmeasured.

⛔ **`M2` and `M3` are the two ways a reader of the function gets its BOUNDS wrong**, and both
compile.

🔴 **`M3` is the one a careful reader is likelier to ship.** ⚑ Clearing the stall fields looks like
tidying and is the invariant: {@link TaskRow.stalledBecause} is non-null **if and only if** the
state is `stalled` — held by construction in `deriveTasks`, read as a TYPE GUARD by
`stalledWithACause`, and spelled again on `WorkReport.stalledBecause` and
`ProjectWorkRow.stalledBecause`. ⚠️ A composed row that kept its cause breaks all four at once, and
`stalledWithACause` is what decides whether a stall NOTICE is owed — so the row would go on telling
a parent *nothing is driving this* through the push while the read said otherwise.

## ⚠️ B · the derivation the join rests on

⛔ **The openness of a question has NO row here, and that is deliberate.** ⚑ `591 M10` already
guards `REQUEST_IS_OPEN` on the line `603` moved it to — and from there one mutation takes down the
door that ENDS a question and the read that REPORTS it at once, which is stronger than either row
alone. ⚠️ A second row on that line would measure the same thing twice
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`, in the other direction).

⛔ **`M4` walks the edge the wrong way.** ⚠️ `ask_parent` writes its question into the WORKER's own
ledger, so the lookup is asked of `assignedTo`; asked of `assignedBy` it answers about the PARENT's
own questions — which is `openQuestionOf`'s own warning, one derivation over: *"the questions its
children asked are what it is blocking, and reading those would walk the chain the wrong way."*

## 🔴 C · the surfaces, and this is the half `HO-091` §2 is about

⚠️ **`HO-091` §2 refused to ship the disagreement**, and the reason is that it is arithmetic rather
than a risk: *"One surface composes and one does not, so they differ by construction."* ⛔ **And
`ProjectWorkRow`'s own docblock names the shape** — *an exception made at one depth of a walk, with
the project read the likelier of the two to be the one a supervisor actually calls.*

⛔ **`M5` is that exception, put back on the surface the PO named.** ⚑ **`M6` is the same thing on
the PERSON's surface** — the Work tab, whose rows the store's own walk composes — which is standing
rule 8.1's second audience and the half a sweep scoped to *the prose an agent reads* would miss.

## 🔴 D · the two NOTICE readers, which WRITE rather than read

⛔ **`stalledWithACause`'s own docblock requires the two to be complements of each other and never
overlap** — `RuntimeHost.tellIfNobodyHasYet` decides whether an AGENT is owed a notice and
`SessionStore.stalledWorkNobodyWasToldAbout` whether a PERSON is — ⚑ *"one derivation is what makes
the complement provable."*

⚠️ **`M7` and `M8` are the two halves of that pair, each put back on the raw fold.** ⛔ `M7` writes
*"its turn ended and it replied nothing"* into the PARENT's own transcript about a child waiting on
an answer that parent can still give, which is `HO-019` §1's product defect with a message
attached; ⚑ `M8` leaves the row in a person's queue. 🔴 **Neither reader needed a new
condition** — the composition clears the cause with the state, so an `asking` row falls out of the
shared predicate on its own, which is what makes these rows measure the composition rather than a
filter.

## ⚑ E · the word, and the fact behind it

⛔ **`M9` leaves a model a bare state name.** ⚠️ `taskText`'s own rule: *"A state name is this app's
vocabulary; 'its turn ended and it replied nothing' is the fact it stands for, and a reader deciding
what to do next needs the fact."* ⚑ The five causes each have a sentence for exactly this reason,
and a member that does not is `a-closed-vocabulary-guards-what-a-member-says`.

## ⛔ What has NO row, said rather than left out

⚠️ **No row on `TASK_IS_OPEN.asking`.** ⛔ Flipping it to `false` does not compile against
`deriveTasks`' `settle`, whose parameter is `Exclude<TaskState, 'stalled'>` — and where it does
compile, the composition's own `TASK_IS_OPEN` guard means the state can never be reached to be
asked about. ⚑ `a-line-no-mutation-can-kill-is-not-carrying-its-rule`: the entry is carried by
`M2`, which is the row that measures what OPEN decides here.

⚠️ **No row on the hold.** ⛔ Removing `ask_parent`'s blocking is B1 (`HO-084` §4), held behind this
dispatch by `HO-085` §4, and a row that removed it would be measuring a dispatch that has not run.

⚠️ **No row on `deriveTasks`.** ⛔ The fold is UNTOUCHED by this dispatch — `400`'s rule kept rather
than relaxed — and its rows belong to `400` and `437`, which already hold them.
"""

from __future__ import annotations

TASKS = "apps/desktop/src/shared/tasks.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"

# \u26d1 **Anchor CORRECTED by `621`, not retired** \u2014 `correct-a-stale-mutation-anchor-dont-retire-it`.
# \u26d4 **The SUBJECT did not move**: `composeWhatEachTaskIsWaitingOn` still joins the fold to what
# the conversation is waiting on, and M1 still makes it hand back the raw rows. \u26a0\ufe0f What moved is the
# LADDER: `621` lifted `answer \u2192 person \u2192 worker` into `whichWait` so a second projection
# (`theWaitAConversationIsIn`) could read the same precedence \u2014 `HO-091` \u00a71's *compose once*, one
# layer down. \U0001f534 **Re-verified RED by hand against `waiting-on-an-answer-is-not-stalled.test.ts`.**
# ⚑ **T-003 · re-anchored in place, not retired** — D-009 widened the answer term (`anAnswerAboutNoWork`, a peer question about no work); the row still returns the raw fold. Re-verified RED alone.
THE_JOIN = "  return tasks.map((task) => {\n    if (!TASK_IS_OPEN[task.state]) return task\n    const outstanding = outstandingFor(task.assignedTo)\n    // ⛔ **THIS row's question, which is the only one of the three that can be keyed to a row**\n    // — see {@link whichWait}, which holds the precedence for both readers.\n    const wait = whichWait(\n      outstanding.answers.has(task.taskId) || outstanding.anAnswerAboutNoWork,\n      outstanding,\n    )\n    if (wait === null) return task\n    return { ...task, state: wait, stalledBecause: null, stalledAt: null, stalledBy: null }\n  })\n"

# ⚠️ **RE-ANCHORED at 702, not retired.** 702 hands `tellWhoeverGaveTheWork` the holder's id rather
# than its session (a closing has none), so the read is `tasksOf(holder)`; the row still reads the raw
# fold. The DEFECT this row plants is unchanged.
M7_OLD = """      for (const task of composeWhatEachTaskIsWaitingOn(
        this.deps.store.tasksOf(holder),
        this.oneWaitReadPerAnswer(),
      )) {
        this.tellIfNobodyHasYet(task)
      }"""

M7_NEW = "      for (const task of this.deps.store.tasksOf(holder)) this.tellIfNobodyHasYet(task)"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
        # ⛔ **609 · ANCHOR CORRECTED IN PLACE, not retired.** `609` generalised this dispatch's
        # SOURCE from one question to everything a conversation is waiting on (`HO-088` §5.1) and
        # renamed the composition with it — `composeWaitingOnAnAnswer` →
        # `composeWhatEachTaskIsWaitingOn`, `askedAbout` → `outstandingFor`, `asking` →
        # `waiting-on-an-answer`. ⚡ **The SUBJECT is untouched**: every row below still removes the
        # same behaviour from the same line. Re-verified RED by hand.
    # ── A · the join itself ───────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the composition returns the RAW FOLD** — the row the brief asked for by name. "
        "⛔ Every surface in the app reports `stalled` / `turn_ended` about a worker waiting on an "
        "answer its parent can still give, which is `437`'s own false sentence arriving through "
        "the reader instead of through the verb",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: composeWhatEachPieceIsWaitingOn in shared/tasks.ts is still the one composition
        # every reader goes through, now keyed by piece (outstanding.answers.has(piece.piece),
        # childrenOpen, aPerson) with owner in place of assignedTo. The plant returns the raw fold,
        # so a piece waiting on an answer reads stalled again, which is the label's defect. Killed
        # by `waiting-on-an-answer-is-not-stalled.test.ts`.
        [
            (TASKS, "  return pieces.map((piece) => {\n    if (!TASK_IS_OPEN[piece.state]) return piece\n    const outstanding = outstandingFor(piece.owner)\n    // ⛔ **THIS row's question and THIS row's children** — see {@link whichWait}, which holds the\n    // precedence for both readers.\n    const wait = whichWait(\n      outstanding.answers.has(piece.piece),\n      outstanding.aPerson,\n      outstanding.childrenOpen.has(piece.piece),\n    )\n    if (wait === null) return piece\n    return { ...piece, state: wait, stalledBecause: null, stalledAt: null, stalledBy: null }\n  })\n", '  return pieces\n'),
        ],
    ),
    (
        "M2 · ⚠️ **the OPEN guard goes**, so a question outlives its work and rewrites it. ⛔ A "
        "task the parent already answered or took back reads *waiting on an answer* for ever — "
        "`workNamed`'s rule (*a question outlives the work it was about*) turned from a reason to "
        "leave closed rows alone into a reason to overwrite them",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The OPEN guard
        # still exists in composeWhatEachPieceIsWaitingOn (TASK_IS_OPEN[piece.state]) and the rule
        # that a closed piece is never rewritten and costs no read survives. The plant removes the
        # guard so a closed piece would be composed and the lookup would be asked for it. Killed by
        # `waiting-on-an-answer-is-not-stalled.test.ts`.
        [
            (TASKS, '    if (!TASK_IS_OPEN[piece.state]) return piece\n    const outstanding = outstandingFor(piece.owner)', '    const outstanding = outstandingFor(piece.owner)'),
        ],
    ),
    (
        "M3 · 🔴 **the stall fields SURVIVE the composition** — the over-correction, and it "
        "compiles. ⛔ `stalledBecause` is non-null with the state not `stalled`, which breaks the "
        "invariant `deriveTasks` holds by construction and which `stalledWithACause` reads as a "
        "TYPE GUARD — so the push goes on telling a parent *nothing is driving this* while the "
        "read says otherwise",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # composition still clears stalledBecause, stalledAt and stalledBy when it rewrites a state,
        # so a row never carries a stall cause with a non-stalled state. The plant keeps the fields
        # and breaks that invariant. Killed by `waiting-on-an-answer-is-not-stalled.test.ts`.
        [
            (TASKS, '    return { ...piece, state: wait, stalledBecause: null, stalledAt: null, stalledBy: null }', '    return { ...piece, state: wait }'),
        ],
    ),
    # ── B · the derivation the join rests on ──────────────────────────────────────────────────
    (
        "M4 · ⚠️ **the lookup walks the edge the WRONG WAY** — asked of the conversation that GAVE "
        "the work rather than the one holding it. ⛔ `ask_parent` writes into the worker's own "
        "ledger, so this answers about the parent's own open questions and marks every task a "
        "blocked parent gave out",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The lookup is
        # still asked of the conversation HOLDING the piece, which is now piece.owner (was
        # task.assignedTo). The plant asks the giver instead, so the answers set comes from the
        # wrong ledger. Killed by `waiting-on-an-answer-is-not-stalled.test.ts`.
        [
            (TASKS, 'outstandingFor(piece.owner)', 'outstandingFor(piece.giver)'),
        ],
    ),
    # ── C · the surfaces ──────────────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 **`list_projects` reads the raw fold** — `HO-091` §2's disagreement, put back on "
        "the surface the PO named. ⛔ A supervisor reading the project sees `stalled` where the "
        "worker's own list says `asking`, and `ProjectWorkRow`'s docblock calls that *an exception "
        "made at one depth of a walk* about this exact pair",
                # ⚑ 676 · anchor CORRECTED, not retired: `tasksIn` now takes the answer's unread set.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The `list_projects`
        # surface is gone on purpose, and D-016 rewrote the 603 test to say 'list_projects was the
        # third surface here, and it went with projects'. The rule survives on the supervisor's read
        # of its workers' tasks, which is now `list_tasks`' `assigned` half
        # (`tasksVisibleTo(pm).assigned`, over `tasksAssignedBy`). Planting the raw fold there keeps
        # the label's defect of a supervisor seeing `stalled` where the worker's own `given` list
        # says `waiting-on-an-answer`.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The label's
        # list_projects is gone, but the same rule holds on the piece board: the giver half of the
        # board read (the 'gave' list in runtime-host.ts) composes piecesGivenBy so the parent's
        # list agrees with the worker's own. The plant hands it the raw rows, which is the HO-091
        # disagreement the row exists to catch. Killed by
        # `waiting-on-an-answer-is-not-stalled.test.ts`.
        [
            (HOST, '      composeWhatEachPieceIsWaitingOn(this.deps.store.piecesGivenBy(giver, unread), waiting),\n', '      this.deps.store.piecesGivenBy(giver, unread),\n'),
        ],
    ),
    (
        "M6 · ⛔ **the PERSON's surface stops composing** — the Work tab and the relationship "
        "panel, whose rows the store's own walk builds. ⚑ Standing rule 8.1's second audience, and "
        "the half a sweep scoped to *the prose an agent reads* passes its own review without ever "
        "looking at",
        [
            (
                STORE,
                # ⚑ **664 · corrected in place**: the memo this row emptied moved into the shared
                # `oneWaitReadPerHolder`, and anchoring THERE would stop four readers composing
                # rather than this row's one — so it empties `walkWorkGivenBy`'s own lookup, which
                # is the same subject, and the two lines after it make the anchor unique.
                # ⚑ **671 · corrected again** — the memo takes the walk's `RowsUnread` (R18).
                "    const waiting = oneWaitReadPerHolder(unread)\n"
                "    const walked = walkLedgers(\n"
                "      'every-conversation-this-one-gave-work-to',\n",
                "    const waiting = () => ({ answers: new Set<string>(), aPerson: false, aWorker: false })\n"
                "    const walked = walkLedgers(\n"
                "      'every-conversation-this-one-gave-work-to',\n",
            )
        ],
    ),
    # ── D · the two notice readers ──────────────────────────────────
    (
        "M7 · 🔴 **the AGENT's notice reads the raw fold** — so the parent is PUSHED *its turn "
        "ended and it replied nothing* about a worker waiting on an answer it can still give. ⛔ "
        "`HO-019` §1's defect, written into the parent's own transcript rather than merely read "
        "off a list — and `tellIfNobodyHasYet` seeds its de-duplicator, so the parent is told ONCE "
        "and no correction ever arrives · killed by `waiting-on-an-answer-is-not-stalled.test.ts` (named by W4.78)",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The
        # agent-notice pump still composes the holder's pieces (piecesOwnedBy(holder) through
        # composeWhatEachPieceIsWaitingOn with oneWaitReadPerAnswer) before tellIfNobodyHasYet, so a
        # worker waiting on an answer is not reported as quiet. The plant walks the raw pieces and
        # pushes the false 'its turn ended' notice to the parent. Killed by
        # `waiting-on-an-answer-is-not-stalled.test.ts`.
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 456f53f2 (D-033) moved tellWhoeverGaveTheWork's composed read into whatItHolds(holder) and now loops over `composed`. The notice loop goes back to the raw fold, and the windows' push still gets the composed rows. Not the auto-guess site: settleTheNoticesFor is the teardown path, and the label is about the pump's notice to the parent.
            (HOST, "      for (const piece of composed) this.tellIfNobodyHasYet(piece)\n", "      for (const piece of this.deps.store.piecesOwnedBy(holder)) this.tellIfNobodyHasYet(piece)\n"),
        ],
    ),
    (
        "M8 · ⚠️ **the PERSON's half reads the raw fold** — the other arm of the pair "
        "`stalledWithACause` requires to be complements. ⛔ A person collects a *work has stopped* "
        "row about a worker waiting on an answer, which is `HO-082` §1's queue item nobody can "
        "clear arriving from a new direction — and composing only the agent's arm would break the "
        "complement that predicate's own docblock names",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The person's
        # queue read in session-store.ts still runs piecesOfSession(sessionId, noteSkip) through
        # composeWhatEachPieceIsWaitingOn before its stalled filter, keeping it the complement of
        # the giver half. The plant filters the raw fold, so the person is handed a work-has-stopped
        # row about a piece waiting on an answer. Killed by
        # `waiting-on-an-answer-is-not-stalled.test.ts`.
        [
            (STORE, '          composeWhatEachPieceIsWaitingOn(piecesOfSession(sessionId, noteSkip), waiting).filter(', '          piecesOfSession(sessionId, noteSkip).filter('),
        ],
    ),
    # ── E · the word, and the fact behind it ──────────────────────────────────────────────────
    (
        "M9 · ⚠️ **a model is left a bare state name.** ⛔ `taskText`'s own rule is that a state "
        "name is this app's vocabulary and not the fact it stands for; the five stall causes each "
        "carry a sentence for that reason, and `asking` — the one state whose whole point is that "
        "the READER is usually the one who owes the answer — would carry none",
        [
            (
                TOOLS,
                "      ? ` (${WAITING_STANDS_FOR[wait]})`",
                "      ? ''",
            )
        ],
    ),
]
