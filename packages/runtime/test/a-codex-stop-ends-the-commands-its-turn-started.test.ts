import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CodexRuntime,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import { BackgroundTerminals, type TerminalTimers } from '../src/codex/background-terminals'
import {
  completedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
} from './fixtures/codex-protocol'

/**
 * # 🔴 F084 · a Codex stop ends the commands its turn started, and its ending says which
 *
 * ⛔ `turn/interrupt` ends the turn and leaves its commands running (measured on 0.146 and 0.160),
 * so the adapter ends them itself, through `thread/backgroundTerminals/terminate`, and the turn's
 * ending names each one Codex answered `{terminated:true}` for (`endedCommands`):
 *
 *  - **an explicit stop** (`interrupt()` then `endEverythingTheTurnStarted()`, a person's Stop or
 *    `interrupt_agent`) ends EVERY command the stopped turn started;
 *  - **a stop that makes way for words** (`interrupt()` alone) ends only the command the turn waits
 *    on — the one it has not moved on from, where only a later TOOL USE moves on (a message, a
 *    thought and a `write_stdin` check — which shows on the stream as nothing — do not; a sub-agent
 *    spawned or spoken to does);
 *  - **a command an EARLIER turn left running is never ended by a stop.**
 *
 * ⚑ Two passes — one before `turn/interrupt`, one at the turn's end for a command started in between
 * — and the ending waits (bounded) for the second; a second stop meanwhile waits for that ending
 * instead of forcing one; an explicit stop asked meanwhile widens it with one more pass.
 *
 * ⚑ Every arm runs the real `CodexRuntime` over a scripted app-server double: no binary, no network.
 * The double keeps a process table of its own — a command is "running" from its `item/started` until
 * a `terminate` ends it — so a list answers what is running NOW, and a negative is read beside the
 * positive it differs from by one fact.
 */

const THREAD = 'th_1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A scripted `codex app-server`: answers what a test sets, records every request it was sent. */
class AppServerDouble implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private readonly responders = new Map<string, (params: unknown) => unknown>()
  readonly requests: { method: string; params: unknown }[] = []
  /** Turn ids this double's `turn/start` answered with, in order (`tn_1`, `tn_2`, …). */
  readonly turnStartIds: string[] = []
  codexHome: string | undefined

  onRequest(method: string, responder: (params: unknown) => unknown): void {
    this.responders.set(method, responder)
  }
  notification(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    const responder = this.responders.get(method)
    if (responder !== undefined) {
      try {
        return Promise.resolve(responder(params))
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: this.codexHome,
        platformFamily: 'unix',
        platformOs: 'macos',
      })
    }
    if (method === 'turn/start') {
      const id = `tn_${String(this.turnStartIds.length + 1)}`
      this.turnStartIds.push(id)
      return Promise.resolve(turnStartResponse(id))
    }
    return Promise.resolve({})
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  /** Every `processId` a `terminate` was asked for, in order. */
  terminated(): string[] {
    return this.requests
      .filter((one) => one.method === 'thread/backgroundTerminals/terminate')
      .map((one) => (isRecord(one.params) ? String(one.params['processId']) : ''))
  }
  /** How many requests of `method` went out. */
  count(method: string): number {
    return this.requests.filter((one) => one.method === method).length
  }
}

/** A gate a test opens by hand. */
function aGate(): { readonly closed: Promise<void>; open(): void } {
  let open: () => void = () => {}
  const closed = new Promise<void>((resolve) => {
    open = resolve
  })
  return { closed, open }
}

/**
 * ⚑ **The app-server's background terminals**: what runs, by `processId`, with the `itemId` of the
 * command item that started it (the `toolCallId` the adapter keys a turn's commands by).
 */
