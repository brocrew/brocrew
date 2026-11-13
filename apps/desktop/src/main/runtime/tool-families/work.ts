import {
  AS_A_DELIVERY,
  aTakeBackOfAPieceYouHold,
  aTakeBackOfAPieceYouHoldThatEnded,
  aTakeBackOfYourOwnWork,
  anEndedPieceSaid,
  takeBackDetail,
  theQuestionsItEnded,
  whatReachedItsHolder,
} from './delivery'
import { type WaitOnAsked } from '../host-split/host-command-contracts'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { DONE, doneWithThePiece, keptResources, tookOnForPerson } from '../agent-tool-answer-words'
import {
  DONE_CONDITION_CHARS,
  WORK_BRIEF_CHARS,
  WORK_FIELD_WORDS,
} from '../../../shared/work-fields'
import { HELD_FORMS_WITH_EXTENSIONS_SAID, MAX_RESOURCES_PER_REPLY } from '../../../shared/documents'
import { PIECE_TITLE_CHARS } from '../../../shared/piece-called'
import { REPLY_SUMMARY_LIMIT } from '../reply-rails'
import { TOOL_INPUT_ENUMS, type ToolName, documentedToolEnum } from './catalog'
import {
  WORK_SEARCH_WORDS,
  workSearchInWords,
  workSearchRefusal,
} from '../../../shared/work-search-words'
import {
  aPieceNotEndedItsQuestionsUnread,
  aPieceNotEndedWhileAQuestionStarts,
} from '../../../shared/questions'
import { answer, refusalAnswer } from './answers'
import { refuseTool } from './refusals'
import { workSearchQuery } from '../../../shared/work-search'
import { z } from 'zod'

interface WithdrawTaskArguments {
  /** The piece being taken back — its label or its id. */
  readonly piece: string
}

/** The advertised name, as a key of {@link WithdrawTaskArguments} — see that interface (429). */
const WITHDRAW_PIECE_ARGUMENT = 'piece' satisfies keyof WithdrawTaskArguments

/**
 * **D-016 · every argument `update_work` advertises, as a TYPE** — `415`'s device. All five
 * acts ship: a title and a status line (plan ruling 7), a new brief and a close (R1), and kept files
 * (R2).
 */
interface UpdateWorkArguments {
  readonly definition_of_done?: string
  /**
   * The piece, by label or id — inferred when exactly one piece the caller holds has reached it (its
   * root counts; D-022 · R4).
   */
  readonly piece?: string
  /** Its new title. */
  readonly title?: string
  /** Its current status line. */
  readonly status?: string
  /** What the status line in the same call marks the piece as waiting on: one of four. */
  readonly on?: WaitOnAsked
  /** **R1** — a new brief for a piece the caller gave, kept verbatim, as `give_work`'s is. */
  readonly brief?: string
  /** **R1** — only `true` closes: a piece the caller gave, ended without a reply. */
  readonly close?: boolean
  /** **R2** — files to keep for the piece, as its inputs or as what was made for it. */
  readonly resources?: readonly string[]
}

const UPDATE_PIECE_ARGUMENT = 'piece' satisfies keyof UpdateWorkArguments

const UPDATE_TITLE_ARGUMENT = 'title' satisfies keyof UpdateWorkArguments

const UPDATE_STATUS_ARGUMENT = 'status' satisfies keyof UpdateWorkArguments

const UPDATE_ON_ARGUMENT = 'on' satisfies keyof UpdateWorkArguments

/** The argument `on` replaced, refused by name so a caller learns what to say instead. */
const UPDATE_WAITING_ARGUMENT = 'waiting'

const UPDATE_DONE_ARGUMENT = 'definition_of_done' satisfies keyof UpdateWorkArguments

const UPDATE_BRIEF_ARGUMENT = 'brief' satisfies keyof UpdateWorkArguments

const UPDATE_CLOSE_ARGUMENT = 'close' satisfies keyof UpdateWorkArguments

