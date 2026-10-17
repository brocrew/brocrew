import { afterEach, describe, expect, it } from 'vitest'
import { thisConversationSpans, type InstructionContext } from '../src/main/runtime/factory-text'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { readLocalTimeFrom } from '../src/shared/local-time'

const context = (over: Partial<InstructionContext> = {}): InstructionContext => ({
  profileSlug: 'fictional-agent',
  cwd: '/tmp/fictional-work',
  startedBy: null,
  depth: 0,
  capabilities: DEFAULT_CAPABILITIES,
  spawningEnabled: true,
  root: null,
  others: { shown: [], more: 0 },
  ...over,
})
const said = (over: Partial<InstructionContext> = {}): string =>
  thisConversationSpans(context(over)).text

afterEach(() => readLocalTimeFrom(() => null))

describe('the conversation block at this launch', () => {
  it('keeps the folder and parent facts, without build or repeated identity', () => {
    const text = said({
      startedBy: 'Ada',
      build: { id: 'fictional-build', commit: 'a'.repeat(40), dirty: false, schema: 7 },
    })
    expect(text).toContain(
      '- Your working directory is `/tmp/fictional-work`.\n- This folder persists: files you leave here are still here in later conversations.\n- Ask when something is destructive or ambiguous.',
    )
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

  it('shows chain limits only near the bound and only when giving work is allowed', () => {
    const capabilities = { ...DEFAULT_CAPABILITIES, canAssignWork: 'any' as const, maxDepth: 3 }
    expect(said({ capabilities, depth: 0 })).not.toContain('delegation limit')
    expect(said({ capabilities, depth: 0 })).not.toContain('level below')
    expect(said({ capabilities, depth: 2 })).toContain(
      "- You may give work one level below this conversation; the helper's own limit decides what it may give.",
    )
    for (const depth of [3, 4])
      expect(said({ capabilities, depth })).toContain(
        '- You have reached your delegation limit and cannot give work from this conversation.',
      )
    expect(
      said({ capabilities: { ...capabilities, canAssignWork: 'none' }, depth: 4 }),
    ).not.toContain('delegation limit')
  })

  it('dates activity through the same local clock as the window, including midnight', () => {
    readLocalTimeFrom(() => ({ before: 3_600_000, changes: [], rule: null }))
    const text = said({
      others: {
        shown: [
          { label: 'W1', title: 'Before midnight', lastActiveAt: Date.UTC(2026, 9, 10, 22, 59) },
          { label: 'W2', title: 'After midnight', lastActiveAt: Date.UTC(2026, 9, 10, 23, 1) },
        ],
        more: 0,
      },
    })
    expect(text).toContain('W1 · Before midnight — last active 2026-10-10 at 23:59 UTC+01:00.')
    expect(text).toContain('W2 · After midnight — last active 2026-10-11 at 00:01 UTC+01:00.')
    expect(text).not.toContain('answered')
  })

  it('never turns an absent or invalid activity into a time-only claim', () => {
    for (const lastActiveAt of [null, NaN, Infinity, 9e15]) {
      const text = said({
        others: { shown: [{ label: 'sess_unknown', title: '', lastActiveAt }], more: 0 },
      })
      expect(text).toContain('sess_unknown · Untitled conversation — last activity unknown.')
      expect(text).not.toContain('last active ')
    }
  })

  it('uses the effective zone at each activity date rather than the current offset', () => {
    readLocalTimeFrom(() => ({
      before: -5 * 3_600_000,
      changes: [{ at: Date.UTC(2026, 2, 8, 7), offset: -4 * 3_600_000 }],
      rule: null,
    }))
    const text = said({
      others: {
        shown: [
          { label: 'W1', title: 'Earlier', lastActiveAt: Date.UTC(2026, 2, 8, 6, 59) },
          { label: 'W2', title: 'Later', lastActiveAt: Date.UTC(2026, 2, 8, 7, 1) },
        ],
        more: 0,
      },
    })
    expect(text).toContain('W1 · Earlier — last active 2026-03-08 at 01:59 UTC-05:00.')
    expect(text).toContain('W2 · Later — last active 2026-03-08 at 03:01 UTC-04:00.')
  })
})
