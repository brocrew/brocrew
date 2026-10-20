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
    childRun(program, args, env, cwd, abort, maximum, phase) {
      launches.push({ program, args, env, cwd, phase, aborted: abort.signal.aborted, maximum })
      return {
        child: { kill() {} },
        exit: Promise.resolve({ code: 0 }),
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
describe.skipIf(process.platform === 'win32')(
  'hosted runner session and best-effort cleanup',
  () => {
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
