import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { codexToolAnswerParts } from '../src/codex/normalize'
import { normalizeMessage, TOOL_SUMMARY_MAX } from '../src/claude/normalize'
import { claudeMcpServersFor } from '../src/claude/agent-tools'
import {
  MAX_TOOL_ANSWER_PART,
  MAX_TOOL_ANSWER_PARTS,
  MAX_TOOL_ANSWERS,
  ToolAnswers,
} from '../src/tool-answer'
import type { AgentToolset } from '../src/agent-tools'

/**
 * 🔴 **462 · the answer a person can actually read.**
 *
 * ## ⛔ The defect, measured by `457` and handed over by it
 *
 * > *"The structured half of a tool answer is durable nowhere and has no surface."* `ToolEntry.vue`
 * > draws one ≤200-character string; the raw Events tab shows **less**; a sub-agent's result summary
 * > is never drawn at all.
 *
 * And the size of it, measured through the app's own tools:
 *
 * | call | prose | structured payload |
 * |---|---|---|
 * | `list_projects`, six projects | **353 chars** | **3 691 chars** |
 * | `list_agents`, one agent | 31 chars | 169 chars |
 *
 * ⛔ **The bound stays at 200** — `457` closed that door with numbers — so what this file pins is a
 * SECOND place: a bounded hold, filled off each adapter's own stream, keyed by the call id the row
 * already carries, read on demand and never durable.
 *
 * ## ⚠️ What this file can measure, and what it cannot
 *
 * ⚑ **The Codex half is measurable end to end**, because the app's own answer is echoed back on
 * `item/completed` — `457`'s probe measured `contentItems` `null` on `item/started` and populated on
 * completion, and that is the array §2 reads.
 *
 * ⛔ **The Claude half is asserted STRUCTURALLY here, and MEASURED by a probe.** §4 pins what
 * `claudeMcpServersFor` SENDS; `675`'s `probe:claude-tool-answer` runs the bundled CLI against a
 * loopback endpoint — no login — and records what the model and the stream receive. ⚠️ This file
 * used to say every live Claude arm needs the Keychain login; the probe is the counter-example.
 */

const here = dirname(fileURLToPath(import.meta.url))

/* ----------------------------------------------------------------- §1 · the hold, and its three ceilings */

