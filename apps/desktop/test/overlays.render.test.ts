import { describe, expect, expectTypeOf, it } from 'vitest'
import { createSSRApp, h, toRaw, watchSyncEffect, type Ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import DocumentBody from '../src/renderer/src/components/DocumentBody.vue'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'
import {
  TOAST_MS,
  createOverlayStore,
  type Overlay,
  type OverlayStore,
} from '../src/renderer/src/lib/overlay-store'

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
  it('exposes readonly refs, payloads and toast entries to its readers', () => {
    expectTypeOf<Pick<OverlayStore, 'overlay' | 'toasts'>>().toEqualTypeOf<{
      readonly overlay: Readonly<Ref<Readonly<Overlay> | null>>
      readonly toasts: Readonly<Ref<readonly { readonly id: number; readonly text: string }[]>>
    }>()
  })

  it('keeps the same refs and reactive overlay identity through its operations', () => {
    const store = createOverlayStore(() => {})
    const overlay = store.overlay
    const toasts = store.toasts
    const next: Overlay = { kind: 'startAsAgent', profileSlug: 'research' }
    const seen: (string | null)[] = []
    const stop = watchSyncEffect(() => {
      seen.push(store.overlay.value?.kind ?? null)
    })
    try {
      store.open(next)
      const shown = store.overlay.value
      expect(toRaw(shown)).toBe(next)
      store.open(next)
      expect(store.overlay.value).toBe(shown)
      store.open({ kind: 'externalMcpServers' })
      expect(store.overlay.value).not.toBe(shown)
      store.close()
      expect(store.overlay).toBe(overlay)
      expect(store.toasts).toBe(toasts)
      expect(seen).toEqual([null, 'startAsAgent', 'externalMcpServers', null])
    } finally {
      stop()
    }
  })

  it('keeps toast order, entry identity and timer ownership after dismissing an older toast', () => {
    const scheduled: { fn: () => void; ms: number }[] = []
    const store = createOverlayStore((fn, ms) => void scheduled.push({ fn, ms }))
    const toasts = store.toasts
    const firstId = store.notify('first')
    const firstList = store.toasts.value
    const first = firstList[0]
    const secondId = store.notify('second')
    expect(secondId).toBe(firstId + 1)
    expect(store.toasts.value).not.toBe(firstList)
    expect(store.toasts.value[0]).toBe(first)
    expect(scheduled.map(({ ms }) => ms)).toEqual([TOAST_MS, TOAST_MS])
    store.dismiss(firstId)
    const second = store.toasts.value[0]
    scheduled[0]?.fn()
    expect(store.toasts.value).toEqual([{ id: secondId, text: 'second' }])
    expect(store.toasts.value[0]).toBe(second)
    const beforeUnknownDismiss = store.toasts.value
    store.dismiss(-1)
    expect(store.toasts.value).not.toBe(beforeUnknownDismiss)
    expect(store.toasts.value[0]).toBe(second)
    scheduled[1]?.fn()
    expect(store.toasts.value).toEqual([])
    const thirdId = store.notify('third')
    expect(thirdId).toBe(secondId + 1)
    scheduled[0]?.fn()
    expect(store.toasts.value).toEqual([{ id: thirdId, text: 'third' }])
    expect(store.toasts).toBe(toasts)
  })

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
