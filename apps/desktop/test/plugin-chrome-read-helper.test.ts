import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import type { PluginNodeReady } from '../src/main/plugins/node-host'
import { readChromeConfiguration } from '../src/main/plugins/lifecycle/chrome-read'

const servers: Array<{ close(): void }> = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})
async function serving(profiles: unknown[]): Promise<PluginNodeReady> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(request.url === '/v1/profiles' ? { profiles } : { tabs: [] }))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  return {
    admin: () => ({ url, headers: { Authorization: 'Bearer fictional' } }),
  } as unknown as PluginNodeReady
}

it('passes the remembered helper switch to the Chrome panel, and reads earlier plugins without it', async () => {
  const snapshot = (await readChromeConfiguration(
    'chrome',
    await serving([
      { name: 'fern', enabled: true, open: true, helperOff: true },
      { name: 'willow', enabled: true, open: true, helperOff: false },
      { name: 'birch', enabled: true, open: false },
    ]),
  )) as { profiles: Array<Record<string, unknown>> }
  expect(snapshot.profiles.map((p) => p.helperOff)).toEqual([true, false, undefined])
  await expect(
    readChromeConfiguration(
      'chrome',
      await serving([{ name: 'fern', enabled: true, open: true, helperOff: 'yes' }]),
    ),
  ).rejects.toThrow()
})
