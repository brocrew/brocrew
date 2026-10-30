/**
 * 🔴 **The clone `ipcRenderer.invoke` performs, in the tests that stand in for it** (361 §2).
 *
 * ## ⛔ The sentence this file exists for
 *
 * > *"Two of the four fields would have thrown at the bridge in the shipped app and two would have
 * > saved fine — and **no test in this repo could see it**, because every one of them injects an
 * > in-process bridge that clones nothing."* (`355`)
 *
 * Electron's own contract is that an `invoke` payload *"will be serialized with the Structured Clone
 * Algorithm, the same as `window.postMessage`"*. A test double is an ordinary function call, so the
 * payload arrives **by reference** and every value survives — a Vue reactive `Proxy`, a `Map`, a
 * function, a live getter. ⚑ **The double and the wire give the same answer for every cloneable
 * value**, which is the whole reason a test written against the double measures nothing about
 * cloneability: it is an assertion made where both readings agree.
 *
 * ## ⚠️ Three times, and each was fixed at its own call site
 *
 *  - `121` — `listLibrary({ filters })` sent `filters.value` off a `ref`. Every filter press failed
 *    at the wire and the surface reported a read error, having never asked. Fixed by spreading.
 *  - `218` — `send({ attachments })` sent members of a `reactive(new Map())`. *"The attachment never
 *    reached the host. From either surface. Since `3151a36`."* Fixed by {@link overTheWire}.
 *  - `355` — `setCapabilities({ grant })` sent the sheet's own edit objects. Fixed by a deep copy.
 *
 * ⛔ **Three fixes, no guard, and the fourth arrived anyway.** That is the shape `361` is about: a
 * convention nothing enforces decays, and this one decayed silently three times.
 *
 * ## ⚑ What this module is, and what it is not
 *
 * It is **not** a rule about how a renderer should build a payload — there is no right answer to
 * that, and `218`'s field-by-field copy, `121`'s spread and `355`'s `JSON` round trip are all
 * correct in their own place. It is the **moment** at which being wrong becomes visible: the
 * cheapest gate in the repo, rather than a live run or a person's hands.
 */

import { isProxy, isRef, toRaw } from 'vue'

/**
 * ⛔ **The members of the preload's `api` that are NOT `ipcRenderer.invoke`**, and therefore carry
 * nothing over a wire.
 *
 * ⚠️ **This list is DERIVED and PINNED, and the pin lives elsewhere on purpose.** A roster written
 * out by hand is one rename away from exempting a real invoke — so
 * `test/the-bridge-that-clones-nothing.test.ts` reads `src/preload/index.ts` and asserts that a
 * member is in this set if and only if its body has no `ipcRenderer.invoke` in it. This file cannot
 * make that assertion itself: it is imported by the browser project, which cannot read source.
 *
 *  - `onEvent` / `onLiveness` / `onClosing` / `onChanged` / `onLastDraftSave` / `onStates` /
 *    `onLocalZone` are `ipcRenderer.on` subscriptions. Their argument is a listener, which
 *    structured clone refuses by name — cloning it would turn every subscription in the suite red
 *    for a reason that has nothing to do with a payload. ⚑ **534 added the fourth, 744 the fifth,
 *    D-019 the sixth and D-031 the seventh**, and each went red here exactly as designed: the roster
 *    is derived from the preload and pinned against this set, so a new member has to be classified
 *    rather than absorbed.
 *  - `pathForDroppedFile` never leaves the preload. It hands a `File` to `webUtils`, synchronously,
 *    and `218`'s whole point is that no bytes cross: cloning the `File` would hand `webUtils` a
 *    different object than the one the drop produced.
 */
