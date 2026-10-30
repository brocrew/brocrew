"""3037 · a helper a person wrote to waits on that person — the fold, the host's reads, the idle
stop, the person's list and corner — and, beside it, the sign-in renewed where it is read and the
Context popup's jump.

⛔ **The subject**: when a person's own words open a helper's turn and that turn ends on its own with
a piece another conversation gave still open, the piece waits on that person instead of stalling:
open, no cause, nothing said to its giver. A turn the giver's or this app's words opened still
stalls, and so does one stopped, asked to stop or refused for a usage limit; a piece a person gave
waits on the person who asked, as before. Any drive leaves the wait, a person's reply held while the
helper is busy drives it, and the moment it began survives a reply taken back. The helper reads
"needs you" only while no more specific wait is said over it, the person's list holds only those
pieces, and a conversation whose "needs you" the ledger holds is stopped when idle like any other.
Beside it: a conversation asks for its profile's sign-in only once a refusal is on screen, and the
conversation and its card share one sign-in; a jump from the Context popup shuts it.

## ⚑ What a row here measures

 * ⚑ **M1–M10 are the fold** (`tasks.ts`, `a-persons-own-words.ts`): the giver guard (M1), the asked
   stop (M2), the endings that may wait (M3), what counts as a person's words (M4), a piece another
   author named in the same turn (M5), a held message of the giver's own (M6), the moment kept when
   a held reply is taken back (M7), the moment written only on a row still waiting (M8), a drive
   leaving the wait (M9), and a release a refused sign-in cut (M10).
 * ⚑ **M11–M14 are the host and the store** (`runtime-host.ts`, `session-store.ts`): "needs you"
   read from the pieces (M11), composed so a more specific wait is said (M12), the person's list
   composed the same way (M13), and the per-conversation read kept only while its ledger is
   unchanged (M14).
 * ⚑ **M15 is the idle stop**: a conversation whose "needs you" the ledger holds is stopped.
 * ⚑ **M16, M17 are the person's list in the window** (`persons-queue.ts`): a failed read is a hole,
   never nothing, and the corner counts the pieces.
 * ⚑ **M18, M19 are the sign-in renewal** (`ConversationPane.vue`, `useProfileSignIn.ts`): asked
   only under a refusal, and one sign-in per provider and profile.
 * ⚑ **M20 is the Context popup** (`SessionPanel.vue`): a jump to a compaction shuts it.

## ⛔ What this table does not contain

 * ⚠️ The background's release keeping the person's words, the queue hold's own copy, the turn
   that names one piece and words naming none, the workspace count, and the corner's mount — each
   killed by the same tests, left out to keep the table at twenty rows.
 * ⚠️ `messagesWaitingIn`'s one-pass pairing: its filter is table 1017's; the ending set and the
   torn-ending rule have no test that reads them.
 * ⚠️ The stall recorder, the Providers card's setup guide, and the idle check's guard for a start
   or a delivery on its way: no existing test reaches them (see the gaps file).
"""

TASKS = "apps/desktop/src/shared/tasks.ts"
OWN_WORDS = "apps/desktop/src/shared/a-persons-own-words.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
SIGN_IN = "apps/desktop/src/renderer/src/composables/useProfileSignIn.ts"
PANEL = "apps/desktop/src/renderer/src/components/SessionPanel.vue"

