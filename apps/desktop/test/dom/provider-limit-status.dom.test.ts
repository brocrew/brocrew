import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import {
  useWhoCalledWhom,
  type RailSays,
} from '../../src/renderer/src/composables/useWhoCalledWhom'
import { facetsOfState } from '../../src/renderer/src/lib/agent-state'
import type { WhoCalledWhom } from '../../src/shared/who-called-whom'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { createProviderBlockStore } from '../../src/renderer/src/lib/provider-limit-facts'
import { acceptLiveness, acceptProviderBlock } from '../../src/renderer/src/lib/session-record'
import type { AgentState } from '../../src/shared/agent-state'
import type {
  AgentStateMoved,
  QueuedMessageDisclosure,
  ResumableSessionInfo,
  SessionLiveness,
  TranscriptEvent,
} from '../../src/shared/runtime-ipc'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { fullTime } from '../../src/renderer/src/lib/clock'
import { clockTime } from '../../src/shared/clock'
import { BODY_WAS_CUT } from '../../src/renderer/src/lib/outgoing-card'
import { assertDrawn, drawnReady, lineCount } from './drawn'
import { EXCHANGE_AT, questionFixture } from './agent-card-facts.fixture'
import { META, mount, paneProps, permission, record, unmountAll, visible } from './harness'

const NOW = Date.now()
const CURRENT = {
  providerBlockStatus: 'current',
  providerBlock: { provider: 'claude', resetsAt: NOW + 3600000 },
} as const
const read = (one: Element) => one.textContent?.replace(/\s+/g, ' ').trim() ?? ''

afterEach(() => {
  unmountAll()
  vi.useRealTimers()
  vi.restoreAllMocks()
  const cast = useWhoCalledWhom()
  cast.railSays.value = null
  cast.reading.value = null
  cast.forest.value = null
  cast.goTo.value = null
  delete (window as { api?: unknown }).api
})

function pane(events: TranscriptEvent[] = [], over = {}, at?: number) {
  const one = reactive(record([]))
  for (const event of events) applyEvent(one.transcript, event, at)
  one.meta = { ...META, ...CURRENT }
  const m = mount(
    ConversationPane,
    paneProps({ record: one, cwd: META.cwd, drawerOpen: true, ...over }),
    {
      width: 1200,
      height: 1000,
    },
  )
  return { m, one }
}
function liveness(over: Partial<SessionLiveness>): SessionLiveness {
  return { state: 'ended', since: NOW, ...over }
}

