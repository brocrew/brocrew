import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate } from './lib/provider-double'

/**
 * # F046's rest — the compare-and-set re-title, the cases its own test leaves open
 *
 * `RuntimeHost.titleTheOlderFiles` re-titles a kept file only where the stored title is the file's
 * NAME, or EXACTLY what the reader before front matter (`resourceTitleBeforeFrontMatter`: the first
 * `# ` heading, capped at 200) gives from the same bytes, and the fresh read differs — and, beyond
 * the files titled by their name, it reads only files kept before **2026-10-11T00:00:00Z**
 * (`FRONT_MATTER_READ_EVERYWHERE_SINCE = Date.UTC(2026, 9, 11)`). The write is a compare-and-set
 * (`retitleResource(id, was, title)`).
 *
 * The dev's case (`a-kept-file-is-titled-by-what-its-own-bytes-say.test.ts`) pins a heading-titled
 * file replaced, a chosen title, two cut titles, gone bytes, a file kept AT the cutoff, a second
 * launch, and the store's two refusals. This file adds:
 *
 *  1. **The date bound from both sides** — a millisecond before it is read, at it and a day after are
 *     not; a file titled by its NAME is read whatever its date.
 *  2. **"Exactly what the old reader gave"** — its CAPPED heading, a YAML comment it took for a
 *     heading, and the heading after a fence are replaced; a second heading, another case, the text
 *     inside a fence, a title the heading-only reader gives that is also the fresh read, and a
 *     front-matter title are left.
 *  3. **A page** — re-titled from its `<title>` only while titled by its name, whatever its date.
 *  4. **The compare-and-set** — the store's write lands while the title is the one read and only
 *     once; and through the pass, a title written between its read and its write is kept.
 *  5. **Every page of the scan** — a file the old reader titled behind more than one page of
 *     candidates is still reached.
 *
 * ⚑ Every time is a literal UTC instant written onto the row, never the wall clock: the store's
 * clock here is 1970-something, so a row's `created_at` is exactly what the test sets.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ The cutoff, as a literal: a changed constant reads as a change here, never followed. */
const CUTOFF = Date.UTC(2026, 9, 11)
const DAY = 86_400_000

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** A report whose front matter names it, and whose first heading is `heading`. */
const report = (frontTitle: string, heading: string, body: string): string =>
  `---\ntitle: ${frontTitle}\nauthor: Ana\n---\n\n# ${heading}\n\n${body}\n`

