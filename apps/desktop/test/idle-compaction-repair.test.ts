import {
  fixtureDatabase,
  fixtureFolder,
  fixtureProviderConfig,
  neutralHostDeps,
} from './lib/host-fixture'
import { Wire } from './lib/scripted-codex-compaction'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { RuntimeEvent } from '@brobot2/runtime'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { ClaudeRuntime } from '@brobot2/runtime/claude'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AppDatabase } from '../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { claudeAuth } from '../src/main/providers/claude/index'
import { claudeLoginRenewer } from '../../../packages/runtime/src/claude/login-renewal'

// Queued compaction across a sign-in repair reopen and a preamble a provider turn interrupts.
// Real host, ledger and Claude adapter over scripted SDK frames and a synthetic machine login.

const REVOKED = 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'
const CONTINUE = 'Continue answering the last message.'
const REASON = 'Keep the repaired plan'
const frame = (value: Record<string, unknown>): SDKMessage => value as unknown as SDKMessage

// What the CLI answers when a renewal elsewhere revoked the token this turn ran on.
const revokedLogin = (): SDKMessage =>
  frame({
    type: 'assistant',
    message: {
      role: 'assistant',
      model: '<synthetic>',
      content: [{ type: 'text', text: REVOKED }],
    },
    error: 'authentication_failed',
  })

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

// The scripted SDK query: frames go out through the shared queue, and results name their message.
class FakeQuery {
  private readonly frames = new Wire<SDKMessage>()
  readonly sent: { message?: { content?: unknown } }[] = []
  readonly cli = new TheCliAnswersInOrder()
  constructor(private readonly catalogue: () => Promise<void>) {}

  emit(message: SDKMessage): void {
    this.frames.push(message)
  }

  // Keep every prompt message as the CLI reads it.
  hear(prompt: AsyncIterable<unknown>): void {
    const sent = this.sent
    this.cli.listen(
      (async function* () {
        for await (const message of prompt) {
          sent.push(message as never)
          yield message
        }
      })(),
    )
  }

  async supportedCommands(): Promise<readonly unknown[]> {
    await this.catalogue()
    return [{ name: 'compact', description: 'Compact context', argumentHint: '' }]
  }

  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.frames.close()
  }

  texts(): string[] {
    return this.sent.map((one) =>
      typeof one.message?.content === 'string' ? one.message.content : '',
    )
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over(this.frames[Symbol.asyncIterator]())
  }
}

