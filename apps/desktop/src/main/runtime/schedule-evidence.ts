import { recordedScheduleReceiptProvider } from '../providers/definitions'
import { createHash } from 'node:crypto'
import type { ScheduleReceipt } from '@brobot2/runtime'
import type { ScheduleEvidenceRow } from '../db/session-store'
import { localFields, type LocalZone } from '../../shared/local-time'
import { clockTime } from '../../shared/clock'
import {
  confirmSchedulePersistence,
  emptyScheduleEvidence,
  receiptGenerations,
  recordReceiptPlacements,
  validateScheduleObservation,
  type CalendarStamp,
  type ReceiptGeneration,
  type ReceiptSchedulePlan,
  type ScheduleEvidenceLedger,
  type ScheduleNotice,
  type ScheduleObservation,
  type ScheduleScope,
  type SchedulingInput,
} from '../../shared/schedule-receipts'
import {
  eligibilityBounds,
  nextCronOccurrence,
  type CalendarSource,
} from '../../shared/schedule-wake'

/**
 * **A conversation's scheduling evidence, built from its own ledger rows** — the receipts the
 * provider's tool hooks gave (`scheduled_work` rows carrying a `receipt`), the levels it stated at
 * each turn's end, and when each of its lives began and ended. The planner
 * (`shared/schedule-receipts.ts`) decides from it what a start would bring back and when.
 *
 * Every observation is a row already appended, so the evidence is persisted as it is built. The
 * same rows always give the same evidence: nothing here reads the clock.
 */

/** The provider every receipt here comes from: only Claude's adapter keeps them. */
const PROVIDER = recordedScheduleReceiptProvider

/** What made the observations, for the planner's records. */
const ADAPTER_VERSION = 'brobot-schedule-evidence-1'

/** What a receipt kept before the host stamped its calendar, so its time stays unknown. */
const UNRECORDED = 'unrecorded'

/**
 * The source of the level the host writes from the planner's listing. Read back, it is not
 * evidence: only the provider's own levels are.
 */
export const RECEIPTS_LEVEL_SOURCE = 'app/receipts'

export type { ScheduleEvidenceRow }

/** The row types the evidence reads; a `status` only when it ends a life. */
export function isScheduleEvidence(type: string, payload: unknown): boolean {
  if (type === 'scheduled_work' || type === 'launched') return true
  if (type !== 'status' || !isFields(payload)) return false
  return payload['state'] === 'ended' || payload['state'] === 'errored'
}

/** The host's calendar as a receipt row is kept, so a later plan can tell if it moved since. */
export interface ReceiptStamp {
  readonly calendar: string
  readonly version: string
}

/**
 * **Which clock era a moment belongs to.** An era ends when this app sees the wall clock jump
 * against one that is never set; the planner trusts a time only within the era it was read in.
 */
export type ClockEraAt = (at: number) => string

/**
 * **The Mac's own calendar, as the planner reads one** — the zone this app reads off the system
 * (`local-time.ts`). Its version is a digest of that zone's data, so a zone that moves, or whose
 * rules change, is another version and the planner places a job's time again.
 */
export function hostCalendar(zone: LocalZone | null): CalendarSource {
  return {
    identity: 'mac-local',
    version:
      zone === null
        ? 'this-app-zone-data'
        : createHash('sha256').update(JSON.stringify(zone)).digest('hex').slice(0, 16),
    monthBase: 0,
    read: (at) => {
      const fields = localFields(at)
      return {
        year: fields.year,
        month: fields.month,
        day: fields.date,
        weekday: fields.day,
        hour: fields.hours,
        minute: fields.minutes,
        second: fields.seconds,
      }
    },
    format: clockTime,
  }
}

/** The stamp the host adds to a receipt as it keeps it. */
export function receiptStamp(calendar: CalendarSource): ReceiptStamp {
  return { calendar: calendar.identity, version: calendar.version }
}

