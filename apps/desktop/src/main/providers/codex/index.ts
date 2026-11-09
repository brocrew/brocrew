import { authPolicy } from './auth-policy'
import { machineLoginPresence } from './backing-login'
export { machineLoginPresence } from './backing-login'
import { keptRules } from './kept-rules'
import { skills } from './skills'
import { snapshot } from './snapshot'
import { instructions } from './instructions'
import { memory } from './memory'
import { transcripts } from './transcripts'
import { discovery } from './discovery'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AuthUnavailableError,
  codexAuthHealth,
  personalCodexAuthPath,
  provisionCodexAuth,
  replaceARefusedCodexCopy,
  provisionProviderHome,
  reprovisionCodexAuth,
  type AgentRuntime,
} from '@brobot2/runtime'
import {
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
  readonly machineAuthPath?: () => string
  readonly key?: CodexKeySeam
}
export interface CodexAuthSeams {
  readonly command: () => string
  readonly key?: CodexKeySeam
  readonly machineAuthPath?: () => string
}

const CODEX_KEY_STAMP = 'brobot-api-key-login.json'

function codexKeyStampOf(home: string): number | null {
  try {
    const read = JSON.parse(readFileSync(join(home, CODEX_KEY_STAMP), 'utf8')) as {
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
  const stamp = codexKeyStampOf(home)
  if (current !== null) {
    if (stamp === current.setAt && existsSync(join(home, 'auth.json'))) return 'the-key'
    const done = await codexKey.change(home, { to: 'the-key', apiKey: current.key })
    if (!done.ok) throw new AuthUnavailableError('codex', `${done.reason} Try again in a moment.`)
    if (done.authMethod !== 'apikey') {
      throw new AuthUnavailableError(
        'codex',
        'Codex did not take the API key saved under “API key” on the Codex card in Providers. ' +
          'Save it again there, or remove it to use your sign-in instead.',
      )
    }
    writeFileSync(join(home, CODEX_KEY_STAMP), `${JSON.stringify({ setAt: current.setAt })}\n`, {
      mode: 0o600,
    })
    return 'the-key'
  }
  if (stamp === null) return 'its-login'
  const done = await codexKey.change(home, { to: 'no-key' })
  if (!done.ok) throw new AuthUnavailableError('codex', `${done.reason} Try again in a moment.`)
  rmSync(join(home, CODEX_KEY_STAMP), { force: true })
  return 'its-login'
}

function theCodexCopy(
  paths: ProviderHomePaths,
  home: string,
  seams: CodexHomeSeams,
): { managedRoot: string; sourceAuthPath?: string; fallbackAuthPath?: string } {
  const own = paths.homeOf(paths.defaultProfile)
  return {
    managedRoot: paths.managedRoot,
    ...(seams.machineAuthPath === undefined ? {} : { sourceAuthPath: seams.machineAuthPath() }),
    ...(home === own ? {} : { fallbackAuthPath: join(own, 'auth.json') }),
  }
}

export function codexRuntime(seams: CodexRuntimeSeams): AgentRuntime {
  return new CodexRuntime(createSpawnTransportFactory(seams.command()), codexAuthHealth)
}

export async function prepareCodexHome(
  paths: ProviderHomePaths,
  profileId: string,
  seams: CodexHomeSeams,
): Promise<string> {
  const home = await prepareStateHome(paths, profileId, seams.provisionHome)

  removeStaleCodexPermissionConfig(home)

  ensureCodexMemoryConfig(home)

  if (seams.key !== undefined && (await bringTheCodexKeyTo(home, seams.key)) === 'the-key') {
    return home
  }

  if (seams.provisionCodexAuth) await seams.provisionCodexAuth(home)
  else await provisionCodexAuth(home, theCodexCopy(paths, home, seams))
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
  return {
    credentialHome(profileId) {
      return paths.homeOf(profileId)
    },
    async check(profileId, signal) {
      const providerHome = await homeFor(profileId)

      const state = await probeCodexAuthInHome(transports(), providerHome, providerHome, signal)
      if (state.state !== 'usable' || state.login !== 'api-key' || signal?.aborted) return state
      const behind = machineLoginPresence(seams.machineAuthPath?.() ?? personalCodexAuthPath())
      return behind === undefined ? state : { ...state, loginBehindTheKey: behind }
    },
    reprovision(profileId) {
      refuseWhileAKeyIsSaved()
      const home = homePathFor(profileId)
      return provisionProviderHome(paths.managedRoot, home).then(() => reprovisionCodexAuth(home))
    },
    async signIn(profileId, signal) {
      refuseWhileAKeyIsSaved()
      const providerHome = await homeFor(profileId)
      const { login, start } = await startCodexLogin(
        transports(),
        providerHome,
        providerHome,
        signal,
      )
      return {
        authUrl: start.authUrl,
        completed: login.completed(),
        cancel: () => login.cancel(),
      }
    },
    async replaceARefusedCopy(profileId, refused, stillWanted) {
      try {
        refuseWhileAKeyIsSaved()
      } catch {
        return 'not-tried'
      }
      const home = homePathFor(profileId)
      const own = paths.homeOf(paths.defaultProfile)
      const managedRoot = paths.managedRoot
      return await replaceARefusedCodexCopy(home, {
        managedRoot,
        refused: refused as import('@brobot2/runtime').CodexCopyIdentity,
        stillWanted,
        candidates: [
          {
            from: 'the-computers',
            sourceAuthPath: seams.machineAuthPath?.() ?? personalCodexAuthPath(),
          },
          { from: 'brobots-own', fallback: { path: join(own, 'auth.json'), managedRoot } },
        ],
      })
    },
    async bringTheKeyToItsHomes() {
      const codexKey = seams.key
      if (codexKey === undefined) return null

      const homes = paths
        .profiles()
        .map((profileId) => paths.homeOf(profileId))
        .filter((home) => existsSync(home))
      let failed = 0
      for (const home of homes) {
        try {
          if ((await bringTheCodexKeyTo(home, codexKey)) === 'its-login') {
            await provisionCodexAuth(home, { managedRoot: paths.managedRoot }).catch(
              (error: unknown) => {
                if (!(error instanceof AuthUnavailableError)) throw error
              },
            )
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
    home: codexModuleFactory.home(paths, seams.home),
    auth: codexModuleFactory.auth(paths, seams.auth),
  }
}
