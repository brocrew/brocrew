export type ShutdownSignal = 'SIGTERM' | 'SIGINT' | 'SIGBREAK'
export interface ShutdownDeps {
  closeAll: () => Promise<void>
  capMs?: number
  exit?: (code: number) => void
  on?: (signal: ShutdownSignal, handler: () => void) => void
  off?: (signal: ShutdownSignal, handler: () => void) => void
  platform?: NodeJS.Platform
  setTimeout?: (fn: () => void, ms: number) => unknown
}
// Stop gives the browser the host's 1.5 s POSIX signal grace to flush. The guardian then
// kills remaining process groups, even if a browser could not answer its close request.
export const SHUTDOWN_CAP_MS = 1500
export function installShutdownSignals(deps: ShutdownDeps): () => void {
  const exit = deps.exit ?? ((code: number) => process.exit(code))
  const on = deps.on ?? ((s, h) => process.on(s, h))
  const off = deps.off ?? ((s, h) => process.off(s, h))
  const later = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const cap = deps.capMs ?? SHUTDOWN_CAP_MS
  let shuttingDown = false
  const handle = (code: number) => () => {
    if (shuttingDown) {
      exit(code)
      return
    }
    shuttingDown = true
    const capped = new Promise<void>((resolve) => later(resolve, cap))
    void Promise.race([deps.closeAll().catch(() => undefined), capped]).then(() => exit(code))
  }
  const onTerm = handle(143)
  const onInt = handle(130)
  const onBreak = handle(149)
  const windows = (deps.platform ?? process.platform) === 'win32'
  on('SIGTERM', onTerm)
  on('SIGINT', onInt)
  if (windows) on('SIGBREAK', onBreak)
  return () => {
    off('SIGTERM', onTerm)
    off('SIGINT', onInt)
    if (windows) off('SIGBREAK', onBreak)
  }
}
