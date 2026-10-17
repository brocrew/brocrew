import { afterEach, describe, expect, it } from 'vitest'
import {
  readProviderSetup,
  whyNoLogin,
  type ProviderSetupSays,
} from '../../src/renderer/src/lib/provider-setup'

/**
 * Main's setup facts, read for the setup window: `readProviderSetup` asks main for them and
 * `whyNoLogin` reads the reason off an auth state.
 */

const WITH_INSTALL: ProviderSetupSays = {
  tool: 'Claude Code',
  install: { command: 'npm install -g a-test-tool', docs: 'https://example.invalid/install' },
  signInCommand: 'a-test-tool login',
  platform: 'macOS',
  shell: 'Terminal',
}

afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

describe('§2 · readProviderSetup is main’s answer or null, never a throw', () => {
  it('⛔ no bridge method → null; ⛔ a read that rejects → null; ⚑ a read that answers → its answer', async () => {
    ;(window as unknown as { api: unknown }).api = { runtime: {} }
    await expect(readProviderSetup()).resolves.toBeNull()

    ;(window as unknown as { api: unknown }).api = {
      runtime: { providerSetup: () => Promise.reject(new Error('main did not answer')) },
    }
    await expect(readProviderSetup()).resolves.toBeNull()

    const answer = { claude: WITH_INSTALL }
    ;(window as unknown as { api: unknown }).api = {
      runtime: { providerSetup: () => Promise.resolve(answer) },
    }
    await expect(readProviderSetup()).resolves.toEqual(answer)
  })
})

describe('§3 · whyNoLogin reads only a string reason', () => {
  it('⚑ a string → that string; ⛔ a number, no reason, null → undefined', () => {
    expect(whyNoLogin({ state: 'missing', why: 'expired' })).toBe('expired')
    expect(whyNoLogin({ state: 'missing', why: 3 })).toBeUndefined()
    expect(whyNoLogin({ state: 'missing' })).toBeUndefined()
    expect(whyNoLogin(null)).toBeUndefined()
  })
})
