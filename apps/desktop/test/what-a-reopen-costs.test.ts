import { describe, expect, it } from 'vitest'
import { REOPEN_COSTS, REOPENING_SAYS, type ReopenCost } from '../src/renderer/src/lib/reopening'

/** Every row decides: its words are in the sentence, or it says why a person need not be told. */
const undecided = (rows: readonly ReopenCost[], sentence: string): string[] =>
  rows
    .filter((row) =>
      'isTold' in row.person
        ? !sentence.includes(row.person.isTold)
        : row.person.isNotTold.trim().length === 0,
    )
    .map((row) => row.what)

describe('what a reopen costs, as the sentence a person reads', () => {
  it('every row decides — its words are in the `free` sentence, or it says why not', () => {
    expect(undecided(REOPEN_COSTS, REOPENING_SAYS.free)).toEqual([])
  })

  it('the message box is one row, kept', () => {
    const box = REOPEN_COSTS.filter((row) => /message box/.test(row.what))
    expect(box.map((row) => [row.becomes, 'isTold' in row.person && row.person.isTold])).toEqual([
      ['kept', 'whatever you have typed or attached'],
    ])
  })

  it('work left running in the background is told by name', () => {
    const background = REOPEN_COSTS.find((row) => row.sweeps.includes('stopDetachedWork'))
    expect(background?.person).toEqual({ isTold: 'running in the background' })
    expect(REOPENING_SAYS.free).toContain('running in the background')
  })

  it('a reopen leaves plan mode, and the sentence says so', () => {
    const plan = REOPEN_COSTS.filter((row) => /plan mode/.test(row.what))
    expect(plan.map((row) => [row.what, row.becomes, row.person])).toEqual([
      ['plan mode', 'lost', { isTold: 'leaves plan mode' }],
    ])
    expect(REOPENING_SAYS.free).toContain('leaves plan mode')
  })

  it('the rows are distinct — one cost, one row', () => {
    const names = REOPEN_COSTS.map((row) => row.what)
    expect(new Set(names).size).toBe(names.length)
  })
})
