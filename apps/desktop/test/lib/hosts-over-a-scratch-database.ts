import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../../src/main/db/session-store'
import { RuntimeHost, type RuntimeHostDeps } from '../../src/main/runtime/runtime-host'
import { closeHostFixture, neutralHostDeps } from './host-fixture'

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db/migrations')

/** A provider's settings as these tests stand them in: where its home is, and the model kind. */
export const providerConfigOf =
  (homeEnv: string, model: string): RuntimeHostDeps['readProviderConfig'] =>
  (_provider, home) => ({ home, homeEnv, model, authNote: null, files: [] })

/** One fake runtime per provider, shared by every host given it: a relaunch keeps its state. */
export const oneRuntimePerProvider =
  (runtimes: () => Map<string, FakeRuntime>): RuntimeHostDeps['createRuntime'] =>
  (provider) => {
    const existing = runtimes().get(provider)
    if (existing) return existing
    const fresh = new FakeRuntime(provider)
    runtimes().set(provider, fresh)
    return fresh
  }

/** Provider homes laid out per profile: `provider-homes/default/<profile>/<provider>`. */
export function homesPerProfileUnder(
  root: () => string,
): Pick<RuntimeHostDeps, 'prepareProviderHome' | 'providerHomePath'> {
  const home = (provider: string, profileId: string) =>
    join(root(), 'provider-homes', 'default', profileId, provider)
  return { prepareProviderHome: home, providerHomePath: home }
}

export interface ScratchHosts {
  readonly dir: string
  readonly db: AppDatabase
  readonly store: SessionStore
  /** A host over this test's store: the shared stand-ins, then the file's own deps. */
  host(overrides?: Partial<RuntimeHostDeps>): RuntimeHost
  /** A host the file built another way, closed with the rest. */
  track<T extends Pick<RuntimeHost, 'closeAll'>>(host: T): T
  /** A second database, closed after the hosts and before this test's own. */
  alsoClose<T extends Pick<AppDatabase, 'open' | 'close'>>(other: T): T
  /** Another folder for this test, outside the scratch one, removed once the hosts are closed. */
  folder(prefix: string): string
}

/**
 * One scratch folder, migrated database and store per test, and every host built over them (462).
 *
 * ⚠️ **One hook owns the order.** Its afterEach closes the hosts, then any second database, then
 * the database, then the folder. A host left open runs its startup reconciliation on a closed
 * connection. Vitest runs after-hooks in reverse, so a file's own afterEach (a gate released,
 * mocks restored) runs before this one, and a separate host-closing hook could run too late.
 */
export function hostsOverAScratchDatabase(
  prefix: string,
  options: { readonly now?: () => number } = {},
): ScratchHosts {
  const built: Pick<RuntimeHost, 'closeAll'>[] = []
  const others: Pick<AppDatabase, 'open' | 'close'>[] = []
  const folders: string[] = []
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), prefix))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, MIGRATIONS)
    store = createSessionStore(db, options.now)
  })
  afterEach(async () => {
    const theOthers = {
      closeAll: async () => others.splice(0).forEach((one) => one.open && one.close()),
    }
    await closeHostFixture([...built.splice(0), theOthers], db, dir, ...folders.splice(0))
  })
  const track = <T extends Pick<RuntimeHost, 'closeAll'>>(host: T): T => {
    built.push(host)
    return host
  }
  return {
    get dir() {
      return dir
    },
    get db() {
      return db
    },
    get store() {
      return store
    },
    host(overrides = {}) {
      let counter = 0
      return track(
        new RuntimeHost({
          store,
          ...neutralHostDeps(() => dir),
          createRuntime: (provider) => new FakeRuntime(provider),
          prepareProviderHome: (provider) => join(dir, 'homes', provider),
          providerHomePath: (provider) => join(dir, 'homes', provider),
          resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
          newSessionId: () => `sess_${++counter}`,
          readProviderConfig: providerConfigOf('CODEX_HOME', 'file-based'),
          ...overrides,
        }),
      )
    },
    track,
    alsoClose(other) {
      others.push(other)
      return other
    },
    folder(prefix) {
      const folder = mkdtempSync(join(tmpdir(), prefix))
      folders.push(folder)
      return folder
    },
  }
}
