import { agentCallerId } from '../src/main/runtime/agent-tools'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type Caller,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { type RuntimeEventMessage, type TranscriptEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **477 M9 · a person decides an agent's ask, and the ledger says a person did.**
 *
 * `ProposalCard.vue` drew *"You approved this"* with nothing in the ledger behind the *"you"*, and
 * `477` put the actor there: the version an approval writes and the row that ends the ask both
 * carry who decided. `D-016a` (`bd70d693`) renamed the door to `decideInstruction` and its
 * neighbours only ever mapped a version to its text, so no test read the actor back.
 *
 * ⚑ **The instrument is the production door** — a real `RuntimeHost` over a real SQLite ledger, an
 * agent that proposes through `proposeAgentRules`, and the same `decideInstruction` a window's
 * press reaches.
 *
 * A person can decide; other callers are refused without attributing a decision to them.
 */

class PersonsWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('477 M9 · who decided an agent’s ask', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let counter: number
  let clock: number
  let window: PersonsWindow
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-477m9-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-477m9-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2031, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
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
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new PersonsWindow('webContents:477m9')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'auto' },
      window,
    )
    return sessionId
  }

  /** ⚑ An agent granted the narrow arm, has proposed rules for `worker`; the ask is waiting. */
  const anAskIsWaiting = async (): Promise<{ asking: string; askId: string }> => {
    const worker = await personOpens('worker')
    await host.close(worker, window)
    const asker = await personOpens('asker')
    await host.close(asker, window)
    expect(store.setCapabilities('asker', { canWriteRules: 'propose' })).toBe(true)
    const asking = await personOpens('asker')
    const asked = host.proposeAgentRules(
      asking,
      {
        about: 'worker',
        text: 'Never force-push.',
        why: 'it keeps coming up',
        relaying: false,
        expectedVersion: 0,
      },
      { ownerId: agentCallerId(asking) },
    )
    expect(asked.ok && asked.wrote).toBe('a-request')
    const askId = asked.ok && asked.wrote === 'a-request' ? asked.askId : ''
    // ⚑ **The premise, asserted**: the ask is waiting and nothing is written, so what follows is
    // about the press and not about a state the fixture left behind.
    expect(host.agentInstructions('worker').waiting).toHaveLength(1)
    expect(store.ownInstructionsOf('worker').versions).toEqual([])
    return { asking, askId }
  }

  const settledRowsOf = (
    conversation: string,
  ): Extract<TranscriptEvent, { type: 'instruction_settled' }>[] =>
    store
      .events(conversation)
      .map(({ event }) => event)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'instruction_settled' }> =>
          event.type === 'instruction_settled',
      )

  const decided = (approve: boolean, by: Caller, askId: string): void => {
    expect(host.decideInstruction(askId, approve, by)).toEqual({ outcome: 'taken' })
  }

  it('🔴 approving as a person records a person on the version AND on the row that ends the ask', async () => {
    const { asking, askId } = await anAskIsWaiting()
    decided(true, window, askId)
    const versions = store.ownInstructionsOf('worker').versions
    expect(versions.map((one) => [one.text, one.whoWroteIt, one.conversation])).toEqual([
      ['Never force-push.', 'an-agents-proposal', asking],
    ])
    // ⛔ **The version names the PERSON who approved, and not the agent that proposed it.**
    expect(versions.map((one) => one.by)).toEqual([{ who: 'a-person' }])
    expect(settledRowsOf(asking).map((one) => [one.askId, one.ending, one.by])).toEqual([
      [askId, 'approved', { who: 'a-person' }],
    ])
  })

  it('refuses approval by the app itself and keeps the request waiting', async () => {
    const { asking, askId } = await anAskIsWaiting()
    expect(host.decideInstruction(askId, true, THE_APP_ITSELF)).toMatchObject({
      outcome: 'refused',
    })
    expect(store.ownInstructionsOf('worker').versions).toEqual([])
    expect(settledRowsOf(asking)).toEqual([])
    expect(store.instructionAsksWaiting()).toHaveLength(1)
  })

  it('🔴 refusing as a person records a person on the ending, and writes no version', async () => {
    const { asking, askId } = await anAskIsWaiting()
    decided(false, window, askId)
    expect(store.ownInstructionsOf('worker').versions).toEqual([])
    expect(settledRowsOf(asking).map((one) => [one.askId, one.ending, one.by])).toEqual([
      [askId, 'refused', { who: 'a-person' }],
    ])
  })

  it('refuses a non-person decision without settling the request', async () => {
    const { asking, askId } = await anAskIsWaiting()
    expect(host.decideInstruction(askId, false, THE_APP_ITSELF)).toMatchObject({
      outcome: 'refused',
    })
    expect(store.ownInstructionsOf('worker').versions).toEqual([])
    expect(settledRowsOf(asking)).toEqual([])
  })

  it('🔴 a person’s decision on an ask whose conversation nobody has open is recorded as theirs too', async () => {
    const { asking, askId } = await anAskIsWaiting()
    // ⚑ **The store's own path, which `endInstructionAsk` takes when no window is reading the
    // conversation** — the same actor, written by the other of the two writers.
    await host.close(asking, window)
    decided(true, window, askId)
    expect(store.ownInstructionsOf('worker').versions.map((one) => one.by)).toEqual([
      { who: 'a-person' },
    ])
    expect(settledRowsOf(asking).map((one) => [one.ending, one.by])).toEqual([
      ['approved', { who: 'a-person' }],
    ])
  })
})
