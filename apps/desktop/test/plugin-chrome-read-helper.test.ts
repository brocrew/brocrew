import { afterEach, expect, it, vi } from 'vitest'
import { chromeSubject, cleanupRetirementSubjects } from './plugin-retirement-subjects'
afterEach(cleanupRetirementSubjects)
it('the actual package snapshot keeps each remembered helper switch without a host decoder', async () => {
  const f = await chromeSubject()
  f.store.create('fern', 'panel')
  f.store.create('willow', 'panel')
  f.store.setHelper('fern', 'off')
  f.store.setHelper('willow', 'on')
  expect((await f.snapshot()).profiles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'fern', helperOff: true }),
      expect.objectContaining({ name: 'willow', helperOff: false }),
    ]),
  )
})
it('the actual package public snapshot omits private profile directories and preserves live flags', async () => {
  const f = await chromeSubject()
  f.store.create('fern', 'panel')
  f.store.setFlags('fern', {
    enabled: true,
    allowSync: false,
    allowExtensions: false,
    allowSettings: true,
    keepRunning: false,
  })
  const snapshot = await f.snapshot()
  expect(snapshot.profiles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'fern',
        enabled: true,
        allowSettings: true,
        allowExtensions: false,
      }),
    ]),
  )
  expect(JSON.stringify(snapshot)).not.toContain(f.store.dirOf('fern'))
  expect(JSON.stringify(snapshot)).not.toContain('migrationJournal')
})

it('the actual shared package snapshot keeps public shared fields and strips storage paths', async () => {
  const { subjectRoot } = await import('./plugin-retirement-subjects')
  const home = await subjectRoot(),
    shared = await subjectRoot()
  const { createSharedProfileStore } = await vi.importActual<{
    createSharedProfileStore(options: unknown): { create(name: string, by: 'panel'): unknown }
  }>('../../../plugins/chrome/src/profiles/sharedStore')
  const { FakeBrowser } = await vi.importActual<{
    FakeBrowser: new (dirOf: (name: string) => string) => unknown
  }>('../../../plugins/chrome/test/fakes')
  const { TabRegistry } = await vi.importActual<{ TabRegistry: new () => unknown }>(
    '../../../plugins/chrome/src/tabs',
  )
  const { configurationSnapshot } = await vi.importActual<{
    configurationSnapshot(deps: unknown): Promise<Record<string, unknown>>
  }>('../../../plugins/chrome/src/configuration')
  const store = createSharedProfileStore({
    home,
    shared,
    workspaceId: 'fictional-owner',
    workspaceLabel: 'Fictional workspace',
    chromeState: () => 'ended',
    ownerState: () => 'alive',
    readVolumeIdentity: () => 'apfs:11111111-1111-4111-8111-111111111111',
    processIdentity: { pid: process.pid, birth: 'fictional-birth' },
  }) as { create(name: string, by: 'panel'): unknown; dirOf(name: string): string }
  store.create('fern', 'panel')
  const snapshot = await configurationSnapshot({
    store,
    browser: new FakeBrowser(store.dirOf),
    tabs: new TabRegistry(),
  })
  expect(snapshot.profiles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'fern',
        shared: true,
        profileId: expect.any(String),
        globalRevision: expect.any(Number),
      }),
    ]),
  )
  expect(JSON.stringify(snapshot)).not.toContain(home)
  expect(JSON.stringify(snapshot)).not.toContain(shared)
  expect(JSON.stringify(snapshot)).not.toContain('migrationJournal')
})
