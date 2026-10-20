import { test } from 'vitest'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { finished } from 'node:stream/promises'
import {
  assertHostedMac,
  assertOwnedProcess,
  dataPreserved,
  diskImageFrom,
  hash,
  mountedImageOf,
  nativeTranscriptsPresent,
  packageOfAsar,
  packagedRegistryFile,
  recoveryOrder,
  registryPreserved,
  statePreserved,
  startLocalModelTurn,
  MAC_KEYCHAIN_REFUSAL,
  isMacKeychainRefusal,
  withMacKeychainRecovery,
  localModelTurnFacts,
  verifyCheckpoint,
  CHECKPOINT_LINE,
  READY_LINE,
  STATE_FILES,
} from '../lib/mac-update-test.mjs'
import { rememberWorkspace, workspaceListFile } from '../../apps/desktop/src/main/workspaces.ts'

import { SCRIPTED_MODEL, codexConfigFor } from '../lib/update-rehearsal-app.mjs'

const runner = {
  GITHUB_ACTIONS: 'true',
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_REPOSITORY: 'brocrew/brocrew',
  GITHUB_RUN_ID: '123',
}
test('only the named hosted arm64 Mac runner is eligible', () => {
  assert.doesNotThrow(() => assertHostedMac(runner, 'darwin', 'arm64'))
  assert.doesNotThrow(() =>
    assertHostedMac(
      { ...runner, GITHUB_REPOSITORY: 'brocrew/brobot-update-rehearsal' },
      'darwin',
      'arm64',
    ),
  )
  for (const env of [
    {},
    { ...runner, RUNNER_ENVIRONMENT: 'self-hosted' },
    { ...runner, GITHUB_REPOSITORY: 'other/repo' },
  ])
    assert.throws(() => assertHostedMac(env, 'darwin', 'arm64'))
  assert.throws(() => assertHostedMac(runner, 'linux', 'arm64'))
  assert.throws(() => assertHostedMac(runner, 'darwin', 'x64'))
})

const digest = Buffer.alloc(64, 1).toString('base64')
const feed = (name = 'BroCrew-0.0.99-arm64.dmg') =>
  `version: 0.0.99\nfiles:\n  - url: ${name}\n    sha512: ${digest}\n    size: 123\n`
test('selects the DMG hash and byte count from the matching feed', () => {
  assert.deepEqual(diskImageFrom(feed(), '0.0.99'), {
    version: '0.0.99',
    url: 'BroCrew-0.0.99-arm64.dmg',
    sha512: digest,
    size: 123,
  })
})
for (const [title, content] of [
  ['wrong release', feed().replace('version: 0.0.99', 'version: 0.0.98')],
  ['path traversal', feed('../bad.dmg')],
  ['query', feed('bad.dmg?other')],
  ['missing bytes', feed().replace('    size: 123\n', '')],
  ['missing hash', feed().replace(digest, 'broken')],
  ['two disk images', feed() + `  - url: other.dmg\n    sha512: ${digest}\n    size: 123\n`],
])
  test(`refuses ${title}`, () => assert.throws(() => diskImageFrom(content, '0.0.99')))

test('mount evidence names the actual downloaded image rather than another volume', () => {
  const image = '/Users/runner/Downloads/BroCrew.dmg'
  const own = {
    'image-path': image,
    'system-entities': [{ 'mount-point': '/Volumes/BroCrew 0.0.99' }],
  }
  assert.equal(mountedImageOf({ images: [] }, image), null)
  assert.equal(
    mountedImageOf({ images: [{ ...own, 'image-path': '/tmp/other.dmg' }] }, image),
    null,
  )
  assert.deepEqual(mountedImageOf({ images: [own] }, image), {
    image,
    mount: '/Volumes/BroCrew 0.0.99',
  })
  assert.throws(() => mountedImageOf({ images: [own, own] }, image))
  assert.throws(() => mountedImageOf({ images: [{ ...own, 'system-entities': [] }] }, image))
})

