import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as processes from '../gates/plugin-packaged/processes.mjs'
import * as diagnostics from '../gates/plugin-packaged/diagnostics.mjs'
import * as contract from '../gates/plugin-packaged/contract.mjs'
import * as matrix from '../gates/plugin-packaged/matrix.mjs'
import * as providerState from '../gates/plugin-packaged/provider-state.mjs'
import * as pageState from '../gates/plugin-packaged/page-state.mjs'
import * as pluginState from '../gates/plugin-packaged/plugin-state.mjs'
import { readOwned } from '../gates/plugin-packaged/journey.mjs'
import {
  runnerAdapter,
  registerChild,
  bestEffortDrain,
} from '../gates/plugin-packaged/runner-processes.mjs'
import { fixtureEnvironment, removeFixture } from '../gates/plugin-packaged/prepare.mjs'
import {
  inventory,
  artifactNames,
  testArguments,
  sourcePaths,
  dependencyPaths,
  resourcePaths,
  reconcileNative,
  safeExecution,
  retainNamed48,
} from '../gates/plugin-packaged/named48.mjs'
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ownerSource = fs.readFileSync(
  path.join(repository, 'scripts/gates/plugin-packaged/owner.mjs'),
  'utf8',
)
const roots = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function scratch() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-runner-gate-')))
  fs.chmodSync(root, 0o700)
  roots.push(root)
  fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n')
  return root
}
// Replace only external IO; exercise the owner's actual orchestration, never a GUI or account.
function ownerFunction(name, io) {
  const begin = ownerSource.indexOf('export async function ' + name + '(')
  const end = ownerSource.indexOf(
    name === 'run' ? 'export async function clean(' : 'async function main()',
    begin,
  )
  return Function(
    ...Object.keys(io),
    'return (' + ownerSource.slice(begin, end).replace('export ', '') + ')',
  )(...Object.values(io))
}
function fixture({ drained = true, failAt, rows = [] } = {}) {
  const root = scratch(),
    control = scratch(),
    launches = [],
    lines = []
  const summary = contract.report()
  for (const key of contract.checks) summary.checks[key] = true
  summary.coverage.agentBrowserActions = true
  summary.coverage.liveTabs = true
  contract.finish(summary)
  for (const folder of [root, control])
    fs.writeFileSync(path.join(folder, 'summary.json'), JSON.stringify(summary), { mode: 0o600 })
  const io = {
    ...processes,
    ...diagnostics,
    ...contract,
    ...matrix,
    ...pageState,
    ...providerState,
    ...pluginState,
    readOwned,
    fs,
    path,
    performance,
    retainNamed48: () => true,
    fixtureEnvironment,
    requireHosted() {},
    readOwner: () => ({ root, node: '/fictional/node' }),
    registerChild: async () => {},
    readSummary: () => JSON.parse(fs.readFileSync(path.join(control, 'summary.json'))),
    safeSummary: (value) => {
      if (!contract.safeReport(value)) throw new Error('Unsafe summary')
    },
    writeSummary: (_, value) => {
      expect(contract.safeReport(value)).toBe(true)
      fs.writeFileSync(path.join(control, 'summary.json'), JSON.stringify(value))
    },
    bestEffortDrain: async (_root, stop) => {
      await stop?.()
      return { drained, boundary: 'hosted-vm-teardown' }
    },
    runnerAdapter: () => ({ list: async () => rows }),
    removeFixture,
    console: { log: (line) => lines.push(line) },
    printFailure: (value) => lines.push(JSON.stringify(value)),
    childRun(program, args, env, cwd, abort, maximum, phase, echo) {
      launches.push({
        program,
        args,
        env,
        cwd,
        phase,
        echo,
        aborted: abort.signal.aborted,
        maximum,
      })
      return {
        child: { kill() {} },
        exit: Promise.resolve({ code: 0 }),
        result: { code: 0, signal: null },
        pipesClosed: true,
        stopped: false,
        async wait() {
          if (phase === failAt) throw diagnostics.failureError(phase, { code: 7 })
          if (phase === 'probe-matrix') {
            const probeMatrix = Object.fromEntries(
              matrix.variants.map((variant) => [
                variant,
                {
                  variant,
                  ...(['V0', 'V1'].includes(variant) ? { started: true } : {}),
                  drew: variant === 'V2F',
                  devtools: variant === 'V2F',
                  exit: null,
                  stderrCategory: 'other',
                },
              ]),
            )
            fs.writeFileSync(
              path.join(root, 'probe-matrix.json'),
              JSON.stringify({
                probeMatrix,
                matrixDrains: Object.fromEntries(matrix.variants.map((v) => [v, true])),
                launchSelection: matrix.firstDrawing(probeMatrix),
              }),
            )
          }
        },
      }
    },
  }
  return {
    root,
    control,
    launches,
    lines,
    io,
    summary: () => JSON.parse(fs.readFileSync(path.join(control, 'summary.json'))),
  }
}
function fictionalNative(repo) {
  return {
    success: true,
    numTotalTests: 48,
    numPassedTests: 48,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    testResults: inventory.files.map((file) => ({
      name: path.join(repo, file.path),
      status: 'passed',
      message: '',
      assertionResults: file.assertions.map((row) => ({
        ...row,
        status: 'passed',
        failureMessages: [],
        meta: {},
        tags: [],
      })),
    })),
  }
}
function fictionalReceipt() {
  const root = scratch(),
    control = scratch(),
    repo = path.join(root, 'repo')
  fs.mkdirSync(repo)
  const sources = sourcePaths.map((name) => {
    const bytes = fs.readFileSync(path.join(repository, name))
    fs.mkdirSync(path.dirname(path.join(repo, name)), { recursive: true })
    fs.writeFileSync(path.join(repo, name), bytes)
    return { path: name, sha256: contract.digest(bytes) }
  })
  const value = {
    format: 1,
    source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), trackedClean: true, files: sources },
    runtime: {
      executable: resourcePaths[0],
      sha256: 'c'.repeat(64),
      platform: 'darwin',
      arch: 'arm64',
      version: 'v24.22.0',
      execPathSha256: 'd'.repeat(64),
    },
    command: {
      cwd: 'fixture/repo',
      entry: 'scripts/gates/plugin-packaged/named48.mjs',
      args: testArguments('<fixture-root>'),
      actualArgvSha256: 'e'.repeat(64),
      cliArgvSha256: 'e'.repeat(64),
    },
    dependencies: dependencyPaths.map((name) => ({
      path: name,
      sha256: 'f'.repeat(64),
      version: '1.2.3',
    })),
    resources: resourcePaths.map((name) => ({ path: name, sha256: '0'.repeat(64) })),
    exit: { code: 0, signal: null },
  }
  const native = fictionalNative(repo)
  const save = () => {
    fs.writeFileSync(path.join(root, 'named48-native.json'), JSON.stringify(native), {
      mode: 0o600,
    })
    fs.writeFileSync(path.join(root, 'named48-process.json'), JSON.stringify(value), {
      mode: 0o600,
    })
  }
  save()
  return { root, control, repo, value, native, save }
}
// Synthetic native inputs are reporting oracles only, never packaged/runtime acceptance evidence.
describe.skipIf(process.platform === 'win32')('named48 reporting oracles', () => {
  it('selects exactly the unchanged three whole files with the original scripts project and no guard flags', () => {
    expect(inventory.files.map((file) => file.assertions.length)).toEqual([13, 8, 27])
    expect(
      new Set(
        inventory.files.flatMap((file) => file.assertions.map((row) => file.path + row.fullName)),
      ).size,
    ).toBe(48)
    expect(testArguments('/fictional-root')).toEqual([
      'node_modules/vitest/vitest.mjs',
      'run',
      '--project',
      'scripts',
      ...inventory.files.map((file) => file.path),
      '--reporter=json',
      '--outputFile=/fictional-root/named48-native.json',
    ])
    for (const file of inventory.files)
      expect(contract.digest(fs.readFileSync(path.join(repository, file.path)))).toBe(file.sha256)
  })
  it('projects actual known identities and statuses and excludes private native detail', () => {
    const repo = '/fictional-repo',
      native = fictionalNative(repo)
    native.stdout = 'PRIVATE-OUTPUT'
    native.testResults[0].private = 'PRIVATE-FILE'
    native.testResults[0].assertionResults[0].meta = { private: 'PRIVATE-META' }
    const projection = reconcileNative(native, repo)
    expect(projection.complete).toBe(true)
    expect(projection.counts).toMatchObject({ expected: 48, observed: 48, passed: 48 })
    expect(JSON.stringify(projection)).not.toMatch(
      /PRIVATE-|fictional-repo|failureMessages|meta|stdout/,
    )
    expect(projection.testResults[0].assertionResults[0]).toEqual({
      ...inventory.files[0].assertions[0],
      status: 'passed',
    })
  })
  it.each(['failed', 'skipped', 'pending', 'todo', 'disabled'])(
    'retains actual %s status even if aggregate/file success fields claim passed',
    (status) => {
      const native = fictionalNative('/fictional-repo')
      native.testResults[0].assertionResults[0].status = status
      const projection = reconcileNative(native, '/fictional-repo')
      expect(projection.complete).toBe(false)
      expect(projection.testResults[0].assertionResults[0].status).toBe(status)
      expect(projection.counts[status]).toBe(1)
    },
  )
  it.each([
    'missing',
    'extra',
    'duplicate',
    'file-extra',
    'file-duplicate',
    'load',
    'runtime',
    'unsafe-status',
    'unsafe-file-status',
    'unsafe-title',
    'unsafe-ancestor',
    'failure-text',
    'aggregate',
  ])('rejects full native %s input before removing unsafe detail', (kind) => {
    const native = fictionalNative('/fictional-repo'),
      file = native.testResults[0]
    if (kind === 'missing') file.assertionResults.pop()
    if (kind === 'extra')
      file.assertionResults.push({ ...file.assertionResults[0], fullName: 'PRIVATE-EXTRA' })
    if (kind === 'duplicate') file.assertionResults.push(file.assertionResults[0])
    if (kind === 'file-extra') native.testResults.push({ ...file, name: '/PRIVATE-PATH' })
    if (kind === 'file-duplicate') native.testResults.push(file)
    if (kind === 'load') file.message = 'PRIVATE-LOAD-STACK'
    if (kind === 'runtime') native.unhandledErrors = ['PRIVATE-RUNTIME-STACK']
    if (kind === 'unsafe-status') file.assertionResults[0].status = 'PRIVATE-STATUS'
    if (kind === 'unsafe-file-status') file.status = 'PRIVATE-STATUS'
    if (kind === 'unsafe-title') file.assertionResults[0].title = 'PRIVATE-TITLE'
    if (kind === 'unsafe-ancestor') file.assertionResults[0].ancestorTitles = ['PRIVATE-ANCESTOR']
    if (kind === 'failure-text')
      file.assertionResults[0].failureMessages = ['PRIVATE-FAILURE-STACK']
    if (kind === 'aggregate') native.numFailedTestSuites = 1
    const projection = reconcileNative(native, '/fictional-repo')
    expect(projection.complete).toBe(false)
    expect(JSON.stringify(projection)).not.toMatch(/PRIVATE-|fictional-repo/)
  })
  it.each([
    { code: 0, signal: null },
    { code: 9, signal: null },
    { code: null, signal: 'SIGTERM' },
  ])('owner exit %j remains authoritative and exports survive actual fixture removal', (exit) => {
    const f = fictionalReceipt()
    expect(safeExecution(f.value)).toBe(true)
    expect(retainNamed48(f.root, f.control, exit)).toBe(exit.code === 0)
    const before = artifactNames.map((name) => fs.readFileSync(path.join(f.control, name), 'utf8'))
    const [projection, receipt] = before.map((bytes) => JSON.parse(bytes))
    expect(receipt.exit).toEqual(exit)
    expect(receipt.rawNativeSha256).toBe(
      contract.digest(fs.readFileSync(path.join(f.root, 'named48-native.json'))),
    )
    expect(receipt.projectionSha256).toBe(contract.digest(before[0]))
    expect(projection.kind).toBe('sanitized native assertion projection')
    expect(projection.rawNativeNotice).toBe(
      'Provenance digest only. Raw bytes stay private and may be deleted by cleanup; no retained raw audit.',
    )
    expect(before.join('')).not.toContain(f.root)
    removeFixture(f.root, { exited: true, processes: 0 }, [])
    expect(
      artifactNames.map((name) => fs.readFileSync(path.join(f.control, name), 'utf8')),
    ).toEqual(before)
    expect(fs.readdirSync(f.control).sort()).toEqual([...artifactNames, 'fixture-owned'].sort())
  })
  it.each([
    'parse',
    'unsafe-metadata',
    'stale-export',
    'source-changed',
    'native-link',
    'native-public',
  ])('a %s receipt cannot produce successful fresh exports', (kind) => {
    const f = fictionalReceipt()
    if (kind === 'unsafe-metadata') {
      f.value.runtime.version = 'PRIVATE-VERSION'
      f.save()
    }
    if (kind === 'parse')
      fs.writeFileSync(path.join(f.root, 'named48-native.json'), '{PRIVATE-PARSE')
    if (kind === 'stale-export')
      fs.writeFileSync(path.join(f.control, artifactNames[0]), 'PRIVATE-STALE')
    if (kind === 'source-changed')
      fs.appendFileSync(path.join(f.repo, sourcePaths[0]), '\n// changed')
    if (kind === 'native-link') {
      fs.renameSync(path.join(f.root, 'named48-native.json'), path.join(f.root, 'original'))
      fs.symlinkSync(path.join(f.root, 'original'), path.join(f.root, 'named48-native.json'))
    }
    if (kind === 'native-public') fs.chmodSync(path.join(f.root, 'named48-native.json'), 0o644)
    if (kind === 'source-changed')
      expect(retainNamed48(f.root, f.control, { code: 0, signal: null })).toBe(false)
    else expect(() => retainNamed48(f.root, f.control, { code: 0, signal: null })).toThrow()
  })
})

