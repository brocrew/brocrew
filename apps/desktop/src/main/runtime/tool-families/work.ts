import {
  AS_A_DELIVERY,
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
import { WORK_FIELD_WORDS } from '../../../shared/work-fields'
import { sendOverflowSaid } from '../send-overflow'
import { HELD_FORMS_WITH_EXTENSIONS_SAID } from '../../../shared/documents'
import { PIECE_TITLE_CHARS } from '../../../shared/piece-called'
import { REPLY_SUMMARY_LIMIT } from '../reply-rails'
import type { ToolName } from './catalog'
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
import { conversationSearchQuery } from '../../../shared/work-search'
import { z } from 'zod'

interface WithdrawTaskArguments {
  /** The piece being taken back — its label or its id. */
  readonly piece: string
  readonly reason?: string
}

/** The advertised name, as a key of {@link WithdrawTaskArguments} — see that interface (429). */
const WITHDRAW_PIECE_ARGUMENT = 'piece' satisfies keyof WithdrawTaskArguments
const WITHDRAW_REASON_ARGUMENT = 'reason' satisfies keyof WithdrawTaskArguments

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
  /** Only true closes the named open child piece without a reply. */
  readonly close?: boolean
  /** **R2** — files to keep for the piece, as its inputs or as what was made for it. */
  readonly resources?: readonly string[]
  /** The caller's own current rules, which every turn's footer prints; empty clears them. */
  readonly current_rules?: string
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

const UPDATE_RULES_ARGUMENT = 'current_rules' satisfies keyof UpdateWorkArguments

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
      "Withdraw an open child task when needed. Any conversation may withdraw it. Leave work the person gave to the person, or ask them before withdrawing it. A holder that received the first brief is told with its next input who withdrew the piece and why. The notice starts no turn. When the task has a conversation giver and a different conversation withdraws it, that giver is told too. This acts on the task with that label, not on its conversation, which keeps its other tasks and can take new ones. Give a reason when you end someone else's work. Structural conversation roots are unchanged.",
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
          'The open child task to withdraw, by its label or id. Structural conversation roots are unchanged.',
        ),
      reason: z
        .string()
        .optional()
        .describe(
          'Why you are withdrawing this task. The holder reads it with your name if it received the first brief. A conversation giver other than you reads it too. Leave it out when you have no reason to add.',
        ),
    } satisfies Readonly<Record<keyof WithdrawTaskArguments, z.ZodType>>,
    call: (args) =>
      guarded(async () => {
        const piece = args[WITHDRAW_PIECE_ARGUMENT]
        const reason = args[WITHDRAW_REASON_ARGUMENT]
        if (typeof piece !== 'string' || piece.length === 0) {
          return refusalAnswer(
            refuseTool('malformed-request', {
              problems: [`${WITHDRAW_PIECE_ARGUMENT} is required`],
            }),
          )
        }
        if (reason !== undefined && typeof reason !== 'string') {
          return refusalAnswer(
            refuseTool('malformed-request', { problems: ['reason must be text or left out'] }),
          )
        }
        const words = reason?.trim() ? reason : undefined
        const outcome = await host.takeBackPiece({ piece, ...(words ? { reason: words } : {}) }, by)
        if (!outcome.ok && 'ended' in outcome.refused) {
          const refused = outcome.refused
          const { nextSteps, ...ended } = refused.ended
          const payload = {
            ...refuseTool(refused.rail, takeBackDetail(piece, { ...refused, ended })),
            reason: anEndedPieceSaid(refused.ended, refused.readAt),
          }
          return nextSteps === undefined ? refusalAnswer(payload) : answer(payload, payload.reason)
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
  host: Pick<
    AgentToolHost,
    'updateWork' | 'setCurrentRules' | 'whatToCallTheConversation' | 'whyWhatIsHeldWaits'
  >,
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
      "For a non-root piece taken on for the person, the brief changes here. The giver may change the done condition, or the holder of person-given work. Name a piece of work, say where it stands, give it a new brief, close it, or keep files for it. Title your own conversation’s work — its root, or a piece you took on for a person — or a piece you gave; set the current status line of a piece you hold or gave, or mark it as waiting on purpose with on, which names what will end the wait: another piece or an agent’s answer, a person’s answer or to-do, a time, or a job or background task. A question in your reply is not a request: to wait on a person, ask with ask_question first and name its id. resources keeps files for any piece you hold, your own conversation’s work included, as what you made — and for a piece you gave, as its inputs: the agent holding it is told their ids. close: true ends an open child task without a reply. Any conversation may close it. Leave work the person gave to the person, or ask them before closing it. A holder that received the first brief is told with its next input who closed the piece and why. The notice starts no turn. When the task has a conversation giver and a different conversation closes it, that giver is told too. A closed task keeps its outcome; to have more work done, give it again to the same conversation. Give a reason when you end someone else's work, so its holder knows why. Structural conversation roots are unchanged. For work you gave, brief replaces its brief and is sent to the agent holding it as a message of its own, in your words — or, while the piece’s first brief is still held for that agent, goes out in its place. A service is told only if the work reached it. A new brief reaches its holder with its next input; nothing starts it just to deliver it. Files you add reach it at once when it is free or has stopped, else once its turn ends: the answer says which. If your conversation’s work has no title yet, name it after what the person asked for. Name the piece by its label (W1.2) or id — you must name it to brief or close it — or leave it out when you hold only one. The newest title, status line, brief and done condition stand; a title, a status line and what you made are kept without a notice. A close can send its reason as part of the holder notice. Only a title changes on a piece that has ended.",
    /**
     * **Rows in this app's own ledger, and the rails are the whole gate** (HO-031 §2.4): who
     * may title, brief, close, keep files and say where a piece stands are the host's answers,
     * from the piece's row. A new brief, a close or inputs can wake the holder to receive them.
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
          `Its new title: one line, at most ${String(PIECE_TITLE_CHARS)} characters. The giver or holder normally names a task.`,
        ),
      status: z
        .string()
        .optional()
        .describe(
          `A status line of at most ${String(REPLY_SUMMARY_LIMIT)} characters, or the reason for closing. A long close reason is kept in a file. Refused on an ended piece.`,
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
              "A real future deadline or backstop, such as 2026-10-15T09:00:00Z; the app wakes the holder then. For another piece's result, use on.agent.",
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
          'The new done condition. Anything over 2,000 characters arrives as a file the reader is pointed to. The giver normally maintains it. Omit it to keep the current condition.',
        ),
      brief: z
        .string()
        .optional()
        .describe(
          'A new brief for a named task. The giver normally maintains it. Anything over 2,000 characters arrives as a file the reader is pointed to. A root’s brief stays as recorded. The holder is told about work a conversation gave. If the first brief is held, the new brief rides with it. Refused with close.',
        ),
      close: z
        .boolean()
        .optional()
        .describe(
          'true ends an open child task without a reply; any conversation may close it. Leave work the person gave to the person, or ask them before closing it. A holder that received the first brief is told with its next input who closed the piece and why. The notice starts no turn. When the task has a conversation giver and a different conversation closes it, that giver is told too. A closed task stays closed: to have more work done, give it again to its conversation. With no reason, the notice says “no reason given”. You can keep ending evidence with resources. Refused with brief or definition_of_done.',
        ),
      resources: z
        .array(z.string())
        .optional()
        .describe(
          `Files to keep for the piece — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is copied and hashed: as inputs when you add files to work you gave, and as evidence when closing. Other files are kept with the task.`,
        ),
      current_rules: z
        .string()
        .optional()
        .describe(
          `Your conversation’s current rules or immediate goals, a few short lines such as “tonight keep the pace at 3 pieces an hour”, at most ${String(REPLY_SUMMARY_LIMIT)} characters. Every turn’s footer shows them until you change them. Send them whole each time; empty clears them. Needs no piece.`,
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
        const rules = args[UPDATE_RULES_ARGUMENT]
        const problems: string[] = []
        if (
          rules !== undefined &&
          (typeof rules !== 'string' || rules.trim().length > REPLY_SUMMARY_LIMIT)
        ) {
          problems.push(
            `${UPDATE_RULES_ARGUMENT} must be text of at most ${String(REPLY_SUMMARY_LIMIT)} characters, or empty to clear them`,
          )
        }
        if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {
          problems.push(`${UPDATE_PIECE_ARGUMENT} must be a piece's label or id, or left out`)
        }
        // **Trimmed, and a blank one is none** — a title or line a person reads beside a label.
        const said = (value: unknown, most: number | null, argument: string): string | null => {
          if (value === undefined) return null
          const trimmed = typeof value === 'string' ? value.trim() : ''
          if (trimmed === '' || (most !== null && trimmed.length > most)) {
            problems.push(
              most === null
                ? `${argument} must say something`
                : `${argument} must be a line of 1 to ${String(most)} characters`,
            )
            return null
          }
          return trimmed
        }
        const newTitle = said(title, PIECE_TITLE_CHARS, UPDATE_TITLE_ARGUMENT)
        const newStatus = said(
          status,
          close === true ? null : REPLY_SUMMARY_LIMIT,
          UPDATE_STATUS_ARGUMENT,
        )
        // **A new brief is kept VERBATIM**, as `give_work`'s is: it is sent as a message of its
        // own, whole.
        if (brief !== undefined && (typeof brief !== 'string' || brief.trim() === '')) {
          problems.push(`${UPDATE_BRIEF_ARGUMENT} must say something`)
        }
        if (condition !== undefined) {
          if (typeof condition !== 'string' || condition.trim() === '')
            problems.push(WORK_FIELD_WORDS.blank)
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
        }
        const closes = close === true
        const keeps = Array.isArray(paths) && paths.length > 0
        const actsOnAPiece =
          title !== undefined ||
          status !== undefined ||
          brief !== undefined ||
          condition !== undefined ||
          closes ||
          keeps
        if (!actsOnAPiece && rules === undefined) {
          problems.push(
            `say ${UPDATE_TITLE_ARGUMENT}, ${UPDATE_STATUS_ARGUMENT}, ${UPDATE_BRIEF_ARGUMENT}, ${UPDATE_DONE_ARGUMENT}, ${UPDATE_CLOSE_ARGUMENT}, ${UPDATE_RESOURCES_ARGUMENT}, ${UPDATE_RULES_ARGUMENT}, or several`,
          )
        }
        if (closes && (brief !== undefined || condition !== undefined)) {
          problems.push(
            brief !== undefined
              ? `${UPDATE_CLOSE_ARGUMENT} and ${UPDATE_BRIEF_ARGUMENT} contradict each other: a piece you close is given no new brief`
              : "close and definition_of_done can't go together: a closed piece takes no new done condition.",
          )
        }
        if ((brief !== undefined || closes) && piece === undefined) {
          problems.push(
            `${UPDATE_PIECE_ARGUMENT} is required to give a new brief or to close: name the piece`,
          )
        }
        if (problems.length > 0) {
          return refusalAnswer(refuseTool('malformed-request', { problems }))
        }
        // Current rules belong to the caller's conversation, not to a piece: written after the
        // piece's update succeeds, so a refused update leaves them as they were.
        const newRules = typeof rules === 'string' ? rules.trim() : null
        const rulesSaved =
          newRules === ''
            ? 'Your current rules are cleared.'
            : 'Your current rules are saved; every turn’s footer shows them.'
        if (newRules !== null && !actsOnAPiece) {
          host.setCurrentRules(newRules, by)
          return answer({ outcome: 'ok' }, rulesSaved)
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
            const { nextSteps, ...detail } = updated.detail
            const payload = {
              ...refuseTool(updated.rail, detail),
              reason: anEndedPieceSaid(updated.detail, updated.readAt),
            }
            return nextSteps === undefined
              ? refusalAnswer(payload)
              : answer(payload, payload.reason)
          }
          if (
            updated.rail === 'malformed-request' &&
            typeof updated.detail.taskChoice === 'string'
          ) {
            const taskChoice = updated.detail.taskChoice
            return answer(
              { ...refuseTool(updated.rail, updated.detail), reason: taskChoice },
              taskChoice,
            )
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
        let rulesSaid: string | null = null
        if (newRules !== null) {
          try {
            host.setCurrentRules(newRules, by)
            rulesSaid = rulesSaved
          } catch {
            // The piece's update already landed, so this answer still says so.
            rulesSaid = 'Your current rules were not saved; send current_rules again.'
          }
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
          ...(updated.overflow ?? []).map((one) => sendOverflowSaid(one).trim()),
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
          ...(rulesSaid === null ? [] : [rulesSaid]),
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
      "Only for a request a person typed in your own conversation. For work an agent gave you, keep working on that piece; don't call this. Give a short brief and definition_of_done. The piece goes under your current work; name piece if that is unclear. A recorded agent giver is told. Leave work the person gave to the person, or ask them before closing or withdrawing it. Finish with reply_to_parent, then tell the person here.",
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
            'Files holding the detail. Relative paths use this conversation’s working folder.',
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
            ...(taken.overflow ?? []).map((one) => sendOverflowSaid(one).trim()),
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
      ...conversationSearchQuery.shape,
      words: conversationSearchQuery.shape.words.describe(WORK_SEARCH_WORDS.input),
      profile: conversationSearchQuery.shape.profile.describe('Only this profile’s conversations'),
      from: conversationSearchQuery.shape.from.describe('Last active from'),
      to: conversationSearchQuery.shape.to.describe('Last active until'),
    },
    call: (args) =>
      guarded(async () => {
        const input = conversationSearchQuery.safeParse(args)
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
