"""3011 · D-033 and D-046's backend · what every window is told, from the host — 456f53f2, a86452d1.

⛔ **The subject**: the host tells every window that a conversation's work moved, at the row whose
read moved it and at no other, and hands every window each question as it was asked.

 * **D-033 (456f53f2)** — `sayWhenItsWorkMoved` compares what a window would draw of each OPEN
   piece with what it last read and announces `work` only when that differs; a piece first seen
   `working` or `waiting` is the give's to say; a background level reads only on a provider whose
   background wakes it, and only when the row leaves nothing running or scheduled; a conversation
   this app run never started takes what it holds before its first row can move it.
 * **D-046 (a86452d1)** — `questionsForAPerson` carries `asked` off the SAME row that raised the
   question: its words, what a passer added, whether it was passed up, and every part.

## ⚑ What a row here measures

 * ⚑ **M1, M2 are the announcement itself** (`sayWhenItsWorkMoved`): said whatever moved (M1), and
   never said (M2) — one anchor, two different defects.
 * ⚑ **M3, M4 are what counts as moved**: a NEW piece first seen working (M3), an ENDED piece (M4,
   `howItsWorkIsDrawn`).
 * ⚑ **M5, M6 are the level hook's guards** (`sayWhetherALevelMovedItsWork`): work left running
   (M5), a provider whose background wakes nothing (M6).
 * ⚑ **M7 is a reopen's start** (`takeWhatItHolds` at registration).
 * ⚑ **M8–M11 are D-046's `asked`** (`questionsForAPerson`): none at all (M8), the passer's words
   (M9), passed up or not (M10), the parts (M11).

## ⛔ What this table does not contain

 * ⚠️ 031d1176 (D-033's window) and d2d8a5e9 (D-046's window): NO commits — the window's polls were
   removed and its moved rows re-anchored and verified in the commits; D-046's window is small
   drawing.
 * ⚠️ `asItIsDrawn`'s stall cause: no reachable host path changes only the cause between two reads,
   so no test here kills dropping it.
 * ⚠️ The replacement's accepted over-announcement: documented behaviour, not tested.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

HEARD = "a-turn-that-moves-its-work-is-heard-at-once.test.ts"
ASKED = "the-persons-list-carries-the-question-as-it-was-asked.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **`work` is announced at every read**, moved or not — rows that move nothing, an "
        f"ended piece's turn and a reopen all say it · killed by `{HEARD}`",
        [(HOST,
          "    if (moved) this.theWorldMoved('work')\n",
          "    this.theWorldMoved('work')\n")],
    ),
    (
        "M2 · 🔴 **`work` is never announced** · a turn that stalls its piece is heard by no window "
        f"until something else moves · killed by `{HEARD}`",
        [(HOST,
          "    if (moved) this.theWorldMoved('work')\n",
          "    if (moved && false) this.theWorldMoved('work')\n")],
    ),
    (
        "M3 · a NEW piece first seen `working` is said again at the worker's `status` row, though "
        f"the give said it · killed by `{HEARD}`",
        [(HOST,
          "              ? piece.state !== 'working' && piece.state !== 'waiting'\n",
          "              ? true\n")],
    ),
    (
        "M4 · an ENDED piece is compared too, so the turn that ends over it announces `work` · "
        f"killed by `{HEARD}`",
        [(HOST,
          "      .filter((piece) => TASK_IS_OPEN[piece.state])\n",
          "      .filter(() => true)\n")],
    ),
    (
        "M5 · a background level that leaves work running reads what its conversation holds at "
        f"every level row · killed by `{HEARD}`",
        [(HOST,
          "    if (running.length > 0 || session.scheduled.jobs.length > 0) return\n",
          "    if (session.scheduled.jobs.length > 0) return\n")],
    ),
    (
        "M6 · on Codex, whose background wakes nothing, every level row reads what its "
        f"conversation holds · killed by `{HEARD}`",
        [(HOST,
          "    if (capabilitiesFor(session.provider).backgroundWake.state !== 'available') return\n",
          "    if (false) return\n")],
    ),
    (
        "M7 · 🔴 a conversation reopened in the next app run announces `work` at its first rows, "
        f"though nothing moved — its start took nothing as drawn · killed by `{HEARD}`",
        [(HOST,
          "    this.takeWhatItHolds(id)\n",
          "    void id\n")],
    ),
    (
        "M8 · 🔴 **no question on the person's list carries its words** · `asked` is always null "
        f"· killed by `{ASKED}`",
        [(HOST,
          "            raised === undefined\n",
          "            true\n")],
    ),
    (
        "M9 · a question passed up loses what the passer added · killed by "
        f"`{ASKED}`",
        [(HOST,
          "                  context: raised.context,\n",
          "                  context: null,\n")],
    ),
    (
        "M10 · a question passed up reads as asked directly, and a direct one as passed up · "
        f"killed by `{ASKED}`",
        [(HOST,
          "                  passedUp: raised.passedUpFrom !== null,\n",
          "                  passedUp: raised.passedUpFrom === null,\n")],
    ),
    (
        "M11 · 🔴 a question's parts — its choices, its rules, a provider's header and secret — are "
        f"dropped from the list · killed by `{ASKED}`",
        [(HOST,
          "                  parts: raised.questions,\n",
          "                  parts: [],\n")],
    ),
]
