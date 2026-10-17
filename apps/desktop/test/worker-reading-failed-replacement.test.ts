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

  for (const fails of [false, true]) {
    it(`keeps complete terminal evidence with a failed replacement row: ${fails}`, async () => {
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
      world.resumesAreGoneFor = 'document-reader'
      const middle = world.aHost()
      await middle.reopenForAPerson(caller, world.window, null)
      expect(
        await middle.messageAgentNow(
          birth,
          'Check the first fictional revision.',
          { ownerId: agentCallerId(caller) },
          'note',
        ),
      ).toMatchObject({ ok: true, delivery: { outcome: 'sent' } })
      const terminal = world.store.workerInItsPlace(birth)
      expect(terminal).not.toBe(birth)
      await middle.closeAll()
      const cacheFailure = vi.spyOn(world.store, 'replacements').mockImplementation(() => {
        throw new Error('fictional ordinary cache unavailable')
      })
      const next = world.aHost()
      cacheFailure.mockRestore()
      expect(
        next.resumableSessions().find((row) => row.sessionId === terminal)?.worker,
      ).toMatchObject({ number: 1, bornAs: birth })
      await next.reopenForAPerson(caller, world.window, null)
      const recorded = () =>
        world.db.prepare('SELECT id FROM provider_session').all() as { id: string }[]
      const before = new Set(recorded().map((row) => row.id))
      const append = world.store.append.bind(world.store)
      const rowFailure = vi.spyOn(world.store, 'append').mockImplementation((...args) => {
        if (fails && args[0] === terminal && args[2].type === 'replaced_by')
          throw new Error('fictional later replacement row failed')
        return append(...args)
      })
      try {
        expect(
          await next.messageAgentNow(
            terminal,
            'Check the second fictional revision.',
            { ownerId: agentCallerId(caller) },
            'note',
          ),
        ).toMatchObject({ ok: true, delivery: { outcome: 'sent' } })
        const added = recorded().filter((row) => !before.has(row.id))
        expect(added).toHaveLength(1)
        const current = added[0]!.id
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
      } finally {
        rowFailure.mockRestore()
      }
    })
  }
})
