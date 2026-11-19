import { afterEach, beforeEach } from 'vitest'
import { aServiceWorld, type AServiceWorld } from '../helpers/a-service-world'

export function useDocumentReaderPool(
  keep: (fixture: { world: AServiceWorld; identity: string }) => void,
) {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
    keep({ world, identity: world.anAgent('document-reader', 'normal').id })
  })
  afterEach(() => world.cleanUp())
}

export async function openPoolReviewLead(world: AServiceWorld) {
  const host = world.aHost()
  const { sessionId } = await host.createSession(
    { provider: 'claude', profileId: 'review-lead', cwd: world.folder, approvalMode: 'auto' },
    world.window,
  )
  return { host, sessionId }
}
