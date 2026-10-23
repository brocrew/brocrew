import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NORMALIZER_VERSION } from '../src/main/archive/normalizer'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  type RecordedSession,
  type SessionStore,
} from '../src/main/db/session-store'
import {
  DEFAULT_LIBRARY_LIMIT,
  passesFilters,
  readLibrary,
  recordedEntry,
  type LibraryDeps,
  type LibraryEntry,
  type LibraryFilters,
  type LibraryQuery,
} from '../src/main/library/session-library'
import type { UserHomeDiscovery, UserHomeSession } from '../src/main/adopt/user-homes'
import type { ProviderDescription } from '../src/main/adopt/discover-sessions'

/**
 * The session library (Slice 2 · 047) — three sources merged into one list.
 *
 * What is being pinned here is the MERGE and its honesty, not the reading of any one source: that a
 * conversation known to both a provider home and our database is one row rather than two, that a row
 * never claims to hold something it does not, and that nothing is captioned with a string no
 * provider actually said.
 *
 * Every fixture is synthetic. The real corpus these shapes were checked against holds sensitive
 * real-world content and is never committed; what was measured against it is reported in the
 * response doc.
 */

const here = dirname(fileURLToPath(import.meta.url))
const CLAUDE_FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')
const migrations = join(here, '../src/main/db/migrations')

