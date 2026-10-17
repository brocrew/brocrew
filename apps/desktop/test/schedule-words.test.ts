import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import {
  clipScheduleText,
  MAX_SCHEDULE_PROMPT,
  MAX_SCHEDULE_TEXT,
} from '../../../packages/runtime/src/scheduled-work'
import { STANDING_LABEL } from '../src/renderer/src/lib/agent-state'
// ⚑ D-017 · R11 — the word, the held-predicate and what a background row runs are
// `shared/agent-state.ts`'s, so `main` says them as the window draws them.
import { backgroundWhat, SCHEDULED, scheduleHeld } from '../src/shared/agent-state'
import * as scheduleWords from '../src/renderer/src/lib/scheduled-work'
import {
  droppedScheduleNote,
  REPEAT_WORD,
  SCHEDULE_PROMPT_CHARS,
  SCHEDULE_WHEN_CHARS,
  scheduleCutNote,
  scheduleHead,
  scheduleLine,
} from '../src/renderer/src/lib/scheduled-work'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'

/**
 * # 258 · **The words a schedule is said in**
 *
 * ⛔ **`169` §2's rule**: the sentences live in a module so a test can hold the surface to the exact
 * words, and this is that test. `idle-truth.test.ts` holds the AGREEMENT between surfaces;
 * `schedule-bar.render.test.ts` holds the markup; this holds the vocabulary itself and the two
 * places it borrows from — the runtime's ceilings and `232` §2's escaping.
 *
 * ⚠️ **Every negative below is paired with a positive from the same call.** A
 * `not.toContain('every 2 minutes')` also passes against a function that returned an empty string,
 * which is this repo's most-repeated finding.
 */

/** A measured scheduled job; the expression is data rather than prose — see `scheduled-work.ts`. */
const EVERY_TWO_MINUTES = '*/2 * * * *'

const JOB = {
  id: 'e3826cc5',
  schedule: EVERY_TWO_MINUTES,
  recurring: true,
  prompt: 'check whether person.txt has appeared on the Desktop',
}

/**
 * A level of `jobs` listed rows and `dropped` unlisted ones. ⚑ **D-029** — it was `awake`, beside 258
 * §2's asleep registry; a registry is only its level now, with no `sleeping` flag to set.
 */
const level = (jobs: number, dropped = 0) => ({
  jobs: Array.from({ length: jobs }, (_, index) => ({ ...JOB, id: `job_${index}` })),
  dropped,
  left: [],
})

describe('258 · the ceilings are the RUNTIME’s, so a display cut is a backstop and not a second cut', () => {
  it('⛔ carries the same two numbers the schema bounds the payload with', () => {
    // `251` §2's finding, kept: a display cut narrower than the ledger's puts two truncations on one
    // string, one of them counted and one not. These are duplicated to keep the runtime package out
    // of the renderer bundle — this test is what makes the duplication safe.
    expect(SCHEDULE_WHEN_CHARS).toBe(MAX_SCHEDULE_TEXT)
    expect(SCHEDULE_PROMPT_CHARS).toBe(MAX_SCHEDULE_PROMPT)
  })

  it('⛔ …and the producer respects them, so a conforming payload NEVER reaches the cut', () => {
    // ⚠️ Unlike `normalize.ts`'s `truncate`, `clipScheduleText` appends its ellipsis INSIDE the
    // bound — which is why `MAX_BACKGROUND_TEXT` had to be 201 to describe a 200-character rule and
    // this one does not. The invariant is stated directly rather than assumed.
    const huge = 'x'.repeat(MAX_SCHEDULE_PROMPT * 2)
    expect(clipScheduleText(huge, MAX_SCHEDULE_PROMPT).length).toBeLessThanOrEqual(
      MAX_SCHEDULE_PROMPT,
    )
    const clipped = scheduleLine({ id: 'j', prompt: clipScheduleText(huge, MAX_SCHEDULE_PROMPT) })
    expect(clipped.asks?.cut).toBe(0)
    // …and the paired positive: the backstop is reachable, by a payload the schema would reject.
    const over = scheduleLine({ id: 'j', prompt: huge })
    expect(over.asks?.cut).toBe(huge.length - SCHEDULE_PROMPT_CHARS)
    expect(over.asks?.text).toHaveLength(SCHEDULE_PROMPT_CHARS)
    expect(scheduleCutNote(over.asks?.cut ?? 0)).toBe(
      `+${huge.length - SCHEDULE_PROMPT_CHARS} more characters`,
    )
    expect(scheduleCutNote(1)).toBe('+1 more character')
  })

  it('🔴 …and the SCHEDULE ceiling is the one that had no coverage at all', () => {
    // ⛔ **Found by the adversarial pass over this diff.** `SCHEDULE_WHEN_CHARS` was pinned as a
    // number and never exercised: every `schedule` fixture in the whole desktop suite is eleven
    // characters, so swapping the argument at `scheduleLine`'s only call site — to
    // `SCHEDULE_PROMPT_CHARS`, or to any number above eleven — kept every test green, and the
    // `schedule-when-cut-*` cell was rendered by nothing. That is the shape of a ceiling asserted on
    // one side only.
    const over = 'x'.repeat(SCHEDULE_WHEN_CHARS + 7)
    const line = scheduleLine({ id: 'j', schedule: over })
    expect(line.when?.text).toHaveLength(SCHEDULE_WHEN_CHARS)
    expect(line.when?.cut).toBe(7)
    expect(scheduleCutNote(line.when?.cut ?? 0)).toBe('+7 more characters')
    // …and the paired positive: a conforming expression is not cut at all.
    expect(scheduleLine({ id: 'j', schedule: EVERY_TWO_MINUTES }).when?.cut).toBe(0)
  })

  it('⚠️ slices by CODE POINT, so a cut prompt never ends on half a character', () => {
    // `String.prototype.slice` cuts UTF-16 units; a prompt ending on an astral character at the
    // boundary would render a lone surrogate — `�` — from a function whose job is not to mislead.
    const emoji = '🛞'.repeat(SCHEDULE_PROMPT_CHARS + 5)
    const line = scheduleLine({ id: 'j', prompt: emoji })
    expect([...(line.asks?.text ?? '')]).toHaveLength(SCHEDULE_PROMPT_CHARS)
    expect(line.asks?.text.endsWith('🛞')).toBe(true)
    expect(line.asks?.cut).toBe(5)
  })
})

