import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { clearUpdateStaging } from '../src/main/guided-update'
import { makeCheckpoint } from '../src/main/recovery/checkpoint'
import { restore } from '../src/main/recovery/restore'
import { APP_STATE_FILES, NOT_STATE } from '../src/main/recovery/state-files'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let root: string
let userData: string
let database: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brocrew-update-recovery-'))
  userData = join(root, 'data')
  mkdirSync(userData)
  database = join(userData, 'brobot2.sqlite')
  const db = openDatabase(database)
  try {
    applyMigrations(db, migrations)
    db.exec(
      "CREATE TABLE fictional_notes (body TEXT); INSERT INTO fictional_notes VALUES ('Brook keeps this note')",
    )
  } finally {
    db.close()
  }
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const checkpoint = () =>
  makeCheckpoint({
    userData,
    ownership: 'sole',
    appVersion: '1.0.0',
    build: 'fictional',
    reason: 'first-start-of-release',
    log: () => {},
  })

it('excludes private staging from an actual recovery copy', async () => {
  const staging = join(userData, 'updates', 'staging')
  mkdirSync(staging, { recursive: true })
  const partial = join(staging, 'Fern.partial')
  writeFileSync(partial, 'A fictional interrupted download')
  const copy = await checkpoint()
  expect(NOT_STATE).toContainEqual(expect.objectContaining({ name: 'updates' }))
  expect(
    APP_STATE_FILES.some((file) => file.name === 'updates' || file.name.startsWith('updates/')),
  ).toBe(false)
  expect(
    copy.manifest.files.some((file) => file.name === 'updates' || file.name.startsWith('updates/')),
  ).toBe(false)
  expect(readdirSync(copy.folder).some((name) => name === 'updates')).toBe(false)
  expect(readFileSync(partial, 'utf8')).toBe('A fictional interrupted download')
})

it('restores the database when private staging is absent, without treating it as missing state', async () => {
  const copy = await checkpoint()
  const newer = openDatabase(database)
  try {
    newer.exec("INSERT INTO fictional_notes VALUES ('Fern added this later')")
  } finally {
    newer.close()
  }
  expect(existsSync(join(userData, 'updates'))).toBe(false)
  const result = await restore({ userData, checkpointId: copy.manifest.id, canOpen: () => true })
  expect(result.database).toBe(database)
  const restored = openDatabase(database)
  try {
    expect(restored.prepare('SELECT body FROM fictional_notes').all()).toEqual([
      { body: 'Brook keeps this note' },
    ])
  } finally {
    restored.close()
  }
  expect(() => clearUpdateStaging(userData)).not.toThrow()
  expect(existsSync(join(userData, 'updates'))).toBe(false)
})