describe('the session library', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-library-'))
    mkdirSync(join(dir, 'homes'), { recursive: true })
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** A conversation in a user home, in the shape discovery reports one. */
  function found(overrides: Partial<UserHomeSession> = {}): UserHomeSession {
    const sessionId = overrides.sessionId ?? 'thread-1'
    const path = join(dir, 'homes', `${sessionId}.jsonl`)
    writeFileSync(path, readFileSync(CLAUDE_FIXTURE, 'utf8'))
    return {
      provider: 'claude',
      sessionId,
      cwd: join(dir, 'work'),
      path,
      bytes: 128,
      updatedAt: 2_000,
      createdAt: 1_000,
      profileId: null,
      ...overrides,
    }
  }

  function deps(
    discovery: UserHomeDiscovery,
    claude: Record<string, ProviderDescription> = {},
    archived: Record<string, number> = {},
  ): LibraryDeps {
    return {
      recorded: () => store.recorded(),
      userHomeSessions: () => discovery,
      indexedDescriptions: () => Promise.resolve(new Map(Object.entries(claude))),
      archivedAt: (recordId) => archived[recordId] ?? null,
    }
  }

  describe('the three sources', () => {
    it('lists a conversation we ran, one in a home, and one that is both — as three rows', async () => {
      store.create({
        id: 'sess_ours',
        provider: 'codex',
        cwd: '/work/ours',
        approvalMode: 'ask',
        profileId: 'default',
      })
      // The "both" case: adopted out of a user home, so it is in our database AND on disk.
      store.adopt({
        id: 'sess_both',
        provider: 'claude',
        sessionId: 'thread-both',
        cwd: join(dir, 'work'),
        profileId: null,
        updatedAt: 3_000,
        createdAt: 500,
      })

      const page = await readLibrary(
        deps({
          found: [found({ sessionId: 'thread-both' }), found({ sessionId: 'thread-new' })],
          skipped: [],
        }),
      )

      expect(page.entries).toHaveLength(3)
      expect(page.counts).toMatchObject({ total: 3, ours: 1, userHome: 2 })
    })

    it('merges a home and a row into ONE entry that knows both facts', async () => {
      store.adopt({
        id: 'sess_both',
        provider: 'claude',
        sessionId: 'thread-both',
        cwd: join(dir, 'work'),
        profileId: null,
        updatedAt: 3_000,
        createdAt: 500,
      })

      const page = await readLibrary(
        deps({ found: [found({ sessionId: 'thread-both' })], skipped: [] }),
      )

      // One row, not two. Merged on the PROVIDER's id, which is the only identifier that means the
      // same thing on both sides — our row id is ours alone and the home has never heard of it.
      expect(page.entries).toHaveLength(1)
      expect(page.entries[0]).toMatchObject({
        providerSessionId: 'thread-both',
        recordId: 'sess_both',
        origin: 'user-home',
        onDisk: true,
      })
    })

    it('keeps a rescued conversation whose provider file has since been deleted', async () => {
      // The whole reason the sweep exists, as a row: Claude deletes transcripts at 30 days, and
      // this one is no longer in the home that produced it.
      store.adopt({
        id: 'sess_rescued',
        provider: 'claude',
        sessionId: 'thread-gone',
        cwd: '/work/old',
        profileId: null,
        updatedAt: 3_000,
        createdAt: 500,
      })

      const page = await readLibrary(deps({ found: [], skipped: [] }))

      expect(page.entries[0]).toMatchObject({
        recordId: 'sess_rescued',
        origin: 'user-home',
        onDisk: false,
      })
      expect(page.counts.onlyHere).toBe(1)
    })

    it('carries what a home could not describe rather than dropping it', async () => {
      const page = await readLibrary(
        deps({
          found: [],
          skipped: [{ provider: 'codex', path: '/x.jsonl', reason: 'archived in Codex' }],
        }),
      )
      // A session that vanishes without a word is the exact complaint this surface answers.
      expect(page.skipped).toHaveLength(1)
      expect(page.skipped[0]?.reason).toBe('archived in Codex')
    })
  })

  describe('what it says about each row', () => {
    it('shows the provider’s own title and first message, and invents neither', async () => {
      const page = await readLibrary(
        deps({
          found: [
            found({
              sessionId: 'thread-codex',
              provider: 'codex',
              description: { title: 'Fix the parser', preview: 'the parser drops a line' },
            }),
          ],
          skipped: [],
        }),
      )

      expect(page.entries[0]).toMatchObject({
        title: 'Fix the parser',
        preview: 'the parser drops a line',
      })
    })

    /**
     * ⛔ **222 · how its last turn ended reaches the library too** — through BOTH doors.
     *
     * The merge and `recordedEntry` are two loops over two sources, and `220`'s complaint was about
     * a conversation being described by one word on a list. A field carried by one loop and dropped
     * by the other would say two things about one library.
     */
    it('222 · carries the ending through the merge, through our own row, and nowhere else', async () => {
      // 1 · one we ran, whose turn was cut off by a close — the `recordedEntry` door.
      store.create({
        id: 'sess_ours',
        provider: 'codex',
        cwd: '/work/ours',
        approvalMode: 'ask',
        profileId: 'default',
      })
      store.append('sess_ours', 0, { type: 'user_turn', text: 'go' }, 1_000)
      store.append('sess_ours', 1, { type: 'status', state: 'ended' }, 1_100)
      // 2 · one adopted out of a home, which finished — the MERGE door.
      store.adopt({
        id: 'sess_both',
        provider: 'claude',
        sessionId: 'thread-both',
        cwd: join(dir, 'work'),
        profileId: null,
        updatedAt: 3_000,
        createdAt: 500,
      })
      store.append('sess_both', 0, { type: 'user_turn', text: 'go' }, 3_100)
      store.append('sess_both', 1, { type: 'turn', state: 'completed' }, 3_200)

      const page = await readLibrary(
        deps({
          found: [found({ sessionId: 'thread-both' }), found({ sessionId: 'thread-new' })],
          skipped: [],
        }),
      )
      const by = Object.fromEntries(page.entries.map((entry) => [entry.id, entry]))

      expect(by['claude:thread-both']?.lastEnding).toBe('completed')
      expect(by['sess_ours']?.lastEnding).toBe('ended')
      // ⛔ **And null for the one we hold nothing of.** A conversation the provider has and we have
      // never run has no turn of ours to have ended; `'completed'` here would be the back-fill 045
      // added `unknown` to refuse.
      expect(by['claude:thread-new']?.lastEnding).toBeNull()
    })

    it('says nothing when the provider has said nothing', async () => {
      const page = await readLibrary(deps({ found: [found()], skipped: [] }))
      // Empty, NOT the id, the filename or a summary composed here. A caption we made up would be
      // indistinguishable from one the provider wrote.
      expect(page.entries[0]?.title).toBe('')
      expect(page.entries[0]?.preview).toBe('')
    })

    it('captions a Claude session from the SDK’s index, keyed by session id', async () => {
      const page = await readLibrary(
        deps(
          { found: [found({ sessionId: 'thread-1' })], skipped: [] },
          {
            'thread-1': { title: 'Named by the SDK', preview: 'the first prompt' },
          },
        ),
      )
      expect(page.entries[0]?.title).toBe('Named by the SDK')
    })

    it('offers a not-yet-imported conversation as importable, not as empty', async () => {
      const page = await readLibrary(deps({ found: [found()], skipped: [] }))
      const entry = page.entries[0]
      // The distinction the whole import control rests on: there is nothing to READ here yet, and
      // that is not the same fact as the conversation being empty.
      expect(entry?.readable).toBe(false)
      expect(entry?.recordId).toBeNull()
      expect(entry?.unresumableReason).toContain('import it')
      expect(page.counts.notImported).toBe(1)
    })

    it('explains an unresumable row in the STORE’s words, not its own', async () => {
      store.adopt({
        id: 'sess_home',
        provider: 'claude',
        sessionId: 'thread-1',
        cwd: join(dir, 'work'),
        profileId: null,
        updatedAt: 3_000,
        createdAt: 500,
      })
      const page = await readLibrary(
        deps({ found: [found({ sessionId: 'thread-1' })], skipped: [] }),
      )
      // Byte-identical to what the reopen list says, because it IS what the reopen list says.
      expect(page.entries[0]?.unresumableReason).toBe(
        store.unresumable().find((row) => row.sessionId === 'sess_home')?.reason,
      )
    })

    it('reports a session of ours that can be reopened as having no reason it cannot', async () => {
      store.create({
        id: 'sess_ours',
        provider: 'codex',
        cwd: '/work/ours',
        approvalMode: 'ask',
        profileId: 'default',
      })
      // The ref arrives the way it really does: on the session event the provider emits.
      store.append(
        'sess_ours',
        0,
        {
          type: 'session',
          state: 'started',
          ref: { provider: 'codex', sessionId: 'thread-ours', cwd: '/work/ours', rotation: 0 },
        },
        1_000,
      )

      const page = await readLibrary(deps({ found: [], skipped: [] }))
      expect(page.entries[0]).toMatchObject({ origin: 'ours', unresumableReason: null })
    })
  })

  describe('search', () => {
    async function search(query: string) {
      return await readLibrary(
        deps(
          {
            found: [
              found({
                sessionId: 'a',
                cwd: '/work/parser',
                description: { title: 'Fix the parser', preview: 'it drops a line' },
              }),
              found({
                sessionId: 'b',
                cwd: '/work/renderer',
                description: { title: 'Theme the rail', preview: 'the rail is too dark' },
              }),
            ],
            skipped: [],
          },
          {},
        ),
        { query },
      )
    }

    it('matches a title', async () => {
      expect((await search('parser')).entries.map((e) => e.providerSessionId)).toEqual(['a'])
    })

    it('matches the first message', async () => {
      expect((await search('too dark')).entries.map((e) => e.providerSessionId)).toEqual(['b'])
    })

    it('matches the working directory', async () => {
      expect((await search('renderer')).entries.map((e) => e.providerSessionId)).toEqual(['b'])
    })

    it('🔴 matches the PROVIDER — the fourth field, and it had no test at all', async () => {
      /**
       * ⚠️ **`matches()` has ended in `entry.provider.includes(needle)` since the merge was
       * written, and nothing above ever exercised it** (329, found reviewing that dispatch's own
       * diff). That mattered the moment `329` corrected the library's miss sentence from *"No
       * title, first message or working directory"* to name this field too: a claim went on the
       * screen with nothing behind it, which is the shape of defect the whole dispatch is about.
       *
       * ⛔ **Both directions, because one row per provider is what makes it a match and not a
       * tautology**: the fixture holds one Claude row and one Codex row over the same `cwd`, so a
       * query that returned both would prove nothing.
       */
      const page = await readLibrary(
        deps(
          {
            found: [
              found({ sessionId: 'a', provider: 'claude', cwd: '/work/shared' }),
              found({ sessionId: 'b', provider: 'codex', cwd: '/work/shared' }),
            ],
            skipped: [],
          },
          {},
        ),
        { query: 'codex' },
      )
      expect(page.entries.map((e) => e.providerSessionId)).toEqual(['b'])
      // …and the paired positive about the OTHER provider, so this is a match rather than a filter
      // that happens to drop one row.
      const other = await readLibrary(
        deps(
          {
            found: [
              found({ sessionId: 'a', provider: 'claude', cwd: '/work/shared' }),
              found({ sessionId: 'b', provider: 'codex', cwd: '/work/shared' }),
            ],
            skipped: [],
          },
          {},
        ),
        { query: 'claude' },
      )
      expect(other.entries.map((e) => e.providerSessionId)).toEqual(['a'])
    })

    it('ignores case and surrounding space', async () => {
      expect((await search('  PARSER ')).entries).toHaveLength(1)
    })

    it('treats the query as text, never as a pattern', async () => {
      // A regex metacharacter is a character. `.*` matches nothing here because nothing is named
      // `.*` — if this ever returns both rows, the search has become an injection surface.
      expect((await search('.*')).entries).toHaveLength(0)
    })

    it('matches everything when nothing is typed', async () => {
      expect((await search('')).entries).toHaveLength(2)
    })

    it('counts the WHOLE library while listing only the matches', async () => {
      const page = await search('parser')
      expect(page.entries).toHaveLength(1)
      expect(page.matched).toBe(1)
      // A count that moved with the search would make the library look like it was losing sessions.
      expect(page.counts.total).toBe(2)
    })
  })

  describe('ordering and paging', () => {
    it('lists the most recently touched first', async () => {
      const page = await readLibrary(
        deps({
          found: [
            found({ sessionId: 'old', updatedAt: 1_000 }),
            found({ sessionId: 'new', updatedAt: 9_000 }),
            found({ sessionId: 'mid', updatedAt: 5_000 }),
          ],
          skipped: [],
        }),
      )
      // Deliberately the OPPOSITE of the sweep's oldest-first. The sweep rescues what is closest to
      // being deleted; this is a person looking for the conversation they just had.
      expect(page.entries.map((entry) => entry.providerSessionId)).toEqual(['new', 'mid', 'old'])
    })

    it('bounds the page and still reports how many matched', async () => {
      const page = await readLibrary(
        deps({
          found: Array.from({ length: 5 }, (_, i) =>
            found({ sessionId: `t${i}`, updatedAt: 1_000 + i }),
          ),
          skipped: [],
        }),
        { limit: 2 },
      )
      expect(page.entries).toHaveLength(2)
      expect(page.matched).toBe(5)
    })

    it('pages without repeating or skipping a row', async () => {
      const all = {
        found: Array.from({ length: 5 }, (_, i) =>
          found({ sessionId: `t${i}`, updatedAt: 1_000 + i }),
        ),
        skipped: [],
      }
      const first = await readLibrary(deps(all), { limit: 2, offset: 0 })
      const second = await readLibrary(deps(all), { limit: 2, offset: 2 })
      const ids = [...first.entries, ...second.entries].map((entry) => entry.providerSessionId)
      expect(new Set(ids).size).toBe(4)
    })
  })

  describe('🔒 what the review found', () => {
    it('emits ONE entry when a home lists the same conversation twice', async () => {
      const twice = found({ sessionId: 'thread-1' })
      const page = await readLibrary(deps({ found: [twice, twice], skipped: [] }))
      // `id` is a Vue `:key` and the handle an import outcome is attached to. Two entries sharing
      // one is not a cosmetic duplicate — it is two rows nothing can tell apart.
      expect(page.entries).toHaveLength(1)
      expect(page.counts.userHome).toBe(1)
    })

    it('emits ONE entry when two rows were recorded against one provider id', async () => {
      // Neither row is offered by a home — the file has been deleted — so the `claimed` set built
      // from discovery cannot separate them. This is the path that used to emit both.
      for (const id of ['sess_a', 'sess_b']) {
        store.adopt({
          id,
          provider: 'claude',
          sessionId: 'thread-dup',
          cwd: '/work/old',
          profileId: null,
          updatedAt: 3_000,
          createdAt: 500,
        })
      }
      const page = await readLibrary(deps({ found: [], skipped: [] }))
      expect(page.entries).toHaveLength(1)
      expect(new Set(page.entries.map((entry) => entry.id)).size).toBe(1)
    })

    it('counts "only here" as a SUBSET of imported rather than a fourth bucket', async () => {
      store.adopt({
        id: 'sess_rescued',
        provider: 'claude',
        sessionId: 'thread-gone',
        cwd: '/work/old',
        profileId: null,
        updatedAt: 3_000,
        createdAt: 500,
      })
      const page = await readLibrary(deps({ found: [], skipped: [] }))
      // Both true of the SAME conversation. The counts are honest; it is the surface that has to
      // word them as an inclusion, which is why this pins the relationship rather than the numbers.
      expect(page.counts.imported).toBe(1)
      expect(page.counts.onlyHere).toBe(1)
      expect(page.counts.onlyHere).toBeLessThanOrEqual(page.counts.imported)
    })

    it('truncates a caption instead of putting a pasted document on the wire', async () => {
      const huge = 'x'.repeat(5_000)
      const page = await readLibrary(
        deps({
          found: [found({ description: { title: huge, preview: huge } })],
          skipped: [],
        }),
      )
      expect(page.entries[0]?.preview.length).toBeLessThan(400)
      expect(page.entries[0]?.title.length).toBeLessThan(400)
      // Truncated, not emptied: what it does show is still the provider's own words.
      expect(page.entries[0]?.preview.startsWith('xxx')).toBe(true)
    })

    it('bounds the skipped list and still reports how many there were', async () => {
      const page = await readLibrary(
        deps({
          found: [],
          skipped: Array.from({ length: 120 }, (_, i) => ({
            provider: 'codex' as const,
            path: `/x/${i}.jsonl`,
            reason: 'unreadable',
          })),
        }),
      )
      expect(page.skipped.length).toBeLessThan(120)
      // The total is never truncated. A summary counting only what it managed to show would turn a
      // bounded list into a claim of full coverage.
      expect(page.skippedTotal).toBe(120)
    })
  })

  describe('🔒 it reports what we hold, never what we assume', () => {
    it('does not call a row readable because it exists', async () => {
      store.adopt({
        id: 'sess_adopted',
        provider: 'claude',
        sessionId: 'thread-1',
        cwd: join(dir, 'work'),
        profileId: null,
        updatedAt: 3_000,
        createdAt: 500,
      })
      // Adopted is a POINTER. Nothing has been derived, so there is no conversation to show, and a
      // row claiming otherwise would open an empty pane and call it history (088).
      const page = await readLibrary(
        deps({ found: [found({ sessionId: 'thread-1' })], skipped: [] }),
      )
      expect(page.entries[0]?.recordId).toBe('sess_adopted')
      expect(page.entries[0]?.readable).toBe(false)
    })

    it('survives a row whose provider ref can no longer be parsed', async () => {
      store.create({
        id: 'sess_bad',
        provider: 'codex',
        cwd: '/work',
        approvalMode: 'ask',
        profileId: 'default',
      })
      db.prepare(`UPDATE provider_session SET external_ref = ? WHERE id = ?`).run(
        'not json at all',
        'sess_bad',
      )
      // One unreadable ref must cost one row's merge key, not the whole library.
      const page = await readLibrary(deps({ found: [found()], skipped: [] }))
      expect(page.entries).toHaveLength(2)
      expect(
        page.entries.find((entry) => entry.recordId === 'sess_bad')?.providerSessionId,
      ).toBeNull()
    })
  })
})

