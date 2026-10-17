"""1027 · D-027 · waiting messages go together, as one turn.

⚑ **Why `1027`**: card D-00N's table is `100N`. D-027 is one DEV commit, `2f080601`.

## What it changed

When a conversation's turn ends, everything held for it goes in as one turn, oldest first (up to 64).
One held message goes exactly as before; several go through a second door as one text, each message
under its own heading, sender line, attachments and piece line. A turn is stamped `person` only when
every message in it is a person's. A person's command still goes alone. A person's Stop and send
joins what waits. The ledger keeps one `user_turn` per delivery with its `parts`, and one `sent`
ending per message, written just before the turn; every reader goes through the parts.

 * `M1`–`M16` — killed by the landing's `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`
   (`M3`, `M5` and `M6` also by older files).

Designed read-only by a Sonnet 5.5 agent from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 16 of 16.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `9ffd7d6a` (the merges of `2f080601`, `3ef68f7f` and `dc5f3f4c`), none by a syntax, reference or type
  error. Each killer file ran green unmutated first.
"""

SESSION_STORE = "apps/desktop/src/main/db/session-store.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TURN_ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
LAST_EXCHANGE = "apps/desktop/src/shared/last-exchange.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a turn of several numbers its messages from 0 · the heading shows `Message 0 of 3.` for the first — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (TURN_ORIGIN, "String(at + 1)", "String(at)"),
        ],
    ),
    (
        "M2 · the app's own words in a turn of several are headed like anyone's · the host passes theAppWroteIt false for the app's message, so it reads as more of the person's words — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (RUNTIME_HOST, "        theAppWroteIt: queued.origin === undefined,\n", "        theAppWroteIt: false,\n"),
        ],
    ),
    (
        "M3 · a mixed turn is stamped with its first message's stamp · an app's or an agent's words ride under a person's stamp (or the reverse) — killed by `whose-words-the-provider-is-told.test.ts`, `the-hold-at-every-door.test.ts`, `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (TURN_ORIGIN, "  return rest.every(same) ? first : undefined\n", "  return first\n"),
        ],
    ),
    (
        "M4 · the 64-message cap is not applied · a flush takes every held message, 65 in one turn — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (RUNTIME_HOST, "      if (taking.length === MAX_TURN_PARTS) break\n", ""),
        ],
    ),
    (
        "M5 · a turn of several leaves out what the life still owes · D-024's first-turn lead is dropped from handTogetherToProvider's send, so a resumed Codex conversation never gets its own text — killed by `the-origin-a-model-is-told.test.ts`, `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (RUNTIME_HOST, "      this.withWhatThisLifeOwes(session, turn, currentPiece),\n", "      turn,\n"),
        ],
    ),
    (
        "M6 · a person's command rides inside a turn of several on Claude · the slash arm of goesAlone is gone, so a held `/compact` is framed in words among the others — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`, `what-a-waker-reads-after-its-own-act.test.ts`",
        [
            (RUNTIME_HOST, "      mightBeAPersonsCommand(text, from, PROVIDER_COMMAND_PREFIX[session.provider]) ||\n", ""),
        ],
    ),
    (
        "M7 · Codex's `/compact` rides inside a turn of several · the compaction arm of goesAlone is dead, so on Codex the command becomes words in a framed turn and compacts nothing — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (RUNTIME_HOST, "      (session.handle.compact !== undefined && aPersonsCompaction(text, from) !== null)\n", "      false\n"),
        ],
    ),
    (
        "M8 · Stop and send joins past a person's command that waits · the held-command clause of itJoinsWhatWaits is gone, so the replacement is queued behind the command instead of going at once — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            # ⚑ **the service dispatcher · re-anchored in place, not retired** — NOT VERIFIED: re-anchored source-only on the text L4a moved or repeated; the mutant makes the same change as before; no table run.
            # ⚑ **W4.493 · re-anchored in place, not retired** — Source-only, NOT VERIFIED. Moves go alone like commands and service briefs; removing the complete same guard keeps the original defect and killer. No plant or table run.
            (RUNTIME_HOST, "      !session.mailbox.some(\n        (queued) =>\n          this.goesAlone(session, queued.text, queued.origin ?? null) ||\n          this.aServiceBrief(session, queued) ||\n          queued.authorship.movedFrom !== undefined,\n      )\n", "      true\n"),
        ],
    ),
    (
        "M9 · a Stop and send that is itself a command joins what waits · the own-words clause of itJoinsWhatWaits is gone, so `/compact` is queued after the waiting message instead of replacing the turn at once — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (RUNTIME_HOST, "      !this.goesAlone(session, text, from) &&\n", ""),
        ],
    ),
    (
        "M10 · a Close inside a handover abandons only the first message of the turn · the rest are handed on as if never sent, though they are on the wire — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (RUNTIME_HOST, "      const cut = session.handingOver.includes(queued)\n", "      const cut = session.handingOver[0] === queued\n"),
        ],
    ),
    (
        "M11 · a `sent` ending lets go of work held for the queue · between the endings and the one turn that carries them the work reads stalled — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (TASKS, "      if (waitingToDriveIt.delete(event.messageId) && event.reason !== 'sent') {\n", "      if (waitingToDriveIt.delete(event.messageId)) {\n"),
        ],
    ),
    (
        "M12 · a turn of several drives by its own top level, not by its parts · it names no piece, so it drives every open piece and a stalled piece nobody drove reads working — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (TASKS, "      const parts = event.parts ?? [event]\n", "      const parts = [event]\n"),
        ],
    ),
    (
        "M13 · a turn driving several pieces is said to drive the first · theDriveOfTheTurn answers the first message's piece when the messages name different pieces or one names none — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (TASKS, "  return drives.size === 1 ? (only ?? null) : null\n", "  return only ?? null\n"),
        ],
    ),
    (
        "M14 · a stored part is replayed with whatever keys it holds · boundTheParts copies the whole stored object instead of building the part from USER_TURN_PART_KEYS — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (SESSION_STORE, "      for (const key of USER_TURN_PART_KEYS) if (said[key] !== undefined) built[key] = said[key]\n", "      Object.assign(built, said)\n"),
        ],
    ),
    (
        "M15 · the window counts every message of a turn of several as a turn · the Changes pane's turn axis moves by n for one prompt — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (TRANSCRIPT, "        state.changes.turn = turns + 1\n", ""),
        ],
    ),
    (
        "M16 · the messages that came with the last are the wrong slice · whatATurnDelivered lists all but the FIRST as cameWith, so the first message is lost and the last repeats — killed by `what-a-turn-of-several-held-messages-says-and-keeps.test.ts`",
        [
            (LAST_EXCHANGE, "  const earlier = messages.slice(0, -1)\n", "  const earlier = messages.slice(1)\n"),
        ],
    ),
]
