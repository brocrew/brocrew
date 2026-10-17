import { describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  FakeSessionHandle,
  RUNTIME_EVENT_TYPES,
  ResumeError,
  type PermissionDecision,
  type RuntimeEvent,
} from '../src/index'

/** Consume a handle's stream into `sink`, optionally auto-answering requests. */
function consume(
  handle: FakeSessionHandle,
  sink: RuntimeEvent[],
  auto?: { permission?: PermissionDecision; answerUserInput?: boolean },
): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) {
      sink.push(event)
      if (event.type === 'permission_request' && auto?.permission) {
        await handle.respondPermission(event.id, auto.permission)
      }
      if (event.type === 'user_input_request' && auto?.answerUserInput) {
        await handle.respondUserInput(event.id, { kind: 'answer', answers: { q0: 'a' } })
      }
    }
  })()
}

function firstOfType<T extends RuntimeEvent['type']>(
  events: RuntimeEvent[],
  type: T,
): Extract<RuntimeEvent, { type: T }> {
  const found = events.find((e): e is Extract<RuntimeEvent, { type: T }> => e.type === type)
  if (!found) throw new Error(`no ${type} event found`)
  return found
}

describe('FakeRuntime — happy path', () => {
  it('emits the scripted turn sequence and allows the tool', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    expect(handle.status()).toBe('idle')

    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events, { permission: { outcome: 'allow' } })

    await handle.send('hello world')
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'completed')).toBe(true),
    )
    await handle.close()
    await consumer

    const types = events.map((e) => e.type)
    // Ordered subsequence of the representative sequence (deliverable 3).
    expect(types).toEqual([
      'session', // started
      'status', // idle (ready)
      'status', // working
      'assistant_delta',
      'assistant_delta',
      'assistant_delta',
      'assistant_message',
      'tool_call',
      'permission_request',
      'status', // waiting_permission
      // ⚠️ `working`, and it is NEW (064, closing 063 §8). Both real adapters publish it through
      // their wait lease the moment the last open card is answered; the Fake did not, so the double
      // and the things it doubles disagreed about a transition the app consumes — the durable store
      // clears the blocked reason on it, and the stall watchdog re-arms on it.
      'status', // working — the card has been answered
      'tool_result',
      'turn', // completed
      'status', // idle
      'session', // ended
      'status', // ended
    ])

    expect(firstOfType(events, 'session').state).toBe('started')
    expect(firstOfType(events, 'tool_result').ok).toBe(true)
    expect(firstOfType(events, 'assistant_message').text).toContain('hello world')
  })

  it.each([
    ['codex', false, '/tmp/x'],
    ['claude', false, undefined],
  ] as const)(
    "the Fake's %s command card discloses as the real adapter does",
    async (provider, underDisclosed, cwd) => {
      // The Fake is the conformance double the UI/tests are built on, so it must model disclosure
      // the way the real adapters do: a command card that draws its whole command and no path or
      // host picked out of it hides nothing, on either provider.
      const runtime = new FakeRuntime(provider)
      const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
      const events: RuntimeEvent[] = []
      const consumer = consume(handle, events, { permission: { outcome: 'allow' } })
      await handle.send('run something')
      await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true))
      const req = firstOfType(events, 'permission_request')
      expect(req.action).toBe('Bash')
      expect(req.scope.underDisclosed).toBe(underDisclosed)
      expect(req.scope.cwd).toBe(cwd)
      await handle.close()
      await consumer
    },
  )

  it('deny → tool_result ok:false, turn still completes gracefully', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events, { permission: { outcome: 'deny', message: 'nope' } })

    await handle.send('do a thing')
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'completed')).toBe(true),
    )
    await handle.close()
    await consumer

    expect(firstOfType(events, 'tool_result').ok).toBe(false)
  })

  it('cancel → the turn is interrupted, not completed', async () => {
    const runtime = new FakeRuntime('codex')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events, { permission: { outcome: 'cancel' } })

    await handle.send('risky thing')
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'interrupted')).toBe(true),
    )
    await handle.close()
    await consumer

    expect(events.some((e) => e.type === 'tool_result')).toBe(false)
  })
})

