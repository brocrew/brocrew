import log from 'electron-log'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CommittedWrite } from '../db/committed-changes'

export const LOG_MAX_BYTES = 5 * 1024 * 1024

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

// No file is opened until the process chooses its path.
log.transports.file.level = false
log.transports.console.level = false
log.transports.file.maxSize = LOG_MAX_BYTES
log.transports.file.inspectOptions = { depth: 4, breakLength: Infinity, compact: true }

// The transport captured the original console methods before these wrappers were installed.
for (const level of ['warn', 'error'] as const) {
  const original = console[level]
  console[level] = (...data: unknown[]) => {
    if (process.stderr.isTTY && log.transports.console.level !== false) {
      log.processMessage(
        { data: [...data], date: new Date(), level, scope: 'console' },
        { transports: ['console'] },
      )
    } else original(...data)
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
  log.transports.file.setAppName('BroCrew')
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

export interface DatabaseWriteSummary {
  readonly component: string
  readonly tables: readonly string[]
  readonly transactions: number
  readonly rows: number
  readonly ms: number
  readonly longestMs: number
  readonly periodMs: number
}

/** Only numeric commit totals and table names survive until the next minute. */
export function createDatabaseWriteLog(
  write: (summary: DatabaseWriteSummary) => void = (summary) =>
    logInfo('database', 'committed writes', { ...summary }),
  now: () => number = () => performance.now(),
) {
  let began = now()
  const totals = new Map<
    string,
    { tables: Set<string>; transactions: number; rows: number; ms: number; longestMs: number }
  >()
  const flush = (): void => {
    const ended = now()
    const periodMs = ended - began
    began = ended
    const ready = [...totals]
    totals.clear()
    for (const [component, total] of ready) {
      try {
        write({
          component,
          tables: [...total.tables].sort(),
          transactions: total.transactions,
          rows: total.rows,
          ms: total.ms,
          longestMs: total.longestMs,
          periodMs,
        })
      } catch {
        // Logging failures do not stop the app or requeue a minute of writes.
      }
    }
  }
  const timer = setInterval(flush, 60_000)
  timer.unref()
  return {
    record(commit: CommittedWrite, tables: ReadonlySet<string>): void {
      let total = totals.get(commit.component)
      if (total === undefined) {
        total = { tables: new Set(), transactions: 0, rows: 0, ms: 0, longestMs: 0 }
        totals.set(commit.component, total)
      }
      total.transactions++
      total.rows += commit.rows
      total.ms += commit.ms
      total.longestMs = Math.max(total.longestMs, commit.ms)
      for (const table of tables) total.tables.add(table)
    },
    flush,
    stop(): void {
      clearInterval(timer)
      flush()
    },
  }
}

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
