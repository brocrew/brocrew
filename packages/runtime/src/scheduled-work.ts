/**
 * **Work the session has promised to do LATER** (253) — the provider-neutral vocabulary for it.
 *
 * Keep scheduled jobs as state after the creating tool call scrolls away. A `CronCreate` result can leave work waiting to fire for the rest of the session.
 *
 * ⚑ **`250` §1 measured where the fact actually lives, five live runs with a positive control, and
 * built nothing — as its dispatch instructed.** Its table is the whole basis for this file:
 *
 * | what | where | quality |
 * |---|---|---|
 * | ⛔ **the job exists** | `Stop` hook → `session_crons: [{ id, schedule, recurring, prompt }]` | ⚑ structured, on EVERY turn, before and after a fire |
 * | a fire happened | `UserPromptSubmit` hook → the cron's own prompt text, `source` **`null`** | ⚠️ correlatable, not labelled |
 * | a fire happened | stream → `command_lifecycle` | ⛔ undeclared in `sdk.d.ts`; **names no cron** |
 * | **the message stream** | — | ⛔ **NOTHING. The `tool_use` block is the only trace** |
 *
 * ## ⛔ This is the one fact in the app that does not arrive on the message stream
 *
 * Every other level BroBot publishes has an arm in a `normalize.ts`. This one has none, and that is
 * not an oversight to tidy up later: `session_crons` is a field on `StopHookInput`, delivered to an
 * in-process hook callback, and `250`'s control row proved the silence on the stream is the
 * provider's rather than the instrument's. So the producer lives in the adapter beside the hook that
 * receives it — see `claude/session-crons.ts`.
 *
 * ⚑ **`permission_request` is the precedent for an off-stream provider fact** — it arrives on the
 * `canUseTool` callback — so the shape is not new. What is new is that this one is a SET rather than
 * a question, which is why it needs a level's semantics and not a request broker's.
 *
 * ## ⚠️ How this differs from `background_work`, which it otherwise copies
 *
 * `247` publishes what is running NOW; this publishes what will run LATER. They are not two readings
 * of one fact and must never be merged: `250` measured a cron producing **no `task_*` frame at all**
 * — 0 of the five frames a backgrounded `Bash` produced in the same capture, one row later — and the
 * SDK's own `BackgroundTaskSummary.type` labels (`shell | subagent | monitor | workflow`) have no
 * scheduled member. A cron is not background work that has not started; it is a different kind of
 * thing with a different ending.
 *
 * ## ⚑ Level semantics, restated because they are the load-bearing part
 *
 * `session_crons` is a **LEVEL**: the whole set, stated at every turn end. So a
 * `scheduled_work` event's `jobs` REPLACES, never merges — the same rule `247` wrote into
 * `background_work.running` after the SDK told consumers to *"replace their set with each payload
 * rather than pairing edges, so a missed bookend cannot wedge a stale running indicator"*. `222` is
 * what a stale indicator costs.
 *
 * ⚠️ **Absent ≠ empty, and here the difference has teeth.** `jobs` absent is *"this frame did not
 * state the level"*; `jobs: []` is *"the provider says nothing is scheduled"*, which is the fact that
 * clears a registry. The level is stated **at turn end**, so a session that has never ended a turn
 * has never been told anything and BroBot publishes nothing at all for it.
 *
 * ## 🔴 Two things the live capture falsified, both of which the first draft got wrong
 *
 * 253 opened by copying `247`: empty the level at `system/init`, because a cron is *"session-only
 * (not written to disk, dies when Claude exits)"* in `CronCreate`'s own receipt. The probe
 * (`smoke/scheduled-work-probe.smoke.ts`) refuted it twice, and each failure ERASES a job that is
 * still scheduled rather than merely adding a redundant event:
 *
 *  1. ⛔ **Every scheduled FIRE re-emits `system/init` on the SAME stream.** One process, one
 *     `query()`, one `session_id` — `init` at 10 194 ms, and again at 54 805 ms and 114 037 ms as
 *     the cron woke the session twice.
 *     ⚠️ **`247` anticipated the SHAPE of this and measured it away, and the measurement no longer
 *     covers the case.** Its `init` arm empties `background_work.running` because the SDK calls an
 *     `init` the reset condition for a per-process level, and its own comment says the cost — *"a
 *     registry that reads empty for a moment on a wake-up `init`"* — did not arise, because on both
 *     rows it saw, the level had already said `[]` 15 ms and 42 ms earlier. ⛔ A cron fire is an
 *     `init` that is **not** a restart, so a session holding a detached command AND a cron would
 *     have its running-work registry cleared while the command runs. Reported rather than fixed:
 *     it is `247`/`248`'s event, and the fix is a ruling about what an `init` means.
 *  2. ⛔ **A RESUMED session still holds its crons.** A new CLI process resuming `ea1f67f9` reported
 *     the same job `e3826cc5` on a `Stop` at 4 336 ms — ⚑ *before its own first prompt at 4 526 ms*,
 *     so the schedule is restored by the resume itself and not by anything the new turn did. On one
 *     of the four runs the resumed session went further and FIRED the job. The receipt's *"dies
 *     when Claude exits"* does not mean what an app reading it would assume, and the replayed
 *     ledger the init emit existed to correct was already right.
 *
 * ⚑ **So the producer has exactly one input and no reasoned claims**: every level published is one
 * the provider stated on a `Stop` hook. That is a stronger property than the design it replaced, and
 * it is the whole reason the capture was worth running before the response was written.
 *
 * ## ⛔ Fires are NOT published, and the reason is three facts rather than a preference
 *
 * The dispatch said *"correlate it or do not"*. Not, and each of these alone would be enough:
 *
 *  1. **The only typed label is unset for us.** `UserPromptSubmitHookInput.source` has a
 *     `'schedule_wakeup'` member documented as *"scheduled-task fire (CronCreate/routine)"* — and the
 *     same doc says *"currently only set for Anthropic-internal sessions while the field is trialed;
 *     external payloads omit it"*. `250` measured `source=null` on the real fire.
 *  2. 🔴 **The prompt cannot be an identity key, because the provider's copy of it is LOSSY.**
 *     `SessionCronSummary.prompt` is documented *"capped at 1000 chars; clipped values append an
 *     in-string '… [+N chars]' marker"*. So for any job whose prompt is longer than that, the string
 *     in the level is **not** the string that will be submitted, and text equality is broken by
 *     construction — silently, and only for the long prompts nobody tests with.
 *  3. **A person can type it.** Even where the text does match, a human pasting their own cron's
 *     prompt into the composer would be reported as a scheduled fire. `074`'s rule is that the app
 *     may not say something the provider did not, and `240`'s is that an honest absence beats a
 *     confident wrong answer.
 *
 * ⚑ **And a disappearance is already carried without inventing anything.** A one-shot job that has
 * fired is simply gone from the next level, so the registry empties on its own. What that does NOT
 * distinguish is *fired* from *cancelled* — both are "no longer scheduled", and this event says only
 * that, because that is all the provider said.
 *
 * ⚑ **What the app adds, and on what ground: the scheduling calls themselves.** Each `CronCreate`,
 * `CronDelete` and `CronList` the provider runs is read at its tool hooks as it happens
 * (`claude/scheduling-calls.ts`), and the app's host states a level of its own from those receipts
 * and the provider's levels (its `source` names the app): a job is listed when it is made, and
 * leaves when its cancellation is confirmed, in the turn that did it. ⛔ The adapter still publishes
 * no fire, and nothing says which turn a job began: a one-shot whose minute came stays listed until
 * the provider's own level leaves it out.
 *
 * ## ⛔ There is no control, and that is a finding rather than a gap
 *
 * `247` gave the renderer a fact **and** a button (`Query.stopTask`). This gives a fact and nothing
 * else. ⛔ **Checked rather than assumed**: `Query` has 30 control methods at 0.3.281 (27 at 0.3.218) and not one
 * touches a scheduled task, and the word `cron` appears in the whole of `sdk.d.ts` only in
 * `SessionCronSummary`, the two hook inputs that carry it, `UserPromptSubmitHookInput.source`, a
 * rate-limit bucket key, and one interrupt-receipt caveat. Cancelling is `CronDelete`, a tool in the
 * MODEL's vocabulary rather than a host control, so the only cancel a person can reach today is
 * asking the agent to run it.
 *
 * ⚠️ **And closing the conversation is NOT a cancel**, which is worth saying because the provider's
 * own receipt reads as though it were. `CronCreate` says *"dies when Claude exits"*; the capture
 * shows a resumed session reporting the same job back. Ending a session stops it FIRING, and picking
 * the conversation up again brings it back.
 *
 * No `SessionHandle` member is added for any of this: a control with no implementation on either
 * adapter would be `235`'s *"live mechanism with no live input"* built on purpose.
 */

