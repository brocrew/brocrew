import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeError, type RuntimeEvent, type SessionHandle } from '../src/index'
import { CodexRuntime } from '../src/codex'
import {
  completedTurn,
  malformedThreadStartResponse,
  threadStartResponse,
  threadStartResponseWithoutCwd,
  turnCompletedNotification,
  turnStartedNotification,
} from './fixtures/codex-protocol'
import {
  EVERY_THREAD_OVERLAY,
  FakeTransport,
  adopt,
  collect,
  firstOfType,
  has,
  okThread,
  startCodex,
} from './helpers/fake-codex-transport'

it.each(['handshake', 'callback'] as const)(
  'fresh allocation is owned before a failed %s and retains its unsettled exit witness',
  async (failure) => {
    const transport = new FakeTransport()
    const die = transport.ownsAProcess()
    transport.onRequest('initialize', () => {
      throw new Error('fictional handshake failure')
    })
    const runtime = new CodexRuntime(adopt(transport))
    let allocated: SessionHandle | undefined
    await expect(
      runtime.start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
        onSessionCreated(handle) {
          allocated = handle
          expect(transport.requests).toEqual([])
          if (failure === 'callback') throw new Error('fictional callback failure')
        },
      }),
    ).rejects.toThrow(`fictional ${failure} failure`)
    expect(allocated).toBeDefined()
    expect(transport.closeCount).toBe(1)
    let exited = false
    const witness = allocated!.awaitProcessExit!()!.then(() => {
      exited = true
    })
    await Promise.resolve()
    expect(exited).toBe(false)
    die()
    await witness
    expect(exited).toBe(true)
  },
)

