import { type AConversation } from '../../../shared/last-exchange'
import { type AgentCard } from '../agent-directory'
import { type RootOnTheBoard } from '../work-records'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import {
  handedBackWithItsAnswer,
  heldBy,
  itsInputs,
  theHolderIsNow,
  whatWasMadeForIt,
} from '../agent-tool-answer-words'
import { pieceLine } from '../../../shared/piece-called'
import { type PieceRow, type StatusLine } from '../../../shared/task-contracts'
import {
  READ_ONE_WITH_READ_DOCUMENT,
  resourcesNamed,
  theAskNamed,
  theLimitItStoppedOn,
  theStallAndItsAsk,
  theStoppedWork,
} from '../reply-rails'
import { type ToolName } from './catalog'
import { TASK_IS_OPEN, WAITING_STANDS_FOR, theWaitIn } from '../../../shared/tasks'
import {
  type WhatToCallItUnder,
  countedBy,
  countsSaid,
  listedOf,
  namedByItsWorkOnce,
  skippedRecordsSentence,
  theListingAsked,
  unreadRowsSentence,
  whenSkipped,
} from './listings'
import { agentStateWords } from '../../../shared/agent-state'
import { answer, refusalAnswer } from './answers'
import { refuseTool } from './refusals'
import { clockTime } from '../../../shared/clock'
import { type readerFields } from './reader-inputs'
import { receivedPayload, transcriptText, wordsPayload } from './documents'
import { theStopOnAPerson, whoseText } from './directory'

const piecePayload = (
  piece: PieceRow,

  givenToIs: AgentCard['state'] | null,
  /** Why what is held for its holder waits — a reopen on the current sign-in, or (F074) its provider's usage limit; beside its stop on a person's answer, only what else holds it — or `null` ({@link AgentToolHost.whyWhatIsHeldWaits}). */
  heldBecause: string | null,
  /** What its holder's turn is stopped on until a person answers it, as its card says it. */
  stoppedOnAPerson: AgentCard['stoppedOnAPerson'],
): Readonly<Record<string, unknown>> => ({
  piece: piece.piece,
  ...(piece.definitionOfDone === undefined ? {} : { definition_of_done: piece.definitionOfDone }),
  label: piece.label,
  title: piece.title,
  state: piece.state,
  stalled_because: piece.stalledBecause,
  // **484 · the moment, so two readings of two turns cannot look like one contradiction** — see
  // {@link PieceRow.stalledAt}. Null exactly when `stalled_because` is.
  stalled_at: piece.stalledAt,
  // **484 · who ASKED the turn it stalled in to stop** (HO-029 §2.1) — on `turn_interrupted` and,
  // since `720` (R72), on `turn_ended`: a turn asked to stop that the provider finished anyway.
  // **724 · PM ruling R82 — the key says what it holds**: *"`stalled_by` names who ASKED the turn
  // to stop, not who stalled it"*. The ASKER, never whoever ended the turn; the cause beside it
  // says that. Null is *no row says* and never a fourth actor — see {@link PieceRow.stalledBy}.
  asked_to_stop_by: piece.stalledBy,
  // **D-017 · R11 — in the one derivation's words**, as `get_agent_status` says them.
  given_to_is: givenToIs === null ? null : agentStateWords(givenToIs),
  // Why words held for its holder wait, while the piece is open and they do.
  ...(heldBecause === null ? {} : { held_because: heldBecause }),
  // What its holder's turn is stopped on until a person answers it, while it is.
  ...(stoppedOnAPerson === null ? {} : { stopped_on_a_person: stoppedOnAPerson }),
  // **D-013 · what still runs in the background for it** (plan §3.7) — present only while it holds
  // the work: a giver can tell a build from a server that never ends.
  ...(piece.inTheBackground === undefined ? {} : { in_the_background: piece.inTheBackground }),
  // Queued at a service: how many pieces are ahead of it.
  ...(piece.queuedBehind === undefined ? {} : { queued_behind: piece.queuedBehind }),
  ...(piece.queueStalledAt === undefined ? {} : { queue_stalled_at: piece.queueStalledAt }),
  ...(piece.queueWaitsForServices === true ? { queue_waits_for_services: true } : {}),
  // What it waited on in the background when its stop took that with it — only on a stall.
  ...(piece.state === 'stalled' && (piece.stoppedInTheBackground ?? []).length > 0
    ? { stopped_in_the_background: piece.stoppedInTheBackground }
    : {}),
  question_lost_at_restart: piece.questionLostAtRestart,
  // **D-016 · commit 6 · `null`: a person gave it** — work its owner took on for them.
  giver: piece.giver,
  owner: piece.owner,
  // **D-016 · its current status line** — the newest a giver or an owner set, or its reply's
  // summary: who said it, and when.
  status_line: statusLinePayload(piece.statusLine),
  outcome: piece.outcome,
  // **719 · R70 — the answer's own words**, so a giver reading its piece here finds what the
  // delivery could not bring — the place `reply_to_parent`'s `not-delivered` answer names (D-030);
  // see {@link PieceRow.summary}. **724 · R84 — and ONLY there**: an answer this app recorded as
  // reaching nobody ({@link PieceRow.answerReachedNobody}).
  // Every other row carries no `summary` key at all — the words cost up to 1,280 units a row
  // (`719` F-5). **729 · R89 — "lost is lost, whatever lost it"**: an answer HELD for a busy giver
  // and then lost is recorded the same way (`RuntimeHost.recordAnAnswerItsGiverNeverGot`), so its
  // row carries the words too.
  ...(piece.answerReachedNobody ? { summary: piece.summary } : {}),
  ...(piece.savedMethod === undefined ? {} : { saved_method: piece.savedMethod }),
  resources: piece.resources,
  needs_user_action: piece.needsUserAction,
  given_at: piece.givenAt,
  ended_at: piece.endedAt,
})

