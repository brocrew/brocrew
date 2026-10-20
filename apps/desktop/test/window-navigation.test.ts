import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { PDF_VIEWER_ORIGIN } from '../src/shared/content-security-policy'
import {
  GUARDED_NAVIGATION_EVENTS,
  SESSION_RELEASE_EVENTS,
  externalTarget,
  installNavigationGuard,
  installSessionRelease,
  permitsNavigation,
  permitsSubframe,
  type AppDocument,
} from '../src/main/window-navigation'

/**
 * Only the app's own document may hold the preload (050, from 048 §1 finding 2).
 *
 * The bug this replaces was not a missing guard, it was a guard aimed one level too wide: 017
 * permitted a SCHEME (`file://`) where it meant a DOCUMENT. So the tests below are mostly about
 * near-misses — a sibling file, a traversal, a redirect, an origin that merely starts with the right
 * characters — because anything further away was already refused and proves nothing.
 *
 * The last test is the non-vacuity proof: it runs the hostile URLs through 017's predicate, verbatim,
 * and asserts that it took every one of them. A test that only shows the new code saying no cannot
 * show that the new code says no to anything the old code said yes to.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/** A packaged install, spaces and all — the app bundle's own name has one on plenty of machines. */
const INDEX_HTML = resolve(
  '/Applications/Bro Bot2.app/Contents/Resources/app.asar/out/renderer/index.html',
)
const PACKAGED: AppDocument = { indexHtml: INDEX_HTML }
const INDEX_URL = pathToFileURL(INDEX_HTML).href

/** What electron-vite composes: `${protocol}//${host}:${port}`, no trailing slash. */
const DEV_SERVER_URL = 'http://localhost:5290'
const DEV: AppDocument = { indexHtml: INDEX_HTML, devServerUrl: DEV_SERVER_URL }

/** How a relative href in agent Markdown actually arrives: resolved against the loaded document. */
const asClicked = (href: string): string => new URL(href, INDEX_URL).href

describe('the packaged app permits exactly one document', () => {
  it('permits its own index.html — including the percent-encoded space', () => {
    expect(INDEX_URL, 'the fixture must exercise encoding, or it proves nothing').toContain('%20')
    expect(permitsNavigation(PACKAGED, INDEX_URL)).toBe(true)
  })

  it('permits it under a query or fragment — same file, same bytes', () => {
    // Allowed deliberately: both name the identical file, so no new code runs. `fileURLToPath` reads
    // only the path, which is why they land on the same comparison.
    //
    // The fragment case never actually reaches the guard — Electron does not raise a navigation
    // event for an in-page hash change — so this pins the predicate, not a live path.
    expect(permitsNavigation(PACKAGED, `${INDEX_URL}?reload=1`)).toBe(true)
    expect(permitsNavigation(PACKAGED, `${INDEX_URL}#/settings`)).toBe(true)
  })

  it('refuses a sibling file in its own directory', () => {
    // The shortest version of the attack: the agent writes next to us and links to it.
    const sibling = new URL('./evil.html', INDEX_URL).href
    expect(sibling.startsWith('file://'), '017 would have taken this').toBe(true)
    expect(permitsNavigation(PACKAGED, sibling)).toBe(false)
  })

  it('refuses a traversal, written the way a Markdown link would be', () => {
    // ⚠️ This is the exact path from the finding. markdown-it drops a literal `file:` href, so an
    // agent writes a RELATIVE one; the browser resolves it at click time and the result is a
    // `file://` URL that 017 welcomed. The URL parser folds the `..` segments before we see them,
    // and the folded path is not ours.
    const clicked = asClicked('../../../../../../../tmp/evil.html')
    expect(clicked).toBe(pathToFileURL(resolve('/tmp/evil.html')).href)
    expect(permitsNavigation(PACKAGED, clicked)).toBe(false)
  })

  it('refuses a path that merely STARTS WITH the document path', () => {
    // The same trick as the dev-origin one below, on the filesystem side. A prefix comparison would
    // take both of these.
    expect(permitsNavigation(PACKAGED, `${INDEX_URL}.evil.html`)).toBe(false)
    expect(permitsNavigation(PACKAGED, `${INDEX_URL}/../evil.html`)).toBe(false)
  })

  it('refuses a file URL with a host — that machine is not this machine', () => {
    expect(permitsNavigation(PACKAGED, 'file://evil.example/tmp/evil.html')).toBe(false)
    // Same document path, someone else's host.
    const withHost = INDEX_URL.replace('file://', 'file://evil.example')
    expect(permitsNavigation(PACKAGED, withHost)).toBe(false)
  })

  it('…except the spellings that are not really hosts, which ARE our document', () => {
    // ⚠️ Pinned because they surprised the review, and both were measured rather than reasoned
    // about. WHATWG normalizes `localhost` (any case) in a file URL to an EMPTY host — it means
    // "this machine" — so these arrive at the same path we packaged. Accepting them is right; a
    // reader of the `host !== ''` check above would not guess it.
    for (const candidate of [
      INDEX_URL.replace('file://', 'file://localhost'),
      INDEX_URL.replace('file://', 'file://LOCALHOST'),
      // On POSIX, four slashes normalize to this file. On Windows they spell a different UNC-like URL.
      ...(process.platform === 'win32' ? [] : [INDEX_URL.replace('file:///', 'file:////')]),
    ]) {
      expect(permitsNavigation(PACKAGED, candidate), candidate).toBe(true)
    }
    // …and the same spellings aimed anywhere else are still refused.
    expect(permitsNavigation(PACKAGED, 'file://localhost/tmp/evil.html')).toBe(false)
    expect(permitsNavigation(PACKAGED, 'file:////tmp/evil.html')).toBe(false)
  })

  it('refuses the dev server when there is no dev server', () => {
    // A packaged app has no `ELECTRON_RENDERER_URL`, so nothing on http is ever its document —
    // including a localhost server an agent could start itself.
    expect(permitsNavigation(PACKAGED, `${DEV_SERVER_URL}/`)).toBe(false)
    expect(permitsNavigation(PACKAGED, 'http://localhost:8080/')).toBe(false)
  })

  it('refuses everything that is not a document this app opens', () => {
    for (const candidate of [
      'https://evil.example/',
      'http://evil.example/',
      'about:blank',
      'data:text/html,<script>fetch("x")</script>',
      'javascript:void 0',
      'chrome://settings',
      'devtools://devtools/bundled/devtools_app.html',
      '//evil.example/x',
      'not a url',
      '',
    ]) {
      expect(permitsNavigation(PACKAGED, candidate), candidate).toBe(false)
    }
  })
})

