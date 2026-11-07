import { z } from 'zod'
import { PluginSupervisorLaunchFailure } from '../src/main/plugins/startup-failure'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import { downloadPluginArchive } from '../src/main/plugins/lifecycle/download'
import { randomUUID } from 'node:crypto'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import {
  servePersonPluginControl,
  connectPersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { Command, pack } from '../src/main/plugins/supervisor/protocol'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'

import { packageFixture, catalogueBytes } from './plugin-package-fixtures'

import {
  fixture,
  projection,
  deferred,
  cleanupLifecycleFixtures,
} from './plugin-lifecycle-fixtures'
afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})

// Global owner-only storage has no Windows backend yet; these are fictional POSIX folders.
describe.skipIf(process.platform === 'win32')(
  'person plugin lifecycle, inert process peers',
  () => {
    it('verifies the catalogue before exposing a controller', async () => {
      await expect(fixture({ catalogue: { bytes: Buffer.from('{}') } })).rejects.toMatchObject({
        code: 'unavailable',
      })
    })
    it('downloads, verifies, journals, stages and checks readiness before activation', async () => {
      const f = await fixture()
      const id = randomUUID()
      expect((await f.controller.status()).cards).toEqual([
        {
          id: 'chrome',
          name: 'Chrome',
          installed: false,
          state: 'Available',
          uninstallDeletesData: false,
        },
      ])
      await f.controller.install(f.handle, 'chrome', id)
      const active = f.state.exportActivation().entries[0]!
      expect(f.events).toEqual(['deny', 'download', 'start', 'ready'])
      expect(f.state.inspect().operations[0]!.status).toBe('completed')
      expect(f.controller.admitted(f.handle, 'chrome', active.installId)).toBe(true)
      await f.controller.install(f.handle, 'chrome', id)
      expect(f.starts()).toBe(1)
      expect(f.downloads()).toBe(1)
      expect(f.state.inspect().guards[0]!.installId).toBe(active.installId)
    })
    it('admits a new global installation in every live workspace without a reopen', async () => {
      const f = await fixture()
      const second = projection()
      const other = await f.controller.attach(second.sink)
      await f.controller.install(f.handle, 'chrome')
      const installId = f.state.exportActivation().entries[0]!.installId
      expect(f.controller.admitted(other, 'chrome', installId)).toBe(true)
    })
    it('refuses declared plugin skills before prepare, staging or process start', async () => {
      const f = await fixture({}, true)
      await expect(f.controller.install(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'unavailable',
        message: 'Plugin unavailable. Try again.',
      })
      expect(f.state.inspect().operations).toEqual([])
      expect(f.state.inspect().guards).toEqual([])
      expect(f.starts()).toBe(0)
    })
    it('a workspace that attaches again is admitted for the current install and writes nothing', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const installId = f.state.exportActivation().entries[0]!.installId
      await f.controller.detach(f.handle)
      const sequence = f.state.inspect().sequence
      f.events.length = 0
      const fresh = await f.controller.attach(f.local.sink)
      expect(f.events).toEqual([])
      expect(f.state.inspect().sequence).toBe(sequence)
      expect(f.controller.admitted(fresh, 'chrome', installId)).toBe(true)
    })
    it('a workspace that attaches after an uninstall gets nothing for the removed plugin', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const installId = f.state.exportActivation().entries[0]!.installId
      await f.controller.uninstall(f.handle, 'chrome')
      await f.controller.detach(f.handle)
      const fresh = await f.controller.attach(f.local.sink)
      expect(f.controller.admitted(fresh, 'chrome', installId)).toBe(false)
      expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
    })
    it('logs a WhatsApp plugin out while it runs, then removes its code and its data; Chrome keeps its data', async () => {
      const shown = (events: string[]) =>
        events.filter((one) => /^(log-out|stop$|remove-code$|remove-data)/.test(one))
      const f = await fixture({}, false, 'whatsapp')
      await f.controller.install(f.handle, 'whatsapp')
      f.events.length = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          f.events.push(`log-out ${url}`)
          return new Response('{}', { status: 200 })
        }),
      )
      await f.controller.uninstall(f.handle, 'whatsapp')
      expect(shown(f.events)).toEqual([
        'log-out /status',
        'log-out /uninstall',
        'log-out /status',
        'stop',
        'remove-code',
        'remove-data whatsapp',
      ])
      const c = await fixture()
      await c.controller.install(c.handle, 'chrome')
      c.events.length = 0
      await c.controller.uninstall(c.handle, 'chrome')
      expect(shown(c.events)).toEqual(['stop', 'remove-code'])
    })
    it('refuses altered download bytes without a prepared install or process', async () => {
      const f = await fixture({ download: async () => Buffer.from('fictional altered archive') })
      await expect(f.controller.install(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'unavailable',
      })
      expect(f.starts()).toBe(0)
      expect(f.state.inspect().guards).toEqual([])
    })
    it.each(['prepared', 'staged', 'ready'] as const)(
      'unwinds a failed first install at %s without leaving an activation',
      async (point) => {
        const f = await fixture({
          fault: (at) => {
            if (at === point) throw new Error('fictional interrupted install')
          },
        })
        await expect(f.controller.install(f.handle, 'chrome')).rejects.toMatchObject({
          code: 'unavailable',
        })
        expect(f.state.inspect().pending).toBeNull()
        expect(f.state.exportActivation().entries).toEqual([])
        expect(f.state.inspect().guards[0]!.phase).toBe('removed')
        expect(f.events).toContain('remove-code')
      },
    )
    it('a lost response after atomic activation stays installed and retries without allocation', async () => {
      const f = await fixture({
        fault(point) {
          if (point === 'activated') throw new Error('fictional response loss after commit')
        },
      })
      const operationId = randomUUID()
      await expect(f.controller.install(f.handle, 'chrome', operationId)).resolves.toBeUndefined()
      const active = f.state.exportActivation().entries[0]!
      expect(f.controller.admitted(f.handle, 'chrome', active.installId)).toBe(true)
      const sequence = f.state.inspect().sequence
      await f.controller.install(f.handle, 'chrome', operationId)
      expect(f.state.inspect().sequence).toBe(sequence)
      expect(f.starts()).toBe(1)
    })
    it('readiness failure is cleaned before abort, never offered as installed', async () => {
      const f = await fixture()
      f.failReady()
      await expect(f.controller.install(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'unavailable',
      })
      expect(f.events.indexOf('stop')).toBeGreaterThan(f.events.indexOf('ready'))
      expect(f.state.exportActivation().entries).toEqual([])
    })
    it('denies before awaiting uninstall, tombstones before cleanup, and keeps mutable data', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const before = f.state.exportActivation().entries[0]!,
        sentinel = join(f.root, 'profiles-and-downloads')
      await writeFile(sentinel, 'fictional kept data')
      f.events.length = 0
      const removing = f.controller.uninstall(f.handle, 'chrome')
      expect(f.events[0]).toBe('deny')
      expect(f.controller.admitted(f.handle, 'chrome', before.installId)).toBe(false)
      await removing
      expect(f.state.inspect().guards[0]!.phase).toBe('removed')
      expect(f.events.indexOf('remove-code')).toBeGreaterThan(f.events.indexOf('stop'))
      expect(f.events).toContain('revoke')
      expect(await readFile(sentinel, 'utf8')).toBe('fictional kept data')
      expect((await f.controller.status()).cards[0]!.state).toBe('Available')
    })
    it('an unproved stop still revokes every workspace and retains the denying pending floor and code', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const second = projection(f.events)
      await f.controller.attach(second.sink)
      f.events.length = 0
      f.failStop()
      await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'cleanup-pending',
      })
      expect(f.events.filter((one) => one === 'revoke')).toHaveLength(2)
      expect(f.events).not.toContain('remove-code')
      expect(f.state.inspect().guards[0]!.phase).toBe('removed')
      expect(f.state.inspect().pending).not.toBeNull()
      expect((await f.controller.status()).cleanupPending).toEqual(['chrome'])
    })
    it('a removal whose stop failed retries by itself on a later list, and Install works again', async () => {
      let clock = 1_000_000
      const f = await fixture({ now: () => clock })
      await f.controller.install(f.handle, 'chrome')
      f.failStop()
      await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'cleanup-pending',
      })
      expect((await f.controller.status()).cards[0]!.state).toBe('Unavailable')
      f.failStop(false)
      clock += 5_000
      await f.controller.status() // This read starts the retry.
      await vi.waitFor(async () =>
        expect(await f.controller.status()).toMatchObject({
          cards: [{ state: 'Available', installed: false }],
          cleanupPending: [],
        }),
      )
      expect(f.state.inspect().pending).toBeNull()
      expect(f.controller.cleanForShutdown()).toBe(true)
      await f.controller.install(f.handle, 'chrome')
      expect((await f.controller.status()).cards[0]!.state).toBe('Running')
    })
    it('a retry waits for a stop that hangs outside the state lock, so lists still answer', async () => {
      let clock = 1_000_000
      let stop = async (): Promise<void> => {
        throw new Error('fictional unproved exit')
      }
      const f = await fixture({
        now: () => clock,
        runtime: {
          previousOwnerClean: async () => true,
          removeCode: async () => {},
          async start() {
            return {
              runId: randomUUID(),
              exited: new Promise<void>(() => {}),
              ready: async () => ({
                serverPid: 404941,
                origin: 'http://127.0.0.1:1',
                mcp: () => ({ url: '', headers: { Authorization: '' } }),
                admin: () => ({ url: '', headers: { Authorization: '' } }),
              }),
              stop: () => stop(),
            }
          },
        },
      })
      await f.controller.install(f.handle, 'chrome')
      await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'cleanup-pending',
      })
      await f.controller.status()
      const held = deferred<void>()
      stop = () => held.promise
      clock += 5_000
      await f.controller.status() // This read starts the retry, whose stop now hangs.
      const listed = await Promise.race([
        f.controller.status().then(() => 'listed'),
        new Promise((resolve) => setTimeout(() => resolve('waiting'), 1_000)),
      ])
      expect(listed).toBe('listed')
      held.resolve()
      await vi.waitFor(async () =>
        expect((await f.controller.status()).cards[0]!.state).toBe('Available'),
      )
      expect(f.state.inspect().pending).toBeNull()
    })
    it('a cleanup that clears another way leaves no stale retry for the next one', async () => {
      let clock = 1_000_000
      const f = await fixture({ now: () => clock })
      await f.controller.install(f.handle, 'chrome')
      f.failStop()
      await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'cleanup-pending',
      })
      await f.controller.status() // A retry is now due 5 s later.
      f.failStop(false)
      await f.controller.uninstall(f.handle, 'chrome') // The person's second press finishes it.
      expect((await f.controller.status()).cleanupPending).toEqual([])
      clock += 10_000
      await f.controller.install(f.handle, 'chrome')
      f.failStop()
      await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'cleanup-pending',
      })
      f.events.length = 0
      await f.controller.status() // Seen for the first time: its retry is 5 s away, not due.
      await f.controller.status()
      expect(f.events).not.toContain('stop')
    })
    it('a cleanup with no unfinished operation takes no retry round of the state lock', async () => {
      let clock = 1_000_000
      let exit!: () => void
      const f = await fixture({
        now: () => clock,
        runtime: {
          previousOwnerClean: async () => true,
          removeCode: async () => {},
          async start() {
            return {
              runId: randomUUID(),
              exited: new Promise<void>((_, reject) => {
                exit = () => reject(new Error('fictional unexpected exit'))
              }),
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
      exit()
      await vi.waitFor(async () =>
        expect((await f.controller.status()).cleanupPending).toEqual(['chrome']),
      )
      clock += 5_000
      const lock = vi.spyOn(f.state, 'withExclusive')
      await f.controller.status()
      await f.controller.status()
      expect(lock).toHaveBeenCalledTimes(2) // The two reads only.
    })
    it('a removal left unfinished never blocks a drain, and the next owner finishes it', async () => {
      let stopFails = true
      const f = await fixture({
        runtime: {
          previousOwnerClean: async () => true,
          removeCode: async () => {},
          async start() {
            let exit!: () => void
            const exited = new Promise<void>((resolve) => {
              exit = resolve
            })
            return {
              runId: randomUUID(),
              exited,
              ready: async () => ({
                serverPid: 404941,
                origin: 'http://127.0.0.1:1',
                mcp: () => ({ url: '', headers: { Authorization: '' } }),
                admin: () => ({ url: '', headers: { Authorization: '' } }),
              }),
              stop: async () => {
                if (stopFails) throw new Error('fictional unproved exit')
                exit()
              },
            }
          },
        },
      })
      await f.controller.install(f.handle, 'chrome')
      await expect(f.controller.uninstall(f.handle, 'chrome')).rejects.toMatchObject({
        code: 'cleanup-pending',
      })
      stopFails = false
      await f.controller.drain()
      expect(f.controller.cleanForShutdown()).toBe(true)
      expect(f.state.inspect().pending).not.toBeNull()
      const next = await PluginLifecycleController.open(f.opts)
      expect(f.state.inspect().pending).toBeNull()
      expect((await next.status()).cards).toMatchObject([{ state: 'Available', installed: false }])
    })
    it('trusted drain keeps observing a run whose positive exit arrives after twenty seconds', async () => {
      const exit = deferred<void>()
      const f = await fixture({
        runtime: {
          previousOwnerClean: async () => true,
          removeCode: async () => {},
          async start() {
            return {
              runId: randomUUID(),
              exited: exit.promise,
              stop: async () => {},
              ready: async () => ({
                serverPid: 404941,
                origin: 'http://127.0.0.1:1',
                mcp: () => ({ url: '', headers: { Authorization: '' } }),
                admin: () => ({ url: '', headers: { Authorization: '' } }),
              }),
            }
          },
        },
      })
      await f.controller.install(f.handle, 'chrome')
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      let settled = false
      const drainResult = f.controller.drain()
      const draining = drainResult.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )
      try {
        await vi.advanceTimersByTimeAsync(20_001)
        expect(settled).toBe(false)
      } finally {
        vi.useRealTimers()
        exit.resolve()
        await draining
      }
      await expect(drainResult).resolves.toBeUndefined()
      expect(f.controller.cleanForShutdown()).toBe(true)
    })
    it('a workspace offline while A was replaced by B is admitted only for B when it attaches again', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const old = projection(),
        oldHandle = await f.controller.attach(old.sink),
        installA = f.state.exportActivation().entries[0]!.installId
      await f.controller.detach(oldHandle)
      await f.controller.uninstall(f.handle, 'chrome')
      await f.controller.install(f.handle, 'chrome')
      const installB = f.state.exportActivation().entries[0]!.installId
      expect(installB).not.toBe(installA)
      const fresh = await f.controller.attach(old.sink)
      expect(f.controller.admitted(fresh, 'chrome', installA)).toBe(false)
      expect(f.controller.admitted(fresh, 'chrome', installB)).toBe(true)
    })
    it('reopens a pending first install only with clean predecessor proof, then unwinds it', async () => {
      const f = await fixture({
        fault: (point) => {
          if (point === 'ready') throw new Error('fictional interruption')
        },
      })
      f.failStop()
      await expect(f.controller.install(f.handle, 'chrome')).rejects.toThrow()
      expect(f.state.inspect().pending).not.toBeNull()
      const refused = await PluginLifecycleController.open({
        ...f.opts,
        runtime: { ...f.opts.runtime, previousOwnerClean: async () => false },
      })
      expect((await refused.status()).cleanupPending).toEqual(['chrome'])
      expect(f.state.inspect().pending).not.toBeNull()
      f.failStop(false)
      const recovered = await PluginLifecycleController.open(f.opts)
      expect(f.state.inspect().pending).toBeNull()
      expect(f.state.exportActivation().entries).toEqual([])
      expect((await recovered.status()).cards[0]!.installed).toBe(false)
    })
    it('the Settings seam installs/configures/uninstalls over separate person authority and awaits UI teardown', async () => {
      const f = await fixture()
      await f.controller.detach(f.handle)
      const key = 'a'.repeat(64)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key,
        controller: f.controller,
        read: async () => ({ configRevision: 0, profiles: [], tabs: [] }),
      })
      let client: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
      try {
        const local = projection(f.events)
        client = await connectPluginSettings({
          path: bridge.path,
          personKey: key,
          root: f.root,
          target: f.opts.target,
          catalogue: f.opts.catalogue,
          projection: local.sink,
          propose: () => {
            throw new Error('not an Apply command')
          },
        })
        expect((await client.catalogue())[0]?.state).toBe('Available')
        await client.install('chrome')
        expect((await client.catalogue())[0]?.state).toBe('Running')
        const screen = await client.screen('chrome')
        expect(screen.verified.manifest.id).toBe('chrome')
        expect(await screen.peer.read({}, 0, screen.binding, new AbortController().signal)).toEqual(
          { configRevision: 0, profiles: [], tabs: [] },
        )
        const destroyed = deferred<void>()
        screen.onInvalidate(() => destroyed.promise)
        const uninstall = client.uninstall('chrome')
        await new Promise((resolve) => setTimeout(resolve, 5))
        expect(screen.current(screen.binding)).toBe(false)
        expect(f.events).not.toContain('remove-code')
        destroyed.resolve()
        await uninstall
        expect(f.events).toContain('remove-code')
        expect((await client.catalogue())[0]?.state).toBe('Available')
      } finally {
        await client?.close()
        await bridge.close()
      }
    })
    it.each([true, false, null])(
      'carries only the closed priority fact %s through the person Settings channel',
      async (priorityClamped) => {
        const f = await fixture()
        const start = f.opts.runtime.start.bind(f.opts.runtime)
        f.opts.runtime.start = async (spec) => {
          const run = await start(spec)
          return { ...run, ready: async () => ({ ...(await run.ready()), priorityClamped }) }
        }
        await f.controller.detach(f.handle)
        const key = 'a'.repeat(64)
        const bridge = await servePersonPluginControl({
          root: f.root,
          key,
          controller: f.controller,
          read: async () => null,
        })
        let client: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
        try {
          client = await connectPluginSettings({
            path: bridge.path,
            personKey: key,
            root: f.root,
            target: f.opts.target,
            catalogue: f.opts.catalogue,
            projection: projection().sink,
            propose: () => {},
          })
          expect((await client.catalogue())[0]).not.toHaveProperty('priorityClamped')
          await client.install('chrome')
          expect((await client.catalogue())[0]).toMatchObject({
            state: 'Running',
            installed: true,
            priorityClamped,
          })
        } finally {
          await client?.close()
          await bridge.close()
        }
      },
    )
    it('a Settings call waiting over 30 s for the state lock keeps its channel', async () => {
      const f = await fixture()
      await f.controller.detach(f.handle)
      const key = 'a'.repeat(64)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key,
        controller: f.controller,
        read: async () => null,
      })
      let client: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
      const held = deferred<void>()
      try {
        client = await connectPluginSettings({
          path: bridge.path,
          personKey: key,
          root: f.root,
          target: f.opts.target,
          catalogue: f.opts.catalogue,
          projection: projection().sink,
          propose: () => {},
        })
        // An Install of over 30 s holds the lock while this list waits behind it.
        const holding = f.state.withExclusive(() => held.promise)
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const listed = client.catalogue()
        await vi.advanceTimersByTimeAsync(31_000)
        held.resolve()
        await holding
        expect((await listed)[0]?.state).toBe('Available')
      } finally {
        held.resolve()
        vi.useRealTimers()
        await client?.close()
        await bridge.close()
      }
    })
    it('a person channel lost while its plugin runs ends only that consumer', async () => {
      const f = await fixture()
      await f.controller.detach(f.handle)
      const key = 'a'.repeat(64)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key,
        controller: sharedLifecycleWorkspaces(f.controller),
        read: async () => null,
      })
      const workspaceId = randomUUID()
      const consumer = () =>
        connectPersonPluginControl({ path: bridge.path, key, handle: async () => true })
      const first = await consumer()
      await first.call({ kind: 'attach', workspaceId })
      await first.call({ kind: 'install', pluginId: 'chrome', operationId: randomUUID() })
      expect(f.controller.agentAttachments(workspaceId)).toHaveLength(1)
      first.close() // Lost: no detach, and nobody left to answer a revoke.
      await new Promise((resolve) => setTimeout(resolve, 50))
      const second = await consumer()
      try {
        await second.call({ kind: 'attach', workspaceId })
        await expect(
          second.call({ kind: 'uninstall', pluginId: 'chrome', operationId: randomUUID() }),
        ).resolves.toBe(true)
        expect(await second.call({ kind: 'list-v2' })).toMatchObject([{ state: 'Available' }])
      } finally {
        second.close()
      }
      await expect(bridge.close()).resolves.toBeUndefined()
      expect(f.controller.cleanForShutdown()).toBe(true)
    })
    it('detach ends admission even when its open consumer refuses the revoke notice', async () => {
      const f = await fixture()
      await f.controller.detach(f.handle)
      const key = 'a'.repeat(64)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key,
        controller: sharedLifecycleWorkspaces(f.controller),
        read: async () => null,
      })
      let refuses = false
      const consumer = await connectPersonPluginControl({
        path: bridge.path,
        key,
        handle: async (input) => !(refuses && (input as { kind: string }).kind === 'revoke'),
      })
      const workspaceId = randomUUID()
      await consumer.call({ kind: 'attach', workspaceId })
      await consumer.call({ kind: 'install', pluginId: 'chrome', operationId: randomUUID() })
      expect(f.controller.agentAttachments(workspaceId)).toHaveLength(1)
      refuses = true // Its window could not close the plugin's screen.
      await expect(consumer.call({ kind: 'detach' })).resolves.toBe(true)
      expect(f.controller.agentAttachments(workspaceId)).toEqual([])
      const consumerClosed = new Promise<void>((resolve) => consumer.onClose(resolve))
      await expect(bridge.close()).resolves.toBeUndefined()
      // The consumer learns of the close from its own socket, after the server has finished.
      await consumerClosed
      expect(consumer.open).toBe(false)
    })
    it('lease and broker packets are not person-control authority', async () => {
      const f = await fixture()
      await f.controller.detach(f.handle)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'a'.repeat(64),
        controller: f.controller,
        read: async () => null,
      })
      const wrong = await connectPersonPluginControl({
        path: bridge.path,
        key: 'b'.repeat(64),
        handle: async () => true,
      })
      try {
        await expect(
          wrong.call({ kind: 'attach', workspaceId: randomUUID() }),
        ).rejects.toMatchObject({ code: 'unavailable' })
        expect(
          Command.safeParse({ kind: 'install', pluginId: 'chrome', operationId: randomUUID() })
            .success,
        ).toBe(false)
        expect(f.starts()).toBe(0)
      } finally {
        wrong.close()
        await bridge.close()
      }
    })
    it('an empty catalogue cannot connect to a missing Settings owner', async () => {
      const f = await fixture()
      const empty = catalogueBytes({ format: 1, entries: [] })
      await expect(
        connectPluginSettings({
          path: join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-never-used.sock'),
          personKey: 'a'.repeat(64),
          root: f.root,
          target: f.opts.target,
          catalogue: empty,
          projection: f.local.sink,
          propose() {},
        }),
      ).rejects.toMatchObject({ code: 'unavailable' })
    })
    it('a later uninstall finishes a pending removal whose stop failed', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const operationId = randomUUID()
      f.failStop()
      await expect(f.controller.uninstall(f.handle, 'chrome', operationId)).rejects.toThrow()
      f.failStop(false)
      await f.controller.uninstall(f.handle, 'chrome', randomUUID())
      expect(f.state.inspect().pending).toBeNull()
      expect(f.state.exportActivation().entries).toEqual([])
    })
    it('replayed authenticated frames cannot create a second session or operation', async () => {
      const f = await fixture()
      await f.controller.detach(f.handle)
      const key = 'a'.repeat(64)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key,
        controller: f.controller,
        read: async () => null,
      })
      const socket = createConnection(bridge.path)
      try {
        const challenge = String((await once(socket, 'data'))[0]).trimEnd()
        const frame = pack(key, 'request', {
          challenge,
          sequence: 1,
          packet: {
            kind: 'call',
            id: randomUUID(),
            value: { kind: 'attach', workspaceId: randomUUID() },
          },
        })
        const response = once(socket, 'data')
        socket.write(frame)
        await response
        const closed = once(socket, 'close')
        socket.write(frame)
        await closed
        expect(f.starts()).toBe(0)
      } finally {
        socket.destroy()
        await bridge.close()
      }
    })
    it('refuses forged workspace handles', async () => {
      const f = await fixture()
      await expect(f.controller.install({} as typeof f.handle, 'chrome')).rejects.toMatchObject({
        code: 'unavailable',
      })
      expect(f.starts()).toBe(0)
    })
    it('a linked cache folder is refused and its outside target is never removed', async () => {
      const f = await fixture()
      const outside = join(f.parent, 'outside')
      await mkdir(outside, { mode: 0o700 })
      await writeFile(join(outside, 'sentinel'), 'kept')
      await mkdir(join(f.root, 'package-vault'), { mode: 0o700 })
      await symlink(outside, join(f.root, 'package-vault', f.pkg.release.archive.sha256))
      await expect(f.controller.install(f.handle, 'chrome')).rejects.toThrow()
      expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('kept')
      expect(f.starts()).toBe(0)
    })
    it('an uninstall queued during a first install prevents late admission', async () => {
      const wait = deferred<Uint8Array>()
      const f = await fixture({ download: () => wait.promise })
      const installing = f.controller.install(f.handle, 'chrome')
      await new Promise((resolve) => setTimeout(resolve, 0))
      const removing = f.controller.uninstall(f.handle, 'chrome')
      wait.resolve(f.pkg.archive)
      await installing
      await removing
      expect(f.state.exportActivation().entries).toEqual([])
      expect(f.controller.agentAttachments(f.local.sink.workspaceId)).toEqual([])
    })
  },
)

