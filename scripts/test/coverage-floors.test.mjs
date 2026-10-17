import { describe, expect, it } from 'vitest'
import {
  assertFloorsNotLowered,
  COVERAGE_AREAS,
  COVERAGE_METRICS,
  nextCoverageFloors,
} from '../lib/coverage-floors.mjs'

function counts(covered = 85, total = 100) {
  return Object.fromEntries(
    COVERAGE_AREAS.map((area) => [
      area,
      Object.fromEntries(
        COVERAGE_METRICS.map((metric) => [
          metric,
          {
            covered: area === 'overall' ? covered * 6 : covered,
            total: area === 'overall' ? total * 6 : total,
          },
        ]),
      ),
    ]),
  )
}

describe('coverage floors from fictional counters', () => {
  it('initializes integer tenths and raises them independently', () => {
    const old = nextCoverageFloors(null, counts(859, 1000))
    expect(old.renderer.lines).toBe(859)
    const report = counts(859, 1000)
    report.renderer.lines.covered = 870
    report.overall.lines.covered += 11
    const next = nextCoverageFloors(old, report)
    expect(next.renderer.lines).toBe(870)
    expect(next.renderer.functions).toBe(859)
    expect(next.overall.lines).toBe(860)
    expect(old.renderer.lines).toBe(859)
  })

  it('permits a decline smaller than a tenth without lowering the floor', () => {
    const old = nextCoverageFloors(null, counts(8599, 10000))
    expect(nextCoverageFloors(old, counts(8590, 10000))).toEqual(old)
  })

  it('refuses just below a floor without rounding it up', () => {
    const old = nextCoverageFloors(null, counts(859, 1000))
    expect(() => nextCoverageFloors(old, counts(858999, 1000000))).toThrow('Coverage below floor')
    expect(nextCoverageFloors(old, counts(859000, 1000000))).toEqual(old)
  })

  it('keeps no-counter areas N/A instead of assigning 100%', () => {
    const empty = nextCoverageFloors(null, counts(0, 0))
    expect(empty.preload.lines).toBeNull()
    expect(nextCoverageFloors(empty, counts(70)).preload.lines).toBe(700)
    const zero = nextCoverageFloors(null, counts(0))
    expect(zero.preload.lines).toBe(0)
    expect(() => nextCoverageFloors(zero, counts(0, 0))).toThrow('Missing counters')
  })

  it('initializes one formerly N/A metric at its measured tenth', () => {
    const report = counts(700, 1000)
    report.preload.branches = { covered: 0, total: 0 }
    report.overall.branches = { covered: 3500, total: 5000 }
    const old = nextCoverageFloors(null, report)
    expect(old.preload.branches).toBeNull()
    report.preload.branches = { covered: 733, total: 1000 }
    report.overall.branches = { covered: 4233, total: 6000 }
    const next = nextCoverageFloors(old, report)
    expect(next.preload.branches).toBe(733)
    expect(next.preload.lines).toBe(700)
    expect(old.preload.branches).toBeNull()
  })

  it('refuses measured to N/A without a reviewed floor change', () => {
    const report = counts(700, 1000)
    const old = nextCoverageFloors(null, report)
    report.preload.branches = { covered: 0, total: 0 }
    report.overall.branches = { covered: 3500, total: 5000 }
    expect(() => nextCoverageFloors(old, report)).toThrow(
      'Missing counters for stored preload branches floor',
    )
    expect(old.preload.branches).toBe(700)
  })

  it('compares large safe counters with exact integer multiplication', () => {
    const total = Math.floor(Number.MAX_SAFE_INTEGER / 6)
    const covered = Number((BigInt(total) * 859n) / 1000n)
    const old = nextCoverageFloors(null, counts(859, 1000))
    expect(() => nextCoverageFloors(old, counts(covered, total))).toThrow('Coverage below floor')
    expect(nextCoverageFloors(old, counts(covered + 1, total))).toEqual(old)
  })

  it('rejects incoherent area and overall counters', () => {
    const report = counts()
    report.overall.branches.covered += 1
    expect(() => nextCoverageFloors(null, report)).toThrow('Overall branches covered')
  })

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid counter %s',
    (value) => {
      const report = counts()
      report.main.lines.covered = value
      expect(() => nextCoverageFloors(null, report)).toThrow('Invalid main lines counters')
    },
  )

  it('rejects more covered items than total items', () => {
    const report = counts()
    report.main.lines.covered = 101
    expect(() => nextCoverageFloors(null, report)).toThrow('Invalid main lines counters')
  })

  it('does not accept a claimed percentage instead of counters', () => {
    const report = counts()
    report.main.lines = { pct: 100 }
    expect(() => nextCoverageFloors(null, report)).toThrow('Invalid main lines counters')
  })

  it('refuses missing, unknown or array-shaped areas', () => {
    const report = counts()
    delete report.renderer
    expect(() => nextCoverageFloors(null, report)).toThrow('Invalid coverage areas')
    expect(() => nextCoverageFloors(null, { ...counts(), extra: {} })).toThrow(
      'Invalid coverage areas',
    )
    expect(() => nextCoverageFloors(null, [])).toThrow('Invalid coverage areas')
  })

  it('refuses lost metrics', () => {
    const report = counts()
    delete report.main.functions
    expect(() => nextCoverageFloors(null, report)).toThrow('Invalid main counters')
  })

  it('keeps every target floor when checking a candidate', () => {
    const target = nextCoverageFloors(null, counts(70))
    const next = nextCoverageFloors(target, counts(80))
    expect(() => assertFloorsNotLowered(target, next)).not.toThrow()
    next.renderer.functions = 699
    expect(() => assertFloorsNotLowered(target, next)).toThrow(
      'Stored floor lowered: renderer functions',
    )
    next.renderer.functions = null
    expect(() => assertFloorsNotLowered(target, next)).toThrow('Stored floor lowered')
    delete next.main
    expect(() => assertFloorsNotLowered(target, next)).toThrow('Invalid floor areas')
  })

  it.each([-1, 1001, 700.5, '700', NaN])('refuses invalid stored floor %s', (value) => {
    const target = nextCoverageFloors(null, counts(70))
    target.shared.lines = value
    expect(() => nextCoverageFloors(target, counts(85))).toThrow('Invalid shared lines floor')
  })
})
