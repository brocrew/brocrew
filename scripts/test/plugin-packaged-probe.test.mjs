import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { observeApp, probeStep, waitDevtools } from '../gates/plugin-packaged/probe.mjs'
import {
  failureFrames,
  printFailure,
  safeFailure,
  stepFailure,
} from '../gates/plugin-packaged/diagnostics.mjs'
import { safeReport } from '../gates/plugin-packaged/contract.mjs'
import { openPlugins } from '../gates/plugin-packaged/cdp.mjs'

function child() {
  const child = new EventEmitter()
  return observeApp(child)
}
function startFixture(fail, variant = 'V2F') {
  const source = fs.readFileSync(
    new URL('../gates/plugin-packaged/journey.mjs', import.meta.url),
    'utf8',
  )
  const body = source.slice(
    source.indexOf('async function startApp('),
    source.indexOf('async function plugins('),
  )
  const app = new EventEmitter(),
    calls = [],
    launches = [],
    processes = []
  const io = {
    path,
    HIDDEN_LAUNCH_ARG: '--brobot-hidden',
    freePort: async () => 12345,
    fixtureEnvironment: () => ({ HOME: '/fictional/home' }),
    fixtureAppEnvironment: () => ({ HOME: '/fictional/home' }),
    readOwned: () =>
      JSON.stringify({
        launchSelection: {
          variant,
          rule: 'fixture-variant-must-draw',
          sandbox: ['V3', 'V4'].includes(variant),
          fixtureEnvironment: true,
          droppedFences: {
            loopbackOutbound: variant === 'V2F',
            keychainDataDeny: variant === 'V2F',
          },
        },
      }),
    requireSelection: (receipt) => receipt.launchSelection,
    observeApp,
    probeStep: (name, work, run) => {
      calls.push(name)
      return probeStep(name, work, run, 35)
    },
    spawn: (...args) => {
      launches.push(args)
      queueMicrotask(() =>
        fail === 'app-spawn'
          ? app.emit(
              'error',
              Object.assign(new Error('/fictional HOME=madeup'), {
                code: 'EACCES',
                syscall: 'spawn',
              }),
            )
          : app.emit('spawn'),
      )
      return app
    },
    registerChild: async () => {},
    phaseStep: async (_root, _phase, work) => work(),
    integrityCheckpoint: async () => {},
    waitDevtools: async (_port, window) => {
      if (fail === (window ? 'first-window' : 'devtools-port')) return new Promise(() => {})
    },
    bounded: (work) => work,
    attach: async () => {
      if (fail === 'app-exit-early') {
        app.emit('exit', 23, null)
        return new Promise(() => {})
      }
      if (fail === 'window-drawn') throw new Error('/fictional/home HOME=madeup')
      return { evaluate: async () => false }
    },
    press: async () => {},
  }
  const start = Function(...Object.keys(io), 'return (' + body + ')')(...Object.values(io))
  return {
    calls,
    launches,
    processes,
    start: () =>
      start(
        '/fictional/root',
        { app: '/fictional/app', argv: ['--brobot-hidden'] },
        '/fictional/workspace',
        '/fictional/global',
        processes,
        true,
      ),
  }
}
describe('packaged GUI probe diagnostic steps without an app launch', () => {
  it.each([false, true])(
    'closes setup before requiring the workspace and opening Plugins (late setup: %s)',
    async (late) => {
      const clicks = []
      let markers = late
        ? ['rail-settings']
        : ['rail-settings', 'provider-setup-dialog', 'setup-close']
      const cdp = {
        evaluate: async (body) =>
          Function(
            'document',
            body,
          )({
            querySelector: (selector) =>
              markers.some((key) => selector === `[data-cy="${key}"]`) ? {} : null,
          }),
      }
      const click = async (page, selector) => {
        expect(page).toBe(cdp)
        clicks.push(selector)
        if (selector.includes('setup-close')) markers = ['rail-settings', 'settings-tab-plugins']
        else if (selector.includes('rail-settings'))
          markers = [
            'rail-settings',
            'settings-tab-plugins',
            'provider-setup-dialog',
            'setup-close',
          ]
        else if (selector.includes('settings-tab-plugins'))
          markers = ['rail-settings', 'plugins-section']
      }
      let ready = false
      await openPlugins(cdp, {
        click,
        wait: async (test) => {
          for (let attempt = 0; attempt < 5; attempt++) {
            if (await test()) {
              ready = true
              return
            }
            // Closing the overlay alone never satisfies workspace readiness.
            expect(ready).toBe(false)
          }
          throw new Error('Workspace did not become usable')
        },
      })
      expect(ready).toBe(true)
      expect(clicks).toEqual([
        ...(late ? ['[data-cy="rail-settings"]'] : []),
        '[data-cy="setup-close"]',
        '[data-cy="settings-tab-plugins"]',
      ])
    },
  )
  it('does not accept an overlay or a Plugins marker without the workspace', async () => {
    for (const state of [
      { setup: true, close: true, workspace: true, plugins: true },
      { setup: false, close: false, workspace: false, plugins: true },
    ]) {
      const clicks = []
      await openPlugins(
        { evaluate: async () => state },
        {
          click: async (_page, selector) => clicks.push(selector),
          wait: async (test) => {
            expect(await test()).toBe(false)
          },
        },
      )
      expect(clicks).toEqual(state.close ? ['[data-cy="setup-close"]'] : [])
    }
  })
  it('retains the setup route when closing it fails to uncover the workspace before the probe deadline', async () => {
    const source = fs.readFileSync(
      new URL('../gates/plugin-packaged/journey.mjs', import.meta.url),
      'utf8',
    )
    const body = source
      .slice(
        source.indexOf('export async function guiProbe('),
        source.indexOf('export async function journey('),
      )
      .replace('export ', '')
    const emitted = [],
      clicks = []
    let drew = false
    const io = {
      path,
      requireCI() {},
      ownedRoot() {},
      readOwned: () => '{"appData":"/fictional"}',
      stageRelease() {},
      privateFolder: (folder) => folder,
      startApp: async (...args) => {
        const run = {
          port: 12345,
          exit: new Promise(() => {}),
          cdp: {
            evaluate: async () => ({ setup: true, close: true, workspace: true, plugins: false }),
          },
        }
        args[4].push(run)
        return run
      },
      probeStep: (step, work, run) => probeStep(step, work, run, 25),
      plugins: (run, signal) =>
        openPlugins(run.cdp, {
          signal,
          click: async (_page, selector) => clicks.push(selector),
          wait: async (test) => {
            expect(await test()).toBe(false)
            return new Promise(() => {})
          },
        }),
      draws: () => {
        drew = true
        return true
      },
      pageStateSnapshot: async (port) => {
        expect(port).toBe(12345)
        return {
          readyState: 'complete',
          routeCategory: 'setup',
          markers: ['rail-settings', 'provider-setup-dialog', 'setup-close'],
        }
      },
      stopApp: async () => {},
      printPageState: (value) => emitted.push(value),
    }
    const probe = Function(...Object.keys(io), 'return (' + body + ')')(...Object.values(io))
    const error = await probe('/fictional/root').catch((error) => error)
    expect(error.failure).toEqual({
      phase: 'gui-probe',
      step: 'window-drawn',
      errorClass: 'timeout',
      exitCode: null,
      signal: null,
    })
    expect(clicks).toEqual(['[data-cy="setup-close"]'])
    expect(drew).toBe(false)
    expect(emitted).toEqual([
      {
        readyState: 'complete',
        routeCategory: 'setup',
        markers: ['rail-settings', 'provider-setup-dialog', 'setup-close'],
      },
    ])
    expect(safeReport({ failure: error.failure, pageState: emitted[0] })).toBe(true)
    expect(JSON.stringify(emitted)).not.toMatch(/fictional|HOME|argv|madeup/)
  })
  it.each(['V2F'])(
    'uses the explicitly measured %s sandbox policy, always with fixture environment and hidden flags',
    async (variant) => {
      const f = startFixture(undefined, variant)
      await f.start()
      const [program, args, options] = f.launches[0]
      expect(program).toBe(
        variant === 'V2F'
          ? path.join('/fictional/app', 'Contents', 'MacOS', 'BroCrew')
          : '/usr/bin/sandbox-exec',
      )
      expect(args).toContain('--brobot-hidden')
      expect(args).toContain('--use-mock-keychain')
      expect(args).toContain('--user-data-dir=/fictional/workspace')
      expect(options.env).toEqual({ HOME: '/fictional/home' })
      if (variant !== 'V2F')
        expect(args.slice(0, 3)).toEqual([
          '-f',
          '/fictional/root/sandbox.sb',
          '/fictional/app/Contents/MacOS/BroCrew',
        ])
    },
  )
  it('reports the probe step even for refusal before fixture or app access', () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../gates/plugin-packaged/journey.mjs', import.meta.url)),
        'probe',
        '/fictional/absent',
      ],
      {
        env: { RUNNER_ENVIRONMENT: 'self-hosted' },
        encoding: 'utf8',
        timeout: 3000,
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    const frames = []
    failureFrames((value) => frames.push(value))(Buffer.from(result.stdout))
    expect(frames).toEqual([
      { phase: 'gui-probe', step: 'app-spawn', errorClass: 'thrown', exitCode: null, signal: null },
    ])
    expect(result.stdout).not.toMatch(/fictional|HOME|path|argv/)
  })
  it('captures page state on a drawing timeout without replacing the original failure', async () => {
    const source = fs.readFileSync(
      new URL('../gates/plugin-packaged/journey.mjs', import.meta.url),
      'utf8',
    )
    const body = source
      .slice(
        source.indexOf('export async function guiProbe('),
        source.indexOf('export async function journey('),
      )
      .replace('export ', '')
    const failure = {
      failure: {
        phase: 'gui-probe',
        step: 'window-drawn',
        errorClass: 'timeout',
        exitCode: null,
        signal: null,
      },
    }
    const emitted = []
    const io = {
      path,
      requireCI() {},
      ownedRoot() {},
      readOwned: () => '{"appData":"/fictional"}',
      stageRelease() {},
      privateFolder: (folder) => folder,
      startApp: async (...args) => {
        args[4].push({ port: 12345 })
        throw failure
      },
      pageStateSnapshot: async (port) => {
        expect(port).toBe(12345)
        return { readyState: 'complete', routeCategory: 'recovery', markers: ['recovery'] }
      },
      stopApp: async () => {},
      printPageState: (value) => emitted.push(value),
    }
    const probe = Function(...Object.keys(io), 'return (' + body + ')')(...Object.values(io))
    expect(await probe('/fictional/root').catch((error) => error)).toBe(failure)
    expect(emitted).toEqual([
      { readyState: 'complete', routeCategory: 'recovery', markers: ['recovery'] },
    ])
    expect(JSON.stringify(emitted)).not.toMatch(/fictional|HOME|argv|madeup/)
  })
  it.each(['app-spawn', 'devtools-port', 'first-window', 'window-drawn', 'app-exit-early'])(
    'reports the actual %s failure from the launch sequence',
    async (step) => {
      const f = startFixture(step)
      const result = await f.start().catch((error) => error.failure)
      expect(result.phase).toBe('gui-probe')
      expect(result.step).toBe(step)
      expect(result.errorClass).toBe(
        step === 'app-spawn'
          ? 'spawn-eacces'
          : step === 'app-exit-early'
            ? 'child-exit'
            : step === 'window-drawn'
              ? 'assertion'
              : 'timeout',
      )
      expect(result.exitCode).toBe(step === 'app-exit-early' ? 23 : null)
      expect(safeReport({ failure: result })).toBe(true)
    },
  )
  it('observes only the app stderr category and waits for actual pipe closure', async () => {
    const app = new EventEmitter()
    app.stderr = new EventEmitter()
    const run = observeApp(app)
    app.stderr.emit('data', Buffer.from('dyld: Library not loaded: /fictional HOME=madeup'))
    app.emit('exit', null, 'SIGTRAP')
    app.emit('close', null, 'SIGTRAP')
    expect(await run.exit).toEqual({ code: null, signal: 'SIGTRAP' })
    await run.closed
    expect(run.stderrClass()).toEqual({ category: 'dyld' })
  })
  it('retains a signal when the app exits during a readiness wait', async () => {
    const run = child()
    const waiting = probeStep('first-window', () => new Promise(() => {}), run, 100)
    run.child.emit('exit', null, 'SIGTRAP')
    expect(await waiting.catch((error) => error.failure)).toEqual({
      phase: 'gui-probe',
      step: 'app-exit-early',
      errorClass: 'child-exit',
      exitCode: null,
      signal: 'SIGTRAP',
    })
  })
  it('does not convert a failed drawing or fake-browser check into success', async () => {
    for (const step of ['window-drawn', 'fake-browser-start']) {
      const error = await probeStep(step, () => {
        throw new Error('/fictional HOME=madeup')
      }).catch((error) => error)
      expect(error.failure.step).toBe(step)
      expect(error.failure.errorClass).toBe('assertion')
    }
  })
  it('distinguishes a listening endpoint from a first page and aborts an outstanding fetch', async () => {
    for (const window of [false, true]) {
      const requests = []
      await probeStep(window ? 'first-window' : 'devtools-port', (signal) =>
        waitDevtools(12345, window, signal, async (url) => {
          requests.push(url)
          return {
            ok: true,
            json: async () =>
              window
                ? [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:12345/fictional' }]
                : { webSocketDebuggerUrl: 'ws://127.0.0.1:12345/fictional' },
          }
        }),
      )
      expect(requests).toEqual([`http://127.0.0.1:12345/json/${window ? 'list' : 'version'}`])
    }
    let aborted = false
    await probeStep(
      'devtools-port',
      (signal) =>
        waitDevtools(12345, false, signal, async () => {
          signal.addEventListener('abort', () => {
            aborted = true
          })
          return new Promise(() => {})
        }),
      undefined,
      10,
    ).catch(() => {})
    expect(aborted).toBe(true)
  })
  it('only forwards the closed step record, never source paths, environment, arbitrary steps or extra fields', () => {
    const frames = [],
      lines = []
    const good = stepFailure(
      'gui-probe',
      'fake-browser-start',
      Object.assign(new Error('/fictional HOME=madeup argv=madeup'), {
        code: 'ENOENT',
        syscall: 'spawn /fictional',
      }),
    )
    printFailure(good, (line) => lines.push(line))
    const scan = failureFrames((frame) => frames.push(frame))
    for (const bad of [
      { ...good, step: '/fictional' },
      { ...good, path: '/fictional' },
      { ...good, phase: 'prepare' },
      { ...good, errorClass: 'HOME=madeup' },
    ]) {
      expect(safeFailure(bad)).toBe(false)
      scan(Buffer.from('gate-failure ' + JSON.stringify(bad) + '\n'))
    }
    scan(Buffer.from(lines[0] + '\n'))
    expect(frames).toEqual([good])
    expect(lines.join('') + JSON.stringify({ failure: frames[0] })).not.toMatch(
      /fictional|HOME|madeup|argv|path/,
    )
  })
})
