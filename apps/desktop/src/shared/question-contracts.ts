import type { TranscriptEvent } from './conversation-events'
import type { MoveOffer } from './move-contracts'
import type { ChannelRefusal, UserInputQuestion } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

export type RequestState = (typeof REQUEST_STATES)[number]

/**
 * 🔴 **Who an agent may say its question is for** (611, HO-088 §2.1) — two ends, and only two.
 *
 * ⛔ **Not a list of arbitrary targets.** `HO-058`'s open messaging is how agents talk to each
 * other; this is the ESCALATION path, and the PO ruled it has two ends: *"the parent, or the
 * person."* ⚑ An agent that wants a THIRD conversation's opinion sends it a message.
 *
 * ## ⚠️ It is DERIVED from the wire's own field rather than spelled a second time
 *
 * ⛔ **{@link RequestRoutedEvent.to} is the durable record**, and a tool advertising its own copy
 * of the two words is how a verb comes to accept a value the ledger cannot hold. ⚑ The `satisfies`
 * below and {@link RECIPIENT_MEANS}' exhaustive `Record` pin it in both directions: a member added
 * to the event and missing here fails the Record, and a member here that the event does not have
 * fails the list.
 */
export type QuestionRecipient = RequestRoutedEvent['to']

/** One of {@link PASS_UP_RECIPIENTS}. */
export type PassUpRecipient = (typeof PASS_UP_RECIPIENTS)[number]

/**
 * 🔴 **Where a request went, and what put it there** (611, HO-088 §2) — one field, three arms, and
 * {@link ChannelRefusal} on the only arm that has one.
 *
 * ## ⛔ The invariant this replaces, quoted, because it was true until this dispatch
 *
 * ⚠️ **`RoutedRequest` carried `to` beside `because` and the docblock ruled them one fact:**
 * *"the event carries `because` if and only if it carries `to: 'a-person'`."* ⛔ **`HO-088` §2 ends
 * that**: an agent may now say its question is for the person, so `to: 'a-person'` has TWO causes —
 * *the asker addressed it* and *the channel refused it* — and only the second names a shape.
 *
 * ## 🔴 Why a union and not a word beside a value
 *
 * ⚑ **`a-value-beside-a-word-or-a-union-of-arms`: the pair is right only when the value stands
 * independently of the reason, and a `ChannelRefusal` does not.** ⛔ Nothing refused an addressed
 * question, so `{ to: 'a-person', because: null }` and `{ to: 'a-person', because: 'a-permission-
 * decision' }` are two different facts that a nullable field renders as one field with a hole in
 * it. ⚠️ **`607` split `TurnOrigin` this way and the split turned a latent defect into a compile
 * error**; the same happens here, and it had to: **every reader in this app spelled *the parent's*
 * as `because === null`**, which is the reading `HO-088` §2 makes wrong about the first row it
 * meets.
 *
 * ## ⚠️ `to` is on every arm, and that is not redundancy
 *
 * ⛔ **Most readers want the RECIPIENT and nothing else** — who may answer, whose queue it is in,
 * whether a deadline has anything to say about it. ⚑ Carrying `to` on each arm lets them read it
 * without narrowing, while `because` stays unreachable until a reader has decided which arm it is
 * looking at. ⚠️ The two cannot disagree: each arm fixes its own `to` as a literal.
 */
export type WhereARequestWent =
  /**
   * ⚑ **The conversation that spawned the asker owes the answer.**
   *
   * ⛔ **It is the arm for a question that TRAVELLED and for one an asker addressed upward**, and
   * the two are deliberately not told apart: nothing in this app acts differently on them, and a
   * member no reader can use is a member every reader still has to think about
   * (`a-closed-vocabulary-guards-what-a-member-says`, one direction over).
   */
  | { readonly is: 'the-parent'; readonly to: 'the-parent' }
  /**
   * 🔴 **611 · a PERSON's, because the asker said so** (HO-088 §2.3) — Ada tasks Ali with *ask the
   * person*, and Ali's question goes there in one hop instead of four.
   *
   * ⛔ **Nothing refused anything, which is the whole of what this arm says and the arm below does
   * not.** ⚠️ **And it is where it GOES rather than a lock on who may answer it**: the parent still
   * can, and {@link admitAnswer} still admits it — see that door for why refusing would leave a
   * question with nobody able to settle it at all.
   */
  | { readonly is: 'the-person-the-asker-named'; readonly to: 'a-person' }
  /**
   * 🔴 **D-009 · F012 — an AGENT's, because the asker named it** — {@link RoutedRequest.parent} is
   * that agent, the one who may answer. ⚑ It answers or says it cannot; it cannot pass it on.
   */
  | { readonly is: 'the-agent-the-asker-named'; readonly to: 'an-agent' }
  /**
   * ⛔ **394 · a PERSON's, because the channel refused it** — {@link ChannelRefusal} names which
   * shape did, in the classifier's own words.
   *
   * ⚑ **Recorded rather than dropped**, which is criterion 10's instrument: *"has anything
   * permission-shaped ever arrived here?"* is {@link permissionShaped} over these rows.
   */
  | {
      readonly is: 'the-person-the-channel-left-it-with'
      readonly to: 'a-person'
      readonly because: ChannelRefusal
    }

/** One routed request, as derived. */
export interface RoutedRequest {
  /** The provider's own request id — what a card carries and what an answer names. */
  readonly requestId: string
  /**
   * ⛔ **The conversation that RAISED it — the ledger this row was folded from.**
   *
   * ⚠️ **Not on the event**, deliberately: a row that named the session it is stored in would be a
   * second spelling of one fact. {@link deriveRoutedRequests} takes the ledger's own name instead —
   * `PieceRow.owner`'s shape, one subject over.
   */
  readonly askedBy: string
  /**
   * The conversation that spawned {@link askedBy} — off the event, on both destinations.
   *
   * ⛔ **611 · NULL when the conversation that raised it has none** (HO-088 §3.2). ⚑ Two routings
   * produce one: `pass_question_up` from a top-level conversation carrying a child's question the
   * last hop, to the person — and (⚑ D-017 · R19) a provider's own request raised in a conversation
   * nobody spawned, which is a person's. ⚠️ **It is not *"we did not look"*** — the conversation's row
   * was read, and it names no parent.
   */
  readonly parent: string | null
  /**
   * 🔴 **Where it went, and — for the two ways it can be a person's — WHICH of them** (611,
   * HO-088 §2).
   *
   * ⛔ **It replaced `to` and `because`, and the sentence that stood here is FALSE since 611.** It
   * read: *"Null and `to: 'the-parent'` are one fact seen twice and cannot disagree: the event
   * carries `because` if and only if it carries `to: 'a-person'`, and this fold copies rather than
   * decides."* ⚠️ **The *only if* half still holds and the *if* half does not**: an asker may now
   * address its question to a person, which is `to: 'a-person'` with nothing refused. ⚑ A pair of
   * fields would have left every reader that used `because === null` to mean *the parent's* right
   * by habit and wrong by contract — see {@link WhereARequestWent} for why this is a union.
   */
  readonly went: WhereARequestWent
  /** Epoch ms of the routing — the `at` of the event. */
  readonly at: number
  readonly state: RequestState
  /** Epoch ms of the event that closed it, or null while it is open. */
  readonly endedAt: number | null
  /**
   * 🔴 **Epoch ms at which this question became a person's to answer, or null because it has
   * not** (398, criterion 11).
   *
   * ⛔ **A FIELD and not a state, which is the whole design.** Escalating does not end anything: the
   * parent may still answer, and {@link state} goes on saying whether anybody can. ⚠️ A reader that
   * needs *"can this still be answered"* asks {@link REQUEST_IS_OPEN}; one that needs *"is a person
   * on the hook for it"* asks this. ⛔ Collapsing them would make *"escalated"* imply *"the parent
   * lost its chance"*, which is false and is the exact shape `395` removed.
   *
   * ⚑ **It survives the ending.** A question that escalated and was then answered keeps this stamp,
   * because *a person was told* remains true about what happened; the pair `(state, escalatedAt)`
   * is what lets somebody ask how often an escalation was still needed by the time it fired.
   *
   * ## 🔴 612 · NOTHING WRITES IT ANY MORE, and it is read rather than deleted (HO-088 §3.1)
   *
   * ⛔ **The deadline that stamped it is gone.** `ESCALATION_WINDOW_MS`, the sweep that asked what
   * was due and the timer that armed the look all went with it; `RequestEscalatedEvent` has no
   * producer left in this app.
   *
   * Keep the stored escalation field readable for older ledger rows. Those questions were genuinely shown to a person; ignoring their stamps would remove still-answerable rows from `SessionStore.questionsAPersonMustAnswer` merely because automatic escalation was retired.
   *
   * ⚠️ **So `null` means two different things now and only one of them is new**: this question was
   * never escalated, which since `612` is true of every question this app will ever route. 🔴 **A
   * reader that needs *is a person on the hook* must NOT ask this field** — it asks
   * {@link aPersonsSince}, which reads the stamp for a historic row and
   * {@link WhereARequestWent} for a live one.
   *
   * ⚠️ **It was never set for anything that was ALREADY a person's** — {@link WhereARequestWent}'s
   * two `a-person` arms both — so no historic row carries a stamp it should not.
   *
   * ⛔ **611 · this said *"anything with a `because`"*** and that admitted the arm `HO-088` §2
   * created: a question an agent addressed to a person carries no refusal, so the old sentence
   * would have had a deadline declare that a parent had failed to answer a question it was never
   * asked.
   */
  readonly escalatedAt: number | null
}

/**
 * 🔴 **The words of one question, as its own request row recorded them** (396).
 *
 * ⛔ **A parent that was not live when its child asked received no message**, so the id on its own
 * names something it cannot answer: `answer_question` takes one entry per PART, and only the request
 * carries the part ids and what each offers. ⚑ Read back from the ledger rather than copied onto the
 * routing, so what a parent reads is what the card said.
 *
 * ⚠️ **Never carried for anything the parent may not answer.** `SessionStore.questionsRaisedIn`
 * reads the two question rows — `user_input_request` and `question_asked` — and the caller narrows
 * again to rows whose `because` is null, because a Codex grant of access arrives on the first of
 * those event types. ⛔ **This note said *"reads only `user_input_request`"* until `474`**, which
 * `437` had already made false: the second type is the whole reason {@link RaisedQuestion.piece}
 * can be here.
 */
/**
 * 🔴 **What put this question in front of somebody — and it is what decides whether a CARD
 * exists** (602).
 *
 * ## ⛔ Why it is a field and not a read of {@link RaisedQuestion.piece}
 *
 * ⚠️ **The two do not even agree today.** Only `question_asked` carries a piece, and not every one
 * does — a question passed up, or asked of another agent about no piece, names none — so
 * `piece !== null` answers *this app raised it* only in part — ⛔ **and it answers a DIFFERENT question**
 * (`widening-a-predicate-widens-every-question-its-field-answers`). {@link WorkInHand}'s own note
 * says the work edge is expected to widen; the day a provider-raised question carries one, a
 * surface reading `about` to decide whether to say *"open it to answer"* would start lying, and
 * nothing would go red.
 *
 * ⚑ **So this is read from the ROW'S OWN TYPE** — `question_asked` or `user_input_request` — in the
 * one statement that already selects both.
 *
 * ## 🔴 What each arm means for a person looking for a control
 *
 * | arm | the row | is there a card? |
 * |---|---|---|
 * | `this-app` | `question_asked`, written by `ask_question` | ⛔ **no, and not anywhere** — `transcript.ts` draws a NOTICE for it, so no `userInput` item exists in any window |
 * | `the-provider` | `user_input_request` | ⚑ **yes, in the asker's own transcript** — it may have been paged out, which is what `NoAnswerHere` `'not-in-this-window'` is about |
 * | `nothing-says` | no row this read could find answers to the request id | ⚠️ **unknown, and a surface may not guess** |
 */
export type HowItWasRaised =
  /**
   * ⛔ **This app raised it, through `ask_question`** — see {@link QuestionAskedEvent}. ⚑ No card was
   * ever drawn for it and none can be: the fold turns the row into a notice.
   */
  | 'this-app'
  /** ⚑ **A provider raised it**, and the asker's transcript drew a card from the same row. */
  | 'the-provider'
  /**
   * ⚠️ **The request is routed and this read found no row that raised it.** ⛔ A generation that
   * flipped under the read, or `394` §5's repeated id. ⚑ It is NOT *"no card"* — it is *this app
   * cannot say*, and a surface keeps the sentence it would have said anyway.
   */
  | 'nothing-says'

