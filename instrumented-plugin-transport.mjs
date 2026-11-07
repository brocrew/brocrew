import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { createConnection } from 'node:net'

export const transportLabel = 'instrumented transport, not public delivery'
const catalogues = [
  'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue.json',
  'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json',
]
const key = '__brocrewInstrumentedPluginTransport_v1'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const samePath = (a, b) => a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()

export async function assertUnusedInspectorPort(port) {
  assert(Number.isSafeInteger(port) && port > 0 && port < 65536)
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const timer = setTimeout(() => { socket.destroy(); reject(Error('Inspector port preflight deadline')) }, 2000)
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(Error(`Inspector port already occupied: ${port}`)) })
    socket.once('error', error => { clearTimeout(timer); socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(); else reject(error) })
  })
}

// Preparation only reads input bytes. Installing a hook requires execute:true below.
export function readTransportFixture(path) {
  const raw = readFileSync(path), manifest = JSON.parse(raw)
  assert.equal(manifest.format, 1)
  assert(Array.isArray(manifest.entries) && manifest.entries.length >= 3 && manifest.entries.length <= 32)
  const seen = new Set()
  const entries = manifest.entries.map(entry => {
    const url = new URL(entry.url)
    assert.equal(url.href, entry.url)
    assert(!seen.has(entry.url)); seen.add(entry.url)
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash)
    assert(catalogues.includes(entry.url) || (url.hostname === 'github.com' && /^\/brocrew\/[A-Za-z0-9_.-]+\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname)))
    assert(isAbsolute(entry.path))
    assert(/^[a-f0-9]{64}$/.test(entry.sha256))
    assert(Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 512 * 1024 * 1024)
    const file = realpathSync(entry.path)
    assert(statSync(file).isFile())
    const bytes = readFileSync(file)
    assert.equal(bytes.length, entry.size, `Fixture size: ${entry.url}`)
    assert.equal(sha(bytes), entry.sha256, `Fixture digest: ${entry.url}`)
    return { url: entry.url, path: file, size: entry.size, sha256: entry.sha256 }
  })
  for (const url of catalogues) assert(seen.has(url), `Missing catalogue: ${url}`)
  return Object.freeze({ label: transportLabel, manifestSha256: sha(raw), entries: Object.freeze(entries.map(Object.freeze)) })
}

// Serialized into the inspected process. No imports, lifecycle/state hooks, or writes.
function installInTarget(fixture, expected, key) {
  const fs = process.getBuiltinModule('fs'), crypto = process.getBuiltinModule('crypto')
  const check = (ok, message) => { if (!ok) throw Error(message) }
  const same = (a, b) => a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
  check(process.pid === expected.pid && same(fs.realpathSync(process.execPath), fs.realpathSync(expected.executablePath)), 'Transport target identity differs')
  check(digest(fs.readFileSync(process.execPath)) === expected.executableSha256, 'Transport target executable differs')
  check(typeof globalThis.fetch === 'function' && typeof Response === 'function', 'Target has no global fetch/Response')
  check(!Object.hasOwn(globalThis, key), 'Transport already installed')
  const original = globalThis.fetch, entries = new Map(fixture.entries.map(e => [e.url, Object.freeze(e)]))
  const calls = [], denied = []
  let stopped = false
  async function instrumentedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const entry = entries.get(url)
    if (!entry) {
      const parsed = new URL(url)
      if ((parsed.hostname === 'raw.githubusercontent.com' && parsed.pathname.startsWith('/brocrew/brocrew/main/plugins/')) ||
          (parsed.hostname === 'github.com' && parsed.pathname.startsWith('/brocrew/') && parsed.pathname.includes('/releases/download/'))) {
        denied.push({ at: Date.now(), reason: 'unmapped-plugin-url' })
        throw Error('Unmapped instrumented plugin URL')
      }
      return Reflect.apply(original, this, [input, init])
    }
    check(!stopped && calls.length < 1024, 'Instrumented transport stopped or receipt limit reached')
    const signal = init?.signal ?? input?.signal
    signal?.throwIfAborted()
    check((init?.method ?? input?.method ?? 'GET').toUpperCase() === 'GET', 'Fixture accepts GET only')
    const bytes = fs.readFileSync(entry.path)
    check(bytes.length === entry.size && digest(bytes) === entry.sha256, 'Instrumented fixture changed')
    signal?.throwIfAborted()
    calls.push({ at: Date.now(), pid: process.pid, url: entry.url, size: bytes.length, sha256: entry.sha256 })
    return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length), 'content-encoding': 'identity', 'content-type': entry.url.endsWith('.json') ? 'application/json' : 'application/octet-stream' } })
  }
  const snapshot = () => ({ label: fixture.label, manifestSha256: fixture.manifestSha256, pid: process.pid,
    executablePath: process.execPath, node: process.versions.node, electron: process.versions.electron ?? null,
    installedAt, active: globalThis.fetch === instrumentedFetch, calls: calls.slice(), denied: denied.slice() })
  const installedAt = Date.now()
  Object.defineProperty(globalThis, key, { configurable: true, value: Object.freeze({ snapshot, restore() {
    check(globalThis.fetch === instrumentedFetch, 'Transport hook was replaced')
    stopped = true; globalThis.fetch = original; delete globalThis[key]
    return { ...snapshot(), restored: globalThis.fetch === original }
  } }) })
  globalThis.fetch = instrumentedFetch
  return snapshot()
}

