import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { fullTime } from '../../src/renderer/src/lib/clock'
import type { ProvidersChangedMessage, ProviderUsageReading } from '../../src/shared/runtime-ipc'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { conv, forestOf } from './forest-fixture'
import { unmountAll, type Mounted } from './harness'
import { usageCards } from './usage-cards'
import { drawnReady } from './drawn'

/**
 * The title bar's usage cards say each provider's usage, one cell per window: the provider and
 * window with the reading's age, then how much is used and when it resets. The exact reset is on
 * the cell's title and in its accessible name, and the cell takes focus, so a keyboard reaches it.
 */

afterEach(() => {
  unmountAll()
  delete (window as { api?: unknown }).api
  const cast = useWhoCalledWhom()
  cast.runningConversations.value = null
  cast.forest.value = null
  cast.processMemory.value = new Map()
  cast.memoryUnmeasured.value = null
})

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Usage = Record<'claude' | 'codex', ProviderUsageReading[]>

/** What the bridge answers, and the notice listener the shelf left with it. */
let current: Usage = { claude: [], codex: [] }
let told: ((message: ProvidersChangedMessage) => void) | null = null

/** The usage cards, opened from the title bar, reading these readings. */
async function shelf(usage: Usage, width = 900): Promise<Mounted> {
  current = usage
  ;(window as { api?: unknown }).api = {
    runtime: {
      providerUsage: () => Promise.resolve(current),
      onProvidersChanged: (listener: (message: ProvidersChangedMessage) => void) => {
        told = listener
        return () => (told = null)
      },
    },
  }
  const m = await usageCards(width, 160)
  await settled()
  return m
}

async function settled(): Promise<void> {
  await new Promise((done) => setTimeout(done, 0))
  await nextTick()
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()))

/**
 * Read the strip after its font has loaded and both dimensions stay unchanged for at least 150 ms.
 * Width changes can wrap a cell even when an intervening height returns to the earlier value.
 */
async function steadyHeight(el: Element): Promise<number> {
  await drawnReady()
  let before = el.getBoundingClientRect()
  let steadySince = performance.now()
  const sizes: string[] = []
  for (let i = 0; i < 180; i += 1) {
    await frame()
    const now = el.getBoundingClientRect()
    sizes.push(`${now.width} × ${now.height}`)
    if (now.width !== before.width || now.height !== before.height) steadySince = performance.now()
    if (performance.now() - steadySince >= 150) return now.height
    before = now
  }
  throw new Error(`the strip size never settled; last reads ${sizes.slice(-6).join(', ')}`)
}

/** Readings for both providers' 5-hour and weekly windows, and two windows the strip leaves out. */
function both(now: number): Usage {
  const at = now - 4 * MIN - 10_000
  return {
    claude: [
      { window: 'five_hour', usedPercent: 28, resetsAt: now + 3 * HOUR + 12 * MIN + 20_000, at },
      { window: 'seven_day', usedPercent: 61, resetsAt: now + 2 * DAY + HOUR, at },
      { window: 'seven_day_opus', usedPercent: 3, resetsAt: now + 2 * DAY, at },
    ],
    codex: [
      { window: 'a 5-hour window', usedPercent: 12, resetsAt: now + HOUR + 14 * MIN + 20_000, at },
      { window: 'a 7-day window', usedPercent: 35, resetsAt: now + 4 * DAY, at },
      { window: 'a 7-day window (GPT-5.3-Codex-Spark)', usedPercent: 90, resetsAt: now + DAY, at },
    ],
  }
}

const CELLS = ['claude-5h', 'claude-week', 'codex-5h', 'codex-week'] as const

/** The usage cells, in order; the two totals after them are read on their own. */
function cells(m: Mounted): HTMLElement[] {
  return ([...m.q('shelf-settings').children] as HTMLElement[]).filter(
    (cell) =>
      cell.dataset['cy'] !== 'shelf-usage-agents' && cell.dataset['cy'] !== 'shelf-usage-memory',
  )
}