/** A file a to-do hands the person, kept as a resource of the piece the to-do is about. */
export interface ActionFile {
  readonly resource: string
  readonly name: string
}

/** What marks a question this app asked as a to-do for a person: the files handed with it. */
export interface ActionAsked {
  readonly files: readonly ActionFile[]
}

export interface RaisedQuestion {
  readonly move?: MoveOffer
  /** It asks a person to do something, with these files (`request_action`). */
  readonly action?: ActionAsked
  readonly prompt: string
  readonly questions: readonly UserInputQuestion[]
  /**
   * 🔴 **611 · the question this one is CARRYING, or null because it carries none** (HO-088 §3.2)
   * — see {@link QuestionAskedEvent.passedUpFrom}.
   *
   * ⛔ **It is the join `HO-088` §6's chain is built from**, and it is the one edge the escalation
   * walk cannot supply: that walk goes UP from a conversation to its parent, and a passed-up
   * question's relationship to the one it repeats points DOWN.
   */
  readonly passedUpFrom: string | null
  /**
   * 🔴 **611 · what the conversation that passed it on added, beside the words** (HO-088 §3.1) —
   * null because it added nothing, which is every question raised through `ask_question`.
   */
  readonly context: string | null
  /**
   * 🔴 **The piece this question is about, as the row that raised it named it — or `null` because
   * no row named any** (474, from `463` F4; a piece since D-016).
   *
   * ⛔ **Only `question_asked` carries one.** `430` measured that a provider-raised question
   * identifies its request and its parent and NOT the work, so `user_input_request` lands here as
   * `null` for ever and that is a property of the wire rather than of this read. ⚠️ A row written
   * before D-016 names a task under another key and lands here as `null` too.
   *
   * ⚠️ **It is the piece's id and not its label** — the id is what the asker's own ledger is keyed
   * by. ⛔ Turning it into something a person says out loud is {@link aboutTheWork}'s job, and it is
   * done in exactly one place so that a row a reader cannot resolve is reported rather than dropped.
   */
  readonly piece: string | null
  /**
   * 🔴 **Which of the two rows this is** (602) — see {@link HowItWasRaised}.
   *
   * ⛔ **Two arms and not three**: this value exists only because a row WAS found, so
   * `'nothing-says'` is unconstructable here and belongs to the caller that looked and missed.
   */
  readonly raisedBy: Exclude<HowItWasRaised, 'nothing-says'>
}

/**
 * 🔴 **What the asker OFFERED, when a person can press it somewhere no card exists** (619,
 * HO-093 §3.1) — or `null` because they cannot.
 *
 * ## ⛔ Why it is a value and not two fields on the row
 *
 * ⚠️ **The part id and the labels are one fact and a row may not carry half of it.** The labels are
 * what a person presses; the part is the key `respondUserInput` files the answer under, and an
 * answer filed under the wrong key is refused by the completeness rail as *no answer was given for
 * `answer`*. ⛔ Two nullable fields would make *labels with no part* constructable, which is a
 * button that cannot be sent — `a-value-beside-a-word-or-a-union-of-arms`.
 *
 * ⚑ **`options` is never empty here.** {@link whatTheAskerOffered} returns `null` rather than an
 * empty list, so a surface can draw this value without asking a second question about it.
 */
export interface OfferedAnswer {
  /**
   * ⛔ **The part the answer is keyed by** — `respondUserInput`'s `answers` map key, and the id
   * `RuntimeHost.raiseAQuestion` mints as `'answer'` for a question it composed itself.
   *
   * ⚠️ **Read off the part rather than spelled here**, because a question PASSED UP carries the
   * ORIGINAL asker's parts — `passQuestionUp` copies `raised.questions` verbatim — and those came
   * from a provider that names its own ids.
   */
  readonly part: string
  /** ⛔ **The labels the asker offered, in the order it offered them.** Never empty. */
  readonly options: readonly string[]
}

/**
 * 🔴 **One routed request as a PARENT may read it** (396) — the row, plus the words when they are
 * the parent's to read.
 *
 * ⛔ **Two fields and not one flattened payload**, because they answer to two different rules: the
 * row is derived from the ledger and is always present; the words are read from the asker's request
 * event and are present only for a request this parent may answer. ⚑ Flattening them would make
 * *"nothing carries a permission's text"* a property of how a payload happened to be built rather
 * than of a field that is `null`.
 */
export interface VisibleQuestion {
  readonly request: RoutedRequest
  /**
   * 🔴 **F033 · what a line calls the question's asker** — its agent's name beside the piece the
   * question was asked under (`RuntimeHost.nameByItsWorkUnder`): its root when it owns one, else its
   * own piece on that piece's chain — the name the question's own words gave it. ⛔ Not what it
   * holds now: an old question read *"from Arjun (the owner of W1.48 …)"*, a piece Arjun was given
   * days after asking. ⚠️ A question that names no piece names its asker as it is called now.
   */
  readonly askerCalled: string
  /**
   * ⛔ **The words the parent would have been sent — `null` for anything it may not answer, and for
   * anything whose request row this app can no longer read.**
   *
   * ⚠️ **`null` is TWO facts and the caller must not collapse them into one sentence.** A
   * permission-shaped routing has no words here because a parent may not have them; a question whose
   * asker's ledger was rebuilt has none because they are gone. ⚑ Neither is *"there is nothing to
   * answer"*, which is what the row's own `state` says.
   */
  readonly words: string | null
}

/**
 * 🔴 **A routed request that never travelled, with the reason it did not, in the type** (403).
 *
 * ⛔ **The narrowing is the whole of it.** {@link RoutedRequest.went} carries `because` on ONE of
 * its three arms; a reader that has ALREADY selected that arm would otherwise have to narrow it a
 * second time, or assert past it. ⚑ {@link permissionShaped} is the one selector, so this is what
 * it hands back and there is no second spelling of *"it did not travel"* anywhere.
 *
 * ⚠️ **611 · it narrows on the ARM and no longer on `because !== null`.** ⛔ Since `HO-088` §2 a
 * request can be a person's with nothing refused, so the old spelling would have admitted an
 * ADDRESSED question into the population criterion 10 counts — and the census that answers *"has
 * anything permission-shaped arrived?"* would have started saying yes about questions.
 *
 * ⚠️ **Every member of {@link ChannelRefusal}, not the one the briefs talk about.** A permission is
 * the plainest of five; a grant of access, a consent with nothing to answer, a shape this app has
 * not been taught and a secret only a person can type are the other four, and all five mean the
 * same thing about who may settle it. ⛔ A reader that admitted only `a-permission-decision` would
 * be a filter over a closed vocabulary that grew — see `403`'s response §1.
 */
export type RequestOnlyAPersonCanSettle = RoutedRequest & {
  readonly went: Extract<WhereARequestWent, { readonly is: 'the-person-the-channel-left-it-with' }>
}

/**
 * One hop of a chain: a conversation, the question it is waiting on, and who owes the answer.
 */
export interface EscalationLink {
  /** The conversation that is waiting. */
  readonly waiting: string
  /** The question it is waiting on an answer to. */
  readonly requestId: string
  /**
   * The conversation that owes the answer.
   *
   * ⛔ **611 · NULL is the PERSON**, which is {@link ChainHop.on}'s own convention one type down.
   * ⚑ Two rows produce it: a question its asker ADDRESSED to a person, which no parent was ever
   * going to answer, and a top-level conversation that passed one up. ⚠️ Before `611` the walk
   * always started at a parent, so the person could only ever be the hop AFTER the last link.
   */
  readonly on: string | null
}

/**
 * 🔴 **Who is waiting on whom, all the way up** (398, criterion 11) — HO-007's *"worker
 * waiting on PM, PM waiting on you"*, as data.
 */
export interface EscalationChain {
  /** The hops, asker first. Never empty: a chain of one is still a chain. */
  readonly links: readonly EscalationLink[]
  /**
   * ⛔ **Whether the walk ENDED, rather than being stopped.** True when the last conversation in the
   * chain has no open question of its own, so the next answer really is a person's. ⚠️ False means
   * the walk hit {@link CHAIN_HOP_LIMIT} — a refusal, not a conclusion — and a caller must not print
   * *"waiting on you"* after it.
   */
  readonly endsWithAPerson: boolean
}

/**
 * 🔴 **One question a person now owes an answer to, and why** (398, criterion 11).
 *
 * ⛔ **Separate fields and never one flattened line**, for {@link VisibleQuestion}'s reason: the row is
 * derived from the ledger, the chain is derived from the rows above it, and the sentence is the
 * chain rendered for a person. ⚑ A surface that wants to say it differently — a list, a tree, a
 * badge — has the parts; a surface that wants HO-007's own evidence line has {@link sentence}, and
 * the two cannot drift because one is computed from the other.
 */
export interface PersonsQuestion {
  /** The routed request itself — still `open`, because escalating ends nothing. */
  readonly request: RoutedRequest
  /**
   * A to-do the agent asked the person to do (`request_action`), rather than a question: what to do
   * and the files handed with it. The person answers it Done or Can't do it (`answerAction`).
   */
  readonly action?: { readonly text: string; readonly files: readonly ActionFile[] }
  /**
   * 🔴 **611 · when this became a PERSON's, whichever way it did** (HO-090 §4) — see
   * {@link aPersonsSince}.
   *
   * ⛔ **On the row rather than left to the window, because there are TWO clocks now.** ⚠️ A
   * question a deadline escalated became a person's at {@link RoutedRequest.escalatedAt}; one an
   * asker ADDRESSED to a person was a person's at {@link RoutedRequest.at}, which is the argument
   * `decisionsAwaitingAPerson` already makes for a refused routing. ⛔ A renderer reading
   * `escalatedAt` would draw *"no time recorded"* over every addressed row, and the queue's whole
   * ordering is *oldest-blocked first*.
   *
   * ⚑ **The SAME number the store sorted by**, so the oldest row and the row drawn as oldest are
   * one row.
   *
   * ⚠️ **NULL is carried rather than filled in**, for {@link PersonsQueueRow.blockedSinceIs}'
   * reason: *which instant this is* and *there is no instant* are answers to the same question,
   * and a row may not carry both. ⛔ The reader that builds this list admits only rows that HAVE
   * one, so a null here says that reader widened — which a surface draws as *no time recorded*
   * rather than as *just now*.
   */
  readonly aPersonsSince: number | null
  /** Who is waiting on whom, asker first. */
  readonly chain: EscalationChain
  /**
   * 🔴 **The same chain with its conversations NAMED, hop by hop** (401).
   *
   * ⛔ **The half `398`'s *"a surface that wants to say it differently has the parts"* was missing.**
   * {@link EscalationChain.links} carries session ids, and the one party that can name a
   * conversation is the one holding its ledger — a person's question is very often raised by a
   * child NO window is running, so a renderer resolving names itself would print `sess_<uuid>` for
   * exactly the conversations a person cannot recognise. ⚑ {@link sentence} is a join of this, so a
   * surface drawing hops and a surface printing the line cannot disagree.
   */
  readonly reading: ChainReading
  /**
   * The chain as HO-007 criterion 11 words it — *"worker waiting on PM, PM waiting on you"*.
   *
   * ⚠️ **Conversations are named the way a PERSON reads them** — by their AGENT's name since `734`
   * (R41), and by the basename of the working directory only where a conversation has no agent,
   * falling back to the id — and never the `sess_<uuid>` an agent is given. ⛔ That fallback is the
   * id and never a word like *"a conversation"*. ⚠️ **Two conversations of one identity read the
   * same name here**: the sentence is a join of names, and what tells them apart stays on the row
   * beside it — {@link chain}'s links carry each conversation, and {@link request} the asker's
   * (`732` F-6, closed on exactly that).
   */
  readonly sentence: string
  /**
   * 🔴 **The open work the asking conversation is holding — criterion 20's *which work*, as far as
   * the ledger goes** (434). See {@link WorkInHand}: this is the CONVERSATION's work — its root, when
   * it owns one, and its open pieces — and which of it the question is about is {@link about}'s.
   *
   * ⚠️ **Empty is a fact and not a gap.** A conversation that owns no root and holds no open piece
   * holds nothing, and that is the true answer to *which work* rather than a read that failed.
   *
   * 🔴 **474 · read beside {@link about}, which is the field that says whether this list is the
   * answer or the consolation.** ⛔ When the asker NAMED its work, {@link about} is the answer to
   * *which work* and this list is context; when nothing named any, this list is all there is. ⚠️ **It is not narrowed to the named piece** — a person moving a blocked conversation
   * wants to see everything it is holding, and dropping the rest would answer a question nobody
   * asked.
   */
  readonly work: readonly WorkInHand[]
  /**
   * 🔴 **Which work this question is about, and why that is the answer** (474, from `463` F4) — see
   * {@link AboutWork}, whose three arms are the whole of it.
   */
  readonly about: AboutWork
  /**
   * 🔴 **What raised this question, which is what decides whether there is a card to open** (602) —
   * see {@link HowItWasRaised}.
   *
   * ⛔ **Carried main-side for {@link reading}'s reason**: the row that raised a question lives in
   * the ASKER's ledger, and a renderer holds no ledger. ⚠️ `589` measured what its absence cost —
   * the queue told a person *"open it to answer"* about a question that has no card in any part of
   * any transcript, which is `106`'s shape said out loud.
   */
  readonly raisedBy: HowItWasRaised
  /**
   * 🔴 **What the asker offered, when a person can press it from the queue** (619, HO-093 §3.1) —
   * see {@link whatTheAskerOffered}, which is the whole of the decision.
   *
   * ## ⛔ Why it rides beside {@link raisedBy} rather than being derived from it
   *
   * ⚠️ **`raisedBy` answers *is there a card*; this answers *is there anything to press*.** They
   * agree on three populations and part company on the one that matters: a question this app
   * raised has no card AND may still have offered choices, which is exactly the row `589` measured
   * a person landing on with nothing to do. ⛔ A surface that inferred one from the other would be
   * back to `602`'s false instruction with the sign flipped.
   *
   * ⚑ **Carried main-side for {@link reading}'s reason.** The words live in the ASKER's ledger and
   * the window holds no ledger; `questionsForAPerson` already reads that row for `raisedBy` and
   * `about`, so this field costs no second statement.
   *
   * ⛔ **It says nothing about WHO may press it.** Whether this window holds the conversation is
   * the window's own fact — `PersonsQueueWorld.held` — and a field that folded it in would be a
   * question's answerability depending on which window asked.
   */
  readonly offered: OfferedAnswer | null
  /**
   * 🔴 **D-046 · the question as it was asked** — its words, what a conversation added when it
   * passed it up, and each part with its own wording, its choices and its rules — see
   * {@link AskedQuestion}.
   *
   * ⚑ **Carried main-side for {@link reading}'s reason, and off the SAME row** {@link raisedBy},
   * {@link about} and {@link offered} read, so it costs no second statement and cannot come from
   * another moment. ⚑ **For a question either origin raised**, so a window draws the question
   * whichever conversation asked it and whether or not it holds that conversation. ⛔ **For one the
   * provider raised (`'the-provider'`) it is for DRAWING only**: its card, in its asker's own
   * conversation, stays the one surface that answers it — {@link whatTheAskerOffered}'s second
   * refusal, for the same reason.
   *
   * ⚠️ **`null` where no row was found** — {@link raisedBy} `'nothing-says'` — the honest absence,
   * never an empty question.
   */
  readonly asked: AskedQuestion | null
}

