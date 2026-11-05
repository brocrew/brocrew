import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PluginsSection from '../../src/renderer/src/components/PluginsSection.vue'
import type { PluginHostClient } from '../../src/shared/plugin-host'
import type {
  PluginCard,
  PluginSettingsReply,
  PluginSettingsRequest,
} from '../../src/shared/plugin-settings'
import { fictionalPlugins } from '../../look/fixtures/plugins'
import { mount, unmountAll, type Mounted } from './harness'

const cleanup = new Set<() => void>()
afterEach(() => {
  unmountAll()
  for (const release of cleanup) release()
  cleanup.clear()
  Reflect.deleteProperty(window, 'api')
})

const fir: PluginCard = {
  id: 'fictional-fir',
  name: 'Fictional Fir',
  installed: true,
  state: 'Running',
  updateVersion: '2.0.0',
}
async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
function fixture(initial: PluginCard = fir) {
  const f = fictionalPlugins()
  let cards = [structuredClone(initial)]
  f.set(cards)
  const listeners = new Set<() => void>()
  const host: PluginHostClient = {
    async request(input) {
      structuredClone(input)
      return { value: { contributions: [], notifications: [], settingsViews: [] } }
    },
    onChanged(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { pluginHost: host } })
  type Hold = {
    entered: boolean
    release: (reply?: PluginSettingsReply) => void
    reject: () => void
    wait: (reply: PluginSettingsReply) => Promise<PluginSettingsReply>
  }
  const holds = new Map<PluginSettingsRequest['kind'], Hold[]>()
  function hold(kind: PluginSettingsRequest['kind']) {
    let resolve!: (reply: PluginSettingsReply) => void
    let reject!: (error: Error) => void
    let defaultReply: PluginSettingsReply = { ok: false, error: 'Plugin unavailable. Try again.' }
    const promise = new Promise<PluginSettingsReply>((yes, no) => {
      resolve = yes
      reject = no
    })
    const one: Hold = {
      entered: false,
      release: (reply = defaultReply) => {
        resolve(structuredClone(reply))
      },
      reject: () => {
        reject(new Error('Fictional disconnected status.'))
      },
      wait: (reply) => {
        one.entered = true
        defaultReply = reply
        return promise
      },
    }
    holds.set(kind, [...(holds.get(kind) ?? []), one])
    cleanup.add(() => one.release())
    return one
  }
  const original = f.client.request
  let active = 0,
    maxActive = 0
  const request = vi.fn(async (input: PluginSettingsRequest): Promise<PluginSettingsReply> => {
    input = structuredClone(input)
    if (input.kind === 'status') {
      active++
      maxActive = Math.max(maxActive, active)
    }
    try {
      const reply: PluginSettingsReply =
        input.kind === 'status'
          ? { ok: true, cards: structuredClone(cards) }
          : await original(input)
      const pending = holds.get(input.kind)?.shift()
      return structuredClone(pending ? await pending.wait(reply) : reply)
    } finally {
      if (input.kind === 'status') active--
    }
  })
  f.client.request = request
  const count = (kind: PluginSettingsRequest['kind']) =>
    request.mock.calls.filter(([input]) => input.kind === kind).length
  return {
    client: f.client,
    request,
    hold,
    count,
    listeners,
    maxActive: () => maxActive,
    set(next: PluginCard) {
      cards = [structuredClone(next)]
      f.set(cards)
    },
    wake() {
      for (const listener of listeners) listener()
    },
  }
}
async function show(f: ReturnType<typeof fixture>) {
  const m = mount(PluginsSection, { client: f.client }, { width: 1180, height: 900 })
  await vi.waitFor(() => expect(m.all('plugin-card')).toHaveLength(1))
  expect(f.count('list')).toBe(1)
  expect(f.count('status')).toBe(0)
  return m
}
function cancelConfirmation(m: Mounted) {
  const button = [...m.q('plugin-confirmation').querySelectorAll('button')].find(
    (one) => one.textContent?.trim() === 'Cancel',
  )
  expect(button).toBeDefined()
  button!.click()
}
function noMutation(f: ReturnType<typeof fixture>) {
  for (const kind of ['install', 'update', 'uninstall'] as const) expect(f.count(kind)).toBe(0)
  expect(f.count('list')).toBe(1)
}

it.each([true, false])(
  'keeps unknown confirmation neutral until metadata arrives and confirmation closes (%s)',
  async (deletes) => {
    const f = fixture(),
      m = await show(f)
    m.q('plugin-uninstall').click()
    await nextTick()
    const neutral = 'Uninstall Fictional Fir from all workspaces.'
    expect(m.q('plugin-confirmation').querySelector('p')?.textContent?.trim()).toBe(neutral)
    f.set({ ...fir, uninstallDeletesData: deletes })
    f.wake()
    f.wake()
    await settle()
    expect(f.count('status')).toBe(0)
    expect(m.q('plugin-confirmation').querySelector('p')?.textContent?.trim()).toBe(neutral)
    cancelConfirmation(m)
    await vi.waitFor(() => expect(f.count('status')).toBe(1))
    await settle()
    m.q('plugin-uninstall').click()
    await nextTick()
    expect(m.q('plugin-confirmation').textContent).toContain(
      deletes ? 'delete its local data.' : 'Its data will be kept.',
    )
    noMutation(f)
  },
)

