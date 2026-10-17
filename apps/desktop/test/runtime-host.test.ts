import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeRuntime,
  type AgentRuntime,
  type ProviderRuntimeContext,
  type RuntimeEvent,
  type SessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { SessionRef } from '@brobot2/runtime'
import type { Provider, SessionStatus } from '@brobot2/shared'
import {
  NULL_SESSION_STORE,
  type ResumableSession,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { childWorkRoot } from '../src/main/child-work'
import { DEFAULT_PROFILE_ID, NOTHING_TO_SEND } from '../src/shared/runtime-ipc'

import type {
  CreateSessionInput,
  ModelCatalogue,
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * The host, driven end to end against `FakeRuntime` — the conformance double that
 * behaves like the real adapters at the lifecycle layers the host depends on
 * (session machine, request broker, close barrier). No provider is launched.
 */

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
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

  types(): string[] {
    return this.events().map((event) => event.type)
  }

  find<T extends TranscriptEvent['type']>(
    type: T,
  ): Extract<TranscriptEvent, { type: T }> | undefined {
    return this.events().find(
      (event): event is Extract<TranscriptEvent, { type: T }> => event.type === type,
    )
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('RuntimeHost', () => {
  let userData: string
  let homes: string[]
  let host: RuntimeHost
  let sink: RecordingSink

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => {
        const home = join(userData, 'provider-homes', provider)
        homes.push(home)
        return home
      },
      // ⛔ **Deliberately does NOT record itself in `homes`.** This seam answers a question and
      // provisions nothing, so counting it as a prepared home would make "how many homes were
      // prepared" a number that includes reads (112).
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [{ name: 'auth.json', path: join(home, 'auth.json'), exists: false, note: 'x' }],
      }),
      ...overrides,
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-host-'))
    homes = []
    host = buildHost()
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('starts a session in a provisioned home and streams its opening events', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)

    expect(created.sessionId).toBe('sess_1')
    expect(created.provider).toBe('claude')
    expect(created.providerHome).toBe(join(userData, 'provider-homes', 'claude'))
    expect(created.cwd).toBe(join(userData, 'scratch', 'sess_1'))
    // The Fake confirms at construction, so its ref exists the instant start resolves.
    expect(created.ref?.sessionId).toBe('fake_claude_1')

    // ⚑ **D-017 · R4** — the host's own `launched` row is the first thing on a new conversation's
    // stream (published from `onRegistered`, before the pump starts), then the provider's opening.
    await waitFor(() => sink.messages.length >= 3, 'the opening events')
    expect(sink.types().slice(0, 3)).toEqual(['launched', 'session', 'status'])
    expect(sink.messages.map((message) => message.ordinal).slice(0, 3)).toEqual([0, 1, 2])
    expect(sink.messages[0]?.sessionId).toBe('sess_1')
    expect(host.sessionIds).toEqual(['sess_1'])
  })

  it('uses the cwd the caller asked for', async () => {
    const created = await host.createSession({ provider: 'codex', cwd: userData }, sink)
    expect(created.cwd).toBe(userData)
  })

  it('reports what is in the provider home, and re-reads it on demand', async () => {
    // The renderer has no filesystem access, so whatever the host says is the whole
    // truth it gets — and a snapshot from creation goes stale as soon as a file lands.
    let present = false
    const watching = buildHost({
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [
          { name: 'config.toml', path: join(home, 'config.toml'), exists: present, note: 'x' },
        ],
      }),
    })

    const created = await watching.createSession({ provider: 'codex' }, sink)
    expect(created.config.files[0]).toMatchObject({ name: 'config.toml', exists: false })

    present = true
    expect(watching.refreshConfig(created.sessionId, sink).files[0]?.exists).toBe(true)
    await watching.closeAll()
  })

  it('refuses a config re-read for a session it does not have', () => {
    expect(() => host.refreshConfig('sess_nope', sink)).toThrow('unknown session: sess_nope')
  })

  it('round-trips a prompt into deltas, a message, a tool call and a permission card', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)

    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')

    expect(sink.types()).toEqual([
      // ⚑ D-017 · R4 — the host's launch marker opens the stream.
      'launched',
      'session',
      'status',
      // Our own turn is on the stream too, and ahead of the provider's answer to it — the
      // transcript is a conversation, not a log of one side of one.
      'user_turn',
      'status',
      'assistant_delta',
      'assistant_delta',
      'assistant_delta',
      'assistant_message',
      'tool_call',
      'permission_request',
      // ⚑ D-017 · R19 — nobody spawned this conversation, so its card is a PERSON's and the host
      // says so in a row (`to: 'a-person'`) its reads over every conversation list it by.
      'request_routed',
      'status',
    ])
    expect(sink.find('request_routed')).toMatchObject({
      requestId: 'turn_1_perm',
      to: 'a-person',
    })
    const request = sink.find('permission_request')
    expect(request?.id).toBe('turn_1_perm')
    // The OPAQUE-tool offer, which the Fake mirrors from the real Claude adapter (058): the
    // path-scoped `allow_for_session` is withheld — there is no disclosed path to scope it to —
    // and the wholesale `allow_all_for_session` is offered in its place.
    expect(request?.scope.availableDecisions).toEqual([
      'allow',
      'allow_all_for_session',
      'deny',
      'cancel',
    ])
    // The card shows the whole command, so nothing of the request is hidden.
    expect(request?.scope.underDisclosed).toBe(false)
    expect(sink.events().at(-1)).toEqual({ type: 'status', state: 'waiting_permission' })
  })

  it('Allow releases the tool and completes the turn', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')

    await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await waitFor(() => sink.types().includes('turn'), 'the terminal turn')

    expect(sink.find('tool_result')).toEqual({
      type: 'tool_result',
      id: 'turn_1_tool',
      summary: 'ran ok',
      ok: true,
    })
    expect(sink.find('turn')).toEqual({ type: 'turn', state: 'completed' })
    expect(sink.events().at(-1)).toEqual({ type: 'status', state: 'idle' })
  })

  it('Deny is graceful — the tool is skipped and the turn still completes', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')

    await host.respondPermission(
      created.sessionId,
      'turn_1_perm',
      {
        outcome: 'deny',
        message: 'not this time',
      },
      sink,
    )
    await waitFor(() => sink.types().includes('turn'), 'the terminal turn')

    expect(sink.find('tool_result')?.ok).toBe(false)
    expect(sink.find('turn')).toEqual({ type: 'turn', state: 'completed' })
  })

  it('cancel kills the turn rather than declining the action', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')

    await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'cancel' }, sink)
    await waitFor(() => sink.types().includes('turn'), 'the terminal turn')

    expect(sink.find('turn')).toEqual({ type: 'turn', state: 'interrupted' })
    expect(sink.find('tool_result')).toBeUndefined()
  })

  /**
   * **248 §4 · stopping one piece of background work, on a seam that cannot do it.**
   *
   * ⛔ The Fake implements neither `backgroundWork` nor `stopBackgroundWork` and says so in the
   * conformance ledger: *"it can REPORT background work because a test needs the event, and it
   * cannot DO any, because it runs nothing that could outlive a turn."* That makes it exactly the
   * shape Codex is today, which is the case the whole gate is written for.
   */
  it('⛔ stopBackgroundWork answers `false` on a seam that has no stop — it does not throw', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    // `247` §3: *"`false` is a real answer, not an error."* A rejection here would make a session
    // that simply cannot stop anything look broken.
    await expect(host.stopBackgroundWork(created.sessionId, 'fake_task', sink)).resolves.toBe(false)
  })

  it('⛔ …and the liveness OMITS `canStopBackgroundWork` rather than publishing `false`', async () => {
    // 150/148 L3's rule, which `signInSuperseded` is the precedent for: `=== true` turned every
    // adapter's silence into a positive claim. The renderer gates the button on this key, so an
    // explicit `false` and an absent key are the same to it TODAY — and that is exactly when a
    // contract is cheap to keep.
    await host.createSession({ provider: 'claude' }, sink)
    const latest = sink.liveness.at(-1)
    expect(latest, 'a liveness message was published at all').toBeDefined()
    expect(Object.hasOwn(latest ?? {}, 'canStopBackgroundWork')).toBe(false)
    // …and the paired positive, so the line above is not reading an empty object.
    expect(Object.hasOwn(latest ?? {}, 'queued')).toBe(true)
  })

  it('interrupt settles the pending request and interrupts the turn', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')

    await host.interrupt(created.sessionId, sink)
    await waitFor(() => sink.types().includes('turn'), 'the terminal turn')

    // ⚑ 720 · R71's control: the Fake ENDS a live turn it was told to stop in its own word, as a
    // provider does — so nothing marks it as the app's.
    expect(sink.find('turn')).toEqual({ type: 'turn', state: 'interrupted' })
  })

  it('close drains the stream, delivers the terminal events and unregisters the session', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')

    await host.close(created.sessionId, sink)

    // The pending permission is safe-rejected by the close barrier, the active turn
    // gets exactly one terminal, and `ended` is the last thing the renderer sees.
    expect(sink.types().slice(-4)).toEqual(['turn', 'status', 'session', 'status'])
    // 🔴 720 · R71: the Close's `interrupted` is THIS app's word, and says so past the wire
    // (`toWireEvent` strips any key the schema does not declare).
    expect(sink.find('turn')).toEqual({ type: 'turn', state: 'interrupted', wordOf: 'this-app' })
    expect(sink.events().at(-2)).toMatchObject({ type: 'session', state: 'ended' })
    expect(sink.events().at(-1)).toEqual({ type: 'status', state: 'ended' })
    expect(host.sessionIds).toEqual([])

    // Ordinals are gapless across the whole session.
    expect(sink.messages.map((message) => message.ordinal)).toEqual(
      sink.messages.map((_message, index) => index),
    )
  })

  it('tears a session down exactly once, however many closers fire at once', async () => {
    // The Close button, the window going away and the app quitting can all land in
    // the same tick; the handle contract does not promise a second close is safe.
    let closes = 0
    const counting = buildHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider)
        return {
          provider,
          start: async (options: StartOptions) => {
            const handle = await runtime.start(options)
            const close = handle.close.bind(handle)
            handle.close = () => {
              closes += 1
              return close()
            }
            return handle
          },
          resume: () => Promise.reject(new Error('not used')),
        } as unknown as AgentRuntime
      },
    })

    const created = await counting.createSession({ provider: 'claude' }, sink)
    await Promise.all([
      counting.close(created.sessionId, sink),
      counting.closeSessionsForOwner(sink.ownerId),
      counting.closeAll(),
    ])

    expect(closes).toBe(1)
    expect(counting.sessionIds).toEqual([])
  })

  it('closing a session that is already gone is a no-op', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.close(created.sessionId, sink)
    await expect(host.close(created.sessionId, sink)).resolves.toBeUndefined()
    await expect(host.close('sess_nope', sink)).resolves.toBeUndefined()
  })

  it('refuses every other command for an unknown session', async () => {
    await expect(host.send('sess_nope', 'hi', sink)).rejects.toThrow('unknown session: sess_nope')
    await expect(
      host.respondPermission('sess_nope', 'req', { outcome: 'allow' }, sink),
    ).rejects.toThrow('unknown session: sess_nope')
    await expect(
      host.respondUserInput('sess_nope', 'req', { kind: 'reject' }, sink),
    ).rejects.toThrow('unknown session: sess_nope')
    await expect(host.interrupt('sess_nope', sink)).rejects.toThrow('unknown session: sess_nope')
    // ⚠️ 248: `false` is what an adapter with no stop answers — an unknown SESSION is a different
    // thing being wrong, and it still goes through `require()` like every other control verb.
    await expect(host.stopBackgroundWork('sess_nope', 'b6uoyo82k', sink)).rejects.toThrow(
      'unknown session: sess_nope',
    )
  })

  it('addresses each session separately and numbers each stream from zero', async () => {
    const first = await host.createSession({ provider: 'claude' }, sink)
    const second = await host.createSession({ provider: 'codex' }, sink)
    // ⚑ D-017 · R4 — three each: the host's `launched` row, then the provider's two.
    await waitFor(() => sink.messages.length >= 6, 'both openings')

    const forFirst = sink.messages.filter((message) => message.sessionId === first.sessionId)
    const forSecond = sink.messages.filter((message) => message.sessionId === second.sessionId)
    expect(forFirst.map((message) => message.ordinal)).toEqual([0, 1, 2])
    expect(forSecond.map((message) => message.ordinal)).toEqual([0, 1, 2])
    expect(host.sessionIds).toEqual([first.sessionId, second.sessionId])
  })

  it('stops delivering to a sink whose surface is gone', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    // ⚑ D-017 · R4 — the opening is three rows now: `launched`, then the provider's two.
    await waitFor(() => sink.messages.length >= 3, 'the opening events')
    const delivered = sink.messages.length

    sink.alive = false
    await host.send(created.sessionId, 'hello', sink)
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(sink.messages.length).toBe(delivered)
  })

  it('closes only the sessions belonging to the window that went away', async () => {
    const other = new RecordingSink('owner:2')
    const mine = await host.createSession({ provider: 'claude' }, sink)
    const theirs = await host.createSession({ provider: 'claude' }, other)

    await host.closeSessionsForOwner('owner:1')

    expect(host.sessionIds).toEqual([theirs.sessionId])
    expect(mine.sessionId).not.toBe(theirs.sessionId)
  })

  it('registers nothing when the provider fails to start', async () => {
    const failing = buildHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () =>
        ({
          provider: 'claude' as const,
          start: () => Promise.reject(new Error('login unavailable')),
          resume: () => Promise.reject(new Error('nope')),
        }) as unknown as AgentRuntime,
    })

    await expect(failing.createSession({ provider: 'claude' }, sink)).rejects.toThrow(
      'login unavailable',
    )
    expect(failing.sessionIds).toEqual([])
  })

  it('turns a failing event stream into a fatal error and unregisters the session', async () => {
    const exploding = buildHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new ExplodingRuntime(),
    })

    await exploding.createSession({ provider: 'claude' }, sink)
    await waitFor(() => sink.types().includes('error'), 'the fatal error')

    expect(sink.find('error')).toEqual({
      type: 'error',
      message: 'event stream failed: stream died',
      fatal: true,
    })
    await waitFor(() => exploding.sessionIds.length === 0, 'the session to be unregistered')
  })
})

