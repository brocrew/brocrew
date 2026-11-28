// Bounded source controls.
// No app, network, provider, plugin, subprocess or dependency installation.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { readOwnedFile, rootWitness } from './owned-files.mjs'
import { sampleScript, stopAll, environment } from './processes.mjs'
import { assertAccessLabels } from './journey.mjs'
import { waitForLaunchProviders } from '../../lib/update-rehearsal-app.mjs'
import { pressInPlugins } from '../plugin-packaged/cdp.mjs'
import { stageSource } from './staging.mjs'
import { esbuildInvocation, nativeEsbuildTarget } from './tool-entry.mjs'
import { fileURLToPath } from 'node:url'
import { hash, hosted, receipt } from './contract.mjs'
import { project } from './projection.mjs'
import { verifyOperation } from './verify-operation.mjs'
import { projectDiagnostics } from './diagnostics.mjs'

test('projected child diagnostics capture raw stderr, spawn errors and exits and restore sources', () => {
  scratch((root) => {
    const paths = [
      'apps/desktop/src/main/plugins/supervisor/launcher.ts',
      'apps/desktop/src/main/plugins/node-host.ts',
      'apps/desktop/resources/plugin-host/guardian.mjs',
      'apps/desktop/src/main/plugins/supervisor/entry.ts',
      'apps/desktop/src/main/plugins/ui/host.ts',
    ]
    for (const name of paths) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
      fs.copyFileSync(path.join(repo, name), path.join(root, name))
    }
    const projected = projectDiagnostics(root, root)
    const source = fs.readFileSync(path.join(root, paths[2]), 'utf8')
    assert.ok(source.includes("stdio: ['ignore', 'ignore', 'pipe', 'ipc']"))
    const logs = [],
      handlers = {},
      stderrHandlers = {}
    const helper = source
      .slice(0, source.indexOf('// This process survives'))
      .replace(/import .*? from 'node:fs';/, '')
    vm.runInNewContext(helper + '\ngateChild(child,"whatsapp")', {
      gateAppend: (_file, line) => logs.push(JSON.parse(line)),
      gateStat: () => ({ size: 0 }),
      process: { pid: 41, on: () => {} },
      child: {
        pid: 42,
        stderr: { on: (event, fn) => (stderrHandlers[event] = fn) },
        on: (event, fn) => (handlers[event] = fn),
      },
    })
    stderrHandlers.data(Buffer.from('fictional missing native module'))
    handlers.error(new Error('fictional spawn error'))
    handlers.exit(7, null)
    assert.deepEqual(
      logs.map((row) => row.event),
      ['spawn', 'stderr', 'error', 'exit'],
    )
    assert.equal(logs[1].text, 'fictional missing native module')
    assert.match(logs[2].error, /fictional spawn error/)
    assert.equal(logs[3].code, 7)
    projected.restore()
    for (const name of paths)
      assert.equal(
        fs.readFileSync(path.join(root, name), 'utf8'),
        fs.readFileSync(path.join(repo, name), 'utf8'),
      )
  })
})

test('stage drain retries transient descendants and refuses persistent or failed censuses', async () => {
  const source = fs.readFileSync(new URL('./processes.mjs', import.meta.url), 'utf8')
  const body = source
    .slice(
      source.indexOf('export async function cleanup('),
      source.indexOf('async function port()'),
    )
    .replace('export ', '')
  const exercise = async (answers, stop = true) => {
    const diagnostic = {}
    let calls = 0
    const context = {
      stopAll: async () => stop,
      samples: async () => {
        const next = answers[Math.min(calls++, answers.length - 1)]
        if (next instanceof Error) throw next
        return next
      },
      delay: async () => {},
    }
    const fn = vm.runInNewContext(body + '\ncleanup', context)
    const result = await fn('fictional-root', [], diagnostic)
    return { result, diagnostic, calls }
  }
  const transient = await exercise([[{ pid: 42, name: 'fictional child' }], [], []])
  assert.equal(transient.result.twoEmptySamples, true)
  assert.equal(transient.calls, 3)
  assert.equal(
    (await exercise([[{ pid: 42, name: 'persistent child' }]])).result.twoEmptySamples,
    false,
  )
  assert.equal((await exercise([[]], false)).result.directClosed, false)
  await assert.rejects(
    () => exercise([new Error('fictional census timeout')]),
    /fictional census timeout/,
  )
})

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
function networkFixture() {
  return {
    v1: 'c'.repeat(64),
    v2: 'd'.repeat(64),
    archives: 2,
    synthetic: false,
    archiveMeasurements: ['chrome', 'whatsapp'].map((id, i) => ({
      id,
      version: `0.1.${i + 1}`,
      os: 'darwin',
      cpu: 'arm64',
      bytes: 1000 + i,
      sha256: String(i + 1).repeat(64),
    })),
    hops: ['v1', 'v2', 'chrome', 'whatsapp'].map((request) => ({
      request,
      host: 'raw.githubusercontent.com',
      status: 200,
    })),
  }
}

