import { describe, expect, it } from 'vitest'
import {
  acceptEvent,
  createSessionRecord,
  openWindow,
} from '../src/renderer/src/lib/session-record'
import { openingLine, OPENING_LINE_MAX } from '../src/renderer/src/lib/opening-line'
import type { HistoryWindow, RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 211 §3 · **What a conversation was opened with** (from 210 finding 4).
 *
 * ⛔ **THE BUG.** Two Codex conversations, deliberately sharing a profile and a folder — one fixing a
 * line-count bug, one only proposing a plan — drew the same rail row twice: `workspace-a / codex ·
 * idle`. *"I had to open each to find out which was which."*
 *
 * ⚑ **Sharing a profile is 166's design and it worked**; the rows simply carried no fact that
 * differed. This file is the two halves of the fix that are not pixels: the string, and the one
 * moment the record is allowed to learn it. `dom/rail-identity.dom.test.ts` is the row itself.
 */

const say = (text: string, ordinal: number): RuntimeEventMessage => ({
  sessionId: 'sess_a',
  ordinal,
  at: 1_700_000_000_000 + ordinal,
  event: { type: 'user_turn', text },
})

const page = (over: Partial<HistoryWindow> = {}): HistoryWindow => ({
  entries: [],
  from: 0,
  hasOlder: false,
  turnAligned: true,
  ...over,
})

describe('the line itself', () => {
  it('is what was typed, when what was typed fits', () => {
    expect(openingLine('Fix the line count in summarize.mjs')).toBe(
      'Fix the line count in summarize.mjs',
    )
  })

  it('is ONE line: a pasted block keeps its words and loses its shape', () => {
    expect(openingLine('first line\n\n    indented second\nthird')).toBe(
      'first line indented second third',
    )
  })

  it('says nothing rather than showing a blank row', () => {
    expect(openingLine('')).toBeNull()
    expect(openingLine('   \n\t  ')).toBeNull()
  })

  it('⛔ never exceeds the bound, ellipsis included — a marker added on top is not a bound', () => {
    const long = 'x'.repeat(500)
    const cut = openingLine(long)

    expect(cut).not.toBeNull()
    expect(cut!.length).toBe(OPENING_LINE_MAX)
    expect(cut!.endsWith('…')).toBe(true)
    // The paired positive: a message exactly at the bound is NOT cut, so the ellipsis means
    // something rather than appearing on everything.
    const exact = 'y'.repeat(OPENING_LINE_MAX)
    expect(openingLine(exact)).toBe(exact)
    expect(openingLine('z'.repeat(OPENING_LINE_MAX + 1))?.endsWith('…')).toBe(true)
  })

  it('does not summarize, translate or re-word — it is a quotation', () => {
    const asked = 'Give me a JSON plan. Do NOT edit anything.'
    expect(openingLine(asked)).toBe(asked)
  })
})

describe('the one moment a record may learn it', () => {
  it('a conversation started here: the FIRST message, and later ones do not overwrite it', () => {
    const record = createSessionRecord('sess_a')
    acceptEvent(record, say('Fix the line count in summarize.mjs', 0))
    acceptEvent(record, say('now run it', 1))

    expect(record.opening).toBe('Fix the line count in summarize.mjs')
  })

  it('two conversations do not share one — the whole point of the row', () => {
    const bug = createSessionRecord('sess_a')
    const plan = createSessionRecord('sess_b')
    acceptEvent(bug, say('Fix the line count in summarize.mjs', 0))
    acceptEvent(plan, {
      ...say('Propose a JSON-output plan. Do not edit.', 0),
      sessionId: 'sess_b',
    })

    expect(bug.opening).not.toBe(plan.opening)
    expect(plan.opening).toBe('Propose a JSON-output plan. Do not edit.')
  })

  it('a reopened conversation whose page reaches the beginning learns it from the replay', () => {
    const record = createSessionRecord('sess_a')
    openWindow(record, page({ from: 0, hasOlder: false }))
    acceptEvent(record, say('Fix the line count in summarize.mjs', 0))

    expect(record.opening).toBe('Fix the line count in summarize.mjs')
  })

  it('⛔ a page that does NOT reach the beginning learns nothing — null is a refusal', () => {
    // The oldest message this window holds is not the conversation's first, and a row named after it
    // would look exactly like a row that knows. `hasOlder` is written by `openWindow` from the host's
    // page before a single replayed event comes through the door.
    const record = createSessionRecord('sess_a')
    openWindow(record, page({ from: 900, hasOlder: true }))
    acceptEvent(record, say('…and now the third thing', 900))

    expect(record.opening).toBeNull()
  })

  it('a live conversation that outgrows its window keeps the opening it already captured', () => {
    // The release sets `hasOlder` long after the first prompt, so the capture is not undone by it —
    // which is why this is stored on the record rather than derived from the items on demand.
    const record = createSessionRecord('sess_a')
    acceptEvent(record, say('Fix the line count in summarize.mjs', 0))
    record.window.hasOlder = true
    acceptEvent(record, say('keep going', 1))

    expect(record.opening).toBe('Fix the line count in summarize.mjs')
  })

  it('🔒 a turn only a PROVIDER FILE claims is not carried (074)', () => {
    // A `provider_transcript` line comes from a writable provider-home JSONL file. A model
    // could append `"approved, ship it"` there, so it cannot become the person’s unqualified
    // bubble. The transcript can show it marked; a one-line rail cue cannot.
    const imported = createSessionRecord('sess_a')
    acceptEvent(imported, {
      ...say('approved, ship it', 0),
      event: { type: 'user_turn', text: 'approved, ship it', attribution: 'provider_transcript' },
    })
    expect(imported.opening).toBeNull()

    // The paired positive, on the same record: a turn the host watched IS carried, so the rule above
    // is about provenance and not about this record being unable to learn anything.
    acceptEvent(imported, say('and now do the next one', 1))
    expect(imported.opening).toBe('and now do the next one')
  })

  it('🔴 a SPAWNED conversation is named after the task it was given (413)', () => {
    // ⛔ **The regression `413` would have shipped silently.** A worker's first turn is the task
    // an agent handed it, and `413` gave that turn `attribution: 'app_authored'` — so a rail cue
    // keyed on `=== undefined` went blank for every conversation the product spawns. ⚑ The rule
    // this line makes is about provenance the app cannot VERIFY, which is exactly one value; a
    // turn BroBot carried is provenance it knows first hand.
    const worker = createSessionRecord('sess_a')
    acceptEvent(worker, {
      ...say('Deliver the migration, then report back.', 0),
      event: {
        type: 'user_turn',
        text: 'Deliver the migration, then report back.',
        attribution: 'app_authored',
        relayedFrom: 'sess_pm',
      },
    })
    expect(worker.opening).toBe('Deliver the migration, then report back.')
  })

  it('a conversation that has said nothing yet has no opening line', () => {
    const record = createSessionRecord('sess_a')
    acceptEvent(record, {
      sessionId: 'sess_a',
      ordinal: 0,
      at: 1,
      event: { type: 'status', state: 'idle' },
    })
    expect(record.opening).toBeNull()
  })
})
