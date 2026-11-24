import { expect } from 'vitest'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'

export async function nameGracesTeam(
  host: Pick<RuntimeHost, 'setAgentDisplayName'>,
  bringIdentityIntoBeing: (profileId: string) => Promise<void>,
  personOpens: (profileId: string) => Promise<string>,
): Promise<string> {
  await bringIdentityIntoBeing('pm-g')
  await bringIdentityIntoBeing('worker-g')
  const boss = await personOpens('boss-g')
  for (const [slug, name] of [
    ['boss-g', 'Grace'],
    ['pm-g', 'Ada'],
    ['worker-g', 'Bob'],
  ] as const) {
    expect(await host.setAgentDisplayName(slug, name), slug).not.toBeNull()
  }
  return boss
}
