const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const MAX_LATENESS = 30 * MINUTE
const EARLY_ONE_SHOT = 90_000
const MAX_WORK = 20_000

type Field = { values: readonly number[]; unrestricted: boolean; starOrigin: boolean }
export type ParsedCron = {
  minute: Field
  hour: Field
  day: Field
  month: Field
  weekday: Field
}
export type CronParseResult =
  { kind: 'valid'; cron: ParsedCron } | { kind: 'invalid' | 'unsupported'; reason: string }

function parseField(text: string, min: number, max: number, dayField: boolean): Field | string {
  if (dayField && text.includes('*') && text.includes(',')) return 'unsupported:mixed star day list'
  const values = new Set<number>()
  for (const item of text.split(',')) {
    if (item.startsWith('+')) return 'unsupported:leading sign'
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item)
    if (!match) return 'invalid:field syntax'
    const base = match[1]!
    const stepText = match[2]
    const numbers = item.match(/\d+/g) ?? []
    if (numbers.some((n) => n.length > 1 && n.startsWith('0'))) return 'unsupported:leading zeros'
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isSafeInteger(step) || step <= 0) return 'invalid:step'
    if (step > max) return 'unsupported:step outside field domain'
    if (stepText !== undefined && base !== '*' && !base.includes('-'))
      return 'unsupported:single value step'
    const [first, last] = base === '*' ? [min, max] : base.split('-').map(Number)
    const end = last ?? first!
    if (!Number.isSafeInteger(first) || first! < min || end > max || end < min || first! > max)
      return 'invalid:field domain'
    if (first! > end) return 'unsupported:descending range'
    for (let value = first!; value <= end; value += step) values.add(value)
  }
  return {
    values: [...values].sort((a, b) => a - b),
    unrestricted: text === '*',
    starOrigin: text.startsWith('*'),
  }
}