describe('CodexRuntime — handshake & message flow', () => {
  it('start does initialize/initialized/thread/start (prompting profile) and exposes the ref', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    expect(handle.ref).toEqual({ provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 })
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(firstOfType(events, 'session').state).toBe('started')

    const start = transport.requests.find((r) => r.method === 'thread/start')
    // ⚑ 736 · R96 — the prompting profile's sandbox is the Codex CLI's default preset now.
    expect(start?.params).toMatchObject({
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    })

    await handle.close()
    await consumer
  })

  it('send issues turn/start; turn/completed → turn+idle, never session:ended; close emits one session:ended', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    await handle.send('hi')
    expect(transport.requests.some((r) => r.method === 'turn/start')).toBe(true)

    // The turn/start RESPONSE already bound tn_1 (037); these notifications carry the real
    // threadId+turnId so the turn-scoped content is honored (a mismatched one is ignored).
    transport.notification('turn/started', turnStartedNotification('th_1', 'tn_1'))
    transport.notification('item/agentMessage/delta', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'm1',
      delta: 'hey',
    })
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: 'tn_1',
      item: { type: 'agentMessage', id: 'm1', text: 'hey' },
    })
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    // The streamed content was attributed to the current turn (bound from the response).
    expect(events.some((e) => e.type === 'assistant_delta' && e.text === 'hey')).toBe(true)
    expect(events.some((e) => e.type === 'assistant_message' && e.text === 'hey')).toBe(true)
    expect(events.some((e) => e.type === 'session' && e.state === 'ended')).toBe(false)

    await handle.close()
    await consumer
    expect(events.filter((e) => e.type === 'session' && e.state === 'ended')).toHaveLength(1)
    expect(handle.status()).toBe('ended')
  })

  it('⛔ 662 · a stamp changes nothing on the Codex wire — `turn/start` is identical with and without one', async () => {
    // ⚑ `CODEX_CAPABILITIES.turnProvenance` is `absent` because the pinned protocol has no field
    // for it, and this is that entry's other half: the adapter drops the argument rather than
    // inventing a place for it. Measured against a bare send in a second session, because a stamp
    // that reached any field would make the two requests differ.
    const bare = await startCodex()
    await bare.handle.send('hi')
    const stamped = await startCodex()
    await stamped.handle.send('hi', { kind: 'peer', from: 'sess_pm', name: 'Ada' })
    const turnStart = (transport: FakeTransport): unknown =>
      transport.requests.find((request) => request.method === 'turn/start')?.params
    expect(turnStart(stamped.transport), 'the stamped send did reach the wire').toBeDefined()
    expect(turnStart(stamped.transport)).toStrictEqual(turnStart(bare.transport))
    for (const one of [bare, stamped]) {
      await one.handle.close()
      await one.consumer
    }
  })

  it('⛔ the HANDLE carries the rate-limit watch — the wiring, not the class (188 §2)', async () => {
    // ⚑ **This test exists because its mutation row came back GREEN.** `RateLimitWatch` had six
    // tests of its own and nothing asserted that production passes one, so removing
    // `this.rateLimits` from the `normalizeNotification` call — the whole fix, from the user's side
    // — changed no colour anywhere. A class with tests and a call site without them is exactly the
    // vacuity 182 §4 asked for.
    const { transport, handle, events, consumer } = await startCodex()
    const frame = {
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: 4_000_000_000 },
        secondary: null,
      },
    }
    transport.notification('account/rateLimits/updated', frame)
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.message.includes('95%')))
    // The same frame again. Per-frame, this is a second identical transcript warning; through the
    // session's own watch it is a repetition with nothing new in it.
    transport.notification('account/rateLimits/updated', frame)
    // …and a frame that DOES change the state, so the wait below cannot pass on the first one and
    // the assertion is not just "nothing arrived yet".
    transport.notification('account/rateLimits/updated', {
      rateLimits: {
        ...frame.rateLimits,
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 4_000_000_000 },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.message.includes('99%')))

    const warnings = events.filter((e) => e.type === 'error' && e.message.includes('rate limit'))
    expect(warnings.map((e) => (e.type === 'error' ? e.message : '')).join(' | ')).toContain('95%')
    expect(warnings, 'three frames, two states, two lines').toHaveLength(2)

    await handle.close()
    await consumer
  })

  it('unmapped notification → unknown card', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    transport.notification('some/future', { x: 1 })
    await vi.waitFor(has(events, (e) => e.type === 'unknown'))
    await handle.close()
    await consumer
  })

  /**
   * ⛔ **§2's choice, from the wire and from the user's side** (201). `RateLimitWatch.seed` has its
   * own tests; this is the wiring, and 188's own lesson is that a class with tests and a call site
   * without them is a fix that changes no colour when it is deleted.
   */
  describe('the rate-limit baseline (201 §2)', () => {
    /** The read as the pinned binary really answers it — two buckets, the main one at a wall. */
    const AT_THE_WALL = {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 4_000_000_000 },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      individualLimit: null,
      spendControlReached: false,
      planType: 'prolite',
      rateLimitReachedType: 'rate_limit_reached',
    }
    const RESPONSE = {
      rateLimits: AT_THE_WALL,
      rateLimitsByLimitId: {
        codex: AT_THE_WALL,
        codex_bengalfox: {
          limitId: 'codex_bengalfox',
          limitName: 'GPT-5.3-Codex-Spark',
          primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 4_100_000_000 },
          secondary: null,
        },
      },
      rateLimitResetCredits: { availableCount: 0, credits: [] },
    }

    it('⛔ the handle ASKS, and a user already at the wall hears about it before any frame', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      transport.onRequest('account/rateLimits/read', () => RESPONSE)
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)

      await vi.waitFor(has(events, (e) => e.type === 'error' && e.message.includes('rate-limited')))
      // ⛔ It really was a REQUEST, not a frame we happened to receive. Exactly one, per handle.
      expect(transport.requests.filter((r) => r.method === 'account/rateLimits/read')).toHaveLength(
        1,
      )
      // ⚑ …and the answer is carried whole, as chatter, so a debug reader can tell "the account is
      // fine" from "we never asked" (200 §8's first open item, on this dispatch's surface).
      const record = events.find(
        (e) => e.type === 'unknown' && e.label === 'account/rateLimits/read',
      )
      expect(record?.type === 'unknown' ? record.category : null).toBe('lifecycle')
      expect(record?.type === 'unknown' ? record.raw : null).toMatchObject({
        method: 'account/rateLimits/read',
        result: { rateLimits: { rateLimitReachedType: 'rate_limit_reached' } },
      })

      // ⛔ **The sequence 192 H1 §1 describes, end to end.** The sparse frame that used to be the
      // first thing this session ever heard now merges into a real snapshot, so it cannot downgrade
      // a wall the provider never withdrew.
      transport.notification('account/rateLimits/updated', {
        rateLimits: {
          primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: 4_000_000_000 },
        },
      })
      transport.notification('some/future', { marker: 1 })
      await vi.waitFor(has(events, (e) => e.type === 'unknown' && e.label === 'some/future'))
      expect(
        events.filter((e) => e.type === 'error' && e.message.includes('approaching')),
        'nothing weaker than the wall was ever said',
      ).toEqual([])

      await handle.close()
      await consumer
    })

    it('provider follow-ups 1 · a read that says ordinary usage is NOT allowed is asked again before the next turn, never inferred', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      let reads = 0
      transport.onRequest('account/rateLimits/read', () => {
        reads += 1
        // The first read says "not allowed"; the second, before the turn, says it is again.
        return { ...RESPONSE, ordinaryUsageAllowed: reads === 1 ? false : true }
      })
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      await vi.waitFor(() => expect(reads).toBe(1))
      await handle.send('go')
      // ⛔ No reset time decides it: the provider is asked again, once, as the turn starts.
      await vi.waitFor(() => expect(reads).toBe(2))
      await handle.close()
      await consumer

      // ⚑ The paired negative: a read that said nothing about it is not re-asked.
      const quiet = new FakeTransport()
      quiet.onRequest('thread/start', () => okThread('th_2'))
      let quietReads = 0
      quiet.onRequest('account/rateLimits/read', () => {
        quietReads += 1
        return RESPONSE
      })
      const other = await new CodexRuntime(adopt(quiet)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      await vi.waitFor(() => expect(quietReads).toBe(1))
      await other.send('go')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(quietReads).toBe(1)
      await other.close()
    })

    it('⚠️ a baseline that cannot be fetched says so, and the session is unharmed', async () => {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      transport.failRequest('account/rateLimits/read')
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)

      await vi.waitFor(
        has(events, (e) => e.type === 'unknown' && e.label === 'account/rateLimits/read'),
      )
      const record = firstOfType(events, 'unknown')
      expect(record.raw).toMatchObject({ method: 'account/rateLimits/read' })
      expect(JSON.stringify(record.raw)).toContain('failed')
      // ⛔ A baseline is a nicety; the conversation is not. Nothing about the failure is fatal, and
      // the session goes on to run a turn.
      expect(events.some((e) => e.type === 'session' && e.state === 'ended')).toBe(false)
      await handle.send('go')
      await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))

      await handle.close()
      await consumer
    })
  })
})