async function connectInspector(port, timeoutMs = 15000) {
  assert(Number.isSafeInteger(port) && port > 0 && port < 65536)
  const deadline = Date.now() + timeoutMs
  let target
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
      assert.equal(response.status, 200)
      const targets = await response.json()
      assert.equal(targets.length, 1)
      target = targets[0]
      break
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  assert(target?.webSocketDebuggerUrl, 'Inspector unavailable; do not weaken fuses or substitute delivery')
  const url = new URL(target.webSocketDebuggerUrl)
  assert(url.protocol === 'ws:' && url.hostname === '127.0.0.1' && Number(url.port) === port && !url.username && !url.password)
  const socket = new WebSocket(url), pending = new Map(), listeners = new Map()
  let sequence = 0
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(Error('Inspector connection deadline')) }, timeoutMs)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(Error('Inspector connection failed')) }, { once: true })
  })
  function failed() { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Inspector disconnected')) } pending.clear() }
  socket.addEventListener('close', failed)
  socket.addEventListener('error', failed)
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (message.method) for (const listener of listeners.get(message.method) ?? []) listener(message.params)
    const p = pending.get(message.id)
    if (!p) return
    pending.delete(message.id); clearTimeout(p.timer)
    if (message.error) p.reject(Error(JSON.stringify(message.error)))
    else p.resolve(message.result)
  })
  return {
    on(method, listener) { const list = listeners.get(method) ?? []; list.push(listener); listeners.set(method, list) },
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`Inspector deadline: ${method}`)) }, timeoutMs)
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
      })
    },
    close() { socket.close(); failed() },
  }
}

async function evaluate(client, expression) {
  const response = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false })
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails
    throw Error(`Inspector fixture evaluation: ${detail.exception?.className ?? detail.text}; line ${detail.lineNumber ?? 'unknown'}`)
  }
  return response.result?.value
}

async function observe(expected, observeProcess) {
  assert(Number.isSafeInteger(expected.pid) && expected.pid > 0)
  assert(isAbsolute(expected.executablePath) && /^[a-f0-9]{64}$/.test(expected.executableSha256))
  assert(typeof expected.birth === 'string' && /^\d+$/.test(expected.birth), 'Use exact native FILETIME string')
  assert.equal(typeof observeProcess, 'function')
  const actual = await observeProcess(expected.pid)
  assert.equal(actual.pid, expected.pid)
  assert.equal(actual.birth, expected.birth)
  assert(samePath(actual.executablePath, expected.executablePath))
  assert.equal(sha(readFileSync(expected.executablePath)), expected.executableSha256)
  return actual
}

