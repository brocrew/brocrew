import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
} from './plugin-lifecycle-fixtures'

const note = 'If cleanup cannot be confirmed, check the fictional service.'
const removal = { data: 'delete' as const, beforeRemove: true as const, note }
afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
})

describe.skipIf(process.platform === 'win32')(
  'package removal declarations over inert peers',
  () => {
    it.each(['notice', 'empty', 'failure', 'timeout', 'absent'] as const)(
      'keeps actual local deletion separate from cleanup mode %s',
      async (mode) => {
        const f = await fixture({}, 'whatsapp', { removal })
        const exit = deferred<void>()
        const start = f.opts.runtime.start.bind(f.opts.runtime)
        f.opts.runtime.start = async (spec) => ({ ...(await start(spec)), exited: exit.promise })
        await f.controller.install(f.handle, 'whatsapp')
        expect((await f.controller.status()).cards[0]).toMatchObject({
          uninstallDeletesData: true,
          uninstallNote: note,
        })
        const fetch = vi.fn(async () => {
          if (mode === 'failure') throw new Error('fictional cleanup failed')
          if (mode === 'timeout') throw new DOMException('fictional deadline', 'TimeoutError')
          return Response.json({ notice: mode === 'notice' ? 'Fictional cleanup completed.' : '' })
        })
        vi.stubGlobal('fetch', fetch)
        if (mode === 'absent') {
          f.events.length = 0
          exit.resolve()
          await vi.waitFor(() => expect(f.events).toContain('revoke'))
        }
        await expect(f.controller.uninstall(f.handle, 'whatsapp')).resolves.toEqual({
          data: 'deleted',
          notice: mode === 'notice' ? 'Fictional cleanup completed.' : note,
        })
        expect(f.events).toContain('remove-data whatsapp')
        expect(f.state.inspect().guards[0]?.phase).toBe('removed')
        if (mode === 'absent') expect(fetch).not.toHaveBeenCalled()
        else
          expect(fetch).toHaveBeenCalledWith(
            '/before-remove',
            expect.objectContaining({ method: 'POST' }),
          )
      },
    )

    it.each([undefined, { data: 'retain' as const, note }])(
      'retains local data when the installed declaration is %j',
      async (declaration) => {
        const f = await fixture({}, 'whatsapp', { removal: declaration })
        await f.controller.install(f.handle, 'whatsapp')
        const fetch = vi.fn()
        vi.stubGlobal('fetch', fetch)
        await expect(f.controller.uninstall(f.handle, 'whatsapp')).resolves.toEqual({
          data: 'retained',
          ...(declaration ? { notice: note } : {}),
        })
        expect(f.events).not.toContain('remove-data whatsapp')
        expect(fetch).not.toHaveBeenCalled()
      },
    )

    it('carries package wording through the real person Settings channel', async () => {
      const f = await fixture({}, 'whatsapp', { removal })
      await f.controller.detach(f.handle)
      const bridge = await servePersonPluginControl({
        root: f.root,
        key: 'a'.repeat(64),
        controller: f.controller,
        read: async () => ({}),
      })
      let client: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
      try {
        client = await connectPluginSettings({
          path: bridge.path,
          personKey: 'a'.repeat(64),
          root: f.root,
          target: f.opts.target,
          catalogue: f.opts.catalogue,
          projection: projection().sink,
          propose: () => {},
        })
        expect(client.features?.()).toContain('removal-results-v1')
        await client.install('whatsapp')
        expect((await client.catalogue())[0]?.uninstallNote).toBe(note)
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Response.json({ notice: 'Fictional service completed cleanup.' })),
        )
        await expect(client.uninstall('whatsapp')).resolves.toEqual({
          data: 'deleted',
          notice: 'Fictional service completed cleanup.',
        })
        expect((await client.catalogue())[0]?.installed).toBe(false)
        expect(f.state.inspect().pending).toBeNull()
      } finally {
        await client?.close()
        await bridge.close()
      }
    })

    it('does not turn failed local deletion into a completed removal and retries its declaration', async () => {
      const f = await fixture({}, 'whatsapp', { removal })
      await f.controller.install(f.handle, 'whatsapp')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({})),
      )
      const removeData = f.opts.runtime.removeData!
      f.opts.runtime.removeData = async () => {
        throw new Error('fictional deletion failed')
      }
      const operationId = randomUUID()
      await expect(f.controller.uninstall(f.handle, 'whatsapp', operationId)).rejects.toMatchObject(
        { code: 'cleanup-pending' },
      )
      expect(f.state.inspect().pending).not.toBeNull()
      f.opts.runtime.removeData = removeData
      await expect(f.controller.uninstall(f.handle, 'whatsapp', operationId)).resolves.toEqual({
        data: 'deleted',
        notice: note,
      })
      expect(f.events).toContain('remove-data whatsapp')
      expect(f.state.inspect().pending).toBeNull()
    })
    it('keeps the disposition after archive removal when journal completion must be retried', async () => {
      const f = await fixture({}, 'whatsapp', { removal })
      await f.controller.install(f.handle, 'whatsapp')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({})),
      )
      vi.spyOn(f.state, 'complete').mockImplementationOnce(() => {
        throw new Error('fictional journal failure')
      })
      const operationId = randomUUID()
      await expect(f.controller.uninstall(f.handle, 'whatsapp', operationId)).rejects.toMatchObject(
        { code: 'cleanup-pending' },
      )
      expect(f.events).toContain('remove-code')
      await expect(f.controller.uninstall(f.handle, 'whatsapp', operationId)).resolves.toEqual({
        data: 'deleted',
        notice: note,
      })
      expect(f.events.filter((event) => event === 'remove-data whatsapp')).toHaveLength(2)
      expect(f.state.inspect().pending).toBeNull()
    })
  },
)
