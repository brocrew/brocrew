import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { ClaudeRuntime, FakeRuntime, type AgentRuntime } from '@brobot2/runtime'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
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
 * **123 · Working outside a turn — four minutes of real work the app called `idle`.**
 *
 * 122 removed the lie (`working` for a turn nobody could end) and left the gap, and said so: *"it is
 * not fixed, it is honest."* This is that gap, and the two consequences it had.
 *
 * ## The window is ordinary, not exotic
 *
 * Measured over the live corpus — 190 conversations, 427,343 events — with 045's own lateness query
 * (`events JOIN turn ON turn_id WHERE closed_at IS NOT NULL AND created_at > closed_at`), over the
 * content types only: **493 events arriving after their turn had closed, across 18 turns in 7
 * sessions, every one of them Claude.**
 *
 * The unfiltered corpus has 6,302 events across 52 turns, including 5,809 belonging to
 * `end_reason: unknown`. Those boundaries were repaired on resume or reconstructed on import,
 * so “after close” need not mean after an observed provider ending. Restrict the figure above
 * to `completed | failed | interrupted`: turns the app opened and saw close. Out-of-turn
 * provider work occurs under either reading.
 *
 * ⚠️ **"Every one of them Claude" has a denominator, or it would be a vacuous negative.** The same
 * query over the same corpus sees **46 Codex sessions and 103 live-recorded Codex turns, and finds
 * zero late events among them.** The query can see Codex; there is simply nothing there to see.
 *
 * ## And the terminal it ends with was landing on the wrong turn
 *
 * `sess_0bc12ca1`, 9 Aug, ordinals 410-418 — the whole defect in eight rows:
 *
 * ```
 * 410  turn interrupted   ← the user pressed Stop; 074 forces the terminal locally
 * 413  user_turn          "make it a small plan."      ← the replacement turn opens
 * 414  error              "turn failed: error_during_execution"
 * 415  turn failed        ← +15ms: the INTERRUPTED turn's own result, landing on the new turn
 * 418+ the replacement's real work, streaming outside any turn for the next three minutes
 * ```
 *
 * Of three interrupted Claude turns, the two immediately replaced at +2 ms and +3 ms
 * misattributed the terminal; the third had no following message. A successfully answered
 * replacement was recorded as `failed` and shown the predecessor’s red error.
 *
 * ⚑ **Codex does not have this defect, and the one counter-example says why.** `sess_3eb99488` turn 0
 * was interrupted and replaced 8.9 s later by a turn that completed normally — Codex correlates a
 * terminal to a `providerTurnId`, so a stale one cannot land on a turn it does not name. Claude's
 * `result` frame carries no turn id at all, which is why attribution has to be kept here. It is also
 * why every out-of-turn burst above is Claude's.
 *
 * ⚑ **Driven against the REAL Claude adapter with a scripted `Query`**, like 122's, because both
 * consequences live in the seam between the SDK's frames and the machine's bookkeeping.
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

const init = (id: string, cwd: string): SDKMessage =>
  ({ type: 'system', subtype: 'init', session_id: id, cwd }) as unknown as SDKMessage

const result = (): SDKMessage =>
  ({ type: 'result', subtype: 'success', is_error: false }) as unknown as SDKMessage

const says = (text: string): SDKMessage =>
  ({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  }) as unknown as SDKMessage

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
 * What the renderer would actually draw for this session, **folded from the events it was sent**.
 *
 * ⛔ **The first version of this hand-fed `sessionFacets` a fixture** — including an
 * `activity: {phase:'tool'}` the test's own burst never produced — so it asserted a face the live
 * conversation could not reach and could not have caught a broken mapping in between. Two reviewers
 * measured that independently. This runs the sink's real events through the real fold, so `status`,
 * `activity`, `streaming` and the open cards are the ones the burst actually created.
 *
 * `liveness` and `phase` are still supplied: they are the HOST's separate channel, not the fold's,
 * and this sink records them separately.
 */
