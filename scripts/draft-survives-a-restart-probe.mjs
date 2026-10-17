#!/usr/bin/env node
/**
 * Check saved drafts in the built app after a kill or quit and a fresh process restart.
 *
 *   pnpm run build && pnpm run probe:draft-restart [-- --desktop <built apps/desktop>] [--arm <name>]
 *
 * Each arm launches twice on one fresh userData: `kill-0.5s` sends SIGKILL after half a
 * second, `quit-at-once` sends SIGTERM immediately, and `kill-6s` is the delayed-save control.
 * Relaunch reads composer text, caret and focus, plus a localStorage canary. The short-kill
 * canary demonstrates why drafts need file persistence; missing measurements are named.
 *
 * Report `quit-at-once` as NOT PERFORMED if the measured signal gap exceeds the save delay:
 * then the periodic save could have persisted the words without shutdown doing so.
 * Every launch uses a fresh temp data directory, a kernel-assigned debug port and hidden
 * mode. Verify listener ownership before driving it; reap captured identities before removal.
 * Outside `ci`: needs a built app and roughly a minute. Exit 1 if a measured draft fails to return.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HIDDEN_LAUNCH_ARG, pidsLaunchedOn } from './lib/hidden-launch.mjs'
import { createOwnedProcessLifecycle } from './lib/owned-process.mjs'
import { descendantsOf, tearDownAndRemove } from './lib/owned-teardown.mjs'
import { whoHoldsPort } from './lib/port-probe.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const flag = process.argv.indexOf('--desktop')
const DESKTOP = flag === -1 ? join(REPO_ROOT, 'apps/desktop') : resolve(process.argv[flag + 1])
const ELECTRON = join(DESKTOP, 'node_modules/.bin/electron')
const ENTRY = join(DESKTOP, 'out/main/index.js')
/** `window-opens-check.mjs`' bound: a longer gate socket path makes the app refuse to start. */
const SUN_PATH_MAX = 104
const GATE_SOCKET = 'one-host.sock'
const COMPOSER = '[data-cy="prompt-input"]'
const LS_KEY = 'brobot-744-probe'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer()
    server.on('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

/** Poll `probe` until it answers something other than null, or say what never came. */
async function waitFor(probe, withinMs, what) {
  const until = Date.now() + withinMs
  while (Date.now() < until) {
    const value = await probe()
    if (value !== null && value !== undefined && value !== false) return value
    await sleep(200)
  }
  throw new Error(`${what} did not come within ${String(withinMs / 1000)} s`)
}

/** ⚑ A minimal DevTools client — every call bounded at 10 s (a stalled call is NOT PERFORMED). */
async function devtools(url) {
  const socket = new WebSocket(url)
  await new Promise((done, fail) => {
    const timer = setTimeout(
      () => fail(new Error('the DevTools socket did not open in 10 s')),
      10_000,
    )
    socket.onopen = () => {
      clearTimeout(timer)
      done()
    }
    socket.onerror = () => fail(new Error('the DevTools socket failed to open'))
  })
  let next = 0
  const waiting = new Map()
  socket.onmessage = (message) => {
    const body = JSON.parse(String(message.data))
    const answer = waiting.get(body.id)
    if (answer !== undefined) answer(body)
  }
  const call = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = ++next
      const timer = setTimeout(() => {
        waiting.delete(id)
        fail(new Error(`${method}: no answer in 10 s`))
      }, 10_000)
      waiting.set(id, (body) => {
        clearTimeout(timer)
        waiting.delete(id)
        if (body.error) fail(new Error(`${method}: ${body.error.message}`))
        else done(body.result)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails)
      throw new Error(`evaluate: ${JSON.stringify(result.exceptionDetails)}`)
    return result.result.value
  }
  return { call, evaluate, close: () => socket.close() }
}

async function launch(userDataDir) {
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
  const owned = Date.now() + 10_000
  while (lifecycle === null && Date.now() < owned && exited === null) {
    try {
      lifecycle = createOwnedProcessLifecycle({
        launcherPid: child.pid,
        discoverDescendants: descendantsOf,
      })
    } catch {
      await sleep(50)
    }
  }
  if (lifecycle === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // never started
    }
    throw new Error(`could not take ownership of the launch (${String(exited)})\n${output}`)
  }
  const done = () => {
    child.stdout.destroy()
    child.stderr.destroy()
  }
  try {
    const page = await waitFor(
      async () =>
        (await targets(port))?.find(
          (each) => each.type === 'page' && each.url !== '' && each.url !== 'about:blank',
        ) ?? null,
      45_000,
      'a window',
    )
    // ⛔ The security block: the port's listener must be THIS launch, never somebody else's app.
    const holders = whoHoldsPort(port)
    const mine = await pidsLaunchedOn(userDataDir)
    if (holders.state !== 'held' || !holders.pids.every((pid) => mine.includes(pid))) {
      throw new Error(
        `port ${String(port)} is not held by this launch: ${JSON.stringify(holders)} · ours ${JSON.stringify(mine)}`,
      )
    }
    lifecycle.refreshDescendants()
    const session = await devtools(page.webSocketDebuggerUrl)
    await waitFor(
      () =>
        session.evaluate(
          `(() => { const box = document.querySelector('${COMPOSER}'); return box !== null && !box.disabled })()`,
        ),
      30_000,
      'the launcher composer',
    )
    return { lifecycle, session, appPid: holders.pids[0], done, output: () => output }
  } catch (error) {
    // ⚑ Said on the error, so the caller keeps the directory when this reap did not complete.
    const reaped = lifecycle.kill9().complete
    done()
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { reaped })
  }
}

