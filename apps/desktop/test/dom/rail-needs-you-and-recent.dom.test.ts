import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cdp } from 'vitest/browser'
import type {} from '@vitest/browser-playwright'
import { nextTick } from 'vue'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { AgentState } from '../../src/shared/agent-state-contracts'
import type { ConversationIdentity } from '../../src/shared/conversation-title'
import type { ListingAnswer, RecentConversation } from '../../src/shared/listing-published'
import type { ResumableSessionInfo, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, parseColor, record, unmountAll, type Mounted } from './harness'
import { memoryStorage } from './memory-storage'
import { drawnReady, titleRecovers } from './drawn'
import { acceptEvent } from '../../src/renderer/src/lib/session-record'

const NOW = 1_700_000_000_000

const row = (
  id: string,
  profile: string,
  days: number,
  state: AgentState = { is: 'idle' },
): ResumableSessionInfo => ({
  sessionId: id,
  provider: 'claude',
  cwd: '/fictional/work',
  status: 'idle',
  state,
  named: null,
  approvalMode: 'ask',
  profileId: profile,
  reasoningEffort: null,
  model: null,
  planMode: null,
  adoptedAt: null,
  hasTranscript: true,
  child: null,
  lastEnding: 'completed',
  updatedAt: NOW - days * 86_400_000,
  running: 'not-running',
  ref: { provider: 'claude', sessionId: `thread-${id}`, cwd: '/fictional/work', rotation: 0 },
  resumeRefusal: null,
})

const waiting = [
  row('recent-approval', 'reviewer', 2, { is: 'needs-you' }),
  row('older-approval', 'recipe-worker', 7, { is: 'needs-you' }),
]
const recent = [
  row('oldest', 'reviewer', 12),
  row('latest', 'recipe-worker', 1),
  row('middle', 'developer', 3),
]
const all = [...recent, ...waiting]
let storage: Storage

beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

async function rail(
  listed: ResumableSessionInfo[],
  props: Record<string, unknown> = {},
  width = 266,
  first?: { readonly rows: readonly RecentConversation[]; readonly until: Promise<void> },
) {
  const selected: string[] = []
  const api = {
    runtime: {
      providerCatalogue: async () => PROVIDER_DESCRIPTORS,
      listRecentConversations: first === undefined ? undefined : async () => first.rows,
      listConversations: async (): Promise<ListingAnswer> => {
        if (first !== undefined) await first.until
        return {
          resumable: listed,
          unresumable: [],
          published: {
            epoch: { run: 'fictional-run', n: 0 },
            seq: 1,
            covers: { population: 'listing', complete: true },
          },
        }
      },
    },
  }
  vi.stubGlobal('api', api)
  const m = mount(
    SideRail,
    {
      open: [],
      activeId: null,
      place: null,
      onSelect: (id: string) => selected.push(id),
      ...props,
    },
    { width, height: 900 },
  )
  await expect.poll(() => m.all('conversations-loading').length).toBe(0)
  return { ...m, selected }
}

const ids = (m: Mounted, key: 'needs-you' | 'recent') =>
  [...m.q(`rail-rows-${key}`).querySelectorAll<HTMLElement>('[data-session-id]')].map(
    (element) => element.dataset.sessionId,
  )
const count = (m: Mounted, hook: string) => m.q(hook).textContent?.trim()

it('uses a pointer and does not select text when dragged across sidebar controls', async () => {
  const m = await rail([row('browse', 'reviewer', 1)])
  const mouse = await cdp()
  const frame = window.frameElement?.getBoundingClientRect()
  const pageX = (x: number) => (frame ? frame.left + (x * frame.width) / window.innerWidth : x)
  const pageY = (y: number) => (frame ? frame.top + (y * frame.height) / window.innerHeight : y)
  for (const element of [
    m.q('rail-sessions').querySelector('strong')!,
    m.q('open-session-browse').querySelector('strong')!,
  ]) {
    const range = document.createRange()
    range.selectNodeContents(element)
    const { left, right, top, height } = range.getBoundingClientRect()
    expect(right - left).toBeGreaterThan(16)
    const y = pageY(top + height / 2)
    const start = pageX(left + 2)
    const end = pageX(right - 2)
    const pressed = vi.fn()
    element.addEventListener('mousedown', pressed, { once: true })
    window.getSelection()?.removeAllRanges()
    await mouse.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start, y })
    expect(getComputedStyle(element).cursor).toBe('pointer')
    const control = element.closest('button, [role="button"]')!
    expect(getComputedStyle(control).userSelect).toBe('none')
    await mouse.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: start,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    try {
      expect(pressed).toHaveBeenCalledOnce()
      await mouse.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: end,
        y,
        button: 'left',
        buttons: 1,
      })
    } finally {
      await mouse.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: end,
        y,
        button: 'left',
        clickCount: 1,
      })
    }
    expect(window.getSelection()?.toString()).toBe('')
  }
})

