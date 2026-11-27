// packaged-plugin-gate-only:reload-v1
// Only the dedicated projected MAIN-APP index imports this module. The launch owner
// installs its private sender/frame/token-checked IPC; this module installs no IPC or flag.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { RuntimeHost } from '../../../apps/desktop/src/main/runtime/runtime-host.ts'
import { makeRuntime, adapterCase, ownedFolder, cleanupReceipt, delay, until, bounded, WORDS } from './fixture.mjs'
import { SOURCE, TREE, MODE, SDK_VERSION, RELOAD_HELD_MS, MARKER, assertMainAppBehavior, assertCommand, assertStatus, deliveryMessages, deliveryEvidence, lifecycleEvidence } from './contract.mjs'

let actualHost = null
let state = null
const turnRows = rows => rows.filter(row => row.event.type === 'turn')
const failures = rows => turnRows(rows).filter(row => row.event.state === 'failed')
const completions = rows => turnRows(rows).filter(row => row.event.state === 'completed')
const queued = rows => rows.filter(row => row.event.type === 'message_queued')
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
    assert.equal(failures(rows).length, 1, 'Failure introduced after the CLI exit')
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
      phase: 'unarmed', armStarted: false, sessionId: null, heldMs: 0, failureIdentity: null,
      queuedWhileHeld: 0, exitStarted: false, freshBeforeReturn: null, receiptStarted: false }
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
  const { kit } = state, old = kit.queries[0]
  const rows = ledger(), failed = failures(rows)
  if (!state.exitStarted) {
    // Card 197: no clock ends the held reload; only the CLI's exit may.
    assert.equal(failed.length, 0, 'Reload failed before the CLI exited')
    assert.equal(kit.queries.length, 1, 'Fresh query before the CLI exited')
    assert.equal(old.pushes.length, 0, 'Old query consumed a user prompt')
    assert.equal(old.closeCalls, 0, 'Query closed while its reload was held')
    if (old.reloadAt > 0) state.heldMs = Math.round(performance.now() - old.reloadAt)
    if (state.phase === 'armed' && old.reloadCalls === 1 && state.heldMs >= RELOAD_HELD_MS) state.phase = 'reload-held'
    state.queuedWhileHeld = queued(rows).length
    assert(state.queuedWhileHeld <= 2, 'Unexpected queued delivery')
  } else if (failed.length > 0 && state.failureIdentity === null) {
    assert.equal(failed.length, 1)
    assert.equal(failed[0].event.wordOf, 'this-app')
    state.failureIdentity = JSON.stringify([failed[0].ordinal, failed[0].at, failed[0].event])
  }
  oldTerminalUnchanged(rows)
  return assertStatus({ schema: 'brocrew.reload-status.v2', phase: state.phase,
    queryCount: kit.queries.length, oldReloads: old.reloadCalls, oldPushes: old.pushes.length,
    freshPushes: kit.queries[1]?.pushes.length ?? 0, failedTerminals: failed.length,
    completedTerminals: completions(rows).length, queuedWhileHeld: state.queuedWhileHeld,
    heldMs: state.heldMs })
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
  return status()
}
async function exitCli() {
  const observed = status()
  assert.equal(state.phase, 'reload-held')
  assert.equal(observed.queuedWhileHeld, 2, 'Both later sends must be queued while the reload is held')
  assert.equal(state.exitStarted, false, 'CLI exit already entered')
  state.exitStarted = true
  const old = state.kit.queries[0]
  old.exitCli(1)
  await until(() => failures(ledger()).length === 1, 'failed terminal after the CLI exit')
  status()
  // The actual host resumes only once the old query has returned.
  await delay(50)
  state.freshBeforeReturn = state.kit.queries.length - 1
  assert.equal(state.freshBeforeReturn, 0, 'Actual host resumed before the old query returned')
  old.returnGate.release()
  state.phase = 'cli-exited'
  return status()
}
async function receipt() {
  assert(state?.phase === 'cli-exited' && !state.receiptStarted, 'Receipt phase refused')
  state.receiptStarted = true
  noOtherSessions()
  const { kit } = state, old = kit.queries[0]
  await until(() => kit.queries.length === 2 && deliveryMessages(kit.queries[1].pushes).length === WORDS.length &&
    completions(ledger()).length === kit.queries[1].pushes.length && !actualHost.arrivals.has(state.sessionId),
  'main-app real IPC delivery and completion', 5000)
  const fresh = kit.queries[1]
  assert.equal(fresh.resume, kit.handles[0].ref.sessionId)
  const beforePush = fresh.pushes.length, beforeTurn = turnRows(ledger()).length
  old.lateResult()
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
    heldMs: state.heldMs, heldWithoutFailure: true,
    failedTerminals: failures(rows).length, failedByApp: failures(rows)[0].event.wordOf === 'this-app',
    oldPushes: old.pushes.length, oldReloads: old.reloadCalls, queuedWhileHeld: state.queuedWhileHeld,
    freshBeforeReturn: state.freshBeforeReturn,
    ...lifecycleEvidence(rows.map(row => row.event)),
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
  return assertMainAppBehavior({ schema: 'brocrew.reload-main-app-behavior.v2',
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
  if (input.op === 'exitCli') return exitCli()
  return receipt()
}
