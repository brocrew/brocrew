import { afterEach, expect, it, vi } from 'vitest'
import { captureLog } from './lib/log-file'
import { fixture, projection, cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { PluginStartupError, recordPluginStartupFailure } from '../src/main/plugins/startup-failure'
const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
it.each(['owner-check', 'rpc', 'schema'] as const)(
  'catalogue preserves the original %s failure and logs the exact stage',
  async (stage) => {
    const f = await fixture()
    const key = 'a'.repeat(64)
    const bridge = await servePersonPluginControl({
      root: f.root,
      key,
      controller: f.controller,
      read: async () => ({}),
    })
    closers.push(() => bridge.close())
    const client = await connectPluginSettings({
      path: bridge.path,
      personKey: key,
      root: f.root,
      target: f.opts.target,
      catalogue: f.opts.catalogue,
      projection: projection().sink,
      propose() {},
    })
    closers.push(() => client.close())
    const original = new Error('owner-invalidated token=fictional-key', {
      cause: new Error('broker already closed password=fictional-password'),
    })
    const call = PersonChannel.prototype.call
    const lists: string[] = []
    const spy = vi.spyOn(PersonChannel.prototype, 'call').mockImplementation(function (
      this: PersonChannel,
      value,
    ) {
      const kind = (value as { kind: string }).kind
      if (stage === 'owner-check' && kind === 'features') return Promise.reject(original)
      if (
        [
          'list',
          'list-v2',
          'list-tool-health',
          'list-tool-cause',
          'list-startup-diagnostic',
          'list-tool-starting',
        ].includes(kind)
      ) {
        lists.push(kind)
        if (stage === 'rpc') return Promise.reject(original)
        if (stage === 'schema') return Promise.resolve([{ id: 123 }])
      }
      return call.call(this, value)
    })
    let failure: unknown
    try {
      await client.catalogue()
    } catch (error) {
      failure = error
    }
    spy.mockRestore()
    expect(lists).toEqual(stage === 'owner-check' ? [] : ['list-tool-starting'])
    expect(failure).toBeInstanceOf(PluginStartupError)
    expect(failure).toMatchObject({ catalogueStage: stage })
    if (stage === 'owner-check') {
      expect(failure).toMatchObject({ detailStage: 'owner-features' })
      expect((failure as Error).message).toContain('owner-features')
    }
    if (stage !== 'schema') expect((failure as Error).cause).toBe(original)
    const captured = await captureLog()
    recordPluginStartupFailure('catalogue-response', failure)
    const log = (await captured.lines(1)).join('\n')
    await captured.close()
    expect(log).toContain(`stage=${stage}`)
    if (stage === 'owner-check') expect(log).toContain('detail=owner-features')
    if (stage !== 'schema') {
      expect(log).toContain('owner-invalidated token=fictional-key')
      expect(log).toContain('broker already closed password=fictional-password')
    } else expect(log).toContain('invalid_type')
  },
)