describe('258 · a row says what the provider said, and does not re-word it', () => {
  it('⛔ shows the cron expression VERBATIM — no parser, no “next run at”', () => {
    const line = scheduleLine(JOB)
    expect(line.when?.text).toBe(EVERY_TWO_MINUTES)
    expect(line.when?.cut).toBe(0)
    expect(line.repeat).toBe('repeats')
    expect(line.asks?.text).toBe(JOB.prompt)
    expect(line.fallback).toBeUndefined()
    // ⚠️ **`222` §4's rule stated as an equality rather than as a negative.** The first draft
    // concatenated the three cells above and asserted the joined string did not contain *"every 2
    // minutes"* — a string the test had just built out of values the three `toBe`s had already
    // pinned, so it could not fail unless one of them did. The whole-render negative that CAN fail
    // lives in `schedule-bar.render.test.ts`, over markup this file never sees.
    //
    // ⛔ What is assertable here is that the line carries no cell but the three the provider filled.
    expect(Object.keys(line).sort()).toEqual(['asks', 'id', 'repeat', 'when'])
  })

  it('says WHETHER it repeats, and says nothing when the provider did not say', () => {
    expect(scheduleLine({ ...JOB, recurring: true }).repeat).toBe(REPEAT_WORD.true)
    expect(scheduleLine({ ...JOB, recurring: false }).repeat).toBe(REPEAT_WORD.false)
    expect(REPEAT_WORD.true).toBe('repeats')
    expect(REPEAT_WORD.false).toBe('once')
    // ⛔ `074`: saying nothing arrived is a different fact from saying what did. `recurring` is
    // optional on the row, so `undefined` is silence rather than `once`.
    const silent = { id: JOB.id, schedule: JOB.schedule, prompt: JOB.prompt }
    expect(scheduleLine(silent).repeat).toBeUndefined()
    // …paired positive from the same object, so the line above is about `recurring` and nothing else.
    expect(scheduleLine(silent).when?.text).toBe(EVERY_TWO_MINUTES)
  })

  it('⛔ falls back to the id rather than drawing an empty row (106)', () => {
    // Both fields are optional on the row and both are `z.string()` with no minimum, so a job that
    // carries neither — or carries two blanks — would render a line naming nothing at all.
    const bare = scheduleLine({ id: 'e3826cc5' })
    expect(bare.fallback?.text).toBe('e3826cc5')
    expect(bare.id).toBe('e3826cc5')
    expect(bare.when).toBeUndefined()
    expect(bare.asks).toBeUndefined()
    // A blank falls THROUGH exactly as `backgroundWhat` treats a blank summary.
    expect(scheduleLine({ id: 'e3826cc5', schedule: '   ', prompt: '' }).fallback?.text).toBe(
      'e3826cc5',
    )
    // …and the paired positive: one real field is enough, and then there is no fallback at all.
    expect(scheduleLine({ id: 'e3826cc5', prompt: 'tick' }).fallback).toBeUndefined()
    // 🔴 **And the fallback is QUOTED**, which the first draft's raw `{{ line.id }}` was not — a job
    // id carrying U+202E reorders the whole row, and on a bare row the id IS the whole row.
    expect(scheduleLine({ id: 'rm \u202E x' }).fallback?.text).toBe('"rm \\u202e x"')
  })
})