describe('Current provider stop in the real conversation header and panel', () => {
  it.each(['claude', 'codex'] as const)(
    '%s: current known reset reaches both surfaces and exact detail',
    async (provider) => {
      const { m, one } = pane()
      one.meta = {
        ...one.meta!,
        provider,
        ref: one.meta!.ref ? { ...one.meta!.ref, provider } : null,
      }
      acceptLiveness(
        one,
        liveness({ ...CURRENT, providerBlock: { provider, resetsAt: NOW + 3600000 } }),
      )
      await nextTick()
      await drawnReady()
      const name = provider === 'claude' ? 'Claude' : 'Codex'
      expect(read(m.q('session-status'))).toContain(`Stopped: ${name}’s limit`)
      expect(read(m.q('session-bot-word'))).toBe(read(m.q('session-status')))
      expect(m.q('session-status').title).toContain('Reported reset:')
      expect(m.q('session-status').tabIndex).toBe(0)
      m.q('session-status').focus()
      expect(document.activeElement).toBe(m.q('session-status'))
      expect(m.q('session-status').getAttribute('aria-description')).toContain('Reported reset:')
      assertDrawn(m.q('session-status'), 'the current stop', m.host)
    },
  )
  it('unknown and passed resets say stopped, never resumed by the clock', async () => {
    const { m, one } = pane()
    for (const resetsAt of [null, NOW - 1000]) {
      acceptLiveness(one, liveness({ ...CURRENT, providerBlock: { provider: 'claude', resetsAt } }))
      await nextTick()
      expect(read(m.q('session-status'))).toBe('Stopped: Claude’s limit')
      expect(read(m.q('session-bot-word'))).toBe('Stopped: Claude’s limit')
      expect(m.q('session-status').title.includes('(passed)')).toBe(resetsAt !== null)
    }
  })
  it('unchanged ordinary state gets clear, unavailable and omission pushes without rereading', async () => {
    const { m, one } = pane()
    expect(read(m.q('session-status'))).toContain('Stopped: Claude')
    acceptLiveness(one, liveness({}))
    await nextTick()
    expect(read(m.q('session-status'))).toContain('Stopped: Claude')
    acceptLiveness(one, liveness({ providerBlockStatus: 'unavailable' }))
    await nextTick()
    expect(read(m.q('session-status'))).toBe('Current limit status unavailable')
    expect(read(m.q('session-status'))).not.toContain('Stopped')
    acceptProviderBlock(one, { providerBlockStatus: 'current', providerBlock: null })
    await nextTick()
    expect(read(m.q('session-status'))).toBe('Idle')
    expect(read(m.q('session-bot-word'))).toBe('idle')
    expect(m.q('session-status').title).toBe('')
  })
  it('a person permission remains the priority on both surfaces', async () => {
    const { m } = pane([permission('menu-permission')])
    await nextTick()
    expect(read(m.q('session-status'))).not.toContain('limit')
    expect(read(m.q('session-status'))).toBe('Needs you')
    expect(read(m.q('session-bot-word'))).not.toContain('limit')
  })
  it('an active retry remains active while the older block field is still present', () => {
    const { m } = pane([{ type: 'status', state: 'working' } as TranscriptEvent])
    expect(read(m.q('session-status'))).not.toContain('limit')
    expect(read(m.q('session-bot-word'))).not.toContain('limit')
  })
  it('a recorded scheduled conversation uses its listed current fact, then its explicit clear', async () => {
    const listed = reactive({ ...CURRENT })
    const { m, one } = pane([], {
      listedState: { is: 'scheduled', dueAt: NOW + 60000 },
      providerBlock: listed,
    })
    one.phase = 'recorded'
    await nextTick()
    expect(read(m.q('session-status'))).toContain('Stopped: Claude')
    Object.assign(listed, { providerBlock: null })
    await nextTick()
    expect(read(m.q('session-status'))).toBe('Scheduled')
  })
})

describe('The minute clock changes only the relative reset words', () => {
  it('crosses a reported reset while keeping the stopped reason and passed detail', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    const { m, one } = pane()
    acceptLiveness(
      one,
      liveness({ ...CURRENT, providerBlock: { provider: 'claude', resetsAt: NOW + 10000 } }),
    )
    await nextTick()
    expect(read(m.q('session-status'))).toContain('resets in')
    // Cross the minute boundary after the reported reset, including starts near a rollover.
    await vi.advanceTimersByTimeAsync(120001)
    await nextTick()
    expect(read(m.q('session-status'))).toBe('Stopped: Claude’s limit')
    expect(m.q('session-status').title).toContain('(passed)')
    expect(read(m.q('session-bot-word'))).toBe('Stopped: Claude’s limit')
    expect(one.meta!.providerBlock).toEqual({ provider: 'claude', resetsAt: NOW + 10000 })
  })
})