describe('bounded plugin download (portable inert responses)', () => {
  it('download refuses redirects, transformed transfer bytes and streaming overflow', async () => {
    const pkg = packageFixture()
    const release = {
      ...pkg.release,
      archive: {
        ...pkg.release.archive,
        url: 'https://github.com/brocrew/brocrew/releases/download/fictional-v1/chrome.tar',
        size: 3,
        sha256: pluginSha256(Buffer.from('abc')),
      },
    }
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    for (const response of [
      new Response('abc', { status: 302 }),
      new Response('abc', { headers: { 'content-encoding': 'gzip' } }),
      new Response('abcd'),
    ]) {
      fetcher.mockResolvedValueOnce(response)
      await expect(
        downloadPluginArchive(release, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'unavailable' })
    }
    fetcher.mockResolvedValueOnce(new Response('abc', { headers: { 'content-length': '3' } }))
    expect(
      Buffer.from(await downloadPluginArchive(release, new AbortController().signal)).toString(),
    ).toBe('abc')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'manual',
      headers: { 'Accept-Encoding': 'identity' },
    })
  })
})

it.skipIf(process.platform === 'win32')(
  'negotiates tool health through Settings without adding fields to older list replies',
  async () => {
    let unavailable = false
    const f = await fixture({ toolsUnavailable: () => unavailable })
    await f.controller.install(f.handle, 'chrome')
    const key = 'b'.repeat(64)
    const restartChrome = vi.fn(async () => {
      unavailable = false
    })
    const service = await servePersonPluginControl({
      root: f.root,
      key,
      controller: sharedLifecycleWorkspaces(f.controller),
      read: async () => null,
      restartChrome,
    })
    const client = await connectPluginSettings({
      path: service.path,
      personKey: key,
      root: f.root,
      target: f.opts.target,
      catalogue: f.opts.catalogue,
      projection: projection().sink,
      propose() {},
    })
    const legacy = await connectPersonPluginControl({
      path: service.path,
      key,
      handle: async () => true,
    })
    try {
      await legacy.call({
        kind: 'attach',
        workspaceId: randomUUID(),
        catalogueDigest: pluginSha256(f.opts.catalogue.bytes),
      })
      expect((await client.catalogue())[0]).not.toHaveProperty('toolsUnavailable')
      expect((await client.catalogue())[0]).not.toHaveProperty('canRestart')
      unavailable = true
      expect((await client.catalogue())[0]).toMatchObject({
        state: 'Running',
        toolsUnavailable: true,
        canRestart: true,
      })
      expect(
        ((await legacy.call({ kind: 'list-v2' })) as Record<string, unknown>[])[0],
      ).not.toHaveProperty('toolsUnavailable')
      expect(
        ((await legacy.call({ kind: 'list-v2' })) as Record<string, unknown>[])[0],
      ).not.toHaveProperty('canRestart')
      expect(Command.safeParse({ kind: 'restart-chrome' }).success).toBe(false)
      expect(client.restartChrome).toBeTypeOf('function')
      await client.restartChrome!()
      expect(restartChrome).toHaveBeenCalledOnce()
      expect(
        ((await legacy.call({ kind: 'list' })) as Record<string, unknown>[])[0],
      ).not.toHaveProperty('toolsUnavailable')
      unavailable = false
      expect((await client.catalogue())[0]).not.toHaveProperty('toolsUnavailable')
    } finally {
      await legacy.call({ kind: 'detach' })
      legacy.close()
      await client.close()
      await service.close()
    }
  },
)

