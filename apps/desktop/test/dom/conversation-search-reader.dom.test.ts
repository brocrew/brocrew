import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick, type Ref } from 'vue'
import { appClosing } from '../../src/renderer/src/lib/app-closing'
import { fullTime } from '../../src/renderer/src/lib/clock'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type {
  ConversationSearchHit,
  GroupedWorkSearch,
  GroupedWorkSearchPreview,
  WorkSearchResult,
} from '../../src/shared/work-search'
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

function hit(
  conversation: string,
  title: string,
  address: string,
  metadata?: ConversationSearchHit['metadata'],
): ConversationSearchHit {
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
    ...(metadata === undefined ? {} : { metadata }),
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

async function openPalette(fromRail = false) {
  window.api.runtime.listResumable = async () => [
    { ...workerRows(1)[0]!, sessionId: caller, provider: 'codex' },
  ]
  const m = mount(RuntimeScreen, {})
  await expect.poll(() => m.all(`open-session-${caller}`).length).toBe(1)
  if (fromRail) {
    m.q('rail-find-destination').click()
  } else {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true, bubbles: true }),
    )
  }
  await expect.poll(() => insidePalette('palette-profile-filter')?.children.length).toBe(2)
  return m
}

function typeQuery(words: string): void {
  const input = insidePalette('palette-search') as HTMLInputElement
  input.value = words
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function dateInput(bound: 'from' | 'to'): HTMLInputElement {
  const input = insidePalette(`palette-date-${bound}`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${bound} date input`)
  return input
}

function setDate(bound: 'from' | 'to', isoDay: string): void {
  const input = dateInput(bound)
  input.value = isoDay
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setGrouping(checked: boolean): void {
  const control = insidePalette('palette-group-search') as HTMLInputElement
  control.checked = checked
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

function groupedPage(
  groups: GroupedWorkSearch['groups'],
  matched: number | null,
  next: string | null,
): WorkSearchResult {
  return {
    ok: true,
    page: {
      hits: [],
      grouped: { groups, matched },
      next_cursor: next,
      searched: 640,
      complete: matched !== null,
      rows_unread: matched === null ? 1 : 0,
      ledgers_skipped: 0,
    },
  }
}

function preview(
  id: string,
  title: string,
  status: string | null = null,
): GroupedWorkSearchPreview {
  return {
    conversation: id,
    address: `W4.${id}`,
    title,
    last_active_at: 1_700_000_000_000,
    status,
    matched_task_labels: ['W6.2'],
    tasks_omitted: 1,
  }
}

it('pages exact worker groups and opens all matches for one profile with the keyboard', async () => {
  const recordedStatus = '<b>Review ready</b> & awaiting signoff'
  const editor = {
    profile: 'editor',
    matched: 13,
    previews: [
      preview('editor-one', 'Newest review', recordedStatus),
      preview('editor-two', 'Second review'),
      preview('editor-three', 'Third review', ''),
    ],
  }
  const others = ['design', 'planner', 'ops', 'tools', null].map((profile, index) => ({
    profile,
    matched: 1,
    previews: [preview(`other-${index}`, `Other match ${index}`)],
  }))
  const search = vi
    .fn<RuntimeBridge['searchWork']>()
    .mockResolvedValueOnce(groupedPage([editor, ...others], 19, 'next-profile-page'))
    .mockResolvedValueOnce(
      groupedPage(
        [{ profile: 'desk', matched: 1, previews: [preview('desk-one', 'Desk match')] }],
        19,
        null,
      ),
    )
    .mockResolvedValueOnce(result([hit('editor-all', 'Full editor result', 'W1.8')], null))
  window.api.runtime.searchWork = search
  await openPalette()
  typeQuery('group-scenario')
  setDate('from', '2026-01-01')
  setDate('to', '2026-01-31')
  setGrouping(true)

  const groups = () => document.querySelectorAll('[data-cy="palette-profile-group"]')
  await expect.poll(() => groups().length).toBe(6)
  expect(groups()[0]?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Editor · 13')
  expect(groups()[5]?.textContent?.trim()).toContain('No profile')
  expect(insidePalette('palette-row-open-editor-one')?.textContent).toContain('W6.2')
  expect(insidePalette('palette-row-open-editor-three')?.textContent).toContain('Third review')
  const status = insidePalette('palette-row-open-editor-one')!.querySelector(
    '[data-cy="palette-recorded-status"]',
  )
  expect(status?.textContent?.trim()).toBe(`Status: ${recordedStatus}`)
  expect(status?.getAttribute('title')).toBe(recordedStatus)
  expect(status?.querySelector('b')).toBeNull()
  for (const id of ['editor-two', 'editor-three']) {
    expect(
      insidePalette(`palette-row-open-${id}`)!.querySelector('[data-cy="palette-recorded-status"]'),
    ).toBeNull()
  }
  expect(insidePalette('palette-searched')?.textContent).toBe('19 matching conversations.')
  const input = {
    words: 'group-scenario',
    from: '2026-01-01',
    to: '2026-01-31',
    grouped: true,
    limit: 20,
    includeConversationMetadata: true,
  }
  expect(search).toHaveBeenNthCalledWith(1, { conversation: caller, query: input })

  insidePalette('palette-search-more')!.click()
  await expect.poll(() => groups().length).toBe(7)
  expect(search).toHaveBeenNthCalledWith(2, {
    conversation: caller,
    query: { ...input, cursor: 'next-profile-page' },
  })
  expect(insidePalette('palette-searched')?.textContent).toBe('19 matching conversations.')

  const box = insidePalette('palette-search')!
  const press = (key: string) =>
    box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  box.focus()
  press('ArrowDown')
  press('ArrowDown')
  press('ArrowDown')
  const expand = insidePalette('palette-row-expand-profile:editor')!
  await expect.poll(() => expand.getAttribute('aria-selected')).toBe('true')
  expect(expand.textContent?.trim()).toBe('All 13 from Editor')
  press('Enter')
  await expect
    .poll(() => insidePalette('palette-row-open-editor-all')?.textContent)
    .toContain('Full editor result')
  expect(search).toHaveBeenNthCalledWith(3, {
    conversation: caller,
    query: {
      words: 'group-scenario',
      profile: 'editor',
      from: '2026-01-01',
      to: '2026-01-31',
      limit: 20,
      includeConversationMetadata: true,
    },
  })
  expect(groups()).toHaveLength(0)
  expect((insidePalette('palette-profile-filter') as HTMLSelectElement).value).toBe('editor')
  expect((insidePalette('palette-group-search') as HTMLInputElement).checked).toBe(false)
})

it('searches dates without words and retires a pending page when the range changes', async () => {
  let finish!: (page: WorkSearchResult) => void
  const old = new Promise<WorkSearchResult>((resolve) => {
    finish = resolve
  })
  const search = vi
    .fn<RuntimeBridge['searchWork']>()
    .mockResolvedValueOnce(result([hit('first-date', 'First date match', 'W1.2')], 'date-page'))
    .mockReturnValueOnce(old)
    .mockResolvedValueOnce(result([hit('new-date', 'New date match', 'W1.4')], null))
  window.api.runtime.searchWork = search
  await openPalette()
  const from = '2026-02-01'
  const to = '2026-02-28'
  setDate('from', from)
  setDate('to', to)

  const query = { words: '', from, to, limit: 20, includeConversationMetadata: true }
  await expect
    .poll(() => insidePalette('palette-row-open-first-date')?.textContent)
    .toContain('First date match')
  expect(search).toHaveBeenNthCalledWith(1, { conversation: caller, query })
  const date = dateInput('from')
  date.focus()
  for (const key of ['ArrowUp', 'ArrowDown', 'Enter']) {
    const press = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    expect(date.dispatchEvent(press)).toBe(true)
    expect(document.activeElement).toBe(date)
  }
  insidePalette('palette-search-more')!.click()
  expect(search).toHaveBeenNthCalledWith(2, {
    conversation: caller,
    query: { ...query, cursor: 'date-page' },
  })

  setDate('to', '2026-02-15')
  await expect
    .poll(() => insidePalette('palette-row-open-new-date')?.textContent)
    .toContain('New date match')
  expect(search).toHaveBeenNthCalledWith(3, {
    conversation: caller,
    query: { ...query, to: '2026-02-15' },
  })
  finish(result([hit('stale-date', 'Old date page', 'W1.3')], null))
  await old
  await nextTick()
  expect(insidePalette('palette-row-open-new-date')?.textContent).toContain('New date match')
  expect(insidePalette('palette-row-open-first-date')).toBeNull()
  expect(insidePalette('palette-row-open-stale-date')).toBeNull()
  expect(insidePalette('palette-search-more')).toBeNull()
})

it('shows an inverted range without searching, clears it, and forgets dates on dismissal', async () => {
  const search = vi.fn<RuntimeBridge['searchWork']>().mockResolvedValue(result([], null))
  window.api.runtime.searchWork = search
  await openPalette()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setDate('from', '2026-03-20')
  setDate('to', '2026-03-01')
  await nextTick()
  await vi.advanceTimersByTimeAsync(180)
  expect(dateInput('from').getAttribute('aria-invalid')).toBe('true')
  expect(dateInput('to').getAttribute('aria-invalid')).toBe('true')
  expect(document.querySelector('.palette-refused[role="alert"]')?.textContent?.trim()).toBe(
    'From must be on or before To.',
  )
  expect(search).not.toHaveBeenCalled()

  const clear = insidePalette('palette-clear-dates')!
  clear.focus()
  await userEvent.keyboard('{Enter}')
  await nextTick()
  expect(dateInput('from').value).toBe('')
  expect(dateInput('to').value).toBe('')
  expect(document.querySelector('.palette-refused[role="alert"]')).toBeNull()
  await vi.advanceTimersByTimeAsync(180)
  expect(search).not.toHaveBeenCalled()

  setDate('to', '2026-03-01')
  await nextTick()
  await vi.advanceTimersByTimeAsync(180)
  expect(search).toHaveBeenCalledExactlyOnceWith({
    conversation: caller,
    query: { words: '', to: '2026-03-01', limit: 20, includeConversationMetadata: true },
  })
  dateInput('to').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await nextTick()
  expect(insidePalette('palette-date-to')).toBeNull()
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true, bubbles: true }),
  )
  await nextTick()
  expect(dateInput('from').value).toBe('')
  expect(dateInput('to').value).toBe('')
})

it('edits a native date without moving or opening the selected search result', async () => {
  const search = vi
    .fn<RuntimeBridge['searchWork']>()
    .mockResolvedValue(result([hit('native-date', 'Native date match', 'W1.2')], null))
  window.api.runtime.searchWork = search
  await openPalette()
  setDate('from', '2026-07-15')
  const row = () => insidePalette('palette-row-open-native-date')
  await expect.poll(() => row()?.getAttribute('aria-selected')).toBe('true')

  const date = dateInput('from')
  date.focus()
  await userEvent.keyboard('{ArrowUp}')
  await expect.poll(() => date.value).not.toBe('2026-07-15')
  expect(date.value).not.toBe('')
  await expect.poll(() => row()?.getAttribute('aria-selected')).toBe('true')
  await userEvent.keyboard('{Enter}')
  expect(document.activeElement).toBe(date)
  expect(row()?.getAttribute('aria-selected')).toBe('true')
  expect(insidePalette('palette-panel')).not.toBeNull()
})

it('keeps partial group counts unknown and discards a late grouped reply after mode changes', async () => {
  let finish!: (result: WorkSearchResult) => void
  const delayed = new Promise<WorkSearchResult>((resolve) => {
    finish = resolve
  })
  const partial = [
    { profile: 'editor', matched: null, previews: [preview('partial', 'Readable review')] },
  ]
  const search = vi
    .fn<RuntimeBridge['searchWork']>()
    .mockResolvedValueOnce(groupedPage(partial, null, null))
    .mockReturnValueOnce(delayed)
    .mockResolvedValueOnce(result([hit('flat-new', 'Flat current result', 'W9')], null))
  window.api.runtime.searchWork = search
  await openPalette()
  setGrouping(true)
  await expect
    .poll(() => insidePalette('palette-row-open-partial')?.textContent)
    .toContain('Readable review')
  expect(insidePalette('palette-profile-group')?.textContent?.trim()).toBe('Editor')
  expect(insidePalette('palette-row-expand-profile:editor')?.textContent?.trim()).toBe(
    'Search Editor',
  )
  expect(insidePalette('palette-search-more')).toBeNull()
  expect(insidePalette('palette-searched')?.textContent).toBe(
    '1 profile group shown. 1 unread row. Results may be incomplete.',
  )

  typeQuery('revised words')
  await expect.poll(() => search.mock.calls.length).toBe(2)
  setGrouping(false)
  await expect
    .poll(() => insidePalette('palette-row-open-flat-new')?.textContent)
    .toContain('Flat current result')
  finish(groupedPage(partial, null, null))
  await delayed
  await nextTick()
  expect(insidePalette('palette-row-open-partial')).toBeNull()
  expect(insidePalette('palette-row-open-flat-new')).not.toBeNull()
})

it('searches recorded conversations with the same cursor and opens an archived match read-only', async () => {
  const search = vi.fn<RuntimeBridge['searchWork']>()
  search.mockResolvedValueOnce(
    result(
      [
        {
          ...hit(caller, 'Recorded result title', 'W1.1', {
            provider: 'claude',
            archived_at: null,
            title_author: null,
          }),
          status: 'Draft sent & waiting for feedback',
        },
      ],
      'later',
      2,
    ),
  )
  search.mockResolvedValueOnce(
    result(
      [
        hit(archive, 'Archived result title', 'W1.2', {
          provider: 'codex',
          archived_at: 1_700_000_000_040,
          title_author: { kind: 'person' },
        }),
      ],
      null,
    ),
  )
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
        ordinal: 0,
        at: 1_700_000_000_000,
        event: { type: 'assistant_message', text: 'The archived review is attached.' },
      },
    ],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  const m = await openPalette(true)
  const profile = insidePalette('palette-profile-filter') as HTMLSelectElement
  expect(profile.value).toBe('')
  typeQuery('launch')
  profile.value = 'editor'
  profile.dispatchEvent(new Event('change', { bubbles: true }))

  await expect
    .poll(() => insidePalette(`palette-row-open-${caller}`)?.textContent)
    .toContain('Recorded result title')
  const first = insidePalette(`palette-row-open-${caller}`)!
  const detail = first.querySelector('small')!
  expect(detail.textContent).toContain(' · active · ')
  expect(detail.textContent).toContain(fullTime(1_700_000_000_000))
  expect(detail.textContent).toContain('Conversation W1.1')
  // The recorded status is one part of the row's one line, said there once.
  expect(detail.textContent!.split('Draft sent & waiting for feedback')).toHaveLength(2)
  const status = first.querySelector('[data-cy="palette-recorded-status"]')
  expect(status && detail.contains(status)).toBe(true)
  expect(status?.textContent?.trim()).toBe('Status: Draft sent & waiting for feedback')
  expect(status?.getAttribute('title')).toBe('Draft sent & waiting for feedback')
  expect(first.textContent).toContain('Claude')
  expect(first.textContent).not.toContain('Codex')
  expect(first.querySelector('[data-cy="palette-recorded-archive"]')).toBeNull()
  expect(first.querySelector('[data-cy="palette-recorded-title-author"]')).toBeNull()
  expect(search).toHaveBeenCalledExactlyOnceWith({
    conversation: caller,
    query: { words: 'launch', profile: 'editor', limit: 20, includeConversationMetadata: true },
  })
  insidePalette('palette-search-more')!.click()
  await expect
    .poll(() => insidePalette(`palette-row-open-${archive}`)?.textContent)
    .toContain('Archived result title')
  expect(search).toHaveBeenLastCalledWith({
    conversation: caller,
    query: {
      words: 'launch',
      profile: 'editor',
      limit: 20,
      cursor: 'later',
      includeConversationMetadata: true,
    },
  })
  const second = insidePalette(`palette-row-open-${archive}`)!
  expect(second.textContent).toContain('Codex')
  expect(second.querySelector('[data-cy="palette-recorded-status"]')).toBeNull()
  expect(second.querySelector('[data-cy="palette-recorded-archive"]')?.textContent).toBe('Archived')
  expect(second.querySelector('[data-cy="palette-recorded-title-author"]')?.textContent).toBe(
    'Named by you',
  )
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

it('adds deferred title details to the existing palette row', async () => {
  const title = hit('title-result', 'Recorded title', 'W4.5')
  const search = vi
    .fn<RuntimeBridge['searchWork']>()
    .mockResolvedValueOnce(result([title], 'title-details'))
    .mockResolvedValueOnce(result([{ ...title, status: 'Ready to read' }], null))
  window.api.runtime.searchWork = search
  await openPalette()
  typeQuery('recorded title')
  const row = () => insidePalette('palette-row-open-title-result')
  await expect.poll(() => row()?.textContent).toContain('Recorded title')
  insidePalette('palette-search-more')!.click()
  await expect.poll(() => row()?.textContent).toContain('Ready to read')
  expect(document.querySelectorAll('[data-cy="palette-row-open-title-result"]')).toHaveLength(1)
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

it('reads an archived Library row by the recorded ID without looking or resuming', async () => {
  const libraryKey = 'codex::provider-archive'
  window.api.runtime.listLibrary = vi.fn<RuntimeBridge['listLibrary']>(async () => ({
    entries: [
      {
        id: libraryKey,
        recordId: archive,
        providerSessionId: 'provider-archive',
        provider: 'codex',
        title: 'Archived planning notes',
        cwd: '/work/planning',
        preview: '',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_010,
        archivedAt: 1_700_000_000_040,
        bytes: null,
        origin: 'ours',
        onDisk: false,
        readable: true,
        child: null,
        derived: null,
        lastEnding: 'completed',
        unresumableReason: null,
      },
    ],
    matched: 1,
    counts: {
      total: 1,
      ours: 1,
      userHome: 0,
      restored: 0,
      imported: 0,
      notImported: 0,
      onlyHere: 1,
      providers: [{ provider: 'codex', total: 1 }],
    },
    skipped: [],
    skippedTotal: 0,
  }))
  runtime.resolveLink.mockResolvedValue({
    state: 'archived',
    kind: 'conversation',
    title: 'Archived planning notes',
    status: null,
    opens: { sessionId: archive },
  })
  runtime.latestHistory.mockResolvedValue({
    entries: [
      {
        ordinal: 0,
        at: 1_700_000_000_000,
        event: { type: 'assistant_message', text: 'These notes are still available to read.' },
      },
    ],
    from: 0,
    hasOlder: false,
    turnAligned: true,
  })
  const m = mount(RuntimeScreen, {})
  m.q('rail-sessions').click()
  await expect.poll(() => m.all(`library-read-${libraryKey}`).length).toBe(1)
  m.q(`library-read-${libraryKey}`).click()

  await expect.poll(() => m.all('linked-history').length).toBe(1)
  expect(runtime.resolveLink).toHaveBeenCalledWith(`brocrew://conversation/${archive}`)
  expect(runtime.latestHistory).toHaveBeenCalledWith({ sessionId: archive })
  expect(m.q('linked-history').textContent).toContain('These notes are still available to read.')
  expect(runtime.look).not.toHaveBeenCalled()
  expect(runtime.resume).not.toHaveBeenCalled()
  expect(runtime.startAndSend).not.toHaveBeenCalled()
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

it('labels an empty incomplete reading without claiming there are no matches', async () => {
  window.api.runtime.searchWork = vi.fn(async () => result([], null, 1))
  await openPalette()
  typeQuery('missing invoices')
  await expect
    .poll(() => insidePalette('palette-no-match')?.textContent)
    .toContain('No matches in the pages read')
  expect(insidePalette('palette-searched')?.textContent).toContain('1 unread row.')
})

it('keeps the footer conversation search on one normal-height row at the standard rail width', async () => {
  const m = await openPalette()
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => insidePalette('palette-search')).toBeNull()
  if (m.q('side-rail').dataset.collapsed === 'true') m.q('rail-fold').click()
  await nextTick()
  const rail = m.q('side-rail')
  const row = m.q('rail-find-conversation')
  const box = row.getBoundingClientRect()
  expect(rail.getBoundingClientRect().width).toBeCloseTo(251.68, 0)
  expect(box.height).toBeLessThanOrEqual(parseFloat(getComputedStyle(row).minHeight) + 1)
  expect(row.querySelector('use')?.getAttribute('href')).toBe('#i-search')
  const label = row.querySelector<HTMLElement>('.rail-copy strong')!
  expect(label.textContent).toBe('Find a conversation')
  expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth)
  expect(label.getBoundingClientRect().height).toBeLessThanOrEqual(
    parseFloat(getComputedStyle(label).lineHeight) + 1,
  )
  row.click()
  await expect.poll(() => insidePalette('palette-search')).not.toBeNull()
})
