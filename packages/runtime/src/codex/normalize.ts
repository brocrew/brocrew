import {
  ASKED_QUESTION_LIMITS,
  wrapUnknown,
  type PlanStep,
  type RuntimeEvent,
  type TurnLimit,
  type UnknownCategory,
} from '../events'
import { parseUnifiedDiff } from '../file-change'
import { boundRecall, type MemoryRecallEntry } from '../memory-recall'
import type { ProviderCommand } from '../provider-commands'
import { isCodexUnauthorized } from './auth-probe'
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

/**
 * Normalize one `codex app-server` NOTIFICATION into **content** `RuntimeEvent`s
 * only (assistant deltas/messages, tool calls/results, informational errors) —
 * 001 Codex→RuntimeEvent table. Pure.
 *
 * Session/turn LIFECYCLE is NOT emitted here: the `session` event comes from the
 * `thread/start`/`resume` RESPONSE, and the turn terminal is driven by the shared
 * `SessionMachine` from {@link codexTurnOutcome} (`turn/completed`). `turn/started` binds
 * nothing — the id comes from the `turn/start` RESPONSE (037) — and is where the handle sends an
 * interrupt it was asked for again (704: Codex refuses one before the turn runs). Unmapped →
 * `unknown{raw}`.
 *
 * ⚠️ **Still pure except for `watch`, and the exception is named rather than hidden** (188 §2, from
 * 182 M4). Exactly one notification — `account/rateLimits/updated` — is defined by the provider as a
 * SPARSE update over earlier ones, so judging it needs a memory of the session it belongs to. That
 * memory is {@link RateLimitWatch}, owned by the handle and passed in. ⛔ **Omitting it is not a
 * default, it is the older per-frame reading**: every other caller (sub-agent normalization, and
 * every fixture in `codex-normalize.test.ts`) gets exactly what it got before.
 */