/**
 * A level this app stated, by its source: the one it writes from the planner's listing, and the
 * one it wrote, before that, when it took a one-shot whose minute had come out of the level.
 */
const isTheAppsOwn = (source: string): boolean =>
  source.startsWith('app/') || source.startsWith('this app')

const isFields = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The planner's scope for one life of a conversation. ⚑ A life is named by the row that began it
 * (its moment and ordinal), so the same rows name it the same way however many came before them.
 */
export function scheduleScope(conversation: string, life: string, childId?: string): ScheduleScope {
  return {
    conversationId: conversation,
    providerId: PROVIDER,
    lineageId: conversation,
    sessionId: `life-${life}`,
    ...(childId === undefined ? {} : { childId }),
  }
}

/** The life before any `launched` row was read. */
const BEFORE_ANY_LIFE = 'before'

/**
 * **This app's own name for one making of a job** — its id with the call that made it (the call's
 * own id and the row its result was kept in) and whose call it was, or its id alone for a job only
 * ever seen listed. ⚑ What this app did about a job is kept under it, so a job made again under an
 * id used before starts with nothing done. ⚑ Its parts are kept apart as written (a list, not a
 * joined string), so no two makings read alike; ⚑ and none of them is the life it was made in, so
 * it stays the same when the rows of older lives leave the read.
 */
export function aJobsMaking(generation: ReceiptGeneration): string {
  const made = generation.creation?.result
  const whose = generation.scope.childId ?? null
  return JSON.stringify(
    made === undefined
      ? ['listed', generation.jobId, whose]
      : ['made', generation.jobId, made.toolUseId, made.eventId, whose],
  )
}

/** What a making says of its job: its id, and whether a call that made it was on record. */
export function theJobOfAMaking(
  making: string,
): { readonly job: string; readonly made: boolean } | undefined {
  try {
    const parts: unknown = JSON.parse(making)
    if (!Array.isArray(parts)) return undefined
    const [kind, job] = parts as unknown[]
    if ((kind !== 'made' && kind !== 'listed') || typeof job !== 'string') return undefined
    return { job, made: kind === 'made' }
  } catch {
    return undefined
  }
}

/**
 * The planner's scope for a conversation's whole schedule. ⚑ The planner reads every life of one
 * lineage together, so the life this names is none in particular.
 */
export function aConversationsScope(conversation: string): ScheduleScope {
  return scheduleScope(conversation, BEFORE_ANY_LIFE)
}

/**
 * **A conversation's evidence, kept in step with its ledger**: built once from the rows the store
 * holds, then handed each row as it is written, so a plan made in the middle of a turn costs no
 * read of the ledger.
 *
 * ⚑ A row that is not one of the shapes below is passed over: the planner is never handed
 * something it would refuse. ⚑ `ScheduleWakeup` and `CronList` receipts are passed over too: no
 * start is planned from the one, and the planner reads nothing from the other. ⚠️ A job is placed
 * only on the calendar it was created under: one created before the zone moved has no placed
 * time, and its plan asks for one start to find out.
 *
 * ⚑ Each row's observations are named by the row's own moment and ordinal, so none is taken twice
 * and they are kept as they come; the planner's ledger is made from them when it is asked for.
 * ⚑ A row this app wrote to mark a reset of the provider's conversation is no observation: it
 * draws the line {@link ScheduleEvidence.heardOfSinceItsReset} reads.
 */
