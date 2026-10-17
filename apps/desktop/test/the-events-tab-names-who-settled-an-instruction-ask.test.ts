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
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { type RuntimeEventMessage, type TranscriptEvent } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * ⛔ **`477` M22 · the Events tab line for an instruction ask that ended says WHO ended it.**
 *
 * ⚑ `D-016` took proposals out and, with them, the only `describeEvent` assertion on the line a
 * settled ask draws; what is left of that rule lives in the `instruction_settled` case (582's ask
 * for a rule about an identity). ⚠️ The ledger still records the actor (`ending` does not name its
 * own author — a person at the card, and this app when the identity went while the ask waited,
 * both write `refused`), so the line that draws it must print the actor rather than leave the
 * ending word to imply one.
 *
 * ⚠️ **Driven through the real host over a real SQLite ledger**, and the line is read off the row
 * the ledger actually holds — a hand-built event would measure the renderer's line against a shape
 * the writer might not produce.
 */
class PersonsWindow implements RuntimeEventSink {
  /** ⛔ **A PERSON**: `decideInstruction` stands behind `requireAPerson`. */
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('477 M22 · the Events tab names who settled an instruction ask', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-477m22-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-477m22-work-'))
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
      readInstructions: () => ({
        instructions: {
          injected: [],
          agentMemory: [],
          provider: [],
          refused: [],
          note: '',
          recallsReported: false,
          writesReported: true,
          composed: null,
        },
        systemHint: undefined,
        memoryLoaded: null,
      }),
    })
    window = new PersonsWindow('webContents:1')
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

  /** ⚑ An identity exists once a conversation has run as it. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  /**
   * ⚑ An agent granted the narrow arm of the ladder proposes a rule about `worker`.
   *
   * ⚠️ **`worker` has run** unless `neverRun` — an identity that has ever run is one
   * `removeAgent` refuses, and the app-settled arm below needs the one it does not.
   */
  const anAskIsWaiting = async (neverRun = false): Promise<{ asking: string; askId: string }> => {
    if (neverRun) host.createAgent({ slug: 'worker', displayName: null, provider: null })
    else await bringIdentityIntoBeing('worker')
    await bringIdentityIntoBeing('asker')
    expect(store.setCapabilities('asker', { canWriteRules: 'propose' })).toBe(true)
    const asking = await personOpens('asker')
    const asked = host.proposeAgentRules(
      asking,
      { about: 'worker', text: 'Never force-push.', why: 'it keeps coming up', relaying: false },
      window,
    )
    if (!asked.ok || asked.wrote !== 'a-request') throw new Error('the ask was not written')
    // ⚑ **The premise**: the ask really is open, so what follows settles something.
    expect(host.agentInstructions('worker').waiting).toHaveLength(1)
    return { asking, askId: asked.askId }
  }

  const settledRowsOf = (
    sessionId: string,
  ): Extract<TranscriptEvent, { type: 'instruction_settled' }>[] =>
    store
      .events(sessionId)
      .map(({ event }) => event)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'instruction_settled' }> =>
          event.type === 'instruction_settled',
      )

  it('🔴 a person approving it is drawn as a person, off the row the ledger holds', async () => {
    const { asking, askId } = await anAskIsWaiting()
    expect(host.decideInstruction(askId, true, window)).toEqual({ outcome: 'taken' })
    const [row, ...others] = settledRowsOf(asking)
    expect(others).toEqual([])
    // ⚑ **The ledger records it** — the half that was never in doubt.
    expect(row).toMatchObject({ askId, ending: 'approved', by: { who: 'a-person' } })
    // ⛔ **And the tab that draws the ledger says it.** ⚠️ Without the actor the line is
    // `<ask> · approved (ours)`, and `approved` is a word four upstream actors can reach.
    const line = describeEvent(row!)
    expect(line).toBe(`${askId} · approved · a person (ours)`)
    await host.close(asking, window)
  })

  it('⛔ the app settling it when the identity went is drawn as the app, NOT as a person — same ending word, other actor', async () => {
    const { asking, askId } = await anAskIsWaiting(true)
    // ⚑ **The identity goes while the ask waits** — the one path on which this app, not a person,
    // ends a card a person pressed: the approval cannot be written, so the ask is taken down.
    expect(host.removeAgent('worker')).toEqual({ ok: true, slug: 'worker' })
    expect(host.decideInstruction(askId, true, window)).toMatchObject({ outcome: 'refused' })
    const [row, ...others] = settledRowsOf(asking)
    expect(others).toEqual([])
    expect(row).toMatchObject({ askId, ending: 'refused', by: { who: 'the-app-itself' } })
    const line = describeEvent(row!)
    expect(line).toBe(`${askId} · refused · this app itself (ours)`)
    // ⛔ **The pair's negative half**: the other actor's word is not on this line.
    expect(line).not.toContain('a person')
    await host.close(asking, window)
  })

  it('⚠️ a row written before this app recorded who says nothing records it, and is not given an author', () => {
    // ⛔ **`by` is optional on purpose** — absence means *written before this app recorded who*, and
    // the line must say so rather than fall back on a word for somebody.
    const old: Extract<TranscriptEvent, { type: 'instruction_settled' }> = {
      type: 'instruction_settled',
      askId: 'iprop_old',
      ending: 'approved',
    }
    expect(describeEvent(old)).toBe('iprop_old · approved · nobody this ledger records (ours)')
  })
})
