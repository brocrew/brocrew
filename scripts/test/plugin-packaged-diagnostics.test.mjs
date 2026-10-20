import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as diagnostics from '../gates/plugin-packaged/diagnostics.mjs'
import * as matrix from '../gates/plugin-packaged/matrix.mjs'
import * as providerState from '../gates/plugin-packaged/provider-state.mjs'
import * as pageState from '../gates/plugin-packaged/page-state.mjs'
import * as pluginState from '../gates/plugin-packaged/plugin-state.mjs'
import { preflight } from '../gates/plugin-packaged/preflight.mjs'
import {
  command,
  fixtureEnvironment,
  buildEnvironment,
  prepareBuild,
} from '../gates/plugin-packaged/prepare.mjs'
import { bounded } from '../gates/plugin-packaged/processes.mjs'
import { safeReport } from '../gates/plugin-packaged/contract.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function scratch() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-gate-diagnostic-')))
  fs.chmodSync(root, 0o700)
  roots.push(root)
  fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n')
  fs.mkdirSync(path.join(root, 'repo'))
  return root
}
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// Drive the real launcher with an inert event source; no process is started.
function launcher({ delayedClose = false } = {}) {
  const text = fs.readFileSync(
    path.join(repository, 'scripts/gates/plugin-packaged/owner.mjs'),
    'utf8',
  )
  const body = text.slice(
    text.indexOf('function childRun('),
    text.indexOf('export async function run('),
  )
  const child = new EventEmitter()
  if (!delayedClose)
    child.on('exit', (code, signal) => queueMicrotask(() => child.emit('close', code, signal)))
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  const launches = [],
    lines = []
  const io = {
    ...diagnostics,
    ...matrix,
    ...pageState,
    ...providerState,
    ...pluginState,
    bounded,
    path,
    repository: '/fictional/repo',
    spawn: (...args) => {
      launches.push(args)
      return child
    },
    console: { log: (line) => lines.push(line) },
  }
  return {
    child,
    launches,
    lines,
    run: Function(...Object.keys(io), 'return (' + body + ')')(...Object.values(io)),
  }
}