describe('§1 · the hold keeps the beginning, counts what it cut, and forgets the oldest', () => {
  it('🔴 a receipt with two parts comes back as two parts, in the order it arrived', () => {
    const held = new ToolAnswers()
    held.write('call_1', ['Six projects.', '{"count":6}'])
    expect(held.read('call_1')).toEqual({
      parts: [
        { text: 'Six projects.', dropped: 0 },
        { text: '{"count":6}', dropped: 0 },
      ],
      partsDropped: 0,
    })
    // ⛔ **The control, and it is the fact `074` is about**: an id nothing was written for is a
    // different answer from an id written with nothing.
    expect(held.read('call_2')).toBeNull()
  })

  it('⚠️ a receipt that carried NO words is held, and is not the same fact as holding nothing', () => {
    const held = new ToolAnswers()
    held.write('picture', [])
    expect(held.read('picture')).toEqual({ parts: [], partsDropped: 0 })
    expect(held.read('never')).toBeNull()
  })

  it('⛔ an empty id is refused, and it is the ONLY thing refused', () => {
    const held = new ToolAnswers()
    held.write('', ['dropped on the floor'])
    expect(held.read('')).toBeNull()
    // The control: the same call with an id lands.
    held.write('x', ['kept'])
    expect(held.read('x')?.parts[0]?.text).toBe('kept')
  })

  it('🔴 a part is cut at its END, and the cut is COUNTED rather than drawn as an ellipsis', () => {
    const held = new ToolAnswers()
    // ⛔ **`MAX_TOOL_ANSWER_PART + 1` and never a literal**, so the assertion moves with the bound
    // rather than pinning a number that has stopped being the bound.
    const opens = 'OPENS-HERE'
    const body = `${opens}${'x'.repeat(MAX_TOOL_ANSWER_PART)}`
    held.write('big', [body])
    const part = held.read('big')?.parts[0]
    expect(part?.dropped).toBe(opens.length)
    // ⚑ **The HEAD survived, which is the opposite end from a command's tail** — `448` ordered the
    // covers-sentence first precisely so it would survive a cut, and a hold that kept the tail would
    // throw away the half this whole surface exists to show.
    expect(part?.text.startsWith(opens)).toBe(true)
    expect([...(part?.text ?? '')]).toHaveLength(MAX_TOOL_ANSWER_PART)
  })

  it('⚠️ the cut is by CODE POINT, so a payload never comes back with a replacement character', () => {
    const held = new ToolAnswers()
    // One astral character per code point: a UTF-16 slice at an odd offset splits a surrogate pair.
    held.write('emoji', ['🙂'.repeat(MAX_TOOL_ANSWER_PART + 5)])
    const text = held.read('emoji')?.parts[0]?.text ?? ''
    expect(text).not.toContain('�')
    expect([...text]).toHaveLength(MAX_TOOL_ANSWER_PART)
  })

  it('⛔ parts past the ceiling are dropped and SAID, never silently trimmed', () => {
    const held = new ToolAnswers()
    const many = Array.from({ length: MAX_TOOL_ANSWER_PARTS + 3 }, (_, i) => `part ${i}`)
    held.write('many', many)
    const answer = held.read('many')
    expect(answer?.parts).toHaveLength(MAX_TOOL_ANSWER_PARTS)
    expect(answer?.partsDropped).toBe(3)
    // The control: the ordinary two-part answer says nothing was dropped.
    held.write('two', ['a', 'b'])
    expect(held.read('two')?.partsDropped).toBe(0)
  })

  it('🔴 a second receipt for one call REPLACES it — a tool answers once, and this is a correction', () => {
    const held = new ToolAnswers()
    held.write('call', ['first'])
    held.write('call', ['second'])
    expect(held.read('call')?.parts.map((p) => p.text)).toEqual(['second'])
  })

  it('⚠️ the oldest WRITE is evicted, and a re-write moves a call to the back of the queue', () => {
    const held = new ToolAnswers()
    for (let i = 0; i < MAX_TOOL_ANSWERS; i += 1) held.write(`c${i}`, [`answer ${i}`])
    expect(held.read('c0')).not.toBeNull()
    // Touching the oldest moves it; the SECOND-oldest is then the one that goes.
    held.write('c0', ['answer 0, again'])
    held.write('new', ['pushes one out'])
    expect(held.read('c0'), 'a re-written call did not move to the back').not.toBeNull()
    expect(
      held.read('c1'),
      'the second-oldest survived an eviction it should have taken',
    ).toBeNull()
  })
})

/* ------------------------------------------------------------------ §2 · Codex, off its own wire */

