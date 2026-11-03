import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startAgentChrome } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createProfileStore } from '../src/profiles/store.js'
import { silentLogger } from '../src/logger.js'
import { FakeBrowser, harness } from './fakes.js'

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
  const mcpToken = 'fictional-mcp-'.repeat(8),
    adminToken = 'fictional-person-'.repeat(8)
  const authPath = join(home, 'fictional-auth.json')
  fs.writeFileSync(authPath, JSON.stringify({ mcpToken, adminToken }), { mode: 0o600 })
  const config = loadConfig({ BROCREW_CHROME_DATA: home, BROCREW_CHROME_AUTH: authPath })
  const store = createProfileStore({ home })
  const browser = new FakeBrowser(store.dirOf)
  const server = await startAgentChrome(config, { store, browser, logger: silentLogger })
  cleanup.push(() => server.close())
  store.create('fern', 'panel')
  const directory = store.dirOf('fern')
  fs.writeFileSync(join(directory, 'Cookies'), 'fictional cookies')
  const url = 'http://127.0.0.1:' + (server.httpServer.address() as { port: number }).port
  async function rename(token = adminToken, newName = 'Fern account') {
    const response = await fetch(url + '/v1/profiles/fern/rename', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ newName }),
    })
    return { status: response.status, body: await response.json() }
  }
  return { store, browser, directory, rename, mcpToken, server }
}
it('rename endpoint is person-only and tool lists show the new display name on the next call', async () => {
  const f = await boot()
  expect((await f.rename(f.mcpToken)).status).toBe(401)
  expect(await f.rename()).toMatchObject({
    status: 200,
    body: { profile: { name: 'fern', displayName: 'Fern account' } },
  })
  expect(f.store.get('fern')?.displayName).toBe('Fern account')
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
  const tool = harness()
  cleanup.push(() => {
    for (const dir of [tool.home, dirname(tool.downloads), tool.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  })
  tool.profile('cedar')
  tool.store.rename('cedar', 'Cedar account')
  expect((await tool.call('list_browser_profiles')).json).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'cedar', displayName: 'Cedar account' }),
    ]),
  )
  expect(await tool.callError('rename-profile', {})).toBe('no tool rename-profile')
})
it('rename endpoint returns the approved fixed invalid/duplicate errors', async () => {
  const f = await boot()
  f.store.create('cedar', 'panel')
  expect(await f.rename(undefined, ' ')).toMatchObject({
    status: 400,
    body: { error: 'Profile name must be 1–60 characters.' },
  })
  expect(await f.rename(undefined, 'CEDAR')).toMatchObject({
    status: 409,
    body: { error: 'Another profile already uses that name.' },
  })
})