/**
 * 🔴 **D-046 · a question as it was asked, for the person's list** — see
 * {@link PersonsQuestion.asked}. ⚑ Read off {@link RaisedQuestion}, whole: nothing here is cut,
 * renamed or filtered, for `questionText`'s reason — an answer is matched against the labels
 * as the asker wrote them.
 */
export interface AskedQuestion {
  readonly move?: MoveOffer
  /** ⚑ Its words, whole, as the row recorded them. */
  readonly prompt: string
  /**
   * ⚑ What the last conversation that passed it up added, beside the words — `null` where nothing
   * was. ⚠️ Only that hop's: a pass-up copies the words and the parts it carries, not what an earlier
   * hop added.
   */
  readonly context: string | null
  /** ⚑ It was passed up, carrying another conversation's question ({@link RaisedQuestion.passedUpFrom}). */
  readonly passedUp: boolean
  /**
   * ⚑ **Each part, in the order asked**: its `id` — the key an answer is filed under, as
   * `respondUserInput` takes it — its `header`, its own wording (`prompt`), its choices (`options`,
   * each a `label` and an optional `description`), and its rules: `multiSelect` takes several
   * answers; `allowOther`, or no options at all, takes a typed answer; `secret` hides the answer.
   */
  readonly parts: readonly UserInputQuestion[]
}

/**
 * 🔴 **The work the conversation that ASKED is holding, as a person refers to it** (434, HO-024
 * criterion 20).
 *
 * ⛔ **It is what that CONVERSATION is doing, and never what this question is ABOUT.** The two are
 * different claims and only the first is recorded FOR A QUESTION THE MODEL RAISED: `430` measured
 * that a routed provider question identifies its request and its parent and **not the work**, and
 * more than one piece can be open in one conversation at once. ⚠️ So a surface drawing one of those
 * must name it as the asker's work and say that which of it the question concerns is unrecorded —
 * HO-024 §5.3's renderable unknown rather than an omitted line.
 *
 * 🔴 **An `ask_question` question DOES name its piece, and `437` is where that became true** (a
 * task until D-016). {@link QuestionAskedEvent.piece} carries it, because the verb derived its
 * destination from that edge. ⛔ **So the renderable unknown is not unconditional**: the honest
 * reading is the row's — if it carries a piece, name it; if it does not, say so. ⚑ `474` carries it
 * to the person's queue and the transcript — see {@link AboutWork}, which is *"the honest reading is
 * the row's"* made into a vocabulary.
 *
 * ⚠️ **A root is the asker's work too** (D-016): its owner may ask about it, and the store's reading
 * of what an asker holds lists the root's label beside its open pieces.
 */
export interface WorkInHand {
  /** The label a person says out loud — *W1.2*. Off the give, never recomputed. */
  readonly label: string
}

/**
 * 🔴 **Which work a question is about, and why that is the answer** (474, from `463` F4).
 *
 * ## ⛔ Why a bare `WorkInHand | null` could not carry this
 *
 * ⚠️ **This vocabulary exists because a null had two readings**, and the app was already DRAWING
 * the wrong one of them: the person's queue said
 * *"which of it this is about is not recorded"* over every row, including the rows where `437` had
 * recorded exactly that. ⛔ **An edge this app never had and an edge this app threw away are not the
 * same claim about the ledger.**
 *
 * ## 🔴 A UNION rather than a value beside a word, and that is the stronger half
 *
 * ⛔ **A pair of `aboutWork` and `aboutWorkIs` would let *"the asker named it"* stand over no work, and *"nothing recorded it"* stand over a
 * placed piece — two states a reader would have to decide about, which is the defect this vocabulary
 * exists to remove. ⚑ **Here the work lives on the one arm that has any**, so the disagreeing pair
 * is unconstructable rather than merely unwritten, and a surface switching on the `is` word is
 * handed the work already narrowed.
 *
 * ## ⚠️ Three members, and the middle one is the reason there are not two
 *
 * ⛔ **A row can NAME work this read cannot place.** `ask_question` checks the piece against what
 * the asker holds before it writes, so the pair is consistent at the moment it is written — but a
 * ledger is read back long after: `importBundle` takes a conversation's events without its whole
 * history, `derivePieces` skips a row it cannot parse, and a generation rebuild moves what
 * `SessionStore.questionsRaisedIn` can see. ⛔ **Folding that into *nothing
 * recorded it* would be this app reporting its own short read as a fact about the ledger**, which is
 * `447`'s defect and HO-024 §5.3's rule.
 *
 * ## ⚠️ What a skipped question row lands on, said rather than discovered
 *
 * ⛔ **`SessionStore.questionsRaisedIn` SKIPS a row whose payload it cannot read**, so a request
 * whose question row is unreadable reaches this fold with no named piece and lands on
 * `nothing-recorded-it` beside a provider's question. ⚑ **That is honest rather than a
 * conflation**: in both cases nothing this app can read names the work, and the difference between
 * *"the provider does not record it"* and *"a row would not parse"* is a fact about the READ —
 * which {@link LedgerWalk.rowsUnread} already carries beside the row and which no surface may infer
 * from this word.
 */
export type AboutWork =
  /**
   * ⛔ **The asker named its work and this read placed it** — {@link QuestionAskedEvent.piece},
   * resolved against what the asker holds to the label a person says out loud.
   */
  | { readonly is: 'the-asker-named-it'; readonly work: WorkInHand }
  /**
   * 🔴 **A row named work and nothing in the asker's ledger answers to it.** ⛔ The edge exists and
   * this read could not follow it; see the docblock above for the three ways that happens. ⚠️ **It
   * carries no work, and that is the point** — a surface may say the edge is there and unfollowable
   * without being handed something to draw.
   */
  | { readonly is: 'named-work-nothing-answers-to' }
  /**
   * ⛔ **Nothing this app can read names the work this question is about.** ⚑ The ordinary member:
   * `430` measured that a provider-raised question identifies its request and its parent and not the
   * work, and a permission carries no piece at all.
   */
  | { readonly is: 'nothing-recorded-it' }

/** ⛔ **The word alone**, for a table that has to be exhaustive over it. */
export type AboutWorkIs = AboutWork['is']

/**
 * 🔴 **One hop of the chain as a person reads it: who is waiting, and who owes the answer** (401).
 *
 * ⛔ **The names are resolved, and that is the whole reason this crosses the wire.** {@link
 * EscalationLink} carries `sess_<uuid>`s, and the only party that can turn one into a word is the
 * one holding the ledger — {@link RoutedRequest.askedBy} names a conversation a WINDOW may not be
 * running, so a renderer given links alone can only print ids for exactly the conversations a
 * person is least able to recognise.
 */
export interface ChainHop {
  /** The conversation that is waiting, named — its agent's name since `734` (R41). */
  readonly waiting: string
  /**
   * ⛔ **Who owes the answer — and `null` is YOU**, the one answerer that is not a conversation.
   *
   * ⚠️ **Null rather than the word**, for {@link RoutedRequest.escalatedAt}'s reason: a surface that
   * had to compare a name against the string `'you'` would say *you* about an agent — or, with no
   * agent, a working folder — that happened to be called that.
   */
  readonly on: string | null
}

/**
 * 🔴 **The chain, named and hop by hop** (401) — the shape {@link chainSentence} is a join of.
 *
 * ⛔ **One derivation, two renderings.** `398` shipped the sentence and said a surface wanting to
 * *"say it differently — a list, a tree, a badge"* has {@link EscalationChain.links}; `401` measured
 * that it has the links and no NAMES, so the alternative rendering was ids. This is the missing
 * half, and the sentence is now built out of it so the two cannot disagree about a chain.
 */
export interface ChainReading {
  /**
   * ⛔ **Asker first, and the last hop is the one a person owes** — so a chain of one is two hops
   * (*worker waiting on pm*, *pm waiting on you*) and reads as a chain rather than as a stub.
   */
  readonly hops: readonly ChainHop[]
  /**
   * ⛔ **The walk was STOPPED rather than ended, so nothing above the last hop is known** — a cycle
   * or {@link CHAIN_HOP_LIMIT}. ⚠️ True and `hops` never ends at `null`: a surface must not name a
   * person as the answerer on the strength of a walk that never reached one.
   */
  readonly unfollowable: boolean
}

/**
 * 🔴 **One request only a person can settle, as a person reads it** (403, from `402` F1 and
 * HO-018 §5 item 3).
 *
 * ⛔ **A sibling of {@link PersonsQuestion} and deliberately NOT a widening of it.** The two carry
 * different guarantees and the difference is the reason there are two readers:
 *
 *  - {@link PersonsQuestion} is *a question that TRAVELLED to a parent and went unanswered past its
 *    deadline*. Its chain is a walk, its age is `escalatedAt`, and a parent may still answer it.
 *  - **This** is *a request that never travelled at all*. Its chain is one hop, its age is the
 *    routing's own `at`, and no parent may ever answer it — {@link RuntimeHost.answerQuestion}
 *    refuses one BY NAME.
 *
 * ⚠️ **Merging them would have widened `questionsForAPerson`, which carries criterion 10's
 * negative.** A predicate that answers several questions widens all of them at once; the strict
 * reader stays strict and this is the named second one.
 */
