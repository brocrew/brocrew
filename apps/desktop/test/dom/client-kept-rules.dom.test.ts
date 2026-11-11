import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { KeptRules as Kept } from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import KeptRules from '../../src/renderer/src/components/KeptRules.vue'
import { mount, unmountAll } from './harness'

beforeEach(() => {
  localStorage.removeItem('brobot2.providers.open.kept-rules')
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('Kept rules must use the injected client')
    },
  })
})
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
  localStorage.removeItem('brobot2.providers.open.kept-rules')
})

const rules: Kept = {
  claude: [
    {
      file: '/fictional/rules',
      rules: [{ kept: 'opaque stored rule', rule: { kind: 'tool', tool: 'Fictional' } }],
    },
  ],
  codex: [],
}

function screen(sessions: () => Partial<ClientSessionApi> | undefined) {
  const capability = vi.fn(() => sessions() as ClientSessionApi | undefined)
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider read expected')
    },
    () => undefined,
    () => undefined,
    capability,
  )
  const view = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(KeptRules, { providers: ['claude', 'codex'] })
      },
    }),
    {},
    { width: 900, height: 700 },
  )
  return { view, capability }
}

it('reads and removes through ancestor injection with each receiver and the exact stored rule, then refreshes', async () => {
  const calls: string[] = []
  const first = {
    marker: 'first',
    keptRules: vi.fn<ClientSessionApi['keptRules']>(function (this: { marker: string }) {
      expect(this.marker).toBe('first')
      calls.push('read')
      return Promise.resolve(rules)
    }),
  }
  let selected: Partial<ClientSessionApi> = first
  const { view, capability } = screen(() => selected)
  await vi.waitFor(() => expect(view.all('kept-rule')).toHaveLength(1))
  expect(calls).toEqual(['read'])
  const second = {
    marker: 'second',
    removeKeptRule: vi.fn<ClientSessionApi['removeKeptRule']>(function (this: { marker: string }) {
      expect(this.marker).toBe('second')
      calls.push('remove')
      return Promise.resolve({ removed: true })
    }),
    keptRules: vi.fn<ClientSessionApi['keptRules']>(function (this: { marker: string }) {
      expect(this.marker).toBe('second')
      calls.push('refresh')
      return Promise.resolve({ claude: [], codex: [] })
    }),
  }
  selected = second
  view.q('kept-rule-remove').click()
  await vi.waitFor(() => expect(view.all('kept-rule')).toHaveLength(0))
  expect(second.removeKeptRule).toHaveBeenCalledExactlyOnceWith({
    provider: 'claude',
    file: '/fictional/rules',
    kept: 'opaque stored rule',
  })
  expect(calls).toEqual(['read', 'remove', 'refresh'])
  expect(capability).toHaveBeenCalledTimes(3)
  expect(view.all('kept-rules-refused')).toHaveLength(0)
})

it.each([undefined, {}])(
  'reports an absent session or read operation without inventing an empty list: %s',
  async (sessions) => {
    localStorage.setItem('brobot2.providers.open.kept-rules', 'false')
    const { view } = screen(() => sessions)
    await vi.waitFor(() => expect(view.all('kept-rules-unread')).toHaveLength(1))
    expect(view.q('kept-rules-unread').textContent).toContain(
      'The client does not provide session reads and intents',
    )
    expect(view.all('kept-rules-none')).toHaveLength(0)
    expect(view.q('kept-rules-fold').getAttribute('aria-expanded')).toBe('true')
  },
)

it.each(['capability getter', 'operation getter', 'throw', 'reject'] as const)(
  'keeps a present %s read failure on the original readable-error path',
  async (kind) => {
    const failure = new Error('Fictional read failed verbatim')
    const sessions = {
      get keptRules(): ClientSessionApi['keptRules'] {
        if (kind === 'operation getter') throw failure
        return () => {
          if (kind === 'throw') throw failure
          return Promise.reject(failure)
        }
      },
    }
    const { view } = screen(() => {
      if (kind === 'capability getter') throw failure
      return sessions
    })
    await vi.waitFor(() => expect(view.all('kept-rules-unread')).toHaveLength(1))
    expect(view.q('kept-rules-unread').textContent).toContain(failure.message)
    expect(view.q('kept-rules-unread').textContent).not.toContain(
      'The client does not provide session reads and intents',
    )
  },
)

it.each([
  'missing',
  'capability getter',
  'operation getter',
  'throw',
  'reject',
  'refused',
] as const)(
  'retains %s removal diagnostics, unlocks Remove, and always refreshes',
  async (kind) => {
    const failure = new Error('Fictional remove failed verbatim')
    let failCapability = false
    let reads = 0
    const read = vi.fn<ClientSessionApi['keptRules']>(() => {
      reads++
      return Promise.resolve(rules)
    })
    let selected: Partial<ClientSessionApi> = { keptRules: read }
    const { view } = screen(() => {
      if (failCapability) {
        failCapability = false
        throw failure
      }
      return selected
    })
    await vi.waitFor(() => expect(view.all('kept-rule')).toHaveLength(1))
    selected = {
      keptRules: read,
      get removeKeptRule(): ClientSessionApi['removeKeptRule'] {
        if (kind === 'operation getter') throw failure
        return () => {
          if (kind === 'throw') throw failure
          if (kind === 'refused') return Promise.resolve({ removed: false, why: failure.message })
          return Promise.reject(failure)
        }
      },
    }
    if (kind === 'missing') selected = { keptRules: read }
    failCapability = kind === 'capability getter'
    view.q('kept-rule-remove').click()
    await vi.waitFor(() => expect(view.all('kept-rules-refused')).toHaveLength(1))
    await vi.waitFor(() => expect(reads).toBe(2))
    expect(view.q('kept-rules-refused').textContent).toContain(
      kind === 'missing'
        ? 'The client does not provide session reads and intents'
        : failure.message,
    )
    expect(view.q('kept-rule-remove').hasAttribute('disabled')).toBe(false)
    expect(view.all('kept-rule')).toHaveLength(1)
    await nextTick()
  },
)
