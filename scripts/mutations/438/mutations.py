"""438 · the digest, and the window it names — each row is THE DEFECT, put back (131).

🔴 **HO-025 §2 split HO-024's criterion 16 into three**, and this table is shaped by them:
**16** the digest covers a window and NAMES it · **18** it never asserts what the ledger did not
observe, says so where it infers, and names what it cannot answer · **19** it is cheap enough to
regenerate and is not a stored opinion.

⛔ **The failure mode is not a wrong digest — it is a CONFIDENT one**, in the PO's words, *"and
the person is reading these instead of the source."* Every row below is one way a line could come to be
drawn with more authority than it has earned.

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · the register** (`M1`–`M5`) — criterion 18's whole point. A claim restated as an
  observation, an observation given an author, a register the surface cannot label being drawn
  anyway, a withholding that is silent, and the provenance ORDER.
- **§2 · the gaps** (`M6`–`M10`) — HO-024 §5.3. Each one conditional on its own rows, including
  `437`'s: a question that names its task closes the *which work* gap and a provider-raised one
  does not.
- **§3 · native fan-out** (`M11`–`M14`) — `430`'s three measured rules: the MAXIMUM per child, a
  missing reading counted and never imputed as zero, and a workflow's aggregate never added to
  its own roster.
- **§4 · the window** (`M15`–`M18`) — half-open, generation-scoped, slug-folded, and echoed back
  so the card can name it.
- **§5 · what the read reaches, and what it admits it does not** (`M19`–`M22`).
- **§6 · what an adversarial review found** (`M23`–`M30`) — eight defects that were IN this
  dispatch's first draft and are now rows: a gap that could never close, a `NaN` in a breakdown,
  two endings the read was looking straight at and did not count, a sentence that inverted its
  own row, an unbounded scan, a clock that reported `0`, a freshness claim under a staleness
  warning, and an absolute stated from a window.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`, `M2`, `M5`–`M21`, `M23`–`M28`, `M30` | ⚑ **`run_suite desktop`** — `apps/desktop/test/the-digest-and-its-window.test.ts` |
| `M1`, `M3`, `M4`, `M22`, `M29` | ⚑ **`run_suite desktop`** — `apps/desktop/test/digest-card.render.test.ts` |
| `M21` | ⚑ also **`run_suite scripts`** — `scripts/test/digest-read-probe-reach.test.mjs` |

⚑ **`M1` is the only row two files catch**, and that is the shape of the criterion rather than
redundancy: a claim restated as an observation is wrong in the fold that builds it and wrong on
the chip that draws it.

⚠️ **Every row names the FILE that kills it, not the project**, and each was applied ALONE and
watched go red against that file — `verify-each-mutation-row-without-running-the-table`.
⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the card's LAYOUT.** The register chip's box, the wrap at 1180 and the hit-target
of the window control are measured in `test/dom/the-digest-and-its-window.dom.test.ts`; a CSS
mutation there lands on the BASE variant
(`a-style-mutations-control-is-the-state-it-falls-back-to`) and the census could not attribute the
red to a rule. ⚑ Filed rather than planted.

⛔ **No row on the POLL's cadence.** `DISTIL_EVERY_MS` is a number nothing can be wrong about
until somebody measures what a person notices; a row that changed 30 s to 30 min would be red
against nothing and green against everything.

⛔ **No row that adds an index.** `432` priced a partial time index and `438` did not ship one; a
mutation cannot delete a migration that does not exist.

🔴 **Three rows SURVIVED a first pass and the table kept every one of them.** `M18` and `M19`
are below; `M30` is the third — nothing asserted that the missing-usage gap says *inside this
window* rather than *at all*, so the qualifier a review had just put there was carried by no
test. ⚑ In all three cases the assertion was written and the row then went RED; **none was
re-aimed at something already covered**, which is the tempting repair and the one that leaves
the hole where it was.

🔴 **`M18` and `M19` SURVIVED on the first pass, and the table kept them.** Both are in
`RuntimeHost.digest` — the window it echoes back and the standing limit it attaches — and nothing
tested that layer: every property was asserted one level down, against the store read and the
pure fold. ⛔ *A line no mutation can kill is not carrying its rule*, so `§8` of
`the-digest-and-its-window.test.ts` was written and both rows then went RED. ⚠️ **The rows were
not re-aimed at something already covered**, which is the tempting repair and the one that would
have left the hole exactly where it was.
"""

