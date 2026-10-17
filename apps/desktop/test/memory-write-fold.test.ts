import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import {
  applyEvent,
  createTranscript,
  type SubAgentCard,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 330 · 🔴 **The fold and the raw stream, for a memory write.**
 *
 * ⛔ The row itself is asserted in the browser (`test/dom/the-memory-write-we-render-as-a-file`),
 * because an SSR assertion that a badge is absent passes over a component that never mounted. What
 * is here is what a browser cannot see: **which item the field lands on**, and **which one it is
 * deliberately kept off**.
 */

const STORE = '/homes/default/mem-2/claude/memory'

function feed(...events: RuntimeEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

const write = (id: string, file: string, memoryPath?: string): RuntimeEvent => ({
  type: 'tool_call',
  id,
  name: 'Write',
  summary: `${STORE}/${file}`,
  ...(memoryPath === undefined ? {} : { memoryPath }),
})

const tools = (state: TranscriptState): ToolItem[] =>
  state.items.filter((item): item is ToolItem => item.kind === 'tool')

describe('330 · where the label lands', () => {
  it('🔴 a top-level memory write carries it; the same row without the field does not', () => {
    const state = feed(write('t1', 'user_name.md', 'user_name.md'), write('t2', 'plain.md'))
    expect(tools(state).map((row) => row.memoryPath)).toEqual(['user_name.md', undefined])
    // …and the whole path is untouched on both, which is the half that must not have been traded.
    expect(tools(state).map((row) => row.summary)).toEqual([
      `${STORE}/user_name.md`,
      `${STORE}/plain.md`,
    ])
  })

  it('⛔ a SUB-AGENT’s memory write does not put the field on a card row', () => {
    // ⚠️ **Deliberate, and named rather than smuggled** (327's `durationMs` is the precedent).
    // `SubAgentToolRow` declares `{kind, callId, name, summary}` and `SubAgentEntry` draws no badge
    // for any tool — a conditional spread writes past that type with no excess-property error, so
    // carrying it here would store a field nothing declares and nothing reads. ⛔ The honest
    // consequence is that a sub-agent's memory write is not labelled on its card, and the response
    // doc says so.
    const state = feed(
      { type: 'tool_call', id: 'toolu_task', name: 'Agent', summary: 'go and remember' },
      {
        type: 'sub_agent',
        agentId: 'a1',
        phase: 'started',
        parentToolCallId: 'toolu_task',
        kind: 'general-purpose',
        title: 'go and remember',
      },
      {
        type: 'tool_call',
        id: 't9',
        name: 'Write',
        summary: `${STORE}/child.md`,
        memoryPath: 'child.md',
        parentToolCallId: 'toolu_task',
      },
    )
    const cards: SubAgentCard[] = tools(state)[0]?.subAgents ?? []
    const row = cards[0]?.body.find((entry) => entry.kind === 'tool')
    // ⛔ The positive first: the child's row really did reach the card, so the absence below is an
    // absence and not a fold that dropped the whole row.
    expect(row).toMatchObject({ kind: 'tool', callId: 't9', name: 'Write' })
    expect(row && 'memoryPath' in row).toBe(false)
    // …and a top-level write in the same transcript still carries it.
    const state2 = feed(write('t1', 'user_name.md', 'user_name.md'))
    expect(tools(state2)[0]?.memoryPath).toBe('user_name.md')
  })

  it('⚑ the raw stream names the memory target, in the same words the row uses', () => {
    // `provider_commands`' rule: a line here and a row there are the same string, so a person
    // checking the raw tab against the conversation is comparing one fact rather than two spellings.
    expect(describeEvent(write('t1', 'user_name.md', 'user_name.md') as TranscriptEvent)).toBe(
      'Write · t1 · memory: user_name.md',
    )
    expect(describeEvent(write('t2', 'plain.md') as TranscriptEvent)).toBe('Write · t2')
  })
})
