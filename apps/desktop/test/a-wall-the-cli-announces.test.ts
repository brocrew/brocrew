import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TheCliAnswersInOrder } from '../../../packages/runtime/test/the-cli-answers-in-order'
import { ClaudeRuntime, type RuntimeEvent } from '@brobot2/runtime'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { readProviderLimit } from '../src/shared/provider-limit'

/**
 * 🔴 **695 · F4 — a usage wall is still heard on CLI 2.1.281, and it is heard from the CLI's
 * `rate_limit_event`, not from its notice** (`680` F4).
 *
 * ## ⚑ The question, and the measurement that answers it
 *
 * `680` put a CLI notice's own words on the error event's `message` (R28a/b). For a `rate_limit`
 * notice those words are *"You've hit your session limit · resets 7:55am (…)"*, which
 * {@link readProviderLimit} does not read — and before 680 the same event said
 * `claude is rate-limited`, which it did. ⚠️ So a wall was lost **unless** the CLI sends the other
 * channel too. `probe:claude-limit-notice` asked the bundled CLI against a loopback endpoint and
 * committed the frames as `claude-limit-notice.json`:
 *
 * | arm | the CLI sent | the wall |
 * |---|---|---|
 * | usage-limit (`429`, unified headers, `rejected`) | `rate_limit_event {rejected, five_hour, resetsAt}`, THEN the notice | ⚑ one, windowed, with its reset |
 * | bare-429 (`429`, no unified headers) | `rate_limit_event {rejected}`, THEN *"API Error: Server is temporarily limiting requests (not your usage limit) · …"* | ⚑ one, unwindowed |
 * | warning (`200`, `allowed_warning`) — the control | the reply, then `rate_limit_event {allowed_warning}` | ⚑ one, about to stop |
 *
 * ⚑ **So no wall is lost.** What 680 removed is the SECOND record — the unwindowed
 * `claude is rate-limited` the notice used to add beside the event's own — which is the pair `585`
 * photographed drawing *"one limit comes back in … and another reported no reset time"* about one
 * wall. `readProviderLimit` is therefore not taught the notice's shape (695 §3.1's *"if it is"*).
 *
 * ## ⛔ What a person sees if a later CLI stops sending the event
 *
 * Nothing on Home: the notice alone draws no wall — the hazard control below proves it, with the
 * event deleted from the same frames. The transcript still carries the CLI's own sentence, verbatim.
 * ⚠️ That is a fact about the CLI this test pins by its PREMISE, in two steps: an SDK bump turns
 * the premise red at once (the fixture's CLI is no longer the one the app ships), and re-capturing
 * the fixture with `probe:claude-limit-notice` then says whether the new CLI still sends the event
 * before the notice — before anything reaches a person.
 */

interface Fixture {
  readonly cli: string
  readonly arms: Record<'usage-limit' | 'bare-429' | 'warning', { frames: SDKMessage[] }>
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL('../../../packages/runtime/test/fixtures/claude-limit-notice.json', import.meta.url),
    'utf8',
  ),
) as Fixture

/**
 * ⚑ **The CLI the app SHIPS** — the pinned SDK's own `claudeCodeVersion`, read off its installed
 * `package.json` (the package exports no `./package.json`, so it is found beside the resolved
 * entry). A bump moves this and not the fixture, which is what makes the premise go red.
 */
const SHIPPED_CLI = (() => {
  const require = createRequire(join(__dirname, '..', 'package.json'))
  const entry = require.resolve('@anthropic-ai/claude-agent-sdk')
  const pkg = JSON.parse(readFileSync(join(dirname(entry), 'package.json'), 'utf8')) as {
    claudeCodeVersion?: string
  }
  return pkg.claudeCodeVersion ?? null
})()

/** Replays captured frames through the product adapter, as the SDK would have yielded them. */
class ReplayQuery {
  private readonly buffer: SDKMessage[] = []
  private resolve: ((result: IteratorResult<SDKMessage>) => void) | null = null
  private done = false

  emit(message: SDKMessage): void {
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: message, done: false })
      return
    }
    this.buffer.push(message)
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
    return this.cli.over({
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.resolve = resolve
        })
      },
    })
  }

  /**
   * ⚑ F080: the frames were recorded before the adapter sent its message's uuid, so their `result`
   * names none; the CLI echoes the one it is sent (`claude-provider-bursts.json`), and so does this.
   */
  readonly cli = new TheCliAnswersInOrder()
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function eventsOf(frames: readonly SDKMessage[]): Promise<RuntimeEvent[]> {
  const root = mkdtempSync(join(tmpdir(), 'a-wall-the-cli-announces-'))
  roots.push(root)
  const replay = new ReplayQuery()
  const runtime = new ClaudeRuntime(
    (params) => {
      replay.cli.listen(params.prompt)
      return replay as never
    },
    async () => true,
    () => 'test-token',
  )
  const handle = await runtime.start({ cwd: root, providerHome: join(root, 'home') })
  const events: RuntimeEvent[] = []
  const drained = (async () => {
    for await (const event of handle.events()) events.push(event)
  })()
  await handle.send('695 limit-notice replay')
  for (const frame of frames) replay.emit(frame)
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline && !events.some((one) => one.type === 'turn')) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await handle.close()
  await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, 1_000))])
  return events
}

