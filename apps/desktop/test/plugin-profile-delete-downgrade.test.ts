import { afterEach, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import fs, { existsSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginProfileLedger } from '../src/main/plugins/lifecycle/profile-ledger'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginProfileLedger as OlderLedger } from './fixtures/plugin-delete-parent/profile-ledger'
import { ChromeProposal as OlderProposal } from './fixtures/plugin-delete-parent/chrome-apply'
import source from './fixtures/plugin-delete-parent/source.json'
import { PluginLifecycleController as OlderController } from './fixtures/plugin-delete-parent/controller'
import {
  fixture,
  projection,
  cleanupLifecycleFixtures,
  reopenLifecycleFixture,
} from './plugin-lifecycle-fixtures'
// Load the real package at runtime: its source is typechecked by the package's own project,
// rather than importing its browser libraries into the host's Node-only compiler project.
import {
  profileFixtureDeps,
  type TestProfiles,
} from '../../../plugins/chrome/test/host-test-fixture'
const { createProfileStore } = await vi.importActual<{
  createProfileStore(options: { home: string }): TestProfiles
}>('../../../plugins/chrome/src/profiles/store')
const { registerAdminRoutes } = await vi.importActual<{
  registerAdminRoutes(app: unknown, deps: unknown): void
}>('../../../plugins/chrome/src/http/adminRoutes')
const { TabRegistry } = await vi.importActual<{
  TabRegistry: new () => unknown
}>('../../../plugins/chrome/src/tabs')
const { silentLogger } = await vi.importActual<{ silentLogger: unknown }>(
  '../../../plugins/chrome/src/logger',
)
const { FakeBrowser } = await vi.importActual<{
  FakeBrowser: new (dirOf: (name: string) => string) => unknown
}>('../../../plugins/chrome/test/fakes')

const closers: Array<() => unknown | Promise<unknown>> = []
afterEach(async () => {
  try {
    for (const close of closers.splice(0).reverse()) await close()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await cleanupLifecycleFixtures()
  }
})
const snapshot = fileURLToPath(new URL('./fixtures/plugin-delete-parent/', import.meta.url))
it.each(source.files)('pins the actual pre-delete reader source $path', async (file) => {
  const adapted = await readFile(join(snapshot, file.file), 'utf8')
  const imports = new Map<string, string>(Object.entries(file.imports))
  const original = adapted.replace(/from '(\.[^']+)'/g, (_, spec: string) => {
    expect(imports.has(spec)).toBe(true)
    return `from '${imports.get(spec)}'`
  })
  expect(createHash('sha256').update(original).digest('hex')).toBe(file.sourceSha256)
})
it('the shared ledger refuses a destructive proposal if adapter projection is bypassed', async () => {
  const f = await fixture()
  const ledger = new PluginProfileLedger(f.root)
  const installId = randomUUID()
  await expect(
    ledger.reserve(installId, 0, { action: 'delete-profile', profile: 'fern', confirm: 'fern' }),
  ).rejects.toThrow()
  expect(await ledger.revision(installId)).toBe(0)
})
type Reply = { status(code: number): Reply; json(value: unknown): void }
type Handler = (request: { params: { name: string }; body: unknown }, reply: Reply) => unknown

