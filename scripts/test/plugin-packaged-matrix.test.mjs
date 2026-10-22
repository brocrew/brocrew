import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { HIDDEN_LAUNCH_ARG } from '../lib/hidden-launch.mjs'
import {
  launchVariant,
  probeVariants,
  safeVariant,
  safeMatrix,
  firstDrawing,
  safeSelection,
  requireSelection,
  safeMatrixReceipt,
  baselineSurvived,
} from '../gates/plugin-packaged/matrix.mjs'
import { safeReport, requireCI } from '../gates/plugin-packaged/contract.mjs'
import { closedFrames, appStderrClassifier } from '../gates/plugin-packaged/diagnostics.mjs'

const context = {
  root: '/fictional/root',
  executable: '/fictional/app',
  workspace: '/fictional/workspace',
  global: '/fictional/global',
  port: 12345,
  baseline: { HOME: '/fictional/runner', PATH: '/fictional/bin', LANGUAGE: 'madeup' },
  fixture: { HOME: '/fictional/root/home', PATH: '/fictional/root/bin' },
}
const record = (variant, drew = false) => ({
  variant,
  ...(['V0', 'V1'].includes(variant) ? { started: false } : {}),
  drew,
  devtools: drew,
  exit: null,
  stderrCategory: 'other',
})
function fixture(
  measure = async (_run, variant, value) => {
    value.drew = value.devtools = variant === 'V2F'
  },
) {
  const order = [],
    saved = []
  const io = {
    guard() {},
    launch(variant) {
      order.push('launch-' + variant)
      return {
        child: { exitCode: null, signalCode: null },
        exit: new Promise(() => {}),
        stderrClass: () => ({ category: 'other' }),
      }
    },
    measure,
    async drain() {
      order.push('drain')
      return true
    },
    record(records, drains) {
      saved.push(structuredClone({ probeMatrix: records, matrixDrains: drains }))
    },
  }
  return { io, order, saved }
}
describe('hosted-only launch ladder with inert process IO', () => {
  it('refuses the old inherited-env success when the exact fixture recipe does not draw', () => {
    const probeMatrix = Object.fromEntries(
      ['V0', 'V1', 'V2', 'V2F', 'V3', 'V4'].map((v) => [v, record(v, v === 'V2')]),
    )
    const receipt = {
      probeMatrix,
      matrixDrains: Object.fromEntries(Object.keys(probeMatrix).map((v) => [v, true])),
      matrixPageStates: {
        V2F: { readyState: 'complete', routeCategory: 'recovery', markers: ['recovery'] },
      },
    }
    expect(safeMatrixReceipt(receipt)).toBe(true)
    expect(() => firstDrawing(probeMatrix)).toThrow('No drawing launch variant')
    expect(() => requireSelection(receipt)).toThrow('Missing measured launch selection')
  })
  it('reports baseline startup only after twenty seconds alive; an early exit or cancellation cannot pass', async () => {
    vi.useFakeTimers()
    try {
      const child = { exitCode: null, signalCode: null }
      const abort = new AbortController()
      let exited
      const exit = new Promise((resolve) => {
        exited = resolve
      })
      const survived = baselineSurvived({ child, exit }, abort.signal)
      let complete = false
      survived.then(() => {
        complete = true
      })
      await vi.advanceTimersByTimeAsync(19_999)
      expect(complete).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await survived).toBe(true)
      const failed = baselineSurvived({ child, exit }, abort.signal)
      child.signalCode = 'SIGTRAP'
      exited({ signal: 'SIGTRAP' })
      expect(await failed).toBe(false)
      abort.abort()
      const cancelled = new AbortController()
      const refusing = baselineSurvived(
        { child: { exitCode: null, signalCode: null }, exit: new Promise(() => {}) },
        cancelled.signal,
      ).catch(() => false)
      cancelled.abort()
      expect(await refusing).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
  it('never starts a late app after its preparation deadline and drain have ended', async () => {
    vi.useFakeTimers()
    try {
      let release
      const f = fixture()
      f.io.beforeLaunch = (variant) =>
        variant === 'V0'
          ? new Promise((resolve) => {
              release = resolve
            })
          : undefined
      const pending = probeVariants(f.io)
      await vi.advanceTimersByTimeAsync(60_001)
      expect((await pending).selection.variant).toBe('V2F')
      release()
      await vi.advanceTimersByTimeAsync(1)
      expect(f.order).not.toContain('launch-V0')
      expect(f.saved.at(-1).probeMatrix.V0.drew).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
  it('requires the first drawing result and all six successful drains before the journey can start', () => {
    const probeMatrix = Object.fromEntries(
      ['V0', 'V1', 'V2', 'V2F', 'V3', 'V4'].map((v) => [v, record(v, ['V2F', 'V4'].includes(v))]),
    )
    const receipt = {
      probeMatrix,
      matrixDrains: Object.fromEntries(Object.keys(probeMatrix).map((v) => [v, true])),
      launchSelection: firstDrawing(probeMatrix),
    }
    expect(requireSelection(receipt).variant).toBe('V2F')
    expect(requireSelection(receipt).droppedFences).toEqual({
      loopbackOutbound: true,
      keychainDataDeny: true,
    })
    expect(safeMatrixReceipt({ probeMatrix: {}, matrixDrains: {} })).toBe(true)
    for (const bad of [
      { ...receipt, matrixDrains: { ...receipt.matrixDrains, V3: false } },
      { ...receipt, matrixDrains: {} },
      { ...receipt, launchSelection: { ...receipt.launchSelection, variant: 'V4', sandbox: true } },
      { ...receipt, launchSelection: { ...receipt.launchSelection, variant: 'V0' } },
      {
        ...receipt,
        launchSelection: {
          ...receipt.launchSelection,
          droppedFences: { loopbackOutbound: false, keychainDataDeny: false },
        },
      },
      { ...receipt, HOME: '/fictional' },
      { probeMatrix: {}, matrixDrains: {} },
    ])
      expect(() => requireSelection(bad)).toThrow('Missing measured launch selection')
    const sandboxRecords = structuredClone(probeMatrix)
    sandboxRecords.V2F.drew = false
    sandboxRecords.V4.drew = true
    expect(() => firstDrawing(sandboxRecords)).toThrow('No drawing launch variant')
  })
  it('matches the smoke-check baseline and adds only the stated layer at each step', () => {
    const specs = ['V0', 'V1', 'V2', 'V2F', 'V3', 'V4'].map((variant) =>
      launchVariant(variant, context),
    )
    expect(specs[0]).toEqual({
      program: context.executable,
      args: ['--user-data-dir=' + context.workspace, HIDDEN_LAUNCH_ARG],
      env: context.baseline,
    })
    expect(specs[1].args).toEqual(specs[0].args)
    expect(specs[1].env).toEqual({
      ...context.baseline,
      HOME: join('/fictional/root', 'home'),
      USERPROFILE: join('/fictional/root', 'home'),
      CFFIXED_USER_HOME: join('/fictional/root', 'home'),
    })
    expect(specs[2].env).toEqual(specs[1].env)
    expect(specs[2].args).toEqual([
      ...specs[1].args,
      '--use-mock-keychain',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=12345',
      '--plugin-global-root=/fictional/global',
    ])
    expect(specs[3]).toEqual({ ...specs[2], env: context.fixture })
    expect(specs[4].program).toBe('/usr/bin/sandbox-exec')
    expect(specs[4].args).toEqual([
      '-f',
      join('/fictional/root', 'sandbox.sb'),
      context.executable,
      ...specs[2].args,
    ])
    expect(specs[4].env).toEqual(specs[2].env)
    expect(specs[5]).toEqual({ ...specs[4], env: context.fixture })
    expect(context.baseline.HOME).toBe('/fictional/runner')
  })
  it('measures all six, drains between them, persists each result and explicitly selects the first drawing one', async () => {
    const f = fixture()
    const result = await probeVariants(f.io)
    expect(f.order).toEqual(
      ['V0', 'V1', 'V2', 'V2F', 'V3', 'V4'].flatMap((v) => ['launch-' + v, 'drain']),
    )
    expect(f.saved.map((value) => Object.keys(value.probeMatrix).length)).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
    expect(result.selection).toEqual({
      variant: 'V2F',
      rule: 'fixture-variant-must-draw',
      sandbox: false,
      fixtureEnvironment: true,
      droppedFences: { loopbackOutbound: true, keychainDataDeny: true },
    })
    expect(
      safeReport({
        probeMatrix: result.records,
        matrixDrains: result.drains,
        launchSelection: result.selection,
      }),
    ).toBe(true)
  })
  it('continues after a natural fatal exit and records it before its cleanup signal', async () => {
    const f = fixture(async (run, variant, value) => {
      if (variant === 'V3') {
        run.child.signalCode = 'SIGTRAP'
        run.stderrClass = () => ({ category: 'fatal-check' })
        throw new Error('HOME=/fictional argv=madeup')
      }
      value.drew = variant === 'V2F' || variant === 'V4'
    })
    f.io.drain = async (run) => {
      run.child.signalCode = 'SIGTERM'
      return true
    }
    const result = await probeVariants(f.io)
    expect(result.records.V3).toEqual({
      ...record('V3'),
      exit: 'SIGTRAP',
      stderrCategory: 'fatal-check',
    })
    expect(result.records.V2F.exit).toBe(null)
    expect(result.records.V4.drew).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/HOME|fictional|madeup|argv/)
  })
  it('bounds every variant at 60 seconds, cancels its waits and drains after a timeout', async () => {
    vi.useFakeTimers()
    try {
      const signals = []
      const f = fixture(async (_run, _variant, _value, signal) => {
        signals.push(signal)
        await new Promise(() => {})
      })
      const pending = probeVariants(f.io).catch((error) => error)
      await vi.advanceTimersByTimeAsync(60_000 * 6 + 1)
      expect((await pending).message).toBe('No drawing launch variant')
      expect(f.saved).toHaveLength(6)
      expect(signals.every((signal) => signal.aborted)).toBe(true)
      expect(f.order.filter((item) => item === 'drain')).toHaveLength(6)
    } finally {
      vi.useRealTimers()
    }
  })
  it('does not launch another variant or choose a journey after an incomplete drain', async () => {
    const f = fixture()
    f.io.drain = async () => false
    await expect(probeVariants(f.io)).rejects.toThrow('did not drain')
    expect(f.order).toEqual(['launch-V0'])
    expect(f.saved[0].matrixDrains).toEqual({ V0: false })
  })
  it('refuses a local or self-hosted matrix before it can read a fixture or start a process', async () => {
    const f = fixture()
    f.io.guard = () => requireCI({ RUNNER_ENVIRONMENT: 'self-hosted' }, 'darwin', 'arm64')
    await expect(probeVariants(f.io)).rejects.toThrow('Private Mac gate only')
    expect(f.order).toEqual([])
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../gates/plugin-packaged/launch-matrix.mjs', import.meta.url)),
        '/fictional/absent',
      ],
      { env: { RUNNER_ENVIRONMENT: 'self-hosted' }, encoding: 'utf8', timeout: 3000 },
    )
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('"phase":"probe-matrix"')
    expect(run.stderr).toBe('')
    expect(run.stdout).not.toMatch(/fictional|HOME|argv|path/)
  })
  it('rejects paths, env, extra keys and arbitrary exits in stdout frames and the artifact', () => {
    const received = [],
      read = closedFrames('gate-variant ', safeVariant, (value) => received.push(value))
    for (const bad of [
      { ...record('V0'), env: context.baseline },
      { ...record('V0'), exit: '/fictional' },
      { ...record('V0'), stderrCategory: 'HOME=madeup' },
      { ...record('V0'), variant: '/fictional' },
      { ...record('V0'), exit: 'SIGFICTIONAL' },
      { ...record('V0'), exit: -1 },
    ]) {
      expect(safeVariant(bad)).toBe(false)
      expect(safeReport({ probeMatrix: { V0: bad } })).toBe(false)
      read(Buffer.from('gate-variant ' + JSON.stringify(bad) + '\n'))
    }
    expect(safeMatrix({ V0: null })).toBe(false)
    expect(
      safeSelection({
        variant: 'V2F',
        rule: '/fictional',
        sandbox: false,
        fixtureEnvironment: true,
      }),
    ).toBe(false)
    expect(safeReport({ matrixDrains: { '/fictional': true } })).toBe(false)
    read(Buffer.from('gate-variant ' + JSON.stringify(record('V0')) + '\n'))
    expect(received).toEqual([record('V0')])
    expect(() => firstDrawing({ V0: record('V0') })).toThrow('Incomplete')
    const app = new EventEmitter()
    const classifier = appStderrClassifier()
    app.on('data', (bytes) => classifier.write(bytes))
    app.emit('data', Buffer.from('FATAL: Check failed HOME=/fictional madeup'))
    expect(classifier.result).toEqual({ category: 'fatal-check' })
  })
})
