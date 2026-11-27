import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { FakeProviderSessions } from '@brobot2/runtime/testing'
import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../../src/main/db/connection'
import { createSessionStore } from '../../src/main/db/session-store'
import type { RuntimeHost, RuntimeHostDeps } from '../../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import {
  fixtureDatabase,
  fixtureFolder,
  RecordingSink,
  syntheticProviderHome,
} from '../lib/host-fixture'

export function scratchHostState(prefix: string, now: () => number) {
  const userData = fixtureFolder(prefix + '-')
  const root = fixtureFolder(prefix + '-root-')
  const db = fixtureDatabase(userData)
  return {
    userData,
    root,
    db,
    store: createSessionStore(db, now),
    issued: new FakeProviderSessions(),
    window: new RecordingSink('webContents:1'),
  }
}

/** Provider homes and conversation folders laid out under one scratch data folder. */
export function homesUnder(
  userData: () => string,
): Pick<RuntimeHostDeps, 'prepareProviderHome' | 'providerHomePath' | 'resolveCwd'> {
  return {
    prepareProviderHome: syntheticProviderHome(userData),
    providerHomePath: (provider: Provider) => join(userData(), 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData(), sessionId, requested),
  }
}

/** Closes every conversation the hosts hold and the database, then removes the scratch folders. */
export async function closeAndRemove(
  hosts: readonly Pick<RuntimeHost, 'closeAll'>[],
  db: AppDatabase,
  ...folders: string[]
): Promise<void> {
  for (const host of hosts) await host.closeAll()
  db.close()
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
}
