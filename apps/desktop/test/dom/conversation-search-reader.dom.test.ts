import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick, type Ref } from 'vue'
import { appClosing } from '../../src/renderer/src/lib/app-closing'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { ConversationSearchHit, WorkSearchResult } from '../../src/shared/work-search'
import { mount } from './harness'
import { workerRows } from './parallel-workers-fixture'
import {
  disposeRuntimeScreenFixture,
  installRuntimeScreenFixture,
  runtime,
} from './runtime-screen-fixture'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

vi.mock('../../src/renderer/src/lib/app-closing', async (load) => {
  const actual = await load<typeof import('../../src/renderer/src/lib/app-closing')>()
  const { ref } = await import('vue')
  return { ...actual, appClosing: ref(false) }
})

const closing = appClosing as Ref<boolean>
beforeEach(installRuntimeScreenFixture)
afterEach(() => {
  closing.value = false
  disposeRuntimeScreenFixture()
})

const caller = 'recorded-caller'
const archive = 'archived-result'

function hit(conversation: string, title: string, address: string): ConversationSearchHit {
  return {
    conversation,
    address,
    title,
    line: title,
    profile: 'editor',
    last_active_at: 1_700_000_000_000,
    status: null,
    matched_tasks: [],
    tasks_omitted: 0,
  }
}

function result(
  hits: ConversationSearchHit[],
  nextCursor: string | null,
  unread = 0,
): WorkSearchResult {
  return {
    ok: true,
    page: {
      hits,
      next_cursor: nextCursor,
      searched: 75,
      rows_unread: unread,
      ledgers_skipped: 0,
      complete: nextCursor === null && unread === 0,
    },
  }
}

const insidePalette = (name: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-cy="${name}"]`)

async function openPalette() {
  window.api.runtime.listResumable = async () => [
    { ...workerRows(1)[0]!, sessionId: caller, provider: 'codex' },
  ]
  const m = mount(RuntimeScreen, {})
  await expect.poll(() => m.all(`open-session-${caller}`).length).toBe(1)
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true, bubbles: true }),
  )
  await expect.poll(() => insidePalette('palette-profile-filter')?.children.length).toBe(2)
  return m
}

function typeQuery(words: string): void {
  const input = insidePalette('palette-search') as HTMLInputElement
  input.value = words
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('searches recorded conversations with the same cursor and opens an archived match read-only', async () => {
  const search = vi.fn<RuntimeBridge['searchWork']>()
  search.mockResolvedValueOnce(result([hit(caller, 'Recorded result title', 'W1.1')], 'later', 2))
  search.mockResolvedValueOnce(result([hit(archive, 'Archived result title', 'W1.2')], null))
  window.api.runtime.searchWork = search
  runtime.resolveLink.mockResolvedValue({
    state: 'archived',
    kind: 'conversation',
    title: 'Archived result title',
    status: null,
    opens: { sessionId: archive },
  })
  runtime.latestHistory.mockResolvedValue({
    entries: [
      {
        sessionId: archive,
        ordinal: 0,
        at: 1_700_000_000_000,
        event: { type: 'assistant_message', text: 'The archived review is attached.' },
      },
    ],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  const m = await openPalette()
  const profile = insidePalette('palette-profile-filter') as HTMLSelectElement
  expect(profile.value).toBe('')
  typeQuery('launch')
  profile.value = 'editor'
  profile.dispatchEvent(new Event('change', { bubbles: true }))

  await expect
    .poll(() => insidePalette(`palette-row-open-${caller}`)?.textContent)
    .toContain('Recorded result title')
  expect(insidePalette(`palette-row-open-${caller}`)?.textContent).toContain('Conversation W1.1')
  expect(search).toHaveBeenCalledExactlyOnceWith({
    conversation: caller,
    query: { words: 'launch', profile: 'editor', limit: 20 },
  })
  insidePalette('palette-search-more')!.click()
  await expect
    .poll(() => insidePalette(`palette-row-open-${archive}`)?.textContent)
    .toContain('Archived result title')
  expect(search).toHaveBeenLastCalledWith({
    conversation: caller,
    query: { words: 'launch', profile: 'editor', limit: 20, cursor: 'later' },
  })
  expect(insidePalette('palette-searched')?.textContent).toContain('2 shown.')
  expect(insidePalette('palette-searched')?.textContent).toContain('2 unread rows')
  expect(insidePalette('palette-searched')?.textContent).not.toContain('75')

  insidePalette(`palette-row-open-${archive}`)!.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
  )
  await expect.poll(() => m.all('linked-history').length).toBe(1)
  expect(runtime.resolveLink).toHaveBeenCalledWith(`brocrew://conversation/${archive}`)
  expect(runtime.latestHistory).toHaveBeenCalledWith({ sessionId: archive })
  expect(m.q('linked-history').textContent).toContain('The archived review is attached.')
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
})

it('ignores a delayed page after the query changes without affecting command keys', async () => {
  let settle!: (answer: WorkSearchResult) => void
  const old = new Promise<WorkSearchResult>((resolve) => {
    settle = resolve
  })
  const search = vi.fn<RuntimeBridge['searchWork']>()
  search.mockReturnValueOnce(old)
  search.mockResolvedValueOnce(result([hit('new-result', 'Current search result', 'W4')], null))
  window.api.runtime.searchWork = search
  await openPalette()

  const picker = insidePalette('palette-profile-filter')!
  picker.focus()
  const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
  picker.dispatchEvent(arrow)
  expect(arrow.defaultPrevented).toBe(false)

  typeQuery('older')
  await expect.poll(() => search.mock.calls.length).toBe(1)
  typeQuery('newer')
  await expect
    .poll(() => insidePalette('palette-row-open-new-result')?.textContent)
    .toContain('Current search result')
  settle(result([hit('old-result', 'Obsolete search result', 'W5')], null))
  await old
  await nextTick()
  expect(insidePalette('palette-row-open-old-result')).toBeNull()
  expect(insidePalette('palette-row-open-new-result')?.textContent).toContain(
    'Current search result',
  )
})

it('does not dispatch a queued conversation search after quitting starts', async () => {
  const search = vi.fn<RuntimeBridge['searchWork']>(async () => result([], null))
  window.api.runtime.searchWork = search
  await openPalette()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  typeQuery('queued')
  await nextTick()
  closing.value = true
  await vi.advanceTimersByTimeAsync(180)
  expect(search).not.toHaveBeenCalled()
})