export class ScheduleEvidence {
  private ledger = emptyScheduleEvidence()
  /** Each observation taken, in order; a cancellation's are `null` until its target is read. */
  private readonly observations: (ScheduleObservation | null)[] = []
  /** The cancellations whose target is read as the evidence is next placed ({@link on}). */
  private waiting: {
    readonly receipt: ScheduleReceipt
    readonly life: string
    readonly eventId: string
    /** Where its call's observation goes; its result's is the next. */
    readonly slot: number
    readonly order: number
  }[] = []
  /** The placements made so far: a job already placed is not placed again. */
  private placements: ScheduleEvidenceLedger['placements'] = []
  private order = 0
  private life = BEFORE_ANY_LIFE
  /** A life began and no row has ended it. */
  private open = false
  /** When the newest life began. */
  private began = 0
  /** Each life read, oldest first: when it began and, once known, when it ended. */
  private readonly lives: { readonly began: number; ended: number | null }[] = []
  /** The observations and calendar the evidence was last placed for ({@link on}). */
  private placedFor: string | null = null
  /** What each job was last said to ask, by its id: the provider's own words, for a notice. */
  private readonly asked = new Map<string, { schedule?: string; prompt?: string }>()
  /** Whether the rows it was built from left older scheduling history out. */
  private cut = false
  /**
   * The newest reset of its provider's conversation among the rows taken: the row that marks it,
   * and how many observations had been taken before it.
   */
  private reset: { readonly mark: string; readonly order: number } | undefined
  /**
   * The newest moment its provider's conversation is known to have been reset with no mark of it
   * in the rows ({@link itsProviderWasResetAt}).
   */
  private resetUnmarkedAt: number | undefined
  /** Whether a level its provider stated is among the rows taken. */
  private aLevelWasRead = false

  constructor(
    private readonly conversation: string,
    private readonly eraAt: ClockEraAt,
  ) {}

  /** What job `id` was last listed as asking, where a level said. */
  askedBy(id: string): { readonly schedule?: string; readonly prompt?: string } {
    return this.asked.get(id) ?? {}
  }

  /**
   * Whether one life of this conversation ran from `from` to `to`, as far as its rows show. ⚑ A
   * life still running has run as far as `now`.
   */
  wasRunningThrough(from: number, to: number, now: number): boolean {
    return this.lives.some((life) => life.began <= from && to <= (life.ended ?? now))
  }

  /**
   * The conversation holds scheduling history older than the rows this was built from. ⚑ Nothing
   * is planned differently for it: a job made before those rows is known only from where it is
   * still listed, so its time is not known, and a cancellation of one confirms nothing.
   */
  itsHistoryIsCut(): void {
    this.cut = true
  }

  /** Whether older scheduling history was left out of what this was built from. */
  get historyIsCut(): boolean {
    return this.cut
  }

  /** Whether a level its provider stated is among the rows taken. */
  get readALevel(): boolean {
    return this.aLevelWasRead
  }

  /** The newest reset of its provider's conversation known here, by its mark or its moment. */
  get itsReset(): string | undefined {
    return this.reset?.mark ?? this.resetUnmarkedAt?.toString()
  }

  /**
   * **Its provider's conversation was reset just now** — a line drawn after every observation taken
   * so far, at once, whether or not the row that marks it could be written: nothing from before it
   * starts a job until its provider lists the job again.
   */
  itsProviderWasReset(): void {
    this.reset = { mark: 'now', order: this.order }
  }

  /**
   * **Its provider's conversation was reset at `at`, and no row marks it** — the mark could not be
   * written, and this app kept the moment instead. A job neither made nor listed after `at` is
   * not heard of since, as after a mark.
   */
  itsProviderWasResetAt(at: number): void {
    this.resetUnmarkedAt = Math.max(at, this.resetUnmarkedAt ?? at)
  }

  /**
   * **Whether a job has been heard of since its provider's conversation was last reset** — made, or
   * listed by its provider, after that reset. ⚑ A provider keeps or drops its jobs across a reset
   * by rules of its own, so one not heard of since is neither there nor gone as far as this app
   * can tell: its provider's next level says. ⚑ With no reset read, every job has been heard of.
   */
  heardOfSinceItsReset(generation: ReceiptGeneration): boolean {
    const presence =
      generation.lastPresence?.kind === 'listing' && generation.presence === 'present'
        ? generation.lastPresence
        : undefined
    const made = generation.creation?.result
    if (
      this.reset !== undefined &&
      Math.max(made?.order ?? 0, presence?.order ?? 0) <= this.reset.order
    ) {
      return false
    }
    return (
      this.resetUnmarkedAt === undefined ||
      Math.max(made?.observedAt ?? 0, presence?.observedAt ?? 0) > this.resetUnmarkedAt
    )
  }

