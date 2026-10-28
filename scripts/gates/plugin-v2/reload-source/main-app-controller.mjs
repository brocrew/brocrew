// packaged-plugin-gate-only:reload-v1
// Only the dedicated projected MAIN-APP index imports this module. The launch owner
// installs its private sender/frame/token-checked IPC; this module installs no IPC or flag.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { RuntimeHost } from '../../../apps/desktop/src/main/runtime/runtime-host.ts'
import { makeRuntime, adapterCase, ownedFolder, cleanupReceipt, delay, until, bounded, WORDS } from './fixture.mjs'
import { SOURCE, TREE, MODE, SDK_VERSION, MARKER, assertMainAppBehavior, assertCommand, assertStatus, deliveryMessages, deliveryEvidence } from './contract.mjs'

let actualHost = null
let state = null
const turnRows = rows => rows.filter(row => row.event.type === 'turn')
const failures = rows => turnRows(rows).filter(row => row.event.state === 'failed')
const completions = rows => turnRows(rows).filter(row => row.event.state === 'completed')
function ledger() {
  assert(state?.sessionId && actualHost)
  const rows = actualHost.deps.store.events(state.sessionId)
  assert(rows.length <= 1024, 'Reload ledger bound exceeded')
  return rows
}
function noOtherSessions() {
  assert(actualHost.sessionIds.every(id => id === state.sessionId), 'Unexpected main-app session')
}
function oldTerminalUnchanged(rows) {
  if (state.failureIdentity !== null) {
    assert.equal(failures(rows).length, 1, 'Failure introduced after timeout')
    const row = failures(rows)[0]
    assert.equal(JSON.stringify([row.ordinal, row.at, row.event]), state.failureIdentity,
      'Original terminal identity changed')
  }
}

// The launch owner injects exactly this Claude-only factory into actual index.createRuntime.
// One registry survives the main host's start/resume createRuntime calls.
export function createReloadGateRuntime({ ownedRoot }) {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64')
  assert(path.isAbsolute(ownedRoot) && path.resolve(ownedRoot) === ownedRoot)
  assert.equal(fs.realpathSync(ownedRoot), ownedRoot)
  assert(fs.lstatSync(ownedRoot).isDirectory() && !fs.lstatSync(ownedRoot).isSymbolicLink())
  if (state === null) {
    state = { ownedRoot, kit: makeRuntime(ownedRoot, null, null, { mainApp: true }),
      phase: 'unarmed', armStarted: false, retirementReleaseStarted: false, sessionId: null, timeoutMs: null, failureIdentity: null,
      failedAtTimeout: null, baselineTail: null, tails: new Set(), oldExitObserved: false,
      reloadReleased: false, retirementReleased: false, freshBeforeReturn: null,
      freshBeforeExit: null, receiptStarted: false }
  }
  assert.equal(state.ownedRoot, ownedRoot, 'Reload root changed')
  return state.kit.runtime
}

// Called by the projected registerIpc with its EXISTING RuntimeHost; no host/store is made here.
export function bindReloadGateHost(runtimeHost) {
  assert.equal(actualHost, null, 'Actual main host may be bound once')
  assert(runtimeHost instanceof RuntimeHost, 'Real RuntimeHost required')
  assert.equal(typeof runtimeHost.deps.store.events, 'function')
  assert(runtimeHost.arrivals instanceof Map, 'Pinned main-host arrival line required')
  assert.equal(runtimeHost.sessionIds.length, 0, 'Dedicated reload app must start empty')
  actualHost = runtimeHost
}

