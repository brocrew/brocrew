import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { createSupervisorLifecycle } from '../src/main/plugins/lifecycle/supervisor'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import type { createPluginNodeHost, PluginNodeProcess } from '../src/main/plugins/node-host'
import { fictionalPublicKey } from './plugin-package-fixtures'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'

const closes: (() => Promise<unknown>)[] = []
afterEach(async () => {
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
        async stop() {
          exit.resolve({ exited: true })
          return { exited: true }
        },
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
        read: async () => ({}),
      })
      closes.push(() => service.close())
      const sink = projection()
      // Same stable workspace ID on reopen; no app, browser or provider is launched.
      const stableSink = { ...sink.sink, workspaceId: f.local.sink.workspaceId }
      const client = await connectPluginSettings({
        path: service.path,
        personKey: 'a'.repeat(64),
        root: f.root,
        pinnedPublicKey: fictionalPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        projection: stableSink,
        propose: () => {},
      })
      closes.push(() => client.close())
      return { owner, lease, service, client, fake, sink: { ...sink, sink: stableSink } }
    }
    async function phase(root: string) {
      return JSON.parse(await readFile(join(root, 'supervisor/owner.json'), 'utf8')).phase
    }
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
      expect(await second.client.catalogue()).toMatchObject([{ installed: true, state: 'Running' }])
      expect(second.fake.runs).toHaveLength(1)
      expect(state.exportActivation().entries[0]?.installId).toBe(installed.installId)
      await second.client.close()
      expect(await second.lease.close()).toBe(true)
    })
    it('positive host exit before a delayed bridge clean check is still a clean intentional quit', async () => {
      const f = await fixture()
      const run = await attached(f)
      await run.client.install('chrome')
      const ack = deferred<boolean>()
      const revoke = vi.spyOn(run.sink.sink, 'revoke').mockImplementation(() => ack.promise)
      const closing = run.owner.shutdown()
      await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
      await expect(run.fake.runs[0]!.process.exited).resolves.toEqual({ exited: true })
      await Promise.resolve() // Let the lifecycle's exit observer run before the bridge finishes.
      ack.resolve(true)
      expect(await closing).toBe(true)
      expect(await phase(f.root)).toBe('stopped')
      expect(run.service.controller.cleanForShutdown()).toBe(true)
    })
    it('an unexpected host exit still denies, revokes and retains cleanup-pending', async () => {
      const exit = deferred<void>()
      const f = await fixture({
        runtime: {
          previousOwnerClean: async () => true,
          removeCode: async () => {},
          async start() {
            return {
              runId: randomUUID(),
              exited: exit.promise,
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
      const revoke = vi.spyOn(f.local.sink, 'revoke')
      exit.resolve()
      await vi.waitFor(() => expect(revoke).toHaveBeenCalled())
      expect(await f.controller.status()).toMatchObject({
        cards: [{ state: 'Unavailable' }],
        cleanupPending: ['chrome'],
      })
      expect(
        f.controller.admitted(f.handle, 'chrome', f.state.exportActivation().entries[0]!.installId),
      ).toBe(false)
      expect(f.controller.cleanForShutdown()).toBe(false)
      await expect(f.controller.drain()).rejects.toMatchObject({ code: 'cleanup-pending' })
      expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
    })
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
