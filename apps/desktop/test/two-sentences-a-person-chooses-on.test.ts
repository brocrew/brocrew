import { readFileSync } from 'node:fs'
import type { CanUseTool, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import {
  ClaudeRuntime,
  type ClaudeSessionHandle,
  CodexRuntime,
  PLAN_CONSENTS,
  type ClaudeQuery,
  type CodexIncoming,
  type CodexTransport,
  type PermissionOutcome,
  type PlanConsent,
  type RuntimeEvent,
} from '@brobot2/runtime'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  completedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
} from '../../../packages/runtime/test/fixtures/codex-protocol'
import { answerFor } from '../src/renderer/src/lib/attention'
import { permissionOffer } from '../src/renderer/src/lib/permission-offer'
import type { UserInputRequestEvent } from '../src/renderer/src/lib/transcript'
import {
  CANCEL_STOPS_NOTHING,
  consentAsked,
  userInputOffer,
  whatThisAnswerDoes,
  type AttentionDecision,
  type ConsentAsked,
} from '../src/renderer/src/lib/user-input-offer'
import type { UserInputQuestion } from '../src/shared/runtime-ipc'

/**
 * # 478 · Two sentences a person chooses on
 *
 * ⛔ **Both were false, and a person picks an answer by reading them.**
 *
 * | before | what it left out |
 * |---|---|
 * | *"the request is cancelled"* | **both adapters interrupt the WHOLE TURN**, before they answer at all |
 * | *"the request is approved with no answer"* | it describes the PAYLOAD — three different acts share that payload |
 *
 * ## ⚠️ What this file is for, and what it deliberately is not
 *
 * ⛔ **It is not a second copy of the sentences.** `every-answer-and-what-it-actually-did.test.ts`
 * (476) already holds an independent literal oracle for every one of them, and duplicating that
 * here would be two tables to keep in step. ⚑ **What is missing, and what this file is, is the
 * JOIN**: the sentence a person reads and the thing it promises, asserted in one place, against the
 * real adapters rather than against a description of them.
 *
 * ## 🔴 Both providers, separately — §1.3 of the dispatch
 *
 * ⚠️ *"If a sentence is true on one and not the other, it is false."* So §2 drives the REAL
 * `ClaudeRuntime` and the REAL `CodexRuntime` over their own fake seams and asserts the same two
 * clauses on each: the request is refused, and the turn ends interrupted.
 *
 * ⚑ **The Codex literals come from `packages/runtime/test/fixtures/codex-protocol.ts`**, which is
 * `satisfies`-checked against the vendored protocol — so this file cannot drift into the
 * hand-written partials `053` removed, even though it lives in another project.
 *
 * ## ⛔ The register these sentences are in, because `465`'s rule asks
 *
 * ⚠️ **They are PROMISES, and the app's one register vocabulary has no member for that.**
 * `DIGEST_REGISTERS` is `observed | claimed | unknown` and it orders lines by PROVENANCE — what the
 * engine watched outranks what an agent said. ⛔ A promise has no provenance; it has a derivation.
 * ⚑ So a fourth member there would be wrong, and the opinion these sentences need is the one this
 * file supplies: every clause is joined to the code that performs it. `430`'s narrowing is the
 * bound — the instant effect only — and `WHAT_COMES_AFTER_IS_NOT_OURS` is where the rest is
 * admitted to be unknowable.
 */

/* ------------------------------------------------------------------ §0 · the two seams, minimal */

/** A queue with an async iterator — the shape both seams hand the adapter. */
class Wire<T> implements AsyncIterable<T> {
  private readonly waiting: T[] = []
  private settle: ((result: IteratorResult<T>) => void) | null = null
  private closed = false
  push(item: T): void {
    const settle = this.settle
    if (settle) {
      this.settle = null
      settle({ value: item, done: false })
      return
    }
    this.waiting.push(item)
  }
  close(): void {
    this.closed = true
    const settle = this.settle
    if (settle) {
      this.settle = null
      settle({ value: undefined as never, done: true })
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        if (this.waiting.length > 0) return { value: this.waiting.shift() as T, done: false }
        if (this.closed) return { value: undefined as never, done: true }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.settle = resolve
        })
      },
    }
  }
}