describe('development permits the dev server entry, by exact origin', () => {
  it('permits the entry document, however the server spells it', () => {
    for (const candidate of [
      DEV_SERVER_URL,
      `${DEV_SERVER_URL}/`,
      `${DEV_SERVER_URL}/index.html`,
      `${DEV_SERVER_URL}/?t=1`,
    ]) {
      expect(permitsNavigation(DEV, candidate), candidate).toBe(true)
    }
  })

  it('refuses every origin that merely starts with the dev URL', () => {
    // ⚠️ The `startsWith` half of the defect. Each of these passes `url.startsWith(devUrl)` and each
    // is a different host — the third is the nastiest, because everything before the `@` is userinfo
    // and the real authority is `evil.example`.
    for (const candidate of [
      'http://localhost:52900/',
      'http://localhost:5290.evil.example/',
      'http://localhost:5290@evil.example/',
      'http://localhost:5290x/',
    ]) {
      expect(candidate.startsWith(DEV_SERVER_URL), 'the fixture must be a prefix').toBe(true)
      expect(permitsNavigation(DEV, candidate), candidate).toBe(false)
    }
  })

  it('refuses a different scheme, host or port on the same-looking authority', () => {
    for (const candidate of [
      'https://localhost:5290/',
      'http://127.0.0.1:5290/',
      'http://localhost:5291/',
    ]) {
      expect(permitsNavigation(DEV, candidate), candidate).toBe(false)
    }
  })

  it('refuses another path on the dev server itself — it serves the whole repository', () => {
    for (const candidate of [
      `${DEV_SERVER_URL}/evil.html`,
      `${DEV_SERVER_URL}/src/main/index.ts`,
      `${DEV_SERVER_URL}/../evil.html`,
    ]) {
      expect(permitsNavigation(DEV, candidate), candidate).toBe(false)
    }
  })

  it('refuses local files in dev — the packaged document is not the entry here', () => {
    expect(permitsNavigation(DEV, INDEX_URL)).toBe(false)
    expect(permitsNavigation(DEV, 'file:///tmp/evil.html')).toBe(false)
  })

  it('follows a base path, including the slash a reload adds', () => {
    // ⚠️ The version of this that compares `target.pathname === server.pathname` exactly REFUSES the
    // app's own document under `base: '/app/'`: electron-vite composes the URL without a trailing
    // slash and the reload asks for one. Refusing our own entry is the worst failure this guard has,
    // because it looks like the app is broken rather than like a link was blocked.
    const based = { indexHtml: INDEX_HTML, devServerUrl: 'http://localhost:5290/app' }
    for (const candidate of [
      'http://localhost:5290/app',
      'http://localhost:5290/app/',
      'http://localhost:5290/app/index.html',
    ]) {
      expect(permitsNavigation(based, candidate), candidate).toBe(true)
    }
    // …and it is still one document, not a directory.
    for (const candidate of [
      'http://localhost:5290/',
      'http://localhost:5290/app/evil.html',
      'http://localhost:5290/apple/',
    ]) {
      expect(permitsNavigation(based, candidate), candidate).toBe(false)
    }
  })

  it('refuses everything when the dev URL itself is opaque', () => {
    // `origin` is the literal string 'null' for `file:`/`data:`/`about:`, and two of those compare
    // EQUAL. Without the guard for it, pointing ELECTRON_RENDERER_URL at a file would make every
    // file URL on the machine the dev server.
    const opaque: AppDocument = { indexHtml: INDEX_HTML, devServerUrl: 'file:///tmp/dev.html' }
    expect(permitsNavigation(opaque, 'file:///tmp/evil.html')).toBe(false)
    expect(permitsNavigation(opaque, 'file:///tmp/dev.html')).toBe(false)
  })
})

describe('what gets handed to the real browser', () => {
  it('http and https, whatever the case', () => {
    expect(externalTarget('https://example.com/x')).toBe('https://example.com/x')
    expect(externalTarget('HTTP://Example.com/x')).toBe('HTTP://Example.com/x')
  })

  it('and nothing else — openExternal on an arbitrary scheme is its own way to launch something', () => {
    for (const candidate of [
      'file:///tmp/evil.html',
      'data:text/html,x',
      'javascript:void 0',
      'mailto:a@b.c',
      'ms-msdt:/id',
      'not a url',
      '',
    ]) {
      expect(externalTarget(candidate), candidate).toBeNull()
    }
  })
})

/**
 * A stand-in for the WebContents, recording what the guard registers and letting a test fire it.
 *
 * ⚠️ **`fire` puts an event on the wire; `gesture` puts a CLICK on the wire, and the difference is
 * why P4 shipped** (095, from 094 §6). Every hand-off test in this file used to call `fire` — a
 * handler, invoked directly, one event at a time — so it could assert what `will-navigate` DOES and
 * never that `will-navigate` HAPPENS. It happens for no click in this app, and the test was green
 * over a security boundary that did nothing for a year. Anything asserting a hand-off now goes
 * through `gesture`.
 */
