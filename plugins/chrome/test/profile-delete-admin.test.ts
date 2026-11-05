import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ProfileInUseError } from '../src/browser/profileBrowser.js'
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
  async function remove(metadata = personMetadata, confirm = 'fern') {
    return await client.callTool({
      name: 'configure_profile',
      arguments: { profile: 'fern', action: 'delete-profile', confirm },
      _meta: metadata,
    })
  }
  return {
    store,
    browser,
    directory,
    remove,
    agentMetadata: { ...personMetadata, origin: 'agent' },
    server,
    client,
  }
}
it('only person-origin Configure can remove a confirmed closed profile and its real fixture files', async () => {
  const f = await boot()
  expect((await f.remove(f.agentMetadata)).isError).toBe(true)
  expect((await f.remove({} as typeof personMetadata)).isError).toBe(true)
  expect(f.store.get('fern')).toBeDefined()
  expect(f.browser.closes).toEqual([])
  expect((await f.remove(undefined, 'birch')).isError).toBe(true)
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
  const removed = await f.remove()
  expect(removed.isError).not.toBe(true)
  expect(resultJson(removed)).toEqual({ profile: 'fern', completed: true })
  expect(fs.existsSync(f.directory)).toBe(false)
  expect(f.store.get('fern')).toBeUndefined()
})
it('refuses an open profile without closing its tabs or deleting data', async () => {
  const f = await boot()
  await f.browser.ensure('fern', 'visible')
  await f.browser.newPage('fern')
  const reply = await f.remove()
  expect(reply.isError).toBe(true)
  expect(resultText(reply)).toBe(
    'Turn this profile off and wait for agent work to finish, then try again.',
  )
  expect(f.browser.closes).toEqual([])
  expect(f.browser.pages.get('fern')).toHaveLength(1)
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
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
  const refused = await f.remove()
  expect(refused.isError).toBe(true)
  expect(resultText(refused)).toBe(
    'Turn this profile off and wait for agent work to finish, then try again.',
  )
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
  expect(f.browser.closes).toEqual([])
  expect(fs.existsSync(f.directory)).toBe(true)
  end()
  await work
  expect((await f.remove()).isError).not.toBe(true)
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
  expect((await f.remove()).isError).toBe(true)
  expect(f.store.get('fern')?.enabled).toBe(false)
  expect(fs.readFileSync(join(f.directory, 'Login Data'), 'utf8')).toBe('fictional sign-in')
  expect(f.store.get('fern')?.deleting).toBe(true)
  expect(() => f.store.create('fern', 'panel')).toThrow('already exists')
  remove.mockRestore()
  expect((await f.remove()).isError).not.toBe(true)
  expect(f.store.get('fern')).toBeUndefined()
  expect(fs.existsSync(f.directory)).toBe(false)
})
it('does not remove any data when turning the profile off fails', async () => {
  const f = await boot()
  f.store.setFlags('fern', { enabled: true })
  const rm = vi.spyOn(fs, 'rmSync')
  const disable = vi.spyOn(f.store, 'setFlags').mockImplementationOnce(() => {
    throw new Error('fictional write failure')
  })
  expect((await f.remove()).isError).toBe(true)
  expect(disable).toHaveBeenCalledWith('fern', { enabled: false })
  expect(f.store.get('fern')?.enabled).toBe(true)
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
  expect(rm).not.toHaveBeenCalled()
  disable.mockRestore()
  expect((await f.remove()).isError).not.toBe(true)
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

it('only delete-profile exposes the fixed known busy remedy; other errors stay private', async () => {
  const f = await boot()
  f.store.setFlags('fern', { enabled: true })
  vi.spyOn(f.browser, 'turnHelperOn').mockRejectedValueOnce(new ProfileInUseError())
  const helper = await f.client.callTool({
    name: 'configure_profile',
    arguments: { profile: 'fern', action: 'helper-on' },
    _meta: personMetadata,
  })
  expect(helper.isError).toBe(true)
  expect(resultText(helper)).toBe('Plugin unavailable. Try again.')
  vi.spyOn(f.browser, 'removeWhenIdle').mockRejectedValueOnce(
    new Error('fictional private failure'),
  )
  const deletion = await f.remove()
  expect(deletion.isError).toBe(true)
  expect(resultText(deletion)).toBe('Plugin unavailable. Try again.')
  expect(fs.readFileSync(join(f.directory, 'Cookies'), 'utf8')).toBe('fictional cookies')
  expect(f.store.get('fern')).toBeDefined()
  expect(f.browser.closes).toEqual([])
})