export interface PersonsDecision {
  /** The routed request itself — open, and never travelled. */
  readonly request: RequestOnlyAPersonCanSettle
  /**
   * ⛔ **One hop, ending at you** — see {@link decisionReading} for why there is never a second.
   */
  readonly reading: ChainReading
  /** The reading joined: *"worker waiting on you"*, always, whatever the depth. */
  readonly sentence: string
  /**
   * ⛔ **What kind of thing it is, in words, from {@link CHANNEL_REFUSAL_SENTENCES}** — *"a command
   * or file approval, which is a person's to give"*.
   *
   * ⚑ **Rendered main-side, and that is a decision about the renderer's weight rather than a
   * preference.** The sentences are a value in `@brobot2/runtime`; a renderer importing them to
   * turn `because` into prose would pull that package into the window bundle for five strings.
   * ⚠️ **The map's own docblock says these are for *a person or a test* and never for a model** —
   * a model reads `because` itself, which is the word `answer_question` refuses with.
   */
  readonly says: string
  /**
   * 🔴 **The open work the asking conversation is holding** (434) — {@link PersonsQuestion.work}'s
   * twin, carried on both populations because criterion 20 asks *about which work* of anything
   * waiting on a person and does not care which reader found it.
   */
  readonly work: readonly WorkInHand[]
  /**
   * The request as its card draws it, read from the asking conversation's record — present only
   * while that conversation runs with no window holding it, so a person can answer it from the
   * queue without opening it.
   */
  readonly card?: CardNobodyHolds
}

/** A request a provider raised and a card answers: a permission, or its own question. */
export type ProviderRequestEvent = Extract<
  TranscriptEvent,
  { type: 'permission_request' | 'user_input_request' }
>

/** A request in a conversation no window holds, with what its card's words depend on. */
export interface CardNobodyHolds {
  readonly asked: ProviderRequestEvent
  readonly provider: Provider
  /** The identity the conversation runs as. */
  readonly profileId: string
}

/** One of {@link LEDGER_WALK_KINDS}. */
export type LedgerWalkKind = (typeof LEDGER_WALK_KINDS)[number]

/**
 * 🔴 **One walk over ledgers: what it covered, how many it read, how many it could not, and what it
 * found** (453).
 *
 * ⛔ **The three counts are computed from the QUERY and never from {@link LedgerWalk.rows}.**
 * {@link ledgers} is the candidate set's own size — the number of conversations the walk opened —
 * so `ledgers: 47, rows: 0` is *forty-seven ledgers say nothing is waiting* and `ledgers: 0` with
 * `LedgerWalkKind` `every-conversation-that-routed` is *nothing in this app has ever routed a
 * request*. ⚠️ Those are different facts and `rows.length` is `0` for both of them, and for
 * `no-ledger` as well.
 *
 * ⚑ **Shared by the store and the host rather than translated between them**, for
 * `MessageRefusalDetail.reach`'s reason exactly (`448`): the party that WALKED is the only one that
 * can say what it walked, and a second derivation one layer up could answer a number the walk never
 * used.
 */
export interface LedgerWalk<Row> {
  /** What the walk found, in the reader's own order. */
  readonly rows: readonly Row[]
  /** Which candidate set it started from — see {@link LEDGER_WALK_KINDS}. */
  readonly walk: LedgerWalkKind
  /**
   * ⛔ **How many ledgers the walk OPENED**, from the candidate query and never from the rows.
   * ⚑ Zero is a fact about the workspace on either non-`no-ledger` word, and about this app on it.
   */
  readonly ledgers: number
  /**
   * 🔴 **How many ledger ROWS the walk could not read, and therefore folded nothing from** — the
   * partial load, counted.
   *
   * ## ⛔ It was already happening and nothing above could see it
   *
   * ⚠️ **`toPersistedEvents` has skipped an unparseable row since `150`** — *"a transcript with a
   * hole is honest, a transcript with a fabricated entry is not"* — and that skip is silent to
   * every reader above it. ⛔ `150` ruled the user-facing mark BACKLOGGED on the transcript, for a
   * stated reason: it *"would need a field, a surface, and wording honest about a count we can
   * state and a cause we cannot"*. ⚑ **A queue is where that bill comes due**: a digest may be
   * scoped and a list of obligations may not, so a row this app dropped is a row a person is not
   * being told they owe.
   *
   * ⛔ **`DigestGap`'s rule — *a COUNT of the rows it is unable to speak for*** — with the cause
   * still unstated, because the cause genuinely is not known. ⚠️ **Not a count of ROWS FOUND**: an
   * unread ledger row usually folds into no queue row at all, so this number and
   * {@link LedgerWalk.rows} do not add up to anything and must not be drawn as if they did.
   */
  readonly rowsUnread: number
  /**
   * 🔴 **D-017 · R8 — how many conversations' records the walk skipped WHOLE**, because a fold over
   * one threw — present only when there were some. ⛔ Its own count, never added to
   * {@link rowsUnread}: a whole record is not one row.
   */
  readonly ledgersSkipped?: number
}

/**
 * 🔴 **Where a request this conversation raised was sent, and why** (394, HO-007 S4 + criterion 10).
 *
 * ## ⛔ It is written for BOTH destinations, and that is the point of it
 *
 * ⚠️ **The obvious implementation of criterion 10 is a filter that drops anything
 * permission-shaped at the channel boundary — and a filter justified by *"we never see permissions
 * here"* blinds the instrument that would show you one.** Once the gate is in, the evidence that
 * motivated it can no longer arrive, and the census reports zero forever, honestly, while being
 * wrong.
 *
 * ⚑ **So nothing is dropped and every arrival is recorded.** A request the channel admitted
 * carries `to: 'the-parent'`; one it refused carries `to: 'a-person'` and a {@link because} naming
 * which shape it was. ⚠️ **611 · and a third row exists now** — `to: 'a-person'` with no
 * `because`, which is an asker that ADDRESSED its question to the person (HO-088 §2). *"Has anything permission-shaped EVER arrived here?"* is then a fold over this
 * event type — see `questionsRoutedTo` and `deriveQuestions` — rather than a question the gate has
 * made unaskable.
 *
 * ## ⚠️ Only where there is a channel does anything travel
 *
 * ⛔ **A session nobody spawned has nowhere for a question to travel to**, so its permission cards
 * are not *"refused entry to the channel"* — there is no channel. ⚑ **D-017 · R19 — its requests are
 * a PERSON's, and since D-017 a row says so**: `to: 'a-person'` with no {@link parent}, and a
 * {@link because} only for a shape that could never have travelled. ⛔ Without it no host read could
 * see a card in a conversation no window holds — one a delivery started — and *Waiting on you* said
 * nothing needed the person while it waited on them.
 *
 * ## ⛔ In the ASKER's ledger, naming the parent as data
 *
 * ⚠️ **The same shape as {@link WorkGivenEvent}, and for its reason.** The row lives where the
 * thing it describes happened — the conversation that raised the request — and the other party is a
 * field, never a second row. Two halves of one fact are two things that can disagree.
 */
export interface RequestRoutedEvent {
  type: 'request_routed'
  /**
   * ⛔ **The request's own id** — `permission_request.id` or `user_input_request.id`, whichever this
   * row is about. ⚠️ The provider minted it; nothing here invents one, so a reader can join this row
   * to the card it describes and to the {@link UserDecisionEvent} that ends it.
   */
  requestId: string
  /**
   * 🔴 **Who owes the answer — and since `611` it is a DECLARATION as often as a verdict**
   * (HO-088 §2).
   *
   * ⚠️ **This read: *"`the-parent` is the only value that means the question travelled; `a-person`
   * means the app left it exactly where it would have been with no channel at all."*** ⛔ The
   * second clause is false since `611`: an agent may address its question to the person through
   * `ask_question`, and the app then routes what it declared — nothing was left anywhere and no
   * channel refused anything.
   *
   * ⚑ **It is the only field that says where a request went**, which is why {@link whereItWent}
   * reads it rather than inferring the destination from {@link because}'s absence.
   *
   * 🔴 **D-009 · F012 — and `an-agent`: an agent the asker named, by its conversation id**, which
   * {@link parent} then carries — that field is who may answer, and for this arm it is the agent
   * named, not the asker's parent.
   */
  to: 'the-parent' | 'a-person' | 'an-agent'
  /**
   * 🔴 **Which shape stopped it — present only if {@link to} is `a-person`, and NOT for every such
   * row.**
   *
   * ⛔ **The *if and only if* held until `611` and one half of it is gone.** ⚠️ A `because` still
   * implies `to: 'a-person'`; a `to: 'a-person'` no longer implies a `because`, because
   * {@link WhereARequestWent}'s middle arm is a question an asker ADDRESSED there. ⚑ Every reader
   * that spelled *the parent's* as `because === undefined` had to be re-decided — see that union's
   * note, and `611`'s response for the census.
   *
   * ⛔ **One of `CHANNEL_REFUSALS`**, imported rather than restated so this row cannot describe a
   * classification the classifier does not make. ⚑ This is the field the instrument counts.
   */
  because?: ChannelRefusal
  /**
   * The conversation that spawned this one — **on both arms**.
   *
   * ⚠️ **Present even when the request went to a person**, deliberately: it is what makes the parent
   * able to ask about the request at all, and therefore what makes the refusal it meets at
   * `answer_question` a REACHABLE rail rather than a sentence nothing can trip. ⛔ A rail nothing
   * reaches passes vacuously.
   *
   * ⛔ **611 · ABSENT when the conversation that raised it has none** (HO-088 §3.2). ⚑ Two writers
   * produce it — `pass_question_up` from a top-level conversation, which is the last hop of
   * `HO-088` §6's chain and the one BroBot itself takes, and (⚑ D-017 · R19) the routing of a
   * provider's own request in a conversation nobody spawned — and `661`'s re-route copies it, absent
   * when the routing it repeats had none. ⚠️ **The argument above survives rather
   * than being relaxed**: there is no parent for the rail to be reachable BY, so the row omits the
   * field instead of naming a conversation that could then be handed somebody else's question.
   */
  parent?: string
}

/**
 * 🔴 **A worker asked the conversation that gave it work for a decision** (437, criterion 29).
 *
 * ## ⛔ Why this is not a `user_input_request`, which is the row it stands beside
 *
 * ⚠️ **`user_input_request` is the PROVIDER's**, and this app may not author one. The two
 * app-authored doors — `RuntimeHost.recordOurs` and `publishOurs` — take a closed union that has
 * never contained a provider event type, and widening it so the app could write one would make
 * *"the model asked"* and *"the app asked"* one sentence. ⛔ **`437` needed the same three values a
 * question is made of and wrote its own row rather than borrowing that one.**
 *
 * ⚑ **`SessionStore.questionsRaisedIn` reads BOTH**, which is what lets `list_questions` render the
 * words for either origin with one renderer ({@link RuntimeHost.questionsWaitingOn} →
 * `questionText`). ⚠️ The reader does not care which produced it; the LEDGER still says, because
 * the two rows have different types.
 *
 * ## 🔴 It carries the piece, and it is the one question row that does
 *
 * ⛔ **A provider-raised question names no piece** — `derivePieces` says so in as many words
 * (*"which of the pieces it holds a MODEL-raised question was about is not a fact the ledger
 * contains"*),
 * which is why `PieceRow.questionLostAtRestart` has to be true of every open piece rather than of
 * one. ⚑ **This row does contain it**, because the verb that writes it took a piece and derived its
 * destination from that edge — so a question raised through `ask_question` is joinable to the work
 * it is about and a provider-raised one is not. ⚠️ **That asymmetry is real and it is not repaired
 * here**, and `questions.ts`' `WorkInHand` note says so.
 *
 * ⚑ **474 · the asymmetry is SAID rather than flattened** (`463` F4). `questions.ts`' `AboutWork`
 * gives the two origins two different sentences, so a reader can tell *this app never recorded it*
 * from *the asker named it* — and from *the asker named it and this read could not follow it*,
 * which is the third state a repair has to leave room for.
 */