/**
 * **"We hold it" and "we hold all of it" are two facts** (065, from 061 finding 6).
 *
 * `readable` answers the first, and until the store carried a completeness contract it was the only
 * thing the library could say — so a conversation whose provider file had grown since it was
 * archived was listed exactly like one that was whole. These pin that the second fact reaches the
 * wire, and that it is genuinely a different value rather than a rename of the first.
 */
describe('the library carries completeness beside readability (065)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-library-derived-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const page = () =>
    readLibrary({
      recorded: () => store.recorded(),
      userHomeSessions: () => ({ found: [], skipped: [] }),
      indexedDescriptions: () => Promise.resolve(new Map()),
      archivedAt: () => null,
    })

  /** An adopted row with a projection read by importer `normalizerVersion`. */
  function projected(id: string, normalizerVersion: number): void {
    store.adopt({
      id,
      provider: 'claude',
      sessionId: `thread-${id}`,
      cwd: '/work',
      profileId: 'default',
      updatedAt: 2_000,
      createdAt: 1_000,
    })
    const generation = store.beginGeneration(id)
    store.appendGeneration(id, generation, [
      { ordinal: 0, event: { type: 'assistant_message', text: 'hello' }, at: 1_500 },
    ])
    store.promoteGeneration(id, generation, { normalizerVersion, derivedThrough: 1 })
  }

  it('reports a conversation an older version read as readable AND stale', async () => {
    // Relative to the CURRENT normalizer, not a literal (074): a bump must not move this case.
    projected('sess_behind', NORMALIZER_VERSION - 1)
    const entry = (await page()).entries.find((row) => row.recordId === 'sess_behind')
    // Both, and they disagree — which is the whole point. A single value could only ever have said
    // one of these, and the one it said was "there is something here".
    expect(entry?.readable).toBe(true)
    expect(entry?.derived).toBe('stale')
  })

  it('reports a conversation this version read as current', async () => {
    projected('sess_whole', NORMALIZER_VERSION)
    const entry = (await page()).entries.find((row) => row.recordId === 'sess_whole')
    expect(entry?.readable).toBe(true)
    expect(entry?.derived).toBe('current')
  })

  it('says nothing about a session this app ran', async () => {
    store.create({
      id: 'sess_ours',
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'default',
    })
    store.append('sess_ours', 0, { type: 'user_turn', text: 'hi' }, 1_500)
    const entry = (await page()).entries.find((row) => row.recordId === 'sess_ours')
    expect(entry?.readable).toBe(true)
    // Its ledger is the recording. Nothing read it, and `current` would be a claim nobody checked.
    expect(entry?.derived).toBeNull()
  })
})

