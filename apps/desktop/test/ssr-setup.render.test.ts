import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import CommandPalette from '../src/renderer/src/components/CommandPalette.vue'
import OverlayHost from '../src/renderer/src/components/OverlayHost.vue'

describe('251 §0 · the two components that could not be server-rendered', () => {
  it('🔴 OverlayHost renders on the server, and renders its real chrome', async () => {
    const html = await renderToString(createSSRApp(OverlayHost, { label: 'A sheet' }))
    // The positive that makes this a test rather than a "did not throw": the host's own backdrop,
    // its dialog role and its focus target are all in the markup.
    expect(html).toContain('data-cy="overlay-host"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('aria-label="A sheet"')
  })

  it('🔴 CommandPalette renders on the server, teleport and all', async () => {
    const context: { teleports?: Record<string, string> } = {}
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(CommandPalette as never, {
            open: [],
            closed: [],
            closedLooked: true,
            closedError: null,
            projects: [],
            activeId: null,
          }),
      }),
      context,
    )
    // ⚠️ The panel is `Teleport to="body"` and closed by default, so the MAIN string is empty by
    // design and asserting on it would prove nothing. The teleport BUFFER existing is the fact: it
    // is only written once `setup` has run to completion and the template has rendered.
    expect(html).toBe('<!--teleport start--><!--teleport end-->')
    // ⚑ The buffer is keyed by the teleport's TARGET (`body`), and it only exists once `setup` has
    // run to completion and the template has rendered — which is the fact this test is buying.
    expect(Object.keys(context.teleports ?? {})).toEqual(['body'])
  })
})