export function parseCron(expression: string): CronParseResult {
  if (expression.length > 4096) return { kind: 'unsupported', reason: 'expression size' }
  if (expression.trim().startsWith('@'))
    return { kind: 'unsupported', reason: 'special cron string' }
  const parts = expression.trim().split(/[ \t]+/)
  if (parts.length !== 5) return { kind: 'invalid', reason: 'five fields required' }
  if (parts.some((p) => /[A-Za-z?@#]/.test(p)))
    return { kind: 'unsupported', reason: 'numeric cron subset only' }
  const domains = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const
  const fields: Field[] = []
  for (let index = 0; index < parts.length; index++) {
    const [min, max] = domains[index]!
    const field = parseField(parts[index]!, min, max, index === 2 || index === 4)
    if (typeof field === 'string') {
      const [kind, reason] = field.split(':')
      return { kind: kind as 'invalid' | 'unsupported', reason: reason! }
    }
    if (index === 4) {
      field.values = [...new Set(field.values.map((value) => value % 7))].sort((a, b) => a - b)
    }
    fields.push(field)
  }
  const [minute, hour, day, month, weekday] = fields as [Field, Field, Field, Field, Field]
  return { kind: 'valid', cron: { minute, hour, day, month, weekday } }
}

export type LocalMinute = {
  year: number
  month: number
  day: number
  weekday: number
  hour: number
  minute: number
  second: number
}

// CalendarSource is the host authority. Its month convention is normalized here,
// and identity/version let callers invalidate their own cached admissions.
export type CalendarSource = {
  identity: string
  version: string
  monthBase: 0 | 1
  read(at: number): LocalMinute | null
  format?(at: number): string
}

export function readCalendarMinute(at: number, calendar: CalendarSource): LocalMinute | null {
  if (
    !Number.isSafeInteger(at) ||
    !Number.isFinite(new Date(at).getTime()) ||
    !calendar ||
    typeof calendar.identity !== 'string' ||
    !calendar.identity ||
    typeof calendar.version !== 'string' ||
    !calendar.version ||
    (calendar.monthBase !== 0 && calendar.monthBase !== 1)
  )
    return null
  try {
    const raw = calendar.read(at)
    if (!raw) return null
    const fields: LocalMinute = {
      year: raw.year,
      month: raw.month + (calendar.monthBase === 0 ? 1 : 0),
      day: raw.day,
      weekday: raw.weekday,
      hour: raw.hour,
      minute: raw.minute,
      second: raw.second,
    }
    if (
      Object.values(fields).some((value) => !Number.isInteger(value)) ||
      fields.year < 100 ||
      fields.year > 9998 ||
      fields.month < 1 ||
      fields.month > 12 ||
      fields.day < 1 ||
      fields.day > 31 ||
      fields.weekday < 0 ||
      fields.weekday > 6 ||
      fields.hour < 0 ||
      fields.hour > 23 ||
      fields.minute < 0 ||
      fields.minute > 59 ||
      fields.second < 0 ||
      fields.second > 59
    )
      return null
    const wallAt = Date.UTC(
      fields.year,
      fields.month - 1,
      fields.day,
      fields.hour,
      fields.minute,
      fields.second,
    )
    const checked = utcParts(wallAt)
    if (
      Object.keys(fields).some(
        (key) => fields[key as keyof LocalMinute] !== checked[key as keyof LocalMinute],
      )
    )
      return null
    const offset = wallAt - Math.floor(at / 1000) * 1000
    if (!Number.isFinite(offset) || Math.abs(offset) >= DAY || offset % MINUTE !== 0) return null
    return fields
  } catch {
    return null
  }
}

export function formatCalendarTime(calendar: CalendarSource, at: number): string | null {
  const fields = readCalendarMinute(at, calendar)
  if (!fields) return null
  try {
    if (calendar.format) {
      const text = calendar.format(at)
      return typeof text === 'string' && text.length > 0 ? text : null
    }
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${String(fields.year).padStart(4, '0')}-${pad(fields.month)}-${pad(fields.day)} ${pad(fields.hour)}:${pad(fields.minute)}`
  } catch {
    return null
  }
}

function utcParts(at: number): LocalMinute {
  const date = new Date(at)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  }
}

export function createIntlCalendar(zone: string): CalendarSource {
  const source = { identity: `Intl:${zone}`, version: 'runtime', monthBase: 1 as const }
  if (zone === 'UTC') return { ...source, read: utcParts }
  const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  })
  const read = (at: number): LocalMinute => {
    const fields = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, p.value]))
    const year = Number(fields.year),
      month = Number(fields.month),
      day = Number(fields.day)
    return {
      year,
      month,
      day,
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
      hour: Number(fields.hour),
      minute: Number(fields.minute),
      second: Number(fields.second),
    }
  }
  return { ...source, read }
}

function dateMatches(cron: ParsedCron, date: LocalMinute): boolean {
  if (!cron.month.values.includes(date.month)) return false
  const day = cron.day.values.includes(date.day)
  const weekday = cron.weekday.values.includes(date.weekday)
  return cron.day.starOrigin || cron.weekday.starOrigin ? day && weekday : day || weekday
}

export function cronMatches(cron: ParsedCron, date: LocalMinute): boolean {
  return (
    date.second === 0 &&
    dateMatches(cron, date) &&
    cron.hour.values.includes(date.hour) &&
    cron.minute.values.includes(date.minute)
  )
}

function impossible(cron: ParsedCron): boolean {
  if (!cron.day.starOrigin && !cron.weekday.starOrigin) return false
  const longestMonths = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return !cron.month.values.some((month) =>
    cron.day.values.some((day) => day <= longestMonths[month - 1]!),
  )
}

export type OccurrenceResult =
  | {
      kind: 'known'
      nominalAt: number
      localMinute: number
      crossedOffsetChange: boolean
      gapAt?: number
      work: number
    }
  | { kind: 'impossible'; reason: string; work: number }
  | { kind: 'unknown'; reason: string; work: number; gapAt?: number }

export function nextCronOccurrence(
  expression: string,
  options: {
    after: number
    inclusive: boolean
    zone?: string
    calendar?: CalendarSource
    budget?: number
    horizonAt?: number
  },
): OccurrenceResult {
  const parsed = parseCron(expression)
  if (parsed.kind !== 'valid')
    return { kind: 'unknown', reason: parsed.kind + ':' + parsed.reason, work: 0 }
  if (impossible(parsed.cron))
    return { kind: 'impossible', reason: 'empty calendar constraint', work: 0 }
  if (
    !Number.isFinite(options.after) ||
    !Number.isFinite(options.budget ?? MAX_WORK) ||
    !Number.isFinite(options.horizonAt ?? options.after)
  )
    return { kind: 'unknown', reason: 'invalid search bound', work: 0 }
  let calendar: CalendarSource
  try {
    calendar = options.calendar ?? createIntlCalendar(options.zone ?? 'UTC')
  } catch {
    return { kind: 'unknown', reason: 'invalid zone', work: 0 }
  }
  const budget = Math.max(0, Math.min(MAX_WORK, Math.floor(options.budget ?? MAX_WORK)))
  let work = 0
  let at =
    (options.inclusive
      ? Math.ceil(options.after / MINUTE)
      : Math.floor(options.after / MINUTE) + 1) * MINUTE
  let previousOffset: number | undefined
  let previousAt: number | undefined
  let gapAt: number | undefined
  let crossedOffsetChange = false
  const unknown = (reason: string): OccurrenceResult => ({
    kind: 'unknown',
    reason,
    work,
    ...(gapAt === undefined ? {} : { gapAt }),
  })
  const inspect = (instant: number): LocalMinute | null => {
    if (work >= budget) return null
    work++
    const local = readCalendarMinute(instant, calendar)
    if (!local) return null
    const offset =
      Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
      instant
    if (!Number.isFinite(offset) || Math.abs(offset) >= DAY || local.second !== 0) return null
    if (previousOffset !== undefined && offset !== previousOffset) crossedOffsetChange = true
    // Only adjacent inspected instants locate a transition exactly. Sparse-day
    // jumps cannot claim a transition time from the two endpoint offsets.
    if (
      gapAt === undefined &&
      previousOffset !== undefined &&
      previousAt === instant - MINUTE &&
      offset > previousOffset
    ) {
      for (
        let wallAt = previousAt + previousOffset + MINUTE;
        wallAt < instant + offset;
        wallAt += MINUTE
      ) {
        if (work >= budget) return null
        work++ // Skipped wall-minute inspections share the conversion budget.
        if (cronMatches(parsed.cron, utcParts(wallAt))) {
          gapAt = instant
          break
        }
      }
    }
    previousOffset = offset
    previousAt = instant
    return local
  }
  while (work < budget) {
    if (at > (options.horizonAt ?? Infinity)) return unknown('horizon')
    const utc = utcParts(at)
    if (!Number.isFinite(utc.year) || utc.year < 100 || utc.year > 9998)
      return unknown('calendar range')
    if (work === 0) {
      const before = at - MINUTE
      const beforeYear = utcParts(before).year
      if (beforeYear >= 100 && beforeYear <= 9998 && !inspect(before))
        return unknown(work >= budget ? 'budget' : 'zone precision or offset')
    }
    const start = Math.floor(at / DAY) * DAY
    const first = inspect(at)
    if (!first) return unknown(work >= budget ? 'budget' : 'zone precision or offset')
    const inspectedAt = at
    // A supported local date is within one day of its UTC date. Only inspect minutes on
    // UTC days adjacent to a possible local date; sparse calendars skip whole days.
    if (![-1, 0, 1].some((shift) => dateMatches(parsed.cron, utcParts(start + shift * DAY)))) {
      at = start + DAY
      continue
    }
    while (at < start + DAY) {
      if (at > (options.horizonAt ?? Infinity)) return unknown('horizon')
      const local = at === inspectedAt ? first : inspect(at)
      if (!local) return unknown(work >= budget ? 'budget' : 'zone precision or offset')
      if (cronMatches(parsed.cron, local))
        return {
          kind: 'known',
          nominalAt: at,
          localMinute: local.minute,
          crossedOffsetChange,
          ...(gapAt === undefined ? {} : { gapAt }),
          work,
        }
      at += MINUTE
    }
  }
  return unknown('budget')
}

export type Eligibility = {
  nominalAt: number
  earliestEligibleAt: number
  latestEligibleAt: number
}

export function eligibilityBounds(
  nominalAt: number,
  recurring: boolean,
  localMinute: number,
  uniformIntervalMs?: number,
): Eligibility | null {
  if (
    !Number.isSafeInteger(nominalAt) ||
    nominalAt % MINUTE !== 0 ||
    !Number.isInteger(localMinute) ||
    localMinute < 0 ||
    localMinute > 59 ||
    (uniformIntervalMs !== undefined &&
      (!Number.isFinite(uniformIntervalMs) || uniformIntervalMs < MINUTE))
  )
    return null
  const early = !recurring && (localMinute === 0 || localMinute === 30) ? EARLY_ONE_SHOT : 0
  const late = recurring ? Math.min(MAX_LATENESS, (uniformIntervalMs ?? 2 * MAX_LATENESS) / 2) : 0
  return { nominalAt, earliestEligibleAt: nominalAt - early, latestEligibleAt: nominalAt + late }
}

export function eligibilityWithOffset(bounds: Eligibility, offsetMs: number): number | null {
  const at = bounds.nominalAt + offsetMs
  return Number.isFinite(offsetMs) &&
    at >= bounds.earliestEligibleAt &&
    at <= bounds.latestEligibleAt
    ? at
    : null
}

function uniformInterval(cron: ParsedCron, zone: string): number | undefined {
  if (
    zone !== 'UTC' ||
    !cron.day.unrestricted ||
    !cron.weekday.unrestricted ||
    cron.month.values.length !== 12
  )
    return undefined
  const minutes = cron.hour.values.flatMap((hour) =>
    cron.minute.values.map((minute) => hour * 60 + minute),
  )
  const gaps = minutes.map(
    (value, index) =>
      minutes[(index + 1) % minutes.length]! + (index === minutes.length - 1 ? 1440 : 0) - value,
  )
  return gaps.every((gap) => gap === gaps[0]) ? gaps[0]! * MINUTE : undefined
}

export type WakeJob = {
  id: string
  schedule?: string
  recurring?: boolean
  prompt?: string
  listedSince?: number | string | null
  // Supply these only from independently recorded provider receipts, never from a listing.
  evidence?: {
    createdAt?: number
    originalNominalAt?: number
    dropped?: { why: 'its-time-passed' | 'made-before-a-compaction'; dueAt: number | null }
    selfPaced?: boolean
    conflictingReceipts?: boolean
    generation?: string
    receiptRevision?: string
    progressNominalAt?: number
  }
}
export type JobWakeResult =
  | ({
      kind: 'known'
      startAt: number
      reconciliationAt?: number
      executionUncertainty?: 'skipped-local-time'
    } & Eligibility)
  | { kind: 'unknown' | 'impossible'; reason: string; startAt: number }

export function planJobWake(
  job: WakeJob,
  options: {
    now: number
    wakeLeadMs: number
    zone: string
    budget?: number
    calendar?: CalendarSource
  },
): JobWakeResult {
  const unknown = (reason: string): JobWakeResult => ({
    kind: 'unknown',
    reason,
    startAt: options.now,
  })
  if (
    !Number.isSafeInteger(options.now) ||
    !Number.isFinite(options.wakeLeadMs) ||
    options.wakeLeadMs < 0
  )
    return unknown('invalid planning input')
  if (job.evidence?.conflictingReceipts) return unknown('conflicting timing receipts')
  if (job.evidence?.selfPaced) return unknown('self-paced restoration')
  if (job.recurring === undefined || job.schedule === undefined)
    return unknown('missing schedule or recurrence')
  const parsed = parseCron(job.schedule)
  if (parsed.kind !== 'valid') return unknown(parsed.kind + ':' + parsed.reason)
  if (impossible(parsed.cron))
    return { kind: 'impossible', reason: 'empty calendar constraint', startAt: options.now }
  let bounds: Eligibility | null
  let gapAt: number | undefined
  if (!job.recurring) {
    const original = job.evidence?.originalNominalAt
    if (original === undefined) return unknown('missing original occurrence')
    const match = nextCronOccurrence(job.schedule, {
      after: original,
      inclusive: true,
      zone: options.zone,
      budget: options.budget,
      horizonAt: original,
      calendar: options.calendar,
    })
    if (match.kind !== 'known' || match.nominalAt !== original)
      return unknown('original occurrence does not match current calendar')
    bounds = eligibilityBounds(original, false, match.localMinute)
    if (!bounds || options.now >= bounds.earliestEligibleAt)
      return unknown('one-shot restore cutoff')
  } else {
    const created = job.evidence?.createdAt
    if (created === undefined || !Number.isSafeInteger(created) || created > options.now)
      return unknown('missing trusted creation time')
    const expiry = created + 7 * DAY
    if (options.now >= expiry) return unknown('expiry ordering')
    const match = nextCronOccurrence(job.schedule, {
      after: created,
      inclusive: true,
      zone: options.zone,
      budget: options.budget,
      calendar: options.calendar,
    })
    if (match.kind !== 'known') return { ...match, startAt: options.now }
    gapAt = match.gapAt
    if (match.nominalAt >= expiry) return unknown('expiry ordering')
    bounds = eligibilityBounds(
      match.nominalAt,
      true,
      match.localMinute,
      uniformInterval(parsed.cron, options.calendar ? '' : options.zone),
    )
  }
  if (!bounds) return unknown('invalid eligibility input')
  return {
    kind: 'known',
    ...bounds,
    startAt: Math.max(
      options.now,
      Math.min(bounds.earliestEligibleAt, gapAt ?? Infinity) - options.wakeLeadMs,
    ),
    ...(gapAt === undefined
      ? {}
      : { reconciliationAt: gapAt, executionUncertainty: 'skipped-local-time' as const }),
  }
}

export type ScheduleLevel = { readonly jobs: readonly WakeJob[]; readonly dropped: number }
export type ScheduleReportInput = { readonly jobs?: readonly WakeJob[]; readonly dropped?: number }
export type ScheduleWakeResult = {
  kept: ScheduleLevel
  missed: {
    job: WakeJob
    dueAt: number | null
    why: 'its-time-passed' | 'made-before-a-compaction'
  }[]
  startAt: number | null
  expectBy: null
  plans: { job: WakeJob; result: JobWakeResult }[]
  noticeRequests?: readonly { id: string; revision: string; startAt: number }[]
  reconciliationRequests?: readonly { id: string; revision: string; startAt: number }[]
}

function shortfall(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 1
}

function normalizedLevel(input: ScheduleLevel | ScheduleReportInput): ScheduleLevel {
  const jobs: WakeJob[] = []
  if (!input || typeof input !== 'object') return { jobs, dropped: 1 }
  let dropped = shortfall(input.dropped)
  if (!Array.isArray(input.jobs)) return { jobs, dropped: Math.max(1, dropped) }
  for (const job of input.jobs) {
    if (
      !job ||
      typeof job.id !== 'string' ||
      (job.schedule !== undefined && typeof job.schedule !== 'string') ||
      (job.recurring !== undefined && typeof job.recurring !== 'boolean')
    ) {
      dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1)
      continue
    }
    jobs.push(job)
  }
  return { jobs, dropped }
}

export function whatAStartBringsBack(
  input: ScheduleLevel | ScheduleReportInput,
  _lastBegan: number | string | null,
  now: number,
  wakeLeadMs: number,
  _compactedAt: number | string | null = null,
  options: { zone?: string; budget?: number; calendar?: CalendarSource } = {},
): ScheduleWakeResult {
  void _compactedAt
  const level = normalizedLevel(input)
  const keptJobs: WakeJob[] = []
  const missed: ScheduleWakeResult['missed'] = []
  const plans: { job: WakeJob; result: JobWakeResult }[] = []
  let startAt: number | null = level.dropped > 0 ? now : null
  const zone = options.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const budget = Math.floor(
    Math.min(MAX_WORK, options.budget ?? MAX_WORK) / Math.max(1, level.jobs.length),
  )
  for (const job of level.jobs) {
    if (job.evidence?.dropped) {
      missed.push({ job, ...job.evidence.dropped })
      startAt = now
      continue
    }
    keptJobs.push(job)
    const result = planJobWake(job, { now, wakeLeadMs, zone, budget, calendar: options.calendar })
    plans.push({ job, result })
    startAt = startAt === null ? result.startAt : Math.min(startAt, result.startAt)
  }
  // Eligibility says nothing about how long a busy provider takes to report restored work.
  return {
    kept: { jobs: keptJobs, dropped: level.dropped },
    missed,
    startAt,
    expectBy: null,
    plans,
  }
}

export function oneShotsThatCameDue(
  _level: ScheduleLevel | ScheduleReportInput,
  _at: number,
): { job: WakeJob; dueAt: number }[] {
  // A turn's timestamp alone cannot identify the job that caused it.
  void _level
  void _at
  return []
}

export function reconcileScheduleReport(
  previous: ScheduleLevel,
  report: ScheduleReportInput,
): ScheduleLevel {
  if (report.jobs === undefined)
    return { ...previous, dropped: shortfall(report.dropped ?? previous.dropped) }
  const next = normalizedLevel({ ...report, dropped: report.dropped ?? 0 })
  const old = new Map(previous.jobs.map((job) => [job.id, job]))
  const jobs = next.jobs.map((job) => {
    const before = old.get(job.id)
    if (!before) return job
    if (before.schedule !== job.schedule || before.recurring !== job.recurring)
      return { ...job, listedSince: before.listedSince }
    if (!before.evidence && !job.evidence) return { ...job, listedSince: before.listedSince }
    const conflictingReceipts =
      before.evidence?.conflictingReceipts ||
      job.evidence?.conflictingReceipts ||
      (['createdAt', 'originalNominalAt'] as const).some(
        (key) =>
          before.evidence?.[key] !== undefined &&
          job.evidence?.[key] !== undefined &&
          before.evidence[key] !== job.evidence[key],
      )
    return {
      ...job,
      listedSince: before.listedSince,
      evidence: {
        ...job.evidence,
        ...before.evidence,
        dropped: job.evidence?.dropped,
        ...(conflictingReceipts ? { conflictingReceipts: true } : {}),
      },
    }
  })
  if (next.dropped > 0) {
    const listed = new Set(jobs.map((job) => job.id))
    jobs.push(...previous.jobs.filter((job) => !listed.has(job.id)))
  }
  return { jobs, dropped: next.dropped }
}
