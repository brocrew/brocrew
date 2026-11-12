import {
  FakeRuntime,
  type FakeSessionHandle,
  type FakeProviderSessions,
  type StartOptions,
  type SessionRef,
  type ResumeOptions,
} from '@brobot2/runtime'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../../src/main/adopt/discover-sessions'
import type { RuntimeEventSink, RuntimeHostDeps } from '../../src/main/runtime/runtime-host'
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

/** Close the fixture host before its database and owned directories. */
export async function closeHostFixture(
  host: Pick<import('../../src/main/runtime/runtime-host').RuntimeHost, 'closeAll'>,
  db: Pick<import('../../src/main/db/connection').AppDatabase, 'close'>,
  ...folders: string[]
): Promise<void> {
  await host.closeAll()
  db.close()
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
}

/** ⚑ A reopen the test can hold at the provider: `hold` is awaited by every `resume`. */
export interface ResumeGate {
  hold: Promise<void> | null
  entered: number
}

export class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly resumeGate: ResumeGate,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    this.resumeGate.entered += 1
    if (this.resumeGate.hold !== null) await this.resumeGate.hold
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}
