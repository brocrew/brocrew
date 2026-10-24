import { expect, it } from 'vitest'
import { providerTakesEffectNextTime } from '../src/renderer/src/lib/front-door-words'

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