export function normalizeNotification(
  method: string,
  params: unknown,
  watch?: RateLimitWatch,
): RuntimeEvent[] {
  switch (method) {
    case 'item/agentMessage/delta': {
      // An intentional no-content delta and a MALFORMED payload are different things (055,
      // fixing 044 P2 #5). Both used to return `[]`, so a delta whose `delta` field was missing
      // or not a string vanished without trace — indistinguishable from the provider sending
      // nothing. A well-formed empty delta is still a no-op; anything else is SURFACED.
      const raw = readField(params, 'delta')
      if (typeof raw !== 'string') return [unrecognized(method, params)]
      return raw ? [{ type: 'assistant_delta', text: raw }] : []
    }

    case 'item/started':
      return itemToEvents(readField(params, 'item'), 'started')

    case 'item/completed':
      return itemToEvents(readField(params, 'item'), 'completed')

    // The reasoning SUMMARY stream (027). It only exists because the turn asks for it —
    // `TurnStartParams.summary`; without that, reasoning items arrive empty and none of this
    // fires. `content` is never delivered by the server, so what reaches the UI is a summary of
    // the reasoning and never the raw chain of thought.
    case 'item/reasoning/summaryTextDelta': {
      const delta = readField(params, 'delta')
      if (typeof delta !== 'string') return [unrecognized(method, params)]
      return delta ? [{ type: 'thinking', phase: 'delta', text: delta }] : []
    }

    // The boundary between one summary part and the next: a delta carrying NOTHING — no text, no
    // count. That emptiness is the whole signal, and the fold reads it as "a new paragraph of
    // reasoning begins" — it separates the parts already on screen and never starts a block of its
    // own, because a boundary with nothing on either side of it is not a thought.
    case 'item/reasoning/summaryPartAdded':
      return [{ type: 'thinking', phase: 'delta' }]

    // The agent's working CHECKLIST (028). Codex states the WHOLE plan every time — captured live
    // as `[inProgress, pending, pending]` and then `[completed, completed, completed]` — which is
    // exactly the neutral event's replace-don't-append contract, so there is nothing to accumulate
    // here and no per-session state to keep. (Claude's half of this is the opposite; see
    // `claude/todo-plan.ts`.)
    //
    // `item/plan/delta` is deliberately NOT first-class beside it: the protocol marks it
    // EXPERIMENTAL and warns that concatenated deltas need not match the completed plan, and it
    // never fired in capture. It stays classified chatter rather than a second, weaker source of
    // truth for the same checklist.
    case 'turn/plan/updated': {
      const plan = readField(params, 'plan')
      if (!Array.isArray(plan)) return [unrecognized(method, params)]
      const steps: PlanStep[] = []
      for (const entry of plan) {
        const text = readString(entry, 'step')
        const status = planStepStatus(readString(entry, 'status') as TurnPlanStepStatus)
        // One unreadable entry condemns the WHOLE notification, rather than rendering a checklist
        // with a hole in it. A step we cannot read is not a step we may guess at, and a plan that
        // silently drops a line is worse than no plan: the user cannot tell it is incomplete.
        if (!text || !status) return [unrecognized(method, params)]
        steps.push({ text, status })
      }
      // `explanation` is `null` while the plan is being worked and a sentence once it is done, so
      // absence is the normal case and must stay absence rather than becoming an empty note.
      const explanation = readString(params, 'explanation')
      return [{ type: 'plan_update', steps, ...(explanation ? { note: explanation } : {}) }]
    }

    // **How full the context window is** (087). The one signal in this switch that is a MEASUREMENT
    // rather than a message, and the only reason the meter can draw a percentage at all.
    //
    // ⚠️ **`last`, never `total` — and this is not a preference, it is the difference between a
    // reading and a lie.** Measured over all 198 of these payloads in this machine's own database:
    // `total.totalTokens` is CUMULATIVE billing for the thread. It climbs monotonically past the
    // window and **exceeded `modelContextWindow` in 29 of the 198** (445,780 against a 258,400
    // window — a gauge reading 172%). `last.*` is the most recent request's usage and exceeded it in
    // **zero**. `last.totalTokens` is therefore the tokens actually in the window; `total` is what
    // the turn cost.
    //
    // `modelContextWindow` is `number | null` in the generated type, so the reading kind is decided
    // by what arrived rather than by which provider sent it — and `<= 0` is treated as absent, since
    // a zero denominator produces `Infinity` and `Infinity` renders.
    case 'thread/tokenUsage/updated': {
      const usage = readField(readField(params, 'tokenUsage'), 'last')
      const used = readNumber(usage, 'totalTokens')
      // No readable count is a malformed first-class method, not chatter: `unrecognized` is loud on
      // purpose, because a meter silently receiving nothing looks exactly like a quiet provider.
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

    // Compaction, announced by the notification. ⚠️ **It carries no magnitudes and none are
    // invented**: `ContextCompactedNotification` is `{threadId, turnId}` in the generated protocol,
    // full stop. It is also DEPRECATED there (*"Use `ContextCompaction` item type instead"*) and has
    // fired zero times on this machine while the item has fired four, so the item in
    // {@link itemToEvents} is the path that actually runs. Both are handled because a live
    // app-server older than that deprecation is a thing that exists, and a compaction we saw and
    // discarded is the one thing this feature must never do.
    case 'thread/compacted':
      return [{ type: 'compaction', source: method }]

    // **What the turn did to the working tree** (096, designed in 092).
    //
    // ⚠️ **This is not the source 092 designed on, and that is the finding.** 092 named
    // `item/fileChange/patchUpdated` — `FileUpdateChange{path,kind,diff}`, per-file, renames via
    // `move_path` — as *"the richest source we have and we drop it."* It is in the generated
    // protocol and it has **never arrived**: zero occurrences in 458,200 recorded wire frames and
    // zero across three live probe runs whose turns edited four files each with real `apply_patch`
    // calls. `turn/diff/updated` arrived in every one of them, three to five times per turn.
    //
    // 092 also read this payload as *"one aggregated unified-diff string… no per-file split."* It is
    // one string **made of per-file sections**: git format, `diff --git a/… b/…` per file, with
    // `new file mode` / `deleted file mode` markers and real hunks. So the split is there, and
    // {@link parseUnifiedDiff} does it — including renames, which appear as a header with two
    // different paths and NOT as the `rename from`/`rename to` pair (measured; the probe asserts it).
    //
    // Each payload is a full snapshot of the turn, not a delta — three were byte-identical in one
    // measured turn — so the consumer folds by path and the repetition costs nothing.
    case 'turn/diff/updated': {
      const diff = readString(params, 'diff')
      // A payload with no readable diff is a malformed first-class method, not chatter — the same
      // ruling `thread/tokenUsage/updated` makes one case up. A pane silently receiving nothing looks
      // exactly like an agent that changed nothing, and those must never render the same.
      if (!diff) return [unrecognized(method, params)]
      const parsed = parseUnifiedDiff(diff)
      // Not a git diff at all: keep it loud and lossless rather than report zero changes.
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
      // The current `ErrorNotification` carries `error.message` (a `TurnError`);
      // read it, falling back to a legacy top-level `message` (007 P2-2).
      const turnError = readField(params, 'error')
      const message =
        readString(turnError, 'message') || readString(params, 'message') || 'codex error'
      // 098: the typed half. `codexErrorInfo: "unauthorized"` is how a rejected credential arrives —
      // as turn OUTPUT rather than as a refusal, which is why 085's conversion of the throw sites
      // did not already cover it. The sentence is kept verbatim; the cause is what a surface reads.
      return [
        {
          type: 'error',
          message,
          fatal: false,
          ...(isCodexUnauthorized(turnError) ? { cause: 'auth' as const } : {}),
        },
      ]
    }

    // ⛔ **The wall you hit without warning** (177 §1). This arrives ROUTINELY — once or twice a
    // turn, measured — and until 177 it fell into the chatter list below, where `normal` mode drops
    // it entirely (`transcript-mode.ts`). So a Codex user at 99% of their weekly window learned
    // nothing, and the app's own stall notice was left GUESSING at it in prose:
    // *"the provider may be busy, rate-limited, or stalled"* (`liveness.ts`).
    //
    // ⚑ **Content-gated, exactly as Claude's `rate_limit_event` is** (074): routine is noise, a
    // throttle the user is FEELING is not. The quiet half still becomes chatter, so nothing is lost
    // — same shape, same reason, as `claude/normalize.ts`'s `break`.
    case 'account/rateLimits/updated': {
      const snapshot = readField(params, 'rateLimits')
      // With a watch: merged against this session's earlier frames, and silent when it would repeat
      // itself. Without one: the pure per-frame reading this had before 188. See the parameter.
      const pressure = watch ? watch.observe(snapshot) : rateLimitPressure(snapshot)
      // ⚑ **Every reading, near a limit or not, for a person's Providers screen** — a
      // `provider_usage` the host keeps and never records; from the bucket as merged, so a sparse
      // frame does not read as a window that lost its reset ({@link rateLimitUsage}).
      const usage = rateLimitUsage(watch ? watch.lastReading() : { snapshot, mainLimitId: null })
      // ⚠️ The quiet half is spelled out rather than `break`-ing to the classifier, because this
      // switch has nothing after it — a `break` here would return `undefined`. It is the same
      // category the chatter list gave it, and it is now stated where the gate is.
      const said: RuntimeEvent[] = pressure
        ? [{ type: 'error', message: pressure, fatal: false }]
        : [wrapUnknown('codex', { method, params }, 'lifecycle', method)]
      return usage === null ? said : [...said, usage]
    }

    // ⛔ **"You are talking to the model you picked" is a state, and 086 says the app must not imply
    // one it cannot back** (177 §2). The parity matrix carries a row called *"Model silently
    // rerouted"*, and while this sat in the chatter list the adjective was doing the work the app
    // was not.
    //
    // ⚠️ **Not content-gated, and the generated type is why.** `ModelRerouteReason` has exactly one
    // member — `highRiskCyberActivity` — so this notification is never routine: it fires when the
    // provider decides a turn looks like high-risk cyber activity and swaps the model out from under
    // the request. Every one of them is a fact the person who chose the model needs.
    //
    // `codex-runtime.ts` separately merges `toModel` into the session's agent info, so the header
    // already shows what is running; this is the sentence that says WHY it changed.
    // ⛔ **The provider ships a boolean called `showBufferingUi`, and BroBot was hiding it** (188 §2,
    // from 182 M5). `ModelSafetyBufferingUpdatedNotification` carries `threadId`, `turnId`, `model`,
    // `useCases`, `reasons`, `fasterModel` and that flag; every one of them landed in the chatter
    // list, so in normal mode a turn could pause mid-stream with nothing on screen and the reason
    // reachable only from raw history. 177 left it there on the honest grounds that **no payload had
    // been captured** — and 182's correction is the one this codebase has now made twice: an absent
    // capture is not an absent field. The generated type is a measurement of its own, it declares
    // the boolean as non-nullable, and it is the provider telling us to show something.
    //
    // ⚑ **Content-gated exactly like the rate-limit line above**, and the flag IS the gate rather
    // than a threshold of ours: `false` — the provider saying "do not show a buffering UI" — stays
    // lifecycle chatter and is lossless in raw history, so nothing routine reaches the transcript.
    case 'model/safetyBuffering/updated': {
      if (readField(params, 'showBufferingUi') !== true) {
        return [wrapUnknown('codex', { method, params }, 'lifecycle', method)]
      }
      return [{ type: 'error', message: safetyBufferingMessage(params), fatal: false }]
    }

    case 'model/rerouted':
      return [{ type: 'error', message: rerouteMessage(params), fatal: false }]

    // Lifecycle — owned by the handle + machine, not emitted as content here.
    case 'turn/started':
    case 'turn/completed':
    case 'thread/started':
    case 'thread/closed':
      return []

    default:
      // A warning must be SEEN (065): it surfaces as a non-fatal `error` — visible in the UI —
      // rather than as quiet chatter. `fatal:false` keeps the session and turn alive; only a real
      // fatal terminalizes.
      if (isWarningMethod(method)) {
        return [{ type: 'error', message: warningMessage(method, params), fatal: false }]
      }
      // Raw provider payload → wrapped, never re-parsed as a real variant (007 P2-8), but
      // CLASSIFIED by method so recognized streams don't drown the signal (049).
      return [wrapUnknown('codex', { method, params }, notificationCategory(method), method)]
  }
}

/**
 * Methods {@link normalizeNotification} handles itself — first-class content, or lifecycle the
 * handle + `SessionMachine` own. They never reach the chatter classifier, so excluding them keeps
 * {@link notificationCategory} exhaustive over exactly the methods it is responsible for.
 *
 * This list is the DECLARATION and the switch is the implementation, so keep them together: adding
 * a `case` above without adding it here leaves a dead arm in the classifier that quietly satisfies
 * the exhaustiveness check (027 shipped that way for a day). The reverse — a name here with no
 * `case` — fails loudly at runtime as an `unrecognized` card rather than silently, which is the
 * right way round for the one direction the compiler cannot see.
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
 * The generated methods that report a PROBLEM rather than progress (065, from 064's flagged call).
 * 064 filed these as quiet `lifecycle` chatter, which meant a possibly security-relevant
 * `guardianWarning` could never reach the user. They are now surfaced as **non-fatal `error`
 * events** — visible, but they must never end the session or turn (only a real fatal does).
 *
 * ONE source of truth: {@link isWarningMethod} dispatches from this array and {@link ChatterMethod}
 * excludes it, so a method cannot be both routed as a warning and classified as chatter.
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
 * Compile-time proof that every entry above is a REAL generated method — a typo or a method dropped
 * by a protocol bump resolves the conditional to `never` and fails the build, rather than silently
 * routing nothing (the array is a runtime list, so `Exclude` alone would not catch it).
 */
const WARNING_METHODS_ARE_GENERATED: WarningMethod extends ServerNotification['method']
  ? true
  : never = true

function isWarningMethod(method: string): method is WarningMethod {
  void WARNING_METHODS_ARE_GENERATED
  return (WARNING_METHODS as readonly string[]).includes(method)
}

/**
 * A readable line for a warning: the method (so the source is unambiguous) plus whatever text the
 * payload carries — `message` on the warning/guardian/realtime shapes, `summary` (+ `details`) on
 * the config/deprecation ones. A payload with no text degrades to the method name alone rather
 * than to an empty string.
 */
function warningMessage(method: string, params: unknown): string {
  const summary = readString(params, 'summary')
  const details = readString(params, 'details')
  const text =
    readString(params, 'message') || (summary && details ? `${summary} — ${details}` : summary)
  return text ? `${method}: ${text}` : method
}

/**
 * ⛔ **How full a window has to be before the app says so** (177 §1).
 *
 * ⚠️ **Codex sends no equivalent of Claude's `allowed_warning`, so this number is ours and it has
 * to be argued.** `RateLimitSnapshot` reports `usedPercent` and nothing that says "you are about to
 * be throttled"; the wall itself arrives as `rateLimitReachedType`, which needs no threshold at all.
 * So this governs only the APPROACH.
 *
 * ⚑ **90, for three reasons, and the third is the one that matters.**
 *  1. What is being bought is the last tenth of a window: ≤30 minutes on the 5-hour window, ~16
 *     hours on the 7-day one. Either is still enough time to do something about it.
 *  2. A warning that fires for most of a window is ambient state, not a warning. That belongs on a
 *     meter (086's surface), not in the transcript.
 *  3. ⛔ **Measured on this machine, the routine frame carries `usedPercent: 74`** — so a floor of
 *     90 leaves the LIVE negative control real: the frame that actually arrives has to stay quiet,
 *     and `throttle-probe.smoke.ts` asserts that against the provider rather than against a fixture.
 *     A floor at 70 would have made the paired negative untestable on the wire.
 */
const RATE_LIMIT_WARN_PERCENT = 90

/**
 * The user-facing line for a rate-limit snapshot that is ACTUALLY constraining the session, or
 * `null` for the routine heartbeat (177 §1, mirroring `claude/normalize.ts`'s `rateLimitThrottle`).
 *
 * ⚠️ **`AccountRateLimitsUpdatedNotification` documents itself as a SPARSE rolling update** —
 * *"Nullable account metadata may be unavailable in a rolling update and does not clear a previously
 * observed value."* This function is pure and has no memory of earlier frames, so it judges each one
 * on what it carries: a `null` is read as "not reported here", never as "reset to fine". That is the
 * only safe direction available TO A PURE FUNCTION — and 182 M4 is that it is not the whole
 * contract. ⛔ **The memory lives in {@link RateLimitWatch} now**, which merges each frame into the
 * last one before calling this; a caller that supplies no watch still gets exactly this per-frame
 * reading, which is what every fixture in `codex-normalize.test.ts` asserts.
 *
 * ⛔ **`credits` is deliberately NOT a gate**, and it is the one field that looks like it should be.
 * Measured live on a `pro` plan mid-session: `{hasCredits:false, unlimited:false, balance:"0"}`,
 * while the turn ran perfectly. Never having bought credits is the normal state, so gating on it
 * would fire a warning on every routine frame — the exact noise 074 removed from Claude's side.
 *
 * ⛔ **One window carries the whole sentence — its percentage AND its reset** (188 §2, from 182 M4).
 * The reset used to be `Math.max` across both windows while the percentage came from the fuller one,
 * so a 95% five-hour window resetting in twenty minutes beside a 10% weekly window was reported as
 * *"95% of a 5-hour window used; resets <next week>"*. Two windows, one sentence, and the number a
 * person would act on belonged to neither. The wall and spend-control lines name no percentage, so
 * they take the same window's reset for the same reason: whichever window is fullest is the one that
 * stopped the turn, and a reset from any other window is a time at which nothing changes.
 *
 * ⚠️ **`qualify` is what stops the sentence describing no real bucket** (201, from 192 H1). A
 * `RateLimitSnapshot` is ONE metered bucket — `GetAccountRateLimitsResponse.rateLimitsByLimitId` is
 * keyed by `limitId` and this machine's own account really carries two, `codex` and
 * `codex_bengalfox` (*"GPT-5.3-Codex-Spark"*). ⛔ **The line names its bucket only when naming it
 * distinguishes something**: the bucket the provider itself calls the main one, and any account with
 * exactly one, speak in the unqualified sentence 177 shipped. See {@link RateLimitWatch.qualifies}.
 */
function rateLimitPressure(snapshot: unknown, qualify = false): string | null {
  if (!isRecord(snapshot)) return null
  const reached = readString(snapshot, 'rateLimitReachedType')
  // The window the sentence is ABOUT: whichever is fuller, and a snapshot that names neither has
  // no window to quote a reset from.
  const worst = fullestWindow(snapshot)
  const resets = windowResetsAt(worst?.window)
  const when = resets > 0 ? `; resets ${new Date(resets * 1000).toISOString()}` : ''
  // Which bucket this is about, when that is a question the reader could be wrong about. The
  // provider's own display name first, its id second, and NOTHING when it gave us neither — a
  // sentence that says "on the  limit" would be worse than the one that says nothing.
  const named = readString(snapshot, 'limitName') || readString(snapshot, 'limitId')
  const where = qualify && named ? ` on the ${named} limit` : ''
  // The wall, as the provider itself reports it — no threshold of ours involved.
  if (reached) {
    return `codex is rate-limited (${reached})${where} — the turn may stall until it resets${when}`
  }
  if (readField(snapshot, 'spendControlReached') === true) {
    return `codex has reached its spend control${where} — the turn may stall until it resets${when}`
  }
  // The approach. Both windows are reported by the same shape, so the fuller one carries it.
  if (!worst || worst.used < RATE_LIMIT_WARN_PERCENT) return null
  return (
    `codex is approaching its rate limit${where} — ${Math.round(worst.used)}% of ` +
    `${windowName(worst.window)} used${when}`
  )
}

/**
 * 🔒 **How many metered buckets one session will hold state for** (201, 052's rule on 200's
 * surface). The key is a `limitId` off the wire, so an unbounded map is a provider-driven leak.
 * Measured: this machine's account carries **two**. Past the cap a frame is judged ALONE — the
 * pre-188 per-frame reading — rather than merged into a bucket it is not about.
 */
const MAX_TRACKED_BUCKETS = 16

/** Where a frame that names no `limitId` goes when nothing better can be said about it. */
const UNNAMED_BUCKET = '(unnamed)'

/** One metered limit, and the last sentence this session showed about it. */
interface RateLimitBucket {
  /** Everything ever observed about this bucket. Nulls never clear; sub-objects merge into. */
  snapshot: Record<string, unknown>
  /** The last line THIS bucket actually showed — `null` again the moment it returns to quiet. */
  said: string | null
}

/**
 * The provider's sparse-update contract, held per BUCKET for one session (201, from 192 H1; 188 §2,
 * from 182 M4).
 *
 * ## ⛔ What the contract says, and what BroBot was doing instead
 *
 * `AccountRateLimitsUpdatedNotification`'s own doc: *"Clients should merge available values into the
 * most recent `account/rateLimits/read` response or refetch that snapshot. Nullable account metadata
 * may be unavailable in a rolling update and does not clear a previously observed value."*
 * `RateLimitSnapshot.spendControlReached` says it a second time and more sharply: *"`None` is
 * unavailable, not a sparse-update recovery."*
 *
 * 188 gave this class a memory and got three things wrong about what the memory IS, all three
 * measured by 192 H1 and re-read line by line by the PM:
 *
 * | | |
 * |---|---|
 * | ⛔ **one flat record for a keyed protocol** | `GetAccountRateLimitsResponse.rateLimitsByLimitId` is *"the multi-bucket view keyed by metered `limit_id`"*, and this machine's own account really carries two — `codex` and `codex_bengalfox` (*"GPT-5.3-Codex-Spark"*). A frame for one overwrote the keys it carried and inherited the rest, so the sentence described **no real bucket** |
 * | ⛔ **a TOP-LEVEL merge for a nested shape** | a rolling frame's fresh `primary` replaced the held one whole, taking the `windowDurationMins` and `resetsAt` that were null only because UNAVAILABLE. 165's rule, third time: an absent field is a VALUE |
 * | ⛔ **no baseline to merge INTO** | *"the most recent `account/rateLimits/read` response"* is the other half of the sentence, and nothing called it. See {@link seed} — 201 chose to make the call |
 *
 * ## The merge, and the one place it is allowed to forget
 *
 * A non-null field replaces; a null or absent field keeps what was last observed; two records at the
 * same key merge into one another rather than replacing ({@link mergeSparse}). ⚠️ **With one expiry,
 * and it is the provider's number rather than ours**: a bucket is dropped once every window it holds
 * has a `resetsAt` in the past. ⛔ **An UNKNOWN reset is unknown, not past** (201 §5) — the old
 * `.filter((at) => at > 0)` ran BEFORE `.every(...)`, so a bucket holding one expired window beside
 * one window that had never reported a reset expired on the strength of the window it had chosen to
 * ignore. ⚑ When no reset is known at all the value STANDS: an unresettable wall is the state 177
 * exists to show, and dropping it on a timer of our own would be inventing exactly the "reset to
 * fine" this class refuses to infer from an absence.
 *
 * ## ⛔ …and it says each thing ONCE, per bucket, until quiet returns
 *
 * 177 measured `account/rateLimits/updated` at once or twice per turn. Above 90% every one of them
 * produced a fresh transcript warning, so a hundred-turn conversation accumulated a hundred-odd
 * identical lines — 182 M4's third half. {@link observe} returns a line only when it differs from
 * the last line that BUCKET actually showed. ⛔ **And a return to quiet clears it** (201 §4): before,
 * `said` survived until expiry, so a warning that went away and came back word-for-word was deduped
 * against a state that had ended. 074's rule is that routine is noise; it is NOT that a returning
 * wall is routine. ⚠️ A REPEAT is still not silence: the frame becomes lifecycle chatter and is in
 * the raw history, exactly like the quiet ones.
 */
export class RateLimitWatch {
  private readonly buckets = new Map<string, RateLimitBucket>()

  /**
   * The bucket the PROVIDER calls the main one — `GetAccountRateLimitsResponse.rateLimits` is
   * documented as *"the backward-compatible single-bucket view"*, so its `limitId` is the account's
   * default. Known only once {@link seed} has answered; two things read it, and both need it to
   * come from the provider rather than from a guess of ours (see {@link qualifies}, {@link keyFor}).
   */
  private primaryLimitId: string | null = null

  /** The one line the over-the-cap path is deduped against. 🔒 One string, not a map. */
  private overflowSaid: string | null = null

  /**
   * ⚑ The bucket the last frame merged into, by its key — `null` key: a frame judged alone, over
   * the cap ({@link lastReading}).
   */
  private lastObserved: { readonly key: string | null; readonly frame: unknown } | null = null

  /**
   * ⚑ **What the last frame {@link observe} took says about its bucket, merged** — for a reading of
   * how full its windows are ({@link rateLimitUsage}): the bucket's whole held snapshot, so a sparse
   * frame does not read as a window that lost its reset, and the bucket the provider calls its
   * main one. `null` before any frame.
   */
  lastReading(): UsageBucket | null {
    const last = this.lastObserved
    if (last === null) return null
    const bucket = last.key === null ? undefined : this.buckets.get(last.key)
    return { snapshot: bucket?.snapshot ?? last.frame, mainLimitId: this.primaryLimitId }
  }

  /** ⚑ Every bucket held, as {@link lastReading} gives one — what a {@link seed} read in full. */
  heldReadings(): UsageBucket[] {
    return [...this.buckets.values()].map((bucket) => ({
      snapshot: bucket.snapshot,
      mainLimitId: this.primaryLimitId,
    }))
  }

  /**
   * 🔴 **The provider's own word on whether ordinary usage is allowed** — 0.160.0's
   * `GetAccountRateLimitsResponse.ordinaryUsageAllowed`, read off `account/rateLimits/read`; `null`
   * until a read has carried a boolean.
   *
   * ⚑ The field's contract, whole: *"Backend permission for ordinary included usage, validated
   * against the active account. Null means unavailable; clients must not infer recovery from
   * percentages or reset times."* W4's ruling (provider follow-ups 1): while it is a boolean it decides
   * the MAIN limit, and the old inference is kept only where the provider gave no boolean — because
   * a wall nothing else can end would otherwise stand for the rest of the session.
   *  - `false` — the main limit stands, said with no reset time (so nothing downstream ends it by
   *    one either), is never dropped by a reset passing, and {@link awaitingTheProvidersWord} has the
   *    runtime read again before each turn. ⛔ It holds until a read says `true`: a read that says
   *    `null`, or a rolling wall (which agrees with it), does not undo it.
   *  - `true` — no rate-limit wall is said for the main limit, except one a rolling frame reported
   *    AFTER the read was asked: that frame is the newer word.
   */
  private ordinaryUsageAllowed: boolean | null = null

  /** When this session last saw the main limit's wall on a ROLLING frame, in ms — see `seed`. */
  private mainWallSeenAt = 0

  /** Whether a read has been taken into this watch yet — the first goes UNDER what it holds. */
  private seeded = false

  /**
   * 🔴 **F074 — the limit a turn Codex refused with `usageLimitExceeded` ended on**: the main
   * bucket's reached marker (its name, failing that) and when it resets — the latest reset among
   * its windows that are full, else its fullest window's — as this session's reads and frames left
   * them. ⛔ **No reset while the provider says ordinary usage is not allowed** — its contract
   * forbids inferring recovery from a reset time — ⛔ **nor for depleted credits**, which no window
   * resets.
   */
  reachedLimit(): TurnLimit {
    const key = this.mainKey()
    const snapshot = key === null ? undefined : this.buckets.get(key)?.snapshot
    if (snapshot === undefined) return { provider: 'codex' }
    const window =
      readString(snapshot, 'rateLimitReachedType') ||
      readString(snapshot, 'limitName') ||
      readString(snapshot, 'limitId')
    const full = [readField(snapshot, 'primary'), readField(snapshot, 'secondary')].filter(
      (one) => (readNumber(one, 'usedPercent') ?? 0) >= 100,
    )
    const resets =
      this.ordinaryUsageAllowed === false || window.endsWith('_credits_depleted')
        ? 0
        : full.length > 0
          ? Math.max(...full.map(windowResetsAt))
          : windowResetsAt(fullestWindow(snapshot)?.window)
    return {
      provider: 'codex',
      ...(window === '' ? {} : { window }),
      ...(resets > 0 ? { resetsAt: resets * 1000 } : {}),
    }
  }

  /** True while the provider's last word was "not allowed" — the runtime re-reads before a turn. */
  awaitingTheProvidersWord(): boolean {
    return this.ordinaryUsageAllowed === false
  }

  /**
   * ⛔ **Seed from an `account/rateLimits/read` response** — the half of the contract's own sentence
   * that had no implementation (201 §2). Answers with the lines worth showing, usually none.
   *
   * ⚠️ **The baseline goes UNDERNEATH what has already been observed**, never over it. This is
   * called without blocking the session start, so a rolling frame can and does arrive first; that
   * frame is NEWER, and a baseline that overwrote it would resurrect the state the app just left.
   *
   * ⛔ **Only the primary bucket speaks from a baseline.** The others are held — so a later rolling
   * frame naming one merges into a real snapshot instead of starting from nothing — but a warning
   * about a metered limit this session has not touched is 074's noise. A rolling frame for a
   * non-primary bucket DOES speak: the provider pushed it because this session is metering on it.
   */
  seed(response: unknown, now: number = Date.now(), askedAt: number = now): string[] {
    const top = readField(response, 'rateLimits')
    const primary = readString(top, 'limitId')
    if (primary !== '') this.primaryLimitId = primary
    const allowed = readField(response, 'ordinaryUsageAllowed')
    if (allowed === true) {
      // ⚑ A rolling wall on the main limit seen after this read was ASKED is the newer word.
      this.ordinaryUsageAllowed = this.mainWallSeenAt > askedAt ? null : true
    } else if (allowed === false) {
      this.ordinaryUsageAllowed = false
    }
    // ⛔ A read with no boolean leaves a held word as it was — `false` holds until a read says `true`.
    const seeds = new Map<string, Record<string, unknown>>()
    const byId = readField(response, 'rateLimitsByLimitId')
    if (isRecord(byId)) {
      for (const [key, value] of Object.entries(byId)) if (isRecord(value)) seeds.set(key, value)
    }
    // A server that filled only the backward-compatible view still gives us one bucket.
    if (isRecord(top) && !seeds.has(primary || UNNAMED_BUCKET)) {
      seeds.set(primary || UNNAMED_BUCKET, top)
    }
    for (const [key, snapshot] of seeds) {
      if (!this.buckets.has(key) && this.buckets.size >= MAX_TRACKED_BUCKETS) continue
      const bucket = this.buckets.get(key) ?? { snapshot: {}, said: null }
      // ⚠️ The FIRST read goes under what is held — rolling frames that overtook it are newer. A
      // LATER read (the turn-start re-read) was asked after them, so it goes on top: a fresher
      // percentage or reset must not lose to the one it replaces.
      bucket.snapshot = this.seeded
        ? mergeSparse(bucket.snapshot, snapshot)
        : mergeSparse(snapshot, bucket.snapshot)
      this.buckets.set(key, bucket)
    }
    this.seeded = true
    this.dropExpired(now)
    const key = this.mainKey()
    const bucket = key === null ? undefined : this.buckets.get(key)
    if (key === null || bucket === undefined) return []
    const line = this.speak(key, bucket)
    return line === null ? [] : [line]
  }

  /**
   * Take one `rateLimits` payload; answer with the line to show, or `null` for "nothing new".
   *
   * `now` is milliseconds and injectable so the expiry above is testable without waiting for a
   * window to roll — production passes nothing.
   */
  observe(incoming: unknown, now: number = Date.now()): string | null {
    if (!isRecord(incoming)) {
      this.lastObserved = null
      return null
    }
    this.dropExpired(now)
    const key = this.keyFor(incoming)
    this.lastObserved = { key, frame: incoming }
    // Over the cap: no memory is better than the wrong memory. Judged alone, exactly as this did
    // before 188 — which never downgraded a wall it could see, only one it had been told about.
    if (key === null) {
      const line = rateLimitPressure(incoming)
      if (line === null) {
        this.overflowSaid = null
        return null
      }
      if (line === this.overflowSaid) return null
      this.overflowSaid = line
      return line
    }
    const bucket = this.buckets.get(key) ?? { snapshot: {}, said: null }
    bucket.snapshot = mergeSparse(bucket.snapshot, incoming)
    this.buckets.set(key, bucket)
    // A wall on the main limit, reported after the read, is the newer word — over a `true` only; a
    // `false` it agrees with stands.
    if (this.isMain(key) && readString(incoming, 'rateLimitReachedType') !== '') {
      this.mainWallSeenAt = now
      if (this.ordinaryUsageAllowed === true) this.ordinaryUsageAllowed = null
    }
    return this.speak(key, bucket)
  }

  /** The line this bucket has to show right now, deduped against the last one it showed. */
  private speak(key: string, bucket: RateLimitBucket): string | null {
    const line = this.isMain(key)
      ? mainLimitPressure(bucket.snapshot, this.qualifies(key), this.ordinaryUsageAllowed)
      : rateLimitPressure(bucket.snapshot, this.qualifies(key))
    // ⛔ 201 §4 — quiet clears the memory of what was said. Anything else deduplicates a returning
    // wall against a wall that had ended.
    if (line === null) {
      bucket.said = null
      return null
    }
    if (line === bucket.said) return null
    bucket.said = line
    return line
  }

  /**
   * Whether this bucket's sentence must name itself.
   *
   * ⚑ **Only when naming it distinguishes something.** One bucket, or the one the provider calls the
   * main one, speaks in the sentence 177 shipped and §3 pins. A second metered limit — real on this
   * machine — names itself, because two unqualified sentences about different buckets are the defect
   * this dispatch is named for arriving from the other end.
   */
  private qualifies(key: string): boolean {
    return this.buckets.size > 1 && key !== this.primaryLimitId
  }

  /** The bucket `ordinaryUsageAllowed` is about: the one the provider calls the main one. */
  private isMain(key: string): boolean {
    return key === this.mainKey()
  }

  /** The main bucket's key — the provider's default, or failing that the only bucket there is. */
  private mainKey(): string | null {
    if (this.primaryLimitId !== null) return this.primaryLimitId
    return this.buckets.size === 1 ? ([...this.buckets.keys()][0] ?? null) : null
  }

  /**
   * Which bucket a frame is about, or `null` when we are over the cap and must not guess.
   *
   * ⚠️ **A frame that names no bucket is the case with a real trade-off.** Measured, every rolling
   * frame in a live capture carried its `limitId` — which is not "always", and the contract says
   * nullable metadata may be unavailable in a rolling update. Filing an unnamed frame under its own
   * key would be strict and would reintroduce 192 H1's own harm: a sparse `{primary:{usedPercent:92}}`
   * in an empty bucket says *"approaching"* while a wall stands in the real one. So it is attributed
   * to the default the provider itself named, and failing that to the only bucket there is — both
   * unambiguous — and only an ambiguous frame gets a bucket of its own.
   */
  private keyFor(incoming: Record<string, unknown>): string | null {
    const named = readString(incoming, 'limitId')
    if (named !== '') return this.buckets.has(named) ? named : this.room(named)
    if (this.primaryLimitId !== null && this.buckets.has(this.primaryLimitId)) {
      return this.primaryLimitId
    }
    if (this.buckets.size === 1) return [...this.buckets.keys()][0] ?? null
    return this.buckets.has(UNNAMED_BUCKET) ? UNNAMED_BUCKET : this.room(UNNAMED_BUCKET)
  }

  /** A new bucket key, or `null` when this session is already holding as many as it will. */
  private room(key: string): string | null {
    return this.buckets.size < MAX_TRACKED_BUCKETS ? key : null
  }

  /**
   * Forget every bucket whose windows have all reset.
   *
   * ⚠️ **It forgets what was SAID as well as what was held.** A wall that lifts and returns is news
   * the second time; keeping the sentence would dedup it against a limit that had ended.
   */
  private dropExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      // ⛔ Not the main limit while the provider says usage is not allowed: a reset time passing is
      // exactly the inference its contract forbids.
      if (this.ordinaryUsageAllowed === false && this.isMain(key)) continue
      if (snapshotExpired(bucket.snapshot, now)) this.buckets.delete(key)
    }
  }
}

