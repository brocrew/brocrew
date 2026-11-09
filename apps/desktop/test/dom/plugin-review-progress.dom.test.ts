import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type {
  PluginsClient,
  PluginReviewProgress,
  PluginSettingsReply,
  PluginSettingsRequest,
  PluginWindowReview,
} from '../../src/shared/plugin-settings'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
import ProgressBar from '../../src/renderer/src/components/ProgressBar.vue'
import { mount, unmountAll } from './harness'

afterEach(() => unmountAll())

function reviewTransfer(update = false) {
  const calls: PluginSettingsRequest[] = []
  const listeners = new Set<(progress: PluginReviewProgress) => void>()
  const captured: ((progress: PluginReviewProgress) => void)[] = []
  const invalidations = new Set<() => void>()
  const pending: {
    input: Extract<PluginSettingsRequest, { kind: 'prepare' }>
    reply: (answer: PluginSettingsReply) => void
  }[] = []
  const cancelled: (() => void)[] = []
  const client: PluginsClient = {
    request(input) {
      calls.push(input)
      if (input.kind === 'prepare') {
        expect(listeners.size).toBe(1)
        expect(input.requestId).toMatch(/^[a-f0-9-]{36}$/)
        return new Promise((reply) => pending.push({ input, reply }))
      }
      if (input.kind === 'cancel-prepare')
        return new Promise((reply) => cancelled.push(() => reply({ ok: true })))
      return Promise.resolve({
        ok: true,
        cards: ['chrome', 'fictional-maps'].map((id) => ({
          id,
          name: id === 'chrome' ? 'Chrome' : 'Fictional Maps',
          installed: update,
          state: update ? 'Running' : 'Available',
          preparationRequired: true,
          ...(update ? { installedVersion: '1.0.1', updateVersion: '1.0.2' } : {}),
        })),
      })
    },
    onClosed: () => () => {},
    onReviewInvalidated(listener) {
      invalidations.add(listener)
      return () => invalidations.delete(listener)
    },
    onReviewProgress(listener) {
      listeners.add(listener)
      captured.push(listener)
      return () => listeners.delete(listener)
    },
  }
  function progress(index: number, values: Partial<PluginReviewProgress> = {}) {
    const input = pending[index]!.input
    captured[index]!({
      id: input.id,
      requestId: input.requestId!,
      phase: 'downloading',
      receivedBytes: 25,
      totalBytes: 100,
      ...values,
    })
  }
  function succeed(index: number) {
    const input = pending[index]!.input
    const review: PluginWindowReview = {
      id: input.id,
      action: input.action,
      catalogueDigest: 'd'.repeat(64),
      consent: { reviewId: crypto.randomUUID(), displayedDetailsHash: 'b'.repeat(64) },
      details: {
        version: '1.0.2',
        digest: 'a'.repeat(64),
        manifestSha256: 'c'.repeat(64),
        authors: ['fern-makers'],
        permissions: { description: 'Read fictional recipes.', resources: [] },
      },
      installed: null,
      changes: { authors: true, permissions: true },
    }
    pending[index]!.reply({ ok: true, review })
  }
  return { client, calls, pending, listeners, invalidations, cancelled, progress, succeed }
}

it.each([false, true])(
  'shows real review bytes, unknown totals and checking without granting consent early (update=%s)',
  async (update) => {
    const f = reviewTransfer(update),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
    m.q(update ? 'plugin-review-update' : 'plugin-review-install').click()
    await vi.waitFor(() => expect(f.pending).toHaveLength(1))
    expect(m.all('plugin-review-progress')).toHaveLength(0)
    expect(m.q('plugin-prepare-cancel').hasAttribute('disabled')).toBe(false)
    f.progress(0)
    await nextTick()
    const bar = m.q('plugin-review-progress') as HTMLProgressElement
    expect(bar.value).toBe(25)
    expect(bar.max).toBe(100)
    expect(bar.getAttribute('aria-labelledby')).toBe(m.q('plugin-review-progress-label').id)
    expect(m.q('plugin-review-progress-label').textContent).toContain('25 of 100 bytes')
    expect(m.host.querySelector('[data-plugin="fictional-maps"] progress')).toBeNull()
    expect(m.all('plugin-review-details')).toHaveLength(0)
    expect(f.calls.some((c) => c.kind === 'install' || c.kind === 'update')).toBe(false)
    f.progress(0, { requestId: crypto.randomUUID(), receivedBytes: 99 })
    await nextTick()
    expect(bar.value).toBe(25)
    f.progress(0, { totalBytes: undefined, receivedBytes: 30 })
    await nextTick()
    expect(bar.hasAttribute('value')).toBe(false)
    expect(m.q('plugin-review-progress-label').textContent).toContain('30 bytes')
    f.progress(0, { phase: 'checking', receivedBytes: 100 })
    await nextTick()
    expect(bar.hasAttribute('value')).toBe(false)
    expect(m.q('plugin-review-progress-label').textContent).toContain('Checking Chrome')
    f.progress(0, { phase: 'downloading', receivedBytes: 2, totalBytes: 20 })
    await nextTick()
    expect(bar.value).toBe(2)
    expect(bar.max).toBe(20)
    f.succeed(0)
    await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
    expect(m.all('plugin-review-progress')).toHaveLength(0)
    expect(f.listeners.size).toBe(0)
  },
)