export interface QuestionAskedEvent {
  move?: MoveOffer
  /** It asks a person to do something rather than answer (`request_action`), with these files. */
  action?: ActionAsked
  type: 'question_asked'
  /**
   * ⛔ **The app's own request id, and the ONLY id in this app that a provider did not mint.**
   *
   * ⚠️ It is spelled `req_<uuid>` so it cannot collide with either provider's numbering, and it is
   * the id {@link RequestRoutedEvent.requestId} then carries, the id a parent quotes to
   * `answer_question`, and the id {@link UserDecisionEvent.requestId} closes. ⚑ One value, four
   * rows, so the join is the same one a provider-raised question already supports.
   */
  requestId: string
  /**
   * 🔴 **The piece this question is about** — one the asker holds, named or inferred and already
   * checked against what it holds by the time this is written (D-016; a task id until then, under
   * another key nothing reads). ⚑ The root counts as held work.
   *
   * ⛔ **611 · OPTIONAL, and the absence has two producers.** ⚠️ A question PASSED UP names no piece
   * of the passer's (HO-088 §3.2): the work is the ORIGINAL asker's, and naming it here would be a
   * reference this ledger's own pieces can never resolve — `AboutWork`'s *"named work
   * nothing answers to"* arm, manufactured by this app rather than met; ⚑ {@link passedUpFrom} is the
   * join that does hold. ⚑ And a question to another AGENT may name none: a question about no piece
   * holds no piece (it is not in `openQuestionsByWork`).
   */
  piece?: string
  /** ⚑ **D-016 · that piece's label**, so a surface names it without walking the tree — present only beside {@link piece}. */
  label?: string
  /**
   * 🔴 **611 · the question this one is CARRYING, when it was passed up** (HO-088 §3.2) — the
   * request id of the row whose words {@link prompt} repeats.
   *
   * ## ⛔ It is what makes *the original words* checkable rather than promised
   *
   * ⚠️ **`pass_question_up` advertises no question TEXT.** The words are read out of the original
   * asker's own ledger and written here verbatim, so *"a question reworded at every hop arrives as
   * something nobody asked"* is prevented by there being no field to reword it in — the same
   * device `REPLY_ADDRESSING_KEYS` is for an addressee. ⚑ This field is what lets a reader check
   * the claim against the row it was copied from.
   *
   * ⚠️ **Absent on a question an agent raised itself**, which is every row `393` through `608`
   * wrote and every `ask_question` call.
   */
  passedUpFrom?: string
  /**
   * 🔴 **611 · what the conversation that passed it on added** (HO-088 §3.1) — and it is a separate
   * field for the same reason it is a separate paragraph in {@link questionText}.
   *
   * ⛔ **The PO: *"The parent MAY add context; it may NOT replace the question."*** ⚠️ Merging it
   * into {@link prompt} would make the two indistinguishable one hop later, and a reader three hops
   * down could not tell the asker's words from three parents' commentary. ⚑ Absent is *it added
   * nothing*, which is the ordinary case.
   */
  context?: string
  /**
   * The worker's own words, verbatim. Nothing here shortens or rewrites them.
   *
   * ⛔ **611 · on a passed-up row these are the ORIGINAL asker's words**, copied from that row,
   * with the passer's own context BESIDE them rather than instead of them — see
   * {@link RuntimeHost.passQuestionUp} for where the two are joined and why the join is there and
   * not in the model's hands.
   */
  prompt: string
  /**
   * ⛔ **The parts, in the shape `answer_question` already takes.** ⚑ `437` renders exactly one,
   * because the verb asks one question — but the field is a list rather than a string so the reader
   * that renders a provider's several and this one's single are the SAME function.
   */
  questions: readonly UserInputQuestion[]
}

/**
 * 🔴 **A request this conversation raised was still open when the app that was running it stopped**
 * (396, HO-007 S6) — the ending `394` measured and could not write.
 *
 * ## ⛔ The gap it closes: the ledger cannot tell a live wait from a dead one
 *
 * `deriveRoutedRequests`' own note says it, and `394` shipped with it: **`open` means *nothing has
 * ended it in the ledger*, not *somebody is still waiting*.** ⚠️ A provider's pending request lives
 * in the provider's process, and a crash takes it with it while writing nothing — so the bytes of an
 * app that is running and holding a request are the bytes of an app that died holding one. ⛔ **No
 * function over the ledger can separate them**, which is why the repair is a WRITE.
 *
 * ## ⚑ Written by ONE writer, at the ONE moment the difference is knowable
 *
 * `SessionStore.settleStrandedRequests`, from `RuntimeHost`'s constructor, beside
 * `settleStrandedMessages` and `settleOrphanRuns` and for their reason: **at construction nothing is
 * running**, so a request this app still reads as open belongs to a run that ended without saying
 * so. ⛔ **Never a timer.** *A timeout decides that silence means failure after N seconds — a guess
 * dressed as a fact* (`396` §4); this decides nothing, it records what a launch can see.
 *
 * ⚠️ **`running` is honoured**, so a second host in one process never writes this for a request the
 * first is still holding — `settleOrphanRuns`' rule, third venue.
 *
 * ## ⛔ Why it is not a `user_decision` and not a `request_resolved`
 *
 * ⚠️ **Neither would be true.** `user_decision` says somebody settled it; nobody did.
 * `request_resolved` is defined in `packages/runtime/src/events.ts` as *"resolved or cleared by the
 * PROVIDER, not by this app"*, and writing it here would make this app claim a provider act. ⚑ The
 * row this app may write is the one that says what this app knows: **it stopped, and this was still
 * waiting.**
 */
export interface RequestStrandedEvent {
  type: 'request_stranded'
  /**
   * ⛔ **The request's own id** — the same id {@link RequestRoutedEvent.requestId} carries, so the
   * fold closes the row it opened. ⚠️ Never the provider's own spelling of a resolution: this event
   * exists precisely because the provider never got to send one.
   */
  requestId: string
}

/**
 * 🔴 **A request this conversation raised was thrown away when its work was stopped** (397,
 * HO-007 S6) — the residue `396` §7 reported and did not fix.
 *
 * ## ⛔ The gap it closes: an interruption settles every card and writes nothing
 *
 * ⚠️ **Both adapters call `settleRequests()` inside `interrupt()`**, on the line after
 * `requestInterrupt()`, and `RequestBroker.settleAll` safe-rejects every pending request: a
 * permission resolves `{outcome:'deny'}` and a question `{kind:'reject'}`. ⛔ **No `user_decision`,
 * no `request_resolved`, no row of any kind** — so the derived request went on reading `open` while
 * the provider had already been told *no* on somebody's behalf.
 *
 * ⚑ **`396` did not leave it stale, it left it MISLABELLED.** A row still open at the next launch is
 * closed `stranded` by `SessionStore.settleStrandedRequests` — *the app had stopped* — and the app
 * had not: somebody pressed Stop and the app kept running.
 *
 * ## ⚠️ Why it is not any row that already exists
 *
 * ⛔ **Not `user_decision`.** That says somebody DECIDED. The safe-reject is the socket being given
 * an answer because it needs one; recording it as a rejection is HO-005 Q2 written into the ledger —
 * *"an agent answering another agent's permission prompt is the kill switch with extra steps"*.
 *
 * ⛔ **Not `request_resolved`.** `packages/runtime/src/events.ts` defines it as *"resolved or cleared
 * by the PROVIDER, not by this app"*, and this is the app.
 *
 * ⛔ **Not {@link WorkInterruptedEvent} folded twice.** That row was written by `end_agent` as
 * well (until D-017), whose teardown stopped the conversation — and a question that died with its
 * process is `abandoned`, because that is the fact a reader must act on. ⚑ Two acts, two rows: *the
 * work was asked to stop* and *this request went with it* are not the same statement.
 *
 * ## 🔴 One writer, and it is the one path to the provider
 *
 * `RuntimeHost.askTheWorkToStop` — the only caller of `SessionHandle.interrupt()` — writes
 * {@link WorkInterruptedEvent} and then one of these per still-open request, in the same synchronous
 * stretch and **before the provider is asked**. ⛔ Codex's `interrupt()` awaits the answer to its
 * own `turn/interrupt` request, unbounded (709), so a row written afterwards would never exist on
 * that provider.
 *
 * ⚠️ **One per REQUEST and not one for the conversation.** `settleAll` kills them one at a time and
 * the fold closes them one at a time; a single summary row would record an act the ledger could then
 * not enumerate.
 *
 * ⚑ **What happened and WHO did it are neighbouring rows, never one word.** *Folding them into one
 * vocabulary is how "it was stopped" comes to imply "a person did it"* (`how-work-stopped.ts`), and
 * that false sentence is what `395` spent a dispatch removing.
 */
export interface RequestInterruptedEvent {
  type: 'request_interrupted'
  /**
   * ⛔ **The request's own id** — the same id {@link RequestRoutedEvent.requestId} carries, so the
   * fold closes the row it opened. ⚠️ Never the provider's spelling of a resolution: this event
   * exists because this app ended the request and the provider was merely told.
   */
  requestId: string
}

/**
 * 🔴 **D-009 · F012 — the asker withdrew a question it asked** (`withdraw_question`), written into
 * the ASKER's ledger beside the `request_routed` it closes. ⚑ The fold's `withdrawn`, which is what
 * a provider withdrawing its own request already reads — the asker's side ended it, either way.
 */
export interface QuestionWithdrawnEvent {
  type: 'question_withdrawn'
  /** ⛔ {@link RequestRoutedEvent.requestId}'s spelling, so the fold closes the row it opened. */
  requestId: string
}

/**
 * A question this conversation passed up ended because the piece the question it carried was about
 * ended — handed back, taken back or closed — as that question did. ⚑ Written by this app into the
 * ledger of the conversation that passed it up.
 */
export interface QuestionEndedWithItsPieceEvent {
  type: 'question_ended_with_its_piece'
  /** ⛔ {@link RequestRoutedEvent.requestId}'s spelling, so the fold closes the row it opened. */
  requestId: string
  /** How the piece ended, as the question it carried ended. */
  ending: 'work-replied' | 'work-withdrawn' | 'work-closed'
}

/**
 * 🔴 **D-009 · F012 — the conversation a question was addressed to ended without answering it**
 * (ruling 5: *"if the recipient's conversation ends without answering, the asker is told and the
 * question closes"*), written into the ASKER's ledger. ⛔ A quit is not an ending — a conversation
 * a quit leaves open still owes its answer — so only a real ending writes one.
 */
export interface QuestionRecipientEndedEvent {
  type: 'question_recipient_ended'
  /** ⛔ {@link RequestRoutedEvent.requestId}'s spelling, so the fold closes the row it opened. */
  requestId: string
  /** The conversation that ended — the one the routing named as who answers. */
  recipient: string
}

/**
 * 🔴 **A question nobody answered in time is now a person's to answer** (398, HO-007 S4 +
 * criterion 11).
 *
 * ⚠️ **`591` read that headline against HO-082 §2 and kept it, with this clause** (relay 1): *in
 * time* is the ESCALATION window and nothing else, and it decides who is TOLD — never who may
 * answer. ⛔ **No elapsed time ends a question**, so a reader who stops at the line above must not
 * take it to mean the parent's chance has passed; the section directly below has said the opposite
 * since `398` and is now the whole of the rule rather than most of it.
 *
 * ## ⛔ It is not an ending, and that is the whole shape of it
 *
 * ⚠️ **HO-007 S4: *"Unanswered past a timeout, it escalates to the human."*** ⛔ **Escalating does
 * not un-ask the original.** The parent may still answer, the card is still open on the child, and
 * the request is still `open` — so this writes no state and closes nothing. ⚑ *Has this ended?* and
 * *has this been escalated?* are two questions, and `395`'s ruling is that folding two questions into
 * one vocabulary is how a word comes to imply something nobody said. The first is
 * {@link RoutedRequest.state}; the second is {@link RoutedRequest.escalatedAt}.
 *
 * ⚠️ **So the race this creates is settled by a door that already exists.** Whichever answer lands
 * first writes {@link UserDecisionEvent} and closes the row; the second meets `admitAnswer`'s
 * `question-has-already-ended` carrying the state it ended in. ⛔ There is no window in which two
 * answers are both taken, because there is no second door — a person answers the card on the child
 * through `respondUserInput` and a parent answers through `answer_question`, and both write that one
 * row.
 *
 * ## 🔴 Knowledge escalates; authority does not
 *
 * ⛔ **A permission can never travel this path**, and it is structural rather than checked: only a
 * request that was routed `to: 'the-parent'` has a parent to be unanswered BY, and a
 * permission-shaped one never left the child — `394` recorded it on
 * {@link WhereARequestWent}'s refused arm precisely so the refusal stays visible. ⚑ Escalating one would be this app inventing a
 * hand-off it had already refused (HO-005 §2 Q2).
 *
 * ## 🔴 612 · NOTHING WRITES THIS ROW ANY MORE (HO-088 §3.1)
 *
 * ⛔ **The deadline that produced it is gone**, and with it `ESCALATION_WINDOW_MS`, the sweep that
 * asked what was due and the timer that armed the look. ⚑ **The TYPE stays because the LEDGER
 * does**: rows written before `612` are real, each one a question a person really was told about,
 * and a reader that could not parse them would delete answerable work from a person's queue.
 * ⚠️ `142`'s rule — nothing is deleted — reaching a wire contract.
 *
 * ⚑ **It was 30,000 ms from {@link RequestRoutedEvent}'s own recorded time** — `353`'s
 * measurement, filed in `00-slice4-measurements.md` §2, at 1.80× the largest turn in its sample
 * and reported there as a floor rather than a tail study.
 *
 * ⚠️ **It was the last deadline in the app, and it survived one withdrawal before this one.** `398`
 * shipped a second — a silence window over a working child — and HO-018 §2.2 took it on the ground
 * that *"an idle timeout on a WORKING child is the guess"*; this one survived because it was not
 * measuring silence. 🔴 **`HO-088` §3.1 took it on a different ground and a stronger one**: the row
 * says a PARENT did not answer, and the app never observed that — it observed a window passing.
 *
 * > ⚑ **A parent answers the question, or passes it up. Both are deliberate. Neither is a
 * > timeout.**
 *
 * ⛔ **What takes its place is `611`'s `pass_question_up`** (HO-088 §3.2) — which writes a
 * {@link RequestRoutedEvent} and a {@link QuestionAskedEvent} in the passer's own ledger, not one
 * of these.
 */
