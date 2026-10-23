import { randomBytes } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import {
  fixture,
  projection,
  cleanupLifecycleFixtures,
  deferred,
} from './plugin-lifecycle-fixtures'
import { packageFixture, signed } from './plugin-package-fixtures'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import {
  servePersonPluginControl,
  connectPersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
it.each([1, 2] as const)(
  'verified v%s owner features remain readable while its state fence is held',
  async (format) => {
    const f = await fixture()
    const pkg =
      format === 1
        ? f.pkg
        : packageFixture({
            manifest: {
              ...f.pkg.manifest,
              format: 2,
              authors: ['fern-makers'],
              executor: { kind: 'node', entry: f.pkg.manifest.server!.entry },
              hooks: [],
            },
          })
    const source =
      format === 1
        ? pkg
        : signed({ format: 2, entries: [{ ...pkg.release, authors: ['fern-makers'] }] })
    const options = { ...f.opts, catalogue: { bytes: source.bytes, signature: source.signature } }
    const controller = await PluginLifecycleController.open(options)
    const key = randomBytes(32).toString('hex'),
      bridge = await servePersonPluginControl({
        root: f.root,
        key,
        controller,
        read: async () => null,
      })
    closers.push(() => bridge.close())
    const channel = await connectPersonPluginControl({
      path: bridge.path,
      key,
      handle: async () => true,
    })
    closers.push(async () => channel.close())
    await channel.call({ kind: 'attach', workspaceId: projection().sink.workspaceId })
    const expected = await channel.call({ kind: 'features' })
    if (format === 2)
      expect(expected).toMatchObject({
        features: expect.arrayContaining(['authors-v1', 'prepared-mutations-v1']),
      })
    else
      expect(expected).not.toMatchObject({
        features: expect.arrayContaining(['prepared-mutations-v1']),
      })
    const before = f.state.inspect(),
      entered = deferred<void>(),
      release = deferred<void>()
    const work = f.state.withExclusive(async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise
    try {
      await expect(channel.call({ kind: 'features' })).resolves.toEqual(expected)
    } finally {
      release.resolve()
      await work
    }
    expect(f.state.inspect()).toEqual(before)
    options.refreshCatalogue = async () => ({
      catalogue: { bytes: Buffer.from('{"format":2,"entries":[{}]}'), signature: source.signature },
      names: f.opts.names,
    })
    await expect(controller.refreshCatalogue('0'.repeat(64))).rejects.toThrow()
    await expect(channel.call({ kind: 'features' })).resolves.toEqual(expected)
    expect(f.state.inspect()).toEqual(before)
    expect(f.events).toEqual([])
  },
)