function scratch(work) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-v2-controls-')))
  try {
    return work(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
test('the hosted role takes a main push or a dispatch and refuses local or foreign runs', () => {
  const env = {
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REPOSITORY: 'brocrew/brocrew',
    GITHUB_EVENT_NAME: 'push',
  }
  assert.equal(hosted(env, 'win32', 'x64').role, 'windows')
  const dispatch = { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }
  assert.equal(hosted(dispatch, 'darwin', 'arm64').role, 'mac')
  assert.throws(() => hosted({}, 'win32', 'x64'))
  assert.throws(() => hosted({ ...env, RUNNER_ENVIRONMENT: 'self-hosted' }, 'win32', 'x64'))
  assert.throws(() => hosted({ ...env, GITHUB_REPOSITORY: 'foreign/repo' }, 'win32', 'x64'))
  assert.throws(() => hosted({ ...env, GITHUB_EVENT_NAME: 'pull_request' }, 'win32', 'x64'))
  assert.throws(() => hosted(env, 'linux', 'x64'))
})
test('projection drops the fixture source and restores the app source exactly', () =>
  scratch((root) => {
    for (const name of [
      'apps/desktop/src/main/index.ts',
      'apps/desktop/src/main/runtime-host-composition.ts',
      'apps/desktop/src/main/plugins/catalogue/build-config.ts',
    ]) {
      const file = path.join(root, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, fs.readFileSync(path.join(repo, name)), { flag: 'wx', mode: 0o600 })
    }
    const original = fs.readFileSync(path.join(root, 'apps/desktop/src/main/index.ts'), 'utf8')
    const composition = path.join(root, 'apps/desktop/src/main/runtime-host-composition.ts')
    const originalComposition = fs.readFileSync(composition, 'utf8')
    const p = project(root, {
      root,
      appData: path.join(root, 'a'),
      browser: path.join(root, 'no-browser'),
    })
    const entry = fs.readFileSync(path.join(root, 'apps/desktop/src/main/index.ts'), 'utf8')
    assert.ok(!entry.includes('fixtureSource:'))
    assert.ok(!entry.includes('repo-fixture'))
    p.restore()
    assert.equal(
      fs.readFileSync(path.join(root, 'apps/desktop/src/main/index.ts'), 'utf8'),
      original,
    )
    assert.equal(fs.readFileSync(composition, 'utf8'), originalComposition)
  }))

test('passive network observation preserves both download APIs and native responses', async () => {
  const source = fs.readFileSync(new URL('./network-entry.ts', import.meta.url), 'utf8')
  const start = source.indexOf('  globalThis.fetch = async ')
  const body = source.slice(start, source.indexOf('\n  try {', start))
  const calls = [],
    hops = [],
    response = { status: 200 }
  const context = vm.createContext({
    URL,
    hops,
    request: 'chrome',
    native: async (input, init) => {
      calls.push({ input, init })
      return response
    },
  })
  vm.runInContext(body, context)
  for (const init of [{ signal: undefined }, { redirect: 'manual', credentials: 'omit' }]) {
    const url = 'https://github.com/brocrew/fictional/releases/download/v1/archive.zip'
    assert.equal(await context.fetch(url, init), response)
    assert.equal(calls.at(-1).input, url)
    assert.equal(calls.at(-1).init, init)
  }
  assert.equal(hops.length, 2)
  assert.ok(hops.every((hop) => hop.host === 'github.com' && hop.status === 200))
})

test('missing runtime/package/consent/management/drain evidence fails closed', () => {
  const p = {
    review: true,
    cancelZeroInstalls: true,
    staleRefused: true,
    confirmed: true,
    running: true,
    configured: true,
    removed: true,
    nativeDetailsMatched: true,
    bridgeObserved: true,
  }
  const s = {
    schema: 1,
    scope: 'synthetic-v2-review',
    publicBinary: false,
    publication: false,
    platformMeasured: true,
    packageSha256: 'a'.repeat(64),
    cleanup: { directClosed: true, twoEmptySamples: true },
    measurement: { platform: 'darwin', arch: 'arm64' },
    plugins: { chrome: { ...p }, whatsapp: { ...p } },
    unmodifiedNetwork: networkFixture(),
  }
  assert.doesNotThrow(() => receipt(s))
  const sha = 'a'.repeat(40)
  const summary = Buffer.from(
    JSON.stringify({
      ...s,
      passed: true,
      observedIdentity: { routeCommit: sha, appVersion: '0.2.27' },
    }),
  )
  assert.equal(verifyOperation(sha, summary).accepted, true)
  assert.throws(() => verifyOperation('b'.repeat(40), summary), /Source SHA mismatch/)
  for (const changed of [
    { ...s, packageSha256: null },
    { ...s, cleanup: { directClosed: true, twoEmptySamples: false } },
    { ...s, plugins: { ...s.plugins, chrome: { ...p, confirmed: false } } },
    { ...s, plugins: { ...s.plugins, whatsapp: { ...p, bridgeObserved: false } } },
    { ...s, unmodifiedNetwork: { ...s.unmodifiedNetwork, hops: [] } },
    {
      ...s,
      unmodifiedNetwork: {
        ...s.unmodifiedNetwork,
        archiveMeasurements: s.unmodifiedNetwork.archiveMeasurements.map((a) => ({
          ...a,
          sha256: 'not-a-digest',
        })),
      },
    },
    {
      ...s,
      unmodifiedNetwork: {
        ...s.unmodifiedNetwork,
        hops: [
          ...s.unmodifiedNetwork.hops,
          { request: 'chrome', host: 'evil.invalid', status: 200 },
        ],
      },
    },
    { ...s, unmodifiedNetwork: { ...s.unmodifiedNetwork, v2: 'not-a-digest' } },
    { ...s, measurement: { platform: 'win32', arch: 'x64' } },
  ])
    assert.throws(() => receipt(changed))
})
test('Windows runs on plugin-area main pushes and dispatch; Mac only on dispatch', () => {
  const workflows = path.join(repo, '.github/workflows')
  const text = fs.readFileSync(path.join(workflows, 'plugin-review.yml'), 'utf8')
  const on = text.split('\non:\n')[1].split('\npermissions:')[0]
  assert.ok(on.includes('branches: [main]') && on.includes('workflow_dispatch:'))
  for (const area of [
    'plugins/**',
    'apps/desktop/src/main/plugins/**',
    'apps/desktop/resources/plugin-host/**',
    'scripts/gates/plugin-v2/**',
  ])
    assert.ok(on.includes(`- '${area}'`))
  assert.ok(text.includes(`if: github.repository == 'brocrew/brocrew'\n`))
  assert.ok(
    text.includes(
      `os: \${{ fromJSON(github.event_name == 'workflow_dispatch' && '["windows","mac"]' || '["windows"]') }}`,
    ),
  )
  const steps = text.split('\n      - ').slice(1)
  assert.ok(steps.some((step) => step.includes('reload-owner.mjs run')))
  const reload = steps.filter((step) => /reload-(owner|stage)/.test(step))
  assert.equal(reload.length, 4)
  for (const step of reload) assert.ok(step.includes("matrix.os == 'windows'"))
  assert.ok(!/app_version|sdk-/.test(text))
  for (const name of ['macos.yml', 'windows.yml'])
    assert.ok(!fs.readFileSync(path.join(workflows, name), 'utf8').includes('plugin-v2'))
})
test('the actual staging body checks out the tested source with its own version', async () => {
  const temp = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-v2-stage-controls-')),
  )
  try {
    const source = path.join(temp, 'source')
    fs.mkdirSync(path.join(source, 'apps/desktop'), { recursive: true })
    fs.copyFileSync(
      path.join(repo, 'apps/desktop/package.json'),
      path.join(source, 'apps/desktop/package.json'),
    )
    const testedVersion = JSON.parse(
      fs.readFileSync(path.join(source, 'apps/desktop/package.json')),
    ).version
    let head = 'a'.repeat(40),
      sourceVersion = testedVersion,
      protection = 0,
      cleaned = 0
    const observed = { appVersion: testedVersion, routeCommit: 'a'.repeat(40) }
    const boundaries = {
      temp,
      repository: source,
      privateRoot: async () => {
        protection++
      },
      observe: async () => observed,
      command: async (program, args, root, records, options) => {
        assert.equal(program, 'git')
        if (args[0] === 'clone') {
          fs.cpSync(source, args.at(-1), { recursive: true })
          return ''
        }
        if (args.includes('checkout')) {
          assert.equal(args.at(-1), observed.routeCommit)
          fs.writeFileSync(
            path.join(options.cwd, 'apps/desktop/package.json'),
            JSON.stringify({ version: sourceVersion }),
          )
          return ''
        }
        assert.deepEqual(args, ['rev-parse', 'HEAD'])
        return head
      },
      cleanup: async () => {
        cleaned++
      },
    }
    const root = await stageSource(boundaries)
    assert.equal(protection, 1)
    assert.equal(cleaned, 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'observed-source.json'))), observed)
    assert.equal(fs.readFileSync(path.join(root, 'staged'), 'utf8'), hash(JSON.stringify(observed)))
    head = '0'.repeat(40)
    await assert.rejects(() => stageSource(boundaries))
    assert.equal(cleaned, 1)
    head = 'a'.repeat(40)
    sourceVersion = '0.0.0'
    await assert.rejects(() => stageSource(boundaries))
    assert.equal(cleaned, 2)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
test('Windows paths use forward import slashes and valid literal PowerShell quotes', () => {
  const script = sampleScript("C:\\Gate Root\\O'Brien", 777)
  assert.ok(script.includes('("$($_.ExecutablePath) $($_.CommandLine)")'))
  assert.ok(script.includes("'c:\\gate root\\o''brien'"))
  assert.ok(!script.includes('\\"'))
  assert.ok(script.includes('$_.ProcessId -ne 777'))
  const source = fs.readFileSync(new URL('./projection.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes("provider.replaceAll('\\\\', '/')"))
})
test('false Read/Write flags and extra labels cannot be accepted', () => {
  const rows = [
    { label: 'Read only', read: true, write: false },
    { label: 'Write only', read: false, write: true },
    { label: 'Neither', read: false, write: false },
  ]
  const good = ['Read only: Read', 'Write only: Write', 'Neither: No access']
  assert.doesNotThrow(() => assertAccessLabels(good, rows))
  for (const bad of [
    ['Read only: Read, Write', ...good.slice(1)],
    [good[0], 'Write only: Read, Write', good[2]],
    [...good.slice(0, 2), 'Neither: Read'],
    [...good, 'Extra: Write'],
  ])
    assert.throws(() => assertAccessLabels(bad, rows))
})
test('gate file reads are bounded and stay inside the gate root, including in embedded bundles', () =>
  scratch((root) => {
    const file = path.join(root, 'owned')
    fs.writeFileSync(file, 'proof')
    assert.equal(readOwnedFile(file, 5, rootWitness(root)).toString(), 'proof')
    assert.throws(() => readOwnedFile(file, 4, rootWitness(root)), /larger than 4 bytes/)
    assert.throws(
      () => readOwnedFile(path.join(root, '..', 'outside'), 5, rootWitness(root)),
      /outside/,
    )
    const context = vm.createContext({ fs, path, Buffer, process })
    const readGate = vm.runInContext('(' + readOwnedFile.toString() + ')', context)
    assert.equal(readGate(file, 5, rootWitness(root)).toString(), 'proof')
  }))
test('dependency install is a held Node child with fictional provider homes and no auth', () =>
  scratch((root) => {
    const env = environment(root)
    assert.equal(env.HOME, path.join(root, 'home'))
    assert.equal(env.CLAUDE_CONFIG_DIR, path.join(root, 'home', '.claude'))
    for (const key of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'OPENAI_API_KEY',
    ])
      assert.equal(env[key], undefined)
    const owner = fs.readFileSync(new URL('./owner.mjs', import.meta.url), 'utf8')
    assert.match(
      owner,
      /await\s+command\(\s*process\.execPath,\s*\[\s*entry,\s*'install',\s*'--frozen-lockfile',?\s*\],\s*root,\s*records/,
    )
    const text = fs.readFileSync(path.join(repo, '.github/workflows/plugin-review.yml'), 'utf8')
    assert.ok(text.includes('owner.mjs install "$REVIEW_CONTROL"'))
    assert.ok(!text.includes('pnpm install --frozen-lockfile'))
  }))
test('cleanup attempts every held child after a stop failure and refuses overall drain', async () => {
  const records = [
      { id: 1, closed: false },
      { id: 2, closed: false },
      { id: 3, closed: false },
    ],
    attempted = []
  const drained = await stopAll(records, (r) => {
    attempted.push(r.id)
    if (r.id === 2) throw new Error('held stop failed')
    r.closed = true
  })
  assert.deepEqual(attempted, [3, 2, 1])
  assert.equal(drained, false)
  assert.equal(records[1].closed, false)
})

test('held esbuild launch resolves only platform native PE/Mach-O and rejects wrappers', () => {
  const args = ['entry.ts', '--bundle'],
    binary = '/owned/native-esbuild'
  assert.deepEqual(nativeEsbuildTarget('darwin', 'arm64'), {
    packageName: '@esbuild/darwin-arm64',
    subpath: 'bin/esbuild',
  })
  assert.deepEqual(nativeEsbuildTarget('win32', 'x64'), {
    packageName: '@esbuild/win32-x64',
    subpath: 'esbuild.exe',
  })
  const macho = Buffer.alloc(8)
  macho.writeUInt32LE(0xfeedfacf, 0)
  macho.writeUInt32LE(0x0100000c, 4)
  const pe = Buffer.alloc(134)
  pe.write('MZ')
  pe.writeUInt32LE(128, 0x3c)
  pe.write('PE\0\0', 128)
  pe.writeUInt16LE(0x8664, 132)
  assert.deepEqual(esbuildInvocation(binary, args, macho, 'darwin', 'arm64'), {
    program: binary,
    args,
    kind: 'native-macho-arm64',
  })
  assert.deepEqual(esbuildInvocation(binary, args, pe, 'win32', 'x64'), {
    program: binary,
    args,
    kind: 'native-pe-x64',
  })
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['win32', 'x64'],
  ]) {
    assert.throws(() =>
      esbuildInvocation(binary, args, Buffer.from('#!/usr/bin/env node\n'), 'win32', 'x64'),
    )
    assert.throws(() => esbuildInvocation(binary, args, Buffer.from('unknown'), platform, arch))
  }
  assert.throws(() => esbuildInvocation(binary, args, macho, 'win32', 'x64'))
  assert.throws(() => esbuildInvocation(binary, args, pe, 'darwin', 'arm64'))
  assert.throws(() => nativeEsbuildTarget('win32', 'arm64'))
  const malformed = Buffer.from(pe)
  malformed.writeUInt32LE(0xffffffff, 0x3c)
  assert.throws(() => esbuildInvocation(binary, args, malformed, 'win32', 'x64'))
})

test('launch synchronization accepts Providers and resets the quiet period after a tab change', async () => {
  for (const providersAt of [5_000, Infinity]) {
    let elapsed = 0
    await waitForLaunchProviders(
      {
        evaluate: async () =>
          elapsed >= providersAt
            ? 'settings-tab-providers'
            : elapsed >= 10_000
              ? 'settings-tab-general'
              : null,
      },
      {
        now: () => elapsed,
        pause: async (ms) => {
          elapsed += ms
        },
      },
    )
    assert.equal(elapsed, Number.isFinite(providersAt) ? 5_000 : 25_000)
  }
})
test('launch synchronization refuses continuous tab churn with the last tab witness', async () => {
  let elapsed = 0
  await assert.rejects(
    waitForLaunchProviders(
      { evaluate: async () => (elapsed % 500 === 0 ? 'settings-tab-general' : null) },
      {
        waitMs: 1_000,
        now: () => elapsed,
        pause: async (ms) => {
          elapsed += ms
        },
      },
    ),
    /Launch provider decision did not settle:.*selectedSettingsTab/,
  )
})
test('each plugin press recovers three tab changes and refuses the fourth with a witness', async () => {
  let selected = false
  let reopens = 0
  const cdp = {
    evaluate: async () => ({
      selectedSettingsTab: selected ? 'settings-tab-plugins' : 'settings-tab-providers',
      plugins: selected,
    }),
  }
  await assert.rejects(
    pressInPlugins(cdp, '[data-cy="plugin-review-install"]', {
      open: async () => {
        reopens++
        selected = true
      },
      click: async (_cdp, _selector, { beforePress }) => {
        for (let i = 0; i < 4; i++) {
          selected = false
          await beforePress()
          assert.equal(selected, true)
        }
      },
    }),
    /Plugins tab recovery exhausted.*settings-tab-providers/,
  )
  assert.equal(reopens, 3)
})

test('launch synchronization rejects a late Providers read and bounds a stalled read', async () => {
  let elapsed = 0
  await assert.rejects(
    waitForLaunchProviders(
      {
        evaluate: async () => {
          elapsed = 61_000
          return 'settings-tab-providers'
        },
      },
      { now: () => elapsed },
    ),
    /Launch provider decision did not settle/,
  )
  await assert.rejects(
    waitForLaunchProviders({ evaluate: async () => new Promise(() => {}) }, { waitMs: 10 }),
    /Launch provider decision did not settle/,
  )
})
