import type { ChildProcess } from 'node:child_process'

const GRACE_MS = 2000
const POLL_MS = 25

export interface ClaudeProcessGroup {
  close(): Promise<void>
  readonly quiesced: Promise<void>
  identify(sessionId: string | undefined): void
}

// Only children spawned as private group leaders may enter this registry.
export const claudeProcessGroups = new WeakMap<ChildProcess, ClaudeProcessGroup>()

export function ownClaudeProcessGroup(child: ChildProcess): ClaudeProcessGroup {
  const pid = child.pid
  let markExited!: () => void
  const exited = new Promise<void>((resolve) => {
    markExited = resolve
  })
  let markQuiet!: () => void
  const quiet = new Promise<void>((resolve) => {
    markQuiet = resolve
  })
  let reaping: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let sessionId: string | undefined
  let warned = false
  function warn(error: unknown): void {
    if (warned) return
    warned = true
    console.warn('Claude process group exit is unconfirmed:', {
      pgid: pid,
      providerSessionId: sessionId ?? null,
      errno: (error as NodeJS.ErrnoException).code ?? 'unknown',
      error,
    })
  }

  function signal(value: NodeJS.Signals | 0): boolean {
    if (pid === undefined) return false
    try {
      process.kill(-pid, value)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw error
    }
  }

  async function waitQuiet(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms
    do {
      if (!signal(0)) return true
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS))
    } while (Date.now() < deadline)
    return !signal(0)
  }

  async function observeQuiet(): Promise<void> {
    for (;;) {
      try {
        if (!signal(0)) {
          markQuiet()
          return
        }
      } catch (error) {
        // EPERM still means the group exists; keep its launch held as unknown until proven empty.
        warn(error)
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000)
        timer.unref()
      })
    }
  }

  async function reap(): Promise<void> {
    try {
      if (!signal('SIGTERM') || (await waitQuiet(GRACE_MS))) {
        markQuiet()
        return
      }
      signal('SIGKILL')
      if (await waitQuiet(GRACE_MS)) markQuiet()
      else {
        console.warn(`Claude process group ${pid} still has a member after SIGKILL`)
        void observeQuiet()
      }
    } catch (error) {
      warn(error)
      void observeQuiet()
    }
  }

  const reapOnce = (): Promise<void> => (reaping ??= reap())
  child.once('exit', () => {
    markExited()
    void reapOnce()
  })
  child.once('error', () => {
    if (child.pid === undefined) {
      markExited()
      markQuiet()
    }
  })

  const group = {
    identify: (id: string | undefined): void => {
      sessionId = id
    },
    quiesced: Promise.all([exited, quiet]).then(() => undefined),
    close: (): Promise<void> =>
      (closing ??= (async () => {
        child.stdin?.end()
        let timer!: ReturnType<typeof setTimeout>
        try {
          await Promise.race([
            exited,
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, GRACE_MS)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
        await reapOnce()
      })()),
  }
  claudeProcessGroups.set(child, group)
  return group
}