it('coalesces a burst and a burst during a held status into one flight and one latest follow-up', async () => {
  const f = fixture(),
    m = await show(f)
  const first = f.hold('status')
  f.wake()
  f.wake()
  f.wake()
  await vi.waitFor(() => expect(first.entered).toBe(true))
  expect(f.count('status')).toBe(1)
  f.set({ ...fir, uninstallDeletesData: true })
  f.wake()
  f.wake()
  f.wake()
  await settle()
  expect(f.count('status')).toBe(1)
  first.release({ ok: true, cards: [{ ...fir, state: 'Unavailable' }] })
  await vi.waitFor(() => expect(f.count('status')).toBe(2))
  await settle()
  expect(f.maxActive()).toBe(1)
  expect(m.q('plugin-state').textContent).toBe('Running')
  m.q('plugin-uninstall').click()
  await nextTick()
  expect(m.q('plugin-confirmation').textContent).toContain('delete its local data.')
  noMutation(f)
})

it.each(['refused', 'disconnected'] as const)(
  'preserves cards after %s status without a retry loop, then recovers on the next wake',
  async (failure) => {
    const f = fixture(),
      m = await show(f)
    const first = f.hold('status')
    f.wake()
    await vi.waitFor(() => expect(first.entered).toBe(true))
    if (failure === 'refused') first.release({ ok: false, error: 'Plugin unavailable. Try again.' })
    else first.reject()
    await settle()
    expect(f.count('status')).toBe(1)
    expect(m.q('plugin-state').textContent).toBe('Running')
    expect(m.all('plugins-error')).toHaveLength(0)
    f.set({ ...fir, state: 'Needs setup' })
    f.wake()
    await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Needs setup'))
    expect(f.count('status')).toBe(2)
    noMutation(f)
  },
)

it('holds a metadata wake through a busy inspection and its review without replacing the reviewed package', async () => {
  const f = fixture(),
    m = await show(f)
  const inspection = f.hold('inspect')
  m.q('plugin-review-update').click()
  await vi.waitFor(() => expect(inspection.entered).toBe(true))
  f.set({ ...fir, uninstallDeletesData: false })
  f.wake()
  await settle()
  expect(f.count('status')).toBe(0)
  inspection.release()
  await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
  expect(m.q('plugin-review-details').textContent).toContain('Fictional plugin makers')
  expect(m.q('plugin-review-details').textContent).toContain('2.0.0')
  await settle()
  expect(f.count('status')).toBe(0)
  expect(f.count('inspect')).toBe(1)
  m.q('plugin-review-cancel').click()
  await vi.waitFor(() => expect(f.count('status')).toBe(1))
  noMutation(f)
})

it('defers metadata refresh until the selected Configure page closes without reopening the page', async () => {
  const f = fixture(),
    m = await show(f)
  m.q('plugin-configure').click()
  await vi.waitFor(() => expect(f.count('configure')).toBe(1))
  await vi.waitFor(() => expect(m.all('plugin-loading')).toHaveLength(0))
  f.set({ ...fir, state: 'Needs setup' })
  f.wake()
  f.wake()
  await settle()
  expect(f.count('status')).toBe(0)
  expect(m.q('plugin-configuration').textContent).toContain('Fictional Fir')
  m.q('plugin-close').click()
  await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Needs setup'))
  expect(f.count('status')).toBe(1)
  expect(f.count('configure')).toBe(1)
  noMutation(f)
})

it('rejects a late status across a newer review generation even after the review closes', async () => {
  const f = fixture(),
    m = await show(f)
  const first = f.hold('status')
  f.wake()
  await vi.waitFor(() => expect(first.entered).toBe(true))
  m.q('plugin-review-update').click()
  await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(1))
  m.q('plugin-review-cancel').click()
  await vi.waitFor(() => expect(m.all('plugin-review-details')).toHaveLength(0))
  first.release({ ok: true, cards: [{ ...fir, state: 'Unavailable' }] })
  await vi.waitFor(() => expect(f.count('status')).toBe(2))
  await settle()
  expect(m.q('plugin-state').textContent).toBe('Running')
  expect(f.maxActive()).toBe(1)
  noMutation(f)
})

it('rejects a late status after retry replaces the card array without changing the review generation', async () => {
  const f = fixture({ ...fir, state: 'Unavailable', unavailableReason: 'connection' })
  const m = await show(f),
    first = f.hold('status')
  f.wake()
  await vi.waitFor(() => expect(first.entered).toBe(true))
  f.set(fir)
  m.q('plugin-retry').click()
  await vi.waitFor(() => expect(m.q('plugin-state').textContent).toBe('Running'))
  first.release()
  await vi.waitFor(() => expect(f.count('status')).toBe(2))
  await settle()
  expect(m.q('plugin-state').textContent).toBe('Running')
  expect(f.count('retry')).toBe(1)
  noMutation(f)
})

it.each(['queued', 'in-flight'] as const)(
  'drops %s metadata work and late host callbacks after unmount',
  async (phase) => {
    const f = fixture(),
      m = await show(f)
    const staleListeners = [...f.listeners]
    const first = phase === 'in-flight' ? f.hold('status') : undefined
    f.wake()
    if (first) await vi.waitFor(() => expect(first.entered).toBe(true))
    m.unmount()
    expect(f.listeners.size).toBe(0)
    const calls = f.request.mock.calls.length
    for (const listener of staleListeners) listener()
    first?.release({ ok: true, cards: [{ ...fir, state: 'Unavailable' }] })
    await settle()
    expect(f.count('status')).toBe(first ? 1 : 0)
    expect(f.request.mock.calls).toHaveLength(calls)
    expect(m.host.isConnected).toBe(false)
  },
)
