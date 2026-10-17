import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * ⚑ **704 · `697` H-k — the README says what `pnpm run ci` runs, and this holds it to the chain.**
 *
 * ⛔ The scripts table said *"`engine:check` + `typecheck` + `lint` + `test` + `build`"* while the
 * chain ran eleven steps: a list that was true when it was written and nothing re-read after six
 * steps joined (`a-number-can-survive-the-death-of-its-derivation`). ⚑ So the list is DERIVED here
 * from `package.json`'s own `ci` script, and the README must say exactly that, in that order.
 *
 * ⚠️ **And only once.** A second list elsewhere in the README would drift the way the first did, so
 * any line naming two or more of the chain's steps in backticks — bare (`lint`) or as a command
 * (`pnpm lint`, `pnpm run lint`) — must be inside the pinned sentence. ⚑ **One named exception**:
 * the scripts table's *Individual gates* row lists commands a person runs one at a time, and says so;
 * it makes no claim about what `ci` runs (704's review found the first version of this census blind
 * to that spelling).
 */

const LEAD = '`pnpm run ci` runs, in this order, and stops at the first that fails:'

/** The chain, step by step — `pnpm run X && pnpm run Y …`, and nothing else is a shape it accepts. */
export function ciSteps(script) {
  return script.split('&&').map((part) => {
    const step = /^pnpm run ([\w:-]+)$/.exec(part.trim())
    if (!step) throw new Error(`a ci part this census cannot read: ${JSON.stringify(part.trim())}`)
    return step[1]
  })
}

/** The steps the README's sentence names, in its order — `null` when it has no such sentence. */
export function readmeSays(readme) {
  const at = readme.indexOf(LEAD)
  if (at < 0) return null
  const end = readme.indexOf('\n\n', at)
  const sentence = readme.slice(at + LEAD.length, end < 0 ? undefined : end)
  return [...sentence.matchAll(/`([\w:-]+)`/g)].map((match) => match[1])
}

/** The one README line allowed to name several gate steps: it lists them to be run ONE AT A TIME. */
const ONE_AT_A_TIME = '| Individual gates.'

/** Every README line, outside the pinned sentence, that names two or more of the chain's steps. */
export function otherLists(readme, steps) {
  const at = readme.indexOf(LEAD)
  const end = at < 0 ? -1 : readme.indexOf('\n\n', at)
  const lines = []
  let offset = 0
  for (const line of readme.split('\n')) {
    const inside = at >= 0 && offset >= at && (end < 0 || offset < end)
    offset += line.length + 1
    if (inside || line.includes(ONE_AT_A_TIME)) continue
    const named = new Set(
      [...line.matchAll(/`(?:pnpm (?:run )?)?([\w:-]+)`/g)].map((match) => match[1]),
    )
    if (steps.filter((step) => named.has(step)).length >= 2) lines.push(line.trim())
  }
  return lines
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
// ⚑ The developer guide, which the README was until the public README took its place.
const readme = readFileSync(join(ROOT, 'docs', 'development.md'), 'utf8')
const steps = ciSteps(pkg.scripts.ci)

describe('704 · 697 H-k — the README names what `pnpm run ci` runs', () => {
  it('⚑ the README lists exactly the chain’s steps, in the chain’s order', () => {
    expect(steps.length).toBeGreaterThan(5) // the premise: more than the five the old row named
    expect(readmeSays(readme)).toEqual(steps)
  })

  it('⛔ and nowhere else lists them — a second list is the one that drifts', () => {
    expect(otherLists(readme, steps)).toEqual([])
  })

  it('⚑ controls: a list one step short, one out of order, and main’s old table row are all caught', () => {
    const planted = (said) => `${LEAD} ${said.map((s) => `\`${s}\``).join(' → ')}.\n\n`
    expect(readmeSays(planted(steps))).toEqual(steps)
    expect(readmeSays(planted(steps.slice(0, -1)))).not.toEqual(steps)
    expect(readmeSays(planted([...steps].reverse()))).not.toEqual(steps)
    expect(readmeSays('no such sentence here\n')).toBeNull()
    const mains =
      '| `pnpm run ci` | The Step-0 gate: `engine:check` + `typecheck` + `lint` + `test` + `build`. |\n'
    expect(otherLists(mains, steps)).toHaveLength(1)
    // ⚑ …and in the scripts table's own spelling, which the first version of this census missed.
    const spelled = '| `pnpm run ci` | Runs `pnpm run typecheck` then `pnpm lint`. |\n'
    expect(otherLists(spelled, steps)).toHaveLength(1)
    // ⚑ The named exception holds only for its own row.
    const oneAtATime =
      '| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | Individual gates. |\n'
    expect(otherLists(oneAtATime, steps)).toEqual([])
    expect(otherLists(planted(steps), steps)).toEqual([])
  })

  it('⛔ a chain part the census cannot read is refused, not skipped', () => {
    expect(() => ciSteps('pnpm run a && node x.mjs')).toThrow(/cannot read/)
  })
})
