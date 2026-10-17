import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick, reactive } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import {
  interruptKeyLabel,
  sendKeyLabel,
} from '../../src/renderer/src/components/PromptComposer.vue'
import { isOnlyAStopWord } from '../../src/renderer/src/lib/a-stop-word'
import {
  acceptEvent,
  createSessionRecord,
  type SessionRecord,
} from '../../src/renderer/src/lib/session-record'
import type { CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { drawnReady } from './drawn'
import { META, mount, paneProps, unmountAll, visible, type Mounted } from './harness'

/**
 * A person who types "stop" while an agent works means stop, not "queue this word". While a turn
 * runs and the box has words, the composer shows both choices in words: queue it, or Stop and send.
 * A box holding only a stop word offers Stop now, which stops the turn and sends nothing; a held
 * stop word offers Stop now on its row, which asks the host to take the word back and stop the turn.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const AT = 1_700_000_000_000
const SEND_KEY = sendKeyLabel(navigator.platform)
const INTERRUPT_KEY = interruptKeyLabel(navigator.platform)

const started = { type: 'session', state: 'started', ref: META.ref } as TranscriptEvent
const asked = { type: 'user_turn', text: 'build the release' } as TranscriptEvent
const working = { type: 'status', state: 'working' } as TranscriptEvent

function feed(record: SessionRecord, event: TranscriptEvent): void {
  const ordinal = record.nextOrdinal
  acceptEvent(record, { sessionId: record.sessionId, ordinal, at: AT + ordinal * 1_000, event })
}

function conversation(
  events: TranscriptEvent[],
  meta: Partial<CreatedSession> = {},
): SessionRecord {
  const record = reactive(createSessionRecord('sess_1')) as SessionRecord
  record.meta = { ...META, ...meta }
  record.phase = 'open'
  for (const event of events) feed(record, event)
  return record
}

/** A running turn with the person's own message held behind it. */
function holding(words: string): SessionRecord {
  return conversation(
    [
      started,
      asked,
      working,
      { type: 'message_queued', messageId: 'q_1', kind: 'work', text: words } as TranscriptEvent,
    ],
    { queued: [{ kind: 'work', id: 'q_1', text: words, since: AT }] },
  )
}

interface Pressed {
  sends: { text: string; intent: string }[]
  interrupts: number
  cancelled: string[]
  stoppedFor: string[]
}

async function pane(
  record: SessionRecord,
  draft: string,
): Promise<{ m: Mounted; pressed: Pressed }> {
  await page.viewport(1180, 900)
  const pressed: Pressed = { sends: [], interrupts: 0, cancelled: [], stoppedFor: [] }
  const m = mount(
    ConversationPane,
    paneProps({
      record,
      cwd: '/work',
      draft,
      onSend: (text: string, intent: string) => pressed.sends.push({ text, intent }),
      onInterrupt: () => (pressed.interrupts += 1),
      onCancelQueued: (messageId: string) => pressed.cancelled.push(messageId),
      onStopQueued: (messageId: string) => pressed.stoppedFor.push(messageId),
    }),
    { width: 972, height: 900 },
  )
  await nextTick()
  await drawnReady()
  return { m, pressed }
}

const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

const press = async (el: HTMLElement): Promise<void> => {
  el.click()
  await nextTick()
  await drawnReady()
}

describe('which words are only a stop', () => {
  it('reads the stop words in any case, with or without accents and punctuation', () => {
    for (const words of [
      'stop',
      'Stop!',
      ' STOP. ',
      'arrête',
      'Arrete !',
      'pause',
      'wait...',
      'Attends',
    ])
      expect(isOnlyAStopWord(words), words).toBe(true)
  })

  it('reads nothing else as a stop', () => {
    for (const words of ['', 'stop the build after the tests', "don't stop", 'stopped', 'waiting'])
      expect(isOnlyAStopWord(words), words).toBe(false)
  })
})

describe('words in the box while an agent works', () => {
  it('shows the queue choice and Stop and send, with its shortcut, side by side', async () => {
    const { m, pressed } = await pane(
      conversation([started, asked, working]),
      'look at the tests first',
    )
    expect(visible(m.q('queue-prompt'))).toBe(true)
    expect(text(m.q('queue-prompt'))).toBe(`Queue ${SEND_KEY}`)
    const stopAndSend = m.q('interrupt-send-prompt')
    expect(visible(stopAndSend)).toBe(true)
    expect(text(stopAndSend)).toBe(`Stop and send ${INTERRUPT_KEY}`)
    expect(m.all('stop-now')).toEqual([])

    await press(stopAndSend)
    expect(pressed.sends).toEqual([{ text: 'look at the tests first', intent: 'interrupt' }])
    expect(pressed.interrupts).toBe(0)
  })
})

describe('a box holding only a stop word', () => {
  it('offers Stop now, which stops the turn, sends nothing and keeps the word in the box', async () => {
    const { m, pressed } = await pane(conversation([started, asked, working]), 'Stop!')
    const stopNow = m.q('stop-now')
    expect(visible(stopNow)).toBe(true)
    expect(text(stopNow)).toBe('Stop now')
    expect(m.all('interrupt-send-prompt')).toEqual([])
    expect(visible(m.q('queue-prompt'))).toBe(true)

    await press(stopNow)
    expect(pressed.interrupts).toBe(1)
    expect(pressed.sends).toEqual([])
    expect((m.q('prompt-input') as HTMLTextAreaElement).value).toBe('Stop!')
  })

  it('a stop word in the box of an idle conversation is just a message to send', async () => {
    const { m } = await pane(conversation([started]), 'stop')
    expect(m.all('stop-now')).toEqual([])
    expect(visible(m.q('send-prompt'))).toBe(true)
  })
})

describe('a held message that is only a stop word', () => {
  it('offers Stop now beside Cancel it: one ask to take the word back and stop the turn', async () => {
    const { m, pressed } = await pane(holding('stop'), '')
    const stopNow = m.q('stop-queued')
    expect(visible(stopNow)).toBe(true)
    expect(text(stopNow)).toBe('Stop now')
    expect(visible(m.q('cancel-queued'))).toBe(true)
    expect(stopNow.parentElement).toBe(m.q('cancel-queued').parentElement)

    await press(stopNow)
    // One host call does both, so no flush can send the word between a take-back and a stop.
    expect(pressed.stoppedFor).toEqual(['q_1'])
    expect(pressed.cancelled).toEqual([])
    expect(pressed.interrupts).toBe(0)
    expect(pressed.sends).toEqual([])
  })

  it('a held message with other words keeps only Cancel it', async () => {
    const { m } = await pane(holding('and then run the tests'), '')
    expect(m.all('stop-queued')).toEqual([])
    expect(visible(m.q('cancel-queued'))).toBe(true)
  })
})
