import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('provider choices in the public tools', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld({ holderReminders: 'declined' })
    world.anAgent('draft-reader', 'normal', 'claude')
  })
  afterEach(async () => world.cleanUp())

  async function setup() {
    const host = world.aHost()
    const giver = (
      await host.createSession(
        { provider: 'claude', profileId: 'review-lead', cwd: world.folder, approvalMode: 'auto' },
        world.window,
      )
    ).sessionId
    const tools = agentToolsFor(host, giver).tools
    const tool = (name: string) => {
      const found = tools.find((one) => one.name === name)
      if (found === undefined) throw new Error(`no tool ${name}`)
      return found
    }
    return { host, giver, tool }
  }

  it('advertises an optional provider and explains conversation routing and separate native permissions', async () => {
    const { tool } = await setup()
    const give = tool('give_work')
    const schema = z.toJSONSchema(z.looseObject(give.input))
    expect(schema.properties?.provider).toMatchObject({ enum: ['claude', 'codex'] })
    expect(schema.required ?? []).not.toContain('provider')
    expect(give.description).toContain('one conversation per provider')
    expect(give.description).toContain('Always allow')
    expect(give.description).toContain('per provider')
  })

  it('names each conversation provider on both list and status even though the identity default differs', async () => {
    const { host, giver, tool } = await setup()
    const claude = await world.gives(host, giver, 'draft-reader')
    const codex = await world.gives(host, giver, 'draft-reader', { provider: 'codex' })
    expect(claude.ok && codex.ok).toBe(true)
    if (!claude.ok || !codex.ok) throw new Error('give refused')
    const listed = await tool('list_agents').call({})
    expect(listed.text).toContain(' · Claude · ')
    expect(listed.text).toContain(' · Codex · ')
    const status = await tool('get_agent_status').call({ agent: codex.label })
    expect(status.text).toContain(' · Codex · ')
    expect(status.structured?.agent).toMatchObject({ provider: 'codex' })
    expect(world.store.providerOf('draft-reader')).toBe('claude')
  })

  it('changes only the default and keeps a piece follow-up on its original conversation', async () => {
    const { host, giver, tool } = await setup()
    const claude = await world.gives(host, giver, 'draft-reader')
    const codex = await world.gives(host, giver, 'draft-reader', { provider: 'codex' })
    if (!claude.ok || !codex.ok) throw new Error('give refused')
    expect(host.setAgentProvider('draft-reader', 'codex')).toMatchObject({ provider: 'codex' })
    expect(await world.gives(host, giver, 'draft-reader')).toMatchObject({
      ok: true,
      owner: codex.owner,
    })
    const before = world.conversationsRecorded()
    const changed = await tool('update_work').call({
      piece: claude.label,
      brief: 'Read the fictional appendix too.',
    })
    expect(changed.structured?.outcome, changed.text).toBe('ok')
    expect(world.store.workById(claude.piece)?.owner).toBe(claude.owner)
    expect(
      world.store.piecesOwnedBy(claude.owner).find((piece) => piece.piece === claude.piece)?.brief,
    ).toBe('Read the fictional appendix too.')
    expect(world.store.recordedOne(claude.owner)?.provider).toBe('claude')
    expect(world.store.recordedOne(codex.owner)?.provider).toBe('codex')
    expect(world.conversationsRecorded()).toBe(before)
  })

  it('names the chosen provider while its first conversation is still starting', async () => {
    const { host, giver, tool } = await setup()
    let release!: () => void
    world.startsWait = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = world.gives(host, giver, 'draft-reader', { provider: 'codex' })
    try {
      await vi.waitFor(() => expect(world.startedAs).toContain('draft-reader'))
      const card = host
        .agentsVisibleTo({ ownerId: agentCallerId(giver) }, giver)
        .agents.find((agent) => agent.agent !== giver)
      expect(card?.state.is).toBe('active')
      expect(world.store.recordedOne(card!.agent)).toBeNull()
      expect(card?.provider).toBe('codex')
      const status = await tool('get_agent_status').call({ agent: card!.agent })
      expect(status.text).toContain(' · Codex · ')
    } finally {
      release()
      await pending
    }
  })
})
