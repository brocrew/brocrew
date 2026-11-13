import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  publicFeedUnchanged,
  nativeRestartRecorded,
  fixturePermissions,
  permissionsKept,
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
test('native restart requires the choice in stdout and every successful drain step in stderr', () => {
  const choice = 'updates: restarting to install 0.2.24'
  const steps = [
    'close its sessions',
    'keep its unsent drafts',
    'drain its archive work',
    'close its database',
  ]
  const drain = ['BroCrew shut down in 226ms', ...steps].join('\n')
  nativeRestartRecorded(choice, drain, '0.2.24')
  for (const [stdout, stderr, version] of [
    ['', drain, '0.2.24'],
    [choice, '', '0.2.24'],
    [choice, drain, '0.2.25'],
    ['', `${choice}\n${drain}`, '0.2.24'],
    [`${choice}\n${drain}`, '', '0.2.24'],
    [choice, steps.join('\n'), '0.2.24'],
  ])
    assert.throws(() => nativeRestartRecorded(stdout, stderr, version))
  for (const step of steps) {
    assert.throws(() => nativeRestartRecorded(choice, drain.replace(step, ''), '0.2.24'))
    assert.throws(() =>
      nativeRestartRecorded(
        choice,
        `${drain}\nBroCrew failed to ${step}: fictional failure`,
        '0.2.24',
      ),
    )
  }
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
