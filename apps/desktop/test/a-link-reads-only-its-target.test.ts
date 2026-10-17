import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { rowsUnreadOnce, type RowsUnread } from '../src/main/db/session-store'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'
import { agentStateWords, type AgentState } from '../src/shared/agent-state'
import {
  parseLinkTarget,
  unavailableLink,
  deletedLink,
  linkKindOf,
  type LinkResolution,
} from '../src/shared/link-resolution'
import { openDatabase } from '../src/main/db/connection'
import { join } from 'node:path'
import { pieceNumbersOf } from '../src/shared/piece-called'

// The rail's full card inputs remain the comparison oracle; only the link path is narrowed.
type FullCard = {
  cardReads(): unknown
  stateOf(id: string, reads: unknown, unread: RowsUnread): AgentState
  workThatNames(id: string, unread: RowsUnread): { title: string } | null
  archived: { has(id: string): boolean }
}
function fullRead(world: AServiceWorld, host: RuntimeHost, target: string): LinkResolution {
  const parsed = parseLinkTarget(target)
  if (parsed === null) return unavailableLink(linkKindOf(target))
  if (parsed.kind === 'agent') {
    const identity = world.store.agentIdentities().find((one) => one.id === parsed.id)
    return identity === undefined
      ? deletedLink('agent')
      : {
          state: 'available',
          kind: 'agent',
          title: Array.from(identity.displayName ?? identity.slug)
            .slice(0, 120)
            .join(''),
          status: null,
          opens: { identityId: identity.id },
        }
  }
  if (parsed.kind === 'piece' && 'label' in parsed && pieceNumbersOf(parsed.label) === null)
    return unavailableLink('piece')
  const piece =
    parsed.kind === 'piece'
      ? 'label' in parsed
        ? world.store.workByLabel(parsed.label)
        : world.store.workById(parsed.id)
      : null
  if (parsed.kind === 'piece' && piece === null) return deletedLink('piece')
  const id = parsed.kind === 'conversation' ? parsed.id : piece!.owner
  if (world.store.recordedOne(id) === null)
    return parsed.kind === 'conversation' ? deletedLink(parsed.kind) : unavailableLink(parsed.kind)
  const full = host as unknown as FullCard
  const unread = rowsUnreadOnce()
  const state = full.stateOf(id, full.cardReads(), unread)
  const named = full.workThatNames(id, unread)
  if (unread.count || unread.ledgersSkipped) return unavailableLink(parsed.kind)
  return {
    state: full.archived.has(id) ? 'archived' : 'available',
    kind: parsed.kind,
    title: Array.from(named?.title ?? host.whatToCallTheConversation(id))
      .slice(0, 120)
      .join(''),
    status: agentStateWords(state),
    opens: { sessionId: id },
  }
}
const link = (id: string) => `brocrew://conversation/${encodeURIComponent(id)}`

