import { describe, expect, it } from 'vitest'
import type { SessionRef } from '@brobot2/runtime'
import { quotedLiteral, type TranscriptEvent } from '../src/shared/runtime-ipc'
import { clockTime, clockTimeFrom } from '../src/shared/clock'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { composeReadable } from '../src/renderer/src/lib/readable-export'
import { SCHEDULE_PROMPT_CHARS } from '../src/renderer/src/lib/scheduled-work'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import {
  applyEvent,
  createTranscript,
  type NoticeItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * # 🔴 F035's window half — a turn a scheduled job woke says which job (`9c566be7`)
 *
 * When the host names the one one-shot whose minute had come as the provider began a turn by itself
 * (`provider_turn.oneShotCameDue`), the transcript fold draws *"Woken by its scheduled job (14:45):
 * check the deploy"* in place of the plain *"turn started by Claude itself"*:
 *
 * - at the JOB's own minute, with its day when the turn began on another day;
 * - the prompt through the schedule bar's guard (`scheduleLine`): quoted when it holds a line break
 *   or a reordering character, clipped where the bar clips it, with "…";
 * - shown in normal mode as well as debug mode, and kept by the reading export — while the plain,
 *   unnamed line stays debug-only chrome and out of the export;
 * - the Events tab's line names the job too.
 *
 * Pure folds over `createTranscript()`, as `a-wake-on-screen-begins-afresh.test.ts` drives F080's
 * plain line. The times are built on the local clock, so the day rule reads the same in any zone.
 */

const ref: SessionRef = {
  provider: 'claude',
  sessionId: 'sess-f035w',
  cwd: '/tmp/scratch',
  rotation: 0,
}

/** 28 September 2026, 14:45 on this machine's clock — the job's own minute. */
const DUE = new Date(2026, 8, 28, 14, 45).getTime()
/** Seven minutes later, the same day: the turn row's own moment when it was woken late. */
const SAME_DAY = new Date(2026, 8, 28, 14, 52).getTime()
/** The next morning: a turn woken after a stop, on another day. */
const NEXT_DAY = new Date(2026, 8, 29, 9, 0).getTime()

const named = (prompt?: string, id = 'job-a'): TranscriptEvent => ({
  type: 'provider_turn',
  oneShotCameDue: {
    id,
    schedule: '45 14 28 9 *',
    ...(prompt === undefined ? {} : { prompt }),
    dueAt: DUE,
  },
})

const UNNAMED: TranscriptEvent = { type: 'provider_turn' }
const STARTED: TranscriptEvent = { type: 'session', state: 'started', ref }

function fold(...steps: (TranscriptEvent | [TranscriptEvent, number])[]): TranscriptState {
  const state = createTranscript()
  for (const step of steps) {
    if (Array.isArray(step)) applyEvent(state, step[0], step[1])
    else applyEvent(state, step)
  }
  return state
}

const notices = (state: TranscriptState): NoticeItem[] =>
  state.items.flatMap((item) => (item.kind === 'notice' ? [item] : []))

/** The one line the turn drew — the last notice of a fold that ends with the turn row. */
const lineOf = (state: TranscriptState): NoticeItem => {
  const last = notices(state).at(-1)
  if (last === undefined) throw new Error('the fold drew no notice')
  return last
}

describe('F035 · the line a turn the host names a job for draws', () => {
  it('🔴 a named turn reads "Woken by its scheduled job (HH:MM): <prompt>", at the job’s own minute', () => {
    const state = fold(STARTED, [named('check the deploy'), SAME_DAY])
    const line = lineOf(state)
    expect(line.level).toBe('info')
    expect(line.wokenByAJob).toBe(true)
    expect(line.text).toBe(`Woken by its scheduled job (${clockTime(DUE)}): check the deploy`)
    // ⛔ The turn row's own moment is not the job's minute — the premise first, so the line below is
    // about which of the two the fold chose.
    expect(clockTime(SAME_DAY)).not.toBe(clockTime(DUE))
    expect(line.text).not.toContain(clockTime(SAME_DAY))
    // ⛔ And it REPLACES the plain line: one turn, one line.
    expect(notices(state).some((one) => one.text.startsWith('turn started by'))).toBe(false)
  })

  it('⛔ paired: an unnamed turn keeps "turn started by Claude itself", and is not marked', () => {
    const state = fold(STARTED, [UNNAMED, SAME_DAY])
    const line = lineOf(state)
    expect(line.text).toBe('turn started by Claude itself')
    expect(line.wokenByAJob).toBeUndefined()
    expect(notices(state).some((one) => one.text.startsWith('Woken by'))).toBe(false)
  })

  it('🔴 the day is added when the turn began on another day — and only then', () => {
    // ⚑ The premise: on another day the day-and-time form differs from the bare time.
    expect(clockTimeFrom(DUE, NEXT_DAY)).not.toBe(clockTime(DUE))
    const late = lineOf(fold(STARTED, [named('check the deploy'), NEXT_DAY]))
    expect(late.text).toBe(
      `Woken by its scheduled job (${clockTimeFrom(DUE, NEXT_DAY)}): check the deploy`,
    )
    // …and the same day says the bare time, the one "scheduled · 14:45" showed.
    expect(clockTimeFrom(DUE, SAME_DAY)).toBe(clockTime(DUE))
    const prompt = lineOf(fold(STARTED, [named('check the deploy'), SAME_DAY]))
    expect(prompt.text).toBe(`Woken by its scheduled job (${clockTime(DUE)}): check the deploy`)
    // ⚑ A row with no moment (a fold fed no `at`) still says the job's minute.
    const bare = lineOf(fold(STARTED, named('check the deploy')))
    expect(bare.text).toBe(`Woken by its scheduled job (${clockTime(DUE)}): check the deploy`)
  })

  it('🔴 a prompt that holds a line break or a reordering character is QUOTED; a plain one is not', () => {
    const broken = 'check\nthe deploy'
    const brokenLine = lineOf(fold(STARTED, [named(broken), SAME_DAY])).text
    expect(brokenLine).toBe(
      `Woken by its scheduled job (${clockTime(DUE)}): ${quotedLiteral(broken)}`,
    )
    expect(brokenLine).not.toContain('\n')

    const reordered = 'check the ‮yolped'
    const reorderedLine = lineOf(fold(STARTED, [named(reordered), SAME_DAY])).text
    expect(reorderedLine).toBe(
      `Woken by its scheduled job (${clockTime(DUE)}): ${quotedLiteral(reordered)}`,
    )
    expect(reorderedLine).not.toContain('‮')

    // ⛔ The paired negative: a plain prompt is drawn as the model wrote it, with no quotes.
    const plain = lineOf(fold(STARTED, [named('check the deploy'), SAME_DAY])).text
    expect(plain).not.toContain('"')
  })

  it('🔴 a prompt past the bar’s ceiling is clipped where the bar clips it, with "…"; one at it is not', () => {
    const long = 'x'.repeat(SCHEDULE_PROMPT_CHARS + 6)
    expect(lineOf(fold(STARTED, [named(long), SAME_DAY])).text).toBe(
      `Woken by its scheduled job (${clockTime(DUE)}): ${'x'.repeat(SCHEDULE_PROMPT_CHARS)}…`,
    )
    const exact = 'x'.repeat(SCHEDULE_PROMPT_CHARS)
    expect(lineOf(fold(STARTED, [named(exact), SAME_DAY])).text).toBe(
      `Woken by its scheduled job (${clockTime(DUE)}): ${exact}`,
    )
  })

  it('⚑ a job with no prompt, or a blank one, is named by its minute alone — no dangling colon', () => {
    for (const prompt of [undefined, '   ']) {
      const line = lineOf(fold(STARTED, [named(prompt), SAME_DAY]))
      expect(line.text).toBe(`Woken by its scheduled job (${clockTime(DUE)})`)
      expect(line.wokenByAJob).toBe(true)
    }
  })

  it('⚑ a named turn is still a fresh turn: the pill of the turn before does not carry into it', () => {
    const state = fold(STARTED, { type: 'activity', phase: 'tool', detail: 'Bash' })
    expect(state.activity).toEqual({ phase: 'tool', detail: 'Bash' })
    applyEvent(state, named('check the deploy'), SAME_DAY)
    expect(state.activity).toBeNull()
  })
})

describe('F035 · the named line is content: shown in both modes and exported; the plain one is not', () => {
  const state = fold(STARTED, [UNNAMED, SAME_DAY], [named('check the deploy'), NEXT_DAY])
  const plain = notices(state).find((one) => one.text === 'turn started by Claude itself')
  const woken = notices(state).find((one) => one.wokenByAJob === true)

  it('premise: the fold drew both lines, each at `info`', () => {
    expect(plain?.level).toBe('info')
    expect(woken?.level).toBe('info')
  })

  it('🔴 the named line is shown in normal mode AND debug mode', () => {
    if (woken === undefined) throw new Error('no named line')
    expect(isVisibleIn('normal', woken)).toBe(true)
    expect(isVisibleIn('debug', woken)).toBe(true)
  })

  it('⛔ paired: the plain line stays debug-only', () => {
    if (plain === undefined) throw new Error('no plain line')
    expect(isVisibleIn('normal', plain)).toBe(false)
    expect(isVisibleIn('debug', plain)).toBe(true)
  })

  it('🔴 the reading export keeps the named line, and drops the plain one', () => {
    if (woken === undefined) throw new Error('no named line')
    const exported = composeReadable('t', state.items, { toolActivity: false })
    expect(exported).toContain(woken.text)
    expect(exported).toContain('This app · info')
    // ⛔ The paired negative from the same items.
    expect(exported).not.toContain('turn started by Claude itself')
  })

  it('⛔ …and a fold with only the plain line exports no `info` block at all for it', () => {
    const only = fold(STARTED, [UNNAMED, SAME_DAY])
    const exported = composeReadable('t', only.items, { toolActivity: false })
    expect(exported).not.toContain('turn started by Claude itself')
    expect(exported).not.toContain('Woken by its scheduled job')
  })
})

describe('F035 · the Events tab names the job', () => {
  it('🔴 a named turn reads "started by the provider · job-a (HH:MM)", at the job’s minute', () => {
    expect(describeEvent(named('check the deploy'))).toBe(
      `started by the provider · job-a (${clockTime(DUE)})`,
    )
    // ⚑ The prompt is not on the debug line, as on `scheduled_work`'s.
    expect(describeEvent(named('check the deploy'))).not.toContain('check the deploy')
  })

  it('⛔ paired: an unnamed turn reads "started by the provider" alone', () => {
    expect(describeEvent(UNNAMED)).toBe('started by the provider')
  })
})