function surfaceInput(sink: RecordingSink, liveness: SessionLiveness['state'] = 'live') {
  const state = createTranscript()
  for (const message of sink.messages) applyEvent(state, message.event, message.at)
  const needing = needingFor({ ...state.pending, planNeedsGoAhead: false })
  return {
    phase: 'open' as const,
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

describe('the provider working outside a turn (123)', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-out-of-turn-'))
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

  /** A live session whose foreground turn has ended. */
  async function afterTheTurnEnded(): Promise<string> {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'kick off the long thing in the background', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    fq.emit(result())
    await waitFor(() => statuses().at(-1) === 'idle', 'the foreground turn ending')
    return created.sessionId
  }

  /** …and then the provider wakes its own agent, exactly as `probe:out-of-turn` measured. */
  async function theBurstBegins(id: string): Promise<void> {
    fq.emit(says('[MAIN] The background run finished — here is what it found.'))
    await waitFor(() => statuses().at(-1) === 'working', `the burst in ${id}`)
  }

  it('a burst nobody asked for reads as working, and an ordinary turn is unchanged', async () => {
    const id = await afterTheTurnEnded()
    expect(statuses().at(-1), 'nothing is happening yet, and the app says so').toBe('idle')

    await theBurstBegins(id)

    // ⚑ **The state, named and rendered — in 081's existing vocabulary and with no new value.**
    // Folded from the events this session actually sent: the plate says what the agent is DOING, and
    // the one-word surfaces say `Working`. 108's precedent, applied: *share the language, not the
    // surface.* ⚑ **D-017b · and the underline draws nothing**: a provider that is running with
    // nothing to say is not a condition, and whether one runs is off every surface (`05` rule 5).
    const surface = surfaceOf(sink)
    expect(surface.facets).toEqual({ doing: 'working' })
    expect(surface.standing).toBe('working')
    // ⚠️ **And the activity pill says nothing, because nothing has told us what KIND of busy this
    // is.** A stale phase from the previous burst reaching this window would be 089's "RUNNING BASH"
    // during a reply; `transcript.ts` clears `activity` on `idle` so it cannot.

    // ⚠️ **The status reaches the wire BEFORE the content that provoked it, and that ordering is
    // load-bearing rather than incidental.** `noteProviderWork` publishes re-entrantly through the
    // delta coalescer, so the `working` is queued ahead of the message. It matches every other
    // boundary in this app — `status: working` lands before `user_turn` at every turn boundary in
    // the ledger — and the alternative puts one content event on screen under a stale `idle`.
    const wire = sink.events().map((event) => event.type)
    const firstBurstMessage = wire.lastIndexOf('assistant_message')
    const lastStatus = wire.lastIndexOf('status')
    expect(lastStatus, 'the burst’s content arrived under a stale idle').toBeLessThan(
      firstBurstMessage,
    )

    // ⚠️ **Why the plain `working` face is honest here and was not before.** The dispatch's objection
    // — *"a user who did not start this cannot stop it, and `working` implies they could"* — is
    // answered by making it stoppable, not by inventing a seventh face for provenance. 081 has three
    // axes and none of them is "whose idea was this"; who started the work is a fact about the
    // transcript above, where the missing `user_turn` already says it.
    await host.interrupt(id, sink)
    expect(fq.interrupts, 'Stop did not reach the provider').toBe(1)
    await waitFor(() => statuses().at(-1) === 'idle', 'the burst being stopped')
  })

  it('an ordinary turn is unchanged — the paired positive', async () => {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do the thing', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    fq.emit(says('working on it'))
    await waitFor(() => eventsOfType('assistant_message').length === 1, 'the reply')
    // Mid-turn, the surface reads exactly what a burst reads — which is the point: the app draws
    // what the provider is doing, and the two are the same fact about the same agent.
    expect(surfaceOf(sink).facets).toEqual({ doing: 'working' })

    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending')

    // One turn, one terminal, and the same two statuses this app has always published for a plain
    // exchange. Nothing about 123 touches the path a user actually starts.
    expect(eventsOfType('turn').map((event) => event.state)).toEqual(['completed'])
    expect(statuses()).toEqual(['working', 'idle'])
    expect(surfaceOf(sink).facets).toEqual({ doing: 'idle' })
  })

  it('a burst does not inherit the tool the LAST one was running', async () => {
    // ⛔ **089's sentence, reachable again, and a reviewer found it before it shipped.** The pill used
    // to say "RUNNING BASH" while the model was already replying; 099 fixed that by letting `status`
    // frame and `activity` only refine. But `activity` is cleared by exactly two events — `turn` and
    // `user_turn` — and a burst has NEITHER: it ends with a provider terminal that draws no turn
    // boundary. So the phase it left behind survived, inert while the session read `idle`, and went
    // live again the moment the NEXT burst latched `working`. `transcript.ts` now clears it on
    // `idle`: a session that is not working is not doing anything.
    const id = await afterTheTurnEnded()

    // Burst 1 runs a tool, and ends.
    fq.emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_read', name: 'Read', input: { file_path: '/tmp/a' } },
        ],
      },
    } as never)
    await waitFor(() => eventsOfType('tool_call').length > 0, 'the tool the first burst ran')
    expect(surfaceOf(sink).pill?.detail, 'the pill never named the running tool').toBe('Read')
    fq.emit(result())
    await waitFor(() => statuses().at(-1) === 'idle', 'the first burst ending')

    // Burst 2, thirty seconds later in the live shape, opens with text and no tool of its own.
    await theBurstBegins(id)
    const pill = surfaceOf(sink).pill
    expect(
      pill?.detail,
      'the pill named a tool that finished in a burst that has already ended',
    ).toBeUndefined()
    expect(pill?.word ?? 'working').toBe('working')
  })

  it('the burst is never amber, and a card raised inside it still is', async () => {
    const id = await afterTheTurnEnded()
    await theBurstBegins(id)

    // ⛔ **Never amber** (080): amber is the attention channel and nothing here is waiting on the
    // person. A burst is something HAPPENING, which is blue — on the plate, on the word surfaces,
    // and on the one thing that can go amber without a card, the activity pill's own tone.
    const busy = surfaceOf(sink)
    expect(busy.facets.needing, 'a burst claimed the attention channel').toBeUndefined()
    expect(STANDING_TONE[busy.standing]).toBe('live')
    expect(busy.pill?.tone ?? 'live').toBe('live')

    // ⚑ **The exception 108 already carved, and it survives.** A card raised in this window IS
    // waiting on the user, and that one counts — which is only true because the wait count is
    // published whether or not a turn is open (122).
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')
    void canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Run another variant?', options: ['yes', 'no'] }] },
      { toolUseID: 'tu_q', signal: new AbortController().signal } as never,
    )
    await waitFor(() => eventsOfType('user_input_request').length > 0, 'the question card')
    expect(statuses().at(-1)).toBe('waiting_permission')

    // ⚑ **Derived from the fold, not hand-fed** — so the link from the `user_input_request` this
    // burst just raised to the amber badge is tested rather than asserted by construction.
    const asking = surfaceOf(sink)
    expect(asking.facets.needing).toBe('question')
    expect(asking.standing).toBe('waiting')
    expect(STANDING_TONE[asking.standing]).toBe('waiting')
    expect(NEEDING_TOKEN.question).toBe('--accent')

    // ⚠️ **The one amber this window CAN reach without a card, named rather than denied.** After two
    // minutes of provider silence the session's BEING becomes `silent`, whose 081 token is
    // `--waiting` — the same amber a silent TURN has always drawn. 123 widened the state that arms
    // that clock; it did not give the burst an amber of its own, and the distinction is worth
    // keeping straight: it is the "we are waiting on the provider" amber, not the attention channel.
    // ⚑ **D-017b** — the paired control: a `live` provider draws no underline at all, so the
    // `silent` amber above is the clock's and nothing else's.
    expect(sessionFacets({ ...surfaceInput(sink, 'silent') }).being).toBe('silent')
    expect(sessionFacets({ ...surfaceInput(sink, 'live') }).being).toBeUndefined()
  })

  it('Stop in the out-of-turn CARD state settles the card and gives the composer back', async () => {
    // ⛔ **The state where the button was DRAWN and did nothing** (122 §11.2). 094 gates the stop
    // button on `frozen` — a turn parked on a card — and `ConversationPane` reports `frozen` for any
    // open card, turn or no turn. `interrupt()` then returned on its first line because
    // `hasActiveTurn` was false.
    const id = await afterTheTurnEnded()
    await theBurstBegins(id)
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')
    const answered = canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Run another variant?', options: ['yes', 'no'] }] },
      { toolUseID: 'tu_q', signal: new AbortController().signal } as never,
    )
    await waitFor(() => eventsOfType('user_input_request').length > 0, 'the question card')
    expect(statuses().at(-1)).toBe('waiting_permission')

    await host.interrupt(id, sink)

    // ⛔ **Three assertions, because "not a no-op" needs all three.** The provider was told; the card
    // the agent was blocked on was settled rather than left hanging (085); and the conversation is
    // usable again.
    expect(fq.interrupts, 'Stop never reached the provider').toBe(1)
    expect(await answered, 'the card was left hanging').toMatchObject({ behavior: 'deny' })
    await waitFor(() => statuses().at(-1) === 'idle', 'the composer coming back')

    // 🔴 **F080 — the burst was a turn, the provider's own, and the Stop ends it as one**:
    // `interrupted` on this app's word. ⛔ Until F080 no turn was written for it, and a wake that ran
    // a whole loop left nothing in the turn table at all.
    expect(eventsOfType('turn').map((event) => [event.state, event.startedBy])).toEqual([
      ['completed', undefined],
      ['interrupted', 'the-provider'],
    ])
  })

  it('a message typed into the window is queued, and goes when the provider finishes', async () => {
    const id = await afterTheTurnEnded()
    await theBurstBegins(id)

    // The composer reads `busy` here, so this is the button the user actually presses.
    expect(
      (await host.queueMessage(id, 'while you are there, check the other file', sink)).outcome,
    ).toBe('queued')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      eventsOfType('user_turn').map((event) => event.text),
      'it jumped the burst',
    ).toEqual(['kick off the long thing in the background'])

    // ⚑ **The burst's own terminal is the boundary it waits for.** Measured on the wire: an unbidden
    // burst ends with exactly one `result/success` (`probe:out-of-turn`, +27.1 s after the turn that
    // preceded it).
    fq.emit(result())
    await waitFor(
      () =>
        eventsOfType('user_turn').some(
          (event) => event.text === 'while you are there, check the other file',
        ),
      'the queued message going once the burst ended',
    )
    expect(eventsOfType('message_unqueued').map((event) => event.reason)).toEqual(['sent'])
  })

  it('a message that lands mid-burst still gets its own terminal', async () => {
    // ⛔ **Reproduced by a reviewer through this exact harness, and it stranded the conversation.**
    // `host.send` gates only on `ended`/`errored`, so a renderer a moment stale can open a turn while
    // a burst is latched. `completeTurn` weighs the burst first — so the NEW turn's own terminal was
    // spent on a burst that, for a sub-agent straggler, was never going to send one (122 §2). The
    // turn never closed and every later send was refused.
    const id = await afterTheTurnEnded()
    await theBurstBegins(id)

    await host.send(id, 'while you are there, check the other file', sink)
    await waitFor(
      () => eventsOfType('user_turn').length === 2,
      'the message landing during the burst',
    )
    fq.emit(says('checking'))
    fq.emit(result())

    await waitFor(() => eventsOfType('turn').length === 2, 'the new turn getting its own terminal')
    expect(eventsOfType('turn').map((event) => event.state)).toEqual(['completed', 'completed'])
    await waitFor(() => statuses().at(-1) === 'idle', 'the session settling')
  })

  it('a queued message survives a burst that never ends, and Stop releases it', async () => {
    // ⚠️ **The case the queue promise depends on, and nothing covered it.** Queueing says the message
    // goes when the provider finishes; a burst with no terminal never does. The way out has to be a
    // control the user can press, and Stop publishes the `idle` the flush waits for.
    const id = await afterTheTurnEnded()
    await theBurstBegins(id)
    expect((await host.queueMessage(id, 'never mind, do this instead', sink)).outcome).toBe(
      'queued',
    )

    await host.interrupt(id, sink)
    await waitFor(
      () => eventsOfType('user_turn').some((event) => event.text === 'never mind, do this instead'),
      'the queued message going once the burst was stopped',
    )
    // ⛔ `cancelled` is the word that must not appear: the app may not throw away a message the user
    // wrote (085).
    expect(eventsOfType('message_unqueued').map((event) => event.reason)).toEqual(['sent'])
  })

  it('closing a conversation mid-burst tells the provider to stop', async () => {
    // ⚠️ **Teardown used to skip the interrupt entirely when no turn was open**, so a session closed
    // while the provider was mid-thought was simply stopped being read from and the SDK reaped
    // underneath it. `close()` asks the same question `interrupt()` does now: is anything running.
    const id = await afterTheTurnEnded()
    await theBurstBegins(id)

    await host.close(id, sink)
    expect(fq.interrupts, 'the provider was never told the conversation was going away').toBe(1)
  })

  it('the previous burst’s terminal does not close the turn that replaced it', async () => {
    // ⛔ **The live defect, reproduced: `sess_0bc12ca1` 410-415 and `sess_6b4380fa` turn 1.**
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'make a plan', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    fq.emit(says('thinking about the plan'))

    // Stop, and send instead — the composer's interrupt-and-send (074/077).
    await host.sendInterrupting(created.sessionId, 'make it a small plan.', sink)
    await waitFor(
      () => eventsOfType('user_turn').some((event) => event.text === 'make it a small plan.'),
      'the replacement turn',
    )
    expect(eventsOfType('turn').map((event) => event.state)).toEqual(['interrupted'])
    expect(statuses().at(-1)).toBe('working')

    // …and now the terminal the SDK owed for the turn that was stopped. In the ledger it arrived
    // 15 ms after the replacement began, and closed it as `failed`.
    fq.emit(result())
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(
      eventsOfType('turn').map((event) => event.state),
      'the replacement turn was closed by the terminal of the one it replaced',
    ).toEqual(['interrupted'])
    expect(
      eventsOfType('error').map((event) => event.message),
      'the stopped turn’s failure was reported against the message that replaced it',
    ).toEqual([])
    expect(statuses().at(-1)).toBe('working')

    // …and the paired positive: the replacement's OWN terminal still closes it, normally.
    fq.emit(says('here is the small plan'))
    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 2, 'the replacement turn ending')
    expect(eventsOfType('turn').map((event) => event.state)).toEqual(['interrupted', 'completed'])
    await waitFor(() => statuses().at(-1) === 'idle', 'the session settling')
  })

  it('a debt the provider never pays is dropped, not carried into the next turn', async () => {
    // ⚠️ **The bound on the fix above, and the reason it is not a new way to strand a conversation.**
    // If the stopped turn's terminal never comes, the debt must not sit there waiting to eat a real
    // one — 122's stranding, arriving from the other side. It is handed to the turn that opens next
    // and to no other: the machine carries it on the turn, not on itself.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'first', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')

    await host.interrupt(created.sessionId, sink)
    await waitFor(() => statuses().at(-1) === 'idle', 'the turn being stopped')
    // The provider's terminal for it lands with nothing open — dropped in silence (122), and the
    // debt retired with it.
    fq.emit(result())
    await new Promise((resolve) => setTimeout(resolve, 20))

    await host.send(created.sessionId, 'second', sink)
    await waitFor(() => statuses().at(-1) === 'working', 'the next turn')
    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 2, 'the next turn ending normally')
    expect(eventsOfType('turn').map((event) => event.state)).toEqual(['interrupted', 'completed'])
  })
})

