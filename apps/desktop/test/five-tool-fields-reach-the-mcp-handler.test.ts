import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CallToolResultSchema, ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { AgentToolAnswer } from '@brobot2/runtime'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import { answerCodexToolCall } from '../../../packages/runtime/src/codex/agent-tools'
import type { SendReceipt } from '../src/shared/tool-outcome'
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
    const sends = tool === 'give_work' || tool === 'ask_question' || tool === 'message_agent'
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

  it.each(['Claude', 'Codex'] as const)(
    '%s keeps the recorded Message receipt after an unclassified start failure',
    async (adapter) => {
      await host.close(worker, world.window)
      const failure = new Error('fictional unclassified resume failure')
      const wake = vi.spyOn(host, 'resumeSession').mockRejectedValueOnce(failure)
      const wire = await server('message_agent')
      const text = 'Keep these notes until this conversation can run.'
      const args = { agent: worker, text }
      let said: string
      if (adapter === 'Claude') {
        said = words(await wire.call(args))
      } else {
        const response = await answerCodexToolCall(wire.set, {
          namespace: 'brobot',
          tool: 'message_agent',
          arguments: args,
        })
        expect(response.success).toBe(true)
        said = response.contentItems
          .map((item) => (item.type === 'inputText' ? item.text : ''))
          .join('\n')
      }
      const receipt = calls.at(-1)?.structured?.receipt as SendReceipt
      expect(receipt.recorded).toMatchObject({ kind: 'message', id: expect.any(String) })
      expect(receipt.recipient).toMatchObject({
        id: worker,
        state: { kind: 'cannot-run', cause: { code: 'could-not-start' } },
      })
      expect(said).toContain(`Your message ${receipt.recorded.id} is recorded for conversation`)
      expect(said).not.toContain(failure.message)
      expect(world.store.messagesWaitingIn(worker)).toEqual([
        expect.objectContaining({ messageId: receipt.recorded.id, text }),
      ])
      expect(world.sent.filter((one) => one.words.includes(text))).toHaveLength(0)
      wake.mockRestore()
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
    },
  )

  it('give_work still requires definition_of_done at the handler', async () => {
    const wire = await server('give_work')
    const args = valid('give_work')
    delete args.definition_of_done
    const before = effects()
    ownRefusal('give_work', await wire.call(args), 'definition_of_done')
    expect(effects()).toEqual(before)
  })

  it('compact_agent keeps required text fields and records malformed requests at the handler', async () => {
    const wire = await server('compact_agent')
    const advertised = await wire.list()
    expect(advertised.error).toBeUndefined()
    const schema = advertised.result!.tools![0]!.inputSchema
    expect(schema.required).toEqual(['agent', 'reason'])
    expect(schema.properties).toMatchObject({
      agent: { type: 'string', description: 'The conversation, by any of its labels.' },
      reason: { type: 'string', description: 'Why you are asking for compaction.' },
    })

    const compact = vi.spyOn(host, 'compactConversation')
    const before = effects()
    const reason = 'Make room for the next reply'
    for (const args of [
      { reason },
      { agent: worker },
      { agent: ['PRIVATE_VALUE'], reason },
      { agent: worker, reason: ['PRIVATE_VALUE'] },
    ]) {
      const text = ownRefusal(
        'compact_agent',
        await wire.call(args),
        'agent and reason are both required',
      )
      expect(text).not.toContain('Symbol')
      expect(kept().at(-1)).toMatchObject({
        tool: 'compact_agent',
        rail: 'malformed-request',
        told: {
          text: expect.stringContaining('the arguments did not match what this tool accepts'),
        },
      })
    }
    expect(calls).toHaveLength(4)
    expect(kept()).toHaveLength(4)
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
