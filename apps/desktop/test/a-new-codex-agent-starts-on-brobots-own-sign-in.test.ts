import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NoCodexSignInOnThisComputerError, personalCodexAuthPath } from '@brobot2/runtime'
import {
  DEFAULT_PROFILE_ID,
  deriveProviderHome,
  prepareProviderHome,
} from '../src/main/runtime/provider-homes'
import { aFictionalHome } from './lib/a-fictional-home'

/**
 * A sign-in file is compared by a digest of its bytes, so a failure prints two digests and never
 * what a file holds.
 */
const digestOf = (bytes: string | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16)
const signInAt = (path: string): string => digestOf(readFileSync(path))

/**
 * # A new Codex agent starts on BroBot's own sign-in, where this computer has none
 *
 * A Codex agent's first start copies the sign-in Codex keeps on this computer. A person who signed
 * in to Codex only inside BroBot, on the Codex card in Providers, has none there, and every new
 * GPT agent was refused. Its first start now copies BroBot's own instead. The computer's own still
 * comes first, and BroBot's own profile never copies from itself.
 *
 * ⚑ A scratch data folder, fictional sign-in files, and a fictional place for this computer's own,
 * in a fictional home for the whole file: code that ignored that place would read a fictional
 * decoy, never the real `~/.codex`.
 */
describe('a new Codex agent starts on BroBot’s own sign-in, where this computer has none', () => {
  const fictional = aFictionalHome()
  let userData: string
  let machine: string
  const OWN = '{"tokens":{"access_token":"BROBOT-OWN-FICTIONAL"}}'
  const MACHINE = '{"tokens":{"access_token":"MACHINE-FICTIONAL"}}'

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-own-sign-in-'))
    machine = join(mkdtempSync(join(tmpdir(), 'brobot2-machine-')), 'auth.json')
  })
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
    rmSync(join(machine, '..'), { recursive: true, force: true })
  })

  const seams = () => ({ machineCodexAuthPath: () => machine })
  const own = () =>
    deriveProviderHome(userData, { profileId: DEFAULT_PROFILE_ID, provider: 'codex' })

  /** BroBot's own profile, signed in on the Codex card: its home holds a sign-in. */
  async function brobotSignedIn(): Promise<void> {
    await prepareProviderHome(
      userData,
      { profileId: DEFAULT_PROFILE_ID, provider: 'codex' },
      { provisionCodexAuth: () => {} },
    )
    writeFileSync(join(own(), 'auth.json'), OWN, { mode: 0o600 })
  }

  const helper = (profileId = 'farah') =>
    prepareProviderHome(userData, { profileId, provider: 'codex' }, seams())

  it('🔒 the whole file runs in a fictional home: this computer’s sign-in is read only from there', () => {
    expect(personalCodexAuthPath()).toBe(join(fictional.home(), '.codex', 'auth.json'))
  })

  it('🔴 a helper’s first start copies BroBot’s own when this computer has no Codex sign-in', async () => {
    await brobotSignedIn()
    const home = await helper()
    expect(signInAt(join(home, 'auth.json'))).toBe(digestOf(OWN))
    // ⚑ A copy, never the same file: each home renews its own.
    expect(join(home, 'auth.json')).not.toBe(join(own(), 'auth.json'))
  })

  it('⚑ this computer’s own sign-in still comes first', async () => {
    await brobotSignedIn()
    writeFileSync(machine, MACHINE, { mode: 0o600 })
    const home = await helper()
    expect(signInAt(join(home, 'auth.json'))).toBe(digestOf(MACHINE))
  })

  it('⚑ with neither, the helper is refused as having no Codex sign-in to start on', async () => {
    await expect(helper()).rejects.toThrow(NoCodexSignInOnThisComputerError)
  })

  it('⛔ BroBot’s own profile never copies from itself', async () => {
    await expect(
      prepareProviderHome(userData, { profileId: DEFAULT_PROFILE_ID, provider: 'codex' }, seams()),
    ).rejects.toThrow(NoCodexSignInOnThisComputerError)
    expect(existsSync(join(own(), 'auth.json'))).toBe(false)
  })

  it('⚑ a helper that already has a sign-in keeps it', async () => {
    await brobotSignedIn()
    const home = await helper()
    writeFileSync(join(home, 'auth.json'), '{"tokens":{"access_token":"ITS-OWN"}}', { mode: 0o600 })
    await helper()
    expect(signInAt(join(home, 'auth.json'))).toBe(
      digestOf('{"tokens":{"access_token":"ITS-OWN"}}'),
    )
  })
})
