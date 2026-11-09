import { afterEach, expect, it, vi } from 'vitest'
import type {
  PluginCard,
  PluginsClient,
  PluginSettingsRequest,
  PluginSettingsReply,
  PluginWindowReview,
} from '../../src/shared/plugin-settings'
import { nextTick } from 'vue'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
import { mount, unmountAll } from './harness'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'

afterEach(() => {
  unmountAll()
  applyTheme(null)
  Reflect.deleteProperty(window, 'api')
})

function actionFailures(card: Partial<PluginCard> = {}) {
  const cards: PluginCard[] = [
    {
      id: 'chrome',
      name: 'Chrome',
      installed: true,
      state: card.installed === false ? 'Available' : 'Running',
      ...(card.installed === false ? {} : { installedVersion: '1.0.1', updateVersion: '1.0.2' }),
      ...card,
    },
  ]
  const calls: PluginSettingsRequest[] = []
  const faults = new Map<
    PluginSettingsRequest['kind'],
    (input: PluginSettingsRequest) => PluginSettingsReply | Promise<PluginSettingsReply>
  >()
  const invalidations = new Set<() => void>()
  const closed = new Set<(id: string) => void>()
  const review: PluginWindowReview = {
    id: 'chrome',
    action: cards[0]!.installed ? 'update' : 'install',
    catalogueDigest: 'd'.repeat(64),
    consent: { reviewId: crypto.randomUUID(), displayedDetailsHash: 'b'.repeat(64) },
    details: {
      version: '1.0.2',
      digest: 'a'.repeat(64),
      manifestSha256: 'c'.repeat(64),
      authors: ['fern-makers'],
      permissions: { description: 'Fictional recipes', resources: [] },
    },
    installed: null,
    changes: { authors: true, permissions: true },
  }
  const client: PluginsClient = {
    async request(input) {
      calls.push(input)
      const fault = faults.get(input.kind)
      if (fault) return fault(input)
      return input.kind === 'prepare'
        ? { ok: true, review }
        : { ok: true, cards: cards.map((c) => ({ ...c })) }
    },
    onClosed(listener) {
      closed.add(listener)
      return () => closed.delete(listener)
    },
    onReviewInvalidated(listener) {
      invalidations.add(listener)
      return () => invalidations.delete(listener)
    },
  }
  return { cards, calls, faults, review, client, invalidations, closed }
}
const actionRefused: PluginSettingsReply = {
  ok: false,
  error: 'Plugin unavailable. Try again.',
  detail: 'The fictional owner refused this action.',
  mutationFailure: 'unavailable',
  stack: 'fictional-private-stack',
}

it.each([
  'review-install',
  'review-update',
  'install',
  'update',
  'uninstall',
  'configure',
  'retry',
  'restart',
  'guarded-install',
  'guarded-update',
])(
  'shows the active %s action and public cause instead of silently re-enabling it',
  async (action) => {
    const install =
        action === 'install' || action === 'review-install' || action === 'guarded-install',
      guarded = action.startsWith('guarded'),
      review = action.startsWith('review') || guarded
    const f = actionFailures({
      installed: !install,
      ...(review ? { preparationRequired: true } : {}),
      ...(action === 'retry' ? { state: 'Unavailable' } : {}),
      ...(action === 'restart' ? { toolsUnavailable: true, canRestart: true } : {}),
    })
    const kind = action.startsWith('review')
      ? 'prepare'
      : guarded
        ? install
          ? 'install'
          : 'update'
        : action
    if (
      !['prepare', 'install', 'update', 'uninstall', 'configure', 'retry', 'restart'].includes(kind)
    )
      throw new Error('unexpected action')
    const inputKind = kind as PluginSettingsRequest['kind']
    const m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
    if (guarded) {
      m.q(install ? 'plugin-review-install' : 'plugin-review-update').click()
      await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
    }
    f.faults.set(inputKind, () => actionRefused)
    m.q(guarded ? 'plugin-review-confirm' : `plugin-${action}`).click()
    if (action === 'uninstall') {
      await nextTick()
      m.q('plugin-uninstall-confirm').click()
    }
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    const text = m.q('plugins-error').textContent!
    expect(text).toContain("Couldn't")
    expect(text).toContain('Chrome')
    expect(text).toContain('The fictional owner refused this action.')
    expect(text).toContain('Try again')
    expect(text).not.toContain("This change couldn't be confirmed")
    expect(m.host.textContent).not.toContain('fictional-private-stack')
  },
)

