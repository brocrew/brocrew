import { snapshotPath } from './helpers/plugin-state-snapshot'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import type { createPluginNodeHost, PluginNodeProcess } from '../src/main/plugins/node-host'
import { fictionalPublicKey, manifestFor, packageFixture, signed } from './plugin-package-fixtures'
import type { LifecycleRuntime, LifecycleWorkspace } from '../src/main/plugins/lifecycle/types'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'

const closes: (() => Promise<unknown>)[] = []
async function accepted(
  controller: PluginLifecycleController,
  handle: LifecycleWorkspace,
  id: string,
  installId: string,
) {
  const workspaceId = controller.hostWorkspace(handle)
  let resolve!: () => void, reject!: (error: unknown) => void
  const ready = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  const check = () => {
    try {
      if (controller.admitted(handle, id, installId)) resolve()
    } catch (error) {
      reject(error)
    }
  }
  const stop = controller.onHostChanged((changed) => {
    if (changed === workspaceId) check()
  })
  receiptSubscriptions.add(stop)
  try {
    check()
    await ready
  } finally {
    receiptSubscriptions.delete(stop)
    stop()
  }
}
const receiptSubscriptions = new Set<() => void>()
afterEach(async () => {
  for (const stop of receiptSubscriptions) stop()
  receiptSubscriptions.clear()
  for (const close of closes.splice(0).reverse()) await close().catch(() => undefined)
  await cleanupLifecycleFixtures()
})
function inertHost() {
  const runs: {
    process: PluginNodeProcess
    exit: ReturnType<typeof deferred<{ exited: boolean }>>
  }[] = []
  const host = {
    start: vi.fn(async () => {
      const exit = deferred<{ exited: boolean }>()
      const process: PluginNodeProcess = {
        runId: randomUUID(),
        receiptPath: '/fictional-not-read/exit.json',
        exited: exit.promise,
        stop: vi.fn(async () => {
          exit.resolve({ exited: true })
          return { exited: true }
        }),
        async ready() {
          return {
            serverPid: 404941,
            origin: 'http://127.0.0.1:1',
            mcp: () => ({ url: '', headers: { Authorization: '' } }),
            admin: () => ({ url: '', headers: { Authorization: '' } }),
          }
        },
      }
      runs.push({ process, exit })
      return process
    }),
    removePackage: vi.fn(async () => {}),
  }
  return { runs, host: host as unknown as ReturnType<typeof createPluginNodeHost> }
}

function exitingRuntime(exited: Promise<void>, stop = async () => {}): LifecycleRuntime {
  return {
    previousOwnerClean: async () => true,
    removeCode: async () => {},
    async start() {
      return {
        runId: randomUUID(),
        exited,
        ready: async () => ({
          serverPid: 404941,
          origin: 'http://127.0.0.1:1',
          mcp: () => ({ url: '', headers: { Authorization: '' } }),
          admin: () => ({ url: '', headers: { Authorization: '' } }),
        }),
        stop,
      }
    },
  }
}

