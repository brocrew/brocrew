import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { createMethodChangeStore } from '../src/main/db/method-changes'
import { createSavedMethodService } from '../src/main/saved-method-service'
import { stageKnowledgeFile, sweepKnowledgeStages } from '../src/main/runtime/agent-memory'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import type { MethodLibrary, MethodDeleteSelection } from '../src/shared/saved-method-library'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person: RuntimeEventSink = {
  ownerId: 'webContents:1',
  aPersonIsBehindIt: true,
  alive: true,
  send() {},
  sendLiveness() {},
}
const agent: RuntimeEventSink = {
  ownerId: 'agent:wren',
  aPersonIsBehindIt: false,
  alive: true,
  send() {},
  sendLiveness() {},
}
let root: string
let folder: string
let db: AppDatabase
let host: RuntimeHost
let service: Awaited<ReturnType<typeof createSavedMethodService>>
const read = (kind: string, extra: object = {}, sink = person) => {
  const packet = { kind, profileId: 'lark', ...extra }
  expect(runtimeCommandSchema.safeParse(packet).success, 'the window command is available').toBe(
    true,
  )
  return executeRuntimeCommand(host, sink, packet)
}
async function selection(): Promise<MethodDeleteSelection> {
  const listed = (await read('agentMethods')) as MethodLibrary
  const item = listed.items.find((item) => item.name === 'review.md')!
  return {
    confirmed: true,
    key: item.key,
    fingerprint: item.fingerprint,
    indexState: listed.indexState,
    indexFingerprint: listed.indexFingerprint,
  }
}
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'method-window-'))
  db = openDatabase(join(root, 'app.sqlite'))
  applyMigrations(db, migrations)
  const store = createSessionStore(db)
  store.createAgentIdentity(
    { slug: 'lark', displayName: null, provider: 'codex' },
    { by: 'a-person' },
  )
  const homes = join(root, 'homes')
  folder = join(homes, 'lark', 'runbooks')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'review.md'), '# Review\nkept text', { mode: 0o600 })
  writeFileSync(
    join(folder, 'index.md'),
    '- Review | During review | verified 2026-10-21 | review.md\n',
  )
  service = await createSavedMethodService({
    homesRoot: homes,
    folderOf: (slug) => join(homes, slug, 'runbooks'),
    identities: () => store.agentIdentities(),
    changes: createMethodChangeStore(db),
    now: Date.now,
    stage: stageKnowledgeFile,
    sweep: sweepKnowledgeStages,
  })
  host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(root, 'exports'),
    createRuntime: (provider) => new FakeRuntime(provider),
    prepareProviderHome: () => root,
    providerHomePath: () => root,
    resolveCwd: () => root,
    newSessionId: () => 'ses-wren',
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'm',
      authNote: null,
      files: [],
    }),
    ...{ savedMethods: service },
  })
})
afterEach(async () => {
  await host?.closeAll()
  db?.close()
  rmSync(root, { recursive: true, force: true })
})

describe('a person manages saved methods through bounded window commands', () => {
  it('reads a page and the selected body without accepting a file path', async () => {
    const listed = (await read('agentMethods', { offset: 0, limit: 1 })) as MethodLibrary
    expect(listed.items).toHaveLength(1)
    expect(listed.nextOffset).toBe(1)
    const selected = await selection()
    expect(await read('agentMethodBody', { key: selected.key })).toMatchObject({
      ok: true,
      text: '# Review\nkept text',
    })
    expect(await read('agentMethodBody', { key: '../review.md' })).toEqual({
      ok: false,
      problem: 'missing',
    })
  })
  it('refuses every method command from an agent before reaching the service', async () => {
    for (const [kind, extra] of [
      ['agentMethods', {}],
      ['agentMethodBody', { key: 'method:review.md' }],
      ['agentMethodChanges', {}],
      [
        'removeAgentMethod',
        {
          selection: {
            confirmed: true,
            key: 'method:review.md',
            fingerprint: null,
            indexState: 'absent',
            indexFingerprint: null,
          },
        },
      ],
      ['undoAgentMethod', { changeId: 'change-one' }],
      ['checkInterruptedAgentMethods', { confirmed: true }],
    ] as const) {
      expect(runtimeCommandSchema.safeParse({ kind, profileId: 'lark', ...extra }).success).toBe(
        true,
      )
      await expect(read(kind, extra, agent)).rejects.toThrow(/person/)
    }
    expect(existsSync(join(folder, 'review.md'))).toBe(true)
    expect(service.history('lark')).toMatchObject({ ok: true, changes: [] })
  })
  it('requires confirmation and records a reversible named change', async () => {
    const selected = await selection()
    expect(
      await read('removeAgentMethod', { selection: { ...selected, confirmed: false } }),
    ).toMatchObject({ ok: false })
    const removed = (await read('removeAgentMethod', { selection: selected })) as {
      ok: boolean
      change: { id: string }
    }
    expect(removed.ok).toBe(true)
    expect(existsSync(join(folder, 'review.md'))).toBe(false)
    expect(await read('agentMethodChanges')).toMatchObject({
      ok: true,
      changes: [{ id: removed.change.id, by: { who: 'a-person' }, canUndo: true }],
    })
    expect(JSON.stringify(await read('agentMethodChanges'))).not.toMatch(
      /base64|textBefore|kept text/,
    )
    expect(await read('undoAgentMethod', { changeId: removed.change.id })).toMatchObject({
      ok: true,
    })
    expect(readFileSync(join(folder, 'review.md'), 'utf8')).toBe('# Review\nkept text')
  })
  it('refuses stale displayed files and interruption checks without confirmation', async () => {
    const selected = await selection()
    writeFileSync(join(folder, 'review.md'), 'external')
    expect(await read('removeAgentMethod', { selection: selected })).toMatchObject({ ok: false })
    expect(readFileSync(join(folder, 'review.md'), 'utf8')).toBe('external')
    expect(await read('checkInterruptedAgentMethods', { confirmed: false })).toMatchObject({
      ok: false,
      reason: 'confirmation-required',
    })
  })
  it('bounds every window field and refuses caller-supplied filesystem authority', () => {
    for (const packet of [
      { kind: 'agentMethods', offset: -1 },
      { kind: 'agentMethods', limit: 101 },
      { kind: 'agentMethodChanges', offset: 1_000_001 },
      { kind: 'agentMethodBody', key: 'x'.repeat(1025) },
      { kind: 'undoAgentMethod', changeId: '' },
      { kind: 'checkInterruptedAgentMethods' },
      {
        kind: 'removeAgentMethod',
        selection: {
          confirmed: true,
          key: 'review.md',
          fingerprint: 'wrong',
          indexState: 'ok',
          indexFingerprint: null,
        },
      },
      { kind: 'agentMethodBody', key: 'method:review.md', path: '/outside.md' },
    ])
      expect(
        runtimeCommandSchema.safeParse({ profileId: 'lark', ...packet }).success,
        JSON.stringify(packet),
      ).toBe(false)
  })
  it('keeps the host service gate closed even when called without IPC', async () => {
    const list = Reflect.get(host, 'agentMethods') as (...args: unknown[]) => unknown
    const remove = Reflect.get(host, 'removeAgentMethod') as (...args: unknown[]) => unknown
    expect(list).toBeTypeOf('function')
    expect(remove).toBeTypeOf('function')
    expect(list.call(host, 'lark', 0, 50, agent)).toBeNull()
    expect(await remove.call(host, 'lark', { confirmed: true }, agent)).toMatchObject({
      ok: false,
      reason: 'person-required',
    })
  })
})
