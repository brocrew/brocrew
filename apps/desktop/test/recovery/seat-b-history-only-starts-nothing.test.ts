import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RECOVERY_CHANNELS,
  type HistoryConversation,
  type RecoveryService,
  type StartupVerdict,
} from '../../src/shared/recovery'
import type { Ownership } from '../../src/main/recovery/coordinator'
import { createHistoryReader } from '../../src/main/recovery/history-reader'
import {
  COPY_FILE,
  DATABASE_FILE,
  copyNameOf,
  databaseFile,
  fromRecorded,
} from '../../src/main/recovery/layout'
import { createRecoveryCalls, type RecoveryCalls } from '../../src/main/recovery/window-calls'
import {
  Scratch,
  aCopyOf,
  aService,
  aTemplate,
  filesIn,
  offerOf,
  quiet,
  sha256,
  type Template,
} from './lib/seat-b-folders'
import { ONE_NEWER, THIS_BUILD } from './lib/recovery-fixture'

/**
 * A restored copy behind the history-only gate, as the real service and main's window calls hold
 * it: no start, retry or call opens the data for work, which is the only verdict on which main
 * starts its host, providers, discovery, drafts, schedules and deliveries; the copy is read and
 * never written, so nothing newer is taken into it; only a return to data this build can open
 * starts the app normally again; and a return moves nothing when the newer data it would put back
 * is not exactly what the restore set aside.
 */

const scratch = new Scratch()
afterAll(() => scratch.clear())

/** A workspace a newer build migrated: its own database holds one conversation more than its newest copy. */
let newer: Template
/** A workspace on this build's schema already restored, which a return leaves openable by this build. */
let openable: Template

beforeAll(async () => {
  newer = await aTemplate(scratch, {
    migrations: ONE_NEWER,
    checkpoints: [THIS_BUILD, ONE_NEWER],
    drafts: true,
  })
  openable = await aTemplate(scratch, {
    migrations: THIS_BUILD,
    checkpoints: [THIS_BUILD, THIS_BUILD],
    gate: true,
  })
})

interface Window {
  readonly calls: RecoveryCalls
  readonly relaunched: number[]
  readonly sent: StartupVerdict[]
}

/** Main's answers to the recovery window, over the real service and the real history reader. */
function windowOn(service: RecoveryService, verdict: StartupVerdict): Window {
  const relaunched: number[] = []
  const sent: StartupVerdict[] = []
  const calls = createRecoveryCalls({
    service,
    verdict,
    openReader: (database) => createHistoryReader(database),
    zone: () => null,
    sendVerdict: (settled) => sent.push(settled),
    sendProgress: () => undefined,
    quit: () => undefined,
    relaunch: () => relaunched.push(1),
  })
  return { calls, relaunched, sent }
}

/** A copy of the workspace a newer build migrated, restored through the service. */
async function aRestoredWorkspace(): Promise<{
  userData: string
  service: RecoveryService
  offered: string
  restored: StartupVerdict
}> {
  const userData = await aCopyOf(scratch, newer)
  const service = aService(userData)
  const offered = offerOf(await service.inspect()).id
  const restored = await service.restore(offered, quiet)
  expect(restored.kind).toBe('history-only')
  return { userData, service, offered, restored }
}

