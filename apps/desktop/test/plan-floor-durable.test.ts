import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { ClaudeRuntime, type AgentRuntime } from '@brobot2/runtime'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **150 §0 · the DURABLE half of a plan mode the provider moved.**
 *
 * The adapter half — an approved `ExitPlanMode` settling plan mode (and, until `728`, the floor) — is asserted in
 * `packages/runtime/test/claude-runtime.test.ts`, against the guard that actually refuses. This is
 * the other half, and it needs two things that suite does not have: a real `RuntimeHost` and a real
 * database. `resumeSession` reads `plan_mode` and `plan_ended_at` as a PAIR (060), so a release the
 * ledger never heard about would bring the conversation back PLANNING after a relaunch — the field
 * defect again, one restart later, with the floor up and no gesture left to lift it.
 *
 * ⚠️ **The REAL Claude adapter with a scripted `Query`, not `FakeRuntime`.** The whole question is
 * whether the host observes what the adapter did to plan mode across an `await` — a double would
 * have to reproduce the seam to be wrong in the same way, which is 122's reason for the same choice.
 *
 * ⛔ **And a real temp-file store, not `NULL_SESSION_STORE`.** 149 lost half a dispatch to that: its
 * `find` returns null, so a persistence assertion written against it passes over a write that never
 * happened.
 */

class FakeQuery {
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private readonly buffer: SDKMessage[] = []
  private done = false
  /** Every mode the adapter asked the SDK for — so "we told the provider" is checkable. */
  readonly modes: string[] = []

  emit(message: SDKMessage): void {
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: message, done: false })
      return
    }
    this.buffer.push(message)
  }

  end(): void {
    this.done = true
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: undefined as never, done: true })
    }
  }

  async interrupt(): Promise<void> {}
  async setPermissionMode(mode: string): Promise<void> {
    this.modes.push(mode)
  }
  close(): void {
    this.end()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over({
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.resolve = resolve
        })
      },
    })
  }

  /** ⚑ F080: it reads what the adapter sends, and each `result` names the message it answers. */
  readonly cli = new TheCliAnswersInOrder()
}

const init = (id: string, cwd: string): SDKMessage =>
  ({ type: 'system', subtype: 'init', session_id: id, cwd }) as unknown as SDKMessage

