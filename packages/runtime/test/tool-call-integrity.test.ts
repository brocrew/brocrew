import { describe, expect, it } from 'vitest'
import { normalizeMessage } from '../src/claude/normalize'
import { normalizeNotification } from '../src/codex/normalize'
import { runtimeEventSchema, type RuntimeEvent } from '../src/events'

/**
 * ⛔ **235 §1's MEASUREMENT, kept as the guard it measured** — can a shipped adapter path emit a
 * `tool_call` that fails the wire schema?
 *
 * `230` M3 named the mechanism: the schema requires `id`, `name` and `summary`
 * (`events.ts` `toolCallSchema`), the wire boundary replaces ANY malformed event with an `unknown`,
 * and the host persists the replacement and carries on. So *"an adapter regression emitting a
 * `tool_call` with a missing `summary` becomes `unknown`"* — while the assistant message and the
 * terminal turn beside it are valid and survive. `230` H1 called the result invisible.
 *
 * ⚠️ **`230` was explicit that the malformed input was INFERRED, not observed.** This file is the
 * observation: every field of every `tool_call` either comes from a `typeof x === 'string'` guard or
 * from a summarizer whose return type is `string` and whose body has no path to anything else. The
 * answer measured over both adapters was **no** — and that answer is a fact about today's code, not
 * about the design, so it is asserted here rather than written down. A normalizer that later CAN
 * produce one turns this red on the commit that does it, which is the moment worth catching.
 *
 * ⚑ **Inputs are restricted to what `JSON.parse` can produce**, deliberately. Both adapters read
 * their input off a pipe and parse it, so a throwing getter or a revoked proxy is not a thing a
 * provider can send. (Hostile values of that kind DO make `summarizeToolInput` throw, via the
 * unguarded `input['command']` read above its `try` — measured, and out of reach from the wire. It
 * is recorded in the 235 response rather than fixed here, because a fix nothing can reach is a
 * change with no way to tell whether it worked.)
 */

/** Every value below survives a `JSON.stringify`/`JSON.parse` round trip, or arrives as absent. */
const REACHABLE_INPUTS: unknown[] = [
  undefined,
  null,
  0,
  '',
  false,
  {},
  { command: '' },
  { command: 'ls -la' },
  { command: 123 },
  { command: null },
  { command: {} },
  { file_path: '' },
  { file_path: 123 },
  { description: '' },
  { description: 123 },
  { description: 'x'.repeat(1000) },
  [],
  [1, 2, 3],
  { a: { b: { c: [1, '2', null] } } },
]

interface Sweep {
  frames: number
  toolCalls: number
  malformed: string[]
}

function inspect(sweep: Sweep, events: RuntimeEvent[], label: string): void {
  for (const event of events) {
    sweep.frames += 1
    if (event.type === 'tool_call') sweep.toolCalls += 1
    const parsed = runtimeEventSchema.safeParse(event)
    if (!parsed.success) {
      sweep.malformed.push(
        `${label} type=${String(event.type)} -> ` +
          parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}:${i.code}`).join(','),
      )
    }
  }
}

describe('235 · no shipped adapter path can emit a tool_call that fails the schema', () => {
  it('claude: every `tool_use` block, however the provider fills it in', () => {
    const sweep: Sweep = { frames: 0, toolCalls: 0, malformed: [] }
    for (const id of ['toolu_1', '', 'x'.repeat(2000), 42, null, undefined]) {
      for (const name of ['Bash', '', 42, null, undefined, { a: 1 }]) {
        for (const input of REACHABLE_INPUTS) {
          const message = {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id, name, input }] },
          } as never
          inspect(sweep, normalizeMessage(message), 'claude')
        }
      }
    }
    // ⚑ Anti-vacuity: a sweep that emitted nothing would assert nothing. Only the string-`id` rows
    // become tool calls at all — `typeof block['id'] === 'string'` is the guard — so this number
    // also says the guard is the one doing the work.
    expect(sweep.toolCalls).toBeGreaterThan(0)
    expect(sweep.malformed, sweep.malformed.slice(0, 5).join('\n')).toEqual([])
  })

  it('codex: every tool item, in every phase', () => {
    const sweep: Sweep = { frames: 0, toolCalls: 0, malformed: [] }
    const types = [
      'commandExecution',
      'fileChange',
      'mcpToolCall',
      'webSearch',
      'patchApply',
      'todoList',
      'unheardOf',
    ]
    // ⚑ The METHOD carries the phase and the ITEM carries the kind — `item/started` with an item of
    // `type: 'commandExecution'` is a `tool_call`. Getting this wrong is how the first version of
    // this test swept 5,000 frames and produced no tool calls at all; the count below is what said
    // so, which is the reason it is asserted before the malformed list.
    for (const type of types) {
      for (const method of ['item/started', 'item/completed', 'item/updated']) {
        for (const extra of REACHABLE_INPUTS) {
          for (const id of ['it_1', '', 42, null, undefined]) {
            const item: Record<string, unknown> = {
              id,
              type,
              details: extra,
              command: extra,
              name: extra,
              server: extra,
              tool: extra,
              query: extra,
              changes: extra,
              status: extra,
              aggregatedOutput: extra,
              exitCode: extra,
            }
            inspect(sweep, normalizeNotification(method, { item }), 'codex')
          }
        }
      }
    }
    expect(sweep.toolCalls).toBeGreaterThan(0)
    expect(sweep.malformed, sweep.malformed.slice(0, 5).join('\n')).toEqual([])
  })

  it('and the sweep would NOTICE one — the fixture 230 M3 describes fails the schema', () => {
    // ⛔ Without this the two tests above are a pair of green lights over an instrument that might
    // not be plugged in. This is the exact frame 230 M3 infers, run through the same inspector.
    const sweep: Sweep = { frames: 0, toolCalls: 0, malformed: [] }
    inspect(sweep, [{ type: 'tool_call', id: 'toolu_1', name: 'Bash' } as RuntimeEvent], 'fixture')
    expect(sweep.malformed).toHaveLength(1)
    expect(sweep.malformed[0]).toContain('summary')
  })
})