describe('while the history-only gate stands', () => {
  it.each(['sole', 'unknown', 'taken'] as const)(
    'no start or retry opens the data when the one-app check says %s, and none changes a file',
    async (ownership: Ownership) => {
      const { userData, restored } = await aRestoredWorkspace()
      const before = filesIn(userData)
      const service = aService(userData, { ownership })
      for (let start = 0; start < 3; start += 1) {
        expect(await service.inspect()).toEqual(restored)
        expect(await service.retry()).toEqual(restored)
      }
      expect(filesIn(userData)).toEqual(before)
    },
  )

  it('a second restore over the copy is refused, and changes nothing', async () => {
    const { userData, service, offered } = await aRestoredWorkspace()
    const before = filesIn(userData)
    expect(await service.restore(offered, quiet)).toMatchObject({
      kind: 'failed',
      reason: 'restore-failed',
      canRetry: false,
    })
    expect(filesIn(userData)).toEqual(before)
  })

  it('the window can read the copy, and only the copy, and cannot start the app from it', async () => {
    const { userData, service, offered, restored } = await aRestoredWorkspace()
    const before = filesIn(userData)
    const { calls, relaunched } = windowOn(service, restored)
    try {
      await expect(calls.answer(RECOVERY_CHANNELS.restore, [offered])).rejects.toThrow(
        /not the one offered/,
      )
      await expect(calls.answer(RECOVERY_CHANNELS.retry, [])).rejects.toThrow(/nothing to try/)

      const listed = (await calls.answer(
        RECOVERY_CHANNELS.conversations,
        [],
      )) as HistoryConversation[]
      expect(listed.map((one) => one.id)).toEqual(['conversation-1'])
      expect(await calls.answer(RECOVERY_CHANNELS.transcript, ['conversation-1'])).toHaveLength(2)
      // The conversations after the copy stay with the newer data, set aside, unread.
      for (const later of ['conversation-2', 'conversation-3']) {
        expect(await calls.answer(RECOVERY_CHANNELS.transcript, [later]), later).toEqual([])
      }
    } finally {
      calls.close()
    }
    expect(calls.current()).toEqual(restored)
    expect(relaunched).toEqual([])
    // Reading wrote nothing: not to the copy, not beside it, not to the newer data set aside.
    expect(filesIn(userData)).toEqual(before)
    expect(await service.inspect()).toEqual(restored)
  })

  it('a return to data this build cannot open does not start the app either', async () => {
    const { service, restored } = await aRestoredWorkspace()
    const { calls, relaunched, sent } = windowOn(service, restored)
    const returned = (await calls.answer(RECOVERY_CHANNELS.return, [])) as StartupVerdict
    expect(returned).toMatchObject({ kind: 'newer' })
    expect(sent).toEqual([returned])
    expect(relaunched).toEqual([])
    await expect(calls.answer(RECOVERY_CHANNELS.conversations, [])).rejects.toThrow(
      /no restored copy/,
    )
  })

  it('control: a return to data this build can open is what starts the app normally', async () => {
    const userData = await aCopyOf(scratch, openable)
    const service = aService(userData)
    const restored = await service.inspect()
    expect(restored.kind).toBe('history-only')
    const { calls, relaunched } = windowOn(service, restored)
    expect(await calls.answer(RECOVERY_CHANNELS.return, [])).toEqual({
      kind: 'open',
      checkpoint: 'not-needed',
    })
    expect(relaunched).toEqual([1])
  })

  it('the verdict names each file the restore set aside, with its full sha256', async () => {
    const userData = await aCopyOf(scratch, newer)
    const live = filesIn(userData)
    const service = aService(userData)
    const restored = await service.restore(offerOf(await service.inspect()).id, quiet)
    if (restored.kind !== 'history-only') throw new Error('not a history-only verdict')
    const { preservedFiles } = restored.gate
    const folder = fromRecorded(userData, restored.gate.preserved)

    expect(preservedFiles.map((file) => file.live)).toContain(DATABASE_FILE)
    expect(preservedFiles.map((file) => file.live)).toContain('drafts.json')
    for (const file of preservedFiles) {
      if (file.present) {
        // The live file as it was before the restore, and the one now waiting in the folder.
        expect(file.sha256, file.live).toBe(live[file.live])
        expect(sha256(readFileSync(join(folder, copyNameOf(file.live)))), file.live).toBe(
          file.sha256,
        )
      } else {
        expect(live[file.live], file.live).toBeUndefined()
      }
    }
    // A later start reads the same record.
    expect(await service.inspect()).toEqual(restored)
  })
})

describe('a return after the newer data set aside was changed', () => {
  /** The newer data the restore set aside, as files in this data folder. */
  function setAside(userData: string, restored: StartupVerdict): string {
    if (restored.kind !== 'history-only') throw new Error('not a history-only verdict')
    return fromRecorded(userData, restored.gate.preserved)
  }

  const CHANGES: readonly (readonly [string, (folder: string) => void])[] = [
    [
      'its database, one byte, size kept',
      (folder) => {
        const path = join(folder, COPY_FILE)
        const bytes = readFileSync(path)
        bytes.writeUInt8(bytes.readUInt8(bytes.length - 1) ^ 0xff, bytes.length - 1)
        writeFileSync(path, bytes)
      },
    ],
    [
      'its drafts',
      (folder) => {
        const path = join(folder, 'drafts.json')
        writeFileSync(path, readFileSync(path, 'utf8').replace('Unsent words', 'Other words'))
      },
    ],
    [
      'a file it did not set aside, now there',
      (folder) => {
        const path = join(folder, `${COPY_FILE}-wal`)
        expect(existsSync(path)).toBe(false)
        writeFileSync(path, 'written beside the set-aside data')
      },
    ],
    ['its database, gone', (folder) => rmSync(join(folder, COPY_FILE))],
  ]

  it.each(CHANGES)(
    '%s: is refused as changed outside, moves nothing, and the history stays',
    async (_, change) => {
      const { userData, service, restored } = await aRestoredWorkspace()
      change(setAside(userData, restored))
      const before = filesIn(userData)
      const { calls, relaunched, sent } = windowOn(service, restored)
      const returned = (await calls.answer(RECOVERY_CHANNELS.return, [])) as StartupVerdict
      expect(returned).toMatchObject({
        kind: 'failed',
        reason: 'replaced-outside',
        canRetry: false,
        where: 'gate',
        checkpointCreatedAt: restored.kind === 'history-only' && restored.gate.checkpointCreatedAt,
      })
      expect(sent).toEqual([returned])
      expect(relaunched).toEqual([])
      expect(filesIn(userData)).toEqual(before)
      // The restored copy is still what a start finds.
      expect(await service.inspect()).toEqual(restored)
    },
  )

  it('control: with the set-aside data as the restore left it, the same return puts it back', async () => {
    const { userData, service, restored } = await aRestoredWorkspace()
    const newerDatabase = filesIn(setAside(userData, restored))[COPY_FILE]
    expect(newerDatabase).toBeDefined()
    const { calls, relaunched } = windowOn(service, restored)
    expect(await calls.answer(RECOVERY_CHANNELS.return, [])).toMatchObject({ kind: 'newer' })
    expect(relaunched).toEqual([])
    expect(sha256(readFileSync(databaseFile(userData)))).toBe(newerDatabase)
  })
})
