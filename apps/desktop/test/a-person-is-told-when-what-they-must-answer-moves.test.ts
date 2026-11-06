import type { TranscriptEvent } from '../src/shared/conversation-events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeChangeMessage } from '../src/shared/runtime-ipc'

/**
 * A window is told `persons` whenever what a person must answer may have moved — announced from
 * the commit record for the rows the person reads select, whichever door wrote them, and for the
 * live changes the conversations and roster announcements carry — and never for words streamed.
 */
describe('a person is told when what they must answer moves', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let announced: RuntimeChangeMessage['what'][]
  let conversation: string
  const loopTurns = async (n = 3) => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  const told = () => announced.filter((what) => (what as string) === 'persons').length

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('asker', 'normal')
    announced = []
    host = world.aHost({ servicesOn: false, announce: (message) => announced.push(message.what) })
    conversation = await world.aPersonOpens(host, 'asker')
    await loopTurns()
    announced = []
  })
  afterEach(async () => world.cleanUp())

  const writtenByTheStore = (event: TranscriptEvent) =>
    world.store.append(conversation, world.store.nextOrdinal(conversation), event, world.clock++)

  it.each([
    [{ type: 'request_routed', requestId: 'fictional-q', to: 'a-person' }],
    [{ type: 'request_resolved', requestId: 'fictional-q' }],
    [{ type: 'question_withdrawn', requestId: 'fictional-q' }],
    [{ type: 'instruction_settled', askId: 'fictional-ask', ending: 'declined' }],
    [{ type: 'mcp_server_request_settled', requestId: 'fictional-mcp', ending: 'refused' }],
    [{ type: 'work_status_set', piece: 'fictional-piece', status: 'Fictional status.' }],
    [{ type: 'status', state: 'ended' }],
  ])(
    'a row the person reads select, written by the store alone, announces persons: %j',
    async (event) => {
      writtenByTheStore(event as unknown as TranscriptEvent)
      await loopTurns()
      expect(told()).toBeGreaterThanOrEqual(1)
    },
  )

  it.each([
    [{ type: 'background_work', running: [], source: 'fictional' }],
    [{ type: 'scheduled_work', jobs: [], source: 'fictional' }],
  ])('a level row written by the store alone announces persons: %j', async (event) => {
    writtenByTheStore(event as unknown as TranscriptEvent)
    await loopTurns()
    expect(told()).toBeGreaterThanOrEqual(1)
  })

  it('background work its provider ends, through the real door, announces persons', async () => {
    const handle = world.handles.at(-1)!.handle
    handle.simulateBackgroundWork()
    await loopTurns()
    announced = []
    handle.simulateBackgroundWork({ running: [] })
    await loopTurns()
    expect(told()).toBeGreaterThanOrEqual(1)
  })

  it('a rename written by the store alone, with no row, announces persons', async () => {
    expect(world.store.setAgentDisplayName('asker', 'Fictional Asker')).toBe(true)
    await loopTurns()
    expect(told()).toBeGreaterThanOrEqual(1)
  })

  it('words streamed and a working status announce nothing to a person', async () => {
    writtenByTheStore({ type: 'assistant_message', text: 'fictional words' })
    writtenByTheStore({ type: 'status', state: 'working' } as TranscriptEvent)
    await loopTurns()
    expect(told()).toBe(0)
  })

  it('an import, which can bring a person a question, announces persons', async () => {
    world.store.importSnapshot({
      session: {
        id: 'imported',
        provider: 'claude',
        sessionId: 'fictional-imported',
        cwd: world.folder,
        profileId: 'fictional',
        updatedAt: world.clock,
        createdAt: world.clock,
      },
      derivedThrough: 0,
      ledger: [{ ordinal: 0, at: world.clock, event: { type: 'assistant_message', text: 'x' } }],
    })
    await loopTurns()
    expect(told()).toBeGreaterThanOrEqual(1)
  })

  it('a live change the conversations announcement carries — a close — announces persons', async () => {
    await host.close(conversation, world.window)
    await loopTurns()
    expect(announced).toContain('conversations')
    expect(told()).toBeGreaterThanOrEqual(1)
  })
})
