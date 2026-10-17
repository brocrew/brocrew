"""1001 · D-001 · a card its turn left live while the host still holds it (`fefa3423`).

⚑ **Why `1001`** (T-002): a table id must be a positive integer (`runner_contract.TABLE_ID`), and
the work model's cards have none, so card D-00N's table is `100N`.

1001 · D-001: a card its turn left live while the host still holds it (fefa3423; `738` P-1,
`sess_0d870a6d`).

BroBot on Codex in `ask` called `spawn_agent` from a code-mode cell. The turn COMPLETED with the
cell still awaiting BroBot's own card, and the status stayed `waiting_permission`. The fold settled
the card anyway ("settled when the turn ended", no buttons), so the composer stayed frozen over a
card nobody could answer and the queued message never went. Only Stop got out.

The fix, all in the renderer fold:
- (A) `case 'turn'` passes a fourth argument to `settlePending`: 'still-held' only when the ending
  is completed or failed AND `state.status === 'waiting_permission'`. `holdOrSettle` then leaves the
  permission or question card live and names it in `heldPastTheirTurn`. Every other ending keeps the
  default 'released': interrupted, session close (`markTerminal`), reopen and read-only.
- (B) `case 'status'`: on `idle` or `working`, `letGoOfHeldRequests` settles any still-open named
  card with HELD_REQUEST_LET_GO and recounts. It does not run on `ended`/`errored`, where
  `markTerminal` names the ending.
- (C) `carryForward` and `foldWindow`'s `placeCarried` carry the set across a window release.

Rows: M1 puts the measured defect back byte for byte (pre-fix main). M2–M4 are the three boundaries
of the hold decision. M5 is the question half. M6–M9 are the let-go half: the call, its recount, its
question arm, its `working` arm. M10–M11 are the two ends of the carry. Killer file:
apps/desktop/test/a-card-its-turn-left-live.test.ts (10 tests). transcript.test.ts adds kills for M3
and M4. M8 and M9 survived the card's own tests; see Verification.

## ⚠️ What has no row here, and why

- `holdOrSettle`'s `add` dropped (card spared but unnamed): same observable and same killers (T7,
  T10) as M6, which rows the let-go half at its caller.
- `state.heldPastTheirTurn.clear()` at the top of `settlePending`: equivalent on reachable ledgers.
  letGo's guards (`outcome`/`answered`/`note === null`) skip any card a later ending already spoke
  for, and the next `idle`/`working` clears the set anyway. A stale id could only bite if a new life
  raised a card with the same provider id (Codex numbers from `number:0`) and no `working`/`idle`
  came between. It cannot, because a new turn's `working` precedes its card.
- letGo's trailing `.clear()` and its `size === 0` early return: equivalent (every card it reaches
  is then noted; the early return is only a shortcut).
- letGo's permission arm alone: subsumed by M6, since every let-go test holds a permission card.
- Widening the let-go to `ended`/`errored` (letting go on any status but `waiting_permission`), the
  boundary the source comment draws ('Not ended/errored: markTerminal below says which ending it
  was'): equivalent on every ledger the machine writes. `closeSession` says `session:'ended'` before
  its `status:'ended'`, and `fatalError` says `error{fatal:true}` before `status:'errored'`. The
  fold settles both through `markTerminal` first, which clears the set. The only status-alone
  terminal is a session closed with no provider ref, which cannot hold a card. ⚠️ So T9 ('a session
  that closes while it is held says which ending it was') pins the `markTerminal` path (M1, M4) but
  does not discriminate this line: its ledger has `session:'ended'` first.
- Moving the restore line inside `placeCarried` relative to `markReopened`: the epoch ordering is
  decided by `placeCarried`'s call sites, not by the line, so a row on the line cannot cross the
  epoch.
- `markPermissionAnswered` / `markUserInputAnswered` clearing `note` (what makes T6 'the row still
  wins' green): predates D-001 (503) and belongs to other tables.
- HELD_REQUEST_LET_GO's text: the test imports the constant, so changing its words survives by
  construction. It is copy, not behaviour.
- Types and docblocks (the `TranscriptState.heldPastTheirTurn` and `FoldCarry.heldPastTheirTurn`
  declarations, the `TheProposal` doc, the `createTranscript` initialiser): `tsc` is their gate.
  Deleting the initialiser would be a wrong-reason TypeError at the first `.clear()`.
- The card's own ⚠️ 'not fixed here' (a card raised in a Claude out-of-turn burst and then Stopped
  keeps live buttons): there is no code to put back, and no smoke reproduces P-1 now (step 47 runs
  as a worker).

## Verification

T-002 designed these rows read-only and verified each one alone with `verify_row.py`: applied,
its own killer files run, restored from bytes. The table has not been run.
- RED alone: M1–M7, M10, M11 on `a-card-its-turn-left-live.test.ts`; M3, M4 also on
  `transcript.test.ts`.
- ⚠️ **M8 and M9 SURVIVED D-001's own tests** (no test let a held QUESTION go, and none folded a
  `working` after a held turn end). T-002 added one test for each in
  `a-card-its-turn-left-live.test.ts`, and both are RED on it now. T-002 also added D-001's two
  paths (the held turn end and the let-go) to `agent-state.test.ts`'s pending-count roster (099).
"""