describe('The full live queue carries provider reasons by message ID', () => {
  it.each([
    { label: null, answer: false },
    { label: 'W1.2', answer: false },
    { label: null, answer: true },
    { label: 'W1.2', answer: true },
  ])(
    'holds only the named agent message ($label, answer $answer); preserves accepted work and neighbors, then clears',
    async ({ label, answer }) => {
      const events: TranscriptEvent[] = ['notice-menu', 'person-menu', 'ordinary-menu'].map(
        (messageId, i) => ({
          type: 'message_queued',
          messageId,
          kind: 'work',
          ...(i === 0
            ? {
                relayedFrom: 'recipe-agent',
                relayedFromProfile: 'ayo',
                says: 'note' as const,
                ...(answer
                  ? {
                      answeredQuestion: {
                        requestId: 'recipe-question',
                        answeredBy: 'recipe-agent',
                        answer: 'Use the recipe.',
                      },
                    }
                  : {}),
              }
            : {}),
          text: messageId,
        }),
      )
      if (label)
        events.push({
          type: 'work_given',
          piece: 'work_recipe',
          parent: 'work_menu',
          label,
          givenBy: 'recipe-agent',
          title: 'Recipe',
          brief: 'notice-menu',
          messageId: 'notice-menu',
        })
      const { m, one } = pane(events)
      if (answer) {
        expect(m.all('answered-question')).toHaveLength(1)
        expect(m.all('exchange-state')).toHaveLength(0)
        expect(m.q('exchange-toggle').getAttribute('aria-description')).toBeNull()
        m.q('exchange-toggle').click()
        await nextTick()
        expect(read(m.all('queued-state')[0]!)).not.toContain('limit')
        m.q('exchange-toggle').click()
        await nextTick()
      }
      const queue: QueuedMessageDisclosure[] = ['notice-menu', 'person-menu', 'ordinary-menu'].map(
        (_, i) => ({
          id: ['notice-menu', 'person-menu', 'ordinary-menu'][i]!,
          kind: 'work',
          text: 'Menu',
          since: NOW,
          holdReasonStatus: 'current',
          holdReason:
            i === 0 ? { is: 'provider-limit', provider: 'claude', resetsAt: NOW + 3600000 } : null,
        }),
      )
      acceptLiveness(one, liveness({ queued: queue }))
      await nextTick()
      if (answer) expect(m.all('answered-question')).toHaveLength(1)
      expect(read(m.q('exchange-state'))).toContain('Claude limit')
      if (label) expect(read(m.q('exchange-state'))).toContain('on its list · words held')
      await drawnReady()
      assertDrawn(m.q('exchange-state'), 'the full held-word state', m.host)
      expect(m.q('exchange-state').title).toContain('waiting for Claude’s limit to reset')
      m.q('exchange-toggle').click()
      await nextTick()
      expect(m.all('queued-state')).toHaveLength(3)
      expect(m.all('answer-body-cut')).toHaveLength(0)
      expect(read(m.all('queued-state')[0]!)).toContain('waiting for Claude’s limit to reset')
      if (label)
        expect(read(m.all('queued-state')[0]!)).toContain(
          'on its list as W1.2 · these words are held',
        )
      expect(read(m.all('queued-state')[1]!)).toBe('not sent · waiting for the turn to end')
      expect(read(m.all('queued-state')[2]!)).toBe('not sent · waiting for the turn to end')
      const omitted = queue.map((q) => ({ id: q.id, kind: q.kind, text: q.text, since: q.since }))
      acceptLiveness(one, liveness({ queued: omitted }))
      await nextTick()
      expect(read(m.q('exchange-state'))).toContain('Claude limit')
      expect(read(m.all('queued-state')[0]!)).toContain('waiting for Claude’s limit to reset')
      acceptLiveness(
        one,
        liveness({
          queued: omitted.map((q, i) =>
            i === 0 ? { ...q, holdReasonStatus: 'unavailable' as const } : q,
          ),
        }),
      )
      await nextTick()
      expect(read(m.q('exchange-state'))).toContain('limit unavailable')
      await drawnReady()
      assertDrawn(m.q('exchange-state'), 'the full unavailable word state', m.host)
      expect(read(m.all('queued-state')[0]!)).toContain('limit status unavailable')
      acceptLiveness(one, liveness({ queued: omitted }))
      await nextTick()
      expect(read(m.q('exchange-state'))).toContain('limit unavailable')
      expect(read(m.all('queued-state')[0]!)).toContain('limit status unavailable')
      acceptLiveness(one, liveness({ queued: queue.map((q) => ({ ...q, holdReason: null })) }))
      await nextTick()
      expect(read(m.all('queued-state')[0]!)).toBe(
        label
          ? 'on its list as W1.2 · these words go when the turn ends'
          : 'not sent · waiting for the turn to end',
      )
      expect(m.all('queued-state').slice(1).map(read)).toEqual(
        Array(2).fill('not sent · waiting for the turn to end'),
      )
      expect(m.q('exchange-toggle').getAttribute('aria-description')).toBeNull()
      m.q('exchange-toggle').click()
      await nextTick()
      expect(m.all('exchange-state').map(read).join(' ')).not.toMatch(
        /Claude limit|Codex limit|limit unavailable|waiting for .*limit/,
      )
      expect(m.all('exchange-state').map(read).join(' ')).not.toContain('unavailable')
      if (answer) expect(m.all('exchange-state')).toHaveLength(0)
      else if (label) expect(read(m.q('exchange-state'))).toContain('on its list · words held')
    },
  )
})