/** The SDK `Query` stand-in: scripted messages in, `interrupt()` counted. */
class FakeQuery implements ClaudeQuery {
  readonly messages = new Wire<SDKMessage>()
  interrupts = 0
  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    this.interrupts++
    return undefined
  }
  async close(): Promise<void> {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over(this.messages[Symbol.asyncIterator]())
  }

  /** ⚑ F080: it reads what the adapter sends, and each `result` names the message it answers. */
  readonly cli = new TheCliAnswersInOrder()
}

/** The codex app-server stand-in: a conformant handshake, and every write back recorded. */
class FakeTransport implements CodexTransport {
  private readonly queue = new Wire<CodexIncoming>()
  private turnSeq = 0
  lastTurnId = ''
  readonly responses: { id: string | number; result: unknown }[] = []
  /**
   * ⚑ **492 · every RPC this adapter sent, in order.** ⛔ The double recorded only what it answered,
   * so *"no `turn/interrupt` was sent"* was unaskable here — and that is the exact claim
   * `HO-032` §5 asks this door to keep while the agent-tool door stops keeping it.
   */
  readonly methods: string[] = []
  request(method: string, params?: unknown): Promise<unknown> {
    this.methods.push(method)
    if (method === 'thread/start' || method === 'thread/resume') {
      const cwd = ((params ?? {}) as { cwd?: string }).cwd ?? '/tmp/x'
      return Promise.resolve(threadStartResponse('th_1', cwd) as unknown as Record<string, unknown>)
    }
    // A conformant app-server attests the CODEX_HOME it adopted (P1-H) and reports its version in
    // the userAgent's first token (043); this file launches at `/tmp/x/home`.
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: '/tmp/x/home',
      })
    }
    if (method === 'turn/start') {
      this.lastTurnId = `tn_${++this.turnSeq}`
      return Promise.resolve(turnStartResponse(this.lastTurnId))
    }
    return Promise.resolve({})
  }
  notify(): void {}
  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result })
  }
  respondError(id: string | number, code: number, message: string): void {
    this.responses.push({ id, result: { error: { code, message } } })
  }
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  /** A notification, as the app-server pushes one. */
  notification(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  /** A server request as a conformant app-server scopes it (061): this thread, this turn. */
  serverRequest(id: number, method: string, params: Record<string, unknown>): void {
    this.queue.push({
      kind: 'request',
      id,
      method,
      params: { threadId: 'th_1', turnId: this.lastTurnId, ...params },
    })
  }
  exited: Promise<void> | undefined
}

