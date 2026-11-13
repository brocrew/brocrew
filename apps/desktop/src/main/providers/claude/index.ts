import { keptRules } from './kept-rules'
import { authPolicy } from './auth-policy'
import { machineLoginPresence } from './backing-login'
export { machineLoginPresence } from './backing-login'
import { skills } from './skills'
import { snapshot } from './snapshot'
import { instructions } from './instructions'
import { memory } from './memory'
import { transcripts } from './transcripts'
import { discovery } from './discovery'
import {
  AuthUnavailableError,
  type AgentRuntime,
  type AuthHealth,
  type AuthState,
} from '@brobot2/runtime'
import {
  claudeAuthHealthAsync,
  whyNoClaudeLogin,
  claudeKeychainTokenProvider,
  claudeKeychainTokenProviderForALaunch,
  claudeLoginNotRenewed,
  claudeCommandIn,
  defaultKeychainReaderForALaunch,
  claudeKeychainTokenProviderAsync,
  claudeLoginState,
  claudeLoginStateWithAKey,
  type ClaudeLoginRenewal,
  ClaudeRuntime,
} from '@brobot2/runtime/claude'
import { ApiKeyUnreadableError } from '../api-key-error'
import { prepareStateHome } from '../home'
import type { LoginRenewalOperations, LoginRenewalOutcome } from '../auth-types'
import type {
  HomeAuthOperations,
  ProviderHomePaths,
  ProvisionHome,
  ProviderHomeStrategy,
  ProviderModule,
} from '../module'

export interface ClaudeRuntimeSeams {
  readonly program: () => string
  readonly programFound?: () => string | null
  readonly key?: () => string | null | Promise<string | null>
  readonly managedRoot?: string
  readonly launchLogin?: () => Promise<string | null>
}
export interface ClaudeHomeSeams {
  readonly provisionHome?: ProvisionHome
  readonly health?: () => AuthHealth | Promise<AuthHealth>
  readonly login?: () => Promise<string | null>
  readonly key?: () => string | null | Promise<string | null>
  readonly programFound?: () => string | null
}
export interface ClaudeAuthSeams {
  readonly probeLogin?: (signal?: AbortSignal) => Promise<AuthState>
  readonly platform?: NodeJS.Platform
  readonly loginPresence?: (signal?: AbortSignal) => Promise<boolean | undefined>
  readonly key?: () => string | null | Promise<string | null>
  readonly keyStatus?: () => { set: boolean; unreadableReason?: string }
  readonly programFound?: () => string | null
  readonly renewLogin?: (reason?: 'rejected') => Promise<LoginRenewalOutcome>
}

function claudeCommandFor(seams: { readonly programFound?: () => string | null }): () => string {
  return () => claudeCommandIn(seams.programFound?.() ?? null, process.platform)
}

async function claudeHealth(
  apiKey: (() => string | null | Promise<string | null>) | undefined,
  command: () => string,
  login = claudeKeychainTokenProviderForALaunch(),
): Promise<AuthHealth> {
  try {
    return await claudeAuthHealthAsync(
      login,
      apiKey === undefined ? undefined : () => apiKey(),
      command,
    )
  } catch (error) {
    if (error instanceof ApiKeyUnreadableError) return { ok: false, reason: error.message }
    throw error
  }
}

export async function prepareOnTheLogin(
  prepare: () => string | Promise<string>,
  renew: () => Promise<ClaudeLoginRenewal>,

  /** Claude Code as the person runs it in their shell (`claudeCommandIn`), asked only to say it. */
  command: () => string = () => 'claude',
): Promise<{ readonly home: string; readonly loginRenewed: boolean }> {
  const renewal = await renew()
  try {
    return { home: await prepare(), loginRenewed: renewal === 'renewed' }
  } catch (error) {
    if (
      error instanceof AuthUnavailableError &&
      (renewal === 'not-renewed' || renewal === 'not-installed')
    ) {
      throw new AuthUnavailableError(
        'claude',
        claudeLoginNotRenewed(renewal, process.platform, command()),
      )
    }
    throw error
  }
}

export function claudeRuntime(seams: ClaudeRuntimeSeams): AgentRuntime {
  const key = seams.key
  return new ClaudeRuntime(
    undefined,
    undefined,
    claudeKeychainTokenProvider(),
    claudeKeychainTokenProviderAsync(),
    undefined,
    key === undefined ? undefined : () => key() ?? null,
    undefined,

    () => whyNoClaudeLogin({ command: claudeCommandFor(seams) }),
    seams.program(),
    seams.launchLogin ?? claudeKeychainTokenProviderForALaunch(),
    seams.managedRoot,
  )
}

export async function prepareClaudeHome(
  paths: ProviderHomePaths,
  profileId: string,
  seams: ClaudeHomeSeams,
): Promise<string> {
  const home = await prepareStateHome(paths, profileId, seams.provisionHome)

  const key = seams.key
  const health = await (seams.health ?? (() => claudeHealth(key, claudeCommandFor(seams))))()
  if (!health.ok) {
    throw new AuthUnavailableError('claude', health.reason ?? 'Claude machine login unavailable')
  }
  return home
}