/** **D-016 · a status line as a payload carries it** — `null` while nobody has set one. */
const statusLinePayload = (line: StatusLine | null): Readonly<Record<string, unknown>> | null =>
  line === null ? null : { text: line.text, by: line.by, at: line.at }

const pieceText = (
  piece: PieceRow,
  givenToIs: AgentCard['state'] | null,
  /**
   * **724 · `720` F-C — who asked, named** — {@link theStallAndItsAsk}'s `whatToCall` — F033 ·
   * by its piece on this piece's chain.
   */
  whatToCall: WhatToCallItUnder,
  /**
   * **729 · PM ruling R90 — the conversation this line is FOR** — the caller, `me`: an ask it made
   * itself is said as its own act ({@link theAskNamed}'s `reader`), never by its own name.
   */
  reader: string,
  /** Why what is held for its holder waits — a reopen on the current sign-in, or (F074) its provider's usage limit; beside its stop on a person's answer, only what else holds it — or `null` ({@link AgentToolHost.whyWhatIsHeldWaits}). */
  heldBecause: string | null,
  /** What its holder's turn is stopped on until a person answers it, as its card says it. */
  stoppedOnAPerson: AgentCard['stoppedOnAPerson'],
  /**
   * Who holds it, by name — `null` for a piece the reader holds itself.
   */
  heldByName: string | null,
): string => {
  const wait = theWaitIn(piece.state)
  return `  ${pieceLine(piece.label, piece.title)} · ${piece.state}${
    wait !== null
      ? ` (${WAITING_STANDS_FOR[wait]})`
      : piece.stalledBecause === null
        ? // **D-013 · working in the background, and on what** (plan §3.7).
          piece.inTheBackground === undefined
          ? ''
          : ` (in the background: ${piece.inTheBackground.join('; ')})`
        : // **720 · R72 — the same two facts the pushed notice says** (`theStallAndItsAsk`).
          // **D-017 · R11 — the history, for every cause**: what the owner is doing NOW is
          // `given_to_is`, the one state, beside it — never a second, process-shaped reading of it
          // here.
          // **F074 — and the usage limit its turn ended on**, with its reset, as the notice says it.
          ` (${theStallAndItsAsk(
            piece.stalledBecause,
            theAskNamed(piece.stalledBy, (asker) => whatToCall(asker, piece.piece), reader),
            theLimitItStoppedOn(piece),
            piece.stoppedOnALogin,
          )}${
            // And what it waited on in the background, when its stop took that with it.
            piece.state === 'stalled' && (piece.stoppedInTheBackground ?? []).length > 0
              ? `; ${piece.stalledBecause === 'background_stopped' ? 'that was' : 'it was waiting on'} ${theStoppedWork(piece.stoppedInTheBackground ?? [])}`
              : ''
          })`
  }${heldByName === null ? '' : ` · ${heldBy(heldByName)}`}${
    // On a stall, what its holder is doing now; *needs you* is said by the clause below.
    piece.state === 'stalled' && givenToIs !== null && givenToIs.is !== 'needs-you'
      ? ` · ${theHolderIsNow(agentStateWords(givenToIs))}`
      : ''
  }${
    // **491 · the subject is the OWNER'S CONVERSATION, never this piece.** One conversation can
    // hold historical work as well as the piece whose turn raised today's card; calling every row
    // *"frozen"* turns a true conversation-wide state into a false piece-specific claim.
    // Closed history gets no live-condition clause. On open work the subject is spelled out,
    // and *needs you* remains the only exceptional state worth printing.
    // **F097 · "on a person", not "for a person's decision"**: a person's words it answered are
    // one of the things it can wait on, and they are no decision.
    TASK_IS_OPEN[piece.state] && givenToIs?.is === 'needs-you'
      ? ` · the conversation holding it is waiting on a person${theStopOnAPerson(stoppedOnAPerson)}`
      : ''
  }${heldBecause === null ? '' : ` · what is held for the conversation holding it waits: ${heldBecause}`}${
    piece.queuedBehind === undefined
      ? ''
      : piece.queueWaitsForServices === true
        ? ' · queued; it waits until services are on'
        : piece.queuedBehind === 0
          ? ' · queued; next in line'
          : ` · queued behind ${String(piece.queuedBehind)}${
              piece.queueStalledAt === undefined
                ? ''
                : `; the active piece stalled at ${clockTime(piece.queueStalledAt)}`
            }`
  }${piece.questionLostAtRestart ? ' · a question of its own was lost at a restart' : ''}${
    piece.outcome === null ? '' : ` · ${piece.outcome}`
  } · ${piece.statusLine?.text ?? piece.brief.split('\n')[0] ?? ''}${piece.definitionOfDone === undefined ? '' : `\n  Done when: ${piece.definitionOfDone ?? 'Not recorded'}`}`
}

