import { toolFieldProblems } from './field-problems'
import { A_CONVERSATION_CANNOT_ASK_ITSELF } from './launch-failures'
import {
  A_PERSON,
  DONE,
  THE_CONVERSATION_THAT_GAVE_YOU_THIS_WORK,
} from '../agent-tool-answer-words'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { DO_IT_HERE, MOVE_IT } from '../../../shared/move-request'
import {
  PASS_UP_RECIPIENTS,
  type PassUpRecipient,
  type QuestionRecipient,
} from '../../../shared/question-contracts'
import {
  QUESTION_RECIPIENTS,
  isPassUpRecipient,
  isQuestionRecipient,
} from '../../../shared/questions'
import {
  REPLY_ADDRESSING_KEYS,
  TOOL_INPUT_ENUMS,
  type ToolName,
  documentedToolEnum,
} from './catalog'
import { REPLY_SUMMARY_LIMIT } from '../reply-rails'
import { answer, refusalAnswer } from './answers'
import { carryQuestionRefusal, refuseTool } from './refusals'
import { type conversationAddressing } from './addressing'
import { outOfReachAnswer } from './delivery'
import { workRequestRefused } from '../spawn-rails'
import { z } from 'zod'
import {
  ASKED_BY_ARGUMENT,
  ASKED_BY_SAYS,
  ASK_AGENT_ARGUMENT,
  ASK_OPTIONS_ARGUMENT,
  ASK_PIECE_ARGUMENT,
  ASK_QUESTION_ARGUMENT,
  ASK_WHO_ARGUMENT,
  type AskQuestionArguments,
  PASS_CONTEXT_ARGUMENT,
  PASS_QUESTION_ARGUMENT,
  PASS_WHO_ARGUMENT,
  type PassQuestionUpArguments,
} from './question-arguments'

/** Where a question goes, in words rather than the recipient's internal name. */
const ROUTED_TO: Readonly<Record<PassUpRecipient, string>> = {
  'the-parent': THE_CONVERSATION_THAT_GAVE_YOU_THIS_WORK,
  'a-person': A_PERSON,
}

