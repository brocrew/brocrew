import { nativeRun, commandInput, agentInput, runLine, checklistRun } from '../native-run'
import {
  ASKED_QUESTION_LIMITS,
  wrapUnknown,
  type PlanStep,
  type RuntimeEvent,
  type UnknownCategory,
} from '../events'
import { parseUnifiedDiff } from '../file-change'
import { boundRecall, type MemoryRecallEntry } from '../memory-recall'
import type { ProviderCommand } from '../provider-commands'
import { isCodexUnauthorized } from './auth-probe'
import { isRecord, readField, readNumber, readString } from './normalize-fields'
import type { CollabAgentTool } from './protocol/v2/CollabAgentTool'
import type { CollabAgentToolCallStatus } from './protocol/v2/CollabAgentToolCallStatus'
import type { CommandExecutionStatus } from './protocol/v2/CommandExecutionStatus'
import type { DynamicToolCallOutputContentItem } from './protocol/v2/DynamicToolCallOutputContentItem'
import type { DynamicToolCallStatus } from './protocol/v2/DynamicToolCallStatus'
import type { McpToolCallStatus } from './protocol/v2/McpToolCallStatus'
import type { PatchApplyStatus } from './protocol/v2/PatchApplyStatus'
import type { ServerNotification } from './protocol/ServerNotification'
import type { SubAgentActivityKind } from './protocol/v2/SubAgentActivityKind'
import type { ThreadItem } from './protocol/v2/ThreadItem'
import type { TurnPlanStepStatus } from './protocol/v2/TurnPlanStepStatus'
import type { TurnStatus } from './protocol/v2/TurnStatus'
import type { WebSearchItem } from './protocol/WebSearchItem'
import { rateLimitPressure, rateLimitUsage, type RateLimitWatch } from './rate-limits'

export { RateLimitWatch, rateLimitUsage, type UsageBucket } from './rate-limits'

/**
 * Normalize one `codex app-server` notification into content `RuntimeEvent`s (assistant deltas and
 * messages, tool calls and results, informational errors). Unmapped methods become `unknown{raw}`.
 *
 * Lifecycle is not emitted here: the `session` event comes from the `thread/start`/`resume` response
 * and the turn terminal from `SessionMachine` via {@link codexTurnOutcome}. `turn/started` binds
 * nothing; the id comes from the `turn/start` response, and the handle re-sends a requested interrupt
 * on `turn/started` because Codex refuses one before the turn runs.
 *
 * Pure except for `watch`: `account/rateLimits/updated` is a sparse update over earlier frames, so
 * judging it needs the handle's {@link RateLimitWatch}. Omitting `watch` gives the per-frame reading.
 */
export function normalizeNotification(
  method: string,
  params: unknown,
  watch?: RateLimitWatch,
): RuntimeEvent[] {
  switch (method) {
    case 'item/agentMessage/delta': {
      // A well-formed empty delta is a no-op; a missing or non-string `delta` is surfaced.
      const raw = readField(params, 'delta')
      if (typeof raw !== 'string') return [unrecognized(method, params)]
      return raw ? [{ type: 'assistant_delta', text: raw }] : []
    }

    case 'item/started':
      return itemToEvents(readField(params, 'item'), 'started')

    case 'item/completed':
      return itemToEvents(readField(params, 'item'), 'completed')

    // Reasoning summary stream. Reasoning items arrive empty unless the turn asks for
    // `TurnStartParams.summary`; the server never delivers `content`, so only a summary reaches the UI.
    case 'item/reasoning/summaryTextDelta': {
      const delta = readField(params, 'delta')
      if (typeof delta !== 'string') return [unrecognized(method, params)]
      return delta ? [{ type: 'thinking', phase: 'delta', text: delta }] : []
    }

    // A delta with no text and no count marks the boundary between summary parts; it separates the
    // parts already shown and never starts a block of its own.
    case 'item/reasoning/summaryPartAdded':
      return [{ type: 'thinking', phase: 'delta' }]

    // Working checklist. Codex states the whole plan each time, matching the neutral event's replace
    // contract, so no state is kept. `item/plan/delta` stays chatter: the protocol marks it experimental
    // and says concatenated deltas need not match the completed plan.
    case 'turn/plan/updated': {
      const plan = readField(params, 'plan')
      if (!Array.isArray(plan)) return [unrecognized(method, params)]
      const steps: PlanStep[] = []
      for (const entry of plan) {
        const text = readString(entry, 'step')
        const status = planStepStatus(readString(entry, 'status') as TurnPlanStepStatus)
        // One unreadable entry rejects the whole notification rather than render a plan with a hole.
        if (!text || !status) return [unrecognized(method, params)]
        steps.push({ text, status })
      }
      // `explanation` is null while the plan is in progress; keep absence as absence.
      const explanation = readString(params, 'explanation')
      return [
        {
          type: 'plan_update',
          steps,
          run: checklistRun(steps, explanation),
          ...(explanation ? { note: explanation } : {}),
        },
      ]
    }

    // Context window fill. Uses `last`, never `total`: `total.totalTokens` is cumulative billing and
    // can exceed `modelContextWindow`, while `last.totalTokens` is what is in the window now.
    // `modelContextWindow` is `number | null`; a value <= 0 counts as absent so no ratio divides by zero.
    case 'thread/tokenUsage/updated': {
      const usage = readField(readField(params, 'tokenUsage'), 'last')
      const used = readNumber(usage, 'totalTokens')
      // An unreadable count is a malformed first-class method, kept loud rather than chatter.
      if (used === undefined) return [unrecognized(method, params)]
      const window = readNumber(readField(params, 'tokenUsage'), 'modelContextWindow')
      return [
        {
          type: 'context_reading',
          reading:
            window !== undefined && window > 0
              ? { kind: 'proportional', used, window }
              : { kind: 'tokens', used },
          source: method,
        },
      ]
    }

    // Compaction notification. It carries no magnitudes and none are invented. The protocol marks it
    // deprecated in favour of the `ContextCompaction` item ({@link itemToEvents}), but older app-servers
    // still send it.
    case 'thread/compacted':
      return [{ type: 'compaction', source: method }]

    // What the turn did to the working tree. `turn/diff/updated` carries one git-format unified diff of
    // per-file sections ({@link parseUnifiedDiff} splits it, including renames shown as a header with two
    // paths). Each payload is a full snapshot, so the consumer folds by path.
    // `item/fileChange/patchUpdated` is declared in the protocol but is not the source used.
    case 'turn/diff/updated': {
      const diff = readString(params, 'diff')
      // A payload with no readable diff is a malformed first-class method, not chatter.
      if (!diff) return [unrecognized(method, params)]
      const parsed = parseUnifiedDiff(diff)
      // Not a git diff: keep it loud and lossless rather than report zero changes.
      if (parsed.changes.length === 0) return [unrecognized(method, params)]
      return [
        {
          type: 'file_change',
          changes: parsed.changes,
          ...(parsed.dropped > 0 ? { dropped: parsed.dropped } : {}),
          source: method,
        },
      ]
    }

    case 'error': {
      // Current `ErrorNotification` carries `error.message`; fall back to a legacy top-level `message`.
      const turnError = readField(params, 'error')
      const message = turnErrorText(turnError, readString(params, 'message') || 'codex error')
      // `codexErrorInfo: "unauthorized"` marks a rejected credential delivered as turn output.
      return [
        {
          type: 'error',
          message,
          fatal: false,
          ...(isCodexUnauthorized(turnError) ? { cause: 'auth' as const } : {}),
        },
      ]
    }

    // Content-gated: routine rate-limit frames stay chatter; a throttle the user is feeling is surfaced.
    case 'account/rateLimits/updated': {
      const snapshot = readField(params, 'rateLimits')
      // With a watch, merged against earlier frames and silent on repeats; without, the per-frame reading.
      const pressure = watch ? watch.observe(snapshot) : rateLimitPressure(snapshot)
      // Every reading, near a limit or not, becomes a `provider_usage` for the Providers screen, taken
      // from the merged bucket so a sparse frame does not look like a window that lost its reset.
      const usage = rateLimitUsage(watch ? watch.lastReading() : { snapshot, mainLimitId: null })
      // The quiet half returns chatter directly because nothing follows this switch.
      const said: RuntimeEvent[] = pressure
        ? [{ type: 'error', message: pressure, fatal: false }]
        : [wrapUnknown('codex', { method, params }, 'lifecycle', method)]
      return usage === null ? said : [...said, usage]
    }

    // `showBufferingUi` is the provider's own gate: `false` stays lifecycle chatter.
    case 'model/safetyBuffering/updated': {
      if (readField(params, 'showBufferingUi') !== true) {
        return [wrapUnknown('codex', { method, params }, 'lifecycle', method)]
      }
      return [{ type: 'error', message: safetyBufferingMessage(params), fatal: false }]
    }

    // Surfaced whenever it fires: `ModelRerouteReason` has one member, `highRiskCyberActivity`, so a
    // reroute is never routine. `codex-runtime.ts` merges `toModel` into the agent info; this says why.
    case 'model/rerouted':
      return [{ type: 'error', message: rerouteMessage(params), fatal: false }]

    // Lifecycle is owned by the handle and machine.
    case 'turn/started':
    case 'turn/completed':
    case 'thread/started':
    case 'thread/closed':
      return []

    default:
      // Warnings surface as non-fatal `error` events; only a real fatal ends the turn.
      if (isWarningMethod(method)) {
        return [{ type: 'error', message: warningMessage(method, params), fatal: false }]
      }
      // Wrapped raw payload, classified by method so recognized streams stay quiet.
      return [wrapUnknown('codex', { method, params }, notificationCategory(method), method)]
  }
}

