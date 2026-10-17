import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref, type Component } from 'vue'
// ⚠️ The MODULE, not the barrel — `@brobot2/runtime`'s index reaches `node:fs` and fails to import
// in this project (the note `profile-picker.dom.test.ts` carried, for the same import — ⛔ `417`
// deleted that file with the launcher's profile picker).
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { DEFAULT_PROFILE_ID } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'

/**
 * # 🔴 The gesture the wire was armed for (361 §2/§3)
 *
 * ⛔ **Cancelling a sign-in that was really running did nothing, silently, and every layer looked
 * right.** `authFor` is a `ref` holding `{ provider, profileId }`, so `authFor.value` is a Vue
 * reactive `Proxy`; `ipcRenderer.invoke` structured-clones its payload and refuses one by name. The
 * `?? { provider }` fallback beside it is an object literal, ⚠️ **so cancelling with nothing in
 * flight worked** — the half a person is least likely to press, working, is what kept this from
 * ever looking like a bridge fault.
 *
 * ## ⚠️ Why it is HERE and could not have been anywhere else
 *
 *  - it needs a real `ref`, which means a real component, which means a mount;
 *  - it needs `busy` to go true→false with an `error`, which is a TRANSITION — `renderToString`
 *    renders once and can neither press Send nor change a prop afterwards;
 *  - and it needs a wire, which the node project's doubles do not have.
 *
 * ⚑ **Measured red before it was measured green.** With `cancelSignIn` restored to
 * `cancelProviderSignIn(authFor.value ?? …)`, the first test below fails with *"api.runtime.
 * cancelProviderSignIn would not survive ipcRenderer.invoke — (the payload) is a Vue reactive Proxy
 * over [object Object]"* and the host records nothing.
 *
 * ## ⚠️ 417 removed the ref, 423 put the stamp back as a `let`, and the red stays one type away
 *
 * ⛔ **`authFor` left `NewConversation.vue` at `417`.** It existed because *"the provider select is
 * right there"* and a minutes-long sign-in must not land under a provider the user has since
 * switched to; there was no select and no name box, so the surface had one provider and one
 * profile, both constants.
 *
 * 🔴 **`423` falsified that premise and restored the stamp.** `props.defaultProvider` is now
 * `RuntimeScreen.frontDoorProvider` — *BroBot's identity's provider, or the app frame's constant* —
 * and `NewAgent` is an overlay, so a person can create `default` with a provider while this surface
 * stays mounted behind the sheet. ⚑ **The stamp came back as a plain `let`, never a `ref`**, and
 * `cancelSignIn` rebuilds the literal from its FIELDS — so the defect this file measures is still
 * one TYPE away rather than one expression away, and reproducing the red means making `askedFor` a
 * `ref` and sending it whole.
 *
 * ⚑ **The test is unchanged in what it asks** — the cancel must ARRIVE, naming the pair the host
 * keys the sign-in by (`provider:profileId`). The generic half of the guard, which does not need
 * this component at all, is the second `describe` below.
 */

afterEach(unmountAll)

/** What the panel was told, in the order it was told — the wire's own record. */
type Wire = { cancelled: unknown[]; signInAsked: unknown[] }

function launcherFrame(
  wire: Wire,
  answers: Record<string, (input: unknown) => Promise<unknown>> = {},
): {
  m: Mounted
  fail: () => Promise<void>
} {
  const busy = ref(false)
  const error = ref<string | null>(null)
  const words = ref('go')
  const book = createAttachmentBook()

  // ⚑ **`chooseCwd`/`checkCwd` are gone from this stub** (417). They answered the folder row, and
  // HO-022 §2 removed it — a double for a call the component can no longer make is a fixture that
  // describes a surface that no longer exists.
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      // Not usable, so `SignInPanel` renders at all — a usable credential is silent by design.
      checkProviderAuth: () =>
        Promise.resolve({ state: 'absent', reason: 'This profile has never been signed in.' }),
      // ⛔ **Never settles**, which is the state the Cancel button exists for: `authBusy` stays
      // `'signing-in'` for as long as the browser flow would take, and that is the only state in
      // which the control this test presses is on screen at all.
      signInProvider: (input: unknown) => {
        wire.signInAsked.push(input)
        return new Promise<never>(() => {})
      },
      cancelProviderSignIn: (input: unknown) => {
        wire.cancelled.push(input)
        return Promise.resolve()
      },
      ...answers,
    },
  }

  const Frame = defineComponent({
    name: 'TheWireFrame',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: busy.value,
          error: error.value,
          debug: false,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          // ⚑ **`models` and `profiles` are not props any more** (417) — the model box and the
          // profile menu that consumed them went with `HO-022 §2`'s clear-out, and `RuntimeScreen`
          // no longer passes either. `DEFAULT_PROFILE_ID` stays in this file as the ORACLE below:
          // it is the one profile this door can name.
          defaultProvider: 'codex',
          // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
          // untouched door holds, and `models: null` is *nobody has answered yet*. Both are required
          // props for `handing`'s reason: the typechecker is the only reader of `RuntimeScreen`'s
          // bindings, so a silently-absent one is a silently-absent control.
          models: null,
          choices: NO_LAUNCH_CHOICES,
          capabilities: allProviderCapabilities(),
          'onUpdate:draft': (text: string) => (words.value = text),
          // The launch this surface starts — which is what marks the failure below as ITS failure.
          onStart: () => (busy.value = true),
        })
    },
  })

  const m = mount(Frame, {}, { width: 1200, height: 900 })

  /** Press Send, then have the launch fail — the only route to the credential panel. */
  const fail = async (): Promise<void> => {
    ;(m.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()
    busy.value = false
    error.value = 'codex exited before it started: no such file or directory (cwd)'
    await nextTick()
    await nextTick()
    await nextTick()
  }

  return { m, fail }
}

