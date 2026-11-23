import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import { PROVIDER_DESCRIPTORS, providerDescriptor } from '@brobot2/shared'
import { applyTheme } from '../../src/renderer/src/lib/apply-theme'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import CREW_NIGHT from '../../resources/themes/crew-night/theme.json'
import { shippedDefined } from '../themes/fixtures'
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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  applyTheme(resolveTheme(CREW_NIGHT as Theme, shippedDefined()))
})
afterEach(() => {
  unmountAll()
  applyTheme(null)
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
  rosterMode: 'full' | 'absent' | 'partial' = 'full',
  pending?: Promise<readonly ConversationIdentity[]>,
) {
  const selected: string[] = []
  const reads: string[][] = []
  const roster = identities(rows.length)
  const agents =
    rosterMode === 'absent'
      ? undefined
      : rosterMode === 'partial'
        ? { ...roster, identities: [] }
        : roster
  vi.stubGlobal('api', {
    runtime: {
      providerCatalogue: async () => PROVIDER_DESCRIPTORS,
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
      agents,
      onSelect: (id: string) => selected.push(id),
      readIdentities: async ({ sessionIds }: { sessionIds: string[] }) => {
        reads.push(sessionIds)
        if (pending) return pending
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
                  ...(!row.named?.title?.trim() ? { profileFallback: true } : {}),
                },
          )
      },
    },
    { width: 280, height: 1250 },
  )
  await expect.poll(() => m.all('conversations-loading').length).toBe(0)
  m.host.style.width = '252px'
  m.q('side-rail').style.cssText += '; width:100%; min-width:0; flex:1 1 0'
  // Model W1's measured row budget; the Electron check verifies the real enclosing layout.
  const scroll = m.host.querySelector<HTMLElement>('.rail-scroll')!
  scroll.style.paddingRight = '23px'
  await drawnReady()
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
    expect(row.querySelector(`#rail-state-person-${number}`)?.textContent).toContain('Claude')
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
    const other = m.q('open-session-person-90')
    expect(other.querySelector('strong')!.getBoundingClientRect().height).toBeCloseTo(
      other.querySelector('small')!.getBoundingClientRect().height,
      1,
    )
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

/** The first `text.length` characters of the line, across the text nodes they are drawn in. */
function prefixRange(line: HTMLElement, text: string): Range {
  expect(line.textContent?.startsWith(text)).toBe(true)
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let left = text.length
  let first = true
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (first) {
      range.setStart(node, 0)
      first = false
    }
    if (node.length >= left) {
      range.setEnd(node, left)
      return range
    }
    left -= node.length
  }
  throw new Error(`the line does not hold "${text}"`)
}

function visiblePrefix(line: HTMLElement, text: string): void {
  const range = prefixRange(line, text)
  expect(range.getBoundingClientRect().right).toBeLessThanOrEqual(
    line.getBoundingClientRect().right + 1,
  )
}

for (const provider of ['claude', 'codex'] as const) {
  it(`uses the 0.2.32 inline ${provider} status at the real 158px status width`, async () => {
    const name = providerDescriptor(provider).displayName
    const row = person(21)
    row.provider = provider
    row.named = { label: 'W21', title: null }
    const m = await draw([row])
    const card = m.q('open-session-person-21')
    const line = card.querySelector<HTMLElement>('.rail-brobot-standing')!
    expect(m.q('side-rail').getBoundingClientRect().width).toBe(252)
    expect(card.getBoundingClientRect().width).toBe(216)
    expect(line.getBoundingClientRect().width).toBe(158)
    await expect.poll(() => line.textContent).toBe(`${name} · idle · bakery`)
    expect(line.title).toBe(`${name} · idle · bakery`)
    // The status is one run of inline text, so the line's one ellipsis covers all of it.
    expect([...line.children].map((part) => getComputedStyle(part).display)).toEqual([
      'inline',
      'inline',
      'inline',
    ])
    expect(card.querySelector('time')).toBeNull()
    expect(getComputedStyle(line).display).toBe('block')
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
    visiblePrefix(line, `${name} · idle`)
    expect(card.getBoundingClientRect().height).toBeLessThanOrEqual(49)
  })
}