const result = (): SDKMessage =>
  ({ type: 'result', subtype: 'success', is_error: false }) as unknown as SDKMessage

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  readonly alive = true
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

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('the plan phase a provider moved, written down (150 §0)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sink: RecordingSink
  let fq: FakeQuery
  let canUseTool: NonNullable<Options['canUseTool']> | null
  let launched: Options[]
  /** ⚑ 740 · when set, the store's plan writes fail — a database that has just broken. */
  let planWritesFail: boolean

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-plan-durable-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    planWritesFail = false
    const real = createSessionStore(db)
    store = new Proxy(real, {
      get(target, prop, receiver) {
        if (planWritesFail && (prop === 'startPlanMode' || prop === 'endPlanMode')) {
          return () => {
            throw new Error('SQLITE_FULL (740 · a plan write that fails)')
          }
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    fq = new FakeQuery()
    canUseTool = null
    launched = []
    let counter = 0
    const createRuntime = (): AgentRuntime =>
      new ClaudeRuntime(
        (params) => {
          canUseTool = params.options.canUseTool ?? null
          // ⚑ **Every launch's options, kept** (153). The resume half of this file could not be
          // written without them: what a reopened session comes back AS lives in `permissionMode`
          // and in the guard hooks, and both are built once, inside the call this factory answers.
          launched.push(params.options)
          fq.cli.listen(params.prompt)
          return fq as never
        },
        async () => true,
      )
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime,
      prepareProviderHome: (provider) => join(dir, 'provider-homes', provider),
      providerHomePath: (provider) => join(dir, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
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
    fq.end()
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const row = (sessionId: string) =>
    db
      .prepare('SELECT plan_mode, plan_ended_at FROM provider_session WHERE id = ?')
      .get(sessionId) as { plan_mode: number; plan_ended_at: number | null } | undefined

  /** Start a session, open a turn, and hand back its id. */
  async function turnOpen(planMode: boolean): Promise<string> {
    const created = await host.createSession({ provider: 'claude', planMode }, sink)
    await host.send(created.sessionId, 'plan something', sink)
    fq.emit(init('sess_provider', join(dir, 'scratch', created.sessionId)))
    await waitFor(() => sink.events().some((event) => event.type === 'status'), 'the turn to open')
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')
    return created.sessionId
  }

  /** Raise one of the two plan cards and answer it. */
  async function answerPlanCard(
    sessionId: string,
    tool: 'ExitPlanMode' | 'EnterPlanMode',
    response: { kind: 'answer'; answers: Record<string, never> } | { kind: 'reject' },
  ): Promise<void> {
    const before = sink.events().filter((event) => event.type === 'user_input_request').length
    void canUseTool!(tool, tool === 'ExitPlanMode' ? { plan: '# Plan\n' } : {}, {
      toolUseID: `tu_${tool}`,
      signal: new AbortController().signal,
    } as never)
    await waitFor(
      () => sink.events().filter((event) => event.type === 'user_input_request').length > before,
      `the ${tool} card`,
    )
    await host.respondUserInput(sessionId, `tu_${tool}`, response, sink)
  }

  it('an APPROVED plan is written down, so a resume does not come back planning', async () => {
    const id = await turnOpen(true)
    // ⛔ Non-vacuous: it really was recorded as planning first. Without this the assertion below
    // would pass for a session that never planned at all.
    expect(row(id)?.plan_mode).toBe(1)
    expect(row(id)?.plan_ended_at).toBeNull()

    await answerPlanCard(id, 'ExitPlanMode', { kind: 'answer', answers: {} })

    // ⛔ **The pair `resumeSession` reads** (060): planned, and no longer planning. One flag cannot
    // say both, which is why `plan_mode` deliberately stays 1.
    expect(row(id)?.plan_mode).toBe(1)
    expect(row(id)?.plan_ended_at, 'the release reached the ledger').not.toBeNull()

    fq.emit(result())
  })

  it('…and a REJECTED plan writes nothing — the paired negative', async () => {
    const id = await turnOpen(true)
    await answerPlanCard(id, 'ExitPlanMode', { kind: 'reject' })

    expect(row(id)?.plan_mode).toBe(1)
    expect(row(id)?.plan_ended_at, 'refusing to approve is not a release').toBeNull()

    fq.emit(result())
  })

  it('🔴 736 · R98 / 740 · R99 — a model’s EnterPlanMode raises NO card, and the plan it starts is WRITTEN DOWN', async () => {
    // ⚑ R98: the CLI does not ask before the model enters plan mode (measured, `enter-plan-write`),
    // so neither does this app; the adapter settles the plan itself. 🔴 **740 · R99 (`736` F-8)** —
    // *"a plan the model starts is written down as the CLI's session keeps it, so a reopen resumes
    // planning"*. ⛔ **On `main` (`736`)** nothing wrote it: the host recorded a plan only from a
    // person's answer, so the row stayed `plan_mode = 0` and a reopen came back not planning.
    const id = await turnOpen(false)
    expect(row(id)?.plan_mode).toBe(0)

    // ⚑ Raced, so on a tree where this parks on a card (before `736`) the RED is the assertion, not a
    // test that hangs to its timeout (`736`'s review).
    const allowed = await Promise.race([
      canUseTool!('EnterPlanMode', {}, {
        toolUseID: 'tu_enter',
        signal: new AbortController().signal,
      } as never),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 200)),
    ])
    expect(allowed).toEqual({ behavior: 'allow' })
    expect(sink.events().filter((event) => event.type === 'user_input_request')).toEqual([])
    // ⚑ The host learns of it from the next thing the conversation does — here the turn's end.
    fq.emit(result())
    await waitFor(() => sink.events().some((event) => event.type === 'turn'), 'the turn to end')
    expect(row(id)?.plan_mode, 'the plan the model started, written down').toBe(1)
    expect(row(id)?.plan_ended_at, 'and not as released').toBeNull()
    // ⚑ …and every window is told the conversation is planning — the header reads this.
    expect(sink.liveness.at(-1)?.settings?.planMode).toBe(true)
  })

  it('🔴 740 · a plan write that FAILS inside an event’s window is reported after that event, never before it', async () => {
    // ⛔ `740`'s review, reproduced: the recorder reported from inside `deliver`'s window, so the
    // notice took ordinal N+1 while event N was still unsent — `320` §4.1's disorder, reopened.
    const id = await turnOpen(false)
    planWritesFail = true
    const allowed = await Promise.race([
      canUseTool!('EnterPlanMode', {}, {
        toolUseID: 'tu_enter',
        signal: new AbortController().signal,
      } as never),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 200)),
    ])
    expect(allowed).toEqual({ behavior: 'allow' })
    fq.emit(result())
    await waitFor(() => sink.events().some((event) => event.type === 'turn'), 'the turn to end')
    // ⚑ The premise: the failure WAS reported, on the wire.
    expect(sink.events().some((event) => event.type === 'error')).toBe(true)
    const ordinals = sink.messages
      .filter((message) => message.sessionId === id)
      .map((message) => message.ordinal)
    expect(ordinals, 'sent in ordinal order').toEqual([...ordinals].sort((a, b) => a - b))
  })

  it('⚑ 740 · THE CONTROL — a plan a PERSON asked for mid-turn, not yet taken, is not written back out by the turn’s own events', async () => {
    // ⚑ The controls ask for plan mode now; the provider takes it at its next turn, so `requested`
    // moves and `effective` does not. The row was written by the person's own door. ⛔ A compare of
    // `effective` against the ledger in that window would write the request back OUT as a release.
    const id = await turnOpen(false)
    await host.setSessionSetting(id, { kind: 'planMode', on: true }, sink)
    expect(row(id)?.plan_mode, 'the premise: the person’s door wrote it').toBe(1)
    fq.emit({
      type: 'assistant',
      message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'working' }] },
      parent_tool_use_id: null,
      session_id: 'sess_provider',
    } as unknown as SDKMessage)
    fq.emit(result())
    await waitFor(() => sink.events().some((event) => event.type === 'turn'), 'the turn to end')
    expect(row(id)?.plan_mode).toBe(1)
    expect(row(id)?.plan_ended_at, 'nothing wrote it back out').toBeNull()
  })

  it('answering an ORDINARY question writes no plan phase at all', async () => {
    // The gesture that must not be mistaken for a plan one — otherwise every answered card would
    // stamp the row, and `plan_ended_at` would stop meaning what `resumeSession` reads it as.
    const id = await turnOpen(true)
    const before = row(id)?.plan_ended_at ?? null

    void canUseTool!(
      'AskUserQuestion',
      { questions: [{ question: 'which?', options: [{ label: 'a' }, { label: 'b' }] }] },
      { toolUseID: 'tu_ask', signal: new AbortController().signal } as never,
    )
    await waitFor(
      () => sink.events().some((event) => event.type === 'user_input_request'),
      'the question card',
    )
    await host.respondUserInput(id, 'tu_ask', { kind: 'answer', answers: { q0: 'a' } }, sink)

    expect(row(id)?.plan_ended_at).toBe(before)
    expect(row(id)?.plan_mode).toBe(1)

    fq.emit(result())
  })

  /**
   * 🔴 **153 §3 · the READ, which the write-only assertions above could not see** (152 §4.4).
   *
   * ⛔ **`plan-floor-durable.test.ts` asserted that the release reaches the ledger and stopped
   * there.** 113's rule is *"a step that has never executed is not coverage, it is a claim"*, and
   * this is its close cousin: every test above checks what `plan_ended_at` was WRITTEN as, and not
   * one of them reopened the session to see what it was read as. It was read as nothing. Claude's
   * `resume` initialised both its handle and `permissionMode` from `planMode` alone, so an approved
   * plan came back planning — with the floor up and, on this provider, no gesture left to lift it.
   *
   * ⚠️ **And the test that LOOKED like it covered this was passing against a double.**
   * `session-persistence.test.ts`'s 060 case asserts both fields reach the adapter and then checks
   * `planNeedsGoAhead` — against `FakeRuntime`, which reads `planModeEnded` correctly. The seam was
   * right in the fake and wrong in the adapter, which is exactly 122's reason for using the real one
   * here.
   */
  describe('what a REOPENED session comes back as (153 §3)', () => {
    /** Close the live session and reopen it through the real host, as the relaunch does. */
    async function reopen(id: string): Promise<Options> {
      fq.emit(result())
      await host.closeSessionsForOwner(sink.ownerId)
      const before = launched.length
      await host.resumeSession(id, new RecordingSink('owner:2'))
      const options = launched[before]
      if (!options) throw new Error('the reopen built no launch')
      return options
    }

    it('⛔ an APPROVED plan resumes NOT planning — through a real resume', async () => {
      const id = await turnOpen(true)
      // Non-vacuous: it really planned on the first launch.
      expect(row(id)?.plan_mode).toBe(1)
      expect(launched[0]?.permissionMode).toBe('plan')

      await answerPlanCard(id, 'ExitPlanMode', { kind: 'answer', answers: {} })
      expect(row(id)?.plan_ended_at, 'the release reached the ledger').not.toBeNull()

      const resumed = await reopen(id)

      // ⛔ What "planning" means to this app, on the relaunched session: what the PROVIDER was asked
      // for. ⚑ **728 · R93** — BroBot's own floor (140), the second half this asserted, is gone.
      expect(resumed.permissionMode, 'the provider is not put back into plan mode').toBe('default')
    })

    it('🔴 741 · R99 (corrected) — an UNAPPROVED plan comes back NOT planning, as the CLI’s resume does', async () => {
      // ⛔ Until `741` (030, 153): *"a conversation that was proposing when it was closed must not
      // come back acting first"* — it came back planning. ⚑ R99, corrected by `740` F-1: *"a reopened
      // conversation does NOT resume planning, whoever started the plan"* — measured, the
      // interactive CLI's `--continue`/`--resume` comes back in its default mode, 5 of 5 (`740`, K7).
      const id = await turnOpen(true)
      expect(row(id)?.plan_ended_at).toBeNull()

      const resumed = await reopen(id)

      expect(resumed.permissionMode, 'the reopen left planning').toBe('default')
      // ⚑ …and the ledger says so: planned, and left at the reopen — the pair every later reopen reads.
      expect(row(id)?.plan_mode).toBe(1)
      expect(row(id)?.plan_ended_at, 'the reopen’s release, written down').not.toBeNull()
    })

    it('🔴 741 · …and a REJECTED plan comes back not planning either', async () => {
      // The person said no to the plan and the conversation went on planning; the reopen leaves it.
      const id = await turnOpen(true)
      await answerPlanCard(id, 'ExitPlanMode', { kind: 'reject' })
      expect(row(id)?.plan_ended_at).toBeNull()

      const resumed = await reopen(id)

      expect(resumed.permissionMode).toBe('default')
      expect(row(id)?.plan_ended_at).not.toBeNull()
    })

    it('🔴 741 · R99 (corrected) — a plan the MODEL started comes back NOT planning', async () => {
      // ⛔ `740` built *"a reopen resumes planning"* here, from R99's F-8 bullet the PM corrected.
      // ⚑ The plan is still WRITTEN DOWN while the conversation is live (the header and the tests
      // above read it); only the reopen leaves it.
      const id = await turnOpen(false)
      const allowed = await Promise.race([
        canUseTool!('EnterPlanMode', {}, {
          toolUseID: 'tu_enter',
          signal: new AbortController().signal,
        } as never),
        new Promise((resolve) => setTimeout(() => resolve('still pending'), 200)),
      ])
      expect(allowed, 'the premise: no card, the plan settled by the adapter').toEqual({
        behavior: 'allow',
      })

      const resumed = await reopen(id)

      expect(resumed.permissionMode, 'the reopen left planning').toBe('default')
      expect(row(id)?.plan_ended_at, 'the reopen’s release, written down').not.toBeNull()
    })

    it('🔴 740 · R99 — a plan LEFT through the CLI’s own edit grant (accept edits) comes back not planning', async () => {
      // ⚑ `736`: while planning, the CLI's conversation grant for an edit is *switch to accept
      // edits*, which ends its plan mode, and the adapter's plan ends with it. ⛔ **On `main`** the
      // host recorded nothing, so the reopen put the conversation back into plan mode.
      const id = await turnOpen(true)
      expect(launched[0]?.permissionMode).toBe('plan')
      void canUseTool!(
        'Write',
        { file_path: join(dir, 'scratch', id, 'n1.txt'), content: '740\n' },
        {
          toolUseID: 'tu_write',
          signal: new AbortController().signal,
          suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
        } as never,
      )
      await waitFor(
        () => sink.events().some((event) => event.type === 'permission_request'),
        'the Write card',
      )
      await host.respondPermission(id, 'tu_write', { outcome: 'allow_for_session' }, sink)
      expect(row(id)?.plan_ended_at, 'the plan the grant left, written down').not.toBeNull()

      const resumed = await reopen(id)

      expect(resumed.permissionMode, 'it had stopped planning when it was closed').toBe('default')
    })

    it('⚑ 741 · THE CONTROL — a session that never planned comes back not planning, and nothing is written', async () => {
      const id = await turnOpen(false)
      const resumed = await reopen(id)

      expect(resumed.permissionMode).toBe('default')
      // ⚑ A reopen releases only a plan there was: a row that never planned is left as it was.
      expect(row(id)?.plan_mode).toBe(0)
      expect(row(id)?.plan_ended_at).toBeNull()
    })
  })
})