describe('the shelf says each provider’s usage', () => {
  it('🔴 four cells, both providers: window and age above, amount and relative reset below', async () => {
    const m = await shelf(both(Date.now()))
    expect(cells(m).map((cell) => cell.dataset['cy'])).toEqual(
      CELLS.map((key) => `shelf-usage-${key}`),
    )
    const said = (key: string): [string, string, string] => {
      const cell = m.q(`shelf-usage-${key}`)
      return [
        text(cell.querySelector('.usage-label > span')!),
        text(cell.querySelector('[data-cy="shelf-usage-age"]')!),
        text(cell.querySelector('[data-cy="shelf-usage-value"]')!),
      ]
    }
    expect(said('claude-5h')).toEqual(['Claude · 5h', 'read 4m ago', '28% · resets in 3 h 12 min'])
    expect(said('claude-week')).toEqual(['Claude · week', 'read 4m ago', '61% · resets in 2 days'])
    expect(said('codex-5h')).toEqual(['Codex · 5h', 'read 4m ago', '12% · resets in 1 h 14 min'])
    expect(said('codex-week')).toEqual(['Codex · week', 'read 4m ago', '35% · resets in 4 days'])
    // ⛔ A bucket the provider named and Claude's Opus week are not the strip's windows: four cells,
    // never more, and neither reading reached a cell.
    expect(text(m.q('shelf-settings'))).not.toContain('90%')
    expect(text(m.q('shelf-settings'))).not.toContain('3%')
    expect(m.all('shelf-missing')).toHaveLength(0)
  })

  it('waits through a delayed resize after an initially steady layout', async () => {
    await drawnReady()
    const box = document.createElement('div')
    box.style.cssText = 'width: 100px; height: 10px'
    document.body.append(box)
    let resize: number
    let frames = 0
    const later = (): void => {
      frames += 1
      if (frames === 5) box.style.height = '30px'
      else resize = requestAnimationFrame(later)
    }
    resize = requestAnimationFrame(later)
    try {
      expect(await steadyHeight(box)).toBe(30)
    } finally {
      cancelAnimationFrame(resize)
      box.remove()
    }
  })

  it('⛔ a further window does not grow the strip', async () => {
    const now = Date.now()
    const four = both(now)
    const plain: Usage = {
      claude: four.claude.slice(0, 2),
      codex: four.codex.slice(0, 2),
    }
    const a = await shelf(plain)
    const height = await steadyHeight(a.q('shelf-settings'))
    a.unmount()
    const b = await shelf(four)
    expect(cells(b)).toHaveLength(4)
    expect(await steadyHeight(b.q('shelf-settings'))).toBeCloseTo(height, 1)
  })

  it('🔴 an unread window stays unread, with no age and no title — and a read one beside it does not', async () => {
    const now = Date.now()
    const m = await shelf({ claude: both(now).claude, codex: [] })
    for (const [key, label] of [['codex-week', 'Codex · week']] as const) {
      const cell = m.q(`shelf-usage-${key}`)
      expect(text(cell.querySelector('.usage-label')!)).toBe(label)
      expect(text(cell.querySelector('[data-cy="shelf-missing"]')!)).toBe('Not read yet')
      expect(cell.querySelector('[data-cy="shelf-usage-age"]')).toBeNull()
      expect(cell.hasAttribute('title')).toBe(false)
      expect(cell.getAttribute('aria-label')).toMatch(/not read yet$/)
    }
    // ⚑ The control, in the same mount: Claude's cells are read.
    expect(m.q('shelf-usage-claude-5h').querySelector('[data-cy="shelf-missing"]')).toBeNull()
    expect(m.all('shelf-missing')).toHaveLength(1)
  })

  it('🔴 a provider that reported only its weekly window draws that one cell, and no 5-hour one', async () => {
    const now = Date.now()
    const weekly = both(now).codex.slice(1, 2)
    const m = await shelf({ claude: both(now).claude, codex: weekly })
    expect(m.all('shelf-usage-codex-5h')).toHaveLength(0)
    expect(text(m.q('shelf-usage-codex-week'))).toContain('Codex · week')
    expect(text(m.q('shelf-usage-codex-week'))).toContain('35%')
    expect(m.q('shelf-usage-codex-week').querySelector('[data-cy="shelf-missing"]')).toBeNull()
    expect(m.all('shelf-missing')).toHaveLength(0)
    expect(cells(m).map((cell) => cell.dataset['cy'])).toEqual([
      'shelf-usage-claude-5h',
      'shelf-usage-claude-week',
      'shelf-usage-codex-week',
    ])
    expect(
      cells(m)
        .map((cell) => cell.textContent)
        .join(' '),
    ).not.toContain('Not read yet')
  })

  it('🔴 Codex draws no 5-hour cell before a reading; Claude, with no reading yet, still says both are not read yet', async () => {
    const m = await shelf({ claude: [], codex: [] })
    expect(m.all('shelf-usage-codex-5h')).toHaveLength(0)
    expect(cells(m).map((cell) => cell.dataset['cy'])).toEqual([
      'shelf-usage-claude-5h',
      'shelf-usage-claude-week',
      'shelf-usage-codex-week',
    ])
    for (const key of ['claude-5h', 'claude-week', 'codex-week']) {
      expect(text(m.q(`shelf-usage-${key}`).querySelector('[data-cy="shelf-missing"]')!)).toBe(
        'Not read yet',
      )
    }
    expect(m.all('shelf-missing')).toHaveLength(3)
  })

  it('⚑ the control: a 5-hour reading from Codex is drawn, so a real reading is never lost', async () => {
    const m = await shelf(both(Date.now()))
    expect(text(m.q('shelf-usage-codex-5h'))).toContain('12%')
    expect(cells(m)).toHaveLength(4)
  })

  it('⚑ an amount or a reset the provider did not say is said as not said', async () => {
    const now = Date.now()
    const m = await shelf({
      claude: [
        { window: 'five_hour', usedPercent: null, resetsAt: now + 2 * HOUR + 20_000, at: now },
        { window: 'seven_day', usedPercent: 40, resetsAt: null, at: now },
      ],
      codex: [],
    })
    expect(text(m.q('shelf-usage-claude-5h').querySelector('[data-cy="shelf-usage-value"]')!)).toBe(
      'Amount not said · resets in 2 h',
    )
    expect(
      text(m.q('shelf-usage-claude-week').querySelector('[data-cy="shelf-usage-value"]')!),
    ).toBe('40% · reset time not said')
  })

  it('🔴 a reset already past is said in the past, never as the window now', async () => {
    const now = Date.now()
    const m = await shelf({
      claude: [
        { window: 'five_hour', usedPercent: 95, resetsAt: now - 2 * HOUR, at: now - 3 * HOUR },
      ],
      codex: [],
    })
    const cell = m.q('shelf-usage-claude-5h')
    expect(text(cell.querySelector('[data-cy="shelf-usage-value"]')!)).toBe(
      'was 95% · reset 2 h ago',
    )
    expect(cell.title).toContain(`Reset ${fullTime(now - 2 * HOUR)}`)
    // ⚑ The control: one ahead is "resets in".
    expect(cell.title).not.toContain('Resets ')
  })

  it('🔴 the exact reset is on hover and in the name a keyboard reaches', async () => {
    const now = Date.now()
    const usage = both(now)
    const m = await shelf(usage)
    const cell = m.q('shelf-usage-claude-5h')
    const exact = fullTime(usage.claude[0]!.resetsAt!)
    expect(exact).not.toBe('')
    // Hover: the title carries the exact moment and when the reading came.
    expect(cell.title).toBe(`Resets ${exact}\nRead ${fullTime(usage.claude[0]!.at)}`)
    // Keyboard: the cell takes focus, and its accessible name is the whole of what it says.
    expect(cell.tabIndex).toBe(0)
    cell.focus()
    expect(document.activeElement).toBe(cell)
    const name = cell.getAttribute('aria-label')!
    expect(name).toContain('Claude 5-hour limit: 28% · resets in 3 h 12 min.')
    expect(name).toContain(exact)
    // ⛔ The control: the visible words do not carry the exact moment, so the name adds it.
    expect(text(cell)).not.toContain(exact)
  })

  it('🔴 every value line is one weight, read or not', async () => {
    const now = Date.now()
    const m = await shelf({ claude: [], codex: both(now).codex.slice(0, 2) })
    const values = cells(m).map((cell) => cell.querySelector('.fact-value') as HTMLElement)
    expect(values).toHaveLength(4)
    // Codex's 5-hour cell is drawn here because a reading for it arrived.
    // The mix: Claude's two cells unread, Codex's read.
    expect(values.filter((el) => el.dataset['cy'] === 'shelf-missing')).toHaveLength(2)
    const weights = values.map((el) => getComputedStyle(el).fontWeight)
    expect(new Set(weights).size, `weights ${weights.join(', ')}`).toBe(1)
    // ⚑ The control: the reading can tell weights apart — the line that opens the cards is heavier.
    expect(getComputedStyle(m.q('app-usage')).fontWeight).not.toBe(weights[0])
  })

  it('⚑ a usage notice reads the readings again; nothing polls', async () => {
    const now = Date.now()
    const m = await shelf({ claude: [], codex: [] })
    expect(m.all('shelf-missing')).toHaveLength(3)
    current = both(now)
    // ⛔ The control: nothing moves without a notice.
    await new Promise((done) => setTimeout(done, 50))
    expect(m.all('shelf-missing')).toHaveLength(3)
    told!({ what: 'usage', provider: 'claude' })
    await settled()
    expect(m.all('shelf-missing')).toHaveLength(0)
  })
})

