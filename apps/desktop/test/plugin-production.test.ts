import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { fixture, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { registerPluginSettings } from '../src/main/plugins/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import type { PluginCard } from '../src/shared/plugin-settings'
import { writeFile } from 'node:fs/promises'
import { packageFixture } from './plugin-package-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'
import { PLUGIN_LIST_URL, PLUGIN_LIST_V2_URL } from '../src/main/plugins/catalogue/download'
import { readPluginInstructions } from '../src/main/plugins/instructions'
import * as privateFiles from '../src/main/plugins/private-files'
vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: vi.fn() }))
const seams = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn((options: unknown) => {
    void options
    return async () => {}
  }),
}))
vi.mock('../src/main/plugins/lifecycle/settings-client', () => ({
  connectPluginSettings: seams.connect,
}))
vi.mock('../src/main/plugins/supervisor/launcher', () => ({
  createPluginSupervisorLauncher: seams.launch,
}))
import { productionPluginController } from '../src/main/plugins/production'
import {
  PluginSupervisorAttachment,
  PluginWorkspaceLease,
} from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import {
  LOST_CHANNEL_ENDS,
  OWNER_WIRE,
  type OwnerRecord,
} from '../src/main/plugins/supervisor/protocol'
const roots: string[] = []
const controllers: ReturnType<typeof productionPluginController>[] = []
afterEach(async () => {
  for (const c of controllers.splice(0)) await c.close()
  await cleanupLifecycleFixtures()
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
async function setup(pkg = packageFixture()) {
  const parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-production-')),
  )
  roots.push(parent)
  const workspaceRoot = join(parent, 'workspace')
  await mkdir(workspaceRoot, { mode: 0o700 })
  const fetch = vi.fn(async (url) => {
    expect(String(url)).toBe(PLUGIN_LIST_URL)
    return new Response(JSON.stringify(repoListFor(pkg.release)))
  })
  // Install the inert transport before construction, so an eager-start regression cannot fetch.
  vi.stubGlobal('fetch', fetch)
  const controller = productionPluginController()
  controllers.push(controller)
  const peer = {
    catalogue: vi.fn(async (): Promise<PluginCard[]> => [
      {
        id: pkg.release.id,
        name: pkg.release.id,
        installed: false,
        state: 'Available' as const,
      },
    ]),
    refreshCatalogue: vi.fn(async () => {}),
    install: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    screen: vi.fn(),
    close: vi.fn(async () => {}),
  }
  seams.connect.mockResolvedValue(peer)
  const supervisor = {
    start: vi.fn(),
    ready: vi.fn(async () => true),
    stoppedCleanly: vi.fn(() => false),
    holdsLease: vi.fn(() => false),
  }
  const options = {
    root: join(parent, 'global'),
    workspaceRoot,
    resourcesRoot: join(parent, 'resources'),
    build: 'fictional-build',
    appVersion: '0.0.0',
    target: { os: 'linux', cpu: 'x64' } as const,
    supervisor: supervisor as unknown as PluginSupervisorAttachment,
  }
  return { controller, options, peer, supervisor, fetch, pkg }
}
describe.skipIf(process.platform === 'win32')(
  'production Plugins gate (explicit fake controller/lease peers)',
  () => {
    it('joins overlapping Settings catalogue refreshes and returns the admitted cards to both callers', async () => {
      const f = await setup()
      f.controller.start(f.options)
      await f.controller.ready!()
      let release!: () => void
      f.peer.refreshCatalogue.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      const first = f.controller.catalogue(true)
      const second = f.controller.catalogue(true)
      expect(second).toBe(first)
      await vi.waitFor(() => expect(f.peer.refreshCatalogue).toHaveBeenCalledOnce())
      release()
      const [a, b] = await Promise.all([first, second])
      expect(a).toEqual(b)
      expect(a[0]).toMatchObject({ id: f.pkg.release.id, state: 'Available' })
      expect(f.controller.refreshFailed!()).toBe(false)
      expect(f.fetch).toHaveBeenCalledTimes(2)
    })
    it('does not label a structural root failure as a folder-permission problem', async () => {
      const f = await setup()
      vi.spyOn(privateFiles, 'keepPluginRootPrivate').mockRejectedValue(
        new Error('fictional private path and ACL detail'),
      )
      f.controller.start(f.options)
      await f.controller.ready!()
      const owner = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
      })
      const ipc = { handle: vi.fn() }
      registerPluginSettings(ipc, () => owner as never, f.controller)
      await expect(
        ipc.handle.mock.calls[0]![1](
          { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
          { kind: 'list' },
        ),
      ).resolves.toEqual({ ok: false, listState: 'fetch-error' })
      expect(f.fetch).not.toHaveBeenCalled()
      expect(f.supervisor.start).not.toHaveBeenCalled()
    })
    it('re-reads the catalogue when Settings opens and admits its digest before offering the new version', async () => {
      const f = await setup()
      const refreshCatalogue = vi.fn(async () => {})
      Object.assign(f.peer, { refreshCatalogue })
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      expect(f.fetch).toHaveBeenCalledOnce()
      const next = { ...f.pkg.release, version: '1.0.3' }
      f.fetch.mockResolvedValue(new Response(JSON.stringify(repoListFor(next))))
      f.peer.catalogue.mockResolvedValue([
        {
          id: f.pkg.release.id,
          name: 'Fictional bakery',
          installed: true,
          state: 'Running',
          installedVersion: '1.0.0',
          updateVersion: '1.0.3',
        },
      ])
      const cards = await f.controller.catalogue(true)
      expect(f.fetch).toHaveBeenCalledTimes(2)
      expect(refreshCatalogue).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/))
      expect(cards[0]?.updateVersion).toBe('1.0.3')
      await f.controller.catalogue()
      expect(f.fetch).toHaveBeenCalledTimes(2)
    })
    it.each(['Available', 'Unavailable'] as const)(
      'removing a withdrawn plugin with an %s owner card keeps the other plugin Running',
      async (state) => {
        const f = await setup()
        const chrome = { ...f.pkg.release, id: 'chrome' }
        const whatsapp = { ...f.pkg.release, id: 'whatsapp' }
        const list = repoListFor(whatsapp, 'Fictional WhatsApp')
        const running: PluginCard = {
          id: 'whatsapp',
          name: 'Fictional WhatsApp',
          installed: true,
          state: 'Running',
        }
        let removed = false
        f.fetch.mockImplementation(
          async () =>
            new Response(
              JSON.stringify({
                ...list,
                entries: [...repoListFor(chrome, 'Fictional Chrome').entries, ...list.entries],
              }),
            ),
        )
        f.peer.catalogue.mockImplementation(async () => [
          {
            id: 'chrome',
            name: 'Fictional Chrome',
            installed: !removed,
            state: removed ? state : 'Running',
          },
          running,
        ])
        f.peer.uninstall.mockImplementation(async () => {
          removed = true
        })
        f.controller.start(f.options)
        expect(await f.controller.ready!()).toBe(true)
        f.fetch.mockImplementation(async () => new Response(JSON.stringify(list)))
        expect(await f.controller.catalogue(true)).toMatchObject([
          running,
          { id: 'chrome', installed: true, state: 'Running', updatesUnavailable: true },
        ])
        await expect(f.controller.uninstall('chrome')).resolves.toBeUndefined()
        expect(await f.controller.catalogue()).toEqual([running])
        expect(await f.controller.catalogue(true)).toEqual([running])
        expect(readPluginInstructions(f.controller)).toMatchObject([
          { id: 'whatsapp', state: 'Running', tools: 'all agents', service: 'Fictional WhatsApp' },
        ])
        expect(f.peer.uninstall).toHaveBeenCalledExactlyOnceWith('chrome')
        expect(f.peer.install).not.toHaveBeenCalled()
      },
    )
    it('still refuses an offered release missing from the admitted owner cards', async () => {
      const f = await setup()
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      f.peer.catalogue.mockResolvedValue([])
      await expect(f.controller.uninstall(f.pkg.release.id)).rejects.toMatchObject({
        code: 'unavailable',
      })
      expect(await f.controller.catalogue(true)).toMatchObject([
        { id: f.pkg.release.id, state: 'Unavailable' },
      ])
      expect(readPluginInstructions(f.controller)).toMatchObject([
        { id: f.pkg.release.id, state: 'Unavailable', tools: 'none', service: null },
      ])
      expect(f.peer.install).not.toHaveBeenCalled()
    })
    it.each([
      { status: 404, body: '', state: 'not-published' },
      { status: 500, body: '', state: 'fetch-error' },
      { status: 200, body: 'fictional invalid list', state: 'fetch-error' },
    ])(
      'a page-open refresh reports $state and can recover without changing the running plugin',
      async ({ status, body }) => {
        const f = await setup()
        f.peer.catalogue.mockResolvedValue([
          { id: f.pkg.release.id, name: 'Fictional bakery', installed: true, state: 'Running' },
        ])
        f.controller.start(f.options)
        expect(await f.controller.ready!()).toBe(true)
        f.fetch.mockImplementation(async () => new Response(body, { status }))
        const owner = Object.assign(new EventEmitter(), {
          isDestroyed: () => false,
          webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
        })
        const ipc = { handle: vi.fn() }
        registerPluginSettings(ipc, () => owner as never, f.controller)
        const list = () =>
          ipc.handle.mock.calls[0]![1](
            { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
            { kind: 'list' },
          )
        expect(await list()).toMatchObject({
          ok: true,
          listState: 'ready',
          refreshFailed: true,
          cards: [{ installed: true, state: 'Running' }],
        })
        expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Running')
        expect(f.peer.refreshCatalogue).not.toHaveBeenCalled()
        f.fetch.mockImplementation(
          async () => new Response(JSON.stringify(repoListFor(f.pkg.release))),
        )
        expect(await list()).toMatchObject({
          ok: true,
          listState: 'ready',
          cards: [{ installed: true, state: 'Running' }],
        })
        expect(f.peer.refreshCatalogue).toHaveBeenCalledOnce()
        expect(f.peer.install).not.toHaveBeenCalled()
        expect(f.peer.uninstall).not.toHaveBeenCalled()
      },
    )
    it('an owner re-read failure preserves authenticated current cards without exposing its private detail', async () => {
      const f = await setup()
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      f.peer.refreshCatalogue.mockRejectedValueOnce(new Error('fictional private owner detail'))
      expect(await f.controller.catalogue(true)).toMatchObject([{ state: 'Available' }])
      expect(f.controller.refreshFailed!()).toBe(true)
      expect(await f.controller.catalogue(true)).toMatchObject([{ state: 'Available' }])
      expect(f.controller.refreshFailed!()).toBe(false)
      expect(f.peer.install).not.toHaveBeenCalled()
      expect(f.peer.uninstall).not.toHaveBeenCalled()
    })
    it('does not load the list or attach until its explicit start admission', async () => {
      const f = await setup()
      await Promise.resolve()
      expect(await f.controller.ready!()).toBe(false)
      expect(f.controller.available!()).toBe(false)
      expect(readPluginInstructions(f.controller)).toBeNull()
      expect(f.fetch).not.toHaveBeenCalled()
      expect(f.supervisor.start).not.toHaveBeenCalled()
      expect(seams.launch).not.toHaveBeenCalled()
      expect(seams.connect).not.toHaveBeenCalled()
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      expect(f.fetch).toHaveBeenCalledOnce()
      expect(f.supervisor.start).toHaveBeenCalledOnce()
    })
    it.each([false, true])(
      'wires dev source only for unpackaged admission (packaged=%s)',
      async (isPackaged) => {
        const f = await setup()
        const appData = join(f.options.workspaceRoot, 'app-data')
        const directory = join(appData, '@brobot2', 'plugin-dev-source')
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await writeFile(
          join(directory, 'catalogue.json'),
          JSON.stringify(repoListFor(f.pkg.release)),
          { mode: 0o600 },
        )
        f.controller.start({ ...f.options, devSource: { isPackaged, appData } })
        await f.controller.ready!()
        expect(f.supervisor.start).toHaveBeenCalledOnce()
        expect(seams.launch).toHaveBeenCalledWith(
          expect.objectContaining({
            lifecycle: expect.objectContaining({ devSource: isPackaged ? undefined : directory }),
          }),
        )
        expect(f.fetch).toHaveBeenCalledTimes(isPackaged ? 1 : 0)
        await f.controller.install(f.pkg.release.id)
        expect(f.peer.install).toHaveBeenCalledOnce()
      },
    )
    it('refuses a linked dev root before network or supervisor startup', async () => {
      const f = await setup()
      const appData = join(f.options.workspaceRoot, 'app-data')
      await mkdir(join(appData, '@brobot2'), { recursive: true, mode: 0o700 })
      await symlink(f.options.workspaceRoot, join(appData, '@brobot2/plugin-dev-source'))
      f.controller.start({ ...f.options, devSource: { isPackaged: false, appData } })
      await f.controller.ready!()
      expect(f.fetch).not.toHaveBeenCalled()
      expect(f.supervisor.start).not.toHaveBeenCalled()
      await expect(f.controller.catalogue()).rejects.toMatchObject({
        state: 'fetch-error',
        reason: 'supervisor-unavailable',
      })
    })
    it('no network reports a list fetch error without launch or a half-install', async () => {
      const f = await setup()
      f.fetch.mockRejectedValue(new Error('fictional offline'))
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      expect(f.controller.available!()).toBe(true)
      expect(readPluginInstructions(f.controller)).toBeNull()
      await expect(f.controller.catalogue()).rejects.toThrow('fetch-error')
      expect(f.supervisor.start).not.toHaveBeenCalled()
      expect(seams.connect).not.toHaveBeenCalled()
    })
    it.each([
      { status: 404, body: '', expected: { ok: false, listState: 'not-published' } },
      { status: 500, body: '', expected: { ok: false, listState: 'fetch-error' } },
      { status: 200, body: 'invalid json', expected: { ok: false, listState: 'fetch-error' } },
      {
        status: 200,
        body: '{"format":1,"entries":[]}',
        expected: { ok: true, cards: [], listState: 'empty' },
      },
    ])(
      'maps public list HTTP $status ($body) through Settings',
      async ({ status, body, expected }) => {
        const f = await setup()
        f.fetch.mockImplementation(async () => new Response(body, { status }))
        const warn = vi.spyOn(console, 'warn')
        f.controller.start(f.options)
        await f.controller.ready!()
        const owner = Object.assign(new EventEmitter(), {
          isDestroyed: () => false,
          webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
        })
        const ipc = { handle: vi.fn() }
        registerPluginSettings(ipc, () => owner as never, f.controller)
        const answer = await ipc.handle.mock.calls[0]![1](
          { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
          { kind: 'list' },
        )
        expect(answer).toEqual(expected)
        expect(f.controller.available!()).toBe(true)
        expect(f.supervisor.start).not.toHaveBeenCalled()
        expect(seams.connect).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalledWith('[plugins] plugin-initialization-failed')
      },
    )
    it('maps a rejected public list fetch through Settings without plugin failure wording', async () => {
      const f = await setup()
      f.fetch.mockRejectedValue(new Error('fictional private network detail'))
      f.controller.start(f.options)
      await f.controller.ready!()
      const owner = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
      })
      const ipc = { handle: vi.fn() }
      registerPluginSettings(ipc, () => owner as never, f.controller)
      expect(
        await ipc.handle.mock.calls[0]![1](
          { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
          { kind: 'list' },
        ),
      ).toEqual({ ok: false, listState: 'fetch-error' })
      expect(f.supervisor.start).not.toHaveBeenCalled()
    })
    it('loads only the fixed repo list without a key and Install needs one press', async () => {
      const f = await setup()
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      expect(f.controller.available!()).toBe(true)
      const launch = seams.launch.mock.calls[0]![0] as unknown as {
        lifecycle: {
          source: string
          catalogueSha256: string
          personKey: string
          downloads?: unknown
          publicKey?: unknown
        }
      }
      expect(launch.lifecycle.source).toBe('repo-list')
      expect(launch.lifecycle.catalogueSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(launch.lifecycle.publicKey).toBeUndefined()
      expect(f.fetch).toHaveBeenCalledOnce()
      expect(launch.lifecycle.personKey).toMatch(/^[a-f0-9]{64}$/)
      expect(launch.lifecycle.downloads).toBeUndefined()
      expect(readPluginInstructions(f.controller)?.[0]).toMatchObject({
        id: 'fictional-bakery',
        state: 'Available',
        tools: 'none',
        service: null,
      })
      await f.controller.install('fictional-bakery')
      expect(f.peer.install).toHaveBeenCalledWith('fictional-bakery')
    })
    it('a person retry after no network reloads the list and permits one Install without restarting', async () => {
      const f = await setup()
      f.fetch.mockRejectedValueOnce(new Error('fictional offline'))
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      expect(f.supervisor.start).not.toHaveBeenCalled()
      expect((await f.controller.catalogue())[0]?.state).toBe('Available')
      await f.controller.install('fictional-bakery')
      expect(f.peer.install).toHaveBeenCalledOnce()
      expect(f.fetch).toHaveBeenCalledTimes(2)
    })
    it('a failed attachment can retry; a successful lease is reused and closed once', async () => {
      const f = await setup()
      const lease = { close: vi.fn(async () => true) }
      const attach = vi
        .spyOn(PluginWorkspaceLease, 'attach')
        .mockRejectedValueOnce(new Error('fictional unavailable'))
        .mockResolvedValue(lease as never)
      const supervisor = new PluginSupervisorAttachment()
      try {
        supervisor.start({
          root: f.options.root,
          workspaceRoot: f.options.workspaceRoot,
          build: f.options.build,
        })
        expect(await supervisor.ready()).toBe(false)
        supervisor.start({
          root: f.options.root,
          workspaceRoot: f.options.workspaceRoot,
          build: f.options.build,
        })
        expect(await supervisor.ready()).toBe(true)
        supervisor.start({
          root: f.options.root,
          workspaceRoot: f.options.workspaceRoot,
          build: f.options.build,
        })
        expect(attach).toHaveBeenCalledTimes(2)
        await supervisor.quit()
        expect(lease.close).toHaveBeenCalledOnce()
      } finally {
        attach.mockRestore()
      }
    })
    it('quit aborts pending catalogue I/O instead of holding normal app shutdown', async () => {
      const f = await setup()
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async (_url, init) =>
            new Promise<Response>((_yes, reject) => {
              init!.signal!.addEventListener(
                'abort',
                () => reject(new Error('fictional aborted')),
                {
                  once: true,
                },
              )
            }),
        ) as typeof fetch,
      )
      f.controller.start(f.options)
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
      await f.controller.close()
      expect(await f.controller.ready!()).toBe(false)
      expect(f.supervisor.start).not.toHaveBeenCalled()
    })
    it('quit keeps the person channel alive until detach and reverse revoke acknowledgments finish', async () => {
      const f = await setup()
      let acknowledge!: () => void
      const ack = new Promise<void>((resolve) => {
        acknowledge = resolve
      })
      let settings!: { signal: AbortSignal; lost(): void }
      seams.connect.mockImplementation(async (options) => {
        settings = options
        settings.signal.addEventListener('abort', () => settings.lost(), { once: true })
        return f.peer
      })
      f.peer.close.mockImplementation(async () => {
        expect(settings.signal.aborted).toBe(false)
        await ack // Fake peer's outstanding reverse revoke acknowledgment.
        expect(settings.signal.aborted).toBe(false)
      })
      f.controller.start(f.options)
      await f.controller.ready!()
      const closing = f.controller.close()
      await vi.waitFor(() => expect(f.peer.close).toHaveBeenCalledOnce())
      expect(settings.signal.aborted).toBe(false)
      expect(f.controller.available!()).toBe(false)
      acknowledge()
      await closing
      expect(settings.signal.aborted).toBe(true)
    })
    it('a blocked owner preserves installed display evidence and retry only reconnects', async () => {
      const f = await setup()
      vi.spyOn(GlobalPluginState, 'observeInstallations').mockReturnValue({
        installed: [f.pkg.release.id],
        pending: null,
      })
      f.supervisor.ready.mockResolvedValue(false)
      f.controller.start(f.options)
      await f.controller.ready!()
      expect(await f.controller.catalogue()).toMatchObject([
        { installed: true, state: 'Unavailable' },
      ])
      expect(seams.connect).not.toHaveBeenCalled()
      f.supervisor.ready.mockResolvedValue(true)
      f.peer.catalogue.mockResolvedValue([
        { id: f.pkg.release.id, name: 'Fictional Bakery', installed: true, state: 'Running' },
      ])
      expect(await f.controller.retry!('fictional-bakery')).toMatchObject([
        { installed: true, state: 'Running' },
      ])
      expect(seams.connect).toHaveBeenCalledOnce()
      expect(f.peer.install).not.toHaveBeenCalled()
      expect(f.peer.uninstall).not.toHaveBeenCalled()
    })
    it('Try again reattaches an existing but unadmitted connection without reinstalling', async () => {
      const f = await setup()
      f.peer.catalogue.mockResolvedValue([
        { id: f.pkg.release.id, name: 'Fictional Bakery', installed: true, state: 'Unavailable' },
      ])
      f.controller.start(f.options)
      await f.controller.ready!()
      f.peer.catalogue.mockResolvedValue([
        { id: f.pkg.release.id, name: 'Fictional Bakery', installed: true, state: 'Running' },
      ])
      expect(await f.controller.retry!(f.pkg.release.id)).toMatchObject([
        { installed: true, state: 'Running' },
      ])
      expect(f.peer.close).toHaveBeenCalledOnce()
      expect(seams.connect).toHaveBeenCalledTimes(2)
      expect(f.peer.install).not.toHaveBeenCalled()
      expect(f.peer.uninstall).not.toHaveBeenCalled()
    })
    it('a failed list keeps a live channel available for acknowledged quit instead of disconnecting it early', async () => {
      const f = await setup()
      vi.spyOn(GlobalPluginState, 'observeInstallations').mockReturnValue({
        installed: [f.pkg.release.id],
        pending: null,
      })
      f.peer.catalogue.mockResolvedValue([
        { id: f.pkg.release.id, name: 'Fictional Bakery', installed: true, state: 'Running' },
      ])
      f.controller.start(f.options)
      await f.controller.ready!()
      f.peer.catalogue.mockRejectedValueOnce(new Error('fictional-private-owner-stack'))
      expect(await f.controller.catalogue()).toMatchObject([
        { installed: true, state: 'Unavailable' },
      ])
      expect(f.peer.close).not.toHaveBeenCalled()
      await f.controller.close()
      expect(f.peer.close).toHaveBeenCalledOnce()
    })
    it('quit during Try again still waits for the old channel revoke acknowledgment', async () => {
      const f = await setup()
      f.controller.start(f.options)
      await f.controller.ready!()
      const settings = seams.connect.mock.calls[0]![0] as { signal: AbortSignal }
      let ack!: () => void
      const done = new Promise<void>((resolve) => {
        ack = resolve
      })
      f.peer.close.mockImplementation(() => done)
      const retry = f.controller.retry!(f.pkg.release.id).catch(() => undefined)
      await vi.waitFor(() => expect(f.peer.close).toHaveBeenCalledOnce())
      const closing = f.controller.close()
      expect(settings.signal.aborted).toBe(false)
      ack()
      await retry
      await closing
      expect(settings.signal.aborted).toBe(true)
    })
    it('catalogue joins a pending retry detach and a late old loss cannot erase its successor at quit', async () => {
      const f = await setup()
      const successor = {
        ...f.peer,
        close: vi.fn(async () => {}),
        catalogue: vi.fn(async (): Promise<PluginCard[]> => [
          { id: f.pkg.release.id, name: 'Fictional Bakery', installed: true, state: 'Running' },
        ]),
      }
      const peers: { signal: AbortSignal; lost(): void }[] = []
      seams.connect.mockImplementation(async (options) => {
        peers.push(options)
        return peers.length === 1 ? f.peer : successor
      })
      f.controller.start(f.options)
      await f.controller.ready!()
      let acknowledge!: () => void
      const ack = new Promise<void>((resolve) => {
        acknowledge = resolve
      })
      f.peer.close.mockImplementation(async () => {
        await ack
        peers[0]!.lost()
      })
      successor.close.mockImplementation(async () => {
        expect(peers[1]!.signal.aborted).toBe(false)
      })
      const retry = f.controller.retry!(f.pkg.release.id)
      await vi.waitFor(() => expect(f.peer.close).toHaveBeenCalledOnce())
      const list = f.controller.catalogue()
      // Record admission during the held ACK, but always release it before assertions/cleanup.
      await Promise.resolve()
      const fetchesBeforeAck = f.fetch.mock.calls.length
      acknowledge()
      await Promise.all([retry, list])
      peers[0]!.lost() // A delayed/duplicate notification must belong only to A.
      const afterOldLoss = readPluginInstructions(f.controller)
      await f.controller.close()
      expect(afterOldLoss?.[0]?.state).toBe('Running')
      expect(fetchesBeforeAck).toBe(1)
      expect(seams.connect).toHaveBeenCalledTimes(2)
      expect(successor.close).toHaveBeenCalledOnce()
      expect(peers[1]!.signal.aborted).toBe(true)
    })
    it('a real pending first-install cleanup overrides an unadmitted peer card through Settings', async () => {
      const real = await fixture({
        fault(point) {
          if (point === 'ready') throw new Error('fictional fault')
        },
      })
      real.failStop()
      await expect(real.controller.install(real.handle, 'chrome')).rejects.toThrow()
      expect(real.state.inspect().pending).not.toBeNull()
      const cards = (await real.controller.status()).cards
      expect(cards).toMatchObject([{ installed: false, state: 'Unavailable' }])
      const f = await setup(real.pkg)
      f.peer.catalogue.mockResolvedValue(cards)
      f.controller.start({
        ...f.options,
        root: real.root,
        workspaceRoot: real.workspace,
        target: real.opts.target,
      })
      await f.controller.ready!()
      const owner = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
      })
      const ipc = { handle: vi.fn() }
      registerPluginSettings(ipc, () => owner as never, f.controller)
      const handler = ipc.handle.mock.calls[0]![1]
      const answer = await handler(
        { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
        { kind: 'list' },
      )
      expect(answer).toMatchObject({ ok: true, cards: [{ installed: null, state: 'Unavailable' }] })
      expect(f.peer.install).not.toHaveBeenCalled()
    })
    it.each(['readable', 'busy'] as const)(
      'an absent-to-Running real install stays non-absent after rejected detach with %s observation',
      async (mode) => {
        const real = await fixture()
        const f = await setup(real.pkg)
        const observation = vi.spyOn(GlobalPluginState, 'observeInstallations')
        f.peer.catalogue.mockImplementation(async () => (await real.controller.status()).cards)
        f.peer.install.mockImplementation(async () =>
          real.controller.install(real.handle, 'chrome'),
        )
        f.controller.start({
          ...f.options,
          root: real.root,
          workspaceRoot: real.workspace,
          target: real.opts.target,
        })
        await f.controller.ready!()
        const owner = Object.assign(new EventEmitter(), {
          isDestroyed: () => false,
          webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
        })
        const ipc = { handle: vi.fn() }
        registerPluginSettings(ipc, () => owner as never, f.controller)
        const handler = ipc.handle.mock.calls[0]![1]
        const call = (input: unknown) =>
          handler({ sender: owner.webContents, senderFrame: owner.webContents.mainFrame }, input)
        expect(await call({ kind: 'list' })).toMatchObject({
          ok: true,
          cards: [{ installed: false, state: 'Available' }],
        })
        expect(await call({ kind: 'install', id: 'chrome' })).toMatchObject({
          ok: true,
          cards: [{ installed: true, state: 'Running' }],
        })
        expect(f.peer.install).toHaveBeenCalledOnce()
        expect(real.downloads()).toBe(1)
        if (mode === 'busy')
          observation.mockImplementation(() => {
            throw new Error('fictional-private-busy-path')
          })
        const readsBeforeDetach = observation.mock.calls.length
        f.peer.close.mockRejectedValue(new Error('fictional-private-detach'))
        const expected = [{ installed: mode === 'readable' ? true : null, state: 'Unavailable' }]
        const retry = await f.controller.retry!('chrome')
        const list = await f.controller.catalogue()
        const settingsRetry = await call({ kind: 'retry', id: 'chrome' })
        const settingsList = await call({ kind: 'list' })
        for (const cards of [retry, list]) expect(cards).toMatchObject(expected)
        for (const answer of [settingsRetry, settingsList])
          expect(answer).toMatchObject({ ok: true, cards: expected })
        expect(observation).toHaveBeenCalledTimes(readsBeforeDetach + 4)
        expect(seams.connect).toHaveBeenCalledOnce()
        expect(f.peer.install).toHaveBeenCalledOnce()
        expect(f.peer.uninstall).not.toHaveBeenCalled()
        expect(JSON.stringify([retry, list, settingsRetry, settingsList])).not.toContain(
          'fictional-private',
        )
      },
    )
    it('unknown evidence overrides a successful unadmitted false card', async () => {
      const f = await setup()
      await mkdir(f.options.root, { mode: 0o700 })
      await writeFile(join(f.options.root, 'lifecycle-state-born'), '1', { mode: 0o600 })
      vi.spyOn(GlobalPluginState, 'observeInstallations').mockImplementation(() => {
        throw new Error('fictional unknown')
      })
      f.peer.catalogue.mockResolvedValue([
        { id: f.pkg.release.id, name: 'Fictional Bakery', installed: false, state: 'Unavailable' },
      ])
      f.controller.start(f.options)
      await f.controller.ready!()
      expect(await f.controller.catalogue()).toMatchObject([
        { installed: null, state: 'Unavailable' },
      ])
    })
    it.each(['rejected', 'held rejection'] as const)(
      'an uncertain %s detach fences retry, catalogue and discovery reconnects',
      async (mode) => {
        const f = await setup()
        f.peer.catalogue.mockResolvedValue([
          { id: f.pkg.release.id, name: 'Fictional Bakery', installed: true, state: 'Running' },
        ])
        vi.spyOn(GlobalPluginState, 'observeInstallations').mockReturnValue({
          installed: [f.pkg.release.id],
          pending: null,
        })
        f.controller.start(f.options)
        await f.controller.ready!()
        let reject!: (reason: Error) => void
        const failure = new Error('fictional-private-detach-timeout')
        f.peer.close.mockRejectedValue(failure).mockImplementationOnce(() =>
          mode === 'rejected'
            ? Promise.reject(failure)
            : new Promise<void>((_yes, no) => {
                reject = no
              }),
        )
        const retry = f.controller.retry!(f.pkg.release.id)
        await vi.waitFor(() => expect(f.peer.close).toHaveBeenCalledOnce())
        if (mode === 'held rejection') reject(failure)
        const result = await retry
        const list = await f.controller.catalogue()
        const again = await f.controller.retry!(f.pkg.release.id)
        readPluginInstructions(f.controller)
        await f.controller.ready!()
        expect(seams.connect).toHaveBeenCalledOnce()
        for (const cards of [result, list, again])
          expect(cards).toMatchObject([{ installed: true, state: 'Unavailable' }])
        await expect(f.controller.install(f.pkg.release.id)).rejects.toThrow(
          'Plugin unavailable. Try again.',
        )
        expect(f.peer.install).not.toHaveBeenCalled()
        expect(f.peer.uninstall).not.toHaveBeenCalled()
        expect(JSON.stringify(result)).not.toContain('fictional-private')
      },
    )
    it('unknown installation evidence never becomes absent or forwards raw storage errors', async () => {
      const f = await setup()
      await mkdir(f.options.root, { mode: 0o700 })
      await writeFile(join(f.options.root, 'lifecycle-state-born'), '1', { mode: 0o600 })
      vi.spyOn(GlobalPluginState, 'observeInstallations').mockImplementation(() => {
        throw new Error('fictional-private-path-and-stack')
      })
      f.supervisor.ready.mockResolvedValue(false)
      f.controller.start(f.options)
      await f.controller.ready!()
      const cards = await f.controller.catalogue()
      expect(cards).toMatchObject([{ installed: null, state: 'Unavailable' }])
      expect(JSON.stringify(cards)).not.toContain('fictional-private-path')
    })
    it('a lost person channel marks the known list unavailable without granting calls', async () => {
      const f = await setup()
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      const settings = seams.connect.mock.calls[0]![0] as { lost(): void }
      settings.lost()
      expect(f.controller.available!()).toBe(true)
      expect(await f.controller.ready!()).toBe(true)
      expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Unavailable')
    })
    it.each([false, true])(
      'a lost person channel recovers by itself once the owner proves its clean stop (after Uninstall: %s)',
      async (afterUninstall) => {
        const f = await setup()
        const epochs = [randomUUID(), randomUUID()]
        const owner = (epoch: string, phase: OwnerRecord['phase']) => {
          const storage = new SupervisorStorage(f.options.root, [f.options.workspaceRoot], true)
          try {
            storage.write({ version: 1, epoch, key: 'a'.repeat(64), phase, wire: OWNER_WIRE })
          } finally {
            storage.close()
          }
        }
        const leases = epochs.map((epoch) => ({
          epoch,
          standing: vi.fn(() => true),
          features: [LOST_CHANNEL_ENDS],
          abandon: vi.fn(),
          close: vi.fn(async () => true),
        }))
        const attach = vi
          .spyOn(PluginWorkspaceLease, 'attach')
          .mockResolvedValueOnce(leases[0] as never)
          .mockResolvedValueOnce(leases[1] as never)
        const supervisor = new PluginSupervisorAttachment()
        try {
          owner(epochs[0]!, 'accepting')
          f.controller.start({ ...f.options, supervisor })
          expect(await f.controller.ready!()).toBe(true)
          if (afterUninstall) {
            // The removal completed and nothing is active, then the owner stops cleanly.
            vi.spyOn(GlobalPluginState, 'observeInstallations').mockReturnValue({
              installed: [],
              pending: null,
            })
            await f.controller.uninstall(f.pkg.release.id)
            expect(f.peer.uninstall).toHaveBeenCalledOnce()
          }
          const settings = seams.connect.mock.calls[0]![0] as { lost(): void }
          settings.lost()
          // The old owner still holds this app's consumer: no list may reconnect it.
          owner(epochs[0]!, 'draining')
          expect(await f.controller.catalogue()).toMatchObject([{ state: 'Unavailable' }])
          expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Unavailable')
          expect(attach).toHaveBeenCalledOnce()
          expect(seams.connect).toHaveBeenCalledOnce()
          owner(epochs[0]!, 'stopped')
          expect(await f.controller.catalogue()).toMatchObject([{ state: 'Available' }])
          expect(attach).toHaveBeenCalledTimes(2)
          expect(seams.connect).toHaveBeenCalledTimes(2)
          expect(leases[0]!.abandon).toHaveBeenCalledOnce()
          expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Available')
          await f.controller.install(f.pkg.release.id)
          expect(f.peer.install).toHaveBeenCalledOnce()
        } finally {
          await f.controller.close()
          await supervisor.quit()
          attach.mockRestore()
        }
        expect(leases[1]!.close).toHaveBeenCalledOnce()
        expect(leases[0]!.close).not.toHaveBeenCalled()
      },
    )
    it('a lost lease recovers by itself once the owner proves its clean stop', async () => {
      const f = await setup()
      const epoch = randomUUID()
      const owner = (phase: OwnerRecord['phase']) => {
        const storage = new SupervisorStorage(f.options.root, [f.options.workspaceRoot], true)
        try {
          storage.write({ version: 1, epoch, key: 'a'.repeat(64), phase, wire: OWNER_WIRE })
        } finally {
          storage.close()
        }
      }
      const leases = [epoch, randomUUID()].map((one) => ({
        epoch: one,
        standing: vi.fn(() => one !== epoch),
        features: [LOST_CHANNEL_ENDS],
        abandon: vi.fn(),
        close: vi.fn(async () => true),
      }))
      const attach = vi
        .spyOn(PluginWorkspaceLease, 'attach')
        .mockResolvedValueOnce(leases[0] as never)
        .mockResolvedValueOnce(leases[1] as never)
      const supervisor = new PluginSupervisorAttachment()
      try {
        owner('accepting')
        f.controller.start({ ...f.options, supervisor })
        expect(await f.controller.ready!()).toBe(true)
        const { onLost } = attach.mock.calls[0]![0] as { onLost(): void }
        onLost()
        owner('draining')
        expect(await f.controller.catalogue()).toMatchObject([{ state: 'Unavailable' }])
        expect(attach).toHaveBeenCalledOnce()
        owner('stopped')
        await vi.waitFor(() => expect(seams.connect).toHaveBeenCalledTimes(2), { timeout: 8000 })
        expect(attach).toHaveBeenCalledTimes(2)
        expect(leases[0]!.abandon).toHaveBeenCalledOnce()
        expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Available')
      } finally {
        await f.controller.close()
        await supervisor.quit()
        attach.mockRestore()
      }
    }, 15_000)
    it('a lost person channel reconnects by itself to an owner that still accepts this lease', async () => {
      const f = await setup()
      const epoch = randomUUID()
      const storage = new SupervisorStorage(f.options.root, [f.options.workspaceRoot], true)
      try {
        storage.write({
          version: 1,
          epoch,
          key: 'a'.repeat(64),
          phase: 'accepting',
          wire: OWNER_WIRE,
        })
      } finally {
        storage.close()
      }
      const lease = {
        epoch,
        standing: vi.fn(() => true),
        features: [LOST_CHANNEL_ENDS],
        abandon: vi.fn(),
        close: vi.fn(async () => true),
      }
      const attach = vi.spyOn(PluginWorkspaceLease, 'attach').mockResolvedValue(lease as never)
      const supervisor = new PluginSupervisorAttachment()
      try {
        f.controller.start({ ...f.options, supervisor })
        expect(await f.controller.ready!()).toBe(true)
        ;(seams.connect.mock.calls[0]![0] as { lost(): void }).lost()
        expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Unavailable')
        await vi.waitFor(() => expect(seams.connect).toHaveBeenCalledTimes(2), { timeout: 8000 })
        expect(await f.controller.ready!()).toBe(true)
        expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Available')
        expect(attach).toHaveBeenCalledOnce()
        expect(f.fetch).toHaveBeenCalledOnce() // The owner admits only the list it started with.
        expect(lease.abandon).not.toHaveBeenCalled()
      } finally {
        await f.controller.close()
        await supervisor.quit()
        attach.mockRestore()
      }
      expect(lease.close).toHaveBeenCalledOnce()
    }, 15_000)
    it('with nobody asking, a clean stop after a loss is retried on a backoff', async () => {
      const f = await setup()
      f.supervisor.stoppedCleanly.mockReturnValueOnce(false).mockReturnValue(true)
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      ;(seams.connect.mock.calls[0]![0] as { lost(): void }).lost()
      await vi.waitFor(() => expect(seams.connect).toHaveBeenCalledTimes(2), { timeout: 8000 })
      expect(await f.controller.ready!()).toBe(true)
      expect(f.supervisor.stoppedCleanly).toHaveBeenCalledTimes(2)
      expect(f.supervisor.start).toHaveBeenCalledTimes(2)
      expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Available')
    }, 15_000)
    it('verification failure never reaches the launcher/controller and normal callers receive only approved unavailable', async () => {
      const f = await setup()
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')) as typeof fetch)
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      expect(seams.launch).not.toHaveBeenCalled()
      expect(readPluginInstructions(f.controller)).toBeNull()
      await expect(f.controller.install('fictional-bakery')).rejects.toThrow(
        'Plugin unavailable. Try again.',
      )
    })
    it('logs a closed initialization failure instead of the private thrown message', async () => {
      const f = await setup()
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      seams.launch.mockImplementationOnce(() => {
        throw new Error('fictional-private-error-with-key')
      })
      f.controller.start(f.options)
      await f.controller.ready!()
      expect(warning.mock.calls).toEqual([['[plugins] plugin-initialization-failed']])
      expect(f.supervisor.start).not.toHaveBeenCalled()
      await expect(f.controller.install(f.pkg.release.id)).rejects.toThrow(
        'Plugin unavailable. Try again.',
      )
    })
    it('connection failure keeps the card unavailable and refuses Install', async () => {
      const f = await setup()
      f.supervisor.ready.mockResolvedValue(false)
      f.controller.start(f.options)
      expect(await f.controller.ready!()).toBe(true)
      expect(f.controller.available!()).toBe(true)
      expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Unavailable')
      expect(seams.connect).not.toHaveBeenCalled()
    })
  },
)

