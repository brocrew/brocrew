import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as codex from '@brobot2/runtime/codex'
import { stopKeepingCodexSignInsInStep } from '../../../packages/runtime/src/codex/shared-sign-in'
import { aCodexWorkspace, aFakeNativeSignIn } from './lib/codex-workspace-fixture'

const signIn = (account: string, refresh: string, refreshed: string): string =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { account_id: account, access_token: `access-${refresh}`, refresh_token: refresh },
    last_refresh: refreshed,
  })
const keyOf = (path: string) =>
  (JSON.parse(readFileSync(path, 'utf8')) as { tokens: { refresh_token: string } }).tokens
    .refresh_token

/**
 * # Every Codex agent in a workspace uses the sign-in Settings shows
 *
 * A workspace has one Codex sign-in: the one BroBot's own profile holds, which Settings shows. Every
 * Codex agent runs on it. What an agent held before, whatever account it names, is replaced and
 * never read; and a sign-in started from any agent signs in that one.
 *
 * ⚑ The homes are laid out as an earlier BroCrew left them: BroBot's own and each agent linked to
 * a folder per account, an agent's spent copy of another account among them. Fictional sign-ins
 * only.
 */
describe('every Codex agent in a workspace uses the sign-in Settings shows', () => {
  let root: string
  const homeOf = (profile: string) => join(root, 'default', profile, 'codex')
  const accountPlace = (account: string) =>
    join(root, 'codex-sign-ins', Buffer.from(account).toString('hex'), 'auth.json')
  const keyIn = (profile: string) => keyOf(join(homeOf(profile), 'auth.json'))
  /** A home linked to an account's own place, as the per-account sharing left it. */
  const linkedToItsAccount = (profile: string, account: string, text: string) => {
    mkdirSync(join(accountPlace(account), '..'), { recursive: true })
    writeFileSync(accountPlace(account), text, { mode: 0o600 })
    mkdirSync(homeOf(profile), { recursive: true })
    symlinkSync(accountPlace(account), join(homeOf(profile), 'auth.json'))
  }

  const aWorkspace = () =>
    aCodexWorkspace(root, homeOf, ['brobot', 'ui-designer', 'fern'], {
      current: vi.fn(() => null),
      isSaved: () => false,
      change: vi.fn(),
    })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-workspace-sign-in-'))
    // Settings shows BroBot's own: account A, signed in and working.
    linkedToItsAccount(
      'brobot',
      'acct-fictional-a',
      signIn('acct-fictional-a', 'key-a', '2026-11-24T09:00:00Z'),
    )
  })
  afterEach(() => {
    stopKeepingCodexSignInsInStep()
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('🔴 an agent on another account’s spent copy starts on the Settings sign-in', async () => {
    // ui-designer: an old copy of account B from 14 Nov, already moved to B's own place.
    linkedToItsAccount(
      'ui-designer',
      'acct-fictional-b',
      signIn('acct-fictional-b', 'key-b-spent', '2026-11-14T16:00:00Z'),
    )
    await aWorkspace().home.prepare('ui-designer')
    expect(keyIn('ui-designer')).toBe('key-a')
    // B's spent copy was never a source: the workspace's is A's, untouched.
    expect(keyIn('brobot')).toBe('key-a')
    expect(keyOf(accountPlace('acct-fictional-b'))).toBe('key-b-spent')
  })

  it('🔴 an agent holding a copy of its own, on any account, is replaced by the Settings sign-in', async () => {
    mkdirSync(homeOf('fern'), { recursive: true })
    writeFileSync(
      join(homeOf('fern'), 'auth.json'),
      signIn('acct-fictional-c', 'key-c-newer', '2026-11-24T17:00:00Z'),
    )
    await aWorkspace().home.prepare('fern')
    expect(lstatSync(join(homeOf('fern'), 'auth.json')).isSymbolicLink()).toBe(true)
    expect(keyIn('fern')).toBe('key-a')
    // Even renewed later, another account's copy never becomes the workspace's.
    expect(keyIn('brobot')).toBe('key-a')
  })

  it('🔴 a sign-in started from a refused agent signs in the workspace’s one', async () => {
    linkedToItsAccount(
      'ui-designer',
      'acct-fictional-b',
      signIn('acct-fictional-b', 'key-b-spent', '2026-11-14T16:00:00Z'),
    )
    const module = aWorkspace()
    await module.home.prepare('ui-designer')
    // What Codex's own sign-in writes in the home it runs in.
    const native = aFakeNativeSignIn(
      signIn('acct-fictional-a', 'key-a-fresh', '2026-11-24T18:10:00Z'),
    )
    const started = await module.auth.signIn('ui-designer')
    expect((await started.completed).success).toBe(true)
    expect(dirname(native.ranIn()!)).toBe(homeOf('brobot'))
    // Every agent now reads the fresh sign-in, BroBot's own included.
    for (const profile of ['brobot', 'ui-designer']) expect(keyIn(profile)).toBe('key-a-fresh')
    expect(module.auth.credentialHome('ui-designer')).toBe(homeOf('brobot'))
  })

  it('⚑ with no sign-in in Settings, an agent asks for one and keeps what it held', async () => {
    rmSync(join(homeOf('brobot'), 'auth.json'))
    mkdirSync(homeOf('fern'), { recursive: true })
    const held = signIn('acct-fictional-c', 'key-c', '2026-11-20T08:00:00Z')
    writeFileSync(join(homeOf('fern'), 'auth.json'), held)
    await expect(aWorkspace().home.prepare('fern')).rejects.toThrow(/no Codex sign-in/)
    expect(readFileSync(join(homeOf('fern'), 'auth.json'), 'utf8')).toBe(held)
  })

  describe.each(['links', 'copies'] as const)('when the workspace uses %s', (storage) => {
    it.each(['success', 'failure', 'cancel'] as const)(
      'signs in again without logout or revoke and publishes only on success (%s)',
      async (outcome) => {
        if (storage === 'copies') {
          const ownSignIn = join(homeOf('brobot'), 'auth.json')
          const old = readFileSync(ownSignIn)
          rmSync(ownSignIn)
          writeFileSync(ownSignIn, old)
          const share = codex.shareCodexSignIn
          vi.spyOn(codex, 'shareCodexSignIn').mockImplementation((home, options) =>
            share(home, {
              ...options,
              platform: 'win32',
              link() {
                throw Object.assign(new Error('Fictional Windows link refusal'), { code: 'EPERM' })
              },
            }),
          )
        }
        const module = aWorkspace()
        const profiles = ['brobot', 'fern', 'ui-designer']
        for (const profile of profiles) await module.home.prepare(profile)
        let finish!: () => void
        const browser = new Promise<void>((resolve) => {
          finish = resolve
        })
        const native = aFakeNativeSignIn(
          signIn('acct-fictional-a', 'key-a-fresh', '2026-11-24T18:10:00Z'),
          { finish: browser, success: outcome !== 'failure' },
        )
        const attempt = await module.auth.signIn('brobot')
        const pending = profiles.map(keyIn)
        if (outcome === 'cancel') await attempt.cancel()
        finish()
        const completed = await attempt.completed
        expect(pending).toEqual(profiles.map(() => 'key-a'))
        expect(completed.success).toBe(outcome === 'success')
        for (const profile of profiles)
          expect(keyIn(profile)).toBe(outcome === 'success' ? 'key-a-fresh' : 'key-a')
        for (const profile of profiles)
          expect(lstatSync(join(homeOf(profile), 'auth.json')).isSymbolicLink()).toBe(
            storage === 'links',
          )
        expect(native.requests).toContain('account/login/start')
        expect(native.requests.filter((method) => /logout|revoke/.test(method))).toEqual([])
        expect(module.auth.credentialHome('fern')).toBe(homeOf('brobot'))
        expect(existsSync(native.ranIn()!)).toBe(false)
      },
    )
  })
})
