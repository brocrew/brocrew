import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError } from '@brobot2/runtime'
import {
  claudeCommandIn,
  claudeLoginNotRenewed,
  claudeLoginRenewer,
  parseClaudeOAuthToken,
} from '@brobot2/runtime/claude'
import { claudeDesktopInputs } from '../src/main/providers/claude/desktop'
import { claudeAuth, createClaudeModule } from '../src/main/providers/claude/index'

const store = vi.hoisted(() => ({ login: null as string | null }))
vi.mock('@brobot2/runtime/claude', async (original) => ({
  ...(await original<typeof import('@brobot2/runtime/claude')>()),
  defaultKeychainReaderForALaunch: async () => store.login,
}))

const HOUR = 60 * 60 * 1000
function login(accessToken: string, expiresAt: number): string {
  return JSON.stringify({
    claudeAiOauth: {
      accessToken,
      refreshToken: 'fictional-refresh',
      expiresAt,
      refreshTokenExpiresAt: Date.now() + 30 * 24 * HOUR,
      subscriptionType: 'max',
    },
  })
}

const paths = {
  managedRoot: '/fictional/homes',
  defaultProfile: 'fern',
  homeOf: (profile: string) => `/fictional/homes/${profile}/claude`,
  profiles: () => ['fern'],
  assertMayOpen: () => {},
}

type Run = () => Promise<{ code: number | null; timedOut: boolean }>

/** The Claude inputs as the desktop wires them, with the real renewer running a fake Claude Code. */
function inputsFor(run: Run, found: boolean, key: string | null = null) {
  const context = {
    isPackaged: false,
    resourcesPath: '/fictional/resources',
    platform: 'darwin' as const,
    arch: 'arm64',
    managedRoot: '/fictional/homes',
    readableFolders: ['/fictional/kept'],
    commandLine: { hasSwitch: () => false, getSwitchValue: () => '' },
    signal: new AbortController().signal,
    keys: {
      read: async () => key,
      current: async () => key,
      status: () => ({ set: key !== null }),
    },
  }
  const inputs = claudeDesktopInputs(context as never, {
    findProgram: (() => {
      if (!found) throw new Error('No Claude Code here')
      return { path: '/fictional/claude', from: 'given', update: null, others: [] }
    }) as never,
    readLogin: async () => store.login,
    renewal: (seams) => claudeLoginRenewer({ ...seams, run }),
  })
  return inputs
}

/** The Providers check. */
function check(run: Run, found = true) {
  const auth = claudeAuth(paths, inputsFor(run, found).auth)
  return () => auth.check('fern')
}

/** The launch a model list reads through, which says whether the provider needs setup. */
function modelListLaunch(run: Run, key: string | null = null) {
  const inputs = inputsFor(run, true, key)
  const claude = createClaudeModule(paths, {
    ...inputs,
    home: {
      ...inputs.home,
      provisionHome: async () => {},
      login: async () => parseClaudeOAuthToken(store.login, Date.now())?.accessToken ?? null,
    },
  })
  return claude.prepareLaunch('fern')
}

beforeEach(() => {
  store.login = null
})

describe('a Claude login whose access token has expired', () => {
  it('reads as ready once the existing renewal renews it', async () => {
    store.login = login('fictional-old', Date.now() - HOUR)
    const run = vi.fn(async () => {
      store.login = login('fictional-new', Date.now() + 8 * HOUR)
      return { code: 0, timedOut: false }
    })
    const checkNow = check(run)
    expect(await checkNow()).toMatchObject({ state: 'usable', login: 'account', plan: 'max' })
    expect(await checkNow()).toMatchObject({ state: 'usable', login: 'account', plan: 'max' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('asks for a sign-in when the renewal fails, and does not run again for that login', async () => {
    store.login = login('fictional-old', Date.now() - HOUR)
    const run = vi.fn(async () => ({ code: 1, timedOut: false }))
    // The command is written for this computer's shell, as the check writes it.
    const command = claudeCommandIn('/fictional/claude', process.platform)
    const said = claudeLoginNotRenewed('not-renewed', 'darwin', command)
    const checkNow = check(run)
    expect(await checkNow()).toEqual({ state: 'absent', reason: said, why: 'expired' })
    expect(await checkNow()).toEqual({ state: 'absent', reason: said, why: 'expired' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('asks for a sign-in when no Claude Code is there to renew it', async () => {
    store.login = login('fictional-old', Date.now() - HOUR)
    const run = vi.fn(async () => ({ code: 0, timedOut: false }))
    expect(await check(run, false)()).toEqual({
      state: 'absent',
      reason: claudeLoginNotRenewed('not-installed', 'darwin', 'claude'),
      why: 'expired',
    })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('a Claude login that needs no renewal', () => {
  it('runs nothing for a current login', async () => {
    store.login = login('fictional-current', Date.now() + HOUR)
    const run = vi.fn(async () => ({ code: 0, timedOut: false }))
    expect(await check(run)()).toMatchObject({ state: 'usable', login: 'account' })
    expect(run).not.toHaveBeenCalled()
  })

  it('runs nothing and still asks for a sign-in when there is no login', async () => {
    const run = vi.fn(async () => ({ code: 0, timedOut: false }))
    expect(await check(run)()).toMatchObject({ state: 'absent', why: 'no-login' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('the model list on a Claude login whose access token has expired', () => {
  it('is read once the existing renewal renews the login', async () => {
    store.login = login('fictional-old', Date.now() - HOUR)
    const run = vi.fn(async () => {
      store.login = login('fictional-new', Date.now() + 8 * HOUR)
      return { code: 0, timedOut: false }
    })
    await expect(modelListLaunch(run)).resolves.toMatchObject({
      home: '/fictional/homes/fern/claude',
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('still needs setup when the renewal fails', async () => {
    store.login = login('fictional-old', Date.now() - HOUR)
    const run = vi.fn(async () => ({ code: 1, timedOut: false }))
    await expect(modelListLaunch(run)).rejects.toBeInstanceOf(AuthUnavailableError)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('a saved API key', () => {
  it('runs no renewal for the check or the model list, though the login has expired', async () => {
    store.login = login('fictional-old', Date.now() - HOUR)
    const run = vi.fn(async () => ({ code: 0, timedOut: false }))
    const inputs = inputsFor(run, true, 'fictional-key')
    const auth = claudeAuth(paths, { ...inputs.auth, loginPresence: async () => true })
    expect(await auth.check('fern')).toMatchObject({ state: 'usable', login: 'api-key' })
    await expect(modelListLaunch(run, 'fictional-key')).resolves.toMatchObject({
      home: '/fictional/homes/fern/claude',
    })
    expect(run).not.toHaveBeenCalled()
  })
})
