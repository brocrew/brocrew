import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { WorkSearchResult } from '../../src/shared/work-search'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import SessionWork from '../../src/renderer/src/components/SessionWork.vue'
import { mount, unmountAll } from './harness'

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('Work search must use the injected session capability')
    },
  })
})
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

const empty: WorkSearchResult = {
  ok: true,
  page: {
    hits: [],
    searched: 1,
    rows_unread: 0,
    ledgers_skipped: 0,
    complete: true,
    next_cursor: null,
  },
}

function screen(initial?: Partial<ClientSessionApi>) {
  let selected = initial
  const capability = vi.fn(() => selected as ClientSessionApi | undefined)
  const conversation = ref('fern-one')
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
        return () =>
          h(SessionWork, { conversation: conversation.value, reading: null, identities: null })
      },
    }),
    {},
    { width: 700, height: 700 },
  )
  return {
    view,
    capability,
    conversation,
    select: (next: Partial<ClientSessionApi>) => (selected = next),
  }
}

async function open(view: ReturnType<typeof screen>['view']) {
  view.q('work-search-open').click()
  await nextTick()
}

it('captures the ancestor capability and receiver once while reading the current conversation on each search', async () => {
  const transport = {
    marker: 'fern',
    searchWork: vi.fn<ClientSessionApi['searchWork']>(function (this: { marker: string }) {
      expect(this.marker).toBe('fern')
      return Promise.resolve(empty)
    }),
  }
  const original = transport.searchWork
  const mounted = screen(transport)
  expect(mounted.capability).toHaveBeenCalledTimes(1)
  expect(original).not.toHaveBeenCalled()
  const replacement = vi.fn<ClientSessionApi['searchWork']>()
  transport.searchWork = replacement
  mounted.select({ searchWork: replacement })
  await open(mounted.view)
  mounted.view.q('work-search-submit').click()
  await vi.waitFor(() => expect(mounted.view.all('work-search-empty')).toHaveLength(1))
  expect(original).toHaveBeenCalledExactlyOnceWith({
    conversation: 'fern-one',
    query: { scope: 'this-conversation', words: '', limit: 20 },
  })
  expect(mounted.view.q('work-search-empty').textContent).toBe('No matches in the work searched.')
  mounted.conversation.value = 'fern-two'
  await nextTick()
  expect(mounted.view.all('work-search')).toHaveLength(0)
  await open(mounted.view)
  mounted.view.q('work-search-submit').click()
  await vi.waitFor(() => expect(original).toHaveBeenCalledTimes(2))
  expect(original.mock.calls[1]?.[0].conversation).toBe('fern-two')
  expect(replacement).not.toHaveBeenCalled()
  expect(mounted.capability).toHaveBeenCalledTimes(1)
})

it('rejects an invalid query before calling the captured operation', async () => {
  const searchWork = vi.fn<ClientSessionApi['searchWork']>()
  const { view } = screen({ searchWork })
  await open(view)
  const input = view.q('work-search-words') as HTMLInputElement
  input.value = Array.from({ length: 21 }, () => 'word').join(' ')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  view.q('work-search-submit').click()
  await vi.waitFor(() => expect(view.all('work-search-failure')).toHaveLength(1))
  expect(view.q('work-search-failure').textContent).toBe(
    'Use a listed scope and state, at most 20 words, and a limit from 1 to 50.',
  )
  expect(searchWork).not.toHaveBeenCalled()
})

it.each([undefined, {}])(
  'keeps an absent session or older missing operation readable as unavailable: %s',
  async (sessions) => {
    const { view } = screen(sessions)
    await open(view)
    view.q('work-search-submit').click()
    await vi.waitFor(() => expect(view.all('work-search-failure')).toHaveLength(1))
    expect(view.q('work-search-failure').textContent).toBe(
      'Work search failed to read the work. Try again.',
    )
    expect(view.q('work-search-submit').hasAttribute('disabled')).toBe(false)
  },
)

it.each(['throw', 'reject'] as const)(
  'keeps the existing dialog failure behavior for a captured %s',
  async (kind) => {
    const failure = new Error('Fictional work reader failed')
    const searchWork = vi.fn<ClientSessionApi['searchWork']>(() => {
      if (kind === 'throw') throw failure
      return Promise.reject(failure)
    })
    const { view } = screen({ searchWork })
    await open(view)
    view.q('work-search-submit').click()
    await vi.waitFor(() => expect(view.all('work-search-failure')).toHaveLength(1))
    expect(view.q('work-search-failure').textContent).toBe(
      'Work search failed to read the work. Try again.',
    )
    expect(view.q('work-search-submit').hasAttribute('disabled')).toBe(false)
    expect(searchWork).toHaveBeenCalledTimes(1)
  },
)

it('ignores a pending response after the conversation closes the dialog, then uses the new conversation', async () => {
  let answer!: (result: WorkSearchResult) => void
  const searchWork = vi.fn<ClientSessionApi['searchWork']>(
    () => new Promise((resolve) => (answer = resolve)),
  )
  const mounted = screen({ searchWork })
  await open(mounted.view)
  mounted.view.q('work-search-submit').click()
  expect(searchWork).toHaveBeenCalledTimes(1)
  mounted.conversation.value = 'fern-two'
  await nextTick()
  await open(mounted.view)
  answer(empty)
  await nextTick()
  expect(mounted.view.all('work-search-empty')).toHaveLength(0)
  expect(mounted.view.all('work-search-failure')).toHaveLength(0)
  mounted.view.q('work-search-submit').click()
  expect(searchWork.mock.calls[1]?.[0].conversation).toBe('fern-two')
  answer({ ok: false, reason: 'busy' })
  await vi.waitFor(() => expect(mounted.view.all('work-search-failure')).toHaveLength(1))
  expect(mounted.view.q('work-search-failure').textContent).toBe(
    'Work search is busy with other searches. Try again in a moment.',
  )
})
