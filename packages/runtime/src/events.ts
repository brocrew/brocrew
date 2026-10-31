import { z } from 'zod'
import { isMessageAct } from './message-act'
import { providerSchema, sessionStatusSchema } from '@brobot2/shared'
import { MAX_FILE_DIFF_BYTES } from './file-change'
import { MAX_BACKGROUND_ID, MAX_BACKGROUND_TEXT, MAX_BACKGROUND_WORK } from './background-work'
import { MAX_WORKFLOW_AGENTS, MAX_WORKFLOW_DESCRIPTION, MAX_WORKFLOW_TEXT } from './workflow-run'
import {
  MAX_SCHEDULED_JOBS,
  MAX_SCHEDULE_PROMPT,
  MAX_SCHEDULE_TEXT,
  NOT_STARTED_BECAUSE,
} from './scheduled-work'
import {
  MAX_COMMAND_ALIASES,
  MAX_COMMAND_NAME,
  MAX_COMMAND_TEXT,
  MAX_SKILL_PATH,
  MAX_SKILL_SCOPE,
  MAX_PROVIDER_COMMANDS,
} from './provider-commands'
import {
  MAX_DECLARED_TOOLS,
  MAX_PUBLISHED_SERVERS,
  MAX_PUBLISHED_TOOLS,
  MAX_STATUS_WORD,
  MAX_TOOL_NAME,
  MAX_TOOL_PARAMETERS,
  MAX_TOOL_TEXT,
} from './tool-inventory'
import {
  MAX_RECALL_ENTRIES,
  MAX_RECALL_NOTE,
  MAX_RECALL_PATH,
  MAX_RECALL_THREADS,
  MAX_THREAD_ID,
} from './memory-recall'
import {
  permissionScopeSchema,
  PLAN_CONSENTS,
  userInputPermissionSchema,
  userInputQuestionSchema,
} from './permission'
import { sessionRefSchema } from './session-ref'

/**
 * The provider-neutral `RuntimeEvent` taxonomy — the normalized stream both
 * adapters (Claude and Codex) emit and the UI/orchestration consume: structured
 * events, never state scraped from terminal text.
 *
 * Each variant's zod schema documents how each provider's own events map onto it.
 */

/**
 * Provider-session lifecycle. `ended` is RESERVED for the provider session
 * actually closing (Codex `thread/closed` / app-server exit; Claude adapter
 * close) — NOT for a turn finishing. Turn boundaries are the `turn` event +
 * `status: idle` (001 gap 1; load-bearing for Slice 3's two-signal landing).
 *   - Claude: `system/init` (session_id) → `started` | `resumed`.
 *   - Codex:  `thread/started` / `thread/resume` response → `started` | `resumed`.
 */
const sessionEventSchema = z.object({
  type: z.literal('session'),
  state: z.enum(['started', 'resumed', 'ended']),
  ref: sessionRefSchema,
})

/**
 * **The provider started a NEW conversation underneath this session** (199, from 192 H5).
 *
 * Claude emits `conversation_reset` on `/clear`, on plan-mode exit and on its fresh-session flows,
 * and the pinned SDK says in its own words what a surface owes it: *"The surface should mount a
 * fresh transcript under new_conversation_id"* (`sdk.d.ts:4922-4930`). That is two obligations, and
 * they are separate:
 *
 *  - **Identity.** {@link ref} is the conversation the provider moved TO, and it is what a resume
 *    must reopen. Until 199 `new_conversation_id` was read by nothing at all, so a reopened session
 *    came back on the PRE-reset conversation and every turn typed after the reset was silently
 *    gone. It is the one finding in 192 that loses work permanently.
 *    🔴 **`721` · R75 — and on Claude that conversation is NOT `new_conversation_id`.** Measured
 *    (`probe:claude-resume-after-cd`): that id has no transcript and no resume opens it; the
 *    `system/init` the CLI sends next names the one that does, and the Claude adapter raises this
 *    event off that init. The SDK's sentence above is the SDK's, not the disk's.
 *  - **Visibility.** It is a seam in the conversation, drawn where it happened, exactly as a
 *    {@link compactionEventSchema} is — and filing it as lifecycle chatter is precisely what hid
 *    it. `transcript-mode.ts` already argues that a compaction must not be hideable chrome; a reset
 *    is strictly more destructive than a compaction.
 *
 * ⚠️ **This is NOT the session starting again, and that is why it is its own event rather than a
 * fourth `state` on {@link sessionEventSchema}.** Every reader of a non-`ended` `session` event
 * treats it as the session ANNOUNCING ITSELF OPEN — the transcript clears the previous life's
 * terminal latch on it, the adapters take it as the handshake landing. A reset announces nothing of
 * the kind: the app's conversation carries on in the same row, with the same ledger and the same
 * ordinals, and only the provider conversation those turns are appended to has changed. Given a new
 * `state` instead, every one of those readers would have silently agreed to the wrong sentence.
 *
 * ⛔ **Claude-only at this pin, and honestly so.** Codex has no equivalent signal. The vocabulary is
 * provider-neutral because the FACT is provider-neutral, not because both providers report it.
 */
const conversationResetEventSchema = z.object({
  type: z.literal('conversation_reset'),
  /** The conversation the provider moved to — what a resume must reopen (a transcript on disk: 721). */
  ref: sessionRefSchema,
  /** The provider's own signal names — Claude's `conversation_reset + system/init` (721). Cited by the row, never asserted. */
  source: z.string().max(120),
})

/**
 * A turn (one request/response cycle) reached a terminal state — distinct from
 * the session ending (001 gap 1). `status: idle` accompanies `completed`.
 *   - Claude: `result` success → `completed`; `result` error → `failed` — and a success whose
 *     `is_error` is true, which is a turn that ended on the CLI's own notice (680), → `failed`;
 *     a `result` whose `terminal_reason` is `aborted_streaming` / `aborted_tools` → `interrupted`
 *     (709, measured on CLI 2.1.281).
 *   - Codex:  `turn/completed completed` → `completed`; `... failed` → `failed`;
 *             `... interrupted` → `interrupted`.
 *
 * 🔴 **709 · R43 — the word is the PROVIDER's**, whatever was asked: a turn the provider completed
 * after a stop was asked is `completed`, and the ask is its own row. ⚠️ Three endings are the
 * machine's own, written where no provider has spoken: `SessionMachine.forceEnd` (Claude's Stop
 * after its receipt, and every close) always says `interrupted`; `failTurn` and a fatal error say it
 * only after an ask. ⚑ **Since `720` (R71) those three carry {@link wordOf}**, so the ledger says
 * whose word it holds.
 */
const turnEventSchema = z.object({
  type: z.literal('turn'),
  state: z.enum(['completed', 'failed', 'interrupted']),
  /** Codex `turnId` when available; correlation only. */
  turnId: z.string().optional(),
  /**
   * 🔴 **`720` · R71 — present when THIS APP wrote the word, not the provider.**
   *
   * ⚑ The ruling (`709` F-1): *"A stop the APP forces (`forceEnd` on a Stop or a Close) records its
   * word as the app's act, never as the provider's."* ⚑ Set on the three endings
   * `SessionMachine` writes itself — `forceEnd`, `failTurn` and a fatal error's terminal — and on
   * nothing a provider said. ⚠️ `forceEnd` ends a turn AHEAD of the provider and absorbs its later
   * word unread (123's debt), so a row carrying this is the app's act: the provider's own ending
   * for that work is in no row.
   *
   * ⛔ **Absent is not proof of the provider's word on an old ledger.** Rows written before `720`
   * carry none, whoever wrote them, and nothing is backfilled (`HO-029` §2.2). ⚠️ Declared here or
   * not at all: the schema is not strict, so an undeclared key is stripped silently at every wire
   * crossing (`toWireEvent`) and would never reach the ledger.
   */
  wordOf: z.literal('this-app').optional(),
  /**
   * 🔴 **F074 — the turn ended on its provider's usage limit**, and what the provider said about
   * it. ⚑ Only on a `failed` turn, and only from the provider's own signals:
   *   - Claude: the turn's synthetic reply carried `error: 'rate_limit'`, and the window and reset
   *     come from the newest `rate_limit_event` with `status: 'rejected'` (measured to arrive
   *     before the turn's `result` — `test/fixtures/claude-limit-notice.json`).
   *   - Codex: `turn/completed` failed with `codexErrorInfo: 'usageLimitExceeded'`; the reset is
   *     the reached window's, as the rate-limit reads gave it.
   *
   * ⚠️ Recorded IN the ending, so a reader of the turn — the stall notice, the piece's record —
   * never has to find the limit among errors written around it. Absent on every other turn.
   */
  limit: z
    .object({
      /** Whose limit — the provider that refused the turn, so the row says it without a lookup. */
      provider: providerSchema,
      /** The window the provider named (`five_hour`, `seven_day`, a Codex limit) — as it spelled it. */
      window: z.string().max(120).optional(),
      /** When the provider said it resets, epoch ms; absent when it did not say. */
      resetsAt: z.number().optional(),
      /**
       * The provider said more usage needs credits bought (Claude's `errorCode: 'credits_required'`):
       * its reset alone does not let the work go on.
       */
      creditsRequired: z.literal(true).optional(),
    })
    .optional(),
  /**
   * 🔴 **F076 — the turn ended because its provider refused the login this conversation was
   * launched with** — Claude's fatal `auth_stale` error that ended it (another Claude on this Mac
   * renewing or switching the login does this, as does a token that expired with nothing to renew
   * it), or Codex's `unauthorized` on the turn's own `turn/completed`. ⚑ Only on a `failed` turn, so
   * a reader of the turn — the stall notice, the piece's record — never has to find the cause among
   * the errors written before it. Absent on every other turn.
   */
  loginRefused: z.literal(true).optional(),
  /**
   * Beside {@link loginRefused} or {@link billingRefused} only: what was refused was an API key,
   * see {@link errorCauseSchema}.
   */
  onAKey: z.literal(true).optional(),
  /**
   * The turn failed because the provider would not bill the account it runs on: Claude's
   * `billing_error`, or Codex's out-of-quota on an API key. Only on a `failed` turn, with
   * {@link onAKey} when that account is the saved key's. An optional flag rather than a new value
   * in a closed list, so an older build reading the row ignores it and sees a failed turn.
   */
  billingRefused: z.literal(true).optional(),
  /**
   * ⚑ **F084 — the commands this turn's stop ended**, each by the id of the tool call that started
   * it, as its adapter ended them or saw them end. ⚑ Codex: what its stop terminated
   * (`CodexSessionHandle.endWhatTheTurnStarted`). Claude: the Bash the turn was waiting on, which
   * the CLI ends on a stop (measured). ⚠️ Recorded IN the ending, so the giver's notice and the
   * stopped agent's next turn read them from the turn itself. Absent when a stop ended none.
   */
  endedCommands: z.array(z.string().max(MAX_BACKGROUND_ID)).max(MAX_BACKGROUND_WORK).optional(),
  /**
   * 🔴 **F080 — a turn the PROVIDER started by itself** ({@link providerTurnSchema}): Claude Code
   * waking its agent when a background task ends, or answering in a loop of its own. ⚑ On the ending
   * of such a turn only, so a reader of the turn row knows nobody's message began it. Absent on every
   * turn a message began.
   */
  startedBy: z.literal('the-provider').optional(),
})

/**
 * 🔴 **F080 — the provider began a turn by itself.** ⚑ Measured on CLI 2.1.287
 * (`probe:claude-provider-burst`, arm A): a background `sleep` ends after the agent's turn, and the
 * CLI sends `task_notification`, a fresh `system/init`, a whole model loop and its own `result`,
 * with no message of ours behind it. ⛔ Until F080 that work had no turn row — `get_agent_status`
 * said the agent's last turn had *finished* while it worked on for 43 minutes.
 *
 * ⚑ Written by `SessionMachine` when the main agent's model produces content with no turn open,
 * before that content, and it opens a turn in the ledger exactly as a `user_turn` does; the turn's
 * `turn` row, marked {@link turnEventSchema}'s `startedBy`, closes it. ⚠️ Codex has no such wake;
 * the machine is shared, so a Codex burst would be written the same way.
 */
const providerTurnSchema = z.object({
  type: z.literal('provider_turn'),
  /**
   * 🔴 **F035 — the scheduled one-shot whose time had come as this turn began, when it was the only
   * one**: the job the app takes this turn to have been begun for, with the minute it was due (epoch
   * ms). ⚑ Written by the app's host from the level it holds, never by an adapter — Claude's fire
   * frame names no job (`scheduled-work.ts`). ⚠️ Absent when none came due, and when several did:
   * then which one began it is not known. ⚠️ A reading of the clock against the level: a turn the end
   * of background work began while that one-shot was due and not yet fired is named the same.
   */
  oneShotCameDue: z
    .object({
      id: z.string().max(MAX_SCHEDULE_TEXT),
      schedule: z.string().max(MAX_SCHEDULE_TEXT).optional(),
      prompt: z.string().max(MAX_SCHEDULE_PROMPT).optional(),
      dueAt: z.number().finite().nonnegative(),
    })
    .optional(),
})

/**
 * A coalesced chunk of streamed assistant text (001 gap 5 / streaming).
 *   - Claude: `content_block_delta` / `text_delta` (needs `includePartialMessages`).
 *   - Codex:  `item/agentMessage/delta`.
 * Adapters coalesce raw token deltas, then emit one authoritative
 * `assistant_message`.
 *
 * ⛔ **No `parentToolCallId` here, and that is a measurement rather than an omission** (128).
 * `SDKPartialAssistantMessage` declares `parent_tool_use_id: string | null` (sdk.d.ts:5282-5292), so
 * the field exists on every partial frame — and across the whole of this machine's ledger **4,220
 * stream frames carry that key and not one of them is non-null**, the sub-agent windows included.
 * A child's prose reaches us only as the authoritative message; its deltas are never forwarded. So
 * the head glimpse on the card fills at message boundary, which is honest, and a `parentToolCallId`
 * on this event would be machinery a type declaration justified and no traffic has ever exercised.
 */
const assistantDeltaSchema = z.object({
  type: z.literal('assistant_delta'),
  text: z.string(),
})

/**
 * The authoritative final assistant message for a turn — the source of truth
 * the UI should render (replacing any delta-accumulated text). Preceding
 * `assistant_delta`s are best-effort progressive rendering and are NOT
 * guaranteed to concatenate exactly to this text.
 *   - Claude: `SDKAssistantMessage` text blocks.
 *   - Codex:  `item/completed` agentMessage.
 */
const assistantMessageSchema = z.object({
  type: z.literal('assistant_message'),
  text: z.string(),
  /**
   * WHOSE words these are (128) — the same attribution {@link toolCallSchema} has carried since 029,
   * on the other half of the very same message.
   *
   * ⛔ **029 fixed the tools and left the speech, and the two halves come from one envelope.**
   * `normalize.ts` computes the parent once per assistant message and spread it onto every
   * `tool_call` in that message while flushing the text runs beside them with nothing — so a child
   * that talked arrived in the conversation indistinguishable from the parent, which is the
   * misattribution 029 was written to end.
   *
   * Retain the parent tool-call id on child content, not only child tool calls. Otherwise forwarded background messages become loose top-level turns and foreground child text can disappear despite its envelope carrying a valid parent.
   *
   * Absent means the main agent said it, which is the overwhelmingly common case.
   */
  parentToolCallId: z.string().optional(),
  /**
   * ⚑ **Questions the agent asked WITHOUT waiting for the answer** (provider follow-ups 1) — Codex's
   * `request_user_input_async`, which `gpt-6.1-sol` offers: an `agentMessage` with
   * `delivery: "async"` and `questions`, while the turn goes on. The `text` already carries every
   * title and option, so nothing is lost where this is not drawn; it is here so a surface can draw
   * the options as choices. ⛔ **Nothing waits on them**: no request was raised, and an answer is an
   * ordinary reply. Bounded ({@link ASKED_QUESTION_LIMITS}). Absent on every other message.
   */
  questions: z
    .array(z.object({ title: z.string(), options: z.array(z.string()).optional() }))
    .optional(),
})

