import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { isDeepStrictEqual, stripVTControlCharacters } from 'node:util'
import { COVERAGE_METRICS } from './coverage-floors.mjs'
import { qualifyCoverage } from './coverage-gate.mjs'

const require = createRequire(import.meta.url)
const vitestRequire = createRequire(require.resolve('vitest/package.json'))
const coverageRequire = createRequire(require.resolve('@vitest/coverage-v8/package.json'))
const { parse: parseBlob } = vitestRequire('flatted')
const { createCoverageMap } = coverageRequire('istanbul-lib-coverage')
export const COVERAGE_CODECS = Object.freeze({
  vitest: require('vitest/package.json').version,
  flatted: vitestRequire('flatted/package.json').version,
  istanbul: coverageRequire('istanbul-lib-coverage/package.json').version,
})

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function inside(root, filename) {
  const relative = path.relative(root, filename)
  check(
    relative &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative),
    'Artifact path escapes root',
  )
  return relative.split(path.sep).join('/')
}

export async function artifactReader(directory) {
  check(path.isAbsolute(directory), 'Artifact root must be absolute')
  const root = await realpath(directory)
  return async (filename) => {
    check(
      typeof filename === 'string' && !path.isAbsolute(filename),
      'Artifact reference must be relative',
    )
    const file = path.resolve(root, filename)
    inside(root, file)
    const resolved = await realpath(file)
    inside(root, resolved)
    return readFile(resolved)
  }
}

function rawCounters(map, filename) {
  const summary = map.fileCoverageFor(filename).toSummary().data
  return Object.fromEntries(
    COVERAGE_METRICS.map((metric) => [
      metric,
      { covered: summary[metric].covered, total: summary[metric].total },
    ]),
  )
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    )
  return value
}

function counterRecords(map, filename) {
  const file = map.fileCoverageFor(filename).toJSON()
  return ['s', 'f', 'b'].map((kind) => {
    const definitions = file[{ s: 'statementMap', f: 'fnMap', b: 'branchMap' }[kind]]
    return Object.entries(file[kind])
      .map(([id, hits]) => JSON.stringify(ordered([definitions[id], hits])))
      .sort()
  })
}

function checkedMap(raw) {
  check(raw && typeof raw === 'object' && !Array.isArray(raw), 'Missing native coverage')
  for (const [filename, file] of Object.entries(raw)) {
    check(file.path === filename, 'Native coverage path differs')
    for (const [kind, mapping] of Object.entries({
      s: 'statementMap',
      f: 'fnMap',
      b: 'branchMap',
    })) {
      check(
        isDeepStrictEqual(Object.keys(file[kind]).sort(), Object.keys(file[mapping]).sort()),
        'Missing native counter definition',
      )
      for (const value of Object.values(file[kind])) {
        const hits = kind === 'b' ? value : [value]
        check(
          Array.isArray(hits) &&
            hits.every((hit) => Number.isSafeInteger(hit) && (kind === 'b' || hit >= 0)),
          'Invalid native hit count',
        )
      }
    }
  }
  return createCoverageMap(raw)
}

