import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('renaming a conversation', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let target: string
  let caller: string

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('caller', 'normal')
    world.anAgent('worker', 'normal')
    host = world.aHost()
    target = await world.aPersonOpens(host, 'worker')
    caller = await world.aPersonOpens(host, 'caller')
  })

  afterEach(async () => {
    await world.cleanUp()
  })

  const agentRenames = (conversation: string, title: string, extra = {}) =>
    agentToolsFor(host, caller)
      .tools.find((tool) => tool.name === 'rename_conversation')!
      .call({ conversation, title, ...extra })

  it('uses one ledger history for a person and an agent, while keeping the task title', async () => {
    const root = world.store.rootOf(target)!
    const taskTitle = world.store.rootLines(root.piece).title
    const listed = () =>
      [...host.resumableSessions(), ...host.unresumableSessions()].find(
        (row) => row.sessionId === target,
      )
    const beforePersonRename = world.store.recordedOne(target)!.updatedAt
    expect(listed()?.named).toMatchObject({ label: root.label, title: taskTitle })
    const named = await executeRuntimeCommand(host, world.window, {
      kind: 'renameConversation',
      conversation: root.label,
      title: 'Person’s job title',
    })
    expect(named).toMatchObject({ ok: true, address: root.label, author: { kind: 'person' } })
    expect(host.nameByItsWork(target)).toBe(`conversation ${root.label} · Person’s job title`)
    expect(world.store.recordedOne(target)!.updatedAt).toBeGreaterThan(beforePersonRename)
    expect(listed()?.named).toMatchObject({ label: root.label, title: taskTitle })
    await host.close(target, world.window)

    const beforeAgentRename = world.store.recordedOne(target)!.updatedAt
    const renamed = await agentRenames(target, 'A new job title', { author: { kind: 'person' } })
    expect(renamed.text).toContain('It was "Person’s job title", set by the person.')
    expect(renamed.structured).toMatchObject({
      ok: true,
      previousAuthor: { kind: 'person' },
      author: { kind: 'agent', conversation: caller },
    })
    expect(host.nameByItsWork(target)).toBe(`conversation ${root.label} · A new job title`)
    expect(listed()?.named).toMatchObject({ label: root.label, title: taskTitle })
    expect(world.store.recordedOne(target)!.updatedAt).toBeGreaterThan(beforeAgentRename)
    expect(world.store.rootLines(root.piece).title).toBe(taskTitle)
    expect(
      world.store
        .events(target)
        .map((entry) => entry.event)
        .filter((event) => event.type === 'titled'),
    ).toEqual([
      { type: 'titled', title: 'Person’s job title', author: { kind: 'person' } },
      { type: 'titled', title: 'A new job title', author: { kind: 'agent', conversation: caller } },
    ])
  })

  it('refuses invalid input without writing a title', async () => {
    expect((await agentRenames(target, 'two\nlines')).text).toBe(
      'Not changed: a title is one line of 1 to 200 characters.',
    )
    expect((await agentRenames('sess_missing', 'Job')).text).toBe(
      'Not changed: no conversation has the address sess_missing. search_work finds conversations.',
    )
    expect(world.store.conversationTitle(target)).toBeNull()
    const refused = world.ledger(caller).filter((event) => event.type === 'tool_refused')
    expect(refused).toMatchObject([
      { tool: 'rename_conversation', rail: 'malformed-request' },
      { tool: 'rename_conversation', rail: 'no-such-agent' },
    ])
  })
})
