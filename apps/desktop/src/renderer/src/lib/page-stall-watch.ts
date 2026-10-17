import {
  MAX_PAGE_CLOCK_MS,
  MAX_PAGE_COUNT,
  MAX_PAGE_SAMPLES,
  MAX_SAMPLE_MS,
  PAGE_RECEIPT_KIND,
  PAGE_REPORT_SPACING_MS,
  PAGE_STARVATION_FLOOR_MS,
  type PageInput,
  type PagePerformanceReport,
  type PageReportAnswer,
  type PageSample,
  type PageSurface,
} from '../../../shared/page-performance'

const HEALTH_MS = 30_000
const ACTIVE_MS = 5_000
const TASK_MS = 200
const BURST_MS = 500
const FRAME_MS = 250
const ENTRY_LIMIT = 128
const CONTEXT_LIMIT = 32

type WatchEvent =
  'visibilitychange' | 'pagehide' | 'scroll' | 'wheel' | 'pointerdown' | 'keydown' | 'resize'
type TaskTiming = Pick<PerformanceEntry, 'startTime' | 'duration'>

/** Browser operations are supplied separately so lifecycle and backpressure can be controlled. */
export interface PageWatchEnvironment {
  now(): number
  visible(): boolean
  observe(receive: (entries: readonly TaskTiming[]) => void, buffered: boolean): (() => void) | null
  repeat(tick: () => void, ms: number): () => void
  frame(tick: (at: number) => void): number
  cancelFrame(id: number): void
  listen(event: WatchEvent, listener: () => void): () => void
}

export interface PageStallWatch {
  /** Bootstrap has finished; no conversation/component attribution is inferred. */
  mounted(): void
  stop(): void
}

