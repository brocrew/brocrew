import { describe, expect, it } from 'vitest'
import type { HistoryWindow, RuntimeEventMessage } from '../src/shared/runtime-ipc'
import {
  NOT_REACHED_THIS_WINDOW,
  acceptEvent,
  createSessionRecord,
  foldHeldEvents,
  openWindow,
} from '../src/renderer/src/lib/session-record'

/**
 * 🔴 **What the renderer DOES with an arrival that is out of order** (320 §4.2).
 *
 * ⚠️ **Written to MEASURE, not to argue.** The PM asked two things I could not answer by reading:
 * whether the late event is silently dropped, and whether the two notices he photographed are all
 * of them. Both answers are here as assertions, and both surprised me.
 *
 * ⛔ **The producer of a low arrival is gone** — `320` fixed `runtime-host.ts` so a `memory_note`
 * can no longer overtake the status that caused it. This file is deliberately NOT about that fix.
 * It is about the instrument: what it says, how many times it says it, and whether it is right —
 * because an instrument that reports one real defect as three is one you stop believing.
 */

const SESSION = 'sess_ooo'

/**
 * A replayed page whose LAST event is `status: 'working'`.
 *
 * ⛔ **The working status is load-bearing and was missing from the first draft of this file** (found
 * reviewing this diff). A fresh transcript already reads `idle`, so an assertion that the late
 * `status: 'idle'` was applied passes whether it was folded or thrown away — and measured, the whole
 * file passed against a renderer patched to notice a late arrival and then discard it (193, and the
 * exact trap `late()` below is documented as avoiding).
 */
function page(from: number, n: number): HistoryWindow {
  return {
    entries: Array.from({ length: n }, (_, index) => ({
      ordinal: from + index,
      at: 1_800_000_000_000 + (from + index) * 1_000,
      event:
        index === n - 1
          ? ({ type: 'status', state: 'working' } as const)
          : ({ type: 'assistant_message', text: `reply ${from + index}` } as const),
    })),
    from,
    hasOlder: from > 0,
    turnAligned: true,
  }
}

const at = (ordinal: number): number => 1_800_000_000_000 + ordinal * 1_000

/** The `status: 'idle'` that ends a turn — ordinal 181 in the screenshot. */
const idle = (ordinal: number): RuntimeEventMessage => ({
  sessionId: SESSION,
  ordinal,
  at: at(ordinal),
  event: { type: 'status', state: 'idle' },
})

/** The row 318 added — ordinal 182, and the one that arrived first. */
const note = (ordinal: number): RuntimeEventMessage => ({
  sessionId: SESSION,
  ordinal,
  at: at(ordinal),
  event: {
    type: 'memory_note',
    notes: [
      { path: '/home/codex/memories/extensions/ad_hoc/notes/n.md', text: 'The name is Bob.' },
    ],
  },
})

const chatter = (ordinal: number): RuntimeEventMessage => ({
  sessionId: SESSION,
  ordinal,
  at: at(ordinal),
  event: { type: 'assistant_message', text: `reply ${ordinal}` },
})

/**
 * A late arrival with something in it you can look for by name.
 *
 * ⚠️ **A `status` would NOT have worked here**, and finding that out is why this exists: a fresh
 * record already reads `idle`, so "the late status was dropped" and "the late status was folded"
 * produce the same value and the assertion would have passed over nothing (193).
 */
const LATE = 'the message that arrived after a later one'
const late = (ordinal: number): RuntimeEventMessage => ({
  sessionId: SESSION,
  ordinal,
  at: at(ordinal),
  event: { type: 'assistant_message', text: LATE },
})

/** A record sitting at the tail mid-turn, waiting for ordinal 181 — exactly where his window was. */
function waitingFor181() {
  const record = createSessionRecord(SESSION)
  const first = page(176, 5)
  openWindow(record, first)
  for (const entry of first.entries) acceptEvent(record, { sessionId: SESSION, ...entry })
  expect(record.nextOrdinal).toBe(181)
  // The precondition the next assertion depends on: this session is RUNNING, so an `idle` that is
  // folded changes something and an `idle` that is dropped does not.
  expect(record.transcript.status).toBe('working')
  return record
}

