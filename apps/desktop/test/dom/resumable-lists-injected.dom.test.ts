import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../../src/shared/runtime-ipc'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { mount, unmountAll } from './harness'

const closing = vi.hoisted(() => ({ value: false }))
vi.mock('../../src/renderer/src/lib/app-closing', () => ({ appClosing: closing }))

const settle = async () => {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}
const row = (sessionId: string): ResumableSessionInfo => ({
  sessionId,
  provider: 'codex',
  cwd: '/fictional/fern',
  ref: { provider: 'codex', sessionId, cwd: '/fictional/fern', rotation: 0 },
  status: 'idle',
  running: 'not-running',
  state: { is: 'idle' },
  named: null,
  approvalMode: 'ask',
  profileId: 'fern',
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  lastEnding: 'completed',
  child: null,
  resumeRefusal: null,
  updatedAt: 1,
})
const closedRow = (sessionId: string): UnresumableSessionInfo => ({
  sessionId,
  provider: 'codex',
  cwd: '/fictional/fern',
  status: 'ended',
  running: 'not-running',
  state: { is: 'idle' },
  named: null,
  profileId: 'fern',
  adoptedAt: null,
  hasTranscript: true,
  lastEnding: 'completed',
  foundInUserHome: false,
  restoredFromBundle: false,
  reason: 'Fern retained the conversation.',
  updatedAt: 2,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  closing.value = false
  Reflect.deleteProperty(window, 'api')
})

function screen() {
  const raw = {
    listResumable: vi.fn(async () => [row('raw-opposite')]),
    listUnresumable: vi.fn(async () => []),
  }
  Reflect.set(window, 'api', { runtime: raw })
  const pending = {
    open: deferred<ResumableSessionInfo[]>(),
    closed: deferred<UnresumableSessionInfo[]>(),
  }
  const selected = {
    ...window.api.runtime,
    marker: 'selected',
    listResumable: vi.fn(function (this: { marker: string }) {
      expect(this.marker).toBe('selected')
      return pending.open.promise
    }),
    listUnresumable: vi.fn(function (this: { marker: string }) {
      expect(this.marker).toBe('selected')
      return pending.closed.promise
    }),
  }
  let capability: typeof selected | undefined = selected
  let getterFailure: Error | undefined
  const getSessions = vi.fn(() => {
    if (getterFailure) throw getterFailure
    return capability
  })
  const client = {
    ...createDesktopProviderApi(
      () => window.api.runtime,
      () => undefined,
    ),
    providerCatalogue: vi.fn(async () => PROVIDER_DESCRIPTORS),
    get sessions() {
      return getSessions()
    },
  }
  let inner: InstanceType<typeof SideRail> | null = null
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, client)
        return () =>
          h(SideRail, {
            open: [],
            activeId: null,
            place: null,
            ref: (instance) => {
              inner = instance as InstanceType<typeof SideRail>
            },
          })
      },
    }),
    {},
  )
  const refresh = async () => {
    if (!inner) throw new Error('List surface was not mounted')
    await inner.refreshResumable()
    await settle()
  }
  return {
    m,
    raw,
    selected,
    pending,
    getSessions,
    refresh,
    failGetter: (error: Error | undefined) => {
      getterFailure = error
    },
    omit: () => {
      capability = undefined
    },
    rows: () => m.host.querySelectorAll('[data-cy^="open-session-"]').length,
    error: () => m.q('conversations-error').textContent,
  }
}

it('the rail reads one selected snapshot concurrently with receiver and refresh/getter lifetime intact', async () => {
  const out = screen()
  await settle()
  expect(out.getSessions.mock.calls.length).toBe(1)
  expect(out.selected.listResumable).toHaveBeenCalledTimes(1)
  expect(out.selected.listUnresumable).toHaveBeenCalledTimes(1)
  out.pending.open.resolve([row('fern-open')])
  await settle()
  expect(out.rows()).toBe(0)
  out.pending.closed.resolve([closedRow('fern-closed')])
  await settle()
  expect(out.rows()).toBe(2)
  expect(out.m.host.textContent).not.toContain('raw-opposite')
  const failure = new Error('Fern list read failed')
  out.selected.listUnresumable.mockRejectedValue(failure)
  await out.refresh()
  await vi.waitFor(() => expect(out.error()).toContain(failure.message), { timeout: 3_000 })
  expect(out.rows()).toBe(2)
  out.failGetter(new Error('Fern getter failed'))
  await out.refresh()
  expect(out.error()).toContain('Fern getter failed')
  expect(out.getSessions.mock.calls.length).toBe(5)
  out.failGetter(undefined)
  out.selected.listUnresumable.mockResolvedValue([closedRow('fern-closed')])
  await out.refresh()
  expect(out.getSessions.mock.calls.length).toBe(6)
  expect(out.rows()).toBe(2)
  expect(out.m.all('conversations-error')).toHaveLength(0)
  closing.value = true
  await out.refresh()
  expect(out.getSessions.mock.calls.length).toBe(6)
  expect(out.raw.listResumable).not.toHaveBeenCalled()
  expect(out.raw.listUnresumable).not.toHaveBeenCalled()
})

it('the rail reports missing capability or method through its existing list notice', async () => {
  const out = screen()
  out.pending.open.resolve([])
  out.pending.closed.resolve([])
  await settle()
  Reflect.deleteProperty(out.selected, 'listUnresumable')
  await out.refresh()
  await vi.waitFor(
    () => expect(out.error()).toContain('The client does not provide session reads and intents'),
    { timeout: 3_000 },
  )
  out.omit()
  await out.refresh()
  expect(out.error()).toContain('The client does not provide session reads and intents')
  expect(out.raw.listResumable).not.toHaveBeenCalled()
  expect(out.raw.listUnresumable).not.toHaveBeenCalled()
})
