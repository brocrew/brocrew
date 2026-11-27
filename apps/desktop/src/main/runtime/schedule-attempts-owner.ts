import type { NotStartedBecause } from '@brobot2/runtime'
import { theJobOfAMaking } from './schedule-evidence'
import { theSameIsSaid } from './schedule-notices'
import {
  recordScheduleAdmission,
  type WakeAdmissionPlan,
} from '../../shared/schedule-wake-admission'
import {
  MAX_ATTEMPTS_A_CONVERSATION,
  NO_ATTEMPTS_KEPT,
  type ConversationAttempts,
  type KeptAttempts,
  type ToldNotice,
} from '../schedule-attempts-file'

export interface ScheduleAttemptsPersistence {
  read(): KeptAttempts
  write(kept: KeptAttempts): void | Promise<void>
}

type RunToRecord = Omit<ConversationAttempts['runs'][string], 'startedAt'> & {
  readonly making: string
  readonly startAt: number
}

const NOTHING_DONE: ConversationAttempts = {
  attempts: [],
  admittedAt: null,
  told: [],
  runs: {},
  notStartedSaid: {},
  at: 0,
}

export interface ScheduleStartReservation {
  readonly before: ConversationAttempts
  readonly saved: ConversationAttempts
}

type AttemptEdit = (record: ConversationAttempts | undefined) => ConversationAttempts | undefined

