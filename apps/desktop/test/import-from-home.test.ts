import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime, claudeProjectDirName } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import type { UserHomeDiscovery, UserHomeSession } from '../src/main/adopt/user-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

/**
 * Importing ONE conversation out of a user's provider home (Slice 2 · 047) — the button over 046's
 * path, and what it says when it declines.
 *
 * The point of these tests is that every ending SURFACES as itself: a button that reported "you
 * already have this" as a generic failure would be worse than one that did nothing, because it
 * would send someone hunting a bug in a working import.
 *
 * Fixtures are the synthetic ones 036/043 built. Real transcripts are never committed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const CLAUDE_FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')
const migrations = join(here, '../src/main/db/migrations')

describe('importing one conversation from a provider home', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let discovery: UserHomeDiscovery
  let host: RuntimeHost

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-import-'))
    mkdirSync(join(dir, 'home'), { recursive: true })
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    discovery = { found: [], skipped: [] }

    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      // The person's own file, wherever discovery found it — what a rebuild reads again.
      nativeTranscriptPath: (provider, _home, ref) =>
        discovery.found.find((one) => one.provider === provider && one.sessionId === ref.sessionId)
          ?.path ?? null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // The one seam both the import and the library read the homes through.
      userHomeSessions: () => discovery,
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A transcript on disk, copied from a committed fixture. */
  function plant(sessionId = 'thread-1'): UserHomeSession {
    const path = join(dir, 'home', `${sessionId}.jsonl`)
    writeFileSync(path, readFileSync(CLAUDE_FIXTURE, 'utf8'))
    return {
      provider: 'claude',
      sessionId,
      cwd: join(dir, 'work'),
      path,
      bytes: readFileSync(path).length,
      updatedAt: 2_000,
      createdAt: 1_000,
      profileId: null,
    }
  }

  it('imports a conversation and makes it readable', async () => {
    discovery = { found: [plant()], skipped: [] }

    const result = await host.importUserHomeSession('claude', 'thread-1')

    expect(result.outcome).toBe('imported')
    expect(result.sessionId).not.toBeNull()
    // Read back from the ledger, not inferred from the outcome word.
    expect(result.readable).toBe(true)
    // ⚠️ The STORE, not `latestHistory`, and the difference is load-bearing since 054.
    //
    // Every assertion in this file is about the WHOLE ledger: that a second import wrote nothing,
    // that a grown file is read again only by a rebuild. `latestHistory` returns a bounded
    // PAGE now, so an import that silently doubled the conversation would hand back a page of
    // exactly the same size and all of them would still pass. Reading the ledger directly keeps
    // each test measuring the thing it is named for.
    expect(store.events(result.sessionId!).length).toBeGreaterThan(0)
  })

  it('says "already imported" rather than failing, and writes nothing the second time', async () => {
    discovery = { found: [plant()], skipped: [] }
    const first = await host.importUserHomeSession('claude', 'thread-1')
    const before = store.events(first.sessionId!).length

    const again = await host.importUserHomeSession('claude', 'thread-1')

    // `up-to-date` is not an error.
    expect(again.outcome).toBe('up-to-date')
    expect(again.note).toContain('Already imported')
    expect(again.sessionId).toBe(first.sessionId)
    expect(again.readable).toBe(true)
    expect(store.events(first.sessionId!).length).toBe(before)
  })

  it('a grown conversation is already imported, and a rebuild reads the whole file again', async () => {
    const session = plant()
    discovery = { found: [session], skipped: [] }
    const first = await host.importUserHomeSession('claude', 'thread-1')
    const before = store.events(first.sessionId!).length

    appendFileSync(
      session.path,
      `${JSON.stringify({ type: 'user', sessionId: 'thread-1', cwd: session.cwd, message: { content: 'one more thing' } })}\n`,
    )
    discovery = { found: [{ ...session, bytes: readFileSync(session.path).length }], skipped: [] }

    // An import leaves a conversation it holds as it is: reading it again is a rebuild.
    const again = await host.importUserHomeSession('claude', 'thread-1')
    expect(again.outcome).toBe('up-to-date')
    expect(store.events(first.sessionId!).length).toBe(before)

    const rebuilt = await host.rebuildLedger(first.sessionId!)
    expect(rebuilt.outcome).toBe('imported')
    expect(store.events(first.sessionId!).length).toBeGreaterThan(before)
    expect(rebuilt.status?.derived).toBe('current')
  })

  it('a rebuild of a conversation whose file is gone is refused, and keeps what was read', async () => {
    const session = plant()
    discovery = { found: [session], skipped: [] }
    const first = await host.importUserHomeSession('claude', 'thread-1')
    const held = store.events(first.sessionId!).length
    expect(held).toBeGreaterThan(0)

    rmSync(session.path)
    discovery = { found: [], skipped: [] }

    const rebuilt = await host.rebuildLedger(first.sessionId!)
    expect(rebuilt.outcome).toBe('gone')
    expect(store.events(first.sessionId!).length).toBe(held)
    expect(rebuilt.status?.present).toBe(true)
  })

  it('says a conversation is gone rather than that the import failed', async () => {
    discovery = { found: [], skipped: [] }

    const result = await host.importUserHomeSession('claude', 'thread-vanished')

    // Not an outcome of importing at all — an outcome of LOOKING. Reporting "failed" for a file the
    // provider has deleted would send someone looking for a bug that is not there.
    expect(result.outcome).toBe('missing')
    // 169 §2 · it names the program whose folder it is, and the repo's own word for that folder is
    // gone from the sentence a person reads.
    expect(result.note).toContain("no longer in Claude's own folder")
    expect(result.note).not.toContain('provider home')
    expect(result.readable).toBe(false)
  })

  it('does not import a conversation from a different provider under the same id', async () => {
    discovery = { found: [plant()], skipped: [] }
    // The id matches; the provider does not. Ids are only unique WITHIN a provider, so a merge or a
    // lookup that ignored the provider would import the wrong conversation.
    const result = await host.importUserHomeSession('codex', 'thread-1')
    expect(result.outcome).toBe('missing')
  })

  describe('🔒 import work never overlaps', () => {
    it('serializes imports issued together instead of racing them', async () => {
      const sessions = ['thread-1', 'thread-2', 'thread-3'].map(plant)
      discovery = { found: sessions, skipped: [] }

      // Four imports issued together, two of the same conversation. If they interleaved, both of
      // those would read the ledger as empty and the loser would collide on `(session_id, ordinal)`.
      const results = await Promise.all([
        host.importUserHomeSession('claude', 'thread-1'),
        host.importUserHomeSession('claude', 'thread-2'),
        host.importUserHomeSession('claude', 'thread-2'),
        host.importUserHomeSession('claude', 'thread-3'),
      ])

      // Whichever ran first, each reports a real outcome and never an error.
      expect(results.map((one) => one.outcome).sort()).toEqual(
        ['imported', 'imported', 'imported', 'up-to-date'].sort(),
      )
      expect(results.every((one) => one.readable)).toBe(true)

      // Every conversation ends up recorded exactly once.
      const rows = store.recorded()
      expect(rows).toHaveLength(3)
      expect(new Set(rows.map((row) => row.providerSessionId)).size).toBe(3)
    })
  })

  describe('🔒 what the review found', () => {
    it('keeps a row’s id UNCHANGED across the import that gives it a record', async () => {
      discovery = { found: [plant()], skipped: [] }

      const before = (await host.listLibrary()).entries[0]
      await host.importUserHomeSession('claude', 'thread-1')
      const after = (await host.listLibrary()).entries[0]

      // The id is the PROVIDER's identity, so it survives the one event that changes everything
      // else about the row. It used to be OUR row id — null until the import lands — so it moved at
      // exactly the moment the outcome arrived: the surface keys the import result by this id, and
      // a successful import silently discarded its own confirmation while a failed one kept it.
      expect(after?.id).toBe(before?.id)
      // And the fact that SHOULD change, changes.
      expect(before?.recordId).toBeNull()
      expect(after?.recordId).not.toBeNull()
    })

    it('refuses to start import work once the app has begun shutting down', async () => {
      discovery = { found: [plant('thread-1'), plant('thread-2')], skipped: [] }

      host.stopSweeping()
      const imported = await host.importUserHomeSession('claude', 'thread-1')

      // Nothing recorded: the quit closes the database next, so work that starts after it would
      // write into a dead connection.
      expect(imported.outcome).toBe('stopped')
      expect(store.recorded()).toEqual([])
      expect(imported.readable).toBe(false)
      expect(imported.sessionId).toBeNull()
    })
  })

  describe('the library sees the result', () => {
    it('moves a row from "not imported" to readable once it is imported', async () => {
      discovery = { found: [plant()], skipped: [] }

      const before = await host.listLibrary()
      expect(before.entries[0]).toMatchObject({ recordId: null, readable: false })
      expect(before.counts.notImported).toBe(1)

      await host.importUserHomeSession('claude', 'thread-1')

      const after = await host.listLibrary()
      expect(after.entries).toHaveLength(1)
      expect(after.entries[0]?.readable).toBe(true)
      expect(after.counts).toMatchObject({ imported: 1, notImported: 0 })
    })
  })
})

