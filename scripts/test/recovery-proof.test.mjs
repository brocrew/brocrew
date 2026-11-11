import { describe, expect, it } from 'vitest'
import { recoveryProofSequence } from '../lib/upgrade-path.mjs'

async function collect({
  validCopy = true,
  order = false,
  unsafe = false,
  futureFails = false,
  stateLost = false,
} = {}) {
  const result = { compatible: {}, syntheticFuture: {}, synchronous: {} }
  const failures = [],
    visited = []
  let stopped = true
  const check = (ok, name) => {
    if (!ok) failures.push(name)
  }
  const proof = recoveryProofSequence({
    check,
    alive: () => !stopped,
    currentPid: () => 101,
    launch: async () => {
      stopped = false
    },
    phase: async (name, body) => {
      try {
        await body()
      } catch (error) {
        check(false, `${name}: ${error.message}`)
      } finally {
        stopped = !unsafe
      }
    },
  })
  await proof.collect(
    result,
    {
      compatible: async () => {
        await proof.launch()
        visited.push('candidate')
        if (!validCopy) throw new Error('invalid copy/history/source/state')
        result.compatible.copy = { id: 'verified-v1' }
        if (!order) throw new Error('ordering assertion failed')
        result.compatible.order = { ready: true }
      },
      compatible019: async () => {
        visited.push('019-data')
        result.compatible.actual019ThenCandidate = true
      },
      syntheticFuture: async () => {
        visited.push('019-Restore-Return')
        if (futureFails) throw new Error('Return lost bytes')
        result.syntheticFuture.actual019RestoreReturn = true
      },
      synchronous: async () => {
        visited.push('prefix')
      },
    },
    {
      state: { 'fixture.json': '{}' },
      readState: () => (stateLost ? {} : { 'fixture.json': '{}' }),
      stateFiles: ['fixture.json'],
    },
  )
  return { result, failures, visited, exit: failures.length ? 1 : 0 }
}

describe('independent packaged recovery proof cases', () => {
  it('refuses a second launch within the same phase until the first owned PID stopped', async () => {
    let launches = 0
    const proof = recoveryProofSequence({
      launch: async () => {
        launches++
      },
      currentPid: () => 42,
      alive: () => launches > 0,
      phase: async () => {},
      check: () => {},
    })
    await proof.launch()
    await expect(proof.launch()).rejects.toThrow('still running')
    expect(launches).toBe(1)
    expect(proof.closed()).toBe(false)
  })

  it('retains a failed ordering result while collecting verified dependent and independent cases', async () => {
    const seen = await collect()
    expect(seen.visited).toEqual(['candidate', '019-data', '019-Restore-Return', 'prefix'])
    expect(seen.failures).toContain('Window-before-completion was not observed.')
    expect(seen.exit).toBe(1)
  })
  it('skips dependent cases on invalid copy prerequisites but still attempts the separate prefix', async () => {
    const seen = await collect({ validCopy: false })
    expect(seen.visited).toEqual(['candidate', 'prefix'])
    expect(seen.result.cases.filter((one) => one.skipped).map((one) => one.name)).toEqual([
      'compatible019',
      'syntheticFuture',
    ])
    expect(seen.exit).toBe(1)
  })
  it('skips dependent cases when coupled fixture state was lost', async () => {
    const seen = await collect({ stateLost: true })
    expect(seen.visited).toEqual(['candidate', 'prefix'])
    expect(seen.result.cases[1].skipped).toContain('Coupled state')
    expect(seen.exit).toBe(1)
  })
  it('blocks every further launch when shutdown was not verified', async () => {
    const seen = await collect({ unsafe: true })
    expect(seen.visited).toEqual(['candidate'])
    expect(seen.result.cases.slice(1).every((one) => one.skipped.includes('process'))).toBe(true)
    expect(seen.exit).toBe(1)
  })
  it('retains both early and later failures and still collects independent prefix evidence', async () => {
    const seen = await collect({ futureFails: true })
    expect(seen.visited.at(-1)).toBe('prefix')
    expect(seen.failures.some((one) => one.includes('ordering assertion'))).toBe(true)
    expect(seen.failures.some((one) => one.includes('Return lost bytes'))).toBe(true)
    expect(seen.exit).toBe(1)
  })
  it('allows success only when all original case assertions and shutdown checks passed', async () => {
    expect((await collect({ order: true })).exit).toBe(0)
  })
})