export interface RequestEscalatedEvent {
  type: 'request_escalated'
  /** The request's own id — the same one {@link RequestRoutedEvent.requestId} opened the row with. */
  requestId: string
}

/**
 * 🔴 **Routed requests, DERIVED — what a conversation asked, where it went, and whether anybody has
 * answered** (394, HO-007 S4 + criteria 9, 10 and 14).
 *
 * ## ⛔ Criterion 2's property, a second time
 *
 * There is no question table and no question column. `RequestRoutedEvent` is a row in the ledger
 * like any other, and this module **imports TYPES and nothing else** — it cannot reach a database, a
 * host, a clock or a filesystem, so *"the rows are a function of the ledger"* is checked by the
 * compiler rather than by a test that has to remember to drop something. Same shape and same reason
 * as `tasks.ts`. ⚠️ **Stated without a count**, `396`'s correction: the sentence said *"two types"*
 * and a third would have made it quietly false while still reading as though something checked it.
 *
 * ## 🔴 It folds BOTH destinations, which is what makes it the instrument
 *
 * ⚠️ **Criterion 10 is a negative — *permissions cannot enter the question channel* — and a
 * negative asserted by a filter is worthless**: once anything permission-shaped is dropped at the
 * boundary, the census that would have caught a provider starting to send them reports zero
 * forever. ⛔ **So a request that did NOT travel is a row here too**, carrying
 * {@link WhereARequestWent}'s refused arm, and *"has anything permission-shaped ever arrived
 * here?"* is {@link permissionShaped} — a fold, not a promise.
 *
 * ## 🔴 The live half this fold could not have, and the launch that gives it one (396)
 *
 * ⛔ **`open` here means *nothing has ended it in the ledger*, not *it can still be answered*.** A
 * provider's pending request lives in the provider's process; an app restart takes it with it, and
 * **no function over the ledger can tell a live wait from a dead one** — the bytes of an app that is
 * running and holding a request and of an app that died holding one are identical. ⚑ That is the
 * same shape `354` measured for a held message and `379` for a stranded run, and `394` said so and
 * left it.
 *
 * 🔴 **`396` did not make the fold cleverer; it made the LAUNCH write the difference down.**
 * `SessionStore.settleStrandedRequests` runs at host construction — the one moment at which nothing
 * is running, so an `open` row belongs to a provider that is gone — and appends
 * {@link RequestStrandedEvent}. ⛔ **The repair had to be a WRITE**, exactly as `379`'s was: a
 * derivation cannot answer what its ledger does not contain.
 *
 * ⚠️ **So {@link RequestState.stranded} is a fact about the APP and not about the conversation**,
 * which is why it is not `abandoned`. Nothing ended, nobody declined, and the conversation that
 * asked can be resumed — what is gone is the request.
 *
 * ## 🔴 The half a LAUNCH could not write either, and the one it MISLABELLED (397)
 *
 * ⛔ **An interruption kills every open card and writes nothing about any of them.** Both adapters
 * call `settleRequests()` inside `interrupt()` and `RequestBroker.settleAll` safe-rejects the lot —
 * no `user_decision`, no `request_resolved` — so a routed request went on reading `open` while the
 * provider had already been told *no* on somebody's behalf.
 *
 * ⚠️ **The launch sweep did not repair that; it MISLABELLED it.** A row left open by an interruption
 * survives to the next launch and `settleStrandedRequests` closes it `stranded` — *the app had
 * stopped* — which is false: the app was running and somebody pressed Stop.
 *
 * 🔴 **{@link RequestInterruptedEvent} is the ending, and it is written beside the one that names
 * the actor.** `RuntimeHost.askTheWorkToStop` records {@link WorkInterruptedEvent} — *somebody asked
 * this work to stop, and here is who* — and then one of these per still-open request, in the same
 * synchronous stretch and BEFORE the provider is asked. ⛔ **What happened and who did it are
 * neighbouring rows**, which is `395`'s ruling rather than a field: *folding them into one
 * vocabulary is how "it was stopped" comes to imply "a person did it"*.
 *
 * ⚠️ **And it is NOT written by every act that stops a turn.** A stop of the whole conversation
 * takes the questions its provider held with it, so they are `abandoned` — ⚑ D-017: `end_agent`,
 * which recorded the ask and then ended the conversation, was the first such act.
 *
 * ## 🔴 The half that is not an ending at all (398)
 *
 * ⛔ **Criterion 11 — *an unanswered question escalates on timeout, chain visible* — adds NO state to
 * this vocabulary.** ⚠️ Escalating does not un-ask the original: the parent may still answer, the
 * card is still open on the child, and the request is still `open`. ⚑ *Has this ended?* and *has
 * this been escalated?* are two questions, and `395`'s ruling is that folding two questions into one
 * vocabulary is how a word comes to imply something nobody said. So the first is
 * {@link RoutedRequest.state} and the second is {@link RoutedRequest.escalatedAt} — a field beside
 * the word, exactly as `397` put the ACTOR on a neighbouring row rather than into the word.
 *
 * ⚠️ **The chain is a fold too**, and it is {@link escalationChain}: the rows read transitively, not
 * a sentence stored anywhere. ⛔ A stored chain would be a second spelling of a relationship the
 * ledger already holds, free to disagree with it the moment anything moved.
 */

/**
 * ⛔ **612 · `ESCALATION_WINDOW_MS` stood here and is GONE with the deadline it measured**
 * (HO-088 §3.1).
 *
 * ## 🔴 The ruling, quoted, because it is the THIRD time this app made the same mistake
 *
 * A timer cannot establish that an agent failed to answer. It can expire while that agent is still thinking and unnecessarily ask the person a question the agent could settle.
 *
 * > ⚑ **A parent answers the question, or passes it up. Both are deliberate. Neither is a
 * > timeout.**
 *
 * ## ⚑ What it WAS, because the derivation is cited elsewhere and the number is not
 *
 * ⛔ **30,000 ms, measured** — `353`, filed in `00-slice4-measurements.md` §2, at **1.80× the
 * largest turn in its sample**. ⚠️ **That response published its own weakness and the constant
 * inherited it**: `n=16`, eight turns per provider, so p90 and p95 ARE the maximum and the number
 * was a floor rather than a tail study. 🔴 **Restating it as *"measured"* without that clause is
 * how a floor becomes a fact** — and that sentence is the one `PROPOSAL_BOUND_MS` and the
 * `ASK_BOUND_MS` note below both cited, which is why it is kept here rather than deleted with the
 * number it was about.
 *
 * ⚠️ **616 · all three are gone now and the citation is a NAME rather than a `{@link}`** —
 * `608` took `ASK_BOUND_MS`, `612` took this one, `616` took `PROPOSAL_BOUND_MS`, and a link to a
 * symbol nothing exports is a pointer clause that cannot be followed (`a-pointer-clause-is-a-claim`).
 * ⚑ **The rule they cited outlives all three**, which is why it is written here in full rather
 * than left to a reference.
 *
 * ⚑ **It watched the QUESTION's age and never the provider's silence** — the other half of `353`'s
 * answer, and the reason it was never `LivenessTracker`'s window used twice.
 *
 * ## 🔴 What replaced it, and it is an ACT rather than a longer clock
 *
 * ⛔ **`611` built `pass_question_up`** (HO-088 §3.2): a parent that will not answer says so, in
 * one call, and the question reaches the person carrying the ORIGINAL words. ⚑ **So the row that
 * used to arrive because thirty seconds passed now arrives because somebody decided** — and it
 * lands in the same population, through {@link WhereARequestWent}'s `the-person-the-asker-named`
 * arm, which is what `HO-090` §4 asked for.
 *
 * ⚠️ **And the stall risk was already answered** (HO-088 §3.3): a turn that ends with a question
 * neither answered nor passed up is a STALLED TASK — `557`'s machinery, `609`'s `waiting-on-*`
 * family. ⛔ **Nothing here is a replacement timer**, and there is not to be one: the PO has ruled
 * against a clock in this position three times.
 *
 * ⚠️ **{@link RoutedRequest.escalatedAt} survives and nothing writes it any more** — see that
 * field for why a ledger that already holds one must go on reading.
 */

/**
 * ⛔ **608 · `ASK_BOUND_MS` stood here and is GONE with the wait it bounded** (HO-084 §4).
 *
 * ## 🔴 What it was, because the derivation is worth keeping and the number is not
 *
 * ⚑ **300,000 ms — TEN escalation windows** (437, criterion 29), so that the chain *ask → the
 * parent does not answer → a person is told → the person answers* fitted inside the time a
 * worker's tool call was parked. ⛔ **It was never a measurement of how long anybody takes to
 * decide**, and its own note said so: `353`'s 30,000 ms measures TURNS with a published weakness,
 * and restating a floor as a fact is the mistake the note above — where `ESCALATION_WINDOW_MS`
 * stood until `612` — warns about.
 *
 * Measure the person's answer window from when they actually received the question. Earlier escalation time and spare app windows must not consume the time offered to them.
 *
 * ## ⚠️ Why it could not simply stay
 *
 * ⛔ **`591` had already taken its meaning away.** 🔴 **This note said *a parent that answers after
 * the bound is refused BY NAME* — and `591` deleted the behaviour that sentence described**
 * (HO-082 §2, standing rule 8.1): both answer doors took a late answer and refused it on a flag in
 * memory, while the row they were refusing about went on saying somebody owed an answer. ⚠️ After
 * that a question ended when it was answered, or when its work was withdrawn or ended, and never on
 * elapsed time — so the number bounded ONE thing: how long the worker's tool call waited. ⚑ **`608` removed that wait**, and a
 * number whose last reader is gone is `a-number-can-survive-the-death-of-its-derivation`, which is
 * a defect this project keeps by name.
 *
 * ⚠️ **It had ONE other reader and that reader was re-homed rather than left importing a corpse**:
 * `PROPOSAL_BOUND_MS` was defined as this constant, for a stated reason — *this app has one bound
 * for a call parked on somebody else's decision, and a second spelling would be free to drift.*
 * ⛔ **That reason was about TWO such calls.** ⚑ `608` removed one and moved the other's literal
 * into `shared/proposals.ts`; 🔴 **`616` then removed that one too** (`HO-093` §2), so there is
 * no bound anywhere in this app on a call parked on somebody else's decision — because no such
 * call is parked.
 *
 * > ⚑ **HO-082 §2.2: a question ends when it is answered, or when the work it belongs to is
 * > withdrawn or ended. NEVER on elapsed time.** ⛔ Since `608` there is no elapsed time in this
 * > mechanism at all.
 *
 * ⚠️ **What is unchanged:** the routing row is still closed by the next launch's
 * `settleStrandedRequests` when nothing else closed it first — the app stopping really does end a
 * question, because the conversation holding it is gone.
 */

