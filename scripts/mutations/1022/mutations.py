"""1022 · D-022 · a giver's correction reaches the owner, and the verbs say what happened.

⚑ **Why `1022`**: card D-00N's table is `100N`. D-022 is one DEV commit, `37228461`, landed through the
frontend's merge `8ca7d969` (with D-016c's commits 6 and 7).

## What it changed

 * **F029** — a new brief of a piece whose give still waits in the owner's mailbox folds into that
   give: `work_rebriefed` names the held message, no second message is queued, and the give goes out
   with the newest brief, read when it is handed over. A reply to a piece while a new brief is held
   says the answer is to the brief before its new one.
 * **F032** — take back, close and a new brief answer `delivery: sent | held | not-delivered` in place
   of `told: true`; *held* says it waits until the owner's turn ends, and a held close or take back
   adds that `interrupt_agent` asks that turn to stop. `give_work`'s held answer says *held*.
 * **F030** — a piece whose give has not reached its owner never counts when choosing the piece a give
   hangs under; of several received pieces, the one the running turn drives is chosen.

DEV wrote no new tests (the work model); `M1`–`M10` are killed by the landing's
`a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts` and the tests DEV re-aimed.
Designed read-only by a Sonnet 5.5 agent from the commit, the card and today's code; each row verified
alone by the landing agent.

## Verification

- **RED: 10 of 10.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `eb79c31d` (the frontend's merge `8ca7d969` and `7b233ff4`), none by a syntax, reference or type
  error. Each killer file ran green unmutated first.
"""

RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a held give goes out with the brief it was queued with instead of the piece's newest brief — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (RUNTIME_HOST, "if (now !== undefined && queued.rebrief !== true) words = now.brief", "if (now !== undefined && queued.rebrief !== true) words = queued.text"),
        ],
    ),
    (
        "M2 · a held new brief is overwritten with the piece's newest brief, so two held new briefs both say the second — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (RUNTIME_HOST, "if (now !== undefined && queued.rebrief !== true) words = now.brief", "if (now !== undefined) words = now.brief"),
        ],
    ),
    (
        "M3 · a new brief of a piece whose give waits never rides the give and queues its own message — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (RUNTIME_HOST, "const withItsGive = rebriefs && folded !== undefined && this.itsGiveStillWaits(folded)", "const withItsGive = false"),
        ],
    ),
    (
        "M4 · every new brief is treated as riding a give, even when the give was received, so the brief is never sent — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (RUNTIME_HOST, "const withItsGive = rebriefs && folded !== undefined && this.itsGiveStillWaits(folded)", "const withItsGive = rebriefs && folded !== undefined"),
        ],
    ),
    (
        "M5 · the work_rebriefed row does not name the held give it rides — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (RUNTIME_HOST, "...(withItsGive && folded?.messageId != null ? { messageId: folded.messageId } : {}),", "...{},"),
        ],
    ),
    (
        "M6 · every open piece counts as having reached its holder, so held pieces are inferred, counted and listed — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (RUNTIME_HOST, "received: !this.itsGiveStillWaits(one),", "received: true,"),
        ],
    ),
    (
        "M7 · the turn's drive is never read, so an unnamed give among several received pieces is always refused — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (RUNTIME_HOST, "return session !== null && session.turnOpened ? session.itsTurnDrives : null", "return null"),
        ],
    ),
    (
        "M8 · a take-back, close or inputs notice held behind a running turn is answered `sent` — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 34a00442 moved the sent/held mapping into the module function deliveryOf(), which the take-back, close and inputs tells all return through. Killer still asserts 'held' for closedBusy, taken and handed.
            (RUNTIME_HOST, "    : { delivery: delivered.outcome === 'sent' ? 'sent' : 'held' }\n", "    : { delivery: 'sent' }\n"),
        ],
    ),
    (
        "M9 · a reply never says a correction lost the race — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (RUNTIME_HOST, "(one) => one.piece === piece.piece && one.rebrief === true,", "(one) => false,"),
        ],
    ),
    (
        "M10 · the held give's card keeps its old words when a new brief rides it — killed by `a-new-brief-of-a-piece-whose-give-still-waits-rides-that-give.test.ts`",
        [
            (TRANSCRIPT, "if (held) held.text = event.brief", "if (held) held.text = held.text"),
        ],
    ),
]
