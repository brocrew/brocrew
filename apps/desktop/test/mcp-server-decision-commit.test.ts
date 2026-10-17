import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { mcpRequestWorld, type McpRequestWorld } from './helpers/mcp-server-request-world'

describe('an MCP decision reports only its durable ending', () => {
  let world: McpRequestWorld
  let host: RuntimeHost
  let asker: string
  beforeEach(async () => {
    world = mcpRequestWorld()
    host = world.host()
    asker = await world.open(host)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })
  async function ask(url: string) {
    const tool = agentToolsFor(host, asker).tools.find((one) => one.name === 'request_mcp_server')!
    const answer = await tool.call({
      name: 'fictional-notes',
      url,
      reaches: 'Read fictional notes.',
      who_gets_it: 'only-these-agents',
      agents: ['writer'],
    })
    expect(answer.structured).toMatchObject({ outcome: 'ok' })
    return answer.structured!.request as string
  }
  const decide = (id: string, approve = true, on = host) =>
    executeRuntimeCommand(on, world.window, {
      kind: 'decideMcpServerRequest',
      requestId: id,
      approve,
    })
  const endings = (id: string) =>
    world
      .ledger(asker)
      .filter((one) => one.type === 'mcp_server_request_settled' && one.requestId === id)

  it('a refusal winning on another host during discovery prevents the fresh insert and grants', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const gate = world.gate()
    server.holdUntil(gate.promise, 1)
    const approval = decide(id)
    void approval.catch(() => undefined)
    await expect.poll(() => server.requests).toBe(1)
    const other = world.host()
    expect(await decide(id, false, other)).toEqual({
      outcome: 'taken',
      reason: 'Refused. Nothing was registered.',
    })
    expect(endings(id)).toMatchObject([{ ending: 'refused' }])
    gate.release()
    expect(await approval).toEqual({
      outcome: 'refused',
      reason: 'somebody answered that request first',
      stillOpen: false,
    })
    expect(world.store.externalMcpServers()).toEqual([])
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    expect(endings(id)).toHaveLength(1)
    expect(world.sent.map((one) => one.text).join('')).not.toContain('The person approved')
  })

  it('a SQLite ending fault rolls back the inserted server and grants before any approval acknowledgment', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await host.close(asker, world.window)
    world.db.exec(`CREATE TRIGGER fictional_ending_fault BEFORE INSERT ON events
      WHEN NEW.type = 'mcp_server_request_settled'
      BEGIN SELECT RAISE(ABORT, 'fictional ending fault'); END`)
    expect(await decide(id)).toMatchObject({ outcome: 'refused', stillOpen: true })
    expect(endings(id)).toEqual([])
    expect(world.store.externalMcpServers()).toEqual([])
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    expect(world.sent).toEqual([])
    world.db.exec('DROP TRIGGER fictional_ending_fault')
    expect(await decide(id)).toMatchObject({ outcome: 'taken' })
    await expect.poll(() => endings(id)).toMatchObject([{ ending: 'approved' }])
    expect(world.store.externalMcpServers()).toHaveLength(1)
    expect(world.store.externalMcpServersFor('writer')).toEqual(world.store.externalMcpServers())
    expect(endings(id)).toHaveLength(1)
  })

  it.each(['refusal', 'collision'] as const)(
    'a live %s append failure cannot settle the card or deliver a completed notice',
    async (why) => {
      const server = await world.server(why === 'collision' ? ['list_tasks'] : ['read_notes'])
      const id = await ask(server.url)
      const append = world.store.append.bind(world.store)
      vi.spyOn(world.store, 'append').mockImplementation((...values) => {
        if (values[2].type === 'mcp_server_request_settled')
          throw new Error('fictional ending write failed')
        return append(...values)
      })
      const result = await decide(id, why === 'collision').then(
        (ack) => ({ ack, error: null }),
        (error: unknown) => ({ ack: null, error }),
      )
      if (result.ack !== null)
        expect(result.ack).toMatchObject({ outcome: 'refused', stillOpen: true })
      else expect(result.error).toBeInstanceOf(Error)
      expect(endings(id)).toEqual([])
      expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
      expect(world.store.externalMcpServers()).toEqual([])
      expect(world.sent.map((one) => one.text).join('')).not.toContain(
        why === 'collision' ? 'BroCrew could not register' : 'The person refused request',
      )
    },
  )
})
