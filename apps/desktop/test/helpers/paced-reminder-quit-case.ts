import { expect, it } from 'vitest'
import type { SessionStore } from '../../src/main/db/session-store'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import { waitFor } from '../lib/f093-host'

interface PacedReminderContext {
  host(): RuntimeHost
  replaceHost(host: RuntimeHost): void
  create(): Promise<{ owner: string; work: { piece: string } }>
  waiting(owner: string, piece: string): void
  store(): SessionStore
  build(): RuntimeHost
  startGap(ms: number): void
}

/**
 * A reminder still waiting for its paced provider start when the app quits ends with the quit: it
 * writes nothing after `closeAll()`, and the next launch delivers it.
 */
export function registerPacedReminderQuitCase(context: PacedReminderContext): void {
  it('a quit while a reminder waits for its paced start leaves it queued for the next launch', async () => {
    const gap = 300
    const both = [await context.create(), await context.create()]
    for (const { owner, work } of both) context.waiting(owner, work.piece)
    await context.host().closeAll()
    context.startGap(gap)
    context.replaceHost(context.build())
    const store = context.store()
    const steps = (owner: string, piece: string) =>
      store.reconciliationReceipts(owner, piece).map((one) => `${one.step}:${one.outcome}`)
    const reminders = (owner: string) =>
      store
        .messagesWaitingIn(owner)
        .filter((one) => one.authorship.appNotice === 'a-work-wait-needs-attention')
    await waitFor(
      () => both.some(({ owner, work }) => steps(owner, work.piece).includes('holder:delivered')),
      'the first reminder delivered',
    )
    const paced = both.find(
      ({ owner, work }) => !steps(owner, work.piece).includes('holder:delivered'),
    )!
    expect(steps(paced.owner, paced.work.piece)).toEqual(['holder:planned'])
    expect(reminders(paced.owner)).toHaveLength(1)
    await context.host().closeAll()
    const ledger = store.events(paced.owner).length
    // Past the paced start it waited for (four start gaps, counted from before the quit).
    await new Promise((resolve) => setTimeout(resolve, 4 * gap + 500))
    expect(store.events(paced.owner)).toHaveLength(ledger)
    expect(steps(paced.owner, paced.work.piece)).toEqual(['holder:planned'])
    expect(reminders(paced.owner)).toHaveLength(1)
    context.replaceHost(context.build())
    await waitFor(
      () => steps(paced.owner, paced.work.piece).includes('holder:delivered'),
      'the kept reminder delivered at the next launch',
    )
  })
}