const UPDATE_RESOURCES_ARGUMENT = 'resources' satisfies keyof UpdateWorkArguments

/** The keys of `update_work`'s `on`, in the order a refusal names them. */
const WAIT_ON_KINDS = [
  'agent',
  'person',
  'time',
  'event',
] as const satisfies readonly (keyof WaitOnAsked)[]

/**
 * What `on` names, when it names exactly one thing by one non-empty word — `null` when absent or
 * when it does not, with the problem said.
 */
function whatTheWaitNames(on: unknown, problems: string[]): WaitOnAsked | null {
  if (on === undefined) return null
  const named =
    on !== null && typeof on === 'object' && !Array.isArray(on)
      ? Object.entries(on as Record<string, unknown>)
      : null
  const [only] = named ?? []
  if (
    named === null ||
    named.length !== 1 ||
    only === undefined ||
    !(WAIT_ON_KINDS as readonly string[]).includes(only[0]) ||
    typeof only[1] !== 'string' ||
    only[1].trim() === ''
  ) {
    problems.push(
      `${UPDATE_ON_ARGUMENT} must name exactly one of ${WAIT_ON_KINDS.join(', ')}, as a word: such as { "person": "<the question's id>" }`,
    )
    return null
  }
  return { [only[0]]: only[1].trim() } as WaitOnAsked
}

/**
 * **D-016 · commit 6 · every argument `take_on_work` advertises, as a TYPE** — `415`'s device.
 * The door's own names, handed over untouched: `takeOnWorkRequestSchema` is `.strict()`, so an
 * argument it does not know is refused BY NAME.
 */
interface TakeOnWorkArguments {
  readonly definition_of_done: string
  readonly piece?: string
  readonly inputs?: readonly string[]
  /** What the piece is called — one line. */
  readonly title: string
  /** What was asked, as the conversation taking it on understands it. */
  readonly brief: string
}