/**
 * Methods {@link normalizeNotification} handles itself. Excluding them keeps {@link notificationCategory}
 * exhaustive over its own methods. Keep this list in step with the switch: a `case` missing here leaves
 * a dead classifier arm that still satisfies exhaustiveness.
 */
type FirstClassMethod =
  | 'error'
  | 'item/agentMessage/delta'
  | 'item/started'
  | 'item/completed'
  | 'item/reasoning/summaryTextDelta'
  | 'item/reasoning/summaryPartAdded'
  | 'turn/plan/updated'
  | 'thread/tokenUsage/updated'
  | 'thread/compacted'
  | 'turn/diff/updated'
  | 'account/rateLimits/updated'
  | 'model/rerouted'
  | 'model/safetyBuffering/updated'
  | 'turn/started'
  | 'turn/completed'
  | 'thread/started'
  | 'thread/closed'

/**
 * Generated methods that report a problem rather than progress. They surface as non-fatal `error`
 * events (a `guardianWarning` may be security-relevant) and never end the session or turn.
 * {@link isWarningMethod} dispatches from this array and {@link ChatterMethod} excludes it, so a
 * method cannot be both a warning and chatter.
 */
const WARNING_METHODS = [
  'warning',
  'guardianWarning',
  'configWarning',
  'deprecationNotice',
  'windows/worldWritableWarning',
  'thread/realtime/error',
] as const

type WarningMethod = (typeof WARNING_METHODS)[number]

/**
 * Compile-time proof that every entry above is a real generated method; a typo or a method dropped by
 * a protocol bump fails the build (the array is a runtime list, so `Exclude` alone would not).
 */
const WARNING_METHODS_ARE_GENERATED: WarningMethod extends ServerNotification['method']
  ? true
  : never = true

function isWarningMethod(method: string): method is WarningMethod {
  void WARNING_METHODS_ARE_GENERATED
  return (WARNING_METHODS as readonly string[]).includes(method)
}

/**
 * A readable line for a warning: the method plus the payload's `message`, or `summary` (+ `details`).
 * A payload with no text degrades to the method name alone.
 */
function warningMessage(method: string, params: unknown): string {
  const summary = readString(params, 'summary')
  const details = readString(params, 'details')
  const text =
    readString(params, 'message') || (summary && details ? `${summary} — ${details}` : summary)
  return text ? `${method}: ${text}` : method
}

/**
 * The line for a model the provider swapped mid-request. The reason is quoted verbatim rather than
 * paraphrased; a payload missing a name says only what it has.
 */
function rerouteMessage(params: unknown): string {
  const from = readString(params, 'fromModel')
  const to = readString(params, 'toModel')
  const reason = readString(params, 'reason')
  const why = reason ? ` (${reason})` : ''
  if (from && to) return `codex answered this turn with ${to} instead of ${from}${why}`
  if (to) return `codex moved this turn to ${to}${why}`
  return `codex moved this turn to another model${why}`
}

/**
 * What a safety-buffering pause says: the provider's own `reasons` strings, quoted, at most three
 * because the array is unbounded, plus `fasterModel` when offered. Nothing here selects that model.
 */
function safetyBufferingMessage(params: unknown): string {
  const reasons = readField(params, 'reasons')
  const listed = Array.isArray(reasons)
    ? reasons.filter((reason): reason is string => typeof reason === 'string' && reason !== '')
    : []
  const why = listed.length > 0 ? ` (${listed.slice(0, 3).join(', ')})` : ''
  const faster = readString(params, 'fasterModel')
  const instead = faster ? `; codex offers ${faster} as a faster alternative` : ''
  return `codex is holding this turn for a safety check${why} — generation may pause${instead}`
}

/** Every generated notification method that classification must account for. */
type ChatterMethod = Exclude<ServerNotification['method'], FirstClassMethod | WarningMethod>

/**
 * Methods the current protocol no longer declares but an older app-server may still send. They are
 * matched before the generated-union switch so legacy tolerance never weakens its exhaustiveness.
 */
const LEGACY_METHOD_CATEGORIES = new Map<string, UnknownCategory>([
  ['contextCompacted', 'lifecycle'], // superseded by the generated `thread/compacted`
])

/**
 * Compile-time exhaustiveness over the generated notification methods, mirroring
 * {@link assertItemExhaustive}: a new protocol method fails the build until classified. At runtime it
 * is reached only by a method outside the generated union, which stays loud.
 */
function assertNotificationExhaustive(method: never): UnknownCategory {
  void method
  return 'unrecognized'
}

/**
 * Category for a notification recognized by name but not mapped to a content event (high-volume
 * streams such as reasoning and plan deltas). The payload is kept; anything outside the generated
 * union is `unrecognized` and stays loud.
 */
function notificationCategory(method: string): UnknownCategory {
  // A `Map`, not a record: an object lookup would return inherited members for names like
  // `toString`, yielding a non-category value.
  const legacy = LEGACY_METHOD_CATEGORIES.get(method)
  if (legacy) return legacy
  // The cast lives here at the boundary, not in the switch's `default`, where `as never` would
  // defeat the exhaustiveness guard.
  return generatedNotificationCategory(method as ChatterMethod)
}

