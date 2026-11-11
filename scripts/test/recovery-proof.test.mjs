import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { observeKeychainEntries } from '../lib/mac-update-test.mjs'
import { checkBetaKeyContract } from '../lib/recovery-key-contract.mjs'
import {
  CHECKPOINT_LINE,
  READY_LINE,
  recoveryProofSequence,
  startOrder,
  keychainAttributes,
  keychainEntryFor,
} from '../lib/upgrade-path.mjs'

async function collect({
  validCopy = true,
  order = false,
  unsafe = false,
  futureFails = false,
  stateLost = false,
} = {}) {
  const result = { compatible: {}, syntheticFuture: {}, synchronous: {} }
  const failures = [],
    visited = []
  let stopped = true
  const check = (ok, name) => {
    if (!ok) failures.push(name)
  }
  const proof = recoveryProofSequence({
    check,
    alive: () => !stopped,
    currentPid: () => 101,
    launch: async () => {
      stopped = false
    },
    phase: async (name, body) => {
      try {
        await body()
      } catch (error) {
        check(false, `${name}: ${error.message}`)
      } finally {
        stopped = !unsafe
      }
    },
  })
  await proof.collect(
    result,
    {
      compatible: async () => {
        await proof.launch()
        visited.push('candidate')
        if (!validCopy) throw new Error('invalid copy/history/source/state')
        result.compatible.copy = { id: 'verified-v1' }
        if (!order) throw new Error('ordering assertion failed')
        result.compatible.order = { ready: true }
      },
      compatible019: async () => {
        visited.push('019-data')
        result.compatible.actual019ThenCandidate = true
      },
      syntheticFuture: async () => {
        visited.push('019-Restore-Return')
        if (futureFails) throw new Error('Return lost bytes')
        result.syntheticFuture.actual019RestoreReturn = true
      },
      synchronous: async () => {
        visited.push('prefix')
      },
    },
    {
      state: { 'fixture.json': '{}' },
      readState: () => (stateLost ? {} : { 'fixture.json': '{}' }),
      stateFiles: ['fixture.json'],
    },
  )
  return { result, failures, visited, exit: failures.length ? 1 : 0 }
}

describe('independent packaged recovery proof cases', () => {
  it('refuses a second launch within the same phase until the first owned PID stopped', async () => {
    let launches = 0
    const proof = recoveryProofSequence({
      launch: async () => {
        launches++
      },
      currentPid: () => 42,
      alive: () => launches > 0,
      phase: async () => {},
      check: () => {},
    })
    await proof.launch()
    await expect(proof.launch()).rejects.toThrow('still running')
    expect(launches).toBe(1)
    expect(proof.closed()).toBe(false)
  })

  it('retains a failed ordering result while collecting verified dependent and independent cases', async () => {
    const seen = await collect()
    expect(seen.visited).toEqual(['candidate', '019-data', '019-Restore-Return', 'prefix'])
    expect(seen.failures).toContain('Ordinary DOM and valid copy completion were not verified.')
    expect(seen.exit).toBe(1)
  })
  it('skips dependent cases on invalid copy prerequisites but still attempts the separate prefix', async () => {
    const seen = await collect({ validCopy: false })
    expect(seen.visited).toEqual(['candidate', 'prefix'])
    expect(seen.result.cases.filter((one) => one.skipped).map((one) => one.name)).toEqual([
      'compatible019',
      'syntheticFuture',
    ])
    expect(seen.exit).toBe(1)
  })
  it('skips dependent cases when coupled fixture state was lost', async () => {
    const seen = await collect({ stateLost: true })
    expect(seen.visited).toEqual(['candidate', 'prefix'])
    expect(seen.result.cases[1].skipped).toContain('Coupled state')
    expect(seen.exit).toBe(1)
  })
  it('blocks every further launch when shutdown was not verified', async () => {
    const seen = await collect({ unsafe: true })
    expect(seen.visited).toEqual(['candidate'])
    expect(seen.result.cases.slice(1).every((one) => one.skipped.includes('process'))).toBe(true)
    expect(seen.exit).toBe(1)
  })
  it('retains both early and later failures and still collects independent prefix evidence', async () => {
    const seen = await collect({ futureFails: true })
    expect(seen.visited.at(-1)).toBe('prefix')
    expect(seen.failures.some((one) => one.includes('ordering assertion'))).toBe(true)
    expect(seen.failures.some((one) => one.includes('Return lost bytes'))).toBe(true)
    expect(seen.exit).toBe(1)
  })
  it('allows success only when all original case assertions and shutdown checks passed', async () => {
    expect((await collect({ order: true })).exit).toBe(0)
  })
})

