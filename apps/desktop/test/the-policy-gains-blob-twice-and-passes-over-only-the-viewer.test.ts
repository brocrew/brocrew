import { describe, expect, it } from 'vitest'
import {
  CSP_HEADER,
  PDF_VIEWER_ORIGIN,
  cspMetaTag,
  installCspHeaders,
  rendererCsp,
} from '../src/shared/content-security-policy'

/**
 * 🔴 D-032 · what the window's content security policy gained, and the one page it passes over.
 *
 * `tier-a-rendering.render.test.ts` pins `img-src` and `frame-src` exactly, and four URLs the header
 * exemption refuses. This file pins the rest of the claim: `blob:` arrived in those two directives
 * and in no other — not `script-src`, not `connect-src`, and no `worker-src` or `child-src` a blob
 * worker or frame could fall back to — in both builds and in the meta tag; and the exemption is the
 * viewer's own pages by their exact spelling, every one of them, judged response by response.
 */

/** The directives of a policy, by name. */
function directivesOf(policy: string): Map<string, readonly string[]> {
  return new Map(
    policy.split('; ').map((directive): [string, readonly string[]] => {
      const [name = '', ...values] = directive.split(' ')
      return [name, values]
    }),
  )
}

const POLICIES: readonly { readonly build: string; readonly policy: string }[] = [
  { build: 'packaged header', policy: rendererCsp(false) },
  { build: 'dev header', policy: rendererCsp(true) },
  { build: 'packaged meta tag', policy: cspMetaTag().attrs['content'] ?? '' },
]

describe('D-032 · `blob:` is in two directives and no third', () => {
  it.each(POLICIES)('⛔ $build: only img-src and frame-src name blob:', ({ policy }) => {
    const directives = directivesOf(policy)
    expect(directives.size, 'the policy was read').toBeGreaterThan(5)
    const naming = [...directives]
      .filter(([, values]) => values.includes('blob:'))
      .map(([name]) => name)
      .sort()
    expect(naming).toEqual(['frame-src', 'img-src'])
  })

  it.each(POLICIES)(
    '⛔ $build: script runs from the bundle alone, and nothing falls back past it',
    ({ policy }) => {
      const directives = directivesOf(policy)
      expect(directives.get('script-src')).toEqual([`'self'`])
      expect(directives.get('default-src')).toEqual([`'none'`])
      expect(directives.get('object-src')).toEqual([`'none'`])
      // A worker falls back to `child-src`, then `script-src`; neither of the first two is written,
      // so a `blob:` worker is held to `'self'`.
      expect(directives.has('worker-src')).toBe(false)
      expect(directives.has('child-src')).toBe(false)
      // The frame admits a blob and nothing else: no data: URL, no extension, not the app's own pages.
      expect(directives.get('frame-src')).toEqual(['blob:'])
    },
  )
})

describe('D-032 · the header passes over the PDF viewer’s own pages, and only those', () => {
  type Listener = Parameters<Parameters<typeof installCspHeaders>[0]['onHeadersReceived']>[0]
  type Answer = { responseHeaders?: Record<string, string | string[]> }

  const policy = rendererCsp(false)
  const VIEWERS_OWN = `script-src chrome://resources 'self'`

  /** The listener the header installs, and what it answers for one response. */
  const installed = (): ((url: string | undefined) => Answer) => {
    let listener: Listener | undefined
    installCspHeaders({ onHeadersReceived: (l) => (listener = l) }, policy)
    return (url) => {
      let sent: Answer = {}
      listener?.(
        { url, responseHeaders: { 'Content-Security-Policy': [VIEWERS_OWN], 'X-Kept': ['1'] } },
        (response) => (sent = response),
      )
      return sent
    }
  }

  it('⚑ every page of the viewer keeps Chromium’s policy: its index, its scripts, the PDF’s own frame', () => {
    const answer = installed()
    for (const url of [
      `${PDF_VIEWER_ORIGIN}/index.html`,
      `${PDF_VIEWER_ORIGIN}/main.js`,
      `${PDF_VIEWER_ORIGIN}/pdf/index.css`,
      `${PDF_VIEWER_ORIGIN}/5cddf959-c621-40aa-9af6-0308cbe7a250`,
    ]) {
      // Nothing is rewritten: the response goes on with the headers it came with.
      expect(answer(url), url).toEqual({})
    }
  })

  it('⛔ any other spelling of it gets the app’s policy, and loses the one it arrived with', () => {
    const answer = installed()
    const host = PDF_VIEWER_ORIGIN.slice('chrome-extension://'.length)
    for (const url of [
      `chrome-extension://${host}:443/index.html`,
      `chrome-extension://user@${host}/index.html`,
      `chrome-extension://${host.slice(0, -1)}/index.html`,
      `blob:${PDF_VIEWER_ORIGIN}/5cddf959-c621-40aa-9af6-0308cbe7a250`,
      `${PDF_VIEWER_ORIGIN.toUpperCase()}/index.html`,
      PDF_VIEWER_ORIGIN,
      'http://localhost:5290/',
      'brobot-asset://kept/chart.png',
      undefined,
    ]) {
      const sent = answer(url)
      expect(sent.responseHeaders?.[CSP_HEADER], String(url)).toEqual([policy])
      expect(JSON.stringify(sent), String(url)).not.toContain('chrome://resources')
      // The rest of the response is untouched.
      expect(sent.responseHeaders?.['X-Kept'], String(url)).toEqual(['1'])
    }
  })

  it('⚑ judged response by response: a viewer page between two of the app’s changes neither', () => {
    const answer = installed()
    const app =
      'file:///Applications/BroBot2.app/Contents/Resources/app.asar/out/renderer/index.html'
    expect(answer(app).responseHeaders?.[CSP_HEADER]).toEqual([policy])
    expect(answer(`${PDF_VIEWER_ORIGIN}/index.html`)).toEqual({})
    expect(answer(app).responseHeaders?.[CSP_HEADER]).toEqual([policy])
  })
})
