import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentScope } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleOptions } from '../src/main/plugins/lifecycle/types'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
} from './plugin-lifecycle-fixtures'
import { manifestFor, packageFixture, signed, tar } from './plugin-package-fixtures'

const A = 'fictional-garden',
  B = 'fictional-moss',
  C = 'fictional-notes'
const releases: Array<() => void> = []
const closers: Array<() => Promise<void>> = []
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  const errors: unknown[] = []
  try {
    for (const close of closers.splice(0).reverse()) {
      try {
        await close()
      } catch (error) {
        errors.push(error)
      }
    }
  } finally {
    vi.restoreAllMocks()
    syncBuiltinESMExports()
    await cleanupLifecycleFixtures()
  }
  if (errors.length) throw new AggregateError(errors, 'Agent scope fixture cleanup failed')
})

function packaged(id: string) {
  const target = {
    os: process.platform as 'darwin' | 'linux' | 'win32',
    cpu: process.arch as 'arm64' | 'x64',
  }
  if (id === C) {
    const pkg = packageFixture({
      manifest: {
        ...manifestFor(),
        format: 2,
        id,
        authors: ['fictional-gardeners'],
        platforms: [target],
        executor: { kind: 'node', entry: 'dist/recipe.mjs' },
        server: null,
        toolApi: null,
        ui: null,
        uiApi: null,
        skills: [],
        serviceTemplates: [],
        hooks: [
          {
            id: 'titles',
            kind: 'turn.context.titles',
            api: 1,
            optional: true,
            inputs: ['resource-titles'],
          },
        ],
      },
    })
    return { archive: pkg.archive, release: pkg.release }
  }
  const files = new Map([
    ['main.cjs', Buffer.from('// Fictional runtime; never executed.')],
    ['tools.json', Buffer.from('{"tools":[]}')],
  ])
  const manifest = {
    format: 3,
    id,
    name: id,
    version: '1.0.0',
    description: 'Fictional scoped tools.',
    authors: ['Fictional Gardeners'],
    platforms: [target],
    permissions: { description: 'Describe fictional garden work.' },
    files: [...files].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: pluginSha256(bytes),
    })),
    runtime: { kind: 'node', entry: 'main.cjs' },
    mcp: { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    lifecycle: { stop: { signal: 'SIGTERM' }, dataOnRemove: 'keep' },
    data: { schema: 1 },
  }
  const bytes = Buffer.from(JSON.stringify(manifest))
  const archive = tar([
    { path: 'plugin.json', body: bytes },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  return {
    archive,
    release: {
      id,
      version: manifest.version,
      sourceCommit: 'f'.repeat(40),
      platforms: [target],
      archive: {
        url: `https://plugins.example.invalid/${id}.tar`,
        size: archive.length,
        sha256: pluginSha256(archive),
        compression: 'tar' as const,
      },
      manifestSha256: pluginSha256(bytes),
    },
  }
}

async function setup() {
  const packages = new Map([A, B, C].map((id) => [id, packaged(id)]))
  const runs: Array<{
    id: string
    runId: string
    ready: ReturnType<typeof vi.fn>
    exit: () => void
    stop: ReturnType<typeof vi.fn>
  }> = []
  const start = vi.fn<LifecycleOptions['runtime']['start']>(async (spec) => {
    const exit = deferred<void>(),
      runId = randomUUID()
    const ready = vi.fn(async () => ({
      serverPid: 404941,
      origin: 'http://127.0.0.1:1',
      mcp: () => ({ url: '', headers: { Authorization: '' } }),
      admin: () => ({ url: '', headers: { Authorization: '' } }),
    }))
    const stop = vi.fn(async () => exit.resolve())
    runs.push({ id: spec.package.manifest.id, runId, ready, exit: () => exit.resolve(), stop })
    return { runId, ready, stop, exited: exit.promise }
  })
  const f = await fixture(
    {
      catalogue: signed({ format: 3, entries: [...packages.values()].map((one) => one.release) }),
      download: async (release) => packages.get(release.id)!.archive,
      runtime: { start, previousOwnerClean: async () => true, removeCode: async () => {} },
    },
    false,
    A,
  )
  const releaseSnapshot = f.state.retainOwnerReadSnapshot()
  closers.push(async () => releaseSnapshot())
  closers.push(async () => {
    f.controller.consumersEnded()
    await f.controller.drain()
  })
  return { ...f, runs, start, workspaceId: f.local.sink.workspaceId }
}
const entry = (scope: AgentScope, id: string) => scope.entries.find((one) => one.pluginId === id)!

// A completion wake must itself observe the published receipt and an admitted view.
function completion(scopes: AgentScope[], id: string) {
  const scope = scopes.find((scope) => entry(scope, id)?.is === 'admitted')
  if (!scope) throw new Error('No admitted receipt at completion wake')
  return scope
}

it('captures sorted disjoint facts once without starting, waiting, writing or eagerly reading a connection', async () => {
  const f = await setup()
  await f.controller.install(f.handle, A)
  await f.controller.install(f.handle, B)
  await f.controller.setEnabled(f.handle, B, false)
  const calls = f.runs.map((run) => run.ready.mock.calls.length)
  const read = vi.spyOn(f.state, 'readView'),
    write = vi.spyOn(f.state, 'withExclusive')
  const readFile = vi.spyOn(fs, 'readFileSync')
  syncBuiltinESMExports()
  const starts = f.start.mock.calls.length
  const scope = f.controller.agentScope(f.workspaceId)
  expect(read).toHaveBeenCalledOnce()
  expect(write).not.toHaveBeenCalled()
  expect(readFile).not.toHaveBeenCalled()
  expect(f.start).toHaveBeenCalledTimes(starts)
  expect(f.runs.map((run) => run.ready.mock.calls.length)).toEqual(calls)
  expect(scope.workspaceId).toBe(f.workspaceId)
  expect(scope.entries.map((one) => one.pluginId)).toEqual([A, B, C])
  expect(new Set(scope.entries.map((one) => one.pluginId)).size).toBe(scope.entries.length)
  expect(entry(scope, B)).toMatchObject({ is: 'off', why: 'disabled', enabled: false })
  expect(entry(scope, C)).toMatchObject({ is: 'off', why: 'not-installed', enabled: true })
  const a = entry(scope, A)
  expect(a.is).toBe('admitted')
  expect(a.enabled).toBe(true)
  if (a.is !== 'admitted') throw new Error('A must have its canonical receipt')
  expect(a.installId).toBe(a.view.installation.installId)
  expect(a.runId).toBe(a.view.runId)
  expect(a.switchRevision).toBe(f.state.getEnabled(f.workspaceId, A).revision)
  expect(a.view.current()).toBe(true)
  await a.view.connection
  expect(f.runs.find((one) => one.id === A)!.ready).toHaveBeenCalledTimes(calls[0]! + 1)
})

it('reports an exact verified package without agent tools as off', async () => {
  const f = await setup()
  await f.controller.install(f.handle, C)
  expect(entry(f.controller.agentScope(f.workspaceId), C)).toMatchObject({
    is: 'off',
    why: 'no-agent-tools',
    enabled: true,
  })
})

it('throws for a failed committed read, unknown workspace, restore exclusion and ended authority', async () => {
  const f = await setup()
  const read = f.state.readView.bind(f.state)
  const spy = vi.spyOn(f.state, 'readView')
  spy.mockImplementationOnce(() => {
    throw new Error('fictional committed read failure')
  })
  expect(() => f.controller.agentScope(f.workspaceId)).toThrow('fictional committed read failure')
  expect(() => f.controller.agentScope(randomUUID())).toThrow()
  const captured = read()
  spy.mockReturnValueOnce({
    ...captured,
    pending: () => ({ request: { consent: { action: 'global-restore' } } }),
  } as ReturnType<typeof read>)
  expect(() => f.controller.agentScope(f.workspaceId)).toThrow()
  f.controller.consumersEnded()
  expect(() => f.controller.agentScope(f.workspaceId)).toThrow()
})

it('keeps a pending selection and an ephemeral deny out of committed none', async () => {
  const f = await setup()
  const entered = deferred<void>(),
    release = deferred<void>()
  releases.push(() => release.resolve())
  const original = f.opts.runtime.start.bind(f.opts.runtime)
  f.opts.runtime.start = async (spec) => {
    entered.resolve()
    await release.promise
    return original(spec)
  }
  const installing = f.controller.install(f.handle, A)
  await entered.promise
  expect(entry(f.controller.agentScope(f.workspaceId), A)).toMatchObject({
    is: 'pending',
    why: 'starting',
    enabled: true,
  })
  release.resolve()
  await installing
})

it('publishes each independent receipt before its completion wake, with B still held', async () => {
  const f = await setup()
  await f.controller.install(f.handle, A)
  await f.controller.install(f.handle, B)
  const fresh = projection(),
    held = deferred<void>(),
    heldA = deferred<void>(),
    enteredA = deferred<void>(),
    entered = deferred<void>(),
    done = deferred<void>()
  releases.push(() => held.resolve())
  releases.push(() => heldA.resolve())
  const scopes: AgentScope[] = []
  const receiptsAtWake: boolean[] = []
  const unsubscribe = f.controller.onHostChanged((workspaceId) => {
    if (workspaceId !== fresh.sink.workspaceId) return
    const scope = f.controller.agentScope(workspaceId)
    scopes.push(scope)
    if (entry(scope, A).is === 'admitted') {
      receiptsAtWake.push(f.state.projections(workspaceId).some((one) => one.pluginId === A))
      done.resolve()
    }
  })
  closers.push(async () => unsubscribe())
  const handle = await f.controller.attach({
    ...fresh.sink,
    async applied(id, receipt) {
      if (id === A && receipt) {
        enteredA.resolve()
        await heldA.promise
      }
      if (id === B && receipt) {
        entered.resolve()
        await held.promise
      }
      await fresh.sink.applied(id, receipt)
    },
  })
  await Promise.all([entered.promise, enteredA.promise])
  const before = f.controller.agentScope(fresh.sink.workspaceId)
  expect(entry(before, A)).toMatchObject({ is: 'pending', why: 'not-projected' })
  // A planted early wake cannot pass the same completion oracle.
  expect(() => completion([before], A)).toThrow('No admitted receipt')
  heldA.resolve()
  await done.promise
  expect(completion(scopes, A)).toBeDefined()
  expect(receiptsAtWake.length).toBeGreaterThan(0)
  expect(receiptsAtWake.every(Boolean)).toBe(true)
  expect(entry(f.controller.agentScope(fresh.sink.workspaceId), B)).toMatchObject({
    is: 'pending',
    why: 'not-projected',
  })
  expect(f.controller.admitted(handle, A, f.state.currentInstallation(A)!.installId)).toBe(true)
  held.resolve()
})

it('keeps a failed consumer pending while a healthy peer can publish the canonical receipt', async () => {
  const f = await setup()
  await f.controller.install(f.handle, A)
  const fresh = projection(),
    failed = deferred<void>()
  await f.controller.attach({
    ...fresh.sink,
    async reconcile(change) {
      if (change.receipt) {
        failed.resolve()
        throw new Error('fictional binding failure')
      }
    },
  })
  await failed.promise
  await turn()
  expect(entry(f.controller.agentScope(fresh.sink.workspaceId), A)).toMatchObject({
    is: 'pending',
    why: 'bind-failed',
    enabled: true,
  })
  const ready = deferred<void>()
  const unsubscribe = f.controller.onHostChanged((id) => {
    if (id === fresh.sink.workspaceId && entry(f.controller.agentScope(id), A).is === 'admitted')
      ready.resolve()
  })
  closers.push(async () => unsubscribe())
  await f.controller.attach({ ...projection().sink, workspaceId: fresh.sink.workspaceId }, true)
  await ready.promise
  expect(entry(f.controller.agentScope(fresh.sink.workspaceId), A).is).toBe('admitted')
})

it('uses one captured sequence even if a committed choice changes during capture', async () => {
  const f = await setup()
  await f.controller.install(f.handle, A)
  const read = f.state.readView.bind(f.state),
    captured = read()
  const spy = vi.spyOn(f.state, 'readView').mockImplementationOnce(() => {
    f.state.setEnabled(f.workspaceId, A, false)
    return captured
  })
  const scope = f.controller.agentScope(f.workspaceId)
  expect(spy).toHaveBeenCalledOnce()
  expect(scope.revision).toBe(captured.sequence)
  expect(entry(scope, A).enabled).toBe(true)
  const a = entry(scope, A)
  expect(a.is).toBe('admitted')
  if (a.is !== 'admitted') throw new Error('Captured A was admitted')
  expect(a.switchRevision).toBe(captured.getEnabled(f.workspaceId, A).revision)
  expect(a.view.current()).toBe(false)
  expect(entry(f.controller.agentScope(f.workspaceId), A)).toMatchObject({
    is: 'off',
    why: 'disabled',
    enabled: false,
  })
})

it('keeps a mismatched retained package pending instead of claiming a committed block or no tools', async () => {
  const f = await setup()
  await f.controller.install(f.handle, A)
  const captured = f.state.readView()
  vi.spyOn(f.state, 'readView').mockReturnValueOnce({
    ...captured,
    currentInstallation(id) {
      const active = captured.currentInstallation(id)
      return active && id === A
        ? { ...active, release: { ...active.release, archiveSha256: '0'.repeat(64) } }
        : active
    },
  })
  expect(entry(f.controller.agentScope(f.workspaceId), A)).toMatchObject({
    is: 'pending',
    why: 'not-ready',
  })
})

it('keeps an ended run pending and a held restart pending, then wakes for the replacement only after publication', async () => {
  const f = await setup()
  await f.controller.install(f.handle, A)
  const old = entry(f.controller.agentScope(f.workspaceId), A)
  if (old.is !== 'admitted') throw new Error('A must start admitted')
  const held = deferred<void>(),
    revoked = deferred<void>()
  releases.push(() => held.resolve())
  const original = f.local.sink.revoke.bind(f.local.sink)
  f.local.sink.revoke = async (id, installId) => {
    revoked.resolve()
    await held.promise
    return original(id, installId)
  }
  f.runs[0]!.exit()
  await revoked.promise
  expect(entry(f.controller.agentScope(f.workspaceId), A)).toMatchObject({
    is: 'pending',
    why: 'run-ended',
  })
  expect(old.view.current()).toBe(false)
  held.resolve()
  await turn()
  const replacement = deferred<void>()
  const unsubscribe = f.controller.onHostChanged((id) => {
    if (id !== f.workspaceId) return
    const current = entry(f.controller.agentScope(id), A)
    if (current.is === 'admitted' && current.runId !== old.runId) replacement.resolve()
  })
  closers.push(async () => unsubscribe())
  const restartHeld = deferred<void>(),
    restartEntered = deferred<void>()
  releases.push(() => restartHeld.resolve())
  f.local.sink.revoke = async (id, installId) => {
    restartEntered.resolve()
    await restartHeld.promise
    return original(id, installId)
  }
  const restarting = f.controller.restartPluginTools(A, old.runId, () => {})
  await restartEntered.promise
  expect(entry(f.controller.agentScope(f.workspaceId), A)).toMatchObject({
    is: 'pending',
    why: 'restarting',
  })
  restartHeld.resolve()
  await restarting
  await replacement.promise
  expect(entry(f.controller.agentScope(f.workspaceId), A).is).toBe('admitted')
})