class ItsTerminals {
  readonly running = new Map<string, { readonly itemId: string; readonly command: string }>()
  /** Processes that finished by themselves just before their stop: `{terminated:false}`. */
  readonly finishedOnTheirOwn = new Set<string>()
  /** Processes whose stop Codex refuses (`-32600`). */
  readonly refused = new Set<string>()
  private listsHeld: Promise<void> | null = null
  private readonly terminatesHeld = new Map<string, Promise<void>>()

  constructor(server: AppServerDouble) {
    server.onRequest('thread/backgroundTerminals/list', async () => {
      while (this.listsHeld !== null) await this.listsHeld
      return {
        data: [...this.running].map(([processId, row]) => ({
          itemId: row.itemId,
          processId,
          command: row.command,
          cwd: '/x',
          osPid: null,
          cpuPercent: null,
          rssKb: null,
        })),
        nextCursor: null,
      }
    })
    server.onRequest('thread/backgroundTerminals/terminate', async (params) => {
      const processId = isRecord(params) ? String(params['processId']) : ''
      const held = this.terminatesHeld.get(processId)
      if (held !== undefined) await held
      if (this.refused.has(processId)) {
        throw new Error('{"code":-32600,"message":"invalid background terminal process id"}')
      }
      if (this.finishedOnTheirOwn.has(processId)) {
        this.running.delete(processId)
        return { terminated: false }
      }
      return { terminated: this.running.delete(processId) }
    })
  }

  /** Hold every list answer until the returned function is called. */
  holdTheLists(): () => void {
    const gate = aGate()
    this.listsHeld = gate.closed
    return () => {
      this.listsHeld = null
      gate.open()
    }
  }

  /** Hold the answer to the stop of one process until the returned function is called. */
  holdTheStopOf(processId: string): () => void {
    const gate = aGate()
    this.terminatesHeld.set(processId, gate.closed)
    return () => {
      this.terminatesHeld.delete(processId)
      gate.open()
    }
  }
}

interface ASession {
  readonly server: AppServerDouble
  readonly terminals: ItsTerminals
  readonly handle: SessionHandle
  readonly events: RuntimeEvent[]
  readonly consumer: Promise<void>
}

type TurnEnding = Extract<RuntimeEvent, { type: 'turn' }>

const endingsIn = (events: readonly RuntimeEvent[]): TurnEnding[] =>
  events.filter((event): event is TurnEnding => event.type === 'turn')

const callsIn = (events: readonly RuntimeEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'tool_call' ? [event.id] : []))

const sorted = (ids: readonly string[] | undefined): string[] => [...(ids ?? [])].sort()

