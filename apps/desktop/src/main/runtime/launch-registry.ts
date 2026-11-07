export interface Launch {
  readonly what: string
  readonly subject: string | null
  readonly signal: AbortSignal
  readonly settled: Promise<void>
}

export interface LaunchRegistry {
  open(what: string, subject?: string | null): Launch
  refuse(subject: string): string | null
  finish(launch: Launch, terminated?: PromiseLike<unknown>): void
  cancel(launch: Launch): void
  closeAdmission(): void
  subjects(): Iterable<string>
  readonly closed: boolean
  pending(): Promise<void>
  gone(subject: string, except?: Launch): Promise<void>
  readonly size: number
}

interface Entry {
  readonly launch: Launch
  readonly abort: AbortController
  readonly release: () => void
  finished: boolean
}

export function createLaunchRegistry(): LaunchRegistry {
  const entries = new Set<Entry>()
  let closed = false

  const refuse = (subject: string): string | null => {
    if (closed) return 'BroCrew is shutting down'
    for (const entry of entries) {
      if (entry.launch.subject === subject) {
        return 'its provider has not confirmed it stopped'
      }
    }
    return null
  }

  return {
    open(what, subject = null) {
      const why = subject === null ? (closed ? 'BroCrew is shutting down' : null) : refuse(subject)
      if (why !== null) throw new Error(`${what} was refused: ${why}`)
      const abort = new AbortController()
      let release!: () => void
      const settled = new Promise<void>((resolve) => {
        release = resolve
      })
      const entry: Entry = {
        launch: { what, subject, signal: abort.signal, settled },
        abort,
        release,
        finished: false,
      }
      entries.add(entry)
      return entry.launch
    },

    refuse,

    finish(launch, terminated) {
      for (const entry of entries) {
        if (entry.launch !== launch) continue
        if (entry.finished) return
        entry.finished = true
        if (terminated === undefined) {
          entries.delete(entry)
          entry.release()
          return
        }
        void Promise.resolve(terminated).then(
          () => {
            entries.delete(entry)
            entry.release()
          },
          () => {
            entries.delete(entry)
            entry.release()
          },
        )
        return
      }
    },

    subjects() {
      const held: string[] = []
      for (const entry of entries) {
        if (entry.launch.subject !== null) held.push(entry.launch.subject)
      }
      return held
    },

    cancel(launch) {
      for (const entry of entries) {
        if (entry.launch === launch) {
          entry.abort.abort()
          return
        }
      }
    },

    closeAdmission() {
      closed = true
      for (const entry of [...entries]) entry.abort.abort()
    },

    get closed(): boolean {
      return closed
    },

    pending() {
      return Promise.all([...entries].map((entry) => entry.launch.settled)).then(() => undefined)
    },

    gone(subject, except) {
      const held = [...entries].filter(
        (entry) => entry.launch.subject === subject && entry.launch !== except,
      )
      return Promise.all(held.map((entry) => entry.launch.settled)).then(() => undefined)
    },

    get size(): number {
      return entries.size
    },
  }
}
