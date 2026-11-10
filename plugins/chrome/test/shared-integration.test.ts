import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { sharedProfilesRelease, sharedProfilesReleased } from '../src/sharedProfilesRelease.js'
import { createConfiguredProfileStore } from '../src/index.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { startAgentChrome } from '../src/app.js'
import { silentLogger } from '../src/logger.js'
import { FakeBrowser } from './fakes.js'
import { createAgentChromeTools } from '../src/tools/index.js'
import { createKeyedSerializer } from '../src/shared/browser/browser-lease.js'
import { createWindowTasks } from '../src/windows.js'
import { TabRegistry } from '../src/tabs.js'
const clean: Array<() => unknown> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const c of clean.splice(0).reverse()) await c()
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-shared-ui-'))
  clean.push(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'local')
  const shared = path.join(root, 'shared')
  fs.mkdirSync(home)
  fs.mkdirSync(shared)
  const auth = path.join(root, 'auth.json')
  fs.writeFileSync(auth, JSON.stringify({ mcpToken: 'm'.repeat(64), adminToken: 'a'.repeat(64) }), {
    mode: 0o600,
  })
  const env = {
    BROCREW_CHROME_DATA: home,
    BROCREW_CHROME_AUTH: auth,
    BROCREW_CHROME_SHARED: shared,
    BROCREW_PLUGIN_OWNER_ID: '11111111-1111-4111-8111-111111111111',
    BROCREW_PLUGIN_OWNER_LABEL: 'Alpha',
  }
  const config = loadConfig(env)
  const store = createSharedProfileStore({
    home,
    shared,
    workspaceId: env.BROCREW_PLUGIN_OWNER_ID,
    workspaceLabel: 'Alpha',
    chromeState: () => 'ended',
  })
  const browser = new FakeBrowser(store.dirOf)
  return { root, home, shared, env, config, store, browser }
}
it('config uses only supplied capability, binds workspace identity and keeps files/downloads local', () => {
  const f = fixture()
  const released = sharedProfilesReleased(process.platform, sharedProfilesRelease)
  if (released)
    expect(f.config.shared).toEqual({
      root: f.shared,
      workspaceId: f.env.BROCREW_PLUGIN_OWNER_ID,
      workspaceLabel: 'Alpha',
      migrationApproved: true,
    })
  else expect(f.config.shared).toBeUndefined()
  expect(f.config.downloadsRoot.startsWith(f.home + path.sep)).toBe(true)
  expect(f.config.workspace.startsWith(f.home + path.sep)).toBe(true)
  const localEnv: Record<string, string | undefined> = {
    ...f.env,
    BROCREW_CHROME_SHARED: undefined,
  }
  expect(loadConfig(localEnv).shared).toBeUndefined()
  expect(createConfiguredProfileStore(loadConfig(localEnv)).shared).toBeUndefined()
  for (const id of ['', '../beta', 'space id']) {
    if (released)
      expect(() => loadConfig({ ...f.env, BROCREW_PLUGIN_OWNER_ID: id })).toThrow('identity')
    else expect(loadConfig({ ...f.env, BROCREW_PLUGIN_OWNER_ID: id }).shared).toBeUndefined()
  }
  expect(loadConfig({ ...f.env, BROCREW_CHROME_MIGRATION_QUALIFICATION: '{}' }).shared).toEqual(
    f.config.shared,
  )
})
it('fresh admin warning binds the immutable identity/revision; agent bearer cannot delete', async () => {
  const f = fixture()
  const server = await startAgentChrome(f.config, {
    store: f.store,
    browser: f.browser,
    logger: silentLogger,
  })
  clean.push(() => server.close())
  f.store.create('fern', 'panel')
  const url = `http://127.0.0.1:${(server.httpServer.address() as { port: number }).port}/v1/profiles`
  const read = async () =>
    (await (await fetch(url, { headers: { authorization: 'Bearer ' + 'a'.repeat(64) } })).json())
      .profiles[0]
  const remove = async (confirmation?: string, token = 'a'.repeat(64)) =>
    fetch(url + '/fern/delete', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'fern', deleteConfirmation: confirmation }),
    })
  const original = await read()
  expect(original).toMatchObject({ shared: true, onIn: ['Alpha'], status: 'ready' })
  expect((await remove(original.deleteConfirmation, 'm'.repeat(64))).status).toBe(401)
  expect((await remove()).status).toBe(409)
  // A workspace flag change makes the confirmation already shown stale.
  f.store.setFlags('fern', { enabled: true })
  expect((await remove(original.deleteConfirmation)).status).toBe(409)
  const lease = f.store.shared.acquire('fern')
  expect((await remove((await read()).deleteConfirmation)).status).toBe(409)
  lease.release()
  expect((await remove((await read()).deleteConfirmation)).status).toBe(200)
})
it('shared tool listing hides off profiles while Settings can still list them', async () => {
  const f = fixture()
  f.store.create('fern', 'panel')
  f.store.setFlags('fern', { enabled: false })
  const tabs = new TabRegistry()
  const tools = createAgentChromeTools({
    store: f.store,
    browser: f.browser,
    tabs,
    windows: createWindowTasks({ browser: f.browser }),
    serializer: createKeyedSerializer(),
    guard: () => ({ roots: [f.config.workspace], hostHome: '', mount: '', maxBytes: 1000 }),
    downloadsRoot: f.config.downloadsRoot,
  })
  const result = await tools
    .find((t) => t.definition.name === 'list_browser_profiles')!
    .execute({}, {})
  expect(JSON.stringify(result)).not.toContain('fern')
  expect(f.store.list()).toHaveLength(1)
})