/**
 * 🔒 **How much of an asked question an event carries** — the provider bounds none of it, and the
 * message's `text` keeps the whole. Past a count the rest is dropped; past a length a string is cut
 * with an ellipsis (it is a choice to show, and the text is the record).
 */
export const ASKED_QUESTION_LIMITS = {
  questions: 10,
  options: 10,
  titleChars: 2000,
  optionChars: 500,
} as const

/**
 * The agent invoked a tool. `id` correlates with the matching `tool_result`
 * (001: Claude tool_use / Codex `itemId`).
 */
/**
 * ⛔ **How long a memory target may be, on a row that exists to be READABLE** (330).
 *
 * ⚠️ **Much shorter than {@link MAX_RECALL_PATH}'s 4096, and that is a different question rather
 * than a disagreement.** That one bounds a path the MODEL wrote in prose, where the rule is *"a path
 * is DROPPED, never clipped"* because a shortened path is a wrong path. This one is DERIVED by this
 * app from a store root it attested, it is a filename inside one directory, and the untruncated
 * absolute path is on the same row's `summary` either way — so nothing is lost by bounding it and a
 * field that could carry four kilobytes into a one-line row is a field that will.
 *
 * ⚑ The provider's own memory instruction is *"write each memory to its own file (e.g.
 * `user_role.md`, `feedback_testing.md`)"*, and `NAME_MAX` is 255. This is that, with room for the
 * subdirectory a store may grow.
 */
export const MAX_MEMORY_PATH = 512

const toolCallSchema = z.object({
  type: z.literal('tool_call'),
  /** Claude tool_use id / Codex itemId — correlates to `tool_result`. */
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  /**
   * The DISPATCH tool-use id of the sub-agent that made this call, when it was not the main agent
   * (029). Claude's SDK forwards a sub-agent's `tool_use`/`tool_result` blocks into the parent
   * stream **by default** — `forwardSubagentText` only adds its prose on top — with
   * `parent_tool_use_id` naming the dispatch. Nothing read that field before 029, so a sub-agent's
   * `Bash` rendered in the parent conversation as if the parent had run it: not a missing feature
   * but a misattribution, and one the user had no way to notice.
   *
   * Absent means the main agent did it, which is the overwhelmingly common case.
   */
  parentToolCallId: z.string().optional(),
  /**
   * The id this provider accepts to list or stop the work this call started (247) — Codex states a
   * command's `processId` at `item/started`, so it is available a whole turn before any result.
   *
   * See {@link toolResultSchema}'s field of the same name for why presence is not a running claim.
   */
  backgroundId: z.string().max(MAX_BACKGROUND_ID).optional(),
  /**
   * 🔴 **This call's target, inside the profile's own memory store, relative to it** (330).
   *
   * A memory write arrives as an ordinary file-tool row. Preserve its store-relative target so a badge can identify it even when the full path's informative tail is truncated.
   *
   * ## ⚑ Where the store's location comes from — the PROVIDER, measured
   *
   * `330` §2 enumerated every key path at every depth of a real `2.1.218` session and found
   * `system/init.memory_paths.auto`: the directory the CLI's own resolver settled on, sent back on
   * every `init` frame. ⚠️ **Not our `claudeAutoMemoryDir` echoed** — the resolver takes
   * `policySettings` above the `flagSettings` this app writes, so the two can disagree and only one
   * of them is where the agent is actually writing. See `ClaudeMemoryStore`.
   *
   * ## ⚠️ What it is NOT
   *
   * ⛔ **Not a claim that the call succeeded** — it is read off the tool_use block, so a refused or
   * failed write still carries it and its `tool_result` still says `ok: false`. The row says where
   * the agent reached, which is true either way.
   *
   * ⛔ **Not derived from a `Bash` command string, ever.** `330` §3.3: grepping a shell command for
   * the store path is how a label becomes a lie. This is read only off a declared path field, by
   * `namesATarget` — the same classifier the permission layer uses — so the label and the card
   * cannot disagree about which string is the target.
   *
   * ⚑ **Not the whole path.** `summary` still carries that, untruncated, exactly as before.
   *
   * ⚠️ **Absent is the ordinary case**, and absent means *"nothing said this was in the store"* —
   * no `init` seen, no `memory_paths` on this build, a root that failed attestation, or a path
   * outside. Never *"it is not a memory"*: this app cannot say that about a provider that stopped
   * publishing where its memory lives.
   */
  memoryPath: z.string().max(MAX_MEMORY_PATH).optional(),
})

/** A tool finished. `ok` from Claude's error marker / Codex terminal status. */
const toolResultSchema = z.object({
  type: z.literal('tool_result'),
  id: z.string(),
  summary: z.string(),
  ok: z.boolean(),
  /** The app's message receipt identity, echoed by this exact provider tool result. */
  messageAct: z.string().max(48).refine(isMessageAct).optional(),
  /** Same attribution as {@link toolCallSchema}, carried so a result can be routed without
   *  depending on its call having been seen first. */
  parentToolCallId: z.string().optional(),
  /**
   * ⛔ **This receipt is a DETACHMENT, not a completion: the work it describes is still running**
   * (247).
   *
   * ⚠️ **`ok` stays `true` and that is correct** — the provider really did succeed at detaching, and
   * rewriting it to `false` would trade one lie for another by calling a successful backgrounding a
   * failure. What was missing is not a different `ok`; it is the sentence beside it. Measured live,
   * `245`'s window reproduced from the reachable path: BroBot settled the card at **6 102 ms** with
   * `ok:true` and the text *"Command running in background with ID: b23pvshmy…"*, and the command
   * ran until **36 150 ms**. Nothing in the transcript changed in between.
   *
   * ⚑ **Read this, not the summary text.** The receipt's wording is the provider's and has already
   * changed shape once across pins; this flag is derived from the level set, which is a fact.
   *
   * Absent means "not backgrounded, as far as the provider has said" — the ordinary case.
   */
  backgrounded: z.boolean().optional(),
  /**
   * The id this provider accepts to LIST or STOP the work this tool started (247) — Claude's
   * `task_id`, Codex's `processId`.
   *
   * ⚠️ **Its presence is not a claim that the work is backgrounded**; {@link backgrounded} is. Codex
   * puts a `processId` on every PTY-backed command it runs, foreground included, and reporting that
   * as "still running" would be the false-settled card's mirror image. It is here so a stop control
   * has something to call without re-deriving the binding from a registry payload the SDK's own doc
   * says not to correlate with this stream.
   */
  backgroundId: z.string().max(MAX_BACKGROUND_ID).optional(),
  /**
   * ⚑ **How long the tool itself took, as the PROVIDER measured it** (327) — milliseconds.
   *
   * ⛔ **Not the same measurement as the duration the row can already derive**, which is the gap
   * between two `RuntimeHost` delivery stamps and therefore includes transport and the host's own
   * pump. In the one capture carrying both, the envelopes were 7 ms apart and the item's own
   * `durationMs` was 4. A surface that has this should prefer it and show ONE duration, never two.
   *
   * ⚠️ **`0` is a value, not an absence.** A tool that failed instantly reported exactly that.
   *
   * ⛔ **Absent for a DETACHED call, by construction**: the work is still running, so no duration for
   * it exists yet — `248`'s rule that the receipt's timing must never be printed as the work's.
   *
   * Only Codex's `mcpToolCall` sets it today. Claude's SDK reports no per-tool duration at all, so
   * absence here means "this provider did not say", never "it was instantaneous".
   */
  durationMs: z.number().finite().nonnegative().optional(),
})

/**
 * A command/file approval — Slice-1 first-class (001 gap 3). Answer via
 * `respondPermission(id, decision)`; leaving it unanswered hangs the provider.
 *   - Claude: `canUseTool` (id = `toolUseID`, action = tool name).
 *   - Codex:  `item/commandExecution/requestApproval` (`kind: 'command'`) or
 *             `item/fileChange/requestApproval` (`kind: 'file'`); id = RPC id.
 */
/**
 * The explicit, visible ceiling on a permission card's disclosure (071, from 069 finding 1).
 *
 * 069 asked for the command in full and named the only acceptable form of a bound: *"If a transport
 * bound is wanted it must be explicit and visible — a marked truncation the user can see, and never
 * a silent one."* This is that bound. It is 64 Ki **characters**, deliberately the same order as
 * {@link MAX_UNKNOWN_RAW_BYTES}, because the hazard is the same one — a single tool input becoming a
 * permanent row in every store downstream — and two unrelated numbers for one hazard is how one of
 * them ends up stale.
 *
 * It is ~565× the longest command this app has ever recorded on a card — 116 characters, measured
 * over the whole ledger, not the largest imaginable — so no real approval is anywhere near it. That
 * is the point: a bound nothing legitimate reaches is a bound whose marking nobody has to read.
 */
export const MAX_PERMISSION_DETAIL_CHARS = 64 * 1024

/** A disclosure and, when the bound bit, how much of it is missing. */
export interface BoundedDetail {
  detail: string
  detailOmitted?: number
}

/**
 * Apply {@link MAX_PERMISSION_DETAIL_CHARS}, saying so when it bites.
 *
 * Truncated rather than dropped — the opposite of {@link boundRaw}'s choice, and for the
 * opposite reason. An oversized `unknown` payload is a verbatim copy whose whole value is being
 * verbatim, so a fragment of it is a lie; a command's first 64 KiB is genuinely the first 64 KiB of
 * what will run, and hiding it would leave the user with less than the truncation did. What must
 * never happen — and what 069 found — is the fragment being handed over as though it were whole.
 */
export function boundPermissionDetail(detail: string): BoundedDetail {
  if (detail.length <= MAX_PERMISSION_DETAIL_CHARS) return { detail }
  // Never cut a surrogate PAIR in half. A lone surrogate is not a character: `JSON.stringify`
  // escapes it, SQLite keeps it, and the card renders a replacement glyph — a tiny lie in the one
  // string this whole change exists to keep honest. One character back is the whole fix, and the
  // count below is derived from what was kept rather than from the limit, so the two cannot drift.
  const cut = isHighSurrogate(detail.charCodeAt(MAX_PERMISSION_DETAIL_CHARS - 1))
    ? MAX_PERMISSION_DETAIL_CHARS - 1
    : MAX_PERMISSION_DETAIL_CHARS
  return { detail: detail.slice(0, cut), detailOmitted: detail.length - cut }
}

