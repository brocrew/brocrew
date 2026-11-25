import { type RowsUnread, rowsUnreadOnce } from '../../db/rows-unread'
import type {
  RoutedRequest,
  VisibleQuestion,
  ActionAsked,
  RaisedQuestion,
} from '../../../shared/question-contracts'
import {
  questionKey,
  questionText,
  type QuestionRefusal,
  refuseQuestion,
  admitAnswer,
} from '../question-rails'
import { readOrSkip, ledgersSkippedOf, type SessionStore } from '../../db/session-store'
// ⚑ **679 · the kind of a person's request** — the one fact that lets a shared id be settled.
import { theChannelRefusalIn } from '../../../shared/questions'
import {
  type Caller,
  sessionSpeakingAs,
  whoDidIt,
  type RuntimeEventSink,
} from '../conversation-caller'
import type { AnswerWithItsStop, TheStopItsWordsAsked } from '../message-records'
import { aQuestionKey, type AnswerDelivery } from './deliveries'
import { answerToForward, type UserInputQuestion, isOfferedLabel } from '@brobot2/runtime'
import {
  INLINE_TEXT_LIMIT,
  answerTextForFile,
  answerPreview,
  type ReadableSendOverflow,
  sendOverflowAttachment,
  type PreparedSendFiles,
  type PreparedSendText,
} from '../send-overflow'
import type { UserDecisionEvent } from '../../../shared/conversation-events'
import type { SendReceipt, SendRecipientState } from '../../../shared/tool-outcome'
import { errorMessage } from '../session-disclosures'
import type { SendFacts, sendReceipt } from '../send-receipt'
import type { TheWordsOfAQuestion, SessionSlot } from './session-slot'
import type { RuntimeChangeMessage } from '../../../shared/runtime-ipc'

/** What QuestionAnswers reaches in RuntimeHost, each read only when called. */
interface QuestionAnswersHost {
  answeredInThisRun(): ReadonlyMap<string, 'answered' | 'rejected'>
  startupRepairs(): ReadonlySet<string>
  slots(): ReadonlyMap<string, SessionSlot>
  startsInFlight(): ReadonlyMap<string, Promise<string>>
  arrivals(): ReadonlyMap<string, Promise<void>>
  addressOf(conversation: string): string
  calledUnder(
    conversation: string,
    piece: string | null,
  ): { readonly called: string; readonly address: string; readonly service?: true }
  decideAQuestionThisAppAsked(
    askedBy: string,
    requestId: string,
    outcome: 'answered' | 'rejected',
    by: Caller,
  ): Promise<boolean>
  deliverAnswer(
    held: {
      readonly asked: string
      readonly piece: string | null
      readonly prompt: string
      readonly action?: ActionAsked
      readonly decisionForStoppedAsker?: UserDecisionEvent
    },
    requestId: string,
    answeredBy: string | null,
    answers: readonly { readonly part: string; readonly answer: readonly string[] }[] | null,
    said: string | null,
    window: RuntimeEventSink | null,
    stopAs: Caller | null,
    files: SendReceipt['attachments'],
  ): Promise<{
    readonly kept: string | null
    readonly stop: TheStopItsWordsAsked | null
    readonly held: boolean
    readonly delivery?: AnswerDelivery
  }>
  oneQuestionReadPerAnswer(unread?: RowsUnread): (id: string) => ReadonlyMap<string, RaisedQuestion>
  prepareFilesForSend(sender: string, paths: readonly string[]): PreparedSendFiles
  prepareTextForSend(sender: string, field: string, text: string): PreparedSendText
  receiptForSend(facts: SendFacts): ReturnType<typeof sendReceipt>
  settleBeforeUse(owner: string): Promise<void>
  stalledQuestionRecipient(
    request: RoutedRequest,
  ): { readonly address: string; readonly title: string } | undefined
  theIdsItStandsFor(sessionId: string): readonly string[]
  theWordsOf(askedBy: string, requestId: string): TheWordsOfAQuestion | undefined
  theWorldMoved(what: RuntimeChangeMessage['what']): void
  theOneInItsPlace(sessionId: string): string
  isAnUnforwardedAppQuestion(asker: string, id: string, answererIds: readonly string[]): boolean
}

type QuestionAnswersDeps = {
  readonly store: Pick<
    SessionStore,
    | 'messagesWaitingIn'
    | 'questionsRaisedIn'
    | 'questionsRoutedTo'
    | 'routedRequestsOf'
    | 'workById'
  >
}

/** The questions a conversation may read and list, and the answer door that settles one. */
export class QuestionAnswers {
  constructor(
    private readonly readDeps: () => QuestionAnswersDeps,
    private readonly host: QuestionAnswersHost,
  ) {}