  /** Whether the newest life has a beginning and no end in the rows taken so far. */
  get itsLifeIsOpen(): boolean {
    return this.open
  }

  /**
   * **The newest life ended with no row to say so** — the app died under it — so its end is taken
   * as `at`, the last moment its provider is known to have said anything. ⚠️ An inference: it ran
   * on for some time after `at`. It is right about what the planner asks of it — whether the life
   * was running at a job's minute — because a provider that runs a job says so. ⚑ Nothing when the
   * life is not open.
   */
  itsLifeEndedUnseen(at: number): void {
    if (!this.open) return
    this.open = false
    // Never before the life began: a life that reported nothing ended, at the earliest, then.
    const endedAt = Math.max(at, this.began)
    const life = this.lives.at(-1)
    if (life !== undefined) life.ended = endedAt
    this.observe({
      kind: 'lifecycle',
      phase: 'stopped',
      eventId: `ended-unseen:life-${this.life}`,
      scope: scheduleScope(this.conversation, this.life),
      observedAt: endedAt,
      clockEra: this.eraAt(endedAt),
    })
  }

  /**
   * The evidence so far, each created job placed on `calendar`, confirmed persisted. ⚑ Made again
   * only when a row was taken since, or the calendar is another.
   */
  on(calendar: CalendarSource): ScheduleEvidenceLedger {
    const placedFor = `${String(this.order)}:${calendar.identity}:${calendar.version}`
    if (this.placedFor === placedFor) return this.ledger
    this.placedFor = placedFor
    this.readWhatItsCancellationsName()
    const observations = this.observations.filter((one) => one !== null)
    const placed = recordReceiptPlacements(
      {
        ...emptyScheduleEvidence(),
        revision: observations.length,
        observations,
        placements: this.placements,
      },
      calendar,
      scheduleScope(this.conversation, this.life),
    )
    this.placements = placed.placements
    this.ledger = confirmSchedulePersistence(placed, {
      revision: placed.revision,
      storageReference: `ledger:${this.conversation}`,
    })
    return this.ledger
  }

  /** One observation, numbered and checked as the planner checks it; `null` when it would refuse it. */
  private taken(observation: Record<string, unknown>, order: number): ScheduleObservation | null {
    const checked = validateScheduleObservation({
      schemaVersion: 1,
      order,
      cliVersion: 'unrecorded',
      adapterVersion: ADAPTER_VERSION,
      ...observation,
    })
    return checked.kind === 'valid' ? checked.observation : null
  }

  private observe(observation: Record<string, unknown>): void {
    this.order += 1
    const taken = this.taken(observation, this.order)
    if (taken !== null) this.observations.push(taken)
  }

  /**
   * **The job each cancellation waiting names** — the newest of its id made before it, else one only
   * listed — read from every job's history at once, and its call and result taken in their places.
   */
  private readWhatItsCancellationsName(): void {
    if (this.waiting.length === 0) return
    const ledger = {
      ...emptyScheduleEvidence(),
      observations: this.observations.filter((one) => one !== null),
      placements: this.placements,
    }
    const histories = new Map<string, ReturnType<typeof receiptGenerations>>()
    for (const { receipt, life, eventId, slot, order } of this.waiting) {
      const scope = scheduleScope(this.conversation, life, receipt.childId)
      const lineage = receipt.childId ?? ''
      const generations = histories.get(lineage) ?? receiptGenerations(ledger, scope)
      histories.set(lineage, generations)
      const jobId = receipt.tool === 'CronDelete' ? receipt.input?.id : undefined
      const ofIt = generations.filter((one) => one.jobId === jobId)
      const named =
        ofIt
          .filter((one) => one.creation !== undefined && one.creation.result.order < order)
          .at(-1) ?? ofIt.find((one) => one.creation === undefined)
      const executed: SchedulingInput | undefined =
        jobId === undefined || named === undefined
          ? undefined
          : { kind: 'cancel', target: { jobId, generation: named.generation } }
      const [call, result] = observationsOfAReceipt(
        receipt,
        this.conversation,
        life,
        eventId,
        this.eraAt,
        executed,
      )
      this.observations[slot] = call === undefined ? null : this.taken(call, order)
      this.observations[slot + 1] = result === undefined ? null : this.taken(result, order + 1)
    }
    this.waiting = []
  }

