import { EventEmitter } from 'node:events'
import type { ModelInfo, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsyncQueue } from '../src/internal/async-queue'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude'
import type { RuntimeEvent, SessionHandle } from '../src/index'

/**
 * Card 197 (B5, B8, B9): the Claude settings acknowledgement, the account and command reads and the
 * model probe no longer fail because a slow PC took long. A wait ends on the answer or on the CLI's
 * exit (the SDK rejects its pending requests then; the fake does the same, see `SlowQuery.hold`);
 * the model probe keeps one total limit (60 s), for the reason written beside it.
 *
 * The cases that prove the change are the five-minute and 40-second ones: they fail against the old
 * 10 s and 15 s limits. The "exits" cases prove only that a rejection from a dead CLI reaches the
 * person, which the old code did too. A request made after the CLI has exited is rejected by the SDK
 * itself (measured against a real query on a CLI that had already exited).
 */

const FIVE_MINUTES = 300_000

/** A CLI that is alive until `die()`, and a query whose answers a test releases when it chooses. */
function aSlowCli(): {
  runtime: ClaudeRuntime
  query: SlowQuery
  die: () => void
} {
  const stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} })
  const child = Object.assign(new EventEmitter(), { pid: 4242, stderr })
  const query = new SlowQuery()
  const runtime = new ClaudeRuntime(
    (params) => {
      // The real transport spawns inside `query()`, so the witness only sees a child if this does.
      params.options.spawnClaudeCodeProcess?.({
        command: 'claude',
        args: [],
        env: {},
        signal: new AbortController().signal,
      })
      return query
    },
    async () => true,
    undefined,
    undefined,
    () => child as never,
  )
  return {
    runtime,
    query,
    die: () => {
      child.emit('exit', 1, null)
      query.failHeld(new Error('Claude Code process exited with code 1'))
    },
  }
}

class SlowQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  /** What each request waits on; `undefined` answers at once. */
  private holding: Promise<unknown> | undefined
  private failTheHeld: ((error: Error) => void) | undefined
  /** Hold every answer until the returned function lets go; the CLI's death rejects them all. */
  hold(): () => void {
    let release!: () => void
    this.holding = new Promise<void>((resolve, reject) => {
      release = resolve
      this.failTheHeld = reject
    })
    this.holding.catch(() => {})
    return release
  }
  failHeld(error: Error): void {
    this.failTheHeld?.(error)
  }
  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {
    this.messages.close()
    // The SDK's cleanup rejects every pending control request when the query closes.
    this.failHeld(new Error('the query was closed'))
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
  async setModel(): Promise<void> {
    await this.holding
  }
  async accountInfo(): Promise<{ email?: string }> {
    await this.holding
    return { email: 'someone@example.test' }
  }
  async initializationResult(): Promise<{ commands: readonly unknown[] }> {
    await this.holding
    return { commands: [{ name: 'compact', description: 'Compact', argumentHint: '' }] }
  }
  async supportedCommands(): Promise<readonly unknown[]> {
    await this.holding
    return [{ name: 'compact', description: 'Compact', argumentHint: '' }]
  }
  async supportedModels(): Promise<ModelInfo[]> {
    await this.holding
    return [{ value: 'sonnet', displayName: 'Sonnet' } as ModelInfo]
  }
}

/** Starts a session on a live CLI and holds the query's answers until the test lets go. */
async function openedHolding(): Promise<{
  handle: SessionHandle
  cli: ReturnType<typeof aSlowCli>
  letGo: () => void
  events: RuntimeEvent[]
}> {
  const cli = aSlowCli()
  const letGo = cli.query.hold()
  const handle = await cli.runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
  const events: RuntimeEvent[] = []
  void (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  cli.query.emit({ type: 'system', subtype: 'init', session_id: 'sess_slow', cwd: '/tmp/x' })
  await until(() => events.some((e) => e.type === 'session'))
  opened.push({ handle, cli })
  return { handle, cli, letGo, events }
}

/** Poll with real ticks, so it still works while `setTimeout` is faked. */
async function until(done: () => boolean): Promise<void> {
  for (let tick = 0; tick < 1000 && !done(); tick += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  expect(done()).toBe(true)
}

const opened: { handle: SessionHandle; cli: ReturnType<typeof aSlowCli> }[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const { handle, cli } of opened.splice(0)) {
    cli.die()
    await handle.close()
  }
})