describe.skipIf(process.platform === 'win32')('safe packaged gate failure diagnostics', () => {
  it('forwards only closed variant and selection frames, including split frames and late pipe bytes', async () => {
    const f = launcher({ delayedClose: true })
    const task = f.run(
      '/fictional/node',
      [],
      {},
      '/fictional',
      { signal: new AbortController().signal },
      1000,
      'probe-matrix',
    )
    const record = {
      variant: 'V2F',
      drew: true,
      devtools: true,
      exit: null,
      stderrCategory: 'other',
    }
    const selected = {
      variant: 'V2F',
      rule: 'fixture-variant-must-draw',
      sandbox: false,
      fixtureEnvironment: true,
      droppedFences: { loopbackOutbound: true, keychainDataDeny: true },
    }
    f.child.stdout.emit(
      'data',
      Buffer.from(
        'HOME=/fictional argv=madeup\ngate-variant ' +
          JSON.stringify({ ...record, path: '/fictional' }) +
          '\n',
      ),
    )
    const line = 'gate-variant ' + JSON.stringify(record) + '\n'
    f.child.stdout.emit('data', Buffer.from(line.slice(0, 17)))
    f.child.stdout.emit('data', Buffer.from(line.slice(17)))
    f.child.emit('exit', 0, null)
    f.child.stdout.emit(
      'data',
      Buffer.from('gate-launch-selection ' + JSON.stringify(selected) + '\n'),
    )
    f.child.emit('close', 0, null)
    await task.wait()
    expect(f.lines).toEqual([line.trim(), 'gate-launch-selection ' + JSON.stringify(selected)])
    expect(f.lines.join('')).not.toMatch(/fictional|HOME|argv|madeup|path/)
  })
  it('launches the declared program directly in its scratch cwd and environment, with its own group', async () => {
    const { child, run, launches } = launcher()
    const env = { HOME: '/fictional/home', PATH: '/fictional/tools:/usr/bin:/bin' }
    const task = run(
      '/fictional/node',
      ['fictional-argument'],
      env,
      '/fictional/repo',
      { signal: new AbortController().signal },
      1000,
      'prepare',
    )
    expect(launches).toEqual([
      [
        '/fictional/node',
        ['fictional-argument'],
        { env, cwd: '/fictional/repo', stdio: ['ignore', 'pipe', 'pipe'], detached: true },
      ],
    ])
    child.emit('exit', 0, null)
    await expect(task.wait()).resolves.toBeUndefined()
  })
  it.each([
    ['cdp-fixture-tests', true],
    ['dependencies', false],
    ['journey', false],
  ])('the %s phase puts its own output in the job log: %s', async (phase, echoed) => {
    const written = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((bytes) => {
      written.push(String(bytes))
      return true
    })
    try {
      const { child, run } = launcher()
      const task = run(
        '/fictional/node',
        [],
        {},
        '/fictional',
        { signal: new AbortController().signal },
        1000,
        phase,
      )
      child.stdout.emit('data', Buffer.from('fictional test name\n'))
      child.stderr.emit('data', Buffer.from('fictional assertion\n'))
      child.emit('exit', 1, null)
      let failure
      await task.wait().catch((error) => {
        failure = error.failure
      })
      expect(failure).toMatchObject({ phase, exitCode: 1 })
      expect(JSON.stringify(failure)).not.toMatch(/fictional/)
      expect(written.filter((line) => line.startsWith('fictional'))).toEqual(
        echoed ? ['fictional test name\n', 'fictional assertion\n'] : [],
      )
    } finally {
      write.mockRestore()
    }
  })

  it.each([
    ['EACCES', 'permission'],
    ['PermissionError: Permission denied', 'permission'],
    ['FileNotFoundError: No such file or directory', 'not-found'],
    ['ENOENT', 'not-found'],
    ['ENOTFOUND', 'network'],
    ['ERR_PNPM_META_FETCH_FAIL', 'network'],
    ['gyp ERR!', 'native-build'],
  ])('classifies %s without exposing child paths, env or argv', async (token, kind) => {
    const { child, run } = launcher()
    const task = run(
      '/fictional/node',
      ['fictional-argument'],
      { HOME: '/fictional/home', MADE_UP_VALUE: 'fictional-value' },
      '/fictional/cwd',
      { signal: new AbortController().signal },
      1000,
      'dependencies',
    )
    child.stdout.emit(
      'data',
      Buffer.from(
        '/private/fictional/path HOME=/fictional/home MADE_UP_VALUE=fictional-value ' + token,
      ),
    )
    child.stderr.emit('data', Buffer.from('argv=fictional-argument'))
    child.emit('exit', 7, null)
    let failure
    await task.wait().catch((error) => {
      failure = error.failure
    })
    expect(failure).toEqual({ phase: 'dependencies', errorClass: kind, exitCode: 7, signal: null })
    const printed = []
    diagnostics.printFailure(failure, (line) => printed.push(line))
    const summary = { failure }
    expect(safeReport(summary)).toBe(true)
    const bytes = printed.join('') + JSON.stringify(summary)
    expect(bytes).not.toMatch(/private|fictional|HOME|MADE_UP_VALUE|argv|cwd/)
    expect(JSON.parse(printed[0].slice('gate-failure '.length))).toEqual(failure)
  })
  it('carries a chunked inner failure frame across a generic prepare exit without forwarding raw output', async () => {
    const { child, run } = launcher()
    const task = run(
      '/fictional/node',
      [],
      {},
      '/fictional',
      { signal: new AbortController().signal },
      1000,
      'prepare',
    )
    const expected = {
      phase: 'app-signature',
      errorClass: 'builder-codesign',
      exitCode: 1,
      signal: null,
    }
    const frame = 'gate-failure ' + JSON.stringify(expected) + '\n'
    child.stdout.emit('data', Buffer.from('/fictional HOME=fictional-material\n'))
    child.stdout.emit('data', Buffer.from(frame.slice(0, 30)))
    child.stdout.emit('data', Buffer.from(frame.slice(30)))
    child.emit('exit', 1, null)
    expect((await task.wait().catch((error) => error)).failure).toEqual(expected)
  })
  it('waits for the last diagnostic bytes after leader exit and before pipe closure', async () => {
    const { child, run } = launcher({ delayedClose: true })
    const task = run(
      '/fictional/node',
      [],
      {},
      '/fictional',
      { signal: new AbortController().signal },
      1000,
      'prepare',
    )
    const expected = { phase: 'node-prepare', errorClass: 'child-exit', exitCode: 9, signal: null }
    let settled = false
    const waiting = task.wait().catch((error) => {
      settled = true
      return error.failure
    })
    child.emit('exit', 1, null)
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled).toBe(false)
    child.stdout.emit('data', Buffer.from('gate-failure ' + JSON.stringify(expected) + '\n'))
    child.emit('close', 1, null)
    expect(await waiting).toEqual(expected)
  })
  it.each([
    ['Invalid ASAR integrity hash HOME=/fictional', 'asar-integrity'],
    ['FATAL: Check failed: /fictional', 'fatal-check'],
    ['dyld[41001]: Library not loaded: /fictional', 'dyld'],
    ['sandbox initialization failed HOME=/fictional', 'sandbox'],
    ['GPU process launch failed /fictional', 'gpu'],
    ['unreviewed HOME=/fictional argv=madeup', 'other'],
  ])('classifies bounded app stderr without forwarding any text (%s)', (text, category) => {
    const scan = diagnostics.appStderrClassifier()
    for (let i = 0; i < text.length; i += 3) scan.write(Buffer.from(text.slice(i, i + 3)))
    expect(scan.result).toEqual({ category })
    const lines = [],
      frames = []
    diagnostics.printAppStderr(scan.result, (line) => lines.push(line))
    const receive = diagnostics.stderrFrames((frame) => frames.push(frame))
    receive(Buffer.from(lines[0] + '\n'))
    receive(Buffer.from('gate-stderr ' + JSON.stringify({ category: '/fictional' }) + '\n'))
    expect(frames).toEqual([{ category }])
    expect(safeReport({ appStderr: scan.result })).toBe(true)
    expect(safeReport({ appStderr: { category, path: '/fictional' } })).toBe(false)
    expect(lines.join('')).not.toMatch(/fictional|HOME|argv|madeup/)
  })
  it('gives integrity errors priority over a generic fatal-check and drops oversized raw tails', () => {
    const scan = diagnostics.appStderrClassifier()
    scan.write(Buffer.from('FATAL: ' + 'fictional '.repeat(20000)))
    scan.write(Buffer.from('ASAR integrity mismatch'))
    expect(scan.result).toEqual({ category: 'asar-integrity' })
    const lines = []
    diagnostics.printAppStderr({ category: 'HOME=/fictional' }, (line) => lines.push(line))
    expect(lines).toEqual(['gate-stderr {"category":"other"}'])
  })
  it.each(['gui-probe', 'journey'])(
    'retains closed page state after %s exits but before pipe closure',
    async (phase) => {
      const { child, run } = launcher({ delayedClose: true })
      const task = run(
        '/fictional/node',
        [],
        {},
        '/fictional',
        { signal: new AbortController().signal },
        1000,
        phase,
      )
      const waiting = task.wait().catch((error) => error)
      child.emit('exit', 1, null)
      const state = { readyState: 'complete', routeCategory: 'setup', markers: ['setup-close'] }
      child.stdout.emit('data', Buffer.from('gate-page-state ' + JSON.stringify(state) + '\n'))
      child.stdout.emit('data', Buffer.from('gate-stderr {"category":"other"}\n'))
      const hop = { phase: 'provider-action', step: 'mcp-attached', errorCategory: 'route-absent' }
      child.stdout.emit('data', Buffer.from('gate-provider-state ' + JSON.stringify(hop) + '\n'))
      child.emit('close', 1, null)
      await waiting
      expect(task.appStderr).toEqual({ category: 'other' })
      expect(task.pageState).toEqual(state)
      expect(task.providerState).toEqual(phase === 'journey' ? hop : undefined)
    },
  )
  it('retains only a closed journey step and page state, including on a zero-exit child', async () => {
    const { child, run } = launcher({ delayedClose: true })
    const task = run(
      '/fictional/node',
      [],
      {},
      '/fictional',
      { signal: new AbortController().signal },
      1000,
      'journey',
    )
    const expected = diagnostics.stepFailure(
      'journey',
      'restart-profile',
      new Error('HOME=/fictional TOKEN=madeup argv=private'),
      'assertion',
    )
    const state = { readyState: 'complete', routeCategory: 'workspace', markers: ['rail-settings'] }
    const row = {
      ...pluginState.unknownPluginState(),
      rowPresent: true,
      stateCategory: 'installed-stopped',
      buttonCategory: 'open',
      diskObserved: true,
      installedRecordExists: true,
    }
    const waiting = task.wait().catch((error) => error)
    for (const value of [
      { ...expected, step: '/fictional' },
      { ...expected, env: 'TOKEN=madeup' },
    ])
      child.stdout.emit('data', Buffer.from('gate-failure ' + JSON.stringify(value) + '\n'))
    child.emit('exit', 0, null)
    child.stdout.emit('data', Buffer.from('gate-failure ' + JSON.stringify(expected) + '\n'))
    child.stdout.emit('data', Buffer.from('gate-page-state ' + JSON.stringify(state) + '\n'))
    child.stdout.emit(
      'data',
      Buffer.from('gate-plugin-state ' + JSON.stringify({ ...row, env: 'TOKEN=madeup' }) + '\n'),
    )
    child.stdout.emit('data', Buffer.from('gate-plugin-state ' + JSON.stringify(row) + '\n'))
    child.emit('close', 0, null)
    expect((await waiting).failure).toEqual(expected)
    expect(task.pageState).toEqual(state)
    expect(task.pluginState).toEqual(row)
    const lines = []
    diagnostics.printFailure(expected, (line) => lines.push(line))
    expect(safeReport({ failure: expected, pageState: task.pageState })).toBe(true)
    expect(JSON.stringify([lines, task.pageState])).not.toMatch(/fictional|TOKEN|HOME|argv|private/)
    for (const step of diagnostics.diagnosticSteps.journey) {
      expect(
        diagnostics.safeFailure(diagnostics.stepFailure('journey', step, {}, 'assertion')),
      ).toBe(true)
    }
    expect(() => diagnostics.stepFailure('journey', 'HOME=fictional', {})).toThrow()
  })
  it('preserves a GUI sub-step across the probe child exit and pipe closure', async () => {
    const { child, run } = launcher()
    const task = run(
      '/fictional/node',
      [],
      {},
      '/fictional',
      { signal: new AbortController().signal },
      1000,
      'gui-probe',
    )
    const expected = diagnostics.stepFailure('gui-probe', 'app-exit-early', {
      code: 23,
      signal: null,
    })
    child.stdout.emit('data', Buffer.from('gate-failure ' + JSON.stringify(expected) + '\n'))
    child.emit('exit', 1, null)
    expect((await task.wait().catch((error) => error)).failure).toEqual(expected)
  })
  it('preserves an already-received inner failure even if inherited pipes do not close before the deadline', async () => {
    const { child, run } = launcher({ delayedClose: true })
    const task = run(
      '/fictional/node',
      [],
      {},
      '/fictional',
      { signal: new AbortController().signal },
      5,
      'prepare',
    )
    const expected = { phase: 'app-build', errorClass: 'child-exit', exitCode: 7, signal: null }
    child.stdout.emit('data', Buffer.from('gate-failure ' + JSON.stringify(expected) + '\n'))
    child.emit('exit', 1, null)
    expect((await task.wait().catch((error) => error)).failure).toEqual(expected)
    child.emit('close', 1, null)
  })
  it('accepts only bounded closed frames, only on the prepare stdout channel', async () => {
    const collected = [],
      scan = diagnostics.failureFrames((value) => collected.push(value))
    const good = { phase: 'app-package', errorClass: 'child-exit', exitCode: 3, signal: null }
    for (const value of [
      { ...good, path: '/fictional' },
      { ...good, phase: 'HOME=fictional' },
    ])
      scan(Buffer.from('gate-failure ' + JSON.stringify(value) + '\n'))
    scan(Buffer.from('gate-failure ' + ' '.repeat(1024) + JSON.stringify(good) + '\n'))
    scan(Buffer.from('gate-failure {bad}\n'))
    expect(collected).toEqual([])
    scan(Buffer.from('gate-failure ' + JSON.stringify(good) + '\n'))
    expect(collected).toEqual([good])
    for (const phase of ['dependencies', 'prepare']) {
      const { child, run } = launcher()
      const task = run(
        '/fictional/node',
        [],
        {},
        '/fictional',
        { signal: new AbortController().signal },
        1000,
        phase,
      )
      child.stderr.emit('data', Buffer.from('gate-failure ' + JSON.stringify(good) + '\n'))
      if (phase !== 'prepare')
        child.stdout.emit('data', Buffer.from('gate-failure ' + JSON.stringify(good) + '\n'))
      child.emit('exit', 1, null)
      expect((await task.wait().catch((error) => error)).failure.phase).toBe(phase)
    }
  })
  it('preserves the inner failure even if a receipt cannot be written', async () => {
    const root = scratch()
    fs.mkdirSync(path.join(root, 'command-failure.json'))
    const expected = diagnostics.failureFor('app-signature', { code: 3 }, 'builder-codesign')
    const error = await diagnostics
      .phaseStep(root, 'prepare', () =>
        diagnostics.phaseStep(root, 'app-signature', () => {
          throw diagnostics.failureError('app-signature', { failure: expected })
        }),
      )
      .catch((error) => error)
    expect(error.failure).toEqual(expected)
    const lines = []
    diagnostics.printFailure(error.failure, (line) => lines.push(line))
    expect(lines.join('')).not.toMatch(/fictional|HOME|path|argv/)
  })
  it('keeps signal, spawn, deadline and cancellation failures distinct without inventing an exit code', async () => {
    for (const mode of ['signal', 'spawn', 'deadline', 'cancel']) {
      const { child, run } = launcher(),
        abort = new AbortController()
      const task = run('/fictional/node', [], {}, '/fictional', abort, 5, 'runner-preflight')
      const waiting = task.wait().catch((error) => error.failure)
      if (mode === 'signal') child.emit('exit', null, 'SIGKILL')
      if (mode === 'spawn')
        child.emit('error', Object.assign(new Error('/fictional/material'), { code: 'ENOENT' }))
      if (mode === 'cancel') abort.abort()
      const value = await waiting
      expect(value.phase).toBe('runner-preflight')
      expect(value.exitCode).toBe(null)
      expect(value.errorClass).toBe(
        { signal: 'signal', spawn: 'spawn-enoent', deadline: 'timeout', cancel: 'cancelled' }[mode],
      )
      expect(value.signal).toBe(mode === 'signal' ? 'SIGKILL' : null)
    }
  })
  it.each([
    [{ code: 'ENOENT', syscall: 'spawn /fictional/program' }, 'spawn-enoent'],
    [{ code: 'EACCES', syscall: 'spawn /fictional/program' }, 'spawn-eacces'],
    [{ code: 'ENOENT', syscall: 'open', path: '/fictional/file' }, 'fs-enoent'],
    [{ code: 'EACCES', syscall: 'access', path: '/fictional/file' }, 'fs-eacces'],
    [{ code: 'MODULE_NOT_FOUND', requireStack: ['/fictional/file'] }, 'module-not-found'],
    [{ code: 'ERR_MODULE_NOT_FOUND', url: 'file:///fictional/file' }, 'module-not-found'],
    [new Error('HOME=/fictional thrown-material'), 'thrown'],
  ])(
    'names structured spawn/fs/thrown errors without serializing their material (%s)',
    (error, kind) => {
      const value = diagnostics.failureFor('release-export', error)
      expect(value.errorClass).toBe(kind)
      expect(value.exitCode).toBe(null)
      const lines = []
      diagnostics.printFailure(value, (line) => lines.push(line))
      expect(safeReport({ failure: value })).toBe(true)
      expect(lines.join('') + JSON.stringify(value)).not.toMatch(
        /fictional|HOME|requireStack|url|syscall|material/,
      )
    },
  )
  it('rejects arbitrary diagnostic text, fields and exit values instead of printing them', () => {
    expect(diagnostics.failureFor('app-package', { signal: 'SIGTRAP' })).toEqual({
      phase: 'app-package',
      errorClass: 'signal',
      exitCode: null,
      signal: 'SIGTRAP',
    })
    expect(diagnostics.safeFailure(diagnostics.failureFor('owner', null))).toBe(true)
    const valid = diagnostics.failureFor('dependencies', { code: 1 }, 'network')
    for (const edit of [
      { phase: '/fictional/path' },
      { errorClass: 'HOME=fictional' },
      { errorClass: 'unknown' },
      { signal: 'fictional-value' },
      { exitCode: '/fictional/path' },
      { exitCode: -1 },
      { exitCode: 9999 },
      { argv: 'fictional' },
    ]) {
      const value = { ...valid, ...edit }
      expect(diagnostics.safeFailure(value)).toBe(false)
      expect(safeReport({ failure: value })).toBe(false)
      const printed = []
      diagnostics.printFailure(value, (line) => printed.push(line))
      expect(printed.join('')).not.toMatch(/fictional|HOME|argv|9999/)
    }
    expect(safeReport({ unreviewed: 'dependencies' })).toBe(false)
  })
  it('persists only the first sanitized inner failure and refuses linked or malformed receipts', async () => {
    const root = scratch()
    const run = diagnostics.phaseStep(root, 'prepare', () =>
      diagnostics.phaseStep(root, 'release-plugin-install', () => {
        throw diagnostics.failureError('prepare', { code: 9, stdout: 'HOME=/fictional' }, 'network')
      }),
    )
    await expect(run).rejects.toThrow('Private gate step failed')
    expect(diagnostics.readFailure(root)).toEqual({
      phase: 'release-plugin-install',
      errorClass: 'network',
      exitCode: 9,
      signal: null,
    })
    const file = path.join(root, 'command-failure.json')
    expect(fs.readFileSync(file, 'utf8')).not.toContain('fictional')
    fs.unlinkSync(file)
    fs.writeFileSync(path.join(root, 'other'), '{}')
    fs.symlinkSync(path.join(root, 'other'), file)
    expect(diagnostics.readFailure(root)).toBeUndefined()
    fs.unlinkSync(file)
    fs.writeFileSync(file, '{', { mode: 0o600 })
    expect(diagnostics.readFailure(root)).toBeUndefined()
  })
  it('keeps a real inert command exit and only fixed error tokens in a nested build receipt', async () => {
    const root = scratch()
    await expect(
      diagnostics.phaseStep(root, 'app-build', () =>
        command(
          process.execPath,
          [
            '-e',
            "console.error('EACCES HOME=/fictional/home argv=fictional-value');process.exit(23)",
          ],
          root,
        ),
      ),
    ).rejects.toThrow('Private gate step failed')
    const failure = diagnostics.readFailure(root)
    expect(failure).toEqual({
      phase: 'app-build',
      errorClass: 'permission',
      exitCode: 23,
      signal: null,
    })
    const lines = []
    diagnostics.printFailure(failure, (line) => lines.push(line))
    expect(
      lines.join('') + fs.readFileSync(path.join(root, 'command-failure.json'), 'utf8'),
    ).not.toMatch(/HOME|fictional|argv/)
  })
  it('makes the declared package manager available to nested build collectors without inheriting PATH', async () => {
    const root = scratch(),
      tools = path.join(root, 'declared-tools')
    fs.mkdirSync(tools)
    const pnpm = path.join(tools, 'pnpm')
    fs.writeFileSync(pnpm, '#!/bin/sh\nprintf fictional-package-manager\n', { mode: 0o700 })
    const clean = fixtureEnvironment(root)
    await expect(command('/usr/bin/which', ['pnpm'], root)).rejects.toThrow()
    const explicit = buildEnvironment(root, pnpm)
    expect(explicit.PATH.split(':')).toEqual([...clean.PATH.split(':'), tools])
    await expect(command('/usr/bin/env', ['pnpm'], root, explicit)).resolves.toBe(
      'fictional-package-manager',
    )
    expect(explicit.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
    expect(() => buildEnvironment(root, 'pnpm')).toThrow()
  })
  it('the build-only seam refuses the working checkout before changing any input', async () => {
    const root = scratch()
    await expect(
      prepareBuild(root, { node22: '/fictional/node22', pnpm: '/fictional/pnpm' }),
    ).rejects.toThrow('Isolated scratch checkout required')
    expect(fs.readdirSync(path.join(root, 'repo'))).toEqual([])
  })
  it('preflights only declared tools and writable scratch caches, with no permission widening', async () => {
    const root = scratch(),
      env = fixtureEnvironment(root)
    const tool = path.join(root, 'inert-tool')
    fs.writeFileSync(tool, '#!/usr/bin/false\n', { mode: 0o700 })
    await expect(
      Promise.resolve().then(() => preflight(root, [tool, tool, tool], env)),
    ).resolves.toBeUndefined()
    expect(env.CI).toBe('true')
    expect(env.npm_config_store_dir).toBe(path.join(root, 'pnpm-store'))
    for (const key of [
      'HOME',
      'TMPDIR',
      'npm_config_cache',
      'npm_config_store_dir',
      'ELECTRON_CACHE',
      'ELECTRON_BUILDER_CACHE',
    ])
      expect(fs.statSync(env[key]).isDirectory()).toBe(true)
    await expect(
      preflight(root, [tool, tool, path.join(root, 'missing-tool')], env),
    ).rejects.toThrow()
    expect(diagnostics.readFailure(root)?.phase).toBe('tool-pnpm')
    await expect(
      preflight(root, [tool, tool, tool], { ...env, npm_config_store_dir: '/fictional/outside' }),
    ).rejects.toThrow()
    if (process.getuid() !== 0) {
      fs.chmodSync(tool, 0)
      try {
        await expect(preflight(root, [tool, tool, tool], env)).rejects.toThrow()
        expect(fs.statSync(tool).mode & 0o777).toBe(0)
      } finally {
        fs.chmodSync(tool, 0o700)
      }
    }
  })
})
