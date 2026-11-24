import { expect, it } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { waitFor } from './lib/host-fixture'

it('states unknown activity and uses only the actual owner’s cached context', async () => {
  const world = aServiceWorld()
  try {
    const host = world.aHost()
    const owner = await world.aPersonOpens(host, 'worker')
    const held = world.handles.at(-1)
    if (held === undefined) throw new Error('no live handle')
    held.handle.simulateContextReading({ kind: 'tokens', used: 5000 }, 'message_start')
    await waitFor(
      () => world.ledger(owner).some((event) => event.type === 'context_reading'),
      'the owner’s context reading',
    )
    const { said } = host.receiptForSend({
      to: owner,
      profile: 'worker',
      targetKind: 'continued',
      recorded: { kind: 'task', id: 'work_kept', taskLabel: 'W1.1' },
      state: {
        kind: 'cannot-run',
        cause: { code: 'could-not-start', reason: 'the provider could not start' },
        needsPerson: true,
      },
      attachments: [],
    })
    expect(said).toContain('last active time unknown, but it could not start:')
    expect(said).toContain('Ask the person to fix it, with request_action.')
    expect(said).toContain('Context: 5,000 tokens used (window size not reported).')
  } finally {
    await world.cleanUp()
  }
})