it.skipIf(process.platform === 'win32')(
  'carries initial and ended-run server causes only over the negotiated list',
  async () => {
    const f = await fixture()
    const diagnostic = {
      exitCode: 23,
      signal: null,
      stderr: 'Error: rejected /fictional/plugin/auth.json',
    }
    let exit = deferred<void>()
    let fail = false
    const originalStart = f.opts.runtime.start
    f.opts.runtime.start = async (spec) => {
      const run = await originalStart(spec)
      const runExit = exit
      return {
        ...run,
        exited: runExit.promise,
        stop: async () => {
          await run.stop()
          runExit.resolve()
        },
        startupDiagnostic: () => diagnostic,
        ready: async () => {
          if (fail) {
            runExit.resolve()
            throw new PluginSupervisorLaunchFailure(diagnostic)
          }
          return run.ready()
        },
      }
    }
    await f.controller.install(f.handle, 'chrome')
    await f.controller.drain()
    fail = true
    exit = deferred<void>()
    const controller = await PluginLifecycleController.open(f.opts)
    const failedHandle = await controller.attach(projection().sink)
    const key = 'b'.repeat(64)
    const service = await servePersonPluginControl({
      root: f.root,
      key,
      controller: sharedLifecycleWorkspaces(controller),
      read: async () => null,
    })
    const client = await connectPluginSettings({
      path: service.path,
      personKey: key,
      root: f.root,
      target: f.opts.target,
      catalogue: f.opts.catalogue,
      projection: projection().sink,
      propose() {},
    })
    const legacy = await connectPersonPluginControl({
      path: service.path,
      key,
      handle: async () => true,
    })
    try {
      await legacy.call({
        kind: 'attach',
        workspaceId: randomUUID(),
        catalogueDigest: pluginSha256(f.opts.catalogue.bytes),
      })
      expect((await client.catalogue())[0]).toMatchObject({
        state: 'Unavailable',
        unavailableReason: 'plugin-start',
        startupDiagnostic: diagnostic,
      })
      const oldCard = z.strictObject({
        id: z.string(),
        name: z.string(),
        state: z.string(),
        installed: z.boolean(),
        uninstallDeletesData: z.boolean().optional(),
        installedVersion: z.string().optional(),
        toolsCause: z.string().optional(),
      })
      for (const kind of ['list', 'list-v2', 'list-tool-health', 'list-tool-cause']) {
        const reply = await legacy.call({ kind })
        expect(z.array(oldCard).safeParse(reply).success, kind).toBe(true)
        expect((reply as object[])[0]).not.toHaveProperty('startupDiagnostic')
      }
    } finally {
      await legacy.call({ kind: 'detach' })
      legacy.close()
      await client.close()
      await service.close()
    }
    f.failStop()
    await expect(controller.uninstall(failedHandle, 'chrome')).rejects.toMatchObject({
      code: 'cleanup-pending',
    })
    expect(f.state.inspect().pending?.next?.pluginId).toBe('chrome')
    expect((await controller.status()).cards[0]).toMatchObject({
      state: 'Unavailable',
      unavailableReason: 'operation-pending',
    })
    f.failStop(false)
    await controller.uninstall(failedHandle, 'chrome')
    expect((await controller.status()).cards[0]).toMatchObject({
      installed: false,
      state: 'Available',
    })
    expect((await controller.status()).cards[0]).not.toHaveProperty('startupDiagnostic')
    expect((await controller.status()).cards[0]).not.toHaveProperty('unavailableReason')
    await controller.drain()
    fail = false
    exit = deferred<void>()
    const installer = await PluginLifecycleController.open(f.opts)
    const installing = await installer.attach(projection().sink)
    await installer.install(installing, 'chrome')
    await installer.drain()
    // A fresh run that reaches ready and later closes keeps the same diagnostic on its blocked card.
    fail = false
    exit = deferred<void>()
    const running = await PluginLifecycleController.open(f.opts)
    await running.attach(projection().sink)
    expect((await running.status()).cards[0]?.state).toBe('Running')
    exit.resolve()
    await vi.waitFor(async () => {
      expect((await running.status()).cards[0]).toMatchObject({
        state: 'Unavailable',
        unavailableReason: 'plugin-start',
        startupDiagnostic: diagnostic,
      })
    })
  },
)
