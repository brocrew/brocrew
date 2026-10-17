import { describe, expect, it } from 'vitest'
import {
  afterNext,
  firstToDo,
  isReady,
  setupSteps,
  stepBefore,
  type SetupFacts,
} from '../src/renderer/src/lib/provider-setup-steps'
import type {
  AuthState,
  ProviderProgram,
  ProviderProgramStanding,
  ProviderVersion,
} from '../src/shared/runtime-ipc'

/**
 * Where a provider's setup stands, from the facts the window holds, and where Next lands after
 * they were read again: it moves on only when the step's own fact passes.
 */

const SETUP = {
  tool: 'The Tool',
  install: { command: 'install-the-tool', docs: 'https://example.com/install' },
  signInCommand: 'the-tool',
  platform: 'macOS' as const,
  shell: 'Terminal' as const,
}

function program(
  standing: ProviderProgramStanding,
  from: ProviderProgram['from'] = 'native-installer',
): ProviderVersion {
  const p: ProviderProgram = {
    standing,
    from: standing === 'missing' ? null : from,
    path: standing === 'missing' ? null : '/somewhere/the-tool',
    version: standing === 'missing' || standing === 'unreadable' ? null : '2.0.0',
    tested: { oldest: '1.0.0', newest: '1.9.0' },
    said: 'said',
    help: { label: 'How to install', url: 'https://example.com/help' },
    update: null,
    others: [],
    updatedFrom: null,
  }
  return p.version === null
    ? { version: null, reason: 'no version', program: p }
    : { version: p.version, program: p }
}

const SIGNED_IN: AuthState = { state: 'usable', login: 'account', expiresAt: null }
const ON_A_KEY: AuthState = { state: 'usable', login: 'api-key', expiresAt: null }
const SIGNED_OUT: AuthState = { state: 'absent', reason: 'Never signed in.' }

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  version: program('tested'),
  setup: SETUP,
  auth: SIGNED_IN,
  keyRefused: false,
  ...over,
})

describe('the steps a provider has', () => {
  it('a program to install has four; a carried copy, or nothing to set up outside, has two', () => {
    expect(setupSteps(facts())).toEqual(['install', 'version', 'sign-in', 'ready'])
    expect(setupSteps(facts({ version: program('tested', 'carried') }))).toEqual([
      'sign-in',
      'ready',
    ])
    expect(setupSteps(facts({ setup: null }))).toEqual(['sign-in', 'ready'])
  })
})

describe('the first step to do', () => {
  it('reads nothing before the facts land', () => {
    expect(firstToDo(facts({ version: null }))).toBeNull()
    expect(firstToDo(facts({ auth: null }))).toBeNull()
    expect(isReady(facts({ auth: null }))).toBeNull()
  })

  it('a missing program is the install step; a failed read is "could not check"', () => {
    expect(firstToDo(facts({ version: program('missing') }))).toEqual({
      step: 'install',
      kind: 'missing',
    })
    expect(firstToDo(facts({ version: { version: null, reason: 'the read failed' } }))).toEqual({
      step: 'install',
      kind: 'cannot-check',
    })
  })

  it('older than tested and unreadable stop the version step; newer than tested passes', () => {
    expect(firstToDo(facts({ version: program('older-than-tested') }))).toEqual({
      step: 'version',
      kind: 'older',
    })
    expect(firstToDo(facts({ version: program('unreadable') }))).toEqual({
      step: 'version',
      kind: 'unreadable',
    })
    expect(firstToDo(facts({ version: program('newer-than-tested') }))).toEqual({
      step: 'ready',
      kind: 'account',
    })
  })

  it('each sign-in absence is its own state', () => {
    const at = (auth: AuthState, keyRefused = false) => firstToDo(facts({ auth, keyRefused }))
    expect(at(SIGNED_OUT)).toEqual({ step: 'sign-in', kind: 'sign-in' })
    expect(at({ state: 'stale', reason: 'expired' })).toEqual({ step: 'sign-in', kind: 'expired' })
    expect(at({ state: 'absent', reason: 'r', why: 'expired' })?.kind).toBe('expired')
    expect(at({ state: 'unknown', reason: 'r' })?.kind).toBe('cannot-check')
    expect(at({ state: 'absent', reason: 'r', why: 'unreadable' })?.kind).toBe('cannot-check')
    expect(at(ON_A_KEY, true)).toEqual({ step: 'sign-in', kind: 'key-refused' })
    expect(at(ON_A_KEY)).toEqual({ step: 'ready', kind: 'api-key' })
    // A refused key matters only while the key is what runs.
    expect(at(SIGNED_IN, true)).toEqual({ step: 'ready', kind: 'account' })
  })

  it('a carried copy goes straight to its sign-in', () => {
    const carried = facts({ version: program('tested', 'carried'), auth: SIGNED_OUT })
    expect(firstToDo(carried)).toEqual({ step: 'sign-in', kind: 'sign-in' })
    expect(isReady(carried)).toBe(false)
    expect(isReady(facts({ version: program('tested', 'carried') }))).toBe(true)
  })
})

