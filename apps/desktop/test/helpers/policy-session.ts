import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgentToolset,
  FakeProviderSessions,
  ResumeOptions,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import type { RuntimeHost, RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import { latestToolset, neutralHostDeps, ObservedProviderLaunches } from '../lib/host-fixture'

/** The host dependencies two policy fixtures share: observed launches and homes under a scratch root. */
export function policyHostDeps(input: {
  root: string
  providerSessions: FakeProviderSessions
  launches: (StartOptions | ResumeOptions)[]
  handed: AgentToolset[]
  newSessionId: () => string
  now: () => number
  announce?: ConstructorParameters<typeof RuntimeHost>[0]['announce']
}): Omit<ConstructorParameters<typeof RuntimeHost>[0], 'store'> {
  const { root, providerSessions, launches, handed } = input
  const home = (provider: Provider, profile?: string | null) =>
    join(root, 'homes', profile ?? 'default', provider)
  return {
    ...neutralHostDeps(() => root),
    ...(input.announce === undefined ? {} : { announce: input.announce }),
    createRuntime: (provider) =>
      new ObservedProviderLaunches(provider, providerSessions, (_kind, options) => {
        launches.push(options)
        if (options.agentTools !== undefined) handed.push(options.agentTools)
      }),
    prepareProviderHome: (provider, profile) => {
      const path = home(provider, profile)
      mkdirSync(path, { recursive: true })
      return path
    },
    providerHomePath: home,
    resolveCwd: (id, requested) => resolveSessionCwd(root, id, requested),
    newSessionId: input.newSessionId,
    now: input.now,
    readProviderConfig: (_provider, path) => ({
      home: path,
      homeEnv: 'CODEX_HOME',
      model: 'm',
      authNote: null,
      files: [],
    }),
  }
}

export function policySessionOpener(
  read: () => {
    host: RuntimeHost
    window: RuntimeEventSink
    work: string
    handed: readonly AgentToolset[]
    tools: Map<string, AgentToolset>
  },
) {
  return async (profile: string, provider: Provider = 'codex'): Promise<string> => {
    const { host, window, work, handed, tools } = read()
    const { sessionId } = await host.createSession(
      { provider, profileId: profile, cwd: work, approvalMode: 'ask' },
      window,
    )
    tools.set(sessionId, latestToolset(handed))
    return sessionId
  }
}
