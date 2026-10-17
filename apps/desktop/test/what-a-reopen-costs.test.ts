import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ResumeOptions, StartOptions } from '@brobot2/runtime'
import { REOPEN_COSTS, REOPENING_SAYS, type ReopenCost } from '../src/renderer/src/lib/reopening'

/**
 * 🔴 **656 · one list of what a reopen costs, and nothing that can drift from it unseen** (`643` F5).
 *
 * ⛔ **There were three lists** — the host's docblock above `assertSignInCurrent`, the docblock
 * above `REOPENING_SAYS`, and the sentence a person reads — **and no two agreed.** ⚠️ The sentence
 * left out the one cost a person is most likely to meet: work still running in the background,
 * which the provider child takes with it. Both docblocks named `ultracode`, a cost no conversation
 * can pay today.
 *
 * ⚑ **`REOPEN_COSTS` is the one list, and this file is what makes it the SOURCE rather than a fourth
 * opinion.** §1 holds the sentence to the table. §2 holds the table to `markReopened` — the
 * function that actually performs the renderer's half — in both directions. §3 holds the one row
 * the table calls a phantom to the type that makes it one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const rendererLib = join(here, '../src/renderer/src/lib')

/** Every row DECIDES: its words are in the sentence, or it says why a person need not be told. */
const undecided = (rows: readonly ReopenCost[], sentence: string): string[] =>
  rows
    .filter((row) =>
      'isTold' in row.person
        ? !sentence.includes(row.person.isTold)
        : row.person.isNotTold.trim().length === 0,
    )
    .map((row) => row.what)

/**
 * ⛔ **The sweeps `markReopened` performs — its CALLS, read from its body with prose stripped.**
 * ⚠️ `itemById` is a lookup that sweeps nothing, so it is named here with its reason rather than
 * given a row a person would never recognise.
 */
