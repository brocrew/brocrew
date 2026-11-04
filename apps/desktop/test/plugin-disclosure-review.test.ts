import { afterEach, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { selectedSourceFixture } from './plugin-selected-source-fixtures'

const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function setup(installed = false) {
  const s = await selectedSourceFixture(installed)
  closers.push(s.close)
  return s
}
it.each(['install', 'update'] as const)(
  'inspection displays authors and permissions before ordinary %s',
  async (action) => {
    const s = await setup(action === 'update'),
      c = await s.connect(),
      before = structuredClone(s.f.state.exportActivation()),
      starts = s.f.starts()
    const shown = await c.inspectPackage!(s.ref)
    expect(shown.details).toMatchObject({
      authors: ['fictional-makers'],
      permissions: s.next.manifest.permissions,
      digest: s.ref.sha256,
    })
    expect(shown).not.toHaveProperty('consent')
    expect(s.f.state.exportActivation()).toEqual(before)
    expect(s.f.starts()).toBe(starts)
    await c.applyPackage!(shown.ref, action)
    expect((await c.catalogue())[0]).toMatchObject({ installed: true, installedVersion: '1.0.2' })
  },
)
it('inspection returns detached metadata and retains the exact package for offline installation', async () => {
  const s = await setup(),
    c = await s.connect(),
    shown = await c.inspectPackage!(s.ref)
  shown.details.authors!.push('fictional forged display')
  shown.details.permissions.description = 'fictional changed display'
  await rm(s.ref.source)
  const again = await c.inspectPackage!(s.ref)
  expect(again.details.authors).toEqual(['fictional-makers'])
  expect(again.details.permissions).toEqual(s.next.manifest.permissions)
  await c.applyPackage!(s.ref, 'install')
  expect((await c.catalogue())[0]).toMatchObject({ installed: true })
  expect((await c.catalogue())[0]).not.toHaveProperty('updateVersion')
})
it('changing the window list does not invalidate its explicitly selected archive', async () => {
  const s = await setup(),
    c = await s.connect(),
    shown = await c.inspectPackage!(s.ref)
  await c.refreshCatalogue!('f'.repeat(64), {
    bytes: Buffer.from('{"format":3,"entries":[]}'),
    signature: Buffer.alloc(0),
  })
  await c.applyPackage!(shown.ref, 'install')
  expect((await c.catalogue())[0]).toMatchObject({ id: shown.id, installed: true })
})
it('a closed window cannot dispatch a later install', async () => {
  const s = await setup(),
    c = await s.connect()
  await c.close()
  await expect(c.applyPackage!(s.ref, 'install')).rejects.toThrow()
  expect(s.f.state.exportActivation().entries).toEqual([])
})

it('an explicit local source is not interpreted as a catalogue ID with the same value', async () => {
  const s = await setup()
  const c = await s.connect({
    bytes: Buffer.from(
      JSON.stringify({ format: 3, entries: [{ ...s.next.release, id: s.ref.source }] }),
    ),
    signature: Buffer.alloc(0),
  })
  s.download.mockRejectedValueOnce(
    new Error('fictional catalogue lookup should not replace a source'),
  )
  const shown = await c.inspectPackage!({ source: s.ref.source })
  expect(shown.ref.source).toBe(s.ref.source)
  expect(shown.id).toBe(s.next.manifest.id)
  expect(s.download).not.toHaveBeenCalled()
})
