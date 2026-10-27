import { afterEach, expect, it, vi } from 'vitest'
import SettingsScreen from '../../src/renderer/src/components/SettingsScreen.vue'
import { providersBridge } from '../../look/fixtures/providers'
import { themesBridge } from '../../look/fixtures/themes'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

it('shows copy size and expiry; Delete now waits, reports failures, and refreshes on success', async () => {
  providersBridge()
  themesBridge('brocrew')
  const copy = {
    id: '11111111-1111-4111-8111-111111111111',
    bytes: 2_500_000_000,
    expiresAt: '2026-11-03T09:00:00.000Z',
    startsLeft: 2,
  }
  let kept: typeof copy | null = copy
  let fail = true
  let finish: (() => void) | undefined
  const deletes: string[] = []
  window.api = {
    ...window.api,
    recoveryRetention: {
      read: async () => kept,
      deleteNow: async (id: string) => {
        deletes.push(id)
        if (fail) throw new Error('unreadable')
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        kept = null
      },
    },
  }
  const m = mount(
    SettingsScreen,
    { tab: 'general', capabilities: null, warnings: null, clock: 0 },
    { width: 1000, height: 800 },
  )
  await vi.waitFor(() => expect(m.q('recovery-retention').textContent).toContain('2.5 GB'))
  expect(m.q('recovery-retention').textContent).toContain('2 more successful starts')
  expect(m.q('recovery-retention').textContent).toContain('2026')
  m.q('recovery-delete').click()
  await vi.waitFor(() =>
    expect(m.q('recovery-retention').textContent).toContain("That didn't work. Try again."),
  )
  expect(m.q('recovery-retention').textContent).toContain('2.5 GB')
  fail = false
  m.q('recovery-delete').click()
  await vi.waitFor(() => expect((m.q('recovery-delete') as HTMLButtonElement).disabled).toBe(true))
  m.q('recovery-delete').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(deletes).toEqual([copy.id, copy.id])
  finish!()
  await vi.waitFor(() =>
    expect(m.q('recovery-retention').textContent).toContain('No recovery copy kept.'),
  )
  expect(m.all('recovery-delete')).toHaveLength(0)
})
