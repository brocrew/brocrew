import { describe, expect, it } from 'vitest'
import { capabilitiesFor, SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import type { CapabilityStatus } from '../src/shared/runtime-ipc'
import { profileCredential } from '../src/renderer/src/lib/profile-credential'

/**
 * 329 · **The launcher says what a profile does with your sign-in, before you pick one.**
 *
 * ⛔ **The function under test writes no sentence about a provider.** Everything a user reads here
 * comes from `homeCredential` and is handed in; what this file checks is that the right one is
 * chosen, that the timing clause is attached to the right case, and that neither is invented.
 *
 * ⚠️ **Nothing here compares a rendered string to the constant it was built from.** 310 shipped one
 * of those and had to demote it: an assertion of the form `expect(out).toContain(SOURCE)` is true by
 * construction and stays true after the product stops doing the thing. The assertions below are
 * about *structure* (which arm, which register, whether a copy is claimed) and about *difference*
 * (no two cases say the same thing); the words themselves are pinned against the real declarations
 * in `credential-disclosure.test.ts`, which reads them off the code that does the copying.
 */

/** An INVENTED note, so passing it through is a claim about the function and not about the table. */
const ADAPTER_SAID = 'A folder here keeps a sign-in of its own, and it starts as a copy of yours.'

const AVAILABLE: CapabilityStatus = { state: 'available', note: ADAPTER_SAID }

const ABSENT: CapabilityStatus = {
  state: 'absent',
  reason: 'Nothing of your sign-in is written into this profile.',
  checkedAgainst: 'a made-up provider, so that this file asserts the mechanism and not the table',
}

const UNWIRED: CapabilityStatus = {
  state: 'unwired',
  reason: 'we have not wired this up yet',
}

describe('what a profile does with your sign-in (329 §4.1)', () => {
  it('an available capability carries the provider’s own words, and this file adds none of them', () => {
    const said = profileCredential(AVAILABLE, 'existing')
    // ⚑ The positive half, and it is not a self-comparison: `ADAPTER_SAID` is a sentence no adapter
    // declares, so a function that paraphrased, truncated or ignored the note would fail here.
    expect(said.text.startsWith(ADAPTER_SAID)).toBe(true)
    // …and the negative half is about DIFFERENT words — ones no fixture on this path contains — so
    // it is not the same assertion twice. If the function ever described the copy in words of its
    // own, this is what fires.
    expect(said.text).not.toMatch(/machine|credential|auth\.json/i)
    expect(said.copies).toBe(true)
  })

  it('⛔ says WHEN, and the two whens are different sentences', () => {
    const existing = profileCredential(AVAILABLE, 'existing')
    const fresh = profileCredential(AVAILABLE, 'new')
    expect(existing.text).not.toBe(fresh.text)
    // The one fact §4.2 is about: a name being typed has had nothing written for it. `257 §2`'s
    // guard is what makes that true, and this is the sentence that reports it.
    expect(fresh.text).toMatch(/nothing has been written/i)
    expect(existing.text).not.toMatch(/nothing has been written/i)
    // …and the existing case names the act on this very screen, which is the half `328` could not
    // account for: the launcher's own model probe prepares the home.
    expect(existing.text).toMatch(/models it can run/i)
  })

  it('⛔ an unavailable capability gets NO timing clause, because nothing is going to happen', () => {
    for (const status of [ABSENT, UNWIRED]) {
      const said = profileCredential(status, 'new')
      expect(said.text, 'the provider’s reason, whole and alone').toBe(status.reason)
      expect(said.copies).toBe(false)
      // Paired positive: the same input in the other `when` is byte-identical, which is the claim —
      // a timing clause that leaked in would make these two differ.
      expect(profileCredential(status, 'existing').text).toBe(said.text)
    }
  })

  it('the register separates a consequence from a reassurance', () => {
    expect(profileCredential(AVAILABLE, 'existing').tone).toBe('consequence')
    expect(profileCredential(ABSENT, 'existing').tone).toBe('note')
    expect(profileCredential(UNWIRED, 'existing').tone).toBe('note')
  })

  it('⚠️ a provider that declares `available` and forgets its note still says something', () => {
    // The type makes `note` optional. Silence is the original defect, so the fallback is a sentence
    // rather than an empty string — and it still carries the timing.
    const said = profileCredential({ state: 'available' }, 'new')
    expect(said.text.trim().length).toBeGreaterThan(20)
    expect(said.text).toMatch(/nothing has been written/i)
    expect(said.copies).toBe(true)
  })

  it('🔴 no two of the four cases say the same thing', () => {
    const cases = [
      profileCredential(AVAILABLE, 'existing').text,
      profileCredential(AVAILABLE, 'new').text,
      profileCredential(ABSENT, 'existing').text,
      profileCredential(UNWIRED, 'existing').text,
    ]
    // The whole defect 329 is about was four states drawing one screen. `ABSENT` and `UNWIRED` are
    // the exception the module argues for — they differ here only because their reasons differ,
    // which is the point: the difference lives in the data, not in a branch.
    expect(
      new Set(cases).size,
      'a case that reads like another is a case nobody can tell apart',
    ).toBe(4)
  })
})

describe('against the real declarations', () => {
  it('every provider gives this surface a sentence, whatever its state', () => {
    expect(SUPPORTED_PROVIDERS.length).toBeGreaterThan(1)
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const when of ['existing', 'new'] as const) {
        const said = profileCredential(capabilitiesFor(provider).homeCredential, when)
        expect(said.text.trim().length, `${provider}/${when}`).toBeGreaterThan(40)
        // ⛔ It must end as a sentence — this text is the whole of what a person reads, and a
        // fragment is how a truncated declaration would reach the screen unnoticed.
        expect(said.text.trim(), `${provider}/${when}`).toMatch(/[.!?]$/)
      }
    }
  })

  it('🔴 no two providers say the same thing — which is the defect this replaced', () => {
    // ⚠️ Over the whole roster rather than a destructured pair: a third provider joins this
    // assertion by existing, and `SUPPORTED_PROVIDERS[i]` is `Provider | undefined` to the compiler.
    const said = SUPPORTED_PROVIDERS.map((provider) =>
      profileCredential(capabilitiesFor(provider).homeCredential, 'existing'),
    )
    expect(
      new Set(said.map((one) => one.text)).size,
      'one sentence said to two providers is the line 328 read wrongly',
    ).toBe(SUPPORTED_PROVIDERS.length)
    // …and they disagree about the thing that matters, not merely in wording: exactly one of them
    // puts a copy of the user's sign-in in the folder.
    expect(said.filter((one) => one.copies)).toHaveLength(1)
  })
})
