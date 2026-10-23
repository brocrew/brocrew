import { describe, expect, it } from 'vitest'
import { AuthUnavailableError, ClaudeUnavailableError, CodexSettingsUnusableError } from '@brobot2/runtime'
import { providerAuthPolicies } from '../src/main/providers/auth-definitions'
import { CodexUnavailableError } from '../src/main/runtime/codex-binary'
import { whyALaunchWasRefused } from '../src/main/runtime/launch-refusal'

function classifier(provider: keyof typeof providerAuthPolicies): (error: unknown) => 'profile' | 'program' | null {
  const read = Reflect.get(providerAuthPolicies[provider], 'launchRefusal') as ((error: unknown) => 'profile' | 'program' | null) | undefined
  expect(read).toBeTypeOf('function')
  if (read === undefined) throw new Error('The provider launch classifier is absent')
  return read
}

describe('provider-owned native launch facts', () => {
  it('classifies only the native program failure for Claude', () => {
    const read = classifier('claude')
    expect(read(new ClaudeUnavailableError('fictional unavailable program'))).toBe('program')
    expect(read(new CodexUnavailableError('fictional other program'))).toBeNull()
    expect(read(new AuthUnavailableError('claude', 'fictional unavailable login'))).toBeNull()
    expect(read(new Error('ClaudeUnavailableError'))).toBeNull()
  })

  it('keeps an unusable Codex profile distinct from its unavailable program', () => {
    const read = classifier('codex')
    expect(read(new CodexSettingsUnusableError('fictional unusable profile'))).toBe('profile')
    expect(read(new CodexUnavailableError('fictional unavailable program'))).toBe('program')
    expect(read(new ClaudeUnavailableError('fictional other program'))).toBeNull()
    expect(read(new AuthUnavailableError('codex', 'fictional unavailable login'))).toBeNull()
    expect(read(new Error('CodexSettingsUnusableError'))).toBeNull()
  })

  it.each([
    [new CodexSettingsUnusableError('fictional unusable profile'), 'launch'],
    [new AuthUnavailableError('codex', 'fictional unavailable login'), 'sign-in'],
    [new AuthUnavailableError('claude', 'fictional unavailable login'), 'sign-in'],
    [new ClaudeUnavailableError('fictional unavailable program'), 'program'],
    [new CodexUnavailableError('fictional unavailable program'), 'program'],
    [new Error('CodexSettingsUnusableError: fictional prose only'), null],
  ])('keeps the existing shared refusal answer %#', (error, expected) => {
    expect(whyALaunchWasRefused(error)).toBe(expected)
  })
})