describe('a slow Claude CLI is not a failed one (card 197)', () => {
  it('B5 · a settings change that is acknowledged after five minutes still applies', async () => {
    const { handle, letGo, events } = await openedHolding()
    await handle.setModel('opus')

    vi.useFakeTimers()
    const sending = handle.send('hello')
    let outcome = 'pending'
    sending.then(
      () => (outcome = 'sent'),
      () => (outcome = 'failed'),
    )
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES)
    expect(outcome, 'a slow acknowledgement must not fail the turn').toBe('pending')

    letGo()
    await vi.advanceTimersByTimeAsync(0)
    await sending
    expect(outcome).toBe('sent')
    expect(events.filter((e) => e.type === 'turn').at(-1)).not.toMatchObject({ state: 'failed' })
  })

  it('B5 · a settings change fails at once when the CLI exits instead of answering', async () => {
    const { handle, cli, events } = await openedHolding()
    await handle.setModel('opus')

    const sending = handle.send('hello')
    const failed = expect(sending).rejects.toThrow(/exited with code 1/)
    cli.die()
    await failed
    expect(events.filter((e) => e.type === 'turn').at(-1)).toMatchObject({ state: 'failed' })
  })

  it('B9 · the command list and the account are read when the CLI answers after five minutes', async () => {
    // Fake timers go on BEFORE the session opens: the account read and the command publish start at
    // attach, so a clock armed there is the one a real timer would fire.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { handle, letGo, events } = await openedHolding()
    const asking = handle.providerCommands?.()
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES)
    expect(handle.account?.(), 'the account read is still waiting').toBeUndefined()
    expect(
      events.some((e) => e.type === 'provider_commands'),
      'nothing published yet',
    ).toBe(false)

    letGo()
    await vi.advanceTimersByTimeAsync(0)
    expect((await asking)?.commands.map((command) => command.name)).toContain('compact')
    await until(() => handle.account?.()?.email === 'someone@example.test')
    expect(
      events
        .filter((e) => e.type === 'provider_commands')
        .map((e) => (e as { source?: string }).source),
      'the attach-time list was published too',
    ).toContain('initializationResult')
  })

  it('B5 · closing the session ends a settings change that is still waiting', async () => {
    const { handle } = await openedHolding()
    await handle.setModel('opus')

    const sending = handle.send('hello')
    const ended = expect(sending).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await handle.close()
    await ended
  })

  it('B9 · the command list read fails at once when the CLI exits instead of answering', async () => {
    const { handle, cli } = await openedHolding()

    const asking = handle.providerCommands?.()
    const failed = expect(asking).rejects.toThrow(/exited with code 1/)
    cli.die()
    await failed
  })

  it('B8 · the model list is read when the CLI answers after 40 seconds', async () => {
    const cli = aSlowCli()
    const letGo = cli.query.hold()

    vi.useFakeTimers()
    const listing = cli.runtime.listModels({ providerHome: '/tmp/x/home' })
    await vi.advanceTimersByTimeAsync(40_000)
    letGo()
    await vi.advanceTimersByTimeAsync(0)
    expect((await listing).map((model) => model.id)).toEqual(['sonnet'])
  })

  it('B8 · the model list fails at once when the CLI exits, not after the limit', async () => {
    const cli = aSlowCli()
    cli.query.hold()

    const listing = cli.runtime.listModels({ providerHome: '/tmp/x/home' })
    const failed = expect(listing).rejects.toThrow(/exited with code 1/)
    await new Promise((resolve) => setTimeout(resolve, 20))
    cli.die()
    await failed
  })
})