/**
 * # ⛔ The host owns the content rule now (234 §3, from `228` L1)
 *
 * ⚠️ **These methods trusted their callers.** `hasSomethingToSend` was enforced at the wire and in
 * the composer and NOWHERE in between — `messageWithHandedPaths` returns the raw text when there
 * are no paths and `SessionHandle.send` accepts any string — so a main-process caller could queue a
 * blank turn or destroy a running one to send spaces. ⚑ Latent rather than reachable today: every
 * shipping call arrives through validated IPC. The endgame's MCP spawn tools are the door that
 * would not.
 *
 * ⛔ **Driven through the PUBLIC methods**, because the claim is about the boundary rather than
 * about `assertCanTakeTurn` — a gate one entry point forgets to call is exactly 148 H2.
 */
describe('RuntimeHost — an empty message is not a turn (234 §3)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-content-'))
    let counter = 0
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  const blank = ['', '   ', '\n\t'] as const

  it('🔴 `send`, `sendInterrupting` and `queueMessage` all refuse words that are not words', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    const id = created.sessionId
    for (const text of blank) {
      await expect(host.send(id, text, sink)).rejects.toThrow(NOTHING_TO_SEND)
      await expect(host.sendInterrupting(id, text, sink)).rejects.toThrow(NOTHING_TO_SEND)
      await expect(host.queueMessage(id, text, sink)).rejects.toThrow(NOTHING_TO_SEND)
    }
    // ⛔ …and nothing was recorded on the way to refusing. `sendInterrupting` is the one that could
    // have cost something: it writes 085's breadcrumb and then kills the running turn.
    expect(sink.types()).not.toContain('user_turn')
    expect(sink.types()).not.toContain('message_queued')
    expect(sink.types()).not.toContain('user_command')
  })

  it('🔴 the go-ahead refuses one too, and plan mode is still ON afterwards', async () => {
    const created = await host.createSession({ provider: 'claude', planMode: true }, sink)
    await expect(host.endPlanMode(created.sessionId, sink, '   ')).rejects.toThrow(NOTHING_TO_SEND)
    // ⛔ **The half that makes this worth refusing at all** (060's own ordering): the release is
    // persisted and published BEFORE the send, so a go-ahead refused late would leave a conversation
    // durably out of plan mode for a turn that never happened.
    expect(
      sink.liveness.at(-1)?.plan?.planNeedsGoAhead,
      'the plan bar went away for a go-ahead that was refused',
    ).toBe(true)
  })

  it('⚑ …and a real message still goes — the paired positive', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'a real message', sink)
    expect(
      sink
        .events()
        .filter((event) => event.type === 'user_turn')
        .map((event) => (event as { text: string }).text),
    ).toEqual(['a real message'])
  })

  it('⚑ …and an ATTACHMENT is content, so no words is legal when something is staged (216/221)', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    // ⚠️ `realpathSync`, because 232 §1 compares the canonical path: on macOS `/var` is a symlink to
    // `/private/var`, so a staged `tmpdir()` path that skipped this would be refused as a thing that
    // had CHANGED — a fixture defect that reads exactly like the feature being broken.
    const note = join(realpathSync(userData), 'notes.md')
    writeFileSync(note, 'x')
    await host.send(created.sessionId, '', sink, [{ path: note, kind: 'file', outsideCwd: true }])
    // ⛔ The rule is `hasSomethingToSend`, not "text is non-blank" — this is the assertion that
    // stops somebody "tightening" the gate into 220's adoption blocker all over again.
    expect(sink.types()).toContain('user_turn')
  })
})

/**
 * Provider liveness, end to end through the host: what the renderer is told about a
 * provider that is working, then quiet, then gone.
 */
describe('RuntimeHost liveness', () => {
  let userData: string
  let sink: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-liveness-'))
    sink = new RecordingSink()
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  function hostWith(runtime: AgentRuntime, windowMs: number): RuntimeHost {
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: () => join(userData, 'home'),
      providerHomePath: () => join(userData, 'home'),
      resolveCwd: (sessionId) => join(userData, 'scratch', sessionId),
      newSessionId: () => 'sess_live',
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
      liveness: { windowMs },
      // A deliberately silent provider never ends its stream, so closing it must not
      // wait out the default drain budget.
      closeDrainTimeoutMs: 100,
    })
  }

  it('hands the renderer a live session to start from', async () => {
    const host = hostWith(new FakeRuntime('claude'), 50)
    const created = await host.createSession({ provider: 'claude' }, sink)
    expect(created.liveness.state).toBe('live')
    await host.closeAll()
  })

  it('reports silent when a working turn goes quiet, and says why', async () => {
    // A provider that says it is working and then says nothing — the stuck-turn case.
    const host = hostWith(new QuietRuntime(), 40)
    await host.createSession({ provider: 'claude' }, sink)

    await waitFor(() => sink.liveness.some((l) => l.state === 'silent'), 'the silent report')
    expect(sink.liveness.at(-1)?.detail).toMatch(/you can interrupt/)
    await host.closeAll()
  })

  it('never reports silent while a card is waiting on the user', async () => {
    // FakeRuntime parks on a permission card, which is waiting — not silence.
    const host = hostWith(new FakeRuntime('claude'), 30)
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'hello', sink)
    await waitFor(
      () => sink.messages.some((m) => m.event.type === 'permission_request'),
      'the permission card',
    )

    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(sink.liveness.map((l) => l.state)).not.toContain('silent')
    await host.closeAll()
  })

  it('ends when the session closes', async () => {
    const host = hostWith(new FakeRuntime('claude'), 50)
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.close(created.sessionId, sink)
    expect(sink.liveness.at(-1)?.state).toBe('ended')
  })

  it('errors when the stream dies under it', async () => {
    const host = hostWith(new ExplodingRuntime(), 50)
    await host.createSession({ provider: 'claude' }, sink)
    await waitFor(() => sink.liveness.some((l) => l.state === 'errored'), 'the errored report')
    expect(sink.liveness.at(-1)?.detail).toMatch(/stream died/)
  })

  /**
   * **248 §4 · the POSITIVE half, which the Fake cannot give.**
   *
   * ⛔ Every other assertion about this gate is an absence — the Fake implements neither control, so
   * `canStopBackgroundWork` is missing and `stopBackgroundWork` answers `false`. An absence-only
   * pair passes just as well over a disclosure that was deleted outright, and `193`'s vacuity is
   * exactly that shape. This is the row that makes the others mean something.
   */
  it('⛔ an adapter that CAN stop is disclosed, and the id goes straight through', async () => {
    const runtime = new StoppableRuntime()
    const host = hostWith(runtime, 50)
    const created = await host.createSession({ provider: 'claude' }, sink)

    expect(sink.liveness.at(-1)?.canStopBackgroundWork, 'the gate the button reads').toBe(true)
    await expect(host.stopBackgroundWork(created.sessionId, 'b6uoyo82k', sink)).resolves.toBe(true)
    // ⚠️ The PROVIDER's own key, unmodified — `247` refused a neutral surrogate because *"a neutral
    // identifier nobody could act on"* is what one would be.
    expect(runtime.stopped).toEqual(['b6uoyo82k'])
    // ⚠️ **Closed, because `newSessionId` is a CONSTANT in this describe.** A session left open here
    // is still being driven when the next test asks for `sess_live`, and the host refuses it by name
    // — which reads as a failure of whatever that test was about (found writing the one below).
    await host.closeAll()
  })

  /**
   * 🔴 **287 finding 5 · the host FORWARDS the adapter's answer instead of inventing one.**
   *
   * ⛔ **`true` used to be written here, from the fact that nothing threw.** Both adapters no-op
   * silently once the session is shutting down or the provider object has no stop behind it — so the
   * bar said *"Stopping… / Asked to stop"* over a request that never left the process, which is this
   * boolean's own wire contract broken by its only writer.
   */
  it('🔴 a handle that did NOT send says so, and the host does not upgrade it to `true`', async () => {
    const runtime = new StoppableRuntime()
    const host = hostWith(runtime, 50)
    const created = await host.createSession({ provider: 'claude' }, sink)

    // The paired positive first: the same call on the same session answers `true` a moment before,
    // so the `false` below is the handle's answer travelling and not the seam declining.
    await expect(host.stopBackgroundWork(created.sessionId, 'b6uoyo82k', sink)).resolves.toBe(true)
    runtime.accepts = false
    await expect(host.stopBackgroundWork(created.sessionId, 'b6uoyo82k', sink)).resolves.toBe(false)
    // …and the call really was attempted both times, so `false` is about what came back.
    expect(runtime.stopped).toEqual(['b6uoyo82k', 'b6uoyo82k'])
    await host.closeAll()
  })
})

/** A provider that announces work and then goes quiet — no events, no terminal, no end. */
class QuietRuntime implements AgentRuntime {
  readonly provider = 'claude' as const

  async start(): Promise<SessionHandle> {
    return {
      ref: null,
      send: async () => {},
      events: (): AsyncIterable<RuntimeEvent> => ({
        async *[Symbol.asyncIterator]() {
          yield { type: 'status', state: 'working' } as RuntimeEvent
          await new Promise(() => {}) // …and then nothing, ever
        },
      }),
      respondPermission: async () => {},
      respondUserInput: async () => {},
      // ⚑ **446 · a double that cannot be waited on** — this handle has no `SessionMachine`
      // behind it and publishes no status of its own, so the honest implementation is the one
      // that changes nothing. ⛔ It is still DECLARED, because `SessionHandle.waitForAPerson`
      // is not optional: an adapter that could not join the count is one whose status nobody
      // can trust, and a double that omitted it would let a host call it and get `undefined`.
      waitForAPerson: () => (): void => {},
      approval: { effective: 'ask' as const, requested: 'ask' as const },
      blanketGrants: [],
      planNeedsGoAhead: false,
      setPlanMode: async () => {},
      setWorkFolders: () => {},
      workFolders: { effective: [], requested: [] },
      setModel: async () => {},
      setReasoningEffort: async () => {},
      settings: {
        model: { effective: undefined, requested: undefined },
        reasoningEffort: { effective: undefined, requested: undefined },
        planMode: { effective: false, requested: false },
      },
      setApprovalMode: async () => {},
      interrupt: async () => {},
      status: (): SessionStatus => 'working',
      close: async () => {},
    }
  }

  async resume(): Promise<SessionHandle> {
    throw new Error('not used')
  }

  async listModels(): Promise<[]> {
    return []
  }
}

/**
 * A provider whose handle CAN stop one piece of background work (248) — Claude's shape, as against
 * the Fake's and Codex's.
 *
 * ⚑ Built on {@link QuietRuntime} rather than beside it: what this class is FOR is one optional
 * member, and a second copy of a whole handle literal would make that the least visible thing about
 * it.
 */
class StoppableRuntime extends QuietRuntime {
  readonly stopped: string[] = []
  /**
   * ⛔ **What the HANDLE says came back** (287 finding 5). It used to be unable to say anything —
   * `stopBackgroundWork` resolved `void` — and the host answered `true` for every call that did not
   * throw, including the adapters' own silent no-ops on a shutting-down session.
   */
  accepts = true

  override async start(): Promise<SessionHandle> {
    const handle = await super.start()
    return {
      ...handle,
      stopBackgroundWork: async (id: string) => {
        this.stopped.push(id)
        return this.accepts
      },
    }
  }
}

/** A runtime whose stream fails rather than closing — the pump must report, not hang. */
class ExplodingRuntime implements AgentRuntime {
  readonly provider = 'claude' as const

