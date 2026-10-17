import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  acceptEvent,
  acceptLiveness,
  adoptSession,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import type { SessionLiveness, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * While the model thinks in silence, the end of the conversation says so in one line whose count
 * moves: "Still thinking (2 min).", then 3, then 4. The runtime's own notice draws no row, the line
 * goes when the silence ends, and a window opened later counts from when the silence began.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const MIN = 60_000
const START = Date.UTC(2026, 9, 13, 12, 0, 0)

afterEach(async () => {
  unmountAll()
  vi.useRealTimers()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const started = { type: 'session', state: 'started', ref: META.ref } as TranscriptEvent
const asked = { type: 'user_turn', text: 'think it over' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent
const thought = { type: 'thinking', phase: 'delta', text: 'weighing it' } as TranscriptEvent
const runtimesNotice = {
  type: 'error',
  fatal: false,
  message: 'Still thinking (2 min).',
  stall: true,
  thinking: true,
} as TranscriptEvent

/** Silent since `since`, after the model's reasoning, as main says it. */
const thinkingSince = (since: number): SessionLiveness => ({
  state: 'silent',
  since,
  detail: 'Still thinking (2 min).',
  thinking: true,
})

/** The turn at work, through the one door, once the conversation is described. */
function feedTheTurn(record: SessionRecord): void {
  for (const event of [started, asked, working, thought]) {
    const ordinal = record.nextOrdinal
    acceptEvent(record, { sessionId: 'sess_1', ordinal, at: START + ordinal, event })
  }
}

function conversation(liveness: SessionLiveness): SessionRecord {
  const record = reactive(createSessionRecord('sess_1')) as SessionRecord
  record.meta = { ...META, liveness }
  record.phase = 'open'
  for (const event of [started, asked, working, thought, runtimesNotice]) {
    const ordinal = record.nextOrdinal
    acceptEvent(record, { sessionId: 'sess_1', ordinal, at: START + ordinal, event })
  }
  return record
}

async function pane(record: SessionRecord): Promise<Mounted> {
  await page.viewport(1180, 900)
  const m = mount(ConversationPane, paneProps({ record, cwd: '/work' }), {
    width: 972,
    height: 900,
  })
  await nextTick()
  await drawnReady()
  return m
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const lines = (m: Mounted): string[] => m.all('transcript-still-thinking').map(text)
const saysStillThinking = (m: Mounted): number =>
  (m.host.textContent ?? '').split('Still thinking (').length - 1

const minutes = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
  await nextTick()
}

describe('the thinking line counts in place', () => {
  it('moves from 2 to 3 to 4 min as one line, with no row and no working line beside it', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(START + 2 * MIN)
    const m = await pane(conversation(thinkingSince(START)))

    expect(lines(m)).toEqual(['Still thinking (2 min).'])
    expect(visible(m.q('transcript-still-thinking'))).toBe(true)
    expect(m.all('transcript-working')).toEqual([])
    // The line at the end, and the header's line under the bar: no transcript row says it.
    expect(text(m.host.querySelector('.liveness-detail')!)).toBe('Still thinking (2 min).')
    expect(saysStillThinking(m)).toBe(2)

    await minutes(MIN - 1)
    expect(lines(m)).toEqual(['Still thinking (2 min).'])
    await minutes(1)
    expect(lines(m)).toEqual(['Still thinking (3 min).'])
    expect(text(m.host.querySelector('.liveness-detail')!)).toBe('Still thinking (3 min).')
    await minutes(MIN)
    expect(lines(m)).toEqual(['Still thinking (4 min).'])
    expect(saysStillThinking(m)).toBe(2)
  })

  it('is gone when the silence ends, and leaves nothing behind', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(START + 3 * MIN)
    const record = conversation(thinkingSince(START))
    const m = await pane(record)
    expect(lines(m)).toEqual(['Still thinking (3 min).'])

    acceptLiveness(record, { state: 'live', since: Date.now() })
    await minutes(0)
    expect(lines(m)).toEqual([])
    expect(saysStillThinking(m)).toBe(0)
    await minutes(5 * MIN)
    expect(saysStillThinking(m)).toBe(0)
  })

  it('a window opened later counts from when the silence began', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(START + 5 * MIN + 30_000)
    const m = await pane(conversation(thinkingSince(START)))
    expect(lines(m)).toEqual(['Still thinking (5 min).'])
    await minutes(30_000)
    expect(lines(m)).toEqual(['Still thinking (6 min).'])
  })

  it('a silence after anything but reasoning draws no thinking line, and keeps the host’s words', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(START + 2 * MIN)
    const quiet: SessionLiveness = {
      state: 'silent',
      since: START,
      detail:
        'no activity for 120s — the provider may be busy, rate-limited, or stalled; you can interrupt',
    }
    const m = await pane(conversation(quiet))
    expect(lines(m)).toEqual([])
    expect(text(m.host.querySelector('.liveness-detail')!)).toMatch(/^no activity for 120s/)
  })

  it('a thinking silence that ended before the conversation was described leaves no thinking line', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(START + 6 * MIN)
    const record = reactive(createSessionRecord('sess_1')) as SessionRecord
    record.phase = 'opening'
    // Three packets before the host has described the conversation: thinking, live, then a
    // silence after something else.
    acceptLiveness(record, thinkingSince(START))
    acceptLiveness(record, { state: 'live', since: START + 3 * MIN })
    const generic =
      'no activity for 120s — the provider may be busy, rate-limited, or stalled; you can interrupt'
    acceptLiveness(record, { state: 'silent', since: START + 4 * MIN, detail: generic })
    adoptSession(record, { ...META, liveness: { state: 'live', since: START } })
    feedTheTurn(record)
    const m = await pane(record)

    expect(record.meta?.liveness.thinking).toBeUndefined()
    expect(lines(m)).toEqual([])
    expect(saysStillThinking(m)).toBe(0)
    expect(text(m.host.querySelector('.liveness-detail')!)).toBe(generic)

    // One fact over: a thinking silence still standing at adoption is counted.
    const thinking = reactive(createSessionRecord('sess_1')) as SessionRecord
    thinking.phase = 'opening'
    acceptLiveness(thinking, { state: 'live', since: START })
    acceptLiveness(thinking, thinkingSince(START + 2 * MIN))
    adoptSession(thinking, { ...META, liveness: { state: 'live', since: START } })
    feedTheTurn(thinking)
    unmountAll()
    const n = await pane(thinking)
    expect(lines(n)).toEqual(['Still thinking (4 min).'])
  })
})
