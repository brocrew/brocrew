import { expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  servePersonPluginControl,
  connectPersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import type { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { catalogueBytes } from './plugin-package-fixtures'

it('carries a retry stage and last cause to Settings without changing older card replies', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ip-')))
  const card = {
    id: 'chrome',
    name: 'Chrome',
    state: 'Running' as const,
    installed: true,
    toolsPending: 'binding-inventory',
    toolsCause: 'binding-connect: connection-refused',
  }
  const controller = {
    attach: async () => ({}),
    detach: async () => {},
    preparedMutationFeature: () => false,
    status: async () => ({ cards: [card] }),
  } as unknown as PluginLifecycleController
  const key = randomBytes(32).toString('hex')
  const host = await servePersonPluginControl({ root, key, controller, read: async () => null })
  const channel = await connectPersonPluginControl({
    path: host.path,
    key,
    handle: async () => true,
  })
  let settings: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
  try {
    await channel.call({ kind: 'attach', workspaceId: randomUUID() })
    expect(await channel.call({ kind: 'features' })).toMatchObject({
      features: expect.arrayContaining(['tool-starting-v1']),
    })
    expect(await channel.call({ kind: 'list-tool-starting' })).toEqual([card])
    for (const kind of [
      'list-v2',
      'list-tool-health',
      'list-tool-cause',
      'list-startup-diagnostic',
    ]) {
      const [legacy] = (await channel.call({ kind })) as Record<string, unknown>[]
      expect(legacy).not.toHaveProperty('toolsPending')
      expect(legacy).not.toHaveProperty('toolsCause')
    }
    settings = await connectPluginSettings({
      path: host.path,
      personKey: key,
      root,
      target: { os: 'darwin', cpu: 'arm64' },
      catalogue: catalogueBytes({ format: 1, entries: [] }),
      projection: {
        workspaceId: randomUUID(),
        revoke: async () => true,
        applied: async () => {},
        reconcile: async () => {},
      },
      propose: () => {},
    })
    expect(await settings.catalogue()).toEqual([card])
  } finally {
    await settings?.close()
    channel.close()
    await host.close()
    await rm(root, { recursive: true, force: true })
  }
})
