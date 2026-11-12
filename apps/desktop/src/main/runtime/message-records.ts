import type { Provider } from '@brobot2/shared'
import type { AgentState } from '../../shared/agent-state-contracts'
import type { AppNotice } from '../../shared/app-notice'
import type { QueueOutcome } from '../../shared/runtime-ipc'
import type { AnsweredQuestion } from '../../shared/human-answer-contracts'
import type { HandedPath } from '../../shared/attachment-contracts'
import type { TheQuestionItAsks } from '../../shared/conversation-events'
import type { WorkReport } from '../../shared/task-contracts'
import type { GivenFolder } from '../../shared/work-folders'
import type { GivenInput } from '../db/session-store'
import type { InterruptRefusal } from './interrupt-rails'
import type { AnswerOutcome } from './question-rails'
import type { QueuedMessage } from './queued-message'

/**
 * ⚑ **657 · what `queueMessage` carries, spelled once for the doors that take it** — {@link TurnFacts}
 * minus the piece a brief gives or gives a new brief, which only {@link RuntimeHost.giveWork} and
 * {@link RuntimeHost.updateWork} may state.
 *
 * 🔴 **An `Omit` alone is NOT that rail**: excess-property checking fires on a fresh object literal
 * and not on a VARIABLE, so the `& { …?: never }` is what makes each key unspellable by any route
 * rather than merely unlisted.
 */
export type FactsAQueueCarries = Omit<TurnFacts, 'giving' | 'rebriefing'> & {
  readonly giving?: never
  readonly rebriefing?: never
}

/**
 * 🔴 **D-016 · a piece being GIVEN — everything its `work` row and its `work_given` row are written
 * from, and what the brief's turn names** (R4).
 *
 * ⚑ **Settled before the brief is sent**: the number is taken in the give's synchronous stretch, so
 * the owner is told the label in the brief's own sender line. ⛔ **The owner is not here** — it is the
 * conversation the brief actually reaches, which only the delivery knows (R2).
 */
export interface Giving {
  /** `work_<uuid>`, minted before the send. */
  readonly piece: string
  /** The piece it is given under — the giver's own. */
  readonly parent: string
  readonly number: number
  readonly label: string
  /** The conversation giving it. */
  readonly giver: string
  readonly title: string
  readonly brief: string
  readonly definitionOfDone: string
  /** The folder the give asked for, as asked, or `null`. */
  readonly folder: string | null
  /**
   * 🔴 **W4.189 · that folder, as this app used it** — the new conversation's working folder, or a
   * grant on the one it has — with D's notice; `null`: the give named none, or this is work taken on.
   */
  readonly givenFolder: GivenFolder | null
  /**
   * 🔴 **R2 · the files it hands over, kept before the send** — each id minted here, so the brief's
   * turn names them and the store writes their rows with the give's own ({@link recordTheGive}).
   */
  readonly inputs: readonly GivenInput[]
}

/**
 * ⚑ **D-016 · what {@link RuntimeHost.recordTheGive} writes down** — a give's {@link Giving}, or a
 * piece this conversation takes on for a person ({@link RuntimeHost.takeOnWork}, commit 6), whose
 * giver is `null`: a person.
 */
export type ThePieceWrittenDown = Omit<Giving, 'giver'> & { readonly giver: string | null }

/**
 * 🔴 **D-016 · the piece a turn delivers, as the provider is told it** — its label and title go into
 * the sender line and `messageNamingThePiece`'s last line, with its inputs.
 */
export interface ThePieceATurnCarries {
  readonly piece: string
  readonly label: string
  readonly title: string | null
  readonly definitionOfDone?: string
  /** Whether these words give the piece, or give it a new brief (`update_work`). */
  readonly as: 'given' | 'rebriefed'
  /** Its inputs, by id and name, as they stand when the words go out. */
  readonly inputs: readonly { readonly resource: string; readonly name: string }[]
  /**
   * 🔴 **W4.189 · the folder this piece grants its holder**, which the piece line names; absent:
   * none — its give named no folder, started the conversation in it, or came before this build.
   */
  readonly grant?: string
  readonly outputFolder?: string
}

/**
 * 🔴 **D-027 · one held message of the turn a flush hands over** — {@link RuntimeHost.runFlush}'s
 * reading of it at the handover.
 */
