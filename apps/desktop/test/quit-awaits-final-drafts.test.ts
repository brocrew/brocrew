import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppLifetime } from '../src/main/app-lifetime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { createSqliteDraftStorage } from '../src/main/database/sqlite/workspace/drafts'
import { createDraftWriter, requestLastDraftSaves } from '../src/main/drafts-file'
import { LAUNCHER_SLOT } from '../src/shared/saved-drafts'
import { deferred } from './helpers/quit-open-list-cases'

let folder: string
let database: AppDatabase
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (database?.open) database.close()
  if (folder) rmSync(folder, { recursive: true, force: true })
})

function reader(token: string) {
  const frame = {
    frameToken: token,
    detached: false,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  }
  const contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false })
  return { contents, token, frame }
}

function fixture(readers = [reader('main')]) {
  folder = mkdtempSync(join(tmpdir(), 'quit-drafts-'))
  const file = join(folder, 'drafts.sqlite')
  database = openDatabase(file)
  database.exec('CREATE TABLE draft (slot TEXT PRIMARY KEY, entry TEXT NOT NULL)')
  const storage = createSqliteDraftStorage(database)
  const writer = createDraftWriter(storage)
  const quit = vi.fn()
  const lifetime = createAppLifetime({
    announceClosing: () => {},
    stopArchiveWork: () => {},
    closeAllSessions: async () => {},
    keepUnsentDrafts: async () => {
      const result = await requestLastDraftSaves(writer, readers, 'last-draft')
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
  return { file, storage, writer, quit, lifetime }
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
  await writer.write(lastBook, 'main')
  await vi.runAllTimersAsync()
  await lifetime.shuttingDown
  expect(quit).toHaveBeenCalledOnce()
  database = openDatabase(file)
  expect(createSqliteDraftStorage(database).read()).toEqual({ version: 1, drafts: lastBook.drafts })
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
  await writer.write(lastBook, 'main')
  await lifetime.shuttingDown
  expect(database.open).toBe(true)
  expect(quit).not.toHaveBeenCalled()
  database.exec('DROP TRIGGER no_save')
  lifetime.beforeQuit(event)
  await Promise.resolve()
  await Promise.resolve()
  await writer.write(lastBook, 'main')
  await lifetime.shuttingDown
  expect(quit).toHaveBeenCalledOnce()
  expect(warn).toHaveBeenCalled()
})

it('skips a disposed main frame even while its WebContents exists', async () => {
  const gone = reader('gone')
  gone.frame.isDestroyed.mockReturnValue(true)
  const { quit, lifetime } = fixture([gone])
  lifetime.beforeQuit(event)
  await lifetime.shuttingDown
  expect(gone.frame.send).not.toHaveBeenCalled()
  expect(quit).toHaveBeenCalledOnce()
})

it('finishes when Electron handles a disposed send without throwing or answering', async () => {
  const gone = reader('gone')
  gone.frame.send.mockImplementation(() => {
    gone.frame.isDestroyed.mockReturnValue(true)
  })
  const { quit, lifetime } = fixture([gone])
  lifetime.beforeQuit(event)
  await lifetime.shuttingDown
  expect(gone.frame.send).toHaveBeenCalledExactlyOnceWith('last-draft')
  expect(quit).toHaveBeenCalledOnce()
  expect(gone.contents.listenerCount('render-process-gone')).toBe(0)
})

it('retires only the vanished frame and still waits for the other window', async () => {
  vi.useFakeTimers()
  const gone = reader('gone')
  const live = reader('main')
  const { file, storage, writer, quit, lifetime } = fixture([gone, live])
  lifetime.beforeQuit(event)
  await vi.advanceTimersByTimeAsync(0)
  expect(gone.frame.send).toHaveBeenCalledOnce()
  expect(live.frame.send).toHaveBeenCalledOnce()
  gone.contents.emit('render-process-gone')
  gone.contents.emit('destroyed')
  await writer.write({ drafts: [], last: true }, 'gone')
  await vi.advanceTimersByTimeAsync(1500)
  expect(quit).not.toHaveBeenCalled()
  expect(database.open).toBe(true)
  const commit = deferred()
  const persist = storage.persist
  const held = vi.spyOn(storage, 'persist').mockImplementation(async (packet) => {
    await commit.promise
    return persist(packet)
  })
  const saving = writer.write(lastBook, 'main')
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(held).toHaveBeenCalledOnce()
    expect(storage.read()).toEqual({ version: 1, drafts: [] })
    live.contents.emit('did-navigate')
    await vi.advanceTimersByTimeAsync(1500)
    expect(database.open).toBe(true)
    expect(quit).not.toHaveBeenCalled()
  } finally {
    commit.resolve()
    await saving
  }
  await vi.runAllTimersAsync()
  await lifetime.shuttingDown
  expect(quit).toHaveBeenCalledOnce()
  expect(live.contents.listenerCount('render-process-gone')).toBe(0)
  database = openDatabase(file)
  expect(createSqliteDraftStorage(database).read()).toEqual({ version: 1, drafts: lastBook.drafts })
})

it('retires the old document only when its replacement commits', async () => {
  vi.useFakeTimers()
  const old = reader('old')
  const { quit, lifetime } = fixture([old])
  lifetime.beforeQuit(event)
  await vi.advanceTimersByTimeAsync(0)
  expect(old.frame.send).toHaveBeenCalledOnce()

  old.contents.emit('did-start-navigation')
  old.contents.emit('did-navigate-in-page')
  await vi.advanceTimersByTimeAsync(1500)
  expect(quit).not.toHaveBeenCalled()
  expect(database.open).toBe(true)

  // Electron can reuse the same wrapper. A committed replacement still ends this document.
  old.contents.emit('did-navigate')
  await vi.runAllTimersAsync()
  await lifetime.shuttingDown
  expect(quit).toHaveBeenCalledOnce()
  expect(old.contents.listenerCount('destroyed')).toBe(0)
})

it('keeps a failed book when another requested renderer disappears', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const gone = reader('gone')
  const live = reader('main')
  const { file, writer, quit, lifetime } = fixture([gone, live])
  database.exec(
    "CREATE TRIGGER no_save BEFORE INSERT ON draft BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  )
  lifetime.beforeQuit(event)
  await vi.advanceTimersByTimeAsync(0)
  expect(gone.frame.send).toHaveBeenCalledOnce()
  await writer.write(lastBook, 'main')
  gone.frame.isDestroyed.mockReturnValue(true)
  gone.contents.emit('render-process-gone')
  await lifetime.shuttingDown
  expect(database.open).toBe(true)
  expect(quit).not.toHaveBeenCalled()

  database.exec('DROP TRIGGER no_save')
  lifetime.beforeQuit(event)
  await vi.advanceTimersByTimeAsync(0)
  await writer.write({ drafts: [], last: true }, 'main')
  await vi.runAllTimersAsync()
  await lifetime.shuttingDown
  expect(quit).toHaveBeenCalledOnce()
  database = openDatabase(file)
  expect(createSqliteDraftStorage(database).read()).toEqual({ version: 1, drafts: lastBook.drafts })
})

it('wires the last-draft request into the shutdown sequence', () => {
  const index = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
  // ⚑ the quit's last-book step: its own lifetime step, asking the windows that read drafts
  expect(index).toMatch(/keepUnsentDrafts: \(\) => theLastDraftSaves\(\),/)
  expect(index).toContain('const token = draftReaders.get(contents.id)')
  expect(index).toContain('await requestLastDraftSaves(writer, readers, LAST_DRAFT_SAVE_CHANNEL)')
  const drafts = readFileSync(new URL('../src/main/drafts-file.ts', import.meta.url), 'utf8')
  expect(drafts).toContain('writer.expectQuitSaves(readers.map(({ token }) => token))')
  expect(drafts).toContain('frame.send(channel)')
  expect(drafts).toContain('return await writer.quitSaves()')
})
