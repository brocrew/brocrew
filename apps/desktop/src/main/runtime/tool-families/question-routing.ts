import { toolFieldProblems } from './field-problems'
import { DONE } from '../agent-tool-answer-words'
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
import { answer, refusalAnswer, refusedAsk, sendAnswer } from './answers'
import { THE_ANSWER_ARRIVES_AS_A_MESSAGE } from '../send-receipt'
import { sendResourcesInput, sendResourcesProblem } from './send-resources'
import { carryQuestionRefusal, refuseTool } from './refusals'
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
  host: Pick<AgentToolHost, 'raiseAQuestion' | 'questionDestination'>,
  by: Caller,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'ask_question',
    handlerOwnsMissingInput: true,

    description:
      'Ask a question and get the answer back. who_answers: the-parent (the conversation that gave you this task), a-person, or an-agent (any existing conversation, named in agent by any of its labels or its id; a service may also be named by its profile). Ask whoever is likeliest to know, usually your giver. Ask the person only for what only they can give: an approval, a sign-in, an account switch, publishing, a yes on something they can see, a preference, a money or time commitment, or a fact only they know. Check their open questions first (list_questions) so nothing is asked twice, and name the job by its title. To ask the person to approve something for another agent, quote or attach that agent’s exact proposal. For an-agent, name any known task or omit it. For a-person, omit the task to ask about your conversation’s own work. Any work stays yours and stays open — this is not reply_to_parent, which hands it back. Hand files with resources. Anything over 2,000 characters arrives as a file the reader is pointed to. Asking an archived conversation leaves it archived. This call does not wait: it says what was recorded (the question id) and whether the one asked started, is queued, or can’t run, and the answer reaches you later as a message. An answer can ask the turn you are in to stop, so that you read it at once. Stopping the turn may end a command it started. Your other questions stay open. If the one you asked can’t answer, you are told why. withdraw_question takes a question back; withdraw your open questions about a task when it ends. Carry on from here.',
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
            'The task label or id. With an-agent, name any known task or leave it out. With a-person, leaving it out uses your conversation’s own work. With the-parent, name your task or leave it out when one received task identifies the giver.',
          ),
        agent: z
          .string()
          .optional()
          .describe(
            'The conversation this question is for, by any of its task labels (W1.2) or its id from list_agents; a service may also be named by its profile. Required when who_answers is an-agent, and only then.',
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
            `The choices you are offering. Long lists are attached with numbered choices. Leave it out for a free answer.`,
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
        const resources = sendResourcesInput.safeParse(args.resources)
        if (!resources.success) problem('resources', sendResourcesProblem)
        const options: string[] = []
        if (offered !== undefined) {
          if (!Array.isArray(offered) || offered.some((one) => typeof one !== 'string')) {
            problem(ASK_OPTIONS_ARGUMENT, 'expected a list of text choices')
          } else {
            options.push(...(offered as string[]))
          }
        }
        if (!resources.success || problems.length > 0) {
          const fields = [
            ASK_PIECE_ARGUMENT,
            ASK_QUESTION_ARGUMENT,
            ASK_OPTIONS_ARGUMENT,
            ASK_WHO_ARGUMENT,
            ASK_AGENT_ARGUMENT,
            'move_to',
            'resources',
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
        // The host reports an unknown address as the caller spelled it.
        const addressed =
          who === 'an-agent' && typeof agent === 'string'
            ? (host.questionDestination(agent) ?? agent)
            : null
        // The host checks the work and records the question.
        const asked = await host.raiseAQuestion(
          {
            piece: typeof piece === 'string' ? piece : null,
            question: question as string,
            resources: resources.data ?? [],
            options: moveTo === undefined ? options : [MOVE_IT, DO_IT_HERE],
            ...(typeof moveTo === 'string' ? { moveTo } : {}),
            who: who as QuestionRecipient,
            agent: addressed,
          },
          by,
        )
        if (!asked.ok) return refusedAsk(asked)
        if (moveTo !== undefined)
          return answer(
            { outcome: 'ok', question: asked.question, went_to: 'a-person' },
            "The Move card is under Waiting on you. Write your reply in this turn as usual. Only the person's press moves the person's current request; a text reply keeps it here.",
          )
        const { delivery, attachments, overflowSaid } = asked
        return answer(
          {
            outcome: 'ok',
            question: asked.question,
            went_to: asked.went,
            ...(asked.went === 'an-agent'
              ? { agent: delivery?.receipt.recipient.id ?? addressed }
              : {}),
            ...(delivery === undefined ? { attachments } : { receipt: delivery.receipt }),
          },
          (delivery?.said ??
            `Question ${asked.question} recorded for the person. ${THE_ANSWER_ARRIVES_AS_A_MESSAGE}`) +
            overflowSaid,
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
      "Withdraw a question or action request you made and no longer need. Use the request id returned by ask_question or request_action. It stays in your conversation's history as withdrawn and leaves the open queue; a later answer is refused. Withdrawal does not record an answer.",
    /**
     * **D-009 · F012 — ruling 5: the asker can withdraw it.** Its own open question and
     * nothing else — `RuntimeHost.withdrawQuestion` is the rail.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      question: z
        .string()
        .describe('The request id, exactly as ask_question or request_action returned it.'),
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