export function createWithdrawTaskTool(
  host: Pick<AgentToolHost, 'takeBackPiece' | 'whatToCallTheConversation' | 'whyWhatIsHeldWaits'>,
  by: Caller,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'withdraw_task',
    // **It says what it does NOT do, because the other way out of open work destroys
    // something** and a model that has learned `interrupt_agent` will read this as a second one
    // unless told otherwise. HO-023 §4.3 is the sentence in product words:
    // *"withdraw then reassign is legitimate; reassign without withdrawing is the duplicate."*
    // **D-016 · ruling 8 — and the owner is told**, woken to hear it if nothing runs in it.
    // **D-022 · R3 — at once or once its turn ends, and the answer says which.**
    description:
      'Take back a piece of work you gave, so it is no longer owed. The agent holding it is told — at once when it is free or has stopped (it is woken to hear it), else once its turn ends: the answer says which, and interrupt_agent asks that turn to stop. Nothing it is doing is stopped by this, and the pieces it gave under it stay its own to take back. A piece that has already ended — answered, or closed with update_work — cannot be taken back.',
    /**
     * **Advertised against a TYPE, so *documented* and *read* cannot drift apart** (415's
     * device, `429`'s door) — see {@link WithdrawTaskArguments}.
     */
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **It stops nothing.** Its own description is written to say so: *nothing it is doing is stopped*.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      piece: z
        .string()
        .describe(
          'The piece you are taking back — its label (W1.2) or its id, as list_tasks names it.',
        ),
    } satisfies Readonly<Record<keyof WithdrawTaskArguments, z.ZodType>>,
    call: (args) =>
      guarded(async () => {
        const piece = args[WITHDRAW_PIECE_ARGUMENT]
        if (typeof piece !== 'string' || piece.length === 0) {
          return refusalAnswer(
            refuseTool('malformed-request', {
              problems: [`${WITHDRAW_PIECE_ARGUMENT} is required`],
            }),
          )
        }
        // **The rails are the HOST's and this file asks none of them** — the module note's
        // design, and `create_agent`'s shape one verb over. The host answers with a rail word and
        // the facts that rail may state; all that happens here is that they become a payload.
        const outcome = await host.takeBackPiece({ piece }, by)
        // **F089 · a piece the caller HOLDS, said as what it is** — `not-a-piece-you-gave`, true
        // of it, with the act left. The word's own sentence, whose guess is that the name may
        // belong to nothing, is kept for a name that is none of the caller's.
        if (
          !outcome.ok &&
          outcome.refused.rail === 'not-a-piece-you-gave' &&
          outcome.refused.itHoldsIt !== undefined
        ) {
          const held = outcome.refused.itHoldsIt
          const detail = takeBackDetail(piece, outcome.refused)
          if (held.is === 'its-root') {
            return refusalAnswer({
              ...refuseTool('not-a-piece-you-gave', detail),
              reason: aTakeBackOfYourOwnWork(held.label),
            })
          }
          if (held.is === 'open') {
            return refusalAnswer({
              ...refuseTool('not-a-piece-you-gave', detail),
              reason: aTakeBackOfAPieceYouHold(held.label),
            })
          }
          return refusalAnswer({
            ...refuseTool('not-a-piece-you-gave', detail),
            reason: aTakeBackOfAPieceYouHoldThatEnded(held),
          })
        }
        if (
          !outcome.ok &&
          outcome.refused.rail === 'a-conversation-with-its-questions-is-starting'
        ) {
          return refusalAnswer({
            ...refuseTool(outcome.refused.rail, takeBackDetail(piece, outcome.refused)),
            reason: aPieceNotEndedWhileAQuestionStarts(outcome.refused.label, 'work-withdrawn'),
          })
        }
        if (!outcome.ok && outcome.refused.rail === 'its-questions-could-not-all-be-read') {
          return refusalAnswer({
            ...refuseTool(outcome.refused.rail, takeBackDetail(piece, outcome.refused)),
            reason: aPieceNotEndedItsQuestionsUnread(
              outcome.refused.label,
              'work-withdrawn',
              outcome.refused.unreadQuestion,
            ),
          })
        }
        if (!outcome.ok) {
          return refusalAnswer(
            refuseTool(outcome.refused.rail, takeBackDetail(piece, outcome.refused)),
          )
        }
        const owner = host.whatToCallTheConversation(outcome.owner)
        return answer(
          {
            outcome: 'ok',
            piece: outcome.piece,
            label: outcome.label,
            state: 'withdrawn',
            // **Reported because the two arms differ in a way the caller can act on**: words
            // that never went out are words nobody has read.
            tookBackTheMessage: outcome.tookBackTheMessage,
            // **591 · the same rule one fact over** — see {@link TakeBackOutcome.endedQuestions}.
            endedQuestions: outcome.endedQuestions,
            // **D-022 · R3** — see {@link TakeBackOutcome.delivery}.
            delivery: outcome.delivery,
            ...(outcome.delivery === 'not-delivered' ? { whyNotTold: outcome.whyNotTold } : {}),
            ...(outcome.askedItsTurnToStop ? { askedItsTurnToStop: true } : {}),
          },
          `${outcome.label} is taken back — ${owner} no longer owes it${
            outcome.tookBackTheMessage
              ? ', and the message carrying it was taken back before it was sent'
              : ''
          }${theQuestionsItEnded(outcome.endedQuestions)}${
            outcome.askedItsTurnToStop ? '; its turn was asked to stop' : ''
          }. ${whatReachedItsHolder(
            owner,
            outcome.label,
            outcome,
            outcome.askedItsTurnToStop || outcome.atAService ? 'a-stop-asked' : 'a-stop',
            host.whyWhatIsHeldWaits(outcome.owner),
          )}`,
        )
      }),
  }
}

