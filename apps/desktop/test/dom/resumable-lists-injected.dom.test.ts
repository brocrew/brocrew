import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { providersBridge } from '../../look/fixtures/providers'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { ResumableSessionInfo, UnresumableSessionInfo } from '../../src/shared/runtime-ipc'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import ResumableSessions from '../../src/renderer/src/components/ResumableSessions.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { mount, unmountAll } from './harness'

const closing = vi.hoisted(() => ({ value: false }))
vi.mock('../../src/renderer/src/lib/app-closing', () => ({ appClosing: closing }))

const surfaces = ['page', 'rail'] as const
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

function screen(surface: (typeof surfaces)[number]) {
  const raw = {
    listResumable: vi.fn(async () => [row('raw-opposite')]),
    listUnresumable: vi.fn(async () => []),
  }
  Reflect.set(window, 'api', { runtime: raw })
  const pending = {
    open: deferred<ResumableSessionInfo[]>(),
    closed: deferred<UnresumableSessionInfo[]>(),
  }
  let adoptionCaptures = 0
  const selected = {
    ...window.api.runtime,
    marker: 'selected',
    get adoptSessions() {
      adoptionCaptures++
      return window.api.runtime.adoptSessions
    },
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
  let inner: InstanceType<typeof ResumableSessions> | InstanceType<typeof SideRail> | null = null
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, client)
        return () =>
          surface === 'page'
            ? h(ResumableSessions, {
                ref: (instance) => {
                  inner = instance as InstanceType<typeof ResumableSessions>
                },
              })
            : h(SideRail, {
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
    if ('refresh' in inner) await inner.refresh()
    else await inner.refreshResumable()
    await settle()
  }
  return {
    m,
    raw,
    selected,
    pending,
    getSessions,
    adoptionCaptures: () => adoptionCaptures,
    refresh,
    failGetter: (error: Error | undefined) => {
      getterFailure = error
    },
    omit: () => {
      capability = undefined
    },
    rows: () =>
      surface === 'page'
        ? m.all('resumable-row').length + m.all('unresumable-row').length
        : m.host.querySelectorAll('[data-cy^="open-session-"]').length,
    error: () => m.q(surface === 'page' ? 'resumable-error' : 'conversations-error').textContent,
  }
}

it.each(surfaces)(
  '%s reads one selected snapshot concurrently with receiver and refresh/getter lifetime intact',
  async (surface) => {
    const out = screen(surface)
    await settle()
    const captured = out.adoptionCaptures()
    expect(captured).toBe(surface === 'page' ? 1 : 0)
    expect(out.getSessions.mock.calls.length - captured).toBe(1)
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
    if (surface === 'rail') out.selected.listUnresumable.mockRejectedValue(failure)
    else out.selected.listUnresumable.mockRejectedValueOnce(failure)
    await out.refresh()
    expect(out.error()).toContain(failure.message)
    expect(out.adoptionCaptures()).toBe(captured)
    expect(out.rows()).toBe(surface === 'page' ? 0 : 2)
    out.failGetter(new Error('Fern getter failed'))
    await out.refresh()
    expect(out.error()).toContain('Fern getter failed')
    expect(out.adoptionCaptures()).toBe(captured)
    expect(out.getSessions.mock.calls.length - captured).toBe(surface === 'rail' ? 5 : 3)
    out.failGetter(undefined)
    out.selected.listUnresumable.mockResolvedValue([closedRow('fern-closed')])
    await out.refresh()
    expect(out.adoptionCaptures()).toBe(captured)
    expect(out.getSessions.mock.calls.length - captured).toBe(surface === 'rail' ? 6 : 4)
    expect(out.rows()).toBe(2)
    expect(out.m.all(surface === 'page' ? 'resumable-error' : 'conversations-error')).toHaveLength(
      0,
    )
    closing.value = true
    await out.refresh()
    expect(out.adoptionCaptures()).toBe(captured)
    expect(out.getSessions.mock.calls.length - captured).toBe(surface === 'rail' ? 6 : 4)
    expect(out.raw.listResumable).not.toHaveBeenCalled()
    expect(out.raw.listUnresumable).not.toHaveBeenCalled()
  },
)

it.each(surfaces)(
  '%s reports missing capability or method through its existing list notice',
  async (surface) => {
    const out = screen(surface)
    out.pending.open.resolve([])
    out.pending.closed.resolve([])
    await settle()
    Reflect.deleteProperty(out.selected, 'listUnresumable')
    await out.refresh()
    expect(out.error()).toContain('The client does not provide session reads and intents')
    out.omit()
    await out.refresh()
    expect(out.error()).toContain('The client does not provide session reads and intents')
    expect(out.raw.listResumable).not.toHaveBeenCalled()
    expect(out.raw.listUnresumable).not.toHaveBeenCalled()
  },
)

async function namedPage(name = 'Birch', late = false) {
  providersBridge()
  const raw = vi.spyOn(window.api.runtime, 'providerCatalogue')
  const names = PROVIDER_DESCRIPTORS.map((entry) => ({
    ...entry,
    displayName: entry.id === 'codex' ? name : 'Fern',
  }))
  const answer = deferred<typeof names>()
  const entries = [
    { ...closedRow('home'), foundInUserHome: true },
    { ...closedRow('bundle'), foundInUserHome: true, restoredFromBundle: true },
    closedRow('profile'),
  ]
  const selected = {
    ...window.api.runtime,
    providerCatalogue: vi.fn(async function (this: object) {
      expect(this).toBe(selected)
      return late ? answer.promise : names
    }),
    listResumable: vi.fn(async function (this: object) {
      expect(this).toBe(selected)
      return []
    }),
    listUnresumable: vi.fn(async function (this: object) {
      expect(this).toBe(selected)
      return entries
    }),
  }
  const client = createDesktopProviderApi(
    () => selected,
    () => undefined,
    () => undefined,
    () => selected,
  )
  const opened = vi.fn()
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, client)
        return () => h(ResumableSessions, { onOpen: opened })
      },
    }),
    {},
  )
  await vi.waitFor(() => expect(m.all('unresumable-profile')).toHaveLength(3))
  return { m, raw, selected, opened, answer: () => answer.resolve(names) }
}

