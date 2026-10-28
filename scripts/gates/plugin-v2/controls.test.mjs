// BOUNDED SOURCE CONTROLS ONLY. Authored/frozen for Priya; not executed by the author.
// No app, network, provider, plugin, subprocess or dependency installation.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { readOwnedFile, rootWitness } from './owned-files.mjs'
import { sampleScript, stopAll, environment } from './processes.mjs'
import { assertAccessLabels } from './journey.mjs'
import { projectedVersionArguments, stageSource } from './staging.mjs'
import { esbuildInvocation, nativeEsbuildTarget } from './tool-entry.mjs'
import { fileURLToPath } from 'node:url'
import { hash, hosted, receipt, LIST, BASE, BASE017, appSourceFor, MARKER } from './contract.mjs'
import { fetchSource, project, bundleProof } from './projection.mjs'
import { verifyOperation } from './verify-operation.mjs'
import { checkNormalPluginBuild } from '../../check-no-plugin-gate-inputs.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const candidate = fs.readFileSync(new URL('./candidate.json', import.meta.url))
function networkFixture() {
  return {
    v1: '16d5c9f55779f85bc94f632812cf4ec7afd3585ca54ac5799c00263732aa9f93',
    v2: '3f354f05c786f65ddaf4cdd51638051d69471e5f2ac91f008660f25bd1435482',
    archives: 2,
    synthetic: false,
    archiveMeasurements: JSON.parse(candidate).entries.map((e) => {
      const t = e.targets[0]
      return {
        id: e.id,
        version: e.version,
        os: t.os,
        cpu: t.cpu,
        bytes: t.bytes,
        sha256: t.sha256,
      }
    }),
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
test('candidate bytes are the exact previously reviewed two-row list', () => {
  assert.equal(hash(candidate), LIST)
  assert.deepEqual(
    JSON.parse(candidate).entries.map((e) => [e.id, e.version, e.authors]),
    [
      ['chrome', '0.1.3', ['brocrew']],
      ['whatsapp', '0.1.4', ['brocrew']],
    ],
  )
})
test('no-input observed source plan refuses local, wrong role/source or self-authenticating records', () => {
  const plan = JSON.parse(fs.readFileSync(new URL('./source-plan.json', import.meta.url)))
  const env = {
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REPOSITORY: 'brocrew/brocrew',
    GITHUB_REF: 'refs/heads/gate/plugin-v2-mac-closed',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_SHA: 'a'.repeat(40),
  }
  assert.doesNotThrow(() => hosted(plan, '0.1.8', env, 'darwin', 'arm64'))
  assert.throws(() => hosted(plan, '0.1.8', {}, 'darwin', 'arm64'))
  assert.throws(() => hosted(plan, '0.1.9', env, 'darwin', 'arm64'))
  for (const key of ['routeCommit', 'routeTree', 'workflowSha256', 'sourcePlanSha256'])
    assert.throws(() => hosted({ ...plan, [key]: 'a'.repeat(64) }, '0.1.8', env, 'darwin', 'arm64'))
  assert.throws(() => hosted({ ...plan, candidateSha256: null }, '0.1.8', env, 'darwin', 'arm64'))
  assert.throws(() =>
    hosted(
      { ...plan, appSources: [{ version: '0.1.8', commit: 'a'.repeat(40) }] },
      '0.1.8',
      env,
      'darwin',
      'arm64',
    ),
  )
  assert.throws(() =>
    hosted(plan, '0.1.8', { ...env, RUNNER_ENVIRONMENT: 'self-hosted' }, 'darwin', 'arm64'),
  )
  assert.throws(() =>
    hosted(plan, '0.1.8', { ...env, GITHUB_REPOSITORY: 'foreign/repo' }, 'darwin', 'arm64'),
  )
  assert.throws(() => hosted(plan, '0.1.8', env, 'win32', 'x64'))
  assert.throws(() =>
    hosted(plan, '0.1.8', { ...env, GITHUB_EVENT_NAME: 'push' }, 'darwin', 'arm64'),
  )
})
test('fixed URL shim keeps native archive transport and rejects changed candidate', () => {
  const options = { root: fs.realpathSync.native(os.tmpdir()), token: 'a'.repeat(64), candidate }
  const source = fetchSource(options)
  assert.ok(
    source.includes(
      'u.href!=="https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json"',
    ),
  )
  assert.ok(source.includes('return native(input,init)'))
  assert.ok(source.includes("process.versions.electron?'client':'owner'"))
  assert.ok(source.includes('sha(candidate)!==expected'))
  assert.ok(source.includes(MARKER))
  assert.throws(() => fetchSource({ ...options, candidate: Buffer.from('{}') }))
})
test('projection selects production v2, normal source packaging refuses, restore is exact', () =>
  scratch((root) => {
    for (const name of [
      'apps/desktop/src/main/index.ts',
      'apps/desktop/src/main/plugins/catalogue/build-config.ts',
      'apps/desktop/src/main/plugins/catalogue/download.ts',
      'apps/desktop/src/main/plugins/catalogue/dev-source.ts',
    ]) {
      const file = path.join(root, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, fs.readFileSync(path.join(repo, name)), { flag: 'wx', mode: 0o600 })
    }
    checkNormalPluginBuild(root)
    const original = fs.readFileSync(path.join(root, 'apps/desktop/src/main/index.ts'), 'utf8')
    const p = project(root, {
      root,
      token: 'b'.repeat(64),
      candidate,
      appData: path.join(root, 'a'),
      browser: path.join(root, 'no-browser'),
    })
    const entry = fs.readFileSync(path.join(root, 'apps/desktop/src/main/index.ts'), 'utf8')
    assert.ok(!entry.includes('fixtureSource:'))
    assert.ok(!entry.includes('repo-fixture'))
    assert.throws(() => checkNormalPluginBuild(root))
    p.restore()
    assert.equal(
      fs.readFileSync(path.join(root, 'apps/desktop/src/main/index.ts'), 'utf8'),
      original,
    )
    checkNormalPluginBuild(root)
  }))
test('one bundled path alone cannot establish both-path admission', () =>
  scratch((root) => {
    const paths = [
      'apps/desktop/out/main/index.js',
      'apps/desktop/resources/plugin-supervisor/entry.cjs',
    ]
    for (const p of paths) {
      fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true })
      fs.writeFileSync(path.join(root, p), LIST + ' fetch- gate-token ' + MARKER)
    }
    assert.equal(bundleProof(root).owner, true)
    fs.writeFileSync(path.join(root, paths[1]), 'unprojected owner')
    assert.throws(() => bundleProof(root))
    fs.writeFileSync(path.join(root, paths[1]), LIST + ' fetch- gate-token ' + MARKER)
    fs.writeFileSync(path.join(root, paths[0]), 'unprojected main')
    assert.throws(() => bundleProof(root))
  }))
