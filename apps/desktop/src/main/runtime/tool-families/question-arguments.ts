import { type QuestionRecipient } from '../../../shared/question-contracts'

export interface AskQuestionArguments {
  readonly move_to?: string
  /**
   * The piece this question is about, by label or id. **D-016** — inferred for the two ends about
   * work when exactly one piece the asker holds has reached it (its root counts; D-022 · R4);
   * optional for a question to an agent by name.
   */
  readonly piece?: string
  /**
   * **D-009 · F012** — the agent a question is for, when who_answers is `an-agent`: by the piece it
   * owns (`W1.2`) or by its id (D-016 · commit 7 · R1).
   */
  readonly agent?: string
  /** The question itself. */
  readonly question: string
  /**
   * **611 · who it is for** (HO-088 §2.2) — REQUIRED, and the PO ruled why.
   *
   * Require the caller to choose the recipient. The person can speak to any agent at any time, so defaulting to the last speaker could redirect the next work question away from its giver.
   */
  readonly who_answers: QuestionRecipient
  /** Optional, and an empty list is a free-form question rather than a broken one. */
  readonly options?: readonly string[]
}

export interface PassQuestionUpArguments {
  /** The question being carried, by the id this app gave it. */
  readonly question: string
  /**
   * **679 · which conversation asked it** — {@link AnswerQuestionArguments.asked_by}, the same
   * field for the same reason. It selects the question being CARRIED and never where it goes:
   * that is `who_answers`, and `REPLY_ADDRESSING_KEYS` still refuses every spelling of an addressee.
   */
  readonly asked_by?: string
  /** Who the next hop is — the same two ends `ask_question` takes. */
  readonly who_answers: QuestionRecipient
  /** Anything worth knowing that the original words do not say. Leave it out to add nothing. */
  readonly context?: string
}

export interface AnswerQuestionArguments {
  /** The question id, exactly as the app gave it. */
  readonly question: string
  /**
   * **679 · the conversation that asked, as `list_questions` and the question's own words name
   * it** — optional, and needed only when two conversations this caller started asked with one id.
   */
  readonly asked_by?: string
  /** One entry per part the question asks about. **D-009** — left out when {@link cannot_answer} says why there is none. */
  readonly answers?: readonly { readonly part: string; readonly answer: readonly string[] }[]
  /** **D-009 · F012** — you cannot answer it, and why (ruling 2). */
  readonly cannot_answer?: string
  /**
   * `false` lets the asker finish its running turn before it reads the answer. Left out or `true`,
   * that turn is asked to stop so the answer is read now, when the answerer may stop the asker.
   */
  readonly interrupt?: boolean
}

/** The advertised names, as keys of {@link AnswerQuestionArguments} — see that interface (477). */
export const ANSWER_QUESTION_ARGUMENT = 'question' satisfies keyof AnswerQuestionArguments

export const ANSWER_ANSWERS_ARGUMENT = 'answers' satisfies keyof AnswerQuestionArguments

/** **D-009** — the decline. */
export const ANSWER_CANNOT_ARGUMENT = 'cannot_answer' satisfies keyof AnswerQuestionArguments

export const ANSWER_INTERRUPT_ARGUMENT = 'interrupt' satisfies keyof AnswerQuestionArguments

/** **679 · shared by BOTH doors that take a routed question**, so one spelling reaches one key. */
export const ASKED_BY_ARGUMENT = 'asked_by' satisfies keyof AnswerQuestionArguments &
  keyof PassQuestionUpArguments

/**
 * **679 · what a model is told `asked_by` is — one sentence, advertised by both doors.** It says
 * when the field is NEEDED and that the call says so: the id alone still decides whenever one asker
 * has it. It does not say *leave it out* — the question's own words hand the asker beside the id,
 * and a call that passes both is always right.
 */
export const ASKED_BY_SAYS =
  'Which conversation asked it, by the piece it owns (W1.2) or by its id, as the question and list_questions name it. The id alone is enough unless more than one conversation you started asked a question with it; then this is required, and a call without it is refused and says so.'

/** The advertised names, as keys of {@link AskQuestionArguments} — see that interface (437). */
export const ASK_PIECE_ARGUMENT = 'piece' satisfies keyof AskQuestionArguments

export const ASK_QUESTION_ARGUMENT = 'question' satisfies keyof AskQuestionArguments

export const ASK_OPTIONS_ARGUMENT = 'options' satisfies keyof AskQuestionArguments

/** **611 · shared by BOTH question verbs**, so one spelling reaches one vocabulary. */
export const ASK_WHO_ARGUMENT = 'who_answers' satisfies keyof AskQuestionArguments

/** **D-009** — who a question to `an-agent` is for. */
export const ASK_AGENT_ARGUMENT = 'agent' satisfies keyof AskQuestionArguments

/** The advertised names, as keys of {@link PassQuestionUpArguments} — see that interface (611). */
export const PASS_QUESTION_ARGUMENT = 'question' satisfies keyof PassQuestionUpArguments

export const PASS_CONTEXT_ARGUMENT = 'context' satisfies keyof PassQuestionUpArguments

export const PASS_WHO_ARGUMENT = 'who_answers' satisfies keyof PassQuestionUpArguments
