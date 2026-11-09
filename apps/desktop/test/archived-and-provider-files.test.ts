import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeProjectDirName } from '@brobot2/runtime'
import {
  ARCHIVED_FILE,
  archivedConversationsIn,
  importArchivedFile,
} from '../src/main/archived-file'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  frontMatterOf,
  memoryNotesOf,
  providerFilesOf,
  removeFromHome,
} from '../src/main/conversation-files'

/**
 * The archived set, kept in its table and imported once from its old file; and a conversation's provider files and memory notes, found
 * only in its agent's own folder and removed only after each is checked again to be there.
 */

const roots: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function aFolder(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-archive-'))
  roots.push(root)
  return root
}
function aDatabase(): AppDatabase {
  const database = openDatabase(join(aFolder(), 'brobot2.sqlite'))
  applyMigrations(database, join(__dirname, '../src/main/db/migrations'))
  databases.push(database)
  return database
}

describe('the archived set', () => {
  it('is kept in its table and read back by the next run', () => {
    const database = aDatabase()
    const archived = archivedConversationsIn(database)
    expect(archived.ids()).toEqual(new Set())
    archived.add(['a', 'b'], 5)
    archived.add(['a'], 9)
    archived.remove(['b'])
    const again = archivedConversationsIn(database)
    expect(again.ids()).toEqual(new Set(['a']))
    expect(again.archivedAt('a')).toBe(5)
  })

  it('imports archived.json once, then deletes it', () => {
    const userData = aFolder()
    const database = aDatabase()
    const file = join(userData, ARCHIVED_FILE)
    writeFileSync(file, JSON.stringify({ version: 1, archived: { a: { at: 5 }, b: { at: 'x' } } }))
    importArchivedFile(database, userData)
    expect(existsSync(file)).toBe(false)
    expect(archivedConversationsIn(database).ids()).toEqual(new Set(['a']))
    expect(archivedConversationsIn(database).archivedAt('a')).toBe(5)
  })

  it('never imports again once marked, even after the set emptied and the file came back', () => {
    const userData = aFolder()
    const database = aDatabase()
    const file = join(userData, ARCHIVED_FILE)
    const stale = JSON.stringify({ version: 1, archived: { a: { at: 5 } } })
    writeFileSync(file, stale)
    importArchivedFile(database, userData)
    archivedConversationsIn(database).remove(['a'])
    writeFileSync(file, stale)
    importArchivedFile(database, userData)
    expect(archivedConversationsIn(database).ids()).toEqual(new Set())
    expect(existsSync(file)).toBe(false)
  })

  it('keeps a file it cannot parse, imports nothing from it, and tries again next start', () => {
    const userData = aFolder()
    const database = aDatabase()
    const file = join(userData, ARCHIVED_FILE)
    writeFileSync(file, '{"version":1,"archived":')
    expect(() => importArchivedFile(database, userData)).not.toThrow()
    expect(readFileSync(file, 'utf8')).toBe('{"version":1,"archived":')
    expect(archivedConversationsIn(database).ids()).toEqual(new Set())
    writeFileSync(file, JSON.stringify({ version: 1, archived: { a: { at: 5 } } }))
    importArchivedFile(database, userData)
    expect(archivedConversationsIn(database).ids()).toEqual(new Set(['a']))
  })
})

describe('a conversation’s provider files', () => {
  it('are its transcript, the folder beside it and the folders named by its id, when there', () => {
    const home = aFolder()
    const cwd = '/work/here'
    const projects = join(home, 'projects', claudeProjectDirName(cwd))
    mkdirSync(join(projects, 's1', 'tool-results'), { recursive: true })
    writeFileSync(join(projects, 's1.jsonl'), 'line\n')
    writeFileSync(join(projects, 's1', 'tool-results', 'out.txt'), 'abc')
    mkdirSync(join(home, 'file-history', 's1'), { recursive: true })
    const found = providerFilesOf('claude', home, [{ sessionId: 's1', cwd }])
    expect(found.map(({ path }) => path).sort()).toEqual(
      [join(projects, 's1.jsonl'), join(projects, 's1'), join(home, 'file-history', 's1')].sort(),
    )
    expect(found.find(({ path }) => path === join(projects, 's1'))?.bytes).toBe(3)
  })

  it('never lists a link, or anything outside the home', () => {
    const home = aFolder()
    const elsewhere = aFolder()
    mkdirSync(join(home, 'file-history'), { recursive: true })
    symlinkSync(elsewhere, join(home, 'file-history', 's1'))
    expect(providerFilesOf('claude', home, [{ sessionId: 's1', cwd: '/w' }])).toEqual([])
    expect(providerFilesOf('claude', home, [{ sessionId: '../escape', cwd: '/w' }])).toEqual([])
  })

  it('are removed only while each is still in the home as it was', async () => {
    const home = aFolder()
    const elsewhere = aFolder()
    const kept = join(elsewhere, 'kept.txt')
    writeFileSync(kept, 'theirs')
    const file = join(home, 'debug', 's1.txt')
    mkdirSync(join(home, 'debug'), { recursive: true })
    writeFileSync(file, 'log')
    const swapped = join(home, 'debug', 's2.txt')
    symlinkSync(kept, swapped)
    const gone = join(home, 'debug', 's3.txt')
    const left = await removeFromHome(home, [file, swapped, kept, gone])
    expect(left.map(({ path }) => path)).toEqual([swapped, kept])
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(kept, 'utf8')).toBe('theirs')
  })
})

describe('a conversation’s memory notes', () => {
  it('are the notes Claude Code stamped with one of its sessions, never the index', () => {
    const home = aFolder()
    const memory = join(home, 'memory')
    mkdirSync(memory, { recursive: true })
    writeFileSync(
      join(memory, 'mine.md'),
      '---\nname: mine\ndescription: "what it learned"\nmetadata:\n  node_type: memory\n  originSessionId: s1\n---\nbody\n',
    )
    writeFileSync(
      join(memory, 'theirs.md'),
      '---\nname: theirs\nmetadata:\n  originSessionId: s9\n---\n',
    )
    writeFileSync(join(memory, 'unstamped.md'), '---\nname: unstamped\n---\n')
    writeFileSync(
      join(memory, 'MEMORY.md'),
      '---\nmetadata:\n  originSessionId: s1\n---\n- [mine](mine.md)\n',
    )
    expect(memoryNotesOf('claude', home, [{ sessionId: 's1', cwd: '/w' }])).toEqual([
      {
        path: join(memory, 'mine.md'),
        name: 'mine',
        description: 'what it learned',
        bytes: expect.any(Number),
      },
    ])
    expect(memoryNotesOf('codex', home, [{ sessionId: 's1', cwd: '/w' }])).toEqual([])
  })

  it('reads only the front-matter, and only an indented stamp', () => {
    expect(frontMatterOf('no front matter\noriginSessionId: s1\n').originSessionId).toBeNull()
    expect(frontMatterOf('---\noriginSessionId: s1\n---\n').originSessionId).toBeNull()
    expect(
      frontMatterOf('---\r\nmetadata:\r\n  originSessionId: s1\r\n---\r\n').originSessionId,
    ).toBe('s1')
  })
})
