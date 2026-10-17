import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import { providerConditions, type ProviderLimitSeen } from '../../src/shared/provider-limit'
import type {
  ModelList,
  ProviderUsageReading,
  ProvidersChangedMessage,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'
import { usageCards } from './usage-cards'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const queue = usePersonsQueue()
type Usage = Record<'claude' | 'codex', ProviderUsageReading[]>
let current: Usage
let notify: ((message: ProvidersChangedMessage) => void) | undefined

const text = (node: Element): string => (node.textContent ?? '').replace(/\s+/g, ' ').trim()
async function settled(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}

function readings(now: number, kept: boolean): Usage {
  const at = now - 4 * MIN - 10_000
  const one = (window: string, resetsAt: number): ProviderUsageReading => ({
    window,
    usedPercent: 82,
    resetsAt,
    at,
    ...(kept ? { unconfirmed: true } : {}),
  })
  return {
    claude: [one('five_hour', now + 4 * HOUR), one('seven_day', now + 6 * DAY)],
    codex: [one('a 5-hour window', now + 4 * HOUR), one('a 7-day window', now + 6 * DAY)],
  }
}

function bridge(usage: Usage): void {
  current = usage
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      providerUsage: async () => current,
      onProvidersChanged: (listener: (message: ProvidersChangedMessage) => void) => {
        notify = listener
        return () => {
          notify = undefined
        }
      },
      checkProviderAuth: async () => ({ state: 'absent', reason: 'Not signed in' }),
      apiKeyStatus: async () => ({ set: false, inUse: false, changedAt: null }),
    },
  }
}

function walls(now: number, confirmed: boolean): ProviderLimitSeen[] {
  return confirmed
    ? [
        {
          provider: 'claude',
          window: 'seven_day',
          standing: 'about-to-stop',
          resetsAt: now + 6 * DAY,
          at: now,
          said: 'claude is approaching its rate limit (seven_day) — 82% used, by its latest reading',
        },
      ]
    : []
}

function supplyWalls(now: number, confirmed: boolean): void {
  queue.supply(
    null,
    null,
    {
      held: new Set(),
      answerable: new Map(),
      answeredFromHere: new Set(),
      now,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel: () => {},
      settle: () => {},
      takeOver: () => {},
      open: () => {},
    },
    {
      walked: {
        rows: walls(now, confirmed),
        walk: 'every-provider-wall-recently-recorded',
        ledgers: 1,
        rowsUnread: 0,
      },
      lastLookAnswered: true,
    },
  )
}

async function shelf(usage: Usage, width = 1100): Promise<Mounted> {
  bridge(usage)
  const m = await usageCards(width, 200)
  await settled()
  return m
}

async function provider(now: number, usage: Usage, confirmed = false): Promise<Mounted> {
  bridge(usage)
  const catalogue: ModelList = {
    provider: 'claude',
    notAsked: null,
    standIn: null,
    models: [],
    lastPicked: null,
    startsOn: null,
  }
  const lists = createModelLists(() => ({
    modelList: async () => catalogue,
    addHandAddedModel: async () => [],
    deleteHandAddedModel: async () => [],
  }))
  const m = mount(
    ProviderCard,
    {
      provider: 'claude',
      capabilities: null,
      limit: providerConditions(walls(now, confirmed), now)[0] ?? null,
      limitsRead: true,
      clock: now,
      version: null,
      readings: usage.claude,
      resources: null,
      resourcesPaused: false,
      resourcesError: null,
      loginMoved: 0,
      lists,
    },
    { width: 720, height: 1200 },
  )
  await settled()
  return m
}

async function waiting(now: number, usage: Usage, confirmed = false): Promise<Mounted> {
  await shelf(usage)
  supplyWalls(now, confirmed)
  const m = mount(WaitingOnYou, { clock: now }, { width: 1040, height: 900 })
  await settled()
  return m
}

afterEach(() => {
  unmountAll()
  queue.forget()
  delete (window as { api?: unknown }).api
})

