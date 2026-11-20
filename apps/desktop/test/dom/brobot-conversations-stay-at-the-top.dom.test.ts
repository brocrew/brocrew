import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import { CONVERSATION_IDENTITY_BATCH_SIZE } from '../../src/shared/conversation-title'
import { mount, unmountAll } from './harness'
import { memoryStorage } from './memory-storage'
import { workerRows, identities } from './parallel-workers-fixture'
import { drawnReady } from './drawn'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import { mount, unmountAll } from './harness'
import { workerRows, NOW } from './parallel-workers-fixture'
import { memoryStorage } from './memory-storage'
import { drawnReady } from './drawn'

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

const base = workerRows(1)[0]!
function person(number: number, waiting = false): ResumableSessionInfo {
  return {
    ...base,
    worker: undefined,
    sessionId: `person-${number}`,
    profileId: 'brobot',
    personStarted: true,
    state: { is: waiting ? 'needs-you' : 'idle' },
    updatedAt: NOW - number * 1000,
    named: { label: `W${number}`, title: `Conversation ${number}` },
  }
}
async function draw(rows: ResumableSessionInfo[], activeId: string | null = null) {
  const selected: string[] = []
  vi.stubGlobal('api', {
    runtime: {
      listConversations: async () => ({
        resumable: rows,
        unresumable: [],
        published: {
          epoch: { run: 'rail-restore', n: 0 },
          seq: 1,
          covers: { population: 'listing', complete: true },
        },
      }),
    },
  })
  const reads: string[][] = []
  const byId = new Map(rows.map((row) => [row.sessionId, row]))
  const m = mount(
    SideRail,
    {
      open: [],
      activeId,
      place: null,
      onSelect: (id: string) => selected.push(id),
      readIdentities: async ({ sessionIds }: { sessionIds: string[] }) => {
        reads.push(sessionIds)
        return sessionIds.map((id) => ({
          conversation: id,
          address: byId.get(id)!.named?.label ?? id,
          title: byId.get(id)!.named?.title ?? 'Helper',
          author: null,
        }))
      },
    },
    { width: 280, height: 1200 },
  )
  await expect.poll(() => m.all('conversations-loading').length).toBe(0)
  await nextTick()
  return { ...m, selected, reads }
}
const ids = (m: ReturnType<typeof mount>, key: string) =>
  [...m.q(`rail-rows-${key}`).querySelectorAll<HTMLElement>('[data-session-id]')].map(
    (row) => row.dataset.sessionId,
  )

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

function person(number: number, waiting = false): ResumableSessionInfo {
  const base = workerRows(1)[0]!
  return {
    ...base,
    sessionId: `person-${number}`,
    profileId: 'brobot',
    personStarted: true,
    worker: undefined,
    state: { is: waiting ? 'needs-you' : 'idle' },
    named: { label: `W${number}`, title: `Conversation ${number}` },
    updatedAt: Date.now() - number * 3600000,
  }
}

async function draw(rows: ResumableSessionInfo[], activeId: string | null = null) {
  const selected: string[] = []
  const reads: string[][] = []
  vi.stubGlobal('api', {
    runtime: {
      listConversations: async () => ({
        resumable: rows,
        unresumable: [],
        published: {
          epoch: { run: 'brobot-restore', n: 0 },
          seq: 1,
          covers: { population: 'listing', complete: true },
        },
      }),
    },
  })
  const m = mount(
    SideRail,
    {
      open: [],
      activeId,
      place: null,
      agents: identities(rows.length),
      onSelect: (id: string) => selected.push(id),
      readIdentities: async ({ sessionIds }: { sessionIds: string[] }) => {
        reads.push(sessionIds)
        return rows
          .filter((row) => sessionIds.includes(row.sessionId))
          .map((row) => ({
            conversation: row.sessionId,
            address: row.named?.label ?? row.sessionId,
            title: row.named?.title ?? 'BroBot',
            author: null,
          }))
      },
    },
    { width: 280, height: 1250 },
  )
  await expect.poll(() => m.all('conversations-loading').length).toBe(0)
  return { ...m, selected, reads }
}