/**
 * {@link rateLimitPressure} for the MAIN limit, with the provider's `ordinaryUsageAllowed` deciding
 * the wall whenever it said anything — see {@link RateLimitWatch}'s field of the same name.
 */
function mainLimitPressure(
  snapshot: Record<string, unknown>,
  qualify: boolean,
  ordinaryUsageAllowed: boolean | null,
): string | null {
  if (ordinaryUsageAllowed === null) return rateLimitPressure(snapshot, qualify)
  if (ordinaryUsageAllowed === false) {
    // ⛔ One sentence, with NO reset time: a reset time here would let the person's queue end the
    // wall by it (`foldProviderLimits`), which is the inference the field forbids. ⚑ Spelled with
    // the queue's own `is rate-limited`, so it reads as `stopped` — the provider's marker when it
    // gave one, the field's meaning when it did not.
    const reached = readString(snapshot, 'rateLimitReachedType') || 'included usage not allowed'
    const named = readString(snapshot, 'limitName') || readString(snapshot, 'limitId')
    const where = qualify && named ? ` on the ${named} limit` : ''
    return `codex is rate-limited (${reached})${where} — turns may stall until codex says usage is allowed again`
  }
  // Allowed: no rate-limit wall, whatever the snapshot's marker says; an approach still speaks, and
  // so does a spend control, which is not what this field answers.
  const withoutWall = { ...snapshot, rateLimitReachedType: null }
  return rateLimitPressure(withoutWall, qualify)
}

/**
 * True once every window this snapshot holds says its own reset has already happened.
 *
 * ⛔ **A window with no usable `resetsAt` blocks expiry rather than being skipped** (201 §5). The
 * old form filtered the unknowns out and then asked whether the rest had passed, so a snapshot
 * holding one past window beside one that had never reported a reset was dropped — the whole wall
 * with it — on the strength of a window it had decided not to count. An unknown reset is unknown; it
 * is not past. A snapshot holding no window at all cannot expire, which is 188's rule unchanged.
 */
function snapshotExpired(snapshot: Record<string, unknown>, now: number): boolean {
  const windows = [readField(snapshot, 'primary'), readField(snapshot, 'secondary')].filter(
    (window) => isRecord(window),
  )
  if (windows.length === 0) return false
  const resets = windows.map(windowResetsAt)
  if (resets.some((at) => at === 0)) return false
  return resets.every((at) => at * 1000 <= now)
}

/**
 * Merge a sparse update into what is held, at EVERY level (201 §3, from 192 H1).
 *
 * ⛔ **The old merge was one level deep**, so a rolling frame's fresh `primary` replaced the held one
 * whole. `RateLimitWindow` is `{usedPercent, windowDurationMins: number|null, resetsAt: number|null}`
 * — two of its three fields are exactly the *"nullable account metadata"* the contract says a rolling
 * update may omit — so a frame reporting only that the percentage moved took the window's length and
 * its reset with it, and the sentence lost the *"; resets …"* a person would act on.
 *
 * ⚠️ **Arrays replace.** No field of `RateLimitSnapshot` is one today; if one appears, merging index
 * by index would be inventing a shape the provider never described.
 */
