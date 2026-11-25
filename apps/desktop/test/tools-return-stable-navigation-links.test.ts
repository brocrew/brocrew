import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { join } from 'node:path'
import type { AgentToolAnswer } from '@brobot2/runtime'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  agentLink as formattedAgentLink,
  conversationLink,
  pieceLink as formattedPieceLink,
} from '../src/shared/links'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('agent tool replies keep their text without generated navigation links', () => {
  let world: AServiceWorld
  let host: ReturnType<AServiceWorld['aHost']>
  let caller: string
  let worker: string
  let piece: string
  let label: string
  let identity: string
  const title = 'Read ] the notes)'

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('parent', 'normal')
    identity = world.anAgent('helper', 'normal').id
    world.db
      .prepare('UPDATE agent_identity SET display_name = ? WHERE id = ?')
      .run('Ada ] Newton)', identity)
    host = world.aHost()
    caller = await world.aPersonOpens(host, 'parent')
    const given = await world.gives(host, caller, 'helper', { title })
    if (!given.ok) throw new Error('fictional give refused')
    worker = given.owner
    piece = given.piece
    label = given.label
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  async function call(
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<AgentToolAnswer> {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`missing ${name}`)
    const result = await tool.call(args)
    expect(result.structured?.['outcome'], result.text).not.toBe('refused')
    return result
  }
  for (const name of [
    'list_tasks',
    'list_agents',
    'get_agent_status',
    'list_profiles',
    'search_work',
    'find_files',
    'give_work',
    'take_on_work',
  ] as const) {
    it(`${name} keeps its reply without generated links or changes to the work record`, async () => {
      let result: AgentToolAnswer
      if (name === 'list_tasks') result = await call(name, { piece })
      else if (name === 'list_agents') result = await call(name)
      else if (name === 'get_agent_status') result = await call(name, { agent: worker })
      else if (name === 'list_profiles') {
        result = await call(name)
      } else if (name === 'search_work') {
        vi.spyOn(host, 'searchWork').mockResolvedValue({
          ok: true,
          page: {
            hits: [
              {
                conversation: worker,
                address: label,
                title,
                line: `conversation ${label} · ${title}`,
                profile: 'helper',
                last_active_at: 1,
                status: null,
                tasks_omitted: 0,
                matched_tasks: [
                  {
                    kind: 'piece',
                    piece,
                    label,
                    title,
                    state: 'working',
                    owner: { conversation: worker, name: 'Ada ] Newton)', profile: 'helper' },
                    giver: null,
                    result: null,
                    status: null,
                    resource_ids: { brief: [], result: [], attachments: [], working: [] },
                    clipped: { title: false, result: false, status: false },
                    resources_omitted: 0,
                    given_at: 1,
                  },
                ],
              },
            ],
            searched: 1,
            rows_unread: 0,
            ledgers_skipped: 0,
            complete: true,
            next_cursor: null,
          },
        })
        result = await call(name, {})
      } else if (name === 'find_files') {
        const path = join(world.folder, 'notes.md')
        writeFileSync(path, '# Notes\nFictional evidence.')
        await call('update_work', { piece, resources: [path] })
        result = await call(name)
      } else if (name === 'give_work') {
        result = await call(name, {
          to: label,
          profile: 'helper',
          title,
          brief: 'Read the notes.',
          definition_of_done: 'Notes are read.',
        })
      } else {
        await host.send(caller, 'Please collect the notes.', world.window)
        result = await call(name, {
          title,
          brief: 'Collect the notes.',
          definition_of_done: 'Notes are collected.',
        })
      }
      expect(result.text).not.toContain('brocrew://')
      expect(JSON.stringify([...world.ledger(caller), ...world.ledger(worker)])).not.toContain(
        'brocrew://',
      )
    })
  }

  it('keeps task addresses without appending generated links', async () => {
    const result = await call('list_tasks', { piece })
    expect(result.text).toContain(label)
    expect(result.text).toContain(title)
    expect(result.text).not.toContain('brocrew://')
  })

  it('keeps authored web, app and resource links in the reply text', async () => {
    const authored =
      '[Guide](https://example.test/guide) [Earlier notes](brocrew://piece/fictional_notes) [Report](res_fictional_report)'
    const path = join(world.folder, 'linked-notes.md')
    writeFileSync(path, authored)
    const kept = await call('update_work', { piece, resources: [path] })
    const resource = (kept.structured?.['resources'] as { resource: string }[])[0]!.resource
    const result = await call('read_document', { resource })
    expect(result.text).toContain(authored)
    await call('update_work', { piece, title: authored })
    expect((await call('list_tasks', { piece })).text).toContain(authored)
  })

  it('profiles name stable identities even after the agent is renamed', async () => {
    const before = await call('list_profiles')
    expect(before.text).toContain('Ada ] Newton)')
    expect(before.text).not.toContain('brocrew://')
    world.db
      .prepare('UPDATE agent_identity SET display_name = ? WHERE id = ?')
      .run('Renamed', identity)
    const after = await call('list_profiles', { profile: 'helper' })
    expect(after.text).toContain('Renamed')
    expect(after.text).not.toContain('brocrew://')
  })

  it('tool descriptions omit navigation advertising while the person can still move a request', () => {
    const tools = agentToolsFor(host, caller).tools
    for (const name of [
      'give_work',
      'list_tasks',
      'search_work',
      'list_profiles',
      'list_agents',
      'get_agent_status',
      'find_files',
      'take_on_work',
      'ask_question',
    ]) {
      const tool = tools.find((one) => one.name === name)
      expect(tool?.description).not.toContain('Use the returned navigation links')
    }
    const offer = tools.find((one) => one.name === 'ask_question')?.input['move_to']
    expect(offer === undefined ? undefined : z.globalRegistry.get(offer)?.description).toContain(
      "Reuse relevant work here; offer move_to when continuing there helps. Only the person's press moves the request.",
    )
  })

  it('bounds link labels before escaping and encodes IDs, without cancelling an escape', () => {
    expect(formattedAgentLink('aid:odd/name)', 'A\\]B)')).toBe(
      '[A\\\\\\]B\\)](brocrew://agent/aid%3Aodd%2Fname%29)',
    )
    expect(conversationLink('sess_1', 'x'.repeat(121))).toBe(
      `[${'x'.repeat(120)}](brocrew://conversation/sess_1)`,
    )
    expect(conversationLink('sess_1', '😀'.repeat(121))).toBe(
      `[${'😀'.repeat(120)}](brocrew://conversation/sess_1)`,
    )
    expect(formattedPieceLink('piece_1', 'W12.34', 'x'.repeat(121))).toBe(
      `[W12.34 · ${'x'.repeat(120)}](brocrew://piece/piece_1)`,
    )
  })

  it('a refusal naming an existing agent has no generated links', async () => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === 'give_work')!
    const result = await tool.call({
      profile: 'helper',
      title,
      brief: 'Read notes.',
      definition_of_done: 'Notes read.',
    })
    expect(result.structured).toMatchObject({ outcome: 'refused', rail: 'name-the-conversation' })
    expect(result.text).not.toContain('brocrew://')
    expect(JSON.stringify(world.ledger(caller))).not.toContain('brocrew://')
  })

  it('an unknown refused target has no invented link or durable navigation text', async () => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === 'get_agent_status')!
    const result = await tool.call({ agent: 'fictional_missing' })
    expect(result.structured?.['outcome']).toBe('refused')
    expect(result.text).not.toContain('brocrew://')
    expect(JSON.stringify(world.ledger(caller))).not.toContain('brocrew://')
  })
})
