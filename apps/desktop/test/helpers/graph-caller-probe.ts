import { Worker } from 'node:worker_threads'
import { PerformanceObserver } from 'node:perf_hooks'
import type { ReaderWorker } from '../../src/main/db/reader-worker-lifetime'

type Span = { phase: string; start: number; end: number; cpuMs: number; depth: number }
type Gap = { start: number; end: number; delayMs: number; threadCpuMs: number }
const intervalMs = 10
const controlCapacity = 8192

/** Times synchronous caller work separately from time spent waiting for the worker. */
export class GraphCallerProbe {
  readonly phases: Record<string, { calls: number; maxMs: number; maxCpuMs: number }> = {}
  readonly spans: Span[] = []
  private depth = 0
  private windowWallMs = 0
  private windowCpuMs = 0

  call<T>(phase: string, action: () => T): T {
    if (this.spans.length + this.depth >= 256) throw new Error('Graph probe span budget exceeded')
    const start = performance.now()
    const cpu = process.threadCpuUsage()
    const depth = this.depth++
    try {
      return action()
    } finally {
      const end = performance.now()
      const elapsed = end - start
      const used = process.threadCpuUsage(cpu)
      const cpuMs = (used.user + used.system) / 1000
      this.depth--
      this.spans.push({ phase, start, end, cpuMs, depth })
      if (depth === 0) {
        this.windowWallMs += elapsed
        this.windowCpuMs += cpuMs
      }
      const stats = (this.phases[phase] ??= { calls: 0, maxMs: 0, maxCpuMs: 0 })
      stats.calls++
      stats.maxMs = Math.max(stats.maxMs, elapsed)
      stats.maxCpuMs = Math.max(stats.maxCpuMs, cpuMs)
    }
  }

  takeWindow() {
    const work = { wallMs: this.windowWallMs, cpuMs: this.windowCpuMs }
    this.windowWallMs = this.windowCpuMs = 0
    return work
  }

  worker(worker: Worker): ReaderWorker {
    return {
      on: (event, listener) => {
        worker.on(event, (...args: unknown[]) =>
          this.call(event, () => (listener as (...args: unknown[]) => void)(...args)),
        )
      },
      postMessage: (...args) => this.call('postMessage', () => worker.postMessage(...args)),
      terminate: () => this.call('terminate', () => worker.terminate()),
    }
  }

  get maxMs(): number {
    return Math.max(0, ...Object.values(this.phases).map((phase) => phase.maxMs))
  }
}

