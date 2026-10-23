import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
import { everythingOverTheWire } from '../lib/the-wire'
import { mount, unmountAll } from './harness'
import type { PluginSettingsReply } from '../../src/shared/plugin-settings'
afterEach(() => unmountAll())
function setup(update = false) {
  let cards = [
    {
      id: 'chrome',
      name: 'Chrome',
      installed: update,
      state: update ? 'Running' : 'Available',
      preparationRequired: true,
      ...(update ? { installedVersion: '1.0.1', updateVersion: '1.0.2' } : {}),
    },
  ]
  const consent = {
    reviewId: '00000000-0000-4000-8000-000000000001',
    displayedDetailsHash: 'b'.repeat(64),
  }
  const review = {
    id: 'chrome',
    action: update ? 'update' : 'install',
    catalogueDigest: 'd'.repeat(64),
    consent,
    details: {
      version: '1.0.2',
      digest: 'a'.repeat(64),
      manifestSha256: 'c'.repeat(64),
      authors: ['fern-makers'],
      permissions: {
        description: 'Read fictional recipes.',
        resources: [{ id: 'recipes', label: 'Fictional recipes', read: true, write: false }],
      },
    },
    installed: null,
    changes: { authors: true, permissions: true },
  }
  const invalidations = new Set<() => void>()
  let fail: string | undefined
  const request = vi.fn(async (input: unknown): Promise<PluginSettingsReply> => {
    const value = input as Record<string, unknown>
    if (value.kind === 'prepare') return { ok: true, review } as unknown as PluginSettingsReply
    if (value.kind === 'install' || value.kind === 'update') {
      if (fail)
        return {
          ok: false,
          error: 'Plugin unavailable. Try again.',
          mutationFailure: fail,
        } as unknown as PluginSettingsReply
      cards = [
        {
          id: 'chrome',
          name: 'Chrome',
          installed: true,
          state: 'Running',
          preparationRequired: true,
          installedVersion: '1.0.2',
        },
      ]
    }
    return { ok: true, cards } as PluginSettingsReply
  })
  const client = {
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
    consent,
    invalidate: () => {
      for (const f of invalidations) f()
    },
    fail: (code: string) => {
      fail = code
    },
  }
}
it.each([false, true])(
  'shows verified authors and every permission before confirming update=%s',
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
    if (update)
      expect(m.q('plugin-review-details').textContent).toContain(
        "The installed version's details couldn't be checked, so all its authors and permissions are shown as new.",
      )
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
    expect(command.consent).toEqual(f.consent)
    const prepareIndex = calls.findIndex((x) => x.kind === 'prepare'),
      commitIndex = calls.indexOf(command)
    expect(calls.slice(prepareIndex + 1, commitIndex).some((x) => x.kind === 'close')).toBe(false)
  },
)
it('removes displayed consent on invalidation and never auto-renews it', async () => {
  const f = setup(),
    m = mount(PluginsSection, { client: f.client })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  m.q('plugin-review-install').click()
  await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
  f.invalidate()
  await nextTick()
  expect(m.all('plugin-review-details')).toHaveLength(0)
  expect(
    f.request.mock.calls.filter(([x]) => (x as { kind: string }).kind === 'prepare'),
  ).toHaveLength(1)
  expect(f.request.mock.calls.some(([x]) => (x as { kind: string }).kind === 'install')).toBe(false)
})
it.each(['policy-refused', 'source-mismatch', 'network'])(
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
      f.request.mock.calls.filter(([x]) => (x as { kind: string }).kind === 'prepare'),
    ).toHaveLength(1)
    expect(
      f.request.mock.calls.filter(([x]) => (x as { kind: string }).kind === 'list').length,
    ).toBeGreaterThan(1)
    expect(m.all('plugin-review-details')).toHaveLength(0)
  },
)
