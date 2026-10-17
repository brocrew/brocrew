import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { AsyncQueue } from '../src/internal/async-queue'
import {
  ClaudeRuntime,
  PROVIDER_COMMAND_PREFIX,
  type ClaudeQuery,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'

/**
 * 🔴 **708 · the Claude adapter's half of `R42`'s ask** — *"where the provider has not published its
 * list yet, ask for it (bounded)"* — `ClaudeSessionHandle.providerCommands`.
 *
 * ⚑ **`supportedCommands()` and not the handshake**: the SDK says it *"tracks the latest push"*,
 * so a list that changed mid-session is the one the host decides against. ⚑ **And what it answers
 * is PUBLISHED**, so the palette and the host that asked read one list.
 */

/** A query that answers the ask with `commands`, or cannot say when `commands` is `undefined`. */
class AskableQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  asked = 0
  constructor(private readonly commands?: readonly unknown[]) {
    if (commands !== undefined) {
      this.supportedCommands = async () => {
        this.asked += 1
        return this.commands ?? []
      }
    }
  }
  supportedCommands?: () => Promise<readonly unknown[]>
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

async function opened(query: AskableQuery): Promise<SessionHandle> {
  const runtime = new ClaudeRuntime(
    () => query,
    async () => true,
  )
  return await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
}

/** Everything the handle has emitted so far, without waiting for more. */
async function drained(handle: SessionHandle, until: (seen: RuntimeEvent[]) => boolean) {
  const seen: RuntimeEvent[] = []
  const iterator = handle.events()[Symbol.asyncIterator]()
  for (let step = 0; step < 50 && !until(seen); step += 1) {
    const next = await Promise.race([
      iterator.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
    ])
    if (next === null || next.done === true) break
    seen.push(next.value)
  }
  return seen
}

describe('708 · the Claude adapter answers an ask for its commands', () => {
  it('⚑ answers with the list, the `/` prefix, and PUBLISHES what it answered', async () => {
    const query = new AskableQuery([
      { name: 'compact', description: 'Free up context', argumentHint: '' },
      { name: 'clear', description: 'Start over', aliases: ['reset'] },
    ])
    const handle = await opened(query)
    try {
      const heard = await handle.providerCommands?.()
      expect(heard?.prefix).toBe(PROVIDER_COMMAND_PREFIX.claude)
      expect(heard?.commands.map((one) => one.name)).toEqual(['compact', 'clear'])
      expect(heard?.commands[1]?.aliases).toEqual(['reset'])
      expect(query.asked).toBe(1)
      const seen = await drained(handle, (events) =>
        events.some((event) => event.type === 'provider_commands'),
      )
      const published = seen.find((event) => event.type === 'provider_commands')
      expect(published).toMatchObject({
        type: 'provider_commands',
        prefix: '/',
        source: 'supportedCommands',
      })
      expect(
        published?.type === 'provider_commands' ? published.commands.map((one) => one.name) : [],
      ).toEqual(['compact', 'clear'])
    } finally {
      query.close()
      await handle.close()
    }
  })

  it('⛔ a query that cannot say REJECTS — and publishes nothing, never an empty list', async () => {
    const query = new AskableQuery()
    const handle = await opened(query)
    try {
      await expect(handle.providerCommands?.()).rejects.toThrow('cannot say')
      const seen = await drained(handle, () => false)
      expect(seen.some((event) => event.type === 'provider_commands')).toBe(false)
    } finally {
      query.close()
      await handle.close()
    }
  })

  it('⚑ the prefix table answers without any list — `/` for Claude, `$` for Codex (279)', () => {
    expect(PROVIDER_COMMAND_PREFIX).toEqual({ claude: '/', codex: '$' })
  })
})