  async start(): Promise<SessionHandle> {
    return {
      ref: null,
      send: async () => {},
      events: (): AsyncIterable<RuntimeEvent> => ({
        [Symbol.asyncIterator]: (): AsyncIterator<RuntimeEvent> => ({
          next: () => Promise.reject(new Error('stream died')),
        }),
      }),
      respondPermission: async () => {},
      respondUserInput: async () => {},
      // ⚑ **446 · a double that cannot be waited on** — this handle has no `SessionMachine`
      // behind it and publishes no status of its own, so the honest implementation is the one
      // that changes nothing. ⛔ It is still DECLARED, because `SessionHandle.waitForAPerson`
      // is not optional: an adapter that could not join the count is one whose status nobody
      // can trust, and a double that omitted it would let a host call it and get `undefined`.
      waitForAPerson: () => (): void => {},
      approval: { effective: 'ask' as const, requested: 'ask' as const },
      blanketGrants: [],
      planNeedsGoAhead: false,
      setPlanMode: async () => {},
      setWorkFolders: () => {},
      workFolders: { effective: [], requested: [] },
      setModel: async () => {},
      setReasoningEffort: async () => {},
      settings: {
        model: { effective: undefined, requested: undefined },
        reasoningEffort: { effective: undefined, requested: undefined },
        planMode: { effective: false, requested: false },
      },
      setApprovalMode: async () => {},
      interrupt: async () => {},
      status: (): SessionStatus => 'idle',
      close: async () => {},
    }
  }

  async resume(): Promise<SessionHandle> {
    throw new Error('not used')
  }

  async listModels(): Promise<[]> {
    return []
  }
}

/**
 * Sending during a running turn composes interrupt, wait for terminalization, then send.
 * `SessionMachine` allows only one live turn per session; racing another send would violate
 * that invariant.
 */
describe('RuntimeHost.sendInterrupting — send anyway, mid-turn (074)', () => {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-host-interrupt-'))
  let host: RuntimeHost
  let sink: RecordingSink

  beforeEach(() => {
    let counter = 0
    sink = new RecordingSink()
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [],
      }),
    })
  })
  afterEach(async () => {
    await host.closeAll()
  })

  it('interrupts the running turn, then sends — the plain send would have waited behind it', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'first', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the first turn to be running')

    // A plain send here does not start a turn — that is the trap the user was in. ⚠️ **It was
    // REFUSED until 670**, with the adapter's sentence; since 670 a send that loses to a running
    // turn is HELD, so it waits behind a turn parked on a card, and interrupting is still the only
    // way to have it now.
    await host.send(created.sessionId, 'held while it works', sink)
    expect(
      sink.messages.some(
        (m) => m.event.type === 'message_queued' && m.event.text === 'held while it works',
      ),
    ).toBe(true)
    expect(
      sink.messages.filter((m) => m.event.type === 'status' && m.event.state === 'working'),
    ).toHaveLength(1)
    // ⚑ **Taken back, so what follows measures the interrupt alone** (670, from the review): a held
    // message left in the mailbox would flush after the interrupt and open a second `working` of
    // its own, and the wait below could be met without `second` ever being handed over.
    const held = sink.messages.find(
      (m) => m.event.type === 'message_queued' && m.event.text === 'held while it works',
    )?.event
    if (held?.type !== 'message_queued' || held.messageId === undefined) {
      throw new Error('the plain send was not held')
    }
    await host.cancelQueuedMessage(created.sessionId, held.messageId, sink)

    await host.sendInterrupting(created.sessionId, 'second', sink)

    // The first turn ended as interrupted, and the second turn really started.
    //
    // ⚠️ **Awaited rather than asserted (064).** `sendInterrupting` returns as soon as the HANDLE
    // reports idle, and the handle's status is set the moment the event is pushed — the pump that
    // carries those events to the sink is a separate loop. So this was always a race between the
    // terminal `turn` reaching the sink and the next line running; it happened to win. Adding one
    // event to the Fake's turn (the `working` a real adapter publishes when a card is answered) was
    // enough to lose it. Waiting is what the assertion meant all along.
    await waitFor(
      () => sink.messages.some((m) => m.event.type === 'turn' && m.event.state === 'interrupted'),
      'the first turn to end as interrupted',
    )
    await waitFor(
      () =>
        sink.messages.filter((m) => m.event.type === 'status' && m.event.state === 'working')
          .length >= 2,
      'the second turn to start working',
    )
    // ⚑ **And the words that started it were the replacement's.**
    expect(
      sink.messages.some((m) => m.event.type === 'user_turn' && m.event.text === 'second'),
    ).toBe(true)
  })

  it('falls through to a plain send when the session is already idle', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.sendInterrupting(created.sessionId, 'only message', sink)
    await waitFor(() => sink.types().includes('assistant_message'), 'the turn to run')
    // Nothing was interrupted — there was nothing to interrupt.
    expect(
      sink.messages.some((m) => m.event.type === 'turn' && m.event.state === 'interrupted'),
    ).toBe(false)
  })

  it('rejects for an unknown session, like every other host command', async () => {
    await expect(host.sendInterrupting('nope', 'hi', sink)).rejects.toThrow()
  })
})

// ⚑ **D-017b · the provider process line (076) is gone** — `SessionLiveness.process` said whether a
// provider process runs and which pid it has, which is a process fact `05` rule 5 keeps off every
// surface; its four tests went with it (the Info row that drew it, `session-process`, is gone too).

/**
 * Auto-approve mode at the boundary (078). The dangerous mode must be reachable ONLY by asking for
 * it by name — everything else, including a malformed value crossing the wire, resolves to `ask`.
 */
describe('RuntimeHost — approval mode (078)', () => {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-host-yolo-'))

  function yoloHost(store: SessionStore = NULL_SESSION_STORE) {
    let counter = 0
    const started: StartOptions[] = []
    const host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider)
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          started.push(opts)
          return start(opts)
        }
        return runtime
      },
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [],
      }),
    })
    return { host, started }
  }

  it('OMITTED approvalMode resolves to ask — the safe default at the contract boundary', async () => {
    const { host, started } = yoloHost()
    const created = await host.createSession({ provider: 'claude' }, new RecordingSink())
    expect(started[0]?.approvalMode).toBe('ask')
    expect(created.approvalMode).toBe('ask')
    // Every session states its mode (082): a blank that means "ask" is not a disclosure, and it
    // left a checked yolo box next to a running ask-session looking like yolo was broken.
    expect(created.approvalNote).toBe('approvals: ask')
    await host.closeAll()
  })

  it('auto is passed through and disclosed, with the Codex sandbox called out', async () => {
    const { host, started } = yoloHost()
    const created = await host.createSession(
      { provider: 'codex', approvalMode: 'auto' },
      new RecordingSink(),
    )
    expect(started[0]?.approvalMode).toBe('auto')
    expect(created.approvalMode).toBe('auto')
    // ⛔ **`YOLO`, not `AUTO`** (171 §2): the CLI this app is meant to feel like has a mode called
    // Auto and it is an allowlist that grows by consent. This one is `--yolo`.
    expect(created.approvalNote).toContain('YOLO')
    expect(created.approvalNote, 'the old word is gone, not merely joined').not.toContain('AUTO')
    // ⚠️ …and it says what is not asked rather than what is not shown. *"No prompts"* described the
    // app's own cards and stopped there — the reading that let *"Bash raises a card in every mode"*
    // stand in `confinement.ts` for three dispatches.
    expect(created.approvalNote).toContain('nothing is asked')
    expect(created.approvalNote, 'Codex also loses its sandbox').toContain('sandbox OFF')
    await host.closeAll()
  })

  it('Claude auto discloses no sandbox claim — it has no separate sandbox axis', async () => {
    const { host } = yoloHost()
    const created = await host.createSession(
      { provider: 'claude', approvalMode: 'auto' },
      new RecordingSink(),
    )
    expect(created.approvalNote).toContain('YOLO')
    expect(created.approvalNote).not.toContain('AUTO')
    expect(created.approvalNote).not.toContain('sandbox')
    await host.closeAll()
  })

  it('an ASK session says so — the mode is never invisible (082)', async () => {
    const { host } = yoloHost()
    for (const provider of ['claude', 'codex'] as Provider[]) {
      const created = await host.createSession({ provider }, new RecordingSink())
      expect(created.approvalNote, provider).toBe('approvals: ask')
      // Neutral, not a warning: only the unattended mode shouts.
      expect(created.approvalNote).not.toContain('⚠')
    }
    await host.closeAll()
  })

  it('a malformed mode can never reach auto — it resolves to ask', async () => {
    const { host, started } = yoloHost()
    await host.createSession(
      { provider: 'codex', approvalMode: 'AUTO' as 'auto' },
      new RecordingSink(),
    )
    expect(started[0]?.approvalMode).toBe('ask')
    await host.closeAll()
  })

  it('switching mid-conversation reports what is RUNNING and what is pending, separately (034)', async () => {
    const { host } = yoloHost()
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex' }, sink)
    const disclosure = await host.setApprovalMode(created.sessionId, 'auto', sink)

    // The Fake honours the same next-turn contract as the real adapters, so nothing has moved yet.
    expect(disclosure.approvalMode, 'still what the session is running under').toBe('ask')
    expect(disclosure.pendingApprovalMode).toBe('auto')
    expect(disclosure.approvalNote).toBe('approvals: ask · YOLO from your next message')
    await host.closeAll()
  })

  it('…and once a turn adopts it, the disclosure becomes the plain warning again (034)', async () => {
    const { host } = yoloHost()
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.setApprovalMode(created.sessionId, 'auto', sink)
    await host.send(created.sessionId, 'go', sink)

    const after = await host.setApprovalMode(created.sessionId, 'auto', sink)
    expect(after.approvalMode).toBe('auto')
    expect(after.pendingApprovalMode, 'nothing outstanding').toBeNull()
    expect(after.approvalNote).toContain('sandbox OFF')
    await host.closeAll()
  })

  it('PUSHES the change, because the turn that adopts it answers no command (034)', async () => {
    // Caught by the UI smoke, not by a unit test: the mode moves inside the handle when a turn
    // starts, and no command returns at that moment. Without a push the header sat on "AUTO from
    // your next message" for the whole turn that actually adopted it — which reads exactly like a
    // switch that did not work, on the one control where that doubt matters most.
    const { host } = yoloHost()
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex' }, sink)
    const approvals = (): (string | undefined)[] =>
      sink.liveness.map((l) => JSON.stringify(l.approval)).filter(Boolean)

    await host.setApprovalMode(created.sessionId, 'auto', sink)
    expect(sink.liveness.at(-1)?.approval).toEqual({
      approvalMode: 'ask',
      // Nothing has been granted wholesale, and the disclosure says so rather than omitting it
      // (058): an absent field would be indistinguishable from an older host that could not answer.
      blanketGrants: [],
      pendingApprovalMode: 'auto',
      approvalNote: 'approvals: ask · YOLO from your next message',
    })

    const before = approvals().length
    await host.send(created.sessionId, 'go', sink)
    expect(sink.liveness.at(-1)?.approval?.approvalMode, 'the turn adopted it').toBe('auto')
    expect(sink.liveness.at(-1)?.approval?.pendingApprovalMode).toBeNull()
    expect(approvals().length, 'exactly one push for the adoption').toBe(before + 1)

    // …and a change that changes nothing says nothing: the channel is re-rendered from.
    const quiet = sink.liveness.length
    await host.setApprovalMode(created.sessionId, 'auto', sink)
    expect(sink.liveness.length).toBe(quiet)
    await host.closeAll()
  })

  it('says so IMMEDIATELY when the mode change did not persist (034 review)', async () => {
    // Every other durable write in the host sits inside a call that reports the failure in the same
    // step. This one did not, and the command is exactly the one where that matters: setting yolo
    // and walking away is an ordinary thing to do, and it is the case where no further turn or
    // provider event would ever arrive to carry the notice. The session would come back in the mode
    // the user tried to leave, with nothing anywhere having said the write failed.
    const { host } = yoloHost({
      ...NULL_SESSION_STORE,
      setApprovalMode: () => {
        throw new Error('database is locked')
      },
    })
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex' }, sink)
    const before = sink.messages.filter((m) => m.event.type === 'error').length

    await host.setApprovalMode(created.sessionId, 'auto', sink)

    const notices = sink.messages.filter((m) => m.event.type === 'error')
    expect(notices.length, 'reported by the command itself, not by the next turn').toBe(before + 1)
    const notice = notices.at(-1)?.event
    expect(notice).toMatchObject({ fatal: false })
    expect(notice && 'message' in notice ? notice.message : '').toMatch(/no longer being recorded/)
    await host.closeAll()
  })
})

/**
 * The agent rows on the info panel (081). The host composes them so the renderer never learns that
 * Claude has no reasoning knob while Codex does.
 */
