import { type AConversation, previewOf } from '../../../shared/last-exchange'
import { ASKED_TO_STOP, type WhoStoppedIt, askedByClause } from '../../../shared/how-work-stopped'
import { type AgentCard, type PieceOnTheCard, type WhoseConversation } from '../agent-directory'
import { type AgentRecord } from '../host-split/host-command-contracts'
import { type ProfileReport } from '../agent-records'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { CONVERSATIONS_LISTED } from '../agent-directory'
import { type Caller } from '../conversation-caller'
import { EVERY_AGENT_THIS_APP_HOLDS } from '../../../shared/capabilities'
import {
  HOW_A_PIECE_ENDED_SAID,
  type WorkThatNamesIt,
  pieceLine,
  theOwnerOf,
} from '../../../shared/piece-called'
import {
  HOW_THE_LAST_TURN_ENDED,
  lastAskedToStop,
  windowsReported,
} from '../agent-tool-answer-words'
import { PROVIDER_NAME, type ProviderUsageReading } from '../../../shared/runtime-ipc'
import { type Provider } from '@brobot2/shared'
import { READ_ONE_WITH_READ_DOCUMENT, resourcesNamed } from '../reply-rails'
import { type ToolName } from './catalog'
import { WHEN_THE_ASK_LANDED, outOfReachAnswer } from './delivery'
import { aPairInWords, sameModel } from '../../../shared/model-choice'
import { agentStateWords } from '../../../shared/agent-state'
import { answer, refusalAnswer } from './answers'
import { clockTimeFrom } from '../../../shared/clock'
import { fromClause, receivedPayload } from './documents'
import {
  namedByItsWorkOnce,
  skippedRecordsSentence,
  unreadRowsSentence,
  whenSkipped,
} from './listings'
import { type readerFields } from './reader-inputs'
import { refuseTool } from './refusals'
import { usagePeriod } from '../../providers/usage-period'
import { z } from 'zod'

/**
 * **What a line says about a conversation this app cannot attribute** (610) — a constant,
 * because `a-safety-sentence-with-no-test-is-a-comment` and a test pins this clause by name.
 */
export const THIS_APP_CANNOT_NAME_IT = 'an agent this app cannot name'

export const whoseText = (whose: WhoseConversation): string => {
  if (whose.is !== 'an-identity-this-app-holds') return THIS_APP_CANNOT_NAME_IT
  return whose.name === whose.profile ? whose.profile : `${whose.name} (${whose.profile})`
}

/**
 * What a conversation's turn is stopped on until a person answers it, and that nothing sent to it
 * goes in before then — so a giver tells the person rather than sending it more. The card's line
 * and `list_tasks`' line say it in these words.
 */
export function theStopOnAPerson(stopped: AgentCard['stoppedOnAPerson']): string {
  return stopped === null
    ? ''
    : ` (its turn is stopped until a person answers ${stopped.asks}, asked at ${clockTimeFrom(stopped.since, stopped.readAt)}, under Waiting on you; nothing sent to it goes in until then)`
}

/**
 * Who archived a conversation, as a listing says it. Only a person's window archives one, so it is
 * always a person.
 */
const ARCHIVED_BY = 'a person'

/** That a conversation is archived, since when, and by whom: said after its card. */
const archivedSaid = (archivedAt: number, readAt: number): string =>
  ` · archived ${clockTimeFrom(archivedAt, readAt)} by ${ARCHIVED_BY}`

const cardText = (card: AgentCard): string =>
  // **D-016 · commit 7 · R3 — a conversation is named by the piece it owns**
  // (`the owner of W1.2 · Build the pages`), and its agent's name follows; its id only when it
  // holds no piece — the one address it then has. The payload carries the ids.
  // **D-017 · R11 — the state in the one derivation's words** (`agentStateWords`), the words the
  // window draws: never whether a process runs.
  `${card.named === null ? card.agent : theOwnerOf(card.named)} · ${whoseText(card.whose)} · ${card.provider === null ? 'provider not recorded' : PROVIDER_NAME[card.provider]} · ${agentStateWords(card.state)}` +
  theStopOnAPerson(card.stoppedOnAPerson) +
  // **D-042 · R6 — what it runs on**, so a giver can check what its helper runs.
  runsOnText(card) +
  // **W4.209 · who started it, by the piece it started it from** — the record's and the launch
  // line's words (`AgentCard.parentCalled`), never by the starter's work now.
  `${card.parentCalled === null ? '' : ` · started by ${card.parentCalled}`}` +
  // **D-016 · the pieces it holds** (spec D17) — its root, then its open pieces with their states.
  (card.pieces.length === 0 ? '' : ` · holds ${card.pieces.map(pieceOnTheCardText).join(', ')}`) +
  // **676 · F3 — said on the line, where both readers of a card read it** (`AgentCard.rowsUnread`):
  // above `0`, its last ending and its last ask to stop may be older than the truth. Nothing on
  // a clean card, so the ordinary line is unchanged.
  (card.rowsUnread === 0
    ? ''
    : ` · ${String(card.rowsUnread)} ${card.rowsUnread === 1 ? 'row' : 'rows'} of its record could not be read`) +
  // **D-017 · R8** — and when its whole record could not be read, its two past fields say nothing.
  (card.ledgersSkipped === 0 ? '' : ' · its record could not be read')