export const NOT_THE_WIRE: ReadonlySet<string> = new Set([
  'onState', // Setup progress is a passive main-to-renderer subscription.
  'onClosed', // Plugin-screen lifecycle push; the listener remains in preload.
  'onReviewInvalidated', // Passive review invalidation push; no payload or invoke.
  'onEvent',
  'onLiveness',
  'onClosing',
  // Native history gestures arrive as a push; the listener never crosses to main.
  'onNavigate',
  // 🔴 **534 · main→renderer, `runtime:changed`.** A subscription like the three above it, and the
  // MESSAGE it forwards is main's own — nothing in the renderer builds a payload for this channel,
  // which is what `361`'s rule is about.
  'onChanged',
  // 🔴 **744 · main→renderer, `app:last-draft-save`.** A subscription like `onClosing`, with no
  // payload at all: the quit asks, and the window answers through `saveDrafts`, which IS the wire.
  'onLastDraftSave',
  // 🔴 **D-019 · main→renderer, `runtime:states`.** `onChanged`'s shape: a subscription whose
  // MESSAGE is main's own — what each agent is doing now — and nothing in the renderer builds a
  // payload for it.
  'onStates',
  // 🔴 **D-031 · main→renderer, `app:local-zone-moved`.** `onStates`' shape: a subscription whose
  // MESSAGE is main's own — the Mac's time zone, read again — and nothing in the renderer builds a
  // payload for it.
  'onLocalZone',
  // ⚑ **Main→renderer, `runtime:providers-changed`.** `onChanged`'s shape: a subscription whose
  // MESSAGE is main's own — which provider fact moved — and nothing in the renderer builds a payload.
  'onProvidersChanged',
  'onLimitsDisplayChanged',
  'pathForDroppedFile',
])

/** Where in a payload the clone gave up, as a readable path: `grant.canSpawn[0]`. */
function nameThePath(trail: readonly (string | number)[]): string {
  return trail.reduce<string>(
    (so, step) =>
      typeof step === 'number' ? `${so}[${step}]` : so === '' ? step : `${so}.${step}`,
    '',
  )
}

/** What kind of thing this is, said the way the person reading the failure needs it said. */
function describe(value: unknown): string {
  if (isRef(value)) return 'a Vue `ref` (send `.value`, and copy it)'
  if (isProxy(value)) {
    return `a Vue reactive Proxy over ${Object.prototype.toString.call(toRaw(value))}`
  }
  if (typeof value === 'function') return 'a function'
  if (typeof value === 'symbol') return 'a symbol'
  return `${Object.prototype.toString.call(value)}, which structured clone refuses`
}

/**
 * ⚑ **The first member of `payload` that `structuredClone` will not take, named.**
 *
 * ⛔ **It must never throw and must always terminate**, because it runs only on the failure path —
 * a walk that died would replace the real diagnosis with its own. Hence the `seen` set for cycles
 * and the `try` around every probe.
 *
 * ⚠️ **Depth-first, and the descent happens on FAILURE.** Cloning a container tells you the
 * container is bad without saying which member did it — so a node that clones is not the culprit and
 * is returned on at once, and a node that does NOT clone is descended into to find the specific
 * child that made it fail. The node itself is named only when no child accounts for it, which is
 * what makes a bare `Proxy` report as itself rather than as one of its fields.
 *
 * ⚑ **A blind spot, and the schema is what covers it.** `ref(1)` — a ref holding a PRIMITIVE —
 * clones fine, into `{ _value: 1, … }`. Sending one instead of its `.value` therefore crosses this
 * wire and is refused one layer later by `runtimeCommandSchema`, as the wrong shape rather than as
 * an unclonable one. Measured on Node 24: `ref({ … })` and `computed(…)` both throw; `ref(1)` does
 * not.
 */
function whereItBreaks(
  payload: unknown,
  trail: readonly (string | number)[] = [],
  seen = new Set<unknown>(),
): string | null {
  if (payload === null || (typeof payload !== 'object' && typeof payload !== 'function')) {
    // A primitive can still be a symbol, which clone refuses.
    if (typeof payload !== 'symbol') return null
    return `${nameThePath(trail) || '(the payload)'} is ${describe(payload)}`
  }
  if (seen.has(payload)) return null
  seen.add(payload)
  try {
    structuredClone(payload)
    return null
  } catch {
    // ⛔ **A `ref` is named as a `ref` and NOT descended into.** Left to the walk it reports
    // `body._value is a Vue reactive Proxy` — more specific and less useful, because `_value` is
    // not a field anybody can fix. What went wrong is that a `.value` was forgotten.
    if (isRef(payload)) return `${nameThePath(trail) || '(the payload)'} is ${describe(payload)}`
    // This node is the culprit, unless one of its children is the more specific answer.
    // ⚠️ Reading the members can itself throw — a getter, or a `Proxy` whose handler refuses
    // `ownKeys` — and a walk that died here would replace the real diagnosis with its own.
    const entries = ((): [string | number, unknown][] => {
      try {
        return Array.isArray(payload)
          ? payload.map((member, index): [string | number, unknown] => [index, member])
          : Object.entries(payload as Record<string, unknown>)
      } catch {
        return []
      }
    })()
    for (const [key, member] of entries) {
      const deeper = whereItBreaks(member, [...trail, key], seen)
      if (deeper !== null) return deeper
    }
    return `${nameThePath(trail) || '(the payload)'} is ${describe(payload)}`
  }
}

