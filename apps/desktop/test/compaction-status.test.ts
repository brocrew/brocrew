import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { ClaudeRuntime, type AgentRuntime } from '@brobot2/runtime'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  NEEDING_TOKEN,
  STANDING_TONE,
  activityLine,
  needingFor,
  sessionFacets,
  standingOf,
} from '../src/renderer/src/lib/agent-state'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * **133 · ninety-one seconds of `idle` while a 90,000-token context was compacted.**
 *
 * After `/compact` is sent to a reopened conversation, the plate must not say `Idle`
 * throughout the compaction window. The measured offsets below are relative to the initial
 * compact turn:
 *
 * ```
 * 1824  +0ms       user_turn  "/compact"
 * 1825  +18ms      activity   compacting
 *       ────────── 91 seconds. no status frame at all. the plate reads Idle ──────────
 * 1826  +90,847ms  error      approaching its rate limit (seven_day)
 * 1827  +91,379ms  unknown    {subtype:'status', compact_result:'success'}
 * 1828  +91,387ms  session    resumed
 * 1829  +91,388ms  status     working    ← the FIRST working, one ms after the handshake
 * 1830  +91,391ms  compaction {before:89945, after:6687, trigger:'manual'}
 * 1831  +91,392ms  turn       completed
 * 1832  +91,392ms  status     idle
 * ```
 *
 * ## ⛔ Which of two correct rules was actually in the way — measured, not assumed
 *
 * The obvious reading is that `activity` is deliberately excluded from `isProviderWork` (124), so a
 * compaction announced only as an activity can never raise a claim. **The turn table says that is
 * not what happened here.** Turn 8 of that session — prompt `/compact` — opened at 21:32:27 and
 * closed at 21:33:58 `completed`: a turn was open for every one of the ninety-one seconds. What
 * withheld the `working` was `SessionMachine.derive`'s pre-handshake deferral, and ordinal 1829
 * landing **1 ms after** the `session resumed` that lifted it is the proof.
 *
 * ⚑ **So `compacting` does not become a claim, and routing it through `noteProviderWork` would have
 * changed nothing** — that method returns at its `if (this.turn)` branch, which is the branch this
 * session was in throughout. The census agrees from the other side: every `compacting` row this
 * ledger has ever held was **inside an open turn** (two of them at 136's re-census on 13 Aug, one
 * when 133 measured — the count moves, the shape does not), while the phases that really do turn up
 * with nothing claimed are `thinking` (339 of 1,165) and `waiting` (95 of 270). 099's rule that a
 * stale activity may not promote an idle session is untouched, and this file's third test pins it.
 *
 * `packages/runtime/test/session-machine.test.ts` supplies the unit proof. This file drives
 * the same window through the real adapter, host, and renderer fold to verify the visible
 * state.
 *
 * ⛔ **And 133 changed more than compaction** — see the last describe in this file, which composes
 * the two consequences 136 found reachable through the real adapter with nothing asserting them.
 */

class FakeQuery {
  /** How many times the adapter asked the provider to stop — the proof a Stop is not a no-op. */
  interrupts = 0
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private readonly buffer: SDKMessage[] = []
  private done = false

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

  async interrupt(): Promise<void> {
    this.interrupts += 1
  }
  async setPermissionMode(): Promise<void> {}
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

/**
 * The four frames of the compaction window, in the shapes `normalize.ts` reads.
 *
 * ⚠️ **`compacting` and `compactResult` are quoted from the wire** — `probe:compacting` captured the
 * pair, and `normalize.ts` prints the bytes in its own comment. `boundary` carries the numbers from
 * ordinal 1830 of the live ledger.
 */
const init = (id: string, cwd: string): SDKMessage =>
  ({ type: 'system', subtype: 'init', session_id: id, cwd }) as unknown as SDKMessage

const compacting = (): SDKMessage =>
  ({
    type: 'system',
    subtype: 'status',
    status: 'compacting',
    session_id: 'sess_provider_1',
    uuid: 'u_compacting',
  }) as unknown as SDKMessage

const compactResult = (): SDKMessage =>
  ({
    type: 'system',
    subtype: 'status',
    status: null,
    compact_result: 'success',
    session_id: 'sess_provider_1',
    uuid: 'u_result',
  }) as unknown as SDKMessage

const boundary = (): SDKMessage =>
  ({
    type: 'system',
    subtype: 'compact_boundary',
    compact_metadata: { trigger: 'manual', pre_tokens: 89945, post_tokens: 6687 },
    session_id: 'sess_provider_1',
    uuid: 'u_boundary',
  }) as unknown as SDKMessage

const result = (): SDKMessage =>
  ({ type: 'result', subtype: 'success', is_error: false }) as unknown as SDKMessage

const says = (text: string): SDKMessage =>
  ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }) as unknown as SDKMessage

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

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * What the renderer would actually draw, **folded from the events the session was sent** — 123's
 * rule, and it is why this file cannot assert a face the live window could not reach.
 */
