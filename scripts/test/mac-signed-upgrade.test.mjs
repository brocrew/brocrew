import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  publicFeedUnchanged,
  fixturePermissions,
  permissionsKept,
  credentialPreserved,
  legacyCredentialsPreserved,
  registriesKept,
  assertThreeWorkspaceStates,
} from '../mac-signed-upgrade-contract.mjs'

const source = 'a'.repeat(40),
  tree = 'b'.repeat(40)
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
test('persistent fixture permissions include nested skill files and ignore transient database journals', () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-modes-'))
  try {
    mkdirSync(join(folder, 'skills'))
    writeFileSync(join(folder, 'skills', 'run.sh'), 'echo fictional\n', { mode: 0o700 })
    writeFileSync(join(folder, 'brobot2.sqlite'), 'fictional db', { mode: 0o600 })
    writeFileSync(join(folder, 'api-keys.json'), 'fictional key file', { mode: 0o600 })
    const before = fixturePermissions(folder)
    assert.ok(before.some((entry) => entry.path === 'api-keys.json' && entry.mode === 0o600))
    writeFileSync(join(folder, 'brobot2.sqlite-wal'), 'transient')
    permissionsKept(before, fixturePermissions(folder))
    chmodSync(join(folder, 'api-keys.json'), 0o400)
    assert.throws(() => permissionsKept(before, fixturePermissions(folder)), /api-keys.json/)
    chmodSync(join(folder, 'api-keys.json'), 0o600)
    chmodSync(join(folder, 'skills', 'run.sh'), 0o400)
    assert.throws(
      () => permissionsKept(before, fixturePermissions(folder)),
      /permissions changed: skills\/run.sh/,
    )
  } finally {
    rmSync(folder, { recursive: true })
  }
})

test('the released plain-file credential needs a positive baseline and exact bytes', () => {
  const file = { version: 1, keys: { codex: { key: 'sk-update-rehearsal-not-a-real-key', setAt: 12 } } }
  const before = JSON.stringify(file)
  const status = { provider: 'codex', set: true, inUse: true, setAt: 12 }
  assert.deepEqual(credentialPreserved(before, before, status), {
    store: 'api-keys.json',
    setAt: 12,
    unchanged: true,
  })
  credentialPreserved(before, before)
  for (const missing of [undefined, null, [], '', '{}', '{'])
    assert.throws(() => credentialPreserved(missing, missing, status))
  for (const edit of [
    (one) => delete one.keys.codex,
    (one) => (one.version = 2),
    (one) => (one.keys.codex.key = 'different-fictional-key'),
    (one) => (one.keys.codex.setAt = null),
    (one) => (one.cantRead = ['codex']),
  ]) {
    const changed = structuredClone(file)
    edit(changed)
    const text = JSON.stringify(changed)
    assert.throws(() => credentialPreserved(text, text, status))
    assert.throws(() => credentialPreserved(before, text, status))
  }
  assert.throws(() => credentialPreserved(before, undefined, status))
  assert.throws(() => credentialPreserved(before, `${before}\n`, status))
})

test('a preserved file must agree with the live API before it is called usable', () => {
  const before = JSON.stringify({
    version: 1,
    keys: { codex: { key: 'sk-update-rehearsal-not-a-real-key', setAt: 12 } },
  })
  const status = { provider: 'codex', set: true, inUse: true, setAt: 12 }
  for (const change of [
    { provider: 'claude' },
    { set: false },
    { inUse: false },
    { setAt: 13 },
    { setAt: undefined },
    { readState: 'unreadable' },
    { refusedForBilling: 'fictional refusal' },
  ])
    assert.throws(() => credentialPreserved(before, before, { ...status, ...change }))
  assert.throws(() => credentialPreserved(before, before, null))
  assert.throws(() => credentialPreserved(before, before, undefined))
})

test('legacy database rows stay exact even when the actual credential is in the plain file', () => {
  const rows = [{ provider: 'claude', sealed: 'fictional-legacy-row', updated_at: 11 }]
  legacyCredentialsPreserved([], [])
  legacyCredentialsPreserved(rows, structuredClone(rows))
  for (const after of [undefined, [], [{ ...rows[0], sealed: 'changed' }]])
    assert.throws(() => legacyCredentialsPreserved(rows, after))
  assert.throws(() => legacyCredentialsPreserved([], rows))
  assert.throws(() => credentialPreserved([], []))
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
    chmodSync(join(folder, names[0]), 0o400)
    assert.throws(() => permissionsKept(before, fixturePermissions(folder, names)))
  } finally {
    rmSync(folder, { recursive: true })
  }
})
