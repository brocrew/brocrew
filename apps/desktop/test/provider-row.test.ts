import { describe, expect, it } from 'vitest'
import type { AuthState, ProviderProgramStanding, ProviderVersion } from '../src/shared/runtime-ipc'
import { isReady } from '../src/renderer/src/lib/provider-setup-steps'
import {
  providerRowDetail,
  providerStanding,
  type ProviderRowFacts,
} from '../src/renderer/src/lib/provider-row'

const NOW = 2_000_000
const facts: ProviderRowFacts = {
  auth: { state: 'usable', login: 'account', expiresAt: null },
  key: { provider: 'claude', set: false, setAt: null, inUse: false },
  version: null,
  atItsLimit: null,
}
describe('one status vocabulary and one tightest limit line', () => {
  it.each<ProviderProgramStanding>([
    'missing',
    'older-than-tested',
    'unreadable',
    'tested',
    'newer-than-tested',
  ])('keeps %s consistent with setup across auth, saved keys and limits', (standing) => {
    const warns = ['missing', 'older-than-tested', 'unreadable'].includes(standing)
    const version: ProviderVersion = {
      version: '1.2.3',
      program: {
        standing,
        from: 'native-installer',
        path: '/fictional/bin/atlas',
        version: '1.2.3',
        tested: { oldest: '1.2.0', newest: '1.2.5' },
        said: 'Fictional program needs checking.',
        help: null,
        update: null,
        others: [],
        updatedFrom: null,
      },
    }
    const states: readonly [AuthState, boolean, boolean, ProviderRowFacts['atItsLimit'], string][] =
      [
        [{ state: 'usable', login: 'account', expiresAt: null }, false, false, null, 'Ready'],
        [
          { state: 'absent', reason: 'No fictional login.', why: 'no-login' },
          false,
          false,
          null,
          'Needs setup',
        ],
        [{ state: 'unknown', reason: 'No answer.' }, false, false, null, "Couldn't check"],
        [{ state: 'usable', login: 'api-key', expiresAt: null }, true, false, null, 'Needs setup'],
        [{ state: 'usable', login: 'account', expiresAt: null }, false, true, null, 'Needs setup'],
        [
          { state: 'usable', login: 'account', expiresAt: null },
          false,
          false,
          'At its limit.',
          'At its limit',
        ],
      ]
    for (const [auth, keyRefused, keyUnreadable, atItsLimit, words] of states) {
      const result = providerStanding({
        version,
        auth,
        atItsLimit,
        key: {
          provider: 'claude',
          set: keyRefused || keyUnreadable,
          setAt: null,
          inUse: keyRefused,
          ...(keyRefused ? { refusedForBilling: { at: NOW, aLoginRunsWithoutIt: false } } : {}),
          ...(keyUnreadable ? { readState: 'unreadable' as const } : {}),
        },
      })
      expect(result?.words).toBe(warns ? 'Needs setup' : words)
      expect(['ready', 'at-limit'].includes(result?.tone ?? '')).toBe(
        isReady({
          version,
          auth,
          setup: undefined,
          keyRefused,
          keyUnreadable: keyUnreadable ? 'Cannot read.' : null,
        }) === true,
      )
    }
  })
  it('keeps a pending check distinct from a failed check', () => {
    expect(providerStanding({ ...facts, auth: null })).toBeNull()
    expect(providerRowDetail({ ...facts, auth: null }, null, NOW)).toBe('Checking…')
    expect(
      providerStanding({ ...facts, auth: { state: 'unknown', reason: 'No answer.' } }),
    ).toEqual({ words: "Couldn't check", tone: 'unknown' })
  })
  it('uses Ready, Needs setup and amber At its limit from the existing facts', () => {
    expect(providerStanding(facts)).toEqual({ words: 'Ready', tone: 'ready' })
    expect(
      providerStanding({
        ...facts,
        auth: { state: 'absent', reason: 'No fictional login.', why: 'no-login' },
      }),
    ).toEqual({ words: 'Needs setup', tone: 'not-ready' })
    expect(providerStanding({ ...facts, atItsLimit: 'At its limit until later.' })).toEqual({
      words: 'At its limit',
      tone: 'at-limit',
    })
  })
  it('an unreadable saved key cannot be hidden by a usable account or a limit', () => {
    expect(
      providerStanding({
        ...facts,
        key: { provider: 'claude', set: true, setAt: NOW, inUse: false, readState: 'unreadable' },
        atItsLimit: 'At its limit.',
      })?.words,
    ).toBe('Needs setup')
  })
  it('quotes a failed login check rather than turning it into a setup instruction', () => {
    expect(
      providerRowDetail(
        { ...facts, auth: { state: 'unknown', reason: 'Fictional bridge did not answer.' } },
        [],
        NOW,
      ),
    ).toBe('Fictional bridge did not answer.')
  })
  it('uses the highest percentage without mutating the windows', () => {
    const readings = [
      { window: 'five_hour', usedPercent: 42, resetsAt: NOW + 3600000, at: NOW },
      { window: 'seven_day', usedPercent: 67, resetsAt: NOW + 86400000, at: NOW },
    ]
    expect(providerRowDetail(facts, readings, NOW)).toContain('Weekly limit: 67% used')
    expect(readings.map((reading) => reading.usedPercent)).toEqual([42, 67])
  })
  it('does not present a historical or unconfirmed window as current', () => {
    expect(
      providerRowDetail(
        facts,
        [
          {
            window: 'seven_day',
            usedPercent: 95,
            resetsAt: NOW - 3600000,
            at: NOW - 86400000,
            unconfirmed: true,
          },
        ],
        NOW,
      ),
    ).toContain('was 95% used')
  })
  it('distinguishes a saved key without usage windows from no usage reading', () => {
    expect(
      providerRowDetail(
        { ...facts, auth: { state: 'usable', login: 'api-key', expiresAt: null } },
        [],
        NOW,
      ),
    ).toBe('Runs on the saved API key.')
    expect(providerRowDetail(facts, [], NOW)).toBe('No usage reading yet.')
  })
})