describe('CodexRuntime — honest resume', () => {
  it('resume → thread/resume; a MATCHING response emits session resumed and exposes the ref', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_x'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.resume(
      { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 3 },
      { providerHome: '/tmp/x/home' },
    )
    expect(handle.ref).not.toBeNull()
    expect(handle.ref?.sessionId).toBe('th_x')
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(firstOfType(events, 'session').state).toBe('resumed')
    await handle.close()
    await consumer
  })

  it('resume of a missing thread → ResumeError (no silent fresh thread)', async () => {
    const transport = new FakeTransport()
    transport.failRequest('thread/resume')
    const runtime = new CodexRuntime(adopt(transport))
    const resuming = runtime.resume(
      { provider: 'codex', sessionId: 'gone', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    await expect(resuming).rejects.toBeInstanceOf(ResumeError)
    // ⚑ **673 · the lost-thread arm stays a `ResumeError`, and now says what it wrapped** — the other
    // half of `663` F6, measured beside the sign-in arm above.
    const lost = await resuming.catch((error: unknown) => error)
    // ⚠️ The transport's OWN error, not merely an error: `cause` is what was wrapped.
    expect((lost as Error).cause).toMatchObject({ message: 'transport: thread/resume failed' })
    // ⚑ **706 · this double's failure is a TRANSPORT's, not the app-server's answer** — so it is not
    // read as a thread that is gone. What Codex really answers for a missing thread, measured, and
    // what the adapter makes of it: `a-session-the-provider-no-longer-has.test.ts`.
    expect((lost as ResumeError).noSuchSession).toBe(false)
  })

  it('resume: malformed thread/resume ({}) → ResumeError, does not echo the requested id', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => malformedThreadStartResponse) // named: no thread at all
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume: returned thread.id differs from requested → ResumeError', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => threadStartResponse('th_OTHER', '/tmp/x'))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume: returned cwd differs from requested → ResumeError', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => threadStartResponse('th_x', '/tmp/OTHER'))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume: response omits cwd → ResumeError (cwd must be proven, not echoed)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => threadStartResponseWithoutCwd('th_x')) // matching id, no cwd
    const runtime = new CodexRuntime(adopt(transport))
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume with a wrong-provider ref → ResumeError', async () => {
    const runtime = new CodexRuntime(() => new FakeTransport())
    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 'x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })
})

