import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ClosingShade from '../src/renderer/src/components/ClosingShade.vue'
import { watchClosing } from '../src/renderer/src/App.vue'

/**
 * 🔴 **What a person sees between ⌘Q and the app being gone** (271 §2, from `270` finding 1).
 *
 * `270` pressed ⌘Q on a fresh, idle instance and reported *"a dead-looking black app"*: the window
 * blanked, the process and its port stayed alive for 60.489 s, and nothing anywhere said the app
 * was closing. ⛔ **The window was told nothing because there was nothing to tell it with** — no
 * channel, no listener, no state. This file covers the renderer half of the answer.
 *
 * ⚠️ **What is HERE and what is in `test/dom/closing-shade.dom.test.ts`.** This file is SSR: it can
 * read markup and drive the subscription, and it has no layout, no cascade and no hit-testing. The
 * one claim that matters most — *the shade actually swallows a click aimed at the app behind it* —
 * is a compositing question, so it lives in the browser project. Both halves exist because either
 * one alone passes over the other's defect (083's whole argument).
 */

const src = dirname(fileURLToPath(import.meta.url))

const render = (): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(ClosingShade as never) }))

/** A `window.api` with only the piece under test on it. Restored by `afterEach`. */
function bridge(onClosing?: unknown): { fired: (() => void)[]; offs: number } {
  const state = { fired: [] as (() => void)[], offs: 0 }
  const api =
    onClosing === undefined
      ? {
          onClosing: (listener: () => void) => {
            state.fired.push(listener)
            return () => {
              state.offs += 1
            }
          },
        }
      : (onClosing as Record<string, unknown>)
  ;(globalThis as unknown as { window?: unknown }).window = { api }
  return state
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('the closing shade', () => {
  it('says the app is closing, and says what is being waited for', async () => {
    const html = await render()
    // The two halves of 270's complaint answered in two sentences: *that* something is happening,
    // and *what*. "Closing" alone is what a spinner says; a person who has just pressed ⌘Q on an
    // app with agents in it wants to know whether their transcripts are safe.
    expect(html).toContain('BroCrew is closing')
    expect(html).toContain('Stopping your agents and finishing their transcripts.')
  })

  it('offers no way to dismiss it, because a quit that has begun cannot be cancelled', async () => {
    const html = await render()
    // ⛔ `before-quit` has already been deferred and the four ordered steps are already running by
    // the time this is on screen, so a Cancel would be a control that cannot act (106/118) — and a
    // convincing one, which is worse.
    expect(html).not.toContain('<button')
    // The pairing: the negative above is only worth anything if something DID render.
    expect(html).toContain('data-cy="closing-shade"')
  })

  it('announces itself assertively, because the app is going away', async () => {
    const html = await render()
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="assertive"')
  })
})

/**
 * ⚑ **The subscription, exported from `App.vue` so it can be driven without a window** (271 §2).
 * `App.vue`'s `setup` is a `ref` and two lifecycle hooks around this function; the hooks are Vue's
 * and the interesting behaviour is all here.
 */
describe('subscribing to the announcement', () => {
  it('sets the flag when main says the app is closing', () => {
    const state = bridge()
    let closing = false
    watchClosing(() => {
      closing = true
    })

    expect(closing, 'the flag was set before anything was announced').toBe(false)
    expect(state.fired).toHaveLength(1)
    state.fired[0]!()
    expect(closing).toBe(true)
  })

  it('unsubscribes when the app unmounts', () => {
    const state = bridge()
    const stop = watchClosing(() => {})
    expect(state.offs).toBe(0)
    stop()
    expect(state.offs).toBe(1)
  })

  it('is a no-op with no preload at all, and does not throw', () => {
    ;(globalThis as unknown as { window?: unknown }).window = {}
    // ⚠️ Every SSR and dom test in this repo mounts components with no preload, so this is the
    // ordinary case there rather than a defensive corner — and a throw here would take the whole
    // app down at mount for the sake of a message only a real window can receive.
    expect(() => watchClosing(() => {})()).not.toThrow()
  })

  it('is a no-op against a preload too old to have the channel', () => {
    bridge({ getAppInfo: () => Promise.resolve({}) })
    // A build that shipped an older preload beside a newer renderer. The renderer must degrade to
    // "no shade", which is what the app did for its whole life before 271 — not to a blank window.
    expect(() => watchClosing(() => {})()).not.toThrow()
  })
})

/**
 * The mount point is three lines and a template, so what is asserted here is that those three lines
 * are wired to the two things above rather than to a copy of them.
 *
 * ⚠️ **A source scan, deliberately, and only for the wiring.** `App.vue` mounts `RuntimeScreen`,
 * which asks the bridge for app info, capabilities and profiles the moment it appears — so a test
 * that mounted `App.vue` to prove that `v-if` would be standing up the whole product to check one
 * attribute. The BEHAVIOUR both sides of that `v-if` is covered above and in the dom test.
 */
describe('the mount point', () => {
  const app = readFileSync(join(src, '../src/renderer/src/App.vue'), 'utf8')

  it('shows the shade only while closing', () => {
    // ⚠️ **`appClosing` and not a local `closing`, and 273 changed this line deliberately** (193 M5:
    // an old assertion is never quietly flipped). `272` found that the window is not the only reader
    // the announcement needed — both closed-conversation lists refresh themselves as the quit closes
    // each conversation — so the flag moved to `lib/app-closing.ts` and the shade became one of its
    // readers. ⚑ What this line is about has not changed: the shade is shown by the announcement and
    // by nothing else. `shutdown-door.test.ts` holds the other readers to the same module.
    expect(app).toMatch(/<ClosingShade v-if="appClosing" \/>/)
  })

  it('drives it from the announcement rather than from anything of its own', () => {
    // Same change, same reason: the handler is now the module's one writer, passed by name. The
    // fact being pinned is still that `watchClosing` is what sets it — see the note above.
    expect(app).toMatch(/stopWatching = watchClosing\(beginClosing\)/)
    // …and lets go on the way out, so a re-mounted app does not accumulate listeners.
    expect(app).toMatch(/onBeforeUnmount\(\(\) => stopWatching\?\.\(\)\)/)
  })

  /**
   * ⚠️ **The preload is the one hop above that nothing can execute** — it imports `electron` as a
   * value, so no test in this repository can load it, which is the same reason `index.ts` is source-
   * scanned in `app-lifetime.test.ts`. `watchClosing` above proves the renderer's end against a
   * fake; these two lines are all that can be said about the real one.
   */
  it('forwards the channel and hands back a real unsubscribe', () => {
    const preload = readFileSync(join(src, '../src/preload/index.ts'), 'utf8')
    expect(preload).toMatch(/ipcRenderer\.on\(APP_CLOSING_CHANNEL, forward\)/)
    // ⛔ The `off` is the half that rots silently: without it every re-mounted renderer would stack
    // another listener on a channel that fires exactly once, and nothing on screen would differ.
    expect(preload).toMatch(/ipcRenderer\.off\(APP_CLOSING_CHANNEL, forward\)/)
  })

  it('puts the shade OUTSIDE the screen, over the titlebar and the rail', () => {
    // ⛔ Inside `RuntimeScreen` it would leave a live-looking rail and a working New-conversation
    // button beside a message saying the app is closing — two answers to one fact, which is the
    // shape 076 §3 and 187 §1 both record this repository paying for.
    const template = app.slice(app.indexOf('<template>'))
    expect(template.indexOf('<RuntimeScreen />')).toBeLessThan(template.indexOf('<ClosingShade'))
    expect(template).not.toMatch(/<RuntimeScreen>[\s\S]*<ClosingShade/)
  })
})
