import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { UserTurnEvent } from '../src/shared/human-answer-contracts'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
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
    world.anAgent('rail-service')
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
  const readTitles = (sessionId: string) =>
    executeRuntimeCommand(host, world.window, { kind: 'readConversationTitleHistory', sessionId })

  function recordTurn(conversation: string, turn: Omit<UserTurnEvent, 'type'>): void {
    world.store.append(
      conversation,
      world.store.nextOrdinal(conversation),
      { type: 'user_turn', ...turn },
      world.clock,
    )
  }

  function recordFirstTask(owner: string, title: string, brief: string): string {
    const root = world.store.rootOf(caller)!
    const number = world.store.numberUnder(root.piece)
    const label = `${root.label}.${String(number)}`
    const piece = 'work_first'
    world.store.recordGive(
      {
        piece,
        parent: root.piece,
        number,
        owner,
        givenBy: caller,
        title,
        brief,
        folder: null,
        inputs: [],
      },
      world.store.nextOrdinal(owner),
      { type: 'work_given', piece, label, parent: root.piece, givenBy: caller, title, brief },
      world.clock,
    )
    return label
  }

  it('projects only the requested distinct rail rows with the same canonical identity as selection', async () => {
    const empty = 'sess_rail_empty'
    const service = 'sess_rail_service'
    const serviceTask = 'Service task title'
    expect(world.store.setAgentDisplayName('rail-service', 'Rail Service')).toBe(true)
    world.store.create({
      id: empty,
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'worker',
      parentSessionId: caller,
    })
    world.store.create({
      id: service,
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'rail-service',
      service: true,
    })
    const taskLabel = recordFirstTask(service, serviceTask, 'Complete the service task.')
    expect(world.store.firstTaskOf(service)?.label).toBe(taskLabel)
    expect(world.store.defaultConversationTitle(service)).toBe(serviceTask)
    world.store.titleConversation(
      target,
      world.store.nextOrdinal(target),
      { type: 'titled', title: 'Saved rail title', author: { kind: 'person' } },
      world.clock,
    )
    const root = world.store.rootOf(target)!
    const starts = world.handles.length
    const descending = [
      {
        conversation: target,
        address: root.label,
        title: 'Saved rail title',
        author: { kind: 'person' },
      },
      { conversation: empty, address: empty, title: profileName, author: null },
      { conversation: service, address: service, title: 'Rail Service', author: null },
    ].sort((first, second) => (first.conversation < second.conversation ? 1 : -1))
    const expected = [descending[1]!, descending[0]!, descending[2]!]
    const ids = expected.map(({ conversation }) => conversation)
    const before = ids.map((id) => world.store.events(id))
    const read = (sessionIds: readonly string[]) =>
      executeRuntimeCommand(host, world.window, { kind: 'readConversationIdentities', sessionIds })

    expect(await read(['sess_missing', ...ids, ids[0]!])).toEqual(expected)
    expect(await read([])).toEqual([])
    expect(await read(Array(15).fill(target))).toEqual([await readIdentity(target)])
    await expect(read(Array(16).fill(target))).rejects.toThrow('invalid runtime command')
    expect(world.handles).toHaveLength(starts)
    expect(ids.map((id) => world.store.events(id))).toEqual(before)
  })

  it('uses the first person message in stored order when the conversation has no work title', async () => {
    const conversation = await world.aPersonOpens(host, DEFAULT_PROFILE_ID)
    const root = world.store.rootOf(conversation)!

    expect(await readIdentity(conversation)).toEqual({
      conversation,
      address: root.label,
      title: 'BroBot',
      author: null,
    })
    recordTurn(conversation, { text: 'An imported opening', attribution: 'provider_transcript' })
    recordTurn(conversation, { text: 'An app notice', attribution: 'app_authored' })
    const firstLine = 'A long opening '.repeat(16).trimEnd()
    recordTurn(conversation, {
      text: 'The flattened text of the whole turn',
      humanInitiated: true,
      parts: [
        { text: 'Agent brief', attribution: 'app_authored' },
        { text: `\r\n  ${firstLine}  \r\nSecond line`, humanInitiated: true },
        { text: 'Second person message in the same turn', humanInitiated: true },
      ],
    })
    recordTurn(conversation, { text: 'Later person message', humanInitiated: true })
    expect(world.store.conversationTitle(conversation)).toBeNull()

    const identity = { conversation, address: root.label, title: firstLine, author: null }
    expect(await readIdentity(conversation)).toEqual(identity)
    expect(
      await executeRuntimeCommand(host, world.window, {
        kind: 'readConversationIdentities',
        sessionIds: [conversation],
      }),
    ).toEqual([identity])
  })

  it.each<{ reason: string; opening: Omit<UserTurnEvent, 'type'> }>([
    { reason: 'blank message', opening: { text: ' \r\n ', humanInitiated: true } },
    { reason: 'unstamped opening', opening: { text: 'Opening from an unstamped ledger' } },
    {
      reason: 'blank first person message in a combined turn',
      opening: {
        text: 'Combined turn',
        humanInitiated: true,
        parts: [
          { text: 'Earlier agent message', attribution: 'app_authored' },
          { text: ' \n ', humanInitiated: true },
          { text: 'Later person message in the same turn', humanInitiated: true },
        ],
      },
    },
  ])('keeps the profile when the opening is a $reason', async ({ opening }) => {
    recordTurn(target, opening)
    recordTurn(target, { text: 'Later observed prompt', humanInitiated: true })
    expect(await readIdentity(target)).toMatchObject({ title: profileName, author: null })
  })

  it('gives explicit, root and first owned task titles precedence over a person opening', async () => {
    const root = world.store.rootOf(target)!
    recordTurn(target, { text: 'Opening line\nMore details', humanInitiated: true })
    expect(await readIdentity(target)).toMatchObject({ address: root.label, title: 'Opening line' })

    recordFirstTask(target, 'First owned task', 'Complete the first task.')
    expect(await readIdentity(target)).toMatchObject({
      address: root.label,
      title: 'First owned task',
    })
    world.store.append(
      target,
      world.store.nextOrdinal(target),
      { type: 'work_retitled', piece: root.piece, title: 'Root title', by: null },
      world.clock,
    )
    expect(await readIdentity(target)).toMatchObject({
      address: root.label,
      title: 'Root title',
      author: null,
    })
    const named = await executeRuntimeCommand(host, world.window, {
      kind: 'renameConversation',
      conversation: root.label,
      title: 'Explicit title',
    })
    expect(named).toMatchObject({ previousTitle: 'Root title', title: 'Explicit title' })
    expect(await readIdentity(target)).toMatchObject({
      address: root.label,
      title: 'Explicit title',
      author: { kind: 'person' },
    })
  })

  it('keeps the profile for an agent-started reader even if it later owns a root', async () => {
    const conversation = 'sess_child_with_root'
    world.store.create({
      id: conversation,
      provider: 'claude',
      cwd: '/work',
      approvalMode: 'ask',
      profileId: 'worker',
      parentSessionId: caller,
    })
    const root = world.store.ensurePersonalRoot(conversation, world.clock)
    recordTurn(conversation, { text: 'A later person message', humanInitiated: true })
    expect(await readIdentity(conversation)).toEqual({
      conversation,
      address: root.label,
      title: profileName,
      author: null,
    })
  })

  it('keeps the profile for an adopted conversation even after a person writes to it', async () => {
    const conversation = 'sess_adopted_with_root'
    world.store.adopt({
      id: conversation,
      provider: 'claude',
      sessionId: 'adopted-provider-thread',
      cwd: '/work',
      profileId: 'worker',
      createdAt: 1,
      updatedAt: 2,
    })
    const root = world.store.rootOf(conversation)!
    recordTurn(conversation, { text: 'A person writes after adoption', humanInitiated: true })
    expect(await readIdentity(conversation)).toEqual({
      conversation,
      address: root.label,
      title: profileName,
      author: null,
    })
  })

  it('uses one ledger history for a person and an agent, while keeping the task title', async () => {
    const root = world.store.rootOf(target)!
    const taskTitle = world.store.rootLines(root.piece).title
    const listed = () =>
      [...host.resumableSessions(), ...host.unresumableSessions()].find(
        (row) => row.sessionId === target,
      )
    const beforePersonRename = world.store.recordedOne(target)!.updatedAt
    expect(await readTitles(target)).toEqual({
      kind: 'titles',
      titles: [],
      rowsUnread: 0,
      next: null,
    })
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
    expect(changed.filter((what) => what === 'work')).toHaveLength(1)
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
    expect(changed.filter((what) => what === 'work')).toHaveLength(1)
    const beforeRead = world.store.events(target)
    const recordedBeforeRead = world.store.recordedOne(target)
    const providerHandles = world.handles.length
    expect(await readIdentity(target)).toEqual({
      conversation: target,
      address: root.label,
      title: 'A new job title',
      author: { kind: 'agent', conversation: caller },
    })
    expect(await readIdentity('sess_missing')).toBeNull()
    expect(await readTitles(target)).toMatchObject({
      kind: 'titles',
      titles: [
        { title: 'A new job title', author: { kind: 'agent', conversation: caller } },
        { title: 'Person’s job title', author: { kind: 'person' } },
      ],
      rowsUnread: 0,
      next: null,
    })
    expect(await readTitles('sess_missing')).toBeNull()
    expect(world.store.recordedOne(target)).toEqual(recordedBeforeRead)
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

    const title = 'First recorded task'
    const label = recordFirstTask(sessionId, title, 'Do the first task')

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
