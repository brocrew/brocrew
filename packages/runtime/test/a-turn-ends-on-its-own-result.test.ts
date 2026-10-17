import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeRuntime, type QueryFactory } from '../src/claude/claude-runtime'
import type { RuntimeEvent } from '../src/events'

/**
 * # 🔴 F080 — a turn ends on its OWN result, and a burst the provider starts is a turn
 *
 * ⚑ The frames are the bundled CLI's own (`probe:claude-provider-burst`, scripted loopback model,
 * fake token), replayed through the product adapter:
 *
 *  - §1 · **A · wake** — a background `sleep` ends after the turn; the CLI wakes the agent itself.
 *  - §2 · **B · resume after a restart stopped background work** — the CLI first ends an EMPTY loop
 *    of its own for the stopped task's notice (`num_turns: 0`, no uuid), then answers our message.
 *    That empty result used to end our turn before the model ran (F080, three times in the ledgers).
 *  - §3 · a person's local command (`/cost`), a person's and an agent's message (`origin`), and a
 *    turn the usage limit refused: ours, ended. (`/compact` and `/clear`, each a second turn in one
 *    life, are asserted by the probe itself, through the product adapter on the bundled CLI.)
 *
 * ⚑ The fixture writes the uuid this app sent as `<sent>`; the replay puts in the uuid the adapter
 * really sent, read off the message it pushed.
 */

interface Fixture {
  readonly cli: string
  readonly arms: Record<string, { readonly lives: { readonly frames: SDKMessage[] }[] }>
}

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/claude-provider-bursts.json', import.meta.url), 'utf8'),
) as Fixture

/** ⚑ The CLI the app ships — the pinned SDK's own `claudeCodeVersion`. */
const SHIPPED_CLI = (() => {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('@anthropic-ai/claude-agent-sdk')
  const pkg = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
    claudeCodeVersion?: string
  }
  return pkg.claudeCodeVersion ?? null
})()

/** Replays frames as the SDK would yield them, and hands back what the adapter pushed. */
class ReplayQuery {
  private readonly buffer: SDKMessage[] = []
  private resolve: ((result: IteratorResult<SDKMessage>) => void) | null = null
  private done = false
  prompt: AsyncIterator<SDKUserMessage> | null = null

  emit(message: SDKMessage): void {
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: message, done: false })
      return
    }
    this.buffer.push(message)
  }

  /** ⚑ Every frame was read, and the adapter is waiting for the next. */
  get drained(): boolean {
    return this.buffer.length === 0 && this.resolve !== null
  }

  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.done = true
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: undefined as never, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.resolve = resolve
        })
      },
    }
  }
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One life of an arm, replayed after the adapter sends `words`; the events it emitted. */
async function replay(arm: string, life: number, words: string): Promise<RuntimeEvent[]> {
  const frames = FIXTURE.arms[arm]?.lives[life]?.frames
  if (frames === undefined) throw new Error(`no frames for ${arm} life ${String(life)}`)
  const root = mkdtempSync(join(tmpdir(), 'f080-replay-'))
  roots.push(root)
  const query = new ReplayQuery()
  const factory: QueryFactory = (params) => {
    query.prompt = params.prompt[Symbol.asyncIterator]()
    return query as never
  }
  const runtime = new ClaudeRuntime(
    factory,
    async () => true,
    () => 'test-token',
  )
  const handle = await runtime.start({ cwd: root, providerHome: join(root, 'home') })
  const events: RuntimeEvent[] = []
  const drained = (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  await handle.send(words)
  const pushed = await query.prompt!.next()
  const sent = (pushed.value as { uuid?: string }).uuid
  expect(sent, 'the message the adapter sent carries a uuid').toMatch(/^[0-9a-f-]{36}$/)
  // ⚑ Every reset moved an hour ahead, so a limit stays in force: a remembered reset that has
  // passed names nothing (`ClaudeLimitWatch`).
  const ahead = Math.floor(Date.now() / 1000) + 3_600
  for (const frame of JSON.parse(
    JSON.stringify(frames)
      .replaceAll('<sent>', sent!)
      .replace(/"resetsAt":\d+/g, `"resetsAt":${String(ahead)}`),
  ) as SDKMessage[]) {
    query.emit(frame)
  }
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline && !query.drained) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await new Promise((resolve) => setTimeout(resolve, 20))
  await handle.close()
  await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, 1_000))])
  return events
}

