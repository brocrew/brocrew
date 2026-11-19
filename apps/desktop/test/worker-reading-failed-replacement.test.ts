import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

describe('worker metadata after a later replacement with an unread ordinary cache', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
    world.anAgent('document-reader', 'normal')
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  function hostWithoutOrdinaryHistory() {
    const cacheFailure = vi.spyOn(world.store, 'replacements').mockImplementation(() => {
      throw new Error('fictional ordinary cache unavailable')
    })
    try {
      return world.aHost()
    } finally {
      cacheFailure.mockRestore()
    }
  }

  for (const fails of [false, true]) {
    it(`checks terminal evidence with a missing historical forward row: ${fails}`, async () => {
      const first = world.aHost()
      const caller = (
        await first.createSession(
          { provider: 'claude', profileId: 'review-lead', cwd: world.folder, approvalMode: 'auto' },
          world.window,
        )
      ).sessionId
      const given = await world.gives(first, caller, 'document-reader', { parallel: true })
      expect(given.ok).toBe(true)
      if (!given.ok) throw new Error('fictional worker refused')
      const birth = given.owner
      await first.closeAll()
      const terminal = world.seedHistoricalSuccessor(birth, 'sess_historical_middle')
      const middle = hostWithoutOrdinaryHistory()
      expect(
        middle.resumableSessions().find((row) => row.sessionId === terminal)?.worker,
      ).toMatchObject({ number: 1, bornAs: birth })
      await middle.reopenForAPerson(caller, world.window, null)
      expect(
        await middle.messageAgentNow(
          terminal,
          'Check the first fictional revision.',
          { ownerId: agentCallerId(caller) },
          'note',
        ),
      ).toMatchObject({ ok: true, delivery: { outcome: 'sent' } })
      expect(world.store.workerInItsPlace(birth)).toBe(terminal)
      await middle.closeAll()
      const current = world.seedHistoricalSuccessor(
        terminal,
        'sess_historical_final',
        fails ? 'reverse-only' : 'complete',
      )
      const next = hostWithoutOrdinaryHistory()
      await next.reopenForAPerson(caller, world.window, null)
      expect(
        await next.messageAgentNow(
          current,
          'Check the second fictional revision.',
          { ownerId: agentCallerId(caller) },
          'note',
        ),
      ).toMatchObject({ ok: true, delivery: { outcome: 'sent' } })
        expect(world.store.workerInItsPlace(birth)).toBe(fails ? terminal : current)
        const rows = [...next.resumableSessions(), ...next.unresumableSessions()]
        const old = rows.find((row) => row.sessionId === terminal)
        expect(old).toBeDefined()
        if (!old) throw new Error('fictional former terminal absent')
        expect(Object.hasOwn(old, 'worker')).toBe(false)
        const latest = rows.find((row) => row.sessionId === current)
        expect(latest).toBeDefined()
        if (!latest) throw new Error('fictional later replacement absent')
        if (fails) {
          expect(Object.hasOwn(latest, 'worker')).toBe(false)
          const born = world.store.workersBorn().length
          const sent = world.sent.length
          const conversations = world.conversationsRecorded()
          for (const parallel of [false, true]) {
            expect(await world.gives(next, caller, 'document-reader', { parallel })).toMatchObject({
              ok: false,
              refusal: {
                rail: 'worker-binding-is-unknown',
                reason:
                  "Not given: 'document-reader' has no known conversation. Tell a person, and give it again once that is fixed.",
              },
            })
          }
          expect(world.store.workersBorn()).toHaveLength(born)
          expect(world.sent).toHaveLength(sent)
          expect(world.conversationsRecorded()).toBe(conversations)
        } else {
          expect(latest.worker).toMatchObject({ number: 1, bornAs: birth })
          expect(
            next.agentCard(current, { ownerId: agentCallerId(caller) }, caller)?.worker,
          ).toMatchObject({ number: 1, bornAs: birth })
        }
    })
  }
})
