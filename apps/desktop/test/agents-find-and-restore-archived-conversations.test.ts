import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { F093World, waitFor } from './lib/f093-host'

/**
 * What an agent sees of an archived conversation, through its own tools on the real host and store:
 * out of sight in its default lists, found with `archived: true`, and brought back.
 */

let world: F093World
let host: RuntimeHost

beforeEach(() => {
  world = new F093World()
  host = world.buildHost(false)
})

afterEach(async () => {
  await world.dispose()
})

interface Said {
  readonly text: string
  readonly structured: Record<string, unknown>
}

/** One of `from`'s tools, called as that conversation calls it. */
async function call(from: string, name: string, args: Record<string, unknown> = {}): Promise<Said> {
  const tool = agentToolsFor(host, from).tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no tool named ${name}`)
  const said = await tool.call(args)
  return { text: said.text, structured: said.structured as Record<string, unknown> }
}

const agentsIn = (said: Said, key: 'agents' | 'archived'): string[] =>
  (said.structured[key] as { agent: string }[]).map((one) => one.agent)

/** A pm conversation, and the helper it started by giving it one piece. */
async function aGiverAndItsHelper(): Promise<{ pm: string; helper: string; label: string }> {
  const pm = await world.open(host, 'claude', 'pm')
  const gave = await call(pm, 'give_work', {
    definition_of_done: 'The requested result and its checks are recorded.',
    profile: 'helper',
    new: true,
    title: 'Sort the letters',
    brief: 'Sort the letters by date.',
  })
  expect(gave.structured['outcome'], gave.text).toBe('ok')
  const helper = String(gave.structured['agent'])
  await waitFor(() => world.store.recordedOne(helper) !== null, 'the helper to be recorded')
  return { pm, helper, label: String(gave.structured['label']) }
}

describe('an archived conversation in an agent’s lists', () => {
  it('is left out of list_agents, and archived: true lists it with when and by whom', async () => {
    const { pm, helper } = await aGiverAndItsHelper()
    expect(agentsIn(await call(pm, 'list_agents'), 'agents')).toContain(helper)
    expect(agentsIn(await call(pm, 'list_agents', { archived: true }), 'archived')).toEqual([])

    expect(await host.archiveConversation(helper)).toMatchObject({ done: true })

    const listed = await call(pm, 'list_agents')
    expect(agentsIn(listed, 'agents')).not.toContain(helper)
    expect(agentsIn(listed, 'agents')).toContain(pm)
    const archived = await call(pm, 'list_agents', { archived: true })
    expect(agentsIn(archived, 'archived')).toEqual([helper])
    expect(archived.structured['count']).toBe(1)
    const row = (archived.structured['archived'] as Record<string, unknown>[])[0]!
    expect(row['archived_by']).toBe('a person')
    expect(row['archived_at']).toEqual(expect.any(String))
    // Its line names it by the piece it holds, and says it is archived, when and by whom.
    expect(archived.text).toContain('Sort the letters')
    expect(archived.text).toMatch(/ · archived .+ by a person/u)

    // Its label still reaches it, and its card says it is archived.
    const status = await call(pm, 'get_agent_status', { agent: helper })
    expect(status.structured['outcome']).toBe('ok')
    expect(status.structured['archived_by']).toBe('a person')
    expect(status.text).toMatch(/ · archived .+ by a person/u)
    // Its agent's record lists it, marked.
    const record = await call(pm, 'list_profiles', { profile: 'helper' })
    expect(record.text).toMatch(/ · archived .+ by a person/u)
    expect(
      (record.structured['conversations'] as Record<string, unknown>[]).map((one) => [
        one['agent'],
        one['archived_by'],
      ]),
    ).toEqual([[helper, 'a person']])

    expect(host.restoreConversation(helper)).toMatchObject({ done: true })
    expect(agentsIn(await call(pm, 'list_agents'), 'agents')).toContain(helper)
    expect(agentsIn(await call(pm, 'list_agents', { archived: true }), 'archived')).toEqual([])
    const after = await call(pm, 'get_agent_status', { agent: helper })
    expect(after.structured['archived_by']).toBeUndefined()
    expect(after.text).not.toContain('archived')
    expect((await call(pm, 'list_profiles', { profile: 'helper' })).text).not.toContain('archived')
  })

  it('refuses an archived that is not true or false', async () => {
    const pm = await world.open(host, 'claude', 'pm')
    const said = await call(pm, 'list_agents', { archived: 'yes' })
    expect(said.structured['outcome']).toBe('refused')
    expect(said.structured['rail']).toBe('malformed-request')
  })

  it('takes the open piece it holds off its giver’s board, named in one line', async () => {
    const { pm, helper, label } = await aGiverAndItsHelper()
    const before = await call(pm, 'list_tasks')
    expect(before.structured['held_by_archived']).toEqual([])
    expect((before.structured['you_gave'] as { label: string }[]).map((one) => one.label)).toEqual([
      label,
    ])
    expect(before.text).not.toContain('put away')

    expect(await host.archiveConversation(helper)).toMatchObject({ done: true })

    const board = await call(pm, 'list_tasks')
    expect(board.structured['you_gave']).toEqual([])
    expect(board.structured['held_by_archived']).toEqual([label])
    expect(board.text).toContain(`put away with archived conversations, and not listed: ${label}.`)
    // Open work it gave exists, so the board does not say there is none.
    expect(board.text).not.toContain('no work you gave is open')
    expect(board.text).not.toContain('you have not given anybody work')
    // Named, its record is still read.
    const record = await call(pm, 'list_tasks', { piece: label })
    expect(record.structured['rail']).toBeUndefined()
    expect(record.text).toContain('Sort the letters')

    expect(host.restoreConversation(helper)).toMatchObject({ done: true })
    const again = await call(pm, 'list_tasks')
    expect(again.structured['held_by_archived']).toEqual([])
    expect((again.structured['you_gave'] as { label: string }[]).map((one) => one.label)).toEqual([
      label,
    ])
  })
})

describe('an agent restoring an archived conversation', () => {
  const restoredRows = (conversation: string): string[] =>
    world
      .ledger(conversation)
      .flatMap((event) => (event.type === 'restored_from_archive' ? [event.saying] : []))

  it('brings it and the helpers archived with it back, sends nothing, and each transcript names the agent', async () => {
    const { pm, helper, label } = await aGiverAndItsHelper()
    world.store.create({
      id: 'below_1',
      provider: 'claude',
      cwd: world.project,
      approvalMode: 'auto',
      profileId: 'helper',
      parentSessionId: helper,
    })
    expect(await host.archiveConversation(helper)).toMatchObject({
      done: true,
      conversations: [helper, 'below_1'],
    })
    const launched = world.end.handed.length
    const turns = world.turnsOf(helper).length

    // By the label of the piece it holds, as list_agents with archived: true names it.
    const said = await call(pm, 'restore_agent', { agent: label })
    // Neither held a message or a schedule when it was archived, so each stays stopped.
    expect(said.structured).toEqual({
      outcome: 'ok',
      restored: [
        { agent: helper, carries_on: 'stopped' },
        { agent: 'below_1', carries_on: 'stopped' },
      ],
    })
    expect(said.text).toContain('restored, back in the lists; you sent them nothing')
    expect(said.text.match(/stays stopped until something starts it/g)).toHaveLength(2)

    expect(agentsIn(await call(pm, 'list_agents'), 'agents')).toContain(helper)
    expect(agentsIn(await call(pm, 'list_agents', { archived: true }), 'archived')).toEqual([])
    expect([
      ...host.resumableSessions().map(({ sessionId }) => sessionId),
      ...host.unresumableSessions().map(({ sessionId }) => sessionId),
    ]).toEqual(expect.arrayContaining([helper, 'below_1']))
    // Nothing was started, and nothing was sent.
    expect(world.end.handed).toHaveLength(launched)
    expect(world.turnsOf(helper)).toHaveLength(turns)
    expect(world.launchesOf(helper)).toHaveLength(1)
    // The person reads who brought it back, in each conversation that came back.
    const name = host.whatToCallTheConversation(pm)
    const saying = `Brought back from the archive: ${name} restored it.`
    expect(restoredRows(helper)).toEqual([saying])
    expect(restoredRows('below_1')).toEqual([saying])
    expect(restoredRows(pm)).toEqual([])
  })

  it('restores any archived conversation, one outside its own tree too', async () => {
    const { helper } = await aGiverAndItsHelper()
    const stranger = await world.open(host, 'claude', 'archivist')
    expect(world.store.conversationTree(stranger)).not.toContain(helper)
    expect(await host.archiveConversation(helper)).toMatchObject({ done: true })

    const said = await call(stranger, 'restore_agent', { agent: helper })
    expect(said.structured).toMatchObject({ outcome: 'ok', restored: [{ agent: helper }] })
    expect(restoredRows(helper)).toEqual([
      `Brought back from the archive: ${host.whatToCallTheConversation(stranger)} restored it.`,
    ])
  })

  it('refuses what the person’s Restore refuses, and says the next step', async () => {
    const { pm, helper } = await aGiverAndItsHelper()

    const notArchived = await call(pm, 'restore_agent', { agent: helper })
    expect(notArchived.structured).toMatchObject({
      outcome: 'refused',
      rail: 'that-conversation-is-not-archived',
      permanence: 'permanent',
    })
    expect(notArchived.text).toContain('list_agents with archived: true')

    const nobody = await call(pm, 'restore_agent', { agent: 'sess_nobody' })
    expect(nobody.structured).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })

    const unnamed = await call(pm, 'restore_agent', {})
    expect(unnamed.structured).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })

    // While an archive is still stopping it, the restore is refused in the host's words, for now.
    const { handle } = world.end.newest()
    let letItClose = (): void => {}
    const held = new Promise<void>((resolve) => (letItClose = resolve))
    const close = handle.close.bind(handle)
    Object.defineProperty(handle, 'close', {
      value: async (): Promise<void> => {
        await held
        await close()
      },
      configurable: true,
    })
    const archiving = host.archiveConversation(helper)
    const waiting = await call(pm, 'restore_agent', { agent: helper })
    expect(waiting.structured).toMatchObject({
      outcome: 'refused',
      rail: 'it-is-being-archived-or-deleted',
      retryable: true,
      remedy: 'make-the-same-call-when-this-settles',
    })
    expect((waiting.structured['detail'] as { said: string }).said).toContain(
      'is being archived now',
    )
    letItClose()
    expect(await archiving).toMatchObject({ done: true })
    expect(restoredRows(helper)).toEqual([])

    expect((await call(pm, 'restore_agent', { agent: helper })).structured).toMatchObject({
      outcome: 'ok',
      restored: [{ agent: helper }],
    })
  })

  it('says so when a restored conversation starts for the message it held, and its notice reads first', async () => {
    const pm = await world.open(host, 'claude', 'pm')
    // A conversation kept busy: in ask mode its turn waits on a person's approval.
    const busy = await world.open(host, 'claude', 'worker', { approvalMode: 'ask' })
    await host.send(busy, 'do the first thing', world.window)
    const held = await call(pm, 'message_agent', {
      agent: busy,
      kind: 'note',
      text: 'and remember the second thing',
    })
    expect(held.structured, held.text).toMatchObject({ outcome: 'ok', delivery: 'queued' })
    expect(await host.archiveConversation(busy)).toMatchObject({ done: true })
    expect(world.launchesOf(busy)).toHaveLength(1)

    const said = await call(pm, 'restore_agent', { agent: busy })
    expect(said.structured).toEqual({
      outcome: 'ok',
      restored: [{ agent: busy, carries_on: 'starting' }],
    })
    expect(said.text).toContain('starting now, for what it held when it was archived')

    await waitFor(
      () => world.turnsOf(busy).some((turn) => turn.text.includes('and remember the second thing')),
      'the held message to go in',
    )
    // The person reads who restored it before the start it led to.
    const types = world.ledger(busy).map((event) => event.type)
    expect(types.filter((type) => type === 'launched')).toHaveLength(2)
    expect(types.indexOf('restored_from_archive')).toBeGreaterThan(types.indexOf('launched'))
    expect(types.indexOf('restored_from_archive')).toBeLessThan(types.lastIndexOf('launched'))
  })

  it('names nothing to a caller that cannot reach it, unless it is archived', async () => {
    const { helper, label } = await aGiverAndItsHelper()
    const narrowed = await world.open(host, 'claude', 'explorer')
    expect(world.store.setCapabilities('explorer', { canMessage: 'none' })).toBe(true)

    // Not archived and out of reach: the address names nothing, by its label or its id.
    for (const agent of [label, helper]) {
      expect((await call(narrowed, 'restore_agent', { agent })).structured).toMatchObject({
        outcome: 'refused',
        rail: 'no-such-agent',
      })
    }
    expect(await host.archiveConversation(helper)).toMatchObject({ done: true })
    // It lists only what it can reach, and any archived conversation may be restored.
    expect(agentsIn(await call(narrowed, 'list_agents', { archived: true }), 'archived')).toEqual(
      [],
    )
    expect((await call(narrowed, 'restore_agent', { agent: label })).structured).toMatchObject({
      outcome: 'ok',
      restored: [{ agent: helper }],
    })
  })

  it('says a person has to act when the list of archived conversations cannot be saved', async () => {
    const { pm, helper } = await aGiverAndItsHelper()
    expect(await host.archiveConversation(helper)).toMatchObject({ done: true })
    const kept = host as unknown as { archived: { remove(ids: readonly string[]): void } }
    const remove = kept.archived.remove.bind(kept.archived)
    kept.archived.remove = () => {
      throw new Error(
        'BroCrew couldn’t save its list of archived conversations, so it changed nothing.',
      )
    }

    const said = await call(pm, 'restore_agent', { agent: helper })
    expect(said.structured).toMatchObject({
      outcome: 'refused',
      rail: 'it-could-not-be-restored',
      permanence: 'until-a-person-changes-it',
      retryable: false,
      remedy: null,
    })
    expect((said.structured['detail'] as { said: string }).said).toContain('couldn’t save')
    expect(said.text).toContain('Tell the person')
    // Nothing was restored, and nothing says it was.
    expect(agentsIn(await call(pm, 'list_agents', { archived: true }), 'archived')).toEqual([
      helper,
    ])
    expect(restoredRows(helper)).toEqual([])

    kept.archived.remove = remove
    expect((await call(pm, 'restore_agent', { agent: helper })).structured).toMatchObject({
      outcome: 'ok',
    })
  })

  it('is told to agents: how to find one, and to restore only what their work needs', () => {
    const tools = agentToolsFor(host, 'sess_x').tools
    const restore = tools.find((one) => one.name === 'restore_agent')
    expect(restore?.description).toContain('Restore only what your work needs')
    expect(restore?.description).toContain('list_agents with archived: true')
    expect(restore?.description).toContain('its transcript says that you restored it')
    expect(restore?.description).toContain('one that held messages when it was archived starts')
    expect(restore?.description).toContain('starts it and spends a turn')
    expect(restore?.description).toContain(
      'To only read an archived conversation, do not restore it',
    )
    const list = tools.find((one) => one.name === 'list_agents')
    expect(list?.description).toContain('archived: true lists those instead')
    expect(list?.description).toContain('restore_agent brings it back')
  })
})