describe.skipIf(process.platform === 'win32')(
  'installed plugin shutdown, scratch roots and inert host',
  () => {
    async function attached(f: Awaited<ReturnType<typeof fixture>>, state = f.state) {
      const owner = await PluginSupervisor.start({
        root: f.root,
        workspaceRoots: [f.workspace],
        tickEvery: 10,
        drainWithin: 1000,
      })
      closes.push(() => owner.shutdown())
      const lease = await PluginWorkspaceLease.attach({
        root: f.root,
        workspaceRoot: f.workspace,
        generation: randomUUID(),
        build: 'fictional-build',
      })
      closes.push(() => lease.close())
      const fake = inertHost()
      const service = await createSupervisorLifecycle({
        owner,
        host: fake.host,
        lifecycle: { ...f.opts, state },
        personKey: 'a'.repeat(64),
      })
      closes.push(() => service.close())
      const sink = projection()
      // Same stable workspace ID on reopen; no app, browser or provider is launched.
      const stableSink = { ...sink.sink, workspaceId: f.local.sink.workspaceId }
      const handles: LifecycleWorkspace[] = []
      const originalAttach = PluginLifecycleController.prototype.attach
      const observing = vi
        .spyOn(PluginLifecycleController.prototype, 'attach')
        .mockImplementation(function (
          this: PluginLifecycleController,
          ...args: Parameters<PluginLifecycleController['attach']>
        ) {
          return originalAttach.apply(this, args).then((handle) => {
            if (
              args[0].workspaceId === stableSink.workspaceId &&
              service.controller.hostWorkspace(handle) === stableSink.workspaceId
            )
              handles.push(handle)
            return handle
          })
        })
      let client: Awaited<ReturnType<typeof connectPluginSettings>>
      try {
        client = await connectPluginSettings({
          path: service.path,
          personKey: 'a'.repeat(64),
          root: f.root,
          pinnedPublicKey: fictionalPublicKey,
          target: f.opts.target,
          catalogue: f.opts.catalogue,
          download: f.opts.download,
          projection: stableSink,
        })
        closes.push(() => client.close())
        expect(handles).toHaveLength(1)
      } finally {
        observing.mockRestore()
      }
      return {
        owner,
        lease,
        service,
        client,
        fake,
        sink: { ...sink, sink: stableSink },
        accepted: (id: string) =>
          accepted(service.controller, handles[0]!, id, state.currentInstallation(id)!.installId),
      }
    }
    async function phase(root: string) {
      return JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).phase
    }
    it('notifies lifecycle cleanup without making a synthetic child hold zero-process shutdown', async () => {
      const f = await fixture()
      const run = await attached(f)
      // Cleanup notification is separate from the set of captured physical processes.
      expect(run.fake.runs).toHaveLength(0)
      const clean = vi.spyOn(run.service.controller, 'cleanForShutdown').mockReturnValue(false)
      const drain = vi.spyOn(run.service.controller, 'drain')
      try {
        expect(await run.owner.shutdown()).toBe(true)
        await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce())
        expect(await phase(f.root)).toBe('stopped')
      } finally {
        clean.mockRestore()
      }
    })
    it('quits an installed running plugin cleanly and a fresh owner/controller returns Running', async () => {
      const f = await fixture()
      const first = await attached(f)
      await first.client.install('chrome')
      const installed = f.state.exportActivation().entries[0]!
      expect(await first.client.catalogue()).toMatchObject([{ installed: true, state: 'Running' }])
      await first.client.close()
      expect(await first.lease.close()).toBe(true)
      expect(await phase(f.root)).toBe('stopped')
      expect(f.state.exportActivation().entries[0]?.installId).toBe(installed.installId)
      const state = reopenLifecycleFixture(f)
      const second = await attached(f, state)
      await second.accepted('chrome')
      expect(await second.client.catalogue()).toMatchObject([{ installed: true, state: 'Running' }])
      expect(second.fake.runs).toHaveLength(1)
      expect(state.exportActivation().entries[0]?.installId).toBe(installed.installId)
      await second.client.close()
      expect(await second.lease.close()).toBe(true)
    })
    it('finishes physical shutdown while a person cleanup callback is unresponsive', async () => {
      const f = await fixture()
      const run = await attached(f)
      await run.client.install('chrome')
      const ack = deferred<boolean>()
      vi.spyOn(run.sink.sink, 'revoke').mockImplementation(() => ack.promise)
      const closing = run.owner.shutdown()
      try {
        await expect(run.fake.runs[0]!.process.exited).resolves.toEqual({ exited: true })
        expect(await closing).toBe(true)
        expect(await phase(f.root)).toBe('stopped')
        await expect(run.client.catalogue()).rejects.toThrow()
      } finally {
        ack.resolve(true)
        await run.service.close()
      }
      expect(run.service.controller.cleanForShutdown()).toBe(true)
    })
    it('closes every shared person consumer when the physical plugin exits', async () => {
      const f = await fixture()
      const run = await attached(f)
      await run.client.install('chrome')
      const secondSink = { ...projection().sink, workspaceId: f.local.sink.workspaceId }
      const second = await connectPluginSettings({
        path: run.service.path,
        personKey: 'a'.repeat(64),
        root: f.root,
        pinnedPublicKey: fictionalPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        download: f.opts.download,
        projection: secondSink,
      })
      closes.push(() => second.close())
      const ack = deferred<boolean>()
      vi.spyOn(run.sink.sink, 'revoke').mockImplementation(() => ack.promise)
      vi.spyOn(secondSink, 'revoke').mockImplementation(() => ack.promise)
      const closing = run.owner.shutdown()
      try {
        await expect(run.fake.runs[0]!.process.exited).resolves.toEqual({ exited: true })
        ack.resolve(true)
        expect(await closing).toBe(true)
        expect(await phase(f.root)).toBe('stopped')
        await expect(run.client.catalogue()).rejects.toThrow()
        await expect(second.catalogue()).rejects.toThrow()
      } finally {
        ack.resolve(true)
        await closing.catch(() => undefined)
      }
    })
    it('ends an unresponsive intentional-exit consumer within the owner deadline', async () => {
      const f = await fixture()
      const run = await attached(f)
      await run.client.install('chrome')
      const ack = deferred<boolean>()
      vi.spyOn(run.sink.sink, 'revoke').mockImplementation(() => ack.promise)
      const closing = run.owner.shutdown()
      try {
        expect(await closing).toBe(true)
        expect(await phase(f.root)).toBe('stopped')
        await expect(run.client.catalogue()).rejects.toThrow()
      } finally {
        ack.resolve(true)
        await closing.catch(() => undefined)
      }
    })
    it('a proven unexpected exit clears acknowledged cleanup but stays denied', async () => {
      const exit = deferred<void>()
      const f = await fixture({ runtime: exitingRuntime(exit.promise) })
      await f.controller.install(f.handle, 'chrome')
      const revoke = vi.spyOn(f.local.sink, 'revoke')
      exit.resolve()
      await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
      // The exact process is gone and its consumers acknowledged cleanup; the crashed run is
      // still unavailable, but there is no unresolved obligation to block a clean owner drain.
      await vi.waitFor(async () => expect((await f.controller.status()).cleanupPending).toEqual([]))
      expect((await f.controller.status()).cards).toMatchObject([{ state: 'Unavailable' }])
      expect(
        f.controller.admitted(f.handle, 'chrome', f.state.exportActivation().entries[0]!.installId),
      ).toBe(false)
      expect(f.controller.cleanForShutdown()).toBe(true)
      await expect(f.controller.drain()).resolves.toBeUndefined()
    })
    it('trusted consumer closure releases an already exited run without waiting for its UI ack', async () => {
      const exit = deferred<void>(),
        ack = deferred<boolean>(),
        stopped = deferred<void>()
      const f = await fixture({
        runtime: exitingRuntime(exit.promise, async () => {
          stopped.resolve()
        }),
      })
      await f.controller.install(f.handle, 'chrome')
      const revoke = vi.spyOn(f.local.sink, 'revoke').mockImplementation(() => ack.promise)
      exit.resolve()
      await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
      expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
      expect(f.controller.cleanForShutdown()).toBe(false)
      const selected = snapshotPath(join(f.root, 'state'))
      const before = await readFile(selected)
      const applied = vi.spyOn(f.local.sink, 'applied')
      const publish = vi.spyOn(f.state, 'recordProjection')
      f.controller.consumersEnded()
      const draining = f.controller.drain()
      try {
        await stopped.promise
        await expect(draining).resolves.toBeUndefined()
        expect(f.controller.cleanForShutdown()).toBe(true)
        expect(await readFile(snapshotPath(join(f.root, 'state')))).toEqual(before)
        expect(revoke).toHaveBeenCalledOnce()
        ack.resolve(true)
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(applied).not.toHaveBeenCalled()
        expect(publish).not.toHaveBeenCalled()
        expect(await readFile(snapshotPath(join(f.root, 'state')))).toEqual(before)
      } finally {
        ack.resolve(true)
        await draining.catch(() => undefined)
      }
    })
    it.each(['revoke', 'reconcile', 'applied'] as const)(
      'a proven exit retains an unacknowledged %s cleanup',
      async (step) => {
        const exit = deferred<void>()
        const f = await fixture({ runtime: exitingRuntime(exit.promise) })
        await f.controller.install(f.handle, 'chrome')
        if (step === 'revoke') vi.spyOn(f.local.sink, step).mockResolvedValue(false)
        else vi.spyOn(f.local.sink, step).mockRejectedValue(new Error('fictional cleanup refused'))
        const revoke = vi.spyOn(f.local.sink, 'revoke')
        exit.resolve()
        await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
        expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
        expect(f.controller.cleanForShutdown()).toBe(false)
        await expect(f.controller.drain()).rejects.toMatchObject({ code: 'cleanup-pending' })
        expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
      },
    )
    it('a late crash acknowledgement cannot clear a newer consumer cleanup failure', async () => {
      const exit = deferred<void>(),
        ack = deferred<boolean>()
      const f = await fixture({ runtime: exitingRuntime(exit.promise) })
      await f.controller.install(f.handle, 'chrome')
      const snapshot = snapshotPath(join(f.root, 'state')),
        selected = await readFile(snapshot)
      const installation = f.state.currentInstallation('chrome')!
      type Revoke = (install: typeof installation, currentOnly?: boolean) => Promise<void>
      const originalRevoke = Reflect.get(f.controller, 'revoke') as Revoke
      const captured = deferred<{ work: Promise<void> }>()
      const observing = vi
        .spyOn(f.controller as unknown as { revoke: Revoke }, 'revoke')
        .mockImplementation(function (
          this: PluginLifecycleController,
          ...args: Parameters<Revoke>
        ) {
          const work = originalRevoke.apply(this, args)
          if (
            this === f.controller &&
            args[0].pluginId === 'chrome' &&
            args[0].installId === installation.installId &&
            args[1] === undefined
          )
            captured.resolve({ work })
          return work
        })
      const revoke = vi.spyOn(f.local.sink, 'revoke').mockImplementation(() => ack.promise)
      const applied = vi.spyOn(f.local.sink, 'applied')
      const oldReconcile = vi.spyOn(f.local.sink, 'reconcile')
      const writes = vi.spyOn(f.state, 'recordProjection')
      const reconcile = vi.fn(async () => {
        throw new Error('fictional newer cleanup failure')
      })
      try {
        exit.resolve()
        const { work } = await captured.promise
        await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
        expect(observing).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ pluginId: 'chrome', installId: installation.installId }),
        )
        expect(observing.mock.contexts[0]).toBe(f.controller)
        expect(observing.mock.results[0]!.value).toBe(work)
        await f.controller.reconcileConsumer(f.handle, {
          ...f.local.sink,
          revoke: async () => true,
          reconcile,
        })
        await vi.waitFor(() =>
          expect(f.controller.consumerBindings(f.handle)).toContainEqual({
            pluginId: 'chrome',
            state: 'failed',
          }),
        )
        expect(reconcile).toHaveBeenCalledExactlyOnceWith({
          pluginId: 'chrome',
          before: null,
          receipt: null,
        })
        expect(await readFile(snapshotPath(join(f.root, 'state')))).toEqual(selected)
        ack.resolve(true)
        await work
        expect(observing).toHaveBeenCalledOnce()
        expect(oldReconcile).not.toHaveBeenCalled()
        expect(applied).not.toHaveBeenCalled()
        expect(writes).not.toHaveBeenCalled()
        expect(f.controller.consumerBindings(f.handle)).toContainEqual({
          pluginId: 'chrome',
          state: 'failed',
        })
        expect(reconcile).toHaveBeenCalledExactlyOnceWith({
          pluginId: 'chrome',
          before: null,
          receipt: null,
        })
        expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
        expect(f.controller.cleanForShutdown()).toBe(false)
        expect(await readFile(snapshotPath(join(f.root, 'state')))).toEqual(selected)
      } finally {
        ack.resolve(true)
        observing.mockRestore()
      }
    })
    it('a proven crash drains the shared owner and its successor starts while another plugin stays running', async () => {
      const f = await fixture()
      const manifest = manifestFor()
      manifest.id = 'whatsapp'
      manifest.skills = []
      manifest.platforms = [f.opts.target]
      const other = packageFixture({ manifest })
      f.opts.catalogue = signed({ format: 1, entries: [f.pkg.release, other.release] })
      f.opts.download = async (release) => (release.id === 'chrome' ? f.pkg.archive : other.archive)
      const first = await attached(f)
      let closed = false
      try {
        await first.client.install('chrome')
        await first.client.install('whatsapp')
        const installations = f.state
          .exportActivation()
          .entries.map(({ pluginId, installId }) => [pluginId, installId])
          .sort()
        const revoke = vi.spyOn(first.sink.sink, 'revoke')
        first.fake.runs[0]!.exit.resolve({ exited: true })
        await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('chrome', expect.any(String)))
        await vi.waitFor(async () =>
          expect((await first.service.controller.status()).cleanupPending).toEqual([]),
        )
        expect(await first.client.catalogue()).toMatchObject([
          { id: 'chrome', installed: true, state: 'Unavailable' },
          { id: 'whatsapp', installed: true, state: 'Running' },
        ])
        expect(
          first.service.controller
            .agentAttachments(f.local.sink.workspaceId)
            .map((one) => one.installation.pluginId),
        ).toEqual(['whatsapp'])
        expect(first.fake.runs[1]!.process.stop).not.toHaveBeenCalled()
        await first.client.close()
        expect(await first.lease.close()).toBe(true)
        closed = true
        expect(await phase(f.root)).toBe('stopped')
        const state = reopenLifecycleFixture(f)
        const second = await attached(f, state)
        await Promise.all(['chrome', 'whatsapp'].map((id) => second.accepted(id)))
        expect(await second.client.catalogue()).toMatchObject([
          { id: 'chrome', installed: true, state: 'Running' },
          { id: 'whatsapp', installed: true, state: 'Running' },
        ])
        expect(second.fake.runs).toHaveLength(2)
        expect(
          state
            .exportActivation()
            .entries.map(({ pluginId, installId }) => [pluginId, installId])
            .sort(),
        ).toEqual(installations)
        await second.client.close()
        expect(await second.lease.close()).toBe(true)
      } finally {
        // A failing base run must still release its inert fixture owner through the normal API.
        if (!closed) await first.client.uninstall('chrome').catch(() => undefined)
      }
    })
    it('closes the person bridge at last-lease drain while crash cleanup is pending', async () => {
      const f = await fixture()
      const first = await attached(f)
      await first.client.install('chrome')
      const ack = deferred<boolean>()
      const revoke = vi.spyOn(first.sink.sink, 'revoke').mockImplementationOnce(() => ack.promise)
      first.fake.runs[0]!.exit.resolve({ exited: true })
      await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
      const closing = first.lease.close()
      try {
        await vi.waitFor(() => expect(first.fake.runs[0]!.process.stop).toHaveBeenCalled())
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(await closing).toBe(true)
        await expect(first.client.catalogue()).rejects.toThrow()
        ack.resolve(true)
        expect(await closing).toBe(true)
        expect(await phase(f.root)).toBe('stopped')
        await first.service.close()
        expect(first.service.controller.cleanForShutdown()).toBe(true)
        const state = reopenLifecycleFixture(f)
        const second = await attached(f, state)
        await second.accepted('chrome')
        expect(await second.client.catalogue()).toMatchObject([{ state: 'Running' }])
        await second.client.close()
        expect(await second.lease.close()).toBe(true)
      } finally {
        ack.resolve(true)
        await closing.catch(() => undefined)
      }
    })
    it('ends an unresponsive person channel before the owner drain deadline', async () => {
      const f = await fixture()
      const first = await attached(f)
      await first.client.install('chrome')
      const ack = deferred<boolean>()
      const revoke = vi.spyOn(first.sink.sink, 'revoke').mockImplementationOnce(() => ack.promise)
      first.fake.runs[0]!.exit.resolve({ exited: true })
      await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
      const closing = first.lease.close()
      try {
        // The owner fixture allows one second; the consumer intentionally never replies in it.
        await new Promise<void>((resolve) => setTimeout(resolve, 1100))
        expect(await closing).toBe(true)
        expect(await phase(f.root)).toBe('stopped')
        await expect(first.client.catalogue()).rejects.toThrow()
        const state = reopenLifecycleFixture(f)
        const second = await attached(f, state)
        await second.accepted('chrome')
        expect(await second.client.catalogue()).toMatchObject([{ state: 'Running' }])
        await second.client.close()
        expect(await second.lease.close()).toBe(true)
      } finally {
        ack.resolve(true)
        await closing.catch(() => undefined)
      }
    })
    it('waits for the exact managed exit at the boundary while person control closes', async () => {
      const f = await fixture()
      const run = await attached(f)
      await run.client.install('chrome')
      const entered = deferred<void>(),
        release = deferred<void>(),
        ack = deferred<boolean>()
      const process = run.fake.runs[0]!
      vi.mocked(process.process.stop).mockImplementation(async () => {
        entered.resolve()
        await release.promise
        process.exit.resolve({ exited: true })
        return { exited: true }
      })
      vi.spyOn(run.sink.sink, 'revoke').mockImplementationOnce(() => ack.promise)
      const closing = run.owner.shutdown()
      try {
        await entered.promise
        process.exit.resolve({ exited: true })
        release.resolve()
        ack.resolve(true)
        expect(await closing).toBe(true)
        expect(await phase(f.root)).toBe('stopped')
        await expect(run.client.catalogue()).rejects.toThrow()
      } finally {
        release.resolve()
        ack.resolve(true)
        await closing.catch(() => undefined)
      }
    })
    it.each(['failed acknowledgement', 'unproved exit'] as const)(
      'closes person control and attempts every child stop after a crash with %s',
      async (failure) => {
        const f = await fixture()
        const run = await attached(f)
        await run.client.install('chrome')
        const revoke = vi
          .spyOn(run.sink.sink, 'revoke')
          .mockResolvedValue(failure !== 'failed acknowledgement')
        run.fake.runs[0]!.exit.resolve({ exited: failure !== 'unproved exit' })
        await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
        await expect(run.service.controller.drain()).rejects.toMatchObject({
          code: 'cleanup-pending',
        })
        expect(await run.owner.shutdown()).toBe(failure !== 'unproved exit')
        await expect(run.client.catalogue()).rejects.toThrow()
        expect(run.fake.runs[0]!.process.stop).toHaveBeenCalled()
        expect(run.service.controller.cleanForShutdown()).toBe(false)
        expect(await phase(f.root)).toBe(failure === 'unproved exit' ? 'blocked' : 'stopped')
      },
    )
    it('intentional drain cannot turn an unproved exact-run exit into clean shutdown', async () => {
      let rejectExit!: (error: Error) => void
      const exit = new Promise<void>((_resolve, reject) => {
        rejectExit = reject
      })
      const f = await fixture({
        runtime: {
          previousOwnerClean: async () => true,
          removeCode: async () => {},
          async start() {
            return {
              runId: randomUUID(),
              exited: exit,
              ready: async () => ({
                serverPid: 404941,
                origin: 'http://127.0.0.1:1',
                mcp: () => ({ url: '', headers: { Authorization: '' } }),
                admin: () => ({ url: '', headers: { Authorization: '' } }),
              }),
              stop: async () => {},
            }
          },
        },
      })
      await f.controller.install(f.handle, 'chrome')
      const draining = f.controller.drain()
      const refused = expect(draining).rejects.toMatchObject({ code: 'cleanup-pending' })
      await Promise.resolve()
      expect(f.controller.cleanForShutdown()).toBe(false)
      rejectExit(new Error('fictional unknown exit'))
      await refused
      expect(f.controller.cleanForShutdown()).toBe(false)
      expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
    })
  },
)
