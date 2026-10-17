import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'

/**
 * **253's COMPILE FLOOR in `apps/desktop`** — and, since `258`, the fold beneath the surface too.
 *
 * ⚑ The block at the head of this file is `253`'s and is unchanged; `258`'s own describes are at the
 * bottom, where the arm it was handed is exercised.
 *
 * ⛔ 253's dispatch §3 says *"no renderer: where it appears on screen is a separate dispatch"*. Two
 * files here enumerate `RuntimeEvent` exhaustively, so a new variant has to be given an arm or the
 * tree does not build — `247` left the identical pair for `248`. These are the assertions that keep
 * those two arms honest until the seat that draws the surface arrives.
 *
 * ⚑ The fold's arm is covered where it belongs, by `transcript.test.ts`'s `annotatesRatherThanAdds`
 * census: a `scheduled_work` event must add no transcript item. What is left is the debug line, and
 * the one thing it can get wrong is the distinction the whole dispatch is about.
 */
describe('253 · the raw stream may not conflate "no level" with "none scheduled"', () => {
  const at = (event: Extract<RuntimeEvent, { type: 'scheduled_work' }>): string =>
    describeEvent(event)

  it('says `no level` when the frame stated none, and `0 scheduled` when it stated an empty one', () => {
    // ⛔ These are different facts and only one of them clears a list. `workflow_run` draws the same
    // line with `no roster`, for the same reason.
    expect(at({ type: 'scheduled_work', source: 'hook/Stop' })).toContain('no level')
    expect(at({ type: 'scheduled_work', jobs: [], source: 'hook/Stop' })).toContain('0 scheduled')
  })

  it('names the schedule, because that is the promise a person is owed', () => {
    const line = at({
      type: 'scheduled_work',
      jobs: [
        { id: 'a7504434', schedule: '*/1 * * * *', recurring: true, prompt: 'SCHED_253 tick' },
      ],
      source: 'hook/Stop',
    })
    expect(line).toContain('1 scheduled')
    expect(line, 'the id, which is the only thing two payloads can be compared on').toContain(
      'a7504434',
    )
    expect(line).toContain('*/1 * * * *')
    expect(line).toContain('hook/Stop')
    // ⚠️ **The prompt is deliberately NOT in the debug line.** The provider's copy is clipped at
    // 1000 characters with an `… [+N chars]` marker appended, so a line that showed it beside a
    // fired prompt would invite exactly the text correlation `scheduled-work.ts` refuses to make.
    expect(line).not.toContain('SCHED_253 tick')
  })

  /**
   * ⚠️ **The words changed in `263` §1 and the reason is worth keeping here.** This assertion used
   * to read `'3 beyond the cap'`, and it was independently true and jointly false: `dropped` counts
   * rows past the ceiling AND rows the provider sent with no id, so the line asserted a cause the
   * wire does not carry. ⛔ **Nothing here could have caught it** — this test composes the event
   * itself, so it can only ever confirm the author's own idea of why the field is set. The killing
   * test lives in `dropped-cause.test.ts` and drives the real `SessionCrons`.
   */
  it('says out loud when the level carried rows this app cannot list', () => {
    const line = at({ type: 'scheduled_work', jobs: [], dropped: 3, source: 'hook/Stop' })
    expect(line).toContain('3 this level could not name')
  })
})

/**
 * # 258 · **The fold, the release, and the card that is deliberately not there**
 *
 * `253`'s arm was a handoff; this is what it was handed to. The WORDS are in
 * `schedule-words.test.ts`, the markup in `schedule-bar.render.test.ts` and the agreement between
 * surfaces in `idle-truth.test.ts`. What is left here is the level's own two rules — absent is not
 * empty, and the registry outlives the window — plus the reading-view ruling, which is a decision
 * either way and is pinned as one.
 */

/** One job, exactly as `claude/session-crons.ts` publishes it off the `Stop` hook. */
const JOB = {
  id: 'e3826cc5',
  // ⚑ DATA rather than prose: the two characters that spell a cron STEP also end a block comment.
  schedule: '*/2 * * * *',
  recurring: true,
  prompt: 'check whether person.txt has appeared on the Desktop',
}

