import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 **The event whitelist in `smoke:ui` step 7, held to the app's real vocabulary** (345 §2, from
 * 342's failure list).
 *
 * ## ⛔ A rule that depends on remembering has failed twice
 *
 * Step 7 asserts the renderer only ever drew event types it knows, against a Set typed by hand.
 * `097` found **seven** types missing from it, every one already shipping, and ruled that *"a
 * whitelist that lags the vocabulary does not fail safe: it turns the first run that DOES provoke
 * one into a red step with a message about the app being strange, when the strange thing is the
 * list."* The remedy it wrote down — add the type in the dispatch that ships it — was followed once,
 * at `199`, and then lapsed. ⚠️ **`342` found seven missing again**: `workflow_run`,
 * `background_work`, `scheduled_work`, `provider_commands`, `memory_recall`, `memory_note` and
 * `memory_loaded`.
 *
 * ⚑ **So the remedy is no longer a rule anybody has to remember.** This derives the vocabulary from
 * the two files that own it and fails when the smoke's copy disagrees — in EITHER direction, because
 * a name left behind after a type is deleted is a whitelist that permits something that cannot
 * happen.
 *
 * ## ⚠️ Why the smoke keeps a hand-typed copy at all
 *
 * `ui-live-smoke.mjs` imports nothing but node builtins and `scripts/lib/*.mjs` — the same
 * constraint `step-census.test.mjs` records for `DEGRADED_LABEL_PREFIX`, and the same answer: the
 * constant reaches the smoke as text and a `ci` test binds it to its source. What is derived here is
 * not the list but the AGREEMENT.
 *
 * ## ⛔ The vocabulary has two halves and only one of them has a runtime list
 *
 * `RUNTIME_EVENT_TYPES` is an exported array and is itself already pinned to the Zod union by
 * `packages/runtime/test/events.test.ts`. The app-authored half — what BroBot records about what WE
 * did — has no runtime list to derive from, *"which is exactly why it was possible to forget it
 * existed"* (`apps/desktop/test/transcript.test.ts`). It is read off the arms of the
 * `TranscriptEvent` union instead, so adding an arm is enough to be counted.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SMOKE = join(HERE, '../ui-live-smoke.mjs')
const EVENTS = join(HERE, '../../packages/runtime/src/events.ts')
const IPC = join(HERE, '../../apps/desktop/src/shared/runtime-ipc.ts')

/**
 * Read one match out of a source file, or say which file stopped being readable.
 *
 * ⛔ **A derivation that quietly finds nothing is worse than no derivation**, because an empty list
 * compared against an empty list is a green that checked over nothing. Every extraction below goes
 * through here.
 */
function lift(path, what, pattern) {
  const found = readFileSync(path, 'utf8').match(pattern)
  if (found === null) {
    throw new Error(`${what} is no longer readable from ${path} — this guard is checking nothing`)
  }
  return found
}

/** The provider vocabulary: `RUNTIME_EVENT_TYPES`, as values. */
function runtimeTypes() {
  const block = lift(
    EVENTS,
    'RUNTIME_EVENT_TYPES',
    /export const RUNTIME_EVENT_TYPES = \[\n([\s\S]*?)\n\] as const/,
  )[1]
  return [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
}

/**
 * The app-authored vocabulary: every arm of `TranscriptEvent` that is not `RuntimeEvent`.
 *
 * ⛔ **The union block is captured to the blank line, not by repeating an arm pattern** (345
 * review). `((?:\s*\|\s*\w+\n)+)` was the first draft and it stops at the first line that is not
 * `| Name` — so one explanatory comment between two arms, which is this repo's prevailing style,
 * would silently drop every arm after it and `lift` would not throw. ⚠️ **That is the exact failure
 * this whole file exists to prevent**, one level down: a derived list that quietly gets shorter
 * agrees with a whitelist that quietly got shorter. A comment carrying a `|` would instead add a
 * phantom arm, which has no `export interface` and throws below — loud, which is the right direction.
 */
function appAuthoredTypes() {
  const source = readFileSync(IPC, 'utf8')
  const union = lift(
    IPC,
    'the TranscriptEvent union',
    /export type TranscriptEvent =\n([\s\S]*?)\n\n/,
  )[1]
  const arms = [...union.matchAll(/\|\s*(\w+)/g)]
    .map((match) => match[1])
    .filter((name) => name !== 'RuntimeEvent')
  return arms.map((name) => {
    let declaration = source
    let at = declaration.indexOf(`export interface ${name} {`)
    if (at === -1) {
      const imported = [...source.matchAll(/import type \{([^}]+)\} from '([^']+)'/g)].find((one) =>
        one[1].split(',').some((word) => word.trim() === name),
      )
      if (imported !== undefined && imported[2].startsWith('.')) {
        declaration = readFileSync(resolve(dirname(IPC), imported[2] + '.ts'), 'utf8')
        at = declaration.indexOf(`export interface ${name} {`)
      }
    }
    if (at === -1) throw new Error(`${name} is an arm of TranscriptEvent with no interface`)
    const discriminant = declaration
      .slice(at, at + 400)
      .match(/^\s*(?:readonly )?type: '([a-z_]+)'$/m)
    if (discriminant === null) {
      throw new Error(`${name} declares no literal \`type\` discriminant this guard can read`)
    }
    return discriminant[1]
  })
}

