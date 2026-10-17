import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { ForestConversation } from '../src/shared/the-whole-forest'

/**
 * # 🔴 The forest's conversation row says WHO by one word, and carries no name of its own
 *
 * ⚑ **`449`'s measured defect, and the rule it left.** One identity was drawn under its name in one
 * list and under its slug in another, because two lists each answered *what is this identity
 * called*. ⛔ **`agentName` is the one function that answers it**, and a list row that carries
 * `displayName` beside `identity` is a second answer arriving as a field.
 *
 * ⚑ **D-016 (`bd70d693`) deleted `ProjectConversation` and, with it, the only census that pinned
 * this** (`expect(row).not.toContain('displayName')` in the roster test). The rule did not go: the
 * conversation-list row is now `ForestConversation`, it carries the binding's folded slug as
 * `identity`, and nothing may sit beside it that names the identity.
 *
 * ## ⛔ Why a SOURCE census, and what the runtime half is for
 *
 * ⚠️ **A field added to an interface is a TYPE fact.** Vitest does not typecheck, and the store
 * that builds each row is a SELECT that would go on returning the same keys — so no run of a real
 * host can see a `displayName?: …` planted on the interface, and this file does not pretend one
 * can. §1 reads the declaration itself, with the prose stripped. §2 is the other half, over a real
 * `RuntimeHost` and a real SQLite ledger: an identity that HAS a display name still draws no name
 * in its conversation row, so a SELECT that grew the column would go red there.
 *
 * 🔒 The provider is a double, every directory is temporary, and no live app, port, provider home
 * or `auth.json` is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const FOREST_SRC = join(here, '../src/shared/the-whole-forest.ts')
const WIRE_SRC = join(here, '../src/shared/runtime-ipc.ts')

/** ⛔ **Prose stripped before anything is read** — a docblock naming a field is not a field. */
function withoutProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{(=,>])\/\/[^\n]*/g, '$1')
}

/** ⚑ **The text between an interface's braces**, found by counting them. */
function bodyOf(source: string, name: string): string {
  const head = new RegExp(`export interface ${name}(?:<[^>]*>)?\\s*\\{`).exec(source)
  if (head === null) throw new Error(`no interface ${name}`)
  let depth = 1
  let at = head.index + head[0].length
  const start = at
  while (depth > 0 && at < source.length) {
    const char = source[at]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    at += 1
  }
  if (depth !== 0) throw new Error(`interface ${name} never closes`)
  return source.slice(start, at - 1)
}

/** ⚑ **The property names declared at the interface's own level** — two-space indent, no deeper. */
function fieldsOf(body: string): string[] {
  return [...body.matchAll(/^ {2}(?:readonly\s+)?(\w+)\??\s*:/gm)].map((match) => match[1] ?? '')
}

/** ⛔ **Anything that could be a second answer to *what is this identity called*.** */
const A_NAME = /display|name|label|title|slug/i

describe('a conversation row in the forest carries no name of its own', () => {
  describe('§1 · the declaration', () => {
    const forest = withoutProse(readFileSync(FOREST_SRC, 'utf8'))
    const wire = withoutProse(readFileSync(WIRE_SRC, 'utf8'))

    it('🔴 `ForestConversation` names its identity by ONE field and declares no name beside it', () => {
      const body = bodyOf(forest, 'ForestConversation')
      const fields = fieldsOf(body)

      // ⚑ **The one answer is there** — the binding's folded slug, typed as text.
      expect(/^ {2}readonly identity: string$/m.test(body)).toBe(true)
      expect(fields).toContain('identity')
      // ⛔ **And nothing declared on the row can be read as a name.** `spawnReason` is the spawner's
      // sentence and `conversation` is an id; neither matches, and neither is a name.
      expect(fields.filter((field) => A_NAME.test(field))).toEqual([])
      // ⚠️ **The extractor read the whole row** — not an empty body that passes for want of fields.
      expect(fields).toEqual(
        expect.arrayContaining(['node', 'conversation', 'under', 'provider', 'running']),
      )
    })

    it('⚑ the same extractor and pattern DO find a name where one is declared', () => {
      // ⚠️ **The control that plants two** (standing rule 12): an interface on the wire that carries
      // `displayName` beside a slug, read by the same functions and matched by the same pattern.
      const named = fieldsOf(bodyOf(wire, 'AgentIdentity'))
      expect(named).toContain('slug')
      expect(named).toContain('displayName')
      expect(named.filter((field) => A_NAME.test(field))).toContain('displayName')

      // …and the plant's own shape, as a row of its own: a name declared beside `identity`. ⚠️ A
      // literal and not an edit of the real row, so this control reads the same on any tree.
      const planted = bodyOf(
        'export interface Row {\n  readonly identity: string\n  readonly displayName: string | null\n}',
        'Row',
      )
      expect(fieldsOf(planted)).toEqual(['identity', 'displayName'])
      expect(fieldsOf(planted).filter((field) => A_NAME.test(field))).toEqual(['displayName'])
    })
  })

  describe('§2 · the row a real host answers', () => {
    let userData: string
    let workspace: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let clock: number

    const tick = (): number => clock++

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-forest-name-'))
      workspace = mkdtempSync(join(tmpdir(), 'brobot2-forest-name-cwd-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsDir)
      clock = 1_800_000_000_000
      store = createSessionStore(db, tick)
      host = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (provider: Provider) => new FakeRuntime(provider),
        prepareProviderHome: (provider: Provider, profileId?: string) => {
          const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
          mkdirSync(home, { recursive: true })
          return home
        },
        providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_name_${String(tick())}`,
        now: tick,
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
        announce: () => {},
      })
    })

    afterEach(async () => {
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    })

    const open = (id: string, profileId: string): string => {
      store.create({
        id,
        provider: 'codex',
        cwd: workspace,
        approvalMode: 'ask',
        profileId,
      })
      return id
    }

    const rowFor = (id: string): ForestConversation => {
      const found = host
        .theWholeForest()
        .nodes.rows.find(
          (row): row is ForestConversation =>
            row.node === 'a-conversation' && row.conversation === id,
        )
      if (found === undefined) throw new Error(`no node for ${id}`)
      return found
    }

    it('🔴 an identity that HAS a display name still draws only its slug in the conversation row', () => {
      const named = open('sess_named', 'Dev')
      const plain = open('sess_plain', 'worker')
      // ⚑ **A person's own name for one identity** — the column a second answer would read.
      const changed = db
        .prepare(`UPDATE agent_identity SET display_name = 'Nadia the Planner' WHERE slug = 'dev'`)
        .run()
      expect(changed.changes).toBe(1)

      const row = rowFor(named)
      // ⛔ **The row says WHO by the folded slug and by nothing else** — no key of it is a name, and
      // no value of it is the name a person chose.
      expect(row.identity).toBe('dev')
      expect(Object.keys(row).filter((key) => A_NAME.test(key))).toEqual([])
      expect(Object.values(row)).not.toContain('Nadia the Planner')
      expect(JSON.stringify(row)).not.toContain('Nadia the Planner')

      // ⚑ **The control**: the identity really is named — the ledger holds the name the row leaves
      // out — and the other conversation is drawn by its slug just the same, so the row is not
      // empty for want of a fixture.
      const stored = db
        .prepare(`SELECT display_name AS name FROM agent_identity WHERE slug = 'dev'`)
        .get() as { name: string | null }
      expect(stored.name).toBe('Nadia the Planner')
      expect(rowFor(plain).identity).toBe('worker')
      expect(Object.keys(rowFor(plain))).toEqual(Object.keys(row))
    })
  })
})