describe('F046 · a title the old heading reader gave is replaced — and nothing else is', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (over: SessionStore): RuntimeHost => {
    const built = new RuntimeHost({
      store: over,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, anOpenGate()),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      resourcesRoot: () => resourcesRoot(userData),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f046-cas-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-f046-cas-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_260_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    window = new RecordingSink('webContents:1')
    host = buildHost(store)
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ── the rig ──────────────────────────────────────────────────────────────────────────────────

  /** ⚑ A person's conversation, and the root it owns — where its files are kept. */
  const aRootToKeepOn = async (): Promise<{ owner: string; label: string; piece: string }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'ali', approvalMode: 'auto', cwd: root },
      window,
    )
    const owned = store.rootOf(sessionId)
    if (owned === null) throw new Error(`${sessionId} owns no root`)
    return { owner: sessionId, label: owned.label, piece: owned.piece }
  }

  /** One file kept by ONE `update_work` call through the real door, answered `ok`. */
  const keeps = async (
    caller: string,
    piece: string,
    name: string,
    content: string,
  ): Promise<string> => {
    const path = join(root, name)
    writeFileSync(path, content)
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === 'update_work')
    if (tool === undefined) throw new Error('no update_work')
    const kept = (await tool.call({ piece, resources: [path] })).structured as Record<
      string,
      unknown
    >
    expect(kept.outcome, JSON.stringify(kept)).toBe('ok')
    const files = kept.resources as { resource: string; name: string }[]
    expect(files.map((one) => one.name)).toEqual([name])
    const id = files[0]?.resource
    if (id === undefined) throw new Error(`${name} was not kept`)
    return id
  }

  /** ⚑ The row as an older build left it: this stored title, kept at this instant. */
  const asLeft = (id: string, title: string, keptAt?: number): void => {
    db.prepare('UPDATE work_resource SET title = ? WHERE id = ?').run(title, id)
    if (keptAt !== undefined) {
      db.prepare('UPDATE work_resource SET created_at = ? WHERE id = ?').run(keptAt, id)
    }
  }

  const titleOf = (id: string): string | null | undefined => store.resource(id)?.title

  // ── 1 · the date bound, from both sides ──────────────────────────────────────────────────────

  it('🔴 the date bound: a millisecond before 2026-10-11 is read, at it and a day after are not — and a file titled by its name is read whatever its date', async () => {
    const { owner, label } = await aRootToKeepOn()
    const kept = async (name: string): Promise<string> =>
      keeps(owner, label, name, report(`The ${name} report`, 'Method', `body of ${name}`))
    const longBefore = await kept('long-before.md')
    const justBefore = await kept('just-before.md')
    const atTheCut = await kept('at-the-cut.md')
    const dayAfter = await kept('day-after.md')
    const namedAfter = await kept('named-after.md')
    // ⚑ What a build that read no front matter wrote: the first heading — or, with no heading
    // read, the name.
    asLeft(longBefore, 'Method', Date.UTC(2026, 8, 30))
    asLeft(justBefore, 'Method', CUTOFF - 1)
    asLeft(atTheCut, 'Method', CUTOFF)
    asLeft(dayAfter, 'Method', CUTOFF + DAY)
    asLeft(namedAfter, 'named-after.md', CUTOFF + DAY)

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 3 })
    expect(titleOf(longBefore), 'kept on 2026-09-30').toBe('The long-before.md report')
    expect(titleOf(justBefore), 'kept a millisecond before the cut').toBe(
      'The just-before.md report',
    )
    expect(titleOf(atTheCut), 'kept at the cut: never read').toBe('Method')
    expect(titleOf(dayAfter), 'kept a day after: never read').toBe('Method')
    expect(titleOf(namedAfter), 'titled by its name, kept after: read as before').toBe(
      'The named-after.md report',
    )
  })

  // ── 2 · exactly what the old reader gave ─────────────────────────────────────────────────────

  it('🔴 exactly what the heading-only reader gave is replaced — its capped heading, a YAML comment it took for one, the heading after a fence — and no near miss is', async () => {
    const { owner, label } = await aRootToKeepOn()
    const long = 'H'.repeat(260)
    const cappedByTheOldReader = `${'H'.repeat(199)}…`

    // ⚑ Replaced: what the old reader gave from these bytes.
    const capped = await keeps(owner, label, 'capped.md', report('Short front title', long, 'a'))
    asLeft(capped, cappedByTheOldReader)
    const comment = await keeps(
      owner,
      label,
      'comment.md',
      '---\n# Draft notes\ntitle: Field notes\n---\n\nbody\n',
    )
    asLeft(comment, 'Draft notes')
    const fencedThenReal =
      '---\ntitle: Fenced review\n---\n\n```\n# Not a heading\n```\n\n# Real heading\n'
    const afterFence = await keeps(owner, label, 'after-fence.md', fencedThenReal)
    asLeft(afterFence, 'Real heading')

    // ⛔ Left: none of these is what the old reader gave.
    const uncapped = await keeps(owner, label, 'uncapped.md', report('Uncut front', long, 'b'))
    asLeft(uncapped, long)
    const second = await keeps(
      owner,
      label,
      'second.md',
      '---\ntitle: Ledger review\n---\n\n# Method\n\n# Findings\n',
    )
    asLeft(second, 'Findings')
    const otherCase = await keeps(
      owner,
      label,
      'other-case.md',
      report('Case review', 'Method', 'c'),
    )
    asLeft(otherCase, 'method')
    const insideFence = await keeps(
      owner,
      label,
      'inside-fence.md',
      fencedThenReal.replace('Fenced review', 'Fenced again'),
    )
    asLeft(insideFence, 'Not a heading')
    // ⚑ No front matter title: the old reader and a fresh read agree, so nothing changes.
    const plain = await keeps(owner, label, 'plain.md', '# Plain heading\n\nbody\n')
    expect(titleOf(plain), 'kept by its heading').toBe('Plain heading')
    // ⚑ A front-matter title as kept by this build.
    const fresh = await keeps(owner, label, 'fresh.md', report('Fresh front title', 'Method', 'd'))
    expect(titleOf(fresh), 'kept by its front matter').toBe('Fresh front title')

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 3 })
    expect(titleOf(capped), 'the old reader’s capped heading').toBe('Short front title')
    expect(titleOf(comment), 'a YAML comment the old reader took for a heading').toBe('Field notes')
    expect(titleOf(afterFence), 'the first heading outside a fence').toBe('Fenced review')
    expect(titleOf(uncapped), 'an uncut heading is not what the old reader gave').toBe(long)
    expect(titleOf(second), 'a second heading').toBe('Findings')
    expect(titleOf(otherCase), 'another case').toBe('method')
    expect(titleOf(insideFence), 'a heading inside a fence').toBe('Not a heading')
    expect(titleOf(plain)).toBe('Plain heading')
    expect(titleOf(fresh)).toBe('Fresh front title')
    // ⚑ And once by the data.
    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 0 })
  })

  // ── 3 · a page ───────────────────────────────────────────────────────────────────────────────

  it('⚑ a page titled by its name takes its <title>, whatever its date; a page titled otherwise is left', async () => {
    const { owner, label } = await aRootToKeepOn()
    const page = (title: string): string => `<!doctype html><title>${title}</title><p>body</p>`
    const byName = await keeps(owner, label, 'status.html', page('Status and plan'))
    asLeft(byName, 'status.html', CUTOFF + DAY)
    const otherwise = await keeps(owner, label, 'other.html', page('Other plan'))
    asLeft(otherwise, 'Words somebody chose', Date.UTC(2026, 8, 30))

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 1 })
    expect(titleOf(byName)).toBe('Status and plan')
    expect(titleOf(otherwise)).toBe('Words somebody chose')
  })

  // ── 4 · the compare-and-set ──────────────────────────────────────────────────────────────────

  it('🔴 the store’s write lands while the title is the one read, once — and never after it moved', async () => {
    const { owner, label } = await aRootToKeepOn()
    const id = await keeps(owner, label, 'cas.md', report('CAS front title', 'Method', 'e'))
    expect(titleOf(id)).toBe('CAS front title')

    // ⚑ The paired positive: the title it was read as, so the write lands.
    expect(store.retitleResource(id, 'CAS front title', 'Picked')).toBe(true)
    expect(titleOf(id)).toBe('Picked')
    // ⛔ The same call again: the title is no longer the one it names.
    expect(store.retitleResource(id, 'CAS front title', 'Picked again')).toBe(false)
    expect(titleOf(id)).toBe('Picked')
    // ⛔ A write that changes nothing is no write.
    expect(store.retitleResource(id, 'Picked', 'Picked')).toBe(false)
    // ⛔ Another file's title is never touched by this one's write.
    const other = await keeps(owner, label, 'other.md', report('Other front', 'Method', 'f'))
    expect(store.retitleResource(other, 'Picked', 'Hijacked')).toBe(false)
    expect(titleOf(other)).toBe('Other front')
  })

  it('🔴 through the pass: a title written between its read and its write is kept — paired with one nobody touched', async () => {
    const { owner, label } = await aRootToKeepOn()
    const raced = await keeps(owner, label, 'raced.md', report('Raced front', 'Method', 'g'))
    const calm = await keeps(owner, label, 'calm.md', report('Calm front', 'Method', 'h'))
    asLeft(raced, 'Method')
    asLeft(calm, 'Method')

    // ⚑ A store that, once the pass has read its page, has somebody write `raced`'s title.
    const setTitle = db.prepare('UPDATE work_resource SET title = ? WHERE id = ?')
    const racing = new Proxy<SessionStore>(store, {
      get(target, key, receiver) {
        if (key === 'titledResources') {
          const read: SessionStore['titledResources'] = (after, limit, keptBefore) => {
            const page = target.titledResources(after, limit, keptBefore)
            setTitle.run('Named by Ana', raced)
            return page
          }
          return read
        }
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const racer = buildHost(racing)

    expect(await racer.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 1 })
    expect(titleOf(raced), 'written since it was read: kept').toBe('Named by Ana')
    expect(titleOf(calm), 'nobody touched it: replaced').toBe('Calm front')
  })

  // ── 5 · every page of the scan ───────────────────────────────────────────────────────────────

  it('⚑ a file the old reader titled is reached behind more than one page of candidates', async () => {
    const { owner, label, piece } = await aRootToKeepOn()
    // ⚑ 55 candidates first (titled by their name, kept long ago, bytes long gone): read and left.
    const insert = db.prepare(
      'INSERT INTO work_resource (id, work_id, role, title, name, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    for (let n = 0; n < 55; n += 1) {
      const name = `filler-${String(n)}.md`
      insert.run(`res_filler_${String(n)}`, piece, 'made', name, name, 'c'.repeat(64), 1, tick())
    }
    const behind = await keeps(owner, label, 'behind.md', report('Behind front', 'Method', 'i'))
    asLeft(behind, 'Method')

    expect(await host.titleTheOlderFiles()).toEqual({ titled: 0, retitled: 1 })
    expect(titleOf(behind)).toBe('Behind front')
    expect(titleOf('res_filler_0')).toBe('filler-0.md')
    expect(titleOf('res_filler_54')).toBe('filler-54.md')
  })
})