function fakeContents(): {
  contents: WebContents
  registered: string[]
  fire: (event: string, url: string, extra?: Record<string, unknown>) => { prevented: boolean }
  /**
   * A click, delivered in the order Electron 43.2.0 delivers it — measured, and the measurement is
   * on {@link installNavigationGuard}. Returns the events that were actually REACHED, so a test can
   * assert the ordering rather than assume it.
   */
  gesture: (
    url: string,
    options?: { isMainFrame?: boolean },
  ) => { prevented: boolean; reached: string[] }
  /** Register a listener directly, for the tests that measure the instrument itself. */
  listen: (event: string, handler: (details: never) => void) => void
  openWindow: (url: string) => { action: string }
  attachWebview: () => { prevented: boolean }
  /** Whether ANYTHING was wired to this event — the whole of 094's assertion is a negative one. */
  listensTo: (event: string) => boolean
  /** Raise an event that carries no navigation payload (`did-navigate`, `destroyed`). */
  emit: (event: string, arg?: unknown) => void
} {
  const registered: string[] = []
  const listeners = new Map<string, (arg: never) => unknown>()
  let openHandler: ((details: { url: string }) => { action: string }) | null = null
  const contents = {
    on(event: string, listener: (arg: never) => unknown) {
      // ⚠️ Loud rather than last-wins (094 review). `wired()` installs the guard AND the release on
      // ONE fake, and this map held a single listener per name — so the day the two functions ever
      // registered the same event, the first handler would vanish with no error and every test that
      // fired it would silently exercise the other one.
      if (listeners.has(event)) throw new Error(`'${event}' is already registered on this fake`)
      registered.push(event)
      listeners.set(event, listener)
      return contents
    },
    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
      openHandler = handler
    },
  }
  const call = (event: string, arg: unknown): void => {
    const listener = listeners.get(event)
    if (!listener) throw new Error(`nothing is listening for '${event}'`)
    listener(arg as never)
  }
  const fire = (
    event: string,
    url: string,
    extra: Record<string, unknown> = {},
  ): { prevented: boolean } => {
    let prevented = false
    // `isMainFrame: true` is the default because that is what every one of these events reports
    // for a click in the app's own window; a subframe test passes `false` explicitly.
    call(event, {
      isMainFrame: true,
      ...extra,
      url,
      preventDefault: () => void (prevented = true),
    })
    return { prevented }
  }
  return {
    contents: contents as unknown as WebContents,
    registered,
    fire,
    /**
     * ⚠️ **Two rules, both measured on a real Electron 43.2.0 `BrowserWindow` (095) rather than read
     * off `electron.d.ts`, which says only that `will-frame-navigate` also fires for the main
     * frame:**
     *
     *  1. **`will-frame-navigate` is emitted FIRST.** On a window with nothing installed, a click
     *     logged `will-frame-navigate` → `will-navigate`, in that order, every time.
     *  2. **A cancel ends it there.** A window that prevented in `will-frame-navigate` alone never
     *     saw `will-navigate` at all, and the navigation was refused — Electron's throttle returns
     *     on the cancel. That is why the shipped guard, which prevents everything that is not its
     *     own document, logged `will-frame-navigate` and nothing else for all five gestures.
     *
     * `will-navigate` never fires for a subframe, which is the other half of "once per gesture".
     */
    gesture: (url, { isMainFrame = true } = {}) => {
      const reached = ['will-frame-navigate']
      const frame = fire('will-frame-navigate', url, { isMainFrame })
      if (frame.prevented || !isMainFrame) return { prevented: frame.prevented, reached }
      reached.push('will-navigate')
      return { prevented: fire('will-navigate', url, { isMainFrame }).prevented, reached }
    },
    listen: (event, handler) => void contents.on(event, handler),
    openWindow: (url) => {
      if (!openHandler) throw new Error('no window-open handler was installed')
      return openHandler({ url })
    },
    attachWebview: () => {
      let prevented = false
      call('will-attach-webview', { preventDefault: () => void (prevented = true) })
      return { prevented }
    },
    listensTo: (event) => listeners.has(event),
    emit: (event, arg) => call(event, arg),
  }
}

const guarded = (document: AppDocument) => {
  const fake = fakeContents()
  const opened: string[] = []
  installNavigationGuard(fake.contents, document, (url) => opened.push(url))
  return { ...fake, opened }
}

/**
 * 095 · the instrument, before anything is asserted with it.
 *
 * ⚠️ **A simulated delivery order is a claim about Electron, and this file has been wrong about
 * Electron twice.** 074 wrote a measured table that 094 found described an unguarded window, and
 * the hand-off was wired against it. So the two rules `gesture` encodes are pinned here as tests of
 * their own, against the probe output they came from — a `gesture` that quietly stopped delivering
 * `will-navigate`, or quietly kept delivering it after a cancel, would otherwise make every
 * hand-off test below mean something different without failing.
 */
describe('a gesture is delivered the way Electron 43 delivers one', () => {
  it('will-frame-navigate first, then will-navigate', () => {
    // Probe row 2: a window with nothing installed. Both events, in this order, every time.
    const fake = fakeContents()
    const seen: string[] = []
    for (const event of ['will-frame-navigate', 'will-navigate']) {
      fake.listen(event, (() => seen.push(event)) as never)
    }
    const outcome = fake.gesture('https://example.com/')
    expect(seen).toEqual(['will-frame-navigate', 'will-navigate'])
    expect(outcome.reached).toEqual(seen)
    expect(outcome.prevented, 'nothing prevented, so the navigation would have committed').toBe(
      false,
    )
  })

  it('…and a cancel in the first ends the gesture there', () => {
    // Probe row 3, and the sentence the whole task turns on: a window that prevented in
    // `will-frame-navigate` alone never saw `will-navigate`, and its document did not move.
    const fake = fakeContents()
    const seen: string[] = []
    fake.listen('will-frame-navigate', ((details: { preventDefault(): void }) => {
      seen.push('will-frame-navigate')
      details.preventDefault()
    }) as never)
    fake.listen('will-navigate', (() => seen.push('will-navigate')) as never)
    const outcome = fake.gesture('https://example.com/')
    expect(seen, 'will-navigate cannot be reached past a cancel').toEqual(['will-frame-navigate'])
    expect(outcome.reached).toEqual(seen)
    expect(outcome.prevented).toBe(true)
  })

  it('and a subframe raises only the frame event', () => {
    const fake = fakeContents()
    const seen: string[] = []
    for (const event of ['will-frame-navigate', 'will-navigate']) {
      fake.listen(event, (() => seen.push(event)) as never)
    }
    fake.gesture('https://example.com/', { isMainFrame: false })
    expect(seen).toEqual(['will-frame-navigate'])
  })
})

