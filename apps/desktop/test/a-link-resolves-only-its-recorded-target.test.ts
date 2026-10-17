import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, RecordingSink, type AServiceWorld } from './helpers/a-service-world'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { agentStateWords } from '../src/shared/agent-state'
import { parseLinkTarget } from '../src/shared/link-resolution'
import { conversationLink as formatConversationLink } from '../src/shared/links'

const conversationLink = (id: string) => `brocrew://conversation/${encodeURIComponent(id)}`
const pieceLink = (id: string) => `brocrew://piece/${encodeURIComponent(id)}`
const agentLink = (id: string) => `brocrew://agent/${encodeURIComponent(id)}`
const missing = (kind = 'conversation') => ({
  state: 'unavailable',
  kind,
  title: null,
  status: null,
  opens: null,
})

const deleted = (kind = 'conversation') => ({ ...missing(kind), state: 'deleted' })

describe('a link resolves only its recorded target', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let conversation: string
  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('planner', 'normal')
    world.anAgent('service')
    host = world.aHost()
    conversation = await world.aPersonOpens(host, 'planner')
    await host.send(conversation, 'Plan the fictional trip.', world.window)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  it('reads the rail title and state without sending, writing, or claiming the conversation', async () => {
    const root = world.store.rootOf(conversation)!
    expect(host.retitleForAPerson(root.piece, 'Trip planning')).toMatchObject({ ok: true })
    const before = world.db.prepare('SELECT total_changes() AS n').get()
    const sent = world.sent.length
    const started = world.startedAs.length
    const rail = [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === conversation,
    )!
    expect(rail.named?.title).toBe('Trip planning')
    const throughWorker = vi.spyOn(host, 'readForWindow')
    const resolve = vi.spyOn(host, 'resolveLink')
    const stranger = new RecordingSink('webContents:unrelated')
    const answer = await executeRuntimeCommand(host, stranger, {
      kind: 'resolveLink',
      target: conversationLink(conversation),
    })
    expect(answer).toEqual({
      state: 'available',
      kind: 'conversation',
      title: 'Trip planning',
      status: agentStateWords(rail.state),
      opens: { sessionId: conversation },
    })
    expect(throughWorker).not.toHaveBeenCalled()
    expect(resolve).toHaveBeenCalledExactlyOnceWith(conversationLink(conversation))
    expect(world.db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
    expect(world.sent).toHaveLength(sent)
    expect(world.startedAs).toHaveLength(started)
    expect(stranger.messages).toHaveLength(0)
  })

  it('keeps conversation, piece and label links stable after the piece is renamed', () => {
    const root = world.store.rootOf(conversation)!
    const targets = [conversationLink(conversation), pieceLink(root.piece), root.label]
    for (const title of ['Old trip title', 'The new trip title']) {
      expect(host.retitleForAPerson(root.piece, title)).toMatchObject({ ok: true })
      for (const [index, target] of targets.entries()) {
        expect(host.resolveLink(target)).toEqual({
          state: 'available',
          kind: index === 0 ? 'conversation' : 'piece',
          title,
          status: 'needs you',
          opens: { sessionId: conversation },
        })
      }
    }
    expect(host.resolveLink('Old trip title')).toEqual(missing())
  })

  it('uses an agent identity ID, never its slug or display name, and survives a rename', () => {
    const identity = world.store.agentIdentities().find((one) => one.slug === 'planner')!
    expect(identity.id).not.toBe('planner')
    for (const title of ['Planner', 'Travel adviser']) {
      expect(host.setAgentDisplayName('planner', title)?.displayName).toBe(title)
      expect(host.resolveLink(agentLink(identity.id))).toEqual({
        state: 'available',
        kind: 'agent',
        title,
        status: null,
        opens: { identityId: identity.id },
      })
      expect(host.resolveLink(agentLink('planner'))).toEqual(deleted('agent'))
      expect(host.resolveLink(agentLink(title))).toEqual(deleted('agent'))
    }
    world.anAgent('removed', 'nothing kept')
    const removed = world.store.agentIdentities().find((one) => one.slug === 'removed')!
    expect(world.store.removeAgentIdentity('removed')).toBe(true)
    expect(host.resolveLink(agentLink(removed.id))).toEqual(deleted('agent'))
  })

  it('returns archived history for a conversation and its work without reopening it', async () => {
    const root = world.store.rootOf(conversation)!
    expect(host.retitleForAPerson(root.piece, 'Saved trip')).toMatchObject({ ok: true })
    expect((await host.archiveConversation(conversation)).done).toBe(true)
    const before = world.db.prepare('SELECT total_changes() AS n').get()
    const starts = world.startedAs.length
    for (const target of [conversationLink(conversation), pieceLink(root.piece), root.label]) {
      expect(host.resolveLink(target)).toMatchObject({
        state: 'archived',
        title: 'Saved trip',
        opens: { sessionId: conversation },
      })
    }
    expect(world.startedAs).toHaveLength(starts)
    expect(world.db.prepare('SELECT total_changes() AS n').get()).toEqual(before)
  })

  it('returns no metadata or guessed opening for unknown and removed targets', async () => {
    for (const [target, kind] of [
      [conversationLink('missing'), 'conversation'],
      [agentLink('aid:missing'), 'agent'],
      [pieceLink('missing'), 'piece'],
      ['W999.999', 'piece'],
    ])
      expect(host.resolveLink(target!)).toEqual(deleted(kind))
    const root = world.store.rootOf(conversation)!
    expect((await host.deleteConversation(conversation, ['records'])).done).toBe(true)
    expect(host.resolveLink(conversationLink(conversation))).toEqual(deleted())
    expect(host.resolveLink(pieceLink(root.piece))).toEqual(deleted('piece'))
    expect(host.resolveLink(root.label)).toEqual(deleted('piece'))
  })

  it('keeps setting-aside unavailable even after its record is gone', () => {
    const internals = host as unknown as { settingAside: Map<string, 'archive' | 'delete'> }
    internals.settingAside.set('missing', 'delete')
    expect(host.resolveLink(conversationLink('missing'))).toEqual(missing())
    internals.settingAside.delete('missing')
    expect(host.resolveLink(conversationLink('missing'))).toEqual(deleted())
  })

  it.each([
    ['conversation', 'recordedOne'],
    ['agent', 'agentIdentityNameById'],
    ['piece', 'workById'],
  ] as const)('a failed %s existence read is unavailable, never deleted', (kind, method) => {
    vi.spyOn(world.store, method).mockImplementation(() => {
      throw new Error('fictional unread record')
    })
    expect(host.resolveLink(`brocrew://${kind}/missing`)).toEqual(missing(kind))
  })

  it.each(['W9007199254740992', 'W1.9007199254740992'])(
    'keeps an invalid numeric label %s unavailable without a piece lookup',
    (target) => {
      const lookup = vi.spyOn(world.store, 'workByLabel')
      expect(host.resolveLink(target)).toEqual(missing('piece'))
      expect(lookup).not.toHaveBeenCalled()
    },
  )

  it('does not call an existing piece deleted when only its holder record is missing', () => {
    const root = world.store.rootOf(conversation)!
    vi.spyOn(world.store, 'recordedOne').mockReturnValue(null)
    expect(host.resolveLink(pieceLink(root.piece))).toEqual(missing('piece'))
  })

  it('does not turn a failed canonical read into an available target', () => {
    vi.spyOn(world.store, 'workThatNames').mockImplementation(() => {
      throw new Error('unread')
    })
    expect(host.resolveLink(conversationLink(conversation))).toEqual(missing())
  })

  it('keeps a closed piece linked to its recorded holder', async () => {
    world.anAgent('helper', 'normal')
    const given = await world.gives(host, conversation, 'helper', { title: 'Check the train' })
    expect(given.ok).toBe(true)
    if (!given.ok) throw new Error(given.refusal.reason)
    expect(host.resolveLink(given.label)).toMatchObject({
      state: 'available',
      kind: 'piece',
      title: 'Check the train',
      opens: { sessionId: given.owner },
    })
    const closed = await host.updateWork(
      {
        piece: given.piece,
        title: null,
        status: null,
        on: null,
        brief: null,
        close: true,
        resources: [],
      },
      { ownerId: agentCallerId(conversation) },
    )
    expect(closed.ok).toBe(true)
    expect(host.resolveLink(pieceLink(given.piece))).toMatchObject({
      state: 'available',
      kind: 'piece',
      title: 'Check the train',
      opens: { sessionId: given.owner },
    })
  })

  it("names a service as the rail does without exposing one caller's piece as its title", async () => {
    expect(host.setAgentDisplayName('service', 'Station assistant')?.displayName).toBe(
      'Station assistant',
    )
    const given = await world.gives(host, conversation, 'service', {
      title: 'Private caller title',
    })
    expect(given.ok).toBe(true)
    if (!given.ok) throw new Error(given.refusal.reason)
    const rail = [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === given.owner,
    )!
    expect(rail.named).toBeNull()
    expect(host.resolveLink(pieceLink(given.piece))).toMatchObject({
      state: 'available',
      kind: 'piece',
      title: 'Station assistant',
      opens: { sessionId: given.owner },
    })
  })

  it.each([
    '',
    'planner',
    'w1',
    'W01',
    'W1.0',
    ' W1',
    'W1 ',
    'brocrew://conversation/',
    'https://conversation/x',
    'brocrew://other/x',
    'brocrew://conversation/x/y',
    'brocrew://conversation/x?query',
    'brocrew://conversation/x#fragment',
    'brocrew://conversation/%',
    'brocrew://conversation/%2F',
    'brocrew://agent/aid%3Ax%5Cy',
    'brocrew://piece/%00',
  ])('leaves malformed target %j unavailable', (target) => {
    expect(parseLinkTarget(target)).toBeNull()
    const kind = target.startsWith('brocrew://agent/')
      ? 'agent'
      : target.startsWith('brocrew://piece/')
        ? 'piece'
        : 'conversation'
    expect(host.resolveLink(target)).toEqual(missing(kind))
  })

  it.each(['agent', 'piece', 'conversation'] as const)(
    'keeps the parsed %s kind when its ID is empty, invalid or too long',
    (kind) => {
      for (const id of [
        '',
        '%',
        '%2F',
        '%00',
        '%1F',
        '%7F',
        'x'.repeat(513),
        'bad/path',
        'id?query',
        'id#fragment',
      ]) {
        expect(host.resolveLink(`brocrew://${kind}/${id}`)).toEqual(missing(kind))
      }
    },
  )

  it('decodes the ID once and keeps the bridge payload bounded', () => {
    expect(parseLinkTarget('brocrew://agent/aid%3Aplanner')).toEqual({
      kind: 'agent',
      id: 'aid:planner',
    })
    expect(parseLinkTarget('brocrew://piece/id%252Fpart')).toEqual({
      kind: 'piece',
      id: 'id%2Fpart',
    })
    expect(runtimeCommandSchema.safeParse({ kind: 'resolveLink', target: 'W1' }).success).toBe(true)
    expect(
      runtimeCommandSchema.safeParse({ kind: 'resolveLink', target: 'x'.repeat(4097) }).success,
    ).toBe(false)
    expect(host.resolveLink('x'.repeat(4097))).toEqual(missing())
  })

  it('bounds a resolved title at 120 whole characters', () => {
    const root = world.store.rootOf(conversation)!
    const title = `${'🚆'.repeat(120)}tail`
    expect(host.retitleForAPerson(root.piece, title)).toMatchObject({ ok: true })
    expect(host.resolveLink(conversationLink(conversation)).title).toBe('🚆'.repeat(120))
  })

  it('formats and resolves a recorded ID containing a closing parenthesis round-trip', () => {
    const id = "session)!'*("
    world.store.create({
      id,
      provider: 'claude',
      cwd: world.folder,
      approvalMode: 'ask',
      profileId: 'planner',
    })
    const root = world.store.rootOf(id)!
    expect(host.retitleForAPerson(root.piece, 'Punctuated plan')).toMatchObject({ ok: true })
    const markdown = formatConversationLink(id, 'Punctuated plan')
    expect(markdown).toBe('[Punctuated plan](brocrew://conversation/session%29%21%27%2A%28)')
    const target = /^\[[^\]]+\]\(([^)]+)\)$/.exec(markdown)?.[1]
    expect(target).toBe('brocrew://conversation/session%29%21%27%2A%28')
    expect(host.resolveLink(target!)).toEqual({
      state: 'available',
      kind: 'conversation',
      title: 'Punctuated plan',
      status: 'idle',
      opens: { sessionId: id },
    })
  })
})
