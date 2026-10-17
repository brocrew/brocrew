import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import {
  allProviderCapabilities,
  capabilitiesFor,
  type CapabilityStatus,
} from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
// ⚑ **417 · read as a CONSTANT, because the launcher no longer renders it.** See the note on the
// last test in this file for why the negative it carries is still measured here.
import { PROFILE_OWNS } from '../../src/renderer/src/lib/profile-words'
import type { Provider, ProviderCapabilityMap } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'

/**
 * 329 §4.1/§4.2 · **The launcher says what a profile does with your sign-in, before you commit.**
 *
 * ## 🔴 417 took the two GESTURES away and left the SENTENCE (HO-022 §2)
 *
 * > *"Opening a new conversation opens a conversation with BroBot. That is all."*
 *
 * ⛔ **This file used to be in the dom project because two of its three claims were transitions** —
 * *"switching provider changes the sentence"* (a `<select>`) and *"typing a new profile name changes
 * when the copy happens"* (the `+ New profile…` name box). Both controls are gone, and with them
 * the claim that *"the transition IS the assertion"*: there is nothing left on this screen to
 * change, so the per-provider difference is read from two mounts driven by the `defaultProvider`
 * PROP. ⚑ That is how `a-front-door-that-asks-nothing.dom.test.ts` §3 asks the same question of
 * the line above this one, and the shape `a-mode-that-says-what-it-does.dom.test.ts` uses for the
 * header pill: one mount per provider, compared.
 *
 * ⚠️ **What that costs, stated rather than hidden**: a rendering that answered `codex` correctly
 * whatever it was handed would now pass the first mount and fail the second, which is the fact 328
 * reported; what no longer gets measured is the same NODE changing under a person's hand, and
 * nothing on the screen can do that any more.
 *
 * ⚠️ **It stays in the dom project for the half that never was a gesture** (310's lesson, 171 §3):
 * a disclosure that renders at zero height is not a disclosure, and SSR can see neither `visible()`
 * nor a box.
 */

function open(over: { defaultProvider?: Provider; capabilities?: unknown } = {}): Mounted {
  // ⚑ **No `window.api` stub any more** (417). It carried `chooseCwd`/`checkCwd` for the folder
  // row, and nothing this surface renders calls the bridge at all until a launch has failed —
  // which is `the-bridge-that-clones-nothing.dom.test.ts`'s question, not this file's.
  const words = ref('go')
  const book = createAttachmentBook()
  const Frame = defineComponent({
    name: 'ProfileCredentialFrame',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: false,
          error: null,
          debug: false,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          defaultProvider: over.defaultProvider ?? 'codex',
          // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
          // untouched door holds, and `models: null` is *nobody has answered yet*. Both are required
          // props for `handing`'s reason: the typechecker is the only reader of `RuntimeScreen`'s
          // bindings, so a silently-absent one is a silently-absent control.
          models: null,
          choices: NO_LAUNCH_CHOICES,
          // 🔴 **579 · required since `500` and never passed here** — omitted it arrives as
          // `undefined`, which `launchApprovalView` takes down its non-null branch and draws an
          // empty control. ⚑ `'ask'` is what a fresh install resolves to.
          defaultApprovalMode: 'ask',
          // ⚠️ `null` is a REACHABLE state, not a convenience: the capability fetch rides a
          // `Promise.allSettled` in `RuntimeScreen` and is deliberately allowed to fail.
          capabilities: 'capabilities' in over ? over.capabilities : allProviderCapabilities(),
          'onUpdate:draft': (text: string) => (words.value = text),
        })
    },
  })
  const m = mount(Frame, {}, { width: 1000, height: 900 })
  // 🔴 **579 · the sentence is behind a press now** (`EXT-010` §2.1), so this helper performs it —
  // every caller already awaits a tick, which is when the body lands.
  // ⛔ **`329`'s claim is *before the choice*, and a press is still before the choice**: nothing
  // has started, and the opener naming the subject is on screen from the first frame. ⚑ That the
  // fold EXISTS is `a-front-door-that-asks-nothing.dom.test.ts` §4's assertion; this file's
  // subject is the words, and opening it here keeps every test below about them.
  ;(m.q('launcher-why-credential') as HTMLButtonElement).click()
  return m
}

