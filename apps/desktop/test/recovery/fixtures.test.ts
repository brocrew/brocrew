import Database from 'better-sqlite3'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  STEPS,
  parseGate,
  parseJournal,
  parseManifest,
  parseWorkspaceId,
  type Step,
} from '../../src/main/recovery/contract'
import {
  buildLineage,
  isLineagePrefix,
  lineageFit,
  migrationsOf,
} from '../../src/main/recovery/database-facts'
import { sha256Of } from '../../src/main/recovery/files'
import { createHistoryReader } from '../../src/main/recovery/history-reader'
import {
  backupsDir,
  gateFile,
  journalFile,
  manifestFile,
  recoveryDir,
  workspaceIdFile,
} from '../../src/main/recovery/layout'
import type { StartupVerdict } from '../../src/shared/recovery'
import { createFakeRecoveryService } from './lib/fake-recovery-service'
import {
  BUILD_LINEAGE,
  MIGRATIONS_FOLDER,
  NEWER_MIGRATION,
  ONE_NEWER,
  THIS_BUILD,
  makeRecoveryFixture,
  type RecoveryFixture,
} from './lib/recovery-fixture'

const NOW = Date.parse('2026-10-10T09:00:00.000Z')
const ONE_NEWER_LINEAGE = [...BUILD_LINEAGE, NEWER_MIGRATION.createdAt]
const POSIX = process.platform !== 'win32'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A data folder that does not exist yet, and a scratch folder for reading databases. */
function aPlace(): { userData: string; scratch: string } {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-recovery-fixture-test-'))
  roots.push(root)
  const scratch = join(root, 'scratch')
  mkdirSync(scratch)
  return { userData: join(root, 'data'), scratch }
}

const text = (path: string): string => readFileSync(path, 'utf8')
const mode = (path: string): number => statSync(path).mode & 0o777

async function applied(file: string, scratch: string): Promise<readonly number[] | string> {
  const facts = await migrationsOf(file, { userData: scratch })
  return facts.kind === 'recorded' ? facts.migrations.map(({ createdAt }) => createdAt) : facts.kind
}

/**
 * The conversations a database holds and how many saved keys, read from a copy of it and its
 * sidecars so the fixture's own files are never opened.
 */
function contentsOf(file: string, scratch: string): { conversations: string[]; keys: number } {
  const folder = mkdtempSync(join(scratch, 'read-'))
  const copy = join(folder, 'copy.sqlite')
  copyFileSync(file, copy)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(`${file}${suffix}`)) copyFileSync(`${file}${suffix}`, `${copy}${suffix}`)
  }
  const db = new Database(copy)
  try {
    const rows = db.prepare('SELECT id FROM provider_session ORDER BY created_at').all() as {
      id: string
    }[]
    const keys = db.prepare('SELECT count(*) AS n FROM provider_api_key').get() as { n: number }
    return { conversations: rows.map((row) => row.id), keys: keys.n }
  } finally {
    db.close()
  }
}

/** A rollback-mode SQLite file: header bytes 18 and 19 are both 1. */
function isRollbackMode(file: string): boolean {
  const header = readFileSync(file).subarray(0, 20)
  return header[18] === 1 && header[19] === 1
}

