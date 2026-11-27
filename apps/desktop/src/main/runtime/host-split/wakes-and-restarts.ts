import { type RunOwed } from '../host-split/schedule-planning'
import { providerDescriptor, type Provider } from '@brobot2/shared'
import type { TurnAsItEnded, SessionStore } from '../../db/session-store'
import type { RowsUnread } from '../../db/rows-unread'
import { theStoppedWork } from '../reply-rails'
import type { ScheduleLevel } from '../../../shared/agent-state-contracts'
import { clockTimeFrom } from '../../../shared/clock'
import { type WakeAdmissionPlan } from '../../../shared/schedule-wake-admission'
import { type CutKind, type CutRecord } from '../../turns-the-app-cut-file'

/** Every conversation's newest schedule level, as the launch reads it once. */
type ScheduleLevelsAtTheLaunch = ReturnType<SessionStore['newestScheduleLevels']>

/**
 * How long a life started for its jobs holds one whose minute has already come, when its provider
 * states no level: a provider restores its jobs, and runs what is due, within seconds
 * ({@link WAKE_LEAD_MS}).
 */
const WAKE_BRIEF_HOLD_MS = 2 * 60_000

/** The most conversations whose scheduling evidence is held in memory at once. */
const SCHEDULES_HELD = 200

/**
 * ⚑ **D-029 · the longest a wake-up's timer waits before it reads the wall clock again** — the
 * provider fires on the wall clock, checked every second, while a timer counts a clock that may not
 * advance while the Mac sleeps (not measured here). ⚠️ It also keeps every delay under
 * `setTimeout`'s 2³¹−1 ms: a yearly one-shot is months away. ⚑ And a start that failed is tried
 * again this long after it, first.
 */
const WAKE_CHECK_MS = 60_000

/**
 * ⚑ **D-029 · the longest a wake-up waits to try a start again after one failed** — each retry waits
 * twice as long as the one before, from {@link WAKE_CHECK_MS}, up to the half hour the provider
 * itself may fire a repeating job past its time (`recurringCapMs`): a provider that cannot start is
 * not spawned every minute, and one that recovers is started within that half hour.
 */
const WAKE_RETRY_MAX_MS = 30 * 60_000

const ITS_JOB_MESSAGES_WERE_NOT_DELIVERED =
  'This conversation could not run, so these scheduled-job messages were not delivered. Its record stays readable.'

const IT_COULD_NOT_WAKE =
  'This conversation could not wake: its provider session file is missing. Nothing ran.'

/**
 * ⚑ **D-029 · why the words about a conversation's own jobs are ended at a launch** — that launch
 * tells its jobs again, from its ledger, in words true now ({@link RuntimeHost.armItsWakeUp}).
 * ⛔ A durable row names no conversation.
 */
const NEWER_WORDS_ABOUT_ITS_JOBS =
  'newer words about this conversation’s jobs took their place when this app started again'

/** Why words about its jobs end when a later plan of them takes their place. */
const NEWER_WORDS_ABOUT_ITS_JOBS_NOW = 'newer words about this conversation’s jobs took their place'

/** Why words about its jobs ended when a conversation came back from the archive. */
const NEWER_WORDS_AFTER_THE_ARCHIVE =
  'newer words about this conversation’s jobs took their place when it came back from the archive'

/** Why words about its jobs ended when a delete stopped a conversation and kept its records. */
const NEWER_WORDS_AFTER_A_DELETE =
  'newer words about this conversation’s jobs took their place when a delete stopped it'

/**
 * How old a first brief is before its giver hears that the handoff is still unconfirmed
 * ({@link RuntimeHost.reconcileFirstBriefs}). ⚑ Two of the 60 s work sweeps, so a handoff gets a
 * full sweep to confirm first. ⛔ It tells, and never refuses, stops or redelivers anything (card
 * 197). It is also the giver's only signal for a start that never reaches its launch clock: home
 * preparation runs before that progress clock, so a start stuck there would otherwise be silent.
 */
const FIRST_BRIEF_OBSERVATION_MS = 120_000
/**
 * 🔴 **How long a launch waits before each conversation it starts because the restart stopped its
 * background work** ({@link RuntimeHost.wakeWhatTheRestartStopped}) — and the same again between
 * one such start and the next. ⚑ One start at a time: a busy restart with many of them spreads them
 * over this, never spawning them all at once while the window is still opening.
 */
const RESTART_WAKE_GAP_MS = 5_000

/**
 * ⚑ **F074 — how long one read of the providers' walls answers the hold** ({@link
 * RuntimeHost.theResetItWaitsFor}) — the limits warning's own five-second look. ⚑ A row that can
 * move a wall drops it sooner ({@link RuntimeHost.deliver}).
 */
const WALLS_READ_FOR_MS = 5_000

