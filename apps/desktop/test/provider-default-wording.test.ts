import { expect, it } from 'vitest'
import {
  aProviderNotChosenSays,
  noProviderSavedSays,
  providerTakesEffectNextTime,
} from '../src/renderer/src/lib/front-door-words'
import { aChoiceInWords, whatAModelChoiceReaches } from '../src/shared/model-choice'
import {
  aChoiceForAnotherProviderSays,
  heldReachesSays,
  whatAProviderPressWouldClear,
  whatTheProviderPressCleared,
} from '../src/renderer/src/lib/agent-model-choice'
import type { AgentModelChoice } from '../src/shared/model-choice-contracts'

it.each(['claude', 'codex'] as const)(
  'explains new gives and existing work after a %s default change',
  (provider) => {
    const said = providerTakesEffectNextTime(provider)
    expect(said).toContain('Changing this starts nothing and moves nothing')
    expect(said).toContain(
      'Once you choose a default here, new gives without a provider or model use that provider’s conversation, starting one if needed',
    )
    expect(said).toContain('Existing pieces and follow-ups stay with their holders')
  },
)

const held: AgentModelChoice = { provider: 'claude', model: 'held-model', effort: 'high' }
const names = { claude: 'Fern', codex: 'Birch' }

it('distinguishes absent native presentation context from explicit unread selected names', () => {
  expect(aChoiceInWords(held)).toBe('“held-model” at high effort on Claude')
  expect(aChoiceInWords(held, {})).toBe('“held-model” at high effort on the provider')
  expect(aChoiceInWords(held, names)).toBe('“held-model” at high effort on Fern')
  expect(whatAModelChoiceReaches(held)).toContain('on Claude')
  expect(whatAModelChoiceReaches(held, {})).toContain('on the provider')
  expect(whatAModelChoiceReaches(held, names)).toContain('on Fern')
  expect(heldReachesSays(held, 'claude', names)).toBe(whatAModelChoiceReaches(held, names))
  expect(heldReachesSays(held, 'codex', names)).toBeNull()
  expect(aChoiceForAnotherProviderSays(held, 'codex', names)).toContain(
    'It is for Fern, and this agent runs on Birch',
  )
  expect(aChoiceForAnotherProviderSays(held, 'codex', {})).not.toMatch(/Claude|Codex/)
  expect(whatTheProviderPressCleared(held, 'codex', names)).toContain('on Fern')
  expect(whatTheProviderPressCleared(held, 'codex', names)).toContain('now Birch')
  expect(whatAProviderPressWouldClear(held, names)).toContain('other than Fern')
  expect(whatAProviderPressWouldClear(null, names)).toBeNull()
  expect(held).toEqual({ provider: 'claude', model: 'held-model', effort: 'high' })
})

it('uses supplied counted names and keeps no-provider and service branches intact', () => {
  const counts = { claude: 2, codex: 1 }
  expect(aProviderNotChosenSays('Worker', counts, names)).toContain('Fern (2) and Birch (1)')
  expect(aProviderNotChosenSays('Worker', counts, {})).toContain(
    'the provider (2) and the provider (1)',
  )
  expect(aProviderNotChosenSays('Worker', counts)).toContain('Claude (2) and Codex (1)')
  expect(noProviderSavedSays(null, names)).toBe('Not chosen yet')
  expect(
    noProviderSavedSays(
      { provider: null, from: 'its-conversations-differ', startedOn: counts },
      names,
    ),
  ).toBe('Not chosen: its conversations ran on both')
  expect(noProviderSavedSays({ provider: 'claude', from: 'its-conversations' }, names)).toBe(
    'Not saved: its conversations ran on Fern',
  )
  expect(providerTakesEffectNextTime('claude', true, false, names)).toContain(
    'is Fern, unless you choose another provider',
  )
  expect(providerTakesEffectNextTime('claude', true, false, {})).toContain('is the provider')
  expect(providerTakesEffectNextTime('claude', true, true, names)).toBe(
    providerTakesEffectNextTime('claude', true, true),
  )
  expect(counts).toEqual({ claude: 2, codex: 1 })
})
