import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppLifetime } from '../src/main/app-lifetime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { createDraftWriter, savedDraftsBook } from '../src/main/drafts-file'
import { LAUNCHER_SLOT } from '../src/shared/saved-drafts'

let folder: string
let database: AppDatabase
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (database?.open) database.close()
  if (folder) rmSync(folder, { recursive: true, force: true })
})

function fixture() {
  folder = mkdtempSync(join(tmpdir(), 'quit-drafts-'))
  const file = join(folder, 'drafts.sqlite')
  database = openDatabase(file)
  database.exec('CREATE TABLE draft (slot TEXT PRIMARY KEY, entry TEXT NOT NULL)')
  const writer = createDraftWriter(database)
  const quit = vi.fn()
  const lifetime = createAppLifetime({
    announceClosing: () => {},
    stopArchiveWork: () => {},
    closeAllSessions: async () => {},
    keepUnsentDrafts: async () => {
      writer.expectQuitSaves(1)
      const result = await writer.quitSaves()
      if (result !== 'saved') throw new Error('Drafts were not saved')
    },
    drainArchiveWork: async () => {},
    closeDatabase: () => database.close(),
    quit,
    exit: vi.fn(),
    armLastResort: vi.fn(),
    now: () => Date.now(),
    log: vi.fn(),
  })
  return { file, writer, quit, lifetime }
}

const lastBook = {
  drafts: [{ slot: LAUNCHER_SLOT, text: 'the last words typed', attached: [] }],
  last: true,
}
const event = { preventDefault: () => {} }

it('keeps the database and window open past the old deadline, then saves before quitting', async () => {
  vi.useFakeTimers()
  const { file, writer, quit, lifetime } = fixture()
  lifetime.beforeQuit(event)
  await vi.advanceTimersByTimeAsync(1500)
  expect(database.open).toBe(true)
  expect(quit).not.toHaveBeenCalled()
  await writer.write(lastBook)
  await vi.runAllTimersAsync()
  await lifetime.shuttingDown
  expect(quit).toHaveBeenCalledOnce()
  database = openDatabase(file)
  expect(savedDraftsBook(database)).toEqual({ version: 1, drafts: lastBook.drafts })
})

it('holds a failed save and allows quit to retry after the write failure is fixed', async () => {
  const { writer, quit, lifetime } = fixture()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  database.exec(
    "CREATE TRIGGER no_save BEFORE INSERT ON draft BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  )
  lifetime.beforeQuit(event)
  await Promise.resolve()
  await Promise.resolve()
  await writer.write(lastBook)
  await lifetime.shuttingDown
  expect(database.open).toBe(true)
  expect(quit).not.toHaveBeenCalled()
  database.exec('DROP TRIGGER no_save')
  lifetime.beforeQuit(event)
  await Promise.resolve()
  await Promise.resolve()
  await writer.write(lastBook)
  await lifetime.shuttingDown
  expect(quit).toHaveBeenCalledOnce()
  expect(warn).toHaveBeenCalled()
})
