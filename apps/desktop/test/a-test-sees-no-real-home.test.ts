import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { personalCodexAuthPath } from '@brobot2/runtime'

/**
 * # A test sees no real home
 *
 * Every test process runs in a fictional home (`scripts/lib/tests-run-in-a-fictional-home.mjs`),
 * so a test, or a planted defect that removes a test's own isolation, reads a sign-in only from
 * there. This file fails where a test process could reach the person's own folders.
 */
describe('a test sees no real home', () => {
  const home = process.env['BROBOT_TESTS_HOME'] ?? ''

  it('🔒 the home directory is a fictional one, and not the one the computer records for this person', () => {
    expect(home).not.toBe('')
    expect(homedir()).toBe(home)
    expect(home).toContain('brobot2-tests-home-')
    expect(userInfo().homedir).not.toBe(home)
  })

  it('🔒 the default place of this computer’s Codex sign-in is inside it, and holds none', () => {
    expect(personalCodexAuthPath()).toBe(join(home, '.codex', 'auth.json'))
    expect(existsSync(personalCodexAuthPath())).toBe(false)
  })

  it('🔒 every folder a provider or an app reads a person’s own files from is inside it', () => {
    for (const name of [
      'HOME',
      'USERPROFILE',
      'CFFIXED_USER_HOME',
      'CODEX_HOME',
      'CODEX_SQLITE_HOME',
      'CLAUDE_CONFIG_DIR',
      'CLAUDE_SECURESTORAGE_CONFIG_DIR',
      'NVM_DIR',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_STATE_HOME',
      'XDG_CACHE_HOME',
      'APPDATA',
      'LOCALAPPDATA',
    ]) {
      expect(process.env[name]?.startsWith(home), name).toBe(true)
    }
  })

  it('🔒 no variable that is a credential by itself is left in a test process', () => {
    for (const name of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
    ]) {
      expect(process.env[name], name).toBeUndefined()
    }
  })

  it('🔒 the Keychain program a test process runs by name is the fictional home’s, which finds nothing', () => {
    expect((process.env['PATH'] ?? '').split(delimiter)[0]).toBe(join(home, 'bin'))
    expect(readFileSync(join(home, 'bin', 'security'), 'utf8')).toBe('#!/bin/sh\nexit 44\n')
  })
})
