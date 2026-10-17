import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolAnswer } from '@brobot2/runtime'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { refuseMessage } from '../src/main/runtime/message-rails'
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
        title: 'Notes',
        definition_of_done: 'Notes are collected.',
        brief: 'Collect notes.',
      }
    if (name === 'ask_question')
      return { who_answers: 'an-agent', agent: worker, question: 'What did you find?' }
    if (name === 'message_agent')
      return { agent: worker, kind: 'note', text: 'The notes are here.' }
    if (name === 'answer_question')
      return { question: 'q_fictional', cannot_answer: 'I cannot settle this.' }
    return { title: 'Notes', definition_of_done: 'Notes are collected.', brief: 'Collect notes.' }
  }

  async function server(name: ToolName, strictField?: string) {
    const selected = toolOf(name)
    const configured = claudeMcpServersFor({
      server: 'brobot',
      tools: [
        {
          ...selected,
          handlerOwnsMissingInput:
            strictField === undefined ? selected.handlerOwnsMissingInput : false,
          input:
            strictField === undefined
              ? selected.input
              : { ...selected.input, [strictField]: z.string() },
          call: async (args: Record<string, unknown>) => {
            const result = await selected.call(args)
            calls.push(result)
            return result
          },
        },
      ],
    })!
    const low = (
      configured.brobot as unknown as {
        instance: { server: { connect(transport: unknown): Promise<void>; close(): Promise<void> } }
      }
    ).instance.server
    const out: Packet[] = []
    const transport: Record<string, unknown> = {
      start: async () => {},
      send: async (packet: Packet) => {
        out.push(packet)
      },
      close: async () => {},
    }
    await low.connect(transport)
    closes.push(() => low.close())
    let id = 0
    async function request(method: string, params: Record<string, unknown>) {
      const next = ++id
      ;(transport.onmessage as (packet: unknown) => void)({
        jsonrpc: '2.0',
        id: next,
        method,
        params,
      })
      await vi.waitFor(() => expect(out.some((packet) => packet.id === next)).toBe(true), {
        timeout: 5000,
      })
      return out.find((packet) => packet.id === next)!
    }
    await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fictional-test', version: '1' },
    })
    ;(transport.onmessage as (packet: unknown) => void)({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    return {
      call: (args: Record<string, unknown>) => request('tools/call', { name, arguments: args }),
      list: () => request('tools/list', {}),
    }
  }

  function words(packet: Packet): string {
    expect(packet.error).toBeUndefined()
    expect(packet.result?.isError, JSON.stringify(packet)).not.toBe(true)
    return packet.result!.content!.map((one) => one.text ?? '').join('\n')
  }
  function ownRefusal(packet: Packet, field: string): string {
    const text = words(packet)
    expect(text).toContain('refused (malformed-request)')
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

  it('a denied message asks its authority wall without touching the supplied object', async () => {
    const tool = toolOf('message_agent')
    const wall = refuseMessage('may-not-message')
    const authority = vi.spyOn(host, 'mayReachAtAll').mockReturnValue(wall)
    const reads = vi.fn(() => {
      throw new Error('arguments were read before the wall')
    })
    const args = new Proxy({}, { ownKeys: reads, get: reads })
    const before = effects()
    const result = await tool.call(args)
    expect(result.structured).toMatchObject({ rail: wall.rail, reason: wall.reason })
    expect(authority).toHaveBeenCalledExactlyOnceWith('message', expect.any(Object))
    expect(reads).not.toHaveBeenCalled()
    expect(effects()).toEqual(before)
  })

  it('give_work still requires definition_of_done at the handler', async () => {
    const wire = await server('give_work')
    const args = valid('give_work')
    delete args.definition_of_done
    const before = effects()
    ownRefusal(await wire.call(args), 'definition_of_done')
    expect(effects()).toEqual(before)
  })

  for (const entry of cases) {
    it(`${entry.name}: wrong field type gets a field remedy, without effects or caller values`, async () => {
      const wire = await server(entry.name)
      const before = effects()
      const text = ownRefusal(
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
      const text = ownRefusal(await wire.call(args), entry.field)
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
      const text = ownRefusal(await wire.call(args), entry.field)
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
      if (entry.name === 'message_agent')
        expect(properties.kind?.enum).toEqual(['note', 'follow-up'])
    })

    it(`${entry.name}: restoring the strict SDK field is caught before its handler`, async () => {
      const wire = await server(entry.name, entry.field)
      const args = valid(entry.name)
      delete args[entry.field]
      const packet = await wire.call(args)
      expect(packet.result?.isError).toBe(true)
      expect(packet.result?.content?.[0]?.text).toContain(
        'MCP error -32602: Input validation error',
      )
      expect(calls).toEqual([])
      expect(() => ownRefusal(packet, entry.field)).toThrow()
      expect(kept()).toEqual([])
    })
  }

  it('nested answer failures name only declared paths, never the caller part or choice', async () => {
    const wire = await server('answer_question')
    const before = effects()
    const text = ownRefusal(
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
      ownRefusal(await wire.call({ ...valid(name), PRIVATE_TYPO: 'PRIVATE_VALUE' }), 'PRIVATE_TYPO')
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
      const text = ownRefusal(packet, 'unknown fields')
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

  for (const patch of [
    { kind: 'follow-up', peice: 'PRIVATE_MISSPELLED_PIECE' },
    { kind: 'note', piece: '', peice: 'PRIVATE_MISSPELLED_PIECE' },
  ]) {
    it(`message_agent: ${patch.kind} piece failures include typo guidance without sending`, async () => {
      const wire = await server('message_agent')
      const before = effects()
      const text = ownRefusal(await wire.call({ ...valid('message_agent'), ...patch }), 'piece:')
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
      patch: { parallel: 'yes' },
      field: 'parallel',
      line: 'expected true or false, got text',
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
        await wire.call({ ...valid(entry.name), ...entry.patch }),
        entry.field,
      )
      expect(text).toContain(entry.line)
      expect(effects()).toEqual(before)
    })
  }
})
