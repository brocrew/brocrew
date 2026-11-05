import { AsyncLocalStorage } from 'node:async_hooks'
import { PluginSupervisorError } from '../supervisor/protocol'

interface Work {
  target: string
  identity: string
  mutation: boolean
  live: boolean
  result: Promise<unknown>
}
const unavailable = (): never => {
  throw new PluginSupervisorError('cleanup-pending')
}

/** The supervisor lifetime lease owns this queue; no SQLite lease spans its awaited effects. */
export class PluginEffectQueue {
  private readonly context = new AsyncLocalStorage<Work>()
  private readonly operations = new Map<string, Work>()
  private readonly targets = new Map<string, Promise<void>>()
  private mutationTail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly abort = new AbortController()
  private readonly effects = new Set<Promise<unknown>>()
  private interrupt!: () => void
  private readonly interrupted = new Promise<void>((resolve) => {
    this.interrupt = resolve
  })
  mutate<T>(
    target: string,
    operation: string,
    identity: string,
    run: () => Promise<T>,
    admitted?: () => void,
  ): Promise<T> {
    return this.enqueue(target, operation, identity, true, run, admitted)
  }
  restart<T>(target: string, operation: string, run: () => Promise<T>): Promise<T> {
    if (this.targets.has(target))
      return Promise.reject(new PluginSupervisorError('cleanup-pending'))
    return this.enqueue(target, operation, 'restart', false, run)
  }
  private enqueue<T>(
    target: string,
    operation: string,
    identity: string,
    mutation: boolean,
    run: () => Promise<T>,
    admitted?: () => void,
  ): Promise<T> {
    const prior = this.operations.get(operation)
    if (prior) {
      if (prior.target !== target || prior.identity !== identity)
        return Promise.reject(new PluginSupervisorError('unavailable'))
      return prior.result as Promise<T>
    }
    if (this.closing) return Promise.reject(new PluginSupervisorError('cleanup-pending'))
    try {
      admitted?.()
    } catch (error) {
      return Promise.reject(error)
    }
    const predecessors = [this.targets.get(target)]
    if (mutation) predecessors.push(this.mutationTail)
    const entry: Work = { target, identity, mutation, live: false, result: Promise.resolve() }
    const result = Promise.allSettled(predecessors)
      .then(async () => {
        if (this.closing) return unavailable()
        entry.live = true
        return this.context.run(entry, run)
      })
      .finally(() => {
        entry.live = false
        this.operations.delete(operation)
      })
    entry.result = result
    this.operations.set(operation, entry)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.targets.set(target, settled)
    void settled.then(() => {
      if (this.targets.get(target) === settled) this.targets.delete(target)
    })
    if (mutation) this.mutationTail = settled
    return result
  }
  assertEffect(target: string): void {
    const work = this.context.getStore()
    if (
      this.closing ||
      !work?.live ||
      !work.mutation ||
      (work.target !== '*' && work.target !== target)
    )
      unavailable()
  }
  /** Start and retain a real effect before returning control to another task. */
  effect<T>(target: string, run: () => Promise<T>): Promise<T> {
    this.assertEffect(target)
    return this.track(run)
  }
  /** Content staging may precede a mutation, but still belongs to this owner's lifetime. */
  stage<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) return unavailable()
    return this.track(run)
  }
  private track<T>(run: () => Promise<T>): Promise<T> {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason: unknown) => void
    const result = new Promise<T>((yes, no) => {
      resolve = yes
      reject = no
    })
    this.effects.add(result)
    try {
      resolve(run())
    } catch (error) {
      reject(error)
    }
    void result.then(
      () => this.effects.delete(result),
      () => this.effects.delete(result),
    )
    return result
  }
  /** A synchronous commit cannot overlap drain; check its task immediately before calling it. */
  commit<T>(target: string, run: () => T): T {
    this.assertEffect(target)
    return run()
  }
  get signal(): AbortSignal {
    return this.abort.signal
  }
  /** Consumer replies can be abandoned; filesystem effects are always awaited to settlement. */
  async consumer<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) return unavailable()
    return Promise.race([
      Promise.resolve().then(() => {
        if (this.closing) return unavailable()
        return run()
      }),
      this.interrupted.then(unavailable),
    ])
  }
  beginClose(): void {
    if (this.closing) return
    this.closing = true
    for (const work of this.operations.values()) work.live = false
    this.abort.abort()
    this.interrupt()
  }
  async settled(): Promise<void> {
    await Promise.allSettled([...this.effects])
  }
  async close(): Promise<void> {
    this.beginClose()
    await this.settled()
  }
  get idle(): boolean {
    return this.effects.size === 0 && (this.closing || this.operations.size === 0)
  }
}