describe('a link reads only its target', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let sample: ReturnType<typeof windowWriterSampler>
  beforeEach(() => {
    world = aServiceWorld()
    world.anAgent('fictional', 'normal')
    world.anAgent('helper', 'normal')
    world.anAgent('service')
    sample = windowWriterSampler(world.db, () => world.store.canReadFreshSnapshot?.() === true)
    host = world.aHost({
      windowWriterStamp: sample,
      limitsWriterStamp: limitsWriterSampler(
        world.db,
        () => world.store.canReadFreshSnapshot?.() === true,
      ),
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })
  function create(id: string) {
    world.store.create({
      id,
      provider: 'claude',
      cwd: world.folder,
      approvalMode: 'ask',
      profileId: 'fictional',
    })
    return world.store.rootOf(id)!
  }
  function append(id: string, event: Parameters<typeof world.store.append>[2]) {
    world.store.append(id, world.store.nextOrdinal(id), event, world.clock++)
  }

  it('equals the full read for each kind, archived history, absent targets and target instruction states', async () => {
    const root = create('fictional-card')
    host.retitleForAPerson(root.piece, 'Fictional plan')
    const targets = [
      link('fictional-card'),
      `brocrew://piece/${root.piece}`,
      root.label,
      'brocrew://agent/aid%3Afictional',
      link('absent'),
      'brocrew://piece/absent',
      'brocrew://agent/aid%3Aabsent',
      'W999',
      'W9007199254740992',
      'W1.9007199254740992',
      'brocrew://agent/%',
      'not a target',
    ]
    for (const phase of ['idle', 'needs you', 'archived', 'restored'] as const) {
      if (phase === 'needs you')
        append('fictional-card', {
          type: 'instruction_proposed',
          askId: 'fictional-ask',
          ask: 'propose',
          about: 'fictional',
          proposedBy: 'fictional',
          text: 'A fictional rule.',
          why: 'A fictional reason.',
        })
      if (phase === 'archived')
        expect((await host.archiveConversation('fictional-card')).done).toBe(true)
      if (phase === 'restored') expect(host.restoreConversation('fictional-card').done).toBe(true)
      const expected = targets.map((target) => fullRead(world, host, target))
      expect(expected[0]).toMatchObject({
        title: 'Fictional plan',
        state: phase === 'archived' ? 'archived' : 'available',
        status: phase === 'idle' ? 'idle' : 'needs you',
      })
      const roster = vi.spyOn(world.store, 'agentIdentities').mockImplementation(() => {
        throw new Error('whole roster')
      })
      const asks = vi.spyOn(world.store, 'instructionAsksWaiting').mockImplementation(() => {
        throw new Error('all asks')
      })
      expect(targets.map((target) => host.resolveLink(target))).toEqual(expected)
      expect(targets.map((target) => host.resolveLink(target))).toEqual(expected)
      expect(roster).not.toHaveBeenCalled()
      expect(asks).not.toHaveBeenCalled()
      roster.mockRestore()
      asks.mockRestore()
    }
  })

  it('keeps related holder names and service fallback names equal to the full state without a roster', async () => {
    const giver = await world.aPersonOpens(host, 'fictional')
    const given = await world.gives(host, giver, 'helper')
    expect(given.ok).toBe(true)
    const serving = await world.gives(host, giver, 'service')
    expect(serving.ok).toBe(true)
    if (!given.ok || !serving.ok) throw new Error('fictional give failed')
    host.setAgentDisplayName('helper', 'Fictional helper')
    host.setAgentDisplayName('service', 'Fictional service')
    const targets = [link(giver), link(given.owner), serving.label]
    const expected = targets.map((target) => fullRead(world, host, target))
    expect(expected[2]?.title).toBe('Fictional service')
    expect(expected[0]?.status).toContain('Fictional helper')
    const roster = vi.spyOn(world.store, 'agentIdentities').mockImplementation(() => {
      throw new Error('whole roster')
    })
    expect(targets.map((target) => host.resolveLink(target))).toEqual(expected)
    expect(roster).not.toHaveBeenCalled()
  })

  it('refreshes titles, identity names and settled instructions even when the routing revision stays put', () => {
    const root = create('fictional-card')
    host.resolveLink(link('fictional-card'))
    const before = sample({ kind: 'routes' })!
    host.retitleForAPerson(root.piece, 'Renamed plan')
    expect(sample({ kind: 'routes' })!.revision).toBe(before.revision)
    expect(host.resolveLink(link('fictional-card')).title).toBe('Renamed plan')
    expect(host.resolveLink('brocrew://agent/aid%3Afictional').title).toBe('Ada')
    host.setAgentDisplayName('fictional', 'Fictional adviser')
    expect(sample({ kind: 'routes' })!.revision).toBe(before.revision)
    expect(host.resolveLink('brocrew://agent/aid%3Afictional').title).toBe('Fictional adviser')
    append('fictional-card', {
      type: 'instruction_proposed',
      askId: 'new-rule',
      ask: 'propose',
      about: 'fictional',
      proposedBy: 'fictional',
      text: 'A rule.',
      why: 'A reason.',
    })
    expect(host.resolveLink(link('fictional-card')).status).toBe('needs you')
    append('fictional-card', { type: 'instruction_settled', askId: 'new-rule', ending: 'refused' })
    expect(sample({ kind: 'routes' })!.revision).toBe(before.revision)
    expect(host.resolveLink(link('fictional-card')).status).toBe('idle')
  })

  it('reuses a target with no store read, and refreshes unknown targets after creation', () => {
    const read = vi.spyOn(world.store, 'recordedOne')
    expect(host.resolveLink(link('fictional-card')).state).toBe('deleted')
    const count = read.mock.calls.length
    host.resolveLink(link('fictional-card'))
    expect(read).toHaveBeenCalledTimes(count)
    create('fictional-card')
    expect(host.resolveLink(link('fictional-card')).state).toBe('available')
    const after = read.mock.calls.length
    host.resolveLink(link('fictional-card'))
    expect(read).toHaveBeenCalledTimes(after)
  })

  it('does not reuse or publish speculative transaction answers, including after rollback', () => {
    const root = create('fictional-card')
    host.retitleForAPerson(root.piece, 'Committed plan')
    expect(host.resolveLink(link('fictional-card')).title).toBe('Committed plan')
    expect(() =>
      world.store.atomically(() => {
        host.retitleForAPerson(root.piece, 'Speculative plan')
        expect(host.resolveLink(link('fictional-card')).title).toBe('Speculative plan')
        throw new Error('rollback')
      }),
    ).toThrow('rollback')
    expect(host.resolveLink(link('fictional-card')).title).toBe('Committed plan')
  })

  it('invalidates on external writers and on runtime-only state changes', () => {
    create('fictional-card')
    host.resolveLink('brocrew://agent/aid%3Afictional')
    const other = openDatabase(join(world.folder, 'brobot2.sqlite'))
    try {
      other
        .prepare('UPDATE agent_identity SET display_name = ? WHERE id = ?')
        .run('Externally named', 'aid:fictional')
    } finally {
      other.close()
    }
    expect(host.resolveLink('brocrew://agent/aid%3Afictional').title).toBe('Externally named')
    const target = link('fictional-card')
    expect(host.resolveLink(target).status).toBe('idle')
    const internals = host as unknown as {
      startsInFlight: Map<string, Promise<string>>
      stateMayHaveMoved(id: string): void
    }
    internals.startsInFlight.set('fictional-card', Promise.resolve('fictional-card'))
    internals.stateMayHaveMoved('fictional-card')
    expect(host.resolveLink(target).status).toBe('active')
    internals.startsInFlight.delete('fictional-card')
    internals.stateMayHaveMoved('fictional-card')
    expect(host.resolveLink(target).status).toBe('idle')
  })

  it('drops a temporary unavailable answer when a failed archive finishes setting the conversation aside', async () => {
    create('fictional-card')
    const target = link('fictional-card')
    expect(host.resolveLink(target).state).toBe('available')
    const internals = host as unknown as { stopTheTree(ids: readonly string[]): Promise<void> }
    const stop = vi
      .spyOn(internals, 'stopTheTree')
      .mockRejectedValue(new Error('fictional stop failed'))
    const archiving = host.archiveConversation('fictional-card')
    expect(host.resolveLink(target).state).toBe('unavailable')
    await expect(archiving).rejects.toThrow('fictional stop failed')
    stop.mockRestore()
    expect(host.resolveLink(target)).toEqual(fullRead(world, host, target))
    expect(host.resolveLink(target).state).toBe('archived')
  })

  it('uses indexed identity and per-conversation instruction probes', () => {
    const identity = world.db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id, slug, display_name AS displayName FROM agent_identity WHERE id = ?',
      )
      .all('aid:fictional')
    const asks = world.db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT session_id AS conversation, created_at AS at, ordinal, json_valid(payload) AS readable, payload FROM events WHERE session_id = ? AND type IN ('instruction_proposed', 'instruction_settled') ORDER BY created_at, ordinal`,
      )
      .all('fictional-card')
    expect(JSON.stringify(identity)).toMatch(/SEARCH agent_identity USING INDEX/)
    expect(JSON.stringify(asks)).toMatch(/SEARCH events USING INDEX/)
    expect(world.store.agentIdentityNameById('fictional')).toBeNull()
    expect(world.store.agentIdentityNameById('aid:fictional')).toEqual({
      id: 'aid:fictional',
      slug: 'fictional',
      displayName: 'Ada',
    })
  })
})