describe('An ended message does not inherit a current live hold', () => {
  it.each([
    { reason: 'cancelled' as const, answer: false },
    { reason: 'abandoned' as const, answer: false },
    { reason: 'cancelled' as const, answer: true },
    { reason: 'abandoned' as const, answer: true },
  ])(
    '$reason, typed answer $answer: keeps the ending without a live hold',
    async ({ reason, answer }) => {
      const { m, one } = pane([
        {
          type: 'message_queued',
          messageId: 'ended-recipe',
          kind: 'work',
          relayedFrom: 'recipe-agent',
          relayedFromProfile: 'ayo',
          says: 'note',
          text: 'Recipe ending',
          ...(answer
            ? {
                answeredQuestion: {
                  requestId: 'ended-question',
                  answeredBy: 'recipe-agent',
                  answer: 'Use the recipe.',
                  clipped: true,
                },
              }
            : {}),
        },
        { type: 'message_unqueued', messageId: 'ended-recipe', reason, text: 'Recipe ending' },
      ])
      acceptLiveness(
        one,
        liveness({
          queued: [
            {
              id: 'ended-recipe',
              kind: 'work',
              text: 'Recipe ending',
              since: NOW,
              holdReasonStatus: 'current',
              holdReason: { is: 'provider-limit', provider: 'claude', resetsAt: NOW + 3600000 },
            },
          ],
        }),
      )
      await nextTick()
      if (answer) expect(m.all('answered-question')).toHaveLength(1)
      else expect(read(m.q('exchange-state'))).toContain(reason)
      expect(m.all('exchange-state').map(read).join(' ')).not.toMatch(
        /Claude limit|Codex limit|limit unavailable|waiting for .*limit/,
      )
      expect(m.q('exchange-toggle').getAttribute('aria-description')).toBeNull()
      m.q('exchange-toggle').click()
      await nextTick()
      expect(read(m.q('queued-state'))).not.toContain('limit')
      expect(m.q('queued-state').getAttribute('aria-description')).toBeNull()
      expect(m.all('answer-body-cut')).toHaveLength(0)
      if (answer) expect(read(m.q('exchange-state'))).toBe(BODY_WAS_CUT)
    },
  )
})

