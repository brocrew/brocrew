import type {
  ElicitationRequest,
  ElicitationResult,
  Options,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { AnswerRefused } from '../src/answer-refused'
import { CLAUDE_CAPABILITIES } from '../src/claude/capabilities'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import type { RuntimeEvent } from '../src/events'
import { AsyncQueue } from '../src/internal/async-queue'
import { askedOfTheChannel } from '../src/question-channel'
import { codexElicitation, elicitationWords, MAX_ELICITATION_URL } from '../src/codex/external-mcp'

/**
 * 🔴 **728 · R93 — an MCP server's form, on a Claude conversation, reaches the person.**
 *
 * ⛔ **Until `728` nothing answered the SDK's `onElicitation`, and the SDK's contract is that an
 * unhandled elicitation *"will be declined automatically"*.** ⚑ Measured
 * (`probe:tool-calls-as-the-cli`, the bundled CLI on a loopback): the CLI handed a server's one-field
 * form and its zero-field form to its host; with no callback the server was told `decline` and no
 * person saw either.
 *
 * ⚑ Two cards, the ones Codex's server forms already get: fields → a question card, answered back
 * in the server's own types; no fields → Allow (`accept`, no content), Deny (`decline`), Cancel
 * (`cancel`, and nothing is stopped: the request names no call, so no turn can be said to be its).
 */

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  interrupts = 0
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    this.interrupts += 1
    return undefined
  }
  close(): void {}
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

async function started(approvalMode?: 'auto'): Promise<{
  handle: Awaited<ReturnType<ClaudeRuntime['start']>>
  options: Options
  query: FakeQuery
  events: RuntimeEvent[]
  ask: (request: ElicitationRequest, signal?: AbortSignal) => Promise<ElicitationResult>
}> {
  const query = new FakeQuery()
  let captured: Options | undefined
  const runtime = new ClaudeRuntime(
    (params) => {
      captured = params.options
      return query
    },
    async () => true,
  )
  const handle = await runtime.start({
    cwd: '/tmp/x',
    providerHome: '/tmp/x/home',
    ...(approvalMode === undefined ? {} : { approvalMode }),
  })
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  if (captured === undefined) throw new Error('the query was never built')
  const options = captured
  let asked = 0
  return {
    handle,
    options,
    query,
    events,
    ask: (request, signal = new AbortController().signal) => {
      if (options.onElicitation === undefined) throw new Error('no onElicitation on the query')
      asked += 1
      return options.onElicitation(request, {
        signal,
        requestId: `req_${String(asked)}`,
      }) as Promise<ElicitationResult>
    },
  }
}

const FORM: ElicitationRequest = {
  serverName: 'probe728',
  message: 'The 728 probe asks your name.',
  mode: 'form',
  requestedSchema: {
    type: 'object',
    properties: { name: { type: 'string', title: 'Your name' } },
    required: ['name'],
  },
}

const EMPTY: ElicitationRequest = {
  serverName: 'probe728',
  message: 'The 728 probe asks: may I go on?',
  mode: 'form',
  requestedSchema: { type: 'object', properties: {} },
}

const cardOf = <T extends RuntimeEvent['type']>(
  events: RuntimeEvent[],
  type: T,
): Extract<RuntimeEvent, { type: T }> => {
  const found = events.find((one): one is Extract<RuntimeEvent, { type: T }> => one.type === type)
  if (found === undefined) throw new Error(`no ${type}`)
  return found
}