describe('FakeRuntime — status machine, interrupt, drive-through', () => {
  it('drives start/send/events/respondPermission/interrupt/status/close end-to-end', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events) // no auto-answer; we respond manually

    // turn 1: respondPermission(allow) → completed
    await handle.send('one')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true))
    expect(handle.status()).toBe('waiting_permission')
    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'allow',
    })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'completed')).toBe(true),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))

    // turn 2: interrupt() settles the pending prompt (broker) → interrupted, no respond
    await handle.send('two')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2),
    )
    await handle.interrupt()
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'interrupted')).toBe(true),
    )

    await handle.close()
    expect(handle.status()).toBe('ended')
    await consumer
  })

  it('throws when answering an unknown pending request', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    await expect(handle.respondPermission('nope', { outcome: 'allow' })).rejects.toThrow()
    await expect(handle.respondUserInput('nope', { kind: 'reject' })).rejects.toThrow()
    await handle.close()
  })
})

describe('FakeRuntime — resume honesty', () => {
  it('resumes a ref it issued (session resumed)', async () => {
    const runtime = new FakeRuntime('claude')
    const started = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const resumed = await runtime.resume(started.ref, { providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(resumed, events)
    await vi.waitFor(() => expect(events.some((e) => e.type === 'session')).toBe(true))
    expect(firstOfType(events, 'session').state).toBe('resumed')
    await resumed.close()
    await consumer
  })

  it('rejects an unknown or wrong-provider ref instead of faking a fresh session', async () => {
    const runtime = new FakeRuntime('claude')
    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 'real_session', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'fake_x_1', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('rejects a FORGED fake_* id it never issued (034, fixing 023 P2 #7)', async () => {
    const runtime = new FakeRuntime('claude')
    // A well-formed `fake_*` id that looks issued but was never minted → ResumeError.
    // Pre-fix the Fake accepted any `fake_*` id and masked this resume bug.
    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 'fake_claude_999', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('rejects an issued ref resumed with a WRONG cwd / provider-home / rotation (034)', async () => {
    const runtime = new FakeRuntime('claude')
    const started = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const ref = started.ref
    // Wrong home:
    await expect(runtime.resume(ref, { providerHome: '/other/home' })).rejects.toBeInstanceOf(
      ResumeError,
    )
    // Wrong cwd:
    await expect(
      runtime.resume({ ...ref, cwd: '/tmp/OTHER' }, { providerHome: '/tmp/x/home' }),
    ).rejects.toBeInstanceOf(ResumeError)
    // Wrong rotation:
    await expect(
      runtime.resume({ ...ref, rotation: 7 }, { providerHome: '/tmp/x/home' }),
    ).rejects.toBeInstanceOf(ResumeError)
    // The correctly-issued matching ref still resumes.
    const resumed = await runtime.resume(ref, { providerHome: '/tmp/x/home' })
    expect(resumed.ref.sessionId).toBe(ref.sessionId)
    await resumed.close()
  })
})

describe('FakeRuntime — teardown & ordering invariants', () => {
  it('close() safe-rejects pending requests so nothing hangs', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events) // no auto-answer: requests stay pending

    const { answered } = handle.simulateUserInput('need input')
    await handle.send('go')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true))

    await handle.close() // must drain pending requests, not hang
    await consumer // resolves only if close() ended the stream

    // The pending user-input request was safe-rejected.
    expect(await answered).toEqual({ kind: 'reject' })
    expect(events.some((e) => e.type === 'session' && e.state === 'ended')).toBe(true)
    // The abandoned turn emitted nothing after `session: 'ended'` except status.
    const endedIdx = events.findIndex((e) => e.type === 'session' && e.state === 'ended')
    expect(events.slice(endedIdx + 1).every((e) => e.type === 'status')).toBe(true)
  })

  it('emits status idle immediately after a non-interrupted turn (Slice-3 ordering)', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events, { permission: { outcome: 'allow' } })

    await handle.send('go')
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'completed')).toBe(true),
    )
    await handle.close()
    await consumer

    const turnIdx = events.findIndex((e) => e.type === 'turn' && e.state === 'completed')
    expect(events[turnIdx + 1]).toMatchObject({ type: 'status', state: 'idle' })
  })
})