/**
 * 🔴 **What `ipcRenderer.invoke` would carry, or the reason it would carry nothing.**
 *
 * ⛔ **The RETURN VALUE is the clone, not the original**, and handing that on is half the point: the
 * far side of a real wire holds a copy, so a fake that passed the original through would still let a
 * test observe a mutation the app can never see.
 *
 * ⚠️ **`structuredClone` is the mirror rather than an approximation.** Electron's `invoke` documents
 * the structured clone algorithm by name; measured on Node 24, both refuse a Vue reactive `Proxy`, a
 * `reactive(new Map())` and a function, and both accept a null-prototype object, a class instance
 * (as a plain object), a `Date` and a live getter (as its resolved value).
 */
export function asTheWireWouldCarry<T>(where: string, payload: T): T {
  try {
    return structuredClone(payload)
  } catch (cause) {
    const at = whereItBreaks(payload) ?? '(the walk could not say where)'
    throw new Error(
      `⛔ ${where} would not survive ipcRenderer.invoke — ${at}. The shipped app answers this ` +
        'with `DataCloneError: An object could not be cloned.` and the gesture does nothing. ' +
        'Send a plain copy of the value, not the reactive one (361).',
      { cause },
    )
  }
}

/**
 * ⛔ **Every function on an `api`-shaped stub, wrapped so its arguments cross a real wire.**
 *
 * ⚠️ **Named `everythingOverTheWire` because `overTheWire` is taken, by the fix it generalises.**
 * `session-store.ts` exports an `overTheWire` that copies `HandedPath` field by field — `218`'s
 * repair, at one call site. This is the same idea one level up: not a copy at a site somebody
 * remembered, but the wire itself, at every site there is.
 *
 * ⚠️ **A nested surface is descended into by SHAPE, not by the name `runtime`**, so a stub that
 * grows a second one is covered on the day it appears. ⛔ **And unconditionally** — the first draft
 * skipped any object with no function members of its own, which quietly waved through the commonest
 * stub in the whole project: `{ runtime: { … } }`, whose top level holds no functions at all. It
 * was caught by the DOM test below going green when it had to be red.
 *
 * ⚑ **Identity is preserved where nothing was wrapped.** A branch that changed nothing is returned
 * as it came in, so plain data on a stub keeps its identity and a DOM test comparing a stubbed
 * constant with `toBe` is entitled to its answer.
 */
export function everythingOverTheWire<T>(stub: T, prefix = 'api', depth = 0): T {
  // ⚠️ Own-property objects only, and a floor under the recursion. The real surface is two levels
  // deep; a stub carrying a cyclic data blob is not a reason for this to run forever.
  if (stub === null || typeof stub !== 'object' || Array.isArray(stub) || depth > 3) return stub
  const proto = Object.getPrototypeOf(stub) as unknown
  if (proto !== Object.prototype && proto !== null) return stub
  const wrapped: Record<string, unknown> = {}
  let changed = false
  for (const [name, member] of Object.entries(stub as Record<string, unknown>)) {
    const where = `${prefix}.${name}`
    if (typeof member !== 'function') {
      const deeper = everythingOverTheWire(member, where, depth + 1)
      wrapped[name] = deeper
      if (deeper !== member) changed = true
      continue
    }
    if (NOT_THE_WIRE.has(name)) {
      wrapped[name] = member
      continue
    }
    changed = true
    const answer = member as (...args: unknown[]) => unknown
    wrapped[name] = (...args: unknown[]): unknown => {
      // ⛔ **It REJECTS rather than throwing, and that is `221`'s line about this exact boundary**:
      // *"`ipcRenderer.invoke` returns a rejected promise and a synchronous throw travels
      // differently through a caller that forgot to await."* ⚠️ Electron's `invoke` is an `async`
      // function, so a clone that fails inside it becomes a rejection — which is why `218` saw
      // *"An object could not be cloned."* land in a `catch` on screen rather than a crash.
      let carried: unknown[]
      try {
        carried = args.map((argument, index) =>
          asTheWireWouldCarry(
            args.length === 1 ? where : `${where} argument ${index + 1}`,
            argument,
          ),
        )
      } catch (refusal) {
        return Promise.reject(refusal as Error)
      }
      return answer(...carried)
    }
  }
  return changed ? (wrapped as T) : stub
}