const READERS_NOT_SWEEPS = new Set(['itemById'])
const sweepsTheRendererPerforms = (): string[] => {
  const source = readFileSync(join(rendererLib, 'transcript.ts'), 'utf8')
  const start = source.indexOf('export function markReopened(')
  expect(start, '`markReopened` was renamed').toBeGreaterThan(0)
  const open = source.indexOf('{', start)
  let depth = 0
  let end = open
  for (; end < source.length; end++) {
    if (source[end] === '{') depth++
    if (source[end] === '}' && --depth === 0) break
  }
  const body = source
    .slice(open, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const calls = [...body.matchAll(/\b([a-zA-Z]+)\(/g)].map((match) => match[1] as string)
  return [...new Set(calls)].filter((name) => !READERS_NOT_SWEEPS.has(name)).sort()
}

describe('656 · what a reopen costs', () => {
  describe('§1 · the sentence a person reads is held to the table', () => {
    it('🔴 every row decides — its words are in the `free` sentence, or it says why not', () => {
      expect(undecided(REOPEN_COSTS, REOPENING_SAYS.free)).toEqual([])
    })

    /**
     * ⚠️ **678 · re-aimed, not stripped** (rule 26). ⛔ **`672` split the draft row by ARM** — kept on
     * the selected conversation, LOST on every other, measured — and this pinned the split both ways.
     * ⚑ **R26 ruled the draft survives the reopen** (`sweepDrafts.reopening`, pinned whole in
     * `a-reopen-keeps-the-draft.test.ts`), so what this pins now is that the split is GONE: one row,
     * kept, told in the one sentence, and no row a person could read as *cleared*.
     */
    it('🔴 678 · the message box is ONE row, kept — and nothing about it is lost any more', () => {
      const box = REOPEN_COSTS.filter((row) => /message box/.test(row.what))
      expect(box.map((row) => [row.becomes, 'isTold' in row.person && row.person.isTold])).toEqual([
        ['kept', 'whatever you have typed or attached'],
      ])
      // ⛔ no row carries an arm any more — the field is gone from the type and from every row
      for (const row of REOPEN_COSTS) expect(Object.keys(row), row.what).not.toContain('arm')
      // ⛔ and the sentence `672` wrote for the other arm is nowhere a person reads
      expect(Object.values(REOPENING_SAYS).join(' ')).not.toMatch(/cleared/)
    })

    it('⚑ THE CONTROL — the checker SEES a row whose words are missing, and one with no reason', () => {
      // 🔴 **Rule 12**: a checker that answered `[]` for everything would pass the test above.
      const planted: ReopenCost[] = [
        {
          what: 'planted · told but absent',
          becomes: 'lost',
          how: 'nowhere',
          sweeps: [],
          person: { isTold: 'a phrase no sentence contains' },
        },
        {
          what: 'planted · untold with no reason',
          becomes: 'lost',
          how: 'nowhere',
          sweeps: [],
          person: { isNotTold: '   ' },
        },
      ]
      expect(undecided(planted, REOPENING_SAYS.free)).toEqual([
        'planted · told but absent',
        'planted · untold with no reason',
      ])
    })

    it('⛔ the cost 656 added is TOLD, by name — work left running in the background', () => {
      // ⚑ **Standing rule 5**: the load-bearing clause is asserted by name, so it cannot leave the
      // sentence on a rewrite that keeps every other row satisfied.
      const background = REOPEN_COSTS.find((row) => row.sweeps.includes('stopDetachedWork'))
      expect(background?.person).toEqual({ isTold: 'running in the background' })
      expect(REOPENING_SAYS.free).toContain('running in the background')
    })

    it('🔴 741 · R99 (corrected) — a reopen LEAVES plan mode, and the sentence says so by name', () => {
      // ⛔ Until `741` the table said plan mode was *kept* — *"nothing is lost"* — and the resume
      // replayed it. ⚑ *"A reopened conversation does NOT resume planning, whoever started the
      // plan"*: a person pressing Reopen on a planning conversation loses the plan mode, so is told.
      const plan = REOPEN_COSTS.filter((row) => /plan mode/.test(row.what))
      expect(plan.map((row) => [row.what, row.becomes, row.person])).toEqual([
        ['plan mode', 'lost', { isTold: 'leaves plan mode' }],
      ])
      expect(REOPENING_SAYS.free).toContain('leaves plan mode')
    })

    it('⚠️ the rows are distinct — one cost, one row', () => {
      const names = REOPEN_COSTS.map((row) => row.what)
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe('§2 · the table is held to what `markReopened` actually does, in both directions', () => {
    it('🔴 every sweep `markReopened` performs belongs to a row, and every row`s sweep is still performed', () => {
      const performed = sweepsTheRendererPerforms()
      const claimed = [...new Set(REOPEN_COSTS.flatMap((row) => row.sweeps))].sort()
      // ⛔ **Both directions**: a new sweep with no row is a cost nobody decided about, and a row
      // naming a sweep that is gone is a cost the table claims and the code no longer charges.
      expect(claimed).toEqual(performed)
    })

    it('⚑ THE CONTROL — the census reads real calls, and enough of them to mean something', () => {
      // ⛔ **An empty census would equal an empty claim.** The five sweeps the table names by hand
      // are all found in the function's body, which is what makes the equality above a
      // measurement of the source rather than of this file's own parser.
      const performed = sweepsTheRendererPerforms()
      for (const sweep of ['settlePending', 'stopDetachedWork', 'stopRunningSubAgents']) {
        expect(performed).toContain(sweep)
      }
      expect(performed).not.toContain('itemById')
    })
  })

  describe('§3 · the phantom row is held to the type that makes it one', () => {
    it('⛔ `ResumeOptions` cannot carry `ultracode`, and `StartOptions` can — so the row is a real mechanism', () => {
      // 🔴 **Type-level, so a change to either interface is a TYPECHECK failure here.** ⚠️ A
      // `@ts-expect-error` on an object literal would pass for any missing required field and
      // measure nothing; asking `keyof` asks exactly one question.
      type ResumeCarriesIt = 'ultracode' extends keyof ResumeOptions ? true : false
      type StartCarriesIt = 'ultracode' extends keyof StartOptions ? true : false
      const resume: ResumeCarriesIt = false
      // ⚑ **The control**: the same question of the interface that DOES carry it answers `true`.
      const start: StartCarriesIt = true
      expect([resume, start]).toEqual([false, true])
      expect(REOPEN_COSTS.find((row) => row.what === '`ultracode`')?.becomes).toBe('lost')
    })
  })
})