/**
 * Type the way a keyboard does — `Input.insertText` into the focused composer — after writing the
 * `localStorage` key the same words, so nothing else stands between the typing and what follows it.
 *
 * @returns when the words went in, for the quit arm's gap.
 */
async function type(session, text) {
  await session.evaluate(`localStorage.setItem('${LS_KEY}', ${JSON.stringify(text)})`)
  await session.evaluate(`document.querySelector('${COMPOSER}').focus()`)
  await session.call('Input.insertText', { text })
  const typedAt = Date.now()
  const landed = await session.evaluate(`document.querySelector('${COMPOSER}').value`)
  if (landed !== text)
    throw new Error(`typing did not land: the composer reads ${JSON.stringify(landed)}`)
  return typedAt
}

async function readBack(session) {
  return session.evaluate(`(() => {
    const box = document.querySelector('${COMPOSER}')
    return {
      text: box.value,
      caret: [box.selectionStart, box.selectionEnd],
      focused: document.activeElement === box,
      localStorage: localStorage.getItem('${LS_KEY}'),
    }
  })()`)
}

async function gone(pids, withinMs) {
  const until = Date.now() + withinMs
  while (Date.now() < until) {
    const alive = pids.filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })
    if (alive.length === 0) return true
    await sleep(100)
  }
  return false
}

/** `kept-drafts.ts`' `DRAFT_SAVE_DELAY_MS` — past it, the delay's own save may have run. */
const SAVE_DELAY_MS = 200

const ARMS = [
  { name: 'kill-0.5s', wait: 500, end: 'kill' },
  { name: 'quit-at-once', wait: 0, end: 'quit' },
  { name: 'kill-6s', wait: 6_000, end: 'kill' },
]