  /** RuntimeHost's wrapped deps, read when used: the leaf is built before RuntimeHost wraps them. */
  private get deps(): QuestionAnswersDeps {
    return this.readDeps()
  }

  /**
   * 🔴 **Every request raised inside this conversation's family, as it may be read** (394).
   *
   * ⛔ **It includes the ones a PERSON has to answer**, and that is `394` §2 rather than a leak —
   * see `SessionStore.questionsRoutedTo`. ⚑ Nothing here carries a request's TEXT, so what a caller
   * learns from a routing it may not answer is that one exists, which it could already learn by
   * spawning the conversation in the first place.
   */
  questionsVisibleTo(sessionId: string, unread?: RowsUnread): readonly RoutedRequest[] {
    return this.questionsRoutedToWhatItStandsFor(sessionId, unread)
  }

  /**
   * ⚑ **D-017 · R10 — the questions routed to this conversation, and to every one it took the place
   * of** ({@link theIdsItStandsFor}) — a question routed to a conversation that could never be
   * reopened reached the one in its place, and is that one's to list and to answer. ⚑ In routing
   * order, as `questionsRoutedTo` sorts them.
   */
  private questionsRoutedToWhatItStandsFor(
    sessionId: string,
    unread?: RowsUnread,
  ): readonly RoutedRequest[] {
    const ids = this.host.theIdsItStandsFor(sessionId)
    if (ids.length === 1) return this.deps.store.questionsRoutedTo(sessionId, unread)
    return ids
      .flatMap((id) => this.deps.store.questionsRoutedTo(id, unread))
      .sort((left, right) => left.at - right.at)
  }

