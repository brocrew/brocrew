import { describe, expect, it, vi } from 'vitest'
import { COVERAGE_AREAS, COVERAGE_METRICS, nextCoverageFloors } from '../lib/coverage-floors.mjs'
import { publishCoverage, qualifyCoverage } from '../lib/coverage-gate.mjs'

function fixture() {
  const identity = {
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    config: 'c'.repeat(64),
    lock: 'd'.repeat(64),
    toolchain: 'e'.repeat(64),
    scope: 'f'.repeat(64),
  }
  const plan = {
    targetCommit: '1'.repeat(40),
    identity,
    shards: ['node-1', 'dom-1'],
    testFiles: ['scripts/test/menu.test.mjs', 'apps/desktop/src/renderer/recipe.dom.test.ts'],
    sources: Object.fromEntries(
      COVERAGE_AREAS.slice(0, -1).map((area) => [`fiction/${area}.ts`, area]),
    ),
    allowedFailures: [
      { file: 'scripts/test/menu.test.mjs', name: 'known bookkeeping pair member' },
    ],
  }
  const shards = plan.shards.map((id, index) => ({
    id,
    before: structuredClone(identity),
    after: structuredClone(identity),
    trackedClean: true,
    timedOut: false,
    unhandledErrors: 0,
    collectionErrors: 0,
    commandExit: 0,
    wrapperExit: 0,
    files: [{ path: plan.testFiles[index], tests: [{ name: 'reads recipe', status: 'passed' }] }],
  }))
  const merged = {
    identity: structuredClone(identity),
    files: structuredClone(shards.flatMap((shard) => shard.files)),
    tests: { passed: 2, failed: 0, skipped: 0 },
    timedOut: false,
    commandExit: 0,
    wrapperExit: 0,
    unhandledErrors: 0,
    collectionErrors: 0,
    sources: Object.fromEntries(
      Object.entries(plan.sources).map(([file, area]) => [
        file,
        {
          area,
          ...Object.fromEntries(
            COVERAGE_METRICS.map((metric) => [metric, { covered: 859, total: 1000 }]),
          ),
        },
      ]),
    ),
  }
  let target = { commit: plan.targetCommit, floors: null }
  let reviewedChange = null
  const port = {
    readTarget: vi.fn(async () => structuredClone(target)),
    readReviewedChange: vi.fn(async () => structuredClone(reviewedChange)),
    compareAndSwap: vi.fn(async (expected, publication) => {
      if (JSON.stringify(target) !== JSON.stringify(expected)) return false
      target = { commit: '2'.repeat(40), floors: structuredClone(publication.floors) }
      return true
    }),
  }
  return {
    plan,
    shards,
    merged,
    port,
    setTarget: (value) => {
      target = value
    },
    setReview: (value) => {
      reviewedChange = value
    },
  }
}

function knownFailure(f) {
  f.shards[0].files[0].tests[0] = { name: f.plan.allowedFailures[0].name, status: 'failed' }
  f.shards[0].commandExit = f.shards[0].wrapperExit = 1
  f.merged.tests = { passed: 1, failed: 1, skipped: 0 }
  f.merged.commandExit = f.merged.wrapperExit = 1
  f.merged.files = structuredClone(f.shards.flatMap((shard) => shard.files))
}

