import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **D-017 · R8 — one torn instruction row is skipped, and it never takes the whole read down**
 * (`one-task-one-reading.test.ts`'s §2 device, aimed at `instructionAsksWaiting` instead of the
 * work fold it pins).
 *
 * ⛔ **`selectInstructionAsks` is cross-session** — it reads `instruction_proposed` and
 * `instruction_settled` rows from every ledger in the database, not one conversation's own — so a
 * row torn in a conversation NOBODY is asking about can still reach the fold that answers everyone
 * else's queue. ⚑ §1-§2 below plant exactly that: a real, well-formed ask in one conversation, and
 * a broken row in another, and assert the real ask is read back unharmed either way.
 *
 * ⚠️ **§3 is a different fact about the same ledger** — that nothing in this app withdraws an ask
 * on its asker's behalf. `RuntimeHost`'s constructor runs five stranded-work sweeps on every
 * launch, and none of them touch an instruction ask; it stays in front of a person until they
 * decide it or save their own rules, exactly as `SessionStore.instructionAsksWaiting`'s own
 * docblock says.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('a torn instruction row does not stop the ledger · §1-§2 the cross-session read', () => {
  let userData: string
  let raw: AppDatabase
  let store: SessionStore
  let clock: number
  const ordinals = new Map<string, number>()
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-torn-instruction-'))
    raw = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(raw, migrationsFolder)
    clock = 8_000_000
    ordinals.clear()
    store = createSessionStore(raw, tick)
  })

  afterEach(() => {
    raw.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const conversation = (id: string, profileId: string): string => {
    store.create({ id, provider: 'codex', cwd: userData, approvalMode: 'ask', profileId })
    return id
  }

  /** Appends one event and returns the exact tick it was recorded at. */
  const append = (id: string, event: TranscriptEvent): number => {
    const next = ordinals.get(id) ?? 0
    ordinals.set(id, next + 1)
    const at = tick()
    store.append(id, next, event, at)
    return at
  }

  it('🔴 a torn instruction_proposed row elsewhere does not take down instructionAsksWaiting — the readable ask still surfaces', () => {
    conversation('sess_asker', 'asker')
    conversation('sess_elsewhere', 'worker')

    const askedAt = append('sess_asker', {
      type: 'instruction_proposed',
      askId: 'iprop_1',
      ask: 'propose',
      about: 'worker',
      proposedBy: 'asker',
      text: 'Never force-push.',
      why: 'it keeps coming up',
    } as TranscriptEvent)

    // ⚑ **The paired positive**: a real, well-formed ask is read back correctly, before anything
    // is torn — so the negative case below is proven against a working read and not an empty one.
    const before = store.instructionAsksWaiting()
    expect(before).toHaveLength(1)
    expect(before[0]?.asked.askId).toBe('iprop_1')
    expect(before[0]?.asked.about).toBe('worker')
    expect(before[0]?.asked.text).toBe('Never force-push.')
    expect(before[0]?.conversation).toBe('sess_asker')
    expect(before[0]?.at).toBe(askedAt)

    // ⛔ **A torn row, planted directly** — in a DIFFERENT conversation's ledger, at an ordinal the
    // asker's own append never touched, so it cannot collide with the row above.
    raw
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'instruction_proposed', ?, ?)`,
      )
      .run('evt_torn_instr', 'sess_elsewhere', 900, '{not json', tick())

    expect(() => store.instructionAsksWaiting()).not.toThrow()
    // 🔴 **The torn row contributed nothing** — still exactly the one real ask, unchanged.
    const after = store.instructionAsksWaiting()
    expect(after).toHaveLength(1)
    expect(after[0]?.asked.askId).toBe('iprop_1')
    expect(after[0]?.asked.about).toBe('worker')
    expect(after[0]?.asked.text).toBe('Never force-push.')
    expect(after[0]?.conversation).toBe('sess_asker')
    expect(after[0]?.at).toBe(askedAt)
  })

  it('⚠️ a JSON-valid instruction row missing its askId is skipped like a torn one, and does not crash', () => {
    conversation('sess_asker', 'asker')
    conversation('sess_elsewhere', 'worker')

    append('sess_asker', {
      type: 'instruction_proposed',
      askId: 'iprop_1',
      ask: 'propose',
      about: 'worker',
      proposedBy: 'asker',
      text: 'Never force-push.',
      why: 'it keeps coming up',
    } as TranscriptEvent)

    // ⚠️ **Valid JSON, but no `askId`** — the row parses; it is the shape guard, not `json_valid`,
    // that has to catch this one.
    raw
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, 'instruction_proposed', ?, ?)`,
      )
      .run(
        'evt_no_askid',
        'sess_elsewhere',
        901,
        JSON.stringify({
          type: 'instruction_proposed',
          ask: 'propose',
          about: 'worker',
          proposedBy: 'asker',
          text: 'y',
          why: 'z',
        }),
        tick(),
      )

    expect(() => store.instructionAsksWaiting()).not.toThrow()
    // ⚑ **The paired positive, read after the plant**: the one surviving, correctly-identified ask
    // proves the malformed row was dropped rather than merged into or replacing it — not even a
    // second entry keyed by `undefined`.
    const waiting = store.instructionAsksWaiting()
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.asked.askId).toBe('iprop_1')
    expect(waiting[0]?.asked.about).toBe('worker')
    expect(waiting[0]?.conversation).toBe('sess_asker')
  })
})