describe('the guard covers every surface that can put a document in this window', () => {
  it('registers exactly the events it lists, and lists exactly the events it registers', () => {
    // Both directions on purpose. Asserting only the first would pass with a fourth navigation event
    // handled but undocumented; asserting only the second would pass with one listed and forgotten.
    const { registered } = guarded(PACKAGED)
    expect(registered).toEqual([...GUARDED_NAVIGATION_EVENTS, 'will-attach-webview'])
  })

  it('refuses a hostile URL on EVERY navigation event, not just will-navigate', async () => {
    // ⚠️ Acceptance 3, and the assertion is at the guard rather than by inspection: a navigation
    // that is `preventDefault()`ed never commits, so no document loads, so nothing inherits the
    // preload. `will-redirect` matters most here — 017 checked the URL that was clicked and never
    // the one a 3xx sent the window to.
    for (const event of GUARDED_NAVIGATION_EVENTS) {
      const { fire, opened } = guarded(PACKAGED)
      expect(fire(event, asClicked('../../../../../../../tmp/evil.html')).prevented, event).toBe(
        true,
      )
      expect(opened, 'a local file is dropped, never handed to the OS').toEqual([])
    }
  })

  it('lets the app document through on the event its own load arrives by', () => {
    // ⚠️ **This used to be every event, and 074 split it.** "Is this our document" and "should this
    // window navigate to it AGAIN" are two questions (069 §1.5), and only a redirect can be the app
    // opening its own entry — measured against Electron 43: a programmatic `loadFile` raises none of
    // the three for the main frame, a click raises `will-frame-navigate` (and `will-navigate` too,
    // but only on a window that prevents nothing — 095), and a programmatic load through a 302
    // raises `will-redirect`. So this is the one that must still say yes, or a dev server that
    // redirects would refuse the app its own startup.
    for (const document of [PACKAGED, DEV] as const) {
      const { fire } = guarded(document)
      const base = document === PACKAGED ? INDEX_URL : `${DEV_SERVER_URL}/`
      // Every spelling `permitsNavigation` admits, not just the bare one (review). A dev server that
      // 3xx'd to `…/?v=2` would otherwise meet an untested branch during the app's own startup —
      // which is the one failure mode of this asymmetry that is not visible as a security hole.
      for (const url of [base, `${base}?v=2`, `${base}#top`]) {
        expect(fire('will-redirect', url).prevented, url).toBe(false)
      }
    }
  })

  it('refuses a SECOND navigation to its own document, which would drop every live session', () => {
    // ⚠️ Acceptance 7 (074, from 069 §1.5). `[refresh](?v=2)` carries no scheme, so markdown-it's
    // `BAD_PROTO_RE` passes it and it renders as a live anchor in a model's reply; the browser then
    // resolves it against the document URL into this app's own entry, which `permitsNavigation`
    // correctly says yes to. Measured: it is permitted in BOTH builds — packaged because
    // `fileURLToPath` drops the query, dev because `?v=2` leaves `pathname` as `/`.
    //
    // The cost is not a reload. `main/index.ts` USED to release the window's sessions on
    // `did-start-loading` — which fires for a load about to be refused — so one click on one line
    // of model-authored markdown ended
    // every conversation in the window.
    const selfNavigations = [
      [PACKAGED, `${INDEX_URL}?v=2`],
      [PACKAGED, `${INDEX_URL}#top`],
      [DEV, `${DEV_SERVER_URL}/?v=2`],
      [DEV, `${DEV_SERVER_URL}/index.html`],
    ] as const
    for (const [document, url] of selfNavigations) {
      for (const event of ['will-navigate', 'will-frame-navigate'] as const) {
        const { fire, opened } = guarded(document)
        expect(fire(event, url, { isMainFrame: true }).prevented, `${event} ${url}`).toBe(true)
        // Silent. In dev our own document is an `http:` URL, so a hand-off would answer the click by
        // opening the app's dev server in the user's browser — a second wrong answer.
        expect(opened, `${event} ${url}`).toEqual([])
      }
    }
  })

  it('…and that refusal is about the GESTURE, not about the URL', () => {
    // Non-vacuity for the pair above: the same URLs still pass `permitsNavigation`, so the test
    // above is proving the new per-event rule and not an accidental narrowing of what counts as our
    // document. If this ever fails, the refusal has moved into the predicate — where it would also
    // refuse the app's own startup.
    expect(permitsNavigation(PACKAGED, `${INDEX_URL}?v=2`)).toBe(true)
    expect(permitsNavigation(DEV, `${DEV_SERVER_URL}/?v=2`)).toBe(true)
  })

  it('a CLICK on a web link reaches the real browser — once', () => {
    // ⚠️ **The test this replaces fired `will-navigate` by hand and passed for a year over a
    // hand-off that never ran** (095, from 094 §6 P4). `gesture` is the whole fix: it delivers the
    // click the way Electron delivers one, so "the handler opens a tab" can no longer stand in for
    // "a click opens a tab".
    const { gesture, opened } = guarded(PACKAGED)
    const clicked = 'https://example.com/docs'
    const outcome = gesture(clicked)
    expect(outcome.prevented, 'the navigation is still refused').toBe(true)
    expect(
      outcome.reached,
      'the guard prevents in the first event, so the second never arrives',
    ).toEqual(['will-frame-navigate'])
    expect(opened, 'one click, one tab').toEqual([clicked])
  })

  it('and the rule this replaces would have handed off nothing at all', () => {
    // ⚠️ **NON-VACUITY**, in the shape of 017's-predicate-verbatim below: the pre-095 policy, run
    // through the same gesture. If `gesture` were merely a fancier `fire`, this would open a tab
    // too — it is only because the delivery is faithful that the old rule can be shown failing.
    //
    // The rule, from the comment it replaces: `will-navigate` hands off; `will-frame-navigate`
    // hands off "only for a SUBFRAME, since the main frame already did".
    const fake = fakeContents()
    const opened: string[] = []
    const old =
      (handsOff: (details: { isMainFrame?: boolean }) => boolean) =>
      (details: { url: string; isMainFrame?: boolean; preventDefault(): void }) => {
        details.preventDefault()
        if (handsOff(details)) opened.push(details.url)
      }
    fake.listen('will-frame-navigate', old((d) => d.isMainFrame === false) as never)
    fake.listen('will-navigate', old(() => true) as never)
    fake.gesture('https://example.com/docs')
    expect(opened, '094 measured this as `handedToBrowser: []`, and this is why').toEqual([])
  })

  it('a SUBFRAME link still reaches the browser — refusing is not the same as swallowing', () => {
    // `will-navigate` never fires for a subframe, so a rule that made the main frame the one that
    // hands off would drop an external link in an iframe silently. No iframe exists today — the
    // guard refuses the subframe's own load, measured — and the rule is written so it does not
    // have to.
    const { gesture, opened } = guarded(PACKAGED)
    const outcome = gesture('https://example.com/x', { isMainFrame: false })
    expect(outcome.prevented).toBe(true)
    expect(outcome.reached).toEqual(['will-frame-navigate'])
    expect(opened).toEqual(['https://example.com/x'])
  })

  it('a click at the app’s own document opens no tab and no window', () => {
    // The silence half, through a gesture rather than a handler: in dev our own document is an
    // `http:` URL, so a hand-off here would answer `[refresh](?v=2)` by opening the dev server in
    // the user's browser.
    for (const [document, url] of [
      [PACKAGED, `${INDEX_URL}?v=2`],
      [DEV, `${DEV_SERVER_URL}/?v=2`],
    ] as const) {
      const { gesture, opened } = guarded(document)
      expect(gesture(url).prevented, url).toBe(true)
      expect(opened, url).toEqual([])
    }
  })

  it('and a click at anything that is not a web link is dropped, never handed to the OS', () => {
    // `openExternal` on an arbitrary scheme is its own way to launch something (`ms-msdt:` is the
    // canonical one). Measured on the live probe too: a `mailto:` click reached the guard and
    // handed off nothing.
    for (const url of ['mailto:a@b.c', 'ms-msdt:/id', asClicked('../evil.html')]) {
      const { gesture, opened } = guarded(PACKAGED)
      expect(gesture(url).prevented, url).toBe(true)
      expect(opened, url).toEqual([])
    }
  })

  it('a redirect is refused but never opened — it is not a gesture', () => {
    const { fire, opened } = guarded(PACKAGED)
    expect(fire('will-redirect', 'https://example.com/y', { isMainFrame: true }).prevented).toBe(
      true,
    )
    expect(opened, 'the click that started it was already handled').toEqual([])
  })

  it('denies every window open, including one aimed at the app itself', () => {
    // A second window is a second preload. There is no url that earns one.
    const { openWindow, opened } = guarded(PACKAGED)
    for (const url of [INDEX_URL, 'file:///tmp/evil.html', 'https://example.com/']) {
      expect(openWindow(url).action, url).toBe('deny')
    }
    expect(opened, 'only the web link goes outside').toEqual(['https://example.com/'])
  })

  it('refuses to attach a webview — the one document that would get its own preload', () => {
    expect(guarded(PACKAGED).attachWebview().prevented).toBe(true)
  })
})