/** The leading half of a surrogate pair. See {@link isLowSurrogate} for the other one. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

const permissionRequestSchema = z.object({
  type: z.literal('permission_request'),
  id: z.string(),
  kind: z.enum(['command', 'file']),
  action: z.string(),
  /**
   * **What approving this actually authorizes, in full** (071, from 069 finding 1).
   *
   * It used to be `command.slice(0, 200)` on the Claude side, and the remainder was never carried on
   * this event at all — so a command with a readable prefix and `; curl … | sh` past the boundary
   * reached a card that rendered it with no ellipsis and no way to see the rest, and Allow returned
   * for the whole thing. 069: *"It is 007 P1-7's class inverted: that defect was a grant covering
   * more than the card showed; this is a card displaying less than Allow authorizes."*
   *
   * An adapter MUST put the whole disclosure here. If it cannot, it says so in `detailOmitted`
   * below — never silently.
   */
  detail: z.string(),
  /**
   * How many characters of {@link detail} are **not** here (071). Absent ⇒ the disclosure is whole.
   *
   * The bound is {@link MAX_PERMISSION_DETAIL_CHARS} and it exists so one pathological tool input
   * cannot put a megabyte in every downstream store. What matters is that exceeding it is a FACT ON
   * THE EVENT rather than a shorter string: the card renders this in its own chrome, so the marker
   * cannot be forged by a model that writes "… (truncated)" into its own command.
   */
  detailOmitted: z.number().int().positive().optional(),
  /**
   * The provider's own one-sentence rendering of the request, when it sends one — *"Claude wants to
   * read foo.txt"* (071). A label BESIDE the disclosure, never instead of it.
   *
   * It exists because the pinned SDK offers `title` on the `canUseTool` options and says *"Use this
   * as the primary prompt text when present instead of reconstructing from toolName+input"*
   * (`sdk.d.ts:249`) — advice this app cannot take, because "the primary prompt text" and "the thing
   * Allow authorizes" are not the same string, and the second one is what a card is for. Taking it
   * was the older shape (`detail: options.title ?? summarize(…)`) and it disclosed *less* than the
   * truncation did.
   *
   * **Measured before it was wired**: across all 23 Claude permission requests in this app's ledger,
   * `title` was absent — every recorded `detail` is exactly the input-derived value (16 bare tool
   * names, 4 file paths, 3 verbatim commands). So this is the field for a sentence that has never
   * yet arrived, kept because it is genuinely better than a bare tool name on the 16 cards that had
   * nothing else to show.
   */
  summary: z.string().optional(),
  /**
   * Provider-neutral security scope (014, fixing 007 P1-7) — the full
   * consequence of approving (cwd, paths, network, persistence/grant root,
   * amendments, allowed decisions). Populated by both adapters; carries NO raw
   * provider payload. See {@link permissionScopeSchema}.
   */
  scope: permissionScopeSchema,
  /**
   * 🔴 **695 · R36a — the provider said this ask must offer no *"don't ask again"*.** Present only
   * as `true`, and only when the provider marked the ask; absent on every other card and on every
   * row written before 695, which is why it is optional.
   *
   * ⚑ The pinned SDK (0.3.281, `sdk.d.ts:268-272`): *"The ask must not offer a persistent 'don't
   * ask again' choice: the rule it would write grants more than this ask's own action."* Measured
   * by `probe:permission-markers` on CLI 2.1.281: `echo … &` — a background operator — arrives
   * marked, `echo …` does not. ⛔ **It is a fact about the offer, and the offer already obeys it**:
   * the adapter withholds both session grants from {@link permissionScopeSchema}'s
   * `availableDecisions` and refuses them at `respondPermission`. This flag is what lets a surface
   * say WHY there is no such button, rather than leaving a person to wonder where it went.
   */
  suppressAlwaysAllowRule: z.literal(true).optional(),
  /**
   * 🔴 **695 · R36b — the provider said *no* is this ask's default.** Present only as `true`.
   *
   * ⚑ The pinned SDK (`sdk.d.ts:263-267`): *"The ask must not be approvable by a single stray
   * keystroke: open the prompt on its decline option and offer no one-key approve shortcut."* A card
   * that carries it draws Deny as its primary answer. ⚠️ **Not measured live**: no BroBot ask
   * carries it today, and the surface is ready for the day one does.
   */
  defaultToNo: z.literal(true).optional(),
  /**
   * 🔴 **700 · `695` F-f — the provider's own reason for an ask it MARKED, in its words.** Present
   * only beside {@link suppressAlwaysAllowRule} or {@link defaultToNo}, and absent on every other
   * card and on every row written before 700 — ⚑ **with ONE named exception since `720` (R73)**: a
   * Codex command an exec-policy `prompt` rule stopped, beside {@link providerReasonFrom}. *"`700`'s
   * 'marked asks only' contract widens to this one named case, and no further."*
   *
   * ⚑ **Measured by `probe:permission-markers` (`695`, CLI 2.1.281):** the marked `echo r36 &` said
   * *"This command uses the `&` background operator, which defers execution past approval-time
   * safety checks. Approve only if you trust it."* ⚠️ **The SDK hands over a reason on EVERY ask**,
   * and on the unmarked control it was *"brobot2 requires explicit approval for consequential
   * tools"*: our own guard hook's words, echoed back. ⛔ So the adapter carries it only where the
   * provider marked the ask, and never where the words are its own hook's: a surface draws this as
   * *the provider's* reason, and on the unmarked arm that would be false.
   *
   * ⚠️ **Cleaned, never reworded.** The CLI's own schema says the field *"may carry ANSI escapes;
   * sanitize before rendering"*, so the adapter takes out terminal escapes and the marks that
   * reorder drawn text, and turns a control character into a space. A reason longer than {@link MAX_PERMISSION_DETAIL_CHARS} is
   * dropped rather than cut, as {@link summary} is.
   */
  providerReason: z.string().optional(),
  /**
   * 🔴 **`720` · R73 — {@link providerReason} is a POLICY's rule, not a mark's reason.**
   *
   * ⚑ The ruling (`709` F-5): *"A policy's own words are the provider's. Codex's '… requires
   * approval: <rule text>' is carried as the provider's words (`providerReason`), labelled as
   * Codex's rule."* ⚑ Measured by `probe:codex-approval-reason` (bundled 0.146.0): an exec-policy
   * `prompt` rule stops a command, and Codex writes the request's `reason` itself — *"`<command>`
   * requires approval: <the rule's text>"* — over the model's own escalation. The provider is the
   * session's; this names what KIND of its words they are, so a surface can say *its rule*.
   *
   * ⛔ **Present only beside a `providerReason`, and only on that one Codex shape** (the adapter's
   * `thePolicysWords`). ⚠️ The words are tied to the request's own `command`, but no field on the
   * wire separates a policy stop from a model escalation Codex offered no rule for (`709` F-11), so a
   * model that wrote Codex's exact sentence about the exact command would be labelled a rule — a
   * bound stated here, as `700`'s refusal of our own hook's words is.
   */
  providerReasonFrom: z.literal('a-policy-rule').optional(),
  /**
   * 🔴 **709 · R44 — the MODEL's own words for this ask, carried under its author's name.** Present
   * only on the approval shape MEASURED to carry them — a command the model escalated with a
   * justification (a `command` with Codex's offered prefix rule, and no network context, subcommand
   * `approvalId` or `additionalPermissions`); absent on every other card, and on every row before
   * 709. (A permissions request carries its own, on `UserInputPermission`.) ⛔ A command an exec-policy `prompt` rule stopped has the same
   * `command` and no offered rule, and Codex writes its `reason` itself (*"… requires approval: …"*)
   * — measured, so it is never carried here.
   *
   * ⚑ **Measured, not assumed** (`probe:codex-approval-reason`, bundled Codex 0.146.0 on BroBot's
   * `ask` profile): a command escalated with a `justification` arrives with `reason` equal to it,
   * verbatim — Codex's own instructions tell the model to put *"a short question asking the user if
   * they want to allow the action"* there — and one escalated without a justification has no
   * `reason` at all.
   *
   * ⛔ **Never the disclosure of what Allow runs** (`181`): {@link detail} is still the command, and
   * this is a sentence the agent wrote ABOUT it. ⛔ **Never the provider's**: it is not
   * {@link providerReason}, which is words the provider itself wrote. ⚑ **The drawing is the
   * frontend's**: this app's rule is that a model's words on a card are drawn as that agent's words,
   * by the agent's name — so the field says who wrote it, and the card says whose name that is.
   *
   * ⚠️ **Cleaned, never reworded** — `wordsForACard` (`words-on-a-card.ts`), the same policy as
   * {@link providerReason}.
   */
  agentReason: z.string().optional(),
  /**
   * 🔴 **723 · R80 — the provider asks before an EXTERNAL MCP server's tool runs: which server,
   * which tool, and with what.** Present only on that card; absent on every other, and on every row
   * written before 723.
   *
   * ⚑ The ruling (`720` F-A): *"Codex's own approval (`mcpServer/elicitation/request` with
   * `_meta.codex_approval_kind: 'mcp_tool_call'`) becomes a card naming the server, the tool and the
   * parameters (`tool_params_display`)."* ⚑ Measured by `probe:codex-mcp-tool-approval` (bundled
   * Codex 0.146.0, BroBot's `ask` profile): the frame names the server (`serverName`) and the
   * parameters (`_meta.tool_params_display`, one `{name, value, display_name}` each), and the tool
   * only inside Codex's own question — *"Allow the <server> MCP server to run tool "<tool>"?"*.
   *
   * - `server` — the server's name as Codex sent it, never composed.
   * - `tool` — the tool Codex's OWN running `mcpToolCall` item names. ⛔ **Never a string read out
   *   of a question alone**: a server can send a form wearing Codex's marker and any question it
   *   likes (measured, the probe's `spoof` arm), so a card exists only for a call Codex's item says
   *   is running and waiting — and its question, where it names a tool, must name that one.
   * - `parameters` — each parameter's display name and value, in Codex's order; a value that is
   *   not a string is its JSON. ⚠️ **Cleaned** by `wordsForACard`, like every provider string a
   *   surface draws — and so a display, never the disclosure: {@link detail} is the call's whole
   *   parameters, as JSON.
   * - `parametersOmitted` — how many were left out to keep the list inside
   *   {@link MAX_PERMISSION_DETAIL_CHARS}; absent ⇒ none. A fact on the event rather than a shorter
   *   list, for {@link detailOmitted}'s reason.
   */
  mcpToolCall: z
    .object({
      server: z.string(),
      tool: z.string(),
      parameters: z.array(z.object({ name: z.string(), value: z.string() })),
      parametersOmitted: z.number().int().positive().optional(),
    })
    .optional(),
  /**
   * 🔴 **723 · R81 — this card's Cancel asks no turn to stop.** Present only as `true`, on every
   * card whose Cancel is the provider's own cancel and nothing more; absent on every other card, and
   * on every row written before 723.
   *
   * ⚑ The ruling (`720` F-B): *"When the frame names no turn, its line says only what the press does
   * (the request is cancelled; the turn is not asked to stop), and the host records no ask."* ⚠️
   * **Only an MCP elicitation can arrive without a turn** — every other request's `turnId` is
   * required, and one without it is refused before a card exists — so from `723` until `736` only a
   * frame that named no turn carried it. ⚑ Since `736` (R97) EVERY external-MCP elicitation card on
   * Codex carries it, whether or not its frame named a turn, and so does Claude's server form
   * (`728`). ⛔ **A fact about the press, and the adapter already obeys it**: such a Cancel sends the
   * provider no `turn/interrupt` and latches nothing. This is what lets a surface say so, and what
   * tells the host the press is no ask (`user_decision.stopsNothing`).
   */
  cancelStopsNothing: z.literal(true).optional(),
  /**
   * 🔴 **728 · R93 — an MCP SERVER is asking the person, not the agent.** Present on the card a
   * server's own request raises — a form, a zero-field form, a url visit — on both providers; absent
   * on every other card (Codex's own approval of a tool call carries {@link mcpToolCall} instead), and
   * on every row written before `728`. ⚠️ **Except the one `723` F-2 leaves open**: a frame wearing
   * Codex's marker during a call Codex ran unasked is drawn as Codex's, unmarked.
   *
   * ⚑ R93 keeps *"saying truly WHO is asking and WHAT a press does"*. Until `728` nothing on the event
   * said a card was a server's: a surface drew *"the agent may do this once"* under Allow, and the
   * question channel carried a server's form to a parent agent as the MODEL's question. ⚑ Read by
   * both now: the renderer's `serversAskOf` says what the SERVER is told under each button, and
   * `askedOfTheChannel` refuses it by name. `server` is the name the provider sent, never composed.
   */
  mcpServerAsks: z
    .object({
      server: z.string(),
      /** ⚑ The page a server's `url` request asks the person to open, as sent (provider follow-ups 1). */
      url: z.string().optional(),
    })
    .optional(),
})

/**
 * A server-initiated request that is NOT a plain command/file approval (001
 * gaps 3 & 4): Claude `AskUserQuestion`, Codex `item/tool/requestUserInput` or
 * `item/permissions/requestApproval` (permission-profile subset grants). It is
 * surfaced (never silently dropped) and MUST be answered via
 * `respondUserInput(id, response)`; `{ kind: 'reject' }` is the protocol-safe
 * default so the provider cannot hang.
 *
 * Carries the **typed, neutral** request scope for a future UI to answer (020,
 * fixing 007 P2-1): `questions` (id + prompt + options) and, for a permission
 * grant, `permission`. It carries **no raw provider payload** — the adapter keeps
 * the original typed request to build a provider-valid answer/decline (mirrors
 * 014's `PermissionScope`).
 */
const userInputRequestSchema = z.object({
  type: z.literal('user_input_request'),
  id: z.string(),
  prompt: z.string(),
  /** Structured questions to answer (empty for a pure permission-grant request). */
  questions: z.array(userInputQuestionSchema),
  /** The requested scope of a permission-grant request (Codex permissions requestApproval). */
  permission: userInputPermissionSchema.optional(),
  /**
   * 🔴 **Which way approving a zero-question CONSENT card moves this conversation** (478).
   *
   * ⛔ **Absent on every request that is not one of those**, and it is the adapter that knows:
   * Claude's `PLAN_GESTURES` is the map that actually moves the floor, and this is read off the
   * same map at the same moment, so the card and the effect cannot come apart. ⚠️ **A card with
   * neither this nor {@link userInputPermissionSchema} is a consent this app cannot name**, and a
   * surface must say so rather than pick one of these two.
   *
   * ## ⚠️ Why the DIRECTION and not just *"a plan card"*
   *
   * ⛔ **The two directions are not one effect with a sign on it.** Approving `ExitPlanMode` ends plan
   * mode and approving `EnterPlanMode` started it (⚑ `728`: the provider's own plan mode; BroBot's
   * read-only floor that each used to move is gone, R93). ⚑ Since `736` (R98) no `EnterPlanMode`
   * card is raised — the CLI does not ask before it — so `start-planning` is on older rows only. `476` read both as one *"Enter/ExitPlanMode
   * consent"*; that is the same sentence over two materially different effects, which is the defect
   * `478` was sent at, one level further in.
   *
   * ## ⛔ Optional because the LEDGER is older than this field
   *
   * ⚠️ This schema is also the stored-event contract. A `user_input_request` written before `478`
   * carries no key here, and it must still parse — so the absence means *nobody said*, exactly as
   * `477`'s ruling has it, and never *"neither direction"*.
   */
  consent: z.enum(PLAN_CONSENTS).optional(),
  /**
   * ⚑ **Codex's own `isBlocking`, carried as DATA and nothing more** (provider follow-ups 1, W4's
   * ruling). 0.160.0 sets it `true` only in Plan mode; ⛔ it does NOT mean the turn goes on without
   * the answer — Codex's `request_user_input` waits for the answer either way (its source:
   * `session/mod.rs` awaits it unconditionally), so this card puts the conversation in "waiting on
   * you" whatever it says. Absent where the provider did not send it.
   */
  isBlocking: z.boolean().optional(),
  /**
   * 🔴 **728 · R93 — an MCP SERVER is asking the person, not the agent.** Present on the card a
   * server's own request raises — a form, a zero-field form, a url visit — on both providers; absent
   * on every other card (Codex's own approval of a tool call carries {@link mcpToolCall} instead), and
   * on every row written before `728`. ⚠️ **Except the one `723` F-2 leaves open**: a frame wearing
   * Codex's marker during a call Codex ran unasked is drawn as Codex's, unmarked.
   *
   * ⚑ R93 keeps *"saying truly WHO is asking and WHAT a press does"*. Until `728` nothing on the event
   * said a card was a server's: a surface drew *"the agent may do this once"* under Allow, and the
   * question channel carried a server's form to a parent agent as the MODEL's question. ⚑ Read by
   * both now: the renderer's `serversAskOf` says what the SERVER is told under each button, and
   * `askedOfTheChannel` refuses it by name. `server` is the name the provider sent, never composed.
   */
  mcpServerAsks: z
    .object({
      server: z.string(),
      /** ⚑ The page a server's `url` request asks the person to open, as sent (provider follow-ups 1). */
      url: z.string().optional(),
    })
    .optional(),
})

/**
 * A pending `permission_request` / `user_input_request` was **resolved or cleared by the
 * PROVIDER**, not by this app (051, fixing 044 GO-blocking P2 #1).
 *
 * Codex clears server requests on turn start/completion/interruption and confirms it with
 * `serverRequest/resolved`. Ignoring that left a card actionable after the provider had already
 * moved on — and a late answer to a cleared request was still written to the wire, which is an
 * out-of-lifecycle authorization. This event is the neutral signal that the request is gone: the
 * adapter has already retired it (no further response will be sent, and answering it is refused),
 * so the UI must stop offering it.
 *
 * `id` is the SAME neutral request id the card carries, so correlation needs nothing else — and
 * nothing provider-specific crosses the boundary.
 */
const requestResolvedSchema = z.object({
  type: z.literal('request_resolved'),
  id: z.string(),
})

/**
 * The orthogonal session-status machine (reused from `@brobot2/shared`):
 * `idle | working | waiting_permission | ended | errored`. Derived by adapters
 * from init/status/callback/result/process lifecycle (001 §Q7).
 */
const statusEventSchema = z.object({
  type: z.literal('status'),
  state: sessionStatusSchema,
  /**
   * 🔴 **F076 — the session ended because its provider refused the login it was launched with** —
   * on the terminal `errored` status a fatal `auth_stale` error leads to, and nowhere else. ⚑ Said
   * here as well as on the turn it failed: the session's own ending carries it whichever turn — this
   * app's, or one its provider started by itself (F080) — the refusal cut, and when none was running.
   */
  loginRefused: z.literal(true).optional(),
  /** ⚑ Beside {@link loginRefused} only: what was refused was an API key, see {@link errorCauseSchema}. */
  onAKey: z.literal(true).optional(),
})

/**
 * Why an error is being reported, when the provider said in a word rather than in a sentence (098).
 *
 * `auth` — the credential was rejected and **the app cannot reach a better one**: it cannot start a
 * turn until someone signs in again. Codex says this as `TurnError.codexErrorInfo: "unauthorized"`.
 * Claude uses it when the machine still holds the same login the provider just rejected.
 *
 * `auth_stale` — the credential **this session was launched with** is no longer accepted, and a
 * fresh launch reads the current machine login. Reopening may recover on a renewed login;
 * an absent or rejected current login still needs sign-in.
 *
 * ⚑ **`onAKey` says which credential it was.** A Claude child launched on the API key a
 * person saved meets the same refusal when the key stops working (401), and the Mac's login has
 * nothing to do with it: no renewal elsewhere caused it and none will cure it. So the error, the
 * `turn` it fails and the session's terminal `status` carry `onAKey: true` beside the refusal, and a
 * surface says the key was refused and where to check or replace it. Absent means the Mac's login
 * (a row written before the field is read the same way, and says nothing either way).
 *
 * ⚑ **Codex's `auth` carries it too**: a Codex home logged in with the saved OpenAI key, whose key
 * OpenAI refuses, meets `auth` — and *"sign in again"* is no remedy for a key. Absent there means the
 * profile's ChatGPT sign-in.
 *
 * ## Why the second member was earned, measured (110)
 *
 * A Claude child receives a Keychain access token in `CLAUDE_CODE_OAUTH_TOKEN` at launch, without a refresh token or live reread. Another client can rotate that machine credential and revoke the child's snapshot while newly started sessions still authenticate successfully.
 *
 * So the machine login was **healthy** the whole time, and 098's remedy — *"start a new conversation
 * to sign in again"* — would have thrown away five hours of work to fix something that was not
 * broken. That is the surface offering something different, which is the bar a cause has to clear.
 *
 * ⚠️ **This is an addition to `message`, never a replacement for it.** 085's rule: the provider's own
 * diagnostic is the only copy of what actually happened and it belongs in the log and the ledger
 * verbatim. What a *surface* must not do is read it — matching the English is what makes an
 * adapter's rewording into a silent UI regression. So the sentence stays and a value goes beside it.
 */
