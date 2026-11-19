import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('renaming a conversation', () => {
  const profileName = 'Selected Worker'
  let world: AServiceWorld
  let host: RuntimeHost
  let target: string
  let caller: string
  let changed: string[]

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('caller', 'normal')
    world.anAgent('worker', 'normal')
    expect(world.store.setAgentDisplayName('worker', profileName)).toBe(true)
    changed = []
    host = world.aHost({ announce: (notice) => changed.push(notice.what) })
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

  const readIdentity = (sessionId: string) =>
    executeRuntimeCommand(host, world.window, { kind: 'readConversationIdentity', sessionId })

  it('uses one ledger history for a person and an agent, while keeping the task title', async () => {
    const root = world.store.rootOf(target)!
    const taskTitle = world.store.rootLines(root.piece).title
    const listed = () =>
      [...host.resumableSessions(), ...host.unresumableSessions()].find(
        (row) => row.sessionId === target,
      )
    const beforePersonRename = world.store.recordedOne(target)!.updatedAt
    expect(listed()?.named).toMatchObject({ label: root.label, title: taskTitle })
    expect(await readIdentity(target)).toEqual({
      conversation: target,
      address: root.label,
      title: taskTitle ?? profileName,
      author: null,
    })
    changed.length = 0
    const named = await executeRuntimeCommand(host, world.window, {
      kind: 'renameConversation',
      conversation: root.label,
      title: 'Person’s job title',
    })
    expect(named).toMatchObject({ ok: true, address: root.label, author: { kind: 'person' } })
    expect(changed).toContain('work')
    expect(await readIdentity(target)).toEqual({
      conversation: target,
      address: root.label,
      title: 'Person’s job title',
      author: { kind: 'person' },
    })
    expect(host.nameByItsWork(target)).toBe(`conversation ${root.label} · Person’s job title`)
    expect(world.store.recordedOne(target)!.updatedAt).toBeGreaterThan(beforePersonRename)
    expect(listed()?.named).toMatchObject({ label: root.label, title: taskTitle })
    await host.close(target, world.window)

    const beforeAgentRename = world.store.recordedOne(target)!.updatedAt
    changed.length = 0
    const renamed = await agentRenames(target, 'A new job title', { author: { kind: 'person' } })
    expect(renamed.text).toContain('It was "Person’s job title", set by the person.')
    expect(renamed.structured).toMatchObject({
      ok: true,
      previousAuthor: { kind: 'person' },
      author: { kind: 'agent', conversation: caller },
    })
    expect(changed).toContain('work')
    const beforeRead = world.store.events(target)
    const providerHandles = world.handles.length
    expect(await readIdentity(target)).toEqual({
      conversation: target,
      address: root.label,
      title: 'A new job title',
      author: { kind: 'agent', conversation: caller },
    })
    expect(await readIdentity('sess_missing')).toBeNull()
    expect(world.store.events(target)).toEqual(beforeRead)
    expect(world.handles).toHaveLength(providerHandles)
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

  it('keeps the same selected id while its first task gives it an address and fallback title', async () => {
    const sessionId = 'sess_no_tasks'
    world.store.create({
      id: sessionId,
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'worker',
      parentSessionId: caller,
    })

    expect(world.store.firstTaskOf(sessionId)).toBeNull()
    expect(await readIdentity(sessionId)).toEqual({
      conversation: sessionId,
      address: sessionId,
      title: profileName,
      author: null,
    })

    const root = world.store.rootOf(caller)!
    const number = world.store.numberUnder(root.piece)
    const label = `${root.label}.${String(number)}`
    const piece = 'work_first'
    const title = 'First recorded task'
    const brief = 'Do the first task'
    world.store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner: sessionId,
        givenBy: caller,
        title,
        brief,
        folder: null,
        inputs: [],
      },
      world.store.nextOrdinal(sessionId),
      { type: 'work_given', piece, label, parent: root.piece, givenBy: caller, title, brief },
      world.clock,
    )

    const ledger = world.store.events(sessionId)
    const providerHandles = world.handles.length
    expect(await readIdentity(sessionId)).toEqual({
      conversation: sessionId,
      address: label,
      title,
      author: null,
    })
    expect(world.store.events(sessionId)).toEqual(ledger)
    expect(world.handles).toHaveLength(providerHandles)
  })
})