  /**
   * 🔴 **The same rows, with the words a parent needs to answer them** (396 §2.3) —
   * `list_questions`' whole content.
   *
   * ## ⛔ Why the reader had to exist at all
   *
   * ⚠️ **A question reaches a parent as a MESSAGE, and `deliverQuestion` returns silently when the
   * parent has no slot.** `394` recorded the routing anyway — deliberately, *"a durable row that
   * waited on somebody being there to read it would be lost exactly when the parent went first"* —
   * so the ledger says a question exists and the parent was never told. ⛔ **Once resumed it has no
   * message, therefore no id, therefore no way to answer**, and the only way back was a person
   * answering the card on the child.
   *
   * ## ⚠️ An id alone would not have closed it, and that is why `words` is here
   *
   * ⛔ **`answer_question` takes one entry per PART**, and the part ids and their options are on the
   * request rather than on the routing. A reader that handed back ids would name a thing the caller
   * still could not act on — `393`'s `list_tasks` gap with the fields swapped. ⚑ The words are
   * rendered by {@link questionText}, the SAME function that writes the message a live parent gets,
   * so the two readings of one question cannot drift.
   *
   * ## 🔴 ONE thing stands between a parent and a permission's text, and it is the REFUSED ARM
   *
   * ⛔ **{@link WhereARequestWent}'s `the-person-the-channel-left-it-with` is the guarantee, and it
   * is the only one.**
   *
   * ⚠️ **611 · it read *"`because === null` is the guarantee"*** (HO-088 §2.3, standing rule 8.1).
   * ⛔ That spelling withheld the words from BOTH `a-person` arms the day a second one existed,
   * and the PO ruled the other way for the new one: *"Ada still SEES that Ali asked and sees the
   * answer — she delegated the asking, not her sight of it."* ⚑ **What is still withheld is a
   * PERMISSION's text**, which is what `433`'s bound was ever about.
   *
   * ⚠️ This note first claimed
   * two — the store's `type = 'user_input_request'` filter as well — and `396`'s own mutation row
   * for that filter SURVIVED, which is how the claim was found to be wrong: a `permission_request`
   * carries no `prompt` and no `questions`, so admitting it to that query returns a row the reader
   * skips, and the filter is `053`'s narrow read rather than a gate.
   *
   * ⚑ **And it has to be this gate rather than a type**: a Codex `item/permissions/requestApproval`
   * arrives ON `user_input_request` WITH a prompt and parts, told apart by a field. A reader that
   * trusted the event type would hand a parent a grant of access to read.
   *
   * ⚑ **The rows themselves are NOT narrowed**, and that is `394` §2 unchanged: a permission-shaped
   * routing still lists, still carries its refusal, and is still refused BY NAME at the answer
   * door.
   * ⛔ A reader that dropped them would make the refusal unreachable and the census blind.
   */
  questionsWaitingOn(
    sessionId: string,
    /** ⚑ **676** — see {@link questionsListedFor}, the one caller that passes a set. */
    unread?: RowsUnread,
  ): readonly VisibleQuestion[] {
    // 🔴 **675 · ONE entry per question — the latest routing of it** (`661` F2). ⛔ A question a
    // reopen routed again is a second row for the same asker and id, and a provider id reused across
    // a resume of the same asker is another (`396` §3); `list_questions` listed both, one
    // `abandoned` and one `open`. ⚑ The answer door takes only the LAST row for an id, so the earlier
    // one is a row no call reaches — and in the `396` case it carried the NEWER request's words.
    // ⚑ **679 · and that door keys as this listing does** — it used to take the id ALONE, across
    // askers (`675` F-b), and reached only the newer of two children sharing a session-local id
    // while this listing showed both. ⚑ Since `679` both doors find a question by
    // {@link questionKey}, and two askers sharing an id are refused by name rather than guessed.
    //
    // ⛔ **Keyed by ASKER and id, never by id alone** — measured by this dispatch's own first draft,
    // which merged two children's permission cards: a provider's request ids are session-local
    // (both read `turn_1_perm`), so an id says nothing across conversations
    // (`a-provider-request-id-is-session-local`). ⚠️ Delete-then-set, so each question sits where its
    // latest routing does.
    const latest = new Map<string, RoutedRequest>()
    for (const one of this.questionsVisibleTo(sessionId, unread)) {
      const key = questionKey(one.askedBy, one.requestId)
      latest.delete(key)
      latest.set(key, one)
    }
    const rows = [...latest.values()]
    // ⚑ **One store read per ASKER, not per request** — a parent with one child that asked six
    // things reads one ledger, and a parent with no children reads none at all. ⛔ **474 · the memo
    // is {@link oneQuestionReadPerAnswer}'s**, which this method used to spell inline; a second
    // reader of the same read is what turned it into a method.
    const raised = this.host.oneQuestionReadPerAnswer(unread)
    // ⚑ **D-016 · commit 7 · R3 — each asker named by the piece it owns, and its label to quote**,
    // once per asker per answer, as its record is read.
    // ⚑ **F033 · …by the piece each question was ASKED UNDER** ({@link calledUnder}) — once per
    // asker and piece per answer; a question whose words are not read names no piece.
    const askers = new Map<string, ReturnType<QuestionAnswersHost['calledUnder']>>()
    const askerOf = (conversation: string, piece: string | null) => {
      const key = `${conversation}\u0000${piece ?? ''}`
      const held = askers.get(key)
      if (held !== undefined) return held
      const name = this.host.calledUnder(conversation, piece)
      const asker =
        name.service === true ? { ...name, address: this.host.addressOf(conversation) } : name
      askers.set(key, asker)
      return asker
    }
    const askerFields = (asker: ReturnType<typeof askerOf>) => ({
      askerCalled: asker.called,
      ...(asker.service === true ? { askerAddress: asker.address } : {}),
    })
    return rows.map((request) => {
      // 🔴 **611 · the gate is the REFUSED arm, and it used to be `because !== null`** (HO-088
      // §2.3). ⛔ The two were one set until an asker could address a question to a person, and
      // they are not now: *"Ada still SEES that Ali asked and sees the answer — she delegated the
      // asking, not her sight of it."* ⚑ So an addressed question keeps its words here, and the
      // one thing still withheld is a permission's text, which is what this gate was always for.
      if (request.went.is === 'the-person-the-channel-left-it-with') {
        return { request, words: null, ...askerFields(askerOf(request.askedBy, null)) }
      }
      const read = readOrSkip(request.askedBy, unread?.in(request.askedBy), null, () => {
        const asked = raised(request.askedBy).get(request.requestId)
        if (asked === undefined) return null
        const asker = askerOf(request.askedBy, asked.piece)
        const stalledRecipient = this.host.stalledQuestionRecipient(request)
        return {
          request,
          words: questionText(asker, { ...asked, id: request.requestId }),
          ...askerFields(asker),
          ...(asked.raisedBy === 'this-app' ? {} : { byItsProvider: true as const }),
          ...(stalledRecipient === undefined ? {} : { stalledRecipient }),
        }
      })
      // 🔴 **D-017 · R8 — the outer net**: words the asker's record cannot give are absent, and a
      // counted answer says it skipped that record.
      return read ?? { request, words: null, ...askerFields(askerOf(request.askedBy, null)) }
    })
  }

