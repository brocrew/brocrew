import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import AllTasksDialog from '../../src/renderer/src/components/AllTasksDialog.vue'
import { createTranscript } from '../../src/renderer/src/lib/transcript'
import type { AllConversationTasksResult } from '../../src/shared/conversation-task-page'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { WorkEdge } from '../../src/shared/who-called-whom'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

const sessionId = 'fictional-holder'
const giver = 'fictional-giver'
const root = {
  label: 'W9',
  title: 'Person’s original request',
  definitionOfDone: 'Keep the brief.',
}
const counts = { all: 22, active: 1, open: 3, closed: 18 }

function edge(position: number, state: WorkEdge['state'] = 'answered'): WorkEdge {
  return {
    piece: `piece-${30 - position}`,
    label: `W9.${position}`,
    title: `Draft ${position}`,
    from: giver,
    fromIdentity: 'editor',
    to: sessionId,
    toIdentity: null,
    state,
    givenAt: 1_000,
    endedAt: state === 'answered' ? 2_000 : null,
    definitionOfDone: position === 21 ? 'Share the appendix.' : null,
  }
}

type Page = Extract<AllConversationTasksResult, { ok: true }>
function result(partial: Partial<Page> = {}): Page {
  return {
    ok: true,
    conversation: sessionId,
    tasks: [],
    root: null,
    counts,
    matched: 0,
    newestOpenMatch: null,
    next: null,
    rowsUnread: 0,
    ledgersSkipped: 0,
    ...partial,
  }
}