it.each(['chrome', 'fictional-maps'])(
  'targets cancel and ignores late same/window-card replies before reviewing %s',
  async (nextId) => {
    const f = reviewTransfer(),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
    m.q('plugin-review-install').click()
    await vi.waitFor(() => expect(f.pending).toHaveLength(1))
    f.progress(0)
    await nextTick()
    m.q('plugin-prepare-cancel').click()
    await nextTick()
    expect(f.calls.filter((c) => c.kind === 'cancel-prepare')).toEqual([
      { kind: 'cancel-prepare', id: 'chrome', requestId: f.pending[0]!.input.requestId },
    ])
    expect(f.calls.some((c) => c.kind === 'close')).toBe(false)
    expect(f.listeners.size).toBe(0)
    m.host
      .querySelector<HTMLButtonElement>(
        `[data-plugin="${nextId}"] [data-cy="plugin-review-install"]`,
      )!
      .click()
    await vi.waitFor(() => expect(f.pending).toHaveLength(2))
    expect(f.pending[1]!.input.requestId).not.toBe(f.pending[0]!.input.requestId)
    expect(m.all('plugin-review-progress')).toHaveLength(0)
    expect(m.q('plugin-review-progress-label').textContent).toContain('Preparing plugin review')
    f.progress(1, { receivedBytes: 50 })
    f.progress(1, { id: nextId === 'chrome' ? 'fictional-maps' : 'chrome', receivedBytes: 90 })
    f.progress(0, { receivedBytes: 99 })
    f.succeed(0)
    f.cancelled[0]!()
    await nextTick()
    expect((m.q('plugin-review-progress') as HTMLProgressElement).value).toBe(50)
    expect(m.all('plugin-review-details')).toHaveLength(0)
    expect(m.q('plugin-prepare-cancel').hasAttribute('disabled')).toBe(false)
    f.succeed(1)
    await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
    expect(
      m.host.querySelector(`[data-plugin="${nextId}"] [data-cy="plugin-review-details"]`),
    ).not.toBeNull()
    f.progress(1)
    await nextTick()
    expect(m.all('plugin-review-progress')).toHaveLength(0)
  },
)

it.each(['network', 'download-stalled'] as const)(
  'cleans up review progress and preserves the actual %s failure',
  async (failure) => {
    const f = reviewTransfer(),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
    m.q('plugin-review-install').click()
    await vi.waitFor(() => expect(f.pending).toHaveLength(1))
    f.progress(0)
    f.pending[0]!.reply({
      ok: false,
      error: 'Plugin unavailable. Try again.',
      mutationFailure: failure,
    })
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    expect(m.q('plugins-error').textContent).toContain(
      failure === 'network' ? "Couldn't download" : 'The plugin download stalled. Try again.',
    )
    expect(f.listeners.size).toBe(0)
    f.progress(0)
    await nextTick()
    expect(m.all('plugin-review-progress')).toHaveLength(0)
    expect(m.all('plugin-review-details')).toHaveLength(0)
    expect(m.q('plugin-review-install').hasAttribute('disabled')).toBe(false)
  },
)