function generatedNotificationCategory(method: ChatterMethod): UnknownCategory {
  switch (method) {
    // Reasoning. The summary streams are first-class and must stay out of this switch: removing one
    // from `FirstClassMethod` makes the switch fail `assertNotificationExhaustive`.
    case 'item/reasoning/textDelta':
      return 'reasoning'
    // Plan text as it is written. `turn/plan/updated` is first-class and stays out of this switch;
    // `item/plan/delta` is experimental and may not match the finished plan.
    case 'item/plan/delta':
      return 'plan'
    // Work in progress: output streams, tool/hook/search/realtime progress.
    case 'hook/started':
    case 'hook/completed':
    case 'item/autoApprovalReview/started':
    case 'item/autoApprovalReview/completed':
    case 'autoApprovalReview/strictReviewRequired':
    case 'command/exec/outputDelta':
    case 'process/outputDelta':
    case 'process/exited':
    case 'item/commandExecution/outputDelta':
    case 'item/commandExecution/terminalInteraction':
    case 'item/fileChange/outputDelta':
    case 'item/fileChange/patchUpdated':
    case 'item/mcpToolCall/progress':
    case 'externalAgentConfig/import/progress':
    case 'externalAgentConfig/import/completed':
    case 'fs/changed':
    case 'fuzzyFileSearch/sessionUpdated':
    case 'fuzzyFileSearch/sessionCompleted':
    case 'thread/realtime/itemAdded':
    case 'thread/realtime/transcript/delta':
    case 'thread/realtime/transcript/done':
    case 'thread/realtime/outputAudio/delta':
    case 'thread/realtime/item/started':
    case 'thread/realtime/item/transcript/delta':
    case 'thread/realtime/item/completed':
    case 'mcpServer/event/stream/notification':
      return 'activity'
    // Our own request reflected back, or the raw provider response.
    case 'rawResponseItem/completed':
    case 'rawResponse/completed':
      return 'echo'
    // Session, thread, account and model housekeeping. `thread/compacted`, `thread/tokenUsage/updated`,
    // `account/rateLimits/updated` and `model/rerouted` are handled first-class and must stay out of this
    // switch. `model/verification` stays chatter: `trustedAccessForCyber` changes no fact the user chose,
    // unlike a reroute, which changes which model answered.
    case 'thread/status/changed':
    case 'thread/archived':
    case 'thread/deleted':
    case 'thread/unarchived':
    case 'skills/changed':
    case 'thread/name/updated':
    case 'thread/goal/updated':
    case 'thread/goal/cleared':
    case 'thread/environment/connected':
    case 'thread/environment/disconnected':
    case 'thread/settings/updated':
    case 'serverRequest/resolved':
    case 'mcpServer/oauthLogin/completed':
    case 'mcpServer/startupStatus/updated':
    case 'account/updated':
    case 'app/list/updated':
    case 'remoteControl/status/changed':
    case 'model/verification':
    case 'turn/moderationMetadata':
    case 'thread/realtime/started':
    case 'thread/realtime/sdp':
    case 'thread/realtime/closed':
    case 'windowsSandbox/setupCompleted':
    case 'account/login/completed':
    case 'account/gatewayOAuth/changed':
    case 'modelProvider/authRecoveryStarted':
    case 'modelProvider/authRecoveryCompleted':
    case 'thread/reverted':
    case 'thread/attachment/updated':
    case 'thread/queue/changed':
    case 'project/changed':
    case 'thread/project/updated':
    case 'thread/readState/changed':
    case 'thread/section/changed':
    case 'thread/prediction/updated':
      return 'lifecycle'
    default:
      return assertNotificationExhaustive(method)
  }
}

/**
 * A notification recognized by name whose payload could not be read; surfaced loud because a
 * malformed first-class method is a fact about the provider, not chatter.
 */
function unrecognized(method: string, params: unknown): RuntimeEvent {
  return wrapUnknown('codex', { method, params }, 'unrecognized', method)
}

/**
 * Codex plan-step status to the neutral one, exhaustive over the generated `TurnPlanStepStatus`.
 * `null` means unreadable, and the caller drops the entire plan on it.
 */
function planStepStatus(status: TurnPlanStepStatus): PlanStep['status'] | null {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'inProgress':
      return 'active'
    case 'completed':
      return 'done'
    default:
      return assertPlanStatusExhaustive(status)
  }
}

/** Compile-time exhaustiveness over `TurnPlanStepStatus`; a runtime-novel value is unreadable. */
function assertPlanStatusExhaustive(status: never): null {
  void status
  return null
}

/** A terminal outcome for the session machine, plus the message it reports on a failure. */
interface TurnOutcome {
  outcome: 'completed' | 'failed' | 'interrupted'
  message?: string
}

/**
 * Compile-time exhaustiveness over `TurnStatus`. At runtime it is reached only by a value outside the
 * generated union, which must never be assumed to have succeeded.
 */
function assertStatusExhaustive(status: never): TurnOutcome {
  return {
    outcome: 'failed',
    message: `turn completed with an unrecognized status: ${JSON.stringify(status)}`,
  }
}

/** Codex refused this turn for its usage limit: `TurnError.codexErrorInfo` is `usageLimitExceeded`. */
export function codexTurnHitItsUsageLimit(params: unknown): boolean {
  const turn = readField(params, 'turn')
  return (
    readString(turn, 'status') === 'failed' &&
    readField(readField(turn, 'error'), 'codexErrorInfo') === 'usageLimitExceeded'
  )
}

/**
 * Whether Codex's `error` notification carries `usageLimitExceeded`. Its meaning (plan limit or API
 * key out of quota) depends on the credential, which only the handle knows.
 */
export function codexErrorIsAUsageLimit(params: unknown): boolean {
  return readField(readField(params, 'error'), 'codexErrorInfo') === 'usageLimitExceeded'
}

/** Codex refused the credential: `codexErrorInfo` is `unauthorized`, never `usageLimitExceeded`. */
export function codexTurnFailedOnItsCredential(params: unknown): boolean {
  const turn = readField(params, 'turn')
  return readString(turn, 'status') === 'failed' && isCodexUnauthorized(readField(turn, 'error'))
}

/**
 * The terminal outcome a `turn/completed` reports, fail-closed: only an affirmative terminal status
 * succeeds. `inProgress` on a completed notification contradicts itself and, like an unknown runtime
 * value, reports `failed`.
 */
export function codexTurnOutcome(params: unknown): TurnOutcome {
  const turn = readField(params, 'turn')
  const status = readString(turn, 'status') as TurnStatus
  switch (status) {
    case 'completed':
      return { outcome: 'completed' }
    case 'interrupted':
      return { outcome: 'interrupted' }
    case 'failed':
      return {
        outcome: 'failed',
        message: `turn failed: ${turnErrorText(readField(turn, 'error'))}`,
      }
    case 'inProgress':
      return {
        outcome: 'failed',
        message: 'turn/completed reported status `inProgress` — the turn did not report success',
      }
    default:
      return assertStatusExhaustive(status)
  }
}