/** Keeps both the slowest timer gap and the gap containing the most graph work. */
export class GraphHeartbeatProbe {
  private readonly state = new BigInt64Array(
    new SharedArrayBuffer((3 + 2 * controlCapacity) * BigInt64Array.BYTES_PER_ELEMENT),
  )
  private control: Worker | undefined
  private controlError: Error | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private readonly gcEntries: { start: number; duration: number }[] = []
  private readonly gc = new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      this.gcEntries.push({ start: entry.startTime, duration: entry.duration })
  })
  private origin = 0
  private previous = 0
  private previousCpu = process.threadCpuUsage()
  private ticks = 0
  private worst: Gap = { start: 0, end: 0, delayMs: 0, threadCpuMs: 0 }
  private mostWork: Gap = this.worst
  private maxWorkMs = 0

  constructor(private readonly caller: GraphCallerProbe) {}

  async start(): Promise<void> {
    this.gc.observe({ entryTypes: ['gc'] })
    const control = (this.control = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads')
      const { buffer, capacity, intervalMs } = workerData
      const state = new BigInt64Array(buffer)
      let previous = performance.now()
      setInterval(() => {
        const now = performance.now()
        if (Atomics.load(state, 2) === 1n) {
          const delay = BigInt(Math.max(0, Math.round((now - previous - intervalMs) * 1000)))
          if (delay > Atomics.load(state, 0)) Atomics.store(state, 0, delay)
          const count = Number(Atomics.load(state, 1))
          if (count < capacity) {
            Atomics.store(state, 3 + count * 2, BigInt(Math.round((performance.timeOrigin + previous) * 1000)))
            Atomics.store(state, 4 + count * 2, BigInt(Math.round((performance.timeOrigin + now) * 1000)))
          }
          Atomics.store(state, 1, BigInt(count + 1))
        }
        previous = now
      }, intervalMs)
      parentPort.postMessage('ready')
      `,
      {
        eval: true,
        workerData: { buffer: this.state.buffer, capacity: controlCapacity, intervalMs },
      },
    ))
    control.on('error', (error) => (this.controlError = error))
    await new Promise<void>((resolve, reject) => {
      const ready = () => finish()
      const failed = (error: Error) => finish(error)
      const exited = (code: number) =>
        finish(new Error(`Graph control worker exited before startup (${code})`))
      const timeout = setTimeout(
        () => finish(new Error('Graph control worker did not start within 5 seconds')),
        5000,
      )
      function finish(error?: Error) {
        clearTimeout(timeout)
        control.removeListener('message', ready)
        control.removeListener('error', failed)
        control.removeListener('exit', exited)
        if (error) reject(error)
        else resolve()
      }
      control.once('message', ready)
      control.once('error', failed)
      control.once('exit', exited)
    })
    Atomics.store(this.state, 2, 1n)
    this.origin = this.previous = performance.now()
    this.previousCpu = process.threadCpuUsage()
    this.worst = this.mostWork = {
      start: this.origin,
      end: this.origin,
      delayMs: 0,
      threadCpuMs: 0,
    }
    this.timer = setInterval(() => this.tick(), intervalMs)
  }

  private tick(): void {
    const end = performance.now()
    const cpu = process.threadCpuUsage()
    const gap: Gap = {
      start: this.previous,
      end,
      delayMs: Math.max(0, end - this.previous - intervalMs),
      threadCpuMs: (cpu.user - this.previousCpu.user + cpu.system - this.previousCpu.system) / 1000,
    }
    const work = this.caller.takeWindow()
    if (gap.delayMs > this.worst.delayMs) this.worst = gap
    if (work.wallMs > this.maxWorkMs) {
      this.maxWorkMs = work.wallMs
      this.mostWork = gap
    }
    this.previous = end
    this.previousCpu = cpu
    this.ticks++
  }

  report() {
    this.tick()
    clearInterval(this.timer)
    this.timer = undefined
    Atomics.store(this.state, 2, 0n)
    if (this.controlError) throw this.controlError
    const count = Number(Atomics.load(this.state, 1))
    if (count === 0) throw new Error('Graph control tick did not run')
    for (const entry of this.gc.takeRecords())
      this.gcEntries.push({ start: entry.startTime, duration: entry.duration })
    this.gc.disconnect()
    const controls = Array.from({ length: Math.min(controlCapacity, count) }, (_, i) => ({
      start: Number(Atomics.load(this.state, 3 + i * 2)) / 1000 - performance.timeOrigin,
      end: Number(Atomics.load(this.state, 4 + i * 2)) / 1000 - performance.timeOrigin,
    }))
    const attribute = (gap: Gap) => {
      const overlap = (a: number, b: number) =>
        Math.max(0, Math.min(b, gap.end) - Math.max(a, gap.start))
      const spans = this.caller.spans.filter((span) => overlap(span.start, span.end) > 0)
      const roots = spans.filter((span) => span.depth === 0)
      const graphWallMs = roots.reduce((sum, span) => sum + overlap(span.start, span.end), 0)
      const graphCpuMs = roots
        .filter((span) => span.start >= gap.start && span.end <= gap.end)
        .reduce((sum, span) => sum + span.cpuMs, 0)
      const ticks = controls.filter((tick) => overlap(tick.start, tick.end) > 0)
      return {
        startMs: gap.start - this.origin,
        endMs: gap.end - this.origin,
        durationMs: gap.end - gap.start,
        delayMs: gap.delayMs,
        threadCpuMs: gap.threadCpuMs,
        graphWallMs,
        graphCpuMs,
        unassignedWallMs: gap.end - gap.start - graphWallMs,
        unassignedCpuMs: Math.max(0, gap.threadCpuMs - graphCpuMs),
        spans: spans.map((span) => ({
          ...span,
          start: span.start - this.origin,
          end: span.end - this.origin,
        })),
        gc: this.gcEntries
          .filter((entry) => overlap(entry.start, entry.start + entry.duration) > 0)
          .map((entry) => ({
            startMs: entry.start - this.origin,
            durationMs: entry.duration,
            overlapMs: overlap(entry.start, entry.start + entry.duration),
          })),
        controlTicks: ticks.map((tick) => ({
          startMs: tick.start - this.origin,
          endMs: tick.end - this.origin,
          delayMs: Math.max(0, tick.end - tick.start - intervalMs),
          overlapMs: overlap(tick.start, tick.end),
        })),
        controlTickMaxDelayMs: Math.max(
          0,
          ...ticks.map((tick) => tick.end - tick.start - intervalMs),
        ),
        controlRecordedThroughMs: (controls.at(-1)?.end ?? 0) - this.origin,
        controlTruncated: count > controlCapacity,
        controlCoversGap:
          ticks.length > 0 &&
          ticks[0]!.start <= gap.start &&
          ticks.at(-1)!.end >= gap.end &&
          count <= controlCapacity,
      }
    }
    return {
      heartbeatMaxDelayMs: this.worst.delayMs,
      heartbeatMaxGraphWorkMs: this.maxWorkMs,
      heartbeatTicks: this.ticks,
      worstHeartbeatGap: attribute(this.worst),
      maxGraphWorkGap: attribute(this.mostWork),
      controlTickMaxDelayMs: Number(Atomics.load(this.state, 0)) / 1000,
      controlTickTicks: count,
    }
  }

  async close(): Promise<void> {
    clearInterval(this.timer)
    this.gc.disconnect()
    Atomics.store(this.state, 2, 0n)
    await this.control?.terminate()
  }
}
