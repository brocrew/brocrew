import {
  eligibilityBounds,
  nextCronOccurrence,
  readCalendarMinute,
  type CalendarSource,
  type JobWakeResult,
  type ScheduleWakeResult,
  type WakeJob,
} from './schedule-wake'

const MINUTE = 60_000
const LIFETIME = 7 * 24 * 60 * MINUTE

// These are normalized host records, not native provider payload schemas.
export type ScheduleScope = {
  conversationId: string
  providerId: string
  lineageId: string
  sessionId: string
  childId?: string
}
export type CalendarStamp = { identity: string; version: string }
export type JobTarget = { jobId: string; generation: string }
export type PublicCorrelation = {
  kind: 'provider-identity' | 'verified-public-correlation'
  reference: string
}
export type SchedulingInput =
  | { kind: 'cron'; schedule?: string; recurring?: boolean; promptRef?: string }
  | { kind: 'dynamic'; delay?: string; time?: string; stop?: boolean; targetGeneration?: string }
  | { kind: 'cancel'; target: JobTarget }
  | { kind: 'cancel'; targets: readonly JobTarget[] }
  | { kind: 'listing' | 'monitor' | 'unknown'; metadataRef?: string }
export type ProviderTiming = {
  provenance: 'public-receipt'
  reference: string
  createdAt?: number
  originalNominalAt?: number
}
type ObservationBase = {
  schemaVersion: 1
  eventId: string
  scope: ScheduleScope
  order: number
  observedAt: number
  clockEra: string
  cliVersion: string
  adapterVersion: string
}
export type ScheduleObservation = ObservationBase &
  (
    | {
        kind: 'call'
        toolUseId: string
        toolName: string
        boundary: 'pre' | 'stream'
        delivery: 'live' | 'buffered'
        calendar: CalendarStamp
        input?: SchedulingInput
      }
    | {
        kind: 'result'
        toolUseId: string
        toolName: string
        boundary: 'post' | 'stream'
        delivery: 'live' | 'buffered'
        calendar: CalendarStamp
        outcome: 'success' | 'failed' | 'cancelled' | 'interrupted' | 'unknown'
        executedInput?: SchedulingInput
        jobId?: string
        timing?: ProviderTiming
        confirmedTargets?: readonly JobTarget[]
      }
    | {
        kind: 'listing'
        complete: boolean
        dropped: number
        jobs: readonly { jobId: string; schedule?: string; recurring?: boolean }[]
        reference: string
      }
    | { kind: 'lifecycle'; phase: 'started' | 'stopped' | 'compacted' }
    | { kind: 'fire'; target: JobTarget; proof: PublicCorrelation; turnRef: string }
    | { kind: 'progress'; target: JobTarget; proof: PublicCorrelation; throughNominalAt: number }
    | {
        kind: 'restoration'
        target: JobTarget
        proof: PublicCorrelation
        status: 'present' | 'absent' | 'expired' | 'dropped'
        compactionCause?: PublicCorrelation
      }
    | { kind: 'resolution'; target: JobTarget; proof: PublicCorrelation; timing: ProviderTiming }
  )
type Call = Extract<ScheduleObservation, { kind: 'call' }>
type Result = Extract<ScheduleObservation, { kind: 'result' }>
export type CreationWindow = {
  lo: number
  hi: number
  provenance: 'provider-time' | 'pre/post-execution-bracket'
  clockEra: string
}
export type ReceiptPlacement = {
  generation: string
  evidenceRevision: string
  candidates: readonly number[]
  localMinutes?: readonly (number | null)[]
  provenance: 'explicit-provider' | 'derived-window' | 'unknown'
  calendar: CalendarStamp
  gapAt?: number
  reason?: string
}
export type ScheduleEvidenceLedger = {
  schemaVersion: 1
  revision: number
  persistedRevision: number
  storageReference?: string
  observations: readonly ScheduleObservation[]
  conflicts: readonly string[]
  placements: readonly ReceiptPlacement[]
}
export type ReceiptGeneration = {
  generation: string
  scope: ScheduleScope
  jobId: string
  input: Extract<SchedulingInput, { kind: 'cron' }>
  listedSince?: number
  creation?: { call: Call; result: Result }
  creationWindow?: CreationWindow
  explicitNominalAt?: number
  conflicted: boolean
  presence: 'present' | 'absent' | 'fired' | 'cancelled'
  cancellation: 'none' | 'unconfirmed' | 'failed' | 'confirmed'
  lastPresence?: ScheduleObservation
  fire?: Extract<ScheduleObservation, { kind: 'fire' }>
  progress?: Extract<ScheduleObservation, { kind: 'progress' }>
  restoration?: Extract<ScheduleObservation, { kind: 'restoration' }>
  materialRevision: string
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 16_384
const optionalText = (v: unknown) => v === undefined || text(v)
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const instant = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && Number.isFinite(new Date(v).getTime())
const minute = (v: unknown): v is number => instant(v) && v % MINUTE === 0
const stamp = (v: unknown) => object(v) && text(v.identity) && text(v.version)
const target = (v: unknown) => object(v) && text(v.jobId) && text(v.generation)
const targets = (v: unknown, allowEmpty = false) =>
  Array.isArray(v) &&
  v.length <= 256 &&
  (allowEmpty || v.length > 0) &&
  v.every(target) &&
  new Set(v.map((row) => stable([(row as JobTarget).jobId, (row as JobTarget).generation])))
    .size === v.length
const proof = (v: unknown) =>
  object(v) &&
  ['provider-identity', 'verified-public-correlation'].includes(String(v.kind)) &&
  text(v.reference)
const timing = (v: unknown) =>
  object(v) &&
  v.provenance === 'public-receipt' &&
  text(v.reference) &&
  (v.createdAt === undefined || instant(v.createdAt)) &&
  (v.originalNominalAt === undefined || minute(v.originalNominalAt)) &&
  (v.createdAt !== undefined || v.originalNominalAt !== undefined)
function input(v: unknown): boolean {
  if (!object(v)) return false
  if (v.kind === 'cron')
    return (
      optionalText(v.schedule) &&
      (v.recurring === undefined || typeof v.recurring === 'boolean') &&
      optionalText(v.promptRef)
    )
  if (v.kind === 'dynamic')
    return (
      optionalText(v.delay) &&
      optionalText(v.time) &&
      (v.stop === undefined || typeof v.stop === 'boolean') &&
      optionalText(v.targetGeneration)
    )
  if (v.kind === 'cancel')
    return v.targets === undefined ? target(v.target) : v.target === undefined && targets(v.targets)
  return ['listing', 'monitor', 'unknown'].includes(String(v.kind)) && optionalText(v.metadataRef)
}
function cancellationTargets(value: SchedulingInput | undefined): readonly JobTarget[] {
  if (value?.kind !== 'cancel') return []
  return 'target' in value ? [value.target] : value.targets
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (object(v))
    return (
      '{' +
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable(v[k]))
        .join(',') +
      '}'
    )
  return JSON.stringify(v) ?? 'null'
}
export function scopeKey(scope: ScheduleScope): string {
  return stable([
    scope.conversationId,
    scope.providerId,
    scope.lineageId,
    scope.sessionId,
    scope.childId ?? null,
  ])
}
export function lineageKey(scope: ScheduleScope): string {
  return stable([scope.conversationId, scope.providerId, scope.lineageId, scope.childId ?? null])
}