describe('F084 · a Codex stop ends the commands its turn started', () => {
  let root: string
  let opened: ASession[]

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-f084-codex-')))
    opened = []
  })

  afterEach(async () => {
    for (const one of opened) {
      await one.handle.close()
      await one.consumer
    }
    rmSync(root, { recursive: true, force: true })
  })

  const aSession = async (): Promise<ASession> => {
    const home = join(root, `home-${String(opened.length)}`)
    mkdirSync(home, { recursive: true })
    const server = new AppServerDouble()
    const terminals = new ItsTerminals(server)
    server.onRequest('thread/start', () => threadStartResponse(THREAD, root))
    const runtime = new CodexRuntime((context: CodexLaunchContext) => {
      server.codexHome ??= context.providerHome
      return server
    })
    const handle = await runtime.start({ cwd: root, providerHome: home })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    const session = { server, terminals, handle, events, consumer }
    opened.push(session)
    return session
  }

  /** A turn of ours is running and bound: its provider id, once its `working` has been delivered. */
  const aTurnRuns = async (s: ASession, words: string): Promise<string> => {
    const before = s.server.turnStartIds.length
    await s.handle.send(words)
    await vi.waitFor(() => expect(s.server.turnStartIds.length).toBe(before + 1))
    await vi.waitFor(() =>
      expect(s.events.filter((e) => e.type === 'status').at(-1)).toMatchObject({
        state: 'working',
      }),
    )
    return s.server.turnStartIds.at(-1) ?? ''
  }

  /** The turn starts a command in a process of its own — running from this moment. */
  const aCommandStarts = async (
    s: ASession,
    turnId: string,
    itemId: string,
    processId: string,
  ): Promise<void> => {
    const command = `/bin/sleep ${processId}`
    s.terminals.running.set(processId, { itemId, command })
    s.server.notification('item/started', {
      threadId: THREAD,
      turnId,
      item: { type: 'commandExecution', id: itemId, command, processId },
    })
    await vi.waitFor(() => expect(callsIn(s.events)).toContain(itemId))
  }

  /** Any other item the turn starts — a tool use or not, as the case says. */
  const anItemStarts = (s: ASession, turnId: string, item: Record<string, unknown>): void => {
    s.server.notification('item/started', { threadId: THREAD, turnId, item })
  }

  /** Codex ends the turn — in its own word — and the adapter's ending is waited for. */
  const codexEnds = async (
    s: ASession,
    turnId: string,
    status: 'interrupted' | 'completed',
    /** ⚑ How long the adapter's ending may take: it waits up to 1 s on a stop's last pass. */
    withinMs = 1_000,
  ): Promise<TurnEnding> => {
    const before = endingsIn(s.events).length
    s.server.notification(
      'turn/completed',
      turnCompletedNotification(THREAD, completedTurn(turnId, { status })),
    )
    await vi.waitFor(() => expect(endingsIn(s.events)).toHaveLength(before + 1), {
      timeout: withinMs,
    })
    const ending = endingsIn(s.events).at(-1)
    if (ending === undefined) throw new Error('no ending')
    return ending
  }

  /** An earlier turn starts `exec-early` (process 100) and ends with it running. */
  const anEarlierTurnLeftOneRunning = async (s: ASession): Promise<void> => {
    const earlier = await aTurnRuns(s, 'start the dev server')
    await aCommandStarts(s, earlier, 'exec-early', '100')
    const ending = await codexEnds(s, earlier, 'completed')
    expect(ending).not.toHaveProperty('endedCommands')
    await vi.waitFor(() => expect(s.handle.status()).toBe('idle'))
  }

  /**
   * The turn under test: `exec-moved` (101), then `exec-waited` (102) — the second command is a tool
   * use, so the model has moved on from the first and waits on the second.
   */
  const aTurnOfTwoCommands = async (s: ASession): Promise<string> => {
    const turnId = await aTurnRuns(s, 'build it')
    await aCommandStarts(s, turnId, 'exec-moved', '101')
    await aCommandStarts(s, turnId, 'exec-waited', '102')
    return turnId
  }

  const anExplicitStop = async (s: ASession): Promise<void> => {
    const asked = s.handle.interrupt()
    // ⚑ As the host makes it: at once after the ask, before anything is awaited.
    s.handle.endEverythingTheTurnStarted?.()
    await asked
  }

  describe('§1 · which commands a stop ends', () => {
    it('🔴 an explicit stop ends EVERY command its turn started — the one it moved on from too', async () => {
      const s = await aSession()
      await anEarlierTurnLeftOneRunning(s)
      const turnId = await aTurnOfTwoCommands(s)

      await anExplicitStop(s)
      expect(s.server.terminated().sort()).toEqual(['101', '102'])
      const ending = await codexEnds(s, turnId, 'interrupted')
      expect(ending.state).toBe('interrupted')
      expect(sorted(ending.endedCommands)).toEqual(['exec-moved', 'exec-waited'])
      // ⛔ …and the earlier turn's command was never asked about, and still runs.
      expect(s.server.terminated()).not.toContain('100')
      expect([...s.terminals.running.keys()]).toEqual(['100'])
    })

    it('⚑ a stop that makes way for words ends only the command the turn waits on', async () => {
      const s = await aSession()
      await anEarlierTurnLeftOneRunning(s)
      const turnId = await aTurnOfTwoCommands(s)

      await s.handle.interrupt()
      expect(s.server.terminated()).toEqual(['102'])
      const ending = await codexEnds(s, turnId, 'interrupted')
      expect(ending.endedCommands).toEqual(['exec-waited'])
      // ⛔ The one it moved on from, and the earlier turn's, run on.
      expect([...s.terminals.running.keys()].sort()).toEqual(['100', '101'])
    })

    it('⛔ a command an EARLIER turn left running is never ended — even by an explicit stop of a turn that started none', async () => {
      const s = await aSession()
      await anEarlierTurnLeftOneRunning(s)
      const turnId = await aTurnRuns(s, 'just think about it')
      const from = s.server.requests.length

      await anExplicitStop(s)
      // ⚑ A turn that started no command asks for no list before its stop: the RPC goes out at once.
      const asked = s.server.requests.slice(from).map((one) => one.method)
      expect(asked).toContain('turn/interrupt')
      expect(asked).not.toContain('thread/backgroundTerminals/list')
      const ending = await codexEnds(s, turnId, 'interrupted')
      expect(ending).not.toHaveProperty('endedCommands')
      expect(s.server.terminated()).toEqual([])
      expect([...s.terminals.running.keys()]).toEqual(['100'])
    })

    it('⚑ …and a turn that did start one ends it BEFORE `turn/interrupt` goes out', async () => {
      const s = await aSession()
      const turnId = await aTurnRuns(s, 'build it')
      await aCommandStarts(s, turnId, 'exec-waited', '102')

      await s.handle.interrupt()
      const methods = s.server.requests.map((one) => one.method)
      const ended = methods.indexOf('thread/backgroundTerminals/terminate')
      const asked = methods.indexOf('turn/interrupt')
      expect(ended).toBeGreaterThanOrEqual(0)
      expect(asked).toBeGreaterThan(ended)
      expect((await codexEnds(s, turnId, 'interrupted')).endedCommands).toEqual(['exec-waited'])
    })

    it('⛔ a turn nobody stopped ends at once over its commands, and ends none of them', async () => {
      const s = await aSession()
      const turnId = await aTurnOfTwoCommands(s)
      const ending = await codexEnds(s, turnId, 'completed')
      expect(ending).toEqual({ type: 'turn', state: 'completed' })
      expect(s.server.terminated()).toEqual([])
      expect([...s.terminals.running.keys()].sort()).toEqual(['101', '102'])
    })
  })

  /**
   * ⚑ **What "waits on" means: only a later TOOL USE moves on.** ⛔ A model waiting on a long command
   * writes and thinks between its checks on it, and a check (`write_stdin`) shows on Codex's stream
   * as nothing at all — so the cases where nothing but a message or a thought follows the command
   * are exactly what a polled command looks like here.
   */
  describe('§2 · the tool-use rule, for a stop that makes way for words', () => {
    const AFTER: readonly {
      readonly what: string
      readonly item: Record<string, unknown>
      readonly movesOn: boolean
    }[] = [
      {
        what: 'a message (the model writing while it waits or polls)',
        item: { type: 'agentMessage', id: 'msg_1', text: 'still waiting on the build' },
        movesOn: false,
      },
      {
        what: 'reasoning',
        item: { type: 'reasoning', id: 'rs_1', summary: [], content: [] },
        movesOn: false,
      },
      {
        what: 'a sub-agent ending (not the model’s own act)',
        item: {
          type: 'subAgentActivity',
          id: 'call_sub_done',
          kind: 'completed',
          agentThreadId: 'child-thread-1',
          agentPath: '/root/alpha',
        },
        movesOn: false,
      },
      {
        what: 'a web search',
        item: { type: 'webSearch', id: 'ws_1', query: 'how long does a build take' },
        movesOn: true,
      },
      {
        what: 'an MCP tool call',
        item: {
          type: 'mcpToolCall',
          id: 'mcp_1',
          server: 'docs',
          tool: 'lookup',
          arguments: {},
          status: 'inProgress',
        },
        movesOn: true,
      },
      {
        what: 'a sub-agent spawned',
        item: {
          type: 'subAgentActivity',
          id: 'call_sub_spawn',
          kind: 'started',
          agentThreadId: 'child-thread-2',
          agentPath: '/root/beta',
        },
        movesOn: true,
      },
      {
        what: 'a word to a sub-agent',
        item: {
          type: 'subAgentActivity',
          id: 'call_sub_word',
          kind: 'interacted',
          agentThreadId: 'child-thread-3',
          agentPath: '/root/gamma',
        },
        movesOn: true,
      },
    ]

    it.each(AFTER)(
      'the command followed by $what — moved on from: $movesOn',
      async ({ item, movesOn }) => {
        const s = await aSession()
        const turnId = await aTurnRuns(s, 'build it')
        await aCommandStarts(s, turnId, 'exec-waited', '102')
        anItemStarts(s, turnId, item)
        // ⚑ The item is read before the stop: a delta behind it on the stream has been.
        s.server.notification('item/agentMessage/delta', {
          threadId: THREAD,
          turnId,
          itemId: 'msg_marker',
          delta: 'marker',
        })
        await vi.waitFor(() =>
          expect(s.events.some((e) => e.type === 'assistant_delta' && e.text === 'marker')).toBe(
            true,
          ),
        )

        await s.handle.interrupt()
        const ending = await codexEnds(s, turnId, 'interrupted')
        if (movesOn) {
          expect(s.server.terminated()).toEqual([])
          expect(ending).not.toHaveProperty('endedCommands')
          expect([...s.terminals.running.keys()]).toEqual(['102'])
        } else {
          expect(s.server.terminated()).toEqual(['102'])
          expect(ending.endedCommands).toEqual(['exec-waited'])
          expect([...s.terminals.running.keys()]).toEqual([])
        }
      },
    )

    it('⚑ the paired pair: the SAME message, then another command — now the first is moved on from', async () => {
      const s = await aSession()
      const turnId = await aTurnRuns(s, 'build it')
      await aCommandStarts(s, turnId, 'exec-first', '101')
      anItemStarts(s, turnId, { type: 'agentMessage', id: 'msg_1', text: 'still waiting' })
      await aCommandStarts(s, turnId, 'exec-second', '102')
      await s.handle.interrupt()
      const ending = await codexEnds(s, turnId, 'interrupted')
      expect(ending.endedCommands).toEqual(['exec-second'])
      expect([...s.terminals.running.keys()]).toEqual(['101'])
    })
  })

  describe('§3 · named only when Codex confirms it', () => {
    it('⛔ a command that finished by itself before its stop (`{terminated:false}`) is not named', async () => {
      const s = await aSession()
      const turnId = await aTurnRuns(s, 'build it')
      await aCommandStarts(s, turnId, 'exec-waited', '102')
      s.terminals.finishedOnTheirOwn.add('102')
      await s.handle.interrupt()
      // ⚑ The stop was asked — the premise — and Codex said it ended nothing.
      expect(s.server.terminated()).toEqual(['102'])
      const ending = await codexEnds(s, turnId, 'interrupted')
      expect(ending).not.toHaveProperty('endedCommands')
    })

    it('⚑ one stop Codex refuses keeps no other from going out, and only the ended one is named', async () => {
      const s = await aSession()
      const turnId = await aTurnOfTwoCommands(s)
      s.terminals.refused.add('101')
      await anExplicitStop(s)
      expect(s.server.terminated().sort()).toEqual(['101', '102'])
      const ending = await codexEnds(s, turnId, 'interrupted')
      expect(ending.endedCommands).toEqual(['exec-waited'])
      expect([...s.terminals.running.keys()]).toEqual(['101'])
    })
  })

  describe('§4 · two passes, and an ending that waits for the second', () => {
    it('🔴 a command started after the stop’s first pass is ended by the second, and the ending waits for it', async () => {
      const s = await aSession()
      const turnId = await aTurnOfTwoCommands(s)
      await s.handle.interrupt()
      expect(s.server.terminated()).toEqual(['102'])

      // ⚑ Between the stop and Codex's ending, the turn starts another command — its stop is held.
      await aCommandStarts(s, turnId, 'exec-late', '103')
      const release = s.terminals.holdTheStopOf('103')
      s.server.notification(
        'turn/completed',
        turnCompletedNotification(THREAD, completedTurn(turnId, { status: 'interrupted' })),
      )
      await vi.waitFor(() => expect(s.server.terminated()).toContain('103'))
      await new Promise((resolve) => setTimeout(resolve, 40))
      // ⛔ The ending is not written while the second pass is out, and no next turn can start.
      expect(endingsIn(s.events)).toHaveLength(0)
      expect(s.handle.status()).toBe('working')

      release()
      await vi.waitFor(() => expect(endingsIn(s.events)).toHaveLength(1))
      const ending = endingsIn(s.events)[0]
      expect(ending?.state).toBe('interrupted')
      expect(sorted(ending?.endedCommands)).toEqual(['exec-late', 'exec-waited'])
      // ⛔ The second pass is a words stop's too: the command moved on from runs on.
      expect([...s.terminals.running.keys()]).toEqual(['101'])
    })

    it('🔴 a second stop during that wait waits for the ending — it neither asks again nor forces one', async () => {
      const s = await aSession()
      const turnId = await aTurnOfTwoCommands(s)
      await s.handle.interrupt()
      await aCommandStarts(s, turnId, 'exec-late', '103')
      const release = s.terminals.holdTheStopOf('103')
      s.server.notification(
        'turn/completed',
        turnCompletedNotification(THREAD, completedTurn(turnId, { status: 'interrupted' })),
      )
      await vi.waitFor(() => expect(s.server.terminated()).toContain('103'))

      let secondReturned = false
      const second = s.handle.interrupt().then(() => {
        secondReturned = true
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(secondReturned, 'the second stop did not wait for the ending').toBe(false)
      expect(s.server.count('turn/interrupt')).toBe(1)
      expect(endingsIn(s.events)).toHaveLength(0)

      release()
      await second
      expect(endingsIn(s.events)).toHaveLength(1)
      const ending = endingsIn(s.events)[0]
      // ⛔ Codex's own ending, with the names — never this app's forced one (`wordOf`).
      expect(ending).not.toHaveProperty('wordOf')
      expect(sorted(ending?.endedCommands)).toEqual(['exec-late', 'exec-waited'])

      // ⛔ …and nothing of it lands on the next turn.
      await vi.waitFor(() => expect(s.handle.status()).toBe('idle'))
      const next = await aTurnRuns(s, 'go on')
      expect(await codexEnds(s, next, 'completed')).toEqual({ type: 'turn', state: 'completed' })
    })

    it('🔴 an explicit stop asked during that wait widens it: the command moved on from ends too', async () => {
      const s = await aSession()
      const turnId = await aTurnOfTwoCommands(s)
      await s.handle.interrupt()
      expect(s.server.terminated()).toEqual(['102'])

      const release = s.terminals.holdTheLists()
      const listsBefore = s.server.count('thread/backgroundTerminals/list')
      s.server.notification(
        'turn/completed',
        turnCompletedNotification(THREAD, completedTurn(turnId, { status: 'interrupted' })),
      )
      // ⚑ Codex's ending has been read: its edge asked for the level (held), and the ending waits.
      await vi.waitFor(() =>
        expect(s.server.count('thread/backgroundTerminals/list')).toBeGreaterThan(listsBefore),
      )
      expect(endingsIn(s.events)).toHaveLength(0)

      s.handle.endEverythingTheTurnStarted?.()
      release()
      await vi.waitFor(() => expect(endingsIn(s.events)).toHaveLength(1))
      expect(sorted(endingsIn(s.events)[0]?.endedCommands)).toEqual(['exec-moved', 'exec-waited'])
      expect(s.server.terminated().sort()).toEqual(['101', '102'])
      expect([...s.terminals.running.keys()]).toEqual([])
    })

    it('⛔ a pass that answers after the ending was written is never said on the next turn', async () => {
      const s = await aSession()
      const turnId = await aTurnRuns(s, 'build it')
      await aCommandStarts(s, turnId, 'exec-waited', '102')
      // ⚑ Codex does not answer this stop until the turn's ending has given up on it (1 s, twice).
      const release = s.terminals.holdTheStopOf('102')
      await s.handle.interrupt()
      const stopped = await codexEnds(s, turnId, 'interrupted', 3_000)
      // ⛔ Unknown is not said: the ending names nothing it was not told of.
      expect(stopped).not.toHaveProperty('endedCommands')

      await vi.waitFor(() => expect(s.handle.status()).toBe('idle'))
      const next = await aTurnRuns(s, 'go on')
      release()
      await vi.waitFor(() => expect(s.terminals.running.has('102')).toBe(false))
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(await codexEnds(s, next, 'completed')).toEqual({ type: 'turn', state: 'completed' })
    }, 10_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The live row shape `thread/backgroundTerminals/list` returns (275's probe). */
const ROW = (processId: string, itemId: string) => ({
  itemId,
  processId,
  command: `sleep ${processId}`,
  cwd: '/x',
  osPid: null,
  cpuPercent: null,
  rssKb: null,
})

/** A wire whose answers a test writes; the LAST answer of a method repeats. */
function aWire(answers: Record<string, unknown[]>) {
  const sent: { method: string; params: unknown }[] = []
  const left: Record<string, unknown[]> = {}
  for (const [method, values] of Object.entries(answers)) left[method] = [...values]
  return {
    sent,
    request: (method: string, params: unknown): Promise<unknown> => {
      sent.push({ method, params })
      const queue = left[method]
      const value = queue === undefined ? undefined : queue.length > 1 ? queue.shift() : queue[0]
      if (value instanceof Error) return Promise.reject(value)
      return Promise.resolve(value)
    },
  }
}

/** Timers nothing fires — the poll a non-empty level arms never runs here. */
const STILL: TerminalTimers = {
  setTimeout: () => 'never',
  clearTimeout: () => {},
}

function terminalsOn(answers: Record<string, unknown[]>, open = true) {
  const wire = aWire(answers)
  const events: RuntimeEvent[] = []
  const terminals = new BackgroundTerminals(
    {
      request: wire.request,
      emit: (event) => events.push(event),
      threadId: () => THREAD,
      open: () => open,
    },
    STILL,
  )
  return { wire, events, terminals }
}

async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

const endingsOf = (events: readonly RuntimeEvent[]) =>
  events.flatMap((event) =>
    event.type === 'background_work' && event.ended !== undefined ? [event.ended] : [],
  )

describe('F084 · `BackgroundTerminals.endTheseCommands`', () => {
  it('🔴 ends only the rows the turn names, and returns only those Codex said it ended', async () => {
    const { wire, terminals } = terminalsOn({
      'thread/backgroundTerminals/list': [
        { data: [ROW('100', 'exec-early'), ROW('101', 'exec-a'), ROW('102', 'exec-b')] },
        { data: [ROW('100', 'exec-early')], nextCursor: null },
      ],
      'thread/backgroundTerminals/terminate': [{ terminated: true }, { terminated: false }],
    })
    const ended = await terminals.endTheseCommands((id) => id === 'exec-a' || id === 'exec-b')
    // ⚑ Both of the turn's were asked; the earlier turn's never was.
    expect(
      wire.sent
        .filter((one) => one.method === 'thread/backgroundTerminals/terminate')
        .map((one) => (one.params as { processId: string }).processId),
    ).toEqual(['101', '102'])
    // ⛔ `{terminated:false}` (102 had finished) ends nothing, so it is not returned.
    expect(ended).toEqual([{ id: '101', toolCallId: 'exec-a' }])
  })

  it('⚑ reads every page before it ends anything', async () => {
    const { wire, terminals } = terminalsOn({
      'thread/backgroundTerminals/list': [
        { data: [ROW('101', 'exec-a')], nextCursor: 'more' },
        { data: [ROW('102', 'exec-b')], nextCursor: null },
        { data: [], nextCursor: null },
      ],
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
    })
    const ended = await terminals.endTheseCommands(() => true)
    expect(wire.sent.slice(0, 3).map((one) => one.method)).toEqual([
      'thread/backgroundTerminals/list',
      'thread/backgroundTerminals/list',
      'thread/backgroundTerminals/terminate',
    ])
    expect(wire.sent[1]?.params).toEqual({ threadId: THREAD, cursor: 'more' })
    expect(ended.map((one) => one.toolCallId)).toEqual(['exec-a', 'exec-b'])
  })

  it('⚑ a row with no tool call is never ended — nothing names it as a turn’s', async () => {
    const { wire, terminals } = terminalsOn({
      'thread/backgroundTerminals/list': [{ data: [{ processId: '7', command: 'sleep 7' }] }],
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
    })
    expect(await terminals.endTheseCommands(() => true)).toEqual([])
    expect(wire.sent.map((one) => one.method)).toEqual(['thread/backgroundTerminals/list'])
  })

  it('⛔ a closed watch asks nothing and ends nothing', async () => {
    const { wire, terminals } = terminalsOn(
      { 'thread/backgroundTerminals/list': [{ data: [ROW('101', 'exec-a')] }] },
      false,
    )
    expect(await terminals.endTheseCommands(() => true)).toEqual([])
    expect(wire.sent).toEqual([])
  })

  /**
   * ⛔ **A stop key that left no level behind is forgotten**: the command a stopped turn ran is
   * usually not in the published level, so no ending would ever spend its `stopped` mark — and a
   * later process Codex gives the same key, which ends on its own, would be said `stopped`.
   */
  it('🔴 a key the stop ended and no level listed is forgotten — a later process under it ends `unknown`', async () => {
    const { events, terminals } = terminalsOn({
      'thread/backgroundTerminals/list': [
        { data: [ROW('42852', 'exec-a')] }, // the stop's own read
        { data: [], nextCursor: null }, // the level after the stop: gone
        { data: [ROW('42852', 'exec-other')] }, // later: a new process under the same key
        { data: [], nextCursor: null }, // …that ends by itself
      ],
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
    })
    expect(await terminals.endTheseCommands(() => true)).toHaveLength(1)
    terminals.refresh()
    await drain()
    terminals.refresh()
    await drain()
    expect(endingsOf(events)).toEqual([
      { id: '42852', toolCallId: 'exec-other', outcome: 'unknown' },
    ])
  })

  it('⚑ …and a key still listed after the stop keeps its mark, for the ending a later read publishes', async () => {
    const { events, terminals } = terminalsOn({
      'thread/backgroundTerminals/list': [
        { data: [ROW('42852', 'exec-a')] }, // the stop's own read
        { data: [ROW('42852', 'exec-a')] }, // the level after the stop: still listed a moment
        { data: [], nextCursor: null }, // then gone
      ],
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
    })
    expect(await terminals.endTheseCommands(() => true)).toHaveLength(1)
    terminals.refresh()
    await drain()
    expect(endingsOf(events)).toEqual([{ id: '42852', toolCallId: 'exec-a', outcome: 'stopped' }])
  })
})