describe('§2 · the Codex reader takes the array the provider echoed, in order (457)', () => {
  const dynamic = (over: Record<string, unknown>): Record<string, unknown> => ({
    type: 'dynamicToolCall',
    id: 'exec-462',
    namespace: 'brobot',
    tool: 'list_projects',
    arguments: {},
    status: 'completed',
    success: true,
    durationMs: 4,
    ...over,
  })

  it('🔴 prose first and payload second, exactly as `answerCodexToolCall` sends them', () => {
    expect(
      codexToolAnswerParts(
        dynamic({
          contentItems: [
            { type: 'inputText', text: 'Six projects.' },
            { type: 'inputText', text: '{"outcome":"ok","count":6}' },
          ],
        }),
      ),
    ).toEqual(['Six projects.', '{"outcome":"ok","count":6}'])
  })

  it('⛔ `item/started` holds nothing — `contentItems` is null there, and the probe measured it', () => {
    expect(codexToolAnswerParts(dynamic({ contentItems: null, status: 'inProgress' }))).toBeNull()
    // ⚑ The positive control on the same shape: populated, and it answers an array.
    expect(
      codexToolAnswerParts(dynamic({ contentItems: [{ type: 'inputText', text: 'done' }] })),
    ).toEqual(['done'])
  })

  it('⚠️ a picture contributes no PART, and a sentence beside it still does', () => {
    expect(
      codexToolAnswerParts(
        dynamic({
          contentItems: [
            { type: 'inputImage', imageUrl: 'data:image/png;base64,AAAA' },
            { type: 'inputText', text: 'and here is what it says' },
          ],
        }),
      ),
    ).toEqual(['and here is what it says'])
    // ⛔ An answer that is ONLY a picture is an answer with no words — which the hold keeps as such,
    // and which the row already names in `NON_TEXT_ANSWER`'s own word.
    expect(
      codexToolAnswerParts(
        dynamic({ contentItems: [{ type: 'inputImage', imageUrl: 'data:image/png;base64,AAAA' }] }),
      ),
    ).toEqual([])
  })

  it('🔴 an MCP result gives its text blocks, then `structuredContent` LAST — off `327`’s real wire', () => {
    const wire = JSON.parse(
      readFileSync(join(here, 'fixtures/codex-mcp-wire-327.json'), 'utf8'),
    ) as { items: Record<string, Record<string, unknown>> }
    const parts = codexToolAnswerParts(wire.items['ok_completed'])
    expect(parts).toHaveLength(2)
    expect(parts?.[0]).toContain('BROBOT_327_MCP_OK')
    // ⚑ **The machine's copy, serialised, and it is the LAST part** — `mcpResultSummary`'s own
    // ordering, so the panel's *what it said / what it sent with it* holds on this kind too.
    expect(JSON.parse(parts?.[1] ?? 'null')).toMatchObject({ outcome: 'ok', server_pid: 97181 })
  })

  it('⚠️ a transport failure carried NO result, so nothing is held for it', () => {
    const wire = JSON.parse(
      readFileSync(join(here, 'fixtures/codex-mcp-wire-327.json'), 'utf8'),
    ) as { items: Record<string, Record<string, unknown>> }
    expect(codexToolAnswerParts(wire.items['transport_failed'])).toBeNull()
    // ⛔ The control: the TOOL failure did carry one, and its text is held.
    expect(codexToolAnswerParts(wire.items['tool_failed'])?.[0]).toContain('BROBOT_327_MCP_BOOM')
  })

  it('⛔ a command is NOT a tool answer here, and its absence is a decision with a control beside it', () => {
    // A `commandExecution` has its own surface — `300`'s tail — and a second hold of the same bytes
    // is two accounts of one thing. Every non-answer kind reads `null`.
    for (const type of [
      'commandExecution',
      'fileChange',
      'agentMessage',
      'reasoning',
      'webSearch',
    ]) {
      expect(codexToolAnswerParts({ type, id: 'x', aggregatedOutput: 'hello' }), type).toBeNull()
    }
    expect(codexToolAnswerParts(null)).toBeNull()
    expect(codexToolAnswerParts('dynamicToolCall')).toBeNull()
    // ⚑ The positive control for the whole loop: the two kinds that DO carry an answer answer.
    expect(codexToolAnswerParts(dynamic({ contentItems: [] }))).toEqual([])
  })
})

/* ----------------------------------------------------------------- §3 · Claude, off the same walk */