const errorCauseSchema = z.enum(['auth', 'auth_stale'])
export type ErrorCause = z.infer<typeof errorCauseSchema>

/**
 * 🔴 **A refusal the adapter RECOGNISED, as values a surface can say something true and doable
 * with** (680, PM ruling R28c).
 *
 * ⚑ **The worked case, measured on the product's own `ClaudeRuntime` (680 §1):** at SDK 0.3.218 a
 * turn on `claude-opus-5-5[1m]` came back as the CLI's notice *"API Error: 400 Claude Code 2.1.218
 * does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update
 * the Claude desktop app, then try again."* ⛔ **Every word is true and the advice cannot work here**:
 * `claude update` and the desktop app change the person's OWN Claude Code, never the one this app
 * spawns from its own package. What works is the conversation's own setting — the same session,
 * moved to `claude-opus-5[1m]`, answered.
 *
 * ⚠️ **Values, never a sentence**, for {@link errorCauseSchema}'s reason: the provider's words stay
 * on `message` verbatim (085's split), and a surface renders its own line from these. `model` and
 * `runs` are what the CLI announced in that turn's own `system/init` — never a constant — and
 * `needs` is the floor the notice itself names. A notice this adapter does not recognise carries no
 * `refusal`, and the surface shows the provider's sentence (R28b): advice is never guessed. ⚑ Two
 * kinds, each a notice that ended a turn with advice this app cannot take: the floor, and a reply
 * cut at its output limit (see the second arm).
 */
const providerRefusalSchema = z.discriminatedUnion('is', [
  z.object({
    is: z.literal('model-needs-a-newer-cli'),
    /** The model the refused turn asked for, as the CLI announced it. */
    model: z.string(),
    /** The oldest Claude Code the provider says can run it. */
    needs: z.string(),
    /** The Claude Code this app spawned for that turn, as it announced itself. */
    runs: z.string(),
  }),
  /**
   * ⚑ **The CLI cut a reply at its output limit** (680's review): its notice tells the reader to set
   * `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, an environment variable of a child this app spawns with an
   * allow-listed environment — advice that cannot be taken here, so it is recognised and not shown.
   */
  z.object({
    is: z.literal('reply-cut-at-its-output-limit'),
    /** The output-token maximum the CLI says the reply exceeded. */
    limit: z.string(),
  }),
])
export type ProviderRefusal = z.infer<typeof providerRefusalSchema>

/** A recoverable or fatal error. Cancellation is NOT fatal (001 §Q7). */
const errorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  fatal: z.boolean(),
  /** Absent is the norm: most errors are just errors. See {@link errorCauseSchema}. */
  cause: errorCauseSchema.optional(),
  /** Absent unless the adapter recognised the refusal. See {@link providerRefusalSchema}. */
  refusal: providerRefusalSchema.optional(),
  /**
   * Beside a credential cause or {@link billingRefused} only: what was refused was an API key,
   * not a login, see {@link errorCauseSchema}.
   */
  onAKey: z.literal(true).optional(),
  /**
   * ⚑ Beside `cause: 'auth'` only, and never with {@link onAKey}: this app replaces this
   * conversation's refused copy of its sign-in with a fresher copy of the same account, where one
   * exists, and reopens the conversation on it. Said when the error is written, whether or not a
   * fresher copy is then found, so a surface can say what follows. Absent where this app replaces
   * no copy: another kind of sign-in, or a conversation that no longer runs on the copy it was
   * started on.
   */
  replacesRefusedSignIn: z.literal(true).optional(),
  /**
   * The provider would not bill the account this conversation runs on (Claude's `billing_error`,
   * Codex's out-of-quota on an API key). Not fatal: the conversation stays open and its next
   * message tries again. A flag rather than an {@link errorCauseSchema} value, so an older build
   * ignores it and shows the provider's own sentence.
   */
  billingRefused: z.literal(true).optional(),
  /**
   * The runtime's own notice that the provider has been silent. It is not provider progress: it
   * neither restarts the silence it reports nor changes what the last provider event was.
   */
  stall: z.literal(true).optional(),
  /** Beside {@link stall} only: the silence followed the model's reasoning. */
  thinking: z.literal(true).optional(),
  /**
   * Beside `fatal` only: the adapter ended the session itself because a check it makes failed, so
   * the provider's program did not stop on its own.
   */
  endedByItsAdapter: z.literal(true).optional(),
})

/**
 * 🔴 **The provider said, itself, that its own metered window is NOT blocking work** (586,
 * `HO-080` §1.3) — the record that can end a wall.
 *
 * ## ⛔ Why it is an event and not an inference
 *
 * ⚠️ **`shared/provider-limit.ts`'s own rule for the other direction is that `stopped` is only ever
 * the PROVIDER's own word** — Claude's `rate_limit_info.status: 'rejected'`, never a threshold of
 * ours. ⛔ **The retraction is held to the same standard where the provider offers one.** A turn
 * that completed is this app INFERRING that the provider answered; `status: 'allowed'` is the
 * provider stating the thing we are asking about, which is the PO's sentence verbatim.
 *
 * ## ⚑ It costs no row, and that is derived rather than hoped
 *
 * ⛔ **This frame was already being persisted.** `rate_limit_event` fires routinely and
 * `claude/normalize.ts` filed every non-throttling one as `unknown{category:'lifecycle'}` — a
 * stored row either way. ⚠️ **So promoting it changes the TYPE of a row that already existed and
 * adds none**: the cost is this schema, the two exhaustive switches over {@link RuntimeEvent}, and
 * one partial index — not storage and not noise. ⚑ It is the eleventh promotion out of `unknown`
 * and the third out of `lifecycle`, after `context_reading`, `compaction` and `reset`.
 *
 * ## ⚠️ It must stay QUIET on every surface, and that is the load-bearing half
 *
 * ⛔ **`unknown{lifecycle}` is dropped from the reading view** (`transcript-mode.ts`), so a
 * promotion that produced a transcript item would put one or two rows per turn in front of a person
 * who is reading a conversation. ⚑ It produces none — `transcript.ts` folds it into no item at all,
 * the way `provider_commands` and `tool_inventory` do — and the raw stream still shows the frame.
 *
 * ## 🔴 The WINDOW is what makes a retraction precise enough to be honest
 *
 * ⛔ **`HO-080` §1.2: *a wall must name what it blocks precisely enough that a success can disprove
 * it.*** ⚑ Claude's `allowed` carries the same `rateLimitType` its `rejected` carries, so this
 * record disproves `claude five_hour` and says nothing about any other window. ⚠️ **An empty
 * `window` means the provider named none**, and that is read as *the provider as a whole* — the
 * honest reading when there is nothing to tell two of its windows apart by, and the same reading
 * `readProviderLimit` already gives an unwindowed wall.
 *
 * ⛔ **Claude-only at this pin, and honestly so** — `conversation_reset`'s sentence, for the same
 * reason. Codex reports its state as a `rateLimits` SNAPSHOT rather than a verdict, and a snapshot
 * below the floor is a provider-wide clear, which a completed Codex turn already says.
 */
const providerLimitClearSchema = z.object({
  type: z.literal('provider_limit_clear'),
  /**
   * ⛔ **Which metered window the provider said is clear, as a FOLD KEY and never as a word a
   * person reads** — `ProviderLimitSeen.window`'s rule, and it must be the SAME spelling, because
   * matching this against a wall is the whole point of carrying it. `''` when the provider named
   * none.
   */
  window: z.string().max(120),
  /** The provider's own signal name — `rate_limit_event`. Cited by the row, never asserted. */
  source: z.string().max(120),
})

/** The most windows one usage reading carries: well past any provider's, short of a flood. */
export const MAX_USAGE_WINDOWS = 16

/**
 * ⚑ **How full the provider's metered windows are, as the provider just said** — every reading,
 * near a limit or not, for a person's Providers screen.
 *
 * ⛔ **Never recorded and never sent to a window as a transcript row**: the host takes the newest
 * per window and lets the event go before the ledger sees it (`RuntimeHost.deliver`). ⚠️ It arrives
 * once or twice a turn, and a row per reading would be the storm the stream fragments were.
 *
 * ⚑ `window` is the provider's own word (Claude's `five_hour`, Codex's *a 7-day window*);
 * `usedPercent` 0–100; `resetsAt` epoch ms. A field the provider did not say is `null`.
 */
const providerUsageSchema = z.object({
  type: z.literal('provider_usage'),
  readings: z
    .array(
      z.object({
        window: z.string().max(120),
        usedPercent: z.number().nonnegative().nullable(),
        resetsAt: z.number().nonnegative().nullable(),
      }),
    )
    .max(MAX_USAGE_WINDOWS),
})

/**
 * What KIND of unmapped provider message this is, in provider-neutral terms (049).
 *
 * The `unknown` variant used to do double duty — it meant both "recognized chatter we chose not
 * to render" (Codex `reasoning`/`plan` items, Claude non-`init` `system` messages) and "genuinely
 * unrecognized — look at this". The UI could not tell them apart, so chatter drowned the signal.
 * Classifying keeps the event **lossless** (`raw` is always carried) while letting the UI render
 * recognized chatter quietly and keep the truly-novel loud.
 *
 * - `reasoning` — the model's own thinking/reasoning stream.
 * - `plan` — a plan/todo the model is maintaining.
 * - `lifecycle` — session/turn housekeeping (compaction, review mode, sleep, state changes).
 * - `activity` — sub-agent / task / hook / tool-adjacent progress chatter.
 * - `echo` — our own input reflected back (user message, hook prompt).
 * - `unrecognized` — the DEFAULT: novel, malformed, or unmapped. This is the loud one.
 */
export const unknownCategorySchema = z.enum([
  'reasoning',
  'plan',
  'lifecycle',
  'activity',
  'echo',
  'unrecognized',
])
export type UnknownCategory = z.infer<typeof unknownCategorySchema>

/**
 * Anything the adapter could not map to a known variant. Carries the raw
 * payload so the UI renders a raw card instead of crashing (HO-001 §6; 001 gap
 * 6). Distinct from an unknown *request* — those must still be safe-rejected.
 *
 * `category` (049) classifies it neutrally — see {@link unknownCategorySchema}. `raw` is carried
 * in EVERY case, so classifying never costs information: a later chat UI can render reasoning and
 * plans richly from this same event.
 *
 * `label` (072) is the provider's own KIND string — `thread/compacted`, `thinking_delta`,
 * `message_start`. It exists so the UI can show *what* a piece of chatter is without digging into
 * `raw`: the kind lives at a different path per provider, so any renderer that read it from `raw`
 * would have to branch on the provider and stop being provider-agnostic. The adapter already knows
 * the kind, so it stamps it here and the renderer treats it as an opaque string. Optional: an
 * `unknown` without one still validates and renders as just its category.
 *
 * `degradedFrom` (235) says this `unknown` is **not provider chatter at all** — it is one of OUR
 * events that failed its own schema and was replaced, and this is the `type` it claimed to be. See
 * {@link degradeEvent}, which is the only thing that sets it.
 */
const unknownEventSchema = z.object({
  type: z.literal('unknown'),
  provider: z.string(),
  category: unknownCategorySchema,
  label: z.string().optional(),
  raw: z.unknown(),
  /**
   * ⛔ **What this frame WAS, when it was one of ours and did not validate** (235, from 230 M3).
   *
   * 230 H1 named the one thing that would defeat the event log as evidence: *"a log that dropped
   * `tool_call` rows specifically, while still recording turns and messages, would be invisible to
   * them — and `snapshot().tools` reads the same list, so there is no third surface to ask."* The
   * mechanism is real and shipped — {@link toRuntimeEvent} and the wire boundary both replace a
   * malformed event with an `unknown` and carry on — and until this field there was nothing on the
   * replacement to say a replacement had happened. An erased tool call and a turn in which no tool
   * was called produced the same ledger.
   *
   * ⚑ **Absent has TWO meanings and they are the same meaning**: an honest `unknown` (provider
   * chatter, the overwhelmingly common case) and a degraded frame whose `type` was not even a
   * readable name. The second still says `degraded:` in its {@link label}, so the COUNT of erasures
   * is never wrong — only the attribution is missing, which is the truth about it.
   *
   * ⚠️ **Opaque, exactly as `label` is.** Not `z.enum(RUNTIME_EVENT_TYPES)`: an event carrying a
   * type this build has never heard of is precisely the case worth recording, and an enum would
   * refuse the one frame with something to say. What it holds is bounded and pattern-checked at the
   * only place that writes it.
   */
  degradedFrom: z.string().optional(),
  /**
   * Set by an adapter on a fragment of something a later event states whole: the host takes its
   * arrival as a sign the provider is working, and neither keeps it nor sends it on.
   */
  passing: z.literal(true).optional(),
})

/**
 * The model's own reasoning, promoted out of `unknown{category:'reasoning'}` (027, designed in 026).
 *
 * **The text is usually not ours to show, and this shape says so rather than pretending.** Captured
 * live from both providers:
 *  - **Claude** reports a token ESTIMATE and never the words. Every `thinking_delta` observed
 *    carried `thinking:""` (20 of 20), and enabling `Options.thinking` yields a block that is empty
 *    but signed. So Claude populates {@link tokens} and sets {@link redacted}; `text` stays absent.
 *  - **Codex** delivers a SUMMARY — but only when the turn asks for one. By default its `reasoning`
 *    items arrive `{summary:[],content:[]}`; with `TurnStartParams.summary` set,
 *    `item/reasoning/summaryTextDelta` streams real text. `content` is never delivered, so what we
 *    show is a summary of the reasoning, never the raw chain of thought.
 *
 * `text` absent + `redacted:true` therefore means "it thought, and we cannot show you what" — which
 * is a different fact from "it did not think", and the UI must not collapse them.
 */
const thinkingEventSchema = z.object({
  type: z.literal('thinking'),
  /** `delta` while it accumulates; `complete` when the block is closed. */
  phase: z.enum(['delta', 'complete']),
  /** The reasoning text, when the provider actually supplies words. Absent is normal. */
  text: z.string().optional(),
  /** True when reasoning happened but its text was withheld — never inferred from silence. */
  redacted: z.boolean().optional(),
  /** Reasoning tokens, as the provider counts them. Claude's is an estimate. */
  tokens: z.number().optional(),
})

/**
 * What the agent is doing RIGHT NOW — the live indicator (027). One pill, replaced as the phase
 * changes, cleared by the `turn` event; it is a statement about the present, never a log line.
 * ⚑ **And a `compaction` event ENDS a `compacting` phase — that phase only** (`717`): the row is the
 * compaction over, and Codex says nothing else between its item opening and closing. Both folds that
 * read this stream apply it (`transcript.ts`, `being-done.ts`).
 *
 * ⚑ **`compacting` comes from BOTH providers, each from its own words for a compaction under way.**
 * Claude sends `{"type":"system","subtype":"status","status":"compacting"}` while it compacts (097,
 * correcting this comment's own earlier claim that the phase *"was NEVER observed in capture"*).
 * Codex opens its `contextCompaction` item as the compaction starts — `item/started` came 140 ms
 * before `item/completed`, with Codex's summary request between them (`713`,
 * `probe:codex-command-as-typed`, arm `compact-person`) — and since `717` that `started` phase raises
 * it. ⛔ Nothing fabricates a pill from a boundary already crossed: Codex's `thread/compacted` and the
 * item's `completed` phase are past tense, and each draws only the `compaction` row. (This said
 * *"CLAUDE-ONLY"* until `717`, and *"both past tense"* until `713`.)
 *
 * Neither this nor {@link thinkingEventSchema} carries a turn id, deliberately. Staleness is an
 * ADAPTER concern and is settled before normalization: Codex drops any turn-scoped notification
 * whose `turnId` is not the bound one, and Claude's SDK yields one turn at a time. A `turnId` here
 * would be a field no adapter sets and no consumer reads — an invitation to correlate on `undefined`.
 */
