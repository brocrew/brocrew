import { CHANNEL_REFUSAL_SENTENCES } from '@brobot2/runtime'
import { eachOrSkipped, ledgersSkippedOf } from '../db/session-store'
import { rowsUnreadOnce } from '../db/rows-unread'
import type { SessionStore } from '../db/session-store'
import {
  REQUEST_IS_OPEN,
  aboutTheWork,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  aPersonsSince,
  readingSentence,
  whatTheAskerOffered,
} from '../../shared/questions'
import type {
  CardNobodyHolds,
  LedgerWalk,
  PersonsDecision,
  PersonsQuestion,
  RaisedQuestion,
  RoutedRequest,
  WorkInHand,
} from '../../shared/question-contracts'
import { workNamed } from '../../shared/tasks'
import type { PieceRow } from '../../shared/task-contracts'

type PersonsQuestionReads = {
  readonly store: Pick<
    SessionStore,
    | 'questionsAPersonMustAnswer'
    | 'decisionsAwaitingAPerson'
    | 'routedRequestsOf'
    | 'rootOf'
    | 'theRequestRouted'
  >
  shown<Row>(walk: LedgerWalk<Row>, conversationOf: (row: Row) => string): LedgerWalk<Row>
  oneNamingPerAnswer(): (id: string) => string
  onePieceReadPerAnswer(): (id: string) => readonly PieceRow[]
  oneWorkReadPerAnswer(
    pieces?: (id: string) => readonly PieceRow[],
  ): (id: string) => readonly WorkInHand[]
  oneQuestionReadPerAnswer(): (id: string) => ReadonlyMap<string, RaisedQuestion>
  cardIdentity(askedBy: string): Pick<CardNobodyHolds, 'provider' | 'profileId'> | null
}

/** Composes the person's questions and decisions using the current host reading. */
export class PersonsQuestions {
  constructor(private readonly reads: PersonsQuestionReads) {}