const notices = (record: ReturnType<typeof createSessionRecord>): string[] =>
  record.control.items.flatMap((item) => (item.kind === 'notice' ? [item.text] : []))

describe('320 · an arrival that is out of order', () => {
  it('folds the late event rather than dropping it, so the transcript is whole', () => {
    // ⚑ **The first of the PM's two questions, and the answer is the good one.** The live path has
    // no `ordinal < nextOrdinal` skip — that skip lives in `foldHeldEvents`, which is the buffered
    // drain and not this door. `acceptEvent` complains and then folds, every time.
    const record = waitingFor181()
    acceptEvent(record, note(182))
    acceptEvent(record, idle(181))

    expect(record.transcript.items.some((item) => item.kind === 'memoryNote')).toBe(true)
    // ⛔ **`working` → `idle` is the assertion, and only because the helper put it in `working`
    // first.** This read `toBe('idle')` against a record that was already idle, which is a negative
    // dressed as a positive: a renderer that dropped the late event passed it.
    expect(record.transcript.status).toBe('idle')
  })

  it('folds a late event that has something in it, and the something is there', () => {
    // ⚠️ **The same claim on an event that CARRIES text**, because a status is a state change and a
    // state change can be reached from more than one direction. This one cannot: the string is in
    // the transcript or it is not, and nothing else in this file puts it there.
    const record = waitingFor181()
    acceptEvent(record, chatter(182))
    acceptEvent(record, late(181))

    expect(JSON.stringify(record.transcript.items)).toContain(LATE)
  })

  it('reports the reorder ONCE, not once per event that follows it', () => {
    // 🔴 **This is the finding.** `record.nextOrdinal = message.ordinal + 1` was an assignment, so
    // folding the late 181 walked the counter BACKWARDS from 183 to 182 — and the next event, 183,
    // arriving in perfect sequence, was then reported as a gap too. ⛔ One reorder, three notices,
    // and the third is dated to whatever the user did next: he types a message, and the app tells
    // him it lost his stream. Measured here rather than reasoned about.
    const record = waitingFor181()
    acceptEvent(record, note(182))
    acceptEvent(record, idle(181))
    expect(record.nextOrdinal).toBe(183)

    acceptEvent(record, chatter(183))
    expect(notices(record)).toHaveLength(2)
    expect(record.nextOrdinal).toBe(184)
  })

  it('says something is MISSING only when something is missing', () => {
    // ⛔ **The two directions are not the same fact and must not share a sentence** (009, 074).
    // Higher than expected: events between have not arrived, and that is what it says.
    //
    // ⚑ **623 · the words are a person's now and the fact is unchanged** (`HO-095` §2) — see
    // `session-record.ts`. The clause is IMPORTED rather than typed, so this assertion moves with a
    // rewording instead of going quietly vacuous under one.
    const record = waitingFor181()
    acceptEvent(record, chatter(999))
    expect(notices(record)).toHaveLength(1)
    expect(notices(record)[0]).toContain(NOT_REACHED_THIS_WINDOW)
    // ⛔ **And it says HOW MUCH**, which is the half `expected 181, got 999` left a person to do in
    // their head — 818 events, not "a gap".
    expect(notices(record)[0]).toContain('818 events of this conversation have')
  })

  it('says it ARRIVED LATE when nothing is missing, and does not call that a gap', () => {
    // ⚑ **The ruling of 320 §5.** The notice earned its place — it caught a real defect on its first
    // day — and it was not too loud. It was WRONG: it told him the stream had a hole in it when the
    // app held every event and had merely been handed two of them the wrong way round. Softening it
    // would have been the wrong repair; making it true is the right one.
    const record = waitingFor181()
    acceptEvent(record, note(182))
    acceptEvent(record, idle(181))

    const said = notices(record)
    expect(said).toHaveLength(2)
    // ⚑ **D-017b · the sentence no longer names a remedy.** *Reopening it loads it from the record*
    // was true while opening meant ending and reopening; no press re-reads a conversation this
    // window is fed now, so the sentence says only what the reader is missing.
    expect(said[0]).toBe(
      '1 event of this conversation has not reached this window, so what you are reading is ' +
        'missing it.',
    )
    // 🔴 **623 · and now the first sentence is TAKEN BACK, which is the half `320` could not write**
    // (`HO-095` §2). ⛔ **This is the whole finding.** `320` left two notices standing over each
    // other: one saying something was missing and one, an event later, saying it was not — and the
    // alarming one never moved. ⚠️ **That is the shape of what the PO photographed**: *"expected
    // ordinal 486, got 487"*, one event wide, directly after a refused call and its retry. ⚑ The
    // window knew, one arrival later, and had no way to say so.
    //
    // ⛔ **Asserted WHOLE, not by `toContain`**, for `320`'s own reason one claim over: the sentence
    // has to say the hole closed AND that nothing else is open, and a `toContain` would pass over a
    // line that had lost either.
    expect(said[1]).toBe(
      'The missing part of this conversation has reached this window — nothing is missing from ' +
        'what you are reading.',
    )
  })

  it('claims nothing about the events it has NOT seen', () => {
    // ⛔ **The first draft of this sentence said *"nothing is missing"*, and a record cannot know
    // that** (found reviewing this diff). `nextOrdinal` is the highest seen plus one, not a set of
    // what arrived — so on a run where a real hole is still open, the reassurance was false at the
    // moment it was written, three times over. 074: say the weaker fact you know.
    const record = waitingFor181()
    acceptEvent(record, chatter(184)) //  a real hole: 181, 182, 183 have not arrived
    acceptEvent(record, late(181)) //   one of them turns up late; two are still missing

    const said = notices(record)
    expect(said[0]).toBe(
      '3 events of this conversation have not reached this window, so what you are reading is ' +
        'missing them.',
    )
    expect(said[1]).not.toContain('nothing is missing')
    // ⚑ The paired positive: it still says what it does know, so this is a narrowed claim and not a
    // deleted one.
    //
    // 🔴 **623 · and what it knows is now a NUMBER** (`HO-095` §2). ⛔ `320` corrected *"nothing is
    // missing"* to a claim this record could make, and could only ever make the weak one, because
    // `nextOrdinal` is the highest seen plus one. ⚑ The record now holds the SET, so the arm that
    // says *nothing is missing* is the one that has counted zero — and this arm, which has counted
    // two, says two.
    expect(said[1]).toBe(
      'An earlier part of this conversation arrived after a later one; 2 events are still missing.',
    )
    expect(JSON.stringify(record.transcript.items)).toContain(LATE)
  })

  it('still drops a late event on the BUFFERED path, and that is the residual risk', () => {
    // ⚠️ **Not a defect this dispatch introduces or removes — a fact it is recording** (074).
    // `foldHeldEvents` skips `ordinal < nextOrdinal` because a held event can ALSO be in the page
    // that was just replayed (100), and folding it twice is worse than losing it. That skip cannot
    // tell a duplicate from a late arrival, so on that one path a reorder is a silent loss — no
    // item, and no notice either. ⛔ `320` removes the only known producer of a low arrival; it does
    // not give the buffer a way to tell the two apart, and pretending otherwise would be worse than
    // writing it down.
    const record = createSessionRecord(SESSION)
    // Events held because they arrived before this record had a session to fold them into.
    record.earlyEvents.push(note(182), late(181))
    foldHeldEvents(record)

    // ⚑ **The positive half, and it is what makes the negative mean anything** (193): the note is
    // there, so the drain ran and folded what it could.
    expect(record.transcript.items.some((item) => item.kind === 'memoryNote')).toBe(true)
    // ⛔ **And the event behind it is simply gone** — asserted on its TEXT, because a default that
    // already reads like the expected outcome is how a negative passes over nothing.
    expect(JSON.stringify(record.transcript.items)).not.toContain(LATE)
    expect(notices(record).some((text) => text.includes('181'))).toBe(false)
  })
})
