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
  async function remove(token = adminToken, confirm = 'fern') {
    const response = await fetch(url + '/v1/profiles/fern/delete', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm }),
    })
    return { status: response.status, body: await response.json() }
  }
  return { store, browser, directory, remove, mcpToken }
}
it('only the person endpoint can remove a confirmed closed profile and its real fixture files', async () => {
  const f = await boot()
  expect((await f.remove(f.mcpToken)).status).toBe(401)
  expect((await f.remove(undefined, 'birch')).status).toBe(400)
  expect(fs.existsSync(join(f.directory, 'Cookies'))).toBe(true)
  expect(await f.remove()).toEqual({ status: 200, body: { deleted: 'fern' } })
  expect(fs.existsSync(f.directory)).toBe(false)
  expect(f.store.get('fern')).toBeUndefined()
})
it('refuses an open profile without closing its tabs or deleting data', async () => {
  const f = await boot()
  await f.browser.ensure('fern', 'visible')
  await f.browser.newPage('fern')
  const reply = await f.remove()
  expect(reply.status).toBe(409)
  expect(reply.body.error).toBe(
    'Turn this profile off and wait for agent work to finish, then try again.',
  )
  expect(f.browser.closes).toEqual([])
  expect(f.browser.pages.get('fern')).toHaveLength(1)
  expect(fs.existsSync(join(f.directory, 'Cookies'))).toBe(true)
})
it('refuses an in-flight agent operation and permits deletion after it ends', async () => {
  const f = await boot()
  let end!: () => void
  const work = f.browser.operate(
    'fern',
    () =>
      new Promise<void>((resolve) => {
        end = resolve
      }),
  )
  expect((await f.remove()).status).toBe(409)
  expect(fs.existsSync(f.directory)).toBe(true)
  end()
  await work
  expect((await f.remove()).status).toBe(200)
  expect(fs.existsSync(f.directory)).toBe(false)
})
it('a partial removal leaves the same profile disabled and reserved until a successful retry', async () => {
  const f = await boot()
  f.store.setFlags('fern', { enabled: true })
  fs.writeFileSync(join(f.directory, 'Login Data'), 'fictional sign-in')
  const remove = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
    fs.unlinkSync(join(f.directory, 'Cookies'))
    throw Object.assign(new Error('fictional busy file'), { code: 'EBUSY' })
  })
  expect((await f.remove()).status).toBe(409)
  expect(f.store.get('fern')?.enabled).toBe(false)
  expect(fs.existsSync(join(f.directory, 'Login Data'))).toBe(true)
  expect(() => f.store.create('fern', 'panel')).toThrow('already exists')
  remove.mockRestore()
  expect((await f.remove()).status).toBe(200)
  expect(f.store.get('fern')).toBeUndefined()
  expect(fs.existsSync(f.directory)).toBe(false)
})
it('does not remove any data when turning the profile off fails', async () => {
  const f = await boot()
  f.store.setFlags('fern', { enabled: true })
  const disable = vi.spyOn(f.store, 'setFlags').mockImplementationOnce(() => {
    throw new Error('fictional write failure')
  })
  expect((await f.remove()).status).toBe(409)
  expect(disable).toHaveBeenCalledWith('fern', { enabled: false })
  expect(f.store.get('fern')?.enabled).toBe(true)
  expect(fs.existsSync(join(f.directory, 'Cookies'))).toBe(true)
  disable.mockRestore()
  expect((await f.remove()).status).toBe(200)
})
it('the existing agent delete tool still refuses a person’s ordinary profile', async () => {
  const f = harness()
  cleanup.push(() => {
    for (const directory of [f.home, dirname(f.downloads), f.uploadRoot])
      fs.rmSync(directory, { recursive: true, force: true })
  })
  f.profile('fern')
  const directory = f.store.dirOf('fern')
  expect(await f.callError('delete_browser_profile', { profile: 'fern' })).toContain(
    'only the user can delete it',
  )
  expect(f.store.get('fern')).toBeDefined()
  expect(fs.existsSync(directory)).toBe(true)
})
