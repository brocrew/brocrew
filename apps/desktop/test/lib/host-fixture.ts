import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../../src/main/db/connection'
import { createSessionStore } from '../../src/main/db/session-store'
import { applyMigrations } from '../../src/main/db/migrate'
import { resourcesRoot } from '../../src/main/resources/resources'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import {
  FakeRuntime,
  type FakeSessionHandle,
  type AgentToolset,
  type FakeProviderSessions,
  type StartOptions,
  type SessionRef,
  type ResumeOptions,
} from '@brobot2/runtime'
import { mkdirSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
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

export function fixtureHostPaths(
  rootGetter: () => string,
): Pick<
  RuntimeHostDeps,
  | 'discoverSessions'
  | 'nativeTranscriptPath'
  | 'exportDirectory'
  | 'resourcesRoot'
  | 'prepareProviderHome'
  | 'providerHomePath'
  | 'resolveCwd'
> {
  return {
    ...neutralHostDeps(rootGetter),
    resourcesRoot: () => resourcesRoot(rootGetter()),
    prepareProviderHome: syntheticProviderHome(rootGetter),
    providerHomePath: (provider) => join(rootGetter(), 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(rootGetter(), sessionId, requested),
  }
}

export function numberedFixtureHostPaths(rootGetter: () => string, now: () => number) {
  let counter = 0
  return {
    ...fixtureHostPaths(rootGetter),
    newSessionId: () => `sess_${++counter}`,
    now,
    readProviderConfig: fixtureProviderConfig,
  }
}

export function latestToolset(handed: readonly AgentToolset[]): AgentToolset {
  const last = handed.at(-1)
  if (last === undefined) throw new Error('no toolset was handed to that launch')
  return last
}

type FixtureHost = Pick<RuntimeHost, 'closeAll'>

/** Close the fixture hosts before their database and owned directories. */
export async function closeHostFixture(
  host: FixtureHost | readonly FixtureHost[],
  db: Pick<import('../../src/main/db/connection').AppDatabase, 'close'>,
  ...folders: string[]
): Promise<void> {
  const failures: unknown[] = []
  for (const fixture of 'closeAll' in host ? [host] : host) {
    try {
      await fixture.closeAll()
    } catch (error) {
      failures.push(error)
    }
  }
  try {
    db.close()
  } catch (error) {
    failures.push(error)
  }
  for (const folder of folders) {
    try {
      rmSync(folder, { recursive: true, force: true })
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Fixture teardown failed')
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

export class ObservedProviderLaunches extends FakeRuntime {
  constructor(
    provider: Provider,
    sessions: FakeProviderSessions,
    private readonly observe: (
      kind: 'start' | 'resume',
      options: StartOptions | ResumeOptions,
      handle: FakeSessionHandle,
    ) => void,
  ) {
    super(provider, { sessions })
  }

  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.observe('start', options, handle)
    return handle
  }

  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.observe('resume', options, handle)
    return handle
  }
}

export function fixtureFolder(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function fixtureDatabase(userData: string) {
  const db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db/migrations'))
  return db
}

export type { TranscriptEvent } from '../../src/shared/conversation-events'

export async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

export async function settleFixtureTurns(rounds: number, delay: number): Promise<void> {
  for (let round = 0; round < rounds; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
}

export function fixtureStoreStatements(prefix: string) {
  const folder = fixtureFolder(prefix)
  const db = fixtureDatabase(folder)
  const prepared: string[] = []
  const prepare = db.prepare.bind(db)
  ;(db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
    prepared.push(sql)
    return prepare(sql)
  }) as typeof db.prepare
  createSessionStore(db, () => 1)
  ;(db as unknown as { prepare: typeof db.prepare }).prepare = prepare
  return {
    db,
    prepared,
    close: () => {
      db.close()
      rmSync(folder, { recursive: true, force: true })
    },
  }
}
