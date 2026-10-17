import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import type { AgentState } from '../../src/shared/agent-state'
import {
  type ResumedSession,
  type RuntimeBridge,
  type RuntimeEventMessage,
  type ScheduledJob,
} from '../../src/shared/runtime-ipc'
import { readLocalTimeFrom } from '../../src/shared/local-time'
import { META, mount, paneProps, unmountAll, visible } from './harness'
import { drawnReady } from './drawn'
import { SCHEDULE_NOW, scheduledJobStartReasonsFixture } from './scheduled-job-summary.fixture'

const stores: SessionStore[] = []
const sessionId = 'sess_synthetic_stopped_schedule'

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(SCHEDULE_NOW)
  readLocalTimeFrom(() => ({ before: 0, changes: [], rule: null }))
})

afterEach(() => {
  unmountAll()
  for (const store of stores.splice(0)) store.dispose()
  vi.restoreAllMocks()
  readLocalTimeFrom(() => null)
})

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('a stopped conversation receives its current scheduled level in the open Agent panel', () => {
  it('a host-written level refreshes the recorded pane without starting it and draws all four reasons', async () => {
    let listener: ((message: RuntimeEventMessage) => void) | null = null
    const entries: RuntimeEventMessage[] = [
      { sessionId, ordinal: 0, at: SCHEDULE_NOW, event: { type: 'status', state: 'ended' } },
    ]
    const calls: string[] = []
    const store = createSessionStore({
      onEvent: (accept: (message: RuntimeEventMessage) => void) => {
        listener = accept
        return () => {
          listener = null
        }
      },
      onLiveness: () => () => {},
      look: async () => {
        calls.push('look')
        const handed: ResumedSession = {
          ...META,
          sessionId,
          handover: 'recorded',
          history: {
            entries: structuredClone(entries),
            from: 0,
            hasOlder: false,
            turnAligned: true,
          },
          liveFrom: entries.length,
        }
        return handed
      },
      create: async () => {
        throw new Error('Drawing a schedule must not create a conversation')
      },
      resume: async () => {
        throw new Error('Drawing a schedule must not start a conversation')
      },
      send: async () => {
        throw new Error('Drawing a schedule must not send a message')
      },
    } as unknown as RuntimeBridge)
    stores.push(store)
    expect(await store.look(sessionId)).toBe(sessionId)
    const record = store.get(sessionId)!
    expect(record.phase).toBe('recorded')
    expect(store.isLive(sessionId)).toBe(false)
    const listed = ref<AgentState>({ is: 'idle' })
    const m = mount(
      defineComponent({
        setup: () => () =>
          h(
            ConversationPane as Component,
            paneProps({
              record,
              listedState: listed.value,
              drawerOpen: true,
              drawerTab: 'open',
              ownAgent: 'Bakery',
              identities: null,
            }),
          ),
      }),
      {},
      { width: 1200, height: 840 },
    )
    await settle()
    expect(m.host.querySelector('[data-cy="schedule-bar"]')).toBeNull()

    async function publish(jobs: readonly ScheduledJob[]): Promise<void> {
      const message: RuntimeEventMessage = {
        sessionId,
        ordinal: entries.length,
        at: SCHEDULE_NOW + entries.length,
        event: { type: 'scheduled_work', source: 'app/receipts', jobs: [...jobs] },
      }
      entries.push(message)
      const receive = listener
      if (!receive) throw new Error('The session store did not subscribe to the host events')
      receive(message)
      await settle()
    }

    const jobs = scheduledJobStartReasonsFixture().jobs
    await publish(jobs)
    expect(calls).toEqual(['look', 'look'])
    expect(store.get(sessionId)).toBe(record)
    expect(record.phase).toBe('recorded')
    expect(store.isLive(sessionId)).toBe(false)
    expect(record.transcript.schedule.jobs).toEqual(
      jobs.map((job) => ({ ...job, listedSince: SCHEDULE_NOW + 1 })),
    )
    expect(visible(m.q('schedule-bar'))).toBe(true)
    const fold = m.q('schedule-fold')
    if (fold.getAttribute('aria-expanded') === 'false') fold.click()
    await settle()
    for (const [id, words] of [
      ['listed-recipes', 'Not started automatically: time unknown'],
      ['unlisted-bakery', 'No longer started automatically: no update'],
      ['reset-pantry', 'Not started automatically: no update since reset'],
      ['history-bakery', 'Not started automatically: history incomplete'],
    ]) {
      expect(visible(m.q(`schedule-not-started-${id}`))).toBe(true)
      expect(m.q(`schedule-not-started-${id}`).textContent).toBe('not started')
      expect(m.q(`schedule-open-${id}`).getAttribute('aria-label')).toContain(words)
    }
    expect(m.host.querySelector('[data-cy="schedule-next-history-bakery"]')).toBeNull()
    expect(m.q('schedule-asks-ordinary').textContent).toBe('Check the fictional pantry.')
    m.q('schedule-open-history-bakery').click()
    await settle()
    const prompt = document.querySelector('[data-cy="scheduled-job-prompt"]')
    expect(prompt?.textContent).toBe('Read the fictional bakery ledger.')
    expect(document.querySelector('[data-cy="scheduled-job-not-started"]')?.textContent).toContain(
      'without a known run time',
    )
    document.querySelector<HTMLElement>('[data-cy="close-scheduled-job"]')!.click()
    await settle()

    listed.value = { is: 'scheduled', dueAt: SCHEDULE_NOW + 10 * 60_000 }
    await publish([
      {
        id: 'history-bakery',
        prompt: 'A fresh provider copy',
        nominalAt: SCHEDULE_NOW + 10 * 60_000,
        recurring: true,
      },
    ])
    await drawnReady()
    expect(calls).toEqual(['look', 'look', 'look'])
    expect(m.host.querySelector('[data-cy="schedule-not-started-history-bakery"]')).toBeNull()
    expect(m.q('schedule-asks-history-bakery').textContent).toBe('A fresh provider copy')
    expect(visible(m.q('schedule-next-history-bakery'))).toBe(true)
    expect(store.isLive(sessionId)).toBe(false)
    await publish([])
    expect(m.host.querySelector('[data-cy="schedule-bar"]')).toBeNull()
    expect(record.transcript.schedule.jobs).toEqual([])
    expect(store.isLive(sessionId)).toBe(false)
  })
})