  /**
   * 🔴 **676 · `list_questions`' answer, and how many ledger rows it could not read** — one
   * `RowsUnread` under the routing scan, each asker's routings and each asker's question words.
   *
   * ⛔ **Until `676` one torn routing ANYWHERE made this RAISE**, and every agent's
   * `list_questions` and `answer_question` with it (measured). ⚑ Now it answers, and the count is
   * `list_tasks`' rule: a count, never a cause, and above `0` a question may be missing from the
   * list or its words may be absent. ⚠️ **The answer door and `pass_question_up` take no set**:
   * each is a rail over one named id, and a torn routing is one whose id nobody can name — it is
   * warned where it is skipped, and the refusal it produces is the one a missing question gets.
   */
  questionsListedFor(sessionId: string): {
    readonly questions: readonly VisibleQuestion[]
    readonly rowsUnread: number
    /** ⚑ **D-017 · R8** — how many conversations' records it skipped whole, when any. */
    readonly ledgersSkipped?: number
  } {
    const unread = rowsUnreadOnce()
    const questions = this.questionsWaitingOn(sessionId, unread)
    return { questions, rowsUnread: unread.count, ...ledgersSkippedOf(unread.ledgersSkipped) }
  }

  /**
   * 🔴 **679 · the routed question a caller NAMED** — by the id it was shown, and by the
   * conversation that asked when it said which. Both doors that take an answer ask it.
   *
   * ## ⛔ Why an id alone is not a question
   *
   * ⚠️ **A provider's request id is session-local** ([[a-provider-request-id-is-session-local]]):
   * Codex numbers its server requests per connection — measured for `item/tool/call` by
   * `probe:codex-request-ids`, every connection starting at `0` — so two children's questions CAN
   * carry one id; whether a question draws on the same counter was not read, and a child that made a
   * tool call first may be one ahead. ⛔ **Until `679` both doors took the LAST routing for
   * the id across every asker** — the child that asked most recently — and `675` F-b's answer went to
   * the wrong child: measured on `main` @ `44c6f029`, the older child's answer taken by the newer.
   *
   * ## ⚑ The asker is derived from what the caller can see, and asked for only when it must be
   *
   *  - **one asker has that id** — its LAST routing, as the doors always took it: a question a
   *    reopen routed again (`661`), and an id a resumed provider reuses (`396` §3), are the same
   *    asker twice, and the first row is always the closed one;
   *  - **two or more** — refused `more-than-one-question-has-that-id`, every asker named, ⛔ never
   *    guessed: not the newest and not the only one still open, since a caller that meant the other
   *    would have its answer taken by a conversation that never asked it. ⚑ **One exception, and it
   *    guesses nothing**: when every asker's last routing is a PERSON's request of ONE kind, whichever
   *    was meant the door says the same true thing — `a-person-answers-this-one` — and sends nothing
   *    (the review's finding: two Codex children parked on their first approval share `number:0`,
   *    and naming `asked_by` would have been refused for every asker the sentence listed);
   *  - **`askedBy` given** — only that asker's routings, so the same call with `asked_by` lands; and
   *    when that asker raised nothing by the id but another of the caller's children did,
   *    `that-conversation-did-not-ask-that`, naming the ones that did. ⛔ **Not
   *    `no-question-by-that-name`**, whose *"no conversation you started is waiting on a request by
   *    that id"* would be false (found by this dispatch's review).
   *
   * ⚠️ **What the caller names is still the id it was shown.** `asked_by` is the field
   * `list_questions` prints beside every id and the question's own words name, so it is never a
   * second identifier a model cannot know.
   *
   * ## ⛔ The entitlement is unchanged: the rows are the ones routed to the caller
   *
   * ⚑ Both refusals name only askers of questions routed to the CALLER, which `list_questions`
   * already names to it; and what an `askedBy` meets depends on those rows alone — a conversation
   * this caller did not start, a child that asked nothing, and a name that is nobody get ONE answer
   * (`refuse-on-entitlement-before-refusing-on-existence`, structural as `394` made it). ⚑ An id
   * nothing routed to the caller carries is `no-question-by-that-name` whatever `askedBy` says.
   *
   * ⚑ **Across a reopen the key does not move**: a reopen keeps the conversation's id and re-routes
   * its question under the same request id, so (asker, id) names the same question before and after
   * — the reopen's routing is simply its last row.
   */
  private theQuestionNamed(
    speaking: string,
    questionId: string,
    askedBy: string | null,
  ):
    | { readonly is: 'found'; readonly request: RoutedRequest | undefined }
    | { readonly is: 'refused'; readonly refusal: QuestionRefusal } {
    const underTheId = this.questionsRoutedToWhatItStandsFor(speaking).filter(
      (one) => one.requestId === questionId,
    )
    if (
      underTheId.length === 0 &&
      this.isOwnOrGivenPersonQuestion(speaking, askedBy ?? speaking, questionId)
    ) {
      return {
        is: 'refused',
        refusal: refuseQuestion('person-addressed-request', { question: questionId }),
      }
    }
    // ⚑ **In routing order**, because `questionsRoutedTo` sorts by `at` — so a refusal names the
    // askers in the order their requests reached this caller.
    const askers = [...new Set(underTheId.map((one) => one.askedBy))]
    if (askedBy !== null) {
      const theirs = underTheId.filter((one) => one.askedBy === askedBy)
      if (theirs.length > 0 || askers.length === 0) {
        return { is: 'found', request: theirs[theirs.length - 1] }
      }
      return {
        is: 'refused',
        refusal: refuseQuestion('that-conversation-did-not-ask-that', {
          question: questionId,
          askers,
        }),
      }
    }
    if (askers.length > 1 && !this.oneKindOfPersonsRequest(underTheId, askers)) {
      return {
        is: 'refused',
        refusal: refuseQuestion('more-than-one-question-has-that-id', {
          question: questionId,
          askers,
        }),
      }
    }
    return { is: 'found', request: underTheId[underTheId.length - 1] }
  }

