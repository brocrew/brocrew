import type { RuntimeEvent } from './events'

const joinedAppTurnEndings = new WeakSet<RuntimeEvent>()

// The ledger calls both endings provider-started. Live consumers can tell whether an app turn joined.
export function rememberJoinedAppTurnEnding(event: RuntimeEvent): void {
  joinedAppTurnEndings.add(event)
}

export function endsOnlyProviderWork(event: Extract<RuntimeEvent, { type: 'turn' }>): boolean {
  return event.startedBy === 'the-provider' && !joinedAppTurnEndings.has(event)
}
