import { ASKED_TO_STOP } from '../../../shared/how-work-stopped'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { providerDescriptor, PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import type { ToolName } from './catalog'
import {
  aMessageAboutAQueuedPiece,
  outOfReachAnswer,
  theRuleOfAStopForWords,
  whatADeliveryMet,
  whatBecameOfTheStop,
} from './delivery'
import { agentStateWords } from '../../../shared/agent-state'
import { answer, refusalAnswer, sendAnswer } from './answers'
import { carryInterruptRefusal, refuseTool } from './refusals'
import { outboundOverflowSaid, sendFilesSaid, sendOverflowAttachment } from '../send-overflow'
import { sendResourcesInput, sendResourcesProblem } from './send-resources'
import { hasSomethingToSend } from '../../../shared/runtime-ipc'
import { randomUUID } from 'node:crypto'
import { theStoppedWork } from '../reply-rails'
import { workRequestRefused } from '../spawn-rails'
import { z } from 'zod'

export function createCompactAgentTool(
  host: Pick<AgentToolHost, 'compactConversation' | 'theConversationAddressed'>,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: 'compact_agent' } {
  return {
    name: 'compact_agent',
    description:
      "Request compaction of a conversation's context with its provider's own compaction, by any of its labels. Any conversation may; give the reason. The first answer acknowledges the request. When the provider confirms manual compaction, the notice of who requested it and why waits for the conversation's next ordinary input. Use it when get_agent_status shows a high context size and more work is coming.",
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      agent: z.string().describe('The conversation, by any of its labels.'),
      reason: z.string().describe('Why you are asking for compaction.'),
    },
    call: (args) =>
      guarded(async () => {
        const { agent, reason } = args
        if (
          typeof agent !== 'string' ||
          typeof reason !== 'string' ||
          !agent.trim() ||
          !reason.trim()
        ) {
          return refusalAnswer(
            refuseTool('malformed-request', { problems: ['agent and reason are both required'] }),
          )
        }
        const conversation = host.theConversationAddressed(agent, by, me, 'interrupting')
        const result = await host.compactConversation({ conversation, agent: me, reason })
        if (result.ok) {
          return answer(
            { outcome: 'ok', agent: result.conversation, requested: true },
            `Compaction requested for ${result.display}.`,
          )
        }
        if (result.refusal === 'no-such-agent') {
          return refusalAnswer(refuseTool('no-such-agent', { agent }))
        }
        let text: string
        switch (result.refusal) {
          case 'compaction-target-busy':
            text = `Not compacted: ${result.display} is busy. Wait until it is idle, then try again.`
            break
          case 'compaction-target-not-running':
            text = `Not compacted: ${result.display} has no running provider to compact. Open it and wait until it is idle, then try again.`
            break
          case 'compaction-unavailable':
            text = `Not compacted: ${providerDescriptor(result.provider).displayName} offers no compaction for this conversation: its current commands do not include compaction.`
            break
          case 'compaction-request-failed':
            text = `Not compacted: ${result.display} could not start compaction. See its status and try again when it is idle.`
            break
        }
        return answer(
          {
            outcome: 'refused',
            rail: result.refusal,
            reason: text,
            permanence: 'while-this-holds',
            retryable: true,
            remedy: null,
            detail: { agent },
          },
          text,
        )
      }),
  }
}

interface MessageAgentArguments {
  /** The receiving agent. */
  readonly agent: string
  /** The words. */
  readonly text: string
  /** The piece this message is about, by its label or id. */
  readonly piece?: string
  readonly resources?: readonly string[]
  /** `true` asks the receiver's running turn to stop so it reads this message now. */
  readonly interrupt?: boolean
}

const MESSAGE_INTERRUPT_ARGUMENT = 'interrupt' satisfies keyof MessageAgentArguments

/**
 * **The advertised name of the piece it is about, as a key of {@link MessageAgentArguments}** —
 * `415`'s device on the second field it named. **`piece` on every tool that takes one**
 * (`give_work`, `ask_question`, `update_work`, `reply_to_parent`, `withdraw_task`, `list_tasks`), so a
 * model never translates between two spellings of one name.
 */
