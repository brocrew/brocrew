import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AppTitleBar from '../src/renderer/src/components/AppTitleBar.vue'
import { windowTitleFor } from '../src/main/launch-presentation'

/**
 * 🔴 **695 §1.4 · the name a person reads on a window brought forward.** The window is frameless, so
 * the OS title (`BroCrew — test`, `launch-presentation.ts`) is seen only in Mission Control and the
 * Window menu; the bar the page draws is what a person reads. It takes the name from
 * `AppInfo.windowTitle`, which `main/index.ts` fills from the launch's own presentation and, since
 * `724`, a person's launch's data folder — pinned in `a-window-nobody-sees.test.ts`. ⚑ The literals
 * here are the two titles as a reader sees them.
 *
 * ⚑ **730 · and the third, composed by main's own `windowTitleFor` rather than typed** — so the name
 * this bar draws and the name main composes are one fact. ⚠️ Its `<strong>` half holds on `main`
 * (a pin); what is new at `730` is the whole name on `.window-title`'s `title`, because a long
 * folder's name is cut in the bar (`dom/a-window-on-another-data-folder-says-so.dom.test.ts`).
 */

const HIDDEN_TITLE = 'BroCrew — test'
const PERSONS_TITLE = 'BroCrew'

describe('695 §1.4 · the bar a person would see on a window brought forward', () => {
  const INFO = {
    name: 'BroCrew',
    version: '0.0.0',
    step: 'Step 0',
    build: { id: 'e76e7c6', commit: 'e76e7c6'.padEnd(40, '0'), dirty: false },
    db: { migrationsApplied: 1, providerSessionCount: 0 },
  }
  const render = (info: unknown): Promise<string> =>
    renderToString(createSSRApp({ render: () => h(AppTitleBar as never, { info, error: null }) }))
  const drawn = (html: string): string | null =>
    /data-cy="window-title"[\s\S]*?<strong[^>]*>([^<]*)<\/strong>/.exec(html)?.[1] ?? null

  it('a hidden launch’s bar says so', async () => {
    expect(drawn(await render({ ...INFO, windowTitle: HIDDEN_TITLE }))).toBe(HIDDEN_TITLE)
  })

  it('control — a person’s launch, and a bar whose read has not landed, say BroCrew', async () => {
    expect(drawn(await render({ ...INFO, windowTitle: PERSONS_TITLE }))).toBe('BroCrew')
    expect(drawn(await render(null))).toBe('BroCrew')
  })

  it('🔴 730 · a person’s launch on another data folder: the bar draws main’s own composed name, and carries it whole on its title', async () => {
    const composed = windowTitleFor({ hidden: false }, 'fe730')
    expect(composed).toBe('BroCrew — fe730')
    const html = await render({ ...INFO, windowTitle: composed })
    expect(drawn(html)).toBe('BroCrew — fe730')
    const opening = /<div\b[^>]*\bdata-cy="window-title"[^>]*>/.exec(html)?.[0] ?? ''
    expect(opening, 'the markup has no window-title').not.toBe('')
    expect(/\btitle="([^"]*)"/.exec(opening)?.[1]).toBe('BroCrew — fe730')
  })
})
