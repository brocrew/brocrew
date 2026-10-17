import { execFile } from 'node:child_process'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { artifactReader, loadCoverageEvidence } from './lib/coverage-evidence.mjs'
import { COVERAGE_AREAS, COVERAGE_METRICS, nextCoverageFloors } from './lib/coverage-floors.mjs'
import {
  compareWithFloors,
  countSources,
  failedTests,
  raisedFloors,
  shippedSources,
  sumTests,
  tableMarkdown,
} from './lib/coverage-check-only.mjs'

const execute = promisify(execFile)
const FLOOR_FILE = 'coverage-floors.json'
export const KNOWN_FAILURES = new Set([
  JSON.stringify([
    'scripts/test/mutation-census.test.mjs',
    'mutation census machine attestation (264 E2/E7) ⛔ the generated prose and machine record still match the live definitions and artefacts',
  ]),
  JSON.stringify([
    'scripts/test/mutation-census.test.mjs',
    'every shim table holding a recorded retirement can be dry-run (596 §4.1) ⚑ names them, dry-runs each green with `--table`, and shows one refusing without it',
  ]),
])

function check(condition, message) {
  if (!condition) throw new Error(message)
}

export async function runCoverageGate({
  repo,
  target,
  expectedTarget,
  artifacts,
  manifest,
  initialize = false,
  reviewedChange = null,
}) {
  for (const filename of [repo, artifacts, manifest])
    check(typeof filename === 'string' && path.isAbsolute(filename), 'Use absolute paths')
  check(typeof target === 'string' && target.startsWith('refs/heads/'), 'Use a target branch ref')
  check(/^[a-f0-9]{40}$/.test(expectedTarget), 'Supply the expected target commit')
  async function git(...args) {
    return (
      await execute('git', ['--no-replace-objects', '-C', repo, ...args], {
        env: { ...process.env, GIT_GRAFT_FILE: os.devNull },
      })
    ).stdout.trim()
  }
  async function noGrafts() {
    check(process.env.GIT_GRAFT_FILE === undefined, 'Legacy Git graft override is not allowed')
    const filename = path.join(
      await git('rev-parse', '--path-format=absolute', '--git-common-dir'),
      'info/grafts',
    )
    const existing = await lstat(filename).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    check(existing === null, 'Legacy Git graft file is not allowed')
  }
  await noGrafts()
  await git('check-ref-format', target)
  async function sameTarget() {
    check(
      (await git('rev-parse', '--verify', `${target}^{commit}`)) === expectedTarget,
      'Landing target moved; measure the new join',
    )
  }
  await sameTarget()
  const input = JSON.parse(await readFile(manifest, 'utf8'))
  const { plan, bundle } = input
  check(plan.targetCommit === expectedTarget, 'Report names a different landing target')
  check(
    plan.allowedFailures.every(({ file, name }) =>
      KNOWN_FAILURES.has(JSON.stringify([file, name])),
    ),
    'Report allows a failure outside the known census pair',
  )
  const measured = await git('rev-parse', 'HEAD')
  check(
    measured === plan.identity.head &&
      (await git('rev-parse', 'HEAD^{tree}')) === plan.identity.tree,
    'Landing source differs from the measured commit',
  )
  check(
    (await git('status', '--porcelain', '--untracked-files=no')) === '',
    'Landing checkout has tracked edits',
  )
  await git('merge-base', '--is-ancestor', expectedTarget, measured)
  const targetHasFloors = (await git('ls-tree', expectedTarget, '--', FLOOR_FILE)) !== ''
  const candidateHasFloors = (await git('ls-tree', measured, '--', FLOOR_FILE)) !== ''
  let saved = { version: 1, floors: null }
  if (targetHasFloors) {
    const targetText = await git('show', `${expectedTarget}:${FLOOR_FILE}`)
    check(
      candidateHasFloors && (await git('show', `${measured}:${FLOOR_FILE}`)) === targetText,
      'Candidate edited the target floors',
    )
    saved = JSON.parse(targetText)
  } else if (candidateHasFloors) {
    const candidate = JSON.parse(await git('show', `${measured}:${FLOOR_FILE}`))
    check(
      candidate.version === 1 && candidate.floors === null,
      'Candidate supplied its own initial floors',
    )
  } else {
    const existing = await lstat(path.join(repo, FLOOR_FILE)).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    check(existing === null, 'Untracked floor file would be overwritten')
  }
  check(saved.version === 1 && Object.hasOwn(saved, 'floors'), 'Invalid target floors file')
  check(
    saved.floors !== null || initialize === true,
    'Floor baseline is not initialized; use the first qualified develop',
  )
  check(!initialize || saved.floors === null, 'Floor baseline is already initialized')
  const evidence = await loadCoverageEvidence(plan, bundle, await artifactReader(artifacts))
  let previous = structuredClone(saved.floors)
  let review = null
  if (reviewedChange !== null) {
    check(path.isAbsolute(reviewedChange), 'Use an absolute reviewed-change path')
    review = JSON.parse(await readFile(reviewedChange, 'utf8'))
    check(
      review.targetCommit === expectedTarget &&
        review.measuredCommit === measured &&
        typeof review.reason === 'string' &&
        review.reason.trim() &&
        typeof review.page === 'string' &&
        path.isAbsolute(review.page),
      'Floor change needs the matching target, measurement, reason and review page',
    )
    await readFile(review.page)
    check(
      previous !== null && Array.isArray(review.changes) && review.changes.length > 0,
      'Invalid reviewed floor change',
    )
    const seen = new Set()
    for (const { area, metric, from, to } of review.changes) {
      check(
        COVERAGE_AREAS.includes(area) && COVERAGE_METRICS.includes(metric),
        'Invalid reviewed metric',
      )
      const key = `${area}/${metric}`
      check(
        !seen.has(key) &&
          previous[area][metric] === from &&
          from !== null &&
          (to === null || (Number.isInteger(to) && to >= 0 && to < from)),
        'Reviewed change does not match the target floor',
      )
      seen.add(key)
      check(
        to !== null || evidence.qualified.counts[area][metric].total === 0,
        'Retired floor still has measured counters',
      )
      previous[area][metric] = to
    }
  }
  const floors = nextCoverageFloors(previous, evidence.qualified.counts)
  const result = {
    version: 1,
    floors,
    measuredCommit: measured,
    counts: evidence.qualified.counts,
    tests: evidence.qualified.tests,
    qualifiedFailures: evidence.qualified.qualifiedFailures,
    reviewedChange:
      review === null
        ? null
        : { reason: review.reason, page: review.page, changes: review.changes },
  }
  await noGrafts()
  await sameTarget()
  check(
    (await git('rev-parse', 'HEAD')) === measured &&
      (await git('status', '--porcelain', '--untracked-files=no')) === '',
    'Landing source changed while checking coverage',
  )
  await writeFile(path.join(repo, FLOOR_FILE), JSON.stringify(result, null, 2) + '\n')
  return result
}