describe('a workspace on this build’s schema, and its checkpoints', () => {
  it('holds a database of this build’s migrations, and copies whose manifests this build reads', async () => {
    const { userData, scratch } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: THIS_BUILD,
      checkpoints: [THIS_BUILD, THIS_BUILD],
      drafts: true,
      now: NOW,
    })

    expect(readdirSync(userData).sort()).toEqual(['backups', 'brobot2.sqlite', 'drafts.json'])
    expect(await applied(fixture.database, scratch)).toEqual(BUILD_LINEAGE)
    const workspaceId = parseWorkspaceId(text(workspaceIdFile(userData)))
    expect(workspaceId).not.toBeNull()
    expect(workspaceId).toBe(fixture.workspaceId)

    const live = contentsOf(fixture.database, scratch)
    expect(live).toEqual({ conversations: fixture.conversations, keys: 0 })
    expect(fixture.conversations).toEqual(['conversation-1', 'conversation-2', 'conversation-3'])

    expect(fixture.checkpoints.map((one) => one.manifest.createdAt)).toEqual([
      '2026-10-08T09:00:00.000Z',
      '2026-10-09T09:00:00.000Z',
    ])
    for (const [index, checkpoint] of fixture.checkpoints.entries()) {
      const parsed = parseManifest(text(manifestFile(userData, checkpoint.id)))
      expect(parsed).toEqual({ ok: true, value: checkpoint.manifest })
      const { manifest } = checkpoint
      expect(manifest.id).toBe(checkpoint.id)
      expect(manifest.workspaceId).toBe(workspaceId)
      expect(manifest.madeBy).toEqual({ appVersion: '0.1.0', build: null })
      expect(manifest.reason).toBe('first-start-of-release')
      expect(manifest.database.bytes).toBe(statSync(checkpoint.database).size)
      expect(manifest.database.sha256).toBe(await sha256Of(checkpoint.database))
      expect(manifest.database.migrations.map(({ createdAt }) => createdAt)).toEqual(BUILD_LINEAGE)
      for (const { hash } of manifest.database.migrations) expect(hash).toMatch(/^[0-9a-f]{64}$/)
      expect(await applied(checkpoint.database, scratch)).toEqual(BUILD_LINEAGE)
      expect(isRollbackMode(checkpoint.database)).toBe(true)
      expect(readdirSync(checkpoint.dir).sort()).toEqual([
        'database.sqlite',
        'drafts.json',
        'manifest.json',
      ])

      const drafts = manifest.files.find((file) => file.name === 'drafts.json')
      expect(drafts).toEqual({
        name: 'drafts.json',
        present: true,
        bytes: statSync(join(checkpoint.dir, 'drafts.json')).size,
        sha256: await sha256Of(join(checkpoint.dir, 'drafts.json')),
      })
      const others = manifest.files.filter((file) => file.name !== 'drafts.json')
      expect(others.length).toBeGreaterThan(0)
      for (const file of others) expect(file).toEqual({ name: file.name, present: false })

      expect(contentsOf(checkpoint.database, scratch)).toEqual({
        conversations: fixture.conversations.slice(0, index + 1),
        keys: 0,
      })
      expect(checkpoint.conversations).toEqual(fixture.conversations.slice(0, index + 1))
    }

    if (POSIX) {
      const [first] = fixture.checkpoints
      if (first === undefined) throw new Error('no checkpoint')
      expect(mode(backupsDir(userData))).toBe(0o700)
      expect(mode(first.dir)).toBe(0o700)
      expect(mode(first.database)).toBe(0o600)
      expect(mode(manifestFile(userData, first.id))).toBe(0o600)
      expect(mode(workspaceIdFile(userData))).toBe(0o600)
    }
  })

  it('is a database alone when no checkpoint was made', async () => {
    const { userData, scratch } = aPlace()
    const fixture = await makeRecoveryFixture(userData, { migrations: THIS_BUILD, checkpoints: [] })
    expect(readdirSync(userData)).toEqual(['brobot2.sqlite'])
    expect(fixture.workspaceId).toBeNull()
    expect(await applied(fixture.database, scratch)).toEqual(BUILD_LINEAGE)
  })
})

describe('rows whose controls the history window must not offer', () => {
  it('are in every conversation when asked for, read back through the history reader', async () => {
    const { userData } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: THIS_BUILD,
      checkpoints: [THIS_BUILD],
      gate: true,
      everyRowKind: true,
      now: NOW,
    })
    const reader = createHistoryReader(fixture.database)
    try {
      const listed = await reader.conversations()
      expect(listed.length).toBeGreaterThan(0)
      for (const { id } of listed) {
        const kinds = (await reader.transcript(id)).map(({ event }) => event.type)
        expect(kinds).toEqual([
          'user_turn',
          'assistant_message',
          'image',
          'sub_agent',
          'sub_agent',
          'tool_call',
          'workflow_run',
          'message_queued',
        ])
        // The run names the call that launched it, which is the row it is drawn on.
        const events = (await reader.transcript(id)).map(({ event }) => event)
        const call = events.find((event) => event.type === 'tool_call')
        const run = events.find((event) => event.type === 'workflow_run')
        expect(call).toMatchObject({ name: 'Workflow' })
        expect(run).toMatchObject({ toolUseId: call?.type === 'tool_call' ? call.id : null })
      }
    } finally {
      reader.close()
    }
  })

  it('are left out unless asked for', async () => {
    const { userData } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: THIS_BUILD,
      checkpoints: [THIS_BUILD],
      gate: true,
      now: NOW,
    })
    const reader = createHistoryReader(fixture.database)
    try {
      for (const { id } of await reader.conversations()) {
        const kinds = (await reader.transcript(id)).map(({ event }) => event.type)
        expect(kinds).toEqual(['user_turn', 'assistant_message'])
      }
    } finally {
      reader.close()
    }
  })
})

