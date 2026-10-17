import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentInfo, type SessionHandle } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type {
  CreateSessionInput,
  ResumedSession,
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 179 · **The model you cannot see.**
 *
 * Reported from the running app: a live Claude conversation, answering normally, whose header read
 * `provider: claude · model: … · reasoning: …` while its own row held
 * `model: claude-haiku-4-5-20251001`.
 *
 * ⛔ **The `…` is `describeAgent` reporting only what the PROVIDER has said**, and on Claude the
 * provider says nothing until a turn's `system/init` — which the CLI emits when the first prompt is
 * sent, not when the session opens. So a REOPENED conversation could not name its model until
 * somebody typed into it, while the app held that id on the row it had just replayed into the
 * provider. Measured three ways: `pnpm run probe:resume-agent-info` (the handle is `undefined`
 * between a resume and its first turn, and names the model after it), `BROBOT_SMOKE_PROVIDER=claude
 * pnpm run smoke:resume` (the string above, in the real app), and the same smoke on Codex, which is
 * GREEN because its handshake reports the model at resume.
 *
 * ⚠️ **`FakeRuntime` has no `agentInfo` at all** — deliberately, since the double stands in for a
 * provider that has not spoken — which is exactly the state this dispatch is about, and is why the
 * whole desktop suite could be green through it. {@link Reporting} is the other end.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  alive = true

  constructor(readonly ownerId = 'owner:1') {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }

  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

/**
 * A runtime whose handles report what a provider has SAID — the half `FakeRuntime` has none of.
 *
 * Wired the same way `sign-in-supersede.test.ts` wires its credential watch: a defined property on
 * the handle it hands out, so the host reads it through exactly the accessor the real adapters
 * expose. `null` means "this provider has not spoken", which is a Claude session before its first
 * turn — and the default here, so a test has to ASK for a report.
 */
class Reporting extends FakeRuntime {
  info: AgentInfo | null = null

  private wire<T extends SessionHandle>(handle: T): T {
    Object.defineProperty(handle, 'agentInfo', {
      get: () => this.info ?? undefined,
      configurable: true,
    })
    return handle
  }

  override async start(
    ...args: Parameters<FakeRuntime['start']>
  ): ReturnType<FakeRuntime['start']> {
    return this.wire(await super.start(...args))
  }

  override async resume(
    ...args: Parameters<FakeRuntime['resume']>
  ): ReturnType<FakeRuntime['resume']> {
    return this.wire(await super.resume(...args))
  }
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/** The `model` / `reasoning` rows, as the header and the drawer read them off one liveness. */
function rows(handed: { liveness: SessionLiveness }): Record<string, string> {
  return Object.fromEntries((handed.liveness.agent ?? []).map((row) => [row.label, row.value]))
}

describe('179 — what a conversation can say about the model it is running', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let sink: RecordingSink
  let runtime: Reporting

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-agent-rows-'))
    runtime = new Reporting('claude')
    let counter = 0
    // A real ledger: `attachHeldSession` refuses to hand back a session whose row it cannot find,
    // so the null store would make every re-attach here vacuous (149's own note).
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const start = (over: Partial<CreateSessionInput> = {}) =>
    host.createSession({ provider: 'claude', ...over }, sink)

  /** What a surface that has lost its list is handed back (100) — the re-attach, by its own name. */
  function handedBack(sessionId: string, into: RecordingSink): ResumedSession {
    const handed = host.attachOpenSessions(into).find((one) => one.sessionId === sessionId)
    if (!handed) throw new Error(`the host handed nothing back for ${sessionId}`)
    return handed
  }

  it('names the model and effort this launch ASKED for, before the provider has said anything', async () => {
    const created = await start({ model: 'claude-haiku-4-5-20251001', reasoningEffort: 'high' })

    // ⛔ The defect, at the moment it existed: nothing has been reported, and the app is holding
    // both facts one field away — `settings` on this very object.
    expect(rows(created)).toEqual({
      model: 'claude-haiku-4-5-20251001 (requested)',
      reasoning: 'high (requested)',
    })
    // …the same object's other half, which is where the values come from. Asserted so a future
    // change that filled the rows from somewhere else would have to say so here.
    expect(created.settings.model).toBe('claude-haiku-4-5-20251001')
  })

  it('shows the ellipsis when NOBODY asked and nobody has said — the honest empty', async () => {
    // ⚑ **D-042 moved the "nobody asked" half** (R1: every launch names its model and effort). A
    // launch that names nothing is named by the host — here Claude's own default BY NAME, `default`
    // at `high` — and that is a REQUEST, marked as one, exactly as a person's would be. ⛔ So this
    // launch no longer reads `…` on either row: it reads what it asked for.
    const unnamed = await start()
    expect(rows(unnamed)).toEqual({ model: 'default (requested)', reasoning: 'medium (requested)' })
    expect(unnamed.settings).toMatchObject({ model: 'default', reasoningEffort: 'medium' })

    // ⚑ **The honest empty survives where nothing CAN be asked**: a model whose provider row offers
    // no effort levels runs at none (R1's `null` effort), so its reasoning row still reads `…` —
    // not reported, and nothing asked for. ⚠️ The model row cannot be `…` from a launch any more.
    const levelless = await start({ model: 'fake-claude-b' })
    expect(levelless.settings.reasoningEffort, 'nothing was asked: the row offers none').toBeNull()
    expect(rows(levelless)).toEqual({ model: 'fake-claude-b (requested)', reasoning: '…' })
  })

  it('a provider REPORT replaces the request, and is not marked', async () => {
    const created = await start({ model: 'gpt-5.6-sol' })
    expect(rows(created).model).toBe('gpt-5.6-sol (requested)') // non-vacuity: it was the request

    // 177's reroute, in the one shape that makes it legible: the provider answered on a different
    // model from the one asked for, and the row now states the ANSWER rather than our request.
    runtime.info = { model: 'gpt-5.4' }
    const handed = handedBack(created.sessionId, sink)

    expect(rows(handed).model).toBe('gpt-5.4')
    expect(handed.settings.model).toBe('gpt-5.6-sol') // …and the request is still readable beside it
  })

  it('a re-attached conversation names them too — the reload path (100)', async () => {
    const created = await start({ model: 'claude-haiku-4-5-20251001', reasoningEffort: 'medium' })
    sink.alive = false // the window went away, exactly as a reload leaves it

    const second = new RecordingSink() // …and the same surface came back
    const handed = handedBack(created.sessionId, second)

    expect(handed.handover).toBe('attached')
    expect(rows(handed)).toEqual({
      model: 'claude-haiku-4-5-20251001 (requested)',
      reasoning: 'medium (requested)',
    })
  })

  it('a re-attached PLANNING conversation still says it is planning, and what it runs', async () => {
    // §1's second question, and it is not cosmetic: `planMode` and `planEndedAt` are in the same set
    // the report worried about, and the plan bar is what a person acts on.
    const created = await start({ model: 'claude-haiku-4-5-20251001', planMode: true })
    expect(created.planNeedsGoAhead).toBe(true) // non-vacuity: it really is planning

    const handed = handedBack(created.sessionId, new RecordingSink())

    expect(handed.planNeedsGoAhead).toBe(true)
    expect(handed.settings.planMode).toBe(true)
    expect(rows(handed).model).toBe('claude-haiku-4-5-20251001 (requested)')
  })

  it('a conversation that was ENDED and reopened is not still ended', async () => {
    // A terminal recorded for one life must not keep a reopened conversation listed as
    // finished while it answers. The host’s current state must supersede the stale column.
    const created = await start({ model: 'claude-haiku-4-5-20251001' })
    await host.close(created.sessionId, sink)
    const closed = host.resumableSessions().find((row) => row.sessionId === created.sessionId)
    expect(closed?.status).toBe('ended') // non-vacuity: it really did record its ending

    const reopened = await host.resumeSession(created.sessionId, sink)
    expect(reopened.handover).toBe('resumed')

    const live = host.resumableSessions().find((row) => row.sessionId === created.sessionId)
    expect(live?.status).not.toBe('ended')
    // …and it still names its model, on the path the report came through.
    expect(rows(reopened).model).toBe('claude-haiku-4-5-20251001 (requested)')
  })
})
