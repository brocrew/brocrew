import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
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
    appVersion: '0.1.9',
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
  expect(m.q('recovery-retention').textContent).toContain('made before the update to 0.1.9')
  m.q('recovery-delete').click()
  await nextTick()
  expect(deletes).toEqual([])
  expect(m.q('recovery-delete-confirmation').textContent).toContain(
    "Delete the recovery copy? You can't go back to the earlier version after this.",
  )
  m.q('recovery-delete-cancel').click()
  await nextTick()
  expect(m.all('recovery-delete-confirmation')).toHaveLength(0)
  expect(deletes).toEqual([])
  m.q('recovery-delete').click()
  await nextTick()
  m.q('recovery-delete-confirm').click()
  await vi.waitFor(() =>
    expect(m.q('recovery-retention').textContent).toContain(
      "Couldn't delete the recovery copy. Try again.",
    ),
  )
  expect(m.q('recovery-retention').textContent).toContain('2.5 GB')
  fail = false
  m.q('recovery-delete').click()
  await nextTick()
  m.q('recovery-delete-confirm').click()
  await vi.waitFor(() =>
    expect((m.q('recovery-delete-confirm') as HTMLButtonElement).disabled).toBe(true),
  )
  m.q('recovery-delete-confirm').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(deletes).toEqual([copy.id, copy.id])
  finish!()
  await vi.waitFor(() =>
    expect(m.q('recovery-retention').textContent).toContain('No recovery copy kept.'),
  )
  expect(m.all('recovery-delete')).toHaveLength(0)
})
