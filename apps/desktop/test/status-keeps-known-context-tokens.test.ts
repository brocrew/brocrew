import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContextReading } from '@brobot2/runtime'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { answerOn } from './helpers/call-tool'
import { F093World, waitFor } from './lib/f093-host'

/**
 * A conversation's status says the context tokens its provider reported, whether or not it also
 * reported a window size. Without a window it names no share and no window.
 */
describe('status keeps known context tokens without a window size', () => {
  let world: F093World
  let host: RuntimeHost

  beforeEach(() => {
    world = new F093World()
    host = world.buildHost()
  })

  afterEach(async () => {
    await world.dispose()
  })

  const status = async (agent: string) => {
    const caller = await world.open(host, 'claude', 'reader')
    return answerOn(agentToolsFor(host, caller), 'get_agent_status', { agent })
  }

  const withReading = async (
    provider: 'claude' | 'codex',
    reading: Exclude<ContextReading, { kind: 'unknown' }>,
  ): Promise<string> => {
    const id = await world.open(host, provider, `${provider}-agent`)
    world.end.newest().handle.simulateContextReading(reading)
    await waitFor(() => world.countOf(id, 'context_reading') === 1, 'the reading row')
    return id
  }

  it.each(['claude', 'codex'] as const)(
    'a %s tokens-only reading is said with its count and no window or share',
    async (provider) => {
      const id = await withReading(provider, { kind: 'tokens', used: 42_000 })
      const said = await status(id)
      expect(said.text).toContain(' · context 42000 tokens (window unknown)')
      expect(said.text).not.toMatch(/context \d+%/)
      expect(said.structured).toMatchObject({
        outcome: 'ok',
        agent: { context: { used: 42_000, window: null, percentUsed: null } },
      })
    },
  )

  it('a reported count of zero tokens is said as zero, not as no reading', async () => {
    const id = await withReading('claude', { kind: 'tokens', used: 0 })
    const said = await status(id)
    expect(said.text).toContain(' · context 0 tokens (window unknown)')
    expect(said.structured).toMatchObject({
      agent: { context: { used: 0, window: null, percentUsed: null } },
    })
  })

  it('a reading with a window keeps its share and window', async () => {
    const id = await withReading('codex', { kind: 'proportional', used: 10_000, window: 200_000 })
    const said = await status(id)
    expect(said.text).toContain(' · context 5% of 200000 tokens')
    expect(said.text).not.toContain('window unknown')
    expect(said.structured).toMatchObject({
      agent: { context: { used: 10_000, window: 200_000, percentUsed: 5 } },
    })
  })

  it('a conversation with no reading says no context at all', async () => {
    const id = await world.open(host, 'claude', 'quiet')
    const said = await status(id)
    expect(said.text).not.toContain(' · context ')
    expect((said.structured as { agent: { context: unknown } }).agent.context).toBeNull()
  })
})