it('retires pending progress on invalidation and unmount, including already queued callbacks', async () => {
  const f = reviewTransfer(),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  m.q('plugin-review-install').click()
  await vi.waitFor(() => expect(f.pending).toHaveLength(1))
  for (const invalidate of f.invalidations) invalidate()
  f.progress(0)
  f.succeed(0)
  await nextTick()
  expect(m.all('plugin-review-progress')).toHaveLength(0)
  expect(m.all('plugin-review-details')).toHaveLength(0)
  expect(f.listeners.size).toBe(0)
  expect(m.q('plugins-error').textContent).toContain('This plugin review is no longer current.')
  m.q('plugin-review-install').click()
  await vi.waitFor(() => expect(f.pending).toHaveLength(2))
  m.unmount()
  f.progress(1)
  f.succeed(1)
  await nextTick()
  expect(f.listeners.size).toBe(0)
  expect(f.invalidations.size).toBe(0)
  expect(f.calls.filter((c) => c.kind === 'cancel-prepare')).toHaveLength(2)
})

it.each([
  { phase: 'downloading', received: 20, total: 100, value: '20' },
  { phase: 'downloading', received: 120, total: 100, value: '100' },
  { phase: 'downloading', received: 20, total: undefined, value: null },
  { phase: 'downloading', received: 20, total: 0, value: null },
  { phase: 'checking', received: 100, total: 100, value: null },
] as const)('renders the generic progress primitive honestly: %j', (example) => {
  const m = mount(ProgressBar, {
    phase: example.phase,
    received: example.received,
    total: example.total,
    'aria-label': 'Fictional transfer',
  })
  const progress = m.host.querySelector('progress')!
  expect(progress.getAttribute('value')).toBe(example.value)
  expect(progress.getAttribute('aria-label')).toBe('Fictional transfer')
})

it('keeps Configure visible when a cancelled review replies after configuration starts', async () => {
  const f = reviewTransfer(true),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  m.q('plugin-review-update').click()
  await vi.waitFor(() => expect(f.pending).toHaveLength(1))
  m.q('plugin-prepare-cancel').click()
  await nextTick()
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.calls.some((call) => call.kind === 'configure')).toBe(true))
  f.progress(0)
  f.succeed(0)
  await nextTick()
  expect(m.all('plugin-configuration')).toHaveLength(1)
  expect(m.all('plugin-review-transfer')).toHaveLength(0)
  expect(m.all('plugin-review-details')).toHaveLength(0)
  expect(m.all('plugins-error')).toHaveLength(0)
})

it('keeps simultaneous Settings windows scoped to their own request', async () => {
  const first = reviewTransfer(),
    second = reviewTransfer(),
    a = mount(PluginsSection, { client: first.client }),
    b = mount(PluginsSection, { client: second.client })
  await vi.waitFor(() => {
    expect(a.all('plugin-card')).toHaveLength(2)
    expect(b.all('plugin-card')).toHaveLength(2)
  })
  a.q('plugin-review-install').click()
  b.q('plugin-review-install').click()
  await vi.waitFor(() => {
    expect(first.pending).toHaveLength(1)
    expect(second.pending).toHaveLength(1)
  })
  expect(first.pending[0]!.input.requestId).not.toBe(second.pending[0]!.input.requestId)
  first.progress(0, { requestId: second.pending[0]!.input.requestId })
  second.progress(0, { requestId: first.pending[0]!.input.requestId })
  await nextTick()
  expect(a.all('plugin-review-progress')).toHaveLength(0)
  expect(b.all('plugin-review-progress')).toHaveLength(0)
  first.progress(0, { receivedBytes: 12 })
  second.progress(0, { receivedBytes: 34 })
  await nextTick()
  expect((a.q('plugin-review-progress') as HTMLProgressElement).value).toBe(12)
  expect((b.q('plugin-review-progress') as HTMLProgressElement).value).toBe(34)
  a.q('plugin-prepare-cancel').click()
  await nextTick()
  expect(first.listeners.size).toBe(0)
  expect(second.listeners.size).toBe(1)
  expect((b.q('plugin-review-progress') as HTMLProgressElement).value).toBe(34)
})

it('retains the action and producer detail on a failed review', async () => {
  const f = reviewTransfer(),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(2))
  m.q('plugin-review-install').click()
  await vi.waitFor(() => expect(f.pending).toHaveLength(1))
  f.pending[0]!.reply({
    ok: false,
    error: 'Plugin unavailable. Try again.',
    detail: 'The Settings request failed before a reply was received.',
  })
  await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
  expect(m.q('plugins-error').textContent).toBe(
    "Couldn't review install of Chrome. The Settings request failed before a reply was received. Try again.",
  )
  expect(f.listeners.size).toBe(0)
})