export function createAskQuestionTool(
  host: Pick<
    AgentToolHost,
    'nameByItsWork' | 'raiseAQuestion' | 'tookItsPlace' | 'whyItIsOutOfReach'
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
      'Ask a question and get the answer back. Say who answers it: the conversation that gave you your work, a person, or another agent you name, by the piece it owns (W1.2) or its id. A question to the conversation that gave you your work or to a person is about a piece of work you are holding — your own conversation\u2019s work counts — so name the piece, or leave it out when you hold only one; the app knows who gave it to you, and a question about work a person gave you goes to a person. A question to another agent may name the piece it is about, or none. Any work stays yours and stays open — this is not reply_to_parent, which hands it back. This call does not wait: it returns as soon as the question is recorded and routed, and the answer reaches you later as a message, however long they take. An answer can ask the turn you are in to stop, so that you read it at once. On Claude, the command that turn is waiting on ends with it, and work you sent to the background keeps running; on Codex, the command you ran last in that turn ends with it unless you have used another tool since, and your other commands keep running. Your other questions stay open. If the one you asked cannot answer, or its conversation ends first, you are told that instead. withdraw_question takes a question back. Carry on from here.',
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
            'The agent this question is for, by the piece it owns (W1.2) or by its id from list_agents. Required when who_answers is an-agent, and only then.',
          ),
        question: z
          .string()
          .describe(
            `What you need decided, in your own words, at most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters (UTF-16 code units). Nothing is shortened for you. It shows under Waiting on you with Markdown: **bold**, lists, \`code\` for ids and paths, and links to files.`,
          ),
        who_answers: documentedToolEnum(
          TOOL_INPUT_ENUMS['ask_question:who_answers'],
          'Who this question is for.',
          'There is no default: say which. It is where the question GOES, not who is allowed to answer it.',
        ),
        options: z
          .array(z.string())
          .optional()
          .describe(
            `The choices you are offering, as a list of text choices with at most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters in total (UTF-16 code units). Leave it out to ask for an answer in their own words.`,
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
        if (typeof question === 'string' && question.length > REPLY_SUMMARY_LIMIT) {
          problem(
            ASK_QUESTION_ARGUMENT,
            `at most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters; got ${question.length.toLocaleString('en-US')}`,
          )
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
        if (offeredLength > REPLY_SUMMARY_LIMIT) {
          problem(
            ASK_OPTIONS_ARGUMENT,
            `at most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters in total; got ${offeredLength.toLocaleString('en-US')}`,
          )
        }
        if (problems.length > 0) {
          const fields = [
            ASK_PIECE_ARGUMENT,
            ASK_QUESTION_ARGUMENT,
            ASK_OPTIONS_ARGUMENT,
            ASK_WHO_ARGUMENT,
            ASK_AGENT_ARGUMENT,
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
        // own word for an agent it cannot ask, as an unknown id does. An agent's profile name names
        // its one conversation in reach.
        const reached =
          who === 'an-agent' && typeof agent === 'string' ? theConversationToReach(agent) : null
        if (reached !== null && 'refused' in reached) return reached.refused
        const addressed = reached === null ? null : reached.agent
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
            "The Move card is under Waiting on you. Write your reply in this turn as usual. Only the person's press moves the person's current request; a text reply keeps it here.",
          )
        return answer(
          // **611 · the payload says WHERE it went**, which is the one thing this call's
          // outcome varies in. **D-016 · the host's answer, not the caller's declaration**: a
          // question for whoever gave a conversation's own work goes to a person (spec D15).
          {
            outcome: 'ok',
            question: asked.question,
            went_to: asked.went,
            ...(asked.went === 'an-agent' ? { agent: addressed } : {}),
          },
          // **D-016 · commit 7 · R3 — the agent asked, by the piece it owns**; the payload keeps
          // its id.
          // Where it went, in words.
          `Your question is recorded and routed to ${asked.went === 'an-agent' ? (addressed === null ? asked.went : host.nameByItsWork(addressed)) : ROUTED_TO[asked.went]}, as ${asked.question}. It is still theirs to answer — an answer given later reaches you as a message rather than as this call's result. ${asked.aboutItsRoot ? 'Asking did not end any work: this conversation\u2019s own work is a person\u2019s, and you answer them here, in your own words.' : 'Asking did not hand any work back; reply_to_parent is what does that.'} Carry on from here.`,
        )
      }),
  }
}

