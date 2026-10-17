/**
 * A Codex-shaped app-server that takes a while to stop: when its stdin ends it spends `<ms>` on its
 * own shutdown (as the real one finishes writing its records), then writes `<logPath>.stopped` and
 * exits. It finishes what it started whatever it is sent meanwhile, so on POSIX the SIGTERM that
 * follows the first grace does not cut it short either.
 *
 * Argv: `<logPath> <ms>`.
 */
import { renameSync, writeFileSync } from 'node:fs'

const logPath = process.argv[2]
const ms = Number(process.argv[3] ?? '1000')

writeFileSync(`${logPath}.leader.partial`, `${process.pid}\n`)
renameSync(`${logPath}.leader.partial`, `${logPath}.leader`)

process.on('SIGTERM', () => {})
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  setTimeout(() => {
    writeFileSync(`${logPath}.stopped`, 'stopped on its own\n')
    process.exit(0)
  }, ms)
}
process.stdin.resume()
process.stdin.on('end', stop)
process.stdin.on('close', stop)
// Never outlive a failed measurement.
setTimeout(() => process.exit(0), 30_000).unref?.()
