import { afterEach, expect, it, vi } from 'vitest'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import {
  disclosureFixture,
  settingsPeer,
  type DisclosureReview,
} from './plugin-disclosure-fixtures'
import { PluginSupervisorError } from '../src/main/plugins/supervisor/protocol'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import * as policy from '../src/shared/plugin-settings'
vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: vi.fn() }))
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function setup(installed = false) {
  const f = await disclosureFixture({ installed })
  closers.push(f.close)
  const c = await f.connect(),
    a = settingsPeer(c),
    b = settingsPeer(c)
  return { ...f, c, a, b }
}
type WindowReview = Omit<DisclosureReview, 'consent'> & {
  consent: { reviewId: string; displayedDetailsHash: string }
}
async function prepare(peer: ReturnType<typeof settingsPeer>, action: 'install' | 'update') {
  const answer = (await peer.call({ kind: 'prepare', action, id: 'chrome' })) as {
    ok: boolean
    review?: WindowReview
  }
  expect(answer.ok).toBe(true)
  expect(answer.review?.details?.authors).toEqual(['fern-makers'])
  expect(answer.review?.consent.reviewId).toMatch(/^[a-f0-9-]{36}$/)
  expect(answer.review?.consent).not.toHaveProperty('preparation')
  expect(answer.review?.consent).not.toHaveProperty('releaseDigest')
  return answer.review!
}
it.each(['install', 'update'] as const)(
  'real main and client commit reviewed %s without invalidating it in internal close',
  async (action) => {
    const f = await setup(action === 'update'),
      shown = await prepare(f.a, action)
    const answer = await f.a.call({ kind: action, id: 'chrome', consent: shown.consent })
    expect(answer).toMatchObject({
      ok: true,
      cards: [{ installed: true, installedVersion: '1.0.2' }],
    })
    const before = await f.snapshot()
    expect(await f.a.call({ kind: action, id: 'chrome', consent: shown.consent })).toMatchObject({
      ok: false,
      mutationFailure: 'policy-refused',
    })
    expect(await f.snapshot()).toEqual(before)
  },
)
it.each(['install', 'update'] as const)(
  'refuses %s review from another window before sending a commit',
  async (action) => {
    const f = await setup(action === 'update'),
      shown = await prepare(f.a, action),
      before = await f.snapshot(),
      wire = vi.spyOn(PersonChannel.prototype, 'call')
    expect(await f.b.call({ kind: action, id: 'chrome', consent: shown.consent })).toMatchObject({
      ok: false,
      mutationFailure: 'policy-refused',
    })
    expect(
      wire.mock.calls.filter(([x]) => (x as { kind?: string }).kind === action + '-prepared'),
    ).toHaveLength(0)
    expect(await f.snapshot()).toEqual(before)
    expect(await f.a.call({ kind: action, id: 'chrome', consent: shown.consent })).toMatchObject({
      ok: true,
    })
  },
)
it.each(['close', 'configure'] as const)(
  'public %s invalidates issued review before any later install',
  async (kind) => {
    const f = await setup(),
      shown = await prepare(f.a, 'install')
    await f.a.call(
      kind === 'close'
        ? { kind }
        : {
            kind,
            id: 'chrome',
            screenId: '00000000-0000-4000-8000-000000000001',
            bounds: { x: 0, y: 0, width: 800, height: 600 },
          },
    )
    const before = await f.snapshot()
    expect(await f.a.call({ kind: 'install', id: 'chrome', consent: shown.consent })).toMatchObject(
      { ok: false, mutationFailure: 'policy-refused' },
    )
    expect(await f.snapshot()).toEqual(before)
  },
)
it.each(['reviewId', 'displayedDetailsHash'] as const)(
  'changing displayed %s refuses and consumes the review',
  async (field) => {
    const f = await setup(),
      shown = await prepare(f.a, 'install'),
      before = await f.snapshot()
    const consent = {
      ...shown.consent,
      [field]: field === 'reviewId' ? '00000000-0000-4000-8000-000000000002' : 'f'.repeat(64),
    }
    expect(await f.a.call({ kind: 'install', id: 'chrome', consent })).toMatchObject({
      ok: false,
      mutationFailure: 'policy-refused',
    })
    expect(await f.a.call({ kind: 'install', id: 'chrome', consent: shown.consent })).toMatchObject(
      { ok: false, mutationFailure: 'policy-refused' },
    )
    expect(await f.snapshot()).toEqual(before)
  },
)
it('v2 retry refreshes without preparing or committing', async () => {
  const f = await setup(),
    before = await f.snapshot(),
    wire = vi.spyOn(PersonChannel.prototype, 'call')
  expect(await f.a.call({ kind: 'retry', id: 'chrome' })).toMatchObject({ ok: true })
  expect(
    wire.mock.calls.filter(([x]) =>
      /^(prepare-mutation|install|update)/.test(String((x as { kind?: string }).kind)),
    ),
  ).toHaveLength(0)
  expect(await f.snapshot()).toEqual(before)
})
it.each(['closed', 'destroyed', 'render-process-gone', 'did-navigate'] as const)(
  '%s discards the window review before any later commit',
  async (event) => {
    const f = await setup(),
      shown = await prepare(f.a, 'install'),
      before = await f.snapshot()
    if (event === 'closed') f.a.owner.emit(event)
    else f.a.owner.webContents.emit(event)
    expect(await f.a.call({ kind: 'install', id: 'chrome', consent: shown.consent })).toMatchObject(
      {
        ok: false,
        mutationFailure: 'policy-refused',
      },
    )
    expect(await f.snapshot()).toEqual(before)
  },
)
it.each(['did-start-loading', 'did-start-navigation'] as const)(
  'an attempted %s leaves the displayed review usable when navigation is refused',
  async (event) => {
    const f = await setup(),
      shown = await prepare(f.a, 'install'),
      before = await f.snapshot(),
      notifications = f.a.owner.webContents.send.mock.calls.length
    f.a.owner.webContents.emit(event)
    expect(await f.snapshot()).toEqual(before)
    expect(f.a.owner.webContents.send.mock.calls).toHaveLength(notifications)
    expect(await f.a.call({ kind: 'install', id: 'chrome', consent: shown.consent })).toMatchObject(
      {
        ok: true,
        cards: [{ installed: true, installedVersion: '1.0.2' }],
      },
    )
  },
)
it.each([
  [
    'policy-refused',
    "This change couldn't be confirmed. If the plugin now shows as installed or updated, it went through. Otherwise, review it again.",
  ],
  ['network', "Couldn't download this plugin. Check your connection and try again."],
  [
    'source-mismatch',
    'Install and update are unavailable because another BroCrew window on this computer uses a different plugin list. You can still configure or uninstall installed plugins.',
  ],
  [
    'owner-incompatible',
    'Install and update are unavailable until every BroCrew app on this computer is updated and restarted. You can still configure or uninstall installed plugins.',
  ],
  ['unavailable', 'Plugin unavailable. Try again.'],
] as const)('guard 7 maps %s to its honest words', (code, words) => {
  const mapping = Reflect.get(policy, 'pluginMutationFailureNotice') as
    ((code: string) => string) | undefined
  expect(mapping ? mapping(code) : 'Plugin unavailable. Try again.').toBe(words)
})