/**
 * **D-042 · R6 — what a conversation runs on, on its card's line**: ` · on “opus” at max effort`,
 * marked *(requested)* where its provider has reported no effort (Claude, until a turn ends), and —
 * when its provider last reported something else (an alias's target, a reroute) — what it
 * reported. `''` for a conversation nothing has named a pair for yet.
 */
const runsOnText = (card: AgentCard): string => {
  const { selected, reported } = card.runsOn
  if (selected === null) return ''
  const requested = reported === null || reported.effort === null ? ' (requested)' : ''
  const effort = selected.effort === null ? '' : ` at ${selected.effort} effort${requested}`
  const differs =
    reported !== null &&
    (!sameModel(reported.model, selected.model) ||
      (reported.effort !== null && reported.effort !== selected.effort))
  const by = card.provider === null ? 'its provider' : PROVIDER_NAME[card.provider]
  const lastSaid =
    reported === null || !differs
      ? ''
      : `, which ${by} last reported as “${reported.model}”${reported.effort === null ? '' : ` at ${reported.effort}`}`
  return ` · on “${selected.model}”${effort}${lastSaid}`
}

/**
 * **When a conversation's last turn ran, whether anything has started since, and what opened it**
 * — the start of its words a paragraph of their own, as a notice previews them. `[]` when no turn
 * has ended.
 */
const theLastTurnSaid = (
  turn: AgentCard['lastEndedTurn'],
  { took, readAt }: ReturnType<AgentToolHost['whatOpenedItsLastTurn']>,
  named: (who: AConversation) => string,
  /** Who asked a stop, as the `, by …` clause; `''` when no row says. */
  askedBy: (by: WhoStoppedIt | null, asker: string | null) => string,
  /** The last time anybody asked this conversation to stop, or `null`. */
  lastAsk: AgentCard['lastAskToStop'],
): readonly string[] => {
  // The last ask to stop, always with its time and who asked. Its relation to the last turn is said
  // only when it landed on another turn than the one described below.
  const asked =
    lastAsk === null
      ? []
      : [
          lastAskedToStop(
            `${clockTimeFrom(lastAsk.at, readAt)}${askedBy(lastAsk.by, lastAsk.asker)}`,
            lastAsk.turn === 'the-turn-that-ended-last'
              ? undefined
              : WHEN_THE_ASK_LANDED[lastAsk.turn],
          ),
        ]
  if (turn === null) return asked
  // Who asked the turn to stop, unless the sentence above already names that same ask. Only a turn
  // that was stopped is said to be stopped by them; one that finished or failed anyway had only
  // been asked.
  const itsAsk =
    turn.who === null || lastAsk?.turn === 'the-turn-that-ended-last'
      ? ''
      : turn.how === 'it-was-stopped'
        ? askedBy(turn.who, turn.asker)
        : `; it had been ${ASKED_TO_STOP}${askedBy(turn.who, turn.asker)}`
  // **F080 — a turn its provider began by itself is said so**: no message opened it.
  const ran = `Its last turn${turn.startedByItsProvider === true ? ', which its provider started by itself,' : ''} ran from ${clockTimeFrom(turn.startedAt, readAt)} to ${clockTimeFrom(turn.endedAt, readAt)}; ${HOW_THE_LAST_TURN_ENDED[turn.how]}${itsAsk}; ${
    turn.since === 'nothing-has-started-since'
      ? 'nothing has started since'
      : 'a turn is running now'
  }.`
  if (took === null) return [ran, ...asked]
  const together = took.cameWith?.length ?? 0
  const opened =
    together === 0
      ? `It took a message from ${fromClause(took.from, named)}`
      : `It took ${String(together + 1)} messages delivered together; the last was from ${fromClause(took.from, named)}`
  const words = previewOf(took.words)
  return words === null
    ? [`${ran} ${opened}, whose words this app's record could not read.`, ...asked]
    : [`${ran} ${opened}, which starts:`, words, ...asked]
}

