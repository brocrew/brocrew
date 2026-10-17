import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent, SessionRef } from '../src/index'
import { FakeRuntime } from '../src/fake-runtime'
import { claudeResultOutcome } from '../src/claude/normalize'
import { SessionMachine } from '../src/internal/session-machine'

/**
 * # 🔴 709 · R43 — the ledger records the provider's word
 *
 * ⚑ **The ruling, verbatim** (`704` H-3): *"A turn the provider completed is recorded `completed`,
 * even when an interrupt was asked; the ask is recorded beside it (`work_interrupted` already is). A
 * turn is `interrupted` only when the provider says it was."*
 *
 * ⛔ **What it replaces.** `SessionMachine.completeTurn` renamed ANY provider outcome `interrupted`
 * once an interrupt had been asked — so `probe:codex-early-interrupt`, on `main`'s adapter before
 * `704`, recorded four turns Codex COMPLETED as `interrupted`, and a `smoke:ui` step passed on a
 * count Codex ran to sixty.
 *
 * | § | what | the provider's word |
 * |---|---|---|
 * | 1 | the machine | whatever `completeTurn` is handed, whatever was asked |
 * | 2 | Claude's `result` | `terminal_reason: aborted_streaming` / `aborted_tools` — measured on CLI 2.1.281 |
 * | 3 | the Fake | a double of a provider, so it ends a turn it was told to stop in its own word |
 *
 * ⚠️ The adapters' own arms are beside the tests this re-aimed: `codex-runtime.test.ts` (an early
 * interrupt, the discriminator, IN KIND) and `claude-runtime.test.ts` (a Cancel).
 */

const here = dirname(fileURLToPath(import.meta.url))

/** ⚑ The four `result` frames the bundled CLI wrote — measured, verbatim, provenance inside. */
const MEASURED = JSON.parse(
  readFileSync(join(here, 'fixtures/claude-stopped-results.json'), 'utf8'),
) as Record<'finishes' | 'cancelledCard' | 'stoppedStreaming' | 'stoppedInTool', SDKMessage>

const REF: SessionRef = { provider: 'claude', sessionId: 'sess_1', cwd: '/tmp/x', rotation: 0 }

/** An active session with a turn open — the state every machine arm below starts from. */
function aTurnIsOpen(): { m: SessionMachine; events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = []
  const m = new SessionMachine((event) => events.push(event))
  m.markStarting()
  m.sessionStarted(REF, 'started')
  m.beginTurn()
  return { m, events }
}

/** The machine's own terminal words, in order. */
const endings = (events: readonly RuntimeEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'turn' ? [event.state] : []))

describe('709 · R43 §1 — the machine records the provider’s word, whatever was asked', () => {
  it('🔴 a turn the provider COMPLETED after an interrupt was asked is `completed`', () => {
    const { m, events } = aTurnIsOpen()
    m.requestInterrupt()
    m.completeTurn('completed')
    // ⛔ **On `main` this read `['interrupted']`** — the relabel, over the provider's own word.
    expect(endings(events)).toEqual(['completed'])
    expect(events.some((event) => event.type === 'error')).toBe(false)
  })

  it('🔴 a turn the provider FAILED after an interrupt was asked is `failed`, with its reason', () => {
    const { m, events } = aTurnIsOpen()
    m.requestInterrupt()
    m.completeTurn('failed', 'turn failed: boom')
    // ⛔ **On `main` the relabel also DROPPED the provider's reason** — the `failed` arm tested the
    // renamed word, so no `error` was emitted and the fault was recorded as a stop.
    expect(endings(events)).toEqual(['failed'])
    expect(events.filter((event) => event.type === 'error')).toEqual([
      { type: 'error', message: 'turn failed: boom', fatal: false },
    ])
  })

  it('⚑ CONTROL · a turn the provider says it INTERRUPTED is `interrupted`', () => {
    const { m, events } = aTurnIsOpen()
    m.requestInterrupt()
    m.completeTurn('interrupted')
    expect(endings(events)).toEqual(['interrupted'])
  })

  it('⚑ CONTROL · …and one nobody asked about keeps its word too', () => {
    const { m, events } = aTurnIsOpen()
    m.completeTurn('completed')
    expect(endings(events)).toEqual(['completed'])
  })

  it('⚠️ the endings the machine writes ITSELF still say `interrupted` — no provider has spoken', () => {
    // ⚑ `forceEnd` is `074`'s Stop: the composer comes back before the provider answers, and the
    // provider's later terminal is absorbed. R43 is about the provider's word; where there is none
    // yet, the word is this machine's — and it is written only after an ask.
    const { m, events } = aTurnIsOpen()
    m.requestInterrupt()
    m.forceEnd()
    expect(endings(events)).toEqual(['interrupted'])
  })
})

