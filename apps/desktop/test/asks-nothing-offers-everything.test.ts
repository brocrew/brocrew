import type { ModelList } from '../src/shared/model-choice-contracts'
import { describe, expect, it } from 'vitest'
import { providerForALaunch } from '../src/renderer/src/lib/agent-store'
import { NO_LAUNCH_CHOICES } from '../src/renderer/src/lib/launch-choices'
import { theDraftEffort, theFormSends } from '../src/renderer/src/lib/model-lists'
import {
  DEFAULT_PROFILE_ID,
  type AgentIdentities,
  type ModelChoice,
} from '../src/shared/runtime-ipc'

/**
 * A front door that asks nothing and offers everything: the untouched launch choices, the one
 * effort derivation, and the one provider resolution. The screen half lives in
 * `dom/a-front-door-that-offers-everything.dom.test.ts`.
 */

/** ⚑ UI-012 · a provider's list as D-042's door answers it — its own rows, no person's. */
const listOf = (...each: ModelChoice[]): ModelList => ({
  provider: 'claude',
  notAsked: null,
  standIn: null,
  models: each.map((row) => ({ ...row, addedBy: 'the-provider' as const })),
  lastPicked: null,
  startsOn: null,
})

const opus: ModelChoice = {
  id: 'opus',
  label: 'Opus',
  defaultEffort: 'high',
  efforts: [
    { id: 'low', label: 'low' },
    { id: 'high', label: 'high' },
  ],
}
const haiku: ModelChoice = { id: 'haiku', label: 'Haiku' }

describe('§1 · an untouched door sends what 417 sent, byte for byte', () => {
  it('⛔ nobody-asked is ONE shape, and it is what the screen starts holding', () => {
    expect(NO_LAUNCH_CHOICES).toEqual({ provider: null, model: '', reasoningEffort: '' })
    // ⚑ Frozen, because it is handed out as the initial value: a caller that mutated it would
    // change what *untouched* means for every later conversation in that run of the app.
    expect(Object.isFrozen(NO_LAUNCH_CHOICES)).toBe(true)
  })
})

describe('§3 · what the control shows is what the launch asks for (274 §2)', () => {
  it('🔴 a rung the model does not offer is not drafted', () => {
    // ⚑ UI-012 · the picker's draft follows the host's own rule (`theDraftEffort`).
    expect(theDraftEffort(listOf(opus, haiku), 'haiku', 'medium')).toBeNull()
  })

  it('⚑ …and a rung it CAN show is', () => {
    expect(theDraftEffort(listOf(opus), 'opus', 'high')).toBe('high')
  })

  it('⛔ silence narrows nothing: with no list a person’s pick is sent as it is held (179 §4)', () => {
    // ⚠️ **Reachable, and `435` nearly argued it away.** `RuntimeScreen` re-probes a profile
    // whenever a credential gesture settles (`257 §2`); a refused re-probe replaces a good
    // list with a silence under a rung a person already chose.
    expect(
      theFormSends({ provider: 'claude', model: 'opus', reasoningEffort: 'medium' }, null),
    ).toEqual({ model: 'opus', effort: 'medium' })
    // …the paired negative: nothing held, nothing to ask for.
    expect(theFormSends(NO_LAUNCH_CHOICES, null)).toBeNull()
  })

  it('⚑ …and with a list the provider is the authority again', () => {
    expect(theDraftEffort(listOf(opus, haiku), 'opus', 'medium')).toBe('high')
  })
})

describe('§4 · ONE provider resolution, with the asked term first', () => {
  const roster = (provider: 'claude' | 'codex' | null): AgentIdentities =>
    ({
      identities: [
        {
          id: 'aid:default',
          slug: DEFAULT_PROFILE_ID,
          displayName: null,
          role: null,
          provider,
        },
      ],
      use: [
        {
          slug: DEFAULT_PROFILE_ID,
          runsOn:
            provider === null
              ? { provider: null, from: 'nothing-yet' }
              : { provider, from: 'saved' },
        },
      ],
    }) as unknown as AgentIdentities

  it('🔴 what the person asked for beats what the identity says', () => {
    expect(providerForALaunch(roster('claude'), DEFAULT_PROFILE_ID, 'codex', 'codex')).toBe('codex')
  })

  it('⚑ …and an unanswered choice leaves 423’s resolution exactly as it was', () => {
    // ⛔ **The widening is opt-in at the call site.** A caller that passes nothing — the placed
    // door — resolves the way it did before this dispatch existed.
    expect(providerForALaunch(roster('claude'), DEFAULT_PROFILE_ID, 'codex')).toBe('claude')
    expect(providerForALaunch(roster('claude'), DEFAULT_PROFILE_ID, 'codex', null)).toBe('claude')
    expect(providerForALaunch(roster(null), DEFAULT_PROFILE_ID, 'codex')).toBe('codex')
    expect(providerForALaunch(null, DEFAULT_PROFILE_ID, 'codex')).toBe('codex')
  })

  it('⛔ the asked term beats the FALLBACK too, so it is a first term and not a second', () => {
    // ⚠️ **Tested where the two readings DIVERGE** (standing rule 3): an identity that has said
    // nothing would answer `codex`, and the person said `claude`.
    expect(providerForALaunch(roster(null), DEFAULT_PROFILE_ID, 'codex', 'claude')).toBe('claude')
  })
})
