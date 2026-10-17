/**
 * 240 · **A Codex-shaped leader: it spawns a descendant and then exits when we end its stdin.**
 *
 * ⚑ This is the tree `202` measured the outside of and left the inside of unmeasured. Its own
 * comment in `codex-transport.ts` says what it did not cover: *"a descendant the app-server itself
 * spawned and left running (a sandboxed command)"*. This is that descendant, in a process whose
 * cooperative exit is identical to the real app-server's — ⛔ **stdin EOF, which is exactly how
 * `doReapGroup` starts every teardown.**
 *
 * Argv: `<logPath> <placement> <mode>` where `placement` is
 *  - `in-group` — an ordinary `spawn`, so the descendant inherits the leader's process group. This
 *    is what a program that does not call `setsid` produces, and it is the case the group kill is
 *    supposed to cover.
 *  - `escaped`  — `detached: true`, i.e. `setsid()`: its own session and its own process group. ⛔
 *    **Nothing addressed to the leader's group can ever reach it**, and that is the point of
 *    measuring it rather than assuming it away.
 *  - `launcher` — a {@link ./codex-launcher.mjs}, which starts the descendant detached and exits when
 *    told: a program left running by a parent that is gone.
 *  - `none`     — no descendant at all: the healthy path, and the latency control §5 asks for.
 *
 * `mode` is passed through to {@link ./codex-descendant.mjs}. An optional fourth argument, `stays`,
 * makes the leader ignore the end of its stdin, so a teardown has to end it at its deadline. Once
 * its descendant runs, the leader says so as Codex does, with an `item/started` line.
 */
import { spawn } from 'node:child_process'
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const logPath = process.argv[2]
const placement = process.argv[3] ?? 'in-group'
const mode = process.argv[4] ?? 'stubborn'
const stays = process.argv[5] === 'stays'

if (placement !== 'none') {
  const here = dirname(fileURLToPath(import.meta.url))
  const child =
    placement === 'launcher'
      ? spawn(process.execPath, [join(here, 'codex-launcher.mjs'), logPath], { stdio: 'ignore' })
      : spawn(process.execPath, [join(here, 'codex-descendant.mjs'), logPath, mode], {
          stdio: 'ignore',
          detached: placement === 'escaped',
        })
  child.unref()
  // Said once the descendant runs, so a reading taken then sees it and what started it.
  const said = setInterval(() => {
    if (!existsSync(`${logPath}.pid`)) return
    clearInterval(said)
    process.stdout.write(
      `${JSON.stringify({ method: 'item/started', params: { item: { type: 'commandExecution' } } })}\n`,
    )
  }, 20)
}

// ⛔ **Readiness, announced even when there is no descendant to announce** (240, own review). The
// healthy-path row measures a TEARDOWN, and without this the caller's clock also contains node's
// startup — which on a machine running four test projects is the difference between a latency
// control and a flake. Written by `rename` so it cannot be read half-made.
writeFileSync(`${logPath}.leader.partial`, `${process.pid}\n`)
renameSync(`${logPath}.leader.partial`, `${logPath}.leader`)

// The app-server's own cooperative shutdown: read stdin, exit on EOF. `202` measured that this is
// why a SIGKILLed parent leaves no orphan leader — and it is also why the leader is always the
// first thing to go, which is what makes the descendant question reachable at all.
process.stdin.resume()
if (!stays) {
  process.stdin.on('end', () => process.exit(0))
  process.stdin.on('close', () => process.exit(0))
}
// Never outlive a failed measurement.
setTimeout(() => process.exit(0), 30_000).unref?.()
