import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { Provider, ProviderConnection } from '@brobot2/shared'
import type { ProviderUsageReading, RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { ClientApi } from '../../src/shared/client-api'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import { railFacts, screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { providersBridge, providerConnectionFixtures } from '../../look/fixtures/providers'
import { mount, unmountAll, visible } from './harness'
import { drawnReady } from './drawn'
import { provideIdlePlaceNavigator, reserveTitleUsageRoom } from './provider-launch.fixture'

const HOUR = 3_600_000
const original = { width: window.innerWidth, height: window.innerHeight }
const settle = async () => {
  for (let index = 0; index < 5; index++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
  await drawnReady()
  await new Promise<void>((done) => requestAnimationFrame(() => done()))
  await nextTick()
}
afterEach(async () => {
  unmountAll()
  vi.restoreAllMocks()
  railFacts().update({ runningConversations: null })
  screenFacts().update({ forest: null, processMemory: new Map(), memoryUnmeasured: null })
  Reflect.deleteProperty(window, 'api')
  await page.viewport(original.width, original.height)
})
const running = (
  provider: Provider,
  connectionId: string | null,
  sessionId = connectionId ?? 'fictional-legacy',
) => ({
  sessionId,
  provider,
  connectionId,
  state: { is: 'active' as const },
})
function reading(
  connectionId: string | undefined,
  usedPercent: number,
  word = 'weekly',
  more: Partial<ProviderUsageReading> = {},
): ProviderUsageReading {
  return {
    ...(connectionId === undefined ? {} : { connectionId }),
    window: word,
    period: {
      word,
      durationMs: word === '5-hour' ? 5 * HOUR : 7 * 24 * HOUR,
      bucket: false,
      bucketName: null,
    },
    usedPercent,
    resetsAt: Date.now() + HOUR,
    at: Date.now(),
    ...more,
  }
}
const work: ProviderConnection = {
  ...providerConnectionFixtures()[0]!,
  id: 'fictional-claude-work',
  name: 'work account',
}
async function bar(
  runs: (ReturnType<typeof running> | Omit<ReturnType<typeof running>, 'connectionId'>)[],
  usage: Record<Provider, readonly ProviderUsageReading[]>,
  options: {
    width?: number
    metadata?: () => Promise<readonly ProviderConnection[]>
    client?: ClientApi
    beforeMount?: () => void
  } = {},
) {
  providersBridge()
  window.api.runtime.providerUsage = async () => usage
  window.api.runtime.providerConnections =
    options.metadata ?? (async () => [...providerConnectionFixtures(), work])
  options.beforeMount?.()
  railFacts().update({ runningConversations: runs })
  const width = options.width ?? 1180
  await page.viewport(width, 840)
  const Frame = defineComponent({
    setup() {
      provideIdlePlaceNavigator()
      if (options.client) provide(CLIENT_PROVIDERS, options.client)
      return () =>
        h('div', { style: 'display:flex;flex-direction:column;width:100%;height:100%' }, [
          h(AppTitleBar, { info: null, error: null }),
        ])
    },
  })
  const m = mount(Frame, {}, { width, height: 32 })
  await settle()
  return m
}

function expectUsageLabelsFit(cards: HTMLElement): void {
  for (const fact of cards.querySelectorAll<HTMLElement>('.fact')) {
    const cell = fact.getBoundingClientRect()
    const label = fact.querySelector<HTMLElement>('.usage-label')!
    const value = fact.querySelector<HTMLElement>('.fact-value')!.getBoundingClientRect()
    const parts = [...label.children].map((part) => part.getBoundingClientRect())
    for (const part of [...parts, value]) {
      expect(part.width).toBeGreaterThan(0)
      expect(part.height).toBeGreaterThan(0)
      expect(part.left).toBeGreaterThanOrEqual(cell.left)
      expect(part.right).toBeLessThanOrEqual(cell.right)
      expect(part.top).toBeGreaterThanOrEqual(cell.top)
      expect(part.bottom).toBeLessThanOrEqual(cell.bottom)
    }
    expect(label.getBoundingClientRect().bottom).toBeLessThanOrEqual(value.top)
    if (parts.length === 2) {
      const [name, age] = parts
      const overlaps =
        name!.left < age!.right &&
        age!.left < name!.right &&
        name!.top < age!.bottom &&
        age!.top < name!.bottom
      expect(overlaps).toBe(false)
    }
  }
}

it('omits default-only providers and usage when no conversation is running', async () => {
  const m = await bar([], {
    claude: [reading('claude:sign-in', 99)],
    codex: [reading('codex:sign-in', 88)],
  })
  const line = m.q('app-usage')
  expect(line.textContent).toContain('0 agents')
  expect(line.textContent).not.toMatch(/Claude|Codex|99%|88%/)
  expect(line.title).not.toMatch(/99%|88%/)
  line.click()
  await nextTick()
  expect(m.q('app-usage-cards').textContent).not.toMatch(/99%|88%/)
})

it('reads only the running connection, without borrowing another mode or a default provider', async () => {
  const m = await bar([running('claude', 'claude:sign-in')], {
    claude: [reading('claude:api-key', 99), reading('claude:sign-in', 42)],
    codex: [reading('codex:sign-in', 88)],
  })
  expect(m.q('app-usage').title).toContain('42%')
  expect(m.q('app-usage').title).not.toMatch(/99%|88%|Codex/)
  expect(m.q('app-usage').textContent).toContain('Claude')
})

it('keeps two running connections of one provider separate and counts each agent once', async () => {
  const m = await bar(
    [
      running('claude', 'claude:sign-in', 'fictional-a'),
      running('claude', 'claude:sign-in', 'fictional-b'),
      running('claude', work.id),
    ],
    { claude: [reading('claude:sign-in', 42), reading(work.id, 12)], codex: [] },
  )
  const line = m.q('app-usage')
  expect(line.title).toContain('Claude · subscription')
  expect(line.title).toContain('Claude · work account')
  expect(line.title).toContain('42%')
  expect(line.title).toContain('12%')
  line.click()
  await nextTick()
  const cards = m.q('app-usage-cards')
  expect(cards.textContent).toContain('subscription')
  expect(cards.textContent).toContain('work account')
  expect(cards.querySelector('[data-cy="shelf-usage-agents"]')?.textContent).toContain('3')
  expect(line.getAttribute('aria-label')).toBe(line.title)
})

it('removes a stopped connection without losing the remaining provider', async () => {
  const m = await bar([running('claude', work.id), running('codex', 'codex:sign-in')], {
    claude: [reading(work.id, 87)],
    codex: [reading('codex:sign-in', 23)],
  })
  expect(m.q('app-usage').title).toContain('87%')
  railFacts().update({ runningConversations: [running('codex', 'codex:sign-in')] })
  await settle()
  expect(m.q('app-usage').title).not.toMatch(/Claude|87%/)
  expect(m.q('app-usage').title).toContain('Codex')
  expect(m.q('app-usage').title).toContain('23%')
})

it('does not lend attributed or unattributed usage to a legacy unknown binding', async () => {
  const m = await bar([running('claude', null)], {
    claude: [reading('claude:sign-in', 91), reading(undefined, 88)],
    codex: [],
  })
  expect(m.q('app-usage').title).toContain('Claude')
  expect(m.q('app-usage').title).not.toMatch(/91%|88%/)
  expect(m.q('app-usage').textContent).toContain('?')
})

for (const failed of [false, true]) {
  it(`retains a running connection and its attributed usage when metadata is ${failed ? 'failed' : 'missing'}`, async () => {
    const m = await bar(
      [running('claude', work.id)],
      { claude: [reading(work.id, 87)], codex: [] },
      {
        metadata: async () => {
          if (failed) throw new Error('Fictional metadata read failure')
          return []
        },
      },
    )
    expect(m.q('app-usage').title).toContain('Claude')
    expect(m.q('app-usage').title).toContain('87%')
    expect(m.q('app-usage').textContent).not.toContain('Fictional metadata read failure')
  })
}

it('does not mistake a named bucket for the running connection’s window', async () => {
  const m = await bar([running('claude', 'claude:sign-in')], {
    claude: [
      reading('claude:sign-in', 99, 'weekly', {
        period: { word: 'weekly', durationMs: HOUR, bucket: true, bucketName: 'Fictional branch' },
      }),
      reading('claude:sign-in', 42),
    ],
    codex: [],
  })
  expect(m.q('app-usage').title).toContain('42%')
  expect(m.q('app-usage').title).not.toContain('99%')
})

it('keeps reset and unconfirmed distinctions in the cards and accessible full description', async () => {
  const m = await bar([running('claude', 'claude:sign-in')], {
    claude: [
      reading('claude:sign-in', 61, '5-hour', { unconfirmed: true }),
      reading('claude:sign-in', 95, 'weekly', { resetsAt: Date.now() - HOUR }),
    ],
    codex: [],
  })
  const line = m.q('app-usage')
  expect(line.title).toContain('Not yet confirmed')
  line.click()
  await nextTick()
  const cards = m.q('app-usage-cards')
  expect(cards.textContent).toContain('Not yet confirmed')
  expect(cards.textContent).toContain('was 95%')
  expect(cards.textContent).toContain('reset')
})

it('fits tightest connection then tightest window at 1180 and 760 while retaining every running group in the popover', async () => {
  const m = await bar(
    [
      running('claude', 'claude:sign-in'),
      running('claude', work.id),
      running('codex', 'codex:sign-in'),
    ],
    {
      claude: [
        reading('claude:sign-in', 28, '5-hour'),
        reading('claude:sign-in', 92),
        reading(work.id, 12, '5-hour'),
        reading(work.id, 20),
      ],
      codex: [reading('codex:sign-in', 35)],
    },
    { width: 2400 },
  )
  const line = m.q('app-usage')
  const full = line.title
  expect(full).toContain('3 agents · 3 working')
  const fullVisual = line.textContent
  expect(fullVisual).toContain('Claude · work account')
  expect(fullVisual).toContain('Codex')
  expect(fullVisual).not.toContain('+2')
  await page.viewport(1180, 840)
  m.host.style.width = '1180px'
  await reserveTitleUsageRoom(m, 'Claude · subscription 5h 28% · week 92% · +2')
  await settle()
  expect(line.textContent).toContain('Claude · subscription')
  expect(line.textContent).toContain('5h 28%')
  expect(line.textContent).toContain('week 92%')
  expect(line.textContent).toContain('+2')
  expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth + 1)
  await page.viewport(760, 840)
  m.host.style.width = '760px'
  await reserveTitleUsageRoom(m, 'Claude · subscription week 92% · +2')
  await settle()
  expect(line.textContent).toContain('Claude · subscription')
  expect(line.textContent).toContain('week 92%')
  expect(line.textContent).toContain('+2')
  expect(line.textContent).not.toContain('5h 28%')
  expect(line.title).toBe(full)
  expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth + 1)
  expect(line.getAttribute('aria-label')).toBe(full)
  line.click()
  await nextTick()
  const cards = m.q('app-usage-cards')
  expect(cards.matches(':popover-open')).toBe(true)
  expect(visible(cards)).toBe(true)
  for (const words of ['subscription', 'work account', 'Codex', 'Agents', 'Memory'])
    expect(cards.textContent).toContain(words)
  expectUsageLabelsFit(cards)
  await page.viewport(2400, 840)
  m.host.style.width = '2400px'
  await settle()
  expect(line.textContent).toBe(fullVisual)
  expect(line.title).toBe(full)
})

it('keeps an omitted binding unknown without borrowing an attributed provider default', async () => {
  const m = await bar(
    [{ sessionId: 'fictional-omitted', provider: 'claude', state: { is: 'active' } }],
    {
      claude: [reading('claude:sign-in', 91), reading(undefined, 88)],
      codex: [],
    },
  )
  expect(m.q('app-usage').title).toContain('Claude')
  expect(m.q('app-usage').title).not.toMatch(/91%|88%/)
  expect(m.q('app-usage').textContent).toContain('?')
})

it('uses provider then connection identity as a stable tie order for equally tight running windows', async () => {
  const runs = [
    running('codex', 'codex:sign-in'),
    running('claude', work.id),
    running('claude', 'claude:sign-in'),
  ]
  const m = await bar(
    runs,
    {
      claude: [reading(work.id, 61), reading('claude:sign-in', 61)],
      codex: [reading('codex:sign-in', 61)],
    },
    { width: 760 },
  )
  const line = m.q('app-usage')
  expect(line.textContent).toContain('Claude · subscription')
  expect(line.textContent).toContain('week 61%')
  expect(line.textContent).toContain('+2')
  const before = line.textContent
  railFacts().update({ runningConversations: [...runs].reverse() })
  await settle()
  expect(line.textContent).toBe(before)
})

it('ranks current confirmed usage ahead of expired and unconfirmed larger figures', async () => {
  const m = await bar(
    [
      running('claude', work.id),
      running('codex', 'codex:sign-in'),
      running('claude', 'claude:sign-in'),
    ],
    {
      claude: [
        reading(work.id, 99, 'weekly', { unconfirmed: true }),
        reading('claude:sign-in', 61),
      ],
      codex: [reading('codex:sign-in', 98, 'weekly', { resetsAt: Date.now() - HOUR })],
    },
    { width: 760 },
  )
  expect(m.q('app-usage').textContent).toContain('Claude · subscription')
  expect(m.q('app-usage').textContent).toContain('61%')
  expect(m.q('app-usage').textContent).not.toMatch(/99%|98%/)
  expect(m.q('app-usage').title).toContain('Not yet confirmed')
})

it('observes available parent space and disconnects its size observer on unmount', async () => {
  const observe = vi.spyOn(ResizeObserver.prototype, 'observe')
  const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
  const m = await bar([running('claude', 'claude:sign-in')], {
    claude: [reading('claude:sign-in', 42)],
    codex: [],
  })
  const line = m.q('app-usage')
  const watched = observe.mock.calls.findIndex(([target]) => target === line.parentElement)
  expect(watched).toBeGreaterThanOrEqual(0)
  const observer = observe.mock.contexts[watched]
  m.unmount()
  await settle()
  expect(disconnect.mock.contexts).toContain(observer)
})

it('keeps legacy NULL and the opaque ID unknown as distinct running groups through reorder and removal', async () => {
  const legacy = running('claude', null, 'fictional-null-binding')
  const named = running('claude', 'unknown', 'fictional-opaque-binding')
  const m = await bar([legacy, named], { claude: [], codex: [] }, { metadata: async () => [] })
  m.q('app-usage').click()
  await nextTick()
  const cards = m.q('app-usage-cards')
  const usageEntries = () =>
    [...cards.querySelectorAll<HTMLElement>('[role="group"]')].filter(
      (el) =>
        !['shelf-usage-agents', 'shelf-usage-memory'].includes(el.getAttribute('data-cy') ?? ''),
    )
  const entries = usageEntries()
  expect(entries).toHaveLength(2)
  expect(new Set(entries.map((el) => el.getAttribute('data-cy'))).size).toBe(2)
  const legacyEntry = entries.find(
    (el) => el.querySelector('.fact-label')?.textContent?.trim() === 'Claude · unknown connection',
  )!
  const namedEntry = entries.find(
    (el) => el.querySelector('.fact-label')?.textContent?.trim() === 'Claude · unknown',
  )!
  expect(legacyEntry).toBeDefined()
  expect(namedEntry).toBeDefined()
  railFacts().update({ runningConversations: [named, legacy] })
  await settle()
  expect(usageEntries()).toContain(legacyEntry)
  expect(usageEntries()).toContain(namedEntry)
  railFacts().update({ runningConversations: [named] })
  await settle()
  expect(usageEntries()).toEqual([namedEntry])
  expect(legacyEntry.isConnected).toBe(false)
})

it('uses running process memory before any graph is opened, excluding stopped processes', async () => {
  screenFacts().update({
    forest: null,
    processMemory: new Map([
      ['fictional-running', 2 * 1024 * 1024],
      ['fictional-stopped', 9 * 1024 * 1024],
    ]),
    memoryUnmeasured: null,
  })
  const m = await bar([running('claude', 'claude:sign-in', 'fictional-running')], {
    claude: [],
    codex: [],
  })
  expect(m.q('app-usage').title).toContain('1 agents · 1 working · 2 MB')
  expect(m.q('app-usage').title).not.toContain('11 MB')
  m.q('app-usage').click()
  await nextTick()
  expect(m.q('shelf-usage-memory').textContent).toContain('2 MB')
  railFacts().update({ runningConversations: [] })
  await settle()
  expect(m.q('app-usage').title).toContain('0 agents · 0 MB')
  expect(m.q('shelf-usage-memory').textContent).toContain('0 MB')
})

it('keeps an unread population and an explicitly unmeasured process reading distinct', async () => {
  const m = await bar([running('claude', 'claude:sign-in', 'fictional-running')], {
    claude: [],
    codex: [],
  })
  screenFacts().update({
    forest: null,
    processMemory: new Map(),
    memoryUnmeasured: 'Fictional process read unavailable.',
  })
  await settle()
  expect(m.q('app-usage').title).toContain('Their memory: Fictional process read unavailable.')
  m.q('app-usage').click()
  await nextTick()
  expect(m.q('shelf-usage-memory').textContent).toContain('not measured')
  railFacts().update({ runningConversations: null })
  await settle()
  expect(m.q('app-usage').title).toContain('Their memory: not read yet')
  expect(m.q('app-usage').title).not.toContain('0 MB')
})

it('keeps missing process samples unknown and accepts a measured zero', async () => {
  screenFacts().update({ forest: null, processMemory: new Map(), memoryUnmeasured: null })
  const m = await bar(
    [
      running('claude', 'claude:sign-in', 'fictional-first'),
      running('claude', 'claude:sign-in', 'fictional-second'),
    ],
    { claude: [], codex: [] },
  )
  expect(m.q('app-usage').title).toContain('Their memory: not read yet')
  m.q('app-usage').click()
  await nextTick()
  expect(m.q('shelf-usage-memory').textContent).toContain('Not read yet')
  const samples = new Map([
    ['fictional-first', 2 * 1024 * 1024],
    ['fictional-stopped', 9 * 1024 * 1024],
  ])
  screenFacts().update({ processMemory: samples })
  await settle()
  expect(m.q('app-usage').title).toContain('Their memory: not read yet')
  expect(m.q('app-usage').title).not.toContain('11 MB')
  screenFacts().update({ processMemory: new Map([...samples, ['fictional-second', 0]]) })
  await settle()
  expect(m.q('app-usage').title).toContain('2 agents · 2 working · 2 MB')
  expect(m.q('shelf-usage-memory').textContent).toContain('2 MB')
})

it.each(['claude', 'codex'] as const)(
  '%s keeps pre-answer waiting but omits unreported owned windows after answers, preserving reported null and zero',
  async (provider) => {
    const id = `${provider}:sign-in`
    type Readings = Record<Provider, readonly ProviderUsageReading[]>
    let finish!: (rows: Readings) => void
    const first = new Promise<Readings>((resolve) => {
      finish = resolve
    })
    let initial = true
    let answer: Readings = {
      claude: [],
      codex: [],
      [provider]: [reading(id, 0, 'weekly', { usedPercent: null })],
    }
    const read = vi.fn<RuntimeBridge['providerUsage']>(() => {
      if (initial) {
        initial = false
        return first
      }
      return Promise.resolve(answer)
    })
    const listeners = new Set<Parameters<RuntimeBridge['onProvidersChanged']>[0]>()
    const client = createDesktopProviderApi(
      () => window.api.runtime,
      () => window.api?.providerSetup,
    )
    const m = await bar(
      [running(provider, id)],
      { claude: [], codex: [] },
      {
        client,
        beforeMount: () => {
          window.api.runtime.providerUsage = read
          window.api.runtime.onProvidersChanged = (listener) => {
            listeners.add(listener)
            return () => {
              listeners.delete(listener)
            }
          }
        },
      },
    )
    const line = m.q('app-usage')
    expect(read).toHaveBeenCalledOnce()
    if (provider === 'claude') expect(line.textContent).toContain('5h ?')
    else expect(line.textContent).not.toContain('5h')
    expect(line.textContent).toContain('week ?')
    finish(answer)
    await settle()
    expect(line.textContent).not.toContain('5h')
    expect(line.textContent).toContain('week ?')
    line.click()
    await nextTick()
    const cards = m.q('app-usage-cards')
    expect(visible(cards)).toBe(true)
    expect(cards.textContent).toContain('Amount not said')
    expect(line.title).toContain(
      `${provider === 'claude' ? 'Claude' : 'Codex'} weekly usage: unknown`,
    )
    expect(cards.querySelectorAll(`[data-cy=shelf-usage-${provider}-5h]`)).toHaveLength(0)
    answer = {
      claude: [],
      codex: [],
      [provider]: [reading(id, 0), reading(`${provider}:api-key`, 99, '5-hour')],
    }
    for (const listener of listeners) listener({ what: 'usage', provider })
    await settle()
    expect(line.textContent).toContain('week 0%')
    expect(line.textContent).not.toMatch(/5h|99%/)
    expect(cards.textContent).toContain('0%')
    answer = { claude: [], codex: [] }
    for (const listener of listeners) listener({ what: 'usage', provider })
    await settle()
    expect(line.textContent).not.toMatch(/5h|week/)
    expect(line.title).not.toContain('weekly usage')
    expect(
      cards.querySelectorAll(
        `[data-cy=shelf-usage-${provider}-5h], [data-cy=shelf-usage-${provider}-week]`,
      ),
    ).toHaveLength(0)
    expect(cards.textContent).toContain(provider === 'claude' ? 'Claude' : 'Codex')
    answer = { claude: [], codex: [], [provider]: [reading(`${provider}:api-key`, 99)] }
    for (const listener of listeners) listener({ what: 'usage', provider })
    await settle()
    expect(line.textContent).not.toMatch(/5h|week|99%/)
    expect(read.mock.calls).toEqual([[], [], [], []])
  },
)

it('keeps an unbroken recorded name, age and value inside its usage card', async () => {
  const named = { ...work, name: 'FictionalResearchConnectionWithAnUnbrokenName' }
  const m = await bar(
    [running('claude', 'claude:sign-in'), running('claude', named.id)],
    { claude: [reading('claude:sign-in', 29), reading(named.id, 84)], codex: [] },
    { width: 760, metadata: async () => [...providerConnectionFixtures(), named] },
  )
  m.q('app-usage').click()
  await nextTick()
  const cards = m.q('app-usage-cards')
  expect(cards.matches(':popover-open')).toBe(true)
  expect(cards.textContent).toContain(named.name)
  expect(cards.textContent).toContain('84%')
  expectUsageLabelsFit(cards)
})
