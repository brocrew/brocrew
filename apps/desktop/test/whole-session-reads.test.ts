import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, claudeProjectDirName } from '@brobot2/runtime'
import { discoverSessionsIn, type Discovery } from '../src/main/adopt/discover-sessions'
import { nativeTranscriptPath, readLines } from '../src/main/archive/native-file'
import {
  BUNDLE_VERSION,
  EXPORT_FRAME_BATCH,
  buildBundle,
  reassembleNativeFile,
} from '../src/main/archive/export-session'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { listProviderHomes } from '../src/main/runtime/provider-homes'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { HISTORY_WINDOW_MAX_EVENTS, HISTORY_WINDOW_TURNS } from '../src/shared/runtime-ipc'

/**
 * **The two paths that held a whole session in memory** (053, from 052's closing list).
 *
 * They are one shape seen twice, which is why they are tested together. Something asks the database
 * or the disk for *a session*, gets back an array with no ceiling on it, and then builds ONE STRING
 * out of that array — `frames.join('\n')` on the way out, `JSON.stringify(bundle, null, 2)` for a
 * bundle. Above ~512 MB a JavaScript string does not get slow, it **throws**: the identical failure
 * 052 found and fixed one layer up in `readTranscript`.
 *
 * Neither was implicated in the 26 GB and neither is claimed to be. They are bounded because the
 * bound was never chosen — it was the observation that the data happened to be small. 046 ended
 * that: the corpus on this machine is 11.5 GB across 1,843 conversations, the largest single file
 * is 1.53 GB, and all of it is importable now, so the Export button is reachable on data that size.
 *
 * ## What each half asserts
 *
 * - **The bound**, measured: the widest array the code is ever handed. These fail on a revert —
 *   they are the only tests here that do.
 * - **Equivalence**, byte for byte, against the whole-memory implementations, which are kept for
 *   exactly this purpose. These pass on a revert, deliberately: their job is to catch a streaming
 *   writer that became cheaper *and different*, which would break the round trip 088/089 built and
 *   is the one property this feature has.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')

/**
 * A Claude transcript of `lines` records, transcribed from the shape in
 * `fixtures/claude-transcript.jsonl` and containing nothing of anyone's real work.
 *
 * Deliberately LONGER than one batch: the whole point is a file that cannot arrive in a single
 * write, and every fixture in the suite before this one was a handful of lines — so the batching
 * these bounds are made of was never once exercised.
 */
function syntheticTranscript(sessionId: string, cwd: string, lines: number): string {
  const at = (index: number): string => new Date(1_800_000_000_000 + index * 1_000).toISOString()
  const records = [
    JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: at(0),
      sessionId,
      cwd,
      content: 'say something 2500 times',
    }),
    JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: 'say something 2500 times' },
      uuid: 'u-0',
      sessionId,
      cwd,
      timestamp: at(1),
    }),
  ]
  while (records.length < lines) {
    const index = records.length
    records.push(
      JSON.stringify({
        parentUuid: `u-${index - 1}`,
        isSidechain: false,
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'test',
          content: [{ type: 'text', text: `something ${index}` }],
        },
        uuid: `u-${index}`,
        sessionId,
        cwd,
        timestamp: at(index),
      }),
    )
  }
  return `${records.join('\n')}\n`
}

/**
 * A transcript of `turns` prompts, each followed by `perTurn` assistant records.
 *
 * `syntheticTranscript` above has exactly ONE user record, so importing it produces one turn — fine
 * for the archive bounds it was written for, useless for a bound whose unit is the turn. The user
 * records here carry STRING content, which is what `import-claude` turns into a `user_turn`, which
 * is in turn what opens a row in the turn table. Nothing here is from anyone's real work.
 */