const line = (m: Mounted): HTMLElement => m.q('profile-credential')

/**
 * What the line said, copied out at the moment of reading.
 *
 * ⚠️ **It was a defence against a patch-in-place read and it is now simply a reader** (417). While
 * the provider came from a `<select>`, the element was rewritten under the same node and holding
 * the `HTMLElement` across the gesture compared the new state to itself. The two readings come from
 * two mounts now, so there is no node to be patched — the copy costs nothing and keeps the failure
 * messages naming a state rather than a live element.
 */
interface Said {
  text: string
  copies: string | null
  classes: Set<string>
}

const snap = (m: Mounted): Said => {
  const element = line(m)
  return {
    text: (element.textContent ?? '').trim(),
    copies: element.getAttribute('data-copies'),
    classes: new Set(element.classList),
  }
}

afterEach(unmountAll)

describe('329 · the launcher says it before, not after', () => {
  it('🔴 the two providers do not promise the same thing about your sign-in', async () => {
    const onCodex = open({ defaultProvider: 'codex' })
    const onClaude = open({ defaultProvider: 'claude' })
    await nextTick()

    // ⚑ **The layout half, and the non-vacuity guard in one** (310, 171 §3): the line is there, on
    // screen, with a box — on BOTH mounts, so neither reading below is of an element nobody sees.
    // ⛔ **It used to read *"it is outside the fine-tuning fold, so nothing can hide it"*, and
    // `579` retired that sentence rather than letting it rot.** `417` removed the `Fine-tune`
    // fold; `EXT-010` §2.1 then put this line behind a fold of its OWN, which `open()` presses.
    // ⚠️ **The difference `329 M8` is re-aimed onto**: that fold named nothing about a credential,
    // and this one is labelled *what this profile does with your sign-in* — so the claim that
    // survives is *nothing can hide it WITHOUT SAYING SO*, asserted in
    // `a-front-door-that-asks-nothing.dom.test.ts` §4 and by `329 M8` itself.
    for (const m of [onCodex, onClaude]) {
      expect(visible(line(m)), 'the disclosure is on screen, not merely in the DOM').toBe(true)
      expect(line(m).getBoundingClientRect().height, 'and it has height').toBeGreaterThan(0)
    }
    const codex = snap(onCodex)
    const claude = snap(onClaude)

    // ⛔ **The defect this replaced**: one sentence, said to both, and false on one of them. The
    // launcher's own line used to promise *"the sessions and sign-in kept there"* whichever provider
    // was selected, while 015's rule is that one of them writes nothing of yours into the folder.
    expect(claude.text, 'two providers, two different truths').not.toBe(codex.text)
    expect(claude.copies).not.toBe(codex.copies)
    // …and exactly one of them claims a copy, which is the fact rather than the wording.
    expect([codex.copies, claude.copies].filter((v) => v === 'yes')).toHaveLength(1)

    // The register moves with it: a consequence is drawn as one, a reassurance is not.
    const copying = codex.copies === 'yes' ? codex : claude
    const quiet = codex.copies === 'yes' ? claude : codex
    expect(copying.classes.has('warn'), 'a copy of your sign-in is a consequence').toBe(true)
    expect(quiet.classes.has('warn'), 'nothing being written is not').toBe(false)
    expect(quiet.classes.has('advice')).toBe(true)

    // 🔴 **The sentence is `homeCredential`'s and no other capability's** (329's own review found
    // this gap). Everything above passes just as well when the line is wired to `reprovisionAuth`:
    // that entry is `available`/`absent` on the same providers, and the timing clause is appended
    // by `profileCredential` whichever capability supplied the words — so the two texts still
    // differ, `data-copies` still differs, and both timing regexes still match. ⛔ That is exactly
    // `039`'s forbidden inference (*"you may press a button to re-copy"* read as *"a copy was
    // already made"*), and it needs the declaration itself as the oracle.
    const words = (status: CapabilityStatus): string =>
      status.state === 'available' ? (status.note ?? '') : status.reason
    for (const [provider, said] of [
      ['codex', codex],
      ['claude', claude],
    ] as const) {
      const declared = capabilitiesFor(provider)
      expect(said.text, `${provider} draws homeCredential’s own words`).toContain(
        words(declared.homeCredential),
      )
      // …and the paired negative, about a DIFFERENT entry: the neighbouring credential capability,
      // which is the one a reader of this component is most likely to reach for by mistake.
      expect(said.text, `${provider} must not be drawing reprovisionAuth’s`).not.toContain(
        words(declared.reprovisionAuth),
      )
    }
  })

  /**
   * ⛔ **`CredentialWhen.new` is UNREACHABLE from this screen, and 417 is where it happened.**
   *
   * The test that stood here read *"choosing `+ New profile…` changes WHEN, not whether — and says
   * nothing is written yet"*: it chose `+new` in `profile-select`, typed a name into
   * `new-profile-name`, and required the timing clause to change to *"nothing has been written for
   * this name yet"* (§4.2, 257 §2's guard said before the fact rather than after it). HO-022 §2
   * removed the profile menu and the name box together — *"BroBot has no human name"* — so
   * `NewConversation.vue` now calls `profileCredential(…, 'existing')` unconditionally and no
   * gesture in the app can put this surface in front of a profile nothing has been written for.
   *
   * ⚑ **The branch itself is still live code and still measured**, at the function rather than on a
   * screen: `test/profile-credential.test.ts` holds both registers of `CredentialWhen`, including
   * that `'new'` and `'existing'` differ and that neither claims the copy has already happened. ⛔
   * **What has no coverage anywhere is a SURFACE drawing the `'new'` sentence**, because there is
   * no longer a surface that can — reported by 417 rather than papered over.
   */

  /**
   * ⛔ **`profile-owns` is not on this screen any more** (417), and two claims went with it.
   *
   * The test that stood here was *"it is a sibling of `profile-owns`, not a second line inside
   * it"*: `profile-owns` must not CONTAIN the credential line, the credential line must follow it
   * in document order, and the line above it must still render as exactly one line — 031/167 §3's
   * rule, which is what forced the sibling rather than an appended clause.
   *
   * ⚠️ **`PROFILE_OWNS` itself survives**, on the drawer's Info panel (`SessionInfo.vue`), where
   * `drawer-tabs.dom.test.ts` asserts it is rendered verbatim and `the-layer-a-file-belongs-to.test.ts`
   * asserts the wording of the constant. ⛔ **The ORDER and the one-line rendering were the
   * launcher's own arrangement** — the Info panel does not draw the credential line at all — so
   * they are not moved here, they are gone. 417 reports that rather than keeping a test that
   * measures neither.
   */

  it('🔴 a capability that has not arrived is not rendered as an answer', async () => {
    // ⛔ **`310`'s lesson, on the field 329 adds.** The launcher's capability fetch rides a
    // `Promise.allSettled` and can fail outright, so "nobody has told us" is a state a person really
    // reaches — and it must not come out as the confident *nothing of your sign-in is written into
    // this profile*, which is one provider's actual answer. A silence dressed as a fact is the one
    // thing a reader cannot argue with.
    const known = open()
    await nextTick()
    const answered = snap(known)
    known.unmount()

    const m = open({ capabilities: null })
    await nextTick()
    const pending = snap(m)

    // Positive first: something IS drawn, because saying nothing is the original defect.
    expect(pending.text.length, 'the line is still there').toBeGreaterThan(10)
    expect(pending.text, 'and it says we are still asking').toMatch(/still asking/i)
    // …and it is not either provider's real answer.
    expect(pending.text).not.toBe(answered.text)
    expect(pending.copies, 'nothing is claimed about a copy nobody has described').toBe('no')
    expect(answered.copies, 'and the control really did have an answer to differ from').toBe('yes')
  })

  /**
   * 🔴 **579 · a partial map does not borrow the neighbour's answer** — moved here from
   * `provider-capabilities.render.test.ts`, which could ask it until `EXT-010` §2.1 put this
   * sentence behind a press.
   *
   * ⛔ **An SSR test cannot press, so its version of this question went vacuous**: with the body
   * absent, *the neighbour's sentence is not on the page* is true of every rendering, broken
   * indexing included. ⚠️ **That is `a-mutation-on-a-census-is-invisible-to-that-census` arriving
   * as a fold**, and the repair rule is `26`'s — strip AND re-aim, or move the question to an
   * instrument that can still answer it.
   *
   * ⚑ **What it is about**: `Record<Provider, …>` says a map missing a provider cannot happen, and
   * the value still crosses a process boundary where a type is a promise rather than a guarantee.
   * The launcher indexes it in three places, and the safe answer to *I was not told* is the same
   * as the safe answer to *not yet*.
   */
  it('🔴 a map that does not name this provider borrows nothing from the one it does', async () => {
    const partial = {
      claude: allProviderCapabilities().claude,
    } as unknown as ProviderCapabilityMap
    const m = open({ defaultProvider: 'codex', capabilities: partial })
    await nextTick()
    const seen = snap(m)

    // ⚑ Positive first: the surface survived the missing key and still says something.
    expect(seen.text.length, 'the line is still there').toBeGreaterThan(10)
    expect(seen.copies, 'nothing is claimed about a credential nobody described').toBe('no')

    // ⛔ **And it is not Claude's answer wearing Codex's question** — the failure an index without
    // the second `?.` would not even reach.
    const neighbour = allProviderCapabilities().claude.homeCredential
    const borrowed = neighbour.state === 'available' ? (neighbour.note ?? '') : neighbour.reason
    expect(borrowed.trim().length, 'a sentence must exist to be looked for').toBeGreaterThan(10)
    expect(seen.text, 'the map named Claude; the provider is Codex').not.toContain(borrowed)

    // ⚠️ **The pairing, because the line above is an absence**: handed the WHOLE map, this
    // provider's own declaration really does reach the sentence — so `no` is a withheld answer
    // rather than the only thing this element can say.
    m.unmount()
    const whole = open({ defaultProvider: 'codex' })
    await nextTick()
    expect(snap(whole).copies).toBe('yes')
  })

  /**
   * ⚑ **The half of *"the line 328 misread is gone"* that still has a subject** (417).
   *
   * It used to read both halves off this screen, because this screen rendered both: `profile-owns`
   * had to have lost the *"and sign-in"* clause, and the credential line beside it had to have
   * picked the fact up. The first element is gone from the launcher, so its half is read off the
   * CONSTANT the surviving surface renders — which is the stronger question anyway (384 §1.1 made
   * it importable so the wording is asserted on the object rather than on one render), and the
   * rendering of it is `drawer-tabs.dom.test.ts`'s.
   *
   * ⛔ **It is kept rather than deleted because nothing else asserts this negative.**
   * `the-layer-a-file-belongs-to.test.ts` holds the three things `PROFILE_OWNS` must name and the two
   * filenames it must not; `a-sentence-the-product-can-be-held-to.test.ts` holds *"rank"*. The clause
   * 329 actually removed — a sign-in it cannot keep on every provider — is measured here and
   * nowhere else.
   */
  it('⛔ the clause 328 misread did not come back, and it did not simply vanish either', async () => {
    const m = open()
    await nextTick()

    const owns = PROFILE_OWNS.toLowerCase()
    // 🔴 The clause that was false on one provider. Paired with a positive about the SAME string,
    // so a constant emptied to `''` could not pass this by saying nothing.
    // ⚑ **`claude.md` until 356**, which found the same shape one level down: that filename is one
    // provider's, the other reads a different name from a home, and this app authors NEITHER (357).
    // The line names the THING now, on the drawer's Info panel.
    expect(owns, 'the line still says what a profile owns').toContain('its own instruction file')
    expect(owns, 'and no longer promises a sign-in it cannot keep on every provider').not.toContain(
      'sign-in',
    )
    // …and the fact did not simply vanish: it moved to a line that can tell the truth per provider,
    // which is the one of the two that is still ON this screen.
    expect((line(m).textContent ?? '').toLowerCase()).toContain('sign-in')
  })
})