  /** One more row of the conversation's ledger, in the order it was written. */
  add(row: ScheduleEvidenceRow): void {
    const { conversation, eraAt } = this
    const eventId = `${String(row.at)}:${String(row.ordinal)}`
    const payload = isFields(row.payload) ? row.payload : {}
    if (row.rowType === 'launched') {
      // A life nothing ended had ended by the time the next began: no earlier moment is known here.
      this.itsLifeEndedUnseen(row.at)
      this.life = eventId
      this.open = true
      this.began = row.at
      this.lives.push({ began: row.at, ended: null })
      this.observe({
        kind: 'lifecycle',
        phase: 'started',
        eventId,
        scope: scheduleScope(conversation, this.life),
        observedAt: row.at,
        clockEra: eraAt(row.at),
      })
      return
    }
    if (row.rowType === 'status') {
      if (payload['state'] !== 'ended' && payload['state'] !== 'errored') return
      const life = this.lives.at(-1)
      if (this.open && life !== undefined) life.ended = row.at
      this.open = false
      this.observe({
        kind: 'lifecycle',
        phase: 'stopped',
        eventId,
        scope: scheduleScope(conversation, this.life),
        observedAt: row.at,
        clockEra: eraAt(row.at),
      })
      return
    }
    if (row.rowType !== 'scheduled_work') return
    if (payload['reset'] === true) {
      // ⚑ This app's own mark of a reset: an observation of nothing, and a line drawn after all
      // those taken so far.
      this.reset = { mark: eventId, order: this.order }
      return
    }
    const receipt = payload['receipt']
    if (isFields(receipt)) {
      if (receipt['tool'] === 'ScheduleWakeup' || receipt['tool'] === 'CronList') return
      const read = receipt as unknown as ScheduleReceipt
      if (read.tool === 'CronDelete') {
        // ⚑ Its call and result keep their places, and are taken once the job it names is read.
        this.waiting.push({
          receipt: read,
          life: this.life,
          eventId,
          slot: this.observations.length,
          order: this.order + 1,
        })
        this.observations.push(null, null)
        this.order += 2
        return
      }
      for (const observation of observationsOfAReceipt(
        read,
        conversation,
        this.life,
        eventId,
        eraAt,
        executedInputOf(read, conversation),
      )) {
        this.observe(observation)
      }
      return
    }
    const source = payload['source']
    const jobs = payload['jobs']
    if (!Array.isArray(jobs)) return
    // A level this app wrote is derived from the evidence, and is none itself.
    if (typeof source !== 'string' || isTheAppsOwn(source)) return
    this.aLevelWasRead = true
    for (const job of jobs as unknown[]) {
      if (!isFields(job) || typeof job['id'] !== 'string') continue
      this.asked.set(job['id'], {
        ...(typeof job['schedule'] === 'string' ? { schedule: job['schedule'] } : {}),
        ...(typeof job['prompt'] === 'string' ? { prompt: job['prompt'] } : {}),
      })
    }
    const dropped = typeof payload['dropped'] === 'number' ? payload['dropped'] : 0
    const listed = jobs.flatMap((job: unknown) =>
      isFields(job) && typeof job['id'] === 'string' && job['id'] !== ''
        ? [
            {
              jobId: job['id'],
              ...(typeof job['schedule'] === 'string' && job['schedule'] !== ''
                ? { schedule: job['schedule'] }
                : {}),
              ...(typeof job['recurring'] === 'boolean' ? { recurring: job['recurring'] } : {}),
            },
          ]
        : [],
    )
    const unreadable = jobs.length - listed.length
    this.observe({
      kind: 'listing',
      eventId,
      scope: scheduleScope(conversation, this.life),
      observedAt: row.at,
      clockEra: eraAt(row.at),
      complete: dropped + unreadable === 0,
      dropped: dropped + unreadable,
      jobs: listed,
      reference: eventId,
    })
  }
}

