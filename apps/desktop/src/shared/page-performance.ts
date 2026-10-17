/**
 * What the window's page reports about its own freezes, and the bounds main holds it to.
 *
 * The page times its long tasks and the gaps between its frames; main writes each report to the
 * stall log beside its own stalls, with its pid and the page's. A report carries numbers and words
 * from the fixed lists below and nothing else: no text from a conversation, no path, no title.
 */

/** The kind a report travels under, on the window's one command channel. */
export const PAGE_RECEIPT_KIND = 'recordPagePerformance'

/** The most samples one report carries; the page folds the rest into `dropped`. */
export const MAX_PAGE_SAMPLES = 5

/** The longest freeze a sample may report, in ms. */
export const MAX_SAMPLE_MS = 600_000

/** The largest page clock a sample may carry, in ms since the page loaded (about a year). */
export const MAX_PAGE_CLOCK_MS = 3.2e10

/** The largest count any field may carry. */
export const MAX_PAGE_COUNT = 1_000_000_000

/** How often main takes a report from one page; one sooner is answered `too-soon`. */
export const PAGE_REPORT_SPACING_MS = 1_000

/** A hidden timer must be at least this late before the page reports starvation. */
export const PAGE_STARVATION_FLOOR_MS = 1_000

/** What a sample measured: tasks, frames, or callbacks held back while hidden. */
export const PAGE_SAMPLE_KINDS = ['long-task', 'frame-gap', 'task-burst', 'starved'] as const

/** The page's surface when it froze. */
export const PAGE_SURFACES = [
  'bootstrap',
  'waiting',
  'away',
  'sessions',
  'reading',
  'tools',
  'team',
  'providers',
  'conversation',
  'launcher',
  'other',
] as const

/** The part of the page known to have run, or that was on screen. */
export const PAGE_COMPONENTS = [
  'TranscriptView',
  'ConversationPane',
  'SideRail',
  'WaitingOnYou',
  'markdown',
  'replay',
  'other',
] as const

/** How the sample's component was found: timed around it, or only on screen at the time. */
export const PAGE_ATTRIBUTIONS = ['explicit-span', 'active-view', 'unknown'] as const

/** What the person did last before it. */
export const PAGE_INPUTS = ['scroll', 'pointer', 'key', 'resize', 'none', 'unknown'] as const

export type PageSampleKind = (typeof PAGE_SAMPLE_KINDS)[number]
export type PageSurface = (typeof PAGE_SURFACES)[number]
export type PageComponent = (typeof PAGE_COMPONENTS)[number]
export type PageAttribution = (typeof PAGE_ATTRIBUTIONS)[number]
export type PageInput = (typeof PAGE_INPUTS)[number]

interface PageSampleMeasurements {
  /** The page's clock when it began (`performance.now()`). */
  readonly startMs: number
  readonly durationMs: number
  /** How many tasks it folds: 1 for one long task. */
  readonly count: number
  readonly surface: PageSurface
  readonly component: PageComponent | null
  readonly attribution: PageAttribution
  readonly input: PageInput
  /** A number the page gave the conversation on screen for this run, never its id or its name. */
  readonly conversation: number | null
  /** How many transcript items the page had loaded, if a conversation was on screen. */
  readonly loadedItems: number | null
  readonly fileCount: number | null
  /** The context the provider last reported in use. */
  readonly contextUsed: number | null
}

export type PageSample = PageSampleMeasurements &
  (
    | { readonly kind: Exclude<PageSampleKind, 'starved'> }
    | {
        readonly kind: 'starved'
        readonly timerLateMs: number
        readonly frameLateMs: number
      }
  )

/** The page's recorder, counted since its last report, so a quiet page is known to be watched. */
export interface PageHealth {
  /** Whether the page's browser supports the long-task observer. */
  readonly observing: boolean
  readonly entries: number
  readonly probes: number
}

export interface PagePerformanceReport {
  readonly kind: typeof PAGE_RECEIPT_KIND
  readonly version: 1
  readonly sequence: number
  readonly visibility: 'visible' | 'hidden'
  readonly samples: readonly PageSample[]
  readonly health: PageHealth | null
  /** Samples the page left out, under its own caps, since its last report. */
  readonly dropped: number
}

/** What main did with a report. */
export type PageReportAnswer =
  | { readonly recorded: true }
  | {
      readonly recorded: false
      readonly why: 'closing' | 'not-the-page' | 'malformed' | 'too-soon'
    }