function status() {
  assert(state && actualHost && state.sessionId, 'Reload case is not armed')
  noOtherSessions()
  const { kit } = state, old = kit.queries[0], handle = kit.handles[0]
  const rows = ledger(), failed = failures(rows)
  if (failed.length > 0 && state.failureIdentity === null) {
    assert.equal(failed.length, 1)
    assert.equal(failed[0].event.wordOf, 'this-app')
    const elapsed = performance.now() - old.reloadAt
    assert(old.reloadAt > 0 && elapsed >= 10000 && elapsed <= 12500, 'Actual 10000ms timeout missing')
    state.timeoutMs = Math.round(elapsed)
    state.failedAtTimeout = failed.length
    state.failureIdentity = JSON.stringify([failed[0].ordinal, failed[0].at, failed[0].event])
  }
  oldTerminalUnchanged(rows)
  if (!state.retirementReleased && state.failureIdentity !== null) {
    assert.equal(kit.queries.length, 1, 'Fresh query before retirement release')
    assert.equal(old.pushes.length, 0, 'Old query consumed a user prompt')
    const tail = actualHost.arrivals.get(state.sessionId)
    if (state.baselineTail === null && tail) {
      assert.equal(handle.isRetiring?.(), true, 'Timeout must enter retirement')
      assert.equal(old.closeCalls, 1); assert.equal(old.returnCalls, 1)
      state.baselineTail = tail
      state.phase = 'retiring-held'
    } else if (tail && tail !== state.baselineTail) state.tails.add(tail)
    assert(state.tails.size <= 2, 'Unexpected queued delivery')
  }
  return assertStatus({ schema: 'brocrew.reload-status.v1', phase: state.phase,
    queryCount: kit.queries.length, oldReloads: old.reloadCalls, oldCloses: old.closeCalls,
    oldReturns: old.returnCalls, oldPushes: old.pushes.length,
    freshPushes: kit.queries[1]?.pushes.length ?? 0, failedTerminals: failed.length,
    completedTerminals: completions(rows).length, retiring: handle.isRetiring?.() === true,
    arrivalTailChanges: state.tails.size })
}

