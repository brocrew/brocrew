/**
 * A launcher an app-server started, as a shell running `start` is: it starts a program detached, so
 * the program outlives it, and exits once `<logPath>.launcher-may-go` exists. The program is a
 * stubborn {@link ./codex-descendant.mjs}, which announces itself at `<logPath>.pid`; the launcher
 * announces itself at `<logPath>.launcher`.
 *
 * Argv: `<logPath>`. It writes only beside `logPath`, and exits after 30 s whatever happens.
 */
import { spawn } from 'node:child_process'
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const logPath = process.argv[2]
const program = join(dirname(fileURLToPath(import.meta.url)), 'codex-descendant.mjs')
spawn(process.execPath, [program, logPath, 'stubborn'], { stdio: 'ignore', detached: true }).unref()

writeFileSync(`${logPath}.launcher.partial`, `${process.pid}\n`)
renameSync(`${logPath}.launcher.partial`, `${logPath}.launcher`)

setInterval(() => {
  if (existsSync(`${logPath}.launcher-may-go`)) process.exit(0)
}, 20)
setTimeout(() => process.exit(0), 30_000).unref?.()
