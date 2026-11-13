import { ASKED_TO_STOP } from '../../../shared/how-work-stopped'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import { type RequestState, type VisibleQuestion } from '../../../shared/question-contracts'
import { REQUEST_IS_OPEN, theChannelRefusalIn } from '../../../shared/questions'
import { type ToolName } from './catalog'
import { REPLY_SUMMARY_LIMIT } from '../reply-rails'
import { answer, refusalAnswer } from './answers'
import { carryQuestionRefusal, refuseTool } from './refusals'
import {
  countedBy,
  countsSaid,
  listedOf,
  skippedQuestionRecordsSentence,
  theListingAsked,
  unreadQuestionRowsSentence,
  whenSkipped,
} from './listings'
import { theRuleOfAStopForWords, whatBecameOfTheStop } from './delivery'
import { type readerFields } from './reader-inputs'
import { workRequestRefused } from '../spawn-rails'
import { z } from 'zod'
import {
  ANSWER_ANSWERS_ARGUMENT,
  ANSWER_CANNOT_ARGUMENT,
  ANSWER_INTERRUPT_ARGUMENT,
  ANSWER_QUESTION_ARGUMENT,
  ASKED_BY_ARGUMENT,
  ASKED_BY_SAYS,
  type AnswerQuestionArguments,
} from './question-arguments'

const HOW_TO_LIST_MORE_QUESTIONS =
  'list_questions takes state — open, ended or all — and limit, which is how many ended questions it lists, newest first.'

const questionPayload = (one: VisibleQuestion): Readonly<Record<string, unknown>> => ({
  question: one.request.requestId,
  asked_by: one.request.askedBy,
  state: one.request.state,
  // **611 · the REFUSED arm is the only thing this caller may not answer** (HO-088 §2.3).
  // It was `because === null`, which was the same set until an asker could address a question
  // to a person. **Addressing is where a question GOES, not a lock on who may answer it** —
  // `admitAnswer` still admits one, so a payload saying `false` here would tell a model it would
  // be refused by a door that would have taken it.
  answerable_by_you: one.request.went.is !== 'the-person-the-channel-left-it-with',
  because: theChannelRefusalIn(one.request),
  // **611 · where it went, in this app's own word** — see {@link WhereARequestWent}. It is
  // what tells a model the difference between *a person was ASKED this* and *a person is the only
  // one who may settle it*, which `because` alone cannot say now that it is absent on one of the
  // two `a-person` arms.
  went_to: one.request.went.to,
  words: one.words,
  asked_at: one.request.at,
  ended_at: one.request.endedAt,
})

/** A question that is over, as a payload carries it: how it ended, and none of its words. */
const endedQuestionPayload = (one: VisibleQuestion): Readonly<Record<string, unknown>> => ({
  question: one.request.requestId,
  asked_by: one.request.askedBy,
  state: one.request.state,
  asked_at: one.request.at,
  ended_at: one.request.endedAt,
})

const QUESTION_STATE_SENTENCE: Partial<Readonly<Record<RequestState, string>>> = {
  stranded:
    'the app restarted while it was waiting — that conversation is still there, ask it again',
  // **709 · R43 — `interrupted` is written at the ASK** (`request_interrupted`, before the
  // provider is told), so the sentence says the ask: the turn itself may have completed.
  interrupted: `the work it was raised in was ${ASKED_TO_STOP}, so it was never answered — that conversation is still there, ask it again`,
  // **591 · the third, and it is the same trap one act over.** The word alone says a
  // withdrawal and a reader would as likely conclude the ASKING model retracted its own question,
  // which is the one thing that did not happen. **The sentence says the request ended and never
  // who ended it** — the actor is on the `work_taken_back` row, and *a person took it back* printed
  // here would be `222`'s false sentence reappearing in a tool payload: it is as often the reading
  // agent's own `withdraw_task`.
  'work-withdrawn':
    'the work it was about was taken back, so nothing is left to decide — that conversation is still there, and list_tasks says what it holds now',
  // **D-016 · `work-withdrawn`'s twin for a close**, and for its reason: it says the request ended
  // and never who ended it — the actor is on the `work_closed` row.
  'work-closed':
    'the work it was about was closed, so nothing is left to decide — that conversation is still there, and list_tasks says what it holds now',
  // The twin for a hand-back: it says the request ended, and the reply row names who replied.
  'work-replied':
    'the work it was about was handed back, so nothing is left to decide — that conversation is still there, and list_tasks says what it holds now',
  // **675 · it printed as the bare word until now** (`661` F2). **D-017 · R4 — only a request
  // the conversation's own provider raised is `abandoned`, by a stop** (a question this app asked
  // outlives one), and nothing brings it back: a later message starts the conversation, and the
  // request is not offered again. So it promises no return, and it does not say *ask it again*
  // (`the-word-for-a-question-nobody-stopped` pins that): it says what became of the request.
  // A ledger written before D-017 replays its own rows, and nothing routes them again (D-016 ·
  // ruling 14 took the launch sweep that did).
  abandoned:
    'the conversation that raised it stopped while it was waiting, and the request stopped with it, so it cannot be answered',
}