function surfaceInput(sink: RecordingSink, liveness: SessionLiveness['state'] = 'live') {
  const state = createTranscript()
  for (const message of sink.messages) applyEvent(state, message.event, message.at)
  const needing = needingFor({ ...state.pending, planNeedsGoAhead: false })
  return {
    // ⚑ **D-017b** — a fold that ended moves its record to `recorded` (`acceptEvent`), which is
    // what the plate is then drawn from.
    phase: state.ended ? ('recorded' as const) : ('open' as const),
    status: state.status,
    activity: state.activity,
    streaming: state.streamingId !== null,
    liveness,
    ...(needing ? { needing } : {}),
  }
}

function surfaceOf(sink: RecordingSink) {
  const input = surfaceInput(sink)
  const facets = sessionFacets(input)
  return { facets, standing: standingOf(facets), pill: activityLine(input) }
}

describe('a compaction the app can see (133)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  let fq: FakeQuery
  let canUseTool: NonNullable<Options['canUseTool']> | null

  function buildHost(): RuntimeHost {
    let counter = 0
    const createRuntime = (): AgentRuntime =>
      new ClaudeRuntime(
        (params) => {
          canUseTool = params.options.canUseTool ?? null
          fq.cli.listen(params.prompt)
          return fq as never
        },
        async () => true,
      )
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
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-compaction-'))
    fq = new FakeQuery()
    canUseTool = null
    host = buildHost()
    sink = new RecordingSink()
  })

  afterEach(async () => {
    fq.end()
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  const eventsOfType = <T extends TranscriptEvent['type']>(
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] =>
    sink
      .events()
      .filter((event): event is Extract<TranscriptEvent, { type: T }> => event.type === type)

  const statuses = (): string[] => eventsOfType('status').map((event) => event.state)

  /**
   * The compaction window up to the silent interval.
   *
   * ⚠️ **The handshake is deliberately withheld**, which is the whole reproduction: the SDK sends
   * `system/init` only once the compaction is done, so between the send and that frame the machine
   * is `starting` with a turn it holds — the state that published nothing for ninety-one seconds.
   */
  async function compactingWithNoHandshakeYet(): Promise<string> {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, '/compact', sink)
    fq.emit(compacting())
    await waitFor(() => eventsOfType('activity').length > 0, 'the compacting activity')
    return created.sessionId
  }

  it('reads "compacting context" for the whole window, not Idle', async () => {
    await compactingWithNoHandshakeYet()

    // ⛔ **The assertion this dispatch exists for.** Before the fix this was `[]` — no status frame
    // at all — and the plate fell through to `idle`.
    expect(statuses(), 'the ninety-one seconds of silence').toEqual(['working'])
    expect(
      sink.events().some((event) => event.type === 'session'),
      'and it arrives ahead of the handshake, which is the change',
    ).toBe(false)

    // ⚑ **Folded from the events this session really sent.** `status` frames and `activity` refines
    // (099): the claim is the turn, and `compacting` says what KIND of busy it is.
    // ⚑ **D-017b · and no line under it**: a live provider draws nothing (`05` rule 5).
    const surface = surfaceOf(sink)
    expect(surface.facets).toEqual({ doing: 'compacting' })
    expect(surface.standing).toBe('working')
    expect(surface.pill?.word).toBe('compacting context')

    // The state persists throughout the silent interval.
    //
    // ⛔ **136: this paragraph said "a rate-limit error must not disturb compaction" and emitted a
    // second COMPACTING STATUS.** It proved that a duplicate does not duplicate `working`, which is
    // worth proving, and nothing at all about the error. Both are here now, each under the sentence
    // it actually demonstrates (137).
    fq.emit({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      session_id: 'sess_provider_1',
      uuid: 'u_compacting_2',
    } as unknown as SDKMessage)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(surfaceOf(sink).facets.doing, 'the face changed while nothing did').toBe('compacting')
    expect(statuses(), 'a repeated compacting re-published a fact that had not changed').toEqual([
      'working',
    ])

    // At `+90,847 ms`, the error in `normalize.ts`’s input shape becomes an informational,
    // non-fatal `error` row. It changes neither the claim nor the visible state.
    fq.emit({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day' },
    } as unknown as SDKMessage)
    await waitFor(() => eventsOfType('error').length === 1, 'the rate-limit notice')

    expect(
      eventsOfType('error').map((event) => event.fatal),
      'it ended the session',
    ).toEqual([false])
    expect(eventsOfType('error')[0]?.message).toContain('rate limit')
    expect(statuses(), 'a notice published a status').toEqual(['working'])
    expect(surfaceOf(sink).facets.doing, 'a notice changed the face').toBe('compacting')
  })

  it('ends with one working status, the compaction numbers and one idle status', async () => {
    const id = await compactingWithNoHandshakeYet()

    fq.emit(compactResult())
    fq.emit(init('sess_provider_1', join(userData, 'scratch', id)))
    fq.emit(boundary())
    fq.emit(result())
    await waitFor(() => statuses().at(-1) === 'idle', 'the compaction finishing')

    // ⛔ **One `working`, and it is the one at the START.** The defect was not a missing status but
    // a late one; a second published at the handshake would mean the derivation had been re-asserted
    // rather than derived.
    expect(statuses()).toEqual(['working', 'idle'])
    expect(eventsOfType('turn').map((event) => event.state)).toEqual(['completed'])

    // ⚑ **§3: the result data already exists and is already drawn.** `CompactionEntry.vue` renders
    // `≈89.9k → 6.7k` from exactly this row; nothing here rebuilds it, and this pins that the fix
    // left it alone.
    expect(eventsOfType('compaction')).toEqual([
      {
        type: 'compaction',
        before: 89945,
        after: 6687,
        trigger: 'manual',
        source: 'compact_boundary',
      },
    ])

    // The ending stays chatter, deliberately (087): `compact_result` says the compaction finished
    // and `compact_boundary` is already the durable record with the numbers on it.
    expect(
      eventsOfType('unknown').filter((event) => event.label === 'status'),
      'the compact_result was promoted to something it does not know',
    ).toHaveLength(1)

    // …and the session is usable, which is what the whole minute and a half was about.
    expect(surfaceOf(sink).facets).toEqual({ doing: 'idle' })
  })

  it('does not promote an idle session — 099’s rule, still shut', async () => {
    // ⛔ **The rule this fix must not have weakened**, and the direction that makes it matter: an
    // `activity` arriving with no claim behind it stays a refinement of nothing. 099 measured what
    // believing it costs — a plate claiming a running agent at a conversation finished ninety
    // seconds earlier — and the census says `thinking` and `waiting` are the phases that really do
    // arrive that way, 434 times in this ledger.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do the thing', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    fq.emit(result())
    await waitFor(() => statuses().at(-1) === 'idle', 'the turn ending')

    // A phase landing after the turn is over. It is the stalest fact on the surface and it may not
    // be the one that wins.
    fq.emit(compacting())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(statuses().at(-1), 'an activity published a status').toBe('idle')
    expect(surfaceOf(sink).facets.doing, '099’s bug, rebuilt one layer down').toBe('idle')
    expect(surfaceOf(sink).pill, 'a pill at a session with nothing running').toBeNull()
  })

  it('an ordinary turn is unchanged — the paired positive', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do the thing', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    fq.emit(says('working on it'))
    await waitFor(() => eventsOfType('assistant_message').length === 1, 'the reply')
    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending')

    // The same two statuses this app has always published for a plain exchange.
    expect(statuses()).toEqual(['working', 'idle'])
    expect(eventsOfType('turn').map((event) => event.state)).toEqual(['completed'])
    expect(surfaceOf(sink).facets).toEqual({ doing: 'idle' })
  })

  it('never spends the attention channel, and a card raised inside it still does', async () => {
    await compactingWithNoHandshakeYet()

    // ⛔ **Never amber, in the sense 080 means it**: amber is how this app says *the person is
    // needed*, and a compaction needs nobody. `needingFor` reads permissions, questions and the plan
    // go-ahead — a compaction touches none of the three, so the badge is unreachable from here.
    const busy = surfaceOf(sink)
    expect(busy.facets.needing, 'a compaction claimed the attention channel').toBeUndefined()
    expect(STANDING_TONE[busy.standing]).toBe('live')

    // ⚠️ **The activity pill's own tone IS amber here, and that is 089's deliberate rule rather than
    // a leak of the one above.** `PILL_TONE.compacting = 'waiting'` was set in review with its
    // reason written down — *the context window is being rewritten and the conversation cannot take
    // a turn until it is done, which is a wait even though work is happening* — and it is the same
    // "we are waiting on the provider" amber a silent turn has always drawn, not the attention
    // channel. This fix is what makes it VISIBLE for the first time: until now `activityLine`
    // returned null here, because the doing was `idle`. Asserted rather than quietly changed.
    expect(busy.pill?.tone).toBe('waiting')

    // ⚑ **And the channel still works**, which is what makes the negative above worth anything. A
    // question raised while the provider compacts is a real one, and it goes amber.
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')
    void canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Keep the plan section?', options: ['yes', 'no'] }] },
      { toolUseID: 'tu_q', signal: new AbortController().signal } as never,
    )
    await waitFor(() => eventsOfType('user_input_request').length > 0, 'the question card')

    const asking = surfaceOf(sink)
    expect(asking.facets.needing).toBe('question')
    expect(asking.standing).toBe('waiting')
    expect(STANDING_TONE[asking.standing]).toBe('waiting')
    expect(NEEDING_TOKEN.question).toBe('--accent')
  })

  it('Stop acts, and the composer holds the message instead of refusing it', async () => {
    const id = await compactingWithNoHandshakeYet()

    // ⛔ **106: no control that cannot act.** Before this fix `handle.status()` still answered its
    // initial `idle` through the whole window, so `queueMessage` took the SEND path and the adapter
    // threw *"cannot send: session is not active or a turn is in progress"* at a user who had done
    // nothing wrong. It queues now, and goes when the compaction is over (077).
    expect((await host.queueMessage(id, 'and then summarise it for me', sink)).outcome).toBe(
      'queued',
    )
    expect(
      eventsOfType('user_turn').map((event) => event.text),
      'it jumped the compaction',
    ).toEqual(['/compact'])

    // ⚑ **And Stop really reaches the provider.** `interrupt()` guards on `hasProviderWork`, which
    // is true because a turn is open — so the button was never a no-op here; what was missing was
    // the word beside it. This is the retraction 123's invariant demands, on a compaction that
    // never reports: nothing below waits on a `compact_boundary` or a handshake.
    await host.interrupt(id, sink)
    expect(fq.interrupts, 'Stop never reached the provider').toBe(1)
    await waitFor(() => eventsOfType('turn').length === 1, 'the compaction turn being stopped')
    expect(eventsOfType('turn').map((event) => event.state)).toEqual(['interrupted'])

    // The held message goes on the idle the interrupt published — the user never loses it.
    await waitFor(
      () => eventsOfType('user_turn').length === 2,
      'the queued message going after the stop',
    )
    expect(eventsOfType('user_turn').map((event) => event.text)).toEqual([
      '/compact',
      'and then summarise it for me',
    ])

    // ⚠️ **The retraction is the middle one, and asserting `at(-1) === 'idle'` would have raced the
    // release** — the host flushes the queue on exactly that event, and the flush opens a turn of
    // its own. So the whole sequence is asserted rather than its tail: claimed, retracted, and
    // claimed again for the message that was waiting.
    expect(statuses()).toEqual(['working', 'idle', 'working'])
  })

  /**
   * **What else the deleted branch changed (137, from 136 §1).**
   *
   * ⛔ 133 removed `if (this._state === 'starting') return this.turn ? null : 'idle'` and described
   * the consequence as a compaction one. 136 found it is three consequences, and that the other two
   * were **reachable through the real adapter with no fixture composing them**:
   *
   *  1. a `result` can arrive BEFORE `system/init`, and the turn's terminal now depends on that
   *     working — proved only at the machine layer, where `markStarting → beginTurn → completeTurn`
   *     is hand-composed. 136's static mutation: gate `completeTurn` on the presence of a session
   *     ref and *"the machine test still passes, the 133 host tests still pass, and a real pre-init
   *     result leaves the turn working."*
   *  2. `starting` + provider work with no local turn used to derive `idle` and now derives
   *     `working`, because `unbidden` falls through;
   *  3. every ordinary Claude first turn now publishes `working` BEFORE `session` — the post-fix
   *     134 smoke measured it on a run with no compaction in it at all.
   *
   * ⚑ None of the three is a defect. All three are contract, and a contract nothing asserts is a
   * contract the next change gets to break silently.
   */
  describe('the pre-handshake window, composed through the real adapter (137)', () => {
    it('⛔ terminalizes a turn on a `result` that beats the handshake', async () => {
      const created = await host.createSession({ provider: 'claude' }, sink)
      await host.send(created.sessionId, 'do the thing', sink)
      await waitFor(() => statuses().includes('working'), 'the turn opening before init')

      // The frame order the SDK really permits: the run loop reads `init` and any `result`
      // independently, so a turn that fails or finishes early ends without a session ref ever
      // arriving. Nothing below emits `init`.
      fq.emit(result())
      await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending before init')

      expect(eventsOfType('turn').map((event) => event.state)).toEqual(['completed'])
      expect(statuses(), 'claimed, then given back — with no handshake in between').toEqual([
        'working',
        'idle',
      ])
      // ⛔ **The premise, asserted rather than assumed.** Without this the test above could be
      // passing over an ordinary post-init turn, which is the shape every other test in this file
      // already covers.
      expect(
        sink.events().some((event) => event.type === 'session'),
        'the handshake landed after all, so this proved nothing',
      ).toBe(false)
    })

    it('claims `working` for provider work with no turn, even before the handshake', async () => {
      // 136's second consequence. `starting` + `unbidden` had no test on either side of 133: the
      // machine positive calls `active()` first, and the desktop one checks a subsequence rather
      // than the state it starts from. This is the composition itself.
      await host.createSession({ provider: 'claude' }, sink)
      expect(statuses(), 'a session that has done nothing says nothing').toEqual([])

      fq.emit(says('working on something nobody asked for'))
      await waitFor(() => statuses().length > 0, 'the unbidden claim')

      expect(statuses(), '123’s wider `working`, now reachable before init too').toEqual([
        'working',
      ])
      expect(eventsOfType('turn'), 'no turn was invented to carry it').toEqual([])
      expect(
        sink.events().some((event) => event.type === 'session'),
        'and it did not wait for the handshake',
      ).toBe(false)
    })

    it('publishes `working` BEFORE `session`, and only once', async () => {
      // 136's third: this is now every ordinary Claude first turn, not a compaction special case.
      // ⚠️ The pairing that makes it safe is the second half — `sync` compares the derived status
      // with the published one, so the handshake does not restate a claim already made.
      const created = await host.createSession({ provider: 'claude' }, sink)
      await host.send(created.sessionId, 'do the thing', sink)
      await waitFor(() => statuses().includes('working'), 'the turn opening')

      fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
      await waitFor(() => sink.events().some((event) => event.type === 'session'), 'the handshake')

      const order = sink.events().flatMap((event) => {
        if (event.type === 'status') return [`status:${event.state}`]
        return event.type === 'session' ? ['session'] : []
      })
      expect(order, 'the claim leads the handshake, and the handshake does not restate it').toEqual(
        ['status:working', 'session'],
      )
    })
  })
})