test('never signals a reused PID, changed command, hidden launch or unrelated app', () => {
  const app = '/Applications/BroCrew.app'
  const process = {
    pid: 123,
    started: 'Wed Oct 7 10:00:00 2026',
    command: `${app}/Contents/MacOS/BroCrew --remote-debugging-address=127.0.0.1 --remote-debugging-port=9339`,
  }
  assert.doesNotThrow(() => assertOwnedProcess(process, { ...process }, app, 9339))
  for (const current of [
    null,
    { ...process, pid: 124 },
    { ...process, started: 'later' },
    { ...process, command: process.command + ' --brobot-hidden' },
  ])
    assert.throws(() => assertOwnedProcess(process, current, app, 9339))
  assert.throws(() => assertOwnedProcess(process, process, '/Applications/Other.app', 9339))
})

test('requires checked-copy evidence before READY and no duplicate on second start', () => {
  assert.deepEqual(recoveryOrder(`${CHECKPOINT_LINE}\n${READY_LINE}\n`, { checkpoint: true }), {
    readyLine: 1,
    checkedCopyLines: [0],
  })
  assert.doesNotThrow(() => recoveryOrder(READY_LINE, { checkpoint: false }))
  for (const log of [
    '',
    `${READY_LINE}\n${CHECKPOINT_LINE}`,
    `${CHECKPOINT_LINE}\n${CHECKPOINT_LINE}\n${READY_LINE}`,
    `BroCrew did not start.\n${READY_LINE}`,
    `diagnostic: expected ${CHECKPOINT_LINE}\ndiagnostic: expected ${READY_LINE}`,
    `${CHECKPOINT_LINE}\n"${READY_LINE}"`,
    `${CHECKPOINT_LINE}\n${READY_LINE}\n${READY_LINE}`,
  ])
    assert.throws(() => recoveryOrder(log, { checkpoint: true }))
  assert.throws(() => recoveryOrder(`${CHECKPOINT_LINE}\n${READY_LINE}`, { checkpoint: false }))
})

const baseline = () => ({
  provider_session: [
    { id: 's1', cwd: '/fictional', updated_at: 1, status: 'ended' },
    { id: 's2', cwd: '/fictional', updated_at: 1, status: 'ended' },
  ],
  events: [{ id: 'e1', session_id: 's1', payload: '{"text":"café ☕"}' }],
  migrations: [{ id: 1, hash: 'lineage', created_at: 42 }],
})
test('preserves full payloads with explicit startup metadata allowance', () => {
  const before = baseline(),
    after = structuredClone(before)
  after.provider_session[0].updated_at++
  after.provider_session[0].status = 'idle'
  assert.doesNotThrow(() => dataPreserved(before, after))
  for (const mutate of [
    (s) => {
      s.events[0].payload = '{"text":"café ☕","changed":true}'
    },
    (s) => {
      s.provider_session[0].cwd = '/other'
    },
    (s) => {
      s.events = []
    },
    (s) => {
      s.migrations = []
    },
  ]) {
    const damaged = structuredClone(before)
    mutate(damaged)
    assert.throws(() => dataPreserved(before, damaged))
  }
  assert.throws(() => dataPreserved({ ...before, events: [] }, after))
  const appended = structuredClone(before)
  appended.events.push({ id: 'e2', payload: 'new completion' })
  assert.throws(() => dataPreserved(before, appended))
  assert.doesNotThrow(() => dataPreserved(before, appended, { allowAppended: true }))
  const missing = structuredClone(before)
  missing.events = []
  assert.throws(() => dataPreserved(before, missing, { allowAppended: true }))
})

test('keeps both present and absent workspace state files', () => {
  const before = { 'drafts.json': Buffer.from('fictional draft') }
  assert.doesNotThrow(() => statePreserved(before, { ...before }))
  assert.throws(() => statePreserved(before, {}))
  assert.throws(() => statePreserved(before, { ...before, 'workspaces.json': Buffer.from('{}') }))
  assert.throws(() => statePreserved(before, { 'drafts.json': Buffer.from('changed') }))
})

