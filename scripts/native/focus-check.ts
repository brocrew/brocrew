// Optional native contract check: compiled externally, never shipped in the plugin archive.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execFileSync, execFile } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { ChromeBrowser } from '../../plugins/chrome/src/browser/chromeBrowser.js'
import { createProfileStore } from '../../plugins/chrome/src/profiles/store.js'
import { TabRegistry } from '../../plugins/chrome/src/tabs.js'
import { createWindowTasks } from '../../plugins/chrome/src/windows.js'
import { createKeyedSerializer } from '../../plugins/chrome/src/shared/browser/browser-lease.js'
import { createAgentChromeTools } from '../../plugins/chrome/src/tools/index.js'

import { launchPersistentChromium } from '../../plugins/chrome/src/shared/browser/browser-launch.js'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  assessNativeCase,
  finalNativeVerdict,
  classifyPid,
  calibrateNativeClock,
  type NativeSample,
} from '../../plugins/chrome/test/native-focus-contract.js'
import { killChromeOf } from '../../plugins/chrome/src/browser/chromeBrowser.js'
const [observer, evidence, resetHelper, baselinePidText, expectedSource] = process.argv.slice(2)
const baselinePid = Number(baselinePidText)
assert(
  Number.isInteger(baselinePid) && baselinePid > 1,
  'Supply explicitly identified BroCrew PID; never infer another foreground app is BroCrew',
)
const runStartedAt = performance.now()
const wallStartedAt = new Date().toISOString()
let clock: ReturnType<typeof calibrateNativeClock> | undefined
const calibrations: unknown[] = []
const syncs = new Map<string, { sentAt: number; resolve: () => void; reject: (e: Error) => void }>()
const ownedContexts = new Set<Awaited<ReturnType<typeof launchPersistentChromium>>>()
const pendingLaunches = new Set<Promise<unknown>>()
const ownedDirs = new Set<string>()
let stopping = false,
  locked = false
let rejectBudget: (e: Error) => void = () => {}
const runBudget = new Promise<never>((_, reject) => {
  rejectBudget = reject
})
void runBudget.catch(() => undefined)
const budgetTimer = setTimeout(
  () => rejectBudget(new Error('native run exceeded75s budget')),
  75_000,
)
async function cleanupBounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('cleanup timed out')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type OpenedTab = { tabId: string; windowId: number; url: string; title: string }
async function bounded<T>(work: T | Promise<T>, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      screenLock,
      runBudget,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('native fixture operation timed out')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
assert(
  observer && evidence && resetHelper,
  'Supply observer, receipt, reset helper and pinned BroCrew PID',
)
const samples: NativeSample[] = []
const cases: unknown[] = []
let rejectLock: (e: Error) => void = () => {}
const screenLock = new Promise<never>((_, reject) => {
  rejectLock = reject
})
void screenLock.catch(() => undefined)
async function pause(ms: number) {
  await Promise.race([delay(ms), screenLock, runBudget])
}
const ownedPids: number[] = []
const launches: unknown[] = []
const processRows = () =>
  execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', timeout: 2000 })
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number)
      return { pid, ppid }
    })
function ownership(pid: number, rows = processRows()) {
  return classifyPid(pid, ownedPids, rows)
}
function snapshot() {
  const sample = samples.at(-1)!
  const capturedAt = performance.now()
  const rows = processRows()
  return {
    capturedAt,
    sample,
    sampleAgeMs: capturedAt - sample.at,
    frontmostOwnership: ownership(sample.pid, rows),
    ownedProcesses: rows.filter((r) => ownership(r.pid, rows).owned),
  }
}
let cleanup: unknown
let profile = 'focus-control'
let positiveControl: unknown
let ownedBrowserPid: number | undefined
let status = 'not-possible',
  reason = ''
let browser: ChromeBrowser | undefined
let home: string | undefined
let watcher: ReturnType<typeof spawn> | undefined
let sourceCommit = ''
let baselineBirth = ''
const birth = (pid: number) =>
  execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8',
    timeout: 1000,
  }).trim()
