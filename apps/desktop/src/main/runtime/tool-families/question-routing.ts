import { toolFieldProblems } from './field-problems'
import { A_CONVERSATION_CANNOT_ASK_ITSELF } from './launch-failures'
import { DONE } from '../agent-tool-answer-words'
import { THE_ANSWER_ARRIVES_AS_A_MESSAGE } from '../send-receipt'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { DO_IT_HERE, MOVE_IT } from '../../../shared/move-request'
import type { QuestionRecipient } from '../../../shared/question-contracts'
import { QUESTION_RECIPIENTS, isQuestionRecipient } from '../../../shared/questions'
import {
  REPLY_ADDRESSING_KEYS,
  TOOL_INPUT_ENUMS,
  type ToolName,
  documentedToolEnum,
} from './catalog'
import { INLINE_TEXT_LIMIT, sendOverflowAttachment, sendOverflowSaid } from '../send-overflow'
import { sendResourcesInput, sendResourcesProblem } from './send-resources'
import { answer, refusalAnswer, sendAnswer } from './answers'
import { carryQuestionRefusal, refuseTool } from './refusals'
import { type conversationAddressing } from './addressing'
import { outOfReachAnswer } from './delivery'
import { workRequestRefused } from '../spawn-rails'
import { z } from 'zod'
import {
  ASK_AGENT_ARGUMENT,
  ASK_OPTIONS_ARGUMENT,
  ASK_PIECE_ARGUMENT,
  ASK_QUESTION_ARGUMENT,
  ASK_WHO_ARGUMENT,
  type AskQuestionArguments,
} from './question-arguments'

