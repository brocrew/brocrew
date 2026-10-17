import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { PieceRow } from '../src/shared/tasks'
import type { WorkGivenEvent } from '../src/shared/runtime-ipc'
import { workEdge } from '../src/shared/who-called-whom'
import { workReading } from '../src/renderer/src/lib/work-report'

const requested = {
  title: 'Check the fictional result',
  brief: 'Read the fictional input and record the result.',
  definition_of_done: 'The result is recorded and the named checks pass.',
}

describe('personal work fields and their existing ownership boundaries', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  beforeEach(() => {
    world = aServiceWorld({ holderReminders: 'declined' })
    world.anAgent('caller', 'normal')
    world.anAgent('worker', 'normal')
    host = world.aHost()
  })
  afterEach(async () => {
    await world.cleanUp()
    vi.restoreAllMocks()
  })
  const call = (conversation: string, name: string, args: Record<string, unknown>) =>
    agentToolsFor(host, conversation)
      .tools.find((tool) => tool.name === name)!
      .call(args)
  const person = async () => {
    const id = await world.aPersonOpens(host, 'caller')
    await host.send(id, 'Please take on this fictional request.', world.window)
    return id
  }
  const child = async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const given = await world.gives(host, caller, 'worker')
    if (!given.ok) throw new Error('fictional give failed')
    host.claimSession(given.owner, world.window)
    await host.sendInterrupting(
      given.owner,
      'Please take on a separate personal request.',
      world.window,
    )
    return { caller, given }
  }

  it('distinguishes a complete legacy absence from an unread first condition revision in boards, records and pushes', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const owner = 'fictional-historical-worker'
    world.store.create({
      id: owner,
      provider: 'claude',
      profileId: 'worker',
      cwd: world.folder,
      approvalMode: 'auto',
      parentSessionId: caller,
    })
    const parent = world.store.rootOf(caller)!
    const number = world.store.numberUnder(parent.piece)
    const piece = 'fictional-legacy-piece'
    const event: WorkGivenEvent = {
      type: 'work_given',
      piece,
      parent: parent.piece,
      label: `${parent.label}.${number}`,
      givenBy: caller,
      title: 'Historical work without a condition',
      brief: 'A recorded old brief.',
    }
    world.store.recordGive(
      {
        piece,
        parent: parent.piece,
        number,
        owner,
        givenBy: caller,
        title: event.title,
        brief: event.brief,
        folder: null,
        inputs: [],
      },
      world.store.nextOrdinal(owner),
      event,
      world.clock,
    )
    const held = () =>
      (
        host as unknown as {
          whatItHolds(id: string): readonly PieceRow[]
        }
      )
        .whatItHolds(owner)
        .find((row) => row.piece === piece)!
    const before = host.pieceBoard(owner).hold.find((row) => row.piece === piece)!
    expect(before.definitionOfDone).toBeNull()
    expect(workReading(workEdge(held(), 'worker', 'caller')).definitionOfDone).toBeNull()
    const complete = await call(caller, 'list_tasks', { piece })
    expect(complete.text).toContain('Done when: Not recorded')
    expect(JSON.stringify(complete.structured)).toContain('"definition_of_done":null')
    const ordinal = world.store.nextOrdinal(owner)
    world.store.append(
      owner,
      ordinal,
      {
        type: 'work_rebriefed',
        piece,
        definitionOfDone: 'A first condition is now recorded.',
        by: caller,
      },
      world.clock,
    )
    world.db
      .prepare(
        "UPDATE events SET payload = json_set(payload, '$.definitionOfDone', 17) WHERE session_id = ? AND ordinal = ?",
      )
      .run(owner, ordinal)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const board = host.pieceBoard(owner)
    expect(board.rowsUnread).toBeGreaterThan(0)
    expect(board.hold.find((row) => row.piece === piece)).not.toHaveProperty('definitionOfDone')
    expect(host.pieceBoard(caller).gave.find((row) => row.piece === piece)).not.toHaveProperty(
      'definitionOfDone',
    )
    const record = await call(caller, 'list_tasks', { piece })
    expect(record.structured).toMatchObject({ piece, rows_unread: 1 })
    expect(record.text).not.toContain('Done when:')
    expect(record.text).not.toContain('Not recorded')
    expect(JSON.stringify(record.structured)).not.toContain('definition_of_done')
    const unreadHeld = held()
    expect(unreadHeld).not.toHaveProperty('definitionOfDone')
    expect(workReading(workEdge(unreadHeld, 'worker', 'caller'))).not.toHaveProperty(
      'definitionOfDone',
    )
    expect(
      host.whoCalledWhom(owner).workTakenIn.rows.find((row) => row.piece === piece),
    ).not.toHaveProperty('definitionOfDone')
    world.store.append(
      owner,
      world.store.nextOrdinal(owner),
      {
        type: 'work_rebriefed',
        piece,
        definitionOfDone: 'A later complete condition.',
        by: caller,
      },
      world.clock,
    )
    const stillUnread = host.pieceBoard(owner)
    expect(stillUnread.rowsUnread).toBeGreaterThan(0)
    expect(stillUnread.hold.find((row) => row.piece === piece)).not.toHaveProperty(
      'definitionOfDone',
    )
  })

  it('allows a root condition revision, keeps its brief, and reads the condition through the real record', async () => {
    const caller = await person()
    const root = world.store.rootOf(caller)!
    const before = world.store.workById(root.piece)!
    const updated = await call(caller, 'update_work', {
      piece: root.label,
      definition_of_done: requested.definition_of_done,
    })
    expect(updated.structured).toMatchObject({ outcome: 'ok' })
    expect(world.store.rootDoneCondition(root.piece)).toBe(requested.definition_of_done)
    expect(world.store.workById(root.piece)?.brief).toBe(before.brief)
    const refused = await call(caller, 'update_work', {
      piece: root.label,
      brief: 'Replace the person’s words.',
    })
    expect(refused.structured).toMatchObject({ outcome: 'refused', rail: 'that-is-your-own-work' })
    const record = await call(caller, 'list_tasks', { piece: root.label })
    expect(record.structured).toMatchObject({ outcome: 'ok' })
    expect(record.text).toContain(`Done when: ${requested.definition_of_done}`)
    expect(world.ledger(caller).filter((event) => event.type === 'work_rebriefed')).toEqual([
      expect.objectContaining({
        piece: root.piece,
        definitionOfDone: requested.definition_of_done,
      }),
    ])
  })

  it('preserves state and brief on a condition-only revision, and only the holder rebriefs personal work', async () => {
    const caller = await person()
    const created = await call(caller, 'take_on_work', requested)
    const piece = String(created.structured?.piece)
    const old = world.store.piecesOwnedBy(caller).find((row) => row.piece === piece)!
    const sends = world.sent.length
    const condition = 'A second check confirms the recorded result.'
    expect(
      (await call(caller, 'update_work', { piece, definition_of_done: condition })).structured,
    ).toMatchObject({ outcome: 'ok' })
    const revised = world.store.piecesOwnedBy(caller).find((row) => row.piece === piece)!
    expect(revised).toMatchObject({
      brief: old.brief,
      state: old.state,
      definitionOfDone: condition,
    })
    expect(world.sent).toHaveLength(sends)
    expect(
      (await call(caller, 'update_work', { piece, brief: 'A revised short brief.' })).structured,
    ).toMatchObject({ outcome: 'ok' })
    expect(
      world.store.piecesOwnedBy(caller).find((row) => row.piece === piece)?.definitionOfDone,
    ).toBe(condition)
    expect((await call(caller, 'update_work', { piece, close: true })).structured).toMatchObject({
      outcome: 'refused',
      rail: 'the-giver-briefs-and-closes-a-piece',
    })
    const other = await world.aPersonOpens(host, 'worker')
    expect(
      (await call(other, 'update_work', { piece, brief: 'A foreign revision.' })).structured,
    ).toMatchObject({ outcome: 'refused', rail: 'no-piece-by-that-name' })
  })

  it('refuses a foreign parent before creating work, while an ended owned parent anchors without reopening', async () => {
    const { caller, given } = await child()
    const foreign = world.store.rootOf(caller)!
    const before = world.store.piecesOwnedBy(given.owner).length
    const no = await call(given.owner, 'take_on_work', { ...requested, piece: foreign.label })
    expect(no.structured).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(no.text).toContain('That parent is not work you hold.')
    expect(world.store.piecesOwnedBy(given.owner)).toHaveLength(before)
    expect(
      (
        await call(given.owner, 'reply_to_parent', {
          piece: given.label,
          outcome: 'done',
          summary: 'The fictional assignment is complete.',
        })
      ).structured,
    ).toMatchObject({ outcome: 'ok' })
    const yes = await call(given.owner, 'take_on_work', { ...requested, piece: given.label })
    expect(yes.structured).toMatchObject({ outcome: 'ok', under: given.label })
    expect(
      world.store.piecesOwnedBy(given.owner).find((row) => row.piece === given.piece)?.state,
    ).toBe('answered')
    expect(world.store.piecesOwnedBy(given.owner).at(-1)?.parent).toBe(given.piece)
  })

  it('asks for a parent when two owned briefs have reached it, then uses the explicitly named one', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const first = await world.gives(host, caller, 'worker')
    if (!first.ok) throw new Error('fictional first give failed')
    host.claimSession(first.owner, world.window)
    await vi.waitFor(() => {
      expect(world.ledger(first.owner).some((event) => event.type === 'permission_request')).toBe(
        true,
      )
    })
    const card = world
      .ledger(first.owner)
      .filter((event) => event.type === 'permission_request')
      .at(-1)!
    if (card.type !== 'permission_request') throw new Error('no fictional work card')
    await host.respondPermission(first.owner, card.id, { outcome: 'allow' }, world.window)
    await vi.waitFor(() => {
      expect(
        world.store.piecesOwnedBy(first.owner).find((row) => row.piece === first.piece)?.state,
      ).toBe('stalled')
    })
    const second = await world.gives(host, caller, 'worker', {
      title: 'The second fictional assignment',
    })
    if (!second.ok) throw new Error('fictional second give failed')
    expect(second.owner).toBe(first.owner)
    await vi.waitFor(() => {
      expect(
        world.store.piecesOwnedBy(first.owner).filter((row) => row.briefHandedOver),
      ).toHaveLength(2)
    })
    await host.sendInterrupting(
      first.owner,
      'Please take on this separate personal request.',
      world.window,
    )
    const no = await call(first.owner, 'take_on_work', requested)
    expect(no.structured).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
    expect(no.text).toContain('Your current work is unclear. Name the parent in piece.')
    expect(world.store.piecesOwnedBy(first.owner)).toHaveLength(2)
    const yes = await call(first.owner, 'take_on_work', { ...requested, piece: second.label })
    expect(yes.structured).toMatchObject({ outcome: 'ok', under: second.label })
    expect(world.store.workById(String(yes.structured?.piece))?.parent).toBe(second.piece)
  })

  it('keeps committed personal work when its giver notice cannot be delivered, and its reply stays here', async () => {
    const { caller, given } = await child()
    const push = vi
      .spyOn(host, 'queueMessage')
      .mockRejectedValueOnce(new Error('fictional notice failure'))
    const yes = await call(given.owner, 'take_on_work', requested)
    expect(yes.structured).toMatchObject({ outcome: 'ok', notice: 'not-delivered' })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0]?.[0]).toBe(caller)
    const piece = String(yes.structured?.piece)
    expect(world.store.workById(piece)).toMatchObject({ owner: given.owner, givenBy: null })
    push.mockRestore()
    const before = world.ledger(caller).length
    const replied = await call(given.owner, 'reply_to_parent', {
      piece,
      outcome: 'done',
      summary: 'The personal result is recorded.',
    })
    expect(replied.structured).toMatchObject({ outcome: 'ok', state: 'answered' })
    expect(replied.structured).not.toHaveProperty('delivered')
    expect(replied.text).toContain('tell them here')
    expect(world.ledger(caller)).toHaveLength(before)
  })

  it('an unread current ledger refuses transiently and creates nothing', async () => {
    const { given } = await child()
    const before = world.store.piecesOwnedBy(given.owner).length
    world.db
      .prepare(
        "UPDATE events SET payload = json_set(payload, '$.definitionOfDone', 17) WHERE session_id = ? AND type = 'work_given'",
      )
      .run(given.owner)
    const no = await call(given.owner, 'take_on_work', requested)
    expect(no.structured).toMatchObject({
      outcome: 'refused',
      rail: 'work-record-unavailable',
      retryable: true,
    })
    expect(no.text).toContain('Your current work could not be read. Try again in a moment.')
    expect(
      world.db
        .prepare("SELECT count(*) AS n FROM events WHERE session_id = ? AND type = 'work_given'")
        .get(given.owner),
    ).toEqual({ n: before })
  })

  it('keeps the longer detail as a readable input, and a missing input creates no piece', async () => {
    const caller = await person()
    const cwd = world.store.recordedOne(caller)!.cwd
    const body = '# Detailed fictional input\n\nEvidence for the condition.\n'
    writeFileSync(join(cwd, 'detail.md'), body)
    const no = await call(caller, 'take_on_work', { ...requested, inputs: ['missing-detail.md'] })
    expect(no.structured).toMatchObject({ outcome: 'refused', rail: 'resource-unreadable' })
    expect(world.store.piecesOwnedBy(caller)).toHaveLength(0)
    const yes = await call(caller, 'take_on_work', { ...requested, inputs: ['detail.md'] })
    expect(yes.structured).toMatchObject({
      outcome: 'ok',
      label: `${world.store.rootOf(caller)!.label}.1`,
    })
    const piece = String(yes.structured?.piece)
    const kept = world.store.resourcesOf(piece)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ name: 'detail.md', piece })
    const record = await call(caller, 'list_tasks', { piece })
    expect(record.text).toContain(kept[0]!.resource)
    const read = await call(caller, 'read_document', { resource: kept[0]!.resource })
    expect(read.structured).toMatchObject({ outcome: 'ok' })
    expect(read.text).toContain(body)
  })
})
