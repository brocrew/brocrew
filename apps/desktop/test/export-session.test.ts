import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeRuntime, FakeRuntime, claudeProjectDirName } from '@brobot2/runtime'
import {
  NO_DISCOVERY,
  discoverSessionsIn,
  type Discovery,
} from '../src/main/adopt/discover-sessions'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import {
  linesAsRows,
  writeBundleExport,
  writeNativeExport,
  type SessionBundle,
} from '../src/main/archive/export-session'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { recordedEntry } from '../src/main/library/session-library'
import { listProviderHomes } from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

/**
 * Writing a session back out (089).
 *
 * The claim under test is a round trip over a REAL transcript: a file goes into the archive
 * (088), comes back out here, and the two are the same bytes. Everything else in this slice is
 * downstream of that — a bundle is the same frames in a document, and "resumable" is a question
 * about where the file lands, which is asserted against the same path the provider's own preflight
 * probes rather than described.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')
const FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')

class NullSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

describe('exporting a session', () => {
  let dir: string
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let fixture: { sessionId: string; cwd: string; text: string }

  function plantFixture(): string {
    const home = join(userData, 'provider-homes', 'default', 'default', 'claude')
    const projectDir = join(home, 'projects', claudeProjectDirName(fixture.cwd))
    mkdirSync(projectDir, { recursive: true })
    const path = join(projectDir, `${fixture.sessionId}.jsonl`)
    writeFileSync(path, fixture.text)
    return path
  }

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

  function buildHost(
    overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {},
    ownStore: SessionStore = store,
  ) {
    let counter = 0
    return new RuntimeHost({
      store: ownStore,
      discoverSessions: discoverEverything,
      exportDirectory: () => join(dir, 'exports'),
      nativeTranscriptPath,
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
      ...overrides,
    })
  }

  /** Import the real transcript and hand back the session it was recorded as. */
  async function archivedSession(): Promise<string> {
    plantFixture()
    await buildHost().adoptSessions()
    return store.resumable()[0]?.sessionId ?? ''
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-export-'))
    userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)

    const text = readFileSync(FIXTURE, 'utf8')
    const named = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { sessionId?: string; cwd?: string })
      .find((record) => typeof record.cwd === 'string')
    fixture = { sessionId: named?.sessionId ?? '', cwd: named?.cwd ?? '', text }
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes back the very bytes the provider wrote', async () => {
    // The round trip: the provider's file → an export, unchanged. Not "equivalent JSON" — the same
    // bytes, key order and whitespace included.
    const sessionId = await archivedSession()

    const exported = await buildHost().exportSession({ sessionId: sessionId, exportKind: 'native' })

    expect(readFileSync(exported.path, 'utf8')).toBe(fixture.text)
    expect(exported.frames).toBeGreaterThan(20)
  })

  it('puts a Claude file exactly where Claude looks for it, so the export is resumable', async () => {
    // "Resumable" is not a description here. The real adapter's own preflight — no injected
    // `sessionExists` — is pointed at a home containing nothing but the exported file.
    const sessionId = await archivedSession()
    const targetHome = join(dir, 'a-different-home')

    const exported = await buildHost({ exportDirectory: () => targetHome }).exportSession({
      sessionId: sessionId,
      exportKind: 'native',
    })

    expect(exported.resumable).toBe(true)
    expect(exported.path).toBe(
      join(targetHome, 'projects', claudeProjectDirName(fixture.cwd), `${fixture.sessionId}.jsonl`),
    )

    // The adapter refuses a session it cannot find on disk (086), so getting past the preflight
    // is the assertion. It fails later, at the point where it would need a live provider.
    const runtime = new ClaudeRuntime()
    const ref = {
      provider: 'claude' as const,
      sessionId: fixture.sessionId,
      cwd: fixture.cwd,
      rotation: 0,
    }
    const failure = await runtime
      .resume(ref, { providerHome: targetHome, approvalMode: 'ask' })
      .then(() => null)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    expect(failure ?? '').not.toMatch(/session not found/i)

    // …and the same resume against a home WITHOUT the export is refused, so the preflight is
    // really looking at this file rather than waving everything through.
    const missing = await runtime
      .resume(ref, { providerHome: join(dir, 'empty-home'), approvalMode: 'ask' })
      .then(() => null)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    expect(missing ?? '').toMatch(/session not found/i)
  })

  it('writes a Codex rollout where Codex will find it, by id rather than by date', async () => {
    // Measured against the real provider before this was written: a rollout copied into an
    // otherwise empty home — no state database — resumed, and it still resumed from a deliberately
    // wrong date folder. Codex locates a thread by ID, so the date path is convention and the
    // export is genuinely resumable. The opposite was assumed first and was wrong.
    // A rollout the provider would have written, where the host finds it.
    const rollout = join(dir, 'rollout.jsonl')
    writeFileSync(rollout, '{"type":"session_meta"}\n')
    const host = buildHost({ nativeTranscriptPath: () => rollout })
    const sink = new NullSink()
    const created = await host.createSession({ provider: 'codex', cwd: join(dir, 'work') }, sink)
    await host.close(created.sessionId, sink)

    const exported = await host.exportSession({
      sessionId: created.sessionId,
      exportKind: 'native',
    })

    expect(exported.resumable).toBe(true)
    expect(exported.note).toMatch(/by its id/)
    expect(exported.path.replaceAll('\\', '/')).toMatch(
      /sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-.*\.jsonl$/,
    )
    // The id is in the filename, which is how Codex finds it.
    expect(exported.path).toContain(created.ref?.sessionId ?? 'no-ref')
    expect(readFileSync(exported.path, 'utf8')).toBe('{"type":"session_meta"}\n')
    await host.closeAll()
  })

  it.each(['claude', 'codex'] as const)(
    'an empty %s source refuses export and preserves the last good file',
    async (provider) => {
      const source = join(dir, `${provider}-native.jsonl`)
      writeFileSync(source, '{"type":"session_meta"}\n')
      store.adopt({
        id: 'sess_empty',
        provider,
        sessionId: '11111111-1111-4111-8111-111111111111',
        cwd: dir,
        profileId: 'default',
        createdAt: 1,
        updatedAt: 1,
      })
      const host = buildHost({ discoverSessions: NO_DISCOVERY, nativeTranscriptPath: () => source })
      const good = await host.exportSession({ sessionId: 'sess_empty', exportKind: 'native' })
      const bytes = readFileSync(good.path)
      writeFileSync(source, '')
      const name = provider === 'claude' ? 'Claude' : 'Codex'
      await expect(
        host.exportSession({ sessionId: 'sess_empty', exportKind: 'native' }),
      ).rejects.toThrow(
        `${name}'s file for this conversation is empty, so there is nothing to export.`,
      )
      expect(readFileSync(good.path)).toEqual(bytes)
      expect(readdirSync(dirname(good.path)).filter((name) => name.includes('.partial-'))).toEqual(
        [],
      )
    },
  )

  it.each([false, true])(
    'an empty native writer never promotes an empty file (previous export: %s)',
    async (previous) => {
      const target = join(dir, 'exports', 'empty.jsonl')
      mkdirSync(dirname(target), { recursive: true })
      if (previous) writeFileSync(target, 'previous good export\n')
      await expect(writeNativeExport(target, () => [])).rejects.toThrow('empty')
      expect(existsSync(target)).toBe(previous)
      if (previous) expect(readFileSync(target, 'utf8')).toBe('previous good export\n')
      expect(readdirSync(dirname(target))).toEqual(previous ? ['empty.jsonl'] : [])
    },
  )

  it('gives a file back newline-terminated, and says so rather than implying more', async () => {
    // The line reader does not keep whether the original ended with its final newline — reading
    // `"a\nb"` and `"a\nb\n"` gives the same lines. So the export is newline-terminated, which
    // is what both providers write, and this pins the one case where that is not the input.
    const host = buildHost({ discoverSessions: NO_DISCOVERY })
    store.adopt({
      id: 'sess_truncated',
      provider: 'claude',
      sessionId: 'truncated',
      cwd: join(dir, 'cut-short'),
      profileId: 'default',
      createdAt: 1,
      updatedAt: 1,
    })
    const projectDir = join(
      userData,
      'provider-homes',
      'default',
      'default',
      'claude',
      'projects',
      claudeProjectDirName(join(dir, 'cut-short')),
    )
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'truncated.jsonl'), '{"a":1}\n{"b":2}')

    const exported = await host.exportSession({ sessionId: 'sess_truncated', exportKind: 'native' })

    expect(readFileSync(exported.path, 'utf8')).toBe('{"a":1}\n{"b":2}\n')
  })

  it('refuses to export a session whose provider file is gone, and names the provider', async () => {
    const host = buildHost({ discoverSessions: NO_DISCOVERY })
    store.adopt({
      id: 'sess_bare',
      provider: 'claude',
      sessionId: 'nothing-archived',
      cwd: join(dir, 'bare'),
      profileId: 'default',
      createdAt: 1,
      updatedAt: 1,
    })

    for (const exportKind of ['native', 'bundle'] as const) {
      await expect(host.exportSession({ sessionId: 'sess_bare', exportKind })).rejects.toThrow(
        "Claude's file for this conversation is gone, so there is nothing to export.",
      )
    }
  })

  it('carries a whole session in one document, and takes it back', async () => {
    // The bundle is the transfer format: no provider home, no database. It carries both halves —
    // the provider's lines and our ledger — and re-importing it into an EMPTY database brings the
    // ledger back.
    const sessionId = await archivedSession()
    const before = {
      raw: fixture.text.split('\n').filter(Boolean),
      ledger: store.events(sessionId),
      row: store.find(sessionId),
    }

    const exported = await buildHost().exportSession({ sessionId: sessionId, exportKind: 'bundle' })
    const bundle = JSON.parse(readFileSync(exported.path, 'utf8')) as SessionBundle

    expect(bundle.bundleVersion).toBe(2)
    expect(bundle.meta.ref.sessionId).toBe(fixture.sessionId)
    expect(bundle.raw.frames.length).toBe(before.raw.length)
    expect(exported.ledgerEntries).toBe(before.ledger.length)
    // A bundle is a copy of a conversation, not a session anyone can rejoin from it alone.
    expect(exported.resumable).toBe(false)

    // Somewhere else entirely: its own database, its own profile.
    const elsewhereDb = openDatabase(join(dir, 'elsewhere.sqlite'))
    applyMigrations(elsewhereDb, migrations)
    const elsewhere = createSessionStore(elsewhereDb)
    const host = buildHost({ store: elsewhere }, elsewhere)

    const { sessionId: restored } = host.importBundle(bundle, 'transferred')

    expect(elsewhere.events(restored)).toEqual(before.ledger)
    expect(elsewhere.ledgerStatus(restored).derivedThrough).toBe(before.raw.length)
    expect(elsewhere.find(restored)).toMatchObject({
      provider: before.row?.provider,
      cwd: before.row?.cwd,
      profileId: 'transferred',
    })
    // It was not run here, and the row says so rather than pretending we ran it.
    expect(elsewhere.find(restored)?.adoptedAt).not.toBeNull()
    // …and no home here holds its provider's file, so it can't be exported again as one.
    await expect(host.exportSession({ sessionId: restored, exportKind: 'native' })).rejects.toThrow(
      'is gone, so there is nothing to export',
    )
    elsewhereDb.close()
  })

  it('takes the same bundle twice without making a second session of it', async () => {
    const sessionId = await archivedSession()
    const host = buildHost()
    const bundle = JSON.parse(
      readFileSync(
        (await host.exportSession({ sessionId: sessionId, exportKind: 'bundle' })).path,
        'utf8',
      ),
    ) as SessionBundle

    const elsewhereDb = openDatabase(join(dir, 'twice.sqlite'))
    applyMigrations(elsewhereDb, migrations)
    const elsewhere = createSessionStore(elsewhereDb)
    const into = buildHost({ store: elsewhere }, elsewhere)

    const first = into.importBundle(bundle)
    const second = into.importBundle(bundle)

    expect(second.sessionId).toBe(first.sessionId)
    expect(elsewhereDb.prepare('SELECT count(*) AS c FROM provider_session').get()).toEqual({
      c: 1,
    })
    elsewhereDb.close()
  })

  /**
   * ⛔ **168 L5 · a bundle from the user's own home came back claiming a home of ours** (188 §1).
   *
   * `profileId ?? bundle.meta.profileId ?? DEFAULT_PROFILE_ID` could not tell *"this conversation
   * lived in `~/.claude`"* — an explicit null — from *"this bundle does not say"*, and answered
   * `'default'` to both. `libraryEntry`'s shortcut then described the row from the row alone while
   * the full read described the file still sitting in the user's home: two answers for one
   * conversation, about `origin`, `onDisk`, `bytes` and `title`.
   */
  it('keeps an explicit null profile, and defaults only a bundle that does not say', async () => {
    const sessionId = await archivedSession()
    const exported = await buildHost().exportSession({ sessionId: sessionId, exportKind: 'bundle' })
    const bundle = JSON.parse(readFileSync(exported.path, 'utf8')) as SessionBundle

    const elsewhereDb = openDatabase(join(dir, 'null-profile.sqlite'))
    applyMigrations(elsewhereDb, migrations)
    const elsewhere = createSessionStore(elsewhereDb)
    const host = buildHost({ store: elsewhere }, elsewhere)

    // ⚠️ Each variant gets its own provider ref: `importBundle` is idempotent BY that ref, so three
    // bundles sharing one would all resolve to the first row and the last two would prove nothing.
    const spelt = (profile: string | null | undefined, id: string): SessionBundle => {
      const meta: Record<string, unknown> = {
        ...bundle.meta,
        ref: { ...bundle.meta.ref, sessionId: id },
      }
      if (profile === undefined) delete meta['profileId']
      else meta['profileId'] = profile
      return { ...bundle, meta } as unknown as SessionBundle
    }

    // A user-home export: `user-homes.ts` blanks the profile to null on everything it finds there.
    const restored = host.importBundle(spelt(null, 'th_user_home'))
    expect(elsewhere.find(restored.sessionId)?.profileId).toBeNull()
    // ⛔ …and the consequence, which is the reason the value matters: an imported bundle is
    // recorded as adopted, so a null profile makes it `foundInUserHome` — the row says where the
    // conversation actually lived instead of naming a home it was never in.
    expect(elsewhere.recordedOne(restored.sessionId)?.foundInUserHome).toBe(true)

    // ⚑ The paired positive, three ways. A bundle that NAMES a profile keeps it…
    const withProfile = host.importBundle(spelt('dev', 'th_named'))
    expect(elsewhere.find(withProfile.sessionId)?.profileId).toBe('dev')
    // …the caller's own argument still wins over both…
    const forced = host.importBundle(spelt(null, 'th_forced'), 'transferred')
    expect(elsewhere.find(forced.sessionId)?.profileId).toBe('transferred')
    // …and a bundle whose `meta` predates the field still defaults, because absent really is
    // unknown there — and `undefined` reaching the column would be a hole of a different kind.
    const legacy = host.importBundle(spelt(undefined, 'th_legacy'))
    expect(elsewhere.find(legacy.sessionId)?.profileId).toBe(DEFAULT_PROFILE_ID)

    elsewhereDb.close()
  })

  it('refuses a bundle it does not know how to read', () => {
    const host = buildHost()
    expect(() => host.importBundle({ bundleVersion: 99 } as unknown as SessionBundle)).toThrow(
      'unreadable bundle version',
    )
  })

  it('takes back a bundle written before entries carried a time', async () => {
    // 089 wrote version 1, whose ledger entries have no `at`. Refusing it would strand every
    // bundle exported before this slice; passing `undefined` through would hit `created_at NOT
    // NULL` halfway in and leave a session row with no conversation behind it.
    const sessionId = await archivedSession()
    const current = JSON.parse(
      readFileSync(
        (await buildHost().exportSession({ sessionId: sessionId, exportKind: 'bundle' })).path,
        'utf8',
      ),
    ) as SessionBundle
    const asWrittenBefore = {
      ...current,
      bundleVersion: 1 as const,
      ledger: current.ledger.map(({ ordinal, event }) => ({ ordinal, event })),
    }

    const elsewhereDb = openDatabase(join(dir, 'old-bundle.sqlite'))
    applyMigrations(elsewhereDb, migrations)
    const elsewhere = createSessionStore(elsewhereDb)
    const { sessionId: restored } = buildHost({ store: elsewhere }, elsewhere).importBundle(
      asWrittenBefore,
    )

    const events = elsewhere.events(restored)
    expect(events.length).toBe(current.ledger.length)
    // No time in the file, so they take the session's own — a stated stand-in, not a silent zero.
    expect(events.every((entry) => entry.at === current.meta.updatedAt)).toBe(true)
    elsewhereDb.close()
  })

  it('will not export a session it has never heard of', async () => {
    await expect(
      buildHost().exportSession({ sessionId: 'sess_nope', exportKind: 'bundle' }),
    ).rejects.toThrow('no recorded session')
  })

  /**
   * 🔴 **706 · `702` F-3 — a conversation its provider has not NAMED is recorded, not a stranger.**
   *
   * ⛔ **Measured on `main`**: every kind answered *"no recorded session"* — this door looked the row
   * up with `find`, which *"drops a row with no provider ref"*. ⚑ A person meets it through the
   * palette's *"Export this conversation"* on an OPEN Claude conversation before Claude named it; the
   * plant is `702` H-f's shape (run, closed, the column NULL), which is the same row to this door —
   * `exportSession` never asks whether the conversation is open.
   */
  describe('706 · a conversation its provider never named', () => {
    const aConversationNeverNamed = async (): Promise<{ host: RuntimeHost; sessionId: string }> => {
      const host = buildHost({ discoverSessions: NO_DISCOVERY })
      const cwd = join(dir, 'never-named')
      mkdirSync(cwd, { recursive: true })
      const { sessionId } = await host.createSession({ provider: 'claude', cwd }, new NullSink())
      await host.close(sessionId, new NullSink())
      db.prepare('UPDATE provider_session SET external_ref = NULL WHERE id = ?').run(sessionId)
      // ⚑ The premise, off the two readers that disagree: the library's has it, resume's does not.
      expect(store.recordedOne(sessionId)).not.toBeNull()
      expect(store.find(sessionId)).toBeNull()
      return { host, sessionId }
    }

    it('🔴 the READABLE export is written — it needs nothing of the provider’s', async () => {
      const { host, sessionId } = await aConversationNeverNamed()
      const written = await host.exportSession({
        sessionId,
        exportKind: 'reading',
        body: '# what was said\n',
      })
      expect(readFileSync(written.path, 'utf8')).toBe('# what was said\n')
      expect(written.kind).toBe('reading')
    })

    it('🔴 a provider file and a bundle are refused as what they are — never *"no recorded session"*', async () => {
      const { host, sessionId } = await aConversationNeverNamed()
      await expect(host.exportSession({ sessionId, exportKind: 'native' })).rejects.toThrow(
        'this conversation has no provider id BroCrew can read, so it cannot be written out as a provider file',
      )
      await expect(host.exportSession({ sessionId, exportKind: 'bundle' })).rejects.toThrow(
        'this conversation has no provider id BroCrew can read, so it cannot be written out as a bundle',
      )
    })

    it('⚑ THE CONTROL — an id no row carries is still nobody, for every kind', async () => {
      const host = buildHost({ discoverSessions: NO_DISCOVERY })
      for (const said of [
        { sessionId: 'sess_nobody', exportKind: 'native' },
        { sessionId: 'sess_nobody', exportKind: 'bundle' },
        { sessionId: 'sess_nobody', exportKind: 'reading', body: 'x' },
      ] as const) {
        await expect(host.exportSession(said)).rejects.toThrow('no recorded session: sess_nobody')
      }
    })
  })

  it('leaves the provider’s file alone — exporting is a read', async () => {
    const sessionId = await archivedSession()
    const path = plantFixture()
    const host = buildHost()

    await host.exportSession({ sessionId: sessionId, exportKind: 'native' })
    await host.exportSession({ sessionId: sessionId, exportKind: 'bundle' })

    expect(readFileSync(path, 'utf8')).toBe(fixture.text)
    expect(existsSync(join(dir, 'exports'))).toBe(true)
  })

  /**
   * ⛔ **A read that deletes** (207 M3).
   *
   * The bundle pathname is deterministic, so exporting the same session twice aims at the file the
   * first export wrote. `writeStreamed` opened it with `'w'` — truncating it before reading a row —
   * and its failure path then removed that same pathname. So a second export that hit a read error
   * destroyed a good export it had never written, and `exportSession` takes no
   * sink (`window-authority.test.ts`), which is how 207 reached it from a NON-OWNER window.
   */
  describe('a repeat export cannot destroy the one already there (207 M3)', () => {
    /** A window that opens fine and dies on its first pull — the file going unreadable. */
    const failing = () => {
      throw new Error('the file went unreadable mid-export')
    }

    it('⛔ the previous export survives, byte for byte, when the next one fails', async () => {
      const sessionId = await archivedSession()
      const good = await buildHost().exportSession({ sessionId: sessionId, exportKind: 'bundle' })
      const bytes = readFileSync(good.path, 'utf8')

      await expect(
        writeBundleExport(good.path, {
          meta: store.find(sessionId) as never,
          format: 'claude-jsonl',
          frames: failing,
          ledger: failing,
        }),
      ).rejects.toThrow('unreadable')

      // Not "exists": the whole finding is that a truncating open leaves a file that still exists.
      expect(readFileSync(good.path, 'utf8')).toBe(bytes)
      expect(JSON.parse(readFileSync(good.path, 'utf8')).raw.frames.length).toBeGreaterThan(20)
    })

    it('⚑ …and a repeat that SUCCEEDS still replaces it, leaving no scratch file behind', async () => {
      // The paired positive. A fix that made the second export a no-op would pass the test above
      // and break the feature — and a rename that never happened would leave the old bytes there.
      const sessionId = await archivedSession()
      const host = buildHost()
      const first = await host.exportSession({ sessionId: sessionId, exportKind: 'bundle' })
      writeFileSync(first.path, 'not a bundle at all')

      const second = await host.exportSession({ sessionId: sessionId, exportKind: 'bundle' })

      expect(second.path).toBe(first.path)
      expect(JSON.parse(readFileSync(second.path, 'utf8')).raw.frames.length).toBe(
        fixture.text.split('\n').filter(Boolean).length,
      )
      expect(readdirSync(dirname(second.path)).filter((n) => n.includes('.partial-'))).toEqual([])
    })

    it('a FIRST export that fails still leaves nothing wearing the export name', async () => {
      // The property the old `rmSync(path)` was there for, and it has to survive the fix: wreckage
      // that opens cleanly and is missing its second half is worse than no file.
      const target = join(dir, 'exports', 'sess_never.brobot-session.json')

      await expect(
        writeBundleExport(target, {
          meta: { sessionId: 'sess_never' } as never,
          format: 'claude-jsonl',
          frames: failing,
          ledger: failing,
        }),
      ).rejects.toThrow('unreadable')

      expect(existsSync(target)).toBe(false)
      expect(readdirSync(dirname(target)).filter((n) => n.includes('.partial-'))).toEqual([])
    })

    it('⚠️ the scratch file is never something a provider or our own discovery would read', async () => {
      // A native export lands INSIDE a provider's project directory, so a partial named `.jsonl`
      // would be offered as a conversation by `discoverSessionsIn` and by the provider itself.
      const seen: string[] = []
      const target = join(dir, 'exports', 'watched.jsonl')
      const rows = linesAsRows(plantFixture())
      await writeNativeExport(target, (from, limit) => {
        seen.push(...readdirSync(dirname(target)))
        return rows(from, limit)
      })

      const scratch = seen.filter((name) => name !== 'watched.jsonl')
      expect(scratch.length).toBeGreaterThan(0) // it really was written somewhere else first
      expect(scratch.every((name) => !/\.jsonl$|\.json$/.test(name))).toBe(true)
    })
  })

  /**
   * # 🔴 Send one out, bring one back — the loop, end to end (214 §1, from 213 finding 1)
   *
   * ⛔ **Everything above this block was already true, and the loop was still open.** `011` proved
   * the export is byte-identical (70,770 bytes, UI step `11`); `027` proved 2,500 frames with
   * gap-free ordinals; `importBundle` has existed since `089`. ⚑ **`194` H4, reviewing it:
   * *"`importBundle` has no production caller at this HEAD."*** So the assertions above prove the
   * bytes and the ones below prove the DOOR — a path a person can hand the app, the refusal when it
   * is the wrong file, and where the conversation lands when it is the right one.
   *
   * ⚠️ **Through `importBundleFile`, not `importBundle`.** The one takes a value already known to be
   * a bundle; the other takes a path to a file somebody was sent. Asserting the first and shipping
   * the second is how `194` M2 got written about code nothing called.
   */
  describe('214 §1 · a bundle exported by this app can be brought back', () => {
    /** A second database, standing in for the other machine. */
    const otherMachine = (
      name: string,
    ): { store: SessionStore; host: RuntimeHost; close: () => void } => {
      const otherDb = openDatabase(join(dir, name))
      applyMigrations(otherDb, migrations)
      const other = createSessionStore(otherDb)
      return {
        store: other,
        host: buildHost({ store: other }, other),
        close: () => otherDb.close(),
      }
    }

    it('🔴 the whole conversation comes back, from the PATH — not from a value we handed ourselves', async () => {
      const sessionId = await archivedSession()
      const before = { ledger: store.events(sessionId) }
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      // ⚑ The claim the app makes on the export screen, asserted rather than assumed: this file is
      // the thing the return path is given.
      expect(exported.note).toContain('self-contained copy')

      const away = otherMachine('round-trip.sqlite')
      const result = away.host.importBundleFile(exported.path)

      expect(result.ok, result.ok ? '' : result.reason).toBe(true)
      if (!result.ok) return
      expect(result.already).toBe(false)
      expect(result.events).toBe(before.ledger.length)
      // ⛔ Every ledger entry, not a count that happens to match.
      expect(away.store.events(result.sessionId)).toEqual(before.ledger)
      away.close()
    })

    it('🔴 …and the restored conversation is VISIBLE, placed as an adopted one (154)', async () => {
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const away = otherMachine('placed.sqlite')
      const result = away.host.importBundleFile(exported.path)
      if (!result.ok) throw new Error(result.reason)

      // ⛔ 154's ruling: an adopted conversation lives on the Sessions page. It is in `recorded()`,
      // which is what that page lists, with a transcript behind it.
      const listed = away.store.recorded().find((row) => row.sessionId === result.sessionId)
      expect(listed, 'the restored conversation is not on the Sessions page').toBeDefined()
      expect(listed?.hasTranscript).toBe(true)
      // ⛔ …and it SAYS WHAT IT IS. Its own origin, not `ours` — this app did not run it.
      expect(listed?.restoredFromBundle).toBe(true)
      expect(recordedEntry(listed!).origin).toBe('restored')
      expect(listed?.foundInUserHome, 'it is not one of the user’s own files either').toBe(false)
    })

    it('🔴 …and is never offered a Resume it cannot honour (194 M2)', async () => {
      /**
       * `194` M2, in full: *"import persists a provider ref without restoring the provider-side
       * referent, then advertises Resume… Clicking Resume asks the provider for a local referent
       * that import never restored and fails as a missing session."* ⛔ Measured against code with
       * no production caller. Wiring the door without this would have shipped it.
       */
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const away = otherMachine('no-resume.sqlite')
      const result = away.host.importBundleFile(exported.path)
      if (!result.ok) throw new Error(result.reason)

      expect(away.store.resumable().map((row) => row.sessionId)).not.toContain(result.sessionId)
      // ⛔ Dropped WITH a reason, never silently — a row that vanishes is the silence 151 ended.
      const refused = away.store.unresumable().find((row) => row.sessionId === result.sessionId)
      expect(refused, 'it fell out of both lists').toBeDefined()
      expect(refused?.reason).toContain('restored from a bundle')
      // ⚑ The library gives the SAME sentence — the two must never explain one row differently.
      const listed = away.store.recorded().find((row) => row.sessionId === result.sessionId)
      expect(listed?.unresumableReason).toBe(refused?.reason)
      // ⚠️ And it is not the OTHER refusal: a bundle from a `~/.claude` row would otherwise be told
      // it is one of the user's own conversations, which is a sentence about somebody else's file.
      expect(refused?.reason).not.toContain('BroCrew can read it here')
      away.close()
    })

    it('🔴 …and the REOPEN COMMAND refuses it too, not just the two lists (194 M2)', async () => {
      /**
       * ⛔ **Found by an adversarial review of this dispatch's own diff.** 214 unified three
       * hand-written copies of *"is there a home to reopen into"* in the store and left a FOURTH in
       * `RuntimeHost.reopenSession` — `row.adoptedAt !== null && row.profileId === null`, at the
       * boundary that actually starts a provider. A restored bundle whose `meta` carried a profile
       * passed it, a home that never held the transcript was provisioned, and the reopen came back
       * as the provider's *"unknown session"*.
       *
       * ⚠️ **The lists cannot close this**, and that method's own comment says so: *"IPC does not
       * restrict `resume` to the resumable list"*. A stale renderer, a replayed command, a deep
       * link or a smoke step pressing by id all arrive here holding an id.
       */
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const away = otherMachine('reopen-boundary.sqlite')
      const restored = away.host.importBundleFile(exported.path)
      if (!restored.ok) throw new Error(restored.reason)

      // ⛔ The command, by id — the door a UI refusal cannot cover.
      const refusal = await away.host
        .resumeSession(restored.sessionId, new NullSink())
        .then(() => null)
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))

      expect(refusal, 'the reopen was not refused at all').not.toBeNull()
      expect(refusal).toContain('restored from a bundle')
      // ⛔ **And it is NOT the OTHER refusal's sentence, which is the whole finding.** A restored
      // bundle thrown with `read-only` would tell somebody a file they were emailed was "found in
      // Claude's or Codex's own folder". ⚠️ `session-unavailable.ts` says the user-facing words are
      // keyed by the CODE alone — so a second class sharing a code is a lie by construction, and
      // `118` already paid for exactly that with `no-input-end`.
      expect(refusal).not.toContain('own folder')
      // ⚑ …and both surfaces agree on the FACT, which is what may not drift. The row's own sentence
      // is deliberately the more specific of the two (it can name the provider); this asserts they
      // are about the same thing rather than that they are the same string.
      const listed = away.store.unresumable().find((r) => r.sessionId === restored.sessionId)
      expect(listed!.reason).toContain('restored from a bundle')
      away.close()
    })

    it('⚑ THE PAIRED POSITIVE — a session we really ran is still offered a Resume', async () => {
      // Without this, a `resumable()` that returned nothing at all would pass the test above.
      const sessionId = await archivedSession()
      expect(store.resumable().map((row) => row.sessionId)).toContain(sessionId)
    })

    it('🔴 a malformed or foreign file is REFUSED with a reason, and nothing is half-imported', () => {
      const away = otherMachine('refusals.sqlite')
      const write = (name: string, body: string): string => {
        const path = join(dir, name)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, body)
        return path
      }

      const refusals: [string, string, string][] = [
        ['missing.json', '', 'there is no file at'],
        ['empty.brobot-session.json', '', 'that file is empty'],
        ['notes.txt', 'just some notes I was sent', 'not even JSON'],
        // ⛔ Valid JSON, wrong document — the shape a person most plausibly picks by mistake.
        ['other.json', JSON.stringify({ hello: 'world' }), 'not a BroCrew session bundle'],
        // A bundle missing one required field. The refusal names WHERE, so it is actionable.
        [
          'half.brobot-session.json',
          JSON.stringify({ bundleVersion: 2, raw: { format: 'x', frames: [] }, ledger: [] }),
          'not a BroCrew session bundle (at meta)',
        ],
      ]

      for (const [name, body, expected] of refusals) {
        // The first row is the only one that must NOT exist on disk.
        const path = name === 'missing.json' ? join(dir, 'nowhere', name) : write(name, body)
        const result = away.host.importBundleFile(path)
        expect(result.ok, `${name} was accepted`).toBe(false)
        if (result.ok) continue
        expect(result.reason, name).toContain(expected)
      }

      // ⛔ **Nothing was half-imported.** Five refusals, zero rows — the failure `194` M2 warns
      // about is a file that is understood just well enough to leave a conversation behind.
      expect(away.store.recorded()).toEqual([])
      away.close()
    })

    it('🔴 a bundle whose profile is a PATH is refused — that string becomes a directory name', async () => {
      /**
       * ⛔ **Found by an adversarial review, and verified against the database before the fix.** A
       * bundle carrying `"profileId": "../../../../tmp/pwned"` was accepted, and the row afterwards
       * held an `agent_profile` with that slug — durable, and shown in the library as the row's
       * profile. `ipc.ts` holds every RENDERER-supplied `profileId` to `isPathSegment` and says the
       * rule must be the same everywhere; this reader was the one entrance that skipped it, for the
       * one file this app lets a person be SENT.
       *
       * ⚠️ **A filesystem escape was one guarantee away, not zero** — `deriveProviderHome` asserts
       * the same rule before it builds a path. A guarantee held one call downstream of the door it
       * belongs at is what `071` and `203` exist to refuse.
       */
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const original = JSON.parse(readFileSync(exported.path, 'utf8')) as SessionBundle
      const away = otherMachine('bad-profile.sqlite')

      for (const profileId of ['../../../../tmp/pwned', 'a/b', '..']) {
        const path = join(dir, `profile-${profileId.replace(/[^a-z]/gi, '_')}.json`)
        writeFileSync(path, JSON.stringify({ ...original, meta: { ...original.meta, profileId } }))
        const result = away.host.importBundleFile(path)
        expect(result.ok, `${profileId} was accepted`).toBe(false)
      }
      // ⛔ Nothing reached the database, and no profile row was invented for it either.
      expect(away.store.recorded()).toEqual([])
      expect((away.store as unknown as { profiles?: () => unknown[] }).profiles?.() ?? []).toEqual(
        [],
      )

      // ⚑ **THE PAIRED POSITIVE**, because a reader that refused every profile would pass the above
      // while breaking every real bundle: the two legitimate shapes still land.
      for (const [name, profileId] of [
        ['named', 'dev'],
        ['user-home', null],
      ] as const) {
        const path = join(dir, `profile-ok-${name}.json`)
        writeFileSync(
          path,
          JSON.stringify({ ...original, meta: { ...original.meta, profileId } })
            .split(original.meta.ref.sessionId)
            .join(`th_ok_${name}`),
        )
        const result = away.host.importBundleFile(path)
        expect(result.ok, result.ok ? '' : `${name}: ${result.reason}`).toBe(true)
      }
      away.close()
    })

    it('⚠️ a ledger entry that names a conversation the app cannot read is refused in WORDS', async () => {
      // ⛔ The reader's own contract is *"a refusal always carries the sentence, never a code"*, and
      // `appendTx` calls `serializeSessionRef(event.ref)` and `.parse()`s it — so a malformed
      // `session` entry threw a raw Zod dump that the Sessions page printed verbatim.
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const original = JSON.parse(readFileSync(exported.path, 'utf8')) as SessionBundle
      const path = join(dir, 'bad-ref.brobot-session.json')
      writeFileSync(
        path,
        JSON.stringify({
          ...original,
          ledger: [
            { ordinal: 0, at: 1, event: { type: 'session', state: 'started', ref: { nope: 1 } } },
          ],
        }),
      )

      const away = otherMachine('bad-ref.sqlite')
      const result = away.host.importBundleFile(path)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('does not name a conversation this app can read')
        // ⛔ Not a parser's opinion about our own types.
        expect(result.reason).not.toContain('too_small')
        expect(result.reason).not.toContain('expected object')
      }
      away.close()
    })

    it('🔴 a bundle that disagrees with ITSELF about which conversation it is, is refused', async () => {
      /**
       * ⛔ **Found by the live smoke, on a file this dispatch built by hand** (214 §1).
       *
       * `appendTx` writes `external_ref` from the ledger's own `session` events
       * (`session-store.ts:1718`) — the ledger is the record and `meta` is a header. So a bundle
       * whose header names a conversation we do NOT have, and whose ledger names one we DO, gets
       * past `importBundle`'s de-duplication (which reads the header, before the ledger is applied),
       * is written as a new row, and then has its ref rewritten into a collision. ⛔ **Two rows, one
       * provider ref** — and the library keys its list on exactly that id, so one of them silently
       * stops being listed. `194` M2's family, arriving through the door 214 opened.
       */
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const asExported = JSON.parse(readFileSync(exported.path, 'utf8')) as SessionBundle
      // ⚠️ **A `session` event is ADDED, because the fixture is an ADOPTED conversation and those
      // have none** — `import-claude.ts` emits no lifecycle at all, which is the case the next test
      // pins. A session this app RAN carries one, and that is the shape the smoke found.
      const original: SessionBundle = {
        ...asExported,
        ledger: [
          {
            ordinal: asExported.ledger.length,
            at: asExported.meta.updatedAt,
            event: { type: 'session', state: 'started', ref: asExported.meta.ref } as never,
          },
          ...asExported.ledger,
        ],
      }
      // The header alone moved — exactly what the smoke's first version did.
      const headerOnly = join(dir, 'header-only.brobot-session.json')
      writeFileSync(
        headerOnly,
        JSON.stringify({
          ...original,
          meta: {
            ...original.meta,
            ref: { ...original.meta.ref, sessionId: `${original.meta.ref.sessionId}-elsewhere` },
          },
        }),
      )

      const away = otherMachine('self-contradicting.sqlite')
      const result = away.host.importBundleFile(headerOnly)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('disagrees with itself about which conversation it is')
        // ⛔ Both ids named, so a person can see WHICH two things disagree.
        expect(result.reason).toContain(original.meta.ref.sessionId)
      }
      expect(away.store.recorded()).toEqual([])

      // ⚑ **THE PAIRED POSITIVE, and it is what makes the refusal a discrimination.** The same
      // conversation with the id moved EVERYWHERE it appears is a genuine transfer, and it lands.
      const everywhere = join(dir, 'everywhere.brobot-session.json')
      writeFileSync(
        everywhere,
        JSON.stringify(original).split(original.meta.ref.sessionId).join('th_from_elsewhere'),
      )
      const good = away.host.importBundleFile(everywhere)
      expect(good.ok, good.ok ? '' : good.reason).toBe(true)
      expect(away.store.recorded()).toHaveLength(1)
      // ⛔ …and the row really points at the NEW conversation, which is the fact the refusal above
      // protects: the ledger had the last word, and it said the same thing as the header.
      expect(away.store.recorded()[0]?.providerSessionId).toBe('th_from_elsewhere')
      away.close()
    })

    it('⚠️ a bundle whose ledger names NO conversation is not a disagreement', async () => {
      // Non-vacuity for the guard: an adopted or derived session carries no `session` event of ours,
      // and a rule that refused those would refuse most of the library.
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const original = JSON.parse(readFileSync(exported.path, 'utf8')) as SessionBundle
      const noSessionEvents = join(dir, 'no-session-events.brobot-session.json')
      writeFileSync(
        noSessionEvents,
        JSON.stringify({
          ...original,
          meta: {
            ...original.meta,
            ref: { ...original.meta.ref, sessionId: 'th_quite_different' },
          },
          ledger: original.ledger.filter(
            (entry) => entry.event.type !== 'session' && entry.event.type !== 'conversation_reset',
          ),
        }),
      )

      const away = otherMachine('no-session-events.sqlite')
      const result = away.host.importBundleFile(noSessionEvents)

      expect(result.ok, result.ok ? '' : result.reason).toBe(true)
      away.close()
    })

    it('⚠️ a bundle that carried NO conversation does not claim BroBot has the whole of it', async () => {
      // ⛔ A mutation survived the table until this existed. `writeBundleExport` writes
      // `"ledger": []` without complaint, so an empty bundle is a real file — and telling somebody
      // *"BroBot has the whole conversation and can show it"* about a row holding none of it is the
      // sentence `086` exists to stop.
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const original = JSON.parse(readFileSync(exported.path, 'utf8')) as SessionBundle
      const empty = join(dir, 'empty-ledger.brobot-session.json')
      writeFileSync(
        empty,
        JSON.stringify({ ...original, raw: { ...original.raw, frames: [] }, ledger: [] })
          .split(original.meta.ref.sessionId)
          .join('th_empty'),
      )

      const away = otherMachine('empty-ledger.sqlite')
      const restored = away.host.importBundleFile(empty)
      if (!restored.ok) throw new Error(restored.reason)

      const reason = away.store
        .unresumable()
        .find((r) => r.sessionId === restored.sessionId)?.reason
      expect(reason).toContain('carried no conversation')
      expect(reason).not.toContain('has the whole conversation')
      // ⚑ …and it is still the RESTORED refusal, not one of the others — the row is what it is.
      expect(reason).toContain('restored from a bundle')

      // ⚑ **THE PAIRED POSITIVE**, on the same surface: a bundle that DID carry one says so.
      const full = away.store
        .unresumable()
        .map((r) => r.reason)
        .concat(
          (() => {
            const second = away.host.importBundleFile(exported.path)
            return second.ok
              ? [
                  away.store.unresumable().find((r) => r.sessionId === second.sessionId)?.reason ??
                    '',
                ]
              : []
          })(),
        )
      expect(full.some((r) => r.includes('has the whole conversation'))).toBe(true)
      away.close()
    })

    it('⚠️ a bundle from a NEWER BroBot is refused by version, in its own words', () => {
      const away = otherMachine('future.sqlite')
      const path = join(dir, 'future.brobot-session.json')
      writeFileSync(
        path,
        JSON.stringify({
          bundleVersion: 99,
          meta: {
            sessionId: 'sess_x',
            provider: 'claude',
            ref: { provider: 'claude', sessionId: 'th_x', cwd: '/w', rotation: 0 },
            cwd: '/w',
            profileId: null,
            status: 'idle',
            adoptedAt: null,
            createdAt: 1,
            updatedAt: 2,
          },
          raw: { format: 'claude-jsonl', frames: [] },
          ledger: [],
        }),
      )

      const result = away.host.importBundleFile(path)
      expect(result.ok).toBe(false)
      // `importBundle` owns this sentence — the reader deliberately checks the field as a NUMBER and
      // leaves membership to the method that knows which shapes it can read.
      if (!result.ok) expect(result.reason).toContain('unreadable bundle version: 99')
      expect(away.store.recorded()).toEqual([])
      away.close()
    })

    it('⚠️ the same bundle twice says “you already have this” rather than claiming a restore', async () => {
      // ⛔ The ordinary re-import: the same file, so the copy we hold is not behind it and there is
      // nothing to say beyond "already here". `236` §1 is the case where that was NOT true.
      const sessionId = await archivedSession()
      const exported = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const away = otherMachine('twice.sqlite')

      const first = away.host.importBundleFile(exported.path)
      const second = away.host.importBundleFile(exported.path)

      expect(first.ok && second.ok).toBe(true)
      if (!first.ok || !second.ok) return
      expect(first.already).toBe(false)
      expect(second.already).toBe(true)
      expect(second.sessionId).toBe(first.sessionId)
      expect(away.store.recorded()).toHaveLength(1)
      expect(second.behind, 'the same file is not newer than itself').toBeUndefined()
      away.close()
    })

    /**
     * # 🔴 A bundle that is NEWER than the copy we hold (236 §1, from `194` H4 / `214` / `231` #7)
     *
     * ⛔ **The sentence was confidently wrong.** The dedup is by the provider's own ref and compared
     * nothing else, so a bundle exported after a SECOND life of the conversation was answered with
     * *"you already have this"* and its new half was dropped without a word. `194` recorded it,
     * `214` re-recorded it while adding the production caller that made it reachable, and it took a
     * reviewer going looking for exactly this to read it back.
     *
     * ⚠️ **The ruling is COMPARE AND REPORT, not take it in** — see `RuntimeHost.importBundleFile`
     * for why a generation and an append were both available and both rejected.
     */
    describe('236 §1 · a file that is further on than the row', () => {
      /** The bundle for a conversation that carried on after the copy the other machine holds. */
      const secondLife = async (): Promise<{
        away: ReturnType<typeof otherMachine>
        older: string
        newer: string
        entries: number
      }> => {
        const sessionId = await archivedSession()
        // ⚠️ **Copied aside, and this is not tidiness.** `exportSession` names the file after the
        // conversation, so the second export OVERWRITES the first — the test's own first pass
        // measured 30 entries in the file it called "older" and said so.
        const first = (
          await buildHost().exportSession({ sessionId: sessionId, exportKind: 'bundle' })
        ).path
        const older = join(dir, `older-${basename(first)}`)
        copyFileSync(first, older)
        const away = otherMachine('second-life.sqlite')
        const landed = away.host.importBundleFile(older)
        if (!landed.ok) throw new Error(landed.reason)
        // ⛑ The conversation goes on HERE, on the machine that ran it — three more entries — and is
        // exported again. That second file is the one a person is handed.
        const entries = store.events(sessionId).length
        for (let more = 0; more < 3; more += 1) {
          store.append(
            sessionId,
            store.nextOrdinal(sessionId),
            { type: 'assistant_message', text: `later ${more}` },
            Date.UTC(2026, 7, 28) + more,
          )
        }
        const newer = (
          await buildHost().exportSession({ sessionId: sessionId, exportKind: 'bundle' })
        ).path
        return { away, older, newer, entries }
      }

      it('🔴 says so, with the numbers — rather than “you already have this”', async () => {
        const { away, newer, entries } = await secondLife()

        const result = away.host.importBundleFile(newer)

        expect(result.ok, result.ok ? '' : result.reason).toBe(true)
        if (!result.ok) return
        // ⚠️ Still `already`: we DO have the conversation. What is added is the fact that was
        // being withheld — which of the two copies is further on, and by how much.
        expect(result.already).toBe(true)
        expect(result.behind).toBeDefined()
        expect(result.behind?.held).toBe(entries)
        expect(result.behind?.inFile).toBe(entries + 3)
        expect(result.behind?.fileAt).toBeGreaterThan(0)
      })

      it('⛔ …and nothing is written — the report is not a repair', async () => {
        // ⛑ The ruling, as the state of the database rather than as a sentence: a generation and an
        // append were both available from here and both mean something this is not.
        const { away, newer } = await secondLife()
        const before = away.store.recorded().map((row) => row.sessionId)
        const held = away.store.events(before[0]!).length

        const result = away.host.importBundleFile(newer)

        expect(result.ok && result.already).toBe(true)
        expect(away.store.recorded().map((row) => row.sessionId)).toEqual(before)
        expect(away.store.events(before[0]!)).toHaveLength(held)
      })

      it('⛔ …and an OLDER file is silent, because “already here” is exactly true about it', async () => {
        // 🔴 The paired negative, and the one that keeps this from being an alarm on every
        // re-import: strictly greater, never merely different. Re-importing the first export after
        // the second has nothing a person could act on.
        const { away, older, newer } = await secondLife()
        away.host.importBundleFile(newer)

        const again = away.host.importBundleFile(older)

        expect(again.ok && again.already).toBe(true)
        expect(again.ok && again.behind, 'an older export is not news').toBeUndefined()
      })

      it('⛔ …and a file with FEWER entries than the row is silent too — strictly greater', async () => {
        // 🔴 The case the row above cannot make: there, the older file and the copy held were the
        // same length, so a comparison that reported on "different" rather than "further on" would
        // still have passed. Here the row holds THIRTY and the file holds twenty-seven.
        const { away, older, newer } = await secondLife()
        const fresh = otherMachine('behind-the-row.sqlite')
        const landed = fresh.host.importBundleFile(newer)
        if (!landed.ok) throw new Error(landed.reason)
        expect(fresh.store.events(landed.sessionId).length).toBeGreaterThan(
          away.store.events(away.store.recorded()[0]!.sessionId).length,
        )

        const again = fresh.host.importBundleFile(older)

        expect(again.ok && again.already).toBe(true)
        expect(again.ok && again.behind, 'a file BEHIND the row is not news either').toBeUndefined()
        fresh.close()
      })

      it('⛔ …and a FIRST import never reports being behind its own arrival', async () => {
        // ⚠️ The comparison is read BEFORE the write. Reading it after would measure the bundle
        // against the copy of itself just made and answer "the same" — or, worse, answer it about a
        // row that did not exist a line earlier.
        const sessionId = await archivedSession()
        const exported = await buildHost().exportSession({
          sessionId: sessionId,
          exportKind: 'bundle',
        })
        const away = otherMachine('first-import.sqlite')

        const result = away.host.importBundleFile(exported.path)

        expect(result.ok && result.already).toBe(false)
        expect(result.ok && result.behind).toBeUndefined()
        away.close()
      })
    })
  })
})
