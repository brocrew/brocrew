import { describe, expect, it } from 'vitest'
import type { RuntimeEvent, SessionRef } from '@brobot2/runtime'
import { applyEvent, appendUserMessage, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn, visibleItems } from '../src/renderer/src/lib/transcript-mode'
import type { TranscriptItem } from '../src/renderer/src/lib/transcript'

/**
 * The body serves the dev screen and, later, the real app view. `normal` hiding the
 * wrong thing is the dangerous direction: a user who cannot see a failure, a stall
 * or a card waiting on them has been lied to by omission. These pin exactly what
 * each mode shows, against a transcript built by the real fold.
 */

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
  /**
   * ⛔ **CORRECTED, not deleted** (142). This read *"debug shows every item, exactly as the dev
   * screen always has"* and asserted `visibleItems('debug', items) === items`. That contract is what
   * 211 §4 retired: the toggle that turns this mode on has promised *"session start, turn
   * boundaries, idle gaps"* since 079 and delivered every recognized whisper as well — 208
   * `item/plan/delta` markers in the conversation 210 was trying to read.
   *
   * ⚑ **The paired positive is the point of the shape below**: it is not enough to show that debug
   * drops something, because a mode that dropped everything would pass that. Debug is asserted to be
   * `normal` PLUS the boundaries, with both halves named.
   */
  it('debug is the conversation PLUS the lifecycle boundaries — and nothing else (211 §4)', () => {
    const state = realisticTranscript()
    const debug = visibleItems('debug', state.items)
    const normal = visibleItems('normal', state.items)

    // It is not "everything" any more…
    expect(debug.length).toBeLessThan(state.items.length)
    // …and it is not "the conversation" either: it is strictly bigger.
    expect(debug.length).toBeGreaterThan(normal.length)
    // Every row the conversation shows is still here, in the same order.
    expect(debug.filter((item) => normal.includes(item))).toEqual(normal)
    // And what it adds back is exactly the boundaries: the two `info` notices ("session started",
    // "turn completed") and the one payload the runtime classified as session/turn housekeeping.
    // The `reasoning` chatter beside them in the same fixture is in NEITHER view.
    const added = debug.filter((item) => !normal.includes(item))
    expect(added.map((item) => item.kind)).toEqual(['notice', 'unknown', 'notice'])
    expect(
      added.every((item) => {
        if (item.kind === 'notice') return item.level === 'info'
        return item.kind === 'unknown' && item.category === 'lifecycle'
      }),
    ).toBe(true)
  })

  it('normal keeps the conversation: messages, tools and the cards waiting on you', () => {
    const shown = visibleItems('normal', realisticTranscript().items)

    expect(kindsOf(shown)).toContain('user')
    expect(kindsOf(shown)).toContain('assistant')
    expect(kindsOf(shown)).toContain('tool')
    expect(kindsOf(shown)).toContain('permission')
  })

  it('normal is a filter, not a reordering or a rewrite', () => {
    const items = realisticTranscript().items
    const shown = visibleItems('normal', items)

    expect(shown.length).toBeLessThan(items.length)
    // Every surviving item is the same object, in the same relative order.
    expect(shown).toEqual(items.filter((item) => shown.includes(item)))
  })

  it.each([
    ['info', false],
    ['warn', true],
    ['error', true],
  ] as const)('normal shows a %s notice: %s — and debug shows all three', (level, visible) => {
    // ⚑ The `debug` half is unchanged by 211 §4 and it is the half that MATTERS here: `info`
    // notices ARE the session starts and turn boundaries the toggle promises, so this is the
    // positive that stops the new filter from being "drops everything".
    const item: TranscriptItem = { kind: 'notice', id: 'n', level, text: 'x' }
    expect(isVisibleIn('normal', item)).toBe(visible)
    expect(isVisibleIn('debug', item)).toBe(true)
  })

  /**
   * ⛔ **The `debug` column CHANGED and the `normal` column did not** (211 §4). It used to read
   * `true` for every row, because debug meant everything. `lifecycle` is the one category the
   * toggle's own words cover — `unknownCategorySchema` calls it *"session/turn housekeeping"* — and
   * `plan` is the category that put 208 markers into 210's planning conversation.
   */
  it.each([
    ['reasoning', false, false],
    ['plan', false, false],
    ['lifecycle', false, true],
    ['activity', false, false],
    ['echo', false, false],
    ['unrecognized', true, true],
  ] as const)('a %s unknown — normal: %s, debug: %s', (category, inNormal, inDebug) => {
    const item: TranscriptItem = { kind: 'unknown', id: 'u', provider: 'codex', category, raw: {} }
    expect(isVisibleIn('normal', item)).toBe(inNormal)
    expect(isVisibleIn('debug', item)).toBe(inDebug)
  })

  /**
   * ⛔ **CORRECTED in 211 §4** — it was *"leaves the conversation but stays in debug (028)"*.
   *
   * The reason 028 gave for keeping it in debug was debug's old contract, *"showing what the
   * provider really said"*, and that job belongs to the drawer's Events tab. A call the runtime told
   * us is already drawn as the checklist beside it is the same fact twice in either mode, and it is
   * not one of the three things the toggle promises.
   */
  it('a SUPERSEDED tool row leaves BOTH views — the raw call is a tab away (028, 211 §4)', () => {
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
    expect(isVisibleIn('normal', call)).toBe(true)
    expect(isVisibleIn('debug', call)).toBe(true)
    expect(isVisibleIn('normal', { ...call, superseded: true })).toBe(false)
    expect(isVisibleIn('debug', { ...call, superseded: true })).toBe(false)
  })
})
