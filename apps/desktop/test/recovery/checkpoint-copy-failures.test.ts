import { existsSync, readFileSync, rmSync } from 'node:fs'
import { basename } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeCheckpoint, type MakeCheckpointOptions } from '../../src/main/recovery/checkpoint'
import { nodeFs } from '../../src/main/recovery/files'
import { backupsDir, COPY_FILE, databaseFile } from '../../src/main/recovery/layout'
import { checkTheCopyHere } from '../helpers/check-the-copy-here'
import { fixtureDatabase, fixtureFolder } from '../lib/host-fixture'
import { databaseContents } from './lib/recovery-files'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('recovery copy failures after writable open', () => {
  const copyFailures: [string, () => Partial<MakeCheckpointOptions>, RegExp][] = [
    [
      'lineage differs',
      () => ({ expectedMigrations: [] }),
      /does not record the migrations admitted at startup/,
    ],
    [
      'space runs out after the first check',
      () => {
        let checks = 0
        return { freeBytes: () => (++checks === 1 ? Number.MAX_SAFE_INTEGER : 1_000_000) }
      },
      /1 MB is free/,
    ],
    [
      'the compressed output cannot be opened',
      () => ({
        fs: {
          ...nodeFs,
          open: (path, flags, mode) =>
            basename(path) === COPY_FILE && flags === 'wx'
              ? Promise.reject(new Error('scripted failure opening the compressed output'))
              : nodeFs.open(path, flags, mode),
        },
      }),
      /scripted failure opening the compressed output/,
    ],
  ]

  it.each(copyFailures)(
    'restores WAL and removes the unfinished copy when %s',
    async (_what, options, error) => {
      const userData = fixtureFolder('brobot2-recovery-copy-failures-')
      folders.push(userData)
      const db = fixtureDatabase(userData)
      try {
        db.exec("CREATE TABLE example (word TEXT); INSERT INTO example VALUES ('keep me')")
      } finally {
        db.close()
      }
      const file = databaseFile(userData)
      const before = databaseContents(file)
      const journalMode = () => [...readFileSync(file).subarray(18, 20)]
      expect(journalMode()).toEqual([2, 2])

      await expect(
        makeCheckpoint({
          userData,
          ownership: 'sole',
          verifyCopy: checkTheCopyHere,
          appVersion: '0.1.0',
          build: 'b7c1d2e',
          reason: 'first-start-of-release',
          log: () => undefined,
          ...options(),
        }),
      ).rejects.toThrow(error)

      expect(journalMode()).toEqual([2, 2])
      expect(databaseContents(file)).toEqual(before)
      expect(existsSync(backupsDir(userData))).toBe(false)
    },
  )
})
