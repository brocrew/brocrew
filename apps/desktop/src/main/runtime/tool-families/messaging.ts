import { AGENT_MESSAGE_KINDS, type AgentMessageKind } from '../../../shared/task-contracts'
import { ASKED_TO_STOP } from '../../../shared/how-work-stopped'
import { A_CONVERSATION_CANNOT_INTERRUPT_ITSELF } from './launch-failures'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { TOOL_INPUT_ENUMS, type ToolName, documentedToolEnum } from './catalog'
import {
  WITH_WHATEVER_ELSE_IS_HELD,
  aFollowUpOnAPieceYouDidNotGive,
  aFollowUpOnAPieceYouGaveAnother,
  aFollowUpOnAPieceYouHold,
  aMessageAboutAQueuedPiece,
  heldAndWhy,
  outOfReachAnswer,
  theRuleOfAStopForWords,
  whatADeliveryMet,
  whatBecameOfTheStop,
  whereItWent,
} from './delivery'
import { agentStateWords } from '../../../shared/agent-state'
import { answer, refusalAnswer } from './answers'
import { carryInterruptRefusal, carryMessageRefusal, refuseTool } from './refusals'
import { type conversationAddressing } from './addressing'
import { hasSomethingToSend } from '../../../shared/runtime-ipc'
import { isAgentMessageKind } from '../../../shared/tasks'
import { randomUUID } from 'node:crypto'
import { theStoppedWork } from '../reply-rails'
import { workRequestRefused } from '../spawn-rails'
import { z } from 'zod'

interface MessageAgentArguments {
  /** The receiving agent. */
  readonly agent: string
  /** The words. */
  readonly text: string
  /**
   * **What the caller says the message IS** — one of `AGENT_MESSAGE_KINDS`. **Required since
   * D-010, at the handler and not in the schema**: a schema-required argument is refused by the MCP
   * SDK before this door runs on Claude and handed over unparsed on Codex (`538` §3.3), so only the
   * handler refuses its absence the same way on both.
   */
  readonly kind?: AgentMessageKind
  /**
   * **The piece this message is ABOUT** (429 as a task; a piece since D-016) — by its label
   * (`W1.2`) or its id.
   *
   * **It hands nothing over and it opens nothing**: work is given with `give_work`. **What it
   * may name depends on the kind** (D-016 spec D14): a follow-up adds to a piece the sender gave
   * that agent, so it must name one; a note may name a piece the sender holds or gave, or none.
   * It is written on the SENDER's receipt (`message_sent.piece`) and read by nothing on the
   * receiver's side.
   */
  readonly piece?: string
  /** `true` asks the receiver's running turn to stop so it reads this message now. */
  readonly interrupt?: boolean
}

/**
 * **The advertised name of the declaration, as a key of {@link MessageAgentArguments}** (415) —
 * see that interface for what the typing buys.
 */
