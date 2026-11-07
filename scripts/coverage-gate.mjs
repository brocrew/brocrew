import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs, promisify } from 'node:util'
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

function check(condition, message) {
  if (!condition) throw new Error(message)
}

// Check-only: the merged native coverage of a measured checkout against the floors committed in it,
// for a CI run that has no local receipts. It writes only into --out, never into the repository, and
// never commits or publishes. Exit 1: a row below its floor or a shipped source the measurement did
// not reach. Exit 2: every row passes but a test failed.
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
  const unknown = reports.flatMap((report) => failedTests(report, repo))
  const below = rows.filter((row) => !row.passes)
  const exitCode = below.length > 0 || missing.length > 0 ? 1 : unknown.length > 0 ? 2 : 0
  let raised = null
  if (exitCode === 0) raised = raisedFloors(saved, counts, measured, tests, [])
  const result = { measured, sources: sources.length, rows, missing, tests, unknown, exitCode }
  const markdown = [
    `### Coverage of ${measured.slice(0, 9)} against the committed floors`,
    '',
    tableMarkdown(rows),
    `Tests: ${tests.passed} passed, ${tests.failed} failed, ${tests.skipped} skipped.`,
    below.length
      ? `Below a floor: ${below.map((row) => `${row.area} ${row.metric}`).join(', ')}.`
      : 'No row is below its floor.',
    missing.length ? `Shipped sources the measurement did not reach: ${missing.length}.` : '',
    unknown.length
      ? `Failed tests:\n${unknown.map(([file, name]) => `- ${file} :: ${name}`).join('\n')}`
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
    },
  })
  check(values['check-only'], 'Use --check-only with merged coverage and test reports')
  const result = await checkOnly({
    repo: values.repo,
    coverageFinal: values['coverage-final'],
    testReports: values['test-report'],
    out: values.out,
  })
  console.log(result.markdown)
  process.exitCode = result.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Coverage gate failed: ${error.message}`)
    process.exitCode = 1
  })
}