const stated = (
  jobs: { id: string; schedule?: string; recurring?: boolean; prompt?: string }[],
  dropped?: number,
): RuntimeEvent =>
  ({
    type: 'scheduled_work',
    jobs,
    ...(dropped === undefined ? {} : { dropped }),
    source: 'hook/Stop',
  }) as RuntimeEvent

describe('258 §1 · the level REPLACES, and a frame that did not state it changes nothing', () => {
  it('🔴 `undefined` leaves the list alone; `[]` is the only thing that clears it', () => {
    const state = createTranscript()
    applyEvent(state, stated([JOB]))
    expect(state.schedule.jobs).toHaveLength(1)

    // ⛔ **The rule `222` cost a dispatch.** A frame with no `jobs` is *"this frame did not state
    // the level"* — and it is the normal shape of one, since `dropped` and `source` travel alone.
    applyEvent(state, { type: 'scheduled_work', source: 'hook/Stop' } as RuntimeEvent)
    expect(state.schedule.jobs).toHaveLength(1)
    expect(state.schedule.jobs[0]?.id).toBe('e3826cc5')

    // …and the paired positive: an EMPTY level from the same source really does clear it.
    applyEvent(state, stated([]))
    expect(state.schedule.jobs).toEqual([])
  })

  it('⛔ REPLACES rather than merges, and `dropped` travels with the jobs', () => {
    const state = createTranscript()
    applyEvent(state, stated([JOB, { id: 'other' }], 2))
    expect(state.schedule.jobs.map((job) => job.id)).toEqual(['e3826cc5', 'other'])
    expect(state.schedule.dropped).toBe(2)
    // A later level naming one job means one job — accumulating would be the edge-pairing that
    // wedges a row on screen after the thing it names is gone.
    applyEvent(state, stated([{ id: 'other' }]))
    expect(state.schedule.jobs.map((job) => job.id)).toEqual(['other'])
    expect(state.schedule.dropped).toBe(0)
  })

  it('⚠️ the rows are COPIED out of the event, so two folds cannot share one array', () => {
    const state = createTranscript()
    const jobs = [JOB]
    applyEvent(state, stated(jobs))
    expect(state.schedule.jobs).not.toBe(jobs)
    expect(state.schedule.jobs).toEqual(jobs)
  })

  it('⛔ a boundary does not decide the level — only a frame that states it does', () => {
    // ⚑ **D-029 moved this fact.** It read *"a level does not decide whether the conversation is
    // open — only the boundaries do"*, about 258 §2's `sleeping` flag, which the session boundaries
    // wrote and a level frame left alone. The flag is gone — this app starts a stopped conversation
    // in time for its jobs, so a close says nothing about them — and what is left is the same rule
    // turned round. One field, one writer (`061` finding 6): the schedule is written by the frame
    // that states it, and neither a close nor a reopen is one.
    const state = createTranscript()
    applyEvent(state, stated([JOB], 1))
    // ⚠️ A COPY, not the live object: a boundary that wrote the registry in place would otherwise
    // be compared with itself, and the two equalities below could not fail.
    const before = structuredClone(state.schedule)
    applyEvent(state, { type: 'session', state: 'ended' } as RuntimeEvent)
    // …the premise, read off the fold rather than assumed: the close really happened.
    expect(state.ended).toBe(true)
    expect(state.schedule).toStrictEqual(before)
    // ⛔ …and the SESSION arm, the door that un-ends a transcript without `markReopened` and used to
    // wake the schedule, leaves it standing too.
    applyEvent(state, {
      type: 'session',
      state: 'resumed',
      ref: { provider: 'claude', sessionId: 'th_2', cwd: '/Users/alex/work/brobot', rotation: 1 },
    } as RuntimeEvent)
    expect(state.ended).toBe(false)
    expect(state.schedule).toStrictEqual(before)
    // …and the paired positive: a level stated after both boundaries still REPLACES, so "left
    // standing" is not "frozen".
    applyEvent(state, stated([{ id: 'other' }]))
    expect(state.schedule.jobs.map((job) => job.id)).toEqual(['other'])
    expect(state.schedule.dropped).toBe(0)
  })
})