/**
 * One scheduled job, as the provider names it.
 *
 * ⚠️ **Only `id` is required, and the SDK declares all four.** `SessionCronSummary` types `schedule`,
 * `recurring` and `prompt` as present — every captured row carried all three — so absence here is a
 * defensive read of an unknown payload rather than an expected state, exactly as
 * `BackgroundWork` treats its own fields. A row that arrives with no `id` is dropped and
 * counted, because an id is the only thing that makes two payloads comparable.
 */
export interface ScheduledJob {
  /** The provider's own id for this job — Claude's `SessionCronSummary.id`. */
  readonly id: string
  /**
   * When it fires, in the provider's own words — Claude sends a cron expression (`"* * * * *"`).
   *
   * Preserve the provider's schedule string instead of rewording it into a neutral vocabulary. Only that provider can honor its cron expression, and Codex's schedule vocabulary cannot express every such interval.
   */
  readonly schedule?: string
  /** `false` for a one-shot whose expression encodes a single fire time; `true` for a repeater. */
  readonly recurring?: boolean
  /**
   * The prompt that will be submitted when it fires — ⚠️ **the provider's own, possibly CLIPPED
   * copy.**
   *
   * ⛔ **Never an identity key and never a correlation key.** The SDK caps it at 1000 characters and
   * appends an in-string `… [+N chars]` marker to whatever it shortened, so for a long job this
   * string is not the text that will arrive. It is here to be SHOWN — *"this is what it will ask"* —
   * and nothing downstream may compare it to anything.
   */
  readonly prompt?: string
  /**
   * The minute it will next run, epoch ms, where the app knows it — never stated by a provider:
   * only a level the app itself writes carries it, from what it recorded when the job was made.
   */
  readonly nominalAt?: number
  /**
   * Why the app does not start this job's conversation for it once the conversation is stopped,
   * where that is so — never stated by a provider: only a level the app itself writes carries it.
   * Absent, the app starts the conversation in time for the job. ⚠️ It says nothing of whether the
   * job exists or runs: a conversation that is open runs its own jobs.
   */
  readonly notStarted?: NotStartedBecause
}

