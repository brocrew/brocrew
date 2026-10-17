import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { mcpRequestWorld, type McpRequestWorld } from './helpers/mcp-server-request-world'

describe('an approved MCP server survives a failed tools reopen', () => {
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
  const approve = (requestId: string) =>
    executeRuntimeCommand(host, world.window, {
      kind: 'decideMcpServerRequest',
      requestId,
      approve: true,
    })
  const approved = (requestId: string) =>
    world
      .ledger(asker)
      .filter((one) => one.type === 'mcp_server_request_settled' && one.requestId === requestId)
  const notice = () =>
    world.sent
      .filter((one) => one.profile === 'writer')
      .map((one) => one.text)
      .join('')

  it('a failed stopped-asker start retains its durable notice and server for the next real launch', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await host.close(asker, world.window)
    world.startFailure = new Error('fictional start failure')
    expect(await approve(id)).toMatchObject({
      outcome: 'taken',
      reason: 'Registered. It offers: read_notes.',
    })
    await expect.poll(() => world.launches.length).toBe(2)
    expect(approved(id)).toMatchObject([{ ending: 'approved' }])
    expect(
      world.store
        .messagesWaitingIn(asker)
        .map((one) => one.text)
        .join(''),
    ).toContain(`The person approved request ${id}`)
    expect(world.sent).toEqual([])
    world.startFailure = null
    host = await world.restart()
    expect(world.store.messagesWaitingIn(asker)).toHaveLength(1)
    await host.resumeSession(asker, world.window)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
    expect(world.launches.at(-1)?.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
    expect(approved(id)).toHaveLength(1)
    expect(await approve(id)).toMatchObject({
      outcome: 'refused',
      reason: 'somebody answered that request first',
      stillOpen: false,
    })
  })

  it('a failed close leaves the approved decision intact and retries the tools reopen after a later turn', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const handle = world.handles.get('writer')!
    const closing = vi.spyOn(host, 'close').mockImplementationOnce(() => {
      throw new Error('fictional close failure')
    })
    expect(await approve(id)).toMatchObject({
      outcome: 'taken',
      reason: 'Registered. It offers: read_notes.',
    })
    expect(closing).toHaveBeenCalledTimes(1)
    expect(world.launches).toHaveLength(1)
    expect(world.handles.get('writer')).toBe(handle)
    expect(approved(id)).toMatchObject([{ ending: 'approved' }])
    expect(world.store.externalMcpServersFor('writer')).toHaveLength(1)
    expect(notice()).not.toContain('This conversation was reopened')
    closing.mockRestore()
    await host.send(asker, 'Finish fictional work before the reopen.', world.window)
    await expect.poll(() => world.launches.length).toBe(2)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
    expect(world.launches.at(-1)?.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
    expect(approved(id)).toHaveLength(1)
  })
})