function syntheticConversation(
  sessionId: string,
  cwd: string,
  turns: number,
  perTurn: number,
): string {
  const at = (index: number): string => new Date(1_800_000_000_000 + index * 1_000).toISOString()
  const records: string[] = []
  for (let turn = 0; turn < turns; turn++) {
    records.push(
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        message: { role: 'user', content: `prompt ${turn}` },
        uuid: `u-${records.length}`,
        sessionId,
        cwd,
        timestamp: at(records.length),
      }),
    )
    for (let reply = 0; reply < perTurn; reply++) {
      records.push(
        JSON.stringify({
          parentUuid: `u-${records.length - 1}`,
          isSidechain: false,
          type: 'assistant',
          message: {
            role: 'assistant',
            model: 'test',
            content: [{ type: 'text', text: `turn ${turn} reply ${reply}` }],
          },
          uuid: `u-${records.length}`,
          sessionId,
          cwd,
          timestamp: at(records.length),
        }),
      )
    }
  }
  return `${records.join('\n')}\n`
}

/**
 * ⚠️ **The two cases 061 saw time out are in here, and the timeout is calibrated in the project
 * config rather than in this file (064).** Nine of the tests below import {@link LINES} synthetic
 * records through batched SQLite writes and then stream an export over them — real work, and the
 * whole point of the file. Measuring it showed the overrun was never about these two: see
 * `apps/desktop/vitest.config.ts` for what was measured and why the bound lives there.
 */