describe('RuntimeHost — the agent config rows (081)', () => {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-host-agent-'))

  function hostWith(
    agentInfo:
      { model?: string; reasoningEffort?: string; reasoningEffortReported?: boolean } | undefined,
  ) {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider)
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          const handle = await start(opts)
          Object.defineProperty(handle, 'agentInfo', { get: () => agentInfo })
          return handle
        }
        return runtime
      },
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [],
      }),
    })
  }

  async function rows(
    provider: Provider,
    agentInfo: Parameters<typeof hostWith>[0],
    /** ⚑ D-042 · what the launch names — nothing, by default, and R1 then names it. */
    named: Omit<CreateSessionInput, 'provider'> = {},
  ) {
    const sink = new RecordingSink()
    const host = hostWith(agentInfo)
    const created = await host.createSession({ provider, ...named }, sink)
    await host.close(created.sessionId, sink)
    await waitFor(() => sink.liveness.length > 0, 'a liveness message')
    await host.closeAll()
    return sink.liveness[0]?.agent ?? []
  }

  it('a REPORTED effort is shown as fact — Codex describes the thread it is running', async () => {
    expect(
      await rows('codex', {
        model: 'gpt-5.1-codex',
        reasoningEffort: 'high',
        reasoningEffortReported: true,
      }),
    ).toEqual([
      { label: 'model', value: 'gpt-5.1-codex' },
      { label: 'reasoning', value: 'high' },
    ])
  })

  it('a REQUESTED effort is marked as one — the provider never confirmed it (024)', async () => {
    // Claude accepts `Options.effort` but echoes nothing back (its `init` carries model/cwd/tools
    // and no effort), and the SDK documents a silent downgrade on models that do not support the
    // level. So the value is our request, and saying it plainly is the only honest option.
    expect(
      await rows('claude', {
        model: 'claude-opus-4-8',
        reasoningEffort: 'high',
        reasoningEffortReported: false,
      }),
    ).toEqual([
      { label: 'model', value: 'claude-opus-4-8' },
      { label: 'reasoning', value: 'high (requested)' },
    ])
  })

  it('no effort at all still reads "not reported" — the old hard-coded n/a is gone (024)', async () => {
    // `n/a` claimed the provider HAS no such setting. That was false for both providers, and it is
    // a much stronger claim than "nothing has been reported".
    //
    // ⚑ **D-042 · "no effort at all" is now a MODEL's fact, not a launch's** (R1: every launch names
    // its effort). A launch naming nothing runs at `high` by name — the A, which says its request —
    // so the honest empty needs a model whose own list row offers no levels (the Fake's `-b` row,
    // as Claude's `haiku`): R1 names it none, and nothing was asked to report.
    const asked = await rows('claude', { model: 'claude-opus-4-8' })
    expect(asked).toEqual([
      { label: 'model', value: 'claude-opus-4-8' },
      { label: 'reasoning', value: 'medium (requested)' },
    ])
    const shown = await rows('claude', { model: 'fake-claude-b' }, { model: 'fake-claude-b' })
    expect(shown).toEqual([
      { label: 'model', value: 'fake-claude-b' },
      { label: 'reasoning', value: '…' },
    ])
    expect(JSON.stringify([asked, shown])).not.toContain('n/a')
  })

  it('shows a neutral placeholder before the provider reports — never a guessed default', async () => {
    // ⚑ **D-042 moved this from `…` to a NAMED request** (R1). A Codex launch that names nothing
    // runs on the row Codex's own `model/list` marks `isDefault`, at that row's own default effort —
    // the Fake's `-a` row at `medium` — so before the provider reports, the rows say that request,
    // marked as one. ⛔ Still never a GUESSED default: it is the provider's own answer, by name.
    const shown = await rows('codex', undefined)
    expect(shown.map((r) => r.value)).toEqual(['fake-codex-a (requested)', 'medium (requested)'])
    // Specifically: it must not fall back to the config-file model, which is a different thing.
    expect(shown.some((r) => r.value.includes('config model'))).toBe(false)
  })
})

/**
 * The workspace, through the host (Slice 2 · 006) — and the PO's open question: a conversation's
 * cwd is chosen at create, RECORDED, and replayed on resume. It is never re-derived, so a resumed
 * conversation reopens the same directory even if the default has since moved.
 */
describe('RuntimeHost — the workspace cwd is recorded and replayed (006)', () => {
  const userData = mkdtempSync(join(tmpdir(), 'brobot2-host-workspace-'))
  const workspace = join(userData, 'brobot-workspace')

  function hostWith(
    resolveCwd: (sessionId: string, requested?: string) => string,
    store: typeof NULL_SESSION_STORE = NULL_SESSION_STORE,
  ) {
    let counter = 0
    const started: { cwd: string; systemHint?: string; provider: Provider }[] = []
    const resumed: SessionRef[] = []
    /** What the RESUME path was handed (158) — the half that was `undefined` from 056 to 158. */
    const resumedHints: (string | undefined)[] = []
    const host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const runtime = new FakeRuntime(provider)
        const start = runtime.start.bind(runtime)
        runtime.start = async (opts) => {
          started.push({ cwd: opts.cwd, systemHint: opts.systemHint, provider })
          return start(opts)
        }
        const resume = runtime.resume.bind(runtime)
        runtime.resume = async (ref, options) => {
          resumed.push(ref)
          resumedHints.push(options.systemHint)
          return resume(ref, options)
        }
        return runtime
      },
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd,
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [],
      }),
      // The 006 shape, now expressed through 158's seam: one directory, one provider, one string.
      // What the real composition root does is read files (see `instructions.test.ts`); what the
      // HOST owes is to pass whatever it is given to both launch paths, and that is what this stub
      // isolates.
      readInstructions: (provider, cwd) => {
        const hint =
          cwd === workspace && provider === 'claude' ? 'workspace instructions' : undefined
        return {
          instructions: hint
            ? {
                agentMemory: [],
                injected: [
                  {
                    kind: 'workspace-instructions' as const,
                    path: join(workspace, 'CLAUDE.md'),
                    text: hint,
                    bytes: hint.length,
                    truncated: false,
                  },
                ],
                provider: [],
                refused: [],
                note: 'read at launch',
                recallsReported: false,
                writesReported: false,
                composed: null,
              }
            : {
                injected: [],
                agentMemory: [],
                provider: [],
                refused: [],
                note: '',
                recallsReported: false,
                writesReported: false,
                composed: null,
              },
          systemHint: hint,
        }
      },
    })
    return { host, started, resumed, resumedHints }
  }

  it("a new conversation's recorded cwd is the workspace", async () => {
    const { host, started } = hostWith(() => workspace)
    const created = await host.createSession({ provider: 'codex' }, new RecordingSink())
    expect(started[0]?.cwd).toBe(workspace)
    // The ref the session is recorded under carries that same cwd — this is what resume replays.
    expect(created.ref?.cwd).toBe(workspace)
    await host.closeAll()
  })

  it('RESUME reopens the RECORDED cwd, even after the default has moved (the PO question)', async () => {
    // The answer to "does an agent's working directory persist across resume?": it is recorded on
    // the session's ref at create and REPLAYED — never re-derived. A later launch whose default cwd
    // has moved must not drag an existing conversation along with it.
    const ref = { provider: 'codex' as const, sessionId: 'th_1', cwd: workspace, rotation: 0 }
    const recorded = {
      sessionId: 'sess_1',
      provider: 'codex' as const,
      ref,
      cwd: workspace,
      status: 'idle' as const,
      approvalMode: 'ask' as const,
      profileId: 'default',
      updatedAt: Date.now(),
    }
    const moved = join(userData, 'somewhere-else')
    const { host, started, resumed } = hostWith(() => moved, {
      ...NULL_SESSION_STORE,
      find: (sessionId: string) =>
        sessionId === recorded.sessionId ? (recorded as unknown as ResumableSession) : null,
    } as typeof NULL_SESSION_STORE)

    // The Fake honestly refuses a ref it never issued (034) — irrelevant here: the property under
    // test is what the HOST handed the adapter, captured before that refusal.
    await expect(host.resumeSession(recorded.sessionId, new RecordingSink())).rejects.toThrow()

    expect(resumed[0]?.cwd, 'resume replays the recorded cwd').toBe(workspace)
    expect(resumed[0]?.cwd, 'and never the moved default').not.toBe(moved)
    expect(started, 'resume must not go through the create path').toHaveLength(0)
    await host.closeAll()
  })

  it('Claude gets the instructions injected; Codex does not (it reads AGENTS.md itself)', async () => {
    const { host, started } = hostWith(() => workspace)
    const claude = await host.createSession({ provider: 'claude' }, new RecordingSink())
    const codex = await host.createSession({ provider: 'codex' }, new RecordingSink())
    expect(started[0]?.systemHint).toBe('workspace instructions')
    expect(started[1]?.systemHint).toBeUndefined()
    // ⛔ **And the renderer is told the SAME thing the model was** (158). The pair is the point: an
    // injection the user cannot see is exactly what this ticket is about, so asserting the adapter
    // got the text without asserting the disclosure carries it would re-open the hole one layer up.
    expect(claude.instructions.injected.map((i) => i.text)).toEqual(['workspace instructions'])
    expect(codex.instructions.injected, 'nothing injected ⇒ nothing to show').toEqual([])
    await host.closeAll()
  })

  it('⛔ the instructions are re-applied on RESUME — the half 156 named as missing', async () => {
    // *"A start-only append would make the developer forget who they are after reopening."* Every
    // conversation reopened between 056 and 158 came back without them: `ResumeOptions` had no
    // field to carry one and this path passed none.
    const ref = { provider: 'claude' as const, sessionId: 'th_1', cwd: workspace, rotation: 0 }
    const recorded = {
      sessionId: 'sess_1',
      provider: 'claude' as const,
      ref,
      cwd: workspace,
      status: 'idle' as const,
      approvalMode: 'ask' as const,
      profileId: 'default',
      updatedAt: Date.now(),
    }
    const { host, resumedHints } = hostWith(() => workspace, {
      ...NULL_SESSION_STORE,
      find: (sessionId: string) =>
        sessionId === recorded.sessionId ? (recorded as unknown as ResumableSession) : null,
    } as typeof NULL_SESSION_STORE)

    // As above: the Fake refuses a ref it never issued, and what is under test is what the host
    // handed the adapter before that refusal.
    await expect(host.resumeSession(recorded.sessionId, new RecordingSink())).rejects.toThrow()
    expect(resumedHints[0], 'the reopen carries what the launch carried').toBe(
      'workspace instructions',
    )
    await host.closeAll()
  })

  it('…and a resume that reads nothing sends nothing — no fabricated hint', async () => {
    // The paired negative. `readInstructions` returns `undefined` for a cwd that is not the
    // workspace, and the resume must pass that through rather than inventing text to fill a field
    // that now exists.
    const elsewhere = join(userData, 'some-other-repo')
    const ref = { provider: 'claude' as const, sessionId: 'th_2', cwd: elsewhere, rotation: 0 }
    const recorded = {
      sessionId: 'sess_2',
      provider: 'claude' as const,
      ref,
      cwd: elsewhere,
      status: 'idle' as const,
      approvalMode: 'ask' as const,
      profileId: 'default',
      updatedAt: Date.now(),
    }
    const { host, resumedHints } = hostWith(() => elsewhere, {
      ...NULL_SESSION_STORE,
      find: (sessionId: string) =>
        sessionId === recorded.sessionId ? (recorded as unknown as ResumableSession) : null,
    } as typeof NULL_SESSION_STORE)

    await expect(host.resumeSession(recorded.sessionId, new RecordingSink())).rejects.toThrow()
    expect(resumedHints[0]).toBeUndefined()
    await host.closeAll()
  })
})

/**
 * ⚑ **D-049 · both providers' lists for one profile**, each asked through the host's one-provider
 * read ({@link RuntimeHost.providerModels}), together. The cache these tests hold to account is per
 * provider and per profile; asking both is how they see both halves of it.
 */
const bothLists = async (
  host: RuntimeHost,
  profileId: string = DEFAULT_PROFILE_ID,
): Promise<Record<Provider, ModelCatalogue>> => {
  const [claude, codex] = await Promise.all([
    host.providerModels(profileId, 'claude'),
    host.providerModels(profileId, 'codex'),
  ])
  return { claude, codex }
}

