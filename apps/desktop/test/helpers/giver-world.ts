import type { SessionStore } from '../../src/main/db/session-store'
import type { ToolName } from '../../src/main/runtime/agent-tools'
import type { RuntimeHost, RuntimeEventSink } from '../../src/main/runtime/runtime-host'
import { callAs } from './call-tool'
import { personOpener } from './person-opens-session'

/** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
export const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

/**
 * What a giver test does from a person's window: open a conversation, call a tool as a
 * conversation, count the cards a turn parks on and end the turn on the last one with `outcome`,
 * and read what a conversation's ledger holds and the words it holds back.
 */
export function giverWorld(
  read: () => {
    host: RuntimeHost
    root: string
    store: Pick<SessionStore, 'events'>
    window: RuntimeEventSink
  },
  outcome: 'allow' | 'cancel',
) {
  const events = (id: string) =>
    read()
      .store.events(id)
      .map((entry) => entry.event)
  const cards = (id: string) => events(id).filter((event) => event.type === 'permission_request')
  const letTheTurnEnd = async (id: string): Promise<void> => {
    const card = cards(id).at(-1) as { id: string } | undefined
    if (card === undefined) throw new Error(`${id} is not parked`)
    const { host, window } = read()
    await host.respondPermission(id, card.id, { outcome }, window)
    await letItSettle()
  }
  return {
    events,
    personOpens: personOpener(read, 'ask'),
    callOn: (caller: string, name: ToolName, args: Record<string, unknown> = {}) =>
      callAs(read().host, caller, name, args),
    cardsOn: (id: string): number => cards(id).length,
    letTheTurnEnd,
    held: (id: string): string[] =>
      events(id).flatMap((event) => (event.type === 'message_queued' ? [event.text] : [])),
  }
}
