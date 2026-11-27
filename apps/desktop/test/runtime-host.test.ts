import { neutralHostDeps, RecordingSink } from './lib/host-fixture'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type AgentRuntime,
  type RuntimeEvent,
  type SessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import { FakeRuntime } from '@brobot2/runtime/testing'
import type { SessionRef } from '@brobot2/runtime'
import type { Provider, SessionStatus } from '@brobot2/shared'
import {
  NULL_SESSION_STORE,
  type ResumableSession,
  type SessionStore,
} from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { NOTHING_TO_SEND } from '../src/shared/runtime-ipc'
import type { CreateSessionInput } from '../src/shared/runtime-ipc'
import { waitFor } from './lib/runtime-host-sink-fixture'

/**
 * The host, driven end to end against `FakeRuntime` — the conformance double that
 * behaves like the real adapters at the lifecycle layers the host depends on
 * (session machine, request broker, close barrier). No provider is launched.
 */

describe('RuntimeHost', () => {
  let userData: string
  let homes: string[]
  let host: RuntimeHost
  let sink: RecordingSink

  function buildHost(overrides: Partial<ConstructorParameters<typeof RuntimeHost>[0]> = {}) {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
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
      resolveCwd: (profileId, requested) => requested ?? join(userData, 'scratch', profileId),
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
    expect(created.cwd).toBe(join(userData, 'scratch', 'brobot'))
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
    sink = new RecordingSink('webContents:1')
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
    sink = new RecordingSink('webContents:1')
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
      ...neutralHostDeps(() => userData),
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
      ...neutralHostDeps(() => userData),
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
      ...neutralHostDeps(() => userData),
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
      ...neutralHostDeps(() => userData),
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
      ...neutralHostDeps(() => userData),
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
    await expect(
      host.stopBackgroundWork(created.sessionId, 'b6uoyo82k', { ownerId: 'agent:sess_peer' }),
    ).resolves.toBe(true)
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
      compact: async () => ({ compacted: true as const }),
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
      compact: async () => ({ compacted: true as const }),
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
  let holdFirst: boolean

  beforeEach(() => {
    let counter = 0
    holdFirst = false
    sink = new RecordingSink()
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) =>
        new (class extends FakeRuntime {
          override async start(options: StartOptions) {
            const handle = await super.start(options)
            if (holdFirst) handle.holdNextTurn()
            return handle
          }
        })(provider),
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
    holdFirst = true
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'first', sink)
    await waitFor(() => sink.types().includes('user_turn'), 'the first turn to be recorded')

    // A plain send here does not start a turn — that is the trap the user was in. ⚠️ **It was
    // REFUSED until 670**, with the adapter's sentence; since 670 a send that loses to a running
    // turn is HELD, so it waits behind ordinary work, and interrupting is still the only
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

    await host.sendInterrupting(created.sessionId, 'second', { ownerId: 'agent:sess_peer' })

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
      ...neutralHostDeps(() => userData),
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
    expect(created.approvalNote).toBe('approvals: Ask')
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
    // The approved panel wording is Ask/Auto; provider behaviour and sandbox claims stay the same.
    expect(created.approvalNote).toContain('Auto')
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
    expect(created.approvalNote).toContain('Auto')
    expect(created.approvalNote).not.toContain('AUTO')
    expect(created.approvalNote).not.toContain('sandbox')
    await host.closeAll()
  })

  it('an ASK session says so — the mode is never invisible (082)', async () => {
    const { host } = yoloHost()
    for (const provider of ['claude', 'codex'] as Provider[]) {
      const created = await host.createSession({ provider }, new RecordingSink())
      expect(created.approvalNote, provider).toBe('approvals: Ask')
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
    expect(disclosure.approvalNote).toBe('approvals: Ask · Auto from your next message')
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
      approvalNote: 'approvals: Ask · Auto from your next message',
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

    await expect(host.setApprovalMode(created.sessionId, 'auto', sink)).rejects.toThrow(
      /could not save/,
    )

    const notices = sink.messages.filter((m) => m.event.type === 'error')
    expect(notices.length, 'reported by the command itself, not by the next turn').toBe(before + 1)
    const notice = notices.at(-1)?.event
    expect(notice).toMatchObject({ fatal: false })
    expect(notice && 'message' in notice ? notice.message : '').toMatch(/could not save/)
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
      ...neutralHostDeps(() => userData),
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
      ...neutralHostDeps(() => userData),
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