describe('CodexRuntime — close/fatal barrier (028 P1-A)', () => {
  it('a fatal stream loss reaps the transport from the errored state; a later close() still completes', async () => {
    const { transport, handle, events, consumer } = await startCodex()
    expect(transport.closeCount).toBe(0)
    transport.endIncoming() // the app-server stream ends WITHOUT an explicit transport.close()
    await consumer // finishUnexpected: fatalError + reap the transport
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    expect(transport.closeCount).toBeGreaterThan(0) // reaped from the errored state (pre-fix: 0)
    await handle.close() // a later close still resolves (memoized errored-state branch)
  })

  it('a tracked handler that throws "write after terminal" does not surface an unhandled rejection', async () => {
    const rejections: unknown[] = []
    const onRej = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onRej)
    try {
      const transport = new FakeTransport()
      transport.onRequest('thread/start', () => okThread('th_1'))
      const runtime = new CodexRuntime(adopt(transport))
      const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      await handle.send('go') // an approval only exists inside a live turn (061)
      // Open a permission — its handler is now tracked, awaiting the broker.
      transport.serverRequest(90, 'item/commandExecution/requestApproval', { command: 'x' })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      // On close the settled handler resolves and calls respond → which now THROWS
      // (transport terminal). The tracked-handler rejection must be swallowed.
      transport.throwOnRespond = true
      await handle.close()
      await consumer
      await new Promise((r) => setTimeout(r, 40)) // let any unhandled rejection surface
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRej)
    }
  })
})

/**
 * 🔴 **314 · the two gates reach every Codex home, on every launch.**
 *
 * A provisioned Codex home can have no `config.toml`, leaving memory off with no separate
 * migration hook. The launch path reaches every home and must configure it before the child
 * exists. `codex-memory-config.test.ts` checks `ensureCodexMemoryConfig`’s string behavior;
 * these tests check launch ordering and invocation.
 */
describe('Codex memory is switched on at launch (314 §2)', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot2-314-launch-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const config = (): string => join(home, 'config.toml')

  it('⛔ a START on a home with no config writes both gates — before the spawn', async () => {
    // ⚠️ **Before the spawn, for the reason 160's removal is**: the app-server reads its config once
    // at startup, so a write that landed after `transportFactory` would be a launch that reports
    // memory on and runs a child that has it off.
    let atSpawn: string | null = null
    const transport = new FakeTransport()
    transport.codexHome = home
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(() => {
      atSpawn = existsSync(config()) ? readFileSync(config(), 'utf8') : null
      return transport
    }).start({ cwd: '/tmp/x', providerHome: home })
    expect(atSpawn, 'the gates must be on disk when the transport is built').toContain(
      'memories = true',
    )
    expect(atSpawn).toContain('dedicated_tools = true')
    expect(atSpawn).toContain('use_memories = true')
    expect(atSpawn).toContain('generate_memories = true')
    await handle.close()
  })

  it('⛔ …and so does a RESUME — the path an existing profile actually arrives by', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: home },
    )
    expect(readFileSync(config(), 'utf8')).toContain('dedicated_tools = true')
    await handle.close()
  })

  it('⚠️ a config that cannot be merged still LAUNCHES, and is left exactly as it was', async () => {
    // ⛔ **Memory is a feature; a launch is the product.** `features = 3` is somebody's value at a
    // name we want, and this app neither replaces it nor refuses to start Codex over it. The cost of
    // being wrong here is a profile without memory — which is where every profile was yesterday.
    const theirs = 'features = 3\n'
    writeFileSync(config(), theirs)
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
    })
    expect(handle.ref?.sessionId).toBe('th_1')
    expect(readFileSync(config(), 'utf8')).toBe(theirs)
    await handle.close()
  })

  it('preserves the existing SQLite setting when adding memory settings', async () => {
    writeFileSync(config(), 'sqlite_home = "sub/state"\n')
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
    })
    const after = readFileSync(config(), 'utf8')
    expect(after).toContain('sqlite_home = "sub/state"')
    expect(after).toContain('memories = true')
    await handle.close()
  })

  it('preserves an external SQLite setting when adding memory settings', async () => {
    writeFileSync(config(), 'sqlite_home = "/tmp/brobot-escape"\n')
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
    })
    expect(readFileSync(config(), 'utf8')).toContain('sqlite_home = "/tmp/brobot-escape"')
    await handle.close()
  })
})