/** **D-016** — `W1 · Plan the trip`, or `W1.2 · Draft the plan (working)` for an open piece. */
const pieceOnTheCardText = (one: PieceOnTheCard): string =>
  `${pieceLine(one.label, one.title)}${one.state === null ? '' : ` (${one.state})`}`

/**
 * **D-017 · R11 — one card as a tool's payload carries it**: every field the card holds, with its
 * state in the one derivation's words ({@link agentStateWords}) — the words its line says and the
 * window draws, and a wake-up's time in this app's local clock rather than an instant a model would
 * have to place in a zone it cannot see.
 */
const cardPayload = (card: AgentCard) => ({ ...card, state: agentStateWords(card.state) })

/** Format supplied display facts, projecting legacy rows through their provider when needed. */
const usageLimitWords = (
  provider: Provider,
  window: string,
  period = usagePeriod(provider, window),
): string | null => {
  const { word, bucketName } = period
  if (word === null) return null
  return bucketName === null || word.endsWith(`(${bucketName})`) ? word : `${word} (${bucketName})`
}

/**
 * **F096 — one provider's usage, by its newest readings, as a model reads it** — *"Claude's
 * usage, by its latest readings: weekly 34% used, resets at 03:00 on 9 October (read at 02:11)"*.
 * Each window in a person's words where this app has one ({@link usageLimitWords}), else the
 * provider's own; a reading whose reset has passed is said in the past, since it was taken before
 * that reset and is no measure of the window now.
 */
const providerUsageText = (
  provider: Provider,
  readings: readonly ProviderUsageReading[],
  readAt: number,
): string => {
  if (readings.length === 0) {
    return `${PROVIDER_NAME[provider]}'s usage: no reading yet — it arrives with its next turn.`
  }
  const windows = readings.map((reading) => {
    const word = usageLimitWords(provider, reading.window, reading.period) ?? reading.window
    const passed = reading.resetsAt !== null && reading.resetsAt <= readAt
    const percent =
      reading.usedPercent === null ? null : `${String(Math.round(reading.usedPercent))}%`
    const said = passed
      ? percent === null
        ? `${word}: how much was used was not said, and its window has reset since`
        : `${word} was ${percent} used before its window reset`
      : `${word} ${percent === null ? 'how much is used not said' : `${percent} used`}${
          reading.resetsAt === null ? '' : `, resets at ${clockTimeFrom(reading.resetsAt, readAt)}`
        }`
    const whose =
      reading.unconfirmed === true
        ? ", before this app last started, so it may be another sign-in's"
        : ''
    return `${said} (read at ${clockTimeFrom(reading.at, readAt)}${whose})`
  })
  return `${PROVIDER_NAME[provider]}'s usage, by its latest readings: ${windows.join('; ')}.`
}

/** **F096 — the same readings as a payload carries them**: numbers, and times as said above. */
const providerUsagePayload = (
  usage: Readonly<Record<Provider, readonly ProviderUsageReading[]>>,
  readAt: number,
) =>
  Object.fromEntries(
    (Object.keys(usage) as Provider[]).map((provider) => [
      provider,
      usage[provider].map((reading) => {
        const limit = usageLimitWords(provider, reading.window, reading.period)
        return {
          window: reading.window,
          ...(limit === null ? {} : { limit }),
          used_percent: reading.usedPercent,
          resets_at: reading.resetsAt === null ? null : clockTimeFrom(reading.resetsAt, readAt),
          reset_since: reading.resetsAt !== null && reading.resetsAt <= readAt,
          read_at: clockTimeFrom(reading.at, readAt),
          ...(reading.unconfirmed === true ? { unconfirmed_for_this_sign_in: true } : {}),
        }
      }),
    ]),
  )

/**
 * **One identity, as the line a person sees** (488).
 *
 * **The slug FIRST and alone when nothing else is known**, because it is the value `give_work`
 * takes and the only part of this line a caller can spend. A display name that is the slug again
 * is dropped rather than doubled — it is what a person typed when they had nothing better, and
 * printing `worker · worker` spends the summary's characters on nothing.
 */