/** A Map for the same inherited-read reason as {@link LEGACY_METHOD_CATEGORIES}. */
const TOOL_ITEM_NAMES = new Map<string, string>([
  ['commandExecution', 'shell'],
  ['fileChange', 'apply_patch'],
  ['mcpToolCall', 'mcp'],
  ['webSearch', 'web_search'],
  ['dynamicToolCall', 'tool'],
  ['collabAgentToolCall', 'collab'],
])

/**
 * The provider's qualified name: MCP uses `mcp__server__tool`, dynamic calls `namespace__tool`. Keep
 * both server and tool, or the generic label for a malformed item, so a missing half never names
 * another server.
 */
function toolItemName(type: string, item: Record<string, unknown>): string {
  // Dynamic tools use their declared namespace, without the MCP prefix.
  if (type === 'dynamicToolCall') {
    const tool = readString(item, 'tool')
    if (tool) {
      const namespace = readString(item, 'namespace')
      return truncate(namespace ? `${namespace}__${tool}` : tool)
    }
  }
  if (type === 'mcpToolCall') {
    const server = readString(item, 'server')
    const tool = readString(item, 'tool')
    // Bounded because `server` and `tool` come from third-party MCP servers and the event is cloned
    // across IPC and ledger writes. A plain `truncate`: an over-long name is a broken server.
    if (server && tool) return truncate(`mcp__${server}__${tool}`)
  }
  return TOOL_ITEM_NAMES.get(type) ?? 'tool'
}

/**
 * Whether an item `type` is a tool item, the same judgement as {@link itemCategory}, exported so
 * callers counting tool calls do not keep a second list.
 */
export function isCodexToolItem(type: string): boolean {
  return itemCategory(type as ThreadItem['type']) === 'tool'
}

/** Compile-time exhaustiveness: a new `ThreadItem['type']` fails the build until classified. */
function assertItemExhaustive(type: never): UnknownCategory {
  void type // reachable at runtime only for an unrecognized `type` string → genuinely unknown
  return 'unrecognized'
}

/**
 * Coverage category for every `ThreadItem` kind. `tool` and `message` kinds map to real events; the
 * rest are classified into a neutral {@link UnknownCategory} so the UI can quiet them. An
 * unrecognized `type` string falls through to `unrecognized`.
 */
function itemCategory(
  type: ThreadItem['type'],
): 'message' | 'tool' | 'subAgent' | 'image' | 'compaction' | UnknownCategory {
  switch (type) {
    case 'agentMessage':
      return 'message'
    // A dispatched agent is first-class and stays out of the `activity` list below.
    case 'subAgentActivity':
      return 'subAgent'
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'webSearch':
    case 'collabAgentToolCall':
      return 'tool'
    // No dedicated event, but recognized: classified, never dropped (raw is carried).
    case 'reasoning':
      return 'reasoning'
    // The plan document becomes `plan_update{body}` in {@link itemToEvents}; this only files a
    // malformed one, beside the `item/plan/delta` chatter.
    case 'plan':
      return 'plan'
    // Our own input reflected back; `functionCallOutput` answers a `toolOutput` this app never sends.
    case 'userMessage':
    case 'hookPrompt':
    case 'functionCallOutput':
      return 'echo'
    // The provider writes a generated image to a file and names it on the wire.
    case 'imageGeneration':
      return 'image'
    // `imageView` stays chatter: it is an image the agent looked at, and its `path` can point anywhere
    // the agent can read.
    case 'imageView':
      return 'activity'
    // Context was dropped; the `contextCompaction` item is the path that runs.
    case 'contextCompaction':
      return 'compaction'
    case 'sleep':
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return 'lifecycle'
    default:
      return assertItemExhaustive(type)
  }
}

/**
 * `agentMessage.memoryCitation` to the neutral `memory_recall` event. The model appends an
 * `<oai-mem-citation>` block to its reply and the app-server parses it into `{entries, threadIds}`,
 * so this is the model's own statement of what it used, not an observation of a read; surfaces must
 * not word it as seen.
 *
 * Malformed input degrades quietly because the shape is not under this app's control: a non-record
 * (including `null`, meaning no memory was consulted) yields no event, an entry without a usable
 * `path` is dropped and counted, a range whose numbers are not both usable is dropped while the entry
 * keeps its path and note, and a citation with nothing left emits nothing.
 */