describe('a whole session is never held in memory (053)', () => {
  const SESSION_ID = '00000000-0000-4000-8000-00000000053a'
  /** 2.5 batches at both bounds' batch size, so a short final window is exercised too. */
  const LINES = 2_500

  let dir: string
  let userData: string
  let cwd: string
  let db: AppDatabase
  let store: SessionStore
  let transcript: string

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

  function buildHost(ownStore: SessionStore = store): RuntimeHost {
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
    })
  }

  /** Put `text` where Claude keeps the conversation `id`, and hand back the path. */
  function plant(text: string, id = SESSION_ID): string {
    const projectDir = join(
      userData,
      'provider-homes/default/default/claude/projects',
      claudeProjectDirName(cwd),
    )
    mkdirSync(projectDir, { recursive: true })
    const path = join(projectDir, `${id}.jsonl`)
    writeFileSync(path, text)
    return path
  }

  /** Every line of a file, as the export reads it. */
  function linesIn(path: string): string[] {
    const lines: string[] = []
    for (let from = 0; ;) {
      const chunk = readLines(path, from, 1_000)
      lines.push(...chunk.lines)
      from = chunk.offset
      if (chunk.done) return lines
    }
  }

  /** Import the planted transcript through the host, and hand back the session it was recorded as. */
  async function imported(ownStore: SessionStore = store): Promise<string> {
    await buildHost(ownStore).adoptSessions()
    return store.resumable()[0]?.sessionId ?? ''
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-whole-session-'))
    userData = join(dir, 'userData')
    cwd = join(dir, 'work')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    transcript = syntheticTranscript(SESSION_ID, cwd, LINES)
    plant(transcript)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('reading the provider’s own file into a ledger', () => {
    /** A store that remembers the WIDEST batch of rows it was ever asked to write. */
    function widestWrite(): { store: SessionStore; widest: () => number; writes: () => number } {
      let widest = 0
      let writes = 0
      const wrapped: SessionStore = {
        ...store,
        appendGeneration: (id, generation, entries) => {
          widest = Math.max(widest, entries.length)
          writes += 1
          store.appendGeneration(id, generation, entries)
        },
      }
      return { store: wrapped, widest: () => widest, writes: () => writes }
    }

    it('reaches the database in windows, never as one array of the whole file', async () => {
      const spy = widestWrite()
      await imported(spy.store)

      // The bound is the derive's batch of two thousand; the write COUNT is asserted as a floor only,
      // to rule out a version that writes nothing at all.
      expect(spy.widest()).toBeLessThanOrEqual(2_000)
      expect(spy.writes()).toBeGreaterThanOrEqual(2)
    })

    it('reads every line, windows and all', async () => {
      const sessionId = await imported()
      // A batching bug that dropped or duplicated a line at a boundary would show here and nowhere
      // else, because every other fixture in the suite fits inside one window.
      expect(store.ledgerStatus(sessionId).derivedThrough).toBe(LINES)
    })
  })

  describe('writing a session back out', () => {
    /** A store that remembers the widest window an export ever pulled out of it. */
    function widestRead(): { store: SessionStore; widest: () => number } {
      let widest = 0
      const wrapped: SessionStore = {
        ...store,
        events: (id) => {
          const rows = store.events(id)
          widest = Math.max(widest, rows.length)
          return rows
        },
        eventsFrom: (id, from, limit) => {
          const rows = store.eventsFrom(id, from, limit)
          widest = Math.max(widest, rows.length)
          return rows
        },
      }
      return { store: wrapped, widest: () => widest }
    }

    it('pulls the ledger in windows, for both kinds of export', async () => {
      const sessionId = await imported()
      const spy = widestRead()

      await buildHost(spy.store).exportSession({ sessionId: sessionId, exportKind: 'native' })
      await buildHost(spy.store).exportSession({ sessionId: sessionId, exportKind: 'bundle' })

      // ⚠️ THE assertion of this half. Before 053 the export called `events()`, which answers with
      // the entire session. It is wrapped above as well as the windowed one precisely so that going
      // back to it would be caught rather than silently unmeasured.
      expect(spy.widest()).toBeLessThanOrEqual(EXPORT_FRAME_BATCH)
    })

    it('writes the provider’s file byte for byte, streamed', async () => {
      const sessionId = await imported()
      const written = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'native',
      })

      expect(readFileSync(written.path, 'utf8')).toBe(transcript)
      expect(written.frames).toBe(LINES)
    })

    it('writes a bundle byte for byte identical to the one it used to build in memory', async () => {
      const sessionId = await imported()
      const row = store.find(sessionId)
      const frames = transcript.slice(0, -1).split('\n')
      const written = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })

      const oracle = buildBundle(
        {
          sessionId,
          provider: row?.provider ?? 'claude',
          ref: row?.ref ?? { provider: 'claude', sessionId: SESSION_ID, cwd, rotation: 0 },
          cwd: row?.cwd ?? cwd,
          profileId: row?.profileId ?? null,
          status: row?.status ?? 'idle',
          adoptedAt: row?.adoptedAt ?? null,
          createdAt: row?.createdAt ?? 0,
          updatedAt: row?.updatedAt ?? 0,
        },
        { format: 'claude-jsonl', frames },
        store.events(sessionId),
      )

      // Byte for byte, indentation and trailing newline included — not "parses to the same object".
      // Two documents can carry the same data and still break a consumer that diffs exports or
      // checksums them, and this file is the thing you send someone.
      expect(readFileSync(written.path, 'utf8')).toBe(`${JSON.stringify(oracle, null, 2)}\n`)
      expect(written.frames).toBe(LINES)
      expect(written.ledgerEntries).toBe(store.events(sessionId).length)
    })

    it('writes the empty array on one line, exactly as JSON.stringify does', async () => {
      // An empty provider file and NO ledger: `"frames": []` and `"ledger": []`, which are different
      // branches of the writer from a populated array — and the pair that first shipped a stray
      // comma.
      plant('', 'thread-bare')
      store.adopt({
        id: 'sess_bare',
        provider: 'claude',
        sessionId: 'thread-bare',
        cwd,
        profileId: 'default',
        updatedAt: 1_800_000_000_000,
        createdAt: 1_800_000_000_000,
      })
      const written = await buildHost().exportSession({
        sessionId: 'sess_bare',
        exportKind: 'bundle',
      })
      const text = readFileSync(written.path, 'utf8')

      expect(text).toContain('"frames": []')
      expect(text).toContain('"ledger": []')
      expect(JSON.parse(text)).toMatchObject({ bundleVersion: BUNDLE_VERSION })
      expect(written.frames).toBe(0)
      expect(written.ledgerEntries).toBe(0)
    })

    it('stays byte-identical on the text that breaks hand-rolled serializers', async () => {
      // The bundle writer reproduces `JSON.stringify(_, null, 2)`'s LAYOUT by hand, and that is the
      // one genuinely risky thing 053 did. Every value is still handed to `JSON.stringify` itself
      // and only shifted to its depth — so the escaping is the platform's — but "only the layout"
      // is a claim, and this is the content that tests it:
      //
      //  - a literal newline and a tab, which `atDepth` splits and re-joins on. If the escaping
      //    were ours, a raw `\n` inside a string would be indented as though it were structure.
      //  - a lone high surrogate, which well-formed `JSON.stringify` escapes as `\ud83d`.
      //  - astral characters (surrogate PAIRS), backslashes, quotes, and a U+2028 line separator —
      //    which is a line terminator to a JavaScript parser but not to `String.split('\n')`.
      //
      // ⚠️ The oracle reads the lines back OUT of the file rather than using the literals below, and
      // that is not a convenience: a lone surrogate is written to a file as U+FFFD, and a literal
      // newline ends a line. The contract an export can honestly claim is "the lines the provider's
      // FILE holds", and that is what is asserted.
      const nasty = [
        'a literal\nnewline and a\ttab',
        'astral 🧨🌍 and combining é',
        'a lone high surrogate: \ud83d end',
        'quotes " and backslashes \\ and \\" both',
        'line separator   and paragraph  ',
        '  control characters',
      ]
      store.adopt({
        id: 'sess_nasty',
        provider: 'claude',
        sessionId: 'thread-nasty',
        cwd,
        profileId: 'default',
        updatedAt: 1_800_000_000_000,
        createdAt: 1_800_000_000_000,
      })
      const nastyFile = plant(`${nasty.join('\n')}\n`, 'thread-nasty')
      nasty.forEach((text, index) => {
        store.append('sess_nasty', index, { type: 'assistant_message', text }, 1_800_000_000_000)
      })

      const row = store.find('sess_nasty')
      const written = await buildHost().exportSession({
        sessionId: 'sess_nasty',
        exportKind: 'bundle',
      })
      const oracle = buildBundle(
        {
          sessionId: 'sess_nasty',
          provider: 'claude',
          ref: row?.ref ?? { provider: 'claude', sessionId: 'thread-nasty', cwd, rotation: 0 },
          cwd: row?.cwd ?? cwd,
          profileId: row?.profileId ?? null,
          status: row?.status ?? 'idle',
          adoptedAt: row?.adoptedAt ?? null,
          createdAt: row?.createdAt ?? 0,
          updatedAt: row?.updatedAt ?? 0,
        },
        { format: 'claude-jsonl', frames: linesIn(nastyFile) },
        store.events('sess_nasty'),
      )
      expect(readFileSync(written.path, 'utf8')).toBe(`${JSON.stringify(oracle, null, 2)}\n`)

      // And the native side, where the lines are written raw rather than JSON-escaped — so the
      // bytes go out exactly as the provider's file holds them, control characters and all.
      expect(
        readFileSync(
          (await buildHost().exportSession({ sessionId: 'sess_nasty', exportKind: 'native' })).path,
          'utf8',
        ),
      ).toBe(reassembleNativeFile(linesIn(nastyFile)))
    })

    it('does not stop at a ledger row it cannot read, it steps over it', async () => {
      const sessionId = await imported()
      const total = store.events(sessionId).length
      expect(total).toBeGreaterThan(1)

      // Corrupt ONE payload in the middle. `events()` has always skipped such a row — a transcript
      // with a hole is honest — so the streamed export must have the same hole and not a truncation
      // at it. A window that read "fewer rows than I asked for" as "the end" would return everything
      // up to the hole and call the file complete, which is the failure mode this whole task is
      // about: a partial result that looks finished.
      const victim = Math.floor(total / 2)
      db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?').run(
        '{not json',
        sessionId,
        victim,
      )

      const written = await buildHost().exportSession({
        sessionId: sessionId,
        exportKind: 'bundle',
      })
      const bundle = JSON.parse(readFileSync(written.path, 'utf8')) as {
        ledger: { ordinal: number }[]
      }
      expect(bundle.ledger).toHaveLength(total - 1)
      expect(bundle.ledger.map((entry) => entry.ordinal)).not.toContain(victim)
      // The entries AFTER the hole are the ones a truncating reader would have lost.
      expect(bundle.ledger.at(-1)?.ordinal).toBeGreaterThan(victim)
    })

    it('leaves no half-written file behind when an export fails part-way', async () => {
      const sessionId = await imported()
      const exploding: SessionStore = {
        ...store,
        eventsFrom: (id, from, limit) => {
          if (from > 0) throw new Error('the disk went away mid-export')
          return store.eventsFrom(id, from, limit)
        },
      }

      // A truncated export is worse than no export: it opens, it looks like a session, and the only
      // sign it is half a conversation is that the end is missing. Streaming is what makes that
      // state reachable at all — the whole-string version could only write everything or nothing —
      // so the writer removes what it wrote.
      await expect(
        buildHost(exploding).exportSession({ sessionId: sessionId, exportKind: 'bundle' }),
      ).rejects.toThrow('the disk went away')

      // ⚠️ Asserted on the FILES, immediately, and not by exporting again afterwards: the successful
      // export writes the same path — so a "retry and compare" version of this test passes whether
      // the wreckage was cleaned up or not. It was written that way first.
      expect(existsSync(join(dir, 'exports', `${sessionId}.brobot-session.json`))).toBe(false)
      expect(readdirSync(join(dir, 'exports'), { recursive: true })).toEqual([])

      // …and the path is still usable afterwards, which is the other half of "no wreckage".
      const again = await buildHost().exportSession({ sessionId: sessionId, exportKind: 'bundle' })
      expect(JSON.parse(readFileSync(again.path, 'utf8'))).toMatchObject({
        bundleVersion: BUNDLE_VERSION,
      })
    })
  })

  /**
   * **The third path, and the one that was measured hurting** (054).
   *
   * The two above were bounded because the bound was never chosen. This one was measured: on the
   * packaged app, opening a real 171-turn conversation handed the renderer **27,251 entries /
   * 22.6 MB**, took **7,631 ms** to first paint and peaked at **1,511 MB** RSS — for one
   * conversation, with nothing running. The provider file behind it was 102 MB; the largest in the
   * corpus is 771 MB (Claude) and 1.53 GB (Codex).
   *
   * Same two halves as above, for the same reason:
   *
   *  - **The bound**, measured against what the STORE was asked for rather than what was rendered.
   *    A DOM assertion would pass just as well against a renderer that loaded everything and drew a
   *    slice of it, which is the one outcome that would fix nothing.
   *  - **Equivalence**: paging back has to reconstruct the ledger exactly — every ordinal, once, in
   *    order. A cursor that skipped or repeated at a page boundary would leave a conversation that
   *    reads fine and is missing a turn, and nothing else in the suite would see it.
   */
  describe('opening a long conversation reads a window, not the ledger', () => {
    /**
     * Sized so BOTH bounds are exercised and neither passes for free: 3,060 events is comfortably
     * over the event ceiling, while a page of {@link HISTORY_WINDOW_TURNS} turns is 612 — so the
     * turn count is what actually cuts here, and the ceiling is proven separately below on a
     * conversation shaped to make it bite.
     */
    const TURNS = 60
    const PER_TURN = 50

    /**
     * One FakeRuntime per provider, shared across hosts — the same arrangement
     * `session-persistence.test.ts` uses, and for the same reason: a relaunched app gets a new
     * host, but the provider's own state outlives it, and the Fake models that by refusing to
     * resume a ref it never issued.
     */
    const runtimes = new Map<string, FakeRuntime>()

    function resumableHost(ownStore: SessionStore = store): RuntimeHost {
      let counter = 0
      return new RuntimeHost({
        store: ownStore,
        discoverSessions: () => ({ found: [], skipped: [] }),
        exportDirectory: () => join(dir, 'exports'),
        nativeTranscriptPath: () => null,
        createRuntime: (provider) => {
          const existing = runtimes.get(provider)
          if (existing) return existing
          const fresh = new FakeRuntime(provider)
          runtimes.set(provider, fresh)
          return fresh
        },
        prepareProviderHome: (provider, profileId) =>
          join(userData, 'provider-homes', 'default', profileId, provider),
        providerHomePath: (provider, profileId) =>
          join(userData, 'provider-homes', 'default', profileId, provider),
        resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
        newSessionId: () => `sess_live_${++counter}`,
        readProviderConfig: (_provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'programmatic',
          authNote: null,
          files: [],
        }),
      })
    }

    const SINK = {
      ownerId: 'test',
      aPersonIsBehindIt: false,
      alive: true,
      send: () => {},
      sendLiveness: () => {},
    }

    /** A store that remembers the widest array any READ handed back, and what was called. */
    function widestHistoryRead(): {
      store: SessionStore
      widest: () => number
      wholeLedgerReads: () => number
    } {
      let widest = 0
      let wholeLedgerReads = 0
      const wrapped: SessionStore = {
        ...store,
        // Wrapped as well as `turnWindow`, and that is the point: going BACK to the whole-ledger
        // read is the regression, so it has to be visible rather than merely unmeasured.
        events: (id) => {
          const rows = store.events(id)
          wholeLedgerReads += 1
          widest = Math.max(widest, rows.length)
          return rows
        },
        turnWindow: (id, options) => {
          const page = store.turnWindow(id, options)
          widest = Math.max(widest, page.entries.length)
          return page
        },
      }
      return { store: wrapped, widest: () => widest, wholeLedgerReads: () => wholeLedgerReads }
    }

    /** Import the many-turn conversation and hand back the session it was recorded as. */
    async function longConversation(ownStore: SessionStore = store): Promise<string> {
      plant(syntheticConversation(SESSION_ID, cwd, TURNS, PER_TURN))
      return await imported(ownStore)
    }

    it('hands over a bounded page, counted at the STORE and not at the DOM', async () => {
      const sessionId = await longConversation()
      const whole = store.events(sessionId)
      // Non-vacuity: a bound proves nothing about a conversation that already fits inside it.
      expect(whole.length).toBeGreaterThan(HISTORY_WINDOW_MAX_EVENTS)

      const spy = widestHistoryRead()
      const page = (await buildHost(spy.store).look(sessionId, SINK, false)).history

      // ⚠️ THE assertion of this half. Before 054 the read was `store.events()`, so `widest` was
      // the whole ledger and `wholeLedgerReads` was 1.
      expect(spy.widest()).toBeLessThanOrEqual(HISTORY_WINDOW_MAX_EVENTS)
      expect(spy.wholeLedgerReads()).toBe(0)
      // …and the CEILING is not what cut here — the turn count is. Asserted as an exact number of
      // prompts rather than "smaller than the ledger", because a page that happened to come in
      // under the ceiling would satisfy the line above while paging by something else entirely.
      const prompts = page.entries.filter((entry) => entry.event.type === 'user_turn')
      expect(prompts).toHaveLength(HISTORY_WINDOW_TURNS)
      expect(page.entries.length).toBeLessThan(whole.length)
      expect(page.hasOlder).toBe(true)
    })

    it('reopening a live session reads a page too, not everything it ever said', async () => {
      // The resume path and the recorded view (D-017b's `look`) are different callers of the same
      // rule, and this is the one that matters more: it is what a conversation you are still having
      // goes through.
      //
      // Created rather than adopted, because only a session the runtime ISSUED can be resumed — the
      // Fake refuses a ref it never handed out, exactly as the real adapters do. The ledger is then
      // fattened directly, which is the cheapest way to get a long history behind a real ref.
      const created = await resumableHost().createSession({ provider: 'claude' }, SINK)
      const from = store.nextOrdinal(created.sessionId)
      store.appendMany(
        created.sessionId,
        Array.from({ length: TURNS }, (_, turn) =>
          Array.from({ length: PER_TURN + 1 }, (_, index) => ({
            ordinal: 0, // replaced below; the ordinals have to be contiguous across turns
            event:
              index === 0
                ? ({ type: 'user_turn', text: `prompt ${turn}` } as const)
                : ({ type: 'assistant_message', text: `turn ${turn} reply ${index}` } as const),
            at: 1_800_000_000_000 + turn * 1_000 + index,
          })),
        )
          .flat()
          .map((entry, index) => ({ ...entry, ordinal: from + index })),
      )
      const whole = store.events(created.sessionId)
      expect(whole.length).toBeGreaterThan(HISTORY_WINDOW_MAX_EVENTS)

      const spy = widestHistoryRead()
      const host = resumableHost(spy.store)
      const resumed = await host.resumeSession(created.sessionId, SINK)

      expect(spy.widest()).toBeLessThanOrEqual(HISTORY_WINDOW_MAX_EVENTS)
      expect(spy.wholeLedgerReads()).toBe(0)
      expect(resumed.history.entries.length).toBeLessThan(whole.length)
      expect(resumed.history.hasOlder).toBe(true)
      // The page has to END at the ledger's end: a reopened conversation opens where it got to.
      expect(resumed.history.entries.at(-1)?.ordinal).toBe(whole.at(-1)?.ordinal)
      await host.closeAll()
    })

    it('opens at a prompt, so the top of the view is the start of a turn', async () => {
      const sessionId = await longConversation()
      const page = (await buildHost().look(sessionId, SINK, false)).history

      // The whole argument for paging by turns rather than by a count of events: a page that began
      // partway through somebody's work would be indistinguishable, to a reader, from a
      // conversation that really started there.
      expect(page.turnAligned).toBe(true)
      expect(page.entries[0]?.event.type).toBe('user_turn')
      // …and it is the LAST turns, not the first: a session is opened to see where it got to.
      expect(page.entries.at(-1)?.ordinal).toBe(store.events(sessionId).at(-1)?.ordinal)
    })

    it('says so when the event ceiling cuts mid-turn instead of pretending it did not', async () => {
      // One prompt that ran and ran — the case a turn count cannot bound. There is no second
      // boundary to fall back to, so the ceiling is what cuts, and the page is NOT turn-aligned.
      plant(syntheticConversation(SESSION_ID, cwd, 1, HISTORY_WINDOW_MAX_EVENTS + 500))
      const sessionId = await imported()

      const page = (await buildHost().look(sessionId, SINK, false)).history
      expect(page.entries.length).toBeLessThanOrEqual(HISTORY_WINDOW_MAX_EVENTS)
      expect(page.turnAligned).toBe(false)
      expect(page.hasOlder).toBe(true)
      // Not a `user_turn`: the honest consequence of the ceiling, asserted rather than assumed.
      expect(page.entries[0]?.event.type).not.toBe('user_turn')
    })

    it('pages back to the very beginning, covering every event exactly once', async () => {
      const sessionId = await longConversation()
      const whole = store.events(sessionId)
      const host = buildHost()

      // Walk the cursor exactly as the renderer does, and assert the union — the equivalence half.
      let page = (await host.look(sessionId, SINK, false)).history
      const seen = [...page.entries]
      let pages = 1
      while (page.hasOlder) {
        page = host.earlierHistory(sessionId, page.from)
        // A page that came back EMPTY while claiming there was more would spin this loop forever,
        // and would be exactly how a cursor bug reaches production: the app would hang on scroll.
        expect(page.entries.length).toBeGreaterThan(0)
        seen.unshift(...page.entries)
        pages += 1
        expect(pages).toBeLessThan(200) // a bound on the test itself, not on the feature
      }

      expect(pages).toBeGreaterThan(1) // otherwise this proves nothing about paging
      expect(seen.map((entry) => entry.ordinal)).toEqual(whole.map((entry) => entry.ordinal))
      expect(seen.map((entry) => entry.event)).toEqual(whole.map((entry) => entry.event))
    })

    it('a session shorter than one page comes back whole, opening events and all', async () => {
      // The regression this rule was written for: cutting at the first `user_turn` of a session
      // with fewer turns than a page dropped everything BEFORE it — the `session` and `status`
      // records that open every recording — and left `hasOlder` true, so a three-turn conversation
      // offered to load an earlier page containing two lifecycle notices and nothing else.
      plant(syntheticConversation(SESSION_ID, cwd, 3, 4))
      const sessionId = await imported()
      const whole = store.events(sessionId)
      expect(whole.length).toBeLessThan(HISTORY_WINDOW_MAX_EVENTS)

      const page = (await buildHost().look(sessionId, SINK, false)).history
      expect(page.entries.map((entry) => entry.ordinal)).toEqual(
        whole.map((entry) => entry.ordinal),
      )
      expect(page.hasOlder).toBe(false)
      expect(page.turnAligned).toBe(true)
    })
  })
})
