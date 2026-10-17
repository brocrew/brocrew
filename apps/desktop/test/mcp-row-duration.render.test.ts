import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { RuntimeEvent } from '@brobot2/runtime'
import ToolEntry from '../src/renderer/src/components/ToolEntry.vue'
import {
  applyEvent,
  createTranscript,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'

/**
 * # ⚑ One duration on the row, and it is the provider's when the provider sent one (327 §2.1)
 *
 * ⛔ **The row already had a duration, and that is exactly the hazard.** `ToolEntry.took` subtracts
 * two `RuntimeHost` delivery stamps, so it measures the call plus JSON-RPC framing plus the host's
 * event pump. A `durationMs` added beside it would be a SECOND derivation of one number — `064`/`099`
 * — so it replaces rather than joins, and these tests are about which one wins where.
 *
 * ⚠️ **SSR, so every negative is paired with a positive out of the same html** — a suite that only
 * asserted *"200 ms is not on screen"* would pass just as happily over a component that rendered
 * nothing at all (`brobot2-ssr-tests-pass-vacuously`).
 *
 * ⚠️ **The two stamps are deliberately 200 ms apart in every fixture below**, so "the provider's
 * number won" and "the subtraction won" can never be the same string.
 */

const CALL = 'exec-e51aeef9-c5dc-4383-884f-c0769209aa8d'
const HOST_SPAN = 200

/** Fold a call and its result with DISTINCT host stamps, so the two derivations differ. */
function foldOf(call: RuntimeEvent, result: RuntimeEvent): ToolItem {
  const state: TranscriptState = createTranscript()
  applyEvent(state, call, 1_000)
  applyEvent(state, result, 1_000 + HOST_SPAN)
  const found = state.items.find((item): item is ToolItem => item.kind === 'tool')
  expect(found, 'the tool row this test is about').toBeDefined()
  return found as ToolItem
}

const mcpCall = (): RuntimeEvent => ({
  type: 'tool_call',
  id: CALL,
  name: 'mcp__brobot_327_wire__echo_probe',
  summary: '{"token":"WIRE327"}',
})

const mcpResult = (
  over: Partial<Extract<RuntimeEvent, { type: 'tool_result' }>> = {},
): RuntimeEvent => ({
  type: 'tool_result',
  id: CALL,
  summary: 'BROBOT_327_MCP_OK',
  ok: true,
  ...over,
})

async function render(item: ToolItem): Promise<string> {
  return renderToString(createSSRApp(ToolEntry, { item }))
}

describe('327 · the provider’s duration is the one the row shows', () => {
  it('⛔ shows the measured 4 ms, not the 200 ms the host clock spans', async () => {
    const html = await render(foldOf(mcpCall(), mcpResult({ durationMs: 4 })))
    expect(html).toContain('4 ms')
    // ⚑ The paired negative: the subtraction's answer is NOT also on the row.
    expect(html, 'one duration, not two').not.toContain(`${HOST_SPAN} ms`)
    // …and the positives that prove the component rendered at all.
    expect(html).toContain('mcp__brobot_327_wire__echo_probe')
    expect(html).toContain('data-cy="tool-took"')
  })

  it('⚑ falls back to the subtraction when the provider said nothing — Claude’s every row', async () => {
    const html = await render(foldOf(mcpCall(), mcpResult()))
    expect(html).toContain(`${HOST_SPAN} ms`)
    expect(html).toContain('data-cy="tool-took"')
    // The negative beside it: nothing was invented in place of the number that was not sent.
    expect(html).not.toContain('4 ms')
  })

  it('🔴 a measured `0` renders as `0 ms`, not as no duration at all', async () => {
    // The failing arm of `327`'s capture really did report `durationMs: 0`. A truthiness test
    // anywhere on this path — the normalizer, the fold, or `took` — makes this row silent.
    const html = await render(foldOf(mcpCall(), mcpResult({ ok: false, durationMs: 0 })))
    expect(html).toContain('0 ms')
    expect(html).toContain('data-cy="tool-took"')
    expect(html, 'the host span must not stand in for it').not.toContain(`${HOST_SPAN} ms`)
  })

  it('⚠️ a duration larger than a second is spoken in seconds, like every other one', async () => {
    // The measured timeout was 4 002 ms. The formatting is the row's existing one, not a new one.
    const html = await render(foldOf(mcpCall(), mcpResult({ ok: false, durationMs: 4002 })))
    expect(html).toContain('4.0 s')
    expect(html).not.toContain('4002 ms')
  })
})

describe('327 · 248’s rule survives — detached work still waits for its ending', () => {
  it('⛔ a still-running detached call prints NO duration, provider number or not', async () => {
    const item = foldOf(
      mcpCall(),
      mcpResult({ backgrounded: true, backgroundId: 'b1', durationMs: 4 }),
    )
    expect(item.background, 'the fixture really is detached').toBeDefined()
    const html = await render(item)
    // ⛔ `247` measured the receipt at 6 102 ms for work that ran to 36 150 ms. Printing the
    // provider's 4 ms here would put a completion time beside "still running" — the exact lie the
    // branch exists to stop, in a smaller font.
    expect(html).not.toContain('4 ms')
    expect(html).not.toContain('data-cy="tool-took"')
    // ⚑ The paired positive out of the same html: the row DID render, and it says it detached.
    expect(html).toContain('data-cy="tool-background"')
    expect(html).toContain('mcp__brobot_327_wire__echo_probe')
  })

  it('⚑ …and once it ends, the ending’s span is what is spoken', async () => {
    const state: TranscriptState = createTranscript()
    applyEvent(state, mcpCall(), 1_000)
    applyEvent(state, mcpResult({ backgrounded: true, backgroundId: 'b1', durationMs: 4 }), 1_200)
    applyEvent(
      state,
      {
        type: 'background_work',
        ended: { id: 'b1', toolCallId: CALL, outcome: 'completed' },
        source: 'test',
      },
      1_000 + 30_000,
    )
    const item = state.items.find((one): one is ToolItem => one.kind === 'tool') as ToolItem
    const html = await render(item)
    expect(html).toContain('30.0 s')
    expect(html).not.toContain('4 ms')
    expect(html).toContain('data-cy="tool-took"')
  })
})

describe('327 · a sub-agent card row carries no duration — the field has no slot there', () => {
  it('⛔ the nested row is exactly `{summary, ok}`, and nothing writes past that type', () => {
    // ⚠️ Found reviewing this dispatch's own diff. `SubAgentToolRow.result` declares `{summary, ok}`
    // and `SubAgentEntry` renders no duration for any tool, but an object SPREAD writes past a
    // declared type without an excess-property error — so the first draft stored a `durationMs` on
    // the card row that nothing declared and nothing could ever read.
    const state: TranscriptState = createTranscript()
    applyEvent(
      state,
      { type: 'tool_call', id: 'disp_1', name: 'Task', summary: 'dispatch a worker' },
      1_000,
    )
    applyEvent(
      state,
      {
        type: 'sub_agent',
        agentId: 'agent_1',
        phase: 'started',
        parentToolCallId: 'disp_1',
        title: 'worker',
      },
      1_050,
    )
    applyEvent(state, { ...mcpCall(), parentToolCallId: 'disp_1' } as RuntimeEvent, 1_100)
    applyEvent(
      state,
      { ...mcpResult({ durationMs: 4 }), parentToolCallId: 'disp_1' } as RuntimeEvent,
      1_300,
    )
    const rows = JSON.stringify(state.items)
    // The positive first, so this cannot pass over a fold that placed nothing at all.
    expect(rows).toContain('mcp__brobot_327_wire__echo_probe')
    expect(rows).toContain('BROBOT_327_MCP_OK')
    // …and the negative it exists for.
    expect(rows).not.toContain('durationMs')
  })
})
