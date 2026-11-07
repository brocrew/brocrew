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

it('retains bounded shared panel fields and strips foreign workspace paths', async () => {
  const shared = {
    name: 'fern',
    enabled: true,
    open: false,
    shared: true,
    profileId: '00000000-0000-4000-8000-000000000001',
    globalRevision: 4,
    onIn: ['Fern', 'Cedar'],
    inUseIn: 'Cedar',
    status: 'ready',
    migratedFrom: 'birch',
    appliesAtNextLaunch: true,
    deleteConfirmation: 'a'.repeat(64),
    allowSync: false,
    allowExtensions: false,
    allowSettings: true,
  }
  const snapshot = await readChromeConfiguration(
    'chrome',
    await serving([
      {
        ...shared,
        source: '/fictional/foreign/path',
        migrationJournal: { home: '/fictional/foreign/home' },
      },
    ]),
  )
  expect(snapshot).toEqual({ configRevision: 0, profiles: [shared], tabs: [] })
  for (const invalid of [
    { onIn: Array(257).fill('Workspace') },
    { globalRevision: -1 },
    { deleteConfirmation: 'bad' },
    { status: 'unknown' },
  ])
    await expect(
      readChromeConfiguration('chrome', await serving([{ ...shared, ...invalid }])),
    ).rejects.toThrow()
})