describe('the agents running now, and the memory they hold', () => {
  const MB = 1024 ** 2
  let m: Mounted
  const value = (key: string): string =>
    text(m.q(`shelf-usage-${key}`).querySelector('[data-cy="shelf-usage-value"]')!)
  const FOREST = forestOf([
    conv('sess_a', null, { running: 'in-a-window' }),
    conv('sess_b', 'sess_a', { running: 'unwatched' }),
    conv('sess_c', 'sess_a', { running: 'unwatched', provider: 'codex' }),
    conv('sess_d', 'sess_a', { running: 'not-running', provider: 'codex' }),
  ])

  it('🔴 how many agents run, by provider, and the memory their processes hold', async () => {
    const cast = useWhoCalledWhom()
    cast.forest.value = FOREST
    cast.runningConversations.value = [
      { sessionId: 'sess_a', provider: 'claude', state: { is: 'idle' } },
      { sessionId: 'sess_b', provider: 'claude', state: { is: 'active' } },
      {
        sessionId: 'sess_c',
        provider: 'codex',
        state: { is: 'in-the-background', what: 'read the menu' },
      },
    ]
    cast.processMemory.value = new Map([
      ['sess_a', 300 * MB],
      ['sess_b', 200 * MB],
      ['sess_c', 100 * MB],
      // A figure for a conversation the forest says is not running is not added in.
      ['sess_d', 900 * MB],
    ])
    m = await shelf(both(Date.now()))
    expect(value('agents')).toBe('Claude 2 (1 working) Codex 1 (1 working)')
    expect(value('memory')).toBe('600 MB')
    expect(m.q('shelf-usage-agents').getAttribute('aria-label')).toBe(
      'Agents running: Claude 2 (1 working)\nCodex 1 (1 working)',
    )
    // The usage cells come first, and are unchanged.
    expect(cells(m)).toHaveLength(4)
  })

  it('🔴 where main could not measure memory, the block says so as the agent cards do', async () => {
    const said = 'BroBot can’t measure its agents’ memory and CPU on Windows yet.'
    const cast = useWhoCalledWhom()
    cast.forest.value = FOREST
    cast.runningConversations.value = [
      { sessionId: 'sess_a', provider: 'claude', state: { is: 'idle' } },
      { sessionId: 'sess_b', provider: 'claude', state: { is: 'active' } },
      { sessionId: 'sess_c', provider: 'codex', state: { is: 'idle' } },
    ]
    cast.memoryUnmeasured.value = said
    m = await shelf(both(Date.now()))
    // The count does not need the memory reading.
    expect(value('agents')).toBe('Claude 2 (1 working) Codex 1 (none working)')
    expect(value('memory')).toBe('not measured')
    expect(m.q('shelf-usage-memory').title).toBe(said)
    expect(m.q('shelf-usage-memory').getAttribute('aria-label')).toBe(`Their memory: ${said}`)
  })

  it('⚑ the control: before the forest is read, both blocks say not read yet', async () => {
    m = await shelf(both(Date.now()))
    for (const key of ['agents', 'memory']) {
      expect(
        text(m.q(`shelf-usage-${key}`).querySelector('[data-cy="shelf-total-missing"]')!),
      ).toBe('Not read yet')
      expect(text(m.q(`shelf-usage-${key}`).querySelector('.usage-label')!)).toBe(
        key === 'agents' ? 'Agents' : 'Memory',
      )
    }
  })

  it('⚑ none running: no agents, nothing held', async () => {
    useWhoCalledWhom().forest.value = forestOf([conv('sess_a', null)])
    useWhoCalledWhom().runningConversations.value = []
    m = await shelf(both(Date.now()))
    expect(value('agents')).toBe('0')
    expect(value('memory')).toBe('0 MB')
  })
})