describe('§3 · the Claude receipt is held whole, beside the 200-character copy of it', () => {
  const receipt = (content: unknown): Record<string, unknown> => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_462', content }] },
  })

  it('🔴 the WHOLE answer is held while the row keeps the cut copy — the pair is the point', () => {
    const held = new ToolAnswers()
    const long = `${'A'.repeat(TOOL_SUMMARY_MAX)}-AND-THE-REST`
    const events = normalizeMessage(
      receipt([{ type: 'text', text: long }]) as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      held,
    )
    const row = events.find((event) => event.type === 'tool_result')
    expect(row?.type === 'tool_result' && row.summary).toHaveLength(TOOL_SUMMARY_MAX + 1)
    expect(row?.type === 'tool_result' && row.summary).not.toContain('AND-THE-REST')
    // ⚑ …and the hold has all of it, under the id the row carries.
    expect(held.read('toolu_462')?.parts[0]?.text).toBe(long)
  })

  it('⚠️ text blocks are kept APART, and since 675 the ROW is the first of them — never a weld', () => {
    const held = new ToolAnswers()
    const events = normalizeMessage(
      receipt([
        { type: 'text', text: 'the words' },
        { type: 'text', text: '{"payload":true}' },
      ]) as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      held,
    )
    expect(held.read('toolu_462')?.parts.map((p) => p.text)).toEqual([
      'the words',
      '{"payload":true}',
    ])
    // 🔴 **675 · the row a person reads is the prose ALONE.** ⛔ It joined the blocks until then —
    // `the words{"payload":true}` — which every short app-tool answer met once Claude was sent two
    // blocks (found by 675's review). Codex's `dynamicResultSummary` reads the first part the same way.
    const row = events.find((event) => event.type === 'tool_result')
    expect(row?.type === 'tool_result' && row.summary).toBe('the words')
  })

  it('⚑ …the first part that SAYS anything, and `done` when none does', () => {
    const rowOf = (content: unknown): string | false => {
      const row = normalizeMessage(receipt(content) as never).find(
        (event) => event.type === 'tool_result',
      )
      return row?.type === 'tool_result' && row.summary
    }
    expect(
      rowOf([
        { type: 'text', text: '  ' },
        { type: 'text', text: 'the words' },
      ]),
    ).toBe('the words')
    expect(rowOf([{ type: 'image', source: {} }])).toBe('done')
    expect(rowOf('File created successfully.')).toBe('File created successfully.')
  })

  it('⛔ a STRING receipt is one part, not zero — the shape a built-in tool answers in', () => {
    const held = new ToolAnswers()
    normalizeMessage(
      receipt('File created successfully.') as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      held,
    )
    expect(held.read('toolu_462')?.parts).toEqual([
      { text: 'File created successfully.', dropped: 0 },
    ])
  })

  it('⚠️ a picture contributes no part here either, and the control fires on the same receipt', () => {
    const held = new ToolAnswers()
    normalizeMessage(
      receipt([
        { type: 'image', source: { data: 'AAAA' } },
        { type: 'text', text: 'what it says' },
      ]) as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      held,
    )
    expect(held.read('toolu_462')?.parts.map((p) => p.text)).toEqual(['what it says'])
  })

  it('🔴 a CHILD’s receipt lands in the same hold, under its own id — §2.3’s answer, on this provider', () => {
    const held = new ToolAnswers()
    normalizeMessage(
      {
        type: 'user',
        parent_tool_use_id: 'toolu_parent',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_child', content: 'the child’s answer' },
          ],
        },
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      held,
    )
    expect(held.read('toolu_child')?.parts[0]?.text).toBe('the child’s answer')
    // ⛔ The control: it is held under the CHILD's id and not under the dispatch that made it.
    expect(held.read('toolu_parent')).toBeNull()
  })
})

/* ------------------------------------------------- §4 · what this repository can say about Claude */

describe('§4 · the Claude claim — what the app SENDS, and what `675` measured the CLI does with it', () => {
  // The actual registered SDK handler determines what the adapter emits.
  it('the app sends one prose item and no structuredContent', async () => {
    const toolset: AgentToolset = {
      server: 'brobot',
      tools: [
        {
          name: 'list_projects',
          description: 'what is in a project',
          beyondItsRails: 'nothing-its-rails-do-not-cover',
          input: { project: z.string().optional() },
          call: async () => ({
            text: 'Six projects, and you may send work into all of them.',
            structured: { outcome: 'ok', count: 6 },
          }),
        },
      ],
    }
    // ⚑ **Driven through the SDK's OWN registry, not through a copy of the closure.** `347`'s whole
    // argument is that `createSdkMcpServer` builds a live in-process server; asserting on a handler
    // this test reconstructed would be asserting on a thing the child never reaches.
    const servers = claudeMcpServersFor(toolset)
    const registered = (
      servers?.['brobot'] as unknown as {
        instance?: {
          _registeredTools?: Record<
            string,
            { handler: (a: unknown, e: unknown) => Promise<unknown> }
          >
        }
      }
    )?.instance?._registeredTools
    expect(registered, 'the SDK server did not register the tool this test drives').toBeDefined()
    expect(Object.keys(registered ?? {})).toEqual(['list_projects'])
    const answered = (await registered?.['list_projects']?.handler({}, {})) as {
      content: { type: string; text: string }[]
      structuredContent?: Record<string, unknown>
    }
    // Only the requested prose is model content.
    expect(answered.content).toHaveLength(1)
    expect(answered.content[0]?.text).toBe('Six projects, and you may send work into all of them.')
    // Unrelated tools carry no receipt metadata.
    expect(answered).not.toHaveProperty('_meta')
    // ⛔ And never `structuredContent`: the measured CLI would hand the model that INSTEAD.
    expect(answered).not.toHaveProperty('structuredContent')
  })
})