const profileText = (report: ProfileReport): string =>
  [
    report.profile,
    ...(report.displayName === null || report.displayName === report.profile
      ? []
      : [report.displayName]),
    ...(report.provider === null ? [] : [report.provider]),
    // **D-042 · R6 — its default**, what its new conversations start on.
    ...(report.defaultModel === null ? [] : [`default ${aPairInWords(report.defaultModel)}`]),
    ...(report.isAService === true ? ['a service'] : []),
  ].join(' · ')

/**
 * **F009 · an agent's record, as a model reads it** — who it is (the roster's line), how its
 * standing rules begin, its conversations within reach, its newest pieces and the files it made,
 * each list newest first and the rest counted. Each time is placed on a day by `readAt`.
 *
 * **Each conversation by the work that names it** — the address `get_agent_status` and
 * `message_agent` take — or by its id when it holds none; **the caller's own as `you`** (729 ·
 * R90). **Never whether a conversation runs** (`05` rule 5) — `get_agent_status` says what one is
 * doing — but whether it ENDED: could never be reopened, and which took its place. **An open
 * piece is *still open*, never a state word**: the record reads a piece's ending, and the word for an
 * open one is `list_tasks`' and `get_agent_status`', composed with what its holder waits on.
 */
function agentRecordText(record: AgentRecord, me: string | null): string {
  const at = (when: number): string => clockTimeFrom(when, record.readAt)
  /** One of its conversations, by the work that names it, or by its id when it holds none. */
  const theConversation = (conversation: string, named: WorkThatNamesIt | null): string =>
    conversation === me
      ? 'you'
      : named === null
        ? `conversation ${conversation} (it holds no work)`
        : theOwnerOf(named)
  /** How many, and of what: `1 older one`, `3 older ones`. */
  const some = (count: number, what: string): string =>
    `${String(count)} ${what} ${count === 1 ? 'one' : 'ones'}`
  const rules =
    record.rules.is === 'they-begin'
      ? `Its standing rules begin: “${record.rules.line}”`
      : record.rules.is === 'none'
        ? 'It has no standing rules.'
        : 'How its standing rules begin is told only to a caller that can reach its conversations.'
  const blocks: string[] = [[profileText(record.agent), rules].join('\n')]
  if (record.conversations.length === 0) {
    blocks.push('It has no conversation within your reach.')
  } else {
    blocks.push(
      [
        'Its conversations you can reach, the most recently active first:',
        ...record.conversations.map((one) => {
          const called =
            one.conversation === me
              ? `you, ${one.named === null ? 'holding no work' : theOwnerOf(one.named)}`
              : theConversation(one.conversation, one.named)
          const starter =
            one.startedBy.is === 'a-person'
              ? 'a person started it'
              : one.startedBy.is === 'you'
                ? 'you started it'
                : `started by ${one.startedBy.called}`
          const replaced =
            one.inItsPlace === null
              ? ''
              : ` · it could not be reopened, so ${theConversation(one.inItsPlace.conversation, one.inItsPlace.named)} took its place`
          // What became of it: another took its place, or a person archived it.
          const ended =
            replaced +
            (one.archivedAt === undefined ? '' : archivedSaid(one.archivedAt, record.readAt))
          return `  - ${called} · ${starter} at ${at(one.startedAt)} · last changed at ${at(one.lastChangedAt)}${ended}`
        }),
        ...(record.conversationsNotListed === 0
          ? []
          : [
              `  …and ${String(record.conversationsNotListed)} more you can reach, not listed here.`,
            ]),
        'get_agent_status says what any of them is doing now.',
      ].join('\n'),
    )
    blocks.push(
      record.pieces.length === 0 && record.piecesUnread === 0 && record.piecesNotListed === 0
        ? 'Its conversations you can reach hold no pieces of work.'
        : [
            'Its newest pieces of work there, the newest given first:',
            ...record.pieces.map(({ held, givenBy }) => {
              const giver =
                givenBy.is === 'a-person'
                  ? 'a person'
                  : givenBy.is === 'you'
                    ? 'you'
                    : givenBy.called
              const ended = held.endedAt === null ? '' : ` at ${at(held.endedAt)}`
              const stands =
                held.state === 'answered'
                  ? `answered${held.outcome === null ? '' : ` (${held.outcome})`}${ended}`
                  : held.state === 'withdrawn' || held.state === 'closed'
                    ? `${HOW_A_PIECE_ENDED_SAID[held.state]}${ended}`
                    : 'still open'
              return `  - ${pieceLine(held.label, held.title)} · given by ${giver} at ${at(held.givenAt)} · ${stands}`
            }),
            ...(record.piecesUnread === 0
              ? []
              : [
                  `  …and ${String(record.piecesUnread)} more of the newest, which this app could not read.`,
                ]),
            ...(record.piecesNotListed === 0
              ? []
              : [`  …and ${some(record.piecesNotListed, 'older')}, not listed here.`]),
          ].join('\n'),
    )
  }
  blocks.push(
    record.files.length === 0
      ? 'It has made no files.'
      : [
          'Files it made, newest first:',
          ...record.files.map(
            (one) =>
              `  ${resourcesNamed([one.resource])}${
                one.resource.title === null || one.resource.title === one.resource.name
                  ? ''
                  : ` · ${one.resource.title}`
              } — on ${pieceLine(one.label, one.title)}, ${at(one.resource.createdAt)}`,
          ),
          ...(record.filesNotListed === 0
            ? []
            : [
                `  …and ${some(record.filesNotListed, 'older')}: find_files with where: everywhere finds ${record.filesNotListed === 1 ? 'it' : 'them'} by its profile.`,
              ]),
          READ_ONE_WITH_READ_DOCUMENT,
        ].join('\n'),
  )
  return blocks.join('\n\n')
}