describe('Next', () => {
  it('stays on the step while its fact has not changed', () => {
    const missing = facts({ version: program('missing') })
    expect(afterNext({ step: 'install', kind: 'missing' }, missing)).toEqual({
      state: { step: 'install', kind: 'missing' },
      advanced: false,
    })
    const out = facts({ auth: SIGNED_OUT })
    expect(afterNext({ step: 'sign-in', kind: 'sign-in' }, out).advanced).toBe(false)
  })

  it('after the install, shows the version step, passed or not', () => {
    expect(afterNext({ step: 'install', kind: 'missing' }, facts())).toEqual({
      state: { step: 'version', kind: 'passed' },
      advanced: true,
    })
    const older = facts({ version: program('older-than-tested') })
    expect(afterNext({ step: 'install', kind: 'missing' }, older)).toEqual({
      state: { step: 'version', kind: 'older' },
      advanced: true,
    })
  })

  it('from a passed version, lands on the first step still to do', () => {
    expect(afterNext({ step: 'version', kind: 'passed' }, facts({ auth: SIGNED_OUT }))).toEqual({
      state: { step: 'sign-in', kind: 'sign-in' },
      advanced: true,
    })
    expect(afterNext({ step: 'version', kind: 'passed' }, facts())).toEqual({
      state: { step: 'ready', kind: 'account' },
      advanced: true,
    })
  })

  it('a version newer than tested moves on, quietly', () => {
    const newer = facts({ version: program('newer-than-tested'), auth: SIGNED_OUT })
    expect(afterNext({ step: 'version', kind: 'older' }, newer)).toEqual({
      state: { step: 'sign-in', kind: 'sign-in' },
      advanced: true,
    })
  })

  it('an earlier step that stopped passing comes first', () => {
    expect(
      afterNext({ step: 'sign-in', kind: 'sign-in' }, facts({ version: program('missing') })),
    ).toEqual({ state: { step: 'install', kind: 'missing' }, advanced: false })
  })

  it('Back shows the step before as the facts say it now', () => {
    expect(stepBefore({ step: 'version', kind: 'passed' }, facts())).toEqual({
      step: 'install',
      kind: 'found',
    })
    expect(stepBefore({ step: 'install', kind: 'missing' }, facts())).toBeNull()
    const carried = facts({ version: program('tested', 'carried') })
    expect(stepBefore({ step: 'ready', kind: 'account' }, carried)).toEqual({
      step: 'sign-in',
      kind: 'signed-in',
    })
  })
})

describe('a saved key this computer can’t read is not ready', () => {
  const SAYS = 'BroBot can’t read the API key saved for Claude on this computer.'

  it('🔴 it stops at the sign-in step, whatever the sign-in behind it says', () => {
    for (const auth of [ON_A_KEY, SIGNED_IN, SIGNED_OUT]) {
      const with_ = facts({ auth, keyUnreadable: SAYS })
      expect(firstToDo(with_)).toEqual({ step: 'sign-in', kind: 'key-unreadable' })
      expect(isReady(with_)).toBe(false)
    }
  })

  it('⚑ the control: a key it can read, or no such fact, is ready as before', () => {
    expect(isReady(facts({ auth: ON_A_KEY, keyUnreadable: null }))).toBe(true)
    expect(isReady(facts({ auth: ON_A_KEY }))).toBe(true)
  })
})
