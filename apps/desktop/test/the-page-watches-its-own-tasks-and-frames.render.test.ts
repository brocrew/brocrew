import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aPageReceipt, type PageReportSender } from '../src/main/runtime/page-performance'
import {
  startPageStallWatch,
  type PageWatchEnvironment,
} from '../src/renderer/src/lib/page-stall-watch'
import {
  MAX_PAGE_SAMPLES,
  MAX_SAMPLE_MS,
  type PagePerformanceReport,
  type PageReportAnswer,
} from '../src/shared/page-performance'

const stops: (() => void)[] = []
afterEach(() => stops.splice(0).forEach((stop) => stop()))
const settled = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

function fixture(
  options: {
    visible?: boolean
    support?: boolean
    failObserver?: boolean
    send?: (report: PagePerformanceReport) => Promise<PageReportAnswer>
  } = {},
) {
  let at = 0
  let visible = options.visible ?? true
  let receiver:
    ((entries: readonly Pick<PerformanceEntry, 'startTime' | 'duration'>[]) => void) | null = null
  let connected = false
  let frameId = 0
  const frames = new Map<number, (at: number) => void>()
  const timers = new Set<() => void>()
  const intervals: number[] = []
  const buffered: boolean[] = []
  const listeners = new Map<string, Set<() => void>>()
  const reports: PagePerformanceReport[] = []
  const answers: PageReportAnswer[] = []
  const lines: string[] = []
  const receipt = aPageReceipt({
    closing: () => false,
    now: () => at,
    log: (line) => lines.push(line),
  })
  const page: PageReportSender = {
    sender: { id: 1, isDestroyed: () => false, getOSProcessId: () => 77 },
    senderFrame: { parent: null },
  }
  const env: PageWatchEnvironment = {
    now: () => at,
    visible: () => visible,
    observe(receive, initiallyBuffered) {
      buffered.push(initiallyBuffered)
      if (options.failObserver) throw new Error('fixed test failure')
      if (options.support === false) return null
      receiver = receive
      connected = true
      return () => {
        connected = false
      }
    },
    repeat(tick, ms) {
      intervals.push(ms)
      timers.add(tick)
      return () => {
        timers.delete(tick)
      }
    },
    frame(tick) {
      frames.set(++frameId, tick)
      expect(frames.size).toBeLessThanOrEqual(1)
      return frameId
    },
    cancelFrame(id) {
      frames.delete(id)
    },
    listen(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => {
        set.delete(listener)
      }
    },
  }
  const send = vi.fn((report: PagePerformanceReport) => {
    reports.push(structuredClone(report))
    if (options.send) return options.send(report)
    const answer = receipt.take(page, report)
    answers.push(answer)
    return Promise.resolve(answer)
  })
  const watch = startPageStallWatch(send, env)
  stops.push(watch.stop)
  const event = (name: string) => {
    for (const listener of listeners.get(name) ?? []) listener()
  }
  return {
    watch,
    env,
    send,
    reports,
    answers,
    lines,
    receipt,
    frames,
    timers,
    intervals,
    buffered,
    listeners,
    connected: () => connected,
    receive: () => receiver!,
    tasks: (entries: readonly Pick<PerformanceEntry, 'startTime' | 'duration'>[]) =>
      receiver?.(entries),
    wait(ms: number) {
      at += ms
    },
    advance(ms = 1000) {
      at += ms
      for (const tick of [...timers]) tick()
    },
    frame(atFrame: number) {
      at = atFrame
      const current = [...frames.values()]
      frames.clear()
      for (const tick of current) tick(atFrame)
    },
    visibility(value: boolean) {
      visible = value
      event('visibilitychange')
    },
    event,
  }
}

