import { describe, expect, it } from 'vitest'
import type { RuntimeEvent, SessionRef } from '@brobot2/runtime'
import { applyEvent, appendUserMessage, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn, visibleItems } from '../src/renderer/src/lib/transcript-mode'
import type { TranscriptItem } from '../src/renderer/src/lib/transcript'

const ref: SessionRef = {
  provider: 'claude',
  sessionId: 'sess-abc',
  cwd: '/tmp/scratch',
  rotation: 0,
}

const scope = {
  cwd: '/tmp/scratch',
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

/** A realistic session: conversation, tool work, a card, chatter, lifecycle and a failure. */
function realisticTranscript() {
  const state = createTranscript()
  const feed = (...events: RuntimeEvent[]) => events.forEach((e) => applyEvent(state, e))

  feed({ type: 'session', state: 'started', ref }) // notice · info
  appendUserMessage(state, 'do the thing')
  feed(
    { type: 'unknown', provider: 'claude', category: 'reasoning', raw: {} },
    { type: 'unknown', provider: 'claude', category: 'lifecycle', label: 'message_start', raw: {} },
    { type: 'assistant_message', text: 'on it' },
    { type: 'tool_call', id: 't1', name: 'Bash', summary: 'ls' },
    { type: 'permission_request', id: 'p1', kind: 'command', action: 'Bash', detail: 'ls', scope },
    { type: 'tool_result', id: 't1', summary: 'ok', ok: true },
    { type: 'error', message: 'claude is retrying after an API error', fatal: false }, // notice · warn
    { type: 'unknown', provider: 'claude', category: 'unrecognized', raw: { surprise: true } },
    { type: 'turn', state: 'completed' }, // notice · info
    { type: 'error', message: 'the provider died', fatal: true }, // notice · error
  )
  return state
}

const kindsOf = (items: TranscriptItem[]) => items.map((item) => item.kind)

describe('transcript mode', () => {
  it('normal keeps the conversation: messages, tools and the cards waiting on you', () => {
    const shown = visibleItems(realisticTranscript().items)

    expect(kindsOf(shown)).toContain('user')
    expect(kindsOf(shown)).toContain('assistant')
    expect(kindsOf(shown)).toContain('tool')
    expect(kindsOf(shown)).toContain('permission')
  })

  it('normal is a filter, not a reordering or a rewrite', () => {
    const items = realisticTranscript().items
    const shown = visibleItems(items)

    expect(shown.length).toBeLessThan(items.length)
    // Every surviving item is the same object, in the same relative order.
    expect(shown).toEqual(items.filter((item) => shown.includes(item)))
  })

  it.each([
    ['info', false],
    ['warn', true],
    ['error', true],
  ] as const)('shows a %s notice: %s', (level, visible) => {
    const item: TranscriptItem = { kind: 'notice', id: 'n', level, text: 'x' }
    expect(isVisibleIn(item)).toBe(visible)
  })

  it.each([
    ['reasoning', false],
    ['plan', false],
    ['lifecycle', false],
    ['activity', false],
    ['echo', false],
    ['unrecognized', false],
  ] as const)('shows a %s unknown: %s', (category, inNormal) => {
    const item: TranscriptItem = { kind: 'unknown', id: 'u', provider: 'codex', category, raw: {} }
    expect(isVisibleIn(item)).toBe(inNormal)
    expect(isVisibleIn(item, true)).toBe(category === 'unrecognized')
  })

  it('hides a superseded tool row while keeping an ordinary tool call', () => {
    const call: TranscriptItem = {
      kind: 'tool',
      id: 't1',
      callId: 'toolu_a',
      name: 'TaskCreate',
      summary: '…',
      result: null,
    }
    // The paired positive first: an ordinary tool row is shown in both, so what follows is about
    // being superseded and not about tool rows.
    expect(isVisibleIn(call)).toBe(true)
    expect(isVisibleIn({ ...call, superseded: true })).toBe(false)
  })
})
