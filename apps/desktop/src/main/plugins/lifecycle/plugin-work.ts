import { PluginSupervisorError } from '../supervisor/protocol'

/** A consumer step's time limit: past it the step refuses cleanup-pending, and its work goes on. */
export async function bounded<T>(work: () => Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PluginSupervisorError('cleanup-pending')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
/** Lifecycle work for one plugin runs in order; work for different plugins never waits on it. */
export class PluginWorkQueue {
  readonly #tails = new Map<string, Promise<void>>()
  /** `admit` runs as each job starts and refuses it by throwing. */
  constructor(private readonly admit: () => void) {}
  run<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (this.#tails.get(id) ?? Promise.resolve()).then(() => {
      this.admit()
      return work()
    })
    const tail = result.then(
      () => {},
      () => {},
    )
    this.#tails.set(id, tail)
    void tail.then(() => {
      if (this.#tails.get(id) === tail) this.#tails.delete(id)
    })
    return result
  }
  ids(): string[] {
    return [...this.#tails.keys()]
  }
  settled(): Promise<unknown> {
    return Promise.allSettled(this.#tails.values())
  }
}
