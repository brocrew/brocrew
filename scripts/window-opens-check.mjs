#!/usr/bin/env node
import { GATE_SOCKET, SUN_PATH_MAX } from './lib/smoke-run.mjs'
import { freePort } from './lib/free-port.mjs'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'
import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'
import { pidsLeft, refusals } from './lib/teardown-words.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DESKTOP = join(REPO_ROOT, 'apps/desktop')
const ELECTRON = join(DESKTOP, 'node_modules/.bin/electron')
const ENTRY = join(DESKTOP, 'out/main/index.js')

const WINDOW_MS = 45_000
const POLL_MS = 250
const OWNERSHIP_MS = 10_000

async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) return null
    const list = await response.json()
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

async function main() {
  if (!existsSync(ENTRY)) {
    throw new Error(
      `the shipped entry point is not built: ${ENTRY} does not exist — run \`pnpm run build\` first ` +
        `(in \`pnpm run ci\` this step runs after \`build\`, so seeing this means the build did not ` +
        `produce a main bundle)`,
    )
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'brobot2-window-'))
  const socketPath = join(userDataDir, GATE_SOCKET)
  if (socketPath.length > SUN_PATH_MAX) {
    rmSync(userDataDir, { recursive: true, force: true })
    throw new Error(
      `this check cannot run in the configuration it exists to check: the gate socket path would be ` +
        `${String(socketPath.length)} bytes (${socketPath}), over the ${String(SUN_PATH_MAX)}-byte ` +
        `limit — so 236 §3's gate would fail open and the app would start for the wrong reason, ` +
        `which is exactly how the live smokes missed 241. Run with a shorter TMPDIR.`,
    )
  }

  const port = await freePort()
  let output = ''
  const child = spawn(
    ELECTRON,
    [
      `--remote-debugging-port=${String(port)}`,
      `--user-data-dir=${userDataDir}`,
      HIDDEN_LAUNCH_ARG,
      '.',
    ],
    {
      cwd: DESKTOP,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    },
  )
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))

  let exited = null
  child.on('exit', (code, signal) => (exited = signal ?? code))
  child.on('error', (error) => {
    output += `\ncould not launch ${ELECTRON}: ${error.message}`
    exited = 'never started'
  })

  let lifecycle = null
  let ownershipFailure = null
  const ownershipDeadline = Date.now() + OWNERSHIP_MS
  while (lifecycle === null && Date.now() < ownershipDeadline && exited === null) {
    try {
      lifecycle = createOwnedProcessLifecycle({
        launcherPid: child.pid,
        discoverDescendants: descendantsOf,
      })
    } catch (error) {
      ownershipFailure = error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  if (lifecycle === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // the group never existed, which is consistent with a launch that never started
    }
    throw new Error(
      `could not take ownership of the app this check launched (pid ${String(child.pid)}): ` +
        `${exited === null ? (ownershipFailure?.message ?? 'no reason was recorded') : `it exited first (${String(exited)})`}\n` +
        `   ⚠️ ${userDataDir} is left in place — a teardown that cannot say WHAT it started must ` +
        `not remove what that thing may still be writing to (325).\n` +
        `--- app output ---\n${output.trim() === '' ? '(nothing)' : output.trim()}`,
      { cause: ownershipFailure ?? undefined },
    )
  }

  const stop = () => {
    const outcome = tearDownAndRemove({ lifecycle, directory: userDataDir })
    child.stdout.destroy()
    child.stderr.destroy()
    return outcome
  }

  const unreaped = (outcome) =>
    `this check could not reap what it launched: ` +
    pidsLeft(outcome) +
    `. ⚠️ An app left running is the failure 241 is about — it perturbs everything measured after ` +
    `it (066) and must not hide behind a green line.\n` +
    `   ⚠️ ${userDataDir} was LEFT IN PLACE: removing the user-data directory of an app that may ` +
    `still be writing to it is what made \`fixture:check\` fail with ENOTEMPTY on 324's merge (325).` +
    refusals(outcome)

  const deadline = Date.now() + WINDOW_MS
  let pages = []
  let answered = false
  while (Date.now() < deadline) {
    const list = await targets(port)
    if (list !== null) {
      answered = true
      pages = list.filter(
        (target) =>
          target.type === 'page' &&
          typeof target.url === 'string' &&
          target.url !== '' &&
          target.url !== 'about:blank',
      )
      if (pages.length > 0) break
    }
    if (exited !== null) break
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  lifecycle.refreshDescendants()

  const gateRan = existsSync(socketPath)
  const diedOnItsOwn = exited
  let outcome = null
  let teardownFailure = null
  try {
    outcome = stop()
  } catch (error) {
    teardownFailure = error
  }
  const alsoUnreaped =
    teardownFailure !== null
      ? `\n   ⛔ …and the teardown itself failed: ${teardownFailure.message}`
      : outcome.complete
        ? ''
        : `\n   ⛔ …and ${unreaped(outcome)}`

  if (pages.length === 0) {
    throw new Error(
      `⛔ THE APP DID NOT OPEN A WINDOW.\n` +
        `   entry:      ${ENTRY}\n` +
        `   user data:  ${userDataDir}\n` +
        `   devtools:   ${answered ? 'answered, with no page target holding a document' : 'never answered'}` +
        `${diedOnItsOwn === null ? ' · the app was still running' : ` · the app exited on its own (${String(diedOnItsOwn)})`}\n` +
        `   ⚠️ a CDP endpoint that answers is not a window — see 241 §3.${alsoUnreaped}\n` +
        `--- app output ---\n${output.trim() === '' ? '(nothing)' : output.trim()}`,
    )
  }

  if (!gateRan) {
    throw new Error(
      `the window opened, but 236 §3's gate left no socket at ${socketPath} — so this launch was ` +
        `NOT the configuration a person runs: the gate failed open, and a start() that runs before ` +
        `\`ready\` for that reason is exactly what hid 241 from every live smoke. Investigate the ` +
        `gate before trusting this green.${alsoUnreaped}\n--- app output ---\n${output.trim()}`,
    )
  }

  if (teardownFailure !== null) {
    throw new Error(
      `the window opened, but the teardown itself failed: ${teardownFailure.message}`,
      { cause: teardownFailure },
    )
  }
  if (!outcome.complete) {
    throw new Error(`the window opened, but ${unreaped(outcome)}`)
  }

  for (const phase of ['workspace-recovery', 'themes-database-runtime-host']) {
    for (const state of ['start', 'end']) {
      if (!new RegExp(`launch=\\S+ elapsed=\\d+ attempt=0 ${phase} ${state}`).test(output))
        throw new Error(`built app did not log ${phase} ${state}\n${output.trim()}`)
    }
  }

  console.log(
    `window:check ✔ ${String(pages.length)} page target(s) — ${pages[0].title || '(untitled)'} ` +
      `at ${pages[0].url} · gate socket present (${String(socketPath.length)}/${String(SUN_PATH_MAX)} bytes)`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