function codexMemoryRecall(citation: unknown): RuntimeEvent | null {
  if (!isRecord(citation)) return null
  const sent = Array.isArray(citation['entries']) ? (citation['entries'] as unknown[]) : []
  const entries: MemoryRecallEntry[] = sent.map((raw) => {
    const lineStart = readNumber(raw, 'lineStart')
    const lineEnd = readNumber(raw, 'lineEnd')
    // Both numbers must be integral and in order, or neither: `readNumber` only refuses non-finite values.
    const ranged =
      lineStart !== undefined &&
      lineEnd !== undefined &&
      Number.isInteger(lineStart) &&
      Number.isInteger(lineEnd) &&
      lineStart >= 0 &&
      lineEnd >= lineStart
    const note = readString(raw, 'note')
    return {
      path: readString(raw, 'path'),
      ...(ranged ? { lineStart, lineEnd } : {}),
      ...(note ? { note } : {}),
    }
  })
  const threads = Array.isArray(citation['threadIds'])
    ? (citation['threadIds'] as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const bound = boundRecall(entries, threads)
  // Nothing survived: stay silent rather than emit a bare claim.
  if (bound.entries.length === 0) return null
  return {
    type: 'memory_recall',
    entries: bound.entries,
    ...(bound.dropped ? { dropped: bound.dropped } : {}),
    ...(bound.threadIds.length ? { threadIds: bound.threadIds } : {}),
    ...(bound.threadsDropped ? { threadsDropped: bound.threadsDropped } : {}),
    source: 'memoryCitation',
  }
}

function itemToEvents(item: unknown, phase: 'started' | 'completed'): RuntimeEvent[] {
  // A malformed item (not a record, or no string `type`) is surfaced loudly, not dropped.
  if (!isRecord(item)) return [wrapUnknown('codex', item, 'unrecognized', 'malformed item')]
  const type = item['type']
  if (typeof type !== 'string')
    return [wrapUnknown('codex', item, 'unrecognized', 'malformed item')]
  const category = itemCategory(type as ThreadItem['type'])

  if (category === 'message') {
    // agentMessage: the streamed text arrives via `item/agentMessage/delta`; the
    // completed item carries the authoritative message, including an empty string.
    // Missing or non-string text is malformed; empty text may still carry questions or recall.
    if (phase !== 'completed') return []
    const text = readField(item, 'text')
    if (typeof text !== 'string') return [wrapUnknown('codex', item, 'unrecognized', type)]
    // Placed after the message: the model appends the citation as the last content of its reply, and
    // an event emitted first would land above the answer when nothing streamed and below it when
    // something did, since the fold finalizes a streamed block in place.
    const recall = codexMemoryRecall(readField(item, 'memoryCitation'))
    // Questions from an async message, for a surface to draw as choices ({@link asyncQuestionsOf});
    // nothing waits on them because Codex raised no request.
    const questions = asyncQuestionsOf(item)
    const message: RuntimeEvent = {
      type: 'assistant_message',
      text,
      ...(item['phase'] === 'final_answer'
        ? { phase: 'final' as const }
        : item['phase'] === 'commentary'
          ? { phase: 'commentary' as const }
          : {}),
      ...(questions.length > 0 ? { questions } : {}),
    }
    return recall ? [message, recall] : [message]
  }

  // The reasoning item carries no usable text (`summary`/`content` are empty on it), so it only states
  // that reasoning is happening or stopped. `redacted` means withheld rather than absent; the summary
  // deltas supply the words when the turn asked for them.
  if (category === 'reasoning') {
    return phase === 'started'
      ? [
          { type: 'thinking', phase: 'delta', redacted: true },
          { type: 'activity', phase: 'thinking' },
        ]
      : [{ type: 'thinking', phase: 'complete' }]
  }

  // Context was dropped. Codex opens and closes this item with the same id, so only `completed`
  // draws the boundary row, or one compaction would count twice; `compactionId` is kept for folding
  // older ledgers. `started` raises the live `compacting` activity without a row, since an activity
  // describes the present and the `completed` row ends it. The item is `{type, id}` only, so the
  // event carries no magnitudes.
  if (category === 'compaction') {
    if (phase === 'started') return [{ type: 'activity', phase: 'compacting' }]
    const id = readString(item, 'id')
    return [{ type: 'compaction', ...(id ? { compactionId: id } : {}), source: type }]
  }

  // A dispatched agent; see {@link subAgentBirth} for why only one phase produces an event.
  if (category === 'subAgent') {
    if (phase !== 'started') return []
    const event = subAgentBirth(item)
    return event ? [event] : [wrapUnknown('codex', item, 'unrecognized', type)]
  }

  // The plan document, distinct from the checklist above. It becomes `plan_update.body`, the same
  // field Claude's `ExitPlanMode.input.plan` lands in. `steps: []` here means "not stated by this
  // frame", not "no checklist": every `plan_update` is meant to state the complete list, so
  // `CodexSessionHandle.restatePlan` fills it in, keeping this layer a translation of one frame.
  // `started` is skipped because its `text` is empty before any delta lands; a `completed` plan with no
  // text is malformed and stays loud.
  if (category === 'plan') {
    if (phase !== 'completed') return []
    const body = readString(item, 'text').trim()
    return body
      ? [{ type: 'plan_update', steps: [], body, run: checklistRun([], undefined, body) }]
      : [wrapUnknown('codex', item, 'unrecognized', type)]
  }

  // A generated image. The item's `result` is the whole PNG as base64, so only `id`, `savedPath` and
  // `revisedPrompt` are read and the bytes are never copied or serialized. `completed` only: the
  // `started` item has no `savedPath` yet, so it could not resolve.
  if (category === 'image') {
    if (phase !== 'completed') return []
    const id = readString(item, 'id')
    // A malformed item drops `result` first, so the other fields survive `wrapUnknown`'s size ceiling
    // instead of the whole payload being replaced by an erasure marker.
    if (!id) return [wrapUnknown('codex', withoutImageBytes(item), 'unrecognized', type)]
    // A failed generation (`ImageGenerationItem.failure`) made no image; say that as a non-fatal error
    // rather than draw an image whose file seems lost.
    const failure = readField(item, 'failure')
    if (isRecord(failure)) {
      return [{ type: 'error', message: imageFailureMessage(failure), fatal: false }]
    }
    const savedPath = readString(item, 'savedPath')
    // Bounded like every provider string that becomes a summary line: the event is persisted and
    // cloned across IPC, and the protocol does not cap `revisedPrompt`.
    const prompt = truncate(readString(item, 'revisedPrompt').trim())
    return [
      {
        type: 'image',
        imageId: id,
        // Not checked here because this function is pure; `CodexRuntime` resolves or removes the path
        // before the event is emitted ({@link CodexSessionHandle.resolveImage}).
        ...(savedPath ? { path: savedPath } : {}),
        ...(prompt ? { prompt } : {}),
      },
    ]
  }

  // Kinds with no dedicated event carry their full payload as a classified `unknown{raw}`.
  if (category !== 'tool') return [wrapUnknown('codex', item, category, type)]

  // A known tool kind missing its `id` is malformed and surfaced.
  const id = readString(item, 'id')
  if (!id) return [wrapUnknown('codex', item, 'unrecognized', type)]
  const name = toolItemName(type, item)
  const summary = itemSummary(type, item)
  const backgroundId = commandProcessId(type, item)
  const commandRun =
    type === 'commandExecution'
      ? nativeRun('command', {
          input: commandInput(readString(item, 'command'), readString(item, 'cwd')),
          ...(phase === 'started'
            ? { progress: runLine(readString(item, 'aggregatedOutput'), true) ?? 'Running' }
            : {}),
          ...(phase === 'completed'
            ? {
                result:
                  runLine(readString(item, 'aggregatedOutput'), true) ?? readString(item, 'status'),
              }
            : {}),
        })
      : undefined
  if (phase === 'started') {
    const tool = readString(item, 'tool')
    const displayName =
      type === 'dynamicToolCall' || (type === 'mcpToolCall' && readString(item, 'server'))
        ? truncate(tool)
        : ''
    return [
      {
        type: 'tool_call',
        ...(commandRun ? { run: commandRun } : {}),
        id,
        name,
        summary,
        ...(displayName ? { displayName } : {}),
        ...(backgroundId ? { backgroundId } : {}),
      },
    ]
  }
  // The reason travels with the result so a fail-closed card explains itself.
  const outcome = toolOutcome(type, item)
  // What came back, where the kind sends it: other kinds repeat the call's summary, which is right
  // for a command but not for an MCP call, matching Claude's `tool_result.summary` from the output.
  const settled = resultSummary(type, item, summary)
  // Joined rather than interpolated: `settled` can be empty (a whitespace-only provider string after
  // {@link oneLine}), and interpolation would open the row with a dangling dash.
  const spoken = [settled, outcome.note].filter(Boolean).join(' — ')
  return [
    {
      type: 'tool_result',
      ...(commandRun?.result ? { run: { result: commandRun.result } } : {}),
      id,
      summary: spoken,
      ok: outcome.ok,
      ...mcpDuration(type, item),
      ...(backgroundId ? { backgroundId } : {}),
    },
    ...collabInputs(type, item),
  ]
}

function collabInputs(type: string, item: Record<string, unknown>): RuntimeEvent[] {
  if (type !== 'collabAgentToolCall' || readString(item, 'tool') !== 'spawnAgent') return []
  const receivers = item['receiverThreadIds']
  if (!Array.isArray(receivers)) return []
  const prompt = readString(item, 'prompt')
  const model = readString(item, 'model')
  return receivers.flatMap((agentId): RuntimeEvent[] =>
    typeof agentId === 'string'
      ? [
          {
            type: 'sub_agent',
            agentId,
            phase: 'progress',
            parentToolCallId: readString(item, 'id'),
            run: nativeRun('agent', {
              input: agentInput(prompt, undefined, model),
            }),
          },
        ]
      : [],
  )
}

/**
 * How long an MCP tool call took, as the provider measured it. This excludes the JSON-RPC framing and
 * host event pump that `ToolEntry.took` includes. A measured `0` is real, so test `!== undefined`; a
 * negative value is refused here so it costs its own field rather than failing event validation.
 * Only `mcpToolCall` is read: `commandExecution` and `dynamicToolCall` also declare `durationMs`, but
 * reading them would change the duration shown on every shell row.
 */
function mcpDuration(type: string, item: Record<string, unknown>): { durationMs?: number } {
  if (type !== 'mcpToolCall') return {}
  const ms = readNumber(item, 'durationMs')
  return ms === undefined || ms < 0 ? {} : { durationMs: ms }
}

/**
 * The PTY process id behind a Codex command (`commandExecution.processId`). It is the join key for
 * `ThreadBackgroundTerminal` and `ThreadBackgroundTerminalsTerminateParams`, so the card can later stop
 * the process. Its presence does not mean the command runs in the background: Codex attaches one to
 * every PTY-backed command, including foreground ones. Only commands carry it.
 */
function commandProcessId(type: string, item: Record<string, unknown>): string {
  return type === 'commandExecution' ? readString(item, 'processId') : ''
}

/**
 * What a tool row says it is doing, one branch per tool kind. `mcpToolCall` and `dynamicToolCall` read
 * their `arguments` (present on both `item/started` and `item/completed`; the answer is null until
 * completion) and {@link mcpResultSummary} or {@link dynamicResultSummary} reads the answer. The fall-through never prints the item type: an unrecognized kind must not look like
 * content.
 */
function itemSummary(type: string, item: Record<string, unknown>): string {
  if (type === 'commandExecution') return truncate(readString(item, 'command') || 'shell command')
  if (type === 'fileChange') return 'file change'
  if (type === 'webSearch') return truncate(readString(item, 'query') || 'web search')
  if (type === 'collabAgentToolCall') return collabSummary(item)
  // One helper for both kinds: they declare the same `arguments` field and must read alike.
  if (type === 'mcpToolCall' || type === 'dynamicToolCall') return argumentsSummary(item)
  return UNSUMMARISED_TOOL_KIND
}

/**
 * What a tool row says when this file has no branch for its kind. It names no kind, so a protocol
 * discriminator never appears as content; `toolItemName` names the tool and `unknown{raw}` carries
 * unclassified items.
 */
export const UNSUMMARISED_TOOL_KIND = 'a tool call this app cannot describe yet'

/**
 * What a dynamic tool answered. `answerCodexToolCall` sends one prose text item, so the first
 * non-empty `inputText` is read; a payload-only answer with empty prose falls through to the next
 * readable item. Image and audio get a word from a `Record` keyed on the union, so a new member fails
 * to compile. `'done'` (Claude's word for a textless result) covers `contentItems: null`, which is
 * what `item/started` carries.
 */
function dynamicResultSummary(item: Record<string, unknown>): string {
  const content = item['contentItems']
  if (!Array.isArray(content)) return 'done'
  let notWords = ''
  for (const one of content) {
    if (!isRecord(one)) continue
    const kind = one['type']
    if (kind === 'inputText') {
      const text = typeof one['text'] === 'string' ? oneLine(one['text']) : ''
      if (text) return boundedSummary(text)
      continue
    }
    // `Object.hasOwn`, not `in`: `'toString' in NON_TEXT_ANSWER` is true through the prototype chain.
    // The non-text word is remembered rather than returned, so a later readable text item still wins.
    if (!notWords && typeof kind === 'string' && Object.hasOwn(NON_TEXT_ANSWER, kind)) {
      notWords =
        NON_TEXT_ANSWER[kind as Exclude<DynamicToolCallOutputContentItem['type'], 'inputText'>]
    }
  }
  return notWords || 'done'
}

/**
 * What a row says about a non-text answer, one entry per non-text arm of
 * `DynamicToolCallOutputContentItem` so a new arm fails to compile. It names what arrived, never the
 * URL: `imageUrl` and `audioUrl` are base64 `data:` URLs and would bloat a one-line summary.
 */
const NON_TEXT_ANSWER: Readonly<
  Record<Exclude<DynamicToolCallOutputContentItem['type'], 'inputText'>, string>
> = {
  inputImage: 'an image',
  inputAudio: 'audio',
}

/** {@link truncate}'s default, named because {@link boundedSummary} has to state it on the row. */
const SUMMARY_CAP = 200

/**
 * The cap on what an MCP row carries. It states the remainder when it cuts, so a reader can tell 201
 * characters from ninety thousand. The bound is {@link truncate}'s; the count is of the
 * whitespace-collapsed string {@link oneLine} produced, which is what is on the row.
 */
function boundedSummary(text: string): string {
  if (text.length <= SUMMARY_CAP) return text
  return `${truncate(text, SUMMARY_CAP)} (${SUMMARY_CAP} of ${text.length} characters)`
}

/**
 * Collapse whitespace so a multi-line provider failure text fits the one-line row (`.tool-summary` is
 * `nowrap` with an ellipsis). No word is lost; applied only to the two provider strings put on one line.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * What the model asked the server to do: the arguments, as Claude's row shows for the same gesture.
 * Empty when there are none, so the row shows the qualified name alone; an empty object stays `'{}'`.
 */
function argumentsSummary(item: Record<string, unknown>): string {
  const args = item['arguments']
  if (args === undefined || args === null) return ''
  let json: string | undefined
  try {
    json = JSON.stringify(args)
  } catch {
    json = undefined // circular or otherwise unserializable — not something to guess at
  }
  return json === undefined ? '' : boundedSummary(json)
}

/**
 * Which reading a result row shows, per tool kind. `mcpToolCall` (`result`/`error`) and
 * `dynamicToolCall` (`contentItems`) send an answer back; for a `commandExecution` the command is the
 * row, so repeating the call summary is right.
 */
function resultSummary(type: string, item: Record<string, unknown>, calledWith: string): string {
  if (type === 'mcpToolCall') return mcpResultSummary(item)
  if (type === 'dynamicToolCall') return dynamicResultSummary(item)
  return calledWith
}

/**
 * What an MCP call answered and, on failure, what failed. The two failure shapes are disjoint: a tool
 * that threw has `status: failed`, `error: null` and the message in `content[0].text`; a transport
 * failure (such as `tool_timeout_sec`) has `error.message` and `result: null`. So both are read,
 * `error` first because a transport failure invalidates any partial result.
 *
 * `isError` is not on this wire: `McpToolCallResult` is `{content, structuredContent, _meta}`, and the
 * app-server reports it as `status: "failed"`, which {@link toolOutcome} reads. A bare-string `error`
 * is accepted, as {@link hasReportedError} does, so a non-conformant server's reason is not read as
 * `'done'`.
 */
function mcpResultSummary(item: Record<string, unknown>): string {
  const error = item['error']
  if (typeof error === 'string' && error) return boundedSummary(oneLine(error))
  const message = readString(error, 'message')
  if (message) return boundedSummary(oneLine(message))
  const result = readField(item, 'result')
  const text = mcpResultText(readField(result, 'content'))
  if (text) return boundedSummary(oneLine(text))
  // `structuredContent` second: the text blocks are the readable half, but a server that sends only
  // the structured half must still say something.
  const structured = readField(result, 'structuredContent')
  if (structured !== undefined && structured !== null) {
    try {
      const json = JSON.stringify(structured)
      if (json !== undefined) return boundedSummary(json)
    } catch {
      // Unserializable: fall through to the word below.
    }
  }
  // Claude's own word for a result with no text (`summarizeToolResult`).
  return 'done'
}

/**
 * The whole of what a tool answered, in order: the text parts that {@link dynamicResultSummary} and
 * {@link mcpResultSummary} each cut to one line. Only `dynamicToolCall` and `mcpToolCall` have a
 * structured answer; a command's output already has its own surface (the command tail), and a second
 * copy of the same bytes could disagree. Non-text items contribute no part, since an image's
 * `imageUrl` is a base64 `data:` URL ({@link NON_TEXT_ANSWER} names them on the row instead).
 * `null` means the item is not a held tool answer: another kind, or a call with no result yet.
 */
export function codexToolAnswerParts(item: unknown): readonly string[] | null {
  if (!isRecord(item)) return null
  if (item['type'] === 'dynamicToolCall') {
    const content = item['contentItems']
    if (!Array.isArray(content)) return null
    const parts: string[] = []
    for (const one of content) {
      if (!isRecord(one) || one['type'] !== 'inputText') continue
      if (typeof one['text'] === 'string') parts.push(one['text'])
    }
    return parts
  }
  if (item['type'] === 'mcpToolCall') {
    const result = readField(item, 'result')
    if (result === undefined || result === null) return null
    const parts: string[] = []
    const content = readField(result, 'content')
    if (typeof content === 'string') parts.push(content)
    else if (Array.isArray(content)) {
      for (const block of content) {
        if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
          parts.push(block['text'])
        }
      }
    }
    // `structuredContent` goes last, as in {@link mcpResultSummary}, serialised because surfaces receive
    // characters. Named `machineHalf` so a mutation anchor on `structured` in `mcpResultSummary` stays unique.
    const machineHalf = readField(result, 'structuredContent')
    if (machineHalf !== undefined && machineHalf !== null) {
      try {
        const encoded = JSON.stringify(machineHalf)
        if (encoded !== undefined) parts.push(encoded)
      } catch {
        // Unserializable: the text blocks above are still the answer; no invented word.
      }
    }
    return parts
  }
  return null
}

