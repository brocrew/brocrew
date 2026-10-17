import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// These runner contracts use POSIX Bash, process signals and verify_row's signal mask.
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const HARNESS = join(REPO, 'scripts/mutations/lib/harness.sh')
const RUNNER_DRIVER = join(REPO, 'scripts/mutations/lib/run-table.sh')
const PINNED_VITEST = join(REPO, 'node_modules/.bin/vitest')
// `/bin/bash` is the repository's minimum supported system shell on macOS (GNU Bash 3.2). Running
// the integration through it keeps newer Homebrew Bash releases from hiding portability defects.
const SYSTEM_BASH = '/bin/bash'

// This integration file repeatedly crosses JavaScript -> synchronous Bash -> Python and, in three
// cases, the pinned Vitest. Vitest cannot interrupt execFileSync/spawnSync: its timer callback only
// runs after the child returns, then its elapsed-time check turns a slow successful contract check
// into a timeout. A positive per-test budget therefore provides no hang protection and asserts only
// how busy the host was. No hang protection is lost here; a real liveness guard would have to kill
// the child at the subprocess boundary. Keep the behavioural gate in CI without that invalid clock.
vi.setConfig({ testTimeout: 0 })

/**
 * ⛔ **The seventh vacuity class, and the test that makes it impossible to reintroduce** (196 H1).
 *
 * `193` found that all **32 of 32** mutation tables derived their verdict from vitest's stdout and
 * dropped its exit status on the floor:
 *
 *     out="$(… npx vitest run … 2>&1)"          # status discarded here
 *     line="$(… grep -E '^ *Tests +' …)"        # verdict read from stdout alone
 *
 * So a run in which every test passed and the PROCESS still failed printed `GREEN` — and that
 * verdict is what has certified every fix in this project since 146.
 *
 * ⚑ **The first test below is not a simulation.** It runs real vitest over a real one-test project
 * whose `afterAll` throws, which is precisely the "unhandled teardown error" `193` named: vitest
 * prints `Tests 1 passed (1)`, prints `Test Files 1 failed (1)`, and exits `1`. The old `run_suite`
 * called that GREEN. The measurement is made in the test rather than asserted from memory, so a
 * future vitest that stops exiting non-zero for this fails HERE instead of quietly making the
 * regression untestable.
 */
describeOnPosix('the mutation harness verdict (196 H1)', () => {
  /**
   * Calls the SHARED `run_suite` in a fresh bash, with `$ROOT` pointed wherever the caller wants
   * and the Vitest executable optionally stubbed. One function, so every case below exercises the
   * same code the tables source — a copy here would be the very thing this file is about.
   */
  const runSuite = ({
    root,
    project = 'unit',
    expect: baseline = '-',
    path = process.env.PATH,
    vitestBin,
    forceColor = process.env.FORCE_COLOR,
  }) => {
    const override =
      vitestBin === undefined ? '' : `MUTATION_VITEST_BIN=${JSON.stringify(vitestBin)}; `
    return execFileSync(
      SYSTEM_BASH,
      [
        '-uo',
        'pipefail',
        '-c',
        `. "${HARNESS}"; ${override}ROOT="${root}"; ` + `run_suite "${project}" "${baseline}"`,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: path, FORCE_COLOR: forceColor, NO_COLOR: undefined },
      },
    )
  }

  /** A throwaway project vitest can actually run, with the passing test the caller asks for. */
  const project = (testSource) => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-verdict-'))
    // A NAMED project, because that is how the harness invokes vitest: `--project="$project"`.
    writeFileSync(
      join(dir, 'vitest.config.mjs'),
      `export default { test: { projects: [{ test: { name: 'unit', include: ['*.test.js'] } }] } }\n`,
    )
    writeFileSync(join(dir, 'a.test.js'), testSource)
    return dir
  }

  /**
   * A fake Vitest executable that prints exactly what we hand it, writes the report we hand it,
   * and exits how we say — for branches a real run cannot produce quickly or deterministically.
   *
   * ⚑ **`report` is the channel the verdict is actually read from since 235**, so it is separate
   * from `stdout` on purpose: a fixture can now make the two DISAGREE, which is the only way to
   * test that the parser is reading the right one. `null` writes no report at all.
   */
  const stubNpx = (stdout, code, report = { files: 1, tests: 1, failed: 0 }) => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-stub-npx-'))
    const json =
      report === null
        ? null
        : JSON.stringify({
            testResults: Array.from({ length: report.files }, () => ({})),
            numTotalTests: report.tests,
            numFailedTests: report.failed,
          })
    const executable = join(dir, 'npx')
    writeFileSync(
      executable,
      `#!/usr/bin/env bash\n` +
        `out=""\n` +
        `for arg in "$@"; do case "$arg" in --outputFile.json=*) out="\${arg#--outputFile.json=}";; esac; done\n` +
        `cat <<'STUB_EOF'\n${stdout}\nSTUB_EOF\n` +
        (json === null
          ? ''
          : `if [[ -n "$out" ]]; then cat >"$out" <<'JSON_EOF'\n${json}\nJSON_EOF\nfi\n`) +
        `exit ${code}\n`,
      { mode: 0o755 },
    )
    return executable
  }

  it('⛔ a forced-colour suite whose tests pass but process exits 1 is ERROR, never GREEN', () => {
    // The real thing: one passing test, an `afterAll` that throws. Measured, not assumed.
    const dir = project(
      `import { it, expect, afterAll } from 'vitest'\n` +
        `it('passes', () => { expect(1).toBe(1) })\n` +
        `afterAll(() => { throw new Error('teardown blew up after the summary') })\n`,
    )
    try {
      // ⚑ The premise, asserted before the verdict is read: Vitest's own JSON says the one test
      // passed and the process still exits non-zero. Without this the test could pass over a Vitest that had
      // simply started failing the test itself.
      const report = join(dir, 'premise.json')
      let status = 0
      try {
        execFileSync(
          PINNED_VITEST,
          [
            'run',
            '--project=unit',
            '--reporter=default',
            '--reporter=json',
            `--outputFile.json=${report}`,
          ],
          {
            cwd: dir,
            encoding: 'utf8',
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: undefined,
              FORCE_COLOR: '1',
              NO_COLOR: undefined,
            },
          },
        )
      } catch (error) {
        status = error.status
      }
      expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
      })
      expect(status, 'vitest no longer exits non-zero for a throwing afterAll').toBe(1)

      // …and now the verdict the harness draws from that same run.
      const verdict = runSuite({ root: dir, forceColor: '1' })
      expect(verdict).toMatch(/^ERROR all 1 passed but vitest exited 1/)
      expect(verdict, 'the defect: this printed GREEN in all 32 tables').not.toMatch(/GREEN/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⚑ the paired positive — an ordinary passing run still reads GREEN', () => {
    const dir = project(
      `import { it, expect } from 'vitest'\nit('passes', () => { expect(1).toBe(1) })\n`,
    )
    try {
      // A PATH-first fake npx would fail immediately. The harness must instead use this worktree's
      // absolute, pnpm-installed Vitest while keeping the throwaway project as its cwd.
      writeFileSync(join(dir, 'npx'), '#!/bin/sh\nexit 97\n', { mode: 0o755 })
      const poisonedPath = `${dir}:${process.env.PATH}`
      expect(runSuite({ root: dir, path: poisonedPath })).toBe('GREEN 0 of 1 in 1 files')
      // …and the baseline comparison still bites when the tree collected fewer than it should.
      expect(runSuite({ root: dir, expect: '2', path: poisonedPath })).toBe(
        'INVALID (collected 1 of 2, exit 0)',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a failing suite is RED, and RED is still distinct from ERROR', () => {
    const vitestBin = stubNpx(
      ' Test Files  1 failed (1)\n      Tests  3 failed | 244 passed (247)',
      1,
      { files: 1, tests: 247, failed: 3 },
    )
    expect(runSuite({ root: REPO, vitestBin })).toBe('RED 3 of 247 in 1 files')
  })

  it('a passing suite that exits non-zero is ERROR whatever the counts', () => {
    // The `193` scenario at its stated scale: 247 tests pass, vitest exits 1 anyway.
    const vitestBin = stubNpx(' Test Files  12 passed (12)\n      Tests  247 passed (247)', 1, {
      files: 12,
      tests: 247,
      failed: 0,
    })
    expect(runSuite({ root: REPO, vitestBin })).toBe(
      'ERROR all 247 passed but vitest exited 1 in 12 files',
    )
    // ⚠️ And the exit status is not allowed to overrule the COUNT check either: a short run is
    // still INVALID rather than ERROR, because "the tree is not the tree under test" is the more
    // specific fact and the one a reader has to act on.
    expect(runSuite({ root: REPO, expect: '250', vitestBin })).toBe(
      'INVALID (collected 247 of 250, exit 1)',
    )
  })

  it('a run that collected nothing says so, and says what the process thought of it', () => {
    const vitestBin = stubNpx('No test files found, exiting with code 1', 1, {
      files: 0,
      tests: 0,
      failed: 0,
    })
    expect(runSuite({ root: REPO, vitestBin })).toBe('NO-TESTS (exit 1)')
  })
})