it('shows every BroBot above newer helpers, keeping other attention and recent rows disjoint', async () => {
  const people = Array.from({ length: 23 }, (_, index) => person(index + 1, index === 2))
  const helpers = workerRows(35).map((row, index) => ({
    ...row,
    profileId: 'brobot',
    personStarted: false,
    updatedAt: NOW + 100000 + index,
    state: { is: index === 0 ? 'needs-you' : 'idle' } as const,
  }))
  const otherPerson = { ...person(90), profileId: 'reviewer' }
  const unknown = { ...person(91), personStarted: undefined }
  const m = await draw([...helpers, ...people.reverse(), otherPerson, unknown], 'person-23')
  expect(
    [...m.host.querySelectorAll('[data-cy^="rail-section-"]')].map((el) =>
      el.getAttribute('data-cy'),
    ),
  ).toEqual(['rail-section-brobot', 'rail-section-needs-you', 'rail-section-recent'])
  expect(ids(m, 'brobot')).toEqual(Array.from({ length: 23 }, (_, i) => `person-${i + 1}`))
  expect(m.q('rail-count-brobot').textContent).toBe('23')
  expect(ids(m, 'needs-you')).toEqual(['recipe-1'])
  expect(ids(m, 'recent')).toHaveLength(15)
  expect(m.q('rail-other-conversations').textContent?.trim()).toBe('Other conversations')
  const drawn = [...m.host.querySelectorAll<HTMLElement>('[data-session-id]')].map(
    (row) => row.dataset.sessionId,
  )
  expect(new Set(drawn).size).toBe(drawn.length)
  expect(m.reads.every((batch) => batch.length <= CONVERSATION_IDENTITY_BATCH_SIZE)).toBe(true)
  m.q('open-session-person-23').click()
  expect(m.selected).toEqual(['person-23'])
  m.q('rail-toggle-brobot').click()
  await nextTick()
  expect(m.q('rail-toggle-brobot').getAttribute('aria-expanded')).toBe('false')
  expect(m.q('rail-toggle-brobot').dataset.active).toBe('true')
  expect(localStorage.getItem('brobot2.railBroBotOpen')).toBe('false')
  expect(m.q('rail-count-brobot').textContent).toBe('23')
  expect(m.all('rail-rows-brobot')).toHaveLength(0)
  m.unmount()
  const again = await draw([...helpers, ...people])
  expect(again.q('rail-toggle-brobot').getAttribute('aria-expanded')).toBe('false')
})

it('renders the restored group with seven BroBots and many newer helpers', async () => {
  const numbers = [1, 4, 6, 7, 14, 15, 17]
  const people = numbers.map((number) => person(number))
  const titles = [
    'Tests',
    'Development',
    'Behaviour',
    'Look and layout',
    'Providers',
    'Settings',
    'Planning',
  ]
  people.forEach((row, index) => {
    row.named = { label: `W${numbers[index]}`, title: titles[index]! }
  })
  mount(IconSprite, {}, { width: 0, height: 0 })
  const helpers = workerRows(60).map((row, index) => ({
    ...row,
    state: { is: index === 0 ? 'needs-you' : 'active' } as const,
  }))
  const m = await draw([...helpers, ...people])
  await expect.poll(() => m.all('rail-address-person-17').length).toBe(1)
  expect(ids(m, 'brobot')).toEqual(numbers.map((number) => `person-${number}`))
  expect(m.q('rail-count-brobot').textContent).toBe('7')
  for (const number of numbers)
    expect(
      [...m.q(`open-session-person-${number}`).querySelector('.rail-copy')!.children].map(
        ({ tagName }) => tagName,
      ),
    ).toEqual(['STRONG', 'SMALL', 'SMALL'])
  await drawnReady()
  if (import.meta.env.VITE_RAIL_RESTORE_CAPTURE)
    await page.screenshot({ element: m.host, path: '__screenshots__/brobot-restore-143.png' })
})