export function createAskQuestionTool(
  host: Pick<
    AgentToolHost,
    'raiseAQuestion' | 'receiptForSend' | 'tookItsPlace' | 'whyItIsOutOfReach'
  >,
  by: Caller,
  me: string,
  selfRefusal: ReturnType<typeof conversationAddressing>['selfRefusal'],
  theConversationToReach: ReturnType<typeof conversationAddressing>['theConversationToReach'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'ask_question',
    handlerOwnsMissingInput: true,

    description:
      "Ask a question and get the answer back. who_answers: the-parent (the conversation that gave you this task), a-person, or an-agent (any existing conversation, named in agent by any of its labels). Ask whoever is likeliest to know, usually your giver. Ask the person only for what only they can give: an approval, a sign-in, an account switch, publishing, a yes on something they can see, a preference, a money or time commitment, or a fact only they know. Check their open questions first (list_questions) so nothing is asked twice, and name the job by its title. To ask the person to approve something for another agent, quote or attach that agent's exact proposal. Name the task the question is about, or leave it out when you hold only one. Any work stays yours and stays open — this is not reply_to_parent, which hands it back. Hand files with resources. Anything over 2,000 characters arrives as a file the reader is pointed to. Asking an archived conversation leaves it archived. This call does not wait for an answer: it says what was recorded (the question id) and whether the one asked started, is queued, or can't run, and the answer reaches you later as a message. An answer can ask the turn you are in to stop, so that you read it at once. On Claude, the command that turn is waiting on ends with it, and work you sent to the background keeps running; on Codex, the command you ran last in that turn ends with it unless you have used another tool since, and your other commands keep running. Your other questions stay open. If the one you asked can't answer, you are told why. withdraw_question takes a question back; withdraw your open questions about a task when it ends. Carry on from here.",
    /**
     * **Advertised against a TYPE, so *documented* and *read* cannot drift apart** — see
     * {@link AskQuestionArguments}, including which addressee it does and does not take.
     */
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **A question about work this caller is holding**, and since `608` it holds nothing
     * open. `reply_to_parent`'s argument, one direction. **611 · addressing it to a person
     * adds no rail and needs none**: it puts a row in that person's queue, which is a disclosure
     * of the caller's own question and names nothing the caller did not write.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries({
        move_to: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Reuse relevant work here; offer move_to when continuing there helps. Only the person's press moves the request. Offer to move the person's current request to this conversation, by its work label or id. Use who_answers a-person and leave options and agent out. No piece is needed for a move offer. Write your short answer in your reply as usual.",
          ),
        piece: z
          .string()
          .optional()
          .describe(
            'The piece this question is about, by its label (W1.2) or id. The message that gave it to you names it, and list_tasks lists what you hold. Leave it out when you hold only one piece — one whose brief has not reached you yet does not count; with an-agent, leave it out when the question is about none of your work.',
          ),
        agent: z
          .string()
          .optional()
          .describe(
            'The conversation this question is for, by any of its task labels (W1.2) or its id from list_agents. Required when who_answers is an-agent, and only then.',
          ),
        question: z
          .string()
          .describe(
            `What you need answered, in your own words. Anything over 2,000 characters arrives as a file the reader is pointed to. It shows under Waiting on you with Markdown: **bold**, lists, \`code\` for ids and paths, and links to files.`,
          ),
        resources: sendResourcesInput,
        who_answers: documentedToolEnum(
          TOOL_INPUT_ENUMS['ask_question:who_answers'],
          'Who this question is for.',
          'There is no default: say which. It is where the question GOES, not who is allowed to answer it.',
        ),
        options: z
          .array(z.string())
          .optional()
          .describe(
            `The choices you are offering, at most 2,000 characters in total. Leave it out for a free answer.`,
          ),
      } satisfies Readonly<Record<keyof AskQuestionArguments, z.ZodType>>).map(
        ([field, schema]) => [field, agentToolHandlerInput(schema)],
      ),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        // **The SAME list `reply_to_parent` refuses, shared rather than copied** (437). A
        // second list would be a rail with a typo in it the day either was extended.
        // **D-009 · `agent` is now this tool's own argument**, so it is not one of the spellings
        // of *send it to this one* that are refused here.
        const aimed = REPLY_ADDRESSING_KEYS.filter(
          (key) => key !== ASK_AGENT_ARGUMENT && Object.hasOwn(args, key),
        )
        if (aimed.length > 0) {
          return refusalAnswer(
            refuseTool('malformed-request', {
              // **611 · the sentence says what IS an argument now** (HO-088 §2.1, standing
              // rule 8.1). It read *"a question goes to the conversation that gave you the
              // task"*, which was true until a question could be addressed to a person — and a
              // refusal that states a false fact about the mechanism is `HO-070` §3's *an agent
              // that stops asking*. **The two ends are named**, because a model that tried to
              // aim a question was trying to do a thing this tool now does, with a different
              // field.
              problems: aimed.map(
                (key) =>
                  `${key} is not an argument of this tool: ${ASK_WHO_ARGUMENT} says who a question is for and it takes ${QUESTION_RECIPIENTS.join(' or ')}, ${ASK_AGENT_ARGUMENT} names the agent for an-agent, and naming the piece is how you say which work it is about`,
              ),
            }),
          )
        }
        const piece = args[ASK_PIECE_ARGUMENT]
        const question = args[ASK_QUESTION_ARGUMENT]
        const offered = args[ASK_OPTIONS_ARGUMENT]
        const who = args[ASK_WHO_ARGUMENT]
        const agent = args[ASK_AGENT_ARGUMENT]
        // Only declared field paths, fixed type words and measured counts enter these issues.
        const { problems, problem, wrongType } = toolFieldProblems<keyof AskQuestionArguments>()
        const resources = sendResourcesInput.safeParse(args.resources)
        if (!resources.success) problem('resources', sendResourcesProblem)
        const moveTo = args.move_to
        if (
          moveTo !== undefined &&
          (typeof moveTo !== 'string' ||
            moveTo.length === 0 ||
            moveTo.length > 200 ||
            who !== 'a-person' ||
            offered !== undefined ||
            agent !== undefined)
        ) {
          if (typeof moveTo !== 'string' || moveTo.length === 0 || moveTo.length > 200) {
            problem('move_to', 'expected non-empty text of at most 200 characters')
          } else {
            problem('move_to', 'use who_answers a-person and leave options and agent out')
          }
        }
        if (!isQuestionRecipient(who)) {
          problem(ASK_WHO_ARGUMENT, `required; expected one of ${QUESTION_RECIPIENTS.join(', ')}`)
        }
        if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {
          if (typeof piece !== 'string') wrongType(ASK_PIECE_ARGUMENT)
          else problem(ASK_PIECE_ARGUMENT, 'must not be empty')
        }
        if (who === 'an-agent') {
          if (typeof agent !== 'string' || agent.length === 0) {
            if (agent === undefined) {
              problem(
                ASK_AGENT_ARGUMENT,
                'required when who_answers is an-agent; expected non-empty text',
              )
            } else if (typeof agent !== 'string') wrongType(ASK_AGENT_ARGUMENT)
            else problem(ASK_AGENT_ARGUMENT, 'must not be empty')
          }
        } else {
          if (agent !== undefined) {
            problem(ASK_AGENT_ARGUMENT, 'leave it out unless who_answers is an-agent')
          }
        }
        if (typeof question !== 'string' || question.length === 0) {
          if (question === undefined)
            problem(ASK_QUESTION_ARGUMENT, 'required; expected non-empty text')
          else if (typeof question !== 'string') wrongType(ASK_QUESTION_ARGUMENT)
          else problem(ASK_QUESTION_ARGUMENT, 'must not be empty')
        }
        const options: string[] = []
        if (offered !== undefined) {
          if (!Array.isArray(offered) || offered.some((one) => typeof one !== 'string')) {
            problem(ASK_OPTIONS_ARGUMENT, 'expected a list of text choices')
          } else {
            options.push(...(offered as string[]))
          }
        }
        const offeredLength = options.reduce((total, one) => total + one.length, 0)
        if (offeredLength > INLINE_TEXT_LIMIT) {
          problem(
            ASK_OPTIONS_ARGUMENT,
            `at most ${INLINE_TEXT_LIMIT.toLocaleString('en-US')} characters in total; got ${offeredLength.toLocaleString('en-US')}`,
          )
        }
        if (!resources.success || problems.length > 0) {
          const fields = [
            ASK_PIECE_ARGUMENT,
            ASK_QUESTION_ARGUMENT,
            ASK_OPTIONS_ARGUMENT,
            ASK_WHO_ARGUMENT,
            ASK_AGENT_ARGUMENT,
            'resources',
            'move_to',
          ]
          const detail = workRequestRefused(problems, args, fields)
          const unknown = Object.keys(args).filter((key) => !fields.includes(key))
          if (unknown.length === 0) return refusalAnswer(refuseTool('malformed-request', detail))
          const names = unknown.slice(0, 3).map((key) => {
            const name = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) ? key : 'unknown field'
            return `${name}: not a field of ask_question; use ${fields.join(', ')}`
          })
          if (unknown.length > 3) names.push('Other unknown fields were also sent.')
          // Caller-named problems stay outside the app-composed identity marker.
          return refusalAnswer(
            refuseTool('malformed-request', { problems: [...detail.problems, ...names] }),
          )
        }
        // **D-016 · commit 7 · R1 — a label names its piece's owner** when this caller may reach
        // it; one that names nothing it may reach is handed back as spelled, and meets this door's
        // own word for an agent it cannot ask, as an unknown id does.
        const addressed =
          who === 'an-agent' && typeof agent === 'string' ? theConversationToReach(agent) : null
        // Unknown addresses keep the host’s refusal; reachable self-addresses are named here.
        if (addressed !== null && addressed !== me) {
          const out = host.whyItIsOutOfReach(addressed, by, me)
          if (out !== null && out.is !== 'no-such-agent') return outOfReachAnswer(out, addressed)
        }
        if (addressed !== null && (addressed === me || host.tookItsPlace(addressed) === me)) {
          return selfRefusal(agent as string, addressed, {
            ...refuseTool('that-agent-is-you', { agent: addressed }),
            reason: A_CONVERSATION_CANNOT_ASK_ITSELF,
          })
        }
        // The host checks the work and records the question.
        const asked = await host.raiseAQuestion(
          {
            piece: typeof piece === 'string' ? piece : null,
            question: question as string,
            options: moveTo === undefined ? options : [MOVE_IT, DO_IT_HERE],
            ...(resources.data === undefined ? {} : { resources: resources.data }),
            ...(typeof moveTo === 'string' ? { moveTo } : {}),
            who: who as QuestionRecipient,
            agent: addressed,
          },
          by,
        )
        if (!asked.ok) {
          const carried = carryQuestionRefusal(asked.refusal)
          return answer(carried, `refused (${asked.refusal.rail}): ${asked.refusal.reason}`)
        }
        if (moveTo !== undefined)
          return answer(
            { outcome: 'ok', question: asked.question, went_to: 'a-person' },
            "The Move card is under Waiting on you. Write your reply in this turn as usual. Only the person's press moves the person's current request; a text reply keeps it here." +
              (asked.overflow === undefined ? '' : sendOverflowSaid(asked.overflow)),
          )
        const overflow = asked.overflow
        const files = asked.files ?? []
        const delivery = asked.delivery
        const recorded =
          delivery === undefined
            ? undefined
            : host.receiptForSend({
                recorded: { kind: 'question', id: asked.question, taskLabel: delivery.taskLabel },
                to: delivery.to,
                state: delivery.state,
                attachments:
                  overflow === undefined ? files : [...files, sendOverflowAttachment(overflow)],
              })
        return answer(
          // **611 · the payload says WHERE it went**, which is the one thing this call's
          // outcome varies in. **D-016 · the host's answer, not the caller's declaration**: a
          // question for whoever gave a conversation's own work goes to a person (spec D15).
          {
            outcome: 'ok',
            question: asked.question,
            went_to: asked.went,
            ...(asked.went === 'an-agent' ? { agent: addressed } : {}),
            ...(recorded === undefined ? {} : { receipt: recorded.receipt }),
            ...(recorded === undefined && files.length > 0 ? { resources: files } : {}),
          },
          (recorded?.said ??
            `Question ${asked.question} recorded for the person. ${THE_ANSWER_ARRIVES_AS_A_MESSAGE}`) +
            (overflow === undefined ? '' : sendOverflowSaid(overflow)),
        )
      }).then(sendAnswer),
  }
}

export function createWithdrawQuestionTool(
  host: Pick<AgentToolHost, 'withdrawQuestion'>,
  by: Caller,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'withdraw_question',
    description:
      'Withdraw a question you asked and no longer need answered. It closes the question: an answer given after this is refused, and nothing reaches you. Name it by the id ask_question returned.',
    /**
     * **D-009 · F012 — ruling 5: the asker can withdraw it.** Its own open question and
     * nothing else — `RuntimeHost.withdrawQuestion` is the rail.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      question: z.string().describe('The question id, exactly as ask_question returned it.'),
    },
    call: (args) =>
      guarded(async () => {
        const question = args.question
        if (typeof question !== 'string' || question.length === 0) {
          return refusalAnswer(
            refuseTool('malformed-request', { problems: ['question is required'] }),
          )
        }
        const withdrawn = host.withdrawQuestion({ requestId: question }, by)
        if (!withdrawn.ok) {
          const carried = carryQuestionRefusal(withdrawn.refusal)
          return answer(carried, `refused (${withdrawn.refusal.rail}): ${withdrawn.refusal.reason}`)
        }
        return answer(
          { outcome: 'ok', question: withdrawn.question },
          // The id the call named is not said back.
          DONE,
        )
      }),
  }
}