export interface OneMessageOfATurn {
  readonly queued: QueuedMessage
  /** ⚑ The words that go: its own, or a held give's newest brief (D-022 · R1). */
  readonly words: string
  /** ⚑ Its paths as re-checked at the flush — what goes on the wire (216). */
  readonly handed: { readonly paths: HandedPath[] }
  readonly handing: ThePieceATurnCarries | null
}

/**
 * 🔴 **Everything about a turn that is not its words** (414) — the one object every send door takes.
 *
 * ## ⛔ Why it is an object, measured rather than preferred
 *
 * ⚠️ **Three dispatches each added a trailing optional to {@link RuntimeHost.send}**: `406` a
 * {@link WorkReport}, `412` the id of the task the turn hands over, `413` the conversation BroBot
 * is carrying for. ⛔ **The last two are both `string | undefined` and landed in the same
 * position**, on two branches, and the merge of those branches is this type's whole reason: a call
 * site that passed the task where it meant the conversation would have COMPILED, and the symptom
 * would have been a worker told to quote a session id and a transcript naming a task as its author.
 * ⚑ **Named fields cannot be swapped by accident**, and a fourth fact is a field rather than a
 * seventh positional.
 *
 * ## ⚠️ What is deliberately NOT in here
 *
 * ⛔ **Who these words came from.** {@link RuntimeHost.originOf} derives it from `by`, at the door,
 * and a caller may not state it — `413`'s ruling, which moved the marking off the producers
 * precisely because a producer that has to remember is a producer that will forget. ⚑ The one
 * thing a caller CAN say about authorship is {@link carriedFor}, and only because no property of
 * the caller can name it.
 */
