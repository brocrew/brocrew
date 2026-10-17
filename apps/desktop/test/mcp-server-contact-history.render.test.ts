import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import McpServerRequests from '../src/renderer/src/components/McpServerRequests.vue'
import { usePersonsQueue } from '../src/renderer/src/lib/persons-queue'
import { mcpRequestWorld, type McpRequestWorld } from './helpers/mcp-server-request-world'

const NOT_CONTACTED = 'BroCrew has not contacted this address yet.'

describe('an MCP request does not claim an unproved contact history', () => {
  let world: McpRequestWorld
  let host: RuntimeHost
  let asker: string
  beforeEach(async () => {
    usePersonsQueue().forget()
    world = mcpRequestWorld()
    host = world.host()
    asker = await world.open(host)
  })
  afterEach(async () => {
    usePersonsQueue().forget()
    await world.cleanup()
  })

  async function ask(url: string, name = 'agent-notes') {
    const tool = agentToolsFor(host, asker).tools.find((one) => one.name === 'request_mcp_server')!
    const answer = await tool.call({
      name,
      url,
      reaches: 'Read fictional notes.',
      who_gets_it: 'everyone',
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
  const add = (url: string) =>
    executeRuntimeCommand(host, world.window, {
      kind: 'registerExternalMcpServer',
      name: 'person-notes',
      url,
      reach: 'restricted',
    })

  async function card(requestId: string) {
    const rows = host
      .mcpServerRequestsForAPerson()
      .filter((one) => one.requested.requestId === requestId)
    expect(rows).toHaveLength(1)
    usePersonsQueue().supply(
      { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
      { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
      {
        held: new Set(),
        answerable: new Map(),
        answeredFromHere: new Set(),
        now: 1000,
        lastLookAnswered: { questions: true, decisions: true },
      },
      { travel() {}, settle() {}, takeOver() {}, open() {} },
      undefined,
      undefined,
      undefined,
      undefined,
      { walked: rows, lastLookAnswered: true, nameOf: (name) => name },
    )
    const markup = await renderToString(createSSRApp(McpServerRequests))
    expect(markup).toContain('Read fictional notes.')
    return markup
  }

  it('a fresh request makes zero connections and its card omits the contact claim', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    expect(await card(id)).not.toContain(NOT_CONTACTED)
    expect(server.connections).toBe(0)
    expect(world.store.externalMcpServers()).toEqual([])
  })

  it('a failed approval cannot make another name at the same address claim no contact', async () => {
    const server = await world.server([], true)
    const first = await ask(server.url, 'first-notes')
    const second = await ask(`${server.url}#second`, 'second-notes')
    expect(await card(second)).not.toContain(NOT_CONTACTED)
    expect(await approve(first)).toMatchObject({ outcome: 'refused', stillOpen: true })
    expect(server.connections).toBeGreaterThan(0)
    expect(await card(second)).not.toContain(NOT_CONTACTED)
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(2)
    expect(world.store.externalMcpServers()).toEqual([])
  })

  it('a held Add cannot make a waiting card claim no contact before it answers', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const gate = world.gate()
    server.holdUntil(gate.promise, 1)
    const registration = add(`${server.url}#from-add`)
    void registration.catch(() => undefined)
    await expect.poll(() => server.requests).toBe(1)
    expect(world.store.externalMcpServers()).toEqual([])
    expect(await card(id)).not.toContain(NOT_CONTACTED)
    gate.release()
    await registration
  })

  it('a failed Add leaves the request open without claiming it never contacted the address', async () => {
    const server = await world.server([], true)
    const id = await ask(server.url)
    await expect(add(`${server.url}#from-add`)).rejects.toThrow()
    expect(server.connections).toBeGreaterThan(0)
    expect(await card(id)).not.toContain(NOT_CONTACTED)
    expect(world.store.externalMcpServers()).toEqual([])
  })

  it('a request made after an earlier failed Add does not acquire a no-contact claim', async () => {
    const server = await world.server([], true)
    await expect(add(server.url)).rejects.toThrow()
    const id = await ask(`${server.url}#asked-later`)
    expect(server.connections).toBeGreaterThan(0)
    expect(await card(id)).not.toContain(NOT_CONTACTED)
    expect(world.store.externalMcpServers()).toEqual([])
  })

  it('a request made during an earlier held Add does not acquire a no-contact claim', async () => {
    const server = await world.server()
    const gate = world.gate()
    server.holdUntil(gate.promise, 1)
    const registration = add(server.url)
    void registration.catch(() => undefined)
    await expect.poll(() => server.requests).toBe(1)
    const id = await ask(`${server.url}#asked-later`)
    expect(await card(id)).not.toContain(NOT_CONTACTED)
    gate.release()
    await registration
  })

  it('a restart makes contact history unknown and never invents the no-contact sentence', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    expect(await card(id)).not.toContain(NOT_CONTACTED)
    host = await world.restart()
    expect(await card(id)).not.toContain(NOT_CONTACTED)
    expect(server.connections).toBe(0)
    expect(world.store.externalMcpServers()).toEqual([])
  })
})
