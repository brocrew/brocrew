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
  const { store, browser, directory, url, adminToken, mcpToken, server } =
    await personProfile(cleanup)
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
