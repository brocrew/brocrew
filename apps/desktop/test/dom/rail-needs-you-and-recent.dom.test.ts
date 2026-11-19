import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { AgentState } from '../../src/shared/agent-state-contracts'
import type { ListingAnswer } from '../../src/shared/listing-published'
import type { ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import { mount, parseColor, record, unmountAll, type Mounted } from './harness'
import { memoryStorage } from './memory-storage'

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
  row('older-approval', 'brobot', 7, { is: 'needs-you' }),
]
const recent = [
  row('oldest', 'reviewer', 12),
  row('latest', 'brobot', 1),
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

async function rail(listed: ResumableSessionInfo[], props: Record<string, unknown> = {}) {
  const selected: string[] = []
  const api = {
    runtime: {
      listConversations: async (): Promise<ListingAnswer> => ({
        resumable: listed,
        unresumable: [],
        published: {
          epoch: { run: 'fictional-run', n: 0 },
          seq: 1,
          covers: { population: 'listing', complete: true },
        },
      }),
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
    { width: 266, height: 900 },
  )
  await expect.poll(() => m.all('conversations-loading').length).toBe(0)
  return { ...m, selected }
}

const ids = (m: Mounted, key: 'needs-you' | 'recent') =>
  [...m.q(`rail-rows-${key}`).querySelectorAll<HTMLElement>('[data-session-id]')].map(
    (element) => element.dataset.sessionId,
  )
const count = (m: Mounted, hook: string) => m.q(hook).textContent?.trim()

it('puts Needs you first, then one Recent list across the existing profiles', async () => {
  const m = await rail(all, {
    agents: { identities: [{ id: 'aid:brobot', slug: 'brobot', displayName: 'Jarvis' }] },
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

it('pages eligible Recent at fifteen, keeps older rows, and counts the live/listed overlap once', async () => {
  const older = Array.from({ length: 18 }, (_item, index) =>
    row(`older-${index}`, 'brobot', index + 2),
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
  expect(row?.textContent).toContain('claude · idle')
})