describe('RuntimeHost — the model catalogue, asked once (058)', () => {
  let userData: string
  let host: RuntimeHost

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-models-'))
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  function build(createRuntime: (provider: Provider) => AgentRuntime): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime,
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  it('asks each provider ONCE per app run, however many surfaces ask', async () => {
    // Unlike `capabilities()` this is not free — each entry is a real provider child process — and
    // the launcher asks on every mount. Caching the PROMISE (not the value) is what makes two
    // surfaces mounting together share one probe instead of racing two.
    const asked: string[] = []
    host = build((provider) => {
      const runtime = new FakeRuntime(provider)
      return Object.assign(Object.create(runtime) as typeof runtime, {
        listModels: async (context: ProviderRuntimeContext) => {
          asked.push(provider)
          return runtime.listModels(context)
        },
      })
    })

    const [a, b] = await Promise.all([bothLists(host), bothLists(host)])
    await bothLists(host)

    expect(asked.sort()).toEqual(['claude', 'codex'])
    expect(a).toEqual(b)
    // ⚠️ **`ok: true` unwrapped rather than asserted around** (310). A `catalogue.ok === false` would
    // make every `?.` below vanish silently, so the arm is checked before anything is read from it.
    expect(a.claude.ok, 'claude answered').toBe(true)
    expect(a.codex.ok, 'codex answered').toBe(true)
    const claudeRows = a.claude.ok ? a.claude.models : []
    const codexRows = a.codex.ok ? a.codex.models : []
    expect(claudeRows.map((m) => m.id)).toEqual(['fake-claude-a', 'fake-claude-b'])
    // The provider's own note survives the trip. It is the field a menu is likeliest to drop.
    expect(claudeRows[1]?.note).toBe('Superseded by fake-claude-a.')
    // ⛔ **And the OTHER provider's answer is its own** (196, from 193 M4). This test asked both
    // providers and asserted only Claude's catalogue — against a double that returned one identical
    // list for both, so a host that gave Codex's menu Claude's models, or swapped the two answers,
    // read exactly the same. Now the two lists differ, and the assertion is that they arrived where
    // they were addressed.
    expect(codexRows.map((m) => m.id)).toEqual(['fake-codex-a', 'fake-codex-b'])
  })

  it('a provider that cannot answer says WHY, and does NOT take the other one down', async () => {
    // ⚠️ A reason, never `[]` and never a rejected command. The two are settled independently
    // because they are independent: failing the whole read because one provider is unauthenticated
    // would take the menu away from the provider that answered perfectly well. And `[]` would be the
    // provider saying "I have no models", which nothing has ever said.
    //
    // ⛔ **`refused`, and the provider's own diagnostic with it** (310). This used to assert
    // `toBeNull()` — which was also what a profile that did not exist returned, and what a quit
    // returned, so the assertion could not tell a login failure from either of them.
    host = build((provider) => {
      const runtime = new FakeRuntime(provider)
      return Object.assign(Object.create(runtime) as typeof runtime, {
        listModels: async (context: ProviderRuntimeContext) => {
          if (provider === 'codex') throw new Error('not logged in')
          return runtime.listModels(context)
        },
      })
    })

    const models = await bothLists(host)
    expect(models.codex).toEqual({ ok: false, reason: 'refused', detail: 'not logged in' })
    expect(models.claude.ok, 'the other provider answered perfectly well').toBe(true)
    expect(models.claude.ok ? models.claude.models : []).toHaveLength(2)
  })

  it('🔴 a probe the QUIT aborted says so, and does not report the provider as having refused', async () => {
    // ⛔ **The one thing 310's union made newly wrong, and it was found reviewing the diff rather
    // than by a failing test.** `askProviderForModels`' comment has said since 070 that *"a
    // cancelled probe arrives here too, and reads correctly — during a quit there is no menu
    // because there is no app"* — true while every branch returned one `null`. The moment the
    // reason crossed the boundary, an aborted probe would have told a person their provider had
    // turned them down, and offered them a sign-in for it.
    //
    // ⚠️ **The registry-refusal branch is a DIFFERENT one** (`launch === null`, a probe that never
    // started) and is already `closing`. This is the probe that started and was cut off.
    host = build((provider) => {
      const runtime = new FakeRuntime(provider)
      return Object.assign(Object.create(runtime) as typeof runtime, {
        listModels: (context: ProviderRuntimeContext) =>
          new Promise<never>((_resolve, reject) => {
            context.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      })
    })

    const asking = bothLists(host)
    // Nothing has settled: the paired positive for the assertion below, and the reason this test
    // cannot pass by accident on a probe that had already finished.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await host.closeAll()

    const models = await asking
    expect(models.claude, 'a quit, not a login failure').toEqual({ ok: false, reason: 'closing' })
    expect(models.codex).toEqual({ ok: false, reason: 'closing' })
  })
})

describe('257 · one model menu per PROFILE, because a catalogue is what a login may run', () => {
  let userData: string
  let host: RuntimeHost
  /** Every `(provider, profileId)` a probe actually prepared a home for. */
  let prepared: string[]

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-profile-models-'))
    prepared = []
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  /** Every profile this host believes exists — the list `providerModels` refuses to probe outside of. */
  const EXISTING = ['default', 'work', 'personal']

  /**
   * The credential ops, cut down to the two doors that move a catalogue.
   *
   * ⚠️ **The sign-in HOLDS until a test settles it**, like `provider-auth.test.ts`'s double and for
   * the same reason: a flow that resolved on its own would let the invalidation happen for a reason
   * the test did not cause.
   */
  const settleSignIn: { go: ((outcome: { success: boolean }) => void) | null } = { go: null }
  const auth = {
    // ⛔ **Per profile AND per provider, like the real derivation** (265 §2). This is the key the
    // host serializes its two credential writers by, and a double that answered one constant would
    // make every catalogue assertion below run under an admission that refuses everything.
    credentialHome: (provider: Provider, profileId: string) =>
      join(userData, 'provider-homes', profileId, provider),
    check: async () => ({ state: 'usable' as const }),
    reprovision: async () => 'replaced' as const,
    signIn: async () => ({
      authUrl: 'https://example.invalid/login',
      completed: new Promise<{ success: boolean; state: { state: 'usable' } }>((resolve) => {
        settleSignIn.go = () => resolve({ success: true, state: { state: 'usable' } })
      }),
      cancel: async () => {},
    }),
  }

  function build(profiles: string[] = EXISTING): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => {
        const runtime = new FakeRuntime(provider)
        return Object.assign(Object.create(runtime) as typeof runtime, {
          listModels: async (context: ProviderRuntimeContext) => runtime.listModels(context),
        })
      },
      // ⛔ The home records the PROFILE, which is the whole subject: `256` H1 found every profile's
      // launcher showing a catalogue probed in `default`'s home.
      prepareProviderHome: (provider, profileId) => {
        prepared.push(`${provider}:${profileId}`)
        return join(userData, 'provider-homes', profileId, provider)
      },
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      listProfiles: () => profiles,
      providerAuth: auth as unknown as ConstructorParameters<typeof RuntimeHost>[0]['providerAuth'],
      openExternal: async () => {},
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  it('🔴 asks in the profile it was asked about, and remembers the two answers apart', async () => {
    host = build()
    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    await bothLists(host, 'work')

    // Two profiles, two probes each; the repeat is served from the cache and spawns nothing.
    expect(prepared.sort()).toEqual([
      'claude:personal',
      'claude:work',
      'codex:personal',
      'codex:work',
    ])
  })

  it('🔴 a profile that does not exist is NOT probed — asking would create it', async () => {
    // ⛔ **The guard that makes taking a `profileId` safe at all.** `prepareProviderHome` creates the
    // home and, for Codex, copies the machine credential into it — so a launcher rendering a name
    // somebody is still typing would bring a profile into existence and provision a credential for
    // it. That is `098`'s *"asking a question wrote a credential to disk"*, arriving through the menu.
    host = build()
    // Return `no-profile` rather than bare absence for `+ New profile…`. That lets the
    // launcher explain that the list arrives once the profile exists, distinct from a refused
    // Codex catalogue.
    expect(await bothLists(host, 'a-name-being-typed')).toEqual({
      claude: { ok: false, reason: 'no-profile' },
      codex: { ok: false, reason: 'no-profile' },
    })
    expect(prepared, 'nothing was prepared, so no home and no credential were made').toEqual([])
  })

  it('⛔ a settled sign-in drops THAT profile’s menu, and leaves every other one alone', async () => {
    host = build()
    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    prepared.length = 0

    const flow = host.signInProvider('codex', 'work')
    // Settled on a microtask, so the host has reached its `await` on the browser flow first — the
    // invalidation under test happens in that call's `finally`, not before it.
    await Promise.resolve()
    settleSignIn.go?.({ success: true })
    await flow

    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    // Codex was re-asked for `work` and NOTHING else was: not Claude in the same home, and not the
    // other profile. A cache that dropped more than the credential moved would be a spawn per menu.
    expect(prepared).toEqual(['codex:work'])
  })

  it('⛔ …and a re-copied credential is the other door, with the same reach', async () => {
    host = build()
    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    prepared.length = 0

    expect(await host.reprovisionProviderAuth('codex', 'work')).toBe('replaced')

    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    expect(prepared).toEqual(['codex:work'])
  })

  it('⛔ a quit refuses the provider whose list is no longer remembered, and only that one', async () => {
    // ⚠️ **A list not yet asked would spawn a provider child, and spawning is what a quit refuses**
    // (070's refusal, re-scoped by 257 §2, one provider at a time since D-049); filling the gap
    // instead would say *"we asked and it could not answer"* about a provider nobody asked. Arranged
    // by invalidating one provider's list, which is the only way this state occurs.
    host = build()
    const work = await bothLists(host, 'work')
    const complete = await bothLists(host, 'personal')
    expect(await host.reprovisionProviderAuth('codex', 'work')).toBe('replaced')

    await host.closeAll()
    await expect(host.providerModels('work', 'codex')).rejects.toThrow(/shutting down/)
    // …while every list still remembered is handed back, because that is a value and not a process
    // — the other provider in the same profile, and the other profile whole. Both halves, or the
    // refusal is just "a quit answers nothing".
    expect(await host.providerModels('work', 'claude')).toEqual(work.claude)
    expect(await bothLists(host, 'personal')).toEqual(complete)
  })

  it('⚠️ the cache is BOUNDED, and the oldest entry is what a seventeenth ask costs', async () => {
    // ⛔ 257 §2's own warning, made a test: *"do not turn one never-invalidated promise into N
    // never-invalidated promises with no bound"*. Sixteen entries is eight profiles across both
    // providers; the ninth evicts the first, and revisiting it pays for one more short-lived child.
    const many = Array.from({ length: 9 }, (_, i) => `p${i}`)
    host = build(many)
    for (const id of many) await bothLists(host, id)
    prepared.length = 0

    await bothLists(host, 'p8')
    expect(prepared, 'the newest is still remembered').toEqual([])
    await bothLists(host, 'p0')
    expect(prepared, 'and the oldest was dropped to make room for it').toEqual([
      'claude:p0',
      'codex:p0',
    ])
  })
})

describe('RuntimeHost — a wholesale grant is disclosed the moment it is made (058)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-grants-'))
    let counter = 0
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('pushes it MID-TURN, because the next message is too late to be told', async () => {
    // ⚠️ The bug this closes. `publishStateIfChanged` was reached only from `setApprovalMode`
    // and `send`, so a grant made while answering a card would have stayed invisible until the
    // user's next message — the one moment they no longer need telling, because by then the
    // session has already stopped asking. 031's rule is that a user can see what they granted, and
    // a card scrolls away.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do a thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')
    const request = sink.find('permission_request')
    if (!request) throw new Error('no permission request')

    expect(sink.liveness.at(-1)?.approval?.blanketGrants ?? []).toEqual([])

    await host.respondPermission(
      created.sessionId,
      request.id,
      {
        outcome: 'allow_all_for_session',
      },
      sink,
    )

    // Named on the liveness channel, with no further turn and no further command. The Fake records
    // the grant faithfully — it is a conformance double, not a stub — so this is the real path.
    await waitFor(
      () => (sink.liveness.at(-1)?.approval?.blanketGrants ?? []).length > 0,
      'the grant disclosure on the liveness channel',
    )
    expect(sink.liveness.at(-1)?.approval?.blanketGrants).toEqual(['Bash'])

    // ⛔ **And the command RAN** (186, from 182 H4). This assertion did not exist, and its absence is
    // what let the double answer the widest of the three approvals with `skipped (denied)` for as
    // long as it did: a test that only checks the disclosure names the tool is green whether the
    // grant did anything or not. The disclosure is about a grant that HAPPENED — so the thing it is
    // about has to be asserted next to it.
    await waitFor(() => sink.types().includes('tool_result'), 'the tool result')
    const result = sink.find('tool_result')
    expect(result, 'a wholesale grant is an approval, not a refusal').toMatchObject({ ok: true })
  })

  it('and never asks about that tool again — the grant is standing, not a label (058)', async () => {
    // ⛔ **The other half of the same sentence, and the half nothing checked.** `permission.ts` says
    // `allow_all_for_session` means *"every future use of this tool this session, whatever its
    // arguments"*. The double recorded the grant for the header and then raised a card on the very
    // next turn, so every test above it certified a promise the double was not keeping.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do a thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')
    const first = sink.find('permission_request')
    if (!first) throw new Error('no permission request')
    await host.respondPermission(
      created.sessionId,
      first.id,
      { outcome: 'allow_all_for_session' },
      sink,
    )
    await waitFor(() => sink.types().includes('turn'), 'the first turn ending')

    const cardsBefore = sink.types().filter((type) => type === 'permission_request').length
    const turnsBefore = sink.types().filter((type) => type === 'turn').length
    await host.send(created.sessionId, 'do it again', sink)
    await waitFor(
      () => sink.types().filter((type) => type === 'turn').length > turnsBefore,
      'the second turn ending',
    )

    // The second turn ran the tool and asked nothing. Both halves: a turn that never happened would
    // satisfy the card count on its own.
    expect(sink.types().filter((type) => type === 'permission_request').length).toBe(cardsBefore)
    expect(sink.events().filter((event) => event.type === 'tool_result')).toHaveLength(2)
  })

  it('says nothing when nothing was granted wholesale', async () => {
    // The other direction, and the one that keeps the pill meaningful: its APPEARANCE is the news,
    // so an ordinary approval must not produce one. A `deny` must not either.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do a thing', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'the permission card')
    const request = sink.find('permission_request')
    if (!request) throw new Error('no permission request')

    await host.respondPermission(created.sessionId, request.id, { outcome: 'allow' }, sink)
    await waitFor(() => sink.types().includes('turn'), 'the terminal turn')
    expect(sink.liveness.at(-1)?.approval?.blanketGrants ?? []).toEqual([])
  })
})