// Check-only: the merged native coverage of a measured checkout against the floors committed in it,
// for a CI run that has no local receipts. It writes only into --out, never into the repository, and
// never commits or publishes. Exit 1: a row below its floor or a shipped source the measurement did
// not reach. Exit 2: every row passes but a test failed beyond the known census pair.
export async function checkOnly({ repo, coverageFinal, testReports, out }) {
  for (const filename of [repo, coverageFinal, out])
    check(typeof filename === 'string' && path.isAbsolute(filename), 'Use absolute paths')
  check(Array.isArray(testReports) && testReports.length > 0, 'Name the test reports')
  const git = async (...args) => (await execute('git', ['-C', repo, ...args])).stdout.trim()
  const measured = await git('rev-parse', 'HEAD')
  const saved = JSON.parse(await readFile(path.join(repo, FLOOR_FILE), 'utf8'))
  check(saved.version === 1 && saved.floors !== null, 'The committed floors are not initialized')
  const sources = shippedSources((await git('ls-tree', '-r', '--name-only', 'HEAD')).split('\n'))
  const { counts, missing } = countSources(
    JSON.parse(await readFile(coverageFinal, 'utf8')),
    sources,
    repo,
  )
  const rows = compareWithFloors(counts, saved.floors)
  const reports = []
  for (const filename of testReports) reports.push(JSON.parse(await readFile(filename, 'utf8')))
  const tests = sumTests(reports)
  const failed = reports.flatMap((report) => failedTests(report, repo))
  const unknown = failed.filter(([file, name]) => !KNOWN_FAILURES.has(JSON.stringify([file, name])))
  const below = rows.filter((row) => !row.passes)
  const exitCode = below.length > 0 || missing.length > 0 ? 1 : unknown.length > 0 ? 2 : 0
  let raised = null
  if (exitCode === 0)
    raised = raisedFloors(
      saved,
      counts,
      measured,
      tests,
      failed.map(([file, name]) => [file, name]),
    )
  const result = { measured, sources: sources.length, rows, missing, tests, unknown, exitCode }
  const markdown = [
    `### Coverage of ${measured.slice(0, 9)} against the committed floors`,
    '',
    tableMarkdown(rows),
    `Tests: ${tests.passed} passed, ${tests.failed} failed (${failed.length - unknown.length} known census, ${unknown.length} other), ${tests.skipped} skipped.`,
    below.length
      ? `Below a floor: ${below.map((row) => `${row.area} ${row.metric}`).join(', ')}.`
      : 'No row is below its floor.',
    missing.length ? `Shipped sources the measurement did not reach: ${missing.length}.` : '',
    unknown.length
      ? `Other failed tests:\n${unknown.map(([file, name]) => `- ${file} :: ${name}`).join('\n')}`
      : '',
    raised
      ? "Raised floors are in raised-floors.json; landing them is the landing seat's change."
      : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'table.json'), JSON.stringify(result, null, 2) + '\n')
  await writeFile(path.join(out, 'table.md'), markdown + '\n')
  if (raised)
    await writeFile(path.join(out, 'raised-floors.json'), JSON.stringify(raised, null, 2) + '\n')
  return { ...result, markdown, raised }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'check-only': { type: 'boolean', default: false },
      'coverage-final': { type: 'string' },
      'test-report': { type: 'string', multiple: true },
      out: { type: 'string' },
      repo: { type: 'string' },
      target: { type: 'string' },
      'expected-target': { type: 'string' },
      artifacts: { type: 'string' },
      manifest: { type: 'string' },
      initialize: { type: 'boolean', default: false },
      'reviewed-change': { type: 'string' },
    },
  })
  if (values['check-only']) {
    const result = await checkOnly({
      repo: values.repo,
      coverageFinal: values['coverage-final'],
      testReports: values['test-report'],
      out: values.out,
    })
    console.log(result.markdown)
    process.exitCode = result.exitCode
    return
  }
  const result = await runCoverageGate({
    ...values,
    expectedTarget: values['expected-target'],
    reviewedChange: values['reviewed-change'] ?? null,
  })
  console.log(
    `Coverage passed: ${result.tests.passed} passed, ${result.tests.failed} known census failures, ${result.tests.skipped} skipped.`,
  )
  console.log(
    'Raised floors written to coverage-floors.json. Commit them with this landing, then update the target with the expected old commit.',
  )
  if (result.reviewedChange !== null)
    console.log(
      `Record in the landing commit message: Coverage floor change: ${result.reviewedChange.reason}; page: ${result.reviewedChange.page}`,
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Coverage gate failed: ${error.message}`)
    process.exitCode = 1
  })
}
