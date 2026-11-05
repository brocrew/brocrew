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
    if (!work?.live || !work.mutation || (work.target !== '*' && work.target !== target))
      unavailable()
  }
  /** Consumer replies can be abandoned; filesystem effects are always awaited to settlement. */
  async consumer<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) return unavailable()
    return Promise.race([Promise.resolve().then(run), this.interrupted.then(unavailable)])
  }
  async close(): Promise<void> {
    this.closing = true
    this.interrupt()
    await Promise.allSettled([...this.operations.values()].map((work) => work.result))
  }
  get idle(): boolean {
    return this.operations.size === 0
  }
}
