import ts from 'typescript'
import { createHash } from 'node:crypto'
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
import { FakeRuntime, claudeAutoMemoryDir } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createMemoryAmendmentObserver,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { createMemoryService, type MemoryService } from '../src/main/runtime/agent-memory'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { WINDOW_CALLER_PREFIX } from '../src/main/runtime/window-caller'
import type { AgentMemoryAmended } from '../src/shared/agent-memory'

// This fixture also compiles before the host adopts the existing durable service.
let root: string
let entry: string
let db: AppDatabase
let store: SessionStore
let service: MemoryService
let host: RuntimeHost
const text = 'A saved note.\r\nCafé.\n'
const fingerprint = createHash('sha256').update(text).digest('hex')
const sink: RuntimeEventSink = {
  alive: true,
  aPersonIsBehindIt: true,
  ownerId: `${WINDOW_CALLER_PREFIX}92`,
  send: () => {},
  sendLiveness: () => {},
}
const home = (provider: Provider, slug: string) => join(root, 'homes', 'default', slug, provider)
const asked = (change: { confirmed?: boolean; fingerprint?: string } = {}) => ({
  profileId: 'lark',
  provider: 'claude' as const,
  entry,
  act: 'removed' as const,
  text: '',
  confirmed: true,
  fingerprint,
  ...change,
})

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'memory-host-intent-'))
  db = openDatabase(join(root, 'app.sqlite'))
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  store = createSessionStore(db)
  store.createAgentIdentity(
    { slug: 'lark', displayName: null, provider: 'claude' },
    { by: 'a-person' },
  )
  entry = join(claudeAutoMemoryDir(home('claude', 'lark')), 'note.md')
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(entry, text)
  service = await createMemoryService({
    store,
    now: Date.now,
    inputsOf: (slug) => ({
      profileId: slug,
      homesRoot: join(root, 'homes'),
      homeOf: (provider) => home(provider, slug),
    }),
    reconcile: createMemoryAmendmentObserver(db).reconcile,
  })
  const deps = {
    store,
    memoryKnowledge: service,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(root, 'exports'),
    createRuntime: (provider: Provider) => new FakeRuntime(provider),
    prepareProviderHome: (provider: Provider, profileId: string) => home(provider, profileId),
    providerHomePath: home,
    providerHomesRoot: () => join(root, 'homes'),
    resolveCwd: (_session: string, requested?: string) => requested ?? root,
    newSessionId: () => 'ses-lark',
    readProviderConfig: (_provider: Provider, path: string) => ({
      home: path,
      homeEnv: 'CLAUDE_CONFIG_DIR' as const,
      model: 'm',
      authNote: null,
      files: [],
    }),
  }
  host = new RuntimeHost(deps)
})
afterEach(async () => {
  await host.closeAll()
  await service.close(0)
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('the window host uses the durable memory service', () => {
  it.each([{ confirmed: false }, { fingerprint: '0'.repeat(64) }])(
    'refuses a missing confirmation or stale displayed text: %j',
    async (change) => {
      const reply = await host.amendAgentMemory(asked(change), sink)
      expect(reply?.done).toBe(false)
      expect(readFileSync(entry, 'utf8')).toBe(text)
      expect(store.memoryAmendmentsOf('lark')).toEqual([])
    },
  )
  it('refuses an app-initiated change before touching or recording the file', async () => {
    expect(await host.amendAgentMemory(asked(), THE_APP_ITSELF)).toBeNull()
    expect(readFileSync(entry, 'utf8')).toBe(text)
    expect(store.memoryAmendmentsOf('lark')).toEqual([])
  })
  it('reports the pending-memory hold when removal is refused', () => {
    expect(
      store.beginMemoryAmendment(
        {
          profileSlug: 'lark',
          provider: 'claude',
          entry,
          act: 'removed',
          textBefore: text,
          textAfter: null,
          by: { who: 'a-person' },
        },
        Date.now(),
      ),
    ).not.toBeNull()
    expect(host.removeAgent('lark')).toMatchObject({
      ok: false,
      rail: 'it-is-still-held',
      held: ['unfinished-memory-change'],
    })
    expect(readFileSync(entry, 'utf8')).toBe(text)
  })
  it('offers a person Undo using the recorded source and exact saved text', async () => {
    const removed = await host.amendAgentMemory(asked(), sink)
    expect(removed?.done).toBe(true)
    if (!removed?.done) throw new Error('Expected a removal')
    expect(existsSync(entry)).toBe(false)
    const undo: unknown = Reflect.get(host, 'undoAgentMemory')
    expect(undo, 'person memory Undo').toBeTypeOf('function')
    const restored = (await Reflect.apply(
      undo as (input: unknown, by: RuntimeEventSink) => Promise<AgentMemoryAmended | null>,
      host,
      [{ profileId: 'lark', sourceId: removed.amendment.id, confirmed: true }, sink],
    )) as AgentMemoryAmended | null
    expect(restored?.done).toBe(true)
    expect(restored?.done && restored.amendment.by).toEqual({ who: 'a-person' })
    expect(readFileSync(entry, 'utf8')).toBe(text)
  })
})

it('has no main-process import of the legacy filesystem-first memory writer', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../src/main')
  let checked = 0
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name)
      if (entry.isDirectory()) {
        walk(file)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
      const tree = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      for (const item of tree.statements) {
        if (
          !ts.isImportDeclaration(item) ||
          !ts.isStringLiteral(item.moduleSpecifier) ||
          !item.moduleSpecifier.text.endsWith('/agent-memory') ||
          item.importClause?.isTypeOnly
        )
          continue
        checked++
        const bindings = item.importClause?.namedBindings
        expect(bindings === undefined || ts.isNamedImports(bindings), file).toBe(true)
        if (bindings && ts.isNamedImports(bindings))
          expect(
            bindings.elements
              .filter((one) => !one.isTypeOnly)
              .map((one) => (one.propertyName ?? one.name).text),
            file,
          ).not.toContain('amendAgentMemory')
      }
    }
  }
  walk(root)
  expect(checked).toBeGreaterThan(0)
})
