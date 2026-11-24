import { authPolicy } from './auth-policy'
import { keptRules } from './kept-rules'
import { skills } from './skills'
import { snapshot } from './snapshot'
import { instructions } from './instructions'
import { memory } from './memory'
import { transcripts } from './transcripts'
import { discovery } from './discovery'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AuthUnavailableError, provisionProviderHome, type AgentRuntime } from '@brobot2/runtime'
import {
  aCodexSignInIsKept,
  codexAccountIn,
  codexAuthHealth,
  codexSignInIsKeptAsAFile,
  makeRoomForACodexSignIn,
  shareCodexSignIn,
  CodexRuntime,
  createSpawnTransportFactory,
  ensureCodexMemoryConfig,
  probeCodexAuthInHome,
  removeStaleCodexPermissionConfig,
  startCodexLogin,
  type TransportFactory,
} from '@brobot2/runtime/codex'
import { ApiKeyUnreadableError } from '../api-key-error'
import { prepareStateHome } from '../home'
import type {
  HomeAuthOperations,
  ProviderHomePaths,
  ProvisionHome,
  ProviderHomeStrategy,
  ProviderModule,
} from '../module'
import type { CodexKeySeam } from './types'

export interface CodexRuntimeSeams {
  readonly command: () => string
}
export interface CodexHomeSeams {
  readonly provisionHome?: ProvisionHome
  readonly provisionCodexAuth?: (home: string) => void | Promise<void>
  readonly key?: CodexKeySeam
}
export interface CodexAuthSeams {
  readonly command: () => string
  readonly key?: CodexKeySeam
}

const CODEX_KEY_STAMP = 'brobot-api-key-login.json'

/** Shown where this computer refused the links that let agents share one sign-in file. */
const TURN_ON_DEVELOPER_MODE = 'Turn on Windows Developer Mode to share one sign-in.'