it.each(['success', 'lost-reply', 'partial-removal'] as const)(
  'the old owner can configure after a deletion attempt: %s',
  async (outcome) => {
    expect(
      OlderProposal.safeParse({ action: 'delete-profile', profile: 'fern', confirm: 'fern' })
        .success,
    ).toBe(false)
    const f = await fixture()
    const start = f.opts.runtime.start
    f.opts.runtime.start = async (spec) => {
      const run = await start(spec)
      let finish!: () => void
      const exited = new Promise<void>((resolve) => {
        finish = resolve
      })
      return {
        ...run,
        exited,
        async stop() {
          await run.stop()
          finish()
        },
      }
    }
    closers.push(() => f.controller.drain())
    await f.controller.install(f.handle, 'chrome')
    const installation = f.state.exportActivation().entries[0]!
    const home = join(f.root, 'data', 'chrome')
    await mkdir(home, { recursive: true, mode: 0o700 })
    const profiles = createProfileStore({ home })
    profiles.create('fern', 'panel')
    profiles.create('birch', 'panel')
    profiles.setFlags('fern', { enabled: true })
    const removedDirectory = profiles.dirOf('fern')
    const partial = outcome === 'partial-removal'
    if (partial)
      vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
        fs.unlinkSync(join(removedDirectory, 'Cookies'))
        throw Object.assign(new Error('fictional busy file'), { code: 'EBUSY' })
      })
    writeFileSync(join(removedDirectory, 'Cookies'), 'fictional sign-in data')
    writeFileSync(join(removedDirectory, 'Login Data'), 'fictional remaining data')
    const browser = new FakeBrowser(profiles.dirOf)
    const routes = new Map<string, Handler>()
    const reads = new Map<string, Handler>()
    registerAdminRoutes(
      {
        use() {},
        get(path: string, handler: Handler) {
          reads.set(path, handler)
        },
        post(path: string, handler: Handler) {
          routes.set(path, handler)
        },
      } as never,
      profileFixtureDeps(profiles, browser, new TabRegistry(), silentLogger),
    )
    let deletes = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit) => {
        const path = new URL(input, 'http://127.0.0.1').pathname
        let status = 0,
          body: unknown
        const reply: Reply = {
          status(value) {
            status = value
            return reply
          },
          json(value) {
            body = value
          },
        }
        if (path === '/profiles' || path === '/tabs') {
          await reads.get('/v1' + path)!({ params: { name: '' }, body: {} }, reply)
          return Response.json(body, { status })
        }
        const match = /^\/profiles\/(fern|birch)\/(delete|flags)$/.exec(path)
        expect(match).not.toBeNull()
        await routes.get('/v1/profiles/:name/' + match![2])!(
          { params: { name: match![1]! }, body: JSON.parse(String(init.body)) },
          reply,
        )
        if (match![2] === 'delete') {
          deletes++
          expect(status).toBe(partial && deletes === 1 ? 409 : 200)
          if (outcome === 'lost-reply') throw new Error('fictional reply lost after removal')
        }
        return Response.json(body, { status })
      }),
    )
    const request = {
      pluginId: 'chrome',
      installId: installation.installId,
      incarnation: installation.incarnation,
      revision: 0,
      proposal: { action: 'delete-profile', profile: 'fern', confirm: 'fern' },
    }
    const result = f.controller.applyProfile(f.handle, request)
    if (outcome !== 'success') await expect(result).rejects.toThrow()
    else await result
    if (partial) {
      expect(profiles.get('fern')?.enabled).toBe(false)
      expect(existsSync(join(removedDirectory, 'Login Data'))).toBe(true)
      expect(() => profiles.create('fern', 'panel')).toThrow()
    } else {
      expect(profiles.get('fern')).toBeUndefined()
      expect(existsSync(removedDirectory)).toBe(false)
    }
    await expect(f.controller.applyProfile(f.handle, request)).rejects.toThrow()
    expect(deletes).toBe(1)
    expect(await new PluginProfileLedger(f.root).revision(installation.installId)).toBe(1)
    expect(await new OlderLedger(f.root).revision(installation.installId)).toBe(1)
    await f.controller.drain()
    const ledger = join(
      f.root,
      'profile-apply',
      createHash('sha256').update(installation.installId).digest('hex'),
      'intents',
    )
    const entries = await Promise.all(
      (await readdir(ledger)).map(async (name) =>
        JSON.parse(await readFile(join(ledger, name), 'utf8')),
      ),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].proposal).toEqual({ action: 'set-enabled', profile: 'fern', enabled: false })
    expect(JSON.stringify(entries)).not.toContain('delete-profile')
    expect(JSON.stringify(entries)).not.toContain('confirm')
    const state = reopenLifecycleFixture(f)
    closers.push(() => state.close())
    const older = await OlderController.open({ ...f.opts, state: state as never })
    closers.push(() => older.drain())
    try {
      const handle = await older.attach(projection().sink)
      expect((await older.status()).cards.find((card) => card.id === 'chrome')?.state).toBe(
        'Running',
      )
      const screen = older.screen(handle, 'chrome')
      const connection = await screen.connection
      if (partial) {
        const snapshot = await (
          await import('../src/main/plugins/lifecycle/chrome-read')
        ).readChromeConfiguration('chrome', connection, new AbortController().signal)
        expect(
          (snapshot as { profiles: Array<{ name: string; enabled: boolean }> }).profiles.find(
            (profile) => profile.name === 'fern',
          )?.enabled,
        ).toBe(false)
      }
      expect(await older.profileRevision(handle, 'chrome', installation.installId)).toBe(1)
      await older.applyProfile(handle, {
        ...request,
        revision: 1,
        proposal: { action: 'set-enabled', profile: 'birch', enabled: true },
      })
      expect(profiles.get('birch')?.enabled).toBe(true)
      expect(await new OlderLedger(f.root).revision(installation.installId)).toBe(2)
      expect(deletes).toBe(1)
    } finally {
      await older.drain()
      state.close()
    }
    if (partial) {
      const resumedState = GlobalPluginState.open({
        root: join(f.root, 'state'),
        workspaceRoots: [f.workspace],
      })
      closers.push(() => resumedState.close())
      const resumed = await PluginLifecycleController.open({ ...f.opts, state: resumedState })
      closers.push(() => resumed.drain())
      const handle = await resumed.attach(projection().sink)
      await resumed.applyProfile(handle, { ...request, revision: 2 })
      expect(profiles.get('fern')).toBeUndefined()
      expect(existsSync(removedDirectory)).toBe(false)
      expect(deletes).toBe(2)
      expect(await new OlderLedger(f.root).revision(installation.installId)).toBe(3)
    }
  },
)