export function validateScheduleObservation(
  value: unknown,
): { kind: 'valid'; observation: ScheduleObservation } | { kind: 'invalid'; reason: string } {
  try {
    if (!object(value) || !object(value.scope)) return { kind: 'invalid', reason: 'missing scope' }
    const scope = value.scope
    if (
      value.schemaVersion !== 1 ||
      !text(value.eventId) ||
      !['conversationId', 'providerId', 'lineageId', 'sessionId'].every((key) =>
        text(scope[key]),
      ) ||
      !optionalText(scope.childId) ||
      !integer(value.order) ||
      !instant(value.observedAt) ||
      !text(value.clockEra) ||
      !text(value.cliVersion) ||
      !text(value.adapterVersion)
    )
      return { kind: 'invalid', reason: 'incomplete scope, version or original observation' }
    let valid = false
    if (value.kind === 'call' || value.kind === 'result') {
      valid =
        text(value.toolUseId) &&
        text(value.toolName) &&
        stamp(value.calendar) &&
        ['live', 'buffered'].includes(String(value.delivery))
      if (value.kind === 'call')
        valid =
          valid &&
          ['pre', 'stream'].includes(String(value.boundary)) &&
          (value.input === undefined || input(value.input))
      else
        valid =
          valid &&
          ['post', 'stream'].includes(String(value.boundary)) &&
          ['success', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(
            String(value.outcome),
          ) &&
          (value.executedInput === undefined || input(value.executedInput)) &&
          optionalText(value.jobId) &&
          (value.timing === undefined || timing(value.timing))
      if (value.kind === 'result' && value.confirmedTargets !== undefined) {
        const requested = cancellationTargets(value.executedInput as SchedulingInput | undefined)
        valid =
          valid &&
          value.toolName === 'CronDelete' &&
          value.outcome === 'success' &&
          targets(value.confirmedTargets, true) &&
          Array.isArray(value.confirmedTargets) &&
          value.confirmedTargets.every((row) =>
            requested.some(
              (item) =>
                object(row) && item.jobId === row.jobId && item.generation === row.generation,
            ),
          )
      }
    } else if (value.kind === 'listing') {
      valid =
        typeof value.complete === 'boolean' &&
        integer(value.dropped) &&
        (!value.complete || value.dropped === 0) &&
        text(value.reference) &&
        Array.isArray(value.jobs) &&
        value.jobs.every(
          (row) =>
            object(row) &&
            text(row.jobId) &&
            optionalText(row.schedule) &&
            (row.recurring === undefined || typeof row.recurring === 'boolean'),
        )
    } else if (value.kind === 'lifecycle')
      valid = ['started', 'stopped', 'compacted'].includes(String(value.phase))
    else if (value.kind === 'fire')
      valid = target(value.target) && proof(value.proof) && text(value.turnRef)
    else if (value.kind === 'progress')
      valid = target(value.target) && proof(value.proof) && minute(value.throughNominalAt)
    else if (value.kind === 'restoration')
      valid =
        target(value.target) &&
        proof(value.proof) &&
        ['present', 'absent', 'expired', 'dropped'].includes(String(value.status)) &&
        (value.compactionCause === undefined || proof(value.compactionCause))
    else if (value.kind === 'resolution')
      valid = target(value.target) && proof(value.proof) && timing(value.timing)
    if (!valid) return { kind: 'invalid', reason: 'unvalidated scheduling metadata' }
    // Copy only declared metadata: raw payloads and prompts are never retained here.
    const pick = (v: unknown, keys: string[]) =>
      object(v)
        ? Object.fromEntries(keys.filter((key) => v[key] !== undefined).map((key) => [key, v[key]]))
        : undefined
    const cleanInput = (v: unknown) => {
      if (!object(v)) return undefined
      if (v.kind === 'cancel')
        return Array.isArray(v.targets)
          ? { kind: 'cancel', targets: v.targets.map((row) => pick(row, ['jobId', 'generation'])) }
          : { kind: 'cancel', target: pick(v.target, ['jobId', 'generation']) }
      if (v.kind === 'cron') return pick(v, ['kind', 'schedule', 'recurring', 'promptRef'])
      if (v.kind === 'dynamic')
        return pick(v, ['kind', 'delay', 'time', 'stop', 'targetGeneration'])
      return pick(v, ['kind', 'metadataRef'])
    }
    const base = {
      schemaVersion: 1 as const,
      eventId: value.eventId,
      scope: pick(scope, ['conversationId', 'providerId', 'lineageId', 'sessionId', 'childId']),
      order: value.order,
      observedAt: value.observedAt,
      clockEra: value.clockEra,
      cliVersion: value.cliVersion,
      adapterVersion: value.adapterVersion,
    }
    const byKind: Record<string, string[]> = {
      call: ['toolUseId', 'toolName', 'boundary', 'delivery', 'calendar', 'input'],
      result: [
        'toolUseId',
        'toolName',
        'boundary',
        'delivery',
        'calendar',
        'outcome',
        'executedInput',
        'jobId',
        'timing',
        'confirmedTargets',
      ],
      listing: ['complete', 'dropped', 'jobs', 'reference'],
      lifecycle: ['phase'],
      fire: ['target', 'proof', 'turnRef'],
      progress: ['target', 'proof', 'throughNominalAt'],
      restoration: ['target', 'proof', 'status', 'compactionCause'],
      resolution: ['target', 'proof', 'timing'],
    }
    const allowed = ['kind', ...byKind[String(value.kind)]!]
    const fields = Object.fromEntries(
      allowed.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
    )
    for (const key of ['input', 'executedInput'])
      if (fields[key] !== undefined) fields[key] = cleanInput(value[key])
    for (const key of ['proof', 'compactionCause'])
      if (fields[key] !== undefined) fields[key] = pick(value[key], ['kind', 'reference'])
    if (fields.target !== undefined) fields.target = pick(value.target, ['jobId', 'generation'])
    if (fields.calendar !== undefined)
      fields.calendar = pick(value.calendar, ['identity', 'version'])
    if (fields.timing !== undefined)
      fields.timing = pick(value.timing, [
        'provenance',
        'reference',
        'createdAt',
        'originalNominalAt',
      ])
    if (Array.isArray(fields.jobs))
      fields.jobs = fields.jobs.map((job) => pick(job, ['jobId', 'schedule', 'recurring']))
    if (Array.isArray(fields.confirmedTargets))
      fields.confirmedTargets = fields.confirmedTargets.map((row) =>
        pick(row, ['jobId', 'generation']),
      )
    return {
      kind: 'valid',
      observation: JSON.parse(JSON.stringify({ ...base, ...fields })) as ScheduleObservation,
    }
  } catch {
    return { kind: 'invalid', reason: 'unreadable scheduling metadata' }
  }
}

export function emptyScheduleEvidence(): ScheduleEvidenceLedger {
  return {
    schemaVersion: 1,
    revision: 0,
    persistedRevision: 0,
    observations: [],
    conflicts: [],
    placements: [],
  }
}
export function recordScheduleObservation(
  ledger: ScheduleEvidenceLedger,
  value: unknown,
): { ledger: ScheduleEvidenceLedger; accepted: boolean; reason?: string } {
  const validated = validateScheduleObservation(value)
  if (validated.kind !== 'valid') return { ledger, accepted: false, reason: validated.reason }
  const event = validated.observation
  const before = ledger.observations.find(
    (row) => row.eventId === event.eventId && scopeKey(row.scope) === scopeKey(event.scope),
  )
  if (before) {
    if (stable(before) === stable(event)) return { ledger, accepted: true }
    const key = stable([scopeKey(event.scope), event.eventId])
    if (ledger.conflicts.includes(key))
      return { ledger, accepted: false, reason: 'conflicting observation' }
    return {
      ledger: { ...ledger, revision: ledger.revision + 1, conflicts: [...ledger.conflicts, key] },
      accepted: false,
      reason: 'conflicting observation',
    }
  }
  return {
    ledger: {
      ...ledger,
      revision: ledger.revision + 1,
      observations: [...ledger.observations, event],
    },
    accepted: true,
  }
}
export function confirmSchedulePersistence(
  ledger: ScheduleEvidenceLedger,
  acknowledgment: { revision: number; storageReference: string },
): ScheduleEvidenceLedger {
  return acknowledgment.revision === ledger.revision && text(acknowledgment.storageReference)
    ? {
        ...ledger,
        persistedRevision: ledger.revision,
        storageReference: acknowledgment.storageReference,
      }
    : ledger
}
export function validateScheduleEvidenceLedger(
  value: unknown,
): { kind: 'valid'; ledger: ScheduleEvidenceLedger } | { kind: 'invalid'; reason: string } {
  try {
    if (
      !object(value) ||
      value.schemaVersion !== 1 ||
      !integer(value.revision) ||
      !integer(value.persistedRevision) ||
      value.persistedRevision > value.revision ||
      !Array.isArray(value.observations) ||
      !Array.isArray(value.conflicts) ||
      !value.conflicts.every(text) ||
      !Array.isArray(value.placements) ||
      (value.persistedRevision > 0 && !text(value.storageReference))
    )
      return { kind: 'invalid', reason: 'invalid evidence snapshot' }
    const observations: ScheduleObservation[] = []
    for (const row of value.observations) {
      const validated = validateScheduleObservation(row)
      if (validated.kind !== 'valid') return { kind: 'invalid', reason: validated.reason }
      observations.push(validated.observation)
    }
    const placements: ReceiptPlacement[] = []
    for (const row of value.placements) {
      if (
        !object(row) ||
        !text(row.generation) ||
        !text(row.evidenceRevision) ||
        !stamp(row.calendar) ||
        !Array.isArray(row.candidates) ||
        row.candidates.length > 64 ||
        !row.candidates.every(minute) ||
        !['explicit-provider', 'derived-window', 'unknown'].includes(String(row.provenance)) ||
        (row.gapAt !== undefined && !minute(row.gapAt)) ||
        !optionalText(row.reason) ||
        (row.localMinutes !== undefined &&
          (!Array.isArray(row.localMinutes) ||
            row.localMinutes.length !== row.candidates.length ||
            !row.localMinutes.every((n) => n === null || (integer(n) && n < 60))))
      )
        return { kind: 'invalid', reason: 'invalid retained placement' }
      const candidates = row.candidates
      if (candidates.some((at, index) => index > 0 && at <= candidates[index - 1]!))
        return { kind: 'invalid', reason: 'unordered retained placement' }
      const source = row.calendar as CalendarStamp
      placements.push({
        generation: row.generation,
        evidenceRevision: row.evidenceRevision,
        calendar: { identity: source.identity, version: source.version },
        candidates: row.candidates,
        provenance: row.provenance,
        ...(row.localMinutes === undefined ? {} : { localMinutes: row.localMinutes }),
        ...(row.gapAt === undefined ? {} : { gapAt: row.gapAt }),
        ...(row.reason === undefined ? {} : { reason: row.reason }),
      } as ReceiptPlacement)
    }
    if (value.revision === 0 && (observations.length > 0 || placements.length > 0))
      return { kind: 'invalid', reason: 'unversioned evidence' }
    return {
      kind: 'valid',
      ledger: JSON.parse(
        JSON.stringify({
          schemaVersion: 1,
          revision: value.revision,
          persistedRevision: value.persistedRevision,
          storageReference: value.storageReference,
          observations,
          conflicts: value.conflicts,
          placements,
        }),
      ) as ScheduleEvidenceLedger,
    }
  } catch {
    return { kind: 'invalid', reason: 'unreadable evidence snapshot' }
  }
}
function windowOf(call: Call, result: Result): CreationWindow | undefined {
  if (result.timing?.createdAt !== undefined)
    return {
      lo: result.timing.createdAt,
      hi: result.timing.createdAt,
      provenance: 'provider-time',
      clockEra: result.clockEra,
    }
  if (
    call.boundary !== 'pre' ||
    result.boundary !== 'post' ||
    call.delivery !== 'live' ||
    result.delivery !== 'live' ||
    call.clockEra !== result.clockEra ||
    call.order >= result.order ||
    call.observedAt > result.observedAt ||
    stable(call.calendar) !== stable(result.calendar)
  )
    return undefined
  return {
    lo: call.observedAt,
    hi: result.observedAt,
    provenance: 'pre/post-execution-bracket',
    clockEra: call.clockEra,
  }
}
const generationId = (call: Call, jobId: string) =>
  stable([lineageKey(call.scope), jobId, call.scope.sessionId, call.toolUseId, call.eventId])
function matchesTarget(generation: ReceiptGeneration, event: { target: JobTarget }) {
  return (
    event.target.generation === generation.generation && event.target.jobId === generation.jobId
  )
}

function cancellationOperations(
  rows: readonly ScheduleObservation[],
  isConflicted: (row: ScheduleObservation) => boolean,
) {
  const grouped = new Map<string, { calls: Call[]; results: Result[] }>()
  for (const row of rows) {
    if ((row.kind !== 'call' && row.kind !== 'result') || row.toolName !== 'CronDelete') continue
    const key = stable([scopeKey(row.scope), row.toolUseId])
    const group: { calls: Call[]; results: Result[] } = grouped.get(key) ?? {
      calls: [],
      results: [],
    }
    if (row.kind === 'call') group.calls.push(row)
    else group.results.push(row)
    grouped.set(key, group)
  }
  return [...grouped.values()]
    .map(({ calls, results }) => {
      const result = results[0]
      const actual = cancellationTargets(result?.executedInput)
      const consistent =
        new Set(results.map((row) => stable([row.outcome, row.executedInput, row.jobId]))).size ===
        1
      const paired =
        calls.length === 1 &&
        result !== undefined &&
        result.executedInput?.kind === 'cancel' &&
        !isConflicted(calls[0]!) &&
        results.every(
          (row) =>
            !isConflicted(row) &&
            calls[0]!.order < row.order &&
            (row.jobId === undefined || actual.some((item) => item.jobId === row.jobId)),
        ) &&
        consistent
      const requested = paired
        ? actual
        : [
            ...calls.flatMap((row) => cancellationTargets(row.input)),
            ...results.flatMap((row) => cancellationTargets(row.executedInput)),
          ]
      const confirmed =
        paired && result!.outcome === 'success'
          ? results.flatMap((row) => row.confirmedTargets ?? (actual.length === 1 ? actual : []))
          : []
      return {
        requested,
        confirmed,
        failed: paired && result!.outcome === 'failed',
        order: [...calls, ...results].reduce((order, row) => Math.max(order, row.order), 0),
      }
    })
    .sort((a, b) => a.order - b.order)
}

export function receiptGenerations(
  ledger: ScheduleEvidenceLedger,
  scope: ScheduleScope,
): ReceiptGeneration[] {
  const rows = ledger.observations
    .filter((row) => lineageKey(row.scope) === lineageKey(scope))
    .sort((a, b) => a.order - b.order || a.eventId.localeCompare(b.eventId))
  const conflicts = new Set(ledger.conflicts)
  const conflicted = (row: ScheduleObservation) =>
    conflicts.has(stable([scopeKey(row.scope), row.eventId]))
  const generations: ReceiptGeneration[] = []
  for (const row of rows) {
    if (
      row.kind !== 'result' ||
      row.outcome !== 'success' ||
      row.toolName !== 'CronCreate' ||
      row.executedInput?.kind !== 'cron' ||
      row.executedInput.schedule === undefined ||
      row.executedInput.recurring === undefined ||
      row.jobId === undefined
    )
      continue
    const calls = rows.filter(
      (c): c is Call =>
        c.kind === 'call' &&
        scopeKey(c.scope) === scopeKey(row.scope) &&
        c.toolUseId === row.toolUseId &&
        c.toolName === row.toolName,
    )
    if (calls.length !== 1) continue
    const call = calls[0]!
    if (call.order >= row.order) continue
    const id = generationId(call, row.jobId)
    const otherResults = rows.filter(
      (r): r is Result =>
        r.kind === 'result' &&
        scopeKey(r.scope) === scopeKey(row.scope) &&
        r.toolUseId === row.toolUseId &&
        r.toolName === row.toolName,
    )
    const material = (r: Result) =>
      stable([
        r.outcome,
        r.executedInput,
        r.jobId,
        r.timing,
        r.observedAt,
        r.clockEra,
        r.calendar,
        r.boundary,
        r.delivery,
      ])
    const conflict =
      conflicted(call) ||
      otherResults.some(conflicted) ||
      new Set(otherResults.map(material)).size > 1
    if (generations.some((g) => g.generation === id)) continue
    generations.push({
      generation: id,
      scope: row.scope,
      jobId: row.jobId,
      input: row.executedInput,
      creation: { call, result: row },
      creationWindow: windowOf(call, row),
      explicitNominalAt: row.timing?.originalNominalAt,
      conflicted: conflict,
      presence: 'present',
      cancellation: 'none',
      materialRevision: '',
    })
  }
  for (const row of rows) {
    if (conflicted(row)) continue
    if (row.kind === 'listing') {
      for (const generation of generations.filter(
        (g) => (g.creation?.result.order ?? -1) <= row.order,
      )) {
        if (generation.presence === 'fired' || generation.presence === 'cancelled') continue
        const present = row.jobs.some((job) => job.jobId === generation.jobId)
        if (present) {
          generation.presence = 'present'
          generation.lastPresence = row
        } else if (row.complete) {
          generation.presence = 'absent'
          generation.lastPresence = row
        }
      }
      for (const job of row.jobs) {
        if (
          generations.some(
            (g) =>
              g.jobId === job.jobId &&
              g.presence === 'present' &&
              (g.creation?.result.order ?? -1) <= row.order,
          )
        )
          continue
        const id = stable([lineageKey(scope), 'legacy', job.jobId])
        const before = generations.find((g) => g.generation === id)
        if (before) {
          before.presence = 'present'
          before.input = { kind: 'cron', schedule: job.schedule, recurring: job.recurring }
          before.lastPresence = row
        } else
          generations.push({
            generation: id,
            scope: row.scope,
            jobId: job.jobId,
            input: { kind: 'cron', schedule: job.schedule, recurring: job.recurring },
            listedSince: row.observedAt,
            conflicted: false,
            presence: 'present',
            cancellation: 'none',
            lastPresence: row,
            materialRevision: '',
          })
      }
    } else if (
      row.kind === 'fire' ||
      row.kind === 'progress' ||
      row.kind === 'restoration' ||
      row.kind === 'resolution'
    ) {
      for (const g of generations) {
        if (!matchesTarget(g, row) || (g.creation?.result.order ?? -1) > row.order) continue
        if (row.kind === 'fire' && g.creation) {
          g.fire = row
          if (g.input.recurring === false) g.presence = 'fired'
        }
        if (
          row.kind === 'progress' &&
          g.input.recurring === true &&
          !g.conflicted &&
          row.throughNominalAt <= row.observedAt &&
          (g.progress === undefined || row.throughNominalAt >= g.progress.throughNominalAt)
        )
          g.progress = row
        if (row.kind === 'restoration' && g.presence !== 'fired' && g.presence !== 'cancelled') {
          g.restoration = row
          g.presence = row.status === 'present' ? 'present' : 'absent'
          g.lastPresence = row
        }
        if (row.kind === 'resolution' && g.creation) {
          g.conflicted = false
          g.explicitNominalAt = row.timing.originalNominalAt
          if (row.timing.createdAt !== undefined)
            g.creationWindow = {
              lo: row.timing.createdAt,
              hi: row.timing.createdAt,
              provenance: 'provider-time',
              clockEra: row.clockEra,
            }
        }
      }
    }
  }
  for (const operation of cancellationOperations(rows, conflicted)) {
    for (const g of generations) {
      if (
        (g.creation?.result.order ?? -1) > operation.order ||
        !operation.requested.some((item) => matchesTarget(g, { target: item }))
      )
        continue
      if (operation.confirmed.some((item) => matchesTarget(g, { target: item }))) {
        g.cancellation = 'confirmed'
        if (g.presence !== 'fired') g.presence = 'cancelled'
      } else if (g.cancellation !== 'confirmed')
        g.cancellation = operation.failed ? 'failed' : 'unconfirmed'
    }
  }
  for (const g of generations)
    g.materialRevision = stable([
      g.generation,
      g.input,
      g.creationWindow,
      g.explicitNominalAt,
      g.conflicted,
      g.progress?.throughNominalAt,
      g.presence,
      g.restoration?.status,
      g.restoration?.compactionCause?.kind,
    ])
  return generations.filter(
    (g) => g.creation || !generations.some((known) => known.creation && known.jobId === g.jobId),
  )
}

function derivePlacement(
  g: ReceiptGeneration,
  calendar: CalendarSource,
  budget: number,
): ReceiptPlacement {
  const sourceMatches =
    g.creation?.result.calendar.identity === calendar.identity &&
    g.creation.result.calendar.version === calendar.version
  const base = {
    generation: g.generation,
    evidenceRevision: stable([g.creationWindow, g.explicitNominalAt, g.conflicted]),
    calendar: g.creation?.result.calendar ?? {
      identity: calendar.identity,
      version: calendar.version,
    },
  }
  if (g.conflicted)
    return { ...base, candidates: [], provenance: 'unknown', reason: 'conflicting receipt' }
  if (g.explicitNominalAt !== undefined)
    return {
      ...base,
      candidates: [g.explicitNominalAt],
      localMinutes: [
        sourceMatches ? (readCalendarMinute(g.explicitNominalAt, calendar)?.minute ?? null) : null,
      ],
      provenance: 'explicit-provider',
    }
  const window = g.creationWindow
  if (!g.creation || !window || !g.input.schedule || !sourceMatches)
    return {
      ...base,
      candidates: [],
      provenance: 'unknown',
      reason: 'missing creation window or original calendar',
    }
  const candidates: number[] = []
  const localMinutes: number[] = []
  let after = Math.floor(window.lo / MINUTE) * MINUTE,
    inclusive = true,
    remaining = budget,
    gapAt: number | undefined
  for (let count = 0; count < 64 && remaining > 0; count++) {
    const found = nextCronOccurrence(g.input.schedule, {
      after,
      inclusive,
      zone: 'UTC',
      calendar,
      budget: remaining,
    })
    remaining -= found.work
    if (found.kind !== 'known')
      return {
        ...base,
        candidates,
        provenance: 'unknown',
        reason: found.kind + ':' + found.reason,
        gapAt,
      }
    if (found.gapAt !== undefined) gapAt = Math.min(gapAt ?? Infinity, found.gapAt)
    candidates.push(found.nominalAt)
    localMinutes.push(found.localMinute)
    const early = eligibilityBounds(found.nominalAt, g.input.recurring === true, found.localMinute)!
    if (found.nominalAt > window.hi && early.earliestEligibleAt > window.hi)
      return { ...base, candidates, localMinutes, provenance: 'derived-window', gapAt }
    after = found.nominalAt
    inclusive = false
  }
  return { ...base, candidates, provenance: 'unknown', reason: 'placement budget', gapAt }
}
export function recordReceiptPlacements(
  ledger: ScheduleEvidenceLedger,
  calendar: CalendarSource,
  scope: ScheduleScope,
  budget = 20_000,
): ScheduleEvidenceLedger {
  const placements = [...ledger.placements]
  const generations = receiptGenerations(ledger, scope).filter((g) => g.creation)
  for (const g of generations) {
    const revision = stable([g.creationWindow, g.explicitNominalAt, g.conflicted])
    const previous = [...placements]
      .reverse()
      .find((p) => p.generation === g.generation && p.evidenceRevision === revision)
    if (
      previous &&
      !(
        previous.provenance === 'unknown' &&
        previous.reason === 'missing creation window or original calendar' &&
        g.creationWindow &&
        g.creation?.result.calendar.identity === calendar.identity &&
        g.creation.result.calendar.version === calendar.version
      )
    )
      continue
    const placement = derivePlacement(
      g,
      calendar,
      Math.floor(Math.max(0, Math.min(20_000, budget)) / Math.max(1, generations.length)),
    )
    if (!previous || stable(previous) !== stable(placement)) placements.push(placement)
  }
  return placements.length === ledger.placements.length
    ? ledger
    : { ...ledger, revision: ledger.revision + 1, placements }
}

export type ScheduleNotice = {
  id: string
  generation: string
  reason:
    | 'offline-time-passed'
    | 'recurring-offline-interval'
    | 'not-present'
    | 'expired-on-resume'
    | 'compaction-confirmed'
  dueAt: number | null
  message: string
}
export type NoticeDeliveryState = {
  acceptedIds: readonly string[]
  mailbox: readonly ScheduleNotice[]
}
export function acceptScheduleNotices(
  state: NoticeDeliveryState,
  notices: readonly ScheduleNotice[],
  accepted: boolean,
): NoticeDeliveryState {
  if (!accepted) return state
  const acceptedIds = new Set(state.acceptedIds),
    mailbox = [...state.mailbox]
  for (const notice of notices) {
    if (!acceptedIds.has(notice.id) && !mailbox.some((message) => message.id === notice.id))
      mailbox.push(notice)
    acceptedIds.add(notice.id)
  }
  return { acceptedIds: [...acceptedIds], mailbox }
}
export type NominalDisplay = {
  label: 'scheduled' | 'due-unconfirmed' | 'time-unknown' | 'not-present'
  time: string | null
  detail: string
  nominalAt: number | null
  provenance: ReceiptPlacement['provenance'] | 'derived-progress'
}
export function showNominalTime(
  at: number | undefined,
  provenance: NominalDisplay['provenance'],
  calendar: CalendarSource,
  label: NominalDisplay['label'],
): NominalDisplay {
  const fields = at === undefined ? null : readCalendarMinute(at, calendar)
  if (!fields)
    return {
      label: label === 'not-present' ? label : 'time-unknown',
      time: null,
      detail: 'Scheduled time unknown',
      nominalAt: at ?? null,
      provenance,
    }
  const pad = (value: number) => String(value).padStart(2, '0')
  const wall = `${pad(fields.hour)}:${pad(fields.minute)}`
  let time: string
  try {
    time = calendar.format?.(at!) ?? wall
    if (typeof time !== 'string' || time.length === 0) throw new Error('invalid calendar format')
  } catch {
    return {
      label: 'time-unknown',
      time: null,
      detail: 'Calendar formatting unavailable',
      nominalAt: at!,
      provenance,
    }
  }
  return {
    label,
    time,
    nominalAt: at!,
    provenance,
    detail: `${fields.year}-${pad(fields.month)}-${pad(fields.day)} ${wall}; epoch ${at}; ${provenance}; calendar ${calendar.identity}@${calendar.version}`,
  }
}
export type EvidenceJobState = {
  generation: ReceiptGeneration
  placement?: ReceiptPlacement
  pendingNominalAt?: number
  nextNominalAt?: number
  age: 'young' | 'uncertain' | 'expired'
  display: NominalDisplay
  result: JobWakeResult
  actualFireAt?: number
  dueConfirmed: boolean
}
export type ReceiptSchedulePlan = {
  wake: ScheduleWakeResult
  states: readonly EvidenceJobState[]
  notices: readonly ScheduleNotice[]
  unresolvedReceipts: readonly { eventId: string; reason: 'incomplete-creation-receipt' }[]
  currentListing: {
    revision: number
    publishable: boolean
    count: number
    dropped: number
    jobs: readonly {
      job: WakeJob
      cancellation: ReceiptGeneration['cancellation']
      cancellationLabel: string | null
    }[]
  }
  diagnosticRecheck: {
    at: number
    meaning: 'observation-recheck'
    reason: 'schedule-or-notice-evidence-pending'
    evidenceClass: 'conservative-estimate'
    destructive: false
  } | null
}

export function planReceiptSchedule(
  ledger: ScheduleEvidenceLedger,
  scope: ScheduleScope,
  options: {
    now: number
    wakeLeadMs: number
    calendar: CalendarSource
    clockEra: string
    clockContinuous: boolean
    noticeDelivery: NoticeDeliveryState
    budget?: number
  },
): ReceiptSchedulePlan {
  const generations = receiptGenerations(ledger, scope)
  let remaining = Number.isFinite(options.budget ?? 20_000)
    ? Math.floor(Math.max(0, Math.min(20_000, options.budget ?? 20_000)))
    : 0
  const perSearch = Math.floor(remaining / Math.max(1, generations.length * 3))
  const find = (schedule: string, after: number) => {
    const result = nextCronOccurrence(schedule, {
      after,
      inclusive: false,
      calendar: options.calendar,
      budget: Math.min(perSearch, remaining),
    })
    remaining -= result.work
    return result
  }
  const persisted = ledger.revision === ledger.persistedRevision
  const states: EvidenceJobState[] = [],
    notices: ScheduleNotice[] = [],
    jobs: WakeJob[] = [],
    plans: ScheduleWakeResult['plans'] = []
  let startAt: number | null = null
  const rows = ledger.observations
    .filter((row) => lineageKey(row.scope) === lineageKey(scope))
    .sort((a, b) => a.order - b.order)
  const lastListing = [...rows].reverse().find((r) => r.kind === 'listing')
  const dropped = lastListing?.kind === 'listing' ? lastListing.dropped : 0
  if (dropped > 0) startAt = options.now
  const unresolved = rows.filter(
    (r): r is Result =>
      r.kind === 'result' &&
      r.toolName === 'CronCreate' &&
      r.outcome === 'success' &&
      !generations.some(
        (g) =>
          g.creation?.result.toolUseId === r.toolUseId && scopeKey(g.scope) === scopeKey(r.scope),
      ),
  )
  if (unresolved.length > 0) startAt = options.now
  const reconciliations = unresolved.map((row) => ({
    id: stable([scopeKey(row.scope), row.eventId]),
    revision: stable(row),
    startAt: options.now,
  }))
  const addNotice = (
    g: ReceiptGeneration,
    reason: ScheduleNotice['reason'],
    dueAt: number | null,
    message: string,
    material: unknown,
  ) => {
    const id = stable([lineageKey(scope), g.generation, reason, material])
    if (
      !options.noticeDelivery.acceptedIds.includes(id) &&
      !options.noticeDelivery.mailbox.some((n) => n.id === id)
    )
      notices.push({ id, generation: g.generation, reason, dueAt, message })
  }
  for (const g of generations) {
    const placement = [...ledger.placements]
      .reverse()
      .find(
        (p) =>
          p.generation === g.generation &&
          p.evidenceRevision === stable([g.creationWindow, g.explicitNominalAt, g.conflicted]),
      )
    const window = g.creationWindow
    const calendarChanged =
      placement !== undefined &&
      (placement.calendar.identity !== options.calendar.identity ||
        placement.calendar.version !== options.calendar.version)
    if (persisted && calendarChanged && g.presence === 'present' && !g.progress) {
      const id = stable([
        lineageKey(scope),
        g.generation,
        'calendar-context',
        options.calendar.identity,
        options.calendar.version,
      ])
      reconciliations.push({
        id,
        revision: stable([placement.calendar, options.calendar.identity, options.calendar.version]),
        startAt: options.now,
      })
      startAt = options.now
    }
    const continuous = options.clockContinuous && window?.clockEra === options.clockEra
    const age =
      window && continuous
        ? options.now < window.lo + LIFETIME
          ? 'young'
          : options.now > window.hi + LIFETIME
            ? 'expired'
            : 'uncertain'
        : 'uncertain'
    const latestStart = [...rows]
      .reverse()
      .find((r) => r.kind === 'lifecycle' && r.phase === 'started' && r.observedAt <= options.now)
    const expiredOnResume =
      persisted &&
      g.presence === 'present' &&
      g.input.recurring === true &&
      age === 'expired' &&
      latestStart &&
      latestStart.order > (g.creation?.result.order ?? Infinity) &&
      latestStart.clockEra === options.clockEra &&
      latestStart.observedAt > window!.hi + LIFETIME &&
      !(g.lastPresence && g.lastPresence.order > latestStart.order && g.presence === 'present')
    let pending =
      placement?.candidates.length === 1 && placement.provenance !== 'unknown'
        ? placement.candidates[0]
        : undefined
    let gapAt = placement?.gapAt
    let result: JobWakeResult = {
      kind: 'unknown',
      reason: !persisted
        ? 'receipt persistence pending'
        : 'missing or ambiguous original placement',
      startAt: options.now,
    }
    if (persisted && !g.conflicted && g.progress && g.input.schedule) {
      const match = find(g.input.schedule, g.progress.throughNominalAt)
      if (match.kind === 'known') {
        pending = match.nominalAt
        gapAt = match.gapAt
      } else {
        pending = undefined
        result = { ...match, startAt: options.now }
      }
    }
    const candidates = pending === undefined ? (placement?.candidates ?? []) : [pending]
    const envelopes = candidates.map((at, index) => {
      const localMinute = g.progress
        ? readCalendarMinute(at, options.calendar)?.minute
        : calendarChanged
          ? null
          : placement?.localMinutes?.[index]
      return eligibilityBounds(at, g.input.recurring === true, localMinute ?? 0)
    })
    const trustworthyClock =
      options.clockContinuous && g.creation?.result.clockEra === options.clockEra
    if (
      persisted &&
      !g.conflicted &&
      trustworthyClock &&
      candidates.length > 0 &&
      envelopes.every((b) => b !== null)
    ) {
      const earliest = Math.min(...envelopes.map((b) => b!.earliestEligibleAt))
      const wakeAt = Math.max(
        options.now,
        Math.min(earliest, gapAt ?? Infinity) - options.wakeLeadMs,
      )
      if (pending !== undefined)
        result = {
          kind: 'known',
          ...envelopes[0]!,
          startAt: wakeAt,
          ...(gapAt === undefined
            ? {}
            : { reconciliationAt: gapAt, executionUncertainty: 'skipped-local-time' as const }),
        }
      else
        result = {
          kind: 'unknown',
          reason: 'ambiguous creation selection or clock continuity',
          startAt: wakeAt,
        }
    }
    if (!instant(options.now) || !Number.isFinite(options.wakeLeadMs) || options.wakeLeadMs < 0)
      result = { kind: 'unknown', reason: 'invalid planning input', startAt: options.now }
    if (expiredOnResume)
      addNotice(
        g,
        'expired-on-resume',
        pending ?? null,
        'The recorded recurring job is older than its documented lifetime on resume; check whether its work is still needed. Final execution is unconfirmed.',
        window,
      )
    if (persisted && g.presence === 'absent') {
      const compaction = g.restoration?.compactionCause
      const expired = g.restoration?.status === 'expired'
      addNotice(
        g,
        compaction ? 'compaction-confirmed' : expired ? 'expired-on-resume' : 'not-present',
        pending ?? null,
        compaction
          ? 'Independent evidence confirms this recorded job was not restored because of compaction; check whether its work is still needed.'
          : expired
            ? 'Independent evidence reports this recorded recurring job was not restored after expiry; final execution is unconfirmed.'
            : 'This recorded job is no longer present in an authoritative schedule report; its completion or cancellation cause is unconfirmed.',
        ['absence', compaction?.kind ?? null],
      )
    }
    if (
      persisted &&
      g.input.recurring === false &&
      pending !== undefined &&
      pending < options.now &&
      g.presence === 'present' &&
      continuous
    ) {
      const stops = rows.filter(
        (r) =>
          r.kind === 'lifecycle' &&
          r.phase === 'stopped' &&
          r.clockEra === options.clockEra &&
          r.observedAt <= pending,
      )
      const closed = stops.some(
        (stop) =>
          !rows.some(
            (r) =>
              r.kind === 'lifecycle' &&
              r.phase === 'started' &&
              r.order > stop.order &&
              r.clockEra === options.clockEra &&
              r.observedAt <= pending,
          ),
      )
      if (closed)
        addNotice(
          g,
          'offline-time-passed',
          pending,
          'The recorded scheduled time passed while this conversation was closed; check whether the work is still needed. Execution is unconfirmed.',
          [pending, placement?.provenance],
        )
    }
    if (
      persisted &&
      !g.conflicted &&
      continuous &&
      !expiredOnResume &&
      g.presence === 'present' &&
      g.input.recurring === true &&
      g.input.schedule &&
      placement !== undefined &&
      placement.provenance !== 'unknown' &&
      pending !== undefined
    ) {
      let stopped: Extract<ScheduleObservation, { kind: 'lifecycle' }> | undefined
      const intervals: { stoppedAt: number; until: number }[] = []
      for (const row of rows) {
        if (
          row.kind !== 'lifecycle' ||
          row.clockEra !== options.clockEra ||
          row.observedAt > options.now
        )
          continue
        if (row.phase === 'stopped') stopped ??= row
        if (row.phase === 'started' && stopped) {
          intervals.push({ stoppedAt: stopped.observedAt, until: row.observedAt })
          stopped = undefined
        }
      }
      if (stopped) intervals.push({ stoppedAt: stopped.observedAt, until: options.now })
      for (const interval of intervals) {
        const after = Math.max(
          interval.stoppedAt,
          window!.hi,
          g.progress?.throughNominalAt ?? -Infinity,
        )
        let first: number | undefined
        if (pending > after && pending < interval.until) first = pending
        else if (
          placement.calendar.identity === options.calendar.identity &&
          placement.calendar.version === options.calendar.version
        ) {
          const next = find(g.input.schedule, after)
          if (next.kind === 'known' && next.nominalAt < interval.until) first = next.nominalAt
        }
        if (first !== undefined)
          addNotice(
            g,
            'recurring-offline-interval',
            first,
            'One or more recorded recurring occurrences may have been missed while this conversation was stopped; check whether the work is still needed. Eligibility and execution are unconfirmed.',
            [options.clockEra, interval.stoppedAt],
          )
      }
    }
    const removed = persisted && (g.presence !== 'present' || expiredOnResume)
    const label = removed
      ? 'not-present'
      : pending !== undefined && pending <= options.now
        ? 'due-unconfirmed'
        : 'scheduled'
    let nextNominalAt: number | undefined
    if (g.input.recurring === true && g.input.schedule && persisted && g.creation) {
      const next = find(g.input.schedule, options.now)
      if (next.kind === 'known') nextNominalAt = next.nominalAt
    }
    states.push({
      generation: g,
      placement,
      pendingNominalAt: pending,
      nextNominalAt,
      age,
      display: showNominalTime(
        pending,
        g.progress ? 'derived-progress' : (placement?.provenance ?? 'unknown'),
        options.calendar,
        label,
      ),
      result,
      actualFireAt: g.fire?.observedAt,
      dueConfirmed: g.presence === 'fired',
    })
    if (removed) continue
    const job: WakeJob = {
      id: g.jobId,
      schedule: g.input.schedule,
      recurring: g.input.recurring,
      listedSince: g.listedSince,
      evidence: {
        generation: g.generation,
        receiptRevision: stable([g.materialRevision, placement]),
        progressNominalAt: g.progress?.throughNominalAt,
      },
    }
    jobs.push(job)
    plans.push({ job, result })
    startAt = Math.min(startAt ?? Infinity, result.startAt)
  }
  if (notices.length > 0) startAt = options.now
  const wake: ScheduleWakeResult = {
    kept: { jobs, dropped },
    plans,
    missed: [],
    startAt,
    expectBy: null,
    noticeRequests: notices.map((notice) => ({
      id: notice.id,
      revision: notice.id,
      startAt: options.now,
    })),
    reconciliationRequests: reconciliations,
  }
  return {
    wake,
    states,
    notices,
    currentListing: {
      revision: ledger.revision,
      publishable: persisted,
      count: jobs.length,
      dropped,
      jobs: jobs.map((job) => {
        const status = generations.find(
          (g) => g.generation === job.evidence?.generation,
        )!.cancellation
        return {
          job,
          cancellation: status,
          cancellationLabel:
            status === 'unconfirmed'
              ? 'cancellation not confirmed'
              : status === 'failed'
                ? 'cancellation failed'
                : status === 'confirmed'
                  ? 'cancellation confirmed; persistence pending'
                  : null,
        }
      }),
    },
    unresolvedReceipts: unresolved.map((row) => ({
      eventId: row.eventId,
      reason: 'incomplete-creation-receipt',
    })),
    diagnosticRecheck:
      startAt === null
        ? null
        : {
            at: startAt,
            meaning: 'observation-recheck',
            reason: 'schedule-or-notice-evidence-pending',
            evidenceClass: 'conservative-estimate',
            destructive: false,
          },
  }
}

export function dynamicScheduleReceipts(
  ledger: ScheduleEvidenceLedger,
  scope: ScheduleScope,
): {
  generation: string
  input: Extract<SchedulingInput, { kind: 'dynamic' }>
  jobId?: string
  cancelled: boolean
}[] {
  const results = ledger.observations
    .filter(
      (r): r is Result =>
        r.kind === 'result' &&
        lineageKey(r.scope) === lineageKey(scope) &&
        r.outcome === 'success' &&
        r.toolName === 'ScheduleWakeup' &&
        r.executedInput?.kind === 'dynamic',
    )
    .sort((a, b) => a.order - b.order)
  const dynamic: ReturnType<typeof dynamicScheduleReceipts> = []
  for (const result of results) {
    const input = result.executedInput as Extract<SchedulingInput, { kind: 'dynamic' }>
    const calls = ledger.observations.filter(
      (c): c is Call =>
        c.kind === 'call' &&
        scopeKey(c.scope) === scopeKey(result.scope) &&
        c.toolUseId === result.toolUseId &&
        c.toolName === result.toolName,
    )
    const related = ledger.observations.filter(
      (r): r is Result =>
        r.kind === 'result' &&
        scopeKey(r.scope) === scopeKey(result.scope) &&
        r.toolUseId === result.toolUseId &&
        r.toolName === result.toolName,
    )
    const conflict = (r: ScheduleObservation) =>
      ledger.conflicts.includes(stable([scopeKey(r.scope), r.eventId]))
    if (
      calls.length !== 1 ||
      calls[0]!.order >= result.order ||
      conflict(calls[0]!) ||
      related.some(
        (r) => conflict(r) || r.outcome !== 'success' || stable(r.executedInput) !== stable(input),
      )
    )
      continue
    if (input.stop) {
      for (const row of dynamic) if (row.generation === input.targetGeneration) row.cancelled = true
      continue
    }
    const generation = stable([
      lineageKey(scope),
      result.scope.sessionId,
      result.toolUseId,
      calls[0]!.eventId,
    ])
    if (!dynamic.some((row) => row.generation === generation))
      dynamic.push({ generation, input, jobId: result.jobId, cancelled: false })
  }
  return dynamic
}