/**
 * Why the app does not start a stopped conversation for one of its jobs:
 *  - `time-not-known` — the app has no record that tells it when the job runs;
 *  - `no-word-from-its-provider` — the app started the conversation for the job, and its provider
 *    has not listed the job since;
 *  - `no-word-since-a-reset` — its provider began a new conversation under it (a `/clear`, leaving
 *    plan mode), and has not listed the job since;
 *  - `history-not-read-in-full` — the part of its history the app reads holds too little to plan
 *    the job from, and the app will not start anything on what it cannot read.
 */
export const NOT_STARTED_BECAUSE = [
  'time-not-known',
  'no-word-from-its-provider',
  'no-word-since-a-reset',
  'history-not-read-in-full',
] as const
export type NotStartedBecause = (typeof NOT_STARTED_BECAUSE)[number]

/**
 * The most jobs one level payload will carry rows for.
 *
 * ⚑ Same rule as `MAX_BACKGROUND_WORK` and
 * `MAX_WORKFLOW_AGENTS`: a cap is never silent — `ScheduledWorkEvent`'s `dropped` says out
 * loud when it bit. 100 is far above anything a person or a turn can create; it exists so one
 * malformed payload cannot become a permanent row in every store downstream (`052`).
 */
export const MAX_SCHEDULED_JOBS = 100

/** The ceiling on a job's `id` or `schedule`, in characters. */
export const MAX_SCHEDULE_TEXT = 200

/**
 * The ceiling on a job's `prompt`, in characters.
 *
 * ⚠️ **1024 rather than the provider's own 1000, and the 24 is the point.** The SDK caps the prompt
 * at 1000 *and then appends* an `… [+N chars]` marker to the clipped value, so the string that
 * actually arrives is longer than the documented cap. That is precisely the shape of `247`'s
 * `MAX_BACKGROUND_TEXT` bug — a `.max(200)` schema against a producer that emits 201, which does not
 * trim a field but degrades the WHOLE event to `unknown` at `toWireEvent`. Here the bound admits the
 * worst case the SDK documents, and {@link clipScheduleText} guarantees the rest.
 */
export const MAX_SCHEDULE_PROMPT = 1024

/**
 * The provider's own scheduling tools, whose calls and results are kept as receipts: what was
 * created, cancelled or listed, and when, as the call happened rather than at the turn's end.
 */
export const SCHEDULING_TOOLS = ['CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'] as const
export type SchedulingTool = (typeof SCHEDULING_TOOLS)[number]

/**
 * Bound a provider string so the schema can never reject what the producer emits.
 *
 * ⛔ **Unlike `normalize.ts`'s `truncate`, this respects its own bound.** That helper keeps `max`
 * characters and *then* appends an ellipsis, so its output is `max + 1` — which is why
 * `MAX_BACKGROUND_TEXT` has to be 201 to describe a 200-character rule, and why getting that off by
 * one cost `247` a whole-event degradation. The invariant here is one a test can state directly:
 * `clipScheduleText(anything, n).length <= n`.
 */
export function clipScheduleText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
