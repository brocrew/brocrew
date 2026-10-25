import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { panelWords } from '../src/renderer/src/lib/latest-words'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'
import { acceptEvent, createSessionRecord, openWindow, reopenAtLatest } from '../src/renderer/src/lib/session-record'

const human = (text: string): TranscriptEvent => ({ type: 'user_turn', text, humanInitiated: true })
const app = (text: string): TranscriptEvent => ({ type: 'user_turn', text, attribution: 'app_authored' })
const final = (text: string): TranscriptEvent => ({ type: 'assistant_message', text, phase: 'final' })
const ended: TranscriptEvent = { type: 'turn', state: 'completed' }
function fold(events: TranscriptEvent[]) {
  const state = createTranscript()
  events.forEach((event, ordinal) => applyEvent(state, event, ordinal + 1000, ordinal))
  return state
}

describe('human turns keep their own final answers', () => {
  it('pins a human final across app, agent and provider turns while keeping all history', () => {
    const state = fold([
      human('First question'), { type: 'assistant_message', text: 'Working', phase: 'commentary' },
      final('**First answer**'), ended, app('App notification'), final('App answer'), ended,
      { type: 'user_turn', text: 'Agent question', attribution: 'app_authored', relayedFrom: 'sess_other' },
      final('Agent answer'), ended, { type: 'provider_turn' }, final('Background answer'), ended,
    ])
    expect(panelWords(state)?.text).toBe('First answer')
    expect(state.humanAnswers.latest?.prompt).toBe('First question')
    expect(state.items.filter((item) => item.kind === 'assistant' && item.humanFinal).map((item) => item.text)).toEqual(['**First answer**'])
    expect(state.items.filter((item) => item.kind === 'assistant')).toHaveLength(5)
  })

  it('changes to each new human turn; pending/interrupted without final uses the existing response', () => {
    const state = fold([human('Q1'), final('A1'), ended, human('Q2'),
      { type: 'assistant_message', text: 'Q2 progress', phase: 'commentary' },
      { type: 'turn', state: 'interrupted' }, app('Later app'), final('Latest response'), ended])
    expect(state.humanAnswers.latest).toMatchObject({ prompt: 'Q2', final: null })
    expect(panelWords(state)?.text).toBe('Latest response')
    applyEvent(state, human('Q3'), 1010, 10)
    applyEvent(state, final('A3'), 1011, 11)
    expect(panelWords(state)?.text).toBe('A3')
    expect(state.humanAnswers.latest?.prompt).toBe('Q3')
    expect(state.items.filter((item) => item.kind === 'assistant' && item.humanFinal).map((item) => item.text)).toEqual(['A1', 'A3'])
  })

  it('does not invent finality or human authorship for legacy, imported or child messages', () => {
    const state = fold([
      { type: 'user_turn', text: 'Old unmarked words' }, final('Legacy final'), ended,
      { ...human('Imported'), attribution: 'provider_transcript' }, final('Imported answer'), ended,
      human('Current'), { type: 'assistant_message', text: 'A completed block' },
      { ...final('Child answer'), parentToolCallId: 'child-tool' }, ended, app('Notification'), final('Late message'),
    ])
    expect(state.humanAnswers.latest).toMatchObject({ prompt: 'Current', final: null })
    expect(panelWords(state)?.text).toBe('Late message')
    expect(state.items.some((item) => item.kind === 'assistant' && item.humanFinal)).toBe(false)
  })

  it('does not fall back to an older verified human final across a later unproven legacy prompt', () => {
    const state = fold([human('Known question'), final('Known answer'), ended,
      { type: 'user_turn', text: 'Legacy prompt without observation' }, final('Latest legacy response')])
    expect(state.humanAnswers.latest).toBeNull()
    expect(panelWords(state)?.text).toBe('Latest legacy response')
  })

  it('pairs only the human parts of a batched turn, retaining exact Markdown', () => {
    const state = fold([{ type: 'user_turn', text: 'joined transport', humanInitiated: true, parts: [
      { text: 'App words', attribution: 'app_authored' },
      { text: 'My **question**', humanInitiated: true },
      { text: 'Agent words', attribution: 'app_authored', relayedFrom: 'sess_other' },
      { text: 'More `detail`', humanInitiated: true },
    ] }, final('## Answer\n\n```js\nconst ok = true\n```')])
    expect(state.humanAnswers.latest?.prompt).toBe('My **question**\n\nMore `detail`')
    expect(state.humanAnswers.latest?.final?.text).toContain('```js')
  })

  it('reconciles streamed final text into the same highlighted item', () => {
    const state = fold([human('Q'), { type: 'assistant_delta', text: 'partial' }, final('Whole answer')])
    expect(state.items.filter((item) => item.kind === 'assistant')).toEqual([
      expect.objectContaining({ text: 'Whole answer', streaming: false, humanFinal: true }),
    ])
  })

  it('keeps the pair when a bounded window drops its opening and through a cold history reload', () => {
    const initial = fold([human('Q outside page'), final('A outside page'), ended])
    const messages = [app('Later app'), final('App response'), ended].map((event, i) => ({ sessionId: 's', event, ordinal: i + 40, at: i + 2000 }))
    const carried = foldWindow(messages, null, carryForward(initial, messages))
    expect(panelWords(carried)?.text).toBe('A outside page')
    const record = createSessionRecord('s')
    const page = { entries: messages, from: 40, hasOlder: true, turnAligned: true, humanAnswers: initial.humanAnswers }
    openWindow(record, page)
    messages.forEach((message) => acceptEvent(record, message))
    expect(panelWords(record.control)?.text).toBe('A outside page')
    reopenAtLatest(record, page)
    expect(record.control.humanAnswers.latest?.prompt).toBe('Q outside page')
    expect(panelWords(record.control)?.text).toBe('A outside page')
  })
})