/** The evidence in `rows`, oldest first, placed on `calendar`. */
export function scheduleEvidenceOf(
  conversation: string,
  rows: readonly ScheduleEvidenceRow[],
  eraAt: ClockEraAt,
  calendar: CalendarSource,
): ScheduleEvidenceLedger {
  const evidence = new ScheduleEvidence(conversation, eraAt)
  for (const row of [...rows].sort((a, b) => a.at - b.at || a.ordinal - b.ordinal)) {
    evidence.add(row)
  }
  return evidence.on(calendar)
}

/**
 * One receipt as the planner's call and result. ⚑ The call is the hook's `PreToolUse` moment when
 * the receipt kept one, so the pair brackets the call; otherwise it is the result's own moment,
 * which names the call and gives no time.
 */
function observationsOfAReceipt(
  receipt: ScheduleReceipt,
  conversation: string,
  life: string,
  eventId: string,
  eraAt: ClockEraAt,
  /** What it says was run, in the planner's terms; `undefined` where it does not say. */
  executed: SchedulingInput | undefined,
): Record<string, unknown>[] {
  const stamp = receipt.stamp
  const calendar: CalendarStamp = {
    identity: stamp?.calendar ?? UNRECORDED,
    version: stamp?.version ?? UNRECORDED,
  }
  // The bracket holds only when both ends were read in one era.
  const clockEra = eraAt(receipt.answeredAt)
  const calledAt =
    receipt.calledAt !== undefined && eraAt(receipt.calledAt) === clockEra
      ? receipt.calledAt
      : undefined
  const scope = scheduleScope(conversation, life, receipt.childId)
  const answered = receipt.result !== undefined
  const shared = {
    toolUseId: receipt.toolUseId,
    toolName: receipt.tool,
    delivery: 'live',
    calendar,
    scope,
    clockEra,
  }
  return [
    {
      ...shared,
      kind: 'call',
      eventId: `${eventId}:call`,
      boundary: calledAt === undefined ? 'stream' : 'pre',
      observedAt: calledAt ?? receipt.answeredAt,
      ...(executed === undefined ? {} : { input: executed }),
    },
    {
      ...shared,
      kind: 'result',
      eventId: `${eventId}:result`,
      boundary: 'post',
      observedAt: receipt.answeredAt,
      outcome: answered ? 'success' : 'unknown',
      ...(executed === undefined ? {} : { executedInput: executed }),
      ...(receipt.tool === 'CronCreate' && receipt.result !== undefined
        ? { jobId: receipt.result.id }
        : {}),
      // ⚑ A cancellation is confirmed only when its result names the job it asked for: said
      // outright, so an answer that names another confirms none.
      ...(receipt.tool === 'CronDelete' &&
      receipt.result !== undefined &&
      executed?.kind === 'cancel' &&
      'target' in executed
        ? {
            confirmedTargets: receipt.result.id === executed.target.jobId ? [executed.target] : [],
          }
        : {}),
    },
  ]
}

/**
 * What a receipt says was run, in the planner's terms; `undefined` where it does not say. ⚑ A
 * cancellation's is read with the job it names ({@link ScheduleEvidence}).
 */
