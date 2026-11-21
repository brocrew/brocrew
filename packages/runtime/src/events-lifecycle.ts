import { z } from 'zod'
import { providerSchema, sessionStatusSchema } from '@brobot2/shared'
import { MAX_BACKGROUND_ID, MAX_BACKGROUND_WORK } from './background-work'
import { MAX_SCHEDULE_PROMPT, MAX_SCHEDULE_TEXT } from './scheduled-work'
import { sessionRefSchema } from './session-ref'
import { providerRefusalSchema } from './provider-refusal'

/**
 * Provider-session lifecycle. `ended` is RESERVED for the provider session
 * actually closing (Codex `thread/closed` / app-server exit; Claude adapter
 * close) — NOT for a turn finishing. Turn boundaries are the `turn` event +
 * `status: idle` (001 gap 1; load-bearing for Slice 3's two-signal landing).
 *   - Claude: `system/init` (session_id) → `started` | `resumed`.
 *   - Codex:  `thread/started` / `thread/resume` response → `started` | `resumed`.
 */
export const sessionEventSchema = z.object({
  type: z.literal('session'),
  state: z.enum(['started', 'resumed', 'ended']),
  ref: sessionRefSchema,
})

/**
 * The provider moved to a new conversation; resume must reopen {@link ref}, and the transcript
 * shows this seam where it happened, like compaction, rather than hiding it as lifecycle chatter.
 *
 * Claude reports resets on `/clear`, plan-mode exit and fresh-session flows. Although the SDK
 * names `new_conversation_id`, the resume probe (`probe:claude-resume-after-cd`) found no transcript
 * there: the following `system/init` names the resumable conversation and raises this event.
 *
 * This does not reopen the app's session: its row, ledger and ordinals continue unchanged.
 * A non-ended `session` event would incorrectly clear the transcript's terminal latch and satisfy
 * the adapter handshake. Only the provider conversation receiving subsequent turns changes.
 * Codex currently reports no equivalent signal; the contract describes the shared fact.
 */
export const conversationResetEventSchema = z.object({
  type: z.literal('conversation_reset'),
  /** The resumable provider conversation, backed by its transcript on disk. */
  ref: sessionRefSchema,
  /** Provider signal names, such as Claude's `conversation_reset + system/init`, cited by the row. */
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
export const turnEventSchema = z.object({
  type: z.literal('turn'),
  state: z.enum(['completed', 'failed', 'interrupted']),
  /** Codex `turnId` when available; correlation only. */
  turnId: z.string().optional(),
  /** The reason the provider reported for this failed turn, if one was observed. */
  providerFailure: z.object({ message: z.string(), code: z.string().optional() }).optional(),
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
export const providerTurnSchema = z.object({
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
 * The orthogonal session-status machine (reused from `@brobot2/shared`):
 * `idle | working | waiting_permission | ended | errored`. Derived by adapters
 * from init/status/callback/result/process lifecycle (001 §Q7).
 */
export const statusEventSchema = z.object({
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

/** Opaque display words and the existing transcript fold outcome, independent of session status. */
export const errorPresentationSchema = z.object({
  message: z.string(),
  level: z.enum(['warn', 'error']).optional(),
  terminal: z.boolean().optional(),
  repeat: z.enum(['each', 'same-message-once']).optional(),
})
export type ErrorPresentation = z.infer<typeof errorPresentationSchema>

/** A recoverable or fatal error. Cancellation is NOT fatal (001 §Q7). */
export const errorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  fatal: z.boolean(),
  /** Provider-supplied display words; the diagnostic remains in message. */
  presentation: errorPresentationSchema.optional(),
  /** Absent is the norm: most errors are just errors. See {@link errorCauseSchema}. */
  cause: errorCauseSchema.optional(),
  signIn: z
    .object({
      state: z.enum(['retrying', 'refused', 'stale']),
      message: z.string().optional(),
      captions: z
        .object({
          stopped: z.string(),
          ended: z.string(),
          recovered: z.string(),
          expired: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
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
export const providerLimitClearSchema = z.object({
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
export const providerUsageSchema = z.object({
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
export const unknownEventSchema = z.object({
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
