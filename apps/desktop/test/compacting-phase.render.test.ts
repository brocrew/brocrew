import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AgentState from '../src/renderer/src/components/AgentState.vue'
import {
  sessionDoing,
  sessionFacets,
  type SessionFacetInput,
} from '../src/renderer/src/lib/agent-state'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'

/**
 * **`compacting` becomes a state you can actually see** (097 §1, from 087 §3).
 *
 * 081 designed an avatar for a compacting agent and 082 built it, and until 097 **nothing could ever
 * reach it**: the phase was in the vocabulary from 027 and no adapter emitted it, so the map entry,
 * the PNG and the branch that shows it were unreachable code that every test walked straight past.
 *
 * The other half — that Claude's `compaction_delta` is what raises the phase, and that no other
 * delta does — is asserted at the adapter, in `packages/runtime/test/claude-normalize.test.ts`. The
 * seam between the two is the `RuntimeEvent` union itself: the object this file starts from is
 * exactly the object that test ends on, and it is typed, so the two cannot drift into different
 * shapes without the compiler saying so.
 */

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(AgentState, props) }))

describe('the compacting phase reaches the avatar (097)', () => {
  it('an activity event folds into the compacting doing, and a turn clears it', () => {
    const state = createTranscript()
    expect(sessionDoing(sessionFacetInput(state)), 'idle before anything happened').not.toBe(
      'compacting',
    )

    applyEvent(state, { type: 'activity', phase: 'compacting' })
    expect(state.activity).toEqual({ phase: 'compacting' })
    expect(sessionDoing(sessionFacetInput(state))).toBe('compacting')

    // ⚠️ It is a statement about the PRESENT, so the turn ending takes it away. A pill that
    // outlived its turn would be an agent shown compacting forever after one frame.
    applyEvent(state, { type: 'turn', state: 'completed' })
    expect(state.activity).toBeNull()
    expect(sessionDoing(sessionFacetInput(state))).not.toBe('compacting')
  })

  it('the plate renders the compacting avatar, and a different phase renders a different one', async () => {
    const compacting = await render({ doing: 'compacting', size: 'lg' })
    expect(compacting).toContain('data-doing="compacting"')
    expect(compacting).toContain('data-cy="agent-avatar"')
    const src =
      /data-cy="agent-avatar"[^>]*src="([^"]*)"|src="([^"]*)"[^>]*data-cy="agent-avatar"/.exec(
        compacting,
      )
    expect(src, 'the avatar rendered without a src').not.toBeNull()
    expect(
      (src![1] ?? src![2])!.toLowerCase(),
      'the compacting avatar is not compacting.png',
    ).toContain('compacting')

    // ⚠️ **The paired positive.** An `img` whose src merely contains "compacting" would also pass
    // if the component ignored `doing` and every state drew the same picture — so the neighbouring
    // phase has to draw a DIFFERENT one, and this is what rules that out.
    const thinking = await render({ doing: 'thinking', size: 'lg' })
    const other =
      /data-cy="agent-avatar"[^>]*src="([^"]*)"|src="([^"]*)"[^>]*data-cy="agent-avatar"/.exec(
        thinking,
      )
    expect(other![1] ?? other![2]).not.toBe(src![1] ?? src![2])
  })

  it('the raw stream names the phase, so a compaction in flight is readable there too', () => {
    expect(describeEvent({ type: 'activity', phase: 'compacting' })).toBe('compacting')
  })
})

/**
 * A live session doing nothing in particular, so the ONE field under test — `activity` — is the
 * only thing that can move the answer.
 *
 * ⚠️ `streaming: false` matters: `sessionDoing` checks the streaming flag BEFORE the activity phase,
 * deliberately, because a finished tool leaves a stale `activity` behind. A fixture that streamed
 * would answer `replying` whatever phase it was handed, and this test would have proved nothing.
 */
function sessionFacetInput(state: ReturnType<typeof createTranscript>): SessionFacetInput {
  return {
    phase: 'open',
    status: 'working',
    activity: state.activity,
    streaming: false,
    liveness: 'live',
  }
}

describe('sessionFacets still agrees with sessionDoing about it', () => {
  it('surfaces compacting as the doing facet', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'activity', phase: 'compacting' })
    expect(sessionFacets(sessionFacetInput(state)).doing).toBe('compacting')
  })
})