describe('coverage qualification with fictional merged reports', () => {
  it.each([true, undefined, null, 'false', 0])(
    'rejects merged timeout marker %s despite complete reports and zero exits',
    async (timedOut) => {
      const f = fixture()
      if (timedOut === undefined) delete f.merged.timedOut
      else f.merged.timedOut = timedOut
      await expect(publishCoverage(f.plan, f.shards, f.merged, f.port)).rejects.toThrow(
        'Incomplete timed-out merge',
      )
      expect(f.port.compareAndSwap).not.toHaveBeenCalled()
    },
  )

  it('preserves legitimate repeated test names as separate occurrences', () => {
    const f = fixture()
    f.shards[0].files[0].tests.push({ name: 'reads recipe', status: 'passed' })
    f.merged.files = structuredClone(f.shards.flatMap((shard) => shard.files))
    f.merged.tests.passed++
    expect(qualifyCoverage(f.plan, f.shards, f.merged).tests.passed).toBe(3)
  })

  it('refuses changed merged case identities even when totals match', () => {
    const f = fixture()
    f.merged.files[0].tests[0].name = 'different case'
    expect(() => qualifyCoverage(f.plan, f.shards, f.merged)).toThrow('Merged test cases differ')
  })

  it('reconciles full inventories and publishes tenths from the merged counters', async () => {
    const f = fixture()
    const result = await publishCoverage(f.plan, f.shards, f.merged, f.port)
    expect(result.floors.renderer.lines).toBe(859)
    expect(result.tests).toEqual({ passed: 2, failed: 0, skipped: 0 })
    expect(result.reviewedChange).toBeNull()
    expect(f.port.compareAndSwap).toHaveBeenCalledOnce()
  })

  it('retains an exactly qualified failure and its nonzero exits', async () => {
    const f = fixture()
    knownFailure(f)
    const result = await publishCoverage(f.plan, f.shards, f.merged, f.port)
    expect(result.qualifiedFailures).toEqual([
      [f.plan.allowedFailures[0].file, f.plan.allowedFailures[0].name],
    ])
    expect(result.tests.failed).toBe(1)
  })

  it.each([
    'missing shard',
    'duplicate shard',
    'missing test file',
    'duplicate test file',
    'missing source',
    'unknown source',
  ])('rejects %s', (defect) => {
    const f = fixture()
    if (defect === 'missing shard') f.shards.pop()
    if (defect === 'duplicate shard') f.shards[1].id = f.shards[0].id
    if (defect === 'missing test file') f.shards[1].files[0].path = 'other.test.ts'
    if (defect === 'duplicate test file') f.shards[1].files[0].path = f.shards[0].files[0].path
    if (defect === 'missing source') delete f.merged.sources['fiction/main.ts']
    if (defect === 'unknown source')
      f.merged.sources['other.ts'] = f.merged.sources['fiction/main.ts']
    expect(() => qualifyCoverage(f.plan, f.shards, f.merged)).toThrow(/Incomplete or duplicate/)
  })

  it.each(['before', 'after', 'merge'])('rejects changed %s identity', (where) => {
    const f = fixture()
    if (where === 'merge') f.merged.identity.lock = '0'.repeat(64)
    else f.shards[0][where].scope = '0'.repeat(64)
    expect(() => qualifyCoverage(f.plan, f.shards, f.merged)).toThrow(
      'Source or collection identity changed',
    )
  })

  it.each([
    'trackedClean',
    'timedOut',
    'unhandledErrors',
    'collectionErrors',
    'commandExit',
    'wrapperExit',
  ])('rejects invalid shard %s', (field) => {
    const f = fixture()
    f.shards[0][field] = field === 'trackedClean' ? false : field === 'timedOut' ? true : 1
    expect(() => qualifyCoverage(f.plan, f.shards, f.merged)).toThrow()
  })

  it('does not relabel known failures as exit zero', () => {
    const f = fixture()
    knownFailure(f)
    f.shards[0].wrapperExit = 0
    expect(() => qualifyCoverage(f.plan, f.shards, f.merged)).toThrow(
      'Unexpected command or wrapper exit',
    )
  })

  it('refuses any different failure, even in the allowed file', () => {
    const f = fixture()
    knownFailure(f)
    f.shards[0].files[0].tests[0].name = 'different failure'
    expect(() => qualifyCoverage(f.plan, f.shards, f.merged)).toThrow('Unqualified failed test')
  })

  it.each([
    'pending',
    'missing cases',
    'wrong merged totals',
    'merge exit',
    'merge error',
    'bad counter',
    'changed area',
    'empty plan',
  ])('rejects incomplete %s', (defect) => {
    const f = fixture()
    if (defect === 'pending') f.shards[0].files[0].tests[0].status = 'pending'
    if (defect === 'missing cases') f.shards[0].files[0].tests = []
    if (defect === 'wrong merged totals') f.merged.tests.passed++
    if (defect === 'merge exit') f.merged.commandExit = 1
    if (defect === 'merge error') f.merged.unhandledErrors = 1
    if (defect === 'bad counter') f.merged.sources['fiction/main.ts'].lines.covered = 1001
    if (defect === 'changed area') f.merged.sources['fiction/main.ts'].area = 'renderer'
    if (defect === 'empty plan') f.plan.shards = []
    expect(() => qualifyCoverage(f.plan, f.shards, f.merged)).toThrow()
  })
})