/** One hydrated book. Ordinary edits can be read before their ordered save has answered. */
export function createScheduleAttemptsOwner(storage: ScheduleAttemptsPersistence | undefined) {
  let kept = NO_ATTEMPTS_KEPT
  let saving = Promise.resolve()
  const completionByConversation = new Map<string, Promise<void>>()
  const pending = new Set<{ conversations: ReadonlySet<string>; edit: AttemptEdit }>()

  const ordered = <T>(conversations: Iterable<string>, command: () => Promise<T>): Promise<T> => {
    const result = saving.then(command)
    const completion = result.then(
      () => undefined,
      () => undefined,
    )
    saving = completion
    const affected = [...conversations]
    for (const conversation of affected) completionByConversation.set(conversation, completion)
    void completion.then(() => {
      for (const conversation of affected)
        if (completionByConversation.get(conversation) === completion)
          completionByConversation.delete(conversation)
    })
    return result
  }

  const keptFor = (conversation: string): ConversationAttempts | undefined => {
    let record = kept.conversations[conversation]
    for (const { conversations, edit } of pending) {
      if (conversations.has(conversation)) record = edit(record)
    }
    return record
  }
  const bounded = (record: ConversationAttempts): ConversationAttempts => ({
    ...record,
    told: record.told.slice(-MAX_ATTEMPTS_A_CONVERSATION),
  })
  const ordinary = (ids: readonly string[], edit: AttemptEdit): Promise<void> => {
    const change = { conversations: new Set(ids), edit }
    pending.add(change)
    return ordered(change.conversations, async () => {
      pending.delete(change)
      let next: Record<string, ConversationAttempts> | undefined
      for (const conversation of change.conversations) {
        const before = kept.conversations[conversation]
        const record = edit(before)
        if (record === before) continue
        next ??= { ...kept.conversations }
        if (record === undefined) delete next[conversation]
        else next[conversation] = record
      }
      if (next === undefined) return
      kept = { conversations: next }
      await storage?.write(kept)
    })
  }
  const record = (
    conversation: string,
    edit: (before: ConversationAttempts) => ConversationAttempts,
  ): Promise<void> =>
    ordinary([conversation], (before) => {
      const prior = before ?? NOTHING_DONE
      const next = edit(prior)
      return next === prior ? before : bounded(next)
    })
  const save = async (
    conversation: string,
    record: ConversationAttempts,
  ): Promise<ConversationAttempts> => {
    const saved = bounded(record)
    const next = { conversations: { ...kept.conversations, [conversation]: saved } }
    await storage?.write(next)
    kept = next
    return saved
  }

  return {
    hydrate(): void {
      if (storage !== undefined) kept = storage.read()
    },
    keptFor,
    of(conversation: string): ConversationAttempts {
      return keptFor(conversation) ?? NOTHING_DONE
    },
    resetUnmarkedAt(conversation: string): number | undefined {
      return keptFor(conversation)?.resetUnmarkedAt
    },
    recordExternalStart(
      conversation: string,
      admission: WakeAdmissionPlan,
      runs: readonly RunToRecord[],
      now: number,
    ): Promise<void> {
      return record(conversation, (before) => keptStart(before, admission, runs, now, -1))
    },
    recordTold(conversation: string, words: readonly ToldNotice[], now: number): Promise<void> {
      if (words.length === 0) return Promise.resolve()
      return record(conversation, (before) => {
        const known = new Set(before.told.map((one) => one.id))
        return {
          ...before,
          told: [...before.told, ...words.filter((one) => !known.has(one.id))],
          at: now,
        }
      })
    },
    settleNotices(
      conversation: string,
      notices: readonly ToldNotice[],
      now: number,
    ): Promise<void> {
      if (notices.length === 0) return Promise.resolve()
      return record(conversation, (before) => ({
        ...before,
        told: [...before.told, ...notices],
        at: now,
      }))
    },
    markResetUnrecorded(conversation: string, at: number): Promise<void> {
      return record(conversation, (before) => ({ ...before, resetUnmarkedAt: at, at }))
    },
    noteNotStarted(
      conversation: string,
      said: Readonly<Record<string, NotStartedBecause>>,
      now: number,
    ): Promise<void> {
      return record(conversation, (before) =>
        theSameIsSaid(said, before.notStartedSaid)
          ? before
          : { ...before, notStartedSaid: said, at: now },
      )
    },
    forgetJobs(conversation: string, named: ReadonlySet<string>, now: number): Promise<void> {
      return ordinary([conversation], (before) => {
        if (before === undefined) return undefined
        const stillNamed = (making: string): boolean =>
          named.has(theJobOfAMaking(making)?.job ?? '')
        const told = before.told.filter((one) => stillNamed(one.of))
        const runs = Object.entries(before.runs).filter(([making]) => stillNamed(making))
        if (told.length === before.told.length && runs.length === Object.keys(before.runs).length)
          return before
        return bounded({ ...before, told, runs: Object.fromEntries(runs), at: now })
      })
    },
    reserveStart(
      conversation: string,
      admission: WakeAdmissionPlan,
      runs: readonly RunToRecord[],
      now: number,
      reserved?: ScheduleStartReservation,
    ): Promise<ScheduleStartReservation | null> {
      return ordered([conversation], async () => {
        const current = kept.conversations[conversation]
        if (
          reserved !== undefined &&
          (current === undefined || current.attempts !== reserved.saved.attempts)
        )
          return null
        const before =
          reserved === undefined
            ? (current ?? NOTHING_DONE)
            : undoStart(current ?? NOTHING_DONE, reserved)
        const saved = await save(conversation, keptStart(before, admission, runs, now, 0))
        return { before, saved }
      })
    },
    releaseStart(
      conversation: string,
      reserved: ScheduleStartReservation,
      now: number,
    ): Promise<void> {
      return ordered([conversation], async () => {
        const current = kept.conversations[conversation]
        if (current === undefined || current.attempts !== reserved.saved.attempts) return
        await save(conversation, { ...undoStart(current, reserved), at: now })
      })
    },
    forgetConversations(conversations: readonly string[]): Promise<void> {
      return ordinary(conversations, () => undefined)
    },
    pendingSaveFor(conversation: string): Promise<void> | undefined {
      return completionByConversation.get(conversation)
    },
    drain(): Promise<void> {
      return saving
    },
  }
}

function keptStart(
  before: ConversationAttempts,
  admission: WakeAdmissionPlan,
  runs: readonly RunToRecord[],
  now: number,
  unansweredChange: 0 | -1,
): ConversationAttempts {
  const recordedRuns = { ...before.runs }
  for (const run of runs) {
    if (run.startAt > now) continue
    recordedRuns[run.making] = {
      runAt: run.runAt,
      startedAt: now,
      unanswered: run.unanswered + unansweredChange,
    }
  }
  return {
    ...before,
    attempts: recordScheduleAdmission(admission, now),
    admittedAt: now,
    runs: recordedRuns,
    at: now,
  }
}

/** Put back only the runs this reservation changed. Notices, resets and forgotten jobs stay put. */
function undoStart(
  current: ConversationAttempts,
  { before, saved }: ScheduleStartReservation,
): ConversationAttempts {
  const runs = { ...current.runs }
  for (const [making, started] of Object.entries(current.runs)) {
    if (started !== saved.runs[making] || started === before.runs[making]) continue
    const prior = before.runs[making]
    if (prior === undefined) delete runs[making]
    else runs[making] = prior
  }
  return { ...current, attempts: before.attempts, admittedAt: before.admittedAt, runs }
}