it.skipIf(process.platform === 'win32')(
  'offline page opening keeps Running and its authenticated Configure route',
  async () => {
    const f = await setup()
    f.peer.catalogue.mockResolvedValue([
      { id: f.pkg.release.id, name: 'Fictional bakery', installed: true, state: 'Running' },
    ])
    f.controller.start(f.options)
    expect(await f.controller.ready!()).toBe(true)
    f.fetch.mockRejectedValue(new Error('fictional offline transport'))
    const owner = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      getContentBounds: () => ({ width: 1180, height: 900 }),
      webContents: Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() }),
    })
    const ipc = { handle: vi.fn() }
    registerPluginSettings(ipc, () => owner as never, f.controller)
    const answer = await ipc.handle.mock.calls[0]![1](
      { sender: owner.webContents, senderFrame: owner.webContents.mainFrame },
      { kind: 'list' },
    )
    expect(answer).toMatchObject({
      ok: true,
      refreshFailed: true,
      cards: [{ installed: true, state: 'Running' }],
    })
    const screen = { fictional: true }
    f.peer.screen.mockResolvedValue(screen)
    expect(await f.controller.screen(f.pkg.release.id)).toBe(screen)
    expect(f.peer.screen).toHaveBeenCalledWith(f.pkg.release.id)
    expect(f.peer.install).not.toHaveBeenCalled()
    expect(f.peer.uninstall).not.toHaveBeenCalled()
  },
)
it.skipIf(process.platform === 'win32')(
  'a legacy owner keeps its authenticated list without refresh or Update when the local catalogue advances',
  async () => {
    const f = await setup()
    Reflect.deleteProperty(f.peer, 'refreshCatalogue')
    f.peer.catalogue.mockResolvedValue([
      { id: 'whatsapp', name: 'WhatsApp', installed: true, state: 'Running' },
    ])
    f.controller.start(f.options)
    expect(await f.controller.ready!()).toBe(true)
    const fetches = f.fetch.mock.calls.length
    expect(await f.controller.catalogue(true)).toEqual([
      {
        id: 'whatsapp',
        name: 'WhatsApp',
        installed: true,
        state: 'Running',
        updatesUnavailable: true,
      },
    ])
    const [card] = await f.controller.catalogue()
    expect(card).not.toHaveProperty('updateVersion')
    expect(f.fetch).toHaveBeenCalledTimes(fetches)
    expect(f.controller.refreshFailed!()).toBe(false)
  },
)