test('requires the native log of each recorded conversation rather than unrelated JSONL fixtures', () => {
  const snapshot = {
    provider_session: [
      {
        id: 'first',
        external_ref: JSON.stringify({ provider: 'codex', sessionId: 'native-first' }),
      },
      {
        id: 'second',
        external_ref: JSON.stringify({ provider: 'codex', sessionId: 'native-second' }),
      },
    ],
  }
  const files = {
    'sessions/rollout-native-first.jsonl': {},
    'sessions/rollout-native-second.jsonl': {},
  }
  assert.doesNotThrow(() => nativeTranscriptsPresent(snapshot, files))
  assert.throws(() =>
    nativeTranscriptsPresent(snapshot, {
      'sessions/rollout-native-first.jsonl': {},
      '.tmp/plugin/fixture.jsonl': {},
    }),
  )
  assert.throws(() =>
    nativeTranscriptsPresent(snapshot, { ...files, 'other/rollout-native-first.jsonl': {} }),
  )
})

test('reads the registry a normal packaged launch writes on a fresh Mac', () => {
  const appData = mkdtempSync(join(tmpdir(), 'fictional-mac-registry-'))
  try {
    const dataRoot = join(appData, '@brobot2')
    const userData = join(dataRoot, 'desktop')
    const appRegistry = workspaceListFile({ appData, userData, hidden: false, packaged: true })
    rememberWorkspace(appRegistry, userData, 10)
    const rehearsalRegistry = packagedRegistryFile(dataRoot)
    assert.equal(rehearsalRegistry, appRegistry)
    assert.equal(existsSync(join(dataRoot, 'workspaces.json')), false)
    const before = JSON.parse(readFileSync(rehearsalRegistry, 'utf8'))
    rememberWorkspace(appRegistry, userData, 11)
    registryPreserved(before, JSON.parse(readFileSync(rehearsalRegistry, 'utf8')), userData)
  } finally {
    rmSync(appData, { recursive: true, force: true })
  }
})

test('keeps normal-launch registry rows and unknown fields allowing only the current opening time', () => {
  const before = {
    version: 1,
    workspaces: [
      { path: '/current', lastOpenedAt: 10 },
      { path: '/fictional-other', lastOpenedAt: 2, extra: { text: 'café ☕' } },
    ],
  }
  const after = structuredClone(before)
  after.workspaces[0].lastOpenedAt = 11
  after.workspaces.reverse()
  assert.doesNotThrow(() => registryPreserved(before, after, '/current'))
  for (const mutate of [
    (b) => {
      b.workspaces.pop()
    },
    (b) => {
      b.workspaces[1].extra.text = 'changed'
    },
    (b) => {
      b.workspaces[1].lastOpenedAt++
    },
    (b) => {
      b.workspaces[0].lastOpenedAt = 9
    },
    (b) => {
      b.version = 2
    },
    (b) => {
      b.workspaces.push(b.workspaces[0])
    },
  ]) {
    const damaged = structuredClone(before)
    mutate(damaged)
    assert.throws(() => registryPreserved(before, damaged, '/current'))
  }
})

