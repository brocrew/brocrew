import {
  MAX_SCHEDULED_JOBS,
  MAX_SCHEDULE_PROMPT,
  MAX_SCHEDULE_TEXT,
  clipScheduleText,
  type ScheduledJob,
} from '../scheduled-work'
import type { ScheduledWorkEvent } from '../events'

/**
 * **What this session has promised to do later, as the `Stop` hook states it** (253).
 *
 * ⛔ **A producer in this package that is not a normalizer** (the scheduling receipts are the other,
 * `scheduling-calls.ts`). `session_crons` is a field on
 * `StopHookInput` — an in-process hook callback — and `250` proved with a positive control that the
 * message stream carries nothing about a cron at all. So this class sits beside
 * `ClaudeSessionHandle`'s hook, not beside `normalizeMessage`, and reads an `unknown` payload
 * because the value crosses no schema on its way in.
 *
 * ## ⚑ Why it publishes on CHANGE and not on every payload
 *
 * The `Stop` hook fires at **every turn end**, and the level it carries is usually identical to the
 * last one. Publishing it each time would put one event per turn into a ledger that is persisted and
 * replayed (`session-record.ts`), forever, to say nothing new — `052`'s hazard by a slower route.
 * ⚠️ Suppressing an unchanged level costs a consumer nothing: REPLACE semantics mean the next real
 * change re-states the whole set, so a listener that missed one still converges. This is what the
 * provider itself does one event over — `background_tasks_changed` is named for the change, not the
 * poll.
 *
 * ⚑ **One instance per SESSION, so a reopened conversation restates its level once.** That is
 * deliberate rather than a leak in the gate: the fold's copy came from a replayed ledger and the new
 * process's first `Stop` is the first time anything has confirmed it. One event per reopen is a
 * bound a person controls; one per turn is not.
 *
 * ## ⛔ What a session that has never ended a turn reports — NOTHING, and that is the fix
 *
 * Nothing has been stated to us before the first `Stop`, so nothing is published: `jobs` absent,
 * which is *"we have not been told"*. ⚑ **Every level this class emits is therefore something the
 * provider actually SAID.** There is no reasoned claim in the event anywhere.
 *
 * 🔴 **253's first draft published `jobs: []` at `system/init` instead**, copying `247`'s registry
 * one event over, on the reasoning that `CronCreate`'s own receipt gives: *"session-only (not
 * written to disk, dies when Claude exits)"*. The live capture falsified it twice, and both failures
 * ERASE a job that is still scheduled:
 *
 *  1. **Every scheduled FIRE re-emits `system/init` on the SAME stream** — one process, one
 *     `query()`, one `session_id`: `init` at 10 194 ms, then 54 805 ms and 114 037 ms as the cron
 *     woke the session twice. An empty level there blanks a live job for the whole fired turn.
 *  2. **A RESUMED session still holds its crons** — a new CLI process resuming `ea1f67f9` reported
 *     the same `e3826cc5` on a `Stop` at 4 336 ms, before its own first prompt at 4 526 ms. The
 *     replayed ledger the emit existed to correct was already telling the truth, so the correction
 *     was the error.
 *
 * ⚠️ **Which leaves one honest gap, stated rather than papered over:** a job created DURING a turn is
 * invisible until that turn ends. The window is normally the tail of one turn — the model schedules,
 * then finishes its answer — but a turn that keeps working for ten minutes after scheduling leaves
 * the app silent for ten minutes. Nothing available closes it: no other hook in `HookEvent` carries
 * `session_crons` except `SubagentStop`, and `Query` has no cron control to poll. See the `253`
 * response for what the live capture says about `SubagentStop`.
 */
export class SessionCrons {
  /**
   * The last level PUBLISHED, as an order-insensitive fingerprint — `null` before anything was.
   *
   * ⚠️ **Fingerprinted canonically, published in the provider's order.** The level is a SET, so a
   * payload that merely reorders the same jobs is not a change and must not produce an event; but the
   * order the provider chose is information (it lists them as it holds them), so the emitted array
   * keeps it.
   *
   * ⛔ **Sorting for the fingerprint is not enough on its own, and that was the defect** (265 §5):
   * the CAP has to choose canonically too, or above a hundred rows the sort is over a membership
   * arrival order already decided. See {@link selectJobs}.
   */
  private published: string | null = null

  /**
   * Read one `session_crons` payload and return the event to publish, or `undefined` if the level
   * has not changed since the last one.
   *
   * ⚠️ **`unknown` in, and every field checked.** This value arrives through a hook callback, so no
   * schema stands between the provider and this function. A payload that is not an array is
   * treated as *"this frame did not state the level"* and produces nothing — never as an empty set,
   * which would clear a registry on the strength of a shape we failed to read.
   */
  observe(raw: unknown, source: string): ScheduledWorkEvent | undefined {
    if (!Array.isArray(raw)) return undefined
    const selected = selectJobs(raw)
    // Already ascending by {@link canonicalKey} — see {@link selectJobs}. The fingerprint is
    // therefore a function of the CONTENT of the chosen set and of nothing else about the payload.
    const fingerprint = JSON.stringify([selected.chosen.map((row) => row.key), selected.dropped])
    if (fingerprint === this.published) return undefined
    this.published = fingerprint
    // ⚠️ **Emitted in the provider's own order**, which is the half of the promise that survives:
    // the provider lists them as it holds them and that is information. Selection is canonical;
    // presentation is not.
    const jobs = [...selected.chosen].sort((a, b) => a.at - b.at).map((row) => row.job)
    return {
      type: 'scheduled_work',
      jobs,
      ...(selected.dropped > 0 ? { dropped: selected.dropped } : {}),
      source,
    }
  }
}