it('rejects renderer-supplied details, digests and window identities before commit', async () => {
  const f = await setup(),
    shown = await prepare(f.a, 'install'),
    before = await f.snapshot()
  for (const extra of [
    { details: shown.details },
    { releaseDigest: 'f'.repeat(64) },
    { windowId: 'other-window' },
  ]) {
    expect(
      await f.a.call({ kind: 'install', id: 'chrome', consent: shown.consent, ...extra }),
    ).toMatchObject({ ok: false })
  }
  expect(await f.snapshot()).toEqual(before)
})
it('hash input is canonical across property order and covers nested permissions and the installed side', () => {
  const canonical = Reflect.get(policy, 'canonicalPluginDisclosure') as
    ((value: unknown) => string) | undefined
  const encode = canonical ?? JSON.stringify
  const a = {
    action: 'update',
    id: 'chrome',
    catalogueDigest: 'a'.repeat(64),
    details: {
      digest: 'b'.repeat(64),
      version: '1.0.2',
      permissions: { read: true, write: false },
      authors: ['fern-makers'],
    },
    installed: { authors: null },
    changes: { authors: true },
  }
  const b = {
    changes: { authors: true },
    installed: { authors: null },
    details: {
      authors: ['fern-makers'],
      permissions: { write: false, read: true },
      version: '1.0.2',
      digest: 'b'.repeat(64),
    },
    catalogueDigest: 'a'.repeat(64),
    id: 'chrome',
    action: 'update',
  }
  expect(encode(a)).toBe(encode(b))
  expect(encode(a)).not.toBe(encode({ ...a, catalogueDigest: 'c'.repeat(64) }))
  expect(encode(a)).not.toBe(
    encode({ ...a, details: { ...a.details, permissions: { read: true, write: true } } }),
  )
  expect(encode(a)).not.toBe(encode({ ...a, installed: { authors: ['other-makers'] } }))
})
it.each(['\u0000', '\u202e', '\u2067'])(
  'rejects unsafe control or bidi override in displayed permissions: %s',
  (unsafe) => {
    const schema = Reflect.get(policy, 'PluginReleaseDetailsSchema') as
      { safeParse(value: unknown): { success: boolean } } | undefined
    const value = {
      version: '1.0.2',
      digest: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
      authors: ['fern-makers'],
      permissions: { description: 'Read' + unsafe + ' recipes.', resources: [] },
    }
    expect(schema?.safeParse(value).success ?? true).toBe(false)
  },
)