describe('FakeRuntime — exercises every RuntimeEvent variant', () => {
  it('produces every variant the FAKE emits, and every session/turn state', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events) // respond manually per turn

    const nthPermission = (n: number): string => {
      const perms = events.filter((e) => e.type === 'permission_request')
      const perm = perms[n]
      if (!perm || perm.type !== 'permission_request') throw new Error(`no permission #${n}`)
      return perm.id
    }

    // completed turn (allow)
    await handle.send('a')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(1),
    )
    await handle.respondPermission(nthPermission(0), { outcome: 'allow' })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'completed')).toBe(true),
    )

    // failed turn
    await handle.runFailedTurn()
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'failed')).toBe(true),
    )

    // interrupted turn (cancel)
    await handle.send('b')
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2),
    )
    await handle.respondPermission(nthPermission(1), { outcome: 'cancel' })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'interrupted')).toBe(true),
    )

    // remaining content variants
    const { id, answered } = handle.simulateUserInput('pick one', ['a', 'b'])
    await handle.respondUserInput(id, { kind: 'answer', answers: { q0: 'a' } })
    await answered
    // The provider retires a request it opened (051): the card is withdrawn, and a late answer
    // for it is refused — the Fake models the real adapter's lifecycle, not a permissive stub.
    const retired = handle.simulateUserInput('about to be withdrawn')
    handle.simulateRequestResolved(retired.id)
    await expect(
      handle.respondUserInput(retired.id, { kind: 'answer', answers: { q0: 'too late' } }),
    ).rejects.toThrow()
    handle.simulateError('non-fatal hiccup', false)
    handle.simulateThinking({ tokens: 165 })
    handle.simulateActivity('tool', 'Bash')
    handle.simulatePlanUpdate([{ text: 'the one step', status: 'active' }])
    handle.simulateSubAgent('agent_1', 'started', { kind: 'Explore' })
    handle.simulateImage('exec-1', { prompt: 'a sleeping fox' })
    handle.simulateContextReading({ kind: 'proportional', used: 14807, window: 258400 })
    handle.simulateCompaction({ before: 128000, after: 24000 })
    handle.simulateConversationReset()
    handle.simulateFileChange()
    handle.simulateWorkflowRun()
    handle.simulateBackgroundWork()
    handle.simulateScheduledWork()
    handle.simulateProviderCommands()
    handle.simulateToolInventory()
    handle.simulateMemoryRecall()
    handle.simulateProviderLimitClear()
    handle.simulateProviderUsage()
    handle.simulateUnknown({ provider_specific: 'blob' })
    await handle.close()
    await consumer

    const types = new Set(events.map((e) => e.type))
    for (const type of RUNTIME_EVENT_TYPES) {
      expect(types.has(type), `expected a '${type}' event`).toBe(true)
    }

    const sessionStates = new Set(events.filter((e) => e.type === 'session').map((e) => e.state))
    expect(sessionStates).toEqual(new Set(['started', 'ended']))

    const turnStates = new Set(events.filter((e) => e.type === 'turn').map((e) => e.state))
    expect(turnStates).toEqual(new Set(['completed', 'failed', 'interrupted']))
  })

  it('exposes FakeSessionHandle as a SessionHandle', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    expect(handle).toBeInstanceOf(FakeSessionHandle)
    await handle.close()
  })
})

/**
 * 🔴 **446 · the APP can park this conversation on a person, and it joins the count a card uses.**
 *
 * ⛔ **`042` measured three writers of this session's status and `122` removed them**, so the one
 * thing an app holding a call of its own may NOT do is publish a status. ⚑ `waitForAPerson` is the
 * other door: it lands in `SessionMachine`'s own wait count, whose rule is that *two open cards and
 * one answered is still a session waiting on the user* — and this file is where that rule is
 * measured across the two kinds of waiter rather than asserted about one.
 */
describe('waitForAPerson — the app’s own park, in the brokers’ count (446)', () => {
  it('🔴 publishes on the 0 → 1 and 1 → 0 edges, exactly as a card does', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)
    // ⚑ **The premise**: nothing is waiting on anybody yet.
    expect(handle.status()).not.toBe('waiting_permission')

    const release = handle.waitForAPerson()
    await vi.waitFor(() => expect(handle.status()).toBe('waiting_permission'))
    // ⚠️ **The EVENT, waited for separately from the cached status.** `status()` is synchronous and
    // the stream is a queue a consumer drains on a later tick; asserting the count without the wait
    // measured the tick rather than the publish.
    await vi.waitFor(() =>
      expect(
        events.filter((e) => e.type === 'status' && e.state === 'waiting_permission'),
      ).toHaveLength(1),
    )

    release()
    await vi.waitFor(() => expect(handle.status()).not.toBe('waiting_permission'))
    await handle.close()
    await consumer
  })

  it('⛔ idempotent — a second release does not spend ANOTHER waiter’s slot', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/y', providerHome: '/tmp/y/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)

    // 🔴 **A real card underneath, and it is what makes this measurable at all.** ⛔ `endWait`
    // floors at zero, so a double release against an EMPTY count is invisible — the first draft of
    // this test did exactly that and the mutation row for it survived. ⚑ With a card open the
    // second release lands on somebody else's slot, which is the state the guard exists for.
    await handle.send('one')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true))
    expect(handle.status()).toBe('waiting_permission')

    const release = handle.waitForAPerson()
    release()
    // ⛔ **The second call is the whole test.**
    release()
    // ⚑ Still waiting, because the CARD is — and a double release would have spent its slot.
    expect(handle.status()).toBe('waiting_permission')

    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'allow',
    })
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    await handle.close()
    await consumer
  })

  it('⚑ ONE count across both kinds of waiter — a card still open outlives the app’s release', async () => {
    const runtime = new FakeRuntime('claude')
    const handle = await runtime.start({ cwd: '/tmp/z', providerHome: '/tmp/z/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)

    // A real provider card, open and unanswered…
    await handle.send('one')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true))
    expect(handle.status()).toBe('waiting_permission')

    // …and the app parks a call of its own on top of it.
    const release = handle.waitForAPerson()
    release()
    // ⛔ **Still waiting**, because the card is. A second counter would have reported this session
    // free the moment the app let go, which is the defect `042`'s three writers produced and `122`
    // removed — arriving from outside the package this time.
    expect(handle.status()).toBe('waiting_permission')

    await handle.respondPermission(firstOfType(events, 'permission_request').id, {
      outcome: 'allow',
    })
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    await handle.close()
    await consumer
  })
})

