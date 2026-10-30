import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod } from 'node:fs/promises'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { fictionalPublicKey } from './plugin-package-fixtures'

const fault = vi.hoisted(() => ({ code: '' }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...real,
    chmod: vi.fn(async (...args: Parameters<typeof real.chmod>) => {
      if (fault.code && String(args[0]).endsWith('person.sock'))
        throw Object.assign(new Error('fictional socket permission failure'), { code: fault.code })
      return real.chmod(...args)
    }),
  }
})
afterEach(async () => {
  fault.code = ''
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await cleanupLifecycleFixtures()
})

describe.skipIf(process.platform === 'win32')(
  'person control socket permissions are best effort',
  () => {
    it.each(['EPERM', 'EOPNOTSUPP'])(
      'serves the real authenticated Settings channel and starts a verified plugin after chmod %s',
      async (code) => {
        const f = await fixture()
        await f.controller.detach(f.handle)
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
        fault.code = code
        const key = 'a'.repeat(64)
        const bridge = await servePersonPluginControl({
          root: f.root,
          key,
          controller: f.controller,
          read: async () => null,
        })
        let client: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
        try {
          expect(chmod).toHaveBeenCalledExactlyOnceWith(bridge.path, 0o600)
          expect(warning).toHaveBeenCalledExactlyOnceWith(
            'Could not tighten plugin folder permissions; continuing.',
          )
          client = await connectPluginSettings({
            path: bridge.path,
            personKey: key,
            root: f.root,
            pinnedPublicKey: fictionalPublicKey,
            target: f.opts.target,
            catalogue: f.opts.catalogue,
            projection: projection().sink,
            propose() {},
          })
          expect(await client.catalogue()).toMatchObject([{ id: 'chrome', state: 'Available' }])
          await client.install('chrome')
          expect(f.starts()).toBe(1)
          expect(await client.catalogue()).toMatchObject([
            { id: 'chrome', state: 'Running', installed: true },
          ])
          expect(warning).toHaveBeenCalledOnce()
          await client.uninstall('chrome')
        } finally {
          await client?.close()
          await bridge.close()
        }
      },
    )
  },
)