describe('status-only existing Keychain observations', () => {
  it('preserves distinct exit/timeout/parse facts without raw command output or invented absence', () => {
    const results = [
      { status: 44, stderr: 'Fictional private output.' },
      { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' } },
      { status: 0, stdout: 'Fictional unparsed attributes.' },
      { status: 0, stdout: '    "svce"<blob>="app Safe Storage"\n    "acct"<blob>="app Key"' },
    ]
    const seen = observeKeychainEntries(['missing', 'timeout', 'unparsed', 'app', 'app'], {
      entryFor: keychainEntryFor,
      attributes: keychainAttributes,
      run: (program, args) => {
        expect(program).toBe('/usr/bin/security')
        expect(args.slice(0, 2)).toEqual(['find-generic-password', '-s'])
        return results.shift()
      },
    })
    expect(
      seen.attempts.map(({ status, signal, errorCode, parseSucceeded }) => ({
        status,
        signal,
        errorCode,
        parseSucceeded,
      })),
    ).toEqual([
      { status: 44, signal: null, errorCode: null, parseSucceeded: false },
      { status: null, signal: 'SIGTERM', errorCode: 'ETIMEDOUT', parseSucceeded: false },
      { status: 0, signal: null, errorCode: null, parseSucceeded: false },
      { status: 0, signal: null, errorCode: null, parseSucceeded: true },
    ])
    expect(seen.entries).toEqual([
      {
        appName: 'app',
        service: 'app Safe Storage',
        account: 'app Key',
        created: null,
        modified: null,
      },
    ])
    expect(JSON.stringify(seen)).not.toMatch(/Fictional|stdout|stderr|unread/)
    expect(results).toEqual([])
  })
})

describe('the actual beta key storage contract', () => {
  const beta = {
    version: '0.2.19',
    build: { commit: '0c7edaba8b6bb35b07248061f51d5c49827d558a', dirty: false },
  }
  const status = { provider: 'codex', set: true, inUse: true, keyFilePresent: true }
  const entry = { appName: 'app', ...keychainEntryFor('app') }
  const judge = (changes = {}) => {
    const checks = []
    const contract = checkBetaKeyContract({
      beta,
      sealedRows: 0,
      status,
      entries: [],
      entryFor: keychainEntryFor,
      ...changes,
      check: (ok, name) => checks.push({ ok, name }),
    })
    return { contract, passed: checks.length > 0 && checks.every((one) => one.ok === true), checks }
  }
  it('records the file-backed release contract and legacy coverage not exercised', () => {
    const seen = judge()
    expect(seen.passed).toBe(true)
    expect(seen.contract).toMatchObject({
      storage: 'file-backed',
      legacySealed: 'not-exercised',
      entry: null,
      sealedRows: 0,
      source: beta.build.commit,
    })
  })
  it.each([
    undefined,
    {},
    { ...status, set: true, inUse: false },
    { ...status, set: false, inUse: true },
    { ...status, set: true, inUse: true, readState: 'unreadable' },
    { ...status, keyFilePresent: false },
    { ...status, keyFilePresent: undefined },
  ])('rejects failed public status %j despite a known file-backed fixture', (status) => {
    const seen = judge({ status })
    expect(seen.passed).toBe(false)
    expect(seen.contract.storage).toBe('file-backed')
    expect(seen.contract.legacySealed).toBe('not-exercised')
  })
  it('retains an older entry for candidate preservation without requiring new sealing', () => {
    const seen = judge({ entries: [entry] })
    expect(seen.passed).toBe(true)
    expect(seen.contract.entry).toBeNull()
    expect(seen.contract.preservedEntry).toEqual(entry)
    expect(seen.contract.legacySealed).toBe('not-exercised')
  })
  it.each(['0.2.19', '0.2.20', '0.2.21', '0.2.99', '0.3.0', '1.0.0'])(
    'uses the file-backed contract for release %s without build-pin exemptions',
    (version) => {
      for (const build of [undefined, { dirty: true }, { commit: 'another-source' }]) {
        const seen = judge({ beta: { version, build } })
        expect(seen.passed).toBe(true)
        expect(seen.contract.legacySealed).toBe('not-exercised')
      }
    },
  )
  it.each([
    { beta: undefined },
    { beta: {} },
    ...['', 'unknown', '0.2', '0.02.19', '0.2.19-next', '0.2.19.1'].map((version) => ({
      beta: { version },
    })),
    { sealedRows: undefined },
    { sealedRows: null },
    { sealedRows: -1 },
    { sealedRows: 1 },
  ])('never substitutes legacy sealing for unknown or inconsistent facts: %j', (changes) => {
    const seen = judge(changes)
    expect(seen.passed).toBe(false)
    expect(seen.contract.storage).toBe('unknown')
    expect(judge({ ...changes, entries: [entry] }).passed).toBe(false)
  })
  it.each(['0.0.1', '0.1.99', '0.2.18'])(
    'keeps legacy sealing before the boundary: %s',
    (version) => {
      const seen = judge({ beta: { version }, sealedRows: 1, entries: [entry], status: undefined })
      expect(seen.passed).toBe(true)
      expect(seen.contract.storage).toBe('legacy-sealed')
      expect(judge({ beta: { version }, sealedRows: 0 }).passed).toBe(false)
    },
  )
  it('keeps a genuine sealed fixture entry for the existing candidate-preservation check', () => {
    const seen = judge({
      beta: { version: '0.2.18' },
      sealedRows: 1,
      entries: [entry],
      status: undefined,
    })
    expect(seen.passed).toBe(true)
    expect(seen.contract).toMatchObject({
      storage: 'legacy-sealed',
      legacySealed: 'required',
      entry,
    })
  })
  it.each([
    { entries: [] },
    { entries: [entry, entry] },
    { entries: [{ ...entry, service: 'another service' }] },
    { entries: [{ ...entry, account: 'another account' }] },
    { entries: undefined },
    { entries: null },
    { entries: {} },
    { entries: [null] },
  ])('rejects missing or wrong legacy entry %j', ({ entries }) => {
    const seen = judge({ beta: { version: '0.2.18' }, sealedRows: 1, entries })
    expect(seen.passed).toBe(false)
    expect(seen.contract.storage).toBe('legacy-sealed')
  })
})

describe('small functional copy completion observations', () => {
  const log = `${READY_LINE}\n${CHECKPOINT_LINE}`
  const observed = {
    launched: 10,
    responsive: 20,
    absent: 21,
    completed: 30,
    manifestAbsent: false,
  }
  const functional = (observation) =>
    startOrder(log, { checkpoint: true, completion: 'functional-background', observation })
  it('accepts an already completed copy without claiming overlap or changing the strict oracle', () => {
    expect(functional(observed).backgroundObservation).toBe('already-complete-no-overlap-credit')
    expect(() =>
      startOrder(log, { checkpoint: true, completion: 'background', observation: observed }),
    ).toThrow('Responsive ordinary DOM')
  })
  it('credits overlap only with responsive DOM, actual absence and later publication', () => {
    expect(functional({ ...observed, manifestAbsent: true }).backgroundObservation).toBe(
      'witnessed-overlap',
    )
    for (const change of [
      { responsive: 31 },
      { completed: NaN },
      { manifestAbsent: null },
      { manifestAbsent: true, completed: 21 },
    ])
      expect(() => functional({ ...observed, ...change })).toThrow('Responsive ordinary DOM')
  })
})

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('hidden startup window allowance', () => {
  const source = readFileSync(join(ROOT, 'scripts/upgrade-path.mjs'), 'utf8')
  const launch = source.slice(
    source.indexOf('async function launch('),
    source.indexOf('\nconst pagesOf'),
  )
  const hidden = source.slice(
    source.indexOf('async function startHiddenProgram('),
    source.indexOf('\nasync function recoveryProofCases('),
  )
  const measurement = source.slice(
    source.indexOf('start: (program, workspace, stage, port) =>') + 'start: '.length,
    source.indexOf(
      ',\n        quit,',
      source.indexOf('start: (program, workspace, stage, port) =>'),
    ),
  )

  it.each([
    { mode: 'default', readyAfter: 100_000, wait: 120_000, passes: true },
    { mode: 'measurement', readyAfter: 150_000, wait: 900_000, passes: true },
    { mode: 'default', readyAfter: 150_000, wait: 120_000, passes: false },
    { mode: 'measurement', readyAfter: 900_001, wait: 900_000, passes: false },
  ])(
    '$mode page discovery waits $wait ms and preserves timeout failure at $readyAfter',
    async ({ mode, readyAfter, wait, passes }) => {
      const waits = [],
        checks = [],
        later = [],
        launches = []
      let activeWait,
        opened = false
      const page = { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1/fixture' }
      const context = {
        join,
        evidence: '/owned/evidence',
        os: 'mac',
        installedExe: null,
        installedProgram: null,
        running: null,
        performance: { now: () => 1 },
        Date,
        AbortSignal,
        process: { env: {} },
        openSync: () => 7,
        closeSync: () => {},
        claudeRouteEnv: () => ({}),
        spawn: (program, argv) => {
          launches.push({ program, argv })
          return { pid: 42 }
        },
        fetch: async () => ({
          ok: true,
          json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1/fixture' }),
        }),
        connect: async () => ({
          call: async () => ({ processInfo: [{ type: 'browser', id: 42 }] }),
        }),
        until: async (read, budget) => {
          waits.push(budget)
          activeWait = budget
          return await read()
        },
        pagesOf: async () => {
          opened ||= activeWait >= readyAfter
          return opened ? [page] : []
        },
        must: (ok, message) => {
          checks.push({ ok, message })
          if (!ok) throw new Error(message)
        },
        noteTheRecoveryWindow: async () => {},
        theAppsOwn: () => true,
        attachTo: async () => later.push('attach'),
        bridge: async (_stage, budget) => later.push(budget),
        onScreen: async () => later.push('rail'),
      }
      const functions = runInNewContext(
        launch +
          '\n' +
          hidden +
          '\n({startHiddenProgram, measurementStart: (' +
          measurement +
          ')})',
        context,
      )
      const start =
        mode === 'measurement' ? functions.measurementStart : functions.startHiddenProgram
      const pending = start(
        { exe: '/owned/app', program: '/owned/app/exe' },
        '/owned/workspace',
        'test',
        9999,
      )
      if (passes) {
        await expect(pending).resolves.toMatchObject({ pid: 42 })
        expect(later).toEqual(['attach', mode === 'measurement' ? 900_000 : 180_000, 'rail'])
        expect(checks.every((one) => one.ok)).toBe(true)
        expect(waits).toEqual([180_000, wait, 30_000])
      } else {
        await expect(pending).rejects.toThrow('a window opened')
        expect(later).toEqual([])
        expect(waits).toEqual([180_000, wait])
      }
      expect(launches).toHaveLength(1)
      expect(launches[0].program).toBe('/owned/app/exe')
      expect(launches[0].argv).toContain('--user-data-dir=/owned/workspace')
      expect(launches[0].argv).toContain('--brobot-hidden')
    },
  )
})