it.skipIf(process.platform === 'win32')(
  'an ambiguous refresh reply still uses the authenticated owner cards when its list advanced',
  async () => {
    const f = await setup()
    f.controller.start(f.options)
    expect(await f.controller.ready!()).toBe(true)
    f.peer.refreshCatalogue.mockRejectedValueOnce(new Error('fictional lost refresh reply'))
    f.peer.catalogue.mockResolvedValue([
      { id: 'whatsapp', name: 'WhatsApp', installed: true, state: 'Running' },
    ])
    expect(await f.controller.catalogue(true)).toMatchObject([
      { id: 'whatsapp', installed: true, state: 'Running' },
    ])
    expect(f.controller.refreshFailed!()).toBe(true)
  },
)

it.skipIf(process.platform === 'win32')(
  'a legacy unavailable card still cannot turn an unadmitted false bit into Install',
  async () => {
    const f = await setup()
    Reflect.deleteProperty(f.peer, 'refreshCatalogue')
    f.controller.start(f.options)
    expect(await f.controller.ready!()).toBe(true)
    vi.spyOn(GlobalPluginState, 'observeInstallations').mockReturnValue({
      installed: ['whatsapp'],
      pending: null,
    })
    f.peer.catalogue.mockResolvedValue([
      { id: 'whatsapp', name: 'WhatsApp', installed: false, state: 'Unavailable' },
    ])
    expect(await f.controller.catalogue(true)).toMatchObject([
      { id: 'whatsapp', installed: true, state: 'Unavailable' },
    ])
  },
)