const questionLine = (one: VisibleQuestion): string => {
  const said = QUESTION_STATE_SENTENCE[one.request.state]
  const refused = theChannelRefusalIn(one.request)
  // **D-016 · commit 7 · R3 — the asker by its agent's name and its piece** — F033 · the one it
  // asked under ({@link VisibleQuestion.askerCalled}), as the question's own words name it. The
  // payload keeps its id.
  return `  ${one.request.requestId} · from ${one.askerCalled} · ${one.request.state}${
    said === undefined ? '' : ` (${said})`
  }${
    refused === null
      ? // **611 · the third clause, and it says what this row is rather than what it is
        // not** (HO-088 §2.3). A question its asker addressed to a person reads exactly like
        // one addressed to this caller on every other field, and the difference decides whether
        // answering it is doing somebody's job or taking it off them. **It says the caller MAY
        // still answer**, because it may — see {@link admitAnswer}.
        one.request.went.is === 'the-person-the-asker-named'
        ? ' · addressed to a person, and it is still yours to answer if you know'
        : ''
      : ` · a person answers this one (${refused})`
  }${wordsMissingClause(one)}`
}

/** A question that is over, as a line says it: who asked, and how it ended. */
const endedQuestionLine = (one: VisibleQuestion): string => {
  const said = QUESTION_STATE_SENTENCE[one.request.state]
  return `  ${one.request.requestId} · from ${one.askerCalled} · ${one.request.state}${
    said === undefined ? '' : ` (${said})`
  }`
}

const wordsMissingClause = (one: VisibleQuestion): string =>
  // **611 · the REFUSED arm is the one whose absent words are already accounted for** — and an
  // addressed question keeps its words (`questionsWaitingOn`), so a null here means the same thing
  // it means for a question addressed to this caller: the app does not hold them.
  one.request.went.is !== 'the-person-the-channel-left-it-with' && one.words === null
    ? ' · this app does not hold the words for this one — it cannot be answered from here'
    : ''

