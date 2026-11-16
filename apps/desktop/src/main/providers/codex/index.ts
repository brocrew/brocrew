import type { ProviderConnection } from '@brobot2/shared'
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
import { AuthUnavailableError, provisionProviderHome, type AgentRuntime } from '@brobot2/runtime'
import {
  codexAuthHealth,
  personalCodexAuthPath,
  provisionCodexAuth,
  replaceARefusedCodexCopy,
  reprovisionCodexAuth,
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

function bringTheCodexKeyTo(
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
        'Codex did not accept the saved API key for this legacy launch.',
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
  connectionId?: string,
): { managedRoot: string; sourceAuthPath?: string; fallbackAuthPath?: string } {
  const own =
    connectionId === undefined
      ? paths.homeOf(paths.defaultProfile)
      : paths.homeOf(paths.defaultProfile, connectionId)
  return {
    managedRoot: paths.managedRoot,
    ...(seams.machineAuthPath === undefined ? {} : { sourceAuthPath: seams.machineAuthPath() }),
    ...(home === own ? {} : { fallbackAuthPath: join(own, 'auth.json') }),
  }
}

export function codexRuntime(seams: CodexRuntimeSeams, apiKey?: string): AgentRuntime {
  return new CodexRuntime(createSpawnTransportFactory(seams.command()), codexAuthHealth, apiKey)
}

export async function prepareCodexHome(
  paths: ProviderHomePaths,
  profileId: string,
  seams: CodexHomeSeams,
  connectionId?: string,
  legacyKey?: CodexKeySeam,
): Promise<string> {
  const home = await prepareStateHome(paths, profileId, seams.provisionHome, connectionId)

  removeStaleCodexPermissionConfig(home)

  ensureCodexMemoryConfig(home)

  if (legacyKey !== undefined) {
    if ((await bringTheCodexKeyTo(home, legacyKey)) === 'the-key') return home
  } else if (codexKeyStampOf(home) !== null && seams.key !== undefined) {
    const done = await seams.key.change(home)
    if (!done.ok) throw new AuthUnavailableError('codex', `${done.reason} Try again in a moment.`)
    rmSync(join(home, CODEX_KEY_STAMP), { force: true })
  }

  if (seams.provisionCodexAuth) await seams.provisionCodexAuth(home)
  else await provisionCodexAuth(home, theCodexCopy(paths, home, seams, connectionId))
  return home
}

export function codexAuth(paths: ProviderHomePaths, seams: CodexAuthSeams): HomeAuthOperations {
  const transports = (): TransportFactory => createSpawnTransportFactory(seams.command())

  const refuseWhileAKeyIsSaved = (connection?: ProviderConnection): void => {
    if (connection?.authMethod === 'sign-in') return
    if (connection?.authMethod === 'api-key')
      throw new Error(
        'Choose a sign-in connection to copy a machine sign-in; this connection uses an API key.',
      )
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

  const homePathFor = (profileId: string, connectionId?: string): string => {
    paths.assertMayOpen(profileId)
    return connectionId === undefined
      ? paths.homeOf(profileId)
      : paths.homeOf(profileId, connectionId)
  }
  const homeFor = async (profileId: string, connectionId?: string): Promise<string> => {
    const home = homePathFor(profileId, connectionId)
    await provisionProviderHome(paths.managedRoot, home)
    return home
  }
  return {
    credentialHome(profileId, connection) {
      return connection === undefined
        ? paths.homeOf(profileId)
        : paths.homeOf(profileId, connection.id)
    },
    async check(profileId, signal, connection) {
      if (connection?.authMethod === 'api-key')
        return { state: 'unknown', reason: 'Use Check key to check this API-key connection.' }
      const providerHome = await homeFor(profileId, connection?.id)

      const state = await probeCodexAuthInHome(transports(), providerHome, providerHome, signal)
      if (state.state !== 'usable' || state.login !== 'api-key' || signal?.aborted) return state
      const behind = machineLoginPresence(seams.machineAuthPath?.() ?? personalCodexAuthPath())
      return behind === undefined ? state : { ...state, loginBehindTheKey: behind }
    },
    reprovision(profileId, connection) {
      refuseWhileAKeyIsSaved(connection)
      const home =
        connection === undefined ? homePathFor(profileId) : homePathFor(profileId, connection.id)
      return provisionProviderHome(paths.managedRoot, home).then(() =>
        seams.machineAuthPath === undefined
          ? reprovisionCodexAuth(home)
          : reprovisionCodexAuth(home, { sourceAuthPath: seams.machineAuthPath() }),
      )
    },
    async signIn(profileId, signal, connection) {
      refuseWhileAKeyIsSaved(connection)
      const providerHome =
        connection === undefined
          ? await homeFor(profileId)
          : await homeFor(profileId, connection.id)
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
    async replaceARefusedCopy(profileId, refused, stillWanted, connection) {
      if (connection?.authMethod === 'api-key') return 'not-tried'
      try {
        if (connection === undefined) refuseWhileAKeyIsSaved()
      } catch {
        return 'not-tried'
      }
      const home =
        connection === undefined ? homePathFor(profileId) : homePathFor(profileId, connection.id)
      const own =
        connection === undefined
          ? paths.homeOf(paths.defaultProfile)
          : paths.homeOf(paths.defaultProfile, connection.id)
      const managedRoot = paths.managedRoot
      return await replaceARefusedCodexCopy(home, {
        managedRoot,
        refused: refused as import('@brobot2/runtime/codex').CodexCopyIdentity,
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
    prepare: (profileId, connectionId) => prepareCodexHome(paths, profileId, seams, connectionId),
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
      if (connection === undefined) {
        const home = await prepareCodexHome(paths, profileId, seams.home, undefined, seams.home.key)
        return { home, runtime: codexRuntime(seams.runtime) }
      }
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
      if (current !== null) {
        const home = await prepareStateHome(
          paths,
          profileId,
          seams.home.provisionHome,
          connection?.id,
        )
        removeStaleCodexPermissionConfig(home)
        ensureCodexMemoryConfig(home)
        return { home, runtime: codexRuntime(seams.runtime, current.key) }
      }
      const home = await prepareCodexHome(paths, profileId, seams.home, connection?.id)
      return { home, runtime: codexRuntime(seams.runtime) }
    },
    home: codexModuleFactory.home(paths, seams.home),
    auth: codexModuleFactory.auth(paths, seams.auth),
  }
}