it('opens a recent conversation before its state arrives and then shows the full list', async () => {
  const now = row('recent-approval', 'reviewer', 0, { is: 'needs-you' })
  const before = row('temporary', 'reviewer', 1)
  let finishFull!: () => void
  const full = new Promise<void>((resolve) => {
    finishFull = resolve
  })
  const readIdentities = vi.fn(async () => [])
  const m = await rail([now], { readIdentities }, 266, {
    rows: [now, before].map((row) => ({
      ...row,
      identity: {
        conversation: row.sessionId,
        address: 'W1.2',
        title: 'Review the plans',
        author: null,
      },
    })),
    until: full,
  })
  expect(ids(m, 'recent')).toEqual(['recent-approval', 'temporary'])
  expect(m.all('rail-needs-you')).toHaveLength(0)
  expect(m.all('rail-state-word-recent-approval')).toHaveLength(0)
  expect(readIdentities).not.toHaveBeenCalled()
  const button = m.q('open-session-recent-approval')
  expect(button.getAttribute('aria-label')).toBe('Review the plans')
  button.click()
  expect(m.selected).toEqual(['recent-approval'])

  finishFull()
  await expect.poll(() => m.all('rail-needs-you').length).toBe(1)
  expect(ids(m, 'needs-you')).toEqual(['recent-approval'])
  expect(m.all('open-session-temporary')).toHaveLength(0)
})

it('puts Needs you first, then one Recent list across the existing profiles', async () => {
  const m = await rail(all, {
    agents: {
      identities: [{ id: 'aid:recipe-worker', slug: 'recipe-worker', displayName: 'Jarvis' }],
    },
  })
  expect(
    [...m.host.querySelectorAll('[data-cy^="rail-section-"]')].map((el) =>
      el.getAttribute('data-cy'),
    ),
  ).toEqual(['rail-section-needs-you', 'rail-section-recent'])
  expect(ids(m, 'needs-you')).toEqual(['recent-approval', 'older-approval'])
  expect(ids(m, 'recent')).toEqual(['latest', 'middle', 'oldest'])
  expect(count(m, 'rail-needs-you')).toBe('2')
  expect(count(m, 'rail-count-recent')).toBe('3 of 3')
  expect(m.q('open-session-latest').textContent).toContain('Jarvis')
  for (const key of ['needs-you', 'recent'] as const) {
    const button = m.q(`rail-toggle-${key}`)
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toBe(
      m.q(`rail-rows-${key}`),
    )
  }
})

it.each([251.68, 266.2])(
  '%spx · keeps the full canonical title in one ellipsized line with hover',
  async (width) => {
    const longTitle = 'Lisbon trip, March renewal ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const listed = [waiting[0]!, recent[0]!]
    const m = await rail(
      listed,
      {
        readIdentities: async () =>
          listed.map(({ sessionId }) => ({
            conversation: sessionId,
            address: 'W9.8',
            title: longTitle,
            author: null,
          })),
      },
      width,
    )
    await drawnReady()
    for (const [index, section] of ['needs-you', 'recent'].entries()) {
      const id = listed[index]!.sessionId
      await expect.poll(() => m.all(`rail-address-${id}`).length).toBe(1)
      const entry = m.q(`open-session-${id}`)
      const title = entry.querySelector('strong')!
      const first = m.q(`rail-toggle-${section}`).getBoundingClientRect()
      const meta = entry.querySelector('[data-standing]')!.getBoundingClientRect()
      const titleBox = title.getBoundingClientRect()
      expect(title.textContent?.trim()).toBe(longTitle)
      expect(getComputedStyle(title).whiteSpace).toBe('nowrap')
      expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
      expect(titleBox.height).toBeLessThanOrEqual(
        Number.parseFloat(getComputedStyle(title).lineHeight) + 0.1,
      )
      expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
      expect(titleRecovers(title)).toBe(true)
      expect(titleBox.top).toBeGreaterThanOrEqual(first.bottom)
      expect(titleBox.bottom).toBeLessThanOrEqual(meta.top)
      expect(m.q(`rail-address-${id}`).textContent).toBe('W9.8')
    }
  },
)

