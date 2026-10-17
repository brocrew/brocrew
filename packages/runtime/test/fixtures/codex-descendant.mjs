/**
 * 240 · **A descendant of the app-server, standing in for a sandboxed command.**
 *
 * The leader ({@link ./codex-leader.mjs}) spawns one of these and then exits on stdin EOF, which is
 * exactly the tree `SpawnCodexTransport` tears down: a leader that goes quietly and a child of the
 * leader that does not. ⚠️ **Nothing here traps SIGKILL** — nothing can — so what it measures is the
 * interval between the group's SIGTERM and the group's SIGKILL, which is the only interval in which
 * a descendant of ours can do anything at all.
 *
 * Argv: `<logPath> <mode>` where `mode` is one of
 *  - `stubborn`     — records signals, never exits on its own. What survives, survives.
 *  - `slow-clean`   — records SIGTERM, then spends {@link CLEANUP_MS} shutting down and writes
 *    `<logPath>.cleaned`. ⛔ **The marker is the witness that a real grace existed**: it cannot be
 *    written by a process that was SIGKILLed a millisecond after its SIGTERM, so its presence is a
 *    fact about the reaper rather than a timing coincidence.
 *  - `cooperative`  — exits immediately on SIGTERM. The control that proves the instrument can see
 *    a descendant die.
 *
 * 🔒 It writes only inside the directory it was handed, signals nobody, and hard-exits after
 * {@link SAFETY_MS} so a failed measurement can never leave a process behind.
 */
import { appendFileSync, renameSync, writeFileSync } from 'node:fs'

const CLEANUP_MS = 300
const SAFETY_MS = 30_000

const logPath = process.argv[2]
const mode = process.argv[3] ?? 'stubborn'

/**
 * ⚠️ **Announced by `rename`, not by `write`.** A reader that waits on `existsSync` and then reads
 * can otherwise land between the `open` and the bytes, and gets an empty file — `Number('')` is `0`,
 * which fails an assertion with a message about the fixture rather than about the code. Measured
 * once, in `pnpm run ci`, on the one row of the table that spawns fastest.
 */
function announce(path, text) {
  const staging = `${path}.partial`
  writeFileSync(staging, text)
  renameSync(staging, path)
}

announce(`${logPath}.pid`, `${process.pid}\n`)

function record(signal) {
  try {
    appendFileSync(logPath, `${signal}\n`)
  } catch {
    // the measurement's directory is gone; there is nothing useful left to say
  }
}

let leaving = false

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  process.on(signal, () => {
    record(signal)
    if (mode === 'cooperative') process.exit(0)
    if (mode === 'slow-clean' && signal === 'SIGTERM' && !leaving) {
      leaving = true
      setTimeout(() => {
        announce(`${logPath}.cleaned`, `${Date.now()}\n`)
        process.exit(0)
      }, CLEANUP_MS)
    }
  })
}

// Keep the loop alive without spinning; the timer above is what ends a `slow-clean` run.
const safety = setTimeout(() => process.exit(0), SAFETY_MS)
safety.unref?.()
setInterval(() => {}, 1_000)