function checkpoint() {
  const id = '12345678-1234-4234-8234-123456789abc',
    workspaceId = '87654321-4321-4321-8321-cba987654321'
  const files = {
    'database.sqlite': Buffer.from('a checked synthetic database'),
    'drafts.json': Buffer.from('{"drafts":[{"text":"unsent café"}]}'),
    'workspace.json': Buffer.from('{"name":"Fictional lab"}'),
  }
  const state = { 'drafts.json': files['drafts.json'], 'workspace.json': files['workspace.json'] }
  const migrations = [{ createdAt: 42, hash: 'lineage' }]
  const entry = (bytes) => ({ bytes: bytes.length, sha256: hash(bytes) })
  return {
    files,
    expected: { id, workspaceId, source: 'abc123', migrations, state },
    manifest: {
      format: 'brobot-checkpoint',
      version: 1,
      id,
      workspaceId,
      createdAt: '2026-10-07T10:00:00.000Z',
      reason: 'first-start-of-release',
      madeBy: { appVersion: '0.0.99', build: 'abc123' },
      database: { file: 'database.sqlite', ...entry(files['database.sqlite']), migrations },
      files: STATE_FILES.map((name) =>
        files[name] ? { name, present: true, ...entry(files[name]) } : { name, present: false },
      ),
    },
  }
}
test('verifies a present active theme and rejects missing or changed theme bytes', () => {
  const { manifest, files, expected } = checkpoint()
  const bytes = Buffer.from('{"theme":"classic"}')
  files['active-theme.json'] = bytes
  expected.state['active-theme.json'] = bytes
  const theme = manifest.files.find((file) => file.name === 'active-theme.json')
  Object.assign(theme, { present: true, bytes: bytes.length, sha256: hash(bytes) })
  assert.doesNotThrow(() => verifyCheckpoint(manifest, files, expected))
  assert.throws(() =>
    verifyCheckpoint(manifest, { ...files, 'active-theme.json': undefined }, expected),
  )
  assert.throws(() =>
    verifyCheckpoint(manifest, { ...files, 'active-theme.json': Buffer.from('changed') }, expected),
  )
  assert.throws(() =>
    verifyCheckpoint(manifest, files, {
      ...expected,
      state: { ...expected.state, 'active-theme.json': undefined },
    }),
  )
})

test('verifies every manifest byte count, hash, lineage and fixture state', () => {
  const { manifest, files, expected } = checkpoint()
  assert.equal(verifyCheckpoint(manifest, files, expected).id, expected.id)
  for (const mutate of [
    (m) => {
      m.version = 2
    },
    (m) => {
      m.id = '../elsewhere'
    },
    (m) => {
      m.madeBy.appVersion = '0.0.98'
    },
    (m) => {
      m.database.bytes++
    },
    (m) => {
      m.database.migrations = []
    },
    (m) => {
      m.files.pop()
    },
    (m) => {
      m.files.find((file) => file.name === 'drafts.json').sha256 = 'wrong'
    },
    (m) => {
      m.files[0].name = '../secret'
    },
    (m) => {
      m.files[1] = m.files[0]
    },
  ]) {
    const damaged = structuredClone(manifest)
    mutate(damaged)
    assert.throws(() => verifyCheckpoint(damaged, files, expected))
  }
  assert.throws(() =>
    verifyCheckpoint(manifest, { ...files, 'database.sqlite': Buffer.from('damaged') }, expected),
  )
  assert.throws(() => verifyCheckpoint(manifest, files, { ...expected, workspaceId: 'other' }))
})

