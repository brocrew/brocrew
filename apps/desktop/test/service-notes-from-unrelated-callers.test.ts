import { expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { aServiceWorld } from './helpers/a-service-world'

it('flushes an unrelated caller’s held note while the next service piece stays queued', async () => {
  const world = aServiceWorld({ holderReminders: 'declined' })
  let release = (): void => {}
  const held = new Promise<void>((done) => {
    release = done
  })
  try {
    world.anAgent('browser-driver')
    for (const profile of ['caller', 'other-caller', 'stranger']) {
      world.anAgent(profile, 'nothing kept')
    }
    world.store.setDefaultApprovalMode('auto')
    const host = world.aHost()
    const caller = await world.aPersonOpens(host, 'caller')
    const other = await world.aPersonOpens(host, 'other-caller')
    const stranger = await world.aPersonOpens(host, 'stranger')
    world.turnsWait = held
    const first = await world.gives(host, caller, 'browser-driver', { title: 'One' })
    const next = await world.gives(host, other, 'browser-driver', { title: 'Two' })
    if (!first.ok || !next.ok) throw new Error('service work was refused')
    const service = first.owner
    const waiting = () =>
      world.store.piecesOwnedBy(service).find((row) => row.piece === next.piece)?.state
    await vi.waitFor(() => {
      expect(world.ledger(service).filter((row) => row.type === 'user_turn')).toHaveLength(1)
    })
    const text = 'A note from a caller with no piece at this service.'
    const message = agentToolsFor(host, stranger).tools.find(
      (tool) => tool.name === 'message_agent',
    )
    if (message === undefined) throw new Error('message tool missing')
    const sent = await message.call({ agent: service, kind: 'note', text })
    expect(sent.structured).toMatchObject({ outcome: 'ok', delivery: 'queued' })
    const delivered = () =>
      world.ledger(service).some((row) => row.type === 'user_turn' && row.text.includes(text))
    expect(delivered()).toBe(false)
    expect(waiting()).toBe('waiting')
    world.turnsWait = null
    release()
    await vi.waitFor(() => {
      expect(delivered()).toBe(true)
      expect(
        world.sent.some((row) => row.as === 'browser-driver' && row.words.includes(text)),
      ).toBe(true)
    })
    expect(waiting()).toBe('waiting')
  } finally {
    world.turnsWait = null
    release()
    await world.cleanUp()
  }
})
