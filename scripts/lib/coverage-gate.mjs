import { isDeepStrictEqual } from 'node:util'
import {
  assertFloorsNotLowered,
  COVERAGE_AREAS,
  COVERAGE_METRICS,
  nextCoverageFloors,
} from './coverage-floors.mjs'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function exactSet(actual, expected, label) {
  check(Array.isArray(actual) && Array.isArray(expected), `Invalid ${label}`)
  check(
    actual.every((item) => typeof item === 'string' && item.length > 0) &&
      new Set(actual).size === actual.length &&
      new Set(expected).size === expected.length &&
      isDeepStrictEqual([...actual].sort(), [...expected].sort()),
    `Incomplete or duplicate ${label}`,
  )
}

function sameIdentity(actual, expected) {
  check(isDeepStrictEqual(actual, expected), 'Source or collection identity changed')
}

function failureKey(file, name) {
  return JSON.stringify([file, name])
}

function caseRecords(files) {
  return files
    .flatMap((file) =>
      file.tests.map((test) => JSON.stringify([file.path, test.name, test.status])),
    )
    .sort()
}

// The caller supplies a verified merged counter union, never sums of shard coverage.
export function qualifyCoverage(plan, shards, merged) {
  check(
    plan.shards.length > 0 && plan.testFiles.length > 0 && Object.keys(plan.sources).length > 0,
    'Empty collection plan',
  )
  check(Array.isArray(shards), 'Invalid shards')
  exactSet(
    shards.map((shard) => shard.id),
    plan.shards,
    'shards',
  )
  const files = []
  const fileRows = []
  const failed = []
  let passed = 0
  let skipped = 0
  const allowed = new Set(plan.allowedFailures.map(({ file, name }) => failureKey(file, name)))
  check(allowed.size === plan.allowedFailures.length, 'Duplicate allowed failure')
  for (const shard of shards) {
    sameIdentity(shard.before, plan.identity)
    sameIdentity(shard.after, plan.identity)
    check(shard.trackedClean === true, 'Dirty measurement source')
    check(shard.timedOut === false, 'Incomplete timed-out shard')
    check(shard.unhandledErrors === 0, 'Unhandled runner error')
    check(shard.collectionErrors === 0, 'Collection error')
    check(Array.isArray(shard.files) && shard.files.length > 0, 'Missing test files')
    let shardFailures = 0
    for (const file of shard.files) {
      files.push(file.path)
      fileRows.push(file)
      check(Array.isArray(file.tests) && file.tests.length > 0, 'Missing test cases')
      for (const test of file.tests) {
        check(typeof test.name === 'string' && test.name.length > 0, 'Missing test name')
        if (test.status === 'passed') passed++
        else if (test.status === 'skipped') skipped++
        else if (test.status === 'failed') {
          const key = failureKey(file.path, test.name)
          check(allowed.has(key), 'Unqualified failed test')
          failed.push(key)
          shardFailures++
        } else throw new Error('Incomplete test case')
      }
    }
    const expectedExit = shardFailures ? 1 : 0
    check(
      shard.commandExit === expectedExit && shard.wrapperExit === expectedExit,
      'Unexpected command or wrapper exit',
    )
  }
  exactSet(files, plan.testFiles, 'test inventory')
  check(new Set(failed).size === failed.length, 'Duplicate failed test')
  sameIdentity(merged.identity, plan.identity)
  check(
    isDeepStrictEqual(caseRecords(merged.files), caseRecords(fileRows)),
    'Merged test cases differ',
  )
  check(
    isDeepStrictEqual(merged.tests, { passed, failed: failed.length, skipped }),
    'Merged test totals differ',
  )
  check(merged.unhandledErrors === 0 && merged.collectionErrors === 0, 'Incomplete merge')
  check(merged.timedOut === false, 'Incomplete timed-out merge')
  const mergeExit = failed.length ? 1 : 0
  check(
    merged.commandExit === mergeExit && merged.wrapperExit === mergeExit,
    'Unexpected merge exit',
  )
  exactSet(Object.keys(merged.sources), Object.keys(plan.sources), 'source inventory')
  const counts = Object.fromEntries(
    COVERAGE_AREAS.map((area) => [
      area,
      Object.fromEntries(COVERAGE_METRICS.map((metric) => [metric, { covered: 0, total: 0 }])),
    ]),
  )
  for (const [file, area] of Object.entries(plan.sources)) {
    check(COVERAGE_AREAS.includes(area) && area !== 'overall', 'Unknown source area')
    const source = merged.sources[file]
    check(source.area === area, 'Source area changed')
    for (const metric of COVERAGE_METRICS) {
      const counter = source[metric]
      check(
        counter &&
          Object.keys(counter).length === 2 &&
          Number.isSafeInteger(counter.covered) &&
          Number.isSafeInteger(counter.total) &&
          counter.covered >= 0 &&
          counter.total >= counter.covered,
        'Malformed source counters',
      )
      for (const key of ['covered', 'total']) {
        counts[area][metric][key] += counter[key]
        counts.overall[metric][key] += counter[key]
      }
    }
  }
  // Validation also catches unsafe aggregate sums and reconciles every area with overall.
  nextCoverageFloors(null, counts)
  return { counts, tests: merged.tests, qualifiedFailures: failed.map((key) => JSON.parse(key)) }
}

function sameTarget(actual, expected) {
  check(isDeepStrictEqual(actual, expected), 'Landing target moved')
}

// Review authority and atomic publication are supplied independently of candidate files.
export async function publishCoverage(plan, shards, merged, port) {
  plan = structuredClone(plan)
  shards = structuredClone(shards)
  merged = structuredClone(merged)
  const target = structuredClone(await port.readTarget())
  check(target.commit === plan.targetCommit, 'Landing target moved')
  if (target.floors !== null) assertFloorsNotLowered(target.floors, target.floors)
  const qualified = qualifyCoverage(plan, shards, merged)
  let previous = structuredClone(target.floors)
  const review = await port.readReviewedChange(plan.targetCommit, plan.identity)
  if (review !== null) {
    check(
      review.id &&
        review.targetCommit === target.commit &&
        isDeepStrictEqual(review.identity, plan.identity),
      'Floor review does not match landing',
    )
    check(
      previous !== null && Array.isArray(review.changes) && review.changes.length > 0,
      'Invalid reviewed floor change',
    )
    const seen = new Set()
    for (const change of review.changes) {
      const { area, metric, from, to } = change
      check(
        COVERAGE_AREAS.includes(area) && COVERAGE_METRICS.includes(metric),
        'Invalid reviewed metric',
      )
      const key = failureKey(area, metric)
      check(!seen.has(key) && previous[area][metric] === from, 'Floor review does not match target')
      seen.add(key)
      check(
        from !== null && (to === null || (Number.isInteger(to) && to >= 0 && to < from)),
        'Invalid reviewed decrease',
      )
      check(
        to !== null || qualified.counts[area][metric].total === 0,
        'Retired floor still has measured counters',
      )
      previous[area][metric] = to
    }
  }
  const next = nextCoverageFloors(previous, qualified.counts)
  if (review === null && target.floors !== null) assertFloorsNotLowered(target.floors, next)
  const publication = {
    measuredIdentity: plan.identity,
    previousTarget: target.commit,
    floors: next,
    reviewedChange: review?.id ?? null,
    tests: qualified.tests,
    qualifiedFailures: qualified.qualifiedFailures,
  }
  sameTarget(await port.readTarget(), target)
  check(await port.compareAndSwap(target, publication), 'Landing target moved during publication')
  return publication
}