/**
 * Every state a routed request can be in, as data.
 *
 * ⛔ **A closed list because {@link REQUEST_IS_OPEN} is keyed by it**, so another cannot be added
 * without deciding whether it is still somebody's to answer. ⚠️ **The rule is stated without a
 * COUNT**, which `396` is the reason for: it said *"a seventh"* while there were six, and adding one
 * would have left a sentence that is arithmetically wrong and reads as though it were checked.
 */
export const REQUEST_STATES = [
  /** Nothing in this ledger has ended it. */
  'open',
  /** A person or the parent sent an answer. */
  'answered',
  /** A person or the parent declined to answer — the protocol-safe default, which is not an error. */
  'rejected',
  /**
   * ⚠️ **A permission outcome settled it** — `allow`, `deny`, `allow_for_session`,
   * `allow_all_for_session` or `cancel`. ⛔ Not folded into `answered`: what happened is that
   * somebody exercised authority, and a row that called that *answering a question* would be this
   * app's own vocabulary contradicting criterion 10.
   */
  'decided',
  /** The provider withdrew it — `request_resolved`, which `051` added for exactly this. */
  'withdrawn',
  /**
   * The conversation ended with it still open.
   *
   * ⚑ **D-017 · R4 — only a provider's own request, from a launch that wrote `launched` on**: a
   * question this app asked outlives the stop. ⚠️ A ledger written before then keeps its rows as they
   * are: nothing routes one again (D-016 · ruling 14). ⛔ The row itself never changes.
   */
  'abandoned',
  /**
   * 🔴 **The app stopped while it was still waiting, and the provider holding it is gone** (396).
   *
   * ⛔ **Not `abandoned`, and the difference is load-bearing.** `abandoned` says *the conversation
   * ended underneath it*; this says *the conversation is still there and the request is not*. A
   * parent told `abandoned` would reasonably conclude its child had gone away, which is exactly the
   * wrong thing to do about a conversation it can resume and ask again.
   *
   * ⚠️ **Written by ONE writer** — `SessionStore.settleStrandedRequests`, at host construction,
   * which is the only moment at which *nothing is running* is a fact rather than a hope. ⛔ It is
   * never derived from a timeout: *a timeout decides that silence means failure after N seconds — a
   * guess dressed as a fact* (`396` §4).
   */
  'stranded',
  /**
   * 🔴 **Somebody stopped the work this was raised in, and the conversation is still there** (397).
   *
   * ⛔ **ONE producer, and naming it is the whole point.** `RuntimeHost.askTheWorkToStop` is the
   * only path to `SessionHandle.interrupt()`, both adapters call `settleRequests()` on the line
   * after `requestInterrupt()`, and `RequestBroker.settleAll` safe-rejects every open card. ⚠️ It is
   * the app's own act and no provider can produce it — the same property {@link stranded} has, for
   * the opposite reason.
   *
   * ## ⛔ Why it is none of the other endings
   *
   *  - **not `rejected`** — a rejection is somebody DECIDING. Nobody decided: `settleAll` sends the
   *    protocol-safe default because the socket needs an answer, and calling that a decision is
   *    HO-005 Q2 in the ledger (*"an agent answering another agent's permission prompt is the kill
   *    switch with extra steps"*), written down after the fact.
   *  - **not `withdrawn`** — the provider did not clear it; this app killed it.
   *  - **not `abandoned`** — the conversation did not end. It is idle, it is resumable, and asking
   *    it again is exactly the right thing to do. ⚑ **An act that BOTH stops the turn and ends the
   *    conversation still gives `abandoned`**, because the ending is the fact that governs what a
   *    reader should do next (`end_agent`, until D-017, recorded the ask and never wrote this
   *    ending).
   *  - **not `stranded`** — the app did not stop. Reporting a restart that never happened would send
   *    a reader looking for a crash.
   *
   * ## ⚠️ It says WHAT happened and never WHO, and that is `395`'s ruling rather than an omission
   *
   * ⛔ **`HowWorkStopped` is about the work; `WhoStoppedIt` is about a gesture, and folding them
   * into one vocabulary is how *"it was stopped"* comes to imply *"a person did it"*** — the false
   * sentence `395` spent a dispatch removing. ⚑ The actor is on {@link WorkInterruptedEvent}, at the
   * ordinal immediately before the row this state is folded from: **one row over, not one ledger
   * over**, and written in the same synchronous stretch so nothing can come between them.
   */
  'interrupted',
  /**
   * 🔴 **The work this question was raised about was taken back, so there is nothing left to
   * decide** (591, HO-082 §2.2).
   *
   * ⛔ **Folded from the take-back itself.** A giver taking a piece back writes `work_taken_back`
   * into the owner's ledger — the asker's own, since a question about a piece is asked by the
   * conversation holding it — and {@link deriveRoutedRequests} ends every still-open request that
   * names that piece. ⚑ **Until `591` nothing ended them at all**, and the routing row read `open` for
   * ever — a queue row a person could never clear, about work that no longer existed; from `591` to
   * D-016 the door wrote one ending row per request, and since D-016 the one row does it.
   *
   * ## ⛔ Why it is none of the other endings
   *
   *  - **not `withdrawn`** — that one is the PROVIDER clearing its own card (`request_resolved`,
   *    `051`), or the asker taking its own question back. Nothing like that happened here, and a
   *    reader told `withdrawn` would reasonably conclude the asker retracted its own question. ⚡ The
   *    qualifier in this word is which thing was withdrawn, and it is there because the plain word
   *    was taken by the other one.
   *  - **not `rejected`** — a rejection is somebody declining to ANSWER, and the giver did not
   *    decline; it took the work away. ⚠️ Folding the two would tell a worker its question was
   *    considered and refused, which is a claim about a decision nobody made — `395`'s ruling.
   *  - **not `interrupted`** — that word means the turn was stopped and the card went with it.
   *    ⛔ Here the turn is untouched, the worker may still be mid-call, and
   *    {@link RequestState.interrupted}'s own sentence — *there is no longer a request on the other
   *    side to receive anything* — is false.
   *  - **not `abandoned`** — the conversation did not end. It is there, and it is told.
   *
   * ⚠️ **It says WHAT happened and never WHO**, which is `397`'s rule at this venue: the actor is
   * on the take-back row itself (`WorkTakenBackEvent.by`).
   */
  'work-withdrawn',
  /**
   * 🔴 **D-016 · the work this question was raised about was closed by its giver, so there is
   * nothing left to decide.**
   *
   * ⛔ **Folded from the close itself**, as `work-withdrawn` is from a take-back: the giver's
   * close writes `work_closed` into the owner's ledger — the asker's own — and
   * {@link deriveRoutedRequests} ends every still-open request that names that piece.
   *
   * ⚠️ **Not `work-withdrawn`**: nothing was taken back. Taking a piece back says its owner no longer
   * owes it; closing it says the work itself is ended by the one that gave it, and a reader told
   * *taken back* would look for the work to be given again.
   *
   * ⚠️ **It says WHAT happened and never WHO**, `work-withdrawn`'s rule: the actor is on the close
   * row itself (`WorkClosedEvent.by`).
   */
  'work-closed',
  /**
   * The work it was about was handed back (`work_replied`), so nothing is left for an answer to
   * decide. ⚑ It says what happened and never who: the reply row names its owner.
   */
  'work-replied',
  /**
   * 🔴 **D-009 · F012 — the conversation it was addressed to ended without answering it**
   * (ruling 5). ⛔ Not `abandoned`, which is the ASKER's conversation ending: this one is still
   * there, and it is told. ⚑ One producer, `question_recipient_ended`; a quit writes none.
   */
  'recipient-ended',
] as const

/**
 * 🔴 **D-009 · F012 — where a question may be PASSED: the parent, or a person** (ruling 2: *only a
 * question to your parent can be passed further up*, and the next hop is the chain's). ⛔ Never an
 * agent by name — passing on is climbing the chain, not choosing a peer.
 */
export const PASS_UP_RECIPIENTS = [
  'the-parent',
  'a-person',
] as const satisfies readonly QuestionRecipient[]

/**
 * 🔴 **What NARROWED one walk over ledgers — the fact `434-relay-1` does not carry** (453,
 * HO-024 criterion 17's *everything*). ⚑ 467 and 466 both extended this register while the other
 * was in flight; this is the one account of it, and neither side's is left standing beside it.
 *
 * ## ⛔ It was `QUEUE_WALKS`, and 467 had already written down why that name was wrong
 *
 * ⚠️ **466 is why the name could not stay.** A digest word inside a constant called `QUEUE_WALKS`, keyed
 * into a table called `WALK_COVERS`, is exactly the shape
 * `the-artefact-you-resolve-through-can-carry-the-defect` names — the artefact every reader
 * resolves through, spelling the one thing it is not. ⛔ **Nothing about the members moved with
 * the name.**
 *
 * ## 🔴 The eleven words, and what each one narrowed
 *
 * | the word | ledgers it opened | what else narrowed what it read |
 * |---|---|---|
 * | `every-conversation-that-routed` | every conversation in this app that ever routed a request | the live projection |
 * | `one-window-over-every-agents-conversation` | every conversation one of this app's agents holds | the live projection, **and a clock** |
 * | `every-conversation-this-app-placed` | **the same conversations as the row above**, newest first | the live projection, **and a LIMIT** |
 * | `every-conversation-this-one-gave-work-to` | every conversation one conversation ever gave work to | the live projection |
 * | `every-conversation-this-one-spawned` | every conversation this app recorded as started by one conversation | nothing — **no ledger row is read at all** |
 * | `every-piece-of-work-this-one-was-given` | one conversation's own ledger | the live projection |
 * | `every-conversation-that-was-given-work` | every conversation in this app another conversation ever gave work to | the live projection |
 * | `every-conversation-that-holds-work` | every conversation that holds work, including roots | the live projection, open pieces only |
 * | `every-provider-wall-recently-recorded` | every conversation in this app, for their error rows only | a clock, and the three phrases a provider walls in — **not** the live projection |
 * | `no-such-conversation` | none — this app holds no conversation by that id | — |
 * | `no-ledger` | none — this app has no database | — |
 *
 * ⚑ **508 · `every-conversation-this-one-gave-work-to` is the first candidate set keyed on a
 * CONVERSATION rather than on the whole app**: *"the work I gave out"* starts from the giver.
 *
 * 🔴 **557 · `every-conversation-that-was-given-work` is that word with the GIVER taken out**, and
 * it is the first candidate set over the whole app that opens ledgers whole. ⛔ A person is not
 * inside one family, so a reader on their behalf cannot start from one conversation — the same
 * reason `questionsAPersonMustAnswer` reads every conversation that routed rather than one parent's
 * children.
 *
 * 🔴 **533 · `every-provider-wall-recently-recorded` is the first candidate set that is ROWS
 * rather than conversations, and the first whose narrowing is NOT the live projection.**
 * `providerLimitsSeen` reads the error rows of
 * every ledger at once and deliberately does not scope to the active generation: a wall is a fact
 * about the provider's account, so a rebuilt projection has not un-spent the window. ⚠️ **That is
 * why it earns a word rather than borrowing one** — every sentence above carries the generation
 * clause and this read cannot make that promise.
 *
 * ⚑ **543 · two more candidate sets and one more emptiness, and the ORDINALS above are gone
 * rather than renumbered.** `every-conversation-this-one-spawned` is the first member that opens no
 * ledger at all — lineage is three columns of a `provider_session` row — and
 * `every-piece-of-work-this-one-was-given` is the first whose candidate set is a SINGLE ledger, its
 * own, so its `ledgers` is 1 by construction. ⛔ `no-such-conversation` answers for the LINEAGE half
 * alone.
 *
 * ⚑ **A census reads this table back against the array**, so an ELEVENTH word that nobody wrote a
 * row for fails rather than reading as covered — `a-pointer-clause-is-a-claim`. ⚠️ **Two sentences
 * above used to number their subject** — *the fifth*, *the sixth* — **and `543` replaced the
 * ordinals with the words themselves**, because an ordinal is a number in prose and this register
 * gains members: `a-number-can-survive-the-death-of-its-derivation`, which had already made the
 * count in the heading wrong twice. ⛔ The heading's COUNT stays a count on purpose: `466 M24`
 * mutates it, and the census derives the numeral from the array.
 *
 * ## ⛔ A member is a (candidate set, NARROWING) pair — which is what both sides had to change
 *
 * 🔴 **This used to say *a member per POPULATION*, and it used to say the candidate set was *the
 * only thing that narrows this read*. Neither survives**: the digest and the forest open the SAME
 * conversations — every one an agent of this app holds — and each narrows them differently, the
 * digest by a clock and the forest by a limit.
 *
 * ⚠️ **So two words over one candidate set is legal, and ONLY because each narrowing makes a
 * sentence the other cannot say.** ⛔ Reusing one word for both would ship one read's promise over
 * the other — a false sentence rather than a shortcut, which is the failure this vocabulary exists
 * to stop and the one nothing goes red for.
 *
 * ⛔ **The discipline, restated so the next member can be judged against it: a walk needs a word
 * of its own when no existing word's {@link WALK_COVERS} sentence is TRUE of it.** ⚑ That still
 * makes a new population a new word — no sentence about another population is true of it — and it
 * now makes a new narrowing one too. {@link WALK_COVERS} is exhaustive over the type, which is
 * `NOUN_OF_KIND`'s discipline one layer down and `448`'s argument verbatim: *a member fails
 * to compile until somebody has decided what a list folded through it is.*
 *
 * ⚠️ **The two words over one candidate set are deliberately NOT substrings of one another.** The
 * moment two words describe one population, an assertion written against either can be satisfied
 * by the other — `an-assertion-can-be-satisfied-by-a-neighbouring-element`.
 *
 * ## ⚑ The three ways a walk can answer NOTHING
 *
 * 🔴 **`rows: []` is three different facts, and the word plus {@link LedgerWalk.ledgers} is the
 * whole of what tells them apart:**
 *
 * 1. ⛔ **`no-ledger`** — this app has no database at all. `NULL_SESSION_STORE`.
 * 2. ⛔ **a reading word with `ledgers: 0`** — there was nothing to open.
 * 3. ⛔ **a reading word with `ledgers: 47`** — forty-seven conversations, and they said nothing.
 *
 * ⚠️ **Only the first is a word; the second and third are one word told apart by a count.** ⛔ That
 * is the entire reason {@link LedgerWalk.ledgers} is taken from the candidate query and never from
 * the rows — a count folded out of `rows` answers `0` to both of them.
 *
 * ## ⛔ The defect it closes, and it is the empty case
 *
 * ⚠️ **`434-relay-1` settled the WINDOW and nothing else.** It measured, against a real database,
 * that neither statement in this path carries a time bound, a `LIMIT` or a page — *"the waiting set
 * can be read completely at any age"* — and `the-queue-is-complete-regardless-of-age.test.ts` pins
 * both statements so a `created_at >=` added later goes red. ⛔ **That is a fact about AGE. It says
 * nothing about SCOPE**, and an unwindowed read can still be short because it walked the wrong
 * ledgers, walked none, or could not finish walking one.
 *
 * 🔴 **And the empty case is the one a person reads most often**, because it is the one that lets
 * them stop looking. `personsQueueView` draws *"Nothing is waiting on you"* at zero rows, and before
 * this vocabulary existed that sentence was the same bytes whether the reader had walked every
 * ledger in the workspace or had no database at all — `NULL_SESSION_STORE` answers `[]` to all
 * three readers, and `[]` is what *"the workspace is quiet"* is drawn from.
 *
 * ## ⚑ 448's shape, and deliberately not a second invention of it
 *
 * ⛔ **`448` met this exact problem one surface over and its commit is named for it** — *a count
 * that says what it counted*. `447` proved that *the list was filtered* and *the list was stale* are
 * the same bytes from outside, and `448`'s answer was a WORD the fold itself used plus a sentence
 * keyed on it (`count_covers`). ⚠️ This is that shape with the axis changed: there
 * is no grant to report here — a person reaches everything — so the word names what narrowed the
 * read, starting with the candidate set it opened.
 */