test('the package an app archive carries is read as @electron/asar writes it', async () => {
  const desktop = createRequire(resolve('apps/desktop/package.json'))
  const builder = createRequire(desktop.resolve('electron-builder'))
  const asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar')
  const root = mkdtempSync(join(tmpdir(), 'brobot-asar-'))
  try {
    const app = join(root, 'app')
    mkdirSync(join(app, 'out'), { recursive: true })
    writeFileSync(join(app, 'out', 'main.js'), 'console.log("café")\n'.repeat(500))
    const manifest = { name: '@brobot2/desktop', version: '0.0.99', rehearsalMarker: 'b-café' }
    writeFileSync(join(app, 'package.json'), JSON.stringify(manifest))
    // @electron/asar 3.4 resolves with its write stream once it has ended it, before the last
    // bytes are written; the archive is read once they are.
    await finished(await asar.createPackage(app, join(root, 'app.asar')))
    assert.deepEqual(packageOfAsar(join(root, 'app.asar')), manifest)
    writeFileSync(join(root, 'cut.asar'), Buffer.alloc(6))
    assert.throws(() => packageOfAsar(join(root, 'cut.asar')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accepts cleanup progress but refuses a changed retention choice or a missing file', () => {
  const name = 'transcript-retention.json'
  const bytes = (value) => Buffer.from(JSON.stringify(value))
  const before = { period: 90, checkedAt: 10, cleared: [] }
  const after = { ...before, checkedAt: 20, scanAfter: '2026/entry' }
  const was = { [name]: bytes(before) }
  assert.doesNotThrow(() => statePreserved(was, { [name]: bytes(after) }))
  for (const damaged of [
    { ...after, period: 365 },
    { ...after, checkedAt: -1 },
    { ...after, cleared: [{}] },
  ]) {
    assert.throws(() => statePreserved(was, { [name]: bytes(damaged) }), /State bytes changed/)
  }
  assert.throws(() => statePreserved(was, {}), /State presence changed/)
  assert.throws(() => statePreserved(was, { [name]: Buffer.from('{') }), /State bytes changed/)
  for (const other of ['workspace.json', 'drafts.json']) {
    assert.throws(
      () =>
        statePreserved(
          { ...was, [other]: Buffer.from('{"name":"Fictional"}') },
          { [name]: bytes(after), [other]: Buffer.from('{ "name": "Fictional" }') },
        ),
      /State bytes changed/,
    )
  }
})

test('the first fixture turn uses the provider and model configured for the local server', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const calls = []
  const runtime = {
    createSession: async (input) => {
      calls.push(['create', input])
      return {
        sessionId: 'fictional-session',
        provider: input.provider,
        settings: { model: input.model },
      }
    },
    send: async (input) => calls.push(['send', input]),
  }
  const cdp = { evaluate: (body) => new AsyncFunction('window', body)({ api: { runtime } }) }
  assert.equal(await startLocalModelTurn(cdp, 'A fictional first turn'), 'fictional-session')
  assert.deepEqual(calls, [
    ['create', { provider: 'codex', model: SCRIPTED_MODEL, approvalMode: 'auto' }],
    ['send', { sessionId: 'fictional-session', text: 'A fictional first turn' }],
  ])
  assert.equal(/^model = "([^"]+)"/m.exec(codexConfigFor(47124))?.[1], calls[0][1].model)
  assert.match(codexConfigFor(47124), /base_url = "http:\/\/127\.0\.0\.1:47124\/v1"/)
})

test('a wrong provider, model or missing conversation id cannot receive the fixture message', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  for (const created of [
    { sessionId: 'fictional-session', provider: 'claude', settings: { model: SCRIPTED_MODEL } },
    {
      sessionId: 'fictional-session',
      provider: 'codex',
      settings: { model: 'fictional-other-model' },
    },
    { provider: 'codex', settings: { model: SCRIPTED_MODEL } },
  ]) {
    let sent = false
    const runtime = {
      createSession: async () => created,
      send: async () => {
        sent = true
      },
    }
    const cdp = { evaluate: (body) => new AsyncFunction('window', body)({ api: { runtime } }) }
    await assert.rejects(startLocalModelTurn(cdp, 'A fictional first turn'))
    assert.equal(sent, false)
  }
})

test('fixture progress locates create, send and their refusals without claiming a response', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  for (const failAt of [null, 'create', 'send']) {
    const steps = []
    const runtime = {
      createSession: async (input) => {
        if (failAt === 'create') throw new Error('fixture-create-refused')
        return {
          sessionId: 'fictional-session',
          provider: input.provider,
          settings: { model: input.model },
        }
      },
      send: async () => {
        if (failAt === 'send') throw new Error('fixture-send-refused')
      },
    }
    const cdp = { evaluate: (body) => new AsyncFunction('window', body)({ api: { runtime } }) }
    const run = startLocalModelTurn(cdp, 'Fictional turn', {
      record: (phase, facts) => steps.push({ phase, ...facts }),
    })
    if (failAt) await assert.rejects(run)
    else assert.equal(await run, 'fictional-session')
    const expected = ['conversation-create-requested']
    if (failAt !== 'create') expected.push('conversation-created', 'turn-send-requested')
    if (!failAt) expected.push('turn-sent')
    assert.deepEqual(
      steps.map((one) => one.phase),
      expected,
    )
    assert.equal(
      steps.some((one) => one.phase === 'response-recorded'),
      false,
    )
  }
})

