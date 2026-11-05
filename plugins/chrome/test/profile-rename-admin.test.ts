import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startAgentChrome } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createProfileStore } from '../src/profiles/store.js'
import { silentLogger } from '../src/logger.js'
import { FakeBrowser, harness } from './fakes.js'
import {
  bootstrapEnv,
  connectPackage,
  personMetadata,
  resultJson,
  resultText,
} from './ordinary-package-fixture.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
async function boot() {
  const home = fs.mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-person-delete-'),
  )
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }))
  const config = loadConfig(bootstrapEnv(home))
  const store = createProfileStore({ home })
  const browser = new FakeBrowser(store.dirOf)
  const server = await startAgentChrome(config, { store, browser, logger: silentLogger })
  cleanup.push(() => server.close())
  store.create('fern', 'panel')
  const directory = store.dirOf('fern')
  fs.writeFileSync(join(directory, 'Cookies'), 'fictional cookies')
  const url = 'http://127.0.0.1:' + (server.httpServer.address() as { port: number }).port
  const client = await connectPackage(url, config.token)
  cleanup.push(() => client.close())
  async function rename(metadata = personMetadata, newName = 'Fern account') {
    return await client.callTool({
      name: 'configure_profile',
      arguments: { profile: 'fern', action: 'rename-profile', newName },
      _meta: metadata,
    })
  }
  return {
    store,
    browser,
    directory,
    rename,
    client,
    agentMetadata: { ...personMetadata, origin: 'agent' },
    server,
  }
}
it('rename Configure action is person-only and tool lists show the new display name on the next call', async () => {
  const f = await boot()
  const before = f.store.get('fern')
  expect((await f.rename(f.agentMetadata)).isError).toBe(true)
  expect((await f.rename({} as typeof personMetadata)).isError).toBe(true)
  expect(f.store.get('fern')).toEqual(before)
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
  const renamed = await f.rename()
  expect(renamed.isError).not.toBe(true)
  expect(resultJson(renamed)).toEqual({ profile: 'fern', completed: true })
  expect(f.store.get('fern')?.displayName).toBe('Fern account')
  expect(f.store.dirOf('fern')).toBe(f.directory)
  const discovered = await f.client.callTool({ name: 'configuration_snapshot', arguments: {} })
  expect(discovered.isError).not.toBe(true)
  expect(resultJson(discovered).profiles).toContainEqual(
    expect.objectContaining({ name: 'fern', displayName: 'Fern account' }),
  )
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
  const tool = harness()
  cleanup.push(() => {
    for (const dir of [tool.home, dirname(tool.downloads), tool.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  })
  tool.profile('cedar')
  tool.store.rename('cedar', 'Cedar account')
  expect((await tool.call('list_browser_profiles', { profile: 'cedar' })).json).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'cedar', displayName: 'Cedar account' }),
    ]),
  )
  expect(await tool.callError('rename-profile', {})).toBe('no tool rename-profile')
})
it('rename Configure action returns the approved fixed invalid/duplicate errors', async () => {
  const f = await boot()
  f.store.create('cedar', 'panel')
  const before = f.store.list()
  const invalid = await f.rename(undefined, ' ')
  expect(invalid.isError).toBe(true)
  expect(resultText(invalid)).toBe('Profile name must be 1–60 characters.')
  expect(f.store.list()).toEqual(before)
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
  const duplicate = await f.rename(undefined, 'CEDAR')
  expect(duplicate.isError).toBe(true)
  expect(resultText(duplicate)).toBe('Another profile already uses that name.')
  expect(f.store.list()).toEqual(before)
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
})