describe('a workspace a newer build migrated', () => {
  it('records one migration past this build’s, and its newest copies were made by 0.2.0', async () => {
    const { userData, scratch } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, THIS_BUILD, ONE_NEWER],
      now: NOW,
    })

    const facts = await migrationsOf(fixture.database, { userData: scratch })
    if (facts.kind !== 'recorded') throw new Error(`the database reads as ${facts.kind}`)
    expect(facts.migrations.map(({ createdAt }) => createdAt)).toEqual(ONE_NEWER_LINEAGE)
    expect(facts.migrations.at(-1)?.hash).toBe(NEWER_MIGRATION.hash)
    expect(NEWER_MIGRATION.createdAt).toBeGreaterThan(BUILD_LINEAGE.at(-1) ?? Infinity)
    const lineage = await buildLineage(MIGRATIONS_FOLDER)
    expect(isLineagePrefix(facts.migrations, lineage)).toBe(false)
    expect(lineageFit(facts.migrations, lineage)).toBe('newer')

    const manifests = fixture.checkpoints.map((checkpoint) => {
      const parsed = parseManifest(text(manifestFile(userData, checkpoint.id)))
      if (!parsed.ok) throw new Error(parsed.reason)
      return parsed.value
    })
    expect(
      manifests.map((one) => [one.madeBy.appVersion, one.reason, one.database.migrations.length]),
    ).toEqual([
      ['0.1.0', 'first-start-of-release', THIS_BUILD],
      ['0.2.0', 'before-migration', THIS_BUILD],
      ['0.2.0', 'first-start-of-release', ONE_NEWER],
    ])
    expect(manifests.at(-1)?.database.migrations.at(-1)).toEqual(NEWER_MIGRATION)
    expect(manifests.at(-1)?.database.migrations.map(({ createdAt }) => createdAt)).toEqual(
      ONE_NEWER_LINEAGE,
    )
    const [, beforeIt, eight] = fixture.checkpoints
    expect(await applied(beforeIt?.database ?? '', scratch)).toEqual(BUILD_LINEAGE)
    expect(await applied(eight?.database ?? '', scratch)).toEqual(ONE_NEWER_LINEAGE)
  })

  it('names 0.2.0 on its newest manifest even when that copy is on this build’s schema', async () => {
    const { userData } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD],
    })
    expect(fixture.checkpoints[0]?.manifest).toMatchObject({
      madeBy: { appVersion: '0.2.0' },
      reason: 'before-migration',
    })
    expect(fixture.checkpoints[0]?.manifest.database.migrations).toHaveLength(THIS_BUILD)
  })
})

describe('a checkpoint with a fault', () => {
  it('is laid down as each fault says, beside a whole one', async () => {
    const { userData } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: THIS_BUILD,
      checkpoints: [
        { migrations: THIS_BUILD, fault: 'no-manifest' },
        { migrations: THIS_BUILD, fault: 'copy-changed' },
        { migrations: THIS_BUILD, fault: 'version-2' },
        { migrations: THIS_BUILD, fault: 'another-workspace' },
        THIS_BUILD,
      ],
      now: NOW,
    })
    const [noManifest, changed, later, elsewhere, whole] = fixture.checkpoints
    if (!noManifest || !changed || !later || !elsewhere || !whole) throw new Error('five copies')

    expect(readdirSync(noManifest.dir).sort()).toEqual(['database.sqlite', 'unfinished'])
    // Dated when it was made, so a prune can tell an old leftover from a copy still being made.
    expect(statSync(noManifest.dir).mtimeMs).toBe(Date.parse(noManifest.manifest.createdAt))
    expect(statSync(noManifest.database).mtimeMs).toBe(Date.parse(noManifest.manifest.createdAt))

    expect(parseManifest(text(manifestFile(userData, changed.id))).ok).toBe(true)
    expect(statSync(changed.database).size).toBe(changed.manifest.database.bytes)
    expect(await sha256Of(changed.database)).not.toBe(changed.manifest.database.sha256)

    const refused = parseManifest(text(manifestFile(userData, later.id)))
    expect(refused.ok === false && refused.reason).toContain('version is 2')

    const other = parseManifest(text(manifestFile(userData, elsewhere.id)))
    expect(other.ok && other.value.workspaceId).not.toBe(fixture.workspaceId)
    expect(other.ok && other.value.workspaceId).toMatch(/^[0-9a-f-]{36}$/)

    expect(parseManifest(text(manifestFile(userData, whole.id)))).toEqual({
      ok: true,
      value: whole.manifest,
    })
    expect(await sha256Of(whole.database)).toBe(whole.manifest.database.sha256)
  })
})

