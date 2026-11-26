import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AgentToolAnswer } from '@brobot2/runtime'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import { answerCodexToolCall } from '../../../packages/runtime/src/codex/agent-tools'
import type { SendReceipt } from '../src/shared/tool-outcome'
import * as recordedReceipt from '../src/main/runtime/send-receipt'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

type Packet = {
  id?: number
  error?: { code: number }
  result?: {
    isError?: boolean
    content?: { type: string; text?: string }[]
    tools?: { name: string; inputSchema: Record<string, unknown> }[]
  }
}
const cases = [
  {
    name: 'give_work',
    field: 'profile',
    supplied: ['PRIVATE_VALUE'],
    expected: 'profile: expected text, got a list',
  },
  {
    name: 'ask_question',
    field: 'question',
    supplied: ['PRIVATE_VALUE'],
    expected: 'question: expected text, got a list',
  },
  {
    name: 'message_agent',
    field: 'text',
    supplied: ['PRIVATE_VALUE'],
    expected: 'text: expected text, got a list',
  },
  {
    name: 'answer_question',
    field: 'question',
    supplied: ['PRIVATE_VALUE'],
    expected: 'question: expected text, got a list',
  },
  {
    name: 'take_on_work',
    field: 'title',
    supplied: ['PRIVATE_VALUE'],
    expected: 'title: expected text, got a list',
  },
] as const