TURN = "a-turn-a-person-opened-waits-on-them.test.ts"
OWES = "a-person-owes-the-agent-that-answered-them.test.ts"
QUIET = "a-quiet-conversation-is-stopped-by-the-app-and-woken-by-its-next-message.test.ts"
REPLY = "work-waiting-on-your-reply-is-drawn-and-counted.dom.test.ts"
RENEWED = "an-agents-expired-sign-in-is-renewed-where-it-is-read.dom.test.ts"
POPUP = "the-context-popup.dom.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 a piece a PERSON gave waits on the person who wrote rather than on the person who "
        f"asked for it · killed by `{TURN}`",
        [(TASKS,
          "      held.row.giver !== null &&\n      aPersonWroteIt &&\n",
          "      aPersonWroteIt &&\n")],
    ),
    (
        "M2 · 🔴 a turn a person asked to stop, which its provider then finished, waits on the person "
        f"and its giver never hears of the stop · killed by `{TURN}`",
        [(TASKS,
          "      aPersonWroteIt &&\n      by === null &&\n",
          "      aPersonWroteIt &&\n")],
    ),
    (
        "M3 · 🔴 a turn refused for the usage limit waits on the person who wrote, and its giver is "
        f"not told the work stopped · killed by `{TURN}`",
        [(TASKS,
          "  turn_interrupted: false,\n  provider_limited: false,\n  login_refused: false,\n  billing_refused: false,\n  background_stopped: false,\n",
          "  turn_interrupted: false,\n  provider_limited: true,\n  login_refused: false,\n  billing_refused: false,\n  background_stopped: false,\n")],
    ),
    (
        "M4 · 🔴 a giver's brief or note counts as a person's own words, so the turn it opens leaves "
        f"its piece waiting on a person instead of stalling · killed by `{TURN}`",
        [(OWN_WORDS,
          "    one.relayedFrom === undefined &&\n",
          "")],
    ),
    (
        "M5 · 🔴 a brief or follow-up that names a piece, delivered in one turn with a person's "
        "words, leaves that piece waiting on the person instead of stalling for its giver · "
        f"killed by `{TURN}`",
        [(TASKS,
          "  return (piece) => (everyPiece || theirPieces.has(piece)) && !anotherNamed.has(piece)\n",
          "  return (piece) => everyPiece || theirPieces.has(piece)\n")],
    ),
    (
        "M6 · a message the giver holds for the helper is taken as the person's reply, and the "
        f"piece leaves the person's list though they wrote nothing · killed by `{TURN}`",
        [(TASKS,
          "      if (event.messageId !== undefined && aPersonsOwnWords(event)) {\n",
          "      if (event.messageId !== undefined) {\n")],
    ),
    (
        "M7 · a reply held and then taken back restarts the wait from the take-back, not from the "
        f"turn that answered the person · killed by `{TURN}`",
        [(TASKS,
          "        aPersonWroteIt: true,\n        since: was.at,\n",
          "        aPersonWroteIt: true,\n")],
    ),
    (
        "M8 · a piece the person's next words drove again still carries when it began waiting on "
        f"them · killed by `{TURN}`",
        [(TASKS,
          "    if (held?.row.state !== 'waiting-on-the-person-who-wrote') continue\n    rows[held.index] = { ...held.row, answeredAPersonAt: at }\n",
          "    if (held === undefined) continue\n    rows[held.index] = { ...held.row, answeredAPersonAt: at }\n")],
    ),
    (
        "M9 · 🔴 a drive does not leave the wait: the person's next message leaves the piece waiting "
        f"on them mid-turn · killed by `{TURN}`",
        [(TASKS,
          # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · a4421c68 lets an informational note keep the wait by skipping it inside this branch; the plant still stops any drive from leaving the wait, so the person's next message leaves the piece waiting on them mid-turn.
          "      if (held.row.state === 'waiting-on-the-person-who-wrote') {\n        if (preservesPersonWait) continue\n        const driven: PieceRow = { ...held.row, state: 'working' }\n",
          "      if (false) {\n        if (preservesPersonWait) continue\n        const driven: PieceRow = { ...held.row, state: 'working' }\n")],
    ),
    (
        "M10 · work its background release left waiting on the person, whose wake a refused sign-in "
        f"cut, keeps waiting instead of stalling on the sign-in · killed by `{TURN}`",
        [(TASKS,
          "              : row?.state === 'waiting-on-the-person-who-wrote' &&\n                waitsOnWhoWroteSince.get(piece)?.at === stalledAt\n",
          "              : false\n")],
    ),
    (
        "M11 · 🔴 a helper whose piece waits on the person who wrote is not \"needs you\" anywhere — "
        f"not its card, the windows, or another agent's tools · killed by `{OWES}`",
        [(HOST,
          "        (status === 'waiting_permission' && theirs === undefined) ||\n        // ⚑ **F097** — asked last: the one arm that reads its pieces.\n        this.aPieceItHoldsWaitsOnWhoWrote(sessionId, unread, { routings, raised }, workOut),\n",
          "        (status === 'waiting_permission' && theirs === undefined),\n")],
    ),
    (
        "M12 · a helper that asked its giver about the piece reads \"needs you\" rather than the "
        f"answer it waits on · killed by `{OWES}`",
        [(HOST,
          "    return composeWhatEachPieceIsWaitingOn(\n      waits,\n      this.oneWaitReadPerAnswer(unread, () => itsLedger, workOut),\n    ).some((piece) => piece.state === 'waiting-on-the-person-who-wrote')\n",
          "    return waits.some((piece) => piece.state === 'waiting-on-the-person-who-wrote')\n")],
    ),
    (
        "M13 · the person's list and count hold a piece whose helper waits on its giver's answer, "
        f"asking the person for a reply that is not theirs · killed by `{OWES}`",
        [(STORE,
          # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 4a94d5ed replaced the inline state filter with the shared waitsOnWhoWrote guard; the plant still drops the composition, so a helper waiting on its giver's answer stays on the person's list and count.
          "          composeWhatEachPieceIsWaitingOn(\n            piecesWaitingOnWhoWroteIn(sessionId, noteSkip),\n            itsWaits,\n          ).filter(waitsOnWhoWrote),\n",
          "          piecesWaitingOnWhoWroteIn(sessionId, noteSkip),\n")],
    ),
    (
        "M14 · a conversation's pieces waiting on the person are read once and kept after its ledger "
        f"grows, so a new wait or a drive is never seen · killed by `{OWES}`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. b7b59d1c7 moved personal-wait caching into a shared fold helper. Cache only the personal-wait answer once per owner, without modifying the helper for unrelated folds. Preserve counted unread-row and transaction safeguards. The pre-move waitingOnWhoWroteBy map had no invalidation sites; its unconditional kept return also ignored later local writes and generation changes.
            ("apps/desktop/src/main/db/session-store.ts", "  const waitingOnWhoWrote = keptUntilItsLedgerGrows((owner, noteSkip) =>\n    piecesOfSession(owner, noteSkip).filter(waitsOnWhoWrote),\n  )\n", "  const waitingOnWhoWrote = (() => {\n    const read = keptUntilItsLedgerGrows((owner, noteSkip) =>\n      piecesOfSession(owner, noteSkip).filter(waitsOnWhoWrote),\n    )\n    const once = new Map<string, ReturnType<typeof read>>()\n    return (owner: string, noteSkip?: SkipNote): ReturnType<typeof read> => {\n      const held = once.get(owner)\n      if (!db.inTransaction && held !== undefined) return held\n      let readEveryRow = true\n      const answer = read(owner, (ordinal) => {\n        readEveryRow = false\n        noteSkip?.(ordinal)\n      })\n      if (!db.inTransaction && readEveryRow) once.set(owner, answer)\n      return answer\n    }\n  })()\n"),
        ],
    ),
    (
        "M15 · a conversation whose \"needs you\" the ledger holds is never stopped when idle, and "
        f"keeps its provider process until the person acts · killed by `{QUIET}`",
        [(HOST,
          "      this.startsInFlight.has(conversation) ||\n      this.arrivals.has(conversation)\n    ) {\n",
          "      this.startsInFlight.has(conversation) ||\n      this.arrivals.has(conversation) ||\n      state.is === 'needs-you'\n    ) {\n")],
    ),
    (
        "M16 · a read of the work waiting on a reply that failed is drawn as nothing waiting, not "
        f"as a list that could not be read · killed by `{REPLY}`",
        [(QUEUE,
          # ⚑ **W4.584 · re-anchored in place, not retired** — the stopped-work view reads its failed look with the same line, so the anchor takes the reply view's next lines; the plant still draws a failed read of the work waiting on a reply as nothing waiting
          "  if (walked === null) return lastLookAnswered ? null : { rows: [], unread: true }\n  return {\n    unread: !lastLookAnswered,\n",
          "  if (walked === null) return null\n  return {\n    unread: !lastLookAnswered,\n")],
    ),
    (
        "M17 · the corner's count leaves out the work waiting on the person's reply · killed by "
        f"`{REPLY}`",
        # ⚑ **W4.506 · re-anchored in place, not retired** — the corner also counts the agents' requests to register an MCP server; the plant still leaves out the work waiting on the person's reply. NOT VERIFIED
        [(QUEUE,
          # ⚑ **what waits on a person · re-anchored in place, not retired** — the corner also counts the to-dos agents asked of a person; the plant still leaves out the work waiting on the person's reply
          "  const count = (view?.count ?? 0) + asked + owed + requested + todo\n",
          "  const count = (view?.count ?? 0) + asked + requested + todo\n")],
    ),
    (
        "M18 · a conversation asks its provider for the profile's sign-in with no refusal on screen "
        f"· killed by `{RENEWED}`",
        [(PANE,
          "    if (signIn === null || (error === null && !refused)) return\n",
          "    if (signIn === null) return\n")],
    ),
    (
        "M19 · a conversation and its agent card each hold a sign-in of their own, so the card never "
        f"shows the expiry the conversation learned · killed by `{RENEWED}`",
        [(SIGN_IN,
          "  if (known) return known\n",
          "")],
    ),
    (
        "M20 · a jump to a compaction from the Context popup leaves the popup over the transcript "
        f"· killed by `{POPUP}`",
        [(PANEL,
          "            agent.contextDialogOpen.value = false\n            emit('navigate', itemId)\n",
          "            emit('navigate', itemId)\n")],
    ),
]