  private isOwnOrGivenPersonQuestion(speaking: string, asker: string, questionId: string): boolean {
    const raised = this.deps.store.questionsRaisedIn(asker).get(questionId)
    if (raised?.raisedBy !== 'this-app' || raised.passedUpFrom !== null) return false
    if (speaking !== asker) {
      const giver = raised.piece === null ? null : this.deps.store.workById(raised.piece)?.givenBy
      if (giver == null || !this.host.theIdsItStandsFor(speaking).includes(giver)) return false
    }
    const route = this.deps.store
      .routedRequestsOf(asker)
      .filter((one) => one.requestId === questionId)
      .at(-1)
    return route?.parent === null && route.went.is === 'the-person-the-asker-named'
  }

  /**
   * ⚑ **679 · is every asker's last routing under this id a PERSON's request, of one kind?** — the
   * one case {@link theQuestionNamed} does not refuse as shared, because every reading of the id meets
   * the same `a-person-answers-this-one` and the same `detail.because`, and nothing is sent.
   */
  private oneKindOfPersonsRequest(
    underTheId: readonly RoutedRequest[],
    askers: readonly string[],
  ): boolean {
    const kinds = new Set(
      askers.map((asker) => {
        const theirs = underTheId.filter((one) => one.askedBy === asker)
        const last = theirs[theirs.length - 1]
        return last?.went.is === 'the-person-the-channel-left-it-with'
          ? theChannelRefusalIn(last)
          : null
      }),
    )
    return kinds.size === 1 && !kinds.has(null)
  }