describe('five more tools answer field failures through Claude MCP', () => {
  let world: AServiceWorld
  let host: ReturnType<AServiceWorld['aHost']>
  let caller: string
  let worker: string
  let closes: (() => Promise<void>)[]
  let calls: AgentToolAnswer[]

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('parent', 'normal')
    world.anAgent('worker', 'normal')
    host = world.aHost()
    caller = await world.aPersonOpens(host, 'parent')
    const given = await world.gives(host, caller, 'worker')
    if (!given.ok) throw new Error('fictional work refused')
    worker = given.owner
    await host.send(caller, 'Please collect the fictional notes.', world.window)
    closes = []
    calls = []
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const close of closes) await close()
    await world.cleanUp()
  })

  const toolOf = (name: ToolName) =>
    agentToolsFor(host, caller).tools.find((one) => one.name === name)!
  const valid = (name: string): Record<string, unknown> => {
    if (name === 'give_work')
      return {
        profile: 'worker',
        to: worker,
        title: 'Notes',
        definition_of_done: 'Notes are collected.',
        brief: 'Collect notes.',
      }
    if (name === 'ask_question')
      return { who_answers: 'an-agent', agent: worker, question: 'What did you find?' }
    if (name === 'message_agent') return { agent: worker, text: 'The notes are here.' }
    if (name === 'answer_question')
      return { question: 'q_fictional', cannot_answer: 'I cannot settle this.' }
    return { title: 'Notes', definition_of_done: 'Notes are collected.', brief: 'Collect notes.' }
  }

  async function server(name: ToolName) {
    const selected = toolOf(name)
    const set = {
      server: 'brobot',
      tools: [
        {
          ...selected,
          call: async (args: Record<string, unknown>) => {
            const result = await selected.call(args)
            calls.push(result)
            return result
          },
        },
      ],
    }
    const configured = claudeMcpServersFor(set)!
    const low = (
      configured.brobot as unknown as {
        instance: { server: { connect(transport: unknown): Promise<void>; close(): Promise<void> } }
      }
    ).instance.server
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'fictional-test', version: '1' })
    closes.push(async () => {
      await client.close()
      await low.close()
    })
    await low.connect(serverTransport)
    await client.connect(clientTransport, { timeout: 5000 })
    return {
      set,
      call: async (args: Record<string, unknown>): Promise<Packet> => ({
        result: await client.request(
          { method: 'tools/call', params: { name, arguments: args } },
          CallToolResultSchema,
          { timeout: 5000 },
        ),
      }),
      list: async (): Promise<Packet> => ({
        result: await client.request({ method: 'tools/list' }, ListToolsResultSchema, {
          timeout: 5000,
        }),
      }),
    }
  }

  function words(packet: Packet): string {
    expect(packet.error).toBeUndefined()
    expect(packet.result?.isError, JSON.stringify(packet)).not.toBe(true)
    return packet.result!.content!.map((one) => one.text ?? '').join('\n')
  }
  function ownRefusal(tool: ToolName, packet: Packet, field: string): string {
    const text = words(packet)
    const sends =
      tool === 'give_work' ||
      tool === 'ask_question' ||
      tool === 'message_agent' ||
      tool === 'answer_question'
    expect(text).toMatch(sends ? /^Not sent: / : /^refused \(malformed-request\): /)
    expect(text).toContain(field)
    expect(text).not.toContain('PRIVATE_VALUE')
    expect(text).not.toContain('MCP error')
    expect(calls.at(-1)?.structured).toMatchObject({
      outcome: 'refused',
      rail: 'malformed-request',
    })
    return text
  }
  const kept = () => world.ledger(caller).filter((one) => one.type === 'tool_refused')
  const effects = () => ({
    caller: world.ledger(caller).filter((one) => one.type !== 'tool_refused'),
    worker: world.ledger(worker),
    starts: [...world.startedAs],
    sends: [...world.sent],
    owned: world.store.piecesOwnedBy(caller),
  })

  it.each(
    (['Claude', 'Codex'] as const).flatMap((adapter) =>
      (
        [
          'start',
          'readback',
          'sender-started',
          'sender-queued',
          'sender-published',
          'address',
          'title',
          'service',
          'unknown-title',
          'wait',
        ] as const
      ).map((failureAt) => ({ adapter, failureAt })),
    ),
  )('$adapter keeps recording facts after $failureAt failure', async ({ adapter, failureAt }) => {
    await host.close(worker, world.window)
    const failure = new Error('fictional unclassified resume failure')
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wake =
      failureAt === 'start' ? vi.spyOn(host, 'resumeSession').mockRejectedValueOnce(failure) : null
    const lookup =
      failureAt === 'readback' || failureAt === 'unknown-title'
        ? vi.spyOn(host, 'stateOfARecordedMessage').mockImplementation(() => {
            throw failure
          })
        : null
    const descriptiveFailure = ['address', 'title', 'service', 'unknown-title', 'wait'].includes(
      failureAt,
    )
    const beforeRender: {
      id: string
      state: SendReceipt['recipient']['state']
      recordings: number
      deliveries: number
    }[] = []
    const captureFacts = (id: string, state: SendReceipt['recipient']['state']) => {
      beforeRender.push({
        id,
        state,
        recordings: world
          .ledger(worker)
          .filter((event) => event.type === 'message_queued' && event.messageId === id).length,
        deliveries: world.sent.filter((one) => one.words.includes(text)).length,
      })
    }
    let failedDescriptions = 0
    let rendering = false
    let enriching = false
    const recorded = recordedReceipt.receiptForRecordedMessage
    const enrichmentBoundary = vi
      .spyOn(recordedReceipt, 'receiptForRecordedMessage')
      .mockImplementation((facts, render) =>
        recorded(facts, () => {
          if (failureAt === 'wait') captureFacts(facts.recorded.id, facts.state)
          enriching = true
          try {
            return render()
          } finally {
            enriching = false
          }
        }),
      )
    const waiting = host.whyWhatIsHeldWaits.bind(host)
    const waitRead = vi.spyOn(host, 'whyWhatIsHeldWaits').mockImplementation((id, stop) => {
      if (enriching && id === worker && failureAt === 'wait') {
        failedDescriptions += 1
        throw failure
      }
      return waiting(id, stop)
    })
    const render = host.receiptForSend.bind(host)
    const renderingBoundary = vi.spyOn(host, 'receiptForSend').mockImplementation((facts) => {
      if (descriptiveFailure && failureAt !== 'wait') captureFacts(facts.recorded.id, facts.state)
      rendering = true
      try {
        return render(facts)
      } finally {
        rendering = false
      }
    })
    const addressOf = world.store.firstTaskOf.bind(world.store)
    const addressRead = vi.spyOn(world.store, 'firstTaskOf').mockImplementation((id) => {
      if (rendering && id === worker && failureAt === 'address') {
        failedDescriptions += 1
        throw failure
      }
      return addressOf(id)
    })
    const titleOf = world.store.conversationTitle.bind(world.store)
    const titleRead = vi.spyOn(world.store, 'conversationTitle').mockImplementation((id) => {
      if (rendering && id === worker && (failureAt === 'title' || failureAt === 'unknown-title')) {
        failedDescriptions += 1
        throw failure
      }
      return titleOf(id)
    })
    const serviceBorn = world.store.serviceBorn.bind(world.store)
    const serviceRead = vi.spyOn(world.store, 'serviceBorn').mockImplementation((id) => {
      if (rendering && id === worker && failureAt === 'service') {
        failedDescriptions += 1
        throw failure
      }
      return serviceBorn(id)
    })
    const append = world.store.append.bind(world.store)
    const senderWrites = vi.spyOn(world.store, 'append').mockImplementation((...args) => {
      const senderReceipt = args[0] === caller && args[2].type === 'message_sent'
      if (senderReceipt && failureAt.startsWith('sender-') && failureAt !== 'sender-published')
        throw failure
      return append(...args)
    })
    const publish = world.window.send.bind(world.window)
    const publication = vi.spyOn(world.window, 'send').mockImplementation((message) => {
      if (
        failureAt === 'sender-published' &&
        message.sessionId === caller &&
        message.event.type === 'message_sent'
      )
        throw failure
      publish(message)
    })
    if (failureAt === 'sender-queued' || failureAt === 'wait') {
      world.onResumed = (_profile, handle) => {
        handle.send = async () => {
          throw new Error('fictional delivery blocked before sending')
        }
      }
    }
    const wire = await server('message_agent')
    const text = 'Keep these notes until this conversation can run.'
    const args = { agent: worker, text }
    const assertBeforeRender = () => {
      if (!descriptiveFailure) return
      expect(beforeRender).toEqual([
        {
          id: expect.any(String),
          state:
            failureAt === 'wait'
              ? { kind: 'queued', behind: 0 }
              : { kind: failureAt === 'unknown-title' ? 'delivery-unknown' : 'started' },
          recordings: 1,
          deliveries: failureAt === 'wait' ? 0 : 1,
        },
      ])
    }
    let said: string
    if (adapter === 'Claude') {
      const packet = await wire.call(args)
      assertBeforeRender()
      said = words(packet)
    } else {
      const response = await answerCodexToolCall(wire.set, {
        namespace: 'brobot',
        tool: 'message_agent',
        arguments: args,
      })
      assertBeforeRender()
      expect(response.success).toBe(true)
      said = response.contentItems
        .map((item) => (item.type === 'inputText' ? item.text : ''))
        .join('\n')
    }
    const receipt = calls.at(-1)?.structured?.receipt as SendReceipt
    expect(receipt.recorded).toMatchObject({ kind: 'message', id: expect.any(String) })
    expect(receipt.recipient).toMatchObject({
      id: worker,
      state:
        failureAt === 'start'
          ? { kind: 'cannot-run', cause: { code: 'could-not-start' } }
          : {
              kind:
                failureAt === 'readback' || failureAt === 'unknown-title'
                  ? 'delivery-unknown'
                  : failureAt !== 'sender-queued' && failureAt !== 'wait'
                    ? 'started'
                    : 'queued',
            },
    })
    const recordedMessage = `Your message ${receipt.recorded.id} is recorded`
    const hasDelivery = ['started', 'queued'].includes(receipt.recipient.state.kind)
    expect(said).toContain(
      hasDelivery ? `${recordedMessage}.` : `${recordedMessage} for conversation`,
    )
    expect(
      said.split(`conversation ${receipt.recipient.address} · ${receipt.recipient.title}`),
    ).toHaveLength(2)
    expect(said).not.toContain(failure.message)
    expect(warned.mock.calls.flat().join(' ')).toContain(failure.message)
    if (failureAt === 'readback' || failureAt === 'unknown-title') {
      expect(said).toContain('Delivery could not be determined.')
      expect(lookup).toHaveBeenCalledTimes(1)
      expect(
        senderWrites.mock.calls.filter(
          ([id, , event]) => id === caller && event.type === 'message_sent',
        ),
      ).toHaveLength(0)
    }
    if (failureAt.startsWith('sender-')) {
      expect(receipt).toMatchObject({ senderHistoryUnconfirmed: true })
      expect(
        senderWrites.mock.calls.filter(
          ([id, , event]) => id === caller && event.type === 'message_sent',
        ),
      ).toHaveLength(1)
      expect(said).toContain("The sender's history could not be confirmed.")
      expect(said).toContain(failureAt !== 'sender-queued' ? 'Delivered to ' : 'Held for ')
    }
    if (failureAt === 'sender-queued')
      expect(receipt.recipient.state).toMatchObject({ kind: 'queued', behind: 0 })
    if (failureAt === 'sender-published') {
      expect(
        world
          .ledger(caller)
          .filter(
            (event) => event.type === 'message_sent' && event.messageId === receipt.recorded.id,
          ),
      ).toHaveLength(1)
    }
    if (descriptiveFailure) {
      expect(receipt.recorded.id).toBe(beforeRender[0]?.id)
      expect(receipt.recipient).toMatchObject({ address: worker, title: 'title unavailable' })
      expect(failedDescriptions).toBe(1)
      expect(renderingBoundary).toHaveBeenCalledTimes(failureAt === 'wait' ? 0 : 1)
      expect(enrichmentBoundary).toHaveBeenCalledTimes(1)
    }
    if (failureAt === 'wait') {
      expect(receipt.recipient.state).toEqual({ kind: 'queued', behind: 0 })
      expect(receipt.senderHistoryUnconfirmed).toBeUndefined()
      expect(said).toContain('Held for ')
    }
    renderingBoundary.mockRestore()
    enrichmentBoundary.mockRestore()
    waitRead.mockRestore()
    addressRead.mockRestore()
    titleRead.mockRestore()
    serviceRead.mockRestore()
    lookup?.mockRestore()
    senderWrites.mockRestore()
    publication.mockRestore()
    const alreadySent =
      failureAt === 'readback' ||
      failureAt === 'sender-started' ||
      failureAt === 'sender-published' ||
      failureAt === 'address' ||
      failureAt === 'title' ||
      failureAt === 'service' ||
      failureAt === 'unknown-title'
    expect(
      world
        .ledger(worker)
        .filter(
          (event) => event.type === 'message_queued' && event.messageId === receipt.recorded.id,
        ),
    ).toHaveLength(1)
    if (alreadySent) {
      expect(world.store.messagesWaitingIn(worker)).toEqual([])
      expect(world.sent.filter((one) => one.words.includes(text))).toHaveLength(1)
      await host.close(worker, world.window)
      await host.resumeSession(worker, world.window)
      expect(world.sent.filter((one) => one.words.includes(text))).toHaveLength(1)
      return
    }
    expect(world.store.messagesWaitingIn(worker)).toEqual([
      expect.objectContaining({ messageId: receipt.recorded.id, text }),
    ])
    expect(world.sent.filter((one) => one.words.includes(text))).toHaveLength(0)
    if (failureAt === 'sender-queued' || failureAt === 'wait') return
    wake?.mockRestore()
    world.onResumed = null
    await host.resumeSession(worker, world.window)
    await vi.waitFor(() => {
      expect(world.store.messagesWaitingIn(worker)).toEqual([])
      expect(world.sent.filter((one) => one.words.includes(text))).toHaveLength(1)
    })
    expect(world.ledger(worker)).toContainEqual(
      expect.objectContaining({
        type: 'message_unqueued',
        messageId: receipt.recorded.id,
        reason: 'sent',
      }),
    )
  })

  it('give_work keeps files supplied under both names through MCP', async () => {
    const wire = await server('give_work')
    const first = join(world.folder, 'first.md')
    const second = join(world.folder, 'second.md')
    writeFileSync(first, 'First file')
    writeFileSync(second, 'Second file')
    words(await wire.call({ ...valid('give_work'), resources: [first], inputs: [second] }))
    expect(calls.at(-1)?.structured).toMatchObject({
      outcome: 'ok',
      inputs: [{ name: 'first.md' }, { name: 'second.md' }],
    })
  })

  it('give_work still requires definition_of_done at the handler', async () => {
    const wire = await server('give_work')
    const catalogue = (await wire.list()).result!.tools![0]!.inputSchema
    expect(catalogue.properties).toMatchObject({ resources: { type: 'array' } })
    expect(catalogue.properties).not.toHaveProperty('inputs')
    const args = valid('give_work')
    delete args.definition_of_done
    const before = effects()
    ownRefusal('give_work', await wire.call(args), 'definition_of_done')
    expect(effects()).toEqual(before)
  })

  it('compact_agent requires its agent, takes an optional reason, and records malformed requests at the handler', async () => {
    const wire = await server('compact_agent')
    const advertised = await wire.list()
    expect(advertised.error).toBeUndefined()
    const schema = advertised.result!.tools![0]!.inputSchema
    expect(schema.required).toEqual(['agent'])
    expect(schema.properties).toMatchObject({
      agent: { type: 'string', description: 'The conversation, by any of its labels.' },
      reason: {
        type: 'string',
        description:
          "Why, optional. The conversation reads it with your name; without one it reads 'no reason given'.",
      },
    })

    const compact = vi.spyOn(host, 'compactConversation')
    const before = effects()
    const reason = 'Make room for the next reply'
    for (const [args, problem] of [
      [{ reason }, 'agent is required'],
      [{ agent: ['PRIVATE_VALUE'], reason }, 'agent is required'],
      [{ agent: worker, reason: ['PRIVATE_VALUE'] }, 'reason must be text'],
    ] as const) {
      const text = ownRefusal('compact_agent', await wire.call(args), problem)
      expect(text).not.toContain('Symbol')
      expect(kept().at(-1)).toMatchObject({
        tool: 'compact_agent',
        rail: 'malformed-request',
        told: {
          text: expect.stringContaining('the arguments did not match what this tool accepts'),
        },
      })
    }
    expect(calls).toHaveLength(3)
    expect(kept()).toHaveLength(3)
    expect(compact).not.toHaveBeenCalled()
    expect(effects()).toEqual(before)
  })

  for (const entry of cases) {
    it(`${entry.name}: wrong field type gets a field remedy, without effects or caller values`, async () => {
      const wire = await server(entry.name)
      const before = effects()
      const text = ownRefusal(
        entry.name,
        await wire.call({ ...valid(entry.name), [entry.field]: entry.supplied }),
        entry.field,
      )
      expect(text).toContain(entry.expected)
      expect(effects()).toEqual(before)
      expect(kept()).toHaveLength(1)
      expect(kept()[0]?.told?.text).toContain(entry.expected)
      expect(JSON.stringify(kept())).not.toContain('PRIVATE_VALUE')
    })

    it(`${entry.name}: a missing required field reaches the handler, without a sentinel in the answer`, async () => {
      const wire = await server(entry.name)
      const args = valid(entry.name)
      delete args[entry.field]
      const before = effects()
      const text = ownRefusal(entry.name, await wire.call(args), entry.field)
      expect(text).toContain('required')
      expect(text).not.toContain('Symbol')
      expect(effects()).toEqual(before)
    })

    it(`${entry.name}: a misspelled field is explained without keeping its name or value`, async () => {
      const wire = await server(entry.name)
      const args = valid(entry.name)
      delete args[entry.field]
      args['PRIVATE_TYPO'] = 'PRIVATE_VALUE'
      const before = effects()
      const text = ownRefusal(entry.name, await wire.call(args), entry.field)
      expect(text).toContain('PRIVATE_TYPO')
      expect(kept()[0]?.told?.text).toBe(calls.at(-1)?.structured?.reason)
      expect(JSON.stringify(kept())).not.toContain('PRIVATE_TYPO')
      expect(JSON.stringify(kept())).not.toContain('PRIVATE_VALUE')
      expect(effects()).toEqual(before)
    })

    it(`${entry.name}: real tools/list retains required fields, types and descriptions`, async () => {
      const wire = await server(entry.name)
      const packet = await wire.list()
      expect(packet.error).toBeUndefined()
      const schema = packet.result!.tools![0]!.inputSchema
      expect(schema.required).toContain(entry.field)
      const properties = schema.properties as Record<string, Record<string, unknown>>
      expect(properties[entry.field]).toMatchObject({ type: 'string' })
      expect(properties[entry.field]?.description).toEqual(expect.any(String))
      expect(properties[entry.field]).not.toHaveProperty('default')
      if (entry.name === 'ask_question')
        expect(properties.who_answers?.enum).toEqual(['the-parent', 'a-person', 'an-agent'])
      if (entry.name === 'message_agent') {
        expect(properties).not.toHaveProperty('kind')
        expect(properties.piece).toMatchObject({ type: 'string' })
        expect(schema.required).not.toContain('piece')
      }
    })
  }

  it('nested answer failures name only declared paths, never the caller part or choice', async () => {
    const wire = await server('answer_question')
    const before = effects()
    const text = ownRefusal(
      'answer_question',
      await wire.call({ question: 'q_fictional', answers: [{ part: 'PRIVATE_PART', answer: 42 }] }),
      'answers.0.answer',
    )
    expect(text).toContain('send a list of text choices')
    expect(text).not.toContain('PRIVATE_PART')
    expect(JSON.stringify(kept())).not.toContain('PRIVATE_PART')
    expect(effects()).toEqual(before)
  })
  for (const name of ['ask_question', 'message_agent', 'answer_question'] as const) {
    it(`${name}: valid declared fields still ignore unknown optional spellings`, async () => {
      const args = valid(name)
      if (name === 'answer_question') {
        const ask = agentToolsFor(host, worker).tools.find((one) => one.name === 'ask_question')!
        const asked = await ask.call({
          who_answers: 'the-parent',
          question: 'Please settle this fictional choice.',
        })
        expect(asked.structured?.outcome).toBe('ok')
        args.question = asked.structured?.question
      }
      const wire = await server(name)
      const stopped = [...world.stopsAsked]
      const result = words(
        await wire.call({ ...args, interupt: true, PRIVATE_UNKNOWN_OPTION: 'PRIVATE_VALUE' }),
      )
      expect(calls.at(-1)?.structured?.outcome, result).toBe('ok')
      expect(result).not.toContain('PRIVATE_UNKNOWN_OPTION')
      if (name === 'message_agent') expect(world.stopsAsked).toEqual(stopped)
      expect(JSON.stringify([...world.ledger(caller), ...world.ledger(worker)])).not.toContain(
        'PRIVATE_UNKNOWN_OPTION',
      )
    })

    it(`${name}: typo guidance is bounded and cannot turn caller-named text into durable app words`, async () => {
      const entry = cases.find((one) => one.name === name)!
      const args = valid(name)
      delete args[entry.field]
      const wire = await server(name)
      const text = ownRefusal(
        name,
        await wire.call({
          ...args,
          PRIVATE_FIRST: 1,
          ['PRIVATE_BAD]\nNAME']: 2,
          ['X'.repeat(81)]: 3,
          PRIVATE_FOURTH: 4,
        }),
        entry.field,
      )
      expect(text).toContain(`PRIVATE_FIRST: not a field of ${name}; use `)
      expect(text).toContain('unknown field: not a field')
      expect(text).toContain('Other unknown fields were also sent.')
      expect(text).not.toContain('PRIVATE_BAD')
      expect(text).not.toContain('X'.repeat(81))
      expect(text).not.toContain('PRIVATE_FOURTH')
      expect(JSON.stringify(kept())).not.toContain('PRIVATE_FIRST')
      expect(JSON.stringify(kept())).not.toContain('PRIVATE_FOURTH')
      expect(JSON.stringify(kept())).not.toContain('PRIVATE_BAD')
      expect(JSON.stringify(kept())).not.toContain('X'.repeat(81))
    })
  }

  for (const name of ['give_work', 'take_on_work'] as const) {
    it(`${name}: unknown keys remain refused even when all declared fields are valid`, async () => {
      const wire = await server(name)
      const before = effects()
      ownRefusal(
        name,
        await wire.call({ ...valid(name), PRIVATE_TYPO: 'PRIVATE_VALUE' }),
        'PRIVATE_TYPO',
      )
      expect(effects()).toEqual(before)
      expect(JSON.stringify(kept())).not.toContain('PRIVATE_TYPO')
    })

    it(`${name}: unknown names and their list are bounded in both refusal forms`, async () => {
      const wire = await server(name)
      const keys = Array.from({ length: 8 }, (_, index) =>
        `PRIVATE_FAKE_KEY_${index}_`.padEnd(20017, 'x'),
      )
      const before = effects()
      const packet = await wire.call({
        ...valid(name),
        ...Object.fromEntries(keys.map((key) => [key, 'PRIVATE_VALUE'])),
      })
      const text = ownRefusal(name, packet, 'unknown fields')
      expect(text).toContain(`${keys[0]!.slice(0, 39)}…`)
      expect(text).toContain('and 3 more')
      expect(text.length).toBeLessThan(2000)
      const detail = calls.at(-1)?.structured?.detail as {
        unknownFields: string[]
      }
      expect(detail.unknownFields).toHaveLength(5)
      expect(detail.unknownFields.every((name) => name.length <= 40)).toBe(true)
      for (const key of keys) {
        expect(JSON.stringify(packet)).not.toContain(key)
        expect(JSON.stringify(calls)).not.toContain(key)
        expect(JSON.stringify(kept())).not.toContain(key.slice(0, 39))
      }
      expect(effects()).toEqual(before)
    })
  }

  for (const piece of ['', 42]) {
    it(`message_agent: invalid piece ${JSON.stringify(piece)} includes typo guidance without sending`, async () => {
      const wire = await server('message_agent')
      const before = effects()
      const text = ownRefusal(
        'message_agent',
        await wire.call({ ...valid('message_agent'), piece, peice: 'PRIVATE_MISSPELLED_PIECE' }),
        'piece:',
      )
      expect(text).toContain('peice: not a field of message_agent; use ')
      expect(text).not.toContain('PRIVATE_MISSPELLED_PIECE')
      expect(kept()[0]?.told?.text).toBe(calls.at(-1)?.structured?.reason)
      expect(JSON.stringify(kept())).not.toContain('peice')
      expect(effects()).toEqual(before)
    })
  }

  for (const entry of [
    {
      name: 'give_work',
      patch: { to: 42 },
      field: 'to',
      line: 'expected text, got a number',
    },
    {
      name: 'give_work',
      patch: { inputs: 42 },
      field: 'inputs',
      line: 'expected a list, got a number',
    },
    {
      name: 'take_on_work',
      patch: { inputs: 42 },
      field: 'inputs',
      line: 'expected a list, got a number',
    },
    {
      name: 'ask_question',
      patch: { options: 42 },
      field: 'options',
      line: 'expected a list of text choices',
    },
    {
      name: 'message_agent',
      patch: { piece: 42 },
      field: 'piece',
      line: 'send a piece label or id as text, or leave it out',
    },
    {
      name: 'message_agent',
      patch: { interrupt: 42 },
      field: 'interrupt',
      line: 'send true or false, or leave it out',
    },
    {
      name: 'answer_question',
      patch: { interrupt: 42 },
      field: 'interrupt',
      line: 'send true or false, or leave it out',
    },
  ] as const) {
    it(`${entry.name}: wrong optional ${entry.field} reaches its field remedy`, async () => {
      const wire = await server(entry.name)
      const before = effects()
      const text = ownRefusal(
        entry.name,
        await wire.call({ ...valid(entry.name), ...entry.patch }),
        entry.field,
      )
      expect(text).toContain(entry.line)
      expect(effects()).toEqual(before)
    })
  }
})
