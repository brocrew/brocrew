import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { openDatabase, type AppDatabase } from '../../src/main/db/connection'
import { newEventId, newWorkId } from '../../src/main/db/ids'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore } from '../../src/main/db/session-store'
import { nodeFs, type RecoveryFs } from '../../src/main/recovery/files'
import { createHistoryReader } from '../../src/main/recovery/history-reader'
import { theWorkThatNamesItSaid } from '../../src/shared/piece-called'
import type { HistoryConversation, HistoryEvent } from '../../src/shared/recovery'
import { DEFAULT_PROFILE_ID, type TranscriptEvent } from '../../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(here, '../../src/main/db/migrations')
const T0 = Date.UTC(2026, 9, 1, 9)

const roots: string[] = []
// A row that is not JSON is warned about where it is skipped.
let warn: MockInstance<typeof console.warn>
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  warn.mockRestore()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Fixture {
  /** The restored copy: rollback mode, alone in its folder. */
  readonly copy: string
  readonly folder: string
  /** The database the copy was taken from, closed, still in WAL mode. */
  readonly live: string
  /** What the session store answered about the database the copy was taken from. */
  readonly expected: {
    readonly conversations: readonly HistoryConversation[]
    readonly transcripts: ReadonlyMap<string, readonly HistoryEvent[]>
  }
}

/**
 * Who is in each conversation, as the main window says it: the name a person chose, else the app's
 * own name for the identity, else nobody for one this app ran as nobody.
 */
const AGENTS: Readonly<Record<string, string | null>> = {
  sess_person: 'BroBot',
  sess_helper: 'Ada',
  sess_idle: 'Ada',
  sess_found: null,
  sess_rebuilt: 'designer',
  sess_bundle: null,
}

/**
 * A workspace's database written by the real store and migrations, and a checked copy of it as a
 * checkpoint makes one: taken with SQLite's backup, then switched to rollback mode.
 */
