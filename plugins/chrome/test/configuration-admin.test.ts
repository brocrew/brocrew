import { afterEach, expect, it, vi } from 'vitest'
import { personProfile } from './person-profile-fixture.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function boot() {
  const f = await personProfile(cleanup)
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(f.url + '/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + f.adminToken, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }
  return {
    ...f,
    request,
    apply: (payload: unknown) => request('/configuration', { payload, configRevision: 0 }),
  }
}
it('serves the package snapshot and applies profile commands through the same stored profiles', async () => {
  const f = await boot()
  const apply = async (action: string, fields = {}) =>
    expect(await f.apply({ action, profile: 'cedar', ...fields })).toEqual({
      status: 200,
      body: { applied: true },
    })
  await apply('create-profile')
  await apply('set-enabled', { enabled: true })
  await apply('set-flags', { allowSync: true, allowSettings: true })
  await apply('rename-profile', { newName: 'Cedar account' })
  await apply('set-description', { description: 'Work account' })
  await apply('helper-on')
  await apply('open-window')
  expect(f.browser.helperTurnedOn).toContain('cedar')
  expect(await f.request('/configuration')).toMatchObject({
    status: 200,
    body: {
      profiles: expect.arrayContaining([
        expect.objectContaining({
          name: 'cedar',
          displayName: 'Cedar account',
          enabled: true,
          allowSync: true,
          allowSettings: true,
          description: 'Work account',
          open: true,
        }),
      ]),
      tabs: expect.any(Array),
    },
  })
  await apply('set-enabled', { enabled: false })
  await apply('delete-profile', { confirm: 'cedar' })
  expect(f.store.get('cedar')).toBeUndefined()
})
it('keeps preceding-app routes and their status codes usable', async () => {
  const f = await boot()
  expect((await f.request('/profiles', { name: 'cedar' })).status).toBe(201)
  expect((await f.request('/profiles/cedar/open', {})).status).toBe(202)
  expect((await f.request('/tabs')).body).toHaveProperty('tabs')
  expect((await f.request('/profiles')).body).toMatchObject({
    profiles: expect.arrayContaining([expect.objectContaining({ name: 'cedar', open: true })]),
  })
})
it('validates package commands and preserves domain failure replies', async () => {
  const f = await boot()
  expect((await f.apply({ action: 'unknown', profile: 'fern' })).status).toBe(400)
  expect((await f.apply({ action: 'create-profile', profile: '../cedar' })).status).toBe(400)
  expect(
    (await f.apply({ action: 'delete-profile', profile: 'fern', confirm: 'cedar' })).status,
  ).toBe(400)
  expect((await f.apply({ action: 'helper-on', profile: 'absent' })).status).toBe(404)
  expect((await f.request('/configuration', { payload: {}, configRevision: -1 })).status).toBe(400)
  expect(f.store.get('fern')).toBeDefined()
})
it('waits for application and reports a real error after a partial change without replay', async () => {
  const f = await boot()
  f.store.setFlags('fern', { enabled: true })
  let release!: () => void
  const work = new Promise<void>((resolve) => {
    release = resolve
  })
  const helper = vi.spyOn(f.browser, 'turnHelperOn').mockReturnValue(work)
  let settled = false
  const pending = f.apply({ action: 'helper-on', profile: 'fern' }).then((reply) => {
    settled = true
    return reply
  })
  try {
    await vi.waitFor(() => expect(helper).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
  } finally {
    release()
  }
  expect(await pending).toEqual({ status: 200, body: { applied: true } })
  const close = vi
    .spyOn(f.browser, 'close')
    .mockRejectedValueOnce(new Error('browser close failed'))
  expect(await f.apply({ action: 'set-enabled', profile: 'fern', enabled: false })).toEqual({
    status: 500,
    body: { error: 'browser close failed' },
  })
  expect(close).toHaveBeenCalledOnce()
  expect((await f.request('/configuration')).body).toMatchObject({
    profiles: expect.arrayContaining([expect.objectContaining({ name: 'fern', enabled: false })]),
  })
})
