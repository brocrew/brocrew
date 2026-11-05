import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
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
import {
  matchesInspection,
  inspectCandidate,
  emptyInstallBaseline,
  firstInstallState,
  sameInstallState,
  observationJson,
} from '../gates/plugin-packaged/journey.mjs'

const source = fs.readFileSync(
  new URL('../gates/plugin-packaged/journey.mjs', import.meta.url),
  'utf8',
)
const roles = { tamper: 1, main: 2, restart: 3, concurrent: 4 }
function logicalFixture(workspace = '/fictional/root/wa') {
  const ids = Array.from(
    { length: 6 },
    (_, i) =>
      `${i + 1}`.repeat(8) +
      '-' +
      `${i + 1}`.repeat(4) +
      '-4' +
      `${i + 1}`.repeat(3) +
      '-8' +
      `${i + 1}`.repeat(3) +
      '-' +
      `${i + 1}`.repeat(12),
  )
  const [rootId, epoch, installId, incarnation, operationId, allocatedEpoch] = ids
  const h = digest(Buffer.from(workspace)),
    workspaceId = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
  const proof = {
    cacheVerified: true,
    pristine: true,
    ref: {
      source: 'https://example.invalid/alternate-chrome.tar.gz',
      sha256: 'a'.repeat(64),
      bytes: 17,
    },
    manifestSha256: 'b'.repeat(64),
    manifest: { id: 'chrome', version: '1.0.0', authors: ['fictional'], data: { schema: 1 } },
  }
  const release = {
    version: '1.0.0',
    archiveSha256: proof.ref.sha256,
    manifestSha256: proof.manifestSha256,
    dataSchema: 1,
  }
  const baseline = {
    format: 2,
    rootId,
    epoch,
    sequence: 0,
    installations: [],
    active: [],
    recentOperations: [],
    pending: null,
    projections: [],
    workspaceEnabled: [],
    workspaceTitlesEnabled: [],
  }
  const next = {
    pluginId: 'chrome',
    installId,
    incarnation,
    lifecycleSequence: 1,
    releaseRevision: 1,
    configRevision: 0,
    release,
    phase: 'prepared',
  }
  const operation = {
    request: {
      operationId,
      consent: {
        action: 'install',
        pluginId: 'chrome',
        at: 1,
        expectedSequence: 0,
        expectedInstallId: null,
        release,
      },
      snapshot: null,
      workspaces: [workspaceId],
    },
    allocated: { installId, incarnation, epoch: allocatedEpoch },
    next,
  }
  const active = { ...next, phase: 'active' }
  const receipt = {
    format: 1,
    rootId,
    workspaceId,
    epoch,
    pluginId: 'chrome',
    installId,
    incarnation,
    lifecycleSequence: 1,
    releaseRevision: 1,
    configRevision: 0,
    skills: [],
    bindings: [],
  }
  const completed = {
    ...structuredClone(baseline),
    sequence: 2,
    installations: [structuredClone(active)],
    active: [structuredClone(active)],
    recentOperations: [{ operation, status: 'completed' }],
    projections: [receipt],
  }
  return { baseline, completed, proof }
}