// Catalogue compatibility must not revoke management of an authenticated installation.
describe.skipIf(process.platform === 'win32')(
  'installed plugins outside the compatible catalogue',
  () => {
    it.each(['0.0.0', '0.1.6', '1.0.0'])(
      'keeps Configure and uninstall when no v2 release admits app %s',
      async (appVersion) => {
        const f = await setup()
        const legacy = repoListFor(f.pkg.release)
        const future = {
          format: 2,
          entries: legacy.entries.map((entry) => ({
            ...entry,
            authors: ['brocrew'],
            minAppVersion: '2.0.0',
          })),
        }
        f.fetch.mockImplementation(async (url) => {
          expect([PLUGIN_LIST_URL, PLUGIN_LIST_V2_URL]).toContain(String(url))
          return new Response(JSON.stringify(String(url) === PLUGIN_LIST_V2_URL ? future : legacy))
        })
        Object.assign(f.supervisor, { supports: () => true })
        f.peer.catalogue.mockResolvedValue([
          {
            id: f.pkg.release.id,
            name: 'Fictional Cedar',
            installed: true,
            installedVersion: f.pkg.release.version,
            state: 'Running',
            updateVersion: '2.0.0',
          },
        ])
        f.peer.screen.mockResolvedValue({ fictional: 'configuration' })
        const ownerUpdate = vi.fn(async () => {})
        Object.assign(f.peer, { update: ownerUpdate })
        f.controller.start({ ...f.options, appVersion })
        await f.controller.ready!()
        const cards = await f.controller.catalogue(true)
        expect(cards).toMatchObject([
          {
            id: f.pkg.release.id,
            installed: true,
            installedVersion: f.pkg.release.version,
            state: 'Running',
            updatesUnavailable: true,
          },
        ])
        expect(cards[0]).not.toHaveProperty('updateVersion')
        expect(await f.controller.screen(f.pkg.release.id)).toEqual({ fictional: 'configuration' })
        await expect(f.controller.install(f.pkg.release.id)).rejects.toThrow()
        await expect(f.controller.update!(f.pkg.release.id)).rejects.toThrow()
        expect(f.peer.install).not.toHaveBeenCalled()
        await f.controller.uninstall(f.pkg.release.id)
        expect(f.peer.uninstall).toHaveBeenCalledOnce()
      },
    )
    it('does not turn a future-only catalogue into available installation cards', async () => {
      const f = await setup()
      const legacy = repoListFor(f.pkg.release)
      f.fetch.mockImplementation(
        async (url) =>
          new Response(
            JSON.stringify(
              String(url) === PLUGIN_LIST_V2_URL
                ? {
                    format: 2,
                    entries: legacy.entries.map((entry) => ({
                      ...entry,
                      authors: ['brocrew'],
                      minAppVersion: '2.0.0',
                    })),
                  }
                : legacy,
            ),
          ),
      )
      Object.assign(f.supervisor, { supports: () => true })
      f.peer.catalogue.mockResolvedValue([])
      f.controller.start(f.options)
      await f.controller.ready!()
      expect(await f.controller.catalogue(true)).toEqual([])
      expect(f.peer.install).not.toHaveBeenCalled()
      expect(f.peer.screen).not.toHaveBeenCalled()
    })
    it('refuses an unexpected uninstalled owner card instead of offering it', async () => {
      const f = await setup()
      f.peer.catalogue.mockResolvedValue([
        { id: 'fictional-cedar', name: 'Fictional Cedar', installed: false, state: 'Available' },
      ])
      f.controller.start(f.options)
      await f.controller.ready!()
      const cards = await f.controller.catalogue()
      expect(cards.some((card) => card.id === 'fictional-cedar')).toBe(false)
      expect(cards.every((card) => card.state === 'Unavailable')).toBe(true)
    })
  },
)