  /**
   * 🔴 **Answer a question another conversation asked you with `ask_question`** (394, criteria 9
   * and 10). ⚑ A provider's own request is the person's, at its card, and is refused here.
   *
   * ## ⛔ The entitlement is the lookup, and the lookup is scoped to the caller
   *
   * ⚠️ **`questionsRoutedTo(speaking)` is asked of nothing else** — ⚑ D-017 · R10: and of the
   * conversations it took the place of ({@link questionsRoutedToWhatItStandsFor}) — so a caller cannot
   * spell an id that reaches a family it did not start — *"not yours"* and *"no such request"* are one absence by
   * construction. If no route matched, the asker or the work giver can get the person-only
   * refusal for an exact app-raised request. That read never supplies a request to settle.
   *
   * ## 🔴 A permission in that scope is refused BY NAME, and that is criterion 10 with teeth
   *
   * ⛔ **The obvious implementation — route only questions, and let a permission id find nothing —
   * would have been the filter §2 forbids.** The caller would meet *"there is nothing here"*, which
   * is false, and the app would have lost the only sentence worth saying. ⚑ {@link admitAnswer}
   * asks the KIND before the ending, so a parent that named a permission is told what it named
   * whether or not a person has already dealt with it.
   *
   * ## ⚠️ A person does not come through this door
   *
   * ⛔ **`respondUserInput` is the person's door and it is untouched.** This one refuses a caller
   * that is not speaking as an agent with the ordinary `no-question-by-that-name` — nobody routes
   * anything to a person, so there is no such request, which is the same shape `393`'s reply uses
   * for the same reason. ⚑ `requireToAnswer`'s gate is NOT widened to let an agent through it:
   * `340` §2 made that the one door {@link THE_APP_ITSELF} is turned away from, and a widening there
   * would be a widening for every caller.
   */
  async answerQuestion(
    input: {
      questionId: string
      answers: readonly { part: string; answer: readonly string[] }[]
      /** 🔴 **679 · which conversation asked it**, when the caller said — see {@link theQuestionNamed}. */
      askedBy?: string | null
      /**
       * 🔴 **D-009 · F012 — the one asked cannot answer it, and why** (ruling 2: *"a peer answers,
       * or says it can't"*). ⚑ The fold's `rejected`, and the asker is told the reason.
       */
      cannot?: string | null
      resources?: readonly string[]
      /**
       * The asker's running turn is to be asked to stop, so the answer is read without waiting —
       * what `answer_question` asks unless its caller says not to.
       */
      interrupt?: boolean
    },
    by: Caller,
  ): Promise<AnswerWithItsStop> {
    const speaking = sessionSpeakingAs(by)
    const stopAs = input.interrupt === true ? by : null
    if (speaking === null) {
      return {
        ok: false,
        refusal: refuseQuestion('no-question-by-that-name', { question: input.questionId }),
      }
    }
    // 🔴 **The LAST match, and a resume is why** (found by this dispatch's own §5). ⛔ **A request
    // id is unique per PROVIDER SESSION, and a resumed conversation is a new provider session** — so
    // one ledger can hold the same id twice, once per life, and taking the first would hand back the
    // OLDEST, which is always the closed one. ⚑ The most recently routed row is the live one;
    // anything else refuses a live question by quoting an ending that belongs to a request nobody is
    // waiting on. ⚠️ Measured on the double, whose counter restarts with the runtime — and true of a
    // real provider for the same reason, since neither adapter's id is drawn from anything durable.
    //
    //
    // 🔴 **679 · the last match for the ASKER and the id, never for the id alone** — see
    // {@link theQuestionNamed}, which both doors share. ⛔ A request id is session-local, so two
    // children's can be one string, and the last row for it across askers is simply the one that
    // asked most recently: `675` F-b, measured by `679` — the older child's answer, taken by the newer.
    if (this.host.startupRepairs().size > 0) {
      for (const one of this.questionsRoutedToWhatItStandsFor(speaking)) {
        if (one.requestId === input.questionId) await this.host.settleBeforeUse(one.askedBy)
      }
    }
    const named = this.theQuestionNamed(speaking, input.questionId, input.askedBy ?? null)
    if (named.is === 'refused') return { ok: false, refusal: named.refusal }
    const request = named.request
    // ⚑ **D-017 · R6 — answered in this run, its decision not down yet** ({@link answeredInThisRun}):
    // the fold still reads it open, and a second answer would be admitted.
    const answeredAlready =
      request === undefined
        ? undefined
        : this.host.answeredInThisRun().get(aQuestionKey(request.askedBy, request.requestId))
    if (request !== undefined && answeredAlready !== undefined) {
      return {
        ok: false,
        refusal: refuseQuestion('question-has-already-ended', {
          question: request.requestId,
          state: answeredAlready,
        }),
      }
    }
    const refusal = admitAnswer(request)
    if (refusal !== null) return { ok: false, refusal }
    // ⛔ **`admitAnswer` returning null is what proves `request` is defined**, and TypeScript cannot
    // see it through the function boundary. A bug guard rather than a rail: if it fires, the door
    // and this method disagree about what an admission means.
    if (request === undefined) throw new Error('an answer was admitted against no request (394)')
    // ⚑ **D-017 · R1 — a question this app asked is answered in its asker's ledger, running or not,
    // and the answer starts it** ({@link deliverAnswer}).
    if (this.host.startupRepairs().has(request.askedBy))
      await this.host.settleBeforeUse(request.askedBy)
    const words = this.host.theWordsOf(request.askedBy, request.requestId)
    // A provider's own question is the person's, at its card: only a question this app holds is
    // answered here.
    if (words === undefined) {
      return {
        ok: false,
        refusal: refuseQuestion('a-person-answers-this-one', { question: request.requestId }),
      }
    }
    // 🔴 **Words over the bound are refused, and nothing is written** — see {@link oneAgentsAnswer}.
    // 🔴 **D-009 · F012 — it says it cannot answer.** ⚑ The question is closed `rejected` and its
    // asker is sent the reason.
    const cannot = input.cannot ?? null
    const questions = words.questions
    if (cannot === null) {
      const given = new Map<string, string[]>()
      for (const { part, answer } of input.answers) {
        const values = given.get(part) ?? []
        for (const value of answer) values.push(value)
        given.set(part, values)
      }
      // Free-text parts already accept several strings in one answer, including in overflow files.
      const parts = questions.map((part) =>
        part.options.length === 0 ? { ...part, multiSelect: true } : part,
      )
      const shape = answerToForward(parts, Object.fromEntries(given))
      if (!shape.forwardable) {
        return {
          ok: false,
          refusal: refuseQuestion('that-answer-cannot-be-sent', {
            question: request.requestId,
            said: shape.why,
          }),
        }
      }
    }
    const files = this.host.prepareFilesForSend(speaking, input.resources ?? [])
    if (!files.ok) return files
    const hasFiles = files.files.length === 0 ? {} : { files: files.files }
    if (cannot !== null) {
      const prepared = this.host.prepareTextForSend(speaking, 'cannot_answer', cannot)
      if (!prepared.ok) return prepared
      await this.host.decideAQuestionThisAppAsked(
        request.askedBy,
        request.requestId,
        'rejected',
        by,
      )
      const told = this.host.deliverAnswer(
        words,
        request.requestId,
        speaking,
        null,
        prepared.text,
        null,
        stopAs,
        files.files,
      )
      this.host.theWorldMoved('work')
      const { kept, stop, held, delivery } = await told
      return {
        ok: true,
        question: request.requestId,
        asked: request.askedBy,
        piece: words.piece,
        notAsked: [],
        ...this.answerReceipt(request.requestId, delivery, files.files, prepared.overflow),
        ...(delivery === undefined ? {} : { deliveredTo: delivery.to }),
        ...hasFiles,
        ...(prepared.overflow === undefined ? {} : { overflow: prepared.overflow }),
        ...(kept === null ? {} : { kept }),
        ...(stop === null ? {} : { stop }),
        ...(held ? { held } : {}),
      }
    }
    const measured = oneAgentsAnswer(input.answers, questions)
    const prepared =
      measured.units <= INLINE_TEXT_LIMIT
        ? null
        : this.host.prepareTextForSend(speaking, 'answer', answerTextForFile(measured.answers))
    if (prepared?.ok === false) return prepared
    const overflow = prepared?.overflow
    const parts =
      overflow === undefined
        ? measured.answers
        : answerPreview(measured.answers, questions, overflow)
    const hasOverflow =
      overflow === undefined ? {} : { overflow: { ...overflow, characters: measured.units } }
    // 🔴 **A question THIS APP is holding is resolved here and never forwarded** (437): what takes
    // this answer is its asker's `question_asked` row ({@link theWordsOf}), keyed by the asker and
    // the id (679).
    const asker = request.askedBy
    const settleWithHeldWords =
      request.went.to !== 'a-person' &&
      request.parent === speaking &&
      words.move === undefined &&
      words.action === undefined &&
      this.host.theOneInItsPlace(asker) === asker &&
      !this.host.slots().has(asker) &&
      !this.host.startsInFlight().has(asker) &&
      !this.host.arrivals().has(asker) &&
      !this.host.startupRepairs().has(asker) &&
      this.host.isAnUnforwardedAppQuestion(
        asker,
        request.requestId,
        this.host.theIdsItStandsFor(speaking),
      )
    const decisionForStoppedAsker: UserDecisionEvent | undefined = settleWithHeldWords
      ? {
          type: 'user_decision',
          requestId: request.requestId,
          outcome: 'answered',
          by: whoDidIt(by),
        }
      : undefined
    if (!settleWithHeldWords) {
      await this.host.decideAQuestionThisAppAsked(asker, request.requestId, 'answered', by)
    }
    const said = parts.map((one) => ({ part: one.part, answer: [...one.answer] }))
    const told = this.host.deliverAnswer(
      decisionForStoppedAsker === undefined ? words : { ...words, decisionForStoppedAsker },
      request.requestId,
      speaking,
      said,
      null,
      null,
      stopAs,
      files.files,
    )
    // 🔴 **638 · the work moved** — `answerQuestion` closes the `answers` half on its second ending.
    // ⛔ **The `childrenOpen` half is not the only one that composes a piece's state**: `answers`
    // and `aPerson` do too, and a surface reading a row cannot tell which half moved it.
    if (!settleWithHeldWords) this.host.theWorldMoved('work')
    const { kept, stop, held: behindItsTurn, delivery } = await told
    return {
      ok: true,
      question: request.requestId,
      asked: request.askedBy,
      piece: words.piece,
      notAsked: measured.notAsked,
      ...this.answerReceipt(request.requestId, delivery, files.files, overflow),
      ...(delivery === undefined ? {} : { deliveredTo: delivery.to }),
      ...hasFiles,
      ...hasOverflow,
      ...(kept === null ? {} : { kept }),
      ...(stop === null ? {} : { stop }),
      ...(behindItsTurn ? { held: behindItsTurn } : {}),
    }
  }

