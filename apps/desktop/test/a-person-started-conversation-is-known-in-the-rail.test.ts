import { expect, it } from 'vitest'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { aServiceWorld } from './helpers/a-service-world'

it('carries positive person start through both listing halves without treating roots or missing workers as proof', async () => {
  const world = aServiceWorld()
  try {
    const host = world.aHost()
    const person = await world.aPersonOpens(host, DEFAULT_PROFILE_ID)
    world.db.prepare('UPDATE provider_session SET external_ref = NULL WHERE id = ?').run(person)
    const before = await host.listConversations()
    if ('refused' in before) throw new Error(before.refused)
    expect(before.unresumable.find((row) => row.sessionId === person)?.personStarted).toBe(true)
    for (const [id, parent] of [
      ['agent-root', person],
      ['rootless', null],
    ] as const) {
      world.store.create({
        id,
        provider: 'claude',
        profileId: DEFAULT_PROFILE_ID,
        cwd: world.folder,
        approvalMode: 'ask',
        ...(parent ? { parentSessionId: parent } : {}),
      })
    }
    world.store.ensurePersonalRoot('agent-root', world.clock)
    const adopted = await world.aPersonOpens(host, DEFAULT_PROFILE_ID)
    world.db
      .prepare('UPDATE provider_session SET adopted_at = ? WHERE id = ?')
      .run(world.clock, adopted)
    world.store.append(
      person,
      world.store.nextOrdinal(person),
      {
        type: 'session',
        state: 'started',
        ref: {
          provider: 'claude',
          sessionId: 'fictional-person-thread',
          cwd: world.folder,
          rotation: 0,
        },
      },
      world.clock,
    )
    const after = await host.listConversations()
    if ('refused' in after) throw new Error(after.refused)
    expect(after.resumable.find((row) => row.sessionId === person)?.personStarted).toBe(true)
    const rows = new Map(
      [...after.resumable, ...after.unresumable].map((row) => [row.sessionId, row]),
    )
    for (const id of ['agent-root', 'rootless', adopted])
      expect(rows.get(id)?.personStarted).toBe(false)
    expect(world.store.rootOf('agent-root')).not.toBeNull()
    expect(world.store.rootOf(adopted)).not.toBeNull()
  } finally {
    await world.cleanUp()
  }
})