FOLD = 'apps/desktop/src/renderer/src/lib/transcript.ts'
WINDOW = 'apps/desktop/src/renderer/src/lib/transcript-window.ts'

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        'M1 · 🔴 **THE DEFECT, restored: a turn\'s ending settles every open card, held or not** (pre-D-001 `main`, `738` P-1): the `spawn_agent` card reads *"settled when the turn ended"* with no buttons over a wait the host still holds. killed by `a-card-its-turn-left-live.test.ts` (D-001)',
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # `completed` or `failed` turn ending under a wait the host still holds (status
        # `waiting_permission`) leaves the card live and does not settle it. D-016a removed the
        # proposal argument, so `settlePending` now has one 'requests' argument and the type is
        # `TheRequests`. Dropping that argument at the turn-ending call falls back to 'released',
        # which is the defect: every ending settles every open card, held or not.
        [
            (FOLD, "        `settled when the turn ${TURN_END_WORD[event.state]}`,\n        event.state !== 'interrupted' && state.status === 'waiting_permission'\n          ? 'still-held'\n          : 'released',\n      )\n", '        `settled when the turn ${TURN_END_WORD[event.state]}`,\n      )\n'),
        ],
    ),
    (
        'M2 · ⛔ **an INTERRUPTED turn holds the card too**: the boundary the card drew (*"interrupted turns settle as before"*) is gone, and a Stop leaves live Allow/Deny/Cancel over a request both adapters\' `interrupt()` already safe-rejected. killed by `a-card-its-turn-left-live.test.ts` (D-001)',
        [
            (FOLD, "        event.state !== 'interrupted' && state.status === 'waiting_permission'\n          ? 'still-held'\n          : 'released',\n", "        state.status === 'waiting_permission'\n          ? 'still-held'\n          : 'released',\n"),
        ],
    ),
    (
        'M3 · ⛔ **the status guard dropped: EVERY completed/failed turn spares its cards**, including ones nothing holds (`working` at the terminal means the wait count was zero). The paired positive and 085\'s *"settled when the turn ended"* go. killed by `a-card-its-turn-left-live.test.ts` and `transcript.test.ts` (D-001)',
        [
            (FOLD, "        event.state !== 'interrupted' && state.status === 'waiting_permission'\n          ? 'still-held'\n", "        event.state !== 'interrupted'\n          ? 'still-held'\n"),
        ],
    ),
    (
        "M4 · ⛔ **the new parameter's default flipped to 'still-held'**: a session closing, a reopen and a read-only view spare every open card instead of settling it. Only a turn's ordinary ending may. killed by `a-card-its-turn-left-live.test.ts` and `transcript.test.ts` (D-001)",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: only
        # a turn's ordinary ending may spare a card, so the default of `settlePending`'s parameter
        # is 'released' (a session closing, a reopen and a read-only view settle every open card).
        # The parameter is now `requests: TheRequests = 'released'`, since the proposal parameter
        # and the `TheProposal` type were removed by D-016a, so the old anchor no longer matches.
        # Flipping the default to 'still-held' makes markTerminal, markReopened and markReadOnly
        # spare every card.
        [
            (FOLD, "  requests: TheRequests = 'released',\n", "  requests: TheRequests = 'still-held',\n"),
        ],
    ),
    (
        "M5 · 🔴 **the QUESTION half: a question card still settles at a held turn end** while the permission card is spared. A Claude background agent's question, open at the main turn's `result`, freezes the composer exactly as P-1 did. killed by `a-card-its-turn-left-live.test.ts` (D-001)",
        [
            (FOLD, "    if (item.kind === 'userInput' && item.answered === null && item.note === null) {\n      holdOrSettle(state, item, reason, requests)\n    }\n", "    if (item.kind === 'userInput' && item.answered === null && item.note === null) {\n      item.note = reason\n    }\n"),
        ],
    ),
    (
        'M6 · 🔴 **the let-go never runs: a card its turn left live stays live after the host lets go of it**. A Stop declines it (`interrupt()` safe-rejects) and the card still offers Allow/Deny/Cancel, pressing reaches a spent id, and the count keeps the composer frozen. killed by `a-card-its-turn-left-live.test.ts` (D-001)',
        [
            (FOLD, "      if (event.state === 'idle' || event.state === 'working') letGoOfHeldRequests(state)\n", "      if (false && (event.state === 'idle' || event.state === 'working')) letGoOfHeldRequests(state)\n"),
        ],
    ),
    (
        'M7 · 🔴 **the let-go settles the card but not the COUNT**: the card says *"settled when the agent stopped waiting for it"* while `pending` still counts it, so the composer, header and Open tab keep saying *answer above to continue* over a card with nothing to press, which is P-1\'s symptom one step later. killed by `a-card-its-turn-left-live.test.ts` (D-001)',
        [
            (FOLD, '  state.heldPastTheirTurn.clear()\n  recountPending(state)\n}\n', '  state.heldPastTheirTurn.clear()\n}\n'),
        ],
    ),
    (
        'M8 · ⚠️ **the let-go forgets QUESTIONS**: a question its turn left live, then Stopped, keeps its Answer button, and `pending.questions` keeps the composer frozen · killed by `a-card-its-turn-left-live.test.ts` (the test T-002 added)',
        [
            (FOLD, "    if (item?.kind === 'userInput' && item.answered === null && item.note === null) {\n      item.note = HELD_REQUEST_LET_GO\n    }\n", "    if (false && item?.kind === 'userInput' && item.answered === null && item.note === null) {\n      item.note = HELD_REQUEST_LET_GO\n    }\n"),
        ],
    ),
    (
        'M9 · ⚠️ **only `idle` lets go, not `working`**: a held card whose wait drops to zero while a burst keeps the machine `working` keeps live buttons and its count until the next idle · killed by `a-card-its-turn-left-live.test.ts` (the test T-002 added)',
        [
            (FOLD, "      if (event.state === 'idle' || event.state === 'working') letGoOfHeldRequests(state)\n", "      if (event.state === 'idle') letGoOfHeldRequests(state)\n"),
        ],
    ),
    (
        'M10 · 🔴 **the carry forgets which cards the turn left live**: after a window release drops the `turn` row, the held card comes back live but unnamed, and the `idle` after a Stop can no longer settle it. It is live forever over a request nothing holds. killed by `a-card-its-turn-left-live.test.ts` (D-001)',
        [
            (WINDOW, '    heldPastTheirTurn: [...state.heldPastTheirTurn],\n', '    heldPastTheirTurn: [],\n'),
        ],
    ),
    (
        'M11 · 🔴 **the carry is built but never restored**: `placeCarried` replays the card and drops the set, so a released window loses what the turn left live, with the same dead control as M10 from the other end. killed by `a-card-its-turn-left-live.test.ts` (D-001)',
        [
            (WINDOW, '    for (const requestId of carry.heldPastTheirTurn) state.heldPastTheirTurn.add(requestId)\n', '    for (const requestId of carry.heldPastTheirTurn.slice(0, 0)) state.heldPastTheirTurn.add(requestId)\n'),
        ],
    ),
]
