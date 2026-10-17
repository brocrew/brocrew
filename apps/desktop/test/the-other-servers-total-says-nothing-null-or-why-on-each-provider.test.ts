import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sizesAdded } from '../src/shared/what-this-agent-was-given'
import { F093World, waitFor } from './lib/f093-host'

/**
 * # 966b3415 · the totals say what they counted for every tool in front of the model — other servers' tools
 *
 * `the-one-read-…-how-the-tools-are-handed.test.ts` registers `docs` on Codex but never reads its
 * `size`, reads Claude's size only after a tool list with another server in it, and
 * `what-this-agent-was-given.test.ts` reads Codex's only with no server granted. So
 * `otherServersToolsOf`'s three other answers are unread:
 *
 *  - §1 · ⚑ Codex, with a server granted: nothing in every request, and why — Codex finds those
 *    tools by search. ⚑ Beside it, with none granted: nothing, and no why.
 *  - §2 · ⛔ Claude before its tool list, with a server granted: `null`, and why — it can't tell.
 *    ⚑ Beside it, with none granted: nothing, and no why.
 *  - §3 · ⚑ Claude in full, with no other server in its list: nothing, and no why — never a "can't
 *    count" for servers that are not there. ⛔ Beside it, with one: `null`, and why.
 */

describe('W4.184 · other servers’ tools in the total, on each provider', () => {
  let world: F093World

  beforeEach(() => {
    world = new F093World()
  })

  afterEach(async () => {
    await world.dispose()
  })

  /** ⚑ A server for everyone, so every identity is handed it — read at each read, not at launch. */
  const registerDocs = (): void => {
    const row = world.store.registerExternalMcpServer({
      name: 'docs',
      url: 'http://127.0.0.1:9/mcp',
      reach: 'everyone',
    })
    if (row === null) throw new Error('the server was not registered')
  }

  it('⚑ Codex with a server granted: nothing in every request, and why — ⚑ with none, nothing and no why', async () => {
    const host = world.buildHost()
    const lead = await world.open(host, 'codex', 'lead')
    // ⚑ The control: no other server, nothing to say.
    const none = await host.whatThisAgentWasGiven(lead)
    expect(none.externalServers).toEqual([])
    expect(none.size.otherServersToolsInEveryRequest).toEqual(sizesAdded([]))
    expect(none.size.otherServersToolsWhy).toBeNull()

    registerDocs()
    const read = await host.whatThisAgentWasGiven(lead)
    // ⚑ The premise: the server is granted, and found by search.
    expect(read.externalServers[0]).toMatchObject({
      name: 'docs',
      deferral: { kind: 'found-by-search' },
    })
    // ⚑ Counted as nothing in every request — never "can't tell" — and said why.
    expect(read.size.otherServersToolsInEveryRequest).toEqual(sizesAdded([]))
    expect(read.size.otherServersToolsWhy).toMatch(/Codex finds other servers’ tools/)
  })

  it('⛔ Claude before its tool list, with a server granted: can’t count, and why — ⚑ with none, nothing and no why', async () => {
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead')
    // ⚑ The control: no other server, so there is nothing to count, tool list or not.
    const none = await host.whatThisAgentWasGiven(lead)
    expect(none.tools.deferral.kind).toBe('unknown')
    expect(none.size.otherServersToolsInEveryRequest).toEqual(sizesAdded([]))
    expect(none.size.otherServersToolsWhy).toBeNull()

    registerDocs()
    const before = await host.whatThisAgentWasGiven(lead)
    // ⚑ The premise: granted, and still no tool list from Claude.
    expect(before.externalServers.map((one) => one.name)).toEqual(['docs'])
    expect(before.tools.deferral.kind).toBe('unknown')
    // ⛔ Not nothing: this app can't tell what Claude sends of them, and says so.
    expect(before.size.otherServersToolsInEveryRequest).toBeNull()
    expect(before.size.otherServersToolsWhy).toMatch(/has not reported its tool list/)
  })

  it('⚑ Claude in full with no other server in its list: nothing, and no why — ⛔ with one: can’t count, and why', async () => {
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead')
    const handle = world.end.newest().handle

    // No tool search, so Claude hands every tool over in full; BroBot's alone besides its own.
    handle.simulateToolInventory({
      published: {
        tools: ['Bash', 'mcp__brobot__give_work'],
        servers: [{ name: 'brobot', status: 'connected' }],
      },
    })
    await waitFor(() => world.countOf(lead, 'tool_inventory') === 1, 'the first tool list')
    const alone = await host.whatThisAgentWasGiven(lead)
    expect(alone.tools.deferral.kind).toBe('in-every-request')
    expect(alone.size.otherServersToolsInEveryRequest).toEqual(sizesAdded([]))
    expect(alone.size.otherServersToolsWhy).toBeNull()

    // ⛔ The control: another server's tool in the list, handed over in full, cannot be counted.
    handle.simulateToolInventory({
      published: {
        tools: ['Bash', 'mcp__brobot__give_work', 'mcp__docs__search'],
        servers: [{ name: 'brobot', status: 'connected' }],
      },
    })
    await waitFor(() => world.countOf(lead, 'tool_inventory') === 2, 'the second tool list')
    const withOne = await host.whatThisAgentWasGiven(lead)
    expect(withOne.tools.deferral.kind).toBe('in-every-request')
    expect(withOne.size.otherServersToolsInEveryRequest).toBeNull()
    expect(withOne.size.otherServersToolsWhy).toMatch(/keeps none of their descriptions/)
  })
})
