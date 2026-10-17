import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **383 · one number a person can quote.**
 *
 * ⚑ **D-016 · a piece of work reads by its label** — `W1.2` is the root numbered 1, then 2 under
 * it. The numbers under one parent come from `work_sequence(parent)` and are taken before the send
 * (R4), so a number once handed out names one piece and is never handed out again.
 *
 *  - **§1** a number taken and never used is BURNED, not reissued — the property only a COUNTER
 *    has, because a maximum over what survived cannot see a number that left no row.
 *  - **§2** the pieces a conversation owns are still a function of its ledger: its rows alone
 *    reproduce them, in a database whose `work` table is empty, and with the index that serves the
 *    read dropped.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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

/** `375`'s harness: the toolset handed to each launch, kept so a child's tools can be called. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('383 · one number a person can quote', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-one-number-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-one-number-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 8_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      {
        provider: 'claude',
        profileId,
        approvalMode: 'ask',
        cwd: root,
      },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  /** A PM in a window, and a `worker` it can give work to. */
  const aPm = async (): Promise<{ pm: string; pmTools: AgentToolset }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    return { pm, pmTools: theToolsetJustHandedOut() }
  }

  /**
   * 🔴 **Work given through the one verb an agent has for it**, and the piece it numbered.
   *
   * ⛔ **Nothing here plants a `work_given` row.** The number under test is the one `giveWork`
   * took, which is the only thing that makes this a measurement of the product rather than of a
   * fixture.
   */
  const giveWork = async (
    pmTools: AgentToolset,
    title: string,
  ): Promise<{ piece: string; label: string; worker: string }> => {
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title,
      brief: title,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      piece: given.piece as string,
      label: given.label as string,
      worker: given.agent as string,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · a number is handed out once
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a bare number names ONE piece under its parent', () => {
    it('⚠️ a number taken under a piece and never used is BURNED, not reissued', async () => {
      // ⚑ *"Gaps are never renumbered"*, in the direction the counter makes reachable: the
      // numbering is a transaction of its own, so a number is gone the moment it is handed over —
      // which is what a give refused or failed after its number was taken leaves behind (R4).
      const { pm, pmTools } = await aPm()
      const pmRoot = store.rootOf(pm)
      if (pmRoot === null) throw new Error('the PM holds no root')
      expect(store.numberUnder(pmRoot.piece)).toBe(1)
      const given = await giveWork(pmTools, 'work')
      expect(given.label).toBe(`${pmRoot.label}.2`)
      expect(store.piecesOwnedBy(given.worker).map((piece) => piece.label)).toEqual([
        `${pmRoot.label}.2`,
      ])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the pieces are still a function of the ledger
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the pieces are still a function of the ledger, with the `work` table beside them', () => {
    it('🔴 the LEDGER ROWS ALONE reproduce every piece, in a database whose `work` table is empty', async () => {
      // ⛔ **The demonstration that diverges.** The owner's ledger is copied into a fresh database
      // and the same rows are derived, while the table that could have been where a piece was
      // really kept is asserted empty in the copy.
      const { pmTools } = await aPm()
      const { worker } = await giveWork(pmTools, 'the work')
      const expected = store.piecesOwnedBy(worker)
      expect(expected).toHaveLength(1)

      const fresh = openDatabase(join(userData, 'ledger-only.sqlite'))
      try {
        applyMigrations(fresh, migrationsFolder)
        fresh
          .prepare(
            `INSERT INTO provider_session (id, provider, cwd, status, created_at, updated_at)
             VALUES (?, 'claude', '/tmp/anywhere', 'idle', 1, 1)`,
          )
          .run(worker)
        const insert = fresh.prepare(
          `INSERT INTO events (id, session_id, ordinal, type, payload, created_at, generation)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        const rows = db
          .prepare(
            'SELECT id, ordinal, type, payload, created_at, generation FROM events WHERE session_id = ? ORDER BY ordinal',
          )
          .all(worker) as {
          id: string
          ordinal: number
          type: string
          payload: string
          created_at: number
          generation: number
        }[]
        for (const row of rows) {
          insert.run(
            row.id,
            worker,
            row.ordinal,
            row.type,
            row.payload,
            row.created_at,
            row.generation,
          )
        }

        // ⚑ **The control that the copy is not vacuous**: the piece tables hold nothing, so a
        // reader that consulted one would have nothing to consult — while the original holds the
        // row the give wrote.
        for (const table of ['work', 'work_sequence', 'work_resource']) {
          expect(
            fresh.prepare(`SELECT count(*) AS n FROM ${table}`).get(),
            `${table} was copied, so this proves nothing`,
          ).toEqual({ n: 0 })
        }
        expect(
          db.prepare('SELECT count(*) AS n FROM work WHERE owner_session_id = ?').get(worker),
        ).toEqual({ n: 1 })

        const rebuilt = createSessionStore(fresh, tick)
        expect(rebuilt.piecesOwnedBy(worker)).toEqual(expected)
      } finally {
        fresh.close()
      }
    })

    it('⛔ …and dropping `events_work_idx` changes nothing', async () => {
      const { pmTools } = await aPm()
      const { worker } = await giveWork(pmTools, 'the work')
      const expected = store.piecesOwnedBy(worker)
      expect(expected).toHaveLength(1)

      db.prepare('DROP INDEX events_work_idx').run()
      const withoutIt = createSessionStore(db, tick)
      expect(withoutIt.piecesOwnedBy(worker)).toEqual(expected)
    })
  })
})
