import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createDraftWriter, savedDraftsBook } from '../src/main/drafts-file'
import { restoreSavedDrafts } from '../src/main/saved-drafts'
import { createDraftBook, NEW_CONVERSATION, sweepDrafts } from '../src/renderer/src/lib/drafts'
import { draftsToSave, restoreDrafts } from '../src/renderer/src/lib/kept-drafts'
import { newAgentDraftSlot, type SavedDrafts } from '../src/shared/saved-drafts'
import type { HandedPath } from '../src/shared/attachment-contracts'

const FILE = (path: string): HandedPath => ({ path, kind: 'file', outsideCwd: false })
const HERE = dirname(fileURLToPath(import.meta.url))

describe('agent drafts before a conversation exists', () => {
  let userData: string
  let db: AppDatabase
  beforeEach(() => {
    userData = realpathSync(mkdtempSync(join(tmpdir(), 'agent-drafts-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(HERE, '../src/main/db/migrations'))
  })
  afterEach(() => {
    if (db.open) db.close()
    rmSync(userData, { recursive: true, force: true })
  })
  const readBack = (deps: { exists: (id: string) => boolean }): Promise<SavedDrafts> =>
    restoreSavedDrafts(savedDraftsBook(db), deps)

  it('keeps distinct new-agent drafts through a quit before any conversation exists', async () => {
    const first = newAgentDraftSlot('fictional-alpha')
    const second = newAgentDraftSlot('fictional-beta')
    const present = join(userData, 'notes.md')
    writeFileSync(present, 'fixture')
    const saved = {
      drafts: [
        { slot: NEW_CONVERSATION, text: 'BroBot draft', attached: [] },
        { slot: first, text: 'Alpha draft', attached: [] },
        { slot: second, text: '', attached: [FILE(present)] },
      ],
    }
    const writer = createDraftWriter(db)
    writer.expectQuitSaves(1)
    await writer.write({ ...saved, last: true })
    expect(await writer.quitSaves()).toBe('saved')
    const restored = await readBack({ exists: () => false })
    expect(restored).toEqual(saved)
    const book = createDraftBook()
    expect(restoreDrafts(book, restored)).toEqual([])
    const sweep = sweepDrafts(
      book,
      () => [],
      () => NEW_CONVERSATION,
      () => [],
    )
    expect(book.read(NEW_CONVERSATION)).toBe('BroBot draft')
    expect(book.read(first)).toBe('Alpha draft')
    expect(book.paths.read(second)).toEqual([FILE(present)])
    expect(draftsToSave(book)).toEqual(saved)
    sweep.stop()
  })

  it('clearing one agent draft leaves the other agent and launcher slots intact', async () => {
    const first = newAgentDraftSlot('fictional-alpha')
    const second = newAgentDraftSlot('fictional-beta')
    const writer = createDraftWriter(db)
    await writer.write({
      drafts: [
        { slot: NEW_CONVERSATION, text: 'BroBot draft', attached: [] },
        { slot: first, text: 'Alpha draft', attached: [] },
        { slot: second, text: 'Beta draft', attached: [] },
      ],
    })
    await writer.write({ drafts: [], cleared: [first] })
    expect((await readBack({ exists: () => false })).drafts.map((draft) => draft.slot)).toEqual([
      NEW_CONVERSATION,
      second,
    ])
  })
})