describe('A clipped typed answer keeps its hold and clock detail', () => {
  it('retains clipping through a ticking reset, then clears the hold in both opened and closed readings', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    const { m, one } = pane([
      {
        type: 'message_queued',
        messageId: 'clipped-recipe',
        kind: 'notice',
        relayedFrom: 'recipe-agent',
        relayedFromProfile: 'ayo',
        text: 'Original recipe notice',
        answeredQuestion: {
          requestId: 'clipped-question',
          answeredBy: 'recipe-agent',
          answer: 'Use the recipe.',
          clipped: true,
        },
      },
    ])
    const queue: QueuedMessageDisclosure = {
      id: 'clipped-recipe',
      kind: 'notice',
      text: 'Original recipe notice',
      since: NOW,
      holdReasonStatus: 'current',
      holdReason: { is: 'provider-limit', provider: 'claude', resetsAt: NOW + 10000 },
    }
    acceptLiveness(one, liveness({ queued: [queue] }))
    await nextTick()
    expect(read(m.q('exchange-state'))).toContain('Text cut')
    expect(m.q('exchange-state').title).toContain(BODY_WAS_CUT)
    expect(m.q('exchange-toggle').getAttribute('aria-description')).toContain(BODY_WAS_CUT)
    expect(read(m.q('exchange-state'))).toContain('Claude limit')
    expect(m.q('exchange-state').title).toContain('Reported reset:')
    expect(m.q('exchange-state').title).not.toContain('(passed)')
    await drawnReady()
    assertDrawn(m.q('exchange-state'), 'clipping and held words together', m.host)
    m.q('exchange-toggle').click()
    await nextTick()
    expect(read(m.q('queued-state'))).toContain('resets in')
    expect(read(m.q('answer-body-cut'))).toBe(BODY_WAS_CUT)
    expect(visible(m.q('answer-body-cut'))).toBe(true)
    await drawnReady()
    assertDrawn(m.q('answer-body-cut'), 'the full opened clipping explanation', m.host)
    // Cross the minute boundary after the reported reset, including starts near a rollover.
    await vi.advanceTimersByTimeAsync(120001)
    await nextTick()
    expect(read(m.q('exchange-state'))).toContain('Text cut')
    expect(m.q('exchange-state').title).toContain(BODY_WAS_CUT)
    expect(m.q('exchange-toggle').getAttribute('aria-description')).toContain(BODY_WAS_CUT)
    expect(read(m.q('exchange-state'))).toContain('Claude limit')
    expect(m.q('exchange-state').title).toContain('(passed)')
    expect(m.q('exchange-toggle').getAttribute('aria-description')).toContain('(passed)')
    expect(read(m.q('queued-state'))).toContain('waiting for Claude’s limit to reset')
    expect(read(m.q('queued-state'))).not.toContain('resets in')
    expect(m.q('queued-state').getAttribute('aria-description')).toContain('(passed)')
    m.q('exchange-toggle').click()
    await nextTick()
    expect(visible(m.q('answer-body-cut'))).toBe(false)
    m.q('exchange-toggle').click()
    await nextTick()
    expect(visible(m.q('answer-body-cut'))).toBe(true)
    acceptLiveness(one, liveness({ queued: [{ ...queue, holdReason: null }] }))
    await nextTick()
    expect(read(m.q('queued-state'))).toBe('not sent · waiting for the turn to end')
    expect(read(m.q('exchange-state'))).toBe(BODY_WAS_CUT)
    expect(m.all('answer-body-cut')).toHaveLength(0)
    expect(m.q('exchange-toggle').getAttribute('aria-description')).toBeNull()
    m.q('exchange-toggle').click()
    await nextTick()
    expect(read(m.q('exchange-state'))).toBe(BODY_WAS_CUT)
  })
})

