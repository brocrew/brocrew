import { spawn } from 'node:child_process'

type MetadataChild = {
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'close', listener: (code: number | null) => void): unknown
  kill(signal: NodeJS.Signals): boolean
}
type MetadataSpawn = (
  file: string,
  args: readonly string[],
  options: { stdio: 'ignore'; windowsHide: true },
) => MetadataChild

const PRESENCE_TIMEOUT_MS = 1_500

/** Item presence only: no password flag, no output retained, and no promise about login validity. */
export function machineLoginPresence(
  signal?: AbortSignal,
  spawnFor: MetadataSpawn = spawn,
): Promise<boolean | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    let child: MetadataChild
    try {
      child = spawnFor(
        '/usr/bin/security',
        ['find-generic-password', '-s', 'Claude Code-credentials'],
        { stdio: 'ignore', windowsHide: true },
      )
    } catch {
      resolve(undefined)
      return
    }
    let stopped = false
    let failed = false
    let closed = false
    const stop = (): void => {
      if (stopped || closed) return
      stopped = true
      try {
        child.kill('SIGKILL')
      } catch {
        failed = true
      }
    }
    const timer = setTimeout(stop, PRESENCE_TIMEOUT_MS)
    child.once('error', () => {
      failed = true
    })
    child.once('close', (code) => {
      closed = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve(stopped || failed ? undefined : code === 0 ? true : code === 44 ? false : undefined)
    })
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
  })
}