/** Where each of the restore's files is after `step`, read from the disk. */
async function expectTheRestoreAt(
  fixture: RecoveryFixture,
  step: Step,
  scratch: string,
): Promise<void> {
  const { userData, restore } = fixture
  if (restore === null) throw new Error('no restore was laid down')
  const after = (one: Step): boolean => STEPS.indexOf(step) >= STEPS.indexOf(one)
  const restored = fixture.checkpoints.find((one) => one.id === restore.checkpointId)
  if (restored === undefined) throw new Error('the restored checkpoint is not in the fixture')

  const journal = parseJournal(text(journalFile(userData)))
  if (!journal.ok) throw new Error(journal.reason)
  expect(journal.value).toEqual(restore.journal)
  expect(journal.value).toMatchObject({
    id: restore.id,
    kind: 'restore',
    checkpointId: restored.id,
    step,
  })
  const [database, ...others] = journal.value.participants
  expect(database).toMatchObject({
    live: 'brobot2.sqlite',
    role: 'database',
    becomes: { present: true, sha256: restored.manifest.database.sha256 },
  })
  expect(others.map(({ live, was }) => [live, was.present])).toEqual([
    ['brobot2.sqlite-wal', false],
    ['brobot2.sqlite-shm', false],
    ['brobot2.sqlite-journal', false],
    ['skills', false],
    ['skills-off', false],
    ['skills-conversion.json', false],
    ['drafts.json', true],
    ['archived.json', false],
    ['profile-execution.json', false],
  ])

  expect(existsSync(gateFile(userData))).toBe(after('gate-installed'))
  if (after('gate-installed')) {
    const gate = parseGate(text(gateFile(userData)))
    expect(gate).toEqual({ ok: true, value: restore.gate })
    expect(gate.ok && gate.value).toMatchObject({
      restoreId: restore.id,
      checkpointId: restored.id,
      checkpointCreatedAt: restored.manifest.createdAt,
      preserved: `recovery/preserved/${restore.id}`,
    })
    expect(gate.ok && gate.value.installed[0]).toEqual({
      live: 'brobot2.sqlite',
      present: true,
      sha256: restored.manifest.database.sha256,
    })
    expect(gate.ok && gate.value.preservedFiles).toEqual(
      journal.value.participants.map(({ live, was }) => ({ live, ...was })),
    )
  }

  const newer = after('moving') ? join(restore.preserved, 'database.sqlite') : fixture.database
  expect(database?.was).toEqual({ present: true, sha256: await sha256Of(newer) })
  expect(await applied(newer, scratch)).toEqual(ONE_NEWER_LINEAGE)
  expect(text(join(after('moving') ? restore.preserved : userData, 'drafts.json'))).toContain(
    'written after the newest copy',
  )

  if (after('moving')) {
    expect(await sha256Of(fixture.database)).toBe(restored.manifest.database.sha256)
    expect(await applied(fixture.database, scratch)).toEqual(BUILD_LINEAGE)
    expect(text(join(userData, 'drafts.json'))).toContain(
      `at copy ${String(fixture.checkpoints.indexOf(restored) + 1)}`,
    )
  }

  const staged = existsSync(restore.staged) ? readdirSync(restore.staged).sort() : null
  if (step === 'planned' || after('done')) expect(staged).toBeNull()
  else if (after('moving')) expect(staged).toEqual([])
  else {
    expect(staged).toEqual(['database.sqlite', 'drafts.json'])
    expect(await sha256Of(join(restore.staged, 'database.sqlite'))).toBe(
      restored.manifest.database.sha256,
    )
  }
  expect(existsSync(restore.preserved)).toBe(after('moving'))
}