async function runArm(arm) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'bb744-'))
  if (join(userDataDir, GATE_SOCKET).length > SUN_PATH_MAX) {
    rmSync(userDataDir, { recursive: true, force: true })
    throw new Error(
      `the user-data path is too long for the app's gate socket — run with a shorter TMPDIR`,
    )
  }
  const text = `a draft for ${arm.name}, typed and not sent`
  const row = { arm: arm.name, typed: text }
  let first = null
  let firstReaped = false
  let second = null
  // ⚠️ A launch that threw after taking ownership reaped itself, and says whether it completed.
  let aLaunchLeftRunning = false
  try {
    first = await launch(userDataDir)
    // ⚑ Read BEFORE the typing, so nothing slow stands between the words and the quit.
    const pids = await pidsLaunchedOn(userDataDir)
    const typedAt = await type(first.session, text)
    if (arm.wait > 0) await sleep(arm.wait)
    if (arm.end === 'kill') {
      const outcome = first.lifecycle.kill9()
      firstReaped = outcome.complete
      first.session.close()
      first.done()
      if (!outcome.complete)
        throw new Error(`the kill did not complete: ${JSON.stringify(outcome)}`)
    } else {
      const sent = first.lifecycle.signalRememberedWhy(first.appPid, 'SIGTERM')
      row.typedToSignalMs = Date.now() - typedAt
      if (!sent.signalled) throw new Error(`could not ask the app to quit: ${sent.why}`)
      if (row.typedToSignalMs >= SAVE_DELAY_MS) {
        row.notPerformed = `the quit was asked ${String(row.typedToSignalMs)} ms after the typing — past the save delay`
      }
      row.quitWithin30s = await gone(pids, 30_000)
      firstReaped = row.quitWithin30s || first.lifecycle.kill9().complete
      // ⚑ The app's own account of its quit — `keep its unsent drafts` is the step that waited.
      row.shutdownReport = /BroCrew shut down in [^\n]*/.exec(first.output())?.[0] ?? null
      first.session.close()
      first.done()
    }
    const onDisk = join(userDataDir, 'drafts.json')
    row.fileAfter = existsSync(onDisk) ? readFileSync(onDisk, 'utf8').includes(text) : 'absent'
    second = await launch(userDataDir)
    Object.assign(row, await readBack(second.session))
    row.back = row.text === text
    row.caretAtEnd = row.caret[0] === text.length && row.caret[1] === text.length
    row.localStorageBack = row.localStorage === text
  } catch (error) {
    if (error?.reaped === false) aLaunchLeftRunning = true
    // ⚑ On the row, so what the teardown below decides is reported beside it.
    row.error = error instanceof Error ? error.message : String(error)
  } finally {
    // ⛔ Every launch is reaped by the identities it was captured with, and the directory comes off
    // only when every reap completed — never from under an app still writing to it.
    if (first !== null && !firstReaped) {
      firstReaped = first.lifecycle.kill9().complete
      first.session.close()
      first.done()
    }
    if (second !== null) {
      second.session.close()
      const outcome = firstReaped
        ? tearDownAndRemove({ lifecycle: second.lifecycle, directory: userDataDir })
        : { ...second.lifecycle.kill9(), removed: false }
      second.done()
      row.reaped = outcome.complete && outcome.removed
    } else if (!aLaunchLeftRunning && (first === null || firstReaped)) {
      rmSync(userDataDir, { recursive: true, force: true })
      row.reaped = true
    } else {
      row.reaped = false
      row.leftInPlace = userDataDir
    }
  }
  return row
}

async function main() {
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is not built — run \`pnpm run build\` first`)
  const rows = []
  // ⚑ `--arm <name>` runs one arm — for measuring a build variant on the one question it changes.
  const only = process.argv.indexOf('--arm')
  const arms = only === -1 ? ARMS : ARMS.filter((arm) => arm.name === process.argv[only + 1])
  if (arms.length === 0) throw new Error(`no arm is called ${String(process.argv[only + 1])}`)
  for (const arm of arms) {
    try {
      rows.push(await runArm(arm))
    } catch (error) {
      rows.push({ arm: arm.name, error: error instanceof Error ? error.message : String(error) })
    }
  }
  console.log(`desktop: ${DESKTOP}`)
  for (const row of rows) console.log(JSON.stringify(row))
  // ⚑ The localStorage reading is the kill-0.5s launch's own key, read back by the same relaunch —
  // and it is a reading only when that arm ran to the end.
  const ls = rows.find(
    (row) => row.arm === 'kill-0.5s' && typeof row.localStorageBack === 'boolean',
  )
  console.log(
    `localStorage, killed 0.5 s after it was written: ${ls === undefined ? 'NOT MEASURED' : ls.localStorageBack ? 'CAME BACK' : 'was LOST'}`,
  )
  const notPerformed = rows.filter(
    (row) => row.notPerformed !== undefined || row.error !== undefined,
  )
  const failed = rows.filter(
    (row) => !notPerformed.includes(row) && (row.back !== true || row.caretAtEnd !== true),
  )
  for (const row of notPerformed) {
    console.log(`⚠ ${row.arm}: NOT PERFORMED — ${row.notPerformed ?? row.error}`)
  }
  console.log(
    failed.length === 0
      ? `✔ every arm performed: the draft came back, caret at the end`
      : `✖ ${failed.map((row) => row.arm).join(', ')}: the draft did not come back as typed`,
  )
  process.exitCode = failed.length === 0 && notPerformed.length === 0 ? 0 : 1
}

await main()
