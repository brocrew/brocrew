import { readFileSync } from 'node:fs'
import type { CanUseTool, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { ClaudeRuntime, type ClaudeSessionHandle, type ClaudeQuery } from '@brobot2/runtime/claude'
import { CodexRuntime, type CodexIncoming, type CodexTransport } from '@brobot2/runtime/codex'
import { type PermissionOutcome, type RuntimeEvent } from '@brobot2/runtime'
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

  readonly cli = new TheCliAnswersInOrder()
}

/** The codex app-server stand-in: a conformant handshake, and every write back recorded. */
class FakeTransport implements CodexTransport {
  private readonly queue = new Wire<CodexIncoming>()
  private turnSeq = 0
  lastTurnId = ''
  readonly responses: { id: string | number; result: unknown }[] = []
  readonly methods: string[] = []
  request(method: string, params?: unknown): Promise<unknown> {
    this.methods.push(method)
    if (method === 'thread/start' || method === 'thread/resume') {
      const cwd = ((params ?? {}) as { cwd?: string }).cwd ?? '/tmp/x'
      return Promise.resolve(threadStartResponse('th_1', cwd) as unknown as Record<string, unknown>)
    }
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
  notification(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
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

const EVERY_CONSENT: Readonly<Record<ConsentAsked, UserInputRequestEvent>> = {
  // Codex `item/permissions/requestApproval` — `questions: []` plus a neutral grant scope.
  'access-for-this-turn': asking([], {
    permission: { cwd: '/work', paths: ['write /work/out'], network: false },
  }),
  'start-planning': asking([], { consent: 'start-planning' }),
  // Claude `ExitPlanMode` — the model asks to LEAVE plan mode and get on with it.
  'stop-planning': asking([], { consent: 'stop-planning' }),
  'a-consent-this-window-cannot-name': asking([]),
}

describe('§1 · what a zero-question card is a consent TO, and it is the request that says', () => {
  it('every consent kind is classified off the request, and no two share a sentence', () => {
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
    expect(new Set(said.values()).size, `${[...said.values()].join(' | ')}`).toBe(said.size)
  })

  it('…and each says WHICH act, because distinctness alone passes on a clean swap', () => {
    const says = (kind: ConsentAsked): string =>
      whatThisAnswerDoes({ kind: 'approve', label: 'Approve', consent: kind })

    expect(says('start-planning')).toContain('starts planning')
    expect(says('start-planning')).toContain('the provider’s own plan mode')
    expect(says('stop-planning')).toContain('stops planning')
    expect(says('stop-planning')).toContain('its plan mode ends')
    expect(says('start-planning')).not.toContain('stops planning')
    expect(says('stop-planning')).not.toContain('starts planning')

    expect(says('access-for-this-turn')).toContain('for this turn and no longer')
    expect(says('a-consent-this-window-cannot-name')).toContain('cannot say what else')
  })

  it('…and a grant is asked FIRST, so a Codex widening is never read as a plan card', () => {
    const both = asking([], {
      permission: { paths: ['write /etc'], network: true },
      consent: 'stop-planning',
    })
    expect(consentAsked(both)).toBe('access-for-this-turn')
  })

  it('a question is never a consent — the Approve predicate is still the question count', () => {
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
})

const CANCEL_SAYS = whatThisAnswerDoes({
  kind: 'permission',
  label: 'Cancel',
  decision: { outcome: 'cancel' },
})

describe('§2 · Cancel interrupts the whole turn, and the sentence now says so', () => {
  it('the sentence makes exactly two claims, and each is a clause a test below performs', () => {
    expect(CANCEL_SAYS).toContain('the whole turn is asked to stop')
    expect(CANCEL_SAYS).toContain('this request is refused')
    expect(CANCEL_SAYS).not.toContain('is interrupted')
  })

  it('Claude: the request is refused AND the turn ends interrupted', async () => {
    const seam = await claudeInATurn()
    const decision = seam.canUse('Bash', { command: 'rm -rf /' }, toolOpts('tu_cancel'))
    await waitUntil(
      () => seam.events.some((e) => e.type === 'permission_request'),
      'the permission card',
    )
    await seam.handle.respondPermission(permissionIdIn(seam.events), { outcome: 'cancel' })

    expect(await decision).toEqual({
      behavior: 'deny',
      message: 'cancelled by user',
      interrupt: true,
    })
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

  it('Codex: the request is refused AND the turn ends interrupted', async () => {
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

    await waitUntil(() => seam.transport.responses.length > 0, 'the wire response')
    expect(seam.transport.responses[0]).toEqual({ id: 71, result: { decision: 'cancel' } })
    seam.transport.notification(
      'turn/completed',
      turnCompletedNotification(
        'th_1',
        completedTurn(seam.transport.lastTurnId, { status: 'interrupted' }),
      ),
    )
    await waitUntil(() => turnStatesIn(seam.events).length > 0, 'the turn terminal')
    expect(turnStatesIn(seam.events)).toEqual(['interrupted'])

    expect(seam.transport.methods).not.toContain('turn/interrupt')
    expect(seam.transport.methods).toContain('initialize')
    expect(seam.transport.methods).toContain('turn/start')

    await seam.handle.close()
    seam.transport.close()
    await seam.consumer
  })

  it('…and on Codex too, Deny leaves the turn alone — the paired positive', async () => {
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

  it('…and Deny is NOT this, on the same seam — the paired positive', async () => {
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

  it('every permission request kind whose Cancel asks its turn to stop gets the same sentence, and it is true of all of them', () => {
    const offered: PermissionOutcome[] = ['allow', 'allow_for_session', 'deny', 'cancel']
    const row = permissionOffer(offered, 'Bash').row
    const cancels = row.filter((outcome) => outcome === 'cancel')
    expect(cancels).toEqual(['cancel'])
    for (const label of ['Cancel', 'Cancel turn']) {
      expect(
        whatThisAnswerDoes({ kind: 'permission', label, decision: { outcome: 'cancel' } }),
      ).toBe(CANCEL_SAYS)
    }
    expect(permissionOffer(['allow', 'deny'], 'spawn_agent').row).toEqual(['allow', 'deny'])
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

describe('§3 · a plan card says which way it moves, and the adapter is what says it', () => {
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

  it('ExitPlanMode carries stop-planning, and approving it really lowers this app’s floor', async () => {
    const { seam, request } = await planCard('ExitPlanMode', true)
    expect(request.consent).toBe('stop-planning')
    expect(consentAsked(request)).toBe('stop-planning')

    expect(floorOf(seam)).toBe(true)
    await seam.handle.respondUserInput(request.id, { kind: 'answer', answers: {} })
    expect(floorOf(seam)).toBe(false)

    await seam.handle.close()
    seam.query.end()
    await seam.consumer
  })

  it('EnterPlanMode raises NO card (so no start-planning), and still really raises the plan', async () => {
    const seam = await claudeInATurn()
    expect(floorOf(seam)).toBe(false)
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

  it('an AskUserQuestion carries NO consent key at all — the paired negative', async () => {
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

describe('§4 · “for this turn and no longer” is the scope the wire really carries', () => {
  it('approving a Codex grant sends scope:"turn", and the sentence says exactly that', async () => {
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

    expect(consentAsked(request)).toBe('access-for-this-turn')
    const approve = userInputOffer(request).decisions[0] as AttentionDecision
    expect(whatThisAnswerDoes(approve)).toContain('for this turn and no longer')

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