/**
 * The readable half of an MCP result: `content[]`'s text blocks, joined. A copy of `claude/normalize.ts`'s
 * `joinText`, since the two normalizers share no runtime module by design.
 */
function mcpResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      out += block['text']
    }
  }
  return out
}

/**
 * One `skills/list` row read as a {@link ProviderCommand}. `interface.shortDescription` comes first
 * because it is written for a person, while `description` is a trigger written for the model; the
 * trigger is the fallback for a skill with no interface. `argumentHint` and `aliases` are absent
 * because `SkillMetadata` declares neither.
 */
export function readCodexSkill(skill: unknown): ProviderCommand {
  const short = readString(readField(skill, 'interface'), 'shortDescription')
  const described = short || readString(skill, 'description')
  const path = readString(skill, 'path')
  const full = readString(skill, 'description')
  return {
    name: readString(skill, 'name'),
    ...(described ? { description: described } : {}),
    // Its file, and the full description the model is given.
    ...(path
      ? {
          skill: {
            path,
            scope: readString(skill, 'scope'),
            ...(full ? { description: full } : {}),
          },
        }
      : {}),
  }
}

/**
 * The birth of an agent Codex dispatched as the neutral `sub_agent` card. Only `item/started` reaches
 * here: `item/started` and `item/completed` carry a byte-identical item because a `subAgentActivity` is
 * an announcement, not a span, and `item/completed` does not mean the sub-agent finished (its ending
 * arrives on its own thread, in `sub-agents.ts`). `agentThreadId` is the child's real thread id and
 * correlates later `thread/status/changed` frames. `parentToolCallId` is the collab call that spawned
 * it, carried so the renderer can adopt an orphan card once a row with that id appears.
 */
