import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { ExternalMcpServerRow } from '../src/shared/external-mcp'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { mcpRequestWorld, type McpRequestWorld } from './helpers/mcp-server-request-world'

describe('a late discovery failure describes the request’s current ending', () => {
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
  const endings = (requestId: string) =>
    world
      .ledger(asker)
      .filter((one) => one.type === 'mcp_server_request_settled' && one.requestId === requestId)

  it('Add superseding a held approval remains ended when that discovery later fails', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const gate = world.gate()
    server.holdUntil(gate.promise, 1)
    server.failHeldReplies()
    const approval = approve(id)
    void approval.catch(() => undefined)
    await expect.poll(() => server.requests).toBe(1)
    const added = await executeRuntimeCommand(host, world.window, {
      kind: 'registerExternalMcpServer',
      name: 'fictional-notes',
      url: server.url,
      reach: 'restricted',
    })
    expect(endings(id)).toMatchObject([{ ending: 'superseded' }])
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
    expect(world.store.externalMcpServers()).toEqual([added])
    gate.release()
    expect(await approval).toEqual({
      outcome: 'refused',
      reason: 'somebody answered that request first',
      stillOpen: false,
    })
    expect(world.store.externalMcpServers()).toEqual([added])
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    expect(endings(id)).toHaveLength(1)
    await expect
      .poll(() => world.sent.map((one) => one.text).join(''))
      .toContain(`request ${id} was taken down`)
    expect(world.sent.map((one) => one.text).join('')).not.toContain('Nothing was registered')
  })

  it('an unchanged unreachable request stays open with no registration or grants', async () => {
    const server = await world.server([], true)
    const id = await ask(server.url)
    expect(await approve(id)).toMatchObject({ outcome: 'refused', stillOpen: true })
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    expect(world.store.externalMcpServers()).toEqual([])
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    expect(endings(id)).toEqual([])
    expect(world.sent).toEqual([])
  })

  it.each([false, true])(
    'a starting asker with Add completed before failure, then removed=%s, gets the current answer',
    async (removed) => {
      const server = await world.server()
      const id = await ask(server.url)
      const discovery = world.gate()
      server.holdUntil(discovery.promise, 1)
      server.failHeldReplies()
      const approval = approve(id)
      void approval.catch(() => undefined)
      await expect.poll(() => server.requests).toBe(1)
      await host.close(asker, world.window)
      const arrival = world.gate()
      world.startWait = arrival.promise
      const start = host.resumeSession(asker, world.window)
      void start.catch(() => undefined)
      await expect.poll(() => world.launches.length).toBe(2)
      const added = await executeRuntimeCommand(host, world.window, {
        kind: 'registerExternalMcpServer',
        name: 'fictional-notes',
        url: server.url,
        reach: 'restricted',
      })
      expect(world.store.externalMcpServers()).toEqual([added])
      expect(world.store.mcpServerRequestsWaiting().map((one) => one.requested.requestId)).toEqual([
        id,
      ])
      expect(endings(id)).toEqual([])
      if (removed)
        await executeRuntimeCommand(host, world.window, {
          kind: 'removeExternalMcpServer',
          serverId: (added as ExternalMcpServerRow).id,
        })
      discovery.release()
      if (removed) {
        expect(await approval).toMatchObject({
          outcome: 'refused',
          stillOpen: true,
          reason: `The server at ${server.url} refused the MCP check (HTTP 503). Nothing was registered.`,
        })
        expect(world.store.externalMcpServers()).toEqual([])
      } else {
        expect(await approval).toEqual({
          outcome: 'refused',
          stillOpen: true,
          reason:
            'the conversation that asked is starting right now, so nothing was decided. Press it again in a moment.',
        })
        expect(world.store.externalMcpServers()).toEqual([added])
      }
      expect(world.store.externalMcpServersFor('writer')).toEqual([])
      expect(endings(id)).toEqual([])
      expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
      world.startWait = null
      arrival.release()
      await start
      if (removed) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(endings(id)).toEqual([])
        expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
      } else await expect.poll(() => endings(id)).toMatchObject([{ ending: 'superseded' }])
    },
  )

  it('no helper yield lets a same-host Add overtake the final free-name failure answer during a start', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const discovery = world.gate()
    server.holdUntil(discovery.promise, 1)
    server.failHeldReplies()
    // Hold only the return of a real HTTP discovery, so Add is ready to commit in one continuation.
    const seam = host as unknown as {
      whatAServerOffers(name: string, url: string): Promise<readonly string[]>
      itsNameIsRegistered(name: string): boolean
      mcpServerRequestsBeingDecided: Set<string>
      slots: Map<string, { phase: string }>
    }
    const offers = seam.whatAServerOffers.bind(host)
    let calls = 0
    let releaseFailure: (() => void) | undefined
    let releaseAdd: (() => void) | undefined
    let armed = false
    let freeNameCuts = 0
    let failure = ''
    const order: string[] = []
    const decisionSnapshots: { registered: boolean; waiting: boolean; starting: boolean }[] = []
    const answerSnapshots: { registered: boolean; waiting: boolean }[] = []
    vi.spyOn(seam, 'whatAServerOffers').mockImplementation((name, url) => {
      const first = ++calls === 1
      return new Promise((resolve, reject) => {
        void offers(name, url).then(
          (tools) => {
            releaseAdd = () => resolve(tools)
          },
          (error: Error) => {
            expect(first).toBe(true)
            const message = error.message
            failure = message
            Object.defineProperty(error, 'message', {
              get() {
                if (armed)
                  answerSnapshots.push({
                    registered: world.store.externalMcpServers().some((one) => one.name === name),
                    waiting: world.store
                      .mcpServerRequestsWaiting()
                      .some((one) => one.requested.requestId === id),
                  })
                return message
              },
            })
            releaseFailure = () => reject(error)
          },
        )
      })
    })
    const approval = approve(id)
    void approval.catch(() => undefined)
    await expect.poll(() => server.requests).toBe(1)
    const add = executeRuntimeCommand(host, world.window, {
      kind: 'registerExternalMcpServer',
      name: 'fictional-notes',
      url: server.url,
      reach: 'restricted',
    })
    void add.catch(() => undefined)
    await expect.poll(() => releaseAdd !== undefined).toBe(true)
    expect(world.store.externalMcpServers()).toEqual([])
    expect(world.store.mcpServerRequestsWaiting().map((one) => one.requested.requestId)).toEqual([
      id,
    ])
    await host.close(asker, world.window)
    const arrival = world.gate()
    world.startWait = arrival.promise
    const start = host.resumeSession(asker, world.window)
    void start.catch(() => undefined)
    await expect.poll(() => world.launches.length).toBe(2)
    discovery.release()
    await expect.poll(() => releaseFailure !== undefined).toBe(true)
    expect(world.handles.get('writer')?.status()).toBe('ended')
    expect(seam.slots.get(asker)?.phase).toBe('starting')
    const insert = world.store.registerExternalMcpServer.bind(world.store)
    const registrations: ReturnType<typeof insert>[] = []
    vi.spyOn(world.store, 'registerExternalMcpServer').mockImplementation((input) => {
      const row = insert(input)
      registrations.push(row)
      order.push('Add inserted')
      return row
    })
    const unmark = seam.mcpServerRequestsBeingDecided.delete.bind(
      seam.mcpServerRequestsBeingDecided,
    )
    vi.spyOn(seam.mcpServerRequestsBeingDecided, 'delete').mockImplementation((requestId) => {
      if (armed && requestId === id) {
        order.push('decision formed')
        decisionSnapshots.push({
          registered: world.store
            .externalMcpServers()
            .some((one) => one.name === 'fictional-notes'),
          waiting: world.store
            .mcpServerRequestsWaiting()
            .some((one) => one.requested.requestId === id),
          starting: seam.slots.get(asker)?.phase === 'starting',
        })
      }
      return unmark(requestId)
    })
    const nameIsRegistered = seam.itsNameIsRegistered.bind(host)
    vi.spyOn(seam, 'itsNameIsRegistered').mockImplementation((name) => {
      const registered = nameIsRegistered(name)
      if (armed && !registered && freeNameCuts === 0) {
        freeNameCuts++
        order.push('name read free')
        releaseAdd!()
      }
      return registered
    })
    armed = true
    releaseFailure!()
    expect(await approval).toEqual({
      outcome: 'refused',
      stillOpen: true,
      reason: failure,
    })
    expect(freeNameCuts).toBe(1)
    expect(decisionSnapshots).toEqual([{ registered: false, waiting: true, starting: true }])
    // At the exact construction of that failure sentence the name must still be free.
    expect(answerSnapshots.length).toBeGreaterThan(0)
    expect(answerSnapshots).toEqual(
      answerSnapshots.map(() => ({ registered: false, waiting: true })),
    )
    const added = await add
    expect(order).toEqual(['name read free', 'decision formed', 'Add inserted'])
    expect(registrations).toEqual([added])
    expect(world.store.externalMcpServers()).toEqual([added])
    expect(endings(id)).toEqual([])
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    world.startWait = null
    arrival.release()
    await start
    await expect.poll(() => endings(id)).toMatchObject([{ ending: 'superseded' }])
  })
})
