import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  allProviderCapabilities,
  capabilitiesFor,
  isAvailable,
  type CapabilityStatus,
  type ProviderCapabilities,
} from '@brobot2/runtime'
import { SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import { PROVIDER_NAME, type ProviderCapabilityMap } from '../src/shared/runtime-ipc'
import NewConversation from '../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../src/renderer/src/lib/launch-choices'

/**
 * Capability is declared by the backend (039).
 *
 * Two halves, and they are different kinds of claim. The first is about the DECLARATIONS: that they
 * say only what we have measured, and that they keep "we have not built it" apart from "it cannot
 * exist" — the distinction 029 and 030 each lost once, at real cost. The second is about the
 * SURFACE: that it renders whatever it is handed, for either provider, without knowing which.
 *
 * The neutrality of the renderer itself is `provider-neutrality.test.ts`; this file is about the
 * answer being right and reaching the screen.
 *
 * ⛔ **417 emptied the second half down to one claim** (HO-022 §2 — *"Opening a new conversation
 * opens a conversation with BroBot. That is all."*). The launcher renders no capability-driven
 * CONTROL any more, so the seven tests that asserted one are gone; what it still does with the
 * declarations is read three of them — `signIn`, `reprovisionAuth`, `homeCredential` — for the
 * sentences and the panel at the foot of the column, and that is what the surviving describe
 * measures. See its docblock for the roll of what was removed and where each rule went.
 */

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(
    createSSRApp({
      // ⛔ The launcher's draft transaction (292 §2), supplied here rather than at every call site:
      // none of the assertions below is about where a staged path is kept.
      render: () =>
        h(NewConversation as never, {
          handing: createAttachmentBook().handing(NEW_CONVERSATION),
          ...props,
        }),
    }),
  )

/** The launcher's required props, minus whatever the test is actually varying. */
const launcher = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  busy: false,
  error: null,
  debug: false,
  // Required props with no defaults. Nothing here asserts on them yet — which is exactly why they
  // are set: the render helper takes `Record<string, unknown>`, so a missing required prop is an
  // `undefined` in the DOM rather than a type error, and the first assertion that touches the chat
  // theme would otherwise be reading a state no user can be in.
  draft: '',
  defaultProvider: 'claude',
  // ⚑ **The front door's three choices, unanswered** (435) — `NO_LAUNCH_CHOICES` is what an
  // untouched door holds. A required prop for `handing`'s reason: the typechecker is the only
  // reader of `RuntimeScreen`'s bindings, so a silently-absent one is a silently-absent control.
  choices: NO_LAUNCH_CHOICES,
  capabilities: allProviderCapabilities(),
  ...over,
})

/** Vue keeps template comments in SSR output, and this file's subject is what a user can read. */
const visible = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '')

/**
 * 🔴 **Every capability in the table, derived — it used to be a hand-written list of three** (329).
 *
 * ⛔ **It read `['planMode', 'thinking', 'subAgents']` while the table held eleven**, so the four
 * gates below — the completeness check, the "say why in words a user could read" floor, the
 * `checkedAgainst` floor, and the `unwired`-must-not-blame-the-provider sweep — ran over 3/11 of
 * the declarations and were silent about the other eight. Every gate this file exists to be was
 * covering the three entries that shipped with it.
 *
 * ⚠️ **The most expensive consequence was the `absent` gate**, which asserted *"no capability is
 * declared absent yet"* and passed — with SIX absent declarations in the table, none of which it
 * looked at. So `checkedAgainst`, the field 029/030 cost this project two false claims to introduce,
 * has never once been checked on a real entry. See the pin below, which is now the real one.
 *
 * ⚑ **Derived from a provider's own declaration rather than restated**, so a twelfth entry is
 * covered by being added. `Object.keys` on a frozen object is the whole mechanism; the `as` is the
 * one place this file admits that TypeScript cannot type `keyof` off a runtime read.
 */
const CAPABILITIES = Object.keys(
  capabilitiesFor(SUPPORTED_PROVIDERS[0] as (typeof SUPPORTED_PROVIDERS)[number]),
) as readonly (keyof ProviderCapabilities)[]