function errorsOf(events: readonly RuntimeEvent[]): string[] {
  return events.flatMap((one) => (one.type === 'error' ? [one.message] : []))
}

function wallsOf(events: readonly RuntimeEvent[]) {
  return errorsOf(events).flatMap((said) => {
    const wall = readProviderLimit(said, 1_000)
    return wall === null ? [] : [wall]
  })
}

/** The index of the first frame of a kind — to state which channel spoke first. */
function firstIndex(
  frames: readonly SDKMessage[],
  match: (frame: Record<string, unknown>) => boolean,
) {
  return frames.findIndex((frame) => match(frame as unknown as Record<string, unknown>))
}

const isRejectedEvent = (frame: Record<string, unknown>): boolean =>
  frame['type'] === 'rate_limit_event' &&
  (frame['rate_limit_info'] as { status?: string } | undefined)?.status === 'rejected'

const isTheClisNotice = (frame: Record<string, unknown>): boolean =>
  frame['type'] === 'assistant' &&
  (frame['message'] as { model?: string } | undefined)?.model === '<synthetic>' &&
  frame['error'] === 'rate_limit'

describe('695 · F4 — the wall the CLI announces', () => {
  it('premise: the fixture is the CLI the app ships, and every refusal arm sent the event BEFORE the notice', () => {
    // ⚑ Against the INSTALLED SDK's CLI, not a literal: an SDK bump turns this red until
    // `probe:claude-limit-notice` is re-run against the new CLI and the fixture re-captured.
    expect(SHIPPED_CLI).not.toBeNull()
    expect(FIXTURE.cli).toBe(SHIPPED_CLI)
    for (const arm of ['usage-limit', 'bare-429'] as const) {
      const frames = FIXTURE.arms[arm].frames
      const event = firstIndex(frames, isRejectedEvent)
      const notice = firstIndex(frames, isTheClisNotice)
      expect(event, `${arm}: no rejected rate_limit_event`).toBeGreaterThanOrEqual(0)
      expect(notice, `${arm}: no CLI notice`).toBeGreaterThanOrEqual(0)
      expect(event, `${arm}: the notice came first`).toBeLessThan(notice)
    }
  })

  it('usage-limit: ONE wall, windowed and dated — and the CLI’s own sentence is carried beside it, unread', async () => {
    const events = await eventsOf(FIXTURE.arms['usage-limit'].frames)
    const walls = wallsOf(events)
    expect(walls).toHaveLength(1)
    expect(walls[0]).toMatchObject({ provider: 'claude', window: 'five_hour', standing: 'stopped' })
    expect(walls[0]?.resetsAt).not.toBeNull()
    // ⚑ R28b, still true: the notice is on the record in the CLI's words, and it is not a wall.
    const notice = errorsOf(events).find((said) => said.startsWith("You've hit your"))
    expect(notice).toBeDefined()
    expect(readProviderLimit(notice!, 1_000)).toBeNull()
  })

  it('F074 · usage-limit: the turn’s own ending names the limit — Claude’s, its window and its reset', async () => {
    // ⚑ The reset moved an hour ahead, so the frames stay a limit still in force: a remembered
    // reset that has passed names nothing (`ClaudeLimitWatch`).
    const ahead = Math.floor(Date.now() / 1000) + 3_600
    const frames = JSON.parse(
      JSON.stringify(FIXTURE.arms['usage-limit'].frames).replace(
        /"resetsAt":\d+/g,
        `"resetsAt":${ahead}`,
      ),
    ) as SDKMessage[]
    const events = await eventsOf(frames)
    expect(events.find((one) => one.type === 'turn')).toMatchObject({
      type: 'turn',
      state: 'failed',
      limit: { provider: 'claude', window: 'five_hour', resetsAt: ahead * 1000 },
    })
    // ⛔ …and the bare 429, *"not your usage limit"*, ends failed with none.
    const bare = await eventsOf(FIXTURE.arms['bare-429'].frames)
    expect(bare.find((one) => one.type === 'turn')).toEqual({ type: 'turn', state: 'failed' })
  })

  it('bare-429: ONE wall, with no window and no reset — nothing invented', async () => {
    const walls = wallsOf(await eventsOf(FIXTURE.arms['bare-429'].frames))
    expect(walls).toHaveLength(1)
    expect(walls[0]).toMatchObject({ provider: 'claude', window: '', standing: 'stopped' })
    expect(walls[0]?.resetsAt).toBeNull()
  })

  it('control — warning: the channel speaks when nothing is refused, and says so', async () => {
    const walls = wallsOf(await eventsOf(FIXTURE.arms.warning.frames))
    expect(walls).toHaveLength(1)
    expect(walls[0]).toMatchObject({
      provider: 'claude',
      window: 'five_hour',
      standing: 'about-to-stop',
    })
  })

  it('hazard: the SAME frames without the event draw no wall at all — the notice alone is not heard', async () => {
    const frames = FIXTURE.arms['usage-limit'].frames.filter(
      (frame) => !isRejectedEvent(frame as unknown as Record<string, unknown>),
    )
    expect(frames.length).toBe(FIXTURE.arms['usage-limit'].frames.length - 1)
    const events = await eventsOf(frames)
    expect(errorsOf(events).some((said) => said.startsWith("You've hit your"))).toBe(true)
    expect(wallsOf(events)).toEqual([])
  })
})