export interface TurnFacts {
  /**
   * 🔴 **What this turn reports about work, when the APP is the one sending it** (406) — see
   * {@link WorkReport}.
   *
   * ⛔ **Opt-in at the call site**, exactly as `queueMessage`'s `kind` is and for its reason:
   * every caller that existed before `406` passes nothing and publishes the turn it always
   * published. ⚑ Only the two paths that put BroBot's own sentences into a parent's transcript
   * — {@link RuntimeHost.deliverReply} and {@link RuntimeHost.tellOneParent} — pass one.
   *
   * ⚠️ **It no longer decides the AUTHORSHIP** (413) — {@link whoseWordsTheseAre} does, from
   * `by`. It still forces it, which is the belt that paragraph describes.
   */
  readonly report?: WorkReport
  /**
   * 🔴 **D-016 · the piece these words GIVE, when they are a brief** (412 as a task's id) — see
   * {@link Giving}, and `messageNamingThePiece` for the line that says how to finish it.
   *
   * ⛔ **{@link RuntimeHost.giveWork} is the only caller that passes one**, because a give is the only
   * act that hands over a piece: the turn names it (`user_turn.piece`), the held message keeps it, and
   * the `work` row is written from it once the brief is sent or held. ⚠️ A person's turn, a note, a
   * follow-up, a reply, a question and a notice all reach here with nothing.
   *
   * ⛔ **It is a compile error to hand one to `queueMessage`**, which takes this type minus this
   * key — *a caller allowed to name a piece there could make any message claim to hand over work
   * that nothing recorded*.
   */
  readonly giving?: Giving
  /**
   * 🔴 **D-016 · the piece these words give a NEW brief, when they are one** (R1) — its label and
   * title, as {@link giving} names a piece the words give.
   *
   * ⛔ **{@link RuntimeHost.updateWork} is the only caller that passes one**, for {@link giving}'s
   * reason: the turn names the piece (`user_turn.piece`), so its owner reads it as its giver's, and
   * the held message keeps it with `rebrief` — and it is a compile error to hand one to
   * `queueMessage`. ⚠️ **Nothing is written from it once the words go**: `work_rebriefed` was
   * written first.
   */
  readonly rebriefing?: {
    readonly definitionOfDone?: string
    readonly piece: string
    readonly label: string
    readonly title: string
    /** ⚑ **W4.189** — {@link ThePieceATurnCarries.grant}. */
    readonly grant?: string
  }
  /**
   * ⚑ **D-016 · the piece these words are ABOUT, when they name one** — a note's or a follow-up's
   * (and then the sender's own receipt names it, `message_sent.piece`, so the sender's card says
   * which piece it was about), a notice's about a piece, a question's and an answer's. ⛔ **Never on
   * the receiver's turn as itself**: it hands nothing over, and the receiver's turn carries the piece
   * of ITS OWN these words drive ({@link UserTurnEvent.drives}, D-016 · commit 6 · R4 —
   * {@link RuntimeHost.thePieceTheseWordsDrive}). 🔴 **F088 · an agent's note or follow-up says it in
   * the receiver's sender line** — *"This message is about W1.2 · … (answered)."* — so a held one keeps it
   * ({@link QueuedMessage.about}, on its `message_queued` row), which nothing folds.
   */
  readonly aboutPiece?: { readonly piece: string; readonly label: string }
  /**
   * 🔴 **The conversation these words actually came from, when BroBot is carrying for somebody
   * else** (413) — see {@link UserTurnEvent.relayedFrom}.
   *
   * ⛔ **Only {@link RuntimeHost.routeRequest} passes it**, through `queueMessage`. Every other
   * relayed turn is derived from `by`, because there the caller IS the conversation that wrote the
   * words.
   *
   * ⚠️ **It produces no origin line for the provider today, and the reason is the CALLER rather
   * than this field** (414). {@link RuntimeHost.routeRequest} is the only site that sets it and it
   * passes {@link THE_APP_ITSELF}, which {@link RuntimeHost.originOf} answers `null` — so the
   * turn is BroBot's own sentence about a child, and {@link questionText} already names that
   * child inside it. ⛔ **A future producer that set this from an AGENT caller would get both**,
   * a frame naming the relayer and a sentence naming the subject, and that is not obviously
   * wrong — they are different facts. ⚑ Nothing in the code couples them, deliberately; see
   * {@link messageNamingItsSender}.
   */
  readonly carriedFor?: string
  /**
   * ⚑ **The question these words ask** — its asker and request id ({@link TheQuestionItAsks}),
   * passed only by {@link RuntimeHost.deliverQuestion}. ⚑ A notice of a question that has stopped
   * waiting is taken back rather than sent ({@link RuntimeHost.whyItNoLongerGoes}).
   */
  readonly asks?: TheQuestionItAsks
  /**
   * 🔴 **This app's OWN report of something it observed** (624, `HO-095` §6.1) — see
   * {@link AppNotice}.
   *
   * Give app notices their own subject. Without it, {@link whoseWordsTheseAre} supplies only `app_authored`, which `transcript.ts` classifies as the plan go-ahead instead of an app notice. A stall report separately identifies its work through {@link report}.
   *
   * ⚠️ **Opt-in at the call site**, exactly as {@link report} is. ⛔ The callers that pass one are
   * the ones with no other subject — {@link RuntimeHost.deliverAnswer}'s person arm among them —
   * and every other door passes nothing and publishes the turn it always published.
   *
   * ⛔ **It is not derivable from `kind: 'notice'`**, and that is why it is here rather than read
   * off the mailbox. ⚠️ That word answers a different question — *which lane a held message
   * takes, and (since `624`) whether a person may take it back* — over a WIDER population: the
   * third notice producer carries a {@link WorkReport}, so its row is a work report and not one
   * of these. ⚑ The two are deliberately not folded into one field, which is `395`'s ruling
   * about one word answering two questions.
   */
  readonly appNotice?: AppNotice
  readonly answeredQuestion?: AnsweredQuestion
  readonly addressedAs?: string
  readonly messageAct?: string
}

/**
 * 🔴 **What `interruptAgent` answers** (395) — an outcome or a refusal, never a throw.
 *
 * ⛔ **`'no-such-agent'` is `TOOL_REFUSALS`' word and is named rather than payload-shaped**, so the
 * host says WHICH vocabulary answered and `agent-tools.ts` stays the one place that builds a
 * refusal payload. ⚑ Folding it into {@link InterruptRefusal} would have given another vocabulary
 * the same spelling of *"no such agent"* and required another explicitly named share in the census.
 */