/**
 * ⛔ **The verdict is read from a channel the tests under it cannot write to** (235, from 206 H2,
 * re-verified at 231).
 *
 * `196` H1 took the process's exit status off the floor and left the COUNTS where they were: in
 * stdout, matched by `grep -E '^ *Tests +' | tail -1`. ⚠️ **That is an assumption about ordering
 * dressed as a parse** — any line of that shape anywhere in the captured output matches, and this
 * repository runs vitest inside vitest deliberately (this very file does). A child's summary that
 * lands after the parent's footer — inside an `execFileSync` failure message, a `Serialized Error`
 * block, an unhandled rejection — is the line `tail -1` returns.
 *
 * ⛔ **And the verdict is what says whether a mutation was killed**, so the failure is not cosmetic:
 * a nested `1 failed` turns a surviving mutant into a recorded RED, which is a row claiming coverage
 * that does not exist — in the instrument that certifies every other fix in this project.
 */
/** mutation_vitest applies low priority and a worker cap without requiring a run wrapper. */
/**
 * ⛔ **W4.91 · every run is bounded, and a run past its bound is NOT MEASURED** (W4.78's finding:
 * `3002 M8` made its killer reopen without end and held the slot for thirty minutes). `run_suite`
 * runs Vitest through `lib/bounded.py`, which stops the whole process group at the bound and exits
 * 124; the verdict says NOT MEASURED and is never RED or GREEN.
 */
describeOnPosix('W4.91 · a run past its bound is stopped, and is NOT MEASURED', () => {
  const BOUNDED = join(REPO, 'scripts/mutations/lib/bounded.py')

  /** A fake Vitest that writes a passing report, then sleeps; its child sleeps too. */
  const hanging = (dir) => {
    const executable = join(dir, 'vitest')
    writeFileSync(
      executable,
      `#!/bin/bash\n` +
        `out=""\n` +
        `for arg in "$@"; do case "$arg" in --outputFile.json=*) out="\${arg#--outputFile.json=}";; esac; done\n` +
        `[[ -n "$out" ]] && printf '%s' '{"testResults":[{}],"numTotalTests":1,"numFailedTests":0}' >"$out"\n` +
        `sleep 30 & echo $! >"${join(dir, 'child.pid')}"\n` +
        `sleep 30\n`,
      { mode: 0o755 },
    )
    return executable
  }

  const runSuite = (executable, bounds, files = []) =>
    spawnSync(
      SYSTEM_BASH,
      [
        '-uo',
        'pipefail',
        '-c',
        `. "${HARNESS}"; MUTATION_VITEST_BIN=${JSON.stringify(executable)}; ROOT=${JSON.stringify(REPO)}; ` +
          `run_suite unit - ${files.map((one) => JSON.stringify(one)).join(' ')}`,
      ],
      // ⚠️ `Object.assign`, not two spreads in one brace: the Bash-3.2 census reads `{…..}` as a
      // stepped brace expansion.
      { encoding: 'utf8', env: Object.assign({}, process.env, bounds) },
    )

  const alive = (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  it('🔴 a run over named files past its bound is NOT MEASURED — not GREEN though its report passed — and its children are stopped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-bounded-'))
    try {
      const started = Date.now()
      const result = runSuite(hanging(dir), { MUTATION_FILE_RUN_BOUND_S: '1' }, ['a.test.ts'])
      expect(Date.now() - started, 'the bound did not stop the run').toBeLessThan(20_000)
      expect(result.stdout).toMatch(
        /^NO-REPORT \(ran past its 1 s bound and was stopped — NOT MEASURED, exit 124\)$/,
      )
      expect(result.stdout).not.toMatch(/^(GREEN|RED)\b/)
      const child = Number(readFileSync(join(dir, 'child.pid'), 'utf8'))
      expect(alive(child), 'a worker of the stopped run was left running').toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⚑ the files get the file bound and a whole project gets the project bound', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-bounded-'))
    try {
      // A whole project under a 1 s FILE bound is not stopped by it: the project bound applies.
      const project = runSuite(
        hanging(dir),
        { MUTATION_FILE_RUN_BOUND_S: '1', MUTATION_PROJECT_RUN_BOUND_S: '2' },
        [],
      )
      expect(project.stdout).toContain('ran past its 2 s bound')
      const bound = (args) =>
        execFileSync(SYSTEM_BASH, ['-c', `. "${HARNESS}"; mutation_run_bound ${args}`], {
          encoding: 'utf8',
          env: {
            ...process.env,
            MUTATION_FILE_RUN_BOUND_S: '7',
            MUTATION_PROJECT_RUN_BOUND_S: '9',
          },
        })
      expect(bound('run --project=desktop --reporter=json')).toBe('9')
      expect(bound('run --project=desktop --reporter=json a.test.ts')).toBe('7')
      // ⚑ The defaults: verify_row.py's 600 s for files, 1800 s for a whole project.
      expect(
        execFileSync(
          SYSTEM_BASH,
          [
            '-c',
            `. "${HARNESS}"; mutation_run_bound run x.test.ts; printf ' '; mutation_run_bound run`,
          ],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              MUTATION_FILE_RUN_BOUND_S: '',
              MUTATION_PROJECT_RUN_BOUND_S: '',
            },
          },
        ),
      ).toBe('600 1800')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⚑ inside its bound a run is untouched: its exit status and its output pass through', () => {
    const ok = spawnSync('python3', [BOUNDED, '5', 'sh', '-c', 'echo said; echo err >&2; exit 3'], {
      encoding: 'utf8',
    })
    expect(ok.status).toBe(3)
    expect(ok.stdout).toBe('said\n')
    expect(ok.stderr).toBe('err\n')
    const stopped = spawnSync('python3', [BOUNDED, '0.5', 'sleep', '10'], { encoding: 'utf8' })
    expect(stopped.status).toBe(124)
    expect(stopped.stderr).toContain('NOT MEASURED')
    expect(spawnSync('python3', [BOUNDED, 'soon', 'true'], { encoding: 'utf8' }).status).toBe(64)
  })
})