async function waitUntil(pred: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function collect(
  handle: { events(): AsyncIterable<RuntimeEvent> },
  sink: RuntimeEvent[],
): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

/** The newest `user_input_request` this window saw, narrowed — the shape §3 and §4 assert on. */
const cardIn = (events: RuntimeEvent[]): UserInputRequestEvent => {
  const last = events.filter((e) => e.type === 'user_input_request').at(-1)
  if (!last) throw new Error('no user_input_request reached the window')
  return last
}

const permissionIdIn = (events: RuntimeEvent[]): string => {
  const last = events.filter((e) => e.type === 'permission_request').at(-1)
  if (!last) throw new Error('no permission_request reached the window')
  return last.id
}

const toolOpts = (toolUseID: string) => ({
  toolUseID,
  signal: new AbortController().signal,
  requestId: `r_${toolUseID}`,
})

interface ClaudeSeam {
  handle: Awaited<ReturnType<ClaudeRuntime['start']>>
  query: FakeQuery
  canUse: CanUseTool
  events: RuntimeEvent[]
  consumer: Promise<void>
}

/**
 * A live Claude session with one turn open — the only state a permission card can exist in.
 *
 * ⚑ `planMode` is a LAUNCH option because that is the only door this handle has: the floor is
 * adopted at the start of a turn (`NextTurnSetting`), and `SessionHandle` exposes no setter a test
 * could reach. §3's ExitPlanMode case needs the floor UP before it can prove approving takes it
 * down.
 */
async function claudeInATurn(planMode = false): Promise<ClaudeSeam> {
  const query = new FakeQuery()
  let canUse: CanUseTool | undefined
  const runtime = new ClaudeRuntime(
    (params: { prompt: AsyncIterable<unknown>; options: Options }) => {
      canUse = params.options.canUseTool
      query.cli.listen(params.prompt)
      return query
    },
    async () => true,
  )
  const handle = await runtime.start({
    cwd: '/tmp/x',
    providerHome: '/tmp/x/home',
    ...(planMode ? { planMode: true } : {}),
  })
  const events: RuntimeEvent[] = []
  const consumer = collect(handle, events)
  if (!canUse) throw new Error('the adapter wired no canUseTool')
  await handle.send('go')
  query.emit({ type: 'system', subtype: 'init', session_id: 'sess_1', cwd: '/tmp/x' })
  await waitUntil(() => events.some((e) => e.type === 'session'), 'the session event')
  return { handle, query, canUse, events, consumer }
}

interface CodexSeam {
  handle: Awaited<ReturnType<CodexRuntime['start']>>
  transport: FakeTransport
  events: RuntimeEvent[]
  consumer: Promise<void>
}

/** The same, on the other adapter: a live session with one turn open. */
async function codexInATurn(): Promise<CodexSeam> {
  const transport = new FakeTransport()
  const runtime = new CodexRuntime(() => transport)
  const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
  const events: RuntimeEvent[] = []
  const consumer = collect(handle, events)
  await handle.send('go')
  await waitUntil(
    () => events.filter((e) => e.type === 'status').at(-1)?.state === 'working',
    'the turn to be working',
  )
  return { handle, transport, events, consumer }
}

const turnStatesIn = (events: RuntimeEvent[]): string[] =>
  events.filter((e) => e.type === 'turn').map((e) => e.state)

/* ----------------------------------------------- §1 · every request a one-click answer is about */

/** One `user_input_request`, built whole. */
const asking = (
  questions: UserInputQuestion[],
  over: Partial<UserInputRequestEvent> = {},
): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_1',
  prompt: 'the agent asks',
  questions,
  ...over,
})

/**
 * 🔴 **Every request kind a queue answer can be about, derived from the adapters.**
 *
 * ⛔ **Not from `476`'s two examples**, which named a Codex grant and *"a Claude Enter/ExitPlanMode
 * consent"* as though the second were one thing. ⚑ **The producers are named in the response** —
 * `item/permissions/requestApproval`, `EnterPlanMode`, `ExitPlanMode`, `AskUserQuestion` and
 * `item/tool/requestUserInput` — and what this table holds is the part a SENTENCE turns on: which
 * discriminator the request carries, as a `Record` so a new member does not compile until it has
 * a fixture.
 */
const EVERY_CONSENT: Readonly<Record<ConsentAsked, UserInputRequestEvent>> = {
  // Codex `item/permissions/requestApproval` — `questions: []` plus a neutral grant scope.
  'access-for-this-turn': asking([], {
    permission: { cwd: '/work', paths: ['write /work/out'], network: false },
  }),
  // Claude `EnterPlanMode`, as a row written before `736` carries it (R98: no card since). The
  // model asked to START planning.
  'start-planning': asking([], { consent: 'start-planning' }),
  // Claude `ExitPlanMode` — the model asks to LEAVE plan mode and get on with it.
  'stop-planning': asking([], { consent: 'stop-planning' }),
  // ⛔ Neither field. A row written before 478, replayed by the fold — `477`'s population.
  'a-consent-this-window-cannot-name': asking([]),
}

