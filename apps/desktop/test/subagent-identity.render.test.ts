import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import SubAgentEntry from '../src/renderer/src/components/SubAgentEntry.vue'
import type { SubAgentCard } from '../src/renderer/src/lib/transcript'

/**
 * 111 · Who is talking — the identity the card already held and never showed.
 *
 * The sub-agent card must expose the id and the provider-specific kind of id it already
 * carries. Kind, title, and status alone do not distinguish which child is talking.
 */

const card = (over: Partial<SubAgentCard> = {}): SubAgentCard => ({
  agentId: 'ad63a0d89dcd9eed4',
  running: false,
  body: [],
  ...over,
})

/**
 * The rendered card with **HTML comments stripped** — and that is not tidiness.
 *
 * ⚠️ **Vue emits template comments into SSR output, so a raw-HTML assertion can be answered by a
 * comment.** This file found it the hard way in both directions: `not.toContain('0 tools')` failed
 * against a comment explaining why `0 tools` must never appear, and the far worse case is the
 * mirror — a `toContain` that passes because the phrase it looks for is written in a comment beside
 * the code that was supposed to render it. That is a vacuous test that looks green forever.
 */
const render = async (c: SubAgentCard): Promise<string> =>
  (await renderToString(createSSRApp({ render: () => h(SubAgentEntry, { card: c }) }))).replace(
    /<!--[\s\S]*?-->/g,
    '',
  )

describe('the compact child card preserves its identity and reported state', () => {
  it.each(['task', 'thread'] as const)('keeps a %s identity bound to the transcript action', async (idKind) => {
    const html = await render(card({ idKind }))
    expect(html).toContain('data-agent-id="ad63a0d89dcd9eed4"')
    expect(html).toContain('subagent-open-transcript')
    expect(html).not.toContain('aria-expanded')
  })

  it('does not turn an unreported ending into completion', async () => {
    expect(await render(card())).toMatch(/data-cy="subagent-status"[^>]*>ended</)
    expect(await render(card({ outcome: 'completed' }))).toMatch(/data-cy="subagent-status"[^>]*>completed</)
  })

  it('retains the observed-child name without inventing a parent or model', async () => {
    const html = await render(card({ origin: 'observed', running: true }))
    expect(html).toContain('nested agent')
    expect(html).not.toContain('from <code')
    expect(html).not.toContain('model')
  })

  const observed = (): SubAgentCard => card({ origin: 'observed', running: true })
  it('⛔ no amber, and no new face: it wears the running plate it already had (080/081)', async () => {
    // A nested agent is not a new KIND of thing — 123 refused a face for provenance and 133 refused
    // one for compaction. It is an ordinary running agent whose parentage we were not told, so its
    // plate must be the SAME plate an announced running child wears, down to the drawing, and never
    // the tone that means "waiting on you".
    const [nested, announced] = await Promise.all([
      render(observed()),
      render(card({ idKind: 'thread', kind: 'ui_test', running: true })),
    ])
    /** The face and its tone: what it is doing, whether it is with us, the drawing, the underline. */
    const face = (html: string): string[] => [
      html.match(/data-doing="([^"]*)"/)?.[1] ?? '',
      html.match(/data-being="([^"]*)"/)?.[1] ?? '',
      html.match(/agents\/([a-z-]+)\.png/)?.[1] ?? '',
      html.match(/--_u:var\((--[a-z-]+)\)/)?.[1] ?? '',
    ]
    // The positive first, so the comparison below cannot be two empty lists agreeing (116).
    expect(face(nested)).toEqual(['working', 'live', 'working', '--accent'])
    expect(face(nested)).toEqual(face(announced))
    // ⛔ 080: the one tone this card may never take. `--waiting` is the amber, and `needing` is what
    // would claim somebody is blocked on the user — a nested agent asks nothing of anyone.
    for (const html of [nested, announced]) {
      expect(html).not.toContain('--waiting')
      expect(html).not.toContain('data-needing')
    }
  })
})
