import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
import { everythingOverTheWire } from '../lib/the-wire'
import { mount, unmountAll } from './harness'
import type {
  PluginCard,
  PluginPackageInspection,
  PluginsClient,
  PluginSettingsReply,
  PluginSettingsRequest,
} from '../../src/shared/plugin-settings'
afterEach(() => unmountAll())
function setup(update = false) {
  let cards: PluginCard[] = [
    {
      id: 'fern-recipes',
      name: 'Fern recipes',
      installed: update,
      state: update ? 'Running' : 'Available',
      ...(update ? { installedVersion: '1.0.1', updateVersion: '1.0.2' } : {}),
    },
  ]
  const inspection: PluginPackageInspection = {
    id: 'fern-recipes',
    name: 'Fern recipes',
    ref: { source: 'https://fictional.invalid/fern.tar.gz', sha256: 'a'.repeat(64), bytes: 1234 },
    manifest: {},
    details: {
      version: '1.0.2',
      digest: 'a'.repeat(64),
      manifestSha256: 'c'.repeat(64),
      authors: ['fern-makers'],
      permissions: {
        description: 'Read fictional recipes.',
        dataUses: ['Store fictional recipe notes.'],
        resources: [
          { id: 'recipes', label: 'Fictional recipes', read: true, write: false },
          { id: 'notes', label: 'Fictional notes', read: false, write: true },
          { id: 'private', label: 'Fictional private collection', read: false, write: false },
        ],
      },
    },
  }
  const invalidations = new Set<() => void>()
  let fail: 'policy-refused' | 'source-mismatch' | 'network' | undefined
  const request = vi.fn(async (input: PluginSettingsRequest): Promise<PluginSettingsReply> => {
    const value = input
    if (value.kind === 'inspect') return { ok: true, inspection }
    if (value.kind === 'install' || value.kind === 'update') {
      if (fail)
        return {
          ok: false,
          error: 'Plugin unavailable. Try again.',
          mutationFailure: fail,
        }
      cards = [
        {
          id: 'fern-recipes',
          name: 'Fern recipes',
          installed: true,
          state: 'Running',
          installedVersion: '1.0.2',
        },
      ]
    }
    return { ok: true, cards }
  })
  const client: PluginsClient = {
    request,
    onClosed: () => () => {},
    onReviewInvalidated(listener: () => void) {
      invalidations.add(listener)
      return () => invalidations.delete(listener)
    },
  }
  return {
    client: everythingOverTheWire(client, 'plugins'),
    request,
    ref: inspection.ref,
    invalidate: () => {
      for (const f of invalidations) f()
    },
    fail: (code: NonNullable<typeof fail>) => {
      fail = code
    },
  }
}
it.each([false, true])(
  'shows inspected authors and every permission before confirming update=%s',
  async (update) => {
    const f = setup(update),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
    expect(
      f.request.mock.calls.some(([x]) =>
        ['install', 'update'].includes(String((x as { kind: string }).kind)),
      ),
    ).toBe(false)
    m.q(update ? 'plugin-review-update' : 'plugin-review-install').click()
    await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
    expect(m.q('plugin-review-details').textContent).toContain('fern-makers')
    expect(m.q('plugin-review-details').textContent).toContain('Fictional recipes')
    expect(m.q('plugin-review-details').textContent).toContain('Read')
    expect(m.q('plugin-review-details').textContent).toContain('Store fictional recipe notes.')
    expect(m.q('plugin-review-details').textContent).toContain(
      'https://fictional.invalid/fern.tar.gz',
    )
    expect(
      [...m.q('plugin-review-details').querySelectorAll('li')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual([
      'Store fictional recipe notes.',
      'Fictional recipes: Read',
      'Fictional notes: Write',
      'Fictional private collection: No access',
    ])
    m.q('plugin-review-confirm').click()
    await vi.waitFor(() =>
      expect(
        f.request.mock.calls.some(
          ([x]) => (x as { kind: string }).kind === (update ? 'update' : 'install'),
        ),
      ).toBe(true),
    )
    const calls = f.request.mock.calls.map(([x]) => x as Record<string, unknown>),
      command = calls.find((x) => x.kind === (update ? 'update' : 'install'))!
    expect(command.package).toEqual(f.ref)
    expect(command.package).not.toBe(f.ref)
    expect(command).not.toHaveProperty('consent')
    const inspectIndex = calls.findIndex((x) => x.kind === 'inspect'),
      commitIndex = calls.indexOf(command)
    expect(calls.slice(inspectIndex + 1, commitIndex).some((x) => x.kind === 'close')).toBe(false)
  },
)
it('removes displayed package details on invalidation and never auto-inspects again', async () => {
  const f = setup(),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  m.q('plugin-review-install').click()
  await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
  f.invalidate()
  await nextTick()
  expect(m.all('plugin-review-details')).toHaveLength(0)
  expect(
    f.request.mock.calls.filter(([x]) => (x as { kind: string }).kind === 'inspect'),
  ).toHaveLength(1)
  expect(f.request.mock.calls.some(([x]) => (x as { kind: string }).kind === 'install')).toBe(false)
})
it.each(['policy-refused', 'source-mismatch', 'network'] as const)(
  'shows honest %s words and refreshes without resending',
  async (cause) => {
    const f = setup(),
      m = mount(PluginsSection, { client: f.client })
    await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
    m.q('plugin-review-install').click()
    await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
    f.fail(cause)
    m.q('plugin-review-confirm').click()
    await vi.waitFor(() => expect(m.all('plugins-error')).toHaveLength(1))
    expect(m.q('plugins-error').textContent).toContain(
      cause === 'policy-refused'
        ? "This change couldn't be confirmed"
        : cause === 'network'
          ? "Couldn't download"
          : 'different plugin list',
    )
    expect(
      f.request.mock.calls.filter(([x]) => (x as { kind: string }).kind === 'install'),
    ).toHaveLength(1)
    expect(
      f.request.mock.calls.filter(([x]) => (x as { kind: string }).kind === 'inspect'),
    ).toHaveLength(1)
    expect(
      f.request.mock.calls.filter(([x]) => (x as { kind: string }).kind === 'list').length,
    ).toBeGreaterThan(1)
    expect(m.all('plugin-review-details')).toHaveLength(0)
  },
)
