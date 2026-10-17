import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { NOT_STARTED_BECAUSE, type NotStartedBecause } from '@brobot2/runtime'
import { MAX_INSTANT } from '../shared/clock'
import type { WakeAttempt } from '../shared/schedule-wake-admission'

/**
 * **What this app has already done about each stopped conversation's scheduled jobs**, kept across
 * a restart: `<userData>/schedule-attempts.json`.
 *
 * A stopped conversation is started for a job whose time this app cannot know once, and told once
 * of a job that passed while it was stopped. Both are facts about what this app did, not about the
 * conversation's history, so they are kept here and not in its ledger: a start that was made is
 * not made again because the app restarted.
 *
 * ⚑ Read once, at the host's start, and written when an attempt or a notice is recorded. Written
 * beside it and renamed, so a reader never sees half a file. ⚑ A file that is missing or cannot be
 * read is read as nothing done: each such job then costs one more start. ⚑ The host makes no
 * start of its own while the file cannot be written, so a start is never made that the next launch
 * could not know of. ⚠️ A conversation the cap dropped is read as nothing done, and costs one more.
 */

/** The most conversations the file holds; past it, the ones recorded longest ago go. */
export const MAX_ATTEMPT_CONVERSATIONS = 500
/**
 * The most attempt records and notices one conversation's record holds, the newest. ⚑ The host
 * keeps only those about jobs its evidence still holds; this bounds the file whatever it holds.
 */
export const MAX_ATTEMPTS_A_CONVERSATION = 5_000

/** A notice already dealt with: handed to a start, or needing no word. */
export interface ToldNotice {
  /** The notice's own id. */
  readonly id: string
  /** The job the notice was about, by its making: its id and the call that made it. */
  readonly of: string
  /** Handed to a start (`true`), or settled because the conversation saw it for itself (`false`). */
  readonly said: boolean
}

/** The newest run of a repeating job that a start was made for. */
export interface StartedFor {
  /** That run's minute, epoch ms. */
  readonly runAt: number
  /** When the start was made, epoch ms: a level its provider states after it answers that start. */
  readonly startedAt: number
  /**
   * How many starts this app made by itself for the job's runs, one after another, that its
   * provider has left unanswered — this one counted, if this app made it.
   */
  readonly unanswered: number
}

export interface ConversationAttempts {
  /** Each job, notice or shortfall a start was planned for, and whether that start was made. */
  readonly attempts: readonly WakeAttempt[]
  /** When the newest of those starts was made, epoch ms; `null` before any. */
  readonly admittedAt: number | null
  /** The notices already dealt with. */
  readonly told: readonly ToldNotice[]
  /** By the job's making: the newest run of a repeating job that a start was made for. */
  readonly runs: Readonly<Record<string, StartedFor>>
  /**
   * What the newest level in the conversation's ledger says this app does not start it for, by
   * job id: a level of this app's own is written, while it is stopped, only when that changes.
   */
  readonly notStartedSaid: Readonly<Record<string, NotStartedBecause>>
  /**
   * The newest moment its provider's conversation was reset where the row that marks the reset
   * could not be written: what a rebuilt plan reads in its place.
   */
  readonly resetUnmarkedAt?: number
  /** When this record last changed, epoch ms: what the cap drops by. */
  readonly at: number
}

export interface KeptAttempts {
  readonly conversations: Readonly<Record<string, ConversationAttempts>>
}

/** Nothing done yet. */
export const NO_ATTEMPTS_KEPT: KeptAttempts = { conversations: {} }

/** Where a data folder keeps its attempts. */
export function scheduleAttemptsFile(userData: string): string {
  return join(userData, 'schedule-attempts.json')
}

const aRecord = (said: unknown): Record<string, unknown> =>
  typeof said === 'object' && said !== null && !Array.isArray(said)
    ? (said as Record<string, unknown>)
    : {}

const aTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_INSTANT

const someText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

/**
 * What `file` holds, each part checked, or nothing done: a file that is missing, is not JSON, or
 * holds something else.
 */
export function readKeptAttempts(file: string): KeptAttempts {
  let said: unknown
  try {
    said = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return NO_ATTEMPTS_KEPT
  }
  const whole = aRecord(said)
  const conversations: Record<string, ConversationAttempts> = {}
  for (const [id, row] of Object.entries(aRecord(whole['conversations']))) {
    if (!someText(id, 200)) continue
    const { attempts, admittedAt, told, runs, notStartedSaid, resetUnmarkedAt, at } = aRecord(row)
    if (!aTime(at)) continue
    const kept: WakeAttempt[] = []
    for (const one of Array.isArray(attempts) ? attempts : []) {
      const { key, revision, attempted } = aRecord(one)
      if (!someText(key, 2_000) || !someText(revision, 20_000) || typeof attempted !== 'boolean') {
        continue
      }
      kept.push({ key, revision, attempted })
    }
    const notices: ToldNotice[] = []
    for (const one of Array.isArray(told) ? told : []) {
      const { id: noticeId, of, said: wasSaid } = aRecord(one)
      if (!someText(noticeId, 8_000) || !someText(of, 4_000) || typeof wasSaid !== 'boolean') {
        continue
      }
      notices.push({ id: noticeId, of, said: wasSaid })
    }
    const ran: Record<string, StartedFor> = {}
    for (const [job, one] of Object.entries(aRecord(runs))) {
      const { runAt, startedAt, unanswered } = aRecord(one)
      if (someText(job, 4_000) && aTime(runAt) && aTime(startedAt) && aTime(unanswered)) {
        ran[job] = { runAt, startedAt, unanswered }
      }
    }
    const said: Record<string, NotStartedBecause> = {}
    for (const [job, why] of Object.entries(aRecord(notStartedSaid))) {
      const known = NOT_STARTED_BECAUSE.find((one) => one === why)
      if (someText(job, 4_000) && known !== undefined) said[job] = known
    }
    conversations[id] = {
      attempts: kept.slice(-MAX_ATTEMPTS_A_CONVERSATION),
      admittedAt: aTime(admittedAt) ? admittedAt : null,
      told: notices.slice(-MAX_ATTEMPTS_A_CONVERSATION),
      runs: ran,
      notStartedSaid: said,
      ...(aTime(resetUnmarkedAt) ? { resetUnmarkedAt } : {}),
      at,
    }
  }
  return { conversations: newest(conversations) }
}

/** The conversations recorded most recently, at most {@link MAX_ATTEMPT_CONVERSATIONS}. */
function newest(
  conversations: Readonly<Record<string, ConversationAttempts>>,
): Record<string, ConversationAttempts> {
  const rows = Object.entries(conversations)
  if (rows.length <= MAX_ATTEMPT_CONVERSATIONS) return { ...conversations }
  return Object.fromEntries(
    rows.sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_ATTEMPT_CONVERSATIONS),
  )
}

/** Write what is kept, replacing what the file held. */
export function writeKeptAttempts(file: string, kept: KeptAttempts): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify({ conversations: newest(kept.conversations) })}\n`)
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