describe('coverage target and independently reviewed changes', () => {
  it('rejects a candidate trying to provide its own lowered floors', async () => {
    const f = fixture()
    const old = nextCoverageFloors(null, qualifyCoverage(f.plan, f.shards, f.merged).counts)
    old.renderer.lines = 900
    f.setTarget({ commit: f.plan.targetCommit, floors: old })
    f.plan.floors = { renderer: { lines: 0 } }
    await expect(publishCoverage(f.plan, f.shards, f.merged, f.port)).rejects.toThrow(
      'Coverage below floor',
    )
    expect(f.port.compareAndSwap).not.toHaveBeenCalled()
  })

  it.each(['before', 'during read', 'during CAS'])(
    'rejects target movement %s, even with unchanged floors',
    async (when) => {
      const f = fixture()
      if (when === 'before') f.setTarget({ commit: '3'.repeat(40), floors: null })
      if (when === 'during read')
        f.port.readTarget
          .mockResolvedValueOnce({ commit: f.plan.targetCommit, floors: null })
          .mockResolvedValueOnce({ commit: '3'.repeat(40), floors: null })
      if (when === 'during CAS') f.port.compareAndSwap.mockResolvedValueOnce(false)
      await expect(publishCoverage(f.plan, f.shards, f.merged, f.port)).rejects.toThrow(
        'Landing target moved',
      )
    },
  )

  it('permits only the independently supplied reviewed decrease bound to this landing', async () => {
    const f = fixture()
    const old = nextCoverageFloors(null, qualifyCoverage(f.plan, f.shards, f.merged).counts)
    old.renderer.lines = 900
    f.setTarget({ commit: f.plan.targetCommit, floors: old })
    f.setReview({
      id: 'fictional-review',
      targetCommit: f.plan.targetCommit,
      identity: structuredClone(f.plan.identity),
      changes: [{ area: 'renderer', metric: 'lines', from: 900, to: 850 }],
    })
    const result = await publishCoverage(f.plan, f.shards, f.merged, f.port)
    expect(result.floors.renderer.lines).toBe(859)
    expect(result.reviewedChange).toBe('fictional-review')
    expect(old.renderer.lines).toBe(900)
  })

  it.each(['wrong target', 'wrong measurement', 'wrong prior floor', 'duplicate change'])(
    'rejects reviewed exception with %s',
    async (defect) => {
      const f = fixture()
      const old = nextCoverageFloors(null, qualifyCoverage(f.plan, f.shards, f.merged).counts)
      f.setTarget({ commit: f.plan.targetCommit, floors: old })
      const review = {
        id: 'fictional-review',
        targetCommit: f.plan.targetCommit,
        identity: structuredClone(f.plan.identity),
        changes: [{ area: 'renderer', metric: 'lines', from: 859, to: 850 }],
      }
      if (defect === 'wrong target') review.targetCommit = '3'.repeat(40)
      if (defect === 'wrong measurement') review.identity.tree = '3'.repeat(40)
      if (defect === 'wrong prior floor') review.changes[0].from = 860
      if (defect === 'duplicate change') review.changes.push(structuredClone(review.changes[0]))
      f.setReview(review)
      await expect(publishCoverage(f.plan, f.shards, f.merged, f.port)).rejects.toThrow(
        /Floor review/,
      )
      expect(f.port.compareAndSwap).not.toHaveBeenCalled()
    },
  )

  it('requires an independently reviewed retirement before measured becomes N/A', async () => {
    const f = fixture()
    const old = nextCoverageFloors(null, qualifyCoverage(f.plan, f.shards, f.merged).counts)
    f.setTarget({ commit: f.plan.targetCommit, floors: old })
    f.merged.sources['fiction/preload.ts'].branches = { covered: 0, total: 0 }
    await expect(publishCoverage(f.plan, f.shards, f.merged, f.port)).rejects.toThrow(
      'Missing counters',
    )
    f.setReview({
      id: 'fictional-retirement',
      targetCommit: f.plan.targetCommit,
      identity: structuredClone(f.plan.identity),
      changes: [{ area: 'preload', metric: 'branches', from: 859, to: null }],
    })
    const result = await publishCoverage(f.plan, f.shards, f.merged, f.port)
    expect(result.floors.preload.branches).toBeNull()
    expect(result.floors.overall.branches).toBe(859)
  })
})