test('turn timeout facts keep session and failure states while discarding message bodies', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const history = {
    entries: [
      { event: { type: 'session', state: 'started', ref: { private: 'discard-session-detail' } } },
      { event: { type: 'status', state: 'working' } },
      { event: { type: 'error', message: 'discard-error-detail' } },
      { event: { type: 'turn', state: 'failed' } },
      { event: { type: 'status', state: 'idle' } },
    ],
  }
  const runtime = { latestHistory: async () => history }
  const cdp = { evaluate: (body) => new AsyncFunction('window', body)({ api: { runtime } }) }
  const facts = await localModelTurnFacts(cdp, 'fictional-session', 'resp_fictional_1')
  assert.equal(facts.responseRecorded, false)
  assert.equal(facts.providerSessionStarted, true)
  assert.equal(facts.hasError, true)
  assert.deepEqual(facts.turnCounts, { completed: 0, failed: 1, interrupted: 0 })
  assert.deepEqual(facts.statusCounts, {
    working: 1,
    idle: 1,
    waiting_permission: 0,
    ended: 0,
    errored: 0,
  })
  assert.equal(facts.eventCounts.status, 2)
  assert.equal(JSON.stringify(facts).includes('discard-'), false)
  history.entries.push({ event: { type: 'assistant_message', text: 'Fixture resp_fictional_1' } })
  assert.equal(
    (await localModelTurnFacts(cdp, 'fictional-session', 'resp_fictional_1')).responseRecorded,
    true,
  )
  assert.equal(
    (await localModelTurnFacts(cdp, 'fictional-session', 'resp_other')).responseRecorded,
    false,
  )
})

const keychainFailure = (said = MAC_KEYCHAIN_REFUSAL) =>
  Object.assign(new Error('fixture refusal'), { refusal: { said } })
const unreadableKey = { providerMatches: true, set: true, inUse: false, unreadable: true }

test('only the exact plain Mac Keychain refusal qualifies, including its fixed IPC envelope', () => {
  assert.equal(isMacKeychainRefusal(keychainFailure()), true)
  assert.equal(
    isMacKeychainRefusal(
      keychainFailure(
        `Error invoking remote method 'runtime:command': Error: ${MAC_KEYCHAIN_REFUSAL}`,
      ),
    ),
    true,
  )
  for (const said of [
    MAC_KEYCHAIN_REFUSAL.replace('Codex', 'Claude'),
    MAC_KEYCHAIN_REFUSAL.replace(
      'macOS may be waiting for permission to read its saved key. ',
      'It was saved with a Keychain entry this version of BroCrew doesn’t have. ',
    ),
    MAC_KEYCHAIN_REFUSAL.replace('can’t', "can't"),
    MAC_KEYCHAIN_REFUSAL + ' Extra words.',
    'Prefix: ' + MAC_KEYCHAIN_REFUSAL,
    'The key was refused for another reason.',
    undefined,
  ])
    assert.equal(isMacKeychainRefusal({ refusal: { said } }), false)
  assert.equal(isMacKeychainRefusal(new Error(MAC_KEYCHAIN_REFUSAL)), false)
})

function keyRecoveryFixture({
  platform = 'darwin',
  error = keychainFailure(),
  status = unreadableKey,
  traffic = false,
  retryError,
  saveError,
} = {}) {
  const trace = [],
    limits = []
  let attempts = 0,
    posts = 0
  const options = {
    platform,
    attempt: async () => {
      trace.push('attempt')
      attempts++
      if (attempts === 1) {
        if (traffic) posts++
        if (error) throw error
      }
      if (attempts === 2 && retryError) throw retryError
      return 'fixture-response'
    },
    keyStatus: async () => {
      trace.push('status')
      return status
    },
    posts: () => posts,
    stop: async () => {
      trace.push('stop')
    },
    forgetEntry: async () => {
      trace.push('forget-entry')
    },
    start: async () => {
      trace.push('start')
    },
    save: async () => {
      trace.push('save')
      if (saveError) throw saveError
    },
    recordLimit: (said) => {
      limits.push(said)
      trace.push('limit')
    },
  }
  return { options, trace, limits, attempts: () => attempts }
}