it.skipIf(process.platform === 'win32')(
  'an unavailable compatible card retains its catalogue display name',
  async () => {
    const f = await setup()
    f.fetch.mockImplementation(
      async () => new Response(JSON.stringify(repoListFor(f.pkg.release, 'Fictional Cedar'))),
    )
    f.peer.catalogue.mockResolvedValue([
      { id: f.pkg.release.id, name: f.pkg.release.id, installed: false, state: 'Unavailable' },
    ])
    f.controller.start(f.options)
    await f.controller.ready!()
    expect(await f.controller.catalogue()).toMatchObject([
      { id: f.pkg.release.id, name: 'Fictional Cedar', state: 'Unavailable' },
    ])
  },
)
it.skipIf(process.platform === 'win32')(
  'an existing empty installation store does not start an owner for an empty offer list',
  async () => {
    const f = await setup()
    await mkdir(f.options.root, { mode: 0o700 })
    const state = GlobalPluginState.create({
      root: join(f.options.root, 'state'),
      workspaceRoots: [f.options.workspaceRoot],
    })
    state.close()
    f.fetch.mockImplementation(async () => new Response(JSON.stringify({ format: 1, entries: [] })))
    f.controller.start(f.options)
    await f.controller.ready!()
    expect(f.supervisor.start).not.toHaveBeenCalled()
    expect(seams.connect).not.toHaveBeenCalled()
    expect(readPluginInstructions(f.controller)).toEqual([])
    await expect(f.controller.install('fictional-cedar')).rejects.toThrow()
    expect(f.peer.install).not.toHaveBeenCalled()
  },
)

it.skipIf(process.platform === 'win32')(
  'an installed card with an admitted release has no unavailable-update reason',
  async () => {
    const f = await setup()
    f.peer.catalogue.mockResolvedValue([
      { id: f.pkg.release.id, name: 'Fictional Cedar', installed: true, state: 'Running' },
    ])
    f.controller.start(f.options)
    await f.controller.ready!()
    const [card] = await f.controller.catalogue()
    expect(card).toMatchObject({ installed: true, state: 'Running' })
    expect(card).not.toHaveProperty('updatesUnavailable')
  },
)
