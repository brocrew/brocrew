import log from 'electron-log'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const LOG_MAX_BYTES = 5 * 1024 * 1024

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

// No file is opened until the process chooses its path.
log.transports.file.level = false
log.transports.console.level = false
log.transports.file.maxSize = LOG_MAX_BYTES
log.transports.file.inspectOptions = { depth: 4, breakLength: Infinity, compact: true }

// Keep console output unchanged; the library's file-only transport avoids printing it twice.
for (const level of ['warn', 'error'] as const) {
  const original = console[level]
  console[level] = (...data: unknown[]) => {
    original(...data)
    log.processMessage(
      { data, date: new Date(), level, scope: 'console' },
      { transports: ['file'] },
    )
  }
}

// Observing also covers default unhandled rejections without replacing crash handlers.
process.on('uncaughtExceptionMonitor', (error, origin) => {
  log.processMessage(
    { data: [error], date: new Date(), level: 'error', scope: origin },
    { transports: ['file'] },
  )
})

/** App writes are asynchronous; the standalone service uses sync before its immediate exit. */
export function openLog(
  file: string,
  options: { debug?: boolean; console?: boolean; maxBytes?: number; sync?: boolean } = {},
): void {
  log.transports.file.maxSize = options.maxBytes ?? LOG_MAX_BYTES
  log.transports.file.sync = options.sync === true
  log.transports.file.resolvePathFn = () => file
  log.transports.file.level = options.debug ? 'debug' : 'info'
  log.transports.console.level = options.console === false ? false : 'warn'
}

export function setDebug(on: boolean): void {
  if (log.transports.file.level !== false) log.transports.file.level = on ? 'debug' : 'info'
}

export function debugIsOn(): boolean {
  return log.transports.file.level === 'debug'
}

export function logLine(
  level: LogLevel,
  part: string,
  message: string,
  facts?: Record<string, unknown>,
): void {
  const scoped = log.scope(part)
  if (facts) scoped[level](message, facts)
  else scoped[level](message)
}

export const logError = (part: string, message: string, facts?: Record<string, unknown>) =>
  logLine('error', part, message, facts)
export const logWarn = (part: string, message: string, facts?: Record<string, unknown>) =>
  logLine('warn', part, message, facts)
export const logInfo = (part: string, message: string, facts?: Record<string, unknown>) =>
  logLine('info', part, message, facts)
export const logDebug = (part: string, message: string, facts?: Record<string, unknown>) =>
  logLine('debug', part, message, facts)

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const appLogFile = (userData: string): string => join(userData, 'logs', 'brocrew.log')
export const serviceLogFile = (pluginRoot: string): string => join(pluginRoot, 'service.log')

const SETTINGS_FILE = 'logging.json'

/** Debug mode is a saved workspace choice: `{ "debug": true }` in the data folder. */
export async function readDebugChoice(userData: string): Promise<boolean> {
  try {
    const saved: unknown = JSON.parse(await readFile(join(userData, SETTINGS_FILE), 'utf8'))
    return (saved as { debug?: unknown }).debug === true
  } catch {
    return false
  }
}

export async function saveDebugChoice(userData: string, debug: boolean): Promise<void> {
  const file = join(userData, SETTINGS_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ debug })}\n`)
}