describe('258 · the registry outlives the window (064, 061 finding 5)', () => {
  it('🔴 a released slab keeps the schedule, because only a TURN END would restate it', () => {
    const entries: RuntimeEventMessage[] = [
      { sessionId: 'sess_1', ordinal: 1, at: 1_800_000_000_000, event: stated([JOB]) },
    ]
    const held = foldWindow(entries)
    expect(held.schedule.jobs).toHaveLength(1)

    // The release: the events that stated the level are gone, and the retained suffix says nothing
    // about it. ⚠️ `background_work` is republished on every `system/init`; this is not, so the
    // next restatement is a whole turn away rather than a frame away.
    const carry = carryForward(held, [])
    const after = foldWindow([], null, carry)
    expect(after.schedule.jobs).toHaveLength(1)
    expect(after.schedule.jobs[0]?.id).toBe('e3826cc5')
    expect(after.schedule.dropped).toBe(0)

    // ⛔ **The paired control**: a cold fold of the same empty suffix, with no carry, is empty — so
    // the line above is about the carry and not about a fold that keeps state by accident.
    expect(foldWindow([]).schedule.jobs).toEqual([])
  })

  it('⛔ …and it cannot break the rule a carry has to keep: a stated level still wins', () => {
    const held = foldWindow([
      { sessionId: 'sess_1', ordinal: 1, at: 1_800_000_000_000, event: stated([JOB]) },
    ])
    const carry = carryForward(held, [])
    const restated = foldWindow(
      [{ sessionId: 'sess_1', ordinal: 9, at: 1_800_000_009_000, event: stated([]) }],
      null,
      carry,
    )
    expect(restated.schedule.jobs).toEqual([])
  })

  it('⚠️ a CLOSED conversation’s jobs travel across a release like any other', () => {
    // ⚑ **D-029 moved this fact.** It read *"`sleeping` travels with the jobs, so a release cannot
    // resurrect a closed schedule"* — 258 §2's flag, which a fold of a suffix that stopped short of
    // the ending would have lost. The flag went with the asleep ruling: a stopped conversation's
    // jobs are its jobs, since this app starts it for them. What a release still owes a ledger
    // whose last word is the close is the level itself, `dropped` included.
    const closed = foldWindow([
      { sessionId: 'sess_1', ordinal: 1, at: 1_800_000_000_000, event: stated([JOB], 1) },
      {
        sessionId: 'sess_1',
        ordinal: 2,
        at: 1_800_000_001_000,
        event: { type: 'session', state: 'ended' } as RuntimeEvent,
      },
    ])
    // …the premise, read off the fold: this is a closed conversation's registry.
    expect(closed.ended).toBe(true)
    const after = foldWindow([], null, carryForward(closed, []))
    expect(after.schedule).toStrictEqual(closed.schedule)
    // …and the equality is over a level that holds something, not `[] === []`.
    expect(after.schedule.jobs).toHaveLength(1)
    expect(after.schedule.jobs[0]?.id).toBe('e3826cc5')
    expect(after.schedule.dropped).toBe(1)
  })

  it('⚠️ the carried registry is COPIED, not aliased', () => {
    const held = foldWindow([
      { sessionId: 'sess_1', ordinal: 1, at: 1_800_000_000_000, event: stated([JOB]) },
    ])
    const carry = carryForward(held, [])
    expect(carry.schedule.jobs).not.toBe(held.schedule.jobs)
    expect(carry.schedule.jobs).toEqual(held.schedule.jobs)
  })
})

describe('258 §3 · the reading-view ruling, which is a decision either way', () => {
  it('⛔ a schedule earns NO card, however many times the level is restated', () => {
    // ⚑ `253` measured what "restated" means with a cron actually firing: one process, one
    // `session_id`, `init` at 10 194 / 54 805 / 114 037 ms. A card per level frame is a card every
    // two minutes for as long as the conversation is open — `078`'s rule with a clock behind it.
    const state = createTranscript()
    for (let index = 0; index < 5; index += 1) applyEvent(state, stated([JOB]))
    expect(state.items).toEqual([])
    // …and the paired positive, so the line above is a fact about this arm rather than about a fold
    // that adds nothing to anything: an ordinary message DOES become an item in the same state.
    applyEvent(state, { type: 'assistant_message', text: 'done' } as RuntimeEvent)
    expect(state.items).toHaveLength(1)
    // ⛔ …and the registry really was written the whole time, so "no card" is not "no effect".
    expect(state.schedule.jobs).toHaveLength(1)
  })
})