const activityEventSchema = z.object({
  type: z.literal('activity'),
  phase: z.enum(['thinking', 'tool', 'waiting', 'compacting']),
  /** A short human-readable qualifier (a tool name, say). Optional by design. */
  detail: z.string().optional(),
})

/**
 * **An image the agent produced — as a FILE, never as bytes** (067).
 *
 * The provider hands us the image twice: once as a ~2 MB base64 `result` inside the event, and once
 * as a real PNG it has already written to disk under its own home. This event carries the second
 * one. Nothing here is large, so nothing here is bounded, discarded, or copied through IPC — which
 * is the entire reason images can be displayed at all without touching 052's ceiling.
 *
 * Before this existed the whole item was an `unknown{raw}` whose payload was 45× the ceiling, so
 * {@link boundRaw} replaced it with a marker — and the marker took the small useful fields down
 * with the big useless one. The path was in there all along.
 *
 * ⚠️ **`path` is a fact about the filesystem, not a claim from the provider.** The adapter checks
 * the provider's claim (absolute, a regular file, an image type, by real path) or looks the file up
 * under the provider's own home by the item's id, and sets it only when the file exists. **It is
 * absent when no file was found**, which is a real and expected state rather than an error: Codex's
 * own image-generation skill instructs the model to *move or copy* the file into the workspace for
 * project work, so an image can legitimately no longer be where it was made. A consumer that finds
 * no `path` should say the image is not there — never invent one.
 */
const imageEventSchema = z.object({
  type: z.literal('image'),
  /** The provider's own id for the item. Codex names the file after it. */
  imageId: z.string(),
  /**
   * Absolute path to the image on disk, **resolved and checked by the adapter**. Absent when the
   * file could not be found where the provider said it was — see the ⚠️ above.
   */
  path: z.string().optional(),
  /**
   * The prompt the image was actually generated from — the provider's revision of what was asked,
   * not the user's words. Hundreds of bytes, and the only description of the picture there is, so
   * it is what a caption and an `alt` are written from.
   *
   * ⚠️ **Capped in the SCHEMA as well as at the adapter** (067, from its review). The Codex adapter
   * already truncates this to 200 characters, but that only guards the LIVE path: an event arriving
   * from an imported bundle is appended to the ledger without passing through any adapter, so a
   * corrupt or hostile bundle could carry a megabyte here and have it cloned across IPC for the life
   * of the session. The cap is generous — 20× what the adapter emits — so it can only ever reject
   * something no adapter produced, and rejecting degrades the event to `unknown{raw}`, where 052's
   * ceiling catches it. The safety net that already exists, reached on purpose.
   */
  prompt: z.string().max(4096).optional(),
})

/**
 * One line of the agent's checklist. Three statuses, because that is what both providers actually
 * distinguish — Codex's `pending|inProgress|completed` and Claude's `pending|in_progress|completed`
 * map onto these one-for-one.
 *
 * Claude has a FOURTH, `deleted`, which is deliberately not here: a deleted task is REMOVED from
 * {@link planUpdateEventSchema}'s `steps`, because "deleted" and "done" are opposite facts and
 * rendering one as the other would be a lie the user cannot detect.
 */
const planStepSchema = z.object({
  text: z.string(),
  status: z.enum(['pending', 'active', 'done']),
})

export type PlanStep = z.infer<typeof planStepSchema>

/**
 * The agent's working checklist — the thing that makes a long task legible (028, designed in 026).
 *
 * **`steps` REPLACES the list; it never appends.** Both providers state the complete list at this
 * boundary even though only one of them is wholesale on the wire, and absorbing that difference is
 * the adapters' job rather than every consumer's:
 *  - **Codex** sends the whole plan on every `turn/plan/updated` — captured live as
 *    `[inProgress, pending, pending]` then `[completed, completed, completed]` — so it maps across
 *    unchanged.
 *  - **Claude** is INCREMENTAL: its todo tools add one task (`TaskCreate`) or change one
 *    (`TaskUpdate`) at a time, so the Claude adapter keeps the running list itself and restates it
 *    in full here. Emitting the increment instead would make the checklist flicker down to a single
 *    row on every change.
 *
 * `note` is Codex's `explanation` — a sentence ABOUT the plan, never a step in it. Observed `null`
 * while the plan is being worked and populated when it completes.
 *
 * `body` is a plan DOCUMENT and is unpopulated today: 030 (plan mode) fills it from `ExitPlanMode`.
 * It ships now so the variant does not change shape under already-persisted rows later.
 *
 * `supersedes` names the `tool_call` ids this event ABSORBED — Claude's todo tool calls, which
 * would otherwise show up twice, once as ordinary tool rows and once as the checklist they built.
 * Each event carries only the ids it absorbed itself, not every id so far: superseding is permanent
 * once applied, so the accumulated effect is identical and the payload stays O(1) per event instead
 * of growing with the length of the session. Absent for Codex, whose plan is a notification and not
 * a tool call at all — the asymmetry lives in the data, so no consumer has to branch on provider.
 *
 * No `turnId`, for the reason {@link activityEventSchema} gives at length: staleness is an ADAPTER
 * concern, settled before normalization.
 */
const planUpdateEventSchema = z.object({
  type: z.literal('plan_update'),
  steps: z.array(planStepSchema),
  note: z.string().optional(),
  body: z.string().optional(),
  supersedes: z.array(z.string()).optional(),
})

/**
 * The agent dispatched an agent of its OWN (029, designed in 026) — one card per sub-agent, from
 * `started` through `progress` to `ended`.
 *
 * **BOTH providers dispatch sub-agents, and 029's claim that only Claude does was false** (033).
 * 029 read one Codex capture that happened to spawn nothing, concluded `collabAgentToolCall` and
 * `subAgentActivity` "never fire", and wrote that they are gated behind `effort:'ultra'`. Neither
 * half survived contact: a session at the ordinary default (`effort: medium`, `gpt-5.6-sol`) spawned
 * three agents and reported every one of them, and three more sessions since have done the same.
 * **Absence in a capture is not absence in the provider** — the reason this paragraph now names the
 * evidence rather than the inference.
 *
 * The two providers report the same fact through different channels, and absorbing that is the
 * adapters' job rather than every consumer's:
 *  - **Claude** reports richly and in one stream (`system/task_started|task_progress|task_updated|
 *    task_notification`), carrying parentage, usage and the child's final answer.
 *  - **Codex** reports the BIRTH on the parent's item stream (a `subAgentActivity` item) and
 *    everything after it under the CHILD's own thread id — its status, its token usage, its tool
 *    items and its `turn/completed`. ⚠️ **That sentence used to end "It sends no usage… and no
 *    answer"; 226 measured all of it on the wire.** What is still true is the parentage: the call it
 *    carries is one no tool row in this app has ever borne. The child's ANSWER is on the connection
 *    too and is deliberately not forwarded — there is no card body to own it (128).
 *
 * `agentId` is the identity, and every phase carries it — that is what the fold correlates on. It is
 * Claude's `task_id` and Codex's `agentThreadId`; that the second is also a real thread the app
 * could one day read is a fact about Codex, not a second meaning for this field.
 *
 * `parentToolCallId` is the tool-use that dispatched it, and is what NESTS the card under the right
 * tool row. It is optional because `task_updated` genuinely does not carry it. Codex's is a subtler
 * case worth stating: it names the collab call that spawned the child, and NO ROW with that id has
 * ever been rendered, so its cards sit top-level — which is not a fallback but the same place-once
 * rule doing its job, since the fold adopts an orphan the moment a matching row appears. Correlating
 * on `agentId` is what lets a card exist perfectly well before, or without, either of those.
 *
 * `outcome` is only ever set from a status the provider actually reported and this adapter
 * recognizes. A sub-agent whose turn ends without one is shown as ended WITHOUT an outcome, because
 * "we were not told how it went" is a different fact from "it succeeded". ⚠️ **It used to be the
 * whole of Codex's ending; since 226 it is not** — a child going idle still says only that it
 * stopped, and its own `turn/completed` one frame later says which of these three words applies.
 * The absence stays reachable: a child cut off with its parent never completes a turn. `interrupted` is a
 * third real answer rather than a shade of the other two: rounding it to `failed` accuses a
 * sub-agent that was stopped from outside, and dropping it to no outcome claims we were never told.
 *
 * No `turnId` — 027's precedent, for the third time; staleness is settled in the adapter.
 */
const subAgentEventSchema = z.object({
  type: z.literal('sub_agent'),
  /** Claude's `task_id`, Codex's `agentThreadId`. Stable across every phase — the correlation key. */
  agentId: z.string(),
  /**
   * **What kind of thing `agentId` IS** (111) — because the two providers hand back different kinds
   * of identifier and the card was calling both "agent".
   *
   * - `task` — Claude's `task_id`: a dispatch inside the parent's own process. There is nothing to
   *   open; it names work, not a conversation.
   * - `thread` — Codex's `agentThreadId`: a **real thread**, with its own rollout file on disk. That
   *   is why `109` could read a child's complete transcript that this app never opens.
   *
   * ⚠️ **On the wire rather than derived in the renderer, and that is 039's rule doing its job.**
   * The dispatch asked for wording that names the provider — *"Claude child ID"* versus *"Codex
   * child thread"* — and `provider-neutrality.test.ts` refuses a renderer that recognises a
   * provider, correctly: the surface would be deciding a capability from a brand. The fact that
   * genuinely differs is the KIND of identifier, which is a wire fact each adapter already knows.
   * Optional, because a persisted event written before this existed does not carry one and must
   * still validate.
   */
  idKind: z.enum(['task', 'thread']).optional(),
  phase: z.enum(['started', 'progress', 'ended']),
  /** The dispatch tool-use id, for nesting. Optional because `task_updated` omits it. Codex always
   *  carries one — no ROW has ever borne that id, so the card stays top-level until one does. */
  parentToolCallId: z.string().optional(),
  /** What kind of agent: Claude's `subagent_type` (`general-purpose`, `Explore`, …), or Codex's
   *  `agentPath` — a name the model coined for this one child (`workspace_mapper`). */
  kind: z.string().optional(),
  /**
   * **How this agent became known** (135) — `announced`, its dispatcher told us about it, or
   * `observed`, nothing did and we know it exists only because its own thread reported status.
   *
   * ⚠️ **It was introduced for the GRANDCHILD, and 226 measured that a grandchild is not one.** 135
   * read two ROLLOUT FILES — the root's for `sess_d5c8c9ca` names the grandchild thread zero times,
   * the child's carries its `sub_agent_activity{kind:'started'}` — and concluded the announcement
   * never reaches this app. On the socket it does: the depth-2 birth arrives stamped with the
   * depth-1 child's `threadId`, carrying `agentPath: '/root/coordinator/gamma'` and its dispatching
   * call, and the adapter's own thread gate was discarding it. A descendant is `announced` now.
   *
   * ⛔ **So this stays for the case that is still real: a working thread nothing announced at all.**
   * `observed` is not a lesser `announced` — it names a card whose PARENT IS UNKNOWN and must be
   * rendered as such. 111's rule, which is `086`/`104`'s: an honest blank beats a fabricated one,
   * and inventing a parent would put an agent under a conversation it never belonged to, as it
   * would for the 3 of 815 real children whose provider records no parent id.
   *
   * ⚠️ **It also decides what may be READ, not only what is drawn** (226). A card opened on nothing
   * but "that thread went active" gets its status and nothing else: no tokens, no tool count, no
   * outcome, and no announcement of a child of its own. See `CodexSubAgents.report`.
   *
   * Absent means NOT STATED, which is the ordinary case and reads as today. Only an explicit
   * `observed` changes what the card says, so an event persisted before this existed — and Claude's
   * `task_updated`, which omits the dispatch id for its own reasons — cannot be mistaken for one.
   */
  origin: z.enum(['announced', 'observed']).optional(),
  /** The dispatch's `description`: what this sub-agent was asked to do. */
  title: z.string().optional(),
  /** The tool it most recently ran, while it works. */
  lastTool: z.string().optional(),
  usage: z
    .object({
      tokens: z.number().optional(),
      toolCalls: z.number().optional(),
      ms: z.number().optional(),
    })
    .optional(),
  outcome: z.enum(['completed', 'failed', 'interrupted']).optional(),
  /** What it reported back. Claude sends the child's whole answer here. */
  summary: z.string().optional(),
})

/**
 * **How full the model's context window is** (087, designed in 086) — the live gauge's one input.
 *
 * ⚠️ **`reading` is a discriminated union because the alternative is a fabricated denominator.**
 * The two providers do not report the same shape, and neither of them reports the shape 086 expected
 * — measured on 198 real `thread/tokenUsage/updated` payloads and 227 real Claude usage frames in
 * this machine's own database:
 *  - **Codex** sends `modelContextWindow` on every reading (never `null` in 198 of 198, two distinct
 *    values), so it is `proportional` and a percentage is a fact.
 *  - **Claude** sends token counts on `message_start`/`message_delta` and **never a window** — the
 *    string `contextWindow` appears in zero Claude payloads. So it is `tokens`, and there is nothing
 *    to divide by.
 *
 * With `kind` on the wire, a `tokens` reading has **no `window` field to read**: computing a
 * percentage from one is not a rule a reviewer has to enforce, it is a type error. That is the whole
 * reason this is not `{used, window?}` with a helper.
 *
 * ⚠️ **`window` is `.positive()`, not `.nonnegative()`.** A zero would divide, and `used/0` is
 * `Infinity` — a number, rendered, wrong. A persisted or imported event carrying one is REJECTED by
 * this schema and degrades to `unknown{raw}` (the same safety net {@link imageEventSchema}'s `prompt`
 * cap reaches), which is loud and lossless rather than a gauge reading ∞%.
 *
 * `source` is the provider's own signal name — `thread/tokenUsage/updated`, `message_start`. It is
 * what the meter's unit line shows, so a reader can see WHICH wire fact they are looking at rather
 * than a claim we made about it. Opaque here, exactly as `unknown.label` is (072).
 */
const contextReadingSchema = z.object({
  type: z.literal('context_reading'),
  reading: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('tokens'), used: z.number().finite().nonnegative() }),
    z.object({
      kind: z.literal('proportional'),
      used: z.number().finite().nonnegative(),
      window: z.number().finite().positive(),
    }),
  ]),
  source: z.string().max(120),
})

/**
 * **Context was dropped** — the one fact about a compaction worth keeping (087, designed in 086).
 *
 * A compaction is not chatter and it is not attention: it is the moment earlier turns stopped being
 * in the model's head, and a reader who cannot see it cannot explain why the agent forgot something.
 * So it is a first-class event and a durable transcript row, never filtered by the lifecycle toggle.
 *
 * ⚠️ **Every magnitude is optional because one provider reports none at all.** Codex's
 * `contextCompaction` item is `{id}` and its `thread/compacted` notification is `{threadId, turnId}`
 * — verified in the generated protocol and in four real events on this machine. Claude's
 * `compact_boundary` carries `compact_metadata.pre_tokens` (always) and `post_tokens` (optional).
 * A row with no numbers says a compaction happened and stops there; the alternative is a plausible
 * number nobody can check, which is the failure this whole task exists to avoid.
 *
 * `compactionId` is the provider's own id, and it is the DEDUP key rather than decoration: Codex
 * reports its item TWICE (`item/started` then `item/completed`) — both observed, same id — so
 * without it one compaction draws two boundaries and the history tally counts two.
 */
