import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CanUseTool, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClaudeRuntime,
  type ClaudeQuery,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'
import { normalizeMessage } from '../src/claude/normalize'
import { TheCliAnswersInOrder } from './the-cli-answers-in-order'

/**
 * # 🔴 F084 · a Claude stop names the Bash its turn was waiting on
 *
 * ⚑ On Claude nothing changes in WHAT a stop ends — the CLI ends the Bash a turn waits on and spares
 * work it sent to the background (measured: gone 106 ms after the stop). What is new is that the
 * turn's ending says so (`endedCommands`), from the adapter's `commandsWaitedOn`:
 *
 *  - a main-agent `Bash` whose result has not come back is waited on, and a stop names it;
 *  - one sent to the background is answered at once, so it is never waited on and never named;
 *  - a sub-agent's `Bash` is not the turn's own;
 *  - a turn's ending ends its waits, so a call it never answered is not the next turn's;
 *  - a `Bash` still on its approval card never ran, and is not named;
 *  - a turn the CLI started by itself (a wake) names what its stop ended on its own ending.
 *
 * ⚑ And Claude's `{"type":"ping"}` keepalive is a quiet lifecycle frame, not a malformed one.
 *
 * Every arm runs the real `ClaudeRuntime` over a scripted SDK query — no CLI, no network — and a
 * negative is read beside the positive it differs from by one fact.
 */

/** A scripted SDK query: emits what a test says, records each interrupt. */
class CliDouble implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  /** ⚑ F080 — results name the message they answer, as the CLI's do. */
  readonly cli = new TheCliAnswersInOrder()
  interruptCount = 0
  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  async interrupt(): Promise<unknown> {
    this.interruptCount += 1
    return undefined
  }
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over(this.messages[Symbol.asyncIterator]())
  }
}

const toolOpts = (toolUseID: string) => ({
  toolUseID,
  signal: new AbortController().signal,
  requestId: `req_${toolUseID}`,
})

type TurnEnding = Extract<RuntimeEvent, { type: 'turn' }>

const endingsIn = (events: readonly RuntimeEvent[]): TurnEnding[] =>
  events.filter((event): event is TurnEnding => event.type === 'turn')

/** The main agent (or, with `parent`, a sub-agent) calls a tool. */
const aToolUse = (
  id: string,
  name: string,
  input: Record<string, unknown>,
  parent?: string,
): Record<string, unknown> => ({
  type: 'assistant',
  ...(parent === undefined ? {} : { parent_tool_use_id: parent }),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
})

/** The CLI's answer to a tool call. */
const itsResult = (id: string, content: string): Record<string, unknown> => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ tool_use_id: id, type: 'tool_result', content, is_error: false }],
  },
})

