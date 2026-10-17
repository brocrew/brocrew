#!/usr/bin/env node
/**
 * Stable process-group leader for ownership-scoped live instruments.
 *
 * Package-manager executables are often shell shims which `exec` Node under the same pid. That is
 * correct launcher behaviour but deliberately incompatible with an immutable teardown identity.
 * This process is started through `process.execPath`, never execs, and keeps the real command in
 * its process group until that command exits. The parent can therefore revalidate one stable
 * executable/start/parent identity before signalling the group.
 */
import { spawn } from 'node:child_process'

const CLAIM = 'brobot2-owned-launcher-claimed'
let claimed = false

// Group-directed graceful signals already reach pnpm, Electron, and their ordinary descendants.
// The supervisor itself ignores them and stays the revalidated group leader WHILE ITS CHILD RUNS,
// so later escalation still has ownership authority. Once the child exits, these signal listeners
// do not hold Node's event loop open; SIGKILL remains uncatchable.
// ⛔ **722 · "while its child runs" is the whole of it, and this comment claimed more** (since 345).
// It said the supervisor stays alive for step 38's deliberate second signal — but the child is
// `pnpm`, and a group SIGINT ends `pnpm` in milliseconds while Electron spends a second shutting
// down, so this process had exited before that signal in every batch that ran 38 (`717` F-3: "the
// launcher reads gone, not alive"). ⚑ Step 38's second SIGINT now goes to the app's own main process
// by its remembered identity — `signalRememberedWhy` in `owned-process.mjs`.
process.on('SIGINT', () => {})
process.on('SIGTERM', () => {})

const failClosed = () => {
  if (claimed) return
  // This process is still the live leader of the detached group it is signalling. No historical
  // pid or external port lookup is involved in the pre-handoff cleanup path.
  try {
    process.kill(-process.pid, 'SIGKILL')
  } catch {
    process.kill(process.pid, 'SIGKILL')
  }
}
const lease = setTimeout(failClosed, 5_000)

if (typeof process.send !== 'function' || !process.connected) {
  failClosed()
} else {
  process.once('disconnect', failClosed)
  process.on('message', (message) => {
    if (message?.type !== CLAIM || claimed) return
    claimed = true
    clearTimeout(lease)
    process.send?.({ type: CLAIM })
  })
}

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('owned-launcher requires a command')
  process.exitCode = 64
} else {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  let settled = false
  child.once('error', () => {
    if (settled) return
    settled = true
    process.exitCode = 127
  })
  child.once('exit', (code) => {
    if (settled) return
    settled = true
    process.exitCode = Number.isInteger(code) ? code : 1
  })
}
