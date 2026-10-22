import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * A helper's work stays in the tree it was given in.
 *
 * A helper gets a root of its own only when a person asks it for new work while it holds nothing
 * anyone gave it. Once it has one, neither a give nor a person's request that names no piece hangs
 * under that root while the helper holds a piece someone gave it: it goes under that piece, or the
 * call is refused, naming the pieces to choose from.
 */

const request = {
  title: 'Fictional request',
  brief: 'Read the fictional input.',
  definition_of_done: 'The result and its check are recorded.',
}

describe('a helper’s work stays in the tree it was given in', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  beforeEach(() => {
    world = aServiceWorld()
    world.anAgent('giver', 'normal')
    world.anAgent('helper', 'normal')
    world.anAgent('third', 'normal')
    host = world.aHost()
  })
  afterEach(async () => {
    settled.clear()
    await world.cleanUp()
    vi.restoreAllMocks()
  })
  const call = async (conversation: string, name: string, args: Record<string, unknown>) =>
    (await agentToolsFor(host, conversation)
      .tools.find((one) => one.name === name)!
      .call(args)) as { structured: Record<string, unknown>; text: string }
  const labelsOf = (conversation: string) =>
    world.store.piecesOwnedBy(conversation).map((one) => one.label)
  /** The fake provider holds each turn at a permission card; settling it ends the turn. */
  const settled = new Set<string>()
  const endTheTurn = async (conversation: string) => {
    let pending: string | undefined
    await vi.waitFor(() => {
      const card = world
        .ledger(conversation)
        .filter((one) => one.type === 'permission_request')
        .map((one) => (one.type === 'permission_request' ? one.id : ''))
        .at(-1)
      expect(card !== undefined && !settled.has(card)).toBe(true)
      pending = card
    })
    settled.add(pending!)
    await host.respondPermission(conversation, pending!, { outcome: 'deny' }, world.window)
    await vi.waitFor(() => {
      expect(['working', 'waiting_permission']).not.toContain(world.handleOf('helper').status())
    })
  }
  /**
   * The giver gives the helper a piece, which reaches it; the helper marks it waiting until later,
   * so no reminder follows, and its turn on it ends.
   */
  const aPieceReachesIt = async (giver: string, helper: string, title: string) => {
    const given = await world.gives(host, giver, 'helper', { title })
    expect(given).toMatchObject({ ok: true, owner: helper, delivery: 'sent' })
    if (!given.ok) throw new Error('fictional give failed')
    const waits = await call(helper, 'update_work', {
      piece: given.label,
      status: 'Starts later.',
      on: { time: new Date(world.clock + 3_600_000).toISOString() },
    })
    expect(waits.structured).toMatchObject({ outcome: 'ok' })
    await endTheTurn(helper)
  }

  /**
   * The giver's helper, which finished the one piece it was given, then took on a person's request
   * while it held nothing and finished that too: it owns a root of its own, W2, and holds nothing.
   */
  const aHelperWithItsOwnRoot = async (): Promise<{ giver: string; helper: string }> => {
    const giver = await world.aPersonOpens(host, 'giver')
    const first = await world.gives(host, giver, 'helper')
    if (!first.ok) throw new Error('fictional give failed')
    const helper = first.owner
    await call(helper, 'reply_to_parent', { piece: first.label, outcome: 'done', summary: 'Done.' })
    host.claimSession(helper, world.window)
    await host.sendInterrupting(helper, 'Please take on this new request.', world.window)
    const taken = await call(helper, 'take_on_work', request)
    expect(taken.structured).toMatchObject({ outcome: 'ok', label: 'W2.1', under: 'W2' })
    await call(helper, 'reply_to_parent', { piece: 'W2.1', outcome: 'done', summary: 'Done.' })
    expect(world.store.rootOf(helper)?.label).toBe('W2')
    return { giver, helper }
  }

  describe('give_work', () => {
    it('never hangs under the helper’s own root while it holds a piece someone gave it', async () => {
      const { giver, helper } = await aHelperWithItsOwnRoot()
      // ⚑ The helper is still in its turn, so the new brief waits for it.
      const second = await world.gives(host, giver, 'helper', { title: 'Second piece' })
      expect(second).toMatchObject({ ok: true, label: 'W1.2', owner: helper, delivery: 'held' })
      const before = labelsOf(helper)
      const given = await call(helper, 'give_work', { ...request, profile: 'third' })
      expect(given.structured).toMatchObject({
        outcome: 'refused',
        rail: 'name-the-piece-you-give-from',
        reason: 'Say which of your pieces this is for (W1.2): give again naming it as piece.',
        detail: { held: ['W1.2'] },
      })
      expect(labelsOf(helper)).toEqual(before)
      expect(world.store.piecesOwnedBy(helper).some((one) => one.label.startsWith('W2.2'))).toBe(
        false,
      )
    })

    it('still hangs under its own root while it holds nothing', async () => {
      const { helper } = await aHelperWithItsOwnRoot()
      const given = await call(helper, 'give_work', { ...request, profile: 'third' })
      expect(given.structured).toMatchObject({ outcome: 'ok', label: 'W2.2' })
    })
  })

  describe('take_on_work', () => {
    it('hangs a person’s request under the one piece someone gave the helper, not its own root', async () => {
      const { giver, helper } = await aHelperWithItsOwnRoot()
      await endTheTurn(helper)
      await aPieceReachesIt(giver, helper, 'Second piece')
      await host.sendInterrupting(helper, 'Please also take this on.', world.window)
      const taken = await call(helper, 'take_on_work', request)
      expect(taken.structured).toMatchObject({ outcome: 'ok', label: 'W1.2.1', under: 'W1.2' })
    })

    it('refuses, naming the pieces, when the helper holds several someone gave it', async () => {
      const { giver, helper } = await aHelperWithItsOwnRoot()
      await endTheTurn(helper)
      await aPieceReachesIt(giver, helper, 'Second piece')
      await aPieceReachesIt(giver, helper, 'Third piece')
      await host.sendInterrupting(helper, 'Please also take this on.', world.window)
      const before = labelsOf(helper)
      const taken = await call(helper, 'take_on_work', request)
      expect(taken.structured).toMatchObject({
        outcome: 'refused',
        rail: 'malformed-request',
        detail: {
          problems: ['Say which of your pieces this is for (W1.2 and W1.3): name it in piece.'],
        },
      })
      expect(labelsOf(helper)).toEqual(before)
    })
  })
})
