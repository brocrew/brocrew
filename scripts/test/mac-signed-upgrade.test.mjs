import { afterEach, beforeEach, test, vi } from 'vitest'
import { FICTIONAL_IDENTITY, FICTIONAL_SIGNING_ENV } from './fixtures/mac-signing-identity.mjs'
beforeEach(() => {
  for (const [name, value] of Object.entries(FICTIONAL_SIGNING_ENV)) vi.stubEnv(name, value)
})
afterEach(() => vi.unstubAllEnvs())
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BASELINE,
  candidateReceipt,
  artifactBinding,
  candidateImage,
  sealedFile,
  publicFeedUnchanged,
  signedIdentity,
  signedCheckpoint,
  fixturePermissions,
  permissionsKept,
  upgradeRequest,
  credentialPreserved,
  candidateNames,
  artifactMembers,
  registriesKept,
  assertThreeWorkspaceStates,
} from '../mac-signed-upgrade-contract.mjs'

const source = 'a'.repeat(40),
  tree = 'b'.repeat(40)
const expected = {
  source,
  tree,
  version: '0.2.12',
  runId: 42,
  artifactId: 43,
  artifactSha256: 'c'.repeat(64),
}
const checksum = Buffer.alloc(64, 7).toString('base64')
function receipt() {
  return {
    format: 'brocrew-mac-signed-candidate-v1',
    source,
    tree,
    version: '0.2.12',
    teamId: FICTIONAL_IDENTITY.teamId,
    files: candidateNames('0.2.12').map((name) => ({
      name,
      size: 10,
      sha256: 'd'.repeat(64),
      sha512: checksum,
    })),
  }
}
test('actual baseline is pinned independently of candidate run and source', () => {
  assert.equal(BASELINE.source, 'cfe64af3add0e9104cd5f4f940c23c9a758ca4b0')
  assert.equal(BASELINE.size, 354070741)
  assert.equal(BASELINE.sha256, '200220906296555bb8b09e3ce199600081a401295db2f102c9b21b69471ee7b1')
  assert.equal(candidateReceipt(receipt(), expected).version, '0.2.12')
  for (const changed of [
    { source: 'e'.repeat(40) },
    { tree: 'e'.repeat(40) },
    { version: '0.0.99' },
    { version: '0.2.11' },
    { teamId: 'OTHERTEAM' },
    { format: 'synthetic-rehearsal' },
  ])
    assert.throws(() => candidateReceipt({ ...receipt(), ...changed }, expected))
})
test('candidate receipt cannot omit, duplicate or redirect sealed assets', () => {
  const original = receipt()
  for (const files of [
    original.files.slice(1),
    [...original.files, original.files[0]],
    original.files.map((file, index) => (index === 0 ? { ...file, sha512: 'bad' } : file)),
    original.files.map((file, index) => (index === 0 ? { ...file, size: 0 } : file)),
    [...original.files, { name: '../outside', size: 10, sha256: 'd'.repeat(64) }],
  ])
    assert.throws(() => candidateReceipt({ ...original, files }, expected))
})
test('failed, substituted and expired candidate artifacts cannot supply runtime inputs', () => {
  const run = {
    id: 42,
    repository: { full_name: 'brocrew/brocrew' },
    head_sha: source,
    status: 'completed',
    conclusion: 'success',
  }
  const artifact = {
    id: 43,
    workflow_run: { id: 42, head_sha: source },
    digest: `sha256:${expected.artifactSha256}`,
    expired: false,
  }
  artifactBinding(run, artifact, expected)
  for (const changed of [
    { conclusion: 'failure' },
    { status: 'in_progress' },
    { head_sha: tree },
    { id: 99 },
    { repository: { full_name: 'side/repo' } },
  ])
    assert.throws(() => artifactBinding({ ...run, ...changed }, artifact, expected))
  for (const changed of [
    { id: 99 },
    { expired: true },
    { digest: `sha256:${'d'.repeat(64)}` },
    { workflow_run: { id: 99, head_sha: source } },
  ])
    assert.throws(() => artifactBinding(run, { ...artifact, ...changed }, expected))
})
test('downloaded candidate manifest must bind the DMG size and SHA512 to final bytes', () => {
  const manifest = `version: 0.2.12\nfiles:\n  - url: BroCrew-0.2.12-arm64.dmg\n    size: 10\n    sha512: ${checksum}\n`
  assert.equal(candidateImage(manifest, receipt()).url, 'BroCrew-0.2.12-arm64.dmg')
  assert.throws(() => candidateImage(manifest.replace('size: 10', 'size: 11'), receipt()))
  assert.throws(() =>
    candidateImage(manifest.replace(checksum, Buffer.alloc(64, 1).toString('base64')), receipt()),
  )
})
test('the installed public feed remains public rather than rewritten to a sandbox', () => {
  publicFeedUnchanged(
    "owner: brocrew\nrepo: brocrew\nprovider: github\nupdaterCacheDirName: '@brobot2desktop-updater'\n",
  )
  for (const text of [
    'provider: generic\nurl: http://127.0.0.1/\n',
    'owner: brocrew\nrepo: sandbox\nprovider: github\n',
    'owner: brocrew\nrepo: brocrew\nprovider: github\nprivate: true\n',
  ])
    assert.throws(() => publicFeedUnchanged(text))
})
test('candidate signature requires the actual team, Developer ID, runtime and timestamp', () => {
  const identity = `Authority=${FICTIONAL_IDENTITY.authority}\nTeamIdentifier=${FICTIONAL_IDENTITY.teamId}\nflags=0x10000(runtime)\nTimestamp=Nov 8, 2026\n`
  signedIdentity(identity)
  for (const remove of [
    'Authority=Developer ID Application:',
    `TeamIdentifier=${FICTIONAL_IDENTITY.teamId}`,
    'flags=0x10000(runtime)',
    'Timestamp=',
  ])
    assert.throws(() => signedIdentity(identity.replace(remove, 'missing')))
  assert.throws(() => signedIdentity('Signature=adhoc\nTeamIdentifier=not set\n'))
})
test('candidate checkpoint cannot inherit synthetic or other-source identity', () => {
  for (const madeBy of [
    { appVersion: '0.0.99', build: source },
    { appVersion: '0.2.12', build: tree },
  ])
    assert.throws(() => signedCheckpoint({ madeBy }, {}, expected), /identity differs/)
})
test('sealed bytes are checked from disk; changed bytes, sizes and linked files fail', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-seal-'))
  try {
    const file = join(folder, 'app.dmg'),
      bytes = Buffer.from('real sealed candidate')
    const seal = {
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sha512: createHash('sha512').update(bytes).digest('base64'),
    }
    writeFileSync(file, bytes)
    await sealedFile(file, seal)
    writeFileSync(file, Buffer.from('fake sealed candidate'))
    await assert.rejects(sealedFile(file, seal), /SHA-256 differs/)
    await assert.rejects(sealedFile(file, { ...seal, size: 1 }), /size\/type differs/)
    symlinkSync(file, join(folder, 'linked.dmg'))
    await assert.rejects(sealedFile(join(folder, 'linked.dmg'), seal), /size\/type differs/)
  } finally {
    rmSync(folder, { recursive: true })
  }
})
test('persistent fixture permissions include nested skill files and ignore transient database journals', () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-modes-'))
  try {
    mkdirSync(join(folder, 'skills'))
    writeFileSync(join(folder, 'skills', 'run.sh'), 'echo fictional\n', { mode: 0o700 })
    writeFileSync(join(folder, 'brobot2.sqlite'), 'fictional db', { mode: 0o600 })
    const before = fixturePermissions(folder)
    writeFileSync(join(folder, 'brobot2.sqlite-wal'), 'transient')
    permissionsKept(before, fixturePermissions(folder))
    chmodSync(join(folder, 'skills', 'run.sh'), 0o600)
    assert.throws(
      () => permissionsKept(before, fixturePermissions(folder)),
      /permissions changed: skills\/run.sh/,
    )
  } finally {
    rmSync(folder, { recursive: true })
  }
})