/** **F009 · an agent's record, as its payload carries it** — ids where the text has names. */
function agentRecordPayload(record: AgentRecord): Readonly<Record<string, unknown>> {
  const who = (
    said:
      AgentRecord['pieces'][number]['givenBy'] | AgentRecord['conversations'][number]['startedBy'],
  ): Record<string, unknown> =>
    said.is === 'an-agent' ? { kind: 'an-agent', agent: said.conversation } : { kind: said.is }
  return {
    profile: record.agent.profile,
    ...(record.agent.displayName === null ? {} : { display_name: record.agent.displayName }),
    ...(record.agent.provider === null ? {} : { provider: record.agent.provider }),
    ...(record.agent.defaultModel === null ? {} : { default_model: record.agent.defaultModel }),
    rules_told: record.rules.is !== 'not-told',
    rules_begin: record.rules.is === 'they-begin' ? record.rules.line : null,
    conversations: record.conversations.map((one) => ({
      agent: one.conversation,
      label: one.named?.label ?? null,
      started_by: who(one.startedBy),
      started_at: one.startedAt,
      last_changed_at: one.lastChangedAt,
      ...(one.inItsPlace === null ? {} : { replaced_by: one.inItsPlace.conversation }),
      ...(one.archivedAt === undefined
        ? {}
        : {
            archived_at: clockTimeFrom(one.archivedAt, record.readAt),
            archived_by: ARCHIVED_BY,
          }),
    })),
    conversations_not_listed: record.conversationsNotListed,
    pieces: record.pieces.map(({ held, givenBy }) => ({
      piece: held.piece,
      label: held.label,
      title: held.title,
      agent: held.owner,
      given_by: who(givenBy),
      given_at: held.givenAt,
      stands:
        held.state === 'answered' || held.state === 'withdrawn' || held.state === 'closed'
          ? held.state
          : 'open',
      ...(held.outcome === null ? {} : { outcome: held.outcome }),
      ...(held.endedAt === null ? {} : { ended_at: held.endedAt }),
    })),
    ...(record.piecesUnread === 0 ? {} : { pieces_unread: record.piecesUnread }),
    pieces_not_listed: record.piecesNotListed,
    files: record.files.map((one) => ({
      resource: one.resource.resource,
      name: one.resource.name,
      title: one.resource.title,
      piece: one.resource.piece,
      label: one.label,
      piece_title: one.title,
      kept_at: one.resource.createdAt,
    })),
    files_not_listed: record.filesNotListed,
    rows_unread: record.rowsUnread,
  }
}