it('keeps canonical rows to title, standing and address for open and answered tasks', async () => {
  const listed = [
    { ...waiting[0]!, named: { label: 'W18.1', title: 'A33 check', ended: 'answered' as const } },
    { ...waiting[1]!, named: { label: 'W18.2', title: 'Pending check' } },
    {
      ...recent[0]!,
      named: { label: 'W18.3', title: 'Earlier check', ended: 'answered' as const },
    },
    { ...recent[1]!, named: { label: 'W18.4', title: 'Current check' } },
  ]
  const m = await rail(listed, {
    readIdentities: async () =>
      listed.map(({ sessionId }, index) => ({
        conversation: sessionId,
        address: `W${18 + index}`,
        title: index === 0 ? 'A33' : `Saved conversation ${index}`,
        author: { kind: 'person' },
      })),
  })
  for (const [index, { sessionId, named }] of listed.entries()) {
    await expect.poll(() => m.all(`rail-address-${sessionId}`).length).toBe(1)
    const entry = m.q(`open-session-${sessionId}`)
    const lines = [...entry.querySelector('.rail-copy')!.children]
    expect(lines.map(({ tagName }) => tagName)).toEqual(['STRONG', 'SMALL', 'SMALL'])
    expect(lines[0]!.textContent?.trim()).toBe(index === 0 ? 'A33' : `Saved conversation ${index}`)
    expect(lines[1]!.getAttribute('data-standing')).toBe(index < 2 ? 'waiting' : 'idle')
    expect(lines[2]!.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `Conversation W${18 + index} · Claude · Named by you`,
    )
    expect(entry.textContent).not.toContain(named.title)
    expect(entry.textContent).not.toContain('(answered)')
    entry.click()
  }
  expect(m.selected).toEqual(listed.map(({ sessionId }) => sessionId))
})

it('pages eligible Recent at fifteen, keeps older rows, and counts the live/listed overlap once', async () => {
  const older = Array.from({ length: 18 }, (_item, index) =>
    row(`older-${index}`, 'recipe-worker', index + 2),
  )
  const m = await rail([...waiting, ...older].reverse(), {
    open: [record([], 'older-1')],
    activeId: 'older-17',
  })

  expect(ids(m, 'needs-you')).toEqual(['recent-approval', 'older-approval'])
  expect(ids(m, 'recent')).toEqual(older.slice(0, 15).map(({ sessionId }) => sessionId))
  expect(count(m, 'rail-count-recent')).toBe('15 of 18')
  expect(count(m, 'rail-show-more')).toBe('Show 3 more')
  expect(m.q('rail-toggle-recent').dataset.active).toBe('true')
  m.q('rail-show-more').click()
  await nextTick()
  expect(ids(m, 'recent')).toEqual(older.map(({ sessionId }) => sessionId))
  expect(count(m, 'rail-count-recent')).toBe('18 of 18')
  expect(m.q('rail-toggle-recent').dataset.active).toBe('false')
  expect(m.q('open-session-older-17').dataset.active).toBe('true')
  expect(m.all('rail-show-more')).toHaveLength(0)
  expect(ids(m, 'needs-you')).toEqual(['recent-approval', 'older-approval'])
})