/**
 * A child thread is distinct from a conversation started by the person.
 *
 * ⛔ **806 rows of existing damage.** `109` counted it: Codex discovery selected every thread row
 * and filtered only archived / missing-cwd / missing-file, so every sub-agent thread in the user's
 * home arrived in the library indistinguishable from a chat he opened himself. Re-measured for 111
 * on his own `state_5.sqlite`: **815 children of 1,986 threads.**
 *
 * The second test is the one with teeth. `109`'s sharpest sentence about this was *"because child
 * identity is discarded from `LibraryEntry` and adopted rows, an archived child remains
 * indistinguishable after its provider file disappears"* — which is the state 806 rows are already
 * in, and the reason the descent is written to the row instead of re-read from the home.
 */
describe('a swept child keeps its parentage (111)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-child-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, join(here, '../src/main/db/migrations'))
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const libraryDeps = (): LibraryDeps => ({
    recorded: () => store.recorded(),
    // ⚠️ **EMPTY on purpose — this is the whole scenario.** The provider's file is gone, so there is
    // no state database left to ask whose child it was. Whatever the row does not carry is lost.
    userHomeSessions: () => ({ found: [], skipped: [] }),
    indexedDescriptions: () => Promise.resolve(new Map()),
    archivedAt: () => null,
  })

  it('survives the file it was read from', async () => {
    store.adopt({
      id: 'sess_child',
      provider: 'codex',
      sessionId: '019fecbf-3606-7143-9c2a-3f1005cf4085',
      cwd: '/work',
      profileId: null,
      updatedAt: 2_000,
      createdAt: 1_000,
      child: {
        parentSessionId: '019db591-8b7d-7d91-a183-a16e869aa683',
        depth: 1,
        nickname: 'Turing',
        role: 'worker',
      },
    })

    const page = await readLibrary(libraryDeps())
    const row = page.entries.find((entry) => entry.recordId === 'sess_child')
    expect(row?.child).toEqual({
      parentSessionId: '019db591-8b7d-7d91-a183-a16e869aa683',
      depth: 1,
      nickname: 'Turing',
      role: 'worker',
    })
  })

  it('a child that cannot name its parent is still a child', async () => {
    // The `{"subagent":{"other":"guardian"}}` rows — three real ones. Every field null, the object
    // itself present: "a child, and the provider does not say whose" is a different sentence from
    // "not a child", and only the outer object can tell them apart.
    store.adopt({
      id: 'sess_guardian',
      provider: 'codex',
      sessionId: 'guardian-1',
      cwd: '/work',
      profileId: null,
      updatedAt: 2_000,
      createdAt: 1_000,
      child: {},
    })
    const page = await readLibrary(libraryDeps())
    const row = page.entries.find((entry) => entry.recordId === 'sess_guardian')
    expect(row?.child).toEqual({ parentSessionId: null, depth: null, nickname: null, role: null })
  })

  it('⛔ the LIBRARY explains a child the same way the reopen list refuses it (118)', async () => {
    // ⚠️ **The invariant `recorded()`'s own comment states**: *"the library can never explain a row
    // differently from the list that refuses to offer it."* 118 shipped breaking it — the reopen
    // list printed a refusal and removed the button while `unresumableReason` stayed null, so the
    // Library showed the row silently and the `ReadingPane` that the refusal's own Read control
    // opens said nothing about why the reader had been sent there. Two reviewers found it.
    store.adopt({
      id: 'sess_kid',
      provider: 'codex',
      sessionId: 'kid-thread',
      cwd: '/work',
      // App-owned: found in a home we provision, which is what makes it a resume candidate at all.
      profileId: 'default',
      updatedAt: 2_000,
      createdAt: 1_000,
      child: { parentSessionId: 'parent-thread', nickname: 'Turing' },
    })
    store.adopt({
      id: 'sess_grown',
      provider: 'codex',
      sessionId: 'grown-thread',
      cwd: '/work',
      profileId: 'default',
      updatedAt: 2_000,
      createdAt: 1_000,
    })

    const page = await readLibrary(libraryDeps())
    const reasonFor = (id: string) =>
      page.entries.find((entry) => entry.recordId === id)?.unresumableReason
    expect(reasonFor('sess_kid')).toContain('sub-agent conversation')
    // ⚠️ **The paired positive, and it is the one that makes this a rule rather than a blanket.**
    // An app-owned adopted PARENT can still be carried on, and says nothing.
    expect(reasonFor('sess_grown')).toBeNull()
    // …and the two surfaces are reading ONE function: the store's own sentence, word for word.
    const refusal = store.resumable().find((row) => row.sessionId === 'sess_kid')?.resumeRefusal
    expect(refusal).toBe(reasonFor('sess_kid'))
  })

  it('one row by id, for a surface that already has one (118)', async () => {
    // The reopen list's read control holds a session id and needs the LIBRARY row behind it, so
    // the read-only pane gets the real entry rather than a thinner one composed from what that
    // list happens to carry. An exact match on our own id, and never a substring: `query` searches
    // captions and matches many; this names one row.
    for (const id of ['sess_one', 'sess_two']) {
      store.adopt({
        id,
        provider: 'codex',
        sessionId: `${id}-thread`,
        cwd: '/work',
        profileId: null,
        updatedAt: 2_000,
        createdAt: 1_000,
      })
    }

    const page = await readLibrary(libraryDeps(), { recordId: 'sess_two' })
    expect(page.entries.map((entry) => entry.recordId)).toEqual(['sess_two'])
    // ⚠️ **The counts do NOT move with it**, which is the rule the substring filter beside it
    // already keeps: they are a statement about the whole library, and a count that narrowed with
    // the query would be a lie. `matched` is what narrowed.
    expect(page.matched).toBe(1)
    expect(page.counts.total).toBe(2)
    // A row we do not hold has no id to name, and that answer is empty rather than an error.
    expect((await readLibrary(libraryDeps(), { recordId: 'sess_gone' })).entries).toEqual([])
    // …and the paired positive, without which "it filters" could mean "it returns nothing".
    expect((await readLibrary(libraryDeps())).entries).toHaveLength(2)
  })

  it('⚠️ an ordinary conversation is NOT a child — the paired positive', async () => {
    // Without this, every assertion above is satisfied by a column that is always populated.
    store.adopt({
      id: 'sess_plain',
      provider: 'codex',
      sessionId: 'plain-1',
      cwd: '/work',
      profileId: null,
      updatedAt: 2_000,
      createdAt: 1_000,
    })
    const page = await readLibrary(libraryDeps())
    expect(page.entries.find((entry) => entry.recordId === 'sess_plain')?.child).toBeNull()
  })
})

