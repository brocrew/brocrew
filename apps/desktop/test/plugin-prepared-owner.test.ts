import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import { writeFile } from 'node:fs/promises'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { releasePackageRef } from '../src/main/plugins/package-source'
import { selectedSourceFixture } from './plugin-selected-source-fixtures'
import { connectPersonPluginControl } from '../src/main/plugins/lifecycle/person-control'

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function setup(installed = false) {
  const f = await selectedSourceFixture(installed)
  closers.push(f.close)
  return f
}
it.each(['install', 'update'] as const)(
  'ordinary selected %s is idempotent for the same operation and archive',
  async (action) => {
    const s = await setup(action === 'update')
    const wire = await connectPersonPluginControl({
      path: s.bridge.path,
      key: s.key,
      handle: async () => true,
    })
    closers.push(async () => wire.close())
    await wire.call({ kind: 'attach', workspaceId: randomUUID() })
    const command = { kind: 'package-install', package: s.ref, action, operationId: randomUUID() }
    await wire.call(command)
    const selected = structuredClone(s.f.state.exportActivation())
    const starts = s.f.starts()
    await wire.call(command)
    expect(s.f.state.exportActivation()).toEqual(selected)
    expect(s.f.starts()).toBe(starts)
    expect(s.f.state.inspect().pending).toBeNull()
  },
)
it.each(['install', 'update'] as const)(
  'a broken selected %s leaves the previous selection and runtime unchanged',
  async (action) => {
    const s = await setup(action === 'update'),
      c = await s.connect()
    const before = structuredClone(s.f.state.exportActivation()),
      starts = s.f.starts()
    await writeFile(s.ref.source, 'fictional broken package')
    await expect(c.applyPackage!(s.ref, action)).rejects.toThrow()
    expect(s.f.state.exportActivation()).toEqual(before)
    expect(s.f.starts()).toBe(starts)
    expect(s.f.state.inspect().pending).toBeNull()
  },
)
it.each(['install', 'update'] as const)(
  'a recorded %s failure retains compensation or recoverable selection',
  async (action) => {
    const s = await setup(action === 'update'),
      c = await s.connect()
    const before = s.f.state.exportActivation().entries
    s.f.opts.fault = (stage) => {
      if (stage === 'prepared') throw new Error('fictional write interruption')
    }
    await expect(c.applyPackage!(s.ref, action)).rejects.toThrow()
    if (s.f.state.inspect().pending) {
      s.f.opts.fault = undefined
      await PluginLifecycleController.open(s.f.opts)
      expect(s.f.state.inspect().pending).toBeNull()
      expect(s.f.state.exportActivation().entries[0]?.release.archiveSha256).toBe(s.ref.sha256)
    } else {
      expect(s.f.state.exportActivation().entries.map((x) => [x.pluginId, x.release])).toEqual(
        before.map((x) => [x.pluginId, x.release]),
      )
    }
  },
)
it('different windows install selected archives without negotiating a common source', async () => {
  const s = await setup(),
    a = await s.connect(),
    b = await s.connect({
      bytes: Buffer.from('{"format":3,"entries":[]}'),
      signature: Buffer.alloc(0),
    })
  const inspected = await a.inspectPackage!(s.ref)
  expect(inspected.details.authors).toEqual(['fictional-makers'])
  await b.applyPackage!(s.ref, 'install')
  expect((await b.catalogue())[0]).toMatchObject({
    id: 'fictional-bakery',
    installed: true,
    installedVersion: '1.0.2',
  })
  expect(b.mutationStatus?.()).toBeNull()
  expect(b.features?.()).not.toContain('prepared-mutations-v1')
})

it.each(['install', 'update'] as const)(
  'the same %s operation cannot silently select a different archive',
  async (action) => {
    const s = await setup(action === 'update')
    const wire = await connectPersonPluginControl({
      path: s.bridge.path,
      key: s.key,
      handle: async () => true,
    })
    closers.push(async () => wire.close())
    await wire.call({ kind: 'attach', workspaceId: randomUUID() })
    const command = { kind: 'package-install', package: s.ref, action, operationId: randomUUID() }
    await wire.call(command)
    const before = structuredClone(s.f.state.exportActivation()),
      starts = s.f.starts()
    const changed = packageFixture({ manifest: { ...s.next.manifest, version: '1.0.3' } })
    const source = s.ref.source + '-different'
    await writeFile(source, changed.archive)
    await expect(
      wire.call({ ...command, package: { ...releasePackageRef(changed.release), source } }),
    ).rejects.toThrow()
    expect(s.f.state.exportActivation()).toEqual(before)
    expect(s.f.starts()).toBe(starts)
  },
)
