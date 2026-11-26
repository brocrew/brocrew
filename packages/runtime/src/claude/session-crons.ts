import { scheduledRun } from '../native-run'
import {
  MAX_SCHEDULED_JOBS,
  MAX_SCHEDULE_PROMPT,
  MAX_SCHEDULE_TEXT,
  clipScheduleText,
  type ScheduledJob,
} from '../scheduled-work'
import type { ScheduledWorkEvent } from '../events'

/**
 * What this session has promised to do later, as the `Stop` hook states it. `session_crons` is a
 * field on `StopHookInput`, an in-process hook callback, and the message stream carries nothing about
 * crons, so this sits beside `ClaudeSessionHandle`'s hook rather than `normalizeMessage` and takes an
 * `unknown` payload.
 *
 * It publishes on change, not on every payload: `Stop` fires every turn end with usually the same
 * level, and each event is persisted and replayed. Replace semantics mean a listener that missed one
 * still converges on the next change. One instance per session, so a reopened conversation restates
 * its level once.
 *
 * Nothing is published before the first `Stop` (`jobs` absent means "not told"), so every emitted
 * level is something the provider said. An empty level at `system/init` would erase live jobs: every
 * scheduled fire re-emits `init` on the same stream, and a resumed session still holds its crons. The
 * remaining gap is that a job created during a turn is invisible until that turn ends; no other hook
 * but `SubagentStop` carries `session_crons`, and `Query` has no cron control to poll.
 */
export class SessionCrons {
  /**
   * The last level published, as an order-insensitive fingerprint (`null` before any). The level is a
   * set, so a reordering is not a change, but the emitted array keeps the provider's order. The cap
   * must choose canonically too; see {@link selectJobs}.
   */
  private published: string | null = null

  /**
   * Read one `session_crons` payload and return the event to publish, or `undefined` if the level is
   * unchanged. Input is `unknown` with every field checked; a non-array means "this frame did not
   * state the level" and produces nothing, never an empty set that would clear the registry.
   */
  observe(raw: unknown, source: string): ScheduledWorkEvent | undefined {
    if (!Array.isArray(raw)) return undefined
    const selected = selectJobs(raw)
    // Ascending by {@link canonicalKey}, so the fingerprint depends only on the chosen content.
    const fingerprint = JSON.stringify([selected.chosen.map((row) => row.key), selected.dropped])
    if (fingerprint === this.published) return undefined
    this.published = fingerprint
    // Emitted in the provider's order: selection is canonical, presentation is not.
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
 * Choose which rows survive the cap by content, not arrival order: keep the first
 * {@link MAX_SCHEDULED_JOBS} rows in {@link canonicalKey} order and count the rest as dropped.
 * Otherwise the same jobs in a different order would select different members above the cap and
 * publish a spurious change. Retention is bounded, but every row is read (`readJob`) because a
 * canonical choice cannot be made from a prefix.
 */
function selectJobs(raw: readonly unknown[]): { chosen: ChosenJob[]; dropped: number } {
  /** Ascending by `key`, never longer than {@link MAX_SCHEDULED_JOBS}. */
  const chosen: ChosenJob[] = []
  let dropped = 0
  // Indexed loop, not `forEach`: `forEach` skips holes in a sparse array, so a hole would be neither
  // kept nor counted in `dropped`.
  for (let at = 0; at < raw.length; at += 1) {
    const job = readJob(raw[at])
    if (job === null) {
      dropped += 1
      continue
    }
    const key = canonicalKey(job)
    // Common case: the set is full and this row sorts after the last one kept; one compare.
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
 * A total order over the content of a job. `id` alone is not total: two rows may share an id with
 * different schedules, and a stable sort would then leave the order dependent on input. The position
 * in the payload must not reach it. `JSON.stringify` is injective over these shapes and starts with
 * the id.
 */
function canonicalKey(job: ScheduledJob): string {
  return JSON.stringify(job)
}

/**
 * One `SessionCronSummary`, or `null` when it cannot be one. A missing `id` is a drop: the id is what
 * makes two payloads comparable, and the caller counts it into `dropped` so the shortfall reaches a
 * person.
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
    run: scheduledRun({
      ...(typeof prompt === 'string' ? { prompt } : {}),
      ...(typeof schedule === 'string' ? { schedule } : {}),
    }),
    ...(typeof schedule === 'string'
      ? { schedule: clipScheduleText(schedule, MAX_SCHEDULE_TEXT) }
      : {}),
    ...(typeof recurring === 'boolean' ? { recurring } : {}),
    ...(typeof prompt === 'string'
      ? { prompt: clipScheduleText(prompt, MAX_SCHEDULE_PROMPT) }
      : {}),
  }
}