export function createListAgentsTool(
  host: Pick<AgentToolHost, 'agentsVisibleTo' | 'archivedVisibleTo'>,
  by: Caller,
  me: string,
  readerInputs: ReturnType<typeof readerFields>['readerInputs'],
  readerFieldRefusal: ReturnType<typeof readerFields>['readerFieldRefusal'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'list_agents',
    handlerOwnsMissingInput: true,

    // **D-016 · *"starting one opens a new conversation"* came out**: a give reaches the one
    // conversation a giver has with an agent, and starts one only the first time. And each card
    // names the work it holds — its root and its open pieces, by label (spec D17).
    // **D-016 · commit 7 · R1 · R3 — each is NAMED by the piece it owns**, and that label is
    // what every door that takes an agent takes; the id stays in the payload.
    description: `List the agents you can reach: every conversation this app will let you message, including your own, whatever it is doing. Up to ${String(CONVERSATIONS_LISTED)}, the most recently active first; the answer says how many more there are, and message_agent and get_agent_status take any of them by the label of a piece it owns (W1.2) or by its id. Each one's state says what it is doing: active, needs you (a person's answer or approval is waiting in it, or it answered a person who wrote to it and waits for their next words), waiting on another conversation's answer, owes another conversation an answer (and whom), running in the background (and what), scheduled (and when it next wakes), waiting on the agents holding work it gave out (and who), or idle. The agents themselves outlive their conversations — list_profiles names every agent this app holds. Being listed is not a promise that every message to it is admitted — message_agent answers that separately. Each says the provider, model and effort its conversation runs on, and what its provider last reported when that differs. An archived conversation is put away and left out: archived: true lists those instead, each with when it was archived and by whom. Its label still reaches it; restore_agent brings it back without sending it anything, and whatever is sent to it brings it and the helpers archived with it back too. Each is named by the piece of work it owns (the owner of W1.2 · its title), or by its id when it holds none, then who it is — the name a person gave that agent, and the profile slug give_work takes — its state, the conversation that started it, named the same way, and the work it holds: its own root, when a person gave it one, and its open pieces, by label. A conversation this app cannot attribute is still listed, and says so rather than being given a name.`,
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **A reader of the conversations the caller may reach.** `agentsVisibleTo` filters by the caller's own reach and an empty answer is a sentence (`644`); there is nothing here to ask a person about.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries(readerInputs.list_agents).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        if (args.archived !== undefined && typeof args.archived !== 'boolean') {
          return readerFieldRefusal('list_agents', args, [
            'archived, when given, must be true or false',
          ])!
        }
        const fieldRefusal = readerFieldRefusal('list_agents', args)
        if (fieldRefusal !== null) return fieldRefusal
        if (args.archived === true) {
          const { archived, notListed, readAt } = host.archivedVisibleTo(by, me)
          const more =
            notListed === 0
              ? ''
              : `\n…and ${String(notListed)} more archived conversations you can reach, not listed here.`
          return answer(
            {
              outcome: 'ok',
              archived: archived.map(({ card, archivedAt }) => ({
                ...cardPayload(card),
                archived_at: clockTimeFrom(archivedAt, readAt),
                archived_by: ARCHIVED_BY,
              })),
              count: archived.length,
              notListed,
            },
            (archived.length === 0
              ? 'no archived conversations you can reach'
              : archived
                  .map(({ card, archivedAt }) => cardText(card) + archivedSaid(archivedAt, readAt))
                  .join('\n')) + more,
          )
        }
        const { agents, notListed } = host.agentsVisibleTo(by, me)
        const listed =
          agents.length === 0
            ? // **644 · the empty answer names a door** — see this tool's own note.
              'no agents you can see — list_profiles names every agent this app holds'
            : agents.map(cardText).join('\n')
        // **D-017 · R12 — the cut, said** — so a list of fifty never reads as *that is all*.
        const more =
          notListed === 0
            ? ''
            : `\n…and ${String(notListed)} more you can reach, not listed here; get_agent_status and message_agent take the label of a piece it owns (W1.2), or its id.`
        return answer(
          { outcome: 'ok', agents: agents.map(cardPayload), count: agents.length, notListed },
          listed + more,
        )
      }),
  }
}