from __future__ import annotations

import sys
from pathlib import Path

SHARED = "apps/desktop/src/shared/digest.ts"
FOLD = "apps/desktop/src/main/runtime/digest.ts"
VIEW = "apps/desktop/src/renderer/src/lib/digest.ts"
CARD = "apps/desktop/src/renderer/src/components/DigestCard.vue"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS = [
    # ── §1 · the register ──────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · an agent's declaration is drawn as something the ENGINE "
        "watched. HO-024 §5.1: *a digest may never restate a claim as an observation* — and the "
        "line still reads exactly the same, which is why this is the one that costs most",
        [
            (
                SHARED,
                "  return { id, register: 'claimed', kind, count: 1, at, text, saidBy }",
                "  return { id, register: 'observed', kind, count: 1, at, text, saidBy }",
            )
        ],
    ),
    (
        "M2 · ⛔ an OBSERVATION acquires an author — the app attributing its own reading to an "
        "agent, which is the same confusion running the other way",
        [
            (
                SHARED,
                "  return { id, register: 'observed', kind, count, at, text, saidBy: null }",
                "  return { id, register: 'observed', kind, count, at, text, saidBy: 'the app' }",
            )
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity reads its own per-piece lines.
        "M3 · 🔴 a register the surface cannot label is DRAWN anyway · the fail-open version of "
        "`canBeDrawn`, which puts an unlabelled fact in front of a person with an empty chip "
        "beside it. ⛔ `an-unenumerated-state-counts-as-success`, with the stakes inverted",
        [
            (
                VIEW,
                "  return Object.prototype.hasOwnProperty.call(REGISTER_WORDS, line.register)",
                "  return true",
            )
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity reads its own per-piece lines.
        "M4 · ⛔ the withholding goes SILENT — the lines are still dropped and the count that says "
        "so reads zero, which is the omission HO-024 §5.3 forbids committed by the surface "
        "written to prevent it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The renderer digest view
        # now derives the count as `withheld: digest.lines.length - lines.length,` (the `project`
        # binding is gone). Forcing it to 0 keeps the defect: the lines are still dropped and the
        # count reads zero. digest-card.render.test.ts still asserts the `digest-withheld` chip says
        # '1 line was' withheld.
        [
            (VIEW, '    withheld: digest.lines.length - lines.length,\n', '    withheld: 0,\n'),
        ],
    ),
    (
        "M5 · ⚠️ the provenance ORDER inverts — what an agent said is drawn above what the engine "
        "watched. `HO-001`'s ordering, which HO-024 §5.1 is the surface half of",
        [(FOLD, "  return { lines: [...observed, ...claims], gaps, fanOut }", "  return { lines: [...claims, ...observed], gaps, fanOut }")],
    ),
    # ── §2 · the gaps ──────────────────────────────────────────────────────────────────────────
    (
        "M6 · ⛔ a gap with NO rows is drawn — every project shows every hole every time, which is "
        "the state HO-025 §5.3 says would mean the design is wrong rather than the ledger",
        [(FOLD, "  if (count <= 0) return null", "  if (count < 0) return null")],
    ),
    (
        "M7 · 🔴 a worker's outcome stops being flagged unverified — the digest reports `done` and "
        "says nothing about who decided it was done",
        [
            (
                FOLD,
                "    gap('unverified-outcome', tally.replies),",
                "    gap('unverified-outcome', 0),",
            )
        ],
    ),
    (
        "M8 · ⚠️ a report about work handed out BEFORE the window stops being noticed, so the line "
        "says *work it was given before this window* and no gap says the digest cannot name it — "
        "`432`'s carry-in limit, silently",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a reply whose piece the window never saw given is counted as carried in, so the
        # digest can say work it could not name came back. The fold arm is now work_replied, and the
        # plant adds 0 instead of 1 where the piece is not in tally.given. Killed by
        # `the-digest-and-its-window.test.ts`.
        [
            (FOLD, '        if (named === undefined) tally.carriedIn += 1', '        if (named === undefined) tally.carriedIn += 0'),
        ],
    ),
    (
        "M9 · 🔴 `437`'s `question_asked` is counted as a ROUTING rather than read for its task — "
        "so the one row in this app that says which work a question is about stops closing the "
        "gap, and every question is reported as unattributable",
                # ⚑ **474 · both sides carry the pair now** (`463` F2), so the row still swaps one
                # set for the other and still says nothing about how either is keyed.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a question_asked row marks its request as one that NAMES work, which closes the
        # 'which work' gap for that question. The set is tally.questionsNamingWork, and the plant
        # adds the request to tally.routed instead, so the question is still counted as raised but
        # no longer as naming work. Killed by `the-digest-and-its-window.test.ts`.
        [
            (FOLD, '        tally.questionsNamingWork.add(asked)', '        tally.routed.add(asked)'),
        ],
    ),
    (
        "M10 · ⛔ *open* is reported for requests this window WATCHED end — the gap stops being "
        "about what nothing ended and becomes a count of everything that was ever raised",
        [
            (
                FOLD,
                "  const unanswered = [...tally.routed].filter((id) => !tally.ended.has(id)).length",
                "  const unanswered = [...tally.routed].length",
            )
        ],
    ),
    # ── §3 · native fan-out ────────────────────────────────────────────────────────────────────
    (
        "M11 · 🔴 THE MEASURED DEFECT · the frames are SUMMED instead of maxed, so `430`'s own "
        "control — Claude re-sending 6,997 then 8,944 for one child — reports 15,941 for a child "
        "that spent 8,944",
        [
            (
                FOLD,
                "  if (held === undefined || tokens > held) tally.childMax.set(key, tokens)",
                "  tally.childMax.set(key, (held ?? 0) + tokens)",
            )
        ],
    ),
    (
        "M12 · ⛔ a window where NO child reported anything reads as zero tokens — a claim about "
        "spend, made out of silence",
        [
            (
                FOLD,
                "    tokens: reported === 0 ? null : [...tally.childMax.values()].reduce((sum, one) => sum + one, 0),",
                "    tokens: [...tally.childMax.values()].reduce((sum, one) => sum + one, 0),",
            )
        ],
    ),
    (
        "M13 · ⛔ children that reported no usage stop being counted, so the coverage line says "
        "every one of them reported a number — the difference between a total and a coverage "
        "report, deleted",
        [(FOLD, "    missing: tally.childSeen.size - reported,", "    missing: 0,")],
    ),
    (
        "M14 · 🔴 a workflow's own `usage` is added to its per-agent roster — two descriptions of "
        "one spend, added. The repo's own fixture carries `total_tokens: 7718` and a single "
        "roster agent with `tokens: 7718`, so the digest reports 15,436 for a run that spent 7,718",
        [
            (
                FOLD,
                "        for (const agent of event.agents ?? []) {",
                "        reportUsage(tally, `${row.sessionId} ${event.taskId}`, event.usage?.tokens)\n"
                "        for (const agent of event.agents ?? []) {",
            )
        ],
    ),
    # ── §4 · the window ────────────────────────────────────────────────────────────────────────
    (
        "M15 · ⛔ the window stops being half-open, so a row stamped exactly on the boundary is in "
        "BOTH of two adjacent windows — read yesterday and then today and one turn is counted twice · killed by `the-digest-and-its-window.test.ts`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — `selectDigestWindow` now
        # reads `WHERE e.created_at >= ? AND e.created_at < ?` (the per-project ledger join was
        # rewritten, so the old `AND e.created_at ...` line is gone). Making the upper bound
        # inclusive keeps the defect: a row at `to` is counted in two adjacent windows.
        # the-digest-and-its-window.test.ts §5 pins the half-open window.
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule (the
        # digest window is half-open: a row AT `from` is in, a row AT `to` is out) survives
        # unchanged in selectDigestWindow. The old anchor moved with the identity join above it, so
        # the plant re-anchors on the created_at line itself. Killed by
        # `the-digest-and-its-window.test.ts`.
        [
            # ⚑ **W4.265 · re-anchored in place, not retired** — W4.205 · The window's upper bound moved out of the SQL: the store now reads the window from `from` up to Number.MAX_SAFE_INTEGER and keeps the rows, and `digestWindow` drops rows outside [from, to) itself. So the old plant on the SQL `<` changed nothing. Planting `> to` in the in-memory filter keeps the same defect: a row stamped exactly at `to` is counted in two adjacent windows.
            (STORE, "          if (one.at < from || one.at >= to) continue\n", "          if (one.at < from || one.at > to) continue\n"),
        ],
    ),
    (
        "M16 · 🔴 the ACTIVE generation stops being resolved, so a rebuilt conversation's "
        "superseded rows land in the window beside the live ones with identical timestamps, and "
        "the same work is counted twice",
        [
            (
                STORE,
                "        AND e.generation = coalesce(\n"
                "              (SELECT d.active FROM derived_generation d WHERE d.session_id = e.session_id), 0)",
                "        AND e.generation >= 0",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row plants the digest's
        # per-project slug fold (`const folded = foldProfileName(projectSlug)`), and D-016 removed
        # it. The store method is now `digestWindow(from, to)` (was `digestWindow(projectSlug, from,
        # to)`) and `projectToWalk` is deleted. The commit message says: "The digest is one window
        # over every conversation an agent holds", so no digest takes a project slug that could stop
        # being folded. Its anchor is left stale, so the census records it retired.
        "M17 · ⚠️ the project slug stops being folded, so a digest asked for `Default` answers "
        "empty for a project that has rows — `tasksIn`'s defect, inherited instead of avoided. "
        "⚑ ANCHOR CORRECTED IN PLACE TWICE: by 466, when the fold ran once into a local because "
        "the candidate-set count needed the same slug; and by 466·relay-1, when the digest and "
        "the roster stopped keeping a copy of this rule each and took `projectToWalk`. ⛔ Same "
        "defect and same killer both times; the site is now shared with `467 M3`, which defends "
        "the OTHER reader of it, and a mutation here reaches both — which is the honest blast "
        "radius of dropping the fold",
        [(STORE, "    const folded = foldProfileName(projectSlug)\n", "    const folded = projectSlug\n")],
    ),
    (
        "M18 · ⛔ the window is not echoed back as it was asked for, so the card names a span "
        "nobody chose — criterion 16 is *covers a window AND NAMES the window it covers*, and "
        "this is the second half alone going wrong",
        [(HOST, "      window: { from, to },", "      window: { from: 0, to },")],
    ),
    # ── §5 · what the read reaches, and what it admits it does not ─────────────────────────────
    (
        "M19 · 🔴 the standing limit is dropped, so nothing on the surface says why no window here "
        "can mean *while you were away* — `430` searched the schema, the IPC surface and the "
        "renderer for a last-view marker and found none, and this is the sentence that says so",
        [(HOST, "      limit: { says: WINDOW_WAS_CHOSEN },", "      limit: { says: '' },")],
    ),
    (
        "M20 · ⚠️ conversations bound to NO project stop being counted, so a conversation swept "
        "out of the user's own provider home is outside every digest and nothing says it is. ⛔ "
        "Omission is indistinguishable from nothing-happened",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule
        # survives: a conversation no agent holds is COUNTED in the digest as never-placed, and that
        # population is now `provider_session.agent_identity_id IS NULL`. The plant counts the
        # placed ones instead. Killed by `the-digest-and-its-window.test.ts`.
        [
            (STORE, '    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NULL`,\n', '    `SELECT count(*) AS n FROM provider_session WHERE agent_identity_id IS NOT NULL`,\n'),
        ],
    ),
    (
        "M21 · ⛔ the SQL drops a type the fold branches on, so `task_replied` reads as *that "
        "event never happened* — `selectTaskEvents`' own hazard, on the statement that inherited "
        "its rule",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the store's selectDigestWindow event list must carry the same types as
        # DIGEST_EVENT_TYPES, or the fold sees a window without those rows. The label says
        # task_replied and the type is now work_replied, so the plant drops work_replied from the
        # SQL IN list. Killed by `the-digest-and-its-window.test.ts`.
        # ⚑ Landing D-016c (72b78a37, the giver's verbs) · re-anchored in place, not retired — The
        # rule holds: the digest window statement must select every piece event the fold branches
        # on, or a branch reads as that event never happening. The IN list now also holds
        # work_closed. The plant drops work_replied from it, so replies vanish from the digest on
        # the replayed path. Killed by `the-digest-and-its-window.test.ts`.
        [
            (STORE, "        AND e.type IN ('work_given', 'work_replied', 'work_taken_back', 'work_closed',\n", "        AND e.type IN ('work_given', 'work_taken_back', 'work_closed',\n"),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity reads its own per-piece lines.
        "M22 · ⚠️ the silence is computed BEFORE the withholding, so a project whose every line "
        "this app could not label draws an empty list under a heading instead of saying the "
        "ledger recorded nothing it can show. ⚑ ANCHOR CORRECTED IN PLACE BY 466: `silent` became "
        "`says`, one word out of `silenceOf`, and the count of DRAWN lines is now that "
        "function's second argument — so the row passes the undrawn count where it passed the "
        "undrawn length. Same defect, same killer",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The renderer
        # `digestView` now takes the whole digest instead of a per-project entry, so the site is
        # `says: silenceOf(digest, lines.length),`. Passing the undrawn count
        # (`digest.lines.length`) keeps the defect: the silence is computed before the withholding.
        # digest-card.render.test.ts still asserts that an all-withheld reading draws
        # `digest-silent` and `digest-withheld`.
        [
            (VIEW, '    says: silenceOf(digest, lines.length),\n', '    says: silenceOf(digest, digest.lines.length),\n'),
        ],
    ),
    # ── §6 · what an adversarial review found, put back ────────────────────────────────────────
    (
        "M23 · 🔴 `question-without-work` reads every ROUTING again, so it fires for permissions — "
        "which never travelled and have no task to name — and becomes a gap on every project "
        "every time that nothing can ever close. ⛔ HO-025 §5.3's *design fault rather than "
        "ledger limit*, built in",
        [
            (
                FOLD,
                "  const withoutWork = [...tally.travelled].filter((id) => !tally.questionsNamingWork.has(id))",
                "  const withoutWork = [...tally.routed].filter((id) => !tally.questionsNamingWork.has(id))",
            )
        ],
    ),
    (
        "M24 · 🔴 a `turn` state this build cannot read is INDEXED again — `NaN` on a key nothing "
        "reads, the row dropped from a breakdown that still counts it, and a line that does not "
        "add up to itself: *4 turns ended — 3 completed*",
        [
            (
                FOLD,
                "        if (\n"
                "          event.state === 'completed' ||\n"
                "          event.state === 'failed' ||\n"
                "          event.state === 'interrupted'\n"
                "        ) {\n"
                "          tally.turns[event.state] += 1\n"
                "        } else {\n"
                "          tally.turns.unreadable += 1\n"
                "        }",
                "        tally.turns[event.state] += 1",
            )
        ],
    ),
    (
        "M25 · 🔴 an INTERRUPTED request stops counting as ended, so a person pressing Stop reads "
        "*work was stopped* beside *nothing in this window ended one* — with the endings three "
        "ordinals away in the same window",
        [
            (
                FOLD,
                # ⚑ **474 keyed every request fact by `(conversation, request)`** — `463` F2. The
                # writer, the set and this row's target are unchanged.
                "      case 'request_interrupted':\n"
                "        tally.ended.add(key(row.sessionId, event.requestId))\n"
                "        break",
                "      case 'request_interrupted':\n        break",
            )
        ],
    ),
    (
        "M26 · 🔴 the restart line inverts the row's meaning again — `work_restarted` means the "
        "app was killed while work was in flight and the task is now STALLED, and the sentence "
        "says the conversations came back. ⛔ An `observed` chip in front of the opposite of the "
        "fact",
        [
            (
                FOLD,
                "      return `The app restarted while ${many(tally.restartedIn.size, 'conversation', 'conversations')} still held work nobody had finished; that work is stalled until somebody drives it.`",
                "      return `${many(group.count, 'conversation', 'conversations')} came back after a restart.`",
            )
        ],
    ),
    (
        "M27 · ⛔ the digest window loses its span bound, so `digest(0, Date.now())` — which the "
        "zod schema cannot refuse — walks every digest-eligible row of every conversation in a "
        "project into main-process memory",
        [
            (
                HOST,
                "    if (!(to > from) || to - from > MAX_DIGEST_SPAN_MS) {",
                "    if (!(to > from)) {",
            )
        ],
    ),
    (
        "M28 · ⛔ the cost goes back to a 1 ms clock, so the one number the card offers as "
        "criterion 19's evidence reads `0 ms` on an empty database and `0 ms` on a large one — a "
        "figure that cannot move is not evidence",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The per-project timer
        # (`const at = performance.now()`) is gone with the per-project split, but the whole-read
        # cost still uses `performance.now()` in `RuntimeHost.digest`, so the rule survives. Putting
        # both clock reads back on `Date.now()` keeps the defect, a 1 ms clock that reads 0 ms.
        # Changing only `started` would give a huge negative number instead. The killer asserts
        # `totalMs > 0`.
        [
            (HOST, '    const started = performance.now()\n', '    const started = Date.now()\n'),
            (HOST, '      cost: { totalMs: +(performance.now() - started).toFixed(2) },\n', '      cost: { totalMs: +(Date.now() - started).toFixed(2) },\n'),
        ],
    ),
    (
        # ⛔ **RETIRED (Recent activity, in "Show Recent activity and what finished since you were last here"):** the digest card and its view are deleted; Recent activity reads its own per-piece lines.
        "M29 · ⚠️ the freshness claim is made unconditional again, so *Derived from the ledger "
        "just now* is drawn four elements under *This digest has stopped refreshing* — two "
        "sentences on one card denying each other",
        [
            (
                CARD,
                "            view.stale\n"
                "              ? 'Derived from the ledger when this reading arrived'\n"
                "              : 'Derived from the ledger just now'",
                "            'Derived from the ledger just now'",
            )
        ],
    ),
    (
        "M30 · ⚠️ the fan-out gap states an absolute again — *reported no usage at all* — from a "
        "WINDOW-scoped observation, so a child whose only report landed two minutes before "
        "`from` is reported as having never reported one",
        [
            (
                FOLD,
                "reported no usage INSIDE this window. ⚠️ That is not zero, and it is not *never* either: a report the same child made before the window is not in this number.`,",
                "reported no usage at all. That is not zero.`,",
            )
        ],
    ),
]


def main() -> int:
    print(f"{len(MUTATIONS)} mutations defined; run them with ./mutate.sh", file=sys.stderr)
    print(f"table: {Path(__file__).parent.name}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
