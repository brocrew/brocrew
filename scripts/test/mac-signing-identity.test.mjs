import { describe, expect, it } from 'vitest'
import {
  expectedSigningIdentity,
  requireDistributionSignature,
  selectSigningCertificate,
} from '../lib/mac-signing-identity.mjs'
import { FICTIONAL_IDENTITY, FICTIONAL_SIGNING_ENV } from './fixtures/mac-signing-identity.mjs'

describe('independent runtime signing expectation', () => {
  it('reads the invented trusted configuration without deriving it from a candidate receipt', () => {
    expect(expectedSigningIdentity(FICTIONAL_SIGNING_ENV)).toEqual(FICTIONAL_IDENTITY)
  })
  for (const missing of ['MAC_EXPECTED_TEAM_ID', 'MAC_EXPECTED_SIGNING_AUTHORITY'])
    it(`refuses absent ${missing} with no fallback`, () => {
      const env = { ...FICTIONAL_SIGNING_ENV }
      delete env[missing]
      expect(() => expectedSigningIdentity(env)).toThrow('Configured Mac signing')
    })
  it('refuses mismatched team/authority metadata without printing either value', () => {
    const env = { ...FICTIONAL_SIGNING_ENV, MAC_EXPECTED_TEAM_ID: 'OTHER12345' }
    expect(() => expectedSigningIdentity(env)).toThrow('Configured Mac signing')
    try {
      expectedSigningIdentity(env)
    } catch (error) {
      expect(error.message).not.toContain(env.MAC_EXPECTED_SIGNING_AUTHORITY)
      expect(error.message).not.toContain(env.MAC_EXPECTED_TEAM_ID)
    }
  })
  it('selects exactly one certificate by the independently configured full authority', () => {
    const cert = `  1) ${'A'.repeat(40)} "${FICTIONAL_IDENTITY.authority}"\n`
    expect(selectSigningCertificate(cert, FICTIONAL_SIGNING_ENV)).toBe('A'.repeat(40))
    for (const text of ['', cert + cert, cert.replace('Fictional Developer', 'Other Developer')])
      expect(() => selectSigningCertificate(text, FICTIONAL_SIGNING_ENV)).toThrow()
  })
  it('refuses a different authority even when the team matches the receipt', () => {
    const signature = `Authority=${FICTIONAL_IDENTITY.authority}\nTeamIdentifier=${FICTIONAL_IDENTITY.teamId}\nTimestamp=fixture\nflags=0x10000(runtime)`
    expect(() =>
      requireDistributionSignature(signature, { identity: FICTIONAL_IDENTITY }),
    ).not.toThrow()
    expect(() =>
      requireDistributionSignature(signature.replace('Fictional Developer', 'Other Developer'), {
        identity: FICTIONAL_IDENTITY,
      }),
    ).toThrow('configured Mac signing identity')
  })
})
