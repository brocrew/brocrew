import { describe, expect, it } from 'vitest'
import { buildChildEnv, ESSENTIAL_ENV_KEYS } from '../src/internal/child-env'

/**
 * Unit tests for the **allow-list** child-env builder (026, tightening 021 after
 * 023 P1-G). Only documented runtime essentials cross from the inherited env; every
 * other variable — especially any ambient credential a denylist could never
 * enumerate — is dropped. The intended provider vars cross ONLY via `add`, and the
 * parent `process.env` is never mutated.
 */

const BASE: NodeJS.ProcessEnv = {
  // Essentials that MUST be kept:
  PATH: '/usr/bin:/bin',
  HOME: '/home/me',
  SHELL: '/bin/zsh',
  USER: 'me',
  LANG: 'en_US.UTF-8',
  LC_CTYPE: 'en_US.UTF-8',
  TZ: 'UTC',
  TMPDIR: '/tmp',
  HTTPS_PROXY: 'http://proxy:8080',
  NODE_EXTRA_CA_CERTS: '/etc/ssl/corp.pem',
  // Ambient secrets + unrelated vars that MUST be dropped (a denylist can't name them all):
  CLAUDE_CODE_OAUTH_TOKEN: 'ambient-oauth-SHOULD-NOT-LEAK',
  GITHUB_TOKEN: 'ghp_SHOULD-NOT-LEAK',
  AWS_SECRET_ACCESS_KEY: 'aws-SHOULD-NOT-LEAK',
  OPENAI_API_KEY: 'oai-SHOULD-NOT-LEAK',
  ANTHROPIC_API_KEY: 'sk-SHOULD-NOT-LEAK',
  GOOGLE_APPLICATION_CREDENTIALS: '/creds/SHOULD-NOT-LEAK.json',
  SSH_AUTH_SOCK: '/ssh-agent/SHOULD-NOT-LEAK',
  SOME_INTERNAL_CONFIG: 'irrelevant-SHOULD-NOT-LEAK',
  // Isolation redirectors that must also be dropped (re-added only via `add`):
  CLAUDE_CONFIG_DIR: '/personal/.claude',
  CODEX_HOME: '/personal/.codex',
  // ADVERSARIAL locale-shaped secrets (036 P1-G): an `LC_` prefix must NOT launder a credential.
  LC_GITHUB_TOKEN: 'ghp_LOCALE_SHAPED-SHOULD-NOT-LEAK',
  LC_FOO_KEY: 'key-LOCALE_SHAPED-SHOULD-NOT-LEAK',
  LC_X_SECRET: 'secret-LOCALE_SHAPED-SHOULD-NOT-LEAK',
  LC_SVC_PASSWORD: 'pw-LOCALE_SHAPED-SHOULD-NOT-LEAK',
  LC_API_CREDENTIAL: 'cred-LOCALE_SHAPED-SHOULD-NOT-LEAK',
  LC_BASIC_AUTH: 'auth-LOCALE_SHAPED-SHOULD-NOT-LEAK',
  lc_lowercase_token: 'lower-LOCALE_SHAPED-SHOULD-NOT-LEAK',
}