/**
 * **The filters (121) — main-side, before the slice, and five predicates that stay five.**
 *
 * ⛔ **Every assertion here is one a client-side implementation fails.** `SessionLibrary.vue`'s own
 * comment is the requirement: *"filtering here would search the first 200 entries of two thousand
 * and quietly call it a result."* So the fixtures below are deliberately LARGER than the page — the
 * matching set alone is bigger than `DEFAULT_LIBRARY_LIMIT` — and what is asserted is the pair a
 * renderer could not produce: the entries on the page all match, AND `matched` counts the matches
 * in the whole corpus rather than on the page.
 *
 * These build their rows in memory rather than through the store and the filesystem, because 500
 * of them is the point and 500 files is not. {@link LibraryDeps} is an interface for exactly this.
 */
describe('214 §1 · a restored bundle is counted as itself', () => {
  /**
   * ⛔ **Found by an adversarial review.** `tally()` branched on `ours` versus everything-else, so a
   * restored bundle landed in the `user-home` group and was then printed as **imported** — the one
   * word its own chip argues is false about it. `onlyHere` ("rescued history — the provider deleted
   * its file") was wrong about it in the other direction: nothing was deleted, it was never here.
   */
  const row = (over: Partial<RecordedSession> = {}): RecordedSession => ({
    sessionId: 'sess_1',
    provider: 'claude',
    providerSessionId: 'th_1',
    cwd: '/work/alpha',
    status: 'idle',
    profileId: 'default',
    adoptedAt: null,
    hasTranscript: true,
    lastEnding: 'completed',
    foundInUserHome: false,
    restoredFromBundle: false,
    derived: 'current',
    createdAt: 1_000,
    updatedAt: 2_000,
    unresumableReason: null,
    // ⚑ D-017 · R10 — it has a provider id (`th_1`), so its provider named it.
    neverStarted: false,
    child: null,
    ...over,
  })
  const deps = (rows: RecordedSession[]): LibraryDeps => ({
    recorded: () => rows,
    userHomeSessions: () => ({ found: [], skipped: [] }),
    indexedDescriptions: () => Promise.resolve(new Map()),
    archivedAt: () => null,
  })

  it('🔴 lands in its OWN cell, and in none of the user-home ones', async () => {
    const page = await readLibrary(
      deps([
        row(),
        row({ sessionId: 'sess_2', providerSessionId: 'th_2', restoredFromBundle: true }),
      ]),
    )

    expect(page.counts.restored).toBe(1)
    expect(page.counts.ours).toBe(1)
    // ⛔ The three cells that were wrong about it.
    expect(page.counts.userHome).toBe(0)
    expect(page.counts.imported).toBe(0)
    expect(page.counts.onlyHere).toBe(0)
    // …and the total still adds up, which is what stops a new cell double-counting.
    expect(page.counts.ours + page.counts.userHome + page.counts.restored).toBe(page.counts.total)
  })

  it('⚑ …and a REAL user-home row still fills the cells it should', async () => {
    // The paired positive: a tally that sent everything to the new cell would pass the test above.
    const page = await readLibrary(
      deps([row({ foundInUserHome: true, adoptedAt: 5, profileId: null })]),
    )

    expect(page.counts.userHome).toBe(1)
    expect(page.counts.imported).toBe(1)
    expect(page.counts.restored).toBe(0)
  })
})