// Exercise orchestration with inert dependencies: no app, provider, endpoint or real data.
function fixture(
  fail,
  {
    corrupt = false,
    snapshotFails = false,
    missingRoute = false,
    acceptance = true,
    replay = false,
    wrongRef = false,
    unknownTamper = false,
    tamperEffects = false,
    unexpectedRun = false,
  } = {},
) {
  const body = source
    .slice(source.indexOf('export async function journey('), source.indexOf('if (process.argv[1]'))
    .replace('export ', '')
  const installedCounts = new Map()
  const calls = [],
    lines = [],
    files = new Map()
  let starts = 0,
    selected = false,
    inspections = 0
  const logical = logicalFixture(path.join('/fictional/root', 'wa'))
  let providerClosed = false
  const check = (step) => {
    calls.push(step)
    if (fail === step) throw new Error('HOME=/fictional TOKEN=madeup argv=private')
  }
  const page = (number) => ({
    number,
    evaluate: async (text) => {
      if (text.includes("kind:'availability'")) return { ok: true, available: true }
      if (text.includes("kind:'inspect'"))
        return { ok: false, detail: 'The package files do not match the selected bytes.' }
      if (text.includes("kind:'list'"))
        return {
          ok: true,
          cards:
            number === roles.tamper ? [] : [{ id: 'chrome', installed: true, state: 'Running' }],
        }
      return true
    },
    send: async () => {},
    close() {},
  })
  const io = {
    isDeepStrictEqual,
    observationJson,
    emptyInstallBaseline,
    firstInstallState,
    sameInstallState,
    observeInstallState: (_root, global) => {
      if (global.replaceAll('\\', '/').endsWith('/b')) {
        if (unknownTamper) throw new Error('Unknown tamper state')
        const value = structuredClone(logical.baseline)
        if (tamperEffects) value.sequence = 2
        return value
      }
      const value = structuredClone(selected ? logical.completed : logical.baseline)
      if (replay && starts >= roles.restart) value.sequence += 2
      return value
    },
    observeRunNames: (_root, global) =>
      global.replaceAll('\\', '/').endsWith('/b') || !selected
        ? []
        : unexpectedRun && inspections > 1
          ? ['first', 'extra']
          : ['first'],
    prepareCandidateCache: async () => {
      check('cache-prepare')
      files.set('/fictional/root/proof/candidate-cache.json', JSON.stringify(logical.proof))
    },
    inspectCandidate: async () => {
      inspections++
      if (wrongRef) throw new Error('Inspected candidate differs')
    },
    reviewInstall: async (run, _proof, beforeConfirm = async () => {}) => {
      await io.inspectCandidate(run)
      calls.push({ review: 'inspect/review', role: run.number })
      await beforeConfirm()
      selected = true
      calls.push({ review: 'confirm', role: run.number })
      return acceptance
    },
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
      expect(port).toBe(12000 + roles.restart)
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
      readdirSync: (folder) =>
        folder.replaceAll('\\', '/') === '/fictional/root/g' ? ['package-vault'] : [],
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
        return Buffer.from(corrupt && starts >= roles.restart ? 'changed' : 'retained')
      return Buffer.from(files.get(file))
    },
    stageRelease: () => ({
      ref: logical.proof.ref,
      archivePath: '/fictional/root/a/repo-fixture/archives/archive.tar.gz',
    }),
    startApp: async (_root, plan, workspace, global, processes) => {
      const number = ++starts
      calls.push({ start: number, plan, workspace, global })
      if (number === roles.restart) check('restart-start')
      if (number === roles.concurrent) check('concurrent')
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
      if (run.number === roles.restart) check('restart-draw')
    },
    draws: async () => true,
    installed: async (run, wanted) => {
      if (run.number === roles.restart) {
        const count = (installedCounts.get(run.number) ?? 0) + 1
        installedCounts.set(run.number, count)
        check(wanted ? (count === 1 ? 'restart-installed' : 'reinstall') : 'uninstall')
      }
    },
    configure: async (run) => {
      if (run.number === roles.restart) check('restart-profile')
      return page(run.number)
    },
    press: async () => {},
    switchOnProfile: async () => {},
    waitFor: async (test) => {
      expect(await test()).toBe(true)
    },
    enabledProfile: async (view) => {
      calls.push({ enabled: view.number })
    },
    closeView: async () => {},
    stopApp: async (run) => {
      if (run.number === roles.main && !run.stopped) check('restart-stop')
      run.stopped = true
    },
  }
  const journey = Function(...Object.keys(io), 'return (' + body + ')')(...Object.values(io))
  return { run: () => journey('/fictional/root'), calls, lines, files }
}
describe('packaged restart journey without a native launch', () => {
  it('accounts exactly sequence0 to sequence2 and refuses hidden replay despite byte-identical retained package data', () => {
    const { baseline, completed, proof } = logicalFixture()
    expect(emptyInstallBaseline(baseline)).toBe(baseline)
    expect(firstInstallState(baseline, completed, '/fictional/root/wa', proof)).toBe(completed)
    expect(sameInstallState(completed, structuredClone(completed))).toBe(true)
    for (const change of [
      (value) => {
        value.sequence = 4
      },
      (value) => {
        value.recentOperations[0].operation.request.operationId =
          '77777777-7777-4777-8777-777777777777'
      },
      (value) => {
        value.recentOperations[0].operation.request.consent.expectedSequence = 1
      },
      (value) => {
        value.recentOperations = []
      },
      (value) => {
        value.recentOperations.push(structuredClone(value.recentOperations[0]))
      },
      (value) => {
        value.recentOperations[0].status = 'aborted'
      },
      (value) => {
        value.pending = value.recentOperations[0].operation
      },
      (value) => {
        value.recentOperations[0].operation.request.consent.action = 'global-restore'
      },
      (value) => {
        value.rootId = '77777777-7777-4777-8777-777777777777'
      },
      (value) => {
        value.epoch = '77777777-7777-4777-8777-777777777777'
      },
      (value) => {
        value.active[0].installId = '77777777-7777-4777-8777-777777777777'
      },
      (value) => {
        value.active[0].incarnation = '77777777-7777-4777-8777-777777777777'
      },
      (value) => {
        value.installations[0].release.archiveSha256 = 'c'.repeat(64)
      },
      (value) => {
        value.projections[0].workspaceId = '77777777-7777-4777-8777-777777777777'
      },
      (value) => {
        value.projections[0].configRevision = 1
      },
      (value) => {
        value.projections[0].skills = ['invented']
      },
      (value) => {
        value.workspaceEnabled = [{ workspaceId: 'unexpected' }]
      },
      (value) => {
        value.unobserved = true
      },
    ]) {
      const changed = structuredClone(completed)
      change(changed)
      expect(() => sameInstallState(completed, changed)).toThrow()
    }
    const extra = structuredClone(completed)
    extra.sequence++
    expect(() => firstInstallState(baseline, extra, '/fictional/root/wa', proof)).toThrow()
    const wrong = structuredClone(completed)
    wrong.recentOperations[0].operation.allocated.installId = '77777777-7777-4777-8777-777777777777'
    expect(() => firstInstallState(baseline, wrong, '/fictional/root/wa', proof)).toThrow()
  })
  it.each([
    'acceptance',
    'replay',
    'wrong-ref',
    'unknown-tamper',
    'tamper-effects',
    'unexpected-run',
  ])(
    'cannot earn ordinary acceptance after %s, even with unchanged fictional retained bytes',
    async (kind) => {
      const options = {
        acceptance: kind !== 'acceptance',
        replay: kind === 'replay',
        wrongRef: kind === 'wrong-ref',
        unknownTamper: kind === 'unknown-tamper',
        tamperEffects: kind === 'tamper-effects',
        unexpectedRun: kind === 'unexpected-run',
      }
      const summary = await fixture(undefined, options).run()
      expect(summary.passed).toBe(false)
      expect(summary.checks.alternateSourceAccepted).toBe(false)
      if (['unknown-tamper', 'tamper-effects'].includes(kind))
        expect(summary.checks.tamperedArchiveRefused).toBe(false)
      expect(safeReport(summary)).toBe(true)
    },
  )
  it('checks the returned public ref, full manifest and disclosed authors/version before accepting review', async () => {
    const proof = {
      cacheVerified: true,
      pristine: true,
      ref: {
        source: 'https://example.invalid/alternate-chrome.tar.gz',
        sha256: 'a'.repeat(64),
        bytes: 17,
      },
      manifest: { id: 'chrome', version: '1.0.0', authors: ['fictional'], files: [] },
      manifestSha256: 'b'.repeat(64),
    }
    const inspection = {
      id: 'chrome',
      ref: proof.ref,
      manifest: proof.manifest,
      details: {
        version: '1.0.0',
        authors: ['fictional'],
        digest: proof.ref.sha256,
        manifestSha256: proof.manifestSha256,
      },
    }
    expect(matchesInspection(inspection, proof)).toBe(true)
    for (const change of [
      { ref: { ...proof.ref, source: 'https://example.invalid/other' } },
      { ref: { ...proof.ref, sha256: 'b'.repeat(64) } },
      { ref: { ...proof.ref, bytes: 18 } },
      { manifest: { ...proof.manifest, files: [{ path: 'extra' }] } },
      { details: { ...inspection.details, version: '2.0.0' } },
      { details: { ...inspection.details, authors: ['other'] } },
      { details: { ...inspection.details, digest: 'c'.repeat(64) } },
      { details: { ...inspection.details, manifestSha256: 'c'.repeat(64) } },
    ]) {
      const bad = { ...inspection, ...change }
      expect(matchesInspection(bad, proof)).toBe(false)
      await expect(
        inspectCandidate(
          {
            cdp: {
              evaluate: async (body) => {
                expect(body).toContain("kind:'inspect'")
                return { ok: true, inspection: bad }
              },
            },
          },
          proof,
        ),
      ).rejects.toThrow('Inspected candidate differs')
    }
    expect(matchesInspection(inspection, { ...proof, cacheVerified: false })).toBe(false)
  })
  it('uses the actual review-details and confirm controls once, with no direct successful install request', async () => {
    const body = source
      .slice(
        source.indexOf('export async function reviewInstall('),
        source.indexOf('async function configure('),
      )
      .replace('export ', '')
    for (const mismatch of [false, true]) {
      const calls = []
      const proof = {
        ref: { source: 'https://example.invalid/alternate-chrome.tar.gz' },
        manifest: { version: '1.0.0', authors: ['fictional'] },
      }
      const review = Function(
        'inspectCandidate',
        'press',
        'waitFor',
        'return (' + body + ')',
      )(
        async () => calls.push('inspect'),
        async (_cdp, selector) => calls.push(selector),
        async (test) => {
          if (!(await test())) throw new Error('Review not ready')
        },
      )
      const run = {
        cdp: {
          evaluate: async () => ({
            confirm: true,
            version: '1.0.0',
            authors: 'fictional',
            source: mismatch ? 'https://example.invalid/other' : proof.ref.source,
          }),
        },
      }
      const work = review(run, proof, async () => calls.push('baseline'))
      if (mismatch) {
        await expect(work).rejects.toThrow('Review not ready')
        expect(calls).toHaveLength(2)
      } else {
        await work
        expect(calls).toEqual([
          'inspect',
          '[data-plugin="chrome"] [data-cy="plugin-review-install"]',
          'baseline',
          '[data-plugin="chrome"] [data-cy="plugin-review-confirm"]',
        ])
      }
    }
  })
  it('reuses the exact plan and roots, and waits for enabled profiles after restart and reinstall', async () => {
    const f = fixture()
    const summary = await f.run()
    expect(summary.passed).toBe(true)
    const starts = f.calls.filter((one) => typeof one === 'object' && one.start)
    expect(starts[roles.restart - 1].plan).toBe(starts[roles.main - 1].plan)
    expect(starts[roles.restart - 1].workspace).toBe(starts[roles.main - 1].workspace)
    expect(starts[roles.restart - 1].global).toBe(starts[roles.main - 1].global)
    expect(starts[roles.concurrent - 1].workspace).not.toBe(starts[roles.restart - 1].workspace)
    expect(starts[roles.concurrent - 1].global).toBe(starts[roles.restart - 1].global)
    expect(f.calls.filter((one) => typeof one === 'object' && one.enabled)).toEqual([
      { enabled: roles.main },
      { enabled: roles.restart },
      { enabled: roles.restart },
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
    if (!['concurrent', 'uninstall', 'reinstall', 'fake-browser'].includes(step))
      expect(summary.checks.alternateSourceAccepted).toBe(false)
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
    expect(summary.checks.alternateSourceAccepted).toBe(false)
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
      { role: 'switch', ariaChecked: 'false' },
      { role: 'switch', ariaChecked: 'true', ariaBusy: 'true' },
      { role: 'switch', ariaChecked: 'true' },
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