describe('258 · a prompt cannot break the row it is drawn on (232 §2, 251 §2)', () => {
  /**
   * ⛔ **The same table, asked of both surfaces.** `scheduled-work.ts` cannot import
   * `background-work.ts`'s `breaksTheRow` — it is private, and that file belongs to `257` for the
   * length of this dispatch — so the predicate is duplicated and this is what keeps the duplication
   * honest. The SETS and the escaping are shared from `232` §2 and are not duplicated at all.
   *
   * ⚠️ **Written as `\\u` escapes on purpose.** Three of these six carry a character you cannot see,
   * and a test file holding them raw would be a source file whose own diff nobody could read —
   * which is the very property that makes them dangerous on the row this test is about.
   */
  const HOSTILE = [
    'two\nlines',
    'over\rwritten',
    'tab\tseparated',
    // ⛔ CVE-2021-42574, "trojan source": reads as one thing, IS another. `JSON.stringify`
    // leaves all three of these untouched, which was a real defect in `251`'s first fix — the gate
    // tested for them and the quoter let them straight through.
    'rm -rf \u202E/tmp/safe',
    'a\u2066b\u2069c',
    // U+2028: a line break to the layout engine, and in NEITHER of `hasControlCharacter`'s ranges.
    'line\u2028separator',
  ]

  it('⛔ quotes exactly what the neighbouring registry quotes, character for character', () => {
    for (const text of HOSTILE) {
      const mine = scheduleLine({ id: 'j', prompt: text }).asks?.text ?? ''
      const theirs = backgroundWhat({ id: 'b', description: text }).text
      expect(mine, text).toBe(theirs)
      // …and it really did quote: the escape is visible and the raw character is gone.
      expect(mine.startsWith('"'), text).toBe(true)
      expect(mine, text).not.toBe(text)
    }
  })

  it('…and leaves an ordinary prompt exactly as the model wrote it', () => {
    // The paired positive for the whole block above: quoting is conditional, and a prompt a person
    // typed must not come back wearing backslashes it did not have.
    const plain = 'check "person.txt" && report'
    expect(scheduleLine({ id: 'j', prompt: plain }).asks?.text).toBe(plain)
    expect(backgroundWhat({ id: 'b', description: plain }).text).toBe(plain)
  })
})

// ⚑ D-029 · this describe also said *“and says whether it can fire”* — the asleep sentence, now gone.
describe('258 · the heading counts what the PROVIDER sent, and promises nothing about firing', () => {
  it('⛔ never opens with 0, which is the defect 250 had to route around in 248’s bar', () => {
    expect(scheduleHead(level(1))).toBe('1 job is scheduled')
    expect(scheduleHead(level(2))).toBe('2 jobs are scheduled')
    // ⛔ **A level that named nothing this app can list still has a true heading**, because the count
    // is `jobs.length + dropped`. `BackgroundBar` counts `running.length` and would say "0".
    expect(scheduleHead(level(0, 1))).toBe('1 job is scheduled')
    expect(scheduleHead(level(1, 2))).toBe('3 jobs are scheduled')
  })

  it('🔴 §2 · the heading is the level’s one sentence — present tense, and nothing beside it', () => {
    // ⛔ **PRESENT tense, and the first draft's future tense was the over-claim.** It read *"1 job
    // will wake this conversation"* awake and *"1 job is still scheduled"* closed; the adversarial
    // pass over this diff refuted the promise outright — the level is restated only at TURN END, so
    // a job the model deleted mid-turn, or a one-shot whose time has passed, would go on being
    // promised for as long as nobody spoke. The heading makes no claim that needs a clock.
    expect(scheduleHead(level(1))).toBe('1 job is scheduled')
    expect(scheduleHead(level(2))).toBe('2 jobs are scheduled')
    // ⚑ **D-029 moved this fact.** The heading was the half that did not change, and a second
    // sentence carried the whole 258 §2 difference — `SCHEDULE_ASLEEP`, *"Nothing here fires until
    // this conversation takes its next message"* (D-017b's wording of it). It is false now: this app
    // starts a stopped conversation in time for the jobs its provider will bring back. So the
    // sentence went with the flag it read, and the vocabulary has no asleep word left to draw.
    expect(Object.keys(scheduleWords)).not.toContain('SCHEDULE_ASLEEP')
    // …the paired positive, from the same module: the heading's own function is what it still exports.
    expect(Object.keys(scheduleWords)).toContain('scheduleHead')
  })

  it('says out loud when the list is UNDERSTATING what is scheduled (092/247 §3)', () => {
    expect(droppedScheduleNote(1)).toBe(
      '1 of them is not listed here — this conversation cannot name it',
    )
    expect(droppedScheduleNote(3)).toBe(
      '3 of them are not listed here — this conversation cannot name them',
    )
  })
})