describe('a torn instruction row does not stop the ledger · §3 nothing withdraws an ask automatically', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let hostA: RuntimeHost

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

  /** Everything a host needs — `two-hosts-import.test.ts`'s minimal shape, no `readInstructions`. */
  const deps = (): ConstructorParameters<typeof RuntimeHost>[0] => ({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(dir, 'exports'),
    createRuntime: (provider: Provider) => new FakeRuntime(provider),
    prepareProviderHome: (provider: Provider, profileId?: string) => {
      const home = join(dir, 'provider-homes', profileId ?? 'default', provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider: Provider) => join(dir, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(dir, sessionId, requested),
    newSessionId: () => `sess_${Math.floor(Math.random() * 1_000_000)}`,
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: 'X',
      model: 'm',
      authNote: null,
      files: [],
    }),
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-torn-instruction-relaunch-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    hostA = new RuntimeHost(deps())
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const window = new RecordingSink('webContents:1')

  const personOpens = async (profileId: string, host: RuntimeHost): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: dir, approvalMode: 'auto' },
      window,
    )
    return sessionId
  }

  /** ⚑ An identity exists once a conversation has run as it — `582`'s own criterion. */
  const bringIdentityIntoBeing = async (profileId: string, host: RuntimeHost): Promise<void> => {
    const id = await personOpens(profileId, host)
    await host.close(id, window)
  }

  it('🚩 an ask whose conversation is gone is never withdrawn by the next launch (F021, D-017) — nothing settles it automatically', async () => {
    await bringIdentityIntoBeing('worker', hostA)
    await bringIdentityIntoBeing('asker', hostA)
    expect(store.setCapabilities('asker', { canWriteRules: 'propose' })).toBe(true)

    const asking = await personOpens('asker', hostA)
    const asked = hostA.proposeAgentRules(
      asking,
      { about: 'worker', text: 'x', why: 'y', relaying: false },
      window,
    )
    expect(asked.ok && asked.wrote).toBe('a-request')
    const askId = asked.ok && asked.wrote === 'a-request' ? asked.askId : ''

    // ⚑ **The positive control**: the ask really is recorded as waiting, before the conversation
    // that made it ends.
    expect(hostA.agentInstructions('worker').waiting).toHaveLength(1)
    expect(hostA.agentInstructions('worker').waiting[0]?.asked.askId).toBe(askId)

    // ⛔ **The asking conversation stops.** Its ledger is untouched — closing writes no ending for
    // the ask — so the row a person is asked about now names a conversation nothing is running.
    await hostA.close(asking, window)

    // 🚩 **"The next launch"**: a second `RuntimeHost` over the SAME store/db. `RuntimeHost`'s own
    // constructor is where every stranded-work sweep runs, and none of them is about an
    // instruction ask.
    const hostB = new RuntimeHost(deps())

    const now = hostB.agentInstructions('worker')
    expect(now.waiting).toHaveLength(1)
    expect(now.waiting[0]?.asked.askId).toBe(askId)
    expect(now.waiting[0]?.asked.about).toBe('worker')
    // ⚑ **And nothing was auto-approved either.**
    expect(store.ownInstructionsOf('worker').versions).toEqual([])

    await hostB.closeAll()
  })
})
