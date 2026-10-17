"""612 · No clock decides a parent failed — and what has to work once the clock is gone.

⛔ **The ruling is `HO-088` §3.1 and it is one sentence:** *"A clock deciding that Ada did not
answer is the same defect as a clock deciding a child failed (`HO-018` §2.1) and a clock deciding a
person failed (`HO-082` §2)."*

## 🔴 What this dispatch REMOVED, because that decides what these rows have to kill

⚑ **The whole deadline**: `ESCALATION_WINDOW_MS`, `RuntimeHostDeps.escalationWindowMs`,
`watchForEscalation`, `armEscalationLook`, `writeWhatIsDue`, `SessionStore.escalationsDue`,
`escalationsDueNow` and `RequestEscalationDue`. ⛔ **`RequestEscalatedEvent` has no producer left
in this app.**

⚠️ **So a mutation that restores the clock is NOT what this table is for** — that is `608`'s rule
one subject over, and it applies here for the same reason: **the deadline's absence is a DELETION,
and a deletion is guarded by the things that now have to work without it.** ⚑ Every row below is
one of those things.

## ⛔ A · the two things that must still reach a person

⚑ **`M1` is the sharpest row and it is about HISTORY.** ⚠️ the person's database holds `escalatedAt`
stamps — every one a question a person really was told about — and the reader that admits them is
now the ONLY thing standing between those rows and a queue that has forgotten them. 🔴 **Nothing
writes them any more, so nothing would ever put one back**: dropping the arm is a silent, permanent
deletion from a surface, which is `142`'s rule broken at a derivation rather than at a table.

⛔ **`M2` is the same fact one layer down.** The fold is what turns the row into the stamp; take the
branch and the ledger still holds the event while every reader behaves as though it does not.

## 🔴 B · the two things that must say WHAT they are

⚠️ **`M3` makes the queue claim a person was TOLD.** ⛔ `BlockedSinceIs` exists to say which event
a row's instant came off — *"`told` and `routed` are not the same event"* — and since `612` nothing
is ever told. ⚑ A row saying `told` about a question an agent addressed is the app inventing an
announcement it never made.

⚑ **`M4` is `a-number-can-survive-the-death-of-its-derivation` pointed at the number this dispatch
orphaned.** ⛔ `LOOK_EVERY_MS` was a sixth of a deadline; with no deadline it is **the whole latency
between an agent asking and a person knowing**, because nothing pushes. ⚠️ Making it the digest's
cadence is not obviously wrong on a reading — it is *a summary's* cadence applied to *a person's
obligations*, which is the distinction that survived.

## ⚠️ C · and the one that must NOT reach a person

⛔ **`M5` puts a permission back into the question queue.** ⚑ The deadline's own skip used to be
half of what kept it out, and `612` took that half — so this reader's exclusion is now the whole of
criterion 10's negative at this venue rather than one of two writers apart.

## ⛔ What has NO row, said rather than left out

⚠️ **No row restoring the clock.** ⛔ It would need the constant, the dep, the field, the sweep, the
look and the arming — six edits across three files — and what it would measure is `398`'s table,
whose rows for exactly that behaviour are RETIRED BY this dispatch with their reason named.

⚠️ **No row on the ADMISSION of an addressed question** (`611 M4`) or on
{@link aPersonsSince}'s two clocks (`611 M5`). ⛔ Both are `611`'s and both are RED there; a second
row on the same line would be two rows measuring one rule.

⚠️ **No row on the `a-question` rename.** ⛔ A name is not a behaviour, and the roster censuses in
`persons-queue.test.ts` and `two-counts-and-one-moment.test.ts` are what guard it.
"""

from __future__ import annotations

STORE = "apps/desktop/src/main/db/session-store.ts"
QUESTIONS = "apps/desktop/src/shared/questions.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · what must still reach a person ─────────────────────────────────────────────────────
    (
        "M1 · 🔴 **a ledger written before `612` loses its rows from a person's queue** · the "
        "reader stops admitting a question a deadline stamped, and since nothing stamps anything "
        "any more that arm is the only thing those rows have. ⛔ **Silent and permanent**: no "
        "future write puts one back, the row stays `open` and answerable in the database, and the "
        "surface that exists to say what a person owes has forgotten it — `142`'s *nothing is "
        "deleted*, broken at a derivation instead of at a table",
        [
            (
                STORE,
                "              (request.escalatedAt !== null || request.went.is === 'the-person-the-asker-named') &&",
                "              request.went.is === 'the-person-the-asker-named' &&",
            )
        ],
    ),
    (
        "M2 · ⛔ **the fold stops reading the stamp at all** · `request_escalated` is still in the "
        "ledger, still parsed, and every reader behaves as though it is not. ⚑ It is `M1`'s defect "
        "one layer down and it is WIDER: the queue, the age, the ordering and `aPersonsSince` all "
        "read `escalatedAt`, so a historic row becomes a question nobody is waiting on rather than "
        "one row missing from one list",
        [
            (
                QUESTIONS,
                "      const index = everSeen.get(event.requestId)\n"
                "      if (index === undefined) continue\n"
                "      if (rows[index]!.escalatedAt !== null) continue\n"
                "      rows[index] = { ...rows[index]!, escalatedAt: entry.at }\n",
                "      continue\n",
            )
        ],
    ),
    # ── B · what must say what it is ───────────────────────────────────────────────────────────
    (
        "M3 · ⚠️ **the queue says a person was TOLD about a question nobody announced** · every "
        "row reads `told`, which is `escalatedAt`'s word. ⛔ `BlockedSinceIs` exists to say WHICH "
        "EVENT a row's instant came off — *\"`told` and `routed` are not the same event\"* — and "
        "since `HO-088` §3.1 nothing is ever told. ⚑ A queue that claims an announcement this app "
        "did not make is `222`'s false sentence with a timestamp attached",
        [
            (
                QUEUE,
                "        one.request.went.is === 'the-person-the-asker-named' ? 'routed' : 'told',",
                "        'told',",
            )
        ],
    ),
    (
        "M4 · ⚑ **a person waits a SUMMARY's cadence to learn something is theirs** · the poll "
        "takes the digest's number. ⛔ **With the deadline gone this interval IS the latency** "
        "between an agent asking and a person knowing — nothing pushes — where it used to be a "
        "sixth of a window a question had to sit through first. ⚠️ `a-number-can-survive-the-death-"
        "of-its-derivation`: the mutation is a reading somebody could defend, and the distinction "
        "it erases is the one that outlived the clock",
        [(QUEUE, "export const LOOK_EVERY_MS = 5_000", "export const LOOK_EVERY_MS = 30_000")],
    ),
    # ── C · what must not ──────────────────────────────────────────────────────────────────────
    (
        "M5 · ⛔ **a permission walks into the question queue** · the reader stops excluding the "
        "arm the channel refused. ⚑ **The deadline's own skip used to be the other half of this** "
        "— *that skip stops a permission being ESCALATED; this stops one being READ BACK as "
        "escalated* — and `612` took that half, so this exclusion is now the whole of criterion "
        "10's negative here rather than one of two writers apart. ⚠️ A person then sees one "
        "request twice and is told a parent might still answer a card no parent may touch",
        [
            (
                STORE,
                "              request.went.is !== 'the-person-the-channel-left-it-with',",
                "              true,",
            )
        ],
    ),
]
