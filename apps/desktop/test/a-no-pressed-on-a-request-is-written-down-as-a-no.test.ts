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
import { type RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **`441` M20 · a person presses No and the ledger says Yes.**
 *
 * ## ⛔ The rule, and why the existing test could not hold it
 *
 * ⚑ An agent that may only PROPOSE a rule leaves a card in front of a person. Pressing *No* must
 * write down that the person REFUSED it. ⚠️ `the-layer-a-person-writes.test.ts` §4 already presses
 * No, and checks the OUTCOME — no version written, nothing waiting — and every one of those holds
 * when the ask is ended as *approved*, because nothing ever asks the ledger which word it holds.
 * ⛔ The row is the durable answer: the asker's transcript, the identity's history and the launch
 * sweep all read the ending, so a No stored as a Yes is a decision the record reverses.
 *
 * ## ⚑ How this file measures it
 *
 * ⚠️ **A real `RuntimeHost` over a real SQLite ledger, with the fake provider.** Two asks are made
 * about two different identities, one is refused and one is approved, and the `instruction_settled`
 * ROW each one wrote is read back off the `events` table. 🔴 **Every negative is paired with its
 * positive in the same test**, and the two are read on BOTH writers of that row — the live asker's
 * sink and the store's own append for an asker nobody has open.
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

describe('441 M20 · a No is written down as a No', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: PersonsWindow
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-no-is-no-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-no-is-no-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2031, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
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

  /** ⚑ Two identities to ask about, and one that may propose about them. */
  const anAskerAndTwoSubjects = async (): Promise<string> => {
    await bringIdentityIntoBeing('worker-a')
    await bringIdentityIntoBeing('worker-b')
    await bringIdentityIntoBeing('asker')
    expect(store.setCapabilities('asker', { canWriteRules: 'propose' })).toBe(true)
    return personOpens('asker')
  }

  const asks = (asking: string, about: string): string => {
    const asked = host.proposeAgentRules(
      asking,
      { about, text: `A rule for ${about}.`, why: 'it keeps coming up', relaying: false },
      window,
    )
    expect(asked.ok && asked.wrote).toBe('a-request')
    return asked.ok && asked.wrote === 'a-request' ? asked.askId : ''
  }

  /** ⚑ **What the ledger recorded as each ask's ending** — the rows, not the outcome. */
  const endingsOnTheLedger = (): Record<string, string[]> => {
    const rows = db
      .prepare(`SELECT payload FROM events WHERE type = 'instruction_settled' ORDER BY id`)
      .all() as { payload: string }[]
    const by: Record<string, string[]> = {}
    for (const row of rows) {
      const settled = JSON.parse(row.payload) as { askId: string; ending: string }
      ;(by[settled.askId] ??= []).push(settled.ending)
    }
    return by
  }

  it('🔴 a No is written as `refused` and a Yes as `approved`, while the asker is open', async () => {
    const asking = await anAskerAndTwoSubjects()
    const refusedAsk = asks(asking, 'worker-a')
    const approvedAsk = asks(asking, 'worker-b')
    // ⚑ **The premise, asserted** — nothing has been ended yet, so the rows below are ones the two
    // presses wrote and not ones that were already there.
    expect(endingsOnTheLedger()).toEqual({})

    expect(host.decideInstruction(refusedAsk, false, window)).toEqual({ outcome: 'taken' })
    expect(host.decideInstruction(approvedAsk, true, window)).toEqual({ outcome: 'taken' })

    // ⛔ **One row each, and each carries the WORD the person pressed.** ⚠️ The plant writes
    // `approved` for both, which every outcome-level check above this file cannot tell apart.
    expect(endingsOnTheLedger()).toEqual({
      [refusedAsk]: ['refused'],
      [approvedAsk]: ['approved'],
    })
    // ⚑ **And the outcomes agree with the rows** — the refusal wrote no version, the approval wrote
    // one — so the record and the effect tell the same story.
    expect(store.ownInstructionsOf('worker-a').versions).toEqual([])
    expect(store.ownInstructionsOf('worker-b').versions.map((one) => one.text)).toEqual([
      'A rule for worker-b.',
    ])
    await host.close(asking, window)
  })

  it('🔴 the same holds when nobody has the asking conversation open', async () => {
    const asking = await anAskerAndTwoSubjects()
    const refusedAsk = asks(asking, 'worker-a')
    const approvedAsk = asks(asking, 'worker-b')
    // ⛔ **The asker is closed, so the ending is written by the store's own append** — the second
    // writer of the same row, which a live-only measurement would leave unread.
    await host.close(asking, window)
    expect(host.agentInstructions('worker-a').waiting).toHaveLength(1)

    expect(host.decideInstruction(refusedAsk, false, window)).toEqual({ outcome: 'taken' })
    expect(host.decideInstruction(approvedAsk, true, window)).toEqual({ outcome: 'taken' })

    expect(endingsOnTheLedger()).toEqual({
      [refusedAsk]: ['refused'],
      [approvedAsk]: ['approved'],
    })
    expect(store.ownInstructionsOf('worker-a').versions).toEqual([])
    expect(store.ownInstructionsOf('worker-b').versions).toHaveLength(1)
  })
})