const compactionEventSchema = z.object({
  type: z.literal('compaction'),
  compactionId: z.string().max(200).optional(),
  /** The sub-agent call whose own context was compacted; absent for the conversation's own. */
  parentToolCallId: z.string().optional(),
  /** Tokens in context BEFORE, when the provider said. Claude's `pre_tokens`. */
  before: z.number().finite().nonnegative().optional(),
  /** Tokens in context AFTER, when the provider said. Claude's `post_tokens`, itself optional. */
  after: z.number().finite().nonnegative().optional(),
  /**
   * Whether a human asked for it. Claude reports this; Codex does not — ⚑ except for a compaction
   * BroBot itself asked Codex for (713, `R59`), which its adapter marks `manual` because it made the
   * request.
   */
  trigger: z.enum(['manual', 'auto']).optional(),
  /** The provider's own signal name — `compact_boundary`, `contextCompaction`. */
  source: z.string().max(120),
})

/**
 * **The agent changed files** (096, designed in 092) — the answer to *"what did this conversation do
 * to my working tree?"*, which the app could not give at all before this.
 *
 * One event per report, carrying every file that report named. It is a REPLACEMENT, not a delta:
 * Codex sends a full snapshot of the turn's diff three to five times as the turn runs (measured,
 * byte-identical), so the fold keeps the latest record per path and never accumulates duplicates.
 *
 * ⚠️ **`changes` may legitimately be empty while the event still means something.** That is the
 * `underDisclosed` case — a file change we know happened and were not told the contents of. The pane
 * draws it as a faceless row and, emphatically, does not invent a path or a count for it. An event
 * with no changes and no `underDisclosed` flag is not emitted at all.
 *
 * ⚠️ **`dropped` exists so a cap can never be silent** (092 §4). If a report names more files than
 * {@link MAX_CHANGED_FILES}, the surplus rows are counted here and the pane says so out loud. The
 * alternative — a truncated list that looks complete — is the failure this project keeps finding.
 *
 * `source` is the provider's own signal name, opaque here exactly as `unknown.label` is:
 * `turn/diff/updated` for Codex, the tool name for Claude. It is what lets a reader see WHICH wire
 * fact a row came from, and it is why the pane can label an asymmetry instead of faking a common
 * unit — the two providers do not report the same thing and the surface says so.
 */
