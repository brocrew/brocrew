import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import { readProviderConfig } from '../src/main/runtime/provider-config'

/**
 * The info block exists to answer "where is this session's config?", so every line
 * of it has to be true. The first version guessed the file list and got it wrong in
 * both directions — it printed a `config.toml` that was not on disk and hid the
 * `.claude.json` that was. These tests pin the behaviour that replaced the guess:
 * the host looks, and reports what it finds.
 */
describe('readProviderConfig', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot2-config-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('reports a Codex home that has auth.json but no config.toml — the exact case that was wrong', () => {
    writeFileSync(join(home, 'auth.json'), '{}')

    const config = readProviderConfig('codex', home)
    const byName = Object.fromEntries(config.files.map((file) => [file.name, file]))

    expect(byName['auth.json']).toMatchObject({ exists: true, path: join(home, 'auth.json') })
    expect(byName['config.toml']).toMatchObject({ exists: false, path: join(home, 'config.toml') })
  })

  it('reports the .claude.json a Claude home actually has — it used to be hidden', () => {
    writeFileSync(join(home, '.claude.json'), '{}')

    const config = readProviderConfig('claude', home)
    const byName = Object.fromEntries(config.files.map((file) => [file.name, file]))

    expect(byName['.claude.json']).toMatchObject({ exists: true })
    expect(byName['settings.json']?.exists).toBe(false)
  })

  it('flips a file to present the moment it appears — the snapshot is re-readable', () => {
    expect(
      readProviderConfig('codex', home).files.find((f) => f.name === 'config.toml')?.exists,
    ).toBe(false)

    writeFileSync(join(home, 'config.toml'), 'model = "gpt-5"\n')

    expect(
      readProviderConfig('codex', home).files.find((f) => f.name === 'config.toml')?.exists,
    ).toBe(true)
  })

  it('states how each provider is configured at all', () => {
    // Codex reads a file; Claude is configured through SDK options and deliberately
    // ignores file settings. Saying so is the part that answers the real question.
    expect(readProviderConfig('codex', home).model).toMatch(/file-based/)
    expect(readProviderConfig('claude', home).model).toMatch(/programmatic/)
    expect(readProviderConfig('claude', home).model).toMatch(/settingSources/)
  })

  it('says where the credential is when it is not one of the files', () => {
    expect(readProviderConfig('claude', home).authNote).toMatch(/Keychain/)
    // Codex's credential IS one of the reported files, so there is nothing to add.
    expect(readProviderConfig('codex', home).authNote).toBeNull()
  })

  it('reads a home that does not exist as "nothing there" rather than throwing', () => {
    const missing = join(home, 'never-provisioned')
    const config = readProviderConfig('claude', missing)

    expect(config.files.every((file) => !file.exists)).toBe(true)
    expect(config.home).toBe(missing)
  })

  it('covers every supported provider, and never invents a path outside the home', () => {
    mkdirSync(join(home, 'sub'), { recursive: true })
    for (const provider of SUPPORTED_PROVIDERS) {
      const config = readProviderConfig(provider, home)
      expect(config.homeEnv).not.toBe('')
      expect(config.model).not.toBe('')
      expect(config.files.length).toBeGreaterThan(0)
      for (const file of config.files) {
        expect(file.path).toBe(join(home, file.name))
        expect(file.note).not.toBe('')
      }
    }
  })
})