test('a verified Mac refusal records the exact limit and retries after a fresh entry and saved key', async () => {
  const fixture = keyRecoveryFixture()
  assert.equal(await withMacKeychainRecovery(fixture.options), 'fixture-response')
  assert.deepEqual(fixture.trace, [
    'attempt',
    'status',
    'limit',
    'stop',
    'forget-entry',
    'start',
    'save',
    'attempt',
  ])
  assert.deepEqual(fixture.limits, [MAC_KEYCHAIN_REFUSAL])
  assert.equal(fixture.attempts(), 2)
})

test('other refusals, Windows, usable keys and model traffic never trigger recovery', async () => {
  for (const changes of [
    { error: keychainFailure('Another refusal') },
    { platform: 'win32' },
    { status: { ...unreadableKey, inUse: true } },
    { status: { ...unreadableKey, set: false } },
    { status: { ...unreadableKey, unreadable: false } },
    { status: { ...unreadableKey, providerMatches: false } },
    { traffic: true },
  ]) {
    const fixture = keyRecoveryFixture(changes)
    await assert.rejects(withMacKeychainRecovery(fixture.options))
    assert.deepEqual(fixture.limits, [])
    assert.equal(fixture.trace.includes('forget-entry'), false)
    assert.equal(fixture.attempts(), 1)
  }
})

test('a failed fresh save or failed retry still fails, without a second recovery', async () => {
  for (const changes of [
    { retryError: keychainFailure() },
    { retryError: keychainFailure('A different retry refusal') },
    { saveError: new Error('fictional fresh save refused') },
  ]) {
    const fixture = keyRecoveryFixture(changes)
    await assert.rejects(withMacKeychainRecovery(fixture.options))
    assert.equal(fixture.trace.filter((one) => one === 'forget-entry').length, 1)
    assert.equal(fixture.limits.length, 1)
    assert.equal(fixture.attempts(), changes.saveError ? 1 : 2)
  }
})

test('a normal fixture turn does not touch the sealing entry or claim a limit', async () => {
  const fixture = keyRecoveryFixture({ error: null })
  assert.equal(await withMacKeychainRecovery(fixture.options), 'fixture-response')
  assert.deepEqual(fixture.trace, ['attempt'])
  assert.deepEqual(fixture.limits, [])
})

test('the Mac create path keeps answered and thrown app refusals structured for narrow recovery', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  for (const rejected of [false, true]) {
    let sent = false
    const runtime = {
      createSession: async (input) => {
        assert.equal(input.answerARefusal, true)
        if (rejected) throw new Error(MAC_KEYCHAIN_REFUSAL)
        return { refused: { reason: 'sign-in', said: MAC_KEYCHAIN_REFUSAL } }
      },
      send: async () => {
        sent = true
      },
    }
    const cdp = { evaluate: (body) => new AsyncFunction('window', body)({ api: { runtime } }) }
    await assert.rejects(
      startLocalModelTurn(cdp, 'fictional turn', { answerARefusal: true }),
      (error) => isMacKeychainRefusal(error),
    )
    assert.equal(sent, false)
  }
})

test('after a refused resume, the same conversation is resumed and sent once after recovery', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  let available = false,
    sends = 0,
    resumes = 0
  const runtime = {
    createSession: async () => {
      throw new Error('must resume the existing conversation')
    },
    resume: async ({ sessionId }) => {
      assert.equal(sessionId, 'fictional-existing-session')
      resumes++
      if (!available)
        throw new Error(
          `Error invoking remote method 'runtime:command': Error: ${MAC_KEYCHAIN_REFUSAL}`,
        )
    },
    send: async ({ sessionId }) => {
      assert.equal(sessionId, 'fictional-existing-session')
      sends++
    },
  }
  const cdp = { evaluate: (body) => new AsyncFunction('window', body)({ api: { runtime } }) }
  const fixture = keyRecoveryFixture()
  fixture.options.attempt = () =>
    startLocalModelTurn(cdp, 'fictional resumed turn', { sessionId: 'fictional-existing-session' })
  fixture.options.save = async () => {
    available = true
  }
  assert.equal(await withMacKeychainRecovery(fixture.options), 'fictional-existing-session')
  assert.equal(resumes, 2)
  assert.equal(sends, 1)
})
