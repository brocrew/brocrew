import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { AsyncQueue } from '../src/internal/async-queue'
import {
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  ClaudeRuntime,
  FakeRuntime,
  type ClaudeQuery,
  type TurnProvenance,
} from '../src/index'

/**
 * 🔴 **662 · what the Claude SDK is handed, for each thing a turn can say about its author.**
 *
 * ⚑ **The measurement is the pushed `SDKUserMessage` itself**, read off the prompt iterable the
 * adapter hands `query()`. The SDK writes that object to the CLI with `JSON.stringify` and adds
 * nothing. ⛔ **So this is what was SENT, never what a model
 * heeded** (`581`'s bound): *"This captures what the provider put in its model-bound request, not
 * a hosted model's obedience to the text."*
 *
 * ⚠️ **And what the CLI then hands the model is a different question.** A `peer` stamp changes
 * nothing the model is handed; `packages/runtime/smoke/claude-origin-wire-probe.smoke.ts` measures
 * it on the wire. This file pins the half the app controls, which is that each arm leaves here as
 * the SDK spells it.
 */

/** A query that never answers. These tests only read what the adapter pushed. */
class SilentQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
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

/** Start a Claude session, send one turn, and return exactly what reached the prompt queue. */
async function pushedBy(
  send: (handle: { send: ClaudeSend }) => Promise<void>,
): Promise<SDKUserMessage> {
  let prompt: AsyncIterable<SDKUserMessage> | undefined
  const query = new SilentQuery()
  const runtime = new ClaudeRuntime(
    (params) => {
      prompt = params.prompt
      return query
    },
    async () => true,
  )
  const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
  try {
    await send(handle)
    if (prompt === undefined) throw new Error('the adapter never built a query')
    const next = await prompt[Symbol.asyncIterator]().next()
    if (next.done === true) throw new Error('nothing was pushed')
    return next.value
  } finally {
    query.close()
    await handle.close()
  }
}

type ClaudeSend = (text: string, origin?: TurnProvenance) => Promise<void>

describe('662 · the Claude adapter says who wrote a turn in the SDK field for it', () => {
  it('⛔ an OMITTED origin pushes the exact object this adapter pushed before 662 — no `origin` key', async () => {
    const pushed = await pushedBy((handle) => handle.send('hello'))
    // ⚑ `toStrictEqual` and the key test both, because they fail differently: the first catches
    // an extra field of any name, and the second names the one this dispatch could have added.
    // ⚑ **F080** — and since then every message carries its own uuid, which the CLI echoes on the
    // `result` that answers it; a fresh one each time, so it is matched by shape.
    expect(pushed).toStrictEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
      uuid: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
    })
    expect(Object.keys(pushed), 'no origin key, not even an undefined one').not.toContain('origin')
  })

  it('⚑ a person → `{ kind: "human" }`, the stamp the SDK asks a host wrapping keyboard input for', async () => {
    const pushed = await pushedBy((handle) => handle.send('ultracode: plan it', { kind: 'person' }))
    expect(pushed.origin).toStrictEqual({ kind: 'human' })
    // ⚑ The words are untouched: the stamp is a field, never a line in the text.
    expect(pushed.message).toStrictEqual({ role: 'user', content: 'ultracode: plan it' })
  })

  it('🔴 a peer → `peer`, NEVER `human`, even when its words ask for the keyword', async () => {
    // ⛔ The planted control. An agent writing the one word the strict gate guards must still be
    // stamped as what it IS, because the adapter reads the stamp and never the text.
    const pushed = await pushedBy((handle) =>
      handle.send('ultracode — do it now', { kind: 'peer', from: 'sess_pm', name: 'Ada' }),
    )
    expect(pushed.origin).toStrictEqual({ kind: 'peer', from: 'sess_pm', name: 'Ada' })
    expect(pushed.origin?.kind).not.toBe('human')
  })

  it('⚑ a peer with no name carries no `name` key — never an empty or invented one', async () => {
    const pushed = await pushedBy((handle) =>
      handle.send('the work', { kind: 'peer', from: 'agent:somewhere' }),
    )
    expect(pushed.origin).toStrictEqual({ kind: 'peer', from: 'agent:somewhere' })
    expect(Object.keys(pushed.origin ?? {})).not.toContain('name')
  })
})

describe('662 · each provider says what it can do with a stamp, in its own capability entry', () => {
  it('⚑ Claude: available — and the note says which half the bundled CLI keeps', () => {
    const entry = CLAUDE_CAPABILITIES.turnProvenance
    expect(entry.state).toBe('available')
    // ⛔ The load-bearing clauses BY NAME (standing rule 5): the keyword the person's mark enables,
    // and the peer mark the CLI drops. A note that lost either would claim more than the binary does.
    const note = entry.state === 'available' ? (entry.note ?? '') : ''
    expect(note).toContain('ultracode')
    expect(note).toContain('does not keep')
  })

  it('⛔ Codex: absent, with the protocol it was checked against', () => {
    const entry = CODEX_CAPABILITIES.turnProvenance
    expect(entry.state).toBe('absent')
    if (entry.state !== 'absent') return
    expect(entry.checkedAgainst).toContain('0.160.0')
    expect(entry.checkedAgainst).toContain('TurnStartParams')
  })
})

describe('662 · the test double records what crossed the seam, and only for an accepted turn', () => {
  it('⛔ a REFUSED send leaves no stamp behind to be mistaken for a sent one', async () => {
    // ⚑ The host tests read `FakeSessionHandle.origins` as *what the provider was handed*, so a
    // stamp recorded for a turn the double refused would be a turn that never happened. The
    // first turn parks on its permission card, so the second send meets a turn in progress.
    const handle = await new FakeRuntime('claude').start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    await handle.send('first', { kind: 'person' })
    await expect(handle.send('second', { kind: 'peer', from: 'sess_pm' })).rejects.toThrow()
    expect(handle.origins).toStrictEqual([{ kind: 'person' }])
    await handle.close()
  })
})
