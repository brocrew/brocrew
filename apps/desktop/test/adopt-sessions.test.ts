import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { ClaudeRuntime, FakeRuntime, claudeProjectDirName, parseSessionRef } from '@brobot2/runtime'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  discoverCodexSessions,
  discoverSessionsIn,
  type ChildDescent,
  type Discovery,
} from '../src/main/adopt/discover-sessions'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, mergeDescent, type SessionStore } from '../src/main/db/session-store'
import { readLibrary } from '../src/main/library/session-library'
import { listProviderHomes } from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

/**
 * Adopting a conversation that already exists in a provider home (087).
 *
 * Fixtures match provider storage shapes: a Claude `.jsonl` with cwd several records in, and
 * a Codex `threads` row. Adopted conversations must be resumable, failures must be reported,
 * and repeated scans must not duplicate entries.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

/**
 * 🔴 **722 · a scripted Claude `Query`** — the shape `plan-floor-durable.test.ts` drives the REAL
 * adapter with. ⚑ It never says `system/init`, which is the whole of R79's case: the CLI wrote a
 * transcript and nothing it said about it reached the adapter.
 */
class ScriptedQuery {
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private reject: ((error: Error) => void) | null = null
  private done = false
  private failure: Error | null = null
  end(): void {
    this.done = true
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: undefined as never, done: true })
    }
  }
  /** 727 · the CLI dies before its first init — the stream the adapter reads throws. */
  fail(error: Error): void {
    this.failure = error
    if (this.reject) {
      const reject = this.reject
      this.reject = null
      this.resolve = null
      reject(error)
    }
  }
  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.end()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: (): Promise<IteratorResult<SDKMessage>> =>
        this.failure !== null
          ? Promise.reject(this.failure)
          : this.done
            ? Promise.resolve({ value: undefined as never, done: true })
            : new Promise((resolve, reject) => {
                this.resolve = resolve
                this.reject = reject
              }),
    }
  }
}

/** 722 · a person's window — the front door `717` step 10 sent from and closed. */
class APersonsWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly ownerId = 'owner:722'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