/**
 * 🔴 D-032 · one kind of subframe is admitted — a kept PDF, drawn by Chromium's viewer — and only in
 * the shape measured on Electron 43.2.0 (`permitsSubframe`'s table): the window's `blob:` iframe,
 * then the viewer's page the browser makes, then the PDF's own frame, which navigates to the viewer's
 * origin. Everything else stays refused.
 */
describe('D-032 · the one subframe a kept PDF loads in, and nothing else', () => {
  const BLOB = 'blob:file:///7f9c0b1e-2d3a-4c5b-9e8f-0a1b2c3d4e5f'
  const DEV_BLOB = `blob:${DEV_SERVER_URL}/7f9c0b1e-2d3a-4c5b-9e8f-0a1b2c3d4e5f`
  const VIEWER_PAGE = `${PDF_VIEWER_ORIGIN}/index.html`
  const PDF_FRAME = `${PDF_VIEWER_ORIGIN}/5cddf959-c621-40aa-9af6-0308cbe7a250`

  /**
   * The last of `urls` as a frame, each one above it its parent, and the window's own frame at the
   * top — `WebFrameMain`'s two fields.
   */
  const frameUnder = (...urls: string[]): { url: string; parent: unknown } => {
    let frame: { url: string; parent: unknown } = { url: INDEX_URL, parent: null }
    for (const url of urls) frame = { url, parent: frame }
    return frame
  }

  it('admits the blob the window minted, directly under it, and the PDF frame under the viewer', () => {
    expect(permitsSubframe(PACKAGED, BLOB, [])).toBe(true)
    expect(permitsSubframe(PACKAGED, PDF_FRAME, [VIEWER_PAGE, BLOB])).toBe(true)
    expect(permitsSubframe(DEV, DEV_BLOB, [])).toBe(true)
    // ⛔ The viewer's own page is made by the browser and raises no navigation (measured), so one
    // asked for directly under the blob is not the shape that was measured, and is refused.
    expect(permitsSubframe(PACKAGED, VIEWER_PAGE, [BLOB])).toBe(false)
  })

  it('refuses a blob anywhere but directly under the window', () => {
    expect(permitsSubframe(PACKAGED, BLOB, [BLOB])).toBe(false)
    expect(permitsSubframe(PACKAGED, BLOB, [VIEWER_PAGE, BLOB])).toBe(false)
  })

  it('refuses a blob another origin minted', () => {
    for (const url of [
      'blob:https://example.com/7f9c0b1e-2d3a-4c5b-9e8f-0a1b2c3d4e5f',
      'blob:file://evil.example/7f9c0b1e',
      'blob:null/7f9c0b1e',
      DEV_BLOB,
    ]) {
      expect(permitsSubframe(PACKAGED, url, []), url).toBe(false)
    }
    for (const url of [
      BLOB,
      `blob:${DEV_SERVER_URL}0/7f9c0b1e`,
      'blob:http://localhost/7f9c0b1e',
    ]) {
      expect(permitsSubframe(DEV, url, []), url).toBe(false)
    }
  })

  it('refuses the viewer anywhere but under such a blob', () => {
    expect(permitsSubframe(PACKAGED, VIEWER_PAGE, [])).toBe(false)
    expect(permitsSubframe(PACKAGED, PDF_FRAME, [])).toBe(false)
    expect(permitsSubframe(PACKAGED, PDF_FRAME, [VIEWER_PAGE])).toBe(false)
    expect(permitsSubframe(PACKAGED, PDF_FRAME, ['https://example.com/', BLOB])).toBe(false)
    expect(permitsSubframe(PACKAGED, PDF_FRAME, [VIEWER_PAGE, VIEWER_PAGE, BLOB])).toBe(false)
    expect(permitsSubframe(PACKAGED, PDF_FRAME, [VIEWER_PAGE, DEV_BLOB])).toBe(false)
    // ⛔ Another extension, or the viewer's id behind a user, a port or a longer host — in the
    // measured tree, as the frame asked for and as the page above it.
    for (const url of [
      'chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh/x',
      `chrome-extension://evil@${PDF_VIEWER_ORIGIN.slice('chrome-extension://'.length)}/x`,
      `${PDF_VIEWER_ORIGIN}:8080/x`,
      `${PDF_VIEWER_ORIGIN}.evil/x`,
    ]) {
      expect(permitsSubframe(PACKAGED, url, [VIEWER_PAGE, BLOB]), url).toBe(false)
      expect(permitsSubframe(PACKAGED, PDF_FRAME, [url, BLOB]), url).toBe(false)
    }
  })

  it('refuses every other URL in a subframe, as before', () => {
    for (const url of [
      'https://example.com/',
      'data:text/html,<p>hi</p>',
      'file:///tmp/evil.html',
      INDEX_URL,
      'about:blank',
    ]) {
      expect(permitsSubframe(PACKAGED, url, []), url).toBe(false)
      expect(permitsSubframe(PACKAGED, url, [VIEWER_PAGE, BLOB]), url).toBe(false)
    }
  })

  it('through the installed guard: admitted on will-frame-navigate, in a subframe, with its tree', () => {
    const { fire, opened } = guarded(PACKAGED)
    const sub = (url: string, frame: unknown) => ({ isMainFrame: false, frame })
    expect(fire('will-frame-navigate', BLOB, sub(BLOB, frameUnder(BLOB))).prevented).toBe(false)
    expect(
      fire(
        'will-frame-navigate',
        PDF_FRAME,
        sub(PDF_FRAME, frameUnder(BLOB, VIEWER_PAGE, PDF_FRAME)),
      ).prevented,
    ).toBe(false)
    // ⛔ …and refused without the tree, as a redirect, or in the window's own frame.
    expect(fire('will-frame-navigate', BLOB, { isMainFrame: false }).prevented).toBe(true)
    expect(fire('will-frame-navigate', BLOB, sub(BLOB, null)).prevented).toBe(true)
    expect(fire('will-redirect', BLOB, sub(BLOB, frameUnder(BLOB))).prevented).toBe(true)
    expect(fire('will-frame-navigate', BLOB, { isMainFrame: true }).prevented).toBe(true)
    expect(fire('will-navigate', BLOB, { isMainFrame: true }).prevented).toBe(true)
    // ⛔ The window's own frame, named as such, whatever `isMainFrame` says.
    expect(
      fire('will-frame-navigate', BLOB, { isMainFrame: true, frame: frameUnder() }).prevented,
    ).toBe(true)
    expect(fire('will-frame-navigate', BLOB, sub(BLOB, frameUnder())).prevented).toBe(true)
    // ⛔ A frame that cannot be read — its process is gone — is refused, not let past.
    const gone = {
      url: BLOB,
      get parent(): never {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed')
      },
    }
    expect(fire('will-frame-navigate', BLOB, sub(BLOB, gone)).prevented).toBe(true)
    expect(opened, 'a blob or the viewer is never handed to the browser').toEqual([])
  })
})