function isPresent(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function codexKeyStampOf(home: string): Promise<number | null> {
  try {
    const read = JSON.parse(await readFile(join(home, CODEX_KEY_STAMP), 'utf8')) as {
      setAt?: unknown
    }
    return typeof read.setAt === 'number' ? read.setAt : null
  } catch {
    return null
  }
}

export function bringTheCodexKeyTo(
  home: string,
  codexKey: CodexKeySeam,
): Promise<'the-key' | 'its-login'> {
  const before = keyChangesInFlight.get(home) ?? Promise.resolve()
  const mine = before.catch(() => undefined).then(() => bringTheCodexKeyToNow(home, codexKey))
  const settled = mine.then(
    () => undefined,
    () => undefined,
  )
  keyChangesInFlight.set(home, settled)
  void settled.then(() => {
    if (keyChangesInFlight.get(home) === settled) keyChangesInFlight.delete(home)
  })
  return mine
}

const keyChangesInFlight = new Map<string, Promise<void>>()

async function bringTheCodexKeyToNow(
  home: string,
  codexKey: CodexKeySeam,
): Promise<'the-key' | 'its-login'> {
  let current: Awaited<ReturnType<CodexKeySeam['current']>>
  try {
    current = await codexKey.current()
  } catch (error) {
    if (error instanceof ApiKeyUnreadableError)
      throw new AuthUnavailableError('codex', error.message)
    throw error
  }
  const stamp = await codexKeyStampOf(home)
  if (current !== null) {
    if (stamp === current.setAt && (await isPresent(join(home, 'auth.json')))) return 'the-key'
    // The key's login writes this home's own file, never the sign-in its account's agents share.
    const putBack = await makeRoomForACodexSignIn(home)
    const done = await codexKey.change(home, { to: 'the-key', apiKey: current.key })
    if (!done.ok) {
      await putBack()
      throw new AuthUnavailableError('codex', `${done.reason} Try again in a moment.`)
    }
    if (done.authMethod !== 'apikey') {
      throw new AuthUnavailableError(
        'codex',
        'Codex did not take the API key saved under “API key” on the Codex card in Providers. ' +
          'Save it again there, or remove it to use your sign-in instead.',
      )
    }
    await writeFile(join(home, CODEX_KEY_STAMP), `${JSON.stringify({ setAt: current.setAt })}\n`, {
      mode: 0o600,
    })
    return 'the-key'
  }
  if (stamp === null) return 'its-login'
  // A stamp left by a key removal that did not finish, over a sign-in to an account: the sign-in
  // stays, and only the stamp goes.
  const account = await codexAccountIn(home)
  if (account !== null && account !== 'api-key') {
    await retireCodexKeyStamp(home)
    return 'its-login'
  }
  // The logout ends this home's key login, never the sign-in its account's agents share.
  const putBack = await makeRoomForACodexSignIn(home)
  const done = await codexKey.change(home, { to: 'no-key' })
  await putBack()
  if (!done.ok) throw new AuthUnavailableError('codex', `${done.reason} Try again in a moment.`)
  // Logged out: a stamp left now only asks for the same logout again.
  await retireCodexKeyStamp(home)
  return 'its-login'
}

/** Remove a key stamp a sign-in has made obsolete; one that cannot go now changes nothing. */
async function retireCodexKeyStamp(home: string): Promise<void> {
  try {
    await rm(join(home, CODEX_KEY_STAMP), { force: true })
  } catch (error) {
    console.warn(
      `could not remove an obsolete Codex API-key stamp: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Put a home on its account's one sign-in; see {@link shareCodexSignIn}. */
function share(paths: ProviderHomePaths, home: string): ReturnType<typeof shareCodexSignIn> {
  return shareCodexSignIn(home, {
    managedRoot: paths.managedRoot,
    ownHome: paths.homeOf(paths.defaultProfile),
  })
}

function codexRuntime(seams: CodexRuntimeSeams): AgentRuntime {
  return new CodexRuntime(createSpawnTransportFactory(seams.command()), codexAuthHealth)
}

async function prepareCodexHome(
  paths: ProviderHomePaths,
  profileId: string,
  seams: CodexHomeSeams,
): Promise<string> {
  const home = await prepareStateHome(paths, profileId, seams.provisionHome)

  removeStaleCodexPermissionConfig(home)

  ensureCodexMemoryConfig(home)

  const key = seams.key
  if (key !== undefined && (await bringTheCodexKeyTo(home, key)) === 'the-key') {
    return home
  }

  if (seams.provisionCodexAuth) await seams.provisionCodexAuth(home)
  else await share(paths, home)
  return home
}

export function codexAuth(paths: ProviderHomePaths, seams: CodexAuthSeams): HomeAuthOperations {
  const transports = (): TransportFactory => createSpawnTransportFactory(seams.command())

  const refuseWhileAKeyIsSaved = (): void => {
    let saved: boolean
    try {
      if (seams.key?.isSaved !== undefined) saved = seams.key.isSaved()
      else {
        const current = seams.key?.current()
        if (current instanceof Promise) {
          void current.catch(() => undefined)
          throw new Error('An asynchronous key reader needs a presence check')
        }
        saved = current != null
      }
    } catch {
      saved = true
    }
    if (saved) {
      throw new Error(
        'An API key is saved for Codex, and it is what Codex runs on. Remove it under “API key” on ' +
          'the Codex card in Providers to use a sign-in instead.',
      )
    }
  }

  const homePathFor = (profileId: string): string => {
    paths.assertMayOpen(profileId)
    return paths.homeOf(profileId)
  }
  const homeFor = async (profileId: string): Promise<string> => {
    const home = homePathFor(profileId)
    await provisionProviderHome(paths.managedRoot, home)
    return home
  }
  /** Every Codex agent in a workspace runs on the sign-in BroBot's own home holds. */
  const theSettingsHome = (profileId: string): Promise<string> => {
    paths.assertMayOpen(profileId)
    return homeFor(paths.defaultProfile)
  }
  return {
    credentialHome(profileId) {
      // The profile's own name is still checked; the sign-in it uses is the workspace's.
      paths.homeOf(profileId)
      return paths.homeOf(paths.defaultProfile)
    },
    async check(profileId, signal) {
      const providerHome = await theSettingsHome(profileId)

      const state = await probeCodexAuthInHome(transports(), providerHome, providerHome, signal)
      if (state.state !== 'usable' || signal?.aborted) return state
      if (state.login === 'api-key') {
        return { ...state, loginBehindTheKey: aCodexSignInIsKept(paths.managedRoot) }
      }
      // Without links, agents' copies are kept in step; Developer Mode gives them one file.
      return codexSignInIsKeptAsAFile(providerHome, paths.managedRoot)
        ? { ...state, hint: TURN_ON_DEVELOPER_MODE }
        : state
    },
    reprovision(profileId, _newerOnly, stillWanted) {
      refuseWhileAKeyIsSaved()
      const home = homePathFor(profileId)
      return provisionProviderHome(paths.managedRoot, home).then(async () => {
        if (stillWanted?.() === false) return 'unchanged'
        return (await share(paths, home)) === 'joined' ? 'replaced' : 'unchanged'
      })
    },
    async signIn(profileId, signal) {
      refuseWhileAKeyIsSaved()
      // From any agent, the sign-in is the workspace's one, in BroBot's own home. It writes a file
      // there, which then becomes the workspace's; one that writes nothing leaves it as it was.
      const providerHome = await theSettingsHome(profileId)
      const putBack = await makeRoomForACodexSignIn(providerHome)
      const shared = (): Promise<unknown> =>
        putBack()
          .then(() => share(paths, providerHome))
          .catch((error: unknown) => {
            console.warn(
              `could not make a Codex sign-in the workspace's: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          })
      let started: Awaited<ReturnType<typeof startCodexLogin>>
      try {
        started = await startCodexLogin(transports(), providerHome, providerHome, signal)
      } catch (error) {
        await shared()
        throw error
      }
      const { login, start } = started
      return {
        authUrl: start.authUrl,
        completed: login.completed().then(async (outcome) => {
          // A sign-in that worked ends any key login this home had, and with it the key's stamp.
          if (outcome.success) await retireCodexKeyStamp(providerHome)
          await shared()
          return outcome
        }),
        cancel: () => login.cancel(),
      }
    },
    // One sign-in per workspace is shared, never copied: a refused one is signed in again.
    replaceARefusedCopy: () => Promise.resolve('not-tried'),
    async bringTheKeyToItsHomes() {
      const codexKey = seams.key
      if (codexKey === undefined) return null

      const homes: string[] = []
      for (const home of paths.profiles().map((profileId) => paths.homeOf(profileId))) {
        if (await isPresent(home)) homes.push(home)
      }
      let failed = 0
      for (const home of homes) {
        try {
          if ((await bringTheCodexKeyTo(home, codexKey)) === 'its-login') {
            await share(paths, home).catch((error: unknown) => {
              if (!(error instanceof AuthUnavailableError)) throw error
            })
          }
        } catch (error) {
          failed += 1
          console.warn(
            `could not bring a Codex profile in line with its API key: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
      if (failed === 0) return null
      return failed === homes.length
        ? 'BroCrew could not update Codex’s login in any profile yet; each is updated when it next starts.'
        : `BroCrew could not update Codex’s login in ${String(failed)} of ${String(homes.length)} profiles yet; each is updated when it next starts.`
    },
  }
}

export interface CodexModuleSeams {
  readonly program?: import('../program-policy').ProviderProgramOperations
  readonly runtime: CodexRuntimeSeams
  readonly home: CodexHomeSeams
  readonly auth: CodexAuthSeams
}

export const codexModuleFactory = {
  runtime:
    (seams: CodexRuntimeSeams): (() => AgentRuntime) =>
    () =>
      codexRuntime(seams),
  home: (paths: ProviderHomePaths, seams: CodexHomeSeams): ProviderHomeStrategy => ({
    prepare: (profileId) => prepareCodexHome(paths, profileId, seams),
  }),
  auth: codexAuth,
}

export function createCodexModule(
  paths: ProviderHomePaths,
  seams: CodexModuleSeams,
): ProviderModule {
  return {
    ...(seams.program === undefined ? {} : { program: seams.program }),
    authPolicy,
    transcripts,
    instructions,
    memory,
    snapshot,
    skills,
    keptRules,
    discovery,
    createRuntime: codexModuleFactory.runtime(seams.runtime),
    async prepareLaunch(profileId, connection) {
      const reader = seams.home.key
      let current: Awaited<ReturnType<CodexKeySeam['current']>>
      try {
        current = connection?.authMethod === 'sign-in' ? null : ((await reader?.current()) ?? null)
        if (connection?.authMethod === 'api-key' && current === null)
          throw new AuthUnavailableError('codex', 'The selected API key is unavailable')
      } catch (error) {
        if (error instanceof ApiKeyUnreadableError)
          throw new AuthUnavailableError('codex', error.message)
        throw error
      }
      const key =
        reader === undefined
          ? undefined
          : {
              current: () => current,
              change: (home: string, change: Parameters<CodexKeySeam['change']>[1]) =>
                reader.change(home, change),
            }
      const home = await prepareCodexHome(paths, profileId, { ...seams.home, key })
      return { home, runtime: codexRuntime(seams.runtime) }
    },
    home: codexModuleFactory.home(paths, seams.home),
    auth: codexModuleFactory.auth(paths, seams.auth),
  }
}