function mergeSparse(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  // ⛔ **The BASE is copied too, and `{ ...base }` was not enough.** {@link seed} calls this with the
  // provider's own response as the base, so a shallow spread left the retained snapshot holding
  // `primary`, `secondary` and `credits` BY REFERENCE into a payload the raw history also carries.
  // Nothing mutates it today, which is exactly what makes the aliasing the kind that survives.
  const merged = copyRecord(base)
  for (const [key, value] of Object.entries(incoming)) {
    // ⛔ 165's rule: an absent field is a VALUE, and here the value is "not reported in this frame".
    if (value === null || value === undefined) continue
    const held = merged[key]
    merged[key] =
      isMergeable(held) && isMergeable(value) ? mergeSparse(held, value) : structuredCopy(value)
  }
  return merged
}

/** A plain object — the only thing {@link mergeSparse} recurses into. */
function isMergeable(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value)
}

/**
 * A defensive copy of anything the provider handed us before it is retained.
 *
 * ⚠️ The watch holds these for the life of a session, and the payload it is given is the same object
 * the raw history carries. Retaining it by reference would tie the two together; a copy is cheap at
 * this size and is what makes "held" mean held.
 */
function structuredCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structuredCopy)
  return isMergeable(value) ? copyRecord(value) : value
}

/** {@link structuredCopy} for a value already known to be a record — and the base of a merge. */
function copyRecord(value: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) copy[key] = structuredCopy(inner)
  return copy
}

/** ⚑ The fuller of a snapshot's two windows — the one that stopped the turn (188 §2). */
function fullestWindow(snapshot: unknown): { window: unknown; used: number } | undefined {
  return [readField(snapshot, 'primary'), readField(snapshot, 'secondary')]
    .map((window) => ({ window, used: readNumber(window, 'usedPercent') ?? -1 }))
    .sort((a, b) => b.used - a.used)[0]
}

/** A window's `resetsAt` in epoch SECONDS, or `0` when it is absent or unusable. */
function windowResetsAt(window: unknown): number {
  const at = readNumber(window, 'resetsAt')
  return at !== undefined && at > 0 ? at : 0
}

/** One metered bucket's held snapshot, and the bucket the provider calls its main one, if known. */
export interface UsageBucket {
  readonly snapshot: unknown
  readonly mainLimitId: string | null
}

/**
 * ⚑ **How full each window of one metered bucket is** — a `provider_usage`, or `null` when the
 * snapshot holds no window. ⚑ Named as the warning lines name them ({@link windowName}): *a 7-day
 * window*, or the slot (`primary`, `secondary`) when the provider did not say its length — and
 * with the bucket's own name when it is not the main one. `usedPercent` is already a percentage;
 * `resetsAt` is in seconds, so ms is ×1000.
 */
export function rateLimitUsage(bucket: UsageBucket | null): RuntimeEvent | null {
  if (bucket === null || !isRecord(bucket.snapshot)) return null
  const { snapshot, mainLimitId } = bucket
  // ⚑ The name a window is kept under must not move between frames, so it is said from what the
  // frame and the provider say, never from how many buckets are held: the provider's own name for
  // a metered model (`limitName`, which its main bucket does not carry), else the bucket's id when
  // the provider named another bucket its main one.
  const id = readString(snapshot, 'limitId')
  const named =
    readString(snapshot, 'limitName') ||
    (mainLimitId !== null && id !== '' && id !== mainLimitId ? id : '')
  const readings = (['primary', 'secondary'] as const).flatMap((slot) => {
    const window = readField(snapshot, slot)
    if (!isRecord(window)) return []
    const said = windowName(window)
    const name = said === 'this window' ? `its ${slot} window` : said
    const used = readNumber(window, 'usedPercent')
    const resets = windowResetsAt(window)
    // ⚑ A window the bucket gives no number for is no reading.
    if ((used === undefined || used < 0) && resets === 0) return []
    return [
      {
        window: (named ? `${name} (${named})` : name).slice(0, 120),
        usedPercent: used !== undefined && used >= 0 ? used : null,
        resetsAt: resets > 0 ? resets * 1000 : null,
      },
    ]
  })
  return readings.length === 0 ? null : { type: 'provider_usage', readings }
}

/**
 * How to say a `windowDurationMins` out loud — *"a 7-day window"*, *"a 5-hour window"*.
 *
 * The field is nullable, and a window whose length the provider did not report is described as
 * exactly that rather than given a made-up duration.
 */
function windowName(window: unknown): string {
  const mins = readNumber(window, 'windowDurationMins')
  if (mins === undefined || mins <= 0) return 'this window'
  if (mins % 1440 === 0) return `a ${mins / 1440}-day window`
  if (mins % 60 === 0) return `a ${mins / 60}-hour window`
  return `a ${Math.round(mins)}-minute window`
}

/**
 * The line for a model the provider swapped out from under the request (177 §2).
 *
 * Both model names are carried because "which model answered" is the whole fact, and the reason is
 * carried verbatim: it is a generated enum with one member today, and paraphrasing it would age
 * badly the moment a second one appears. A payload missing a name degrades to what it does have
 * rather than asserting a swap it cannot describe.
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
 * What a safety-buffering pause says out loud (188 §2, from 182 M5).
 *
 * ⚠️ **The provider's own `reasons` strings, quoted rather than translated.** They are the only
 * account of why this turn is being held, and 086 is against inventing a friendlier one; a payload
 * that carries none simply says less. ⚑ Bounded at three, because `reasons` is an unbounded array
 * and one notification may not become an unbounded transcript line.
 *
 * ⚑ **`fasterModel` is named when the provider offers one**, because the one thing a person waiting
 * can act on is knowing there is a quicker way through — and it is the provider's suggestion, not
 * ours. Nothing here selects it: the app has never changed a model without being asked.
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

/** Every generated notification method that classification must account for (064/065). */
type ChatterMethod = Exclude<ServerNotification['method'], FirstClassMethod | WarningMethod>

/**
 * Methods the CURRENT protocol no longer declares but an older app-server may still send. They are
 * kept out of the generated-union switch (a `case` for one would not compile) and matched first, so
 * legacy tolerance never weakens the exhaustiveness guarantee below.
 */
const LEGACY_METHOD_CATEGORIES = new Map<string, UnknownCategory>([
  ['contextCompacted', 'lifecycle'], // superseded by the generated `thread/compacted`
])

/**
 * Compile-time exhaustiveness over the generated notification methods (064, fixing 060 P2) —
 * mirrors {@link assertItemExhaustive}. Regenerating the protocol with a new method is now a
 * **compile error** here, forcing a deliberate classification; previously the classifier was a
 * plain string switch that silently drifted, which is how the current `thread/compacted` ended up
 * rendering as a prominent `unrecognized` card. At RUNTIME this is reached only by a method outside
 * the generated union — genuinely unknown, and correctly loud.
 */
function assertNotificationExhaustive(method: never): UnknownCategory {
  void method
  return 'unrecognized'
}

/**
 * Neutral category for a notification we recognize by NAME but deliberately don't map to a content
 * event (049). These are the high-volume streams — reasoning and plan deltas especially — that
 * flooded the UI as `unknown` cards. Classifying them keeps the payload (a later chat UI can render
 * reasoning richly) while letting the UI quiet them now. Anything not in the generated union is
 * genuinely `unrecognized` and stays loud.
 */
function notificationCategory(method: string): UnknownCategory {
  // A `Map`, not a record (068, fixing 066 F3): an object lookup reads INHERITED members, so a
  // provider method named `toString` / `constructor` / `hasOwnProperty` returned an
  // `Object.prototype` function as the category — a value `runtimeEventSchema` rejects, i.e. a
  // malformed method could produce a schema-invalid event. A Map has no prototype chain to walk,
  // so such a name simply misses and classifies as `unrecognized` (loud), as it should.
  const legacy = LEGACY_METHOD_CATEGORIES.get(method)
  if (legacy) return legacy
  // The cast lives HERE, at the boundary, exactly as `itemCategory` does it — never inside the
  // switch's `default`. A cast in there (`assertX(method as never)`) silently defeats the whole
  // guard: the parameter must genuinely be the union so TypeScript can narrow it to `never`.
  return generatedNotificationCategory(method as ChatterMethod)
}

function generatedNotificationCategory(method: ChatterMethod): UnknownCategory {
  switch (method) {
    // The model thinking out loud. The two SUMMARY streams left this classifier in 027 — they are
    // first-class `thinking` now — and their absence here is load-bearing rather than an omission.
    // Taking either one out of `FirstClassMethod` puts it back in `ChatterMethod`, this switch stops
    // being exhaustive over that union, and the build fails on `assertNotificationExhaustive`
    // (verified). Dead `case` arms left here would have satisfied the compiler instead, and quietly
    // demoting reasoning back to chatter is precisely what the pattern exists to prevent.
    case 'item/reasoning/textDelta':
      return 'reasoning'
    // Plan text as it is written/revised. `turn/plan/updated` left this classifier in 028 the same
    // way the reasoning summaries left it in 027 — it is a first-class `plan_update` now, and its
    // ABSENCE here is load-bearing rather than an oversight (a dead `case` would still compile).
    // `item/plan/delta` stays: it is marked EXPERIMENTAL in the protocol, which explicitly warns
    // that concatenated deltas need not match the finished plan, and it never fired in capture.
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
    // Session / thread / account / model housekeeping.
    //
    // ⚠️ **`thread/compacted` and `thread/tokenUsage/updated` LEFT this list in 087**, and their
    // absence is load-bearing in exactly the way 027's and 028's was: they are first-class events
    // now, and a dead `case` left behind here would still satisfy the exhaustiveness check while
    // quietly demoting the context meter's only two Codex inputs back to chatter.
    //
    // ⚠️ **`account/rateLimits/updated` and `model/rerouted` LEFT it in 177**, for the same reason
    // and with the same hazard. The rate-limit one is CONTENT-GATED rather than promoted outright,
    // so its routine heartbeat still ends up as `lifecycle` — but it is stated at the gate now, and
    // a `case` here would take the throttled frame with it.
    // ⚑ **`model/verification` deliberately STAYS**, and the difference is the state each claims.
    // `ModelVerification` is `trustedAccessForCyber` — the provider saying this turn was granted
    // access, which changes no fact the user chose. A reroute changes WHICH MODEL ANSWERED.
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
      return 'lifecycle'
    default:
      return assertNotificationExhaustive(method)
  }
}

/**
 * A notification this file RECOGNIZES by name but whose payload it could not read — surfaced loud
 * (007 P2-8: wrapped, never re-parsed), because a first-class method arriving malformed is a fact
 * about the provider worth seeing, not chatter to file away.
 */
function unrecognized(method: string, params: unknown): RuntimeEvent {
  return wrapUnknown('codex', { method, params }, 'unrecognized', method)
}

/**
 * Codex's plan-step status → the neutral one (028). Exhaustive over the generated
 * `TurnPlanStepStatus`, mirroring {@link assertStatusExhaustive}: a protocol bump that adds a state
 * is a **compile error** here rather than a step quietly rendered as `pending`.
 *
 * `null` means "not one of ours", and the caller drops the entire plan on it — see the fail-loud
 * rule at the `turn/plan/updated` case.
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
 * Compile-time exhaustiveness over `TurnStatus` — a new status is a type error here, forcing a
 * deliberate mapping (mirrors {@link assertItemExhaustive}). At RUNTIME this is reached only by a
 * value outside the generated union, which we must never assume succeeded.
 */
function assertStatusExhaustive(status: never): TurnOutcome {
  return {
    outcome: 'failed',
    message: `turn completed with an unrecognized status: ${JSON.stringify(status)}`,
  }
}

/**
 * ⚑ **F074 — Codex refused this turn for its usage limit**: `turn/completed` failed with
 * `TurnError.codexErrorInfo: "usageLimitExceeded"` — the typed half, never the message's English.
 */
export function codexTurnHitItsUsageLimit(params: unknown): boolean {
  const turn = readField(params, 'turn')
  return (
    readString(turn, 'status') === 'failed' &&
    readField(readField(turn, 'error'), 'codexErrorInfo') === 'usageLimitExceeded'
  )
}

/**
 * Whether Codex's `error` notification carries `usageLimitExceeded`. What that means depends on
 * the credential, which only the handle knows: a ChatGPT plan's usage limit, or an API key's
 * account out of quota.
 */
export function codexErrorIsAUsageLimit(params: unknown): boolean {
  return readField(readField(params, 'error'), 'codexErrorInfo') === 'usageLimitExceeded'
}

/**
 * ⚑ **F076 — Codex refused the credential this turn ran on**: `turn/completed` failed with
 * `TurnError.codexErrorInfo: "unauthorized"` — the typed half, never the message's English. ⛔ A
 * usage limit is `usageLimitExceeded`, another member, and is never read as this.
 */
export function codexTurnFailedOnItsCredential(params: unknown): boolean {
  const turn = readField(params, 'turn')
  return readString(turn, 'status') === 'failed' && isCodexUnauthorized(readField(turn, 'error'))
}

