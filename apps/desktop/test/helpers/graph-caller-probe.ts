import type { Worker } from 'node:worker_threads'
import type { GraphWorker } from '../../src/main/db/team-profile-graph-reader'

/** Times synchronous caller work separately from time spent waiting for the worker. */
export class GraphCallerProbe {
  readonly phases: Record<string, { calls: number; maxMs: number; maxCpuMs: number }> = {}

  call<T>(phase: string, action: () => T): T {
    const start = performance.now()
    const cpu = process.threadCpuUsage()
    try {
      return action()
    } finally {
      const elapsed = performance.now() - start
      const used = process.threadCpuUsage(cpu)
      const stats = (this.phases[phase] ??= { calls: 0, maxMs: 0, maxCpuMs: 0 })
      stats.calls++
      stats.maxMs = Math.max(stats.maxMs, elapsed)
      stats.maxCpuMs = Math.max(stats.maxCpuMs, (used.user + used.system) / 1000)
    }
  }

  worker(worker: Worker): GraphWorker {
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
