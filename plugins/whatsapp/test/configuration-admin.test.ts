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
  const bridge = new FakeBridge(), settings = createSettingsStore(home)
  const app = express()
  app.use(express.json())
  registerAdminRoutes(app, { bridge, settings, logger: silentLogger, version: 'fixture' })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  ))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test listener')
  const request = async (path: string, body?: unknown) => {
    const response = await fetch('http://127.0.0.1:' + address.port + '/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }
  return { bridge, settings, request,
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
    status: { state: 'linked' }, read: true, prefix: false,
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
  const work = new Promise<void>((resolve) => { release = resolve })
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
  } finally { release() }
  expect(await pending).toEqual({ status: 200, body: { applied: true } })
})
it('rejects invalid package commands and retains actual failures without retries', async () => {
  const f = await boot()
  expect((await f.apply({ action: 'unknown' })).status).toBe(400)
  expect((await f.apply({ action: 'set-read', enabled: 'yes' })).status).toBe(400)
  expect((await f.apply({ action: 'link-phone' })).status).toBe(409)
  expect((await f.request('/configuration', { payload: null, configRevision: 0 })).status).toBe(400)
  const refresh = vi.spyOn(f.bridge, 'refreshGroups').mockRejectedValue(new Error('bridge disconnected'))
  expect(await f.apply({ action: 'refresh-groups' })).toEqual({
    status: 500, body: { error: 'bridge disconnected' },
  })
  expect(refresh).toHaveBeenCalledOnce()
  expect((await f.request('/configuration')).body).toMatchObject({ status: { state: 'linked' } })
  const write = vi.spyOn(f.settings, 'setRead').mockImplementation(() => { throw new Error('disk full') })
  expect(await f.apply({ action: 'set-read', enabled: true })).toEqual({
    status: 500, body: { error: 'disk full' },
  })
  expect(write).toHaveBeenCalledOnce()
})