describe('a restore stopped after each step', () => {
  for (const step of STEPS) {
    it(`leaves the journal at ${step}, and each file where that step put it`, async () => {
      const { userData, scratch } = aPlace()
      const fixture = await makeRecoveryFixture(userData, {
        migrations: ONE_NEWER,
        checkpoints: [THIS_BUILD, THIS_BUILD, ONE_NEWER],
        drafts: true,
        journalAt: step,
      })
      expect(fixture.restore?.checkpointId).toBe(fixture.checkpoints[1]?.id)
      await expectTheRestoreAt(fixture, step, scratch)
    })
  }

  it('sets the whole family aside, sidecars and all, after a crash left them', async () => {
    const { userData, scratch } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD],
      crashed: true,
      journalAt: 'moving',
    })
    const journal = parseJournal(text(journalFile(userData)))
    expect(
      journal.ok &&
        journal.value.participants.filter(({ was }) => was.present).map(({ live }) => live),
    ).toEqual(['brobot2.sqlite', 'brobot2.sqlite-wal', 'brobot2.sqlite-shm'])
    const preserved = fixture.restore?.preserved ?? ''
    expect(readdirSync(preserved).sort()).toEqual([
      'database.sqlite',
      'database.sqlite-shm',
      'database.sqlite-wal',
    ])
    expect(readdirSync(userData).sort()).toEqual(['backups', 'brobot2.sqlite', 'recovery'])
    expect(await applied(join(preserved, 'database.sqlite'), scratch)).toEqual(ONE_NEWER_LINEAGE)
  })
})

describe('a finished restore', () => {
  it('leaves the gate, the copy as the database, and the workspace’s own set aside', async () => {
    const { userData, scratch } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD, ONE_NEWER],
      gate: true,
      drafts: true,
      keptCurrent: true,
    })
    const restore = fixture.restore
    if (restore === null) throw new Error('no restore')
    const [restored] = fixture.checkpoints
    expect(restore.checkpointId).toBe(restored?.id)

    expect(existsSync(journalFile(userData))).toBe(false)
    expect(restore.journal).toBeNull()
    const gate = parseGate(text(gateFile(userData)))
    expect(gate).toEqual({ ok: true, value: restore.gate })
    expect(readdirSync(recoveryDir(userData)).sort()).toEqual(['history-only.json', 'preserved'])

    expect(restore.gate?.installed[0]).toEqual({
      live: 'brobot2.sqlite',
      present: true,
      sha256: await sha256Of(fixture.database),
    })
    expect(await applied(fixture.database, scratch)).toEqual(BUILD_LINEAGE)
    expect(contentsOf(fixture.database, scratch).conversations).toEqual(restored?.conversations)
    expect(readdirSync(restore.preserved).sort()).toEqual(['database.sqlite', 'drafts.json'])
    expect(await applied(join(restore.preserved, 'database.sqlite'), scratch)).toEqual(
      ONE_NEWER_LINEAGE,
    )
    expect(contentsOf(join(restore.preserved, 'database.sqlite'), scratch).conversations).toEqual(
      fixture.conversations,
    )

    expect(text(join(userData, 'drafts.json'))).toContain('at copy 1')
    expect(text(join(userData, 'workspace.json'))).toContain('its name now')
    expect(text(join(restored?.dir ?? '', 'workspace.json'))).toContain('its earlier name')
    expect(readdirSync(userData).sort()).toEqual([
      'backups',
      'brobot2.sqlite',
      'drafts.json',
      'recovery',
      'workspace.json',
    ])
  })
})