  private answerReceipt(
    question: string,
    delivery: AnswerDelivery | undefined,
    files: SendReceipt['attachments'],
    overflow: ReadableSendOverflow | undefined,
  ): { readonly receipt?: SendReceipt } {
    if (delivery === undefined) return {}
    try {
      const { to, taskLabel } = delivery
      let state: SendRecipientState
      if (delivery.kind === 'sent') {
        state = { kind: 'started' }
      } else if (delivery.kind === 'held') {
        const behind = this.deps.store
          .messagesWaitingIn(to)
          .findIndex((one) => one.messageId === delivery.queueId)
        if (behind < 0) return {}
        state = { kind: 'queued', behind }
      } else {
        const { cause, needsPerson } = delivery
        state = { kind: 'cannot-run', cause, ...(needsPerson === true ? { needsPerson } : {}) }
      }
      const attachments =
        overflow === undefined ? files : [...files, sendOverflowAttachment(overflow)]
      const receipt = this.host.receiptForSend({
        recorded: { kind: 'reply', id: question, taskLabel },
        to,
        state,
        attachments,
      }).receipt
      return { receipt }
    } catch (error) {
      console.warn(
        `runtime host could not read the receipt for question ${question}: ${errorMessage(error)}`,
      )
      return {}
    }
  }
}

