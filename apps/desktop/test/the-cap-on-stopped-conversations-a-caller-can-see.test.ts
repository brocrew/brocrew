import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONVERSATIONS_LISTED, agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { callOn } from './helpers/call-tool'

describe('the conversations a caller can list', () => {
  let world: AServiceWorld

  beforeEach(() => {
    world = aServiceWorld()
    world.clock = Date.UTC(2030, 0, 1)
  })

  afterEach(async () => world.cleanUp())

  it('list_agents (and agentsVisibleTo) lists at most CONVERSATIONS_LISTED conversations, running and stopped alike, newest activity first, with a continuation for the oldest', async () => {
    // ⚑ The caller, running — and, opened first, the OLDEST activity of all.
    const host = world.aHost()
    const brobot = await world.aPersonOpens(host, DEFAULT_PROFILE_ID)
    // A read from a synthetic caller cannot move a listed row during pagination.
    const tools = agentToolsFor(host, 'unrecorded-test-caller')

    // ⚑ Open-and-immediately-close CONVERSATIONS_LISTED distinct identities, in strict sequence, so
    // each Close lands on a strictly increasing `updated_at` via the shared tick clock — the SAME
    // clock the host and the store share (`now: tick`), so the order these conversations were
    // closed IN is the order the list reads them back OUT in.
    const stopped: string[] = []
    for (let i = 0; i < CONVERSATIONS_LISTED; i++) {
      const profile = `worker${String(i)}`
      world.anAgent(profile, 'normal')
      const worker = await world.aPersonOpens(host, profile)
      await host.close(worker, world.window)
      stopped.push(worker)
    }
    expect(stopped).toHaveLength(CONVERSATIONS_LISTED)
    // ⚑ And one more, left RUNNING — the NEWEST activity. 52 reachable: two running, fifty stopped.
    world.anAgent('the-newest', 'normal')
    const newest = await world.aPersonOpens(host, 'the-newest')
    expect(host.sessionIds).toEqual(expect.arrayContaining([brobot, newest]))
    expect(host.sessionIds).not.toContain(stopped[0])

    const { agents, notListed, next } = (await callOn(tools, 'list_agents')) as {
      agents: { agent: string }[]
      notListed: number
      next: string
    }
    const ids = agents.map(({ agent }) => agent)
    // ⚑ Exactly the cap — never one more — and the answer counts the two it left out.
    expect(ids).toHaveLength(CONVERSATIONS_LISTED)
    expect(notListed).toBe(2)
    expect(ids).toEqual([newest, ...stopped.slice(1).reverse()])
    const second = await callOn(tools, 'list_agents', { cursor: next })
    expect(second).toMatchObject({
      agents: [{ agent: stopped[0] }, { agent: brobot }],
      count: 2,
      notListed: 0,
    })
    expect(second.next).toBeUndefined()
    const filtered = await callOn(tools, 'list_agents', {
      profile: 'worker0',
      from: '2030-01-01',
      to: '2030-01-01',
    })
    expect(filtered).toMatchObject({ agents: [{ agent: stopped[0] }], count: 1 })
    const different = await callOn(tools, 'list_agents', { profile: 'worker0', cursor: next })
    expect(different.outcome).toBe('refused')
    const archived = await callOn(tools, 'list_agents', { archived: true, cursor: next })
    expect(archived.outcome).toBe('refused')
    const malformed = await callOn(tools, 'list_agents', { from: '2030-02-30' })
    expect(malformed.outcome).toBe('refused')
    const afterDate = await callOn(tools, 'list_agents', { from: '2030-01-02' })
    expect(afterDate).toMatchObject({ agents: [], count: 0 })

    // ⚑ The reader `list_agents` IS, asked directly, agrees with the tool's own answer — order and
    // count alike.
    const visible = host.agentsVisibleTo({ ownerId: agentCallerId(brobot) }, brobot)
    expect(visible.agents.map((card) => card.agent)).toEqual(ids)
    expect(visible.notListed).toBe(2)
  })
})
