import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** How large the stall log grows before it is moved aside to `stalls.1.log`. */
export const STALL_LOG_MOST_BYTES = 8 * 1024 * 1024

/** How many lines are written between two looks at the log's size. */
const LINES_BETWEEN_SIZE_CHECKS = 200

/**
 * Appends to `stalls.log` in `logs`, kept to two files of at most {@link STALL_LOG_MOST_BYTES}:
 * the older one is replaced. Throws what the file system throws; the caller decides what a lost
 * line costs.
 */
export function aStallLog(logs: string): (line: string) => void {
  const file = join(logs, 'stalls.log')
  let written = 0
  let made = false
  return (line) => {
    if (!made) {
      mkdirSync(logs, { recursive: true })
      made = true
    }
    appendFileSync(file, `${line}\n`)
    written += 1
    if (written % LINES_BETWEEN_SIZE_CHECKS === 0 && statSync(file).size > STALL_LOG_MOST_BYTES) {
      renameSync(file, join(logs, 'stalls.1.log'))
    }
  }
}