export function createGetAgentStatusTool(
  host: Pick<
    AgentToolHost,
    | 'agentCard'
    | 'nameByItsWorkUnder'
    | 'theConversationAddressed'
    | 'whatOpenedItsLastTurn'
    | 'whenItWasArchived'
    | 'whyItIsOutOfReach'
  >,
  by: Caller,
  me: string,
  readerInputs: ReturnType<typeof readerFields>['readerInputs'],
  readerFieldRefusal: ReturnType<typeof readerFields>['readerFieldRefusal'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'get_agent_status',
    handlerOwnsMissingInput: true,
    // **The second half is 433's invariant again** — enumerating and inspecting are one
    // question asked for a set and for one id, so a caller cannot be told about an agent
    // `list_agents` would not name, and is never refused one it would.
    //
    // **610 · it had the SAME HOLE and not the same false sentence** (HO-092 §4.3). This
    // door hands back {@link cardText} of the very card `list_agents` lists, so the nameless row
    // was this tool's answer too — **but the sentence never enumerated the fields**, so unlike
    // `list_agents`' it was not describing a payload that had stopped matching it. The first
    // clause gains the fact the card gained; nothing else here moved.
    description:
      "Who one agent is, what it is doing right now — active, needs you, waiting on another conversation's answer, owing another conversation an answer, running in the background, scheduled, waiting on the agents holding work it gave out, or idle — the work it holds, by label, and where it came from. It answers for any conversation you may reach — every one list_agents names, and any other by the piece it owns (W1.2) or by its id. It says the provider, model and effort its conversation runs on, and what its provider last reported when that differs.",
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **The same read for one id**, folded with the same entitlement — `agentCard` answers `null` for *not there* and *not yours* alike.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries(readerInputs.get_agent_status).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        if (typeof args.agent !== 'string' || args.agent.length === 0) {
          return readerFieldRefusal('get_agent_status', args, ['agent is required'])!
        }
        const fieldRefusal = readerFieldRefusal('get_agent_status', args)
        if (fieldRefusal !== null) return fieldRefusal
        // **D-016 · commit 7 · R1 — a label names its piece's owner**, before any rail reads the
        // target; one that names nothing this caller may reach reads as an unknown id below.
        const agent = host.theConversationAddressed(args.agent, by, me, 'messaging')
        // **D-017 · R12 — an id out of reach is refused as every door refuses it**: the reach
        // rail `message_agent` meets, and `no-such-agent` only for an id no conversation has.
        const out = host.whyItIsOutOfReach(agent, by, me)
        if (out !== null) return outOfReachAnswer(out, agent)
        const card = host.agentCard(agent, by, me)
        if (card === null) return refusalAnswer(refuseTool('no-such-agent', { agent }))
        // **When its last turn ran, and what opened it** — so a giver reading *nothing has
        // started since* can tell whether its own held words were what that turn took.
        const last = host.whatOpenedItsLastTurn(card.agent, me)
        const called = namedByItsWorkOnce(host)
        const named = (who: AConversation): string =>
          who.conversation === me ? 'you' : called(who.conversation, who.about ?? null)
        // Who asked a stop: by name, the caller as `you`, never by id; `''` when no row says.
        const askedBy = (by: WhoStoppedIt | null, asker: string | null): string =>
          by === null
            ? ''
            : askedByClause({
                by,
                asker:
                  by === 'an-agent' && asker !== null
                    ? named({ conversation: asker, profile: null })
                    : null,
              })
        const archivedAt = host.whenItWasArchived(card.agent)
        return answer(
          {
            outcome: 'ok',
            agent: cardPayload(card),
            ...(archivedAt === null
              ? {}
              : {
                  archived_at: clockTimeFrom(archivedAt, last.readAt),
                  archived_by: ARCHIVED_BY,
                }),
            ...(last.took === null ? {} : { last_turn_took: receivedPayload(last.took) }),
          },
          [
            cardText(card) + (archivedAt === null ? '' : archivedSaid(archivedAt, last.readAt)),
            ...theLastTurnSaid(card.lastEndedTurn, last, named, askedBy, card.lastAskToStop),
          ].join('\n\n'),
        )
      }),
  }
}