describe('Complete compact held-word states', () => {
  it.each(['claude', 'codex'] as const)(
    '%s: accepted clipped answers retain every state word',
    async (provider) => {
      const { m, one } = pane(
        [
          ...questionFixture(),
          {
            type: 'message_queued',
            messageId: 'fit-recipe',
            kind: 'work',
            relayedFrom: 'recipe-agent',
            relayedFromProfile: 'ayo',
            text: 'Original recipe notice',
            answeredQuestion: {
              requestId: 'req_menu',
              answeredBy: 'recipe-agent',
              answer: 'Use the recipe.',
              clipped: true,
            },
          },
          {
            type: 'work_given',
            piece: 'work_recipe',
            parent: 'work_menu',
            label: 'W1.2',
            givenBy: 'recipe-agent',
            title: 'Recipe',
            brief: 'Original recipe notice',
            messageId: 'fit-recipe',
          },
        ],
        {},
        EXCHANGE_AT,
      )
      const inCard = (cy: string) => {
        const element = m.q('answered-question').querySelector<HTMLElement>(`[data-cy="${cy}"]`)
        expect(element, `the answered card contains ${cy}`).not.toBeNull()
        return element!
      }
      const queue: QueuedMessageDisclosure = {
        id: 'fit-recipe',
        kind: 'work',
        text: 'Original recipe notice',
        since: NOW,
        holdReasonStatus: 'current',
        holdReason: { is: 'provider-limit', provider, resetsAt: NOW + 3600000 },
      }
      const name = provider === 'claude' ? 'Claude' : 'Codex'
      for (const unavailable of [false, true]) {
        acceptLiveness(
          one,
          liveness({
            queued: [{ ...queue, holdReasonStatus: unavailable ? 'unavailable' : 'current' }],
          }),
        )
        await nextTick()
        await drawnReady()
        expect(read(inCard('exchange-state'))).toBe(
          `Text cut · on its list · words held · ${unavailable ? 'limit unavailable' : `${name} limit`}`,
        )
        assertDrawn(inCard('exchange-state'), 'the complete accepted clipped answer state', m.host)
        const heading = m.q('answered-question').querySelector<HTMLElement>('.exchange-heading')!
        expect(read(heading)).toContain('answer')
        expect(visible(heading)).toBe(true)
        assertDrawn(heading, 'the sender, receiver and answer kind', m.host)
        expect(read(inCard('exchange-preview'))).toBe('Use the recipe.')
        expect(visible(inCard('exchange-preview'))).toBe(true)
        assertDrawn(inCard('exchange-preview'), 'the identifying answer preview', m.host)
        expect(read(inCard('answer-question-link'))).toBe('Go to question')
        expect(visible(inCard('answer-question-link'))).toBe(true)
        assertDrawn(inCard('answer-question-link'), 'the loaded question link', m.host)
        const time = m.q('answered-question').querySelector<HTMLElement>('.exchange-time')!
        expect(read(time)).toBe(clockTime(EXCHANGE_AT))
        expect(time.title).toBe(fullTime(EXCHANGE_AT))
        expect(visible(time)).toBe(true)
        assertDrawn(time, 'the answer time beside its question link', m.host)
        expect(inCard('exchange-state').title).toContain(BODY_WAS_CUT)
        inCard('exchange-toggle').focus()
        expect(document.activeElement).toBe(inCard('exchange-toggle'))
        expect(inCard('exchange-toggle').getAttribute('aria-description')).toContain(BODY_WAS_CUT)
        inCard('exchange-toggle').click()
        await nextTick()
        expect(read(inCard('queued-state'))).toContain('on its list as W1.2 · these words are held')
        expect(read(inCard('answer-body-cut'))).toBe(BODY_WAS_CUT)
        expect(visible(inCard('answer-body-cut'))).toBe(true)
        await drawnReady()
        assertDrawn(inCard('answer-body-cut'), 'the full opened clipping explanation', m.host)
        expect(read(inCard('queued-state'))).toContain(
          unavailable ? 'limit status unavailable' : `waiting for ${name}’s limit to reset`,
        )
        inCard('exchange-toggle').click()
        await nextTick()
        expect(visible(inCard('answer-body-cut'))).toBe(false)
      }
      acceptLiveness(one, liveness({ queued: [{ ...queue, holdReason: null }] }))
      await nextTick()
      expect(read(inCard('exchange-state'))).toBe(BODY_WAS_CUT)
      expect(m.all('answer-body-cut')).toHaveLength(0)
      expect(inCard('exchange-toggle').getAttribute('aria-description')).toBeNull()
    },
  )
})