describe.skipIf(process.platform === 'win32')(
  'hosted runner session and best-effort cleanup',
  () => {
    it('cannot make missing ordinary acceptance or stale fact records pass during either cleanup result', async () => {
      for (const drained of [true, false])
        for (const old of [false, true]) {
          const f = fixture({ drained })
          const summary = f.summary()
          summary.checks.alternateSourceAccepted = false
          if (old) {
            delete summary.checks.alternateSourceAccepted
            summary.checks.foreignUrlRefused = true
          }
          summary.passed = true
          fs.writeFileSync(path.join(f.control, 'summary.json'), JSON.stringify(summary))
          const read = f.io.readSummary
          f.io.readSummary = () => {
            const value = read()
            f.io.safeSummary(value)
            return value
          }
          if (old)
            await expect(ownerFunction('clean', f.io)(f.control)).rejects.toThrow('Unsafe summary')
          else {
            await ownerFunction('clean', f.io)(f.control)
            expect(f.summary().passed).toBe(false)
            expect(f.summary().checks.alternateSourceAccepted).toBe(false)
          }
        }
    })
    it('retains the new journey failure through run and always cleanup ahead of a generic command failure', async () => {
      const f = fixture()
      const expected = diagnostics.stepFailure(
        'journey',
        'alternate-source-acceptance',
        {},
        'assertion',
      )
      fs.writeFileSync(
        path.join(f.root, 'command-failure.json'),
        JSON.stringify(diagnostics.failureFor('prepare', {}, 'thrown')),
        { mode: 0o600 },
      )
      const launch = f.io.childRun
      f.io.childRun = (...args) => {
        const task = launch(...args)
        if (args[6] === 'journey')
          task.wait = async () => {
            throw diagnostics.failureError('journey', { failure: expected })
          }
        return task
      }
      expect(
        await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm'),
      ).toBe(false)
      await ownerFunction('clean', f.io)(f.control)
      expect(f.summary().failure).toEqual(expected)
      expect(f.summary().passed).toBe(false)
    })
    it('preserves the journey step and page state through cleanup, ahead of a nested command receipt', async () => {
      const f = fixture()
      const expected = diagnostics.stepFailure('journey', 'restart-profile', {}, 'assertion')
      const state = { readyState: 'complete', routeCategory: 'setup', markers: ['setup-close'] }
      const row = {
        ...pluginState.unknownPluginState(),
        rowPresent: true,
        stateCategory: 'unhealthy',
      }
      fs.writeFileSync(
        path.join(f.root, 'command-failure.json'),
        JSON.stringify(diagnostics.failureFor('app-integrity', {}, 'assertion')),
        { mode: 0o600 },
      )
      const launch = f.io.childRun
      f.io.childRun = (...args) => {
        const task = launch(...args)
        if (args[6] === 'journey') {
          task.pageState = state
          task.pluginState = row
          task.providerState = {
            phase: 'provider-action',
            step: 'mcp-attached',
            errorCategory: 'route-absent',
          }
          task.wait = async () => {
            throw diagnostics.failureError('journey', { failure: expected })
          }
        }
        return task
      }
      expect(
        await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm'),
      ).toBe(false)
      await ownerFunction('clean', f.io)(f.control)
      expect(f.summary().failure).toEqual(expected)
      expect(f.summary().pageState).toEqual(state)
      expect(f.summary().pluginState).toEqual(row)
      expect(f.summary().providerState).toEqual({
        phase: 'provider-action',
        step: 'mcp-attached',
        errorCategory: 'route-absent',
      })
      expect(f.summary().ownership.guiProbePassed).toBe(true)
      expect(JSON.stringify(f.summary()) + f.lines.join('')).not.toMatch(
        /fictional|HOME|argv|TOKEN/,
      )
    })
    it('keeps the GUI step failure and a separate drain step through run and always cleanup', async () => {
      const f = fixture({ failAt: 'gui-probe', drained: false })
      const launch = f.io.childRun
      f.io.childRun = (...args) => {
        const task = launch(...args)
        if (args[6] === 'gui-probe')
          task.pageState = {
            readyState: 'complete',
            routeCategory: 'recovery',
            markers: ['recovery'],
          }
        if (args[6] === 'gui-probe')
          task.wait = async () => {
            throw diagnostics.failureError('gui-probe', {
              failure: diagnostics.stepFailure('gui-probe', 'first-window', {}, 'timeout'),
            })
          }
        return task
      }
      f.io.bestEffortDrain = async (_root, stop, io) => {
        await stop?.()
        io.report(diagnostics.stepFailure('drain', 'admission', {}, 'admission-missing'))
        return { drained: false, boundary: 'hosted-vm-teardown' }
      }
      await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm')
      await ownerFunction('clean', f.io)(f.control)
      expect(f.summary().failure).toMatchObject({
        phase: 'gui-probe',
        step: 'first-window',
        errorClass: 'timeout',
      })
      expect(f.summary().drainFailure).toMatchObject({
        phase: 'drain',
        step: 'admission',
        errorClass: 'admission-missing',
      })
      expect(f.summary().ownership.hostedOnly).toBe(true)
      expect(f.summary().pageState).toMatchObject({
        readyState: 'complete',
        routeCategory: 'recovery',
      })
      expect(f.summary().counts.cleanupFailures).toBe(2)
      expect(JSON.stringify(f.summary())).not.toMatch(/fictional|HOME|path|argv/)
    })
    it.each([true, false])(
      'a drain result of %s never replaces a successful journey',
      async (drained) => {
        const f = fixture({ drained })
        expect(
          await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/tools/pnpm'),
        ).toBe(true)
        expect(f.summary().cleanup).toEqual({ drained, boundary: 'hosted-vm-teardown' })
        expect(f.summary().ownership).toEqual({
          hostedOnly: true,
          runnerSession: true,
          guiProbePassed: true,
        })
        expect(f.launches.map((row) => row.phase)).toEqual([
          'runner-preflight',
          'dependencies',
          'dry-tests',
          'prepare',
          'cdp-fixture-tests',
          'cdp-fixture-tests',
          'probe-matrix',
          'gui-probe',
          'journey',
        ])
        for (const row of f.launches) {
          if (row.phase === 'probe-matrix') {
            expect(row.env).toBe(process.env)
            expect(row.program).toBe('/fictional/node')
            expect(row.maximum).toBe(450000)
            continue
          }
          expect(row.env.HOME).toBe(path.join(f.root, 'home'))
          expect(row.env).not.toHaveProperty('GH_TOKEN')
          expect(row.env).not.toHaveProperty('SSH_AUTH_SOCK')
        }
        await ownerFunction('clean', f.io)(f.control)
        expect(f.summary().passed).toBe(true)
        expect(fs.existsSync(f.root)).toBe(!drained)
      },
    )
    it('shares the original absolute fixture budget, hides only named48 output and retains before cleanup', async () => {
      const f = fixture()
      let elapsed = 0
      f.io.performance = { now: () => elapsed }
      const launch = f.io.childRun
      f.io.childRun = (...args) => {
        const task = launch(...args)
        if (args[1][0] === 'scripts/gates/plugin-packaged/named48.mjs') {
          const wait = task.wait
          task.wait = async () => {
            await wait()
            elapsed += 100000
          }
        }
        return task
      }
      const retained = []
      f.io.retainNamed48 = (root, control, exit) => {
        retained.push({ root, control, exit })
        elapsed += 1000
        return true
      }
      expect(
        await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm'),
      ).toBe(true)
      const commands = f.launches.filter((row) => row.phase === 'cdp-fixture-tests')
      expect(commands.map((row) => row.maximum)).toEqual([420000, 319000])
      expect(commands.map((row) => row.echo)).toEqual([false, true])
      expect(commands[0].args).toEqual(['scripts/gates/plugin-packaged/named48.mjs', f.root])
      expect(commands[1].args).toEqual([
        'node_modules/vitest/vitest.mjs',
        'run',
        '--project',
        'scripts',
        'scripts/test/plugin-packaged-browser.test.mjs',
      ])
      expect(
        commands.every((row) => row.program.endsWith('/Contents/Resources/plugin-node/node')),
      ).toBe(true)
      expect(retained).toEqual([
        { root: f.root, control: f.control, exit: { code: 0, signal: null } },
      ])
      await ownerFunction('clean', f.io)(f.control)
      expect(fs.existsSync(f.root)).toBe(false)
      expect(retained).toHaveLength(1)
    })
    it.each(['nonzero', 'signal', 'receipt', 'budget', 'pipes'])(
      'a named48 %s failure cannot launch browser work or become a pass during cleanup',
      async (kind) => {
        const f = fixture()
        let elapsed = 0,
          retained = 0
        f.io.performance = { now: () => elapsed }
        f.io.retainNamed48 = () => {
          retained++
          return kind !== 'receipt'
        }
        const launch = f.io.childRun
        f.io.childRun = (...args) => {
          const task = launch(...args)
          if (args[1][0] === 'scripts/gates/plugin-packaged/named48.mjs') {
            task.pipesClosed = kind !== 'pipes'
            if (kind === 'nonzero') task.result = { code: 9, signal: null }
            if (kind === 'signal') task.result = { code: null, signal: 'SIGTERM' }
            task.wait = async () => {
              if (kind === 'budget') elapsed = 420000
              if (['nonzero', 'signal'].includes(kind))
                throw diagnostics.failureError('cdp-fixture-tests', task.result)
            }
          }
          return task
        }
        expect(
          await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm'),
        ).toBe(false)
        expect(f.launches.filter((row) => row.phase === 'cdp-fixture-tests')).toHaveLength(1)
        expect(retained).toBe(kind === 'pipes' ? 0 : 1)
        await ownerFunction('clean', f.io)(f.control)
        expect(f.summary().passed).toBe(false)
      },
    )
    it('keeps a failed-drain count when the later always drain succeeds, without changing the journey result', async () => {
      const f = fixture({ drained: false })
      expect(
        await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm'),
      ).toBe(true)
      expect(f.summary().counts.cleanupFailures).toBe(1)
      f.io.bestEffortDrain = async () => ({ drained: true, boundary: 'hosted-vm-teardown' })
      await ownerFunction('clean', f.io)(f.control)
      expect(f.summary().cleanup).toEqual({ drained: true, boundary: 'hosted-vm-teardown' })
      expect(f.summary().counts.cleanupFailures).toBe(1)
      expect(f.summary().passed).toBe(true)
    })
    it.each(['dependencies', 'prepare', 'cdp-fixture-tests', 'gui-probe', 'journey'])(
      'cleanup never turns a %s failure into a pass',
      async (failAt) => {
        const f = fixture({ drained: false, failAt })
        expect(
          await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm'),
        ).toBe(false)
        expect(f.summary().failure).toEqual({
          phase: failAt,
          errorClass: 'child-exit',
          exitCode: 7,
          signal: null,
        })
        await ownerFunction('clean', f.io)(f.control)
        expect(f.summary().passed).toBe(false)
        expect(fs.existsSync(f.root)).toBe(true)
      },
    )
    it('keeps roots if a new observed target remains immediately before removal, without failing a completed journey', async () => {
      const f = fixture({ rows: [{ pid: 41001, birth: 'new' }] })
      await ownerFunction('clean', f.io)(f.control)
      expect(f.summary().passed).toBe(true)
      expect(f.summary().ownership.rootsRemoved).toBe(false)
      expect(f.summary().counts.cleanupFailures).toBe(1)
      expect(fs.existsSync(f.root)).toBe(true)
    })
    it('the only cleanup string is the fixed VM boundary, and neither drained value is a global proof', () => {
      for (const drained of [true, false]) {
        const value = contract.report()
        for (const key of contract.checks) value.checks[key] = true
        value.coverage.agentBrowserActions = true
        value.coverage.liveTabs = true
        value.cleanup = { drained, boundary: 'hosted-vm-teardown' }
        expect(contract.finish(value).passed).toBe(true)
        expect(contract.safeReport(value)).toBe(true)
      }
      for (const cleanup of [
        { drained: true, boundary: '/fictional/HOME' },
        { drained: 'true', boundary: 'hosted-vm-teardown' },
        { drained: true, boundary: 'hosted-vm-teardown', proven: true },
      ])
        expect(contract.safeReport({ cleanup })).toBe(false)
    })
    it('both native observation and its helper refuse local and self-hosted execution before a census', async () => {
      vi.stubEnv('RUNNER_ENVIRONMENT', 'self-hosted')
      const root = scratch()
      expect(() => runnerAdapter(root)).toThrow('Private Mac gate only')
      await expect(registerChild(root, { pid: 41001 })).rejects.toThrow('Private Mac gate only')
      await expect(bestEffortDrain(root)).rejects.toThrow('Private Mac gate only')
      for (const env of [{}, { RUNNER_ENVIRONMENT: 'self-hosted' }]) {
        let error
        try {
          execFileSync(
            '/usr/bin/python3',
            ['-I', '-B', path.join(repository, 'scripts/gates/plugin-packaged/census.py')],
            { env, stdio: ['ignore', 'pipe', 'pipe'] },
          )
        } catch (value) {
          error = value
        }
        expect(error.status).toBe(1)
        expect(error.stdout.length).toBe(0)
        expect(error.stderr.length).toBe(0)
      }
    })
  },
)
const row = (pid, group, birth, executable) => ({ pid, group, birth, executable })
describe.skipIf(process.platform === 'win32')(
  'observed groups and scratch executable cleanup',
  () => {
    it('saves a started group, drains it before root executables, and remembers outside-root members for a fresh adapter', async () => {
      const root = scratch(),
        sent = []
      let rows = [
        row(41001, 41001, 'leader', '/fictional/tool'),
        row(41002, 41001, 'member', '/bin/helper'),
        row(41003, 41003, 'rooted', root + '/node'),
        row(41004, 41004, 'unrelated', '/bin/unrelated'),
      ]
      expect(await registerChild(root, { pid: 41001 }, async () => rows)).toBe(true)
      const io = {
        read: async () => rows,
        send: async (group, signal) => {
          sent.push({ group, signal })
          rows = rows.filter((one) => one.group !== group)
        },
      }
      const groups = runnerAdapter(root, 'groups', io)
      expect((await groups.list()).map((one) => one.pid)).toEqual([41001, 41002])
      rows = rows.filter((one) => one.pid !== 41001)
      expect((await runnerAdapter(root, 'groups', io).list()).map((one) => one.pid)).toEqual([
        41002,
      ])
      const modes = []
      const result = await bestEffortDrain(root, async () => modes.push('leaders'), {
        adapter: (_root, mode) => {
          modes.push(mode)
          return runnerAdapter(root, mode, io)
        },
      })
      expect(result).toEqual({ drained: true, boundary: 'hosted-vm-teardown' })
      expect(modes).toEqual(['leaders', 'groups', 'roots'])
      expect(sent.map((one) => one.group)).toEqual([41001, 41003])
      expect(rows.map((one) => one.pid)).toEqual([41004])
    })
    it('reports an incomplete drain when a known group loses every birth anchor before a new outside-root member is observed', async () => {
      const root = scratch(),
        sent = []
      let rows = [row(41001, 41001, 'leader', '/fictional/tool')]
      await registerChild(root, { pid: 41001 }, async () => rows)
      rows = [row(41002, 41001, 'unseen-orphan', '/bin/helper')]
      const io = { read: async () => rows, send: async (...args) => sent.push(args) }
      const result = await bestEffortDrain(root, async () => {}, {
        adapter: (_root, mode) => runnerAdapter(root, mode, io),
      })
      expect(result).toEqual({ drained: false, boundary: 'hosted-vm-teardown' })
      expect(sent).toEqual([])
    })
    it.each([
      { exitCode: 0, signalCode: null },
      { exitCode: null, signalCode: 'SIGTRAP' },
    ])(
      'an exited launcher with an observed empty group does not poison later drains (%j)',
      async (exit) => {
        const root = scratch()
        expect(await registerChild(root, { pid: 41001, ...exit }, async () => [])).toBe(true)
        expect(fs.existsSync(path.join(root, 'group-observation-incomplete'))).toBe(false)
        expect(
          (await bestEffortDrain(root, undefined, { adapter: () => ({ list: async () => [] }) }))
            .drained,
        ).toBe(true)
      },
    )
    it('retains the admission gap when an exited leader leaves an unanchored member', async () => {
      const root = scratch()
      expect(
        await registerChild(root, { pid: 41001, exitCode: 0, signalCode: null }, async () => [
          row(41002, 41001, 'orphan', '/bin/helper'),
        ]),
      ).toBe(false)
      expect(
        (await bestEffortDrain(root, undefined, { adapter: () => ({ list: async () => [] }) }))
          .drained,
      ).toBe(false)
    })
    it('reports the repeated incomplete admission that otherwise only increments cleanupFailures', async () => {
      const root = scratch(),
        failures = []
      await registerChild(root, { pid: 41001 }, async () => [])
      for (let attempt = 0; attempt < 2; attempt++)
        expect(
          (
            await bestEffortDrain(root, undefined, {
              adapter: () => ({ list: async () => [] }),
              report: (failure) => failures.push(failure),
            })
          ).drained,
        ).toBe(false)
      expect(failures.map((failure) => [failure.step, failure.errorClass])).toEqual([
        ['admission', 'admission-missing'],
        ['admission', 'admission-missing'],
      ])
      expect(JSON.stringify(failures)).not.toMatch(/fictional|HOME|path|pid|41001/)
    })
    it.each(['stop-launchers', 'groups', 'roots'])(
      'names the failing drain sub-step %s without error text',
      async (step) => {
        const root = scratch(),
          failures = []
        const fail = () => {
          throw Object.assign(new Error('/fictional HOME=madeup'), { code: 'EACCES' })
        }
        const cleanup = await bestEffortDrain(root, step === 'stop-launchers' ? fail : undefined, {
          adapter: (_root, mode) => ({
            list: async () => (mode === step ? fail() : []),
            signal: async () => {},
          }),
          report: (failure) => failures.push(failure),
        })
        expect(cleanup.drained).toBe(false)
        expect(failures).toEqual([
          expect.objectContaining({ phase: 'drain', step, errorClass: 'fs-eacces' }),
        ])
        expect(JSON.stringify(failures)).not.toMatch(/fictional|HOME|madeup|path/)
      },
    )
    it('does not signal a recycled PID or an unobserved foreign group', async () => {
      const root = scratch(),
        sent = []
      let rows = [row(41001, 41001, 'old', '/fictional/tool')]
      await registerChild(root, { pid: 41001 }, async () => rows)
      const io = { read: async () => rows, send: async (...args) => sent.push(args) }
      rows = [row(41001, 41001, 'reused', '/bin/unrelated')]
      const adapter = runnerAdapter(root, 'groups', io)
      expect(await adapter.list()).toEqual([])
      await adapter.signal(row(41001, 41001, 'old', '/fictional/tool'), 'SIGKILL')
      expect(sent).toEqual([])
    })
    it('escalates TERM to KILL and awaits disappearance, reporting a stuck target without throwing', async () => {
      const root = scratch(),
        signals = []
      let live = true
      const adapter = {
        list: async () => (live ? [row(41001, 41001, 'rooted', root + '/node')] : []),
        signal: async (_row, signal) => {
          signals.push(signal)
          if (signal === 'SIGKILL') live = false
        },
      }
      expect(
        (await bestEffortDrain(root, async () => {}, { adapter: () => adapter })).drained,
      ).toBe(true)
      expect(signals).toContain('SIGTERM')
      expect(signals).toContain('SIGKILL')
      expect(live).toBe(false)
      const result = await bestEffortDrain(
        root,
        async () => {
          throw new Error('/fictional/HOME')
        },
        {
          adapter: () => ({
            list: async () => {
              throw new Error('fictional error')
            },
            signal() {},
          }),
        },
      )
      expect(result).toEqual({ drained: false, boundary: 'hosted-vm-teardown' })
      expect(JSON.stringify(result)).not.toMatch(/HOME|fictional|error/)
    })
    it('bounds and aborts both observation phases even when a census never replies', async () => {
      vi.useFakeTimers()
      try {
        const root = scratch(),
          signals = []
        const pending = bestEffortDrain(root, async () => {}, {
          adapter: (_root, _mode, options) => {
            signals.push(options.abortSignal)
            return {
              list: () => new Promise(() => {}),
              signal() {
                throw new Error('No signal after timeout')
              },
            }
          },
        })
        await vi.advanceTimersByTimeAsync(8000)
        expect(await pending).toEqual({ drained: false, boundary: 'hosted-vm-teardown' })
        expect(signals).toHaveLength(2)
        expect(signals.every((signal) => signal.aborted)).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })
    it('never follows an incomplete-observation marker link outside its scratch root', async () => {
      const root = scratch(),
        other = scratch(),
        kept = path.join(other, 'kept')
      fs.writeFileSync(kept, 'fictional retained bytes')
      fs.symlinkSync(kept, path.join(root, 'group-observation-incomplete'))
      expect(await registerChild(root, { pid: 41001 }, async () => [])).toBe(false)
      expect(fs.readFileSync(kept, 'utf8')).toBe('fictional retained bytes')
    })
    it('a failed group observation stays explicitly best effort even if later observations are empty', async () => {
      const root = scratch()
      expect(await registerChild(root, { pid: 41001 }, async () => [])).toBe(false)
      expect(
        await bestEffortDrain(root, async () => {}, {
          adapter: () => ({ list: async () => [], signal() {} }),
        }),
      ).toEqual({ drained: false, boundary: 'hosted-vm-teardown' })
    })
  },
)