function executedInputOf(
  receipt: ScheduleReceipt,
  conversation: string,
): SchedulingInput | undefined {
  switch (receipt.tool) {
    case 'CronCreate': {
      const schedule = receipt.input?.cron
      const recurring = receipt.result?.recurring ?? receipt.input?.recurring
      if (schedule === undefined) return undefined
      return { kind: 'cron', schedule, ...(recurring === undefined ? {} : { recurring }) }
    }
    case 'CronDelete':
      return undefined
    case 'CronList':
      return { kind: 'listing', metadataRef: `${conversation}:${receipt.toolUseId}` }
    case 'ScheduleWakeup': {
      const input = receipt.input
      if (input === undefined) return undefined
      return {
        kind: 'dynamic',
        ...(input.delaySeconds === undefined ? {} : { delay: `${String(input.delaySeconds)}s` }),
        ...(input.stop === undefined ? {} : { stop: input.stop }),
      }
    }
  }
}

/**
 * **Which of a plan's notices are worth a turn**, and which the conversation needs no word about.
 *
 * A notice that a job *is no longer on the schedule* is not told when the conversation saw for
 * itself why:
 *  - the life whose level left it out had listed or made the job itself (it ran, was cancelled, or
 *    ran out, while that life watched);
 *  - the job's minute came while that life was running (it ran in it, as far as anything shows);
 *  - or the conversation has already been told something of that job.
 *
 * What is left is a job a start did not bring back, which its provider drops without a word.
 * Every other kind of notice is told.
 *
 * ⚑ **Old news is not told either**: a job that first left the listing more than
 * {@link AN_ABSENCE_IS_OLD_AFTER_MS} ago, with the conversation started twice or more since. The
 * first start after it left does not count: a conversation is planned for as it stops, so the stop
 * of that life may be the first time anything could tell it, however long the app was closed.
 * ⛔ Never a one-shot whose minute had passed before it left the listing: it came due while nothing
 * ran, and its work may never have happened.
 */
export function noticesWorthTelling(
  ledger: ScheduleEvidenceLedger,
  plan: ReceiptSchedulePlan,
  /** The jobs, each by its making ({@link aJobsMaking}), it has already been told something of. */
  toldOf: ReadonlySet<string>,
  calendar: CalendarSource,
  now: number,
): { readonly tell: readonly ScheduleNotice[]; readonly settle: readonly ScheduleNotice[] } {
  const tell: ScheduleNotice[] = []
  const settle: ScheduleNotice[] = []
  for (const notice of plan.notices) {
    const state = plan.states.find((one) => one.generation.generation === notice.generation)
    const absence = state?.generation.lastPresence
    if (notice.reason !== 'not-present' || state === undefined || absence === undefined) {
      tell.push(notice)
      continue
    }
    const life = absence.scope.sessionId
    const { generation } = state
    const sawItThere =
      generation.creation?.result.scope.sessionId === life ||
      ledger.observations.some(
        (row) =>
          row.kind === 'listing' &&
          row.scope.sessionId === life &&
          row.order < absence.order &&
          row.jobs.some((job) => job.jobId === generation.jobId),
      )
    const began = ledger.observations.find(
      (row) => row.kind === 'lifecycle' && row.phase === 'started' && row.scope.sessionId === life,
    )
    const pending = state.pendingNominalAt ?? firstTimeAfterItWasListed(state, calendar)
    const cameDueThere =
      pending !== undefined &&
      began !== undefined &&
      began.observedAt <= pending &&
      pending <= absence.observedAt
    if (sawItThere || cameDueThere || toldOf.has(aJobsMaking(generation))) settle.push(notice)
    else if (itIsOldNews(ledger, generation, absence, pending, now)) settle.push(notice)
    else tell.push(notice)
  }
  return { tell, settle }
}

/** How long ago a job must have left the listing for its leaving to be old news. */
export const AN_ABSENCE_IS_OLD_AFTER_MS = 24 * 60 * 60_000

/**
 * Whether a job the newest listing leaves out is old news ({@link noticesWorthTelling}). ⚑ Its age
 * is that of the first listing to leave it out since it was last listed, never of the newest one,
 * nor of the last time it was seen.
 */