function deferredPage() {
  let resolve!: (value: AllConversationTasksResult) => void
  const promise = new Promise<AllConversationTasksResult>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function show(readAll: RuntimeBridge['readAllConversationTasks']) {
  const active = ref(sessionId)
  const revision = ref(0)
  const open = vi.fn()
  const state = createTranscript()
  state.items.push({
    kind: 'relayed',
    id: 'brief',
    text: 'Use the transcript brief.',
    opened: { label: 'W9.21' },
  })
  const Consumer = defineComponent({
    setup: () => () =>
      h(AllTasksDialog, {
        conversation: active.value,
        source: {
          read: async () => ({ ok: false, reason: 'unknown-conversation' }) as const,
          readAll,
          revision: revision.value,
        },
        tasks: [],
        root: null,
        canOpen: true,
        identities: [
          {
            id: 'fictional-editor',
            slug: 'editor',
            displayName: 'Editor profile',
            createdAt: 1,
            createdBy: null,
            provider: null,
            externalMcpServerIds: [],
          },
        ],
        state,
        onOpenConversation: open,
      }),
  })
  const m = mount(Consumer, {})
  return {
    m,
    active,
    revision,
    open,
    titles: () => m.all('cast-work-said').map((node) => node.textContent?.trim()),
    current: () =>
      m.host.querySelector('.task.current [data-cy="cast-work-said"]')?.textContent?.trim(),
    search: (text: string) => {
      const input = m.q('all-tasks-search') as HTMLInputElement
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
  }
}

it('keeps root, ledger order, whole-set counts and newest open match across pages', async () => {
  const first = Array.from({ length: 20 }, (_, index) =>
    edge(index + 1, index < 2 ? 'waiting' : 'answered'),
  )
  const last = edge(21, 'working')
  const read = vi
    .fn<RuntimeBridge['readAllConversationTasks']>()
    .mockResolvedValueOnce(
      result({
        root,
        tasks: first,
        matched: 22,
        newestOpenMatch: last.piece,
        next: 'after-twenty',
      }),
    )
    .mockResolvedValueOnce(result({ tasks: [last], matched: 22, newestOpenMatch: last.piece }))
    .mockResolvedValueOnce(result({ tasks: [last], matched: 1, newestOpenMatch: last.piece }))
  const { m, titles, current, open } = show(read)
  await expect.poll(titles).toEqual([root.title, ...first.map((one) => one.title)])
  expect(current()).toBeUndefined()
  expect(m.q('cast-taken-work').tagName).toBe('SPAN')
  expect(m.q('all-tasks-count').textContent?.trim()).toBe('22 tasks')
  for (const [filter, count] of Object.entries(counts))
    expect(m.q(`all-tasks-filter-${filter}`).querySelector('.list-filter-count')?.textContent).toBe(
      String(count),
    )

  m.q('all-tasks-more').click()
  await expect.poll(titles).toEqual([root.title, ...first.map((one) => one.title), last.title])
  expect(read.mock.calls).toEqual([
    [{ sessionId, filter: 'all' }],
    [{ sessionId, filter: 'all', cursor: 'after-twenty' }],
  ])
  expect(current()).toBe(last.title)
  expect(m.q('cast-work-brief').textContent).toContain('Use the transcript brief.')
  expect(m.q('cast-work-done').textContent).toContain('Share the appendix.')
  const row = m.all('cast-taken-work').at(-1)!
  expect(row.textContent).toContain('Editor profile')
  row.click()
  expect(open).toHaveBeenCalledExactlyOnceWith(giver)

  m.q('all-tasks-filter-active').click()
  await expect.poll(titles).toEqual([last.title])
  expect(read).toHaveBeenLastCalledWith({ sessionId, filter: 'active' })
  expect(m.q('all-tasks-count').textContent?.trim()).toBe('1 task')
  expect(m.q('all-tasks-filter-all').querySelector('.list-filter-count')?.textContent).toBe('22')
})

it('retires stale continuations when search or conversation changes, and shows incomplete coverage', async () => {
  const lostNext = deferredPage()
  const lostSearch = deferredPage()
  const read = vi
    .fn<RuntimeBridge['readAllConversationTasks']>()
    .mockResolvedValueOnce(result({ root, tasks: [edge(1)], matched: 22, next: 'old-cursor' }))
    .mockReturnValueOnce(lostNext.promise)
    .mockReturnValueOnce(lostSearch.promise)
    .mockResolvedValueOnce(
      result({ conversation: 'second-holder', counts: null, matched: null, rowsUnread: 1 }),
    )
    .mockResolvedValueOnce(result({ conversation: 'second-holder' }))
  const { m, active, revision, titles, search } = show(read)
  await expect.poll(titles).toEqual([root.title, 'Draft 1'])
  m.q('all-tasks-more').click()
  search('  draft  ')
  await expect.poll(() => read.mock.calls.length).toBe(3)
  expect(read).toHaveBeenLastCalledWith({ sessionId, filter: 'all', text: 'draft' })
  active.value = 'second-holder'
  await expect.poll(() => m.all('all-tasks-unread').length).toBe(1)
  expect(read).toHaveBeenLastCalledWith({
    sessionId: 'second-holder',
    filter: 'all',
    text: 'draft',
  })
  expect(m.q('all-tasks-unread').textContent).toContain('1 row')
  expect(m.q('all-tasks-count').textContent?.trim()).toBe('0 tasks shown')
  expect(m.all('all-tasks-empty')).toHaveLength(0)
  expect(m.host.querySelectorAll('.list-filter-count')).toHaveLength(0)

  lostSearch.resolve(result({ tasks: [edge(2)] }))
  lostNext.resolve(result({ tasks: [edge(3)] }))
  await nextTick()
  expect(titles()).toEqual([])
  expect(m.all('all-tasks-unread')).toHaveLength(1)
  revision.value++
  await expect.poll(() => m.all('all-tasks-empty').length).toBe(1)
  expect(read).toHaveBeenLastCalledWith({
    sessionId: 'second-holder',
    filter: 'all',
    text: 'draft',
  })
})

it('restarts once at page one when an old cursor can no longer be read', async () => {
  const read = vi
    .fn<RuntimeBridge['readAllConversationTasks']>()
    .mockResolvedValueOnce(result({ root, tasks: [edge(1)], matched: 3, next: 'lost-anchor' }))
    .mockResolvedValueOnce({ ok: false, reason: 'invalid-cursor' })
    .mockResolvedValueOnce(
      result({ root, tasks: [edge(2)], matched: 2, counts: { ...counts, all: 2 } }),
    )
  const { m, titles, current } = show(read)
  await expect.poll(titles).toEqual([root.title, 'Draft 1'])
  m.q('all-tasks-more').click()
  await expect.poll(titles).toEqual([root.title, 'Draft 2'])
  expect(current()).toBe(root.title)
  expect(read.mock.calls).toEqual([
    [{ sessionId, filter: 'all' }],
    [{ sessionId, filter: 'all', cursor: 'lost-anchor' }],
    [{ sessionId, filter: 'all' }],
  ])
})