/**
 * ⚑ **F074 — how long after a provider's stated reset what waited for it goes** — the provider's
 * clock and this Mac's are not the same clock, and a turn sent a moment early only meets the limit
 * again.
 */
const AFTER_THE_RESET_MS = 30_000

/**
 * ⚑ **F074 — the longest one wait for a limit's reset runs before the hold looks again** — a
 * limit can move (a later wall, or one the provider cleared), and a timer longer than Node's
 * 24.8-day maximum fires at once.
 */
const LOOK_AT_THE_LIMIT_AGAIN_MS = 10 * 60_000

/**
 * ⚑ **How old the newest quit may be for its stopped background work to wake anybody** — a launch
 * the next morning still wakes last night's; a stamp left from a quit long before, on a
 * conversation nothing reopened since, does not.
 */
const RESTART_STOPPED_WITHIN_MS = 24 * 60 * 60_000

/** ⚑ Why earlier words about stopped background work are ended: this launch's take their place. */
const NEWER_WORDS_ABOUT_WHAT_THE_RESTART_STOPPED =
  'newer words about the background work a restart stopped took their place when this app started again'

/** ⚑ **F076** — why the words about a turn a refused login stopped are ended: its reopen failed. */
const ITS_REOPEN_ON_THE_NEW_LOGIN_FAILED =
  'this app could not reopen this conversation on the current login, so these words were not sent'

/** ⚑ Why the words about stopped background work are ended: the start they waited for failed. */
const ITS_START_AFTER_THE_RESTART_FAILED =
  'this app could not start this conversation again after the restart, so these words were not sent'

/**
 * 🔴 **What a conversation is told when the app's restart stopped its background work** — the
 * time, on this Mac's clock (with its day when that is not today), and what was running, by what
 * its provider called it. ⚑ It asks nothing of it but to decide.
 */
export function backgroundTheRestartStoppedText(
  stopped: readonly string[],
  endedAt: number,
  now: number,
): string {
  return (
    `The app restarted at ${clockTimeFrom(endedAt, now)} and stopped your background work: ` +
    `${theStoppedWork(stopped)}. Start it again if it’s still needed.`
  )
}

/** How long before a launch a turn this app cut may have been cut, for the launch to continue it. */
const A_CUT_TURN_IS_CONTINUED_WITHIN_MS = 60 * 60_000

/** How long after a conversation's program stopped mid-turn it is started again, once. */
const A_PROGRAM_IS_STARTED_AGAIN_AFTER_MS = 60_000

/** The furthest reset a turn a usage limit cut waits for, from its cut. */
const A_LIMIT_IS_WAITED_FOR_AT_MOST_MS = 24 * 60 * 60_000

/**
 * How many automatic continuations of one conversation may come in a row, whatever cut each turn:
 * a third cut waits for a person.
 */
const AUTOMATIC_CONTINUATIONS_IN_A_ROW = 2

/**
 * How many automatic continuations came just before a cut, in a row: none when the cut turn was not
 * itself a continuation; else one more than the cut it continued, once that continuation was sent,
 * or one when what came before it is not known.
 */
function continuationsInARow(before: CutRecord | undefined, aContinuation: boolean): number {
  if (!aContinuation) return 0
  return before?.state === 'sent' ? (before.inARow ?? 0) + 1 : 1
}

/** How far apart a provider's limit continuations go after its reset. */
const LIMIT_WAKES_APART_MS = 2 * 60_000

/** How long a woken life's account is waited for, as its provider's own account read is bounded. */
const ACCOUNT_WAIT_MS = 15_000

/** How often a woken life is asked whether its account is known yet, while it is waited for. */
const ACCOUNT_LOOK_EVERY_MS = 50

/**
 * 🔴 **What a conversation is told when this app continues a turn that was cut** — on this Mac's
 * clock, with its day when that is not today. ⚑ A crash leaves no moment of its own, so its words
 * name the last thing this app recorded, never a time it stopped.
 */
export function aTurnTheAppCutText(
  kind: CutKind,
  cutAt: number,
  now: number,
  provider: Provider,
): string {
  const at = clockTimeFrom(cutAt, now)
  const then = 'Check what already happened, then continue.'
  switch (kind) {
    case 'quit':
      return `The app restarted at ${at} during your turn. ${then}`
    case 'crash':
      return `The app stopped unexpectedly during your turn (last seen at ${at}). ${then}`
    case 'program':
      return `${providerDescriptor(provider).programName} stopped unexpectedly at ${at} during your turn. ${then}`
    case 'limit':
      return `Your turn stopped at ${at} when the usage limit was reached. The limit has reset. ${then}`
  }
}

/**
 * ⚑ Whether a turn's own rows still say what cut it, in the cut's generation, with no stop asked:
 * a quit's ended in this app's word or unseen, a crash's unseen; a program's failed in this app's
 * word, or unseen, with no limit; a limit's named one. ⛔ Never a refused login or bill.
 */
