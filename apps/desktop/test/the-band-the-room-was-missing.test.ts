import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROSTER_EVERY_MS } from '../src/renderer/src/lib/team-roster'
import { ACTIVITY_READ_EVERY_MS } from '../src/renderer/src/lib/recent-activity'
import { openElsewhere } from '../src/renderer/src/lib/taking-over'
import { RUNNING_STATES } from '../src/shared/runtime-ipc'

/**
 * 🔴 **472 · the band the room was missing** — `467` put the roster on the wire and this was the
 * fold that drew it, asserted with no renderer at all.
 *
 * ⚑ **D-016 took the room out** — the project workspace, its band and `project-roster.ts` with
 * them — so every case about the band went with it. ⛔ **Two things it pinned outlived it**, moved
 * rather than deleted: `openElsewhere` is `taking-over.ts`'s, and the cadence is the Team page's
 * (`team-roster.ts`). They are asserted here, where they were first asserted.
 */

const here = dirname(fileURLToPath(import.meta.url))
const ROSTER = join(here, '../src/renderer/src/lib/team-roster.ts')

describe('§3 · where it is is off `running`', () => {
  /** ⛔ **The vocabulary is closed, and one pair of it — no more — is somewhere else.** */
  it('⚑ exactly one (running, held) pair is open elsewhere, over every `RunningState`', () => {
    // ⚑ **Walked from `RUNNING_STATES` and never from a literal list.** ⛔ That list is deliberately
    // the SOURCE of the type, precisely so a new member must be decided everywhere; a hand-written
    // array here would let a fourth state fall through {@link openElsewhere} unasked.
    const elsewhere: string[] = []
    for (const state of RUNNING_STATES) {
      for (const held of [true, false]) {
        if (openElsewhere(state, held)) elsewhere.push(`${state}${held ? ' · held' : ''}`)
      }
    }
    expect(elsewhere).toEqual(['in-a-window'])
    expect(RUNNING_STATES).toHaveLength(3)
  })
})

describe('§7 · the cadence is derived', () => {
  /**
   * ⛔ **`LOOK_EVERY_MS`'s own rule: a cadence is DERIVED, never chosen.** ⚑ The Team page's read
   * and the digest are one question — a reading nothing pushes a change of, neither watching a
   * deadline — so this is that number by derivation and not a third one somebody picked.
   */
  it('⚑ the roster’s tick is Recent activity’s number, by derivation', () => {
    expect(ROSTER_EVERY_MS).toBe(ACTIVITY_READ_EVERY_MS)
    const roster = readFileSync(ROSTER, 'utf8')
    expect(roster).toContain('export const ROSTER_EVERY_MS = ACTIVITY_READ_EVERY_MS')
    // ⛔ **The control, and it is the assertion that matters**: no literal millisecond anywhere in
    // this module's CODE, so the equality above cannot be two numbers that happen to agree.
    // ⚠️ **Prose-stripped**, because the docblock above that line quotes the number it refuses —
    // `a-source-census-must-strip-prose-before-it-asserts`.
    expect(withoutBlockProse(roster)).not.toMatch(/\b\d{2,3}_\d{3}\b/)
    // ⚑ The planted control: the prose really does carry one, so the stripper is doing work.
    expect(roster).toMatch(/\b\d{2,3}_\d{3}\b/)
  })
})

/** Block comments removed — `send-refusals.test.ts`'s stripper, narrowed to the one shape here. */
function withoutBlockProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}