  /**
   * 🔴 **What is waiting on a PERSON, and the chain that explains why** (398, criterion 11).
   *
   * ⛔ **Every open routed question that is a PERSON's to answer**, across every conversation this
   * database holds — not one family, because a person is not inside one. ⚑ That is the difference
   * between this and {@link questionsWaitingOn}, which answers a parent about its own children and
   * is scoped to them by construction.
   *
   * ⚠️ **612 · it said *"a deadline has already escalated"*** (HO-088 §3.1, standing rule 8.1).
   * ⛔ **No deadline escalates anything.** A row reaches this reader because its asker addressed it
   * to a person or because a parent passed it up — both acts — and, for a ledger written before
   * `612`, because a deadline once did.
   *
   * ## ⚠️ It reports and rules nothing
   *
   * ⛔ **What to do about a question a person now owes an answer to — answer it, deny it, end the
   * child, wake somebody — is policy**, and policy is a surface. `unclaimedSessions`' own note says
   * the same thing about the same kind of fact, and this is that note honoured rather than repeated:
   * the door a person answers through is unchanged (`respondUserInput`, on the child, where the card
   * still is).
   *
   * ## 🔴 A permission cannot be here, and it is structural
   *
   * ⛔ Nothing ever stamped a routing that was already a PERSON's — `escalationsDue` refused to,
   * and since `612` nothing stamps anything at all — so a permission-shaped request has
   * `escalatedAt === null` for ever, and
   * {@link SessionStore.questionsAPersonMustAnswer} excludes
   * {@link WhereARequestWent}'s refused arm BY NAME on top of that. ⚠️ **The rows are not narrowed
   * anywhere** — {@link permissionShaped} still sees them all, so *"has anything permission-shaped
   * arrived?"* stays an instrument rather than becoming a promise.
   *
   * ⚠️ **611 · this said *"never returns a routing with a `RoutedRequest.because`"*** (standing
   * rule 8.1). ⛔ That field is gone, and the claim it made was one deadline's skip carrying the
   * whole exclusion; since `HO-088` §2 the reader states its own, because a question can be a
   * person's with nothing refused and the two must not be folded.
   */
  questionsForAPerson(): LedgerWalk<PersonsQuestion> {
    // 🔴 **D-017 · R8 — ONE set for the walk and every read this answer adds**, so a record met by
    // both is skipped once and named once.
    const unread = rowsUnreadOnce()
    const escalated = this.reads.shown(
      this.reads.store.questionsAPersonMustAnswer(unread),
      (row) => row.askedBy,
    )
    // ⚑ **One store read per conversation asked about, memoised across the whole answer** — a chain
    // of four questions through three conversations reads three ledgers, not twelve.
    const waiting = new Map<string, RoutedRequest | null>()
    const openQuestionOf = (sessionId: string): RoutedRequest | null => {
      const held = waiting.get(sessionId)
      if (held !== undefined) return held
      // ⛔ **The question this conversation raised, not the ones raised AT it.** A parent is blocked
      // when IT is waiting on an answer from its own parent; the questions its children asked are
      // what it is blocking, and reading those would walk the chain the wrong way.
      //
      // 🔴 **611 · `went.to === 'the-parent'` and it used to be `because === null`** (HO-088 §2).
      // ⛔ A chain hop asks *is this conversation itself blocked on the one above it*, and a
      // question its asker addressed to a PERSON is not: the hop above owes nothing, and walking
      // through it would draw a chain claiming a conversation was waiting on its parent when the
      // person it named is the one who has it. ⚑ The old spelling admitted exactly that arm.
      const mine =
        this.reads.store
          .routedRequestsOf(sessionId, unread)
          .find((one) => REQUEST_IS_OPEN[one.state] && one.went.to === 'the-parent') ?? null
      waiting.set(sessionId, mine)
      return mine
    }
    const name = this.reads.oneNamingPerAnswer()
    // ⚑ **474 · ONE ledger read per asker, shared by both questions asked of it** — *what work is
    // this conversation holding* and *which of it does this question name* are two folds over one
    // read, and giving them a memo each would walk every blocked conversation's ledger twice on a
    // poll that runs every five seconds for the life of a window.
    const pieces = this.reads.onePieceReadPerAnswer()
    const work = this.reads.oneWorkReadPerAnswer(pieces)
    // 🔴 **474 · the words of the question this row IS, read from the asker's own ledger** — see
    // {@link oneQuestionReadPerAnswer}. ⛔ Asked of the asker and never of the parent: the row that
    // named the work is the one the asker wrote.
    const raisedIn = this.reads.oneQuestionReadPerAnswer()
    // 🔴 **453 · the WALK is carried through and never recomputed here** — see {@link LedgerWalk}.
    // ⛔ This method maps rows and knows nothing about which ledgers were opened; re-deriving the
    // count from `escalated.rows.length` would answer *what was found* to a question that asked
    // *what was read*, which is `447`'s defect one surface over.
    return {
      walk: escalated.walk,
      ledgers: escalated.ledgers,
      rowsUnread: escalated.rowsUnread,
      // 🔴 **D-017 · R8 — the outer net**: a row the asker's record cannot build is skipped.
      rows: eachOrSkipped(escalated.rows, 'askedBy', unread, (request) => {
        const chain = escalationChain(request, openQuestionOf)
        // ⚑ **474 · one fold, one arm** — see {@link AboutWork} and the field below.
        // ⚑ **602 · ONE lookup, two questions** — *which work is this about* and *what raised
        // it*. ⛔ The map is the memoised read above, so the second question costs no statement.
        const raised = raisedIn(request.askedBy).get(request.requestId)
        // ⚑ **D-016 · the asker's root is its work too** — a question about it names the root.
        const about = aboutTheWork(raised?.piece ?? null, (id) => {
          const root = this.reads.store.rootOf(request.askedBy)
          return root?.piece === id ? { label: root.label } : workNamed(pieces(request.askedBy), id)
        })
        // ⚑ **One naming, read twice** (401). The hops a surface DRAWS and the line HO-007 asked for
        // come out of the same walk with the same names — and a renderer never has to turn a
        // `sess_<uuid>` into a word it cannot know.
        return {
          request,
          // ⚑ **611 · the same derivation the store sorted by, COPIED** — see
          // {@link aPersonsSince}. ⛔ No fallback: a null is the honest answer for a row the reader
          // should not have admitted, and filling it in here would put *just now* on a row that
          // has no instant at all (`PersonsQueueRow.blockedSinceIs`' own argument).
          aPersonsSince: aPersonsSince(request),
          chain,
          reading: chainReading(chain, name),
          sentence: chainSentence(chain, name),
          // ⛔ **The ASKER's work, and never the parent's** (434) — see {@link WorkInHand}. A chain
          // walks upward; criterion 20 asks what the conversation that stopped is doing, which is
          // the bottom of it.
          work: work(request.askedBy),
          // 🔴 **474 · the EDGE, carried** (`463` F4) — see {@link AboutWorkIs}. ⛔ `437` wrote
          // `question_asked.taskId` into the asker's ledger and this reader never asked for it, so
          // a person was shown every open task in the conversation under the sentence *"which of
          // it this is about is not recorded"* — an absence stated about a fact the app had.
          //
          // ⚑ **The arm comes from {@link aboutTheWork}**, so a word standing over the wrong work
          // is unconstructable, and the resolution is against the asker's OWN work — its root and
          // the pieces it holds — which is what makes a piece from another conversation unresolvable
          // rather than wrongly resolved.
          //
          // ⛔ **One field and not a pair, which is what makes the disagreeing state
          // unconstructable** — see {@link AboutWork}.
          about,
          // 🔴 **602 · what RAISED it, which is what decides whether a card exists** — see
          // {@link HowItWasRaised}. ⛔ **`'nothing-says'` when this read found no row**, and it is
          // the honest third answer rather than a default: the queue keeps the sentence it would
          // have said anyway, instead of claiming an absence out of a read that missed.
          raisedBy: raised?.raisedBy ?? 'nothing-says',
          // A to-do the agent asked the person to do, with its files.
          ...(raised?.action === undefined
            ? {}
            : { action: { text: raised.prompt, files: raised.action.files } }),
          // 🔴 **619 · what a person may press where there is no card** — see
          // {@link whatTheAskerOffered}. ⛔ **The SAME `raised` row the two lines above read**, so
          // *what raised it*, *which work it is about* and *what it offered* are one lookup and
          // cannot come from three moments. ⚠️ A read that missed hands `undefined` and the fold
          // answers `null`, which is the honest absence rather than an empty offer.
          offered: whatTheAskerOffered(raised),
          // 🔴 **D-046 · the question as it was asked** — see {@link PersonsQuestion.asked}. ⚑ The
          // SAME `raised` row again, whole, so a window draws it without looking in a conversation.
          asked:
            raised === undefined
              ? null
              : {
                  prompt: raised.prompt,
                  context: raised.context,
                  passedUp: raised.passedUpFrom !== null,
                  ...(raised.move === undefined ? {} : { move: raised.move }),
                  parts: raised.questions,
                },
        }
      }),
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  /**
   * 🔴 **What a person may NOT delegate: every open request that never travelled** (403, from
   * `402` F1, criterion 11's other half).
   *
   * ## ⛔ The population `401` shipped a queue for could not contain this one
   *
   * ⚠️ **Three facts that only bite together, and `402` put them together on a live run.**
   * (1) 🔴 **A child is `ask` whenever the conversation that started it is** — a conversation
   * `give_work` starts runs in its giver's mode, and `admitGive` refuses one that would act past its
   * folder with nobody asked where its giver could not, by the named rail `wider-than-its-parent`
   * (499, HO-036; D-038) — so the first consequential tool call an agent-started conversation
   * makes parks on a permission card, **unless the agent that started
   * it was itself running without them.** ⛔ **This clause read *"Every spawned child is `ask` BY
   * RAIL"* until `499`**, which was `366`'s absolute and is withdrawn: the population below is
   * therefore smaller than it was, and never larger. ⚑ The rows it reads are unchanged —
   * `permissionShaped` finds a card wherever one exists — so what moved is how many there are to
   * find, not whether this reader finds them. (2) Only a person may answer it, and a spawned child
   * is reserved under no owner. (3) {@link questionsForAPerson} cannot admit one:
   * nothing ever stamped a routing that was already a person's — and since `612` nothing stamps
   * anything — so a permission's `escalatedAt` is null for ever, and since `611` the reader beside
   * it excludes the refused arm by name as well. ⛔ **Measured: three permissions needed a person on one worker, and that queue listed
   * none of them.**
   *
   * ⚑ **So a child frozen on an answer only a person can give was in none of Home's populations.**
   * The rows always existed — `permissionShaped` finds every one — which is why `402` filed it as a
   * wiring gap rather than a design one, and why this is a READER rather than a new event.
   *
   * ## ⚠️ It rules nothing, exactly as {@link questionsForAPerson} rules nothing
   *
   * Who may decide is the answer doors' rule: the window holding the conversation, or — where no
   * window holds it — any person, from the queue, with the card each row carries
   * ({@link aPersonAnswersWhereNobodyHolds}). Never an agent.
   *
   * ## 🔴 No chain is walked, because there is nothing above the asker
   *
   * ⛔ **Knowledge escalates; authority does not.** A question may travel — worker to PM to a
   * person — and its chain is that walk. A request refused entry to the channel was always a
   * person's, so it is *"worker waiting on you"*, at any depth. {@link decisionReading} is the one
   * hop and {@link readingSentence} is the same join the escalated line uses.
   */
  decisionsForAPerson(): LedgerWalk<PersonsDecision> {
    const name = this.reads.oneNamingPerAnswer()
    const work = this.reads.oneWorkReadPerAnswer()
    // 🔴 **D-017 · R8** — one set for the walk and this answer's own reads.
    const unread = rowsUnreadOnce()
    const walked = this.reads.shown(
      this.reads.store.decisionsAwaitingAPerson(unread),
      (row) => row.askedBy,
    )
    // ⚑ **453 · the walk carried through**, exactly as {@link questionsForAPerson} carries it.
    return {
      walk: walked.walk,
      ledgers: walked.ledgers,
      rowsUnread: walked.rowsUnread,
      // 🔴 **D-017 · R8 — the outer net**: a row the asker's record cannot build is skipped.
      rows: eachOrSkipped(walked.rows, 'askedBy', unread, (request) => {
        const reading = decisionReading(request.askedBy, name)
        return {
          request,
          reading,
          sentence: readingSentence(reading),
          // ⛔ **Criterion 20's *which work*, on this population too** (434) — the same read, keyed
          // by the same conversation, because `402`'s measured shape is three cards on one worker
          // and reading its ledger once per card is the cost `oneNamingPerAnswer` already refuses.
          work: work(request.askedBy),
          // ⚑ **The vocabulary's own sentence, rendered here rather than in the window.** See
          // `PersonsDecision.says`: the map is a value in `@brobot2/runtime`, and a renderer that
          // imported it would pull the package into the window bundle for five strings.
          // ⚠️ **A fallback, and it is a real case rather than defensive noise.** `because` is read
          // back out of persisted JSON by a CAST — `toPersistedEvents` does `JSON.parse(row.payload)
          // as TranscriptEvent` and nothing checks it against `CHANNEL_REFUSALS` — so an imported
          // conversation, or this build reading a ledger a later one wrote, can carry a sixth
          // member. ⛔ The map answers `undefined` there, which is typed `string`, survives a
          // structured clone, and draws an EMPTY amber paragraph.
          //
          // ⛔ **And the fallback is a SENTENCE, never the word.** {@link PersonsDecision.says}
          // promises a person the vocabulary's own prose, and `CHANNEL_REFUSAL_SENTENCES`' docblock
          // says the words are *"never for a model"* and the enum is. ⚑ What it says is the only
          // thing this app knows in that state, and it is the same thing
          // `a-shape-this-app-has-not-been-taught` says one layer up.
          says:
            CHANNEL_REFUSAL_SENTENCES[request.went.because] ??
            'something only a person can settle, of a kind this app has not been taught',
          ...this.theCardNobodyHolds(request.askedBy, request.requestId),
        }
      }),
      ...ledgersSkippedOf(unread.ledgersSkipped),
    }
  }

  /**
   * The request's card, for a conversation running with no window holding it: what a person needs
   * to answer it from the queue ({@link aPersonAnswersWhereNobodyHolds}). Nothing for any other.
   */
  private theCardNobodyHolds(
    askedBy: string,
    requestId: string,
  ): { readonly card?: CardNobodyHolds } {
    const identity = this.reads.cardIdentity(askedBy)
    if (identity === null) return {}
    const asked = this.reads.store.theRequestRouted(askedBy, requestId)
    if (asked === null) return {}
    return {
      card: { asked, provider: identity.provider, profileId: identity.profileId },
    }
  }
}
