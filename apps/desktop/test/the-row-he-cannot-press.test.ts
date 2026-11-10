import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { UNAVAILABLE_REASONS, describeUnavailable } from '../src/main/runtime/session-unavailable'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

const NOW = 1_800_000_000_000

describe('504 · the row he cannot press', () => {
  let userData: string
  let workspace: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let window: RecordingSink

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-504-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-504-cwd-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_504_${String(tick())}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:504')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
  })

  const lostBeforeItsId = (id: string): string => {
    store.create({ id, provider: 'claude', cwd: workspace, approvalMode: 'ask', profileId: 'pm' })
    store.append(id, 0, { type: 'user_turn', text: 'do the thing' } as TranscriptEvent, tick())
    return id
  }

  const named = (id: string): string => {
    lostBeforeItsId(id)
    store.append(
      id,
      1,
      {
        type: 'session',
        state: 'started',
        ref: { provider: 'claude', sessionId: `claude_${id}`, cwd: workspace, rotation: 0 },
      } as TranscriptEvent,
      tick(),
    )
    return id
  }

  describe('§1 · `472` F1, asked of the code rather than quoted', () => {
    it('🔴 a conversation whose ledger this app holds is dropped by `find`', () => {
      const lost = lostBeforeItsId('sess_lost')
      const whole = named('sess_whole')
      expect(store.find(lost), '`find` no longer drops a row with no ref').toBeNull()
      const recorded = store.recordedOne(lost)
      expect(recorded, 'the row this app is holding is not recorded').not.toBeNull()
      expect(recorded?.hasTranscript).toBe(true)
      expect(recorded?.unresumableReason).toBe(
        'this one stopped before Claude gave it an id, so there is nothing to carry on from',
      )
      expect(store.find(whole)).not.toBeNull()
      expect(store.recordedOne(whole)?.unresumableReason).toBeNull()
    })

    it('⛔ the reopen no longer says there is no recording of a conversation it holds', async () => {
      const lost = lostBeforeItsId('sess_lost')
      const said = await host.resumeSession(lost, window).then(
        () => null,
        (error: unknown) => (error as Error).message,
      )
      expect(said, 'the reopen resolved for a conversation with no ref').not.toBeNull()
      expect(said, 'the false sentence is still being said').not.toContain(
        'There is no record of this conversation',
      )
      expect(said).toContain('this one stopped before Claude gave it an id')
      expect(said).toContain('BroCrew could not continue this conversation')
      expect(said).not.toContain(lost)
    })

    it('⚑ an id this app has never recorded still gets the sentence that is true of it', async () => {
      const said = await host.resumeSession('sess_never_existed', window).then(
        () => null,
        (error: unknown) => (error as Error).message,
      )
      expect(said).toBe('There is no record of this conversation here.')
    })

    it('⛔ the new refusal says something no other refusal says', () => {
      const theRowsOwn = new Set<string>(['never-started'])
      expect(describeUnavailable('never-started')).toBe(describeUnavailable('cannot-be-reopened'))
      expect(describeUnavailable('never-started', { refusal: 'the row said this' })).toBe(
        describeUnavailable('cannot-be-reopened', { refusal: 'the row said this' }),
      )
      const said = UNAVAILABLE_REASONS.filter((reason) => !theRowsOwn.has(reason)).map((reason) =>
        describeUnavailable(reason),
      )
      expect(said).toHaveLength(UNAVAILABLE_REASONS.length - theRowsOwn.size)
      expect(new Set(said).size, 'two refusals say the same sentence').toBe(said.length)
      const withReason = describeUnavailable('cannot-be-reopened', { refusal: 'the row said this' })
      expect(withReason).toContain('the row said this')
      expect(describeUnavailable('cannot-be-reopened')).not.toContain('read')
    })
  })

  describe('§2 · what the Library answers about a recording', () => {
    it('⚑ `hasTranscript` is the ledger and not the row', () => {
      store.create({
        id: 'sess_empty',
        provider: 'claude',
        cwd: workspace,
        approvalMode: 'ask',
        profileId: 'pm',
      })
      const lost = lostBeforeItsId('sess_lost')
      expect(store.recordedOne('sess_empty')?.hasTranscript).toBe(false)
      expect(store.recordedOne(lost)?.hasTranscript).toBe(true)
      expect(store.recordedOne('sess_empty')?.unresumableReason).toContain(
        'no turn was ever taken in this one',
      )
      expect(store.recordedOne(lost)?.unresumableReason).toContain(
        'stopped before Claude gave it an id',
      )
    })

    it('🔴 a child that CAN be reopened still refuses direct input, and its parent does not', () => {
      for (const [id, child] of [
        ['sess_kid', { parentSessionId: 'parent-thread', nickname: 'Turing' }],
        ['sess_grown', undefined],
      ] as const) {
        store.adopt({
          id,
          provider: 'codex',
          sessionId: `${id}-thread`,
          cwd: workspace,
          profileId: 'pm',
          updatedAt: tick(),
          createdAt: NOW,
          ...(child ? { child } : {}),
        })
      }
      expect(store.recordedOne('sess_kid')?.unresumableReason).toContain('sub-agent conversation')
      expect(store.recordedOne('sess_grown')?.unresumableReason).toBeNull()
      expect(store.recordedOne('sess_kid')?.unresumableReason).toBe(
        store.resumable().find((row) => row.sessionId === 'sess_kid')?.resumeRefusal,
      )
    })
  })
})
