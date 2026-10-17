/**
 * 🔴 **`window.api` is a WIRE in this project, not a call** (361 §2).
 *
 * ## ⛔ Why this is a setup file and not a helper
 *
 * Thirty-six DOM tests install their own `window.api` stub, by five different spellings, and not one
 * of them clones. ⚠️ **A helper they would each have to remember to call is the thing that already
 * failed**: `218` fixed the send path, `121` fixed the library path, `355` fixed the capabilities
 * path, and `361` exists because the fourth one arrived anyway. So the interception is on the
 * ASSIGNMENT — every stub that has ever been written and every stub that will be, with no edit to
 * any test file and nothing for anyone to remember.
 *
 * ## ⚠️ On `Window.prototype`, and that is load-bearing
 *
 * Ten DOM tests `delete window.api` in an `afterEach`. An accessor defined as an OWN property of
 * `window` is removed by that delete, and every later test in the file would then run through an
 * un-armed wire — ⛔ **a guard that disarms itself halfway down a file is worse than no guard**,
 * because the suite still reports green. Defined on the prototype instead:
 *
 *  - `window.api = stub` finds this setter up the chain and installs a wrapped OWN accessor;
 *  - a second assignment hits that own setter and is wrapped again;
 *  - `delete window.api` removes the own accessor and falls back to the getter below, which is
 *    exactly the pre-assignment state — and the trap is still here for the next assignment.
 *
 * ⚑ **The one visible change: `'api' in window` is now always true.** It was false before any stub
 * was installed. One test read it (`launcher-layout.dom.test.ts`, to decide whether to clean up),
 * and it now always cleans up, which is what it wanted in the first place.
 */

import { everythingOverTheWire } from '../../lib/the-wire'

/** ⚑ Exported so a test can assert the trap is ARMED rather than assert against a wire that is not. */
export const THE_WIRE_IS_ARMED = 'window.api is wrapped by test/dom/setup/the-window-is-a-wire.ts'

declare global {
  interface Window {
    /** What {@link THE_WIRE_IS_ARMED} is written to, so the arming is observable from a test. */
    __theWire?: string
  }
}

const surface = window as unknown as { __theWire?: string }
surface.__theWire = THE_WIRE_IS_ARMED

Object.defineProperty(Object.getPrototypeOf(window) as object, 'api', {
  configurable: true,
  enumerable: false,
  get(): unknown {
    return undefined
  },
  set(this: object, stub: unknown): void {
    let held = everythingOverTheWire(stub)
    Object.defineProperty(this, 'api', {
      configurable: true,
      enumerable: true,
      get: (): unknown => held,
      set: (next: unknown): void => {
        held = everythingOverTheWire(next)
      },
    })
  },
})
