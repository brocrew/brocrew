"""609 · Three waits, one family — a closed vocabulary gains members, and every reader pays.

⛔ **The ruling is `HO-088` §5 and it is one sentence:** *"An agent whose turn ended with something
OUTSTANDING is WAITING. An agent whose turn ended with nothing outstanding is IDLE."*

## 🔴 What this table has to guard, and why a vocabulary is the hardest thing to guard

⚠️ **Two of this dispatch's three members are new WORDS**, and a word costs nothing to add and
nothing to break: the compiler forces an entry in two exhaustive `Record`s and then stops caring.
⛔ **`a-closed-vocabulary-guards-what-a-member-says` is the shape** — a member nothing can kill is
a member nothing is measuring — so every row below takes one member's MEANING away while leaving
the member itself in place and the build green.

## ⛔ A · the composition, which is the one mechanism all three ride

⚑ **`HO-088` §5.1: *one mechanism, three sources — NOT three mechanisms*.** ⚠️ `M1` and `M2` delete
one arm each: the member survives, its `Record` entries survive, and the fact simply never reaches
a surface. 🔴 **Neither is visible to a type**, which is exactly why they are rows rather than a
census.

⛔ **`M3` reverses the precedence** and is the sharpest row here. ⚑ The order is not a preference:
the ANSWER arm is the only one the ledger can key to THIS task, so it is the most specific true
statement about the row — and its addressee is the reader. ⚠️ A parent looking at work it gave out
would be told *waiting on a worker* about a question it is itself sitting on.

⚠️ **There is no row here for the composition keeping its stall fields**, and the reason is in
*What has NO row* below: `603 M3` already sits on that exact line.

## 🔴 B · the sources, one row per half, because a half is invisible

⛔ **`M4` and `M6` each delete one half of *a person owes something here*.** ⚠️ A permission and a
proposal are two different ledgers and one fact, so a build that reads only one of them answers
correctly for every test that happens to use the other — `a-comparison-tested-where-both-sides-
agree-measures-nothing`, at the source rather than at the assertion.

⛔ **`M6` drops `REQUEST_IS_OPEN` from the permission half.** ⚑ `permissionShaped` is true for ever
about a card somebody answered an hour ago, so this is the difference between *a person owes this*
and *a person once owed this* — and a conversation would read `waiting-on-a-person` until it ended.

🔴 **`M7` admits a routing that TRAVELLED.** ⚠️ It is the mutation that makes an escalation move a
task's state, which is the one thing `603` refused when it named the state after what the worker
DID rather than after who owes the answer. ⛔ It survives every test that never escalates.

⛔ **`M8` takes `TASK_IS_OPEN` out of the worker half.** ⚑ A conversation whose handed-out work has
all been answered would go on reading `waiting-on-a-worker` for the rest of its life — and it is
the row that proves the hand-over fold is read for OPEN work and not merely for existence.

## ⚠️ C · the family, because the roster derives itself and a derivation can be widened

⛔ **`M9` widens the prefix to `waiting`.** ⚑ The bare `waiting` member — a task whose MESSAGE is
still in a mailbox — would join the family, gain a *fact it stands for* it has no right to, and be
printed to a model as though somebody were owed something. ⚠️ **`603`'s own docblock named this
near-miss** (*"two different nothings"*), and the `-on-` is the only thing separating them.

⛔ **`M10` says a wait is CLOSED.** ⚑ `393`'s rule is that a second reply is a permanent refusal, so
a wait that closed could never afterwards be answered — and `openWorkOf`, the person's queue, the
project list and the spawn rail all read `TASK_IS_OPEN`.

⚠️ **`M11` gives two members one sentence.** ⛔ A model reads the fact and not the word, so two
waits that stand for the same thing are two words with one meaning — which is the vocabulary rot
`395` spent a dispatch undoing, arriving through the table instead of through the names.

## ⛔ What has NO row, said rather than left out

⚠️ **No row on the RENAME.** ⛔ `asking` → `waiting-on-an-answer` is a rename, and a mutation cannot
express *this member used to be spelled differently*: every reader is keyed by the constant, so
renaming it back renames it everywhere and nothing observes a difference. ⚑ It is guarded by a
census instead (`three-waits-one-family.test.ts` §1 and §7), which is the right instrument for a
move.

⚠️ **No row on `composeWhatEachTaskIsWaitingOn` being called at all.** ⛔ `603 M?` territory: the
eight call sites are `603`'s property and `waiting-on-an-answer-is-not-stalled.test.ts` §6 already
derives them from the imports. ⚑ A row here would measure somebody else's work.

⚠️ **No row on `PROPOSAL_BOUND_MS`'s value.** ⛔ `609` answered what it is FOR and changed nothing
about what it does; the number is `441`'s and its rows are in that table.

⚠️ **No row restoring the notice that `waiting-on-a-worker` suppresses.** ⛔ That behaviour is
`stalledWithACause`'s, whose one-derivation property is `557`'s table.

🔴 **And TWO rows this dispatch wrote were DELETED before it landed, because each sat on a line
another table already owns** — `a-line-no-mutation-can-kill-is-not-carrying-its-rule` read in the
other direction, and `608`'s precedent (*"the AGENT's door has NO row here and that is
deliberate"*):

 - ⛔ **the composition keeping its stall fields** is `603 M3`, whose anchor `609` corrected in
   place from `state: 'asking'` to `state: wait`. ⚑ A second row there would have measured the
   same edit twice and told a future reader that two people had looked.
 - ⛔ **the STORE walk dropping the composition** is `603 M8`, corrected the same way. ⚠️ `609`
   widened what that line composes and did not change whether it composes, so the row that guards
   it is still `603`'s.
"""

