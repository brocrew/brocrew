import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, expect, it, vi } from 'vitest'
import { registerAdminRoutes } from '../src/http/adminRoutes.js'
import { silentLogger } from '../src/logger.js'
import { FakeBridge } from './fakes.js'
import { createSettingsStore } from '../src/settings.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function boot() {
  const home = mkdtempSync(join(tmpdir(), 'fictional-removal-'))
  cleanup.push(() => rmSync(home, { recursive: true, force: true }))
  const bridge = new FakeBridge()
  const app = express()
  app.use(express.json())
  registerAdminRoutes(app, {
    bridge, logger: silentLogger, version: 'fixture',
    settings: createSettingsStore(home),
  })
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  ))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test listener')
  const request = async (path = '/before-remove') => {
    const response = await fetch('http://127.0.0.1:' + address.port + '/v1' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })
    return {
      status: response.status,
      body: response.headers.get('content-type')?.includes('application/json')
        ? await response.json() : await response.text(),
    }
  }
  return { bridge, request }
}
it.each([
  { state: 'linked' as const, remoteUncertain: false, confirmed: true },
  { state: 'unlinked' as const, remoteUncertain: false, confirmed: false },
  { state: 'linked' as const, remoteUncertain: true, confirmed: false },
  { state: 'unlinked' as const, remoteUncertain: true, confirmed: false },
])('keeps phone interpretation inside the package for $state / $remoteUncertain', async (prior) => {
  const f = await boot()
  f.bridge.state = prior.state
  const status = f.bridge.status.bind(f.bridge)
  vi.spyOn(f.bridge, 'status').mockImplementation(() => ({
    ...status(), removeOnPhone: prior.remoteUncertain,
  }))
  const reply = await f.request()
  expect(reply.status).toBe(200)
  expect(reply.body.notice).toBe(prior.confirmed
    ? 'WhatsApp’s device was logged out.'
    : 'Logout was not confirmed. Open Linked devices on your phone and remove this device if it is still listed.')
  expect(f.bridge.unlinked).toBe(1)
})
it('keeps the preceding app response body and waits for local cleanup', async () => {
  const f = await boot()
  expect(await f.request('/uninstall')).toEqual({ status: 200, body: {} })
  let release!: () => void
  const work = new Promise<void>((resolve) => { release = resolve })
  const unlink = vi.spyOn(f.bridge, 'unlink').mockReturnValue(work)
  let settled = false
  const pending = f.request().then((reply) => { settled = true; return reply })
  try {
    await vi.waitFor(() => expect(unlink).toHaveBeenCalledOnce())
    expect(settled).toBe(false)
  } finally { release() }
  expect((await pending).status).toBe(200)
})
it('returns an HTTP failure if the pending-marker write throws', async () => {
  const f = await boot()
  const unlink = vi.spyOn(f.bridge, 'unlink').mockImplementation(() => {
    throw new Error('pending marker write failed')
  })
  expect((await f.request()).status).toBe(500)
  expect((await f.request('/uninstall')).status).toBe(500)
  expect(unlink).toHaveBeenCalledTimes(2)
})
