import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, provide } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { SessionStore } from '../../src/renderer/src/lib/session-store'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { useSessionStore } from '../../src/renderer/src/composables/useSessionStore'
import { mount, unmountAll } from './harness'

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('Injected sessions must not reach desktop globals')
    },
  })
})
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

function fictionalSessions() {
  const failure = new Error('Fictional host is restarting')
  let events: Parameters<ClientSessionApi['onEvent']>[0] | undefined
  let liveness: Parameters<ClientSessionApi['onLiveness']>[0] | undefined
  const offEvents = vi.fn(() => {
    events = undefined
  })
  const offLiveness = vi.fn(() => {
    liveness = undefined
  })
  const transport = {
    marker: 'fern',
    attachOpen: vi.fn(async function (this: { marker: string }) {
      expect(this.marker).toBe('fern')
      return []
    }),
    onEvent: vi.fn<ClientSessionApi['onEvent']>((listener) => {
      events = listener
      return offEvents
    }),
    onLiveness: vi.fn<ClientSessionApi['onLiveness']>((listener) => {
      liveness = listener
      return offLiveness
    }),
    processMemory: vi.fn(async () => {
      throw failure
    }),
    release: vi.fn(async () => {
      throw failure
    }),
  }
  return {
    sessions: transport as unknown as ClientSessionApi,
    transport,
    failure,
    offEvents,
    offLiveness,
    eventListener: () => events,
    livenessListener: () => liveness,
  }
}

function screen(sessions?: ClientSessionApi) {
  let store!: SessionStore
  let descendant!: SessionStore
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    () => sessions,
  )
  const Child = defineComponent({
    setup() {
      descendant = useSessionStore()
      return () => h('span', 'Fictional session view')
    },
  })
  const Screen = defineComponent({
    setup() {
      store = useSessionStore()
      return () => h(Child)
    },
  })
  const view = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(Screen)
      },
    }),
    {},
  )
  return { view, store, descendant }
}

it('uses injected reads, intents and streams once, shares with descendants, and disposes at the owner', async () => {
  const one = fictionalSessions()
  const mounted = screen(one.sessions)
  expect(mounted.descendant).toBe(mounted.store)
  expect(one.transport.attachOpen).toHaveBeenCalledTimes(1)
  expect(one.transport.onEvent).toHaveBeenCalledTimes(1)
  expect(one.transport.onLiveness).toHaveBeenCalledTimes(1)
  expect(typeof one.eventListener()).toBe('function')
  expect(typeof one.livenessListener()).toBe('function')
  one.livenessListener()?.({ sessionId: 'fern', liveness: { state: 'silent', since: 12 } })
  expect(mounted.store.get('fern')?.earlyLiveness).toMatchObject({ state: 'silent', since: 12 })
  const packet = {
    sessionId: 'fern',
    ordinal: 0,
    at: 13,
    event: { type: 'activity' as const, phase: 'thinking' as const },
  }
  one.eventListener()?.(packet)
  expect(mounted.store.get('fern')?.earlyEvents).toEqual([packet])
  expect(await mounted.store.processMemory()).toBeNull()
  await expect(mounted.store.release('fern')).rejects.toBe(one.failure)
  expect(one.transport.release).toHaveBeenCalledExactlyOnceWith({ sessionId: 'fern' })
  mounted.view.unmount()
  expect(one.offEvents).toHaveBeenCalledTimes(1)
  expect(one.offLiveness).toHaveBeenCalledTimes(1)
  expect(one.eventListener()).toBeUndefined()
  expect(one.livenessListener()).toBeUndefined()
})

it('keeps concurrent roots and a remounted root independent', () => {
  const one = fictionalSessions()
  const two = fictionalSessions()
  const previous = screen(one.sessions)
  const current = screen(two.sessions)
  expect(previous.store).not.toBe(current.store)
  previous.view.unmount()
  expect(one.offEvents).toHaveBeenCalledTimes(1)
  expect(two.offEvents).not.toHaveBeenCalled()
  const remounted = screen(one.sessions)
  expect(remounted.store).not.toBe(previous.store)
  expect(one.transport.attachOpen).toHaveBeenCalledTimes(2)
  expect(one.transport.onEvent).toHaveBeenCalledTimes(2)
  expect(two.transport.attachOpen).toHaveBeenCalledTimes(1)
})

it('does not fall back to window when an injected client has no session capability', () => {
  expect(() => screen()).toThrow('The client does not provide session reads and intents')
})