try {
  if (process.platform !== 'darwin') throw new Error('native focus/Space check requires macOS')
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assert.equal(sourceCommit, expectedSource, 'supply exact reviewed source SHA')
  assert.equal(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    '',
    'native source must be committed and clean',
  )
  baselineBirth = birth(baselinePid)
  watcher = spawn(observer, ['180'], { stdio: ['pipe', 'pipe', 'pipe'] })
  let pending = ''
  watcher.stdout!.on('data', (bytes) => {
    pending += bytes.toString()
    for (;;) {
      const at = pending.indexOf('\n')
      if (at < 0) break
      const line = pending.slice(0, at)
      pending = pending.slice(at + 1)
      const raw = JSON.parse(line)
      const receivedAt = performance.now()
      if (raw.sync && syncs.has(raw.sync)) {
        const request = syncs.get(raw.sync)!
        syncs.delete(raw.sync)
        const calibrated = calibrateNativeClock(request.sentAt, receivedAt, raw.nativeAt)
        calibrations.push({
          sentAt: request.sentAt,
          receivedAt,
          nativeAt: raw.nativeAt,
          offsetDriftMs:
            clock?.offset != null && calibrated.offset != null
              ? calibrated.offset - clock.offset
              : null,
          ...calibrated,
        })
        if (calibrated.warning)
          console.warn(calibrated.warning, {
            sentAt: request.sentAt,
            receivedAt,
            nativeAt: raw.nativeAt,
            uncertaintyMs: calibrated.uncertainty,
          })
        clock = calibrated
        request.resolve()
      }
      // Receipt time shares the endpoint clock; raw native/wall times remain diagnostic evidence.
      const sample = { ...raw, wallAt: raw.at, at: receivedAt }
      samples.push(sample)
      if (sample.bundle === 'com.apple.loginwindow') {
        locked = true
        rejectLock(new Error('screen locked; stopped native check'))
      }
    }
  })
  let observerError = ''
  watcher.on('error', (e) => {
    observerError = e.message
  })
  watcher.stderr!.on('data', (b) => {
    observerError += b.toString()
  })
  async function syncClock() {
    const token = randomUUID()
    const sentAt = performance.now()
    try {
      await bounded(
        new Promise<void>((resolve, reject) => {
          syncs.set(token, { sentAt, resolve, reject })
          watcher!.stdin!.write(JSON.stringify({ sync: token }) + '\n')
        }),
        2000,
      )
    } catch (error) {
      const unavailable = {
        sentAt,
        receivedAt: performance.now(),
        warning: 'native clock calibration unavailable',
        reason: error instanceof Error ? error.message : String(error),
      }
      calibrations.push(unavailable)
      console.warn(unavailable.warning, unavailable)
    } finally {
      syncs.delete(token)
    }
  }
  await syncClock()
  for (let n = 0; n < 50 && !samples.length && !observerError; n++) await pause(100)
  const original = samples.at(-1)
  if (!original?.pid || original.space === '0' || !Object.keys(original.displays).length)
    throw new Error(
      `native observation unavailable: ${observerError || 'no frontmost app or active Space'}`,
    )
  if (original.bundle === 'com.apple.loginwindow')
    throw new Error(
      'loginwindow is frontmost; native focus/Space proof cannot be calibrated from this locked or inactive GUI seat',
    )
  assert.equal(
    original.pid,
    baselinePid,
    'BroCrew must be frontmost at start and match the supplied pinned PID',
  )
  assert(original.bundlePath, 'native observer must supply baseline bundle identity')
  home = fs.realpathSync(fs.mkdtempSync('/tmp/brocrew-chrome-focus-'))
  const fixtureFile = path.join(home, 'focus fixture.html')
  fs.writeFileSync(fixtureFile, '<title>Fictional focus fixture</title>')
  const fixtureUrl = pathToFileURL(fixtureFile).href
  const store = createProfileStore({ home })
  store.create(profile, 'panel')
  store.setFlags(profile, { enabled: true })
  const makeBrowser = () =>
    new ChromeBrowser({
      dirOf: store.dirOf,
      launchContext: async (opts) => {
        const launchStartedAt = performance.now()
        ownedDirs.add(opts.profileDir)
        const launched = launchPersistentChromium(opts).then((ctx) => {
          ownedContexts.add(ctx)
          if (stopping) {
            void cleanupBounded(ctx.close(), 2000).catch(() => undefined)
            throw new Error('launch resolved after native run stopped')
          }
          return ctx
        })
        pendingLaunches.add(launched)
        void launched.finally(() => pendingLaunches.delete(launched)).catch(() => undefined)
        const ctx = await bounded(launched, 10_000)
        try {
          const session = await bounded(ctx.browser()!.newBrowserCDPSession())
          try {
            const info = await bounded(session.send('SystemInfo.getProcessInfo'))
            const pid = info.processInfo.find((p) => p.type === 'browser')?.id
            assert(Number.isInteger(pid), 'launch-time owned browser PID required')
            ownedPids.push(pid!)
            const browserVersion = await bounded(session.send('Browser.getVersion'))
            const executable = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], {
              encoding: 'utf8',
              timeout: 1000,
            }).trim()
            const rows = processRows()
            launches.push({
              browserVersion,
              executable,
              birth: birth(pid!),
              launchStartedAt,
              capturedAt: performance.now(),
              profileDir: opts.profileDir,
              browserPid: pid,
              cdpProcesses: info.processInfo,
              ownedProcesses: rows.filter((r) => ownership(r.pid, rows).owned),
            })
          } finally {
            await cleanupBounded(session.detach(), 100).catch(() => undefined)
          }
          return ctx
        } catch (e) {
          await cleanupBounded(ctx.close(), 2000).catch(() => undefined)
          throw e
        }
      },
      ua: {
        get: async () => ({
          userAgent: 'fictional fixture',
          chromeVersion: null,
        }),
        invalidate() {},
        peek: () => null,
      },
    })
  browser = makeBrowser()
  const tabs = new TabRegistry()
  const makeTools = () =>
    createAgentChromeTools({
      store,
      browser: browser!,
      tabs,
      windows: createWindowTasks({ browser: browser! }),
      serializer: createKeyedSerializer(),
      downloadsRoot: path.join(home!, 'downloads'),
      guard: () => ({ roots: [home!], hostHome: '', mount: '', maxBytes: 1024 }),
    })
  let tools = makeTools()
  async function call(args: Record<string, unknown>): Promise<OpenedTab> {
    const result = await bounded(
      tools
        .find((t) => t.definition.name === 'open_tab')!
        .execute({ profile, url: fixtureUrl, ...args }, {}),
      10_000,
    )
    const text =
      (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')
        ?.text ?? ''
    if (('isError' in result && result.isError) || text.startsWith('Error:')) throw new Error(text)
    return JSON.parse(text)
  }
  const resets: unknown[] = []
  async function resetBroCrew() {
    assert.equal(birth(baselinePid), baselineBirth, 'pinned BroCrew PID creation identity changed')
    await syncClock()
    const startedAt = performance.now()
    const output = await bounded(
      new Promise<string>((resolve, reject) =>
        execFile(
          resetHelper,
          [String(baselinePid), original!.bundle, original!.bundlePath!],
          { timeout: 3000 },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        ),
      ),
      3500,
    )
    let stable = false
    for (let n = 0; n < 100; n++) {
      const last = samples.at(-1),
        since = performance.now() - 500,
        covered = samples.filter((s) => s.at >= since)
      if (
        last &&
        covered.length &&
        covered[0].at <= since + 10 &&
        covered.every((s) => s.pid === baselinePid && s.bundle === original!.bundle)
      ) {
        stable = true
        break
      }
      await pause(50)
    }
    assert(stable, 'pinned BroCrew did not remain foreground for500ms within5s')
    const fresh = snapshot()
    assert.equal(fresh.sample.pid, baselinePid, 'BroCrew reset did not become frontmost')
    assert.equal(fresh.sample.bundle, original!.bundle, 'BroCrew bundle changed')
    assert(fresh.sampleAgeMs >= 0 && fresh.sampleAgeMs <= 20, 'reset observation stale')
    resets.push({ startedAt, finishedAt: performance.now(), output, fresh })
  }
  async function observe(
    name: string,
    args: Record<string, unknown>,
  ): Promise<OpenedTab | undefined> {
    await resetBroCrew()
    const before = snapshot(),
      start = performance.now()
    let result: OpenedTab | undefined
    let callError = ''
    try {
      result = await call(args)
    } catch (e) {
      if (samples.at(-1)?.bundle === 'com.apple.loginwindow') throw e
      callError = e instanceof Error ? e.message : String(e)
    }
    const returnedAt = performance.now()
    await pause(Math.max(0, returnedAt + 1000 - performance.now()))
    const at1 = snapshot()
    await pause(Math.max(0, returnedAt + 4000 - performance.now()))
    const at4 = snapshot()
    const seen = samples.filter((s) => s.at >= start && s.at <= at4.capturedAt)
    const failures = assessNativeCase({
      expectedPid: baselinePid,
      ownedPids,
      start,
      returnedAt,
      before,
      at1,
      at4,
      samples: seen,
    })
    if (callError) failures.push('tool call: ' + callError)
    cases.push({
      name,
      start,
      returnedAt,
      before,
      result,
      callError,
      at1,
      at4,
      failures,
      status: failures.length ? 'failed' : 'passed',
      samples: seen,
    })
    if (
      failures.some((f) =>
        /gap|monotonic|stale|timing|too few|calibration|baseline|unavailable|invalid/.test(f),
      )
    )
      throw new Error(
        'native observation/identity inadequate; stop new cases: ' + failures.join('; '),
      )
    return result
  }
  // Calibration is FIRST and uses a separate owned, non-signed-in profile/process.
  const calibration = await call({ visible: true, newWindow: true })
  const calibrationPid = ownedPids.at(-1)!
  assert(Number.isInteger(calibrationPid))
  const controlBefore = samples.at(-1)!
  const controlStart = performance.now()
  const shown = await bounded(
    tools.find((t) => t.definition.name === 'show_tab')!.execute({ tabId: calibration.tabId }, {}),
    15000,
  )
  assert(!('isError' in shown && shown.isError))
  for (
    let n = 0;
    n < 50 && !samples.some((s) => s.at >= controlStart && s.pid === calibrationPid);
    n++
  )
    await pause(100)
  const detected = samples.some((s) => s.at >= controlStart && s.pid === calibrationPid)
  positiveControl = {
    order: 'FIRST',
    explicit: 'show_tab on owned calibration profile',
    before: controlBefore,
    ownedBrowserPid: calibrationPid,
    detected,
    samples: samples.filter((s) => s.at >= controlStart),
  }
  assert(
    detected && calibrationPid !== controlBefore.pid,
    'positive control must detect owned Chrome activation',
  )
  await bounded(browser!.closeAll(), 5000)
  for (let n = 0; n < 50 && samples.at(-1)?.pid === calibrationPid; n++) await pause(100)
  assert(
    samples.at(-1)?.pid !== calibrationPid,
    'calibration browser must leave frontmost after closing',
  )
  // Fresh profile/data/context for first visible launch; no activation or restoration code.
  profile = 'focus-qualification'
  store.create(profile, 'panel')
  store.setFlags(profile, { enabled: true })
  browser = makeBrowser()
  tools = makeTools()
  status = 'failed'
  const a = await observe('first visible launch', { visible: true, newWindow: true })
  ownedBrowserPid = ownedPids.at(-1)
  const b = await observe('plain open_tab', {})
  const anchored = await observe('windowOf', { windowOf: a?.tabId ?? 'missing-owned-tab' })
  const separate = await observe('newWindow', { newWindow: true })
  const windowChecks =
    !!a &&
    !!b &&
    !!anchored &&
    !!separate &&
    a.windowId === b.windowId &&
    a.windowId === anchored.windowId &&
    a.windowId !== separate.windowId
  status =
    windowChecks && cases.every((c) => (c as { status: string }).status === 'passed')
      ? 'passed'
      : 'failed'
  positiveControl = { ...(positiveControl as object), resets }
  reason =
    status === 'failed'
      ? 'one or more native observations/window identities failed; all four cases retained'
      : ''
} catch (e) {
  reason = e instanceof Error ? e.message : String(e)
  if (browser && cases.length === 0) status = 'failed'
} finally {
  stopping = true
  clearTimeout(budgetTimer)
  const cleanupErrors: string[] = []
  const cleanupStartedAt = performance.now()
  const initialClose = browser?.closeAll()
  await cleanupBounded(Promise.allSettled([...pendingLaunches]), 30_000).catch((e) =>
    cleanupErrors.push(String(e)),
  )
  await cleanupBounded(
    Promise.allSettled([initialClose, ...[...ownedContexts].map((ctx) => ctx.close())]),
    5000,
  ).catch((e) => cleanupErrors.push(String(e)))
  // Only exact directories created/registered for this disposable run; never a user's profile.
  await Promise.all(
    [...ownedDirs].map((dir) =>
      cleanupBounded(killChromeOf(dir, 1000), 3000).catch((e) => cleanupErrors.push(String(e))),
    ),
  )

  for (let n = 0; n < 50; n++) {
    const live = ownedPids.filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })
    if (!live.length) break
    await delay(100)
  }
  cleanup = {
    ownedPids,
    liveOwnedPids: ownedPids.filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }),
  }
  if ((cleanup as { liveOwnedPids: number[] }).liveOwnedPids.length) {
    status = 'failed'
    reason += '; owned Chrome process remains'
  }
  watcher?.kill('SIGTERM')
  if (watcher?.exitCode === null)
    await Promise.race([new Promise((resolve) => watcher!.once('exit', resolve)), delay(2000)])
  const rootProcesses = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,args='], {
    encoding: 'utf8',
    timeout: 2000,
  })
    .split('\n')
    .flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      return m && m[3].includes('Chrome') && [...ownedDirs].some((dir) => m[3].includes(dir))
        ? [{ pid: Number(m[1]), ppid: Number(m[2]) }]
        : []
    })
  if (
    home &&
    !pendingLaunches.size &&
    !rootProcesses.length &&
    !(cleanup as { liveOwnedPids: number[] }).liveOwnedPids.length
  )
    fs.rmSync(home, { recursive: true, force: true })
  const finalRows = processRows()
  cleanup = {
    ...(cleanup as object),
    home,
    rootRemoved: home ? !fs.existsSync(home) : true,
    observerPid: watcher?.pid,
    observerExited: watcher?.exitCode !== null || watcher?.signalCode !== null,
    remainingOwnedProcesses: finalRows.filter((r) => ownership(r.pid, finalRows).owned),
  }
  const c = cleanup as {
    rootRemoved: boolean
    observerExited: boolean
    liveOwnedPids: number[]
    remainingOwnedProcesses: unknown[]
  }
  const passCleanup = {
    observerExited: c.observerExited,
    rootRemoved: c.rootRemoved,
    ownedProcessesGone:
      !c.liveOwnedPids.length &&
      !c.remainingOwnedProcesses.length &&
      !pendingLaunches.size &&
      !cleanupErrors.length &&
      !rootProcesses.length &&
      performance.now() - cleanupStartedAt <= 35_000,
  }
  if (
    finalNativeVerdict({
      positiveDetected: (positiveControl as { detected?: boolean })?.detected === true,
      screenLocked: locked,
      caseFailures: cases.map((c) => (c as { failures: string[] }).failures),
      cleanup: passCleanup,
    }) !== 'passed'
  )
    status = 'failed'
  if (cleanupErrors.length) reason += '; ' + cleanupErrors.join('; ')
  cleanup = {
    ...(cleanup as object),
    cleanupErrors,
    rootProcesses,
    cleanupDurationMs: performance.now() - cleanupStartedAt,
    pendingLaunches: pendingLaunches.size,
    passCleanup,
  }
  fs.writeFileSync(
    evidence,
    JSON.stringify(
      {
        status,
        reason,
        sourceCommit,
        baselineBirth,
        runStartedAt,
        finishedAt: performance.now(),
        wallStartedAt,
        wallFinishedAt: new Date().toISOString(),
        baselinePid,
        calibrations,
        clock,
        cleanup,
        launches,
        authorization:
          'Requires a fresh explicit W4 hands-off GO NOW; see external execution authorization receipt',
        observer:
          'native AppKit frontmost PID + read-only SkyLight active Space and per-display active Spaces, 5ms target sampling; Node monotonic receipt timestamps, calibration diagnostic only (warn above100ms),20ms maximum gap/endpoint age',
        disposableProfileOnly: true,
        signedIn: false,
        noProductFocusRestoration: true,
        ownedBrowserPid,
        positiveControl,
        cases,
        samples,
      },
      null,
      2,
    ) + '\n',
  )
}
console.log(JSON.stringify({ status, reason, cases: cases.length }))
if (status === 'failed') process.exitCode = 1