describe('narrowing the library (121)', () => {
  /** A recorded row, in the shape `recorded()` hands back. */
  const row = (over: Partial<RecordedSession> = {}): RecordedSession => ({
    sessionId: 'sess_1',
    provider: 'claude',
    providerSessionId: null,
    cwd: '/work/alpha',
    status: 'idle',
    profileId: 'default',
    adoptedAt: null,
    hasTranscript: true,
    // 222 — the same discipline: the store derives it from the turn table on the way out, so a
    // fixture states it rather than inferring it from `status`.
    lastEnding: 'completed',
    // ⚠️ **Set here rather than derived from the two fields above** (154). `session-store.ts`
    // computes it from `adopted_at` and `profile_id` on the way out; a test helper that worked it
    // out a second time would be the duplicate `032` just removed, wearing a fixture's clothes.
    foundInUserHome: false,
    // The same rule for 214 §1's second provenance: the store computes it from `restored_at`, and
    // a fixture that inferred it would be that duplicate again.
    restoredFromBundle: false,
    derived: 'current',
    createdAt: 1_000,
    updatedAt: 2_000,
    unresumableReason: null,
    // ⚑ D-017 · R10 — stated, not derived, for `foundInUserHome`'s reason above; the library reads
    // no such field, and a row here is an ordinary one its provider named.
    neverStarted: false,
    child: null,
    ...over,
  })

  const from = (
    rows: RecordedSession[],
    archived: ReadonlyMap<string, number> = new Map(),
  ): LibraryDeps => ({
    recorded: () => rows,
    userHomeSessions: () => ({ found: [], skipped: [] }),
    indexedDescriptions: () => Promise.resolve(new Map()),
    archivedAt: (recordId) => archived.get(recordId) ?? null,
  })

  /**
   * A corpus bigger than one page, where the FILTERED half is also bigger than one page.
   *
   * 500 rows: 300 Codex and 200 Claude. Filtering to Codex leaves 300, which still overflows the
   * 200-row window — so a page of 200 Codex rows with `matched: 300` can only have come from a
   * filter applied over all 500 before the slice. A renderer filtering the page it was handed
   * would have had 200 mixed rows to work with and could not have produced either number.
   *
   * ⚠️ **The SMALLER provider comes first, and the order is load-bearing** (found by mutation).
   * The provider tally is built by walking the entries, so with the busiest provider first the
   * insertion order already equals the sorted order and deleting the `sort` changes nothing. With
   * Claude's 200 seen first, an unsorted tally answers `[claude, codex]` and the sort is the only
   * thing that can produce `[codex, claude]`.
   */
  const OVERFLOWING = Array.from({ length: 500 }, (_, i) =>
    row({
      sessionId: `sess_${i}`,
      provider: i < 200 ? 'claude' : 'codex',
      updatedAt: 10_000 - i,
    }),
  )

  it('⛔ filters run MAIN-SIDE over the whole library, before the page is cut', async () => {
    const page = await readLibrary(from(OVERFLOWING), { filters: { provider: 'codex' } })

    // The window is the window: 200 rows, which is fewer than matched.
    expect(page.entries).toHaveLength(DEFAULT_LIBRARY_LIMIT)
    // ⛔ **300, not 500 and not 200.** 500 is the unfiltered count a client-side filter would have
    // been handed; 200 is `entries.length`, which the window note is forbidden to use.
    expect(page.matched).toBe(300)
    expect(page.matched).not.toBe(page.entries.length)
    // Every row on the page really is Codex — the filter is not merely a number.
    expect(page.entries.every((entry) => entry.provider === 'codex')).toBe(true)

    // ⚠️ **The paired positive, through the same corpus**: unfiltered, the same read matches all
    // 500. Without it "matched is 300" is equally consistent with a library that lost 200 rows.
    expect((await readLibrary(from(OVERFLOWING))).matched).toBe(500)
  })

  it('…and the counts beside it do NOT move with the filter', async () => {
    // The same rule the substring query already keeps: the counts are a statement about the whole
    // library. A header that narrowed with the facets would be `086`'s fabricated number, printed
    // one line above the honest one.
    const page = await readLibrary(from(OVERFLOWING), { filters: { provider: 'codex' } })
    expect(page.counts.total).toBe(500)
    expect(page.counts.ours).toBe(500)
  })

  it('the Provider facet’s options are the backend’s tally, whole-library and busiest first', async () => {
    // 039: the renderer may not know a provider's name, so the menu is built from this. Counted
    // over every entry, before the query and before the filters — a menu that only offered what
    // survived the current narrowing could not be used to switch away from it.
    const page = await readLibrary(from(OVERFLOWING), { filters: { provider: 'claude' } })
    expect(page.counts.providers).toEqual([
      { provider: 'codex', total: 300 },
      { provider: 'claude', total: 200 },
    ])
  })

  it('Origin separates what this app ran from what it merely found', async () => {
    /**
     * ⚠️ **This test exists because the mutation check found its absence** (121). Every other
     * fixture in this describe is one origin or the other, so deleting the origin clause outright
     * changed no answer anywhere — the filter was shipping with nothing asserting it at all.
     *
     * The two are not a property of the row alone: `origin` is `'user-home'` for anything a home
     * offered AND for a row the sweep adopted whose file has since gone, and `'ours'` only for a
     * session this app ran. Both halves are here so neither answer can be the empty one.
     */
    const rows = [
      row({ sessionId: 'ran-here', cwd: 'ran-here' }),
      // ⚠️ `stale` as well as adopted, so the AND below has a predicate the two rows DISAGREE on.
      row({
        sessionId: 'found',
        cwd: 'found',
        adoptedAt: 5,
        profileId: null,
        foundInUserHome: true,
        derived: 'stale',
      }),
    ]
    const selected = async (filters: LibraryFilters): Promise<string[]> =>
      (await readLibrary(from(rows), { filters })).entries.map((entry) => entry.cwd)

    expect(await selected({ origin: 'ours' })).toEqual(['ran-here'])
    expect(await selected({ origin: 'user-home' })).toEqual(['found'])
    // A partition, so neither answer can be satisfied by a filter that had stopped matching.
    expect(await selected({})).toEqual(['ran-here', 'found'])

    /**
     * …and it ANDs with the rest rather than replacing them.
     *
     * ⚠️ **A combination the ORIGIN clause is what decides** (review). The first version paired it
     * with `unreadable`, which BOTH rows already fail — so deleting the origin clause left the
     * empty answer unchanged and the line proved nothing. `behind` selects `found` alone, so the
     * emptiness below can only come from the origin.
     */
    expect(await selected({ behind: true })).toEqual(['found'])
    expect(await selected({ origin: 'ours', behind: true })).toEqual([])
  })

  it('⛔ reads the row’s own answer for Origin, and no longer works it out again (154)', async () => {
    /**
     * `session-library.ts` declared `fromUserHome(row)` — `adoptedAt !== null && profileId === null`,
     * the exact body of `session-store.ts`'s `foundInUserHome`, a directory away from where its
     * reasoning is written down. `032`. The store computes it once now and every reader takes that.
     *
     * ⚠️ **The two fields and the flag are set to DISAGREE here, and that is the assertion.** The
     * combination cannot occur in production; if it could be produced by re-deriving, this file
     * would be pinning the copy rather than its removal.
     */
    const rows = [
      row({ sessionId: 'looks-adopted', cwd: 'looks-adopted', adoptedAt: 5, profileId: null }),
      row({ sessionId: 'looks-ours', cwd: 'looks-ours', foundInUserHome: true }),
    ]
    const selected = async (filters: LibraryFilters): Promise<string[]> =>
      (await readLibrary(from(rows), { filters })).entries.map((entry) => entry.cwd)

    expect(await selected({ origin: 'ours' })).toEqual(['looks-adopted'])
    expect(await selected({ origin: 'user-home' })).toEqual(['looks-ours'])
  })

  it('filters AND with the search rather than replacing it', async () => {
    const rows = [
      row({ sessionId: 'a', provider: 'codex', cwd: '/work/parser' }),
      row({ sessionId: 'b', provider: 'codex', cwd: '/work/other' }),
      row({ sessionId: 'c', provider: 'claude', cwd: '/work/parser' }),
    ]
    const ids = async (query: LibraryQuery): Promise<string[]> =>
      (await readLibrary(from(rows), query)).entries.map((entry) => entry.recordId ?? '')

    // Each alone, so neither of the two below can pass by being a no-op.
    expect(await ids({ query: 'parser' })).toEqual(['a', 'c'])
    expect(await ids({ filters: { provider: 'codex' } })).toEqual(['a', 'b'])
    // Both: the intersection, not the union and not the last one to be applied.
    expect(await ids({ query: 'parser', filters: { provider: 'codex' } })).toEqual(['a'])
  })

  it('Archived reaches past the page: only the archived, or every one but them', async () => {
    // The newest 150 are not archived, so the unfiltered first page holds 50 archived rows of 350.
    const archived = new Map(
      OVERFLOWING.slice(150).map((entry, i) => [entry.sessionId, 1_000 + i] as const),
    )
    const read = (filters?: LibraryFilters) =>
      readLibrary(from(OVERFLOWING, archived), filters === undefined ? {} : { filters })

    const both = await read()
    expect(both.matched).toBe(500)
    expect(both.entries.filter((entry) => entry.archivedAt !== undefined)).toHaveLength(50)
    expect(both.entries.find((entry) => entry.recordId === 'sess_150')?.archivedAt).toBe(1_000)

    const only = await read({ archived: 'only' })
    expect(only.matched).toBe(350)
    expect(only.entries).toHaveLength(DEFAULT_LIBRARY_LIMIT)
    expect(only.entries.every((entry) => entry.archivedAt !== undefined)).toBe(true)
    expect(only.counts.total).toBe(500)

    const leftOut = await read({ archived: 'left-out' })
    expect(leftOut.matched).toBe(150)
    expect(leftOut.entries.some((entry) => entry.archivedAt !== undefined)).toBe(false)

    // ANDed with the rest: the Claude rows are the newest 200, of which 50 are archived.
    expect((await read({ archived: 'only', provider: 'claude' })).matched).toBe(50)
    expect((await read({ archived: 'left-out', provider: 'claude' })).matched).toBe(150)

    // The rule itself reads `archivedAt` and nothing else.
    const plain = recordedEntry(row())
    expect(passesFilters(plain, { archived: 'only' })).toBe(false)
    expect(passesFilters(plain, { archived: 'left-out' })).toBe(true)
    expect(passesFilters({ ...plain, archivedAt: 1 }, { archived: 'only' })).toBe(true)
    expect(passesFilters({ ...plain, archivedAt: 1 }, { archived: 'left-out' })).toBe(false)
  })

  /**
   * ⛔ **The five stay five** (`061` finding 6, `120` §1).
   *
   * `readable`, `onDisk` and `derived` are three independent facts, and this is the guard in test
   * form: each toggle is asserted on its own, and two of them are shown selecting DIFFERENT rows.
   * A merged "status" chip — any implementation where one value decided all of these — cannot make
   * both of those pass at once.
   */
  describe('the five state predicates', () => {
    /**
     * Six rows across BOTH halves of the merge, because three of the five predicates cannot be
     * exercised from one half alone.
     *
     * ⚠️ **`notImported` is unreachable in a recorded-only fixture, and finding that out is why
     * this fixture has homes in it.** `recordedEntry` gives every row we hold a `recordId`, so
     * `recordId === null` — the whole predicate — is a fact only the discovery loop can produce.
     * The first version of this test asserted three rows for it and got none. In the same way
     * `onDisk` is false for every recorded-only row and true for every row a home offered, so a
     * fixture from one source would have made that toggle either always-on or always-off.
     *
     * Rows are named by their `cwd`, which is the one field that survives both loops unchanged.
     */
    const home = (over: Partial<UserHomeSession> & { cwd: string }): UserHomeSession => ({
      provider: 'claude',
      sessionId: `thread-${over.cwd}`,
      path: `/homes/${over.cwd}.jsonl`,
      profileId: null,
      bytes: 128,
      createdAt: 1_000,
      updatedAt: 9_000,
      ...over,
    })

    /** Held here AND still in the home: the ordinary imported row. */
    const held = (cwd: string, over: Partial<RecordedSession> = {}): RecordedSession =>
      row({ sessionId: `sess_${cwd}`, providerSessionId: `thread-${cwd}`, cwd, ...over })

    const ROWS: RecordedSession[] = [
      // Passes none of the five — the paired positive for every narrow answer below.
      held('whole', { updatedAt: 6_000 }),
      held('stale', { derived: 'stale', updatedAt: 5_000 }),
      held('rotated', { unresumableReason: 'the token was rotated', updatedAt: 4_000 }),
      held('empty', { hasTranscript: false, updatedAt: 3_000 }),
      // Recorded, adopted out of the user's own home, and the provider has since deleted the file:
      // no home offers it, so it lands in the second loop with `onDisk: false`.
      row({
        sessionId: 'sess_gone',
        providerSessionId: 'thread-gone',
        cwd: 'gone',
        adoptedAt: 5,
        profileId: null,
        updatedAt: 2_000,
      }),
    ]

    const FOUND: UserHomeSession[] = [
      home({ cwd: 'whole', updatedAt: 6_000 }),
      home({ cwd: 'stale', updatedAt: 5_000 }),
      home({ cwd: 'rotated', updatedAt: 4_000 }),
      home({ cwd: 'empty', updatedAt: 3_000 }),
      // In a home and never imported: the only row that can carry `recordId === null`.
      home({ cwd: 'unimported', updatedAt: 1_000 }),
    ]

    const zoo: LibraryDeps = {
      recorded: () => ROWS,
      userHomeSessions: () => ({ found: FOUND, skipped: [] }),
      indexedDescriptions: () => Promise.resolve(new Map()),
      archivedAt: () => null,
    }

    const ALL = ['whole', 'stale', 'rotated', 'empty', 'gone', 'unimported']

    const selected = async (filters: LibraryFilters): Promise<string[]> =>
      (await readLibrary(zoo, { filters })).entries.map((entry) => entry.cwd)

    it('each one selects on its own field, and only on its own field', async () => {
      // Five predicates, five different answers, on one fixture and in one order.
      expect(await selected({ notImported: true })).toEqual(['unimported'])
      expect(await selected({ unresumable: true })).toEqual(['rotated', 'unimported'])
      expect(await selected({ behind: true })).toEqual(['stale'])
      expect(await selected({ offDisk: true })).toEqual(['gone'])
      expect(await selected({ unreadable: true })).toEqual(['empty', 'unimported'])

      // ⚠️ The paired positive for every narrow answer above: with nothing set, all six are here.
      // Without it, each assertion is equally consistent with a filter that had simply stopped
      // returning rows.
      expect(await selected({})).toEqual(ALL)
    })

    it('⛔ …and no two of them select the same rows, so "merged" cannot pass', async () => {
      /**
       * The `061`-finding-6 guard, stated as the thing a merged implementation gets wrong. If one
       * "status" value decided all five, at least two of these answers would have to coincide —
       * there are only so many values one field can take. All ten pairs differ, on one fixture.
       */
      const answers = await Promise.all(
        (['notImported', 'unresumable', 'behind', 'offDisk', 'unreadable'] as const).map(
          async (key) => ({ key, rows: await selected({ [key]: true }) }),
        ),
      )
      for (const answer of answers)
        expect(answer.rows, `${answer.key} matched nothing`).not.toEqual([])
      for (const a of answers) {
        for (const b of answers) {
          if (a.key === b.key) continue
          expect(a.rows, `${a.key} and ${b.key} select the same rows`).not.toEqual(b.rows)
        }
      }
      // And two of them are DISJOINT, which one field could not produce at all: a row can be
      // unreadable while nothing about it is behind, and behind while being perfectly readable.
      const unreadable = await selected({ unreadable: true })
      const behind = await selected({ behind: true })
      expect(unreadable.filter((cwd) => behind.includes(cwd))).toEqual([])
    })

    it('they AND with each other: a row failing one is excluded', async () => {
      // Nothing here is both — `stale` is behind and readable, `empty` is unreadable and current.
      expect(await selected({ behind: true, unreadable: true })).toEqual([])
      // …and each half alone still matches, so the empty answer above is the AND rather than a
      // filter that stopped working.
      expect(await selected({ behind: true })).toEqual(['stale'])
      expect(await selected({ unreadable: true })).toEqual(['empty', 'unimported'])
    })

    it('⛔ an imported, reopenable row is NOT unresumable — the `??` that said it was', async () => {
      /**
       * The defect this facet found in the merge it reads (121). `row?.unresumableReason ??
       * NOT_IMPORTED` falls through on the ROW's own null — the value meaning "this can be
       * reopened" — so every conversation already imported carried *"it has not been imported
       * yet"*. Nothing drew it: its only reader also required `!readable`, and an imported row is
       * readable. The Unresumable toggle has no such guard and would have selected all of them.
       */
      const page = await readLibrary(zoo)
      const reasonOf = (cwd: string): string | null =>
        page.entries.find((entry) => entry.cwd === cwd)?.unresumableReason ?? null

      // Imported, whole, reopenable: the store says nothing, so the library says nothing.
      expect(reasonOf('whole')).toBeNull()
      // …and the row that genuinely has not been imported still says so — without this, the
      // assertion above is satisfied by a merge that stopped composing the phrase at all.
      expect(reasonOf('unimported')).toContain('not been imported yet')
      // …and where the store DOES have a reason, it is the store's own words, unchanged (039).
      expect(reasonOf('rotated')).toBe('the token was rotated')
    })

    it('`false` is not a constraint — it is the absence of one', async () => {
      // The renderer holds all five as plain booleans and sends its state as it stands. An
      // unpressed toggle must therefore mean "do not narrow", never "only rows where this is
      // false" — which would be a filter nobody set, silently removing rows.
      const off: LibraryFilters = {
        notImported: false,
        unresumable: false,
        behind: false,
        offDisk: false,
        unreadable: false,
      }
      expect(await selected(off)).toEqual(ALL)
    })
  })

  it('the Kind facet is the descent and nothing else (111 → 119)', async () => {
    const rows = [
      row({ sessionId: 'parent' }),
      row({ sessionId: 'kid', child: { parentSessionId: 'p', nickname: 'Turing' } }),
      // Three measured child rows have neither parent nor nickname. The facet must still
      // identify them as children.
      row({ sessionId: 'anon', child: {} }),
    ]
    const selected = async (filters: LibraryFilters): Promise<string[]> =>
      (await readLibrary(from(rows), { filters })).entries.map((entry) => entry.recordId ?? '')

    expect(await selected({ kind: 'sub' })).toEqual(['kid', 'anon'])
    // Both halves, in the same fixture: a partition, not a filter that happens to drop rows.
    expect(await selected({ kind: 'top' })).toEqual(['parent'])
  })

  it('the predicates are readable on their own, without a page around them', () => {
    // `passesFilters` is exported because it IS the rule. Asserted directly here so the clauses
    // have a test that no merge, sort or slice can stand between.
    const entry = (over: Partial<LibraryEntry>): LibraryEntry =>
      recordedEntry(row({ sessionId: 'x', ...(over as Partial<RecordedSession>) }))
    const plain = entry({})
    expect(passesFilters(plain, undefined)).toBe(true)
    expect(passesFilters(plain, {})).toBe(true)
    // `current` and null are the two ways of saying nothing is missing; everything else is behind.
    expect(passesFilters(recordedEntry(row({ derived: null })), { behind: true })).toBe(false)
    expect(passesFilters(recordedEntry(row({ derived: 'current' })), { behind: true })).toBe(false)
    for (const derived of ['stale', 'rebuilding', 'failed'] as const) {
      expect(passesFilters(recordedEntry(row({ derived })), { behind: true })).toBe(true)
    }
  })
})
