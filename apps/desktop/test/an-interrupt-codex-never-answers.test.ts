import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

import {
  aHostOverScriptedCodex,
  waitFor,
  Window,
  type ScriptedAppServer,
} from './lib/scripted-codex-host'

/**
 * An interrupt Codex never answers: the host bounds its wait on `turn/interrupt`, releasing the
 * waiter and not the work, over the real Codex adapter and a scripted app-server.
 */

/** Short: the host's own wait is the thing under test. */
const INTERRUPT_WAIT_MS = 40

/** Where a promise stands after `ms`; `'pending'` is the hang. */
async function within(
  ms: number,
  promise: Promise<unknown>,
): Promise<{ state: 'resolved' } | { state: 'rejected'; message: string } | { state: 'pending' }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<{ state: 'pending' }>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'pending' }), ms)
  })
  try {
    return await Promise.race([
      promise.then(
        () => ({ state: 'resolved' as const }),
        (error: unknown) => ({
          state: 'rejected' as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      late,
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('an interrupt Codex never answers still gives interrupt-and-send back', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  const window = new Window('webContents:1')

  const ledgerOf = (id: string): TranscriptEvent[] => store.events(id).map((entry) => entry.event)
  /** The messages the last turn delivered, oldest first. */
  const theMessagesOfTheLastTurn = (id: string): string[] | undefined => {
    const turn = ledgerOf(id)
      .filter((event) => event.type === 'user_turn')
      .at(-1)
    return turn?.type === 'user_turn' ? turn.parts?.map((part) => part.text) : undefined
  }
  /** How each turn ended, in Codex's own word, as the ledger recorded it. */
  const turnEndings = (id: string): string[] =>
    ledgerOf(id).flatMap((event) => (event.type === 'turn' ? [event.state] : []))

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-709-interrupt-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-709-interrupt-root-'))
    ;({ host, db, store, servers } = aHostOverScriptedCodex(userData, {
      interruptWaitMs: INTERRUPT_WAIT_MS,
    }))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** A Codex conversation with a turn Codex is RUNNING, and one message queued behind it. */
  const aRunningTurnWithOneWaiting = async (): Promise<{
    id: string
    server: ScriptedAppServer
  }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'count to sixty', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const queued = await host.queueMessage(id, 'the one that was waiting', window)
    expect(queued).toMatchObject({ outcome: 'queued' })
    return { id, server }
  }

  it('Codex ENDS the turn and never answers the ask — the replacement goes, with the queued message', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never-but-ends'
    const verb = host.sendInterrupting(id, 'no, do THIS', window)
    expect(await within(2_000, verb)).toEqual({ state: 'resolved' })
    await waitFor(() => server.turnsAsked().length === 2, 'the one turn after the stop')
    expect(server.turnsAsked()).toEqual(['count to sixty', 'no, do THIS'])
    expect(theMessagesOfTheLastTurn(id)).toEqual(['the one that was waiting', 'no, do THIS'])
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    server.end(server.lastTurn, 'completed')
    await waitFor(() => turnEndings(id).includes('completed'), 'that turn to end')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.turnsAsked()).toHaveLength(2)
  })

  it('waits past five seconds for a slow turn to end, then sends once in queue order', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'answers-but-runs-on'
    const verb = host.sendInterrupting(id, 'no, do THIS', window)
    await waitFor(() => server.sent('turn/interrupt').length === 1, 'the interrupt')
    expect(await within(5_500, verb)).toEqual({ state: 'pending' })
    expect(server.turnsAsked()).toEqual(['count to sixty'])

    server.end(server.lastTurn, 'interrupted')
    expect(await within(2_000, verb)).toEqual({ state: 'resolved' })
    await waitFor(() => server.turnsAsked().length === 2, 'the replacement turn')
    expect(theMessagesOfTheLastTurn(id)).toEqual(['the one that was waiting', 'no, do THIS'])
    server.end(server.lastTurn, 'completed')
    await waitFor(() => turnEndings(id).includes('completed'), 'the replacement to finish')
    expect(server.turnsAsked()).toEqual(['count to sixty', 'no, do THIS'])
  }, 20_000)

  it('sends once on a new handle when the provider exits while the turn is still running', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    const queued = ledgerOf(id).find((event) => event.type === 'message_queued')
    if (!queued?.messageId) throw new Error('the fixture did not queue a named message')
    await host.cancelQueuedMessage(id, queued.messageId, window)
    server.interruptAnswer = 'answers-but-runs-on'
    const replacement = 'no, do THIS'
    const verb = host.sendInterrupting(id, replacement, window)
    await waitFor(() => server.sent('turn/interrupt').length === 1, 'the interrupt')
    expect(await within(75, verb)).toEqual({ state: 'pending' })

    server.close()
    expect(await within(2_000, verb)).toEqual({ state: 'resolved' })
    const receivedReplacement = (one: ScriptedAppServer) => one.turnsAsked().includes(replacement)
    await waitFor(
      () => servers.some((one) => one !== server && receivedReplacement(one)),
      'the replacement on a new handle',
    )
    const reopened = servers.find((one) => one !== server && receivedReplacement(one))
    if (reopened === undefined) throw new Error('no handle accepted the replacement')
    expect(server.turnsAsked()).toEqual(['count to sixty'])
    reopened.end(reopened.lastTurn, 'completed')
    await waitFor(() => turnEndings(id).includes('completed'), 'the replacement to finish')
    const delivered = servers.flatMap((one) =>
      one.turnsAsked().filter((words) => words === replacement),
    )
    expect(delivered).toEqual([replacement])
  })

  it('Codex answers the ask and ends the turn — the verb does exactly what it always did', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'answers'
    expect(await within(2_000, host.sendInterrupting(id, 'no, do THIS', window))).toEqual({
      state: 'resolved',
    })
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    await waitFor(() => server.turnsAsked().length === 2, 'the one turn after the stop')
    expect(server.turnsAsked()).toEqual(['count to sixty', 'no, do THIS'])
    expect(theMessagesOfTheLastTurn(id)).toEqual(['the one that was waiting', 'no, do THIS'])
    server.end(server.lastTurn, 'completed')
    await waitFor(() => turnEndings(id).includes('completed'), 'that turn to end')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.turnsAsked()).toHaveLength(2)
  })

  it('a Stop Codex never answers comes back — and the turn still ends in Codex’s own word', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never'
    const stop = host.interrupt(id, window)
    expect(await within(2_000, stop)).toEqual({ state: 'resolved' })
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    expect(server.turnsAsked()).toEqual(['count to sixty'])
    server.end(server.lastTurn, 'completed')
    await waitFor(() => server.turnsAsked().length === 2, 'the queued message')
    const ledger = store.events(id).map((entry) => entry.event)
    expect(ledger.some((event) => event.type === 'work_interrupted')).toBe(true)
    expect(ledger.filter((event) => event.type === 'turn')).toEqual([
      { type: 'turn', state: 'completed' },
    ])
  })

  it('…and one that ENDS the turn but never answers comes back too', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never-but-ends'
    expect(await within(2_000, host.interrupt(id, window))).toEqual({ state: 'resolved' })
    await waitFor(() => server.turnsAsked().length === 2, 'the queued message')
  })

  it('a Codex that answers — the Stop returns as it always did, with one ask', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'answers'
    expect(await within(2_000, host.interrupt(id, window))).toEqual({ state: 'resolved' })
    expect(server.sent('turn/interrupt')).toHaveLength(1)
    await waitFor(() => server.turnsAsked().length === 2, 'the queued message')
  })

  it('a second press while the first runs — the queue stays held until the LAST press is done', async () => {
    const { id, server } = await aRunningTurnWithOneWaiting()
    server.interruptAnswer = 'never'
    const first = host.sendInterrupting(id, 'do A', window)
    await waitFor(() => server.sent('turn/interrupt').length === 1, 'the first press’s ask')
    const second = host.sendInterrupting(id, 'do B', window)
    await waitFor(() => server.sent('turn/interrupt').length === 2, 'the second press’s ask')
    server.end(server.lastTurn, 'interrupted')
    await waitFor(() => server.turnsAsked().length === 2, 'the one turn after the stop')
    const [waiting, ...presses] = theMessagesOfTheLastTurn(id) ?? []
    expect(waiting).toBe('the one that was waiting')
    expect([...presses].sort()).toEqual(['do A', 'do B'])
    expect(await within(2_000, first)).toEqual({ state: 'resolved' })
    expect(await within(2_000, second)).toEqual({ state: 'resolved' })
    server.end(server.lastTurn, 'completed')
    await waitFor(() => turnEndings(id).includes('completed'), 'that turn to end')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(server.turnsAsked()).toHaveLength(2)
  }, 20_000)
})

/** The ask's own bound is patience: the verb waits for the answer, then gives the turn its own wait. */
describe('the ask’s own bound is patience too', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  const window = new Window('webContents:1')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-709-patience-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-709-patience-root-'))
    ;({ host, db, servers } = aHostOverScriptedCodex(userData))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  it('a Codex that answers the ask and ends the turn 5.5 s later still takes the replacement', async () => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'count to sixty', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    server.interruptAnswer = 'late'
    server.lateMs = 5_500
    expect(await within(9_000, host.sendInterrupting(id, 'no, do THIS', window))).toEqual({
      state: 'resolved',
    })
    expect(server.turnsAsked()).toEqual(['count to sixty', 'no, do THIS'])
  }, 20_000)
})