test('guided input requires immutable candidate pins and rejects automatic prototypes', () => {
  const build = { ...expected, releaseId: 44 }
  upgradeRequest({ mode: 'guided', to: build })
  for (const request of [
    { mode: 'automatic', from: build, to: { ...build, version: '0.2.13' } },
    { mode: 'guided', from: build, to: build },
    { mode: 'guided', to: { ...build, releaseId: undefined } },
    { mode: 'guided', to: { ...build, artifactSha256: undefined } },
    { mode: 'guided', to: { ...build, version: '0.2.11' } },
  ])
    assert.throws(() => upgradeRequest(request))
})
test('the encrypted credential sentinel cannot disappear or be replaced while other data survives', () => {
  const rows = [{ provider: 'codex', sealed: 'fictional-ciphertext', updated_at: 12 }]
  credentialPreserved(rows, structuredClone(rows))
  assert.throws(() => credentialPreserved([], []))
  assert.throws(() => credentialPreserved(rows, []))
  assert.throws(() => credentialPreserved(rows, [{ ...rows[0], sealed: 'rewritten-ciphertext' }]))
})

test('candidate transport archive has exactly five final updater files plus its inner receipt', () => {
  const files = [...candidateNames('0.2.12'), 'mac-signed-candidate.json']
  artifactMembers(files.join('\n'), '0.2.12')
  for (const changed of [
    files.slice(1),
    [...files, files[0]],
    [...files, '../outside'],
    [...files, 'source.js'],
  ])
    assert.throws(() => artifactMembers(changed.join('\n'), '0.2.12'))
})

