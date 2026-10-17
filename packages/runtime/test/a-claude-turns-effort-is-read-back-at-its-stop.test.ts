import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ClaudeRuntime,
  type ClaudeQuery,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * # The effort a Claude turn ran at, read back from its `Stop` hook and kept across the next `init`
 *
 * Claude states the effort a turn ran at only on the hooks it fires within that turn — the `Stop`
 * hook's `effort.level`. The adapter reports it as the provider's word, and keeps it across the
 * next turn's `system/init` (which names a model and no effort) while the model and the effort
 * asked for are still the ones that turn ran with. No test reaches any of it:
 *
 *  - 🔴 a `Stop` naming a level, after an `init` named the model, is reported as that level,
 *    marked reported; before any model it has nothing to belong to and reports nothing.
 *  - ⛔ a `Stop` with no effort, an empty one, or an empty level changes nothing and does not
 *    throw — the hook still answers `continue`.
 *  - 🔴 the next `init` for the same model and the same ask keeps the reported level; a new ask
 *    is shown as the request again, and another model is not given the old report.
 *
 * Driven through the real `Options.hooks.Stop` callback and a scripted SDK query, as the scheduled
 * level's adapter tests are; each `init` carries a fresh tool list so the tool inventory it
 * publishes marks the moment that frame was read.
 */

/** The `system:init` frame, in the shape the adapter reads it. */
const init = (sessionId: string, cwd: string): Record<string, unknown> => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  cwd,
})

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  /** Every flag-settings payload, so a moved effort can be seen to have reached the SDK. */
  readonly flagSettings: Record<string, unknown>[] = []
  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  async applyFlagSettings(settings: {
    effortLevel?: string | null
    permissions?: unknown
  }): Promise<void> {
    this.flagSettings.push(settings)
  }
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

describe('a Claude turn’s effort, read back at its Stop', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  async function started(): Promise<{
    root: string
    fq: FakeQuery
    handle: SessionHandle
    options: Options
    events: RuntimeEvent[]
    done: () => Promise<void>
  }> {
    const root = mkdtempSync(join(tmpdir(), 'claude-effort-read-back-'))
    roots.push(root)
    const fq = new FakeQuery()
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: root, providerHome: join(root, 'home') })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    fq.emit(init('s1', root))
    await vi.waitFor(() => expect(events.some((e) => e.type === 'session')).toBe(true))
    if (!captured) throw new Error('query factory never called')
    const done = async (): Promise<void> => {
      fq.end()
      await handle.close()
      await Promise.race([consumer, new Promise((resolve) => setTimeout(resolve, 1_000))])
    }
    return { root, fq, handle, options: captured, events, done }
  }

  /** The real `Stop` hook, fed a `Stop` input with whatever else `extra` names. */
  const stop = async (options: Options, extra: Record<string, unknown>): Promise<unknown> => {
    const hook = options.hooks?.Stop?.[0]?.hooks?.[0]
    if (hook === undefined) throw new Error('the Stop hook must be installed in every session')
    return hook(
      { hook_event_name: 'Stop', stop_hook_active: false, ...extra } as never,
      undefined,
      { signal: new AbortController().signal },
    )
  }

  const inventories = (events: readonly RuntimeEvent[]): number =>
    events.filter((e) => e.type === 'tool_inventory').length

  it('🔴 a Stop’s level is reported for the model the last init named, and kept across the next init while the model and the ask stand — ⛔ a Stop with none changes nothing', async () => {
    const { root, fq, handle, options, events, done } = await started()
    let inits = 0
    /** An `init` naming `model`, read once its tool inventory is out. */
    const anInitFor = async (model: string): Promise<void> => {
      inits += 1
      fq.emit({ ...init('s1', root), model, tools: [`tool_${String(inits)}`] })
      await vi.waitFor(() => expect(inventories(events)).toBe(inits))
    }

    // ⛔ Before any init named a model, a level has nothing to belong to.
    await stop(options, { effort: { level: 'high' } })
    expect(handle.agentInfo).toBeUndefined()

    await anInitFor('m')
    // ⚑ Nothing asked, nothing reported yet: the model alone.
    expect(handle.agentInfo).toEqual({ model: 'm' })

    // 🔴 The Stop's level, as the provider's word.
    await stop(options, { effort: { level: 'high' } })
    const reported = { model: 'm', reasoningEffort: 'high', reasoningEffortReported: true }
    expect(handle.agentInfo).toEqual(reported)

    // ⛔ A Stop naming no level, or an empty one, is no report — and the hook still answers.
    expect(await stop(options, {})).toEqual({ continue: true })
    expect(handle.agentInfo).toEqual(reported)
    expect(await stop(options, { effort: {} })).toEqual({ continue: true })
    expect(handle.agentInfo).toEqual(reported)
    expect(await stop(options, { effort: { level: '' } })).toEqual({ continue: true })
    expect(handle.agentInfo).toEqual(reported)

    // 🔴 The next turn's init — same model, same ask — keeps it.
    await anInitFor('m')
    expect(handle.agentInfo).toEqual(reported)

    // ⛔ A new ask, handed over with the next turn: the next init shows the request, not the report.
    await handle.setReasoningEffort('low')
    await handle.send('go')
    expect(fq.flagSettings.some((one) => one['effortLevel'] === 'low')).toBe(true)
    await anInitFor('m')
    expect(handle.agentInfo).toEqual({
      model: 'm',
      reasoningEffort: 'low',
      reasoningEffortReported: false,
    })

    // ⚑ That turn's own Stop reports again, and its next init keeps that…
    await stop(options, { effort: { level: 'medium' } })
    const again = { model: 'm', reasoningEffort: 'medium', reasoningEffortReported: true }
    expect(handle.agentInfo).toEqual(again)
    await anInitFor('m')
    expect(handle.agentInfo).toEqual(again)

    // ⛔ …but another model is not given it: the request is shown for it.
    await anInitFor('other')
    expect(handle.agentInfo).toEqual({
      model: 'other',
      reasoningEffort: 'low',
      reasoningEffortReported: false,
    })
    await done()
  })
})
