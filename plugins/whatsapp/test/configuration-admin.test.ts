import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, expect, it, vi } from 'vitest'
import { registerAdminRoutes } from '../src/http/adminRoutes.js'
import { createSettingsStore } from '../src/settings.js'
import { silentLogger } from '../src/logger.js'
import { FakeBridge, ROWING } from './fakes.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function boot() {
  const home = mkdtempSync(join(tmpdir(), 'fictional-configuration-'))
  cleanup.push(() => rmSync(home, { recursive: true, force: true }))
  const bridge = new FakeBridge(),
    settings = createSettingsStore(home)
  const app = express()
  app.use(express.json())
  registerAdminRoutes(app, { bridge, settings, logger: silentLogger, version: 'fixture' })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test listener')
  const request = async (path: string, body?: unknown) => {
    const response = await fetch('http://127.0.0.1:' + address.port + '/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const responseBody = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : await response.text()
    return { status: response.status, body: responseBody }
  }
  return {
    bridge,
    settings,
    request,
    apply: (payload: unknown) => request('/configuration', { payload, configRevision: 0 }),
  }
}
it('serves package-owned settings and applies each phone and settings command', async () => {
  const f = await boot()
  const apply = async (action: string, fields = {}) =>
    expect(await f.apply({ action, ...fields })).toEqual({ status: 200, body: { applied: true } })
  await apply('set-read', { enabled: true })
  await apply('set-prefix', { enabled: false })
  await apply('set-group-write', { group: ROWING.jid, enabled: true })
  await apply('refresh-groups')
  expect((await f.request('/configuration')).body).toMatchObject({
    status: { state: 'linked' },
    read: true,
    prefix: false,
    groups: expect.arrayContaining([expect.objectContaining({ jid: ROWING.jid, canWrite: true })]),
  })
  await apply('unlink-phone')
  expect(f.bridge.state).toBe('unlinked')
  await apply('link-phone')
  expect(f.bridge.state).toBe('pairing')
  expect((await f.request('/settings')).body).toMatchObject({ read: true, prefix: false })
})
it('awaits generic unlink completion while the preceding-app route still accepts asynchronously', async () => {
  const f = await boot()
  let release!: () => void
  const work = new Promise<void>((resolve) => {
    release = resolve
  })
  const unlink = vi.spyOn(f.bridge, 'unlink').mockReturnValue(work)
  let settled = false
  const pending = f.apply({ action: 'unlink-phone' }).then((reply) => {
    settled = true
    return reply
  })
  try {
    await vi.waitFor(() => expect(unlink).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
    expect(await f.request('/unlink', {})).toEqual({ status: 202, body: {} })
    expect(settled).toBe(false)
  } finally {
    release()
  }
  expect(await pending).toEqual({ status: 200, body: { applied: true } })
})
it('rejects invalid package commands and retains actual failures without retries', async () => {
  const f = await boot()
  expect((await f.apply({ action: 'unknown' })).status).toBe(400)
  expect((await f.apply({ action: 'set-read', enabled: 'yes' })).status).toBe(400)
  for (const group of [undefined, 'invalid', '120363999999999999@g.us']) {
    expect((await f.apply({ action: 'set-group-write', group, enabled: true })).status).toBe(400)
    expect((await f.request('/group-write', { group, enabled: true })).status).toBe(400)
  }
  expect((await f.apply({ action: 'link-phone' })).status).toBe(409)
  expect((await f.request('/configuration', { payload: null, configRevision: 0 })).status).toBe(400)
  const refresh = vi
    .spyOn(f.bridge, 'refreshGroups')
    .mockRejectedValue(new Error('bridge disconnected'))
  expect(await f.apply({ action: 'refresh-groups' })).toEqual({
    status: 500,
    body: { error: 'bridge disconnected' },
  })
  expect(refresh).toHaveBeenCalledOnce()
  expect((await f.request('/configuration')).body).toMatchObject({ status: { state: 'linked' } })
  const write = vi.spyOn(f.settings, 'setRead').mockImplementation(() => {
    throw new Error('disk full')
  })
  expect(await f.apply({ action: 'set-read', enabled: true })).toEqual({
    status: 500,
    body: { error: 'disk full' },
  })
  expect(write).toHaveBeenCalledOnce()
})
it('lets Express handle a synchronous old-route unlink failure and returns it from generic configuration', async () => {
  const f = await boot()
  const unlink = vi.spyOn(f.bridge, 'unlink').mockImplementation(() => {
    throw new Error('pending marker write failed')
  })
  expect((await f.request('/unlink', {})).status).toBe(500)
  expect(await f.apply({ action: 'unlink-phone' })).toEqual({
    status: 500,
    body: { error: 'pending marker write failed' },
  })
  expect(unlink).toHaveBeenCalledTimes(2)
})

async function bootRemoval() {
  const f = await boot()
  return { ...f, request: (path = '/before-remove') => f.request(path, {}) }
}

it.each([
  { state: 'linked' as const, remoteUncertain: false, confirmed: true },
  { state: 'unlinked' as const, remoteUncertain: false, confirmed: false },
  { state: 'linked' as const, remoteUncertain: true, confirmed: false },
  { state: 'unlinked' as const, remoteUncertain: true, confirmed: false },
])('keeps phone interpretation inside the package for $state / $remoteUncertain', async (prior) => {
  const f = await bootRemoval()
  f.bridge.state = prior.state
  const status = f.bridge.status.bind(f.bridge)
  vi.spyOn(f.bridge, 'status').mockImplementation(() => ({
    ...status(),
    removeOnPhone: prior.remoteUncertain,
  }))
  const reply = await f.request()
  expect(reply.status).toBe(200)
  expect(reply.body.notice).toBe(
    prior.confirmed
      ? 'WhatsApp’s device was logged out.'
      : 'Logout was not confirmed. Open Linked devices on your phone and remove this device if it is still listed.',
  )
  expect(f.bridge.unlinked).toBe(1)
})
it('keeps the preceding app response body and waits for local cleanup', async () => {
  const f = await bootRemoval()
  expect(await f.request('/uninstall')).toEqual({ status: 200, body: {} })
  let release!: () => void
  const work = new Promise<void>((resolve) => {
    release = resolve
  })
  const unlink = vi.spyOn(f.bridge, 'unlink').mockReturnValue(work)
  let settled = false
  const pending = f.request().then((reply) => {
    settled = true
    return reply
  })
  try {
    await vi.waitFor(() => expect(unlink).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
  } finally {
    release()
  }
  expect((await pending).status).toBe(200)
})
it('returns an HTTP failure if the pending-marker write throws', async () => {
  const f = await bootRemoval()
  const unlink = vi.spyOn(f.bridge, 'unlink').mockImplementation(() => {
    throw new Error('pending marker write failed')
  })
  expect((await f.request()).status).toBe(500)
  expect((await f.request('/uninstall')).status).toBe(500)
  expect(unlink).toHaveBeenCalledTimes(2)
})
