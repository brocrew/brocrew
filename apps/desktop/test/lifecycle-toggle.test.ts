import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import { applyEvent, appendUserMessage, createTranscript } from '../src/renderer/src/lib/transcript'
import {
  isVisibleIn,
  visibleItems,
  LIFECYCLE_TOGGLE_TITLE,
} from '../src/renderer/src/lib/transcript-mode'
import type { TranscriptItem } from '../src/renderer/src/lib/transcript'

/**
 * 211 §4 · **The toggle promised boundaries and delivered plan deltas** (from 210 finding 5).
 *
 * > *"Its tooltip promises session start, turn boundaries and idle gaps. Turning it on added 208
 * > repeated `item/plan/delta` markers, and the plan itself was more readable with it off."*
 *
 * ⛔ **The BEHAVIOUR moved, not the words** — `142` allows either, and two surfaces had already
 * written down which was intended. The tooltip has named those three things since 079, and
 * `EventStream.vue`'s own note says *"This is not the lifecycle toggle: that one puts session
 * starts and turn boundaries in the conversation. Nothing here is filtered out."* The raw stream
 * still exists, one tab away, unfiltered. (⚠️ 237 §1 replaced that note's last sentence —
 * *"Here you always see everything"* — because the tab is bounded; the claim quoted here is the
 * one about FILTERING, which is this file's subject and is unchanged.
 * ⚑ **526 · it is no longer ON SCREEN by default.** Those two sentences moved into a disclosure
 * that ships shut, so they are in the markup and behind a press. The words did not change and
 * neither did the claim; *"on-screen note"* did, which is why this paragraph no longer says it.)
 *
 * ⚑ **This file is the LINK.** `LIFECYCLE_TOGGLE_TITLE` lives beside the predicate that has to
 * honour it, and the tests below pull the promise apart and check the filter against each half —
 * so the two cannot drift again without something going red.
 */

const ref = { provider: 'claude' as const, sessionId: 'sess-abc', cwd: '/tmp/x', rotation: 0 }

/** The three things the tooltip names, taken from the tooltip rather than re-typed here. */
const PROMISED = LIFECYCLE_TOGGLE_TITLE.split('—')[1]
  ?.split(',')
  .map((part) => part.trim())

describe('what the toggle says', () => {
  it('names three things, and they are the boundaries of a conversation', () => {
    expect(PROMISED).toEqual(['session start', 'turn boundaries', 'provider housekeeping'])
    expect(LIFECYCLE_TOGGLE_TITLE).toContain('in the conversation')
    // ⛔ It does not promise the raw stream, which is what it stopped delivering.
    expect(LIFECYCLE_TOGGLE_TITLE).not.toMatch(/raw|everything|plan|reasoning/i)
  })

  it('⛔ and it no longer promises "idle gaps", because nothing has ever produced one', () => {
    // The test below drives each promised thing through the real fold, and that is what found this:
    // `status: idle` appends no item at all — it clears the activity — so no view could show it. The
    // words moved rather than the behaviour for this one noun alone, because the alternative was
    // inventing an item kind to satisfy a tooltip.
    const state = createTranscript()
    applyEvent(state, { type: 'status', state: 'idle' })
    expect(state.items).toHaveLength(0)
    expect(LIFECYCLE_TOGGLE_TITLE).not.toContain('idle')
  })
})

describe('what the toggle does', () => {
  /** Each promised boundary, as the event that produces it and the item the fold makes of it. */
  const boundaries: [string, RuntimeEvent][] = [
    ['session start', { type: 'session', state: 'started', ref }],
    ['turn boundaries', { type: 'turn', state: 'completed' }],
    [
      'provider housekeeping',
      { type: 'unknown', provider: 'claude', category: 'lifecycle', raw: { type: 'auth_status' } },
    ],
  ]

  it.each(boundaries)('shows %s in the conversation when it is on', (_name, event) => {
    const state = createTranscript()
    applyEvent(state, event)
    const [item] = state.items

    expect(item, 'this event produced no item at all — the assertion below would be vacuous') //
      .toBeDefined()
    expect(isVisibleIn('debug', item!)).toBe(true)
    // …and the conversation view is what it is on TOP of, so each is hidden with the toggle off.
    expect(isVisibleIn('normal', item!)).toBe(false)
  })

  it('⛔ 210’s screen: 208 plan deltas do not enter the conversation in either view', () => {
    const state = createTranscript()
    appendUserMessage(state, 'plan the JSON output, do not edit anything')
    for (let i = 0; i < 208; i += 1) {
      applyEvent(state, { type: 'unknown', provider: 'codex', category: 'plan', raw: { i } })
    }
    applyEvent(state, { type: 'assistant_message', text: 'Here is the plan.' })

    // 210 pressed the toggle and got 210 rows where the conversation is 2.
    expect(state.items).toHaveLength(210)
    expect(visibleItems('debug', state.items)).toHaveLength(2)
    expect(visibleItems('normal', state.items)).toHaveLength(2)
    // The paired positive: the two rows that ARE the conversation both survived, so this is a
    // measurement of what was dropped and not of a view that shows nothing.
    expect(visibleItems('debug', state.items).map((item) => item.kind)).toEqual([
      'user',
      'assistant',
    ])
  })

  it('the loud one still gets through: a payload nothing could classify is in both views', () => {
    const surprise: TranscriptItem = {
      kind: 'unknown',
      id: 'u',
      provider: 'codex',
      category: 'unrecognized',
      raw: { never: 'seen' },
    }
    expect(isVisibleIn('debug', surprise)).toBe(true)
    expect(isVisibleIn('normal', surprise)).toBe(true)
  })

  it('a failure is never hidden by either view — the direction that would be a lie', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'error', message: 'the provider died', fatal: true })
    applyEvent(state, { type: 'error', message: 'claude is retrying', fatal: false })

    for (const mode of ['debug', 'normal'] as const) {
      expect(visibleItems(mode, state.items), mode).toHaveLength(2)
    }
  })
})
