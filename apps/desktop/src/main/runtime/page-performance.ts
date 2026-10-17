import { z } from 'zod'
import {
  MAX_PAGE_CLOCK_MS,
  MAX_PAGE_COUNT,
  MAX_PAGE_SAMPLES,
  MAX_SAMPLE_MS,
  PAGE_ATTRIBUTIONS,
  PAGE_COMPONENTS,
  PAGE_INPUTS,
  PAGE_RECEIPT_KIND,
  PAGE_REPORT_SPACING_MS,
  PAGE_SAMPLE_KINDS,
  PAGE_STARVATION_FLOOR_MS,
  PAGE_SURFACES,
  type PageHealth,
  type PagePerformanceReport,
  type PageReportAnswer,
  type PageSample,
} from '../../shared/page-performance'

/**
 * Main's end of the page's own recorder: a report is checked, then written to the stall log with
 * main's pid and the page's renderer pid. It is taken on the window's one command channel before
 * any runtime command is parsed, and it never reaches the host or the database.
 */

const count = z.number().int().min(0).max(MAX_PAGE_COUNT)

const measurements = {
  startMs: z.number().min(0).max(MAX_PAGE_CLOCK_MS),
  durationMs: z.number().min(0).max(MAX_SAMPLE_MS),
  count: z.number().int().min(1).max(MAX_PAGE_COUNT),
  surface: z.enum(PAGE_SURFACES),
  component: z.enum(PAGE_COMPONENTS).nullable(),
  attribution: z.enum(PAGE_ATTRIBUTIONS),
  input: z.enum(PAGE_INPUTS),
  conversation: count.nullable(),
  loadedItems: count.nullable(),
  fileCount: count.nullable(),
  contextUsed: count.nullable(),
}

const sampleSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...measurements,
    kind: z.enum(PAGE_SAMPLE_KINDS.filter((kind) => kind !== 'starved')),
  }),
  z.strictObject({
    ...measurements,
    kind: z.literal('starved'),
    timerLateMs: z.number().min(PAGE_STARVATION_FLOOR_MS).max(MAX_SAMPLE_MS),
    frameLateMs: z.number().min(0).max(MAX_SAMPLE_MS),
  }),
]) satisfies z.ZodType<PageSample>

const reportSchema = z.strictObject({
  kind: z.literal(PAGE_RECEIPT_KIND),
  version: z.literal(1),
  sequence: count,
  visibility: z.enum(['visible', 'hidden']),
  samples: z.array(sampleSchema).max(MAX_PAGE_SAMPLES),
  health: z.strictObject({ observing: z.boolean(), entries: count, probes: count }).nullable(),
  dropped: count,
}) satisfies z.ZodType<PagePerformanceReport>

/** Whether this command is the page's report rather than a runtime command. */
export function isAPageReport(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { kind?: unknown }).kind === PAGE_RECEIPT_KIND
  )
}

/** The part of an IPC event the receipt reads: which page sent it, and from which frame. */
export interface PageReportSender {
  readonly sender: {
    readonly id: number
    isDestroyed(): boolean
    getOSProcessId(): number
  }
  readonly senderFrame: { readonly parent: unknown } | null
}

/** What the page last said about its recorder, for main's health line. */
export interface PageRecorderHeard {
  readonly rendererPid: number
  readonly at: number
  readonly reports: number
  readonly health: PageHealth | null
  readonly dropped: number
}

/** The receipt: takes reports, and says what it last heard for the health line. */
export interface PageReceipt {
  take(event: PageReportSender, raw: unknown): PageReportAnswer
  /** What the page said since the last call, then starts afresh; `null` when nothing came. */
  takeHeard(): PageRecorderHeard | null
}