/**
 * ⚑ **697 — the double draws the two lines the real adapters draw, so a host test cannot pass
 * against a double that says something the product does not.**
 */
describe('697 · the Fake follows the adapters', () => {
  it('🔴 a simulated card’s persistence follows its offer — `672` F1’s rule, in the double too', async () => {
    const runtime = new FakeRuntime('codex')
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)
    // ⛔ It was `'once'` whatever a caller offered — a session button under a card saying *once*.
    void handle.simulatePermission('perm_session', {
      action: 'Bash',
      detail: 'x',
      availableDecisions: ['allow', 'allow_for_session'],
    })
    // ⚑ The control: a one-shot offer is `once` before and after.
    void handle.simulatePermission('perm_once', {
      action: 'Bash',
      detail: 'x',
      availableDecisions: ['allow'],
    })
    await vi.waitFor(() =>
      expect(events.filter((event) => event.type === 'permission_request')).toHaveLength(2),
    )
    const persistence = (id: string): string | undefined =>
      events.find(
        (event): event is Extract<RuntimeEvent, { type: 'permission_request' }> =>
          event.type === 'permission_request' && event.id === id,
      )?.scope.persistence
    expect(persistence('perm_session')).toBe('session')
    expect(persistence('perm_once')).toBe('once')
    await handle.close()
    await consumer
  })

  it('🔴 a resume cancelled before it starts is a ResumeError carrying the cancel — `673` F-6’s boundary', async () => {
    const runtime = new FakeRuntime('claude')
    const started = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const ref = started.ref
    await started.close()
    if (ref === null) throw new Error('the double issued no ref')
    const refused = await runtime
      .resume(ref, { providerHome: '/tmp/x/home', signal: AbortSignal.abort() })
      .catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(ResumeError)
    expect(((refused as ResumeError).cause as Error).message).toBe(
      'claude resume was cancelled before it started',
    )
    // ⚑ The control: the same ref, not cancelled, resumes.
    const resumed = await runtime.resume(ref, { providerHome: '/tmp/x/home' })
    expect(resumed.ref?.sessionId).toBe(ref.sessionId)
    await resumed.close()
  })
})

describe('W4.189 · the Fake’s work folders follow the adapters', () => {
  it('seeded by the launch, asked for between turns, adopted at the next send — and re-seeded by a resume', async () => {
    const runtime = new FakeRuntime('codex')
    const handle = await runtime.start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      workFolders: ['/w/a'],
    })
    expect(handle.workFolders).toEqual({ effective: ['/w/a'], requested: ['/w/a'] })
    handle.setWorkFolders(['/w/a', '/w/b'])
    expect(handle.workFolders).toEqual({ effective: ['/w/a'], requested: ['/w/a', '/w/b'] })

    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events, { permission: { outcome: 'allow' } })
    await handle.send('go')
    expect(handle.workFolders.effective).toEqual(['/w/a', '/w/b'])
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'turn' && e.state === 'completed')).toBe(true),
    )

    const resumed = await runtime.resume(handle.ref, {
      providerHome: '/tmp/x/home',
      workFolders: ['/w/b'],
    })
    expect(resumed.workFolders).toEqual({ effective: ['/w/b'], requested: ['/w/b'] })
    await resumed.close()
    await handle.close()
    await consumer
  })
})
