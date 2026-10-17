import type { ModelChoice } from '@brobot2/runtime'
import { describe, expect, it } from 'vitest'
import {
  aPairInWords,
  refuseModelChoice,
  theEffortWhenNoneIsNamed,
  theListsSpelling,
} from '../src/shared/model-choice'

const reason = (...args: Parameters<typeof refuseModelChoice>) => {
  const refused = refuseModelChoice(...args)
  return refused.ok ? null : refused.reason
}

describe('a refusal says what it could not name in plain words', () => {
  it('a choice for another provider, when the provider chosen for is not known', () => {
    expect(reason('not-its-provider', { profileId: 'fictional', itsProvider: 'claude' })).toBe(
      'Choose a Claude model: “fictional” runs on Claude, and a choice is always for its own ' +
        'provider — change its provider first to choose for another. Nothing was saved.',
    )
  })

  it('a list that could not be read, when the provider is not known', () => {
    expect(reason('models-unavailable', { profileId: 'fictional' })).toBe(
      'Nothing was saved: the provider could not be asked which models it offers.',
    )
  })

  it('a model not on the list, when neither the model nor the provider is known', () => {
    expect(reason('model-not-offered', { profileId: 'fictional' })).toBe(
      'Pick a model from the list: “?” is not in the provider’s list, nor one you added.',
    )
  })

  it('an effort the model does not offer, when the model is not known', () => {
    expect(reason('effort-not-offered', { profileId: 'fictional' })).toBe(
      'Leave the effort out: “?” offers no effort level.',
    )
    expect(reason('effort-not-offered', { profileId: 'fictional', offered: ['low'] })).toBe(
      'Pick an effort “?” offers: “low”.',
    )
  })
})

describe('a pair and a spelling, as the list has them', () => {
  it('says a model that offers no effort by its name alone', () => {
    expect(aPairInWords({ model: 'haiku', effort: null })).toBe('“haiku”')
  })

  it('spells a model named by what an alias points at as the alias row spells it', () => {
    const alias: ModelChoice = { id: 'opus', label: 'Opus', resolvesTo: 'claude-opus-5-5' }
    expect(theListsSpelling(alias, 'OPUS')).toBe('opus')
    expect(theListsSpelling(alias, 'Claude-Opus-5-5')).toBe('claude-opus-5-5')
    expect(theListsSpelling({ id: 'haiku', label: 'Haiku' }, 'claude-haiku')).toBe('haiku')
  })
})

describe('the effort a model runs at when none is named', () => {
  const efforts = [
    { id: 'low', label: 'Low' },
    { id: 'high', label: 'High' },
  ]
  const row: ModelChoice = { id: 'fictional', label: 'Fictional', efforts }

  it('is the provider default row’s own default, when this row offers it', () => {
    const list: ModelChoice[] = [
      { id: 'default', label: 'Default', isDefault: true, defaultEffort: 'high' },
      row,
    ]
    expect(theEffortWhenNoneIsNamed(row, list)).toBe('high')
  })

  it('is unnamed when this row does not offer the provider’s default', () => {
    const list: ModelChoice[] = [
      { id: 'default', label: 'Default', isDefault: true, defaultEffort: 'max' },
      row,
    ]
    expect(theEffortWhenNoneIsNamed(row, list)).toBeUndefined()
  })
})
