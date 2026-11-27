// packaged-plugin-gate-only:reload-v1
// Stage only at scripts/gates/plugin-reload/fixture.mjs in an owned SOURCE projection.
// REAL adapter + REAL host; only the SDK Query and logical child process are controlled.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { performance } from 'node:perf_hooks'
import { ClaudeRuntime } from '../../../packages/runtime/src/claude/claude-runtime.ts'
import { AsyncQueue } from '../../../packages/runtime/src/internal/async-queue.ts'
import { RuntimeHost } from '../../../apps/desktop/src/main/runtime/runtime-host.ts'
import { openDatabase } from '../../../apps/desktop/src/main/db/connection.ts'
import { applyMigrations } from '../../../apps/desktop/src/main/db/migrate.ts'
import { createSessionStore } from '../../../apps/desktop/src/main/db/session-store.ts'
import { NO_DISCOVERY } from '../../../apps/desktop/src/main/adopt/discover-sessions.ts'
import { SOURCE, TREE, MODE, SDK_VERSION, RELOAD_HELD_MS, assertBehavior, DELIVERY_WORDS, deliveryMessages, deliveryEvidence, lifecycleEvidence } from './contract.mjs'

export const WORDS = DELIVERY_WORDS
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function deferred() {
  let release, fail
  const promise = new Promise((resolve, reject) => { release = resolve; fail = reject })
  promise.catch(() => {})
  return { promise, release, fail }
}
export async function until(predicate, label, maxMs = 2500) {
  const end = performance.now() + maxMs
  while (!predicate()) {
    assert(performance.now() < end, `Reload fixture wait failed: ${label}`)
    await delay(5)
  }
}
export async function bounded(promise, label, ms = 4000) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Reload fixture deadline: ${label}`)), ms)
    })])
  } finally { clearTimeout(timer) }
}
export function ownedFolder(root, target, create = false) {
  assert(path.isAbsolute(root) && path.resolve(root) === root)
  assert(fs.realpathSync(root) === root && !fs.lstatSync(root).isSymbolicLink())
  const relative = path.relative(root, target)
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    if (!fs.existsSync(current)) {
      assert(create)
      fs.mkdirSync(current, { mode: 0o700 })
    }
    const stat = fs.lstatSync(current)
    assert(stat.isDirectory() && !stat.isSymbolicLink())
  }
  assert.equal(fs.realpathSync(target), target)
  return target
}
function recordInto(events, value) {
  assert(events.length < 1024, 'Reload fixture event bound exceeded')
  events.push(value)
}
const turns = events => events.filter(e => e.type === 'turn')
const failed = events => turns(events).filter(e => e.state === 'failed')
const completed = events => turns(events).filter(e => e.state === 'completed')

// The real watchClaudeChild receives this EventEmitter through its injected spawn callback.
// No OS process is created, no numeric pid is assigned, and kill is never permitted.
class LogicalChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = undefined
  exitCode = null
  signalCode = null
  killed = false
  exited = false
  kill() { throw new Error('Reload fixture refuses OS process signalling') }
  finish(code = 0) {
    if (this.exited) return
    this.exited = true
    this.exitCode = code
    this.emit('exit', code, null)
    this.emit('close', code, null)
    for (const pipe of [this.stdin, this.stdout, this.stderr]) pipe.destroy()
  }
}

// Adapted from FakeQuery + TheCliAnswersInOrder. Old close deliberately leaves its
// iterator readable until delayed return, so a late provider result is adversarially delivered.
class ControlledQuery {
  messages = new AsyncQueue(32)
  reloadGate = deferred()
  returnGate = deferred()
  reloadCalls = 0
  closeCalls = 0
  returnCalls = 0
  reloadAt = 0
  pushes = []
  promptError = false
  promptDrained = false
  returnSettled = false
  resultTimers = new Set()
  constructor(old, child, resume) {
    this.old = old
    this.child = child
    this.resume = resume
    if (!old) { this.reloadGate.release(); this.returnGate.release() }
  }
  reloadPlugins() {
    this.reloadCalls++
    this.reloadAt ||= performance.now()
    return this.reloadGate.promise
  }
  async interrupt() {}
  close() { this.closeCalls++ }
  async return() {
    this.returnCalls++
    await this.returnGate.promise
    for (const timer of this.resultTimers) clearTimeout(timer)
    this.resultTimers.clear()
    this.messages.close()
    if (!this.old) this.child.finish()
    this.returnSettled = true
  }
  [Symbol.asyncIterator]() { return this.messages[Symbol.asyncIterator]() }
  emit(message) { this.messages.push(message) }
  lateResult() {
    this.emit({ type: 'result', subtype: 'success', is_error: false, user_message_uuid: null })
  }
  // The CLI dies. As the SDK does, its exit ends the message stream with the exit error and
  // rejects the pending reload; card 197 put no clock on that reload.
  exitCli(code = 1) {
    const exit = new Error(`Claude Code process exited with code ${code}`)
    this.child.finish(code)
    this.messages.fail(exit)
    this.reloadGate.fail(exit)
  }
  listen(prompt) {
    this.promptDrain = (async () => {
      for await (const message of prompt) {
        assert(this.pushes.length < 4, 'Reload fixture prompt bound exceeded')
        assert.equal(message.type, 'user')
        assert.equal(typeof message.uuid, 'string')
        this.pushes.push(message)
        if (!this.old) {
          const timer = setTimeout(() => {
            this.resultTimers.delete(timer)
            // Result echoes the UUID actually consumed, as the existing scripted query does.
            this.emit({ type: 'result', subtype: 'success', is_error: false,
              user_message_uuid: message.uuid, user_message_uuids: [message.uuid] })
          }, 0)
          this.resultTimers.add(timer)
        }
      }
    })().catch(() => { this.promptError = true }).finally(() => { this.promptDrained = true })
  }
}

export function makeRuntime(home, skills, sessionId, { mainApp = false } = {}) {
  const queries = [], handles = [], consumers = [], events = []
  let spawning = null, activeLaunch = null
  const factory = params => {
    assert(queries.length < 2, 'Reload fixture refuses a third query')
    const old = queries.length === 0
    const launch = activeLaunch
    assert(launch, 'Controlled factory must belong to a recorded real launch')
    if (mainApp) {
      assert(launch.builtInSkills && launch.sharedSkillsRoot, 'Main-app skill context missing')
      ownedFolder(home, launch.providerHome)
      ownedFolder(home, launch.cwd)
      ownedFolder(home, launch.builtInSkills.root)
      ownedFolder(home, launch.sharedSkillsRoot)
    }
    const launchCwd = mainApp ? launch.cwd : home
    const launchSkills = mainApp ? launch.builtInSkills.root : skills
    const skillNames = mainApp ? launch.builtInSkills.skills.map(s => s.name) : []
    const launchId = mainApp ? (params.options.resume ?? params.options.sessionId) : sessionId
    assert.equal(typeof launchId, 'string')
    const child = new LogicalChild()
    spawning = child
    assert.equal(typeof params.options.spawnClaudeCodeProcess, 'function')
    // Invoke the REAL adapter-owned child witness; the injected spawn returns only this object.
    params.options.spawnClaudeCodeProcess({ command: 'controlled-no-cli', args: [], cwd: launchCwd, env: {} })
    assert.equal(spawning, null)
    const query = new ControlledQuery(old, child, params.options.resume ?? null)
    queries.push(query)
    query.listen(params.prompt)
    query.emit({ type: 'system', subtype: 'init', session_id: launchId, cwd: launchCwd,
      plugins: [{ name: 'brobot', path: launchSkills }], skills: skillNames })
    return query
  }
  const spawn = options => {
    assert.equal(options.command, 'controlled-no-cli')
    assert(spawning instanceof LogicalChild, 'Unexpected logical spawn')
    const child = spawning
    spawning = null
    return child
  }
  class RecordedClaudeRuntime extends ClaudeRuntime {
    async start(options) {
      assert.equal(activeLaunch, null, 'Overlapping controlled start')
      activeLaunch = options
      try {
        const handle = await super.start(options)
        handles.push(handle)
        return handle
      } finally { activeLaunch = null }
    }
    async resume(ref, options) {
      assert.equal(activeLaunch, null, 'Overlapping controlled resume')
      activeLaunch = { ...options, cwd: ref.cwd }
      try {
        const handle = await super.resume(ref, options)
        handles.push(handle)
        return handle
      } finally { activeLaunch = null }
    }
  }
  const runtime = new RecordedClaudeRuntime(factory, async () => true,
    undefined, undefined, spawn, undefined, process.platform,
    () => 'Controlled fixture has no login', 'controlled-no-cli')
  // Keep the REAL handles as returned. No proxy/override of send, status, retirement or close.
  return {
    runtime, queries, handles, consumers, events,
    context: { cwd: home, providerHome: home,
      builtInSkills: { root: skills, skills: [] }, sharedSkillsRoot: path.join(home, 'skills') },
    collect(handle) {
      consumers.push((async () => { for await (const event of handle.events()) recordInto(events, event) })())
    },
    async cleanup() {
      for (const q of queries) { q.reloadGate.release(); q.returnGate.release(); q.child.finish() }
      await bounded(Promise.all(handles.map(h => h.close())), 'adapter handles close')
      await bounded(Promise.all(consumers), 'adapter event streams close')
      await bounded(Promise.all(queries.map(q => q.promptDrain)), 'prompt readers close')
      assert(queries.every(q => !q.promptError))
      await bounded(Promise.all(handles.map(h => h.awaitProcessExit())), 'controlled exit receipts')
      await until(() => queries.every(q => [q.child.stdin, q.child.stdout, q.child.stderr].every(p => p.closed)), 'controlled pipe closes')
    },
    cleanupFacts() {
      return {
        handles: handles.length,
        endedHandles: handles.filter(h => ['ended', 'errored'].includes(h.status()) && h.isRetiring?.() === false).length,
        queries: queries.length,
        closedQueries: queries.filter(q => q.closeCalls >= 1).length,
        returnedQueries: queries.filter(q => q.returnCalls === 1).length,
        settledReturns: queries.filter(q => q.returnSettled).length,
        drainedPromptReaders: queries.filter(q => q.promptDrained && !q.promptError).length,
        exitedChildren: queries.filter(q => q.child.exited).length,
        closedPipes: queries.reduce((n, q) => n + [q.child.stdin, q.child.stdout, q.child.stderr].filter(p => p.closed && p.destroyed).length, 0),
      }
    },
  }
}
// The reload outlasts the removed 60 s limit with nothing failed, sent or closed (card 197).
async function holdReload(query, failures, label) {
  await until(() => query.reloadCalls === 1, `${label} reload requested`)
  await delay(Math.max(0, RELOAD_HELD_MS - (performance.now() - query.reloadAt)))
  const heldMs = Math.round(performance.now() - query.reloadAt)
  assert(heldMs >= RELOAD_HELD_MS)
  assert.equal(failures(), 0, `${label} reload failed before the CLI exited`)
  assert.equal(query.pushes.length, 0)
  assert.equal(query.closeCalls, 0, `${label} query closed while its reload was held`)
  return heldMs
}

export async function adapterCase(home, skills) {
  const kit = makeRuntime(home, skills, 'sess_controlled_reload_adapter')
  let result
  try {
    const handle = await kit.runtime.start(kit.context)
    kit.collect(handle)
    await until(() => handle.ref !== null, 'adapter init')
    const old = kit.queries[0]
    let settled = false
    const outcome = handle.send(WORDS[0]).then(() => 'unexpected-sent', error => error.message)
    void outcome.then(() => { settled = true })
    const heldMs = await holdReload(old, () => failed(kit.events).length, 'adapter')
    assert.equal(settled, false)
    await assert.rejects(handle.send('reload refused while held'))
    assert.equal(turns(kit.events).length, 0)
    old.exitCli(1)
    const exitRejected = await bounded(outcome, 'adapter reload ended by the CLI exit') === 'Claude Code process exited with code 1'
    await until(() => failed(kit.events).length === 1, 'adapter failed terminal')
    const appFailure = failed(kit.events)[0]
    await assert.rejects(handle.send('reload refused after the exit'))
    const beforeLate = turns(kit.events).length
    old.lateResult()
    await delay(30)
    assert.equal(old.reloadCalls, 1)
    assert.equal(old.pushes.length, 0)
    await bounded(handle.awaitProcessExit(), 'controlled child witness')
    old.returnGate.release()
    await bounded(handle.close(), 'adapter delayed return')
    const exitObserved = old.child.exited && ['ended', 'errored'].includes(handle.status())
    const freshHandle = await kit.runtime.resume(handle.ref, kit.context)
    kit.collect(freshHandle)
    await until(() => freshHandle.ref !== null, 'adapter fresh init')
    await freshHandle.send('reload adapter fresh retry')
    await until(() => completed(kit.events).length === 1, 'adapter fresh completion')
    const fresh = kit.queries[1]
    assert.equal(fresh.resume, handle.ref.sessionId)
    result = {
      heldMs, heldWithoutFailure: true, failedTerminals: failed(kit.events).length,
      failedByApp: appFailure.wordOf === 'this-app', exitRejected,
      oldPushes: old.pushes.length, oldReloads: old.reloadCalls, oldSendRefusals: 2,
      lateAddedTerminals: turns(kit.events).length - beforeLate - 1, exitObserved,
      freshQueries: kit.queries.length - 1, freshResumeMatches: fresh.resume === handle.ref.sessionId,
      freshPushes: fresh.pushes.length, freshReloads: fresh.reloadCalls,
      freshCompleted: completed(kit.events).length,
    }
  } finally { await kit.cleanup() }
  result.failedTerminals = failed(kit.events).length
  result.freshCompleted = completed(kit.events).length
  assert.equal(turns(kit.events).length, 2, 'Adapter terminal added during cleanup')
  return { result, cleanup: kit.cleanupFacts() }
}

async function hostQueueCase(home, skills, migrationsPath, mainBinding = null) {
  const db = mainBinding === null ? openDatabase(path.join(home, 'controlled.sqlite')) : null
  let host, kit, result, oldTerminalIdentity
  const events = []
  const pending = []
  let databaseClosed = false
  try {
    if (db) applyMigrations(db, migrationsPath)
    const store = mainBinding?.store ?? createSessionStore(db)
    kit = mainBinding?.kit ?? makeRuntime(home, skills, 'sess_controlled_reload_host')
    const sink = { ownerId: 'controlled-reload-owner', aPersonIsBehindIt: true, alive: true,
      send(value) { recordInto(events, value.event) }, sendLiveness() {} }
    host = mainBinding?.host ?? new RuntimeHost({
      store, discoverSessions: NO_DISCOVERY, nativeTranscriptPath: () => null,
      exportDirectory: () => path.join(home, 'exports'),
      createRuntime: provider => { assert.equal(provider, 'claude'); return kit.runtime },
      prepareProviderHome: () => home, providerHomePath: () => home, resolveCwd: () => home,
      newSessionId: () => 'sess_reload_host_owned', closeDrainTimeoutMs: 2000,
      sharedSkillsRoot: async () => path.join(home, 'skills'),
      prepareBuiltInSkills: async ({ isCurrent }) => ({
        context: { root: skills, skills: [] }, reminder: '', version: 'controlled-v1', isCurrent,
      }),
      readProviderConfig: () => ({ home, homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'controlled-model', authNote: null, files: [] }),
    })
    if (mainBinding) assert.equal(host.sessionIds.length, 0, 'Main app must have no other sessions')
    const created = await host.createSession({ provider: 'claude', cwd: home }, sink)
    await until(() => kit.queries.length === 1 && events.some(e => e.type === 'session'), 'host init')
    const old = kit.queries[0]
    const expectedResume = kit.handles[0].ref.sessionId
    const original = host.send(created.sessionId, WORDS[0], sink)
    pending.push(original); original.catch(() => {})
    const heldMs = await holdReload(old, () => failed(events).length, 'host')
    // The person keeps writing while the reload is held: both are queued behind the original.
    const second = host.send(created.sessionId, WORDS[1], sink)
    const third = host.send(created.sessionId, WORDS[2], sink)
    pending.push(second, third)
    await until(() => store.events(created.sessionId).filter(r => r.event.type === 'message_queued').length === 2, 'two queued while held')
    const queuedWhileHeld = store.events(created.sessionId).filter(r => r.event.type === 'message_queued').length
    assert.equal(kit.queries.length, 1); assert.equal(old.pushes.length, 0)
    old.exitCli(1)
    await until(() => failed(events).length === 1, 'host failed terminal')
    const firstFailure = failed(events)[0]
    oldTerminalIdentity = JSON.stringify(firstFailure)
    // The host resumes only once the old query has returned.
    await delay(50)
    const freshBeforeReturn = kit.queries.length - 1
    old.returnGate.release()
    await bounded(Promise.all(pending), 'host redelivery and queued sends', 5000)
    await until(() => kit.queries.length === 2 && deliveryMessages(kit.queries[1].pushes).length === WORDS.length &&
      completed(events).length === kit.queries[1].pushes.length && !host.arrivals.has(created.sessionId),
      'all messages delivered with fresh real adapter completions')
    const fresh = kit.queries[1]
    assert.equal(fresh.resume, expectedResume)
    const beforePushes = fresh.pushes.length, beforeTerminals = turns(events).length
    old.lateResult()
    await delay(30)
    assert.equal(failed(events).length, 1, 'Failure added after handover or late result')
    assert.equal(JSON.stringify(failed(events)[0]), oldTerminalIdentity, 'Old failed terminal changed')
    const ledger = store.events(created.sessionId).map(one => one.event)
    const userTurns = ledger.filter(e => e.type === 'user_turn')
    const contents = fresh.pushes.map(m => m.message.content)
    const once = word => contents.filter(text => typeof text === 'string' && text.split(/\r?\n/).some(line => line.trim() === word)).length === 1
    result = {
      heldMs, heldWithoutFailure: true, failedTerminals: failed(events).length,
      failedByApp: firstFailure.wordOf === 'this-app',
      oldPushes: old.pushes.length, oldReloads: old.reloadCalls, queuedWhileHeld, freshBeforeReturn,
      ...lifecycleEvidence(ledger), freshQueries: kit.queries.length - 1,
      freshResumeMatches: fresh.resume === expectedResume, freshReloads: fresh.reloadCalls,
      freshPushes: fresh.pushes.length, uniqueUserUuids: new Set(fresh.pushes.map(m => m.uuid)).size,
      originalOnce: once(WORDS[0]), secondOnce: once(WORDS[1]), thirdOnce: once(WORDS[2]),
      ledgerUserTurns: userTurns.length, freshCompleted: completed(events).length,
      lateAddedPushes: fresh.pushes.length - beforePushes,
      lateAddedTerminals: turns(events).length - beforeTerminals,
      ...deliveryEvidence(fresh.pushes, userTurns),
    }
  } finally {
    if (kit) for (const q of kit.queries) { q.reloadGate.release(); q.returnGate.release(); q.child.finish() }
    await bounded(Promise.allSettled(pending), 'host pending sends cleanup')
    if (host) {
      await bounded(host.closeAll(), 'host closeAll')
      assert.equal(host.sessionIds.length, 0, 'Host handles remain registered')
    }
    if (kit) {
      await bounded(Promise.all(kit.queries.map(q => q.promptDrain)), 'host prompt readers close')
      assert(kit.queries.every(q => !q.promptError))
      await kit.cleanup()
    }
    if (db) { db.close(); databaseClosed = true }
  }
  result.failedTerminals = failed(events).length
  assert.equal(result.failedTerminals, 1, 'Failure added after the exit or cleanup')
  assert.equal(JSON.stringify(failed(events)[0]), oldTerminalIdentity)
  assert.equal(turns(events).length, result.freshPushes + 1, 'Host terminal added during cleanup')
  assert.equal(kit.queries[1].pushes.length, result.freshPushes, 'Prompt added during cleanup')
  assert.equal(completed(events).length, result.freshPushes, 'Completion changed during cleanup')
  assert.deepEqual(lifecycleEvidence(events), { starts: result.starts, resumes: result.resumes }, 'Lifecycle changed during cleanup')
  return { result, databaseClosed, cleanup: kit.cleanupFacts(), registeredHandles: host.sessionIds.length }
}

// Provisional wrapper seam: caller must first enforce reviewed Windows admission, source/bundle
// identities, owned-root ACL and sterile environment. This function is not an admission engine.
export async function runReloadQualification({ ownedRoot, migrationsPath }) {
  assert.equal(process.platform, 'win32', 'Windows-only reload qualification')
  assert(path.isAbsolute(ownedRoot) && fs.realpathSync(ownedRoot) === ownedRoot)
  ownedFolder(ownedRoot, migrationsPath)
  const root = path.join(ownedRoot, 'reload-case-v1')
  assert(!fs.existsSync(root), 'Reload fixture refuses reuse')
  fs.mkdirSync(root, { mode: 0o700 })
  const adapterHome = ownedFolder(ownedRoot, path.join(root, 'adapter'), true)
  const hostHome = ownedFolder(ownedRoot, path.join(root, 'host'), true)
  for (const home of [adapterHome, hostHome]) {
    ownedFolder(ownedRoot, path.join(home, 'built-in-skills'), true)
    ownedFolder(ownedRoot, path.join(home, 'skills'), true)
  }
  const adapter = await adapterCase(adapterHome, path.join(adapterHome, 'built-in-skills'))
  const host = await hostQueueCase(hostHome, path.join(hostHome, 'built-in-skills'), migrationsPath)
  return assertBehavior({ schema: 'brocrew.reload-behavior.v1', mode: MODE, sourceSha: SOURCE,
    sourceTree: TREE, sdkDeclaredVersion: SDK_VERSION, adapter: adapter.result, hostQueue: host.result,
    cleanup: cleanupReceipt(adapter.cleanup, host.cleanup, host.databaseClosed, host.registeredHandles) })
}

// Derived from held real handles, controlled query receipts, readers and pipe close events.
export function cleanupReceipt(adapter, host, databaseClosed, registeredHandles) {
  const facts = Object.fromEntries(Object.keys(adapter).map(key => [key, adapter[key] + host[key]]))
  return { ...facts, registeredHandles,
    allHandlesClosed: facts.handles === 4 && facts.endedHandles === facts.handles &&
      ['closedQueries', 'returnedQueries', 'settledReturns', 'drainedPromptReaders'].every(key => facts[key] === facts.queries) &&
      facts.closedPipes === facts.queries * 3 && registeredHandles === 0,
    controlledChildrenExited: facts.exitedChildren === facts.queries,
    databaseClosed: databaseClosed === true }
}

// Main-app route ONLY: no RuntimeHost/database is constructed on this call path.
// The projected index passes its actual runtimeHost and same store, and createRuntime
// returns this kit.runtime. The controlled sink stands in for the gate author; native
// window/CDP/IPC evidence must be retained separately by the Windows driver.
export async function runMainAppQueueQualification({ ownedRoot, host, store, kit }) {
  assert.equal(process.platform, 'win32')
  assert(host && store && kit && kit.handles.length === 0 && kit.queries.length === 0)
  const work = path.join(ownedRoot, 'reload-main-work-v1')
  assert(!fs.existsSync(work), 'Main-app case refuses reuse')
  fs.mkdirSync(work, { mode: 0o700 })
  ownedFolder(ownedRoot, work)
  const answer = await hostQueueCase(work, null, null, { host, store, kit })
  assert.equal(answer.databaseClosed, false, 'Main app owns database closure')
  return answer
}