const fileChangeEventSchema = z.object({
  type: z.literal('file_change'),
  changes: z.array(
    z.object({
      path: z.string().max(4096),
      status: z.enum(['added', 'modified', 'deleted', 'renamed', 'touched']),
      oldPath: z.string().max(4096).optional(),
      added: z.number().int().nonnegative().optional(),
      removed: z.number().int().nonnegative().optional(),
      // ⚠️ **Bytes, not `.max()`** (review). `z.string().max(n)` counts UTF-16 code units, and the
      // bound it is enforcing is named — and documented — in BYTES. For ASCII they agree, which is
      // why nothing live was affected; for CJK they differ by three, so an IMPORTED bundle could
      // carry a 32,768-character diff weighing 98,304 bytes straight past the only gate on that
      // path. 052 added this class of bound precisely to stop an oversized payload crossing IPC.
      diff: z
        .string()
        .refine((text) => Buffer.byteLength(text, 'utf8') <= MAX_FILE_DIFF_BYTES, {
          message: `diff exceeds ${MAX_FILE_DIFF_BYTES} bytes`,
        })
        .optional(),
      oversize: z.boolean().optional(),
      crowdedOut: z.boolean().optional(),
    }),
  ),
  /** True when a change is known to have happened and the provider did not say which files. */
  underDisclosed: z.boolean().optional(),
  /** Files the report named beyond the cap. Absent or 0 normally. */
  dropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

/**
 * Represent a dynamic workflow explicitly so its frames are visible in normal mode.
 *
 * One event per wire frame, folded onto the anchoring `Workflow` tool call and **merged in place**:
 * the nine frames of the reproduction run mutate one tree and add no transcript rows (078's rule).
 * See `workflow-run.ts` for the measurements that fixed the shape — in particular why `agents` and
 * `phases` are optional rather than defaulted to `[]`, and which two wire fields are deliberately
 * not carried.
 *
 * ⚠️ **`agents: []` and no `agents` key are different events and the fold reads them differently.**
 * 19 of 41 measured progress frames carry no roster at all; if this schema defaulted the field, every
 * one of them would arrive claiming the run has zero agents and the tree would strobe. zod would
 * happily have done that for us, which is why it is stated here rather than assumed.
 *
 * `source` is the provider's own signal name (`task_started`, `task_progress`, `task_notification`),
 * opaque here exactly as `unknown.label` is — so a reader can see WHICH wire fact a row came from.
 */
const workflowRunEventSchema = z.object({
  type: z.literal('workflow_run'),
  /** `task_id`. The correlation key, and the ONLY one `task_updated` carries. */
  taskId: z.string().max(200),
  /** The `Workflow` tool call this hangs off. Absent on `task_updated`, which sends no id at all. */
  toolUseId: z.string().max(200).optional(),
  /**
   * ⛔ **`MAX_WORKFLOW_TEXT`, not 200, on every field a producer can WRITE** (299 §2). The
   * normalizer bounds these with `truncate`, which appends an ellipsis — so a `.max(200)` here
   * would reject exactly the strings that had just been bounded. See {@link MAX_WORKFLOW_TEXT} for
   * the delete this pair replaces, and note which fields do NOT get it: `taskId`, `toolUseId` and
   * `agentId` are IDENTIFIERS, correlation is the whole mechanism, and a truncated id is a wrong id
   * rather than a shortened one.
   */
  name: z.string().max(MAX_WORKFLOW_TEXT).optional(),
  description: z.string().max(MAX_WORKFLOW_DESCRIPTION).optional(),
  phases: z
    .array(
      z.object({
        index: z.number().int().finite().nonnegative(),
        title: z.string().max(MAX_WORKFLOW_TEXT),
      }),
    )
    .optional(),
  agents: z
    .array(
      z.object({
        agentId: z.string().max(200),
        label: z.string().max(MAX_WORKFLOW_TEXT),
        phaseIndex: z.number().int().finite().nonnegative(),
        state: z.enum(['queued', 'running', 'done', 'failed', 'unknown']),
        model: z.string().max(MAX_WORKFLOW_TEXT).optional(),
        // Epoch milliseconds as the provider sent them. Not `.positive()`: these are only ever
        // compared and displayed, never divided, so there is no `Infinity` to guard against — the
        // reason `context_reading`'s window needed that guard and this does not.
        queuedAt: z.number().finite().optional(),
        startedAt: z.number().finite().optional(),
        attempt: z.number().int().finite().positive().optional(),
        lastTool: z.string().max(MAX_WORKFLOW_TEXT).optional(),
        lastToolSummary: z.string().max(MAX_WORKFLOW_TEXT).optional(),
        tokens: z.number().finite().nonnegative().optional(),
        toolCalls: z.number().finite().nonnegative().optional(),
        durationMs: z.number().finite().nonnegative().optional(),
      }),
    )
    .max(MAX_WORKFLOW_AGENTS)
    .optional(),
  usage: z
    .object({
      tokens: z.number().finite().nonnegative().optional(),
      toolCalls: z.number().finite().nonnegative().optional(),
      ms: z.number().finite().nonnegative().optional(),
    })
    .optional(),
  /** `unknown` is a real ending: the provider closed the run with a status we could not read. */
  outcome: z.enum(['completed', 'failed', 'unknown']).optional(),
  /** Absolute path the run wrote its answer to. Opened on request; never inlined (107 §4). */
  outputFile: z.string().max(4096).optional(),
  /** Agents past {@link MAX_WORKFLOW_AGENTS}. Absent or 0 normally; non-zero is said out loud. */
  droppedAgents: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

/**
 * **What background work exists, and what just happened to it** (247) — see `background-work.ts`
 * for the measurement this shape was built from, and for why the two fields are separate.
 *
 * ⛔ **Both fields are optional and that is the design, not laxity.** `running` is a LEVEL the
 * provider states on its own frame; `ended` is an EDGE that names its own task. The SDK's doc for
 * `background_tasks_changed` says the payload *"carries ids only, so do not correlate it with the
 * edge stream"* — so an event produced by a level frame carries no ending, and one produced by an
 * ending carries no level. Filling either in from the other is exactly the pairing that wedges a
 * stale running indicator, and `222` is what that costs.
 *
 * ⚑ **`running` absent ≠ `running: []`.** Absent is *"this frame did not state the level"*; `[]` is
 * *"the provider says nothing is running"*, which is the fact that clears a registry. `workflow_run`'s
 * `agents` draws the same line for the same reason.
 */
const backgroundWorkSchema = z.object({
  type: z.literal('background_work'),
  /** REPLACE, never merge. Every piece of live background work after this change. */
  running: z
    .array(
      z.object({
        id: z.string().max(MAX_BACKGROUND_ID),
        toolCallId: z.string().max(MAX_BACKGROUND_ID).optional(),
        kind: z.string().max(80).optional(),
        description: z.string().max(MAX_BACKGROUND_TEXT).optional(),
      }),
    )
    .max(MAX_BACKGROUND_WORK)
    .optional(),
  /** One piece of work ended, as the provider reported it on a frame carrying its own identity. */
  ended: z
    .object({
      id: z.string().max(MAX_BACKGROUND_ID),
      toolCallId: z.string().max(MAX_BACKGROUND_ID).optional(),
      outcome: z.enum(['completed', 'failed', 'stopped', 'unknown']),
      summary: z.string().max(MAX_BACKGROUND_TEXT).optional(),
      outputFile: z.string().max(4096).optional(),
    })
    .optional(),
  /**
   * Rows the level payload carried that this event does not — **for any reason**, so a cap can never
   * be silent (092's rule, 096's precedent). Absent or 0 normally.
   *
   * ⚠️ **Two reasons, deliberately counted together**: entries past {@link MAX_BACKGROUND_WORK}, and
   * entries the provider sent with no id at all. The second is the one worth folding in rather than
   * dropping quietly — an entry with no id cannot be listed and cannot be stopped, so a registry
   * that simply showed one fewer row would be understating what is running with nothing to say so.
   * The `unknown{lifecycle}` frame beside this one still carries the payload verbatim either way.
   */
  dropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

const scheduleText = z.string().min(1).max(MAX_SCHEDULE_TEXT)
const anInstant = z.number().int().nonnegative()

/** What every receipt carries: the call, when it ran, and the sub-agent it ran inside, if any. */
const receiptBase = {
  toolUseId: scheduleText,
  /**
   * When the provider was about to run the call, on this host's clock. Absent when it was not seen,
   * or when the clock moved between this and {@link answeredAt}, so the two cannot be compared.
   */
  calledAt: anInstant.optional(),
  /** When the provider reported the call's result, on this host's clock. */
  answeredAt: anInstant,
  /** The sub-agent the call ran inside; absent for the conversation's own calls. */
  childId: scheduleText.optional(),
  /**
   * The app's calendar as it kept the receipt: which one, and the version of its zone data. A
   * job's time is placed only on the calendar it was created under.
   */
  stamp: z.object({ calendar: scheduleText, version: scheduleText }).optional(),
}

/**
 * **One scheduling call the provider ran, and what it answered**, read at its documented
 * `PostToolUse` hook: the input as it was executed, and the result in the tool's published shape.
 * ⚑ `result` is absent when the answer did not have that shape: the call happened, and what it did
 * is not known. ⚑ A call that failed runs no such hook, so it has no receipt. ⚑ No prompt is copied:
 * the tool call's own row holds it.
 */
const scheduleReceiptSchema = z.discriminatedUnion('tool', [
  z.object({
    ...receiptBase,
    tool: z.literal('CronCreate'),
    input: z
      .object({
        cron: scheduleText,
        recurring: z.boolean().optional(),
        durable: z.boolean().optional(),
      })
      .optional(),
    result: z
      .object({ id: scheduleText, recurring: z.boolean(), durable: z.boolean().optional() })
      .optional(),
  }),
  z.object({
    ...receiptBase,
    tool: z.literal('CronDelete'),
    input: z.object({ id: scheduleText }).optional(),
    result: z.object({ id: scheduleText }).optional(),
  }),
  z.object({
    ...receiptBase,
    tool: z.literal('CronList'),
    result: z
      .object({
        jobs: z
          .array(
            z.object({
              id: scheduleText,
              cron: scheduleText.optional(),
              recurring: z.boolean().optional(),
              durable: z.boolean().optional(),
            }),
          )
          .max(MAX_SCHEDULED_JOBS),
        /** Jobs the list carried that this receipt does not: past the cap, or with no id. */
        dropped: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
  z.object({
    ...receiptBase,
    tool: z.literal('ScheduleWakeup'),
    input: z
      .object({ delaySeconds: z.number().nonnegative().optional(), stop: z.boolean().optional() })
      .optional(),
    result: z
      .object({
        /** When the wake-up will come, in epoch milliseconds, as the provider said; 0 on a stop. */
        scheduledFor: anInstant,
        stopped: z.boolean().optional(),
        cancelledWakeups: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
])

/**
 * **What this session has promised to do later** (253) — see `scheduled-work.ts` for the
 * measurement, for why fires are deliberately not published, and for why there is no control.
 *
 * ⛔ **The only LEVEL in this taxonomy with no arm in either `normalize.ts`.** `session_crons` never
 * appears on the message stream: `250` proved that with a positive control — a cron row produced 0
 * of the 5 `task_*` frames a backgrounded `Bash` produced one row later in the same capture. It
 * arrives on the `Stop` hook, so its producer is `claude/session-crons.ts`, beside the callback.
 * ⚑ A row may carry one scheduling call's receipt instead, read at the tool hooks
 * (`claude/scheduling-calls.ts`); such a row states no level.
 *
 * ⚑ **Not the first provider fact to arrive off-stream, and the precedent is worth naming**:
 * `permission_request` comes from the `canUseTool` callback for the same structural reason. What is
 * new here is that the off-stream fact is a SET rather than a question.
 *
 * ⚑ **`jobs` absent ≠ `jobs: []`.** Absent is *"this frame did not state the level"*; `[]` is *"the
 * provider says nothing is scheduled"*, which is the fact that clears a registry. `workflow_run`'s
 * `agents` and `background_work`'s `running` draw the same line for the same reason.
 *
 * ⚠️ **There is no `fired` field, and that is the answer rather than an omission.** The only typed
 * label (`UserPromptSubmitHookInput.source`) is unset for external accounts, and the prompt cannot
 * stand in for it because the provider's copy is clipped at 1000 characters. A one-shot that has
 * fired is carried the honest way instead: it is simply gone from the next level.
 *
 * ⚑ **A second producer, the app's host**: it states the level it reads from the scheduling
 * calls' receipts and the provider's levels, its `source` naming the app — so a job is listed when
 * it is made and leaves when its cancellation is confirmed, without waiting for the turn's end.
 */
const scheduledWorkSchema = z.object({
  type: z.literal('scheduled_work'),
  /** REPLACE, never merge. Every job that will wake this session, after this change. */
  jobs: z
    .array(
      z.object({
        id: z.string().max(MAX_SCHEDULE_TEXT),
        schedule: z.string().max(MAX_SCHEDULE_TEXT).optional(),
        recurring: z.boolean().optional(),
        prompt: z.string().max(MAX_SCHEDULE_PROMPT).optional(),
        /** The minute it will next run, where the app knows it; only its own levels carry it. */
        nominalAt: anInstant.optional(),
        /** Why the app does not start its conversation for it; only its own levels carry it. */
        notStarted: z.enum(NOT_STARTED_BECAUSE).optional(),
      }),
    )
    .max(MAX_SCHEDULED_JOBS)
    .optional(),
  /**
   * Rows the level carried that this event does not — **for any reason**, so a cap can never be
   * silent (092's rule, 096's precedent, 247's wording). Absent or 0 normally.
   *
   * ⚠️ Two reasons counted together, as `background_work.dropped` counts its two: entries past
   * {@link MAX_SCHEDULED_JOBS}, and entries the provider sent with no id. An entry with no id cannot
   * be told apart from any other, so a registry that simply showed one fewer row would be
   * understating what is scheduled with nothing to say so.
   */
  dropped: z.number().int().nonnegative().optional(),
  /**
   * One scheduling call the provider ran, read as it happened. A row that carries one states no
   * level (`jobs` absent): what it changed is the level's to say.
   */
  receipt: scheduleReceiptSchema.optional(),
  /**
   * The provider began a new conversation under this session just before this row (a
   * `conversation_reset`): written by the app, and it states no level. Whether a job from before
   * it is still scheduled is the provider's to say, in the next level it states.
   */
  reset: z.literal(true).optional(),
  source: z.string().max(120),
})

/**
 * **What the running agent will answer to** (279) — see `provider-commands.ts` for the measurement
 * both providers were asked for, and for why the two answers are not the same kind of thing.
 *
 * ⛔ **`commands` is REQUIRED, unlike every other level in this union, and that is the design.**
 * `background_work` and `scheduled_work` each carry an optional level because a second, independent
 * fact can ride the same event — an ending, in one case — so *"this frame did not state the level"*
 * has to be representable. This event has one payload and no reason to exist without it: a frame
 * that stated nothing is a frame nobody emits.
 *
 * ⚑ **The `undefined` ≠ `[]` distinction is not lost, it MOVED** — to the registry that folds this,
 * where it is the difference §2 asks to be told apart out loud: a session nobody has asked holds
 * `null` and must not be drawn as an agent with no commands, while `[]` is the provider's own answer
 * and may be.
 *
 * ⛔ **REPLACE, never merge**, on the SDK's own instruction: *"Clients should REPLACE their cached
 * command list with this payload."* A merge would make a skill deleted mid-session immortal, which
 * is `222`'s stale indicator wearing a different hat.
 */
const providerCommandsSchema = z.object({
  type: z.literal('provider_commands'),
  /** Every command the agent has, after this change. REPLACE, never merge. */
  commands: z
    .array(
      z.object({
        name: z.string().max(MAX_COMMAND_NAME),
        description: z.string().max(MAX_COMMAND_TEXT).optional(),
        argumentHint: z.string().max(MAX_COMMAND_TEXT).optional(),
        aliases: z.array(z.string().max(MAX_COMMAND_NAME)).max(MAX_COMMAND_ALIASES).optional(),
        skill: z
          .object({
            path: z.string().max(MAX_SKILL_PATH),
            scope: z.string().max(MAX_SKILL_SCOPE),
            description: z.string().max(MAX_COMMAND_TEXT).optional(),
          })
          .optional(),
      }),
    )
    .max(MAX_PROVIDER_COMMANDS),
  /**
   * What a person types before a name — `/` for Claude, `$` for Codex, measured rather than styled.
   *
   * ⚠️ **On the event rather than on each row** — one fact about the provider, stated once. `169`
   * §1's rule: one rule spelled in N places drifts, and `248` had to go and fix five copies of one.
   */
  prefix: z.string().max(4),
  /**
   * Rows the provider named that this event does not carry — **for any reason**, so a cap can never
   * be silent (`092`'s rule, `096`'s precedent, `247`'s wording). Absent or 0 normally.
   *
   * ⚠️ Two reasons counted together, as its two siblings count theirs: entries past
   * {@link MAX_PROVIDER_COMMANDS}, and entries the provider sent with no usable name. A command with
   * no name cannot be typed and cannot be searched for, so a list that simply showed one fewer row
   * would be understating what the agent has with nothing to say so.
   */
  dropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

/**
 * 🔴 **The tools this conversation has** (358) — see `tool-inventory.ts` for the two halves, for
 * why merging them would be a lie, and for the measurement behind every bound below.
 *
 * ⛔ **BOTH payload fields are REQUIRED and nullable, which is a different shape from every other
 * level in this union and is the whole design.** `provider_commands` makes `commands` required so
 * that *"we were not told"* can only be the ABSENCE of the event; this event needs THREE states,
 * not two, because Codex will never publish an inventory and *"the provider does not publish one"*
 * is permanently different from *"nobody has told us yet"*:
 *
 * | state | how it is expressed | what a surface must say |
 * |---|---|---|
 * | nobody has told us | **no event** — the registry stays `null` | *BroBot has not been told what this conversation has* |
 * | the provider publishes none | an event with `published: null` | *Codex does not report its inventory; these were offered* |
 * | the provider published | an event with `published: {…}` | the join — offered, and confirmed |
 *
 * ⚠️ **`null` is unforgeable in both directions because the fields are required.** An adapter
 * cannot reach the middle row by forgetting a field, and it cannot reach the top row at all — only
 * silence does that.
 *
 * ⛔ **REPLACE, never merge.** Claude re-publishes on every `system/init`, and `257` §0 measured a
 * scheduled job waking a session and emitting a second one on the same stream at 10 194 / 54 805 /
 * 114 037 ms. A merge would make a server that dropped out of the second frame immortal, which is
 * `222`'s stale indicator wearing a new hat.
 */
const toolInventorySchema = z.object({
  type: z.literal('tool_inventory'),
  /**
   * ⛔ **How this provider spells a server's tool** — `{prefix:'mcp__', separator:'__'}` on Claude,
   * `{prefix:'', separator:'__'}` on Codex, both measured.
   *
   * ⚑ **On the event rather than worked out downstream, and `039` is why.** A renderer that decided
   * a spelling by recognising a provider is the exact shape `provider-neutrality.test.ts` refuses;
   * this is `provider_commands.prefix`'s idiom applied to a second fact, stated once by the adapter
   * that knows it.
   */
  naming: z.object({
    prefix: z.string().max(MAX_TOOL_NAME),
    separator: z.string().min(1).max(MAX_TOOL_NAME),
  }),
  /**
   * ⛔ **What BroBot HANDED this session** — offered, never proof. `null` where the adapter was
   * given no toolset at all, which on the two ordinary paths never happens (`runtime-host.ts`
   * declares them with no condition on either line, at start and at resume).
   */
  declared: z
    .object({
      server: z.string().max(MAX_TOOL_NAME),
      instructions: z.string().max(MAX_TOOL_TEXT).optional(),
      tools: z
        .array(
          z.object({
            name: z.string().max(MAX_TOOL_NAME),
            description: z.string().max(MAX_TOOL_TEXT),
            parameters: z
              .array(
                z.object({
                  name: z.string().max(MAX_TOOL_NAME),
                  type: z.string().max(MAX_TOOL_NAME),
                  required: z.boolean(),
                  description: z.string().max(MAX_TOOL_TEXT).optional(),
                }),
              )
              .max(MAX_TOOL_PARAMETERS),
          }),
        )
        .max(MAX_DECLARED_TOOLS),
    })
    .nullable(),
  /**
   * ⛔ **What the CHILD published about itself** — the only evidence in this event. `null` means the
   * provider publishes no inventory at all, which is Codex's permanent answer and is NOT the same
   * as an empty one.
   */
  published: z
    .object({
      /** Model-visible names, verbatim and provider-qualified. Built-ins and MCP tools in one list. */
      tools: z.array(z.string().max(MAX_TOOL_NAME)).max(MAX_PUBLISHED_TOOLS),
      servers: z
        .array(
          z.object({
            name: z.string().max(MAX_TOOL_NAME),
            /** ⛔ The provider's own word, NOT narrowed — see `PublishedServer.status`. */
            status: z.string().max(MAX_STATUS_WORD),
          }),
        )
        .max(MAX_PUBLISHED_SERVERS),
    })
    .nullable(),
  /**
   * Rows either half named that this event does not carry — **for any reason**, so a cap can never
   * be silent (`092`'s rule, `247`'s wording). Absent or 0 normally.
   */
  dropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

/**
 * Record the agent's claim that it read a memory source.
 *
 * ⛔ **This event exists because a measurement overturned a conclusion of mine.** 316 searched the
 * wire for a memory TOOL item, found none across fifteen config arms, and reported that a recall is
 * *"invisible, permanently"*. 318 went back with a control and found it on the item 316 had already
 * seen: `agentMessage.memoryCitation`, parsed by the app-server out of the model's own
 * `<oai-mem-citation>` block, stripped out of `text`, and dropped on the floor by
 * `codex/normalize.ts`, which read `text` and nothing else. Counting item TYPES could not see a
 * FIELD — a filter blinding the instrument that would have justified it.
 *
 * ## ⚠️ What it is a statement about, which is not what a tool call is a statement about
 *
 * A `tool_call` says *the provider reported this call*. This says *the agent said it used this*.
 * The app-server parsed the claim and structured it; it did not watch a file being read. Every
 * surface built on this has to survive that distinction — see `memory-recall.ts` for the three
 * rules that follow from it, the first of which is that {@link MemoryRecallEvent} paths are
 * displayed and never opened.
 *
 * ## ⛔ One provider, and the silence of the other is not a finding
 *
 * Only Codex publishes this at the pins this app ships. 318 measured that Claude's CLI preloads its
 * memory index into its own system prompt with no tool and no citation — and that its memory WRITES
 * are already visible as ordinary `Write`/`Edit` tool calls. So a Claude session emits none of
 * these, that is a fact about the provider rather than about the conversation, and no surface may
 * read a missing row as *"nothing was consulted"*.
 *
 * ## ⚠️ `null` is a real answer on the wire and is deliberately not an event here
 *
 * 318's control arm: a reply carrying no citation block still carries `memoryCitation`, **present
 * and `null`**. So *"no memory was consulted"* and *"this build does not report"* ARE distinguished
 * by the provider, and this app collapses both to no event on purpose. ⛔ A row under every answer
 * saying *"no memory was consulted"* is noise; a row saying *"unknown"* is the fabricated third
 * state 319 §1.3 forbids by name. The distinction survives where it can be used — in the probe that
 * measured it, and in this paragraph — rather than in a row nobody asked for.
 *
 * `source` is the provider's own field name, opaque here exactly as `unknown.label` is, so a reader
 * can see WHICH wire fact a row came from.
 */
const memoryRecallSchema = z.object({
  type: z.literal('memory_recall'),
  /**
   * The files the agent cited, **in the model's own order of importance** — its instruction is
   * *"list entries in order of importance (most important first)"*, so this array is not re-sorted
   * anywhere. Never empty: an event with nothing to name is not emitted.
   */
  entries: z
    .array(
      z.object({
        /** Relative to the profile's memory base path, and never resolved. See `memory-recall.ts`. */
        path: z.string().max(MAX_RECALL_PATH),
        /** 1-based, inclusive, and present only as a PAIR — a half range is not a range. */
        lineStart: z.number().int().finite().nonnegative().optional(),
        lineEnd: z.number().int().finite().nonnegative().optional(),
        /** The model's own words for how it used this file. Clipped, never dropped. */
        note: z.string().max(MAX_RECALL_NOTE).optional(),
      }),
    )
    .max(MAX_RECALL_ENTRIES),
  /**
   * Entries the citation named that this event does not carry — **for any reason**, so a cap can
   * never be silent (`092`'s rule, `096`'s precedent). Absent or 0 normally.
   */
  dropped: z.number().int().nonnegative().optional(),
  /**
   * Ids of earlier sessions the model says it drew on — carried, never drawn as ids.
   *
   * ⚠️ **Carried although no surface prints one**, and that is 319 §1.2's ruling rather than an
   * oversight: the provider's own instruction calls this list *"for us to track"* while calling the
   * entries above *"for rendering"*, the ids are TRANSCRIBED by the model out of text files rather
   * than minted by the app-server, and nothing in this app can resolve one into a conversation a
   * person would recognise. See `memory-recall.ts` for the whole argument. ⛔ Dropping them instead
   * would be 319 committing 319's own defect — throwing away the half of the citation that is
   * hardest to re-derive later.
   */
  threadIds: z.array(z.string().max(MAX_THREAD_ID)).max(MAX_RECALL_THREADS).optional(),
  /** Ids past the cap. Absent or 0 normally — the same no-silent-cap rule as `dropped`. */
  threadsDropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

/** The full discriminated union of runtime events. */
export const runtimeEventSchema = z.discriminatedUnion('type', [
  sessionEventSchema,
  conversationResetEventSchema,
  turnEventSchema,
  providerTurnSchema,
  assistantDeltaSchema,
  assistantMessageSchema,
  toolCallSchema,
  toolResultSchema,
  permissionRequestSchema,
  userInputRequestSchema,
  requestResolvedSchema,
  statusEventSchema,
  errorEventSchema,
  thinkingEventSchema,
  activityEventSchema,
  imageEventSchema,
  planUpdateEventSchema,
  subAgentEventSchema,
  contextReadingSchema,
  compactionEventSchema,
  fileChangeEventSchema,
  workflowRunEventSchema,
  backgroundWorkSchema,
  scheduledWorkSchema,
  providerCommandsSchema,
  toolInventorySchema,
  memoryRecallSchema,
  providerLimitClearSchema,
  providerUsageSchema,
  unknownEventSchema,
])

export type RuntimeEvent = z.infer<typeof runtimeEventSchema>

export type ConversationResetEvent = Extract<RuntimeEvent, { type: 'conversation_reset' }>
export type ContextReadingEvent = Extract<RuntimeEvent, { type: 'context_reading' }>
export type CompactionEvent = Extract<RuntimeEvent, { type: 'compaction' }>
export type FileChangeEvent = Extract<RuntimeEvent, { type: 'file_change' }>
export type WorkflowRunEvent = Extract<RuntimeEvent, { type: 'workflow_run' }>
export type BackgroundWorkEvent = Extract<RuntimeEvent, { type: 'background_work' }>
export type ScheduledWorkEvent = Extract<RuntimeEvent, { type: 'scheduled_work' }>
/** One scheduling call the provider ran, as a `scheduled_work` row carries it. */
export type ScheduleReceipt = NonNullable<ScheduledWorkEvent['receipt']>
export type ProviderCommandsEvent = Extract<RuntimeEvent, { type: 'provider_commands' }>
export type ToolInventoryEvent = Extract<RuntimeEvent, { type: 'tool_inventory' }>
export type MemoryRecallEvent = Extract<RuntimeEvent, { type: 'memory_recall' }>
export type ProviderLimitClearEvent = Extract<RuntimeEvent, { type: 'provider_limit_clear' }>
export type ProviderUsageEvent = Extract<RuntimeEvent, { type: 'provider_usage' }>
/** ⚑ **F074 — the usage limit a turn ended on**, as the `turn` event carries it. */
export type TurnLimit = NonNullable<Extract<RuntimeEvent, { type: 'turn' }>['limit']>

/**
 * What the meter knows, including **not knowing** — the third kind, which has no event.
 *
 * `unknown` is the state before any provider has reported, and it is first-class rather than a null
 * check: a fresh conversation, a resumed one that has not spoken, and an imported read-only session
 * all sit here, and every one of them must read as *"no reading yet"* and never as **0%**. Since
 * Claude never reports a window at our pin, `tokens` is not an edge case either — it is half the app.
 *
 * It is a union with the wire's own so the three arms cannot drift: adding a kind to
 * {@link contextReadingSchema} adds it here, and every `switch` over it stops compiling until it is
 * handled.
 */
export type ContextReading = ContextReadingEvent['reading'] | { kind: 'unknown' }

/** Every event `type` discriminant, useful for exhaustive checks/tests. */
export const RUNTIME_EVENT_TYPES = [
  'session',
  'conversation_reset',
  'turn',
  'provider_turn',
  'assistant_delta',
  'assistant_message',
  'tool_call',
  'tool_result',
  'permission_request',
  'user_input_request',
  'request_resolved',
  'status',
  'error',
  'thinking',
  'activity',
  'image',
  'plan_update',
  'sub_agent',
  'context_reading',
  'compaction',
  'file_change',
  'workflow_run',
  'background_work',
  'scheduled_work',
  'provider_commands',
  'tool_inventory',
  'memory_recall',
  'provider_limit_clear',
  'provider_usage',
  'unknown',
] as const

/**
 * The most an `unknown` payload may carry, in bytes of JSON (052).
 *
 * `unknown{raw}` is the one field in this vocabulary that holds provider data VERBATIM, and until
 * now it had no ceiling at all. Measured on the real database that prompted this: 1,068 of the
 * 1,069 `unknown` events are **420 bytes on average and 3,854 at the largest** — and the odd one
 * out is a Codex `imageGeneration` payload of **2,147,667 bytes**, 557× the biggest legitimate one,
 * because the provider returns the generated PNG as base64 inside the event. That payload is held
 * in main, cloned across IPC, folded by the renderer and written to SQLite, and nothing anywhere
 * said no.
 *
 * 64 KiB is therefore ~17× the largest legitimate payload OBSERVED in that database — a
 * measurement, not a guarantee about every payload an adapter could ever emit — and still small
 * enough that a session emitting them in a loop cannot take the machine down.
 *
 * ⚠️ **This bound is not what caused the 26 GB** — that is measured and written up in 052's
 * response; two live reproductions of this exact payload peaked at 0.72 GB. It is here because an
 * unbounded verbatim copy of provider output is a hazard on its own terms, not because it is the
 * cure for that incident.
 *
 * ⚠️ **The motivating payload no longer comes through this door** (067). `imageGeneration` is a
 * first-class {@link imageEventSchema} now, mapped field by field, and the base64 `result` that
 * made it 557× the next-largest is simply never read. That does NOT make the bound less necessary:
 * it was always the general answer to "an adapter can hand us anything", and the specific payload
 * that proved the point was only ever the loudest example. Raising it because the loudest example
 * left would be reasoning backwards.
 */
export const MAX_UNKNOWN_RAW_BYTES = 64 * 1024

/**
 * What replaces a payload too large to keep — a description of the payload, never a piece of it.
 *
 * **Nothing here is truncated.** A truncated 2 MB base64 blob would still be a megabyte, would
 * still look like real data to everything downstream, and would be a lie about what the provider
 * sent. The whole value of the `unknown` variant is that it is verbatim; once it cannot be, the
 * honest move is to say so and hand over the measurements instead of a plausible-looking fragment.
 *
 * `brobot2Discarded` is a key no provider payload has, so no consumer can mistake this for one.
 */
export interface DiscardedPayload {
  brobot2Discarded: true
  /**
   * `too-large` — it exceeded {@link MAX_UNKNOWN_RAW_BYTES}.
   * `unmeasurable` — it could not be serialized at all (circular, a throwing getter, a BigInt, or
   * a Symbol), so its size is unknown AND it could never have reached the database or the renderer
   * anyway.
   */
  reason: 'too-large' | 'unmeasurable'
  /** The provider's own kind string, when the adapter named one — the only part still shown. */
  label?: string
  /** Its size in UTF-8 bytes of JSON. Absent when the payload could not be measured. */
  bytes?: number
  limitBytes: number
  note: string
}

/** `NaN` past the end of the string, which is not in the range — so no bounds check is needed. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * UTF-8 length without `Buffer`: this module is bundled into the renderer, which has none.
 *
 * ⚠️ In practice it never sees a surrogate at all — it is fed `JSON.stringify` output, and V8
 * escapes lone surrogates to ASCII `\uXXXX`. The pairing arithmetic below is therefore correctness
 * for a case that does not arise here rather than a path anything exercises.
 */
function utf8Bytes(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && isLowSurrogate(text.charCodeAt(i + 1))) {
      // A surrogate PAIR is one character, four bytes, and consumes both halves. The pairing is
      // CHECKED rather than assumed: an unpaired high surrogate is three bytes on its own, and
      // consuming the character after it regardless would both overcount and skip a real one.
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/**
 * Apply {@link MAX_UNKNOWN_RAW_BYTES} to a payload, replacing an oversized one with an honest
 * marker. **Idempotent**: a marker measures well under the limit, so bounding twice is bounding
 * once, which is what lets both creation sites call it without coordinating.
 *
 * Measured by serializing, which allocates one transient copy of the payload. That is the cost we
 * are choosing: the copy is released immediately, where the alternative — keeping the payload —
 * is retained for the life of the session, cloned across IPC, and written to disk twice.
 */
export function boundRaw(raw: unknown, label?: string): unknown {
  let json: string | undefined
  try {
    json = JSON.stringify(raw)
  } catch {
    json = undefined // circular, a throwing getter, or a BigInt
  }
  // Two different ways to arrive here: the catch above, and a value `JSON.stringify` returns
  // `undefined` for WITHOUT throwing — `undefined` itself, a function, or a Symbol.
  if (json === undefined) {
    // `undefined` is what `JSON.stringify` returns for `undefined` and for a function — both of
    // which are already nothing, and neither is a payload worth a marker.
    if (raw === undefined || typeof raw === 'function') return raw
    return {
      brobot2Discarded: true,
      reason: 'unmeasurable',
      ...(label ? { label } : {}),
      limitBytes: MAX_UNKNOWN_RAW_BYTES,
      note: 'this payload could not be serialized, so it was dropped rather than carried in a form nothing downstream could read; it is not truncated',
    } satisfies DiscardedPayload
  }
  const bytes = utf8Bytes(json)
  if (bytes <= MAX_UNKNOWN_RAW_BYTES) return raw
  return {
    brobot2Discarded: true,
    reason: 'too-large',
    ...(label ? { label } : {}),
    bytes,
    limitBytes: MAX_UNKNOWN_RAW_BYTES,
    // ⚠️ **It names the provider's own file, the only place the bytes are kept** — provider-neutral,
    // because both providers write one. ⚠️ It promises a place to look, not that the bytes still
    // exist: a provider's file can be deleted, and a note that swore otherwise would be wrong.
    note: `this payload was ${bytes} bytes, over the ${MAX_UNKNOWN_RAW_BYTES}-byte ceiling on unknown payloads, and was DROPPED — not truncated. The provider writes its own verbatim record to its session file on disk, and the bytes are there for as long as that file is kept.`,
  } satisfies DiscardedPayload
}

/**
 * Validate an **adapter-authored** candidate (HO-001 §6; deliverable 2): an event
 * the adapter built and believes is one of our variants. A valid variant is
 * returned as-is; a malformed one degrades to `unknown`. **Never throws.**
 *
 * ⚠️ **Only for adapter-authored candidates.** Do NOT pass a raw provider payload
 * here — a raw payload that happens to be shaped like `{type:'status',...}` would
 * be accepted as a *real* lifecycle event and could mutate UI state without
 * adapter intent (007 P2-8). For the unmapped-provider-payload fallback use
 * {@link wrapUnknown}, which never interprets its input.
 */
export function toRuntimeEvent(provider: string, candidate: unknown): RuntimeEvent {
  const parsed = parseRuntimeEvent(candidate)
  if (parsed.ok) return parsed.event
  // A payload that failed the schema is by definition not something we recognize. Bounded like
  // every other unknown payload (052): a malformed candidate is exactly as likely to be huge as a
  // well-formed one, and this is the second of the two doors into `unknown{raw}`.
  //
  // ⛔ **One of TWO doors, and 235 exists because a rule changed at one of them would be a rule
  // nobody could rely on.** The wire boundary (`toWireEvent`) is the other; both go through
  // {@link degradeEvent} so an erasure looks the same whichever door it came through.
  return degradeEvent(provider, candidate)
}

/**
 * ⛔ **`safeParse` is not safe on a candidate this hostile, and both doors call it first** (235,
 * found by an adversarial pass over this dispatch's own diff).
 *
 * `runtimeEventSchema` is a discriminated union, so Zod reads `.type` off the candidate to pick an
 * arm — **before** any of our code sees it, and without a guard of its own. A candidate with a
 * throwing getter, or a revoked `Proxy` (where even `Array.isArray` throws), takes the exception
 * straight out through `toRuntimeEvent` — whose docstring has promised *"Never throws"* since
 * HO-001 — and out through the wire boundary into the event pump, killing the stream for the whole
 * session.
 *
 * ⚑ **Measured, not reasoned**: `toRuntimeEvent('claude', {get type(){throw …}})` threw
 * `a getter that refuses`, and the revoked proxy threw
 * `Cannot perform 'IsArray' on a proxy that has been revoked`. 235's first draft put its guard
 * inside `degradedTypeOf` — one call too late — and wrote a comment claiming the guard was reached
 * through this very door. It was not. The guard belongs here, where the throw actually happens.
 *
 * ⚠️ The reason string is for a LOG line, never for the event: `reason` describes our disagreement
 * with the candidate, and the candidate itself is carried verbatim (and bounded) by
 * {@link degradeEvent}.
 */
export function parseRuntimeEvent(
  candidate: unknown,
): { ok: true; event: RuntimeEvent } | { ok: false; reason: string } {
  let parsed: ReturnType<typeof runtimeEventSchema.safeParse>
  try {
    parsed = runtimeEventSchema.safeParse(candidate)
  } catch (error) {
    return { ok: false, reason: `reading the candidate threw: ${String(error)}` }
  }
  if (parsed.success) return { ok: true, event: parsed.data }
  return {
    ok: false,
    reason: parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'} ${issue.code}`)
      .join('; '),
  }
}

/**
 * The marker that says an `unknown` is an ERASURE, prefixed onto the type it used to be.
 *
 * ⚑ **Prefix rather than a bare type**, because this string is the one that reaches a human: the
 * event log renders `provider · label` (`describe-event.ts`), so a degraded frame reads
 * `claude · degraded:tool_call` — legible without a renderer change, and greppable by the live
 * smoke, which reads that row's text and nothing else.
 */
export const DEGRADED_LABEL_PREFIX = 'degraded:'

/**
 * What the label says when the frame did not even carry a readable name. It still counts as an
 * erasure, which is the number that matters; see {@link unknownEventSchema}'s `degradedFrom`.
 */
export const DEGRADED_UNNAMED = `${DEGRADED_LABEL_PREFIX}<unnamed>`

/**
 * A type name is echoed only if it looks like one. Every variant in {@link RUNTIME_EVENT_TYPES} is
 * lower-case-and-underscores, and this string ends up in a log line and a DOM row — so a hostile
 * `type` carrying newlines, escape codes or a megabyte of text is reported as unnamed rather than
 * printed. Nothing is lost by it: the candidate is carried verbatim in `raw` either way.
 */
const DEGRADED_TYPE_PATTERN = /^[a-z][a-z_]{0,63}$/

/**
 * ⛔ **Replace an event of OURS that failed its own schema, and SAY that is what happened** (235).
 *
 * The replacement is the design and 235 did not change it: a half-typed value must not reach the
 * renderer, and dropping the frame outright would lose the payload as well as the fact. What was
 * missing is that the replacement was indistinguishable from an honest `unknown` — so a `tool_call`
 * erased on the way out left a ledger that said *no tool was called*, on every surface, with
 * nothing anywhere to contradict it (230 H1's named residual, 230 M3's mechanism).
 *
 * ⚑ **`degradedFrom` and `label` are computed from ONE local**, deliberately: two carriers of one
 * fact is how one of them goes stale, and this repo has paid for that shape before (076's third
 * disclosure, keyed by hand and forgotten). A caller cannot set one without the other.
 *
 * `raw` defaults to the candidate itself. The wire boundary passes a cloneable PROJECTION of it
 * instead, because Electron's structured clone runs after us and a value it refuses would kill the
 * stream — but the `type` is still read from the original, so a payload that survives neither
 * cloning nor JSON still names what it was.
 *
 * **Never throws.** The candidate has already failed validation; reading a property off it is not
 * safe, so it is done behind a guard.
 */
export function degradeEvent(
  provider: string,
  candidate: unknown,
  raw: unknown = candidate,
): RuntimeEvent {
  const named = degradedTypeOf(candidate)
  const label = named === undefined ? DEGRADED_UNNAMED : `${DEGRADED_LABEL_PREFIX}${named}`
  const event: Extract<RuntimeEvent, { type: 'unknown' }> = {
    type: 'unknown',
    provider,
    // ⚠️ **`unrecognized`, the LOUD bucket, and NOT a new category** (049). "Malformed" is already
    // what that bucket means, and a seventh member of the enum would have to be added by hand to
    // every switch and every counter that reads it — the class of defect this project has shipped
    // four times. The erasure is a FIELD on the event, so nothing that already understands
    // `unknown` has to change to keep working, and anything that wants to count erasures asks one
    // question.
    category: 'unrecognized',
    label,
    // The same bound every other `unknown` payload gets (052), carrying the same label — so a
    // degraded frame whose payload was oversized still says what it was, on the marker that
    // replaces it.
    raw: boundRaw(raw, label),
  }
  if (named !== undefined) event.degradedFrom = named
  return event
}

/** The candidate's own `type`, if it is readable and looks like a name. Never throws. */
function degradedTypeOf(candidate: unknown): string | undefined {
  let type: unknown
  try {
    // ⚠️ A throwing getter, a revoked proxy, an exotic host object — the candidate is by definition
    // something we could not parse, so even asking it for a property is done behind a guard. The
    // door in front of this one guards the same hazard for Zod's discriminator read; see
    // {@link parseRuntimeEvent}, which is where the exception actually escaped from.
    if (typeof candidate !== 'object' || candidate === null) return undefined
    type = (candidate as Record<string, unknown>)['type']
  } catch {
    return undefined
  }
  return typeof type === 'string' && DEGRADED_TYPE_PATTERN.test(type) ? type : undefined
}

/**
 * Wrap a **raw provider payload** the adapter could not map to a known variant
 * as an `unknown` event, **without ever interpreting it** (007 P2-8). This is the
 * only safe boundary for provider data: unlike {@link toRuntimeEvent}, a payload
 * shaped like one of our discriminants can never masquerade as a real event.
 *
 * `category` defaults to `'unrecognized'` — the LOUD bucket — so an unclassified call site is
 * conspicuous rather than silently filed away as chatter (049).
 *
 * `label` (072) is the provider's own kind string, for display only — omitted when the adapter has
 * nothing meaningful to name.
 *
 * ⛔ **The label is PROVIDER data, and since 235 one prefix in it is ours** — see
 * {@link reserveDegradedPrefix}.
 */
export function wrapUnknown(
  provider: string,
  raw: unknown,
  category: UnknownCategory = 'unrecognized',
  label?: string,
): RuntimeEvent {
  const shown = label === undefined ? undefined : reserveDegradedPrefix(label)
  const event: Extract<RuntimeEvent, { type: 'unknown' }> = {
    type: 'unknown',
    provider,
    category,
    // Bounded HERE, at the moment the payload enters our vocabulary (052), so nothing downstream
    // has to know a limit exists: main holds the bounded value, IPC clones the bounded value, the
    // renderer folds it and the database stores it. One place to change, one place to be wrong.
    raw: boundRaw(raw, shown),
  }
  // Set only when present: an explicit `label: undefined` would serialize over IPC as a key with a
  // null value on some paths, so absent means absent.
  if (shown) event.label = shown
  return event
}

/**
 * ⛔ **`degraded:` is OUR namespace in a field otherwise filled by the provider** (235, found by an
 * adversarial pass over this dispatch's own diff).
 *
 * The erasure marker has two carriers: `degradedFrom`, which only {@link degradeEvent} writes, and
 * the `label`, which is the string a person and the live smoke actually read — `describeEvent`
 * renders `provider · label` and `ui-live-smoke.mjs` reads that row's text and nothing else. But
 * `label` is copied verbatim from the provider's own kind string, so a Codex item of
 * `type: 'degraded:tool_call'` would have rendered byte-identically to a real erasure and made a
 * live step report a tool call that was never lost.
 *
 * ⚑ **Neutralised rather than dropped.** The provider's string is still shown, still whole, and
 * still recognisable; what it cannot do is start with our marker. Losing the label instead would
 * cost the reader the one thing 072 added it for.
 */
function reserveDegradedPrefix(label: string): string {
  return label.startsWith(DEGRADED_LABEL_PREFIX) ? `provider:${label}` : label
}