describe('RuntimeHost — changing a setting mid-conversation (076)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  /** Every durable write, so "it was recorded" is checked rather than assumed. */
  let writes: string[]

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-live-settings-'))
    writes = []
    let counter = 0
    host = new RuntimeHost({
      store: {
        ...NULL_SESSION_STORE,
        setModel: (sessionId, model) => writes.push(`model:${sessionId}:${model ?? '(none)'}`),
        setReasoningEffort: (sessionId, effort) =>
          writes.push(`effort:${sessionId}:${effort ?? '(none)'}`),
        startPlanMode: (sessionId) => writes.push(`planOn:${sessionId}`),
        endPlanMode: (sessionId) => writes.push(`planOff:${sessionId}`),
      },
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('records the change and publishes it, so a second window is not left behind', async () => {
    // Persisting is what makes the control mean anything past a restart: a session resumed from a
    // stale row would quietly go back to the model the conversation opened with, and nothing on
    // screen would explain it. Publishing is the same argument across windows.
    const created = await host.createSession({ provider: 'claude' }, sink)
    const { settings: after } = await host.setSessionSetting(
      created.sessionId,
      {
        kind: 'model',
        model: 'haiku',
      },
      sink,
    )
    expect(writes).toEqual([`model:${created.sessionId}:haiku`])
    expect(after.pendingModel, 'the change is queued, not claimed as running').toEqual({
      value: 'haiku',
    })
    // ⚑ D-042 · what was running is R1's pair — Claude's `default`, by name — never an absence.
    expect(after.model, 'and what is RUNNING is still what was running').toBe('default')
    expect(sink.liveness.at(-1)?.settings?.pendingModel).toEqual({ value: 'haiku' })

    await host.setSessionSetting(
      created.sessionId,
      { kind: 'reasoningEffort', effort: undefined },
      sink,
    )
    // ⚑ **D-042 · "stop asking" is now "the model's own default", NAMED** (R1): `haiku` is no row
    // of the Fake's list, so it runs at Claude's default effort by name, `medium` (W4.28) — still a write,
    // and ⛔ never the absence it used to write.
    expect(writes.at(-1), '"stop asking" is a write, not a skipped one').toBe(
      `effort:${created.sessionId}:medium`,
    )
    expect(writes).not.toContain(`effort:${created.sessionId}:(none)`)
  })

  it('refuses to turn plan mode OFF as a setting — that gesture is the go-ahead (the 076 ruling)', async () => {
    // ⚠️ **And it refuses BEFORE the handle moves.** Releasing a plan without sending anything
    // leaves a conversation that has been told to stop planning and given nothing to do; recording
    // it would then be a row saying "released" for a conversation that never said so. The wire
    // schema types this `true`, so this is the belt to that schema's braces — reachable only from a
    // caller inside the main process, which is exactly where a future mistake would come from.
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    expect(created.planNeedsGoAhead).toBe(true)
    await expect(
      host.setSessionSetting(created.sessionId, { kind: 'planMode', on: false as true }, sink),
    ).rejects.toThrow(/go-ahead/)
    expect(writes, 'nothing was recorded').toEqual([])
    // ⚠️ **Asserted on the QUEUED value, not the running one**, and a mutation is what taught me the
    // difference. `settings.planMode` is what the last turn ran with, and it does not move until a
    // turn adopts a change — so a handle that had wrongly been released already would look
    // identical here. `planNeedsGoAhead` reads `requested`, so it flips the instant the phase moves:
    // it is the only reading that can tell "refused before anything moved" from "moved, then
    // refused".
    const { settings: still } = await host.setSessionSetting(
      created.sessionId,
      {
        kind: 'reasoningEffort',
        effort: 'high',
      },
      sink,
    )
    expect(still.pendingPlanMode, 'no release was queued').toBeNull()
    expect(still.planMode, 'and it is still planning').toBe(true)
    const live = sink.liveness.at(-1)
    expect(live?.plan?.planNeedsGoAhead, 'the plan still needs its go-ahead').toBe(true)
  })

  it('republishes a settings-only change, so a second window is not left behind (found in review)', async () => {
    // ⚠️ **The dedupe key excluded `settings`, and that made the whole feature invisible to every
    // window but one.** `publishStateIfChanged` keyed on `{approval, plan}`; a model or effort
    // change moves neither, so the key compared equal and the function returned before sending
    // anything. The issuing window looked correct — it patches itself from the command result — so
    // two open windows silently disagreed about what a live conversation was running.
    //
    // Asserted on the LIVENESS channel specifically, because that is the half that was broken; the
    // command result was right all along and would have hidden this.
    const created = await host.createSession({ provider: 'claude' }, sink)
    // ⚠️ **A first change is made before the measurement, and that is not ceremony.** `lastDisclosures`
    // starts unset, so the FIRST publish on a session goes out whatever the key contains — a version
    // of this test that measured from session creation passed against the bug, which a mutation
    // showed. The baseline has to be a session that has already published once.
    await host.setSessionSetting(created.sessionId, { kind: 'model', model: 'haiku' }, sink)
    expect(sink.liveness.at(-1)?.settings?.pendingModel).toEqual({ value: 'haiku' })
    const before = sink.liveness.length

    // Now a change that moves ONLY the settings — neither the approval nor the plan disclosure —
    // which is precisely what the old key could not see.
    //
    // ⚑ **D-042 · `low`, because the start already runs at `high`** (R1 names Claude's default
    // effort by name), so asking for `high` would move nothing and there would be nothing to see.
    await host.setSessionSetting(
      created.sessionId,
      { kind: 'reasoningEffort', effort: 'low' },
      sink,
    )
    expect(sink.liveness.length, 'a settings-only change is published').toBeGreaterThan(before)
    expect(sink.liveness.at(-1)?.settings?.pendingReasoningEffort).toEqual({ value: 'low' })

    // …and the dedupe still works, so this is not "publish everything always". Re-requesting the
    // same value changes nothing and must stay quiet.
    const after = sink.liveness.length
    await host.setSessionSetting(
      created.sessionId,
      { kind: 'reasoningEffort', effort: 'low' },
      sink,
    )
    expect(sink.liveness.length, 'an unchanged setting is still deduped').toBe(after)
  })

  it('turning plan mode ON is recorded as the pair a resume reads', async () => {
    // 060 wrote `plan_ended_at` and never cleared it, on the stated grounds that "a live
    // conversation has no way back into plan mode on either provider". 076 gave it one, so the pair
    // has to move back — and both columns move in ONE statement, because `plan_mode = 1` beside a
    // surviving `plan_ended_at` is "planned and released", which would have the Codex adapter assert
    // `{mode:'default'}` on a session the user has just asked to plan.
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.setSessionSetting(created.sessionId, { kind: 'planMode', on: true }, sink)
    expect(writes).toEqual([`planOn:${created.sessionId}`])
    expect(sink.liveness.at(-1)?.settings?.pendingPlanMode).toBe(true)
  })

  it('does not record a change the session refused', async () => {
    // The handle goes first and a rejection stops everything: each adapter refuses what it cannot
    // deliver, so letting the row move first would persist a change the provider never accepted —
    // and the next resume would apply it.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await expect(
      host.setSessionSetting(created.sessionId, { kind: 'planMode', on: true }, sink),
    ).resolves.toBeDefined()
    writes.length = 0
    await expect(
      host.setSessionSetting(created.sessionId, { kind: 'planMode', on: true }, sink),
    ).rejects.toThrow(/already planning/)
    expect(writes).toEqual([])
  })
})

