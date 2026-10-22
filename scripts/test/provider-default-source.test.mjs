import { describe, expect, it } from 'vitest'
import { providerDefaultFrom, providerRosterFrom } from '../lib/app-source.mjs'

const source = (first, second) => `
  // const PROVIDER_DESCRIPTORS = [{ id: 'decoy', defaults: { conversation: true } }]
  export const PROVIDER_DESCRIPTORS = [
    { id: 'alpha', displayName: 'Alpha', defaults: { conversation: ${first}, identity: true } },
    { id: 'beta', displayName: 'Beta', defaults: { conversation: ${second}, identity: false } },
  ] as const satisfies readonly Descriptor[]
`

describe('the source reader for provider defaults', () => {
  it('reads the declared flags and ignores a declaration inside prose', () => {
    expect(providerDefaultFrom(source(false, true))).toBe('beta')
    expect(providerDefaultFrom(source(true, false))).toBe('alpha')
    expect(providerDefaultFrom(source(false, true), 'identity')).toBe('alpha')
  })

  it('stops on an ambiguous, missing or computed default', () => {
    expect(() => providerDefaultFrom(source(true, true))).toThrow(/one default/)
    expect(() => providerDefaultFrom(source(false, false))).toThrow(/one default/)
    expect(() => providerDefaultFrom(source('choose()', false))).toThrow(/unreadable/)
    expect(() => providerDefaultFrom('export const PROVIDER_DESCRIPTORS = make()')).toThrow(/array/)
  })

  it('reads ids and display names in declaration order, ignoring prose', () => {
    expect(providerRosterFrom(source(false, true))).toEqual([
      { provider: 'alpha', name: 'Alpha' },
      { provider: 'beta', name: 'Beta' },
    ])
  })

  it('stops on an empty, duplicate or computed roster', () => {
    expect(() => providerRosterFrom('const PROVIDER_DESCRIPTORS = []')).toThrow(/no roster/)
    expect(() =>
      providerRosterFrom(source(false, true).replace("id: 'beta'", "id: 'alpha'")),
    ).toThrow(/duplicate/)
    expect(() =>
      providerRosterFrom(
        source(false, true).replace("displayName: 'Alpha'", 'displayName: name()'),
      ),
    ).toThrow(/unreadable/)
  })
})