describe('Codex launch settings stay with the launch', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot2-codex-launch-settings-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const memory = [
    'features.memories=true',
    'memories.dedicated_tools=true',
    'memories.use_memories=true',
    'memories.generate_memories=true',
  ]

  for (const opening of ['start', 'resume'] as const) {
    for (const approval of ['ask', 'auto'] as const) {
      it(`${opening} records the ordered values sent for ${approval}, without server addresses`, async () => {
        const transport = new FakeTransport()
        transport.onRequest(`thread/${opening}`, () => ({
          ...okThread('th_1'),
          ...(approval === 'auto'
            ? {
                approvalPolicy: 'never',
                approvalsReviewer: 'user',
                sandbox: { type: 'dangerFullAccess' },
              }
            : {}),
        }))
        const options = {
          providerHome: home,
          approvalMode: approval,
          reasoningEffort: 'high',
          workFolders: ['/fictional/shared'],
          externalMcp: {
            servers: [
              { name: 'first', url: 'http://127.0.0.1:7001/mcp' },
              { name: 'second', url: 'http://127.0.0.1:7002/mcp' },
            ],
            reservedToolNames: [],
          },
        }
        const runtime = new CodexRuntime(adopt(transport))
        const handle =
          opening === 'start'
            ? await runtime.start({ ...options, cwd: '/tmp/x' })
            : await runtime.resume(
                { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
                options,
              )
        try {
          const sent = transport.requests.find((one) => one.method === `thread/${opening}`)
            ?.params as Record<string, unknown>
          expect(sent['config']).toEqual({
            'tools.update_plan.enabled': true,
            // ⚑ Codex's own question tool is off on every thread, start and resume.
            'tools.experimental_request_user_input.enabled': false,
            mcp_servers: {
              first: { url: 'http://127.0.0.1:7001/mcp' },
              second: { url: 'http://127.0.0.1:7002/mcp' },
            },
            ...(approval === 'ask'
              ? { 'sandbox_workspace_write.writable_roots': ['/fictional/shared'] }
              : {}),
            model_reasoning_effort: 'high',
          })
          expect(handle.launchSettings).toEqual([
            { key: 'memory', value: memory },
            {
              key: 'thread-overrides',
              value: [
                'tools.update_plan.enabled=true',
                'tools.experimental_request_user_input.enabled=false',
                'mcp_servers=["first","second"]',
                ...(approval === 'ask'
                  ? ['sandbox_workspace_write.writable_roots=["/fictional/shared"]']
                  : []),
                'model_reasoning_effort="high"',
              ],
            },
            { key: 'plan-tool', value: true },
            {
              key: 'approval-sandbox',
              value: [
                `approvalPolicy=${sent['approvalPolicy']}`,
                `approvalsReviewer=${sent['approvalsReviewer']}`,
                `sandbox=${sent['sandbox']}`,
              ],
            },
            { key: 'collaboration-mode', value: 'default' },
            { key: 'approval', value: approval },
            { key: 'tools-off', value: ['request_user_input', 'request_user_input_async'] },
            { key: 'tools-left-on', value: [] },
          ])
          const config = readFileSync(join(home, 'config.toml'), 'utf8')
          expect(config).toContain('memories = true')
          expect(config).toContain('dedicated_tools = true')
          expect(config).toContain('use_memories = true')
          expect(config).toContain('generate_memories = true')
          expect(JSON.stringify(handle.launchSettings)).not.toContain('127.0.0.1')
        } finally {
          await handle.close()
        }
      })
    }

    it(`${opening} keeps memory unknown when the merge is refused`, async () => {
      const original = 'features = 3\n'
      writeFileSync(join(home, 'config.toml'), original)
      const transport = new FakeTransport()
      transport.onRequest(`thread/${opening}`, () => okThread('th_1'))
      const runtime = new CodexRuntime(adopt(transport))
      const handle =
        opening === 'start'
          ? await runtime.start({ cwd: '/tmp/x', providerHome: home })
          : await runtime.resume(
              { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
              { providerHome: home },
            )
      try {
        expect(handle.launchSettings?.find((one) => one.key === 'memory')?.value).toBeNull()
        expect(handle.launchSettings?.find((one) => one.key === 'thread-overrides')?.value).toEqual(
          ['tools.update_plan.enabled=true', 'tools.experimental_request_user_input.enabled=false'],
        )
        expect(readFileSync(join(home, 'config.toml'), 'utf8')).toBe(original)
      } finally {
        await handle.close()
      }
    })
  }

  it.each([
    [{}, 'default'],
    [{ planMode: true }, 'plan'],
    [{ planMode: true, planModeEnded: true }, 'default'],
  ] as const)('records the initial collaboration selection %j', async (options, expected) => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
      ...options,
    })
    try {
      expect(handle.launchSettings?.find((one) => one.key === 'collaboration-mode')?.value).toBe(
        expected,
      )
      const sent = transport.requests.find((one) => one.method === 'thread/start')
        ?.params as Record<string, unknown>
      expect(sent).not.toHaveProperty('collaborationMode')
      // ⚑ Planning or not, the plan tool stays on and the question tool stays off.
      expect(sent['config']).toEqual({
        'tools.update_plan.enabled': true,
        'tools.experimental_request_user_input.enabled': false,
      })
    } finally {
      await handle.close()
    }
  })

  it('later settings and file changes do not replace or mutate the launch values', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: home,
    })
    try {
      const launched = handle.launchSettings
      const original = JSON.stringify(launched)
      await handle.setApprovalMode?.('auto')
      await handle.setPlanMode?.(true)
      await handle.setReasoningEffort?.('low')
      await handle.setModel?.('another-model')
      handle.setWorkFolders?.(['/fictional/later'])
      writeFileSync(join(home, 'config.toml'), 'features = 3\n')
      expect(handle.launchSettings).toBe(launched)
      expect(JSON.stringify(handle.launchSettings)).toBe(original)
      expect(Object.isFrozen(launched)).toBe(true)
      for (const one of launched ?? []) {
        expect(Object.isFrozen(one)).toBe(true)
        if (Array.isArray(one.value)) expect(Object.isFrozen(one.value)).toBe(true)
      }
      expect(transport.requests.filter((one) => one.method === 'thread/start')).toHaveLength(1)
    } finally {
      await handle.close()
    }
  })
})