export type InterruptOutcome =
  | {
      readonly ok: true
      readonly agent: string
      /**
       * ⚑ **Whether its turn was asked to stop.** ⚑ **D-017 — `false` when no turn ran in it**, so
       * nothing was asked: a conversation this app is not running, one whose provider has stopped or
       * is being stopped, or one with no turn open. ⛔ Not a refusal.
       */
      readonly asked: boolean
      /**
       * ⚠️ **What the agent is doing NOW, and never a claim that the work stopped** — the one
       * derivation's state ({@link AgentCard.state}), read after the bounded wait when it was asked
       * — see {@link RuntimeHost.interruptAgent}. ⚑ On both arms, so this door never words a state
       * of its own.
       */
      readonly state: AgentState
      /**
       * ⚑ **F084 · the commands the stop ended**, as the stopped turn's ending named them — read once
       * that ending came, inside the stop's own bound. Empty when none ended; ⚠️ absent when nothing
       * was asked, or the turn did not end in time: unknown, never *"ended nothing"*.
       */
      readonly ended?: readonly string[]
      /**
       * ⚑ **F084 · what it still has running in the background, read with {@link state}** — what
       * the stop left running ({@link RuntimeHost.whatStillRunsIn}).
       */
      readonly stillRunning: readonly string[]
    }
  | { readonly ok: false; readonly refusal: InterruptRefusal | 'no-such-agent' }

/** What {@link RuntimeHost.messageAgentNow} did about the turn its message waits behind. */
export type TheStopAMessageGot =
  /** The turn was asked to stop; the message goes out as it ends. */
  | 'asked'
  /** No turn was running that could be stopped: the message was sent, or is about to be. */
  | 'not-needed'
  /** A person is replacing that turn with their own words; the message goes with or after them. */
  | 'a-person-is-replacing-its-turn'
  /** The turn waits for a person's answer, and stopping it would answer for them. */
  | 'a-person-is-being-asked'
  /** The turn waits for another conversation's answer, and stopping it would answer for that one. */
  | 'it-is-waiting-on-an-answer'
  /** The message is held, and the turn could not be asked to stop. */
  | 'could-not-be-asked'
  /** An answer's asker is not one its answerer may interrupt; the answer waits for its turn to end. */
  | 'not-below-you'
  /** A person's own words opened the turn an answer waits behind: it is theirs, and runs on. */
  | 'a-person-started-its-turn'
  /** The turn was already asked to stop and has not ended: the words go in as it ends, unasked again. */
  | 'already-asked'

/** A stop asked for a held message, and whose answer a turn that was not stopped waits on. */
export interface TheStopItsWordsAsked {
  readonly stop: TheStopAMessageGot
  /** The conversation whose answer the turn waits for, on `it-is-waiting-on-an-answer`. */
  readonly askedOf: string | null
  /** ⚑ **F084** — on `asked`, the conversation whose turn was asked to stop. */
  readonly stopped?: string
  /** ⚑ **F084** — on `asked`, its provider, whose rule a receipt says when the ending is not in yet. */
  readonly provider?: Provider
  /** ⚑ **F084** — on `asked`, the wait for what that stop ends; taken off before a receipt reads it. */
  readonly ending?: Promise<readonly string[] | undefined>
  /**
   * ⚑ **F084** — on `asked`, once that turn ended within the bound `interrupt_agent` waits: the
   * commands its stop ended ({@link RuntimeHost.withWhatItsStopLeft}). Absent when it did not end
   * in time.
   */
  readonly ended?: readonly string[]
  /** ⚑ **F084** — …and what that conversation still has running in the background then. */
  readonly stillRunning?: readonly string[]
}

/** What {@link RuntimeHost.answerQuestion} answers; with `interrupt`, what became of the stop too. */
export type AnswerWithItsStop =
  | (Extract<AnswerOutcome, { readonly ok: true }> & {
      readonly stop?: TheStopItsWordsAsked
      /** The answer is held behind the asker's running turn, and goes as that turn ends. */
      readonly held?: true
    })
  | Extract<AnswerOutcome, { readonly ok: false }>

/** What {@link RuntimeHost.messageAgentNow} answers: a refusal before anything is held, or both halves. */
export type MessageNowOutcome =
  | { readonly ok: false; readonly refusal: 'not-below-you' }
  | {
      readonly ok: true
      readonly delivery: QueueOutcome
      readonly stop: TheStopAMessageGot
      /** The conversation whose answer the turn waits for, on `it-is-waiting-on-an-answer`. */
      readonly askedOf: string | null
      /** ⚑ **F084** — see {@link TheStopItsWordsAsked.ended}. */
      readonly ended?: readonly string[]
      /** ⚑ **F084** — see {@link TheStopItsWordsAsked.stillRunning}. */
      readonly stillRunning?: readonly string[]
      /** ⚑ **F084** — see {@link TheStopItsWordsAsked.provider}. */
      readonly provider?: Provider
    }