/**
 * The terminal outcome a `turn/completed` reports (its `turn.status`), **fail-closed** (055,
 * fixing 044 P2 #5).
 *
 * Everything that was not `failed`/`interrupted` used to be reported as `completed` — including
 * the type-valid **`inProgress`** and any future status. A turn the provider never said succeeded
 * was shown to the user as a success. Now the mapping is exhaustive over the generated union and
 * anything that is not an affirmative terminal state fails closed:
 *  - `inProgress` on a `turn/completed` is a contradiction (the notification says the turn ended,
 *    the payload says it is still running) — we surface it rather than pick the happy reading;
 *  - an unknown runtime value likewise reports `failed`, never a silent success.
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
      return { outcome: 'failed', message: `turn failed: ${turnErrorText(turn)}` }
    case 'inProgress':
      return {
        outcome: 'failed',
        message: 'turn/completed reported status `inProgress` — the turn did not report success',
      }
    default:
      return assertStatusExhaustive(status)
  }
}

/** Same inherited-read hazard as {@link LEGACY_METHOD_CATEGORIES} — a Map, so an item `type` of
 *  `toString` cannot yield an `Object.prototype` function as the tool NAME (068, F3). */
const TOOL_ITEM_NAMES = new Map<string, string>([
  ['commandExecution', 'shell'],
  ['fileChange', 'apply_patch'],
  ['mcpToolCall', 'mcp'],
  ['webSearch', 'web_search'],
  ['dynamicToolCall', 'tool'],
  ['collabAgentToolCall', 'collab'],
])

/**
 * 🔴 **The name of the tool that was actually called** (327) — `mcp__<server>__<tool>`, not `mcp`.
 *
 * ⛔ **This is the PROVIDER's own qualified name, not a shape borrowed from Claude.** Read out of a
 * real 0.146.0 child's first Responses request, the app-server declares the fixture's tool as
 *
 * ```json
 * "mcp__brobot_316_wire__echo_probe": { "name": "echo_probe", "namespace": "mcp__brobot_316_wire" }
 * ```
 *
 * and its own `exec` instructions tell the model *"Tool names are exposed as normalized JavaScript
 * identifiers, for example `await tools.mcp__ologs__get_profile(...)`"*. So the double-underscore
 * form is what Codex calls this tool when it talks to the model. ⚑ **That it is byte-identical in
 * shape to the name Claude puts on the same gesture is the point of `327` §2.4** — one vocabulary
 * for one thing, arrived at by measuring both providers rather than by picking a favourite.
 *
 * ⚠️ **Both halves, or neither.** `server` and `tool` are non-null in the generated `ThreadItem`, so
 * a missing one is a malformed item; `mcp__<tool>` would read as a server called `<tool>`, which is
 * a claim about where the call went rather than a gap in one. A malformed item keeps exactly the
 * `mcp` it had before this dispatch, and its arguments still ride on the summary.
 */
function toolItemName(type: string, item: Record<string, unknown>): string {
  // 🔴 **`327`'s defect, on the item type `348` introduced** (348). A `dynamicToolCall` used to take
  // the constant `'tool'` from the Map below, so all five of this app's own tools — spawn, message,
  // end, list, status — would have appeared in a Codex transcript as five rows saying `tool`.
  //
  // ⛔ **This is Codex's OWN spelling, read off the wire, exactly as the `mcp__` branch below is.**
  // A namespaced dynamic tool is declared to the model as `<namespace>__<tool>` under a `## brobot`
  // heading — `probe:codex-dynamic-tools`, arm A, from the child's own `exec` instructions:
  //
  // ```ts
  // declare const tools: { brobot__spawn_agent(args: { … }): Promise<unknown>; };
  // ```
  //
  // ⚠️ **It is deliberately NOT `mcp__brobot__spawn_agent`, which is what Claude calls the same
  // gesture.** `327` §2.4's rule is one vocabulary for one thing, arrived at *by measuring both
  // providers rather than by picking a favourite* — and the thing measured there was each
  // provider's own qualified name. Codex does not call this MCP, and prefixing it as though it did
  // would be a claim about where the call went.
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
    // ⛔ **Bounded, because this field stopped being a constant** (327, found reviewing this
    // dispatch's own diff). Every name this Map has ever produced was a literal written here;
    // `server` and `tool` are strings a third-party MCP server chose, `toolCallSchema.name` carries
    // no `.max()`, and the event is cloned across IPC and written to the ledger twice. The plain
    // {@link truncate} and not {@link boundedSummary}: a name is an identifier, so an over-long one
    // is a broken server rather than a payload with a remainder worth stating.
    if (server && tool) return truncate(`mcp__${server}__${tool}`)
  }
  return TOOL_ITEM_NAMES.get(type) ?? 'tool'
}

/**
 * Whether an item `type` is one of the provider's TOOL items — the same judgement
 * {@link itemCategory} already makes, exported so a caller counting a child's tool calls does not
 * grow a second list that could disagree with this one (226).
 */
export function isCodexToolItem(type: string): boolean {
  return itemCategory(type as ThreadItem['type']) === 'tool'
}

/**
 * Compile-time exhaustiveness: a new (unhandled) `ThreadItem['type']` makes this a type error,
 * forcing a deliberate classification decision rather than silently becoming chatter (049).
 */
function assertItemExhaustive(type: never): UnknownCategory {
  void type // reachable at runtime only for an unrecognized `type` string → genuinely unknown
  return 'unrecognized'
}

/**
 * Coverage category for every `ThreadItem` kind (007 P2-2; classified in 049). The switch is
 * exhaustive over the generated `ThreadItem['type']` union — a new/unhandled branch is a
 * **compile error**, never a silent gap. `tool`/`message` kinds map to real events; every other
 * kind has no dedicated event but is CLASSIFIED into a neutral {@link UnknownCategory} so the UI
 * can render it quietly while keeping genuinely-novel messages loud. At runtime an unrecognized
 * `type` string falls through to `unrecognized`.
 */