for (const width of [252, 266.2]) {
  it(`keeps the provider and helper name visible beside long states at ${width}px`, async () => {
    const long = 'Lars (the owner of W9.1 · Prepare the full launch list)'
    const row = person(4)
    row.state = { is: 'waiting-on-an-answer', from: long }
    const helper = {
      ...workerRows(1)[0]!,
      state: { is: 'waiting-on-an-answer' as const, from: long },
    }
    const idleHelper = { ...workerRows(2)[1]!, state: { is: 'idle' as const } }
    const m = await draw([row, helper, idleHelper])
    m.host.style.width = `${width}px`
    await expect.poll(() => m.all('rail-profile-recipe-1').length).toBe(1)
    const line = m.q('open-session-person-4').querySelector<HTMLElement>('.rail-brobot-standing')!
    await expect
      .poll(() => line.textContent)
      .toBe(`Claude · waiting on an answer from ${long} · bakery`)
    visiblePrefix(line, 'Claude')
    expect(line.title).toContain(long)
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth)
    const label = m.q('rail-profile-recipe-1')
    const state = m.q('rail-state-word-recipe-1')
    const standing = label.closest('small')!
    expect(label.textContent).toBe('Mira')
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
    const idleLabel = m.q('rail-profile-recipe-2')
    expect(idleLabel.textContent).toBe('Mira')
    expect(idleLabel.scrollWidth).toBeLessThanOrEqual(idleLabel.clientWidth + 1)
    expect(label.clientWidth).toBeGreaterThan(20)
    expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(
      standing.getBoundingClientRect().right,
    )
    expect(state.clientWidth).toBeGreaterThan(8)
    expect(state.scrollWidth).toBeGreaterThan(state.clientWidth)
    expect(getComputedStyle(state).textOverflow).toBe('ellipsis')
    expect(standing.title).toContain(long)
    m.q('open-session-recipe-1').click()
    expect(m.selected).toEqual(['recipe-1'])
  })
}

for (const rosterMode of ['absent', 'partial'] as const) {
  it(`keeps the listing profile fallback when the worker roster is ${rosterMode}`, async () => {
    const row = workerRows(1)[0]!
    const m = await draw([row], null, undefined, rosterMode)
    await expect.poll(() => m.all(`rail-profile-${row.sessionId}`).length).toBe(1)
    const label = m.q(`rail-profile-${row.sessionId}`)
    expect(label.textContent).toBe('recipe-worker · W90.1')
    expect(label.title).toBe('recipe-worker · W90.1')
    expect(label.textContent).not.toContain(row.worker!.identity)
    expect(m.q('rail-address-recipe-1').textContent).toBe('W90.1')
  })
}

for (const width of [251.68, 266.2]) {
  it(`uses a canonical opening without confusing a real profile-named title at ${width}px`, async () => {
    for (const title of ['Plan a garden with a shaded path '.repeat(8), 'BroBot']) {
      const row = person(21)
      row.named = { label: 'W21', title: null }
      const m = await draw([row], null, {
        conversation: row.sessionId,
        address: 'W21',
        title,
        author: null,
      })
      m.host.style.width = `${width}px`
      await expect
        .poll(() => m.q('rail-brobot-title-person-21').textContent?.trim())
        .toBe(`W21 · ${title.trim()}`)
      const strong = m.q('rail-brobot-title-person-21')
      expect(strong.title).toBe(`W21 · ${title.trim()}`)
      expect([...strong.parentElement!.children].map((one) => one.tagName)).toEqual([
        'STRONG',
        'SMALL',
      ])
      expect(m.q('open-session-person-21').getAttribute('aria-describedby')).toBe(
        'rail-state-person-21',
      )
      expect(m.all('session-opening-person-21')).toHaveLength(0)
      m.q('open-session-person-21').click()
      expect(m.selected).toEqual(['person-21'])
      m.unmount()
    }
  })
}

for (const width of [251.68, 266.2]) {
  it(`keeps a task label out of the pending BroBot address at ${width}px`, async () => {
    const row = person(21)
    const listingTitle = 'Listing title '.repeat(12).trim()
    row.named = { label: 'W99.4', title: listingTitle }
    let finish!: (identities: readonly ConversationIdentity[]) => void
    const pending = new Promise<readonly ConversationIdentity[]>((resolve) => {
      finish = resolve
    })
    const m = await draw([row], null, undefined, 'full', pending)
    m.host.style.width = `${width}px`
    const title = m.q('rail-brobot-title-person-21')
    expect(title.textContent?.trim()).toBe(`person-21 · ${listingTitle}`)
    expect(title.title).toBe(`person-21 · ${listingTitle}`)
    expect(title.textContent).not.toContain('W99.4')
    expect(getComputedStyle(title).whiteSpace).toBe('nowrap')
    expect(title.getBoundingClientRect().height).toBeCloseTo(
      parseFloat(getComputedStyle(title).lineHeight),
      1,
    )
    finish([
      { conversation: row.sessionId, address: 'W21', title: 'Canonical opening', author: null },
    ])
    await expect.poll(() => title.textContent?.trim()).toBe('W21 · Canonical opening')
    expect(title.title).toBe('W21 · Canonical opening')
    expect([...title.parentElement!.children].map((one) => one.tagName)).toEqual([
      'STRONG',
      'SMALL',
    ])
    m.q('open-session-person-21').click()
    expect(m.selected).toEqual(['person-21'])
  })
}
