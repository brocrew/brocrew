import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  recoveryOrder,
  registryPreserved,
  statePreserved,
  verifyCheckpoint,
  CHECKPOINT_LINE,
  READY_LINE,
  STATE_FILES,
} from '../lib/mac-update-test.mjs'

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
