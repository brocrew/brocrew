import { describe, expect, it } from 'vitest'
import { profilesToProbe } from '../src/renderer/src/components/RuntimeScreen.vue'

/**
 * **257 §2 · which profiles the screen may ask the providers about.**
 *
 * ⛔ **Asking is a provider child process, and on the host's side it CREATES the home it probes** —
 * for Codex, credential and all. So this rule is not a tidiness filter; it is the near end of the
 * same door `098`'s review put the *"never provision a credential just to ask a question"* rule on.
 *
 * ⚑ Tested here rather than through the component because nothing mounts `RuntimeScreen` — the
 * reason its own `firstMessageBelongsTo` is exported, and the same reason this is.
 *
 * ⚠️ **`.render.test.ts` because it imports an SFC**, which puts it in the `vue-tsc` project.
 * Nothing is rendered here; the suffix is the tsconfig's rule, not a description.
 *
 * ⚑ **417 (HO-022 §2) narrowed what the CALLER can pass, and changed nothing here.** The launcher's
 * profile menu is gone, so `launchChoice` is now `DEFAULT_PROFILE_ID` at the one call site and can
 * no longer be a sentinel or a half-typed name. `profilesToProbe` itself is untouched and its
 * contract is unchanged — *only ask about a profile that already exists* — so every case below
 * still measures the function, and the unknown-id case below is now the guard that makes the fixed
 * call site safe rather than a case the UI reaches. ⛔ **Not deleted on the strength of one caller:**
 * the cost it prevents is a provider home laid down (Codex: with a copy of your machine credential)
 * for an id nobody has, and the next caller inherits that guarantee from this test, not from the UI.
 */
describe('257 · a menu is per profile, and asking about one costs a process', () => {
  const probe = (
    known: readonly string[] | null,
    launchChoice: string,
    openProfile: string | null = null,
  ): string[] => profilesToProbe({ known, launchChoice, openProfile })

  it('asks about the launcher’s choice and the open conversation’s profile', () => {
    expect(probe(['default', 'work'], 'work', 'default')).toEqual(['work', 'default'])
  })

  it('🔴 asks about NOTHING that does not already exist — a name being typed is not a profile', () => {
    // ⛔ The launcher's `+ New profile…` sentinel and every prefix of a name somebody is typing used
    // to come through this argument. Probing one would lay down a provider home, and for Codex copy
    // the machine credential into it, for a profile the person has not finished naming.
    // ⚑ **417 removed the box that produced those strings** (HO-022 §2) — the rule stays, because it
    // is the function's contract and not a description of one screen's menu; `known.includes` is
    // what makes ANY future caller's typed-in id safe, and this is the only place that is pinned.
    expect(probe(['default'], '+new')).toEqual([])
    expect(probe(['default'], 'w')).toEqual([])
    expect(probe(['default'], 'wo')).toEqual([])
    expect(probe(['default', 'work'], 'work')).toEqual(['work'])
  })

  it('⚠️ asks once when both surfaces are on the same profile', () => {
    // Two children for one answer, otherwise — and the ordinary case is that they agree.
    expect(probe(['default'], 'default', 'default')).toEqual(['default'])
  })

  it('⚠️ asks about nothing at all until the profile list has arrived', () => {
    // `null` is "we have not been told which profiles exist", which is not "none exist". Treating it
    // as an empty list is what makes this fail toward asking nothing rather than toward asking about
    // a profile we cannot confirm — the direction that cannot create a home.
    expect(probe(null, 'default', 'default')).toEqual([])
  })
})