describe('adopting existing sessions', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore

  /** A Claude transcript, filed exactly where Claude files it. */
  function writeClaudeTranscript(
    profileId: string,
    sessionId: string,
    cwd: string,
    options: { dirName?: string; records?: unknown[]; mtimeMs?: number } = {},
  ): string {
    const home = join(userData, 'provider-homes', 'default', profileId, 'claude')
    const projectDir = join(home, 'projects', options.dirName ?? claudeProjectDirName(cwd))
    mkdirSync(projectDir, { recursive: true })
    const path = join(projectDir, `${sessionId}.jsonl`)
    const records = options.records ?? [
      // The first records carry no cwd at all — measured, not assumed.
      { type: 'queue-operation', operation: 'enqueue', sessionId },
      { type: 'queue-operation', operation: 'dequeue', sessionId },
      { type: 'user', sessionId, cwd, message: { role: 'user', content: 'hello' } },
      { type: 'assistant', sessionId, cwd, message: { role: 'assistant', content: 'hi' } },
    ]
    writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n')
    if (options.mtimeMs !== undefined) {
      const seconds = options.mtimeMs / 1000
      utimesSync(path, seconds, seconds)
    }
    return path
  }

  /** A Codex home with its state database and the rollout files its threads point at. */
  function writeCodexThreads(
    profileId: string,
    threads: {
      id: string
      cwd: string
      archived?: number
      updatedAt?: number
      rolloutExists?: boolean
      /**
       * `threads.source` — how the thread was started. The ordinary values are `app-server`,
       * `vscode`, `cli` and `exec`; a `{"subagent":{…}}` payload here is how Codex records that
       * another agent spawned it (111), and it is the signal this fixture needs to plant a real
       * child rather than a hand-written `child_descent` column.
       */
      source?: string
    }[],
  ): string {
    const home = join(userData, 'provider-homes', 'default', profileId, 'codex')
    mkdirSync(join(home, 'sessions'), { recursive: true })
    const state = new Database(join(home, 'state_5.sqlite'))
    // ⚑ **`IF NOT EXISTS` + `INSERT OR REPLACE` so a home can be REWRITTEN between scans** (119).
    // The back-fill is a claim about what a SECOND look at the same conversation does, and the
    // only honest way to plant "the provider says something different now" is to say it in the
    // provider's own state database and scan again.
    state.exec(
      `CREATE TABLE IF NOT EXISTS threads (
         id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL,
         cwd TEXT NOT NULL, title TEXT NOT NULL, sandbox_policy TEXT NOT NULL,
         approval_mode TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
         created_at_ms INTEGER, updated_at_ms INTEGER)`,
    )
    for (const thread of threads) {
      const rollout = join(home, 'sessions', `rollout-${thread.id}.jsonl`)
      if (thread.rolloutExists !== false) writeFileSync(rollout, '{}\n')
      state
        .prepare(
          `INSERT OR REPLACE INTO threads (id, rollout_path, created_at, updated_at, source, model_provider,
             cwd, title, sandbox_policy, approval_mode, archived, updated_at_ms)
           VALUES (?, ?, 1, 2, ?, 'openai', ?, 't', 'workspace-write', 'on-request', ?, ?)`,
        )
        .run(
          thread.id,
          rollout,
          thread.source ?? 'app-server',
          thread.cwd,
          thread.archived ?? 0,
          thread.updatedAt ?? null,
        )
    }
    state.close()
    return home
  }

  /** Discovery across every home the app owns — the same walk the real app wires up. */
  function discoverEverything(): Discovery {
    return listProviderHomes(userData)
      .map((home) => discoverSessionsIn(home.provider, home.path, home.profileId))
      .reduce<Discovery>(
        (all, part) => ({
          found: [...all.found, ...part.found],
          skipped: [...all.skipped, ...part.skipped],
        }),
        { found: [], skipped: [] },
      )
  }

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: discoverEverything,
      // The real reader, over the fixtures this suite writes — archiving and import are part of
      // what a scan does now (088), so the same walk has to see the same files.
      exportDirectory: () => join(userData, 'exports'),
      nativeTranscriptPath,
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_adopted_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-adopt-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('adopts a Claude conversation nobody recorded, reading its cwd from the file', async () => {
    // The cwd cannot come from the directory name: that encoding is lossy (086). It comes from
    // the records, and it is not in the first one.
    const cwd = '/Users/me/Library/Application Support/@brobot2/desktop/scratch/sess_1'
    writeClaudeTranscript('default', 'claude-session-1', cwd, { mtimeMs: 1_700_000_000_000 })

    const report = await buildHost().adoptSessions()

    expect(report).toMatchObject({ found: 1, adopted: 1, alreadyKnown: 0, skipped: [] })
    const [session] = store.resumable()
    expect(session).toMatchObject({ provider: 'claude', cwd, profileId: 'default' })
    expect(session?.ref.sessionId).toBe('claude-session-1')
    // We did not run it, so we do not claim to know how it was run.
    expect(session?.approvalMode).toBeNull()
    expect(session?.adoptedAt).not.toBeNull()
    expect(session?.updatedAt).toBe(1_700_000_000_000)
  })

  it('adopts a Codex thread from the home’s own state database', async () => {
    writeCodexThreads('default', [
      {
        id: '019f9f97-e450-7520-83e2-835ab1515b7b',
        cwd: '/tmp/work',
        updatedAt: 1_700_000_001_000,
      },
    ])

    const report = await buildHost().adoptSessions()

    expect(report).toMatchObject({ found: 1, adopted: 1 })
    const [session] = store.resumable()
    expect(session).toMatchObject({ provider: 'codex', cwd: '/tmp/work' })
    expect(session?.ref.sessionId).toBe('019f9f97-e450-7520-83e2-835ab1515b7b')
    expect(session?.updatedAt).toBe(1_700_000_001_000)
  })

  it('⛔ an app-owned adopted Codex CHILD is not offered Resume, and says why (118)', async () => {
    // An app-owned adopted Codex child must retain its descent through the resume DTO and
    // `toResumable`. A child with `canAcceptDirectInput:false` must not be offered Resume
    // like a parent merely because `RecordedSession` and `LibraryEntry` retain descent while
    // the DTO drops it.
    //
    // The child is planted the way Codex actually records one — a `{"subagent":{…}}` payload in
    // `threads.source` — so the descent travels the real path: discovery reads it, adoption writes
    // it, and `resumable()` is the first place it has ever been able to say anything.
    writeCodexThreads('default', [
      { id: 'parent-thread', cwd: '/tmp/work' },
      {
        id: 'child-thread',
        cwd: '/tmp/work',
        source: JSON.stringify({
          subagent: {
            thread_spawn: { parent_thread_id: 'parent-thread', depth: 1, agent_nickname: 'Turing' },
          },
        }),
      },
    ])

    await buildHost().adoptSessions()
    const rows = store.resumable()
    const child = rows.find((session) => session.ref.sessionId === 'child-thread')
    const parent = rows.find((session) => session.ref.sessionId === 'parent-thread')

    // Both are in the list, and both are app-owned adopted rows — same home, same profile, same
    // scan. The ONLY thing that differs is the descent, which is the point.
    expect(child?.profileId).toBe('default')
    expect(parent?.profileId).toBe('default')
    expect(child?.adoptedAt).not.toBeNull()
    expect(parent?.adoptedAt).not.toBeNull()

    expect(child?.child).toMatchObject({ parentSessionId: 'parent-thread', nickname: 'Turing' })
    expect(child?.resumeRefusal).toContain('sub-agent conversation')

    // ⚠️ **The paired positive, and `116` sharpened `109`'s ruling to insist on it**: an ordinary
    // app-owned adopted PARENT is a different case and is still offered. ⛔ Without this line the
    // assertion above would be satisfied by refusing everything.
    expect(parent?.child).toBeNull()
    expect(parent?.resumeRefusal).toBeNull()
  })

  it('…and the HOST hands both facts to the renderer in the wire shape (118)', async () => {
    // ⚠️ **The one mapped field on this DTO, crossed by nothing until review said so.** The test
    // above asserts `store.resumable()` — the raw `ChildDescent`, with absent keys — and the
    // renderer test hand-builds its own rows. Between them sat `resumableSessions()`'s `.map`,
    // where the descent becomes the library's shape, guarded only by a typecheck.
    writeCodexThreads('default', [
      { id: 'parent-2', cwd: '/tmp/work' },
      {
        id: 'child-2',
        cwd: '/tmp/work',
        source: JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: 'parent-2' } } }),
      },
    ])
    const host = buildHost()
    await host.adoptSessions()
    const rows = host.resumableSessions()
    const child = rows.find((row) => row.ref.sessionId === 'child-2')

    // ⚑ **Every absent field an explicit `null`** — the library's own rule, so a renderer never has
    // to check two shapes for one fact. The provider named a parent and nothing else.
    expect(child?.child).toEqual({
      parentSessionId: 'parent-2',
      depth: null,
      nickname: null,
      role: null,
    })
    expect(child?.resumeRefusal).toContain('sub-agent conversation')
    expect(rows.find((row) => row.ref.sessionId === 'parent-2')?.child).toBeNull()
  })

  it('⛔ and the HOST refuses to reopen one, not just the button (118)', async () => {
    // ⚠️ **The refusal shipped as a `v-if` and nothing else**, while `reopenSession`'s own comment
    // twelve lines up says why that is not enough: *"IPC does not restrict `resume` to the
    // resumable list"*. Anything holding the id — a stale renderer, a replayed command, a smoke
    // step pressing by id — would reopen a thread the app has just said cannot take input.
    writeCodexThreads('default', [
      { id: 'parent-3', cwd: '/tmp/work' },
      {
        id: 'child-3',
        cwd: '/tmp/work',
        source: JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: 'parent-3' } } }),
      },
    ])
    const host = buildHost()
    await host.adoptSessions()
    const idOf = (thread: string) =>
      store.resumable().find((row) => row.ref.sessionId === thread)!.sessionId

    await expect(host.resumeSession(idOf('child-3'), new NullSink(), null)).rejects.toThrow(
      /sub-agent conversation/,
    )
    // ⚠️ **The paired positive, and it is the one that matters**: the guard must refuse the child
    // and nothing else, or this is "resume is broken" wearing a green tick.
    //
    // ⚠️ **It asserts the parent gets PAST the guard rather than that it resumes.** `FakeRuntime`
    // refuses a ref it never issued, so an adopted conversation cannot complete a resume in this
    // suite at all — and reaching that refusal is itself the proof, because it lives downstream of
    // the check. Asserting a resolve here would be asserting the fake, not the rule.
    await expect(host.resumeSession(idOf('parent-3'), new NullSink(), null)).rejects.toThrow(
      /unknown session/,
    )
  })

  it('records the profile whose home it was found in, so resume reopens in that home', async () => {
    // The profile is read off the path, not off whatever was selected when the scan ran — 085
    // made the home the memory boundary, and an adopted session has to land back in its own.
    writeClaudeTranscript('work', 'claude-in-work', '/tmp/work-project')

    await buildHost().adoptSessions()
    expect(store.resumable()[0]?.profileId).toBe('work')
  })

  it('adopts what it finds once, however many times it is asked', async () => {
    writeClaudeTranscript('default', 'claude-session-1', '/tmp/one')
    writeCodexThreads('default', [{ id: 'codex-thread-1', cwd: '/tmp/two' }])
    const host = buildHost()

    expect(await host.adoptSessions()).toMatchObject({ found: 2, adopted: 2, alreadyKnown: 0 })
    expect(await host.adoptSessions()).toMatchObject({ found: 2, adopted: 0, alreadyKnown: 2 })

    expect(store.resumable()).toHaveLength(2)
  })

  it('does not adopt a session this app already started itself', async () => {
    // The row already exists with the same provider ref; adopting again would offer the same
    // conversation twice, and the second row would have no ledger behind it.
    const host = buildHost()
    const created = await host.createSession(
      { provider: 'claude', cwd: '/tmp/live' },
      new NullSink(),
    )
    const ref = created.ref
    expect(ref).not.toBeNull()
    writeClaudeTranscript('default', ref?.sessionId ?? 'x', '/tmp/live')

    expect(await host.adoptSessions()).toMatchObject({ found: 1, adopted: 0, alreadyKnown: 1 })
    await host.closeAll()
  })

  it('will not adopt a transcript whose cwd does not lead back to it', async () => {
    // Resume probes `<home>/projects/<claudeProjectDirName(cwd)>/<id>.jsonl`. A file whose
    // recorded cwd does not encode back to the folder it sits in cannot be found that way, so
    // adopting it would offer a session that reports itself missing the moment it is opened.
    writeClaudeTranscript('default', 'misfiled', '/tmp/real-cwd', {
      dirName: '-tmp-somewhere-else',
    })

    const report = await buildHost().adoptSessions()

    expect(report).toMatchObject({ found: 0, adopted: 0 })
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0]?.reason).toContain('does not map to this folder')
    expect(store.resumable()).toEqual([])
  })

  it('will not adopt a transcript that names no working directory', async () => {
    writeClaudeTranscript('default', 'no-cwd', '/tmp/whatever', {
      records: [{ type: 'queue-operation', sessionId: 'no-cwd' }],
      dirName: claudeProjectDirName('/tmp/whatever'),
    })

    const report = await buildHost().adoptSessions()

    expect(report.skipped[0]?.reason).toContain('no record in it names a working directory')
    expect(store.resumable()).toEqual([])
  })

  it('will not adopt a Codex thread whose transcript has gone, or one that was archived', async () => {
    writeCodexThreads('default', [
      { id: 'gone', cwd: '/tmp/a', rolloutExists: false },
      { id: 'archived', cwd: '/tmp/b', archived: 1 },
      { id: 'keeper', cwd: '/tmp/c' },
    ])

    const report = await buildHost().adoptSessions()

    expect(report.adopted).toBe(1)
    expect(store.resumable()[0]?.ref.sessionId).toBe('keeper')
    // The third reason is new in 043 and is an improvement, not a regression: Codex transcripts are
    // now IMPORTED rather than skipped wholesale, so a rollout that holds no conversation says so —
    // the same note Claude's have always produced. This fixture's rollout is literally `{}`, so
    // "no readable conversation" is the honest answer, and the pointer is still adopted.
    expect(report.skipped.map((entry) => entry.reason).sort()).toEqual([
      'archived in Codex',
      'its provider file holds no readable conversation',
      'its transcript is no longer on disk',
    ])
  })

  it('will not adopt the session it is running right now', async () => {
    // Claude names a session only on its first turn, so between `createSession` and that name
    // arriving the row has no ref while the transcript is already on disk. A scan in that
    // window used to see an orphan and record a second pointer to the live conversation.
    const host = buildHost({
      // A runtime that never announces a ref, which is exactly that window held open.
      createRuntime: (provider) => {
        const runtime = new FakeRuntime(provider)
        return {
          provider,
          resume: (ref, options) => runtime.resume(ref, options),
          listModels: (context) => runtime.listModels(context),
          start: async (options) => {
            const handle = await runtime.start(options)
            // ⚠️ `defineProperty`, not `Object.assign` (199). `FakeSessionHandle.ref` became an
            // accessor when a `conversation_reset` was given the power to move it, and assigning
            // through a delegating object hits the inherited getter and throws. Defining an own
            // data property is what this double meant all along: shadow the handle's answer with
            // `null`, and leave the handle itself untouched.
            return Object.defineProperty(Object.create(handle) as typeof handle, 'ref', {
              value: null,
              enumerable: true,
            })
          },
        }
      },
    })
    const cwd = join(dir, 'live-work')
    const created = await host.createSession({ provider: 'claude', cwd }, new NullSink())
    expect(created.ref).toBeNull()
    writeClaudeTranscript('default', 'the-live-one', cwd)

    const report = await host.adoptSessions()

    expect(report).toMatchObject({ found: 1, adopted: 0, alreadyKnown: 1 })
    // One conversation, one row: the live session's own. (Its ref arrives on the event stream
    // even while the handle has none, which is why the cwd is what has to be matched here.)
    expect(db.prepare('SELECT count(*) AS c FROM provider_session').get()).toEqual({ c: 1 })
    expect(store.resumable().filter((session) => session.adoptedAt !== null)).toEqual([])
    await host.closeAll()
  })

  it('carries a newer provider timestamp onto a session it already knows', async () => {
    // The list is ordered by this. A pointer frozen at the moment it was adopted would sink
    // below conversations it is now more recent than.
    const path = writeClaudeTranscript('default', 'touched-later', '/tmp/touched', {
      mtimeMs: 1_700_000_000_000,
    })
    const host = buildHost()
    await host.adoptSessions()
    expect(store.resumable()[0]?.updatedAt).toBe(1_700_000_000_000)

    utimesSync(path, 1_800_000_000, 1_800_000_000)
    expect(await host.adoptSessions()).toMatchObject({ adopted: 0, alreadyKnown: 1 })

    expect(store.resumable()[0]?.updatedAt).toBe(1_800_000_000_000)
  })

  it('records when the conversation began, from the provider rather than from the clock', async () => {
    writeCodexThreads('default', [{ id: 'aged', cwd: '/tmp/aged', updatedAt: 1_700_000_002_000 }])
    await buildHost().adoptSessions()
    const row = db
      .prepare('SELECT created_at, updated_at, adopted_at FROM provider_session')
      .get() as { created_at: number; updated_at: number; adopted_at: number }
    // created_at is the thread's own start (seconds → ms), not the moment we noticed it…
    expect(row.created_at).toBe(1000)
    expect(row.updated_at).toBe(1_700_000_002_000)
    // …and when WE recorded it has its own column.
    expect(row.adopted_at).toBeGreaterThan(1_700_000_002_000)
  })

  it('keeps reading a transcript whose working directory has a multi-byte character in it', async () => {
    // A cwd can hold any character, and one straddling a read boundary would decode to
    // nonsense — which would then fail the folder check and drop a perfectly good session.
    const cwd = '/tmp/naïve-café-日本語'
    const padding = { type: 'queue-operation', operation: 'x'.repeat(70_000) }
    writeClaudeTranscript('default', 'multi-byte', cwd, {
      records: [padding, { type: 'user', sessionId: 'multi-byte', cwd }],
    })

    const report = await buildHost().adoptSessions()

    expect(report).toMatchObject({ found: 1, adopted: 1 })
    expect(store.resumable()[0]?.cwd).toBe(cwd)
    // The records here are padding and a bare envelope, so there is no conversation to import —
    // said out loud (088) rather than left as a row that silently shows nothing.
    expect(report.skipped.map((entry) => entry.reason)).toEqual([
      'its provider file holds no readable conversation',
    ])
  })

  it('reports a Codex home it cannot read instead of pretending it is empty', () => {
    const home = join(userData, 'provider-homes', 'default', 'default', 'codex')
    mkdirSync(home, { recursive: true })
    // A file with the right name that is not a database at all.
    writeFileSync(join(home, 'state_5.sqlite'), 'not a database')

    const { found, skipped } = discoverCodexSessions(home, 'default')

    expect(found).toEqual([])
    expect(skipped).toHaveLength(1)
    // One reason since 046: the index is read through a private copy (a `readonly` open of a WAL
    // database writes a `-shm` beside it), so "could not be copied", "could not be opened" and
    // "has no readable threads" all arrive as one failure and picking between them would be a guess.
    expect(skipped[0]?.reason).toMatch(/could not be read/)
  })

  it('does not read a whole file to learn it is not a transcript', async () => {
    // A file with no line breaks would otherwise be accumulated in memory to its very end.
    const home = join(userData, 'provider-homes', 'default', 'default', 'claude')
    const projectDir = join(home, 'projects', claudeProjectDirName('/tmp/whatever'))
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'binary.jsonl'), 'x'.repeat(3 * 1024 * 1024))

    const report = await buildHost().adoptSessions()

    expect(report.adopted).toBe(0)
    expect(report.skipped[0]?.reason).toContain('no record in it names a working directory')
  })

  it('reads the newest state database, not an older one left beside it', () => {
    const home = writeCodexThreads('default', [{ id: 'current', cwd: '/tmp/current' }])
    // A stale database from an earlier Codex schema, still on disk.
    const old = new Database(join(home, 'state_4.sqlite'))
    old.exec('CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT)')
    old.prepare('INSERT INTO threads VALUES (?, ?, ?)').run('stale', '/nowhere', '/tmp/stale')
    old.close()

    const { found } = discoverCodexSessions(home, 'default')

    expect(found.map((session) => session.sessionId)).toEqual(['current'])
  })

  it('an adopted session resumes through the ordinary path, with the ref it was adopted with', async () => {
    // The point of the pointer: `resume` must reattach to the provider conversation, using the
    // ref manufactured from the files and the home of the profile it was found in.
    writeClaudeTranscript('work', 'adopted-and-resumed', '/tmp/adopted')
    const host = buildHost()
    await host.adoptSessions()
    const [row] = store.resumable()

    const resumedWith: { ref: string; home: string }[] = []
    const resuming = buildHost({
      createRuntime: (provider) => {
        const runtime = new FakeRuntime(provider)
        return {
          provider,
          start: (options) => runtime.start(options),
          listModels: (context) => runtime.listModels(context),
          resume: (ref, options) => {
            resumedWith.push({ ref: ref.sessionId, home: options.providerHome })
            // The Fake refuses refs it never issued (034), so this stands in for the provider
            // that DOES know this conversation — which is the situation adoption describes.
            return runtime.start({ ...options, cwd: ref.cwd })
          },
        }
      },
    })

    const resumed = await resuming.resumeSession(row?.sessionId ?? '', new NullSink())

    expect(resumedWith).toEqual([
      {
        ref: 'adopted-and-resumed',
        home: join(userData, 'provider-homes', 'default', 'work', 'claude'),
      },
    ])
    // 087 opened this with an empty chat; 088 rebuilds it from the archive, so it reopens with
    // the conversation the provider had already recorded.
    expect(resumed.history.entries.map((entry) => entry.event.type)).toEqual([
      'unknown',
      'unknown',
      'user_turn',
      'assistant_message',
    ])
    expect(parseSessionRef(JSON.stringify(resumed.ref)).cwd).toBe('/tmp/adopted')
    await resuming.closeAll()
  })

  describe('🔴 722 · R79 — a conversation this app launched is never adopted as someone else’s', () => {
    // ⚑ `717` F-1, step 10, measured: the front door's Claude conversation was closed 29 ms after
    // its send, before `system/init`; its row kept `external_ref` NULL; the CLI still wrote
    // `07647b98-….jsonl`, opening with this app's own preamble — and the next scan adopted it as
    // `sess_88e89dcc`. One conversation, two rows.
    //
    // ⚠️ **The REAL Claude adapter (and its real `sessionExists`) over a scripted `Query`, the real
    // discovery walk and the real store** — the question is whether the launch, the close and the
    // scan agree about one id. ⚑ The CLI's half is played here: it writes the transcript named by the
    // id the launch ASKED for (`Options.sessionId`, 722) — or, on a launch that named none, by an id
    // of the CLI's own, which is `main`'s case and the RED.
    const MINTED_BY_THE_CLI = '07647b98-1c8e-4095-a2ee-1bc20b1de318'

    const rowOf = (sessionId: string) =>
      db
        .prepare('SELECT cwd, profile_id, external_ref FROM provider_session WHERE id = ?')
        .get(sessionId) as { cwd: string; profile_id: string; external_ref: string | null }

    const claudeRows = (): number =>
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM provider_session WHERE provider = 'claude'")
          .get() as {
          n: number
        }
      ).n

    /**
     * A host whose Claude is the product adapter, the options each launch built, and the message
     * stream each launch hands its CLI (727: read to learn what the ledger held when the CLI could
     * first read anything).
     */
    function claudeHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}): {
      host: RuntimeHost
      query: ScriptedQuery
      launched: Options[]
      prompts: AsyncIterable<unknown>[]
    } {
      const query = new ScriptedQuery()
      const launched: Options[] = []
      const prompts: AsyncIterable<unknown>[] = []
      const host = buildHost({
        createRuntime: () =>
          new ClaudeRuntime((params) => {
            launched.push(params.options)
            prompts.push(params.prompt as AsyncIterable<unknown>)
            return query as never
          }),
        ...overrides,
      })
      return { host, query, launched, prompts }
    }

    /** The CLI's first records under `id`: an enqueue with no folder, then this app's own message. */
    const theCLIsTranscript = (id: string, cwd: string): unknown[] => [
      { type: 'queue-operation', operation: 'enqueue', sessionId: id },
      {
        type: 'user',
        sessionId: id,
        cwd,
        message: {
          role: 'user',
          content:
            'Sent by a person, typed into this app.\n\nReply with exactly the single word: OK.',
        },
      },
    ]

    it('a launch closed before its first init is listed ONCE, and its row names its transcript', async () => {
      const { host, query, launched } = claudeHost()
      const window = new APersonsWindow()
      const created = await host.createSession({ provider: 'claude' }, window)
      await host.send(created.sessionId, 'Reply with exactly the single word: OK.', window)
      const { cwd, profile_id } = rowOf(created.sessionId)
      // ⚑ The CLI's transcript — and no `system/init` ever reaches the adapter.
      const transcriptId = launched[0]?.sessionId ?? MINTED_BY_THE_CLI
      writeClaudeTranscript(profile_id, transcriptId, cwd, {
        records: [
          { type: 'queue-operation', operation: 'enqueue', sessionId: transcriptId },
          {
            type: 'user',
            sessionId: transcriptId,
            cwd,
            message: {
              role: 'user',
              content:
                'Sent by a person, typed into this app.\n\nReply with exactly the single word: OK.',
            },
          },
        ],
      })
      await host.close(created.sessionId, window)
      query.end()
      // ⚑ **The CLOSE names it, measured on its own** (the `727` review): since R87 the scan below
      // would name a row with no ref too, so the close is read before any scan runs.
      expect(
        parseSessionRef(rowOf(created.sessionId).external_ref ?? 'null'),
        'the close named the conversation it launched',
      ).toMatchObject({ sessionId: transcriptId, cwd })

      const report = await host.adoptSessions()

      // ⛔ **RED on `main`**: two rows, `adopted: 1` — this app's own launch listed as another's.
      expect(claudeRows(), 'one conversation, one row').toBe(1)
      expect(report).toMatchObject({ found: 1, adopted: 0, alreadyKnown: 1 })
      // ⚑ …because the row holds the id it launched with — and so it can be reopened.
      const ref = rowOf(created.sessionId).external_ref
      expect(ref, 'the launch’s own id reached the row').not.toBeNull()
      expect(parseSessionRef(ref!)).toEqual({
        provider: 'claude',
        sessionId: transcriptId,
        cwd,
        rotation: 0,
      })
      await host.closeAll()
    })

    it('a scan while that launch is LIVE, before any init, knows its transcript as this app’s own — in whatever folder the CLI recorded', async () => {
      // ⚑ The `722` review: the scan's live-set had the ref (still `null` before init) and the cwd
      // as it was typed. The CLI records the folder it RESOLVED — a `/tmp` or symlinked one as its
      // real path — so neither key matched and the scan adopted the live launch's transcript.
      const { host, query, launched } = claudeHost()
      const window = new APersonsWindow()
      const created = await host.createSession({ provider: 'claude' }, window)
      await host.send(created.sessionId, 'Reply with exactly the single word: OK.', window)
      const { cwd, profile_id } = rowOf(created.sessionId)
      // ⚑ A spelling of the folder that is not the row's — the shape a resolved path has.
      const recorded = cwd.startsWith('/private/') ? cwd.slice('/private'.length) : `/private${cwd}`
      const transcriptId = launched[0]?.sessionId ?? MINTED_BY_THE_CLI
      writeClaudeTranscript(profile_id, transcriptId, recorded)

      const report = await host.adoptSessions()

      // ⛔ **RED on `main` before 722**: `adopted: 1`, a second row for a live conversation. ⚑ Since
      // `727` the row names the launch (`launched_as`), so the scan knows it by the store's own
      // lookup rather than by `722`'s live-set key, which R87 made redundant and removed.
      expect(claudeRows(), 'one conversation, one row').toBe(1)
      expect(report).toMatchObject({ found: 1, adopted: 0, alreadyKnown: 1, named: 0 })
      // ⚑ …and its close names it in the folder the CLI recorded, so a reopen's init agrees.
      await host.close(created.sessionId, window)
      query.end()
      expect(parseSessionRef(rowOf(created.sessionId).external_ref!)).toEqual({
        provider: 'claude',
        sessionId: transcriptId,
        cwd: recorded,
        rotation: 0,
      })
      await host.closeAll()
    })

    it('⛔ control · a launch closed before it SENT anything names nothing, and a PERSON’s transcript beside it is still adopted', async () => {
      // ⚑ Two halves of one negative. The launch's row keeps no ref — the provider holds no
      // transcript under its id, so a reopen would find nothing (011 stands) — and a conversation a
      // person made in the same home and folder is adopted as it always was: what R79 refuses is THIS
      // app's own launch, by its id, never a folder or a home.
      const { host, query } = claudeHost()
      const window = new APersonsWindow()
      const created = await host.createSession({ provider: 'claude' }, window)
      const { cwd, profile_id } = rowOf(created.sessionId)
      await host.close(created.sessionId, window)
      query.end()
      const personsOwn = 'd5c1f0e2-7b3a-4c8e-9f10-2a3b4c5d6e7f'
      writeClaudeTranscript(profile_id, personsOwn, cwd)

      const report = await host.adoptSessions()

      expect(report).toMatchObject({ found: 1, adopted: 1, alreadyKnown: 0 })
      expect(rowOf(created.sessionId).external_ref, 'no transcript, no ref').toBeNull()
      expect(store.resumable().map((row) => row.ref.sessionId)).toEqual([personsOwn])
      await host.closeAll()
    })

    describe('🔴 727 · R87 — a launch is named before the CLI can write', () => {
      // ⚑ `722` §2: the close is R79's only door, so a launch that never CLOSES — the app killed
      // between the CLI's first write and `system/init`, an error before init, a close whose exit
      // receipt timed out — left a transcript no row named, and the next scan adopted it. ⛔ R87:
      // *"The session id a launch hands the CLI is recorded durably BEFORE the CLI [can write]"*.

      it('⚑ the row names the launch before the CLI can read its first message', async () => {
        // ⛔ The CLI writes nothing until a message reaches it (`722`'s probe, never-sent arm), so
        // the moment that matters is the first read of the message stream — and the row must
        // already name the id this launch asked for.
        const { host, query, launched, prompts } = claudeHost()
        const window = new APersonsWindow()
        const created = await host.createSession({ provider: 'claude' }, window)
        const launchedAs = launched[0]?.sessionId
        const first = prompts[0]![Symbol.asyncIterator]().next()
        const namedWhenRead = first.then(
          () =>
            db
              .prepare('SELECT id FROM provider_session WHERE launched_as = ?')
              .get(launchedAs ?? null) as { id: string } | undefined,
        )
        await host.send(created.sessionId, 'Reply with exactly the single word: OK.', window)
        expect(await namedWhenRead).toEqual({ id: created.sessionId })
        query.end()
        await host.closeAll()
      })

      it('🔴 the app KILLED after the CLI wrote: the next launch’s scan knows the transcript as that row’s, and the row can be reopened', async () => {
        const before = claudeHost()
        const window = new APersonsWindow()
        const created = await before.host.createSession({ provider: 'claude' }, window)
        await before.host.send(created.sessionId, 'Reply with exactly the single word: OK.', window)
        const { cwd, profile_id } = rowOf(created.sessionId)
        const transcriptId = before.launched[0]?.sessionId ?? MINTED_BY_THE_CLI
        writeClaudeTranscript(profile_id, transcriptId, cwd, {
          records: theCLIsTranscript(transcriptId, cwd),
        })
        // ⚑ …and a conversation a PERSON made in the same home and folder — the control.
        const personsOwn = 'd5c1f0e2-7b3a-4c8e-9f10-2a3b4c5d6e7f'
        writeClaudeTranscript(profile_id, personsOwn, cwd)
        // ⛔ **Killed here**: no close runs and nothing is announced. The old host's CLI stream ends
        // and it is never asked anything again; the next launch is a new host over the same
        // DATABASE with its own store object (`a-next-launch-test-needs-its-own-store-object`), so
        // nothing of the old host's is shared but the rows on disk.
        before.query.end()
        let restarted = 0
        const after = claudeHost({
          store: createSessionStore(db),
          newSessionId: () => `sess_after_the_kill_${++restarted}`,
        })

        const report = await after.host.adoptSessions()

        // ⛔ **RED on `main`**: `adopted: 2`, three rows — the killed launch listed as another's.
        expect(report).toMatchObject({ found: 2, adopted: 1, alreadyKnown: 1, named: 1 })
        expect(claudeRows(), 'the launch once, the person’s conversation once').toBe(2)
        // ⚑ …and it is REACHABLE: the row carries the ref the scan read, in the folder recorded.
        expect(parseSessionRef(rowOf(created.sessionId).external_ref!)).toEqual({
          provider: 'claude',
          sessionId: transcriptId,
          cwd,
          rotation: 0,
        })
        expect(
          store
            .resumable()
            .map((row) => row.ref.sessionId)
            .sort(),
        ).toEqual([personsOwn, transcriptId].sort())
        await after.host.closeAll()
        await before.host.closeAll()
      })

      it('⚑ a conversation whose ref has MOVED ON (a `/clear`) keeps it — its first transcript is its own, never renamed and never adopted', async () => {
        const { host, query, launched } = claudeHost()
        const window = new APersonsWindow()
        const created = await host.createSession({ provider: 'claude' }, window)
        await host.send(created.sessionId, 'Reply with exactly the single word: OK.', window)
        const { cwd, profile_id } = rowOf(created.sessionId)
        const launchId = launched[0]?.sessionId ?? MINTED_BY_THE_CLI
        writeClaudeTranscript(profile_id, launchId, cwd, {
          records: theCLIsTranscript(launchId, cwd),
        })
        await host.close(created.sessionId, window)
        query.end()
        // ⚑ The ref moves on the way a `/clear` moves it — through the ledger's own door — and the
        // conversation it moved to has a transcript of its own.
        const cleared = {
          provider: 'claude' as const,
          sessionId: 'e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b',
          cwd,
          rotation: 0,
        }
        store.append(
          created.sessionId,
          store.nextOrdinal(created.sessionId),
          { type: 'conversation_reset', ref: cleared, source: 'a /clear, as the test plays it' },
          Date.now(),
        )
        writeClaudeTranscript(profile_id, cleared.sessionId, cwd)

        const report = await host.adoptSessions()

        // ⛔ **RED on `main`**: `adopted: 1` — the conversation's own first life listed as another's.
        expect(report).toMatchObject({ found: 2, adopted: 0, alreadyKnown: 2, named: 0 })
        expect(claudeRows()).toBe(1)
        // ⛔ …and the scan did not take the newer ref back: a named row is never renamed.
        expect(parseSessionRef(rowOf(created.sessionId).external_ref!).sessionId).toBe(
          cleared.sessionId,
        )
        await host.closeAll()
      })

      it('🔴 a launch that ERRORED before its first init is known by the same scan', async () => {
        const heard: string[] = []
        const { host, query, launched } = claudeHost({
          announce: (message) => void heard.push(message.what),
        })
        const window = new APersonsWindow()
        const created = await host.createSession({ provider: 'claude' }, window)
        await host.send(created.sessionId, 'Reply with exactly the single word: OK.', window)
        const { cwd, profile_id } = rowOf(created.sessionId)
        const transcriptId = launched[0]?.sessionId ?? MINTED_BY_THE_CLI
        writeClaudeTranscript(profile_id, transcriptId, cwd, {
          records: theCLIsTranscript(transcriptId, cwd),
        })
        // ⛔ The CLI dies before any init: the machine emits no `session` event on `errored`.
        query.fail(new Error('the CLI exited before its first init'))
        await vi.waitFor(() =>
          expect(
            (
              db
                .prepare('SELECT status FROM provider_session WHERE id = ?')
                .get(created.sessionId) as {
                status: string
              }
            ).status,
          ).toBe('errored'),
        )
        await host.close(created.sessionId, window).catch(() => undefined)
        const heardBefore = heard.length

        const report = await host.adoptSessions()

        // ⚑ …and the scan SAYS it: the row moved from the half a reopen cannot reach to the half it
        // can, with nothing adopted — the one shape only `named` announces (the `727` review).
        expect(heard.slice(heardBefore)).toContain('conversations')
        // ⛔ **RED on `main`**: `adopted: 1` — the errored launch listed as someone else's.
        expect(report).toMatchObject({ found: 1, adopted: 0, alreadyKnown: 1, named: 1 })
        expect(claudeRows()).toBe(1)
        expect(parseSessionRef(rowOf(created.sessionId).external_ref!).sessionId).toBe(transcriptId)
        await host.closeAll()
      })
    })
  })
})

