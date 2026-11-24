import type { SessionStore } from '../../src/main/db/session-store'

/** The `asks` a held or moved question must carry: its asker, its request ID and its own route row. */
export function theAsk(store: SessionStore, asker: string, requestId: string) {
  const routed = store
    .events(asker)
    .find(({ event }) => event.type === 'request_routed' && event.requestId === requestId)
  if (routed === undefined) throw new Error(`${asker} has no route for ${requestId}`)
  const opening = JSON.stringify([asker, store.theActiveGeneration(asker), routed.ordinal])
  return { asker, requestId, originalOpening: opening }
}