/**
 * ⛔ **`withoutPlanMode()` stood here and 417 removed it with its three readers** (HO-022 §2).
 *
 * It was the declarations with Codex's plan mode taken back to `unwired` — a fixture rather than an
 * environment fact, written after 057 wired the real one and broke three tests that had pinned the
 * month's answer instead of the mechanism. ⚑ **The argument it carried is worth keeping even though
 * the fixture is not**: a test about "a capability we were told we do not have" must MAKE that
 * state, never borrow it from whichever provider happens to be behind. The nearest live example is
 * `sign-in-panel.render.test.ts`, which hands the panel real Claude declarations for the same
 * purpose.
 */

describe('every provider declares every capability', () => {
  it('sends the presentation mark with each provider declaration', () => {
    expect(capabilitiesFor('claude').mark.kind).toBe('letter')
    expect(capabilitiesFor('codex').mark.kind).toBe('blossom')
  })
  it('declares whether a start sends one short message to renew an expired login', () => {
    expect(isAvailable(capabilitiesFor('claude').loginRenewalMessage)).toBe(true)
    expect(isAvailable(capabilitiesFor('codex').loginRenewalMessage)).toBe(false)
  })

  it('the map is complete — a provider cannot be half-declared', () => {
    // `Record<Provider, …>` makes this a compile error, so this is the runtime half of the same
    // guarantee: it catches a table filled in with `undefined` or spread from somewhere partial.
    expect(SUPPORTED_PROVIDERS.length).toBeGreaterThan(1)
    for (const provider of SUPPORTED_PROVIDERS) {
      const declared: ProviderCapabilities = capabilitiesFor(provider)
      for (const capability of CAPABILITIES) {
        expect(declared[capability], `${provider}.${capability}`).toBeDefined()
        expect(['available', 'unwired', 'absent']).toContain(declared[capability].state)
      }
    }
  })

  it('nothing is declared unavailable without saying why, in words a user could read', () => {
    // The type already requires a `reason` on both unavailable states — that is the point of the
    // discriminated union. What the type cannot require is that the reason SAYS anything, and an
    // empty string satisfies `string`.
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const capability of CAPABILITIES) {
        const status: CapabilityStatus = capabilitiesFor(provider)[capability]
        if (status.state === 'available') continue
        expect(status.reason.trim().length, `${provider}.${capability}`).toBeGreaterThan(10)
        // Not a symbol, an error code, or a shrug. It is shown to a person.
        expect(status.reason, `${provider}.${capability}`).toMatch(/[a-z]{3,} [a-z]{2,}/i)
      }
    }
  })

  it('nothing is declared `absent` without naming where it was checked', () => {
    /**
     * The review asked why the forbidden-phrase sweep below skips `absent`, and the answer is that
     * it must: `absent` MEANS the provider does not have it, so "has no" is the correct wording
     * there and forbidding it would only push people to phrase a false absence more carefully.
     *
     * The danger with `absent` is not the words, it is the EVIDENCE — 030's "Codex has no plan mode"
     * was a sentence nobody could check. So the type now requires `checkedAgainst`, and this asserts
     * it says something.
     *
     * ⛔ **This test used to end with `expect(absences).toEqual([])` and a comment reading *"today
     * there are no `absent` entries at all, which is itself worth pinning"* — and it passed while
     * six of them existed** (329). It was reading a hard-coded three-name list. The pin was true
     * when it was written and became a statement about the sample rather than about the table, so
     * the sweep it guards had never run on a single real declaration.
     *
     * ⚑ **What replaces it is the assertion the paragraph above always described**: the floor, over
     * every absence, plus a non-vacuity floor so it cannot go quiet again the way it just did.
     */
    const absences = SUPPORTED_PROVIDERS.flatMap((provider) =>
      CAPABILITIES.map((capability) => ({
        at: `${provider}.${capability}`,
        status: capabilitiesFor(provider)[capability],
      })).filter((entry) => entry.status.state === 'absent'),
    )
    expect(
      absences.length,
      'a sweep over no absences forbids nothing — this is what went silent',
    ).toBeGreaterThan(4)
    for (const { at, status } of absences) {
      if (status.state !== 'absent') continue
      expect(status.checkedAgainst.trim().length, at).toBeGreaterThan(10)
      // ⛔ **Where you LOOKED, not what you concluded** (029/030). A `checkedAgainst` that repeats
      // the reason names no evidence: it must cite something a reader can go and open — a file, a
      // declaration, a captured wire frame, a command that was run.
      expect(status.checkedAgainst, at).toMatch(
        /`[^`]+`|\.ts\b|sdk\.d\.ts|protocol|capture|verified/i,
      )
      expect(status.checkedAgainst.trim(), at).not.toBe(status.reason.trim())
    }
  })

  /**
   * ⛔ **The phrases an `unwired` reason may not carry, hoisted to the describe** (329).
   */
  const FORBIDDEN = [
    /\bhas no\b/i,
    /\bdoes ?n[o']?t (have|support|exist)/i,
    /\bcannot\b/i,
    /\bcan't\b/i,
    /\bimpossible\b/i,
    /\bunsupported\b/i,
    /\bnot supported\b/i,
  ]

  /**
   * 🔴 **The one `unwired` reason that spoke about the OTHER provider (329) — retired by 713.**
   *
   * ⚠️ `codex.requestCompaction` read *"…compaction is lossy and irreversible and Claude cannot be
   * asked at all"*, and the sweep below exempted it by CORROBORATION: Claude's own entry declared
   * the capability `absent`, with its `checkedAgainst`. 086 wrote it deliberately — the asymmetry was
   * the whole argument for keeping the Dropped tab's control off.
   *
   * ⚑ **713 resolved that asymmetry**: Claude compacts on the person's own `/compact`, which `R42`
   * sends as typed (`708`), and Codex on `thread/compact/start`, which a person's `/compact` now
   * reaches (`R59`) — so both entries are `available` (`R60`). ⛔ **The exemption, its list and its
   * corroboration went with the sentence they existed for** (rule 26: re-aimed, not deleted). What
   * is pinned instead is the property they protected, now with nothing skipped: no `unwired` reason
   * speaks about another provider at all.
   */
  it('713 · no `unwired` reason speaks about the OTHER provider — the one that did left with its asymmetry', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(
        capabilitiesFor(provider).requestCompaction.state,
        `${provider} compacts through BroBot (R59, R60)`,
      ).toBe('available')
    }
    let read = 0
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const capability of CAPABILITIES) {
        const status = capabilitiesFor(provider)[capability]
        if (status.state !== 'unwired') continue
        read += 1
        for (const other of SUPPORTED_PROVIDERS.filter((one) => one !== provider)) {
          expect(status.reason, `${provider}.${capability} speaks about ${other}`).not.toContain(
            PROVIDER_NAME[other],
          )
        }
      }
    }
    expect(read, 'a sweep over no `unwired` reasons forbids nothing').toBeGreaterThan(1)
  })

  it('an `unwired` reason never claims the provider cannot do it', () => {
    /**
     * ⚠️ The regression this whole task is downstream of.
     *
     * 030 wrote "Codex has no plan mode" and 044 falsified it against our own vendored protocol.
     * 029 wrote the same shape of sentence about Codex sub-agents and 033 falsified it with a live
     * session. Both times the words outlived the belief. `unwired` means WE have not built it, and
     * a reason that says otherwise re-creates the false absence in the one place it is now
     * guaranteed to be read aloud.
     */
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const capability of CAPABILITIES) {
        const status = capabilitiesFor(provider)[capability]
        if (status.state !== 'unwired') continue
        // ⚑ **Nothing is skipped since 713** — the one cross-provider exemption left with the
        // asymmetry it named; see the test above.
        for (const forbidden of FORBIDDEN) {
          expect(
            status.reason,
            `${provider}.${capability} must not claim ${forbidden}`,
          ).not.toMatch(forbidden)
        }
        // …and it must actually say whose gap it is, not merely avoid blaming the provider.
        //
        // ⚠️ **`wiring`/`wired`/`our` accepted since 329**, and this is a correction to the ENCODING
        // rather than a relaxation of the rule. The rule is *"say whose gap it is"*; the regex read
        // `\bwe\b|\bnot (yet )?wired\b|\byet\b`, and `codex.rewind` — *"Wiring a file-mutating
        // discard onto a disappearing method is the wrong order"* — says whose gap it is in the
        // gerund and failed on the spelling. ⛔ It went undetected because this sweep had been
        // reading a hard-coded list of three capability names that did not include `rewind`.
        // The FORBIDDEN pass above still runs first, so nothing here can admit a false absence.
        expect(status.reason, `${provider}.${capability} must say whose gap it is`).toMatch(
          /\bwe\b|\bour\b|\bwir(ed|ing)\b|\byet\b/i,
        )
      }
    }
  })

  it('plan mode is available on BOTH, and the two say different things about it (057)', () => {
    // ⚠️ This assertion has now been three different assertions, which is the entry's whole story:
    // 030 pinned Codex's plan mode `absent`, 044 corrected it to `unwired` against our vendored
    // protocol, 057 asked the running app-server — `collaborationMode/list` answered with a `Plan`
    // preset — and wired it. Each version was true when written; each was written as though it
    // always would be.
    //
    // So what is pinned here is deliberately NOT "Codex has plan mode". It is the shape that
    // survives the next correction: whatever the states are, an available one that means something
    // different on the two providers has to SAY so, because the launcher's shared label cannot.
    // Claude's plan mode ends when you approve the plan and the session carries it out; Codex's
    // ends when this app sends `{mode:'default'}` with the go-ahead — 060 built that, and this
    // comment said `a client-side switch we have not built` until 461 read the adapter.
    // A future where those converge is fine — a future where one note is copied onto both is not.
    const plans = SUPPORTED_PROVIDERS.map((provider) => capabilitiesFor(provider).planMode)
    for (const plan of plans) expect(isAvailable(plan)).toBe(true)
    const notes = plans.map((plan) => (plan.state === 'available' ? (plan.note ?? '') : ''))
    expect(
      notes.every((note) => note.length > 0),
      'plan mode differs by provider, so each must say what it gives you',
    ).toBe(true)
    expect(
      new Set(notes).size,
      'two providers, two endings — one note copied onto both is a lie',
    ).toBe(notes.length)
  })

  it('thinking is available on both and described differently — the shape is not a boolean', () => {
    // The second reason `{supported: boolean}` was rejected. Claude reports a token estimate with
    // the words redacted; Codex writes a summary. Both "yes", and a UI told only "yes" would promise
    // one and render the other. `events.ts` carries the measurement.
    const claude = capabilitiesFor('claude').thinking
    const codex = capabilitiesFor('codex').thinking
    expect([claude.state, codex.state]).toEqual(['available', 'available'])
    const notes = [claude, codex].map((s) => (s.state === 'available' ? (s.note ?? '') : ''))
    expect(
      notes.every((note) => note.length > 0),
      'both must say what they give you',
    ).toBe(true)
    expect(notes[0]).not.toEqual(notes[1])
  })

  it('the map and the per-provider lookup are the same object — no second copy to drift', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(allProviderCapabilities()[provider]).toBe(capabilitiesFor(provider))
    }
  })
})

/**
 * ⛔ **What 417 took out of this describe, and where each rule went** (HO-022 §2).
 *
 * The launcher's whole question is gone — no `plan-mode` checkbox, no `Fine-tune` fold, no
 * `new-conversation-settings` frame — so seven `it`s here had no subject left:
 *
 * - *"offers plan mode where the backend declares it available"*
 * - *"offers nothing where it is not — absent, not disabled (030 still holds)"*
 * - *"offers nothing at all until the declarations arrive"*
 * - *"a provider that gains plan mode gets the control, with no renderer change"*
 * - *"the debug line quotes the backend, and the renderer owns no copy of the words"*
 *   (`plan-unavailable`)
 * - *"an available capability that carries a note gets it onto the screen (057)"*
 *   (`plan-capability-note`)
 * - *"the rest of the settings are untouched — one control absent, not a stripped surface"*
 *   (`reasoning-effort-select`, `model-input`, `auto-approve`)
 *
 * ⚠️ **Where the rules they carried still live, because two of them do:**
 *
 * - *"declared unavailable → NO control, not a disabled one"* is still measured, on a surface 417
 *   kept: `sign-in-panel.render.test.ts` · *"asks the capability rather than the provider"* and
 *   *"never offers a remedy the host would refuse"* withhold `sign-in-start` and
 *   `sign-in-reprovision` off `signIn`/`reprovisionAuth` and render the adapter's reason instead.
 *   ⛔ **Not the same rule twice**: the plan tests also forbade HINTING at the missing control to an
 *   ordinary user (`not.toMatch(/plan/i)` over the visible page), and nothing asserts that shape
 *   any more — the panel deliberately puts a sentence where the button was.
 * - *"`null` means say nothing — a control shown on a guess and withdrawn is worse than one that
 *   arrives late"* is measured on this surface by
 *   `dom/profile-credential.dom.test.ts` · *"a capability that has not arrived is not rendered as
 *   an answer"*, which mounts the launcher with `capabilities: null`.
 *
 * 🔴 **And one is kept HERE rather than deleted**, because its subject survived the cut: the
 * launcher still indexes the map by provider in three places (`signIn`, `reprovisionAuth`,
 * `homeCredential`), so a map that does not name the selected provider can still take the window
 * down. Only the hooks the old assertion reached for were removed, not the question it asked.
 */
describe('the launcher survives a map that does not name its provider (417)', () => {
  it('a map missing the selected provider offers nothing, rather than taking the window down', async () => {
    // `Record<Provider, …>` says this cannot happen — and the value still crosses a process
    // boundary, where a type is a promise rather than a guarantee. The safe answer to "I was not
    // told" is the same as the safe answer to "not yet": offer nothing. Without the optional index
    // in the three capability computeds this render throws and the whole surface is a blank window.
    const partial = { claude: capabilitiesFor('claude') } as unknown as ProviderCapabilityMap
    const html = await render(launcher({ defaultProvider: 'codex', capabilities: partial }))
    // ⚑ Positive first, so every negative below is about a withheld claim and not an empty render.
    expect(html).toContain('data-cy="new-conversation-surface"')
    // 🔴 **579 · the credential SENTENCE is behind a press and SSR cannot press** (`EXT-010` §2.1).
    //
    // ⛔ **What this test may no longer assert, and why deleting the clause would have been the
    // wrong repair.** It read `data-copies="no"` and *the neighbour's sentence is not on the page*.
    // The second of those is now satisfied by the body simply being ABSENT — which is
    // `a-mutation-on-a-census-is-invisible-to-that-census` arriving as a fold: the negative would
    // stay green with the indexing broken, because there is nothing rendered to be wrong.
    // ⚑ **So the borrowed-sentence question MOVED to a surface that can press** —
    // `dom/profile-credential.dom.test.ts` · *"a partial map does not borrow the neighbour's
    // answer"* — and what stays here is the half SSR can still answer: the three capability
    // computeds index a map that does not name this provider WITHOUT throwing, and the surface
    // comes back whole.
    expect(html).toContain('data-cy="model-picker-face"')
    // ⚠️ **The floor that makes the survival claim non-vacuous**: a render that threw would have
    // rejected, and one that produced a stub would not carry the column and the composer too.
    expect(html).toContain('data-cy="launcher-column"')
    expect(html).toContain('data-cy="prompt-input"')
    // ⛔ **And the sentence is genuinely NOT in the closed page** — stated as what it is, an
    // absence caused by the fold, so nobody later reads it as a statement about the indexing.
    const neighbour = capabilitiesFor('claude').homeCredential
    const borrowed = neighbour.state === 'available' ? (neighbour.note ?? '') : neighbour.reason
    expect(borrowed.trim().length, 'a sentence must exist to be looked for').toBeGreaterThan(10)
    expect(
      visible(html),
      'the fold is closed, so no credential sentence is on the page',
    ).not.toContain(borrowed)
    // ⚑ **The paired positive for that absence**: with the WHOLE map the page is still closed, so
    // this provider's own sentence is absent too — which is what says the line above is about the
    // FOLD and not about the map.
    const whole = await render(launcher({ defaultProvider: 'codex' }))
    const own = capabilitiesFor('codex').homeCredential
    const mine = own.state === 'available' ? (own.note ?? '') : own.reason
    expect(mine.trim().length).toBeGreaterThan(10)
    expect(visible(whole)).not.toContain(mine)
  })

  it('🔴 …and so does the control HO-025 §5 put back, on an EMPTY map (435, UI-012)', async () => {
    // ⛔ **`417` deleted seven `it`s from this file with the controls they were about**, and its
    // docblock above records that only two of their rules found new homes. ⚑ Three controls are
    // back, and the question this file exists to ask of a control is the one asked here: does it
    // render when the declarations say nothing at all?
    //
    // ⚠️ **`{}` is a state a mount really is in** — `dom/launch-cancel.dom.test.ts` uses it, and the
    // capability fetch rides a `Promise.allSettled` that is allowed to fail. ⛔ The three controls
    // below are NOT capability-gated (model and effort are catalogue questions, not capability
    // ones), and this is what makes that a measured fact rather than an assumption.
    // ⚑ UI-012 · the three are ONE control now — the model picker (`09` §1).
    const html = await render(launcher({ capabilities: {} as unknown as ProviderCapabilityMap }))
    for (const cy of ['model-picker-face']) {
      expect(html, `${cy} needs a capability map to draw`).toContain(`data-cy="${cy}"`)
    }
    // ⚑ …and the paired positive for the render itself, so the read above is not a read of a
    // surface that failed to render at all.
    expect(html).toContain('data-cy="launcher-choices"')
  })
})