/**
 * **D-016 · a root on `list_tasks`' board** — its label, its title and its status line, and no
 * state: a root's state is its conversation's, which `get_agent_status` says (R1). **D-024 · R2 —
 * whose it is, for the conversation this line is FOR**: its own, or another conversation of its
 * profile's, which `list_tasks` naming it reads too.
 */
const rootText = (root: RootOnTheBoard, reader: string): string =>
  `  ${pieceLine(root.label, root.title)} · ${
    root.owner === reader
      ? 'your own work, from a person'
      : 'work a person gave another conversation of your profile'
  }${root.statusLine === null ? '' : ` · ${root.statusLine.text}`}\n  Done when: ${root.definitionOfDone ?? 'Not recorded'}`

/** **D-016 · a root as a payload carries it** — no state, for {@link rootText}'s reason. */
const rootPayload = (root: RootOnTheBoard): Readonly<Record<string, unknown>> => ({
  piece: root.piece,
  label: root.label,
  title: root.title,
  definition_of_done: root.definitionOfDone ?? null,
  status_line: statusLinePayload(root.statusLine),
  root: true,
})

/** How a piece that is over ended, as a count says it: how its holder said it went, else its state. */
const howAPieceEnded = (piece: PieceRow): string =>
  TASK_IS_OPEN[piece.state] ? 'open' : (piece.outcome ?? piece.state)

/**
 * Why a piece that is over is still its giver's to read: its answer reached no conversation, so its
 * words are on the piece and nowhere else, or it is held for the giver and has not yet gone into one
 * of its turns. Such a piece is listed whole, in every listing: nothing else tells its giver to
 * look. An answer that reached nobody stays so for good, and so does its listing.
 */