describe('the page watches its own tasks and frames', () => {
  it('sends numeric batches the actual main receipt accepts, and health makes an idle page heard', async () => {
    const f = fixture()
    await settled()
    expect(f.reports[0]).toMatchObject({
      samples: [],
      health: { observing: true, entries: 0, probes: 0 },
    })
    expect(f.receipt.takeHeard()).not.toBeNull()
    f.tasks([{ startTime: 100, duration: 720, name: 'never copied' } as PerformanceEntry])
    f.advance()
    await settled()
    const report = f.reports[1]!
    expect(report.samples).toEqual([
      {
        kind: 'long-task',
        startMs: 100,
        durationMs: 720,
        count: 1,
        surface: 'bootstrap',
        component: null,
        attribution: 'unknown',
        input: 'none',
        conversation: null,
        loadedItems: null,
        fileCount: null,
        contextUsed: null,
      },
    ])
    expect(JSON.stringify(report)).not.toContain('never copied')
    expect(f.lines).toHaveLength(1)
    expect(f.lines[0]).toContain('page renderer 77 window 1 long-task 720 ms')
    expect(f.answers).toEqual([{ recorded: true }, { recorded: true }])
  })

  it('sends nothing on empty anomaly ticks, with only the thirty-second health deadline', async () => {
    const f = fixture()
    await settled()
    for (let i = 0; i < 29; i += 1) {
      f.advance()
      await settled()
    }
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.intervals).toEqual([1000])
    f.advance()
    await settled()
    expect(f.send).toHaveBeenCalledTimes(2)
    expect(f.reports[1]!.samples).toEqual([])
    expect(f.lines).toEqual([])
  })

  it('aggregates smaller tasks per interval and context, and keeps delayed bootstrap attribution', async () => {
    const f = fixture()
    await settled()
    f.tasks([
      { startTime: 10, duration: 199 },
      { startTime: 20, duration: 199 },
    ])
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(1)
    f.watch.mounted()
    f.tasks([
      { startTime: 100, duration: 700 },
      ...[1100, 1200, 1300].map((startTime) => ({ startTime, duration: 170 })),
    ])
    f.advance()
    await settled()
    expect(f.reports[1]!.samples).toContainEqual(
      expect.objectContaining({ kind: 'long-task', surface: 'bootstrap', durationMs: 700 }),
    )
    expect(f.reports[1]!.samples).toContainEqual(
      expect.objectContaining({ kind: 'task-burst', surface: 'other', durationMs: 510, count: 3 }),
    )
  })

  it('bounds memory and callback work under ten thousand entries', async () => {
    const f = fixture()
    await settled()
    let read = 0
    f.tasks(
      Array.from({ length: 10_000 }, (_, i) => ({
        startTime: i,
        get duration() {
          read += 1
          return 200 + i
        },
      })),
    )
    expect(read).toBeLessThanOrEqual(128)
    f.advance()
    await settled()
    const report = f.reports[1]!
    expect(report.samples).toHaveLength(MAX_PAGE_SAMPLES)
    expect(report.dropped).toBe(9995)
    expect(report.health!.entries).toBe(10_000)
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(4096)
    expect(f.answers[1]).toEqual({ recorded: true })
  })

  it('uses task timestamps for delayed burst windows and never repeats buffered entries', async () => {
    const f = fixture()
    await settled()
    f.advance(5000)
    const tasks = [
      { startTime: 100, duration: 199 },
      { startTime: 300, duration: 199 },
      { startTime: 1100, duration: 199 },
      { startTime: 1300, duration: 199 },
      { startTime: 2100, duration: 199 },
      { startTime: 2300, duration: 199 },
      { startTime: 2500, duration: 102 },
      { startTime: 2700, duration: 200 },
    ]
    f.tasks(tasks)
    f.advance()
    await settled()
    expect(f.reports[1]!.samples).toHaveLength(2)
    expect(f.reports[1]!.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'long-task', durationMs: 200, count: 1 }),
        expect.objectContaining({ kind: 'task-burst', startMs: 2100, durationMs: 500, count: 3 }),
      ]),
    )
    f.tasks(tasks)
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(2)
  })

  it('keeps a 499ms burst below the threshold and retains the current timestamp window', async () => {
    const f = fixture()
    await settled()
    f.tasks([
      { startTime: 100, duration: 199 },
      { startTime: 300, duration: 199 },
      { startTime: 500, duration: 101 },
    ])
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(1)
    f.tasks([{ startTime: 1100, duration: 199 }])
    f.advance(200)
    f.tasks([
      { startTime: 1300, duration: 199 },
      { startTime: 1500, duration: 102 },
    ])
    f.advance(800)
    await settled()
    expect(f.reports[1]!.samples[0]).toMatchObject({ kind: 'task-burst', durationMs: 500 })
  })

  it('retains partial bursts across timer ticks and emits only the first observed prefix', async () => {
    const f = fixture()
    await settled()
    f.tasks([
      { startTime: 100, duration: 199 },
      { startTime: 300, duration: 199 },
    ])
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(1)
    f.tasks([{ startTime: 850, duration: 150 }])
    f.advance()
    await settled()
    expect(f.reports[1]!.samples).toEqual([
      expect.objectContaining({ kind: 'task-burst', startMs: 100, durationMs: 548, count: 3 }),
    ])
    f.tasks([
      { startTime: 850, duration: 150 },
      { startTime: 999, duration: 50 },
    ])
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(2)
    f.advance(30_000)
    await settled()
    expect(f.reports[2]!.dropped).toBe(1)
  })

  it('expires input at task time, extends contiguous activity and preserves idle gaps', async () => {
    const f = fixture()
    await settled()
    f.advance(2000)
    f.event('scroll')
    f.advance(4000)
    f.event('scroll')
    f.advance(10_000)
    f.event('scroll')
    f.advance(1000)
    f.tasks([2500, 8500, 12000, 16500].map((startTime) => ({ startTime, duration: 700 })))
    f.advance()
    await settled()
    expect(f.reports[1]!.samples.map(({ startMs, input }) => ({ startMs, input }))).toEqual([
      { startMs: 2500, input: 'scroll' },
      { startMs: 8500, input: 'scroll' },
      { startMs: 12000, input: 'none' },
      { startMs: 16500, input: 'scroll' },
    ])
    expect(f.frames.size).toBe(1)
  })

  it('labels a sparse frame gap after input expiry with none', async () => {
    const f = fixture()
    await settled()
    f.frame(16)
    f.frame(32)
    f.advance(2000)
    f.event('scroll')
    f.frame(2100)
    f.frame(2116)
    f.frame(7100)
    expect(f.frames.size).toBe(0)
    f.advance(2900)
    await settled()
    f.frame(10000)
    f.frame(10300)
    f.advance()
    await settled()
    expect(f.reports.flatMap((report) => report.samples)).toContainEqual(
      expect.objectContaining({ kind: 'frame-gap', startMs: 10000, input: 'none' }),
    )
  })

  it('coalesces an input storm into one frame chain and one paced successor after too-soon', async () => {
    let sends = 0
    const f = fixture({
      send: async () => (++sends === 2 ? { recorded: false, why: 'too-soon' } : { recorded: true }),
    })
    await settled()
    for (let i = 0; i < 10_000; i += 1) f.event('scroll')
    expect(f.frames.size).toBe(1)
    f.tasks(
      Array.from({ length: MAX_PAGE_SAMPLES + 2 }, (_, i) => ({
        startTime: 100 + i,
        duration: 700,
      })),
    )
    f.advance()
    await settled()
    expect(f.send).toHaveBeenCalledTimes(2)
    expect(f.reports[1]!.dropped).toBe(2)
    await settled()
    expect(f.send).toHaveBeenCalledTimes(2)
    f.advance()
    await settled()
    expect(f.send).toHaveBeenCalledTimes(3)
    expect(f.reports[2]!.samples).toEqual(f.reports[1]!.samples)
    expect(f.reports[2]!.dropped).toBe(f.reports[1]!.dropped)
    f.frame(6000)
    f.frame(6016)
    expect(f.frames.size).toBe(0)
  })

  it('keeps just one outstanding send and a bounded next batch', async () => {
    let finish: (answer: PageReportAnswer) => void = () => {}
    const f = fixture({
      send: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    f.tasks(Array.from({ length: 100 }, (_, i) => ({ startTime: i, duration: 700 })))
    for (let i = 0; i < 5; i += 1) f.advance()
    expect(f.send).toHaveBeenCalledTimes(1)
    finish({ recorded: true })
    await settled()
    f.advance()
    expect(f.send).toHaveBeenCalledTimes(2)
    expect(f.reports[1]!.samples).toHaveLength(MAX_PAGE_SAMPLES)
    finish({ recorded: true })
    await settled()
  })

  it('uses two idle frames and a bounded active chain, fencing the first rearmed frame', async () => {
    const f = fixture()
    await settled()
    f.frame(16)
    f.frame(32)
    expect(f.frames.size).toBe(0)
    f.advance()
    f.frame(2000)
    f.frame(2016)
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(1)
    f.event('scroll')
    f.frame(3100)
    f.frame(3400)
    expect(f.frames.size).toBe(1)
    f.advance()
    await settled()
    expect(f.reports[1]!.samples).toContainEqual(
      expect.objectContaining({
        kind: 'frame-gap',
        startMs: 3100,
        durationMs: 300,
        input: 'scroll',
      }),
    )
    f.frame(9000)
    expect(f.frames.size).toBe(0)
  })

  it('keeps only sparse probes while hidden and fences old observer/frame callbacks after resume', async () => {
    const f = fixture()
    await settled()
    const oldObserver = f.receive()
    const oldFrame = [...f.frames.values()][0]!
    f.visibility(false)
    expect(f.connected()).toBe(false)
    expect(f.frames.size).toBe(1)
    expect(f.timers.size).toBe(1)
    expect(f.intervals).toEqual([1000, 30_000])
    f.advance(60_000)
    oldObserver([{ startTime: 50_000, duration: 700 }])
    oldFrame(60_000)
    expect(f.reports).toHaveLength(1)
    f.visibility(true)
    await settled()
    expect(f.reports).toHaveLength(1)
    expect(f.buffered).toEqual([true, false])
    oldObserver([{ startTime: 60_100, duration: 900 }])
    oldFrame(60_100)
    f.frame(60_200)
    f.frame(60_216)
    f.tasks([{ startTime: 10, duration: 700 }])
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(2)
    expect(f.reports[1]!.samples).toEqual([
      expect.objectContaining({ kind: 'starved', timerLateMs: 30_000, frameLateMs: 60_200 }),
    ])
  })

  it('tracks only sparse callbacks on an initially hidden page, and stops cleanly at shutdown', async () => {
    const f = fixture({ visible: false })
    expect(f.reports).toEqual([])
    expect(f.buffered).toEqual([])
    expect(f.timers.size).toBe(1)
    expect(f.frames.size).toBe(1)
    expect(f.intervals).toEqual([30_000])
    f.advance(5000)
    f.visibility(true)
    await settled()
    expect(f.buffered).toEqual([false])
    f.frame(5016)
    await settled()
    expect(f.reports[0]!.samples).toEqual([])
    const stale = f.receive()
    f.event('pagehide')
    f.watch.stop()
    expect(f.connected()).toBe(false)
    expect(f.timers.size).toBe(0)
    expect(f.frames.size).toBe(0)
    expect([...f.listeners.values()].every((set) => set.size === 0)).toBe(true)
    stale([{ startTime: 6000, duration: 700 }])
    f.advance(60_000)
    expect(f.reports).toHaveLength(1)
  })

  it('reports a held-back hidden timer and frame once on the first returning frame', async () => {
    const f = fixture()
    await settled()
    f.advance()
    f.visibility(false)
    f.advance(120_000)
    expect(f.reports).toHaveLength(1)
    expect(f.connected()).toBe(false)
    f.visibility(true)
    expect(f.reports).toHaveLength(1)
    f.frame(121_016)
    await settled()
    expect(f.answers).toEqual([{ recorded: true }, { recorded: true }])
    expect(f.reports[1]!.samples).toEqual([
      expect.objectContaining({
        kind: 'starved',
        startMs: 1000,
        durationMs: 90_000,
        timerLateMs: 90_000,
        frameLateMs: 120_016,
        surface: 'away',
        input: 'none',
      }),
    ])
    expect(f.lines).toEqual([
      'page renderer 77 window 1 starved while hidden; timer late 90000 ms; frame late 120016 ms; surface away; input none; page clock 1000',
    ])
    f.frame(121_032)
    f.advance()
    f.visibility(true)
    await settled()
    expect(f.lines).toHaveLength(1)
  })

  it('measures the overdue timer even when visibility runs before its callback', async () => {
    const f = fixture({ visible: false })
    f.wait(120_000)
    f.visibility(true)
    f.frame(120_016)
    await settled()
    expect(f.reports[0]!.samples).toEqual([
      expect.objectContaining({ kind: 'starved', timerLateMs: 90_000, frameLateMs: 120_016 }),
    ])
    expect(f.answers).toEqual([{ recorded: true }])
  })

  it('keeps a normal long hide quiet when sparse timers run on time, despite paused frames', async () => {
    const f = fixture({ visible: false })
    for (let i = 0; i < 4; i += 1) f.advance(30_000)
    expect(f.frames.size).toBe(1)
    expect(f.reports).toEqual([])
    f.visibility(true)
    f.frame(120_016)
    f.frame(120_032)
    await settled()
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(1)
    expect(f.reports[0]!.samples).toEqual([])
    expect(f.lines).toEqual([])
  })

  it('uses sparse hidden frames without starting a frame loop or sending hidden reports', async () => {
    const f = fixture({ visible: false })
    f.frame(16)
    expect(f.frames.size).toBe(0)
    f.advance(120_000)
    expect(f.frames.size).toBe(1)
    f.frame(120_032)
    expect(f.frames.size).toBe(0)
    expect(f.reports).toEqual([])
    f.visibility(true)
    f.frame(120_048)
    await settled()
    expect(f.reports[0]!.samples).toEqual([
      expect.objectContaining({ kind: 'starved', timerLateMs: 90_016, frameLateMs: 16 }),
    ])
  })

  for (const late of [999, 1000]) {
    it(`reports hidden timer lateness only at the floor (${String(late)} ms)`, async () => {
      const f = fixture({ visible: false })
      f.wait(30_000 + late)
      f.visibility(true)
      f.frame(30_016 + late)
      await settled()
      expect(f.answers).toEqual([{ recorded: true }])
      expect(f.reports[0]!.samples).toHaveLength(late === 1000 ? 1 : 0)
      if (late === 1000) {
        expect(f.reports[0]!.samples[0]).toMatchObject({ kind: 'starved', timerLateMs: 1000 })
      }
    })
  }

  it('retains a measured delay through a second hide before the returning frame', async () => {
    const f = fixture({ visible: false })
    f.wait(120_000)
    f.visibility(true)
    const stale = [...f.frames.values()][0]!
    f.visibility(false)
    stale(120_016)
    expect(f.reports).toEqual([])
    f.advance(30_000)
    f.visibility(true)
    f.frame(150_016)
    await settled()
    expect(f.reports[0]!.samples).toEqual([
      expect.objectContaining({ kind: 'starved', timerLateMs: 90_000, frameLateMs: 120_000 }),
    ])
    expect(f.lines).toHaveLength(1)
  })

  it('retries the complete starvation sample after too-soon, bounded by normal reporting ticks', async () => {
    let calls = 0
    const f = fixture({
      visible: false,
      send: () =>
        Promise.resolve(++calls === 1 ? { recorded: false, why: 'too-soon' } : { recorded: true }),
    })
    f.wait(120_000)
    f.visibility(true)
    f.frame(120_016)
    await settled()
    expect(f.reports).toHaveLength(1)
    f.advance(999)
    await settled()
    expect(f.reports).toHaveLength(1)
    f.advance(1)
    await settled()
    expect(f.reports).toHaveLength(2)
    expect(f.reports[1]!.samples).toEqual(f.reports[0]!.samples)
    expect(f.reports[1]!.dropped).toBe(f.reports[0]!.dropped)
    f.advance()
    await settled()
    expect(f.reports).toHaveLength(2)
  })

  it('caps both hidden delays without changing the receipt bounds', async () => {
    const f = fixture({ visible: false })
    f.wait(MAX_SAMPLE_MS * 3)
    f.visibility(true)
    f.frame(MAX_SAMPLE_MS * 3 + 16)
    await settled()
    expect(f.reports[0]!.samples).toEqual([
      expect.objectContaining({
        kind: 'starved',
        timerLateMs: MAX_SAMPLE_MS,
        frameLateMs: MAX_SAMPLE_MS,
        durationMs: MAX_SAMPLE_MS,
      }),
    ])
    expect(f.answers).toEqual([{ recorded: true }])
  })

  it('cancels hidden probes on shutdown and ignores their already queued callbacks', async () => {
    const f = fixture({ visible: false })
    const staleFrame = [...f.frames.values()][0]!
    const staleTimer = [...f.timers][0]!
    f.watch.stop()
    f.wait(120_000)
    staleTimer()
    staleFrame(120_016)
    f.visibility(true)
    expect(f.frames.size).toBe(0)
    expect(f.timers.size).toBe(0)
    expect(f.reports).toEqual([])
  })

  for (const options of [{ support: false }, { failObserver: true }]) {
    it(`keeps health and frames working when the observer is ${options.support === false ? 'unsupported' : 'failing'}`, async () => {
      const f = fixture(options)
      await settled()
      expect(f.reports[0]!.health!.observing).toBe(false)
      f.frame(10)
      f.frame(310)
      f.advance()
      await settled()
      expect(f.reports[1]!.samples[0]!.kind).toBe('frame-gap')
    })
  }

  it('never loops failed diagnostic writes, and stops when main is closing', async () => {
    const failing = fixture({ send: () => Promise.reject(new Error('fixed test failure')) })
    await settled()
    failing.advance(5000)
    await settled()
    expect(failing.send).toHaveBeenCalledTimes(1)
    failing.watch.stop()
    const closing = fixture({ send: () => Promise.resolve({ recorded: false, why: 'closing' }) })
    await settled()
    expect(closing.connected()).toBe(false)
    expect(closing.timers.size).toBe(0)
  })

  it('starts in bootstrap before the existing awaits and disposes for hot reload', () => {
    const source = readFileSync(new URL('../src/renderer/src/main.ts', import.meta.url), 'utf8')
    const start = source.indexOf('startPageStallWatch((report)')
    expect(start).toBeGreaterThanOrEqual(0)
    const firstAwait = source.indexOf('void Promise.all([keepTheMacZone(window.api)')
    expect(firstAwait).toBeGreaterThanOrEqual(0)
    expect(start).toBeLessThan(firstAwait)
    expect(source).toContain('window.top === window')
    expect(source).toContain('import.meta.hot?.dispose(() => pageWatch?.stop())')
    expect(source.indexOf("mount('#app')")).toBeLessThan(source.indexOf('pageWatch?.mounted()'))
  })
})
