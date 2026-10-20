import { createRequire } from 'node:module'
import { relative } from 'node:path'
import { COVERAGE_AREAS, COVERAGE_METRICS, nextCoverageFloors } from './coverage-floors.mjs'

const require = createRequire(import.meta.url)
const coverageRequire = createRequire(require.resolve('@vitest/coverage-v8/package.json'))
const { createCoverageMap } = coverageRequire('istanbul-lib-coverage')

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|vue)$/
const DECLARATION = /\.d\.(ts|mts|cts)$/
const NOT_SHIPPED = /(^|\/)(test|tests|look|fixtures)\//
const TEST_OR_FIXTURE = /\.(test|spec|fixture)\./

/** The sources coverage is judged on: shipped code under the desktop app and the packages. */
export function shippedSources(paths) {
  return paths
    .filter((file) => file.startsWith('apps/desktop/src/') || /^packages\/[^/]+\/src\//.test(file))
    .filter(
      (file) =>
        CODE.test(file) &&
        !DECLARATION.test(file) &&
        !file.startsWith('packages/runtime/src/codex/protocol/') &&
        !NOT_SHIPPED.test(file) &&
        !TEST_OR_FIXTURE.test(file),
    )
    .sort()
}

/** The floor row a source counts toward. */
export function areaOf(file) {
  if (file.startsWith('packages/runtime/')) return 'runtime'
  if (file.startsWith('packages/')) return 'other packages'
  return file.split('/')[3]
}

/**
 * Per-area covered/total counters from a merged native coverage map, over the shipped sources only.
 * `missing` lists a shipped source the map has no entry for: the measurement did not reach it.
 */
export function countSources(rawCoverage, sources, root) {
  const map = createCoverageMap(rawCoverage)
  const known = new Map(
    map.files().map((file) => [relative(root, file).replaceAll('\\', '/'), file]),
  )
  const counts = Object.fromEntries(
    COVERAGE_AREAS.map((area) => [
      area,
      Object.fromEntries(COVERAGE_METRICS.map((metric) => [metric, { covered: 0, total: 0 }])),
    ]),
  )
  const missing = []
  for (const source of sources) {
    const absolute = known.get(source)
    if (absolute === undefined) {
      missing.push(source)
      continue
    }
    const summary = map.fileCoverageFor(absolute).toSummary().data
    const area = areaOf(source)
    if (!COVERAGE_AREAS.includes(area)) throw new Error(`Source in an unknown area: ${source}`)
    for (const metric of COVERAGE_METRICS) {
      for (const key of ['covered', 'total']) {
        counts[area][metric][key] += summary[metric][key]
        counts.overall[metric][key] += summary[metric][key]
      }
    }
  }
  return { counts, missing }
}

const tenths = (covered, total) =>
  total === 0 ? null : Number((1000n * BigInt(covered)) / BigInt(total))

/**
 * Each area and metric against its stored floor, all of them (the gate itself stops at the first).
 * A row passes when covered x 1000 >= floor x total, with BigInt, as the gate compares.
 */
export function compareWithFloors(counts, floors) {
  const rows = []
  for (const area of COVERAGE_AREAS) {
    for (const metric of COVERAGE_METRICS) {
      const { covered, total } = counts[area][metric]
      const floor = floors?.[area]?.[metric] ?? null
      const observed = tenths(covered, total)
      const passes =
        floor === null || (total !== 0 && 1000n * BigInt(covered) >= BigInt(floor) * BigInt(total))
      rows.push({
        area,
        metric,
        covered,
        total,
        observedTenths: observed,
        floorTenths: floor,
        passes,
      })
    }
  }
  return rows
}

const pct = (value) => (value === null ? 'n/a' : `${(value / 10).toFixed(1)}%`)

/** The per-area table, lines/branches/functions side by side against their floors. */
export function tableMarkdown(rows) {
  const lines = [
    '| area | lines | floor | branches | floor | functions | floor |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ]
  for (const area of COVERAGE_AREAS) {
    const cells = COVERAGE_METRICS.flatMap((metric) => {
      const row = rows.find((one) => one.area === area && one.metric === metric)
      return [`${pct(row.observedTenths)}${row.passes ? '' : ' ❌'}`, pct(row.floorTenths)]
    })
    lines.push(`| ${area} | ${cells.join(' | ')} |`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Failed tests of a Vitest JSON report: [file relative to the root, full name]. A test FILE that
 * failed without a failed assertion (it did not load, or errored at the top) counts too, as one
 * entry naming the file, as does a failed suite the report lists under no file; the local gate refuses
 * these too, so neither can read as a pass.
 */
export function failedTests(report, root) {
  const rows = report.testResults.flatMap((file) => {
    const name = relative(root, file.name).replaceAll('\\', '/')
    const assertions = file.assertionResults.filter((one) => one.status === 'failed')
    const entries = assertions.map((one) => [name, one.fullName])
    const broken = file.status === 'failed' || (file.message ?? '') !== ''
    if (broken && assertions.length === 0)
      entries.push([
        name,
        `(the test file failed without a failed test: ${firstLine(file.message)})`,
      ])
    return entries
  })
  const suites = report.numFailedTestSuites ?? 0
  const filesWithFailure = new Set(rows.map(([name]) => name)).size
  if (suites > filesWithFailure && rows.length === 0)
    rows.push(['(report)', `(${suites} failed test suites, none named in the report)`])
  return rows
}

function firstLine(message) {
  const line = String(message ?? '')
    .trim()
    .split('\n')[0]
  return line === '' ? 'no message' : line.slice(0, 160)
}

/** The test totals of Vitest JSON reports, summed. */
export function sumTests(reports) {
  const total = { passed: 0, failed: 0, skipped: 0 }
  for (const report of reports) {
    total.passed += report.numPassedTests
    total.failed += report.numFailedTests
    total.skipped += report.numPendingTests + report.numTodoTests
  }
  return total
}

/**
 * The raised floors, only when every row passes: the same record the local gate writes, minus the
 * reviewed-change slot. Throws if a counter is malformed or a row falls below its floor.
 */
export function raisedFloors(saved, counts, measuredCommit, tests, qualifiedFailures) {
  return {
    version: 1,
    floors: nextCoverageFloors(saved.floors, counts),
    measuredCommit,
    counts,
    tests,
    qualifiedFailures,
    reviewedChange: null,
  }
}