type AnswerNotRead = 'reached-nobody' | 'held-for-you'

const ANSWER_NOT_READ_SAID: Readonly<Record<AnswerNotRead, string>> = {
  'reached-nobody': 'its answer reached no conversation, and its words are here',
  'held-for-you': 'its answer is held for you and has not reached you yet',
}

/**
 * A piece that is over, as a board lists it: one line, and no words of its answer — but the two
 * things about it a giver may still have to act on: a person has to move, as its holder said, and a
 * question of its own was lost at a restart.
 */
const endedPieceText = (piece: PieceRow): string =>
  `  ${pieceLine(piece.label, piece.title)} · ${piece.state}${
    piece.outcome === null ? '' : ` · ${piece.outcome}`
  }${piece.endedAt === null ? '' : ` · ended ${clockTime(piece.endedAt)}`}${
    piece.needsUserAction ? ' · its holder said a person has to act' : ''
  }${piece.questionLostAtRestart ? ' · a question of its own was lost at a restart' : ''}`

/** {@link endedPieceText}'s facts, as a payload carries them; its record holds the rest. */
const endedPiecePayload = (piece: PieceRow): Readonly<Record<string, unknown>> => ({
  piece: piece.piece,
  label: piece.label,
  title: piece.title,
  state: piece.state,
  outcome: piece.outcome,
  ended_at: piece.endedAt,
  ...(piece.needsUserAction ? { needs_user_action: true } : {}),
  ...(piece.questionLostAtRestart ? { question_lost_at_restart: true } : {}),
})

const HOW_TO_LIST_MORE_PIECES =
  'list_tasks takes state — open, ended or all — and limit, which is how many ended pieces it lists, newest first; naming a piece reads its whole record.'

