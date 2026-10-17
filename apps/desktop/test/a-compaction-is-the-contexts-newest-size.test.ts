import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ContextReading } from '@brobot2/runtime'
import { normalizeMessage } from '../../../packages/runtime/src/claude/normalize'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { NO_SIZE_SINCE_A_COMPACTION } from '../src/main/runtime/what-this-agent-was-given'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { F093World, waitFor, type Handed } from './lib/f093-host'

/**
 * A compaction that says the size it left is the context's newest reading, at once: the agent
 * panel's figure, the host's reading for a conversation at work, and the ledger a restart reads all
 * say it, before the agent's next reply. One that says no size leaves the host no current reading.
 */

const BEFORE = 549_000
const AFTER = 15_000

const boundary = (postTokens?: number): SDKMessage =>
  ({
    type: 'system',
    subtype: 'compact_boundary',
    session_id: 's',
    compact_metadata: {
      trigger: 'manual',
      pre_tokens: BEFORE,
      ...(postTokens === undefined ? {} : { post_tokens: postTokens }),
    },
  }) as unknown as SDKMessage

/** The window's own fold of these rows: what the agent panel's figure reads. */
const theMeterAfter = (events: readonly TranscriptEvent[]): ContextReading => {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state.meter.reading
}

describe('a compaction is the context’s newest size', () => {
  it('🔴 the window’s figure reads the size the compaction left at once, as Claude’s adapter says it', () => {
    const earlier: TranscriptEvent = {
      type: 'context_reading',
      reading: { kind: 'tokens', used: BEFORE },
      source: 'message_start',
    }
    const compacted = normalizeMessage(boundary(AFTER)) as TranscriptEvent[]
    expect(compacted.map((event) => event.type)).toEqual(['compaction', 'context_reading'])
    expect(theMeterAfter([earlier, ...compacted])).toEqual({ kind: 'tokens', used: AFTER })
    // ⛔ With no size, the adapter makes none up.
    const unsized = normalizeMessage(boundary()) as TranscriptEvent[]
    expect(unsized.map((event) => event.type)).toEqual(['compaction'])
  })

  describe('the host, and the ledger a restart reads', () => {
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

    const aClaudeConversation = async (): Promise<{ id: string; handed: Handed }> => {
      const id = await world.open(host, 'claude', 'ada')
      const handed = world.end.newest()
      handed.handle.simulateContextReading({ kind: 'tokens', used: BEFORE }, 'message_start')
      await waitFor(() => contextOf(id)?.kind === 'tokens', 'the reading before the compaction')
      return { id, handed }
    }

    /** What Claude's adapter sends for a boundary, in its order. */
    const itCompacts = (handed: Handed, after?: number): void => {
      for (const event of normalizeMessage(boundary(after))) {
        if (event.type === 'compaction') handed.handle.simulateCompaction(event)
        if (event.type === 'context_reading') {
          handed.handle.simulateContextReading(event.reading, event.source)
        }
      }
    }

    it('🔴 a compaction that says its size: the host’s reading is that size at once, the ledger keeps it, and the next reply replaces it', async () => {
      const { id, handed } = await aClaudeConversation()
      itCompacts(handed, AFTER)
      await waitFor(() => world.countOf(id, 'compaction') === 1, 'the compaction row')
      await waitFor(() => world.countOf(id, 'context_reading') === 2, 'its reading')
      expect(contextOf(id)).toEqual({ kind: 'tokens', used: AFTER })

      // ⚑ A restart reads its rows again: the window's fold of the ledger says the size it left.
      expect(theMeterAfter(world.ledger(id))).toEqual({ kind: 'tokens', used: AFTER })
      const newest = world.store.newestOfType?.(id, 'context_reading')
      expect(newest?.event).toMatchObject({ reading: { kind: 'tokens', used: AFTER } })

      // ⚑ The next reply replaces it, as before.
      handed.handle.simulateContextReading({ kind: 'tokens', used: 21_000 }, 'message_start')
      const theNextReading = { kind: 'tokens', used: 21_000 }
      await waitFor(
        () => JSON.stringify(contextOf(id)) === JSON.stringify(theNextReading),
        'the next reading',
      )
      expect(theMeterAfter(world.ledger(id))).toEqual({ kind: 'tokens', used: 21_000 })
    })

    it('⛔ a compaction that says no size: the host no longer calls the reading before it current, and the next reply gives it one', async () => {
      const { id, handed } = await aClaudeConversation()
      itCompacts(handed)
      await waitFor(() => world.countOf(id, 'compaction') === 1, 'the compaction row')
      await waitFor(() => contextOf(id)?.kind === 'unknown', 'the reading to be let go of')
      expect(contextOf(id)).toEqual({ kind: 'unknown' })
      // Nothing was made up for the ledger either.
      expect(world.countOf(id, 'context_reading')).toBe(1)
      // ⚑ The popup says why it shows no share, truly: not that the provider never says its window.
      const given = await host.whatThisAgentWasGiven(id)
      expect(given.size.contextWindow).toBeNull()
      expect(given.size.contextWindowWhy).toBe(NO_SIZE_SINCE_A_COMPACTION)
      expect(NO_SIZE_SINCE_A_COMPACTION).toBe('Size unavailable.')

      handed.handle.simulateContextReading({ kind: 'tokens', used: 21_000 }, 'message_start')
      await waitFor(() => contextOf(id)?.kind === 'tokens', 'the next reading')
      expect(contextOf(id)).toEqual({ kind: 'tokens', used: 21_000 })

      // ⛔ A sub-agent's compaction with no size leaves this conversation's reading as it is.
      for (const event of normalizeMessage({
        ...(boundary() as object),
        parent_tool_use_id: 'toolu_child',
      } as unknown as SDKMessage)) {
        if (event.type === 'compaction') handed.handle.simulateCompaction(event)
      }
      await waitFor(() => world.countOf(id, 'compaction') === 2, 'the sub-agent’s compaction row')
      expect(contextOf(id)).toEqual({ kind: 'tokens', used: 21_000 })
      // ⚑ …and the popup's reason is the ordinary one again.
      expect((await host.whatThisAgentWasGiven(id)).size.contextWindowWhy).toBe(
        'Claude does not report its window size.',
      )
    })
  })
})
