import { describe, expect, it, vi } from 'vitest'
import { QUESTION_REQUEST_KEYS, askedOfTheChannel } from '../src/index'
import { z } from 'zod'
import type { AgentToolset } from '../src/agent-tools'
import { completedTurn, turnCompletedNotification } from './fixtures/codex-protocol'
import {
  FakeTransport,
  firstOfType,
  has,
  startCodexInTurn,
  inTurn,
} from './helpers/fake-codex-transport'

describe('348 · dynamic tools, on the wire', () => {
  const firstAct = 'message_act_00000000-0000-4000-8000-000000000001'
  const secondAct = 'message_act_00000000-0000-4000-8000-000000000002'
  const messageAnswer = (messageAct: string) => ({
    text: 'Done.',
    structured: { outcome: 'ok', kind: 'note', delivery: 'sent', agent: 'receiver', messageAct },
  })
  function messageTools(
    call: (args: Record<string, unknown>) => Promise<import('../src/agent-tools').AgentToolAnswer>,
  ): AgentToolset {
    return {
      server: 'brobot',
      tools: [
        {
          name: 'message_agent',
          description: 'Deliver a note.',
          beyondItsRails: 'nothing-its-rails-do-not-cover',
          input: { act: z.string() },
          call,
        },
      ],
    }
  }
  function finishedMessage(
    transport: FakeTransport,
    id: string,
    changes: Record<string, unknown> = {},
  ): void {
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId: transport.lastTurnId,
      item: {
        id,
        type: 'dynamicToolCall',
        namespace: 'brobot',
        tool: 'message_agent',
        status: 'completed',
        success: true,
        contentItems: [{ type: 'inputText', text: 'Done.' }],
        ...changes,
      },
    })
  }

  it.each(['auto', 'rails', 'card'] as const)(
    'the %s dispatch exit keeps a receipt inside the app',
    async (path) => {
      const original = messageTools(async () => messageAnswer(firstAct))
      const set: AgentToolset =
        path === 'card'
          ? {
              ...original,
              tools: original.tools.map((one) => ({
                ...one,
                beyondItsRails: 'it-destroys-work-in-flight',
              })),
            }
          : original
      const { transport, handle, events } = await inTurn(set, path === 'auto' ? 'auto' : 'ask')
      try {
        transport.serverRequest(1, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
        if (path === 'card') {
          const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
          expect(transport.responses).toHaveLength(0)
          await handle.respondPermission(card.id, { outcome: 'allow' })
        }
        await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
        expect(transport.responses[0]!.result).toEqual({
          contentItems: [{ type: 'inputText', text: 'Done.' }],
          success: true,
        })
        finishedMessage(transport, 'a')
        await vi.waitFor(() =>
          expect(events.some((event) => event.type === 'tool_result')).toBe(true),
        )
        expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
          id: 'a',
          messageAct: firstAct,
        })
      } finally {
        await handle.close()
      }
    },
  )

  it.each(['refused', 'thrown', 'failed-result'] as const)(
    'a %s message cannot publish an act from a claimed call',
    async (path) => {
      const set = messageTools(async () => {
        if (path === 'thrown') throw new Error('fictional handler failure')
        if (path === 'refused')
          return {
            text: 'refused (no-such-agent): Nothing was sent.',
            structured: { ...messageAnswer(firstAct).structured, outcome: 'refused' },
          }
        return messageAnswer(firstAct)
      })
      const { transport, handle, events } = await inTurn(set, 'auto')
      try {
        transport.serverRequest(1, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
        await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
        finishedMessage(
          transport,
          'a',
          path === 'failed-result' ? { success: false, status: 'failed' } : {},
        )
        await vi.waitFor(() =>
          expect(events.some((event) => event.type === 'tool_result')).toBe(true),
        )
        expect(events.find((event) => event.type === 'tool_result')).not.toHaveProperty(
          'messageAct',
        )
        finishedMessage(transport, 'a')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
        )
        expect(events.filter((event) => event.type === 'tool_result')[1]).not.toHaveProperty(
          'messageAct',
        )
      } finally {
        await handle.close()
      }
    },
  )

  it('pairs actual accepted callIds when two messages complete out of order, independently of RPC ids', async () => {
    const { transport, handle, events } = await inTurn(
      messageTools(async (args) => messageAnswer(String(args.act))),
      'auto',
    )
    try {
      transport.serverRequest(700, 'item/tool/call', {
        callId: 'a',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { act: firstAct },
      })
      transport.serverRequest(701, 'item/tool/call', {
        callId: 'b',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { act: secondAct },
      })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(2))
      for (const response of transport.responses)
        expect(response.result).toMatchObject({
          contentItems: [{ type: 'inputText', text: 'Done.' }],
          success: true,
        })
      finishedMessage(transport, 'b')
      finishedMessage(transport, 'a')
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
      )
      expect(events.filter((event) => event.type === 'tool_result')).toMatchObject([
        { id: 'b', messageAct: secondAct },
        { id: 'a', messageAct: firstAct },
      ])
      finishedMessage(transport, 'a')
      finishedMessage(transport, '700')
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(4),
      )
      expect(
        events
          .filter((event) => event.type === 'tool_result')
          .slice(2)
          .every((event) => !('messageAct' in event)),
      ).toBe(true)
    } finally {
      await handle.close()
    }
  })

  it('a foreign or stale completion does not spend the matching current message receipt', async () => {
    const { transport, handle, events } = await inTurn(
      messageTools(async () => messageAnswer(firstAct)),
      'auto',
    )
    try {
      transport.serverRequest(1, 'item/tool/call', {
        callId: 'a',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { act: firstAct },
      })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(1))
      finishedMessage(transport, 'a', { namespace: 'foreign' })
      transport.notification('item/completed', {
        threadId: 'th_1',
        turnId: 'old',
        item: {
          id: 'a',
          type: 'dynamicToolCall',
          namespace: 'brobot',
          tool: 'message_agent',
          status: 'completed',
          success: true,
        },
      })
      finishedMessage(transport, 'a')
      await vi.waitFor(() =>
        expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
      )
      expect(events.filter((event) => event.type === 'tool_result')).toMatchObject([
        { id: 'a' },
        { id: 'a', messageAct: firstAct },
      ])
      expect(events.filter((event) => event.type === 'tool_result')[0]).not.toHaveProperty(
        'messageAct',
      )
    } finally {
      await handle.close()
    }
  })

  it('duplicate accepted provider callIds fail closed even when their RPC ids differ', async () => {
    const { transport, handle, events } = await inTurn(
      messageTools(async () => messageAnswer(firstAct)),
      'auto',
    )
    try {
      for (const rpc of [1, 2])
        transport.serverRequest(rpc, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
      await vi.waitFor(() => expect(transport.responses).toHaveLength(2))
      finishedMessage(transport, 'a')
      await vi.waitFor(() =>
        expect(events.some((event) => event.type === 'tool_result')).toBe(true),
      )
      expect(events.find((event) => event.type === 'tool_result')).not.toHaveProperty('messageAct')
    } finally {
      await handle.close()
    }
  })

  it.each(['auto', 'rails', 'card'] as const)(
    'a provider resolves a deferred %s message before its response, so its late answer has no receipt',
    async (path) => {
      let finish: ((answer: import('../src/agent-tools').AgentToolAnswer) => void) | undefined
      const original = messageTools(async (args) =>
        args.act === firstAct
          ? new Promise((resolve) => {
              finish = resolve
            })
          : messageAnswer(secondAct),
      )
      const set: AgentToolset =
        path === 'card'
          ? {
              ...original,
              tools: original.tools.map((one) => ({
                ...one,
                beyondItsRails: 'it-destroys-work-in-flight',
              })),
            }
          : original
      const { transport, handle, events } = await inTurn(set, path === 'auto' ? 'auto' : 'ask')
      try {
        transport.serverRequest(700, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
        if (path === 'card') {
          const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
          await handle.respondPermission(card.id, { outcome: 'allow' })
        }
        await vi.waitFor(() => expect(finish).toBeDefined())
        expect(transport.responses).toHaveLength(0)
        transport.notification('serverRequest/resolved', { threadId: 'th_1', requestId: 700 })
        transport.serverRequest(701, 'item/tool/call', {
          callId: 'b',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: secondAct },
        })
        if (path === 'card') {
          const next = await vi.waitFor(() => {
            const cards = events.filter((event) => event.type === 'permission_request')
            expect(cards).toHaveLength(2)
            return cards[1]!
          })
          await handle.respondPermission(next.id, { outcome: 'allow' })
        }
        await vi.waitFor(() => expect(transport.responses.map((one) => one.id)).toEqual([701]))
        finish!(messageAnswer(firstAct))
        finishedMessage(transport, 'a')
        finishedMessage(transport, 'b')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
        )
        const results = events.filter((event) => event.type === 'tool_result')
        expect(results[0]).toMatchObject({ id: 'a' })
        expect(results[0]).not.toHaveProperty('messageAct')
        expect(results[1]).toMatchObject({ id: 'b', messageAct: secondAct })
        expect(transport.responses.map((one) => one.id)).toEqual([701])
      } finally {
        finish?.(messageAnswer(firstAct))
        await handle.close()
      }
    },
  )

  it.each(['auto', 'rails', 'card'] as const)(
    'a response sent before provider resolution keeps its %s message receipt',
    async (path) => {
      const original = messageTools(async () => messageAnswer(firstAct))
      const set: AgentToolset =
        path === 'card'
          ? {
              ...original,
              tools: original.tools.map((one) => ({
                ...one,
                beyondItsRails: 'it-destroys-work-in-flight',
              })),
            }
          : original
      const { transport, handle, events } = await inTurn(set, path === 'auto' ? 'auto' : 'ask')
      try {
        transport.serverRequest(700, 'item/tool/call', {
          callId: 'a',
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: { act: firstAct },
        })
        if (path === 'card') {
          const card = await vi.waitFor(() => firstOfType(events, 'permission_request'))
          await handle.respondPermission(card.id, { outcome: 'allow' })
        }
        await vi.waitFor(() => expect(transport.responses.map((one) => one.id)).toEqual([700]))
        transport.notification('serverRequest/resolved', { threadId: 'th_1', requestId: 700 })
        finishedMessage(transport, 'a')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1),
        )
        expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
          id: 'a',
          messageAct: firstAct,
        })
        finishedMessage(transport, 'a')
        await vi.waitFor(() =>
          expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(2),
        )
        expect(events.filter((event) => event.type === 'tool_result')[1]).not.toHaveProperty(
          'messageAct',
        )
        expect(transport.responses.map((one) => one.id)).toEqual([700])
      } finally {
        await handle.close()
      }
    },
  )

  it('a host callback finishing after turn retirement cannot attach its act to the next turn', async () => {
    let finish: ((answer: import('../src/agent-tools').AgentToolAnswer) => void) | undefined
    const { transport, handle, events } = await inTurn(
      messageTools(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      ),
      'auto',
    )
    try {
      transport.serverRequest(1, 'item/tool/call', {
        callId: 'a',
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: { act: firstAct },
      })
      await vi.waitFor(() => expect(finish).toBeDefined())
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
      )
      await vi.waitFor(() =>
        expect(events.some((event) => event.type === 'turn' && event.state === 'completed')).toBe(
          true,
        ),
      )
      finish!(messageAnswer(firstAct))
      await handle.send('next')
      finishedMessage(transport, 'a')
      await vi.waitFor(() =>
        expect(events.some((event) => event.type === 'tool_result')).toBe(true),
      )
      expect(events.find((event) => event.type === 'tool_result')).not.toHaveProperty('messageAct')
    } finally {
      await handle.close()
    }
  })
})