it('set_setting refuses a foreign owner and keeps the reservation through atomic Preferences publication', async () => {
  const f = fixture()
  f.store.create('fern', 'panel')
  f.store.setFlags('fern', { allowSettings: true })
  const home = path.join(f.root, 'beta')
  fs.mkdirSync(home)
  const other = createSharedProfileStore({
    home,
    shared: f.shared,
    workspaceId: 'beta',
    workspaceLabel: 'QA Beta',
    chromeState: () => 'ended',
  })
  other.setFlags('fern', { enabled: true })
  const browser = new FakeBrowser(other.dirOf)
  const tools = createAgentChromeTools({
    store: other,
    browser,
    tabs: new TabRegistry(),
    windows: createWindowTasks({ browser }),
    serializer: createKeyedSerializer(),
    guard: () => ({ roots: [home], hostHome: '', mount: '', maxBytes: 1000 }),
    downloadsRoot: home,
  })
  const setting = tools.find((t) => t.definition.name === 'set_setting')!
  const preferences = path.join(f.store.dirOf('fern'), 'Default', 'Preferences')
  fs.mkdirSync(path.dirname(preferences))
  fs.writeFileSync(preferences, JSON.stringify({ translate: { enabled: true } }))
  const lease = f.store.shared.acquire('fern')
  await expect(
    setting.execute({ profile: 'fern', key: 'translate.enabled', value: false }, {}),
  ).rejects.toThrow('in use')
  expect(JSON.parse(fs.readFileSync(preferences, 'utf8')).translate.enabled).toBe(true)
  lease.release()
  const rename = fs.renameSync
  let observed = false
  vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (destination === preferences) {
      observed = true
      expect(() => f.store.shared.acquire('fern')).toThrow(/use/)
    }
    return rename(source, destination)
  })
  const result = await setting.execute(
    { profile: 'fern', key: 'translate.enabled', value: false },
    {},
  )
  expect(result).toMatchObject({ content: [{ type: 'text' }] })
  expect(observed).toBe(true)
  expect(JSON.parse(fs.readFileSync(preferences, 'utf8')).translate.enabled).toBe(false)
  f.store.shared.acquire('fern').release()
})