function itIsOldNews(
  ledger: ScheduleEvidenceLedger,
  generation: ReceiptGeneration,
  absence: ScheduleObservation,
  /** The one-shot's minute, where one is known or estimated. */
  minute: number | undefined,
  now: number,
): boolean {
  let lastListed = generation.creation?.result.order ?? -1
  for (const row of ledger.observations) {
    if (
      row.kind === 'listing' &&
      row.order > lastListed &&
      row.order < absence.order &&
      row.jobs.some((job) => job.jobId === generation.jobId)
    )
      lastListed = row.order
  }
  let left = absence
  for (const row of ledger.observations) {
    if (row.kind === 'listing' && row.complete && row.order > lastListed && row.order < left.order)
      left = row
  }
  if (minute !== undefined && generation.input.recurring === false && minute <= left.observedAt)
    return false
  if (now - left.observedAt <= AN_ABSENCE_IS_OLD_AFTER_MS) return false
  const startedSince = ledger.observations.filter(
    (row) => row.kind === 'lifecycle' && row.phase === 'started' && row.order > left.order,
  )
  return startedSince.length >= 2
}

/**
 * A one-shot nobody saw made runs at its first time after it was first listed: an estimate, used
 * only to tell whether it came due while a life watched, and how long a life holds it.
 */
function firstTimeAfterItWasListed(
  state: ReceiptSchedulePlan['states'][number],
  calendar: CalendarSource,
): number | undefined {
  const { input, listedSince } = state.generation
  if (input.recurring !== false || input.schedule === undefined || listedSince === undefined) {
    return undefined
  }
  const first = nextCronOccurrence(input.schedule, {
    after: listedSince,
    inclusive: false,
    zone: 'UTC',
    calendar,
  })
  return first.kind === 'known' ? first.nominalAt : undefined
}

/**
 * **Until when a life started for a plan's jobs holds them, if its provider states no level** — a
 * provider that brought a job back says nothing until the job runs, so the life holds each through
 * the time this app reads for it: a repeating job until its next time and how late that may be, a
 * one-shot until its minute. `null` is *until its provider states a level*: a job this app cannot
 * place, or rows the level could not list. ⚑ This decides only when the idle stop may count the
 * life again. ⚠️ It is this app's own reading of a clock, and no proof of anything about a job:
 * nothing is said of one, and nothing is written.
 */
export function heldUntil(
  plan: ReceiptSchedulePlan,
  calendar: CalendarSource,
  now: number,
  leadMs: number,
  /** How long a job already past its minute, or brought back for a start at once, is held. */
  briefMs: number,
): number | null {
  if (plan.currentListing.dropped > 0) return null
  let until = now
  for (const { job } of plan.currentListing.jobs) {
    const state = plan.states.find((one) => one.generation.generation === job.evidence?.generation)
    if (job.schedule === undefined || job.recurring === undefined || state === undefined) {
      return null
    }
    let nominalAt: number | undefined
    if (job.recurring) {
      nominalAt = state.nextNominalAt
    } else {
      nominalAt = state.pendingNominalAt ?? firstTimeAfterItWasListed(state, calendar)
      if (nominalAt === undefined) return null
      // Its minute has passed: its provider runs it, or drops it, as it begins.
      if (nominalAt <= now) {
        until = Math.max(until, now + briefMs)
        continue
      }
    }
    if (nominalAt === undefined) {
      const next = nextCronOccurrence(job.schedule, {
        after: now,
        inclusive: false,
        zone: 'UTC',
        calendar,
      })
      if (next.kind !== 'known') return null
      nominalAt = next.nominalAt
    }
    const minute = calendar.read(nominalAt)?.minute ?? 0
    const bounds = eligibilityBounds(nominalAt, job.recurring, minute)
    if (bounds === null) return null
    until = Math.max(until, bounds.latestEligibleAt + leadMs)
  }
  return until
}