/**
 * 🔴 **394 · what Codex puts in front of a person, and which half of it may travel** (HO-007 S4,
 * criterion 10).
 *
 * ## ⛔ From the wire, not from a capture
 *
 * ⚠️ **`394` §3, and the Claude suite carries the same paragraph**: every event below is built by
 * the REAL adapter from a REAL server request and handed to the real classifier.
 *
 * ## 🔴 The kind this provider differs in, and it is the dangerous one
 *
 * ⛔ **On Codex a permission arrives on the SAME EVENT TYPE as a question**, told apart by one
 * field: `handleUserInputRequest` reads `isPermission = method === 'item/permissions/requestApproval'`
 * and emits `{questions: [], permission}` for it and `{questions}` for a question. ⚠️ **A classifier
 * that asked only *"is this a `permission_request`?"* would hand a parent agent the power to widen
 * its child's sandbox** — which is why `a-grant-of-access` is its own member and is asked FIRST.
 *
 * ⚑ **And `isSecret` is Codex's alone.** `141` measured that the pinned model-tool schema does not
 * expose it and it defaults false, so no ordinary question sets it today — *absence in a capture is
 * not absence*, and the neutral question has carried the flag since `143` for exactly this.
 */
describe('394 · Codex · what may travel to a parent', () => {
  const askParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_1',
    questions: [
      {
        id: 'q_branch',
        header: 'Branch',
        question: 'which branch?',
        isOther: false,
        isSecret: false,
        options: [{ label: 'main', description: '' }],
      },
    ],
    // ⚑ What 0.160.0 really sends: `isBlocking` is required on the wire (provider follow-ups 1).
    isBlocking: false,
    autoResolutionMs: null,
  }
  const grantParams = {
    threadId: 'th_1',
    turnId: 'tn_1',
    itemId: 'it_2',
    environmentId: null,
    startedAtMs: 0,
    cwd: '/tmp/x',
    reason: 'needs write',
    permissions: { network: { enabled: true }, fileSystem: { read: null, write: ['/tmp/x/out'] } },
  }

  it('🔴 a question TRAVELS; a permissions grant and a command approval do NOT', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(80, 'item/tool/requestUserInput', askParams)
    transport.serverRequest(82, 'item/permissions/requestApproval', grantParams)
    transport.serverRequest(84, 'item/commandExecution/requestApproval', {
      command: 'rm x',
      cwd: '/tmp/x',
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))

    const verdictFor = (id: string): ReturnType<typeof askedOfTheChannel> => {
      const raised = events.find(
        (event) =>
          (event.type === 'user_input_request' || event.type === 'permission_request') &&
          event.id === id,
      )
      if (raised === undefined) throw new Error(`no request was raised for ${id}`)
      return askedOfTheChannel(raised)
    }

    expect(verdictFor('number:80')).toMatchObject({ travels: true, id: 'number:80' })
    // 🔴 **The one that arrives dressed as a question.** Both of the first two are
    // `user_input_request`; only the field tells them apart, and only one may travel.
    expect(verdictFor('number:82')).toEqual({
      travels: false,
      id: 'number:82',
      because: 'a-grant-of-access',
    })
    expect(verdictFor('number:84')).toEqual({
      travels: false,
      id: 'number:84',
      because: 'a-permission-decision',
    })

    // ⚠️ **The admitted NAMED SET, against what this adapter really emits for a question** — and the
    // grant is the control that shows the set is doing work: it carries one key more, and that key
    // is the whole difference.
    const asked = events.find(
      (event) => event.type === 'user_input_request' && event.id === 'number:80',
    )
    const granted = events.find(
      (event) => event.type === 'user_input_request' && event.id === 'number:82',
    )
    expect(Object.keys(asked ?? {}).sort()).toEqual([...QUESTION_REQUEST_KEYS].sort())
    // ⚑ A grant carries no `isBlocking` (only a question does) and one key the set refuses.
    expect(Object.keys(granted ?? {}).sort()).toEqual(
      ['type', 'id', 'prompt', 'questions', 'permission'].sort(),
    )

    await handle.close()
    await consumer
  })

  it('⛔ a question whose answer is a SECRET is a person’s to type, and the ordinary one beside it still travels', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(85, 'item/tool/requestUserInput', askParams)
    transport.serverRequest(86, 'item/tool/requestUserInput', {
      ...askParams,
      itemId: 'it_3',
      questions: [
        {
          id: 'q_token',
          header: 'Token',
          question: 'paste the deploy token',
          isOther: true,
          isSecret: true,
          options: [],
        },
      ],
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'user_input_request')).toHaveLength(2),
    )
    const raised = (id: string) =>
      events.find((event) => event.type === 'user_input_request' && event.id === id)
    // ⚑ **The pair, one fact over.** Same provider, same method, same shape; one field differs and
    // one of them travels — which is what makes this a measurement rather than a preference.
    expect(askedOfTheChannel(raised('number:85')!)).toMatchObject({ travels: true })
    expect(askedOfTheChannel(raised('number:86')!)).toEqual({
      travels: false,
      id: 'number:86',
      because: 'a-secret-only-a-person-can-type',
    })
    // ⛔ **And the flag really did survive the normalizer**, or the assertion above would be about a
    // question the adapter had flattened — the shape `143` added the field to prevent.
    const secret = raised('number:86')
    expect(secret?.type === 'user_input_request' && secret.questions[0]?.secret).toBe(true)

    await handle.close()
    await consumer
  })
})