/** The `known` Set step 7 filters against, read out of the smoke's own source. */
function whitelisted() {
  const body = lift(
    SMOKE,
    "step 7's `known` Set",
    /\n {4}const known = new Set\(\[\n([\s\S]*?)\n {4}\]\)\n/,
  )[1]
  return body
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .flatMap((line) => [...line.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]))
}

describe("step 7's whitelist cannot lag the vocabulary again", () => {
  /**
   * ⚠️ **The floors are the address.** Three lists that all read empty agree perfectly, and this is
   * the only assertion that can tell a real agreement from three failed reads. The counts at 345
   * were 26 / 7 / 33.
   */
  it('⛔ all three lists were really read', () => {
    expect(runtimeTypes().length).toBeGreaterThanOrEqual(20)
    expect(appAuthoredTypes().length).toBeGreaterThanOrEqual(5)
    expect(whitelisted().length).toBeGreaterThanOrEqual(25)
  })

  /**
   * ⛔ **The union block is read to its END, and a floor cannot say that.** A capture that stopped
   * early would still clear the floor above — review measured a truncation to 6 arms passing it. So
   * this counts the arms in the block against the `|` in the declaration itself.
   */
  it('⛔ every arm of the union is derived, not just the ones before the first comment', () => {
    const source = readFileSync(IPC, 'utf8')
    const declared = source
      .slice(source.indexOf('export type TranscriptEvent ='))
      .split('\n\n')[0]
      .split('\n')
      .filter((line) => /^\s*\|\s*\w+\s*$/.test(line)).length
    expect(
      declared,
      'the TranscriptEvent union no longer reads as one arm per line',
    ).toBeGreaterThan(5)
    // `- 1` for the `RuntimeEvent` arm, which contributes its own list rather than one name.
    expect(appAuthoredTypes()).toHaveLength(declared - 1)
  })

  it('🔴 names exactly the types a transcript can hold — no more and no fewer', () => {
    expect(new Set(whitelisted())).toEqual(new Set([...runtimeTypes(), ...appAuthoredTypes()]))
  })

  /**
   * ⛔ **The four `342` would have caught, named individually.** The assertion above is one line and
   * would go red for any drift; these say WHICH drift this dispatch was about, so a future edit that
   * drops one of them fails with its name rather than with a set difference.
   */
  it.each(['scheduled_work', 'background_work', 'provider_commands', 'memory_loaded'])(
    '⚑ knows %s, which shipped after the list was last hand-corrected',
    (type) => {
      expect(whitelisted()).toContain(type)
    },
  )

  /** The extractors refuse a source they can no longer read, rather than returning nothing. */
  it.each([
    [
      'a renamed RUNTIME_EVENT_TYPES',
      EVENTS,
      /export const RUNTIME_EVENT_TYPES = \[\n([\s\S]*?)\n\] as const/,
    ],
    ['a restructured TranscriptEvent', IPC, /export type TranscriptEvent =\n((?:\s*\|\s*\w+\n)+)/],
  ])('⛔ %s is an error, not an empty answer', (_what, path, pattern) => {
    expect(() => lift(path, 'the thing', pattern)).not.toThrow()
    expect(() => lift(path, 'the thing', /this string is in no source file 6f3a/)).toThrow(
      /checking nothing/,
    )
  })
})
