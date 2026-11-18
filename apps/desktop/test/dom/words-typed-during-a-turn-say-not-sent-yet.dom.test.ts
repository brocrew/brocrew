import type { TranscriptEvent } from '../../src/shared/conversation-events'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import { agentName } from '../../src/shared/runtime-ipc'
import { assertDrawn, drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * Words typed while the agent works are not sent until Queue or Stop and send is pressed. The foot
 * says so in one short line, Queue is the one filled button, and Stop and send is a quiet link.
 */

afterEach(unmountAll)

const WHO = agentName(META.profileId, null)
const NOT_SENT = `Not sent yet · Queue sends it when ${WHO} finishes`

function conversation(events: TranscriptEvent[], meta = {}): SessionRecord {
  const record = reactive(createSessionRecord('sess_1')) as SessionRecord
  record.meta = { ...META, ...meta }
  record.phase = 'open'
  events.forEach((event, ordinal) =>
    acceptEvent(record, { sessionId: 'sess_1', ordinal, at: 1_700_000_000_000 + ordinal, event }),
  )
  return record
}

const running = (): SessionRecord =>
  conversation([
    { type: 'user_turn', text: 'count to sixty, slowly' } as TranscriptEvent,
    { type: 'status', state: 'working' } as TranscriptEvent,
  ])

async function pane(
  record: SessionRecord,
  draft: string,
  over: Record<string, unknown> = {},
): Promise<Mounted> {
  await page.viewport(1000, 800)
  const m = mount(ConversationPane, paneProps({ record, draft, ...over }), {
    width: 1000,
    height: 800,
  })
  await nextTick()
  await drawnReady()
  return m
}

const words = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('words typed while the agent works', () => {
  it('the foot says they are not sent yet, in one line drawn whole', async () => {
    const m = await pane(running(), 'and then run the tests')
    const foot = m.q('composer-hint')
    expect(words(foot)).toBe(NOT_SENT)
    expect(visible(foot)).toBe(true)
    assertDrawn(foot, 'the not-sent-yet line', m.host)
  })

  it('the same line while another message already waits', async () => {
    const text = 'and then run the tests'
    const record = conversation(
      [
        { type: 'user_turn', text: 'count to sixty, slowly' } as TranscriptEvent,
        { type: 'status', state: 'working' } as TranscriptEvent,
        { type: 'message_queued', messageId: 'q_1', kind: 'work', text } as TranscriptEvent,
      ],
      { queued: [{ kind: 'work', id: 'q_1', text, since: 1_700_000_000_000 }] },
    )
    const m = await pane(record, 'one more thing')
    expect(m.all('queued-entry')).toHaveLength(1)
    expect(words(m.q('composer-hint'))).toBe(NOT_SENT)
  })

  it('with an empty box the foot does not say it', async () => {
    const m = await pane(running(), '')
    expect(words(m.q('composer-hint'))).not.toContain('Not sent yet')
    expect(m.all('queue-prompt')).toEqual([])
  })

  it('Queue is the filled button and Stop and send is a quiet link that still sends', async () => {
    const sends: { text: string; intent: string }[] = []
    const m = await pane(running(), 'and then run the tests', {
      onSend: (text: string, intent: string) => sends.push({ text, intent }),
    })
    const queue = getComputedStyle(m.q('queue-prompt'))
    const stopAndSend = m.q('interrupt-send-prompt')
    const quiet = getComputedStyle(stopAndSend)

    expect(queue.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(quiet.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(quiet.borderTopWidth).toBe('0px')
    expect(Number(quiet.fontWeight)).toBeLessThan(Number(queue.fontWeight))
    expect(quiet.textDecorationLine).toBe('underline')
    expect(words(stopAndSend)).toBe('Stop and send')
    expect(visible(stopAndSend)).toBe(true)
    assertDrawn(stopAndSend, 'the quiet Stop and send', m.host)

    stopAndSend.click()
    await nextTick()
    expect(sends).toEqual([{ text: 'and then run the tests', intent: 'interrupt' }])
  })
})
