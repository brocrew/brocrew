import type { ClientSessionApi } from '../../../shared/client-session-api'

export async function readPersonsQueue(bridge: Pick<ClientSessionApi, 'personsQueue'>) {
  try {
    return await bridge.personsQueue()
  } catch {
    return null
  }
}
