import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  FakeProviderSessions,
  type AgentToolset,
  type ResumeOptions,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import { RuntimeHost, type RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import { createSessionStore } from '../../src/main/db/session-store'
import {
  fixtureDatabase,
  fixtureFolder,
  latestToolset,
  neutralHostDeps,
  ObservedProviderLaunches,
  RecordingSink,
} from '../lib/host-fixture'

/** The host dependencies two policy fixtures share: observed launches and homes under a scratch root. */
function policyHostDeps(input: {
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

export function openPolicySessionFixture(
  name: string,
  now: () => number,
  announce?: ConstructorParameters<typeof RuntimeHost>[0]['announce'],
) {
  const root = fixtureFolder(`${name}-`)
  const work = fixtureFolder(`${name}-work-`)
  const db = fixtureDatabase(root)
  let sequence = 0
  const handed: AgentToolset[] = []
  const launches: (StartOptions | ResumeOptions)[] = []
  const tools = new Map<string, AgentToolset>()
  const store = createSessionStore(db, now)
  const host = new RuntimeHost({
    store,
    ...policyHostDeps({
      root,
      announce,
      providerSessions: new FakeProviderSessions(),
      launches,
      handed,
      newSessionId: () => `session-${++sequence}`,
      now,
    }),
  })
  const window = new RecordingSink('webContents:1')
  return {
    host,
    window,
    work,
    db,
    store,
    handed,
    launches,
    tools,
    async close() {
      await host.closeAll()
      if (db.open) db.close()
      rmSync(root, { recursive: true, force: true })
      rmSync(work, { recursive: true, force: true })
    },
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
