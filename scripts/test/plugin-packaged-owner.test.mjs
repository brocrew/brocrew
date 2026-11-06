import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as processes from '../gates/plugin-packaged/processes.mjs'
import * as diagnostics from '../gates/plugin-packaged/diagnostics.mjs'
import * as contract from '../gates/plugin-packaged/contract.mjs'
import * as providerState from '../gates/plugin-packaged/provider-state.mjs'
import * as pageState from '../gates/plugin-packaged/page-state.mjs'
import * as pluginState from '../gates/plugin-packaged/plugin-state.mjs'
import { readOwned } from '../gates/plugin-packaged/journey.mjs'
import { fixtureEnvironment } from '../gates/plugin-packaged/prepare.mjs'
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
function fixture({ drained = true, failAt } = {}) {
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
    ...pageState,
    ...providerState,
    ...pluginState,
    readOwned,
    fs,
    path,
    performance,
    fixtureEnvironment,
    requireHosted() {},
    readOwner: () => ({ root, node: '/fictional/node' }),
    // A child that never exits leaves the stop step failed, the only drain result left.
    ...(drained
      ? {}
      : {
          bounded: async () => {
            throw new Error('Owned process deadline')
          },
        }),
    readSummary: () => JSON.parse(fs.readFileSync(path.join(control, 'summary.json'))),
    safeSummary: (value) => {
      if (!contract.safeReport(value)) throw new Error('Unsafe summary')
    },
    writeSummary: (_, value) => {
      expect(contract.safeReport(value)).toBe(true)
      fs.writeFileSync(path.join(control, 'summary.json'), JSON.stringify(value))
    },
    console: { log: (line) => lines.push(line) },
    printFailure: (value) => lines.push(JSON.stringify(value)),
    childRun(program, args, env, cwd, abort, maximum, phase) {
      launches.push({
        program,
        args,
        env,
        cwd,
        phase,
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
      await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm')
      await ownerFunction('clean', f.io)(f.control)
      expect(f.summary().failure).toMatchObject({
        phase: 'gui-probe',
        step: 'first-window',
        errorClass: 'timeout',
      })
      expect(f.summary().drainFailure).toMatchObject({ phase: 'drain', step: 'stop-launchers' })
      expect(f.summary().ownership.hostedOnly).toBe(true)
      expect(f.summary().pageState).toMatchObject({
        readyState: 'complete',
        routeCategory: 'recovery',
      })
      expect(f.summary().counts.cleanupFailures).toBe(1)
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
          'gui-probe',
          'journey',
        ])
        for (const row of f.launches) {
          expect(row.env.HOME).toBe(path.join(f.root, 'home'))
          expect(row.env).not.toHaveProperty('GH_TOKEN')
          expect(row.env).not.toHaveProperty('SSH_AUTH_SOCK')
        }
        await ownerFunction('clean', f.io)(f.control)
        expect(f.summary().passed).toBe(true)
        // The scratch root is always removed; the hosted VM is the final boundary.
        expect(fs.existsSync(f.root)).toBe(false)
      },
    )
    it('uses ordinary whole-file reporters and the original shared fixture deadline', async () => {
      const f = fixture()
      let elapsed = 0
      f.io.performance = { now: () => elapsed }
      const launch = f.io.childRun
      f.io.childRun = (...args) => {
        const task = launch(...args)
        if (args[1].includes('scripts/test/plugin-packaged-provider.test.mjs')) {
          const wait = task.wait
          task.wait = async () => {
            await wait()
            elapsed += 100000
          }
        }
        return task
      }
      expect(
        await ownerFunction('run', f.io)(f.control, '/fictional/node22', '/fictional/pnpm'),
      ).toBe(true)
      const commands = f.launches.filter((row) => row.phase === 'cdp-fixture-tests')
      expect(commands.map((row) => row.maximum)).toEqual([420000, 320000])
      expect(commands[0].args).toEqual([
        'node_modules/vitest/vitest.mjs',
        'run',
        '--project',
        'scripts',
        'scripts/test/plugin-packaged-gate.test.mjs',
        'scripts/test/plugin-packaged-release.test.mjs',
        'scripts/test/plugin-packaged-provider.test.mjs',
        '--reporter=default',
        '--reporter=json',
        '--outputFile=' + path.join(f.control, 'named48-native.json'),
      ])
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
      await ownerFunction('clean', f.io)(f.control)
      expect(fs.existsSync(f.root)).toBe(false)
    })
    it.each(['nonzero', 'signal', 'budget'])(
      'an ordinary whole48 %s failure cannot launch browser work or become a pass during cleanup',
      async (kind) => {
        const f = fixture()
        const nativeFile = path.join(f.control, 'named48-native.json'),
          raw = '{"success":true,"failureMessages":["fictional actual error stack"]}\n'
        let elapsed = 0
        f.io.performance = { now: () => elapsed }
        const launch = f.io.childRun
        f.io.childRun = (...args) => {
          const task = launch(...args)
          if (args[1].includes('scripts/test/plugin-packaged-provider.test.mjs')) {
            if (kind === 'nonzero') task.result = { code: 9, signal: null }
            if (kind === 'signal') task.result = { code: null, signal: 'SIGTERM' }
            task.wait = async () => {
              fs.writeFileSync(nativeFile, raw)
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
        await ownerFunction('clean', f.io)(f.control)
        expect(f.summary().passed).toBe(false)
        expect(fs.readFileSync(nativeFile, 'utf8')).toBe(raw)
      },
    )
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
        expect(fs.existsSync(f.root)).toBe(false)
      },
    )
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
  },
)
