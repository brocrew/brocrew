import { describe, expect, it } from 'vitest'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { PATH_SEGMENT_MAX_LENGTH, isPathSegment } from '../src/shared/runtime-ipc'
import { PROFILE_NAME_CASES } from './fixtures/profile-names'

/**
 * ⛔ **One rule, two ends — asserted, not asserted-about** (169 §1, criterion 3).
 *
 * ## What was measured
 *
 * The PM typed `../../escape` into the new-profile field on `8f30309`, typed a message, and found
 * `send-prompt` **enabled**. Everything else was already right: the rule was printed under the
 * field, the host refused the value at the schema, and the launcher refused it too — *after* the
 * press. So the defect was never a missing validation. It was a gesture the app offered and then
 * declined, which `106` forbids outright and `118` sharpens: *"a greyed button still says 'this is
 * the thing to do here, later'; there is no later."*
 *
 * ## How the two are made to agree
 *
 * ⚑ **By construction, and then by this file.** There is one predicate — `isPathSegment`, in
 * `shared/runtime-ipc.ts`, the module main, preload and the renderer all import. The wire schema
 * does not restate it, it *calls* it (`z.string().refine(isPathSegment, …)`), and the launcher's
 * `profileRefusal` calls the same function. A drift would need somebody to write a second predicate,
 * which is exactly what `M6` in `scripts/mutations/169/` does.
 *
 * Construction is not proof, so the corpus in `fixtures/profile-names.ts` — with its verdicts
 * written out by hand, never derived from the predicate — is driven through **both** ends: the wire
 * schema here — and the browser half is GONE: ⛔ `417` removed the launcher's profile picker
 * (HO-022 §2) and deleted `dom/profile-picker.dom.test.ts` with it, so this file is now the whole
 * of the rule and a person has no way to reach it at all. Same
 * list, same expected answer, opposite sides of the process boundary.
 */
describe('the profile-name rule, at the wire (169 §1)', () => {
  const parse = (profileId: string): boolean =>
    runtimeCommandSchema.safeParse({ kind: 'createSession', provider: 'claude', profileId }).success

  it.each(PROFILE_NAME_CASES)('$why — $name', ({ name, legal }) => {
    // The corpus first: this is the hand-written verdict, and it is what makes the two assertions
    // below a claim about the code rather than a claim about each other.
    expect(
      isPathSegment(name),
      `isPathSegment disagrees with the corpus for ${JSON.stringify(name)}`,
    ).toBe(legal)
    expect(parse(name), `the wire schema disagrees for ${JSON.stringify(name)}`).toBe(legal)
  })

  it('the corpus is not vacuous — it holds both answers, and the four the PM typed', () => {
    // A list that was all-illegal would satisfy every assertion above with a rule that refused
    // everything, including `default`.
    expect(PROFILE_NAME_CASES.filter((c) => c.legal).length).toBeGreaterThan(3)
    expect(PROFILE_NAME_CASES.filter((c) => !c.legal).length).toBeGreaterThan(3)
    const typed = PROFILE_NAME_CASES.map((c) => c.name)
    for (const measured of ['..', 'a/b', '../../escape', '   ', 'default']) {
      expect(typed, `criterion 2 names ${measured}`).toContain(measured)
    }
  })

  it('an omitted profile is still allowed — the rule is about a value, not about having one', () => {
    // The default profile is what an absent field means, and 167 kept it that way deliberately: a
    // required field here would have made every pre-profiles call site a wire error.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'createSession', provider: 'claude' }).success,
    ).toBe(true)
  })

  it('the length bound is the one the rule advertises, and it is enforced at the wire', () => {
    // ⚠️ The bound is in the sentence the user reads (`PATH_SEGMENT_RULE`), so it has to be the
    // bound the boundary applies. A regex alone accepts a 300-character name and fails deep inside
    // `mkdir` with `ENAMETOOLONG`, naming a path instead of the field that caused it.
    expect(parse('x'.repeat(PATH_SEGMENT_MAX_LENGTH))).toBe(true)
    expect(parse('x'.repeat(PATH_SEGMENT_MAX_LENGTH + 1))).toBe(false)
  })
})