const MESSAGE_KIND_ARGUMENT = 'kind' satisfies keyof MessageAgentArguments

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
    | 'addressOf'
    | 'mayReachAtAll'
    | 'messageAgentNow'
    | 'nameByItsWork'
    | 'queueMessage'
    | 'takeBackWhatItsQuestionMadeFalse'
    | 'tookItsPlace'
    | 'whatAPieceIsTo'
    | 'whatToCallTheConversation'
    | 'whyItIsOutOfReach'
    | 'whyWhatIsHeldWaits'
  >,
  by: Caller,
  me: string,
  selfRefusal: ReturnType<typeof conversationAddressing>['selfRefusal'],
  theConversationToReach: ReturnType<typeof conversationAddressing>['theConversationToReach'],
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
     * names it. The sentence INSTRUCTS rather than describing `can_message` (standing rule 8).
     */
    description:
      'Send a message to an agent: a note for its information, or a follow-up on a piece of work you gave it, which you name — say which. To give work, use give_work; to ask something and get the answer back, use ask_question. It is held until that agent is free, then delivered with whatever else is held for it, oldest first (a person\u2019s command goes on its own). With interrupt: true, the turn that agent is running is also asked to stop, so that the message need not wait for its work to finish; the agent is told who asked for the stop. ' +
      theRuleOfAStopForWords(undefined, 'it') +
      ' Use interrupt only for something the agent must know before it goes on, not for a routine note, and only for an agent you started or one started under it. Says whether the message is held or went straight out, and what became of the stop.',

    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **Words into this app's own mailbox.** `can_message` and the reach answer it, and a message
     * to a busy receiver is HELD rather than pushed.
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
          .describe('The agent, by the piece it owns (W1.2) or by its id from list_agents.'),
        text: z.string().describe('What to say to it.'),
        /**
         * **The shared enum schema publishes the words without moving validation out of this
         * door** (`490`, preserving `325`'s rule). Its catch hands an unknown word through, so this
         * file can answer with the structured refusal `307` requires instead of a transport error.
         * **A vocabulary the validator has not been taught is a refusal that NAMES the
         * vocabulary, never a pass and never a transport error.**
         */
        kind: documentedToolEnum(
          TOOL_INPUT_ENUMS['message_agent:kind'],
          'What this message is.',
          'There is no default: say which. A note can go to any agent you may message; a follow-up ' +
            'goes only to an agent you gave a piece to, and names that piece.',
        ).optional(),
        /**
         * **429 · the reference, and the tool's own description is where it may be taught** —
         * a piece since D-016. **It says what the field DOES for each kind**, because a follow-up
         * requires one and a note does not.
         */
        piece: z
          .string()
          .optional()
          .describe(
            'The piece this is about, by its label (W1.2) or id. A follow-up must name a piece you gave that agent; a note may name one you hold or gave, or none. list_tasks names them.',
          ),
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
        // **486 · the standing wall first** (HO-031 §2.5). **`may-not-message` sat behind
        // both the shape below and `no-such-agent`**, and both of those are `permanent` — so a
        // caller a person had granted no reach at all was told *change the call* about a wall no
        // call changes. Argument-independent by construction: {@link RuntimeHost.mayReachAtAll}
        // asks the caller's own grant and nothing about the target this line has not read.
        const wall = host.mayReachAtAll('message', by)
        if (wall !== null) {
          return answer(carryMessageRefusal(wall), `refused (${wall.rail}): ${wall.reason}`)
        }
        args = toolArgumentsAtHandler(args)
        const problems: z.core.$ZodIssue[] = []
        const problem = (field: keyof MessageAgentArguments, message: string): void => {
          problems.push({ code: 'custom', path: [field], message })
        }
        const malformed = () => {
          const fields = ['agent', 'text', 'kind', 'piece', 'interrupt']
          const detail = workRequestRefused(problems, args, fields)
          const unknown = Object.keys(args).filter((key) => !fields.includes(key))
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
        // **The caller's own declaration, validated here** (415) — and required since D-010
        // (see `AGENT_MESSAGE_KINDS`): a caller that has not said which it means has not decided,
        // and no default decides for it.
        const declared = args[MESSAGE_KIND_ARGUMENT]
        if (!isAgentMessageKind(declared)) {
          problem(
            'kind',
            `required; send one of ${AGENT_MESSAGE_KINDS.join(', ')}; use ask_question to ask for an answer`,
          )
          return malformed()
        }
        const says: AgentMessageKind = declared
        const interruptAsked = args[MESSAGE_INTERRUPT_ARGUMENT]
        if (interruptAsked !== undefined && typeof interruptAsked !== 'boolean') {
          problem('interrupt', 'send true or false, or leave it out')
        }
        if (args.piece !== undefined && typeof args.piece !== 'string') {
          problem('piece', 'send a piece label or id as text, or leave it out')
        }
        if (problems.length > 0) return malformed()
        // **D-016 · commit 7 · R1 — a label names its piece's owner**, after the call's own shape
        // and before the first rail that reads the target: one that names nothing this caller may
        // reach is handed back as spelled, and meets `no-such-agent` below as an unknown id does.
        // An agent's profile name names its one conversation in reach.
        const reached = theConversationToReach(spelled, true)
        if ('refused' in reached) return reached.refused
        const agent = reached.agent
        // A piece the caller gave that waits, queued, at a service has reached nobody: nothing is
        // sent about it, whether the message names it or is addressed by its label. Asked before
        // reach, which a caller whose piece is only queued does not have.
        const namedFirst = args[MESSAGE_PIECE_ARGUMENT]
        const aboutPiece =
          typeof namedFirst === 'string' && namedFirst !== '' ? namedFirst : spelled
        {
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
        }
        const out = host.whyItIsOutOfReach(agent, by, me, true)
        if (out !== null) return outOfReachAnswer(out, agent)
        if (agent === me || host.tookItsPlace(agent) === me) {
          return selfRefusal(spelled, agent)
        }
        // **429 · the piece it is about, validated ONCE** — {@link MESSAGE_PIECE_ARGUMENT}. Its
        // own shape refusal rather than a fold into the empty-string guard above: `piece: 42` is a
        // caller naming a piece wrong, not a caller with no text. **A follow-up must name one**
        // (D-016 spec D14): it adds to a piece the sender gave, and says which.
        const named = args[MESSAGE_PIECE_ARGUMENT]
        if (
          (named !== undefined && (typeof named !== 'string' || named.length === 0)) ||
          (says === 'follow-up' && named === undefined)
        ) {
          problem(
            'piece',
            says === 'follow-up'
              ? 'on a follow-up, send the label or id of a piece you gave that agent'
              : 'send the label or id of a piece you hold or gave, or leave it out',
          )
          return malformed()
        }
        let about: { readonly piece: string; readonly label: string } | null = null
        if (typeof named === 'string') {
          // **The lookup is the entitlement** ({@link RuntimeHost.whatAPieceIsTo}): a piece is
          // this caller's to name only as one it gave or one it holds, so one answer covers a name
          // that names nothing and one that is somebody else's. **F086 · a note names either,
          // open or ended** — a piece it held is still its own once answered, taken back or closed,
          // as one it gave is. A follow-up names one it gave that agent; a piece it held that has
          // ended is not that, and is refused `not-a-piece-you-gave` below, never
          // `that-is-work-you-hold`, whose acts — ask about it, hand it back — an ended piece refuses.
          const it = host.whatAPieceIsTo(me, agent, named)
          if (says === 'follow-up' && it.is !== 'given-to-it') {
            // **628 · is it work this caller HOLDS?** (`HO-095` §3.1 · §3.2). That is the case
            // the whole chain came from: a manager naming the piece its parent gave IT, addressed
            // to that parent. The sentence names the two verbs that are right for work it holds.
            // **F087 · a piece the caller holds that has ended, or gave another agent, is said
            // as what it is** — `not-a-piece-you-gave`, with the act left. A name that is
            // neither points at a note to the same agent, which it may message.
            if (it.is === 'held-and-ended') {
              return refusalAnswer({
                ...refuseTool('not-a-piece-you-gave', {
                  agent,
                  piece: it.piece,
                  label: it.label,
                }),
                reason: aFollowUpOnAPieceYouHold(it.label),
              })
            }
            if (it.is === 'given-to-another') {
              return refusalAnswer({
                ...refuseTool('not-a-piece-you-gave', {
                  agent,
                  piece: it.piece,
                  label: it.label,
                }),
                reason: aFollowUpOnAPieceYouGaveAnother(it.label),
              })
            }
            return refusalAnswer(
              it.is === 'held'
                ? refuseTool('that-is-work-you-hold', { piece: it.piece, label: it.label })
                : it.is === 'its-root'
                  ? refuseTool('that-is-your-own-work', { piece: it.piece, label: it.label })
                  : {
                      ...refuseTool('not-a-piece-you-gave', { agent, piece: named }),
                      reason: aFollowUpOnAPieceYouDidNotGive(spelled),
                    },
            )
          }
          if (it.is === 'none') {
            return refusalAnswer(refuseTool('no-piece-by-that-name', { piece: named }))
          }
          about = { piece: it.piece, label: it.label }
        }
        try {
          // **The three arguments between are this call's own values and not padding**: no
          // attachment, the work slot in the receiver's mailbox — see `MAILBOX_KINDS`, which
          // decides whether a SECOND message may be held and is a different question from the one
          // `says` answers — and no turn facts, which only the app's own doors carry.
          // **D-017 · R1 — a conversation that is not running is started for it** (the host's
          // `deliverWhenItRuns`), so the receipt says what reached it and never whether it ran.
          // **D-017 · R10 — whether it had already been replaced**, so the receipt says once, to
          // the sender whose message found it could never be reopened, what happened.
          const before = host.tookItsPlace(agent)
          const messageAct = `message_act_${randomUUID()}`
          const facts = {
            ...(about === null ? {} : { aboutPiece: about }),
            addressedAs: spelled,
            messageAct,
          }
          // Hold the message before asking its running turn to stop.
          const now =
            interruptAsked === true
              ? await host.messageAgentNow(agent, text, by, says, facts)
              : null
          const outcome =
            now === null
              ? await host.queueMessage(agent, text, by, [], 'work', facts, says)
              : now.delivery
          const wentTo = host.tookItsPlace(agent)
          const where = whereItWent(agent, before, wentTo, host)
          // **D-016 · commit 7 · R3 — the receiver by the piece it owns**: one agent can hold many
          // conversations, and nothing else in these words says which one took the message.
          const called = host.nameByItsWork(wentTo ?? agent)
          // **…named in full ONCE, and by its name alone after that**: the full name is a
          // sentence of its own, and five of them made one paragraph hard to read.
          const again = host.whatToCallTheConversation(wentTo ?? agent)
          const heldBecause =
            outcome.outcome === 'sent'
              ? null
              : heldAndWhy(host, wentTo ?? agent, `${where}held for ${called}.`)
          const stopped =
            now === null
              ? null
              : whatBecameOfTheStop(
                  now,
                  again,
                  'this message',
                  (conversation) => conversation === me,
                  (conversation) => host.nameByItsWork(conversation),
                  heldBecause !== null,
                )
          // **703 · a message about a piece this caller gave has reached its holder** (`698` F-A)
          // — what the host still holds for this caller about that piece, saying it is not being
          // worked on, is false now ({@link RuntimeHost.takeBackWhatItsQuestionMadeFalse}).
          // **SENT, never held** (`703`'s review): a held message has reached nobody, and the
          // push is still true.
          if (outcome.outcome === 'sent' && about !== null) {
            host.takeBackWhatItsQuestionMadeFalse({ agent, piece: about.piece }, by)
          }
          // **The held message's id stays inside the app** (490). It names the receiver's
          // cancellable mailbox entry, and the renderer's `cancelQueuedMessage` command accepts
          // it; no AGENT tool does. Returning it here gave this caller a handle it could neither
          // read nor act on and looked like the delivery receipt the app does not have. The id
          // remains on both durable ledgers and in the live disclosure for the person who can
          // actually cancel it; this answer reports only the outcome this caller can use.
          // The words do not echo the kind the call declared; the payload keeps it.
          if (outcome.outcome === 'sent') {
            return answer(
              {
                outcome: 'ok',
                delivery: 'sent',
                messageAct,
                agent,
                kind: says,
                ...(about === null ? {} : { piece: about.piece, label: about.label }),
                ...(wentTo === null ? {} : { went_to: wentTo }),
                ...(stopped === null ? {} : stopped.structured),
              },
              `${where}${called} has been sent it straight away.${stopped === null ? '' : ` ${stopped.said}`}`,
            )
          }
          return answer(
            {
              outcome: 'ok',
              delivery: 'queued',
              messageAct,
              agent,
              kind: says,
              ...(about === null ? {} : { piece: about.piece, label: about.label }),
              ...(wentTo === null ? {} : { went_to: wentTo }),
              ...(stopped === null ? {} : stopped.structured),
            },
            // **657 · true in both arms a hold now has.** It said *"when the turn it is
            // running now ends"*, and a message held after a lost race can find the winning turn
            // already over — it then goes at once, with no turn to wait for. **D-027 · and
            // WITH whatever else is held for it**: the mailbox goes out as one turn, oldest first,
            // so a notice or another caller's words can be in the same turn, ahead of this one —
            // up to a person's command, which goes alone ({@link WITH_WHATEVER_ELSE_IS_HELD}).
            (heldBecause ??
              `${where}held for ${called}; it goes out once ${again} is free — at once, ` +
                `if it is — ${WITH_WHATEVER_ELSE_IS_HELD}.`) +
              (stopped === null ? '' : ` ${stopped.said}`),
          )
        } catch (error) {
          return whatADeliveryMet(error, agent, 'message_agent')
        }
      }),
  }
}