it.each(['start', 'resume'] as const)(
  'managed plugin Codex %s carries only its broker capability',
  async (launch) => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const route = {
      name: 'plugin-fern',
      url: 'http://127.0.0.1:8123/mcp',
      capability: 'a'.repeat(64),
    }
    const context = {
      providerHome: '/tmp/x/home',
      managedPluginMcp: [route],
      externalMcp: {
        servers: [{ name: 'fictional-registry', url: 'http://127.0.0.1:8124/mcp' }],
        reservedToolNames: [],
      },
    }
    const handle =
      launch === 'start'
        ? await runtime.start({ cwd: '/tmp/x', ...context })
        : await runtime.resume(
            { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 1 },
            context,
          )
    try {
      const request = transport.requests.find((one) => one.method === `thread/${launch}`)
      expect((request?.params as { config: unknown }).config).toEqual({
        ...EVERY_THREAD_OVERLAY,
        mcp_servers: {
          'fictional-registry': { url: 'http://127.0.0.1:8124/mcp' },
          'plugin-fern': {
            url: route.url,
            http_headers: { Authorization: `Bearer ${route.capability}` },
          },
        },
      })
    } finally {
      await handle.close()
    }
  },
)

describe('managed resume ownership', () => {
  it('retains the allocated handle before a refused resume handshake', async () => {
    const transport = new FakeTransport()
    const die = transport.ownsAProcess()
    transport.onRequest('thread/resume', () => {
      throw new Error('fictional refusal')
    })
    const runtime = new CodexRuntime(adopt(transport))
    let allocated: SessionHandle | undefined
    try {
      await expect(
        runtime.resume(
          { provider: 'codex', sessionId: 'fictional-thread', cwd: '/tmp/x', rotation: 0 },
          {
            providerHome: '/tmp/x/home',
            onSessionCreated: (handle) => {
              allocated = handle
            },
          },
        ),
      ).rejects.toThrow()
      expect(allocated).toBeDefined()
      expect(allocated!.awaitProcessExit!()).toBe(transport.exited)
    } finally {
      die()
      await allocated?.close()
    }
  })
  it('publishes the stronger cleanup fact when the transport can prove group quiescence', async () => {
    const transport = new FakeTransport()
    transport.ownsAProcess()()
    let quiet!: () => void
    transport.quiesced = new Promise<void>((resolve) => {
      quiet = resolve
    })
    transport.onRequest('thread/start', () => okThread('fictional-thread'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    try {
      expect(handle.awaitProcessExit!()).toBe(transport.quiesced)
      let proved = false
      void handle.awaitProcessExit!()!.then(() => {
        proved = true
      })
      await handle.close()
      expect(proved).toBe(false)
    } finally {
      quiet()
      await handle.close()
    }
    await handle.awaitProcessExit!()
  })
})