it('joins identities only for visible rows in bounded raw-ID batches and discards folded replies', async () => {
  const older = Array.from({ length: 18 }, (_, i) => row(`story-${i}`, 'recipe-worker', i + 3))
  const identity = (
    conversation: string,
    title = 'Resolved ' + conversation,
  ): ConversationIdentity => ({
    conversation,
    title,
    address: 'address/' + conversation,
    author: conversation === 'story-0' ? { kind: 'person' } : null,
  })
  let finish!: (items: readonly ConversationIdentity[]) => void
  const first = new Promise<readonly ConversationIdentity[]>((resolve) => {
    finish = resolve
  })
  const read = vi
    .fn<RuntimeBridge['readConversationIdentities']>()
    .mockImplementation(({ sessionIds }) =>
      Promise.resolve(sessionIds.filter((id) => id !== 'story-1').map((id) => identity(id))),
    )
    .mockReturnValueOnce(first)
  const m = await rail([...waiting, ...older], { readIdentities: read })
  expect(read.mock.calls.map(([batch]) => batch.sessionIds.length)).toEqual([15, 2])
  expect(read.mock.calls.flatMap(([batch]) => batch.sessionIds).sort()).toEqual(
    [...waiting, ...older.slice(0, 15)].map(({ sessionId }) => sessionId).sort(),
  )
  m.q('rail-toggle-recent').click()
  await expect.poll(() => m.all('rail-address-recent-approval').length).toBe(1)
  expect(read).toHaveBeenLastCalledWith({
    sessionIds: ['older-approval', 'recent-approval'],
  })
  finish([identity('recent-approval', 'Obsolete waiting title'), identity('story-0')])
  await first
  await nextTick()
  expect(m.q('open-session-recent-approval').getAttribute('aria-label')).toBe(
    'Resolved recent-approval',
  )
  m.q('rail-toggle-recent').click()
  await expect.poll(() => m.all('rail-address-story-0').length).toBe(1)
  expect(m.q('open-session-story-0').getAttribute('aria-label')).toBe('Resolved story-0')
  expect(count(m, 'rail-address-story-0')).toBe('address/story-0')
  expect(m.q('open-session-story-0').textContent).toContain('Named by you')
  expect(count(m, 'rail-address-story-2')).toBe('address/story-2')
  expect(m.q('open-session-story-2').textContent).not.toContain('Named by you')
  expect(m.q('open-session-story-1').textContent).not.toContain('Named by you')
  expect(m.all('rail-address-story-1')).toHaveLength(0)
  expect(m.all('rail-address-story-17')).toHaveLength(0)
  m.q('rail-show-more').click()
  await expect.poll(() => m.all('rail-address-story-17').length).toBe(1)
  expect(count(m, 'rail-address-story-17')).toBe('address/story-17')
  m.q('open-session-story-17').click()
  expect(m.selected).toEqual(['story-17'])
  expect(count(m, 'rail-count-recent')).toBe('18 of 18')
})

it('keeps the count and painted selection on a folded section, without folding the other', async () => {
  const m = await rail(all, { activeId: 'older-approval' })
  const needs = m.q('rail-toggle-needs-you')
  const recent = m.q('rail-toggle-recent')
  expect(m.q('open-session-older-approval').dataset.active).toBe('true')
  expect(needs.dataset.active).toBe('false')
  needs.click()
  await nextTick()
  expect(m.all('rail-rows-needs-you')).toHaveLength(0)
  expect(needs.getAttribute('aria-expanded')).toBe('false')
  expect(needs.getAttribute('aria-controls')).toBeNull()
  expect(needs.dataset.active).toBe('true')
  expect(needs.getAttribute('title')).toBe('The conversation on screen is in here')
  expect(parseColor(getComputedStyle(needs).backgroundColor)?.[3] ?? 0).toBeGreaterThan(0)
  expect(count(m, 'rail-needs-you')).toBe('2')
  expect(recent.dataset.active).toBe('false')
  expect(ids(m, 'recent')).toEqual(['latest', 'middle', 'oldest'])

  needs.click()
  await nextTick()
  expect(ids(m, 'needs-you')).toEqual(['recent-approval', 'older-approval'])
})