const MESSAGE_PIECE_ARGUMENT = 'piece' satisfies keyof MessageAgentArguments

export function createMessageAgentTool(
  host: Pick<
    AgentToolHost,
    | 'holdAgentMessageForStart'
    | 'messageDestination'
    | 'messageAgentNow'
    | 'nameByItsWork'
    | 'prepareTextForSend'
    | 'prepareFilesForSend'
    | 'queueMessage'
    | 'receiptForSend'
    | 'stateOfARecordedMessage'
    | 'takeBackWhatItsQuestionMadeFalse'
    | 'tookItsPlace'
    | 'whatAPieceIsTo'
    | 'whatToCallTheConversation'
    | 'whyWhatIsHeldWaits'
  >,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'message_agent',
    handlerOwnsMissingInput: true,
    /**
     * **D-016 · a message hands nothing over, and the sentence says where work goes instead.**
     *
     * **It sent work until D-016** — a third kind opened a task — and a description that still
     * offered it would walk a model into a refusal; work is `give_work`'s now, and the sentence
     * names it.
     */
    description:
      'Send a message to an existing conversation, by any of its labels. To give work, use give_work; to ask something and get the answer back, use ask_question. piece names the task it is about, if any. Hand files with resources. Anything over 2,000 characters arrives as a file the reader is pointed to. It is held until that conversation is free, then delivered with whatever else is held for it, oldest first (a person’s command goes on its own). A message leaves an archived conversation archived. With interrupt: true, the turn that conversation is running is also asked to stop, so the message need not wait for its work to finish; give the reason in the message — the conversation is told who stopped it and why. ' +
      theRuleOfAStopForWords(undefined, 'it') +
      ' Use interrupt only for something it must know before it goes on. The answer names the conversation by its address and title and says what happened: delivered now, held because it is working, or Not sent and why.',

    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **Words into this app's own mailbox.** The reach answers it, and a message to a busy
     * receiver is HELD rather than pushed.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    // With `interrupt`, a call cuts the receiver's running turn, as `interrupt_agent` does.
    beyondItsRailsWhen: (args) =>
      args[MESSAGE_INTERRUPT_ARGUMENT] === true
        ? 'it-destroys-work-in-flight'
        : 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries({
        agent: z
          .string()
          .describe(
            'The conversation, by any of its task labels (W1.2) or its id from list_agents.',
          ),
        text: z.string().describe('What to say to it.'),
        resources: sendResourcesInput,
        piece: z
          .string()
          .optional()
          .describe('The task this is about, by its label (W1.2) or id, if any.'),
        interrupt: z
          .boolean()
          .optional()
          .describe(
            'true also asks the turn that agent is running to stop, so that this message need not wait for its work to finish — a turn can run for hours. Use it only for something the agent must know before it goes on: a change of plan, a request to pause and save where it is. To answer a question it asked you, use answer_question, which asks that turn to stop by default. ' +
              theRuleOfAStopForWords(undefined, 'it') +
              ' Its open questions stay open. The target must be a known conversation. Leave it out for anything that can wait.',
          ),
      } satisfies Readonly<Record<keyof MessageAgentArguments, z.ZodType>>).map(
        ([field, schema]) => [field, agentToolHandlerInput(schema)],
      ),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        const problems: z.core.$ZodIssue[] = []
        const problem = (field: keyof MessageAgentArguments, message: string): void => {
          problems.push({ code: 'custom', path: [field], message })
        }
        const malformed = () => {
          const fields = ['agent', 'text', 'piece', 'resources', 'interrupt']
          const detail = workRequestRefused(problems, args, [...fields, 'kind'])
          const unknown = Object.keys(args).filter((key) => key !== 'kind' && !fields.includes(key))
          if (unknown.length === 0) return refusalAnswer(refuseTool('malformed-request', detail))
          const names = unknown.slice(0, 3).map((key) => {
            const name = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) ? key : 'unknown field'
            return `${name}: not a field of message_agent; use ${fields.join(', ')}`
          })
          if (unknown.length > 3) names.push('Other unknown fields were also sent.')
          // Caller-named problems stay outside the app-composed identity marker.
          return refusalAnswer(
            refuseTool('malformed-request', { problems: [...detail.problems, ...names] }),
          )
        }
        const { agent: spelled, text } = args
        if (spelled === undefined) problem('agent', 'required; send the agent as text')
        else if (typeof spelled !== 'string')
          problems.push({
            code: 'invalid_type',
            path: ['agent'],
            expected: 'string',
            message: 'expected text',
          })
        if (text === undefined) problem('text', 'required; send a non-blank text message')
        else if (typeof text !== 'string')
          problems.push({
            code: 'invalid_type',
            path: ['text'],
            expected: 'string',
            message: 'expected text',
          })
        else if (!hasSomethingToSend(text, 0)) problem('text', 'send a non-blank text message')
        if (typeof spelled !== 'string' || typeof text !== 'string' || problems.length > 0)
          return malformed()
        const interruptAsked = args[MESSAGE_INTERRUPT_ARGUMENT]
        if (interruptAsked !== undefined && typeof interruptAsked !== 'boolean') {
          problem('interrupt', 'send true or false, or leave it out')
        }
        const named = args[MESSAGE_PIECE_ARGUMENT]
        if (named !== undefined && (typeof named !== 'string' || named.length === 0)) {
          problem('piece', 'send a piece label or id as text, or leave it out')
        }
        const resources = sendResourcesInput.safeParse(args.resources)
        if (!resources.success) problem('resources', sendResourcesProblem)
        if (!resources.success || problems.length > 0) return malformed()
        const destination = host.messageDestination(spelled)
        const agent = destination ?? spelled
        // A piece the caller gave that waits, queued, at a service has reached nobody: nothing is
        // sent about it, whether the message names it or is addressed by its label. Asked before
        // reach, which a caller whose piece is only queued does not have.
        const aboutPiece = typeof named === 'string' ? named : spelled
        const it = host.whatAPieceIsTo(me, agent, aboutPiece)
        if (it.is === 'queued-there') {
          return refusalAnswer({
            ...refuseTool('that-piece-is-still-queued', {
              agent,
              piece: it.piece,
              label: it.label,
            }),
            reason: aMessageAboutAQueuedPiece(it.label),
          })
        }
        if (destination === null) return outOfReachAnswer({ is: 'no-such-agent' }, agent)
        let about: { readonly piece: string; readonly label: string } | null = null
        if (typeof named === 'string') {
          if (it.is === 'none') {
            return refusalAnswer(refuseTool('no-piece-by-that-name', { piece: named }))
          }
          about = { piece: it.piece, label: it.label }
        }
        const says = about !== null && it.is === 'given-to-it' ? 'follow-up' : 'note'
        const kept = host.prepareFilesForSend(me, resources.data ?? [], about?.piece)
        if (!kept.ok) return answer({ ...kept.refusal }, `Not sent: ${kept.refusal.reason}`)
        const prepared = host.prepareTextForSend(me, 'text', text, about?.piece)
        if (!prepared.ok) {
          return answer({ ...prepared.refusal }, `Not sent: ${prepared.refusal.reason}`)
        }
        const attachment =
          prepared.overflow === undefined ? '' : outboundOverflowSaid(prepared.overflow)
        const attachments =
          prepared.overflow === undefined
            ? kept.files
            : [...kept.files, sendOverflowAttachment(prepared.overflow)]
        const outgoingText = prepared.text + sendFilesSaid(kept.files)
        const messageAct = `message_act_${randomUUID()}`
        const facts = {
          ...(about === null ? {} : { aboutPiece: about }),
          addressedAs: spelled,
          messageAct,
        }
        const holdingBeforeStart = host.holdAgentMessageForStart(
          agent,
          outgoingText,
          by,
          facts,
          says,
        )
        const heldBeforeStart = holdingBeforeStart === null ? null : await holdingBeforeStart
        if (heldBeforeStart !== null) {
          const { id, to, state } = heldBeforeStart
          if (state.kind === 'started' && says === 'follow-up' && about !== null) {
            host.takeBackWhatItsQuestionMadeFalse({ agent: to, piece: about.piece }, by)
          }
          const { receipt, said } = host.receiptForSend({
            recorded: { kind: 'message', id, taskLabel: about?.label ?? null },
            to,
            state,
            attachments,
            ...(state.kind === 'queued' ? { waitsFor: host.whyWhatIsHeldWaits(to) } : {}),
          })
          return answer(
            {
              outcome: 'ok',
              delivery: state.kind === 'started' ? 'sent' : 'queued',
              messageAct,
              agent,
              kind: says,
              ...(about === null ? {} : { piece: about.piece, label: about.label }),
              ...(to === agent ? {} : { went_to: to }),
              receipt,
            },
            said + attachment,
          )
        }
        try {
          // Hold the message before asking its running turn to stop.
          const now =
            interruptAsked === true
              ? await host.messageAgentNow(agent, outgoingText, by, says, facts)
              : null
          const outcome =
            now === null
              ? await host.queueMessage(
                  agent,
                  outgoingText,
                  by,
                  [],
                  'work',
                  facts,
                  says === 'follow-up' ? says : undefined,
                )
              : now.delivery
          const wentTo = host.tookItsPlace(agent)
          const to = wentTo ?? agent
          const state =
            outcome.outcome === 'sent'
              ? { kind: 'started' as const }
              : host.stateOfARecordedMessage(to, outcome.messageId)
          const waitsFor = state.kind === 'queued' ? host.whyWhatIsHeldWaits(to) : null
          const { receipt, said } = host.receiptForSend({
            recorded: {
              kind: 'message',
              id: outcome.outcome === 'sent' ? messageAct : outcome.messageId,
              taskLabel: about?.label ?? null,
            },
            to,
            state,
            attachments,
            waitsFor,
          })
          const stopped =
            now === null
              ? null
              : whatBecameOfTheStop(
                  now,
                  host.whatToCallTheConversation(to),
                  'this message',
                  (conversation) => conversation === me,
                  (conversation) => host.nameByItsWork(conversation),
                  waitsFor !== null,
                )
          // **703 · a message about a piece this caller gave has reached its holder** (`698` F-A)
          // — what the host still holds for this caller about that piece, saying it is not being
          // worked on, is false now ({@link RuntimeHost.takeBackWhatItsQuestionMadeFalse}).
          // **SENT, never held** (`703`'s review): a held message has reached nobody, and the
          // push is still true.
          if (outcome.outcome === 'sent' && says === 'follow-up' && about !== null) {
            host.takeBackWhatItsQuestionMadeFalse({ agent, piece: about.piece }, by)
          }
          return answer(
            {
              outcome: 'ok',
              delivery: outcome.outcome,
              messageAct,
              receipt,
              agent,
              kind: says,
              ...(about === null ? {} : { piece: about.piece, label: about.label }),
              ...(wentTo === null ? {} : { went_to: wentTo }),
              ...(stopped === null ? {} : stopped.structured),
            },
            said + (stopped === null ? '' : ` ${stopped.said}`) + attachment,
          )
        } catch (error) {
          return whatADeliveryMet(error, agent, 'message_agent')
        }
      }).then(sendAnswer),
  }
}

