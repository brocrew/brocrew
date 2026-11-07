import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../../src/main/adopt/discover-sessions'
import type { RuntimeEventSink, RuntimeHostDeps } from '../../src/main/runtime/runtime-host'
import type { ProviderConfigInfo, RuntimeEventMessage } from '../../src/shared/runtime-ipc'

export class RecordingSink implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = true,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

export class NonPersonSink extends RecordingSink {
  override readonly alive = true
  constructor(ownerId = 'owner:1') {
    super(ownerId, false)
  }
}

export const syntheticProviderHome =
  (rootGetter: () => string) =>
  (provider: Provider, profileId?: string): string => {
    const home = join(rootGetter(), 'provider-homes', profileId ?? 'default', provider)
    mkdirSync(home, { recursive: true })
    return home
  }

export function prepareUnprofiledHome(root: string, provider: Provider): string {
  const home = join(root, 'provider-homes', provider)
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

export function codexFixtureConfig(provider: Provider, home: string): ProviderConfigInfo {
  return {
    ...fixtureProviderConfig(provider, home),
    homeEnv: 'CODEX_HOME',
    model: 'fake',
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