it('remembers each fold independently and a destination leaves the hidden selection unmarked', async () => {
  const first = await rail(all, { activeId: 'older-approval', place: 'waiting' })
  first.q('rail-toggle-needs-you').click()
  await nextTick()
  expect(first.q('rail-toggle-needs-you').dataset.active).toBe('false')
  expect(storage.getItem('brobot2.railNeedsYouOpen')).toBe('false')
  expect(storage.getItem('brobot2.railRecentOpen')).toBeNull()
  unmountAll()

  const again = await rail(all, { activeId: 'older-approval' })
  expect(again.q('rail-toggle-needs-you').dataset.active).toBe('true')
  expect(again.q('rail-toggle-recent').getAttribute('aria-expanded')).toBe('true')
  again.q('rail-toggle-recent').click()
  await nextTick()
  expect(storage.getItem('brobot2.railRecentOpen')).toBe('false')
  expect(count(again, 'rail-count-recent')).toBe('3')
  unmountAll()

  const saved = await rail(all)
  expect(saved.q('rail-toggle-recent').getAttribute('aria-expanded')).toBe('false')
  expect(saved.all('rail-rows-recent')).toHaveLength(0)
  expect(count(saved, 'rail-count-recent')).toBe('3')
  expect(saved.q('rail-toggle-needs-you').getAttribute('aria-expanded')).toBe('false')
  unmountAll()

  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  const fresh = await rail(all)
  expect(ids(fresh, 'needs-you')).toHaveLength(2)
  expect(ids(fresh, 'recent')).toHaveLength(3)
})

it('omits empty sections and keeps rows selectable in either section', async () => {
  const onlyRecent = await rail(recent)
  expect(onlyRecent.all('rail-section-needs-you')).toHaveLength(0)
  onlyRecent.q('open-session-latest').click()
  expect(onlyRecent.selected).toEqual(['latest'])
  unmountAll()

  const onlyNeeds = await rail(waiting)
  expect(onlyNeeds.all('rail-section-recent')).toHaveLength(0)
  onlyNeeds.q('open-session-older-approval').click()
  expect(onlyNeeds.selected).toEqual(['older-approval'])
  onlyNeeds.q('rail-toggle-needs-you').click()
  await nextTick()
  expect(onlyNeeds.selected).toEqual(['older-approval'])
})

it('keeps a folded section’s rows reachable from the existing palette', async () => {
  const m = await rail(all)
  m.q('rail-toggle-recent').click()
  await nextTick()
  expect(m.all('open-session-latest')).toHaveLength(0)
  m.q('command-palette').click()
  await nextTick()
  const row = document.querySelector('[data-cy="palette-row-open-latest"]')
  expect(row?.textContent).toContain('Claude · idle')
})

it.each([251.68, 266.2])(
  '%spx · person openings distinguish canonical roots without a fourth preview',
  async (width) => {
    const roots = [
      row('person-waiting', 'recipe-worker', 1, { is: 'needs-you' }),
      row('person-recent', 'recipe-worker', 2),
    ]
    const openings = ['Plan the garden for spring', 'Review the bicycle repair options']
    const opened = roots.map(({ sessionId }, index) => {
      const opened = record([], sessionId)
      opened.meta = { ...opened.meta!, sessionId, profileId: 'brobot' }
      acceptEvent(opened, {
        sessionId,
        ordinal: 0,
        at: NOW,
        event: { type: 'user_turn', text: openings[index]!, humanInitiated: true },
      })
      return opened
    })
    let finish!: (identities: ConversationIdentity[]) => void
    const pending = new Promise<ConversationIdentity[]>((resolve) => {
      finish = resolve
    })
    const m = await rail(roots, { open: opened, readIdentities: () => pending }, width)
    for (const { sessionId } of roots) {
      await expect.poll(() => m.all(`session-opening-${sessionId}`).length).toBe(1)
    }
    finish(
      roots.map(({ sessionId }, index) => ({
        conversation: sessionId,
        address: `W${17 + index}`,
        title: openings[index]!,
        author: null,
      })),
    )
    for (const [index, { sessionId }] of roots.entries()) {
      await expect.poll(() => m.all(`rail-address-${sessionId}`).length).toBe(1)
      const entry = m.q(`open-session-${sessionId}`)
      expect(
        [...entry.querySelector('.rail-copy')!.children].map(({ tagName }) => tagName),
      ).toEqual(['STRONG', 'SMALL', 'SMALL'])
      expect(entry.querySelector('strong')!.textContent).toBe(openings[index])
      expect(entry.querySelector('strong')!.title).toBe(openings[index])
      expect(m.all(`session-opening-${sessionId}`)).toHaveLength(0)
      for (const id of entry.getAttribute('aria-describedby')!.split(' ')) {
        expect(document.getElementById(id)).not.toBeNull()
      }
      expect(m.q(`rail-address-${sessionId}`).textContent).toBe(`W${17 + index}`)
      entry.click()
    }
    expect(m.selected).toEqual(roots.map(({ sessionId }) => sessionId))
  },
)
