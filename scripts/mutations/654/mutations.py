"""654 · The one wait a person owes.

⛔ **PM ruling on `651` §8**: on the band's task lines, tint the `○` with the app's attention token for
`waiting-on-a-person` — and nothing else changes. ⚑ No word is added; `631`'s line grammar stands.

## 🔴 What the dispatch decided, and therefore what has to be killable

 * **The tint is the FOLD's answer** — `CastTask.summonsAPerson`, from `waitSummonsAPerson` (imported,
   never restated) over `theWaitIn` (`tasks.ts`' guard for *is this a wait*).
 * **Only where the line's own subject owes it.** A task's wait belongs to its holder; a TAKEN line's
   subject is the giver, so a person's wait on its mark is the other party's and is never tinted.
 * **`--waiting`, the app's existing attention token**, painted by one CSS rule.

## The rows

 * `M1` 🔴 **the tint never appears** — the ruling not implemented at all.
 * `M2` ⛔ **the subject rule dropped** — a taken line tints for a wait that is not its subject's:
   `654` §3's trap, sprung.
 * `M3` ⚠️ **a second predicate** — every wait tints, not the one a person owes: `641`'s *two
   predicates for one question*, and an amber that says *a person must act* over an agent's job.
 * `M5` 🔴 **everything but a worker's wait tints** — the predicate `654`'s review found surviving both
   first proofs; killed by the census's sweep over every task state.
 * `M4` ⚑ **the class is there and the paint is not** — the rule's colour swapped for the muted one.
   ⛔ **Only a COMPUTED colour can kill this**: the census reads `data-summons`, which still says
   `true`. It is the row `654` §4.2's *"a class name is not a colour"* is for.

## ⛔ What this table cannot reach

 * ⚠️ **No row changes `--waiting` itself in `tokens.css`.** It is the attention token a dozen
   components paint with; a row there would be killed by many suites and measure nothing about this
   dispatch.

## ⚑ WRITTEN, not run as a table

⛔ **Writing rows is routine, RUNNING a table is rare and deliberate.** Each row was verified RED
individually — one row, its killer file, restore-from-bytes — and no `mutations.txt` exists.
"""

from __future__ import annotations

BAND = "apps/desktop/src/renderer/src/lib/working-together.ts"
BAND_VIEW = "apps/desktop/src/renderer/src/components/WorkingTogether.vue"
TASK_LIST = "apps/desktop/src/renderer/src/components/TaskList.vue"

RULE = "  return piece.to === subject && waitSummonsAPerson(theWaitIn(piece.state) ?? undefined)\n"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **the tint never appears** · the fold answers `false` for every line, so the one wait a "
        "person owes is hover-only again — `651` §8's finding, unrepaired",
        [(BAND, RULE, "  return false && piece.to === subject\n")],
    ),
    (
        "M2 · ⛔ **the subject rule dropped** · a TAKEN line tints for a person's wait that belongs to "
        "THIS conversation while its plate and name are the giver's — a tint about the wrong subject, "
        "which `654` §3 ruled worse than none",
        [(BAND, RULE, "  return waitSummonsAPerson(theWaitIn(piece.state) ?? undefined)\n")],
    ),
    (
        "M3 · ⚠️ **a second predicate, and a wider one** · every wait tints, so a wait on a WORKER wears "
        "the amber that means *a person must act* — and the question is answered here instead of by "
        "`waitSummonsAPerson`",
        [(BAND, RULE, "  return piece.to === subject && theWaitIn(piece.state) !== null\n")],
    ),
    (
        "M5 · 🔴 **the predicate `654`'s review found surviving** · every state but a wait on a WORKER "
        "tints — working, stalled, an answer owed, even an ANSWERED task's closed ●. ⛔ The first two "
        "proofs told a person's wait only from a worker's, so this passed both; the sweep over every "
        "`TASK_STATES` member is what kills it",
        [(BAND, RULE, "  return piece.to === subject && piece.state !== 'waiting-on-a-worker'\n")],
    ),
    (
        "M4 · ⚑ **the class is there and the paint is not** · `.tmark.summons` draws the muted colour, so "
        "`data-summons` still says `true` and the ○ looks like every other. ⛔ Only a COMPUTED colour "
        "sees it",
        # ⚑ Landing ui batch 1 · re-anchored in place, not retired — `9b4b5a8e` moved the task rows,
        # this rule and its comment, from WorkingTogether.vue into TaskList.vue unchanged.
        [
            (
                TASK_LIST,
                ".tmark.summons {\n  color: var(--waiting);\n}",
                ".tmark.summons {\n  color: var(--muted);\n}",
            )
        ],
    ),
]
