import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import type { SessionStore } from '../src/main/db/session-store'
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

  function hostWithOrdinaryHistory(read: SessionStore['replacements']) {
    const cache = vi.spyOn(world.store, 'replacements').mockImplementation(read)
    try {
      return world.aHost()
    } finally {
      cache.mockRestore()
    }
  }

  function unreadHistory(): never {
    throw new Error('fictional ordinary cache unavailable')
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
      await first.closeAll()
      const terminal = world.seedHistoricalSuccessor(birth, 'sess_historical_middle')
      const middle = hostWithOrdinaryHistory(unreadHistory)
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
      const next = hostWithOrdinaryHistory(
        fails ? () => [{ replaced: terminal, by: current }] : unreadHistory,
      )
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
      } else {
        expect(latest.worker).toMatchObject({ number: 1, bornAs: birth })
        expect(
          next.agentCard(current, { ownerId: agentCallerId(caller) }, caller)?.worker,
        ).toMatchObject({ number: 1, bornAs: birth })
      }
    })
  }
})
