import { describe, expect, it, vi } from 'vitest'
import { claudeLoginFacts, claudeLoginState, whyNoClaudeLogin } from '../src/internal/auth'

/** The sentence a computer that is not Windows says, which is the one this test runs on. */
const NO_LOGIN = whyNoClaudeLogin({ platform: 'darwin' })

/**
 * # 🔒 What the Claude login says about itself, without the token
 *
 * Landing coverage for `claudeLoginFacts` and `claudeLoginState`, which feed the Providers screen's
 * "signed in as … on the Max plan, until …". ⚑ The login's end is the REFRESH token's end — the date
 * Claude's own "login expires in N days" counts down to — and it is `null` wherever that notice says
 * nothing: absent, past, or stale beside an access token that outlives it by days. ⛔ No token, and no
 * part of one, ever leaves.
 */

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const DAY = 24 * HOUR
const TOKEN = 'sk-ant-oat-secret-access-token'
const REFRESH = 'sk-ant-ort-secret-refresh-token'

const blob = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: TOKEN,
      refreshToken: REFRESH,
      expiresAt: NOW + 8 * HOUR,
      refreshTokenExpiresAt: NOW + 20 * DAY,
      subscriptionType: 'max',
      ...over,
    },
  })

describe('claudeLoginFacts', () => {
  it('🔴 says the plan and the refresh token’s end', () => {
    expect(claudeLoginFacts(blob(), NOW)).toEqual({ expiresAt: NOW + 20 * DAY, plan: 'max' })
  })

  it('⛔ is nothing when there is no usable access token: absent, malformed, empty or expired', () => {
    expect(claudeLoginFacts(null, NOW)).toBeNull()
    expect(claudeLoginFacts('not json', NOW)).toBeNull()
    expect(claudeLoginFacts(JSON.stringify({}), NOW)).toBeNull()
    expect(claudeLoginFacts(blob({ accessToken: '' }), NOW)).toBeNull()
    expect(claudeLoginFacts(blob({ expiresAt: NOW - 1 }), NOW)).toBeNull()
  })

  it('🔴 the end is null wherever Claude’s own notice would say nothing', () => {
    // The blob does not say.
    expect(claudeLoginFacts(blob({ refreshTokenExpiresAt: undefined }), NOW)?.expiresAt).toBeNull()
    expect(claudeLoginFacts(blob({ refreshTokenExpiresAt: 'soon' }), NOW)?.expiresAt).toBeNull()
    expect(claudeLoginFacts(blob({ refreshTokenExpiresAt: null }), NOW)?.expiresAt).toBeNull()
    // The date has passed while the access token still works.
    expect(claudeLoginFacts(blob({ refreshTokenExpiresAt: NOW - HOUR }), NOW)?.expiresAt).toBeNull()
    expect(claudeLoginFacts(blob({ refreshTokenExpiresAt: NOW }), NOW)?.expiresAt).toBeNull()
  })

  it('⚑ an access token that outlives the end by more than three days makes the end stale, and by less does not', () => {
    const end = NOW + DAY
    expect(
      claudeLoginFacts(blob({ refreshTokenExpiresAt: end, expiresAt: end + 3 * DAY }), NOW)
        ?.expiresAt,
    ).toBe(end)
    expect(
      claudeLoginFacts(blob({ refreshTokenExpiresAt: end, expiresAt: end + 3 * DAY + 1 }), NOW)
        ?.expiresAt,
    ).toBeNull()
  })

  it('⚑ an access token with no end of its own cannot make the refresh end stale', () => {
    expect(
      claudeLoginFacts(blob({ expiresAt: undefined, refreshTokenExpiresAt: NOW + DAY }), NOW)
        ?.expiresAt,
    ).toBe(NOW + DAY)
  })

  it('⚑ the plan is the provider’s own word, or nothing', () => {
    expect(claudeLoginFacts(blob({ subscriptionType: 'pro' }), NOW)?.plan).toBe('pro')
    expect(claudeLoginFacts(blob({ subscriptionType: '' }), NOW)?.plan).toBeNull()
    expect(claudeLoginFacts(blob({ subscriptionType: 3 }), NOW)?.plan).toBeNull()
    expect(claudeLoginFacts(blob({ subscriptionType: undefined }), NOW)?.plan).toBeNull()
  })

  it('⛔ no part of either token is in what it returns', () => {
    const said = JSON.stringify(claudeLoginFacts(blob(), NOW))
    expect(said).not.toContain(TOKEN)
    expect(said).not.toContain(REFRESH)
    expect(said).not.toContain('secret')
  })
})

describe('claudeLoginState', () => {
  it('🔴 a saved key is what runs: it outranks the login, does not expire, and the keychain is never read', () => {
    const reader = vi.fn(() => blob())
    expect(
      claudeLoginState(
        reader,
        () => 'sk-ant-api-key',
        () => NOW,
      ),
    ).toEqual({
      state: 'usable',
      login: 'api-key',
      expiresAt: null,
    })
    expect(reader).not.toHaveBeenCalled()
  })

  it('🔴 with no key the login’s facts are the answer: an account, its plan, and its end', () => {
    expect(
      claudeLoginState(
        () => blob(),
        () => null,
        () => NOW,
      ),
    ).toEqual({
      state: 'usable',
      login: 'account',
      plan: 'max',
      expiresAt: NOW + 20 * DAY,
    })
    // With no key provider at all, as a library caller has none.
    expect(
      claudeLoginState(
        () => blob(),
        undefined,
        () => NOW,
      ),
    ).toMatchObject({ login: 'account' })
  })

  it('⚑ a login that does not say its plan carries no plan key, rather than an empty one', () => {
    const state = claudeLoginState(
      () => blob({ subscriptionType: undefined }),
      undefined,
      () => NOW,
    )
    expect(state).toMatchObject({ state: 'usable', login: 'account', expiresAt: NOW + 20 * DAY })
    expect(state).not.toHaveProperty('plan')
  })

  it('⛔ no key and no usable login is absent, in the sentence that names the API key first', () => {
    expect(
      claudeLoginState(
        () => null,
        () => null,
        () => NOW,
        'darwin',
      ),
    ).toEqual({
      state: 'absent',
      reason: NO_LOGIN,
      why: 'no-login',
    })
    expect(NO_LOGIN.indexOf('API key')).toBeLessThan(NO_LOGIN.indexOf('login'))
    expect(
      claudeLoginState(
        () => blob({ expiresAt: NOW - 1 }),
        undefined,
        () => NOW,
        'darwin',
      ),
    ).toEqual({
      state: 'absent',
      reason: NO_LOGIN,
      why: 'expired',
    })
  })

  it('⛔ a key provider that throws is not swallowed: the caller says it in its own words', () => {
    expect(() =>
      claudeLoginState(
        () => blob(),
        () => {
          throw new Error('cannot open')
        },
      ),
    ).toThrow('cannot open')
  })
})