it('names the selected provider folder while bundle and agent identity take their original precedence', async () => {
  const out = await namedPage()
  expect(out.m.all('unresumable-profile')[0]?.textContent?.trim()).toBe("from Birch's own folder")
  expect(out.m.all('unresumable-profile')[1]?.textContent?.trim()).toBe('from a bundle')
  expect(out.m.all('unresumable-profile')[2]?.textContent?.trim()).toBe('agent: fern')
  out.m.q('sessions-open-home').click()
  expect(out.opened).toHaveBeenCalledExactlyOnceWith('home')
  expect(out.selected.listResumable).toHaveBeenCalledTimes(1)
  expect(out.selected.listUnresumable).toHaveBeenCalledTimes(1)
  expect(out.raw).not.toHaveBeenCalled()
})

it('keeps Open available with a generic folder label until the selected catalogue answers', async () => {
  const out = await namedPage('Birch', true)
  expect(out.m.all('unresumable-profile')[0]?.textContent?.trim()).toBe(
    "from the provider's own folder",
  )
  expect((out.m.q('sessions-open-home') as HTMLButtonElement).disabled).toBe(false)
  out.m.q('sessions-open-home').click()
  expect(out.opened).toHaveBeenCalledExactlyOnceWith('home')
  out.answer()
  await vi.waitFor(() =>
    expect(out.m.all('unresumable-profile')[0]?.textContent?.trim()).toBe(
      "from Birch's own folder",
    ),
  )
  expect(out.selected.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(out.raw).not.toHaveBeenCalled()
})

it('does not let the first selected catalogue capture another list with the same provider key', async () => {
  const one = await namedPage('Birch')
  const two = await namedPage('Willow')
  expect(one.m.all('unresumable-profile')[0]?.textContent?.trim()).toBe("from Birch's own folder")
  expect(two.m.all('unresumable-profile')[0]?.textContent?.trim()).toBe("from Willow's own folder")
  expect(one.selected.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(two.selected.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(one.raw).not.toHaveBeenCalled()
  expect(two.raw).not.toHaveBeenCalled()
})
