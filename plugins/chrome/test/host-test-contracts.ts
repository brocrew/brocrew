// Type-only: checked by the package project, never imported into the host or the payload.
import type { createProfileStore } from '../src/profiles/store.js'
import type { registerAdminRoutes } from '../src/http/adminRoutes.js'
import type { TabRegistry } from '../src/tabs.js'
import type { silentLogger } from '../src/logger.js'
import type { FakeBrowser } from './fakes.js'
import type { profileFixtureDeps, TestProfiles } from './host-test-fixture.js'

type Assert<Condition extends true> = Condition
export type StoreContract = Assert<
  ReturnType<typeof createProfileStore> extends TestProfiles ? true : false
>
type FixtureDeps = ReturnType<
  typeof profileFixtureDeps<
    ReturnType<typeof createProfileStore>,
    InstanceType<typeof FakeBrowser>,
    InstanceType<typeof TabRegistry>,
    typeof silentLogger
  >
>
export type RouteContract = Assert<
  FixtureDeps extends Parameters<typeof registerAdminRoutes>[1] ? true : false
>
