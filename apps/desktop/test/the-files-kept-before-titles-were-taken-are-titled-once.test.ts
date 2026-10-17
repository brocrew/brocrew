import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { keepResource, resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeChangeMessage } from '../src/shared/runtime-ipc'

/**
 * # F046 · the files kept before titles were taken are titled once, from their kept bytes
 *
 * `RuntimeHost.titleTheOlderFiles` (`50a548e2`, review fixes `3cbc4bf5`), started once after a
 * launch from `index.ts`, titles every `work_resource` row whose title is NULL by the rule a file
 * kept now is titled by (`resourceTitle`): a Markdown file or a page is read through
 * `resourceBytes`, which re-checks the hash; a file whose bytes are gone, unreadable or changed, and
 * every other form, is titled by its name. ⚑ It answers how many it titled and, since its second
 * half (W4.98), how many files an older reader titled (by their name, or by a heading before front
 * matter was read) it titled again — none of the rows here, whose title is what their bytes give or
 * whose bytes cannot be read. This file measures it over a real
 * `RuntimeHost`, a real SQLite store and a real resources tree in a temp `userData`, on the Fake
 * provider (no provider is ever started):
 *
 *  - **§1 · the titles** — each kind of row takes the title its kept bytes give, or its name; a row
 *    already titled is not touched; a second run titles nothing; and the windows are told ONCE
 *    (`theWorldMoved('work')`), and not at all when nothing was titled.
 *  - **§2 · the bounds** — 50 rows a page until a page is empty; a page that titles nothing ends the
 *    pass; a title written by someone else between the read and the write is never replaced; a quit
 *    begun before the first read reads nothing (the pass hands the main process back first); a quit
 *    begun mid-pass stops it after the file in hand, reads no further page and tells no window.
 *
 * ⚑ **How a quit begins**: `closeAll()` — its first statement closes the host's launch admission
 * (`launches.closeAdmission()`), the flag the pass reads, before anything is awaited.
 *
 * ⚑ **The store the host is handed is the real one behind a watch** ({@link watched}): every member
 * passes through, and the two F046 doors are counted, so a test can see each page the pass asked
 * for and, when it arms one, act at the moment of a write.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const shaOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

describe('F046 · titleTheOlderFiles', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let said: RuntimeChangeMessage[]
  let piece: string
  let planted: number
  /** How many rows each `untitledResources` call the HOST made answered, in order. */
  let pages: number[]
  /** The `limit` each of those calls asked for. */
  let limits: number[]
  /** Called before each `titleResource` the HOST makes; returning `false` skips the real write. */
  let beforeTitle: ((id: string, title: string) => boolean) | null
  /** ⛔ A ceiling on the pages the host may ask for — a pass that spins fails instead of hanging. */
  let mostPages: number
  const tick = (): number => clock++

  /** The real store, every member passing through, the two F046 doors watched. */
  const watched = (real: SessionStore): SessionStore =>
    new Proxy<SessionStore>(real, {
      get(target, key) {
        if (key === 'untitledResources') {
          return (limit: number) => {
            if (pages.length >= mostPages) {
              throw new Error(`the pass asked for page ${pages.length + 1}: it does not stop`)
            }
            const page = target.untitledResources(limit)
            limits.push(limit)
            pages.push(page.length)
            return page
          }
        }
        if (key === 'titleResource') {
          return (id: string, title: string): boolean => {
            if (beforeTitle !== null && !beforeTitle(id, title)) return false
            return target.titleResource(id, title)
          }
        }
        const member: unknown = Reflect.get(target, key)
        return typeof member === 'function'
          ? (member as (...args: unknown[]) => unknown).bind(target)
          : member
      },
    })

  const buildHost = (withResources: boolean): RuntimeHost =>
    new RuntimeHost({
      store: watched(store),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      ...(withResources ? { resourcesRoot: () => resourcesRoot(userData) } : {}),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      announce: (change) => said.push(change),
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f046-pass-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 4_600_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    said = []
    planted = 0
    pages = []
    limits = []
    beforeTitle = null
    mostPages = 20
    host = buildHost(true)
    // ⚑ A conversation a person started owns a root: the piece every file below was kept on.
    store.create({
      id: 'sess_keeper',
      provider: 'claude',
      cwd: userData,
      approvalMode: 'auto',
      profileId: 'keeper',
    })
    const root = store.rootOf('sess_keeper')
    if (root === null) throw new Error('the keeper owns no root')
    piece = root.piece
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The rig
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /** A row as a build before D-026 wrote it — no title — naming `name` and `sha256`. */
  const plantUntitled = (name: string, sha256: string, bytes = 1): string => {
    const id = `res_${String(++planted).padStart(32, '0')}`
    db.prepare(
      'INSERT INTO work_resource (id, work_id, role, name, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, piece, 'made', name, sha256, bytes, tick())
    return id
  }

  /** The bytes put where this app keeps them, and an untitled row naming them. */
  const keptUntitled = (name: string, content: string): { id: string; sha256: string } => {
    const bytes = Buffer.from(content, 'utf8')
    const sha256 = shaOf(bytes)
    expect(keepResource(resourcesRoot(userData), { bytes, sha256, name })).toEqual({ ok: true })
    return { id: plantUntitled(name, sha256, bytes.length), sha256 }
  }

  /** Where this app keeps a file's bytes. */
  const keptAt = (sha256: string, name: string): string =>
    join(resourcesRoot(userData), sha256, name)

  const titleOf = (id: string): string | null | undefined => store.resource(id)?.title

  const toldWork = (): number => said.filter((change) => change.what === 'work').length

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the titles
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('each older file takes the title its kept bytes give, or its name when they cannot be read, and a second run titles none', async () => {
    // ⚑ Read, and titled by what they say.
    const heading = keptUntitled('findings.md', '# Findings\n\nrows\n')
    const front = keptUntitled(
      'recheck.md',
      '---\ntitle: Re-check of 9 runtime findings\n---\n# Method\n',
    )
    const page = keptUntitled(
      'leaf.html',
      '<!doctype html><title>The leaf &amp; more</title><p>body</p>',
    )
    // ⚑ Read, and nothing found: the name.
    const plain = keptUntitled('plain.md', 'no heading here\n')
    // ⛔ Bytes gone: the name.
    const gone = plantUntitled('gone.md', '2'.repeat(64))
    // ⛔ Bytes changed since they were kept — the hash re-checked — the name, not either heading.
    const changed = keptUntitled('changed.md', '# Before\n')
    writeFileSync(keptAt(changed.sha256, 'changed.md'), '# After\n')
    // ⛔ Something unreadable where the file is kept (a directory): the name.
    const unreadableSha = '3'.repeat(64)
    mkdirSync(keptAt(unreadableSha, 'folder.md'), { recursive: true })
    const unreadable = plantUntitled('folder.md', unreadableSha)
    // ⛔ A form with no text to look in, whatever its bytes say: the name.
    const drawing = keptUntitled('drawing.svg', '<svg><title>A drawing</title></svg>')
    // ⚑ A row this build kept, with its title: never touched.
    const kept = store.addResource(
      {
        piece,
        role: 'made',
        title: 'Taken as it was kept',
        summary: null,
        name: 'kept.md',
        sha256: '4'.repeat(64),
        bytes: 1,
        addedBy: null,
      },
      tick(),
    ).resource

    // ⚠️ The premise: eight rows wait, and the kept one is not among them.
    expect(store.untitledResources(100)).toHaveLength(8)
    said = []

    const first = await host.titleTheOlderFiles()
    expect(first).toEqual({ titled: 8, retitled: 0 })
    expect(titleOf(heading.id), 'a heading').toBe('Findings')
    expect(titleOf(front.id), 'a front matter title, before the heading').toBe(
      'Re-check of 9 runtime findings',
    )
    expect(titleOf(page.id), 'a page’s <title>, its entity decoded').toBe('The leaf & more')
    expect(titleOf(plain.id), 'read, and no heading').toBe('plain.md')
    expect(titleOf(gone), 'bytes gone').toBe('gone.md')
    expect(titleOf(changed.id), 'bytes changed').toBe('changed.md')
    expect(titleOf(unreadable), 'bytes unreadable').toBe('folder.md')
    expect(titleOf(drawing.id), 'an image').toBe('drawing.svg')
    expect(titleOf(kept), 'a row already titled').toBe('Taken as it was kept')
    expect(store.untitledResources(100)).toEqual([])
    // ⚑ Windows told once, at the end — not once a file.
    expect(toldWork()).toBe(1)

    // ⚑ Once, by the data: a second run finds none, titles none, and tells no window.
    said = []
    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 0 })
    expect(toldWork()).toBe(0)
    expect(titleOf(heading.id)).toBe('Findings')
  })

  it('a host with no resources tree titles nothing; the same rows with one are titled', async () => {
    const id = keptUntitled('findings.md', '# Findings\n').id
    const bare = buildHost(false)
    try {
      expect(await bare.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 0 })
      expect(titleOf(id)).toBeNull()
      expect(pages, 'no page was read').toEqual([])
    } finally {
      await bare.closeAll()
    }
    said = []
    expect(await host.titleTheOlderFiles()).toEqual({ titled: 1, retitled: 0 })
    expect(titleOf(id)).toBe('Findings')
    expect(toldWork()).toBe(1)
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the bounds
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('more than a page of rows is titled 50 at a time until a page is empty, and the windows are told once', async () => {
    const ids: string[] = []
    for (let n = 1; n <= 120; n++) {
      ids.push(plantUntitled(`old-${String(n).padStart(3, '0')}.md`, '5'.repeat(64)))
    }
    said = []

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 120, retitled: 0 })
    expect(pages).toEqual([50, 50, 20, 0])
    expect(
      limits.every((limit) => limit === 50),
      JSON.stringify(limits),
    ).toBe(true)
    expect(ids.map(titleOf)).toEqual(
      ids.map((_, at) => `old-${String(at + 1).padStart(3, '0')}.md`),
    )
    expect(toldWork()).toBe(1)
  })

  it('a page that titles nothing ends the pass, and no window is told', async () => {
    for (const name of ['a.md', 'b.md', 'c.md']) plantUntitled(name, '6'.repeat(64))
    // ⛔ Every write does nothing — as if each row had been titled elsewhere — so every page reads
    // the same three rows again. A pass that only stopped on an empty page would spin.
    beforeTitle = () => false
    mostPages = 3
    said = []

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 0 })
    expect(pages, 'one page read, and the pass stopped').toEqual([3])
    expect(store.untitledResources(10)).toHaveLength(3)
    expect(toldWork()).toBe(0)

    // ⚑ The paired positive: the same rows, the writes let through, are titled in one page.
    beforeTitle = null
    pages = []
    expect(await host.titleTheOlderFiles()).toEqual({ titled: 3, retitled: 0 })
    expect(pages).toEqual([3, 0])
    expect(toldWork()).toBe(1)
  })

  it('a title written between the read and the write is never replaced, and is not counted', async () => {
    const first = keptUntitled('first.md', '# First\n').id
    const raced = keptUntitled('raced.md', '# Raced\n').id
    const third = keptUntitled('third.md', '# Third\n').id
    // ⚑ The moment the pass writes its first title, the second row is titled elsewhere — after the
    // page that holds it was read.
    beforeTitle = (id) => {
      if (id === first) expect(store.titleResource(raced, 'Titled elsewhere')).toBe(true)
      return true
    }

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 2, retitled: 0 })
    expect(titleOf(first)).toBe('First')
    expect(titleOf(raced), 'the title written elsewhere stands').toBe('Titled elsewhere')
    expect(titleOf(third)).toBe('Third')
  })

  it('a quit begun as the pass starts stops it before its first read: it hands the main process back first', async () => {
    const id = keptUntitled('findings.md', '# Findings\n').id
    said = []

    const pass = host.titleTheOlderFiles()
    // ⚑ Synchronously, before anything else runs: `closeAll` closes admission on its first line.
    const quitting = host.closeAll()
    expect(host.closing).toBe(true)

    expect(await pass).toEqual({ titled: 0, retitled: 0 })
    await quitting
    expect(pages, 'no page was read after the quit began').toEqual([])
    expect(titleOf(id)).toBeNull()
    expect(toldWork()).toBe(0)
  })

  it('a quit begun mid-pass stops it after the file in hand: no further file, no further page, no window told', async () => {
    const ids: string[] = []
    for (let n = 1; n <= 60; n++) ids.push(plantUntitled(`q-${String(n)}.md`, '7'.repeat(64)))
    let writes = 0
    const quits: Promise<void>[] = []
    beforeTitle = () => {
      writes += 1
      // ⚑ The quit begins as the third file is being titled: that write lands, nothing after it.
      if (writes === 3) quits.push(host.closeAll())
      return true
    }
    said = []

    const answered = await host.titleTheOlderFiles()
    expect(quits, 'the quit began').toHaveLength(1)
    await Promise.all(quits)

    expect(answered).toEqual({ titled: 3, retitled: 0 })
    expect(writes, 'no write after the quit began').toBe(3)
    expect(pages, 'one page read: none after the quit').toEqual([50])
    expect(ids.slice(0, 3).map(titleOf)).toEqual(['q-1.md', 'q-2.md', 'q-3.md'])
    expect(store.untitledResources(100)).toHaveLength(57)
    expect(toldWork(), 'a quit is no time to tell a window').toBe(0)

    // ⚑ The paired positive, on the next launch: a fresh host over the same store titles the rest.
    await host.closeAll()
    host = buildHost(true)
    pages = []
    beforeTitle = null
    said = []
    expect(await host.titleTheOlderFiles()).toEqual({ titled: 57, retitled: 0 })
    expect(pages).toEqual([50, 7, 0])
    expect(store.untitledResources(100)).toEqual([])
    expect(toldWork()).toBe(1)
  })
})