export function createListTasksTool(
  host: Pick<
    AgentToolHost,
    | 'agentCard'
    | 'answersHeldFor'
    | 'madeByItsProfile'
    | 'nameByItsWorkUnder'
    | 'pieceBoard'
    | 'pieceRecord'
    | 'whatToCallTheConversation'
    | 'whenItWasArchived'
    | 'whyWhatIsHeldWaits'
  >,
  by: Caller,
  me: string,
  readerInputs: ReturnType<typeof readerFields>['readerInputs'],
  readerFieldRefusal: ReturnType<typeof readerFields>['readerFieldRefusal'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'list_tasks',
    handlerOwnsMissingInput: true,
    description:
      'Your pieces of work: named, one piece’s record — its state, current status line, the last exchange with the agent holding it, its open questions, its children and its resources — the inputs it was given and what was made for it; unnamed, your board — the open pieces you hold (your own root among them) and gave: waiting, working or stalled, and any you gave whose answer has not reached you. An open piece an archived conversation holds is named in one line and not listed. The ones that ended are counted and not listed: state: "all" lists them too and "ended" only them, a line each, newest first and as many as limit says; name one to read its record. A piece another conversation of your profile holds or gave can be named too. Labels (W1.2) and ids both name a piece. made: true lists instead the files your profile’s conversations made.',
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **The caller's own work**: a piece it holds or gave, **or one a conversation of its
     * own profile holds or gave** (D-024 · R2), and nothing else — the host's lookup is the
     * entitlement, and a piece it may not read is `no-piece-by-that-name`. **D-024 · R3 —
     * `made`** lists the files its profile's conversations made; each is readable by its id with
     * `read_document`.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries(readerInputs.list_tasks).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        const named = args.piece
        if (named !== undefined && (typeof named !== 'string' || named.length === 0)) {
          return readerFieldRefusal('list_tasks', args, [
            'piece, when given, must be a label or an id',
          ])!
        }
        const made = args.made
        if (made !== undefined && typeof made !== 'boolean') {
          return readerFieldRefusal('list_tasks', args, [
            'made, when given, must be true or false',
          ])!
        }
        if (made === true && named !== undefined) {
          return readerFieldRefusal('list_tasks', args, [
            'made and piece cannot be given together',
          ])!
        }
        const asked = theListingAsked(args.state, args.limit)
        if ('problems' in asked) {
          return readerFieldRefusal('list_tasks', args, asked.problems)!
        }
        if (
          (args.state !== undefined || args.limit !== undefined) &&
          (named !== undefined || made === true)
        ) {
          return readerFieldRefusal('list_tasks', args, [
            'state and limit are for the board: they cannot be given with piece or made',
          ])!
        }
        const fieldRefusal = readerFieldRefusal('list_tasks', args)
        if (fieldRefusal !== null) return fieldRefusal
        if (made === true) {
          // **D-024 · R3 — what this conversation's profile made**, newest first, each with the
          // piece it was kept on and when; the rest counted. Named by its id, which
          // `read_document` takes, and its file's name — a resource's one address.
          const listed = host.madeByItsProfile(me)
          if (listed.is === 'no-profile') {
            return answer(
              { outcome: 'ok', made: [], more: 0 },
              'this app cannot name the profile this conversation runs as, so it lists no files',
            )
          }
          return answer(
            {
              outcome: 'ok',
              made: listed.made.map((one) => ({
                resource: one.resource.resource,
                name: one.resource.name,
                title: one.resource.title,
                piece: one.resource.piece,
                label: one.label,
                piece_title: one.title,
                kept_at: one.resource.createdAt,
              })),
              more: listed.more,
            },
            listed.made.length === 0
              ? 'your profile has made no files'
              : [
                  [
                    'files your profile made, newest first:',
                    // **D-026 · a title is said only when the name does not already say it**:
                    // a file with no heading is titled by its name, which `res_… (name)` says.
                    ...listed.made.map(
                      (one) =>
                        `  ${resourcesNamed([one.resource])}${
                          one.resource.title === null || one.resource.title === one.resource.name
                            ? ''
                            : ` · ${one.resource.title}`
                        } — on ${pieceLine(one.label, one.title)}, ${clockTime(one.resource.createdAt)}`,
                    ),
                  ].join('\n'),
                  // **The rest counted, and where they are**: a file older than these is on the
                  // record of the piece it was kept on, and nowhere else.
                  ...(listed.more === 0
                    ? []
                    : [
                        `${listed.more === 1 ? '1 older one is' : `${String(listed.more)} older ones are`} not listed: find_files finds them, or list_tasks naming the piece one was kept on.`,
                      ]),
                  READ_ONE_WITH_READ_DOCUMENT,
                ].join('\n\n'),
          )
        }
        /**
         * **724 · `720` F-C — the name of each conversation that asked a turn to stop**, once
         * per asker per call — the words the pushed notice uses ({@link theStallAndItsAsk}).
         * **D-016 · commit 7 · R3 — by the piece each owns** ({@link namedByItsWorkOnce}):
         * nothing on the line names the asker, nor the senders a record quotes.
         */
        const called = namedByItsWorkOnce(host)
        /**
         * **484 · what the conversation holding a row is doing now** — memoised per id, and
         * asked through {@link AgentToolHost.agentCard} so the disclosure is EXACTLY
         * `get_agent_status`'s and cannot be a second opinion about reach.
         *
         * **`null` when the card reader has no visible card** — this caller may not be told about
         * that conversation. It is the same absence `list_agents` gives, arrived at through the same
         * door. Asked here rather than in the host: the fold has no business knowing what is
         * live, and a `PieceRow` that carried a live field would be a derivation that is not a
         * function of its ledger.
         */
        const seen = new Map<string, AgentCard | null>()
        const cardOf = (row: PieceRow): AgentCard | null => {
          const held = seen.get(row.owner)
          if (held !== undefined) return held
          const card = host.agentCard(row.owner, by, me) ?? null
          seen.set(row.owner, card)
          return card
        }
        const ownerIs = (row: PieceRow): AgentCard['state'] | null => cardOf(row)?.state ?? null
        const ownerFacts = (row: PieceRow): Readonly<Record<string, unknown>> => {
          const card = cardOf(row)
          if (card === null) return {}
          return {
            owner: card.agent,
            ...(card.whose.is === 'an-identity-this-app-holds'
              ? { profile: card.whose.profile, name: card.whose.name }
              : {}),
          }
        }
        const ownerWords = (row: PieceRow): string => {
          const card = cardOf(row)
          return card?.whose.is === 'an-identity-this-app-holds'
            ? ` · ${whoseText(card.whose)}`
            : ''
        }
        /**
         * What an open row's holder's turn is stopped on until a person answers it, as its card
         * says it.
         */
        const stopOf = (row: PieceRow): AgentCard['stoppedOnAPerson'] =>
          TASK_IS_OPEN[row.state] && row.owner !== me
            ? (cardOf(row)?.stoppedOnAPerson ?? null)
            : null
        /**
         * **Why what is held for a row's holder waits** — the words a receipt says when it
         * holds something for that conversation ({@link AgentToolHost.whyWhatIsHeldWaits}),
         * memoised per holder, and said only where this caller sees the holder's card. Beside a
         * stop the line already says ({@link stopOf}), only what else holds the words.
         */
        const waits = new Map<string, string | null>()
        const heldBecause = (row: PieceRow): string | null => {
          // A row the caller holds itself is about its own conversation: nothing to say here.
          if (!TASK_IS_OPEN[row.state] || row.owner === me || ownerIs(row) === null) return null
          const known = waits.get(row.owner)
          if (known !== undefined) return known
          const why = host.whyWhatIsHeldWaits(row.owner, stopOf(row) !== null)
          waits.set(row.owner, why)
          return why
        }
        /** Each holder's name, once per call — `null` for what the caller holds. */
        const holders = new Map<string, string>()
        const heldByName = (row: PieceRow): string | null => {
          if (row.owner === me) return null
          const known = holders.get(row.owner)
          if (known !== undefined) return known
          const name = host.whatToCallTheConversation(row.owner)
          holders.set(row.owner, name)
          return name
        }
        const line = (row: PieceRow): string =>
          pieceText(row, ownerIs(row), called, me, heldBecause(row), stopOf(row), heldByName(row))
        const payload = (row: PieceRow): Readonly<Record<string, unknown>> =>
          piecePayload(row, ownerIs(row), heldBecause(row), stopOf(row))
        const unreadLines = (rowsUnread: number, ledgersSkipped: number | undefined): string[] => [
          ...(rowsUnread === 0 ? [] : [unreadRowsSentence(rowsUnread)]),
          ...whenSkipped(ledgersSkipped, skippedRecordsSentence),
        ]
        if (named === undefined) {
          // **No argument names anybody, and no rails.** A conversation is told about its own
          // work, and `me` is minted by this toolset rather than supplied —
          // `RuntimeHost.pieceBoard` says why neither half replaces the other.
          const everyPiece = host.pieceBoard(me)
          // An open piece an archived conversation holds is put away with it: named in one
          // line, and not listed.
          const putAway = everyPiece.gave.filter(
            (row) => TASK_IS_OPEN[row.state] && host.whenItWasArchived(row.owner) !== null,
          )
          const board =
            putAway.length === 0
              ? everyPiece
              : { ...everyPiece, gave: everyPiece.gave.filter((row) => !putAway.includes(row)) }
          const heldForMe = host.answersHeldFor(me)
          /** Why a piece that is over is still this caller's to read, or `null`. */
          const notRead = (row: PieceRow): AnswerNotRead | null => {
            if (TASK_IS_OPEN[row.state]) return null
            if (row.answerReachedNobody) return 'reached-nobody'
            return heldForMe.has(row.piece) ? 'held-for-you' : null
          }
          const listedFrom = (rows: readonly PieceRow[], itsAnswersAreMine: boolean) =>
            listedOf(rows, asked, {
              open: (row) => TASK_IS_OPEN[row.state],
              // Only of the work it GAVE: an answer is its giver's to read.
              kept: (row) => itsAnswersAreMine && notRead(row) !== null,
              endedAt: (row) => row.endedAt,
            })
          const hold = listedFrom(board.hold, false)
          const gave = listedFrom(board.gave, true)
          const whole = (row: PieceRow, flagged: boolean) => {
            const unread = flagged ? notRead(row) : null
            return {
              payload:
                unread === null ? payload(row) : { ...payload(row), answer_not_read: unread },
              // Said before the line's own words, which end on its answer's.
              text:
                unread === null ? line(row) : `  ${ANSWER_NOT_READ_SAID[unread]}:\n${line(row)}`,
            }
          }
          const ended = (row: PieceRow) => ({
            payload: { ...endedPiecePayload(row), ...ownerFacts(row) },
            text: endedPieceText(row) + ownerWords(row),
          })
          const holdRows = [...hold.whole.map((row) => whole(row, false)), ...hold.ended.map(ended)]
          const gaveRows = [...gave.whole.map((row) => whole(row, true)), ...gave.ended.map(ended)]
          // A root has no state: it is its conversation's own work, listed with what is open.
          const root = asked.listing === 'ended' ? null : board.root
          const notListed = {
            you_hold: countedBy(hold.rest, howAPieceEnded),
            you_gave: countedBy(gave.rest, howAPieceEnded),
          }
          /** What a half says when it lists nothing: that it holds none, or none of this kind. */
          const none = (
            any: boolean,
            words: { readonly none: string; readonly open: string; readonly ended: string },
          ): string => {
            if (!any) return words.none
            return asked.listing === 'ended' ? words.ended : words.open
          }
          const rest = [
            ...(hold.rest.length === 0
              ? []
              : [`of the work you hold, ${countsSaid(notListed.you_hold)}`]),
            ...(gave.rest.length === 0
              ? []
              : [`of the work you gave, ${countsSaid(notListed.you_gave)}`]),
          ]
          return answer(
            {
              outcome: 'ok',
              listed: asked.listing,
              you_hold: [
                ...(root === null ? [] : [rootPayload(root)]),
                ...holdRows.map((one) => one.payload),
              ],
              you_gave: gaveRows.map((one) => one.payload),
              // The open pieces you gave that archived conversations hold, by label.
              held_by_archived: putAway.map((row) => row.label),
              // What the lists leave out, counted by how each ended (or `open`, when only the
              // ended ones were asked for). Always present: `{}` says nothing was left out.
              not_listed: notListed,
              // **671 · R18 — the count, IN the payload and not only in a log** (the PM's
              // words). Always present, so `0` is a measurement a model can read.
              rows_unread: board.rowsUnread,
            },
            [
              root === null && holdRows.length === 0
                ? none(board.root !== null || board.hold.length > 0, {
                    none: 'you hold no work',
                    open: 'you hold no open work',
                    ended: 'no work you hold has ended',
                  })
                : [
                    'work you hold:',
                    ...(root === null ? [] : [rootText(root, me)]),
                    ...holdRows.map((one) => one.text),
                  ].join('\n'),
              ...(gaveRows.length > 0
                ? [['work you gave:', ...gaveRows.map((one) => one.text)].join('\n')]
                : // The line about what is put away says it, when open work you gave is.
                  putAway.length > 0 && asked.listing !== 'ended'
                  ? []
                  : [
                      none(board.gave.length > 0, {
                        none: 'you have not given anybody work',
                        open: 'no work you gave is open',
                        ended: 'no work you gave has ended',
                      }),
                    ]),
              ...(rest.length === 0
                ? []
                : [`not listed: ${rest.join('; ')}. ${HOW_TO_LIST_MORE_PIECES}`]),
              ...(putAway.length === 0
                ? []
                : [
                    `put away with archived conversations, and not listed: ${putAway
                      .map((row) => row.label)
                      .join(
                        ', ',
                      )}. Name one to read its record; list_agents with archived: true names the conversations.`,
                  ]),
              ...unreadLines(board.rowsUnread, board.ledgersSkipped),
            ].join('\n\n'),
          )
        }
        const record = host.pieceRecord(me, named)
        if (record.is === 'no-piece-by-that-name') {
          return refusalAnswer(refuseTool('no-piece-by-that-name', { piece: named }))
        }
        const childPayload = (row: PieceRow): Readonly<Record<string, unknown>> => ({
          ...ownerFacts(row),
          piece: row.piece,
          label: row.label,
          title: row.title,
          state: row.state,
          status_line: statusLinePayload(row.statusLine),
        })
        const children =
          record.children.length === 0
            ? []
            : [
                'pieces given under it:',
                ...record.children.map((row) => line(row) + ownerWords(row)),
              ]
        // **D-023 · R1 — a root's resources are listed as any piece's are**, with their roles.
        const resources = record.resources.map((one) => ({
          resource: one.resource,
          name: one.name,
          role: one.role,
          bytes: one.bytes,
          sha256: one.sha256,
          title: one.title,
          summary: one.summary,
        }))
        /**
         * Its resources by what each is to it: the inputs it was handed, what was made for it, and
         * what its answer handed back (the reply's ids, {@link PieceRow.resources}).
         */
        const resourcesByRole = (handedBack: readonly string[]): string[] => {
          if (record.resources.length === 0) return []
          /** `res_… (name)`, {@link resourcesNamed}'s one spelling, a file at a time. */
          const fileNamed = (one: (typeof record.resources)[number]): string =>
            resourcesNamed([one])
          const back = new Set(handedBack)
          const inputs = record.resources.filter((one) => one.role === 'input')
          const answered = record.resources.filter(
            (one) => one.role !== 'input' && back.has(one.resource),
          )
          const made = record.resources.filter(
            (one) => one.role !== 'input' && !back.has(one.resource),
          )
          return [
            [
              ...(inputs.length === 0 ? [] : [itsInputs(inputs.map(fileNamed))]),
              ...(made.length === 0 ? [] : [whatWasMadeForIt(made.map(fileNamed))]),
              ...(answered.length === 0 ? [] : [handedBackWithItsAnswer(answered.map(fileNamed))]),
              READ_ONE_WITH_READ_DOCUMENT,
            ].join(' '),
          ]
        }
        if (record.is === 'a-root') {
          // **R1 — a root is its title, its status line, its children and its resources**: its
          // state is its conversation's, which `get_agent_status` says.
          return answer(
            {
              outcome: 'ok',
              ...rootPayload(record.root),
              owner: record.root.owner,
              children: record.children.map(childPayload),
              resources,
              rows_unread: record.rowsUnread,
            },
            [
              rootText(record.root, me).trimStart(),
              ...(children.length === 0 ? [] : [children.join('\n')]),
              ...resourcesByRole([]),
              ...unreadLines(record.rowsUnread, record.ledgersSkipped),
            ].join('\n\n'),
          )
        }
        const piece = record.piece
        const nameOf = (who: AConversation): string => called(who.conversation, who.about ?? null)
        return answer(
          {
            outcome: 'ok',
            ...payload(piece),
            brief: piece.brief,
            // **D-012 · the last exchange with the conversation holding it, whole** — the
            // `read_transcript` shape.
            last_exchange: {
              received:
                record.lastExchange.received === null
                  ? null
                  : receivedPayload(record.lastExchange.received),
              answer:
                record.lastExchange.answer === null
                  ? null
                  : wordsPayload(record.lastExchange.answer),
              ...(record.lastExchange.sinceThenItsProviderStartedATurn === true
                ? { since_then_its_provider_started_a_turn: true }
                : {}),
            },
            open_questions: record.openQuestions,
            children: record.children.map(childPayload),
            resources,
            rows_unread: record.rowsUnread,
          },
          [
            line(piece).trimStart(),
            `Its brief:\n${piece.brief}`,
            // **D-016 · commit 7 · R3 — its holder by its NAME**: the piece names the conversation.
            transcriptText(
              host.whatToCallTheConversation(piece.owner),
              record.lastExchange,
              [],
              false,
              nameOf,
            ),
            ...(record.openQuestions.length === 0
              ? []
              : [
                  `Questions its owner asked about this piece that are still open: ${record.openQuestions.join(', ')}.`,
                ]),
            ...(children.length === 0 ? [] : [children.join('\n')]),
            ...resourcesByRole(piece.resources),
            ...unreadLines(record.rowsUnread, record.ledgersSkipped),
          ].join('\n\n'),
        )
      }),
  }
}
