import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import type { AServiceWorld } from './a-service-world'

/** A giver's recorded worker as the sender, and a person-opened conversation as the target. */
export async function anOutboundWorld(world: AServiceWorld) {
  world.anAgent('giver', 'normal')
  world.anAgent('outbound-sender', 'normal')
  world.anAgent('outbound-target', 'normal')
  const host: RuntimeHost = world.aHost()
  const giver = await world.aPersonOpens(host, 'giver')
  const sender = await world.aRecordedWorker(giver, 'outbound-sender')
  await host.resumeSession(sender, world.window)
  const target = await world.aPersonOpens(host, 'outbound-target')
  await host.setApprovalMode(target, 'auto', world.window)
  return { host, sender, target }
}
