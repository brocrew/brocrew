import { expect, it } from 'vitest'
import { F093World, waitFor } from './lib/f093-host'
import { legacyConversation } from './fixtures/legacy-migration-data'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import type { ClientSessionApi } from '../src/shared/client-session-api'

it.each(['recorded', 'attach', 'resume-attached', 'resume-stopped'] as const)(
  'carries actual core history facts through session-store %s adoption',
  async (mode) => {
    const world = new F093World()
    const host = world.buildHost(false)
    const sentence = 'The fictional model cannot run on this account.'
    const envelope = JSON.stringify({ error: { message: sentence } })
    const diagnostics = [envelope, `turn failed: ${envelope}`, 'turn failed']
    const bridge: Partial<ClientSessionApi> = {
      currentEpoch: async () => host.currentEpoch(),
      listConversations: () => host.listConversations(),
      attachOpen: async () => host.attachOpenSessions(world.window),
      look: ({ sessionId, claim }) => host.look(sessionId, world.window, claim),
      resume: ({ sessionId, launchKey }) => host.resumeSession(sessionId, world.window, launchKey),
      onEvent: () => () => {},
      onLiveness: () => () => {},
    }
    let client: ReturnType<typeof createSessionStore> | undefined
    try {
      let id: string
      if (mode === 'recorded') {
        id = 'recorded-error-facts'
        legacyConversation(world.db, {
          id,
          profileId: id,
          provider: 'codex',
          cwd: world.project,
          approvalMode: 'ask',
        })
        diagnostics.forEach((message, ordinal) =>
          world.store.append(id, ordinal, { type: 'error', message, fatal: false }, 1000 + ordinal),
        )
      } else {
        const created = await host.createSession(
          { provider: 'codex', cwd: world.project, approvalMode: 'auto' },
          world.window,
        )
        id = created.sessionId
        const handle = world.end.newest().handle
        for (const diagnostic of diagnostics) handle.simulateError(diagnostic, false)
        await waitFor(
          () => world.window.messages.filter((row) => row.event.type === 'error').length === 3,
          'source errors recorded',
        )
        if (mode === 'resume-stopped') await host.close(id, world.window)
      }
      const raw = world.ledger(id).filter((event) => event.type === 'error')
      client = createSessionStore(bridge as ClientSessionApi)
      if (mode === 'recorded') expect(await client.look(id)).toBe(id)
      else if (mode === 'attach') expect(await client.attachOpen()).toEqual([id])
      else expect(await client.resume(id)).toBe(id)
      const record = client.get(id)!
      expect(record.meta?.handover).toBe(
        mode === 'recorded' ? 'recorded' : mode === 'resume-stopped' ? 'resumed' : 'attached',
      )
      expect(
        record.transcript.items.flatMap((item) =>
          item.kind === 'notice' && item.providersWords === true ? [item.text] : [],
        ),
      ).toEqual([sentence])
      const errors = record.window.entries.filter((row) => row.event.type === 'error')
      expect(errors.map((row) => row.event)).toEqual(raw)
      expect(errors.map((row) => row.errorFacts?.ending)).toEqual([
        undefined,
        { raw: envelope, sentence },
        { raw: '', sentence: '' },
      ])
      expect(world.ledger(id).filter((event) => event.type === 'error')).toEqual(raw)
      expect(
        errors.every((row, index) => index === 0 || row.ordinal > errors[index - 1]!.ordinal),
      ).toBe(true)
    } finally {
      client?.dispose()
      await world.dispose()
    }
  },
)