describe('cancelling a sign-in reaches the host (361 §1, the defect)', () => {
  // ⚠️ **Titled "carries the stamp" until 417**, which removed the stamp. What it asserts has not
  // moved: the payload must arrive, and it must name the pair the host keys a sign-in by.
  it('🔴 the cancel names the provider and profile the sign-in is running under', async () => {
    const wire: Wire = { cancelled: [], signInAsked: [] }
    const { m, fail } = launcherFrame(wire)
    await fail()

    // The panel is really here, and the sign-in really started — without this the cancel below
    // would be pressing a button that does not exist and the test would fail for the wrong reason.
    expect(m.all('sign-in-panel')).toHaveLength(1)
    ;(m.q('sign-in-start') as HTMLButtonElement).click()
    await nextTick()
    expect(wire.signInAsked).toEqual([{ provider: 'codex', profileId: DEFAULT_PROFILE_ID }])

    ;(m.q('sign-in-cancel') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()

    // ⛔ The whole assertion: it ARRIVED, and it arrived naming the profile whose sign-in is
    // running. Before the fix this list is empty and the notice below carries the wire's refusal.
    expect(wire.cancelled).toEqual([{ provider: 'codex', profileId: DEFAULT_PROFILE_ID }])
    // ⚠️ **The notice is checked for its CONTENT, not for its absence.** Pressing Sign in writes
    // *"Finish signing in in your browser…"* there, so a notice being present is the ordinary
    // state; what must not be there is the wire saying it refused to carry the cancel — which is
    // exactly what stands here when `cancelSignIn` sends the proxy.
    expect(m.q('sign-in-notice').textContent ?? '').not.toContain('ipcRenderer.invoke')
  })

  it('⚑ …and a cancel the host refuses says so, which is what makes the check above mean something', async () => {
    const wire: Wire = { cancelled: [], signInAsked: [] }
    const { m, fail } = launcherFrame(wire, {
      cancelProviderSignIn: (input: unknown) => {
        wire.cancelled.push(input)
        return Promise.reject(new Error('no sign-in is running for codex:default'))
      },
    })
    await fail()
    ;(m.q('sign-in-start') as HTMLButtonElement).click()
    await nextTick()
    ;(m.q('sign-in-cancel') as HTMLButtonElement).click()
    await nextTick()
    await nextTick()

    // ⛔ **The paired negative for the notice, and the reason it is a pair.** The test above asserts
    // the notice does NOT carry the wire's refusal; on its own that would pass just as well against
    // a build where the notice could never carry a failure at all — which is what this component
    // did until `361`, because `cancelSignIn` was the one gesture in the panel with no `catch` and
    // its rejection became an unhandled one. ⚠️ A cancel that could not be delivered has to say so,
    // or the sign-in it did not stop goes on looking cancelled.
    expect(m.q('sign-in-notice').textContent ?? '').toContain('no sign-in is running')
  })
})

describe('the wire itself is armed, for every stub in this project (361 §2)', () => {
  it('⛔ the setup file ran — otherwise every assertion below is about nothing', () => {
    expect((window as unknown as { __theWire?: string }).__theWire).toContain(
      'window.api is wrapped',
    )
  })

  it('🔴 a stub assigned by a test refuses a payload the shipped wire would refuse', async () => {
    const seen: unknown[] = []
    ;(window as unknown as { api: unknown }).api = {
      runtime: { project: (input: unknown) => Promise.resolve(void seen.push(input)) },
    }
    const runtime = (
      window as unknown as { api: { runtime: { project: (i: unknown) => Promise<unknown> } } }
    ).api.runtime

    await expect(runtime.project(reactive({ projectSlug: 'default' }))).rejects.toThrow(
      /would not survive ipcRenderer\.invoke/,
    )
    expect(seen, 'the stub answered a payload the app could never have sent').toEqual([])

    // ⚑ The pair: the same call, one fact over.
    await runtime.project({ projectSlug: 'default' })
    expect(seen).toEqual([{ projectSlug: 'default' }])
  })

  /**
   * ⛔ **Ten DOM tests `delete window.api` in an `afterEach`.** An own accessor would be removed by
   * that delete and every later test in the file would run unguarded — green, and measuring nothing.
   * ⚠️ This is the BEHAVIOURAL half of the source pin in
   * `test/the-bridge-that-clones-nothing.test.ts`: the source says where the trap is defined, and
   * this says the definition survives the gesture that would remove the wrong one.
   */
  it('⛔ survives `delete window.api`, which is how ten files clean up', async () => {
    const stub = window as unknown as { api?: unknown }
    stub.api = { runtime: { project: () => Promise.resolve(null) } }
    delete stub.api
    expect(stub.api).toBeUndefined()

    const seen: unknown[] = []
    stub.api = { runtime: { project: (input: unknown) => Promise.resolve(void seen.push(input)) } }
    const runtime = (stub as { api: { runtime: { project: (i: unknown) => Promise<unknown> } } })
      .api.runtime

    await expect(runtime.project(ref({ projectSlug: 'x' }).value)).rejects.toThrow(
      /would not survive/,
    )
    await runtime.project({ projectSlug: 'x' })
    expect(seen).toEqual([{ projectSlug: 'x' }])
  })
})
