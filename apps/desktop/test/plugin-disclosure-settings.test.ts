import { afterEach, expect, it, vi } from 'vitest'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { selectedSourceFixture } from './plugin-selected-source-fixtures'
import { settingsPeer } from './plugin-disclosure-fixtures'
vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: vi.fn() }))
const closers: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
it.each(['install', 'update'] as const)(
  'real Settings displays selected details and dispatches normal %s',
  async (action) => {
    const s = await selectedSourceFixture(action === 'update')
    closers.push(s.close)
    const c = await s.connect(),
      p = settingsPeer(c)
    expect(await p.call({ kind: 'inspect', package: s.ref })).toMatchObject({
      ok: true,
      inspection: {
        id: 'fictional-bakery',
        details: { authors: ['fictional-makers'], permissions: s.next.manifest.permissions },
      },
    })
    expect(await p.call({ kind: action, id: 'fictional-bakery', package: s.ref })).toMatchObject({
      ok: true,
      cards: [{ installed: true, installedVersion: '1.0.2' }],
    })
  },
)
it('a second window can apply the same selected package after the first window closes its view', async () => {
  const s = await selectedSourceFixture()
  closers.push(s.close)
  const c = await s.connect(),
    a = settingsPeer(c),
    b = settingsPeer(c)
  const shown = await a.call({ kind: 'inspect', package: s.ref })
  await a.call({ kind: 'close' })
  expect(
    await b.call({ kind: 'install', id: shown.inspection.id, package: shown.inspection.ref }),
  ).toMatchObject({ ok: true, cards: [{ installed: true }] })
})
it('a package identity mismatch is visible and leaves installation unchanged', async () => {
  const s = await selectedSourceFixture()
  closers.push(s.close)
  const p = settingsPeer(await s.connect())
  expect(await p.call({ kind: 'install', id: 'fictional-other', package: s.ref })).toMatchObject({
    ok: false,
    detail: 'The selected package belongs to a different plugin.',
  })
  expect(s.f.state.exportActivation().entries).toEqual([])
})