test('all three workspace registry entries survive, allowing only their last-opened timestamps to change', () => {
  const paths = ['/fixture/Default', '/fixture/WorkspaceA', '/fixture/WorkspaceB']
  const before = {
    version: 1,
    workspaces: paths.map((path, index) => ({
      path,
      name: path.split('/').at(-1),
      lastOpenedAt: index,
    })),
  }
  const after = structuredClone(before)
  after.workspaces.reverse().forEach((row) => (row.lastOpenedAt = 100))
  registriesKept(before, after, paths)
  for (const edit of [
    (book) => book.workspaces.pop(),
    (book) => (book.workspaces[0].name = 'changed'),
    (book) => book.workspaces.push({ ...book.workspaces[0] }),
  ]) {
    const changed = structuredClone(after)
    edit(changed)
    assert.throws(() => registriesKept(before, changed, paths))
  }
})

test('three running workspaces require distinct paths/PIDs and the exact shared executable/version/source', () => {
  const app = '/Applications/BroCrew.app'
  const expected = ['Default', 'WorkspaceA', 'WorkspaceB'].map((name) => ({
    name,
    data: `/fixture/${name}`,
  }))
  const records = expected.map((one, index) => ({
    name: one.name,
    path: one.data,
    pid: index + 100,
    command: `${app}/Contents/MacOS/BroCrew --user-data-dir=${one.data}`,
    source,
    dirty: false,
    version: '0.2.12',
  }))
  assertThreeWorkspaceStates(records, expected, app, '0.2.12', source)
  for (const change of [
    (rows) => rows.pop(),
    (rows) => (rows[2].pid = rows[0].pid),
    (rows) => (rows[2].path = rows[0].path),
    (rows) => (rows[2].version = '0.2.11'),
    (rows) => (rows[2].command = '/other/BroCrew'),
    (rows) => (rows[2].source = tree),
    (rows) => (rows[2].dirty = true),
    (rows) => delete rows[2].dirty,
  ]) {
    const bad = structuredClone(records)
    change(bad)
    assert.throws(() => assertThreeWorkspaceStates(bad, expected, app, '0.2.12', source))
  }
})

test('pre-existing native transcript permissions must survive even when content can append', () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-native-modes-'))
  try {
    mkdirSync(join(folder, 'sessions'))
    writeFileSync(join(folder, 'sessions', 'fictional.jsonl'), 'fictional native bytes', {
      mode: 0o600,
    })
    const names = ['sessions/fictional.jsonl']
    const before = fixturePermissions(folder, names)
    writeFileSync(join(folder, names[0]), 'fictional native bytes plus a new turn')
    permissionsKept(before, fixturePermissions(folder, names))
    chmodSync(join(folder, names[0]), 0o644)
    assert.throws(() => permissionsKept(before, fixturePermissions(folder, names)))
  } finally {
    rmSync(folder, { recursive: true })
  }
})