describe('a crashed workspace', () => {
  it('keeps its newest stretch only in the -wal beside a -shm', async () => {
    const { userData, scratch } = aPlace()
    const fixture = await makeRecoveryFixture(userData, {
      migrations: ONE_NEWER,
      checkpoints: [THIS_BUILD],
      crashed: true,
    })
    expect(readdirSync(userData).sort()).toEqual([
      'backups',
      'brobot2.sqlite',
      'brobot2.sqlite-shm',
      'brobot2.sqlite-wal',
    ])
    expect(statSync(`${fixture.database}-wal`).size).toBeGreaterThan(0)
    expect(await applied(fixture.database, scratch)).toEqual(ONE_NEWER_LINEAGE)

    const mainOnly = join(mkdtempSync(join(scratch, 'main-')), 'brobot2.sqlite')
    copyFileSync(fixture.database, mainOnly)
    expect(await applied(mainOnly, scratch)).toEqual(BUILD_LINEAGE)
  })
})

describe('options that cannot describe one folder', () => {
  it('are refused before anything is written', async () => {
    const { userData } = aPlace()
    await expect(
      makeRecoveryFixture(userData, {
        migrations: ONE_NEWER,
        checkpoints: [THIS_BUILD],
        journalAt: 'staged',
        gate: true,
      }),
    ).rejects.toThrow('has not installed its gate')
    await expect(
      makeRecoveryFixture(userData, {
        migrations: ONE_NEWER,
        checkpoints: [ONE_NEWER],
        gate: true,
      }),
    ).rejects.toThrow("whole checkpoint on this build's schema")
    await expect(
      makeRecoveryFixture(userData, { migrations: THIS_BUILD, checkpoints: [ONE_NEWER] }),
    ).rejects.toThrow('past the workspace')
    expect(existsSync(userData)).toBe(false)
  })
})

describe('the scripted recovery service', () => {
  const newer: StartupVerdict = {
    kind: 'newer',
    workspace: '/data',
    newer: { inTheDatabase: ONE_NEWER, inTheBuild: THIS_BUILD, madeBy: { appVersion: '0.2.0' } },
    offers: { id: 'copy', createdAt: '2026-10-09T09:00:00.000Z', bytes: 1 },
  }
  const historyOnly: StartupVerdict = {
    kind: 'history-only',
    gate: {
      format: 'brobot-history-only',
      version: 1,
      restoreId: 'restore',
      checkpointId: 'copy',
      checkpointCreatedAt: '2026-10-09T09:00:00.000Z',
      installed: [{ live: 'brobot2.sqlite', present: true, sha256: 'a'.repeat(64) }],
      preserved: 'recovery/preserved/restore',
      preservedFiles: [{ live: 'brobot2.sqlite', present: true, sha256: 'b'.repeat(64) }],
    },
    database: '/data/brobot2.sqlite',
  }
  const failed: StartupVerdict = { kind: 'failed', reason: 'restore-failed', canRetry: true }

  it('answers its script in turn, reports progress, and records every call', async () => {
    let release = (): void => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = createFakeRecoveryService({
      inspect: newer,
      restore: [new Error('EBUSY: held'), historyOnly],
      returnToNewer: newer,
      progress: [
        [0, 2],
        [2, 2],
      ],
      hold,
    })
    const ticks: [number, number][] = []
    const tick = (done: number, total: number): void => {
      ticks.push([done, total])
    }

    expect(await service.inspect()).toBe(newer)
    const first = service.restore('copy', tick)
    release()
    await expect(first).rejects.toThrow('EBUSY')
    expect(service.current()).toBe(newer)
    expect(await service.restore('copy', tick)).toBe(historyOnly)
    expect(await service.inspect()).toBe(historyOnly)
    expect(await service.returnToNewer(tick)).toBe(newer)
    await expect(service.retry()).rejects.toThrow('no verdict was scripted for retry()')

    expect(ticks).toEqual([
      [0, 2],
      [2, 2],
      [0, 2],
      [2, 2],
      [0, 2],
      [2, 2],
    ])
    expect(service.calls).toEqual([
      { call: 'inspect' },
      { call: 'restore', checkpointId: 'copy' },
      { call: 'restore', checkpointId: 'copy' },
      { call: 'inspect' },
      { call: 'returnToNewer' },
      { call: 'retry' },
    ])
  })

  it('answers its last scripted verdict again once the list runs out', async () => {
    const service = createFakeRecoveryService({ inspect: failed, retry: [failed, newer] })
    expect(await service.retry()).toBe(failed)
    expect(await service.retry()).toBe(newer)
    expect(await service.retry()).toBe(newer)
    expect(await service.inspect()).toBe(newer)
  })
})
