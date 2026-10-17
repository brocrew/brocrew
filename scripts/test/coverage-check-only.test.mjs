import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkOnly, KNOWN_FAILURES } from '../coverage-gate.mjs'
import { COVERAGE_AREAS, COVERAGE_METRICS } from '../lib/coverage-floors.mjs'
import { areaOf, shippedSources } from '../lib/coverage-check-only.mjs'

/**
 * # The coverage gate's check-only mode, over a fictional repository
 *
 * CI has no local receipts, so it hands the gate the merged native coverage and the test reports and
 * asks one question: where does each area stand against the committed floors. Every file here is
 * made in a temporary folder; nothing reads the real repository or any provider home.
 *
 *  - ⚑ the shipped sources are the ones under the app and the packages, without tests, fixtures,
 *    declarations or the generated Codex protocol — and each belongs to one floor row;
 *  - ⛔ a row below its floor fails (exit 1) and is named, beside the rows that pass;
 *  - ⛔ a shipped source the measurement never reached fails (exit 1) rather than counting as zero;
 *  - ⛔ a failed test beyond the known census pair is exit 2 and writes no raised floors;
 *  - ⚑ a clean pass writes the raised floors and nothing inside the repository.
 */

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

let root
let out

/** One file's native counters: `hit` of `of` statements, one line each. */
function fileCoverage(path, hit, of) {
  const statementMap = Object.fromEntries(
    Array.from({ length: of }, (_, at) => [
      String(at),
      { start: { line: at + 1, column: 0 }, end: { line: at + 1, column: 4 } },
    ]),
  )
  return {
    path,
    statementMap,
    s: Object.fromEntries(Array.from({ length: of }, (_, at) => [String(at), at < hit ? 1 : 0])),
    fnMap: {},
    f: {},
    branchMap: {},
    b: {},
  }
}

const floorsFor = (lines) => ({
  version: 1,
  floors: Object.fromEntries(
    COVERAGE_AREAS.map((area) => [
      area,
      Object.fromEntries(
        COVERAGE_METRICS.map((metric) => [
          metric,
          metric === 'lines' && (area === 'main' || area === 'shared' || area === 'overall')
            ? lines
            : null,
        ]),
      ),
    ]),
  ),
  measuredCommit: null,
  counts: null,
  tests: null,
  qualifiedFailures: [],
  reviewedChange: null,
})

function report(tests) {
  return {
    numPassedTests: tests.filter((one) => one.status === 'passed').length,
    numFailedTests: tests.filter((one) => one.status === 'failed').length,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: join(root, 'scripts/test/something.test.mjs'),
        assertionResults: tests.map((one) => ({ status: one.status, fullName: one.name })),
      },
    ],
  }
}

function setup({ lines = 800, hit = { main: 9, shared: 9 }, skip = [] } = {}) {
  const sources = {
    'apps/desktop/src/main/a.ts': 'main',
    'apps/desktop/src/shared/b.ts': 'shared',
  }
  for (const file of [
    ...Object.keys(sources),
    'apps/desktop/src/main/a.test.ts',
    'apps/desktop/test/a.test.ts',
    'apps/desktop/src/renderer/src/look/scene.ts',
    'apps/desktop/src/main/types.d.ts',
    'packages/runtime/src/codex/protocol/V2.ts',
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), '// fiction\n')
  }
  writeFileSync(join(root, 'coverage-floors.json'), JSON.stringify(floorsFor(lines)))
  git(root, 'add', '-A')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'fiction')
  const raw = {}
  for (const [file, area] of Object.entries(sources)) {
    if (skip.includes(file)) continue
    raw[join(root, file)] = fileCoverage(join(root, file), hit[area], 10)
  }
  // A test file in the map is not a shipped source and must not count.
  raw[join(root, 'apps/desktop/src/main/a.test.ts')] = fileCoverage(
    join(root, 'apps/desktop/src/main/a.test.ts'),
    0,
    50,
  )
  const coverageFinal = join(root, '..', `${basename(root)}-coverage-final.json`)
  writeFileSync(coverageFinal, JSON.stringify(raw))
  return coverageFinal
}

