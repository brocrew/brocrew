import { rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../../src/main/db/connection'
import type { RuntimeHost, RuntimeHostDeps } from '../../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../../src/main/runtime/scratch-cwd'
import { syntheticProviderHome } from '../lib/host-fixture'

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
