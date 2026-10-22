import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { enabledProfile } from '../gates/plugin-packaged/cdp.mjs'
import {
  digest,
  report,
  requireCheck,
  finish,
  safeReport,
} from '../gates/plugin-packaged/contract.mjs'
import { printFailure, stepFailure } from '../gates/plugin-packaged/diagnostics.mjs'
import { providerState, printProviderState } from '../gates/plugin-packaged/provider-state.mjs'
import { unknownPluginState } from '../gates/plugin-packaged/plugin-state.mjs'

const source = fs.readFileSync(
  new URL('../gates/plugin-packaged/journey.mjs', import.meta.url),
  'utf8',
)
// Exercise orchestration with inert dependencies: no app, provider, endpoint or real data.
function fixture(fail, { corrupt = false, snapshotFails = false, missingRoute = false } = {}) {
  const body = source
    .slice(source.indexOf('export async function journey('), source.indexOf('if (process.argv[1]'))
    .replace('export ', '')
  const installedCounts = new Map()
  const calls = [],
    lines = [],
    files = new Map()
  let starts = 0
  let providerClosed = false
  const check = (step) => {
    calls.push(step)
    if (fail === step) throw new Error('HOME=/fictional TOKEN=madeup argv=private')
  }
  const page = (number) => ({
    number,
    evaluate: async (text) => {
      if (text.includes("kind:'availability'")) return { ok: true, available: true }
      if (text.includes("kind:'install'")) return { ok: false }
      if (text.includes("kind:'list'")) return { ok: true, cards: [] }
      return true
    },
    send: async () => {},
    close() {},
  })
  const io = {
    providerState,
    printProviderState: (value) => printProviderState(value, (line) => lines.push(line)),
    providerErrorCategory: () => (missingRoute ? 'route-absent' : 'other'),
    fixtureTitle: 'Fern fixture page',
    openPrompt: 'open',
    closePrompt: 'close',
    serveFixture: async () => ({ close: async () => {} }),
    createProviderTurn: async () => {
      check('provider-start')
      return {
        progress: { started: true, returned: false },
        turn: async (prompt) => {
          check(prompt === 'open' ? 'provider-action' : 'provider-close')
          providerClosed = prompt === 'close'
        },
        close: async () => {},
      }
    },
    browserEvidence: () => ({
      homePrepared: true,
      agentStarted: true,
      turnSent: true,
      toolCalled: true,
      routeReady: !missingRoute,
      toolOpened: true,
      toolRead: true,
      titleReturned: true,
      toolClosed: providerClosed,
      calls: providerClosed ? 3 : 2,
      navigations: 1,
      evaluations: 4,
      closedTabs: providerClosed ? 1 : 0,
    }),
    waitTabs: async (_view, count) => {
      check(count ? 'live-tabs-open' : 'live-tabs-closed')
      return { rowPresent: true, count, titleCategory: count ? 'fixture' : 'none' }
    },
    path,
    digest,
    report,
    requireCheck,
    finish,
    safeReport,
    stepFailure,
    printFailure: (value) => printFailure(value, (line) => lines.push(line)),
    printPageState: (state) => lines.push(JSON.stringify(state)),
    unknownPluginState,
    pluginStateSnapshot: async (root, global, workspace, port) => {
      expect(root).toBe('/fictional/root')
      expect(global).toBe(path.join('/fictional/root', 'g'))
      expect(workspace).toBe(path.join('/fictional/root', 'wa'))
      expect(port).toBe(12004)
      return {
        ...unknownPluginState(),
        rowPresent: true,
        stateCategory: 'installed-stopped',
        buttonCategory: 'open',
        errorCategory: 'none',
        diskObserved: true,
        installedRecordExists: true,
        receiptExists: false,
      }
    },
    printPluginState: (state) => lines.push(JSON.stringify(state)),
    pageStateSnapshot: async () => {
      if (snapshotFails) throw new Error('HOME=/fictional')
      return { readyState: 'complete', routeCategory: 'workspace', markers: ['rail-settings'] }
    },
    requireCI() {},
    ownedRoot() {},
    privateFolder: (folder) => folder,
    command: async (program) => (program === '/usr/bin/lipo' ? 'arm64' : 'v24.0.0'),
    fs: {
      lstatSync: () => ({ isFile: () => true }),
      existsSync: () => false,
      writeFileSync: (file, bytes) => files.set(file.replaceAll('\\', '/'), bytes),
    },
    readOwned: (named) => {
      // The journey joins its own paths, so they carry the host's separator.
      const file = named.replaceAll('\\', '/')
      if (file.endsWith('/plan.json'))
        return JSON.stringify({ app: '/fictional/app', appData: '/fictional/data' })
      if (file.endsWith('/gui-probe.json')) {
        check('fake-browser')
        return '{"windowDrawn":true,"fakeBrowserStarted":true}'
      }
      if (file.endsWith('/profiles.json'))
        return Buffer.from(corrupt && starts >= 4 ? 'changed' : 'retained')
      return Buffer.from(files.get(file))
    },
    stageRelease() {},
    startApp: async (_root, plan, workspace, global, processes) => {
      const number = ++starts
      calls.push({ start: number, plan, workspace, global })
      if (number === 4) check('restart-start')
      if (number === 5) check('concurrent')
      const run = {
        number,
        port: 12000 + number,
        cdp: page(number),
        child: { exitCode: null, signalCode: null },
        stopped: false,
      }
      processes.push(run)
      return run
    },
    plugins: async (run) => {
      if (run.number === 4) check('restart-draw')
    },
    draws: async () => true,
    installed: async (run, wanted) => {
      if (run.number === 4) {
        const count = (installedCounts.get(run.number) ?? 0) + 1
        installedCounts.set(run.number, count)
        check(wanted ? (count === 1 ? 'restart-installed' : 'reinstall') : 'uninstall')
      }
    },
    configure: async (run) => {
      if (run.number === 4) check('restart-profile')
      return page(run.number)
    },
    press: async () => {},
    pluginButton: async () => {},
    waitFor: async (test) => {
      expect(await test()).toBe(true)
    },
    enabledProfile: async (view) => {
      calls.push({ enabled: view.number })
    },
    closeView: async () => {},
    stopApp: async (run) => {
      if (run.number === 3 && !run.stopped) check('restart-stop')
      run.stopped = true
    },
  }
  const journey = Function(...Object.keys(io), 'return (' + body + ')')(...Object.values(io))
  return { run: () => journey('/fictional/root'), calls, lines, files }
}
describe('packaged restart journey without a native launch', () => {
  it('reuses the exact plan and roots, and waits for enabled profiles after restart and reinstall', async () => {
    const f = fixture()
    const summary = await f.run()
    expect(summary.passed).toBe(true)
    const starts = f.calls.filter((one) => typeof one === 'object' && one.start)
    expect(starts[3].plan).toBe(starts[2].plan)
    expect(starts[3].workspace).toBe(starts[2].workspace)
    expect(starts[3].global).toBe(starts[2].global)
    expect(starts[4].workspace).not.toBe(starts[3].workspace)
    expect(starts[4].global).toBe(starts[3].global)
    expect(f.calls.filter((one) => typeof one === 'object' && one.enabled)).toEqual([
      { enabled: 3 },
      { enabled: 4 },
      { enabled: 4 },
    ])
    expect(summary.checks.restartRetained).toBe(true)
    expect(summary.checks.reinstallRetained).toBe(true)
    expect(f.lines).toEqual([])
  })
  it.each([
    'provider-start',
    'provider-action',
    'live-tabs-open',
    'provider-close',
    'live-tabs-closed',
    'restart-stop',
    'restart-start',
    'restart-draw',
    'restart-installed',
    'restart-profile',
    'concurrent',
    'uninstall',
    'reinstall',
    'fake-browser',
  ])('records %s and closed page state rather than swallowing a raw error', async (step) => {
    const f = fixture(step)
    const summary = await f.run()
    expect(summary.passed).toBe(false)
    expect(summary.failure).toEqual({
      phase: 'journey',
      step,
      errorClass: 'assertion',
      exitCode: null,
      signal: null,
    })
    expect(summary.pageState).toEqual({
      readyState: 'complete',
      routeCategory: 'workspace',
      markers: ['rail-settings'],
    })
    expect(safeReport(summary)).toBe(true)
    if (['restart-installed', 'reinstall'].includes(step))
      expect(summary.pluginState).toMatchObject({
        rowPresent: true,
        stateCategory: 'installed-stopped',
        installedRecordExists: true,
        receiptExists: false,
      })
    else expect(summary.pluginState).toBeUndefined()
    expect(JSON.stringify(summary) + f.lines.join('')).not.toMatch(
      /fictional|HOME|TOKEN|argv|private/,
    )
    expect(JSON.parse(f.files.get('/fictional/root/summary.json')).failure).toEqual(summary.failure)
  })
  it('keeps the first missing MCP hop beside the journey failure and page snapshot', async () => {
    const f = fixture('provider-action', { missingRoute: true })
    const summary = await f.run()
    const expected = {
      phase: 'provider-action',
      step: 'mcp-attached',
      errorCategory: 'route-absent',
    }
    expect(summary.providerState).toEqual(expected)
    expect(summary.failure.step).toBe('provider-action')
    expect(summary.pageState.routeCategory).toBe('workspace')
    expect(JSON.parse(f.files.get('/fictional/root/summary.json')).providerState).toEqual(expected)
    expect(f.lines).toContain('gate-provider-state ' + JSON.stringify(expected))
    expect(JSON.stringify(summary) + f.lines.join('')).not.toMatch(
      /fictional|HOME|TOKEN|argv|private/,
    )
  })
  it('still refuses changed profile bytes after readiness and keeps the failed restart check false', async () => {
    const summary = await fixture(undefined, { corrupt: true }).run()
    expect(summary.passed).toBe(false)
    expect(summary.failure.step).toBe('restart-profile')
    expect(summary.checks.restartRetained).toBe(false)
    expect(summary.checks.concurrentWorkspaces).toBe(false)
  })
  it('does not replace the journey failure if its page observation fails', async () => {
    const summary = await fixture('restart-profile', { snapshotFails: true }).run()
    expect(summary.failure.step).toBe('restart-profile')
    expect(summary.counts.failed).toBe(1)
    expect(summary.pageState).toEqual({
      readyState: 'unknown',
      routeCategory: 'other',
      markers: [],
    })
  })
  it('waits for the restored enabled row, rejecting empty, disabled or pending UI', async () => {
    const observations = [
      null,
      { textContent: 'Enable' },
      { textContent: 'Disable', disabled: true },
      { textContent: 'Disable', disabled: false },
    ]
    let attempts = 0
    await enabledProfile(
      {
        evaluate: async (body) =>
          Function(
            'document',
            body,
          )({
            querySelector: () => {
              const button = observations[attempts++]
              return button ? { querySelectorAll: () => [button] } : null
            },
          }),
      },
      async (test) => {
        expect(await test()).toBe(false)
        expect(await test()).toBe(false)
        expect(await test()).toBe(false)
        expect(await test()).toBe(true)
      },
    )
    expect(attempts).toBe(4)
  })
  it('requires Running rather than only persisted Installed, with no missing-card shortcut', async () => {
    const body = source.slice(
      source.indexOf('async function installed('),
      source.indexOf('async function configure('),
    )
    const responses = [
      { ok: false },
      { ok: true, cards: [] },
      { ok: true, cards: [{ id: 'chrome', installed: true, state: 'Unavailable' }] },
      { ok: true, cards: [{ id: 'chrome', installed: true, state: 'Installed' }] },
      { ok: true, cards: [{ id: 'chrome', installed: true, state: 'Running' }] },
    ]
    const installed = Function(
      'waitFor',
      'return (' + body + ')',
    )(async (test) => {
      for (let i = 0; i < 4; i++) expect(Boolean(await test())).toBe(false)
      expect(await test()).toBe(true)
    })
    await installed({ cdp: { evaluate: async () => responses.shift() } }, true)
    expect(responses).toEqual([])
  })
})