describe('§1 · what a zero-question card is a consent TO, and it is the request that says', () => {
  it('🔴 every consent kind is classified off the request, and no two share a sentence', () => {
    const said = new Map<ConsentAsked, string>()
    for (const [kind, request] of Object.entries(EVERY_CONSENT) as [
      ConsentAsked,
      UserInputRequestEvent,
    ][]) {
      expect(consentAsked(request), `${kind} was classified as something else`).toBe(kind)
      const offer = userInputOffer(request)
      const approve = offer.decisions[0]
      expect(approve).toEqual({ kind: 'approve', label: 'Approve', consent: kind })
      said.set(kind, whatThisAnswerDoes(approve as AttentionDecision))
    }
    // ⛔ **The distinctness check, because a set whose members must differ needs one.** Four keys
    // mapping to three sentences is the defect this dispatch exists to close, wearing a `Record`.
    expect(new Set(said.values()).size, `${[...said.values()].join(' | ')}`).toBe(said.size)
  })

  it('🔴 …and each says WHICH act, because distinctness alone passes on a clean swap', () => {
    // ⚠️ **Written because the mutation table found the hole.** `478` M5 swaps the two plan
    // sentences — every member still differs from every other, so the check above is satisfied and
    // the one press that lets an agent start running commands reads as the press that stops it.
    // ⛔ **A comparison tested where both sides agree measures nothing**; these are the words.
    const says = (kind: ConsentAsked): string =>
      whatThisAnswerDoes({ kind: 'approve', label: 'Approve', consent: kind })

    // ⚑ **728 · R93** — the floor these words described is gone, so they say the provider's plan
    // mode moving, and nothing about what the agent does next (430).
    expect(says('start-planning')).toContain('starts planning')
    expect(says('start-planning')).toContain('the provider’s own plan mode')
    expect(says('stop-planning')).toContain('stops planning')
    expect(says('stop-planning')).toContain('its plan mode ends')
    // ⚑ And the paired negative in the same breath: neither carries the other's verb, so a swap
    // fails on both rows rather than on whichever this file happened to check first.
    expect(says('start-planning')).not.toContain('stops planning')
    expect(says('stop-planning')).not.toContain('starts planning')

    // ⛔ The grant's own bound, which is the fact `codexGrant` puts on the wire as `scope: 'turn'`.
    expect(says('access-for-this-turn')).toContain('for this turn and no longer')
    // ⛔ And the gap admits it is one rather than borrowing a real member's confidence.
    expect(says('a-consent-this-window-cannot-name')).toContain('cannot say what else')
  })

  it('⚠️ …and a grant is asked FIRST, so a Codex widening is never read as a plan card', () => {
    // `question-channel.ts`'s own ordering, and its reason: `a-consent-with-nothing-to-answer`
    // would also catch a grant, and would report a sandbox widening in a plan card's words (340).
    const both = asking([], {
      permission: { paths: ['write /etc'], network: true },
      consent: 'stop-planning',
    })
    expect(consentAsked(both)).toBe('access-for-this-turn')
  })

  it('⛔ a question is never a consent — the Approve predicate is still the question count', () => {
    // 213's defect, guarded from the other side: adding a discriminator must not make a request
    // WITH questions approvable, and must not take Approve off one that asks nothing.
    const question: UserInputQuestion = {
      id: 'q0',
      prompt: 'which?',
      options: [{ label: 'this' }, { label: 'that' }],
    }
    const withQuestions = userInputOffer(asking([question], { consent: 'stop-planning' }))
    expect(withQuestions.positive).toBe('Answer')
    expect(withQuestions.decisions.some((decision) => decision.kind === 'approve')).toBe(false)
    expect(userInputOffer(asking([])).positive).toBe('Approve')
  })

  it('⚑ the vocabulary is closed, and the runtime half of it is the runtime’s', () => {
    // A member added to `PLAN_CONSENTS` and not to the renderer's union is a compile error above;
    // this is the paired runtime-side fact, so the two cannot drift by one silently.
    const fromTheRuntime: readonly ConsentAsked[] = PLAN_CONSENTS
    expect([...fromTheRuntime]).toEqual(['start-planning', 'stop-planning'])
    const declared: PlanConsent = 'stop-planning'
    expect(consentAsked(asking([], { consent: declared }))).toBe(declared)
  })
})

/* ------------------------------------- §2 · what Cancel does, on both adapters, beside its words */