/**
 * 🔴 D-032 · what may make a blob URL, or a frame, in the window — named here, file by file.
 *
 * ⚠️ The policy and the guard admit any `blob:` the app's document mints as a frame — they cannot see
 * its type — and measured on Electron 43.2.0, a page or an SVG framed as a `blob:` by mistake ran a
 * script from a local file and reached `api`. So what keeps them out is the window:
 *
 *  - ⛔ **one file makes blob URLs**, `lib/kept-file-urls.ts`, which never makes one of an SVG and
 *    makes a frame's URL only for `application/pdf` (its own test pins both);
 *  - ⛔ **one file makes a frame**, `components/KeptFileDrawing.vue`, the viewer's drawing of a kept
 *    PDF, framing only `pdfFrameUrl`'s URL; and none makes an embedded document.
 *
 * Counted in every source file of this app the window is built from: the renderer's own tree, what
 * it takes from `shared/`, its preload and its page. ⚠️ Not in its dependencies, none of which makes
 * a blob URL or a frame today.
 */
describe('D-032 · nothing in the window makes a blob URL or a frame but the files named', () => {
  const MAY_MAKE_A_BLOB_URL: readonly string[] = ['src/renderer/src/lib/kept-file-urls.ts']
  const MAY_MAKE_A_FRAME: readonly string[] = ['src/renderer/src/components/KeptFileDrawing.vue']
  const BLOB_URLS = [/\bcreateObjectURL\b/]
  const FRAMES = [
    /<iframe\b/i,
    // ⚑ The tag as a string: `h('iframe')`, `createVNode`, `createElement("IFRAME")`, `:is="… 'iframe'"`.
    /['"`]iframe['"`]/i,
    /\bsrcdoc\b/i,
    /<object\b/i,
    /<embed\b/i,
  ]
  // ⚠️ Only comments that open a line: a `/*` or `<!--` inside a string (`accept="image/*"`) would
  // otherwise hide the code after it. A comment counted by mistake is a false alarm, never a miss.
  const codeOf = (source: string): string =>
    source
      .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
      .replace(/^[ \t]*<!--[\s\S]*?-->/gm, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
  const found = (ways: readonly RegExp[], source: string): number =>
    ways.filter((way) => way.test(codeOf(source))).length

  /** Each file the renderer is built from, by its name under `apps/desktop`, and its source. */
  const rendererSources = (): Map<string, string> => {
    const sources = new Map<string, string>()
    const look = (file: string): void =>
      void sources.set(
        relative(join(HERE, '..'), file).replaceAll('\\', '/'),
        readFileSync(file, 'utf8'),
      )
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) walk(child)
        else if (/\.(ts|vue)$/.test(entry.name)) look(child)
      }
    }
    walk(join(HERE, '../src/renderer/src'))
    walk(join(HERE, '../src/shared'))
    walk(join(HERE, '../src/preload'))
    look(join(HERE, '../src/renderer/index.html'))
    return sources
  }

  it('no file but the ones named makes a blob URL, a frame or an embedded document', () => {
    const sources = rendererSources()
    expect(
      sources.size,
      'the walk read no renderer source — this test has stopped testing anything',
    ).toBeGreaterThan(100)
    const makes = (ways: readonly RegExp[]): string[] =>
      [...sources]
        .filter(([, source]) => found(ways, source) > 0)
        .map(([name]) => name)
        .sort()
    expect(makes(BLOB_URLS)).toEqual([...MAY_MAKE_A_BLOB_URL].sort())
    expect(makes(FRAMES)).toEqual([...MAY_MAKE_A_FRAME].sort())
  })

  it('…and the census can find each way, and passes over prose that names one', () => {
    for (const planted of [
      '<iframe :src="url" />',
      "document.createElement('iframe')",
      "h('iframe', { src })",
      "<component :is=\"isPdf ? 'iframe' : 'img'\" />",
      'frame.srcdoc = html',
      '<object data="x.svg"></object>',
      '<embed src="x.pdf">',
    ]) {
      expect(found(FRAMES, planted), planted).toBeGreaterThan(0)
    }
    expect(found(BLOB_URLS, 'URL.createObjectURL(blob)')).toBe(1)
    expect(found(FRAMES, '/** no frame, no srcdoc here */')).toBe(0)
    expect(found(BLOB_URLS, '/** and no createObjectURL here */')).toBe(0)
    expect(found(FRAMES, '<!-- an <iframe> would be wrong here -->')).toBe(0)
    // ⛔ …and a comment opener inside a string hides nothing after it.
    expect(found(FRAMES, '<input accept="image/*" />\n<iframe :src="url" />')).toBe(1)
    expect(found(BLOB_URLS, "const done = 'failed/**interrupted**'\nURL.createObjectURL(b)")).toBe(
      1,
    )
  })
})

