import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { ClaudeRuntime, type AgentRuntime } from '@brobot2/runtime'
import type { Options, PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * A stranded turn must have a way to end.
 *
 * The live shape, from a clone of `sess_6b4380fa` (12 Aug 00:33), reduced to the events that
 * decide it:
 *
 * ```
 * 302  turn completed   ← the foreground turn really did end…
 * 303  status idle           …and the Workflow it had launched went on running
 * …    ~230 events of main-agent work — Read, Bash, Write, two replies — with NO user_turn,
 *      no turn open, and no `parent_tool_use_id`: the provider woke its own agent (116)
 * 545  tool_call        AskUserQuestion
 * 548  status waiting_permission
 * 552  user_decision    rejected
 * 553  status working   ← published by the wait lease, with no turn behind it
 * 556-569  the model's whole reply. Then nothing. NO turn. NO idle.
 * 570  message_queued   "i was testing the reject button…"
 * 571  message_unqueued reason: cancelled
 * ```
 *
 * ⛔ **The `working` at 553 could never be retracted.** `SessionMachine.completeTurn` returned
 * early on a null turn, so the provider's own terminal — `result/success`, measured on the wire
 * 2,490 ms after a rejected `AskUserQuestion` by `probe:reject-question` — was dropped in silence.
 * From there `send` refused, `interrupt()` returned immediately because there was no turn to
 * interrupt, and the queue flush waits for an `idle` that could not arrive. The message at 570 had
 * no way out of the app; 571 is the user cancelling it himself, which is the only control that
 * produces `reason: 'cancelled'`.
 *
 * ⚑ **Driven against the REAL Claude adapter with a scripted `Query`**, not against `FakeRuntime`,
 * because the defect lives in the seam between the adapter's `canUseTool` await and the machine's
 * turn bookkeeping. A double would have had to reproduce that seam to be wrong in the same way.
 */

class FakeQuery {
  readonly sent: SDKMessage[] = []
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

  async interrupt(): Promise<void> {}
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
  types(): string[] {
    return this.events().map((event) => event.type)
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

describe('a provider that goes on working after its turn ended (122)', () => {
  let userData: string
  let host: RuntimeHost
  let sink: RecordingSink
  let fq: FakeQuery
  /**
   * The adapter's own `canUseTool`, taken off the `Options` it hands the SDK.
   *
   * ⚠️ **Called directly rather than through `sdkToolCall`'s hook model**, because the question here
   * is what the LIFECYCLE does while the callback is awaited, not whether policy would have reached
   * it. `claude-runtime.test.ts` owns the second question and models the hooks for it; duplicating
   * that model here would tie a lifecycle regression to a policy fixture.
   */
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-stranded-'))
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

  /** A session whose foreground turn has ended while the provider carries on talking. */
  async function afterTheTurnEnded(): Promise<string> {
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'where is it?', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    fq.emit(result())
    await waitFor(() => statuses().includes('idle'), 'the foreground turn ending')
    // The provider now wakes its own main agent — no user turn. ⚠️ It DOES publish a fresh
    // `working` as of 123; this helper predates that, and the assertion at the end of each test is
    // where the difference is stated.
    fq.emit(says('[MAIN] Done — 7 agents, 3 phases, 192s wall clock.'))
    await waitFor(
      () => eventsOfType('assistant_message').length > 0,
      'the provider working outside a turn',
    )
    return created.sessionId
  }

  /**
   * Raise the out-of-turn question the way the SDK does, and wait for the card.
   *
   * ⚠️ The pending call is returned INSIDE an object: `await` flattens a promise of a promise, so
   * handing the bare one back would make every caller block on an answer nobody has given yet.
   */
  async function askOutOfTurn(id: string): Promise<{ answered: Promise<PermissionResult | null> }> {
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')
    const answered = canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Run another variant?', options: ['yes', 'no'] }] },
      { toolUseID: 'tu_q', signal: new AbortController().signal } as never,
    )
    await waitFor(() => eventsOfType('user_input_request').length > 0, 'the question card')
    expect(statuses().at(-1), 'a card is open, and the session says so').toBe('waiting_permission')
    expect(id).toBeTruthy()
    return { answered }
  }

  it('a REJECTED question outside a turn leaves a session the user can act from', async () => {
    const id = await afterTheTurnEnded()
    const { answered } = await askOutOfTurn(id)

    await host.respondUserInput(id, 'tu_q', { kind: 'reject' }, sink)
    expect(await answered).toMatchObject({ behavior: 'deny' })

    // ⛔ **This was `working` and nothing could ever take it back; 122 made it `idle`; 123 makes it
    // `working` again, and the difference is what can now END it.** 122's word was defensible — no
    // turn is open — and it was still the wrong thing to say, because the provider is mid-burst and
    // about to reply. What made `idle` the safer answer then was that `working` promised a Stop
    // button that did nothing. It does something now, so the truer word is available.
    await waitFor(() => statuses().at(-1) === 'working', 'the session going back to the burst')

    // The provider finishes its reply and sends its own terminal, exactly as the wire probe
    // measured. It must reconcile nothing and invent nothing.
    const turnsBefore = eventsOfType('turn').length
    fq.emit(says('[MAIN] Understood — no follow-up run.'))
    fq.emit(result())
    await waitFor(() => eventsOfType('assistant_message').length > 1, 'the reply after the refusal')
    await waitFor(() => statuses().at(-1) === 'idle', 'the burst ending')

    // 🔴 **F080 — the burst is the provider's own turn, and its own `result` ends it.** Before F080
    // no `turn` was written here, so the ledger had no record of a loop the provider ran by itself.
    // ⚑ One ending, `completed`, marked as the provider's: nothing reconciled, nothing invented.
    expect(eventsOfType('turn').slice(turnsBefore)).toEqual([
      expect.objectContaining({ state: 'completed', startedBy: 'the-provider' }),
    ])
  })

  it('an APPROVE cannot be recorded as a REJECT — the two outcomes have separate causes (140)', async () => {
    // Two `ExitPlanMode` declines can produce identical `user_decision{outcome:'rejected'}`
    // rows regardless of what led to them. Test the structural question: an APPROVE must
    // never be recorded as a rejection. The input shape enforces that distinction:
    //
    //  1. `outcome` is derived from the response's own discriminant — `kind === 'answer'` →
    //     `'answered'`, everything else → `'rejected'` — and the two are built at two separate call
    //     sites in `UserInputCard.vue` (`{kind:'answer',answers}` and `{kind:'reject'}`). There is
    //     no path that rewrites one into the other, and the union is re-validated at the IPC
    //     boundary (128).
    //  2. The row is written only AFTER the handle resolves. A failing approve throws out of
    //     `refuseAnswer` and writes NOTHING — never a reject.
    //
    // ⛔ **This comment used to end with a third paragraph, and 141 refuted it.** It said an approve
    // the adapter refuses *"still records `answered`, because the ledger records what the user did
    // and the tool result records what came of it — those are two facts and they stay two"*. They
    // were not two facts; they were one contradiction, written down twice. `Answered` on a card is
    // not a note about a gesture, it is the app stating that a human answer reached the provider —
    // and the provider had been told the opposite. 142 §1 is that finding, and the test below is
    // what it left: the refusal now happens before anything is recorded at all.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'ask me something', sink)
    fq.emit(init('sess_provider_2', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')

    const answered = canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Red or blue?', options: ['red', 'blue'] }] },
      { toolUseID: 'tu_q', signal: new AbortController().signal } as never,
    )
    await waitFor(() => eventsOfType('user_input_request').length > 0, 'the question card')
    const request = eventsOfType('user_input_request')[0]!

    // An APPROVE carrying nothing usable: refused at the gesture (142), so NO row is written — and
    // the refusal comes back as an ACK saying the card survived it (146), never as a throw.
    expect(
      await host.respondUserInput(
        created.sessionId,
        'tu_q',
        {
          kind: 'answer',
          answers: { [request.questions[0]!.id]: '' },
        },
        sink,
      ),
    ).toMatchObject({ outcome: 'refused', stillOpen: true })
    expect(
      eventsOfType('user_decision'),
      'an answer the adapter would not forward is not a decision',
    ).toEqual([])

    // …and an approve for a request that is GONE writes no row at all — not a reject. ⚠️ **The
    // paired negative for `stillOpen`**: this refusal really did consume nothing, but the request
    // is not there to answer again, so settling the card is the correct reading of it.
    expect(
      await host.respondUserInput(
        created.sessionId,
        'tu_gone',
        { kind: 'answer', answers: {} },
        sink,
      ),
    ).toMatchObject({ outcome: 'refused', stillOpen: false })
    expect(eventsOfType('user_decision'), 'a failed approve is silent, never a rejection').toEqual(
      [],
    )

    // ⚠️ **The paired positive, and it is what makes the two `toEqual([])` above non-vacuous**: the
    // card was live the whole time, and a usable answer records `answered` and nothing else.
    await host.respondUserInput(
      created.sessionId,
      'tu_q',
      {
        kind: 'answer',
        answers: { [request.questions[0]!.id]: 'red' },
      },
      sink,
    )
    expect(await answered).toMatchObject({ behavior: 'allow' })
    expect(eventsOfType('user_decision').map((e) => e.outcome)).toEqual(['answered'])

    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending')
  })

  /**
   * **142 §1 — the UI-reachable variant, end to end through `RuntimeHost`.**
   *
   * ⛔ **A whitespace-only option label is legal in the pinned SDK type** — `options[].label` is
   * merely `string`, and nothing in `AskUserQuestionInput` forbids `"   "`. Selecting it is an
   * ordinary click: `chosen().length` is 1, so `UserInputCard`'s Answer button enables, and
   * `answer()` emits the label verbatim. The adapter then finds an answer that says nothing.
   *
   * ⚠️ **Driven through the host on purpose.** 139's own test called the handle directly, which is
   * exactly why it could prove the provider was denied and never see that the ledger disagreed —
   * *"the new test bypasses `RuntimeHost`, so it proves provider denial and never observes the
   * contradictory ledger"* (141). The contradiction only exists where both halves are.
   */
  it('a whitespace-only option label NEVER BECOMES A CARD, and the model is told why (150)', async () => {
    // ⛔ **148 M6, and the PM ruled: fix it.** This used to publish the card and refuse the ANSWER,
    // which left a chip on screen that could be clicked forever: `pick` stored the blank, `chosen`
    // trimmed it away, `aria-pressed` reverted, Answer stayed disabled, and the explanatory hint
    // renders only for multi-select. **A control that cannot act** (106).
    //
    // 148's smallest correct fix, adopted: safe-decline the malformed request in the adapter before
    // any card exists — the same route 064 uses for a question with nothing to ask and 146 for two
    // questions sharing an answer key. What the user sees is no card at all; what the model gets is
    // a sentence it can act on.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'ask me something', sink)
    fq.emit(init('sess_provider_3', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')

    const declined = await canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Which one?',
            multiSelect: false,
            options: [{ label: '   ' }, { label: 'the real one' }],
          },
        ],
      },
      { toolUseID: 'tu_ws', signal: new AbortController().signal } as never,
    )
    expect(declined).toMatchObject({ behavior: 'deny' })
    expect((declined as { message: string }).message).toContain('blank')
    // ⛔ No card, and nothing recorded — the turn carries on and the model can retry.
    expect(eventsOfType('user_input_request'), 'no card was published').toEqual([])
    expect(eventsOfType('user_decision'), 'and nothing was decided').toEqual([])

    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending')
  })

  it('…and a MEANINGFUL label of spaces still round-trips byte for byte — the paired positive', async () => {
    // ⚠️ **The labels are never trimmed, renamed or filtered** (143/146). Only a label that is
    // NOTHING but whitespace is unanswerable; ` leading` and `trailing ` and a non-breaking space
    // are choices somebody deliberately wrote, and deleting one would change what the model asked.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'ask me something', sink)
    fq.emit(init('sess_provider_5', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')

    const answered = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Which one?',
            multiSelect: false,
            options: [{ label: ' the spaced one ' }, { label: ' nbsp ' }],
          },
        ],
      },
      { toolUseID: 'tu_kept', signal: new AbortController().signal } as never,
    )
    await waitFor(() => eventsOfType('user_input_request').length > 0, 'the question card')
    const request = eventsOfType('user_input_request')[0]!
    expect(request.questions[0]!.options).toEqual([
      { label: ' the spaced one ' },
      { label: ' nbsp ' },
    ])
    await host.respondUserInput(
      created.sessionId,
      'tu_kept',
      {
        kind: 'answer',
        answers: { [request.questions[0]!.id]: [' the spaced one '] },
      },
      sink,
    )
    expect(await answered).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Which one?': ' the spaced one ' } },
    })

    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending')
  })

  it('an answer that says NOTHING is still refused at the gesture, and the card stays live (142 §1)', async () => {
    // ⚑ **146 §1's refusal path, unchanged and still reachable** — which is why the test moved off
    // the blank label rather than going away with it. The options here are perfectly answerable; it
    // is the ANSWER that says nothing, and that can still arrive from a stored or imported card,
    // from the read-only pane, or from a renderer that sent an empty selection.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'ask me something', sink)
    fq.emit(init('sess_provider_4', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')

    const answered = canUseTool(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Which one?',
            multiSelect: false,
            options: [{ label: 'the other one' }, { label: 'the real one' }],
          },
        ],
      },
      { toolUseID: 'tu_ws', signal: new AbortController().signal } as never,
    )
    await waitFor(() => eventsOfType('user_input_request').length > 0, 'the question card')
    const request = eventsOfType('user_input_request')[0]!
    expect(request.questions[0]!.options).toEqual([
      { label: 'the other one' },
      { label: 'the real one' },
    ])

    const refused = await host.respondUserInput(
      created.sessionId,
      'tu_ws',
      {
        kind: 'answer',
        answers: { [request.questions[0]!.id]: [] },
      },
      sink,
    )
    expect(eventsOfType('user_decision'), 'nothing was answered, so nothing is recorded').toEqual(
      [],
    )
    // ⛔ And the sentence the user gets is the host's, never the adapter's diagnostic: no request id,
    // no phase, no question ids (085).
    //
    // ⛔ **`stillOpen` is the whole point of this test now** (146, from 145 HIGH 1). The adapter
    // left this request pending on purpose; the host says so here; and the renderer had no way to
    // hear it, so it settled the card and left the provider blocked with nothing on screen to
    // answer. `session-store.test.ts` and `user-input-refusal.dom.test.ts` assert the other end.
    expect(refused).toEqual({
      outcome: 'refused',
      reason: 'that answer cannot be sent: every question needs one that says something',
      stillOpen: true,
    })

    // The card is still live and still says so — the session never left `waiting_permission`.
    expect(statuses().at(-1)).toBe('waiting_permission')
    await host.respondUserInput(
      created.sessionId,
      'tu_ws',
      {
        kind: 'answer',
        answers: { [request.questions[0]!.id]: ['the real one'] },
      },
      sink,
    )
    expect(await answered).toMatchObject({
      behavior: 'allow',
      updatedInput: { answers: { 'Which one?': 'the real one' } },
    })
    expect(eventsOfType('user_decision').map((e) => e.outcome)).toEqual(['answered'])

    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending')
  })

  it('an ACCEPTED question inside a turn still behaves exactly as it did', async () => {
    // ⚠️ **The paired positive.** Everything above is about a question raised with no turn open;
    // this is the ordinary path, which must not have moved: waiting → working → the turn's own
    // terminal → idle, with the answer forwarded to the provider.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'ask me something', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')

    const answered = canUseTool(
      'AskUserQuestion',
      { questions: [{ question: 'Red or blue?', options: ['red', 'blue'] }] },
      { toolUseID: 'tu_q', signal: new AbortController().signal } as never,
    )
    await waitFor(() => eventsOfType('user_input_request').length > 0, 'the question card')
    const request = eventsOfType('user_input_request')[0]!
    expect(statuses().at(-1)).toBe('waiting_permission')

    await host.respondUserInput(
      created.sessionId,
      'tu_q',
      {
        kind: 'answer',
        answers: { [request.questions[0]!.id]: 'red' },
      },
      sink,
    )
    // The answer reaches the provider in its own vocabulary, and the session goes back to work.
    expect(await answered).toMatchObject({ behavior: 'allow' })
    await waitFor(() => statuses().at(-1) === 'working', 'the session working again')

    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending')
    expect(eventsOfType('turn')[0]?.state).toBe('completed')
    expect(statuses()).toEqual(['working', 'waiting_permission', 'working', 'idle'])
  })

  it('the message typed after the refusal is SENT, not left waiting for an idle that never comes', async () => {
    const id = await afterTheTurnEnded()
    const { answered } = await askOutOfTurn(id)

    // Type while the card is open, when the composer queues the message.
    expect((await host.queueMessage(id, 'what is the wide fan-out thing?', sink)).outcome).toBe(
      'queued',
    )

    await host.respondUserInput(id, 'tu_q', { kind: 'reject' }, sink)
    expect(await answered).toMatchObject({ behavior: 'deny' })

    // ⚑ **It waits for the provider to actually finish, and 123 is why that changed.** Under 122 the
    // refusal alone published `idle` and the flush went straight out — into the middle of a burst
    // the app could not see, where the burst's own `result` was free to close the new turn (the
    // defect measured twice in the live ledger). Now the burst holds the session on `working`, so
    // the message goes at the boundary the provider draws rather than at the one we guessed.
    fq.emit(result())

    await waitFor(
      () =>
        eventsOfType('user_turn').some((event) => event.text === 'what is the wide fan-out thing?'),
      'the queued message being sent',
    )
    // ⛔ **`cancelled` is the word that must not appear.** It is produced by exactly one thing —
    // `cancelQueuedMessage`, the user's own control — and a message that reaches this state having
    // been thrown away means the app took a decision the user never made (085).
    expect(eventsOfType('message_unqueued').map((event) => event.reason)).toEqual(['sent'])
  })

  it('a queued message does not jump a card the turn ended underneath (077 acceptance 6)', async () => {
    // ⛔ **The hole two reviewers measured, and it PRE-DATES 122** — it reproduces at `3fa3f83^`
    // too. `runtime-host.ts`'s first door says *"none is emitted while a card is open, so on the
    // ordinary path the flush is never even attempted"*, and the second door reads the same
    // derivation, so when a provider `result` closed a turn with a card still open BOTH opened at
    // once and the queued message went out past it. A background workflow makes that ordering
    // ordinary rather than exotic.
    //
    // The first version of 122 made it worse by design — `takeTurn` cleared the wait count so the
    // contract's "terminal turn → idle" could be kept verbatim — which is what put this test here.
    const created = await host.createSession({ provider: 'claude' }, sink)
    await host.send(created.sessionId, 'do the thing', sink)
    fq.emit(init('sess_provider_1', join(userData, 'scratch', created.sessionId)))
    await waitFor(() => statuses().includes('working'), 'the turn opening')
    if (!canUseTool) throw new Error('the adapter never handed the SDK a canUseTool')

    // A card raised inside the turn, and deliberately left unanswered.
    const pending = canUseTool('Bash', { command: 'echo hi' }, {
      toolUseID: 'tu_a',
      signal: new AbortController().signal,
    } as never)
    await waitFor(() => eventsOfType('permission_request').length > 0, 'the card')
    expect(statuses().at(-1)).toBe('waiting_permission')

    expect(
      (await host.queueMessage(created.sessionId, 'must not go while a card is open', sink))
        .outcome,
    ).toBe('queued')

    // The provider's terminal arrives on its own schedule, with the card still on screen.
    fq.emit(result())
    await waitFor(() => eventsOfType('turn').length === 1, 'the turn ending under the card')
    await new Promise((resolve) => setTimeout(resolve, 30))

    // ⛔ The turn really ended, the session is still waiting on the user, and the message stayed put.
    expect(statuses().at(-1), 'the session claimed nothing was waiting on the user').toBe(
      'waiting_permission',
    )
    expect(eventsOfType('message_unqueued'), 'the queued message jumped the card').toEqual([])
    expect(eventsOfType('user_turn').map((event) => event.text)).toEqual(['do the thing'])

    // …and the paired positive: answering the card is what lets it go.
    await host.respondPermission(created.sessionId, 'tu_a', { outcome: 'allow' }, sink)
    await pending
    await waitFor(
      () =>
        eventsOfType('user_turn').some(
          (event) => event.text === 'must not go while a card is open',
        ),
      'the queued message going once the card was answered',
    )
    expect(eventsOfType('message_unqueued').map((event) => event.reason)).toEqual(['sent'])
  })

  it('every `working` it publishes is one it can retract', async () => {
    // The general form of the defect, and the one a future refactor is most likely to reintroduce:
    // any lifecycle status published by something other than the machine can be stranded. The
    // liveness tracker arms its 120s silence window on `working`, so a phantom one also produces a
    // stall notice about a provider that is not being asked for anything.
    //
    // ⚠️ **The invariant is the retraction, not the abstinence** (123, narrowing 122's version of
    // this test). 122 asserted that a `working` with no turn behind it is never published at all,
    // which was true of the fix it shipped and is not the deeper rule — the app now publishes
    // exactly that, on purpose. What must hold is that every one of them has something that ends
    // it: here, the provider's own terminal for the burst.
    const id = await afterTheTurnEnded()
    const openedAt = statuses().length
    const { answered } = await askOutOfTurn(id)
    await host.respondUserInput(id, 'tu_q', { kind: 'reject' }, sink)
    await answered
    await waitFor(() => statuses().at(-1) === 'working', 'the session returning to the burst')
    fq.emit(result())
    await waitFor(() => statuses().at(-1) === 'idle', 'the session settling')

    expect(statuses().slice(openedAt)).toEqual(['waiting_permission', 'working', 'idle'])
  })
})