from __future__ import annotations

TASKS = "apps/desktop/src/shared/tasks.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"
PROPOSALS = "apps/desktop/src/shared/proposals.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

# \u26d1 **Anchors CORRECTED by `621`, not retired** \u2014 `correct-a-stale-mutation-anchor-dont-retire-it`.
# \u26d4 **The three arms are all still here and all still load-bearing**; what moved is WHERE they
# are written. \u26a0\ufe0f `HO-095` \u00a75.1 gave the ladder a SECOND reader \u2014 a conversation with no task row
# at all \u2014 so `621` lifted it into `whichWait`, which both projections go through. \U0001f534 **Each of
# M1\u2013M3 was re-verified RED by hand against `three-waits-one-family.test.ts` after the move.**
# \u26d1 **And they now guard MORE than they did**: one ladder, two readers, so a silenced arm takes
# the task row's word AND the conversation's.
THE_LADDER = """  return anAnswerIsOutstanding
    ? 'waiting-on-an-answer'
    : outstanding.aPerson
      ? 'waiting-on-a-person'
      : outstanding.aWorker
        ? 'waiting-on-a-worker'
        : null
"""

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the composition ────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the PERSON arm is never composed** · the member survives, both exhaustive "
        "`Record`s keep their entry, and a conversation parked on a permission card or holding an "
        "unanswered proposal goes back to reading `stalled`/`turn_ended`. ⛔ That is `484`'s "
        "headline defect restored — *\"I would have told the user work was progressing normally "
        "while it was frozen waiting on them\"* — with the word still in the vocabulary",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — whichWait in
        # shared/tasks.ts still has the three arms answer, person, worker, now with aChildIsOpen as
        # the third input. The plant drops the person arm, so a piece owing something to a person
        # reads as no wait. Killed by `three-waits-one-family.test.ts`.
        [
            (TASKS, "  return anAnswerIsOutstanding\n    ? 'waiting-on-an-answer'\n    : aPersonOwesSomething\n      ? 'waiting-on-a-person'\n      : aChildIsOpen\n        ? 'waiting-on-a-worker'\n        : null\n", "  return anAnswerIsOutstanding\n    ? 'waiting-on-an-answer'\n    : aChildIsOpen\n      ? 'waiting-on-a-worker'\n      : null\n"),
        ],
    ),
    (
        "M2 · 🔴 **the WORKER arm is never composed** · a project manager whose turn ended with "
        "work out reads *nothing is driving this* about itself, which is the sentence `HO-088` §5 "
        "exists to remove. ⛔ Its parent is then pushed an undriven notice about a chain that is "
        "still moving, and the notice arrives at the wrong link",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The worker arm
        # of whichWait survives (a piece with an open child reads waiting-on-a-worker). The plant
        # drops that arm, so a piece whose only cause is an open child reads as no wait. Killed by
        # `three-waits-one-family.test.ts`.
        [
            (TASKS, "  return anAnswerIsOutstanding\n    ? 'waiting-on-an-answer'\n    : aPersonOwesSomething\n      ? 'waiting-on-a-person'\n      : aChildIsOpen\n        ? 'waiting-on-a-worker'\n        : null\n", "  return anAnswerIsOutstanding\n    ? 'waiting-on-an-answer'\n    : aPersonOwesSomething\n      ? 'waiting-on-a-person'\n      : null\n"),
        ],
    ),
    (
        "M3 · ⛔ **the PRECEDENCE is reversed** · the conversation-wide facts win over the one the "
        "ledger can key to THIS task. ⚠️ A parent reading work it gave out is told *waiting on a "
        "worker* about a question it is itself sitting on — the least actionable of the three "
        "answers displacing the one whose addressee is the reader",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The ladder
        # answer, then person, then worker is still spelled once in whichWait. The plant reverses
        # it, so an open child outranks an outstanding answer. Killed by
        # `three-waits-one-family.test.ts`.
        [
            (TASKS, "  return anAnswerIsOutstanding\n    ? 'waiting-on-an-answer'\n    : aPersonOwesSomething\n      ? 'waiting-on-a-person'\n      : aChildIsOpen\n        ? 'waiting-on-a-worker'\n        : null\n", "  return aChildIsOpen\n    ? 'waiting-on-a-worker'\n    : aPersonOwesSomething\n      ? 'waiting-on-a-person'\n      : anAnswerIsOutstanding\n        ? 'waiting-on-an-answer'\n        : null\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row drops the proposal half of 'a
        # person owes something'. The half was deleted on purpose:
        # `aPersonOwesADecisionIn(proposals())` and `proposalsOfSession` are gone, and the comment
        # in runtime-host.ts says 'D-016 took the proposals back out'. `aPerson` now has one ledger,
        # so there is no second half to drop. Its anchor is left stale, so the census records it
        # retired.
        "M4 · ⛔ **the PROPOSAL half of *a person owes something* is dropped** · a conversation "
        "holding a card a person has not pressed reads as though nothing were outstanding. ⚑ Every "
        "test that exercises the permission half still passes, which is the whole reason this is a "
        "row: two ledgers, one fact, and a build that reads one of them looks correct",
                # ⚑ **671 · anchors corrected in place** — every read takes the answer's
                # `RowsUnread` now (R18). Subject unchanged; re-verified RED alone.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The runtime-host.ts site
        # was reformatted from two lines to one (`aPerson: aPersonOwesAnAnswerIn(routings) ||
        # aPersonOwesADecisionIn(proposals()),`) but is the exact same composition the row's own
        # in-code comment still narrates: "609 · the two halves of a person owes something here." It
        # feeds `whatEachConversationIsWaitingOn` → `waitOf`, a live end-to-end path, so dropping
        # the proposal half is still a real, testable defect. The session-store.ts twin edit is
        # untouched (exact text still present once).
        [
            (HOST, '        aPerson: aPersonOwesAnAnswerIn(routings) || aPersonOwesADecisionIn(proposals()),', '        aPerson: aPersonOwesAnAnswerIn(routings),'),
            (STORE, '        aPersonOwesAnAnswerIn(routings) ||\n        aPersonOwesADecisionIn(proposalsOfSession(sessionId, mine)),', '        aPersonOwesAnAnswerIn(routings),'),
        ],
    ),
    (
        "M5 · ⛔ **the PERMISSION half is dropped** · the mirror of `M5`, and the one that matters "
        "more often: a provider parks a turn on a card for every approval this app asks for, so "
        "this is the ordinary way a conversation comes to be waiting on a person at all",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Mirror of M4 at the same
        # reformatted site: dropping the permission half (`aPersonOwesAnAnswerIn`) is still
        # reachable through the live `whatEachConversationIsWaitingOn` → `waitOf` path, which is
        # exercised end-to-end by a real permission card parked on a worker in the same test file.
        # The session-store.ts twin edit is untouched (exact text still present once).
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule that a
        # permission card parked on a conversation makes it read `waiting-on-a-person` still holds.
        # After D-016 `aPerson` is only `aPersonOwesAnAnswerIn(routings)` at both sites, so dropping
        # the permission half now leaves `aPerson: false`. The old row kept the proposal term, which
        # no longer exists.
        [
            (HOST, '        aPerson: aPersonOwesAnAnswerIn(routings),', '        aPerson: false,'),
            (STORE, '      aPerson: aPersonOwesAnAnswerIn(routings),', '      aPerson: false,'),
        ],
    ),
    (
        "M6 · 🔴 **an ANSWERED card still counts** · `REQUEST_IS_OPEN` goes, and `permissionShaped` "
        "alone is true for ever about a routing somebody settled an hour ago. ⛔ A conversation "
        "that was ever asked anything reads `waiting-on-a-person` until it ends, which makes the "
        "word mean *a person was once owed something* — a state nobody can clear",
        [
            (
                QUESTIONS,
                # ⚠️ **611 · CORRECTED IN PLACE, never retired.** The predicate reads the
                # RECIPIENT since `HO-088` §2 gave a conversation a second way to be waiting on a
                # person. ⛔ The row's subject is unchanged: the openness half goes.
                "  return requests.some((one) => one.went.to === 'a-person' && REQUEST_IS_OPEN[one.state])\n",
                "  return requests.some((one) => one.went.to === 'a-person')\n",
            )
        ],
    ),
    (
        "M7 · 🔴 **a routing that TRAVELLED is admitted** · `because` is no longer asked, so a "
        "question the PARENT owes counts as a person's. ⛔ An escalation then moves a task's state "
        "with nothing about the work having changed — the exact claim `603` refused when it named "
        "the state after what the worker DID rather than after who owes the answer",
        [
            (
                QUESTIONS,
                # ⚠️ **611 · CORRECTED IN PLACE** — see `M6`. The row's subject is unchanged:
                # the *whose is it* half goes, so a question the PARENT owes counts as a person's.
                "  return requests.some((one) => one.went.to === 'a-person' && REQUEST_IS_OPEN[one.state])\n",
                "  return requests.some((one) => REQUEST_IS_OPEN[one.state])\n",
            )
        ],
    ),
    (
        "M8 · ⛔ **the worker half stops asking whether the work is OPEN** · a conversation whose "
        "handed-out work has all been answered reads `waiting-on-a-worker` for the rest of its "
        "life. ⚑ The hand-over row is the fact, and `TASK_IS_OPEN` is what makes it a fact about "
        "NOW rather than about history",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — Both
        # childrenOpen builders (the runtime-host.ts host read and the session-store.ts read) still
        # filter piecesGivenBy on TASK_IS_OPEN, so only an open child makes its parent piece wait on
        # a worker. The plant drops the filter in both, so a finished child keeps the parent
        # waiting-on-a-worker instead of stalled. Killed by `three-waits-one-family.test.ts`.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The rule survives in both builders: only an OPEN piece makes its parent wait on
        # a worker. The store edit still matches once, and D-036 (ea3cf258) moved the host's filter
        # into `oneWorkOutReadPerAnswer`, so its anchor is now the `.filter(TASK_IS_OPEN).sort(...)`
        # pair. three-waits-one-family.test.ts (D-005a, helper answered and the giver told) expects
        # the owner's piece `stalled` with a notice; with answered work still counted as open it
        # reads waiting-on-a-worker and the notice never arrives. Killed by
        # `three-waits-one-family.test.ts`.
        [
            (HOST, '        .filter((one) => TASK_IS_OPEN[one.state])\n        .sort((left, right) => left.givenAt - right.givenAt)\n', '        .sort((left, right) => left.givenAt - right.givenAt)\n'),
            (STORE, '        piecesGivenBySession(sessionId, unread)\n          .filter((piece) => TASK_IS_OPEN[piece.state])\n          .map((piece) => piece.parent),\n', '        piecesGivenBySession(sessionId, unread)\n          .map((piece) => piece.parent),\n'),
        ],
    ),
    # ── C · the family ─────────────────────────────────────────────────────────────────────────
    (
        "M9 · ⛔ **the family's prefix is widened to `waiting`** · the bare mailbox member joins "
        "{@link TASK_WAITS}, gains a *fact it stands for* it has no right to, and is printed to a "
        "model as though somebody were owed something. ⚠️ `603`'s own docblock named this "
        "near-miss — *two different nothings* — and the `-on-` is the only thing separating them",
        [
            (
                TASKS,
                "TASK_STATES.filter((state): state is TaskWait =>\n  state.startsWith('waiting-on-'),\n)",
                "TASK_STATES.filter((state): state is TaskWait =>\n  state.startsWith('waiting'),\n)",
            )
        ],
    ),
    (
        "M10 · 🔴 **a wait is CLOSED** · `393`'s rule is that a second reply is a permanent "
        "refusal, so work that closed here could never afterwards be answered. ⛔ The spawn rail "
        "would admit a second piece of work to a worker that is still holding the first, the "
        "person's queue would stop listing it, and the project list would file it under finished",
        [
            (
                TASKS,
                "  'waiting-on-a-person': true,\n  'waiting-on-a-worker': true,\n",
                "  'waiting-on-a-person': false,\n  'waiting-on-a-worker': false,\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ **two members stand for one fact** · a model reads the sentence and not the word, "
        "so *waiting on a person* and *waiting on a worker* become one meaning with two names. "
        "⛔ Two words for one observation is the vocabulary rot `395` spent a dispatch undoing, "
        "arriving through the table instead of through the names",
        [
            (
                TASKS,
                "  'waiting-on-a-worker': 'it handed work out and that work is still open',\n",
                "  'waiting-on-a-worker': 'it raised something only a person can settle and nobody has',\n",
            )
        ],
    ),
    # ── D · the second layer ───────────────────────────────────────────────────────────────────
]