/** One row that survived {@link readJob}, with what selection and presentation each need. */
interface ChosenJob {
  /** Where the provider put it, so the emitted array can keep that order. */
  readonly at: number
  /** The total content order the cap selects by — see {@link canonicalKey}. */
  readonly key: string
  readonly job: ScheduledJob
}

/**
 * 🔴 **The cap chooses WHICH rows survive, so it may not choose by arrival order** (265 §5, from
 * 259 lens A rank 2).
 *
 * ## ⛔ What was wrong
 *
 * {@link SessionCrons} promises an order-insensitive set: *"a payload that merely reorders the same
 * jobs is not a change and must not produce an event"*. The old loop took the FIRST
 * {@link MAX_SCHEDULED_JOBS} rows and sorted only afterwards, for the fingerprint — so above the cap
 * the sort was over a membership the order had already decided. Reviewer-15 reproduced it: the same
 * 101 jobs observed ascending and then reversed published twice, and in the second level `j000` had
 * vanished and `j100` had appeared. Downstream is told the set changed when the provider's set did
 * not — a new ledger row per reorder, forever, and an arbitrary job flipping on `258`'s surface.
 *
 * ## ⚑ What it does now
 *
 * A bounded selection while scanning: keep the first {@link MAX_SCHEDULED_JOBS} rows in
 * {@link canonicalKey} order and count everything else as dropped. Membership is then a function of
 * the CONTENT of the payload alone, so a reorder selects the same rows and publishes nothing.
 *
 * ⚠️ **What this costs, said out loud, because it is the class `265` §4 is about.** The old loop
 * stopped reading rows once it had a hundred; this one calls {@link readJob} on every row of the
 * payload, because a canonical choice cannot be made from a prefix. The RETENTION is still bounded —
 * never more than a hundred jobs are held — but the SCAN is now linear in whatever the provider
 * sent, which is the cost that moved rather than went. Per row past the cap that is one `readJob`
 * and one string compare against the current hundredth key; nothing is accumulated.
 */
function selectJobs(raw: readonly unknown[]): { chosen: ChosenJob[]; dropped: number } {
  /** Ascending by `key`, never longer than {@link MAX_SCHEDULED_JOBS}. */
  const chosen: ChosenJob[] = []
  let dropped = 0
  // ⚠️ **An indexed loop and NOT `forEach`**, which skips the holes in a sparse array — so a
  // `[job, , job]` would have gone neither into the set nor into `dropped`, and the level would have
  // claimed to be complete while being one row short. The `for…of` this replaced yielded `undefined`
  // for a hole and counted it; keeping that is free, and losing it silently was not a trade.
  for (let at = 0; at < raw.length; at += 1) {
    const job = readJob(raw[at])
    if (job === null) {
      dropped += 1
      continue
    }
    const key = canonicalKey(job)
    // The common shape: the set is full and this row sorts at or after the last one kept. Decided
    // with one compare, so a huge payload costs a scan rather than a sort.
    if (chosen.length >= MAX_SCHEDULED_JOBS && key >= chosen[chosen.length - 1]!.key) {
      dropped += 1
      continue
    }
    let insertAt = chosen.length
    while (insertAt > 0 && chosen[insertAt - 1]!.key > key) insertAt -= 1
    chosen.splice(insertAt, 0, { at, key, job })
    if (chosen.length > MAX_SCHEDULED_JOBS) {
      chosen.pop()
      dropped += 1
    }
  }
  return { chosen, dropped }
}

/**
 * A TOTAL order over the content of a job, and the two words are both load-bearing.
 *
 * **Total**, because `id` alone is not: two rows may carry the same id with different schedules, and
 * `Array.prototype.sort` is stable — so an id-only comparator left the sorted fingerprint dependent
 * on the input order, which is the same promise broken below the cap. Found while fixing the cap,
 * reproduced, and killed by the same rule.
 *
 * **Content**, because the position in the payload must not reach it. `JSON.stringify` of a
 * {@link ScheduledJob} is injective over these shapes and begins with the id, so in practice this
 * orders by id and then by the rest of the row; what is guaranteed is only that equal content
 * compares equal and different content compares consistently.
 */
function canonicalKey(job: ScheduledJob): string {
  return JSON.stringify(job)
}

/**
 * One `SessionCronSummary`, or `null` when it cannot be one.
 *
 * ⛔ **A missing `id` is a drop, not a row with a blank id.** The id is the only thing that makes two
 * payloads comparable, so a row without one would make the fingerprint above unstable and the
 * registry unable to say which job it was showing. The caller counts it into `dropped`, which is how
 * the shortfall reaches a person instead of a log.
 */
function readJob(entry: unknown): ScheduledJob | null {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as Record<string, unknown>
  const id = record['id']
  if (typeof id !== 'string' || id === '') return null
  const schedule = record['schedule']
  const recurring = record['recurring']
  const prompt = record['prompt']
  return {
    id: clipScheduleText(id, MAX_SCHEDULE_TEXT),
    ...(typeof schedule === 'string'
      ? { schedule: clipScheduleText(schedule, MAX_SCHEDULE_TEXT) }
      : {}),
    ...(typeof recurring === 'boolean' ? { recurring } : {}),
    ...(typeof prompt === 'string'
      ? { prompt: clipScheduleText(prompt, MAX_SCHEDULE_PROMPT) }
      : {}),
  }
}
