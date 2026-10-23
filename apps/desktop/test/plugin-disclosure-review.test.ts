import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { chmod, writeFile } from 'node:fs/promises'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { disclosureFixture, review, commit, cancelReviews } from './plugin-disclosure-fixtures'
import { PluginDownloadError } from '../src/main/plugins/catalogue/download'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import { pluginSha256 } from '../src/main/plugins/package-digests'
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function setup(options: Parameters<typeof disclosureFixture>[0] = {}) {
  const f = await disclosureFixture(options)
  closers.push(f.close)
  return f
}
it.each(['install', 'update'] as const)(
  'shows verified details before the real prepared %s',
  async (action) => {
    const f = await setup({ installed: action === 'update' }),
      c = await f.connect(),
      shown = await review(c, action)
    expect(shown.details).toEqual({
      version: '1.0.2',
      digest: f.next.release.archive.sha256,
      manifestSha256: f.next.release.manifestSha256,
      authors: ['fern-makers'],
      permissions: f.next.manifest.permissions,
    })
    expect(shown.catalogueDigest).toBe(pluginSha256(f.next.bytes))
    expect(shown.consent.releaseDigest).toBe(shown.details?.digest)
    expect(shown.consent.displayedDetailsHash).toMatch(/^[a-f0-9]{64}$/)
    expect(f.download).toHaveBeenCalledOnce()
    await commit(c, action, shown.consent)
    expect((await c.catalogue())[0]).toMatchObject({ installed: true, installedVersion: '1.0.2' })
    expect(f.f.state.inspect().guards[0]?.release).toMatchObject({
      archiveSha256: shown.details?.digest,
      manifestSha256: shown.details?.manifestSha256,
    })
  },
)
it.each(['install', 'update'] as const)(
  'refuses %s if the displayed-details binding is missing',
  async (action) => {
    const f = await setup({ installed: action === 'update' }),
      c = await f.connect(),
      shown = await review(c, action)
    const before = await f.snapshot()
    const { releaseDigest, preparation } = shown.consent
    await expect(commit(c, action, { releaseDigest, preparation })).rejects.toMatchObject({
      code: 'policy-refused',
    })
    expect(await f.snapshot()).toEqual(before)
  },
)
it.each(['install', 'update'] as const)(
  'consumes %s display consent even when the supplied hash is wrong',
  async (action) => {
    const f = await setup({ installed: action === 'update' }),
      c = await f.connect(),
      shown = await review(c, action)
    const before = await f.snapshot()
    await expect(
      commit(c, action, { ...shown.consent, displayedDetailsHash: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'policy-refused' })
    await expect(commit(c, action, shown.consent)).rejects.toMatchObject({ code: 'policy-refused' })
    expect(await f.snapshot()).toEqual(before)
  },
)
it.each(['install', 'update'] as const)(
  'public cancel discards %s details and proof without effects',
  async (action) => {
    const f = await setup({ installed: action === 'update' }),
      c = await f.connect(),
      shown = await review(c, action),
      before = await f.snapshot()
    cancelReviews(c)
    await expect(commit(c, action, shown.consent)).rejects.toMatchObject({ code: 'policy-refused' })
    expect(await f.snapshot()).toEqual(before)
  },
)
it.each(['install', 'update'] as const)(
  'rejects tampered %s bytes before displaying details or requesting proof',
  async (action) => {
    const f = await setup({ installed: action === 'update' }),
      c = await f.connect(),
      wire = vi.spyOn(PersonChannel.prototype, 'call')
    f.download.mockResolvedValueOnce(Buffer.from('not the verified archive'))
    const before = await f.snapshot()
    await expect(review(c, action)).rejects.toMatchObject({ code: 'policy-refused' })
    expect(
      wire.mock.calls.filter(([x]) => (x as { kind?: string }).kind === 'prepare-mutation'),
    ).toHaveLength(0)
    expect(await f.snapshot()).toEqual(before)
  },
)
it.each(['transport', 'integrity'] as const)(
  'keeps %s failures distinct while reviewing',
  async (kind) => {
    const f = await setup(),
      c = await f.connect()
    f.download.mockRejectedValueOnce(new PluginDownloadError(kind))
    await expect(review(c, 'install')).rejects.toMatchObject({
      code: kind === 'transport' ? 'network' : 'policy-refused',
    })
  },
)
it('a verified unchanged installed manifest is the comparison control', async () => {
  const f = await setup({ installed: true }),
    shown = await review(await f.connect(), 'update')
  expect(shown.installed).toMatchObject({
    version: '1.0.1',
    digest: f.first.release.archive.sha256,
    authors: ['fern-makers'],
  })
  expect(shown.changes).toEqual({ authors: false, permissions: false })
})
it.each([
  { nextAuthors: ['other-makers'], changePermissions: false, authors: true, permissions: false },
  { nextAuthors: ['fern-makers'], changePermissions: true, authors: false, permissions: true },
])(
  'compares all verified update authors and permissions: $authors/$permissions',
  async (change) => {
    const f = await setup({ installed: true, ...change }),
      shown = await review(await f.connect(), 'update')
    expect(shown.changes).toEqual({ authors: change.authors, permissions: change.permissions })
    expect(shown.details?.permissions).toEqual(f.next.manifest.permissions)
  },
)
it('missing historical authors always count as changed', async () => {
  const f = await setup({ installed: true, legacyInstalled: true }),
    shown = await review(await f.connect(), 'update')
  expect(shown.installed?.authors).toBeNull()
  expect(shown.changes?.authors).toBe(true)
})
it('unreadable installed bytes are unknown and never an unchanged-author exception', async () => {
  const f = await setup({ installed: true })
  const archive = join(f.f.root, 'package-vault', f.first.release.archive.sha256, 'archive')
  const c = await f.connect()
  expect((await review(c, 'update')).installed).not.toBeNull()
  await chmod(archive, 0o600)
  await writeFile(archive, 'tampered installed bytes')
  await chmod(archive, 0o400)
  const shown = await review(c, 'update')
  expect(shown.installed).toBeNull()
  expect(shown.changes).toEqual({ authors: true, permissions: true })
})
it('a changed release after refresh invalidates the displayed details and old consent together', async () => {
  const f = await setup(),
    c = await f.connect(),
    old = await review(c, 'install'),
    next = await f.replaceRelease()
  await c.refreshCatalogue!(pluginSha256(next.bytes), {
    bytes: next.bytes,
    signature: next.signature,
  })
  const before = await f.snapshot()
  await expect(commit(c, 'install', old.consent)).rejects.toMatchObject({ code: 'policy-refused' })
  expect(await f.snapshot()).toEqual(before)
  const shown = await review(c, 'install')
  expect(shown.details).toMatchObject({
    version: '1.0.3',
    authors: ['other-makers'],
    digest: next.release.archive.sha256,
  })
  expect(shown.consent.displayedDetailsHash).not.toBe(old.consent.displayedDetailsHash)
})
it('reviewed disclosure is a clone, not caller-writable stored consent', async () => {
  const f = await setup(),
    c = await f.connect(),
    shown = await review(c, 'install')
  expect(shown.details?.authors).toEqual(['fern-makers'])
  shown.details!.authors![0] = 'forged-makers'
  const fresh = await review(c, 'install')
  expect(fresh.details?.authors).toEqual(['fern-makers'])
  await expect(commit(c, 'install', shown.consent)).rejects.toMatchObject({
    code: 'policy-refused',
  })
  const afterRefusal = await review(c, 'install')
  await commit(c, 'install', afterRefusal.consent)
})
it.each(['install', 'update'] as const)(
  'same-byte owner refresh refuses the reviewed %s once before a fresh review',
  async (action) => {
    const f = await setup({ installed: action === 'update' }),
      c = await f.connect(),
      shown = await review(c, action)
    await f.controller.refreshCatalogue(pluginSha256(f.next.bytes))
    const before = await f.snapshot(),
      wire = vi.spyOn(PersonChannel.prototype, 'call')
    await expect(commit(c, action, shown.consent)).rejects.toMatchObject({ code: 'policy-refused' })
    await expect(commit(c, action, shown.consent)).rejects.toMatchObject({ code: 'policy-refused' })
    expect(
      wire.mock.calls.filter(([x]) => (x as { kind?: string }).kind === action + '-prepared'),
    ).toHaveLength(1)
    expect(await f.snapshot()).toEqual(before)
    const fresh = await review(c, action)
    await commit(c, action, fresh.consent)
    expect((await c.catalogue())[0]).toMatchObject({ installedVersion: '1.0.2' })
  },
)
it('feature change revokes the displayed review through a notification as well as its proof', async () => {
  const f = await setup(),
    c = await f.connect(),
    shown = await review(c, 'install'),
    invalidated = vi.fn()
  const subscribe = Reflect.get(c, 'onReviewInvalidated') as
    ((listener: () => void) => () => void) | undefined
  const stop = subscribe?.call(c, invalidated)
  const original = PersonChannel.prototype.call
  vi.spyOn(PersonChannel.prototype, 'call').mockImplementation(function (
    this: PersonChannel,
    input: unknown,
  ) {
    return (input as { kind?: string }).kind === 'features'
      ? Promise.resolve({ features: ['contributions-v1', 'authors-v1'] })
      : original.call(this, input)
  })
  const before = await f.snapshot()
  expect((await c.catalogue())[0]).toMatchObject({ mutationBlocked: 'owner-incompatible' })
  expect(invalidated).toHaveBeenCalledOnce()
  await expect(commit(c, 'install', shown.consent)).rejects.toThrow()
  expect(await f.snapshot()).toEqual(before)
  stop?.()
})