export function createPassQuestionUpTool(
  host: Pick<AgentToolHost, 'addressOfUnder' | 'passQuestionUp' | 'theConversationAddressed'>,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'pass_question_up',

    description:
      'Pass a question you were asked on to somebody else, exactly as it was asked. Use it when the question is not yours to answer: the words travel unchanged — you cannot reword them — and you may add context beside them. Say who the next hop is: your own parent, or a person. The question you were asked stays open and stays yours: the answer comes back to you, and answer_question is how you then give it to whoever asked. This call does not wait.',
    /**
     * **Advertised against a TYPE** — see {@link PassQuestionUpArguments}, including why there
     * is no field for the question's words.
     */
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **Its entitlement is the LOOKUP**, exactly as `answer_question`'s is: the requests this
     * caller can name are the ones routed to it, so a question raised inside a family it did not
     * start is not a refusal it can trip — it is an id that finds nothing.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      question: z
        .string()
        .describe(
          'The question being carried, by the id the app gave it. list_questions names the ones you were asked.',
        ),
      // **679** — `answer_question`'s field, for its reason: see {@link PassQuestionUpArguments}.
      [ASKED_BY_ARGUMENT]: z.string().optional().describe(ASKED_BY_SAYS),
      who_answers: documentedToolEnum(
        TOOL_INPUT_ENUMS['pass_question_up:who_answers'],
        'Who the next hop is.',
        'There is no default: say which. If nothing started this conversation there is no parent, and you are told so rather than quietly redirected.',
      ),
      context: z
        .string()
        .optional()
        .describe(
          'Anything worth knowing that the original words do not say — what you already tried, what you think turns on it. It is shown beside the question, never instead of it. Leave it out to add nothing.',
        ),
    } satisfies Readonly<Record<keyof PassQuestionUpArguments, z.ZodType>>,
    call: (args) =>
      guarded(async () => {
        // **The SAME list both other question verbs refuse** (437, 611). A conversation is
        // not a destination here either: the two ends are `who_answers`, and a model that tried
        // to name one is told what the argument is.
        const aimed = REPLY_ADDRESSING_KEYS.filter((key) => Object.hasOwn(args, key))
        if (aimed.length > 0) {
          return refusalAnswer(
            refuseTool('malformed-request', {
              problems: aimed.map(
                (key) =>
                  `${key} is not an argument of this tool: ${PASS_WHO_ARGUMENT} says where it goes next and it takes ${PASS_UP_RECIPIENTS.join(' or ')}`,
              ),
            }),
          )
        }
        const requestId = args[PASS_QUESTION_ARGUMENT]
        const askedBy = args[ASKED_BY_ARGUMENT]
        const who = args[PASS_WHO_ARGUMENT]
        const context = args[PASS_CONTEXT_ARGUMENT]
        const problems: string[] = []
        if (typeof requestId !== 'string' || requestId.length === 0) {
          problems.push(`${PASS_QUESTION_ARGUMENT} is required`)
        }
        // **679** — the answer door's own check, for its reason.
        if (askedBy !== undefined && (typeof askedBy !== 'string' || askedBy.length === 0)) {
          problems.push(
            `${ASKED_BY_ARGUMENT} must name the conversation that asked, or be left out`,
          )
        }
        if (!isPassUpRecipient(who)) {
          problems.push(
            `${PASS_WHO_ARGUMENT} is required and must be one of ${PASS_UP_RECIPIENTS.join(', ')}`,
          )
        }
        // **The SAME bound the question itself carries** (437's constant, not a second one).
        // Context is rendered verbatim into the words the next hop receives — `questionText`
        // never trims — so an unbounded field would put caller-authored text of any size into
        // another conversation's turn through the one verb whose whole promise is that the words
        // are somebody else's.
        if (context !== undefined && typeof context !== 'string') {
          problems.push(`${PASS_CONTEXT_ARGUMENT} must be words, or left out`)
        }
        if (typeof context === 'string' && context.length > REPLY_SUMMARY_LIMIT) {
          problems.push(
            `${PASS_CONTEXT_ARGUMENT} is ${context.length} units long and the limit is ${REPLY_SUMMARY_LIMIT}`,
          )
        }
        if (problems.length > 0) {
          return refusalAnswer(refuseTool('malformed-request', { problems }))
        }
        // **Not one rail is asked here** — whose question it is, whether it exists, whether it
        // has ended and whether it is a person's are all the host's, through the same
        // `admitAnswer` the answer door uses. **D-016 · commit 7 · R1 — `asked_by` read as the
        // answer door reads it** ({@link ASKED_BY_SAYS} is both doors'): a label names its piece's
        // owner, matched only against the askers of questions routed to this caller.
        const passed = await host.passQuestionUp(
          {
            requestId: requestId as string,
            who: who as PassUpRecipient,
            context: typeof context === 'string' ? context : null,
            askedBy:
              typeof askedBy === 'string'
                ? host.theConversationAddressed(askedBy, by, me, 'answering')
                : null,
          },
          by,
        )
        if (!passed.ok) {
          const carried = carryQuestionRefusal(passed.refusal)
          return answer(carried, `refused (${passed.refusal.rail}): ${passed.refusal.reason}`)
        }
        // **Two ids, because there are two questions now** — the one this caller was asked, and
        // the one it raised carrying those words. Reporting one would make a model guess which
        // it is holding, and it is holding both: the first is still open and still its to answer.
        return answer(
          // **679 · and the asker of the one carried** — {@link PassUpOutcome}: a sibling asked
          // later can share its session-local id, and this is the record the passer quotes from.
          {
            outcome: 'ok',
            question: passed.question,
            passed_up: passed.carried.question,
            asked_by: passed.carried.askedBy,
          },
          // **D-016 · commit 7 · R3 — `asked_by` quotes the asker's address**: the label of the
          // piece that names it, which `answer_question` takes, or its id when it holds none —
          // F033 · the label the question's own words gave it, by the piece it was asked under.
          `That question is now recorded as ${passed.question}, addressed to ${ROUTED_TO[who as PassUpRecipient]}, in the words it was asked in. ${passed.carried.question} is still open and still yours: when the answer reaches you, answer_question with asked_by ${host.addressOfUnder(passed.carried.askedBy, passed.carried.piece)} is how it gets back to whoever asked. Carry on from here.`,
        )
      }),
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