export function createInterruptAgentTool(
  host: Pick<
    AgentToolHost,
    'interruptAgent' | 'nameByItsWork' | 'theConversationAddressed' | 'tookItsPlace'
  >,
  by: Caller,
  me: string,
  selfRefusal: ReturnType<typeof conversationAddressing>['selfRefusal'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'interrupt_agent',

    description:
      'Ask a known conversation to stop what it is doing right now. Its conversation stays open and it can be given something else. It asks the turn it is in to stop: that turn may end there, throwing away whatever it was part-way through, or it may be finished anyway — once the agent is no longer working, get_agent_status says which, so read it there before you rely on either. The stop also ends commands that turn started: ' +
      PROVIDER_DESCRIPTORS.map(
        (descriptor) => `on ${descriptor.displayName}, ${descriptor.words.interruptActionSummary}`,
      ).join('; ') +
      '.' +
      ' A command an earlier turn left running keeps running. The answer names what the stop ended, once that turn has ended, and what still runs. The agent is not told who stopped it or why — only, the next time it is sent words, which of its commands the stop ended: to stop its turn and tell it why in one act, use message_agent with interrupt.',
    /**
     * **486 · a person is asked as well** (HO-031 §2.4).
     *
     * **Its own description says it: the turn is asked to stop, and what it was part-way through is thrown away unless it is finished anyway** (`720`, `709` F-9). `INTERRUPT_RAILS` refuse the case where cutting the turn would answer a person's card.
     */
    beyondItsRails: 'it-destroys-work-in-flight',
    input: {
      agent: z
        .string()
        .describe('The agent, by the piece it owns (W1.2) or by its id from list_agents.'),
      reason: z
        .string()
        .describe(
          'Why you are stopping it. This is for you, not for it: the agent never sees these words and this app does not keep them. Required so that destroying work in flight is a stated decision.',
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
        // **F091 · that is this conversation** — its own id, a piece it holds (a label names its
        // owner), or one it took the place of, whose place it now stands in: `message_agent`'s word
        // for the same address, with the acts an interrupt has.
        if (addressed === me || host.tookItsPlace(addressed) === me) {
          return selfRefusal(agent, addressed, {
            ...refuseTool('that-agent-is-you', { agent: addressed }),
            reason: A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
          })
        }
        // **Every refusal arrives as a value, so there is no catch** (395): an interrupt that
        // failed for any other reason is a bug, and reporting one as a refusal would tell a model a
        // person could fix it.
        const outcome = await host.interruptAgent(addressed, by)
        if (!outcome.ok) {
          // **Two vocabularies meet here and neither is rewritten.** `'no-such-agent'` is
          // `TOOL_REFUSALS`' word — the same one every door gives about an id no conversation has
          // — and everything else is an `INTERRUPT_RAILS` payload carried unchanged.
          if (outcome.refusal === 'no-such-agent' || outcome.refusal === 'that-agent-is-you') {
            return refusalAnswer(refuseTool(outcome.refusal, { agent: addressed }))
          }
          const carried = carryInterruptRefusal(outcome.refusal)
          return answer(carried, `refused (${outcome.refusal.rail}): ${outcome.refusal.reason}`)
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
