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
  ClaudeRuntime,
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
  untilCancelled,
  type AgentRuntime,
  type AuthHealth,
  type AuthState,
  type ClaudeLoginRenewal,
} from '@brobot2/runtime'
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
}
export interface ClaudeHomeSeams {
  readonly provisionHome?: ProvisionHome
  readonly health?: () => AuthHealth | Promise<AuthHealth>
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
  signal?: AbortSignal,
): Promise<AuthHealth> {
  try {
    const readLogin = claudeKeychainTokenProviderForALaunch()
    return await claudeAuthHealthAsync(
      () => {
        signal?.throwIfAborted()
        return readLogin()
      },
      apiKey === undefined ? undefined : () => untilCancelled(Promise.resolve().then(() => {
        signal?.throwIfAborted()
        return apiKey()
      }), signal, 'reading the saved Claude key'),
      command,
    )
  } catch (error) {
    if (error instanceof ApiKeyUnreadableError) return { ok: false, reason: error.message }
    if (error instanceof AuthUnavailableError) return { ok: false, reason: error.message }
    throw error
  }
}

export async function prepareOnTheLogin(
  prepare: () => string | Promise<string>,
  renew: () => Promise<ClaudeLoginRenewal>,
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
  return new ClaudeRuntime(
    undefined,
    undefined,
    claudeKeychainTokenProvider(),
    claudeKeychainTokenProviderAsync(),
    undefined,
    seams.key === undefined ? undefined : () => seams.key?.() ?? null,
    undefined,
    () => whyNoClaudeLogin({ command: claudeCommandFor(seams) }),
    seams.program(),
    claudeKeychainTokenProviderForALaunch(),
    seams.managedRoot,
  )
}

export async function prepareClaudeHome(
  paths: ProviderHomePaths,
  profileId: string,
  seams: ClaudeHomeSeams,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const home = await prepareStateHome(paths, profileId, seams.provisionHome)
  signal?.throwIfAborted()

  const health = await untilCancelled(Promise.resolve().then(() =>
    (seams.health ?? (() => claudeHealth(seams.key, claudeCommandFor(seams), signal)))(),
  ), signal, 'preparing the Claude login')
  signal?.throwIfAborted()
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
    async bringTheKeyToItsHomes() {
      return null
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
    prepare: (profileId, signal) => prepareClaudeHome(paths, profileId, seams, signal),
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
    home: claudeModuleFactory.home(paths, seams.home),
    auth: claudeModuleFactory.auth(paths, seams.auth),
  }
}