export function createListProfilesTool(
  host: Pick<AgentToolHost, 'agentRecord' | 'profilesVisibleTo'>,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'list_profiles',

    description:
      'Every agent this app holds — any of them can be named to give_work: what each is called, which provider its conversations run on, and its default model and effort, when it has one; and each provider’s latest usage reading per window — how much is used, when it resets and when it was read, and whether that was before this app last started, when it may be another sign-in’s — so you can keep to a cap before you give work; and which windows each provider has reported since this app began noting them, with when each was first and last reported. These are identities, not conversations — list_agents answers which conversations you can see. Being listed here is not a promise that a give will succeed. The answer says in words what the count covers — read that before summarising it. Name one agent with profile, before choosing whom to give work to, to read what it has done instead: how its standing rules begin, its conversations you can reach — who started each and when, which could not be reopened and which are archived — the newest pieces of work they hold and how each stands or ended, and the files it made.',
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **A reader of this app's own table**; there is nothing here to ask a person about. F009 ·
     * an agent's record asks the reach `list_agents` asks, of each of its conversations, inside the
     * host's read — a fold, never a wall.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    /**
     * **F009 · one argument, and it opens a different answer rather than narrowing this one.**
     * The ruling here was *none*: *"A name to ask about was the obvious argument and it is
     * refused. The whole roster is one small read, and a named arm would buy one narrowing for a
     * second shape of answer."* A record is not that narrowing — nothing on the roster tells what
     * an agent has done — so the name opens it, as `list_tasks` naming a piece opens its record.
     */
    input: {
      profile: z
        .string()
        .optional()
        .describe(
          'An agent, by the profile this list names it by, to read what it has done instead of the list. Leave it out to list every agent.',
        ),
    },
    call: (args) =>
      guarded(async () => {
        if (args.profile !== undefined) {
          if (typeof args.profile !== 'string' || args.profile.trim().length === 0) {
            return refusalAnswer(
              refuseTool('malformed-request', {
                problems: ['profile, when given, must name an agent list_profiles lists'],
              }),
            )
          }
          // **F009 · one agent's record** — its conversations through this caller's reach.
          const read = host.agentRecord(args.profile.trim(), by, me)
          if (read.is === 'no-agent-by-that-name') {
            return refusalAnswer(
              refuseTool('no-agent-by-that-name', { profile: args.profile.trim() }),
            )
          }
          return answer(
            { outcome: 'ok', ...agentRecordPayload(read.record) },
            [
              agentRecordText(read.record, me),
              // `list_tasks`' two sentences, for the pieces this read could be short of.
              ...(read.record.rowsUnread === 0 ? [] : [unreadRowsSentence(read.record.rowsUnread)]),
              ...whenSkipped(read.record.ledgersSkipped, skippedRecordsSentence),
            ].join('\n\n'),
          )
        }
        // **No wall and no fold** (D-014): any agent may give work to any agent this app holds,
        // so the whole roster is the answer.
        const reading = host.profilesVisibleTo()
        const profiles = reading.profiles.map((report) => ({
          profile: report.profile,
          ...(report.displayName === null ? {} : { display_name: report.displayName }),
          ...(report.provider === null ? {} : { provider: report.provider }),
          // **D-042 · R6 — its default, so a giver knows before it calls** (`677`'s inbox 8).
          // **Not called `model_choice`**: `the-rails-before-anything-can-reach-them.test.ts` bans
          // that word from this toolset so no tool can come to name the person's door, and a READ is
          // no reason to weaken that ban.
          ...(report.defaultModel === null ? {} : { default_model: report.defaultModel }),
          ...(report.isAService === true ? { kind: 'service' } : {}),
        }))
        return answer(
          {
            outcome: 'ok',
            profiles,
            count: profiles.length,
            count_covers: EVERY_AGENT_THIS_APP_HOLDS,
            // **F096 — each provider's newest usage reading, per window**.
            provider_usage: providerUsagePayload(reading.usage, reading.readAt),
            // **F096 — which windows each provider has reported, first and last**: kept when
            // the readings are forgotten, so it says whether a window comes at all.
            usage_windows_seen: Object.fromEntries(
              (Object.keys(reading.windowsSeen) as Provider[]).map((provider) => [
                provider,
                reading.windowsSeen[provider].map((one) => ({
                  window: one.window,
                  first_seen: clockTimeFrom(one.first, reading.readAt),
                  last_seen: clockTimeFrom(one.last, reading.readAt),
                })),
              ]),
            ),
          },
          // **FIRST, because it is the only line guaranteed to survive the cut.** A
          // person never sees this payload: `tool_result` carries a summary of at most 200
          // characters and `ToolEntry.vue` draws that.
          [
            EVERY_AGENT_THIS_APP_HOLDS,
            ...reading.profiles.map((report) => profileText(report)),
            ...(Object.keys(reading.usage) as Provider[]).flatMap((provider) => {
              // Which windows it has reported, first and last, as the description promises.
              const seen = reading.windowsSeen[provider] ?? []
              return [
                providerUsageText(provider, reading.usage[provider], reading.readAt),
                ...(seen.length === 0
                  ? []
                  : [
                      windowsReported(
                        PROVIDER_NAME[provider],
                        seen.map((one) => ({
                          window: usageLimitWords(provider, one.window) ?? one.window,
                          first: clockTimeFrom(one.first, reading.readAt),
                          last: clockTimeFrom(one.last, reading.readAt),
                        })),
                      ),
                    ]),
              ]
            }),
          ].join('\n'),
        )
      }),
  }
}