describe('258 · ONE predicate — the bar and every word ask `scheduleHeld` (D-029)', () => {
  it('⛔ `dropped` alone is enough — a registry that undercounts is worse than none', () => {
    const undercounting = { jobs: [], dropped: 1 }
    const empty = { jobs: [], dropped: 0 }
    expect(scheduleHeld(undercounting)).toBe(true)
    // …and the paired negative: an empty level really does say no.
    expect(scheduleHeld(empty)).toBe(false)
  })

  it('🔴 a CLOSED conversation still SHOWS its schedule — and, since D-029, it is held', () => {
    // ⚑ **D-029 moved this fact.** 258 §2 made this the one place two predicates differed: the bar
    // asked `scheduleHeld` and drew the rows under a sentence saying they could not fire, while every
    // word asked `somethingScheduled` — held AND not `sleeping` — so a closed conversation read
    // *idle*. This app now starts a stopped conversation in time for the jobs its provider will
    // bring back, so the asymmetry went with `somethingScheduled` and the flag: a closed
    // conversation's level is held like any other. ⚠️ Which of those jobs a start really brings back
    // only the host knows, so a view drawn from its ledger wears the host's word (`AgentCard`).
    // ⚠️ Driven through the FOLD, because a registry no longer has a field that says *closed*.
    const state = createTranscript()
    applyEvent(state, { type: 'scheduled_work', jobs: [JOB], source: 'hook/Stop' } as RuntimeEvent)
    applyEvent(state, { type: 'session', state: 'ended' } as RuntimeEvent)
    // …the premise, read off the fold rather than assumed: the close really happened.
    expect(state.ended).toBe(true)
    expect(scheduleHeld(state.schedule)).toBe(true)
    // ⛔ **…and nothing is left for a second predicate to read**: the registry is its level and only
    // that, and the vocabulary no longer exports the narrower question. ⚑ F035's `left` is the rows
    // the last level took off, kept for their first listing, and says nothing about a close.
    expect(Object.keys(state.schedule).sort()).toEqual(['dropped', 'jobs', 'left'])
    expect(Object.keys(scheduleWords)).not.toContain('somethingScheduled')
    // …and the paired negative from the same fold: a conversation that closes with nothing scheduled
    // is not held, so the `true` above is about the level and not about the close.
    const nothing = createTranscript()
    applyEvent(nothing, { type: 'session', state: 'ended' } as RuntimeEvent)
    expect(nothing.ended).toBe(true)
    expect(scheduleHeld(nothing.schedule)).toBe(false)
  })
})

describe('258 · one vocabulary, so the pill and the bar cannot name one state two ways', () => {
  it('⛔ the pill’s label is the bar’s own word, capitalised — never a second literal', () => {
    // `250` wrote three literals into `agent-state.ts` first and its own adversarial pass took them
    // back out. This is that finding pinned before it can happen again.
    expect(STANDING_LABEL.scheduled).toBe('Scheduled')
    expect(STANDING_LABEL.scheduled.toLowerCase()).toBe(SCHEDULED)
    // ⚠️ **Two anchors on the heading, not one.** The literal is what a person reads; the word is
    // what the pill borrows. ⛔ A `toContain(SCHEDULED)` ALONE would hold for any value of the
    // constant — including `'banana'` — because `scheduleHead` interpolates the same symbol.
    expect(scheduleHead(level(1))).toBe('1 job is scheduled')
    expect(scheduleHead(level(1))).toContain(SCHEDULED)
  })
})
