import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import DocumentBody from '../src/renderer/src/components/DocumentBody.vue'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'
import { TOAST_MS, createOverlayStore } from '../src/renderer/src/lib/overlay-store'

/**
 * The overlays (Slice 2 · 011).
 *
 * Two things had to be true of every one of them, and neither can be read off the markup: the
 * document they show is the SAME document rendered by the SAME viewer, and the confirmations that
 * would start real work do not.
 *
 * ⚑ **D-016** deleted the seed-only overlays this file rendered over the demo fixtures — the
 * document drawer, the dispatch gate, the recruiting sheet and the all-documents sheet — with the
 * seed itself. What remains is the shared viewer they all drew through, and the overlay layer.
 */

const render = (component: unknown, props: Record<string, unknown> = {}): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

describe('the shared document viewer', () => {
  it('renders markdown as a document, and shows the source verbatim on request', async () => {
    const source = '# Title\n\nA paragraph with **strong** text.\n\n- one\n- two'
    const markdown = await render(DocumentBody, { source })
    expect(markdown).toContain('<h1>Title</h1>')
    expect(markdown).toContain('<strong>strong</strong>')
    expect(markdown).toContain('<li>one</li>')

    const raw = await render(DocumentBody, { source, raw: true })
    expect(raw).toContain('data-view="raw"')
    // The raw view is the source, not a re-render of it: the hashes and dashes are still there.
    expect(raw).toContain('# Title')
    expect(raw).toContain('- one')
    expect(raw).not.toContain('<h1>')
  })

  it('cannot be made to execute what a document contains', () => {
    // `html: false` is the whole security story (lib/markdown.ts). A document that contains markup
    // is a document ABOUT markup, and it renders as text.
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">')
    // Not "the word onerror is absent" — it is present, as TEXT, which is the correct rendering of
    // a document that talks about an img tag. What must be absent is a TAG.
    expect(html).not.toMatch(/<script|<img/)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=')

    // …and a link that would run code is dropped rather than rendered as a link.
    const link = renderMarkdown('[click](javascript:alert(1))')
    expect(link).not.toContain('href="javascript:')
  })

  it('is the paper the design asked for, not the app’s dark chrome', async () => {
    const html = await render(DocumentBody, { source: '# x', filename: 'a.md' })
    expect(html).toContain('doc-paper')
    expect(html).toContain('a.md')
    // Both views are always reachable — a rendering you cannot get behind is not a document.
    expect(html).toContain('data-cy="doc-view-markdown"')
    expect(html).toContain('data-cy="doc-view-raw"')
  })
})

describe('the overlay layer', () => {
  it('shows one thing at a time — opening a second replaces the first', () => {
    const store = createOverlayStore(() => {})
    store.open({ kind: 'newAgent' })
    expect(store.overlay.value?.kind).toBe('newAgent')
    store.open({ kind: 'externalMcpServers' })
    expect(store.overlay.value?.kind).toBe('externalMcpServers')
    store.close()
    expect(store.overlay.value).toBeNull()
  })

  it('says what did NOT happen, and clears it after a while', () => {
    // The timer is injected rather than faked with real time: a test that waited 3.2 seconds to
    // learn that a toast disappears is a test nobody runs.
    const scheduled: { fn: () => void; ms: number }[] = []
    const store = createOverlayStore((fn, ms) => void scheduled.push({ fn, ms }))
    store.notify("Preview only — dispatch isn't wired in Slice 2.")
    expect(store.toasts.value).toHaveLength(1)
    expect(store.toasts.value[0]?.text).toContain("isn't wired")
    // …for as long as the constant says. Without this the delay could be zero and the test would
    // still pass, because it calls the callback itself.
    expect(scheduled[0]?.ms).toBe(TOAST_MS)
    expect(TOAST_MS).toBeGreaterThan(2000)
    scheduled[0]?.fn()
    expect(store.toasts.value).toHaveLength(0)
  })

  it('dismisses the toast it was asked to dismiss, and only that one', () => {
    const store = createOverlayStore(() => {})
    store.notify('first')
    store.notify('second')
    const first = store.toasts.value[0]!
    store.dismiss(first.id)
    expect(store.toasts.value.map((toast) => toast.text)).toEqual(['second'])
  })
})