describe('709 · R43 §2 — Claude’s own word for a stopped turn (CLI 2.1.281, measured)', () => {
  it('🔴 a turn stopped mid-stream closes with `aborted_streaming` — `interrupted`', () => {
    expect(MEASURED.stoppedStreaming).toMatchObject({
      subtype: 'error_during_execution',
      terminal_reason: 'aborted_streaming',
    })
    // ⛔ **On `main` this was `failed`** — and only the relabel stood between it and the ledger.
    expect(claudeResultOutcome(MEASURED.stoppedStreaming)).toEqual({ outcome: 'interrupted' })
  })

  it('🔴 a turn stopped inside a tool closes with `aborted_tools` — `interrupted`', () => {
    expect(MEASURED.stoppedInTool).toMatchObject({ terminal_reason: 'aborted_tools' })
    expect(claudeResultOutcome(MEASURED.stoppedInTool)).toEqual({ outcome: 'interrupted' })
  })

  it('🔴 a card CANCELLED (`interrupt: true`) closes with `aborted_tools` — `interrupted`, not a fault', () => {
    expect(MEASURED.cancelledCard).toMatchObject({
      subtype: 'error_during_execution',
      terminal_reason: 'aborted_tools',
    })
    expect(claudeResultOutcome(MEASURED.cancelledCard)).toEqual({ outcome: 'interrupted' })
  })

  it('⚑ CONTROL · a turn that finished closes `success` / `completed` — `completed`', () => {
    expect(MEASURED.finishes).toMatchObject({ subtype: 'success', terminal_reason: 'completed' })
    expect(claudeResultOutcome(MEASURED.finishes)).toEqual({ outcome: 'completed' })
  })

  it('⛔ CONTROL · `error_during_execution` WITHOUT an aborted reason is still a fault', () => {
    // ⚑ **One fact apart from the stopped arms** — the reason removed. The subtype is shared with
    // real execution errors and startup failures (`sdk.d.ts`), which is why the reason is read.
    const aFault = Object.fromEntries(
      Object.entries(MEASURED.stoppedStreaming).filter(([key]) => key !== 'terminal_reason'),
    )
    expect(claudeResultOutcome(aFault as SDKMessage)).toMatchObject({ outcome: 'failed' })
    expect(
      claudeResultOutcome({ ...aFault, terminal_reason: 'model_error' } as SDKMessage),
    ).toMatchObject({ outcome: 'failed' })
  })
})

describe('709 · R43 §3 — the Fake is a provider, so it says what it did', () => {
  it('⚑ a turn the Fake is told to stop with a card open ends `interrupted` in the Fake’s own word', async () => {
    const handle = await new FakeRuntime('claude').start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    await handle.send('go')
    await vi.waitFor(() => expect(events.some((e) => e.type === 'permission_request')).toBe(true))
    await handle.interrupt()
    await vi.waitFor(() => expect(endings(events)).toEqual(['interrupted']))
    await handle.close()
    await consumer
  })
})
