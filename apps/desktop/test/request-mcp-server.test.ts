import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  McpRequestSink,
  mcpRequestWorld,
  type McpRequestWorld,
} from './helpers/mcp-server-request-world'

const REACHES = 'Read fictional notes and search their titles.'

// Exercise the real tool, command, ledger and provider options without a provider process.
describe('the person decides an agent’s MCP server request', () => {
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

  const call = async (args: Record<string, unknown>, session = asker) => {
    const tool = agentToolsFor(host, session).tools.find((one) => one.name === 'request_mcp_server')
    if (!tool) throw new Error('the request tool is missing')
    const before = world.ledger(session).filter((one) => one.type === 'tool_refused').length
    const result = await tool.call(args)
    expect(Object.keys(result).sort()).toEqual(['structured', 'text'])
    if (result.structured?.outcome === 'refused') {
      const facts = result.structured
      const rail = facts.rail as string
      const permanence = ['server-already-asked-for', 'too-many-server-requests'].includes(rail)
        ? 'until-a-person-changes-it'
        : 'permanent'
      expect(facts).toMatchObject({
        outcome: 'refused',
        permanence,
        retryable: false,
        remedy: null,
      })
      expect(Object.keys(facts).sort()).toEqual([
        'detail',
        'outcome',
        'permanence',
        'rail',
        'reason',
        'remedy',
        'retryable',
      ])
      expect(result.text.startsWith(`refused (${rail}): `)).toBe(true)
      const rows = world
        .ledger(session)
        .filter((one) => one.type === 'tool_refused')
        .slice(before)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        type: 'tool_refused',
        tool: 'request_mcp_server',
        rail,
        permanence,
        retryable: false,
        remedy: null,
      })
      expect(JSON.stringify(rows)).not.toContain(REACHES)
    }
    return result
  }
  const args = (url: string, name = 'fictional-notes') => ({
    name,
    url,
    reaches: REACHES,
    who_gets_it: 'everyone',
  })
  const ask = async (url: string, more: Record<string, unknown> = {}, session = asker) => {
    const result = await call({ ...args(url), ...more }, session)
    const data = result.structured as { outcome: string; request: string }
    expect(data.outcome).toBe('ok')
    await expect
      .poll(() =>
        world.store
          .mcpServerRequestsWaiting()
          .some((one) => one.requested.requestId === data.request),
      )
      .toBe(true)
    return data.request
  }
  const decide = (requestId: string, approve = true, sink = world.window) =>
    executeRuntimeCommand(host, sink, { kind: 'decideMcpServerRequest', requestId, approve })
  const ending = (id: string) =>
    world
      .ledger(asker)
      .find((event) => event.type === 'mcp_server_request_settled' && event.requestId === id)
  const notice = () =>
    world.sent
      .filter((one) => one.profile === 'writer')
      .map((one) => one.text)
      .join('\n')
  const noRegistration = () => expect(world.store.externalMcpServers()).toEqual([])

  it('asks without a connection or a server row, and preserves what the person will approve', async () => {
    const server = await world.server()
    const before = world.ledger(asker).length
    const id = await ask(server.url)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(server.connections).toBe(0)
    expect(server.requests).toBe(0)
    noRegistration()
    const requests = world
      .ledger(asker)
      .slice(before)
      .filter((event) => event.type === 'mcp_server_requested')
    expect(requests).toEqual([
      {
        type: 'mcp_server_requested',
        requestId: id,
        name: 'fictional-notes',
        url: server.url,
        reaches: REACHES,
        whoGetsIt: 'everyone',
        requestedBy: 'writer',
      },
    ])
  })

  it('refuses a channel with no person and changes no row or connection', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await expect(decide(id, true, new McpRequestSink('fixture-agent', false))).rejects.toThrow(
      'decideMcpServerRequest changes what agents are allowed to do, so it is refused unless a person is asking',
    )
    expect(server.connections).toBe(0)
    noRegistration()
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    expect(ending(id)).toBeUndefined()
  })

  it('refuses approval during quit before touching the server', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await host.closeAll()
    await expect(decide(id)).rejects.toThrow(
      'BroCrew is shutting down, so decideMcpServerRequest was not asked of its database',
    )
    expect(server.connections).toBe(0)
    noRegistration()
    expect(ending(id)).toBeUndefined()
  })

  it('refuses a forged URL at the public command boundary', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await expect(
      executeRuntimeCommand(host, world.window, {
        kind: 'decideMcpServerRequest',
        requestId: id,
        approve: true,
        url: 'http://127.0.0.1:8765/forged',
      }),
    ).rejects.toThrow('invalid runtime command:')
    expect(server.connections).toBe(0)
    noRegistration()
    expect(ending(id)).toBeUndefined()
  })

  it('reports all missing fields together without writing a request', async () => {
    const result = await call({})
    expect(result.structured).toMatchObject({
      rail: 'malformed-request',
      detail: {
        problems: [
          'name is required: a short name for the server',
          'url is required: the server’s full address',
          'reaches is required: what the server can read and do, at most 1280 characters',
          'who_gets_it is required and takes everyone or only-these-agents',
        ],
      },
    })
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
    noRegistration()
  })

  it.each([
    [
      'empty reaches',
      { reaches: ' ' },
      'reaches is required: what the server can read and do, at most 1280 characters',
    ],
    [
      'long reaches',
      { reaches: 'x'.repeat(1281) },
      'reaches is required: what the server can read and do, at most 1280 characters',
    ],
    [
      'unknown reach',
      { who_gets_it: 'somebody' },
      'who_gets_it is required and takes everyone or only-these-agents',
    ],
    [
      'agents on everyone',
      { agents: ['writer'] },
      'agents goes only with only-these-agents: everyone already means every agent',
    ],
    [
      'missing agents',
      { who_gets_it: 'only-these-agents' },
      'agents is required with only-these-agents: 1 to 32 agents, as list_profiles names them',
    ],
    [
      'empty agents',
      { who_gets_it: 'only-these-agents', agents: [] },
      'agents is required with only-these-agents: 1 to 32 agents, as list_profiles names them',
    ],
    [
      'too many agents',
      { who_gets_it: 'only-these-agents', agents: Array(33).fill('writer') },
      'agents is required with only-these-agents: 1 to 32 agents, as list_profiles names them',
    ],
    [
      'invalid agent',
      { who_gets_it: 'only-these-agents', agents: ['not/a/profile'] },
      'agents is required with only-these-agents: 1 to 32 agents, as list_profiles names them',
    ],
    ['empty piece', { piece: '' }, 'piece must name a piece of work you hold, or be left out'],
    [
      'long URL',
      { url: `http://127.0.0.1/${'x'.repeat(2048)}` },
      'url must be at most 2048 characters',
    ],
  ])('refuses %s with its exact problem and no effect', async (_name, changed, problem) => {
    const server = await world.server()
    const result = await call({ ...args(server.url), ...changed })
    expect(result.structured).toMatchObject({
      rail: 'malformed-request',
      detail: { problems: [problem] },
    })
    expect(result.text).toContain(problem)
    expect(server.connections).toBe(0)
    noRegistration()
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
  })

  it.each([
    [
      { name: 'brobot' },
      '“brobot” is the name BroCrew publishes its own tools under, so it is reserved. Give this server another name.',
    ],
    [
      { name: 'bad__name' },
      '“bad__name” contains “__”, which is how both providers separate a server from its tools — a server named this way is read as a different server with a longer tool name. Use letters, digits, dot, dash or underscore (max 64), and never two underscores together.',
    ],
    [
      { name: '../notes' },
      '“../notes” is not a usable server name — use letters, digits, dot, dash or underscore (max 64), and never two underscores together.',
    ],
    [
      { url: 'https://fictional.example/mcp' },
      '“https://fictional.example/mcp” is not on this machine. BroCrew can only register an unauthenticated server running locally — localhost, 127.0.0.1 or [::1].',
    ],
    [
      { url: 'http://person:fictional@localhost/mcp' },
      '“http://person:fictional@localhost/mcp” carries a username or password in the address. BroCrew stores no credential for an external server yet, so a URL that contains one is refused rather than saved.',
    ],
    [
      { url: 'file:///fictional/mcp' },
      '“file:///fictional/mcp” is not an http address. An MCP server is reached over http or https.',
    ],
  ])('refuses invalid name or URL %j with independent exact words', async (changed, problem) => {
    const result = await call({ ...args('http://127.0.0.1:8765/mcp'), ...changed })
    expect(result.structured).toMatchObject({
      rail: 'malformed-request',
      detail: { problems: [problem] },
    })
    expect(result.text).toContain(problem)
    noRegistration()
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
  })

  it('reports every bad field together rather than stopping after the first', async () => {
    const result = await call({
      name: 'brobot',
      url: 'file:///fictional/mcp',
      reaches: '',
      who_gets_it: 'everyone',
      agents: ['writer'],
      piece: '',
    })
    expect(result.structured).toMatchObject({
      rail: 'malformed-request',
      detail: {
        problems: [
          '“brobot” is the name BroCrew publishes its own tools under, so it is reserved. Give this server another name.',
          '“file:///fictional/mcp” is not an http address. An MCP server is reached over http or https.',
          'reaches is required: what the server can read and do, at most 1280 characters',
          'agents goes only with only-these-agents: everyone already means every agent',
          'piece must name a piece of work you hold, or be left out',
        ],
      },
    })
    noRegistration()
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
  })

  it('accepts the boundary name, URL and reach lengths and an owned piece', async () => {
    const prefix = 'http://127.0.0.1:8765/'
    const url = prefix + 'x'.repeat(2048 - prefix.length)
    const owned = world.store.rootOf(asker)
    expect(owned).toMatchObject({ owner: asker })
    if (owned === null) throw new Error('the running conversation has no root work')
    const id = await ask(url, {
      name: 'n'.repeat(64),
      reaches: 'r'.repeat(1280),
      piece: owned.label,
    })
    expect(world.store.mcpServerRequestsWaiting()[0]?.requested).toMatchObject({
      requestId: id,
      name: 'n'.repeat(64),
      url,
      reaches: 'r'.repeat(1280),
      piece: owned.piece,
      label: owned.label,
    })
    noRegistration()
  })

  it('reports all unknown agents and rejects a piece the asker does not hold', async () => {
    const unknown = await call({
      ...args('http://127.0.0.1:8765/mcp'),
      who_gets_it: 'only-these-agents',
      agents: ['missing-a', 'missing-b'],
    })
    expect(unknown.structured).toMatchObject({
      rail: 'no-agent-by-that-name',
      detail: { agents: ['missing-a', 'missing-b'] },
    })
    expect(unknown.text).toContain(
      'name each agent as list_profiles gives it: no agent has the profile “missing-a”, “missing-b”, so nothing was asked.',
    )
    const piece = await call({ ...args('http://127.0.0.1:8765/mcp'), piece: 'W999.999' })
    expect(piece.structured).toMatchObject({
      rail: 'malformed-request',
      detail: { problems: ['piece names no piece of work you hold: W999.999'] },
    })
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
  })

  it('refuses both a registered name and its address under a second name', async () => {
    const server = await world.server()
    await host.registerExternalMcpServer({
      name: 'fictional-notes',
      url: server.url,
      reach: 'restricted',
    })
    const connections = server.connections
    const named = await call(args(server.url))
    expect(named.structured).toMatchObject({
      rail: 'server-already-registered',
      detail: { name: 'fictional-notes' },
    })
    expect(named.text).toContain(
      'ask the person with ask_question (a-person) to grant “fictional-notes” to your profile if you need it and do not have it: a server called “fictional-notes” is already registered, and a request cannot change a registered server, so nothing was asked.',
    )
    const address = await call(args(server.url, 'different-name'))
    expect(address.structured).toMatchObject({
      rail: 'server-already-registered',
      detail: { name: 'fictional-notes', address: server.url },
    })
    expect(address.text).toContain(
      `the server at ${server.url} is already registered, as “fictional-notes”`,
    )
    expect(server.connections).toBe(connections)
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
  })

  it('refuses duplicate requests with distinct own and other-conversation words', async () => {
    const url = 'http://127.0.0.1:8765/mcp'
    const id = await ask(url)
    const own = await call(args(url))
    expect(own.structured).toMatchObject({
      rail: 'server-already-asked-for',
      detail: { request: id, yours: true },
    })
    expect(own.text).toContain(
      `wait for the person to decide request ${id}, which you made: it is the request already waiting on them to register “fictional-notes”, so nothing new was asked. You will be told when they decide.`,
    )
    const other = await world.open(host, 'editor')
    const theirs = await call(args(url), other)
    expect(theirs.structured).toMatchObject({
      rail: 'server-already-asked-for',
      detail: { request: id, yours: false },
    })
    expect(theirs.text).toContain(
      `wait for the person to decide request ${id}, which another conversation made: it is the request already waiting on them to register “fictional-notes”, so nothing new was asked. If they approve it and you do not get it, ask them with ask_question (a-person) to grant it to your profile.`,
    )
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
  })

  it('admits three from one conversation then refuses the fourth, and releases room when decided', async () => {
    const ids: string[] = []
    for (let n = 0; n < 3; n++)
      ids.push(await ask(`http://127.0.0.1:8765/${n}`, { name: `notes-${n}` }))
    const denied = await call(args('http://127.0.0.1:8765/more', 'more-notes'))
    expect(denied.structured).toMatchObject({
      rail: 'too-many-server-requests',
      detail: { waiting: 3, from: 'this-conversation' },
    })
    expect(denied.text).toContain(
      'wait until one is decided: 3 server requests from this conversation are already waiting on the person, so nothing was asked.',
    )
    await decide(ids[0]!, false)
    await ask('http://127.0.0.1:8765/more', { name: 'more-notes' })
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(3)
    noRegistration()
  })

  it('admits twenty globally then refuses one from a conversation below its own cap', async () => {
    for (let n = 0; n < 20; n++) {
      const session = n < 3 ? asker : await world.open(host, `writer-${n}`)
      await ask(`http://127.0.0.1:8765/${n}`, { name: `notes-${n}` }, session)
    }
    const fresh = await world.open(host, 'fresh-writer')
    const denied = await call(args('http://127.0.0.1:8765/more', 'more-notes'), fresh)
    expect(denied.structured).toMatchObject({
      rail: 'too-many-server-requests',
      detail: { waiting: 20, from: 'every-conversation' },
    })
    expect(denied.text).toContain(
      'wait until some are decided, then ask again: 20 server requests from agents are already waiting on the person, so nothing was asked.',
    )
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(20)
    noRegistration()
  })

  it.each(['everyone', 'only-these-agents'] as const)(
    'approval preserves %s, adds only requested grants, settles and notifies',
    async (who) => {
      const server = await world.server()
      await world.open(host, 'editor')
      const id = await ask(
        server.url,
        who === 'everyone' ? {} : { who_gets_it: who, agents: ['writer', 'editor'] },
      )
      expect(await decide(id)).toMatchObject({
        outcome: 'taken',
        reason: 'Registered. It offers: read_notes.',
      })
      await expect
        .poll(() => ending(id))
        .toMatchObject({ ending: 'approved', offered: ['read_notes'], by: { who: 'a-person' } })
      expect(server.connections).toBeGreaterThan(0)
      expect(world.store.externalMcpServers()).toMatchObject([
        {
          name: 'fictional-notes',
          url: server.url,
          reach: who === 'everyone' ? 'everyone' : 'restricted',
        },
      ])
      expect(world.store.externalMcpServersFor('writer').map((one) => one.name)).toEqual([
        'fictional-notes',
      ])
      if (who === 'only-these-agents') {
        expect(world.store.externalMcpServersFor('editor').map((one) => one.name)).toEqual([
          'fictional-notes',
        ])
        expect(world.store.externalMcpServersFor('stranger')).toEqual([])
      }
      await expect.poll(notice).toContain(`The person approved request ${id}`)
    },
  )

  it('approval adds grants without removing a profile’s existing server', async () => {
    const old = await world.server(['read_old_notes'])
    await host.registerExternalMcpServer({ name: 'older-notes', url: old.url, reach: 'restricted' })
    expect(world.store.grantExternalMcpServer('older-notes', ['writer'])).not.toBeNull()
    const server = await world.server()
    const id = await ask(server.url, { who_gets_it: 'only-these-agents', agents: ['writer'] })
    await decide(id)
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
    expect(
      world.store
        .externalMcpServersFor('writer')
        .map((one) => one.name)
        .sort(),
    ).toEqual(['fictional-notes', 'older-notes'])
  })

  it('an unknown request id changes no ledger or server', async () => {
    const before = world.ledger(asker)
    expect(await decide('missing-fictional-request')).toEqual({
      outcome: 'refused',
      reason: 'there is no request waiting by that name, so nothing was registered',
      stillOpen: false,
    })
    expect(world.ledger(asker)).toEqual(before)
    noRegistration()
    expect(world.sent).toEqual([])
  })

  it('refusal registers and reopens nothing, then delivers the exact notice', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const launches = world.launches.length
    expect(await decide(id, false)).toEqual({
      outcome: 'taken',
      reason: 'Refused. Nothing was registered.',
    })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'refused' })
    await expect
      .poll(notice)
      .toContain(
        `The person refused request ${id} to register “fictional-notes” at ${server.url}. Nothing was registered. Do not ask for it again unless the person asks you to.`,
      )
    expect(world.launches).toHaveLength(launches)
    expect(server.connections).toBe(0)
    noRegistration()
  })

  it('an HTTP-refused MCP server leaves the request open and adds no row or grant', async () => {
    const server = await world.server([], true)
    const id = await ask(server.url)
    const ack = await decide(id)
    expect(ack).toMatchObject({ outcome: 'refused', stillOpen: true })
    expect((ack as { reason: string }).reason).toBe(
      `The server at ${server.url} refused the MCP check (HTTP 503). Nothing was registered.`,
    )
    expect(JSON.stringify(ack)).not.toContain('fictional server unavailable')
    noRegistration()
    expect(ending(id)).toBeUndefined()
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    expect(Object.keys(host.mcpServerRequestsForAPerson()[0]!).sort()).toEqual([
      'askerCalled',
      'at',
      'conversation',
      'requested',
    ])
  })

  it('a tool-name collision settles could-not-register with no registry row', async () => {
    const server = await world.server(['list_tasks'])
    const id = await ask(server.url)
    const ack = await decide(id)
    expect(ack).toEqual({
      outcome: 'refused',
      stillOpen: false,
      reason:
        'Could not register: “fictional-notes” publishes a tool BroCrew already governs — list_tasks. An agent cannot tell one of those apart from BroCrew’s own, so the whole server is refused rather than part of it. Rename it on the server, or register a server that does not publish that name.',
    })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'could-not-register' })
    noRegistration()
    await expect.poll(notice).toContain('Nothing was registered.')
  })

  it('a concurrent second press cannot reach preflight while the first is pending', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const gate = world.gate()
    server.holdUntil(gate.promise)
    const first = decide(id)
    await expect.poll(() => server.requests).toBe(1)
    expect(await decide(id)).toEqual({
      outcome: 'refused',
      reason: 'that request is being decided right now, so this press did nothing',
      stillOpen: true,
    })
    expect(server.requests).toBe(1)
    noRegistration()
    expect(ending(id)).toBeUndefined()
    gate.release()
    expect(await first).toMatchObject({ outcome: 'taken' })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
    expect(world.store.externalMcpServers()).toHaveLength(1)
  })

  it('two hosts cannot record two decisions or two servers for the same request', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const other = world.host()
    const [left, right] = await Promise.all([
      decide(id),
      executeRuntimeCommand(other, world.window, {
        kind: 'decideMcpServerRequest',
        requestId: id,
        approve: true,
      }),
    ])
    expect(
      [left, right].filter((one) => (one as { outcome: string }).outcome === 'taken'),
    ).toHaveLength(1)
    expect([left, right].find((one) => (one as { outcome: string }).outcome === 'refused')).toEqual(
      { outcome: 'refused', reason: 'somebody answered that request first', stillOpen: false },
    )
    await expect
      .poll(
        () =>
          world.ledger(asker).filter((event) => event.type === 'mcp_server_request_settled').length,
      )
      .toBe(1)
    expect(world.store.externalMcpServers()).toHaveLength(1)
  })

  it('a second press says answered first and cannot repeat registration', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await decide(id, false)
    expect(await decide(id, false)).toEqual({
      outcome: 'refused',
      reason: 'somebody answered that request first',
      stillOpen: false,
    })
    expect(server.connections).toBe(0)
    noRegistration()
    expect(
      world.ledger(asker).filter((event) => event.type === 'mcp_server_request_settled'),
    ).toHaveLength(1)
  })

  it('registering through Add supersedes an open request and tells its asker', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await executeRuntimeCommand(host, world.window, {
      kind: 'registerExternalMcpServer',
      name: 'fictional-notes',
      url: server.url,
      reach: 'everyone',
    })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'superseded' })
    await expect
      .poll(notice)
      .toContain(
        `The person registered a server called “fictional-notes” themselves, so request ${id} was taken down.`,
      )
    expect(world.store.externalMcpServers()).toHaveLength(1)
  })

  it('an undecided request survives a closed database and real migrations on restart', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const asked = world.store.mcpServerRequestsWaiting()[0]?.requested
    host = await world.restart()
    expect(world.store.mcpServerRequestsWaiting()).toMatchObject([
      { conversation: asker, requested: asked },
    ])
    expect(server.connections).toBe(0)
    noRegistration()
    await decide(id, false)
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
  })

  it('an idle asker resumes with the server and receives the notice before other held words', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const original = world.handles.get('writer')!.ref.sessionId
    await decide(id)
    await expect.poll(() => world.launches.filter((one) => one.profile === 'writer').length).toBe(2)
    const resumed = world.launches.filter((one) => one.profile === 'writer')[1]!
    expect(resumed.kind).toBe('resume')
    expect(resumed.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
    expect(world.handles.get('writer')!.ref.sessionId).toBe(original)
    await expect.poll(() => world.sent[0]?.text).toContain(`The person approved request ${id}`)
    expect(world.sent[0]?.text).toContain('This conversation was reopened so its tools reach you.')
  })

  it('a turn finishes before the asker reopens, with no card needed to hold it', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const gate = world.gate()
    world.turnWait = gate.promise
    await host.send(asker, 'Fictional work already in progress.', world.window)
    await expect
      .poll(() => world.ledger(asker).some((event) => event.type === 'assistant_message'))
      .toBe(true)
    await expect.poll(() => world.handles.get('writer')!.status()).toBe('working')
    await decide(id)
    expect(world.launches).toHaveLength(1)
    expect(world.sent).toHaveLength(1)
    world.turnWait = null
    gate.release()
    await expect.poll(() => world.launches.length).toBe(2)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
  })

  it('an idle open card is answered before the asker reopens', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const handle = world.handles.get('writer')!
    const card = handle.simulateUserInput('Pick a fictional note', ['blue', 'green'])
    await expect
      .poll(() =>
        world
          .ledger(asker)
          .some((event) => event.type === 'user_input_request' && event.id === card.id),
      )
      .toBe(true)
    await decide(id)
    expect(world.launches).toHaveLength(1)
    expect(world.sent).toEqual([])
    await host.respondUserInput(
      asker,
      card.id,
      { kind: 'answer', answers: { q0: ['blue'] } },
      world.window,
    )
    expect(await card.answered).toEqual({ kind: 'answer', answers: { q0: ['blue'] } })
    await expect.poll(() => world.launches.length).toBe(2)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
  })

  it.each(['background', 'planning'] as const)(
    '%s is neither stopped nor held for the tools reopen',
    async (why) => {
      const server = await world.server()
      const id = await ask(server.url)
      const handle = world.handles.get('writer')!
      if (why === 'background') {
        handle.simulateBackgroundWork()
        await expect
          .poll(() =>
            world
              .ledger(asker)
              .some(
                (event) =>
                  event.type === 'background_work' &&
                  event.running !== undefined &&
                  event.running.length > 0,
              ),
          )
          .toBe(true)
      } else {
        await handle.setPlanMode(true)
        expect(handle.settings.planMode.requested).toBe(true)
      }
      await decide(id)
      await expect
        .poll(notice)
        .toContain(
          why === 'background'
            ? 'Not reopened: a reopen would stop the work this conversation runs in the background. The server’s tools reach it when it next starts or reopens.'
            : 'Not reopened: a reopen would end this conversation’s planning. The server’s tools reach it when it next starts or reopens.',
        )
      expect(world.launches).toHaveLength(1)
      expect(world.store.messagesWaitingIn(asker)).toEqual([])
      expect(world.handles.get('writer')).toBe(handle)
    },
  )

  it('a stopped asker holds the notice during its next start and receives the server', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await host.close(asker, world.window)
    const gate = world.gate()
    world.startWait = gate.promise
    await decide(id)
    await expect.poll(() => world.launches.length).toBe(2)
    expect(world.launches[1]!.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
    expect(world.store.messagesWaitingIn(asker).length).toBeGreaterThan(0)
    expect(world.sent).toEqual([])
    world.startWait = null
    gate.release()
    await expect.poll(notice).toContain(`The person approved request ${id}`)
  })

  it('restricted approval without the asker’s profile does not reopen it', async () => {
    const server = await world.server()
    await world.open(host, 'editor')
    const launches = world.launches.length
    const id = await ask(server.url, { who_gets_it: 'only-these-agents', agents: ['editor'] })
    await decide(id)
    await expect
      .poll(notice)
      .toContain(
        `The person approved request ${id}: “fictional-notes” is registered for editor. Your own profile is not among them, so nothing changed here.`,
      )
    expect(world.launches).toHaveLength(launches)
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    expect(world.store.externalMcpServersFor('editor')).toHaveLength(1)
  })
  it('a request whose append fails never claims it was put in front of the person', async () => {
    const server = await world.server()
    const append = world.store.append.bind(world.store)
    vi.spyOn(world.store, 'append').mockImplementation((...values) => {
      if (values[2].type === 'mcp_server_requested') throw new Error('fictional disk full')
      return append(...values)
    })
    await expect(call(args(server.url))).rejects.toThrow(
      'this conversation is no longer being recorded, so the request was not kept and nothing was asked',
    )
    await expect(call(args(server.url, 'second-notes'))).rejects.toThrow(
      'the request was not kept and nothing was asked',
    )
    expect(world.store.mcpServerRequestsWaiting()).toEqual([])
    expect(server.connections).toBe(0)
    noRegistration()
  })

  it('two waiting names for one address cannot widen the first restricted registration', async () => {
    const server = await world.server()
    const restricted = await ask(server.url, {
      name: 'private-notes',
      who_gets_it: 'only-these-agents',
      agents: ['writer'],
    })
    const broader = await ask(`${server.url}#fictional`, { name: 'broad-notes' })
    await decide(restricted)
    await expect.poll(() => ending(restricted)).toMatchObject({ ending: 'approved' })
    const before = world.store.externalMcpServers()
    expect(await decide(broader)).toMatchObject({
      outcome: 'refused',
      stillOpen: false,
      reason: `Could not register: a server at ${server.url}#fictional is already registered, as “private-notes”`,
    })
    await expect.poll(() => ending(broader)).toMatchObject({ ending: 'could-not-register' })
    expect(world.store.externalMcpServers()).toEqual(before)
    expect(world.store.externalMcpServersFor('writer').map((one) => one.name)).toEqual([
      'private-notes',
    ])
    expect(world.store.externalMcpServersFor('stranger')).toEqual([])
  })

  it('Add winning while preflight waits cannot leave a second name at the same address', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const gate = world.gate()
    server.holdUntil(gate.promise, 1)
    const approval = decide(id)
    await expect.poll(() => server.requests).toBe(1)
    await executeRuntimeCommand(host, world.window, {
      kind: 'registerExternalMcpServer',
      name: 'person-notes',
      url: server.url + '#fragment',
      reach: 'restricted',
    })
    const added = world.store.externalMcpServers()[0]!
    expect(added.name).toBe('person-notes')
    gate.release()
    expect(await approval).toMatchObject({ outcome: 'refused', stillOpen: false })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'could-not-register' })
    expect(world.store.externalMcpServers()).toEqual([added])
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
  })

  it.each(['grants', 'settlement'] as const)(
    'a failed %s write rolls back the whole approval and can be retried',
    async (fault) => {
      const old = await world.server(['old_notes'])
      await host.registerExternalMcpServer({ name: 'old-notes', url: old.url, reach: 'restricted' })
      world.store.grantExternalMcpServer('old-notes', ['writer'])
      const server = await world.server()
      const id = await ask(server.url, { who_gets_it: 'only-these-agents', agents: ['writer'] })
      await host.close(asker, world.window)
      const broken =
        fault === 'grants'
          ? vi.spyOn(world.store, 'grantExternalMcpServer').mockImplementationOnce(() => {
              throw new Error('fictional grants failure')
            })
          : vi.spyOn(world.store, 'append').mockImplementationOnce(() => {
              throw new Error('fictional settlement failure')
            })
      expect(await decide(id)).toMatchObject({
        outcome: 'refused',
        stillOpen: true,
        reason: `BroCrew could not record that decision, so nothing changed: fictional ${fault === 'grants' ? 'grants' : 'settlement'} failure. Press it again, or refuse it.`,
      })
      expect(world.store.externalMcpServers().map((one) => one.name)).toEqual(['old-notes'])
      expect(world.store.externalMcpServersFor('writer').map((one) => one.name)).toEqual([
        'old-notes',
      ])
      expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
      expect(ending(id)).toBeUndefined()
      expect(world.sent).toEqual([])
      broken.mockRestore()
      expect(await decide(id)).toMatchObject({ outcome: 'taken' })
      await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
      expect(
        world.store
          .externalMcpServersFor('writer')
          .map((one) => one.name)
          .sort(),
      ).toEqual(['fictional-notes', 'old-notes'])
    },
  )

  it('a live settlement append failure never claims an approved row was committed', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const append = world.store.append.bind(world.store)
    vi.spyOn(world.store, 'append').mockImplementation((...values) => {
      if (values[2].type === 'mcp_server_request_settled')
        throw new Error('fictional settlement failure')
      return append(...values)
    })
    expect(await decide(id)).toMatchObject({ outcome: 'refused', stillOpen: true })
    expect(ending(id)).toBeUndefined()
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    noRegistration()
    expect(notice()).not.toContain('The person approved')
  })

  it.each([true, false])(
    'a server registered through Add makes a later %s press supersede without changing grants',
    async (approve) => {
      const server = await world.server()
      const id = await ask(server.url, { who_gets_it: 'only-these-agents', agents: ['writer'] })
      const reader = vi.spyOn(world.store, 'mcpServerRequestsWaiting')
      const insert = world.store.registerExternalMcpServer.bind(world.store)
      vi.spyOn(world.store, 'registerExternalMcpServer').mockImplementationOnce((said) => {
        const row = insert(said)
        reader.mockImplementationOnce(() => {
          throw new Error('fictional Add request-list failure')
        })
        return row
      })
      const added = await executeRuntimeCommand(host, world.window, {
        kind: 'registerExternalMcpServer',
        name: 'fictional-notes',
        url: server.url,
        reach: 'restricted',
      })
      expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
      expect(ending(id)).toBeUndefined()
      const rows = world.store.externalMcpServers()
      expect(rows).toHaveLength(1)
      expect(added).toMatchObject({ name: 'fictional-notes' })
      const beforeGrants = world.store.externalMcpServersFor('writer')
      const contacted = server.connections
      expect(beforeGrants).toEqual([])
      expect(await decide(id, approve)).toEqual({
        outcome: 'refused',
        stillOpen: false,
        reason:
          'A server called “fictional-notes” is already registered, so this request was taken down instead.',
      })
      await expect.poll(() => ending(id)).toMatchObject({ ending: 'superseded' })
      await expect
        .poll(notice)
        .toContain(
          `The person registered a server called “fictional-notes” themselves, so request ${id} was taken down.`,
        )
      expect(world.store.externalMcpServers()).toEqual(rows)
      expect(world.store.externalMcpServersFor('writer')).toEqual(beforeGrants)
      expect(server.connections).toBe(contacted)
      expect(
        world
          .ledger(asker)
          .filter((one) => one.type === 'mcp_server_request_settled' && one.requestId === id),
      ).toHaveLength(1)
    },
  )

  it('a server taken by Add is rechecked after discovery without overwriting the person’s reach', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const gate = world.gate()
    server.holdUntil(gate.promise, 1)
    const approval = decide(id)
    void approval.catch(() => undefined)
    await expect.poll(() => server.requests).toBe(1)
    const other = world.host()
    const added = await executeRuntimeCommand(other, world.window, {
      kind: 'registerExternalMcpServer',
      name: 'fictional-notes',
      url: server.url,
      reach: 'restricted',
    })
    gate.release()
    expect(await approval).toEqual({
      outcome: 'refused',
      reason: 'somebody answered that request first',
      stillOpen: false,
    })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'superseded' })
    expect(world.store.externalMcpServers()).toEqual([added])
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
  })

  it('contact history is not asserted before a preflight, during it or after restart', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    expect(Object.keys(host.mcpServerRequestsForAPerson()[0]!).sort()).toEqual([
      'askerCalled',
      'at',
      'conversation',
      'requested',
    ])
    const gate = world.gate()
    server.holdUntil(gate.promise)
    const approval = decide(id)
    await expect.poll(() => server.requests).toBe(1)
    expect(Object.keys(host.mcpServerRequestsForAPerson()[0]!).sort()).toEqual([
      'askerCalled',
      'at',
      'conversation',
      'requested',
    ])
    gate.release()
    await approval
    const pending = await ask('http://127.0.0.1:8765/second', { name: 'second-notes' })
    expect(
      Object.keys(
        host.mcpServerRequestsForAPerson().find((one) => one.requested.requestId === pending)!,
      ).sort(),
    ).toEqual(['askerCalled', 'at', 'conversation', 'requested'])
    host = await world.restart()
    expect(
      Object.keys(
        host.mcpServerRequestsForAPerson().find((one) => one.requested.requestId === pending)!,
      ).sort(),
    ).toEqual(['askerCalled', 'at', 'conversation', 'requested'])
  })

  it('a committed approval and grants survive a crash snapshot while the asker is mid-turn', async () => {
    const server = await world.server()
    const id = await ask(server.url, { who_gets_it: 'only-these-agents', agents: ['writer'] })
    const gate = world.gate()
    world.turnWait = gate.promise
    await host.send(asker, 'Fictional work before a crash.', world.window)
    await expect
      .poll(() => world.ledger(asker).some((one) => one.type === 'assistant_message'))
      .toBe(true)
    await expect.poll(() => world.handles.get('writer')?.status()).toBe('working')
    await decide(id)
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
    expect(world.launches).toHaveLength(1)
    // Read only committed database state, before the old host closes or hands its memory on.
    const old = host
    const closing = vi.spyOn(old, 'closeAll')
    host = world.crashSnapshot()
    expect(closing).not.toHaveBeenCalled()
    expect(ending(id)).toMatchObject({ ending: 'approved' })
    expect(world.store.externalMcpServersFor('writer')).toHaveLength(1)
    await host.resumeSession(asker, world.window)
    expect(world.launches.at(-1)?.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
    world.turnWait = null
    gate.release()
  })

  it('an archived asker holds the durable notice without starting until restored', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    expect(await host.archiveConversation(asker)).toMatchObject({ done: true })
    await decide(id)
    expect(
      world.store
        .messagesWaitingIn(asker)
        .map((one) => one.text)
        .join(''),
    ).toContain(`The person approved request ${id}`)
    expect(world.launches).toHaveLength(1)
    expect(world.sent).toEqual([])
    host = await world.restart()
    expect(world.store.messagesWaitingIn(asker)).toHaveLength(1)
    expect(world.store.externalMcpServersFor('writer')).toHaveLength(1)
    expect(host.restoreConversation(asker)).toMatchObject({ done: true })
    await host.resumeSession(asker, world.window)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
    expect(world.launches.at(-1)?.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
  })

  it('a post-insert waiting-reader failure cannot claim nothing was registered', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const insert = world.store.registerExternalMcpServer.bind(world.store)
    const reader = vi.spyOn(world.store, 'mcpServerRequestsWaiting')
    vi.spyOn(world.store, 'registerExternalMcpServer').mockImplementation((said) => {
      const row = insert(said)
      reader.mockImplementationOnce(() => {
        throw new Error('fictional list failure after insert')
      })
      return row
    })
    expect(await decide(id)).toEqual({
      outcome: 'taken',
      reason: 'Registered. It offers: read_notes.',
    })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
    expect(world.store.externalMcpServers()).toHaveLength(1)
    await expect.poll(notice).toContain('The person approved')
    expect(notice()).not.toContain('Nothing was registered')
  })

  it('an approval transaction fault survives restart as open and retryable with no partial row or grants', async () => {
    const server = await world.server()
    const id = await ask(server.url, { who_gets_it: 'only-these-agents', agents: ['writer'] })
    await host.close(asker, world.window)
    const append = world.store.append.bind(world.store)
    const fault = vi.spyOn(world.store, 'append').mockImplementation((...values) => {
      if (values[2].type === 'mcp_server_request_settled')
        throw new Error('fictional settlement fault')
      return append(...values)
    })
    expect(await decide(id)).toEqual({
      outcome: 'refused',
      stillOpen: true,
      reason:
        'BroCrew could not record that decision, so nothing changed: fictional settlement fault. Press it again, or refuse it.',
    })
    noRegistration()
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    expect(ending(id)).toBeUndefined()
    expect(world.sent).toEqual([])
    fault.mockRestore()
    host = await world.restart()
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    noRegistration()
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    expect(await decide(id)).toMatchObject({ outcome: 'taken' })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
    expect(world.store.externalMcpServers()).toHaveLength(1)
    expect(world.store.externalMcpServersFor('writer')).toEqual(world.store.externalMcpServers())
    expect(
      world
        .ledger(asker)
        .filter((one) => one.type === 'mcp_server_request_settled' && one.requestId === id),
    ).toHaveLength(1)
    expect(await decide(id)).toMatchObject({
      outcome: 'refused',
      stillOpen: false,
      reason: 'somebody answered that request first',
    })
  })

  it('Add during a start does not supersede the request after its registered name is removed', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await host.close(asker, world.window)
    const gate = world.gate()
    world.startWait = gate.promise
    const start = host.resumeSession(asker, world.window)
    void start.catch(() => undefined)
    await expect.poll(() => world.launches.length).toBe(2)
    await executeRuntimeCommand(host, world.window, {
      kind: 'registerExternalMcpServer',
      name: 'fictional-notes',
      url: server.url,
      reach: 'restricted',
    })
    const row = world.store.externalMcpServers()[0]!
    expect(row.name).toBe('fictional-notes')
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    expect(ending(id)).toBeUndefined()
    await executeRuntimeCommand(host, world.window, {
      kind: 'removeExternalMcpServer',
      serverId: row.id,
    })
    noRegistration()
    world.startWait = null
    gate.release()
    await start
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    expect(ending(id)).toBeUndefined()
    expect(notice()).not.toContain('was taken down')
    expect(await decide(id)).toMatchObject({ outcome: 'taken' })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
    expect(world.store.externalMcpServers()).toMatchObject([
      { name: 'fictional-notes', reach: 'everyone' },
    ])
  })

  it('a name taken during preflight ends superseded without overwriting it', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const gate = world.gate()
    server.holdUntil(gate.promise)
    const approval = decide(id)
    await expect.poll(() => server.requests).toBe(1)
    const earlier = world.store.registerExternalMcpServer({
      name: 'fictional-notes',
      url: 'http://127.0.0.1:8765/earlier',
      reach: 'restricted',
    })
    gate.release()
    expect(await approval).toMatchObject({
      outcome: 'refused',
      stillOpen: false,
      reason:
        'A server called “fictional-notes” is already registered, so this request was taken down instead.',
    })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'superseded' })
    expect(world.store.externalMcpServers()).toEqual([earlier])
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
  })

  it.each(['background', 'planning'] as const)(
    'a busy asker that enters %s while preflight waits is never reopened for tools',
    async (why) => {
      const server = await world.server()
      const id = await ask(server.url)
      const preflight = world.gate()
      server.holdUntil(preflight.promise)
      const approval = decide(id)
      await expect.poll(() => server.requests).toBe(1)
      const handle = world.handles.get('writer')!
      if (why === 'background') {
        handle.simulateBackgroundWork()
        await expect
          .poll(() =>
            world
              .ledger(asker)
              .some(
                (one) =>
                  one.type === 'background_work' &&
                  one.running !== undefined &&
                  one.running.length > 0,
              ),
          )
          .toBe(true)
      } else await handle.setPlanMode(true)
      const turn = world.gate()
      world.turnWait = turn.promise
      await host.send(asker, 'Fictional work in progress.', world.window)
      preflight.release()
      await approval
      expect(world.launches).toHaveLength(1)
      world.turnWait = null
      turn.release()
      await expect
        .poll(notice)
        .toContain(
          why === 'background'
            ? 'Not reopened: a reopen would stop the work this conversation runs in the background. The server’s tools reach it when it next starts or reopens.'
            : 'Not reopened: a reopen would end this conversation’s planning. The server’s tools reach it when it next starts or reopens.',
        )
      expect(world.launches).toHaveLength(1)
      expect(world.store.messagesWaitingIn(asker)).toEqual([])
      expect(world.handles.get('writer')).toBe(handle)
    },
  )

  it('an approval during an existing start cannot claim settlement before its ledger is available', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    await host.close(asker, world.window)
    const gate = world.gate()
    world.startWait = gate.promise
    const start = host.resumeSession(asker, world.window)
    void start.catch(() => undefined)
    await expect.poll(() => world.launches.length).toBe(2)
    let completed = false
    const approval = decide(id).then((ack) => {
      completed = true
      return ack
    })
    await expect.poll(() => server.requests).toBeGreaterThan(0)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(completed).toBe(false)
    noRegistration()
    expect(world.store.externalMcpServersFor('writer')).toEqual([])
    expect(ending(id)).toBeUndefined()
    world.startWait = null
    gate.release()
    await start
    expect(await approval).toMatchObject({ outcome: 'taken' })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
    await expect.poll(() => world.launches.length).toBe(3)
    expect(world.launches[2]!.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
    const ordinals = world.db
      .prepare('SELECT ordinal FROM events WHERE session_id = ? ORDER BY ordinal')
      .all(asker) as { ordinal: number }[]
    expect(new Set(ordinals.map((one) => one.ordinal)).size).toBe(ordinals.length)
  })

  it('a stop during the pending tools reopen hands the notice to the next start', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const turn = world.gate()
    world.turnWait = turn.promise
    await host.send(asker, 'Fictional work before a stop.', world.window)
    await expect
      .poll(() => world.ledger(asker).some((one) => one.type === 'assistant_message'))
      .toBe(true)
    await decide(id)
    expect(world.launches).toHaveLength(1)
    await host.close(asker, world.window)
    expect(
      world.store
        .messagesWaitingIn(asker)
        .map((one) => one.text)
        .join(''),
    ).toContain(`The person approved request ${id}`)
    world.turnWait = null
    turn.release()
    await expect.poll(() => world.launches.length).toBe(2)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
    expect(world.launches.at(-1)?.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
  })

  it('two approvals waiting on one open card deliver both notices with the next configuration', async () => {
    const first = await world.server(['read_first'])
    const second = await world.server(['read_second'])
    const left = await ask(first.url, { name: 'first-notes' })
    const right = await ask(second.url, { name: 'second-notes' })
    const card = world.handles.get('writer')!.simulateUserInput('Pick a fictional note', ['blue'])
    await expect
      .poll(() =>
        world.ledger(asker).some((one) => one.type === 'user_input_request' && one.id === card.id),
      )
      .toBe(true)
    await decide(left)
    await decide(right)
    expect(world.launches).toHaveLength(1)
    expect(world.sent).toEqual([])
    await host.respondUserInput(
      asker,
      card.id,
      { kind: 'answer', answers: { q0: ['blue'] } },
      world.window,
    )
    expect(await card.answered).toEqual({ kind: 'answer', answers: { q0: ['blue'] } })
    await expect.poll(notice).toContain(`The person approved request ${left}`)
    await expect.poll(notice).toContain(`The person approved request ${right}`)
    expect(
      world.launches
        .at(-1)
        ?.options.externalMcp?.servers?.map((one) => one.name)
        .sort(),
    ).toEqual(['first-notes', 'second-notes'])
    expect(
      world.ledger(asker).filter((one) => one.type === 'mcp_server_request_settled'),
    ).toHaveLength(2)
  })

  it('a skipped unreadable card row holds the tools reopen until it is repaired and answered', async () => {
    const server = await world.server()
    const id = await ask(server.url)
    const original = world.handles.get('writer')!
    const card = original.simulateUserInput('Pick a fictional note', ['blue'])
    let answered = false
    void card.answered.then(() => {
      answered = true
    })
    await expect
      .poll(() =>
        world.ledger(asker).some((one) => one.type === 'user_input_request' && one.id === card.id),
      )
      .toBe(true)
    const row = world.db
      .prepare(
        "SELECT id, payload FROM events WHERE session_id = ? AND type = 'request_routed' ORDER BY ordinal DESC LIMIT 1",
      )
      .get(asker) as { id: string; payload: string } | undefined
    expect(row).toBeDefined()
    expect(world.handles.get('writer')?.status()).toBe('idle')
    world.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run('not-json', row!.id)
    expect(await decide(id)).toMatchObject({ outcome: 'taken' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(answered).toBe(false)
    expect(world.handles.get('writer')).toBe(original)
    expect(world.launches).toHaveLength(1)
    expect(world.sent).toEqual([])
    expect(ending(id)).toMatchObject({ ending: 'approved' })
    world.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row!.payload, row!.id)
    await host.respondUserInput(
      asker,
      card.id,
      { kind: 'answer', answers: { q0: ['blue'] } },
      world.window,
    )
    expect(await card.answered).toEqual({ kind: 'answer', answers: { q0: ['blue'] } })
    await expect.poll(notice).toContain(`The person approved request ${id}`)
    await expect.poll(() => world.launches.length).toBe(2)
    expect(world.launches.at(-1)?.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes', url: server.url },
    ])
  })

  it.each(['http://localhost/mcp#fragment', 'http://[::1]:80/mcp', 'http://127.0.0.1:80/mcp'])(
    'the ask-time address check treats %s as the registered local address',
    async (url) => {
      const row = world.store.registerExternalMcpServer({
        name: 'existing-notes',
        url: 'http://127.0.0.1:80/mcp',
        reach: 'restricted',
      })
      const result = await call(args(url))
      expect(result.structured).toMatchObject({
        rail: 'server-already-registered',
        detail: { name: 'existing-notes', address: new URL(url).href },
      })
      expect(result.text).toContain('already registered, as “existing-notes”')
      expect(world.store.externalMcpServers()).toEqual([row])
      expect(world.store.mcpServerRequestsWaiting()).toEqual([])
      expect(world.store.externalMcpServersFor('writer')).toEqual([])
    },
  )

  it('a real SQLite grant fault rolls back partial grants and only the new registration', async () => {
    await world.open(host, 'editor')
    const older = await world.server(['old_notes'])
    await host.registerExternalMcpServer({ name: 'old-notes', url: older.url, reach: 'restricted' })
    world.store.grantExternalMcpServer('old-notes', ['writer'])
    const server = await world.server()
    const id = await ask(server.url, {
      who_gets_it: 'only-these-agents',
      agents: ['writer', 'editor'],
    })
    world.db.exec(`CREATE TRIGGER fictional_grant_failure BEFORE INSERT ON external_mcp_server_grant
      WHEN NEW.identity_id = (SELECT id FROM agent_identity WHERE slug = 'editor')
      BEGIN SELECT RAISE(ABORT, 'fictional grant write failed'); END`)
    expect(await decide(id)).toEqual({
      outcome: 'refused',
      stillOpen: true,
      reason:
        'BroCrew could not record that decision, so nothing changed: fictional grant write failed. Press it again, or refuse it.',
    })
    expect(world.store.externalMcpServers().map((one) => one.name)).toEqual(['old-notes'])
    expect(world.store.externalMcpServersFor('writer').map((one) => one.name)).toEqual([
      'old-notes',
    ])
    expect(world.store.externalMcpServersFor('editor')).toEqual([])
    expect(world.store.mcpServerRequestsWaiting()).toHaveLength(1)
    expect(ending(id)).toBeUndefined()
    world.db.exec('DROP TRIGGER fictional_grant_failure')
    expect(await decide(id)).toMatchObject({ outcome: 'taken' })
    await expect.poll(() => ending(id)).toMatchObject({ ending: 'approved' })
    expect(world.store.externalMcpServersFor('editor').map((one) => one.name)).toEqual([
      'fictional-notes',
    ])
  })
})
