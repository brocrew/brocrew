"""1025 · D-025 · a reply refused for an ended piece says who ended it and when.

⚑ **Why `1025`**: card D-00N's table is `100N`. D-025 is one DEV commit, `b1bd62db`, landed through
DEV's own merge of `main`, `2b765d75`.

## What it changed

`piece-already-ended` says, after what to do, how the piece ended, who by and when (*"It was closed by
BroBot at 07:39 PM…"*, *"It was taken back by …"*, *"You already replied at …"*). The fold keeps who
ended a piece (`PieceRow.endedBy`), and `admitReply` puts the moment and the name into the refusal's
detail, never an id, and no name when the caller ended it itself.

 * `M1`–`M10` — killed by the landing's
   `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`.

Designed read-only by a Sonnet 5.5 agent from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 10 of 10.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `1c07454c` (the merge of `2b765d75`), none by a syntax, reference or type error. The killer file ran
  green unmutated first.
"""

REPLY_RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a close stamps nobody as having ended the piece · the fold writes endedBy null for work_closed, so the refused reply says 'It was closed at <time>' and never by whom — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (TASKS, "      settle(event.piece, 'closed', entry.at, event.by)\n", "      settle(event.piece, 'closed', entry.at, null)\n"),
        ],
    ),
    (
        "M2 · a take-back stamps nobody as having ended the piece · the fold writes endedBy null for work_taken_back, so the refusal says 'It was taken back at <time>' with no giver — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (TASKS, "      settle(event.piece, 'withdrawn', entry.at, event.by)\n", "      settle(event.piece, 'withdrawn', entry.at, null)\n"),
        ],
    ),
    (
        "M3 · a held brief cancelled is stamped as ended by its giver · the cancel row names nobody (a person or the app may have cancelled it), but the fold guesses the giver, so the refusal claims 'It was taken back by <giver>' — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (TASKS, "        settle(piece, 'withdrawn', entry.at, null)\n", "        settle(piece, 'withdrawn', entry.at, open.get(piece)?.row.giver ?? null)\n"),
        ],
    ),
    (
        "M4 · the owner is told its own name for its own reply · admitReply drops the endedBy === owner guard, so a second reply is refused with detail.called set to the caller itself (729 R90: a reader is never told its own name) — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (REPLY_RAILS, "      ...(piece.endedBy === null || piece.endedBy === piece.owner\n", "      ...(piece.endedBy === null\n"),
        ],
    ),
    (
        "M5 · the refusal names who ended the piece by its session id · detail.called is the raw endedBy instead of the host's display name, so an id reaches the agent that D-025 says never carries one — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (REPLY_RAILS, "        : { called: whatToCall(piece.endedBy) }),\n", "        : { called: piece.endedBy }),\n"),
        ],
    ),
    (
        "M6 · the refusal names the piece's giver instead of the conversation that ended it · called is the name of piece.giver, so a close or take-back by the conversation in the giver's place is credited to the giver — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (REPLY_RAILS, "        : { called: whatToCall(piece.endedBy) }),\n", "        : { called: whatToCall(piece.giver ?? piece.endedBy) }),\n"),
        ],
    ),
    (
        "M7 · the refusal carries no moment · admitReply stops putting the ending's time in the detail, so neither detail.at nor ' at <time>' reaches the agent — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (REPLY_RAILS, "      ...(piece.endedAt === null ? {} : { at: piece.endedAt }),\n", "      ...(piece.endedAt === null ? {} : {}),\n"),
        ],
    ),
    (
        "M8 · the sentence never says who ended the piece · endedPieceSentence builds its 'by' clause as empty, so a close and a take-back read 'It was closed at <time>' even though detail.called is set — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (REPLY_RAILS, "  const by = detail.called === undefined ? '' : ` by ${detail.called}`\n", "  const by = ''\n"),
        ],
    ),
    (
        "M9 · a closed piece's refusal stops saying it was closed · the 'closed' arm says 'It has ended' in place of 'It was closed', so a giver's close reads like any ending — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (REPLY_RAILS, "      return `stop work on that piece; no further reply is owed. It was closed${by}${at}, so nothing was recorded or changed.`\n", "      return `stop work on that piece; no further reply is owed. It has ended${by}${at}, so nothing was recorded or changed.`\n"),
        ],
    ),
    (
        "M10 · a second reply is refused without saying when the first one landed · the 'answered' arm drops the moment, so 'You already replied, so nothing…' — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts` — killed by `a-reply-refused-for-an-ended-piece-says-who-ended-it-and-when.test.ts`",
        [
            (REPLY_RAILS, "      return `stop work on that piece; no further reply is owed. You already replied${at}, so nothing was recorded or changed.`\n", "      return `stop work on that piece; no further reply is owed. You already replied, so nothing was recorded or changed.`\n"),
        ],
    ),
]