export function subAgentBirth(item: Record<string, unknown>): RuntimeEvent | null {
  const agentId = readString(item, 'agentThreadId')
  // No identity, no card: a card that can never be updated or ended is worse than the `unknown`.
  if (!agentId) return null
  const activity = subAgentActivity(readString(item, 'kind') as SubAgentActivityKind)
  if (!activity) return null
  const parentToolCallId = readString(item, 'id')
  const kind = agentName(readString(item, 'agentPath'))
  return {
    type: 'sub_agent',
    run: nativeRun('agent', {
      input: agentInput(undefined, kind, readString(item, 'model')),
      ...(activity.phase === 'ended' ? { result: activity.outcome } : {}),
    }),
    agentId,
    // A real thread id with a rollout file of its own, unlike Claude's.
    idKind: 'thread',
    ...activity,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    ...(kind ? { kind } : {}),
  }
}

/**
 * What one phase of a sub-agent's life contributes to its card. No `summary`: a child's words must be
 * owned by the card that says who is speaking, and a Codex card has no body for them yet.
 */
type SubAgentPhase = Pick<Extract<RuntimeEvent, { type: 'sub_agent' }>, 'phase' | 'outcome'>

/**
 * Codex's `SubAgentActivityKind` to the neutral phase, exhaustive over the generated union. `interacted`
 * is progress, not an ending; `interrupted` is an ending that is neither success nor the sub-agent's
 * fault, so it reports itself rather than becoming `failed`.
 */
function subAgentActivity(kind: SubAgentActivityKind): SubAgentPhase | null {
  switch (kind) {
    case 'started':
      return { phase: 'started' }
    case 'interacted':
      return { phase: 'progress' }
    case 'interrupted':
      return { phase: 'ended', outcome: 'interrupted' }
    // No `outcome`: the name says the child is done, not how it went. Its own `turn/completed` says that,
    // and an outcome here could overwrite a failed one.
    case 'completed':
      return { phase: 'ended' }
    default:
      return assertSubAgentKindExhaustive(kind)
  }
}

/** Compile-time exhaustiveness over `SubAgentActivityKind`; a runtime-novel kind is unreadable. */
function assertSubAgentKindExhaustive(kind: never): null {
  void kind
  return null
}

/**
 * `/root/workspace_mapper` to `workspace_mapper`, the name the model coined for the child. The leading
 * `/root/` is the primary agent and is dropped; the rest is kept as sent (`/root/a/b` reads `a/b`).
 * A path shaped otherwise is shown whole.
 */
function agentName(path: string): string {
  return path.startsWith('/root/') ? path.slice('/root/'.length) : path
}

/**
 * A `collab` row that says what it did: the operation (spawn, message, wait, close) and who it
 * concerns as a count, since `receiverThreadIds` and `agentsStates` are empty on captured items.
 */
function collabSummary(item: Record<string, unknown>): string {
  const tool = readString(item, 'tool')
  const receivers = readField(item, 'receiverThreadIds')
  const count = Array.isArray(receivers) ? receivers.length : 0
  // "every agent" only for `wait`, the one broadcast; otherwise an empty list says only that the
  // provider named no agent.
  const who =
    count > 0
      ? `${count} agent${count === 1 ? '' : 's'}`
      : tool === 'wait'
        ? 'every agent'
        : 'an agent'
  // An unrecognized tool keeps its own name; only a missing one falls back to 'collab'.
  const operation = collabOperation(tool as CollabAgentTool, who) ?? tool ?? ''
  const head = operation || 'collab'
  const model = readString(item, 'model')
  const prompt = readString(item, 'prompt')
  const named = model ? `${head} · ${model}` : head
  return truncate(prompt ? `${named} — ${prompt}` : named)
}

/**
 * Codex's `CollabAgentTool` to a phrase, exhaustive over the generated union. `null` means unknown,
 * and the caller shows the raw name.
 */
