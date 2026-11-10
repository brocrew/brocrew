import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { harness } from './fakes.js'
import { personProfile } from './person-profile-fixture.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
async function boot() {
  const { store, browser, directory, url, adminToken, mcpToken } = await personProfile(cleanup)
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
