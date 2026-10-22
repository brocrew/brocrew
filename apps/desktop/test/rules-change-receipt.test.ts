import { describe, expect, it } from 'vitest'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'

// Persisted events are decoded at runtime, including events an older build did not know.
const receipt = (name: string) =>
  ({
    type: 'instruction_changed',
    conversation: 'ses-wren',
    profile: 'lark',
    version: 2,
    previousVersion: 1,
    author: { profile: 'wren', name },
    replacedPersonVersion: 1,
    text: 'Unexpected rule text',
    reason: 'Unexpected reason text',
  }) as unknown as TranscriptEvent

describe('a direct rule-change receipt renders only its compact attributed metadata', () => {
  it('names the author, target and version in both event and transcript views', () => {
    const event = receipt('Wren')
    expect(describeEvent(event)).toBe('Wren changed this · lark · v2')
    const state = createTranscript()
    applyEvent(state, event)
    expect(state.items).toHaveLength(1)
    expect(state.items[0]).toMatchObject({
      kind: 'notice',
      level: 'info',
      text: 'Wren changed this · lark · v2',
    })
    expect(JSON.stringify(state.items)).not.toContain('Unexpected rule text')
    expect(JSON.stringify(state.items)).not.toContain('Unexpected reason text')
  })

  it('uses the approved unknown-agent label when the stored name is empty', () => {
    expect(describeEvent(receipt(''))).toBe('An agent changed this · lark · v2')
  })
})
