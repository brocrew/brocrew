import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { logOutBeforeUninstall } from '../src/main/plugins/lifecycle/whatsapp-apply'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { fictionalPublicKey } from './plugin-package-fixtures'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
} from './plugin-lifecycle-fixtures'

const connection = {
  serverPid: 123,
  origin: 'http://127.0.0.1:1',
  mcp: () => ({ url: '', headers: { Authorization: 'Bearer fictional-mcp' } }),
  admin: () => ({
    url: 'http://127.0.0.1:1/v1',
    headers: { Authorization: 'Bearer fictional-admin' },
  }),
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})

it.each([false, true, undefined])(
  'separates the completed local wipe from remote logout confirmation %s',
  async (removeOnPhone) => {
    const fetch = vi.fn(async (url: string) =>
      Response.json(url.endsWith('/uninstall') ? {} : { state: 'unlinked', removeOnPhone }),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(logOutBeforeUninstall(connection, new AbortController().signal)).resolves.toBe(
      removeOnPhone === false ? 'confirmed' : 'unconfirmed',
    )
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:1/v1/uninstall',
      'http://127.0.0.1:1/v1/status',
    ])
  },
)

describe.skipIf(process.platform === 'win32')('uninstall results over inert peers', () => {
  it.each(['confirmed', 'unconfirmed', 'failure', 'timeout', 'absent'] as const)(
    'reports local deletion separately when remote logout is %s',
    async (mode) => {
      const f = await fixture({}, false, 'whatsapp')
      const exit = deferred<void>()
      const start = f.opts.runtime.start.bind(f.opts.runtime)
      f.opts.runtime.start = async (spec) => ({ ...(await start(spec)), exited: exit.promise })
      await f.controller.install(f.handle, 'whatsapp')
      const fetch = vi.fn(async (url: string) => {
        if (mode === 'failure') throw new Error('fictional-private-diagnostic')
        if (mode === 'timeout') throw new DOMException('fictional deadline', 'TimeoutError')
        return Response.json(
          url.endsWith('/uninstall')
            ? {}
            : { state: 'unlinked', removeOnPhone: mode !== 'confirmed' },
        )
      })
      vi.stubGlobal('fetch', fetch)
      if (mode === 'absent') {
        f.events.length = 0
        exit.resolve()
        await vi.waitFor(() => expect(f.events).toContain('revoke'))
      }
      await expect(f.controller.uninstall(f.handle, 'whatsapp')).resolves.toEqual({
        data: 'deleted',
        logout: mode === 'confirmed' ? 'confirmed' : 'unconfirmed',
      })
      expect(f.events).toContain('remove-data whatsapp')
      expect(f.state.inspect().guards[0]?.phase).toBe('removed')
      if (mode === 'absent') expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('carries the closed removal outcome through the real person Settings channel', async () => {
    const f = await fixture({}, false, 'whatsapp')
    await f.controller.detach(f.handle)
    const key = 'a'.repeat(64)
    const bridge = await servePersonPluginControl({
      root: f.root,
      key,
      controller: f.controller,
      read: async () => ({}),
    })
    let client: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
    try {
      client = await connectPluginSettings({
        path: bridge.path,
        personKey: key,
        root: f.root,
        pinnedPublicKey: fictionalPublicKey,
        target: f.opts.target,
        catalogue: f.opts.catalogue,
        projection: projection().sink,
        propose: () => {},
      })
      await client.install('whatsapp')
      vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
      await expect(client.uninstall('whatsapp')).resolves.toEqual({
        data: 'deleted',
        logout: 'unconfirmed',
      })
      expect((await client.catalogue())[0]?.installed).toBe(false)
      expect(f.state.inspect().pending).toBeNull()
    } finally {
      await client?.close()
      await bridge.close()
    }
  })

  it('does not turn a failed local deletion into a completed removal', async () => {
    const f = await fixture({}, false, 'whatsapp')
    await f.controller.install(f.handle, 'whatsapp')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    f.opts.runtime.removeData = async () => {
      throw new Error('fictional deletion failed')
    }
    await expect(f.controller.uninstall(f.handle, 'whatsapp', randomUUID())).rejects.toMatchObject({
      code: 'cleanup-pending',
    })
    expect(f.state.inspect().pending).not.toBeNull()
  })
})