export function claudeAuth(paths: ProviderHomePaths, seams: ClaudeAuthSeams): HomeAuthOperations {
  const stateOnTheKey = async (signal?: AbortSignal) => {
    const platform = seams.platform ?? process.platform
    const state = claudeLoginStateWithAKey(undefined, undefined, platform)
    if (platform !== 'darwin') return state
    const behind = await (seams.loginPresence ?? machineLoginPresence)(signal)
    return behind === undefined ? state : { ...state, loginBehindTheKey: behind }
  }
  const renewLogin = seams.renewLogin
  const renewal: LoginRenewalOperations | undefined =
    renewLogin === undefined
      ? undefined
      : {
          launchLabel: 'Claude sign-in renewal',
          renew: renewLogin,
          renewRejected: () => renewLogin('rejected'),
          rejectedTurnContinuation: 'Continue answering the last message.',
          prepare: (prepare, renew) => prepareOnTheLogin(prepare, renew, claudeCommandFor(seams)),
        }
  const claudeRefusal = (verb: string): Error =>
    new Error(
      `Claude sessions run on the API key saved in Providers or on your machine login directly — there is no profile credential to ${verb}.`,
    )
  return {
    ...(renewal === undefined ? {} : { renewal }),
    async probe(_profileId, signal) {
      if (seams.keyStatus?.().set || (await seams.key?.())) {
        return {
          state: 'unknown',
          reason: 'This check is for the Claude Code sign-in. Use Check key for the saved API key.',
        }
      }
      return (
        seams.probeLogin?.(signal) ?? {
          state: 'unknown',
          reason: 'This app build cannot probe the Claude Code sign-in.',
        }
      )
    },
    credentialHome: (profileId) => paths.homeOf(profileId),
    async check(_profileId, signal) {
      const apiKey = seams.key
      try {
        const status = seams.keyStatus?.()
        if (status?.set) {
          if (status.unreadableReason !== undefined)
            return { state: 'absent', reason: status.unreadableReason }
          return await stateOnTheKey(signal)
        }
        const keyed = status === undefined ? await apiKey?.() : null
        if (keyed) return await stateOnTheKey(signal)
        const login = await defaultKeychainReaderForALaunch()

        return claudeLoginState(
          () => login,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          claudeCommandFor(seams),
        )
      } catch (error) {
        if (error instanceof ApiKeyUnreadableError) {
          return { state: 'absent', reason: error.message }
        }
        throw error
      }
    },
    reprovision() {
      throw claudeRefusal('re-copy')
    },
    async signIn() {
      throw claudeRefusal('sign in')
    },
    async replaceARefusedCopy() {
      return 'not-tried'
    },
  }
}

export interface ClaudeModuleSeams {
  readonly program?: import('../program-policy').ProviderProgramOperations
  readonly runtime: ClaudeRuntimeSeams
  readonly home: ClaudeHomeSeams
  readonly auth: ClaudeAuthSeams
}

export const claudeModuleFactory = {
  runtime:
    (seams: ClaudeRuntimeSeams): (() => AgentRuntime) =>
    () =>
      claudeRuntime(seams),
  home: (paths: ProviderHomePaths, seams: ClaudeHomeSeams): ProviderHomeStrategy => ({
    prepare: (profileId) => prepareClaudeHome(paths, profileId, seams),
  }),
  auth: claudeAuth,
}

export function createClaudeModule(
  paths: ProviderHomePaths,
  seams: ClaudeModuleSeams,
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
    createRuntime: claudeModuleFactory.runtime(seams.runtime),
    async prepareLaunch(profileId, connection) {
      let key: string | null
      try {
        const readKey = seams.runtime.key ?? seams.home.key
        key = connection?.authMethod === 'sign-in' ? null : ((await readKey?.()) ?? null)
        if (connection?.authMethod === 'api-key' && !key)
          throw new AuthUnavailableError('claude', 'The selected API key is unavailable')
      } catch (error) {
        if (error instanceof ApiKeyUnreadableError)
          throw new AuthUnavailableError('claude', error.message)
        throw error
      }
      const selectedKey = () => key
      const readLogin = seams.home.login ?? claudeKeychainTokenProviderForALaunch()
      let login: Promise<string | null> | undefined
      const selectedLogin = () => (login ??= readLogin())
      const home = await prepareClaudeHome(paths, profileId, {
        ...seams.home,
        key: selectedKey,
        health:
          seams.home.health ??
          (() => claudeHealth(selectedKey, claudeCommandFor(seams.home), selectedLogin)),
      })
      return {
        home,
        runtime: claudeRuntime({ ...seams.runtime, key: selectedKey, launchLogin: selectedLogin }),
      }
    },
    home: claudeModuleFactory.home(paths, seams.home),
    auth: claudeModuleFactory.auth(paths, seams.auth),
  }
}