describe('728 · R93 — a server’s form on Claude', () => {
  it('🔴 the query carries an `onElicitation` — without one the SDK declines every form unseen', async () => {
    const { handle, options } = await started()
    expect(typeof options.onElicitation).toBe('function')
    await handle.close()
  })

  it('🔴 a form with fields is a QUESTION card, and the answer goes back in the server’s types', async () => {
    const { handle, events, ask } = await started()
    const answer = ask(FORM)
    await vi.waitFor(() =>
      expect(events.some((one) => one.type === 'user_input_request')).toBe(true),
    )
    const card = cardOf(events, 'user_input_request')
    // ⚑ Who is asking, first — and the server's own words after it, marked as the server's.
    expect(card.prompt).toContain('probe728 is asking you something. Claude names the server')
    expect(card.prompt).toContain('probe728 says: The 728 probe asks your name.')
    expect(card.questions.map((one) => one.id)).toEqual(['name'])
    // ⚑ Whose it is, on the event — and so it never travels to a parent agent as the model's question.
    expect(card.mcpServerAsks).toEqual({ server: 'probe728' })
    await handle.respondUserInput(card.id, { kind: 'answer', answers: { name: 'Ada' } })
    await expect(answer).resolves.toEqual({ action: 'accept', content: { name: 'Ada' } })
    await handle.close()
  })

  it('⚑ Reject on a form sends `decline`', async () => {
    const { handle, events, ask } = await started()
    const answer = ask(FORM)
    await vi.waitFor(() =>
      expect(events.some((one) => one.type === 'user_input_request')).toBe(true),
    )
    await handle.respondUserInput(cardOf(events, 'user_input_request').id, { kind: 'reject' })
    await expect(answer).resolves.toEqual({ action: 'decline' })
    await handle.close()
  })

  it('⛔ an answer the server’s own types would reject is REFUSED before anything goes back — the card stays', async () => {
    const { handle, events, ask } = await started()
    const answer = ask({
      ...FORM,
      requestedSchema: {
        type: 'object',
        properties: { count: { type: 'integer', title: 'How many?' } },
        required: ['count'],
      },
    })
    await vi.waitFor(() =>
      expect(events.some((one) => one.type === 'user_input_request')).toBe(true),
    )
    const id = cardOf(events, 'user_input_request').id
    await expect(
      handle.respondUserInput(id, { kind: 'answer', answers: { count: 'three' } }),
    ).rejects.toBeInstanceOf(AnswerRefused)
    // ⚑ Still answerable, and the typed answer goes back as the number the server asked for.
    await handle.respondUserInput(id, { kind: 'answer', answers: { count: '3' } })
    await expect(answer).resolves.toEqual({ action: 'accept', content: { count: 3 } })
    await handle.close()
  })

  it('🔴 a form with NO fields is a card with Allow, Deny and Cancel — Allow sends `accept`, no content', async () => {
    const { handle, events, ask } = await started()
    const answer = ask(EMPTY)
    await vi.waitFor(() =>
      expect(events.some((one) => one.type === 'permission_request')).toBe(true),
    )
    const card = cardOf(events, 'permission_request')
    expect(card.action).toBe('probe728')
    expect(card.mcpServerAsks).toEqual({ server: 'probe728' })
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(card.scope.noPositiveBecause).toBeUndefined()
    expect(card.detail).toContain('probe728 says: The 728 probe asks: may I go on?')
    await handle.respondPermission(card.id, { outcome: 'allow' })
    await expect(answer).resolves.toEqual({ action: 'accept', content: {} })
    await handle.close()
  })

  it('🔴 Deny sends `decline`; Cancel sends `cancel` and stops NOTHING — raised during a turn or between turns, the card says so (728 review)', async () => {
    // ⛔ The request names the server and nothing else, so the work that raised it cannot be told
    // from the turn that happens to be open: a background agent's form, answered during the
    // person's next turn, would have stopped THAT turn. `cancel` goes to the server, and no more.
    for (const [pressed, sent, turnOpen] of [
      ['deny', { action: 'decline' }, true],
      ['cancel', { action: 'cancel' }, true],
      ['cancel', { action: 'cancel' }, false],
    ] as const) {
      const { handle, events, query, ask } = await started()
      if (turnOpen) await handle.send('go')
      const answer = ask(EMPTY)
      await vi.waitFor(() =>
        expect(events.some((one) => one.type === 'permission_request')).toBe(true),
      )
      const card = cardOf(events, 'permission_request')
      expect(card.cancelStopsNothing, `${pressed} · turn open: ${String(turnOpen)}`).toBe(true)
      // ⚑ …and a turn the person starts AFTER the form was raised is not the form's to stop.
      if (!turnOpen) await handle.send('go')
      await handle.respondPermission(card.id, { outcome: pressed })
      await expect(answer, pressed).resolves.toEqual(sent)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(query.interrupts, `${pressed} · turn open: ${String(turnOpen)}`).toBe(0)
      await handle.close()
    }
  })

  it('⛔ a url form (since CLI 2.1.287 it reaches the host) gets the server’s card with its link — and since W4.28, *I opened it*', async () => {
    const urlForm = {
      serverName: 'probe728',
      message: 'Visit a page.',
      mode: 'url' as const,
      url: 'https://example.invalid/728',
    }
    const { handle, events, ask } = await started()
    const answer = ask(urlForm)
    await vi.waitFor(() =>
      expect(events.some((one) => one.type === 'permission_request')).toBe(true),
    )
    const card = cardOf(events, 'permission_request')
    // The form provides a way to allow, so there is no “why not” word.
    expect(card.scope.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
    expect(card.scope.noPositiveBecause).toBeUndefined()
    // ⚑ provider follow-ups 1 · the page, as the server's, in the card's words and on the event.
    expect(card.mcpServerAsks).toEqual({ server: 'probe728', url: 'https://example.invalid/728' })
    expect(card.detail).toContain('probe728’s link: https://example.invalid/728')
    await handle.respondPermission(card.id, { outcome: 'deny' })
    await expect(answer).resolves.toEqual({ action: 'decline' })
    await handle.close()

    // ⚑ *I opened it* is MCP's `accept`, with no content — the url mode's answer.
    const second = await started()
    const opened = second.ask(urlForm)
    await vi.waitFor(() =>
      expect(second.events.some((one) => one.type === 'permission_request')).toBe(true),
    )
    await second.handle.respondPermission(cardOf(second.events, 'permission_request').id, {
      outcome: 'allow',
    })
    await expect(opened).resolves.toEqual({ action: 'accept' })
    await second.handle.close()

    // ⛔ A url whose link the card does not show offers nothing to have opened.
    const third = await started()
    const withheld = third.ask({ ...urlForm, url: 'https://example.invalid/\u202egnp.exe' })
    await vi.waitFor(() =>
      expect(third.events.some((one) => one.type === 'permission_request')).toBe(true),
    )
    const hidden = cardOf(third.events, 'permission_request')
    expect(hidden.scope.availableDecisions).not.toContain('allow')
    await expect(
      third.handle.respondPermission(hidden.id, { outcome: 'allow' }),
    ).rejects.toBeInstanceOf(AnswerRefused)
    await third.handle.respondPermission(hidden.id, { outcome: 'deny' })
    await expect(withheld).resolves.toEqual({ action: 'decline' })
    await third.handle.close()
  })

  it('⚑ the note a person reads says it — and says the CLI asks before EVERY tool of the server, whatever the server says of it (rule 5: by name)', () => {
    const status = CLAUDE_CAPABILITIES.externalMcpServers
    const note = status.state === 'available' ? (status.note ?? '') : ''
    // ⚑ Measured (`probe:tool-calls-as-the-cli`): the CLI asked before `readOnlyHint` tools too.
    expect(note).toContain('each of its tool calls asks you before it runs')
    expect(note).toContain('whatever the server says about the tool')
    expect(note).toContain('a form the server sends reaches you to answer')
    // ⛔ The comparison R93 made false — BroBot no longer cards what the CLI runs unasked.
    expect(note).not.toContain('every other consequential action')
  })

  it('🔴 a form still open when the conversation closes — or is Stopped — is answered `cancel`: nobody declined it (728 review)', async () => {
    // ⛔ MCP's `decline` means *the user explicitly declined*; a slot settled by a close, a Stop or an
    // abort is nobody's decision. Both kinds of card, both ways out.
    const raised = (events: RuntimeEvent[]): boolean =>
      events.some((one) => one.type === 'permission_request' || one.type === 'user_input_request')
    for (const request of [EMPTY, FORM]) {
      const closing = await started()
      const answer = closing.ask(request)
      await vi.waitFor(() => expect(raised(closing.events)).toBe(true))
      await closing.handle.close()
      await expect(answer, `close · ${request.message}`).resolves.toEqual({ action: 'cancel' })

      const stopping = await started()
      await stopping.handle.send('go')
      const stopped = stopping.ask(request)
      await vi.waitFor(() => expect(raised(stopping.events)).toBe(true))
      await stopping.handle.interrupt()
      await expect(stopped, `stop · ${request.message}`).resolves.toEqual({ action: 'cancel' })
      await stopping.handle.close()
    }
  })
})

describe('provider follow-ups 1 · the link a server asks a person to open', () => {
  const ask = (url: unknown, mode = 'url') =>
    codexElicitation({ serverName: 'kibana', message: 'Sign in.', mode, url })

  it('is carried as sent, and said as the server’s', () => {
    const asked = ask('https://example.invalid/auth')
    expect(asked?.url).toBe('https://example.invalid/auth')
    // ⚑ The link FIRST, so the card's length bound can never cut it (W4.28 review).
    expect(elicitationWords(asked!)).toBe(
      '\n\nkibana’s link: https://example.invalid/auth\n\nkibana says: Sign in.',
    )
  })

  it('is read only on a url request', () => {
    expect(ask('https://example.invalid/auth', 'form')?.url).toBeUndefined()
    expect(ask('https://example.invalid/auth', 'form')?.urlWithheld).toBeUndefined()
  })

  it('is withheld — and the card says so — when it is too long or carries hidden characters', () => {
    for (const url of [
      `https://example.invalid/${'a'.repeat(MAX_ELICITATION_URL)}`,
      'https://example.invalid/\u202egnp.exe',
      'https://example.invalid/a\nb',
    ]) {
      const asked = ask(url)
      expect(asked?.url, url.slice(0, 40)).toBeUndefined()
      expect(asked?.urlWithheld).toBe(true)
      expect(elicitationWords(asked!)).toContain('kibana sent a link BroCrew does not show')
    }
  })
})

describe('W4.28 · *I opened it* — only a person’s press answers it', () => {
  const URL_FORM = {
    serverName: 'probe728',
    message: 'Visit a page.',
    mode: 'url' as const,
    url: 'https://example.invalid/728',
  }

  it('⛔ an unattended conversation still WAITS on the card — nothing in this app answers it for the person', async () => {
    const { handle, events, ask } = await started('auto')
    let settled = false
    const answer = ask(URL_FORM).then((result) => {
      settled = true
      return result
    })
    await vi.waitFor(() =>
      expect(events.some((one) => one.type === 'permission_request')).toBe(true),
    )
    // ⚑ The premise: this conversation really is unattended.
    expect(cardOf(events, 'permission_request').scope.approvalMode).toBe('auto')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(settled, 'auto mode answered the server on its own').toBe(false)
    await handle.respondPermission(cardOf(events, 'permission_request').id, { outcome: 'allow' })
    await expect(answer).resolves.toEqual({ action: 'accept' })
    await handle.close()
  })

  it('⛔ the card never travels to another agent — the question channel refuses it', async () => {
    const { handle, events, ask } = await started()
    void ask(URL_FORM)
    await vi.waitFor(() =>
      expect(events.some((one) => one.type === 'permission_request')).toBe(true),
    )
    expect(askedOfTheChannel(cardOf(events, 'permission_request'))).toMatchObject({
      travels: false,
      because: 'a-server-asks-the-person',
    })
    await handle.close()
  })
})

describe('a server’s form the SDK aborts while it waits is withdrawn', () => {
  it.each([
    ['with fields', FORM, 'user_input_request'],
    ['without fields', EMPTY, 'permission_request'],
  ] as const)(
    'a form %s closes with request_resolved, and the server gets cancel',
    async (_, form, card) => {
      const { handle, events, ask } = await started()
      const ctl = new AbortController()
      const answer = ask(form, ctl.signal)
      await vi.waitFor(() => expect(events.some((one) => one.type === card)).toBe(true))
      const id = cardOf(events, card).id
      ctl.abort()
      await expect(answer).resolves.toEqual({ action: 'cancel' })
      await vi.waitFor(() =>
        expect(events.some((one) => one.type === 'request_resolved')).toBe(true),
      )
      expect(events.filter((one) => one.type === 'request_resolved')).toEqual([
        { type: 'request_resolved', id },
      ])
      await handle.close()
    },
  )
})