/**
 * 🔴 **One agent's answer, with its OWN words measured as ONE answer** (676 · F4, `671` §7's review
 * finding).
 *
 * ## ⛔ Why a bound, and why this one
 *
 * ⚠️ **`answer_question`'s free text reached the asking conversation UNBOUNDED** — a door of the
 * family `REPLY_SUMMARY_LIMIT` bounds: a string one agent writes into ANOTHER conversation (a
 * reply's summary, `ask_question`'s question and options, `pass_question_up`'s context). ⚑ **The
 * same number, not a new one**, so the family has one bound and no member drifts from it.
 *
 * ## 🔴 The WHOLE answer, never each string (`676`'s review)
 *
 * ⛔ **Bounding each string on its own** let ten strings of 1,280 units reach the asker as a
 * 12,800-unit turn — *"an unbounded list defeats the one bound this door applies"*, `ask_question`'s
 * own sentence about its options, which it bounds by their TOTAL. ⚑ So `units` is the total of the
 * answerer's own words across every part that is delivered.
 *
 * ## 🔴 Refused, never cut
 *
 * ⛔ **`676` cut the words at the bound and marked the cut**, after the question was closed — so the
 * rest could not go the same way, and an answerer that did not re-send it as a note left it in its
 * own conversation only. ⚑ The host refuses an answer whose `units` is over the bound
 * (`answer-too-long`) before anything is written, as `reply_to_parent` refuses a long summary; what
 * this returns is delivered whole.
 *
 * ## ⛔ What is NOT the answerer's words, and so is not counted
 *
 * ⚑ **A chosen LABEL is the asker's words.** On a question a provider raised nothing bounds them
 * (`676` §3's third door), and `answerToForward` matches one by exact string — so counting it would
 * refuse a correct choice for words the answerer cannot shorten. ⚠️ Told apart by the adapter's own
 * {@link isOfferedLabel}. ⚑ **A blank string** is `''` here and is not counted: it means nothing to
 * `answerToForward` (`676`'s review).
 *
 * ## ⚠️ A part nobody asked is not delivered
 *
 * ⚑ **The held branch rendered every part the caller named**, the ones the question never asked
 * included; the provider branch already ignored them. Drop them and name them in `notAsked`.
 */
function oneAgentsAnswer(
  given: readonly { readonly part: string; readonly answer: readonly string[] }[],
  asked: readonly UserInputQuestion[],
): {
  readonly answers: readonly { readonly part: string; readonly answer: readonly string[] }[]
  readonly notAsked: readonly string[]
  /** ⚑ The answerer's own words across every delivered part, in UTF-16 units. */
  readonly units: number
} {
  const questionOf = (part: string): UserInputQuestion | undefined =>
    asked.find((candidate) => candidate.id === part)
  const delivered = given.filter((one) => questionOf(one.part) !== undefined)
  const notAsked = given.filter((one) => !delivered.includes(one)).map((one) => one.part)
  // ⚑ **The answerer's own words** — not blank, and not a label the question offered.
  const isItsOwn = (part: string, said: string): boolean => {
    if (said.trim() === '') return false
    const question = questionOf(part)
    return question === undefined || !isOfferedLabel(question, said)
  }
  const units = delivered
    .flatMap((one) => one.answer.filter((said) => isItsOwn(one.part, said)))
    .reduce((total, said) => total + said.length, 0)
  const answers = delivered.map((one) => ({
    part: one.part,
    answer: one.answer.map((said) => (said.trim() === '' ? '' : said)),
  }))
  return { answers, notAsked, units }
}
