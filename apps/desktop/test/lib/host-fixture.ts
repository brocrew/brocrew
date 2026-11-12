import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import { NO_DISCOVERY } from '../../src/main/adopt/discover-sessions'
import type {
  RuntimeEventSink,
  RuntimeHost,
  RuntimeHostDeps,
} from '../../src/main/runtime/runtime-host'
import type { ProviderConfigInfo, RuntimeEventMessage } from '../../src/shared/runtime-ipc'

export class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

export const syntheticProviderHome =
  (rootGetter: () => string) =>
  (provider: Provider, profileId?: string): string => {
    const home = join(rootGetter(), 'provider-homes', profileId ?? 'default', provider)
    mkdirSync(home, { recursive: true })
    return home
  }

export function fixtureProviderConfig(_provider: Provider, home: string): ProviderConfigInfo {
  return {
    home,
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'm',
    authNote: null,
    files: [],
  }
}

export function neutralHostDeps(
  rootGetter: () => string,
): Pick<RuntimeHostDeps, 'discoverSessions' | 'nativeTranscriptPath' | 'exportDirectory'> {
  return {
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(rootGetter(), 'exports'),
  }
}

export function ownsStream(host: RuntimeHost, sessionId: string, sink: RuntimeEventSink): boolean {
  const slots = (
    host as unknown as {
      slots: ReadonlyMap<string, { ownerId: string | null }>
    }
  ).slots
  return slots.get(sessionId)?.ownerId === sink.ownerId
}

export function fixtureProviderPaths(
  root: string,
): Pick<RuntimeHostDeps, 'providerHomePath' | 'resolveCwd' | 'readProviderConfig'> {
  return {
    providerHomePath: (provider) => join(root, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(root, sessionId, requested),
    readProviderConfig: fixtureProviderConfig,
  }
}
