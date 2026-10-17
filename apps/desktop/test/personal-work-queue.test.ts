import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

const request = {
  title: 'A separate personal request',
  brief: 'Record the fictional result here.',
  definition_of_done: 'The result is recorded and checked.',
}

describe('personal work joins existing queues and preserves its recorded ownership', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  beforeEach(() => {
    world = aServiceWorld()
    world.anAgent('caller', 'normal')
    world.anAgent('worker', 'normal')
    world.anAgent('service-worker', 'service')
    host = world.aHost()
  })
  afterEach(async () => {
    await world.cleanUp()
    vi.restoreAllMocks()
  })
  const call = (id: string, name: string, args: Record<string, unknown>) =>
    agentToolsFor(host, id)
      .tools.find((tool) => tool.name === name)!
      .call(args)
  const anEndedAssignment = async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const given = await world.gives(host, caller, 'worker')
    if (!given.ok) throw new Error('fictional give failed')
    expect(
      (
        await call(given.owner, 'reply_to_parent', {
          piece: given.label,
          outcome: 'done',
          summary: 'The assignment is done.',
        })
      ).structured,
    ).toMatchObject({ outcome: 'ok' })
    host.claimSession(given.owner, world.window)
    await host.sendInterrupting(given.owner, 'Please take on this personal request.', world.window)
    return { caller, given }
  }

  it('creates a personal root when no owned work remains, without changing the conversation giver', async () => {
    const { caller, given } = await anEndedAssignment()
    expect(world.store.rootOf(given.owner)).toBeNull()
    const yes = await call(given.owner, 'take_on_work', request)
    expect(yes.structured).toMatchObject({ outcome: 'ok', under: 'W2' })
    const root = world.store.rootOf(given.owner)!
    expect(root.label).toBe('W2')
    expect(world.store.workById(String(yes.structured?.piece))).toMatchObject({
      parent: root.piece,
      owner: given.owner,
      givenBy: null,
    })
    expect(world.store.parentOf(given.owner)).toBe(caller)
    expect(
      world.store.piecesOwnedBy(given.owner).find((row) => row.piece === given.piece)?.state,
    ).toBe('answered')
  })

  it('rolls back the new root and numbering with a failed piece write, then admits the real request', async () => {
    const { given } = await anEndedAssignment()
    const record = vi.spyOn(world.store, 'recordGive').mockImplementationOnce(() => {
      throw new Error('fictional personal write failure')
    })
    await expect(host.takeOnWork(request, { ownerId: agentCallerId(given.owner) })).rejects.toThrow(
      'fictional personal write failure',
    )
    expect(world.store.rootOf(given.owner)).toBeNull()
    expect(world.store.piecesOwnedBy(given.owner)).toHaveLength(1)
    expect(world.ledger(given.owner).filter((event) => event.type === 'work_given')).toHaveLength(1)
    record.mockRestore()
    const yes = await call(given.owner, 'take_on_work', request)
    expect(yes.structured).toMatchObject({ outcome: 'ok', label: 'W2.1', under: 'W2' })
  })

  it('keeps the active caller folder while personal work waits, then hands that work over once', async () => {
    const caller = await world.aPersonOpens(host, 'caller')
    const folder = join(world.folder, 'caller-work')
    mkdirSync(folder)
    const given = await world.gives(host, caller, 'service-worker', { folder })
    if (!given.ok) throw new Error('fictional service give failed')
    await vi.waitFor(() => {
      expect(
        world
          .ledger(given.owner)
          .some((event) => event.type === 'user_turn' && event.piece === given.piece),
      ).toBe(true)
    })
    host.claimSession(given.owner, world.window)
    await host.sendInterrupting(
      given.owner,
      'Please take on this separate personal request.',
      world.window,
    )
    const oldFolder = world.store.recordedOne(given.owner)?.cwd
    const created = await call(given.owner, 'take_on_work', request)
    expect(created.structured).toMatchObject({ outcome: 'ok', under: given.label, queued: true })
    const piece = String(created.structured?.piece)
    expect(world.store.recordedOne(given.owner)?.cwd).toBe(oldFolder)
    expect(world.store.workById(given.piece)?.folder).toBe(folder)
    expect(world.store.piecesOwnedBy(given.owner).find((row) => row.piece === piece)?.state).toBe(
      'waiting',
    )
    const revisedCondition = 'The queued personal result has independent checked evidence.'
    const sendsBeforeRevision = world.sent.length
    expect(
      (await call(given.owner, 'update_work', { piece, definition_of_done: revisedCondition }))
        .structured,
    ).toMatchObject({ outcome: 'ok' })
    expect(world.store.piecesOwnedBy(given.owner).find((row) => row.piece === piece)).toMatchObject(
      { state: 'waiting', definitionOfDone: revisedCondition },
    )
    expect(world.sent).toHaveLength(sendsBeforeRevision)
    expect(
      (
        await call(given.owner, 'reply_to_parent', {
          piece: given.label,
          outcome: 'done',
          summary: 'The caller’s assignment is complete.',
        })
      ).structured,
    ).toMatchObject({ outcome: 'ok' })
    const card = world
      .ledger(given.owner)
      .filter((event) => event.type === 'permission_request')
      .at(-1)!
    if (card.type !== 'permission_request') throw new Error('no fictional person card')
    await host.respondPermission(given.owner, card.id, { outcome: 'allow' }, world.window)
    await vi.waitFor(() => {
      expect(world.store.piecesOwnedBy(given.owner).find((row) => row.piece === piece)?.state).toBe(
        'working',
      )
    })
    expect(
      world.store
        .piecesOwnedBy(given.owner)
        .filter((row) => row.state === 'working')
        .map((row) => row.piece),
    ).toEqual([piece])
    const deliveries = world
      .ledger(given.owner)
      .filter((event) => event.type === 'user_turn' && event.piece === piece)
    expect(deliveries).toHaveLength(1)
    expect(
      world.sent.filter(
        (turn) =>
          turn.as === 'service-worker' && turn.words.includes(`Done when: ${revisedCondition}`),
      ),
    ).toHaveLength(1)
  })
})