describe('the guard is not optional', () => {
  it('every window this app creates is guarded', () => {
    // A structural check, in the shape 043 established: the predicate is only a boundary if it is
    // installed on every surface that has a preload, and the install is one line a future window
    // could forget.
    //
    // It walks the WHOLE main-process tree, not just `index.ts` — the first version read one file,
    // and a second window in any other file would have passed it unguarded, which is precisely the
    // hole this test exists to close.
    //
    // ⚠️ What it still cannot see: a file that creates a window AND calls the guard for a DIFFERENT
    // WebContents. That is why the call sits directly under the constructor in `index.ts`, and it is
    // the reason to keep it there.
    const offenders: string[] = []
    const makers: string[] = []
    let windows = 0
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(child)
          continue
        }
        if (!entry.name.endsWith('.ts')) continue
        const source = readFileSync(child, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
        const built = (source.match(/new BrowserWindow\(/g) ?? []).length
        if (built === 0) continue
        windows += built
        makers.push(`${relative(join(HERE, '../src/main'), child)} × ${String(built)}`)
        if (!source.includes('installNavigationGuard(')) offenders.push(child)
      }
    }
    walk(join(HERE, '../src/main'))
    // Two windows, one in each file: the app's own, and the recovery window a start that cannot
    // open its data ends in. Each has a preload, so each is guarded.
    expect(windows, 'no window is created at all — this test has stopped testing anything').toBe(2)
    expect(makers.sort()).toEqual(['index.ts × 1', 'recovery-window.ts × 1'])
    expect(offenders, 'a window is created in a file that never installs the guard').toEqual([])
  })

  it('and the guard would have caught what 017 let through', () => {
    // ⚠️ NON-VACUITY. 017's predicate, verbatim from the commit this replaces. If the hostile
    // fixtures above were merely exotic, this would fail — the old code has to ACCEPT them for the
    // new code refusing them to mean anything.
    const seventeen = (url: string): boolean =>
      url.startsWith('file://') || url.startsWith(DEV_SERVER_URL)

    const NOW_REFUSED = [
      asClicked('../../../../../../../tmp/evil.html'),
      new URL('./evil.html', INDEX_URL).href,
      'file:///tmp/evil.html',
      'file://evil.example/tmp/evil.html',
      `${DEV_SERVER_URL}@evil.example/`,
      `${DEV_SERVER_URL}0/`,
      `${DEV_SERVER_URL}.evil.example/`,
      `${DEV_SERVER_URL}/evil.html`,
    ]
    for (const url of NOW_REFUSED) {
      expect(seventeen(url), `017 refused ${url}, so it proves nothing`).toBe(true)
      expect(permitsNavigation(PACKAGED, url) || permitsNavigation(DEV, url), url).toBe(false)
    }
  })
})

/**
 * 094 · a refused navigation must not cost a single session (069 §1.5, measured by 093, fixed here).
 *
 * The guard above was never the problem. The release was: it hung off `did-start-loading`, which
 * Chromium raises the moment a load begins — before anyone is asked whether it may. So the app
 * refused the navigation, kept its document, and closed every conversation anyway.
 *
 * ⚠️ **The events named below are not chosen from Electron's documentation, they are measured**, on
 * a real `BrowserWindow` running this very module. {@link SESSION_RELEASE_EVENTS} carries the table.
 */
