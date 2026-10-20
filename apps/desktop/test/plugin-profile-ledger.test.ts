import { chromeAdminRouteFixture } from '../../../scripts/lib/plugin-chrome-admin-fixture.mjs'
import { PluginUiRpc } from '../src/main/plugins/ui/rpc'
import { chromeUiFixture } from './chrome-ui-fixture'
import { PLUGIN_UI_CHANNEL } from '../src/shared/plugin-ui'
import { digest } from '../src/main/plugins/node-host-files'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { readFile, unlink, readdir, writeFile, rm } from 'node:fs/promises'
import { PluginProfileLedger } from '../src/main/plugins/lifecycle/profile-ledger'
import {
  fixture,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
  projection,
  deferred,
} from './plugin-lifecycle-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import {
  servePersonPluginControl,
  connectPersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { fictionalPublicKey } from './plugin-package-fixtures'
const closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})
describe.skipIf(process.platform === 'win32')(
  'person-only per-install Apply revision ledger',
  () => {
    it('consumes a durable revision before admin I/O, refuses stale revisions and keeps the install journal unchanged', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const active = f.state.exportActivation().entries[0]!,
        sequence = f.state.inspect().sequence
      const fetch = vi.fn(async () => {
        expect(await new PluginProfileLedger(f.root).revision(active.installId)).toBe(1)
        return new Response('{}', { status: 201 })
      })
      vi.stubGlobal('fetch', fetch)
      await f.controller.applyProfile(f.handle, {
        pluginId: 'chrome',
        installId: active.installId,
        incarnation: active.incarnation,
        revision: 0,
        proposal: { action: 'create-profile', profile: 'birch' },
      })
      expect(fetch).toHaveBeenCalledOnce()
      expect(f.state.inspect().sequence).toBe(sequence)
      expect(f.state.inspect().guards[0]?.configRevision).toBe(0)
      await expect(
        f.controller.applyProfile(f.handle, {
          pluginId: 'chrome',
          installId: active.installId,
          incarnation: active.incarnation,
          revision: 0,
          proposal: { action: 'create-profile', profile: 'fir' },
        }),
      ).rejects.toThrow()
      expect(fetch).toHaveBeenCalledOnce()
    })
    it('accepts the real Open route 202, retains its consumed intent and reads the open state without replay', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const active = f.state.exportActivation().entries[0]!
      const route = await chromeAdminRouteFixture(f.parent)
      const fetch = vi.fn(route.request)
      vi.stubGlobal('fetch', fetch)
      const input = {
        pluginId: 'chrome',
        installId: active.installId,
        incarnation: active.incarnation,
        revision: 0,
        proposal: { action: 'open-window', profile: 'birch' },
      }
      const succeeded = await f.controller.applyProfile(f.handle, input).then(
        () => true,
        () => false,
      )
      expect(route.statuses).toEqual([202])
      expect(succeeded).toBe(true)
      expect(route.launches).toEqual([{ profile: 'birch', mode: 'visible' }])
      expect(route.snapshot()).toMatchObject({ name: 'birch', open: true, mode: 'visible' })
      expect(await f.controller.profileRevision(f.handle, 'chrome', active.installId)).toBe(1)
      const reopened = await reopenLifecycleFixture(f)
      expect(await new PluginProfileLedger(f.root).revision(active.installId)).toBe(1)
      expect(reopened.exportActivation().entries[0]?.installId).toBe(active.installId)
      await expect(
        new PluginProfileLedger(f.root).reserve(active.installId, 0, input.proposal),
      ).rejects.toThrow()
      expect(fetch).toHaveBeenCalledOnce()
      expect(route.launches).toHaveLength(1)
    })
    it('refreshes after real Settings enable/disable Apply without mistaking a committed change for unavailability', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const route = await chromeAdminRouteFixture(f.parent)
      vi.stubGlobal('fetch', route.request)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'e'.repeat(64),
        controller: f.controller,
        read: async () => ({ profiles: [route.snapshot()], tabs: [] }),
      })
      closers.push(() => bridge.close())
      const client = await connectPluginSettings({
        path: bridge.path,
        personKey: 'e'.repeat(64),
        root: f.root,
        pinnedPublicKey: fictionalPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        projection: projection().sink,
        propose: () => {},
      })
      closers.push(() => client.close())
      const screen = await client.screen('chrome')
      let time = 0,
        request = 0
      const rpc = new PluginUiRpc({
        binding: screen.binding,
        schemas: chromeUiFixture().verified.manifest.ui!.methodSchemas,
        peer: screen.peer,
        current: () => screen.current(screen.binding),
        emit: () => {},
        propose: screen.propose,
        now: () => time,
      })
      closers.push(async () => rpc.close())
      const invoke = (method: string, payload: unknown, revision: number) =>
        rpc.invoke({
          channel: PLUGIN_UI_CHANNEL,
          requestId: String(++request),
          method,
          payload,
          configRevision: revision,
        })
      await invoke('read', { surface: 'chrome' }, 0)
      for (const [index, enabled] of [false, true].entries()) {
        await invoke('proposeConfig', { action: 'set-enabled', profile: 'birch', enabled }, index)
        expect(route.snapshot().enabled).toBe(enabled)
        expect(route.statuses).toEqual(Array(index + 1).fill(200))
        const refreshed = invoke('read', { surface: 'chrome' }, index).then(
          (value) => ({ ok: true, value }),
          () => ({ ok: false, value: null }),
        )
        const timer = setTimeout(() => {
          time += 1000
        }, 50)
        try {
          expect(await refreshed).toMatchObject({
            ok: true,
            value: {
              configRevision: index + 1,
              profiles: [{ name: 'birch', enabled }],
            },
          })
        } finally {
          clearTimeout(timer)
        }
      }
      const install = f.state.exportActivation().entries[0]!
      expect(await f.controller.profileRevision(f.handle, 'chrome', install.installId)).toBe(2)
    })
    it('serializes competing workspace presses at the same revision and sends exactly one admin request', async () => {
      const f = await fixture(),
        other = await f.controller.attach(projection().sink)
      await f.controller.install(f.handle, 'chrome')
      const active = f.state.exportActivation().entries[0]!,
        wait = deferred<Response>()
      const fetch = vi.fn(() => wait.promise)
      vi.stubGlobal('fetch', fetch)
      const input = {
        pluginId: 'chrome',
        installId: active.installId,
        incarnation: active.incarnation,
        revision: 0,
        proposal: { action: 'create-profile', profile: 'birch' },
      }
      const result = Promise.allSettled([
        f.controller.applyProfile(f.handle, input),
        f.controller.applyProfile(other, input),
      ])
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
      wait.resolve(new Response('{}', { status: 201 }))
      expect((await result).map((one) => one.status)).toEqual(['fulfilled', 'rejected'])
      expect(fetch).toHaveBeenCalledOnce()
    })
    it('does not replay an ambiguous failure on reopen, but the next read exposes the consumed revision', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const active = f.state.exportActivation().entries[0]!
      const fetch = vi.fn(async () => {
        throw new Error('fictional ambiguous response')
      })
      vi.stubGlobal('fetch', fetch)
      await expect(
        f.controller.applyProfile(f.handle, {
          pluginId: 'chrome',
          installId: active.installId,
          incarnation: active.incarnation,
          revision: 0,
          proposal: { action: 'open-window', profile: 'birch' },
        }),
      ).rejects.toThrow()
      const state = reopenLifecycleFixture(f),
        controller = await PluginLifecycleController.open({ ...f.opts, state }),
        handle = await controller.attach(projection().sink)
      expect(await controller.profileRevision(handle, 'chrome', active.installId)).toBe(1)
      expect(fetch).toHaveBeenCalledOnce()
    })
    it('detects a missing committed tail using its durable floor and refuses linked/truncated records', async () => {
      const f = await fixture(),
        ledger = new PluginProfileLedger(f.root)
      const id = '11111111-1111-4111-a111-111111111111'
      await ledger.reserve(id, 0, { action: 'create-profile', profile: 'birch' })
      const names = await readdir(join(f.root, 'profile-apply', digest(Buffer.from(id)), 'intents'))
      expect(names).toEqual(['00000001.json'])
      expect(
        JSON.parse(
          await readFile(
            join(f.root, 'profile-apply', digest(Buffer.from(id)), 'intents', names[0]!),
            'utf8',
          ),
        ).proposal.profile,
      ).toBe('birch')
      await unlink(join(f.root, 'profile-apply', digest(Buffer.from(id)), 'intents', names[0]!))
      await expect(ledger.revision(id)).rejects.toThrow()
    })
    it('ignores an unpublished crash stage, reclaims empty record stages, and never resets a removed committed ledger', async () => {
      const f = await fixture(),
        id = '11111111-1111-4111-a111-111111111112',
        ledger = new PluginProfileLedger(f.root)
      await ledger.reserve(id, 0, { action: 'create-profile', profile: 'birch' })
      const directory = join(f.root, 'profile-apply', digest(Buffer.from(id))),
        intents = join(directory, 'intents')
      await writeFile(join(intents, '.new-11111111-1111-4111-a111-111111111111'), '', {
        mode: 0o400,
      })
      expect(await ledger.revision(id)).toBe(1)
      expect(await readdir(intents)).toEqual(['00000001.json'])
      await rm(directory, { recursive: true })
      await expect(ledger.revision(id)).rejects.toThrow()
    })
    it('the real package-screen press applies through person control; read shows the new revision and reinstall invalidates old scope', async () => {
      const f = await fixture()
      await f.controller.install(f.handle, 'chrome')
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'e'.repeat(64),
        controller: f.controller,
        read: async () => ({ configRevision: 0, profiles: [], tabs: [] }),
      })
      closers.push(() => bridge.close())
      const client = await connectPluginSettings({
        path: bridge.path,
        personKey: 'e'.repeat(64),
        root: f.root,
        pinnedPublicKey: fictionalPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        projection: projection().sink,
        propose: () => {},
      })
      closers.push(() => client.close())
      const screen = await client.screen('chrome'),
        fetch = vi.fn(async () => new Response('{}', { status: 201 }))
      vi.stubGlobal('fetch', fetch)
      expect(
        (
          (await screen.peer.read({}, 0, screen.binding, new AbortController().signal)) as {
            configRevision: number
          }
        ).configRevision,
      ).toBe(0)
      await screen.peer.proposeConfig(
        { action: 'create-profile', profile: 'birch' },
        0,
        screen.binding,
        new AbortController().signal,
      )
      expect(fetch).toHaveBeenCalledOnce()
      expect(
        (
          (await screen.peer.read({}, 0, screen.binding, new AbortController().signal)) as {
            configRevision: number
          }
        ).configRevision,
      ).toBe(1)
      await expect(
        screen.peer.proposeConfig(
          { action: 'create-profile', profile: 'fir' },
          0,
          screen.binding,
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      await client.uninstall('chrome')
      await client.install('chrome')
      await expect(
        screen.peer.proposeConfig(
          { action: 'create-profile', profile: 'fir' },
          1,
          screen.binding,
          new AbortController().signal,
        ),
      ).rejects.toThrow()
      expect(fetch).toHaveBeenCalledOnce()
    })
    it('an agent lease cannot submit an Apply command and wrong person keys cannot connect', async () => {
      const { Command } = await import('../src/main/plugins/supervisor/protocol')
      expect(
        Command.safeParse({
          kind: 'apply',
          pluginId: 'chrome',
          revision: 0,
          proposal: { action: 'create-profile', profile: 'birch' },
        }).success,
      ).toBe(false)
      const f = await fixture(),
        bridge = await servePersonPluginControl({
          root: f.root,
          key: 'e'.repeat(64),
          controller: f.controller,
          read: async () => ({}),
        })
      closers.push(() => bridge.close())
      const channel = await connectPersonPluginControl({
        path: bridge.path,
        key: 'd'.repeat(64),
        handle: async () => true,
      })
      await expect(
        channel.call({ kind: 'attach', workspaceId: f.local.sink.workspaceId }),
      ).rejects.toThrow()
      channel.close()
    })
  },
)