async function aRestoredCopy(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-recovery-history-'))
  roots.push(root)
  const live = join(root, 'live', 'brobot2.sqlite')
  const folder = join(root, 'restored')
  const copy = join(folder, 'brobot2.sqlite')
  mkdirSync(dirname(live))
  mkdirSync(folder)

  let clock = T0
  const db = openDatabase(live)
  applyMigrations(db, MIGRATIONS)
  const store = createSessionStore(db, () => clock)
  const append = (id: string, ordinal: number, event: TranscriptEvent, at: number): void =>
    store.append(id, ordinal, event, at)

  // A conversation a person started, in BroBot's own name, its root titled since.
  clock = T0 + 1_000
  store.create({
    id: 'sess_person',
    provider: 'claude',
    cwd: root,
    approvalMode: 'ask',
    profileId: DEFAULT_PROFILE_ID,
  })
  const root1 = store.rootOf('sess_person')
  if (root1 === null) throw new Error('the store made no root')
  append('sess_person', 0, { type: 'user_turn', text: 'Make the bakery a website.' }, T0 + 2_000)
  append(
    'sess_person',
    1,
    { type: 'assistant_message', text: 'Starting with the menu.' },
    T0 + 3_000,
  )
  append(
    'sess_person',
    2,
    { type: 'work_retitled', piece: root1.piece, title: 'Bakery website', by: 'sess_person' },
    T0 + 4_000,
  )

  // A conversation it started and gave a piece to, retitled since, under a name a person chose.
  clock = T0 + 5_000
  store.create({
    id: 'sess_helper',
    provider: 'codex',
    cwd: root,
    approvalMode: 'auto',
    profileId: 'Developer',
    parentSessionId: 'sess_person',
  })
  store.setAgentDisplayName('developer', 'Ada')
  const piece = newWorkId()
  const number = store.numberUnder(root1.piece)
  const given = { title: 'Draft the menu page', brief: 'The menu, as one page.' }
  store.recordGive(
    {
      piece,
      parent: root1.piece,
      number,
      owner: 'sess_helper',
      givenBy: 'sess_person',
      folder: null,
      inputs: [],
      ...given,
    },
    0,
    {
      type: 'work_given',
      piece,
      label: `${root1.label}.${String(number)}`,
      parent: root1.piece,
      givenBy: 'sess_person',
      ...given,
    },
    T0 + 6_000,
  )
  append(
    'sess_helper',
    1,
    { type: 'work_retitled', piece, title: 'Draft the menu', by: 'sess_person' },
    T0 + 7_000,
  )
  append('sess_helper', 2, { type: 'assistant_message', text: 'The menu is drafted.' }, T0 + 8_000)

  // One it started that holds no piece.
  clock = T0 + 9_000
  store.create({
    id: 'sess_idle',
    provider: 'claude',
    cwd: root,
    approvalMode: 'ask',
    profileId: 'developer',
    parentSessionId: 'sess_person',
  })

  // One found in a person's own provider folder: no agent of this app's is in it.
  store.adopt({
    id: 'sess_found',
    provider: 'claude',
    sessionId: 'c0ffee00-0000-4000-8000-000000000001',
    cwd: root,
    profileId: null,
    createdAt: T0 - 60_000,
    updatedAt: T0 - 30_000,
  })

  // One restored from a bundle: it keeps its profile, and is still not one of this app's.
  store.adopt({
    id: 'sess_bundle',
    provider: 'claude',
    sessionId: 'c0ffee00-0000-4000-8000-000000000002',
    cwd: root,
    profileId: DEFAULT_PROFILE_ID,
    createdAt: T0 - 50_000,
    updatedAt: T0 - 10_000,
  })
  db.prepare('UPDATE provider_session SET restored_at = ? WHERE id = ?').run(T0, 'sess_bundle')

  // One rebuilt from its provider's file, whose reads are of the generation it was switched to.
  store.adopt({
    id: 'sess_rebuilt',
    provider: 'codex',
    sessionId: 'thread-rebuilt',
    cwd: root,
    profileId: 'designer',
    createdAt: T0 - 40_000,
    updatedAt: T0 - 20_000,
  })
  store.setAgentDisplayName('designer', null)
  const rebuiltRoot = store.rootOf('sess_rebuilt')
  if (rebuiltRoot === null) throw new Error('the store made no root')
  // Rows written straight into the ledger, as a rebuild or an older build wrote them.
  const insertEvent = db.prepare(
    `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, generation)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const stored = (
    id: string,
    ordinal: number,
    type: string,
    payload: string,
    at: number,
    generation = 0,
  ): void => {
    insertEvent.run(newEventId(), id, ordinal, type, payload, at, generation)
  }
  for (const [generation, words] of [
    [0, 'old'],
    [1, 'new'],
  ] as const) {
    stored(
      'sess_rebuilt',
      0,
      'assistant_message',
      JSON.stringify({ type: 'assistant_message', text: `From the ${words} reading.` }),
      T0 - 40_000,
      generation,
    )
    stored(
      'sess_rebuilt',
      1,
      'work_retitled',
      JSON.stringify({
        type: 'work_retitled',
        piece: rebuiltRoot.piece,
        title: `The ${words} title`,
        by: null,
      }),
      T0 - 39_000,
      generation,
    )
  }
  db.prepare(
    `INSERT INTO derived_generation
       (session_id, active, normalizer_version, derived_through, building, highest, failure, updated_at)
     VALUES (?, 1, 0, 0, NULL, 1, NULL, ?)`,
  ).run('sess_rebuilt', T0)

  // Rows written before the store bounded what it took in: one far over the bound, one not JSON.
  stored(
    'sess_person',
    3,
    'unknown',
    JSON.stringify({
      type: 'unknown',
      provider: 'claude',
      category: 'unrecognized',
      raw: 'x'.repeat(200_000),
    }),
    T0 + 4_500,
  )
  stored(
    'sess_person',
    4,
    'assistant_message',
    '{"type": "assistant_message", "text": "torn',
    T0 + 4_600,
  )

  const ids = store.recorded().map((row) => row.sessionId)
  const conversations = store
    .recorded()
    .sort(
      (one, other) => other.updatedAt - one.updatedAt || (one.sessionId < other.sessionId ? 1 : -1),
    )
    .map((row): HistoryConversation => {
      const named = store.workThatNames(row.sessionId)
      return {
        id: row.sessionId,
        title: named === null ? null : theWorkThatNamesItSaid(named),
        agent: AGENTS[row.sessionId] ?? null,
        provider: row.provider,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    })
  const transcripts = new Map(
    ids.map((id) => [id, store.events(id).map(({ event, at }) => ({ event, at }))]),
  )

  await rollbackCopyOf(db, copy)
  db.close()
  return { copy, folder, live, expected: { conversations, transcripts } }
}

async function rollbackCopyOf(db: AppDatabase, to: string): Promise<void> {
  await db.backup(to)
  const copy = new Database(to)
  copy.pragma('journal_mode = DELETE')
  copy.close()
}

function fingerprint(file: string): {
  bytes: number
  mtimeMs: number
  sha256: string
  mode: string
} {
  const stats = statSync(file)
  const bytes = readFileSync(file)
  return {
    bytes: stats.size,
    mtimeMs: stats.mtimeMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mode: `${String(bytes[18])}/${String(bytes[19])}`,
  }
}

describe('the history reader', () => {
  it('lists every conversation, newest activity first, named as the main window names it', async () => {
    const { copy, expected } = await aRestoredCopy()
    const reader = createHistoryReader(copy)
    const listed = await reader.conversations()
    reader.close()

    expect(listed).toEqual(expected.conversations)
    expect(listed).toHaveLength(6)
    const updated = listed.map((one) => one.updatedAt)
    expect(new Set(updated).size, 'the order is decided by the times alone').toBe(listed.length)
    expect([...updated].sort((a, b) => b - a)).toEqual(updated)

    const byId = new Map(listed.map((one) => [one.id, one]))
    expect(byId.get('sess_person')).toMatchObject({
      title: 'W1 · Bakery website',
      agent: 'BroBot',
      provider: 'claude',
    })
    expect(byId.get('sess_helper')).toMatchObject({
      title: 'W1.1 · Draft the menu',
      agent: 'Ada',
      provider: 'codex',
    })
    expect(byId.get('sess_idle')).toMatchObject({ title: null, agent: 'Ada' })
    expect(byId.get('sess_found')).toMatchObject({ agent: null, createdAt: T0 - 60_000 })
    expect(byId.get('sess_found')?.title).toMatch(/^W\d+$/)
    expect(byId.get('sess_bundle')?.agent).toBeNull()
    expect(byId.get('sess_rebuilt')).toMatchObject({ agent: 'designer' })
    expect(byId.get('sess_rebuilt')?.title).toMatch(/^W\d+ · The new title$/)
  })

  it('reads each transcript in order, decoded as the session store decodes it', async () => {
    const { copy, expected } = await aRestoredCopy()
    warn.mockClear()
    const reader = createHistoryReader(copy)
    for (const [id, transcript] of expected.transcripts) {
      expect(await reader.transcript(id), id).toEqual(transcript)
    }

    const person = await reader.transcript('sess_person')
    expect(person.map((one) => one.event.type)).toEqual([
      'user_turn',
      'assistant_message',
      'work_retitled',
      'unknown',
    ])
    expect(person.map((one) => one.at)).toEqual([T0 + 2_000, T0 + 3_000, T0 + 4_000, T0 + 4_500])
    expect(
      JSON.stringify(person[3]?.event).length,
      'the oversized row is bounded on the way out',
    ).toBeLessThan(100_000)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be read and was skipped'))

    expect(await reader.transcript('sess_rebuilt')).toEqual([
      {
        event: { type: 'assistant_message', text: 'From the new reading.' },
        at: T0 - 40_000,
      },
      expect.objectContaining({ event: expect.objectContaining({ title: 'The new title' }) }),
    ])
    expect(await reader.transcript('sess_nobody')).toEqual([])
    reader.close()
  })

  it('changes nothing: the copy keeps its bytes and its time, and nothing appears beside it', async () => {
    const { copy, folder, expected } = await aRestoredCopy()
    expect(readdirSync(folder)).toEqual(['brobot2.sqlite'])
    const before = fingerprint(copy)
    expect(before.mode, 'the copy is in rollback mode').toBe('1/1')

    const reader = createHistoryReader(copy)
    await reader.conversations()
    expect(readdirSync(folder), 'nothing appears while it is open').toEqual(['brobot2.sqlite'])
    for (const id of expected.transcripts.keys()) await reader.transcript(id)
    await reader.conversations()
    reader.close()

    expect(readdirSync(folder)).toEqual(['brobot2.sqlite'])
    expect(fingerprint(copy)).toEqual(before)
  })

  it('refuses a database in WAL mode, and writes nothing beside it', async () => {
    const { live } = await aRestoredCopy()
    const folder = join(dirname(live), 'wal')
    mkdirSync(folder)
    const file = join(folder, 'brobot2.sqlite')
    copyFileSync(live, file)
    const before = fingerprint(file)
    expect(before.mode).toBe('2/2')

    const reader = createHistoryReader(file)
    await expect(reader.conversations()).rejects.toThrow('not in rollback-journal mode')
    await expect(reader.transcript('sess_person')).rejects.toThrow('not in rollback-journal mode')
    reader.close()

    expect(readdirSync(folder)).toEqual(['brobot2.sqlite'])
    expect(fingerprint(file)).toEqual(before)
  })

  it('refuses a copy with a -wal or a -journal beside it, changes neither, and reads it once they are gone', async () => {
    const { copy, folder } = await aRestoredCopy()
    const before = fingerprint(copy)
    const reader = createHistoryReader(copy)

    for (const suffix of ['-journal', '-wal']) {
      const beside = `${copy}${suffix}`
      writeFileSync(beside, Buffer.alloc(4096, 0x5a))
      const besideBefore = fingerprint(beside)
      await expect(reader.conversations()).rejects.toThrow(`${suffix} file beside it`)
      expect(readdirSync(folder).sort()).toEqual(['brobot2.sqlite', `brobot2.sqlite${suffix}`])
      expect(fingerprint(beside)).toEqual(besideBefore)
      expect(fingerprint(copy)).toEqual(before)
      rmSync(beside)
    }

    expect(await reader.conversations()).toHaveLength(6)
    reader.close()
    expect(readdirSync(folder)).toEqual(['brobot2.sqlite'])
    expect(fingerprint(copy)).toEqual(before)
  })

  it('refuses a missing file and a file that is not a database, creating nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-recovery-history-'))
    roots.push(root)

    const missing = createHistoryReader(join(root, 'brobot2.sqlite'))
    await expect(missing.conversations()).rejects.toThrow('there is no database at')
    expect(readdirSync(root)).toEqual([])

    const garbage = join(root, 'garbage.sqlite')
    writeFileSync(garbage, Buffer.alloc(8192, 0x5a))
    await expect(createHistoryReader(garbage).conversations()).rejects.toThrow('is not a database')

    const short = join(root, 'short.sqlite')
    writeFileSync(short, 'SQLite')
    await expect(createHistoryReader(short).transcript('sess_person')).rejects.toThrow(
      'is not a database',
    )

    const folder = join(root, 'a-folder.sqlite')
    mkdirSync(folder)
    await expect(createHistoryReader(folder).conversations()).rejects.toThrow('is not a file')
    expect(readdirSync(root).sort()).toEqual(['a-folder.sqlite', 'garbage.sqlite', 'short.sqlite'])
  })

  it('refuses every read once closed, rather than opening the file again', async () => {
    const { copy } = await aRestoredCopy()
    const opened: string[] = []
    const watching: RecoveryFs = {
      ...nodeFs,
      open: (path, flags, mode) => (opened.push(path), nodeFs.open(path, flags, mode)),
    }

    const unread = createHistoryReader(copy, { fs: watching })
    unread.close()
    await expect(unread.conversations()).rejects.toThrow('the history reader is closed')
    expect(opened, 'a reader closed before it read never looks at the file').toEqual([])

    const reader = createHistoryReader(copy, { fs: watching })
    expect(await reader.conversations()).toHaveLength(6)
    reader.close()
    reader.close()
    await expect(reader.conversations()).rejects.toThrow('the history reader is closed')
    await expect(reader.transcript('sess_person')).rejects.toThrow('the history reader is closed')
    expect(opened).toEqual([copy])
  })

  it('checks and opens the file once when reads arrive together', async () => {
    const { copy, expected } = await aRestoredCopy()
    const opened: string[] = []
    const watching: RecoveryFs = {
      ...nodeFs,
      open: (path, flags, mode) => (opened.push(path), nodeFs.open(path, flags, mode)),
    }
    const reader = createHistoryReader(copy, { fs: watching })
    const [listed, transcript] = await Promise.all([
      reader.conversations(),
      reader.transcript('sess_helper'),
      reader.conversations(),
    ])
    reader.close()

    expect(listed).toEqual(expected.conversations)
    expect(transcript).toEqual(expected.transcripts.get('sess_helper'))
    expect(opened).toEqual([copy])
  })
})
