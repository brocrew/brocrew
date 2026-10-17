import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { SessionRef } from '@brobot2/runtime'
import TranscriptView from '../src/renderer/src/components/TranscriptView.vue'
import { applyEvent, appendUserMessage, createTranscript } from '../src/renderer/src/lib/transcript'

/**
 * **The reset, on screen** (199, from 192 H5).
 *
 * A `.render.test.ts` because it mounts SFCs, and it exists for the half the projection tests
 * cannot reach: `transcript-mode.ts` deciding an item is visible is not the same as
 * `TranscriptView` having a branch that draws it. Between those two there is exactly the gap a
 * `v-else` chain can open — an item kind that is "shown" and falls through to `UnknownEntry`.
 *
 * ⚠️ **SSR renders markup and nothing else** (083's warning, and 193's): no layout, no computed
 * styles. What is asserted here is which component ran and what text it put in the document —
 * everything about how it LOOKS is the DOM project's, and neither pretends to be the other.
 */

const ref: SessionRef = {
  provider: 'claude',
  sessionId: 'sess-before',
  cwd: '/tmp/scratch',
  rotation: 0,
}

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(TranscriptView as never, props) }))

function afterAReset() {
  const state = createTranscript()
  applyEvent(state, { type: 'session', state: 'started', ref }, 1)
  appendUserMessage(state, 'do the thing')
  applyEvent(
    state,
    {
      type: 'conversation_reset',
      ref: { ...ref, sessionId: 'sess-after' },
      source: 'conversation_reset',
    },
    2,
  )
  return state
}

describe('ConversationResetEntry — the seam a `/clear` leaves (199 acceptance 4)', () => {
  it('⛔ draws its own boundary in the READING view, naming the conversation the provider moved to', async () => {
    const html = await render({ items: afterAReset().items, mode: 'normal', who: 'Claude' })

    expect(html).toContain('data-cy="reset-boundary"')
    // The two things on the row that are the provider's own, cited rather than asserted.
    expect(html).toContain('sess-after')
    expect(html).toContain('conversation_reset')
    // ⚠️ **The regression this is really about.** Before 199 the same event rendered as
    // `unknown{lifecycle}` chatter — and `normal` mode drops that, so the row was not merely quiet,
    // it was absent. Paired with the positive above so the absence cannot pass over an empty page.
    expect(html).not.toContain('data-cy="chatter-entry"')
    // …and it did not silently become the compaction row, which says a different thing.
    expect(html).not.toContain('data-cy="compaction-boundary"')
  })

  it('…and in debug too — this is not a mode toggle, it is a fact about the conversation', async () => {
    const html = await render({ items: afterAReset().items, mode: 'debug', who: 'Claude' })
    expect(html).toContain('data-cy="reset-boundary"')
    expect(html).toContain('sess-after')
  })

  it('says the earlier turns are GONE rather than summarized — the whole difference from a compaction', async () => {
    const html = await render({ items: afterAReset().items, mode: 'normal', who: 'Claude' })
    expect(html).toContain('gone from the model, not summarized')
    // Non-vacuity: the user's own message is on the page, so the reset row was rendered into a real
    // transcript rather than into an empty one that would contain any absence you asked for.
    expect(html).toContain('do the thing')
  })
})