// The expected plan and artifact hashes come from the collection authority, not a candidate floor file.
export async function loadCoverageEvidence(plan, bundle, read) {
  check(isDeepStrictEqual(plan.codecs, COVERAGE_CODECS), 'Coverage codec version changed')
  check(
    isDeepStrictEqual(
      bundle.shards.map((entry) => entry.id),
      plan.mergeOrder,
    ),
    'Native merge input order differs',
  )
  const audited = []
  async function bytes(reference) {
    check(reference && /^[a-f0-9]{64}$/.test(reference.sha256), 'Missing artifact digest')
    const data = await read(reference.path)
    check(
      createHash('sha256').update(data).digest('hex') === reference.sha256,
      'Artifact hash mismatch',
    )
    audited.push({ path: reference.path, sha256: reference.sha256 })
    return data
  }
  async function json(reference) {
    return JSON.parse((await bytes(reference)).toString('utf8'))
  }
  function relative(filename) {
    check(typeof filename === 'string' && path.isAbsolute(filename), 'Report path must be absolute')
    return inside(plan.sourceRoot, filename)
  }
  function tests(report) {
    const skips = new Set(plan.allowedSkips.map(({ file, name }) => JSON.stringify([file, name])))
    const totals = { passed: 0, failed: 0, skipped: 0 }
    const files = report.testResults.map((row) => {
      const file = relative(row.name)
      check(row.message === '', 'Collection or file-level error')
      const cases = row.assertionResults.map((item) => {
        let status = item.status
        if (status === 'pending' || status === 'todo') status = 'skipped'
        check(
          status === 'passed' ||
            status === 'failed' ||
            (status === 'skipped' && skips.has(JSON.stringify([file, item.fullName]))),
          'Unqualified test status or skip',
        )
        totals[status]++
        return { name: item.fullName, status }
      })
      check(
        row.status === (cases.some((item) => item.status === 'failed') ? 'failed' : 'passed'),
        'Collection or file-level failure',
      )
      return { path: file, tests: cases }
    })
    check(
      report.numPassedTests === totals.passed &&
        report.numFailedTests === totals.failed &&
        report.numPendingTests + report.numTodoTests === totals.skipped &&
        report.numTotalTests === totals.passed + totals.failed + totals.skipped &&
        report.success === (totals.failed === 0),
      'Raw test totals differ',
    )
    check(
      totals.failed > 0 || report.numFailedTestSuites === 0,
      'Failed suite without failed tests',
    )
    return { files, totals }
  }
  async function run(entry, requireBlob = true) {
    const receipt = await json(entry.receipt)
    check(
      receipt.cwd === plan.sourceRoot &&
        isDeepStrictEqual(receipt.before, plan.identity) &&
        isDeepStrictEqual(receipt.after, plan.identity) &&
        receipt.before.trackedStatus === '',
      'Receipt source identity changed',
    )
    check(
      isDeepStrictEqual(receipt.command, plan.commands[entry.id]),
      'Unexpected collection command',
    )
    check(
      receipt.logSha256 === entry.log.sha256 &&
        receipt.wrapperLogSha256 === entry.wrapperLog.sha256,
      'Receipt log digest differs',
    )
    const log = stripVTControlCharacters((await bytes(entry.log)).toString('utf8'))
    await bytes(entry.wrapperLog)
    check(
      !/^.*(?:Unhandled Errors|Unhandled Rejection|Uncaught Exception|Some tests are still running when generating the JSON report).*$/m.test(
        log,
      ),
      'Incomplete or unhandled runner output',
    )
    const report = await json(entry.tests)
    check(
      Number.isFinite(report.startTime) &&
        report.startTime >= receipt.startedAt * 1000 &&
        report.startTime <= receipt.finishedAt * 1000,
      'Report falls outside run interval',
    )
    const normalized = tests(report)
    let coverage = null
    if (requireBlob) {
      const blob = parseBlob((await bytes(entry.blob)).toString('utf8'))
      check(
        Array.isArray(blob) &&
          blob.length === 6 &&
          blob[0] === plan.codecs.vitest &&
          Array.isArray(blob[2]) &&
          blob[2].length === 0,
        'Invalid native blob or unhandled errors',
      )
      check(
        isDeepStrictEqual(
          blob[1].map((file) => relative(file.filepath)).sort(),
          normalized.files.map((file) => file.path).sort(),
        ),
        'Blob test inventory differs',
      )
      coverage = blob[3]
    }
    check(
      Number.isFinite(receipt.startedAt) &&
        Number.isFinite(receipt.finishedAt) &&
        receipt.finishedAt >= receipt.startedAt &&
        receipt.finishedAt - receipt.startedAt < 480,
      'Invalid or oversized run interval',
    )
    return {
      normalized,
      coverage,
      receipt,
      evidence: {
        id: entry.id,
        before: receipt.before,
        after: receipt.after,
        trackedClean: true,
        timedOut: receipt.timedOut,
        commandExit: receipt.commandExit,
        wrapperExit: receipt.wrapperExit,
        unhandledErrors: 0,
        collectionErrors: 0,
        files: normalized.files,
      },
    }
  }
  const union = createCoverageMap({})
  const shards = []
  check(bundle.shards.length === plan.shards.length, 'Missing shard artifacts')
  for (const entry of bundle.shards) {
    const result = await run(entry)
    check(entry.copy.sha256 === entry.blob.sha256, 'Merge input differs from shard blob')
    await bytes(entry.copy)
    union.merge(checkedMap(result.coverage))
    shards.push(result.evidence)
  }
  const result = await run(bundle.merge, false)
  checkedMap(union.toJSON())
  const final = checkedMap(await json(bundle.coverageFinal))
  check(
    isDeepStrictEqual(final.files().sort(), union.files().sort()),
    'Native merged coverage inventory differs',
  )
  const sources = {}
  const knownAssets = new Set(plan.nonExecutableAssets)
  for (const filename of final.files()) {
    const file = relative(filename)
    check(
      isDeepStrictEqual(counterRecords(final, filename), counterRecords(union, filename)),
      'Native merged coverage counters differ',
    )
    if (Object.hasOwn(plan.sources, file))
      sources[file] = { area: plan.sources[file], ...rawCounters(final, filename) }
    else check(knownAssets.has(file), 'Unclassified coverage source')
  }
  const merged = {
    ...result.evidence,
    identity: plan.identity,
    tests: result.normalized.totals,
    sources,
  }
  const qualified = qualifyCoverage(plan, shards, merged)
  return { shards, merged, qualified, artifacts: audited }
}