function itemCategory(
  type: ThreadItem['type'],
): 'message' | 'tool' | 'subAgent' | 'image' | 'compaction' | UnknownCategory {
  switch (type) {
    case 'agentMessage':
      return 'message'
    // An agent Codex dispatched (033). First-class since the wire proved it fires; its ABSENCE from
    // the `activity` list below is load-bearing exactly as `turn/plan/updated`'s was in 028.
    case 'subAgentActivity':
      return 'subAgent'
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'webSearch':
    case 'collabAgentToolCall':
      return 'tool'
    // --- no dedicated event, but recognized: classified, never dropped (raw is carried) ---
    case 'reasoning':
      return 'reasoning'
    // The plan DOCUMENT (057). Reaches a real `plan_update{body}` in {@link itemToEvents}, so this
    // classification only still decides where a MALFORMED one is filed — and it stays 'plan' so
    // `item/plan/delta`, which is chatter under the same name, keeps landing beside it.
    case 'plan':
      return 'plan'
    // Our own input reflected back. `functionCallOutput` is the output of a function call the
    // CLIENT supplied with `turn/start`'s `toolOutput`, which this app never sends.
    case 'userMessage':
    case 'hookPrompt':
    case 'functionCallOutput':
      return 'echo'
    // The picture the model made (067). First-class because the provider writes it to a real file
    // and names the file on the wire, so the image never has to travel as a payload at all.
    case 'imageGeneration':
      return 'image'
    // ⚠️ **`imageView` deliberately stays chatter.** It is an image the agent LOOKED at, and its
    // `path` is a `LegacyAppPathString` pointing anywhere the agent can read — the workspace, the
    // repo, /tmp. It has never been observed on the wire: zero occurrences across every rollout on
    // this machine. (Until `726` · R92 a second reason stood: `generated-image.ts` refused a path
    // outside the provider's images directory, and R92 removed that check.) If it is ever wanted,
    // it needs its own argument, not this one's.
    case 'imageView':
      return 'activity'
    // Context was dropped (087). First-class since the wire proved it is the path that runs: four
    // real `contextCompaction` items on this machine against zero `thread/compacted` notifications.
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
 * 🔴 **`agentMessage.memoryCitation` → the neutral `memory_recall` event** (319, friction log F5).
 *
 * ## ⛔ How this field went unread for three dispatches
 *
 * 316 was sent to find the wire trace of a memory call. It enumerated item TYPES across fifteen
 * config arms — raw events on, `direct_only_tool_namespaces` set, code mode off — looking for a tool
 * item, found none, and concluded the act was *"invisible, permanently"*. ⚑ **The trace was a FIELD
 * on the item that search had already found and discarded.** A filter that counts kinds cannot see a
 * property, and the conclusion it produced then justified not looking again. 318 re-measured with a
 * control and the field was populated, structured and stripped out of `text`.
 *
 * ## ⚠️ What is being read here, and what it is NOT
 *
 * The model appends an `<oai-mem-citation>` block as the last content of its reply; the app-server
 * parses it into `{entries, threadIds}`, removes it from `text` and publishes both on the item. So
 * this is **the model's own statement about what it used**, structured by the provider — not an
 * observation of a read. `memory-recall.ts` holds the rules that follow, and `009`'s is the one that
 * decides the wording downstream: a surface must not say we saw something we were only told about.
 *
 * ## ⛔ Malformed is "no citation", never an error, and never a partial invention
 *
 * ⚠️ **This field is not in a contract this app controls.** The vendored v2 protocol declares
 * `MemoryCitation {entries, threadIds}` with `MemoryCitationEntry {path, lineStart, lineEnd, note}`,
 * all required — but a shape that arrives from a future pin, or from an app-server that parsed a
 * malformed reply, must degrade rather than shout. So:
 *
 *  - anything that is not a record — **including `null`, which is the provider's real answer for
 *    *"no memory was consulted"*** — is no event at all;
 *  - an entry with no usable `path` is dropped and COUNTED, because a path is the answer to *"which
 *    memory?"* and an entry without one has nothing left to say;
 *  - a range whose two numbers are not both usable is dropped as a pair, and the entry keeps its
 *    path and its note (`074`: never print a measurement nobody made);
 *  - ⛔ **and a citation from which nothing at all survives emits NOTHING, rather than a row saying
 *    only *"the agent used memory"***. 319 §1.1: a row that throws away the file, the range and the
 *    note has thrown away the part that made it worth showing. A shape change therefore costs this
 *    channel its rows and costs the conversation nothing else — which is the failure mode chosen on
 *    purpose over an `unknown` row on every assistant message a future pin ever sends.
 */
function codexMemoryRecall(citation: unknown): RuntimeEvent | null {
  if (!isRecord(citation)) return null
  const sent = Array.isArray(citation['entries']) ? (citation['entries'] as unknown[]) : []
  const entries: MemoryRecallEntry[] = sent.map((raw) => {
    const lineStart = readNumber(raw, 'lineStart')
    const lineEnd = readNumber(raw, 'lineEnd')
    // ⚠️ **Both, integral, and in order — or neither.** `readNumber` only refuses a non-finite
    // value, so a fractional line, a negative one, or an end BEFORE the start would all reach a
    // surface as a printable range. `234-3` is not a shortened fact, it is a wrong one.
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
  // ⛔ Nothing survived — see the last clause of the note above. Silence, not a bare claim.
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
  // Malformed item (not a record, or no string `type`) → surfaced LOUDLY, not dropped.
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
    // 🔴 **The citation this function used to read past** (319). See {@link codexMemoryRecall} for
    // what the field is and why 316 could not find it.
    //
    // ⛔ **AFTER the message, and the position is a ruling rather than an ordering accident.** The
    // block is appended by the model as the VERY LAST content of its reply (the provider's own
    // instruction), so a row under the answer is where the agent itself put it — and it is the only
    // position that is STABLE. The fold finalizes a streamed assistant block in place, so an event
    // emitted first would land above the answer when nothing streamed and below it when something
    // did: one payload, two layouts, decided by a delta channel the reader cannot see.
    const recall = codexMemoryRecall(readField(item, 'memoryCitation'))
    // ⚑ 0.160.0 · an ASYNC message's questions, carried for a surface to draw as choices — see
    // {@link asyncQuestionsOf}. Nothing waits on them: Codex raised no request.
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

  // Reasoning is first-class since 027. The item itself carries no usable text — captured live,
  // `summary`/`content` are empty on the item even when the summary stream is on — so what it
  // contributes is the FACT that reasoning is happening (and, on completion, that it stopped).
  // `redacted` says the text was withheld rather than absent; the deltas above supply the words
  // when the server was asked for them.
  if (category === 'reasoning') {
    return phase === 'started'
      ? [
          { type: 'thinking', phase: 'delta', redacted: true },
          { type: 'activity', phase: 'thinking' },
        ]
      : [{ type: 'thinking', phase: 'complete' }]
  }

  // Context was dropped (087).
  //
  // ⚠️ **The boundary row is `completed` only, and that is the whole of the dedup story.** Codex
  // opens this item and then closes it, so both phases arrive carrying the SAME id — observed as four
  // events for two compactions on this machine. Emitting the row on both would draw two boundary
  // rows for one compaction and make the meter's tally say 2. The `compactionId` is carried anyway so
  // a consumer folding a ledger written by an older build still has an identity to collapse on.
  //
  // ⚑ **717 · the `started` phase says a compaction is UNDER WAY** (`713` F-3): measured, the item
  // opens as the compaction starts — `item/started` came 140 ms before `item/completed`, with Codex's
  // summary request between them (`probe:codex-command-as-typed`, arm `compact-person`). So it raises
  // the live `compacting` pill Claude raises from its `status: compacting`, and draws no row: an
  // activity is a statement about the present — replaced by the next phase, cleared by the turn, and
  // ended by the `completed` phase's row below (the folds' rule; `events.ts` states it).
  //
  // The item is `{type, id}` and nothing else — no `before`, no `after`, no trigger — so the event
  // carries no magnitudes. That is the case the optional fields exist for.
  if (category === 'compaction') {
    if (phase === 'started') return [{ type: 'activity', phase: 'compacting' }]
    const id = readString(item, 'id')
    return [{ type: 'compaction', ...(id ? { compactionId: id } : {}), source: type }]
  }

  // An agent Codex dispatched (033). See {@link subAgentBirth} for why only ONE of the two phases
  // produces an event.
  if (category === 'subAgent') {
    if (phase !== 'started') return []
    const event = subAgentBirth(item)
    return event ? [event] : [wrapUnknown('codex', item, 'unrecognized', type)]
  }

  // The plan DOCUMENT — Codex's, measured, and NOT the same object as the checklist above (057).
  //
  // 030 shipped "Codex has no plan mode"; 044 found `collaborationMode` in the vendored types; 057
  // asked the running 0.146.0 server and watched it answer. One plan-mode turn, `--verbose flag`
  // prompt, isolated `CODEX_HOME`:
  //
  //   235 × item/plan/delta  →  item/completed {type:'plan', id, text: '# Add verbose CLI output…'}
  //
  // 1,049 characters of markdown, headed Summary / Implementation / Test Plan / Assumptions. That
  // is a plan document by any reading, so it becomes `plan_update.body` — the SAME field Claude's
  // `ExitPlanMode.input.plan` lands in (030/056). The two providers reach it through completely
  // different machinery and the UI is not told which one it got, which is the whole point of 039.
  //
  // ⚠️ **`steps: []` here does NOT mean "no checklist" — it is completed upstream.** The neutral
  // contract is that every `plan_update` states the COMPLETE checklist (028), so an event carrying
  // an empty list erases an open one. This function is pure and sees one notification at a time, so
  // it cannot state a list it never saw; `ClaudeRuntime` has the same problem and solves it in the
  // adapter, and `CodexSessionHandle.restatePlan` is where this one is solved. Emitting the document
  // with the steps left empty and fixing it up there keeps this layer a translation of one frame.
  //
  // The two plans do appear to be disjoint on this provider — the server's own injected plan-mode
  // instructions say *"if you try to use `update_plan` in Plan mode, it will return an error"*, and
  // `turn/plan/updated` fired zero times across the measured plan turn and its default-mode control.
  // That is two turns and a sentence, which is a reason to expect the erase never fires, not a
  // reason to leave it possible.
  //
  // The `started` phase is skipped rather than classified: its `text` is `""` on the wire (measured
  // — the item is opened before a single delta lands), and an empty document announces a plan that
  // is not there yet. A `completed` plan with no text at all is malformed and stays loud.
  if (category === 'plan') {
    if (phase !== 'completed') return []
    const body = readString(item, 'text').trim()
    return body
      ? [{ type: 'plan_update', steps: [], body }]
      : [wrapUnknown('codex', item, 'unrecognized', type)]
  }

  // The picture the model made (067).
  //
  // ⚠️ **The feature is which fields are NOT read.** `ImageGenerationItem` is
  // `{ id, status, revisedPrompt, result, savedPath? }`, and `result` is the whole PNG as base64 —
  // 2.9 MB in the measured case, 45× the ceiling on unknown payloads. Until now the item went to
  // `wrapUnknown`, which serialized all of it just to discover it was too big and then replaced the
  // lot with a marker; the path was in there, and went out with the bytes. Four `readString` calls
  // and the base64 is simply never touched: no copy, no ceiling, no marker, and a path to a file
  // that is already on disk. Nothing about 052's bound had to move.
  //
  // ⚠️ **`completed` only.** The `started` item exists before the image does — no `savedPath`, no
  // file — so emitting on it would produce an image event that can never resolve, and then a second
  // one that can. Same rule as `plan` above, same reason.
  if (category === 'image') {
    if (phase !== 'completed') return []
    const id = readString(item, 'id')
    // ⚠️ **The malformed exit drops `result` FIRST, and it is not a special case for its own sake**
    // (067 review, HIGH). Handing the whole item to `wrapUnknown` would have made the paragraph
    // above false on this path: `boundRaw` would serialize the 2.9 MB, find it oversized, and
    // replace the lot with a marker — the exact behaviour 067 removed, reappearing on the one path
    // nobody looks at. And the marker is the WORSE outcome here: what makes a malformed image item
    // interesting is the missing `id`, not the base64, and dropping the base64 is what lets every
    // other field survive verbatim under the ceiling instead of being erased with it. Described,
    // never truncated — the same rule `boundRaw` follows one level up.
    if (!id) return [wrapUnknown('codex', withoutImageBytes(item), 'unrecognized', type)]
    // ⛔ **A generation that failed made no image** (0.160.0's `ImageGenerationItem.failure`, today
    // only `usageLimitExceeded`). Drawn as an image it would read as *"its file is no longer where it
    // was saved"* — a lost file instead of a limit. It is said as what it is, without stopping the turn.
    const failure = readField(item, 'failure')
    if (isRecord(failure)) {
      return [{ type: 'error', message: imageFailureMessage(failure), fatal: false }]
    }
    const savedPath = readString(item, 'savedPath')
    // ⚠️ **Bounded, like every other provider string that becomes a summary line.** `revisedPrompt`
    // was 745 characters in the measured case, but nothing in the protocol caps it, and this event
    // is written to the ledger and cloned across IPC for the life of the session — the shape of
    // problem 052 spent a task on. `truncate` is the SAME helper every tool summary already uses,
    // and its 200 is right for what this is used for: a caption and an `alt`. The viewer shows the
    // whole of what we kept, which is what we kept.
    const prompt = truncate(readString(item, 'revisedPrompt').trim())
    return [
      {
        type: 'image',
        imageId: id,
        // Unresolved and unchecked HERE, on purpose: this function is pure and has no home to
        // check against. `CodexRuntime` replaces it with a real one or removes it before the event
        // is emitted — see {@link CodexSessionHandle.resolveImage} there.
        ...(savedPath ? { path: savedPath } : {}),
        ...(prompt ? { prompt } : {}),
      },
    ]
  }

  // Kinds with no dedicated event carry their full payload as a CLASSIFIED `unknown{raw}`.
  if (category !== 'tool') return [wrapUnknown('codex', item, category, type)]

  // A known tool kind missing its `id` is malformed → surfaced.
  const id = readString(item, 'id')
  if (!id) return [wrapUnknown('codex', item, 'unrecognized', type)]
  const name = toolItemName(type, item)
  const summary = itemSummary(type, item)
  const backgroundId = commandProcessId(type, item)
  if (phase === 'started')
    return [{ type: 'tool_call', id, name, summary, ...(backgroundId ? { backgroundId } : {}) }]
  // Affirmative-only (062): the reason travels with the result so a fail-closed card explains
  // itself instead of just looking failed.
  const outcome = toolOutcome(type, item)
  // ⚑ **What came BACK, for the one kind that sends it** (327) — every other kind repeats the call's
  // own summary here, which is right for a `commandExecution` (the command is the row) and wrong for
  // an MCP call, where the whole question is what the server answered. ⛔ **And this is Claude's rule,
  // not a new one**: `claude/normalize.ts` builds its `tool_result.summary` from
  // `summarizeToolResult(block.content)` — the OUTPUT — and has since 001.
  const settled = resultSummary(type, item, summary)
  // ⚠️ **Joined rather than interpolated, because `settled` can be EMPTY here.** ⛔ The first draft
  // of this comment said the empty came from {@link argumentsSummary} — it does not, and `M22`
  // surviving its own table is what said so: that summary rides the CALL row, which never reaches
  // this line. The reachable empty is a provider string that is entirely WHITESPACE — `mcpResultText`
  // returns it, the truthiness test above passes it, and {@link oneLine} trims it to nothing. Written
  // as `${settled} — ${note}` that row opens with a dangling em dash. Every other kind reaches here
  // non-empty, so this changes nothing for them.
  const spoken = [settled, outcome.note].filter(Boolean).join(' — ')
  return [
    {
      type: 'tool_result',
      id,
      summary: spoken,
      ok: outcome.ok,
      ...mcpDuration(type, item),
      ...(backgroundId ? { backgroundId } : {}),
    },
  ]
}

/**
 * ⚑ **How long the tool call itself took, as the PROVIDER measured it** (327 §2.1).
 *
 * ⛔ **It is not the duration the row already had.** `ToolEntry.took` subtracts two `RuntimeHost`
 * delivery stamps (`deliver` → `at = this.now()`), so it measures the call *plus* JSON-RPC framing,
 * the host's event pump and whatever else the machine was doing. The gap is visible in the one
 * capture that has both: the `item/started` → `item/completed` envelopes were 7 ms apart while the
 * item's own `durationMs` was **4**. This is the tighter number and the only one that survives a
 * loaded machine, which is `321`'s whole subject.
 *
 * ⚠️ **`!== undefined`, and a measured `0` is why.** The failing arm of `327`'s capture reported
 * `durationMs: 0` — a real, instantaneous failure — and `...(ms ? { ms } : {})` would have dropped
 * exactly that row's duration while keeping every slower one. {@link readNumber} already refuses a
 * non-finite value; a negative one is refused here rather than in the schema, so a nonsense duration
 * costs its own field instead of failing validation for the whole event.
 *
 * ⛔ **`mcpToolCall` only, deliberately.** `commandExecution` and `dynamicToolCall` declare a
 * `durationMs` with the same meaning and are NOT read here: that would change the duration shown on
 * every shell row in the app, which is not what this dispatch was asked for. See the response doc —
 * it is named there as a follow-on, with this measurement as its evidence.
 */
function mcpDuration(type: string, item: Record<string, unknown>): { durationMs?: number } {
  if (type !== 'mcpToolCall') return {}
  const ms = readNumber(item, 'durationMs')
  return ms === undefined || ms < 0 ? {} : { durationMs: ms }
}

/**
 * **The PTY process behind a Codex command, which this app used to throw away** (247 §2).
 *
 * ⛔ `ThreadItem`'s `commandExecution` arm carries `processId: string | null` — *"Identifier for the
 * underlying PTY process (when available)"* — and until now {@link itemSummary} read `command` and
 * nothing else, so the one string that can act on a running command died at this line. `245` §1.4
 * found it and named it: BroBot *"discards the command item's `processId`"*.
 *
 * ## ⚑ Why this exact string, and not a pid
 *
 * It is the JOIN KEY, and the generated protocol says so at the pin. `ThreadBackgroundTerminal` is
 * `{itemId, processId, command, cwd, osPid, cpuPercent, rssKb}` and
 * `ThreadBackgroundTerminalsTerminateParams` is `{threadId, processId}` — so the registry Codex
 * would list and the control that would stop one row both key on this, and the card is where the
 * user is looking when they want it stopped. Carrying it is what makes that dispatch possible
 * without re-deriving a binding from a list nobody has asked for yet.
 *
 * ## ⚠️ What it does NOT say
 *
 * ⛔ **Presence is not "this is running in the background."** Codex attaches a `processId` to every
 * PTY-backed command including ordinary foreground ones, so reading it as a running marker would
 * produce the false-settled card's mirror image — a row that claims live work where the command
 * finished inside the turn. `247` sets `backgrounded` from a level the provider states; Codex states
 * no such level to this app today, and that absence is reported honestly in the response rather than
 * papered over with this field.
 *
 * ⚑ **Codex only.** A `mcpToolCall` or a `webSearch` has no process, and a `processId` on one would
 * be a field nothing could act on.
 */
function commandProcessId(type: string, item: Record<string, unknown>): string {
  return type === 'commandExecution' ? readString(item, 'processId') : ''
}

/**
 * ⛔ **What a tool ROW says it is doing** — one branch per tool kind, and since `457` there is no
 * kind without one.
 *
 * ## 🔴 The defect this closes, measured off a live app-server
 *
 * ⚠️ **`dynamicToolCall` had no branch and fell through to `return type`**, so both of this app's
 * own rows summarised as the literal word `dynamicToolCall`. `405` recorded the pair from a real
 * Codex worker — `tool_call name: brobot__spawn_agent summary: dynamicToolCall` — and `348`
 * rescued only the NAME. ⛔ **Every tool BroBot has is a dynamic tool on Codex**, so on the
 * provider a fresh install actually runs, the answer to every question a person asks rendered as
 * one meaningless word. `probe:codex-tool-answer` reproduces it from the wire in under two
 * seconds.
 *
 * ⚑ **`arguments` is the right field and the probe says so**: it is present on BOTH `item/started`
 * and `item/completed`, while `contentItems` is `null` until the call completes. So the CALL row
 * reads the arguments — which is what Claude's row shows for the same gesture — and
 * {@link dynamicResultSummary} reads what came back.
 *
 * ## ⛔ The fall-through no longer prints a discriminator
 *
 * ⚠️ **Returning `type` is what produced the defect**, and it would produce it again for the next
 * tool kind somebody classifies in {@link itemCategory} and forgets here. An unrecognized state
 * must SAY it is unrecognized rather than look like content — *an unenumerated state counts as
 * success* is the rule, and a protocol discriminator sitting where a summary goes is exactly that
 * failure wearing a plausible word.
 */
function itemSummary(type: string, item: Record<string, unknown>): string {
  if (type === 'commandExecution') return truncate(readString(item, 'command') || 'shell command')
  if (type === 'fileChange') return 'file change'
  if (type === 'webSearch') return truncate(readString(item, 'query') || 'web search')
  if (type === 'collabAgentToolCall') return collabSummary(item)
  // ⚑ **One helper for both, because both kinds declare the same `arguments` field** — a second
  // copy is `169` §1's drift, and these two rows have to keep agreeing about what a call looks
  // like.
  if (type === 'mcpToolCall' || type === 'dynamicToolCall') return argumentsSummary(item)
  return UNSUMMARISED_TOOL_KIND
}

/**
 * ⛔ **What a tool row says when this file has no branch for its kind** (457).
 *
 * ⚠️ **It names no kind, and that is deliberate.** The string a reader would most like here is the
 * item type — which is precisely the defect `405` recorded and `457` fixed, and putting it back
 * behind a label would put a protocol discriminator on a person's row again. ⚑ The kind is already
 * on the row: `toolItemName` names the tool, and `unknown{raw}` carries the whole item for
 * anything this file does not classify as a tool at all.
 */
export const UNSUMMARISED_TOOL_KIND = 'a tool call this app cannot describe yet'

/**
 * 🔴 **What a dynamic tool ANSWERED, which is the half a person is reading for** (457).
 *
 * ## ⛔ The FIRST text item, and the boundary is structural rather than parsed
 *
 * ⚠️ **Codex has no `structuredContent`,** so `answerCodexToolCall` sends the prose and the JSON
 * payload as two content items — measured to be byte-identical at the model to the single joined
 * string it used to send, because the isolate joins them with a newline before the model sees
 * them. ⚑ **So the first item is the half written for a person and the second is the half written
 * for a machine**, and reading index 0 needs no knowledge of what this app's own sentences look
 * like. ⛔ A rule that stripped a trailing JSON line instead would be parsing our own words back
 * out of a provider's transport — the derivation `405` refuses, and one that empties in silence
 * the day either side is reworded.
 *
 * ⚠️ **Non-empty, not merely first.** A tool that answers only a payload has an empty prose half,
 * and a row saying nothing about an answer that exists is worse than a row saying the payload.
 *
 * ## ⚑ Image and audio get a word, from a table a fourth arm would break
 *
 * `DynamicToolCallOutputContentItem` is a closed vocabulary of three. ⛔ A `?? ''` on a member
 * nobody thought about is the fall-through this whole function exists to remove, so the words live
 * in a `Record` keyed on the union: a fourth arm fails to compile until somebody decides what a
 * row says about it.
 *
 * ⚠️ **`'done'` is Claude's own word** for a result that carried no text (`summarizeToolResult`),
 * reused rather than invented — and it is what `mcpResultSummary` already falls back to one
 * function over. It is reached when `contentItems` is `null`, which the probe measured is exactly
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
    // ⛔ **`Object.hasOwn`, never `in`** — `068` F3's hazard, and this dispatch reintroduced it
    // before its own review caught it. `'toString' in NON_TEXT_ANSWER` is TRUE through the
    // prototype chain and the lookup answers `Object.prototype.toString`, so a wire item declaring
    // `{type: 'toString'}` would put `function toString() { [native code] }` on a person's row.
    // ⚑ `TOOL_ITEM_NAMES` is a `Map` for exactly this reason; a `Record` is kept here because it
    // is what makes a fourth arm a compile error, and `hasOwn` buys the same safety.
    //
    // ⚠️ **REMEMBERED, not returned** (found by this dispatch's review). A picture followed by a
    // sentence is an answer with words in it, and returning here would have shown `an image`
    // about a row that said something — the first item winning over the first READABLE one.
    if (!notWords && typeof kind === 'string' && Object.hasOwn(NON_TEXT_ANSWER, kind)) {
      notWords =
        NON_TEXT_ANSWER[kind as Exclude<DynamicToolCallOutputContentItem['type'], 'inputText'>]
    }
  }
  return notWords || 'done'
}

/**
 * ⛔ **What a row says about an answer that is not words** — one cell per non-text arm of
 * `DynamicToolCallOutputContentItem`, so a fourth arm is a compile error rather than a silent
 * `''`.
 *
 * ⚠️ **It says what arrived, never a URL.** `imageUrl` and `audioUrl` are base64 `data:` URLs by
 * the provider's own description of `image()` and `audio()`, and a megabyte of base64 on a
 * one-line summary — written to the ledger and cloned across IPC for the life of the session — is
 * `052`'s problem arriving through a new door.
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
 * ⛔ **The cap on what an MCP row carries, and it SAYS SO when it bites** (327 §2.3).
 *
 * ⚠️ **A bare `…` is not enough here, and the measurement is why.** A real `big_probe` call came back
 * with a single 90 047-character text block; bounded the ordinary way the row would read
 * `BROBOT_327_MCP_BIG:…` and a reader could not tell 201 characters from ninety thousand. So the
 * remainder is STATED. `187 §2`'s rule is that a budget which bites says so on the row it bit, and
 * `316` measured the alternative shape this must not repeat: an `unknown.raw` payload over 64 KiB is
 * replaced *wholesale* by an erasure marker, which is the right answer for a verbatim payload and
 * the wrong one for a summary line.
 *
 * ⚑ **The bound itself is {@link truncate}'s, unchanged** — the same 200 every other tool summary in
 * both providers already uses. Only the sentence after the ellipsis is new, and it appears only when
 * something was actually dropped.
 *
 * ⚠️ **The count is of the string this line summarizes**, which for a provider message is the
 * whitespace-collapsed one {@link oneLine} produced — not the raw byte length of the item. Collapsing
 * drops no word, so the two differ only by runs of spacing; saying `200 of N` about a string other
 * than the one on the row would be the more confusing of the two answers.
 */
function boundedSummary(text: string): string {
  if (text.length <= SUMMARY_CAP) return text
  return `${truncate(text, SUMMARY_CAP)} (${SUMMARY_CAP} of ${text.length} characters)`
}

/**
 * ⚠️ **One line, because the row is one line.** `.tool-summary` is `white-space: nowrap` with an
 * ellipsis, and the provider's own failure text is deliberately multi-line — the measured timeout
 * read `tool call error: …\n\nCaused by:\n    timed out awaiting tools/call after 4s`. Left as sent,
 * five whitespace characters push the sentence that says WHAT failed towards the clip. Collapsing
 * runs of whitespace loses no word and is applied only to the two provider strings this file puts on
 * a single-line row.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * **What the model asked the server to do** (327) — the arguments, which is what Claude's row shows
 * for the same gesture (`summarizeToolInput`'s `JSON.stringify` fallback, same 200).
 *
 * ⚠️ **Empty when there is nothing to say**, rather than a fabricated word. `arguments` is a
 * `JsonValue` and a tool can legitimately take none; `'{}'` is what an empty OBJECT serializes to and
 * is kept, but an absent field becomes an empty summary and the row shows the qualified name alone.
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
 * ⛔ **Which reading a RESULT row shows, per tool kind** (457, generalising 327).
 *
 * ⚠️ **Two kinds send an answer back and the rest do not.** `mcpToolCall` carries `result`/`error`
 * and `dynamicToolCall` carries `contentItems`; for a `commandExecution` the command IS the row
 * and repeating the call summary is right. ⛔ **This used to be a ternary on one kind**, and the
 * second kind arriving is exactly the shape a ternary cannot grow into without somebody noticing
 * — `457` is that dispatch.
 *
 * ⚑ **Named rather than inlined so the choice is one expression a test can reason about**, and so
 * a third answering kind is one row here instead of a second nested conditional.
 */
function resultSummary(type: string, item: Record<string, unknown>, calledWith: string): string {
  if (type === 'mcpToolCall') return mcpResultSummary(item)
  if (type === 'dynamicToolCall') return dynamicResultSummary(item)
  return calledWith
}

/**
 * 🔴 **What came back — and on a failure, WHAT FAILED** (327 §2.2).
 *
 * ## ⛔ The two failure shapes are DISJOINT, and `327` measured both
 *
 * The dispatch was written expecting the reason to live on `error.message`. Against a real 0.146.0
 * child and a real stdio MCP server, it does — for exactly one of the two ways a call can fail:
 *
 * | how it failed | `status` | `error` | `result` | `durationMs` |
 * |---|---|---|---|---|
 * | the TOOL reported a failure (it threw) | `failed` | **`null`** | `content[0].text` = the thrown message | `0` |
 * | the TRANSPORT failed (`tool_timeout_sec`) | `failed` | **`{message: "tool call error: … timed out awaiting tools/call after 4s"}`** | **`null`** | `4002` |
 *
 * ⚑ **Exactly one of the two carries the reason, and which one depends on where the failure was.**
 * A row that read `error.message` alone would have said nothing at all about the thrown failure —
 * the commoner of the two — and one that read the result alone would have said nothing about the
 * timeout. So both are read, `error` first because a transport failure invalidates whatever partial
 * result may sit beside it.
 *
 * ⚠️ **`isError` is not on this wire.** The MCP SDK sets it on the tool result; the app-server's
 * generated `McpToolCallResult` is `{content, structuredContent, _meta}` and has no such field. It
 * appeared **zero** times across both captures — the app-server re-encodes it as `status: "failed"`,
 * which {@link toolOutcome} already reads. There is nothing to add for it and nothing being missed.
 *
 * ⛔ **A bare-string `error` is handled for the same reason {@link hasReportedError} handles one**
 * (068): the generated shape is a record, and a non-conformant server has already been the reason
 * that guard exists. Reading only `error.message` would let such a server's reason fall through to
 * `'done'` — the row saying a call succeeded quietly when it had failed loudly.
 */
function mcpResultSummary(item: Record<string, unknown>): string {
  const error = item['error']
  if (typeof error === 'string' && error) return boundedSummary(oneLine(error))
  const message = readString(error, 'message')
  if (message) return boundedSummary(oneLine(message))
  const result = readField(item, 'result')
  const text = mcpResultText(readField(result, 'content'))
  if (text) return boundedSummary(oneLine(text))
  // `structuredContent` second, because it is the machine's copy of an answer whose readable form is
  // the text blocks — but a server that sends only the structured half must still say something.
  const structured = readField(result, 'structuredContent')
  if (structured !== undefined && structured !== null) {
    try {
      const json = JSON.stringify(structured)
      if (json !== undefined) return boundedSummary(json)
    } catch {
      // Unserializable: fall through to the word below rather than guess at it.
    }
  }
  // Claude's own word for a result that carried no text (`summarizeToolResult`), not a new one.
  return 'done'
}

/**
 * 🔴 **The WHOLE of what a tool answered, in the order the receipt carried it** (462) — the bytes
 * `dynamicResultSummary` and {@link mcpResultSummary} each cut down to one 200-character line.
 *
 * ## ⛔ It reads the same array those two read, and it makes the same structural claim
 *
 * ⚑ **`457` put the prose and the payload in two content items so the boundary would be an ARRAY
 * INDEX**, and {@link dynamicResultSummary} takes index 0 for that reason. This takes all of them,
 * in order, and hands the ordering on untouched — so the half a person reads is `parts[0]` at the
 * far end too. ⛔ **Nothing here looks at the characters to decide what a part is**: a rule that
 * called a part *the payload* because it opens with `{` is the derivation `405` refuses.
 *
 * ## ⚠️ Two kinds, and the other item kinds are deliberately NOT here
 *
 * ⛔ **A `commandExecution` is not a tool answer and must not be held here.** What a command printed
 * already has a surface of its own — `300`'s tail, read through `SessionHandle.commandOutput` —
 * and a second hold of the same bytes is two accounts of one thing, which is the shape `command-
 * output.ts` §4 warns will end up disagreeing. ⚑ `fileChange` has the diff, `agentMessage` is the
 * transcript. **What these two kinds have that the others do not is a STRUCTURED half**, which is
 * the thing `457` found has no surface anywhere in this app.
 *
 * ## ⚑ Non-text items contribute NO part, and the row is where they are named
 *
 * ⚠️ `DynamicToolCallOutputContentItem` is text, image or audio, and an image's `imageUrl` is a
 * base64 `data:` URL by the provider's own description. ⛔ Holding one would put a megabyte of
 * base64 in memory for a panel that shows what a tool SAID — `052`'s problem through a new door,
 * and exactly what {@link NON_TEXT_ANSWER} exists to keep off the row. **The word for a picture is
 * on the row; the panel shows the words the answer carried, and an answer with none holds none.**
 *
 * `null` means *this item is not a tool answer this app holds* — a kind with no branch, or a call
 * with no result yet, which is what the probe measured `item/started` to be.
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
    // ⚠️ **LAST, and that is {@link mcpResultSummary}'s own ordering rather than a new one**: the
    // text blocks are the readable half and `structuredContent` is *"the machine's copy of an
    // answer whose readable form is the text blocks"*. ⛔ Serialised here rather than handed on as
    // an object, because what crosses to a surface is characters — see `tool-answer.ts`.
    // ⚠️ **`machineHalf` and not `structured`, and the rename is not a style choice.** `327 M25`
    // anchors on `const structured = readField(result, 'structuredContent')` in
    // {@link mcpResultSummary} ALONE, and a second identically spelled line in this file makes that
    // row unappliable — a verdict it earned, retired by a door that had nothing to do with it. ⛔ A
    // mutation table's anchor is a fact about the source, and a new door that collides with one is
    // the NEW door's to avoid. Found by this dispatch's own census, which is what it is for.
    const machineHalf = readField(result, 'structuredContent')
    if (machineHalf !== undefined && machineHalf !== null) {
      try {
        const encoded = JSON.stringify(machineHalf)
        if (encoded !== undefined) parts.push(encoded)
      } catch {
        // Unserializable: the text blocks above are still the answer, and inventing a word for what
        // could not be serialised would put this app's sentence where the tool's belongs.
      }
    }
    return parts
  }
  return null
}

/**
 * The readable half of an MCP result — `content[]`'s text blocks, joined.
 *
 * ⚑ **This is `claude/normalize.ts`'s `joinText`, and it is a COPY for the reason every other helper
 * in this file is one**: the two normalizers share no runtime module by design, so neither can drift
 * the other's parsing. The block shape is the same because MCP's `content` is the same shape Claude's
 * `tool_result.content` is.
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
 * The BIRTH of an agent Codex dispatched → the neutral `sub_agent` card (033).
 *
 * **Only `item/started` reaches here, and that is the whole of the "duplication" fix.** Every
 * sub-agent used to render twice, and 033 was dispatched believing the provider sent each event
 * twice. It does not: `item/started` and `item/completed` carry a BYTE-IDENTICAL item, with
 * `startedAtMs === completedAtMs` to the millisecond, because a `subAgentActivity` is an
 * instantaneous ANNOUNCEMENT rather than a thing with a duration. The old code fell into
 * {@link itemToEvents}' non-tool catch-all, which wraps a kind on both phases — so we emitted it
 * twice ourselves. Keying a dedupe on the item id would have hidden that; mapping the announcement
 * once, where it is announced, removes it. **`item/completed` for one of these does not mean the
 * sub-agent completed** — the child's ending arrives on its own thread, in `sub-agents.ts`.
 *
 * `agentThreadId` is the identity: it is the child's real thread id, so it correlates the birth here
 * with every `thread/status/changed` the child sends afterwards.
 *
 * `parentToolCallId` is the collab call that spawned it. No such tool row has EVER been rendered —
 * in four captured sessions only `wait` produced a `collabAgentToolCall` item, never `spawnAgent` —
 * so the card is top-level today, which 029's fold already handles as a first-class case. It is
 * carried anyway rather than dropped: the renderer adopts an orphan the moment a row with that id
 * appears, so "bind it only if there is a row" is enforced by the thing that can actually see the
 * rows instead of guessed at here.
 */
/**
 * One `skills/list` row read as a {@link ProviderCommand} (279).
 *
 * ⛔ **`interface.shortDescription` FIRST, and the live rows are why.** Measured against the bundled
 * binary, every one of the six carries both — and they are not the same sentence. `imagegen`'s
 * `shortDescription` is *"Generate or edit images for websites, games, and more"* (52 characters,
 * written for a person) while its `description` opens *"Generate or edit raster images when the task
 * benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites,
 * mockups…"* — a **trigger** written for the model, about when to reach for the skill. The palette
 * draws one line, so it draws the one written to be read, and falls back to the trigger when a skill
 * ships no interface at all.
 *
 * ⚠️ **`argumentHint` and `aliases` are deliberately absent, not forgotten.** The Codex protocol
 * declares neither on a skill: `SkillMetadata` carries `name`, `description`, `shortDescription`,
 * `interface`, `dependencies`, `path`, `scope` and `enabled`, and nothing that means *"and then
 * type this"*. Inventing either from the `defaultPrompt` would be putting words in the provider's
 * mouth on the one surface whose whole job is to report what it said.
 */
export function readCodexSkill(skill: unknown): ProviderCommand {
  const short = readString(readField(skill, 'interface'), 'shortDescription')
  const described = short || readString(skill, 'description')
  const path = readString(skill, 'path')
  const full = readString(skill, 'description')
  return {
    name: readString(skill, 'name'),
    ...(described ? { description: described } : {}),
    // ⚑ Its file, and the description the model is given, which `<skills_instructions>` sends whole.
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

export function subAgentBirth(item: Record<string, unknown>): RuntimeEvent | null {
  const agentId = readString(item, 'agentThreadId')
  // No identity, no card: correlation is the whole mechanism, and a card that can never be updated
  // or ended is worse than the classified `unknown` the caller falls back to.
  if (!agentId) return null
  const activity = subAgentActivity(readString(item, 'kind') as SubAgentActivityKind)
  if (!activity) return null
  const parentToolCallId = readString(item, 'id')
  const kind = agentName(readString(item, 'agentPath'))
  return {
    type: 'sub_agent',
    agentId,
    // 111 — a REAL thread id, with a rollout file of its own. The one difference from Claude's that
    // decides what a reader could do next, so it is stated rather than left to be inferred.
    idKind: 'thread',
    ...activity,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    ...(kind ? { kind } : {}),
  }
}

/**
 * What one phase of a sub-agent's life contributes to its card. No `summary` — and ⚠️ **226 changed
 * the reason from impossible to unspent.** This said *"Codex never sends the child's answer down
 * this connection"*; it does, in `turn.items` and in the child's own `agentMessage` deltas, both
 * measured. Forwarding them is refused rather than impossible: a child's words have to be owned by
 * the card that says who is speaking (128), and a Codex card has no body to own them yet.
 */
type SubAgentPhase = Pick<Extract<RuntimeEvent, { type: 'sub_agent' }>, 'phase' | 'outcome'>

/**
 * Codex's `SubAgentActivityKind` → the neutral phase, exhaustive over the generated union so a
 * protocol bump is a compile error rather than an activity silently read as a birth.
 *
 * Only `started` has ever fired. The others are mapped from what the names mean and nothing more:
 * `interacted` is the parent and child exchanging a message, which is progress and not an ending;
 * `interrupted` is an ending that is neither a success nor the sub-agent's fault, so it reports
 * itself rather than being rounded to `failed` or hidden behind "we were not told".
 */
function subAgentActivity(kind: SubAgentActivityKind): SubAgentPhase | null {
  switch (kind) {
    case 'started':
      return { phase: 'started' }
    case 'interacted':
      return { phase: 'progress' }
    case 'interrupted':
      return { phase: 'ended', outcome: 'interrupted' }
    // ⚑ No `outcome` (0.160.0): the name says the child is done, not how it went. Its own
    // `turn/completed` says that, as for an idle child (`CodexSubAgents`), and an outcome here could
    // land after a failed one and overwrite it.
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
 * `/root/workspace_mapper` → `workspace_mapper` — the name the model coined for this child.
 *
 * The leading `/root/` is the PRIMARY agent, present on every path and therefore carrying no
 * information; everything after it is kept exactly as sent, so a nested `/root/a/b` reads `a/b`
 * rather than losing which agent spawned it. A path shaped otherwise is shown whole rather than
 * trimmed by a rule that was never meant for it.
 */
function agentName(path: string): string {
  return path.startsWith('/root/') ? path.slice('/root/'.length) : path
}

/**
 * A `collab` row that says what it DID (033). It used to read `collab · wait`, or — worse, when a
 * prompt was present — the prompt with the operation nowhere on the row, so the one field that says
 * whether the agent spawned, messaged, waited for or CLOSED a sub-agent was the one field hidden.
 *
 * Who it concerns is stated as a COUNT, not as names. `receiverThreadIds` was `[]` and `agentsStates`
 * was `{}` in every `collabAgentToolCall` ever captured — the observed `wait` is a broadcast, which
 * "every agent" says exactly — so resolving ids to names would be machinery for a payload nobody
 * has seen. When the provider starts populating them, one function changes.
 */
function collabSummary(item: Record<string, unknown>): string {
  const tool = readString(item, 'tool')
  const receivers = readField(item, 'receiverThreadIds')
  const count = Array.isArray(receivers) ? receivers.length : 0
  // ⚠️ "every agent" only for `wait`, the one measured broadcast; for the other operations an empty
  // list says only that the provider did not name the agent.
  const who =
    count > 0
      ? `${count} agent${count === 1 ? '' : 's'}`
      : tool === 'wait'
        ? 'every agent'
        : 'an agent'
  // An unrecognized tool keeps its OWN name rather than degrading to the generic 'collab': the name
  // is the most informative thing we have about an operation we do not know. Only a missing one
  // falls all the way back.
  const operation = collabOperation(tool as CollabAgentTool, who) ?? tool ?? ''
  const head = operation || 'collab'
  const model = readString(item, 'model')
  const prompt = readString(item, 'prompt')
  const named = model ? `${head} · ${model}` : head
  return truncate(prompt ? `${named} — ${prompt}` : named)
}

/**
 * Codex's `CollabAgentTool` → a phrase, exhaustive over the generated union. `null` means "not one
 * of ours", and the caller shows the raw name instead of inventing a phrase for it.
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
 * Every status ANY tool item can report — the union of the generated per-type status unions
 * (062). Taking the union rather than five copied switches keeps one choke point while staying
 * exhaustive **per type**: if any one of these unions gains a member, the union grows and
 * {@link toolStatusOutcome}'s switch stops being exhaustive — a compile error, never a silent gap.
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
  /** Appended to the summary so a fail-closed result says WHY, rather than just looking failed. */
  note?: string
}

/**
 * Compile-time exhaustiveness over {@link ToolStatus} — mirrors `assertItemExhaustive` and 055's
 * `assertStatusExhaustive`. At RUNTIME this is reached only by a value outside the generated
 * union, which must never be read as a success the provider never claimed.
 */
function assertToolStatusExhaustive(status: never): ToolOutcome {
  return { ok: false, note: `unrecognized status ${JSON.stringify(status)}` }
}

/**
 * Map a tool item's status to its outcome, **affirmative-only** (062, fixing 060 P2 — the
 * un-generalized sibling of 055's turn-status fix).
 *
 * `itemOk` used to return `true` for everything except `failed`/`declined`, so an `item/completed`
 * carrying **`inProgress`** — a contradiction the generated unions permit — a **missing** status,
 * or a **future** status all rendered as a successful tool result. Only `completed` is success now;
 * everything else fails closed with a reason.
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
 * `webSearch` is the one tool kind whose generated shape declares **no status field at all**, so
 * its completion carries no success/failure channel to fail closed on — reporting it as failed
 * would be as untrue as the old blanket success. Its `item/completed` is therefore an affirmative
 * completion by protocol definition.
 *
 * This constant is the compile-time guard on that reasoning: if a future protocol bump gives
 * `WebSearchItem` a `status`, the type resolves to `never` and this assignment is a **compile
 * error**, forcing the kind into the exhaustive status mapping instead of silently keeping a
 * hard-coded success.
 */
const WEB_SEARCH_HAS_NO_STATUS: 'status' extends keyof WebSearchItem ? never : true = true

/**
 * The outcome for one completed tool item — affirmative-only, per tool kind (062).
 *
 * A **missing / non-string** status is malformed: it fails closed as a `tool_result` carrying the
 * reason rather than as an `unknown`, so the UI's tool card is still resolved (an unresolved card
 * would hang in the transcript forever) while never claiming a success.
 *
 * Two in-family contradictions are also refused, because "affirmative-only" means the item must
 * not *contradict* its own success: `dynamicToolCall.success === false` and a `mcpToolCall.error`
 * present alongside `completed`.
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
  // A contradiction is anything that is NOT an affirmative success — not just the two exact shapes
  // the first pass checked (068, fixing 066 F4). `success:'false'` (a STRING) and `error:'boom'` (a
  // string rather than a record) both slipped through and rendered as successful tool results.
  if (type === 'dynamicToolCall' && isNonAffirmativeSuccess(item['success'])) {
    return { ok: false, note: `completed but reported success:${JSON.stringify(item['success'])}` }
  }
  if (type === 'mcpToolCall' && hasReportedError(item['error'])) {
    return { ok: false, note: 'completed but carried an error' }
  }
  return outcome
}

/**
 * Whether a `success` field CONTRADICTS the completed status (068). The generated shape is
 * `boolean | null`, so `null`/absent means "not reported" and the status alone decides — reporting
 * those as failures would turn real successes into false negatives, the mirror of the bug being
 * fixed. Anything else PRESENT and not literally `true` is a contradiction: `false`, `'false'`,
 * `'true'` (a string is not an affirmation), `0`, `1`, `{}`, `[]`.
 */
function isNonAffirmativeSuccess(success: unknown): boolean {
  if (success === undefined || success === null) return false
  return success !== true
}

/**
 * Whether an `error` field is actually REPORTING an error (068). The generated shape is
 * `McpToolCallError | null`, but a non-conformant server may send a bare string — so any present,
 * non-empty value counts, not only a record. `null`/absent/`''` are "no error".
 */
function hasReportedError(error: unknown): boolean {
  if (error === undefined || error === null) return false
  if (typeof error === 'string') return error.length > 0
  return true
}

/**
 * The questions an `agentMessage` asked WITHOUT waiting — 0.160.0's `delivery: "async"` with
 * `questions: [{title, options}]`, which `request_user_input_async` emits — bounded by
 * {@link ASKED_QUESTION_LIMITS}. Empty for every other message, and for a malformed entry.
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

function turnErrorText(turn: unknown): string {
  const error = readField(turn, 'error')
  const message = readString(error, 'message') || 'unknown'
  // ⚑ 0.160.0's `TurnError.misalignment`: a block's own *"substantive localized explanation"*, the
  // provider's words, carried beside its message rather than dropped.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function readString(value: unknown, key: string): string {
  const field = readField(value, key)
  return typeof field === 'string' ? field : ''
}

/**
 * A finite number at `key`, or undefined (087) — the same helper `claude/normalize.ts` already has,
 * and it is a copy for the same reason every other one here is: these two files share no runtime
 * module by design, so neither can drift the other's parsing.
 *
 * ⚠️ **`Number.isFinite` is not decoration.** `modelContextWindow` is a denominator, and JSON is
 * perfectly happy to carry a value that is not a number; absence must stay absence rather than
 * becoming a zero the meter would divide by.
 */
function readNumber(value: unknown, key: string): number | undefined {
  const found = isRecord(value) ? value[key] : undefined
  return typeof found === 'number' && Number.isFinite(found) ? found : undefined
}

/**
 * Keep `max` characters and say so with an ellipsis — so a bounded string is `max + 1` long.
 *
 * ⛔ **Exported since 275, for the one caller that has to agree with it exactly.**
 * `MAX_BACKGROUND_TEXT` is **201** rather than 200 precisely because of the line below, and
 * `background-terminals.ts` bounds a provider `command` with the same helper rather than a second
 * copy of the same arithmetic — a rule spelled in two places is `169` §1's drift.
 */
export function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * The same item with its base64 image replaced by a description of it (067, from its review).
 *
 * For surfacing a MALFORMED `imageGeneration` as `unknown{raw}`. Everything about the item that
 * makes it surprising is kept; the one field that is merely enormous is described instead. Which is
 * what {@link boundRaw} would do to the whole object, less well: it would replace every field.
 */
function withoutImageBytes(item: Record<string, unknown>): Record<string, unknown> {
  const result = item['result']
  if (typeof result !== 'string') return item
  return { ...item, result: `<${result.length} chars of base64, not carried>` }
}