describe('RuntimeHost — the go-ahead that releases a plan (060)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  /** Every durable write the gesture makes, so "it was recorded" is checked and not assumed. */
  let ended: { sessionId: string; at: number }[]

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-goahead-'))
    ended = []
    let counter = 0
    host = new RuntimeHost({
      store: {
        ...NULL_SESSION_STORE,
        endPlanMode: (sessionId, at) => ended.push({ sessionId, at }),
      },
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  it('ends the mode, records it, sends the message — and says so on the liveness channel', async () => {
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    // The bar is offered from the FIRST frame, before any plan document exists: the state that
    // makes it meaningful is the launch setting, not the arrival of a proposal.
    expect(created.planNeedsGoAhead).toBe(true)

    await host.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.')

    // 1 — the mode really changed, read back from the handle rather than from anything the host kept.
    await waitFor(
      () => sink.liveness.at(-1)?.plan?.planNeedsGoAhead === false,
      'the released plan on the liveness channel',
    )
    // 2 — …durably, so a resume cannot put the conversation back to proposing.
    expect(ended.map((row) => row.sessionId)).toEqual([created.sessionId])
    // 3 — …and the go-ahead is in the transcript as the message it is, not whispered to the
    //     provider behind the conversation's back — carrying the one thing that was missing until
    //     278 §1: who wrote it. ⛔ **`toEqual`, not `toMatchObject`**, and the swap is the finding:
    //     the defect was an ABSENT field, and a partial match passes over an absent field by
    //     construction, so this assertion was green for the whole life of the bug it is nearest to.
    // ⚑ **F093 · R2 — and the whole text it was handed**, which for the go-ahead is its words.
    expect(sink.events().filter((e) => e.type === 'user_turn')).toEqual([
      {
        type: 'user_turn',
        text: 'Go ahead with this plan.',
        attribution: 'app_authored',
        sent: 'Go ahead with this plan.',
      },
    ])
  })

  it('⚠️ the liveness dedupe covers the PLAN half, not just the approval half', async () => {
    // The trap this closes. `publishStateIfChanged` keys on a JSON string, and keyed on the
    // approval disclosure alone a go-ahead — which changes only the plan half — would compare equal
    // and publish nothing at all. The button would then still be on screen after being pressed,
    // in this window and in any other watching the same conversation.
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    await waitFor(() => sink.liveness.length > 0, 'an initial liveness message')
    const approvalBefore = JSON.stringify(sink.liveness.at(-1)?.approval)

    await host.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.')
    await waitFor(
      () => sink.liveness.at(-1)?.plan?.planNeedsGoAhead === false,
      'a republish carrying only a plan change',
    )
    // The approval half is byte-identical across that publish — which is exactly why a key over it
    // alone would have swallowed the message.
    expect(JSON.stringify(sink.liveness.at(-1)?.approval)).toBe(approvalBefore)
  })

  it('refuses a session that is not planning, and records nothing when it does', async () => {
    // A refusal has to leave no trace: a `plan_ended_at` on a row that never planned would have the
    // adapter assert a collaboration mode on a thread that has none, replacing its developer
    // instructions — the workspace hint. So the throw comes BEFORE the write, not after it.
    const created = await host.createSession({ provider: 'codex' }, sink)
    // The WORDING is the adapter's and it moved with 076: ending plan mode and turning plan mode off
    // became one verb, so the refusal now names the transition that was impossible instead of the
    // command that no longer exists. What is asserted below — that nothing was written and nothing
    // was said — is the behaviour, and it is unchanged.
    await expect(host.endPlanMode(created.sessionId, sink, 'go on then')).rejects.toThrow(
      /was not planning/,
    )
    expect(ended).toEqual([])
    expect(sink.events().some((e) => e.type === 'user_turn')).toBe(false)
  })

  it('⚠️ refuses BEFORE anything moves when the conversation could not take the message (060 review)', async () => {
    // The composition's failure mode. `endPlanMode` does two things and only the second can fail
    // for ordinary reasons — a turn already running, a session that has ended. Without the guard the
    // first would land, be written to the row and be announced to every window, and only then would
    // the send throw: a conversation recorded as released, its bar gone, that never said anything.
    //
    // Driven through a REAL busy session rather than a stub, because "busy" here has to mean what
    // the rest of the host means by it.
    const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
    await host.send(created.sessionId, 'plan it', sink)
    await waitFor(() => sink.types().includes('permission_request'), 'a turn to be running')

    await expect(
      host.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.'),
    ).rejects.toThrow(/still working/)
    // Nothing moved: no row written, no message sent, and the bar is still on offer.
    expect(ended).toEqual([])
    expect(sink.events().some((e) => e.type === 'user_turn' && e.text.startsWith('Go ahead'))).toBe(
      false,
    )
    expect(sink.liveness.at(-1)?.plan?.planNeedsGoAhead).toBe(true)
  })

  /**
   * The way out that is not an approval (085).
   *
   * Leaving plan mode must not imply approval of a disliked plan. Plan-off and a go-ahead
   * share a wire transition, but that does not require sending `Go ahead with this plan.`
   * with every mode change.
   */
  describe('…and the way out that is NOT an approval (085)', () => {
    it('releases the plan and says nothing at all', async () => {
      const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
      expect(sink.liveness.at(-1)?.plan?.planNeedsGoAhead, 'positive: it was planning').toBe(true)

      await host.endPlanMode(created.sessionId, sink)

      // Released, durably, by exactly the same write the go-ahead makes — one transition.
      expect(ended.map((e) => e.sessionId)).toEqual([created.sessionId])
      expect(sink.liveness.at(-1)?.plan?.planNeedsGoAhead).toBe(false)
      // And the whole difference from the go-ahead: nothing was put in the user's mouth.
      expect(sink.events().some((e) => e.type === 'user_turn')).toBe(false)
    })

    it('does NOT inherit the send guard — leaving works while a turn is running', async () => {
      // ⚠️ The asymmetry is the feature. The go-ahead's `idle` guard exists because it SENDS and the
      // send can fail; leaving has no second operation, and the mode change rides the next
      // `turn/start`, which has not happened yet. Being made to wait for a turn to finish before you
      // may stop steering it is the opposite of leaving at will.
      const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
      await host.send(created.sessionId, 'plan it', sink)
      await waitFor(() => sink.types().includes('permission_request'), 'a turn to be running')

      // Positive AND negative on the same session, in the same breath: the go-ahead is refused…
      await expect(
        host.endPlanMode(created.sessionId, sink, 'Go ahead with this plan.'),
      ).rejects.toThrow(/still working/)
      // …and leaving is not.
      await host.endPlanMode(created.sessionId, sink)
      expect(ended.map((e) => e.sessionId)).toEqual([created.sessionId])
      expect(
        sink.events().some((e) => e.type === 'user_turn' && e.text.startsWith('Go ahead')),
      ).toBe(false)
    })

    it('a conversation that is over cannot be left — there is no next turn to carry it', async () => {
      // ⚠️ Written expecting `cannot leave planning: this conversation is over` and it is NOT what
      // comes back: closing DEREGISTERS the session, so the host never reaches the status guard.
      // Pinned as measured rather than as designed. The guard still earns its place for the session
      // that terminalises itself — a fatal provider error leaves the record registered and `ended` —
      // which the Fake cannot drive from here; that path is named in the response doc, not claimed.
      const created = await host.createSession({ provider: 'codex', planMode: true }, sink)
      await host.close(created.sessionId, sink)
      await expect(host.endPlanMode(created.sessionId, sink)).rejects.toThrow(/unknown session/)
      expect(ended, 'nothing was written for a conversation that is gone').toEqual([])
    })

    it('a session that never planned refuses to be left, exactly as it refuses the go-ahead', async () => {
      const created = await host.createSession({ provider: 'codex' }, sink)
      await expect(host.endPlanMode(created.sessionId, sink)).rejects.toThrow(/was not planning/)
      expect(ended).toEqual([])
    })
  })

  it('a planning session asks for NOTHING a plain one does not (acceptance 4, host layer)', async () => {
    // ⚠️ 056's hazard, checked where this dispatch could have re-introduced it: a consent surface
    // consulted above the auto-approve early return silently stops an unattended run. The go-ahead
    // avoids that by not being one — nothing waits on it — and what that buys, seen from here, is
    // that turning plan mode on adds no request to the stream.
    //
    // ⛔ **This paragraph used to read "`FakeRuntime`'s representative turn always raises one card,
    // by design and in every mode"** — and it did, which is the contradiction 182 H4 named and 186
    // fixed. The comparison was built AROUND the double's defect: it could not assert the honest
    // thing (an unattended session asks nobody anything) because the double asked anyway, so it
    // settled for "both ask the same amount" and waited for a card yolo should never have produced.
    //
    // Both halves are asserted now, and the comparison stays: the equality is what catches a
    // consent surface added above the auto-approve return for planning sessions only, and the
    // emptiness is 056's hazard said plainly.
    const plain = new RecordingSink()
    const planning = new RecordingSink()
    const a = await host.createSession({ provider: 'codex', approvalMode: 'auto' }, plain)
    const b = await host.createSession(
      { provider: 'codex', approvalMode: 'auto', planMode: true },
      planning,
    )
    await host.send(a.sessionId, 'go', sink)
    await host.send(b.sessionId, 'plan and go', sink)
    const awaited = (s: RecordingSink): string[] =>
      s.types().filter((t) => t === 'permission_request' || t === 'user_input_request')
    // Waited on the TURN ENDING rather than on a card, which is what an unattended turn actually
    // does — and it is the positive that keeps the two negatives below from passing over nothing.
    await waitFor(() => plain.types().includes('turn'), 'the plain turn to finish')
    await waitFor(() => planning.types().includes('turn'), 'the planning turn to finish')
    expect(awaited(planning)).toEqual(awaited(plain))
    expect(awaited(plain), 'an unattended session asks nobody anything').toEqual([])
    // …and the plan is still on offer through all of it, so the affordance consumed nothing either.
    expect(planning.liveness.at(-1)?.plan?.planNeedsGoAhead).toBe(true)
  })
})

/**
 * 112 · The door to a sub-agent's own work, at the HOST level — the allowlist, the provider
 * refusal, and the promise that a read writes nothing.
 *
 * ⚠️ **`child-work.test.ts` drives the resolver, which is handed a root and trusts it.** Everything
 * that decides WHICH root, and whether the caller may ask at all, lives here — and review found the
 * gap: nothing exercised this method, so a `prepareProviderHome` that provisions directories and
 * throws on an unhealthy Keychain sat on a read path with no test to notice.
 */
describe('RuntimeHost.readChildWork (112)', () => {
  const SESSION = 'sess_child'
  const AGENT = 'a4d82f4376e9dd5c5'
  /**
   * 115 · The plain `Task` child that really is on disk here, and it is deliberately NOT `AGENT`.
   *
   * ⚠️ Every 112 test above asserts `gone` for `AGENT`, which is the honest answer for a home with
   * no file in it. Writing this fixture under that id would have turned four standing negatives
   * green for a new reason — the failure mode `083` and `095` are both about.
   */
  const PLAIN = 'ab1bcb4820e3a1c8f'

  /**
   * 115 · A REAL Codex rollout on disk, and a second one that is not ours.
   *
   * The three synthetic records match shapes `importCodexRollout` reads, verified against
   * app-created child rollouts. Their prose is authored for the test and contains no personal
   * session content.
   */
  let codexHome: string
  let claudeHome: string
  let rolloutPath: string
  let outsidePath: string

  beforeEach(() => {
    // A REAL Claude home with one plain `Task` child in it, sidecar and all — the layout measured
    // on this machine, and the only way the sidecar's contribution can be asserted end to end.
    claudeHome = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-115-claude-')))
    const subagents = join(
      childWorkRoot(claudeHome, {
        provider: 'claude',
        sessionId: 'parent-uuid',
        cwd: '/tmp/w',
      } as SessionRef),
      'subagents',
    )
    mkdirSync(subagents, { recursive: true })
    writeFileSync(
      join(subagents, `agent-${PLAIN}.jsonl`),
      `${JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        timestamp: '2026-08-10T20:43:30.000Z',
        message: {
          role: 'assistant',
          content: [
            // ⚑ **A thinking block with an EMPTY body and a signature** — measured, this is the
            // only shape these files ever contain, and `importClaudeTranscript` drops it. It is
            // here so the count the door reports has something real to count (109).
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text: 'six files, no source' },
          ],
        },
      })}\n`,
    )
    // ⚠️ **A plain Task child's sidecar, which carries what a workflow agent's does NOT** — the
    // asymmetry 115 asked to be used rather than assumed away.
    writeFileSync(
      join(subagents, `agent-${PLAIN}.meta.json`),
      JSON.stringify({
        agentType: 'Explore',
        description: 'Summarize workspace contents',
        toolUseId: 'toolu_01JDtFLW68vsGED3z4L5eYUW',
        spawnDepth: 1,
      }),
    )
    codexHome = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-115-codex-')))
    const dir = join(codexHome, 'sessions', '2026', '08', '07')
    mkdirSync(dir, { recursive: true })
    rolloutPath = join(dir, 'rollout-2026-08-07T14-17-40-019fdc5f.jsonl')
    writeFileSync(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: '2026-08-07T13:17:40.441Z',
          type: 'session_meta',
          payload: { id: '019fdc5f', cwd: '/w', source: { subagent: { thread_spawn: {} } } },
        }),
        JSON.stringify({
          timestamp: '2026-08-07T13:17:41.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Map the workspace and report back.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-08-07T13:17:44.000Z',
          type: 'response_item',
          payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Look first.' }] },
        }),
        JSON.stringify({
          timestamp: '2026-08-07T13:17:49.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'This is a rollout, not a JSONL transcript.' }],
          },
        }),
        '',
      ].join('\n'),
    )
    // Real, readable, and not under the home — the shape a provider database can genuinely name.
    outsidePath = join(realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-115-else-'))), 'r.jsonl')
    writeFileSync(outsidePath, '{"type":"session_meta","payload":{}}\n')
  })

  afterEach(() => {
    rmSync(codexHome, { recursive: true, force: true })
    rmSync(claudeHome, { recursive: true, force: true })
    rmSync(dirname(outsidePath), { recursive: true, force: true })
  })

  function hostFor(
    store: Partial<SessionStore>,
    seams: {
      onPrepare?: () => void
      onPath?: () => void
      rollout?: (provider: Provider, home: string, ref: SessionRef) => string | null
    } = {},
  ): RuntimeHost {
    return new RuntimeHost({
      store: { ...NULL_SESSION_STORE, ...store },
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: (provider, home, ref) => seams.rollout?.(provider, home, ref) ?? null,
      exportDirectory: () => '/tmp/brobot2-112-exports',
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => {
        // ⛔ The launch call. Reaching it from a READ is the defect, so the double screams rather
        // than quietly returning a path — this is exactly how the real one behaves on a machine
        // whose Claude login has gone stale (`AuthUnavailableError`), and it provisions besides.
        seams.onPrepare?.()
        throw new Error(`prepareProviderHome must not be called by a read (${provider})`)
      },
      providerHomePath: (provider, profileId) => {
        seams.onPath?.()
        // ⚠️ **Both homes are REAL directories**, because every read below must land on a real
        // file: a home that does not exist answers `gone`, and every assertion below would pass for
        // the wrong reason. (`726` · R92: there is no containment check behind it any more.)
        // `profileId` is unused now and kept in the signature because it is the seam's real shape.
        void profileId
        return provider === 'codex' ? codexHome : claudeHome
      },
      resolveCwd: (sessionId) => `/tmp/brobot2-112-cwd/${sessionId}`,
      newSessionId: () => SESSION,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'x',
        authNote: null,
        files: [],
      }),
    })
  }

  const claudeRow = (over: Partial<ResumableSession> = {}): ResumableSession =>
    ({
      sessionId: SESSION,
      provider: 'claude',
      ref: { provider: 'claude', sessionId: 'parent-uuid', cwd: '/tmp/w', rotation: 0 },
      cwd: '/tmp/w',
      status: 'idle',
      approvalMode: 'ask',
      profileId: 'default',
      reasoningEffort: null,
      model: null,
      planMode: null,
      planEndedAt: null,
      adoptedAt: null,
      hasTranscript: true,
      createdAt: 1,
      updatedAt: 2,
      ...over,
    }) as ResumableSession

  /** The same row, for the provider whose children are threads with rollouts of their own (115). */
  const codexRow = (over: Partial<ResumableSession> = {}): ResumableSession =>
    claudeRow({
      provider: 'codex',
      ref: { provider: 'codex', sessionId: 'parent-thread', cwd: '/tmp/w', rotation: 0 },
      ...over,
    })

  it('⛔ an agent this session never reported is refused, and no directory is looked at', () => {
    let asked = 0
    const host = hostFor(
      { find: () => claudeRow(), workflowAgentTask: () => null },
      { onPath: () => (asked += 1) },
    )
    expect(
      host.readChildWork(SESSION, { part: 'transcript', agentId: 'a0000000000000000' }),
    ).toEqual({ ok: false, reason: 'unknown-agent', rowsUnread: 0 })
    // …and the paired positive: an agent the ledger DOES know gets as far as the filesystem.
    const known = hostFor({ find: () => claudeRow(), workflowAgentTask: () => 'waw6gpzzj' })
    expect(known.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })).toEqual({
      ok: false,
      reason: 'gone',
      rowsUnread: 0,
    })
    expect(asked, 'a home was resolved for an agent that is not ours').toBe(0)
  })

  it('⛔ a READ never calls the provisioning path — it would write, and it can throw', () => {
    // 112 review, HIGH. `prepareProviderHome` mkdirs the home and, for Claude, probes the machine
    // Keychain and throws `AuthUnavailableError` when the login is unhealthy. Opening a finished
    // child's transcript must do neither. The double above throws if it is reached at all.
    let paths = 0
    const host = hostFor(
      { find: () => claudeRow(), workflowAgentTask: () => 'waw6gpzzj' },
      { onPath: () => (paths += 1) },
    )
    expect(() => host.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })).not.toThrow()
    expect(paths, 'the pure path seam was not the one used').toBe(1)
  })

  /**
   * 115 · **The other children** — the half `112` named in its own §9 and did not build.
   *
   * A transcript reader, parser, and file do not make a child card openable if the host
   * allowlist contains only `workflow_run` members. Ordinary Task and Codex children are not
   * workflow roster entries and still need access.
   */
  describe('the children that are in no run (115)', () => {
    const THREAD = '019fdc5f-4aa4-7af0-9ce0-00a9f1541da1'

    it('a plain Task child the ledger announced opens, and belongs to no run', () => {
      // ⛔ **`workflowAgentTask` says null and that is correct** — this child is in no workflow. The
      // door opens on the `sub_agent` event instead, which is the whole of 115's first half.
      const host = hostFor({
        find: () => claudeRow(),
        workflowAgentTask: () => null,
        reportedSubAgent: () => true,
      })
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: PLAIN })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      expect(read.name).toBe(`agent-${PLAIN}.jsonl`)
      // ⛔ In no run and under no task, and neither is invented to fill the shape.
      expect(read.runId).toBeNull()
      expect(read.taskId).toBeNull()
      expect(read.entries?.map((event) => event.type)).toEqual(['assistant_message'])
      // ⚑ **What only the sidecar knew** (115): a plain Task child's `.meta.json` carries a
      // description and the tool-use that dispatched it, and a workflow agent's carries neither.
      expect(read.title).toBe('Summarize workspace contents')
      expect(read.parentToolCallId).toBe('toolu_01JDtFLW68vsGED3z4L5eYUW')
      // ⚑ **The POSITIVE half of 109's asymmetry, and review found it missing entirely.** The
      // Codex case below asserts `thinkingBlocks` is undefined; without this, deleting the count
      // from the Claude branch would have left both sides green and the whole distinction empty.
      // The file holds one thinking block, the importer dropped it (see `entries` above), and the
      // count is the only reason the viewer can say it was there.
      expect(read.thinkingBlocks).toBe(1)
    })

    it('⚠️ a workflow child gets no invented description — the sidecars are NOT the same shape', () => {
      // The paired negative for the two fields above, and the reason they are optional at all.
      // Measured: a workflow agent's sidecar is `{"agentType":"workflow-subagent","spawnDepth":1}`.
      const runDir = join(
        childWorkRoot(claudeHome, {
          provider: 'claude',
          sessionId: 'parent-uuid',
          cwd: '/tmp/w',
        } as SessionRef),
        'subagents',
        'workflows',
        'wf_7658bea5-b25',
      )
      mkdirSync(runDir, { recursive: true })
      writeFileSync(
        join(runDir, `agent-${AGENT}.jsonl`),
        `${JSON.stringify({ type: 'summary' })}\n`,
      )
      writeFileSync(
        join(runDir, `agent-${AGENT}.meta.json`),
        JSON.stringify({ agentType: 'workflow-subagent', spawnDepth: 1 }),
      )
      const host = hostFor({ find: () => claudeRow(), workflowAgentTask: () => 'waw6gpzzj' })
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      expect(read.title).toBeUndefined()
      expect(read.parentToolCallId).toBeUndefined()
      // …and the paired positive, so the two absences are not about a read that failed: this child
      // IS in a run, and says which.
      expect(read.runId).toBe('wf_7658bea5-b25')
      expect(read.taskId).toBe('waw6gpzzj')
    })

    it('⛔ and an agent NEITHER lookup knows is still refused with no directory touched', () => {
      let paths = 0
      const host = hostFor(
        {
          find: () => claudeRow(),
          workflowAgentTask: () => null,
          reportedSubAgent: () => false,
        },
        { onPath: () => (paths += 1) },
      )
      expect(host.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })).toEqual({
        ok: false,
        reason: 'unknown-agent',
        rowsUnread: 0,
      })
      expect(paths, 'a home was resolved for an agent that is not ours').toBe(0)
    })

    it('a Codex child opens its own rollout, parsed as a rollout', () => {
      const asked: { provider: Provider; home: string; ref: SessionRef }[] = []
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        {
          rollout: (provider, home, ref) => {
            asked.push({ provider, home, ref })
            return rolloutPath
          },
        },
      )
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      // ⚠️ **Parsed by `importCodexRollout`, and the assertion is a fact only that parser produces.**
      // A rollout's user turn lives at `payload.type = 'user_message'` inside a `response_item`;
      // `importClaudeTranscript` reads none of that and would yield an empty transcript.
      expect(read.entries?.map((event) => event.type)).toEqual([
        'user_turn',
        'thinking',
        'assistant_message',
      ])
      expect(
        read.entries?.some((event) => JSON.stringify(event).includes('rollout, not a JSONL')),
      ).toBe(true)
      expect(read.name).toBe('rollout-2026-08-07T14-17-40-019fdc5f.jsonl')
      // ⛔ No run and no task: a thread belongs to neither, and neither is invented.
      expect(read.runId).toBeNull()
      expect(read.taskId).toBeNull()
      // ⛔ **No thinking COUNT** (109's asymmetry): `countThinkingBlocks` measures a Claude record
      // shape a rollout does not have, so running it would report `0` about a provider that was
      // never asked. Absent means "not said".
      expect(read.thinkingBlocks).toBeUndefined()
      // The lookup is by THREAD id, in the Codex home, through the seam that copies before reading.
      expect(asked).toEqual([
        {
          provider: 'codex',
          home: codexHome,
          ref: { provider: 'codex', sessionId: THREAD, cwd: '/tmp/w', rotation: 0 },
        },
      ])
    })

    it('⛔ a Codex child this session never announced is refused before the state DB is opened', () => {
      let lookups = 0
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => false },
        {
          rollout: () => {
            lookups += 1
            return rolloutPath
          },
        },
      )
      expect(host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toEqual({
        ok: false,
        reason: 'unknown-agent',
        rowsUnread: 0,
      })
      expect(lookups, "another thread's rollout was looked up").toBe(0)
    })

    it('🔴 726 · R92 — a rollout the provider’s index names OUTSIDE the home opens', () => {
      // ⛔ On `main` this was refused (`not-readable`: a rollout had to lie under the home's
      // `sessions/` or `archived_sessions/`).
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => outsidePath },
      )
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      expect(read.name).toBe('r.jsonl')
      // ⚑ The control, beside it: a rollout the index names that is not on disk is still `gone`.
      const missing = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => join(dirname(outsidePath), 'never-written.jsonl') },
      )
      expect(missing.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toEqual({
        ok: false,
        reason: 'gone',
        rowsUnread: 0,
      })
    })

    it('🔴 731 · a rollout path the index names is read whatever its type — `auth.json` included', () => {
      // ⛔ On `main` both were refused `not-readable` by a `.jsonl` allow-list (115 review, HIGH) that
      // *"refuses nothing real"* and existed to refuse `auth.json` — since `726`'s review asked of
      // where a `.jsonl` NAME lands, too. The PM, ruling on `726` §9: *"A type allow-list whose
      // purpose is keeping credentials out goes."* ⚠️ Planted text in a scratch home, never a
      // credential.
      const auth = join(codexHome, 'auth.json')
      writeFileSync(auth, '{"OPENAI_API_KEY":"sk-not-a-real-key"}\n')
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => auth },
      )
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })
      expect(read).toMatchObject({ ok: true, name: 'auth.json' })

      // …and a `.jsonl` NAME that lands on it is read where it lands.
      const disguised = join(codexHome, 'sessions', 'rollout-disguised.jsonl')
      mkdirSync(dirname(disguised), { recursive: true })
      symlinkSync(auth, disguised)
      const linked = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => disguised },
      )
      expect(linked.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toMatchObject({
        ok: true,
        name: 'auth.json',
      })

      // ⚑ The paired positive: the real rollout, in the same home, still opens.
      const good = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => rolloutPath },
      )
      expect(good.readChildWork(SESSION, { part: 'transcript', agentId: THREAD }).ok).toBe(true)
    })

    it('⚠️ a SYMLINKED child is named by where it lands, and described by the sidecar there', () => {
      // The other half of the sidecar fix. `readChildWork` names a followed link by its TARGET —
      // `child-work.test.ts` pins that — so a sidecar looked up beside the LINK would make the
      // header name one file and describe another, and silently lose the description of every
      // followed child. Mutation N survived until this existed.
      const subagents = join(
        childWorkRoot(claudeHome, {
          provider: 'claude',
          sessionId: 'parent-uuid',
          cwd: '/tmp/w',
        } as SessionRef),
        'subagents',
      )
      const link = 'a6666666666666666'
      symlinkSync(join(subagents, `agent-${PLAIN}.jsonl`), join(subagents, `agent-${link}.jsonl`))
      const host = hostFor({
        find: () => claudeRow(),
        workflowAgentTask: () => null,
        reportedSubAgent: () => true,
      })
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: link })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      // Named by the landing…
      expect(read.name).toBe(`agent-${PLAIN}.jsonl`)
      // …and described by the sidecar that sits beside the landing, which is the same file.
      expect(read.title).toBe('Summarize workspace contents')
    })

    it('🔴 731 · a BINARY the index names is refused, `.jsonl` or not — it cannot be drawn as text', () => {
      // ⛔ On `main` a binary named `.jsonl` passed the allow-list and was read as a rollout.
      const binary = join(codexHome, 'sessions', 'rollout-binary.jsonl')
      writeFileSync(binary, Buffer.from([0x7b, 0x00, 0x7d, 0x0a]))
      const refused = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => binary },
      )
      expect(refused.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toEqual({
        ok: false,
        reason: 'not-readable',
        rowsUnread: 0,
      })
    })

    it('⚑ THE CONTROL — an image the index names is not drawn as text, on either tree', () => {
      const png = join(codexHome, 'sessions', 'picture.png')
      writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => png },
      )
      expect(host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toEqual({
        ok: false,
        reason: 'not-readable',
        rowsUnread: 0,
      })
    })

    it('🔴 731 · a `.toml` the index names is read as text too — no extension is asked', () => {
      // ⛔ On `main` this was refused `not-readable`: the extension allowlist `workflow-output.ts`
      // had, which `731` removed from both doors.
      const planted = join(codexHome, 'sessions', 'config.toml')
      writeFileSync(planted, 'model_reasoning_effort = "low"\n')
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => planted },
      )
      expect(host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toMatchObject({
        ok: true,
        name: 'config.toml',
        text: 'model_reasoning_effort = "low"\n',
      })
    })

    it('a Codex child has no journal and no SCRIPT, and says which of those it is', () => {
      // ⚠️ `unsupported` is not `unknown-agent`: the run is perfectly well known — a thread simply
      // is not one, so these two artefacts do not exist rather than being unread.
      //
      // ⚠️ **BOTH parts are asked for.** Review caught the first version requesting only the
      // journal, which a narrowing to `input.part === 'journal'` would have survived — and a Codex
      // script would then have fallen through to `unknown-agent`, the exact sentence this test's
      // own name says must not be given.
      const host = hostFor({
        find: () => codexRow(),
        reportedSubAgent: () => true,
        workflowAgentIds: () => [AGENT],
      })
      for (const part of ['journal', 'script'] as const) {
        expect(host.readChildWork(SESSION, { part, taskId: 'waw6gpzzj' }), part).toEqual({
          ok: false,
          reason: 'unsupported',
          rowsUnread: 0,
        })
      }
    })

    it('⛔ …but a run this session never recorded is `unknown-agent`, not a claim about threads', () => {
      // ⚠️ **The ledger answers first, and review found this the wrong way round.** With the shape
      // check above the allowlist, the door said "a thread has no journal" about a task id it had
      // never heard of — a confident statement concerning a run we do not know.
      const host = hostFor({
        find: () => codexRow(),
        reportedSubAgent: () => true,
        workflowAgentIds: () => [],
      })
      expect(host.readChildWork(SESSION, { part: 'journal', taskId: 'never-seen' })).toEqual({
        ok: false,
        reason: 'unknown-agent',
        rowsUnread: 0,
      })
    })
  })

  it("a row from BEFORE profiles existed reads our own home, not the user's", () => {
    // ⚠️ Review, MEDIUM. "Found in the user's own home" is `adoptedAt !== null && profileId ===
    // null`; `profileId === null` alone is a row that predates profiles and really ran in `default`.
    // Reading the second as the first sent every one of those to `~/.claude`, where the child is
    // not — `gone` for a transcript that is on disk.
    const asked: string[] = []
    const host = hostFor({
      find: () => claudeRow({ profileId: null }),
      workflowAgentTask: () => 't',
    })
    const spy = hostFor(
      { find: () => claudeRow({ profileId: null }), workflowAgentTask: () => 't' },
      { onPath: () => asked.push('ours') },
    )
    expect(host.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })).toEqual({
      ok: false,
      reason: 'gone',
      rowsUnread: 0,
    })
    spy.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })
    expect(asked, 'an un-adopted row was sent to the user’s own home').toEqual(['ours'])
  })

  it('a journal is addressed by the RUN, and an unknown run is refused', () => {
    const host = hostFor({ find: () => claudeRow(), workflowAgentIds: () => [] })
    expect(host.readChildWork(SESSION, { part: 'journal', taskId: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown-agent',
      rowsUnread: 0,
    })
    // …and the paired positive: a run whose agents the ledger knows gets to the filesystem, where
    // `gone` is the honest answer for a directory that is not there.
    const known = hostFor({ find: () => claudeRow(), workflowAgentIds: () => [AGENT] })
    expect(known.readChildWork(SESSION, { part: 'journal', taskId: 'waw6gpzzj' })).toEqual({
      ok: false,
      reason: 'gone',
      rowsUnread: 0,
    })
  })
})