export function aPageReceipt(deps: {
  readonly closing: () => boolean
  readonly log: (line: string) => void
  /** The page's visibility, as it reported it: a covered window is out of sight. */
  readonly visibility?: (visible: boolean) => void
  readonly now?: () => number
}): PageReceipt {
  const now = deps.now ?? (() => performance.now())
  const lastFrom = new Map<number, number>()
  let heard: PageRecorderHeard | null = null
  return {
    take(event, raw) {
      if (deps.closing()) return { recorded: false, why: 'closing' }
      if (event.sender.isDestroyed() || event.senderFrame === null) {
        return { recorded: false, why: 'not-the-page' }
      }
      if (event.senderFrame.parent !== null) return { recorded: false, why: 'not-the-page' }
      // Bounded before parsing: a schema checks an array's length only after every element.
      const samples = (raw as { samples?: unknown }).samples
      if (!Array.isArray(samples) || samples.length > MAX_PAGE_SAMPLES) {
        return { recorded: false, why: 'malformed' }
      }
      const parsed = reportSchema.safeParse(raw)
      if (!parsed.success) return { recorded: false, why: 'malformed' }
      // Applied even to a report that comes too soon: the page's sight is one word, and the latest.
      deps.visibility?.(parsed.data.visibility === 'visible')
      const at = now()
      const last = lastFrom.get(event.sender.id)
      if (last !== undefined && at - last < PAGE_REPORT_SPACING_MS) {
        return { recorded: false, why: 'too-soon' }
      }
      lastFrom.set(event.sender.id, at)
      const report = parsed.data
      const rendererPid = event.sender.getOSProcessId()
      heard = {
        rendererPid,
        at,
        reports: (heard?.reports ?? 0) + 1,
        health: report.health ?? heard?.health ?? null,
        dropped: (heard?.dropped ?? 0) + report.dropped,
      }
      const page = `page renderer ${String(rendererPid)} window ${String(event.sender.id)}`
      for (const sample of report.samples) deps.log(`${page} ${aPageSampleSays(sample)}`)
      return { recorded: true }
    },
    takeHeard() {
      const taken = heard
      heard = null
      return taken
    },
  }
}

/** One sample, in the stall log's words. */
export function aPageSampleSays(sample: PageSample): string {
  const what =
    sample.kind === 'starved'
      ? `starved while hidden; timer late ${String(Math.round(sample.timerLateMs))} ms; ` +
        `frame late ${String(Math.round(sample.frameLateMs))} ms`
      : sample.kind === 'task-burst'
        ? `${String(sample.count)} tasks taking ${String(Math.round(sample.durationMs))} ms in all`
        : `${sample.kind} ${String(Math.round(sample.durationMs))} ms`
  const parts = [what, `surface ${sample.surface}`]
  if (sample.component !== null) parts.push(`component ${sample.component} (${sample.attribution})`)
  if (sample.conversation !== null) parts.push(`conversation ${String(sample.conversation)}`)
  if (sample.loadedItems !== null) parts.push(`loaded items ${String(sample.loadedItems)}`)
  if (sample.fileCount !== null) parts.push(`files ${String(sample.fileCount)}`)
  if (sample.contextUsed !== null) parts.push(`context used ${String(sample.contextUsed)}`)
  parts.push(`input ${sample.input}`, `page clock ${String(Math.round(sample.startMs))}`)
  return parts.join('; ')
}

/** What the page's recorder said in a health period, for the end of main's health line. */
export function pageHeardSays(heard: PageRecorderHeard | null, at: number): string {
  if (heard === null) return 'the page did not report'
  const health =
    heard.health === null
      ? ''
      : `, ${heard.health.observing ? 'observing' : 'not observing'} long tasks, ` +
        `${String(heard.health.entries)} entries, ${String(heard.health.probes)} frame probes`
  return (
    `the page (renderer ${String(heard.rendererPid)}) reported ${String(heard.reports)} ` +
    `${heard.reports === 1 ? 'time' : 'times'}, last ${String(Math.round((at - heard.at) / 1000))} s ago` +
    health +
    (heard.dropped > 0 ? `, ${String(heard.dropped)} samples left out` : '')
  )
}