describe('F084 · a Claude stop names the Bash its turn was waiting on', () => {
  let root: string
  let opened: { cli: CliDouble; handle: SessionHandle; consumer: Promise<void> }[]

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-f084-claude-')))
    opened = []
  })

  afterEach(async () => {
    for (const one of opened) {
      await one.handle.close()
      one.cli.close()
      await one.consumer
    }
    rmSync(root, { recursive: true, force: true })
  })

  /** A session past its handshake, with a turn of ours running. */
  const aTurnRuns = async (): Promise<{
    cli: CliDouble
    handle: SessionHandle
    events: RuntimeEvent[]
    canUse: CanUseTool
  }> => {
    const cli = new CliDouble()
    let canUse: CanUseTool | undefined
    const home = join(root, `home-${String(opened.length)}`)
    mkdirSync(home, { recursive: true })
    const runtime = new ClaudeRuntime(
      (params) => {
        canUse = params.options.canUseTool
        cli.cli.listen(params.prompt)
        return cli
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: root, providerHome: home })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    opened.push({ cli, handle, consumer })
    cli.emit({ type: 'system', subtype: 'init', session_id: 'sess_1', cwd: root })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'session')).toBe(true))
    await handle.send('go')
    if (canUse === undefined) throw new Error('canUseTool was not wired into options')
    return { cli, handle, events, canUse }
  }

  const seen = async (events: readonly RuntimeEvent[], id: string): Promise<void> => {
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'tool_call' && e.id === id)).toBe(true),
    )
  }

  const theStoppedTurn = async (
    handle: SessionHandle,
    events: readonly RuntimeEvent[],
  ): Promise<TurnEnding> => {
    const before = endingsIn(events).length
    await handle.interrupt()
    await vi.waitFor(() => expect(endingsIn(events)).toHaveLength(before + 1))
    const ending = endingsIn(events).at(-1)
    if (ending === undefined) throw new Error('no ending')
    return ending
  }

  describe('§1 · what a stop names', () => {
    it('🔴 the foreground Bash the turn waits on is named on the stopped turn’s ending', async () => {
      const { cli, handle, events } = await aTurnRuns()
      cli.emit(aToolUse('toolu_fg', 'Bash', { command: 'sleep 94.1' }))
      await seen(events, 'toolu_fg')
      const ending = await theStoppedTurn(handle, events)
      expect(cli.interruptCount).toBe(1)
      expect(ending).toMatchObject({ state: 'interrupted', endedCommands: ['toolu_fg'] })
    })

    it('⛔ a Bash sent to the background is spared and not named — only the one still waited on is', async () => {
      const { cli, handle, events } = await aTurnRuns()
      cli.emit(aToolUse('toolu_bg', 'Bash', { command: 'npm run dev', run_in_background: true }))
      await seen(events, 'toolu_bg')
      // ⚑ Claude answers a backgrounded call at once.
      cli.emit(itsResult('toolu_bg', 'Command running in background with ID: bqx1'))
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'tool_result' && e.id === 'toolu_bg')).toBe(true),
      )
      cli.emit(aToolUse('toolu_fg', 'Bash', { command: 'sleep 94.2' }))
      await seen(events, 'toolu_fg')
      const ending = await theStoppedTurn(handle, events)
      expect(ending.endedCommands).toEqual(['toolu_fg'])
    })

    it('⛔ …and with nothing waited on, a stop names nothing at all', async () => {
      const { cli, handle, events } = await aTurnRuns()
      cli.emit(aToolUse('toolu_bg', 'Bash', { command: 'npm run dev', run_in_background: true }))
      cli.emit(itsResult('toolu_bg', 'Command running in background with ID: bqx1'))
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'tool_result' && e.id === 'toolu_bg')).toBe(true),
      )
      const ending = await theStoppedTurn(handle, events)
      expect(ending.state).toBe('interrupted')
      expect(ending).not.toHaveProperty('endedCommands')
    })

    it('⛔ a sub-agent’s Bash is not the turn’s own, and a tool that is not a Bash is not a command', async () => {
      const { cli, handle, events } = await aTurnRuns()
      cli.emit(aToolUse('toolu_agent', 'Agent', { prompt: 'look around' }))
      cli.emit(aToolUse('toolu_child', 'Bash', { command: 'sleep 94.3' }, 'toolu_agent'))
      await seen(events, 'toolu_child')
      await seen(events, 'toolu_agent')
      const ending = await theStoppedTurn(handle, events)
      expect(ending).not.toHaveProperty('endedCommands')
    })

    it('⚑ the paired positive: the main agent’s own Bash beside them is named, alone', async () => {
      const { cli, handle, events } = await aTurnRuns()
      cli.emit(aToolUse('toolu_agent', 'Agent', { prompt: 'look around' }))
      cli.emit(aToolUse('toolu_child', 'Bash', { command: 'sleep 94.3' }, 'toolu_agent'))
      cli.emit(aToolUse('toolu_main', 'Bash', { command: 'sleep 94.4' }))
      await seen(events, 'toolu_main')
      const ending = await theStoppedTurn(handle, events)
      expect(ending.endedCommands).toEqual(['toolu_main'])
    })

    it('⛔ a Bash whose result came back is no longer waited on', async () => {
      const { cli, handle, events } = await aTurnRuns()
      cli.emit(aToolUse('toolu_done', 'Bash', { command: 'ls' }))
      cli.emit(itsResult('toolu_done', 'a.txt'))
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'tool_result' && e.id === 'toolu_done')).toBe(true),
      )
      const ending = await theStoppedTurn(handle, events)
      expect(ending).not.toHaveProperty('endedCommands')
    })
  })

  describe('§2 · a turn’s ending ends its waits', () => {
    it('⛔ a Bash an earlier turn never got an answer for is not the next turn’s to name', async () => {
      const { cli, handle, events } = await aTurnRuns()
      cli.emit(aToolUse('toolu_left', 'Bash', { command: 'sleep 94.5' }))
      await seen(events, 'toolu_left')
      cli.emit({ type: 'result', subtype: 'success', is_error: false })
      await vi.waitFor(() => expect(endingsIn(events)).toHaveLength(1))
      expect(endingsIn(events)[0]).toMatchObject({ state: 'completed' })
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))

      await handle.send('again')
      cli.emit(aToolUse('toolu_mine', 'Bash', { command: 'sleep 94.6' }))
      await seen(events, 'toolu_mine')
      const ending = await theStoppedTurn(handle, events)
      // ⚑ Its own Bash is named (the positive), and the earlier turn's is not.
      expect(ending.endedCommands).toEqual(['toolu_mine'])
    })
  })

  describe('§3 · a Bash still on its approval card never ran', () => {
    it('⛔ a stop while its card is up names nothing', async () => {
      const { cli, handle, events, canUse } = await aTurnRuns()
      cli.emit(aToolUse('toolu_card', 'Bash', { command: 'sleep 94.7' }))
      await seen(events, 'toolu_card')
      const asked = canUse('Bash', { command: 'sleep 94.7' }, toolOpts('toolu_card') as never)
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'permission_request' && e.id === 'toolu_card')).toBe(
          true,
        ),
      )
      const ending = await theStoppedTurn(handle, events)
      expect(ending.state).toBe('interrupted')
      expect(ending).not.toHaveProperty('endedCommands')
      // ⚑ The card was refused by the stop, so the call never ran.
      expect(await asked).toMatchObject({ behavior: 'deny' })
    })

    it('⚑ the paired positive: once its card is answered it runs, and a stop names it', async () => {
      const { cli, handle, events, canUse } = await aTurnRuns()
      cli.emit(aToolUse('toolu_card', 'Bash', { command: 'sleep 94.8' }))
      await seen(events, 'toolu_card')
      const asked = canUse('Bash', { command: 'sleep 94.8' }, toolOpts('toolu_card') as never)
      await vi.waitFor(() =>
        expect(events.some((e) => e.type === 'permission_request' && e.id === 'toolu_card')).toBe(
          true,
        ),
      )
      await handle.respondPermission('toolu_card', { outcome: 'allow' })
      expect(await asked).toMatchObject({ behavior: 'allow' })
      const ending = await theStoppedTurn(handle, events)
      expect(ending.endedCommands).toEqual(['toolu_card'])
    })
  })

  describe('§4 · a turn the CLI started by itself', () => {
    it('🔴 a stop of a wake names the Bash it waited on, on the wake’s own ending', async () => {
      const { cli, handle, events } = await aTurnRuns()
      cli.emit({ type: 'result', subtype: 'success', is_error: false })
      await vi.waitFor(() => expect(endingsIn(events)).toHaveLength(1))
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))

      // ⚑ The CLI wakes its agent by itself, and the agent runs a foreground Bash.
      cli.emit(aToolUse('toolu_wake', 'Bash', { command: 'sleep 97.1' }))
      await seen(events, 'toolu_wake')
      expect(handle.status()).toBe('working')
      const ending = await theStoppedTurn(handle, events)
      expect(ending).toMatchObject({
        state: 'interrupted',
        startedBy: 'the-provider',
        endedCommands: ['toolu_wake'],
      })
      // ⛔ The turn of ours before it named nothing.
      expect(endingsIn(events)[0]).not.toHaveProperty('endedCommands')
    })
  })
})

describe('F084 · Claude’s keepalive', () => {
  it('⚑ `{"type":"ping"}` is a quiet, passing lifecycle frame', () => {
    const ping = {
      type: 'stream_event',
      event: { type: 'ping' },
      parent_tool_use_id: null,
      uuid: 'u1',
      session_id: 's1',
    }
    const out = normalizeMessage(ping as unknown as SDKMessage)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: 'unknown',
      category: 'lifecycle',
      label: 'ping',
      passing: true,
    })
  })

  it('⛔ …while a frame missing its required fields is still loud', () => {
    const broken = {
      type: 'stream_event',
      event: { type: 'message_start' },
      parent_tool_use_id: null,
      uuid: 'u2',
      session_id: 's1',
    }
    const out = normalizeMessage(broken as unknown as SDKMessage)
    expect(out[0]).toMatchObject({ type: 'unknown', category: 'unrecognized' })
    expect(out[0]).not.toHaveProperty('passing')
  })
})