it('reports a rejected bridge without exposing the private rejection or replacing it with a consent warning', async () => {
  const f = actionFailures({ state: 'Unavailable' }),
    m = mount(PluginsSection, { client: f.client })
  f.faults.set('retry', () => {
    throw new Error('fictional-private-view-path')
  })
  await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
  m.q('plugin-retry').click()
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  expect(m.q('plugins-error').textContent).toContain('Settings request failed')
  expect(m.q('plugins-error').textContent).toContain('Try again')
  expect(m.host.textContent).not.toContain('fictional-private-view-path')
})

it.each(['retry', 'restart'] as const)(
  'reports an unchanged degraded status after %s',
  async (action) => {
    const f = actionFailures(
        action === 'retry'
          ? { state: 'Unavailable' }
          : { toolsUnavailable: true, canRestart: true },
      ),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all(`plugin-${action}`)).toHaveLength(1))
    m.q(`plugin-${action}`).click()
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    expect(m.q('plugins-error').textContent).toContain(
      action === 'retry' ? 'start Chrome again' : 'after the restart request',
    )
    expect(m.all('plugin-install')).toHaveLength(0)
  },
)

it('does not install after a failed prerequisite close', async () => {
  const f = actionFailures({ installed: false }),
    m = mount(PluginsSection, { client: f.client })
  f.faults.set('close', () => actionRefused)
  await vi.waitFor(() => expect(m.all('plugin-install')).toHaveLength(1))
  m.q('plugin-install').click()
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  expect(m.q('plugins-error').textContent).toContain('close')
  expect(m.q('plugins-error').textContent).toContain('The fictional owner refused this action.')
  expect(f.calls.filter((c) => c.kind === 'install')).toHaveLength(0)
  expect(m.q('plugin-install').hasAttribute('disabled')).toBe(false)
  f.faults.delete('close')
})

it.each(['configuration', 'review'])(
  'reports an active failed %s close, but ignores the same failure after replacement',
  async (view) => {
    const f = actionFailures({ preparationRequired: true }),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
    const open = async () => {
      m.q(view === 'configuration' ? 'plugin-configure' : 'plugin-review-update').click()
      await vi.waitFor(() =>
        expect(
          m.all(view === 'configuration' ? 'plugin-stage' : 'plugin-review-details'),
        ).toHaveLength(1),
      )
    }
    await open()
    f.faults.set('close', () => actionRefused)
    m.q(view === 'configuration' ? 'plugin-close' : 'plugin-review-cancel').click()
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    expect(m.q('plugins-error').textContent).toContain('close')
    let finish!: (reply: PluginSettingsReply) => void
    f.faults.delete('close')
    await open()
    f.faults.set(
      'close',
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    m.q(view === 'configuration' ? 'plugin-close' : 'plugin-review-cancel').click()
    await nextTick()
    await open()
    finish(actionRefused)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(m.all('plugins-error')).toHaveLength(0)
    expect(m.all(view === 'configuration' ? 'plugin-stage' : 'plugin-review-details')).toHaveLength(
      1,
    )
    f.faults.delete('close')
  },
)

it('preserves the active bounds failure and a failed cleanup close without losing either cause', async () => {
  const f = actionFailures(),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-configure')).toHaveLength(1))
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.calls.some((c) => c.kind === 'configure')).toBe(true))
  await vi.waitFor(() => expect(m.q('plugin-stage').getAttribute('aria-busy')).toBe('false'))
  f.faults.set('bounds', () => actionRefused)
  f.faults.set('close', () => ({
    ok: false,
    error: 'Plugin unavailable. Try again.',
    detail: 'The fictional page could not close.',
  }))
  window.dispatchEvent(new Event('resize'))
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  await vi.waitFor(() =>
    expect(m.q('plugins-error').textContent).toContain('The fictional page could not close.'),
  )
  expect(m.q('plugins-error').textContent).toContain('The fictional owner refused this action.')
  expect(m.q('plugins-error').textContent).toContain('resize')
  f.faults.delete('close')
})

