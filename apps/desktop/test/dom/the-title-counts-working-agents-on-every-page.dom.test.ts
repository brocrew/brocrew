import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import type { AgentState } from '../../src/shared/agent-state-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { page } from 'vitest/browser'
import AppTitleBar from '../../src/renderer/src/components/AppTitleBar.vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import {
  railFacts,
  screenFacts,
  useWhoCalledWhom,
} from '../../src/renderer/src/composables/useWhoCalledWhom'

import type {
  Provider,
  ResumableSessionInfo,
  RuntimeStatesMessage,
  UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { conv, forestOf } from './forest-fixture'
import { assertDrawn, drawnReady, inkRects, lineCount } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'
import { provideIdlePlaceNavigator } from './provider-launch.fixture'
import { providerConnectionFixtures } from '../../look/fixtures/providers'

const original = { width: window.innerWidth, height: window.innerHeight }
afterEach(async () => {
  unmountAll()
  vi.useRealTimers()
  delete (window as { api?: unknown }).api
  railFacts().update({ runningConversations: null })
  screenFacts().update({ forest: null })
  screenFacts().update({ processMemory: new Map() })
  screenFacts().update({ memoryUnmeasured: null })
  await page.viewport(original.width, original.height)
})

function row(
  sessionId: string,
  provider: Provider,
  state: AgentState,
  running: ResumableSessionInfo['running'] = 'unwatched',
): ResumableSessionInfo {
  return {
    sessionId,
    provider,
    connectionId: `${provider}:sign-in`,
    state,
    running,
    cwd: '/made-up/bakery',
    status: 'idle',
    named: null,
    profileId: sessionId,
    approvalMode: 'ask',
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    child: null,
    lastEnding: 'completed',
    updatedAt: 1800000000000,
    ref: {
      provider,
      sessionId: 'fictional-thread-' + sessionId,
      cwd: '/made-up/bakery',
      rotation: 0,
    },
    resumeRefusal: null,
  }
}
function mixed() {
  return [
    row('recipe', 'claude', { is: 'active' }, 'in-a-window'),
    row('oven', 'claude', { is: 'in-the-background', what: 'bake the bread' }),
    row('menu', 'claude', { is: 'idle' }),
    row('answer', 'claude', { is: 'waiting-on-an-answer', from: 'Menu worker' }),
    {
      ...row('limit', 'claude', { is: 'scheduled', dueAt: 1800003600000 }),
      providerBlockStatus: 'current' as const,
      providerBlock: { provider: 'claude' as const, resetsAt: 1800003600000 },
    },
    row('design', 'codex', { is: 'active' }),
    row('person', 'codex', { is: 'needs-you' }),
    row('stock', 'codex', { is: 'idle' }),
  ]
}
/** Gives the cast a forest of these rows and 100 MB of process memory for each. */
function castTheRows(rows: readonly ResumableSessionInfo[]): void {
  screenFacts().update({
    forest: forestOf(
      rows.map((one) =>
        conv(one.sessionId, null, { running: one.running, provider: one.provider }),
      ),
    ),
    processMemory: new Map(rows.map((one) => [one.sessionId, 100 * 1024 * 1024])),
  })
}
const expected = '8 agents · 3 working'
const split = 'Claude 5 (2 working)\nCodex 3 (1 working)'
const text = (m: Mounted) => (m.q('app-usage').textContent ?? '').trim()
const fullText = (m: Mounted) => m.q('app-usage').title
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await drawnReady()
  await new Promise<void>((done) => requestAnimationFrame(() => done()))
  await nextTick()
}
function deferred<T>() {
  let resolve!: (answer: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
interface Rail {
  hearStates(message: RuntimeStatesMessage): void
  refreshResumable(): Promise<void>
}
async function windowWith(
  rows = mixed(),
  unreadable: UnresumableSessionInfo[] = [],
  initial = () => Promise.resolve(rows),
  usage = { claude: [] as unknown[], codex: [] as unknown[] },
) {
  let reply = initial
  ;(window as { api?: unknown }).api = {
    runtime: {
      providerCatalogue: async () => PROVIDER_DESCRIPTORS,
      providerConnections: async () => providerConnectionFixtures(),
      listResumable: () => reply(),
      listUnresumable: async () => unreadable,
      providerUsage: async () => usage,
      onProvidersChanged: () => () => {},
    },
  }
  const rail = ref<Rail | null>(null)
  const navigation = reactive({ activeId: null as string | null, place: 'tools' as string | null })
  const shell = defineComponent(() => {
    provideIdlePlaceNavigator()
    return () =>
      h('div', { style: 'display:flex;flex-direction:column;width:100%;height:100%' }, [
        h(AppTitleBar, { info: null, error: null }),
        h(SideRail, {
          ref: rail,
          open: [],
          activeId: navigation.activeId,
          place: navigation.place,
        }),
      ])
  })
  await page.viewport(1180, 840)
  const m = mount(shell, {}, { width: 1180, height: 840 })
  await settle()
  return {
    m,
    rail,
    navigation,
    setReply: (next: typeof reply) => {
      reply = next
    },
  }
}
function moved(conversation: string, state: AgentState): RuntimeStatesMessage {
  return { moved: [{ conversation, state }], kept: [] }
}

describe('working counts in the title bar', () => {
  it('counts active and background work among running conversations on both host lists', async () => {
    const rows = mixed()
    const noRef = {
      ...rows.pop()!,
      foundInUserHome: false,
      restoredFromBundle: false,
      reason: 'No provider reference yet',
    } as UnresumableSessionInfo
    const outside = {
      ...noRef,
      sessionId: 'outside',
      state: { is: 'active' as const },
      foundInUserHome: true,
    }
    const restored = { ...noRef, sessionId: 'restored', restoredFromBundle: true }
    const { m } = await windowWith(
      [...rows, row('stopped', 'claude', { is: 'active' }, 'not-running')],
      [noRef, outside, restored],
    )
    expect(fullText(m)).toContain(expected)
    expect(useWhoCalledWhom().runningConversations.value).toHaveLength(8)
    expect(useWhoCalledWhom().forest.value).toBeNull()
  })

  it('says zero working for idle, person waits, agent waits, schedules and holds', async () => {
    const rows = [
      row('idle', 'claude', { is: 'idle' }),
      row('person', 'claude', { is: 'needs-you' }),
      row('answer', 'claude', { is: 'waiting-on-an-answer', from: 'Recipe worker' }),
      row('owed', 'codex', { is: 'owes-an-answer', to: ['Menu coordinator'] }),
      row('worker', 'codex', { is: 'waiting-on-a-worker', on: ['Recipe worker'] }),
      {
        ...row('held', 'codex', { is: 'scheduled', dueAt: 1800003600000 }),
        providerBlockStatus: 'current' as const,
        providerBlock: { provider: 'codex' as const, resetsAt: 1800003600000 },
      },
    ]
    const { m } = await windowWith(rows)
    expect(fullText(m)).toContain('6 agents · 0 working')
    expect(useWhoCalledWhom().runningConversations.value?.map((one) => one.state.is)).toEqual(
      rows.map((one) => one.state.is),
    )
  })

  it('a read with no running conversations gives real zeros', async () => {
    const { m } = await windowWith([row('stopped', 'claude', { is: 'active' }, 'not-running')])
    expect(fullText(m)).toContain('0 agents')
    expect(fullText(m)).not.toContain(' working')
  })

  it('updates immediately from the same state push the rail receives', async () => {
    const { m, rail } = await windowWith()
    rail.value!.hearStates(moved('menu', { is: 'active' }))
    await nextTick()
    expect(fullText(m)).toContain('8 agents · 4 working')
    rail.value!.hearStates(moved('design', { is: 'idle' }))
    await nextTick()
    expect(fullText(m)).toContain('8 agents · 3 working')
    rail.value!.hearStates(moved('stock', { is: 'in-the-background', what: 'read the stock list' }))
    await nextTick()
    expect(fullText(m)).toContain('8 agents · 4 working')
  })

  it('a state push wins over a list reply already in flight', async () => {
    const { m, rail, setReply } = await windowWith()
    const pending = deferred<ResumableSessionInfo[]>()
    setReply(() => pending.promise)
    const refresh = rail.value!.refreshResumable()
    rail.value!.hearStates(moved('menu', { is: 'active' }))
    await nextTick()
    pending.resolve(mixed())
    await refresh
    await nextTick()
    expect(fullText(m)).toContain('8 agents · 4 working')
    setReply(() => Promise.resolve(mixed()))
    await rail.value!.refreshResumable()
    await nextTick()
    expect(fullText(m)).toContain('8 agents · 3 working')
  })

  it('a queued list refresh replaces the completed active reading in the title', async () => {
    const { m, rail, setReply } = await windowWith()
    vi.useFakeTimers()
    const older = deferred<ResumableSessionInfo[]>()
    const newer = deferred<ResumableSessionInfo[]>()
    const read = vi.fn().mockReturnValueOnce(older.promise).mockReturnValue(newer.promise)
    setReply(read)
    const oldRead = rail.value!.refreshResumable()
    await rail.value!.refreshResumable()
    newer.resolve([row('fresh', 'codex', { is: 'active' })])
    await nextTick()
    expect(read).toHaveBeenCalledTimes(1)
    expect(fullText(m)).toContain('8 agents · 3 working')
    older.resolve(mixed())
    await oldRead
    await nextTick()
    expect(fullText(m)).toContain('8 agents · 3 working')
    await vi.advanceTimersByTimeAsync(1_000)
    await nextTick()
    expect(read).toHaveBeenCalledTimes(2)
    expect(fullText(m)).toContain('1 agents · 1 working')
    expect(m.q('shelf-usage-agents').textContent).toContain('Codex 1 (1 working)')
  })

  it('a queued successful refresh replaces an active failed read without an error flash', async () => {
    const { m, rail, setReply } = await windowWith()
    vi.useFakeTimers()
    let reject!: (cause: Error) => void
    const older = new Promise<ResumableSessionInfo[]>((_, fail) => {
      reject = fail
    })
    const read = vi
      .fn()
      .mockReturnValueOnce(older)
      .mockResolvedValue([row('fresh', 'codex', { is: 'active' })])
    setReply(read)
    const oldRead = rail.value!.refreshResumable()
    await rail.value!.refreshResumable()
    expect(read).toHaveBeenCalledTimes(1)
    reject(new Error('Fictional older read failed'))
    await oldRead
    await nextTick()
    expect(fullText(m)).toContain('8 agents · 3 working')
    expect(m.all('conversations-error')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1_000)
    await nextTick()
    expect(read).toHaveBeenCalledTimes(2)
    expect(fullText(m)).toContain('1 agents · 1 working')
    expect(m.all('conversations-error')).toHaveLength(0)
  })

  it('updates the population when the all-page host list is refreshed', async () => {
    const { m, rail, setReply } = await windowWith()
    setReply(() => Promise.resolve([...mixed(), row('new-worker', 'codex', { is: 'active' })]))
    await rail.value!.refreshResumable()
    await nextTick()
    expect(fullText(m)).toContain('9 agents · 4 working')
  })

  it('does not depend on which conversation or destination is open', async () => {
    const { m, navigation } = await windowWith()
    for (const place of ['tools', 'providers', 'team', 'waiting', 'library', null]) {
      navigation.place = place
      navigation.activeId = place === null ? 'recipe' : null
      await nextTick()
      expect(fullText(m)).toContain(expected)
    }
    navigation.activeId = 'design'
    await nextTick()
    expect(fullText(m)).toContain(expected)
  })

  it('reload reads the list again, and starts with unknown instead of a kept count', async () => {
    const first = await windowWith()
    expect(fullText(first.m)).toContain(expected)
    unmountAll()
    expect(useWhoCalledWhom().runningConversations.value).toBeNull()
    const next = await windowWith([row('new', 'codex', { is: 'active' })])
    expect(fullText(next.m)).toContain('1 agents · 1 working')
  })

  it('an initial list still in flight says unknown, then updates when it answers', async () => {
    const pending = deferred<ResumableSessionInfo[]>()
    const { m } = await windowWith([], [], () => pending.promise)
    expect(fullText(m)).toContain('? agents')
    expect(fullText(m)).not.toContain(' working')
    pending.resolve(mixed())
    await settle()
    expect(fullText(m)).toContain(expected)
  })

  it('a failed first read cannot invent a zero-working count', async () => {
    const { m } = await windowWith([], [], () =>
      Promise.reject(new Error('Fictional first read failed')),
    )
    expect(fullText(m)).toContain('? agents')
    expect(fullText(m)).not.toContain(' working')
  })

  it('a failed later list read keeps the last good count', async () => {
    const { m, rail, setReply } = await windowWith()
    setReply(() => Promise.reject(new Error('Fictional list read failed')))
    await rail.value!.refreshResumable()
    await nextTick()
    expect(fullText(m)).toContain(expected)
  })

  it('puts each provider’s working subset in the popup and keeps memory detail', async () => {
    const rows = mixed()
    castTheRows(rows)
    const { m } = await windowWith(rows)
    m.q('app-usage').click()
    await nextTick()
    expect(m.q('shelf-usage-agents').textContent).toContain(split)
    expect(m.q('shelf-usage-memory').textContent).toContain('800 MB')
    expect(m.q('shelf-usage-agents').getAttribute('aria-label')).toBe('Agents running: ' + split)
    expect(m.q('app-usage-cards').matches(':popover-open')).toBe(true)
  })

  it.each([true, false])(
    'the popup has one provider per line, with no total or separator, working=%s',
    async (working) => {
      const sample = mixed().map((one) => ({
        ...one,
        state:
          !working && (one.state.is === 'active' || one.state.is === 'in-the-background')
            ? { is: 'idle' as const }
            : one.state,
      }))
      const { m } = await windowWith(sample)
      const lines = working ? split : 'Claude 5 (none working)\nCodex 3 (none working)'
      m.q('app-usage').click()
      await nextTick()
      await drawnReady()
      const value = m
        .q('shelf-usage-agents')
        .querySelector<HTMLElement>('[data-cy=shelf-usage-value]')!
      expect(value.textContent).toBe(lines)
      expect(value.textContent).not.toContain('·')
      expect(getComputedStyle(value).whiteSpace).toBe('pre-line')
      assertDrawn(value, 'both provider counts', m.host)
      expect(lineCount(value)).toBe(2)
      const drawn = inkRects(value)
      expect(drawn[1]!.top).toBeGreaterThanOrEqual(drawn[0]!.bottom)
      expect(drawn[1]!.left).toBe(drawn[0]!.left)
    },
  )

  it('only one provider in use draws just one line in the popup', async () => {
    const { m } = await windowWith([row('recipe', 'claude', { is: 'active' })])
    m.q('app-usage').click()
    await nextTick()
    const value = m
      .q('shelf-usage-agents')
      .querySelector<HTMLElement>('[data-cy=shelf-usage-value]')!
    expect(value.textContent).toBe('Claude 1 (1 working)')
    expect(value.textContent).not.toMatch(/[·\n]/)
    await drawnReady()
    assertDrawn(value, 'the single provider count', m.host)
    expect(lineCount(value)).toBe(1)
  })

  it.each([true, false])(
    'the compact line fits at1180 and retains whole usage/count/memory accessibly, working=%s',
    async (working) => {
      const rows = mixed().map((one) => ({
        ...one,
        state:
          !working && (one.state.is === 'active' || one.state.is === 'in-the-background')
            ? { is: 'idle' as const }
            : one.state,
      }))
      castTheRows(rows)
      const now = Date.now()
      const { m } = await windowWith(rows, [], () => Promise.resolve(rows), {
        claude: [
          {
            connectionId: 'claude:sign-in',
            window: 'five_hour',
            period: { word: '5-hour', durationMs: 5 * 3_600_000, bucket: false, bucketName: null },
            usedPercent: 28,
            resetsAt: now + 3600000,
            at: now,
          },
          {
            connectionId: 'claude:sign-in',
            window: 'seven_day',
            period: {
              word: 'weekly',
              durationMs: 7 * 24 * 3_600_000,
              bucket: false,
              bucketName: null,
            },
            usedPercent: 61,
            resetsAt: now + 7200000,
            at: now,
          },
        ],
        codex: [
          {
            connectionId: 'codex:sign-in',
            window: 'seven_day',
            period: {
              word: 'weekly',
              durationMs: 7 * 24 * 3_600_000,
              bucket: false,
              bucketName: null,
            },
            usedPercent: 35,
            resetsAt: now + 7200000,
            at: now,
          },
        ],
      })
      const line = m.q('app-usage')
      const whole = `Claude 5h 28% · week 61% · Codex week 35% · 8 agents · ${working ? '3 working' : '0 working'} · 800 MB`
      expect(text(m)).toBe('Claude 5h 28% · week 61% · +1')
      // The short line keeps the approved full usage sentences in its tooltip and name.
      const description = `${whole}. Claude 5-hour usage: 28% used; resets in 1 h. Claude weekly usage: 61% used; resets in 2 h. Codex weekly usage: 35% used; resets in 2 h. Agents running: Claude 5 (${working ? '2 working' : 'none working'})\nCodex 3 (${working ? '1 working' : 'none working'}). Their memory: 800 MB`
      expect(line.title).toBe(description)
      expect(line.getAttribute('aria-label')).toBe(description)
      await drawnReady()
      const rect = line.getBoundingClientRect()
      const title = m.q('window-title').getBoundingClientRect()
      expect(title.right).toBeLessThanOrEqual(rect.left + 0.5)
      assertDrawn(line, 'the complete usage/count/memory line', m.host)
      expect(lineCount(line)).toBe(1)
      expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth)
      for (const ink of inkRects(line)) {
        expect(document.elementFromPoint(ink.left + ink.width / 2, ink.top + ink.height / 2)).toBe(
          line,
        )
      }
      line.click()
      await nextTick()
      const values = m
        .q('app-usage-cards')
        .querySelectorAll<HTMLElement>('[data-cy=shelf-usage-value]')
      expect(values).toHaveLength(5)
      for (const value of values) assertDrawn(value, 'the usage or memory reading', m.host)
      expect(m.q('shelf-usage-memory').textContent).toContain('800 MB')
    },
  )
})

it('carries recorded connection identity through both real rail list paths without a default guess', async () => {
  const known = {
    ...row('fictional-title-known', 'claude', { is: 'active' }),
    connectionId: 'claude:sign-in',
  }
  const legacy = { ...row('fictional-title-legacy', 'claude', { is: 'idle' }), connectionId: null }
  const withoutRef = {
    ...row('fictional-title-no-ref', 'codex', { is: 'active' }),
    connectionId: 'codex:api-key',
    foundInUserHome: false,
    restoredFromBundle: false,
    reason: 'Fictional provider reference not yet announced',
  }
  const stopped = {
    ...row('fictional-title-stopped', 'codex', { is: 'idle' }, 'not-running'),
    connectionId: 'codex:sign-in',
  }
  const { rail, setReply } = await windowWith([known, legacy, stopped], [withoutRef])
  expect(useWhoCalledWhom().runningConversations.value).toHaveLength(3)
  expect(useWhoCalledWhom().runningConversations.value).toEqual([
    expect.objectContaining({
      sessionId: known.sessionId,
      provider: 'claude',
      connectionId: known.connectionId,
    }),
    expect.objectContaining({
      sessionId: legacy.sessionId,
      provider: 'claude',
      connectionId: null,
    }),
    expect.objectContaining({
      sessionId: withoutRef.sessionId,
      provider: 'codex',
      connectionId: withoutRef.connectionId,
    }),
  ])
  setReply(async () => [legacy, { ...known, running: 'not-running' }, stopped])
  await rail.value!.refreshResumable()
  await settle()
  expect(useWhoCalledWhom().runningConversations.value).toHaveLength(2)
  expect(useWhoCalledWhom().runningConversations.value).toEqual([
    expect.objectContaining({ sessionId: legacy.sessionId, connectionId: null }),
    expect.objectContaining({
      sessionId: withoutRef.sessionId,
      connectionId: withoutRef.connectionId,
    }),
  ])
})