const run = (coverageFinal, tests) => {
  const reportFile = join(out, 'tests.json')
  writeFileSync(reportFile, JSON.stringify(report(tests)))
  return checkOnly({
    repo: root,
    coverageFinal,
    testReports: [reportFile],
    out: join(out, 'result'),
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot-coverage-check-'))
  out = mkdtempSync(join(tmpdir(), 'brobot-coverage-out-'))
  git(root, 'init', '-q')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(out, { recursive: true, force: true })
  rmSync(`${root}-coverage-final.json`, { force: true })
})

describe('which sources are judged, and in which row', () => {
  it('⚑ keeps shipped code and drops tests, fixtures, scenes, declarations and the generated protocol', () => {
    const kept = shippedSources([
      'apps/desktop/src/main/a.ts',
      'apps/desktop/src/renderer/src/App.vue',
      'packages/runtime/src/x.ts',
      'packages/shared/src/y.ts',
      'apps/desktop/src/main/a.test.ts',
      'apps/desktop/test/a.test.ts',
      'apps/desktop/src/renderer/src/look/scene.ts',
      'apps/desktop/src/main/types.d.ts',
      'apps/desktop/src/main/db/migrations/0001.sql',
      'packages/runtime/src/codex/protocol/V2.ts',
      'scripts/coverage-gate.mjs',
    ])
    expect(kept).toEqual([
      'apps/desktop/src/main/a.ts',
      'apps/desktop/src/renderer/src/App.vue',
      'packages/runtime/src/x.ts',
      'packages/shared/src/y.ts',
    ])
  })

  it('⚑ gives each source one floor row: the app by folder, the runtime, then every other package', () => {
    expect(areaOf('apps/desktop/src/main/a.ts')).toBe('main')
    expect(areaOf('apps/desktop/src/shared/b.ts')).toBe('shared')
    expect(areaOf('apps/desktop/src/renderer/src/App.vue')).toBe('renderer')
    expect(areaOf('packages/runtime/src/x.ts')).toBe('runtime')
    expect(areaOf('packages/shared/src/y.ts')).toBe('other packages')
  })
})

describe('a measurement against the committed floors', () => {
  it('⚑ passes with every row at or above its floor, and writes the raised floors beside the table', async () => {
    const result = await run(setup(), [{ status: 'passed', name: 'reads' }])
    expect(result.exitCode).toBe(0)
    expect(result.rows.filter((row) => !row.passes)).toEqual([])
    expect(result.markdown).toContain('| main | 90.0% |')
    expect(result.raised.floors.main.lines).toBe(900)
    expect(
      JSON.parse(readFileSync(join(out, 'result', 'raised-floors.json'), 'utf8')).measuredCommit,
    ).toBe(git(root, 'rev-parse', 'HEAD').trim())
    // ⛔ Nothing was written into the repository: the committed floors are as committed.
    expect(git(root, 'status', '--porcelain').trim()).toBe('')
  })

  it('⛔ fails a row below its floor, names it, and writes no raised floors — the passing rows stay passing', async () => {
    const result = await run(setup({ lines: 950 }), [{ status: 'passed', name: 'reads' }])
    expect(result.exitCode).toBe(1)
    expect(
      result.rows.filter((row) => !row.passes).map((row) => `${row.area} ${row.metric}`),
    ).toEqual(['main lines', 'shared lines', 'overall lines'])
    expect(result.markdown).toContain('Below a floor: main lines, shared lines, overall lines.')
    expect(result.raised).toBeNull()
  })

  it('⛔ compares exactly: a measurement of 90.0% meets a 90.0% floor and misses a 90.1% one', async () => {
    const meets = await run(setup({ lines: 900 }), [])
    expect(meets.exitCode).toBe(0)
    const result = await run(setup({ lines: 901 }), [])
    expect(result.exitCode).toBe(1)
  })

  it('⛔ fails a shipped source the measurement never reached, rather than counting it as nothing', async () => {
    const result = await run(setup({ skip: ['apps/desktop/src/shared/b.ts'] }), [])
    expect(result.exitCode).toBe(1)
    expect(result.missing).toEqual(['apps/desktop/src/shared/b.ts'])
    expect(result.raised).toBeNull()
  })

  it('⚑ a test beyond the known census pair is exit 2 with no raised floors; the known pair is not', async () => {
    const [file, name] = JSON.parse([...KNOWN_FAILURES][0])
    const stray = {
      ...report([{ status: 'failed', name: 'something else' }]),
    }
    const reportFile = join(out, 'stray.json')
    writeFileSync(reportFile, JSON.stringify(stray))
    const coverageFinal = setup()
    const result = await checkOnly({
      repo: root,
      coverageFinal,
      testReports: [reportFile],
      out: join(out, 'stray-result'),
    })
    expect(result.exitCode).toBe(2)
    expect(result.unknown).toEqual([['scripts/test/something.test.mjs', 'something else']])
    expect(result.raised).toBeNull()

    const known = {
      numPassedTests: 0,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        { name: join(root, file), assertionResults: [{ status: 'failed', fullName: name }] },
      ],
    }
    writeFileSync(reportFile, JSON.stringify(known))
    const accepted = await checkOnly({
      repo: root,
      coverageFinal,
      testReports: [reportFile],
      out: join(out, 'known-result'),
    })
    expect(accepted.exitCode).toBe(0)
    expect(accepted.unknown).toEqual([])
  })

  it('⛔ a test file that fails to load, with no failed assertion, is an unknown failure: exit 2, no raised floors', async () => {
    const coverageFinal = setup()
    const reportFile = join(out, 'broken.json')
    writeFileSync(
      reportFile,
      JSON.stringify({
        numPassedTests: 0,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        numFailedTestSuites: 1,
        testResults: [
          {
            name: join(root, 'apps/desktop/test/broken.test.ts'),
            status: 'failed',
            message: 'Error: Cannot find module ./gone\n    at load',
            assertionResults: [],
          },
        ],
      }),
    )
    const result = await checkOnly({
      repo: root,
      coverageFinal,
      testReports: [reportFile],
      out: join(out, 'broken-result'),
    })
    expect(result.exitCode).toBe(2)
    expect(result.unknown).toEqual([
      [
        'apps/desktop/test/broken.test.ts',
        '(the test file failed without a failed test: Error: Cannot find module ./gone)',
      ],
    ])
    expect(result.raised).toBeNull()
    expect(result.markdown).toContain('broken.test.ts')
  })

  it('⛔ a failed suite the report names under no file is an unknown failure too; a clean report is not', async () => {
    const coverageFinal = setup()
    const reportFile = join(out, 'nameless.json')
    const base = {
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [],
    }
    writeFileSync(reportFile, JSON.stringify({ ...base, numFailedTestSuites: 2 }))
    const failed = await checkOnly({
      repo: root,
      coverageFinal,
      testReports: [reportFile],
      out: join(out, 'n1'),
    })
    expect(failed.exitCode).toBe(2)
    expect(failed.unknown[0][1]).toContain('2 failed test suites')
    writeFileSync(reportFile, JSON.stringify({ ...base, numFailedTestSuites: 0 }))
    const clean = await checkOnly({
      repo: root,
      coverageFinal,
      testReports: [reportFile],
      out: join(out, 'n2'),
    })
    expect(clean.exitCode).toBe(0)
  })

  it('⛔ refuses relative paths and an uninitialized floors file', async () => {
    await expect(
      checkOnly({ repo: 'relative', coverageFinal: '/x', testReports: ['/y'], out: '/z' }),
    ).rejects.toThrow('Use absolute paths')
    const coverageFinal = setup()
    writeFileSync(join(root, 'coverage-floors.json'), JSON.stringify({ version: 1, floors: null }))
    await expect(
      checkOnly({
        repo: root,
        coverageFinal,
        testReports: [join(out, 'x.json')],
        out: join(out, 'r'),
      }),
    ).rejects.toThrow('not initialized')
  })
})