describe('A narrow rail folds facts even when AgentState is unchanged', () => {
  it('names the provider with a complete short reason and retains the full explanation', async () => {
    const row: ResumableSessionInfo = {
      provider: 'claude',
      sessionId: 'menu-rail',
      cwd: '/made-up/bakery',
      status: 'idle',
      state: { is: 'idle' },
      named: null,
      running: 'not-running',
      profileId: null,
      reasoningEffort: null,
      model: null,
      planMode: null,
      adoptedAt: null,
      hasTranscript: true,
      child: null,
      lastEnding: 'completed',
      updatedAt: NOW,
      approvalMode: 'ask',
      ref: { provider: 'claude', sessionId: 'menu-thread', cwd: '/made-up/bakery', rotation: 0 },
      resumeRefusal: null,
      ...CURRENT,
    }
    ;(window as { api?: unknown }).api = {
      runtime: { listResumable: async () => [row], listUnresumable: async () => [] },
    }
    const m = mount(
      SideRail,
      { open: [], activeId: null, place: null, onSelect: () => undefined },
      { width: 251.68, height: 900 },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    await drawnReady()
    const state = () => m.host.querySelector<HTMLElement>('#rail-state-menu-rail')!
    expect(state()).not.toBeNull()
    expect(read(state())).toContain('Claude limit')
    expect(state().title).toContain('Stopped: Claude’s limit')
    assertDrawn(
      m.q('rail-state-word-menu-rail'),
      'the provider limit reason in the narrow rail',
      m.host,
    )
    const opener = m.q('open-session-menu-rail')
    opener.focus()
    expect(document.activeElement).toBe(opener)
    expect(opener.getAttribute('aria-description')).toContain('Reported reset:')
    const push = async (facts: Partial<AgentStateMoved>, ordinary: AgentState = { is: 'idle' }) => {
      ;(m.vm.hearStates as (message: unknown) => void)({
        moved: [{ conversation: 'menu-rail', state: ordinary, ...facts }],
        kept: [],
      })
      await nextTick()
    }
    await push({})
    expect(read(state())).toContain('Claude limit')
    await push({ providerBlockStatus: 'unavailable' })
    expect(read(state())).toContain('Limit unavailable')
    await drawnReady()
    assertDrawn(
      m.q('rail-state-word-menu-rail'),
      'the unavailable reason in the narrow rail',
      m.host,
    )
    expect(read(state())).not.toContain('Claude limit')
    await push({ providerBlockStatus: 'current', providerBlock: null })
    expect(read(state())).toContain('idle')
    await push(CURRENT, { is: 'active' })
    expect(read(state())).toContain('active')
    expect(read(state())).not.toContain('limit')
  })
})

describe('Child chips carry the rail’s provider stop and its full explanation', () => {
  it.each(['claude', 'codex'] as const)(
    'reads %s current, unavailable and cleared words without changing the ordinary plate',
    async (provider) => {
      const cast = useWhoCalledWhom()
      const reading: WhoCalledWhom = {
        conversation: META.sessionId,
        parent: null,
        readAt: NOW,
        children: {
          walk: 'every-conversation-this-one-spawned',
          ledgers: 1,
          rowsUnread: 0,
          rows: [
            {
              conversation: 'menu-child',
              identity: 'worker',
              provider,
              running: 'not-running',
            },
          ],
        },
        workGivenOut: {
          walk: 'every-conversation-this-one-gave-work-to',
          ledgers: 0,
          rowsUnread: 0,
          rows: [],
        },
        workTakenIn: {
          walk: 'every-piece-of-work-this-one-was-given',
          ledgers: 0,
          rowsUnread: 0,
          rows: [],
        },
      }
      const providerWord = provider === 'claude' ? 'Claude' : 'Codex'
      const detail = `Stopped: ${providerWord}’s limit · Reported reset: tomorrow at 15:00`
      const rail = (word: string, explanation?: string) =>
        new Map<string, RailSays>([
          [
            'menu-child',
            {
              facets: facetsOfState({ is: 'idle' }),
              word,
              ...(explanation ? { detail: explanation } : {}),
            },
          ],
        ])
      cast.railSays.value = rail(`${providerWord} limit`, detail)
      const m = mount(
        WorkingTogether,
        {
          reading: { conversation: META.sessionId, read: reading, answered: true, atWork: null },
          conversation: META.sessionId,
          identities: null,
          canOpen: true,
          telemetry: new Map(),
        },
        { width: 400, height: 900 },
      )
      await nextTick()
      await drawnReady()
      const chip = m.host.querySelector<HTMLElement>('[data-conversation="menu-child"]')!
      const word = () => m.q('cast-tile-word-menu-child')
      expect(read(word())).toBe(`${providerWord} limit`)
      expect(word().title).toBe(detail)
      const name = chip.querySelector<HTMLElement>('.chip-name')!
      const profile = m.q('cast-tile-profile-menu-child')
      expect(read(profile)).toBe('worker')
      expect(visible(profile)).toBe(true)
      assertDrawn(profile, 'the retained child profile with its current reason', m.host)
      expect(read(name)).toBe('worker')
      expect(visible(name)).toBe(true)
      assertDrawn(name, 'the child name with its current limit reason', m.host)
      expect(lineCount(name)).toBe(1)
      expect(visible(word())).toBe(true)
      assertDrawn(word(), 'the complete current child reason', m.host)
      expect(lineCount(word())).toBeLessThanOrEqual(2)
      chip.focus()
      expect(document.activeElement).toBe(chip)
      expect(chip.getAttribute('aria-description')).toBe(detail)
      cast.railSays.value = rail('Limit unavailable', 'The current limit status could not be read.')
      await nextTick()
      expect(read(word())).toBe('Limit unavailable')
      await drawnReady()
      expect(visible(word())).toBe(true)
      assertDrawn(word(), 'the unavailable child reason', m.host)
      expect(lineCount(word())).toBeLessThanOrEqual(2)
      expect(read(name)).toBe('worker')
      expect(visible(name)).toBe(true)
      assertDrawn(name, 'the child name with its unavailable reason', m.host)
      expect(lineCount(name)).toBe(1)
      expect(read(profile)).toBe('worker')
      expect(visible(profile)).toBe(true)
      assertDrawn(profile, 'the retained child profile', m.host)
      expect(word().title).not.toContain('Stopped')
      cast.railSays.value = rail('idle')
      await nextTick()
      expect(read(word())).toBe('idle')
      expect(chip.getAttribute('aria-description')).toBeNull()
      await drawnReady()
      expect(visible(name)).toBe(true)
      expect(visible(word())).toBe(true)
      assertDrawn(name, 'the child name after its limit disclosure clears', m.host)
      assertDrawn(word(), 'the ordinary child state after its limit disclosure clears', m.host)
      expect(lineCount(name)).toBe(1)
      expect(lineCount(word())).toBe(1)
    },
  )
})

describe('An open rail record follows the latest folded channel fact', () => {
  it('a liveness unavailable or clear supersedes an earlier state push; a later state push updates the record', async () => {
    const one = reactive(record([]))
    one.meta = { ...META, ...CURRENT }
    const authority = createProviderBlockStore()
    authority.accept(one.sessionId, CURRENT)
    ;(window as { api?: unknown }).api = {
      runtime: { listResumable: async () => [], listUnresumable: async () => [] },
    }
    const m = mount(
      SideRail,
      {
        providerBlocks: authority,
        open: [one],
        activeId: one.sessionId,
        place: null,
        onSelect: () => undefined,
      },
      { width: 251.68, height: 900 },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    const state = () => m.host.querySelector<HTMLElement>(`#rail-state-${one.sessionId}`)!
    const stateWord = (word: string) =>
      expect(read(state())).toBe(
        ['claude', word, state().dataset.place].filter(Boolean).join(' · '),
      )
    // The runtime screen gives the same state push to the rail and the held record.
    const statePush = async (facts: Partial<AgentStateMoved>) => {
      ;(m.vm.hearStates as (message: unknown) => void)({
        moved: [{ conversation: one.sessionId, state: { is: 'idle' }, ...facts }],
        kept: [],
      })
      acceptProviderBlock(one, facts)
      authority.accept(one.sessionId, facts)
      await nextTick()
    }
    await statePush(CURRENT)
    stateWord('Claude limit')
    acceptLiveness(one, liveness({ providerBlockStatus: 'unavailable' }))
    authority.accept(one.sessionId, { providerBlockStatus: 'unavailable' })
    await nextTick()
    stateWord('Limit unavailable')
    acceptLiveness(one, liveness({ providerBlockStatus: 'current', providerBlock: null }))
    authority.accept(one.sessionId, { providerBlockStatus: 'current', providerBlock: null })
    await nextTick()
    stateWord('idle')
    await statePush(CURRENT)
    stateWord('Claude limit')
    acceptLiveness(one, liveness({}))
    await nextTick()
    stateWord('Claude limit')
  })
})
