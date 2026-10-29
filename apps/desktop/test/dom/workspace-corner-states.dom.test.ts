import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import VersionButton from '../../src/renderer/src/components/VersionButton.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { forgetUpdates } from '../../src/renderer/src/composables/useUpdates'
import type { UpdatesSnapshot, UpdateState } from '../../src/shared/updates'
import { mount, unmountAll } from './harness'
const settle = async () => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}
function setup(state: UpdateState) {
  let listener: ((next: UpdatesSnapshot) => void) | undefined
  const snapshot = (next: UpdateState): UpdatesSnapshot => ({
    version: '0.2.0',
    checkAutomatically: true,
    channel: 'stable',
    state: next,
  })
  const update = {
    read: vi.fn(async () => snapshot(state)),
    onChanged: vi.fn((fn: (next: UpdatesSnapshot) => void) => {
      listener = fn
      return () => {}
    }),
    checkNow: vi.fn(async () => snapshot({ kind: 'checking' })),
    set: vi.fn(async () => snapshot(state)),
    download: vi.fn(async () => snapshot(state)),
    restartWhenQuiet: vi.fn(async () => snapshot(state)),
    cancelRestart: vi.fn(async () => snapshot(state)),
  }
  const workspaces = {
    list: vi.fn(async () => [
      {
        name: 'Harbor',
        path: '/sample/harbor',
        isDefault: true,
        isThisOne: true,
        state: 'open',
        lastOpenedAt: 1,
        readers: null,
      },
      {
        name: 'Meadow',
        path: '/sample/meadow',
        isDefault: false,
        isThisOne: false,
        state: 'closed',
        lastOpenedAt: 0,
        readers: null,
      },
    ]),
    open: vi.fn(async () => ({ opened: true, path: '/sample/meadow', warning: null })),
  }
  const storage = { reveal: vi.fn(async () => ({ ok: true })) }
  Reflect.set(window, 'api', {
    updates: update,
    workspaces,
    storage,
    runtime: { listResumable: async () => [], listUnresumable: async () => [] },
  })
  return { update, workspaces, storage, tell: (next: UpdateState) => listener?.(snapshot(next)) }
}
afterEach(() => {
  unmountAll()
  forgetUpdates()
  Reflect.deleteProperty(window, 'api')
})
it('keeps workspace selection separate from version, then exposes only the selected row’s actions', async () => {
  const { workspaces, storage } = setup({ kind: 'idle', checkedAt: 1, upToDate: true })
  const m = mount(
    SideRail,
    {
      open: [],
      activeId: null,
      place: null,
      workspaceFolder: { name: 'Harbor', path: '/sample/harbor', isDefault: true },
    },
    { width: 251.68, height: 800 },
  )
  await settle()
  m.q('rail-workspace').click()
  await settle()
  expect(m.all('workspace-menu')).toHaveLength(1)
  expect(m.all('updates-menu')).toHaveLength(0)
  expect(m.all('workspace-flyout')).toHaveLength(0)
  expect(m.all('workspace-rename')).toHaveLength(0)
  m.all('workspace-open')[0]!.click()
  await settle()
  expect(m.all('workspace-reveal')).toHaveLength(1)
  m.q('workspace-reveal').click()
  await settle()
  expect(storage.reveal).toHaveBeenCalledWith()
  m.all('workspace-open')[1]!.click()
  await settle()
  expect(workspaces.open).not.toHaveBeenCalled()
  m.q('workspace-open-selected').click()
  await settle()
  expect(workspaces.open).toHaveBeenCalledWith('/sample/meadow')
  m.q('rail-version').click()
  await settle()
  expect(m.all('workspace-menu')).toHaveLength(0)
  expect(m.all('updates-menu')).toHaveLength(1)
  expect(m.all('workspaces')).toHaveLength(0)
})
it('wires refresh and follows checking, offered, progress, ready, dev and error states', async () => {
  const { update, tell } = setup({ kind: 'idle', checkedAt: 1, upToDate: true })
  const m = mount(VersionButton, { open: false }, { width: 300, height: 300 })
  await settle()
  expect(m.q('rail-version').textContent).toContain('v0.2.0 ✓')
  m.q('rail-version-check').click()
  await settle()
  expect(update.checkNow).toHaveBeenCalledTimes(1)
  expect((m.q('rail-version-check') as HTMLButtonElement).disabled).toBe(true)
  tell({ kind: 'available', version: '0.3.0' })
  await settle()
  expect(m.q('rail-version').textContent).toContain('Update to 0.3.0')
  expect(m.q('rail-version-control').classList.contains('offered')).toBe(true)
  tell({ kind: 'downloading', version: '0.3.0', percent: 48 })
  await settle()
  expect((m.q('rail-update-progress') as HTMLProgressElement).value).toBe(48)
  tell({ kind: 'ready', version: '0.3.0', how: 'restart', path: null })
  await settle()
  expect(m.q('rail-version').textContent).toContain('Update to 0.3.0')
  tell({ kind: 'not-here', why: 'a-development-build' })
  await settle()
  expect((m.q('rail-version-check') as HTMLButtonElement).disabled).toBe(true)
  tell({ kind: 'error', message: 'Example service unavailable', at: 1 })
  await settle()
  expect((m.q('rail-version-check') as HTMLButtonElement).disabled).toBe(false)
})
it('reports a refused check instead of silently losing the error', async () => {
  const { update, tell } = setup({ kind: 'idle', checkedAt: null, upToDate: false })
  update.checkNow.mockRejectedValueOnce(new Error('Example check failed'))
  const m = mount(VersionButton, { open: false }, { width: 300, height: 300 })
  await settle()
  m.q('rail-version-check').click()
  await settle()
  expect(m.host.querySelector('[role="alert"]')?.textContent).toContain('Example check failed')
  expect(m.q('rail-version').textContent).toContain('Check failed')
  tell({ kind: 'available', version: '0.3.0' })
  await settle()
  expect(m.host.querySelector('[role="alert"]')).toBeNull()
  expect(m.q('rail-version').textContent).toContain('Update to 0.3.0')
})