describeOnPosix('W4.36 · every Vitest a mutation run starts is gentle', () => {
  const probe = () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-gentle-'))
    const executable = join(dir, 'vitest')
    writeFileSync(
      executable,
      `#!/bin/bash\nprintf 'workers=%s nice=%s args=%s\\n' "\${VITEST_MAX_WORKERS-unset}" "$(ps -o nice= -p $$ | tr -d ' ')" "$*"\n`,
      { mode: 0o755 },
    )
    return { dir, executable }
  }
  const call = (executable, presetWorkers) => {
    const env = { ...process.env }
    delete env.VITEST_MAX_WORKERS
    if (presetWorkers !== undefined) env.VITEST_MAX_WORKERS = presetWorkers
    return execFileSync(
      SYSTEM_BASH,
      [
        '-uo',
        'pipefail',
        '-c',
        `. "${HARNESS}"; MUTATION_VITEST_BIN=${JSON.stringify(executable)}; ` +
          `printf 'parent=%s\\n' "$(ps -o nice= -p $$ | tr -d ' ')"; mutation_vitest run --project=desktop a.test.ts`,
      ],
      { encoding: 'utf8', env },
    )
  }

  it('🔴 at most two workers when nobody said, at fifteen steps lower priority than its caller', () => {
    const { dir, executable } = probe()
    try {
      const out = call(executable)
      const parent = Number(out.match(/parent=(-?\d+)/)[1])
      expect(out).toContain('workers=2 ')
      // `nice -n 15` adds to the caller's niceness, and the system stops at 20.
      expect(out).toContain(`nice=${Math.min(parent + 15, 20)} `)
      expect(out).toContain('args=run --project=desktop a.test.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⚑ a number the caller set is kept — a slot that asks for one worker gets one', () => {
    const { dir, executable } = probe()
    try {
      expect(call(executable, '1')).toContain('workers=1 ')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⛔ the harness says so where a reader of it looks, and does not lose ELECTRON_RUN_AS_NODE removal', () => {
    const source = readFileSync(HARNESS, 'utf8')
    expect(source).toMatch(
      /env -u ELECTRON_RUN_AS_NODE \\\n\s+VITEST_MAX_WORKERS="\$\{VITEST_MAX_WORKERS:-\$MUTATION_DEFAULT_MAX_WORKERS\}" \\\n\s+nice -n "\$MUTATION_NICENESS"/,
    )
    expect(source).toContain('MUTATION_NICENESS=15')
    expect(source).toContain('MUTATION_DEFAULT_MAX_WORKERS=2')
  })
})

describeOnPosix('the verdict channel (235, from 206 H2)', () => {
  const runSuite = ({
    root,
    project = 'unit',
    expect: baseline = '-',
    path = process.env.PATH,
    vitestBin,
  }) => {
    const override =
      vitestBin === undefined ? '' : `MUTATION_VITEST_BIN=${JSON.stringify(vitestBin)}; `
    return execFileSync(
      SYSTEM_BASH,
      [
        '-uo',
        'pipefail',
        '-c',
        `. "${HARNESS}"; ${override}ROOT="${root}"; ` + `run_suite "${project}" "${baseline}"`,
      ],
      { encoding: 'utf8', env: { ...process.env, PATH: path } },
    )
  }

  const stubNpx = (stdout, code, report) => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-stub-npx-'))
    const json =
      report === null
        ? null
        : JSON.stringify({
            testResults: Array.from({ length: report.files }, () => ({})),
            numTotalTests: report.tests,
            numFailedTests: report.failed,
          })
    const executable = join(dir, 'npx')
    writeFileSync(
      executable,
      `#!/usr/bin/env bash\n` +
        `out=""\n` +
        `for arg in "$@"; do case "$arg" in --outputFile.json=*) out="\${arg#--outputFile.json=}";; esac; done\n` +
        `cat <<'STUB_EOF'\n${stdout}\nSTUB_EOF\n` +
        (json === null
          ? ''
          : `if [[ -n "$out" ]]; then cat >"$out" <<'JSON_EOF'\n${json}\nJSON_EOF\nfi\n`) +
        `exit ${code}\n`,
      { mode: 0o755 },
    )
    return executable
  }

  /**
   * ⛔ **A real captured nested run, not a hand-typed line.** The outer suite passed 247 tests; a
   * test inside it shelled out to another vitest that failed, and the child's stdout came back in
   * the assertion message vitest prints AFTER its own footer. Both summaries are in the buffer and
   * the CHILD's is last.
   */
  const NESTED_OUTPUT = [
    ' Test Files  12 passed (12)',
    '      Tests  247 passed (247)',
    '   Start at  17:24:44',
    '   Duration  6.63s',
    '',
    '⎯⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯⎯',
    'Error: Command failed: bash -c ". harness.sh; run_suite unit -"',
    '',
    ' RUN  v4.1.10 /tmp/brobot2-verdict-abc',
    '',
    ' Test Files  1 failed (1)',
    '      Tests  1 failed | 1 passed (2)',
    '   Start at  17:24:45',
    '   Duration  0.10s',
  ].join('\n')

  it('⛔ a NESTED summary printed after the footer does not decide the verdict', () => {
    // The truth about the outer run, on the channel only the outer run can write.
    const vitestBin = stubNpx(NESTED_OUTPUT, 0, { files: 12, tests: 247, failed: 0 })
    expect(runSuite({ root: REPO, vitestBin })).toBe('GREEN 0 of 247 in 12 files')
  })

  it('⚑ …and the fixture really would have defeated the old parse', () => {
    // ⚠️ Without this the test above is a green light over an instrument that might not be plugged
    // in: a fixture whose nested summary happened NOT to be last, or whose numbers matched the
    // outer ones, would pass whatever the parser did. This runs the EXACT expression `harness.sh`
    // carried until 235 over the same bytes and shows what it returns.
    const oldParse = execFileSync(
      SYSTEM_BASH,
      [
        '-uo',
        'pipefail',
        '-c',
        `printf '%s\\n' "$1" | grep -E '^ *Tests +' | tail -1`,
        '_',
        NESTED_OUTPUT,
      ],
      { encoding: 'utf8' },
    ).trim()
    expect(oldParse).toBe('Tests  1 failed | 1 passed (2)')
    // Which is a killed mutant — 1 of 2 failed — reported for a run in which 247 of 247 passed.
  })

  it('⛔ no report at all is NO-REPORT, never a green read off the stdout it replaced', () => {
    // The old code would have parsed this stdout happily. A fallback to the weaker channel is how
    // the weaker channel stays in use, so the absence is named instead.
    const vitestBin = stubNpx(' Test Files  12 passed (12)\n      Tests  247 passed (247)', 0, null)
    const verdict = runSuite({ root: REPO, vitestBin })
    expect(verdict).toBe('NO-REPORT (exit 0)')
    expect(verdict).not.toMatch(/GREEN/)
  })

  it('⚑ counts FILES, not describe blocks — the two numbers differ and only one is the old one', () => {
    // A real run, because this is a fact about vitest's report and not about our parsing of it:
    // `numTotalTestSuites` counts `describe`s (2 here) and `testResults` counts files (1). Every
    // table's recorded rows say "in N files"; reading the suite count instead would silently change
    // what that number means, and nothing in a stub would notice.
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-verdict-files-'))
    writeFileSync(
      join(dir, 'vitest.config.mjs'),
      `export default { test: { projects: [{ test: { name: 'unit', include: ['*.test.js'] } }] } }\n`,
    )
    writeFileSync(
      join(dir, 'a.test.js'),
      `import { describe, it, expect } from 'vitest'\n` +
        `describe('one', () => { it('a', () => { expect(1).toBe(1) }) })\n` +
        `describe('two', () => { it('b', () => { expect(1).toBe(1) }) })\n`,
    )
    try {
      expect(runSuite({ root: dir })).toBe('GREEN 0 of 2 in 1 files')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * ⛔ **A verdict exists only relative to a healthy, unchanged test roster** (264 E3/E6).
 *
 * Counts cannot show either failure below: a pristine failure keeps the same total while making
 * every mutant look RED, and `it.skip` keeps the same total while executing less. These fixtures
 * drive the shared shell functions in the same order as every table, including the refusal before
 * M0; they do not reimplement the decision in JavaScript.
 */
describeOnPosix('the mutation baseline contract (264 E3/E6)', () => {
  const report = (tests) => ({
    testResults: [
      {
        name: '/fixture/a.test.js',
        status: tests.some((test) => test.status === 'failed') ? 'failed' : 'passed',
        assertionResults: tests.map((test) => ({
          ancestorTitles: [],
          title: test.name,
          fullName: test.name,
          status: test.status,
        })),
      },
    ],
    numTotalTests: tests.length,
    numPassedTests: tests.filter((test) => test.status === 'passed').length,
    numFailedTests: tests.filter((test) => test.status === 'failed').length,
    numPendingTests: tests.filter((test) => test.status === 'pending').length,
    numTodoTests: tests.filter((test) => test.status === 'todo').length,
  })

  /** An npx seam that returns one Vitest report per invocation, in order. */
  const stubNpxSequence = (runs) => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot2-contract-npx-'))
    runs.forEach((run, index) => {
      writeFileSync(join(dir, `report-${index + 1}.json`), JSON.stringify(run.report))
      writeFileSync(join(dir, `status-${index + 1}`), String(run.status))
    })
    writeFileSync(
      join(dir, 'npx'),
      `#!/usr/bin/env bash\n` +
        `counter=${JSON.stringify(join(dir, 'counter'))}\n` +
        `if [[ -f "$counter" ]]; then n=$(( $(<"$counter") + 1 )); else n=1; fi\n` +
        `printf '%s\\n' "$n" >"$counter"\n` +
        `out=""\n` +
        `for arg in "$@"; do case "$arg" in --outputFile.json=*) out="\${arg#--outputFile.json=}";; esac; done\n` +
        `cp ${JSON.stringify(dir)}/report-$n.json "$out"\n` +
        `exit "$(<${JSON.stringify(dir)}/status-$n)"\n`,
      { mode: 0o755 },
    )
    return dir
  }

  const invoke = (runs, body) => {
    const stub = stubNpxSequence(runs)
    const work = mkdtempSync(join(tmpdir(), 'brobot2-contract-work-'))
    try {
      return execFileSync(
        SYSTEM_BASH,
        [
          '-uo',
          'pipefail',
          '-c',
          `. "${HARNESS}"; MUTATION_VITEST_BIN=${JSON.stringify(join(stub, 'npx'))}; ` +
            `ROOT="${REPO}"; WORK="${work}"; ${body}`,
        ],
        { encoding: 'utf8', env: process.env },
      )
    } finally {
      rmSync(stub, { recursive: true, force: true })
      rmSync(work, { recursive: true, force: true })
    }
  }

  it('⛔ REFUSES a red pristine baseline before M0 can bless or apply any row', () => {
    let failure
    try {
      invoke(
        [{ report: report([{ name: 'already broken', status: 'failed' }]), status: 1 }],
        `BASE="$(suite_count unit)"; require_healthy_baselines || exit 5; echo MUTATION_APPLIED`,
      )
      failure = null
    } catch (error) {
      failure = error
    }
    expect(failure?.status).toBe(5)
    expect(`${failure?.stdout ?? ''}${failure?.stderr ?? ''}`).toContain('INVALID BASELINE')
    expect(`${failure?.stdout ?? ''}${failure?.stderr ?? ''}`).toContain('1 failing test')
    expect(`${failure?.stdout ?? ''}${failure?.stderr ?? ''}`).toContain(
      'a.test.js :: already broken',
    )
    expect(`${failure?.stdout ?? ''}${failure?.stderr ?? ''}`).not.toContain('MUTATION_APPLIED')
  })

  it('⛔ the observed 864-of-873 zero-failure run is INVALID on either side of M0', () => {
    const counted = (count, files) => {
      let next = 0
      const testResults = Array.from({ length: files }, (_, fileIndex) => {
        const fileCount = Math.floor(count / files) + (fileIndex < count % files ? 1 : 0)
        const assertionResults = Array.from({ length: fileCount }, () => {
          next += 1
          return {
            ancestorTitles: [],
            title: `dom test ${next}`,
            fullName: `dom test ${next}`,
            status: 'passed',
          }
        })
        return { name: `/fixture/dom-${fileIndex + 1}.test.ts`, status: 'passed', assertionResults }
      })
      return {
        testResults,
        numTotalTests: count,
        numPassedTests: count,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
      }
    }

    const mismatch = (baseline, observed) => {
      try {
        invoke(
          [
            { report: counted(...baseline), status: 0 },
            { report: counted(...observed), status: 0 },
          ],
          `BASE="$(suite_count dom)"; require_healthy_baselines || exit 5; ` +
            `begin_mutation_control M0; run_suite dom "$BASE"; ` +
            `require_healthy_control M0 || exit 5`,
        )
      } catch (error) {
        return error
      }
      throw new Error('a mismatched M0 control was accepted')
    }

    for (const [baseline, observed] of [
      [
        [873, 63],
        [864, 62],
      ],
      [
        [864, 62],
        [873, 63],
      ],
    ]) {
      const failure = mismatch(baseline, observed)
      expect(failure.status).toBe(5)
      expect(`${failure.stdout ?? ''}`).toContain(
        `INVALID (collected ${observed[0]} of ${baseline[0]}, exit 0)`,
      )
      expect(`${failure.stdout ?? ''}`).not.toContain('GREEN')
      expect(`${failure.stderr ?? ''}`).toContain('M0 CONTROL')
      expect(`${failure.stderr ?? ''}`).toContain('ended INVALID, not GREEN')
    }
  })

  it('⛔ passing tests changed to skipped, pending/queued, or todo are INVALID, never GREEN', () => {
    const statuses = ['skipped', 'pending', 'todo']
    const output = invoke(
      [
        { report: report([{ name: 'still counted', status: 'passed' }]), status: 0 },
        ...statuses.map((status) => ({
          report: report([{ name: 'still counted', status }]),
          status: 0,
        })),
      ],
      `BASE="$(suite_count unit)"; require_healthy_baselines || exit 5; ` +
        `for status in skipped pending todo; do ` +
        `printf '%s=' "$status"; run_suite unit "$BASE"; printf '\\n'; done`,
    )
    const verdicts = output.trim().split('\n')
    expect(verdicts).toHaveLength(statuses.length)
    statuses.forEach((status, index) => {
      expect(verdicts[index]).toMatch(new RegExp(`^${status}=INVALID \\(test status changed:`))
      expect(verdicts[index]).toContain(`passed -> ${status}`)
      expect(verdicts[index]).not.toContain('GREEN')
    })
  })

  it('⛔ a missing test replaced by another test at the same count is INVALID', () => {
    const output = invoke(
      [
        { report: report([{ name: 'the baseline identity', status: 'passed' }]), status: 0 },
        { report: report([{ name: 'a substituted identity', status: 'passed' }]), status: 0 },
      ],
      `BASE="$(suite_count unit)"; require_healthy_baselines || exit 5; run_suite unit "$BASE"`,
    )
    expect(output).toContain('INVALID (missing tests:')
    expect(output).toContain('substituted tests:')
  })

  it('accepts an unchanged todo inventory, but the control still requires every project GREEN', () => {
    const output = invoke(
      [
        {
          report: report([
            { name: 'runs', status: 'passed' },
            { name: 'accepted todo', status: 'todo' },
          ]),
          status: 0,
        },
        {
          report: report([
            { name: 'runs', status: 'passed' },
            { name: 'accepted todo', status: 'todo' },
          ]),
          status: 0,
        },
      ],
      `BASE="$(suite_count unit)"; require_healthy_baselines || exit 5; ` +
        `begin_mutation_control M0; run_suite unit "$BASE"; require_healthy_control M0`,
    )
    expect(output).toBe('GREEN 0 of 2 in 1 files')
  })

  it('tracks equal Vitest fullNames by stable occurrence instead of refusing parameterised tests', () => {
    const output = invoke(
      [
        {
          report: report([
            { name: 'case %p', status: 'passed' },
            { name: 'case %p', status: 'passed' },
          ]),
          status: 0,
        },
        {
          report: report([
            { name: 'case %p', status: 'passed' },
            { name: 'case %p', status: 'failed' },
          ]),
          status: 1,
        },
      ],
      `BASE="$(suite_count unit)"; require_healthy_baselines || exit 5; run_suite unit "$BASE"`,
    )
    expect(output).toBe('RED 1 of 2 in 1 files')
  })

  it('⛔ an earlier GREEN cannot satisfy a later control epoch with a missing project', () => {
    let failure
    try {
      invoke(
        [
          { report: report([{ name: 'unit', status: 'passed' }]), status: 0 },
          { report: report([{ name: 'other', status: 'passed' }]), status: 0 },
        ],
        `suite_count unit u >/dev/null; suite_count other o >/dev/null; ` +
          `require_healthy_baselines || exit 5; begin_mutation_control M0; ` +
          `record_mutation_verdict unit GREEN u; record_mutation_verdict other GREEN o; ` +
          `require_healthy_control M0 || exit 5; begin_mutation_control M-END; ` +
          `record_mutation_verdict unit GREEN u; require_healthy_control M-END`,
      )
      failure = null
    } catch (error) {
      failure = error
    }
    expect(failure?.status).toBe(1)
    expect(`${failure?.stdout ?? ''}${failure?.stderr ?? ''}`).toContain(
      'other o ended MISSING, not GREEN',
    )
  })

  it('⛔ a registered product channel can invalidate an otherwise GREEN control', () => {
    let failure
    try {
      invoke(
        [
          { report: report([{ name: 'unit', status: 'passed' }]), status: 0 },
          { report: report([{ name: 'unit', status: 'passed' }]), status: 0 },
        ],
        `BASE="$(suite_count unit)"; register_mutation_control_channel window; ` +
          `require_healthy_baselines || exit 5; begin_mutation_control M0; ` +
          `run_suite unit "$BASE" >/dev/null; record_mutation_control_channel window RED; ` +
          `require_healthy_control M0`,
      )
      failure = null
    } catch (error) {
      failure = error
    }
    expect(failure?.status).toBe(1)
    expect(`${failure?.stdout ?? ''}${failure?.stderr ?? ''}`).toContain(
      'window ended RED, not GREEN',
    )
  })
})

/**
 * ⛔ **A reachability omission is a recorded measurement, never an inferred GREEN** (298).
 *
 * The topology helper is consulted once when the table opens its log. Each proved active row then
 * receives that captured token and may omit only the four audited Vitest projects. Everything that
 * cannot be proved — including `shared`, legacy labels, bad helper output, and controls — runs.
 */
describeOnPosix('conservative mutation-project routing (298)', () => {
  const rule =
    ' — For each row, run every baseline project whose tests can conservatively reach an edited ' +
    'path; any unknown path runs every project, and every omitted measurement is written NOT RUN ' +
    '(out of reach), never GREEN.'
  const topology = 'a'.repeat(64)
  const provedDeclaration = `# project-reachability v1 topology=${topology}${rule}`
  const unprovedDeclaration = `# project-reachability v1 topology=unproved${rule}`

  const tree = ({ declaration = provedDeclaration, route = 'runtime,scripts' } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-reachability-'))
    const table = join(root, 'scripts/mutations/999')
    const lib = join(root, 'scripts/mutations/lib')
    const bin = join(root, 'bin')
    const work = join(root, 'work')
    const pristine = join(root, 'outside-pristine')
    mkdirSync(table, { recursive: true })
    mkdirSync(lib, { recursive: true })
    mkdirSync(bin)
    mkdirSync(pristine)
    writeFileSync(join(root, 'declaration'), declaration)
    writeFileSync(join(root, 'route'), route)
    writeFileSync(
      join(root, 'scripts/mutations/census.py'),
      `import json, pathlib, sys\n` +
        `root = pathlib.Path(__file__).parents[2]\n` +
        `if len(sys.argv) >= 2 and sys.argv[1] == "--begin-active-mutation":\n` +
        `    epoch = root / "scripts/mutations/.tree-lock/active-mutation.json"\n` +
        `    epoch.write_text(json.dumps({"schema": 1}) + "\\n")\n`,
    )
    writeFileSync(
      join(lib, 'reachability.py'),
      `import json, pathlib, sys\n` +
        `root = pathlib.Path(__file__).parents[3]\n` +
        `command = sys.argv[1] if len(sys.argv) > 1 else ""\n` +
        `if command == "declaration":\n` +
        `    value = (root / "declaration").read_text().strip()\n` +
        `    if value == "FAIL": raise SystemExit(17)\n` +
        `    print(value)\n` +
        `elif command == "fingerprint":\n` +
        `    value = (root / "declaration").read_text().strip()\n` +
        `    print(value.split("topology=", 1)[1].split(" ", 1)[0])\n` +
        `elif command == "active-route":\n` +
        `    with (root / "route.calls").open("a") as calls:\n` +
        `        calls.write(json.dumps(sys.argv[2:]) + "\\n")\n` +
        `    value = (root / "route").read_text().strip()\n` +
        `    if value == "FAIL": raise SystemExit(19)\n` +
        `    print(value)\n` +
        `else:\n` +
        `    raise SystemExit(2)\n`,
    )
    writeFileSync(
      join(bin, 'npx'),
      `#!/usr/bin/env bash\n` +
        `project=''\n` +
        `report=''\n` +
        `for arg in "$@"; do\n` +
        `  case "$arg" in\n` +
        `    --project=*) project="\${arg#--project=}" ;;\n` +
        `    --outputFile.json=*) report="\${arg#--outputFile.json=}" ;;\n` +
        `  esac\n` +
        `done\n` +
        `printf '%s\\n' "$project" >>${JSON.stringify(join(root, 'npx.calls'))}\n` +
        `printf '%s\\n' '{"testResults":[{}],"numTotalTests":1,"numFailedTests":0}' >"$report"\n`,
      { mode: 0o755 },
    )
    return {
      root,
      table,
      work,
      pristine,
      log: join(table, 'mutations.txt'),
      vitestBin: join(bin, 'npx'),
      calls: join(root, 'npx.calls'),
      routeCalls: join(root, 'route.calls'),
    }
  }

  const run = (fixture, body) => {
    const script = [
      `. ${JSON.stringify(HARNESS)}`,
      `MUTATION_VITEST_BIN=${JSON.stringify(fixture.vitestBin)}`,
      `ROOT=${JSON.stringify(fixture.root)}`,
      `HERE=${JSON.stringify(fixture.table)}`,
      `TABLE_ID=999`,
      `WORK=${JSON.stringify(fixture.work)}`,
      `PRISTINE=${JSON.stringify(fixture.pristine)}`,
      `LOG=${JSON.stringify(fixture.log)}`,
      `acquire_tree_lock`,
      `begin_mutation_log "$LOG" 0 || exit 7`,
      ...body,
    ].join('\n')
    return spawnSync(SYSTEM_BASH, ['-uo', 'pipefail', '-c', script], {
      encoding: 'utf8',
      env: process.env,
    })
  }

  it('routes only an active row, records exact omissions, and always runs baselines/unknowns', () => {
    const fixture = tree()
    try {
      const result = run(fixture, [
        `printf 'marker='; print_mutation_reachability_declaration`,
        `begin_active_mutation 7 || exit 8`,
        `printf 'active-route=%s\\n' "$MUTATION_ACTIVE_PROJECT_ROUTE"`,
        `printf 'runtime='; run_suite runtime -; printf '\\n'`,
        `printf 'dom='; run_suite dom -; printf '\\n'`,
        `printf 'shared='; run_suite shared -; printf '\\n'`,
        `printf 'legacy='; run_suite 'dom:' -; printf '\\n'`,
        `suite_count dom >/dev/null`,
        `end_active_mutation || exit 8`,
        `printf 'after-end-route=<%s>\\n' "$MUTATION_ACTIVE_PROJECT_ROUTE"`,
        `printf 'after-end-dom='; run_suite dom -; printf '\\n'`,
        `begin_active_mutation 8 || exit 8`,
        `begin_mutation_control M0`,
        `printf 'control-route=<%s>\\n' "$MUTATION_ACTIVE_PROJECT_ROUTE"`,
        `printf 'control-dom='; run_suite dom -; printf '\\n'`,
        `end_active_mutation || exit 8`,
        `release_tree_lock`,
      ])

      expect(`${result.stderr ?? ''}`, `${result.stdout ?? ''}`).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`marker=${provedDeclaration}\n`)
      expect(result.stdout).toContain('active-route=runtime,scripts\n')
      expect(result.stdout).toContain('runtime=GREEN 0 of 1 in 1 files\n')
      expect(result.stdout).toContain('dom=NOT RUN (out of reach)\n')
      expect(result.stdout).toContain('shared=GREEN 0 of 1 in 1 files\n')
      expect(result.stdout).toContain('legacy=GREEN 0 of 1 in 1 files\n')
      expect(result.stdout).toContain('after-end-route=<>\n')
      expect(result.stdout).toContain('after-end-dom=GREEN 0 of 1 in 1 files\n')
      expect(result.stdout).toContain('control-route=<>\n')
      expect(result.stdout).toContain('control-dom=GREEN 0 of 1 in 1 files\n')
      // Active `dom` was omitted, but its baseline and both non-active controls still invoked npx.
      expect(readFileSync(fixture.calls, 'utf8').trim().split('\n')).toEqual([
        'runtime',
        'shared',
        'dom:',
        'dom',
        'dom',
        'dom',
      ])
      const expectedRouteArgs = [
        fixture.root,
        join(fixture.root, 'scripts/mutations/.tree-lock/active-mutation.json'),
        topology,
      ]
      expect(
        readFileSync(fixture.routeCalls, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ).toEqual([expectedRouteArgs, expectedRouteArgs])
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('fails closed to ALL for missing proof, unproved topology, and malformed/helper routes', () => {
    const samples = [
      {
        name: 'declaration helper failure',
        declaration: 'FAIL',
        route: 'NONE',
        routeCalled: false,
      },
      {
        name: 'unproved topology',
        declaration: unprovedDeclaration,
        route: 'NONE',
        routeCalled: false,
      },
      {
        name: 'route helper failure',
        declaration: provedDeclaration,
        route: 'FAIL',
        routeCalled: true,
      },
      {
        name: 'unknown route token',
        declaration: provedDeclaration,
        route: 'runtime,shared',
        routeCalled: true,
      },
    ]

    for (const sample of samples) {
      const fixture = tree(sample)
      try {
        const result = run(fixture, [
          `printf 'marker='; print_mutation_reachability_declaration`,
          `begin_active_mutation 0 || exit 8`,
          `printf 'route=%s\\n' "$MUTATION_ACTIVE_PROJECT_ROUTE"`,
          `printf 'dom='; run_suite dom -; printf '\\n'`,
          `end_active_mutation || exit 8`,
          `release_tree_lock`,
        ])
        expect(result.status, sample.name).toBe(0)
        expect(result.stdout, sample.name).toContain('route=ALL\n')
        expect(result.stdout, sample.name).toContain('dom=GREEN 0 of 1 in 1 files\n')
        expect(result.stdout, sample.name).not.toContain('dom=NOT RUN (out of reach)')
        expect(readFileSync(fixture.calls, 'utf8').trim(), sample.name).toBe('dom')
        expect(existsSync(fixture.routeCalls), sample.name).toBe(sample.routeCalled)
        if (sample.declaration === 'FAIL') {
          expect(result.stdout, sample.name).toContain(`marker=${unprovedDeclaration}\n`)
        }
      } finally {
        rmSync(fixture.root, { recursive: true, force: true })
      }
    }
  })

  it('voids an omitted row when the topology changes before its restored epoch closes', () => {
    const fixture = tree({ route: 'desktop' })
    const changedDeclaration = `# project-reachability v1 topology=${'b'.repeat(64)}${rule}`
    try {
      const result = run(fixture, [
        `begin_active_mutation 0 || exit 8`,
        `printf 'runtime='; run_suite runtime -; printf '\n'`,
        `printf '%s\n' ${JSON.stringify(changedDeclaration)} >${JSON.stringify(
          join(fixture.root, 'declaration'),
        )}`,
        `end_active_mutation || exit 23`,
      ])

      expect(result.status).toBe(23)
      expect(result.stdout).toContain('runtime=NOT RUN (out of reach)')
      expect(result.stderr).toContain(
        'mutation topology changed before restore completed; omitted verdicts are void',
      )
      expect(
        existsSync(join(fixture.root, 'scripts/mutations/.tree-lock/active-mutation.json')),
      ).toBe(true)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

/**
 * ⛔ **A runner cannot inventory the file it is still writing** (290, from 285).
 *
 * Every table used to open its canonical `mutations.txt` through `tee` before collecting its
 * pristine baselines. The scripts project checks the mutation census, so merely starting an unrun
 * table changed its census state and made that supposedly pristine baseline red. These cases drive
 * the shared begin/M-END/publish protocol through a table-shaped Bash pipeline. They also keep an
 * older complete artefact in the fixture: failure safety is replacement safety, not just absence.
 */
describeOnPosix('atomic mutation-log publication (290, from 285)', () => {
  const tree = () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-mutation-log-'))
    const table = join(root, 'scripts/mutations/999')
    mkdirSync(table, { recursive: true })
    writeFileSync(
      join(root, 'scripts/mutations/census.py'),
      `import pathlib, sys\n` +
        `root = pathlib.Path(__file__).parents[2]\n` +
        `canonical = pathlib.Path(__file__).parent / "999/mutations.txt"\n` +
        `mode = "check" if "--check" in sys.argv else "write"\n` +
        `with (root / "census.calls").open("a") as calls:\n` +
        `    calls.write(f"{mode}:{'canonical' if canonical.is_file() else 'absent'}\\n")\n` +
        `if (root / "census.fail").exists():\n` +
        `    raise SystemExit(12)\n`,
    )
    return {
      root,
      table,
      log: join(table, 'mutations.txt'),
      partial: join(table, 'mutations.txt.partial'),
      censusCalls: join(root, 'census.calls'),
    }
  }

  const healthyMend = [
    `control_dir="$(mutation_baseline_dir)"`,
    `mkdir -p "$control_dir"`,
    `printf '0\n' >"$control_dir/unit.status"`,
    `printf 'unit\n' >"$control_dir/unit.label"`,
    `printf 'GREEN\n' >"$control_dir/unit.last"`,
    `printf 'M-END\n' >"$control_dir/.control"`,
    `require_healthy_control M-END || exit 6`,
  ]

  const attempt = ({ root, log, body, argumentCount = 0, beforePipeline = [] }) => {
    const script = [
      `. ${JSON.stringify(HARNESS)}`,
      `ROOT=${JSON.stringify(root)}`,
      `TABLE_ID=999`,
      `WORK=${JSON.stringify(join(root, 'work'))}`,
      `LOG=${JSON.stringify(log)}`,
      `mkdir -p "$WORK"`,
      `acquire_tree_lock`,
      `begin_mutation_log "$LOG" ${argumentCount} || exit 7`,
      ...beforePipeline,
      `{`,
      ...body.map((line) => `  ${line}`),
      `} 2>&1 | tee "$MUTATION_LOG_PARTIAL"`,
      // ⛔ This assignment must be the first command after the pipeline. Any command before it
      // replaces Bash's two component statuses with its own status.
      `log_pipeline_status=("\${PIPESTATUS[@]}")`,
      `publish_mutation_log "\${log_pipeline_status[0]}" "\${log_pipeline_status[1]}"`,
      `result=$?`,
      `release_tree_lock`,
      `exit "$result"`,
    ].join('\n')
    const result = spawnSync(SYSTEM_BASH, ['-uo', 'pipefail', '-c', script], {
      encoding: 'utf8',
    })
    return {
      stdout: `${result.stdout ?? ''}`,
      stderr: `${result.stderr ?? ''}`,
      status: result.status,
    }
  }

  it('publishes only after healthy M-END and archives, rather than truncates, an old partial', () => {
    const fixture = tree()
    const firstArchive = `${fixture.partial}.interrupted`
    const secondArchive = `${fixture.partial}.interrupted.1`
    try {
      writeFileSync(fixture.log, 'old complete\n')
      writeFileSync(fixture.partial, 'newer interrupted attempt\n')
      writeFileSync(firstArchive, 'older interrupted attempt\n')

      const result = attempt({
        ...fixture,
        body: [
          `printf 'new whole run\n'`,
          // `tee` has opened the fixed live path, while readers of the canonical path still see the
          // old complete evidence until the entire pipeline has drained.
          `[[ "$(<"$LOG")" == 'old complete' ]] || exit 41`,
          `printf 'M-END control\n'`,
          ...healthyMend,
        ],
      })

      expect(result).toMatchObject({ status: 0 })
      expect(readFileSync(fixture.log, 'utf8')).toBe('new whole run\nM-END control\n')
      expect(existsSync(fixture.partial)).toBe(false)
      expect(readFileSync(firstArchive, 'utf8')).toBe('older interrupted attempt\n')
      expect(readFileSync(secondArchive, 'utf8')).toBe('newer interrupted attempt\n')
      expect(readFileSync(fixture.censusCalls, 'utf8')).toBe('write:canonical\ncheck:canonical\n')
      expect(result.stderr).toContain(`preserved interrupted mutation log at ${secondArchive}`)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('keeps failure and a printed-but-unproved M-END readable without replacing canonical evidence', () => {
    const cases = [
      {
        name: 'producer failure',
        body: [`printf 'stopped before M-END\n'`, `exit 5`],
        status: 5,
        contains: 'stopped before M-END',
      },
      {
        name: 'producer terminated by a signal',
        // `exec` makes the POSIX shell become the pipeline producer, so the observed 143 is a real
        // signal status without relying on a process-id variable introduced after Bash 3.2.
        body: [`printf 'interrupted before M-END\n'`, `exec sh -c 'kill -TERM "$$"'`],
        status: 143,
        contains: 'interrupted before M-END',
      },
      {
        name: 'M-END prose without its healthy control',
        body: [`printf 'M-END control\n'`],
        status: 7,
        contains: 'M-END control',
      },
    ]

    for (const sample of cases) {
      const fixture = tree()
      try {
        writeFileSync(fixture.log, 'old complete\n')
        const result = attempt({ ...fixture, body: sample.body })
        expect(result.status, sample.name).toBe(sample.status)
        expect(readFileSync(fixture.log, 'utf8'), sample.name).toBe('old complete\n')
        expect(readFileSync(fixture.partial, 'utf8'), sample.name).toContain(sample.contains)
        expect(existsSync(fixture.censusCalls), sample.name).toBe(false)
      } finally {
        rmSync(fixture.root, { recursive: true, force: true })
      }
    }
  })

  it('keeps a successful selected-index run diagnostic and leaves the full artefact untouched', () => {
    const fixture = tree()
    try {
      writeFileSync(fixture.log, 'old complete\n')
      const result = attempt({
        ...fixture,
        argumentCount: 1,
        body: [`printf 'one selected row\n'`, `printf 'M-END control\n'`, ...healthyMend],
      })

      expect(result.status).toBe(0)
      expect(readFileSync(fixture.log, 'utf8')).toBe('old complete\n')
      expect(readFileSync(fixture.partial, 'utf8')).toBe('one selected row\nM-END control\n')
      expect(existsSync(fixture.censusCalls)).toBe(false)
      expect(result.stderr).toContain('selected-index mutation run is diagnostic')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('preserves both pipeline statuses and refuses publication when tee fails after writing', () => {
    const fixture = tree()
    try {
      writeFileSync(fixture.log, 'old complete\n')
      const result = attempt({
        ...fixture,
        // A shell function keeps the real streaming write and then returns the independent writer
        // failure. The runner still has a two-component pipeline and must retain both statuses.
        beforePipeline: [`tee() { command tee "$@"; return 9; }`],
        body: [
          `printf 'complete bytes, failed writer\n'`,
          `printf 'M-END control\n'`,
          ...healthyMend,
        ],
      })

      expect(result.status).toBe(9)
      expect(readFileSync(fixture.log, 'utf8')).toBe('old complete\n')
      expect(readFileSync(fixture.partial, 'utf8')).toBe(
        'complete bytes, failed writer\nM-END control\n',
      )
      expect(existsSync(fixture.censusCalls)).toBe(false)
      expect(result.stderr).toContain('producer 0, tee 9')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('keeps completed canonical evidence when post-publish census reconciliation fails', () => {
    const fixture = tree()
    try {
      writeFileSync(fixture.log, 'old complete\n')
      const result = attempt({
        ...fixture,
        beforePipeline: [`touch ${JSON.stringify(join(fixture.root, 'census.fail'))}`],
        body: [`printf 'new complete evidence\n'`, `printf 'M-END control\n'`, ...healthyMend],
      })

      expect(result.status).toBe(7)
      expect(readFileSync(fixture.log, 'utf8')).toBe('new complete evidence\nM-END control\n')
      expect(existsSync(fixture.partial)).toBe(false)
      expect(readFileSync(fixture.censusCalls, 'utf8')).toBe('write:canonical\n')
      expect(result.stderr).toContain('log published, but mutation census regeneration failed')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('⛔ every legacy runner or shared driver owns the full contract; new runners are shims', () => {
    const root = join(REPO, 'scripts/mutations')
    const runners = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'mutate.sh')))
      .map((entry) => join(root, entry.name, 'mutate.sh'))
    const assertExpandedContract = (source, label, pinnedDefinition = false) => {
      expect(source, label).not.toContain('} 2>&1 | tee "$LOG"')
      expect(source.match(/begin_mutation_log "\$LOG" "\$#" \|\| exit 7/g), label).toHaveLength(1)
      expect(source.match(/^ {2}print_mutation_reachability_declaration$/gm), label).toHaveLength(1)
      expect(source, label).toMatch(
        / {2}echo "# \$\(date -u \+%FT%TZ\)"\n {2}print_mutation_reachability_declaration\n {2}echo\n/,
      )
      expect(source.match(/begin_active_mutation "\$i" \|\| exit 8/g), label).toHaveLength(1)
      expect(source.match(/end_active_mutation \|\| exit 8/g), label).toHaveLength(1)
      if (pinnedDefinition) {
        expect(source, label).toContain(
          '} 2>&1 | tee "$MUTATION_LOG_PARTIAL"\n' +
            'MUTATION_LOG_PIPESTATUS=("${PIPESTATUS[@]}")\n' +
            'verify_pinned_definition || exit 2\n' +
            'publish_mutation_log "${MUTATION_LOG_PIPESTATUS[0]}" "${MUTATION_LOG_PIPESTATUS[1]}"',
        )
      } else {
        expect(source, label).toContain(
          '} 2>&1 | tee "$MUTATION_LOG_PARTIAL"\n' +
            'MUTATION_LOG_PIPESTATUS=("${PIPESTATUS[@]}")\n' +
            'publish_mutation_log "${MUTATION_LOG_PIPESTATUS[0]}" "${MUTATION_LOG_PIPESTATUS[1]}"',
        )
      }
    }

    expect(runners.length).toBeGreaterThan(0)
    let shimCount = 0
    for (const runner of runners) {
      const source = readFileSync(runner, 'utf8')
      if (source.includes('# mutation-runner-shim v1')) {
        shimCount += 1
        expect(source, runner).toMatch(
          /set -uo pipefail\nMUTATION_TABLE_DIR=.*\nexec "\$MUTATION_TABLE_DIR\/\.\.\/lib\/run-table\.sh" "\$MUTATION_TABLE_DIR" "\$@"\n$/,
        )
        expect(source, runner).not.toContain('begin_mutation_log')
        continue
      }
      assertExpandedContract(source, runner)
    }
    expect(shimCount).toBeGreaterThan(0)

    const driver = readFileSync(RUNNER_DRIVER, 'utf8')
    assertExpandedContract(driver, RUNNER_DRIVER, true)
    expect(driver).toContain("printf 'runtime %s · desktop %s · dom %s · scripts %s · shared %s'")
    expect(driver).toContain(
      'echo "M0  CONTROL (no mutation) — baseline runtime=$BASE_RUNTIME desktop=$BASE_DESKTOP dom=$BASE_DOM scripts=$BASE_SCRIPTS shared=$BASE_SHARED"',
    )
  })
})

/**
 * ⛔ **One lock for one tree** (196 H2, from 193).
 *
 * `187` and `188` were the only two tables that locked at all, and each lock lived inside its own
 * table directory — so they acquired DIFFERENT locks while editing the SAME working tree. `193`
 * measured 200 of 496 table pairs sharing at least one file. The lock is now one path under
 * `scripts/mutations/`, and the test that matters is the second acquisition failing.
 */
describeOnPosix('the mutation tree lock (196 H2)', () => {
  const lockDir = (root) => join(root, 'scripts/mutations/.tree-lock')

  // ⚠️ `table` is the point: two DIFFERENT tables, one tree. A per-table lock lets both through,
  // which is exactly what 187 and 188 did, so a test that acquired twice from the same table would
  // pass over the defect it exists for.
  const acquire = (root, table = '196', extra = '') =>
    execFileSync(
      SYSTEM_BASH,
      [
        '-uo',
        'pipefail',
        '-c',
        `. "${HARNESS}"; ROOT="${root}"; HERE="${root}/scripts/mutations/${table}"; ` +
          `acquire_tree_lock; echo ACQUIRED; ${extra}`,
      ],
      { encoding: 'utf8' },
    )

  /** A tree shaped like this repo's, so the lock lands where it really would. */
  const tree = () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-lock-'))
    mkdirSync(join(root, 'scripts/mutations/196'), { recursive: true })
    return root
  }

  it('⛔ a second table cannot take the lock while a first one holds it', () => {
    const root = tree()
    try {
      expect(acquire(root)).toContain('ACQUIRED')
      // The lock outlives the shell that took it — it is a directory, and only `release_tree_lock`
      // removes it. A second TABLE (not a second run of the same one) is refused all the same.
      let refused
      try {
        acquire(root, '187')
        refused = null
      } catch (error) {
        refused = `${error.stdout ?? ''}${error.stderr ?? ''}`
      }
      expect(refused, 'the second acquisition was allowed — two harnesses, one tree').not.toBeNull()
      expect(refused).toContain('another mutation run owns this TREE')
      // ⚑ Reported with its OWNER, never stolen: an automatic steal puts two harnesses back in one
      // tree, which is the defect the lock exists for.
      expect(refused).toMatch(/owner: pid \d+ · 196/)
      // ⛔ **And the one instruction it prints has to RUN** (235, from 206 H2). It said
      // `mutations.py . --dry-run` for four dispatches; `main()` reads the flag from `argv[0]`, so
      // that form falls through to `int("--dry-run")` and hands a Python traceback to somebody who
      // has just interrupted a run. The order is the whole of the fix, so the order is the
      // assertion.
      expect(refused).toContain('scripts/mutations/lib/table_contract.py')
      expect(refused).toContain('mutations.py" --dry-run "')
      expect(refused).toContain('mutations.py --dry-run .')
      expect(refused, 'the reversed form is the defect').not.toContain('mutations.py . --dry-run')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('⛔ a table 196 collision prints the positional dry-run form that its runner accepts', () => {
    const root = tree()
    try {
      expect(acquire(root, '187')).toContain('ACQUIRED')
      let refused
      try {
        acquire(root, '196')
        refused = null
      } catch (error) {
        refused = `${error.stdout ?? ''}${error.stderr ?? ''}`
      }

      expect(refused).toContain('Table 196 uses its earliest positional check')
      expect(refused).toContain('mutations.py . --dry-run')
      expect(refused).not.toContain('mutations.py --dry-run .')
      expect(refused).not.toContain('scripts/mutations/lib/table_contract.py')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('⚑ the paired positive — a released lock can be taken again, and release is idempotent', () => {
    const root = tree()
    try {
      acquire(root, '196', 'release_tree_lock; release_tree_lock')
      expect(acquire(root, '187')).toContain('ACQUIRED')
      expect(lockDir(root)).toContain('.tree-lock')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a table that never took the lock does not delete one somebody else owns', () => {
    const root = tree()
    try {
      acquire(root) // held, and deliberately not released
      execFileSync(
        SYSTEM_BASH,
        ['-uo', 'pipefail', '-c', `. "${HARNESS}"; ROOT="${root}"; release_tree_lock`],
        { encoding: 'utf8' },
      )
      // Still held: `release_tree_lock` refuses when this shell never acquired anything.
      let refused = null
      try {
        acquire(root, '187')
      } catch (error) {
        refused = `${error.stdout ?? ''}${error.stderr ?? ''}`
      }
      expect(refused, 'a shell that holds no lock released one that was held').not.toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses to release a lock whose owner record changed after acquisition', () => {
    const root = tree()
    try {
      const result = spawnSync(
        SYSTEM_BASH,
        [
          '-uo',
          'pipefail',
          '-c',
          `. ${JSON.stringify(HARNESS)}; ROOT=${JSON.stringify(root)}; ` +
            `HERE=${JSON.stringify(join(root, 'scripts/mutations/196'))}; TABLE_ID=196; ` +
            `acquire_tree_lock; printf 'replacement owner\n' >"$MUTATION_TREE_LOCK/owner"; ` +
            `release_tree_lock; status=$?; ` +
            `printf 'lock=<%s> token=<%s>\n' "$MUTATION_TREE_LOCK" "$MUTATION_TREE_LOCK_TOKEN"; ` +
            `exit "$status"`,
        ],
        { encoding: 'utf8' },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('refusing to release a mutation TREE lock')
      expect(result.stdout).toContain(`lock=<${lockDir(root)}> token=<`)
      expect(result.stdout).not.toContain('token=<>')
      expect(readFileSync(join(lockDir(root), 'owner'), 'utf8')).toBe('replacement owner\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('⛔ a legacy runner refuses before sourcing an active per-table-lock mutant', () => {
    const root = tree()
    const otherTable = join(root, 'scripts/mutations/187')
    const mutatedHarness = join(root, 'harness-m4.sh')
    mkdirSync(otherTable)
    try {
      acquire(root) // leave the repository-global lock owned by the first table
      const source = readFileSync(HARNESS, 'utf8')
      const poisoned = source.replace(
        '  MUTATION_TREE_LOCK="$ROOT/scripts/mutations/.tree-lock"',
        '  MUTATION_TREE_LOCK="${HERE:-$ROOT}/.lock"',
      )
      expect(poisoned).not.toBe(source)
      writeFileSync(mutatedHarness, poisoned)

      const result = spawnSync(
        SYSTEM_BASH,
        [
          '-uo',
          'pipefail',
          '-c',
          `ROOT=${JSON.stringify(root)}; HERE=${JSON.stringify(otherTable)}; TABLE_ID=187; ` +
            `. ${JSON.stringify(mutatedHarness)}; echo SOURCED; acquire_tree_lock; echo ACQUIRED`,
        ],
        { encoding: 'utf8' },
      )

      expect(result.status).toBe(4)
      expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain(
        'another mutation run owns this TREE',
      )
      expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain(
        'scripts/mutations/lib/table_contract.py',
      )
      expect(result.stdout).not.toContain('SOURCED')
      expect(result.stdout).not.toContain('ACQUIRED')
      expect(existsSync(join(otherTable, '.lock'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * ⛔ **Cleanup runs once per ending, not once per way of ending** (235, from 206 H2 · 231).
 *
 * 56 of the 58 tables carry this line, byte-identical (every one except `214`, converted in 235,
 * and `235` itself):
 *
 *     trap 'restore; rm -rf "$WORK"; release_tree_lock' EXIT PIPE INT TERM HUP
 *
 * ⚠️ **`EXIT` sits in that list beside the signals, and nothing clears it.** A Ctrl-C runs the
 * handler for `INT` — which restores the tree and deletes `$WORK`, where `$PRISTINE` lives — and
 * then the shell exits and the `EXIT` trap runs the same handler again over a pristine copy that is
 * no longer there. ⛔ **The message that gets buried is `RESTORE FAILED`**, the one line in this
 * harness that means every verdict after it is void, at the exact moment somebody has interrupted a
 * run and needs to know whether their working tree is the tree they started with.
 */
describeOnPosix('the cleanup traps (235, from 206 H2)', () => {
  /** A table-shaped script: a lock, a `restore` that leaves a mark, and one ending. */
  const table = (root, ending) =>
    [
      `. "${HARNESS}"`,
      `ROOT="${root}"`,
      `WORK="${root}/work"`,
      `PRISTINE="$WORK/pristine"`,
      `mkdir -p "$PRISTINE"`,
      // Each call appends a line, so "how many times did cleanup run" is a number and not a guess.
      `restore() { echo restored >>"${root}/cleanup.log"; }`,
      `acquire_tree_lock`,
      `install_tree_traps`,
      ending,
    ].join('\n')

  const run = (script) => {
    try {
      const stdout = execFileSync(SYSTEM_BASH, ['-uo', 'pipefail', '-c', script], {
        encoding: 'utf8',
      })
      return { stdout, stderr: '', status: 0 }
    } catch (error) {
      return {
        stdout: `${error.stdout ?? ''}`,
        stderr: `${error.stderr ?? ''}`,
        status: error.status,
      }
    }
  }

  const tree = () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-trap-'))
    mkdirSync(join(root, 'scripts/mutations/235'), { recursive: true })
    return root
  }

  const cleanups = (root) => {
    const log = join(root, 'cleanup.log')
    return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0
  }

  it('⛔ an INTERRUPT cleans up exactly once, and ends the run', () => {
    const root = tree()
    try {
      // ⚠️ `sleep 3`, not `sleep 30`: with the defect put back, `bash` RESUMES here after the `INT`
      // handler returns, and a row in a mutation table should fail in seconds rather than sit.
      const result = run(table(root, 'kill -INT $$\nsleep 3\necho NOT_REACHED'))
      // ⛔ The count is the defect: the old line ran the handler for INT and then again for EXIT.
      expect(
        cleanups(root),
        'cleanup ran more than once — the second one over a deleted tree',
      ).toBe(1)
      // ⚠️ And a signal must END the run. `bash` resumes a script after an `INT` handler returns,
      // which would put the next mutation into a tree that has just been restored under it.
      expect(result.stdout).not.toContain('NOT_REACHED')
      expect(result.status).not.toBe(0)
      // The lock is let go on the way out, or the next table meets a collision that is not real.
      expect(existsSync(join(root, 'scripts/mutations/.tree-lock'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('⚑ the paired positive — an ordinary ending still cleans up, exactly once', () => {
    const root = tree()
    try {
      // ⚠️ Without this the test above passes just as well over a handler that never runs at all.
      const result = run(table(root, 'echo DONE'))
      expect(result.stdout).toContain('DONE')
      expect(cleanups(root)).toBe(1)
      expect(existsSync(join(root, 'scripts/mutations/.tree-lock'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('⛔ a run that dies before `$WORK` exists still LETS GO OF THE LOCK', () => {
    // ⛔ **The lock is repository-global and is never stolen automatically** — a leaked one stops
    // every later mutation run in the repo until a person deletes the directory. So nothing in the
    // handler may abort it, and under the `set -u` every table sets, an unguarded `rm -rf "$WORK"`
    // did exactly that: `WORK: unbound variable`, thrown inside the trap, before
    // `release_tree_lock`. Reproduced against the harness before the guard, and pinned here.
    const root = tree()
    try {
      const script = [
        `. "${HARNESS}"`,
        `ROOT="${root}"`,
        `restore() { echo restored >>"${root}/cleanup.log"; }`,
        `acquire_tree_lock`,
        `install_tree_traps`, // …and $WORK is never set: the run dies first
        `exit 7`,
      ].join('\n')
      const result = run(script)
      expect(result.status).toBe(7)
      expect(result.stderr).not.toContain('unbound variable')
      expect(
        existsSync(join(root, 'scripts/mutations/.tree-lock')),
        'the tree lock leaked — every later mutation run in this repo is now refused',
      ).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('⛔ an empty `ps` identity fails cleanly without an unbound array or leaked lock', () => {
    const root = tree()
    const fakeBin = join(root, 'bin')
    mkdirSync(fakeBin)
    writeFileSync(join(fakeBin, 'ps'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    try {
      const script = [
        `. "${HARNESS}"`,
        `export PATH=${JSON.stringify(fakeBin)}:"$PATH"`,
        `ROOT=${JSON.stringify(root)}`,
        `HERE=${JSON.stringify(join(root, 'scripts/mutations/235'))}`,
        `TABLE_ID=235`,
        `acquire_tree_lock`,
      ].join('\n')
      const result = run(script)

      expect(result.status).toBe(4)
      expect(result.stderr).toContain('could not establish the mutation lock owner')
      expect(result.stderr).not.toContain('unbound variable')
      expect(existsSync(join(root, 'scripts/mutations/.tree-lock'))).toBe(false)
      expect(readFileSync(RUNNER_DRIVER, 'utf8')).toContain(
        'MUTATION_TREE_PROCESS_START="${process_start_parts[*]-}"',
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('a run that dies BEFORE the pristine copy exists restores nothing and says nothing', () => {
    const root = tree()
    try {
      // The traps are installed before the copy is taken — that is the order every table uses — so
      // an early death would otherwise `cp` from a directory that does not exist, one error per
      // file, on top of whatever actually went wrong.
      const script = [
        `. "${HARNESS}"`,
        `ROOT="${root}"`,
        `WORK="${root}/work"`,
        `PRISTINE="$WORK/pristine"`,
        `restore() { cp "$PRISTINE/nope" "${root}/nope"; }`,
        `acquire_tree_lock`,
        `install_tree_traps`,
        `exit 7`,
      ].join('\n')
      const result = run(script)
      expect(result.status).toBe(7)
      expect(result.stderr, 'second-restore noise on stderr').not.toContain('cp:')
      expect(existsSync(join(root, 'scripts/mutations/.tree-lock'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('⛔ persistent restore failure preserves the scratch copy and TREE lock on EXIT and signal', () => {
    for (const [name, ending, expectedStatus] of [
      ['successful producer', 'exit 0', 70],
      ['ordinary exit', 'exit 7', 7],
      ['TERM', 'kill -TERM $$', 130],
    ]) {
      const root = tree()
      const work = join(root, 'work')
      try {
        const script = [
          `set -e`,
          `. "${HARNESS}"`,
          `ROOT=${JSON.stringify(root)}`,
          `HERE=${JSON.stringify(join(root, 'scripts/mutations/235'))}`,
          `TABLE_ID=235`,
          `WORK=${JSON.stringify(work)}`,
          `PRISTINE="$WORK/pristine"`,
          `mkdir -p "$PRISTINE"`,
          `restore() { echo restored >>${JSON.stringify(join(root, 'cleanup.log'))}; return 1; }`,
          `acquire_tree_lock`,
          `install_tree_traps`,
          ending,
        ].join('\n')
        const result = run(script)

        expect(result.status, name).toBe(expectedStatus)
        expect(result.stderr, name).toContain('RESTORE FAILED during cleanup')
        expect(result.stderr, name).toContain(`scratch preserved at ${work}`)
        expect(cleanups(root), name).toBe(1)
        expect(existsSync(work), name).toBe(true)
        expect(existsSync(join(root, 'scripts/mutations/.tree-lock')), name).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })

  it('a successful EXIT retry clears a transient restore poison and releases recovery state', () => {
    const root = tree()
    const work = join(root, 'work')
    const firstFailure = join(root, 'first-restore-failed')
    try {
      const script = [
        `. "${HARNESS}"`,
        `ROOT=${JSON.stringify(root)}`,
        `HERE=${JSON.stringify(join(root, 'scripts/mutations/235'))}`,
        `TABLE_ID=235`,
        `WORK=${JSON.stringify(work)}`,
        `PRISTINE="$WORK/pristine"`,
        `mkdir -p "$PRISTINE"`,
        `restore() {`,
        `  echo restored >>${JSON.stringify(join(root, 'cleanup.log'))}`,
        `  if [[ ! -e ${JSON.stringify(firstFailure)} ]]; then`,
        `    touch ${JSON.stringify(firstFailure)}`,
        `    MUTATION_RESTORE_POISONED=1`,
        `    return 1`,
        `  fi`,
        `  MUTATION_RESTORE_POISONED=0`,
        `  return 0`,
        `}`,
        `acquire_tree_lock`,
        `install_tree_traps`,
        `if ! restore; then exit 3; fi`,
      ].join('\n')
      const result = run(script)

      expect(result.status).toBe(3)
      expect(result.stderr).not.toContain('RESTORE FAILED during cleanup')
      expect(cleanups(root)).toBe(2)
      expect(existsSync(work)).toBe(false)
      expect(existsSync(join(root, 'scripts/mutations/.tree-lock'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
