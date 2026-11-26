import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { AgentState } from '../../src/shared/agent-state-contracts'
import type { SessionStatus } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll } from './harness'

/**
 * A conversation started by a delivery runs with no window. A person's window shows it from its ledger
 * (`phase: 'recorded'`), and a message from there goes in without taking it over. While the host says
 * it is Active, the composer reads busy and offers Stop once the provider works; the host takes that
 * Stop from a window that does not hold the conversation. Stop and send is not offered there: the
 * message goes in through `startAndSend`, which stops nothing.
 *
 * Such a view's page is refreshed by looking again when its row changes, so Stop can appear or go one
 * refresh late.
 *
 * The 0.2.40 report: the header said Active and the transcript said working…, while the composer
 * drew the idle send arrow with no Stop.
 */

afterEach(unmountAll)

function shownFromItsLedger(
  status: SessionStatus,
  hostSays: AgentState | null,
  over: Record<string, unknown> = {},
) {
  const r = record([{ type: 'status', state: status } as never])
  // Running with no window: a recorded hand-over with no `liveFrom`, and a message from here is taken.
  r.meta = { ...r.meta!, handover: 'recorded', cannotTakeAMessage: null } as never
  r.phase = 'recorded'
  // The header of a view drawn from its ledger draws its row's state in the one list.
  return mount(ConversationPane, paneProps({ record: r, listedState: hostSays, ...over }), {
    width: 1200,
  })
}

const chord = (m: ReturnType<typeof shownFromItsLedger>): void =>
  void m.q('prompt-input').dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )

describe('a conversation running without this window offers Stop', () => {
  it('🔴 working, Active, shown from its ledger: working… and Stop, and Stop asks the host', () => {
    const asked: string[] = []
    const m = shownFromItsLedger(
      'working',
      { is: 'active' },
      { onInterrupt: () => asked.push('stop') },
    )
    expect(m.q('session-status').textContent).toContain('Active')
    expect(m.q('transcript-working'), 'the premise: the transcript says working…').toBeTruthy()
    expect(m.q('composer-hint').textContent).toContain('is working')
    m.q('interrupt-session').click()
    expect(asked).toEqual(['stop'])
  })

  it('⚑ the state published for the record itself counts the same as its row', () => {
    const asked: string[] = []
    const r = record([{ type: 'status', state: 'working' } as never])
    r.meta = { ...r.meta!, handover: 'recorded', cannotTakeAMessage: null } as never
    r.phase = 'recorded'
    r.agentState = { is: 'active' }
    const published = mount(
      ConversationPane,
      paneProps({ record: r, onInterrupt: () => asked.push('stop') }),
      { width: 1200 },
    )
    expect(published.q('session-status').textContent).toContain('Active')
    published.q('interrupt-session').click()
    expect(asked).toEqual(['stop'])
  })

  it('⚑ Escape is the same Stop', () => {
    const asked: string[] = []
    shownFromItsLedger('working', { is: 'active' }, { onInterrupt: () => asked.push('stop') })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(asked).toEqual(['stop'])
  })

  it('🔴 with a draft it offers Queue and no Stop and send, and the chord only queues', async () => {
    const sends: string[] = []
    const m = shownFromItsLedger(
      'working',
      { is: 'active' },
      { draft: 'then this', onSend: (_words: string, intent: string) => sends.push(intent) },
    )
    expect(m.q('queue-prompt')).toBeTruthy()
    expect(m.all('interrupt-send-prompt')).toHaveLength(0)
    chord(m)
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sends).toEqual(['queue'])
  })

  it('⚑ Active before the provider has started: busy, and no Stop yet', () => {
    const asked: string[] = []
    const m = shownFromItsLedger(
      'idle',
      { is: 'active' },
      { onInterrupt: () => asked.push('stop') },
    )
    expect(m.q('composer-hint').textContent).toContain('is working')
    expect(m.all('interrupt-session')).toHaveLength(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(asked).toEqual([])
  })

  it('🔴 a page that ended or failed under a newer Active: busy, and no Stop until the page shows a turn', () => {
    for (const status of ['ended', 'errored'] as const) {
      const asked: string[] = []
      const m = shownFromItsLedger(
        status,
        { is: 'active' },
        { onInterrupt: () => asked.push('stop') },
      )
      expect(m.q('composer-hint').textContent, status).toContain('is working')
      expect(m.all('interrupt-session'), status).toHaveLength(0)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(asked, status).toEqual([])
      m.unmount()
    }
  })

  it('⚑ a page waiting on a person under Active: Stop, and it asks the host', () => {
    const asked: string[] = []
    const m = shownFromItsLedger(
      'waiting_permission',
      { is: 'active' },
      { onInterrupt: () => asked.push('stop') },
    )
    m.q('interrupt-session').click()
    expect(asked).toEqual(['stop'])
  })

  it('⚑ a message from this view starting it keeps the start’s Stop, whatever the page says', () => {
    const asked: string[] = []
    const m = shownFromItsLedger(
      'ended',
      { is: 'active' },
      { launching: true, onInterrupt: () => asked.push('stop') },
    )
    m.q('interrupt-session').click()
    expect(asked).toEqual(['stop'])
  })

  it('⚑ the control one fact over: a ledger view the host does not call Active is idle, whatever its page last said', () => {
    for (const hostSays of [{ is: 'idle' } as AgentState, null]) {
      const m = shownFromItsLedger('working', hostSays)
      expect(m.all('interrupt-session')).toHaveLength(0)
      expect(m.q('composer-hint').textContent).not.toContain('is working')
      expect(m.q('send-prompt'), 'positive: the idle composer really did render').toBeTruthy()
      m.unmount()
    }
  })
})
