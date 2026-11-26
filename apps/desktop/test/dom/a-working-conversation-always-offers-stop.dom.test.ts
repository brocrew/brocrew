import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import type { AgentState } from '../../src/shared/agent-state-contracts'
import type { SessionStatus } from '../../src/shared/runtime-ipc'
import { mount, paneProps, record, unmountAll } from './harness'

/**
 * 🔴 **The composer reads the same state as the header: a conversation the host calls active is never
 * drawn idle, and Stop is offered only where there is something to stop** (the 0.2.40 daily bug,
 * 26 Nov 04:11Z).
 *
 * ⛔ **What a person saw:** the header said *Active*, the transcript said *working…*, the right panel
 * said *active* — and the composer drew the idle send arrow with no Stop. ⚠️ **Two signals, one
 * screen**: the header, the plate and the rail draw the host's one state, and the composer decided
 * busy from this window's fold of the provider's status alone. The host names `active` from the moment
 * a message is on its way in, before the provider has said `working`.
 *
 * ⚑ **Why Stop is not simply offered then**: provider `interrupt` finds nothing to end before the
 * provider has started, and the delivery goes ahead — a dead control is worse than none. So in that
 * moment the composer is busy (it says the agent is working, takes a queued message, shows no idle send
 * arrow) and Stop appears the moment the provider is working or waiting. Stop for a pending delivery
 * would be a cancel of the delivery, its own card.
 *
 * ⚑ **Each reading is paired with its control one fact over.**
 */

afterEach(unmountAll)

function paneOf(
  status: SessionStatus,
  hostSays: AgentState | null,
  over: Record<string, unknown> = {},
) {
  const r = record([{ type: 'status', state: status } as never])
  if (hostSays !== null) r.agentState = hostSays
  return mount(ConversationPane, paneProps({ record: r, ...over }), { width: 1200 })
}

describe('a working conversation always offers Stop', () => {
  it('⚑ pinned: the provider says working, the host says active — Stop, and the header says Active', () => {
    const m = paneOf('working', { is: 'active' })
    expect(m.q('interrupt-session')).toBeTruthy()
    expect(m.q('session-status').textContent).toContain('Active')
  })

  it('🔴 the host says active before the provider has started: the composer is busy, not idle, and offers no dead Stop', () => {
    const asked: string[] = []
    const m = paneOf('idle', { is: 'active' }, { onInterrupt: () => asked.push('stop') })
    // ⚑ The premise, planted beside the claim: the header really does say Active over this record.
    expect(m.q('session-status').textContent).toContain('Active')
    expect(m.q('composer-hint').textContent).toContain('is working')
    // ⛔ Nothing exists to stop yet, and Escape is no different from the button.
    expect(m.all('interrupt-session')).toHaveLength(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(asked).toEqual([])
  })

  it('⚑ …and the moment the provider says working, Stop is there and asks the host', () => {
    const asked: string[] = []
    const m = paneOf('working', { is: 'active' }, { onInterrupt: () => asked.push('stop') })
    m.q('interrupt-session').click()
    expect(asked).toEqual(['stop'])
  })

  it('🔴 with a sendable draft nothing is a stop in disguise: Queue is offered, Stop and send is not, and the chord only queues', async () => {
    const sends: string[] = []
    const over = {
      draft: 'then this',
      onSend: (_words: string, intent: string) => sends.push(intent),
    }
    const chord = (m: ReturnType<typeof paneOf>): void =>
      void m.q('prompt-input').dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    const waiting = paneOf('idle', { is: 'active' }, over)
    expect(waiting.q('queue-prompt')).toBeTruthy()
    expect(waiting.all('interrupt-send-prompt')).toHaveLength(0)
    expect(waiting.all('stop-now')).toHaveLength(0)
    chord(waiting)
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sends).toEqual(['queue'])
    // ⚑ The control one fact over: with a turn to stop, the same chord interrupts, so the reading
    // above is the missing turn's.
    const running = paneOf('working', { is: 'active' }, over)
    expect(running.q('interrupt-send-prompt')).toBeTruthy()
    chord(running)
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sends).toEqual(['queue', 'interrupt'])
  })

  it('⚑ the control one fact over: the host says idle, so the composer is idle and offers no Stop', () => {
    const m = paneOf('idle', { is: 'idle' })
    expect(m.all('interrupt-session')).toHaveLength(0)
    expect(m.q('composer-hint').textContent).not.toContain('is working')
    expect(m.q('send-prompt'), 'positive: the idle composer really did render').toBeTruthy()
  })

  it('⚑ and a host that has named nothing yet leaves the composer to the provider status', () => {
    const m = paneOf('idle', null)
    expect(m.all('interrupt-session')).toHaveLength(0)
    expect(m.q('send-prompt'), 'positive: the idle composer really did render').toBeTruthy()
  })
})