export function createAnswerQuestionTool(
  host: Pick<
    AgentToolHost,
    | 'answerQuestion'
    | 'nameByItsWork'
    | 'nameByItsWorkUnder'
    | 'theConversationAddressed'
    | 'whatToCallTheConversation'
    | 'whyWhatIsHeldWaits'
  >,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'answer_question',
    handlerOwnsMissingInput: true,
    description:
      // **679 · *the id and the asker*** — what the question's own words hand the caller since
      // `679` (`questionText`); *"the id to quote"* was the whole of it while an id named one question.
      `Answer a question you are asked — by a conversation you started, or by an agent that asked you by name — or say you cannot, with cannot_answer and why. The app sends you the question, the id to quote and the asked_by beside it; a request that is a person’s to settle is refused by name and no retry will pass. Your own words in one answer, or your reason, may be at most ${String(REPLY_SUMMARY_LIMIT)} units: put anything longer in a file and name its full path. By default an asker you started, or one started under it, reads your answer — or your reason — at once: if it is in the middle of a turn, that turn is ${ASKED_TO_STOP} for it, and no person is asked to approve that. ${theRuleOfAStopForWords(undefined, 'it')} Its other questions stay open. A turn that waits on someone's answer, or that a person's own words started, is not interrupted. Give interrupt: false to let it finish that turn first. Any other asker reads your answer when its running turn ends.`,
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **An answer into a conversation the caller started.** `QUESTION_RAILS` refuse the one class that is a person's — `a-person-answers-this-one` — so the authority question is already answered by a rail.
     *
     * **And so is the stop an answer asks for, with no card for it.** It reaches only an asker
     * the answerer may interrupt, is not asked of a turn that waits on a card or that a person's
     * own words opened, and keeps the asker's background work and its other questions; the asker
     * asked so that it could go on. A card would hold the answer for a person's click, which is
     * the wait the stop is there to end. `interrupt_agent`, and `message_agent` with
     * `interrupt`, keep theirs.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries({
        [ANSWER_QUESTION_ARGUMENT]: z
          .string()
          .describe('The question id, exactly as the app gave it to you.'),
        // **679 · the one field that can tell two questions under one id apart** — see
        // {@link AnswerQuestionArguments.asked_by}. *"Nothing else names it"* stood on the line
        // above and went false with it.
        [ASKED_BY_ARGUMENT]: z.string().optional().describe(ASKED_BY_SAYS),
        [ANSWER_ANSWERS_ARGUMENT]: z
          .array(
            z.object({
              part: z
                .string()
                .describe('The part id, exactly as the app listed it under this question.'),
              answer: z
                .array(z.string())
                .describe(
                  'What you choose for that part — one option label, unless the part says it takes more than one. A part that takes an answer of your own takes your words here instead.',
                ),
            }),
          )
          .optional()
          .describe(
            'One entry per part the question asks about. A question with a part left out is refused and nothing is sent. Leave it out only when you give cannot_answer.',
          ),
        [ANSWER_CANNOT_ARGUMENT]: z
          .string()
          .optional()
          .describe(
            'You cannot answer it: say why, in your own words, and the one who asked is told. Give this or answers, not both.',
          ),
        [ANSWER_INTERRUPT_ARGUMENT]: z
          .boolean()
          .optional()
          .describe(
            `false lets the asker finish the turn it is running before it reads your answer — for an answer it can use later; a turn can run for hours. Left out, or true: an asker you started, or one started under it, has its running turn ${ASKED_TO_STOP} so that it reads your answer now, unless that turn waits on someone's answer or a person's own words started it. ${theRuleOfAStopForWords(undefined, 'it')} Its other questions stay open. Any other asker reads your answer when its running turn ends, whatever this says.`,
          ),
        // **477 · `satisfies` is the rail here, not a tidy-up** — see
        // {@link AnswerQuestionArguments}. An argument through which a model could name who
        // answered is a compile error on this line.
      } satisfies Readonly<Record<keyof AnswerQuestionArguments, z.ZodType>>).map(
        ([field, schema]) => [field, agentToolHandlerInput(schema)],
      ),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        const { question } = args
        const askedBy = args[ASKED_BY_ARGUMENT]
        const problems: z.core.$ZodIssue[] = []
        const problem = (
          field: keyof AnswerQuestionArguments,
          message: string,
          index?: number,
          child?: 'part' | 'answer',
        ): void => {
          problems.push({
            code: 'custom',
            path: [
              field,
              ...(index === undefined ? [] : [index]),
              ...(child === undefined ? [] : [child]),
            ],
            message,
          })
        }
        if (question === undefined)
          problem('question', 'required; send the question id as non-empty text')
        else if (typeof question !== 'string')
          problems.push({
            code: 'invalid_type',
            path: ['question'],
            expected: 'string',
            message: 'expected text',
          })
        else if (question.length === 0)
          problem('question', 'send the question id as non-empty text')
        // **679 · refused rather than ignored.** An `asked_by` that is not a name would
        // otherwise fall back to the id alone — the lookup it was written to narrow.
        if (askedBy !== undefined && (typeof askedBy !== 'string' || askedBy.length === 0)) {
          problem('asked_by', 'send the asking conversation as non-empty text, or leave it out')
        }
        // **Validated here because the shape is this tool's, and refused rather than repaired.**
        // `325`'s rule: a vocabulary the validator has not been taught is a refusal, never a pass.
        // Nothing below decides whether the ANSWER fits the question — that is
        // `answerToForward`'s, one package over, and a second copy of it here would be the rule in
        // two places with the far copy free to drift.
        const answers: { part: string; answer: string[] }[] = []
        // **D-009 · an answer, or a reason there is none — one of the two.**
        const cannot = args[ANSWER_CANNOT_ARGUMENT]
        if (cannot !== undefined) {
          // Its length is the host's to refuse (`answer-too-long`), on the bound an answer's
          // own words share, so both are refused in one sentence that says what to do.
          if (typeof cannot !== 'string' || cannot.length === 0) {
            problem('cannot_answer', 'send a non-empty text reason, or leave it out')
          }
          if (args.answers !== undefined) {
            problem(
              'answers',
              `send ${ANSWER_ANSWERS_ARGUMENT} or ${ANSWER_CANNOT_ARGUMENT}, not both`,
            )
          }
        } else if (!Array.isArray(args.answers)) {
          problem(
            'answers',
            `required; send a list of parts with their answers, or a reason in ${ANSWER_CANNOT_ARGUMENT}`,
          )
        } else {
          for (const [index, one] of args.answers.entries()) {
            const given: Record<string, unknown> =
              typeof one === 'object' && one !== null ? (one as Record<string, unknown>) : {}
            const part: unknown = given['part']
            // **`chosen`, not `answer`** — `answer` is this file's payload helper, and a local
            // of that name inside the loop is a shadow that compiles and reads as the wrong thing.
            const chosen: unknown = given['answer']
            if (typeof part !== 'string' || part.length === 0) {
              problem('answers', 'required; send the part id as non-empty text', index, 'part')
              continue
            }
            if (!Array.isArray(chosen) || chosen.some((member) => typeof member !== 'string')) {
              problem('answers', 'send a list of text choices', index, 'answer')
              continue
            }
            answers.push({ part, answer: chosen as string[] })
          }
        }
        const interruptAsked = args[ANSWER_INTERRUPT_ARGUMENT]
        if (interruptAsked !== undefined && typeof interruptAsked !== 'boolean') {
          problem('interrupt', 'send true or false, or leave it out')
        }
        if (problems.length > 0) {
          const fields = [
            ANSWER_QUESTION_ARGUMENT,
            ASKED_BY_ARGUMENT,
            ANSWER_ANSWERS_ARGUMENT,
            ANSWER_CANNOT_ARGUMENT,
            ANSWER_INTERRUPT_ARGUMENT,
          ]
          const detail = workRequestRefused(problems, args, fields)
          const unknown = Object.keys(args).filter((key) => !fields.includes(key))
          if (unknown.length === 0) return refusalAnswer(refuseTool('malformed-request', detail))
          const names = unknown.slice(0, 3).map((key) => {
            const name = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) ? key : 'unknown field'
            return `${name}: not a field of answer_question; use ${fields.join(', ')}`
          })
          if (unknown.length > 3) names.push('Other unknown fields were also sent.')
          // Caller-named problems stay outside the app-composed identity marker.
          return refusalAnswer(
            refuseTool('malformed-request', { problems: [...detail.problems, ...names] }),
          )
        }
        // **Not one rail is asked here.** Whose question this is, whether it is a question at
        // all, and whether anybody is still waiting are all the host's — the module note's rule.
        // **D-016 · commit 7 · R1 — `asked_by` takes the asker's piece label too**, read by the
        // one resolver every door that takes an agent asks, for EVERY owner: the host matches it
        // only against the askers of questions routed to this caller, so a label naming anyone
        // else, and one naming nothing, read as an asker that asked nothing.
        const answered = await host.answerQuestion(
          {
            questionId: question as string,
            answers,
            askedBy:
              typeof askedBy === 'string'
                ? host.theConversationAddressed(askedBy, by, me, 'answering')
                : null,
            cannot: typeof cannot === 'string' ? cannot : null,
            // An answer stops the asker's running turn unless the answerer said not to.
            interrupt: interruptAsked !== false,
          },
          by,
        )
        if (!answered.ok) {
          const carried = carryQuestionRefusal(answered.refusal)
          return answer(carried, `refused (${answered.refusal.rail}): ${answered.refusal.reason}`)
        }
        // **D-016 · commit 7 · R3 — the asker by the piece it owns**; the payload keeps its id.
        // F033 · the one it asked the question under.
        const asker = host.nameByItsWorkUnder(answered.asked, answered.piece)
        // **Held for the asker's reopen on the current sign-in, for a person's answer its turn is
        // stopped on, or (F074) for its provider's usage limit** — it does not have it yet, and
        // `why` says what it waits for. W4.172 · never *"once it is reopened"* alone: a hold for
        // the limit alone reopens nothing.
        const why = host.whyWhatIsHeldWaits(answered.asked)
        // What became of the stop, said when one was asked or when the answer waits behind a
        // turn that was not stopped — never of an asker that had no turn to stop. By its name
        // alone: the sentence before it named the asker in full.
        const stopped =
          answered.stop === undefined || answered.stop.stop === 'not-needed'
            ? null
            : whatBecameOfTheStop(
                answered.stop,
                host.whatToCallTheConversation(answered.asked),
                typeof cannot === 'string' ? 'your reason' : 'your answer',
                (conversation) => conversation === me,
                (conversation) => host.nameByItsWork(conversation),
                why !== null,
              )
        // Held behind the asker's running turn, and that turn was not asked to stop.
        const waitsForItsTurn = answered.held === true && answered.stop?.stop !== 'asked'
        const waits = why === null ? '' : ` ${why}`
        const hasIt =
          why !== null
            ? `Your answer is held for ${asker}`
            : !waitsForItsTurn
              ? `${asker} has your answer and can go on`
              : stopped === null
                ? `${asker} reads your answer when the turn it is running ends`
                : `Your answer is held for ${asker}`
        const toldWhen =
          why !== null
            ? ', when what is held for it goes in,'
            : waitsForItsTurn
              ? ', when the turn it is running ends,'
              : ''
        const said =
          answered.kept !== undefined
            ? `The question is closed. ${answered.kept}`
            : typeof cannot === 'string'
              ? `${asker} is told${toldWhen} you cannot answer it, and why; the question is closed.${waits}`
              : answered.notAsked.length === 0
                ? `${hasIt}.${waits}`
                : `${hasIt}, except ${answered.notAsked.join(', ')}: ` +
                  (answered.notAsked.length === 1
                    ? 'its question does not ask about that part, so it was not sent.'
                    : 'its question does not ask about those parts, so they were not sent.') +
                  waits
        return answer(
          {
            outcome: 'ok',
            question: answered.question,
            agent: answered.asked,
            // **The parts its question never asked, which did not reach the asker**
            // (`AnswerOutcome.notAsked`). Always present, so an empty list is a measurement —
            // `list_tasks`' `rows_unread` rule. Nothing is cut: a long answer is refused.
            not_asked: answered.notAsked,
            // **D-017 · R1 — the asker could not be started now**: the answer waits for its next
            // start, and the sentence says why. Present only then.
            ...(answered.kept === undefined ? {} : { kept: answered.kept }),
            ...(stopped === null ? {} : stopped.structured),
          },
          // **676 · F4 — a success that did not carry every part SAYS so**, rendered from the
          // parts (standing rule 8.2).
          // **D-017 · R1** — and one that has not reached the asker yet says that instead of
          // *"has your answer"*: the question is closed, and the words wait for its next start.
          stopped === null ? said : `${said} ${stopped.said}`,
        )
      }),
  }
}