it('reports an externally invalidated review without restoring late consent or failures', async () => {
  const f = actionFailures({ preparationRequired: true }),
    m = mount(PluginsSection, { client: f.client })
  let finish!: (reply: PluginSettingsReply) => void
  f.faults.set(
    'prepare',
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await vi.waitFor(() => expect(m.all('plugin-review-update')).toHaveLength(1))
  m.q('plugin-review-update').click()
  await vi.waitFor(() => expect(f.calls.some((c) => c.kind === 'prepare')).toBe(true))
  for (const invalidate of f.invalidations) invalidate()
  finish({ ok: true, review: f.review })
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(m.all('plugin-review-details')).toHaveLength(0)
  expect(m.q('plugins-error').textContent).toContain('review is no longer current')
  expect(m.q('plugins-error').textContent).toContain('Review it again')
  expect(m.q('plugin-review-update').hasAttribute('disabled')).toBe(false)
  m.q('plugin-review-update').click()
  await nextTick()
  m.unmount()
  finish(actionRefused)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(m.host.textContent).toBe('')
  expect(f.invalidations.size).toBe(0)
  expect(f.closed.size).toBe(0)
})

it.each([
  ['network', "Couldn't download this plugin. Check your connection and try again."],
  ['download-stalled', 'The plugin download stalled. Try again.'],
  [
    'package-invalid',
    "Couldn't verify this plugin package. Download it again or contact its publisher.",
  ],
] as const)(
  'shows the public %s cause once when the producer supplies that same detail',
  async (mutationFailure, detail) => {
    const f = actionFailures({ preparationRequired: true }),
      m = mount(PluginsSection, { client: f.client })
    f.faults.set('prepare', () => ({
      ok: false,
      error: 'Plugin unavailable. Try again.',
      detail,
      mutationFailure,
    }))
    await vi.waitFor(() => expect(m.all('plugin-review-update')).toHaveLength(1))
    m.q('plugin-review-update').click()
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    const text = m.q('plugins-error').textContent!
    expect(text).toContain('review update of Chrome')
    expect(text.split(detail)).toHaveLength(2)
  },
)

it('reports a missing reply for the current clicked action', async () => {
  const f = actionFailures({ state: 'Unavailable' }),
    m = mount(PluginsSection, { client: f.client })
  f.faults.set('retry', () => undefined as unknown as PluginSettingsReply)
  await vi.waitFor(() => expect(m.all('plugin-retry')).toHaveLength(1))
  m.q('plugin-retry').click()
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  expect(m.q('plugins-error').textContent).toContain('did not return a reply')
  expect(m.q('plugins-error').textContent).toContain('start Chrome again')
  expect(m.q('plugin-retry').hasAttribute('disabled')).toBe(false)
})

it('keeps an old pre-close failure from installing or showing an error after unmount', async () => {
  const f = actionFailures({ installed: false }),
    m = mount(PluginsSection, { client: f.client })
  const finishes: ((reply: PluginSettingsReply) => void)[] = []
  f.faults.set('close', () => new Promise((resolve) => finishes.push(resolve)))
  await vi.waitFor(() => expect(m.all('plugin-install')).toHaveLength(1))
  m.q('plugin-install').click()
  await vi.waitFor(() => expect(finishes).toHaveLength(1))
  m.unmount()
  finishes[0]!(actionRefused)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(f.calls.filter((c) => c.kind === 'install')).toHaveLength(0)
  expect(m.host.textContent).toBe('')
  f.faults.delete('close')
})

it('keeps the mutation cause visible when its follow-up catalogue refresh also fails', async () => {
  const f = actionFailures({ preparationRequired: true }),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-review-update')).toHaveLength(1))
  m.q('plugin-review-update').click()
  await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
  f.faults.set('update', () => actionRefused)
  f.faults.set('list', () => ({ ok: false, listState: 'fetch-error' }))
  m.q('plugin-review-confirm').click()
  await vi.waitFor(() =>
    expect(m.q('plugins-error').textContent).toContain('The fictional owner refused this action.'),
  )
  await vi.waitFor(() =>
    expect(m.q('plugins-error').textContent).toContain('plugin list could not be refreshed'),
  )
  expect(m.all('plugin-review-details')).toHaveLength(0)
  expect(f.calls.filter((c) => c.kind === 'update')).toHaveLength(1)
})