describe('buildChildEnv — allow-list (026)', () => {
  it('keeps ONLY the documented runtime essentials (incl. locale + proxy + cert vars)', () => {
    const env = buildChildEnv({}, BASE)
    expect(env['PATH']).toBe('/usr/bin:/bin')
    expect(env['HOME']).toBe('/home/me')
    expect(env['SHELL']).toBe('/bin/zsh')
    expect(env['USER']).toBe('me')
    expect(env['LANG']).toBe('en_US.UTF-8')
    expect(env['LC_CTYPE']).toBe('en_US.UTF-8') // a real locale category, kept by NAME (no wildcard)
    expect(env['TZ']).toBe('UTC')
    expect(env['TMPDIR']).toBe('/tmp')
    expect(env['HTTPS_PROXY']).toBe('http://proxy:8080')
    expect(env['NODE_EXTRA_CA_CERTS']).toBe('/etc/ssl/corp.pem')
  })

  it('drops EVERY non-essential inherited variable — no ambient secret survives', () => {
    const env = buildChildEnv({}, BASE)
    for (const dropped of [
      'CLAUDE_CODE_OAUTH_TOKEN',
      'GITHUB_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'SSH_AUTH_SOCK',
      'SOME_INTERNAL_CONFIG', // an unrelated var a denylist would never name
      'CLAUDE_CONFIG_DIR',
      'CODEX_HOME',
    ]) {
      expect(env[dropped]).toBeUndefined()
    }
  })

  it('drops locale-SHAPED secrets — an LC_ prefix cannot launder a credential (036 P1-G)', () => {
    const env = buildChildEnv({}, BASE)
    // Pre-fix the `LC_*` wildcard kept every one of these: a prefix allow-list must never
    // override the credential-name deny rule.
    for (const dropped of [
      'LC_GITHUB_TOKEN',
      'LC_FOO_KEY',
      'LC_X_SECRET',
      'LC_SVC_PASSWORD',
      'LC_API_CREDENTIAL',
      'LC_BASIC_AUTH',
      'lc_lowercase_token', // dropped by the allow-list itself (the Set is case-sensitive, uppercase-only)
      'GITHUB_TOKEN', // and the plain ambient form is still dropped
    ]) {
      expect(env[dropped]).toBeUndefined()
    }
    // Nothing whose NAME looks credential-bearing survives from the inherited env, and no
    // leak marker reaches the child by any key.
    expect(
      Object.keys(env).filter((k) => /token|key|secret|password|passwd|credential|auth/i.test(k)),
    ).toEqual([])
    expect(Object.values(env).filter((v) => v?.includes('SHOULD-NOT-LEAK'))).toEqual([])
  })

  it('the secret-name veto never strips a documented essential (standing over-block guard)', () => {
    // The veto is a substring rule, so a careless new fragment could silently break a real launch —
    // e.g. `PAT` would veto PATH, `CERT` would veto SSL_CERT_FILE/NODE_EXTRA_CA_CERTS. This asserts
    // EVERY allow-listed essential still crosses, so such a mistake fails here instead of in a smoke.
    const base: NodeJS.ProcessEnv = Object.fromEntries(
      [...ESSENTIAL_ENV_KEYS].map((key) => [key, `v-${key}`]),
    )
    const env = buildChildEnv({}, base)
    expect(Object.keys(env).sort()).toEqual([...ESSENTIAL_ENV_KEYS].sort())
  })

  it('keeps the REAL locale categories (the narrow explicit set replacing the wildcard)', () => {
    const locales: NodeJS.ProcessEnv = {
      LANG: 'en_US.UTF-8',
      LANGUAGE: 'en_US:en',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'en_US.UTF-8',
      LC_COLLATE: 'C',
      LC_MESSAGES: 'en_US.UTF-8',
      LC_MONETARY: 'en_US.UTF-8',
      LC_NUMERIC: 'en_US.UTF-8',
      LC_TIME: 'en_US.UTF-8',
      LC_PAPER: 'en_US.UTF-8',
      LC_ADDRESS: 'en_US.UTF-8',
      LC_TELEPHONE: 'en_US.UTF-8',
      LC_MEASUREMENT: 'en_US.UTF-8',
      LC_IDENTIFICATION: 'en_US.UTF-8',
      LC_NAME: 'en_US.UTF-8',
    }
    const env = buildChildEnv({}, locales)
    // Every real locale category still crosses — the veto must not over-block (smokes rely on this).
    expect(env).toEqual(locales)
  })

  it('layers the intended provider vars from `add` (the only path a home/token crosses)', () => {
    const env = buildChildEnv(
      { CLAUDE_CONFIG_DIR: '/profile/home', CLAUDE_CODE_OAUTH_TOKEN: 'intended-token' },
      BASE,
    )
    expect(env['CLAUDE_CONFIG_DIR']).toBe('/profile/home')
    // An INTENDED token from the provider `add` crosses; the AMBIENT one never does. This is the
    // veto ORDERING guarantee (040): the secret-name veto applies to the INHERITED env only, and
    // `add` is layered after it — so 022's Keychain-bridge token is not stripped by its own name.
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('intended-token')
  })

  it('never mutates the base env and returns a fresh object (concurrent-profile safe)', () => {
    const env = buildChildEnv({ CODEX_HOME: '/profile/home' }, BASE)
    expect(env).not.toBe(BASE)
    expect(BASE['CODEX_HOME']).toBe('/personal/.codex')
    expect(BASE['GITHUB_TOKEN']).toBe('ghp_SHOULD-NOT-LEAK') // base untouched
  })

  it('defaults the base to process.env without writing provider vars back onto it', () => {
    const marker = `/profile/home-${process.pid}`
    const env = buildChildEnv({ CLAUDE_CONFIG_DIR: marker })
    expect(env['CLAUDE_CONFIG_DIR']).toBe(marker)
    expect(process.env['CLAUDE_CONFIG_DIR']).not.toBe(marker)
  })
})