/**
 * **Who is allowed to say what a session is doing (122).**
 *
 * 042 measured three writers of `status` and named that as the root of the idle bug; 045 gave the
 * durable COLUMN one source of truth and left the event stream with all three. The stranding above
 * is what the remaining two cost. The repair is structural — the machine derives every `status`
 * from the session state, the turn, and the wait count — and a structural repair needs a
 * structural guard, or the next adapter that wants to announce something will simply emit one.
 *
 * ⚠️ **A census rather than a unit test, for the same reason `provider-neutrality.test.ts` is one:**
 * no behavioural test can fail because a NEW file started publishing statuses.
 */
describe('one writer for `status` (122)', () => {
  /**
   * ⛔ **Every source tree the app ships, not the two the defect happened to live in.** The first
   * draft scanned `src/main` and `packages/runtime/src`; a reviewer added an emitter to
   * `src/shared/runtime-ipc.ts` and the census stayed green. The renderer is the realistic place
   * for a third writer to reappear — `transcript.ts` already applies status events — so it is
   * scanned too, `.vue` included.
   */
  const REPO = join(__dirname, '..', '..', '..')
  const ROOTS = [
    join(REPO, 'apps', 'desktop', 'src'),
    join(REPO, 'packages', 'runtime', 'src'),
    join(REPO, 'packages', 'shared', 'src'),
    join(REPO, 'packages', 'orchestration', 'src'),
  ]
  const OWNER = join('internal', 'session-machine.ts')

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return sources(path)
      return /\.(ts|vue)$/.test(path) ? [path] : []
    })
  }

  /**
   * The property name of one member, however it was written — `type`, `'type'` or `['type']`.
   *
   * ⛔ **The quoted and computed forms were both invisible until 137**, because this read
   * `ts.isIdentifier(prop.name)` and nothing else: `{ "type": 'status' }` has a name that is a
   * string literal, so the member was skipped entirely and the whole object went uncounted. 136
   * named both, and neither costs anything to read.
   */
  function memberName(prop: ts.ObjectLiteralElementLike): string | null {
    const name = prop.name
    if (!name) return null
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
    if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression))
      return name.expression.text
    return null
  }

  /**
   * How many `{ type: 'status', … }` object literals one file CONSTRUCTS — found on the AST, not
   * with a regex.
   *
   * ⛔ **Two regex censuses were defeated in review before this existed, and both failures were
   * measured rather than argued.** Stripping comments with `/\*[\s\S]*?\*\//` treats the `/*`
   * inside an ordinary glob string — `'**' + '/*.ts'` — as the start of a comment, which swallows
   * every emitter written after it until the next close-comment anywhere in the file: a reviewer added a
   * real rogue emitter behind one and the census passed 5/5. And matching `type:\s*'status'` misses
   * `"status"` and `{ type }` shorthand while matching an explanatory comment that merely mentions
   * the shape. A parser has no opinion about any of that.
   *
   * ⚠️ **What it deliberately does NOT read, stated because a guard's blind spot is part of what it
   * claims — and the boundary has to be one the code actually honours.** A `type` whose value is a
   * CALL — `{ type: z.literal('status') }` — is not counted. Measured before choosing: counting
   * calls too lights up the zod declarations in `packages/runtime/src/events.ts`, and a census that
   * reports the schema as a writer is a census nobody will keep green. Declaring the shape is not
   * emitting it (136). **Everything else is counted**, whether or not this can read it: shorthand,
   * a bare identifier, a property access, a ternary. Measured across all four roots — that costs
   * three theme effect/catalogue objects, whose complete AST prints are pinned below.
   *
   * ⛔ **The first version of that sentence was a lie by omission, and review caught it.** It named
   * the call as the single blind spot while the code also dropped `as const`, `satisfies` and a
   * parenthesized literal — and `{ type: 'status' as const }` is not exotic here:
   * `packages/runtime/src/claude/normalize.ts` already writes `type: 'workflow_run' as const` in a
   * hoisted object, where the assertion is REQUIRED to stop the discriminant widening. A status
   * writer composed that way was invisible. {@link unwrapAssertions} is why it is not any more, and
   * it also keeps `'workflow_run' as const` correctly UNcounted, because unwrapping reaches the
   * string rather than giving up on it.
   *
   * `.vue` is handled by taking the `<script>` CONTENTS — a template cannot construct an event.
   * ⚠️ The contents and not the whole match: this used to hand `<script setup lang="ts">…</script>`
   * to the TypeScript parser, which is error-tolerant enough to say nothing about it (136).
   */
  function statusObjects(path: string): string[] {
    const raw = readFileSync(path, 'utf8')
    const source = path.endsWith('.vue')
      ? [...raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((hit) => hit[1]).join('\n')
      : raw
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const found: string[] = []
    const printer = ts.createPrinter({ removeComments: true })
    const record = (node: ts.ObjectLiteralExpression): void => {
      found.push(printer.printNode(ts.EmitHint.Expression, node, file))
    }
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
          if (memberName(prop) !== 'type') continue
          // Shorthand (`{ type, state }`) counts: it is an object claiming a `type` this census
          // cannot read, and the point is to make a new writer visible rather than to be clever.
          if (ts.isShorthandPropertyAssignment(prop)) record(node)
          else if (!ts.isPropertyAssignment(prop)) continue
          else {
            const value = unwrapAssertions(prop.initializer)
            if (ts.isStringLiteralLike(value)) {
              if (value.text === 'status') record(node)
            } else if (!ts.isCallExpression(value)) record(node)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    return found
  }

  function statusLiterals(path: string): number {
    return statusObjects(path).length
  }

  // These complete objects describe theme effects, not session events. Every other candidate
  // remains counted, including another object in either of these files.
  const NON_STATUS = new Map<string, readonly string[]>([
    [
      join('apps', 'desktop', 'src', 'shared', 'themes', 'catalogue.ts'),
      ['{ type, params: entries(EFFECT_PARAMS[type]) }'],
    ],
    [
      join('apps', 'desktop', 'src', 'shared', 'themes', 'validate.ts'),
      [
        `{
    type: { kind: 'choice', values: ['linear', 'radial'], says: '', required: true },
    angle: { kind: 'number', min: 0, max: 360, unit: '', says: '' },
    stops: { kind: 'text', max: 0, says: '' },
}`,
        '{ type, ...params }',
      ],
    ],
  ])

  /**
   * The expression under any number of type assertions — `'status' as const`, `'status' satisfies
   * string`, `('status')`, `x!`.
   *
   * ⚠️ **Not cosmetic, and not a widening either.** Every one of these wraps a value the census can
   * already read; without unwrapping they made it UNREADABLE, so a real writer went uncounted and an
   * unrelated `'workflow_run' as const` would have been counted the moment the fallback widened.
   * Reaching the literal settles both directions at once.
   */
  function unwrapAssertions(node: ts.Expression): ts.Expression {
    let value = node
    for (;;) {
      if (
        ts.isAsExpression(value) ||
        ts.isSatisfiesExpression(value) ||
        ts.isParenthesizedExpression(value) ||
        ts.isNonNullExpression(value) ||
        ts.isTypeAssertionExpression(value)
      ) {
        value = value.expression
        continue
      }
      return value
    }
  }

  /**
   * The status writers among census candidates: every print still standing once each exempt print
   * is taken away ONCE per time it is exempted, so a second copy of an exempt object is still seen.
   */
  function writers(
    candidates: readonly { path: string; prints: readonly string[] }[],
  ): (readonly [string, number])[] {
    return candidates
      .map(({ path, prints }) => {
        const exempt = [...(NON_STATUS.get(path) ?? [])]
        const left = prints.filter((print) => {
          const at = exempt.indexOf(print)
          if (at === -1) return true
          exempt.splice(at, 1)
          return false
        })
        return [path, left.length] as const
      })
      .filter(([, count]) => count > 0)
  }

  it('is constructed in exactly one PLACE in the whole app', () => {
    const files = ROOTS.flatMap(sources)
    // ⚠️ **The census must have something to census.** A `sources()` that stopped walking would
    // return an empty list and every assertion below would pass over nothing.
    expect(files.length, 'the census found no source files at all').toBeGreaterThan(300)

    // ⛔ **The COUNT, not `count > 0`, and that is 137 repairing this guard rather than restating
    // it.** 136: *"a second `this.say({ type: 'status', … })` inside session-machine.ts leaves the
    // result unchanged"* — because the old assertion mapped every count to a filename and compared
    // the list. 122's whole point was one writer, and a guard that cannot see the second writer is
    // worse than the sentence it replaced.
    const candidates = files.map((path) => ({
      path: path.slice(REPO.length + 1),
      prints: statusObjects(path),
    }))
    const nonStatus = candidates.flatMap(({ path, prints }) =>
      prints.filter((print) => NON_STATUS.get(path)?.includes(print)).map((print) => [path, print]),
    )
    expect(nonStatus).toEqual(
      [...NON_STATUS].flatMap(([path, prints]) => prints.map((print) => [path, print])),
    )
    expect(nonStatus).toHaveLength(3)
    const sites = writers(candidates)
    expect(sites, 'something other than the session machine constructs a status event').toEqual([
      [join('packages', 'runtime', 'src', 'internal', 'session-machine.ts'), 1],
    ])
    expect(sites[0]?.[0].endsWith(OWNER)).toBe(true)
  })

  it('⛔ …and a status emitter beside an exempt theme object is still a writer', () => {
    // The exemption is the exact objects, once each; nothing about the file or its count. A rogue
    // `{ type: 'status' }` added to the theme module, or to a file that merely looks like it, is
    // reported like any other writer.
    const rogue = `\nconst rogue = { type: 'status', state: 'working' }\n`
    const probe = (real: string, extra: string): string[] => {
      const file = join(tmpdir(), `brobot2-census-theme-${process.pid}.ts`)
      writeFileSync(file, `${readFileSync(join(REPO, real), 'utf8')}${extra}`)
      try {
        return statusObjects(file)
      } finally {
        rmSync(file, { force: true })
      }
    }
    const catalogue = join('apps', 'desktop', 'src', 'shared', 'themes', 'catalogue.ts')
    const validate = join('apps', 'desktop', 'src', 'shared', 'themes', 'validate.ts')
    expect(
      writers([{ path: catalogue, prints: probe(catalogue, '') }]),
      'the module as it is',
    ).toEqual([])
    expect(writers([{ path: catalogue, prints: probe(catalogue, rogue) }])).toEqual([
      [catalogue, 1],
    ])
    expect(writers([{ path: validate, prints: probe(validate, rogue + rogue) }])).toEqual([
      [validate, 2],
    ])
    // A second copy of an exempt object is not exempt twice.
    expect(
      writers([
        { path: validate, prints: probe(validate, '\nconst again = { type, ...params }\n') },
      ]),
    ).toEqual([[validate, 1]])
    // A fictional catalogue beside the real one carries no exemption at all.
    const elsewhere = join('apps', 'desktop', 'src', 'shared', 'themes', 'catalogue-copy.ts')
    expect(writers([{ path: elsewhere, prints: probe(catalogue, rogue) }])).toEqual([
      [elsewhere, 2],
    ])
  })

  it('…and the census can actually see one, in every form a writer could take', () => {
    // ⛔ **The paired positive.** Everything above is an assertion that a set is EMPTY except for
    // one known file — the shape that passes hardest when the detector has quietly stopped
    // detecting. This runs the same parser over source that really does construct a status event,
    // including the forms the regex version missed and the three 136 found this one missing.
    const rogue = [
      `const a = { type: 'status', state: 'idle' }`,
      `const b = { type: "status", state: 'idle' }`,
      `const type = 'status'; const c = { type, state: 'idle' }`,
      // …and the glob that defeated the regex stripper, ahead of a real emitter.
      `const glob = '**` + `/*.ts'\nconst d = { type: 'status', state: 'idle' }\n/** doc */`,
      // 136's three: a quoted key, a computed key, and a value this census cannot read.
      `const e = { "type": 'status', state: 'idle' }`,
      `const f = { ['type']: 'status', state: 'idle' }`,
      `const STATUS = 'status'; const g = { type: STATUS, state: 'idle' }`,
      // …and 137's own review: the assertion forms, one of which this repo already uses.
      `const h = { type: 'status' as const, state: 'idle' }`,
      `const i = { type: 'status' satisfies string, state: 'idle' }`,
      `const j = { type: ('status'), state: 'idle' }`,
      `const k = { type: cond ? 'status' : 'idle', state: 'idle' }`,
    ].join('\n')
    const file = join(tmpdir(), `brobot2-census-probe-${process.pid}.ts`)
    writeFileSync(file, rogue)
    try {
      expect(statusLiterals(file)).toBe(11)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('…and does not count a DIFFERENT event asserted the same way — the paired negative', () => {
    // ⛔ The bound on the widening above, and the reason it is an unwrap rather than "count anything
    // that is not a call". `packages/runtime/src/claude/normalize.ts` really does write
    // `type: 'workflow_run' as const` in a hoisted object — required there, or the discriminant
    // widens to `string` — and a census that reported it would be red on the day it landed.
    const file = join(tmpdir(), `brobot2-census-other-${process.pid}.ts`)
    writeFileSync(
      file,
      [
        `const common = { type: 'workflow_run' as const, taskId: 't' }`,
        `const schema = { type: z.literal('status'), state: z.string() }`,
      ].join('\n'),
    )
    try {
      expect(statusLiterals(file), 'the census reported a writer of something else').toBe(0)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('…and it can see one in a `.vue` file, which is where a third writer would appear', () => {
    // ⛔ **136: the Vue extractor was exercised only by a `.ts` paired positive.** The renderer is
    // the realistic home for a new emitter — `transcript.ts` already applies status events — so the
    // half of the census that reads single-file components needs its own probe, or scanning `.vue`
    // at all is a claim rather than a check.
    const file = join(tmpdir(), `brobot2-census-vue-${process.pid}.vue`)
    writeFileSync(
      file,
      [
        `<template><p>{{ type }}</p></template>`,
        `<script setup lang="ts">`,
        `const rogue = { type: 'status', state: 'idle' }`,
        `</script>`,
        `<style scoped>.p { color: red }</style>`,
      ].join('\n'),
    )
    try {
      expect(statusLiterals(file), 'a status event constructed inside a component').toBe(1)
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('…and a SECOND construction in the owner file is what the count exists to catch', () => {
    // ⛔ **AC4, made a test rather than a claim.** The census's whole value is that adding one more
    // `say({ type: 'status' })` beside the existing one turns it red. Run over the real owner plus
    // one line, so the arithmetic is the file's own and not a fixture's.
    const owner = join(REPO, 'packages', 'runtime', 'src', 'internal', 'session-machine.ts')
    expect(statusLiterals(owner), 'the owner has exactly the one this suite allows').toBe(1)

    const file = join(tmpdir(), `brobot2-census-second-${process.pid}.ts`)
    const owned = readFileSync(owner, 'utf8')
    try {
      writeFileSync(file, `${owned}\nconst rogue = { type: 'status', state: 'idle' }\n`)
      expect(statusLiterals(file), 'a second writer in the SAME file is visible').toBe(2)
      // ⛔ **And the same writer wearing the assertion this repo already uses.** Review found this
      // one escaping: `as const` made the second site invisible and BOTH assertions above stayed
      // green with two real writers in the owner file.
      writeFileSync(file, `${owned}\nconst rogue = { type: 'status' as const, state: 'idle' }\n`)
      expect(statusLiterals(file), 'a second writer behind `as const` is visible').toBe(2)
    } finally {
      rmSync(file, { force: true })
    }
  })
})
