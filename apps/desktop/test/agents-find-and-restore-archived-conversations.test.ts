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
  await call(pm, 'create_agent', { profile_slug: 'helper' })
  const gave = await call(pm, 'give_work', {
    definition_of_done: 'The requested result and its checks are recorded.',
    profile: 'helper',
    to: 'new',
    conversation_title: 'Sort the letters',
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

describe('the person’s Restore', () => {
  it('waits for an archive to settle before restoring the conversation', async () => {
    const { helper } = await aGiverAndItsHelper()
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
    try {
      expect(host.restoreConversation(helper)).toEqual({
        done: false,
        refusal: 'This conversation is being archived now. Restore it once that is done.',
      })
    } finally {
      letItClose()
      await archiving
    }
    expect(host.restoreConversation(helper)).toEqual({ done: true, conversations: [helper] })
    expect(agentsIn(await call(helper, 'list_agents', { archived: true }), 'archived')).toEqual([])
  })

  it('keeps archive membership when its write fails and succeeds once writing works', async () => {
    const { pm, helper } = await aGiverAndItsHelper()
    expect(await host.archiveConversation(helper)).toMatchObject({ done: true })
    const kept = host as unknown as { archived: { remove(ids: readonly string[]): void } }
    const remove = kept.archived.remove.bind(kept.archived)
    kept.archived.remove = () => {
      throw new Error('The archived-conversation list could not be saved.')
    }
    try {
      expect(host.restoreConversation(helper)).toEqual({
        done: false,
        refusal: 'The archived-conversation list could not be saved.',
      })
      expect(agentsIn(await call(pm, 'list_agents', { archived: true }), 'archived')).toEqual([
        helper,
      ])
      expect(world.ledger(helper).filter((event) => event.type === 'restored_from_archive')).toEqual(
        [],
      )
    } finally {
      kept.archived.remove = remove
    }
    expect(host.restoreConversation(helper)).toEqual({ done: true, conversations: [helper] })
  })
})

describe('the archive controls offered to agents', () => {
  it('offers archived reads without an explicit restore tool', () => {
    const tools = agentToolsFor(host, 'sess_x').tools
    expect(tools.map((tool) => tool.name)).not.toContain('restore_agent')
    const list = tools.find((tool) => tool.name === 'list_agents')
    expect(list?.description).toContain('archived: true lists archived conversations instead')
    expect(list?.description).toContain('new work given to it brings it back')
  })
})