export function createInterruptAgentTool(
  host: Pick<AgentToolHost, 'interruptAgent' | 'nameByItsWork' | 'theConversationAddressed'>,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'interrupt_agent',

    description:
      'Ask the turn a conversation is running to stop, by any of its labels. Any conversation may do this; give the reason in reason — the conversation is told who stopped it and why. Its conversation stays open and can be given more work. That turn may end there, throwing away what it was part-way through, or may finish anyway; get_agent_status says which once it has stopped working. Work it already recorded and what it already did stay as they were. The stop also ends commands that turn started: ' +
      PROVIDER_DESCRIPTORS.map(
        (descriptor) => `on ${descriptor.displayName}, ${descriptor.words.interruptActionSummary}`,
      ).join('; ') +
      '.' +
      " A command an earlier turn left running keeps running. The answer names what the stop ended and what still runs. A turn waiting on the person's approval is not stopped: the answer says what it is waiting for, and only the person can settle it.",
    /**
     * **486 · a person is asked as well** (HO-031 §2.4).
     *
     * **Its own description says it: the turn is asked to stop, and what it was part-way through is thrown away unless it is finished anyway** (`720`, `709` F-9). `INTERRUPT_RAILS` refuse the case where cutting the turn would answer a person's card.
     */
    beyondItsRails: 'it-destroys-work-in-flight',
    input: {
      agent: z
        .string()
        .describe('The conversation, by any of its task labels or its id from list_agents.'),
      reason: z
        .string()
        .describe(
          'Why you are stopping it. The conversation reads this, with your name, before it goes on.',
        ),
    },
    call: (args) =>
      guarded(async () => {
        const { agent, reason } = args
        if (typeof agent !== 'string' || typeof reason !== 'string' || reason.length === 0) {
          return refusalAnswer(
            refuseTool('malformed-request', { problems: ['agent and reason are both required'] }),
          )
        }
        const addressed = host.theConversationAddressed(agent, by, me, 'interrupting')
        // **Every refusal arrives as a value, so there is no catch** (395): an interrupt that
        // failed for any other reason is a bug, and reporting one as a refusal would tell a model a
        // person could fix it.
        const outcome = await host.interruptAgent(addressed, by, reason)
        if (!outcome.ok) {
          // **Two vocabularies meet here and neither is rewritten.** `'no-such-agent'` is
          // `TOOL_REFUSALS`' word — the same one every door gives about an id no conversation has
          // — and everything else is an `INTERRUPT_RAILS` payload carried unchanged.
          if (outcome.refusal === 'no-such-agent') {
            return refusalAnswer(refuseTool(outcome.refusal, { agent: addressed }))
          }
          const carried = carryInterruptRefusal(outcome.refusal)
          return answer(
            carried,
            outcome.refusal.detail.approval === undefined
              ? `refused (${outcome.refusal.rail}): ${outcome.refusal.reason}`
              : outcome.refusal.reason,
          )
        }
        const now = agentStateWords(outcome.state)
        // **D-016 · commit 7 · R3 — named by the piece it owns**; the payload keeps its id.
        const called = host.nameByItsWork(outcome.agent)
        // **F084 · what the stop ended, and what is still running in its background, named**, on
        // either arm: a caller stopping work to free the machine reads what still uses it and the
        // one door that ends it from here — the agent itself, asked. Branches of their own, so
        // the two ordinary answers below stay as they were.
        // Absent when the stopped turn had not ended within the wait: unknown, so not said.
        const endedNow =
          outcome.ended === undefined || outcome.ended.length === 0
            ? ''
            : ` The stop ended ${theStoppedWork(outcome.ended)}.`
        const runsOn =
          outcome.stillRunning.length === 0
            ? ''
            : ` It still has ${theStoppedWork(outcome.stillRunning)} running in the background, which a stop does not end; to end that, ask it with message_agent.`
        const leftRunning = endedNow === '' && runsOn === '' ? null : `${endedNow}${runsOn}`
        if (!outcome.asked) {
          if (leftRunning !== null) {
            return answer(
              {
                outcome: 'ok',
                agent: outcome.agent,
                asked: false,
                state: now,
                still_running: outcome.stillRunning,
              },
              `${called} had no turn running, so nothing was interrupted and it was not asked anything. Its state now: ${now}.${leftRunning}`,
            )
          }
          return answer(
            { outcome: 'ok', agent: outcome.agent, asked: false, state: now },
            `${called} had no turn running, so nothing was interrupted and it was not asked anything. Its state now: ${now}.`,
          )
        }
        if (leftRunning !== null) {
          return answer(
            {
              outcome: 'ok',
              agent: outcome.agent,
              asked: true,
              state: now,
              ...(outcome.ended === undefined ? {} : { ended: outcome.ended }),
              still_running: outcome.stillRunning,
            },
            `${called} was ${ASKED_TO_STOP}. Its state now: ${now}.${leftRunning}`,
          )
        }
        return answer(
          { outcome: 'ok', agent: outcome.agent, asked: true, state: now },
          `${called} was ${ASKED_TO_STOP}. Its state now: ${now}.`,
        )
      }),
  }
}
