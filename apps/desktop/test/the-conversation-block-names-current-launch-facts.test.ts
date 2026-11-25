import { describe, expect, it } from 'vitest'
import { thisConversationSpans, type InstructionContext } from '../src/main/runtime/factory-text'

const context = (over: Partial<InstructionContext> = {}): InstructionContext => ({
  profileSlug: 'fictional-agent',
  cwd: '/tmp/fictional-work',
  startedBy: null,
  root: null,
  ...over,
})
const said = (over: Partial<InstructionContext> = {}): string =>
  thisConversationSpans(context(over)).text

describe('the conversation block at this launch', () => {
  it('keeps the folder and parent facts, without build or repeated identity', () => {
    const text = said({
      startedBy: 'Ada',
      build: { id: 'fictional-build', commit: 'a'.repeat(40), dirty: false, schema: 7 },
    })
    expect(text).toContain(
      '- Your working directory is `/tmp/fictional-work`.\n- This folder persists: files you leave here are still here in later conversations.',
    )
    expect(text).not.toContain('Ask when something is destructive or ambiguous.')
    expect(text).toContain('This conversation was started by Ada.')
    expect(text).not.toContain('fictional-build')
    expect(text).not.toContain('a'.repeat(40))
    expect(text).not.toContain('database schema')
    expect(text).not.toContain('running as the profile')
  })

  it('distinguishes known own work, first launch and a helper', () => {
    expect(said({ root: 'W8' })).toContain(
      "- Your conversation's work is W8. If untitled, name it with update_work after the person's request.",
    )
    expect(said({ root: 'not-yet-numbered' })).toContain(
      "- Your conversation has its own work. Use list_tasks for its label. If untitled, name it with update_work after the person's request.",
    )
    expect(said({ root: null })).not.toContain("Your conversation's work")
    expect(said({ root: null })).not.toContain('Your conversation has its own work')
  })
})
