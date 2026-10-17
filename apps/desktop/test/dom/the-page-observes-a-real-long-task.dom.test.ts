import { afterEach, expect, it } from 'vitest'
import { aPageReceipt } from '../../src/main/runtime/page-performance'
import {
  startPageStallWatch,
  type PageWatchEnvironment,
} from '../../src/renderer/src/lib/page-stall-watch'
import {
  PAGE_REPORT_SPACING_MS,
  type PagePerformanceReport,
  type PageReportAnswer,
} from '../../src/shared/page-performance'

let stop: (() => void) | null = null
let pane: HTMLElement | null = null
afterEach(() => {
  stop?.()
  pane?.remove()
})

const settled = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

it('a pane scroll arms native frame probes and the observer reports a busy task main accepts', async () => {
  expect(document.visibilityState).toBe('visible')
  expect(PerformanceObserver.supportedEntryTypes).toContain('longtask')
  const reports: PagePerformanceReport[] = []
  const answers: PageReportAnswer[] = []
  const lines: string[] = []
  const nativeTasks: { startTime: number; duration: number }[] = []
  const nativeGaps: { startMs: number; durationMs: number }[] = []
  const nativeStartedAt = performance.now()
  let pageClock = nativeStartedAt
  let mainClock = 0
  const ticks = new Set<() => void>()
  let lastFrame: number | null = null
  let sawTask = false
  let sawGap = false
  let nativeReceived: () => void = () => {}
  const nativeReady = new Promise<void>((resolve) => (nativeReceived = resolve))
  const nativeMoved = () => {
    if (sawTask && sawGap) nativeReceived()
  }
  const receipt = aPageReceipt({
    closing: () => false,
    now: () => mainClock,
    log: (line) => lines.push(line),
  })

  function recoveryOf(index: number) {
    const later = reports.filter((_, at) => at > index && answers[at]?.recorded)
    const recorded = later
      .flatMap((report) => report.samples)
      .map((sample) => JSON.stringify(sample))
    const recovered: PagePerformanceReport['samples'][number][] = []
    const missing = reports[index]!.samples.filter((sample) => {
      const at = recorded.indexOf(JSON.stringify(sample))
      if (at === -1) return true
      recorded.splice(at, 1)
      recovered.push(sample)
      return false
    })
    return { recovered, missing, dropped: later.reduce((sum, report) => sum + report.dropped, 0) }
  }

  const recordedSamples = () =>
    reports.flatMap((report, at) => (answers[at]?.recorded ? report.samples : []))
  const missingKinds = () =>
    (['long-task', 'frame-gap'] as const).filter(
      (kind) =>
        !recordedSamples().some((sample) => sample.kind === kind && sample.durationMs >= 650),
    )
  const allRecovered = () =>
    answers.every((answer, at) => {
      if (answer.recorded) return true
      const recovery = recoveryOf(at)
      return (
        answer.why === 'too-soon' &&
        recovery.missing.length === 0 &&
        recovery.dropped >= reports[at]!.dropped
      )
    })
  const diagnostics = (phase: string) =>
    JSON.stringify(
      {
        phase,
        pageClock,
        mainClock,
        native: {
          elapsedMs: performance.now() - nativeStartedAt,
          sawTask,
          sawGap,
          tasks: nativeTasks,
          frameGaps: nativeGaps,
        },
        missingRecordedKinds: missingKinds(),
        recordedSamples: recordedSamples(),
        mainLog: lines,
        reports: reports.map((report, at) => ({
          sequence: report.sequence,
          samples: report.samples,
          dropped: report.dropped,
          health: report.health,
          answer: answers[at],
          recovery: answers[at]?.recorded ? null : recoveryOf(at),
        })),
      },
      null,
      2,
    )

  // Native observation and frames stay real; only reporting ticks and the two clocks are controlled.
  const env: PageWatchEnvironment = {
    now: () => pageClock,
    visible: () => document.visibilityState === 'visible',
    observe(receive, buffered) {
      const observer = new PerformanceObserver((list) => {
        // Earlier browser tests' buffered tasks are not this fixture's native work.
        const fresh = list.getEntries().filter((entry) => entry.startTime >= nativeStartedAt)
        receive(fresh)
        for (const entry of fresh) {
          nativeTasks.push({ startTime: entry.startTime, duration: entry.duration })
          if (nativeTasks.length > 20) nativeTasks.shift()
          if (entry.duration >= 650) sawTask = true
        }
        nativeMoved()
      })
      observer.observe({ type: 'longtask', buffered })
      return () => observer.disconnect()
    },
    repeat(next) {
      ticks.add(next)
      return () => {
        ticks.delete(next)
      }
    },
    frame(next) {
      return requestAnimationFrame((at) => {
        next(at)
        if (lastFrame !== null && at - lastFrame >= 650) {
          nativeGaps.push({ startMs: lastFrame, durationMs: at - lastFrame })
          if (nativeGaps.length > 20) nativeGaps.shift()
          sawGap = true
        }
        lastFrame = at
        nativeMoved()
      })
    },
    cancelFrame: (id) => cancelAnimationFrame(id),
    listen(event, listener) {
      const target = event === 'visibilitychange' ? document : window
      const capture = event === 'scroll'
      target.addEventListener(event, listener, { passive: true, capture })
      return () => target.removeEventListener(event, listener, capture)
    },
  }
  const watch = startPageStallWatch((report) => {
    reports.push(structuredClone(report))
    answers.push(
      receipt.take(
        {
          sender: { id: 1, isDestroyed: () => false, getOSProcessId: () => 77 },
          senderFrame: { parent: null },
        },
        report,
      ),
    )
    return Promise.resolve(answers.at(-1)!)
  }, env)
  stop = () => watch.stop()
  await settled()

  pane = document.createElement('div')
  document.body.append(pane)
  let timeout: number | undefined
  try {
    await Promise.race([
      (async () => {
        pane!.dispatchEvent(new Event('scroll', { bubbles: false }))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        await new Promise<void>((resolve) =>
          window.setTimeout(() => {
            const began = performance.now()
            while (performance.now() - began < 700) {
              /* Synthetic page work, no content. */
            }
            resolve()
          }, 0),
        )
        await nativeReady
      })(),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () =>
            reject(new Error(`native acquisition timed out: ${diagnostics('native observation')}`)),
          4000,
        )
      }),
    ])
  } finally {
    window.clearTimeout(timeout)
  }

  // A paced page send arrives one millisecond too early at main's independent clock. Its real
  // receipt refuses it; page-stall-watch.ts's too-soon branch must requeue samples and drop counts.
  pageClock += PAGE_REPORT_SPACING_MS
  mainClock = PAGE_REPORT_SPACING_MS - 1
  for (const tick of ticks) tick()
  await settled()
  expect(answers.at(-1), diagnostics('first sample report')).toEqual({
    recorded: false,
    why: 'too-soon',
  })
  expect(reports.at(-1)!.samples.length, diagnostics('refused sample report')).toBeGreaterThan(0)

  // Three logical opportunities bound recovery even if the watch never sends or keeps being refused.
  for (let retry = 0; retry < 3; retry += 1) {
    pageClock += PAGE_REPORT_SPACING_MS
    mainClock += PAGE_REPORT_SPACING_MS
    for (const tick of ticks) tick()
    await settled()
    if (missingKinds().length === 0 && allRecovered()) break
  }
  const proof = diagnostics('bounded reporting recovery')
  expect(missingKinds(), proof).toEqual([])
  expect(
    reports.some((report) => report.health?.observing === true),
    proof,
  ).toBe(true)
  answers.forEach((answer, at) => {
    if (answer.recorded) return
    expect(answer, proof).toEqual({ recorded: false, why: 'too-soon' })
    const recovery = recoveryOf(at)
    expect(recovery.missing, proof).toEqual([])
    expect(recovery.dropped, proof).toBeGreaterThanOrEqual(reports[at]!.dropped)
  })
  expect(
    lines.some((line) => line.includes('long-task')),
    proof,
  ).toBe(true)
  expect(
    lines.some((line) => line.includes('frame-gap')),
    proof,
  ).toBe(true)
})
