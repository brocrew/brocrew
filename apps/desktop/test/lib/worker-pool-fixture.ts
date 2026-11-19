import type { AServiceWorld } from '../helpers/a-service-world'

export async function openPoolReviewLead(world: AServiceWorld) {
  const host = world.aHost()
  const { sessionId } = await host.createSession(
    { provider: 'claude', profileId: 'review-lead', cwd: world.folder, approvalMode: 'auto' },
    world.window,
  )
  return { host, sessionId }
}