const turnsOf = (events: readonly RuntimeEvent[]) =>
  events.flatMap((one, at) => (one.type === 'turn' ? [{ at, turn: one }] : []))

describe('F080 · a turn ends on its own result, and a burst the provider starts is a turn', () => {
  it('premise: the fixture is the CLI the app ships', () => {
    // ⚑ An SDK bump turns this red until `probe:claude-provider-burst` re-measures the new CLI.
    expect(SHIPPED_CLI).not.toBeNull()
    expect(FIXTURE.cli).toBe(SHIPPED_CLI)
  })

  it('§1 · A · our turn ends on our result, and the wake is a turn the provider started, ended by its own', async () => {
    const events = await replay('A-wake', 0, 'F080 probe A: background a short sleep, then stop')
    const turns = turnsOf(events)
    expect(turns.map(({ turn }) => [turn.state, turn.startedBy ?? 'a-message'])).toEqual([
      ['completed', 'a-message'],
      ['completed', 'the-provider'],
    ])
    // ⚑ The provider's turn opens BEFORE its words, so they land in it, and after ours ended.
    const began = events.findIndex((one) => one.type === 'provider_turn')
    expect(began).toBeGreaterThan(turns[0]!.at)
    const words = events.findIndex((one, at) => at > began && one.type === 'assistant_message')
    expect(words).toBeGreaterThan(began)
    expect(words).toBeLessThan(turns[1]!.at)
    expect(events.filter((one) => one.type === 'provider_turn')).toHaveLength(1)
  })

  it('§2 · B · resumed after a restart stopped background work: ONE turn, ended after the answer — never on the CLI’s empty loop', async () => {
    const events = await replay(
      'B-resume-after-stop',
      1,
      'F080 probe notice: the app restarted and stopped your background work',
    )
    const turns = turnsOf(events)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.turn).toMatchObject({ type: 'turn', state: 'completed' })
    expect(turns[0]!.turn.startedBy).toBeUndefined()
    const answer = events.findIndex((one) => one.type === 'assistant_message')
    expect(answer).toBeGreaterThan(-1)
    expect(answer).toBeLessThan(turns[0]!.at)
    // ⛔ No provider turn: the answer is our turn's own.
    expect(events.some((one) => one.type === 'provider_turn')).toBe(false)
    // ⚑ And the conversation never read idle between the empty loop and the answer.
    const firstIdle = events.findIndex((one) => one.type === 'status' && one.state === 'idle')
    expect(firstIdle).toBeGreaterThan(answer)
  })

  it('§2 · the control — a resume with nothing stopped ends its one turn after the answer, as it always did', async () => {
    const events = await replay('C-resume-control', 1, 'F080 probe notice: control')
    const turns = turnsOf(events)
    expect(turns).toHaveLength(1)
    expect(events.findIndex((one) => one.type === 'assistant_message')).toBeLessThan(turns[0]!.at)
  })

  it('§3 · a person’s local command (no model, `num_turns: 0`) is still the turn’s own result', async () => {
    const turns = turnsOf(await replay('D-local-command', 0, '/cost'))
    expect(turns.map(({ turn }) => turn.state)).toEqual(['completed'])
  })

  it('§3 · a person’s message and an agent’s, with the `origin` this app sends, end on their own results', async () => {
    for (const arm of ['F-person', 'G-peer']) {
      const events = await replay(arm, 0, `F080 replay ${arm}`)
      expect(
        turnsOf(events).map(({ turn }) => turn.state),
        arm,
      ).toEqual(['completed'])
      expect(
        events.some((one) => one.type === 'provider_turn'),
        arm,
      ).toBe(false)
    }
  })

  it('§3 · a turn the usage limit refused is ours, and fails with its limit (F074)', async () => {
    const turns = turnsOf(await replay('E-usage-limit', 0, 'F080 probe C: say ok'))
    expect(turns).toHaveLength(1)
    expect(turns[0]!.turn).toMatchObject({
      state: 'failed',
      limit: { provider: 'claude', window: 'five_hour' },
    })
  })
})