/** The sentence under the Cancel button, taken from the production function and nowhere else. */
const CANCEL_SAYS = whatThisAnswerDoes({
  kind: 'permission',
  label: 'Cancel',
  decision: { outcome: 'cancel' },
})

describe('§2 · Cancel interrupts the whole turn, and the sentence now says so', () => {
  it('🔴 the sentence makes exactly two claims, and each is a clause a test below performs', () => {
    // ⛔ **The load-bearing clauses BY NAME** (HO-013 §5): a safety sentence with no test is a
    // comment. Reword either half and the adapter tests below stop being about this sentence.
    expect(CANCEL_SAYS).toContain('the whole turn is asked to stop')
    expect(CANCEL_SAYS).toContain('this request is refused')
    // ⚠️ And the paired negative in the same assertion: it is NOT the old sentence, which said
    // only that the request went away.
    expect(CANCEL_SAYS).not.toBe('the request is cancelled')
    // 🔴 **492 · and it is not the one before this either.** *"the whole turn is interrupted"* was a
    // claim that the turn had ENDED, which `RuntimeHost.interruptAgent` refuses to make on either
    // provider. ⛔ The paraphrase is what a reader would write next, so it is named here.
    expect(CANCEL_SAYS).not.toContain('is interrupted')
  })

  it('⛔ Claude: the request is refused AND the turn ends interrupted', async () => {
    const seam = await claudeInATurn()
    const decision = seam.canUse('Bash', { command: 'rm -rf /' }, toolOpts('tu_cancel'))
    await waitUntil(
      () => seam.events.some((e) => e.type === 'permission_request'),
      'the permission card',
    )
    await seam.handle.respondPermission(permissionIdIn(seam.events), { outcome: 'cancel' })

    // Clause two: what the PROVIDER is told about this request.
    expect(await decision).toEqual({
      behavior: 'deny',
      message: 'cancelled by user',
      interrupt: true,
    })
    // Clause one: the provider then ends the turn in ITS OWN word for a cancelled card —
    // `aborted_tools`, measured on CLI 2.1.281 (`fixtures/claude-stopped-results.json`). 🔴 **709 ·
    // R43: that word is what the turn records.** It used to plant a SUCCESSFUL turn here and let the
    // latch rename it; a success after a Cancel is now `completed` (`claude-runtime.test.ts`).
    seam.query.emit(
      (
        JSON.parse(
          readFileSync(
            new URL(
              '../../../packages/runtime/test/fixtures/claude-stopped-results.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ) as { cancelledCard: SDKMessage }
      ).cancelledCard,
    )
    await waitUntil(() => turnStatesIn(seam.events).length > 0, 'the turn terminal')
    expect(turnStatesIn(seam.events)).toEqual(['interrupted'])

    await seam.handle.close()
    seam.query.end()
    await seam.consumer
  })

  it('⛔ Codex: the request is refused AND the turn ends interrupted', async () => {
    const seam = await codexInATurn()
    seam.transport.serverRequest(71, 'item/commandExecution/requestApproval', {
      command: 'rm -rf /',
      cwd: '/tmp/x',
    })
    await waitUntil(
      () => seam.events.some((e) => e.type === 'permission_request'),
      'the permission card',
    )
    await seam.handle.respondPermission(permissionIdIn(seam.events), { outcome: 'cancel' })

    // Clause two, on this provider's own wire: `cancel` is its own decision, not a decline.
    await waitUntil(() => seam.transport.responses.length > 0, 'the wire response')
    expect(seam.transport.responses[0]).toEqual({ id: 71, result: { decision: 'cancel' } })
    // Clause one, and it has to be provoked the way the provider provokes it: the app-server ends
    // the turn in ITS OWN word after `{decision:'cancel'}` — `interrupted`, measured by
    // `probe:codex-approval-reason`'s cancel arm on the bundled 0.146.0. 🔴 **709 · R43: that word
    // is what the turn records**; it used to plant `completed` and let the latch rename it.
    //
    // ⛔ **Closing the transport instead would prove nothing** — a session whose transport dies
    // mid-turn terminalizes as interrupted anyway, so the assertion would pass with no cancel in
    // it at all. The notification is what makes this about the press.
    seam.transport.notification(
      'turn/completed',
      turnCompletedNotification(
        'th_1',
        completedTurn(seam.transport.lastTurnId, { status: 'interrupted' }),
      ),
    )
    await waitUntil(() => turnStatesIn(seam.events).length > 0, 'the turn terminal')
    expect(turnStatesIn(seam.events)).toEqual(['interrupted'])

    // 🔴 **492 · and this door did not move, which the brief asked to be PROVEN rather than said.**
    //
    // ⛔ **`HO-032` §1's scope is the agent-tool door and nothing else**, and the reason is `487`'s
    // measurement: on a command approval `cancel` already maps to Codex's own `cancel` decision and
    // goes out on the wire — asserted two lines up. ⚑ So this door needs no `turn/interrupt`, and
    // sending one here would be a second ask for one act. ⚑ **709 · and the word on this path is
    // Codex's own** — `interrupted` after a `cancel` decision, measured — not the latch's.
    expect(seam.transport.methods).not.toContain('turn/interrupt')
    // ⚠️ **The control, and it plants TWO** (standing rule 12): the recorder really did see this
    // session's traffic, so the absence above is an absence rather than an empty list.
    expect(seam.transport.methods).toContain('initialize')
    expect(seam.transport.methods).toContain('turn/start')

    await seam.handle.close()
    seam.transport.close()
    await seam.consumer
  })

  it('⚑ …and on Codex too, Deny leaves the turn alone — the paired positive', async () => {
    const seam = await codexInATurn()
    seam.transport.serverRequest(72, 'item/commandExecution/requestApproval', {
      command: 'echo hi',
      cwd: '/tmp/x',
    })
    await waitUntil(
      () => seam.events.some((e) => e.type === 'permission_request'),
      'the permission card',
    )
    await seam.handle.respondPermission(permissionIdIn(seam.events), { outcome: 'deny' })
    await waitUntil(() => seam.transport.responses.length > 0, 'the wire response')
    expect(seam.transport.responses[0]).toEqual({ id: 72, result: { decision: 'decline' } })
    seam.transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(seam.transport.lastTurnId)),
    )
    await waitUntil(() => turnStatesIn(seam.events).length > 0, 'the turn terminal')
    expect(turnStatesIn(seam.events)).toEqual(['completed'])

    await seam.handle.close()
    seam.transport.close()
    await seam.consumer
  })

  it('⚑ …and Deny is NOT this, on the same seam — the paired positive', async () => {
    // ⛔ Without this the section proves only that *an* answer ends a turn. `deny` is the graceful
    // refusal the whole vocabulary rests on: the request goes, the turn does not.
    const seam = await claudeInATurn()
    const decision = seam.canUse('Bash', { command: 'echo hi' }, toolOpts('tu_deny'))
    await waitUntil(
      () => seam.events.some((e) => e.type === 'permission_request'),
      'the permission card',
    )
    await seam.handle.respondPermission(permissionIdIn(seam.events), { outcome: 'deny' })
    expect(await decision).toMatchObject({ behavior: 'deny' })
    expect(await decision).not.toMatchObject({ interrupt: true })

    seam.query.emit({ type: 'result', subtype: 'success', is_error: false })
    await waitUntil(() => turnStatesIn(seam.events).length > 0, 'the turn terminal')
    expect(turnStatesIn(seam.events)).toEqual(['completed'])

    await seam.handle.close()
    seam.query.end()
    await seam.consumer
  })

  it('⚠️ every permission request kind whose Cancel asks its turn to stop gets the same sentence, and it is true of all of them', () => {
    // ⛔ **The sentence is not per-provider and must not become one**, and since `492` it is not
    // per-DOOR either. ⚠️ The old reason was that both adapters reach `requestInterrupt()` from
    // their own `cancel` arm — which was true and was not enough: on the Codex agent-tool card the
    // latch was the WHOLE act, and `483` measured that the provider was never asked. ⚑ Now every
    // door tells the provider — `{decision:'cancel'}` on an approval, `interrupt: true` on Claude,
    // `turn/interrupt` on the agent-tool card — so one sentence is correct because one act is.
    // ⚑ And since `720` (R71) the machine's own word for a fatal error after it is the same on every
    // door that asked: they all latch (the elicitation card only when its frame named the turn).
    // 🔴 **730 · R81 — the one named exception**: a card whose frame named NO turn carries
    // `cancelStopsNothing` (`723`), its Cancel asks nothing to stop, and it says so —
    // {@link CANCEL_STOPS_NOTHING}, below. ⛔ One act, one sentence still holds: that press is a
    // different act.
    const offered: PermissionOutcome[] = ['allow', 'allow_for_session', 'deny', 'cancel']
    const row = permissionOffer(offered, 'Bash').row
    const cancels = row.filter((outcome) => outcome === 'cancel')
    expect(cancels).toEqual(['cancel'])
    for (const label of ['Cancel', 'Cancel turn']) {
      expect(
        whatThisAnswerDoes({ kind: 'permission', label, decision: { outcome: 'cancel' } }),
      ).toBe(CANCEL_SAYS)
    }
    // ⚑ **And an offer that does not carry it gets no button** — the projection promises a sentence
    // for nothing it did not draw. ⚠️ **The comment here used to name the Codex agent-tool call as
    // that shape and it has not been one since `482`** (`478` F4): that card publishes
    // `['allow','deny','cancel']`, which `codex-runtime.test.ts` pins, and `492` left the offer
    // exactly where `487` put it. ⛔ So this row is a pure-function control over an offer, and not a
    // claim about a door.
    expect(permissionOffer(['allow', 'deny'], 'spawn_agent').row).toEqual(['allow', 'deny'])
    // 🔴 **730 · R81** — the marker changes the Cancel's sentence and nothing else's.
    for (const label of ['Cancel', 'Cancel request']) {
      expect(
        whatThisAnswerDoes({
          kind: 'permission',
          label,
          decision: { outcome: 'cancel' },
          stopsNothing: true,
        }),
      ).toBe(CANCEL_STOPS_NOTHING)
    }
    expect(
      whatThisAnswerDoes({
        kind: 'permission',
        label: 'Deny',
        decision: { outcome: 'deny' },
        stopsNothing: true,
      }),
    ).toBe(whatThisAnswerDoes({ kind: 'permission', label: 'Deny', decision: { outcome: 'deny' } }))
  })
})

/* ------------------------------- §3 · the plan pair, through the adapter that raises and moves it */

describe('§3 · a plan card says which way it moves, and the adapter is what says it', () => {
  /** ⚑ The floor lives on the CONCRETE handle — `SessionHandle` exposes only `planNeedsGoAhead`,
   *  which is `false` for a Claude session whose exit belongs to the provider's own card (060). */
  const floorOf = (seam: ClaudeSeam): boolean =>
    (seam.handle as unknown as ClaudeSessionHandle).planning

  async function planCard(
    tool: string,
    planMode = false,
  ): Promise<{ seam: ClaudeSeam; request: UserInputRequestEvent }> {
    const seam = await claudeInATurn(planMode)
    void seam.canUse(
      tool,
      tool === 'ExitPlanMode' ? { plan: '# do the thing' } : {},
      toolOpts(tool),
    )
    await waitUntil(
      () => seam.events.some((e) => e.type === 'user_input_request'),
      `the ${tool} card`,
    )
    return { seam, request: cardIn(seam.events) }
  }

  it('🔴 ExitPlanMode carries stop-planning, and approving it really lowers this app’s floor', async () => {
    const { seam, request } = await planCard('ExitPlanMode', true)
    expect(request.consent).toBe('stop-planning')
    expect(consentAsked(request)).toBe('stop-planning')

    // ⛔ **The floor, which is the half the sentence is about.** `planning` is what
    // `promptGuardHooks` reads to refuse consequential tools (140), and `respondUserInput` is the
    // only writer that can lower it (150).
    expect(floorOf(seam)).toBe(true)
    await seam.handle.respondUserInput(request.id, { kind: 'answer', answers: {} })
    expect(floorOf(seam)).toBe(false)

    await seam.handle.close()
    seam.query.end()
    await seam.consumer
  })

  it('🔴 736 · R98 — EnterPlanMode raises NO card (so no start-planning), and still really raises the plan', async () => {
    // ⛔ On `main`: a consent card carrying `start-planning`, approved to raise the plan. ⚑ R98: the
    // CLI does not ask before the model enters plan mode (measured, `enter-plan-write`); the
    // `start-planning` word stays in the vocabulary for rows written before `736`.
    const seam = await claudeInATurn()
    expect(floorOf(seam)).toBe(false)
    // ⚑ Raced, so on `main` — where this parked on a card — the RED is this assertion, not a test
    // that hangs to its timeout (`736`'s review).
    const settled = await Promise.race([
      seam.canUse('EnterPlanMode', {}, toolOpts('EnterPlanMode')),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 200)),
    ])
    expect(settled).toEqual({ behavior: 'allow' })
    expect(seam.events.filter((e) => e.type === 'user_input_request')).toEqual([])
    expect(floorOf(seam)).toBe(true)

    await seam.handle.close()
    seam.query.end()
    await seam.consumer
  })

  it('⛔ an AskUserQuestion carries NO consent key at all — the paired negative', async () => {
    // ⚠️ **Measured, and it broke something first.** A `consent: undefined` key is an own
    // enumerable key, `askedOfTheChannel`'s admit-list walks `Object.keys`, and every Claude
    // question stopped travelling to a parent. An absent key is what that admit-list means.
    const seam = await claudeInATurn()
    void seam.canUse(
      'AskUserQuestion',
      { questions: [{ question: 'which?', options: [{ label: 'a' }, { label: 'b' }] }] },
      toolOpts('tu_ask'),
    )
    await waitUntil(
      () => seam.events.some((e) => e.type === 'user_input_request'),
      'the question card',
    )
    const request = cardIn(seam.events)
    expect(Object.hasOwn(request, 'consent')).toBe(false)
    expect(Object.keys(request).sort()).toEqual(['id', 'prompt', 'questions', 'type'])
    // ⚑ And the paired positive, on a seam of its own: a plan card DOES carry the key — `ExitPlanMode`
    // since `736` (R98 took `EnterPlanMode`'s card away).
    const planning = await planCard('ExitPlanMode', true)
    expect(Object.keys(planning.request)).toContain('consent')
    await planning.seam.handle.close()
    planning.seam.query.end()
    await planning.seam.consumer

    await seam.handle.close()
    seam.query.end()
    await seam.consumer
  })
})