function collabOperation(tool: CollabAgentTool, who: string): string | null {
  switch (tool) {
    case 'spawnAgent':
      return 'spawn an agent'
    case 'sendInput':
      return `send input to ${who}`
    case 'resumeAgent':
      return `resume ${who}`
    case 'wait':
      return `wait for ${who}`
    case 'closeAgent':
      return `close ${who}`
    case 'sendMessage':
      return `send a message to ${who}`
    case 'followupTask':
      return `give ${who} a follow-up task`
    case 'interruptAgent':
      return `interrupt ${who}`
    case 'listAgents':
      return 'list agents'
    default:
      return assertCollabToolExhaustive(tool)
  }
}

/** Compile-time exhaustiveness over `CollabAgentTool`; a runtime-novel tool keeps its own name. */
function assertCollabToolExhaustive(tool: never): null {
  void tool
  return null
}

/**
 * Every status any tool item can report, the union of the generated per-type status unions. A new
 * member in any of them makes {@link toolStatusOutcome}'s switch non-exhaustive.
 */
type ToolStatus =
  | CommandExecutionStatus
  | PatchApplyStatus
  | McpToolCallStatus
  | DynamicToolCallStatus
  | CollabAgentToolCallStatus

/** The `ok` a tool result reports, plus the reason when it is not an affirmative success. */
interface ToolOutcome {
  ok: boolean
  /** Appended to the summary so a fail-closed result says why. */
  note?: string
}

/**
 * Compile-time exhaustiveness over {@link ToolStatus}. At runtime it is reached only by a value outside
 * the generated union, which must never be read as a success.
 */
function assertToolStatusExhaustive(status: never): ToolOutcome {
  return { ok: false, note: `unrecognized status ${JSON.stringify(status)}` }
}

/**
 * Map a tool item's status to its outcome, affirmative-only: only `completed` succeeds, and
 * `inProgress`, a missing status or a future status fail closed with a reason.
 */
function toolStatusOutcome(status: ToolStatus): ToolOutcome {
  switch (status) {
    case 'completed':
      return { ok: true }
    case 'failed':
      return { ok: false, note: 'failed' }
    case 'declined':
      return { ok: false, note: 'declined' }
    case 'interrupted':
      return { ok: false, note: 'interrupted' }
    case 'inProgress':
      return {
        ok: false,
        note: 'still inProgress on item/completed — the tool did not report success',
      }
    default:
      return assertToolStatusExhaustive(status)
  }
}

/**
 * Web search has no status field, so `item/completed` is its affirmative completion. A protocol status
 * field would fail this assignment to compile.
 */
const WEB_SEARCH_HAS_NO_STATUS: 'status' extends keyof WebSearchItem ? never : true = true

/**
 * The outcome for one completed tool item, affirmative-only per kind. A missing or non-string status
 * fails closed as a `tool_result` with the reason (so the card still resolves) rather than an
 * `unknown`. A `dynamicToolCall.success === false` or an `mcpToolCall.error` beside `completed` is a
 * contradiction and also fails.
 */
function toolOutcome(type: string, item: Record<string, unknown>): ToolOutcome {
  if (type === 'webSearch') {
    void WEB_SEARCH_HAS_NO_STATUS
    return { ok: true }
  }
  const status = item['status']
  if (typeof status !== 'string') {
    return { ok: false, note: 'no status reported — cannot be read as success' }
  }
  const outcome = toolStatusOutcome(status as ToolStatus)
  if (!outcome.ok) return outcome
  // A contradiction is anything that is not an affirmative success, including `success: 'false'` and a
  // string `error`.
  if (type === 'dynamicToolCall' && isNonAffirmativeSuccess(item['success'])) {
    return { ok: false, note: `completed but reported success:${JSON.stringify(item['success'])}` }
  }
  if (type === 'mcpToolCall' && hasReportedError(item['error'])) {
    return { ok: false, note: 'completed but carried an error' }
  }
  return outcome
}

/**
 * Whether a `success` field contradicts the completed status. The shape is `boolean | null`, where
 * null or absent means not reported and the status decides; anything else present and not literally
 * `true` (`false`, `'true'`, `0`, `{}`) is a contradiction.
 */
function isNonAffirmativeSuccess(success: unknown): boolean {
  if (success === undefined || success === null) return false
  return success !== true
}

/**
 * Whether an `error` field reports an error. The shape is `McpToolCallError | null`, but a
 * non-conformant server may send a bare string, so any present non-empty value counts.
 */
function hasReportedError(error: unknown): boolean {
  if (error === undefined || error === null) return false
  if (typeof error === 'string') return error.length > 0
  return true
}

/**
 * The questions an `agentMessage` asked without waiting (`delivery: "async"` with
 * `questions: [{title, options}]`), bounded by {@link ASKED_QUESTION_LIMITS}. Empty for every other
 * message and for a malformed entry.
 */
function asyncQuestionsOf(item: Record<string, unknown>): { title: string; options?: string[] }[] {
  if (readString(item, 'delivery') !== 'async') return []
  const asked = readField(item, 'questions')
  if (!Array.isArray(asked)) return []
  const cut = (text: string, max: number): string =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text
  const questions: { title: string; options?: string[] }[] = []
  for (const one of asked.slice(0, ASKED_QUESTION_LIMITS.questions)) {
    const title = readString(one, 'title').trim()
    if (title === '') continue
    const listed = readField(one, 'options')
    const options = Array.isArray(listed)
      ? listed
          .filter((option): option is string => typeof option === 'string' && option.trim() !== '')
          .slice(0, ASKED_QUESTION_LIMITS.options)
          .map((option) => cut(option, ASKED_QUESTION_LIMITS.optionChars))
      : []
    questions.push({
      title: cut(title, ASKED_QUESTION_LIMITS.titleChars),
      ...(options.length > 0 ? { options } : {}),
    })
  }
  return questions
}

function turnErrorText(error: unknown, fallback = 'unknown'): string {
  const message = readString(error, 'message') || fallback
  // Keep the provider's explanation beside its message.
  const explanation = readString(readField(error, 'misalignment'), 'detailedExplanation').trim()
  return explanation ? `${message} — ${explanation}` : message
}

/** A failed image generation in Codex's own terms: which limit, and when it resets if it said. */
function imageFailureMessage(failure: Record<string, unknown>): string {
  const kind = readString(failure, 'type')
  if (kind === 'usageLimitExceeded') {
    const resetsAt = readField(failure, 'resetsAt')
    const when =
      typeof resetsAt === 'number' && Number.isFinite(resetsAt)
        ? `; it resets at ${new Date(resetsAt * 1000).toISOString()}`
        : ''
    return `codex could not make the image: its usage limit was reached${when}`
  }
  return `codex could not make the image${kind ? ` (${kind})` : ''}`
}

/**
 * Keep `max` characters and say so with an ellipsis, so a bounded string is `max + 1` long.
 * Exported because `background-terminals.ts` bounds a provider `command` with the same arithmetic.
 */
export function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * The same item with its base64 image replaced by a description of it, for surfacing a malformed
 * `imageGeneration` as `unknown{raw}`. Every other field is kept; {@link boundRaw} would erase them all.
 */
function withoutImageBytes(item: Record<string, unknown>): Record<string, unknown> {
  const result = item['result']
  if (typeof result !== 'string') return item
  return { ...item, result: `<${result.length} chars of base64, not carried>` }
}