/** Bounded numeric diagnostics, using the existing page receipt without delaying the bootstrap. */
export function startPageStallWatch(
  send: (report: PagePerformanceReport) => Promise<PageReportAnswer>,
  env: PageWatchEnvironment = browserEnvironment(),
): PageStallWatch {
  let stopped = false
  let visible: boolean | null = null
  let generation = 0
  let first = env.visible()
  let since = 0
  let observing = false
  let disconnect: (() => void) | null = null
  let cancelTick: (() => void) | null = null
  let frame: number | null = null
  let frameAt: number | null = null
  let remainingFrames = 0
  let activeUntil = 0
  let surface: PageSurface = 'bootstrap'
  let contexts: { at: number; until: number; surface: PageSurface; input: PageInput }[] = []
  let samples: PageSample[] = []
  let entries = 0
  let probes = 0
  let dropped = 0
  let lastTaskStart = -Infinity
  let burstWindow: number | null = null
  let bursts: {
    start: number
    ms: number
    count: number
    surface: PageSurface
    input: PageInput
    reported: boolean
  }[] = []
  let sequence = 0
  let inFlight = false
  let lastSent = -Infinity
  let healthAt = -Infinity
  let healthDue = true
  let hidden: {
    startMs: number
    timerDue: number
    timerLateMs: number
    frameAskedAt: number
    frameLateMs: number
  } | null = null
  const count = (value: number) => Math.min(MAX_PAGE_COUNT, value)

  function context(input: PageInput): void {
    const now = env.now()
    const previous = contexts.at(-1)
    const until = input === 'none' ? Infinity : now + ACTIVE_MS
    if (previous?.surface === surface && previous.input === input && now <= previous.until) {
      previous.until = until
      return
    }
    contexts.push({ at: now, until, surface, input })
    if (contexts.length > CONTEXT_LIMIT) contexts.shift()
  }

  function contextAt(startMs: number): (typeof contexts)[number] | undefined {
    for (let i = contexts.length - 1; i >= 0; i -= 1) {
      const at = contexts[i]!
      if (at.at <= startMs) return startMs < at.until ? at : { ...at, input: 'none' }
    }
    return undefined
  }

  function measurements(
    startMs: number,
    durationMs: number,
    n = 1,
    at: { surface: PageSurface; input: PageInput } | undefined = contextAt(startMs),
  ): Omit<PageSample, 'kind'> {
    return {
      startMs: Math.min(MAX_PAGE_CLOCK_MS, startMs),
      durationMs: Math.min(MAX_SAMPLE_MS, durationMs),
      count: count(n),
      surface: at?.surface ?? 'other',
      component: null,
      attribution: 'unknown',
      input: at?.input ?? 'unknown',
      conversation: null,
      loadedItems: null,
      fileCount: null,
      contextUsed: null,
    }
  }

  function sample(
    kind: Exclude<PageSample['kind'], 'starved'>,
    startMs: number,
    durationMs: number,
    n = 1,
    at: { surface: PageSurface; input: PageInput } | undefined = contextAt(startMs),
  ): void {
    keep({ kind, ...measurements(startMs, durationMs, n, at) })
  }

  function keep(one: PageSample): void {
    if (samples.length < MAX_PAGE_SAMPLES) samples.push(one)
    else {
      let smallest = 0
      for (let i = 1; i < samples.length; i += 1) {
        if (samples[i]!.durationMs < samples[smallest]!.durationMs) smallest = i
      }
      if (one.durationMs > samples[smallest]!.durationMs) samples[smallest] = one
      dropped = count(dropped + 1)
    }
  }

  function tasks(incoming: readonly TaskTiming[]): void {
    if (!visible || stopped) return
    entries = count(entries + incoming.length)
    dropped = count(dropped + Math.max(0, incoming.length - ENTRY_LIMIT))
    for (let i = 0; i < Math.min(incoming.length, ENTRY_LIMIT); i += 1) {
      const { startTime, duration } = incoming[i]!
      if (!Number.isFinite(startTime) || !Number.isFinite(duration) || duration < 50) continue
      if (startTime < since || startTime <= lastTaskStart) continue
      lastTaskStart = startTime
      const window = Math.floor(startTime / PAGE_REPORT_SPACING_MS)
      if (burstWindow !== window) {
        bursts = []
        burstWindow = window
      }
      if (duration >= TASK_MS) sample('long-task', startTime, duration)
      else {
        const at = contextAt(startTime)
        const from = { surface: at?.surface ?? 'other', input: at?.input ?? 'unknown' } as const
        let burst = bursts.find((one) => one.surface === from.surface && one.input === from.input)
        if (!burst) {
          if (bursts.length === MAX_PAGE_SAMPLES) {
            dropped = count(dropped + 1)
            continue
          }
          burst = { start: startTime, ms: 0, count: 0, reported: false, ...from }
          bursts.push(burst)
        }
        if (burst.reported) {
          dropped = count(dropped + 1)
          continue
        }
        burst.ms = Math.min(MAX_SAMPLE_MS, burst.ms + duration)
        burst.count = count(burst.count + 1)
        // Emit the first observed prefix reaching the threshold, once per retained window/context.
        if (burst.ms >= BURST_MS) {
          sample('task-burst', burst.start, burst.ms, burst.count, burst)
          burst.reported = true
        }
      }
    }
  }

  function frameTick(at: number): void {
    frame = null
    if (!visible || stopped) return
    probes = count(probes + 1)
    if (frameAt !== null && at - frameAt >= FRAME_MS) sample('frame-gap', frameAt, at - frameAt)
    frameAt = at
    remainingFrames -= 1
    if (env.now() < activeUntil || remainingFrames > 0) frame = nextFrame()
    else frameAt = null
  }

  function nextFrame(): number {
    const armedGeneration = generation
    return env.frame((at) => {
      if (generation === armedGeneration) frameTick(at)
    })
  }

  function probe(): void {
    if (frame !== null) return
    frameAt = null
    remainingFrames = 2
    frame = nextFrame()
  }

  function active(input: PageInput): void {
    if (!visible || stopped) return
    context(input)
    if (env.now() >= activeUntil) frameAt = null
    activeUntil = env.now() + ACTIVE_MS
    probe()
  }

  function flush(): void {
    const now = env.now()
    if (
      !visible ||
      hidden !== null ||
      stopped ||
      inFlight ||
      now - lastSent < PAGE_REPORT_SPACING_MS
    )
      return
    if (samples.length === 0 && !healthDue && now - healthAt < HEALTH_MS) return
    const report: PagePerformanceReport = {
      kind: PAGE_RECEIPT_KIND,
      version: 1,
      sequence: (sequence = count(sequence + 1)),
      visibility: 'visible',
      samples,
      health: { observing, entries, probes },
      dropped,
    }
    samples = []
    entries = probes = dropped = 0
    healthAt = lastSent = now
    healthDue = false
    inFlight = true
    const sentGeneration = generation
    const failed = (): void => {
      inFlight = false
      if (stopped || !visible || generation !== sentGeneration) return
      dropped = count(dropped + report.dropped + report.samples.length)
      // A failed diagnostic is counted for the next report, never logged or retried in a loop.
    }
    try {
      void Promise.resolve(send(report)).then((answer) => {
        inFlight = false
        if (stopped) return
        if (!answer.recorded && (answer.why === 'closing' || answer.why === 'not-the-page')) {
          stop()
          return
        }
        if (!visible || generation !== sentGeneration || answer.recorded) return
        if (answer.why === 'too-soon') {
          for (const one of report.samples) keep(one)
          entries = count(entries + report.health!.entries)
          probes = count(probes + report.health!.probes)
          dropped = count(dropped + report.dropped)
          healthDue = true
        } else failed()
      }, failed)
    } catch {
      failed()
    }
  }

  function tick(): void {
    if (!visible || stopped) return
    probe()
    flush()
  }

  function pause(): void {
    visible = false
    generation += 1
    disconnect?.()
    disconnect = null
    observing = false
    cancelTick?.()
    cancelTick = null
    if (frame !== null) env.cancelFrame(frame)
    frame = frameAt = null
    activeUntil = remainingFrames = 0
    samples = []
    entries = probes = dropped = 0
    bursts = []
    burstWindow = null
    contexts = []
  }

  function hiddenFrame(): number {
    const gap = hidden!
    gap.frameAskedAt = env.now()
    const armedGeneration = generation
    return env.frame((at) => {
      if (stopped || generation !== armedGeneration || hidden !== gap) return
      frame = null
      gap.frameLateMs = Math.max(gap.frameLateMs, at - gap.frameAskedAt)
      if (!visible) return
      hidden = null
      if (gap.timerLateMs >= PAGE_STARVATION_FLOOR_MS) {
        const timerLateMs = Math.min(MAX_SAMPLE_MS, gap.timerLateMs)
        keep({
          kind: 'starved',
          ...measurements(gap.startMs, timerLateMs, 1, { surface: 'away', input: 'none' }),
          timerLateMs,
          frameLateMs: Math.min(MAX_SAMPLE_MS, gap.frameLateMs),
        })
      }
      // The hidden frame's delay is separate from gaps between visible frames.
      frameAt = null
      remainingFrames = 2
      frameTick(at)
      flush()
    })
  }

  function hiddenTick(): void {
    if (stopped || visible || hidden === null) return
    const now = env.now()
    if (now < hidden.timerDue) return
    hidden.timerLateMs = Math.max(hidden.timerLateMs, now - hidden.timerDue)
    hidden.timerDue = now + HEALTH_MS
    // At most one pending frame; no frame chain runs while the page is hidden.
    if (frame === null) frame = hiddenFrame()
  }

  function hide(): void {
    const now = env.now()
    const previous = hidden
    // A second hide before the returning frame must not erase an already measured delay.
    if (previous && frame !== null) {
      previous.frameLateMs = Math.max(previous.frameLateMs, now - previous.frameAskedAt)
    }
    pause()
    hidden = {
      startMs: previous?.startMs ?? now,
      timerDue: now + HEALTH_MS,
      timerLateMs: previous?.timerLateMs ?? 0,
      frameAskedAt: now,
      frameLateMs: previous?.frameLateMs ?? 0,
    }
    cancelTick = env.repeat(hiddenTick, HEALTH_MS)
    frame = hiddenFrame()
  }

  function visibility(): void {
    if (stopped || visible === env.visible()) return
    if (!env.visible()) {
      hide()
      return
    }
    if (hidden !== null) {
      // Visibility can arrive before the overdue timer callback gets its turn.
      hidden.timerLateMs = Math.max(hidden.timerLateMs, env.now() - hidden.timerDue)
      cancelTick?.()
      cancelTick = null
    }
    visible = true
    since = first ? 0 : env.now()
    contexts = [{ at: since, until: Infinity, surface, input: 'none' }]
    try {
      const armedGeneration = generation
      disconnect = env.observe((incoming) => {
        if (generation === armedGeneration) tasks(incoming)
      }, first)
      observing = disconnect !== null
    } catch {
      observing = false
    }
    first = false
    healthDue = true
    cancelTick = env.repeat(tick, PAGE_REPORT_SPACING_MS)
    if (hidden !== null) {
      if (frame === null) frame = hiddenFrame()
    } else {
      probe()
      flush()
    }
  }

  const listeners = [
    env.listen('visibilitychange', visibility),
    env.listen('pagehide', stop),
    ...(['scroll', 'wheel', 'pointerdown', 'keydown', 'resize'] as const).map((event) =>
      env.listen(event, () =>
        active(
          event === 'wheel'
            ? 'scroll'
            : event === 'pointerdown'
              ? 'pointer'
              : event === 'keydown'
                ? 'key'
                : event,
        ),
      ),
    ),
  ]

  function stop(): void {
    if (stopped) return
    stopped = true
    pause()
    hidden = null
    for (const remove of listeners) remove()
  }

  visibility()
  return {
    mounted() {
      surface = 'other'
      active('none')
    },
    stop,
  }
}

function browserEnvironment(): PageWatchEnvironment {
  return {
    now: () => performance.now(),
    visible: () => document.visibilityState === 'visible',
    observe(receive, buffered) {
      if (!globalThis.PerformanceObserver?.supportedEntryTypes.includes('longtask')) return null
      const observer = new PerformanceObserver((list) => receive(list.getEntries()))
      try {
        observer.observe({ type: 'longtask', buffered })
      } catch (error) {
        observer.disconnect()
        throw error
      }
      return () => observer.disconnect()
    },
    repeat(tick, ms) {
      const id = window.setInterval(tick, ms)
      return () => window.clearInterval(id)
    },
    frame: (tick) => requestAnimationFrame(tick),
    cancelFrame: (id) => cancelAnimationFrame(id),
    listen(event, listener) {
      const target = event === 'visibilitychange' ? document : window
      const capture = event === 'scroll'
      target.addEventListener(event, listener, { passive: true, capture })
      return () => target.removeEventListener(event, listener, capture)
    },
  }
}
