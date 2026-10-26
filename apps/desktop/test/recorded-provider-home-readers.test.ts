import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'

let dir: string, root: string, home: string, db: AppDatabase, store: SessionStore
let host: RuntimeHost, transcriptHomes: string[], configHomes: string[]
const THREAD = 'thread_fern'
const IMAGE = 'image_fern'
const bytes = () =>
  [
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-10-01T12:00:00.000Z',
      payload: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'draw a fern' }],
      },
    }),
    JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-10-01T12:01:00.000Z',
      payload: {
        type: 'image_generation_end',
        call_id: IMAGE,
        status: 'completed',
        result: 'A'.repeat(64),
      },
    }),
  ].join('\n') + '\n'

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'brocrew-location-readers-')))
  root = join(dir, 'provider-homes')
  home = join(root, 'default', 'Fern', 'codex')
  mkdirSync(join(home, 'generated_images', THREAD), { recursive: true })
  writeFileSync(
    join(home, 'generated_images', THREAD, `${IMAGE}.png`),
    Buffer.from('89504e470d0a1a0a', 'hex'),
  )
  writeFileSync(join(home, 'rollout.jsonl'), bytes())
  db = openDatabase(join(dir, 'workspace.sqlite'))
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
  store = createSessionStore(db)
  store.adopt({
    id: 'fern',
    provider: 'codex',
    sessionId: THREAD,
    cwd: join(dir, 'work'),
    profileId: 'Fern',
    providerLocation: 'default/Fern/codex',
    createdAt: 100,
    updatedAt: 200,
  })
  transcriptHomes = []
  configHomes = []
  host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    providerHomesRoot: () => root,
    providerHomePath: (provider) => join(root, 'default', 'current-default', provider),
    prepareProviderHome: () => {
      throw new Error('Readers must not prepare a login')
    },
    nativeTranscriptPath: (_provider, folder) => {
      transcriptHomes.push(folder)
      const file = join(folder, 'rollout.jsonl')
      return existsSync(file) ? file : null
    },
    exportDirectory: () => join(dir, 'exports'),
    createRuntime: (provider) => new FakeRuntime(provider),
    resolveCwd: () => join(dir, 'work'),
    newSessionId: () => 'unused',
    readProviderConfig: (_provider, folder) => {
      configHomes.push(folder)
      return {
        home: folder,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [
          { name: 'rollout.jsonl', path: join(folder, 'rollout.jsonl'), exists: true, note: '' },
        ],
      }
    },
  })
})
afterEach(async () => {
  await host.closeAll()
  db.close()
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

it('imports the saved home’s transcript and resolves its generated image from that same home', async () => {
  const imported = await host.importRecordedSession('fern')
  expect(imported.outcome).toBe('imported')
  expect(transcriptHomes).toEqual([home])
  expect(store.events('fern').find((x) => x.event.type === 'image')?.event).toMatchObject({
    imageId: IMAGE,
    path: join(home, 'generated_images', THREAD, `${IMAGE}.png`),
  })
})
it('exports the native recording from its saved home without preparing credentials', async () => {
  const exported = await host.exportSession({ sessionId: 'fern', exportKind: 'native' })
  expect(transcriptHomes).toEqual([home])
  expect(readFileSync(exported.path, 'utf8')).toBe(bytes())
})
it('lists and removes only the files in the recorded home', async () => {
  const verdict = host.deleteVerdict('fern')
  expect(verdict.ok).toBe(true)
  const part = verdict.ok ? verdict.parts.find((x) => x.id === 'files:fern') : undefined
  expect(part?.paths).toContain(join(home, 'generated_images', THREAD))
  const deleted = await host.deleteConversation('fern', ['files:fern'])
  expect(deleted).toMatchObject({ done: true, left: [] })
  expect(existsSync(join(home, 'generated_images', THREAD))).toBe(false)
  expect(store.recordedOne('fern')).not.toBeNull()
})
it('keeps native-adopted null-location reads, exports and refusals exactly on their old routes', async () => {
  const native = join(dir, 'native-codex')
  vi.stubEnv('CODEX_HOME', native)
  mkdirSync(native)
  writeFileSync(join(native, 'rollout.jsonl'), bytes())
  store.adopt({
    id: 'native',
    provider: 'codex',
    sessionId: 'native_thread',
    cwd: join(dir, 'work'),
    profileId: null,
    providerLocation: 'default/Fern/codex',
    createdAt: 100,
    updatedAt: 200,
  })
  expect(store.providerLocationOf('native')).toBeNull()
  expect(host.readConfigFile('native', 'rollout.jsonl')).toMatchObject({ ok: true })
  expect(configHomes).toEqual([native])
  await host.exportSession({ sessionId: 'native', exportKind: 'native' })
  expect(transcriptHomes).toEqual([native])
  expect(await host.importRecordedSession('native')).toMatchObject({ outcome: 'user-home' })
  const verdict = host.deleteVerdict('native')
  expect(verdict.ok && verdict.parts.some((x) => x.kind === 'provider-files')).toBe(false)
})