export function createListQuestionsTool(
  host: Pick<AgentToolHost, 'questionsListedFor'>,
  me: string,
  readerInputs: ReturnType<typeof readerFields>['readerInputs'],
  readerFieldRefusal: ReturnType<typeof readerFields>['readerFieldRefusal'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'list_questions',
    handlerOwnsMissingInput: true,
    description:
      // **679 · the last clause names `asked_by` beside the id** — each row carries both, and two
      // rows can share an id (`675` F-b), where the id alone is refused.
      'Questions waiting on you — from the conversations you started, and from any agent that asked you by name — with the words to answer. The ones that are over are counted and not listed: state: "ended" or "all" lists them too, newest first and as many as limit says, each with how it ended and without its words. Each one also reaches you as a message, and this app starts you for it if nothing is running in you; it stays here until it is answered or ends. Answer one with answer_question, quoting its id — and its asked_by too when another row shares that id.',
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **A reader of what is waiting on the caller**: its arguments choose how much of it is
     * listed, never whose.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries(readerInputs.list_questions).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        const asked = theListingAsked(args.state, args.limit)
        if ('problems' in asked) {
          return readerFieldRefusal('list_questions', args, asked.problems)!
        }
        const fieldRefusal = readerFieldRefusal('list_questions', args)
        if (fieldRefusal !== null) return fieldRefusal
        // **No argument names anybody, and no rails**, as for `list_tasks`' board: there is
        // nobody to name, so nobody to refuse. `me` is minted by this toolset from the session
        // it was built for and cannot be handed another — which is the entitlement, and it is
        // structural rather than checked.
        // **676 · the counted read** — `RuntimeHost.questionsListedFor`.
        const listed = host.questionsListedFor(me)
        const waiting = listed.questions
        const open = waiting.filter((one) => REQUEST_IS_OPEN[one.request.state])
        const yours = open.filter(
          (one) => one.request.went.is !== 'the-person-the-channel-left-it-with',
        )
        // **Counted independently of `yours`, so the two halves are separable** — a change to
        // one must not silently move the other.
        const aPersons = open.filter(
          (one) => one.request.went.is === 'the-person-the-channel-left-it-with',
        )
        // **Requests are counted; CONVERSATIONS are what is frozen, and they are not the same
        // number** (the review caught it). `402` measured three permissions on ONE worker — the
        // first version of this clause would have said *"those conversations are frozen"* about
        // three, and the whole reason the clause exists is that the number above it was wrong.
        const frozen = new Set(aPersons.map((one) => one.request.askedBy)).size
        const listing = listedOf(waiting, asked, {
          open: (one) => REQUEST_IS_OPEN[one.request.state],
          kept: () => false,
          endedAt: (one) => one.request.endedAt,
        })
        const notListed = countedBy(listing.rest, (one) => one.request.state)
        // What is waiting, counted whichever listing was asked for: it is the half a model
        // reads first.
        const standing = `${
          yours.length === 0
            ? 'nothing is waiting on you'
            : `${String(yours.length)} waiting on you`
        }${
          aPersons.length === 0
            ? ''
            : // **The child is FROZEN, and saying so is the point of the clause.** A
              // parent told only that something is *"a person's"* has no reason to stop
              // waiting on the work; `open` means nothing in the ledger has ended it and
              // the provider is still holding the tool call. It names no actor and no
              // deadline — HO-018's principle is that the parent decides what to do.
              `; ${String(aPersons.length)} waiting on a person, not on you — ${
                frozen === 1 ? 'that conversation is' : `those ${String(frozen)} conversations are`
              } frozen until somebody decides`
        }`
        return answer(
          {
            outcome: 'ok',
            listed: asked.listing,
            questions: [
              ...listing.whole.map(questionPayload),
              // One that is over carries how it ended and none of its words.
              ...listing.ended.map(endedQuestionPayload),
            ],
            // What the list leaves out, counted by state. Always present: `{}` says nothing
            // was left out.
            not_listed: notListed,
            // **676 · the count, IN the payload** — `list_tasks`' `rows_unread`, one tool over.
            // Always present, so `0` is a measurement. Not yet in the words: that sentence
            // is `675`'s to write (brief §5.2; the response's GAP table).
            rows_unread: listed.rowsUnread,
          },
          [
            waiting.length === 0
              ? 'no conversation you started has asked you anything'
              : [
                  ...(asked.listing === 'ended'
                    ? [`${standing}.`]
                    : [
                        listing.whole.length === 0 ? `${standing}.` : `${standing}:`,
                        // Each open question's own words under its line: its parts, their
                        // options, and the id and `asked_by` to quote.
                        ...listing.whole.map((one) =>
                          one.words === null
                            ? questionLine(one)
                            : `${questionLine(one)}\n${one.words
                                .split('\n')
                                .map((said) => (said === '' ? said : `    ${said}`))
                                .join('\n')}`,
                        ),
                      ]),
                  ...(listing.ended.length === 0
                    ? asked.listing === 'ended'
                      ? ['no question asked of you is over']
                      : []
                    : ['over, newest first:', ...listing.ended.map(endedQuestionLine)]),
                  ...(listing.rest.length === 0
                    ? []
                    : [`not listed: ${countsSaid(notListed)}. ${HOW_TO_LIST_MORE_QUESTIONS}`]),
                ].join('\n'),
            // **676 · the count in the words too, whichever branch answered** — an empty list is
            // exactly when a torn routing may be the question that is missing.
            ...(listed.rowsUnread === 0 ? [] : [unreadQuestionRowsSentence(listed.rowsUnread)]),
            ...whenSkipped(listed.ledgersSkipped, skippedQuestionRecordsSentence),
          ].join('\n'),
        )
      }),
  }
}