test('restored sources cannot hide projected compiled output from normal packaging', () =>
  scratch((root) => {
    const file = path.join(root, 'apps/desktop/resources/plugin-supervisor/entry.cjs')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, MARKER)
    assert.throws(() => checkNormalPluginBuild(root), /synthetic v2/)
  }))
test('missing runtime/package/consent/management/drain evidence fails closed', () => {
  const p = {
    review: true,
    cancelZeroInstalls: true,
    staleRefused: true,
    confirmed: true,
    running: true,
    emptyManaged: true,
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
    bundlePaths: { main: true, owner: true },
    runtimePaths: { client: true, owner: true },
    measurement: { platform: 'darwin', arch: 'arm64' },
    normalBuildRefused: true,
    normalOutputRefused: true,
    plugins: { chrome: { ...p }, whatsapp: { ...p } },
    unmodifiedNetwork: networkFixture(),
  }
  assert.doesNotThrow(() => receipt(s))
  for (const changed of [
    { ...s, packageSha256: null },
    { ...s, runtimePaths: { client: true, owner: false } },
    { ...s, cleanup: { directClosed: true, twoEmptySamples: false } },
    { ...s, plugins: { ...s.plugins, chrome: { ...p, confirmed: false } } },
    { ...s, plugins: { ...s.plugins, whatsapp: { ...p, bridgeObserved: false } } },
    { ...s, normalOutputRefused: false },
    { ...s, unmodifiedNetwork: { ...s.unmodifiedNetwork, hops: [] } },
    {
      ...s,
      unmodifiedNetwork: {
        ...s.unmodifiedNetwork,
        archiveMeasurements: s.unmodifiedNetwork.archiveMeasurements.map((a) => ({
          ...a,
          bytes: a.bytes + 1,
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
    { ...s, measurement: { platform: 'win32', arch: 'x64' } },
  ])
    assert.throws(() => receipt(changed))
})
test('every ordinary job is excluded on both test-role prefixes; no new workflow/input', () => {
  for (const [name, jobs] of [
    ['macos.yml', ['flags', 'macos', 'guided-update-rehearsal', 'recovery-real-entry']],
    ['windows.yml', ['flags', 'windows', 'recovery-real-entry']],
  ]) {
    const text = fs.readFileSync(path.join(repo, '.github/workflows', name), 'utf8')
    for (const id of jobs) {
      const block = text.split(`\n  ${id}:\n`)[1]?.split(/\n {2}[a-z][a-z0-9-]+:\n/)[0]
      assert.ok(block)
      const expression = block.match(/^ {4}if:.*(?:\n {6,}.*)*/m)?.[0]
      assert.ok(expression?.includes("!startsWith(github.ref, 'refs/heads/gate/plugin-v2-mac-')"))
      assert.ok(
        expression?.includes("!startsWith(github.ref, 'refs/heads/gate/plugin-v2-windows-')"),
      )
    }
    assert.ok(text.includes('plugin-v2-review:'))
    assert.ok(!text.includes('admission_json'))
    assert.ok(text.includes("app_version: ['0.1.7', '0.1.8']"))
  }
  assert.ok(!fs.existsSync(path.join(repo, '.github/workflows/plugin-v2-mac.yml')))
  assert.ok(!fs.existsSync(path.join(repo, '.github/workflows/plugin-v2-windows.yml')))
})
test('external admission nulls or identity mismatch cannot be replaced by runtime observations', () => {
  const template = JSON.parse(
    fs.readFileSync(new URL('./operator-operation.template.json', import.meta.url)),
  )
  assert.throws(() => verifyOperation(template, {}, Buffer.from('{}')))
  assert.throws(() =>
    verifyOperation({ ...template, executionAdmitted: true }, {}, Buffer.from('{}')),
  )
  const e = {
    ...template,
    workflow: '.github/workflows/macos.yml',
    ref: 'refs/heads/gate/plugin-v2-mac-closed',
    platform: 'darwin',
    arch: 'arm64',
    appVersion: '0.1.8',
    appSource: 'a'.repeat(40),
    routeCommit: 'a'.repeat(40),
    routeTree: 'b'.repeat(40),
    sourcePlanSha256: 'c'.repeat(64),
    workflowSha256: 'd'.repeat(64),
    routePolicySha256: 'e'.repeat(64),
    brokerPolicySha256: '1'.repeat(64),
    requiredPublicChecks: ['commit messages and identities', 'secret scan'],
    reviewSha256: 'f'.repeat(64),
    executionAdmitted: true,
  }
  const p = {
    review: true,
    cancelZeroInstalls: true,
    staleRefused: true,
    confirmed: true,
    running: true,
    emptyManaged: true,
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
    passed: true,
    cleanup: { directClosed: true, twoEmptySamples: true },
    bundlePaths: { main: true, owner: true },
    runtimePaths: { client: true, owner: true },
    measurement: { platform: 'darwin', arch: 'arm64' },
    normalBuildRefused: true,
    normalOutputRefused: true,
    plugins: { chrome: { ...p }, whatsapp: { ...p } },
    unmodifiedNetwork: networkFixture(),
    observedIdentity: {
      ...e,
      identityAuthority: 'observed-awaiting-external-operator-contract',
      externalAdmissionVerified: null,
      runId: '123',
      attempt: '1',
    },
  }
  const publicPlan = JSON.parse(
    fs.readFileSync(new URL('./public-checks-plan.json', import.meta.url)),
  )
  e.publicChecksWorkflowSha256 = publicPlan.workflowSha256
  const bytes = Buffer.from(JSON.stringify(s))
  const evidence = {
    source: 'operator-broker-api-readback',
    repository: e.repository,
    workflow: e.workflow,
    headSha: e.routeCommit,
    ref: e.ref,
    event: e.event,
    runId: '123',
    attempt: '1',
    jobKey: 'plugin-v2-review',
    jobName: 'Plugin v2 Review (0.1.8)',
    jobId: 456,
    appVersion: '0.1.8',
    conclusion: 'success',
    workflowConclusion: 'success',
    reviewSha256: e.reviewSha256,
    brokerReceipt: { policy_sha256: e.brokerPolicySha256 },
    matrixJobs: ['0.1.7', '0.1.8'].map((v) => ({
      id: v === e.appVersion ? 456 : 455,
      name: `Plugin v2 Review (${v})`,
      conclusion: 'success',
    })),
    publicChecks: {
      workflow: publicPlan.workflow,
      workflowSha256: publicPlan.workflowSha256,
      event: 'push',
      ref: e.ref,
      headSha: e.routeCommit,
      runId: '789',
      attempt: '1',
      conclusion: 'success',
      jobs: Object.entries(publicPlan.jobs).map(([name, p], i) => ({
        id: 800 + i,
        name,
        conclusion: 'success',
        steps: p.required_steps.map((name) => ({ name, conclusion: 'success' })),
      })),
    },
    steps: [
      'Plugin qualification source controls',
      'Stage the observed ref-selected source plan',
      'Install the frozen app source dependencies in scratch',
      'Product HTTPS then projected package Review journey',
      'Keep the closed required evidence',
    ].map((name) => ({ name, conclusion: 'success' })),
    ordinaryJobs: ['flags', 'macos', 'guided-update-rehearsal', 'recovery-real-entry'].map(
      (id) => ({ id, conclusion: 'skipped' }),
    ),
    summarySha256: hash(bytes),
    artifact: 'plugin-v2-macos-0.1.8',
  }
  assert.equal(verifyOperation(e, evidence, bytes).accepted, true)
  for (const altered of [
    { ...e, sourcePlanSha256: null },
    { ...e, routeCommit: '0'.repeat(40) },
    { ...e, ref: 'refs/heads/gate/plugin-v2-mac-other' },
  ])
    assert.throws(() => verifyOperation(altered, evidence, bytes))
  assert.throws(() => verifyOperation({ ...e, appSource: BASE }, evidence, bytes))
  assert.throws(() => verifyOperation(e, { ...evidence, headSha: '0'.repeat(40) }, bytes))
  assert.throws(() => verifyOperation(e, { ...evidence, ordinaryJobs: [] }, bytes))
  assert.throws(() => verifyOperation(e, { ...evidence, summarySha256: '0'.repeat(64) }, bytes))
  assert.throws(() =>
    verifyOperation(
      e,
      { ...evidence, brokerReceipt: { policy_sha256: e.routePolicySha256 } },
      bytes,
    ),
  )
  assert.throws(() =>
    verifyOperation(e, { ...evidence, matrixJobs: evidence.matrixJobs.slice(1) }, bytes),
  )
  assert.throws(() =>
    verifyOperation(
      e,
      { ...evidence, publicChecks: { ...evidence.publicChecks, event: 'workflow_dispatch' } },
      bytes,
    ),
  )
  assert.throws(() =>
    verifyOperation(
      e,
      {
        ...evidence,
        publicChecks: {
          ...evidence.publicChecks,
          jobs: evidence.publicChecks.jobs.map((j, i) => (i ? j : { ...j, steps: [] })),
        },
      },
      bytes,
    ),
  )
  assert.throws(() =>
    verifyOperation({ ...e, requiredPublicChecks: ['secret scan'] }, evidence, bytes),
  )
})

test('generated framing emits separate LF records, not a literal backslash-n', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-v2-framing-')))
  try {
    const token = 'a'.repeat(64)
    fs.writeFileSync(path.join(root, 'gate-token'), token)
    fs.writeFileSync(path.join(root, 'list-mode'), 'candidate')
    const emitted = fetchSource({ root, token, candidate })
    assert.ok(!emitted.includes("from './owned-files.mjs'"))
    const js =
      emitted
        .replace(/^import .*;$/gm, '')
        .replace('const sha=(b:Uint8Array)', 'const sha=(b)')
        .replace('name:string,max:number', 'name,max')
        .replace('export const gateFetch:typeof fetch', 'const gateFetch') +
      '\nglobalThis.call=gateFetch;'
    const context = vm.createContext({
      fs,
      path,
      createHash,
      Buffer,
      URL,
      Response,
      process,
      fetch: () => {
        throw new Error('network forbidden')
      },
    })
    vm.runInContext(js, context)
    await context.call(
      'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json',
    )
    fs.writeFileSync(path.join(root, 'list-mode'), 'empty')
    await context.call(
      'https://raw.githubusercontent.com/brocrew/brocrew/main/plugins/catalogue-v2.json',
    )
    const witness = fs.readFileSync(path.join(root, 'fetch-owner.jsonl'), 'utf8')
    assert.equal(witness.includes('\\n'), false)
    const lines = witness.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.deepEqual(
      lines.map((line) => JSON.parse(line).mode),
      ['candidate', 'empty'],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
test('the actual staging body reaches017 from0.0.0 and refuses wrong source/version', async () => {
  const temp = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-v2-stage-controls-')),
  )
  try {
    const source = path.join(temp, 'source')
    fs.mkdirSync(source)
    const fixtureFiles = [
      'apps/desktop/package.json',
      'apps/desktop/src/main/index.ts',
      'apps/desktop/src/main/plugins/catalogue/build-config.ts',
      'apps/desktop/src/main/plugins/catalogue/dev-source.ts',
    ]
    for (const f of fixtureFiles) {
      const to = path.join(source, f)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.writeFileSync(to, fs.readFileSync(path.join(repo, f)), { flag: 'wx', mode: 0o600 })
    }
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(source, 'apps/desktop/package.json'))).version,
      '0.0.0',
    )
    let wrongGit = false,
      sourceVersion = '0.0.0',
      observedSource = 'a4dfcf611c244f8365d485022dc674309c2e7ae1',
      protection = 0,
      cleaned = 0,
      normalChecks = 0
    const observed = { appVersion: '0.1.7', appSource: observedSource, routeCommit: 'a'.repeat(40) }
    const boundaries = {
      temp,
      repository: source,
      readPlan: () => ({ files: [] }),
      privateRoot: async () => {
        protection++
      },
      observe: async () => ({ ...observed, appSource: observedSource }),
      command: async (program, args, root, records, options) => {
        assert.equal(program, 'git')
        if (args[0] === 'clone') {
          fs.cpSync(source, args.at(-1), { recursive: true })
          return ''
        }
        if (args.includes('checkout')) {
          fs.writeFileSync(
            path.join(options.cwd, 'apps/desktop/package.json'),
            JSON.stringify({ version: sourceVersion }),
          )
          return ''
        }
        assert.deepEqual(args, ['rev-parse', 'HEAD'])
        return wrongGit ? '0'.repeat(40) : observedSource
      },
      checkNormalPluginBuild: (root) => {
        checkNormalPluginBuild(root)
        normalChecks++
      },
      cleanup: async () => {
        cleaned++
      },
    }
    const root = await stageSource('0.1.7', boundaries)
    assert.equal(protection, 1)
    assert.equal(normalChecks, 1)
    assert.equal(cleaned, 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'observed-source.json'))), observed)
    assert.equal(fs.readFileSync(path.join(root, 'staged'), 'utf8'), hash(JSON.stringify(observed)))
    assert.deepEqual(
      projectedVersionArguments(
        JSON.parse(fs.readFileSync(path.join(root, 'observed-source.json'))).appVersion,
      ),
      ['-c.extraMetadata.version=0.1.7'],
    )
    wrongGit = true
    await assert.rejects(() => stageSource('0.1.7', boundaries))
    assert.equal(cleaned, 1)
    wrongGit = false
    sourceVersion = '0.1.7'
    await assert.rejects(() => stageSource('0.1.7', boundaries))
    assert.equal(cleaned, 2)
    sourceVersion = '0.0.0'
    observedSource = '0'.repeat(40)
    await assert.rejects(() => stageSource('0.1.7', boundaries))
    assert.equal(cleaned, 3)
    assert.throws(() => projectedVersionArguments('0.0.0'))
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
test('BigInt file identity, post-read path/FD and parent witness all refuse changes', () =>
  scratch((root) => {
    const file = path.join(root, 'owned')
    fs.writeFileSync(file, 'proof')
    assert.equal(readOwnedFile(file, 5, rootWitness(root)).toString(), 'proof')
    assert.throws(() => readOwnedFile(file, 4, rootWitness(root)))
    const held = rootWitness(root)
    assert.throws(() => readOwnedFile(file, 5, { ...held, ino: String(BigInt(held.ino) + 1n) }))
    for (const sabotage of ['large-id', 'fd-after', 'path-after', 'parent-after']) {
      let read = false,
        fds = 0
      const fake = {
        ...fs,
        readSync(...args) {
          const n = fs.readSync(...args)
          read = true
          return n
        },
        fstatSync(...args) {
          const s = fs.fstatSync(...args)
          fds++
          return {
            ...s,
            ino: sabotage === 'large-id' ? 9007199254740992n : s.ino,
            ...(sabotage === 'fd-after' && fds > 1 ? { ctimeNs: s.ctimeNs + 1n } : {}),
          }
        },
        lstatSync(p, ...args) {
          const s = fs.lstatSync(p, ...args)
          return {
            ...s,
            ...(p === file && sabotage === 'large-id' ? { ino: 9007199254740993n } : {}),
            ...(read &&
            ((sabotage === 'path-after' && p === file) ||
              (sabotage === 'parent-after' && p === root))
              ? { ino: s.ino + 1n }
              : {}),
          }
        },
      }
      // Preserve the predicate methods lost by object spread on Stats.
      for (const name of ['fstatSync', 'lstatSync']) {
        const wrapped = fake[name]
        fake[name] = (...args) => {
          const value = wrapped(...args)
          const actual = fs[name](...args)
          return Object.assign(Object.create(Object.getPrototypeOf(actual)), value)
        }
      }
      const context = vm.createContext({ fs: fake, path, Buffer, process })
      const readGate = vm.runInContext('(' + readOwnedFile.toString() + ')', context)
      assert.throws(() => readGate(file, 5, held), sabotage)
    }
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
    for (const workflow of ['macos.yml', 'windows.yml']) {
      const text = fs
        .readFileSync(path.join(repo, '.github/workflows', workflow), 'utf8')
        .split('  plugin-v2-review:')[1]
      assert.ok(text.includes('owner.mjs install "$REVIEW_CONTROL"'))
      assert.ok(!text.includes('pnpm install --frozen-lockfile'))
    }
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

test('final app source uses observed route HEAD and preserves the fixed published baseline', () => {
  assert.equal(appSourceFor('0.1.7', 'a'.repeat(40)), BASE017)
  assert.equal(appSourceFor('0.1.8', 'a'.repeat(40)), 'a'.repeat(40))
  assert.equal(appSourceFor('0.1.8', 'b'.repeat(40)), 'b'.repeat(40))
  for (const sha of [null, '', 'A'.repeat(40), 'a'.repeat(39)])
    assert.throws(() => appSourceFor('0.1.8', sha))
  assert.throws(() => appSourceFor('0.1.9', 'a'.repeat(40)))
})

test('source intent refuses historical final-app literals and altered baselines', () => {
  const plan = JSON.parse(fs.readFileSync(new URL('./source-plan.json', import.meta.url)))
  const env = {
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REPOSITORY: 'brocrew/brocrew',
    GITHUB_REF: 'refs/heads/gate/plugin-v2-mac-closed',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_SHA: 'a'.repeat(40),
  }
  assert.equal(hosted(plan, '0.1.8', env, 'darwin', 'arm64').appSource, env.GITHUB_SHA)
  assert.equal(hosted(plan, '0.1.7', env, 'darwin', 'arm64').appSource, BASE017)
  for (const appSources of [
    [
      { version: '0.1.7', commit: BASE017 },
      { version: '0.1.8', commit: BASE },
    ],
    [
      { version: '0.1.7', commit: 'b'.repeat(40) },
      { version: '0.1.8', source: 'observed-route-head' },
    ],
    [...plan.appSources, { version: '0.1.8', source: 'observed-route-head' }],
    [
      { version: '0.1.7', commit: BASE017 },
      { version: '0.1.8', source: 'observed-route-head', commit: env.GITHUB_SHA },
    ],
  ])
    assert.throws(() => hosted({ ...plan, appSources }, '0.1.8', env, 'darwin', 'arm64'))
  assert.throws(() => hosted({ ...plan, base: BASE017 }, '0.1.8', env, 'darwin', 'arm64'))
  assert.throws(() => hosted(plan, '0.1.8', { ...env, GITHUB_SHA: null }, 'darwin', 'arm64'))
})
