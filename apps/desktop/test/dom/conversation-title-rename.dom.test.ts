import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { fullTime } from '../../src/renderer/src/lib/clock'
import type {
  ConversationIdentity,
  ConversationTitleHistory,
} from '../../src/shared/conversation-title'
import type {
  ConversationTaskPageResult,
  ConversationTaskPageRow,
} from '../../src/shared/conversation-task-page'
import type { ResumableSessionInfo, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { META, allTasks, mount } from './harness'
import {
  changed,
  disposeRuntimeScreenFixture,
  installRuntimeScreenFixture,
  runtime,
  sessions,
} from './runtime-screen-fixture'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

beforeEach(installRuntimeScreenFixture)
afterEach(disposeRuntimeScreenFixture)

const sessionId = 'fictional-conversation'
const serviceId = 'fictional-service'
const address = 'W1.1'
const task = { label: 'W1.4', title: 'Review the launch list', more: 2 }

function row(id: string, named: ResumableSessionInfo['named']): ResumableSessionInfo {
  return {
    sessionId: id,
    provider: 'claude',
    ref: {
      provider: 'claude',
      sessionId: `provider-record-${id}`,
      cwd: META.cwd,
      rotation: 0,
    },
    cwd: META.cwd,
    status: 'idle',
    running: 'unwatched',
    state: { is: 'idle' },
    named,
    approvalMode: 'ask',
    profileId: META.profileId,
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    lastEnding: null,
    child: null,
    resumeRefusal: null,
    updatedAt: 1,
  }
}

async function mountWith(sessionsToOpen: ResumableSessionInfo[]) {
  window.api.runtime.listResumable = async () => sessionsToOpen
  runtime.attachOpen.mockResolvedValueOnce(
    sessionsToOpen.map(({ sessionId }) => ({
      ...META,
      sessionId,
      handover: 'attached',
      history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
    })),
  )
  await sessions.attachOpen()
  return mount(RuntimeScreen, {})
}

it('renames the open conversation through the conversation command without retitling work', async () => {
  const initial: ConversationIdentity = {
    conversation: sessionId,
    address,
    title: 'Resolved conversation name',
    author: null,
  }
  let settleRead!: (identity: ConversationIdentity) => void
  const afterSave = new Promise<ConversationIdentity>((resolve) => {
    settleRead = resolve
  })
  const read = vi.fn<RuntimeBridge['readConversationIdentity']>(async () => afterSave)
  read.mockResolvedValueOnce(initial)
  window.api.runtime.readConversationIdentity = read
  const rename = vi.fn<RuntimeBridge['renameConversation']>(async (input) => ({
    ok: true,
    conversation: input.conversation,
    address,
    title: input.title.trim(),
    author: { kind: 'person' },
    previousTitle: initial.title,
    previousAuthor: null,
  }))
  const retitle = vi.fn<RuntimeBridge['retitleWork']>()
  window.api.runtime.renameConversation = rename
  window.api.runtime.retitleWork = retitle
  const m = await mountWith([row(sessionId, task)])
  await expect
    .poll(() => m.all('conversation-title-rename')[0]?.textContent?.trim())
    .toBe('Resolved conversation name')
  expect(m.q('conversation-title').parentElement?.textContent).not.toContain('Named by you')
  expect(read).toHaveBeenCalledExactlyOnceWith({ sessionId })
  expect(m.q('conversation-address').getBoundingClientRect().top).toBeLessThan(
    m.q('conversation-title').getBoundingClientRect().bottom,
  )
  read.mockClear()
  m.q('conversation-title-rename').click()
  await expect.poll(() => m.all('conversation-title-input').length).toBe(1)
  const input = m.q('conversation-title-input') as HTMLInputElement
  input.value = ' Edit launch notes '
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

  await expect.poll(() => m.q('conversation-title').textContent?.trim()).toBe('Edit launch notes')
  expect(rename).toHaveBeenCalledExactlyOnceWith({
    conversation: sessionId,
    title: ' Edit launch notes ',
  })
  expect(retitle).not.toHaveBeenCalled()
  expect(read).toHaveBeenCalledExactlyOnceWith({ sessionId })
  settleRead({
    ...initial,
    title: 'Edit launch notes for Friday',
    author: { kind: 'person' },
  })
  await expect
    .poll(() => m.q('conversation-title').textContent?.trim())
    .toBe('Edit launch notes for Friday')
  expect(m.q('conversation-address').textContent?.trim()).toBe('Conversation W1.1')
  expect(m.q('conversation-linked-task').textContent?.trim()).toBe(
    'Task W1.4 · Review the launch list (and 2 more)',
  )
})

it('reads canonical identity on selection, refreshes on work, and rereads on reopen', async () => {
  const initial: ConversationIdentity = {
    conversation: sessionId,
    address: sessionId,
    title: 'Initial profile name',
    author: null,
  }
  const service: ConversationIdentity = {
    conversation: serviceId,
    address: serviceId,
    title: 'Editorial service',
    author: { kind: 'agent', conversation: 'fictional-author' },
  }
  let primary = initial
  let serviceReading = service
  const read = vi.fn<RuntimeBridge['readConversationIdentity']>(async ({ sessionId: id }) =>
    id === sessionId ? primary : serviceReading,
  )
  window.api.runtime.readConversationIdentity = read
  const readRail = vi.fn<RuntimeBridge['readConversationIdentities']>(async ({ sessionIds }) =>
    sessionIds.map((id) => (id === sessionId ? primary : serviceReading)),
  )
  window.api.runtime.readConversationIdentities = readRail
  const m = await mountWith([row(serviceId, null), row(sessionId, null)])
  const title = () => m.all('conversation-title-rename')[0]?.textContent?.trim()
  const shownAddress = () => m.all('conversation-address')[0]?.textContent?.trim()

  await expect.poll(title).toBe('Initial profile name')
  expect(read).toHaveBeenCalledWith({ sessionId })
  expect(shownAddress()).toBe('Conversation fictional-conversation')
  expect(m.q('conversation-title').parentElement?.textContent).not.toContain('Named by you')
  await expect.poll(() => m.q(`rail-address-${sessionId}`).textContent).toBe(sessionId)
  expect(readRail).toHaveBeenLastCalledWith({ sessionIds: [sessionId, serviceId] })

  primary = { ...primary, title: 'Renamed profile fallback' }
  changed({ what: 'agents' })
  await expect.poll(title).toBe('Renamed profile fallback')
  await expect
    .poll(() => m.q(`open-session-${sessionId}`).getAttribute('aria-label'))
    .toBe('Renamed profile fallback')

  primary = { ...primary, address, title: 'First task title' }
  changed({ what: 'work' })
  await expect.poll(title).toBe('First task title')
  expect(shownAddress()).toBe('Conversation W1.1')
  expect(m.q('conversation-title').parentElement?.textContent).not.toContain('Named by you')

  primary = { ...primary, title: 'Title from another window', author: { kind: 'person' } }
  changed({ what: 'work' })
  await expect.poll(title).toBe('Title from another window')
  expect(m.q('conversation-title').parentElement?.textContent).toContain('Named by you')
  await expect.poll(() => m.q(`rail-address-${sessionId}`).textContent).toBe(address)
  await expect
    .poll(() => m.q(`open-session-${sessionId}`).getAttribute('aria-label'))
    .toBe('Title from another window')

  let settle!: (identity: ConversationIdentity | null) => void
  const stale = new Promise<ConversationIdentity | null>((resolve) => {
    settle = resolve
  })
  read.mockReturnValueOnce(stale)
  changed({ what: 'work' })
  expect(read).toHaveBeenLastCalledWith({ sessionId })
  m.q(`open-session-${serviceId}`).click()
  await expect.poll(title).toBe('Editorial service')
  expect(read).toHaveBeenLastCalledWith({ sessionId: serviceId })
  expect(shownAddress()).toBe('Conversation fictional-service')
  settle({ ...primary, title: 'Obsolete first conversation reply' })
  await stale
  await nextTick()
  expect(title()).toBe('Editorial service')
  expect(m.q('conversation-title').parentElement?.textContent).not.toContain('Named by you')

  m.q('rail-away').click()
  await expect.poll(() => m.all('conversation-title-rename').length).toBe(0)
  serviceReading = { ...service, title: 'Service after reopening' }
  m.q(`open-session-${serviceId}`).click()
  await expect.poll(title).toBe('Service after reopening')
  expect(read).toHaveBeenLastCalledWith({ sessionId: serviceId })
  expect(shownAddress()).toBe('Conversation fictional-service')
})

it('opens the selected conversation’s task section and focuses it', async () => {
  localStorage.setItem('brobot2.drawerOpen', 'false')
  localStorage.setItem('brobot2.drawerTab', 'info')
  localStorage.setItem('brobot2.cardTaskFolded', 'true')
  window.api.runtime.readConversationIdentity = vi.fn(async ({ sessionId: conversation }) => ({
    conversation,
    address,
    title: 'Review the launch',
    author: null,
  }))
  const m = await mountWith([row(sessionId, task)])
  await expect.poll(() => m.all('conversation-linked-task').length).toBe(1)
  expect(m.all('session-drawer')).toHaveLength(0)

  m.q('conversation-linked-task').click()
  await expect.poll(() => m.all('card-task').length).toBe(1)
  await expect.poll(() => m.q('card-task').dataset.folded).toBe('false')
  expect(m.q('drawer-tab-open').getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(m.q('card-task'))
  expect(m.q('conversation-pane').getAttribute('data-session-id')).toBe(sessionId)
})

const savedAt = Date.UTC(2026, 10, 10, 14, 30)

function savedTitles(
  title: string,
  ordinal: number,
  next: { generation: number; ordinal: number } | null = null,
  rowsUnread = 0,
): ConversationTitleHistory {
  return {
    kind: 'titles',
    titles: [{ title, ordinal, author: { kind: 'person' }, at: savedAt }],
    next,
    rowsUnread,
  }
}

it('reads saved titles only on demand, follows the cursor and restarts after a rebuild', async () => {
  const before = { generation: 4, ordinal: 19 }
  const beforeRebuild = { generation: 4, ordinal: 3 }
  const read = vi
    .fn<RuntimeBridge['readConversationTitleHistory']>()
    .mockResolvedValueOnce(savedTitles('Current saved title', 21, before))
    .mockResolvedValueOnce(savedTitles('Earlier saved title', 5, beforeRebuild, 1))
    .mockResolvedValueOnce({ kind: 'generation-changed' })
    .mockResolvedValueOnce(savedTitles('Title carried across rebuild', 2))
    .mockResolvedValueOnce(savedTitles('Title from the other window', 3))
  window.api.runtime.readConversationTitleHistory = read
  window.api.runtime.readConversationIdentity = vi.fn(async () => null)
  localStorage.setItem('brobot2.drawerOpen', 'true')
  localStorage.setItem('brobot2.drawerTab', 'open')
  const m = await mountWith([row(sessionId, task)])
  await expect.poll(() => m.all('conversation-title-history').length).toBe(1)
  const fallbackTitle = m.q('conversation-title').textContent?.trim()
  expect(fallbackTitle).toContain(task.title)
  expect(read).not.toHaveBeenCalled()

  const history = m.q('conversation-title-history')
  history.querySelector('summary')!.click()
  await expect.poll(() => m.all('conversation-saved-title').length).toBe(1)
  expect(read).toHaveBeenCalledExactlyOnceWith({ sessionId })
  expect(history.textContent).toContain('Current saved title')
  expect(history.textContent).toContain('Named by you')
  expect(history.querySelector('time')?.textContent).toBe(fullTime(savedAt))

  m.q('conversation-title-history-more').click()
  await expect.poll(() => m.all('conversation-saved-title').length).toBe(2)
  expect(read).toHaveBeenNthCalledWith(2, { sessionId, before })
  expect(
    m.all('conversation-saved-title').map((title) => title.querySelector('strong')?.textContent),
  ).toEqual(['Current saved title', 'Earlier saved title'])
  expect(history.textContent).toContain('1 saved title could not be read.')

  m.q('conversation-title-history-more').click()
  await expect.poll(() => history.textContent).toContain('Title carried across rebuild')
  expect(read).toHaveBeenNthCalledWith(3, { sessionId, before: beforeRebuild })
  expect(read).toHaveBeenNthCalledWith(4, { sessionId })
  expect(history.textContent).not.toContain('Earlier saved title')
  expect(m.q('conversation-title').textContent?.trim()).toBe(fallbackTitle)

  changed({ what: 'work' })
  await expect.poll(() => history.textContent).toContain('Title from the other window')
  expect(read).toHaveBeenNthCalledWith(5, { sessionId })
  expect(history.textContent).not.toContain('Title carried across rebuild')
  expect(m.q('conversation-title').textContent?.trim()).toBe(fallbackTitle)
})

it('keeps a delayed saved-title reply out of the next conversation', async () => {
  let finish!: (history: ConversationTitleHistory) => void
  const first = new Promise<ConversationTitleHistory>((resolve) => {
    finish = resolve
  })
  const read = vi.fn<RuntimeBridge['readConversationTitleHistory']>(({ sessionId: id }) =>
    id === sessionId ? first : Promise.resolve(savedTitles('Service saved title', 1)),
  )
  window.api.runtime.readConversationTitleHistory = read
  window.api.runtime.readConversationIdentity = vi.fn(async ({ sessionId: conversation }) => ({
    conversation,
    address: conversation,
    title: conversation,
    author: null,
  }))
  const m = await mountWith([row(serviceId, task), row(sessionId, task)])
  m.q(`open-session-${sessionId}`).click()
  await expect.poll(() => m.all('conversation-linked-task').length).toBe(1)
  m.q('conversation-linked-task').click()
  await expect.poll(() => m.all('conversation-title-history').length).toBe(1)
  m.q('conversation-title-history').querySelector('summary')!.click()
  await expect.poll(() => read.mock.calls.length).toBe(1)

  m.q(`open-session-${serviceId}`).click()
  await expect.poll(() => m.q('conversation-pane').dataset.sessionId).toBe(serviceId)
  m.q('conversation-linked-task').click()
  await expect.poll(() => m.all('conversation-title-history').length).toBe(1)
  const history = m.q('conversation-title-history') as HTMLDetailsElement
  if (!history.open) history.querySelector('summary')!.click()
  await expect.poll(() => history.textContent).toContain('Service saved title')
  expect(read.mock.calls).toEqual([[{ sessionId }], [{ sessionId: serviceId }]])
  finish(savedTitles('Late title for the old conversation', 4))
  await first
  await nextTick()
  expect(history.textContent).not.toContain('Late title for the old conversation')
})

const taskStatusAt = Date.UTC(2026, 10, 19, 15, 35)

function heldTask(number: number, title: string): ConversationTaskPageRow {
  return {
    kind: 'held',
    piece: `fictional-task-${number}`,
    label: `W1.${number}`,
    title,
    brief: 'Keep the old invoice number visible.',
    giver: null,
    definitionOfDone: 'Reconcile the final amounts.',
    state: number === 1 ? 'waiting-on-purpose' : 'answered',
    givenAt: Date.UTC(2026, 10, 18),
    statusLine: number === 1 ? { text: 'Waiting for the archived copy.', at: taskStatusAt } : null,
  }
}

type TaskPage = Extract<ConversationTaskPageResult, { ok: true }>

function taskPage(conversation: string, partial: Partial<TaskPage> = {}): TaskPage {
  return {
    ok: true,
    conversation,
    current: heldTask(1, 'Newest open invoice task'),
    other: [],
    counts: { active: 0, open: 1, closed: 0 },
    next: null,
    rowsUnread: 0,
    ledgersSkipped: 0,
    ...partial,
  }
}

function openTaskDrawer(): void {
  localStorage.setItem('brobot2.drawerOpen', 'true')
  localStorage.setItem('brobot2.drawerTab', 'open')
}

it('pages Other tasks, then rereads Current task when its saved cursor no longer applies', async () => {
  const others = Array.from({ length: 8 }, (_, i) => heldTask(i + 2, `Earlier task ${i + 1}`))
  const counts = { active: 0, open: 1, closed: 8 }
  const root: ConversationTaskPageRow = {
    ...heldTask(1, 'Person’s original request'),
    kind: 'root',
    label: 'W1',
    piece: 'fictional-root-task',
    state: null,
    statusLine: { text: 'The original request is open.', at: taskStatusAt + 60_000 },
  }
  const read = vi
    .fn<RuntimeBridge['readConversationTasks']>()
    .mockResolvedValueOnce(
      taskPage(sessionId, { other: others.slice(0, 5), counts, next: 'more-five' }),
    )
    .mockResolvedValueOnce(
      taskPage(sessionId, { other: others.slice(5, 7), counts, next: 'more-seven' }),
    )
    .mockResolvedValueOnce({ ok: false, reason: 'invalid-cursor' })
    .mockResolvedValueOnce(
      taskPage(sessionId, { current: root, counts: null, rowsUnread: 1, other: [others[0]!] }),
    )
  window.api.runtime.readConversationTasks = read
  openTaskDrawer()
  const m = await mountWith([row(sessionId, task)])
  const currentText = () => m.all('cast-taken')[0]?.textContent
  function otherTitles() {
    const titles = m.q('cast-other').querySelectorAll('[data-cy="cast-work-said"]')
    return Array.from(titles, (element) => element.textContent?.trim())
  }
  await expect.poll(currentText).toContain('Newest open invoice task')
  expect(read).toHaveBeenCalledExactlyOnceWith({ sessionId })
  expect(currentText()).toContain('Reconcile the final amounts.')
  expect(currentText()).toContain('Keep the old invoice number visible.')
  expect(currentText()).not.toContain('Person’s original request')
  expect(m.q('card-task-status').textContent).toContain('Waiting for the archived copy.')
  expect(m.q('card-task-status').querySelector('time')?.textContent).toBe(fullTime(taskStatusAt))
  expect(otherTitles()).toEqual(others.slice(0, 5).map((item) => item.title))
  expect(m.q('card-task-counts').textContent?.trim()).toBe('0 active · 1 open · 8 closed')
  expect(m.q('card-other-tasks-more').textContent?.trim()).toBe('Show 5 more · 5 of 8')
  expect(m.q('card-tasks-all').textContent).toContain('All tasks')
  const popup = await allTasks(m)
  expect(popup.host.getAttribute('aria-labelledby')).toBe('all-tasks-title')
  popup.q('close-overlay').click()
  await nextTick()

  m.q('card-other-tasks-more').click()
  await expect.poll(otherTitles).toEqual(others.slice(0, 7).map((item) => item.title))
  expect(read).toHaveBeenNthCalledWith(2, { sessionId, cursor: 'more-five' })
  expect(m.q('card-other-tasks-more').textContent?.trim()).toBe('Show 5 more · 7 of 8')
  m.q('card-other-tasks-more').click()
  await expect.poll(currentText).toContain('Person’s original request')
  expect(read.mock.calls).toEqual([
    [{ sessionId }],
    [{ sessionId, cursor: 'more-five' }],
    [{ sessionId, cursor: 'more-seven' }],
    [{ sessionId }],
  ])
  expect(currentText()).not.toContain('Newest open invoice task')
  expect(otherTitles()).toEqual([others[0]!.title])
  expect(m.all('card-task-counts')).toHaveLength(0)
  expect(m.q('card-tasks-all').textContent).not.toContain('(')
  expect(m.q('cast-taken-short').textContent).toContain('1 row of this app’s record')
  expect(m.q('card-task-status').querySelector('time')?.textContent).toBe(
    fullTime(taskStatusAt + 60_000),
  )
})

it('ignores a former selection’s task page and refreshes the selected task on work notices', async () => {
  let finish!: (result: ConversationTaskPageResult) => void
  const old = new Promise<ConversationTaskPageResult>((resolve) => {
    finish = resolve
  })
  const selected = heldTask(1, 'Selected service task')
  const read = vi
    .fn<RuntimeBridge['readConversationTasks']>()
    .mockReturnValueOnce(old)
    .mockResolvedValueOnce(taskPage(serviceId, { current: selected }))
    .mockResolvedValueOnce(
      taskPage(serviceId, { current: { ...selected, title: 'Refreshed service task' } }),
    )
  window.api.runtime.readConversationTasks = read
  openTaskDrawer()
  const m = await mountWith([row(serviceId, null), row(sessionId, task)])
  await expect.poll(() => read.mock.calls.length).toBe(1)
  expect(read).toHaveBeenCalledExactlyOnceWith({ sessionId })
  m.q(`open-session-${serviceId}`).click()
  const currentText = () => m.all('cast-taken')[0]?.textContent
  await expect.poll(currentText).toContain('Selected service task')
  expect(read).toHaveBeenNthCalledWith(2, { sessionId: serviceId })
  finish(taskPage(sessionId))
  await old
  await nextTick()
  expect(currentText()).toContain('Selected service task')
  expect(currentText()).not.toContain('Newest open invoice task')
  changed({ what: 'work' })
  await expect.poll(currentText).toContain('Refreshed service task')
  expect(read).toHaveBeenNthCalledWith(3, { sessionId: serviceId })
})