/**
 * 119 · Two things a row we already hold needed, and did not have.
 *
 * ⚑ **D-017b · the cheap path (`libraryEntry`, `118` §7.4) is gone with the Read press it served**:
 * a recorded conversation opens in its one full view (`RuntimeHost.look`), so its cases went with it.
 *
 * **Import on the row** (`118` §8.3, PM ruling: *"put it on the row"*). An adopted row whose
 * transcript we do not hold has said *"prior messages not imported yet"* since 087, with no
 * control anywhere that performed it — ⛔ `106`'s unwired control wearing the other face.
 */
describe('one row, without reading a provider home (119)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let discovery: UserHomeDiscovery
  let host: RuntimeHost
  /**
   * ⚑ **710** — the import's own read failing, the way a read with no process slot or file handle
   * does. ⚑ Planted on the transcript's lookup: an import reads files and asks for no credential, so
   * it never reaches the launch call (`prepareProviderHome`).
   */
  let readFails: (() => Error) | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-entry-'))
    mkdirSync(join(dir, 'home'), { recursive: true })
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    discovery = { found: [], skipped: [] }
    readFails = undefined

    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      // ⚠️ The REAL one here, unlike the suite above: an import that cannot find the provider's
      // file would report `skipped` for the wrong reason and every assertion would still pass.
      nativeTranscriptPath: (provider, home, ref) => {
        if (readFails !== undefined) throw readFails()
        return nativeTranscriptPath(provider, home, ref)
      },
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(dir, 'homes', profileId ?? 'none', provider),
      providerHomePath: (provider, profileId) => join(dir, 'homes', profileId ?? 'none', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
      userHomeSessions: () => discovery,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** An app-owned adopted child: found in a home we provisioned, so it carries a profile. */
  function adoptChild(sessionId = 'sess_child'): void {
    store.adopt({
      id: sessionId,
      provider: 'claude',
      sessionId: `${sessionId}-thread`,
      cwd: join(dir, 'work'),
      profileId: 'default',
      updatedAt: 2_000,
      createdAt: 1_000,
      child: { parentSessionId: 'parent-thread', depth: 1, nickname: 'Turing' },
    })
  }

  /** That row's provider transcript, filed where the import will look for it. */
  function plantOwnTranscript(sessionId = 'sess_child'): void {
    const home = join(dir, 'homes', 'default', 'claude')
    const projectDir = join(home, 'projects', claudeProjectDirName(join(dir, 'work')))
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      join(projectDir, `${sessionId}-thread.jsonl`),
      readFileSync(CLAUDE_FIXTURE, 'utf8'),
    )
  }

  describe('import, on the row that has been naming it', () => {
    it('brings the prior messages in, and the row can be read afterwards', async () => {
      adoptChild()
      plantOwnTranscript()
      expect(
        store.recorded()[0]?.hasTranscript,
        'the fixture must start with nothing to read',
      ).toBe(false)

      const result = await host.importRecordedSession('sess_child')

      expect(result.outcome).toBe('imported')
      // Read back off the ledger, never inferred from the outcome word.
      expect(result.readable).toBe(true)
      expect(result.note).toContain('here now')
      expect(store.events('sess_child').length).toBeGreaterThan(0)
      expect(store.recorded()[0]?.hasTranscript).toBe(true)
    })

    it('a second press says "already here" and writes nothing', async () => {
      adoptChild()
      plantOwnTranscript()
      await host.importRecordedSession('sess_child')
      const before = store.events('sess_child').length

      const again = await host.importRecordedSession('sess_child')

      expect(again.outcome).toBe('skipped')
      expect(again.readable).toBe(true)
      expect(again.note).toContain('already here')
      expect(store.events('sess_child')).toHaveLength(before)
    })

    it('⚠️ a row whose provider file is gone is told so, and nothing is invented', async () => {
      adoptChild()
      // No transcript planted: the conversation was adopted and its file has since gone.
      const result = await host.importRecordedSession('sess_child')

      expect(result.outcome).toBe('skipped')
      expect(result.readable).toBe(false)
      expect(result.note).toContain('nothing of this conversation')
      expect(store.events('sess_child')).toHaveLength(0)
    })

    it('⛔ refuses a row from the user’s OWN home, and names the control that can', async () => {
      // ⚠️ **Unreachable from the button and guarded anyway** (review). `find()` deliberately keeps
      // returning rows the reopen list drops, so this command — which takes any id — can be handed
      // one. Without the guard it would resolve the home as `DEFAULT_PROFILE_ID`, PROVISION a
      // directory that has never held this conversation, find nothing, and report "there is nothing
      // of this conversation in its provider home to import" about a file sitting in `~/.codex`.
      store.adopt({
        id: 'sess_theirs',
        provider: 'claude',
        sessionId: 'their-thread',
        cwd: join(dir, 'work'),
        // No profile: `user-homes.ts` blanks it on everything it finds in the user's own homes.
        profileId: null,
        updatedAt: 2_000,
        createdAt: 1_000,
      })

      const result = await host.importRecordedSession('sess_theirs')

      expect(result.outcome).toBe('user-home')
      expect(result.note).toContain('Library')
      expect(store.events('sess_theirs')).toHaveLength(0)
      // ⛔ …and it did not go and make the home it would have looked in.
      expect(existsSync(join(dir, 'homes', 'default', 'claude'))).toBe(false)

      // The paired positive, through the same call: a row we really do own still imports.
      adoptChild()
      plantOwnTranscript()
      expect((await host.importRecordedSession('sess_child')).outcome).toBe('imported')
    })

    it('⚠️ reads what is whole of a file still being written, and leaves its last line', async () => {
      // An unterminated last line is the ordinary shape of a sub-agent whose parent is still
      // running: the lines before it are read, and that one is not a record yet.
      adoptChild()
      plantOwnTranscript()
      const path = join(
        dir,
        'homes',
        'default',
        'claude',
        'projects',
        claudeProjectDirName(join(dir, 'work')),
        'sess_child-thread.jsonl',
      )
      appendFileSync(path, '{"type":"user","message":{"content":"half a li')

      const result = await host.importRecordedSession('sess_child')

      expect(result.outcome).toBe('still-writing')
      expect(result.readable).toBe(false)
      // ⛔ The half line is not a record: nothing read it as an unreadable one.
      const texts = store.events('sess_child').map((one) => JSON.stringify(one.event))
      expect(texts.some((text) => text.includes('half a li'))).toBe(false)
    })

    it('names an id it does not hold rather than failing silently', async () => {
      const result = await host.importRecordedSession('sess_nobody')
      expect(result).toMatchObject({ outcome: 'unknown-session', readable: false })
    })

    it('⛔ refuses a conversation that is open right now, and leaves its ledger alone', async () => {
      // Its live tail is not in the provider's file yet, and the ledger a projection would be
      // written into is the one the session machine is recording. Same refusal, same words, as
      // `rebuildLedger` — and the same reason it is a refusal rather than a race.
      const sink: RuntimeEventSink = {
        ownerId: 'owner:1',
        aPersonIsBehindIt: false,
        alive: true,
        send: () => {},
        sendLiveness: () => {},
      }
      const live = await host.createSession({ provider: 'claude', cwd: join(dir, 'work') }, sink)

      const result = await host.importRecordedSession(live.sessionId)

      expect(result.outcome).toBe('in-use')
      expect(result.note).toContain('being recorded')
      // ⚠️ **The paired positive**: the same host imports the row that is NOT open, through the
      // same call, so `in-use` cannot be what this host says to everything.
      adoptChild()
      plantOwnTranscript()
      expect((await host.importRecordedSession('sess_child')).outcome).toBe('imported')
      await host.closeAll()
    })

    it('⛔ refuses once the app is going away, and says the file is not going anywhere', async () => {
      adoptChild()
      plantOwnTranscript()
      host.stopSweeping()

      const result = await host.importRecordedSession('sess_child')

      expect(result.outcome).toBe('refused')
      // ⚠️ **The paired positive**: nothing was started, so nothing landed — a `refused` that had
      // quietly imported anyway would satisfy the outcome check on its own.
      expect(store.events('sess_child')).toHaveLength(0)
      expect(result.note).toContain('not going anywhere')
    })

    /**
     * 🔴 **710 · second review — a machine that ran short, at a row's Import and at the catch-up
     * sweep.** `710` made the Keychain read THROW a shortage (R52), and both doors printed what they
     * caught: *"it could not be imported: spawnSync security EAGAIN"*. ⚑ Now a clause a person can
     * read; the log keeps the errno. ⚠️ An import asks for no credential any more, so no Keychain read
     * reaches these doors; the shortage is planted on the read an import still makes, in the errno
     * shape `710` measured.
     */
    const noProcessSlot = (): Error =>
      Object.assign(new Error('spawnSync security EAGAIN'), {
        code: 'EAGAIN',
        syscall: 'spawnSync security',
      })

    it('🔴 an Import the machine ran short for says so — never the errno', async () => {
      adoptChild()
      plantOwnTranscript()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      readFails = noProcessSlot
      const result = await host.importRecordedSession('sess_child')
      expect(result.outcome).toBe('failed')
      expect(result.note).toContain('this machine ran short of open files, processes or memory')
      expect(result.note).not.toMatch(/EAGAIN|spawnSync/)
    })

    it('⚑ control: an Import that failed for another reason still says it', async () => {
      adoptChild()
      plantOwnTranscript()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      readFails = () => new Error('the disk said no')
      const result = await host.importRecordedSession('sess_child')
      expect(result.outcome).toBe('failed')
      expect(result.note).toContain('the disk said no')
    })

    /**
     * 🔴 **716 · R66 at the same door — a folder the disk refused, in words** (review of `716`), and
     * ⚑ its control: an `open` refused HERE stays its own words, because Import also READS
     * transcripts and Node does not say which way it opened (round two of the review). ⚠️ An import
     * makes no folder any more; the refusal is planted on its read, and kept because these doors
     * share `howAFailureReads` with the launches that do make one.
     */
    it('🔴 an Import that meets a folder the disk refused says which folder, and why', async () => {
      adoptChild()
      plantOwnTranscript()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      readFails = () =>
        Object.assign(new Error('EACCES: permission denied, mkdir'), {
          code: 'EACCES',
          syscall: 'mkdir',
          path: '/x/provider-homes/claude',
        })
      const result = await host.importRecordedSession('sess_child')
      expect(result.outcome).toBe('failed')
      expect(result.note).toContain(
        'BroCrew could not make the folder /x/provider-homes/claude, because it may not write in /x/provider-homes. Give BroCrew permission to write to that folder',
      )
    })

    it('⚑ control: an `open` refused at Import is not taken for a write — it may be a transcript read', async () => {
      adoptChild()
      plantOwnTranscript()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      readFails = () =>
        Object.assign(new Error('EACCES: permission denied, open'), {
          code: 'EACCES',
          syscall: 'open',
          path: '/x/transcript.jsonl',
        })
      const result = await host.importRecordedSession('sess_child')
      expect(result.outcome).toBe('failed')
      expect(result.note).toContain('EACCES: permission denied, open')
      expect(result.note).not.toContain('could not write')
    })

    it('🔴 the catch-up import the machine ran short for says so in its skipped list — never the errno', async () => {
      adoptChild()
      plantOwnTranscript()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      readFails = noProcessSlot
      const report = await host.adoptSessions()
      const why = report.skipped.map((one) => one.reason)
      expect(why).toContain(
        'could not be imported: this machine ran short of open files, processes or memory',
      )
      expect(why.join(' ')).not.toMatch(/EAGAIN|spawnSync/)
    })
  })
})