/**
 * ⚑ **D-017 · R12 — why a caller may not reach a conversation by that id** (`05` rule 6) — see
 * {@link RuntimeHost.whyItIsOutOfReach}.
 *
 *  - `no-such-agent` — no conversation has that id. ⛔ The ONLY case that word is said about.
 *    ⚑ D-016 · commit 7 · R1 — a label is resolved before it is asked
 *    ({@link RuntimeHost.theConversationAddressed}), and one that names nothing this caller may
 *    reach arrives here as spelled.
 *  - `takes-no-messages` — this app records it and a message cannot start it (a read-only copy, a
 *    provider's own sub-agent, or one this app did not start), while nothing runs in it.
 *  - `outside-its-reach` — it exists and the caller's reach does not admit it: the reach rail
 *    `message_agent` answers with, carried as it was built.
 */
export type OutOfReach = { readonly is: 'no-such-agent' } | { readonly is: 'takes-no-messages' }

/**
 * 🔴 **D-016 · commit 7 · R1 — the reach a door resolves a label by** — see
 * {@link RuntimeHost.theConversationAddressed}. ⚑ **Each door's OWN**, so a label is taken wherever
 * that door serves the id of the conversation it names, and is handed back as spelled wherever that
 * id would not be served.
 *
 *  - `messaging` — `get_agent_status`, `message_agent`, `ask_question`: the reach `list_agents` names
 *    by ({@link RuntimeHost.whyItIsOutOfReach}), which is the reach every rail of theirs reads.
 *  - `interrupting` — `interrupt_agent`: that, or the chain below the caller the door stops
 *    ({@link RuntimeHost.interruptAgent}'s entitlement), which reads no grant.
 *  - `reading` — `read_transcript`: that, or the chain below the caller the door reads, or its own
 *    profile's other conversations (D-024 · R2; {@link RuntimeHost.mayReadTheTranscriptOf}), which
 *    reads no grant either.
 *  - `answering` — `asked_by` (`answer_question`, `pass_question_up`): every owner. ⚑ The door's own
 *    lookup is the entitlement: it matches only askers of questions routed to the caller, and any
 *    other name meets one answer that names those askers alone — so a label resolved for anyone
 *    else tells the caller nothing.
 */
export type TheDoorsReach = 'messaging' | 'interrupting' | 'reading' | 'answering'

/** What an agent's profile name names: see {@link RuntimeHost.theConversationAProfileNames}. */
export type AProfileNames =
  | { readonly is: 'one'; readonly conversation: string }
  | { readonly is: 'several'; readonly profile: string; readonly labels: readonly string[] }
  | null

/**
 * 🔴 **D-022 · R3 — what became of words about a piece, told to the conversation holding it** —
 * `reply_to_parent`'s three words, for a take-back, a close, a new brief and new inputs.
 */
export type TellDelivery =
  /** It was free, or stopped and woken: the words went out as its turn now. */
  | 'sent'
  /** It is mid-turn: the words wait for that turn to end, and go with whatever else is held (D-027). */
  | 'held'
  /** Nothing reached it: {@link Told.whyNotTold} says why, in words a model reads. */
  | 'not-delivered'

/** 🔴 **D-022 · what became of a new brief** — a tell's word, or one of its own two. */
export type NewBriefDelivery =
  | TellDelivery
  /**
   * R1 · its piece's give is still held — for the holder's turn to end, or (D-027) behind a
   * person's command held before it, which goes on its own: the new brief goes out as that give's
   * brief when it is sent; nothing of its own was queued.
   * ⚑ A give that went out as the holder's turn now carrying it — a woken holder's first — is
   * `sent`.
   */
  | 'with-its-give'
  /** R2 · the piece had ended when the words reached its holder: nothing was sent. */
  | 'after-it-ended'

/**
 * ⚑ **What became of words about a piece told to its holder — and, when nothing reached it, why**:
 * {@link whyNotTold} is present only beside `not-delivered`, in words a model reads (never the
 * diagnostic, which goes to the log).
 */
export type Told<D extends NewBriefDelivery = TellDelivery> =
  | { readonly delivery: Exclude<D, 'not-delivered'> }
  | { readonly delivery: 'not-delivered'; readonly whyNotTold: string }
