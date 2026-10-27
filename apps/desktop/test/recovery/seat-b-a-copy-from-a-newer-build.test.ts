import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RECOVERY_CHANNELS,
  type HistoryConversation,
  type RecoveryService,
  type StartupVerdict,
} from '../../src/shared/recovery'
import { pruneTheCopies } from '../../src/main/recovery/coordinator'
import { createHistoryReader } from '../../src/main/recovery/history-reader'
import type { RecoveryFs } from '../../src/main/recovery/files'
import {
  COPY_FILE,
  UNFINISHED_FILE,
  backupsDir,
  checkpointDatabase,
  checkpointDir,
  databaseFile,
  manifestFile,
  stateFile,
} from '../../src/main/recovery/layout'
import { APP_STATE_FILES } from '../../src/main/recovery/state-files'
import { createRecoveryCalls } from '../../src/main/recovery/window-calls'
import { newerWords } from '../../src/renderer/src/lib/recovery-words'
import {
  MIGRATIONS_FOLDER,
  NEWER_VERSION,
  ONE_NEWER,
  THIS_BUILD,
  type CheckpointFault,
  type RecoveryFixture,
} from './lib/recovery-fixture'
import {
  Scratch,
  UNFLUSHED,
  aBuildWithOneMoreMigration,
  aCopyOf,
  aService,
  aTemplate,
  conversationsIn,
  filesIn,
  offerOf,
  quiet,
  sha256,
  type Template,
} from './lib/seat-b-folders'

/**
 * A copy a newer BroBot left behind, read by this build through the real recovery service on real
 * data folders: the copy a newer build made on this build's schema before it migrated is found, restored, and
 * its history reads back exactly; a copy that is damaged, unfinished or of a later format is never
 * offered or restored, and only a folder the writer marked unfinished is ever pruned without a
 * manifest.
 */

const scratch = new Scratch()
afterAll(() => scratch.clear())

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-10T12:00:00.000Z')
/** When each copy was made: by this build, by the newer build before it migrated, then after. */
const MADE_AT = [
  '2026-10-07T09:00:00.000Z',
  '2026-10-08T09:00:00.000Z',
  '2026-10-09T09:00:00.000Z',
] as const

const drafts = APP_STATE_FILES.find((file) => file.name === 'drafts.json')
if (drafts === undefined) throw new Error('drafts.json is no longer a state file')

let left: Template
beforeAll(async () => {
  left = await aTemplate(scratch, {
    migrations: ONE_NEWER,
    checkpoints: [
      { migrations: THIS_BUILD, createdAt: MADE_AT[0] },
      { migrations: THIS_BUILD, createdAt: MADE_AT[1] },
      { migrations: ONE_NEWER, createdAt: MADE_AT[2] },
    ],
    drafts: true,
    now: NOW,
  })
})

function checkpointOf(fixture: RecoveryFixture, index: number) {
  const checkpoint = fixture.checkpoints[index]
  if (checkpoint === undefined) throw new Error(`the fixture has no checkpoint ${String(index)}`)
  return checkpoint
}

/** The restored copy's history as the recovery window reads it, through main's calls. */
function windowOn(verdict: StartupVerdict, service: RecoveryService) {
  const relaunched: number[] = []
  const calls = createRecoveryCalls({
    service,
    verdict,
    openReader: (database) => createHistoryReader(database),
    zone: () => null,
    sendVerdict: () => undefined,
    sendProgress: () => undefined,
    quit: () => undefined,
    relaunch: () => relaunched.push(1),
  })
  return { calls, relaunched }
}