/* ------------------------------------- §4 · the grant, through the adapter that scopes it to a turn */

describe('§4 · “for this turn and no longer” is the scope the wire really carries', () => {
  it('🔴 approving a Codex grant sends scope:"turn", and the sentence says exactly that', async () => {
    const seam = await codexInATurn()
    seam.transport.serverRequest(81, 'item/permissions/requestApproval', {
      reason: 'write generated files',
      cwd: '/work',
      permissions: { filesystem: { write: ['/work/out'] } },
    })
    await waitUntil(
      () => seam.events.some((e) => e.type === 'user_input_request'),
      'the grant card',
    )
    const request = cardIn(seam.events)

    // The surface classifies it off the field the adapter set, and offers the Approve that says so.
    expect(consentAsked(request)).toBe('access-for-this-turn')
    const approve = userInputOffer(request).decisions[0] as AttentionDecision
    expect(whatThisAnswerDoes(approve)).toContain('for this turn and no longer')

    // …and the press really does send a turn-scoped grant, through the production `answerFor`.
    const sent = answerFor(approve)
    expect(sent).toEqual({ userInput: { kind: 'answer', answers: {} } })
    await seam.handle.respondUserInput(request.id, { kind: 'answer', answers: {} })
    await waitUntil(() => seam.transport.responses.length > 0, 'the wire response')
    expect(seam.transport.responses[0]).toMatchObject({ id: 81, result: { scope: 'turn' } })

    await seam.handle.close()
    seam.transport.close()
    await seam.consumer
  })
})
