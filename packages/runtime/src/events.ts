import { z } from 'zod'
import { turnSummarySchema, commandSummarySchema } from './summary-event-schemas'
import {
  sessionEventSchema,
  conversationResetEventSchema,
  turnEventSchema,
  providerTurnSchema,
  statusEventSchema,
  errorEventSchema,
  providerLimitClearSchema,
  providerUsageSchema,
  unknownEventSchema,
  type UnknownCategory,
} from './events-lifecycle'
import {
  assistantDeltaSchema,
  assistantMessageSchema,
  toolCallSchema,
  toolResultSchema,
  thinkingEventSchema,
  activityEventSchema,
  imageEventSchema,
  planUpdateEventSchema,
  subAgentEventSchema,
  contextReadingSchema,
  compactionEventSchema,
  fileChangeEventSchema,
} from './events-conversation'
import {
  permissionRequestSchema,
  userInputRequestSchema,
  requestResolvedSchema,
} from './events-requests'
import {
  workflowRunEventSchema,
  backgroundWorkSchema,
  scheduledWorkSchema,
  providerCommandsSchema,
  toolInventorySchema,
  memoryRecallSchema,
} from './events-work'
export type { ProviderRefusal } from './provider-refusal'

// Provider-neutral UI/orchestration facts, never terminal scraping; schemas document native mappings.

export {
  errorPresentationSchema,
  MAX_USAGE_WINDOWS,
  unknownCategorySchema,
} from './events-lifecycle'
export { ASKED_QUESTION_LIMITS, MAX_MEMORY_PATH } from './events-conversation'
export { MAX_PERMISSION_DETAIL_CHARS, boundPermissionDetail } from './events-requests'
export type { ErrorCause, ErrorPresentation, UnknownCategory } from './events-lifecycle'
export type { PlanStep } from './events-conversation'

/** The full discriminated union of runtime events. */
export const runtimeEventSchema = z.discriminatedUnion('type', [
  sessionEventSchema,
  conversationResetEventSchema,
  turnEventSchema,
  turnSummarySchema,
  commandSummarySchema,
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
export type ProviderTurnFailure = NonNullable<
  Extract<RuntimeEvent, { type: 'turn' }>['providerFailure']
>

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
  'turn_summary',
  'command_summary',
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
  if (category === 'unrecognized') console.warn('Unmodeled provider event', event)
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