describe('a kept usage reading is not yet confirmed', () => {
  it('marks all four top-bar readings with their age and a focusable honest name', async () => {
    const m = await shelf(readings(Date.now(), true), 720)
    expect(m.all('shelf-usage-age')).toHaveLength(4)
    for (const age of m.all('shelf-usage-age')) {
      expect(text(age)).toBe('read 4m ago')
      const cell = age.closest<HTMLElement>('.fact')!
      expect(cell.title).toContain('Not yet confirmed')
      expect(cell.getAttribute('aria-label')).toContain('Not yet confirmed')
      expect(cell.getAttribute('aria-label')!.match(/Not yet confirmed/g)).toHaveLength(1)
      expect(cell.querySelector('.fact-value')?.textContent).toContain('82%')
      expect(cell.querySelector('.fact-value')?.textContent).toContain('Not yet confirmed')
      const value = cell.querySelector<HTMLElement>('.fact-value')!
      const node = value.firstChild!
      const start = node.textContent!.indexOf('Not yet confirmed')
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + 'Not yet confirmed'.length)
      const bounds = cell.getBoundingClientRect()
      const rects = [...range.getClientRects()]
      expect(rects.length).toBeGreaterThan(0)
      for (const rect of rects) {
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left)
        expect(rect.right).toBeLessThanOrEqual(bounds.right)
        expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom)
      }
      expect(cell.tabIndex).toBe(0)
      expect(cell.querySelector('.warn, .ahead')).toBeNull()
    }
  })

  it('keeps the confirmed top-bar words and removes the mark on a usage notice', async () => {
    const now = Date.now()
    const m = await shelf(readings(now, true))
    current = readings(now, false)
    notify!({ what: 'usage', provider: 'claude' })
    await settled()
    for (const age of m.all('shelf-usage-age')) expect(text(age)).toBe('read 4m ago')
    expect(text(m.host)).not.toContain('Not yet confirmed')
    expect(m.q('shelf-usage-claude-week').title).not.toContain('Not yet confirmed')
  })

  it('shows Not read yet when another sign-in drops the kept top-bar readings', async () => {
    const m = await shelf(readings(Date.now(), true))
    current = { claude: [], codex: [] }
    notify!({ what: 'usage', provider: 'claude' })
    await settled()
    expect(m.all('shelf-missing')).toHaveLength(3)
    for (const missing of m.all('shelf-missing')) expect(text(missing)).toBe('Not read yet')
    expect(m.all('shelf-usage-age')).toHaveLength(0)
    expect(text(m.host)).not.toContain('Not yet confirmed')
  })

  it('shows kept Providers readings with age and neutral bars despite usage ahead of time', async () => {
    const now = Date.now()
    const m = await provider(now, readings(now, true))
    expect(m.all('provider-usage-unconfirmed')).toHaveLength(2)
    for (const note of m.all('provider-usage-unconfirmed'))
      expect(text(note)).toBe('Not yet confirmed · read 4m ago')
    expect(m.all('provider-usage-time')).toHaveLength(2)
    expect(m.all('provider-usage-ahead')).toHaveLength(0)
    for (const box of m.host.querySelectorAll('.usage-window')) {
      const bar = box.querySelector<HTMLMeterElement>('meter')!
      expect(bar.value).toBe(82)
      expect(bar.classList.contains('historical')).toBe(true)
      expect(bar.classList.contains('ahead')).toBe(false)
      expect(bar.getAttribute('aria-label')).toContain('82% used')
      expect(bar.getAttribute('aria-label')).toContain('Not yet confirmed · read 4m ago')
    }
    for (const bar of m.all('provider-usage-time'))
      expect(bar.getAttribute('aria-label')).toBe(
        'Time gone in this window · Not yet confirmed · read 4m ago',
      )
    expect(m.q('provider-usage-says').classList.contains('warn')).toBe(false)
    expect(text(m.q('provider-usage'))).not.toContain('is near')
  })

  it('keeps confirmed Providers warning, pace and meter behavior', async () => {
    const now = Date.now()
    const m = await provider(now, readings(now, false), true)
    expect(m.all('provider-usage-unconfirmed')).toHaveLength(0)
    expect(m.all('provider-usage-ahead')).toHaveLength(2)
    expect(m.q('provider-usage-says').classList.contains('warn')).toBe(true)
    expect(text(m.q('provider-usage-says'))).toContain('Claude is near its weekly limit (82% used)')
    for (const bar of m.host.querySelectorAll('.usage-window > meter:first-of-type')) {
      expect(bar.classList.contains('ahead')).toBe(true)
      expect(bar.classList.contains('historical')).toBe(false)
      expect(bar.getAttribute('aria-label')).not.toContain('Not yet confirmed')
    }
    for (const bar of m.all('provider-usage-time'))
      expect(bar.getAttribute('aria-label')).toBe('Time gone in this window')
  })

  it('keeps the Providers empty state for readings dropped on another sign-in', async () => {
    const m = await provider(Date.now(), { claude: [], codex: [] })
    expect(text(m.q('provider-usage-none'))).toBe(
      'No reading yet. Claude sends one with its next turn.',
    )
    expect(m.all('provider-usage-unconfirmed')).toHaveLength(0)
    expect(m.all('provider-usage-ahead')).toHaveLength(0)
  })

  it('draws no Waiting usage line or obligation for a kept unconfirmed reading', async () => {
    const now = Date.now()
    const m = await waiting(now, readings(now, true))
    expect(m.all('persons-queue-walls')).toHaveLength(0)
    expect(text(m.host)).not.toMatch(/Not yet confirmed|82%|is near|Usage ahead of time/)
    expect(queue.corner.value?.count ?? 0).toBe(0)
  })

  it('keeps the confirmed Waiting usage warning unchanged and removes the kept word', async () => {
    const now = Date.now()
    const m = await waiting(now, readings(now, false), true)
    expect(text(m.q('persons-queue-wall-says-claude'))).toContain(
      'Claude is near its weekly limit (82% used)',
    )
    expect(m.q('persons-queue-wall-claude').dataset['standing']).toBe('about-to-stop')
    expect(text(m.host)).not.toContain('Not yet confirmed')
  })

  it('keeps Waiting empty for readings dropped by another sign-in', async () => {
    const now = Date.now()
    const m = await waiting(now, readings(now, true))
    current = { claude: [], codex: [] }
    notify!({ what: 'usage', provider: 'claude' })
    await settled()
    expect(m.all('persons-queue-walls')).toHaveLength(0)
    expect(text(m.host)).not.toContain('Not yet confirmed')
  })

  it('shows a newly confirmed Claude warning while the Codex readings remain kept', async () => {
    const now = Date.now()
    const m = await waiting(now, readings(now, true))
    current = { claude: readings(now, false).claude, codex: readings(now, true).codex }
    supplyWalls(now, true)
    notify!({ what: 'usage', provider: 'claude' })
    await settled()
    expect(text(m.q('persons-queue-wall-says-claude'))).toContain(
      'Claude is near its weekly limit (82% used)',
    )
    expect(m.all('persons-queue-wall-codex')).toHaveLength(0)
    expect(text(m.host)).not.toContain('Not yet confirmed')
    const shelfHost = document.querySelector('[data-cy="app-usage-cards"]')!
    const ages = [...shelfHost.querySelectorAll('[data-cy="shelf-usage-age"]')].map(text)
    expect(ages).toEqual(['read 4m ago', 'read 4m ago', 'read 4m ago', 'read 4m ago'])
    for (const provider of ['claude', 'codex']) {
      for (const window of ['5h', 'week']) {
        const cell = shelfHost.querySelector(`[data-cy="shelf-usage-${provider}-${window}"]`)!
        expect(text(cell).includes('Not yet confirmed')).toBe(provider === 'codex')
      }
    }
  })
})
