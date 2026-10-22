import { withNavigationLinks, NAVIGATION_TOOL_NAMES } from './tool-navigation-links'
import { NAVIGATION_LINKS_DESCRIPTION } from '../../shared/links'
import { workerLine } from '../worker-readings'
import {
  WORK_FIELD_WORDS,
  DONE_CONDITION_CHARS,
  WORK_BRIEF_CHARS,
  SAVED_METHOD_CHARS,
} from '../../shared/work-fields'
import { DO_IT_HERE, MOVE_IT } from '../../shared/move-request'
import { themeAgentTools } from '../themes/agent-tools'
import { WORK_SEARCH_SCOPES, workSearchQuery } from '../../shared/work-search'
import {
  pastWorkSearchQuery,
  PAST_WORK_SEARCH_DESCRIPTION,
  pastWorkSearchInWords,
  pastWorkSearchRefusal,
} from '../../shared/past-work-search'
import { WORK_STATE_WORD } from '../../shared/work-state-words'
import {
  WORK_SEARCH_WORDS,
  workSearchInWords,
  workSearchRefusal,
} from '../../shared/work-search-words'
import { THEME_TOOL_NAMES, THEME_TOOL_REASONS } from '../themes/tool-words'
import { refusalReason } from '../../shared/refusals'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { protectedPlaceSaid } from '../../shared/work-folders'
// ⚑ **D-012 · what `read_transcript` reads and how it says it** — see `shared/last-exchange.ts`.
import {
  TURNS_BACK_DEFAULT,
  TURNS_BACK_MAX,
  WORDS_CAP,
  previewOf,
  type AConversation,
  type Exchange,
  type Received,
  type ReceivedInATurn,
  type TranscriptTurn,
  type WhoSentIt,
  type Words,
} from '../../shared/last-exchange'
// ⚑ **582 · the `configured` layer's bound**, read from the module that derives it against the
// bundle it joins rather than written here.
import { OWN_INSTRUCTIONS_CHARS } from '../../shared/own-instructions'
import {
  MAX_EXTERNAL_MCP_GRANTS,
  externalMcpNameRefusal,
  externalMcpUrlRefusal,
} from '../../shared/external-mcp'
import {
  MCP_SERVER_REQUEST_WHO,
  MCP_SERVER_URL_CHARS,
  type McpServerRequestWho,
} from '../../shared/mcp-server-requests'
import {
  FILES_FOUND_LISTED,
  HELD_FORMS_WITH_EXTENSIONS_SAID,
  MADE_FILES_LISTED,
  MAX_RESOURCES_PER_REPLY,
  MOST_FILES_SEARCHED,
  NOT_FOR_A_MODEL_ACT,
  OLDER_FILES_COUNTED,
} from '../../shared/documents'
import {
  AuthUnavailableError,
  CodexSettingsUnusableError,
  NoCodexSignInOnThisComputerError,
  ClaudeUnavailableError,
  ResumeError,
  agentToolStringEnum,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
  transientSetupFailureOf,
  spawnNoWaitClearsOf,
  folderAPersonMustFixOf,
  startRefusalOf,
  startFailureOf,
  type AgentToolAnswer,
  type AgentToolDefinition,
  type AgentToolset,
} from '@brobot2/runtime'
import type {
  AgentCard,
  AgentRecord,
  APieceItHolds,
  Caller,
  EndedPieceDetail,
  FoundFile,
  NewBriefDelivery,
  Told,
  OutOfReach,
  PieceOnTheCard,
  ProfileReport,
  RootOnTheBoard,
  RuntimeHost,
  TakeBackRefused,
  TellDelivery,
  TheStopAMessageGot,
  WaitOnAsked,
  WhoseConversation,
} from './runtime-host'
import {
  MessagingRefused,
  isAMessageRefusal,
  messagePermanenceOf,
  messageRemedyOf,
  messageRetryableOf,
  type MessageRefusal,
} from './message-rails'
import {
  ABriefThatDidNotArrive,
  AGiveThatGaveNothing,
  AStartThatDidNotHappen,
  SessionStillStarting,
  unavailableOf,
} from './session-unavailable'
import { CodexUnavailableError } from './codex-binary'
import {
  type RailPermanence,
  type SpawnRefusal,
  type WhatItRunsOn,
  permanenceOf,
  problemsInItsOwnWords,
  workRequestRefused,
  remedyOf,
  retryableOf,
  stalledPiecesSaid,
} from './spawn-rails'
import { theEffortsSaid, theModelsSaid, type ListsAsLastRead } from './model-rails'
import {
  REPLY_SUMMARY_LIMIT,
  refuseReply,
  replyPermanenceOf,
  replyRemedyOf,
  replyRetryableOf,
  READ_ONE_WITH_READ_DOCUMENT,
  resourcesNamed,
  theAskNamed,
  theLimitItStoppedOn,
  theStallAndItsAsk,
  theStoppedWork,
  type ReplyOutcome,
  type ReplyRefusal,
} from './reply-rails'
import {
  questionPermanenceOf,
  questionRemedyOf,
  questionRetryableOf,
  type QuestionRefusal,
} from './question-rails'
import {
  interruptPermanenceOf,
  interruptRemedyOf,
  interruptRetryableOf,
  type InterruptRefusal,
} from './interrupt-rails'
import {
  AGENT_MESSAGE_KINDS,
  TASK_IS_OPEN,
  TASK_OUTCOMES,
  TASK_STATES as WORK_SEARCH_TASK_STATES,
  // ⚑ **603/609 · the fact each WAIT stands for**, for `pieceText`'s rule that a state name is not
  // one. ⛔ A table rather than a constant since `609`, so a wait added to the family cannot reach a
  // model as a bare word.
  WAITING_STANDS_FOR,
  theWaitIn,
  isAgentMessageKind,
  type AgentMessageKind,
  type PieceRow,
  type StatusLine,
  type TaskOutcome,
} from '../../shared/tasks'
import {
  QUESTION_RECIPIENTS,
  RECIPIENT_MEANS,
  PASS_UP_RECIPIENTS,
  isPassUpRecipient,
  type PassUpRecipient,
  REQUEST_IS_OPEN,
  isQuestionRecipient,
  theChannelRefusalIn,
  type QuestionRecipient,
  type RequestState,
  type VisibleQuestion,
  aPieceNotEndedItsQuestionsUnread,
  aPieceNotEndedWhileAQuestionStarts,
} from '../../shared/questions'
// ⚑ **484 · one phrasing for an actor, imported rather than re-spelled** — `stoppedBy`'s own rule,
// and one COMPOSITION for the clause, shared with the notice a parent is pushed.
import {
  ASKED_TO_STOP,
  askedByClause,
  type WhereAnAskLanded,
  type WhoStoppedIt,
} from '../../shared/how-work-stopped'
// The approved words of an agent tool's answer, kept in one module.
import {
  A_PERSON,
  answerInWords,
  appOnlyRefusalQuote,
  CREATED_UNDER_ITS_PROFILE_NAME,
  DONE,
  HOW_THE_LAST_TURN_ENDED,
  ITS_RULES_ARE_SAVED,
  RULES_PUT_BEFORE_A_PERSON,
  THE_CONVERSATION_THAT_GAVE_YOU_THIS_WORK,
  createdAndNamed,
  tookOnForPerson,
  doneWithThePiece,
  filesHoldingThoseWords,
  handedBackWithItsAnswer,
  heldBy,
  itsInputs,
  keptResources,
  lastAskedToStop,
  noFileHoldsThoseWords,
  theHolderIsNow,
  whatWasMadeForIt,
  windowsReported,
  type WhenItWasAskedToStop,
} from './agent-tool-answer-words'
import type { ResourceRefusal } from '../resources/resources'
// ⚑ **405 · the vocabulary a refusal's permanence is spelled in**, and the guard that says whether a
// value crossing back out of an untyped payload is one of its members.
// ⛔ **425 adds the remedy vocabulary and its guard** — the act a caller is left with. Both words
// cross the same untyped boundary and are read back the same way; see {@link refusalIn}.
import {
  isRailPermanence,
  isRefusalRemedy,
  refusalToldOf,
  type RefusalRemedy,
  type RefusalTold,
} from '../../shared/refusals'
// ⚑ **D-016 · a piece's title bound**, `give_work`'s and `update_work`'s — read, not restated.
// 🔴 **705 · R38, for pieces — a piece is its label beside its title wherever a person may read it**,
// and a tool's receipt is read by one: on the transcript's tool row and in the digest's
// `tool-answered` line, which quotes it.
// ⚑ **D-016 · commit 7 · R3 — and a conversation named by the piece it owns.**
import {
  HOW_A_PIECE_ENDED_SAID,
  PIECE_TITLE_CHARS,
  pieceLine,
  pieceNumbersOf,
  theOwnerOf,
  type WorkThatNamesIt,
} from '../../shared/piece-called'
// ⚑ **D-024 · R3 — when each file was made**, in the clock every agent-facing time is said in.
import { clockTime, clockTimeFrom } from '../../shared/clock'
import {
  PROVIDER_DESCRIPTORS,
  providerDescriptor,
  providerRecord,
  providerSchema,
  type Provider,
} from '@brobot2/shared'
import type { ToolsToldInText } from './factory-text'
import { EVERY_AGENT_THIS_APP_HOLDS } from '../../shared/capabilities'
import {
  PATH_SEGMENT_RULE,
  PROVIDER_NAME,
  hasSomethingToSend,
  isPathSegment,
  type NewAgent,
  type ProviderUsageReading,
} from '../../shared/runtime-ipc'
import { usageWindowWord } from '../../shared/usage-window'
import { aPairInWords, sameModel, type AgentModelChoice } from '../../shared/model-choice'
import { agentStateWords } from '../../shared/agent-state'

/** Where a question goes, in words rather than the recipient's internal name. */
const ROUTED_TO: Readonly<Record<PassUpRecipient, string>> = {
  'the-parent': THE_CONVERSATION_THAT_GAVE_YOU_THIS_WORK,
  'a-person': A_PERSON,
}

/** Where the last ask to stop landed, as the sentence that says it names the three. */
const WHEN_THE_ASK_LANDED: Readonly<
  Record<Exclude<WhereAnAskLanded, 'the-turn-that-ended-last'>, WhenItWasAskedToStop>
> = {
  'no-turn-was-running': 'no-turn-running',
  'a-turn-that-ended-earlier': 'an-earlier-turn',
  'a-turn-that-is-running-now': 'the-turn-running-now',
}

/**
 * 🔴 **The published tools, over a chokepoint that already refuses** (347).
 *
 * ## ⛔ There is not one capability check in this file, and that is the design
 *
 * `341` landed the session-creation chokepoint and its rails, each demonstrated by an actual
 * refusal, and the whole point of that ordering was that a tool would arrive into a door that
 * already says no. ⚑ **So `give_work` hands its arguments to the host's `giveWork`, which asks
 * `admitGive`; it does not ask whether the caller may give.** `169` §1: one rule in two places
 * drifts, and the copy that drifts is always the one further from the thing it protects.
 *
 * ⚑ **`374` did the same for MESSAGING and this file gained no check for that either.**
 * `can_message` is read by `RuntimeHost.assertMayReach`, above the messaging verbs `340` named —
 * `cancelQueuedMessage` is deliberately outside it, and its own docblock says why; what arrives
 * here is a `MessagingRefused` to CLASSIFY.
 *
 * ⛔ **A source census enforces it** — `the-five-tools.test.ts` §6 forbids every
 * `CAPABILITY_FIELDS` key and column in this file, and it extended itself to `374`'s field on the
 * day the field existed, because it is derived from the schema rather than typed out.
 *
 * ⚠️ **What this file DOES contain is translation**, which is not policy: a host that throws is
 * turned into a payload that says refused, a `'no-such-agent'` word is given a sentence, and an
 * argument shape is checked before the door is bothered. The test for whether a line here is a rail
 * is whether removing it could let something through that the chokepoint would have stopped. Nothing
 * here can.
 *
 * ## 🔴 A refusal is a SUCCESSFUL call whose payload says refused
 *
 * `307` measured both halves of this on real children of both providers. A thrown handler becomes
 * transport-shaped `-32603` and *"carries no machine-readable policy meaning"* — the child learns a
 * tool broke. The structured form is a protocol success whose payload denies the request, and both
 * models *"named the rail and obeyed its permanence text"*. ⛔ **So nothing in this file throws a
 * refusal** — ⚠️ **and it does not follow that nothing here throws, which is what this line said
 * until `657`.** A host failure a tool does not classify still propagates, and reaches the model as
 * that broken tool; that is `375`'s ruling (*a teardown that failed is not a policy answer*), and
 * a failed launch was the case it hid. ⚑ Each tool classifies the typed failures it
 * knows — see `guarded`'s own note.
 *
 * ⚑ **The payload shape is `341`'s, carried over MCP unchanged** — `{rail, permanence, retryable,
 * reason, detail}` — because it was fixed at the door precisely so this dispatch would not reinvent
 * it, and because a model that meets one shape everywhere can learn it once. ⚠️ **Every rail
 * vocabulary in this app shares it**, {@link TOOL_REFUSALS} among them, and
 * `what-an-agent-is-told-about-its-work.test.ts` §3 derives sentence uniqueness and pins the
 * deliberately shared-name allowlist from the modules rather than restating its size — so `rail`
 * says which rule stopped a call whichever door built the payload.
 *
 * ⛔ **This said *"Three vocabularies now share it"* until `412`, and it named them.** `405` F8
 * reported the census gap; the count went stale twice over before anybody read it again — the
 * shared payload had reached seven lists and the strongest assertion had reached five. ⚑ **A
 * sentence that names a count is a sentence that goes stale the next time the list moves**, which
 * is the rule {@link TOOL_NAMES}' own note already states one paragraph down, so this one no longer
 * names one.
 *
 * ## ⛔ There is no dispatch tool here, and that is criterion 6
 *
 * See {@link TOOL_NAMES}, which is the enumeration criterion 6's negative is measured against.
 */

/**
 * 🔴 **The MCP server name every one of this app's own tools is published under** (466).
 *
 * ⛔ **It was a bare literal in the toolset's own `return` and nothing else could reach it.** ⚑
 * `466` gave the digest a reader that has to tell one of OUR tool calls from the agent's work:
 * `tool_call.name` arrives QUALIFIED and the two providers spell it differently —
 * `brobot__list_agents` on one, `mcp__brobot__list_agents` on the other — so the only honest
 * reading is `splitQualified` against each provider's own `ToolNaming` and a comparison with this
 * word. ⚠️ **A bare `startsWith('brobot__')` would match one provider and silently miss the
 * other**, which `tool-inventory.ts` already says in as many words about comparing bare names.
 */
export const AGENT_TOOL_SERVER = 'brobot'

/**
 * 🔴 **How to use these tools, said once for every conversation** — the toolset's `instructions`.
 *
 * ⚑ **Claude is handed them with the catalogue**, as the in-process server's `instructions`.
 * 🔴 **D-039 · Codex in front of the first message of each life** — `thisConversationSpans`' tools
 * section, which {@link toolsToldInTextFor} gives on that provider alone: its catalogue is one
 * namespace whose description the app-server caps at `CODEX_NAMESPACE_DESCRIPTION_LIMIT`
 * characters, and these are longer, so a Codex conversation that carried them there could not
 * start (F055).
 *
 * 🔴 **D-016 · commit 7 · R1 — agents address each other by the piece each owns**, said once,
 * second, because every tool that takes an agent takes that label. ⚑ **D-023 · R3** —
 * `update_work`'s clause says what its description, its `resources` and `that-is-your-own-work`
 * say; ⛔ titling is scoped apart, since `the-giver-names-a-piece` refuses it on a piece another
 * conversation gave.
 */
export const AGENT_TOOL_INSTRUCTIONS =
  'These tools reach the app you are running inside. An agent is named by the piece of work it owns: W1.2 means the conversation that owns W1.2, and every tool that takes an agent takes that label as well as its id. create_agent brings an agent into existence, optionally with standing rules; give_work gives an agent a piece of work, and with new: true brings a new agent with none into existence as it gives; when the person asks for something to be done, take_on_work takes it on as a piece of your conversation’s own work, so the person can see it and what you give out for it hangs under it; update_work says where a piece stands and keeps files for it — any piece you hold, your own conversation’s work included, or one you gave — titles your own conversation’s work or a piece you gave, and changes the brief of a piece you gave or took on for the person; a root’s brief stays as recorded. Only the giver closes a piece. A refusal is a successful call whose answer names the rule that stopped it, whether that rule is permanent, and whether retrying could ever help — read it rather than retrying a permanent one.'

/**
 * 🔴 **D-039 · the tools' instructions a launch says in its conversation's own text, or `undefined`**
 * — {@link AGENT_TOOL_INSTRUCTIONS} under {@link AGENT_TOOL_SERVER}'s name on Codex, whose catalogue
 * cannot hold them; nothing on Claude, which is handed them with its catalogue.
 *
 * ⚑ **The one decision, for every composition of a launch's text**: `main/index.ts` hands it to
 * `thisConversationSpans`. ⛔ A copy of that composition (a smoke's) hands it too, or it measures a
 * prompt the product does not send.
 */
export function toolsToldInTextFor(provider: Provider): ToolsToldInText | undefined {
  return providerDescriptor(provider).toolInstructionsInText
    ? { server: AGENT_TOOL_SERVER, instructions: AGENT_TOOL_INSTRUCTIONS }
    : undefined
}

/**
 * ⛔ **The published inventory, as data** (347) — criterion 6's *"a negative needs a search shape"*.
 *
 * ⚑ **A claim that this app publishes no dispatch tool is worth exactly as much as the enumeration
 * behind it**, and a `grep` for the word `dispatch` is not one: it could not have found a tool
 * called `assign_work`, `delegate`, `hand_off` or `enqueue_task`. This constant is the shape the
 * negative is measured against — the complete set of names offered to any model — so the assertion
 * is *"the inventory is exactly this list"* rather than *"we did not find a bad one"*. ⚠️ **Not
 * *"these five"*, which it said until `380` published a sixth**: a sentence that names a count is a
 * sentence that goes stale the next time the list moves, and the census reads the list.
 */
export const TOOL_NAMES = [
  'list_agents',
  'get_agent_status',
  /**
   * 🔴 **D-016 · the GIVE — a piece of work, to an agent, by its profile** (plan ruling 1).
   *
   * ⛔ **It took `spawn_agent`'s place in this list, and it is a new act rather than a rename.**
   * `spawn_agent` opened a conversation and sent it nothing; this one sends the work, and starts a
   * conversation only when the giver has none with that agent — so no tool offers a second one.
   * ⚑ **It is the one verb here that hands anybody something to do**: §5's *"no published tool
   * queues work"* census is about every OTHER name on this list, and this one is its exception.
   */
  'give_work',
  'message_agent',
  /**
   * 🔴 **The reader of what this app keeps for a piece** (380 as the document registry's; a
   * resource since D-016).
   *
   * ⛔ **`the-five-tools.test.ts` keeps its name and its assertions are DERIVED**, so the one thing
   * that changed there is a count. Renaming that file would have cost every anchor that points into
   * it — the mutation table's rows, four dispatches' citations — to correct an arithmetic fact its
   * own `expect(offered).toEqual([...TOOL_NAMES])` already states better than its title does.
   *
   * ⚠️ **It is a READER, so §5's *"no published tool queues work"* census is untouched by it**: it
   * names exactly which resource it wants and returns its content. It hands nobody anything to do.
   */
  'read_document',
  /**
   * 🔴 **The seventh — S2, and the one the PO held the worker text for** (393, HO-007 S2, HO-017 §3).
   *
   * ⛔ **It takes no destination and there is no spelling of one it accepts.** HO-015 §1.3: *"the
   * runtime derives and validates the destination from the durable task edge. The model names which
   * task it is finishing, never who to send it to."* ⚑ A piece's giver is on its row (D-016), and the
   * refusal for an addressing argument is a rail of its own shape — see the tool's own note on `371`.
   */
  'reply_to_parent',
  /**
   * ⚑ **The eighth, and it is a READER like `read_document`** — it hands nobody anything to do, so
   * §5's *"no published tool queues work"* census is untouched by it.
   *
   * 🔴 **It exists twice over, and the response doc says both reasons out loud.** A child could not
   * learn the name `reply_to_parent` takes any other way — and a parent cannot see `393` §5's absence
   * any other way, because every other reader in this app reads LIVE SLOTS and the sequence that
   * produces the absence ends the conversation.
   *
   * ⚠️ **The first half stopped being true in `412` and the tool did not stop being needed.** The
   * turn that gives a piece names its label (D-016 · R4: the sender line, and `messageNamingThePiece`
   * at its foot), so a worker no longer has to think to call this to finish its FIRST piece. ⛔ It
   * still has to call it to finish one it was given before a restart, to see work it holds that it
   * was told about in a turn it can no longer see, and to see the work it gave OUT — which is the
   * half `410` F1 never touched.
   */
  'list_tasks',
  /**
   * 🔴 **The ninth — S4, and the only verb by which an agent settles anything on another
   * conversation's behalf** (394, HO-007 S4, criteria 9 and 10).
   *
   * ⛔ **It answers questions and never permissions.** `RuntimeHost.answerQuestion` finds both — the
   * scope has to contain what it refuses, or the refusal would be *"there is nothing here"* — and
   * `admitAnswer` refuses a permission BY NAME and permanently. ⚑ **Knowledge escalates; authority
   * does not.**
   *
   * ⚠️ **It is not a READER**, so §5's *"no published tool queues work"* census applies to it: it
   * puts an answer into a conversation that is blocked, which unblocks a turn and hands nobody
   * anything new to do. The census's own test is whether a name carrying a forbidden word takes no
   * arguments; this one takes two and carries none.
   */
  'answer_question',
  /**
   * 🔴 **The tenth — S5** (395, HO-007 S5).
   *
   * ⛔ **It stops what a conversation below the caller is doing** — one it started, or one further
   * down that chain (D-014). No grant is asked: the chain is the whole entitlement.
   *
   * ⚠️ **It is NOT a READER**, so §5's *"no published tool queues work"* census applies to it. It
   * hands nobody anything to do: it takes away the thing that was being done.
   *
   * 🔴 **And it answers `asked`, never `stopped`.** The two providers differ in kind here — Claude
   * forces the local terminal, Codex asks and awaits an answer the provider may never send — so a tool that
   * claimed the work had ended would be false on one of them. See {@link RuntimeHost.interruptAgent}.
   */
  'interrupt_agent',
  /**
   * 🔴 **The eleventh, and it is a READER like `read_document` and `list_tasks`** (396, HO-007 S6).
   *
   * ⛔ **It exists because `394` recorded a routing it could not deliver.** `deliverQuestion` returns
   * silently when the parent has no live slot — the routing row is written anyway, deliberately —
   * so a parent that was not running when its child asked comes back to a question it has never
   * been told about. ⚑ Without this reader it can never answer that question, and the only way back
   * is a person answering the card on the child.
   *
   * ⚠️ **It carries the question's WORDS and not only its id**, and that is the difference between
   * a reader and a list: `answer_question` takes one entry per PART, and the parts are on the
   * request. ⛔ **Never a permission's words** — see {@link RuntimeHost.questionsWaitingOn} for the
   * two narrowings, and why one of them alone would have a hole in it.
   *
   * ⚑ **It hands nobody anything to do**, so §5's *"no published tool queues work"* census is
   * untouched by it.
   */
  'list_questions',
  /**
   * 🔴 **The twelfth, and the verb `417` left this app without** (419, HO-023 §2.4 / §3).
   *
   * ⛔ **`give_work` refuses a name no identity has unless it is asked for a new one** (D-016 · R3).
   * ⚑ This is the deliberate, separate act that makes one exist with standing rules or a chosen
   * name, rather than a launcher field that created an identity as a side effect of starting a
   * conversation.
   *
   * ⚠️ **It is NOT a READER, so §5's *"no published tool queues work"* census applies to it** — and
   * it passes for the strongest reason on the list: it hands nobody anything to do because there is
   * nobody yet. It writes one row and starts nothing.
   *
   * 🔴 **And it is the door HO-023 §2.4 says was missing.** A person asked for another agent, the
   * only legal answer was the identity already running, and the product reached for the illegitimate
   * one and ended a live conversation. ⛔ **The live-session rail was right**; this is the capability
   * whose absence made obeying it impossible.
   */
  'create_agent',
  /**
   * 🔴 **The thirteenth — a parent taking work back** (429, HO-023 §4.3 + §5).
   *
   * ⛔ **`422` §3 measured that this roster had no withdraw verb at all**, and HO-023 §4.3 is why
   * that mattered: *"a parent whose only routes are ask, cut in, or end will eventually end, and §5
   * is what that looks like."* ⚑ Every other way out of an open task destroys something —
   * `interrupt_agent` throws away a turn — and the one thing a parent actually wanted was to stop
   * owing the work. ⚑ **D-017 · since `end_agent` went, it is also how a parent stops an agent**
   * (`05` rule 2): interrupt its turn, and take its work back.
   *
   * ⚠️ **It is NOT a READER, so §5's *"no published tool queues work"* census applies to it**, and
   * it passes in the strongest direction on the list: it hands nobody anything to do, it takes
   * something away. ⛔ The census's own test is whether a name carrying a forbidden word takes no
   * arguments; this one takes one and carries none.
   *
   * 🔴 **It is the act a stall names**: *"withdraw then reassign is legitimate;
   * reassign without withdrawing is the duplicate."* ⚑ A give is not refused over a stalled piece
   * — its answer names that piece, and this verb is how the giver takes it back.
   */
  'withdraw_task',
  // ⛔ **APPENDED and never inserted** (437) — five tests pin the index of a name in this list, so a
  // new member goes on the end whatever it is about.
  //
  // 🔴 **611 · RENAMED IN PLACE, and a rename is not an insertion** (HO-088 §2). ⛔ It was
  // `ask_parent` until the verb took a recipient; the name said which edge the question travelled,
  // and the verb now has two — so the name was a claim that had stopped being true
  // (`a-column-name-is-a-claim`, at a tool). ⚑ **The POSITION is unchanged**, which is what the
  // rule above is about: every index a test pins still names the same verb.
  'ask_question',
  /**
   * 🔴 **The first verb here whose subject is an IDENTITY rather than a conversation** (488,
   * HO-020 §"It carries", HO-031 §2.3).
   *
   * ⛔ **Named by KIND and not by position** (`488 relay 1`, `458`'s standing rule). ⚠️ Every member
   * above opens with an ordinal, and an ordinal says where today's inventory happens to put a verb
   * rather than what the verb is — which is the half a reader needs and the half that cannot go
   * stale.
   *
   * ⛔ **APPENDED and never inserted**, on the standing rule one name above.
   *
   * ## ⚑ It is a READER, so §5's *"no published tool queues work"* census is untouched by it
   *
   * ⛔ It takes no arguments at all, so the population it names is every identity this app holds, and there is no spelling of anything a caller could put
   * in front of it.
   *
   * ## 🔴 Why `list_agents` could not answer this and no narrowing of it ever will
   *
   * ⚠️ **`467`'s sentence, one population over:** *"a conversation with nothing waiting on anybody
   * produces no queue row at all"* — and **an identity that has never run produces no
   * conversation**. ⛔ `list_agents` enumerates this app's live slots; a roster folded out of them
   * under-reports exactly the identities nobody has started, which is the set *who can I hire* is
   * about. ⚑ BroBot's first session answered it by reading `brobot2.sqlite` with a shell.
   *
   * ⚠️ **And it is not a launch-time line.** It says which names this app holds an identity for,
   * and what each one is NOW rather than at the moment the conversation started.
   */
  'list_profiles',
  /**
   * 🔴 **The `configured` layer's agent-facing door** (582, `HO-009` §2.2, `HO-063` gap 4).
   *
   * ⛔ **APPENDED and never inserted**, on this list's standing rule: seven assertions in
   * `the-five-tools.test.ts` pin a tool by INDEX, and two mutation anchors quote this list's head.
   *
   * ## ⚑ One verb with two arms, and the grant decides which a caller may take
   *
   * ⚠️ **Not two tools.** The thing being asked for is identical — *these rules, for that agent,
   * for this reason* — and only the AUTHORITY differs. ⛔ Two verbs would make the wide one
   * discoverable as a separate name, and a model that met a refusal on one would reach for the
   * other; one verb with one argument makes the ladder a single question with a single answer.
   *
   * ## ⛔ It is NOT a reader, so §5's *"no published tool queues work"* census applies
   *
   * ⚑ It hands nobody anything to do: the proposal arm parks a decision on a PERSON, and the relay
   * arm writes a row. ⚠️ Neither opens a task, and neither sends a message.
   */
  'propose_agent_rules',
  /**
   * 🔴 **611 · carry a question one hop further, in the words it was asked in** (HO-088 §3.2).
   *
   * ⛔ **APPENDED and never inserted**, on the standing rule above.
   *
   * ## ⚑ It is not a READER and not a queuer either, and §5's census is untouched by it
   *
   * ⚠️ **It hands nobody work**: what it produces is a QUESTION, which opens no task — `437`'s own
   * property, and the reason `deliverQuestion` calls `queueMessage` as {@link THE_APP_ITSELF}.
   * ⛔ Its name carries none of the census's forbidden words.
   *
   * ## 🔴 Why it is a second verb rather than an argument on `ask_question`
   *
   * ⛔ **The two differ in where the WORDS come from, and that is the whole ruling.**
   * `ask_question` takes the caller's own words; this one takes none at all and reads the original
   * asker's row. ⚑ **An optional *"carry this one instead"* argument on one verb would make the
   * question field mean two things** — *my question* with the flag absent and *ignored* with it
   * present — which is a field a model has to be right about rather than a verb it chooses.
   *
   * ⚠️ **And it is what makes §3.1 checkable**: there is no field to reword the question in.
   */
  'pass_question_up',
  // 🔴 **D-009 · F012** — the asker takes back a question it asked (ruling 5). ⚠️ Appended: the
  // roster's order is pinned by index.
  'withdraw_question',
  // 🔴 **D-012 · a giver reads a conversation below it** (proposal §6.5) — its last exchange and its
  // turns, a few back or by a search. ⚑ **D-024 · R2 — and its own profile's other conversations.**
  // ⚠️ A READER, like `read_document`: it hands nobody anything.
  'read_transcript',
  /**
   * 🔴 **D-016 · name a piece, say where it stands, give it a new brief, close it, or keep files for
   * it** (plan ruling 7; R1, R2).
   *
   * ⛔ **APPENDED and never inserted**, on this list's standing rule. ⚑ A title, a status line and
   * the files a piece's owner made for it are written down and sent to nobody; a new brief, a close
   * and the files its giver hands over are written down and reach the agent holding the piece — the
   * new brief as a message of its own, in the giver's words — and wake it, as `message_agent` and
   * `withdraw_task` wake one. ⚠️ **§5's census is untouched by it**: it names the piece, so the
   * agent anything reaches is the one holding it, and it gives no piece and starts no conversation.
   */
  'update_work',
  /**
   * 🔴 **D-016 · commit 6 · a request the person makes, taken on as a piece that waits on them**
   * (plan ruling 6; R1).
   *
   * ⛔ **APPENDED and never inserted**, on this list's standing rule. ⚑ It opens a piece under the
   * caller's own root, given by the person, and hands nobody anything: **§5's *"no published tool
   * queues work"* census is untouched by it** — it names no agent and no piece, sends nothing and
   * queues nothing; its only subject is the caller's own work.
   */
  'take_on_work',
  'search_work',
  /**
   * 🔴 **D-037 · find the files this app keeps — on the caller's tree or everywhere** (F048).
   *
   * ⛔ **APPENDED, on this list's standing rule, and a READER** like `read_document`: it hands nobody
   * anything to do, so §5's census is untouched by it. ⚑ Kept files are the work's shared
   * documentation, so an agent asked to look into something can first find what another already
   * wrote.
   */
  'find_files',
  /**
   * Brings an archived conversation back to the lists, as a person's Restore does. It sends
   * nothing of its own, so it hands nobody anything to do: a conversation that held messages or a
   * schedule when it was archived carries on with them.
   */
  'restore_agent',
  /**
   * Asks the person to register an external MCP server. It writes a request and contacts nothing;
   * only the person's press registers anything. It hands nobody work.
   */
  'request_mcp_server',
  /**
   * Asks the person to do something, as a to-do in their queue, with files. It writes a request
   * and hands nobody work: the person answers Done or Can't do it, and the agent that asked is told.
   */
  'request_action',
  ...THEME_TOOL_NAMES,
  'search_past_work',
  'read_agent_rules',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/**
 * ⛔ **The refusals the TOOLS own, as distinct from the rails the DOOR owns** (347).
 *
 * ⚠️ **Deliberately a separate vocabulary from `SPAWN_RAILS`, and deliberately the same payload.**
 * A rail is a rule about creating a session; these are answers about reaching one that already
 * exists, and folding them into `SPAWN_RAILS` would put words in a list whose census asserts every
 * member is demonstrated by a spawn refusal. What they SHARE is the shape and the permanence
 * vocabulary, so a model meets one grammar everywhere.
 */
export const TOOL_REFUSALS = [
  'theme-invalid',
  'theme-is-built-in',
  'theme-exists',
  'theme-unknown',
  'theme-too-large',
  /**
   * ⛔ **Unknown and not-yours are ONE answer, on purpose.** Two answers would make every reader in
   * this file an enumerator — a caller could walk ids and learn which exist from the shape of the
   * refusal. 341's entitlement-before-existence ruling, one door over.
   */
  'no-such-agent',
  /**
   * ⚑ **D-017 · R12 — a conversation this app records that a message cannot start**: a read-only
   * copy restored from a bundle, a provider's own sub-agent (it has no input end), or one this app
   * did not start — a person's own, swept in from their home, or one found in a provider home
   * (`aRowADeliveryCanStart`). ⛔ `no-such-agent` is said only about an id no conversation has, so
   * this is its own word. ⚠️ While a person has one of them open it is running, and reachable like
   * any other; this is about the rest of the time.
   */
  'that-conversation-takes-no-messages',
  'malformed-request',
  'agent-cannot-take-a-message',
  /**
   * 🔴 **A launch in flight** — split out of `agent-cannot-take-a-message` (650, from `643` F2).
   *
   * ⛔ **It is `INTERRUPT_RAILS`' word, shared on purpose**, and the census that allows it is
   * `DELIBERATELY_SHARED` in `what-an-agent-is-told-about-its-work.test.ts`: one fact — the
   * conversation is reserved and its provider has not arrived — gets one word at every door that
   * can meet it, with one permanence and one remedy. ⚑ `374`'s rule read both ways: a model must not
   * see one word mean two things, and it must not have to learn two spellings of one thing.
   *
   * 🔴 **Its producers are `message_agent`'s catch**, from the {@link SessionStillStarting} that
   * `RuntimeHost.sessionFor` throws, **`RuntimeHost.takeBackPiece` since `657`**, for a piece whose
   * owner's launch is in flight, **`RuntimeHost.updateWork`'s close since D-016**, for the same
   * piece, **and `RuntimeHost.updateWork`'s new brief of a piece whose give still waits, since
   * D-022 · R1** — the row would land only after the start, which may already have handed the give
   * over. ⚠️ **Only when the reservation is NOT being closed**: a launch a person Closed has
   * `session === null` too, will never come up, and stays in the catch-all (at `withdraw_task`,
   * `not-a-piece-you-gave`; at `update_work`, `no-piece-by-that-name`) — and `interruptAgent` reads
   * it as an ending since `650`, so the word means *a launch in flight* at every door that meets it.
   *
   * ⛔ **Before `650` the fold priced it `until-a-person-changes-it`** and told the caller *"a person
   * has to put that conversation right"*; the launch then landed and the identical call was
   * admitted. `650`'s probe measured exactly that, through the tool.
   */
  'that-conversation-has-not-started',
  // ⛔ **657 · `agent-started-a-turn-first` stood here from `650` to `657`, and is RETIRED** — not
  // moved. ⚑ It was the honest word for a race: a message read its receiver idle, awaited, and lost
  // the handover to another sender's turn. ⚠️ **`657` made that a HOLD, not a refusal**
  // (`RuntimeHost.queueAs`): the loser goes back through every gate against the busy conversation
  // and is held, or refused by the rail that is true then — so no call site produces this word any
  // more, and a word nothing reaches is a word nothing measures. Old ledger rows keep it verbatim;
  // `tool_refused.rail` is a string on purpose.
  /**
   * 🔴 **You are that agent** (424, from `422`'s second flatly-false rail).
   *
   * ⛔ **Split out of `agent-cannot-take-a-message`, which folded it and promised a retry.** `422`
   * measured the whole path: `list_agents` advertises the caller's own id, {@link
   * RuntimeHost.agentCard} admits it — deliberately, because a caller is entitled to be told about
   * itself — and `requireToCommand` then refuses a session commanding itself, for ever. ⚑ **So a
   * model could address its own real, advertised id and be told `while-this-holds · retryable:
   * true` every time**, with no verb anywhere in the roster that could make that id commandable.
   *
   * ⚠️ **`permanent`, and it is the strong claim it looks like.** No grant widens this, no person
   * settings screen changes it, and no later state of the world makes a conversation able to send
   * itself a message. ⛔ *"Change the call, not the world"* is exactly the remedy: the words were the
   * caller's own to act on.
   *
   * ⚑ **Asked in the TOOL and not in the host**, beside the entitlement question that is already
   * asked there: the tool is the only layer that knows which session its toolset was built for, and
   * `me` is minted from it rather than taken from an argument.
   */
  'that-agent-is-you',
  /** `message_agent` asked to interrupt an agent that is not below the sender, which is who may be interrupted. */
  'that-agent-is-not-below-you',
  /**
   * ⛔ **The global kill switch is off** (419, brief §5) — the same word `SPAWN_RAILS` uses, on a
   * different door.
   *
   * ⚠️ **The same word keeps the same meaning across its deliberate owners.** A model that has
   * met `spawning-disabled` from `give_work` has already learned what it means and what undoes it;
   * another spelling here would be another thing to learn about the switch a person threw.
   *
   * 🔴 **The brief asked whether creating should meet this rail at all, and the argument is in
   * {@link RuntimeHost.createAgentFor}**: creating is not spawning, and with the switch off creating
   * can only ever produce an identity nobody can start — the durable empty row criterion 12 exists
   * to prevent, arriving in the one state a person entered by asking the app to stop.
   */
  'spawning-disabled',
  /**
   * 🔴 **657 · the start was admitted and its conversation did not start** (`650` F2).
   *
   * ⛔ **Not a `SPAWN_RAILS` member, and that is `341`'s ruling kept rather than bent**: admission
   * creates nothing, the launch happens after it, and `RuntimeHost.giveWork` still THROWS when
   * the launch fails — *"dressing them as one would tell a caller a policy stopped it when the disk
   * did."* ⚑ **What changed is that `give_work` classifies the throw**, the way `message_agent`
   * classifies `queueMessage`'s: until `657` it reached the model as a broken tool, the adapter's
   * `isError`, with the host's raw text. The sentence says no rule refused it.
   *
   * ⚠️ **Only the failures a caller must not simply retry**, each named by a closed reason in
   * `detail` rather than by the host's text, which can carry a path or an install instruction: a
   * launch somebody ended while it was starting, the app shutting down, a sign-in or config the
   * provider's home cannot use. ⚠️ **A provider binary this build cannot run was here until `716`**
   * — R67 gave it `agent-could-not-be-started`, one word for a missing program on both providers.
   * ⚑ **On `give_work` a reservation has no owner a window could Close**, so what stopped it is this
   * app shutting down or a person's own act on the conversation — and a new give is then a new
   * decision, not a retry (review of `657`). ⛔ A launch that simply took too long is NOT here — see the next
   * word — and anything this tool does not recognise still propagates.
   *
   * 🔴 **D-039 · R2 — and a start whose provider never answered it in a way this app will run**
   * (`StartFailed`: its process ended first, or its answer failed the adapter's checks) — a broken
   * tool until D-039, with up to 500 bytes of the child's stderr in it. ⚑ The closed reason is
   * `its-provider-could-not-be-started`; the diagnostic goes to the log.
   */
  'agent-did-not-start',
  /**
   * 🔴 **657 · the start was admitted and its provider did not answer in time.**
   *
   * ⚑ **Its own word because its permanence differs**: nothing about the state needs a person — the
   * timed-out launch is stopped and its reservation abandoned, so the same call is a new launch
   * that can succeed. ⛔ Folded into the word above it would carry `until-a-person-changes-it`
   * beside the host's own *"Try again"*, which is one payload contradicting itself. ⚠️ **The
   * measured real case** (`100`/`102`): a handshake that normally answers in under a second.
   */
  'agent-took-too-long-to-start',
  /**
   * 🔴 **D-016 · a give found a conversation with that agent still STARTING, and that start did
   * not happen** — `give_work` alone meets it.
   *
   * ⚑ **Two gives in one tick** (Codex makes parallel tool calls): the second finds the first one's
   * reservation, queues its brief behind that start, and the start fails — the first give answers
   * the launch's own word. ⛔ **The message door's `no-such-agent` would be false here twice over**:
   * the caller named a profile, not the id, and the identical give now finds no conversation and
   * starts a new one, so nothing about it is permanent. ⚠️ The reason the start failed is the other
   * call's to say; this one knows only that nothing came up.
   */
  'the-start-it-waited-on-did-not-happen',
  /**
   * 🔴 **707 · R39, extended — the start was admitted and the MACHINE ran short of what a process
   * needs** (`705` F-2): descriptors (`EMFILE`, `ENFILE`), a process slot (`EAGAIN`) or memory
   * (`ENOMEM`), each gone again the moment something else lets go.
   *
   * ⛔ **Until `707` this was a BROKEN TOOL** — *"<tool> failed: …"*, `isError`, no word at all —
   * on both providers: Claude's start rejected with the SDK's `TypeError` (Codex's carried the errno
   * since `705`, and nothing here read it), and Claude's start after a refusal that came with its
   * pipes made handed back a handle, so the spawn said `ok` about a conversation whose CLI never ran
   * (`packages/runtime/test/the-errno-a-start-carries.test.ts`).
   *
   * ⚑ **Its own word, beside the wake's** (`that-conversation-could-not-be-woken-just-now`): the same
   * fact at the other door, in that door's words — a give starts a conversation, a wake brings one
   * back. ⚑ **Chosen by the errno's CODE** (`transientSetupFailureOf`), never the provider's
   * text, and only for what the words above it do not already name. ⛔ **It says what to do and never
   * that it will work**: a machine that stays short keeps refusing, and the sentence says *usually*.
   */
  'agent-could-not-start-just-now',
  /**
   * 🔴 **710 · R51 — the start was admitted and its provider's program could NOT be run, for a
   * reason no wait clears** (`707` F-2): the program is not there (`ENOENT`), not runnable
   * (`EACCES`, `EPERM`, `ENOEXEC`), not a path at all (`ENOTDIR` — the packaged app's binary left
   * inside `app.asar`), or the folder the child was to run in is gone (`ENOENT` again: Node names
   * the program either way).
   *
   * ⛔ **Until `710` this was a BROKEN TOOL** — *"<tool> failed: spawn /…/claude ENOENT"*,
   * `isError`, with the host's path in it — and until `707` Claude's pipes-made arm was worse: its
   * start handed back a handle and the spawn said `ok` about a CLI that never ran.
   *
   * ⚑ **Its own word, and the wake's permanent one is its mirror**
   * (`that-conversation-could-not-be-resumed`): the same fact at the other door, in that door's words.
   * ⛔ **Never `agent-did-not-start`**, whose sentence says only *"the detail says why"* — R51 asks for
   * a word that says what is wrong in words — ⛔ **and never the shortage word above it**: chosen by
   * the errno's CODE (`spawnNoWaitClearsOf`), which answers only a code a wait does not clear, and
   * only for a SPAWN (`syscall`).
   *
   * 🔴 **716 · R66 and R67 — every start a person must fix**: a program missing before any spawn
   * (Codex's `CodexUnavailableError`, which was `agent-did-not-start` until `716`; Claude's
   * `ClaudeUnavailableError`, which was a broken tool), and a FOLDER the host could not make or write
   * (`folderAPersonMustFixOf`, a broken tool until `716`). ⚑ **The sentence says which, in words**:
   * this word's own names the program, and a folder is told {@link A_FOLDER_COULD_NOT_BE_MADE} in its
   * place — so a folder is still never called a program that could not run.
   *
   * 🔴 **D-039 · R2 — and a start its PROVIDER refused** (`StartRefused`: Codex refusing
   * `thread/start`, F055), told {@link A_PROVIDER_REFUSED_THE_START} with the provider's words in the
   * detail. ⛔ Until D-039 a broken tool: *"give_work failed: {"code":-32600,…}"*.
   */
  'agent-could-not-be-started',
  /**
   * 🔴 **The caller does not hold `canCreateAgents`** (419, HO-020 §4) — every agent does by
   * default, so this is a narrowing a person made.
   *
   * ⚠️ **Asked BEFORE the name is looked at**, which is 341's entitlement-before-existence ruling:
   * a caller that may not create must not be able to learn which identities exist from which refusal
   * it gets back.
   */
  'may-not-create-agents',
  /**
   * ⛔ **An identity by that name already exists, in some spelling** (419).
   *
   * ⚠️ **A refusal and never an adoption.** `Worker` and `worker` are one identity (238) — the fold
   * is ASCII-only and SQLite's `lower()` matches it exactly — so a creation naming the second when
   * the first exists would hand the caller an agent it did not make, with whatever grants a person
   * had already given it. ⚑ The detail names the FOLDED spelling, because that is the row that
   * exists.
   *
   * 🔴 **`agent-name-taken` alone is `permanent` among these neighbouring rails.** The others
   * describe a world that can change; this one describes the arguments: the same call will name the
   * same taken name forever, and the remedy is a different name.
   */
  'agent-name-taken',
  /** A service is asked for while a person has services off: nothing is made. */
  'services-are-off-so-none-is-made',
  /**
   * 🔴 **The name does not name a piece you gave — to that agent, where the call names one** (429
   * as a task; a piece since D-016).
   *
   * ⛔ **One answer for the causes enumerated here, and the fold is `reply-rails.ts`' argument read
   * from the giver's end**: the name names nothing anywhere, it names a piece somebody else gave, it
   * names a piece you gave a DIFFERENT agent, or it is a string this app never minted.
   *
   * ⚑ **The entitlement is STRUCTURAL rather than ordered.** The lookup asks the piece's own giver —
   * the caller, or a conversation it stands for — and, for a follow-up, the conversation holding it.
   * ⛔ **So two answers were never available to get wrong**, which is what
   * `refuse-on-entitlement-before-refusing-on-existence` asks for.
   *
   * ⚠️ **`permanent`**: a label or id that names nothing of yours today will not start naming
   * something. ⛔ *Change the call, not the world* — and `list_tasks` is where the right label is,
   * which the sentence says.
   *
   * 🔴 **A different WORD from `no-piece-by-that-name`, deliberately** (374's rule): this one's
   * subject is *a piece YOU gave*, and the word says so.
   */
  'not-a-piece-you-gave',
  /**
   * 🔴 **That piece was already answered, so there is nothing left to take back** (429 as a task;
   * `withdraw_task` alone meets it since D-016).
   *
   * ⛔ **HO-023 §4.3's line, kept**: *"withdraw then reassign is legitimate"* — for work that is still
   * open. ⚑ **Taking back work somebody already did is a different claim about history**, so an
   * answered piece is refused, and the refusal NAMES what answered it — HO-023 §5's second clause
   * and the fact a giver acts on: the label, the outcome the owner gave, and the resources its reply
   * handed in.
   *
   * ⚠️ **`permanent`**: `answered` is terminal. No person, no grant and no later state of the world
   * un-answers a piece. ⚑ Giving the same words as new work is a DIFFERENT call — `give_work` — which
   * is what `permanent` already tells a caller.
   */
  'that-piece-was-already-answered',
  /**
   * ⛔ **That piece has already been taken back** (429) — `withdraw_task` alone meets it.
   *
   * ⚑ **A refusal rather than a silent success, and `393` §4.3 is the precedent one verb over.** A
   * second taking back has nothing to close; answering *"taken back"* would tell a giver that this
   * call did something, and the row it would be reading is one it wrote a minute ago.
   *
   * ⚠️ **Its own word rather than a `state` field on the rail above**, because the two are different
   * claims about history: a giver told *that was already answered* about work it took back itself
   * would go looking for a reply that does not exist.
   *
   * ⛔ **`permanent`.** A piece taken back has ended and there is no door back to open.
   */
  'that-piece-was-already-taken-back',
  /**
   * 🔴 **The message carrying that work is on the wire right now** (429) — said by `withdraw_task`,
   * and since D-016 by `update_work`'s close: a brief or a new brief of the piece is mid-flight.
   *
   * ⛔ **The one arm of each that can be refused for a condition that CLEARS**, and it is
   * `cancelQueuedMessage`'s own shipped ruling carried up to this door: *"a flush already in flight
   * cannot be cancelled, and saying otherwise would be a lie in the ledger."* ⚠️ Taking the message
   * out at that instant does not stop the send — `runFlush` captured the text into a local before it
   * suspended — so the transcript would hold `cancelled` and `sent` for one message.
   *
   * ⚑ **The alternative was to close the task anyway and let the words go**, and it is worse: the
   * child would be handed a turn naming a task that is already `withdrawn`, and its
   * `reply_to_parent` would meet `task-already-ended` for work it was told to do one second
   * earlier.
   *
   * ## ⚑ `while-this-holds`, and the remedy is TRUE rather than hopeful
   *
   * ⛔ **The flush ends within one turn boundary**, and when it does the message has gone — the
   * piece is `working`, and the same call finds nothing of it on the wire. ⚠️ So *the same call once
   * this settles* is not a promise about the world improving; **it is a promise that the other arm
   * exists**, and this is the only rail in this file whose retry lands somewhere other than where it
   * started.
   */
  'that-work-is-being-sent',
  /**
   * A piece could not be taken back or closed because a conversation holding a copy passed up of a
   * question about it is starting: that copy could not end in the same transaction, so nothing was
   * done. `while-this-holds`: the start lands or fails within a launch's bound, and the same call
   * then ends the piece and the copy together.
   */
  'a-conversation-with-its-questions-is-starting',
  /**
   * A piece could not be taken back or closed because the questions about it, or the copies passed
   * up of them, could not all be read: a copy might have stayed open after the piece ended, so
   * nothing was done. `while-this-holds`: a read that failed once may pass the next time, and the
   * words tell the caller to ask a person if it does not.
   */
  'its-questions-could-not-all-be-read',
  /** The host could not establish the fixed authority needed for a rule operation. */
  'may-not-write-rules',
  /**
   * 🔴 **The caller may ASK, and claimed it did not have to** (582).
   *
   * ⛔ **Its own rail and deliberately not `may-not-write-rules` reused**, because the two carry
   * completely different news: that one means *nothing happened and nothing will until somebody
   * grants you this*; this one means *your request is fine, and the shortcut you took is not
   * yours*. ⚑ A caller told the first would stop asking, which is the opposite of what it should do.
   *
   * ⚠️ **It refuses the CALL rather than downgrading it**, and that is the ruling: silently turning
   * a relay into a proposal would tell a model its claim had been taken when this app had decided
   * not to trust it — `371`'s disclosure defect, on the one argument where the claim is the whole
   * authorization.
   */
  'may-not-relay-a-rule',
  /**
   * 🔴 **628 · the caller named work it HOLDS, to the conversation that gave it** (`HO-095` §3.1 ·
   * §3.2).
   *
   * ## ⛔ The measurement, and it is a chain of five
   *
   * ⚠️ **A project manager was told by BroBot to send its plan with `message_agent`.** `HO-095` §3
   * follows what that cost: the call was refused as not a task she gave (its word until D-016), she retried
   * differently and it went as a plain message, **no question was recorded**, her conversation
   * showed *idle* while she waited, the stall detector raised a false alarm, BroBot spent a turn
   * disproving it, and BroBot then wrote a false lesson into its own permanent memory.
   *
   * ## 🔴 Its own word, and `that-agent-is-you` is the precedent
   *
   * ⛔ **That refusal was TRUE of her call and said nothing she could act on.**
   * ⚑ `424` split `that-agent-is-you` out of `agent-cannot-take-a-message` for exactly this reason
   * — *"It names the MISTAKE rather than the state. A caller that addressed itself was told its
   * target was busy, which is the one thing it was not."* ⚠️ **A caller speaking about work it
   * holds was told the id was not hers, which is the one thing it was not**: it is hers, it is
   * open, and she is holding it.
   *
   * ## ⚑ The entitlement is the LOOKUP, and this one discloses nothing new
   *
   * ⛔ **It fires only on an open piece given to the caller** — so it can only ever name a piece
   * `list_tasks` already reports to this very caller. ⚠️ **It is not an existence oracle for anybody
   * else's work**: the name has already failed the *did you give it* lookup before this one is
   * asked. ⚑ **The caller's own ROOT has its own word**, `that-is-your-own-work`: no conversation
   * gave it, so there is nothing `reply_to_parent` could hand it back to.
   *
   * ⛔ **And it folds OPENNESS in**: work already `answered`, `withdrawn` or `closed` is not work a
   * check-in can be about, and a sentence naming `ask_question` for it would name a verb that
   * refuses. ⚑ Those fall back to `not-a-piece-you-gave`, the truthful answer about a piece nobody
   * is holding.
   *
   * ⚠️ **`permanent`**: a follow-up naming a piece you HOLD can never become the right call, and
   * *change the call, not the world* is precisely the remedy. See {@link TOOL_REMEDY} for why the
   * act lives in the sentence and the field is `null`.
   */
  'that-is-work-you-hold',
  /**
   * 🔴 **D-016 · the caller named its OWN ROOT for an act that is about a piece one conversation
   * gives another** — a follow-up (`message_agent`), or a new brief or a close (`update_work`). A
   * root is the work a person gave this conversation: no conversation gave it, so none follows it
   * up, briefs it again or closes it. ⛔ `that-is-work-you-hold`'s sentence names `reply_to_parent`,
   * which refuses a root for good (`a-person-gave-that-piece`), so a root gets its own word: ask a
   * person with `ask_question`, and answer the person in the conversation itself.
   * ⚠️ **`permanent`**, for its neighbour's reason: the direction is wrong, not the world.
   * ⚑ **D-023 · R2 — never said about files**: a root's owner keeps what it made on its root, as
   * any owner keeps it on a piece it holds. ⛔ **Nor about work taken on for a person**, which a
   * person gave too: its owner asking for a new brief or a close is told
   * `the-giver-briefs-and-closes-a-piece`, whose words are true of it.
   */
  'that-is-your-own-work',
  /**
   * 🔴 **663 · the conversation's previous run has not been confirmed stopped** — a launch given up
   * on whose provider has not yet been seen to go (`not-confirmed-stopped`, 070), or a teardown that
   * outlived the reopen's wait (`still-closing`: the finalizer's archive has no bound of its own).
   * ⚑ **Said only to a caller the fold ADMITTED**, so the retry it asks for is one that can land — a
   * listed conversation on its way out that is not this caller's to wake is waited out and then
   * answered `no-such-agent` instead (review, round two: this word said *try again* to it, about a
   * call the host already knew would meet the fold).
   *
   * ⚠️ **Reachable at a wake and at no spawn, and that is why it is new here.** A spawn mints a
   * fresh id, so a retry after `agent-took-too-long-to-start` never meets the launch it gave up on;
   * a wake names the SAME id, and `reserve` refuses that id until the abandoned launch is gone —
   * because two runs of one transcript is the failure 070 exists to prevent. ⚑ So the retry that
   * sentence recommends can meet this one, and this one says the same thing again.
   *
   * ⛔ **It says what to do and never that it will work** (`REFUSAL_REMEDIES`' own rule): a provider
   * that never answers and never dies keeps its launch held, and nothing here can promise otherwise.
   */
  'that-conversation-is-still-stopping',
  /**
   * 🔴 **663 · the conversation could not be brought back** — the provider's `ResumeError`, or a row
   * with no provider id to resume (`cannot-be-reopened`, where no provider is even asked).
   *
   * ⚠️ **`until-a-person-changes-it`, and NOT `permanent`** (corrected by `663`'s review).
   * ⛔ `663` priced it on Codex wrapping an expired sign-in in this same class. ⚑ **Since `673` it
   * does not**: both adapters rethrow the local credential pre-flight's `AuthUnavailableError`
   * untouched, which reaches `657`'s sign-in word instead. ⚠️ **The price still holds, for what is
   * left**: a `ResumeError` is everything else a resume can fail on, in its handshake or in the
   * setup before it (Codex's too since `697`) — a thread the provider no longer has, a transport
   * that could not be spawned or failed mid-handshake, a refusal the local pre-flight cannot see —
   * and on the arms a person CAN fix, the identical wake then succeeds, so `permanent`
   * would tell the model never to retry a conversation whose own context is the whole point of
   * waking it. ⚑ **The
   * word is true on every arm it is still said on**: no retry passes until a person has acted, and
   * on the arms a person cannot fix, none passes after either — which the sentence says.
   * ⚠️ **`697`'s review found the one arm it was false on — a TRANSIENT setup failure** (a spawn
   * refused for want of descriptors, `EMFILE`, clears with nobody acting) — and **since `705` (R39)
   * that arm has its own word, the next member**. ⛔ What is left here is everything a resume fails on
   * that is not a shortage the machine gets back by itself — and an errno the list does not name
   * (`TRANSIENT_SETUP_CODES`) stays here, which is the direction a guess must err in.
   *
   * 🔴 **716 · R66/R67 — and a start a person must fix, at a wake**: a provider's program missing
   * (either provider's class, outside any `ResumeError`) or a folder the host could not make. ⛔ Until
   * `716` Codex's reached the SPAWN's word (`agent-did-not-start`), Claude's this word inside a
   * `ResumeError` with nothing saying it was the program, and a folder's a broken tool. ⚑ This
   * door's word now, with a sentence that says which ({@link A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN},
   * {@link A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE}) — ⚑ and since `724` (`717` F-2) a folder the
   * conversation ran in that is gone ({@link A_WAKE_WHOSE_FOLDER_IS_GONE}) — which `main` answered
   * with the generic word, and which the launch's classifier would call the program (its spawn's
   * `ENOENT` names the program).
   *
   * 🔴 **D-039 · R2 — and a start its PROVIDER refused**, told {@link A_WAKE_ITS_PROVIDER_REFUSED}
   * with the provider's words in the detail — which this word's own sentence called a sign-in or a
   * provider that could not be started.
   */
  'that-conversation-could-not-be-resumed',
  /**
   * 🔴 **705 · R39 — the conversation could not be woken JUST NOW: its provider could not be started
   * because the machine ran short** of descriptors, a process slot or memory (`EMFILE`, `ENFILE`,
   * `EAGAIN`, `ENOMEM` — `TRANSIENT_SETUP_CODES`).
   *
   * ⚑ **PM ruling R39** (`697` H-c): *"a transient setup failure (`spawn EMFILE`) is never until a
   * person changes it — a retryable word that says so."* ⛔ **On `main` it was the word above**,
   * *"Waking it again will not help until a person has looked"*, on both providers — the sentence
   * that tells a model to stop retrying a call whose whole point is the context it would wake.
   *
   * ⚠️ **Chosen by TYPE: the errno's `code` on the error's cause chain** (`transientSetupFailureOf`
   * — a `ResumeError`'s, and since `707` any error a wake meets), never the provider's text. ⛔ **Neither adapter carried it on
   * `main`** — a spawn `EMFILE` arrives a tick after `spawn` returns and with no streams, so each
   * chain held only the `TypeError` its adapter raised reaching for one; `705` taught both to keep
   * the errno (`packages/runtime/test/the-errno-a-resume-carries.test.ts`).
   *
   * ⚑ **Reached at the door the word above is** — `message_agent` starting a conversation that was
   * not running (D-017) — because it asks {@link aWakeThatDidNotHappen}.
   * ⛔ **It says what to do and never that it will work** (`REFUSAL_REMEDIES`' own rule): a machine
   * that stays short keeps refusing, and the sentence says *usually*.
   */
  'that-conversation-could-not-be-woken-just-now',
  /**
   * 🔴 **D-012 · `read_transcript`'s reach** (proposal §6.5) — a conversation below the caller in
   * the spawn chain, ⚑ **or, since D-024 · R2, one of its own profile's**. ⚑ **One answer for *not
   * there* and *out of that reach***, `no-such-agent`'s fold (`341`), so it discloses nothing about
   * an id; its own word
   * because `no-such-agent`'s sentence promises *"list_agents names the ones you can reach"*, and
   * `list_agents` names peers this door refuses.
   */
  'not-a-conversation-below-you',
  /**
   * 🔴 **D-016 · no piece by that name is one you hold or gave** — `update_work`'s, and a note's that
   * names a piece. ⛔ One answer for a name that names nothing and one that is somebody else's, so
   * a label is no oracle.
   */
  'no-piece-by-that-name',
  /**
   * 🔴 **D-016 · the one that gave a piece names it** (plan ruling 7): its owner may set its status
   * line and not its title — a piece a CONVERSATION gave; one a person gave is named by its owner
   * (commit 6 · R5). ⚑ Its own word, because the call is right about the piece and wrong about who
   * may do this to it.
   */
  'the-giver-names-a-piece',
  /**
   * 🔴 **D-016 · `update_work` on a piece that has ended** — answered, closed or taken back: a status
   * line, a new brief, a close or kept files. ⚑ Its reply's summary, its close or its taking back is
   * its last word; a title may still change.
   */
  'that-piece-has-ended',
  /**
   * 🔴 **D-016 · the one that gave a piece gives its brief and closes it** (R1): its owner asked
   * `update_work` for either. ⚑ Its own word beside {@link 'the-giver-names-a-piece'}, for that
   * word's reason — the call is right about the piece and wrong about who may do this to it — and
   * its sentence names what the owner MAY do instead: ask, set the status line, keep what it made,
   * or hand the piece back. ⚑ **Commit 6 · said too to the owner of work it took on for a person**,
   * which no conversation gave and no door briefs or closes (R5); its root is
   * `that-is-your-own-work`'s. ⚠️ **`permanent`**: who gave a piece never changes.
   */
  'the-giver-briefs-and-closes-a-piece',
  /**
   * ⛔ **That piece was already closed by its giver** (D-016) — `withdraw_task` alone meets it.
   * ⚑ Its own word beside `that-piece-was-already-taken-back`, for that word's reason: the two are
   * different claims about history, and the caller closed this one itself. ⚠️ **`permanent`**: a
   * closed piece has ended and there is no door back to open.
   */
  'that-piece-was-already-closed',
  /**
   * 🔴 **D-016 · commit 6 · R1 — `take_on_work` from a caller that owns no root**: a conversation a
   * give started, or no conversation at all (this app, a window, a person at the host's door).
   * ⛔ Only a conversation a person started has work of its own to hang a request under.
   * ⚠️ **`permanent`**: a conversation never gains a root.
   */
  'no-work-of-your-own',
  'work-record-unavailable',
  /**
   * 🔴 **F009 · `list_profiles` naming an agent this app does not hold** — there is no record to
   * read. ⚑ Its own word beside `no-such-agent`, which is about a CONVERSATION's id or a piece's
   * label: this names an agent by its profile. ⚠️ **`permanent`**: the name is the call's, and the
   * act is to spell one `list_profiles` names.
   */
  'no-agent-by-that-name',
  /** `restore_agent` named a conversation that is not archived, nor is any below it. */
  'that-conversation-is-not-archived',
  /** `restore_agent` while an archive or a delete of that conversation is still under way. */
  'it-is-being-archived-or-deleted',
  /**
   * `restore_agent` when this app cannot save its list of archived conversations. The host's own
   * sentence, which says what a person has to do, is in `said`.
   */
  'it-could-not-be-restored',
  /**
   * `request_mcp_server` named a server, or an address, that is already registered. A request adds
   * a server and never changes one, so the call has to change: `permanent`.
   */
  'server-already-registered',
  /**
   * `request_mcp_server` named a server another request already asks for. It clears when the
   * person decides that one.
   */
  'server-already-asked-for',
  /**
   * `request_mcp_server` while this conversation, or every conversation together, already has as
   * many requests waiting as may wait. It clears when the person decides some.
   */
  'too-many-server-requests',
  /**
   * ⚑ **A message about a piece the caller gave, which waits, queued, at a service**: its brief has
   * reached nobody, so nothing is sent about it. Its brief is changed with update_work, and it keeps
   * its place. ⚠️ `while-this-holds`: once it is handed over, the same message goes to the service.
   */
  'that-piece-is-still-queued',
] as const

export type ToolRefusal = (typeof TOOL_REFUSALS)[number]

/**
 * 🔴 **D-042 · R4 — what the helper's conversation runs on, said to the giver** (*"the give's answer
 * says what it now runs"*).
 *
 * ⚑ **Rendered from {@link WhatItRunsOn}** — read off the conversation after the brief was handed
 * over — and never asserted about the mechanism (standing rule 8.2). ⚑ A start says where its model
 * came from (R1's order); a give whose choice was not used says which half of what it named, and
 * why (F1, or a conversation that took its place on another provider). ⚑ An effort its provider has
 * not reported is said as *requested* (R5), as `get_agent_status` says it. `''` only for a
 * conversation that has named no pair yet.
 */
export function whatItRunsOnSaid(runsOn: WhatItRunsOn): string {
  if (runsOn.model === null) return ''
  const { model, effort } = runsOn.named
  // ⚠️ *"Offers no effort levels"* only where the pair was named against the list — a start's, or
  // the one this give named; a conversation's own pair it left may be a row from before D-042 that
  // recorded no effort.
  const judged =
    runsOn.how === 'started' ||
    runsOn.how === 'switched' ||
    (runsOn.how === 'unchanged' && (model || effort))
  const pair =
    runsOn.effort === null
      ? `on “${runsOn.model}”${judged ? ', which offers no effort levels' : ''}`
      : `on “${runsOn.model}” at ${runsOn.effort} effort${runsOn.effortReported ? '' : ' (requested)'}`
  const unused = `so the ${model && effort ? 'model and effort' : model ? 'model' : 'effort'} you named ${model && effort ? 'were' : 'was'} not used`
  switch (runsOn.how) {
    case 'started':
      return `It runs ${pair} — ${whereItCameFromSaid(runsOn)}.`
    case 'switched':
      return `It now runs ${pair}, from this piece on.`
    case 'unchanged':
      return `It runs ${pair}.`
    case 'a-person-chose-it':
      return `It keeps running ${pair}: a person chose that for this conversation, ${unused}.`
    case 'another-provider':
      return `It runs ${pair}: the conversation that took its place runs on ${PROVIDER_NAME[runsOn.provider]}, ${unused}.`
  }
}

/**
 * ⚑ **D-042 · R1's order, in words** — where a started conversation's MODEL came from, and the
 * effort said as the give's own only when the give named it.
 */
function whereItCameFromSaid(runsOn: WhatItRunsOn): string {
  const atYourEffort = runsOn.named.effort ? ', at the effort you named' : ''
  switch (runsOn.from) {
    case 'named':
      return runsOn.named.effort ? 'as you named' : 'the model you named'
    case 'its-default':
      return `its default${atYourEffort}`
    case 'the-last-pick':
      return `the model a person last picked for ${PROVIDER_NAME[runsOn.provider]}${atYourEffort}`
    case 'the-providers-default':
    case null:
      return `${PROVIDER_NAME[runsOn.provider]}’s default${atYourEffort}`
  }
}

/**
 * One caller-visible closed vocabulary, with one complete sentence for every member.
 *
 * ⛔ The member list is the schema and the sentence table is checked against that list. Adding a
 * member without teaching the caller what it means is therefore a compile error rather than one
 * more failed first call. {@link documentedToolEnum} turns the same data into the JSON Schema and
 * its description; the handler keeps its own structured-refusal validation.
 */
interface ToolInputVocabulary<Member extends string> {
  readonly members: readonly [Member, ...Member[]]
  readonly sentences: Readonly<Record<Member, string>>
}

const toolInputVocabulary = <const Members extends readonly [string, ...string[]]>(
  members: Members,
  sentences: Readonly<Record<Members[number], string>>,
): ToolInputVocabulary<Members[number]> => ({ members, sentences })

// The kind of agent create_agent makes: one with separate workers, or a service.
const AGENT_KIND_INPUT = toolInputVocabulary(['normal', 'service'] as const, {
  normal: "'normal', the default: separate workers for each caller.",
  service: "'service': one conversation. Work runs one piece at a time.",
})

// Zod exposes `.options` as an array even though `z.enum` proves it non-empty at construction.
const PROVIDER_INPUT = toolInputVocabulary(
  providerSchema.options as [Provider, ...Provider[]],
  providerRecord((provider) => providerDescriptor(provider).words.providerChoice),
)

// 🔴 **D-037 · where `find_files` looks** — the caller's tree, or every piece this app keeps files for.
const FIND_WHERE_INPUT = toolInputVocabulary(['tree', 'everywhere'] as const, {
  tree: "'tree', the default, is the work you hold or gave and everything under it — what the Files tab of your conversation shows.",
  everywhere: "'everywhere' is every piece this app keeps files for, whoever made the file.",
})

// ⚑ **Which rows `list_tasks` and `list_questions` list**: what is open, what is over, or both.
const LISTING_INPUT = toolInputVocabulary(['open', 'ended', 'all'] as const, {
  open: "'open', the default, is what is still open or waiting, with a count of the rest.",
  ended: "'ended' is only what is over, a line each, newest first.",
  all: "'all' is what is open, then what is over, a line each, newest first.",
})

// 🔴 **D-010 · what each kind of message IS** (plan §3.1) — a note or a follow-up, and neither opens
// anything: work is given with `give_work` (D-016). ⚑ A question is not a message: `ask_question`,
// whose answer comes back.
const MESSAGE_KIND_INPUT = toolInputVocabulary(AGENT_MESSAGE_KINDS, {
  note: "'note' tells it something for its information; no reply is expected.",
  'follow-up': "'follow-up' adds to a piece of work you gave it, which you name.",
})

// 🔴 **611 · the two ends a question may be addressed to** (HO-088 §2.1) — members and sentences
// both DERIVED from `shared/questions.ts`, so a tool cannot advertise a value the ledger's own
// `request_routed.to` has no room for.
const QUESTION_RECIPIENT_INPUT = toolInputVocabulary(
  QUESTION_RECIPIENTS as unknown as [QuestionRecipient, ...QuestionRecipient[]],
  RECIPIENT_MEANS,
)

// 🔴 **D-009 · the two a question may be PASSED to** — `shared/questions.ts`' own list, and the
// sentences `RECIPIENT_MEANS` already says for those two.
const PASS_UP_RECIPIENT_INPUT = toolInputVocabulary(
  PASS_UP_RECIPIENTS as unknown as [PassUpRecipient, ...PassUpRecipient[]],
  { 'the-parent': RECIPIENT_MEANS['the-parent'], 'a-person': RECIPIENT_MEANS['a-person'] },
)

// Who a requested MCP server would be for.
const MCP_REQUEST_WHO_INPUT = toolInputVocabulary(MCP_SERVER_REQUEST_WHO, {
  everyone: "'everyone': every agent in this app may use it.",
  'only-these-agents': "'only-these-agents': only the agents you list in agents.",
})

const TASK_OUTCOME_INPUT = toolInputVocabulary(TASK_OUTCOMES, {
  done: "'done' says the work was completed.",
  blocked: "'blocked' says the work is not complete and somebody else may be able to unblock it.",
  failed: "'failed' says the work is not complete and the agent has nothing further to try.",
})

const WORK_SEARCH_SCOPE_INPUT = toolInputVocabulary(WORK_SEARCH_SCOPES, {
  mine: "'mine' covers your profile's conversations.",
  'this-conversation': "'this-conversation' covers work you own or gave here.",
  all: "'all' covers this app's work.",
})
const WORK_SEARCH_STATE_INPUT = toolInputVocabulary(
  WORK_SEARCH_TASK_STATES,
  Object.fromEntries(
    WORK_SEARCH_TASK_STATES.map((state) => [state, `'${state}' means ${WORK_STATE_WORD[state]}.`]),
  ) as Readonly<Record<(typeof WORK_SEARCH_TASK_STATES)[number], string>>,
)

/**
 * ⛔ Every enum-valued argument in the published toolset, as an addressable census.
 *
 * The keys name actual tool + argument call sites. Tests compare this inventory with both the
 * registered tool schemas and the calls to {@link documentedToolEnum}; a new argument cannot be
 * documented by merely importing a vocabulary and never using it.
 */
export const TOOL_INPUT_ENUMS = {
  'search_work:scope': WORK_SEARCH_SCOPE_INPUT,
  'search_work:state': WORK_SEARCH_STATE_INPUT,
  'message_agent:kind': MESSAGE_KIND_INPUT,
  'reply_to_parent:outcome': TASK_OUTCOME_INPUT,
  'create_agent:provider': PROVIDER_INPUT,
  'create_agent:kind': AGENT_KIND_INPUT,
  // ⚑ **611 · ONE vocabulary, advertised on BOTH question verbs** (HO-088 §2.1, §3.2). ⛔ Two
  // entries and not one shared name, because `TOOL_INPUT_ENUMS` is keyed by `verb:argument` and a
  // reader asking *what may this verb be sent* must find its own row.
  'ask_question:who_answers': QUESTION_RECIPIENT_INPUT,
  // ⚑ **D-009 · no longer the same vocabulary**: a question is never passed to an agent by name.
  'pass_question_up:who_answers': PASS_UP_RECIPIENT_INPUT,
  'find_files:where': FIND_WHERE_INPUT,
  'list_tasks:state': LISTING_INPUT,
  'list_questions:state': LISTING_INPUT,
  'request_mcp_server:who_gets_it': MCP_REQUEST_WHO_INPUT,
} as const

/**
 * Advertise the members on both providers while preserving the app's structured malformed-request
 * answer for an unknown value. See {@link agentToolStringEnum} for the measured adapter boundary.
 */
function documentedToolEnum<Member extends string>(
  vocabulary: ToolInputVocabulary<Member>,
  before: string,
  after = '',
): z.ZodType<unknown> {
  const memberSentences = vocabulary.members.map((member) => vocabulary.sentences[member]).join(' ')
  return agentToolStringEnum(vocabulary.members).describe(
    `${before} One of ${vocabulary.members.join(', ')}. ${memberSentences}${after === '' ? '' : ` ${after}`}`,
  )
}

/**
 * 🔴 **Every argument `message_agent` advertises, as a TYPE** (415, HO-021 §3) — the shape the
 * schema is checked against and the key the handler reads through.
 *
 * ## ⛔ Because *"I sent it and the behaviour changed"* is not a proof of anything
 *
 * ⚠️ **The brief asked for a type error rather than a green test, and the reason is sharper than the
 * one it gives.** Since `348` both adapters build their schema with `z.looseObject`, so an
 * undocumented key is NOT stripped — it reaches this handler, the behaviour changes, and a test that
 * sends it passes. ⛔ **What such a test cannot see is that no model was ever told the argument
 * exists**, because what a model is told is the JSON Schema built from the shape below and nothing
 * else.
 *
 * ⚑ **So the two halves are pinned separately and neither can drift.** The advertisement
 * `satisfies Readonly<Record<keyof MessageAgentArguments, ZodType>>` — a compile error if the
 * documented set and this interface stop agreeing in EITHER direction — and the handler reads the
 * declaration through {@link MESSAGE_KIND_ARGUMENT}, which is typed as a key of this interface.
 * ⚠️ Rename the argument in one place and the build fails in the other.
 *
 * ⛔ **It is not used to CAST what arrives.** The wire carries whatever a model sent; `kind` below
 * says what this tool takes, not what it was given, and {@link isAgentMessageKind} is what decides
 * whether the two matched — `a-fixture-built-with-the-helper-under-test-proves-nothing`, pointed at
 * a validator.
 */
interface MessageAgentArguments {
  /** The receiving agent. */
  readonly agent: string
  /** The words. */
  readonly text: string
  /**
   * ⚑ **What the caller says the message IS** — one of `AGENT_MESSAGE_KINDS`. ⛔ **Required since
   * D-010, at the handler and not in the schema**: a schema-required argument is refused by the MCP
   * SDK before this door runs on Claude and handed over unparsed on Codex (`538` §3.3), so only the
   * handler refuses its absence the same way on both.
   */
  readonly kind?: AgentMessageKind
  /**
   * 🔴 **The piece this message is ABOUT** (429 as a task; a piece since D-016) — by its label
   * (`W1.2`) or its id.
   *
   * ⛔ **It hands nothing over and it opens nothing**: work is given with `give_work`. ⚑ **What it
   * may name depends on the kind** (D-016 spec D14): a follow-up adds to a piece the sender gave
   * that agent, so it must name one; a note may name a piece the sender holds or gave, or none.
   * ⚠️ It is written on the SENDER's receipt (`message_sent.piece`) and read by nothing on the
   * receiver's side.
   */
  readonly piece?: string
  /** `true` asks the receiver's running turn to stop so it reads this message now. */
  readonly interrupt?: boolean
}

/**
 * ⛔ **The advertised name of the declaration, as a key of {@link MessageAgentArguments}** (415) —
 * see that interface for what the typing buys.
 */
const MESSAGE_KIND_ARGUMENT = 'kind' satisfies keyof MessageAgentArguments

const MESSAGE_INTERRUPT_ARGUMENT = 'interrupt' satisfies keyof MessageAgentArguments

/**
 * ⛔ **The advertised name of the piece it is about, as a key of {@link MessageAgentArguments}** —
 * `415`'s device on the second field it named. ⚑ **`piece` on every tool that takes one**
 * (`give_work`, `ask_question`, `update_work`, `reply_to_parent`, `withdraw_task`, `list_tasks`), so a
 * model never translates between two spellings of one name.
 */
const MESSAGE_PIECE_ARGUMENT = 'piece' satisfies keyof MessageAgentArguments

/**
 * 🔴 **Every argument `create_agent` advertises, as a TYPE** (419) — `415`'s device, one door over,
 * and for the reason that dispatch measured rather than the one its brief gave.
 *
 * ⛔ **Since `348` both adapters build their schema with `z.looseObject`, so an undocumented key is
 * NOT stripped.** It reaches the handler, the behaviour changes, and a test that sends it passes —
 * while no model was ever told the argument exists, because what a model is told is the JSON Schema
 * built from the shape below and nothing else. ⚑ So the advertisement carries
 * `satisfies Readonly<Record<keyof CreateAgentArguments, ZodType>>` — a compile error the moment the
 * documented set and this interface disagree in either direction — and every read in the handler
 * goes through a constant typed as a key of this interface.
 *
 * ⚠️ **`profile_slug` names the value `give_work` takes as `profile`** — the identity's folded name,
 * as `list_profiles` reports it.
 */
interface CreateAgentArguments {
  /** The name. Folded, globally unique, and refused if it is taken in any spelling. */
  readonly profile_slug: string
  /**
   * Which provider its conversations run on, kept from its making — absent: the provider whose list
   * alone holds the model it names, else the creator's.
   */
  readonly provider?: Provider
  /**
   * 🔴 **618 · the new identity's own standing rules, or absent** (`HO-078` §4).
   *
   * ⛔ **The same name `propose_agent_rules` uses for the same thing**: a creation that called a rule
   * set something else would make a model translate between two spellings of one layer.
   *
   * ⚠️ **Optional, and staying optional is `HO-078` §4.3**: an agent creating another without rules
   * is the ordinary case. ⛔ **Absent and `''` are NOT the same** — absent writes no version at all,
   * and an empty string writes a version that says *there are none*, which is a fact with a date and
   * an author. ⚑ The door refuses neither; the answer says which happened.
   */
  readonly rules?: string
  /**
   * 🔴 **D-042 · R2 — the model its new conversations start on: its default** — from the list a
   * person keeps for its provider, judged by the one seam (`model-rails.ts`).
   */
  readonly model?: string
  /** 🔴 **D-042 · R2 — the effort its default runs at**, one that model offers. */
  readonly effort?: string
  /** A normal agent, absent, or a service: one conversation its callers share, one piece at a time. */
  readonly kind?: 'normal' | 'service'
}

/**
 * 🔴 **584 · `display_name` LEFT this shape, and it is a ruling rather than a tidy-up**
 * (`HO-078` §5).
 *
 * > ⛔ **"The app assigns the name. The agent does not choose it and does not ask."**
 *
 * An optional naming field invites the model to ask the person for a name, delaying work for a choice the app can make itself.
 *
 * ⚑ **Removing it is the rail, and the sentence is not.** Standing rule 8.3: *a capture proves what
 * the provider was given; nothing proves the model obeyed it* — so an instruction saying *do not
 * ask what to call it* would be a sentence, while a schema with no field for the answer is a door.
 * ⛔ **And `348`'s `z.looseObject` is why the TYPE had to change too**: an undocumented key is not
 * stripped, so leaving the reader in place with the advertisement gone would have left a path a
 * test could drive and no model was ever told about.
 *
 * 🔴 **The name still exists and is still a person's to change.** `SessionStore` hands every
 * identity it mints a first name, drawn at random, that nothing already answers to (`human-names.ts`),
 * the creating agent is TOLD that name in this tool's success answer so it has no reason to ask,
 * and `setAgentDisplayName` — a person's verb since `558` — is what corrects one.
 */

/**
 * 🔴 **Every argument `withdraw_task` advertises, as a TYPE** (429) — `415`'s device, third door.
 *
 * ⛔ **Since `348` both adapters build their schema with `z.looseObject`, so an undocumented key is
 * NOT stripped.** It reaches the handler, the behaviour changes, and a test that sends it passes
 * while no model was ever told the argument exists. ⚑ So the advertisement carries
 * `satisfies Readonly<Record<keyof WithdrawTaskArguments, ZodType>>` and every read in the handler
 * goes through a constant typed as a key of this interface.
 *
 * ## ⚠️ D-016 · the agent is no longer named
 *
 * ⚑ **A piece names its owner**: the row says which conversation holds it, so a second name in the
 * call could only disagree with it. ⛔ The lookup is *the pieces you gave*, and a piece somebody else
 * gave is the same refusal as one that does not exist.
 */
interface WithdrawTaskArguments {
  /** The piece being taken back — its label or its id. */
  readonly piece: string
}

/** ⛔ The advertised name, as a key of {@link WithdrawTaskArguments} — see that interface (429). */
const WITHDRAW_PIECE_ARGUMENT = 'piece' satisfies keyof WithdrawTaskArguments

/**
 * 🔴 **What `ask_question` advertises** (437, criterion 29 · 611, HO-088 §2).
 *
 * ## ⛔ There IS an addressee now, and it is two words rather than a target
 *
 * ⚠️ **This interface was named `AskParentArguments` and its note read *"there is no addressee
 * here, and its ABSENCE is the design."*** ⛔ `HO-088` §2 ends that: *"A question carries its
 * recipient. The app routes what the agent DECLARED and infers nothing."*
 *
 * 🔴 **What did NOT change is the refusal.** {@link REPLY_ADDRESSING_KEYS}' fourteen spellings of
 * *"send it to this one"* are still refused here, and they have to be: {@link who_answers} is a
 * two-member vocabulary — the parent, or the person — and `HO-088` §2.1 rules that those are the
 * only two ends. ⚑ **A model that tried to aim a question at a named conversation is still told
 * why that is not an argument**, and now the sentence can also say what IS one.
 *
 * ⚑ **Naming the task is still how a worker says which parent**, exactly as it is how it says
 * which reply — the recipient says which END, never which conversation.
 */
interface AskQuestionArguments {
  readonly move_to?: string
  /**
   * The piece this question is about, by label or id. ⚑ **D-016** — inferred for the two ends about
   * work when exactly one piece the asker holds has reached it (its root counts; D-022 · R4);
   * optional for a question to an agent by name.
   */
  readonly piece?: string
  /**
   * 🔴 **D-009 · F012** — the agent a question is for, when who_answers is `an-agent`: by the piece it
   * owns (`W1.2`) or by its id (D-016 · commit 7 · R1).
   */
  readonly agent?: string
  /** The question itself. */
  readonly question: string
  /**
   * 🔴 **611 · who it is for** (HO-088 §2.2) — REQUIRED, and the PO ruled why.
   *
   * Require the caller to choose the recipient. The person can speak to any agent at any time, so defaulting to the last speaker could redirect the next work question away from its giver.
   */
  readonly who_answers: QuestionRecipient
  /** ⛔ Optional, and an empty list is a free-form question rather than a broken one. */
  readonly options?: readonly string[]
}

/**
 * 🔴 **What `pass_question_up` advertises** (611, HO-088 §3.2).
 *
 * ## ⛔ There is no QUESTION field, and that absence is the ruling
 *
 * ⚠️ **The PO: *"Not the parent's summary — a question reworded at every hop arrives as something
 * nobody asked. The parent MAY add context; it may NOT replace the question."*** ⛔ So the words
 * are not an argument: this app reads them out of the original asker's own ledger and writes them
 * verbatim. ⚑ **The same device {@link REPLY_ADDRESSING_KEYS} is for an addressee** — the thing a
 * model must not be able to do is a thing the tool has no field for.
 *
 * ⚑ **{@link context} is what a hop may add**, and it lands in its own paragraph rather than in
 * the question — see `questionText`.
 */
interface PassQuestionUpArguments {
  /** The question being carried, by the id this app gave it. */
  readonly question: string
  /**
   * 🔴 **679 · which conversation asked it** — {@link AnswerQuestionArguments.asked_by}, the same
   * field for the same reason. ⛔ It selects the question being CARRIED and never where it goes:
   * that is `who_answers`, and `REPLY_ADDRESSING_KEYS` still refuses every spelling of an addressee.
   */
  readonly asked_by?: string
  /** ⛔ Who the next hop is — the same two ends `ask_question` takes. */
  readonly who_answers: QuestionRecipient
  /** ⚑ Anything worth knowing that the original words do not say. Leave it out to add nothing. */
  readonly context?: string
}

/**
 * 🔴 **Every argument `answer_question` advertises, as a TYPE** (477) — `415`'s device, and the
 * `satisfies` on the tool's `input` fails to compile if this shape and that one stop naming the
 * same set, in EITHER direction.
 *
 * ## ⛔ Why this tool and why now: it is the one tool that settles a pending request
 *
 * ⚠️ **HO-029 §2.1 requires that the actor of an act be recorded by whoever performs it, and that
 * a model can never assert it.** `UserDecisionEvent.by` is derived from the {@link Caller} —
 * {@link RuntimeHost.whoDidIt} — and the standard it is held to is
 * `MessageSentEvent.onBehalfOfAPerson`'s: *"there is no argument, on any tool, by which a model
 * can say it."*
 *
 * 🔴 **A census over the sixteen tools is a test; this is a BUILD FAILURE.** ⛔ The day somebody
 * advertises an `as`, a `by`, an `on_behalf_of` or a `caller` on this tool — the one door through
 * which an agent settles somebody's question — the compiler refuses it, before any suite runs.
 * ⚑ It is the same device `message_agent`, `create_agent`, `withdraw_task` and `ask_question`
 * already carry; this tool was the settler without one.
 *
 * ## ⚠️ There is no addressee here — and since `679` there is one SELECTOR
 *
 * ⛔ **Which conversation is answering is derived from the caller** (`sessionSpeakingAs`) and which
 * conversation is ASKED is derived from the routing row this app wrote. ⚑ The answerer is not a
 * field, so it is not a thing a model can be wrong or dishonest about — the same structural negative
 * {@link REPLY_ADDRESSING_KEYS} enforces at runtime for the two verbs that could have had one.
 *
 * 🔴 **679 · {@link asked_by} names the ASKER, and it is a selector rather than an address.** ⛔ A
 * request id is session-local, so two children's can be one string (`675` F-b); the id alone then
 * names two routing rows and the door refuses rather than guess. ⚑ `asked_by` picks one of the rows
 * routed to THIS caller and reaches nothing else — a value naming any other conversation meets the
 * same absence a made-up id does — so what it can be wrong about is which of the caller's own
 * questions it is answering, never whom the answer may reach.
 */
interface AnswerQuestionArguments {
  /** The question id, exactly as the app gave it. */
  readonly question: string
  /**
   * 🔴 **679 · the conversation that asked, as `list_questions` and the question's own words name
   * it** — optional, and needed only when two conversations this caller started asked with one id.
   */
  readonly asked_by?: string
  /** One entry per part the question asks about. ⚑ **D-009** — left out when {@link cannot_answer} says why there is none. */
  readonly answers?: readonly { readonly part: string; readonly answer: readonly string[] }[]
  /** 🔴 **D-009 · F012** — you cannot answer it, and why (ruling 2). */
  readonly cannot_answer?: string
  /**
   * `false` lets the asker finish its running turn before it reads the answer. Left out or `true`,
   * that turn is asked to stop so the answer is read now, when the answerer may stop the asker.
   */
  readonly interrupt?: boolean
}

/** ⛔ The advertised names, as keys of {@link AnswerQuestionArguments} — see that interface (477). */
const ANSWER_QUESTION_ARGUMENT = 'question' satisfies keyof AnswerQuestionArguments
const ANSWER_ANSWERS_ARGUMENT = 'answers' satisfies keyof AnswerQuestionArguments
/** ⚑ **D-009** — the decline. */
const ANSWER_CANNOT_ARGUMENT = 'cannot_answer' satisfies keyof AnswerQuestionArguments
const ANSWER_INTERRUPT_ARGUMENT = 'interrupt' satisfies keyof AnswerQuestionArguments
/** ⛔ **679 · shared by BOTH doors that take a routed question**, so one spelling reaches one key. */
const ASKED_BY_ARGUMENT = 'asked_by' satisfies keyof AnswerQuestionArguments &
  keyof PassQuestionUpArguments
/**
 * ⚑ **679 · what a model is told `asked_by` is — one sentence, advertised by both doors.** ⛔ It says
 * when the field is NEEDED and that the call says so: the id alone still decides whenever one asker
 * has it. ⚠️ It does not say *leave it out* — the question's own words hand the asker beside the id,
 * and a call that passes both is always right.
 */
const ASKED_BY_SAYS =
  'Which conversation asked it, by the piece it owns (W1.2) or by its id, as the question and list_questions name it. The id alone is enough unless more than one conversation you started asked a question with it; then this is required, and a call without it is refused and says so.'

/** ⛔ The advertised names, as keys of {@link AskQuestionArguments} — see that interface (437). */
const ASK_PIECE_ARGUMENT = 'piece' satisfies keyof AskQuestionArguments
const ASK_QUESTION_ARGUMENT = 'question' satisfies keyof AskQuestionArguments
const ASK_OPTIONS_ARGUMENT = 'options' satisfies keyof AskQuestionArguments
/** ⛔ **611 · shared by BOTH question verbs**, so one spelling reaches one vocabulary. */
const ASK_WHO_ARGUMENT = 'who_answers' satisfies keyof AskQuestionArguments
/** ⚑ **D-009** — who a question to `an-agent` is for. */
const ASK_AGENT_ARGUMENT = 'agent' satisfies keyof AskQuestionArguments

/** ⛔ The advertised names, as keys of {@link PassQuestionUpArguments} — see that interface (611). */
const PASS_QUESTION_ARGUMENT = 'question' satisfies keyof PassQuestionUpArguments
const PASS_CONTEXT_ARGUMENT = 'context' satisfies keyof PassQuestionUpArguments
const PASS_WHO_ARGUMENT = 'who_answers' satisfies keyof PassQuestionUpArguments

/** ⛔ The advertised names, as keys of {@link CreateAgentArguments} — see that interface (419). */
/**
 * 🔴 **Every argument `propose_agent_rules` advertises, as a TYPE** (582) — `415`'s device again.
 *
 * ⚠️ **`agent` is `message_agent`'s name for the same thing** and deliberately not `profile_slug`:
 * this verb is about an identity somebody else is, which is the population `message_agent` and
 * `get_agent_status` already call `agent`. ⛔ `create_agent`'s `profile_slug` names the identity
 * being MADE, and one spelling over two populations is how a model comes to send the wrong one.
 */
interface ProposeRulesArguments {
  readonly current_version: number
  /** Which identity the rules are FOR. Never the caller's own name unless it means itself. */
  readonly agent: string
  /** The rules, whole — what would be in force. An empty string takes the existing ones away. */
  readonly rules: string
  /** Why. ⚠️ A CLAIM: nothing in this app checks a word of it. */
  readonly why: string
}

/** Every argument `request_mcp_server` advertises, as a type its advertisement satisfies. */
interface RequestMcpServerArguments {
  /** The server's name, which its tools are published under. */
  readonly name: string
  /** The server's address, on this machine. */
  readonly url: string
  /** What the agent says the server can read and do. A claim the person reads. */
  readonly reaches: string
  /** Who would get it. */
  readonly who_gets_it: McpServerRequestWho
  /** With `only-these-agents`: the agents, as `list_profiles` names them. */
  readonly agents?: readonly string[]
  /** The caller's own piece of work this is for. */
  readonly piece?: string
}

const RULES_AGENT_ARGUMENT = 'agent' satisfies keyof ProposeRulesArguments
const RULES_TEXT_ARGUMENT = 'rules' satisfies keyof ProposeRulesArguments
const RULES_WHY_ARGUMENT = 'why' satisfies keyof ProposeRulesArguments

const CREATE_SLUG_ARGUMENT = 'profile_slug' satisfies keyof CreateAgentArguments
const CREATE_PROVIDER_ARGUMENT = 'provider' satisfies keyof CreateAgentArguments
const CREATE_RULES_ARGUMENT = 'rules' satisfies keyof CreateAgentArguments
const CREATE_MODEL_ARGUMENT = 'model' satisfies keyof CreateAgentArguments
const CREATE_EFFORT_ARGUMENT = 'effort' satisfies keyof CreateAgentArguments
const CREATE_KIND_ARGUMENT = 'kind' satisfies keyof CreateAgentArguments

/**
 * 🔴 **D-016 · every argument `give_work` advertises, as a TYPE** — `415`'s device: the
 * advertisement `satisfies` this interface, so *documented* and *read* cannot drift apart.
 *
 * ⛔ **They are the door's own names, and the tool hands them over untouched**: `giveRequestSchema`
 * is `.strict()`, so an argument neither knows reaches it under its own spelling and is refused BY
 * NAME — `303` B's lesson, with no rename map between the two for a key to fall through.
 * ⚑ **There are no provider or approval arguments** (plan ruling 3): a conversation a give starts
 * runs on the agent's own provider (`theProviderAStartRunsOn`), in the giver's mode. 🔴 **D-042 · R4 — a model and an effort are**: what that one conversation runs on.
 */
interface GiveWorkArguments {
  readonly definition_of_done: string
  /** The agent, by profile — as `list_profiles` names it. */
  readonly profile: string
  /** What the piece is called. */
  readonly title: string
  /** The work, as the agent is to be told it. */
  readonly brief: string
  /** The piece folder: a fresh conversation starts there; an existing one gets a grant. */
  readonly folder?: string
  /** The caller's own piece to hang this under, by label or id. */
  readonly piece?: string
  /** 🔴 **D-016 · R3** — bring a new agent into existence under that profile. */
  readonly new?: boolean
  /** Select a free worker or start another worker of the same normal profile. */
  readonly parallel?: boolean
  /** 🔴 **D-016 · R2** — files handed over with the work, kept as the piece's inputs. */
  readonly inputs?: readonly string[]
  /** 🔴 **D-042 · R4** — the model that conversation runs on, from this piece on. */
  readonly model?: string
  /** 🔴 **D-042 · R4** — its reasoning effort, one that model offers. */
  readonly effort?: string
}

/**
 * 🔴 **D-016 · every argument `update_work` advertises, as a TYPE** — `415`'s device. ⚑ All five
 * acts ship: a title and a status line (plan ruling 7), a new brief and a close (R1), and kept files
 * (R2).
 */
interface UpdateWorkArguments {
  readonly definition_of_done?: string
  /**
   * The piece, by label or id — inferred when exactly one piece the caller holds has reached it (its
   * root counts; D-022 · R4).
   */
  readonly piece?: string
  /** Its new title. */
  readonly title?: string
  /** Its current status line. */
  readonly status?: string
  /** What the status line in the same call marks the piece as waiting on: one of four. */
  readonly on?: WaitOnAsked
  /** 🔴 **R1** — a new brief for a piece the caller gave, kept verbatim, as `give_work`'s is. */
  readonly brief?: string
  /** 🔴 **R1** — only `true` closes: a piece the caller gave, ended without a reply. */
  readonly close?: boolean
  /** 🔴 **R2** — files to keep for the piece, as its inputs or as what was made for it. */
  readonly resources?: readonly string[]
}
const UPDATE_PIECE_ARGUMENT = 'piece' satisfies keyof UpdateWorkArguments
const UPDATE_TITLE_ARGUMENT = 'title' satisfies keyof UpdateWorkArguments
const UPDATE_STATUS_ARGUMENT = 'status' satisfies keyof UpdateWorkArguments
const UPDATE_ON_ARGUMENT = 'on' satisfies keyof UpdateWorkArguments
/** The argument `on` replaced, refused by name so a caller learns what to say instead. */
const UPDATE_WAITING_ARGUMENT = 'waiting'
const UPDATE_DONE_ARGUMENT = 'definition_of_done' satisfies keyof UpdateWorkArguments
const UPDATE_BRIEF_ARGUMENT = 'brief' satisfies keyof UpdateWorkArguments
const UPDATE_CLOSE_ARGUMENT = 'close' satisfies keyof UpdateWorkArguments
const UPDATE_RESOURCES_ARGUMENT = 'resources' satisfies keyof UpdateWorkArguments

/** The keys of `update_work`'s `on`, in the order a refusal names them. */
const WAIT_ON_KINDS = [
  'agent',
  'person',
  'time',
  'event',
] as const satisfies readonly (keyof WaitOnAsked)[]

/**
 * What `on` names, when it names exactly one thing by one non-empty word — `null` when absent or
 * when it does not, with the problem said.
 */
function whatTheWaitNames(on: unknown, problems: string[]): WaitOnAsked | null {
  if (on === undefined) return null
  const named =
    on !== null && typeof on === 'object' && !Array.isArray(on)
      ? Object.entries(on as Record<string, unknown>)
      : null
  const [only] = named ?? []
  if (
    named === null ||
    named.length !== 1 ||
    only === undefined ||
    !(WAIT_ON_KINDS as readonly string[]).includes(only[0]) ||
    typeof only[1] !== 'string' ||
    only[1].trim() === ''
  ) {
    problems.push(
      `${UPDATE_ON_ARGUMENT} must name exactly one of ${WAIT_ON_KINDS.join(', ')}, as a word: such as { "person": "<the question's id>" }`,
    )
    return null
  }
  return { [only[0]]: only[1].trim() } as WaitOnAsked
}

/**
 * 🔴 **D-016 · commit 6 · every argument `take_on_work` advertises, as a TYPE** — `415`'s device.
 * ⛔ The door's own names, handed over untouched: `takeOnWorkRequestSchema` is `.strict()`, so an
 * argument it does not know is refused BY NAME.
 */
interface TakeOnWorkArguments {
  readonly definition_of_done: string
  readonly piece?: string
  readonly inputs?: readonly string[]
  /** What the piece is called — one line. */
  readonly title: string
  /** What was asked, as the conversation taking it on understands it. */
  readonly brief: string
}

export const TOOL_PERMANENCE: Readonly<Record<ToolRefusal, RailPermanence>> = {
  'theme-invalid': 'while-this-holds',
  'theme-is-built-in': 'permanent',
  'theme-exists': 'while-this-holds',
  'theme-unknown': 'while-this-holds',
  'theme-too-large': 'while-this-holds',
  // 🔴 **`permanent` since `424`, and the note here read *"an id that is not yours now can become
  // yours — you can spawn it"*** (HO-023 §2.1, `422` row 4). ⛔ **That answers about a DIFFERENT
  // id.** A spawn mints a new `sess_<uuid4>`; it does not make the id in this call reachable, and
  // no claim or grant verb does. ⚑ *"Change the call, not the world"* is precisely what
  // `list_agents` is for, and the sentence already says so.
  //
  // ⚑ **D-017 · R12 — and it no longer overstates**: it is said only about an id no conversation
  // has, and nothing makes an id exist.
  'no-such-agent': 'permanent',
  // ⚑ **D-017 · R12** — nothing the caller does starts it, and waiting does not either.
  'that-conversation-takes-no-messages': 'permanent',
  // ⛔ Permanent for THIS request: the same arguments will be malformed forever.
  'malformed-request': 'permanent',
  // 🔴 **`until-a-person-changes-it` since `424`, once the arm that made it false was SPLIT off**
  // (`422` row 6) — ⛔ **and again at `650`, because two more arms made it false.**
  //
  // ⚠️ **This comment said the fold held TWO arms, a conversation that will not take a turn and a
  // Claude sign-in the machine has moved on from, and that *not one of those arms is the world is
  // busy and will stop being*.** `650` counted twenty-three routes from `queueMessage` into this
  // catch, and two of the ones an agent really meets were exactly that: a launch in flight, and a
  // turn another sender opened first. ⚑ The first has its own word, typed where the fact is known;
  // ⛔ the second had one from `650` until `657`, which made a lost race a HOLD rather than a refusal.
  //
  // ⛔ **What remains, and each is a state nothing but a person changes:** a session that stopped
  // taking turns inside `send`. ⚑ A Claude sign-in the machine has moved on from no longer refuses
  // an agent: its words are held and the app reopens the conversation for them
  // (`RuntimeHost.reopenForWhatWaits`). ⚑ **D-017 · R1 — a conversation on its way out, or over, is
  // no longer here**: the message waits it out and starts it again.
  //
  // 🔴 **And what it still folds that is NOT known to be a person's, named rather than implied:** a
  // Claude turn stopped while its settings were being acknowledged; an adapter handover failure
  // (Claude's settings acknowledgement, a rejected Codex `turn/start`, Codex's plan-mode model
  // check); and a ledger READ that failed.
  // ⚠️ Nobody can observe how long any of those last, and a non-retryable word fails closed against
  // a retry loop — the cost is a caller that stops early.
  'agent-cannot-take-a-message': 'until-a-person-changes-it',
  // ⚑ **A launch in flight clears with nobody acting** (650): the provider registers and the same
  // call is admitted, or the launch fails and the reservation is abandoned, and the same call then
  // meets `no-such-agent` — at `withdraw_task` (since `657`) `not-a-piece-you-gave`, that door's
  // ended-child fold. ⛔ The same permanence `INTERRUPT_RAILS` gives this word — the census
  // that lets it be shared checks that they match.
  'that-conversation-has-not-started': 'while-this-holds',
  // ⛔ **Permanent: a conversation can never send itself a message.** See the rail's own note.
  'that-agent-is-you': 'permanent',
  // ⛔ **Permanent: who is below whom is fixed by who started whom.**
  'that-agent-is-not-below-you': 'permanent',
  // ⚑ **A person has to throw the switch back**, which is exactly what this word is for — and it is
  // the same permanence `SPAWN_RAILS` gives the same switch.
  'spawning-disabled': 'until-a-person-changes-it',
  // ⚑ **657 · an end its commander asked for, a shutdown, a sign-in or config** — somebody has to
  // decide something first (after an end, the caller itself: a new spawn is a new decision), and none
  // clears because time passes. See the word's own note. ⚠️ A binary was here until `716` (R67).
  'agent-did-not-start': 'until-a-person-changes-it',
  // ⚑ **657 · a provider that did not answer in time** — the timed-out launch is stopped and its
  // reservation abandoned, so the same call is a fresh launch nobody has to act before.
  'agent-took-too-long-to-start': 'while-this-holds',
  // ⚑ **D-016 · the start it waited on has landed, and failed** — nothing is left in flight, and the
  // identical give starts a new conversation with nobody acting first.
  'the-start-it-waited-on-did-not-happen': 'while-this-holds',
  // ⚑ **707 · a machine that ran short** — the launch is abandoned (its reservation dropped; a
  // provider home it prepared stays, and the next launch reuses it), so the same call is a fresh
  // launch; what it waits on is the machine getting back what it lent out.
  'agent-could-not-start-just-now': 'while-this-holds',
  // ⚑ **710 · R51 — a program this machine cannot run** stays that way until somebody puts it back,
  // makes it runnable or gives the child its folder again — the wake's mirror word's permanence.
  'agent-could-not-be-started': 'until-a-person-changes-it',
  // ⚑ **A person has to widen the grant.** Nothing the caller can do changes it, and no retry helps.
  'may-not-create-agents': 'until-a-person-changes-it',
  // ⛔ **Permanent: the same arguments name the same taken name forever.** Unlike its two
  // neighbours, this is a fact about the CALL rather than about the world — `malformed-request`'s
  // shape, one rail over.
  'agent-name-taken': 'permanent',
  // ⚑ A person turns services on; nothing the caller can do does.
  'services-are-off-so-none-is-made': 'until-a-person-changes-it',
  // ⛔ **Permanent: a name that names nothing of yours will not start naming something** (429) —
  // see the rail's own note.
  'not-a-piece-you-gave': 'permanent',
  // ⛔ **Permanent: `answered` is terminal.** No person, no grant and no later state of the world
  // un-answers a piece, and `429` §3.1 forbids the one verb that might have looked like a way back.
  'that-piece-was-already-answered': 'permanent',
  // ⛔ **Permanent: taken back is terminal too**, and there is no verb that reopens a piece.
  'that-piece-was-already-taken-back': 'permanent',
  // ⚑ **Transient by construction — a flush ends at the next turn boundary**, and the retry lands
  // on the arm of this verb that never touches a mailbox. See the rail's own note.
  'that-work-is-being-sent': 'while-this-holds',
  'a-conversation-with-its-questions-is-starting': 'while-this-holds',
  'its-questions-could-not-all-be-read': 'while-this-holds',
  // Direct writing follows a fixed host role; a per-profile grant cannot enable it.
  'may-not-write-rules': 'permanent',
  // ⛔ **`until-a-person-changes-it`, and the person could change it two ways** — by widening the
  // grant, or by answering the proposal this caller may still make. ⚑ Either way the thing that
  // moves is a person, which is what this word means.
  'may-not-relay-a-rule': 'until-a-person-changes-it',
  // 🔴 **628 · `permanent`, and it is `that-agent-is-you`'s row one object over.** ⛔ A
  // `message_agent` naming work this caller HOLDS can never become the right call however long
  // anybody waits: the direction is wrong, not the world. ⚑ *Change the call, not the world* — and
  // the call to change it to is named in the sentence.
  'that-is-work-you-hold': 'permanent',
  // ⚑ **D-016** — the same row for the caller's own root.
  'that-is-your-own-work': 'permanent',
  // ⚑ **663 · a stop in flight** — the same call once it has landed, `that-conversation-has-not-
  // started`'s shape on the other side of a run.
  'that-conversation-is-still-stopping': 'while-this-holds',
  // ⚠️ **663 · a person's to look at** — see the rail's own note for why not `permanent`.
  'that-conversation-could-not-be-resumed': 'until-a-person-changes-it',
  // 🔴 **705 · R39 — `while-this-holds`, and the thing that ends it is the machine**: a descriptor,
  // a process slot or memory something else lets go of. ⚑ The identical wake then succeeds with
  // nobody acting (`apps/desktop/test/a-shortage-that-clears-by-itself.test.ts`, walked to `ok`).
  'that-conversation-could-not-be-woken-just-now': 'while-this-holds',
  // ⚑ **D-012 · the chain does not change** — a conversation is below you or it is not. ⚑ **D-024 ·
  // R2 — nor does a conversation's identity**: it is of your profile or it is not.
  'not-a-conversation-below-you': 'permanent',
  // ⚑ **D-016 · the name, the piece's giver and whether it has ended do not change by waiting.**
  'no-piece-by-that-name': 'permanent',
  'the-giver-names-a-piece': 'permanent',
  'that-piece-has-ended': 'permanent',
  'the-giver-briefs-and-closes-a-piece': 'permanent',
  // ⛔ **Permanent: closed is terminal too**, as taken back is.
  'that-piece-was-already-closed': 'permanent',
  // ⚑ **D-016 · commit 6 — a conversation never gains a root.**
  'no-work-of-your-own': 'permanent',
  'work-record-unavailable': 'while-this-holds',
  // ⚑ **F009 — the name is the call's**: the same name names nothing the next time either.
  'no-agent-by-that-name': 'permanent',
  'that-conversation-is-not-archived': 'permanent',
  // The archive or the delete lands by itself.
  'it-is-being-archived-or-deleted': 'while-this-holds',
  // A person has to let this app write the file it keeps the archived conversations in.
  'it-could-not-be-restored': 'until-a-person-changes-it',
  'server-already-registered': 'permanent',
  // The person deciding the waiting request, or requests, is what clears these two.
  'server-already-asked-for': 'until-a-person-changes-it',
  'too-many-server-requests': 'until-a-person-changes-it',
  // Once the piece is handed over, the same message reaches the service.
  'that-piece-is-still-queued': 'while-this-holds',
}

/**
 * 🔴 **425 · what the caller may do instead — every remedy-bearing tool rail has an answer**
 * (HO-023 §2.2).
 *
 * ## 🔴 The open-work word went with the open-work rail (D-016)
 *
 * ⛔ **A busy conversation takes a piece of work now**, so no word here refuses a second one; nor
 * does one holding a stalled piece of the giver's: the give's answer names that piece, with
 * the act — follow it up, or take it back.
 *
 * ## 🔴 `no-such-agent` gets NOTHING, and `424` has since said the same thing louder
 *
 * ⛔ **This was the `null` that was hardest to leave empty, and it was written while the rail still
 * said `while-this-holds`.** `agentCard` returns null for an id that does not exist AND for one the
 * caller may not reach (`422` §1 row 4), and the fold is deliberate: separating them would answer
 * *that agent exists and is not yours*, which is the existence disclosure the fold is there to
 * prevent. ⚑ `list_agents` composes a DIFFERENT call and a give that starts a conversation mints a
 * DIFFERENT id — **neither makes the refused id reachable**, and no claim or grant verb does.
 * 🔴 A remedy here would be the exact shape `425` §2 forbids: a promise about an object whose
 * entitlement this app has just declined to state. ⚠️ **`424` then repriced the rail `permanent`**,
 * so the `null` now also follows from the biconditional — two independent reasons for one answer.
 *
 * ⚑ **`agent-cannot-take-a-message` gets nothing for a different reason, and `424` has now acted on
 * it.** `422` §6 finding 1 measured it as a CATCH-ALL rather than a state rail — it swallowed the
 * caller messaging its own advertised id, which no published tool can ever make succeed. ⛔ `425`
 * wrote this `null` saying *it needs a split before it can carry a promise, and the split is `424`'s*;
 * ⚠️ **`424` then split {@link ToolRefusal}'s `that-agent-is-you` out of it and repriced the
 * remainder to `until-a-person-changes-it`.** Both are still `null`, and now for stated reasons
 * rather than for a deferred one. 🔴 **`650` made the second split `425` asked for** — a launch in
 * flight and a turn that reached the agent first each left the fold with an act of their own, and
 * the `null` that remains is the one a person's state earns.
 *
 * ⚑ **Every remaining `null` is explained beside its entry rather than by a count here.**
 */
const TOOL_REMEDY: Readonly<Record<ToolRefusal, RefusalRemedy | null>> = {
  'theme-invalid': 'change-what-you-sent-and-call-again',
  'theme-exists': 'change-what-you-sent-and-call-again',
  'theme-unknown': 'change-what-you-sent-and-call-again',
  'theme-too-large': 'change-what-you-sent-and-call-again',
  'theme-is-built-in': null,
  'no-such-agent': null,
  'that-conversation-takes-no-messages': null,
  'malformed-request': null,
  'agent-cannot-take-a-message': null,
  // ⚑ **650 · the arm split out of the fold above carries the word that fold never could.**
  // ⛔ It clears with nobody acting, so it is retryable, and `shared/refusals.ts`' biconditional
  // — *a rail carries an act if and only if this app can retry it* — requires the act. ⚠️ It says
  // what to DO and never that it will work: a launch that fails meets `no-such-agent` on the retry
  // (`not-a-piece-you-gave` at `withdraw_task`, since `657`).
  // (`650` split a second arm here, the lost race; `657` made that a hold and retired its word.)
  'that-conversation-has-not-started': 'make-the-same-call-when-this-settles',
  // 🔴 **424's new rail, and this line is the compile error it caused.** ⛔ `425` merged `424` and
  // the build refused: *"Property 'that-agent-is-you' is missing"*. ⚑ **That is the whole argument
  // for the exhaustive `Record` in one message** — a rail added by another dispatch could not reach
  // a model until somebody said what its holder may do. ⚠️ **Nothing**: the words were the caller's
  // own, no verb in the roster makes a session command itself, and *"change the call, not the
  // world"* is what `permanent` already tells it.
  'that-agent-is-you': null,
  'that-agent-is-not-below-you': null,
  'spawning-disabled': null,
  // ⛔ **657 · nothing this caller can do** — the biconditional's other half.
  'agent-did-not-start': null,
  // ⚑ **657 · the same call, once the stopped launch is gone** — which is this word's own
  // definition: something in flight, and the act is the same call after it has landed.
  'agent-took-too-long-to-start': 'make-the-same-call-when-this-settles',
  // ⚑ **D-016 · the same call, now the start it waited on has settled** — the biconditional's
  // other half: retryable, so it carries the act.
  'the-start-it-waited-on-did-not-happen': 'make-the-same-call-when-this-settles',
  // ⚑ **707 · the same call, once the shortage has cleared** — the wake's act (`705`), at this door.
  'agent-could-not-start-just-now': 'make-the-same-call-when-this-settles',
  // ⛔ **710 · nothing this caller can do** — the biconditional's other half, as for the wake's mirror.
  'agent-could-not-be-started': null,
  'may-not-create-agents': null,
  'agent-name-taken': null,
  'services-are-off-so-none-is-made': null,
  // 🔴 **429 · three nulls and one word, and the biconditional decided all four before this table
  // was written.** ⛔ `list_tasks` composes a DIFFERENT call and that is not a remedy —
  // `reply-rails.ts` ruled it: *finding another id is not making this id succeed*.
  'not-a-piece-you-gave': null,
  // ⛔ **Nothing, and `429` §4 predicted a word here.** §3.1 of the same brief refuses to withdraw
  // an answered task, and it is right — taking back work somebody already did is a different claim
  // about history. ⚑ **Giving the same words as new work is a DIFFERENT call**, which is what
  // `permanent` says. See the rail.
  'that-piece-was-already-answered': null,
  // ⛔ **Nothing: the caller already did this.** There is no act left on a piece it took back itself.
  'that-piece-was-already-taken-back': null,
  // ⚑ **The one rail `429` adds that carries an act**, and the only one of the four that is
  // `while-this-holds`. ⛔ **It is not hope**: the flush ends at the next turn boundary and the
  // retry meets the arm of this verb that never touches a mailbox.
  'that-work-is-being-sent': 'make-the-same-call-when-this-settles',
  'a-conversation-with-its-questions-is-starting': 'make-the-same-call-when-this-settles',
  'its-questions-could-not-all-be-read': 'make-the-same-call-when-this-settles',
  // ⛔ **Nothing, and the biconditional decided it** — *"a rail carries an act if and only if this
  // app can retry it"*. Neither is `while-this-holds`, and the act that clears both is a person's.
  'may-not-write-rules': null,
  // ⚠️ **Nothing, and NOT *ask instead***. `REFUSAL_REMEDIES` names acts this app can RETRY, and
  // asking is a different call with a different outcome — `not-a-piece-you-gave`'s ruling:
  // *finding another id is not making this id succeed*. ⛔ The SENTENCE tells the caller it may ask;
  // the remedy field would promise this call could be replayed, and it cannot.
  'may-not-relay-a-rule': null,
  // ⚑ **663 · the biconditional's other half**: retryable, so it carries the act.
  'that-conversation-is-still-stopping': 'make-the-same-call-when-this-settles',
  'that-conversation-could-not-be-resumed': null,
  // ⚑ **705 · R39 — the biconditional's other half, as `that-conversation-is-still-stopping`'s**:
  // retryable, so it carries the act, and the act is the same call once the shortage has passed.
  'that-conversation-could-not-be-woken-just-now': 'make-the-same-call-when-this-settles',
  // ⚑ **D-012 · not retryable, so it carries no act** — the biconditional.
  'not-a-conversation-below-you': null,
  // ⚑ **D-016 · not retryable, so none carries an act** — the biconditional; each sentence names
  // the call that is right instead.
  'no-piece-by-that-name': null,
  'the-giver-names-a-piece': null,
  'that-piece-has-ended': null,
  'the-giver-briefs-and-closes-a-piece': null,
  // ⛔ **Nothing: the caller already did this**, as for a piece it took back itself.
  'that-piece-was-already-closed': null,
  // ⚑ **D-016 · commit 6 · not retryable, so it carries no act** — the biconditional; the sentence
  // says what to do instead.
  'no-work-of-your-own': null,
  'work-record-unavailable': 'make-the-same-call-when-this-settles',
  // ⚑ **F009 · permanent, so no act** — the sentence names the door that lists every agent.
  'no-agent-by-that-name': null,
  'that-conversation-is-not-archived': null,
  'it-is-being-archived-or-deleted': 'make-the-same-call-when-this-settles',
  'it-could-not-be-restored': null,
  // Not retryable, so no act: the sentences say what to do instead.
  'server-already-registered': null,
  'server-already-asked-for': null,
  'too-many-server-requests': null,
  // 🔴 **628 · `null`, and the BICONDITIONAL decided it before this line was written** —
  // {@link REFUSAL_REMEDIES}: *"a rail carries an act if and only if this app can retry it."*
  // ⛔ This rail is `permanent`, so it may promise nothing.
  //
  // ## ⚠️ 628 relay 1 asked whether this member could populate the field after all
  //
  // ⛔ **The question was fair and it came with a measurement** (in the words the rails had until
  // D-016): in the clean-install run, `no-task-you-gave-that-agent` — `not-a-piece-you-gave` now —
  // was the ONLY rail of eight that answered `remedy: null`, and it
  // fired three times across two agents. ⚑ *"If this member can honestly populate it too — even
  // with a key that means change the call — then the asymmetry goes away."*
  //
  // 🔴 **It cannot, and the relay's own table is the proof.** Every rail in that run that
  // populated the field is `while-this-holds`:
  //
  // | rail | permanence | remedy |
  // |---|---|---|
  // | `agent-already-has-work-open` | while-this-holds | ✅ `withdraw-the-work-or-ask-about-it` |
  // | `agent-already-has-a-message-waiting` | while-this-holds | ✅ `withdraw-the-work-or-ask-about-it` |
  // | `summary-too-long` | while-this-holds | ✅ `shorten-the-summary-and-attach-the-long-form` |
  // | `no-task-you-gave-that-agent` | **permanent** | 🔴 `null` |
  //
  // ⚑ **The asymmetry IS the partition**, observed in the field rather than argued: the four that
  // carry an act are the four whose condition ends on its own, and the one that does not is the
  // one where nothing about waiting helps. ⛔ **A key meaning *change the call* would have to be a
  // new member of {@link REFUSAL_REMEDIES}, and the vocabulary's own note forbids exactly that**:
  // *"a `RefusalRemedy` means the thing you were trying to do is waiting on something"*, and
  // *"change the call, not the world"* is what `permanent` already tells a caller — in
  // {@link PERMANENCE_SAID}, which every refusal already carries. ⚠️ **Two fields saying one
  // thing, and the weaker of the two would be the one that was wrong** — the vocabulary's own
  // argument against a remedy that also promises an outcome.
  //
  // 🔴 **And the run says instruction alone does not close it**: `HO-095` §3's worker hit this rail
  // holding creation instructions that already named `ask_question` correctly. ⛔ Which is why the
  // repair is a SENTENCE on a SPLIT rail rather than a word in this field.
  //
  // ⚑ **`may-not-relay-a-rule` is the precedent, word for word**: *"The SENTENCE tells the caller
  // it may ask; the remedy field would promise this call could be replayed, and it cannot."*
  // ⚠️ **`ask_question` is a DIFFERENT call with a different outcome** — it records a question and
  // leaves the work open — so a word here would say *replay this* about the one call that must not
  // be replayed. 🔴 **The act is not lost; it is said where it can be true**, which is `489`'s own
  // three rails above and `441` §2.2's register.
  'that-is-work-you-hold': null,
  // ⚑ **D-016 · null, for the same reason** — permanent; the act is in the sentence.
  'that-is-your-own-work': null,
  'that-piece-is-still-queued': 'make-the-same-call-when-this-settles',
}

/** ⛔ **What a caller may do instead, or `null` because this app knows of nothing** (425). */
export function toolRemedyOf(rail: ToolRefusal): RefusalRemedy | null {
  return TOOL_REMEDY[rail]
}

/**
 * 🔴 **`341`'s payload, as a TYPE — the shape every registered rail door already builds** (405).
 *
 * ⛔ **Declared so the carriers below stop returning `Readonly<Record<string, unknown>>`.** They
 * each built exactly this and then threw the shape away one line later, which was harmless while
 * the payload only ever went to a model. ⚑ **`405` gave it another reader** — the ledger row
 * {@link ToolRefusedEvent} — and a bag of unknowns is the wrong thing to derive a durable record
 * from: it makes *"the required policy fields are always there"* a habit rather than a compile error.
 *
 * ⚠️ **`rail` is a `string` and not a union of the registered vocabularies.** Widening it would mean
 * re-widening it at every future door, and the door that built the payload has ALREADY narrowed it
 * — the carrier helpers each take a typed refusal and re-derive the permanence
 * from that vocabulary's own table. ⛔ This type's job is to stop required fields going missing,
 * not to re-check a word its caller could not have got wrong.
 */
export type PublishedRefusal = {
  readonly outcome: 'refused'
  readonly rail: string
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  /**
   * 🔴 **425 · what the caller may do instead, as a word — or `null`, which is an ANSWER** (HO-023
   * §2.2).
   *
   * ⛔ **Beside {@link reason} and never instead of it.** The model already gets a sentence, and on
   * most of the rails that carry a word the sentence is where the remedy has always been;
   * replacing it with a code would take prose away from the reader it already worked for. ⚑ This
   * field is what the LEDGER gains: a durable, testable fact a person's transcript can draw, which
   * `405` §2 discarded along with the request.
   *
   * ⚠️ **`null` for most of the rails, and since `424` that is exactly the rails
   * this app cannot retry.** See {@link TOOL_REMEDY} and the sibling remedy tables for the argument,
   * one rail at a time, and `shared/refusals.ts` for the biconditional the dispatches arrived at
   * independently.
   */
  readonly remedy: RefusalRemedy | null
  /**
   * ⚠️ **`object`, and the looseness is a TypeScript fact rather than a design one.** Each door
   * declares its own `…RefusalDetail` as an INTERFACE, and an interface has no implicit index
   * signature — so `Readonly<Record<string, unknown>>` here would reject the door-specific detail
   * interfaces. ⛔ Nothing
   * in this app reads a detail structurally: it is carried to the model verbatim, and `405` §2 keeps
   * it off the ledger row entirely.
   */
  readonly detail: object
}

/**
 * ⛔ **The policy facts a person must be able to see**, lifted off a payload that is
 * about to be handed to a model.
 *
 * ⚠️ ***That* it was refused is the existence of the row itself.** `detail` is deliberately
 * absent: it names ids and folders. §2: *record the refusal, not the request.* ⚑ The sentence is
 * kept ({@link RefusalFacts.told}): a door composes it from more than its rail, so a reader cannot
 * derive it again.
 */
export interface RefusalFacts {
  readonly rail: string
  readonly permanence: RailPermanence
  readonly retryable: boolean
  /**
   * 🔴 **425 · the FOURTH fact, and the one `405` §2 threw away** (HO-023 §2.2).
   *
   * ⛔ **It is not the request coming back.** A {@link RefusalRemedy} is a word from a closed list and
   * carries no data at all — no id, no path, no formatting slot — so *record the refusal, not the
   * request* survives intact: what this adds is the app's own static next act. ⚠️ **`detail` is
   * still absent** for the reason stated above.
   */
  readonly remedy: RefusalRemedy | null
  /**
   * ⚑ **The sentence the caller was handed**, as its row keeps it (`ToolRefusedEvent.told`): the
   * payload's own `reason`, never words read back from a provider. Absent when the payload carried
   * none. ⛔ `detail` stays off the row: it names ids and folders and the problems with a request.
   */
  readonly told?: RefusalTold
}

/** A refusal in `341`'s shape, from this file's vocabulary. */
export interface ToolRefusalPayload {
  readonly outcome: 'refused'
  readonly rail: ToolRefusal
  readonly permanence: RailPermanence
  readonly retryable: boolean
  readonly reason: string
  /** ⛔ **425 · the act left, as a word** — see {@link PublishedRefusal.remedy}. */
  readonly remedy: RefusalRemedy | null
  readonly detail: Readonly<Record<string, unknown>>
}

const TOOL_SENTENCES: Readonly<Record<ToolRefusal, string>> = {
  ...THEME_TOOL_REASONS,
  // ⚑ **D-017 · R12 — said about an id NO conversation has** (`05` rule 6) — ⚑ and, the same answer
  // (D-016 · commit 7 · R1), about a piece label that names no piece whose owner the asking door's
  // reach admits (`TheDoorsReach`): a label never says whether a piece exists. ⛔ It folded *not yours* into *not there* for
  // an id until D-017, and a conversation a quit left open was answered this word by every agent but
  // the one that started it — Ayo's work to Ana, measured live. ⚑ A conversation that exists and is
  // outside the caller's reach, named by its id, gets the reach rail `message_agent` meets, at every
  // door that takes an id.
  //
  // ⚑ **628's invariant**: a `permanent` refusal carries no `remedy`, so the act is HERE —
  // `list_agents` names the conversations a caller can reach, and `list_profiles` every agent
  // `give_work` can name, which reaches a conversation of the giver's own rather than this one.
  // ⚑ Neither door can refuse this caller (`402`). ⛔ **The whole row stays within the 200-character
  // bound a person reads a refusal by** (`644` §3.1): 197 with *"id or piece label"*.
  'no-such-agent':
    'no conversation you can reach goes by that id or piece label, so nothing was done. list_agents names the ones you can reach; list_profiles names every agent this app holds.',
  // ⚑ **D-017 · R12** — the act first, inside the cut; then which kinds of conversation this is.
  'that-conversation-takes-no-messages':
    'that conversation cannot be started by a message, so nothing was sent to it; list_agents names the ones you can reach. It is a read-only copy, a provider\u2019s own sub-agent, or a conversation this app did not start.',
  'malformed-request':
    'the arguments did not match what this tool accepts, so nothing was done. The problems are listed in the detail: fix each one and call this tool again.',
  // ⚠️ **It says who can change it, because nothing the caller does will** (424). The old sentence
  // stopped at the state and carried `retryable: true`, which read as *come back in a minute*.
  'agent-cannot-take-a-message':
    'ask a person to inspect why that conversation cannot take a message; do what you can here. Nothing was queued, and retrying will not help until its state changes.',
  // 🔴 **650 · a launch in flight.** ⛔ Its own sentence and not `INTERRUPT_RAILS'`: that one says
  // *nothing running to interrupt*, which is about the other door's act. ⚑ It says both ways the
  // wait can end, because the retry after a launch that fails meets `no-such-agent` (at
  // `withdraw_task`, `not-a-piece-you-gave`; at `update_work`, `no-piece-by-that-name`).
  // ⚠️ **657 · and it is said at THREE doors of this vocabulary now** — `message_agent`,
  // `withdraw_task` and, since D-016, `update_work`'s close — so its first clause names what was
  // refused of none of them: it said *nothing was sent or queued*, which is a message's fact, and a
  // withdrawal or a close is not a message.
  'that-conversation-has-not-started':
    'that conversation has not started yet, so nothing was done to it. It comes up or fails to launch on its own: make the same call again in a moment.',
  // 🔴 **It names the mistake rather than the state** (424). A caller that addressed itself was
  // told its target was busy, which is the one thing it was not.
  'that-agent-is-you':
    'that is this conversation: a conversation cannot send itself a message, so nothing was queued. Whatever you meant to send, do it yourself — or send it to another agent.',
  'that-agent-is-not-below-you':
    'that agent is not one you started, or one started under them, so nothing was sent: only those can be interrupted. Call message_agent again without interrupt and the message goes out when that agent is free.',
  // ⛔ **The sentence carries what the switch's own label does not.** A person turned agent
  // creation off by switching off agents starting new conversations, and a refusal that said only
  // *no* would leave a model retrying a rule only a person can change. ⚠️ It says nothing was
  // created, because the one thing a caller must not have to guess is whether a durable row exists
  // now. ⚑ D-016 · ruling 12's words for the switch (spec D30).
  'spawning-disabled':
    'creating agents is off: a person has switched off agents starting new conversations. Nothing was created, and no retry will pass until they switch it back on.',
  // 🔴 **657 · it says no RULE refused it**, because the row a person reads says *refused* — and a
  // launch that failed is not a policy. ⚑ Short enough to reach a person whole (the 200 cut).
  // ⚠️ **True on every arm, which its first draft was not**: it said *a person has to change that
  // first*, and the arm `657`'s own test ran was a parent ending its own starting child — nobody else
  // was involved, and the same call then starts (review of `657`). ⚑ **D-017** — *ended* went with
  // `end_agent`. ⚠️ What stops a launch in flight is a person's Close of it in this app (`cancelled`)
  // or this app quitting (`shutting-down`), and *somebody stopped it first* is true of both.
  'agent-did-not-start':
    'ask a person to read the detail and decide whether to start that conversation again. It did not start, no rule refused it, and nothing was sent: somebody stopped it first or a person must fix something.',
  'agent-took-too-long-to-start':
    'that agent\u2019s conversation did not answer in time and was stopped before it started, so nothing was sent. Nobody has to act: make the same call again.',
  // ⚑ **D-016 · the act first, inside the cut.** ⚠️ Why the start failed is not this call's to say:
  // the call that was starting it met that failure and answers it.
  'the-start-it-waited-on-did-not-happen':
    'your conversation with that agent was still starting and never came up, so nothing was given. Give it again: that starts a new one.',
  // 🔴 **707 · R39, extended — the act first, inside the 200-character receipt**
  // (`the-act-inside-the-cut`), and the reason after it: the wake's sentence (`705`), at this door.
  'agent-could-not-start-just-now':
    'that agent\u2019s conversation could not be started just now, so nothing was sent. Make the same call again in a moment: its provider could not be started because this machine ran short of open files, processes or memory, which usually clears by itself.',
  // 🔴 **710 · R51 — the act first, inside the 200-character receipt** (`the-act-inside-the-cut`),
  // then what is wrong in words — the wake's permanent sentence (`that-conversation-could-not-be-resumed`),
  // at this door. ⚠️ It says *may*: Node names the program for a missing folder too.
  'agent-could-not-be-started':
    'that agent\u2019s conversation could not be started, so nothing was sent. Starting it again will not help until a person has looked: this machine could not run its provider\u2019s program \u2014 it may be missing or not runnable, or the folder it runs in may be gone. The detail names the error.',
  'may-not-create-agents':
    'ask a person to grant agent creation. You do not have that right, so nothing was created; repeating this call will not grant it.',
  // ⚠️ **It teaches the remedy, which is a different name** — and it says the comparison ignores
  // case, because a model that tried the same name capitalised differently would meet this twice.
  'agent-name-taken':
    'there is already an agent with that name, so nothing was created. Names are compared without case. Choose a different name, or use the agent that exists.',
  'services-are-off-so-none-is-made':
    'Not created: services are off. A person turns them on in Team.',
  // ⛔ **It names where the right label is and promises nothing about this one** — the split
  // `reply-rails.ts` made between a sentence that helps and a field that promises. ⚠️ **Two doors
  // say it and only one names an agent** — `message_agent`'s follow-up, not `withdraw_task` — so
  // the agent clause is said as the condition it is.
  'not-a-piece-you-gave':
    'that is not a piece you gave (or, when the call names an agent, not one you gave that agent), so nothing was done. list_tasks lists the open pieces you gave out, and with state: "all" the ended ones too; the name may belong to another conversation, or to nothing at all.',
  // 🔴 **HO-023 §5's second clause is in the DETAIL and the sentence points at it.** The label, the
  // outcome and the resources are facts about work that exists; a sentence that merely said *no*
  // would leave a giver re-sending blind, which is the measurement this rail came from.
  'that-piece-was-already-answered':
    'that piece was already answered, so there was nothing to take back and nothing was done. Read the reply first; for genuinely new work, give it with give_work. Its label, the outcome the agent gave and the resources its reply handed in, if any, are in the detail.',
  // ⚠️ **It says the caller did this**, because the alternative sentence — *that piece is finished* —
  // would send a giver looking for a reply nobody wrote.
  'that-piece-was-already-taken-back':
    'you have already taken that piece back, so there was nothing left to take back and nothing was done. No further action on this piece is owed.',
  // ⚑ **D-016 · said at `withdraw_task` and at `update_work`'s close**, so it names both acts.
  'that-work-is-being-sent':
    'the message carrying that work is being sent right now, so nothing was done: make this call again once it has gone. Work cannot be taken back or closed while that message is mid-flight.',
  // Said with the piece's label at each door (`aPieceNotEndedWhileAQuestionStarts`).
  'a-conversation-with-its-questions-is-starting':
    "that piece wasn't taken back or closed: a conversation with a question about it is still starting. Try again in a moment.",
  // Said with the piece's label at each door (`aPieceNotEndedItsQuestionsUnread`).
  'its-questions-could-not-all-be-read':
    "that piece wasn't taken back or closed: its questions couldn't all be read. Try again; if it fails again, ask a person.",
  // Grants do not select the app's direct writer.
  'may-not-write-rules':
    'Only BroBot writes other agents’ standing rules directly. You can propose a change with propose_agent_rules, and the person decides. Nothing was written.',
  // 🔴 **It tells the caller what it MAY do**, because the narrower grant it holds is a real answer
  // rather than a consolation: the proposal arm is open to it and a person will decide.
  'may-not-relay-a-rule':
    'you may ask for these rules but not write them, so nothing was written and nobody asked. Ask again without claiming it was already agreed, and a person will decide: relaying a rule on somebody’s behalf is a separate grant you do not hold.',
  // 🔴 **628 · the sentence carries the ACT, because the remedy FIELD may not** (`HO-095` §3.2,
  // and `HO-096` §2.2's *"copy the shape, not only the principle"*).
  //
  // ⛔ **Five clauses, and they are `summary-too-long`'s five**: what was refused · why · what was
  // NOT done · that the id is real and whose it is · and **a performable act in the caller's own
  // vocabulary**. ⚑ The model refusal reads *"it can shorten the summary and put the long form in
  // a file it names"*; this one names two verbs and says what each does to the work, because the
  // whole defect was a manager choosing between them with nothing to choose on.
  //
  // ⚠️ **It names BOTH verbs rather than only the right one**, and that is the measurement rather
  // than helpfulness: BroBot's wrong instruction — *"send me the plan with `message_agent` as a
  // question — not `reply_to_parent`"* — was a worry about `reply_to_parent` closing the task, and
  // it was CORRECT. ⛔ A sentence that named only `ask_question` would leave the reader holding the
  // same unanswered worry it routed around last time.
  //
  // ⚑ **Both verbs are in {@link TOOL_NAMES} and neither asks a grant**, so this names nothing the
  // refused caller cannot reach — `402`'s defect is a sentence naming a verb a rail refuses, and
  // `a-priced-cost-can-name-a-remedy-that-does-not-exist` is the same shape one level up.
  'that-is-work-you-hold':
    'that is a piece you are HOLDING, so nothing was sent. To ask about it, call ask_question naming that piece; to hand it back finished, call reply_to_parent. A follow-up is about a piece you gave to somebody else; with ask_question the work stays yours and stays open, and reply_to_parent ends it.',
  // ⚑ **D-016 · the act first, inside the cut** — and it names no verb that refuses a root. ⚠️ Said
  // at `message_agent` and at `update_work`, so it says *nothing was done*, true at both, and names
  // the acts of both doors and no other (D-023 · R2).
  'that-is-your-own-work':
    'that is this conversation\u2019s own work, from a person, so nothing was done: ask a person with ask_question naming it, and answer the person here when it is done. Follow-ups, new briefs and closing are for pieces one conversation gives another.',
  // ⛔ **663 · it gives the reason as the rule, not as the state**: a model told only *not yet* would
  // reasonably try another way in, and there is none that is safe.
  'that-conversation-is-still-stopping':
    'that conversation has not been confirmed stopped since its last run, so it was not started and nothing was sent. Make the same call again in a moment: two runs of one conversation must never overlap.',
  'that-conversation-could-not-be-resumed':
    'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: its provider may need signing in again, or could not be started.',
  // 🔴 **705 · R39 — the act first, inside the 200-character receipt** (`the-act-inside-the-cut`), and
  // the reason after it. ⛔ *usually*, because a machine that stays short keeps refusing — the
  // sentence says what to do and never that it will work.
  'that-conversation-could-not-be-woken-just-now':
    'that conversation could not be started just now, so nothing was sent. Make the same call again in a moment: its provider could not be started because this machine ran short of open files, processes or memory, which usually clears by itself.',
  // ⚑ **D-012 · the act first, inside the cut**: the other door, for an agent this one does not read.
  // ⚑ **D-024 · R2 — its last clause says the reach it now has**: a conversation of the caller's
  // own profile is read here too, and every other one keeps this answer.
  'not-a-conversation-below-you':
    'there is no conversation below you by that id or piece label, so nothing was read. To ask any other agent something, use ask_question; only conversations you started, those started under them, and your profile’s other conversations are read here.',
  // ⚑ **D-016 · the act first, inside the cut** — where the right label is.
  'no-piece-by-that-name':
    'no piece by that name is one you hold or gave, so nothing was done. list_tasks names the open pieces you hold and gave, by label, and with state: "all" the ended ones too.',
  // ⚑ **D-016 · it says what the caller MAY do**: the status line is its, and the name is its giver's.
  'the-giver-names-a-piece':
    'the one that gave you that piece names it, so its title was not changed. To have it called something else, ask it; you may set its status line.',
  // ⚑ **D-016 · said about a status line, a new brief, a close and kept files**, so it says nothing
  // was changed, which is true of each. ⚑ **F059** — `update_work` says which ending, when and by
  // whom ({@link anEndedPieceSaid}); this sentence is its fallback for a state that function does
  // not name, which no ended piece reaches today.
  'that-piece-has-ended':
    'that piece has ended — answered, closed or taken back — so nothing was changed: its last word stands. Only its title may still be changed.',
  // ⚑ **D-016 · the act first, inside the cut** — then what the owner may do instead. ⚑ **Commit 6
  // · true of both kinds of piece**: a person's piece has no giver's conversation to brief or
  // close it, and no door for the person either.
  'the-giver-briefs-and-closes-a-piece':
    'only a conversation that gave a piece gives it a new brief or closes it, so nothing was changed. Ask with ask_question to change or stop the work; you may set its status line, keep files you made for it, or hand it back with reply_to_parent.',
  // ⚠️ **It says the caller did this**, as `that-piece-was-already-taken-back` does.
  'that-piece-was-already-closed':
    'you have already closed that piece, so there was nothing left to take back and nothing was done. No further action on this piece is owed.',
  // A personal request must belong to the admitted, recorded turn.
  'work-record-unavailable': 'Your current work could not be read. Try again in a moment.',
  'no-work-of-your-own':
    'This is not a recorded person request. Use give_work for an agent’s work.',
  // ⚑ **F009 · the act first, inside the cut** — spell a name the roster holds.
  'no-agent-by-that-name':
    'name an agent by the profile list_profiles gives it: no agent has that profile, so there is no record to read. list_profiles without profile names every agent.',
  'that-conversation-is-not-archived':
    'that conversation is not archived, nor is any below it, so nothing was restored. list_agents with archived: true names the archived ones you can reach.',
  'it-is-being-archived-or-deleted':
    'that conversation is being archived or deleted right now, so nothing was restored. Call this tool again once that is done; a deleted one is then gone.',
  'it-could-not-be-restored':
    'this app could not change its list of archived conversations, so nothing was restored. Tell the person: the detail says what they need to do.',
  // The general forms; `request_mcp_server` says each with the name and numbers it met.
  'server-already-registered':
    'ask the person with ask_question (a-person) to grant it to your profile if you need that server: one by that name or at that address is already registered, and a request cannot change a registered server, so nothing was asked.',
  'server-already-asked-for':
    'wait for the person to decide the request already waiting for a server by that name, so nothing new was asked. The conversation that made it is told when they decide.',
  'too-many-server-requests':
    'wait until one is decided: as many server requests as may wait are already waiting on the person, so nothing was asked.',
  // ⚑ Said with the piece's label in place of “that piece” ({@link aMessageAboutAQueuedPiece}).
  'that-piece-is-still-queued':
    'Not sent: that piece is still queued. Change its brief with update_work.',
}

/**
 * A `request_mcp_server` refusal said with the name and numbers it met, or `null` for the rail's
 * general sentence.
 */
export function aServerRequestRefusal(
  rail: ToolRefusal,
  detail: Readonly<Record<string, unknown>>,
): string | null {
  const name = typeof detail.name === 'string' ? detail.name : null
  switch (rail) {
    case 'server-already-registered': {
      if (name === null) return null
      const already =
        typeof detail.address === 'string'
          ? `the server at ${detail.address} is already registered, as “${name}”`
          : `a server called “${name}” is already registered`
      return `ask the person with ask_question (a-person) to grant “${name}” to your profile if you need it and do not have it: ${already}, and a request cannot change a registered server, so nothing was asked.`
    }
    case 'server-already-asked-for': {
      if (name === null || typeof detail.request !== 'string') return null
      const asked = `the request already waiting on them to register “${name}”, so nothing new was asked.`
      return detail.yours === true
        ? `wait for the person to decide request ${detail.request}, which you made: it is ${asked} You will be told when they decide.`
        : `wait for the person to decide request ${detail.request}, which another conversation made: it is ${asked} If they approve it and you do not get it, ask them with ask_question (a-person) to grant it to your profile.`
    }
    case 'too-many-server-requests': {
      if (typeof detail.waiting !== 'number') return null
      return detail.from === 'this-conversation'
        ? `wait until one is decided: ${String(detail.waiting)} server requests from this conversation are already waiting on the person, so nothing was asked.`
        : `wait until some are decided, then ask again: ${String(detail.waiting)} server requests from agents are already waiting on the person, so nothing was asked.`
    }
    case 'no-agent-by-that-name': {
      const agents = Array.isArray(detail.agents) ? detail.agents.map(String) : []
      if (agents.length === 0) return null
      const said = agents.map((one) => `“${one}”`).join(', ')
      return `name each agent as list_profiles gives it: no agent has the profile ${said}, so nothing was asked.`
    }
    default:
      return null
  }
}

/**
 * ⚑ **F059 · `update_work` on a piece that has ended, said with how, when and by whom** — the facts
 * `reply_to_parent`'s refusal has said since D-025 (`endedPieceSentence`), off the row that ended it.
 *
 * ⚑ **The act first, inside the cut, and the act THIS caller has**: its owner, which may not name a
 * piece a conversation gave it, stops work on it, `reply_to_parent`'s act; a giver told its piece
 * was answered reads the answer rather than wondering why its call did nothing; and whoever may
 * still name it is told that is all it may do. ⛔ **Each fact only where the detail carries it**, and
 * the caller's own act said as its own: never its own name.
 */
export function anEndedPieceSaid(detail: EndedPieceDetail, readAt: number): string {
  const when = detail.at === undefined ? '' : ` at ${clockTimeFrom(detail.at, readAt)}`
  const by = detail.called === undefined ? '' : ` by ${detail.called}`
  const yours = detail.endedByYou === true
  const { label } = detail
  let ended: string
  switch (detail.state) {
    case 'answered':
      ended = yours ? `You answered ${label}${when}` : `${label} was answered${by}${when}`
      break
    case 'closed':
      ended = yours ? `You closed ${label}${when}` : `${label} was closed${by}${when}`
      break
    case 'withdrawn':
      ended = yours ? `You took ${label} back${when}` : `${label} was taken back${by}${when}`
      break
    default:
      return TOOL_SENTENCES['that-piece-has-ended']
  }
  const act = !detail.yoursToRetitle
    ? 'stop work on that piece; no further reply is owed.'
    : detail.state === 'answered' && !yours
      ? `read its answer with list_tasks, naming ${label}; only its title may still be changed.`
      : 'only its title may still be changed.'
  return `${act} ${ended}, so nothing was changed.`
}

/**
 * 🔴 **F087 · a follow-up naming a piece the caller HOLDS, said as what it is** — it is not one the
 * caller gave, so `not-a-piece-you-gave` is true; that word's own sentence then guesses *"the name may
 * belong to another conversation, or to nothing at all"*, which is false of the caller's own piece.
 * ⚑ **The act first, inside the cut**: the same call as a note, which may name a piece the caller
 * holds, open or ended (F086). ⚑ An OPEN piece it holds is `that-is-work-you-hold`'s, whose acts — ask
 * about it, hand it back — take open work; this is said of the rest, which a note may still name.
 */
export function aFollowUpOnAPieceYouHold(label: string): string {
  return (
    `make the same call with kind note: ${label} is a piece you hold, not one you gave, so nothing ` +
    `was sent. A follow-up names a piece you gave that agent; a note may name a piece you hold or ` +
    `gave, open or ended.`
  )
}

/** `that-piece-is-still-queued`'s sentence, naming the piece by its label. */
export function aMessageAboutAQueuedPiece(label: string): string {
  return `Not sent: ${label} is still queued. Change its brief with update_work.`
}

/**
 * 🔴 **F087 · a follow-up naming a piece the caller gave ANOTHER agent, said as what it is** — the
 * guess in `not-a-piece-you-gave`'s own sentence is false here too: the caller gave it, to another
 * conversation. ⚑ **The act first, inside the cut**: the same call to the agent holding it, which the
 * piece's label names (D-016 · commit 7 · R1) — or a note to this one, which may name any piece the
 * caller gave.
 */
export function aFollowUpOnAPieceYouGaveAnother(label: string): string {
  return (
    `make the same call with agent ${label}, which names the agent you gave it to: ${label} is a ` +
    `piece you gave, but not to that agent, so nothing was sent. A follow-up goes to the agent ` +
    `holding its piece; a note to that agent may still name it.`
  )
}

/**
 * 🔴 **F089 · `withdraw_task` naming a piece the caller HOLDS, open, said as what it is** — it is not
 * one the caller gave, so `not-a-piece-you-gave` is true; that word's own sentence then guesses the
 * name may belong to another conversation or to nothing at all, which is false of the caller's own
 * piece. ⚑ **The act first, inside the cut**: the two doors open to work it holds, as
 * `that-is-work-you-hold` names them at `message_agent`.
 */
export function aTakeBackOfAPieceYouHold(label: string): string {
  return (
    `to hand it back finished, call reply_to_parent; to ask about it, call ask_question naming it: ` +
    `${label} is a piece you hold, not one you gave, so nothing was taken back. withdraw_task ` +
    `takes back only a piece you gave.`
  )
}

/**
 * 🔴 **F089 · …and one it holds that has ENDED** — how, when and by whom, as `reply_to_parent`'s
 * refusal says an ended piece, and with its act, first: no more is owed on it.
 */
export function aTakeBackOfAPieceYouHoldThatEnded(
  held: Extract<APieceItHolds, { readonly is: 'ended' }>,
): string {
  const when = held.at === undefined ? '' : ` at ${clockTimeFrom(held.at, held.readAt)}`
  const by = held.called === undefined ? '' : ` by ${held.called}`
  const how =
    held.state === 'answered'
      ? `you answered it${when}`
      : held.state === 'withdrawn'
        ? `it was taken back${by}${when}`
        : `it was closed${by}${when}`
  return (
    `stop work on that piece; no further reply is owed. ${held.label} is a piece you hold, not one ` +
    `you gave, and it has already ended: ${how}, so there was nothing left to take back.`
  )
}

/**
 * 🔴 **F089 · …and the caller's own ROOT** — the work a person gave it, which never ends and no
 * conversation gave. ⚑ **The act first, inside the cut**: `that-is-your-own-work`'s — ask a person
 * about it, and answer the person here.
 */
export function aTakeBackOfYourOwnWork(label: string): string {
  return (
    `ask a person with ask_question naming it, and answer the person here when it is done: ` +
    `${label} is this conversation’s own work, from a person, so nothing was taken back. ` +
    `withdraw_task takes back only a piece you gave.`
  )
}

/**
 * ⛔ **Derived, never written twice** — `retryable` comes from `permanence` through one table, so
 * the two cannot disagree. `341`'s rule, and the reason it is a function rather than a field.
 */
export function refuseTool(
  rail: ToolRefusal,
  detail: Readonly<Record<string, unknown>> = {},
): ToolRefusalPayload {
  const permanence = TOOL_PERMANENCE[rail]
  return {
    outcome: 'refused',
    rail,
    permanence,
    retryable: permanence === 'while-this-holds',
    reason: refusalReason(TOOL_SENTENCES[rail]),
    remedy: toolRemedyOf(rail),
    detail,
  }
}

/**
 * ⛔ **The facts a take-back refusal states, per rail** (429).
 *
 * ⚑ **A switch over a discriminated union rather than one bag built at the door**, so the arm that
 * has no label cannot be given one and the arm that has no resources cannot grow a key for them.
 * ⚠️ **Absent, never null**, for `WorkGivenEvent.messageId`'s reason: a model reads *there was none*
 * as the absence it is, and a sentinel would be a second spelling of it.
 */
function takeBackDetail(
  piece: string,
  refused: TakeBackRefused,
): Readonly<Record<string, unknown>> {
  switch (refused.rail) {
    case 'not-a-piece-you-gave': {
      // 🔴 **F089 · and, for a piece the caller holds, what it is** — its label, and how it ended.
      const held = refused.itHoldsIt
      if (held === undefined) return { piece }
      if (held.is !== 'ended') return { piece, label: held.label }
      return {
        piece,
        label: held.label,
        state: held.state,
        ...(held.at === undefined ? {} : { at: held.at }),
        ...(held.called === undefined ? {} : { called: held.called }),
      }
    }
    case 'that-piece-was-already-answered':
      return {
        piece,
        label: refused.label,
        ...(refused.outcome === null ? {} : { answered: refused.outcome }),
        ...(refused.resources.length === 0 ? {} : { resources: refused.resources }),
        ...(refused.endedAt === null ? {} : { at: refused.endedAt }),
      }
    // ⚑ **657 · the last of these four is a launch in flight**, and it carries the piece's label
    // because the caller can act on it once the launch lands.
    case 'that-piece-was-already-taken-back':
    case 'that-piece-was-already-closed':
    case 'that-work-is-being-sent':
    case 'that-conversation-has-not-started':
    case 'a-conversation-with-its-questions-is-starting':
    case 'its-questions-could-not-all-be-read':
      return { piece, label: refused.label }
    default: {
      const exhaustive: never = refused
      void exhaustive
      return { piece }
    }
  }
}

/**
 * 🔴 **591 · the questions a take-back or a close ended, said only when it happened** — a clause
 * reading *and it ended 0 questions* on every ordinary one is a sentence about nothing.
 */
function theQuestionsItEnded(endedQuestions: number): string {
  return endedQuestions === 0
    ? ''
    : `. ${String(endedQuestions)} question${
        endedQuestions === 1
          ? ' it had asked about that work has'
          : 's it had asked about that work have'
      } ended with it, so answering ${endedQuestions === 1 ? 'it' : 'them'} now is refused`
}

/**
 * 🔴 **D-027 · how a held message goes out, in the verbs' words** — with whatever else is held for
 * that conversation, oldest first. ⛔ **Except a person's command, which goes alone**
 * (`RuntimeHost.theTurnItTakes`, `R42`): a sentence that promised *one turn with everything held*
 * would be false whenever one is held — and so would *until its turn ends*, one turn early. ⚑ So
 * the sentences that use this say *until it is free*.
 */
const WITH_WHATEVER_ELSE_IS_HELD =
  'with whatever else is held for it, oldest first (a person\u2019s command goes on its own)'

/**
 * ⚑ **A held delivery's answer when what is held waits for a reopen on the current Claude
 * sign-in, for a person to answer what its turn is stopped on, or (F074) for its provider's usage
 * limit to reset** — `held`, then why ({@link AgentToolHost.whyWhatIsHeldWaits}) — or `null`, and
 * the caller says *until it is free*. ⛔ It REPLACES that clause rather than following it: a free
 * conversation that waits for its reopen or for a reset does not take the words *at once*.
 */
function heldAndWhy(
  host: Pick<AgentToolHost, 'whyWhatIsHeldWaits'>,
  conversation: string,
  held: string,
): string | null {
  const waits = host.whyWhatIsHeldWaits(conversation)
  return waits === null ? null : `${held} ${waits}`
}

/**
 * ⚑ **D-022 · R3 — what reached the holder of a piece**, in the words `withdraw_task` and
 * `update_work` share: *told* only for `sent`; `held` says it waits until the holder is free, then
 * goes {@link WITH_WHATEVER_ELSE_IS_HELD} — and, for a take-back or a close, that `interrupt_agent`
 * asks the turn the holder is running now to stop. ⚑ A new brief's own two: it rides the piece's
 * give that still waits, or the piece had ended when it reached the holder. See
 * `TakeBackOutcome.delivery` and `UpdateWorkOutcome.delivery`.
 */
function whatReachedItsHolder(
  owner: string,
  label: string,
  told: Told<NewBriefDelivery>,
  /**
   * ⚑ `a-stop-asked`: a take-back whose holder's turn is not the caller's to stop — asked already,
   * or a service's — so no stop is offered.
   */
  what: 'a-stop' | 'a-stop-asked' | 'a-new-brief' | 'its-inputs',
  /**
   * ⚑ Why what is held waits for more than the holder's turn, when it does — said IN PLACE of
   * *until it is free* ({@link heldAndWhy}'s rule).
   */
  waits: string | null,
): string {
  const untilItIsFree = waits === null ? ` until ${owner} is free` : ''
  const withTheRest = `then goes out ${WITH_WHATEVER_ELSE_IS_HELD}`
  switch (told.delivery) {
    case 'sent':
      return `${owner} has been told.`
    case 'held':
      if (waits !== null) {
        return what === 'a-new-brief'
          ? `${owner} is not told yet: the new brief is held. ${waits}`
          : `${owner} is not told yet: it is held. ${waits}`
      }
      return what === 'a-stop'
        ? `${owner} is not told yet: it is held${untilItIsFree}, ${withTheRest} — interrupt_agent asks the turn ${owner} is running now to stop.`
        : what === 'a-new-brief'
          ? `${owner} is not told yet: the new brief is held${untilItIsFree}, ${withTheRest}.`
          : `${owner} is not told yet: it is held${untilItIsFree}, ${withTheRest}.`
    case 'with-its-give':
      return `${owner} is not told yet: the give of ${label} is still held${untilItIsFree}, and the new brief goes out with it, in place of the first.${
        waits === null ? '' : ` ${waits}`
      }`
    case 'after-it-ended':
      return `${label} had ended before its new brief reached ${owner}, so the new brief was not sent: any answer to it is to the brief before.`
    case 'not-delivered':
      return `${owner} could not be told. ${told.whyNotTold}`
  }
}

/** A piece's place at the service it is queued on, as a sentence after the one that gave it. */
function queuedSaid(ahead: number | undefined, stalledAt: number | undefined): string {
  if (ahead === undefined) return ''
  if (ahead === 0) return ' Queued; next in line.'
  return stalledAt === undefined
    ? ` Queued behind ${String(ahead)}.`
    : ` Queued behind ${String(ahead)}; the active piece stalled at ${clockTime(stalledAt)}.`
}

/**
 * 🔴 **D-030 · where a reply went, in the words `reply_to_parent` answers with** — the giver by its
 * name (the piece names its conversation), never an id. ⚑ `sent` and `held` in `give_work`'s words;
 * `kept` in the words D-030 ruled; `not-delivered` says why, where the answer stays
 * ({@link PieceRow.answerReachedNobody}) and what to do, since nothing tells the giver to look.
 * ⚑ **D-017 · R10 — and a giver that could never be reopened is said**, in `give_work`'s words, for
 * every answer whose words went to the one in its place.
 */
function whereTheReplyWent(replied: Extract<ReplyOutcome, { readonly giver: string }>): string {
  const { label, giver } = replied
  const inItsPlace = replied.tookItsPlace
    ? ` The conversation that gave ${label} could never be reopened, so your answer went to the conversation that took its place.`
    : ''
  switch (replied.delivered) {
    case 'sent':
      return `it went to ${giver} straight away.${inItsPlace}`
    case 'held':
      // ⚑ Held for the giver's reopen on the current sign-in, it says why in place of *until it is
      // free* ({@link heldAndWhy}'s rule).
      return replied.why === undefined
        ? `it is held until ${giver} is free, then goes out ${WITH_WHATEVER_ELSE_IS_HELD}.${inItsPlace}`
        : `it is held for ${giver}. ${replied.why}${inItsPlace}`
    case 'kept':
      // ⚑ **W4.172 · F095** — what is kept for a start waits there for a usage limit, as any word
      // this app or an agent holds for it does.
      return `kept on ${label}; ${giver} gets it when it next starts, or later if its provider’s usage limit holds then.${inItsPlace}`
    case 'not-delivered':
      return `${giver} could not be told: ${replied.why} Your answer stays on ${label}, where ${giver} can read it with list_tasks, but nothing will tell it to look: tell the person here.`
  }
}

/**
 * ⚑ **D-022 · R3 — a new brief's own two words, as the payload's `delivery`**: a brief riding a
 * held give is held; one not sent was not delivered.
 */
const AS_A_DELIVERY: Readonly<Record<NewBriefDelivery, TellDelivery>> = {
  sent: 'sent',
  held: 'held',
  'not-delivered': 'not-delivered',
  'with-its-give': 'held',
  'after-it-ended': 'not-delivered',
}

/**
 * 🔴 **657 · which failed launches `give_work` answers, and in which word** (`650` F2).
 *
 * ⛔ **By TYPE and closed reason, never by text.** `RuntimeHost.createSession` translates a
 * `SessionUnavailable` into a person's sentence and keeps the original as `cause`; the provider's
 * own two failures arrive as their own classes. ⚑ **Everything else returns `null` and the tool
 * rethrows it** — `375`'s *classify one type, let the rest propagate*: a store that failed or an
 * invariant that broke is a broken tool, and dressing it as a word would be the catch-all `650`
 * spent a dispatch undoing.
 *
 * 🔴 **707 · but one closed reason more, and it is not a class**: the errno's CODE of a machine that
 * ran short (`transientSetupFailureOf`, R39 extended). ⚠️ A start rejects with no class of its own,
 * so this is read off the error and its cause chain.
 *
 * 🔴 **710 · R51 — and its other half**: a SPAWN's code that no wait clears (`ENOENT`, `ENOTDIR`, …)
 * is `agent-could-not-be-started`, permanent, where until `710` it was `null` and a broken tool
 * (`a-spawn-a-person-must-fix.test.ts`).
 *
 * 🔴 **716 · R66 and R67 — every start a person must fix has that word, and `what` says which**: a
 * provider's PROGRAM — a spawn's code (R51), Claude's missing program (`ClaudeUnavailableError`,
 * R66) and Codex's (`CodexUnavailableError`, R67: until `716` it was `agent-did-not-start`) — or a
 * FOLDER the host could not make or write (`folderAPersonMustFixOf`, R66: until `716` a broken tool).
 * ⚑ `what` is how the door picks the sentence that says which, in words ({@link A_FOLDER_COULD_NOT_BE_MADE}).
 *
 * 🔴 **D-039 · R2 — and a start its PROVIDER refused** (`provider-refused`): the same permanent word,
 * with the provider's own reason ({@link A_PROVIDER_REFUSED_THE_START}) — ⚑ or one that failed
 * otherwise (`StartFailed`), `agent-did-not-start` with a closed reason.
 */
export function aLaunchThatDidNotStart(error: unknown): {
  readonly rail:
    | 'agent-did-not-start'
    | 'agent-took-too-long-to-start'
    | 'agent-could-not-start-just-now'
    | 'agent-could-not-be-started'
  readonly because: string
  /**
   * 🔴 **716** · for `agent-could-not-be-started`: what a person must fix — the program, or a folder.
   * ⚑ **D-039 · R2** — or what its provider refused (`provider-refused`). For `agent-did-not-start`:
   * its sign-in, or its Codex settings, which a person fixes.
   */
  readonly what?:
    'program' | 'folder' | 'provider-refused' | 'sign-in' | 'no-sign-in-to-copy' | 'settings'
  /**
   * 🔴 **D-039 · R2** · for `provider-refused`: the provider's own reason (`StartRefused.said`),
   * absent when it gave none.
   */
  readonly providerSaid?: string
  /** For `sign-in` and `settings`: whose. */
  readonly provider?: Provider
} | null {
  // ⚑ By class: the settings a Codex profile's `config.toml` holds, which its home's check refused
  // (`assertCodexSqliteHomeContained`), else a sign-in missing, expired or refused.
  if (error instanceof AuthUnavailableError) {
    // A computer with no Codex sign-in for a profile to copy is said apart: there is none to renew.
    if (error instanceof NoCodexSignInOnThisComputerError) {
      return {
        rail: 'agent-did-not-start',
        because: 'this-computer-has-no-sign-in-to-copy',
        what: 'no-sign-in-to-copy',
        provider: error.provider,
      }
    }
    const settings = error instanceof CodexSettingsUnusableError
    return {
      rail: 'agent-did-not-start',
      because: settings ? 'its-provider-settings-are-unusable' : 'its-sign-in-is-unusable',
      what: settings ? 'settings' : 'sign-in',
      provider: error.provider,
    }
  }
  // 🔴 **D-039 · R2 — the provider ANSWERED the start, and refused it** (F055: Codex refused
  // `thread/start`, and this was a broken tool — *"give_work failed: {"code":-32600,…}"*). ⚑ By TYPE,
  // anywhere on the chain (`startRefusalOf`): the person's refusal the host throws carries it as its
  // cause. ⚑ R51's permanent word — the same start is refused the same way until a person changes
  // what was refused — with its own sentence ({@link A_PROVIDER_REFUSED_THE_START}).
  const refused = startRefusalOf(error)
  if (refused !== null) {
    return {
      rail: 'agent-could-not-be-started',
      because: 'its-provider-refused-it',
      what: 'provider-refused',
      ...(refused.said === null ? {} : { providerSaid: refused.said }),
    }
  }
  // 🔴 **D-039 · R2 — …or its start failed otherwise** (`StartFailed`: the provider's process ended
  // before it answered, or its answer failed a check the adapter makes) — until D-039 a broken tool,
  // *"give_work failed: codex app-server exited (stderr tail: …)"*. ⚑ `agent-did-not-start`, whose
  // sentence sends a person to the detail: a fixed reason, and the diagnostic to the log.
  if (startFailureOf(error) !== null) {
    return { rail: 'agent-did-not-start', because: 'its-provider-could-not-be-started' }
  }
  // 🔴 **716 · R67 — one word for a missing program, on both providers.** A `CodexUnavailableError`
  // is a binary that is missing, not executable, or not bundled for this platform (review of
  // `657`); a `ClaudeUnavailableError` is the program the SDK looks for, not where it looks (R66).
  // ⚑ By TYPE: the Claude adapter asks where the SDK looks, never what the SDK said.
  if (error instanceof CodexUnavailableError || error instanceof ClaudeUnavailableError) {
    return {
      rail: 'agent-could-not-be-started',
      because: 'provider-binary-unavailable',
      what: 'program',
    }
  }
  const reason =
    unavailableOf(error) ??
    (error instanceof Error ? unavailableOf((error as { cause?: unknown }).cause) : null)
  if (reason === 'took-too-long') return { rail: 'agent-took-too-long-to-start', because: reason }
  // ⚑ **D-042 · F2 — nothing names a model, or a named model's effort** (its provider's list could
  // not be read, or names no default): a person looks, or names one, so the same permanent word.
  if (
    reason === 'cancelled' ||
    reason === 'lost-its-place' ||
    reason === 'shutting-down' ||
    reason === 'nothing-names-a-model'
  ) {
    return { rail: 'agent-did-not-start', because: reason }
  }
  // 🔴 **707 · R39, extended — a shortage the machine gets back by itself**, read off the errno's
  // CODE on the error and its cause chain (`transientSetupFailureOf`) — the closed reason is that
  // code, never the provider's text. ⚠️ **After the classes and reasons**, so it takes only what they
  // did not: an error a word already names keeps it, and a code a person has to fix is one of the
  // two arms below — a spawn's (`710`, R51) or a folder's (`716`, R66); anything else is `null`, and
  // still propagates.
  const shortage = transientSetupFailureOf(error)
  if (shortage !== null) return { rail: 'agent-could-not-start-just-now', because: shortage }
  // 🔴 **710 · R51 — a spawn no wait clears is its own PERMANENT word**, read the same way: the
  // NEAREST code on the chain, and the closed reason is that code. ⚑ The two readers cannot both
  // answer one error — one takes only a code a wait clears, the other only a code it does not.
  const cannotRun = spawnNoWaitClearsOf(error)
  if (cannotRun !== null) {
    return { rail: 'agent-could-not-be-started', because: cannotRun, what: 'program' }
  }
  // 🔴 **716 · R66 — a folder the disk refused is the same permanent word**, read the same way: the
  // NEAREST code, and only when that link was not a spawn — so the two readers above and this one
  // cannot answer one error twice. ⚑ The closed reason is the code; the path goes to the log.
  const folder = folderAPersonMustFixOf(error)
  if (folder !== null) {
    return { rail: 'agent-could-not-be-started', because: folder.code, what: 'folder' }
  }
  return null
}

/**
 * 🔴 **663 · the classification of a start a delivery asked for that did not happen** (D-017; it
 * was `resume_agent`'s until that tool went) — by TYPE and closed
 * reason, never by text, exactly as {@link aLaunchThatDidNotStart} and for its reasons.
 *
 * ⚑ **The wake's arms first, then the launch's**: a reopen fails every way a launch fails — a
 * timeout, a person's or the parent's own stop, a quit, a sign-in — and those keep the words `657`
 * gave them. ⚠️ **A binary was on that list until `716`**: a program or a folder a person must fix
 * now answers this door's own permanent word, saying which (R66/R67, the last arm below).
 * ⛔ **The launch classifier is NOT widened to hold these**, because it answers `give_work`'s start
 * too, and a start can meet none of them: a fresh id has no previous run to wait out and no provider
 * record to lose (`widening-a-predicate-widens-every-question-its-field-answers`).
 *
 * ⚠️ **Every code named here is one a wake was MEASURED meeting** — `wake-one-conversation.test.ts`
 * §2.4 and §4, and since `705` all four shortage codes, each through an adapter's OWN error for a
 * spawn that ran short — Claude `EMFILE`, `EAGAIN` (its pipes-made arm, which returned a handle
 * until `705`'s review) and `ENOMEM`; Codex `EMFILE`, `ENFILE` and `EAGAIN`
 * (`apps/desktop/test/a-shortage-that-clears-by-itself.test.ts`), and since `707` a shortage met
 * outside an adapter's `ResumeError` (`a-spawn-that-ran-short.test.ts` §4) — **except
 * `still-closing`**, given its word on the code's own reading (review): the
 * reopen waits twice the close bound on a teardown whose finalizer archive has no bound at all, and
 * then `reserve` refuses it. ⚠️ No rig here holds an archive open, so that arm is reasoned, not
 * measured, and `663`'s table says so. ⛔ `held-by-nobody` and `already-open-elsewhere` are not
 * reached: the wake answers a running conversation before it reaches `reserve`, and a slot can only
 * appear inside its teardown wait, which every reopen of that id waits on in the order it asked — a
 * racer meets `still-opening`. ⚑ Those, and every code no wake can reach, fall through and are
 * rethrown — a broken tool, not a word for a state nobody saw.
 */
export function aWakeThatDidNotHappen(error: unknown): {
  readonly rail: ToolRefusal
  readonly because: string
  /**
   * 🔴 **716** · as {@link aLaunchThatDidNotStart}'s: what a person must fix, when one must — and
   * since `724` a folder that is GONE (`717` F-2), which a wake alone can meet. ⚑ **D-039 · R2** —
   * or what its provider refused.
   */
  readonly what?:
    | 'program'
    | 'folder'
    | 'gone-folder'
    | 'provider-refused'
    | 'sign-in'
    | 'no-sign-in-to-copy'
    | 'settings'
  /** 🔴 **D-039 · R2** · as {@link aLaunchThatDidNotStart}'s. */
  readonly providerSaid?: string
  /** As {@link aLaunchThatDidNotStart}'s. */
  readonly provider?: Provider
} | null {
  // 🔴 **705 · R39 — a shortage the machine gets back by itself is its own word**, read off the
  // errno's CODE on the cause chain — the closed reason is that code, never the provider's text.
  // ⚠️ First, because the launch's classifier this falls through to names a shortage too
  // (`agent-could-not-start-just-now`, `707`), and a wake must answer in a wake's words — whatever
  // carries the code. ⚑ **710 · and since `710` it is never a bare `ResumeError` here**: a reopen's
  // shortage reaches this classifier as the host's person-read refusal — a plain `Error`, then
  // `SessionUnavailable('machine-ran-short')`, then the adapter's `ResumeError`, then the errno
  // (`RuntimeHost.aShortageAsARefusal`) — so the `ResumeError` arm below no longer sees it, and
  // without this arm it would reach the SPAWN's word.
  const shortage = transientSetupFailureOf(error)
  if (shortage !== null) {
    return { rail: 'that-conversation-could-not-be-woken-just-now', because: shortage }
  }
  // 🔴 **D-039 · R2 — the provider ANSWERED the start again, and refused it** — by TYPE, anywhere on
  // the chain: a reopen's `ResumeError` carries it as its cause, and the host's person-read refusal
  // carries that. ⚑ **Before the `ResumeError` arm**, which would call it a sign-in or a lost
  // conversation; ⛔ a thread its provider no longer has carries none (D-017 R10 replaces it).
  const refused = startRefusalOf(error)
  if (refused !== null) {
    return {
      rail: 'that-conversation-could-not-be-resumed',
      because: 'its-provider-refused-it',
      what: 'provider-refused',
      ...(refused.said === null ? {} : { providerSaid: refused.said }),
    }
  }
  // 🔴 **D-039 · R2 — …or its start failed otherwise** (`StartFailed`): the word and reason the
  // `ResumeError` around it gets below — ⚑ here because the host's person-read refusal now wraps
  // that `ResumeError`, and the arm below reads only the error it is handed.
  if (startFailureOf(error) !== null) {
    return {
      rail: 'that-conversation-could-not-be-resumed',
      because: 'the-provider-could-not-resume-it',
    }
  }
  // ⚠️ **The provider's own class, and it carries no closed reason** — `ResumeError`'s message is
  // the provider's words and can name its own ids, so the reason given is the class's.
  if (error instanceof ResumeError) {
    return {
      rail: 'that-conversation-could-not-be-resumed',
      because: 'the-provider-could-not-resume-it',
    }
  }
  const reason =
    unavailableOf(error) ??
    (error instanceof Error ? unavailableOf((error as { cause?: unknown }).cause) : null)
  if (reason === 'cannot-be-reopened' || reason === 'never-started') {
    return { rail: 'that-conversation-could-not-be-resumed', because: reason }
  }
  // 🔴 **724 · `717` F-2 — the folder it ran in is gone** (`its-folder-is-gone`), a person's to put
  // back: the wake's permanent word, with the sentence that says so. ⛔ **Before the launch's
  // classifier below**, which would walk the chain to the spawn's `ENOENT` and say the PROGRAM could
  // not run — false, and worse than the generic word `main` gave.
  if (reason === 'its-folder-is-gone') {
    return { rail: 'that-conversation-could-not-be-resumed', because: reason, what: 'gone-folder' }
  }
  if (reason === 'not-confirmed-stopped' || reason === 'still-closing') {
    return { rail: 'that-conversation-is-still-stopping', because: reason }
  }
  // ⚑ **Two wakes of one conversation in one turn**: the second finds the first's reservation — the
  // word `message_agent` gives a launch in flight, shared on purpose (650).
  if (reason === 'still-opening')
    return { rail: 'that-conversation-has-not-started', because: reason }
  // ⚠️ **710 · R51 — the launch's permanent spawn word is not a wake's**: both adapters wrap a
  // resume's spawn errno in a `ResumeError`, which the arm above answers in this door's own permanent
  // word (`a-shortage-that-clears-by-itself.test.ts` §2b).
  //
  // 🔴 **716 · R66/R67 — and what a person must fix reaches a wake too**, outside any `ResumeError`:
  // a missing program (Codex's, thrown as its runtime is built; Claude's, which its adapter lets
  // out of `resume()`) and a folder the host could not make — so it is answered in the WAKE's
  // permanent word, never the spawn's, with `what` for the sentence that says which.
  const launch = aLaunchThatDidNotStart(error)
  if (launch?.rail === 'agent-could-not-be-started') {
    return {
      rail: 'that-conversation-could-not-be-resumed',
      because: launch.because,
      ...(launch.what === undefined ? {} : { what: launch.what }),
    }
  }
  return launch
}

/**
 * 🔴 **716 · R66 — a spawn refused for a FOLDER a person must fix, said as one** — the word's own
 * sentence names a program ({@link TOOL_SENTENCES}), and R66 rules *"the sentence says which it is, a
 * program or a folder, in words"*. ⚑ The act first, inside the 200-character receipt
 * (`the-act-inside-the-cut`), then what is wrong.
 */
export const A_FOLDER_COULD_NOT_BE_MADE =
  'that agent\u2019s conversation could not be started, so nothing was sent. Starting it again will not help until a person has looked: BroCrew could not make or write a folder it needs \u2014 the disk refused it, is read-only or full, or a file is in the way. The detail names the error.'

/**
 * 🔴 **716 · R66 — a wake refused for the PROGRAM, said as one** — the wake's permanent word names
 * three causes (`that-conversation-could-not-be-resumed`); this one knows which.
 */
export const A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN =
  'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: this machine could not run its provider\u2019s program \u2014 it may be missing or not runnable. The detail names the error.'

/**
 * 🔴 **724 · `717` F-2 — a wake refused because the folder it ran in is GONE, said as one.** ⛔ No
 * path: the host's own text, which names it, goes to the log (`657`), and a person's Reopen says it.
 */
export const A_WAKE_WHOSE_FOLDER_IS_GONE =
  'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: the folder it ran in is no longer there, and a person has to put it back.'

/**
 * 🔴 **D-039 · R2 — a give whose new conversation its PROVIDER refused to start, said as one** — the
 * word's own sentence names a program (F055). ⚑ The act first, inside the 200-character receipt
 * (`the-act-inside-the-cut`), then what failed, then what the giver can do meanwhile.
 *
 * ⛔ **The provider's words are in the detail (`providerSaid`) and never in a sentence an agent
 * reads**: they are the provider's, and only a UUID is cut from them (`StartRefused.said`) — a path
 * in its home or a file it quotes stays, and a sentence an agent reads names neither. ⚑ True with
 * or without them: the detail carries `providerSaid` only when the provider gave a reason.
 */
export const A_PROVIDER_REFUSED_THE_START =
  'that agent\u2019s conversation could not be started, so nothing was given. Giving it again will not help until a person has looked: its provider refused to start it, and the detail gives its reason when it gave one. Meanwhile, give the work to another agent or do it yourself.'

/**
 * 🔴 **D-039 · R2 — a wake its PROVIDER refused, said as one** — the wake's permanent word names
 * three causes (`that-conversation-could-not-be-resumed`); this one knows which. ⛔ The provider's
 * words as {@link A_PROVIDER_REFUSED_THE_START}'s: in the detail, when it gave any.
 */
export const A_WAKE_ITS_PROVIDER_REFUSED =
  'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: its provider refused to start it, and the detail gives its reason when it gave one. Meanwhile, reach another agent or do it yourself.'

/**
 * 🔴 **F091 · `interrupt_agent` naming the conversation that calls it** — by its id, a piece it
 * holds, or a conversation it took the place of — said as `message_agent` says it (`that-agent-is-you`).
 * ⛔ The chain's word, `not-below-you`, was true to the letter and pointed at `message_agent`, which
 * refuses a message to oneself. ⚑ Its acts, as `message_agent`'s are: its own work is its own to
 * stop — ⚠️ not *"end this turn"*: a background agent of its own calls from no turn — and another
 * agent is named instead.
 */
export const A_CONVERSATION_CANNOT_INTERRUPT_ITSELF =
  'that is this conversation: a conversation cannot interrupt itself, so nothing was interrupted. Stop your own work yourself, or name another agent to interrupt.'

export const A_CONVERSATION_CANNOT_ASK_ITSELF =
  'That is this conversation; it cannot ask itself, so nothing was asked.'

/** 🔴 **716 · R66 — a wake refused for a FOLDER, said as one.** */
export const A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE =
  'that conversation could not be started again, so nothing was sent. Sending again will not help until a person has looked: BroCrew could not make or write a folder it needs \u2014 the disk refused it, is read-only or full, or a file is in the way. The detail names the error.'

/**
 * How much of a refused start's sentence a row shows: the tool's row keeps 200 characters of
 * `refused (agent-did-not-start): <sentence>`, which leaves the sentence this many.
 */
export const A_REFUSED_ROW_SHOWS = 169

/**
 * What a start refused on its sign-in or settings says, by kind. `lead` is what a person does and
 * why: it opens the sentence and is read whole in what a row shows ({@link A_REFUSED_ROW_SHOWS}).
 * `more` follows it, for whoever opens the whole answer.
 */
export const A_START_ITS_SIGN_IN_REFUSED = {
  'claude-sign-in': {
    lead: 'Ask a person to sign in to Claude Code on this computer again, or to save an API key on the Claude card in Providers: its Claude sign-in could not be used.',
    more: '',
  },
  'codex-sign-in': {
    lead: 'Ask a person to save an API key on the Codex card in Providers, or to sign that agent in from one of its conversations: its Codex sign-in could not be used.',
    more: 'Each agent has its own Codex sign-in, and the Codex card signs in only BroBot\u2019s own; in one of that agent\u2019s conversations, a refused message shows its sign-in buttons. BroCrew does not need restarting.',
  },
  // No Codex sign-in for a new agent to copy at its first start: neither this computer's nor
  // BroBot's own.
  'no-sign-in-to-copy': {
    lead: 'Ask a person to sign in on the Codex card in Providers, or to save an API key there: there is no Codex sign-in for that agent to start on.',
    more: 'A new agent starts on a copy of the Codex sign-in this computer keeps or, where it keeps none, of BroBot\u2019s own. BroCrew does not need restarting.',
  },
  'codex-settings': {
    lead: 'Ask a person to correct that agent\u2019s Codex settings (config.toml): they could not be used.',
    more: '',
  },
} as const

/**
 * A start refused because the agent's sign-in, or its Codex settings, could not be used. What a
 * person does comes first, then that nothing was done and that the same call will not help yet.
 */
export function aStartItsLoginOrSettingsRefused(
  what: 'sign-in' | 'no-sign-in-to-copy' | 'settings',
  provider: Provider,
  door: 'give' | 'wake',
): string {
  const said =
    A_START_ITS_SIGN_IN_REFUSED[
      what === 'no-sign-in-to-copy'
        ? 'no-sign-in-to-copy'
        : what === 'settings'
          ? 'codex-settings'
          : providerDescriptor(provider).words.refusedSignIn
    ]
  const nothing =
    door === 'give'
      ? 'Nothing was given, and giving it again will not help until then.'
      : 'Nothing was sent, and sending again will not help until then.'
  const meanwhile =
    door === 'give'
      ? 'Meanwhile, give the work to another agent or do it yourself.'
      : 'Meanwhile, reach another agent or do it yourself.'
  return [said.lead, nothing, said.more, meanwhile].filter((part) => part !== '').join(' ')
}

/**
 * 🔴 **D-039 · what a give with `new: true` whose launch failed still did: it MADE the agent.**
 *
 * ⚑ **The identity is the give's first write, after every rail and before the launch**
 * (`RuntimeHost.giveWork`), and a failed launch does not take it back — so the same give again
 * meets `that-profile-exists`. ⚑ Said after the word's own sentence, whichever it is: every launch
 * failure `give_work` classifies comes after that write. ⛔ No name and no id: the giver named it.
 */
export const THE_NEW_AGENT_WAS_MADE =
  'The new agent was made all the same: from now on, give to it without new.'

/**
 * 🔴 **D-039 · a failed launch's refusal, and what a give with `new: true` still did** — its
 * sentence ({@link theRefusalOfALaunch}), then {@link THE_NEW_AGENT_WAS_MADE} when it made one.
 */
function aLaunchRefused(
  failed: NonNullable<ReturnType<typeof aLaunchThatDidNotStart>>,
  madeANewAgent: boolean,
  detail: Readonly<Record<string, unknown>>,
): ToolRefusalPayload {
  const said = theRefusalOfALaunch(failed, detail)
  return madeANewAgent ? { ...said, reason: `${said.reason} ${THE_NEW_AGENT_WAS_MADE}` } : said
}

/**
 * 🔴 **716 · a failed launch's refusal, in the sentence that says what a person must fix** — the two
 * places `give_work` picks it: a folder ({@link A_FOLDER_COULD_NOT_BE_MADE}) and, 🔴 **D-039 · R2**,
 * a start its provider refused ({@link A_PROVIDER_REFUSED_THE_START}). Every other failure says its
 * word's own sentence.
 */
function theRefusalOfALaunch(
  failed: NonNullable<ReturnType<typeof aLaunchThatDidNotStart>>,
  detail: Readonly<Record<string, unknown>>,
): ToolRefusalPayload {
  // 🔴 **D-039 · R2 — a provider's refusal carries its words in the detail**, never the envelope,
  // and ⚑ the key is absent when it gave none.
  if (failed.what === 'provider-refused') {
    return {
      ...refuseTool(
        failed.rail,
        failed.providerSaid === undefined
          ? detail
          : { ...detail, providerSaid: failed.providerSaid },
      ),
      reason: A_PROVIDER_REFUSED_THE_START,
    }
  }
  if (
    (failed.what === 'sign-in' ||
      failed.what === 'no-sign-in-to-copy' ||
      failed.what === 'settings') &&
    failed.provider !== undefined
  ) {
    return {
      ...refuseTool(failed.rail, { ...detail, provider: failed.provider }),
      reason: aStartItsLoginOrSettingsRefused(failed.what, failed.provider, 'give'),
    }
  }
  const refused = refuseTool(failed.rail, detail)
  return failed.what === 'folder' ? { ...refused, reason: A_FOLDER_COULD_NOT_BE_MADE } : refused
}

/**
 * 🔴 **716 · a start's refusal, in the sentence that says what a person must fix** — the start a
 * delivery makes of a conversation that was not running (`message_agent`) builds it here.
 */
function aWakeRefused(
  unwoken: NonNullable<ReturnType<typeof aWakeThatDidNotHappen>>,
  agent: string,
): ToolRefusalPayload {
  // 🔴 **D-039 · R2 — a provider's refusal carries its words in the detail**, never the envelope,
  // and ⚑ the key is absent when it gave none.
  if (unwoken.what === 'provider-refused') {
    const { because, providerSaid } = unwoken
    const detail =
      providerSaid === undefined ? { agent, because } : { agent, because, providerSaid }
    return {
      ...refuseTool(unwoken.rail, detail),
      reason: A_WAKE_ITS_PROVIDER_REFUSED,
    }
  }
  if (
    (unwoken.what === 'sign-in' ||
      unwoken.what === 'no-sign-in-to-copy' ||
      unwoken.what === 'settings') &&
    unwoken.provider !== undefined
  ) {
    return {
      ...refuseTool(unwoken.rail, {
        agent,
        because: unwoken.because,
        provider: unwoken.provider,
      }),
      reason: aStartItsLoginOrSettingsRefused(unwoken.what, unwoken.provider, 'wake'),
    }
  }
  const refused = refuseTool(unwoken.rail, { agent, because: unwoken.because })
  if (unwoken.what === 'program') return { ...refused, reason: A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN }
  if (unwoken.what === 'folder')
    return { ...refused, reason: A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE }
  if (unwoken.what === 'gone-folder') return { ...refused, reason: A_WAKE_WHOSE_FOLDER_IS_GONE }
  return refused
}

/** A spawn rail's refusal, carried over MCP **unchanged** — see the module note. */
function carryRailRefusal(refusal: SpawnRefusal): PublishedRefusal {
  return {
    outcome: 'refused',
    rail: refusal.rail,
    // ⚑ **Re-derived from the rail rather than copied off the payload**, so a refusal that somehow
    // arrived with a permanence its rail does not have is corrected here rather than published.
    permanence: permanenceOf(refusal.rail),
    retryable: retryableOf(refusal.rail),
    reason: refusal.reason,
    // ⚑ **425 · re-derived from the rail for the permanence's reason one line up.** A payload that
    // arrived promising an act its rail does not offer is corrected here rather than published.
    remedy: remedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

/**
 * A messaging rail's refusal, carried over MCP **unchanged** — the same treatment, one door over.
 *
 * ⛔ **Re-derived through `message-rails.ts`'s own table**, for `carryRailRefusal`'s reason: the
 * payload states the permanence, and a payload is a thing that can be built wrong.
 */
function carryMessageRefusal(refusal: MessageRefusal): PublishedRefusal {
  return {
    outcome: 'refused',
    rail: refusal.rail,
    permanence: messagePermanenceOf(refusal.rail),
    retryable: messageRetryableOf(refusal.rail),
    reason: refusal.reason,
    remedy: messageRemedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

/**
 * 🔴 **Every spelling of *"send it to this one"*, refused as a set** (393 §2, HO-015 §1.3).
 *
 * ⛔ **A blocklist here rather than a bare allow-list, because the refusal has to TEACH.** An
 * unknown key could be a typo; these are an intent, and a model that tried to aim a reply is told
 * why that is not an argument rather than being told its call was malformed. ⚠️ `371` shipped the
 * other failure — a `parentSessionId` silently overridden, *"enforcement was right and disclosure
 * was wrong, and the caller was told its argument was taken"* — and this is the correction stated
 * as a list.
 *
 * ⚑ **Both spellings of each, because a model writes whichever its provider taught it.** A refusal
 * that fired on `session_id` and passed `sessionId` through would be a rail with a typo in it.
 */
export const REPLY_ADDRESSING_KEYS = [
  'to',
  'parent',
  'parent_id',
  'parentId',
  'parent_session',
  'parent_session_id',
  'parentSessionId',
  'session',
  'session_id',
  'sessionId',
  'recipient',
  'agent',
  'agent_id',
  'agentId',
] as const

/** ⛔ A vocabulary the validator has not been taught is a refusal, never a pass (`325`). */
const isTaskOutcome = (value: unknown): value is TaskOutcome =>
  typeof value === 'string' && (TASK_OUTCOMES as readonly string[]).includes(value)

/**
 * ⚑ **Carry reply and resource refusals over MCP** — `carryRailRefusal`'s shape.
 *
 * ⛔ **Permanence is RE-DERIVED from the rail rather than copied off the incoming payload**, which
 * is what the remaining carriers do and for their reason: a payload that arrived with the fields
 * disagreeing would be carried out disagreeing. ⚠️ **A `ResourceRefusal` already carries `outcome`
 * and is already `341`-shaped**, so it is spread unchanged — `read_document`'s handling, and its
 * sentences were written for this caller.
 */
function carryReplyRefusal(refusal: ReplyRefusal | ResourceRefusal): PublishedRefusal {
  if ('outcome' in refusal) return { ...refusal }
  return {
    outcome: 'refused',
    rail: refusal.rail,
    permanence: replyPermanenceOf(refusal.rail),
    retryable: replyRetryableOf(refusal.rail),
    reason: refusal.reason,
    remedy: replyRemedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

/**
 * ⚑ **Carry a question refusal over MCP** — `carryRailRefusal`'s shape for `QUESTION_RAILS`.
 *
 * ⛔ **Permanence is RE-DERIVED from the rail rather than copied off the incoming payload**, which
 * is what the other carriers do and for their reason: a payload that arrived with the two
 * disagreeing would be carried out disagreeing.
 */
/**
 * ⚑ **Carry an interrupt refusal over MCP** — `carryRailRefusal`'s shape for `INTERRUPT_RAILS`.
 *
 * ⛔ **Permanence is RE-DERIVED from the rail rather than copied off the incoming payload**, which
 * every other carrier in this file does and for their reason: a payload that arrived with the two
 * disagreeing would be carried out disagreeing.
 */
function carryInterruptRefusal(refusal: InterruptRefusal): PublishedRefusal {
  return {
    outcome: 'refused',
    rail: refusal.rail,
    permanence: interruptPermanenceOf(refusal.rail),
    retryable: interruptRetryableOf(refusal.rail),
    reason: refusal.reason,
    remedy: interruptRemedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

function carryQuestionRefusal(refusal: QuestionRefusal): PublishedRefusal {
  return {
    outcome: 'refused',
    rail: refusal.rail,
    permanence: questionPermanenceOf(refusal.rail),
    retryable: questionRetryableOf(refusal.rail),
    reason: refusal.reason,
    remedy: questionRemedyOf(refusal.rail),
    detail: refusal.detail,
  }
}

/**
 * ⚑ **One piece, as a model reads it** — the derivation's own fields, renamed to the snake_case a
 * tool payload speaks and otherwise not reshaped.
 *
 * ⛔ **`ended_at` is null while a piece is open and that is not the same as `0`**, and `outcome` is
 * null when nothing has replied. ⚠️ Nothing here is computed: a payload that decided for itself
 * whether a piece *"failed"* would be a second reading of a fold, free to disagree with it.
 *
 * 🔴 **`stalled_because` and `question_lost_at_restart` are both here, and they answer different
 * questions** (400). The first is *why nothing is driving this*, non-null only while the state is
 * `stalled`; the second is *something was lost underneath it*, a latch that outlives the ending.
 * ⛔ Neither is a verdict: HO-018's principle is that the engine records what it observed and the
 * parent decides.
 */
const piecePayload = (
  piece: PieceRow,
  /**
   * 🔴 **484 · what the conversation HOLDING this work is doing right now** — `null` when this
   * caller has no live visible card for it, which is {@link AgentToolHost.agentCard}'s answer and
   * never a second opinion about reach. That can mean the slot is gone or the caller cannot see it;
   * this field deliberately does not invent a distinction the card reader does not return.
   *
   * ## ⛔ Why a piece row needed it, in the words of the agent that met the defect
   *
   * ⚠️ **HO-031 §3, the PO's own gloss: `stalled_because` null while an agent is frozen on a
   * permission is *"the most actively misleading thing in the report"*.** BroBot's §2.5: *"There is
   * a field named `stalled_because`, and it was `null` while the agent was demonstrably stalled…
   * If I had only called `list_tasks` I would have told the user work was progressing normally
   * while it was frozen waiting on them."*
   *
   * 🔴 **And the fix is NOT a sixth stall cause**, which is the tempting one and is wrong twice
   * over. ⛔ **Nothing in the ledger would say the card had been answered** — a task returns from
   * `stalled` only when a row says the work was actually handed over — so a task stalled by a
   * permission card would still read `stalled` after a person had answered it and the child had
   * finished. ⚠️ **648 · this clause used to read *`stalled` is a state nothing returns from —
   * `shared/tasks.ts` says so*, and that sentence was false**: the fold's
   * `message_unqueued: 'sent'` branch returns a task to `working`. ⚑ The load-bearing half — *a
   * stall leaves only on a ledger row, never because a condition around it changed* — is the one
   * that carries this argument, and it is untouched. ⚠️ **And a permission is not an observation of
   * the WORK at all**: every cause in `TASK_STALL_CAUSES` is an ending this app watched, and a card
   * waiting on somebody is a conversation's live condition, which is the thing
   * {@link AgentCard.state} is for.
   *
   * ⚑ **So the row says both, and neither field claims the other's subject.** `stalled_because`
   * goes on answering *what the engine observed stopped driving this piece*. `given_to_is` answers
   * *what state is the conversation named by `owner` in now*. Open and historical piece rows can
   * therefore carry the same live value when they name the same conversation; *needs you* is an
   * owner-conversation fact the giver reads here rather than through a second call.
   *
   * ## 🔴 648 · HOW TO READ THE `null`, and why it is still not resolved into two words
   *
   * ⛔ **`D28` asked for the collapse to be told apart, and the honest answer is that the PAIR
   * already tells it apart in every case but one — so the repair is a reading rule and not a
   * field.** ⚠️ Read `given_to_is` BESIDE `stalled_because`, which comes off the OWNER's own
   * ledger and is not reach-gated at all ({@link RuntimeHost.pieceBoard} takes a session id and no
   * `Caller`):
   *
   *  - ⚑ **D-017 · R11 — non-null: the holder's state in the one derivation's words**, the same
   *    whatever runs, since a message reaches it either way.
   *  - ⚑ **`null`** — this caller may not reach the holder (a person narrowed its reach since the
   *    piece was given), or a message cannot start it; the cause beside it comes off the owner's
   *    own ledger, which is not reach-gated. ⛔ Nothing about the holder beyond that is said.
   */
  givenToIs: AgentCard['state'] | null,
  /** ⚑ Why what is held for its holder waits — a reopen on the current sign-in, or (F074) its provider's usage limit; beside its stop on a person's answer, only what else holds it — or `null` ({@link AgentToolHost.whyWhatIsHeldWaits}). */
  heldBecause: string | null,
  /** ⚑ What its holder's turn is stopped on until a person answers it, as its card says it. */
  stoppedOnAPerson: AgentCard['stoppedOnAPerson'],
): Readonly<Record<string, unknown>> => ({
  piece: piece.piece,
  ...(piece.definitionOfDone === undefined ? {} : { definition_of_done: piece.definitionOfDone }),
  label: piece.label,
  title: piece.title,
  state: piece.state,
  stalled_because: piece.stalledBecause,
  // ⚑ **484 · the moment, so two readings of two turns cannot look like one contradiction** — see
  // {@link PieceRow.stalledAt}. ⛔ Null exactly when `stalled_because` is.
  stalled_at: piece.stalledAt,
  // 🔴 **484 · who ASKED the turn it stalled in to stop** (HO-029 §2.1) — on `turn_interrupted` and,
  // since `720` (R72), on `turn_ended`: a turn asked to stop that the provider finished anyway.
  // ⚑ **724 · PM ruling R82 — the key says what it holds**: *"`stalled_by` names who ASKED the turn
  // to stop, not who stalled it"*. ⚠️ The ASKER, never whoever ended the turn; the cause beside it
  // says that. ⛔ Null is *no row says* and never a fourth actor — see {@link PieceRow.stalledBy}.
  asked_to_stop_by: piece.stalledBy,
  // ⚑ **D-017 · R11 — in the one derivation's words**, as `get_agent_status` says them.
  given_to_is: givenToIs === null ? null : agentStateWords(givenToIs),
  // ⚑ Why words held for its holder wait, while the piece is open and they do.
  ...(heldBecause === null ? {} : { held_because: heldBecause }),
  // ⚑ What its holder's turn is stopped on until a person answers it, while it is.
  ...(stoppedOnAPerson === null ? {} : { stopped_on_a_person: stoppedOnAPerson }),
  // 🔴 **D-013 · what still runs in the background for it** (plan §3.7) — present only while it holds
  // the work: a giver can tell a build from a server that never ends.
  ...(piece.inTheBackground === undefined ? {} : { in_the_background: piece.inTheBackground }),
  // Queued at a service: how many pieces are ahead of it.
  ...(piece.queuedBehind === undefined ? {} : { queued_behind: piece.queuedBehind }),
  ...(piece.queueStalledAt === undefined ? {} : { queue_stalled_at: piece.queueStalledAt }),
  ...(piece.queueWaitsForServices === true ? { queue_waits_for_services: true } : {}),
  // ⚑ What it waited on in the background when its stop took that with it — only on a stall.
  ...(piece.state === 'stalled' && (piece.stoppedInTheBackground ?? []).length > 0
    ? { stopped_in_the_background: piece.stoppedInTheBackground }
    : {}),
  question_lost_at_restart: piece.questionLostAtRestart,
  // ⚑ **D-016 · commit 6 · `null`: a person gave it** — work its owner took on for them.
  giver: piece.giver,
  owner: piece.owner,
  // ⚑ **D-016 · its current status line** — the newest a giver or an owner set, or its reply's
  // summary: who said it, and when.
  status_line: statusLinePayload(piece.statusLine),
  outcome: piece.outcome,
  // 🔴 **719 · R70 — the answer's own words**, so a giver reading its piece here finds what the
  // delivery could not bring — the place `reply_to_parent`'s `not-delivered` answer names (D-030);
  // see {@link PieceRow.summary}. ⚑ **724 · R84 — and ONLY there**: an answer this app recorded as
  // reaching nobody ({@link PieceRow.answerReachedNobody}).
  // ⛔ Every other row carries no `summary` key at all — the words cost up to 1,280 units a row
  // (`719` F-5). 🔴 **729 · R89 — "lost is lost, whatever lost it"**: an answer HELD for a busy giver
  // and then lost is recorded the same way (`RuntimeHost.recordAnAnswerItsGiverNeverGot`), so its
  // row carries the words too.
  ...(piece.answerReachedNobody ? { summary: piece.summary } : {}),
  ...(piece.savedMethod === undefined ? {} : { saved_method: piece.savedMethod }),
  resources: piece.resources,
  needs_user_action: piece.needsUserAction,
  given_at: piece.givenAt,
  ended_at: piece.endedAt,
})

/** ⚑ **D-016 · a status line as a payload carries it** — `null` while nobody has set one. */
const statusLinePayload = (line: StatusLine | null): Readonly<Record<string, unknown>> | null =>
  line === null ? null : { text: line.text, by: line.by, at: line.at }

/**
 * ⚠️ **The line a model reads, and `stalled` is spelled out rather than left as a word.** A state
 * name is this app's vocabulary; *"its turn ended with this work still open"* is the fact it
 * stands for, and a reader deciding what to do next needs the fact. ⛔ It says nothing about
 * whether that is a failure — HO-018 §2 owns that ruling and made it the other way: the work is
 * still open and the parent decides.
 *
 * ⚑ **The sentences are `undrivenWorkText`'s own** (400), so the line a parent is PUSHED and the
 * line it reads back out of `list_tasks` cannot come to two descriptions of one observation.
 *
 * ## 🔴 603/609 · every WAIT owes its fact too, and it is the SAME rule and not a second one
 *
 * ⛔ **The rows this reads are composed** — {@link RuntimeHost.pieceBoard} — so a piece whose owner
 * is waiting on an answer, on a person or on a worker arrives here as a {@link TaskWait}, and so
 * does a piece a person gave that waits on them (D-016 · commit 6, the one wait the fold writes);
 * a bare state name would be this app's vocabulary with nothing behind it.
 * ⚑ {@link WAITING_STANDS_FOR} is that fact for every wait, and it is the whole reason `list_tasks`
 * is worth reading for a parent that is itself the answer.
 *
 * ⚠️ **609 · a TABLE and not a comparison**, which is what makes this line gain a wait rather than
 * be edited into one: {@link theWaitIn} narrows the state and the `Record` is
 * exhaustive over what it narrows to. ⛔ The old shape was `state === 'asking' ? …`, and
 * `a-loop-over-a-literal-variant-list-is-not-exhaustive` is the reason it could not stay.
 *
 * ⚠️ **The two arms cannot both fire**, by construction rather than by order:
 * {@link composeWhatEachPieceIsWaitingOn} clears `stalledBecause` when it writes a wait, which is
 * {@link PieceRow.stalledBecause}'s *non-null if and only if the state is `stalled`* kept.
 *
 * ⚑ **D-016 · the line ends on what a reader needs to know which work it is**: the piece's current
 * status line when it has one, and the first line of its brief when it has none.
 */
const pieceText = (
  piece: PieceRow,
  givenToIs: AgentCard['state'] | null,
  /**
   * 🔴 **724 · `720` F-C — who asked, named** — {@link theStallAndItsAsk}'s `whatToCall` — ⚑ F033 ·
   * by its piece on this piece's chain.
   */
  whatToCall: WhatToCallItUnder,
  /**
   * 🔴 **729 · PM ruling R90 — the conversation this line is FOR** — the caller, `me`: an ask it made
   * itself is said as its own act ({@link theAskNamed}'s `reader`), never by its own name.
   */
  reader: string,
  /** ⚑ Why what is held for its holder waits — a reopen on the current sign-in, or (F074) its provider's usage limit; beside its stop on a person's answer, only what else holds it — or `null` ({@link AgentToolHost.whyWhatIsHeldWaits}). */
  heldBecause: string | null,
  /** ⚑ What its holder's turn is stopped on until a person answers it, as its card says it. */
  stoppedOnAPerson: AgentCard['stoppedOnAPerson'],
  /**
   * Who holds it, by name — `null` for a piece the reader holds itself.
   */
  heldByName: string | null,
): string => {
  const wait = theWaitIn(piece.state)
  return `  ${pieceLine(piece.label, piece.title)} · ${piece.state}${
    wait !== null
      ? ` (${WAITING_STANDS_FOR[wait]})`
      : piece.stalledBecause === null
        ? // 🔴 **D-013 · working in the background, and on what** (plan §3.7).
          piece.inTheBackground === undefined
          ? ''
          : ` (in the background: ${piece.inTheBackground.join('; ')})`
        : // ⚑ **720 · R72 — the same two facts the pushed notice says** (`theStallAndItsAsk`).
          // ⚑ **D-017 · R11 — the history, for every cause**: what the owner is doing NOW is
          // `given_to_is`, the one state, beside it — never a second, process-shaped reading of it
          // here.
          // ⚑ **F074 — and the usage limit its turn ended on**, with its reset, as the notice says it.
          ` (${theStallAndItsAsk(
            piece.stalledBecause,
            theAskNamed(piece.stalledBy, (asker) => whatToCall(asker, piece.piece), reader),
            theLimitItStoppedOn(piece),
            piece.stoppedOnALogin,
          )}${
            // ⚑ And what it waited on in the background, when its stop took that with it.
            piece.state === 'stalled' && (piece.stoppedInTheBackground ?? []).length > 0
              ? `; ${piece.stalledBecause === 'background_stopped' ? 'that was' : 'it was waiting on'} ${theStoppedWork(piece.stoppedInTheBackground ?? [])}`
              : ''
          })`
  }${heldByName === null ? '' : ` · ${heldBy(heldByName)}`}${
    // On a stall, what its holder is doing now; *needs you* is said by the clause below.
    piece.state === 'stalled' && givenToIs !== null && givenToIs.is !== 'needs-you'
      ? ` · ${theHolderIsNow(agentStateWords(givenToIs))}`
      : ''
  }${
    // 🔴 **491 · the subject is the OWNER'S CONVERSATION, never this piece.** One conversation can
    // hold historical work as well as the piece whose turn raised today's card; calling every row
    // *"frozen"* turns a true conversation-wide state into a false piece-specific claim.
    // ⛔ Closed history gets no live-condition clause. On open work the subject is spelled out,
    // and *needs you* remains the only exceptional state worth printing.
    // ⚑ **F097 · "on a person", not "for a person's decision"**: a person's words it answered are
    // one of the things it can wait on, and they are no decision.
    TASK_IS_OPEN[piece.state] && givenToIs?.is === 'needs-you'
      ? ` · the conversation holding it is waiting on a person${theStopOnAPerson(stoppedOnAPerson)}`
      : ''
  }${heldBecause === null ? '' : ` · what is held for the conversation holding it waits: ${heldBecause}`}${
    piece.queuedBehind === undefined
      ? ''
      : piece.queueWaitsForServices === true
        ? ' · queued; it waits until services are on'
        : piece.queuedBehind === 0
          ? ' · queued; next in line'
          : ` · queued behind ${String(piece.queuedBehind)}${
              piece.queueStalledAt === undefined
                ? ''
                : `; the active piece stalled at ${clockTime(piece.queueStalledAt)}`
            }`
  }${piece.questionLostAtRestart ? ' · a question of its own was lost at a restart' : ''}${
    piece.outcome === null ? '' : ` · ${piece.outcome}`
  } · ${piece.statusLine?.text ?? piece.brief.split('\n')[0] ?? ''}${piece.definitionOfDone === undefined ? '' : `\n  Done when: ${piece.definitionOfDone ?? 'Not recorded'}`}`
}

/**
 * ⚑ **D-016 · a root on `list_tasks`' board** — its label, its title and its status line, and no
 * state: a root's state is its conversation's, which `get_agent_status` says (R1). ⚑ **D-024 · R2 —
 * whose it is, for the conversation this line is FOR**: its own, or another conversation of its
 * profile's, which `list_tasks` naming it reads too.
 */
const rootText = (root: RootOnTheBoard, reader: string): string =>
  `  ${pieceLine(root.label, root.title)} · ${
    root.owner === reader
      ? 'your own work, from a person'
      : 'work a person gave another conversation of your profile'
  }${root.statusLine === null ? '' : ` · ${root.statusLine.text}`}\n  Done when: ${root.definitionOfDone ?? 'Not recorded'}`

/** ⚑ **D-016 · a root as a payload carries it** — no state, for {@link rootText}'s reason. */
const rootPayload = (root: RootOnTheBoard): Readonly<Record<string, unknown>> => ({
  piece: root.piece,
  label: root.label,
  title: root.title,
  definition_of_done: root.definitionOfDone ?? null,
  status_line: statusLinePayload(root.statusLine),
  root: true,
})

/**
 * 🔴 **What `list_tasks` says when rows of its own record could not be read** (671 · R18).
 *
 * ⚑ **The digest's `source-unreadable` sentence, pointed at this list** (`466`, `463` F3): a
 * COUNT, what it costs the reader, and that the cause is not recorded — `LedgerWalk.rowsUnread`'s
 * rule, *"a count of the rows it is unable to speak for, with the cause still unstated"*.
 * ⛔ **It instructs nothing**: there is no act a model can take that repairs a torn row, so naming
 * one would be `402`'s defect — telling an agent to do something this app cannot honour.
 * ⚠️ `units` is not the word here: these are ledger ROWS, which is what the payload's
 * `rows_unread` counts.
 */
const unreadRowsSentence = (count: number): string =>
  `${String(count)} ${count === 1 ? 'row' : 'rows'} of this app's record could not be read, so ` +
  'a piece of work may be missing from the lists above, or its state may be wrong. ' +
  'Nothing records why.'

/**
 * 🔴 **676 · the same count, said by `list_questions`** — {@link unreadRowsSentence}'s shape and
 * rule, naming what THIS list could be short of. ⛔ It instructs nothing, for that sentence's reason.
 */
const unreadQuestionRowsSentence = (count: number): string =>
  `${String(count)} ${count === 1 ? 'row' : 'rows'} of this app's record could not be read, so ` +
  'a question may be missing from the list above, or its words may be absent. ' +
  'Nothing records why.'

/** ⚑ **D-017 · R8** — `count` conversations whose whole record a read skipped, spelled once. */
const recordsOf = (count: number): string =>
  count === 1 ? "1 conversation's record" : `${String(count)} conversations' records`

/**
 * 🔴 **D-017 · R8 — what a list of work says when it skipped whole records** — its own sentence
 * beside {@link unreadRowsSentence}, because a whole record is not one row.
 */
const skippedRecordsSentence = (count: number): string =>
  `${recordsOf(count)} could not be read, so ` +
  'a piece of work may be missing from the lists above, or its state may be wrong. ' +
  'Nothing records why.'

/** ⚑ **D-017 · R8 — the same, said by `list_questions`** — {@link unreadQuestionRowsSentence}'s. */
const skippedQuestionRecordsSentence = (count: number): string =>
  `${recordsOf(count)} could not be read, so ` +
  'a question may be missing from the list above, or its words may be absent. ' +
  'Nothing records why.'

/** ⚑ **D-017 · R8** — the sentence for skipped records, or nothing when none were skipped. */
const whenSkipped = (count: number | undefined, say: (count: number) => string): string[] =>
  count === undefined || count === 0 ? [] : [say(count)]

/**
 * ⚑ **What `list_tasks` and `list_questions` list.** Not told otherwise, what is open: what is over
 * is counted, and listed only when asked for — `ended`, or `all` — newest first and no more than a
 * limit. So an answer stays the size of the work in hand, however long the history behind it.
 */
export const LISTINGS = LISTING_INPUT.members
type Listing = (typeof LISTINGS)[number]

/** How many ended rows a list returns unless the caller says, and the most it ever returns. */
export const ENDED_LISTED = 20
export const ENDED_LISTED_AT_MOST = 200

const LIMIT_DESCRIBED = (what: string): string =>
  `How many ended ${what} to list at most, newest first — ${String(ENDED_LISTED)} unless you say, and never more than ${String(ENDED_LISTED_AT_MOST)}. The rest are counted.`

/** The listing a call asked for, or what is wrong with how it asked. */
function theListingAsked(
  state: unknown,
  limit: unknown,
): { readonly listing: Listing; readonly limit: number } | { readonly problems: string[] } {
  const problems: string[] = []
  if (state !== undefined && !LISTINGS.some((one) => one === state)) {
    problems.push('state, when given, must be open, ended or all')
  }
  if (
    limit !== undefined &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > ENDED_LISTED_AT_MOST)
  ) {
    problems.push(
      `limit, when given, must be a whole number from 1 to ${String(ENDED_LISTED_AT_MOST)}`,
    )
  }
  if (problems.length > 0) return { problems }
  return {
    listing: (state as Listing | undefined) ?? 'open',
    limit: (limit as number | undefined) ?? ENDED_LISTED,
  }
}

/** How many rows go by each word, in the order the words are first met. */
function countedBy<Row>(rows: readonly Row[], word: (row: Row) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const row of rows) counts[word(row)] = (counts[word(row)] ?? 0) + 1
  return counts
}

/** Counts as a sentence says them, the largest first: `35 done, 2 withdrawn`. */
const countsSaid = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts)
    .sort(([a, one], [b, other]) => other - one || a.localeCompare(b))
    .map(([word, count]) => `${String(count)} ${word}`)
    .join(', ')

/**
 * What a listing shows of rows that are open or over: the open ones whole (unless only the ended
 * ones were asked for), any `kept` beside them in every listing — over, and still this caller's to
 * read, so never cut by the limit — then the other ended ones newest first up to the limit, and the
 * rest only counted.
 */
function listedOf<Row>(
  rows: readonly Row[],
  asked: { readonly listing: Listing; readonly limit: number },
  is: {
    readonly open: (row: Row) => boolean
    /** Over, and listed whole all the same. */
    readonly kept: (row: Row) => boolean
    readonly endedAt: (row: Row) => number | null
  },
): {
  readonly whole: readonly Row[]
  readonly ended: readonly Row[]
  readonly rest: readonly Row[]
} {
  const open = rows.filter(is.open)
  const kept = rows.filter((row) => !is.open(row) && is.kept(row))
  const keptOrOpen = new Set([...open, ...kept])
  const over = rows
    .filter((row) => !keptOrOpen.has(row))
    .sort((a, b) => (is.endedAt(b) ?? 0) - (is.endedAt(a) ?? 0))
  const ended = asked.listing === 'open' ? [] : over.slice(0, asked.limit)
  return {
    whole: asked.listing === 'ended' ? kept : [...open, ...kept],
    ended,
    rest: [...over.slice(ended.length), ...(asked.listing === 'ended' ? open : [])],
  }
}

/** How a piece that is over ended, as a count says it: how its holder said it went, else its state. */
const howAPieceEnded = (piece: PieceRow): string =>
  TASK_IS_OPEN[piece.state] ? 'open' : (piece.outcome ?? piece.state)

/**
 * Why a piece that is over is still its giver's to read: its answer reached no conversation, so its
 * words are on the piece and nowhere else, or it is held for the giver and has not yet gone into one
 * of its turns. ⚑ Such a piece is listed whole, in every listing: nothing else tells its giver to
 * look. ⚠️ An answer that reached nobody stays so for good, and so does its listing.
 */
type AnswerNotRead = 'reached-nobody' | 'held-for-you'

const ANSWER_NOT_READ_SAID: Readonly<Record<AnswerNotRead, string>> = {
  'reached-nobody': 'its answer reached no conversation, and its words are here',
  'held-for-you': 'its answer is held for you and has not reached you yet',
}

/**
 * A piece that is over, as a board lists it: one line, and no words of its answer — but the two
 * things about it a giver may still have to act on: a person has to move, as its holder said, and a
 * question of its own was lost at a restart.
 */
const endedPieceText = (piece: PieceRow): string =>
  `  ${pieceLine(piece.label, piece.title)} · ${piece.state}${
    piece.outcome === null ? '' : ` · ${piece.outcome}`
  }${piece.endedAt === null ? '' : ` · ended ${clockTime(piece.endedAt)}`}${
    piece.needsUserAction ? ' · its holder said a person has to act' : ''
  }${piece.questionLostAtRestart ? ' · a question of its own was lost at a restart' : ''}`

/** ⚑ {@link endedPieceText}'s facts, as a payload carries them; its record holds the rest. */
const endedPiecePayload = (piece: PieceRow): Readonly<Record<string, unknown>> => ({
  piece: piece.piece,
  label: piece.label,
  title: piece.title,
  state: piece.state,
  outcome: piece.outcome,
  ended_at: piece.endedAt,
  ...(piece.needsUserAction ? { needs_user_action: true } : {}),
  ...(piece.questionLostAtRestart ? { question_lost_at_restart: true } : {}),
})

const HOW_TO_LIST_MORE_PIECES =
  'list_tasks takes state — open, ended or all — and limit, which is how many ended pieces it lists, newest first; naming a piece reads its whole record.'
const HOW_TO_LIST_MORE_QUESTIONS =
  'list_questions takes state — open, ended or all — and limit, which is how many ended questions it lists, newest first.'

/**
 * ⚑ **One routed question, as a model reads it** (396) — the derivation's own fields in the
 * snake_case a tool payload speaks, and otherwise not reshaped.
 *
 * ⛔ **`words` is present only when it is this caller's to read**, which is
 * {@link RuntimeHost.questionsWaitingOn}'s ruling and not this function's: everything here copies.
 * ⚠️ **`because` names WHICH SHAPE the channel refused, and it is null on the other two arms** —
 * it is the same word `answer_question` refuses with, so a reader that lists and a caller that is
 * refused meet one vocabulary. ⛔ **611 · it said *why a question is not the caller's to answer***,
 * and that stopped being what it names: a question its asker ADDRESSED to a person carries no
 * refusal and IS the caller's to answer. ⚑ `went_to` is the field that says where it went.
 *
 * ⚑ **Nothing is computed.** A payload that decided for itself whether a question was *"still
 * live"* would be a second reading of `REQUEST_IS_OPEN`, free to disagree with the door.
 */
const questionPayload = (one: VisibleQuestion): Readonly<Record<string, unknown>> => ({
  question: one.request.requestId,
  asked_by: one.request.askedBy,
  state: one.request.state,
  // 🔴 **611 · the REFUSED arm is the only thing this caller may not answer** (HO-088 §2.3).
  // ⛔ It was `because === null`, which was the same set until an asker could address a question
  // to a person. ⚑ **Addressing is where a question GOES, not a lock on who may answer it** —
  // `admitAnswer` still admits one, so a payload saying `false` here would tell a model it would
  // be refused by a door that would have taken it.
  answerable_by_you: one.request.went.is !== 'the-person-the-channel-left-it-with',
  because: theChannelRefusalIn(one.request),
  // ⛔ **611 · where it went, in this app's own word** — see {@link WhereARequestWent}. ⚑ It is
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

/**
 * ⚠️ **The line a model reads, and a state that a word cannot carry is spelled out.**
 *
 * ⛔ **A state gets a sentence when the word alone would send a reader the wrong way**, which is two
 * of them and not a habit:
 *
 *  - **`stranded`** (396) — the conversation is still there and the request is not, and a reader
 *    told only the word would as likely conclude its child had gone away, which is the wrong thing
 *    to do about a conversation it can ask again.
 *  - **`interrupted`** (397) — the same trap one act over. The work was asked to stop, the card
 *    went with it (written at the ask, before the provider answers — 709), and the conversation is
 *    idle and asking for something to do. ⚑ **The sentence says the
 *    request ended, never who ended it**: `WhoStoppedIt` is a fact about a gesture and lives
 *    on `work_interrupted`, and *"a person stopped it"* printed here would be `222`'s false sentence
 *    reappearing in a tool payload — it is as often the reading agent's own `interrupt_agent`.
 *
 * ⚑ **The words themselves are NOT on this line.** They are a whole question with its parts, and
 * printing them inside a line would bury the other rows. `list_questions` prints them as an
 * indented block under the line.
 */
const QUESTION_STATE_SENTENCE: Partial<Readonly<Record<RequestState, string>>> = {
  stranded:
    'the app restarted while it was waiting — that conversation is still there, ask it again',
  // 🔴 **709 · R43 — `interrupted` is written at the ASK** (`request_interrupted`, before the
  // provider is told), so the sentence says the ask: the turn itself may have completed.
  interrupted: `the work it was raised in was ${ASKED_TO_STOP}, so it was never answered — that conversation is still there, ask it again`,
  // 🔴 **591 · the third, and it is the same trap one act over.** ⛔ The word alone says a
  // withdrawal and a reader would as likely conclude the ASKING model retracted its own question,
  // which is the one thing that did not happen. ⚠️ **The sentence says the request ended and never
  // who ended it** — the actor is on the `work_taken_back` row, and *a person took it back* printed
  // here would be `222`'s false sentence reappearing in a tool payload: it is as often the reading
  // agent's own `withdraw_task`.
  'work-withdrawn':
    'the work it was about was taken back, so nothing is left to decide — that conversation is still there, and list_tasks says what it holds now',
  // ⚑ **D-016 · `work-withdrawn`'s twin for a close**, and for its reason: it says the request ended
  // and never who ended it — the actor is on the `work_closed` row.
  'work-closed':
    'the work it was about was closed by the one that gave it, so nothing is left to decide — that conversation is still there, and list_tasks says what it holds now',
  // The twin for a hand-back: it says the request ended, and the reply row names who replied.
  'work-replied':
    'the work it was about was handed back, so nothing is left to decide — that conversation is still there, and list_tasks says what it holds now',
  // 🔴 **675 · it printed as the bare word until now** (`661` F2). ⚑ **D-017 · R4 — only a request
  // the conversation's own provider raised is `abandoned`, by a stop** (a question this app asked
  // outlives one), and nothing brings it back: a later message starts the conversation, and the
  // request is not offered again. ⛔ So it promises no return, and it does not say *ask it again*
  // (`the-word-for-a-question-nobody-stopped` pins that): it says what became of the request.
  // ⚠️ A ledger written before D-017 replays its own rows, and nothing routes them again (D-016 ·
  // ruling 14 took the launch sweep that did).
  abandoned:
    'the conversation that raised it stopped while it was waiting, and the request stopped with it, so it cannot be answered',
}

/**
 * ⛔ **608 · `stillTheirs` stood here and is GONE with the wait it chose a sentence for**
 * (HO-084 §4).
 *
 * ⚑ **`591` added it for one caller**: `ask_question` came back from a five-minute race and had to
 * say whether the silence it met still had an answer coming. ⛔ **There is no race now** — the
 * verb returns the moment the rows are written, so the row it would have asked about is `open` by
 * construction and the branch had one arm.
 *
 * ⚠️ **What it stood for did not go anywhere.** {@link REQUEST_IS_OPEN} is still the one table
 * that decides whether a question has ended, `admitAnswer` still refuses by it, and
 * {@link QUESTION_STATE_SENTENCE} still renders an ended request's word for `list_questions` —
 * which is where a model now reads what became of something it asked.
 */

/**
 * ⚑ **F033 · what a line calls a conversation, about one piece** — its root, else its own piece on
 * that piece's chain ({@link AgentToolHost.nameByItsWorkUnder}); about none, what it is called now.
 */
type WhatToCallItUnder = (conversation: string, about: string | null) => string

/**
 * ⚑ **D-016 · commit 7 · R3 — each conversation named by the piece it owns, once per CALL** —
 * memoised as `list_tasks` memoised its askers' names (724): a line per row names one conversation
 * once, and the price is bounded by the rows the call returns. ⚑ **F033 · by the piece the line is
 * about** — a message by the piece it was sent under, an ask to stop by the piece it stopped — once
 * per conversation and piece.
 */
const namedByItsWorkOnce = (host: Pick<AgentToolHost, 'nameByItsWorkUnder'>): WhatToCallItUnder => {
  const names = new Map<string, string>()
  return (conversation, about) => {
    const key = `${conversation}\u0000${about ?? ''}`
    const known = names.get(key)
    if (known !== undefined) return known
    const name = host.nameByItsWorkUnder(conversation, about)
    names.set(key, name)
    return name
  }
}

const questionLine = (one: VisibleQuestion): string => {
  const said = QUESTION_STATE_SENTENCE[one.request.state]
  const refused = theChannelRefusalIn(one.request)
  // ⚑ **D-016 · commit 7 · R3 — the asker by its agent's name and its piece** — ⚑ F033 · the one it
  // asked under ({@link VisibleQuestion.askerCalled}), as the question's own words name it. The
  // payload keeps its id.
  return `  ${one.request.requestId} · from ${one.askerCalled} · ${one.request.state}${
    said === undefined ? '' : ` (${said})`
  }${
    refused === null
      ? // 🔴 **611 · the third clause, and it says what this row is rather than what it is
        // not** (HO-088 §2.3). ⛔ A question its asker addressed to a person reads exactly like
        // one addressed to this caller on every other field, and the difference decides whether
        // answering it is doing somebody's job or taking it off them. ⚑ **It says the caller MAY
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

/**
 * 🔴 **`words: null` has TWO meanings and only one of them was ever said** (484, HO-031 §3).
 *
 * ⛔ **The gate's null is stated by its neighbour and the OTHER null is not.** A routing on
 * {@link WhereARequestWent}'s refused arm carries a `because`, so *"a person answers this one"* is
 * already on the line and the absent words follow from it. ⚠️ **A question that IS this caller's to answer can reach here with no
 * words too** — {@link RuntimeHost.questionsWaitingOn} returns `null` when the asker's ledger holds
 * no readable row for the id, which is a `.brobot` bundle whose payload this build cannot parse, or
 * a row `toPersistedEvents` skipped — and that null said nothing at all.
 *
 * 🔴 **So it says it, and that is HO-031 §1's own finding applied rather than admired.** The PO on
 * `not_recorded`: *"a tool that admits what it does not know made a supervisor check rather than
 * trust… More tools should carry that block, and it should be treated as a feature rather than a
 * caveat."* ⛔ A reader that met a bare `null` here would reasonably conclude the question had no
 * words, and `answer_question` would then refuse it for a part it never listed.
 */
const wordsMissingClause = (one: VisibleQuestion): string =>
  // ⚑ **611 · the REFUSED arm is the one whose absent words are already accounted for** — and an
  // addressed question keeps its words (`questionsWaitingOn`), so a null here means the same thing
  // it means for a question addressed to this caller: the app does not hold them.
  one.request.went.is !== 'the-person-the-channel-left-it-with' && one.words === null
    ? ' · this app does not hold the words for this one — it cannot be answered from here'
    : ''

/**
 * ⚑ **D-012 · who sent a message, as `read_transcript` hands it over** — the kind, and the agent id
 * where there is one (the value `message_agent` and `ask_question` take).
 */
function senderPayload(from: WhoSentIt): Record<string, unknown> {
  switch (from.is) {
    case 'an-agent':
      return { kind: 'an-agent', agent: from.conversation }
    case 'this-app':
      return from.carrying === null
        ? { kind: 'this-app' }
        : { kind: 'this-app', carrying_words_of: from.carrying.conversation }
    default:
      return { kind: from.is }
  }
}

/** ⚑ **D-012 · words as `read_transcript` hands them over** — the cut said, never hidden. */
function wordsPayload(words: Words): Record<string, unknown> {
  return 'unreadable' in words
    ? { unreadable: true }
    : { text: words.text, ...(words.clipped ? { clipped: true } : {}) }
}

/**
 * ⚑ **D-012 · a message received, as `read_transcript` hands it over** — 🔴 **D-027 · with the
 * messages that came with it in one turn, oldest first** (`came_with`), only when there were several.
 */
function receivedPayload(received: ReceivedInATurn): Record<string, unknown> {
  const one = (message: Received): Record<string, unknown> => ({
    from: senderPayload(message.from),
    ...wordsPayload(message.words),
  })
  return {
    ...one(received),
    ...(received.cameWith === undefined ? {} : { came_with: received.cameWith.map(one) }),
  }
}

/**
 * ⚑ **D-027 · the messages one turn delivered, oldest first** — those that came with the last, then
 * the last.
 */
const oldestFirst = (received: ReceivedInATurn): readonly Received[] => [
  ...(received.cameWith ?? []),
  received,
]

/** ⚑ **D-012 · who sent it, in a clause** — the agent by name and id, never the id alone. */
function fromClause(from: WhoSentIt, named: (who: AConversation) => string): string {
  switch (from.is) {
    case 'a-person':
      return 'a person'
    case 'an-agent':
      return named(from)
    case 'this-app':
      return from.carrying === null
        ? 'this app'
        : `this app, carrying the words of ${named(from.carrying)}`
    case 'its-own-cli':
      return 'its own CLI, typed there'
    case 'unreadable':
      return 'a sender this app could not read'
  }
}

/** ⚑ **D-012** — words as a block of text, with a cut or an unreadable row said as such. */
/** ⚑ **F080** — how many of a wake's background endings a transcript turn quotes, newest last. */
const SUMMARIES_SHOWN = 5

function wordsBlock(words: Words): string {
  if ('unreadable' in words) return '(this app could not read these words from its record)'
  return words.clipped
    ? `${words.text}\n(cut at ${String(WORDS_CAP)} units — there was more)`
    : words.text
}

/**
 * 🔴 **D-012 · the words a model reads back from `read_transcript`** — the last exchange first,
 * then the turns oldest first, each quotation a block of its own (`614`'s placement).
 */
function transcriptText(
  name: string,
  last: Exchange,
  turns: readonly TranscriptTurn[],
  older: boolean,
  named: (who: AConversation) => string,
): string {
  const lines: string[] = []
  // ⚑ **D-027 · each message a turn of several delivered, under its own sender.**
  const eachFrom = (came: readonly Received[]): string[] =>
    came.map((one) => `From ${fromClause(one.from, named)}:\n${wordsBlock(one.words)}`)
  if (last.received === null) {
    lines.push(`${name} has received no message this app can show.`)
  } else {
    const came = oldestFirst(last.received)
    if (came.length === 1) {
      lines.push(
        `The last message ${name} received came from ${fromClause(last.received.from, named)}:`,
      )
      lines.push(wordsBlock(last.received.words))
    } else {
      lines.push(
        `The last ${String(came.length)} messages ${name} received came together in one turn, oldest first:`,
        ...eachFrom(came),
      )
    }
    // 🔴 **F080 — a turn its provider started after it answered no message**, so its words are
    // its latest, not its words back.
    if (last.sinceThenItsProviderStartedATurn === true) {
      lines.push(`Since then, ${name}'s provider started a turn by itself.`)
    }
    lines.push(
      last.answer === null
        ? `${name} has said nothing back to it yet.`
        : last.sinceThenItsProviderStartedATurn === true
          ? `${name}'s latest words:\n${wordsBlock(last.answer)}`
          : `${name}'s latest words back:\n${wordsBlock(last.answer)}`,
    )
  }
  if (turns.length === 0) return lines.join('\n\n')
  lines.push(
    `Its turns, oldest first${older ? ' (there are older ones: a larger turns_back, or a search, reads them)' : ''}:`,
  )
  turns.forEach((turn, index) => {
    // 🔴 **F080 — a turn its provider started by itself is its own entry**, with what its provider
    // said ended just before it, in its own words, each on a line of its own.
    if ('startedByItsProvider' in turn) {
      const after = turn.startedByItsProvider.after
      if (after.length === 0) {
        lines.push(
          `Turn ${String(index + 1)}, which its provider started by itself; no message opened it.`,
        )
      } else {
        // ⚑ The provider's own words, a block of their own (`614`'s placement), the newest few.
        const shown = after.slice(-SUMMARIES_SHOWN)
        lines.push(
          `Turn ${String(index + 1)}, which its provider started by itself after its background work ended${after.length > shown.length ? ` (the last ${String(shown.length)} of ${String(after.length)})` : ''}:`,
          shown.join('\n'),
        )
      }
      lines.push(
        turn.said === null
          ? `${name} said nothing in it.`
          : `${name} said:\n${wordsBlock(turn.said)}`,
      )
      return
    }
    const came = oldestFirst(turn.received)
    lines.push(
      came.length === 1
        ? `Turn ${String(index + 1)}, from ${fromClause(turn.received.from, named)}:\n${wordsBlock(turn.received.words)}`
        : [
            `Turn ${String(index + 1)}, ${String(came.length)} messages together, oldest first:`,
            ...eachFrom(came),
          ].join('\n\n'),
    )
    lines.push(
      turn.said === null ? `${name} said nothing back.` : `${name} said:\n${wordsBlock(turn.said)}`,
    )
  })
  return lines.join('\n\n')
}

const answer = (structured: Readonly<Record<string, unknown>>, text: string): AgentToolAnswer => ({
  text,
  structured,
})

const refusalAnswer = (payload: ToolRefusalPayload): AgentToolAnswer =>
  answer({ ...payload }, `refused (${payload.rail}): ${payload.reason}`)

/**
 * ⚑ **A give that took its label and gave nothing** — the failure as it is said alone, and the label
 * beside it in the payload (which a model reads too), so a reader who meets the label finds that no
 * piece is called by it: it is never handed out again (`work_sequence`). ⛔ Not in the text: a
 * refusal's line stays short.
 */
const itsLabelIsNotUsed = (failed: AgentToolAnswer, label: string): AgentToolAnswer =>
  answer({ ...failed.structured, label_not_used: label }, failed.text)

/**
 * ⚑ **D-017 · R10 — what a receipt says about a conversation that could never be reopened** (`05`
 * rule 3): once, to the sender whose message found it, what happened — and after that, where each
 * message went. `''` when nothing replaced it.
 *
 * 🔴 **D-016 · commit 7 · R3 — named by the work each holds, and never by an id**: the one that
 * could not be reopened by the piece it owns, and the one in its place by its address — the label of
 * the piece that names it, or its id when it holds none — which every door that takes an agent takes.
 */
function whereItWent(
  agent: string,
  before: string | null,
  wentTo: string | null,
  host: Pick<AgentToolHost, 'nameByItsWork' | 'whatToCallTheConversation' | 'addressOf'>,
): string {
  if (wentTo === null) return ''
  const who = host.whatToCallTheConversation(wentTo)
  const was = host.nameByItsWork(agent)
  const now = host.addressOf(wentTo)
  return before === null
    ? `The history of ${was} could not be reopened, so a new conversation of ${who}, ${now}, took your message. It has ${who}'s memory but not that history. `
    : `${was} could not be reopened, and a new conversation of ${who}, ${now}, took its place: `
}

/**
 * ⚑ **F084 · what a stop that makes way for words ends, on the receiver's provider** — said when its
 * turn had not ended within the wait, so what it did end is not known yet.
 */
function theRuleOfAStopForWords(provider: Provider | undefined, called: string): string {
  if (provider === undefined) {
    return (
      PROVIDER_DESCRIPTORS.map(
        (descriptor, index) =>
          `${index === 0 ? 'On' : 'on'} ${descriptor.displayName}, ${descriptor.words.interruptSummary}`,
      ).join('; ') + '.'
    )
  }
  const words = providerDescriptor(provider).words.stopForWords
  return `${words.beforeName}${called}${words.afterName}`
}

/**
 * What a receipt says about the stop an interrupting message asked for, and the fields that say it.
 * ⚑ **F084** — once the stopped turn has ended, what its stop ended and what still runs, named.
 */
function whatBecameOfTheStop(
  now: {
    readonly stop: TheStopAMessageGot
    readonly askedOf: string | null
    readonly ended?: readonly string[]
    readonly stillRunning?: readonly string[]
    readonly provider?: Provider
  },
  /**
   * ⚑ **The receiver as a LATER sentence names it — its name alone**
   * ({@link AgentToolHost.whatToCallTheConversation}). These words always follow the receipt's first
   * sentence, which named it in full, by the piece it owns: said in full again, the one name ran
   * five times through one paragraph.
   */
  called: string,
  what: 'this message' | 'your answer' | 'your reason',
  yours: (conversation: string) => boolean,
  nameOf: (conversation: string) => string,
  /**
   * ⚑ The receipt already says what the held words wait for ({@link heldAndWhy}), so a stop refused
   * because a person is being asked says only why it was refused.
   */
  itsWaitIsSaid = false,
): { readonly structured: Readonly<Record<string, unknown>>; readonly said: string } {
  const notStopped = { asked_to_stop: false, not_stopped_because: now.stop }
  switch (now.stop) {
    case 'asked': {
      // ⚑ **F084 · what it ended and what still runs, once its turn ended** — else the rule its
      // provider stops by, said as a rule: what happens, not what has.
      const runs = now.stillRunning ?? []
      const left =
        now.ended === undefined
          ? theRuleOfAStopForWords(now.provider, called)
          : `${
              now.ended.length === 0
                ? 'The stop ended none of its commands'
                : `The stop ended ${theStoppedWork(now.ended)}`
            }${runs.length === 0 ? '' : `; ${called} still has ${theStoppedWork(runs)} running in the background`}.`
      return {
        structured: {
          asked_to_stop: true,
          ...(now.ended === undefined ? {} : { ended: now.ended }),
          ...(runs.length === 0 ? {} : { still_running: runs }),
        },
        said: `The turn ${called} was running was ${ASKED_TO_STOP}, so that ${what} need not wait for that work to finish, and ${called} is told you asked for the stop. ${left}`,
      }
    }
    case 'not-needed':
      return {
        structured: notStopped,
        said: 'No turn was running that needed stopping, so nothing was interrupted.',
      }
    case 'not-below-you':
      return {
        structured: notStopped,
        said: `${called} is not one you started, or one started under them, so its turn was not stopped; ${what} waits for that turn to end.`,
      }
    case 'a-person-is-replacing-its-turn':
      return {
        structured: notStopped,
        said: `A person is already stopping the turn ${called} was running to give it their own words, so it was not interrupted again; ${what} goes with or after theirs.`,
      }
    case 'a-person-is-being-asked':
      return {
        structured: notStopped,
        said: itsWaitIsSaid
          ? `The turn ${called} is running was not interrupted: stopping it would answer for the person it waits on.`
          : `The turn ${called} is running waits for a person's answer, and stopping it would answer for them, so it was not interrupted; ${what} waits for that turn to end.`,
      }
    case 'it-is-waiting-on-an-answer': {
      const owedBy = now.askedOf
      if (owedBy !== null && yours(owedBy)) {
        return {
          structured: { ...notStopped, asked_of: owedBy },
          said: `The turn ${called} is running waits for your answer to its question, and stopping it would throw that question away, so it was not interrupted. Answer it with answer_question; ${what} waits for that turn to end.`,
        }
      }
      return {
        structured: { ...notStopped, ...(owedBy === null ? {} : { asked_of: owedBy }) },
        said: `The turn ${called} is running waits for an answer from ${owedBy === null ? 'another conversation' : nameOf(owedBy)}, and stopping it would throw that question away, so it was not interrupted; ${what} waits for that turn to end.`,
      }
    }
    case 'could-not-be-asked':
      return {
        structured: notStopped,
        said: `The turn ${called} was running could not be asked to stop, so ${what} waits for that turn to end. interrupt_agent can ask again.`,
      }
    case 'a-person-started-its-turn':
      return {
        structured: notStopped,
        said: `A person's own words started the turn ${called} is running, so it was not interrupted; ${what} waits for that turn to end.`,
      }
    case 'already-asked':
      return {
        structured: notStopped,
        said: `The turn ${called} was running had already been ${ASKED_TO_STOP}, so it was not asked again; ${what} goes in as that turn ends.`,
      }
  }
}

/**
 * ⚑ **D-017 · R12 — an id this caller may not reach, answered in one sentence at every door**
 * (`RuntimeHost.whyItIsOutOfReach`): `no-such-agent` only for an id no conversation has — and for a
 * label that names nothing this caller may reach (D-016 · commit 7 · R1) — its own word for one a
 * message cannot start, and the reach rail `message_agent` meets for one outside the caller's reach
 * — carried as it was built.
 */
const outOfReachAnswer = (out: OutOfReach, agent: string): AgentToolAnswer => {
  if (out.is === 'no-such-agent') return refusalAnswer(refuseTool('no-such-agent', { agent }))
  if (out.is === 'takes-no-messages') {
    return refusalAnswer(refuseTool('that-conversation-takes-no-messages', { agent }))
  }
  return answer(
    carryMessageRefusal(out.refusal),
    `refused (${out.refusal.rail}): ${out.refusal.reason}`,
  )
}

/**
 * ⛔ **The identity a tool call is made under** (347).
 *
 * ⚠️ **Namespaced, and not merely "a session id that happens not to collide with a window id."**
 * A window's owner id is `webContents:<n>` ({@link sinkOwnerId}); this is `agent:<session>`. The two
 * namespaces cannot meet, so no agent can ever present itself as the surface that owns a session —
 * which matters because `mayControl` compares `ownerId` by equality and would hand over a window's
 * whole entitlement to anything that could spell its id.
 */
/**
 * 🔴 **What a delivery that did not happen answers, in this file's vocabulary** — `message_agent`'s
 * words, and `give_work`'s for a brief that did not arrive (D-016): one classification, so the two
 * doors cannot come to say one failure two ways. ⚑ **One arm reads `tool`**: a start in flight that
 * never came up leaves no conversation by the id a message NAMED, and a give named a profile.
 *
 * ⚑ **The host's own refusal, classified.** The host is where the rule lives; all that happens here
 * is that a throw becomes a payload a model can read as policy.
 */
function whatADeliveryMet(
  error: unknown,
  agent: string,
  tool: Extract<ToolName, 'message_agent' | 'give_work'>,
): AgentToolAnswer {
  // 🔴 **A rule stopped this, and the payload says which one** (374). ⛔ **Asked before every
  // host-state answer below**, because it is not one: the conversation is perfectly able to take a
  // message and the caller is perfectly able to reach it — what happened is that a person has
  // narrowed what this identity may do, and `agent-cannot-take-a-message` would say something false
  // about the agent on the other end (340's *a reason answering with another reason's sentence*).
  // ⚠️ **The payload is `341`'s shape and is carried unchanged.**
  if (error instanceof MessagingRefused) {
    const carried = carryMessageRefusal(error.refusal)
    return answer(carried, `refused (${error.refusal.rail}): ${error.refusal.reason}`)
  }
  // 🔴 **692 · the START this delivery asked for did not happen** — ⚑ **D-017 · R1**: of any
  // conversation that was not running — answered in the WAKE's words, because it was a wake: the
  // reopen's failure classified by {@link aWakeThatDidNotHappen}, with its true reason. ⛔ Only this
  // type: `aWakeThatDidNotHappen` asked of every throw below would re-word refusals that have nothing
  // to do with a start.
  if (error instanceof AStartThatDidNotHappen) {
    // ⚑ **D-017 · R1 — a launch in flight that failed before anything was recorded**: the delivery
    // waited on it, and there is no such conversation. ⚠️ The host's person-read refusal carries
    // the reason on its `cause`, as the classifier reads it.
    const { cause } = error
    const unavailable =
      unavailableOf(cause) ??
      (cause instanceof Error ? unavailableOf((cause as { cause?: unknown }).cause) : null)
    if (unavailable === 'not-recorded') {
      // ⚑ **`message_agent` named that id, and the identical retry meets `no-such-agent`**; ⛔ a give
      // named a profile, and the identical give starts a new conversation (D-016).
      return refusalAnswer(
        tool === 'give_work'
          ? refuseTool('the-start-it-waited-on-did-not-happen', { agent })
          : refuseTool('no-such-agent', { agent }),
      )
    }
    const unwoken = aWakeThatDidNotHappen(error.cause)
    if (unwoken === null) throw error.cause
    console.warn(
      `${tool}: the start did not happen (${unwoken.because}): ${
        error.cause instanceof Error ? error.cause.message : String(error.cause)
      }`,
    )
    return refusalAnswer(aWakeRefused(unwoken, agent))
  }
  const said = error instanceof Error ? error.message : String(error)
  // 🔴 **650 · the arm of the fold below that clears with nobody acting**, by the TYPE thrown where
  // its fact is known — never by `said`. ⛔ **A reservation being CLOSED stays in the fold**: it will
  // never come up, and telling a caller to make the same call again would be a retry this app
  // already knows cannot work. 🔴 **681 · what this answers AFTER** (PM ruling R30b): every POLICY
  // wall a running receiver would refuse this caller by, so a retry is never refused by a grant the
  // caller could have been told about now (`650` F1).
  if (error instanceof SessionStillStarting && !error.closing) {
    return refusalAnswer(refuseTool('that-conversation-has-not-started', { agent, said }))
  }
  return refusalAnswer(refuseTool('agent-cannot-take-a-message', { agent, said }))
}

export const agentCallerId = (sessionId: string): string => `agent:${sessionId}`

/**
 * ⛔ **Which session is speaking, when the caller is an agent rather than a window** — the exact
 * inverse of {@link agentCallerId}, and `null` for every other kind of caller (347).
 *
 * ⚠️ **This is a decoder, not a permission.** It answers *"who is this"*, and every use of it has to
 * decide for itself what that entitles. It lives beside the encoder so the two spellings cannot
 * drift apart, which is the only reason a prefix scheme is safe to depend on.
 */
export function sessionSpeakingAs(by: Caller): string | null {
  if (typeof by !== 'object' || by === null) return null
  const ownerId: unknown = (by as { ownerId?: unknown }).ownerId
  if (typeof ownerId !== 'string' || !ownerId.startsWith('agent:')) return null
  const said = ownerId.slice('agent:'.length)
  return said.length === 0 ? null : said
}

/** What the tools are built against — the host, narrowed to what they may reach. */
export interface AgentToolHost {
  readonly themes?: RuntimeHost['themes']
  /** 🔴 **D-016 · the give** — `give_work`'s one host door, which asks every rail itself. */
  giveWork: RuntimeHost['giveWork']
  /**
   * 🔴 **D-016 · commit 6 · `take_on_work`'s door** — a piece under the caller's own root, given by
   * the person. Nothing is sent.
   */
  takeOnWork: RuntimeHost['takeOnWork']
  /**
   * 🔴 **D-016 · `update_work`'s door** — a piece's title, status line, new brief, close and kept
   * files. ⚑ Async: a new brief, a close and the files its giver hands over tell the agent holding
   * the piece, and a file that cannot be kept answers its own refusal.
   */
  updateWork: RuntimeHost['updateWork']
  /**
   * ⚑ **D-016 · what a piece a message names is, to its sender and that agent** — `message_agent`
   * decides from it which of its words applies; the lookup is the entitlement.
   */
  whatAPieceIsTo: RuntimeHost['whatAPieceIsTo']
  /** ⚑ **D-016 · `read_document`'s door** — a resource by its id. */
  readResource: RuntimeHost['readResource']
  queueMessage: RuntimeHost['queueMessage']
  messageAgentNow: RuntimeHost['messageAgentNow']
  agentsVisibleTo: RuntimeHost['agentsVisibleTo']
  /** `restore_agent`'s door: the person's Restore, saying in the transcript which agent did it. */
  restoreAsAnAgent: RuntimeHost['restoreAsAnAgent']
  /** The archived conversations the caller may reach: what `list_agents` leaves out by default. */
  archivedVisibleTo: RuntimeHost['archivedVisibleTo']
  /** When a conversation was archived, or `null`: said on its card, and what puts a piece away. */
  whenItWasArchived: RuntimeHost['whenItWasArchived']
  agentCard: RuntimeHost['agentCard']
  /** ⚑ What opened a conversation's last turn that ended — `get_agent_status` says it. */
  whatOpenedItsLastTurn: RuntimeHost['whatOpenedItsLastTurn']
  /**
   * ⚑ **D-017 · R12 — why an id is out of this caller's reach**, one answer for every door that
   * takes an agent id — see {@link outOfReachAnswer}.
   */
  whyItIsOutOfReach: RuntimeHost['whyItIsOutOfReach']
  /**
   * 🔴 **D-016 · commit 7 · R1 — the one reading of an agent address, a label or an id** — asked by
   * every door that takes one, before its rails, with the reach that door reads (`TheDoorsReach`): a
   * label names its piece's owner wherever the door would serve that owner's id, and anything else
   * is handed back as spelled.
   */
  theConversationAddressed: RuntimeHost['theConversationAddressed']
  /** ⚑ **D-017 · R10** — where a message to a conversation that could never be reopened went. */
  tookItsPlace: RuntimeHost['tookItsPlace']
  /**
   * ⚑ **Why what is held for a conversation waits for its reopen on the current Claude sign-in**,
   * or (F074) for its provider's usage limit to reset, or `null` — for every answer that says a
   * delivery is held.
   */
  whyWhatIsHeldWaits: RuntimeHost['whyWhatIsHeldWaits']
  /**
   * 🔴 **Which identities a caller may be told about** (488) — a READER whose whole entitlement
   * is the fold, exactly as {@link AgentToolHost.agentsVisibleTo} is one population over.
   *
   * ⛔ **The host asks it and this file may not.** `the-five-tools.test.ts` §6 forbids this module
   * from naming any capability, any capability column, `capabilitiesOf` or `agentIdentities` —
   * *"the tool layer holds no policy"* — so the grant that decides this answer is read where every
   * other grant in this app is read, and the door receives a reading it cannot widen.
   */
  profilesVisibleTo: RuntimeHost['profilesVisibleTo']
  navigationIdentity?: RuntimeHost['navigationIdentity']
  navigationProfileForConversation?: RuntimeHost['navigationProfileForConversation']
  /**
   * 🔴 **F009 · what one agent has done** — `list_profiles` naming it: its conversations through
   * this caller's reach, asked by the host ({@link RuntimeHost.agentRecord}).
   */
  agentRecord: RuntimeHost['agentRecord']
  replyToParent: RuntimeHost['replyToParent']
  maySaveMemory: RuntimeHost['maySaveMemory']
  /** ⚑ **D-016 · `list_tasks` with no argument** — the pieces a conversation holds and gave. */
  pieceBoard: RuntimeHost['pieceBoard']
  /** The pieces whose answer is held for the caller and has not yet gone into one of its turns. */
  answersHeldFor: RuntimeHost['answersHeldFor']
  /** ⚑ **D-016 · `list_tasks` naming a piece** — its record. */
  pieceRecord: RuntimeHost['pieceRecord']
  /** ⚑ **D-024 · R3 · `list_tasks` with `made`** — the files the caller's profile made. */
  madeByItsProfile: RuntimeHost['madeByItsProfile']
  /** ⚑ **D-037 · `find_files`** — the files kept on the caller's tree or everywhere. */
  findKeptFiles: RuntimeHost['findKeptFiles']
  searchWork?: RuntimeHost['searchWork']
  searchPastWork?: RuntimeHost['searchPastWork']
  /**
   * 🔴 **724 · `720` F-C — what a sentence calls a conversation: its agent's name** — ⚑ **D-016 ·
   * commit 7 · R3 — where a piece in the sentence already names that conversation** (the holder of
   * the piece given, of a record, or of work updated or taken back), or where the sentence names the
   * AGENT rather than one of its conversations (*"a new conversation of Ada"*). Anywhere else —
   * whoever asked a turn to stop included — the sentence says {@link AgentToolHost.nameByItsWork}.
   * ⛔ A NAME or a category, never the handle (`HO-095` §5.3).
   */
  whatToCallTheConversation: RuntimeHost['whatToCallTheConversation']
  /**
   * 🔴 **D-016 · commit 7 · R3 — what a sentence calls ANOTHER conversation** — its agent's name and
   * the piece it owns (`Ada (the owner of W1.2 · Build the pages)`), where no piece in the sentence
   * already names it.
   */
  nameByItsWork: RuntimeHost['nameByItsWork']
  /**
   * ⚑ **F033 · what a sentence about ONE piece calls another conversation** — its root, else its
   * own piece on that piece's chain, never what it holds now ({@link RuntimeHost.nameByItsWorkUnder}).
   */
  nameByItsWorkUnder: RuntimeHost['nameByItsWorkUnder']
  /**
   * ⚑ **D-016 · commit 7 · R3 — what a reader passes back to name a conversation** — the label of
   * the piece that names it, or its id when it holds none.
   */
  addressOf: RuntimeHost['addressOf']
  /** ⚑ **F033 · {@link addressOf}, for a sentence about one piece** ({@link nameByItsWorkUnder}). */
  addressOfUnder: RuntimeHost['addressOfUnder']
  /**
   * 🔴 **429's verb, and it answers rather than throwing** — `interruptAgent`'s precedent and
   * `createAgentFor`'s: every refusal a model can meet arrives as a VALUE, because a throw reaches
   * it as transport `-32603` and teaches it that its tool is broken.
   */
  takeBackPiece: RuntimeHost['takeBackPiece']
  takeBackWhatItsQuestionMadeFalse: RuntimeHost['takeBackWhatItsQuestionMadeFalse']
  answerQuestion: RuntimeHost['answerQuestion']
  /**
   * 🔴 **395's verb.** ⛔ **Deliberately `interruptAgent` and not `interrupt`**: `RuntimeHost.interrupt`
   * refuses a stranger by THROWING through `requireToCommand`, which reaches a model as a transport
   * error — *"a shape that tells the model its tool is broken rather than that a rule stopped it"*
   * (307, quoted by `message_agent`). The agent-facing verb answers.
   */
  interruptAgent: RuntimeHost['interruptAgent']
  /**
   * ⚑ **396's reader.** ⛔ **`questionsWaitingOn` and not `questionsVisibleTo`**: the second returns
   * the rows alone, and a parent handed only ids knows a question exists and cannot answer it.
   *
   * 🔴 **676 · reached through `questionsListedFor`**, which is `questionsWaitingOn` with the count
   * of rows its reads could not read — so this seam hands `list_questions` both, and nothing else.
   */
  questionsListedFor: RuntimeHost['questionsListedFor']
  /**
   * 🔴 **405's writer, and it is the host's own** (HO-019 §4).
   *
   * ⛔ **Not a `SessionStore` handed to this file.** `398` §6 measured a store-side append into a
   * ledger the host is running colliding with `HostedSession.ordinal`, after which `record()` logs
   * the first collision and returns — **every later durable event dropped SILENTLY**. A refusal
   * arrives mid-turn, which is precisely when that ledger is busiest, so this goes through
   * `publishOurs` like every other row this app authors.
   *
   * ⚠️ **Still not a policy.** This file's rule is that removing a line here must not let anything
   * past the chokepoint; removing this one loses a RECORD of a refusal that already happened.
   */
  noteRefusal: RuntimeHost['noteRefusal']
  /**
   * 🔴 **419's durable agent-creation writer.**
   *
   * ⛔ **`createAgentFor` and not `createAgent`**, which is `interruptAgent`'s precedent: the
   * person's verb THROWS on a taken name, and a thrown error reaches a model as a transport failure
   * — *"a shape that tells the model its tool is broken rather than that a rule stopped it"* (307).
   * ⚠️ The agent-facing verb answers, and it is the one that asks the grant and the switch.
   */
  createAgentFor: RuntimeHost['createAgentFor']
  /**
   * 🔴 **D-042 · R4 — the default `create_agent` names, judged by the one seam** — the list, then the
   * model's efforts — before anything is minted.
   */
  judgeTheDefaultItNames: RuntimeHost['judgeTheDefaultItNames']
  /**
   * 🔴 **486 · the standing walls, asked before a door reads an argument** (HO-031 §2.5).
   *
   * ⛔ **Each of these answers a question that needs NOTHING the caller wrote**, which is the only
   * property that makes it safe to ask first: the answer is byte-identical for every argument a
   * call could carry, so a refusal hoisted above the shape check cannot become an oracle about what
   * exists. ⚠️ **They do not replace the door they sit in front of** — `createAgentFor` and
   * `assertMayReach` each ask the whole question again, in their own order,
   * against the target; these only move an answer the caller was going to get anyway in front of a
   * check that could not have changed it.
   *
   * ⚑ **Opt-in, one line per verb.** *A narrowing is opt-in at the call site too*: a verb that got
   * this question by being on a list is a verb nobody decided about, so every door that asks it
   * says so in its own body.
   */
  mayCreateAgents: RuntimeHost['mayCreateAgents']
  mayReachAtAll: RuntimeHost['mayReachAtAll']
  /**
   * 🔴 **437's verb, and since `608` it does NOT hold the caller's turn open** (HO-084 §4).
   *
   * ⛔ **`raiseAQuestion` and not `askTheParent` since `611`** (HO-088 §2). ⚠️ **The old name was
   * an argument**: *"the name says which edge it travels, because the verb takes no addressee."*
   * ⚑ It takes one now — a two-member vocabulary, `the-parent` or `a-person` — so a name promising
   * one edge would be the false name `425`'s own rule is about. ⛔ It answers rather than throwing,
   * like every verb added since `395`.
   *
   * ⚠️ **It used to hold the turn open for five minutes, deliberately** — that was the mechanism
   * and `437` argued why: without it the fold said *its turn ended and it replied nothing* about a
   * worker that had asked — the words `624` replaced, see {@link UNDRIVEN_SENTENCES}.
   * ⛔ **`603` gave the fold a word for that** — `waiting-on-an-answer`, as `609` renamed it —
   * so the hold came off. ⚑ **The verb now returns as soon as the question is recorded and routed,
   * and the answer arrives later as a message.** ⚠️ A reader adding a timeout to this file would be
   * adding a wait to a verb this app spent a dispatch removing one from.
   */
  raiseAQuestion: RuntimeHost['raiseAQuestion']
  requestAnAction: RuntimeHost['requestAnAction']
  /**
   * 🔴 **611's verb — carry a child's question one hop further, in the child's own words**
   * (HO-088 §3.2).
   *
   * ⛔ **It takes no question TEXT**, and that absence is the ruling: *"a question reworded at every
   * hop arrives as something nobody asked."* ⚑ The words come out of the original asker's ledger,
   * so the only thing a caller can contribute is CONTEXT, beside them.
   *
   * ⚠️ **No timer anywhere behind it.** `HO-088` §3.1 removed the clock that decided a parent had
   * failed and put this act in its place.
   */
  passQuestionUp: RuntimeHost['passQuestionUp']
  /** ⚑ **D-009 · F012** — the asker takes back a question it asked. */
  withdrawQuestion: RuntimeHost['withdrawQuestion']
  /** ⚑ **D-012** — `read_transcript`'s one host read, reach and words together. */
  readTranscript: RuntimeHost['readTranscript']
  /**
   * Asks the person to register an MCP server. There is deliberately no way here to decide one:
   * only a person's press registers a server.
   */
  requestMcpServer: RuntimeHost['requestMcpServer']
  /**
   * 🔴 **582 · ask for rules against another identity's own instructions** (`HO-009` §2.2).
   *
   * ⛔ **It parks NOBODY**: it is answered on the IDENTITY's sheet, which a person may not have
   * open — so a bounded wait would spend the whole bound on a decision nobody was being shown.
   *
   * ⚑ **There is deliberately no `decideInstruction` here.** A tool that could approve one would be
   * a gate an agent can open, and `HO-009` §2.2 says *approval writes it*.
   */
  readAgentRules: RuntimeHost['readAgentRules']
  proposeAgentRules: RuntimeHost['proposeAgentRules']
}

/**
 * ⛔ **What a line says about a conversation this app cannot attribute** (610) — a constant,
 * because `a-safety-sentence-with-no-test-is-a-comment` and a test pins this clause by name.
 */
export const THIS_APP_CANNOT_NAME_IT = 'an agent this app cannot name'

/**
 * 🔴 **The identity half of a card's line, and it is a NAME now** (610 · HO-092 §1).
 *
 * ## ⛔ What it said, and what that cost
 *
 * A profile slug identifies storage, not necessarily an agent's human name. Show the name so a model asked to reach an agent can recognize it even when the slug is `default` or `brobot`.
 *
 * ## ⚑ The slug stays on the line, because it is the half a caller can SPEND
 *
 * ⛔ **`give_work` and `create_agent` take a slug, not a name**, so dropping it would trade one
 * unusable line for another. ⚠️ **A name that IS the slug is not printed twice** — {@link
 * profileText} one function down has the same rule and the same reason: *"a display name that is
 * the slug again is dropped rather than doubled… printing `worker · worker` spends the summary's
 * characters on nothing."*
 *
 * ## 🔴 And the other arm says what it cannot say, rather than being left out
 *
 * {@link AN_IDENTITY_THIS_APP_CANNOT_NAME} covers the person's conversations discovered in their own provider home. Calling `agentName(null, …)` would wrongly identify them as BroBot. Render the unknown identity explicitly instead of silently omitting it.
 */
const whoseText = (whose: WhoseConversation): string => {
  if (whose.is !== 'an-identity-this-app-holds') return THIS_APP_CANNOT_NAME_IT
  return whose.name === whose.profile ? whose.profile : `${whose.name} (${whose.profile})`
}

/**
 * ⚑ **D-017 · R12 — how many conversations `list_agents` names**, the most recently active first,
 * and the answer says how many more there are. Any other can still be messaged and looked at by its
 * id.
 */
export const CONVERSATIONS_LISTED = 50

/**
 * ⚑ What a conversation's turn is stopped on until a person answers it, and that nothing sent to it
 * goes in before then — so a giver tells the person rather than sending it more. ⚑ The card's line
 * and `list_tasks`' line say it in these words.
 */
function theStopOnAPerson(stopped: AgentCard['stoppedOnAPerson']): string {
  return stopped === null
    ? ''
    : ` (its turn is stopped until a person answers ${stopped.asks}, asked at ${clockTimeFrom(stopped.since, stopped.readAt)}, under Waiting on you; nothing sent to it goes in until then)`
}

/**
 * Who archived a conversation, as a listing says it. Only a person's window archives one, so it is
 * always a person.
 */
const ARCHIVED_BY = 'a person'

/** That a conversation is archived, since when, and by whom: said after its card. */
const archivedSaid = (archivedAt: number, readAt: number): string =>
  ` · archived ${clockTimeFrom(archivedAt, readAt)} by ${ARCHIVED_BY}`

const cardText = (card: AgentCard): string =>
  // 🔴 **D-016 · commit 7 · R3 — a conversation is named by the piece it owns**
  // (`the owner of W1.2 · Build the pages`), and its agent's name follows; ⚑ its id only when it
  // holds no piece — the one address it then has. The payload carries the ids.
  // ⚑ **D-017 · R11 — the state in the one derivation's words** (`agentStateWords`), the words the
  // window draws: never whether a process runs.
  `${card.named === null ? card.agent : theOwnerOf(card.named)} · ${whoseText(card.whose)} · ${agentStateWords(card.state)}` +
  theStopOnAPerson(card.stoppedOnAPerson) +
  // ⚑ **D-042 · R6 — what it runs on**, so a giver can check what its helper runs.
  runsOnText(card) +
  // ⚑ **W4.209 · who started it, by the piece it started it from** — the record's and the launch
  // line's words (`AgentCard.parentCalled`), never by the starter's work now.
  `${card.parentCalled === null ? '' : ` · started by ${card.parentCalled}`}` +
  // ⚑ **D-016 · the pieces it holds** (spec D17) — its root, then its open pieces with their states.
  (card.pieces.length === 0 ? '' : ` · holds ${card.pieces.map(pieceOnTheCardText).join(', ')}`) +
  // 🔴 **676 · F3 — said on the line, where both readers of a card read it** (`AgentCard.rowsUnread`):
  // above `0`, its last ending and its last ask to stop may be older than the truth. ⛔ Nothing on
  // a clean card, so the ordinary line is unchanged.
  (card.rowsUnread === 0
    ? ''
    : ` · ${String(card.rowsUnread)} ${card.rowsUnread === 1 ? 'row' : 'rows'} of its record could not be read`) +
  // ⚑ **D-017 · R8** — and when its whole record could not be read, its two past fields say nothing.
  (card.ledgersSkipped === 0 ? '' : ' · its record could not be read')

/**
 * 🔴 **D-042 · R6 — what a conversation runs on, on its card's line**: ` · on “opus” at max effort`,
 * marked *(requested)* where its provider has reported no effort (Claude, until a turn ends), and —
 * when its provider last reported something else (an alias's target, a reroute) — what it
 * reported. `''` for a conversation nothing has named a pair for yet.
 */
const runsOnText = (card: AgentCard): string => {
  const { selected, reported } = card.runsOn
  if (selected === null) return ''
  const requested = reported === null || reported.effort === null ? ' (requested)' : ''
  const effort = selected.effort === null ? '' : ` at ${selected.effort} effort${requested}`
  const differs =
    reported !== null &&
    (!sameModel(reported.model, selected.model) ||
      (reported.effort !== null && reported.effort !== selected.effort))
  const by = card.provider === null ? 'its provider' : PROVIDER_NAME[card.provider]
  const lastSaid =
    reported === null || !differs
      ? ''
      : `, which ${by} last reported as “${reported.model}”${reported.effort === null ? '' : ` at ${reported.effort}`}`
  return ` · on “${selected.model}”${effort}${lastSaid}`
}

/**
 * ⚑ **When a conversation's last turn ran, whether anything has started since, and what opened it**
 * — the start of its words a paragraph of their own, as a notice previews them. `[]` when no turn
 * has ended.
 */
const theLastTurnSaid = (
  turn: AgentCard['lastEndedTurn'],
  { took, readAt }: ReturnType<AgentToolHost['whatOpenedItsLastTurn']>,
  named: (who: AConversation) => string,
  /** Who asked a stop, as the `, by …` clause; `''` when no row says. */
  askedBy: (by: WhoStoppedIt | null, asker: string | null) => string,
  /** The last time anybody asked this conversation to stop, or `null`. */
  lastAsk: AgentCard['lastAskToStop'],
): readonly string[] => {
  // The last ask to stop, always with its time and who asked. Its relation to the last turn is said
  // only when it landed on another turn than the one described below.
  const asked =
    lastAsk === null
      ? []
      : [
          lastAskedToStop(
            `${clockTimeFrom(lastAsk.at, readAt)}${askedBy(lastAsk.by, lastAsk.asker)}`,
            lastAsk.turn === 'the-turn-that-ended-last'
              ? undefined
              : WHEN_THE_ASK_LANDED[lastAsk.turn],
          ),
        ]
  if (turn === null) return asked
  // Who asked the turn to stop, unless the sentence above already names that same ask. Only a turn
  // that was stopped is said to be stopped by them; one that finished or failed anyway had only
  // been asked.
  const itsAsk =
    turn.who === null || lastAsk?.turn === 'the-turn-that-ended-last'
      ? ''
      : turn.how === 'it-was-stopped'
        ? askedBy(turn.who, turn.asker)
        : `; it had been ${ASKED_TO_STOP}${askedBy(turn.who, turn.asker)}`
  // ⚑ **F080 — a turn its provider began by itself is said so**: no message opened it.
  const ran = `Its last turn${turn.startedByItsProvider === true ? ', which its provider started by itself,' : ''} ran from ${clockTimeFrom(turn.startedAt, readAt)} to ${clockTimeFrom(turn.endedAt, readAt)}; ${HOW_THE_LAST_TURN_ENDED[turn.how]}${itsAsk}; ${
    turn.since === 'nothing-has-started-since'
      ? 'nothing has started since'
      : 'a turn is running now'
  }.`
  if (took === null) return [ran, ...asked]
  const together = took.cameWith?.length ?? 0
  const opened =
    together === 0
      ? `It took a message from ${fromClause(took.from, named)}`
      : `It took ${String(together + 1)} messages delivered together; the last was from ${fromClause(took.from, named)}`
  const words = previewOf(took.words)
  return words === null
    ? [`${ran} ${opened}, whose words this app's record could not read.`, ...asked]
    : [`${ran} ${opened}, which starts:`, words, ...asked]
}

/** ⚑ **D-016** — `W1 · Plan the trip`, or `W1.2 · Draft the plan (working)` for an open piece. */
const pieceOnTheCardText = (one: PieceOnTheCard): string =>
  `${pieceLine(one.label, one.title)}${one.state === null ? '' : ` (${one.state})`}`

/**
 * ⚑ **D-017 · R11 — one card as a tool's payload carries it**: every field the card holds, with its
 * state in the one derivation's words ({@link agentStateWords}) — the words its line says and the
 * window draws, and a wake-up's time in this app's local clock rather than an instant a model would
 * have to place in a zone it cannot see.
 */
const cardPayload = (card: AgentCard) => ({ ...card, state: agentStateWords(card.state) })

/**
 * ⚑ **F096 — a window in a person's words, with the bucket it is of** — *weekly*, *weekly
 * (GPT-5.3-Codex-Spark)* — or `null` where this app has no word for it ({@link usageWindowWord}).
 */
const usageLimitWords = (window: string): string | null => {
  const word = usageWindowWord(window)
  if (word === null) return null
  const bucket = /\(([^)]+)\)\s*$/.exec(window)?.[1]
  return bucket === undefined || word.endsWith(`(${bucket})`) ? word : `${word} (${bucket})`
}

/**
 * 🔴 **F096 — one provider's usage, by its newest readings, as a model reads it** — *"Claude's
 * usage, by its latest readings: weekly 34% used, resets at 03:00 on 9 October (read at 02:11)"*.
 * ⚑ Each window in a person's words where this app has one ({@link usageLimitWords}), else the
 * provider's own; ⛔ a reading whose reset has passed is said in the past, since it was taken before
 * that reset and is no measure of the window now.
 */
const providerUsageText = (
  provider: Provider,
  readings: readonly ProviderUsageReading[],
  readAt: number,
): string => {
  if (readings.length === 0) {
    return `${PROVIDER_NAME[provider]}'s usage: no reading yet — it arrives with its next turn.`
  }
  const windows = readings.map((reading) => {
    const word = usageLimitWords(reading.window) ?? reading.window
    const passed = reading.resetsAt !== null && reading.resetsAt <= readAt
    const percent =
      reading.usedPercent === null ? null : `${String(Math.round(reading.usedPercent))}%`
    const said = passed
      ? percent === null
        ? `${word}: how much was used was not said, and its window has reset since`
        : `${word} was ${percent} used before its window reset`
      : `${word} ${percent === null ? 'how much is used not said' : `${percent} used`}${
          reading.resetsAt === null ? '' : `, resets at ${clockTimeFrom(reading.resetsAt, readAt)}`
        }`
    const whose =
      reading.unconfirmed === true
        ? ", before this app last started, so it may be another sign-in's"
        : ''
    return `${said} (read at ${clockTimeFrom(reading.at, readAt)}${whose})`
  })
  return `${PROVIDER_NAME[provider]}'s usage, by its latest readings: ${windows.join('; ')}.`
}

/** ⚑ **F096 — the same readings as a payload carries them**: numbers, and times as said above. */
const providerUsagePayload = (
  usage: Readonly<Record<Provider, readonly ProviderUsageReading[]>>,
  readAt: number,
) =>
  Object.fromEntries(
    (Object.keys(usage) as Provider[]).map((provider) => [
      provider,
      usage[provider].map((reading) => {
        const limit = usageLimitWords(reading.window)
        return {
          window: reading.window,
          ...(limit === null ? {} : { limit }),
          used_percent: reading.usedPercent,
          resets_at: reading.resetsAt === null ? null : clockTimeFrom(reading.resetsAt, readAt),
          reset_since: reading.resetsAt !== null && reading.resetsAt <= readAt,
          read_at: clockTimeFrom(reading.at, readAt),
          ...(reading.unconfirmed === true ? { unconfirmed_for_this_sign_in: true } : {}),
        }
      }),
    ]),
  )

/**
 * 🔴 **One identity, as the line a person sees** (488).
 *
 * ⛔ **The slug FIRST and alone when nothing else is known**, because it is the value `give_work`
 * takes and the only part of this line a caller can spend. ⚠️ A display name that is the slug again
 * is dropped rather than doubled — it is what a person typed when they had nothing better, and
 * printing `worker · worker` spends the summary's characters on nothing.
 */
const profileText = (report: ProfileReport): string =>
  [
    report.profile,
    ...(report.displayName === null || report.displayName === report.profile
      ? []
      : [report.displayName]),
    ...(report.provider === null ? [] : [report.provider]),
    // ⚑ **D-042 · R6 — its default**, what its new conversations start on.
    ...(report.defaultModel === null ? [] : [`default ${aPairInWords(report.defaultModel)}`]),
    ...(report.isAService === true ? ['a service'] : []),
  ].join(' · ')

/**
 * 🔴 **F009 · an agent's record, as a model reads it** — who it is (the roster's line), how its
 * standing rules begin, its conversations within reach, its newest pieces and the files it made,
 * each list newest first and the rest counted. ⚑ Each time is placed on a day by `readAt`.
 *
 * ⚑ **Each conversation by the work that names it** — the address `get_agent_status` and
 * `message_agent` take — or by its id when it holds none; ⚑ **the caller's own as `you`** (729 ·
 * R90). ⛔ **Never whether a conversation runs** (`05` rule 5) — `get_agent_status` says what one is
 * doing — ⚑ but whether it ENDED: could never be reopened, and which took its place. ⛔ **An open
 * piece is *still open*, never a state word**: the record reads a piece's ending, and the word for an
 * open one is `list_tasks`' and `get_agent_status`', composed with what its holder waits on.
 */
function agentRecordText(record: AgentRecord, me: string | null): string {
  const at = (when: number): string => clockTimeFrom(when, record.readAt)
  /** ⚑ One of its conversations, by the work that names it, or by its id when it holds none. */
  const theConversation = (conversation: string, named: WorkThatNamesIt | null): string =>
    conversation === me
      ? 'you'
      : named === null
        ? `conversation ${conversation} (it holds no work)`
        : theOwnerOf(named)
  /** ⚑ How many, and of what: `1 older one`, `3 older ones`. */
  const some = (count: number, what: string): string =>
    `${String(count)} ${what} ${count === 1 ? 'one' : 'ones'}`
  const rules =
    record.rules.is === 'they-begin'
      ? `Its standing rules begin: “${record.rules.line}”`
      : record.rules.is === 'none'
        ? 'It has no standing rules.'
        : 'How its standing rules begin is told only to a caller that can reach its conversations.'
  const blocks: string[] = [[profileText(record.agent), rules].join('\n')]
  if (record.conversations.length === 0) {
    blocks.push('It has no conversation within your reach.')
  } else {
    blocks.push(
      [
        'Its conversations you can reach, the most recently active first:',
        ...record.conversations.map((one) => {
          const called =
            one.conversation === me
              ? `you, ${one.named === null ? 'holding no work' : theOwnerOf(one.named)}`
              : theConversation(one.conversation, one.named)
          const starter =
            one.startedBy.is === 'a-person'
              ? 'a person started it'
              : one.startedBy.is === 'you'
                ? 'you started it'
                : `started by ${one.startedBy.called}`
          const replaced =
            one.inItsPlace === null
              ? ''
              : ` · it could not be reopened, so ${theConversation(one.inItsPlace.conversation, one.inItsPlace.named)} took its place`
          // What became of it: another took its place, or a person archived it.
          const ended =
            replaced +
            (one.archivedAt === undefined ? '' : archivedSaid(one.archivedAt, record.readAt))
          return `  - ${called} · ${starter} at ${at(one.startedAt)} · last changed at ${at(one.lastChangedAt)}${ended}`
        }),
        ...(record.conversationsNotListed === 0
          ? []
          : [
              `  …and ${String(record.conversationsNotListed)} more you can reach, not listed here.`,
            ]),
        'get_agent_status says what any of them is doing now.',
      ].join('\n'),
    )
    blocks.push(
      record.pieces.length === 0 && record.piecesUnread === 0 && record.piecesNotListed === 0
        ? 'Its conversations you can reach hold no pieces of work.'
        : [
            'Its newest pieces of work there, the newest given first:',
            ...record.pieces.map(({ held, givenBy }) => {
              const giver =
                givenBy.is === 'a-person'
                  ? 'a person'
                  : givenBy.is === 'you'
                    ? 'you'
                    : givenBy.called
              const ended = held.endedAt === null ? '' : ` at ${at(held.endedAt)}`
              const stands =
                held.state === 'answered'
                  ? `answered${held.outcome === null ? '' : ` (${held.outcome})`}${ended}`
                  : held.state === 'withdrawn' || held.state === 'closed'
                    ? `${HOW_A_PIECE_ENDED_SAID[held.state]}${ended}`
                    : 'still open'
              return `  - ${pieceLine(held.label, held.title)} · given by ${giver} at ${at(held.givenAt)} · ${stands}`
            }),
            ...(record.piecesUnread === 0
              ? []
              : [
                  `  …and ${String(record.piecesUnread)} more of the newest, which this app could not read.`,
                ]),
            ...(record.piecesNotListed === 0
              ? []
              : [`  …and ${some(record.piecesNotListed, 'older')}, not listed here.`]),
          ].join('\n'),
    )
  }
  blocks.push(
    record.files.length === 0
      ? 'It has made no files.'
      : [
          'Files it made, newest first:',
          ...record.files.map(
            (one) =>
              `  ${resourcesNamed([one.resource])}${
                one.resource.title === null || one.resource.title === one.resource.name
                  ? ''
                  : ` · ${one.resource.title}`
              } — on ${pieceLine(one.label, one.title)}, ${at(one.resource.createdAt)}`,
          ),
          ...(record.filesNotListed === 0
            ? []
            : [
                `  …and ${some(record.filesNotListed, 'older')}: find_files with where: everywhere finds ${record.filesNotListed === 1 ? 'it' : 'them'} by its profile.`,
              ]),
          READ_ONE_WITH_READ_DOCUMENT,
        ].join('\n'),
  )
  return blocks.join('\n\n')
}

/** ⚑ **F009 · an agent's record, as its payload carries it** — ids where the text has names. */
function agentRecordPayload(record: AgentRecord): Readonly<Record<string, unknown>> {
  const who = (
    said:
      AgentRecord['pieces'][number]['givenBy'] | AgentRecord['conversations'][number]['startedBy'],
  ): Record<string, unknown> =>
    said.is === 'an-agent' ? { kind: 'an-agent', agent: said.conversation } : { kind: said.is }
  return {
    profile: record.agent.profile,
    ...(record.agent.displayName === null ? {} : { display_name: record.agent.displayName }),
    ...(record.agent.provider === null ? {} : { provider: record.agent.provider }),
    ...(record.agent.defaultModel === null ? {} : { default_model: record.agent.defaultModel }),
    rules_told: record.rules.is !== 'not-told',
    rules_begin: record.rules.is === 'they-begin' ? record.rules.line : null,
    conversations: record.conversations.map((one) => ({
      agent: one.conversation,
      label: one.named?.label ?? null,
      started_by: who(one.startedBy),
      started_at: one.startedAt,
      last_changed_at: one.lastChangedAt,
      ...(one.inItsPlace === null ? {} : { replaced_by: one.inItsPlace.conversation }),
      ...(one.archivedAt === undefined
        ? {}
        : {
            archived_at: clockTimeFrom(one.archivedAt, record.readAt),
            archived_by: ARCHIVED_BY,
          }),
    })),
    conversations_not_listed: record.conversationsNotListed,
    pieces: record.pieces.map(({ held, givenBy }) => ({
      piece: held.piece,
      label: held.label,
      title: held.title,
      agent: held.owner,
      given_by: who(givenBy),
      given_at: held.givenAt,
      stands:
        held.state === 'answered' || held.state === 'withdrawn' || held.state === 'closed'
          ? held.state
          : 'open',
      ...(held.outcome === null ? {} : { outcome: held.outcome }),
      ...(held.endedAt === null ? {} : { ended_at: held.endedAt }),
    })),
    ...(record.piecesUnread === 0 ? {} : { pieces_unread: record.piecesUnread }),
    pieces_not_listed: record.piecesNotListed,
    files: record.files.map((one) => ({
      resource: one.resource.resource,
      name: one.resource.name,
      title: one.resource.title,
      piece: one.resource.piece,
      label: one.label,
      piece_title: one.title,
      kept_at: one.resource.createdAt,
    })),
    files_not_listed: record.filesNotListed,
    rows_unread: record.rowsUnread,
  }
}

/** ⚑ **D-037 · the most words one `find_files` search holds a file to.** */
const MOST_WORDS_FOUND = 20

/**
 * ⚑ **D-037 · one file `find_files` names** — `list_tasks {made}`'s line: its id and name, its title
 * where the name does not already say it, its piece, who added it and when — and, for a find in its
 * text, the words around it on a line of its own.
 */
function foundFileLine(found: FoundFile, readAt: number): string {
  const { file } = found
  // ⚑ An agent by its name and the profile a give names it by, as a sender is named.
  const by =
    file.addedBy === null
      ? 'a person'
      : file.addedBy.identity === null || file.addedBy.identity === file.addedBy.name
        ? file.addedBy.name
        : `${file.addedBy.name} (${file.addedBy.identity})`
  const line = `  ${resourcesNamed([{ resource: file.resourceId, name: file.name }])}${
    file.title === file.name ? '' : ` · ${file.title}`
  } — ${file.role === 'input' ? 'an input' : 'kept'} on ${pieceLine(file.label, file.pieceTitle)}, by ${by}, ${clockTimeFrom(file.keptAt, readAt)}`
  return found.excerpt === null ? line : `${line}\n      “${found.excerpt}”`
}

/**
 * 🔴 **Build the toolset one session is offered.**
 *
 * ⚠️ **Per session, and holding that session's id**, because every tool call is made under
 * {@link agentCallerId} for the conversation the tools were built for. ⛔ **A caller cannot supply
 * its own identity** — there is no argument for it, on any of the five — which is what makes
 * `commandedBy` mean something after the call.
 */
export function agentToolsFor(
  host: AgentToolHost,
  sessionId: string,
  /** Each provider's list as the app last read it, named in give_work's and create_agent's fields. */
  lists: ListsAsLastRead = {},
): AgentToolset {
  const by: Caller = { ownerId: agentCallerId(sessionId) }
  const me = sessionId
  const theModels = theModelsSaid(lists)
  const theEfforts = theEffortsSaid(lists)

  const ownPieceHelpers = (spelled: string) => {
    if (pieceNumbersOf(spelled) === null) return null
    const record = host.pieceRecord(me, spelled)
    if (record.is === 'no-piece-by-that-name') return null
    const piece = record.is === 'a-root' ? record.root : record.piece
    if (piece.owner !== me && host.tookItsPlace(piece.owner) !== me) return null
    const children = record.children.filter(
      (child) => child.owner !== me && host.tookItsPlace(child.owner) !== me,
    )
    const helpers = children.flatMap((child) => {
      const card = host.agentCard(child.owner, by, me)
      if (card === null || card.agent === me) return []
      const known = card.whose.is === 'an-identity-this-app-holds' ? card.whose : null
      return [
        {
          label: child.label,
          state: child.state,
          outcome: child.outcome,
          owner: card.agent,
          profile: known?.profile ?? null,
          name: known?.name ?? null,
        },
      ]
    })
    return {
      label: piece.label,
      helpers,
      children: children.length,
      rowsUnread: record.rowsUnread,
      ledgersSkipped: record.ledgersSkipped,
    }
  }

  const selfRefusal = (
    spelled: string,
    agent: string,
    payload: ReturnType<typeof refuseTool> = refuseTool('that-agent-is-you', { agent }),
  ): AgentToolAnswer => {
    const facts = spelled === agent ? null : ownPieceHelpers(spelled)
    const lines = [payload.reason]
    if (facts !== null) {
      if (facts.helpers.length > 0) {
        lines.push(`${facts.label} is your own piece.`)
        lines.push(
          `Its helpers: ${facts.helpers
            .map((helper) => {
              const who =
                helper.name === null
                  ? ''
                  : helper.name === helper.profile
                    ? `${helper.name} on `
                    : `${helper.name} (${helper.profile}) on `
              return `${who}${helper.label} (${TASK_IS_OPEN[helper.state] ? helper.state : `ended: ${helper.outcome ?? helper.state}`})`
            })
            .join('; ')}.`,
        )
        lines.push(
          "Reach a helper by its piece's label, even after it ended: message_agent with kind: note, or ask_question.",
        )
        if (facts.helpers.some((helper) => helper.profile !== null))
          lines.push('For new work, give_work with its profile.')
        lines.push('To stop a helper below you, interrupt_agent with its label.')
      } else if (facts.rowsUnread > 0 || (facts.ledgersSkipped ?? 0) > 0) {
        lines.push(`${facts.label} is your own piece. list_agents names who you can reach.`)
      } else {
        lines.push(
          facts.children === 0
            ? `${facts.label} is your own piece, with no helpers recorded under it. list_agents names who you can reach.`
            : `${facts.label} is your own piece. None of its helpers is in your reach. list_agents names who you can reach.`,
        )
      }
      if (facts.rowsUnread > 0) lines.push(unreadRowsSentence(facts.rowsUnread))
      if ((facts.ledgersSkipped ?? 0) > 0) lines.push(skippedRecordsSentence(facts.ledgersSkipped!))
    }
    const aSelfAddressSaid = lines.join(' ')
    return refusalAnswer({ ...payload, reason: aSelfAddressSaid })
  }

  /**
   * ⛔ **A SEAM, not a catch — and this line claimed the opposite from `347` until `657`.** It
   * said *"Everything below answers rather than throws"* over a body that is `run()`, and it has
   * never held a catch (`git log -G` finds the one commit that made it). ⚑ **The design is per-tool
   * classification**: each tool catches the host's typed refusals it knows and says them in its own
   * words — `message_agent` for `queueMessage`, `give_work` through {@link launchedOrSaid} — and
   * `375`'s rule lets everything else propagate. ⚠️ **What propagates is not lost**: both adapters
   * turn a thrown handler into `isError` with *"<tool> failed: …"*, which is a BROKEN tool and
   * deliberately not a refusal (`307`). ⛔ A blanket catch here would fold every failure of every
   * tool into one word — the defect `650` undid for one tool. The name stays because nineteen call
   * sites and `488`'s mutation rows carry it; this note is the correction.
   */
  const guarded = async (run: () => Promise<AgentToolAnswer>): Promise<AgentToolAnswer> => run()
  /**
   * 🔴 **657 · `give_work`'s own classification of a launch that did not complete** — see
   * {@link aLaunchThatDidNotStart}. ⛔ Per tool and by type: what it does not recognise it rethrows.
   */
  const launchedOrSaid = async (
    args: Record<string, unknown>,
    run: () => Promise<AgentToolAnswer>,
  ): Promise<AgentToolAnswer> => {
    try {
      return await run()
    } catch (error) {
      const failed = aLaunchThatDidNotStart(error)
      if (failed === null) throw error
      // ⚑ **The host's own text goes to the log and nowhere else.** The model gets the closed reason;
      // the precise diagnostic — which can name a path — used to reach the transcript as *"<tool>
      // failed: …"*, and without this line it would now be recorded nowhere (review of `657`).
      console.warn(
        `give_work: the launch did not start (${failed.because}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      // 🔴 **D-039 · and whether the give made a new agent before its launch failed** — a give
      // with `new: true` did ({@link THE_NEW_AGENT_WAS_MADE}).
      return refusalAnswer(
        aLaunchRefused(failed, args['new'] === true, {
          ...(typeof args['profile'] === 'string' ? { profile: args['profile'] } : {}),
          because: failed.because,
        }),
      )
    }
  }

  /** The advertised reply fields also supply the vocabulary of its diagnostics. */
  const replyInput = {
    piece: z
      .string()
      // ⛔ **A description that tells a model where a value comes from has to be re-read every
      // time a new place supplies it** — `a description hardens into a ruling in the docblock it
      // leaves`. ⚑ D-016 · the brief names the label ({@link messageNamingThePiece}), and so do
      // `list_tasks` and the sender line.
      .describe(
        'The piece you are finishing — its label (W1.2) or its id. The brief that gave it to you names it — or take_on_work’s answer, for work you took on — and list_tasks lists it.',
      ),
    outcome: documentedToolEnum(
      TOOL_INPUT_ENUMS['reply_to_parent:outcome'],
      'How the work ended.',
      'Anything else is refused and no reply is recorded.',
    ),
    summary: z
      .string()
      .describe(
        `What the conversation that gave you this needs to read — for work you took on for a person, what its record keeps as its last status line. At most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters (UTF-16 code units). Put longer detail in a file listed in resource_paths. Nothing is shortened for you.`,
      ),
    saved_method: z
      .string()
      .max(SAVED_METHOD_CHARS)
      .optional()
      .describe(
        'What you saved to your Saved methods from this work: its file name, or none and why, in a few words. Save before you hand back.',
      ),
    resource_paths: z
      .array(z.string())
      .optional()
      .describe(
        // ⚑ 736 · `733` F-4 — the kinds rendered from the store's own list, not asserted.
        `Files to hand back with the reply, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is copied and hashed and kept as a resource, and the reply carries its id instead of its contents.`,
      ),
    result_document: z
      .string()
      .optional()
      .describe(
        "The main result document's path, also listed in resource_paths. Leave it out to hand back files without naming a main document.",
      ),
    needs_user_action: z
      .boolean()
      .optional()
      .describe('Set this when a person has to do something before anything else can happen.'),
  }

  /** The advertised reader fields also supply their handler-side type checks. */
  const readerInputs = {
    list_agents: {
      archived: z
        .boolean()
        .optional()
        .describe(
          'true lists the archived conversations you can reach instead, the most recently archived first, each with when it was archived and by whom. Leave it out for the conversations that are not archived.',
        ),
    },
    get_agent_status: {
      agent: z
        .string()
        .describe('The agent, by the piece it owns (W1.2) or by its id from list_agents.'),
    },
    read_document: {
      resource: z
        .string()
        .describe(
          'The resource id — res_… — as a reply names it, list_tasks naming its piece, list_tasks with made, or find_files.',
        ),
    },
    list_tasks: {
      piece: z
        .string()
        .optional()
        .describe(
          'A piece you, or another conversation of your profile, hold or gave — its label (W1.2) or its id — to read its record. Leave it out for your board.',
        ),
      made: z
        .boolean()
        .optional()
        .describe(
          `true lists the files your profile’s conversations made, newest first — at most ${String(MADE_FILES_LISTED)} — each with the piece it was kept on and when. Refused with piece.`,
        ),
      state: documentedToolEnum(
        TOOL_INPUT_ENUMS['list_tasks:state'],
        'Which pieces of your board to list.',
        'Refused with piece or made.',
      ).optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(ENDED_LISTED_AT_MOST)
        .optional()
        .describe(`${LIMIT_DESCRIBED('pieces')} Refused with piece or made.`),
    },
    list_questions: {
      state: documentedToolEnum(
        TOOL_INPUT_ENUMS['list_questions:state'],
        'Which questions to list.',
      ).optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(ENDED_LISTED_AT_MOST)
        .optional()
        .describe(LIMIT_DESCRIBED('questions')),
    },
    read_transcript: {
      agent: z
        .string()
        .describe('The agent, by the piece it owns (W1.2) or by its id from list_agents.'),
      turns_back: z
        .number()
        .optional()
        .describe(
          `How many of its turns to read, newest last: 1 to ${String(TURNS_BACK_MAX)}; ${String(TURNS_BACK_DEFAULT)} when left out.`,
        ),
      search: z
        .string()
        .optional()
        .describe(
          'Read instead the turns whose messages or answers contain these words (letters matched regardless of case).',
        ),
    },
    find_files: {
      where: documentedToolEnum(TOOL_INPUT_ENUMS['find_files:where'], 'Where to look.').optional(),
      words: z
        .string()
        .optional()
        .describe(
          `Words a file must hold, separated by spaces, at most ${String(MOST_WORDS_FOUND)}; case does not matter. Leave it out to list the files.`,
        ),
      older_than: z
        .string()
        .optional()
        .describe(
          'The id (res_…) an earlier answer gave to go on from: only files kept before it.',
        ),
    },
  } satisfies Record<string, z.ZodRawShape>

  /** Read field types here and combine them with each reader's existing value rules. */
  const readerFieldRefusal = (
    name: keyof typeof readerInputs,
    args: Readonly<Record<string, unknown>>,
    valueProblems: readonly string[] = [],
  ): AgentToolAnswer | null => {
    const parsed = z.object(readerInputs[name]).strict().safeParse(args)
    const issues: z.core.$ZodIssue[] = (parsed.success ? [] : parsed.error.issues)
      .filter(
        (issue) =>
          issue.code === 'unrecognized_keys' ||
          (issue.code === 'invalid_type' &&
            ['string', 'boolean', 'number'].includes(issue.expected)),
      )
      .map((issue) => {
        if (issue.code !== 'invalid_type' || args[String(issue.path[0])] !== undefined) return issue
        const field = String(issue.path[0])
        const message =
          field === 'agent'
            ? 'required; name the agent by the piece it owns (W1.2) or its id'
            : field === 'resource'
              ? 'required; send the resource id (res_…)'
              : 'required; send text'
        return { code: 'custom', path: issue.path, message }
      })
    const remaining = valueProblems.filter(
      (problem) =>
        !issues.some((issue) => issue.path.length > 0 && problem.startsWith(String(issue.path[0]))),
    )
    if (issues.length === 0 && remaining.length === 0) return null
    const detail = workRequestRefused(issues, args, Object.keys(readerInputs[name]))
    return refusalAnswer(
      refuseTool(
        'malformed-request',
        remaining.length === 0 ? detail : { problems: [...detail.problems, ...remaining] },
      ),
    )
  }

  /**
   * ⚠️ **`ToolName`, not `string`** (405). Every definition below is now the thing
   * {@link RuntimeHost.noteRefusal} is handed the name of, and typing the array is what makes that
   * a compile check rather than a cast: a tool whose `name` is not in {@link TOOL_NAMES} — the list
   * `347`'s *"a negative needs a search shape"* census is measured against — no longer builds.
   */
  const tools: (AgentToolDefinition & { readonly name: ToolName })[] = [
    {
      name: 'list_agents',
      handlerOwnsMissingInput: true,
      /**
       * 🔴 **The sentence states the INVARIANT, not one caller's answer** (433, standing rule 8).
       *
       * ⛔ **It said *"the ones you spawned, and yourself"* until 433, and `431` made that false**
       * without touching this line: an identity a person grants a global reach may write to
       * conversations it never spawned. ⚠️ A description that enumerates what a capability admits
       * *"drifts every time the capability changes"*; one that names the RULE two doors share
       * cannot.
       *
       * ## ⛔ And the rule is about NAMING, not about writing — the first draft of this got it wrong
       *
       * ⚠️ **A draft of this line read *"exactly the set message_agent will let you write to"*, and
       * that is FALSE for every caller on every call** (found in this dispatch's own review). The
       * listing includes the caller's own row, and `message_agent` refuses that row permanently with
       * `that-agent-is-you` — which is `424`'s trap, put back in prose by a sentence meant to close
       * a different one. ⛔ **A counterexample that does not involve `me`**: an identity holding
       * `can_message: 'none'` lists its own children and may write to none of them
       * (`may-not-message`).
       *
       * ⚑ **What IS true of both doors is the entitlement**: an id this names is an id no door will
       * answer `no-such-agent` about, and an id it omits is one every door will. `a-reach-you-can-see.test.ts`
       * §1 measures exactly that biconditional — and says out loud that a refusal about the ACT is
       * not what it is about.
       *
       * ## 🔴 610 · the last clause named four fields and the row was unusable (HO-092 §2)
       *
       * ⛔ **It said *"Reports **id**, project, profile, state and where each came from"* — and it
       * was TRUE then.** ⚑ **No name, so every assertion in this tree passed**: nothing ever claimed a
       * name was there. ⚠️ **That is `530`'s clipped grant line again** — a surface answering
       * correctly and saying nothing anybody can use — and nobody caught it because it answers
       * AGENTS rather than people.
       *
       * A model needs the agent's display name to relay a message reliably. The app already knows that identity from the conversation and its work; expose it instead of leaving the model to interpret an id substring.
       *
       * ⚑ **So the clause names WHO before it names WHAT**, and it names the other arm rather than
       * leaving it out — see {@link whoseText}, where that choice is argued.
       *
       * ## ⚑ D-017 · R12 — ONE list (`05` rule 6)
       *
       * ⛔ **It listed what this app was RUNNING, then (D-007) apart from them the caller's children
       * *"none can be reached"*** — and a conversation a quit left open was `no-such-agent` to every
       * agent but its starter (Ayo's work to Ana, measured live). ⚑ **Every conversation within the
       * caller's reach is listed now, running or not, newest activity first** — a message starts
       * any of them, so whether one runs is not a line this list draws (rule 5). ⚠️ **Cut at
       * {@link CONVERSATIONS_LISTED}**, and the answer says how many more: an id it omits is still
       * one `get_agent_status` and `message_agent` take. ⚑ `a-reach-you-can-see.test.ts` §1's
       * biconditional reads *listed ⇔ reachable* now, and `no-such-agent` is said only about an id no
       * conversation has.
       *
       * ## 🔴 643 · a FOURTH family of *seeing is not sending*, and it is not an entitlement rail
       *
       * Being listed does not guarantee that the provider will admit a message. {@link RuntimeHost.assertSignInCurrent} can reject a stale machine credential. Hold an agent's words and reopen on the current sign-in; a person's own turn is still refused there.
       *
       * 🔴 **It is not the only condition that refuses a LISTED agent and that no field of
       * {@link AgentCard} predicts — `650` measured a second.** ⛔ This said *"the ONLY"* and that
       * *every other arm of that catch-all is already carried by {@link AgentCard.state}*. A card
       * that reads `idle` also gets refused when another sender's turn opens between the idle read
       * and the handover, and no card field can carry a race. ⚑ `650` gave that arm its own word
       * and `657` retired it: the lost race is HELD now, so it is not a refusal at all. `starting`
       * has its own word too, `that-conversation-has-not-started`. ⚠️ **What the catch-all still folds that no card field
       * predicts is the provider-handover failures** its permanence note names
       * — and a reservation a person Closed before its provider arrived, which the card still reads
       * as `starting` (it asks for a session before it asks for the phase) while `message_agent`
       * folds it here. ⛔ `AgentCard` was not `650`'s to change. ⚑ **D-017 · R11** — the card's
       * state is the one derivation's now, and no process fact is on it.
       *
       * ⚠️ **And a card field would not have closed it, which is why 643 changed no payload.**
       * `ClaudeSessionHandle.checkSignIn` runs at the TURN BOUNDARY — and, since `690`, at a wake
       * of a running conversation — never for a listing, because it costs a `security` subprocess;
       * so the latch is `false` on every conversation nobody has tried to send to or wake yet. ⚑ `send-refusals.ts` already has the word for that and `219` already ruled it
       * for the person's window: `first-press`. ⛔ **A listing cannot carry a fact that does not
       * exist until somebody has been refused.** The surface that can is the REFUSAL.
       *
       * ## 🔴 644 · the empty answer names a door
       *
       * ⛔ **Everything above is the DESCRIPTION, which a caller reads once at launch.** ⚠️ The
       * answer text is what it reads when the listing comes back empty, and until `644` that was
       * four words that named nothing — `642` F2, backlog `D29`, and the branch
       * `factory-text.ts`'s degradation table already credits as the quiet one.
       *
       * 🔴 {@link RuntimeHost.withinMessagingReach} answers `true` for `slot.id === me` before it
       * asks any grant, so the listing always names at least the caller — ⛔ **it is empty only
       * once the caller's own slot has left the map**, which is the window after its own
       * conversation ended while it still holds this toolset. ⚑ So the empty answer names
       * `list_profiles`, for *who could I give work to* — and it is no promise: `list_profiles`
       * takes no grant and always answers.
       */
      // ⚑ **D-016 · *"starting one opens a new conversation"* came out**: a give reaches the one
      // conversation a giver has with an agent, and starts one only the first time. ⚑ And each card
      // names the work it holds — its root and its open pieces, by label (spec D17).
      // 🔴 **D-016 · commit 7 · R1 · R3 — each is NAMED by the piece it owns**, and that label is
      // what every door that takes an agent takes; the id stays in the payload.
      description: `List the agents you can reach: every conversation this app will let you message, including your own, whatever it is doing. Up to ${String(CONVERSATIONS_LISTED)}, the most recently active first; the answer says how many more there are, and message_agent and get_agent_status take any of them by the label of a piece it owns (W1.2) or by its id. Each one's state says what it is doing: active, needs you (a person's answer or approval is waiting in it, or it answered a person who wrote to it and waits for their next words), waiting on another conversation's answer, owes another conversation an answer (and whom), running in the background (and what), scheduled (and when it next wakes), waiting on the agents holding work it gave out (and who), or idle. The agents themselves outlive their conversations — list_profiles names every agent this app holds. Being listed is not a promise that every message to it is admitted — message_agent answers that separately. Each says the model and effort its conversation runs on, and what its provider last reported when that differs. An archived conversation is put away and left out: archived: true lists those instead, each with when it was archived and by whom. Its label still reaches it; restore_agent brings it back without sending it anything, and whatever is sent to it brings it and the helpers archived with it back too. Each is named by the piece of work it owns (the owner of W1.2 · its title), or by its id when it holds none, then who it is — the name a person gave that agent, and the profile slug give_work takes — its state, the conversation that started it, named the same way, and the work it holds: its own root, when a person gave it one, and its open pieces, by label. A conversation this app cannot attribute is still listed, and says so rather than being given a name.`,
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **A reader of the conversations the caller may reach.** `agentsVisibleTo` filters by the caller's own reach and an empty answer is a sentence (`644`); there is nothing here to ask a person about.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries(readerInputs.list_agents).map(([field, schema]) => [
          field,
          agentToolHandlerInput(schema),
        ]),
      ),
      call: (args) =>
        guarded(async () => {
          args = toolArgumentsAtHandler(args)
          if (args.archived !== undefined && typeof args.archived !== 'boolean') {
            return readerFieldRefusal('list_agents', args, [
              'archived, when given, must be true or false',
            ])!
          }
          const fieldRefusal = readerFieldRefusal('list_agents', args)
          if (fieldRefusal !== null) return fieldRefusal
          if (args.archived === true) {
            const { archived, notListed, readAt } = host.archivedVisibleTo(by, me)
            const more =
              notListed === 0
                ? ''
                : `\n…and ${String(notListed)} more archived conversations you can reach, not listed here.`
            return answer(
              {
                outcome: 'ok',
                archived: archived.map(({ card, archivedAt }) => ({
                  ...cardPayload(card),
                  archived_at: clockTimeFrom(archivedAt, readAt),
                  archived_by: ARCHIVED_BY,
                })),
                count: archived.length,
                notListed,
              },
              (archived.length === 0
                ? 'no archived conversations you can reach'
                : archived
                    .map(
                      ({ card, archivedAt }) => cardText(card) + archivedSaid(archivedAt, readAt),
                    )
                    .join('\n')) + more,
            )
          }
          const { agents, notListed } = host.agentsVisibleTo(by, me)
          const listed =
            agents.length === 0
              ? // ⛔ **644 · the empty answer names a door** — see this tool's own note.
                'no agents you can see — list_profiles names every agent this app holds'
              : agents.map(cardText).join('\n')
          // ⚑ **D-017 · R12 — the cut, said** — so a list of fifty never reads as *that is all*.
          const more =
            notListed === 0
              ? ''
              : `\n…and ${String(notListed)} more you can reach, not listed here; get_agent_status and message_agent take the label of a piece it owns (W1.2), or its id.`
          return answer(
            { outcome: 'ok', agents: agents.map(cardPayload), count: agents.length, notListed },
            listed + more,
          )
        }),
    },
    {
      name: 'get_agent_status',
      handlerOwnsMissingInput: true,
      // ⚑ **The second half is 433's invariant again** — enumerating and inspecting are one
      // question asked for a set and for one id, so a caller cannot be told about an agent
      // `list_agents` would not name, and is never refused one it would.
      //
      // 🔴 **610 · it had the SAME HOLE and not the same false sentence** (HO-092 §4.3). ⛔ This
      // door hands back {@link cardText} of the very card `list_agents` lists, so the nameless row
      // was this tool's answer too — ⚑ **but the sentence never enumerated the fields**, so unlike
      // `list_agents`' it was not describing a payload that had stopped matching it. ⚠️ The first
      // clause gains the fact the card gained; nothing else here moved.
      description:
        "Who one agent is, what it is doing right now — active, needs you, waiting on another conversation's answer, owing another conversation an answer, running in the background, scheduled, waiting on the agents holding work it gave out, or idle — the work it holds, by label, and where it came from. It answers for any conversation you may reach — every one list_agents names, and any other by the piece it owns (W1.2) or by its id. It says the model and effort its conversation runs on, and what its provider last reported when that differs.",
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **The same read for one id**, folded with the same entitlement — `agentCard` answers `null` for *not there* and *not yours* alike.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries(readerInputs.get_agent_status).map(([field, schema]) => [
          field,
          agentToolHandlerInput(schema),
        ]),
      ),
      call: (args) =>
        guarded(async () => {
          args = toolArgumentsAtHandler(args)
          if (typeof args.agent !== 'string' || args.agent.length === 0) {
            return readerFieldRefusal('get_agent_status', args, ['agent is required'])!
          }
          const fieldRefusal = readerFieldRefusal('get_agent_status', args)
          if (fieldRefusal !== null) return fieldRefusal
          // 🔴 **D-016 · commit 7 · R1 — a label names its piece's owner**, before any rail reads the
          // target; one that names nothing this caller may reach reads as an unknown id below.
          const agent = host.theConversationAddressed(args.agent, by, me, 'messaging')
          // ⚑ **D-017 · R12 — an id out of reach is refused as every door refuses it**: the reach
          // rail `message_agent` meets, and `no-such-agent` only for an id no conversation has.
          const out = host.whyItIsOutOfReach(agent, by, me)
          if (out !== null) return outOfReachAnswer(out, agent)
          const card = host.agentCard(agent, by, me)
          if (card === null) return refusalAnswer(refuseTool('no-such-agent', { agent }))
          // ⚑ **When its last turn ran, and what opened it** — so a giver reading *nothing has
          // started since* can tell whether its own held words were what that turn took.
          const last = host.whatOpenedItsLastTurn(card.agent, me)
          const called = namedByItsWorkOnce(host)
          const named = (who: AConversation): string =>
            who.conversation === me ? 'you' : called(who.conversation, who.about ?? null)
          // Who asked a stop: by name, the caller as `you`, never by id; `''` when no row says.
          const askedBy = (by: WhoStoppedIt | null, asker: string | null): string =>
            by === null
              ? ''
              : askedByClause({
                  by,
                  asker:
                    by === 'an-agent' && asker !== null
                      ? named({ conversation: asker, profile: null })
                      : null,
                })
          const archivedAt = host.whenItWasArchived(card.agent)
          return answer(
            {
              outcome: 'ok',
              agent: cardPayload(card),
              ...(archivedAt === null
                ? {}
                : {
                    archived_at: clockTimeFrom(archivedAt, last.readAt),
                    archived_by: ARCHIVED_BY,
                  }),
              ...(last.took === null ? {} : { last_turn_took: receivedPayload(last.took) }),
            },
            [
              cardText(card) + (archivedAt === null ? '' : archivedSaid(archivedAt, last.readAt)),
              ...theLastTurnSaid(card.lastEndedTurn, last, named, askedBy, card.lastAskToStop),
            ].join('\n\n'),
          )
        }),
    },
    {
      name: 'give_work',
      handlerOwnsMissingInput: true,
      /**
       * 🔴 **D-016 · the one verb that hands an agent something to do** (plan §3.5, R2–R4).
       *
       * ⛔ **The description says what the act IS, not how the app decides** (standing rule 8): it
       * goes to the ONE conversation the giver has with that agent — woken if it stopped, started the
       * first time — the brief is a turn that names the piece's label, and the two refusals a caller
       * can act on are named with their act: a stalled piece (follow it up or take it back) and a
       * name this app does not hold (check it, or ask for a new agent with `new`).
       */
      description:
        'Give a piece of work with a short brief and definition_of_done. Put the detail in inputs. Give a piece of work to an agent, by its profile. By default, it goes to the one conversation you have with that agent, which is woken if it has stopped, and started for you the first time you give that agent work. Name what you give it with a title and a brief; the brief is sent to it as a message of its own, with the piece\u2019s label (W1.2) so it can reply to you. Hand it files with inputs: each is kept as an input of the piece, and the brief names each by its id so the agent can read it with read_document. The piece is hung under the piece you name — or, naming none, under the one piece you were given or took on; holding several, the one the words that began this turn were about, when they were about one; holding none, your own conversation\u2019s work. A piece whose brief has not reached you yet does not count. Without parallel, an agent that is busy, or still holds a piece from you that stalled, still takes it; the answer names a stalled piece, to follow up or take back. new: true brings a new agent into existence under that name; without it, a name this app does not hold is refused. Returns the piece\u2019s label and whether it went straight out or is held. Name model and effort to choose what that conversation runs on; a choice outside the list is refused with the choices. Without them a conversation you have keeps what it runs on, and a new one starts on that agent\u2019s default, else on the model a person last picked for that provider, else on that provider\u2019s default. An agent keeps its own provider: name a model from its provider\u2019s list. A conversation whose model or effort a person set keeps both. A switch holds from that piece on, even if you take the piece back. The answer says what it runs on.',
      /**
       * 🔴 **486 · a person is asked as well** (HO-031 §2.4) — as `spawn_agent` was.
       *
       * ⛔ **It can launch a provider CLI child and spend somebody's account on it.** ⚠️ `SPAWN_RAILS`
       * answer *may you*; none of them answers *should you, now*, and nothing in this roster
       * un-spends a turn. ⚑ HO-031 §2.4's own criterion read literally — *permissions are for acts
       * that reach outside this app* — and it is the only verb here that can.
       */
      beyondItsRails: 'it-starts-something-outside-this-app',
      input: Object.fromEntries(
        Object.entries({
          profile: z
            .string()
            .describe(
              'Which agent to give it to — a name list_profiles gives. It must already exist, unless new is true.',
            ),
          title: z
            .string()
            .describe(
              `What the piece is called: one line, at most ${String(PIECE_TITLE_CHARS)} characters.`,
            ),
          definition_of_done: z.string().describe(WORK_FIELD_WORDS.condition),
          brief: z.string().describe(WORK_FIELD_WORDS.brief),
          folder: z
            .string()
            .optional()
            .describe(
              "A folder for this piece: any that exists; a relative path is read from your own working directory. With parallel: true and no folder, the piece gets its own output folder. A conversation this starts works in the piece's folder, or else in your own working directory. An existing conversation keeps its own working folder and may also use the piece's folder while the piece is open.",
            ),
          piece: z
            .string()
            .optional()
            .describe(
              'Which of your own pieces this is part of, by its label (W1.2) or id. Leave it out to hang it under the one piece you were given or took on — holding several, the one the words that began this turn were about, when they were about one; holding none, your own conversation\u2019s work. A piece whose brief has not reached you yet does not count. Name it when that leaves it unclear — list_tasks names them.',
            ),
          new: z
            .boolean()
            .optional()
            .describe(
              'Set it to bring a new agent into existence under that profile name, with no standing rules, to take this work. A name that is already an agent is refused with it: give without it to use that agent, who keeps its memory.',
            ),
          parallel: z
            .boolean()
            .optional()
            .describe(
              'true gives this piece to a free worker of that agent, or starts another worker if all are busy. Leave it out to use your usual conversation with it. Not for a service, which runs one piece at a time.',
            ),
          inputs: z
            .array(z.string())
            .optional()
            .describe(
              `Files to hand over with the work, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is copied and hashed and kept as one of the piece\u2019s inputs, and the brief names each by its id; one that cannot be kept refuses the whole give, and nothing is given.`,
            ),
          model: z
            .string()
            .optional()
            .describe(
              'The model that conversation runs on, from this piece on: one in the list a person keeps for its provider — the provider\u2019s own models (an alias such as opus stands for the model it points at) and any a person added. Leave it out to keep what it runs on.' +
                theModels,
            ),
          effort: z
            .string()
            .optional()
            .describe(
              'The reasoning effort, one that model offers. Leave it out to keep its effort when the model offers it, else the model\u2019s own default.' +
                theEfforts,
            ),
        } satisfies Readonly<Record<keyof GiveWorkArguments, z.ZodType>>).map(([field, schema]) => [
          field,
          agentToolHandlerInput(schema),
        ]),
      ),
      call: (args) =>
        launchedOrSaid(args, async () => {
          args = toolArgumentsAtHandler(args)
          // ⛔ **Handed to the door VERBATIM, and NOT re-shaped into a narrower object.** `303` B
          // measured a command arriving with eight keys and parsing to seven; the door's schema is
          // `.strict()`, so a key it does not know is refused BY NAME — which is only true while this
          // layer strips nothing on the way.
          let given: Awaited<ReturnType<AgentToolHost['giveWork']>>
          try {
            given = await host.giveWork(args, by)
          } catch (error) {
            // ⚑ **A give that took its label and gave nothing** says so, after what failed: the
            // label is not handed out again, and nothing is called by it.
            if (error instanceof AGiveThatGaveNothing) {
              const failed = error.cause
              return itsLabelIsNotUsed(
                failed instanceof ABriefThatDidNotArrive
                  ? whatADeliveryMet(failed.cause, failed.to, 'give_work')
                  : await launchedOrSaid(args, () => Promise.reject(failed)),
                error.label,
              )
            }
            // ⚑ **A brief that did not arrive is a DELIVERY's failure**, answered as `message_agent`
            // answers one; ⛔ anything else — a launch that did not start among it — goes on to
            // {@link launchedOrSaid}, which classifies a launch and lets the rest propagate.
            if (error instanceof ABriefThatDidNotArrive) {
              return whatADeliveryMet(error.cause, error.to, 'give_work')
            }
            throw error
          }
          if (!given.ok) {
            const { refusal } = given
            // ⚑ **D-016 · a file that could not be kept** — a `ResourceRefusal` is already
            // `341`-shaped and carries `outcome`, so it is spread unchanged, as `carryReplyRefusal`
            // spreads it.
            const carried =
              'outcome' in refusal
                ? { ...refusal }
                : isAMessageRefusal(refusal)
                  ? carryMessageRefusal(refusal)
                  : carryRailRefusal(refusal)
            return answer(carried, `refused (${refusal.rail}): ${refusal.reason}`)
          }
          // ⚑ **The agent by the name every surface says**, and its conversation by the label it was
          // given, which every door that takes an agent takes (D-016 · commit 7 · R1) — the one the
          // brief reached. ⚑ The ids are in the payload.
          const name = host.whatToCallTheConversation(given.owner)
          const where =
            given.owner === given.found
              ? ''
              : ` Your conversation with ${name} could never be reopened, so it went to the conversation that took its place.`
          // ⚑ Held for a reopen on the current sign-in, it says why in place of *until it is free*
          // ({@link heldAndWhy}'s rule) — its last full stop is the sentence's below.
          const queued = given.queuedBehind
          const waits =
            given.delivery === 'sent' || queued !== undefined
              ? null
              : heldAndWhy(host, given.owner, '; it is held.')
          const went =
            queued !== undefined
              ? ''
              : given.delivery === 'sent'
                ? `; it went to ${name} straight away`
                : waits === null
                  ? `; it is held until ${name} is free, then goes out ${WITH_WHATEVER_ELSE_IS_HELD}`
                  : waits.replace(/\.$/, '')
          // 🔴 **D-042 · R4 — the answer says what it runs on** — see {@link whatItRunsOnSaid}.
          // ⚑ A queued give runs on nothing yet: its pair is kept for its turn.
          const runsOn = queued !== undefined ? '' : whatItRunsOnSaid(given.runsOn)
          const started =
            given.startedIn === null
              ? runsOn === ''
                ? ''
                : ` ${runsOn}`
              : ` It started a new conversation for it, in ${given.startedIn}.${runsOn === '' ? '' : ` ${runsOn}`}`
          // Report how the supplied folder is used and any protected place it meets; naming such a place does not refuse the folder.
          const usedFolder = given.givenFolder
          // ⚑ Only what is true for THAT conversation (`grantReach`): a grant widens what asks first,
          // and changes nothing for one that already runs without asking.
          const folder = usedFolder?.folder ?? ''
          const granted =
            usedFolder?.use !== 'grant'
              ? ''
              : queued !== undefined
                ? ` It may also work in ${folder} while ${given.label} is open, once its turn comes.`
                : given.grantReach === 'writes'
                  ? ` It may also write in ${folder} without asking while ${given.label} is open; its own working folder is unchanged.`
                  : given.grantReach === 'reads'
                    ? ` It may also work in ${folder} while ${given.label} is open: it reads there without asking, and still asks before changing anything; its own working folder is unchanged.`
                    : ` It runs without asking, so it could already reach ${folder}; the folder is shown as granted while ${given.label} is open.`
          const notGranted =
            given.folderNotGranted === null
              ? ''
              : ` The folder you named was not granted, and the work was given all the same: ${given.folderNotGranted}.`
          const notice =
            usedFolder?.notice === undefined
              ? ''
              : ` ${protectedPlaceSaid(usedFolder.folder, usedFolder.notice)}`
          const unused = `${granted}${notGranted}${notice}`
          const inputs =
            given.inputs.length === 0 ? '' : ` Kept as its inputs: ${resourcesNamed(given.inputs)}.`
          // ⚑ A stall refuses nothing; the answer names what the giver still has there that
          // nothing drives, with the two acts a stall asks for.
          const stalled = given.stalled ?? []
          const stillHeld = stalled.length === 0 ? '' : ` ${stalledPiecesSaid(stalled)}`
          return answer(
            {
              outcome: 'ok',
              piece: given.piece,
              label: given.label,
              agent: given.owner,
              profile: given.profile,
              ...(given.worker === undefined ? {} : { worker: given.worker }),
              delivery: given.delivery,
              started: given.runsOn.how === 'started',
              runs_on: { model: given.runsOn.model, effort: given.runsOn.effort },
              ...(given.owner === given.found ? {} : { went_to: given.owner }),
              ...(queued === undefined ? {} : { queued_behind: queued }),
              ...(given.inputs.length === 0 ? {} : { inputs: given.inputs }),
              // ⚑ **W4.189** — the folder, how it was used, and D's notice: data beside the words.
              ...(given.givenFolder === null ? {} : { folder: given.givenFolder }),
              ...(stalled.length === 0 ? {} : { stalled: stalled.map((one) => one.label) }),
            },
            `${given.label} given to ${name} (${given.profile})${went}.${queuedSaid(queued, given.queueStalledAt)}${started}${unused}${where}${inputs}${stillHeld}${given.worker === undefined ? '' : ` ${workerLine(given.profile, given.worker.number)}`}`,
          )
        }),
    },
    {
      name: 'message_agent',
      handlerOwnsMissingInput: true,
      /**
       * 🔴 **D-016 · a message hands nothing over, and the sentence says where work goes instead.**
       *
       * ⛔ **It sent work until D-016** — a third kind opened a task — and a description that still
       * offered it would walk a model into a refusal; ⚑ work is `give_work`'s now, and the sentence
       * names it. ⚠️ The sentence INSTRUCTS rather than describing `can_message` (standing rule 8).
       */
      description:
        'Send a message to an agent: a note for its information, or a follow-up on a piece of work you gave it, which you name — say which. To give work, use give_work; to ask something and get the answer back, use ask_question. It is held until that agent is free, then delivered with whatever else is held for it, oldest first (a person\u2019s command goes on its own). With interrupt: true, the turn that agent is running is also asked to stop, so that the message need not wait for its work to finish; the agent is told who asked for the stop. On Claude, the command that turn is waiting on ends with it, and work it sent to the background keeps running; on Codex, the command that turn ran last ends with it unless it has used another tool since, and its other commands keep running. Use interrupt only for something the agent must know before it goes on, not for a routine note, and only for an agent you started or one started under it. Says whether the message is held or went straight out, and what became of the stop.',
      /**
       * ⛔ **Advertised against a TYPE, so *documented* and *read* cannot drift apart** (415, HO-021
       * §3). ⚠️ The `satisfies` below fails to compile if this shape and
       * {@link MessageAgentArguments} stop naming the same set — in either direction — and the
       * handler reads its third argument through {@link MESSAGE_KIND_ARGUMENT}, which is typed as a
       * key of that same interface.
       *
       * 🔴 **A green test could not have proved this.** Since `348` both adapters build the schema
       * with `z.looseObject`, so an UNDOCUMENTED argument is no longer stripped — it reaches the
       * handler, the behaviour changes, and the test passes **while no model has ever been told the
       * argument exists.** ⚑ What is advertised is the falsifiable half, and
       * `a-question-is-not-work.test.ts` §2 reads it back out of the JSON Schema each provider is
       * handed.
       */
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **Words into this app's own mailbox.** `can_message` and the reach answer it, and a message
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
           * ⚠️ **The shared enum schema publishes the words without moving validation out of this
           * door** (`490`, preserving `325`'s rule). Its catch hands an unknown word through, so this
           * file can answer with the structured refusal `307` requires instead of a transport error.
           * ⛔ **A vocabulary the validator has not been taught is a refusal that NAMES the
           * vocabulary, never a pass and never a transport error.**
           */
          kind: documentedToolEnum(
            TOOL_INPUT_ENUMS['message_agent:kind'],
            'What this message is.',
            'There is no default: say which. A note can go to any agent you may message; a follow-up ' +
              'goes only to an agent you gave a piece to, and names that piece.',
          ).optional(),
          /**
           * 🔴 **429 · the reference, and the tool's own description is where it may be taught** —
           * a piece since D-016. ⚠️ **It says what the field DOES for each kind**, because a follow-up
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
              'true also asks the turn that agent is running to stop, so that this message need not wait for its work to finish — a turn can run for hours. Use it only for something the agent must know before it goes on: a change of plan, a request to pause and save where it is. To answer a question it asked you, use answer_question, which asks that turn to stop by default. On Claude, the command that turn is waiting on ends with it, and work it sent to the background keeps running; on Codex, the command that turn ran last ends with it unless it has used another tool since, and its other commands keep running. Its open questions stay open. Only for an agent you started or one started under it. Leave it out for anything that can wait.',
            ),
        } satisfies Readonly<Record<keyof MessageAgentArguments, z.ZodType>>).map(
          ([field, schema]) => [field, agentToolHandlerInput(schema)],
        ),
      ),
      call: (args) =>
        guarded(async () => {
          // 🔴 **486 · the standing wall first** (HO-031 §2.5). ⛔ **`may-not-message` sat behind
          // both the shape below and `no-such-agent`**, and both of those are `permanent` — so a
          // caller a person had granted no reach at all was told *change the call* about a wall no
          // call changes. ⚑ Argument-independent by construction: {@link RuntimeHost.mayReachAtAll}
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
          // 🔴 **`hasSomethingToSend` and not `length === 0`, and the difference was a second
          // mis-fold in the catch-all below** (424, found while splitting it). ⛔ A message of pure
          // whitespace passed this guard, reached `queueMessage`, threw `NOTHING_TO_SEND` — the
          // shared predicate the composer and the wire both use — and came back out as
          // `agent-cannot-take-a-message`: *"that agent is not in a state where it can be given
          // anything to do"*, which is a sentence about the RECEIVER for a fault in the caller's own
          // arguments. ⚑ 340's finding, a reason answering with another reason's sentence.
          //
          // ⚠️ **The shared predicate rather than a `trim()` of our own**, because the rule about
          // what counts as something to send lives in one place and this door is now one of its
          // readers — `169` §1. ⛔ **No attachment is counted here**: this tool has no argument for
          // one and passes `[]` below, so the second half of that predicate is answered by the
          // call site rather than by the caller.
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
          // 🔴 **The caller's own declaration, validated here** (415) — and required since D-010
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
          // 🔴 **D-016 · commit 7 · R1 — a label names its piece's owner**, after the call's own shape
          // and before the first rail that reads the target: one that names nothing this caller may
          // reach is handed back as spelled, and meets `no-such-agent` below as an unknown id does.
          const agent = host.theConversationAddressed(spelled, by, me, 'messaging')
          // ⚑ A piece the caller gave that waits, queued, at a service has reached nobody: nothing is
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
          // ⛔ **Existence and entitlement asked HERE, before the host is asked to do anything.**
          // `queueMessage` refuses a stranger by THROWING, and a throw is transport `-32603` — a
          // shape that tells the model its tool is broken rather than that it asked about somebody
          // else's agent.
          //
          // 🔴 **The reach and not `agentCard`** (431 · criterion 6) — ⚑ **D-017 · R12**: asked through
          // {@link RuntimeHost.whyItIsOutOfReach}, which asks `RuntimeHost.withinMessagingReach` inside
          // the host (the tool layer no longer holds that member). ⚠️ **The
          // two readers ask different questions now and this door needs the second one**: the card
          // answers `mayCommand`, and `430` measured that refusing BroBot a conversation a PERSON
          // opened. ⚑ **D-017 · R12 — the fold is gone** (`05` rule
          // 6): *not within your reach* is the reach rail, and *there is no such conversation* is
          // `no-such-agent`, said only about an id no conversation has
          // ({@link RuntimeHost.whyItIsOutOfReach}).
          //
          // ⚑ **`get_agent_status` and `list_agents` WERE moved with it at 433**, and `431` left
          // that as a finding rather than guessing: *a caller may SEE exactly what it may SEND to*.
          // ⛔ Both readers now ask this very method through {@link RuntimeHost.agentCard} and
          // {@link RuntimeHost.agentsVisibleTo}, so an id this door admits is an id those two will
          // name — and one they refuse is one this door refuses, in the same answer.
          //
          // ⚠️ **The readers were never the whole of what this door discloses.**
          // This door's own answers disclose something about the target — `delivery` says whether
          // it was mid-turn. ⛔ That is a fact about a call this caller made, which is 086's line;
          // naming the bound narrowly is what keeps it honest.
          const out = host.whyItIsOutOfReach(agent, by, me, true)
          if (out !== null) return outOfReachAnswer(out, agent)
          // 🔴 **You are that agent, and the reader above ADMITS you** (424, from `422`). ⛔
          // `agentCard` answers about `slot.id === me` on purpose — a caller is entitled to be told
          // about itself, which is what `get_agent_status` is for — so the self case passes the
          // line above, reaches the host's own gate, and comes back out of the `catch` below as the
          // unsplit `agent-cannot-take-a-message`: *"that agent is not in a state where it can be
          // given anything to do"*, `while-this-holds`, retryable, for ever. ⚠️ **The host gate
          // that refuses it is `requireToMessage` since `431`**, and it refuses a conversation
          // queueing words into itself in its own clause, so the sentence below is what a model
          // meets rather than a transport error either way.
          //
          // ⚠️ **Asked HERE rather than in the host**, for the reason the entitlement question above
          // is: `me` is minted by the toolset from the session it was built for and cannot be handed
          // another, so this layer is the only one that can compare the two and the host would have
          // to be told something it is not told today.
          // 🔴 **F091 · …and a conversation it took the place of is this one too**: a message to it
          // goes to the one in its place, and the host's gate refused that as a conversation that
          // could take no message — a person was told to look at a conversation that is the caller.
          if (agent === me || host.tookItsPlace(agent) === me) {
            return selfRefusal(spelled, agent)
          }
          // 🔴 **429 · the piece it is about, validated ONCE** — {@link MESSAGE_PIECE_ARGUMENT}. ⛔ Its
          // own shape refusal rather than a fold into the empty-string guard above: `piece: 42` is a
          // caller naming a piece wrong, not a caller with no text. ⚑ **A follow-up must name one**
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
            // ⛔ **The lookup is the entitlement** ({@link RuntimeHost.whatAPieceIsTo}): a piece is
            // this caller's to name only as one it gave or one it holds, so one answer covers a name
            // that names nothing and one that is somebody else's. 🔴 **F086 · a note names either,
            // open or ended** — a piece it held is still its own once answered, taken back or closed,
            // as one it gave is. ⛔ A follow-up names one it gave that agent; a piece it held that has
            // ended is not that, and is refused `not-a-piece-you-gave` below, never
            // `that-is-work-you-hold`, whose acts — ask about it, hand it back — an ended piece refuses.
            const it = host.whatAPieceIsTo(me, agent, named)
            if (says === 'follow-up' && it.is !== 'given-to-it') {
              // 🔴 **628 · is it work this caller HOLDS?** (`HO-095` §3.1 · §3.2). ⛔ That is the case
              // the whole chain came from: a manager naming the piece its parent gave IT, addressed
              // to that parent. ⚑ The sentence names the two verbs that are right for work it holds.
              // 🔴 **F087 · a piece the caller holds that has ended, or gave another agent, is said
              // as what it is** — `not-a-piece-you-gave`, with the act left — and the word's own
              // sentence, whose guess is that the name may belong to nothing, is kept for a name
              // that is neither.
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
                    : refuseTool('not-a-piece-you-gave', { agent, piece: named }),
              )
            }
            if (it.is === 'none') {
              return refusalAnswer(refuseTool('no-piece-by-that-name', { piece: named }))
            }
            about = { piece: it.piece, label: it.label }
          }
          try {
            // ⚠️ **The three arguments between are this call's own values and not padding**: no
            // attachment, the work slot in the receiver's mailbox — see `MAILBOX_KINDS`, which
            // decides whether a SECOND message may be held and is a different question from the one
            // `says` answers — and no turn facts, which only the app's own doors carry.
            // ⚑ **D-017 · R1 — a conversation that is not running is started for it** (the host's
            // `deliverWhenItRuns`), so the receipt says what reached it and never whether it ran.
            // ⚑ **D-017 · R10 — whether it had already been replaced**, so the receipt says once, to
            // the sender whose message found it could never be reopened, what happened.
            const before = host.tookItsPlace(agent)
            const messageAct = `message_act_${randomUUID()}`
            const facts = {
              ...(about === null ? {} : { aboutPiece: about }),
              addressedAs: spelled,
              messageAct,
            }
            // ⚑ **An interrupting message is held first and the stop asked second, inside the host**
            // ({@link RuntimeHost.messageAgentNow}), and it is refused before anything is held when
            // the receiver is not one this caller may interrupt — the same reach `interrupt_agent` has.
            const now =
              interruptAsked === true
                ? await host.messageAgentNow(agent, text, by, says, facts)
                : null
            if (now !== null && !now.ok) {
              return refusalAnswer(refuseTool('that-agent-is-not-below-you', { agent }))
            }
            const outcome =
              now === null
                ? await host.queueMessage(agent, text, by, [], 'work', facts, says)
                : now.delivery
            const wentTo = host.tookItsPlace(agent)
            const where = whereItWent(agent, before, wentTo, host)
            // ⚑ **D-016 · commit 7 · R3 — the receiver by the piece it owns**: one agent can hold many
            // conversations, and nothing else in these words says which one took the message.
            const called = host.nameByItsWork(wentTo ?? agent)
            // ⚑ **…named in full ONCE, and by its name alone after that**: the full name is a
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
            // 🔴 **703 · a message about a piece this caller gave has reached its holder** (`698` F-A)
            // — what the host still holds for this caller about that piece, saying it is not being
            // worked on, is false now ({@link RuntimeHost.takeBackWhatItsQuestionMadeFalse}).
            // ⛔ **SENT, never held** (`703`'s review): a held message has reached nobody, and the
            // push is still true.
            if (outcome.outcome === 'sent' && about !== null) {
              host.takeBackWhatItsQuestionMadeFalse({ agent, piece: about.piece }, by)
            }
            // ⛔ **The held message's id stays inside the app** (490). It names the receiver's
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
              // 🔴 **657 · true in both arms a hold now has.** ⛔ It said *"when the turn it is
              // running now ends"*, and a message held after a lost race can find the winning turn
              // already over — it then goes at once, with no turn to wait for. 🔴 **D-027 · and
              // WITH whatever else is held for it**: the mailbox goes out as one turn, oldest first,
              // so a notice or another caller's words can be in the same turn, ahead of this one —
              // ⛔ up to a person's command, which goes alone ({@link WITH_WHATEVER_ELSE_IS_HELD}).
              (heldBecause ??
                `${where}held for ${called}; it goes out once ${again} is free — at once, ` +
                  `if it is — ${WITH_WHATEVER_ELSE_IS_HELD}.`) +
                (stopped === null ? '' : ` ${stopped.said}`),
            )
          } catch (error) {
            return whatADeliveryMet(error, agent, 'message_agent')
          }
        }),
    },
    {
      name: 'read_document',
      handlerOwnsMissingInput: true,
      /**
       * 🔴 **D-016 · a RESOURCE, by its id** — an input its giver handed over, or a file the agent
       * holding it kept or handed back with its reply, which this app keeps for the piece (plan
       * ruling 13: the tool keeps its name and reads a resource).
       *
       * ⚑ **What it says is what is TRUE and what is still bounded**: any resource — no entitlement
       * is asked (HO-057, carried from the documents resources replaced) — and the bytes are
       * re-checked against the hash they were kept with, which is the one thing that was never
       * widened.
       */
      description:
        'Read a resource this app keeps for a piece of work — an input its giver handed over, or a file the agent holding it kept or handed back with its reply. A report comes back as Markdown and a page as its source; an image or a PDF comes back saying so. The app re-checks the bytes against the hash first.',
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **A read of a resource this app kept**, under the app's own root, gated by `RESOURCE_RAILS`.
       * ⛔ `resourceBytes` places the row's file inside the resources tree before it reads anything,
       * so this tool and the person's window narrow through one rule — `169` §1.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries(readerInputs.read_document).map(([field, schema]) => [
          field,
          agentToolHandlerInput(schema),
        ]),
      ),
      call: (args) =>
        guarded(async () => {
          args = toolArgumentsAtHandler(args)
          const { resource } = args
          if (typeof resource !== 'string' || resource.length === 0) {
            return readerFieldRefusal('read_document', args, ['resource is required'])!
          }
          const fieldRefusal = readerFieldRefusal('read_document', args)
          if (fieldRefusal !== null) return fieldRefusal
          // ⛔ **Nothing here asks who may read what** — the module note's rule. ⚑ What arrives is a
          // `RESOURCE_RAILS` refusal already in `341`'s shape, so it is carried rather than
          // translated: the store's absence, an id that names nothing, and the byte rails.
          const read = host.readResource(resource)
          if (!read.ok) {
            return answer(
              { ...read.refusal },
              `refused (${read.refusal.rail}): ${read.refusal.reason}`,
            )
          }
          // 🔴 **635 · the payload branches on the CONTENT, and the *not this* arm is a member**
          // (`HO-097` §1.2: *"where a type cannot be handed to a model, the tool says so plainly
          // rather than returning something useless"*).
          const said =
            read.content.as === 'not-for-a-model'
              ? `That resource is of a form this app does not hand to a model (${read.content.because}). ${NOT_FOR_A_MODEL_ACT}`
              : read.content.text
          return answer(
            {
              outcome: 'ok',
              resource: read.resource.resource,
              piece: read.resource.piece,
              name: read.resource.name,
              role: read.resource.role,
              sha256: read.resource.sha256,
              // ⚑ **The form is on the payload as well as in `content.as`**, because they answer
              // different questions: `form` is *what the file is* and `as` is *what you were
              // handed*. ⛔ A page is a `page` handed over `as: 'source'`.
              form: read.form,
              // 🔴 **675 · the text is the answer's PROSE, and it is not said twice** — twice is
              // twice the context. ⚑ `as` stays, so a model reads WHICH it got; the refusal-shaped
              // arm keeps its `because`.
              content:
                read.content.as === 'not-for-a-model'
                  ? { ...read.content }
                  : { as: read.content.as },
            },
            said,
          )
        }),
    },
    {
      name: 'reply_to_parent',
      handlerOwnsMissingInput: true,
      description:
        'Finish a piece of work you were given, or took on for a person, and tell the conversation that gave it. Name the piece — its label, like W1.2, or its id — and set the required outcome to done, blocked or failed; the app knows where it goes, and starts that conversation if nothing is running in it. A piece you took on with take_on_work goes to no other conversation: tell the person here. Hand back files with resource_paths: each is kept as a resource that conversation can read. Returns the piece’s label, the resources kept, and where the reply went: straight to that conversation, held until it is free, kept for its next start when it could not take it now, or not delivered — with why.',
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * 🔴 **HO-031 §2.9's own example.** ⛔ *"The PM needed a human approval to call `mcp__brobot__reply_to_parent` — it had to ask permission to answer its parent."* ⚠️ The reply goes to the conversation that gave the work, `REPLY_RAILS` decide whether it lands, and a click here is the one that *breaks the loop the tools exist to make*.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries(replyInput).map(([field, schema]) => [field, agentToolHandlerInput(schema)]),
      ),
      call: (args) =>
        guarded(async () => {
          args = toolArgumentsAtHandler(args)
          // 🔴 **An addressing argument is REFUSED, never overridden** (HO-015 §1.3, and `371`'s
          // defect said out loud). ⛔ `371` shipped a `parentSessionId` that was silently taken and
          // replaced — *"enforcement was right and disclosure was wrong, and the caller was told its
          // argument was taken"*. ⚑ Every spelling of the same idea is refused, because the thing
          // being refused is an INTENT.
          const aimed = REPLY_ADDRESSING_KEYS.filter((key) => Object.hasOwn(args, key))
          if (aimed.length > 0) {
            return refusalAnswer(
              refuseTool('malformed-request', {
                problems: aimed.map(
                  (key) =>
                    `${key} is not an argument of this tool: a reply goes to the conversation that gave you the piece, and naming the piece is how you say which one`,
                ),
              }),
            )
          }
          const bothSummaryFields = args.summary !== undefined && Object.hasOwn(args, 'message')
          if (args.summary === undefined && Object.hasOwn(args, 'message')) {
            args = { ...args, summary: args.message }
          }
          const { piece, outcome, summary } = args
          const savedMethod = args.saved_method
          const methodReport =
            typeof savedMethod === 'string' && savedMethod.trim().length > 0
              ? savedMethod
              : undefined
          const paths = args.resource_paths
          const resultDocument = args.result_document
          const problems: z.core.$ZodIssue[] = []
          const problem = (field: string, message: string): void => {
            problems.push({ code: 'custom', path: [field], message })
          }
          const wrongType = (field: string): void => {
            problems.push({
              code: 'invalid_type',
              path: [field],
              expected: 'string',
              message: 'expected text',
            })
          }
          if (bothSummaryFields) {
            problem(
              'summary',
              'send only one of message and summary; message is accepted only when summary is absent',
            )
          }
          if (piece === undefined) problem('piece', 'required; expected non-empty text')
          else if (typeof piece !== 'string') wrongType('piece')
          else if (piece.length === 0) problem('piece', 'must not be empty')
          const outcomes = TOOL_INPUT_ENUMS['reply_to_parent:outcome'].members.join(', ')
          if (!isTaskOutcome(outcome)) {
            problem(
              'outcome',
              `${outcome === undefined ? 'required; ' : ''}expected one of ${outcomes}`,
            )
          }
          if (summary === undefined) problem('summary', 'required; expected non-empty text')
          else if (typeof summary !== 'string') wrongType('summary')
          else if (summary.trim().length === 0) problem('summary', 'must not be empty or blank')
          if (savedMethod !== undefined && typeof savedMethod !== 'string') {
            problem('saved_method', 'expected text, or absent')
          } else if (typeof savedMethod === 'string' && savedMethod.length > SAVED_METHOD_CHARS) {
            problem(
              'saved_method',
              `at most ${String(SAVED_METHOD_CHARS)} characters; got ${String(savedMethod.length)}`,
            )
          }
          if (
            paths !== undefined &&
            (!Array.isArray(paths) ||
              !paths.every((one) => typeof one === 'string' && one.length > 0))
          ) {
            problem('resource_paths', 'expected a list of non-empty text paths, or absent')
          } else if (Array.isArray(paths) && paths.length > MAX_RESOURCES_PER_REPLY) {
            problem(
              'resource_paths',
              `at most ${String(MAX_RESOURCES_PER_REPLY)} files; got ${String(paths.length)}`,
            )
          }
          if (args.needs_user_action !== undefined && typeof args.needs_user_action !== 'boolean') {
            problem('needs_user_action', 'expected true or false, or absent')
          }
          if (problems.length > 0) {
            const fields = Object.keys(replyInput)
            const unknown = Object.keys(args).filter(
              (key) => key !== 'message' && !Object.hasOwn(replyInput, key),
            )
            const detail = workRequestRefused(problems, args, fields)
            if (unknown.length === 0) return refusalAnswer(refuseTool('malformed-request', detail))
            const names = unknown.slice(0, 3).map((key) => {
              const name = /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) ? key : 'unknown field'
              return `${name}: not a field of reply_to_parent; use ${fields.slice(0, -1).join(', ')} or ${fields.at(-1)}`
            })
            if (unknown.length > 3) names.push('Other unknown fields were also sent.')
            // Copying the detail leaves caller-named problems outside the identity marker.
            return refusalAnswer(
              refuseTool('malformed-request', { problems: [...detail.problems, ...names] }),
            )
          }
          if (
            resultDocument !== undefined &&
            (typeof resultDocument !== 'string' || resultDocument.length === 0)
          ) {
            const refused = refuseReply('result-document-not-returned')
            return answer(
              carryReplyRefusal(refused),
              `refused (${refused.rail}): ${refused.reason}`,
            )
          }
          // ⛔ **Not one rail is asked here.** Which piece this caller holds, whether it is still
          // open, how long a summary may be and whether a file may be kept are all the host's — the
          // module note's rule, and the reason the addressing question above is about the SHAPE of
          // the call rather than about who may reach whom.
          const replied = await host.replyToParent(
            {
              piece: piece as string,
              outcome: outcome as TaskOutcome,
              summary: summary as string,
              ...(methodReport === undefined ? {} : { savedMethod: methodReport }),
              resourcePaths: Array.isArray(paths) ? (paths as string[]) : [],
              ...(typeof resultDocument === 'string' ? { resultDocument } : {}),
              needsUserAction: args.needs_user_action === true,
            },
            by,
          )
          if (!replied.ok) {
            // ⚑ **Two vocabularies arrive here and neither is translated** — this file's job is to
            // carry a refusal, and the resource sentences were written for exactly this caller.
            const carried = carryReplyRefusal(replied.refusal)
            return answer(carried, `refused (${replied.refusal.rail}): ${replied.refusal.reason}`)
          }
          // The files kept with the reply, by id (the outcome holds no names).
          const kept = replied.resources.length === 0 ? '' : ` ${keptResources(replied.resources)}`
          const main =
            replied.resultDocument === undefined ? '' : ` Main result: ${replied.resultDocument}.`
          const saveMethod =
            methodReport === undefined && host.maySaveMemory(me)
              ? " If this work taught you a tested method you would reuse, save it now as your Saved methods section says; otherwise you're done."
              : ''
          // 🔴 **D-016 · commit 6 · R5 — a person's own request, answered and delivered nowhere**:
          // there is no conversation it went to, so the payload carries no `delivered` at all.
          if (replied.delivered === null) {
            return answer(
              {
                outcome: 'ok',
                piece: replied.piece,
                label: replied.label,
                state: 'answered',
                resources: replied.resources,
                ...(replied.resultDocument === undefined
                  ? {}
                  : { result_document: replied.resultDocument }),
              },
              `${replied.label} answered · it was a person’s own request, so the reply went to no other conversation — tell them here.${kept}${main}${saveMethod}`,
            )
          }
          return answer(
            {
              outcome: 'ok',
              piece: replied.piece,
              label: replied.label,
              state: 'answered',
              resources: replied.resources,
              ...(replied.resultDocument === undefined
                ? {}
                : { result_document: replied.resultDocument }),
              delivered: replied.delivered,
              ...(replied.why === undefined ? {} : { why: replied.why }),
            },
            `${replied.label} answered · ${whereTheReplyWent(replied)}${kept}${main}${saveMethod}`,
          )
        }),
    },
    {
      name: 'list_tasks',
      handlerOwnsMissingInput: true,
      description:
        'Your pieces of work: named, one piece’s record — its state, current status line, the last exchange with the agent holding it, its open questions, its children and its resources — the inputs it was given and what was made for it; unnamed, your board — the open pieces you hold (your own root among them) and gave: waiting, working or stalled, and any you gave whose answer has not reached you. An open piece an archived conversation holds is named in one line and not listed. The ones that ended are counted and not listed: state: "all" lists them too and "ended" only them, a line each, newest first and as many as limit says; name one to read its record. A piece another conversation of your profile holds or gave can be named too. Labels (W1.2) and ids both name a piece. made: true lists instead the files your profile’s conversations made.',
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **The caller's own work**: a piece it holds or gave, ⚑ **or one a conversation of its
       * own profile holds or gave** (D-024 · R2), and nothing else — the host's lookup is the
       * entitlement, and a piece it may not read is `no-piece-by-that-name`. ⚑ **D-024 · R3 —
       * `made`** lists the files its profile's conversations made; each is readable by its id with
       * `read_document`.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries(readerInputs.list_tasks).map(([field, schema]) => [
          field,
          agentToolHandlerInput(schema),
        ]),
      ),
      call: (args) =>
        guarded(async () => {
          args = toolArgumentsAtHandler(args)
          const named = args.piece
          if (named !== undefined && (typeof named !== 'string' || named.length === 0)) {
            return readerFieldRefusal('list_tasks', args, [
              'piece, when given, must be a label or an id',
            ])!
          }
          const made = args.made
          if (made !== undefined && typeof made !== 'boolean') {
            return readerFieldRefusal('list_tasks', args, [
              'made, when given, must be true or false',
            ])!
          }
          if (made === true && named !== undefined) {
            return readerFieldRefusal('list_tasks', args, [
              'made and piece cannot be given together',
            ])!
          }
          const asked = theListingAsked(args.state, args.limit)
          if ('problems' in asked) {
            return readerFieldRefusal('list_tasks', args, asked.problems)!
          }
          if (
            (args.state !== undefined || args.limit !== undefined) &&
            (named !== undefined || made === true)
          ) {
            return readerFieldRefusal('list_tasks', args, [
              'state and limit are for the board: they cannot be given with piece or made',
            ])!
          }
          const fieldRefusal = readerFieldRefusal('list_tasks', args)
          if (fieldRefusal !== null) return fieldRefusal
          if (made === true) {
            // 🔴 **D-024 · R3 — what this conversation's profile made**, newest first, each with the
            // piece it was kept on and when; the rest counted. ⚑ Named by its id, which
            // `read_document` takes, and its file's name — a resource's one address.
            const listed = host.madeByItsProfile(me)
            if (listed.is === 'no-profile') {
              return answer(
                { outcome: 'ok', made: [], more: 0 },
                'this app cannot name the profile this conversation runs as, so it lists no files',
              )
            }
            return answer(
              {
                outcome: 'ok',
                made: listed.made.map((one) => ({
                  resource: one.resource.resource,
                  name: one.resource.name,
                  title: one.resource.title,
                  piece: one.resource.piece,
                  label: one.label,
                  piece_title: one.title,
                  kept_at: one.resource.createdAt,
                })),
                more: listed.more,
              },
              listed.made.length === 0
                ? 'your profile has made no files'
                : [
                    [
                      'files your profile made, newest first:',
                      // ⚑ **D-026 · a title is said only when the name does not already say it**:
                      // a file with no heading is titled by its name, which `res_… (name)` says.
                      ...listed.made.map(
                        (one) =>
                          `  ${resourcesNamed([one.resource])}${
                            one.resource.title === null || one.resource.title === one.resource.name
                              ? ''
                              : ` · ${one.resource.title}`
                          } — on ${pieceLine(one.label, one.title)}, ${clockTime(one.resource.createdAt)}`,
                      ),
                    ].join('\n'),
                    // ⚑ **The rest counted, and where they are**: a file older than these is on the
                    // record of the piece it was kept on, and nowhere else.
                    ...(listed.more === 0
                      ? []
                      : [
                          `${listed.more === 1 ? '1 older one is' : `${String(listed.more)} older ones are`} not listed: find_files finds them, or list_tasks naming the piece one was kept on.`,
                        ]),
                    READ_ONE_WITH_READ_DOCUMENT,
                  ].join('\n\n'),
            )
          }
          /**
           * 🔴 **724 · `720` F-C — the name of each conversation that asked a turn to stop**, once
           * per asker per call — the words the pushed notice uses ({@link theStallAndItsAsk}).
           * ⚑ **D-016 · commit 7 · R3 — by the piece each owns** ({@link namedByItsWorkOnce}):
           * nothing on the line names the asker, nor the senders a record quotes.
           */
          const called = namedByItsWorkOnce(host)
          /**
           * 🔴 **484 · what the conversation holding a row is doing now** — memoised per id, and
           * asked through {@link AgentToolHost.agentCard} so the disclosure is EXACTLY
           * `get_agent_status`'s and cannot be a second opinion about reach.
           *
           * ⛔ **`null` when the card reader has no visible card** — this caller may not be told about
           * that conversation. It is the same absence `list_agents` gives, arrived at through the same
           * door. ⚠️ Asked here rather than in the host: the fold has no business knowing what is
           * live, and a `PieceRow` that carried a live field would be a derivation that is not a
           * function of its ledger.
           */
          const seen = new Map<string, AgentCard | null>()
          const cardOf = (row: PieceRow): AgentCard | null => {
            const held = seen.get(row.owner)
            if (held !== undefined) return held
            const card = host.agentCard(row.owner, by, me) ?? null
            seen.set(row.owner, card)
            return card
          }
          const ownerIs = (row: PieceRow): AgentCard['state'] | null => cardOf(row)?.state ?? null
          const ownerFacts = (row: PieceRow): Readonly<Record<string, unknown>> => {
            const card = cardOf(row)
            if (card === null) return {}
            return {
              owner: card.agent,
              ...(card.whose.is === 'an-identity-this-app-holds'
                ? { profile: card.whose.profile, name: card.whose.name }
                : {}),
            }
          }
          const ownerWords = (row: PieceRow): string => {
            const card = cardOf(row)
            return card?.whose.is === 'an-identity-this-app-holds'
              ? ` · ${whoseText(card.whose)}`
              : ''
          }
          /**
           * ⚑ What an open row's holder's turn is stopped on until a person answers it, as its card
           * says it.
           */
          const stopOf = (row: PieceRow): AgentCard['stoppedOnAPerson'] =>
            TASK_IS_OPEN[row.state] && row.owner !== me
              ? (cardOf(row)?.stoppedOnAPerson ?? null)
              : null
          /**
           * ⚑ **Why what is held for a row's holder waits** — the words a receipt says when it
           * holds something for that conversation ({@link AgentToolHost.whyWhatIsHeldWaits}),
           * memoised per holder, and said only where this caller sees the holder's card. ⚑ Beside a
           * stop the line already says ({@link stopOf}), only what else holds the words.
           */
          const waits = new Map<string, string | null>()
          const heldBecause = (row: PieceRow): string | null => {
            // ⚑ A row the caller holds itself is about its own conversation: nothing to say here.
            if (!TASK_IS_OPEN[row.state] || row.owner === me || ownerIs(row) === null) return null
            const known = waits.get(row.owner)
            if (known !== undefined) return known
            const why = host.whyWhatIsHeldWaits(row.owner, stopOf(row) !== null)
            waits.set(row.owner, why)
            return why
          }
          /** Each holder's name, once per call — `null` for what the caller holds. */
          const holders = new Map<string, string>()
          const heldByName = (row: PieceRow): string | null => {
            if (row.owner === me) return null
            const known = holders.get(row.owner)
            if (known !== undefined) return known
            const name = host.whatToCallTheConversation(row.owner)
            holders.set(row.owner, name)
            return name
          }
          const line = (row: PieceRow): string =>
            pieceText(row, ownerIs(row), called, me, heldBecause(row), stopOf(row), heldByName(row))
          const payload = (row: PieceRow): Readonly<Record<string, unknown>> =>
            piecePayload(row, ownerIs(row), heldBecause(row), stopOf(row))
          const unreadLines = (
            rowsUnread: number,
            ledgersSkipped: number | undefined,
          ): string[] => [
            ...(rowsUnread === 0 ? [] : [unreadRowsSentence(rowsUnread)]),
            ...whenSkipped(ledgersSkipped, skippedRecordsSentence),
          ]
          if (named === undefined) {
            // ⛔ **No argument names anybody, and no rails.** A conversation is told about its own
            // work, and `me` is minted by this toolset rather than supplied —
            // `RuntimeHost.pieceBoard` says why neither half replaces the other.
            const everyPiece = host.pieceBoard(me)
            // An open piece an archived conversation holds is put away with it: named in one
            // line, and not listed.
            const putAway = everyPiece.gave.filter(
              (row) => TASK_IS_OPEN[row.state] && host.whenItWasArchived(row.owner) !== null,
            )
            const board =
              putAway.length === 0
                ? everyPiece
                : { ...everyPiece, gave: everyPiece.gave.filter((row) => !putAway.includes(row)) }
            const heldForMe = host.answersHeldFor(me)
            /** Why a piece that is over is still this caller's to read, or `null`. */
            const notRead = (row: PieceRow): AnswerNotRead | null => {
              if (TASK_IS_OPEN[row.state]) return null
              if (row.answerReachedNobody) return 'reached-nobody'
              return heldForMe.has(row.piece) ? 'held-for-you' : null
            }
            const listedFrom = (rows: readonly PieceRow[], itsAnswersAreMine: boolean) =>
              listedOf(rows, asked, {
                open: (row) => TASK_IS_OPEN[row.state],
                // ⚑ Only of the work it GAVE: an answer is its giver's to read.
                kept: (row) => itsAnswersAreMine && notRead(row) !== null,
                endedAt: (row) => row.endedAt,
              })
            const hold = listedFrom(board.hold, false)
            const gave = listedFrom(board.gave, true)
            const whole = (row: PieceRow, flagged: boolean) => {
              const unread = flagged ? notRead(row) : null
              return {
                payload:
                  unread === null ? payload(row) : { ...payload(row), answer_not_read: unread },
                // ⚑ Said before the line's own words, which end on its answer's.
                text:
                  unread === null ? line(row) : `  ${ANSWER_NOT_READ_SAID[unread]}:\n${line(row)}`,
              }
            }
            const ended = (row: PieceRow) => ({
              payload: { ...endedPiecePayload(row), ...ownerFacts(row) },
              text: endedPieceText(row) + ownerWords(row),
            })
            const holdRows = [
              ...hold.whole.map((row) => whole(row, false)),
              ...hold.ended.map(ended),
            ]
            const gaveRows = [
              ...gave.whole.map((row) => whole(row, true)),
              ...gave.ended.map(ended),
            ]
            // ⚑ A root has no state: it is its conversation's own work, listed with what is open.
            const root = asked.listing === 'ended' ? null : board.root
            const notListed = {
              you_hold: countedBy(hold.rest, howAPieceEnded),
              you_gave: countedBy(gave.rest, howAPieceEnded),
            }
            /** What a half says when it lists nothing: that it holds none, or none of this kind. */
            const none = (
              any: boolean,
              words: { readonly none: string; readonly open: string; readonly ended: string },
            ): string => {
              if (!any) return words.none
              return asked.listing === 'ended' ? words.ended : words.open
            }
            const rest = [
              ...(hold.rest.length === 0
                ? []
                : [`of the work you hold, ${countsSaid(notListed.you_hold)}`]),
              ...(gave.rest.length === 0
                ? []
                : [`of the work you gave, ${countsSaid(notListed.you_gave)}`]),
            ]
            return answer(
              {
                outcome: 'ok',
                listed: asked.listing,
                you_hold: [
                  ...(root === null ? [] : [rootPayload(root)]),
                  ...holdRows.map((one) => one.payload),
                ],
                you_gave: gaveRows.map((one) => one.payload),
                // The open pieces you gave that archived conversations hold, by label.
                held_by_archived: putAway.map((row) => row.label),
                // ⚑ What the lists leave out, counted by how each ended (or `open`, when only the
                // ended ones were asked for). ⛔ Always present: `{}` says nothing was left out.
                not_listed: notListed,
                // 🔴 **671 · R18 — the count, IN the payload and not only in a log** (the PM's
                // words). ⛔ Always present, so `0` is a measurement a model can read.
                rows_unread: board.rowsUnread,
              },
              [
                root === null && holdRows.length === 0
                  ? none(board.root !== null || board.hold.length > 0, {
                      none: 'you hold no work',
                      open: 'you hold no open work',
                      ended: 'no work you hold has ended',
                    })
                  : [
                      'work you hold:',
                      ...(root === null ? [] : [rootText(root, me)]),
                      ...holdRows.map((one) => one.text),
                    ].join('\n'),
                ...(gaveRows.length > 0
                  ? [['work you gave:', ...gaveRows.map((one) => one.text)].join('\n')]
                  : // The line about what is put away says it, when open work you gave is.
                    putAway.length > 0 && asked.listing !== 'ended'
                    ? []
                    : [
                        none(board.gave.length > 0, {
                          none: 'you have not given anybody work',
                          open: 'no work you gave is open',
                          ended: 'no work you gave has ended',
                        }),
                      ]),
                ...(rest.length === 0
                  ? []
                  : [`not listed: ${rest.join('; ')}. ${HOW_TO_LIST_MORE_PIECES}`]),
                ...(putAway.length === 0
                  ? []
                  : [
                      `put away with archived conversations, and not listed: ${putAway
                        .map((row) => row.label)
                        .join(
                          ', ',
                        )}. Name one to read its record; list_agents with archived: true names the conversations.`,
                    ]),
                ...unreadLines(board.rowsUnread, board.ledgersSkipped),
              ].join('\n\n'),
            )
          }
          const record = host.pieceRecord(me, named)
          if (record.is === 'no-piece-by-that-name') {
            return refusalAnswer(refuseTool('no-piece-by-that-name', { piece: named }))
          }
          const childPayload = (row: PieceRow): Readonly<Record<string, unknown>> => ({
            ...ownerFacts(row),
            piece: row.piece,
            label: row.label,
            title: row.title,
            state: row.state,
            status_line: statusLinePayload(row.statusLine),
          })
          const children =
            record.children.length === 0
              ? []
              : [
                  'pieces given under it:',
                  ...record.children.map((row) => line(row) + ownerWords(row)),
                ]
          // ⚑ **D-023 · R1 — a root's resources are listed as any piece's are**, with their roles.
          const resources = record.resources.map((one) => ({
            resource: one.resource,
            name: one.name,
            role: one.role,
            bytes: one.bytes,
            sha256: one.sha256,
            title: one.title,
            summary: one.summary,
          }))
          /**
           * Its resources by what each is to it: the inputs it was handed, what was made for it, and
           * what its answer handed back (the reply's ids, {@link PieceRow.resources}).
           */
          const resourcesByRole = (handedBack: readonly string[]): string[] => {
            if (record.resources.length === 0) return []
            /** `res_… (name)`, {@link resourcesNamed}'s one spelling, a file at a time. */
            const fileNamed = (one: (typeof record.resources)[number]): string =>
              resourcesNamed([one])
            const back = new Set(handedBack)
            const inputs = record.resources.filter((one) => one.role === 'input')
            const answered = record.resources.filter(
              (one) => one.role !== 'input' && back.has(one.resource),
            )
            const made = record.resources.filter(
              (one) => one.role !== 'input' && !back.has(one.resource),
            )
            return [
              [
                ...(inputs.length === 0 ? [] : [itsInputs(inputs.map(fileNamed))]),
                ...(made.length === 0 ? [] : [whatWasMadeForIt(made.map(fileNamed))]),
                ...(answered.length === 0
                  ? []
                  : [handedBackWithItsAnswer(answered.map(fileNamed))]),
                READ_ONE_WITH_READ_DOCUMENT,
              ].join(' '),
            ]
          }
          if (record.is === 'a-root') {
            // ⚑ **R1 — a root is its title, its status line, its children and its resources**: its
            // state is its conversation's, which `get_agent_status` says.
            return answer(
              {
                outcome: 'ok',
                ...rootPayload(record.root),
                owner: record.root.owner,
                children: record.children.map(childPayload),
                resources,
                rows_unread: record.rowsUnread,
              },
              [
                rootText(record.root, me).trimStart(),
                ...(children.length === 0 ? [] : [children.join('\n')]),
                ...resourcesByRole([]),
                ...unreadLines(record.rowsUnread, record.ledgersSkipped),
              ].join('\n\n'),
            )
          }
          const piece = record.piece
          const nameOf = (who: AConversation): string => called(who.conversation, who.about ?? null)
          return answer(
            {
              outcome: 'ok',
              ...payload(piece),
              brief: piece.brief,
              // ⚑ **D-012 · the last exchange with the conversation holding it, whole** — the
              // `read_transcript` shape.
              last_exchange: {
                received:
                  record.lastExchange.received === null
                    ? null
                    : receivedPayload(record.lastExchange.received),
                answer:
                  record.lastExchange.answer === null
                    ? null
                    : wordsPayload(record.lastExchange.answer),
                ...(record.lastExchange.sinceThenItsProviderStartedATurn === true
                  ? { since_then_its_provider_started_a_turn: true }
                  : {}),
              },
              open_questions: record.openQuestions,
              children: record.children.map(childPayload),
              resources,
              rows_unread: record.rowsUnread,
            },
            [
              line(piece).trimStart(),
              `Its brief:\n${piece.brief}`,
              // ⚑ **D-016 · commit 7 · R3 — its holder by its NAME**: the piece names the conversation.
              transcriptText(
                host.whatToCallTheConversation(piece.owner),
                record.lastExchange,
                [],
                false,
                nameOf,
              ),
              ...(record.openQuestions.length === 0
                ? []
                : [
                    `Questions its owner asked about this piece that are still open: ${record.openQuestions.join(', ')}.`,
                  ]),
              ...(children.length === 0 ? [] : [children.join('\n')]),
              ...resourcesByRole(piece.resources),
              ...unreadLines(record.rowsUnread, record.ledgersSkipped),
            ].join('\n\n'),
          )
        }),
    },
    {
      name: 'answer_question',
      handlerOwnsMissingInput: true,
      description:
        // ⚑ **679 · *the id and the asker*** — what the question's own words hand the caller since
        // `679` (`questionText`); *"the id to quote"* was the whole of it while an id named one question.
        `Answer a question you are asked — by a conversation you started, or by an agent that asked you by name — or say you cannot, with cannot_answer and why. The app sends you the question, the id to quote and the asked_by beside it; a request that is a person’s to settle is refused by name and no retry will pass. Your own words in one answer, or your reason, may be at most ${String(REPLY_SUMMARY_LIMIT)} units: put anything longer in a file and name its full path. By default an asker you started, or one started under it, reads your answer — or your reason — at once: if it is in the middle of a turn, that turn is ${ASKED_TO_STOP} for it, and no person is asked to approve that. On Claude, the command that turn is waiting on ends with it, and work it sent to the background keeps running; on Codex, the command that turn ran last ends with it unless it has used another tool since, and its other commands keep running. Its other questions stay open. A turn that waits on someone's answer, or that a person's own words started, is not interrupted. Give interrupt: false to let it finish that turn first. Any other asker reads your answer when its running turn ends.`,
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **An answer into a conversation the caller started.** `QUESTION_RAILS` refuse the one class that is a person's — `a-person-answers-this-one` — so the authority question is already answered by a rail.
       *
       * ⚑ **And so is the stop an answer asks for, with no card for it.** It reaches only an asker
       * the answerer may interrupt, is not asked of a turn that waits on a card or that a person's
       * own words opened, and keeps the asker's background work and its other questions; the asker
       * asked so that it could go on. A card would hold the answer for a person's click, which is
       * the wait the stop is there to end. ⚠️ `interrupt_agent`, and `message_agent` with
       * `interrupt`, keep theirs.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries({
          [ANSWER_QUESTION_ARGUMENT]: z
            .string()
            .describe('The question id, exactly as the app gave it to you.'),
          // 🔴 **679 · the one field that can tell two questions under one id apart** — see
          // {@link AnswerQuestionArguments.asked_by}. ⛔ *"Nothing else names it"* stood on the line
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
              `false lets the asker finish the turn it is running before it reads your answer — for an answer it can use later; a turn can run for hours. Left out, or true: an asker you started, or one started under it, has its running turn ${ASKED_TO_STOP} so that it reads your answer now, unless that turn waits on someone's answer or a person's own words started it. On Claude, the command that turn is waiting on ends with it, and work it sent to the background keeps running; on Codex, the command that turn ran last ends with it unless it has used another tool since, and its other commands keep running. Its other questions stay open. Any other asker reads your answer when its running turn ends, whatever this says.`,
            ),
          // 🔴 **477 · `satisfies` is the rail here, not a tidy-up** — see
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
          // ⛔ **679 · refused rather than ignored.** An `asked_by` that is not a name would
          // otherwise fall back to the id alone — the lookup it was written to narrow.
          if (askedBy !== undefined && (typeof askedBy !== 'string' || askedBy.length === 0)) {
            problem('asked_by', 'send the asking conversation as non-empty text, or leave it out')
          }
          // ⛔ **Validated here because the shape is this tool's, and refused rather than repaired.**
          // `325`'s rule: a vocabulary the validator has not been taught is a refusal, never a pass.
          // ⚠️ Nothing below decides whether the ANSWER fits the question — that is
          // `answerToForward`'s, one package over, and a second copy of it here would be the rule in
          // two places with the far copy free to drift.
          const answers: { part: string; answer: string[] }[] = []
          // 🔴 **D-009 · an answer, or a reason there is none — one of the two.**
          const cannot = args[ANSWER_CANNOT_ARGUMENT]
          if (cannot !== undefined) {
            // ⚑ Its length is the host's to refuse (`answer-too-long`), on the bound an answer's
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
              // ⚠️ **`chosen`, not `answer`** — `answer` is this file's payload helper, and a local
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
          // ⛔ **Not one rail is asked here.** Whose question this is, whether it is a question at
          // all, and whether anybody is still waiting are all the host's — the module note's rule.
          // 🔴 **D-016 · commit 7 · R1 — `asked_by` takes the asker's piece label too**, read by the
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
              // ⚑ An answer stops the asker's running turn unless the answerer said not to.
              interrupt: interruptAsked !== false,
            },
            by,
          )
          if (!answered.ok) {
            const carried = carryQuestionRefusal(answered.refusal)
            return answer(carried, `refused (${answered.refusal.rail}): ${answered.refusal.reason}`)
          }
          // ⚑ **D-016 · commit 7 · R3 — the asker by the piece it owns**; the payload keeps its id.
          // ⚑ F033 · the one it asked the question under.
          const asker = host.nameByItsWorkUnder(answered.asked, answered.piece)
          // ⚑ **Held for the asker's reopen on the current sign-in, for a person's answer its turn is
          // stopped on, or (F074) for its provider's usage limit** — it does not have it yet, and
          // `why` says what it waits for. ⛔ W4.172 · never *"once it is reopened"* alone: a hold for
          // the limit alone reopens nothing.
          const why = host.whyWhatIsHeldWaits(answered.asked)
          // ⚑ What became of the stop, said when one was asked or when the answer waits behind a
          // turn that was not stopped — never of an asker that had no turn to stop. ⚑ By its name
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
          // ⚑ Held behind the asker's running turn, and that turn was not asked to stop.
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
              // 🔴 **The parts its question never asked, which did not reach the asker**
              // (`AnswerOutcome.notAsked`). ⛔ Always present, so an empty list is a measurement —
              // `list_tasks`' `rows_unread` rule. ⚑ Nothing is cut: a long answer is refused.
              not_asked: answered.notAsked,
              // ⚑ **D-017 · R1 — the asker could not be started now**: the answer waits for its next
              // start, and the sentence says why. ⚠️ Present only then.
              ...(answered.kept === undefined ? {} : { kept: answered.kept }),
              ...(stopped === null ? {} : stopped.structured),
            },
            // 🔴 **676 · F4 — a success that did not carry every part SAYS so**, rendered from the
            // parts (standing rule 8.2).
            // ⚑ **D-017 · R1** — and one that has not reached the asker yet says that instead of
            // *"has your answer"*: the question is closed, and the words wait for its next start.
            stopped === null ? said : `${said} ${stopped.said}`,
          )
        }),
    },
    {
      name: 'interrupt_agent',
      /**
       * ⚠️ **`reason` is required and is not recorded.** It makes the
       * caller state an intent before it destroys work in flight, which is the whole of what a
       * required argument buys here. ⛔ **Putting it in the ledger would be prose a model wrote in
       * an event whose own vocabulary refuses that** — `UserCommandEvent` carries *"a verb and at
       * most a short object, and never any text"*, and `work_interrupted` is its neighbour. A
       * reason worth keeping is a task, and this app already has one of those.
       *
       * ## 🔴 484 · and until this dispatch the description did not SAY that (HO-031 §2.2 part A)
       *
       * ⛔ **The PO's ruling: *"`interrupt_agent.reason` either reaches the agent or it does not,
       * and the description must say which… If `reason` is metadata, say so in the description
       * rather than leaving a name that implies a channel."*** ⚠️ BroBot spent a section of its
       * report on the question and could not settle it — *"the description never says the agent is
       * told anything, and the name suggests a log field"* — and wrote an experiment to find out.
       *
       * 🔴 **The answer off the code is narrower than either option it drafted.** It is not a
       * delivery channel and it is not metadata either: {@link RuntimeHost.interruptAgent} takes an
       * id and a caller and nothing else, so the string is read by the length check on the line
       * above and by nothing in this app afterwards. ⚑ **It reaches no agent and no row**, and the
       * description now says both halves — *the app opens the hole and only the app can close it*
       * is standing rule 15, and the honest close here was the sentence rather than a channel
       * nobody asked for.
       *
       * ⚠️ **The UI half of BroBot's evidence agrees and is now a test rather than an inference.**
       * A person's Stop produces `work_interrupted` carrying no text and then a SEPARATE
       * `user_turn` — *"so even in the UI, interrupting and speaking are two acts"* — which is why
       * the sentence points at `message_agent` rather than offering to carry the words.
       */
      /**
       * 🔴 **629 · *an agent you created* was the whole reach and is not any more** (`HO-095` §4).
       *
       * ⛔ **The ruling:** *any agent above another in the spawn chain may interrupt it* — so this
       * verb reaches a conversation one of YOUR conversations started, however many hops down.
       * ⚠️ **Standing rule 8.1**: a description that went on saying *you created* would instruct a
       * model not to try the act this app now admits — `402`'s defect pointed the other way.
       *
       * ⛔ **It does not name the grant, the chain's depth or how the app records it** (HO-015 §2,
       * standing): the sentence says which agents, and `list_agents` is where the ids come from.
       *
       * 🔴 **695 · R35 — *thrown away* is the TURN's work, not its background work.** Until 695 the
       * sentence said *"whatever it was part-way through is thrown away"*, and on Claude that was
       * true of a backgrounded agent or workflow too: the CLI killed them on an interrupt it had not
       * been told a person could stop them one by one. ⚑ The launch now declares that
       * (`perTaskStopAffordance`), so they survive this call — measured by `probe:per-task-stop` —
       * and background commands survived it already on both providers (Codex:
       * `background-terminals.ts`). ⛔ A description that went on saying *thrown away* would tell a
       * model its sub-agents are gone when they are still running and still billing.
       *
       * 🔴 **720 · `709` F-9 — it ASKS the turn to stop, and says where to read what happened.**
       * ⛔ Until `720` the third sentence promised that the turn *"is cut short"*; since `709`
       * (R43) the ledger records the provider's own word, and Codex can finish a turn it was asked to
       * stop (`probe:codex-early-interrupt`), so the ledger could say `completed` beside that
       * promise. ⚑ Factory text instructs (standing rule 8): the sentence says what the call does —
       * it asks — and sends the model to `get_agent_status`, whose `lastEndedTurn` is rendered from
       * the ledger, for the outcome. The call's own answer already says *asked to stop* and the
       * state it is in now.
       */
      description:
        'Stop what an agent below you is doing right now — one you created, or one that those agents created in turn. Its conversation stays open and it can be given something else. It asks the turn it is in to stop: that turn may end there, throwing away whatever it was part-way through, or it may be finished anyway — once the agent is no longer working, get_agent_status says which, so read it there before you rely on either. The stop also ends commands that turn started: on Claude, the command it is waiting on, while work it sent to the background keeps running; on Codex, every command that turn started, even one it left running. A command an earlier turn left running keeps running. The answer names what the stop ended, once that turn has ended, and what still runs. The agent is not told who stopped it or why — only, the next time it is sent words, which of its commands the stop ended: to stop its turn and tell it why in one act, use message_agent with interrupt.',
      /**
       * 🔴 **486 · a person is asked as well** (HO-031 §2.4).
       *
       * ⛔ **Its own description says it: the turn is asked to stop, and what it was part-way through is thrown away unless it is finished anyway** (`720`, `709` F-9). ⚠️ `INTERRUPT_RAILS` refuse the case where cutting the turn would answer a person's card, and only an agent above it in the spawn chain may ask — rails, both, answering *may you*.
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
          // 🔴 **D-016 · commit 7 · R1 — a label names its piece's owner** when this caller may reach
          // it or stop it — the chain below it, however many hops down, as an id is stopped; one that
          // names nothing it may reach meets `no-such-agent` as an unknown id does.
          const addressed = host.theConversationAddressed(agent, by, me, 'interrupting')
          // 🔴 **F091 · that is this conversation** — its own id, a piece it holds (a label names its
          // owner), or one it took the place of, whose place it now stands in: `message_agent`'s word
          // for the same address, with the acts an interrupt has.
          if (addressed === me || host.tookItsPlace(addressed) === me) {
            return selfRefusal(agent, addressed, {
              ...refuseTool('that-agent-is-you', { agent: addressed }),
              reason: A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
            })
          }
          // ⚠️ **Every refusal arrives as a value, so there is no catch** (395): an interrupt that
          // failed for any other reason is a bug, and reporting one as a refusal would tell a model a
          // person could fix it.
          const outcome = await host.interruptAgent(addressed, by)
          if (!outcome.ok) {
            // ⚑ **Two vocabularies meet here and neither is rewritten.** `'no-such-agent'` is
            // `TOOL_REFUSALS`' word — the same one every door gives about an id no conversation has
            // — and everything else is an `INTERRUPT_RAILS` payload carried unchanged.
            if (outcome.refusal === 'no-such-agent') {
              return refusalAnswer(refuseTool('no-such-agent', { agent: addressed }))
            }
            const carried = carryInterruptRefusal(outcome.refusal)
            return answer(carried, `refused (${outcome.refusal.rail}): ${outcome.refusal.reason}`)
          }
          // 🔴 **`asked`, and the sentence says what was asked rather than what happened.** ⛔ A
          // model told *"stopped"* would believe the child had finished, which is false on Codex
          // whenever the app-server has not yet sent its own terminal — see
          // {@link RuntimeHost.interruptAgent}. ⚑ `state` is what the conversation is doing now, so
          // a caller that needs to know can look, and `get_agent_status` answers the same field.
          //
          // ⚠️ **492 · the claim is now shared bytes rather than a habit** (HO-032 §1 · criterion
          // 20). ⛔ **A person's Cancel on a permission card performs this same act**, and the card
          // said *"the whole turn is interrupted"* while this verb said *asked* — one act, two
          // claims, and HO-030 §2's argument is that the difference teaches a reader to stop
          // reading. ⚑ {@link ASKED_TO_STOP} is the clause both compose from; the subjects stay
          // each surface's own, because one is read before a press and the other after one.
          //
          // ⚑ **D-017 — a conversation no turn was running in was asked NOTHING**, and `asked: true`
          // would be the claim this note exists to keep honest. ⚑ **Either way its state is the one
          // derivation's** (`get_agent_status`'s words), never a word of this door's — and the clause
          // fits every state it can be, *needs you* included.
          const now = agentStateWords(outcome.state)
          // ⚑ **D-016 · commit 7 · R3 — named by the piece it owns**; the payload keeps its id.
          const called = host.nameByItsWork(outcome.agent)
          // ⚑ **F084 · what the stop ended, and what is still running in its background, named**, on
          // either arm: a caller stopping work to free the machine reads what still uses it and the
          // one door that ends it from here — the agent itself, asked. ⚠️ Branches of their own, so
          // the two ordinary answers below stay as they were.
          // ⚠️ Absent when the stopped turn had not ended within the wait: unknown, so not said.
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
    },
    {
      name: 'list_questions',
      handlerOwnsMissingInput: true,
      description:
        // ⚑ **679 · the last clause names `asked_by` beside the id** — each row carries both, and two
        // rows can share an id (`675` F-b), where the id alone is refused.
        'Questions waiting on you — from the conversations you started, and from any agent that asked you by name — with the words to answer. The ones that are over are counted and not listed: state: "ended" or "all" lists them too, newest first and as many as limit says, each with how it ended and without its words. Each one also reaches you as a message, and this app starts you for it if nothing is running in you; it stays here until it is answered or ends. Answer one with answer_question, quoting its id — and its asked_by too when another row shares that id.',
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **A reader of what is waiting on the caller**: its arguments choose how much of it is
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
          // ⛔ **No argument names anybody, and no rails**, as for `list_tasks`' board: there is
          // nobody to name, so nobody to refuse. ⚑ `me` is minted by this toolset from the session
          // it was built for and cannot be handed another — which is the entitlement, and it is
          // structural rather than checked.
          // 🔴 **676 · the counted read** — `RuntimeHost.questionsListedFor`.
          const listed = host.questionsListedFor(me)
          const waiting = listed.questions
          const open = waiting.filter((one) => REQUEST_IS_OPEN[one.request.state])
          // 🔴 **403 · the count is SPLIT, and it was a false sentence until it was** (§4).
          //
          // ⛔ **`N waiting on you` counted every open row, and a permission-shaped one is not
          // waiting on this caller at all.** Every spawned child is `ask` by rail, so a parent
          // whose worker has parked on three approvals was told *"3 waiting on you"* about three
          // rows `answer_question` refuses it BY NAME — and the only door out of that is a person.
          // ⚑ The per-row line has said `a person answers this one` since `396`; what was wrong
          // was the number above it, which is the half a model reads first.
          //
          // ⚠️ **The rows themselves are NOT narrowed**, which is `394` §2 unchanged: a parent may
          // see that a request exists, may not have its words, and may not answer it.
          //
          // 🔴 **611 · the split is the REFUSED arm, and it used to be `because === null`**
          // (HO-088 §2.3). ⛔ A question an asker ADDRESSED to a person is still this caller's to
          // answer — `admitAnswer` admits it — so counting it on the other side would put a row a
          // model may act on under a heading telling it not to. ⚑ The per-row line says the row is
          // addressed elsewhere; the COUNT says what may be answered, which is `403`'s own
          // distinction one arm further out.
          const yours = open.filter(
            (one) => one.request.went.is !== 'the-person-the-channel-left-it-with',
          )
          // ⛔ **Counted independently of `yours`, so the two halves are separable** — a change to
          // one must not silently move the other.
          const aPersons = open.filter(
            (one) => one.request.went.is === 'the-person-the-channel-left-it-with',
          )
          // 🔴 **Requests are counted; CONVERSATIONS are what is frozen, and they are not the same
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
          // ⚑ What is waiting, counted whichever listing was asked for: it is the half a model
          // reads first.
          const standing = `${
            yours.length === 0
              ? 'nothing is waiting on you'
              : `${String(yours.length)} waiting on you`
          }${
            aPersons.length === 0
              ? ''
              : // ⛔ **The child is FROZEN, and saying so is the point of the clause.** A
                // parent told only that something is *"a person's"* has no reason to stop
                // waiting on the work; `open` means nothing in the ledger has ended it and
                // the provider is still holding the tool call. ⚠️ It names no actor and no
                // deadline — HO-018's principle is that the parent decides what to do.
                `; ${String(aPersons.length)} waiting on a person, not on you — ${
                  frozen === 1
                    ? 'that conversation is'
                    : `those ${String(frozen)} conversations are`
                } frozen until somebody decides`
          }`
          return answer(
            {
              outcome: 'ok',
              listed: asked.listing,
              questions: [
                ...listing.whole.map(questionPayload),
                // ⚑ One that is over carries how it ended and none of its words.
                ...listing.ended.map(endedQuestionPayload),
              ],
              // ⚑ What the list leaves out, counted by state. ⛔ Always present: `{}` says nothing
              // was left out.
              not_listed: notListed,
              // 🔴 **676 · the count, IN the payload** — `list_tasks`' `rows_unread`, one tool over.
              // ⛔ Always present, so `0` is a measurement. ⚠️ Not yet in the words: that sentence
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
              // ⚑ **676 · the count in the words too, whichever branch answered** — an empty list is
              // exactly when a torn routing may be the question that is missing.
              ...(listed.rowsUnread === 0 ? [] : [unreadQuestionRowsSentence(listed.rowsUnread)]),
              ...whenSkipped(listed.ledgersSkipped, skippedQuestionRecordsSentence),
            ].join('\n'),
          )
        }),
    },
    {
      name: 'create_agent',
      /**
       * 🔴 **456 · the other half of the pair.**
       *
       * ⚑ **Create-then-give composes for every caller** (D-014): any agent may give work to any
       * agent this app holds, so a name made here is one the caller may give work to at once, and
       * the description says nothing about a grant. ⚑ **D-016 · R3** — `give_work`'s `new` makes an
       * agent too, with no rules; this verb is the one for an agent with standing rules.
       *
       * ⛔ **The clause that was never there.** `445`'s Claude arm sent
       * `{profile_slug: 'project-manager', role: 'DEV-75297'}` — `role` was an argument then — and met
       * `malformed-request`: the model was carrying a PURPOSE — every spawn took one then — and this
       * verb advertises no field for it, so the purpose landed in the only free-shaped optional
       * beside the name. ⚠️ **The schema invited it**, and the remedy was a clause rather than a
       * column: the place a purpose belongs is the conversation.
       *
       * ## 🔴 618 · *a name and nothing else* is no longer true, and `HO-078` §4 is why
       *
       * ⛔ **This sentence read *"a name, and nothing else… no purpose is recorded — a purpose
       * belongs to a conversation"*** — and the first clause is now false: creation takes the new
       * identity's own instructions, *"what it is for, the operating model it works under,
       * whatever scoping the creator can give it."*
       *
       * ⚠️ **The clause `445` bought had to survive the change that made it false**, because a
       * free-shaped optional is exactly what that arm reached for. 🔴 **So the description now
       * draws the line rather than denying the field**: a purpose is the job you give a
       * CONVERSATION; rules are what this agent IS in every conversation it runs. ⛔ **That is a
       * sentence and sentences only ask** (standing rule 8.3) — the thing a rail could enforce here
       * is the BOUND, which is asked before anything is minted.
       */
      description:
        'Bring a new agent into existence: a name, and optionally the standing rules it works under. No conversation is started, nothing is sent, and no purpose is recorded — the job goes in a piece of work you give it with give_work, while rules are what this agent is in every conversation it ever runs. This app gives the new agent its human name and tells you what it chose, so there is nothing to decide and nobody to ask. Returns the agent that now exists, or a refusal naming the rule that stopped it. Name model and effort to give it a default: what its new conversations start on.',
      /**
       * ⛔ **Advertised against a TYPE, so *documented* and *read* cannot drift apart** — `415`'s
       * device, and the `satisfies` below fails to compile if this shape and
       * {@link CreateAgentArguments} stop naming the same set, in either direction.
       */
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **A row in this app's own table, and the grant is the gate.** ⛔ Every agent holds `canCreateAgents` by default (D-014), a person narrows it at the sheet, and the kill switch is asked in front of it. ⚠️ **A card here would be a second answer to a question a person has already answered**, which is 031's approval-fatigue finding in its purest form.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: {
        profile_slug: z
          .string()
          .describe(
            `The name the agent will be known by — ${PATH_SEGMENT_RULE}. It is compared without ` +
              'case, and a name that is already an agent is refused rather than reused. It is the ' +
              'same value give_work takes as profile.',
          ),
        /**
         * ⚠️ **The published enum and the door's validator are deliberately two layers** (`490`).
         * The shared schema advertises the closed vocabulary but preserves an unknown original
         * value, so the all-at-once structured refusal below still names what the caller may send.
         */
        provider: documentedToolEnum(
          TOOL_INPUT_ENUMS['create_agent:provider'],
          'Which provider its conversations run on. It is kept: no give changes it.',
          'Omit it to take the provider of the model you name, else yours.',
        ).optional(),
        /**
         * 🔴 **618 · `HO-078` §4, and the sentence has three jobs** (`HO-078` §1.1, §4.1, §4.3).
         *
         * ⛔ **It says what the text IS** — standing rules, at the start of every conversation —
         * so a model carrying a PURPOSE has somewhere else to put it (`445`'s arm, and the
         * description states the line).
         * ⛔ **It says the write happens ONCE**, which is `HO-078` §1.1 as a fact about this door
         * rather than a hope: after creation the text is the person's.
         * ⛔ **It says omitting it is ordinary**, which is `HO-078` §4.3 — an optional argument
         * that reads like an expectation is `584`'s measured defect on `display_name`, where
         * *"Omit if you have nothing better"* sent a model to ask a person.
         *
         * ⚠️ **It names NO sibling verb, and that is measured rather than stylistic.** Every agent
         * holds `canWriteRules: 'none'` by default, so a clause pointing a caller at
         * `propose_agent_rules` would send every caller on a fresh install to a door that answers
         * `may-not-write-rules`. 🔴 **That is `456`'s defect exactly**, and `456`
         * measured it costing eleven of twelve live arms.
         */
        rules: z
          .string()
          .describe(
            'The standing rules this agent works under — the text it is given at the start of every conversation it runs, for as long as they stand. ' +
              `At most ${String(OWN_INSTRUCTIONS_CHARS)} characters. ` +
              'This is what the agent IS, not the job you are about to give it: a job goes in a piece of work you give it with give_work. ' +
              'You may write these only here, as you create it — after this they belong to the person, who can change them, put an earlier version back, or take them away. ' +
              'Leave it out if you have none; an agent created without rules is the ordinary case and works exactly as it always has.',
          )
          .optional(),
        model: z
          .string()
          .optional()
          .describe(
            'The model its new conversations start on — its default — from the list a person keeps for its provider (provider; without it, the provider whose list holds this model, else yours). Leave it out and they start on the model a person last picked for that provider, else the provider\u2019s default.' +
              theModels,
          ),
        effort: z
          .string()
          .optional()
          .describe(
            'The reasoning effort its new conversations start at, one that model offers.' +
              theEfforts,
          ),
        kind: documentedToolEnum(
          TOOL_INPUT_ENUMS['create_agent:kind'],
          'What kind of agent it is, set when it is made.',
          'A service can be made only while a person has services on.',
        ).optional(),
      } satisfies Readonly<Record<keyof CreateAgentArguments, z.ZodType>>,
      call: (args) =>
        guarded(async () => {
          // 🔴 **486 · THE STANDING WALL FIRST, and this line is HO-031 §2.5** — *entitlement
          // before argument shape*.
          //
          // ⛔ **The PM met this exact wall as `malformed-request · permanent`.** `445`'s Claude arm
          // sent `{profile_slug:'project-manager', role:'DEV-75297'}` — `role` was an argument
          // then, and that value was not one of its words — so the
          // block below answered first — and the app's own instruction to its agents, *read a
          // permanent refusal rather than retrying it*, then pointed at the false conclusion *my
          // arguments are permanently malformed*. 🔴 **The real rail was `may-not-create-agents`,
          // `until-a-person-changes-it`, and it was only ever discovered because the PM disobeyed
          // that instruction.**
          //
          // ⚑ **It reads none of `args`, and that is what makes it safe above the block.**
          // {@link RuntimeHost.mayCreateAgents} asks the kill switch and `canCreateAgents` and
          // nothing else, so its answer is byte-identical for a `profile_slug` that names an
          // existing identity, one that names nothing, and one that is not a string at all —
          // `341`'s *entitlement before existence* preserved while the order changes around it. ⛔
          // **The NAME is still asked last**, by `createAgentFor`, behind both.
          //
          // ⚠️ **What it costs, said out loud**: an unentitled caller no longer gets the
          // all-at-once `problems` list below. ⚑ That is the trade HO-031 §2.5 asks for — a caller
          // that may not create an agent has no use for a list of the arguments it would have
          // needed, and the list it used to get was the sentence that sent it the wrong way.
          // ⚑ **598 · `ok` and no longer `!== null`** (`HO-084` §1). ⛔ The admitted arm carries the
          // caller now, so this door reads a discriminant rather than an absence — and this layer
          // still spends NOTHING but the refusal, because who is creating is the WRITER's question
          // and `createAgentFor` is the only place it is answered. ⚠️ **Written ABOVE the pair**,
          // because `486 M9` anchors on the two statements as contiguous code and a comment between
          // them would take that row dark (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
          const wall = host.mayCreateAgents(me)
          if (!wall.ok) return refusalAnswer(refuseTool(wall.rail, wall.detail))
          // ⛔ **Every problem at once, never the first one** (325). A model that has to discover
          // three malformed arguments one round trip at a time is a model spending three turns on
          // one call, and the refusal is permanent for each of them anyway.
          const problems: string[] = []
          const slug = args[CREATE_SLUG_ARGUMENT]
          if (typeof slug !== 'string' || !isPathSegment(slug)) {
            problems.push(`${CREATE_SLUG_ARGUMENT} is required and must be ${PATH_SEGMENT_RULE}`)
          }
          const provider = args[CREATE_PROVIDER_ARGUMENT]
          if (provider !== undefined && !providerSchema.safeParse(provider).success) {
            problems.push(
              `${CREATE_PROVIDER_ARGUMENT} must be one of ${providerSchema.options.join(', ')}, or left out`,
            )
          }
          // 🔴 **618 · the BOUND, here and not one statement later** (`HO-078` §4.2).
          //
          // ⛔ **Above the mint, so a refused creation creates nothing.** A length asked after
          // `createAgentFor` would leave a durable identity behind and then refuse — the one
          // outcome criterion 12 exists to prevent, arriving through the argument that was supposed
          // to enrich it.
          //
          // ⚠️ **BELOW the entitlement wall, and that order is HO-031 §2.5** — an unentitled caller
          // sending 20,000 characters meets `may-not-create-agents` and never learns that this
          // field has a bound. ⚑ `refuse-on-entitlement-before-refusing-on-existence` is preserved
          // because the wall reads none of `args`.
          //
          // ⛔ **`malformed-request` and not a rail of its own**, which is `propose_agent_rules`'
          // own answer to the same bound on the same layer: the refusal is `permanent`,
          // `retryable: false`, and carries the field name and the number in `problems` — a reason
          // a model can classify rather than a transport error (`307`).
          //
          // ⚑ **No `.length === 0` check**, for that door's reason one verb over: an empty string is
          // a real request meaning *this agent has no rules*, and a version saying so has a date and
          // an author.
          const rules = args[CREATE_RULES_ARGUMENT]
          if (
            rules !== undefined &&
            (typeof rules !== 'string' || rules.length > OWN_INSTRUCTIONS_CHARS)
          ) {
            problems.push(
              `${CREATE_RULES_ARGUMENT} must be a string of at most ${String(OWN_INSTRUCTIONS_CHARS)} characters, or left out`,
            )
          }
          // ⚑ **D-042 · the default's two halves, shaped as the give's door shapes them.**
          const model = args[CREATE_MODEL_ARGUMENT]
          if (
            model !== undefined &&
            (typeof model !== 'string' || model.trim() === '' || model.length > 120)
          ) {
            problems.push(
              `${CREATE_MODEL_ARGUMENT} must be a model's name of at most 120 characters, or left out`,
            )
          }
          const effort = args[CREATE_EFFORT_ARGUMENT]
          if (
            effort !== undefined &&
            (typeof effort !== 'string' || effort.trim() === '' || effort.length > 60)
          ) {
            problems.push(
              `${CREATE_EFFORT_ARGUMENT} must be an effort's name of at most 60 characters, or left out`,
            )
          }
          const kind = args[CREATE_KIND_ARGUMENT]
          if (kind !== undefined && kind !== 'normal' && kind !== 'service') {
            problems.push(`${CREATE_KIND_ARGUMENT} must be one of normal, service, or left out`)
          }
          if (problems.length > 0) {
            return refusalAnswer(refuseTool('malformed-request', { problems }))
          }
          // 🔴 **D-042 · R4 — the default it names, judged by the one seam** (`model-rails.ts`: the
          // list, then the model's efforts) — ⛔ above the mint, so a refused default creates nothing.
          let itsDefault: AgentModelChoice | null = null
          if (model !== undefined || effort !== undefined) {
            const judged = await host.judgeTheDefaultItNames(
              me,
              provider === undefined ? null : (provider as Provider),
              {
                ...(model === undefined ? {} : { model: model as string }),
                ...(effort === undefined ? {} : { effort: effort as string }),
              },
            )
            if (!judged.ok) {
              return answer(
                { ...judged.refusal },
                `refused (${judged.refusal.rail}): ${judged.refusal.reason}`,
              )
            }
            itsDefault = judged.chosen
          }
          const said: NewAgent = {
            slug: slug as string,
            // 🔴 **584 · ALWAYS null from this door, and that is the ruling rather than a default**
            // (`HO-078` §5). ⛔ There is no argument to read: the app assigns the name inside
            // `SessionStore.createAgentIdentity`, which falls through to `human-names.ts` for
            // exactly this value. ⚑ **`NewAgent` keeps the field because the PERSON's door still
            // fills it** — `NewAgent.vue` sends what somebody typed — so the two creation doors
            // differ in what they may say rather than in what the store does with it.
            displayName: null,
            provider: provider === undefined ? null : (provider as Provider),
            ...(kind === 'service' ? { asAService: true as const } : {}),
          }
          // ⛔ **The rails are the HOST's, and this file asks none of them** — the module note's
          // whole design. `createAgentFor` answers the switch, the grant and the name, in that
          // order, and hands back the word this layer turns into a payload.
          // ⚑ **618 · `null` and not `undefined` across the boundary**, so the host's parameter is
          // required and there is no default for a call site to fall through
          // (`a-default-no-call-site-reaches`): *nobody sent any* is a value this door computes,
          // once, from the only argument that can say it.
          const outcome = host.createAgentFor(
            me,
            said,
            by,
            rules === undefined ? null : (rules as string),
            itsDefault,
          )
          if (!outcome.ok) return refusalAnswer(refuseTool(outcome.rail, outcome.detail))
          // ⚑ **D-014 · the answer says nothing about starting it**, because nothing stands in the
          // way: any agent may start a conversation as any agent this app holds. ⛔ Until then a last
          // sentence here told the caller which grant would admit the name — `456` measured twelve
          // live arms obeying a false version of it.
          //
          // 🔴 **584 · the answer NAMES what this app called it** (`HO-078` §5), and that is the
          // half that keeps *no round trip* true. ⛔ **A door that assigns silently is a door a
          // model has to ask about**: the caller would have nothing to put in the message it writes
          // next, and asking the person is exactly what `HO-078` §5.1 measured costing a run.
          //
          // The app gives every agent it creates a name, except BroBot's own slug, which goes by
          // BroBot; the sentence says which, so a caller never reports a name this app never gave.
          const named = outcome.identity.displayName
          // 🔴 **618 · what the RULES did, computed from the outcome and said in both halves**
          // (`a-report-must-be-computed-from-the-outcome`, and `489`/HO-031 §2.6's one
          // composition).
          //
          // ⛔ **A key that is ALWAYS there, never an absent one meaning *none*.** An answer whose
          // *nothing was written* is the absence of a field is
          // `an-unenumerated-state-counts-as-success` — a caller reading its own argument back
          // instead of this app's answer is exactly the drift this pair exists to stop.
          //
          // ⚑ **Whether rules were written is READ off the outcome rather than off the argument.**
          // The version number (1 on every path this door can take) is not said.
          const wrote = outcome.rules
          return answer(
            {
              outcome: 'ok',
              agent: outcome.identity.slug,
              identity: outcome.identity.id,
              ...(named === null ? {} : { display_name: named }),
              rules: wrote === null ? 'none-given' : 'written',
              ...(outcome.defaultModel === null ? {} : { default_model: outcome.defaultModel }),
            },
            // Read off the outcome, never echoing the call: the name this app chose, that nothing
            // was started, its default, and whether its rules are saved.
            `${named === null ? CREATED_UNDER_ITS_PROFILE_NAME : createdAndNamed(named)} It is not running and has been sent nothing.${
              // ⚑ **D-042 · R2 — the default it now has, read back**.
              outcome.defaultModel === null
                ? ''
                : ` Its new conversations start on ${aPairInWords(outcome.defaultModel)}.`
            }${wrote === null ? '' : ` ${ITS_RULES_ARE_SAVED}`}`,
          )
        }),
    },
    {
      name: 'withdraw_task',
      // ⛔ **It says what it does NOT do, because the other way out of open work destroys
      // something** and a model that has learned `interrupt_agent` will read this as a second one
      // unless told otherwise. ⚑ HO-023 §4.3 is the sentence in product words:
      // *"withdraw then reassign is legitimate; reassign without withdrawing is the duplicate."*
      // ⚑ **D-016 · ruling 8 — and the owner is told**, woken to hear it if nothing runs in it.
      // ⚑ **D-022 · R3 — at once or once its turn ends, and the answer says which.**
      description:
        'Take back a piece of work you gave, so it is no longer owed. The agent holding it is told — at once when it is free or has stopped (it is woken to hear it), else once its turn ends: the answer says which, and interrupt_agent asks that turn to stop. Nothing it is doing is stopped by this, and the pieces it gave under it stay its own to take back. A piece that has already ended — answered, or closed with update_work — cannot be taken back.',
      /**
       * ⛔ **Advertised against a TYPE, so *documented* and *read* cannot drift apart** (415's
       * device, `429`'s door) — see {@link WithdrawTaskArguments}.
       */
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **It stops nothing.** Its own description is written to say so: *nothing it is doing is stopped*.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: {
        piece: z
          .string()
          .describe(
            'The piece you are taking back — its label (W1.2) or its id, as list_tasks names it.',
          ),
      } satisfies Readonly<Record<keyof WithdrawTaskArguments, z.ZodType>>,
      call: (args) =>
        guarded(async () => {
          const piece = args[WITHDRAW_PIECE_ARGUMENT]
          if (typeof piece !== 'string' || piece.length === 0) {
            return refusalAnswer(
              refuseTool('malformed-request', {
                problems: [`${WITHDRAW_PIECE_ARGUMENT} is required`],
              }),
            )
          }
          // ⛔ **The rails are the HOST's and this file asks none of them** — the module note's
          // design, and `create_agent`'s shape one verb over. The host answers with a rail word and
          // the facts that rail may state; all that happens here is that they become a payload.
          const outcome = await host.takeBackPiece({ piece }, by)
          // 🔴 **F089 · a piece the caller HOLDS, said as what it is** — `not-a-piece-you-gave`, true
          // of it, with the act left. ⚑ The word's own sentence, whose guess is that the name may
          // belong to nothing, is kept for a name that is none of the caller's.
          if (
            !outcome.ok &&
            outcome.refused.rail === 'not-a-piece-you-gave' &&
            outcome.refused.itHoldsIt !== undefined
          ) {
            const held = outcome.refused.itHoldsIt
            const detail = takeBackDetail(piece, outcome.refused)
            if (held.is === 'its-root') {
              return refusalAnswer({
                ...refuseTool('not-a-piece-you-gave', detail),
                reason: aTakeBackOfYourOwnWork(held.label),
              })
            }
            if (held.is === 'open') {
              return refusalAnswer({
                ...refuseTool('not-a-piece-you-gave', detail),
                reason: aTakeBackOfAPieceYouHold(held.label),
              })
            }
            return refusalAnswer({
              ...refuseTool('not-a-piece-you-gave', detail),
              reason: aTakeBackOfAPieceYouHoldThatEnded(held),
            })
          }
          if (
            !outcome.ok &&
            outcome.refused.rail === 'a-conversation-with-its-questions-is-starting'
          ) {
            return refusalAnswer({
              ...refuseTool(outcome.refused.rail, takeBackDetail(piece, outcome.refused)),
              reason: aPieceNotEndedWhileAQuestionStarts(outcome.refused.label, 'work-withdrawn'),
            })
          }
          if (!outcome.ok && outcome.refused.rail === 'its-questions-could-not-all-be-read') {
            return refusalAnswer({
              ...refuseTool(outcome.refused.rail, takeBackDetail(piece, outcome.refused)),
              reason: aPieceNotEndedItsQuestionsUnread(outcome.refused.label, 'work-withdrawn'),
            })
          }
          if (!outcome.ok) {
            return refusalAnswer(
              refuseTool(outcome.refused.rail, takeBackDetail(piece, outcome.refused)),
            )
          }
          const owner = host.whatToCallTheConversation(outcome.owner)
          return answer(
            {
              outcome: 'ok',
              piece: outcome.piece,
              label: outcome.label,
              state: 'withdrawn',
              // ⚑ **Reported because the two arms differ in a way the caller can act on**: words
              // that never went out are words nobody has read.
              tookBackTheMessage: outcome.tookBackTheMessage,
              // ⚑ **591 · the same rule one fact over** — see {@link TakeBackOutcome.endedQuestions}.
              endedQuestions: outcome.endedQuestions,
              // ⚑ **D-022 · R3** — see {@link TakeBackOutcome.delivery}.
              delivery: outcome.delivery,
              ...(outcome.delivery === 'not-delivered' ? { whyNotTold: outcome.whyNotTold } : {}),
              ...(outcome.askedItsTurnToStop ? { askedItsTurnToStop: true } : {}),
            },
            `${outcome.label} is taken back — ${owner} no longer owes it${
              outcome.tookBackTheMessage
                ? ', and the message carrying it was taken back before it was sent'
                : ''
            }${theQuestionsItEnded(outcome.endedQuestions)}${
              outcome.askedItsTurnToStop ? '; its turn was asked to stop' : ''
            }. ${whatReachedItsHolder(
              owner,
              outcome.label,
              outcome,
              outcome.askedItsTurnToStop || outcome.atAService ? 'a-stop-asked' : 'a-stop',
              host.whyWhatIsHeldWaits(outcome.owner),
            )}`,
          )
        }),
    },
    {
      name: 'ask_question',
      handlerOwnsMissingInput: true,
      /**
       * 🔴 **The sentence states what this verb does to the WORK**, because that is the one thing a
       * model cannot infer from the others it has (437, standing rule 8).
       *
       * ⛔ **It has to be said against `reply_to_parent`**: a worker that needs a decision already
       * has a verb that reaches its parent, and that verb CLOSES the task — `outcome: 'blocked'`
       * settles it at `answered` like every other outcome. ⚠️ A model choosing between them is
       * choosing between *keep this work and wait* and *hand it back*, and nothing else in the
       * toolset draws that line.
       *
       * ⛔ **611 · it was `ask_parent`, and the name went with the ruling** (HO-088 §2). ⚑ The
       * first clause now says the verb asks for a decision rather than which conversation it
       * reaches, because WHICH is `who_answers` and a name that answered it would be a second
       * spelling free to disagree with the argument. ⚠️ **And the sentence says *say who answers
       * it* rather than naming a default**, which is the PO's ruling rendered rather than
       * described: the app does not default it, so the description cannot imply one.
       *
       * ⛔ **608 · it said *and wait for the answer* and that is now FALSE** (HO-084 §4, standing
       * rule 8.1). ⚑ **It says the call does NOT wait, because the call does not wait** — a verb
       * that returns without the thing its name promises, and does not say so, reads as a verb
       * that failed. ⚠️ **And it says where the answer goes**, which is the one fact a model cannot
       * derive from anything else it has: the answer arrives later as a message, so there is nothing
       * to sit and watch for.
       *
       * 🔴 **It does not say *you may end your turn*, and that is deliberate.** What an agent does
       * between asking and being answered is the agent's; a sentence telling it to stop would be
       * this app instructing rather than describing, and `HO-015` §2 is why the template layer does
       * not do that.
       *
       * ⚑ **It says an answer can ask the turn the asker is in to stop**, which `answer_question`
       * does by default for an answerer that may stop the asker — so a turn cut for an answer is
       * one the asker was told could be.
       */
      description:
        'Ask a question and get the answer back. Say who answers it: the conversation that gave you your work, a person, or another agent you name, by the piece it owns (W1.2) or its id. A question to the conversation that gave you your work or to a person is about a piece of work you are holding — your own conversation\u2019s work counts — so name the piece, or leave it out when you hold only one; the app knows who gave it to you, and a question about work a person gave you goes to a person. A question to another agent may name the piece it is about, or none. Any work stays yours and stays open — this is not reply_to_parent, which hands it back. This call does not wait: it returns as soon as the question is recorded and routed, and the answer reaches you later as a message, however long they take. An answer can ask the turn you are in to stop, so that you read it at once. On Claude, the command that turn is waiting on ends with it, and work you sent to the background keeps running; on Codex, the command you ran last in that turn ends with it unless you have used another tool since, and your other commands keep running. Your other questions stay open. If the one you asked cannot answer, or its conversation ends first, you are told that instead. withdraw_question takes a question back. Carry on from here.',
      /**
       * ⛔ **Advertised against a TYPE, so *documented* and *read* cannot drift apart** — see
       * {@link AskQuestionArguments}, including which addressee it does and does not take.
       */
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **A question about work this caller is holding**, and since `608` it holds nothing
       * open. `reply_to_parent`'s argument, one direction. ⚠️ **611 · addressing it to a person
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
              `What you need decided, in your own words, at most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters (UTF-16 code units). Nothing is shortened for you.`,
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
          // 🔴 **The SAME list `reply_to_parent` refuses, shared rather than copied** (437). ⛔ A
          // second list would be a rail with a typo in it the day either was extended.
          // ⚑ **D-009 · `agent` is now this tool's own argument**, so it is not one of the spellings
          // of *send it to this one* that are refused here.
          const aimed = REPLY_ADDRESSING_KEYS.filter(
            (key) => key !== ASK_AGENT_ARGUMENT && Object.hasOwn(args, key),
          )
          if (aimed.length > 0) {
            return refusalAnswer(
              refuseTool('malformed-request', {
                // 🔴 **611 · the sentence says what IS an argument now** (HO-088 §2.1, standing
                // rule 8.1). ⛔ It read *"a question goes to the conversation that gave you the
                // task"*, which was true until a question could be addressed to a person — and a
                // refusal that states a false fact about the mechanism is `HO-070` §3's *an agent
                // that stops asking*. ⚑ **The two ends are named**, because a model that tried to
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
          const problems: z.core.$ZodIssue[] = []
          const problem = (field: keyof AskQuestionArguments, message: string): void => {
            problems.push({ code: 'custom', path: [field], message })
          }
          const wrongType = (field: keyof AskQuestionArguments): void => {
            problems.push({
              code: 'invalid_type',
              path: [field],
              expected: 'string',
              message: 'expected text',
            })
          }
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
          // 🔴 **D-016 · commit 7 · R1 — a label names its piece's owner** when this caller may reach
          // it; one that names nothing it may reach is handed back as spelled, and meets this door's
          // own word for an agent it cannot ask, as an unknown id does.
          const addressed =
            who === 'an-agent' && typeof agent === 'string'
              ? host.theConversationAddressed(agent, by, me, 'messaging')
              : null
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
          // 🔴 **608 · ONE success, where `437` had two** (HO-084 §4). ⛔ `437` wrote two sentences
          // because the call could come back either answered or empty-handed, and *"nothing
          // unwired implies a working state"* (Slice 2 #7) meant those must not read alike. ⚑ **The
          // call no longer waits, so there is only one thing that can have happened**: the question
          // is recorded, routed and on its way, and the answer is a turn that arrives later.
          //
          // ⛔ **No `answered`, no `waitedForMs`, no `question_is`** — see {@link AskOutcome} for
          // why all three went with the wait rather than staying on as constants. ⚠️ A payload
          // field whose value never varies is a fact a model has to read and can never act on.
          //
          // 🔴 **591's sentence is kept WORD FOR WORD, and it is the load-bearing half now**
          // (HO-082 §2): *an answer given later reaches you as a message*. ⛔ Before `608` that
          // clause told a model an answer could still arrive after an expiry; after `608` it is
          // the only way an answer EVER arrives, so a dispatch that dropped it while removing the
          // wait would have deleted the one line explaining where the answer went.
          return answer(
            // ⚑ **611 · the payload says WHERE it went**, which is the one thing this call's
            // outcome varies in. ⚑ **D-016 · the host's answer, not the caller's declaration**: a
            // question for whoever gave a conversation's own work goes to a person (spec D15).
            {
              outcome: 'ok',
              question: asked.question,
              went_to: asked.went,
              ...(asked.went === 'an-agent' ? { agent: addressed } : {}),
            },
            // ⚑ **D-016 · commit 7 · R3 — the agent asked, by the piece it owns**; the payload keeps
            // its id.
            // Where it went, in words.
            `Your question is recorded and routed to ${asked.went === 'an-agent' ? (addressed === null ? asked.went : host.nameByItsWork(addressed)) : ROUTED_TO[asked.went]}, as ${asked.question}. It is still theirs to answer — an answer given later reaches you as a message rather than as this call's result. ${asked.aboutItsRoot ? 'Asking did not end any work: this conversation\u2019s own work is a person\u2019s, and you answer them here, in your own words.' : 'Asking did not hand any work back; reply_to_parent is what does that.'} Carry on from here.`,
          )
        }),
    },
    {
      name: 'list_profiles',
      /**
       * 🔴 **The sentence states the RULE** (standing rule 8, D-014): every agent this app holds,
       * and any of them can be named to `give_work`. ⛔ Never *you may*: whether this caller may give
       * at all is its own grant, which a person can narrow.
       *
       * ⚠️ **It does not promise that being listed means a give will work** — that is
       * `list_agents`' own lesson about seeing and sending, one population over, and the rails
       * between here and a running conversation are the switch, the depth, a stalled piece and the
       * folder.
       *
       * ⚑ **It is the one door that names identities nobody has started** — `list_agents` names
       * conversations — and a name this app holds no identity for is `no-such-profile`.
       *
       * When a caller names an agent, read its record on demand while choosing whom to give work to. Do not preload that history into conversation context. See {@link RuntimeHost.agentRecord} for the record and visibility rules.
       */
      description:
        'Every agent this app holds — any of them can be named to give_work: what each is called, which provider its conversations run on, and its default model and effort, when it has one; and each provider’s latest usage reading per window — how much is used, when it resets and when it was read, and whether that was before this app last started, when it may be another sign-in’s — so you can keep to a cap before you give work; and which windows each provider has reported since this app began noting them, with when each was first and last reported. These are identities, not conversations — list_agents answers which conversations you can see. Being listed here is not a promise that a give will succeed. The answer says in words what the count covers — read that before summarising it. Name one agent with profile, before choosing whom to give work to, to read what it has done instead: how its standing rules begin, its conversations you can reach — who started each and when, which could not be reopened and which are archived — the newest pieces of work they hold and how each stands or ended, and the files it made.',
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **A reader of this app's own table**; there is nothing here to ask a person about. ⚑ F009 ·
       * an agent's record asks the reach `list_agents` asks, of each of its conversations, inside the
       * host's read — a fold, never a wall.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      /**
       * 🔴 **F009 · one argument, and it opens a different answer rather than narrowing this one.**
       * ⛔ The ruling here was *none*: *"A name to ask about was the obvious argument and it is
       * refused. The whole roster is one small read, and a named arm would buy one narrowing for a
       * second shape of answer."* ⚑ A record is not that narrowing — nothing on the roster tells what
       * an agent has done — so the name opens it, as `list_tasks` naming a piece opens its record.
       */
      input: {
        profile: z
          .string()
          .optional()
          .describe(
            'An agent, by the profile this list names it by, to read what it has done instead of the list. Leave it out to list every agent.',
          ),
      },
      call: (args) =>
        guarded(async () => {
          if (args.profile !== undefined) {
            if (typeof args.profile !== 'string' || args.profile.trim().length === 0) {
              return refusalAnswer(
                refuseTool('malformed-request', {
                  problems: ['profile, when given, must name an agent list_profiles lists'],
                }),
              )
            }
            // ⚑ **F009 · one agent's record** — its conversations through this caller's reach.
            const read = host.agentRecord(args.profile.trim(), by, me)
            if (read.is === 'no-agent-by-that-name') {
              return refusalAnswer(
                refuseTool('no-agent-by-that-name', { profile: args.profile.trim() }),
              )
            }
            return answer(
              { outcome: 'ok', ...agentRecordPayload(read.record) },
              [
                agentRecordText(read.record, me),
                // ⚑ `list_tasks`' two sentences, for the pieces this read could be short of.
                ...(read.record.rowsUnread === 0
                  ? []
                  : [unreadRowsSentence(read.record.rowsUnread)]),
                ...whenSkipped(read.record.ledgersSkipped, skippedRecordsSentence),
              ].join('\n\n'),
            )
          }
          // ⛔ **No wall and no fold** (D-014): any agent may give work to any agent this app holds,
          // so the whole roster is the answer.
          const reading = host.profilesVisibleTo()
          const profiles = reading.profiles.map((report) => ({
            profile: report.profile,
            ...(report.displayName === null ? {} : { display_name: report.displayName }),
            ...(report.provider === null ? {} : { provider: report.provider }),
            // 🔴 **D-042 · R6 — its default, so a giver knows before it calls** (`677`'s inbox 8).
            // ⛔ **Not called `model_choice`**: `the-rails-before-anything-can-reach-them.test.ts` bans
            // that word from this toolset so no tool can come to name the person's door, and a READ is
            // no reason to weaken that ban.
            ...(report.defaultModel === null ? {} : { default_model: report.defaultModel }),
            ...(report.isAService === true ? { kind: 'service' } : {}),
          }))
          return answer(
            {
              outcome: 'ok',
              profiles,
              count: profiles.length,
              count_covers: EVERY_AGENT_THIS_APP_HOLDS,
              // 🔴 **F096 — each provider's newest usage reading, per window**.
              provider_usage: providerUsagePayload(reading.usage, reading.readAt),
              // ⚑ **F096 — which windows each provider has reported, first and last**: kept when
              // the readings are forgotten, so it says whether a window comes at all.
              usage_windows_seen: Object.fromEntries(
                (Object.keys(reading.windowsSeen) as Provider[]).map((provider) => [
                  provider,
                  reading.windowsSeen[provider].map((one) => ({
                    window: one.window,
                    first_seen: clockTimeFrom(one.first, reading.readAt),
                    last_seen: clockTimeFrom(one.last, reading.readAt),
                  })),
                ]),
              ),
            },
            // 🔴 **FIRST, because it is the only line guaranteed to survive the cut.** ⛔ A
            // person never sees this payload: `tool_result` carries a summary of at most 200
            // characters and `ToolEntry.vue` draws that.
            [
              EVERY_AGENT_THIS_APP_HOLDS,
              ...reading.profiles.map((report) => profileText(report)),
              ...(Object.keys(reading.usage) as Provider[]).flatMap((provider) => {
                // Which windows it has reported, first and last, as the description promises.
                const seen = reading.windowsSeen[provider] ?? []
                return [
                  providerUsageText(provider, reading.usage[provider], reading.readAt),
                  ...(seen.length === 0
                    ? []
                    : [
                        windowsReported(
                          PROVIDER_NAME[provider],
                          seen.map((one) => ({
                            window: usageLimitWords(one.window) ?? one.window,
                            first: clockTimeFrom(one.first, reading.readAt),
                            last: clockTimeFrom(one.last, reading.readAt),
                          })),
                        ),
                      ]),
                ]
              }),
            ].join('\n'),
          )
        }),
    },
    {
      name: 'propose_agent_rules',
      description:
        'Propose the complete standing rules another agent should receive. Send the current version, the full replacement text and why it should change. The person decides; nothing is saved until they approve. Send empty text to propose taking the rules away. Saved changes reach the agent at its next start.',
      input: {
        current_version: z
          .number()
          .describe(
            'The current version returned by read_agent_rules. Zero means no rules have been saved.',
          ),
        agent: z
          .string()
          .describe(
            'Which agent the rules are for, as list_profiles reports it. It is compared without case.',
          ),
        rules: z
          .string()
          .describe(
            `The whole set of standing rules, at most ${String(OWN_INSTRUCTIONS_CHARS)} characters. An empty string takes them away.`,
          ),
        why: z
          .string()
          .describe('Why these rules. The person reads this beside the proposed change.'),
      } satisfies Readonly<Record<keyof ProposeRulesArguments, z.ZodType>>,
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      call: (args) =>
        guarded(async () => {
          const problems: string[] = []
          const agent = args[RULES_AGENT_ARGUMENT]
          const rules = args[RULES_TEXT_ARGUMENT]
          const why = args[RULES_WHY_ARGUMENT]
          const version = args['current_version']
          if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)
            problems.push('current_version must be the version returned by read_agent_rules')
          if (typeof agent !== 'string' || !isPathSegment(agent)) {
            problems.push(`${RULES_AGENT_ARGUMENT} is required and must be ${PATH_SEGMENT_RULE}`)
          }
          if (typeof rules !== 'string' || rules.length > OWN_INSTRUCTIONS_CHARS) {
            problems.push(
              `${RULES_TEXT_ARGUMENT} is required and must be at most ${String(OWN_INSTRUCTIONS_CHARS)} characters`,
            )
          }
          if (typeof why !== 'string' || why.trim() === '' || why.length > OWN_INSTRUCTIONS_CHARS)
            problems.push(
              `${RULES_WHY_ARGUMENT} is required and must say why within ${String(OWN_INSTRUCTIONS_CHARS)} characters`,
            )
          if (args['already_agreed'] !== undefined)
            problems.push('already_agreed is not supported; leave it out')
          if (problems.length > 0)
            return refusalAnswer(refuseTool('malformed-request', { problems }))
          const outcome = host.proposeAgentRules(
            me,
            {
              about: agent as string,
              text: rules as string,
              why: (why as string).trim(),
              relaying: false,
              expectedVersion: version as number,
            },
            by,
          )
          if (!outcome.ok) return refusalAnswer(refuseTool(outcome.rail, outcome.detail))
          return answer(
            {
              outcome: 'ok',
              agent,
              wrote: outcome.wrote,
              request: outcome.askId,
              reason: `put in front of a person; nothing is written for ${String(agent)} unless they approve it, and they may not be looking at it now`,
            },
            RULES_PUT_BEFORE_A_PERSON,
          )
        }),
    },
    {
      name: 'pass_question_up',
      /**
       * 🔴 **611 · the verb `HO-088` §3.2 asks for, and the clock it replaces** (§3.1).
       *
       * ## ⛔ The sentence says what this verb does to the WORDS, because nothing else can
       *
       * ⚠️ **A model reading `answer_question` beside this one is choosing between *I know* and *I
       * do not*.** ⛔ The thing it cannot infer is that passing on does NOT let it rewrite the
       * question — so the description says the words are carried exactly, and that context is the
       * only thing it may add. ⚑ **It is a fact about this call rather than a description of the
       * app**: there is no field for the words, which is what makes the sentence true.
       *
       * ⚠️ **And it says the original question stays open.** A model told only *"passed on"* would
       * reasonably conclude it was now off its hands; what is true is that the child is still
       * waiting, on THIS conversation, and the answer comes back here first.
       *
       * 🔴 **It promises no deadline and no answer.** `HO-088` §3.1 removed the clock that decided
       * a parent had failed; `581`'s bound is that we can prove what was sent and never what was
       * heeded.
       */
      description:
        'Pass a question you were asked on to somebody else, exactly as it was asked. Use it when the question is not yours to answer: the words travel unchanged — you cannot reword them — and you may add context beside them. Say who the next hop is: your own parent, or a person. The question you were asked stays open and stays yours: the answer comes back to you, and answer_question is how you then give it to whoever asked. This call does not wait.',
      /**
       * ⛔ **Advertised against a TYPE** — see {@link PassQuestionUpArguments}, including why there
       * is no field for the question's words.
       */
      /**
       * 🔴 **486 · the rails are the whole gate** (HO-031 §2.4).
       *
       * ⚑ **Its entitlement is the LOOKUP**, exactly as `answer_question`'s is: the requests this
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
        // 🔴 **679** — `answer_question`'s field, for its reason: see {@link PassQuestionUpArguments}.
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
          // 🔴 **The SAME list both other question verbs refuse** (437, 611). ⛔ A conversation is
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
          // ⛔ **679** — the answer door's own check, for its reason.
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
          // ⛔ **The SAME bound the question itself carries** (437's constant, not a second one).
          // ⚠️ Context is rendered verbatim into the words the next hop receives — `questionText`
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
          // ⛔ **Not one rail is asked here** — whose question it is, whether it exists, whether it
          // has ended and whether it is a person's are all the host's, through the same
          // `admitAnswer` the answer door uses. 🔴 **D-016 · commit 7 · R1 — `asked_by` read as the
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
          // ⚑ **Two ids, because there are two questions now** — the one this caller was asked, and
          // the one it raised carrying those words. ⛔ Reporting one would make a model guess which
          // it is holding, and it is holding both: the first is still open and still its to answer.
          return answer(
            // ⚑ **679 · and the asker of the one carried** — {@link PassUpOutcome}: a sibling asked
            // later can share its session-local id, and this is the record the passer quotes from.
            {
              outcome: 'ok',
              question: passed.question,
              passed_up: passed.carried.question,
              asked_by: passed.carried.askedBy,
            },
            // ⚑ **D-016 · commit 7 · R3 — `asked_by` quotes the asker's address**: the label of the
            // piece that names it, which `answer_question` takes, or its id when it holds none —
            // ⚑ F033 · the label the question's own words gave it, by the piece it was asked under.
            `That question is now recorded as ${passed.question}, addressed to ${ROUTED_TO[who as PassUpRecipient]}, in the words it was asked in. ${passed.carried.question} is still open and still yours: when the answer reaches you, answer_question with asked_by ${host.addressOfUnder(passed.carried.askedBy, passed.carried.piece)} is how it gets back to whoever asked. Carry on from here.`,
          )
        }),
    },
    {
      name: 'withdraw_question',
      description:
        'Withdraw a question you asked and no longer need answered. It closes the question: an answer given after this is refused, and nothing reaches you. Name it by the id ask_question returned.',
      /**
       * 🔴 **D-009 · F012 — ruling 5: the asker can withdraw it.** ⚑ Its own open question and
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
            return answer(
              carried,
              `refused (${withdrawn.refusal.rail}): ${withdrawn.refusal.reason}`,
            )
          }
          return answer(
            { outcome: 'ok', question: withdrawn.question },
            // The id the call named is not said back.
            DONE,
          )
        }),
    },
    {
      /**
       * 🔴 **D-012 · a giver looks closer, only when it needs to** (proposal §6.5).
       *
       * ⛔ **The stall notice quoted up to 4 KB of the child's last message** because a giver could
       * not read its child. ⚑ Now the notice previews the last exchange and names this door, and
       * the giver reads the rest here: the last exchange whole, then the turns — a few back, or the
       * ones a search finds (*"When the person just answered 'yes', only the turns before it say
       * what was agreed"*).
       *
       * ⚑ **Reach is the chain** `interrupt_agent` walks — a conversation below the caller —
       * ⚑ **and, since D-024 · R2, the caller's own profile's other conversations** — and never a
       * shared service ({@link AgentToolHost.readTranscript}). ⚠️ A READER: nothing is sent.
       */
      name: 'read_transcript',
      handlerOwnsMissingInput: true,
      description:
        'Read a conversation below you — one you started, or one started under it — or another conversation of your own profile: the last message it received (and who sent it) with its latest words back, then its last turns, or the turns whose words contain a search. Use it when a notice about work you gave out is not enough; name it by a piece it owns (W1.2) — list_tasks names the pieces you gave — or by its id.',
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries(readerInputs.read_transcript).map(([field, schema]) => [
          field,
          agentToolHandlerInput(schema),
        ]),
      ),
      call: (args) =>
        guarded(async () => {
          args = toolArgumentsAtHandler(args)
          const problems: string[] = []
          const agent = args.agent
          if (typeof agent !== 'string' || agent.length === 0) problems.push('agent is required')
          const turnsBack = args.turns_back ?? TURNS_BACK_DEFAULT
          if (
            typeof turnsBack !== 'number' ||
            !Number.isInteger(turnsBack) ||
            turnsBack < 1 ||
            turnsBack > TURNS_BACK_MAX
          ) {
            problems.push(`turns_back must be a whole number from 1 to ${String(TURNS_BACK_MAX)}`)
          }
          const search = args.search
          if (search !== undefined && (typeof search !== 'string' || search.trim() === '')) {
            problems.push('search, when given, must be some words')
          }
          if (problems.length > 0 || typeof agent !== 'string' || typeof turnsBack !== 'number') {
            return readerFieldRefusal('read_transcript', args, problems)!
          }
          const fieldRefusal = readerFieldRefusal('read_transcript', args)
          if (fieldRefusal !== null) return fieldRefusal
          // 🔴 **D-016 · commit 7 · R1 — a label names its piece's owner** when this caller may reach
          // it or read it — the chain below it, or (D-024 · R2) a conversation of its own profile, as
          // an id is read; one that names nothing it may read is out of that reach, as an unknown id
          // is.
          const addressed = host.theConversationAddressed(agent, by, me, 'reading')
          const read = host.readTranscript(addressed, me, {
            back: turnsBack,
            search: typeof search === 'string' ? search.trim() : null,
          })
          if (!read.ok) return refusalAnswer(refuseTool(read.refusal, { agent: addressed }))
          // ⚑ **D-016 · commit 7 · R3 — each sender by the piece it owns**, never by its id; the
          // subject keeps its agent's name — the caller just named it, and the words say *its*.
          const called = namedByItsWorkOnce(host)
          const named = (who: AConversation): string => called(who.conversation, who.about ?? null)
          return answer(
            {
              outcome: 'ok',
              agent: addressed,
              name: read.name,
              last_exchange: {
                received:
                  read.lastExchange.received === null
                    ? null
                    : receivedPayload(read.lastExchange.received),
                answer:
                  read.lastExchange.answer === null ? null : wordsPayload(read.lastExchange.answer),
                ...(read.lastExchange.sinceThenItsProviderStartedATurn === true
                  ? { since_then_its_provider_started_a_turn: true }
                  : {}),
              },
              turns: read.turns.map((turn) => ({
                // ⚑ **F080** — a turn its provider started names no message, and says so.
                ...('startedByItsProvider' in turn
                  ? { started_by_its_provider: { after: turn.startedByItsProvider.after } }
                  : { received: receivedPayload(turn.received) }),
                said: turn.said === null ? null : wordsPayload(turn.said),
              })),
              older: read.older,
            },
            transcriptText(read.name, read.lastExchange, read.turns, read.older, named),
          )
        }),
    },
    {
      name: 'update_work',
      // ⚑ A malformed `on` reaches this tool's own refusal, which says what to send instead.
      handlerOwnsMissingInput: true,
      /**
       * 🔴 **D-016 · name a piece, say where it stands, give it a new brief, close it, or keep files
       * for it** (plan ruling 7; R1, R2) — the one conditional line about naming the root in the
       * dynamic layer says the same thing (plan §3.10).
       *
       * ⛔ **It says who is told of what**: a new brief, a close and the giver's files reach the
       * agent holding the piece — at once or once its turn ends, and the answer says which (D-022);
       * a title, a status line and what an owner made — its root's included (D-023) — are sent to
       * nobody.
       */
      description:
        'For a non-root piece taken on for the person, the brief changes here. The giver may change the done condition, or the holder of person-given work. Name a piece of work, say where it stands, give it a new brief, close it, or keep files for it. Title your own conversation’s work — its root, or a piece you took on for a person — or a piece you gave; set the current status line of a piece you hold or gave, or mark it as waiting on purpose with on, which names what will end the wait: another piece or an agent’s answer, a person’s answer or to-do, a time, or a job or background task. A question in your reply is not a request: to wait on a person, ask with ask_question first and name its id. resources keeps files for any piece you hold, your own conversation’s work included, as what you made — and for a piece you gave, as its inputs: the agent holding it is told their ids. A close is only for a piece you gave. For work you gave, brief replaces its brief and is sent to the agent holding it as a message of its own, in your words — or, while the piece’s first brief is still held for that agent, goes out in its place; close ends it without a reply, and that agent is told to stop. What that agent is told reaches it at once when it is free or has stopped, else once its turn ends: the answer says which, and interrupt_agent asks that turn to stop. If your conversation’s work has no title yet, name it after what the person asked for. Name the piece by its label (W1.2) or id — you must name it to brief or close it — or leave it out when you hold only one. The newest title, status line, brief and done condition stand; a title, a status line and what you made are sent to nobody. Only a title changes on a piece that has ended.',
      /**
       * ⚑ **Rows in this app's own ledger, and the rails are the whole gate** (HO-031 §2.4): who
       * may title, brief, close, keep files and say where a piece stands are the host's answers,
       * from the piece's row. ⚑ **A new brief, a close or inputs are told to a conversation the
       * caller gave the piece to** — which wakes it, as `message_agent` and `withdraw_task` wake one
       * — and it never starts a new conversation (D-016 spec D6).
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: {
        piece: z
          .string()
          .optional()
          .describe(
            'The piece, by its label (W1.2) or id. Leave it out when you hold only one — your own conversation’s work counts, and a piece whose brief has not reached you yet does not — except to brief or close, which require the piece to be named.',
          ),
        title: z
          .string()
          .optional()
          .describe(
            `Its new title: one line, at most ${String(PIECE_TITLE_CHARS)} characters. Only the conversation that gave a piece names it — or, for a piece a person gave (your root, or work you took on), the conversation holding it.`,
          ),
        status: z
          .string()
          .optional()
          .describe(
            `Where it stands now, in a line, at most ${String(REPLY_SUMMARY_LIMIT)} characters. Refused on a piece that has ended.`,
          ),
        on: z
          .looseObject({
            agent: z
              .string()
              .optional()
              .describe(
                'Another open piece, by its label (W1.2) or id, or the id of an open question you asked an agent.',
              ),
            person: z
              .string()
              .optional()
              .describe(
                'The id of an open question you asked a person (ask_question with who_answers a-person) or a to-do you asked of them (request_action). A question in your reply is not one: ask it with the tool first.',
              ),
            time: z
              .string()
              .optional()
              .describe(
                'A date and time within 30 days, such as 2026-10-15T09:00:00Z, until which the piece waits, and the app wakes its holder then.',
              ),
            event: z
              .string()
              .optional()
              .describe(
                'The id of a scheduled job or background task running in the conversation holding the piece.',
              ),
          })
          .optional()
          .describe(
            'Marks the status line in this call as a deliberate wait, naming what will end it: exactly one of agent, person, time or event. The piece then reads waiting on purpose, not stalled, until a new brief, a follow-up about it, a reply, or a status line without on. Needs status.',
          ),
        definition_of_done: z
          .string()
          .optional()
          .describe(
            'The new done condition, at most 512 characters. The giver may change it, or the holder of person-given work. Omit it to keep the current condition.',
          ),
        brief: z
          .string()
          .optional()
          .describe(
            'A new brief for a piece you gave or took on for the person, at most 2000 characters. Put longer detail in an input file. A root’s brief stays as recorded. For a piece you gave, the holder is told; while its first brief is still held, the new brief goes out in its place. Refused with close.',
          ),
        close: z
          .boolean()
          .optional()
          .describe(
            'true closes a piece you gave without a reply: it is no longer owed and no longer stalls, and the agent holding it is told to stop. A status line in the same call is set first. Refused with brief or resources.',
          ),
        resources: z
          .array(z.string())
          .optional()
          .describe(
            `Files to keep for the piece, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is copied and hashed: as what you made on any piece you hold, your own conversation’s work included, and nobody is told; as its inputs on a piece you gave, and the agent holding it is told their ids.`,
          ),
      } satisfies Readonly<Record<keyof UpdateWorkArguments, z.ZodType>>,
      call: (args) =>
        guarded(async () => {
          const piece = args[UPDATE_PIECE_ARGUMENT]
          const title = args[UPDATE_TITLE_ARGUMENT]
          const status = args[UPDATE_STATUS_ARGUMENT]
          const on = args[UPDATE_ON_ARGUMENT]
          const brief = args[UPDATE_BRIEF_ARGUMENT]
          const condition = args[UPDATE_DONE_ARGUMENT]
          const close = args[UPDATE_CLOSE_ARGUMENT]
          const paths = args[UPDATE_RESOURCES_ARGUMENT]
          const problems: string[] = []
          if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {
            problems.push(`${UPDATE_PIECE_ARGUMENT} must be a piece's label or id, or left out`)
          }
          // ⚑ **Trimmed, and a blank one is none** — a title or line a person reads beside a label.
          const said = (value: unknown, most: number, argument: string): string | null => {
            if (value === undefined) return null
            const trimmed = typeof value === 'string' ? value.trim() : ''
            if (trimmed === '' || trimmed.length > most) {
              problems.push(`${argument} must be a line of 1 to ${String(most)} characters`)
              return null
            }
            return trimmed
          }
          const newTitle = said(title, PIECE_TITLE_CHARS, UPDATE_TITLE_ARGUMENT)
          const newStatus = said(status, REPLY_SUMMARY_LIMIT, UPDATE_STATUS_ARGUMENT)
          // ⚑ **A new brief is kept VERBATIM**, as `give_work`'s is: it is sent as a message of its
          // own, whole.
          if (brief !== undefined && (typeof brief !== 'string' || brief.trim() === '')) {
            problems.push(`${UPDATE_BRIEF_ARGUMENT} must say something`)
          }
          if (typeof brief === 'string' && brief.length > WORK_BRIEF_CHARS)
            problems.push(WORK_FIELD_WORDS.briefLimit)
          if (condition !== undefined) {
            if (typeof condition !== 'string' || condition.trim() === '')
              problems.push(WORK_FIELD_WORDS.blank)
            else if (condition.length > DONE_CONDITION_CHARS)
              problems.push(WORK_FIELD_WORDS.conditionLimit)
          }
          if (close !== undefined && typeof close !== 'boolean') {
            problems.push(`${UPDATE_CLOSE_ARGUMENT} must be true or false, or absent`)
          }
          if (Object.hasOwn(args, UPDATE_WAITING_ARGUMENT)) {
            problems.push(
              `${UPDATE_WAITING_ARGUMENT} is replaced by ${UPDATE_ON_ARGUMENT}, which names what ends the wait. Send one of: on: {person: "<question id>"} after asking a person with ask_question or request_action; on: {agent: "W1.2"} for another piece, or on: {agent: "<question id>"} for a question to an agent; on: {time: "2026-10-15T09:00:00Z"}; on: {event: "<job or background task id>"}`,
            )
          }
          const waitsOn = whatTheWaitNames(on, problems)
          if (waitsOn !== null && status === undefined) {
            problems.push(
              `${UPDATE_ON_ARGUMENT} needs ${UPDATE_STATUS_ARGUMENT}: a line saying what it waits for`,
            )
          } else if (waitsOn !== null && brief !== undefined) {
            problems.push(
              `${UPDATE_ON_ARGUMENT} and ${UPDATE_BRIEF_ARGUMENT} contradict each other: a new brief ends a wait on purpose`,
            )
          }
          if (
            paths !== undefined &&
            (!Array.isArray(paths) ||
              !paths.every((one) => typeof one === 'string' && one.length > 0))
          ) {
            problems.push(`${UPDATE_RESOURCES_ARGUMENT} must be a list of paths, or absent`)
          } else if (Array.isArray(paths) && paths.length > MAX_RESOURCES_PER_REPLY) {
            problems.push(
              `${UPDATE_RESOURCES_ARGUMENT} may name at most ${String(MAX_RESOURCES_PER_REPLY)} files, and it named ${String(paths.length)}`,
            )
          }
          const closes = close === true
          const keeps = Array.isArray(paths) && paths.length > 0
          if (
            title === undefined &&
            status === undefined &&
            brief === undefined &&
            condition === undefined &&
            !closes &&
            !keeps
          ) {
            problems.push(
              `say ${UPDATE_TITLE_ARGUMENT}, ${UPDATE_STATUS_ARGUMENT}, ${UPDATE_BRIEF_ARGUMENT}, ${UPDATE_DONE_ARGUMENT}, ${UPDATE_CLOSE_ARGUMENT}, ${UPDATE_RESOURCES_ARGUMENT}, or several`,
            )
          }
          // ⛔ **R1 · closing and re-briefing contradict each other**, and so do closing and keeping
          // files for a piece that goes on (D-016 spec D3).
          if (closes && (brief !== undefined || condition !== undefined)) {
            problems.push(
              brief !== undefined
                ? `${UPDATE_CLOSE_ARGUMENT} and ${UPDATE_BRIEF_ARGUMENT} contradict each other: a piece you close is given no new brief`
                : "close and definition_of_done can't go together: a closed piece takes no new done condition.",
            )
          }
          if (closes && keeps) {
            problems.push(
              `${UPDATE_CLOSE_ARGUMENT} and ${UPDATE_RESOURCES_ARGUMENT} contradict each other: files are kept for a piece that goes on`,
            )
          }
          // ⚑ **D-016 spec D4 · a new brief and a close name their piece**: the one inferred is one
          // the caller HOLDS, and these two are acts on a piece it GAVE.
          if ((brief !== undefined || closes) && piece === undefined) {
            problems.push(
              `${UPDATE_PIECE_ARGUMENT} is required to give a new brief or to close: name the piece`,
            )
          }
          if (problems.length > 0) {
            return refusalAnswer(refuseTool('malformed-request', { problems }))
          }
          const updated = await host.updateWork(
            {
              piece: typeof piece === 'string' ? piece : null,
              title: newTitle,
              status: newStatus,
              on: waitsOn,
              definitionOfDone: typeof condition === 'string' ? condition : null,
              brief: typeof brief === 'string' ? brief : null,
              close: closes,
              resources: Array.isArray(paths) ? (paths as string[]) : [],
            },
            by,
          )
          if (!updated.ok) {
            // ⚑ **A file that could not be kept is carried whole** — `carryReplyRefusal`'s
            // `'outcome' in refusal` arm: a `ResourceRefusal` is already `341`-shaped.
            if ('resourceRefusal' in updated) {
              const { resourceRefusal } = updated
              return answer(
                { ...resourceRefusal },
                `refused (${resourceRefusal.rail}): ${resourceRefusal.reason}`,
              )
            }
            if (updated.rail === 'that-piece-has-ended') {
              return refusalAnswer({
                ...refuseTool(updated.rail, { ...updated.detail }),
                reason: anEndedPieceSaid(updated.detail, updated.readAt),
              })
            }
            if (updated.rail === 'a-conversation-with-its-questions-is-starting') {
              return refusalAnswer({
                ...refuseTool(updated.rail, { ...updated.detail }),
                reason: aPieceNotEndedWhileAQuestionStarts(updated.detail.label, 'work-closed'),
              })
            }
            if (updated.rail === 'its-questions-could-not-all-be-read') {
              return refusalAnswer({
                ...refuseTool(updated.rail, { ...updated.detail }),
                reason: aPieceNotEndedItsQuestionsUnread(updated.detail.label, 'work-closed'),
              })
            }
            return refusalAnswer(refuseTool(updated.rail, updated.detail))
          }
          const owner = host.whatToCallTheConversation(updated.owner)
          // No echo of the title, status line or brief the call sent. The label is said only when
          // the call did not spell it exactly; what reached the holder always follows.
          const lead =
            typeof piece === 'string' && piece === updated.label
              ? DONE
              : doneWithThePiece(updated.label)
          const lines = [
            ...(updated.closed === null &&
            updated.delivery !== 'not-delivered' &&
            updated.delivery !== 'after-it-ended'
              ? [lead]
              : []),
            ...(updated.definitionOfDone == null
              ? []
              : [`The done condition for ${updated.label} changed.`]),
            ...(updated.kept.length === 0
              ? []
              : [keptResources(updated.kept.map((one) => one.resource))]),
            ...(updated.closed === null
              ? []
              : [
                  `${updated.label} is closed — ${owner} no longer owes it${
                    updated.closed.tookBackTheMessage
                      ? ', and the message carrying its brief was taken back before it was sent'
                      : ''
                  }${theQuestionsItEnded(updated.closed.endedQuestions)}${
                    updated.askedItsTurnToStop ? '; its turn was asked to stop' : ''
                  }.`,
                ]),
            ...(updated.delivery === null
              ? []
              : [
                  whatReachedItsHolder(
                    owner,
                    updated.label,
                    updated,
                    updated.closed !== null
                      ? updated.askedItsTurnToStop || updated.atAService
                        ? 'a-stop-asked'
                        : 'a-stop'
                      : updated.rebriefed
                        ? 'a-new-brief'
                        : 'its-inputs',
                    host.whyWhatIsHeldWaits(updated.owner),
                  ),
                ]),
          ]
          return answer(
            {
              outcome: 'ok',
              piece: updated.piece,
              label: updated.label,
              ...(updated.title === null ? {} : { title: updated.title }),
              ...(updated.status === null ? {} : { status: updated.status }),
              // ⚑ **Absent, never false** — the file's idiom for what a call did not do.
              ...(updated.rebriefed ? { rebriefed: true } : {}),
              ...(updated.kept.length === 0 ? {} : { resources: updated.kept }),
              ...(updated.closed === null
                ? {}
                : {
                    state: 'closed',
                    tookBackTheMessage: updated.closed.tookBackTheMessage,
                    endedQuestions: updated.closed.endedQuestions,
                    ...(updated.askedItsTurnToStop ? { askedItsTurnToStop: true } : {}),
                  }),
              // ⚑ **D-022 · R3** — see {@link UpdateWorkOutcome.delivery}: in the vocabulary the
              // giver's piece verbs share.
              ...(updated.delivery === null ? {} : { delivery: AS_A_DELIVERY[updated.delivery] }),
              ...(updated.delivery === 'not-delivered' ? { whyNotTold: updated.whyNotTold } : {}),
            },
            lines.join(' '),
          )
        }),
    },
    {
      name: 'take_on_work',
      handlerOwnsMissingInput: true,
      // It opens new personal work; an assigned piece already holds the agent's work.
      description:
        "Only for a request a person typed in your own conversation. For work an agent gave you, keep working on that piece; don't call this. Give a short brief and definition_of_done. The piece goes under your current work; name piece if that is unclear. A recorded agent giver is told. Finish with reply_to_parent, then tell the person here.",
      /**
       * ⚑ **A row in this app's own ledger, in the caller's own conversation** (HO-031 §2.4): nothing
       * is sent and nobody is woken, so the rails are the whole gate.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries({
          title: z
            .string()
            .describe(
              `What the piece is called — what the person asked for: one line, at most ${String(PIECE_TITLE_CHARS)} characters.`,
            ),
          definition_of_done: z.string().describe(WORK_FIELD_WORDS.condition),
          brief: z.string().describe(WORK_FIELD_WORDS.brief),
          piece: z
            .string()
            .optional()
            .describe(
              'The work you hold to put this under, by label or id. Leave it out when your current work is clear.',
            ),
          inputs: z
            .array(z.string())
            .optional()
            .describe(
              'Files holding the detail, at most 10. Relative paths use this conversation’s working folder.',
            ),
        } satisfies Readonly<Record<keyof TakeOnWorkArguments, z.ZodType>>).map(
          ([field, schema]) => [field, agentToolHandlerInput(schema)],
        ),
      ),
      call: (args) =>
        guarded(async () => {
          args = toolArgumentsAtHandler(args)
          // ⛔ **Handed to the door VERBATIM**, `give_work`'s rule: its schema is `.strict()`, so a
          // key it does not know is refused BY NAME only while this layer strips nothing.
          const taken = await host.takeOnWork(args, by)
          if (!taken.ok) {
            if ('resourceRefusal' in taken)
              return answer(
                { ...taken.resourceRefusal },
                `refused (${taken.resourceRefusal.rail}): ${taken.resourceRefusal.reason}`,
              )
            const refused = refuseTool(taken.rail, taken.detail)
            return refusalAnswer(refused)
          }
          return answer(
            {
              outcome: 'ok',
              piece: taken.piece,
              label: taken.label,
              title: taken.title,
              under: taken.root,
              notice: taken.notice,
              queued: taken.queued,
            },
            [
              tookOnForPerson(taken.label, taken.root),
              ...(taken.notice === null
                ? []
                : [
                    taken.notice === 'sent'
                      ? 'The giver was told.'
                      : taken.notice === 'held'
                        ? 'The note is waiting for the giver.'
                        : 'The giver could not be told.',
                  ]),
              ...(taken.queued ? ['The work is queued.'] : []),
            ].join(' '),
          )
        }),
    },
    {
      name: 'search_work',
      description: WORK_SEARCH_WORDS.description,
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: {
        ...workSearchQuery.shape,
        scope: documentedToolEnum(TOOL_INPUT_ENUMS['search_work:scope'], 'The scope to search.'),
        state: documentedToolEnum(
          TOOL_INPUT_ENUMS['search_work:state'],
          'Only work in this state.',
          'Omit it for every state.',
        ).optional(),
      },
      call: (args) =>
        guarded(async () => {
          const input = workSearchQuery.safeParse(args)
          if (!input.success) {
            const refused = workSearchRefusal('invalid')
            return answer(refused, `refused (${refused.rail}): ${refused.reason}`)
          }
          const found = (await host.searchWork?.(me, input.data)) ?? {
            ok: false as const,
            reason: 'unavailable' as const,
          }
          if (!found.ok) {
            const refused = workSearchRefusal(found.reason)
            return answer(refused, `refused (${refused.rail}): ${refused.reason}`)
          }
          return answer({ outcome: 'ok', ...found.page }, workSearchInWords(found.page))
        }),
    },
    {
      name: 'find_files',
      handlerOwnsMissingInput: true,
      /**
       * 🔴 **D-037 · the files this app keeps, found** — a list, or a search by words, on the
       * caller's tree or everywhere; each readable by its id with `read_document`.
       *
       * ⛔ **It says what one call covers**: a search looks through a bounded number of files, newest
       * first, and the answer names the file to go on from — so a model that wants older ones asks
       * again rather than reading an empty answer as *there is none*.
       */
      description: `Find the files this app keeps for pieces of work — the inputs givers handed over and the files agents made or kept — so you can build on what is already written. where says where to look: your tree, the default, or everywhere. Newest first. Without words it lists them; with words it finds only the files where every word appears in the file’s title, its name, its maker’s name or profile, its piece’s label or title, or — for a report, or a page’s source — its text, and a find in the text comes with the words around it. One call names at most ${String(FILES_FOUND_LISTED)} files and searches through at most ${MOST_FILES_SEARCHED.toLocaleString('en-US')}; when older files are left, the answer gives the id to pass as older_than to go on. Read a file with read_document.`,
      /**
       * ⚑ **A read of what this app keeps** (HO-031 §2.4): rows from its own database and kept files
       * from under its own root, through `read_document`'s reader — the rails are the whole gate,
       * and ⛔ none asks who is calling.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: Object.fromEntries(
        Object.entries(readerInputs.find_files).map(([field, schema]) => [
          field,
          agentToolHandlerInput(schema),
        ]),
      ),
      call: (args) =>
        guarded(async () => {
          args = toolArgumentsAtHandler(args)
          const problems: string[] = []
          const where = args.where ?? 'tree'
          if (where !== 'tree' && where !== 'everywhere') {
            problems.push(
              `where, when given, must be one of ${FIND_WHERE_INPUT.members.join(', ')}`,
            )
          }
          const said = args.words
          const words =
            typeof said === 'string'
              ? [
                  ...new Set(
                    said
                      .toLowerCase()
                      .split(/\s+/)
                      .filter((word) => word.length > 0),
                  ),
                ]
              : []
          if (said !== undefined && (typeof said !== 'string' || words.length === 0)) {
            problems.push('words, when given, must hold at least one word')
          }
          if (words.length > MOST_WORDS_FOUND) {
            problems.push(`words holds at most ${String(MOST_WORDS_FOUND)} words`)
          }
          const olderThan = args.older_than
          if (
            olderThan !== undefined &&
            (typeof olderThan !== 'string' || olderThan.length === 0)
          ) {
            problems.push('older_than, when given, must be a file’s id (res_…)')
          }
          if (problems.length > 0) {
            return readerFieldRefusal('find_files', args, problems)!
          }
          const fieldRefusal = readerFieldRefusal('find_files', args)
          if (fieldRefusal !== null) return fieldRefusal
          const found = await host.findKeptFiles(me, {
            where: where === 'everywhere' ? 'everywhere' : 'tree',
            words,
            olderThan: typeof olderThan === 'string' ? olderThan : null,
          })
          if (!found.ok) {
            // ⚑ **The argument is what is wrong, and the answer says how to mend it**: the id came
            // from an earlier answer of this tool, not from a reply or a piece record.
            return readerFieldRefusal('find_files', args, [
              `older_than names no file this app keeps: pass the id an earlier find_files answer gave, or leave it out to start from the newest`,
            ])!
          }
          const scope = where === 'everywhere' ? 'kept anywhere' : 'on your tree'
          const lines = found.files.map((one) => foundFileLine(one, found.readAt))
          // The searched words are not quoted back. The cursor is said only on an empty page, which
          // would otherwise claim that nothing is kept.
          const before = olderThan === undefined ? '' : ` before ${String(olderThan)}`
          const head =
            words.length > 0
              ? found.files.length === 0
                ? noFileHoldsThoseWords(`${scope}${before}`)
                : filesHoldingThoseWords(scope)
              : found.files.length === 0
                ? `No files are ${scope}${before}.`
                : `Files ${scope}, newest first:`
          const notes = [
            ...(found.textUnread === 0
              ? []
              : [
                  `The text of ${found.textUnread === 1 ? '1 file' : `${String(found.textUnread)} files`} could not be read, so only ${found.textUnread === 1 ? 'its' : 'their'} names and pieces were searched.`,
                ]),
            ...(found.goOnFrom === null
              ? []
              : [
                  `${
                    found.older >= OLDER_FILES_COUNTED
                      ? `${OLDER_FILES_COUNTED.toLocaleString('en-US')} or more older files were`
                      : found.older === 1
                        ? '1 older file was'
                        : `${found.older.toLocaleString('en-US')} older files were`
                  } not ${words.length === 0 ? 'listed' : 'looked through'}: call find_files again with older_than: ${found.goOnFrom}${where === 'everywhere' ? ', where: everywhere' : ''}${words.length === 0 ? '' : ' and the same words'} to go on.`,
                ]),
          ]
          return answer(
            {
              outcome: 'ok',
              where,
              ...(words.length === 0 ? {} : { words }),
              files: found.files.map((one) => ({
                resource: one.file.resourceId,
                name: one.file.name,
                title: one.file.title,
                role: one.file.role,
                piece: one.file.piece,
                label: one.file.label,
                piece_title: one.file.pieceTitle,
                added_by:
                  one.file.addedBy === null
                    ? null
                    : { name: one.file.addedBy.name, profile: one.file.addedBy.identity },
                kept_at: one.file.keptAt,
                ...(one.foundIn.length === 0 ? {} : { found_in: one.foundIn }),
                ...(one.excerpt === null ? {} : { excerpt: one.excerpt }),
              })),
              looked: found.looked,
              older: found.older,
              older_than: found.goOnFrom,
              ...(found.textUnread === 0 ? {} : { text_unread: found.textUnread }),
            },
            [
              [head, ...lines].join('\n'),
              ...notes,
              ...(found.files.length === 0 ? [] : [READ_ONE_WITH_READ_DOCUMENT]),
            ].join('\n\n'),
          )
        }),
    },
    {
      name: 'restore_agent',
      description:
        'Bring an archived conversation back: it shows again in the person’s lists and in list_agents, with the helpers archived with it. This sends it nothing, and its transcript says that you restored it, so the person sees who did. It carries on as when a person restores it: one that held messages when it was archived starts to take them, one with a schedule wakes for it, and any other stays stopped. So restoring a conversation that held a message or a schedule starts it and spends a turn; the answer says which. To only read an archived conversation, do not restore it: list_agents with archived: true finds it, and read_transcript reads it where it could before it was archived. Restore only what your work needs: a person archived it to put it away. Name it by the piece it owns (W1.2) or by its id; list_agents with archived: true lists the archived conversations you can reach. To restore one and tell it something in the same act, send it a message or give it work instead: whatever is sent to an archived conversation brings it back.',
      /**
       * A person's Restore, asked by an agent. It sends nothing of its own: what starts is only
       * what the app starts for words and jobs the conversation already held, as a message to a
       * stopped one does. The host's own refusals are the whole gate, and any archived
       * conversation may be restored.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: {
        agent: z
          .string()
          .describe(
            'The archived conversation, by the piece it owns (W1.2) or by its id from list_agents with archived: true.',
          ),
      },
      call: (args) =>
        guarded(async () => {
          if (typeof args.agent !== 'string' || args.agent.length === 0) {
            return refusalAnswer(
              refuseTool('malformed-request', { problems: ['agent is required'] }),
            )
          }
          const restored = host.restoreAsAnAgent(args.agent, by, me)
          if (restored.is === 'no-such-agent') {
            return refusalAnswer(refuseTool('no-such-agent', { agent: args.agent }))
          }
          if (restored.is === 'not-archived') {
            return refusalAnswer(
              refuseTool('that-conversation-is-not-archived', { agent: args.agent }),
            )
          }
          if (restored.is === 'being-set-aside' || restored.is === 'could-not') {
            return refusalAnswer(
              refuseTool(
                restored.is === 'could-not'
                  ? 'it-could-not-be-restored'
                  : 'it-is-being-archived-or-deleted',
                { agent: args.agent, said: restored.said },
              ),
            )
          }
          const called = namedByItsWorkOnce(host)
          /** One restored conversation, and how it carries on, in a line. */
          const line = ({ conversation, carriesOn }: (typeof restored.conversations)[number]) => {
            // One that holds no piece is named with its address too, as `name, address`.
            const address = host.addressOf(conversation)
            const name =
              pieceNumbersOf(address) === null
                ? `${called(conversation, null)}, ${address}`
                : called(conversation, null)
            if (carriesOn === null) return `${name}: stays stopped until something starts it`
            return carriesOn === 'starting'
              ? `${name}: starting now, for what it held when it was archived`
              : `${name}: wakes at ${clockTimeFrom(carriesOn.wakesAt, restored.readAt)} for its schedule`
          }
          const many = restored.conversations.length > 1
          return answer(
            {
              outcome: 'ok',
              restored: restored.conversations.map(({ conversation, carriesOn }) => ({
                agent: conversation,
                carries_on:
                  carriesOn === null
                    ? 'stopped'
                    : carriesOn === 'starting'
                      ? 'starting'
                      : `wakes at ${clockTimeFrom(carriesOn.wakesAt, restored.readAt)}`,
              })),
            },
            [
              `restored, back in the lists; you sent ${many ? 'them' : 'it'} nothing, and ${
                many ? 'their transcripts say' : 'its transcript says'
              } you restored ${many ? 'them' : 'it'}:`,
              ...restored.conversations.map(line),
            ].join('\n'),
          )
        }),
    },
    {
      name: 'request_mcp_server',
      description:
        'Ask the person to register an outside MCP server, so you and the agents you name can use its tools. Give its name, its exact address, what it can read and do, and who should get it. This registers nothing and contacts nothing: the request waits under Waiting on you until the person approves or refuses it, and they may not be looking now. When they decide, this conversation is told. If they approve and your own profile gets the server, this conversation is reopened once it is idle, so the server’s tools reach you; not while it runs work in the background or is planning, which a reopen would end. Returns what happened, or a refusal naming the rule that stopped it.',
      /**
       * Any agent may ask, with no grant: what guards the registry is the person's press, behind
       * `requireAPerson` on the window's decide command, which no toolset carries.
       */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: {
        name: z
          .string()
          .describe(
            `A short name for the server, which its tools are published under: ${PATH_SEGMENT_RULE}, never two underscores together, and not ${AGENT_TOOL_SERVER}.`,
          ),
        url: z
          .string()
          .describe(
            'The server’s full address, exactly as it should be registered, for example http://127.0.0.1:8765/mcp. It must be on this machine and carry no username or password.',
          ),
        reaches: z
          .string()
          .describe(
            `What this server can read and do, in your own words, at most ${REPLY_SUMMARY_LIMIT.toLocaleString('en-US')} characters. The person reads this before deciding.`,
          ),
        who_gets_it: documentedToolEnum(
          TOOL_INPUT_ENUMS['request_mcp_server:who_gets_it'],
          'Who should get the server.',
        ),
        agents: z
          .array(z.string())
          .optional()
          .describe(
            `With only-these-agents: which agents, as list_profiles names them (1 to ${String(MAX_EXTERNAL_MCP_GRANTS)}).`,
          ),
        piece: z
          .string()
          .optional()
          .describe('Optional: the label of your piece of work this is for.'),
      } satisfies Readonly<Record<keyof RequestMcpServerArguments, z.ZodType>>,
      call: (args) =>
        guarded(async () => {
          const problems: string[] = []
          const { name, url, reaches, who_gets_it: who, agents, piece } = args
          if (typeof name !== 'string') {
            problems.push('name is required: a short name for the server')
          } else {
            const bad = externalMcpNameRefusal(name, AGENT_TOOL_SERVER)
            if (bad !== null) problems.push(bad)
          }
          if (typeof url !== 'string') {
            problems.push('url is required: the server’s full address')
          } else if (url.length > MCP_SERVER_URL_CHARS) {
            problems.push(`url must be at most ${String(MCP_SERVER_URL_CHARS)} characters`)
          } else {
            const bad = externalMcpUrlRefusal(url)
            if (bad !== null) problems.push(bad)
          }
          if (
            typeof reaches !== 'string' ||
            reaches.trim().length === 0 ||
            reaches.length > REPLY_SUMMARY_LIMIT
          ) {
            problems.push(
              `reaches is required: what the server can read and do, at most ${String(REPLY_SUMMARY_LIMIT)} characters`,
            )
          }
          const whoIsKnown = MCP_SERVER_REQUEST_WHO.some((one) => one === who)
          if (!whoIsKnown) {
            problems.push(
              `who_gets_it is required and takes ${MCP_SERVER_REQUEST_WHO.join(' or ')}`,
            )
          }
          const named = Array.isArray(agents) ? (agents as unknown[]) : null
          if (who === 'only-these-agents') {
            if (
              named === null ||
              named.length === 0 ||
              named.length > MAX_EXTERNAL_MCP_GRANTS ||
              named.some((one) => typeof one !== 'string' || !isPathSegment(one))
            ) {
              problems.push(
                `agents is required with only-these-agents: 1 to ${String(MAX_EXTERNAL_MCP_GRANTS)} agents, as list_profiles names them`,
              )
            }
          } else if (who === 'everyone' && agents !== undefined) {
            problems.push(
              'agents goes only with only-these-agents: everyone already means every agent',
            )
          }
          if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {
            problems.push('piece must name a piece of work you hold, or be left out')
          }
          if (problems.length > 0) {
            return refusalAnswer(refuseTool('malformed-request', { problems }))
          }
          const asked = host.requestMcpServer(me, {
            name: name as string,
            url: url as string,
            reaches: (reaches as string).trim(),
            whoGetsIt: who as McpServerRequestWho,
            agents: who === 'only-these-agents' ? (named as string[]) : [],
            piece: typeof piece === 'string' ? piece : null,
          })
          if (!asked.ok) {
            const refused = refuseTool(asked.rail, asked.detail)
            const reason = aServerRequestRefusal(asked.rail, asked.detail)
            return refusalAnswer(reason === null ? refused : { ...refused, reason })
          }
          return answer(
            { outcome: 'ok', request: asked.requestId },
            `Put in front of the person as request ${asked.requestId}. Nothing is registered unless they approve it, and they may not be looking now. Carry on with what you can; you will be told when they decide.`,
          )
        }),
    },
    {
      name: 'request_action',
      description:
        'Ask the person to do something only they can do — a click, a check, a sign-in, a file to look at — as a to-do under Waiting on you, about a piece you hold. Say what to do, and hand them files with resources. Name the piece, or leave it out when you hold only one. This does not wait: the person answers Done or Can’t do it, with a note if they like, and the answer reaches you as a message. To mark the piece as waiting on it, call update_work with on: {person: "<the question id this returns>"}. A request in your reply is not a to-do, and shows nowhere.',
      /** It writes a request and hands nobody work: only the person's answer reaches the caller. */
      beyondItsRails: 'nothing-its-rails-do-not-cover',
      input: {
        piece: z
          .string()
          .optional()
          .describe(
            'Which piece the to-do is for, by its label (W1.2) or id. Leave it out when you hold only one.',
          ),
        action: z
          .string()
          .describe(
            `What the person should do, in plain words, at most ${String(REPLY_SUMMARY_LIMIT)} characters.`,
          ),
        resources: z
          .array(z.string())
          .optional()
          .describe(
            `Files to hand the person, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is kept for the piece.`,
          ),
      },
      call: (args) =>
        guarded(async () => {
          const piece = args['piece']
          const action = args['action']
          const paths = args['resources']
          const problems: string[] = []
          if (piece !== undefined && (typeof piece !== 'string' || piece.length === 0)) {
            problems.push("piece must be a piece's label or id, or left out")
          }
          const said = typeof action === 'string' ? action.trim() : ''
          if (said === '' || said.length > REPLY_SUMMARY_LIMIT) {
            problems.push(
              `action must say what to do, in 1 to ${String(REPLY_SUMMARY_LIMIT)} characters`,
            )
          }
          if (
            paths !== undefined &&
            (!Array.isArray(paths) ||
              !paths.every((one) => typeof one === 'string' && one.length > 0))
          ) {
            problems.push('resources must be a list of paths, or absent')
          } else if (Array.isArray(paths) && paths.length > MAX_RESOURCES_PER_REPLY) {
            problems.push(
              `resources may name at most ${String(MAX_RESOURCES_PER_REPLY)} files, and it named ${String(paths.length)}`,
            )
          }
          if (problems.length > 0) {
            return refusalAnswer(refuseTool('malformed-request', { problems }))
          }
          const asked = await host.requestAnAction(
            {
              piece: typeof piece === 'string' ? piece : null,
              action: said,
              files: Array.isArray(paths) ? (paths as string[]) : [],
            },
            by,
          )
          if ('resourceRefusal' in asked) {
            const { resourceRefusal } = asked
            return answer(
              { ...resourceRefusal },
              `refused (${resourceRefusal.rail}): ${resourceRefusal.reason}`,
            )
          }
          if (!asked.ok) {
            const carried = carryQuestionRefusal(asked.refusal)
            return answer(carried, `refused (${asked.refusal.rail}): ${asked.refusal.reason}`)
          }
          return answer(
            { outcome: 'ok', question: asked.question },
            `The to-do is under Waiting on you as ${asked.question}. The person answers Done or Can’t do it, and the answer reaches you as a message; they may not be looking now. Carry on from here.`,
          )
        }),
    },
  ]

  /**
   * 🔴 **405 · every refusal this toolset answers with becomes a row, at ONE site** (HO-019 §4).
   *
   * ## ⛔ Why the wrapper and not the scattered returns
   *
   * ⚠️ **The refusal returns in this file are spread across every tool that takes an argument and
   * every vocabulary in {@link PublishedRefusal}'s note**, and a rule applied at each of them is a
   * rule the next one forgets — ⛔ **a count here would be a number nothing checks, so this says the
   * shape instead.**
   * `396`'s lesson stated the general form — *"whether work happens must never depend on whether
   * anybody remembered to write the line"* — and the shape that satisfies it here is the EXIT: a
   * tool answers, and what it answered decides whether a row is written.
   *
   * ⚑ **A new tool is covered the day it is added and a new rail the day it is refused**, because
   * neither can reach a model without passing through this map.
   *
   * ## ⚠️ Read off the answer, and what that costs
   *
   * ⛔ **The answer is where the payload's type is gone** — `AgentToolAnswer.structured` is
   * `Readonly<Record<string, unknown>>`, because that field is the neutral contract both adapters
   * translate and it holds `{outcome: 'ok', …}` far more often than a refusal. So this reads the
   * policy fields back out, and {@link refusalIn} is deliberately loud rather than quiet about a
   * payload it cannot read: a silently skipped row is `402` F2 again, inside its own fix.
   *
   * ⚑ **What makes the read safe is that nothing else builds one.** Every `outcome: 'refused'` in
   * this file comes from {@link refuseTool} or a typed carrier, all of which now return
   * {@link PublishedRefusal} — and `a-refusal-you-can-see.test.ts` §4 censuses exactly that.
   */
  const recordsWhatItRefused = (
    one: AgentToolDefinition & { readonly name: ToolName },
  ): AgentToolDefinition => ({
    ...one,
    call: async (args: Record<string, unknown>): Promise<AgentToolAnswer> => {
      const answered = await one.call(args)
      // ⛔ **AFTER the call and never around it.** A row written before the door answered would say
      // a rule refused something no rule had looked at yet, and a `try`/`finally` would write one
      // for a handler that threw — which is a BROKEN TOOL and deliberately not a refusal (307).
      const said = answerInWords(answered, {
        me,
        addressOf: (conversation) => host.addressOf(conversation),
        readAt: Date.now(),
      })
      const refused = refusalIn(one.name, answered.structured, said.text)
      if (refused !== null) host.noteRefusal(me, one.name, refused)
      return withNavigationLinks(
        one.name,
        said,
        {
          conversationName: (id) => host.nameByItsWork(id),
          conversationVisible: (id) => host.agentCard(id, by, me) !== null,
          conversationProfile: (id) => host.navigationProfileForConversation?.(id) ?? null,
          identity: (profile) => host.navigationIdentity?.(profile) ?? null,
          piece: (spelled) => {
            const read = host.pieceRecord(me, spelled)
            if (read.is === 'no-piece-by-that-name') return null
            const row = read.is === 'a-root' ? read.root : read.piece
            return { id: row.piece, label: row.label, title: row.title }
          },
        },
        args,
      )
    },
    description: NAVIGATION_TOOL_NAMES.has(one.name)
      ? `${one.description} ${NAVIGATION_LINKS_DESCRIPTION}`
      : one.description,
  })

  return {
    server: AGENT_TOOL_SERVER,
    instructions: AGENT_TOOL_INSTRUCTIONS,
    tools: [
      ...tools,
      ...themeAgentTools(
        () => host.themes,
        () => host.whatToCallTheConversation(me),
        (rail, detail) => refusalAnswer(refuseTool(rail, detail)),
        (answer) =>
          answerInWords(answer, {
            me,
            addressOf: (conversation) => host.addressOf(conversation),
            readAt: Date.now(),
          }),
      ),
      {
        name: 'search_past_work' as const,
        description: PAST_WORK_SEARCH_DESCRIPTION,
        beyondItsRails: 'nothing-its-rails-do-not-cover' as const,
        input: pastWorkSearchQuery.shape,
        call: (args: Record<string, unknown>) =>
          guarded(async () => {
            const input = pastWorkSearchQuery.safeParse(args)
            const found = input.success
              ? ((await host.searchPastWork?.(me, input.data.words)) ?? {
                  ok: false as const,
                  reason: 'unavailable' as const,
                })
              : { ok: false as const, reason: 'invalid' as const }
            if (!found.ok) {
              const refused = pastWorkSearchRefusal(found.reason)
              return answer(refused, `refused (${refused.rail}): ${refused.reason}`)
            }
            return answer({ outcome: 'ok', hits: found.hits }, pastWorkSearchInWords(found.hits))
          }),
      },
      {
        name: 'read_agent_rules' as const,
        description:
          "Read one agent's current standing rules and version, with the recorded author and reason. Use its profile name. Empty rules are returned as empty text. This reads the current saved rules; a running conversation may still hold an earlier version.",
        input: {
          agent: z.string().describe('The profile name of the agent whose current rules to read.'),
        },
        beyondItsRails: 'nothing-its-rails-do-not-cover' as const,
        call: (args: Record<string, unknown>) =>
          guarded(async () => {
            const agent = args['agent']
            if (typeof agent !== 'string' || !isPathSegment(agent))
              return refusalAnswer(
                refuseTool('malformed-request', {
                  problems: [`agent is required and must be ${PATH_SEGMENT_RULE}`],
                }),
              )
            const outcome = host.readAgentRules(me, agent, by)
            if (!outcome.ok) return refusalAnswer(refuseTool(outcome.rail, outcome.detail))
            return answer({ outcome: 'ok', ...outcome.result }, JSON.stringify(outcome.result))
          }),
      },
    ].map(recordsWhatItRefused),
  }
}

/**
 * ⛔ **The refusal facts, or `null` because this answer is not a refusal at all** (405).
 *
 * ⚠️ **`outcome` is the discriminant and it is the only one that may answer quietly.** An `ok`
 * payload is the overwhelmingly common case and there is nothing to say about it.
 *
 * 🔴 **A payload that SAYS refused and cannot be read is a defect, and it is reported as one.** ⛔ It
 * cannot be published as a partial row: a refusal drawn with a blank rail tells a person a rule
 * stopped their agent and refuses to say which, which is worse than the silence `402` F2 measured
 * because it looks like an answer. ⚑ It cannot be silently dropped either — that is the same bug in
 * a quieter costume — so it goes to the log with the tool that produced it.
 */
export function refusalIn(
  tool: string,
  structured: Readonly<Record<string, unknown>> | undefined,
  text?: string,
): RefusalFacts | null {
  const facts = thePolicyFactsIn(tool, structured)
  if (facts === null) return null
  // Detail stays in the model's answer; the ledger adds only the reviewed app-only clauses, and a
  // request's problems when they are all this app's words.
  const told = appOnlyRefusalQuote(structured, text, problemsInItsOwnWords(structured?.['detail']))
  return typeof told === 'string' && told !== '' ? { ...facts, told: refusalToldOf(told) } : facts
}

/** The policy facts of {@link refusalIn}, read back out of the payload — its note says how. */
function thePolicyFactsIn(
  tool: string,
  structured: Readonly<Record<string, unknown>> | undefined,
): RefusalFacts | null {
  if (structured === undefined || structured['outcome'] !== 'refused') return null
  const rail = structured['rail']
  const permanence = structured['permanence']
  const retryable = structured['retryable']
  // ⛔ **425 · a remedy this build does not recognise is NOT a reason to drop the row.** Unlike the
  // the required fields above it, the absence of an act is the ORDINARY answer — most rails have
  // none — so an unreadable one reads as *none* rather than as a defect, and
  // the row still says which rule stopped the call. ⚑ Nothing in this build can produce one: every
  // payload comes from `refuseTool` or a carrier, and every producer re-derives it from a typed table.
  const remedy = structured['remedy']
  const said = isRefusalRemedy(remedy) ? remedy : null
  if (typeof rail === 'string' && rail.length > 0 && isRailPermanence(permanence)) {
    if (typeof retryable === 'boolean') return { rail, permanence, retryable, remedy: said }
  }
  console.warn(
    `${tool} refused a call with a payload this app cannot record: ` +
      `rail=${typeof rail} permanence=${String(permanence)} retryable=${typeof retryable}`,
  )
  return null
}