function theTurnWasCut(kind: CutKind, turn: TurnAsItEnded, generation: number): boolean {
  if (turn.generation !== generation || turn.stopAsked) return false
  switch (kind) {
    case 'quit':
      return turn.ending === 'unknown' || (turn.ending === 'interrupted' && turn.theAppsWord)
    case 'crash':
      return turn.ending === 'unknown'
    case 'program':
      return (
        !turn.refused &&
        !turn.endedOnALimit &&
        (turn.ending === 'unknown' || (turn.ending === 'failed' && turn.theAppsWord))
      )
    case 'limit':
      return !turn.refused && turn.endedOnALimit
  }
}

/**
 * How many times the gap between two starts in the line a start due at once waits out: it has no
 * minute to meet, and many can be due together at a launch.
 */
const AT_ONCE_START_GAPS = 4

/**
 * ⚑ **D-029 · one stopped conversation's wake-up** — see {@link RuntimeHost.wakeUps}.
 */
interface WakeUp {
  /**
   * The jobs its plan lists — what its state says while it is stopped, and what its next life is
   * seeded with. ⚑ Planned again as any start begins ({@link RuntimeHost.judgeItsWakeUpAgain}).
   */
  level: ScheduleLevel
  /** What its plan asks a start for, each with whether that start was already made. */
  admission: WakeAdmissionPlan
  /** The runs of its repeating jobs a start is owed for ({@link RuntimeHost.planItsWake}). */
  runs: readonly RunOwed[]
  /**
   * Until when a life started for it holds these jobs if its provider states no level
   * ({@link RuntimeHost.letGoOfJobsItNeverRestored}); `null` is until it states one.
   */
  holdFor: number | null
  /** When to start it. */
  startAt: number
  /**
   * Whether it was armed for a time ahead — a job's run — rather than due at once: in the line its
   * start waits in, it goes before those ({@link RuntimeHost.itsTimeCame}).
   */
  readonly forATimeAhead: boolean
  /** How many of its starts have failed — each retry waits longer ({@link WAKE_RETRY_MAX_MS}). */
  failed: number
  /**
   * The provider whose saved key its start could not read, while it waits for that key to be saved
   * again or removed ({@link RuntimeHost.waitForItsKey}); `null` otherwise.
   */
  waitingForItsKey: Provider | null
  /** Its timer, while one is set. */
  timer: ReturnType<typeof setTimeout> | null
  /** Its last life's provider going: the launch registry refuses the id until then. */
  readonly lastLifeEnded: Promise<unknown>
}

/**
 * ⚑ **D-017 · R8 — one launch sweep's console line**, said when it settled anything or skipped a
 * ledger, with how many ledgers it skipped.
 */
function sayTheSweep(settled: number, skipped: RowsUnread, line: string): void {
  if (settled === 0 && skipped.ledgersSkipped === 0) return
  console.info(
    skipped.ledgersSkipped === 0
      ? line
      : `${line}; ${String(skipped.ledgersSkipped)} ledger(s) skipped`,
  )
}

export {
  A_CUT_TURN_IS_CONTINUED_WITHIN_MS,
  A_LIMIT_IS_WAITED_FOR_AT_MOST_MS,
  A_PROGRAM_IS_STARTED_AGAIN_AFTER_MS,
  ACCOUNT_LOOK_EVERY_MS,
  ACCOUNT_WAIT_MS,
  AFTER_THE_RESET_MS,
  AT_ONCE_START_GAPS,
  AUTOMATIC_CONTINUATIONS_IN_A_ROW,
  continuationsInARow,
  FIRST_BRIEF_OBSERVATION_MS,
  IT_COULD_NOT_WAKE,
  ITS_JOB_MESSAGES_WERE_NOT_DELIVERED,
  ITS_REOPEN_ON_THE_NEW_LOGIN_FAILED,
  ITS_START_AFTER_THE_RESTART_FAILED,
  LIMIT_WAKES_APART_MS,
  LOOK_AT_THE_LIMIT_AGAIN_MS,
  NEWER_WORDS_ABOUT_ITS_JOBS,
  NEWER_WORDS_ABOUT_ITS_JOBS_NOW,
  NEWER_WORDS_ABOUT_WHAT_THE_RESTART_STOPPED,
  NEWER_WORDS_AFTER_A_DELETE,
  NEWER_WORDS_AFTER_THE_ARCHIVE,
  RESTART_STOPPED_WITHIN_MS,
  RESTART_WAKE_GAP_MS,
  sayTheSweep,
  type ScheduleLevelsAtTheLaunch,
  SCHEDULES_HELD,
  theTurnWasCut,
  WAKE_BRIEF_HOLD_MS,
  WAKE_CHECK_MS,
  WAKE_RETRY_MAX_MS,
  type WakeUp,
  WALLS_READ_FOR_MS,
}