export const LEDGER_WALK_KINDS = [
  /**
   * ⛔ **Every conversation in this database that has ever routed a request** —
   * `SELECT DISTINCT session_id FROM events WHERE type = 'request_routed'`, which is the candidate
   * set `questionsAPersonMustAnswer` and `decisionsAwaitingAPerson` both start from.
   */
  'every-conversation-that-routed',
  /**
   * 🔴 **Every conversation one of this app's agents holds, read only inside one stretch of the
   * clock** (466; one list since D-016) — `selectDigestWindow`: `provider_session` whose
   * `agent_identity_id` is set, and `created_at >= ? AND < ?`.
   *
   * ⛔ **The first member that is NOT a population of its own.** The forest's word below opens the
   * same conversations and reads the whole of each; this reads a window out of each. ⚑ Two words,
   * because the forest's sentence promises *no window* and this read cannot inherit that promise.
   *
   * ⚠️ **The candidate set is every such conversation and NOT the conversations that produced a
   * row** — `WindowDigest.sessions` is the second number and it is counted off the rows. ⚑ Forty-seven
   * conversations and a quiet night is `ledgers: 47, sessions: 0`, and those are two different
   * facts that `rows.length` answers `0` to for both.
   *
   * ⛔ **Not a substring of the word below and not a superstring of it**, deliberately — see the
   * register's own note on `an-assertion-can-be-satisfied-by-a-neighbouring-element`.
   */
  'one-window-over-every-agents-conversation',
  /**
   * 🔴 **Every conversation one of this app's agents holds, BOUNDED** (637 §2.2) — every row, newest
   * first, up to `MAX_FOREST_CONVERSATIONS`.
   *
   * 🔴 **The LIMIT is why this may not be the digest's word read wider.** ⚠️ Every
   * other sentence in {@link WALK_COVERS} that READS anything promises *no limit*; this one cannot, and a
   * walk inheriting a promise it breaks is the defect `466` spent a word to avoid. ⛔ **Past the
   * bound the answer is SHORT and never a refusal** — `TheWholeForest.conversations` beside
   * {@link LedgerWalk.ledgers} is how short, and a drawn conversation whose parent fell outside
   * says so in a word rather than pointing at nothing.
   *
   * ⚠️ **A conversation no agent of this app holds is in no forest** — `agent_identity_id IS NULL`,
   * the population `TheWholeForest.heldByNoAgent` discloses. ⛔ Excluded by the candidate query
   * rather than dropped by a filter.
   */
  'every-conversation-this-app-placed',
  /**
   * 🔴 **Every conversation this one has ever GIVEN WORK TO** (508) —
   * `SELECT DISTINCT owner_session_id FROM work WHERE given_by_session_id = ?`, served by
   * `work_given_by_idx` (D-016; a scan of the ledger for task rows until then).
   *
   * ⛔ **Not a narrowing of the words above, and the candidate set is why.** This one starts from
   * the giver and follows the work wherever it went; the `work` table carries no generation, because
   * a piece is a row written once.
   *
   * ⚠️ **The ledgers it opens ARE read at their live projection**, unlike the candidate query:
   * `piecesOfSession` passes `activeGeneration(sessionId)`, so work whose state exists only in a
   * projection this app has replaced is not folded. ⛔ The sentence below says both halves,
   * because they are two different narrowings and only one of them is the candidate set's.
   */
  'every-conversation-this-one-gave-work-to',
  /**
   * 🔴 **Every conversation this app recorded one conversation as having SPAWNED** (543) —
   * `SELECT … FROM provider_session WHERE parent_session_id = ?`, served by
   * `provider_session_parent_idx`, over the self-FK `341` wrote.
   *
   * ⛔ **The first member that opens NO LEDGER, and that is why it is a word rather than a
   * borrowing.** Every sentence above promises something about what was read out of a ledger;
   * lineage is one column of a `provider_session` row, written with the row, and this walk reads
   * those rows and folds nothing. ⚑ So {@link LedgerWalk.rowsUnread} is `0` here: since D-016 the
   * parent is the whole of the edge, and there is no half-written one to count.
   *
   * ⚑ **Not a narrowing of the word above it, and the two lists coincide only by accident.** A
   * conversation may give work to one it never spawned — `540` §5 measured that population and
   * named it — and may spawn one it never gives work to.
   *
   * ⚠️ **557 · this clause used to end *work is admitted by `can_message` and not by descent*, and
   * HO-060 §2 made it false.** ⚑ **Since D-014 work needs `can_assign_work` AND a conversation the
   * giver started**, and since D-016 a give starts the conversation it gives to when there is none,
   * so descent is the relationship rather than the thing the gate ignores. 🔴 **The two lists still
   * differ**: a conversation may start one it never gives more work to once the first piece ends.
   */
  'every-conversation-this-one-spawned',
  /**
   * 🔴 **One conversation's own ledger, read whole, for the work it was GIVEN** (543) —
   * `piecesOfSession(sessionId)`, which is `selectPieceEvents` at that conversation's active
   * generation.
   *
   * ⛔ **The other END of the work edge, and it is not the word above narrowed.**
   * `every-conversation-this-one-gave-work-to` opens the ledger of everybody this conversation gave
   * work to; this opens exactly one — its own — because {@link PieceRow.owner} is *the ledger
   * this row was folded from*. ⚑ So {@link LedgerWalk.ledgers} is always 1 here, which is a fact
   * about the shape rather than about the workspace, and a reader must not read it as a count of
   * anything a person did.
   *
   * ⚠️ **The generation clause is the one it shares with its neighbours**: work that exists only in
   * a projection this app has replaced is not folded.
   */
  'every-piece-of-work-this-one-was-given',
  /**
   * 🔴 **Every conversation in this database that another conversation has ever GIVEN work** (557)
   * — `SELECT DISTINCT owner_session_id FROM work WHERE given_by_session_id IS NOT NULL` (D-016 ·
   * commit 6): never a root's owner for its root, nor for work it took on for a person — no giver
   * waits on either (R1).
   *
   * ⛔ **It is `every-conversation-this-one-gave-work-to` with the GIVER taken out, and that is
   * what makes it a word rather than a borrowing.** That set starts from one conversation and
   * follows what it handed out; this one starts from nobody, because a person is not inside one
   * family — the same reason `questionsForAPerson` reads every conversation that routed rather
   * than one parent's children.
   *
   * ⚠️ **The OWNER, so these are the ledgers the work LANDED in** — the half a sweep reading the
   * givers would get backwards: a stall is folded from the HOLDER's rows.
   *
   * ⚑ **The ledgers are read at their live projection**, like every other word here that opens
   * one, so work that exists solely in a projection this app has replaced is not folded.
   */
  'every-conversation-that-was-given-work',
  /**
   * 🔴 **Every provider wall this app has recorded inside its own lookback** (533) —
   * `SELECT … FROM events WHERE type = 'error' AND created_at >= ?`, served by
   * `events_error_idx`, across every conversation in the database.
   *
   * ⛔ **The first member whose candidate set is ROWS rather than conversations, and it is a
   * different narrowing from every word above.** Those open a list of ledgers and fold each one
   * whole; this one reads the error rows themselves, from every ledger at once, and the ledgers it
   * touched are counted off the same predicate. ⚑ Two of the words above already prove a walk earns
   * its own entry when what it NARROWS differs — a window over the same ledgers is a second word —
   * and this narrows by the clock and by the event type.
   *
   * ⚠️ **It is NOT scoped to the live projection, and that is the one place it differs from its
   * neighbours.** A wall is a fact about the provider's account rather than about a conversation, so
   * a rebuilt projection does not un-say it: the provider's window is still spent. ⛔ The clause is
   * therefore absent from the sentence rather than copied into it, because it would be false here.
   */
  'every-provider-wall-recently-recorded',
  /**
   * 🔴 **Nothing was walked, because this app holds no conversation by that id** (543).
   *
   * ⛔ **It answers for the LINEAGE half and for nothing else, and that is measured rather than
   * hedged.** A parent and a child are columns of `provider_session`, and the work walks answer
   * with their own words — the work a conversation gave or holds is read off `work` and its owners'
   * ledgers, whatever this word says about its lineage.
   *
   * ⚑ **The sentence it stops this app from saying** is `452` §5.1's, one noun over: *nothing was
   * spawned from here*, drawn out of an id this app has never seen.
   */
  'no-such-conversation',
  /**
   * 🔴 **Nothing was walked, because this app has no ledger to walk** — `NULL_SESSION_STORE`.
   *
   * ⛔ **The reachable false case, and the reason this vocabulary is not decoration.** That store
   * answers `[]` to all three readers, with the same bytes a workspace where genuinely nothing is
   * waiting answers — so *"Nothing is waiting on you"* was drawn out of *"I have no database"* and
   * nothing anywhere could tell the two apart.
   */
  'no-ledger',
  'every-conversation-that-holds-work',
] as const
