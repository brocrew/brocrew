import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AgentState from '../src/renderer/src/components/AgentState.vue'

/**
 * # 🔴 F023 · the mark on the avatar — *"with a small mark on the avatar (a clock, say)"*
 *
 * ⚑ A clock for a scheduled wake-up, a terminal for a command running in the background, in the
 * plate's free top-left corner. ⛔ The background one first where both hold — the order the standing
 * word itself reads them in. ⚑ Visual only: the words are the row's and the plate's own.
 */

const plate = (facets: Record<string, unknown>, size: string | number = 'card'): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(AgentState as never, { size, ...facets }) }))

const markOf = (html: string): string | null => {
  const mark =
    /<span class="badge work-mark"[^>]*data-mark="([a-z]+)"[^>]*>[\s\S]*?href="([^"]+)"/.exec(html)
  return mark ? `${mark[1]} ${mark[2]}` : null
}

describe('F023 · the work an agent left behind, on its avatar', () => {
  it('🔴 a clock for a scheduled wake-up, a terminal for background work — background first', async () => {
    expect(markOf(await plate({ doing: 'idle', scheduled: true }))).toBe('scheduled #i-clock')
    expect(markOf(await plate({ doing: 'idle', detached: true }))).toBe('background #i-terminal')
    expect(markOf(await plate({ doing: 'idle', detached: true, scheduled: true }))).toBe(
      'background #i-terminal',
    )
    // ⚑ Hidden from a screen reader: the plate's own sentence already names it.
    expect(await plate({ doing: 'idle', scheduled: true })).toMatch(
      /class="badge work-mark"[^>]*aria-hidden="true"/,
    )
  })

  it('⛔ THE CONTROLS — no work left behind, no mark; and a dot draws none', async () => {
    const quiet = await plate({ doing: 'idle' })
    expect(quiet).toContain('data-cy="agent-plate"')
    expect(markOf(quiet)).toBeNull()
    const dot = await plate({ doing: 'idle', scheduled: true }, 'dot')
    expect(dot).toContain('data-cy="agent-dot"')
    expect(markOf(dot)).toBeNull()
  })
})