/**
 * Recovery of a stranded conversation on reopen.
 *
 * 122 ended with an offer rather than a measurement: *"Reading `resumeSession` plus the new
 * derivation, reopening it on a build with 122 publishes a fresh `idle` and it becomes usable. Not
 * measured end to end."* ⛔ A promise about recovery is exactly the thing this project keeps proving
 * wrong, so it is pinned here.
 *
 * Write the ledger directly to test recovery against the recorded shape rather than the
 * current producer. The skeleton is a completed turn, then out-of-turn work, then unretracted
 * `status: working`. All transcript text is synthetic and contains no personal session
 * content.
 *
 * ⚠️ **An earlier version of this comment said the shape "can no longer be produced by running the
 * app — which is the point", and a reviewer showed that 123 is exactly what makes it producible
 * again.** §3 exempted the durable COLUMN, not the ledger: a burst publishes `status: working` into
 * the event stream, so a session killed mid-burst leaves these two rows for real. That makes this
 * test MORE relevant than when it was written, not less — and it is why the assertion below is about
 * the fresh `idle` that lands after the replay, rather than about the replay being clean.
 */
describe('a conversation whose ledger ends on a phantom `working` (123 §4)', () => {
  const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let runtimes: Map<string, FakeRuntime>

  function buildHost(): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => {
        const existing = runtimes.get(provider)
        if (existing) return existing
        const fresh = new FakeRuntime(provider)
        runtimes.set(provider, fresh)
        return fresh
      },
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    runtimes = new Map()
    dir = mkdtempSync(join(tmpdir(), 'brobot2-stranded-recovery-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('is usable again when it is reopened', async () => {
    const host = buildHost()
    const sink = new RecordingSink()
    const created = await host.createSession({ provider: 'codex' }, sink)
    await host.send(created.sessionId, 'run the wide fan-out thing', sink)
    // The Fake parks on a permission card mid-turn; answering it is what lets the turn finish.
    await waitFor(
      () => store.events(created.sessionId).some((e) => e.event.type === 'permission_request'),
      'the card the Fake raises mid-turn',
    )
    await host.respondPermission(created.sessionId, 'turn_1_perm', { outcome: 'allow' }, sink)
    await waitFor(
      () => store.events(created.sessionId).some((e) => e.event.type === 'turn'),
      'the first turn to finish',
    )

    // The stranded tail, appended straight to the ledger: work with no turn behind it, and then the
    // `working` that had nothing left to retract it.
    const at = Date.now()
    const ordinal = store.events(created.sessionId).length + 100
    store.append(
      created.sessionId,
      ordinal,
      { type: 'assistant_message', text: '[MAIN] Done — 7 agents, 3 phases.' },
      at,
    )
    store.append(created.sessionId, ordinal + 1, { type: 'status', state: 'working' }, at + 1)

    // ⚠️ **The durable column never believed it, and that is 045 working as designed** — it is a view
    // of the turn table, and no turn is open. The stranding was in the event STREAM, which is what a
    // reopened conversation replays into the fold. ⛔ It is also 123 §3's cost, stated: while the app
    // was running, that stream said `working` and this column said `idle`.
    expect(store.recorded().find((row) => row.sessionId === created.sessionId)?.status).toBe('idle')
    const replayedTail = store
      .events(created.sessionId)
      .filter((e) => e.event.type === 'status')
      .at(-1)
    expect(replayedTail?.event).toMatchObject({ state: 'working' })

    await host.close(created.sessionId, sink)

    // A brand-new host, as if the app had been quit and relaunched on a build with 123.
    const relaunched = buildHost()
    const live = new RecordingSink()
    const resumed = await relaunched.resumeSession(created.sessionId, live)

    // ⚑ **The phantom is overwritten by a live one, and the conversation takes a message.** The
    // replayed history still ends on `working` — the ledger is append-only and that really is what
    // happened — so what makes the session usable is the fresh `idle` the machine publishes on the
    // handshake, landing after it.
    const finalStatus = [...resumed.history.entries, ...live.messages]
      .filter((entry) => entry.event.type === 'status')
      .at(-1)
    expect(finalStatus?.event).toMatchObject({ state: 'idle' })
    await relaunched.send(created.sessionId, 'so what did it find?', live)
    expect(
      live.messages.some(
        (m) => m.event.type === 'user_turn' && m.event.text === 'so what did it find?',
      ),
      'the reopened conversation would not take a message',
    ).toBe(true)
    await relaunched.close(created.sessionId, live)
  })
})