it('a second review replaces the first without accepting the stale review id', async () => {
  const f = await setup(),
    first = await prepare(f.a, 'install'),
    second = await prepare(f.a, 'install')
  expect(second.consent.reviewId).not.toBe(first.consent.reviewId)
  const before = await f.snapshot()
  expect(await f.a.call({ kind: 'install', id: 'chrome', consent: first.consent })).toMatchObject({
    ok: false,
    mutationFailure: 'policy-refused',
  })
  expect(await f.snapshot()).toEqual(before)
})
it('refresh in another window invalidates the displayed review and refuses its commit once', async () => {
  const f = await setup(),
    shown = await prepare(f.b, 'install'),
    before = await f.snapshot()
  expect(await f.a.call({ kind: 'list' })).toMatchObject({ ok: true })
  expect(f.b.owner.webContents.send).toHaveBeenCalledWith('plugins:review-invalidated')
  expect(await f.b.call({ kind: 'install', id: 'chrome', consent: shown.consent })).toMatchObject({
    ok: false,
    mutationFailure: 'policy-refused',
  })
  expect(await f.snapshot()).toEqual(before)
})

it('closing window A invalidates the review displayed by window B', async () => {
  const f = await setup(),
    shown = await prepare(f.b, 'install'),
    before = await f.snapshot()
  expect(await f.a.call({ kind: 'close' })).toMatchObject({ ok: true })
  expect(f.b.owner.webContents.send).toHaveBeenCalledWith('plugins:review-invalidated')
  expect(await f.b.call({ kind: 'install', id: 'chrome', consent: shown.consent })).toMatchObject({
    ok: false,
    mutationFailure: 'policy-refused',
  })
  expect(await f.snapshot()).toEqual(before)
})

it.each(['install', 'update'] as const)(
  'a lost success reply for %s refreshes state without sending the mutation again',
  async (action) => {
    const f = await setup(action === 'update'),
      shown = await prepare(f.a, action)
    const original = PersonChannel.prototype.call
    const wire = vi.spyOn(PersonChannel.prototype, 'call').mockImplementation(async function (
      this: PersonChannel,
      ...args: Parameters<PersonChannel['call']>
    ) {
      const value = await original.apply(this, args)
      if ((args[0] as { kind?: string }).kind === action + '-prepared')
        throw new PluginSupervisorError('unavailable')
      return value
    })
    expect(await f.a.call({ kind: action, id: 'chrome', consent: shown.consent })).toMatchObject({
      ok: false,
      mutationFailure: 'unavailable',
    })
    expect(await f.a.call({ kind: 'list' })).toMatchObject({
      ok: true,
      cards: [{ installed: true, installedVersion: '1.0.2' }],
    })
    expect(await f.a.call({ kind: action, id: 'chrome', consent: shown.consent })).toMatchObject({
      ok: false,
      mutationFailure: 'policy-refused',
    })
    expect(
      wire.mock.calls.filter(
        ([frame]) => (frame as { kind?: string }).kind === action + '-prepared',
      ),
    ).toHaveLength(1)
    expect(wire.mock.calls.some(([frame]) => (frame as { kind?: string }).kind === action)).toBe(
      false,
    )
    expect(f.f.state.inspect().guards[0]?.release.archiveSha256).toBe(f.next.release.archive.sha256)
  },
)
