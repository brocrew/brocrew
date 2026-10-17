import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { rowsUnreadOnce } from '../src/main/db/session-store'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { mcpRequestWorld, type McpRequestWorld } from './helpers/mcp-server-request-world'

describe('a tools reopen waits for a complete reading of provider cards', () => {
  let world: McpRequestWorld
  let host: RuntimeHost
  let asker: string
  beforeEach(async () => {
    world = mcpRequestWorld()
    host = world.host()
    asker = await world.open(host)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  async function request() {
    const server = await world.server()
    const tool = agentToolsFor(host, asker).tools.find((one) => one.name === 'request_mcp_server')!
    const result = await tool.call({
      name: 'fictional-notes',
      url: server.url,
      reaches: 'Read fictional notes.',
      who_gets_it: 'everyone',
    })
    expect(result.structured).toMatchObject({ outcome: 'ok' })
    return { server, id: result.structured!.request as string }
  }
  const approve = (id: string) =>
    executeRuntimeCommand(host, world.window, {
      kind: 'decideMcpServerRequest',
      requestId: id,
      approve: true,
    })
  const notice = () => world.sent.map((one) => one.text).join('\n')
  async function card() {
    const handle = world.handles.get('writer')!
    const pending = handle.simulateUserInput('Pick a fictional note', ['blue'])
    await expect
      .poll(() =>
        world
          .ledger(asker)
          .some((one) => one.type === 'request_routed' && one.requestId === pending.id),
      )
      .toBe(true)
    expect(handle.status()).toBe('idle')
    return { ...pending, handle }
  }
  async function held(handle: ReturnType<typeof world.handles.get>, launches: number) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(world.launches).toHaveLength(launches)
    expect(world.handles.get('writer')).toBe(handle)
    expect(world.sent).toEqual([])
  }
  async function answer(pending: Awaited<ReturnType<typeof card>>, id: string, launches: number) {
    await host.respondUserInput(
      asker,
      pending.id,
      { kind: 'answer', answers: { q0: ['blue'] } },
      world.window,
    )
    expect(await pending.answered).toEqual({ kind: 'answer', answers: { q0: ['blue'] } })
    await expect.poll(() => world.launches.length).toBe(launches + 1)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
    expect(world.launches.at(-1)?.options.externalMcp?.servers).toMatchObject([
      { name: 'fictional-notes' },
    ])
  }

  it('a complete provider card blocks an idle handle until its ending is recorded', async () => {
    const { id } = await request()
    const pending = await card()
    const unread = rowsUnreadOnce()
    expect(world.store.routedRequestsOf(asker, unread)).toMatchObject([
      { requestId: pending.id, state: 'open' },
    ])
    expect(world.store.questionsRaisedIn(asker, unread).get(pending.id)?.raisedBy).toBe(
      'the-provider',
    )
    expect(unread.count).toBe(0)
    expect(unread.ledgersSkipped).toBe(0)
    expect(await approve(id)).toMatchObject({ outcome: 'taken' })
    await held(pending.handle, 1)
    await answer(pending, id, 1)
  })

  it('a card its provider withdrew stops holding the reopen', async () => {
    const { id } = await request()
    const pending = await card()
    expect(await approve(id)).toMatchObject({ outcome: 'taken' })
    await held(pending.handle, 1)
    // The row the Claude adapter writes when the SDK aborts a card nobody had answered.
    pending.handle.simulateRequestResolved(pending.id)
    expect(await pending.answered).toEqual({ kind: 'reject' })
    await expect.poll(() => world.launches.length).toBe(2)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
    expect(
      world.store.routedRequestsOf(asker).find((one) => one.requestId === pending.id)?.state,
    ).toBe('withdrawn')
  })

  it('a torn old closing row cannot hide a current card that reuses its provider id', async () => {
    const old = await card()
    const route = world
      .ledger(asker)
      .find((one) => one.type === 'request_routed' && one.requestId === old.id)!
    await host.respondUserInput(
      asker,
      old.id,
      { kind: 'answer', answers: { q0: ['blue'] } },
      world.window,
    )
    expect(await old.answered).toEqual({ kind: 'answer', answers: { q0: ['blue'] } })
    const decision = world
      .ledger(asker)
      .find((one) => one.type === 'user_decision' && one.requestId === old.id)!
    await host.close(asker, world.window)
    const ordinal =
      (
        world.db
          .prepare('SELECT max(ordinal) AS ordinal FROM events WHERE session_id = ?')
          .get(asker) as { ordinal: number }
      ).ordinal + 1
    // Older retained rows precede this resume; the provider may reuse its card id in the new life.
    world.store.append(asker, ordinal, route, 5_000_000)
    world.store.append(asker, ordinal + 1, decision, 5_000_001)
    const closing = world.db
      .prepare('SELECT id, payload FROM events WHERE session_id = ? AND ordinal = ?')
      .get(asker, ordinal + 1) as { id: string; payload: string }
    world.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run('not-json', closing.id)
    await host.resumeSession(asker, world.window)
    const { id } = await request()
    const pending = await card()
    expect(pending.id).toBe(old.id)
    const unread = rowsUnreadOnce()
    const routed = world.store.routedRequestsOf(asker, unread)
    expect(unread.count).toBeGreaterThan(0)
    expect(unread.ledgersSkipped).toBe(0)
    expect(
      routed.filter((one) => one.requestId === pending.id && one.state === 'open'),
    ).toMatchObject([{ at: 5_000_000 }])
    expect(await approve(id)).toMatchObject({ outcome: 'taken' })
    await held(pending.handle, 2)
    world.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(closing.payload, closing.id)
    await answer(pending, id, 2)
  })

  it('an uncounted partial fold is not cached as a complete absence', async () => {
    const { id } = await request()
    const pending = await card()
    const row = world.db
      .prepare(
        "SELECT id, payload FROM events WHERE session_id = ? AND type = 'request_routed' ORDER BY ordinal DESC LIMIT 1",
      )
      .get(asker) as { id: string; payload: string }
    world.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run('not-json', row.id)
    // Reconciliation can have warmed this fold; invalidate it before testing an uncounted read.
    world.store.append(
      asker,
      world.store.nextOrdinal(asker),
      { type: 'status', state: 'idle' },
      6_000_100,
    )
    expect(world.store.routedRequestsOf(asker)).toEqual([])
    const first = rowsUnreadOnce()
    expect(world.store.routedRequestsOf(asker, first)).toEqual([])
    const second = rowsUnreadOnce()
    expect(world.store.routedRequestsOf(asker, second)).toEqual([])
    expect(first.count).toBe(1)
    expect(second.count).toBe(1)
    expect(await approve(id)).toMatchObject({ outcome: 'taken' })
    await held(pending.handle, 1)
    world.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run(row.payload, row.id)
    const repaired = rowsUnreadOnce()
    const complete = world.store.routedRequestsOf(asker, repaired)
    expect(complete).toMatchObject([{ requestId: pending.id, state: 'open' }])
    expect(repaired.count).toBe(0)
    expect(world.store.routedRequestsOf(asker, rowsUnreadOnce())).toBe(complete)
    await answer(pending, id, 1)
  })

  it.each(['throw', 'whole-ledger'] as const)(
    'a %s read failure holds the reopen until a complete card ending',
    async (fault) => {
      const { id } = await request()
      const pending = await card()
      const read = world.store.routedRequestsOf.bind(world.store)
      const reading = vi
        .spyOn(world.store, 'routedRequestsOf')
        .mockImplementation((conversation, unread) => {
          if (conversation !== asker) return read(conversation, unread)
          if (fault === 'throw') throw new Error('fictional ledger unavailable')
          // The real store supplies this sentinel when a counted fold skips an entire ledger.
          unread?.in(conversation)('the-whole-ledger')
          return []
        })
      const unread = rowsUnreadOnce()
      if (fault === 'throw')
        expect(() => world.store.routedRequestsOf(asker, unread)).toThrow(
          'fictional ledger unavailable',
        )
      else {
        expect(world.store.routedRequestsOf(asker, unread)).toEqual([])
        expect(unread.ledgersSkipped).toBe(1)
      }
      expect(await approve(id)).toMatchObject({ outcome: 'taken' })
      await held(pending.handle, 1)
      reading.mockRestore()
      await answer(pending, id, 1)
    },
  )

  it('an app-authored question survives a reopen and does not hold the new tools', async () => {
    const { id } = await request()
    const tool = agentToolsFor(host, asker).tools.find((one) => one.name === 'ask_question')!
    const asked = await tool.call({
      who_answers: 'a-person',
      question: 'Which fictional note should I read?',
      options: ['blue', 'green'],
    })
    expect(asked.structured).toMatchObject({ outcome: 'ok' })
    const question = asked.structured!.question as string
    const unread = rowsUnreadOnce()
    expect(world.store.questionsRaisedIn(asker, unread).get(question)?.raisedBy).toBe('this-app')
    expect(
      world.store.routedRequestsOf(asker, unread).find((one) => one.requestId === question)?.state,
    ).toBe('open')
    expect(await approve(id)).toMatchObject({ outcome: 'taken' })
    await expect.poll(() => world.launches.length).toBe(2)
    await expect.poll(notice).toContain(`The person approved request ${id}`)
    expect(
      world.store.routedRequestsOf(asker).find((one) => one.requestId === question)?.state,
    ).toBe('open')
  })
})
