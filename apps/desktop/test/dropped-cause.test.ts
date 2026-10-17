import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import { SessionCrons } from '../../../packages/runtime/src/claude/session-crons'
import { normalizeMessage } from '../../../packages/runtime/src/claude/normalize'
import { MAX_SCHEDULED_JOBS } from '../../../packages/runtime/src/scheduled-work'
import { MAX_BACKGROUND_WORK } from '../../../packages/runtime/src/background-work'
import { describeEvent } from '../src/renderer/src/lib/describe-event'

/**
 * 263 §1 · **The raw line may not invent a cause the wire cannot support.**
 *
 * ⛔ **This file exists because every test on both sides passed while the screen said something
 * false.** `packages/runtime/test/scheduled-work.test.ts` proves a row with no id increments
 * `dropped`; `apps/desktop/test/scheduled-work.test.ts` independently locked in the words *"beyond
 * the cap"*. Neither could be wrong on its own, and **nothing sent the producer's own malformed-row
 * event through the describer** — so three cron rows, one of them unreadable, rendered as
 * *"1 scheduled · ok@\* \* \* \* \* · 2 beyond the cap · h"* on a payload that never came within 97
 * rows of the cap. ⚑ **The killing test crosses that seam, which is why this one imports the real
 * producer rather than composing an event by hand.**
 *
 * ⚠️ **Composed events would have re-created the blind spot exactly.** A test that writes
 * `{ type: 'scheduled_work', dropped: 2 }` is asserting on a fixture the author chose; it can never
 * discover that the field ARRIVES for a reason the author did not have in mind. The producers below
 * are `claude/session-crons.ts` and `claude/normalize.ts` themselves.
 *
 * ⛔ **`file_change` is here as the CONTROL, not as an oversight.** Its `dropped` has exactly one
 * cause, so its line still names it — and if someone later "unifies" the three, this file reddens.
 */

function sdk(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage
}

/** `background_tasks_changed` — the level frame, exactly as `background-work.test.ts` builds it. */
const level = (tasks: unknown[]): SDKMessage =>
  sdk({ type: 'system', subtype: 'background_tasks_changed', tasks, session_id: 's' })

const backgroundOf = (
  events: RuntimeEvent[],
): Extract<RuntimeEvent, { type: 'background_work' }> => {
  const found = events.find((event) => event.type === 'background_work')
  expect(found, 'the producer emitted no background_work event at all').toBeTruthy()
  return found as Extract<RuntimeEvent, { type: 'background_work' }>
}

describe('263 §1 · a level that is understating itself does not blame the cap', () => {
  /**
   * ⛔ **The reviewer's reproduction, verbatim.** Three rows, a cap of 100, and two of them
   * unusable — one with no `id`, one that is not an object at all.
   */
  it('🔴 `scheduled_work`: three rows and a cap of 100 no longer render as "beyond the cap"', () => {
    const event = new SessionCrons().observe(
      [{ id: 'ok', schedule: '* * * * *', prompt: 'p' }, { schedule: 'bad', prompt: 'p' }, null],
      'h',
    )
    expect(event, 'the producer published nothing to describe').toBeTruthy()
    // The premise, straight off the producer: it kept one and counted two.
    expect(event!.jobs).toHaveLength(1)
    expect(event!.dropped).toBe(2)

    const line = describeEvent(event!)
    // ⛔ The defect: nothing was beyond the cap, and the screen said two things were.
    expect(line, 'the cause is not on the wire and may not be on the screen').not.toContain('cap')
    expect(line).toContain('2 this level could not name')
    // ⚑ The paired positive (193): the line still says everything it said before. Without these the
    // assertion above would pass just as happily against a describer that returned the empty string.
    expect(line).toContain('1 scheduled')
    expect(line).toContain('ok@* * * * *')
    // ⚠️ **Anchored to the END, not `toContain('h')`.** The source in the reviewer's reproduction is
    // the single character `h`, and `toContain` for it is satisfied by the `h` in *"this level"* —
    // a vacuous assertion, found by the adversarial pass over this diff.
    expect(line).toMatch(/ · h$/)
  })

  /**
   * ⚠️ **The cap case, and it must read the SAME.** This is what makes the wording honest rather
   * than merely vaguer: the event carries one number for two causes, so a line that switched back
   * to *"beyond the cap"* here would be claiming a distinction the reader cannot rely on — the very
   * next payload could produce the identical number for the opposite reason.
   */
  it('⚑ …and a level that really IS over the cap reads exactly the same, because it must', () => {
    const many = Array.from({ length: MAX_SCHEDULED_JOBS + 4 }, (_unused, i) => ({
      id: `job_${i}`,
      schedule: '*/5 * * * *',
    }))
    const event = new SessionCrons().observe(many, 'hook/Stop')
    expect(event!.jobs).toHaveLength(MAX_SCHEDULED_JOBS)
    expect(event!.dropped).toBe(4)

    const line = describeEvent(event!)
    expect(line).toContain('4 this level could not name')
    expect(line).not.toContain('cap')
  })

  it('🔴 `background_work`: an entry with no `task_id` does not become a cap either', () => {
    const event = backgroundOf(
      normalizeMessage(
        level([
          { task_id: 'b23pvshmy', task_type: 'local_bash', description: 'the one we can name' },
          { task_type: 'local_bash', description: 'no id at all' },
          'not even a record',
        ]),
      ),
    )
    expect(event.running).toHaveLength(1)
    expect(event.dropped, 'the producer counts BOTH unusable rows').toBe(2)

    const line = describeEvent(event)
    expect(line).not.toContain('cap')
    expect(line).toContain('2 this level could not name')
    expect(line).toContain('1 running')
    expect(line).toContain('background_tasks_changed')
  })

  it('⚑ …and its cap of 200, likewise', () => {
    const many = Array.from({ length: MAX_BACKGROUND_WORK + 3 }, (_unused, i) => ({
      task_id: `t_${i}`,
      task_type: 'local_bash',
    }))
    const event = backgroundOf(normalizeMessage(level(many)))
    expect(event.running).toHaveLength(MAX_BACKGROUND_WORK)
    expect(event.dropped).toBe(3)
    expect(describeEvent(event)).toContain('3 this level could not name')
    expect(describeEvent(event)).not.toContain('cap')
  })

  it('⚠️ nothing dropped says nothing at all — the ordinary frame is unchanged', () => {
    const clean = new SessionCrons().observe([{ id: 'ok', schedule: '@daily' }], 'hook/Stop')
    expect(clean!.dropped).toBeUndefined()
    expect(describeEvent(clean!)).not.toContain('could not name')
    expect(describeEvent(clean!)).toContain('1 scheduled')
  })

  /**
   * ⛔ **The control.** `file-change.ts:206` increments `dropped` in exactly ONE place — a report
   * naming more files than `MAX_CHANGED_FILES` — so *"beyond the cap"* is a fact there, and the two
   * wordings in this describer are a real distinction rather than an inconsistency left behind.
   */
  it('⛔ `file_change` still names the cap, because for that event the cap is the only cause', () => {
    const line = describeEvent({
      type: 'file_change',
      changes: [{ path: 'a.ts', status: 'modified' }],
      dropped: 7,
      source: 'turn/diff/updated',
    } as never)
    expect(line).toContain('7 beyond the cap')
    expect(line).not.toContain('could not name')
  })
})
