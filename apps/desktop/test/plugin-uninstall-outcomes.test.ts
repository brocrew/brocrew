import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import {
  cleanupLifecycleFixtures,
  deferred,
  fixture,
  projection,
} from './plugin-lifecycle-fixtures'
import { genericUiFixture } from './plugin-ui-fixtures'
import { cleanupRetirementSubjects, connectWhatsappSubject } from './plugin-retirement-subjects'
const closes: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close()
  await cleanupRetirementSubjects()
  await cleanupLifecycleFixtures()
})
async function setup() {
  const f = await fixture({ appVersion: '1.0.0' }, false, 'fictional-bakery')
  const actual = await connectWhatsappSubject(),
    exit = deferred<void>(),
    start = f.opts.runtime.start
  f.opts.runtime.start = async (spec) => {
    const run = await start(spec)
    return {
      ...run,
      exited: exit.promise,
      ready: async () => ({ ...(await run.ready()), client: actual.client }),
    }
  }
  const pkg = genericUiFixture({
    target: f.opts.target,
    dataOnRemove: 'remove',
    beforeRemove: { tool: 'whatsapp_before_remove' },
  })
  const source = join(f.parent, 'fictional-cleanup.tar')
  await writeFile(source, pkg.archive)
  await f.controller.installPackage(
    f.handle,
    { source, sha256: pkg.binding.releaseDigest, bytes: pkg.archive.length },
    'install',
  )
  return { ...f, actual, exit, source, pkg }
}
it.each([false, true, undefined])(
  'preserves the actual package cleanup result without app remote-logout inference %s',
  async (removeOnPhone) => {
    const f = await setup(),
      original = f.actual.bridge.status.bind(f.actual.bridge)
    f.actual.bridge.status = () => ({ ...original(), removeOnPhone })
    const result = await f.controller.uninstall(f.handle, 'fictional-bakery')
    expect(result).toMatchObject({
      data: 'deleted',
      cleanup: 'completed',
      result: { structuredContent: { status: removeOnPhone ? 'warning' : 'complete' } },
    })
    expect(result).not.toHaveProperty('logout')
    expect(f.actual.bridge.unlinked).toBe(1)
    expect(f.events).toContain('remove-data fictional-bakery')
  },
)
it.each(['confirmed', 'unconfirmed', 'failure', 'timeout', 'absent'] as const)(
  'separates current local data deletion from package cleanup state %s',
  async (mode) => {
    const f = await setup()
    if (mode === 'unconfirmed') {
      const status = f.actual.bridge.status.bind(f.actual.bridge)
      f.actual.bridge.status = () => ({ ...status(), removeOnPhone: true })
    }
    if (mode === 'failure')
      vi.spyOn(f.actual.bridge, 'unlink').mockRejectedValueOnce(
        new Error('fictional cleanup unavailable'),
      )
    const late = deferred<void>()
    if (mode === 'timeout') {
      const unlink = f.actual.bridge.unlink.bind(f.actual.bridge)
      vi.spyOn(f.actual.bridge, 'unlink').mockImplementationOnce(async () => {
        await late.promise
        await unlink()
      })
      const call = f.actual.client.callTool.bind(f.actual.client)
      vi.spyOn(f.actual.client, 'callTool').mockImplementation((params, schema, options) =>
        call(params, schema, { ...options, timeout: 10 }),
      )
    }
    if (mode === 'absent') {
      f.exit.resolve()
      await vi.waitFor(() => expect(f.events).toContain('revoke'))
    }
    const result = await f.controller.uninstall(f.handle, 'fictional-bakery')
    expect(result).toMatchObject({
      data: 'deleted',
      cleanup: ['failure', 'timeout', 'absent'].includes(mode) ? 'unconfirmed' : 'completed',
    })
    expect(result).not.toHaveProperty('logout')
    expect(f.events).toContain('remove-data fictional-bakery')
    expect(f.state.inspect().pending).toBeNull()
    expect(f.actual.bridge.unlinked).toBe(
      mode === 'absent' || mode === 'failure' || mode === 'timeout' ? 0 : 1,
    )
    if (mode === 'timeout') {
      late.resolve()
      await vi.waitFor(() => expect(f.actual.bridge.unlinked).toBe(1))
      expect(f.actual.bridge.unlink).toHaveBeenCalledOnce()
      // A late real package effect cannot turn the durable uncertain reply into a replay.
      expect(result).toMatchObject({ cleanup: 'unconfirmed' })
    }
  },
)
it('carries the actual package removal result over the real person Settings channel', async () => {
  const f = await setup(),
    key = 'a'.repeat(64)
  const bridge = await servePersonPluginControl({ root: f.root, key, controller: f.controller })
  closes.push(() => bridge.close())
  const client = await connectPluginSettings({
    path: bridge.path,
    personKey: key,
    root: f.root,
    pinnedPublicKey: f.opts.pinnedPublicKey,
    target: f.opts.target,
    appVersion: '1.0.0',
    catalogue: f.opts.catalogue,
    projection: projection().sink,
  })
  closes.push(() => client.close())
  expect((await client.catalogue())[0]?.uninstallDeletesData).toBe(true)
  await expect(client.uninstall('fictional-bakery')).resolves.toMatchObject({
    data: 'deleted',
    cleanup: 'completed',
    result: { structuredContent: { status: 'complete' } },
  })
  expect(f.actual.bridge.unlinked).toBe(1)
  expect(f.state.inspect().pending).toBeNull()
})
it('a failed local wipe remains pending and retry never repeats a consumed package cleanup', async () => {
  const f = await setup(),
    remove = f.opts.runtime.removeData!
  f.opts.runtime.removeData = async () => {
    throw new Error('fictional deletion failure')
  }
  const operationId = randomUUID()
  await expect(
    f.controller.uninstall(f.handle, 'fictional-bakery', operationId),
  ).rejects.toMatchObject({ code: 'cleanup-pending' })
  expect(f.state.inspect().pending).not.toBeNull()
  expect(f.actual.bridge.unlinked).toBe(1)
  f.opts.runtime.removeData = remove
  await f.controller.uninstall(f.handle, 'fictional-bakery', operationId)
  expect(f.state.inspect().pending).toBeNull()
  expect(f.actual.bridge.unlinked).toBe(1)
})
it.each([
  { before: 'never linked', state: 'unlinked', warning: false },
  { before: 'earlier unconfirmed logout', state: 'unlinked', warning: true },
  { before: 'unresolved prior logout', state: 'unavailable', warning: true },
])(
  'an earlier state $before does not let the app invent a remote logout guarantee',
  async ({ state, warning }) => {
    const f = await setup(),
      status = f.actual.bridge.status.bind(f.actual.bridge)
    f.actual.bridge.state = state
    f.actual.bridge.status = () => ({ ...status(), removeOnPhone: warning })
    expect(f.actual.bridge.status()).toMatchObject({ state, removeOnPhone: warning })
    const result = await f.controller.uninstall(f.handle, 'fictional-bakery')
    expect(result).toMatchObject({
      cleanup: 'completed',
      result: { structuredContent: { status: warning ? 'warning' : 'complete' } },
    })
    expect(f.actual.bridge.unlinked).toBe(1)
    expect(result).not.toHaveProperty('logout')
  },
)
it('current removal cleanup is attempted even if an earlier status observation is unavailable', async () => {
  const f = await setup(),
    status = f.actual.bridge.status.bind(f.actual.bridge)
  const read = vi.spyOn(f.actual.bridge, 'status').mockImplementation(() => {
    if (f.actual.bridge.unlinked === 0) throw new Error('fictional earlier status unavailable')
    return status()
  })
  const result = await f.controller.uninstall(f.handle, 'fictional-bakery')
  expect(result).toMatchObject({ data: 'deleted', cleanup: 'completed' })
  expect(f.actual.bridge.unlinked).toBe(1)
  expect(read).toHaveBeenCalledOnce()
})