async function attach({ execute, fixture, expected, observeProcess, port, cold, mainEntrySuffix }) {
  assert.equal(execute, true, 'Inspection instrumentation requires explicit execute:true')
  assert.equal(fixture.label, transportLabel)
  const before = await observe(expected, observeProcess)
  const client = await connectInspector(port)
  let installed
  try {
    await client.call('Runtime.enable')
    const identityExpression = '({pid:process.pid,executablePath:process.execPath,node:process.versions.node})'
    const initialIdentity = await evaluate(client, identityExpression)
    let pause
    if (cold) {
      const scripts = new Map()
      client.on('Debugger.scriptParsed', script => scripts.set(script.scriptId, script.url))
      const paused = new Promise(resolve => client.on('Debugger.paused', resolve))
      await client.call('Debugger.enable')
      await client.call('Runtime.runIfWaitingForDebugger')
      let timer
      try { pause = await Promise.race([paused, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No cold main entry pause')), 15000) })]) }
      finally { clearTimeout(timer) }
      const frame = pause.callFrames[0]
      const url = frame.url || scripts.get(frame.location.scriptId) || ''
      assert(url.replaceAll('\\', '/').toLowerCase().endsWith(mainEntrySuffix.toLowerCase()), 'Pause is not the packaged main entry; cold proof unavailable')
      pause = { url, lineNumber: frame.location.lineNumber, reason: pause.reason }
    }
    // At the initial frontend wait, Node has not yet patched process.pid/execPath.
    // Cold attachment first reaches the owned entry pause; no user entry is resumed here.
    const identity = cold ? await evaluate(client, identityExpression) : initialIdentity
    assert.equal(identity.pid, expected.pid)
    assert(samePath(identity.executablePath, expected.executablePath))
    await observe(expected, observeProcess)
    installed = await evaluate(client, `(${installInTarget.toString()})(${JSON.stringify(fixture)},${JSON.stringify(expected)},${JSON.stringify(key)})`)
    const after = await observe(expected, observeProcess)
    const receipt = { label: transportLabel, before, after, initialIdentity, identity, pause, installed }
    if (cold) { await client.call('Debugger.resume'); await client.call('Debugger.disable') }
    return {
      receipt,
      async snapshot() { await observe(expected, observeProcess); return evaluate(client, `globalThis[${JSON.stringify(key)}].snapshot()`) },
      async detach() {
        try { await observe(expected, observeProcess); return await evaluate(client, `globalThis[${JSON.stringify(key)}].restore()`) }
        finally { client.close() }
      },
      async activateSupervisorInspector(serviceExpected, serviceObserve) {
        await assertUnusedInspectorPort(9229)
        await observe(serviceExpected, serviceObserve)
        assert.notEqual(serviceExpected.pid, expected.pid)
        await evaluate(client, `process._debugProcess(${serviceExpected.pid}); true`)
        await observe(serviceExpected, serviceObserve)
      },
      close: () => client.close(),
    }
  } catch (error) {
    const cleanup = { attempted: Boolean(installed), restored: false }
    if (installed) {
      try {
        cleanup.receipt = await evaluate(client, `globalThis[${JSON.stringify(key)}].restore()`)
        cleanup.restored = cleanup.receipt?.restored === true
      } catch (restoreError) { cleanup.failure = { name: restoreError.name, message: restoreError.message } }
    }
    error.transportCleanup = cleanup
    client.close()
    throw error
  }
}

// Add this to the harness launch argv, NOT NODE_OPTIONS. Do not change any fuse.
export function coldMainArgument(port) {
  assert(Number.isSafeInteger(port) && port > 0 && port < 65536 && port !== 9229)
  return `--inspect-brk=127.0.0.1:${port}`
}
export function attachColdMain(options) {
  return attach({ ...options, cold: true, mainEntrySuffix: '/resources/app.asar/out/main/index.js' })
}
// Caller activates it through main.activateSupervisorInspector AFTER native service binding,
// BEFORE the first Settings prepare/list/install. Default Node debugger listener is 127.0.0.1:9229.
export function attachSupervisor(options) {
  assert.equal(options.port ?? 9229, 9229)
  return attach({ ...options, port: 9229, cold: false })
}