async function arm() {
  assert(state && actualHost && state.phase === 'unarmed' && !state.armStarted, 'Cannot arm this reload case')
  state.armStarted = true
  await until(() => state.kit.handles.length === 1 && state.kit.handles[0].ref !== null, 'main-app init')
  assert.equal(actualHost.sessionIds.length, 1)
  assert.equal(state.kit.queries.length, 1)
  assert.equal(state.kit.queries[0].reloadCalls, 0, 'Message sent before arm')
  state.sessionId = actualHost.sessionIds[0]
  assert.equal(failures(ledger()).length, 0)
  state.phase = 'armed'
  void state.kit.handles[0].awaitProcessExit().then(() => { state.oldExitObserved = true })
  return status()
}
async function releaseReload() {
  const observed = status()
  assert.equal(state.phase, 'retiring-held')
  assert.equal(observed.arrivalTailChanges, 2, 'Sample each arriving real IPC send')
  assert.equal(observed.retiring, true)
  assert.equal(state.reloadReleased, false)
  state.reloadReleased = true
  state.kit.queries[0].reloadGate.release()
  state.kit.queries[0].lateResult()
  await delay(30)
  state.phase = 'reload-released'
  const after = status()
  assert.equal(after.failedTerminals, 1); assert.equal(after.completedTerminals, 0)
  return after
}
async function releaseRetirement() {
  status()
  assert.equal(state.phase, 'reload-released')
  assert.equal(state.retirementReleased, false)
  assert.equal(state.retirementReleaseStarted, false, 'Retirement release already entered')
  state.retirementReleaseStarted = true
  assert.equal(state.tails.size, 2)
  const old = state.kit.queries[0]
  state.freshBeforeReturn = state.kit.queries.length - 1
  assert.equal(state.freshBeforeReturn, 0)
  old.returnGate.release()
  await until(() => old.returnSettled, 'controlled delayed return')
  await delay(50)
  state.freshBeforeExit = state.kit.queries.length - 1
  assert.equal(state.freshBeforeExit, 0, 'Actual host resumed before child witness')
  assert.equal(state.oldExitObserved, false)
  assert.equal(old.child.exited, false)
  state.retirementReleased = true
  state.phase = 'retirement-released'
  old.child.finish()
  return status()
}
async function receipt() {
  assert(state?.retirementReleased && !state.receiptStarted, 'Receipt phase refused')
  state.receiptStarted = true
  noOtherSessions()
  const { kit } = state, old = kit.queries[0]
  await until(() => kit.queries.length === 2 && deliveryMessages(kit.queries[1].pushes).length === WORDS.length &&
    completions(ledger()).length === kit.queries[1].pushes.length && !actualHost.arrivals.has(state.sessionId),
  'main-app real IPC delivery and completion', 5000)
  const fresh = kit.queries[1]
  assert.equal(fresh.resume, kit.handles[0].ref.sessionId)
  const beforePush = fresh.pushes.length, beforeTurn = turnRows(ledger()).length
  old.reloadGate.release(); old.lateResult()
  await delay(30)
  oldTerminalUnchanged(ledger())
  const lateAddedPushes = fresh.pushes.length - beforePush
  const lateAddedTerminals = turnRows(ledger()).length - beforeTurn
  assert.equal(lateAddedPushes, 0); assert.equal(lateAddedTerminals, 0)
  await bounded(actualHost.closeAll(), 'actual main-app host closeAll')
  await kit.cleanup()
  assert.equal(actualHost.sessionIds.length, 0)
  const rows = ledger()
  oldTerminalUnchanged(rows)
  assert.equal(turnRows(rows).length, beforePush + 1, 'Terminal added during final cleanup')
  assert.equal(fresh.pushes.length, beforePush, 'Prompt added during final cleanup')
  assert.equal(completions(rows).length, beforePush, 'Completion changed during final cleanup')
  const userRows = rows.filter(row => row.event.type === 'user_turn')
  const delivery = deliveryEvidence(fresh.pushes, userRows.map(row => row.event))
  const contents = fresh.pushes.map(message => message.message.content)
  const once = word => contents.filter(text => typeof text === 'string' &&
    text.split(/\r?\n/).some(line => line.trim() === word)).length === 1
  const hostQueue = {
    timeoutMs: state.timeoutMs, failedAtTimeout: state.failedAtTimeout,
    failedTerminals: failures(rows).length, failedByApp: failures(rows)[0].event.wordOf === 'this-app',
    oldPushes: old.pushes.length, oldReloads: old.reloadCalls, oldCloses: old.closeCalls,
    oldReturns: old.returnCalls, queuedBeforeExit: state.tails.size,
    freshBeforeReturn: state.freshBeforeReturn, freshBeforeExit: state.freshBeforeExit,
    starts: rows.filter(row => row.event.type === 'launched').length,
    resumes: rows.filter(row => row.event.type === 'reopened').length,
    freshQueries: kit.queries.length - 1,
    freshResumeMatches: fresh.resume === kit.handles[0].ref.sessionId,
    freshReloads: fresh.reloadCalls, freshPushes: fresh.pushes.length,
    uniqueUserUuids: new Set(fresh.pushes.map(message => message.uuid)).size,
    originalOnce: once(WORDS[0]), secondOnce: once(WORDS[1]), thirdOnce: once(WORDS[2]),
    ledgerUserTurns: userRows.length, freshCompleted: completions(rows).length,
    lateAddedPushes, lateAddedTerminals, ...delivery,
  }
  const adapterRoot = path.join(state.ownedRoot, 'reload-main-adapter-v1')
  assert(!fs.existsSync(adapterRoot), 'Supplemental adapter refuses reuse')
  fs.mkdirSync(adapterRoot, { mode: 0o700 })
  ownedFolder(state.ownedRoot, adapterRoot)
  const skills = ownedFolder(state.ownedRoot, path.join(adapterRoot, 'built-in-skills'), true)
  ownedFolder(state.ownedRoot, path.join(adapterRoot, 'skills'), true)
  const adapter = await adapterCase(adapterRoot, skills)
  const cleanup = cleanupReceipt(adapter.cleanup, kit.cleanupFacts(), false, actualHost.sessionIds.length)
  state.phase = 'complete'
  return assertMainAppBehavior({ schema: 'brocrew.reload-main-app-behavior.v1',
    fixtureMarker: MARKER, mode: MODE, sourceSha: SOURCE, sourceTree: TREE,
    sdkDeclaredVersion: SDK_VERSION, hostBinding: 'projected-index-runtimeHost-and-same-store',
    nativeDatabaseClosure: 'external-native-app-receipt-required',
    nativeIpcJourney: 'EXTERNAL-DRIVER-EVIDENCE-REQUIRED',
    adapter: adapter.result, hostQueue, cleanup })
}

// Main-window sender/frame/token verification MUST have succeeded in the launch owner's handler first.
// Exact object shape/op allowlist is checked again here; no caller supplies path/id/provider/code.
export async function reloadGateCommand(input) {
  assertCommand(input)
  if (input.op === 'arm') return arm()
  if (input.op === 'status') return status()
  if (input.op === 'releaseReload') return releaseReload()
  if (input.op === 'releaseRetirement') return releaseRetirement()
  return receipt()
}
