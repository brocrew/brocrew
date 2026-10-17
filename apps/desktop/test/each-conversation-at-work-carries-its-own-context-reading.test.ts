import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContextReading } from '@brobot2/runtime'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { F093World, waitFor, type Handed } from './lib/f093-host'

/**
 * # F093 · §4 — `context` on `whatIsBeingDone`: each conversation its own latest reading, or `null`
 *
 * ⚑ The dev's test reads ONE conversation. These read several at once — a reading lands on its own
 * conversation and on no other, a conversation with none says `null`, a newer reading replaces the
 * older — and a child given work by its parent, each with its own. ⚑ And the one read of a CLOSED
 * conversation takes its window from the ledger's last reading.
 */

describe('F093 · each conversation at work carries its own context reading', () => {
  let world: F093World
  let host: RuntimeHost

  beforeEach(() => {
    world = new F093World()
    host = world.buildHost()
  })

  afterEach(async () => {
    await world.dispose()
  })

  const contextOf = (sessionId: string): ContextReading | null | undefined =>
    host.whatIsBeingDone().conversations.find((one) => one.conversation === sessionId)?.context

  /** ⚑ Open a conversation and hand back its id with the handle its provider issued. */
  const openWithHandle = async (
    provider: 'claude' | 'codex',
    profileId: string,
  ): Promise<{ id: string; handed: Handed }> => {
    const id = await world.open(host, provider, profileId)
    return { id, handed: world.end.newest() }
  }

  it('⚑ three conversations: each its own reading, none for the one without, and the newest replaces the older', async () => {
    const ada = await openWithHandle('codex', 'ada')
    const bea = await openWithHandle('claude', 'bea')
    const cy = await openWithHandle('claude', 'cy')
    for (const one of [ada, bea, cy]) expect(contextOf(one.id), one.id).toBeNull()

    ada.handed.handle.simulateContextReading({
      kind: 'proportional',
      used: 10_000,
      window: 200_000,
    })
    bea.handed.handle.simulateContextReading({ kind: 'tokens', used: 42_000 })
    await waitFor(() => contextOf(ada.id) !== null && contextOf(bea.id) !== null, 'both readings')
    expect(contextOf(ada.id)).toEqual({ kind: 'proportional', used: 10_000, window: 200_000 })
    expect(contextOf(bea.id)).toEqual({ kind: 'tokens', used: 42_000 })
    expect(contextOf(cy.id)).toBeNull()

    ada.handed.handle.simulateContextReading({
      kind: 'proportional',
      used: 30_000,
      window: 200_000,
    })
    await waitFor(() => {
      const now = contextOf(ada.id)
      return now !== null && now !== undefined && 'used' in now && now.used === 30_000
    }, 'the newer reading')
    expect(contextOf(ada.id)).toEqual({ kind: 'proportional', used: 30_000, window: 200_000 })
    expect(contextOf(bea.id)).toEqual({ kind: 'tokens', used: 42_000 })
    expect(contextOf(cy.id)).toBeNull()
  })

  it('⚑ a child given work has its own reading, and its parent none until it has one', async () => {
    // ⚑ The worker's identity exists before it is given anything — as in the D-027 harness.
    await host.close(await world.open(host, 'claude', 'worker'), world.window)
    const pm = await openWithHandle('claude', 'pm')
    const before = world.end.handed.length
    const give = agentToolsFor(host, pm.id).tools.find((one) => one.name === 'give_work')
    if (give === undefined) throw new Error('no give_work')
    const given = (
      await give.call({
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'the index',
        brief: 'build it',
      })
    ).structured as Record<string, unknown>
    expect(given['outcome'], JSON.stringify(given)).toBe('ok')
    const child = given['agent']
    if (typeof child !== 'string') throw new Error('the give named no conversation')
    await waitFor(() => world.end.handed.length > before, 'the child’s launch')
    await waitFor(() => contextOf(child) !== undefined, 'the child at work')
    const childHandle = world.end.newest().handle

    childHandle.simulateContextReading({ kind: 'tokens', used: 5_000 })
    await waitFor(() => contextOf(child) !== null, 'the child’s reading')
    expect(contextOf(child)).toEqual({ kind: 'tokens', used: 5_000 })
    expect(contextOf(pm.id)).toBeNull()

    pm.handed.handle.simulateContextReading({ kind: 'tokens', used: 9_000 })
    await waitFor(() => contextOf(pm.id) !== null, 'the parent’s reading')
    expect(contextOf(pm.id)).toEqual({ kind: 'tokens', used: 9_000 })
    expect(contextOf(child)).toEqual({ kind: 'tokens', used: 5_000 })
  })

  it('⚑ a closed conversation is no longer at work, and its one read takes the window from its last reading', async () => {
    const ada = await openWithHandle('codex', 'ada')
    ada.handed.handle.simulateContextReading({
      kind: 'proportional',
      used: 10_000,
      window: 200_000,
    })
    await waitFor(() => world.countOf(ada.id, 'context_reading') === 1, 'the reading row')
    await host.close(ada.id, world.window)
    expect(contextOf(ada.id)).toBeUndefined()

    const read = await host.whatThisAgentWasGiven(ada.id)
    expect(read.launch.running).toBe(false)
    expect(read.size.contextWindow?.tokens).toBe(200_000)
    expect(read.size.contextWindow?.share).toBeCloseTo(read.size.total.tokens / 200_000)
    expect(read.size.contextWindowWhy).toBeNull()

    // ⚑ The control: a reading with no window says why there is no share.
    const bea = await openWithHandle('claude', 'bea')
    bea.handed.handle.simulateContextReading({ kind: 'tokens', used: 42_000 })
    await waitFor(() => contextOf(bea.id) !== null, 'the tokens reading')
    const tokens = await host.whatThisAgentWasGiven(bea.id)
    expect(tokens.size.contextWindow).toBeNull()
    expect(tokens.size.contextWindowWhy).toBe('Claude does not report its window size.')
  })
})