describe('a queued compaction keeps its place across repair reopens and interrupted preambles', () => {
  let dir: string
  let db: AppDatabase
  let ledger: SessionStore
  let hosts: RuntimeHost[]
  let announced: Set<string>
  let launches: FakeQuery[]
  let machineLogin: string | null
  let renewalGate: { promise: Promise<void>; open: () => void } | null
  let renewalEntered: boolean
  let catalogueGate: { promise: Promise<void>; open: () => void } | null
  let catalogueAsked: boolean
  let failReappend: boolean
  let reappendRefused: number

  const sink: RuntimeEventSink = {
    ownerId: 'webContents:1',
    aPersonIsBehindIt: true,
    alive: true,
    send: () => {},
    sendLiveness: () => {},
  }

  // Refuses only the deferred request written again after the repaired launch, when asked to.
  function storeThatMayRefuseTheReappend(store: SessionStore): SessionStore {
    return new Proxy(store, {
      get(target, property) {
        if (property === 'append') {
          return (sessionId: string, ordinal: number, event: TranscriptEvent, at: number) => {
            if (failReappend && event.type === 'pending_compaction' && event.request !== null) {
              reappendRefused++
              throw new Error('scripted ledger refusal')
            }
            return target.append(sessionId, ordinal, event, at)
          }
        }
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value
      },
    })
  }

  function rejectedRenewer(): void {
    let token = machineLogin!
    renewalEntered = false
    const renew = claudeLoginRenewer({
      findProgram: () => '/fictional/native/cli',
      env: {},
      readLogin: async () =>
        JSON.stringify({
          claudeAiOauth: { accessToken: token, expiresAt: Date.now() + 3600000 },
        }),
      run: async () => {
        renewalEntered = true
        await renewalGate?.promise
        token = 'fictional-token-renewed'
        machineLogin = token
        return { code: 0, timedOut: false }
      },
    })
    hostRenewal = renew
  }
  let hostRenewal: ReturnType<typeof claudeLoginRenewer> | undefined

  // The command list a resume reads, held while a test keeps its gate shut.
  const theCommandList = async (): Promise<void> => {
    if (catalogueGate === null) return
    catalogueAsked = true
    await catalogueGate.promise
  }

  const homeOf = (which: string): string => join(dir, 'homes', which)

  function buildHost(): RuntimeHost {
    const renew = hostRenewal
    const built = new RuntimeHost({
      store: storeThatMayRefuseTheReappend(ledger),
      ...neutralHostDeps(() => dir),
      createRuntime: () =>
        new ClaudeRuntime(
          (params) => {
            const fq = new FakeQuery(theCommandList)
            launches.push(fq)
            fq.hear(params.prompt)
            return fq as never
          },
          async (sessionId) => announced.has(sessionId),
          () => machineLogin,
          async () => machineLogin,
        ),
      prepareProviderHome: (which) => {
        mkdirSync(homeOf(which), { recursive: true })
        return homeOf(which)
      },
      providerHomePath: homeOf,
      resolveCwd: () => join(dir, 'cwd'),
      newSessionId: () => 'sess_repair',
      ...(renew === undefined
        ? {}
        : {
            loginRenewal: (provider: import('@brobot2/shared').Provider) =>
              provider === 'claude'
                ? claudeAuth(
                    {
                      managedRoot: join(dir, 'homes'),
                      defaultProfile: 'brobot',
                      homeOf,
                      profiles: () => ['brobot'],
                      assertMayOpen: () => {},
                    },
                    { renewLogin: renew },
                  ).renewal
                : undefined,
          }),
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    dir = fixtureFolder('compact-repair-')
    db = fixtureDatabase(dir)
    ledger = createSessionStore(db)
    hosts = []
    announced = new Set()
    launches = []
    machineLogin = 'test-token-at-launch'
    renewalGate = null
    renewalEntered = false
    catalogueGate = null
    catalogueAsked = false
    failReappend = false
    reappendRefused = 0
    hostRenewal = undefined
  })

  afterEach(async () => {
    renewalGate?.open()
    catalogueGate?.open()
    for (const built of hosts) await built.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (
    predicate: () => boolean,
    what: string | (() => string),
  ): Promise<void> => {
    for (let attempt = 0; attempt < 600; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${typeof what === 'string' ? what : what()}`)
  }

  const eventsOf = (sessionId: string): TranscriptEvent[] =>
    ledger.events(sessionId).map((entry) => entry.event)

  const notices = (sessionId: string) =>
    eventsOf(sessionId).filter(
      (event) =>
        event.type === 'message_queued' && event.appNotice === 'a-conversation-was-compacted',
    )

  const expectTheRequestCleared = (sessionId: string): void => {
    expect(
      eventsOf(sessionId)
        .filter((event) => event.type === 'pending_compaction')
        .at(-1),
    ).toEqual({ type: 'pending_compaction', request: null })
  }

  const askToCompact = async (
    host: RuntimeHost,
    sessionId: string,
    answered: Record<string, unknown>,
    reason = REASON,
  ): Promise<void> => {
    expect(
      await host.compactConversation({ conversation: sessionId, agent: sessionId, reason }),
    ).toMatchObject(answered)
  }

  const handleOf = (host: RuntimeHost, id: string) =>
    (host as unknown as { slots: Map<string, { session: { handle: unknown } | null }> }).slots.get(
      id,
    )?.session?.handle as { emit(event: RuntimeEvent): void } | undefined

  // The ledger as it stands, for a failure message.
  const trace = (id: string): string =>
    JSON.stringify(
      eventsOf(id).map((event) => {
        const one = event as unknown as Record<string, unknown>
        return [event.type, one.appNotice ?? one.because ?? one.state ?? one.reason ?? '']
      }),
    )

  const decided = async (host: RuntimeHost, id: string): Promise<void> => {
    await waitFor(
      () =>
        !(
          host as unknown as { aReopenIsBeingDecidedFor: Map<string, number> }
        ).aReopenIsBeingDecidedFor.has(id),
      'the recovery decision',
    )
  }

  async function firstTurn(host: RuntimeHost): Promise<string> {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: join(dir, 'cwd') },
      sink,
    )
    await host.send(sessionId, 'first', sink)
    announced.add('provider-A')
    launches[0]!.emit(
      frame({ type: 'system', subtype: 'init', session_id: 'provider-A', cwd: join(dir, 'cwd') }),
    )
    launches[0]!.emit(frame({ type: 'result', subtype: 'success', is_error: false }))
    await waitFor(() => eventsOf(sessionId).some((event) => event.type === 'turn'), 'turn one')
    return sessionId
  }

  // Kill the second turn on a revoked login and hold the renewal so a request can be queued.
  async function repairWithAQueuedRequest(
    queue = true,
    duringTurn = false,
  ): Promise<{ host: RuntimeHost; sessionId: string }> {
    rejectedRenewer()
    renewalGate = gate()
    const host = buildHost()
    const sessionId = await firstTurn(host)
    await host.send(sessionId, 'run the long job', sink)
    if (queue && duringTurn) {
      await askToCompact(host, sessionId, { ok: true, queued: true, afterTurn: true })
    }
    launches[0]!.emit(revokedLogin())
    await waitFor(() => renewalEntered, 'the held renewal')
    if (queue && !duringTurn) await askToCompact(host, sessionId, { ok: true, queued: true })
    return { host, sessionId }
  }

  function resumedOn(index: number): FakeQuery {
    const retry = launches[index]!
    retry.emit(
      frame({ type: 'system', subtype: 'init', session_id: 'provider-A', cwd: join(dir, 'cwd') }),
    )
    return retry
  }

  function confirmCompaction(retry: FakeQuery): void {
    retry.emit(
      frame({
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'manual', pre_tokens: 1200 },
      }),
    )
    retry.emit(frame({ type: 'result', subtype: 'success', is_error: false }))
  }

  it('with no held words the cut turn carries on first, and the request runs before the next input', async () => {
    const { host, sessionId } = await repairWithAQueuedRequest()
    renewalGate!.open()
    await waitFor(() => launches.length === 2, 'the repaired resume')
    const retry = resumedOn(1)
    await waitFor(() => retry.sent.length === 1, 'the continuation')
    expect(retry.texts(), trace(sessionId)).toEqual([CONTINUE])
    // A second request while the first waits out the repair is the same request.
    await askToCompact(host, sessionId, { ok: true, queued: true }, 'A second reason')
    retry.emit(frame({ type: 'result', subtype: 'success', is_error: false }))
    await decided(host, sessionId)
    expect(retry.texts()).toEqual([CONTINUE])
    const next = host.send(sessionId, 'the next request', sink)
    await waitFor(() => retry.sent.length === 2, 'the deferred compaction')
    expect(retry.texts()[1]).toBe(`/compact ${REASON}`)
    confirmCompaction(retry)
    await next
    await waitFor(() => retry.sent.length === 3, 'the next request')
    expect(retry.texts()[2]).toContain('the next request')
    expect(retry.texts()[2]).toContain(REASON)
    expect(retry.texts().join('\n')).not.toContain('A second reason')
    expect(retry.texts().filter((text) => text === `/compact ${REASON}`)).toHaveLength(1)
    expect(notices(sessionId)).toHaveLength(1)
    expectTheRequestCleared(sessionId)
  })

  it('a request written inside the refused turn preserves its repair continuation', async () => {
    const { host, sessionId } = await repairWithAQueuedRequest(true, true)
    renewalGate!.open()
    await waitFor(() => launches.length === 2, 'the repaired resume')
    const retry = resumedOn(1)
    await waitFor(() => retry.sent.length === 1, 'the continuation')
    expect(retry.texts()).toEqual([CONTINUE])
    retry.emit(frame({ type: 'result', subtype: 'success', is_error: false }))
    await decided(host, sessionId)
    await waitFor(() => retry.sent.length === 2, 'the compaction after the carried turn')
    expect(retry.texts()[1]).toBe(`/compact ${REASON}`)
    const next = host.send(sessionId, 'the next request', sink)
    confirmCompaction(retry)
    await next
    await waitFor(() => retry.sent.length === 3, 'the next input')
    expect(retry.texts()[2]).toContain(REASON)
    expect(retry.texts().filter((text) => text === `/compact ${REASON}`)).toHaveLength(1)
  })

  // A failed ledger write leaves the life unrecorded, so no carry-on is made (the rule before 139).
  it('a failed re-append still runs the request from memory before the next input', async () => {
    const { host, sessionId } = await repairWithAQueuedRequest()
    failReappend = true
    renewalGate!.open()
    await waitFor(() => launches.length === 2, 'the repaired resume')
    const retry = resumedOn(1)
    await decided(host, sessionId)
    await waitFor(
      () => retry.sent.length === 1,
      () => `the compaction ${trace(sessionId)}`,
    )
    expect(retry.texts(), trace(sessionId)).toEqual([`/compact ${REASON}`])
    expect(reappendRefused).toBe(1)
    const next = host.send(sessionId, 'the next request', sink)
    confirmCompaction(retry)
    await next
    await waitFor(() => retry.sent.length === 2, 'the next request')
    expect(retry.texts()[1]).toContain('the next request')
    expect(retry.texts()[1]).toContain(REASON)
    expect(retry.texts().join('\n')).not.toContain(CONTINUE)
    expect(notices(sessionId)).toHaveLength(1)
    expectTheRequestCleared(sessionId)
  })

  it('control: with no request queued, this repair carries the cut turn on', async () => {
    const { host, sessionId } = await repairWithAQueuedRequest(false)
    renewalGate!.open()
    await waitFor(() => launches.length === 2, 'the repaired resume')
    const retry = resumedOn(1)
    await waitFor(
      () => retry.sent.length === 1,
      () => `the continuation ${trace(sessionId)}`,
    )
    expect(retry.texts(), trace(sessionId)).toEqual([CONTINUE])
    await decided(host, sessionId)
  })

  it('held words skip the carry-on, and the request runs before them and rides them', async () => {
    const { host, sessionId } = await repairWithAQueuedRequest()
    let sent = 'pending'
    void host.send(sessionId, 'newer human request', sink).then(
      () => (sent = 'resolved'),
      (error: unknown) => (sent = String(error)),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    renewalGate!.open()
    await waitFor(
      () => launches.length === 2,
      () => `the repaired resume ${sent} ${trace(sessionId)}`,
    )
    const retry = resumedOn(1)
    await decided(host, sessionId)
    await waitFor(
      () => retry.sent.length === 1,
      () => `the compaction ${sent} ${trace(sessionId)}`,
    )
    expect(retry.texts(), trace(sessionId)).toEqual([`/compact ${REASON}`])
    confirmCompaction(retry)
    await waitFor(() => retry.sent.length === 2, 'the held words')
    expect(retry.texts()[1]).toContain('newer human request')
    expect(retry.texts()[1]).toContain(REASON)
    expect(retry.texts().join('\n')).not.toContain(CONTINUE)
    expect(notices(sessionId)).toHaveLength(1)
  })

  it('a provider turn during the preamble does not cancel the compaction', async () => {
    const host = buildHost()
    const sessionId = await firstTurn(host)
    await host.close(sessionId, sink)
    await askToCompact(host, sessionId, { ok: true, queued: true })
    catalogueGate = gate()
    const next = host.send(sessionId, 'the next request', sink)
    await waitFor(() => launches.length === 2, 'the resume')
    const resumed = resumedOn(1)
    await waitFor(() => catalogueAsked, 'the held command list')
    expect(resumed.sent).toHaveLength(0)
    const handle = handleOf(host, sessionId)
    expect(handle).toBeDefined()
    handle!.emit({
      type: 'turn',
      state: 'interrupted',
      wordOf: 'this-app',
      startedBy: 'the-provider',
    } as RuntimeEvent)
    handle!.emit({ type: 'status', state: 'idle' } as RuntimeEvent)
    catalogueGate.open()
    // The request was asked for, so it runs, and the input goes after it.
    await waitFor(() => resumed.sent.length === 1, 'the compaction')
    expect(resumed.texts()[0]).toBe(`/compact ${REASON}`)
    confirmCompaction(resumed)
    await next
    await waitFor(() => resumed.sent.length === 2, 'the next request')
    expect(resumed.texts()[1]).toContain('the next request')
    expectTheRequestCleared(sessionId)
  })
})
