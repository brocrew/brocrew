import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { ResumableSessionInfo } from '../../src/shared/runtime-ipc'
import {
  CONVERSATION_IDENTITY_BATCH_SIZE,
  type ConversationIdentity,
} from '../../src/shared/conversation-title'
import { mount, unmountAll } from './harness'
import { memoryStorage } from './memory-storage'
import { workerRows, identities, NOW } from './parallel-workers-fixture'
import { drawnReady } from './drawn'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'

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
    provider: 'claude',
    personStarted: true,
    worker: undefined,
    state: { is: waiting ? 'needs-you' : 'idle' },
    named: { label: `W${number}`, title: `Conversation ${number}` },
    updatedAt: Date.now() - number * 3600000,
  }
}

async function draw(
  rows: ResumableSessionInfo[],
  activeId: string | null = null,
  renamed?: ConversationIdentity,
) {
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
          .map((row) =>
            renamed?.conversation === row.sessionId
              ? renamed
              : {
                  conversation: row.sessionId,
                  address: row.named?.label ?? row.sessionId,
                  title: row.named?.title?.trim() || 'BroBot',
                  author: null,
                },
          )
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
    'TESTS ITSELF',
    'DEVELOPS ITSELF',
    'Behaviour',
    'Look and layout',
    'Providers',
    'Settings',
    null,
  ]
  people.forEach((row, index) => {
    row.named = { label: `W${numbers[index]}`, title: titles[index] ?? null }
  })
  people[1]!.state = {
    is: 'waiting-on-an-answer',
    from: 'Lars (the owner of W9.1 · Prepare the full launch list)',
  }
  mount(IconSprite, {}, { width: 0, height: 0 })
  const helpers = workerRows(60).map((row, index) => ({
    ...row,
    state: { is: index === 0 ? 'needs-you' : 'active' } as const,
  }))
  const m = await draw([...helpers, ...people])
  await expect.poll(() => m.all('rail-brobot-title-person-17').length).toBe(1)
  expect(ids(m, 'brobot')).toEqual(numbers.map((number) => `person-${number}`))
  expect(m.q('rail-count-brobot').textContent).toBe('7')
  for (const number of numbers)
    expect(
      [...m.q(`open-session-person-${number}`).querySelector('.rail-copy')!.children].map(
        ({ tagName }) => tagName,
      ),
    ).toEqual(['STRONG', 'SMALL'])
  for (const [index, number] of numbers.entries()) {
    const title = m.q(`rail-brobot-title-person-${number}`)
    const expected = titles[index] ? `W${number} · ${titles[index]}` : `W${number}`
    expect(title.textContent?.trim()).toBe(expected)
    expect(title.title).toBe(expected)
    const row = m.q(`open-session-person-${number}`)
    const style = getComputedStyle(title)
    expect(style.whiteSpace).toBe('nowrap')
    expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(49)
    expect(row.getAttribute('aria-describedby')).toBe(`rail-state-person-${number}`)
    expect(row.querySelector(`#rail-state-person-${number}`)?.textContent).toContain('claude')
  }
  await drawnReady()
  if (import.meta.env.VITE_RAIL_RESTORE_CAPTURE)
    await page.screenshot({ element: m.host, path: import.meta.env.VITE_RAIL_RESTORE_CAPTURE })
})

for (const width of [251.68, 266.2]) {
  it(`keeps untitled and renamed BroBots compact at ${width}px without changing other rows`, async () => {
    const untitled = person(21)
    untitled.named = { label: 'W21', title: '' }
    const named = person(4)
    named.named = { label: 'W4', title: 'DEVELOPS ITSELF' }
    const m = await draw([untitled, named, { ...person(90), profileId: 'reviewer' }], null, {
      conversation: named.sessionId,
      address: 'W44',
      title: 'Saved conversation name',
      author: { kind: 'person' },
    })
    m.host.style.width = `${width}px`
    await expect.poll(() => m.all('rail-address-person-90').length).toBe(1)
    expect(m.q('rail-brobot-title-person-21').textContent?.trim()).toBe('W21')
    expect(m.q('rail-brobot-title-person-4').textContent?.trim()).toBe(
      'W44 · Saved conversation name',
    )
    for (const number of [21, 4]) {
      const row = m.q(`open-session-person-${number}`)
      expect([...row.querySelector('.rail-copy')!.children].map((el) => el.tagName)).toEqual([
        'STRONG',
        'SMALL',
      ])
      const title = row.querySelector('strong')!
      expect(title.getBoundingClientRect().height).toBeCloseTo(
        parseFloat(getComputedStyle(title).lineHeight),
        1,
      )
      expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(49)
      row.click()
    }
    expect(
      [...m.q('open-session-person-90').querySelector('.rail-copy')!.children].map(
        (el) => el.tagName,
      ),
    ).toEqual(['STRONG', 'SMALL', 'SMALL'])
    expect(m.selected).toEqual(['person-21', 'person-4'])
  })
}

it('uses an authored conversation title before its root title', async () => {
  const m = await draw([person(4)], null, {
    conversation: 'person-4',
    address: 'W4',
    title: 'Saved conversation name',
    author: { kind: 'person' },
  })
  await expect
    .poll(() => m.q('rail-brobot-title-person-4').textContent?.trim())
    .toBe('W4 · Saved conversation name')
  expect(m.q('rail-brobot-title-person-4').title).toBe('W4 · Saved conversation name')
})

for (const width of [251.68, 266.2]) {
  it(`keeps the BroBot name and provider whole while a long state ellipsizes at ${width}px`, async () => {
    const row = person(4)
    row.state = {
      is: 'waiting-on-an-answer',
      from: 'Lars (the owner of W9.1 · Prepare the full launch list)',
    }
    const m = await draw([row])
    m.host.style.width = `${width}px`
    await expect.poll(() => m.q('rail-brobot-title-person-4').textContent).toContain('W4')
    const card = m.q('open-session-person-4')
    const label = card.querySelector<HTMLElement>('.rail-standing-profile')!
    const state = m.q('rail-state-word-person-4')
    const line = card.querySelector<HTMLElement>('.rail-brobot-standing')!
    expect(label.textContent?.trim()).toBe('BroBot · claude ·')
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
    expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(
      line.getBoundingClientRect().right,
    )
    expect(state.clientWidth).toBeGreaterThan(8)
    expect(state.scrollWidth).toBeGreaterThan(state.clientWidth)
    expect(getComputedStyle(state).textOverflow).toBe('ellipsis')
    expect(getComputedStyle(state).overflowX).toBe('hidden')
    expect(state.title).toBe(
      'waiting on an answer from Lars (the owner of W9.1 · Prepare the full launch list)',
    )
    expect(card.getBoundingClientRect().height).toBeLessThanOrEqual(49)
  })
}