/**
 * 119 · The back-fill — the descent a rescan learns, and the one it refuses to forget.
 *
 * ⛔ **What `118` shipped and what it left.** `111` wrote `child_descent` on INSERT and nowhere
 * else; `118` hung the Resume refusal on that column. So the refusal was correct for every row
 * adopted after migration `0012` and silent for every row adopted before it — *"a correctness rule
 * which only holds for rows recorded after a migration is not a rule."*
 *
 * Every fixture below plants the descent the way Codex actually records one, in `threads.source`,
 * and then REWRITES that home and scans again. Nothing here writes a `child_descent` column by
 * hand: the whole claim is about what the second look does, and a hand-written column would prove
 * only that SQL works.
 */
describe('the descent back-fill (119)', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore

  const SPAWN = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: 'parent-thread', ...extra } } })

  function codexHome(threads: { id: string; source?: string }[]): void {
    const home = join(userData, 'provider-homes', 'default', 'default', 'codex')
    mkdirSync(join(home, 'sessions'), { recursive: true })
    const state = new Database(join(home, 'state_5.sqlite'))
    state.exec(
      `CREATE TABLE IF NOT EXISTS threads (
         id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL,
         cwd TEXT NOT NULL, title TEXT NOT NULL, sandbox_policy TEXT NOT NULL,
         approval_mode TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
         created_at_ms INTEGER, updated_at_ms INTEGER)`,
    )
    for (const thread of threads) {
      const rollout = join(home, 'sessions', `rollout-${thread.id}.jsonl`)
      writeFileSync(rollout, '{}\n')
      state
        .prepare(
          `INSERT OR REPLACE INTO threads (id, rollout_path, created_at, updated_at, source,
             model_provider, cwd, title, sandbox_policy, approval_mode, archived, updated_at_ms)
           VALUES (?, ?, 1, 2, ?, 'openai', '/tmp/work', 't', 'workspace-write', 'on-request', 0, ?)`,
        )
        .run(thread.id, rollout, thread.source ?? 'app-server', 1_700_000_000_000)
    }
    state.close()
  }

  function buildHost(
    overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {},
  ): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: () =>
        listProviderHomes(userData)
          .map((home) => discoverSessionsIn(home.provider, home.path, home.profileId))
          .reduce<Discovery>(
            (all, part) => ({
              found: [...all.found, ...part.found],
              skipped: [...all.skipped, ...part.skipped],
            }),
            { found: [], skipped: [] },
          ),
      exportDirectory: () => join(userData, 'exports'),
      nativeTranscriptPath,
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_bf_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  /** The row for one provider thread, straight out of the store. */
  function row(providerSessionId: string) {
    return store.recorded().find((entry) => entry.providerSessionId === providerSessionId)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-backfill-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('the rule itself, without a database in the way', () => {
    it('fills a NULL from the live answer', () => {
      expect(mergeDescent(null, { parentSessionId: 'p', depth: 1 })).toEqual({
        parentSessionId: 'p',
        depth: 1,
      })
      // Nothing live to say leaves nothing behind either — a row that is not a child stays one.
      expect(mergeDescent(null, undefined)).toBeNull()
    })

    it('⛔ never erases a recorded descent, however thin the live answer', () => {
      const stored = { parentSessionId: 'p', depth: 1, nickname: 'Turing', role: 'worker' }
      // "Not a child, as far as I can tell today" — the case `111` measured three signals for.
      expect(mergeDescent(stored, undefined)).toEqual(stored)
      // `{"subagent":{"other":"guardian"}}` — a child that names no parent. It DECLINED to answer;
      // it did not disagree.
      expect(mergeDescent(stored, {})).toEqual(stored)
      // ⚠️ The field-by-field version of the same rule: `agent_role` stopped being written around
      // 2026-07-20 (114/115), so this is the shape of a real rescan today, not a hypothetical.
      expect(mergeDescent(stored, { parentSessionId: 'p', depth: 1, nickname: 'Turing' })).toEqual(
        stored,
      )
      // ⛔ And an EXPLICIT undefined, which a spread would have copied straight over the top.
      expect(mergeDescent(stored, { nickname: undefined } as ChildDescent)).toEqual(stored)
    })

    it('⛔ a `__proto__` key lands as data, or not at all — never on the prototype', () => {
      // `JSON.parse` produces `__proto__` as a real own property, so a `child_descent` cell holding
      // one reaches this function. An earlier version merged with `Object.assign`, which goes
      // through [[Set]] and would have handed that value to `Object.prototype`'s setter — the row's
      // descent quietly becoming the prototype of every object built from it.
      const hostile = JSON.parse(
        '{"__proto__":{"polluted":true},"nickname":"Turing"}',
      ) as ChildDescent
      const merged = mergeDescent({ depth: 1 }, hostile)!
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
      // ⚠️ **The second half, and the first version of it could not fail** (review): `Object.assign`
      // would have set THIS object's prototype, never `Object.prototype`, so a check on a fresh `{}`
      // passed for both implementations. What distinguishes them is whether the key landed as an own
      // DATA property — which it does through `fromEntries`/spread, and does not through [[Set]].
      expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(true)
      // …and the honest half of the same answer: what the provider DID say still lands.
      expect(merged).toMatchObject({ depth: 1, nickname: 'Turing' })
    })

    it('MERGES an upgrade rather than replacing — chosen, and asserted', () => {
      // More truth beats stale truth (086/104): the live answer has learned a nickname and a
      // parent id. Both land, and the role only we hold survives the same write.
      expect(
        mergeDescent({ depth: 1, role: 'worker' }, { parentSessionId: 'p', nickname: 'Turing' }),
      ).toEqual({ depth: 1, role: 'worker', parentSessionId: 'p', nickname: 'Turing' })
      // A field both sides answer differently: the live one wins, because that is what "more
      // truth" means when there IS a newer answer.
      expect(mergeDescent({ nickname: 'old' }, { nickname: 'new' })).toEqual({ nickname: 'new' })
    })
  })

  it('a rescan fills a NULL descent from the live home (acceptance 2)', async () => {
    // The corpus this exists for: adopted while the row could not carry a descent…
    codexHome([{ id: 'parent-thread' }, { id: 'legacy-child' }])
    const host = buildHost()
    await host.adoptSessions()
    expect(row('legacy-child')?.child, 'the fixture must start from the broken state').toBeNull()
    expect(
      host.resumableSessions().find((entry) => entry.ref.sessionId === 'legacy-child')
        ?.resumeRefusal,
      'and it must start by OFFERING resume — that is the defect',
    ).toBeNull()

    // …and the provider still says whose child it is.
    codexHome([{ id: 'legacy-child', source: SPAWN({ depth: 1, agent_nickname: 'Turing' }) }])
    const report = await buildHost().adoptSessions()

    expect(report.adopted, 'a rescan adopts nothing — these rows are already ours').toBe(0)
    expect(row('legacy-child')?.child).toEqual({
      parentSessionId: 'parent-thread',
      depth: 1,
      nickname: 'Turing',
    })
  })

  it('…and it REPORTS how many, because a caption was about to name that number (121)', async () => {
    /**
     * `120`'s mock draws the scan's freshness note as *"4 new, 153 descents back-filled"*, and
     * the report carried no such field — so the caption would have had to invent one, or print a
     * different number under a descent-shaped label. `106` is the rule; a caption is the same lie
     * told quieter. The count is the STORE's answer, not the loop's: only the store can see the
     * value the merge ran against, so only the store knows whether anything changed.
     */
    // ⚠️ ONE host across the two passes that ADOPT: `newSessionId` counts from zero per host, so
    // two fresh hosts inserting rows would collide on the id rather than on anything under test.
    const host = buildHost()
    codexHome([{ id: 'parent-thread' }, { id: 'kid-a' }, { id: 'kid-b' }, { id: 'plain' }])
    const first = await host.adoptSessions()
    // Adopted while nothing said they were children: four new rows and nothing learned.
    expect(first.adopted).toBe(4)
    expect(first.descentsLearned, 'nothing to learn on the pass that recorded them').toBe(0)

    /**
     * ⚑ **…but a descent written on the INSERT path counts too, and the first version missed it**
     * (review). A home whose children have never been adopted records every descent on the adopt
     * branch, where nothing was counting — so the first scan of such a home would have reported
     * "N adopted" and no descents, about descents it had just written and which the Kind facet was
     * already showing.
     */
    codexHome([{ id: 'newborn', source: SPAWN({ depth: 1, agent_nickname: 'Hopper' }) }])
    const born = await host.adoptSessions()
    expect(born.adopted).toBe(1)
    expect(born.descentsLearned).toBe(1)
    // …and the four rows beside it, adopted with no descent, did not inflate that number.
    expect(born.alreadyKnown).toBe(4)

    // Now the provider says whose two of them are.
    codexHome([
      { id: 'kid-a', source: SPAWN({ depth: 1, agent_nickname: 'Turing' }) },
      { id: 'kid-b', source: SPAWN({ depth: 1, agent_nickname: 'Lovelace' }) },
    ])
    const second = await buildHost().adoptSessions()
    expect(second.adopted, 'a rescan adopts nothing — these rows are already ours').toBe(0)
    // ⛔ **TWO, not four.** The number is of rows that changed, not of rows that were looked at —
    // which is the number a caller-side tally would have produced and printed under the same word.
    expect(second.descentsLearned).toBe(2)

    // …and running it again learns nothing, because there is nothing left to learn. Without this,
    // "2" is equally consistent with a counter that increments on every adopted row it visits.
    const third = await buildHost().adoptSessions()
    expect(third.alreadyKnown, 'the same five rows are still found and still ours').toBe(5)
    expect(third.descentsLearned).toBe(0)
  })

  it('⛔ a rescan NEVER clears a recorded descent (acceptance 3)', async () => {
    // Adopted while the provider was still writing a role…
    codexHome([
      { id: 'parent-thread' },
      {
        id: 'rich-child',
        source: SPAWN({ depth: 2, agent_nickname: 'Turing', agent_role: 'worker' }),
      },
    ])
    await buildHost().adoptSessions()
    expect(row('rich-child')?.child).toMatchObject({ role: 'worker', depth: 2 })

    // ⚠️ **The case 111/115 measured as real, in two steps.** First the provider stops saying what
    // the role was — `agent_role` was written until around 2026-07-20 and 8 of 8 recent child
    // rollouts carry it explicitly null.
    codexHome([{ id: 'rich-child', source: SPAWN({ depth: 2, agent_nickname: 'Turing' }) }])
    await buildHost().adoptSessions()
    expect(row('rich-child')?.child).toMatchObject({ role: 'worker', depth: 2, nickname: 'Turing' })

    // …and then it stops saying it is a child at all — the shape `thread_source` misses on 9
    // legacy rows and the edge table misses on 3.
    codexHome([{ id: 'rich-child', source: 'app-server' }])
    await buildHost().adoptSessions()
    expect(row('rich-child')?.child).toMatchObject({ role: 'worker', depth: 2, nickname: 'Turing' })
    // ⛔ The whole point: the row still refuses Resume after two thinner readings in a row.
    expect(
      buildHost()
        .resumableSessions()
        .find((entry) => entry.ref.sessionId === 'rich-child')?.resumeRefusal,
    ).toContain('sub-agent conversation')
  })

  it('a richer live answer is MERGED in, and the row keeps what only it holds (acceptance 4)', async () => {
    codexHome([
      { id: 'parent-thread' },
      { id: 'growing-child', source: SPAWN({ agent_role: 'explorer' }) },
    ])
    await buildHost().adoptSessions()
    expect(row('growing-child')?.child).toEqual({
      parentSessionId: 'parent-thread',
      role: 'explorer',
    })

    // The provider has since coined a nickname and recorded a depth, and dropped the role.
    codexHome([{ id: 'growing-child', source: SPAWN({ depth: 1, agent_nickname: 'Turing' }) }])
    await buildHost().adoptSessions()

    // MERGE, not replace: every field either side has ever answered, and nothing lost.
    expect(row('growing-child')?.child).toEqual({
      parentSessionId: 'parent-thread',
      role: 'explorer',
      depth: 1,
      nickname: 'Turing',
    })
  })

  it('learning a descent does not move the row up the list', async () => {
    // `updated_at` records a provider touch and orders the reopen list. Back-filling an
    // existing fact must not reorder that list.
    codexHome([{ id: 'quiet-child' }])
    await buildHost().adoptSessions()
    const before = row('quiet-child')?.updatedAt

    codexHome([{ id: 'quiet-child', source: SPAWN({ depth: 1 }) }])
    await buildHost().adoptSessions()

    // ⚠️ **`toEqual`, not `not.toBeNull()`** (review): the loose form passes on `undefined`, so a
    // fixture that never reached the store — a missing rollout, an unreadable state database, a
    // typo in the id — would have satisfied this whole test while proving nothing about ordering.
    expect(before).toEqual(expect.any(Number))
    expect(row('quiet-child')?.child).toEqual({ parentSessionId: 'parent-thread', depth: 1 })
    expect(row('quiet-child')?.updatedAt).toBe(before)
  })

  it('⚑ a derive that throws is said in the skipped list, and counts as no import', async () => {
    // `086`: never report a number that is not true, and never stay silent about a failure.
    // ⚠️ A CLAUDE transcript, and it has to be: this suite's Codex rollouts are a single `{}` line,
    // so their derive answers `nothing-readable` and never reaches the generation this test breaks.
    const cwd = join(dir, 'work')
    const projectDir = join(
      userData,
      'provider-homes',
      'default',
      'default',
      'claude',
      'projects',
      claudeProjectDirName(cwd),
    )
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(
      join(projectDir, 'claude-thread.jsonl'),
      [
        { type: 'user', sessionId: 'claude-thread', cwd, message: { role: 'user', content: 'hi' } },
        {
          type: 'assistant',
          sessionId: 'claude-thread',
          cwd,
          message: { role: 'assistant', content: 'hello' },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n') + '\n',
    )
    const failing: SessionStore = {
      ...store,
      beginGeneration: () => {
        throw new Error('the database is closing')
      },
    }
    const report = await buildHost({ store: failing }).adoptSessions()

    expect(report.imported).toBe(0)
    expect(report.skipped.map((entry) => entry.reason).join(' ')).toContain('could not be imported')
  })

  it('a back-filled row says the SAME thing on all three surfaces (acceptance 5)', async () => {
    codexHome([{ id: 'parent-thread' }, { id: 'legacy-child' }])
    const host = buildHost()
    await host.adoptSessions()

    /** The three answers, taken the way the three surfaces take them. */
    async function surfaces(sessionId: string) {
      const library = await readLibrary({
        recorded: () => store.recorded(),
        // The live-home branch reads `~/.claude` and `~/.codex`, while app-owned adopted rows
        // live in homes provisioned under `userData`. It therefore cannot supply descent for
        // these rows. Before back-fill, all three surfaces read the same stale column and are
        // wrong together; correcting the column corrects all three.
        userHomeSessions: () => ({ found: [], skipped: [] }),
        indexedDescriptions: () => Promise.resolve(new Map()),
        archivedAt: () => null,
      })
      const entry = library.entries.find((row) => row.recordId === sessionId)
      return {
        // ⛔ **Reported, not coalesced away** (review). Every field below reads `?? null`, so a
        // library that returned NOTHING would answer exactly like a row with nothing to say — and
        // both blocks that expect all-nulls would have passed over an empty list.
        inLibrary: entry !== undefined,
        inReopenList: host.resumableSessions().some((row) => row.sessionId === sessionId),
        chip: entry?.child ?? null,
        libraryReason: entry?.unresumableReason ?? null,
        refusal:
          host.resumableSessions().find((row) => row.sessionId === sessionId)?.resumeRefusal ??
          null,
        // ⚑ **D-017b · the third surface is the conversation's one full view** — the recorded
        // hand-over a press draws (`look`), whose composer says why no message continues it. The
        // reading-only pane that read `libraryEntry` is gone with that door.
        paneReason: (await host.look(sessionId, new NullSink(), false)).cannotTakeAMessage ?? null,
      }
    }

    const childId = row('legacy-child')!.sessionId
    const parentId = row('parent-thread')!.sessionId

    // Before back-fill, all three surfaces omit descent and the button is offered.
    expect(await surfaces(childId)).toEqual({
      inLibrary: true,
      inReopenList: true,
      chip: null,
      libraryReason: null,
      refusal: null,
      paneReason: null,
    })

    codexHome([{ id: 'legacy-child', source: SPAWN({ depth: 1, agent_nickname: 'Turing' }) }])
    await buildHost().adoptSessions()

    const after = await surfaces(childId)
    expect(after.inLibrary).toBe(true)
    expect(after.chip).toEqual({
      parentSessionId: 'parent-thread',
      depth: 1,
      nickname: 'Turing',
      role: null,
    })
    // ⚑ ONE sentence, from one function, on all three. `recorded()`'s own comment: *"the library
    // can never explain a row differently from the list that refuses to offer it."*
    expect(after.refusal).toContain('sub-agent conversation')
    expect(after.libraryReason).toBe(after.refusal)
    // ⚑ The view says the row's own sentence whole, after the host's lead (`cannot-be-reopened`).
    expect(after.paneReason).toContain(after.refusal)

    // ⛔ **The paired positive.** A negative alone would pass over a rescan that refused everything:
    // the parent came through the same scan, the same home and the same merge.
    expect(await surfaces(parentId)).toEqual({
      // The positive half, and it is what makes the four nulls beside it mean "this row is here
      // and says nothing" rather than "this row is not here at all".
      inLibrary: true,
      inReopenList: true,
      chip: null,
      libraryReason: null,
      refusal: null,
      paneReason: null,
    })
  })
})