describe('sessions are released by a navigation that happened, never by one that was attempted', () => {
  /** Both installed on ONE WebContents, exactly as `createWindow` does it. */
  const wired = (document: AppDocument) => {
    const fake = fakeContents()
    const released: string[] = []
    installNavigationGuard(fake.contents, document, () => {})
    installSessionRelease(fake.contents, () => released.push('released'))
    return { ...fake, released }
  }

  it('registers exactly the events it lists, and lists exactly the events it registers', () => {
    // Both directions, in the shape the guard's own registration test uses: one direction alone
    // would pass with an event handled but undocumented, the other with one listed and forgotten.
    const fake = fakeContents()
    installSessionRelease(fake.contents, () => {})
    expect(fake.registered).toEqual([...SESSION_RELEASE_EVENTS])
  })

  it.each(['did-start-loading', 'did-start-navigation'])(
    'nothing is wired to %s — the event that fires for a load about to be refused',
    (event) => {
      // ⚠️ **This is the whole defect, as a negative.** Both of these were measured firing for a
      // click the guard then refused: `did-start-loading` is the one 074 left wired, and
      // `did-start-navigation` is the trap in the obvious fix — Electron raises it from
      // `WillStartRequest`, BEFORE it consults `will-frame-navigate`, so it is wrong for a subtler
      // reason. Asserted on the WebContents rather than by reading the source — though only for
      // what these two functions register: a listener added directly in `createWindow`, bypassing
      // them both, is invisible here and is what the structural test below is for. (Corrected in
      // review, which caught this claiming more than it can see.)
      const fake = wired(PACKAGED)
      // Paired positive, in the SAME test (review): `listensTo` is the whole instrument here, and a
      // version of it that always answered `false` would make every assertion below pass over
      // nothing at all.
      expect(fake.listensTo('did-navigate'), 'positive: listensTo can say yes').toBe(true)
      expect(fake.listensTo(event)).toBe(false)
    },
  )

  it('a click on a link to the app’s own document releases nothing', () => {
    // 069 §1.5 end to end, at the seam where the two halves meet: the gesture, the refusal, and
    // the sessions in one test. `?v=2` is the spelling a model writes as `[refresh](?v=2)`.
    for (const href of ['?v=2', 'index.html']) {
      const { fire, released } = wired(PACKAGED)
      expect(fire('will-frame-navigate', asClicked(href)).prevented, href).toBe(true)
      expect(released, `"${href}" was refused and still cost the conversations`).toEqual([])
    }
  })

  it('a click at anything else releases nothing either', () => {
    // The ordinary refusal. It never replaced the document, so it never lost the renderer's
    // memory of its sessions — the same argument, and it was equally broken.
    //
    // ⚠️ Through `gesture`, not `fire('will-navigate', …)` — corrected in review. Firing that event
    // by hand exercises a handler this app never reaches, and since 095 that handler also hands the
    // URL to the browser, which this harness's no-op `openExternal` silently swallows. A test that
    // drives an unreachable path is the shape the whole task is about.
    const { gesture, released } = wired(PACKAGED)
    expect(gesture('https://example.com/').prevented).toBe(true)
    expect(gesture(asClicked('../evil.html')).prevented).toBe(true)
    expect(released).toEqual([])
  })

  it('but a document that really was replaced still releases them', () => {
    // ⚠️ **The reason the wiring exists, and the half a careless fix would silently drop.** A
    // renderer that has been replaced has forgotten its session ids, so its providers would run on
    // with nothing able to answer them. `did-navigate` is what a `webContents.reload()` — ⌘R, the
    // menu, devtools — actually raises; measured, alongside the refusals above.
    const navigated = wired(PACKAGED)
    navigated.emit('did-navigate', undefined)
    expect(navigated.released).toEqual(['released'])

    const destroyed = wired(PACKAGED)
    destroyed.emit('destroyed', undefined)
    expect(destroyed.released, 'a window that is gone holds nothing either').toEqual(['released'])
  })

  it('…and so does a renderer that CRASHED, which neither of those covers', () => {
    // ⚠️ 095, from 094 §6 and the dispatch's §4. Measured by calling `forcefullyCrashRenderer()` on
    // the probe window: exactly one event arrived, `render-process-gone` — no `did-navigate`, no
    // `destroyed`, because the window is still open and still holding a dead renderer. Until this
    // line every provider in that window ran on with nobody left to answer it.
    const crashed = wired(PACKAGED)
    crashed.emit('render-process-gone', undefined)
    expect(crashed.released, 'a crash orphans exactly what a reload does').toEqual(['released'])
  })
})

describe('the release is not optional, and not re-wirable to an attempt', () => {
  it('every window this app creates releases its sessions, and by the measured events only', () => {
    // Structural, in the shape the guard's own install test established, and for the same reason:
    // `installSessionRelease` is one line a future window could forget, and the events it must NOT
    // use are one line a future author could add back — in `createWindow` or anywhere else in the
    // main process. The behavioural tests above cannot see either.
    const sources: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) walk(child)
        else if (entry.name.endsWith('.ts')) sources.push(child)
      }
    }
    walk(join(HERE, '../src/main'))

    const offenders: string[] = []
    let windows = 0
    for (const file of sources) {
      // Comments stripped first: this file and `window-navigation.ts` both DISCUSS
      // `did-start-loading` at length, and the discussion is the point — it is the code that must
      // not do it.
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const built = (source.match(/new BrowserWindow\(/g) ?? []).length
      windows += built
      if (built > 0 && !source.includes('installSessionRelease(')) offenders.push(file)
      for (const attempt of ['did-start-loading', 'did-start-navigation']) {
        if (source.includes(`'${attempt}'`)) offenders.push(`${file} listens for ${attempt}`)
      }
    }
    // The app's own window and the recovery window, as the guard's census above counts them.
    expect(windows, 'no window is created at all — this test has stopped testing anything').toBe(2)
    expect(offenders).toEqual([])
  })
})

describe('a file DROPPED on the window (218 §1)', () => {
  /**
   * ⛔ **What a drop would do, decided rather than observed.**
   *
   * Dropping a file on an Electron window navigates it to that file by default, and
   * `installSessionRelease` closes every conversation the window owns on `did-navigate` (062; 094
   * measured `webContents.reload()` as the one gesture in its table that reaches it). A drop is a
   * different entry point into the same guard and nothing had ever tested it.
   *
   * ⚠️ **`scripts/drop-hazard-probe.mjs` cannot settle this and says so.** It drives real trusted
   * drags through CDP and the payload arrives — a page that accepts them receives `files=1` in all
   * five zones — but a synthesised drop performs **no default action**: its URL control, which
   * drops `https://example.com/` on a page that refuses it, produced no navigation attempt at all.
   * So "nothing happened" there is a fact about CDP, not about this window, and the probe reports
   * INCONCLUSIVE rather than SAFE.
   *
   * ⚑ **What IS decidable is what the guard would do**, and these are the three links of it. The
   * event coverage is already pinned above; `nav-order-probe` measured that a refusal at
   * `will-frame-navigate` ends the throttle, so nothing reaches `did-navigate` and nothing is
   * released.
   */
  it('🔴 a dropped file is NOT this window\u2019s document, so the navigation is refused', () => {
    // Whatever a person drops is some other path — the one thing it can never be is our index.
    expect(permitsNavigation(PACKAGED, 'file:///Users/someone/Desktop/report.pdf')).toBe(false)
    expect(permitsNavigation(PACKAGED, 'file:///Users/someone/dev/project')).toBe(false)
    expect(permitsNavigation(PACKAGED, 'file:///tmp/notes.md')).toBe(false)

    // ⚑ The paired positive: our own document still navigates, or "refused" would be trivially
    // true and this would be pinning nothing.
    expect(permitsNavigation(PACKAGED, INDEX_URL)).toBe(true)
  })

  it('🔒 …and it is not handed to the BROWSER either — nothing opens in Finder', () => {
    // ⛔ The second thing a drop could do, and the one nobody would think to look for: the guard
    // refuses AND hands gestures off to the browser. If that hand-off took `file:` URLs, dropping
    // a file would open it in whatever application owns that extension — a side effect on the
    // user\u2019s machine from a gesture they meant for BroBot. It is http/https only.
    expect(externalTarget('file:///Users/someone/Desktop/report.pdf')).toBeNull()
    expect(externalTarget('file:///tmp/notes.md')).toBeNull()

    // ⚑ The paired positive: a real external link still reaches the browser.
    expect(externalTarget('https://example.com/docs')).toBe('https://example.com/docs')
  })
})