export function createUpdateWorkTool(
  host: Pick<AgentToolHost, 'updateWork' | 'whatToCallTheConversation' | 'whyWhatIsHeldWaits'>,
  by: Caller,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'update_work',
    // A malformed `on` reaches this tool's own refusal, which says what to send instead.
    handlerOwnsMissingInput: true,
    /**
     * **D-016 · name a piece, say where it stands, give it a new brief, close it, or keep files
     * for it** (plan ruling 7; R1, R2) — the one conditional line about naming the root in the
     * dynamic layer says the same thing (plan §3.10).
     *
     * **It says who is told of what**: a new brief, a close and the giver's files reach the
     * agent holding the piece — at once or once its turn ends, and the answer says which (D-022);
     * a title, a status line and what an owner made — its root's included (D-023) — are sent to
     * nobody.
     */
    description:
      'For a non-root piece taken on for the person, the brief changes here. The giver may change the done condition, or the holder of person-given work. Name a piece of work, say where it stands, give it a new brief, close it, or keep files for it. Title your own conversation’s work — its root, or a piece you took on for a person — or a piece you gave; set the current status line of a piece you hold or gave, or mark it as waiting on purpose with on, which names what will end the wait: another piece or an agent’s answer, a person’s answer or to-do, a time, or a job or background task. A question in your reply is not a request: to wait on a person, ask with ask_question first and name its id. resources keeps files for any piece you hold, your own conversation’s work included, as what you made — and for a piece you gave, as its inputs: the agent holding it is told their ids. A close is only for a piece you gave. For work you gave, brief replaces its brief and is sent to the agent holding it as a message of its own, in your words — or, while the piece’s first brief is still held for that agent, goes out in its place; close ends it without a reply, and that agent is told to stop. What that agent is told reaches it at once when it is free or has stopped, else once its turn ends: the answer says which, and interrupt_agent asks that turn to stop. If your conversation’s work has no title yet, name it after what the person asked for. Name the piece by its label (W1.2) or id — you must name it to brief or close it — or leave it out when you hold only one. The newest title, status line, brief and done condition stand; a title, a status line and what you made are sent to nobody. Only a title changes on a piece that has ended.',
    /**
     * **Rows in this app's own ledger, and the rails are the whole gate** (HO-031 §2.4): who
     * may title, brief, close, keep files and say where a piece stands are the host's answers,
     * from the piece's row. **A new brief, a close or inputs are told to a conversation the
     * caller gave the piece to** — which wakes it, as `message_agent` and `withdraw_task` wake one
     * — and it never starts a new conversation (D-016 spec D6).
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      piece: z
        .string()
        .optional()
        .describe(
          'The piece, by its label (W1.2) or id. Leave it out when you hold only one — your own conversation’s work counts, and a piece whose brief has not reached you yet does not — except to brief or close, which require the piece to be named.',
        ),
      title: z
        .string()
        .optional()
        .describe(
          `Its new title: one line, at most ${String(PIECE_TITLE_CHARS)} characters. Only the conversation that gave a piece names it — or, for a piece a person gave (your root, or work you took on), the conversation holding it.`,
        ),
      status: z
        .string()
        .optional()
        .describe(
          `Where it stands now, in a line, at most ${String(REPLY_SUMMARY_LIMIT)} characters. Refused on a piece that has ended.`,
        ),
      on: z
        .looseObject({
          agent: z
            .string()
            .optional()
            .describe(
              'Another open piece, by its label (W1.2) or id, or the id of an open question you asked an agent.',
            ),
          person: z
            .string()
            .optional()
            .describe(
              'The id of an open question you asked a person (ask_question with who_answers a-person) or a to-do you asked of them (request_action). A question in your reply is not one: ask it with the tool first.',
            ),
          time: z
            .string()
            .optional()
            .describe(
              "A real deadline or backstop within 30 days, such as 2026-10-15T09:00:00Z; the app wakes the holder then. For another piece's result, use on.agent.",
            ),
          event: z
            .string()
            .optional()
            .describe(
              'The id of a scheduled job or background task running in the conversation holding the piece.',
            ),
        })
        .optional()
        .describe(
          'Marks the status line in this call as a deliberate wait, naming what will end it: exactly one of agent, person, time or event. The piece then reads waiting on purpose, not stalled, until a new brief, a follow-up about it, a reply, or a status line without on. Needs status.',
        ),
      definition_of_done: z
        .string()
        .optional()
        .describe(
          'The new done condition, at most 512 characters. The giver may change it, or the holder of person-given work. Omit it to keep the current condition.',
        ),
      brief: z
        .string()
        .optional()
        .describe(
          'A new brief for a piece you gave or took on for the person, at most 2000 characters. Put longer detail in an input file. A root’s brief stays as recorded. For a piece you gave, the holder is told; while its first brief is still held, the new brief goes out in its place. Refused with close.',
        ),
      close: z
        .boolean()
        .optional()
        .describe(
          'true closes a piece you gave without a reply: it is no longer owed and no longer stalls, and the agent holding it is told to stop. A status line in the same call is set first. Refused with brief or resources.',
        ),
      resources: z
        .array(z.string())
        .optional()
        .describe(
          `Files to keep for the piece, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is copied and hashed: as what you made on any piece you hold, your own conversation’s work included, and nobody is told; as its inputs on a piece you gave, and the agent holding it is told their ids.`,
        ),
    } satisfies Readonly<Record<keyof UpdateWorkArguments, z.ZodType>>,
    call: (args) =>
      guarded(async () => {
        const piece = args[UPDATE_PIECE_ARGUMENT]
        const title = args[UPDATE_TITLE_ARGUMENT]
        const status = args[UPDATE_STATUS_ARGUMENT]
        const on = args[UPDATE_ON_ARGUMENT]
        const brief = args[UPDATE_BRIEF_ARGUMENT]
        const condition = args[UPDATE_DONE_ARGUMENT]
        const close = args[UPDATE_CLOSE_ARGUMENT]
        const paths = args[UPDATE_RESOURCES_ARGUMENT]
        const problems: string[] = []
        if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {
          problems.push(`${UPDATE_PIECE_ARGUMENT} must be a piece's label or id, or left out`)
        }
        // **Trimmed, and a blank one is none** — a title or line a person reads beside a label.
        const said = (value: unknown, most: number, argument: string): string | null => {
          if (value === undefined) return null
          const trimmed = typeof value === 'string' ? value.trim() : ''
          if (trimmed === '' || trimmed.length > most) {
            problems.push(`${argument} must be a line of 1 to ${String(most)} characters`)
            return null
          }
          return trimmed
        }
        const newTitle = said(title, PIECE_TITLE_CHARS, UPDATE_TITLE_ARGUMENT)
        const newStatus = said(status, REPLY_SUMMARY_LIMIT, UPDATE_STATUS_ARGUMENT)
        // **A new brief is kept VERBATIM**, as `give_work`'s is: it is sent as a message of its
        // own, whole.
        if (brief !== undefined && (typeof brief !== 'string' || brief.trim() === '')) {
          problems.push(`${UPDATE_BRIEF_ARGUMENT} must say something`)
        }
        if (typeof brief === 'string' && brief.length > WORK_BRIEF_CHARS)
          problems.push(WORK_FIELD_WORDS.briefLimit)
        if (condition !== undefined) {
          if (typeof condition !== 'string' || condition.trim() === '')
            problems.push(WORK_FIELD_WORDS.blank)
          else if (condition.length > DONE_CONDITION_CHARS)
            problems.push(WORK_FIELD_WORDS.conditionLimit)
        }
        if (close !== undefined && typeof close !== 'boolean') {
          problems.push(`${UPDATE_CLOSE_ARGUMENT} must be true or false, or absent`)
        }
        if (Object.hasOwn(args, UPDATE_WAITING_ARGUMENT)) {
          problems.push(
            `${UPDATE_WAITING_ARGUMENT} is replaced by ${UPDATE_ON_ARGUMENT}, which names what ends the wait. Send one of: on: {person: "<question id>"} after asking a person with ask_question or request_action; on: {agent: "W1.2"} for another piece, or on: {agent: "<question id>"} for a question to an agent; on: {time: "2026-10-15T09:00:00Z"}; on: {event: "<job or background task id>"}`,
          )
        }
        const waitsOn = whatTheWaitNames(on, problems)
        if (waitsOn !== null && status === undefined) {
          problems.push(
            `${UPDATE_ON_ARGUMENT} needs ${UPDATE_STATUS_ARGUMENT}: a line saying what it waits for`,
          )
        } else if (waitsOn !== null && brief !== undefined) {
          problems.push(
            `${UPDATE_ON_ARGUMENT} and ${UPDATE_BRIEF_ARGUMENT} contradict each other: a new brief ends a wait on purpose`,
          )
        }
        if (
          paths !== undefined &&
          (!Array.isArray(paths) ||
            !paths.every((one) => typeof one === 'string' && one.length > 0))
        ) {
          problems.push(`${UPDATE_RESOURCES_ARGUMENT} must be a list of paths, or absent`)
        } else if (Array.isArray(paths) && paths.length > MAX_RESOURCES_PER_REPLY) {
          problems.push(
            `${UPDATE_RESOURCES_ARGUMENT} may name at most ${String(MAX_RESOURCES_PER_REPLY)} files, and it named ${String(paths.length)}`,
          )
        }
        const closes = close === true
        const keeps = Array.isArray(paths) && paths.length > 0
        if (
          title === undefined &&
          status === undefined &&
          brief === undefined &&
          condition === undefined &&
          !closes &&
          !keeps
        ) {
          problems.push(
            `say ${UPDATE_TITLE_ARGUMENT}, ${UPDATE_STATUS_ARGUMENT}, ${UPDATE_BRIEF_ARGUMENT}, ${UPDATE_DONE_ARGUMENT}, ${UPDATE_CLOSE_ARGUMENT}, ${UPDATE_RESOURCES_ARGUMENT}, or several`,
          )
        }
        // **R1 · closing and re-briefing contradict each other**, and so do closing and keeping
        // files for a piece that goes on (D-016 spec D3).
        if (closes && (brief !== undefined || condition !== undefined)) {
          problems.push(
            brief !== undefined
              ? `${UPDATE_CLOSE_ARGUMENT} and ${UPDATE_BRIEF_ARGUMENT} contradict each other: a piece you close is given no new brief`
              : "close and definition_of_done can't go together: a closed piece takes no new done condition.",
          )
        }
        if (closes && keeps) {
          problems.push(
            `${UPDATE_CLOSE_ARGUMENT} and ${UPDATE_RESOURCES_ARGUMENT} contradict each other: files are kept for a piece that goes on`,
          )
        }
        // **D-016 spec D4 · a new brief and a close name their piece**: the one inferred is one
        // the caller HOLDS, and these two are acts on a piece it GAVE.
        if ((brief !== undefined || closes) && piece === undefined) {
          problems.push(
            `${UPDATE_PIECE_ARGUMENT} is required to give a new brief or to close: name the piece`,
          )
        }
        if (problems.length > 0) {
          return refusalAnswer(refuseTool('malformed-request', { problems }))
        }
        const updated = await host.updateWork(
          {
            piece: typeof piece === 'string' ? piece : null,
            title: newTitle,
            status: newStatus,
            on: waitsOn,
            definitionOfDone: typeof condition === 'string' ? condition : null,
            brief: typeof brief === 'string' ? brief : null,
            close: closes,
            resources: Array.isArray(paths) ? (paths as string[]) : [],
          },
          by,
        )
        if (!updated.ok) {
          // **A file that could not be kept is carried whole** — `carryReplyRefusal`'s
          // `'outcome' in refusal` arm: a `ResourceRefusal` is already `341`-shaped.
          if ('resourceRefusal' in updated) {
            const { resourceRefusal } = updated
            return answer(
              { ...resourceRefusal },
              `refused (${resourceRefusal.rail}): ${resourceRefusal.reason}`,
            )
          }
          if (updated.rail === 'that-piece-has-ended') {
            return refusalAnswer({
              ...refuseTool(updated.rail, { ...updated.detail }),
              reason: anEndedPieceSaid(updated.detail, updated.readAt),
            })
          }
          if (updated.rail === 'a-conversation-with-its-questions-is-starting') {
            return refusalAnswer({
              ...refuseTool(updated.rail, { ...updated.detail }),
              reason: aPieceNotEndedWhileAQuestionStarts(updated.detail.label, 'work-closed'),
            })
          }
          if (updated.rail === 'its-questions-could-not-all-be-read') {
            return refusalAnswer({
              ...refuseTool(updated.rail, { ...updated.detail }),
              reason: aPieceNotEndedItsQuestionsUnread(
                updated.detail.label,
                'work-closed',
                updated.detail.unreadQuestion,
              ),
            })
          }
          return refusalAnswer(refuseTool(updated.rail, updated.detail))
        }
        const owner = host.whatToCallTheConversation(updated.owner)
        // No echo of the title, status line or brief the call sent. The label is said only when
        // the call did not spell it exactly; what reached the holder always follows.
        const lead =
          typeof piece === 'string' && piece === updated.label
            ? DONE
            : doneWithThePiece(updated.label)
        const lines = [
          ...(updated.closed === null &&
          updated.delivery !== 'not-delivered' &&
          updated.delivery !== 'after-it-ended'
            ? [lead]
            : []),
          ...(updated.definitionOfDone == null
            ? []
            : [`The done condition for ${updated.label} changed.`]),
          ...(updated.kept.length === 0
            ? []
            : [keptResources(updated.kept.map((one) => one.resource))]),
          ...(updated.closed === null
            ? []
            : [
                `${updated.label} is closed — ${owner} no longer owes it${
                  updated.closed.tookBackTheMessage
                    ? ', and the message carrying its brief was taken back before it was sent'
                    : ''
                }${theQuestionsItEnded(updated.closed.endedQuestions)}${
                  updated.askedItsTurnToStop ? '; its turn was asked to stop' : ''
                }.`,
              ]),
          ...(updated.delivery === null
            ? []
            : [
                whatReachedItsHolder(
                  owner,
                  updated.label,
                  updated,
                  updated.closed !== null
                    ? updated.askedItsTurnToStop || updated.atAService
                      ? 'a-stop-asked'
                      : 'a-stop'
                    : updated.rebriefed
                      ? 'a-new-brief'
                      : 'its-inputs',
                  host.whyWhatIsHeldWaits(updated.owner),
                ),
              ]),
        ]
        return answer(
          {
            outcome: 'ok',
            piece: updated.piece,
            label: updated.label,
            ...(updated.title === null ? {} : { title: updated.title }),
            ...(updated.status === null ? {} : { status: updated.status }),
            // **Absent, never false** — the file's idiom for what a call did not do.
            ...(updated.rebriefed ? { rebriefed: true } : {}),
            ...(updated.kept.length === 0 ? {} : { resources: updated.kept }),
            ...(updated.closed === null
              ? {}
              : {
                  state: 'closed',
                  tookBackTheMessage: updated.closed.tookBackTheMessage,
                  endedQuestions: updated.closed.endedQuestions,
                  ...(updated.askedItsTurnToStop ? { askedItsTurnToStop: true } : {}),
                }),
            // **D-022 · R3** — see {@link UpdateWorkOutcome.delivery}: in the vocabulary the
            // giver's piece verbs share.
            ...(updated.delivery === null ? {} : { delivery: AS_A_DELIVERY[updated.delivery] }),
            ...(updated.delivery === 'not-delivered' ? { whyNotTold: updated.whyNotTold } : {}),
          },
          lines.join(' '),
        )
      }),
  }
}

export function createTakeOnWorkTool(
  host: Pick<AgentToolHost, 'takeOnWork'>,
  by: Caller,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'take_on_work',
    handlerOwnsMissingInput: true,
    // It opens new personal work; an assigned piece already holds the agent's work.
    description:
      "Only for a request a person typed in your own conversation. For work an agent gave you, keep working on that piece; don't call this. Give a short brief and definition_of_done. The piece goes under your current work; name piece if that is unclear. A recorded agent giver is told. Finish with reply_to_parent, then tell the person here.",
    /**
     * **A row in this app's own ledger, in the caller's own conversation** (HO-031 §2.4): nothing
     * is sent and nobody is woken, so the rails are the whole gate.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries({
        title: z
          .string()
          .describe(
            `What the piece is called — what the person asked for: one line, at most ${String(PIECE_TITLE_CHARS)} characters.`,
          ),
        definition_of_done: z.string().describe(WORK_FIELD_WORDS.condition),
        brief: z.string().describe(WORK_FIELD_WORDS.brief),
        piece: z
          .string()
          .optional()
          .describe(
            'The work you hold to put this under, by label or id. Leave it out when your current work is clear.',
          ),
        inputs: z
          .array(z.string())
          .optional()
          .describe(
            'Files holding the detail, at most 10. Relative paths use this conversation’s working folder.',
          ),
      } satisfies Readonly<Record<keyof TakeOnWorkArguments, z.ZodType>>).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        // **Handed to the door VERBATIM**, `give_work`'s rule: its schema is `.strict()`, so a
        // key it does not know is refused BY NAME only while this layer strips nothing.
        const taken = await host.takeOnWork(args, by)
        if (!taken.ok) {
          if ('resourceRefusal' in taken)
            return answer(
              { ...taken.resourceRefusal },
              `refused (${taken.resourceRefusal.rail}): ${taken.resourceRefusal.reason}`,
            )
          const refused = refuseTool(taken.rail, taken.detail)
          return refusalAnswer(refused)
        }
        return answer(
          {
            outcome: 'ok',
            piece: taken.piece,
            label: taken.label,
            title: taken.title,
            under: taken.root,
            notice: taken.notice,
            queued: taken.queued,
          },
          [
            tookOnForPerson(taken.label, taken.root),
            ...(taken.notice === null
              ? []
              : [
                  taken.notice === 'sent'
                    ? 'The giver was told.'
                    : taken.notice === 'held'
                      ? 'The note is waiting for the giver.'
                      : 'The giver could not be told.',
                ]),
            ...(taken.queued ? ['The work is queued.'] : []),
          ].join(' '),
        )
      }),
  }
}

export function createSearchWorkTool(
  host: Pick<AgentToolHost, 'searchWork'>,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'search_work',
    description: WORK_SEARCH_WORDS.description,
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      ...workSearchQuery.shape,
      scope: documentedToolEnum(TOOL_INPUT_ENUMS['search_work:scope'], 'The scope to search.'),
      state: documentedToolEnum(
        TOOL_INPUT_ENUMS['search_work:state'],
        'Only work in this state.',
        'Omit it for every state.',
      ).optional(),
    },
    call: (args) =>
      guarded(async () => {
        const input = workSearchQuery.safeParse(args)
        if (!input.success) {
          const refused = workSearchRefusal('invalid')
          return answer(refused, `refused (${refused.rail}): ${refused.reason}`)
        }
        const found = (await host.searchWork?.(me, input.data)) ?? {
          ok: false as const,
          reason: 'unavailable' as const,
        }
        if (!found.ok) {
          const refused = workSearchRefusal(found.reason)
          return answer(refused, `refused (${refused.rail}): ${refused.reason}`)
        }
        return answer({ outcome: 'ok', ...found.page }, workSearchInWords(found.page))
      }),
  }
}
