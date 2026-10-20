import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolAnswer } from '@brobot2/runtime'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
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
  { name: 'list_tasks', field: 'made', type: 'boolean', valid: {} },
  { name: 'list_agents', field: 'archived', type: 'boolean', valid: {} },
  { name: 'get_agent_status', field: 'agent', type: 'string', valid: { agent: 'worker' } },
  { name: 'list_questions', field: 'limit', type: 'number', valid: {} },
  {
    name: 'read_document',
    field: 'resource',
    type: 'string',
    valid: { resource: 'res_fictional' },
  },
  { name: 'read_transcript', field: 'agent', type: 'string', valid: { agent: 'worker' } },
  { name: 'find_files', field: 'words', type: 'string', valid: {} },
] as const

describe('reader tools answer field failures through Claude MCP', () => {
  let world: AServiceWorld
  let host: ReturnType<AServiceWorld['aHost']>
  let caller: string
  let worker: string
  let resource: string
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
    const path = join(world.folder, 'fictional-notes.md')
    writeFileSync(path, 'Fictional notes for a reader.')
    const update = agentToolsFor(host, caller).tools.find((one) => one.name === 'update_work')!
    const kept = await update.call({ piece: given.piece, resources: [path] })
    if (kept.structured?.outcome !== 'ok') throw new Error('fictional resource refused')
    resource = world.store.resourcesOf(given.piece)[0]!.resource
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
  const valid = (name: ToolName): Record<string, unknown> => {
    const entry = cases.find((one) => one.name === name)!
    return {
      ...entry.valid,
      ...('agent' in entry.valid ? { agent: worker } : {}),
      ...(name === 'read_document' ? { resource } : {}),
    }
  }

  async function server(name: ToolName, strict = false) {
    const selected = toolOf(name)
    const configured = claudeMcpServersFor({
      server: 'brobot',
      tools: [
        {
          ...selected,
          handlerOwnsMissingInput: strict ? false : selected.handlerOwnsMissingInput,
          input: strict
            ? { ...selected.input, [cases.find((one) => one.name === name)!.field]: z.string() }
            : selected.input,
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

  const words = (packet: Packet): string => {
    expect(packet.error).toBeUndefined()
    expect(packet.result?.isError, JSON.stringify(packet)).not.toBe(true)
    return packet.result!.content!.map((one) => one.text ?? '').join('\n')
  }
  const ownRefusal = (packet: Packet): string => {
    const text = words(packet)
    expect(calls.at(-1)?.structured).toMatchObject({
      outcome: 'refused',
      rail: 'malformed-request',
    })
    expect(text).toContain('refused (malformed-request)')
    expect(text).not.toContain('PRIVATE_VALUE')
    return text
  }
  const keptRefusals = () => world.ledger(caller).filter((one) => one.type === 'tool_refused')
  const effects = () => ({
    caller: world.ledger(caller).filter((one) => one.type !== 'tool_refused'),
    worker: world.ledger(worker),
    starts: [...world.startedAs],
    sends: [...world.sent],
  })

  for (const entry of cases) {
    it(`${entry.name}: a wrong type gets the app's field refusal through real MCP`, async () => {
      const wire = await server(entry.name)
      const before = effects()
      const text = ownRefusal(
        await wire.call({ ...valid(entry.name), [entry.field]: ['PRIVATE_VALUE'] }),
      )
      const expected = { string: 'text', boolean: 'true or false', number: 'a number' }[entry.type]
      expect(text).toContain(`${entry.field}: expected ${expected}, got a list`)
      expect(keptRefusals()).toHaveLength(1)
      expect(JSON.stringify(keptRefusals())).not.toContain('PRIVATE_VALUE')
      expect(effects()).toEqual(before)
    })

    it(`${entry.name}: every declared field is checked at the handler`, async () => {
      const wire = await server(entry.name)
      for (const field of Object.keys(toolOf(entry.name).input)) {
        expect(
          ownRefusal(await wire.call({ ...valid(entry.name), [field]: ['PRIVATE_VALUE'] })),
        ).toContain(field)
      }
    })

    it(`${entry.name}: an unknown key is bounded, private in the record, and lists declared fields`, async () => {
      const wire = await server(entry.name)
      const before = effects()
      const text = ownRefusal(
        await wire.call({ ...valid(entry.name), PRIVATE_TYPO: 'PRIVATE_VALUE' }),
      )
      expect(text).toContain('PRIVATE_TYPO')
      expect(text).toContain(`it takes only ${Object.keys(toolOf(entry.name).input).join(', ')}`)
      expect(JSON.stringify(keptRefusals())).not.toContain('PRIVATE_TYPO')
      expect(JSON.stringify(keptRefusals())).not.toContain('PRIVATE_VALUE')
      expect(effects()).toEqual(before)
    })

    it(`${entry.name}: declared valid calls retain their answer`, async () => {
      world.clockStep = 0
      const args = valid(entry.name)
      const direct = await toolOf(entry.name).call(args)
      expect(direct.structured?.outcome, direct.text).toBe('ok')
      const wire = await server(entry.name)
      expect(words(await wire.call(args))).toBe(direct.text)
      expect(calls.at(-1)?.structured).toEqual(direct.structured)
    })

    it(`${entry.name}: tools/list still advertises the original type and optionality`, async () => {
      const wire = await server(entry.name)
      const packet = await wire.list()
      const schema = packet.result!.tools![0]!.inputSchema
      const properties = schema.properties as Record<string, Record<string, unknown>>
      expect(properties[entry.field]?.type).toBe(entry.type === 'number' ? 'integer' : entry.type)
      expect(properties[entry.field]?.description).toEqual(expect.any(String))
      expect(properties[entry.field]).not.toHaveProperty('default')
      if ('agent' in entry.valid || 'resource' in entry.valid)
        expect(schema.required).toContain(entry.field)
      else expect(schema.required ?? []).not.toContain(entry.field)
    })

    it(`${entry.name}: restoring SDK validation is caught by the refusal control`, async () => {
      const wire = await server(entry.name, true)
      const packet = await wire.call({ ...valid(entry.name), [entry.field]: ['PRIVATE_VALUE'] })
      expect(packet.result?.isError).toBe(true)
      expect(packet.result?.content?.[0]?.text).toContain('MCP error -32602')
      expect(() => ownRefusal(packet)).toThrow()
      expect(calls).toEqual([])
    })

    if ('agent' in entry.valid || 'resource' in entry.valid) {
      it(`${entry.name}: a missing required field gives its address remedy and typo guidance`, async () => {
        const wire = await server(entry.name)
        const args = valid(entry.name)
        delete args[entry.field]
        const text = ownRefusal(await wire.call({ ...args, PRIVATE_TYPO: 'PRIVATE_VALUE' }))
        expect(text).toContain(
          entry.field === 'agent'
            ? 'agent: required; name the agent by the piece it owns (W1.2) or its id'
            : 'resource: required; send the resource id (res_…)',
        )
        expect(text).toContain('it takes only')
        expect(text).not.toContain('Symbol')
      })
    }
  }

  it('blank semantic fields retain their remedy beside unknown-key guidance', async () => {
    const wire = await server('read_transcript')
    const text = ownRefusal(await wire.call({ agent: '', PRIVATE_TYPO: 'PRIVATE_VALUE' }))
    expect(text).toContain('agent is required')
    expect(text).toContain('it takes only agent, turns_back, search')
  })

  it('numeric value bounds retain their words beside unknown-key guidance', async () => {
    const wire = await server('list_questions')
    const text = ownRefusal(await wire.call({ limit: 0, PRIVATE_TYPO: 'PRIVATE_VALUE' }))
    expect(text).toContain('limit')
    expect(text).toContain('whole number')
    expect(text).toContain('it takes only state, limit')
  })

  it('unknown names and lists are bounded without preserving their values', async () => {
    const wire = await server('list_tasks')
    const names = Array.from({ length: 8 }, (_, index) => `${String(index)}_${'x'.repeat(20000)}`)
    const text = ownRefusal(
      await wire.call(Object.fromEntries(names.map((name) => [name, 'PRIVATE_VALUE']))),
    )
    expect(text).toContain('and 3 more')
    expect(text.length).toBeLessThan(1200)
    expect(JSON.stringify(keptRefusals())).not.toContain('x'.repeat(40))
  })
})