describe('a copy a newer BroBot made before it migrated', () => {
  it('is what the fixture says: version 1, made by the newer build, before its migration', () => {
    const made = checkpointOf(left.fixture, 1).manifest
    expect(made).toMatchObject({
      format: 'brobot-checkpoint',
      version: 1,
      reason: 'before-migration',
      madeBy: { appVersion: NEWER_VERSION },
      createdAt: MADE_AT[1],
    })
    expect(made.database.migrations).toHaveLength(THIS_BUILD)
    expect(checkpointOf(left.fixture, 2).manifest.database.migrations).toHaveLength(ONE_NEWER)
  })

  it('is offered over the older copy, and the newer copy is not', async () => {
    const userData = await aCopyOf(scratch, left)
    const verdict = await aService(userData).inspect()
    const made = checkpointOf(left.fixture, 1)
    expect(verdict).toEqual({
      kind: 'newer',
      workspace: userData,
      newer: {
        inTheDatabase: ONE_NEWER,
        inTheBuild: THIS_BUILD,
        madeBy: { appVersion: NEWER_VERSION },
      },
      offers: { id: made.id, createdAt: MADE_AT[1], bytes: made.manifest.database.bytes },
    })
  })

  it('is restored, and its history reads back with exact ids, order and times', async () => {
    const userData = await aCopyOf(scratch, left)
    const service = aService(userData)
    const first = await service.inspect()
    const made = checkpointOf(left.fixture, 1)
    const restored = await service.restore(offerOf(first).id, quiet)
    expect(restored).toMatchObject({
      kind: 'history-only',
      gate: { checkpointId: made.id, checkpointCreatedAt: MADE_AT[1] },
      database: databaseFile(userData),
    })
    expect(sha256(readFileSync(databaseFile(userData)))).toBe(made.manifest.database.sha256)

    // Each conversation was begun an hour before the copy after it, its answer a second later.
    const begun = (copy: 0 | 1 | 2): number => Date.parse(MADE_AT[copy]) - HOUR
    const expected: Pick<HistoryConversation, 'id' | 'provider' | 'createdAt' | 'updatedAt'>[] = [
      { id: 'conversation-2', provider: 'claude', createdAt: begun(1), updatedAt: begun(1) + 1000 },
      { id: 'conversation-1', provider: 'claude', createdAt: begun(0), updatedAt: begun(0) + 1000 },
    ]

    const { calls, relaunched } = windowOn(restored, service)
    try {
      const listed = (await calls.answer(
        RECOVERY_CHANNELS.conversations,
        [],
      )) as HistoryConversation[]
      expect(listed.map((one) => one.id)).toEqual(['conversation-2', 'conversation-1'])
      expect(listed).toMatchObject(expected)
      for (const [copy, id] of [
        [0, 'conversation-1'],
        [1, 'conversation-2'],
      ] as const) {
        const events = await calls.answer(RECOVERY_CHANNELS.transcript, [id])
        expect(events, id).toMatchObject([
          {
            event: { type: 'user_turn', text: `Asked before copy ${String(copy + 1)}.` },
            at: begun(copy),
          },
          {
            event: { type: 'assistant_message', text: `Answered before copy ${String(copy + 1)}.` },
            at: begun(copy) + 1000,
          },
        ])
        expect(events).toHaveLength(2)
      }
      // What came after the copy is not in it: neither the newer copy's nor the live one's.
      expect(await calls.answer(RECOVERY_CHANNELS.transcript, ['conversation-3'])).toEqual([])
      expect(await calls.answer(RECOVERY_CHANNELS.transcript, ['conversation-4'])).toEqual([])
    } finally {
      calls.close()
    }
    expect(relaunched).toEqual([])

    // The drafts restored with it name the copy's own newest conversation.
    const draftsNow = await readFile(stateFile(userData, drafts), 'utf8')
    expect(draftsNow).toContain('session:conversation-2')
    expect(draftsNow).toContain('as they stood at copy 2')
  })

  it('is still offered and restored when the newer build wrote fields this one does not know', async () => {
    const userData = await aCopyOf(scratch, left)
    const made = checkpointOf(left.fixture, 1)
    const path = manifestFile(userData, made.id)
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          ...manifest,
          madeBy: { ...(manifest.madeBy as object), platform: 'darwin-arm64' },
          compression: null,
          notes: ['written by a build this one does not know'],
        },
        null,
        2,
      )}\n`,
    )
    const service = aService(userData)
    const first = await service.inspect()
    expect(offerOf(first).id).toBe(made.id)
    expect(await service.restore(made.id, quiet)).toMatchObject({
      kind: 'history-only',
      gate: { checkpointId: made.id },
    })
    expect(await conversationsIn(databaseFile(userData))).toEqual(made.conversations)
  })

  it('control: the newer copy beside it is refused, and nothing moves', async () => {
    const userData = await aCopyOf(scratch, left)
    const service = aService(userData)
    await service.inspect()
    const before = filesIn(userData)
    const refused = await service.restore(checkpointOf(left.fixture, 2).id, quiet)
    expect(refused).toMatchObject({ kind: 'failed', reason: 'restore-failed', canRetry: false })
    expect(refused.kind === 'failed' ? refused.detail : '').toMatch(
      /needs a newer version of BroCrew/,
    )
    expect(filesIn(userData)).toEqual(before)
  })
})

describe('a copy this build must not restore', () => {
  /** A workspace a newer build migrated, whose newest copy on this build's schema carries `fault`, after a whole one. */
  async function aWorkspaceWith(fault: CheckpointFault | null) {
    const template = await aTemplate(scratch, {
      migrations: ONE_NEWER,
      checkpoints: [
        THIS_BUILD,
        { migrations: THIS_BUILD, ...(fault === null ? {} : { fault }) },
        ONE_NEWER,
      ],
      now: NOW,
    })
    return {
      userData: template.userData,
      whole: checkpointOf(template.fixture, 0),
      faulty: checkpointOf(template.fixture, 1),
    }
  }

  it('control: with no fault the newest copy on this build’s schema is the one offered', async () => {
    const { userData, faulty } = await aWorkspaceWith(null)
    expect(offerOf(await aService(userData).inspect()).id).toBe(faulty.id)
  })

  it.each([
    ['damaged after its manifest was written', 'copy-changed'],
    ['unfinished, with no manifest', 'no-manifest'],
    ['of a manifest version this build does not know', 'version-2'],
    ['made for another workspace', 'another-workspace'],
  ] as const)('%s: is not offered, is refused, and nothing moves', async (_, fault) => {
    const { userData, whole, faulty } = await aWorkspaceWith(fault)
    const service = aService(userData)
    expect(offerOf(await service.inspect()).id).toBe(whole.id)
    const before = filesIn(userData)
    expect(await service.restore(faulty.id, quiet)).toMatchObject({
      kind: 'failed',
      reason: 'restore-failed',
      canRetry: false,
    })
    expect(filesIn(userData)).toEqual(before)
    expect(await service.inspect()).toMatchObject({ kind: 'newer', offers: { id: whole.id } })
  })

  it.each(['copy-changed', 'no-manifest', 'version-2'] as const)(
    'offers nothing, and the window offers no restore, when the only copy on this build’s schema is %s',
    async (fault) => {
      const template = await aTemplate(scratch, {
        migrations: ONE_NEWER,
        checkpoints: [{ migrations: THIS_BUILD, fault }, ONE_NEWER],
        now: NOW,
      })
      const verdict = await aService(template.userData).inspect()
      expect(verdict).toMatchObject({ kind: 'newer', offers: null })
      if (verdict.kind !== 'newer') throw new Error('not a newer verdict')
      expect(newerWords(verdict, NOW).actions.map((action) => action.kind)).toEqual(['close'])
    },
  )

  it('a copy whose bytes match a rewritten manifest but are not a database is refused at restore', async () => {
    const { userData, faulty } = await aWorkspaceWith(null)
    const copy = checkpointDatabase(userData, faulty.id)
    const bytes = readFileSync(copy)
    bytes.fill(0, 0, 100)
    writeFileSync(copy, bytes)
    const path = manifestFile(userData, faulty.id)
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      database: { bytes: number; sha256: string }
    }
    manifest.database.sha256 = sha256(bytes)
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)

    const service = aService(userData)
    await service.inspect()
    const before = filesIn(userData)
    expect(await service.restore(faulty.id, quiet)).toMatchObject({
      kind: 'failed',
      reason: 'restore-failed',
      canRetry: false,
    })
    expect(filesIn(userData)).toEqual(before)
  })

  it('of a later manifest version is never pruned, while whole copies past the newest are', async () => {
    const template = await aTemplate(scratch, {
      migrations: THIS_BUILD,
      checkpoints: [
        THIS_BUILD,
        { migrations: THIS_BUILD, fault: 'copy-changed' },
        { migrations: THIS_BUILD, fault: 'no-manifest' },
        { migrations: THIS_BUILD, fault: 'version-2' },
        THIS_BUILD,
        THIS_BUILD,
        THIS_BUILD,
        THIS_BUILD,
      ],
    })
    const ids = template.fixture.checkpoints.map((checkpoint) => checkpoint.id)
    const removed = await pruneTheCopies(
      template.userData,
      MIGRATIONS_FOLDER,
      'sole',
      () => undefined,
    )
    const gone = removed.map((id) => ids.indexOf(id))
    // The newest whole copy stays, and a copy of a later manifest version is never touched.
    for (const kept of [3, 7]) expect(gone, `copy ${String(kept)}`).not.toContain(kept)
    expect(Object.keys(filesIn(template.fixture.checkpoints[3]?.dir ?? ''))).toContain(
      'manifest.json',
    )
    // Whole copies past the newest go.
    expect(gone).toEqual(expect.arrayContaining([0, 4, 5, 6]))
  })

  /** Five copies on this build's schema, oldest first; the second newest damaged after its manifest when asked. */
  async function fiveCopies(damaged: boolean): Promise<{ userData: string; ids: string[] }> {
    const template = await aTemplate(scratch, {
      migrations: THIS_BUILD,
      checkpoints: [
        THIS_BUILD,
        THIS_BUILD,
        THIS_BUILD,
        damaged ? { migrations: THIS_BUILD, fault: 'copy-changed' } : THIS_BUILD,
        THIS_BUILD,
      ],
    })
    return {
      userData: template.userData,
      ids: template.fixture.checkpoints.map((checkpoint) => checkpoint.id),
    }
  }

  it('damaged after its manifest was written is never pruned, and takes no keep slot', async () => {
    const { userData, ids } = await fiveCopies(true)
    const damaged = ids[3] ?? ''
    const before = filesIn(checkpointDir(userData, damaged))
    const removed = await pruneTheCopies(userData, MIGRATIONS_FOLDER, 'sole', () => undefined)
    // The newest intact copy stays; damaged copies remain protected.
    expect([...removed].sort()).toEqual([ids[0], ids[1], ids[2]].sort())
    expect(filesIn(checkpointDir(userData, damaged))).toEqual(before)
  })

  it('control: with no damage, only the newest is kept and the four oldest go', async () => {
    const { userData, ids } = await fiveCopies(false)
    const removed = await pruneTheCopies(userData, MIGRATIONS_FOLDER, 'sole', () => undefined)
    expect([...removed].sort()).toEqual([ids[0], ids[1], ids[2], ids[3]].sort())
  })
})

describe('a folder with no manifest', () => {
  /** A workspace on this build's schema whose oldest copy never got its manifest, days ago. */
  let leftover: Template
  beforeAll(async () => {
    leftover = await aTemplate(scratch, {
      migrations: THIS_BUILD,
      checkpoints: [{ migrations: THIS_BUILD, fault: 'no-manifest' }, THIS_BUILD],
    })
  })

  async function pruned(userData: string): Promise<string[]> {
    return pruneTheCopies(userData, MIGRATIONS_FOLDER, 'sole', () => undefined)
  }

  /** Dates a folder and what it holds two hours back, as one no writer has touched since. */
  function untouchedFor2Hours(folder: string): void {
    const then = new Date(Date.now() - 2 * HOUR)
    for (const name of readdirSync(folder)) utimesSync(join(folder, name), then, then)
    utimesSync(folder, then, then)
  }

  /** A copy of the leftover workspace, and its manifest-less folder, dated as old. */
  async function theLeftover(): Promise<{ userData: string; id: string; folder: string }> {
    const userData = await aCopyOf(scratch, leftover)
    const { id } = checkpointOf(leftover.fixture, 0)
    return { userData, id, folder: checkpointDir(userData, id) }
  }

  it('without the writer’s unfinished file is never pruned, however old', async () => {
    const { userData, id, folder } = await theLeftover()
    rmSync(join(folder, UNFINISHED_FILE))
    untouchedFor2Hours(folder)
    const before = filesIn(folder)
    expect(Object.keys(before)).toEqual([COPY_FILE])
    expect(await pruned(userData)).not.toContain(id)
    expect(filesIn(folder)).toEqual(before)
  })

  it('control: with it, the same folder is pruned', async () => {
    const { userData, id, folder } = await theLeftover()
    untouchedFor2Hours(folder)
    expect(Object.keys(filesIn(folder)).sort()).toEqual([COPY_FILE, UNFINISHED_FILE])
    expect(await pruned(userData)).toContain(id)
    expect(existsSync(folder)).toBe(false)
  })

  it('left by a copy stopped part-way holds the writer’s unfinished file, and is pruned once old', async () => {
    const userData = await aCopyOf(scratch, leftover)
    const known = new Set(readdirSync(backupsDir(userData)))
    const stopping = stoppedAfterTheMarker()
    const service = aService(userData, {
      migrationsFolder: await aBuildWithOneMoreMigration(scratch),
      fs: stopping.fs,
    })
    expect(await service.inspect()).toMatchObject({ kind: 'failed', reason: 'checkpoint-failed' })
    expect(stopping.stopped()).toBe(true)

    const left = readdirSync(backupsDir(userData)).filter((name) => !known.has(name))
    expect(left).toHaveLength(1)
    const id = left[0] ?? ''
    const folder = checkpointDir(userData, id)
    expect(Object.keys(filesIn(folder))).toEqual([UNFINISHED_FILE])

    // Within the hour it may still be being written, so it stays.
    expect(await pruned(userData)).not.toContain(id)
    untouchedFor2Hours(folder)
    expect(await pruned(userData)).toContain(id)
  })
})

/**
 * The real file system until the writer's `unfinished` file is down, then a stopped process: that
 * write lands, and every later change fails, so nothing the writer would do next reaches the disk.
 */
function stoppedAfterTheMarker(): { fs: RecoveryFs; stopped: () => boolean } {
  let stopped = false
  const crash = (): Error =>
    Object.assign(new Error('ECRASH: the process stopped here'), { code: 'ECRASH' })
  const change = async <T>(op: () => Promise<T>): Promise<T> => {
    if (stopped) throw crash()
    return op()
  }
  const fs: RecoveryFs = {
    ...UNFLUSHED,
    writeFile: async (path, data, options) => {
      await change(() => UNFLUSHED.writeFile(path, data, options))
      if (basename(path) === UNFINISHED_FILE) {
        stopped = true
        throw crash()
      }
    },
    rename: (from, to) => change(() => UNFLUSHED.rename(from, to)),
    copyFile: (from, to, mode) => change(() => UNFLUSHED.copyFile(from, to, mode)),
    link: (existing, name) => change(() => UNFLUSHED.link(existing, name)),
    unlink: (path) => change(() => UNFLUSHED.unlink(path)),
    rm: (path, options) => change(() => UNFLUSHED.rm(path, options)),
    mkdir: (path, options) => change(() => UNFLUSHED.mkdir(path, options)),
    rmdir: (path) => change(() => UNFLUSHED.rmdir(path)),
    mkdtemp: (prefix) => change(() => UNFLUSHED.mkdtemp(prefix)),
    chmod: (path, mode) => change(() => UNFLUSHED.chmod(path, mode)),
    open: async (path, flags, mode) => {
      if (flags === 'r') return UNFLUSHED.open(path, flags, mode)
      const handle = await change(() => UNFLUSHED.open(path, flags, mode))
      return { ...handle, writeFile: (data) => change(() => handle.writeFile(data)) }
    },
  }
  return { fs, stopped: () => stopped }
}
