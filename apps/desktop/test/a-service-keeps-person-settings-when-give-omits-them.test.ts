import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import {
  aServiceWorld,
  aServiceAndCaller,
  acceptedGive,
  type AServiceWorld,
} from './helpers/a-service-world'

describe('a service keeps omitted person choices and applies explicit Give choices', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  describe.each(['running', 'stopped'] as const)('%s service', (state) => {
    it.each([false, true])('explicit choice %s', async (explicit) => {
      const { host, caller } = await aServiceAndCaller(world, { auto: true })
      expect(
        world.store.setModelChoice('browser-driver', {
          provider: 'claude',
          model: 'fake-claude-a',
          effort: 'medium',
        }),
      ).toBe(true)
      const first = acceptedGive(await world.gives(host, caller, 'browser-driver'))
      await vi.waitFor(() => {
        const row = world.store.piecesOwnedBy(first.owner).find((one) => one.piece === first.piece)
        expect(row?.state).toBe('stalled')
      })
      host.claimSession(first.owner, world.window)
      await host.setSessionSetting(
        first.owner,
        { kind: 'model', model: 'fake-claude-b' },
        world.window,
      )
      expect(world.store.whatItRunsOn(first.owner)).toMatchObject({
        model: 'fake-claude-b',
        reasoningEffort: null,
      })
      const stamp = world.store.whatItRunsOn(first.owner)?.aPersonChoseItAt
      expect(stamp).toEqual(expect.any(Number))
      const tool = agentToolsFor(host, first.owner).tools.find(
        (one) => one.name === 'reply_to_parent',
      )!
      const replied = await tool.call({ piece: first.label, outcome: 'done', summary: 'Done.' })
      expect(replied.structured).toMatchObject({ outcome: 'ok' })
      if (state === 'stopped') await host.close(first.owner, world.window)
      const second = acceptedGive(
        await world.gives(host, caller, 'browser-driver', {
          title: 'Second',
          brief: 'Deliver the second request.',
          ...(explicit ? { model: 'fake-claude-a', effort: 'high' } : {}),
        }),
      )
      expect(second.owner).toBe(first.owner)
      const expected = explicit
        ? { model: 'fake-claude-a', effort: 'high' }
        : { model: 'fake-claude-b', effort: null }
      await vi.waitFor(() => {
        expect(
          world.sent
            .filter(
              (turn) =>
                turn.as === 'browser-driver' && turn.words.includes('Deliver the second request.'),
            )
            .at(-1),
        ).toMatchObject(expected)
      })
      expect(world.store.whatItRunsOn(first.owner)).toMatchObject({
        model: expected.model,
        reasoningEffort: expected.effort,
        aPersonChoseItAt: stamp,
      })
      expect(world.store.recordedOne(first.owner)?.provider).toBe('claude')
      expect(world.store.workById(second.piece)?.givenBy).toBe(caller)
    })
  })
})
