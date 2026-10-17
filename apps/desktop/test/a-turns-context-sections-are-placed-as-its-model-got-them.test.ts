import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  claudePartsAsTheModelGotThem,
  readingATurn,
  type TurnReadingOptions,
} from '../src/main/archive/turn-as-sent'
import { snapshotFor } from '../src/main/provider-snapshots'
import { takesAContextMessage } from '../src/shared/provider-snapshots'
import type { AsSentPart, TurnAsSent } from '../src/shared/turn-as-sent'

/**
 * ⚑ **One turn as Claude's model got it: where its context sections went** (the follow-up to the
 * Claude snapshot's measurement).
 *
 * Claude Code's transcript keeps each section it renders in the system's role (the environment, the
 * skills, the sub-agent types, the date…) wrapped as a reminder, whichever way it went. On a model that
 * takes a context message they went in it, after the message, without their reminder lines; on one
 * that takes none (Haiku), as reminders at the head of the message. ⚑ The reader asks this build's
 * snapshot of the model the turn's answer names, with the rule the host asks it with
 * (`takesAContextMessage`), and says so; with no snapshot of that model, or no answer yet, it shows
 * the record as it is and says either way is possible.
 */

const here = dirname(fileURLToPath(import.meta.url))
const claude = readFileSync(
  join(here, 'fixtures', 'turn-as-sent', 'claude-transcript.jsonl'),
  'utf8',
)
  .split('\n')
  .filter((line) => line !== '')

/** The host's own rule, on this build's own snapshots. */
const asTheHostAsks: TurnReadingOptions = {
  hasAContextMessage: (model) => takesAContextMessage(snapshotFor('claude', model)),
}

/** The first message the fixture's person typed, as it was handed over. */
const firstHandedOver = (): string => {
  for (const line of claude) {
    const record = JSON.parse(line) as { type?: string; message?: { content?: unknown } }
    const content = record.message?.content
    if (record.type === 'user' && typeof content === 'string' && content.includes('W4157-PERSON')) {
      return content
    }
  }
  throw new Error('the fixture holds no first message')
}

/** The fixture with its answers naming `model`, or with no answer at all. */
const answeredBy = (model: string | null): string[] =>
  claude.flatMap((line) => {
    const record = JSON.parse(line) as { type?: string; message?: Record<string, unknown> }
    if (record.type !== 'assistant') return [line]
    if (model === null) return []
    return [JSON.stringify({ ...record, message: { ...record.message, model } })]
  })

function readTheFirst(all: readonly string[], options?: TurnReadingOptions): TurnAsSent {
  const reading = readingATurn(
    'claude',
    { by: 'handed-over', text: firstHandedOver(), before: [], life: null },
    options,
  )
  for (const line of all) if (reading.line(line) === 'done') break
  return reading.answer()
}

const found = (turn: TurnAsSent) => {
  if (!turn.found) throw new Error(turn.why)
  return turn
}
const sections = (parts: readonly AsSentPart[]) => parts.filter((part) => part.role === 'system')
const at = (parts: readonly AsSentPart[], author: AsSentPart['author']) =>
  parts.findIndex((part) => part.author === author)

describe('a turn’s context sections, as its model got them', () => {
  it('the snapshots say which of this build’s models take a context message', () => {
    expect(takesAContextMessage(snapshotFor('claude', 'claude-opus-5-5'))).toBe(true)
    expect(takesAContextMessage(snapshotFor('claude', 'claude-sonnet-5-5'))).toBe(true)
    expect(takesAContextMessage(snapshotFor('claude', 'claude-haiku-4-5-20251001'))).toBe(false)
    expect(takesAContextMessage(snapshotFor('claude', 'claude-mystery-9'))).toBeNull()
    expect(takesAContextMessage(undefined)).toBeNull()
  })

  it('🔴 a model that takes a context message: after the message, without their reminder lines', () => {
    const turn = found(readTheFirst(claude, asTheHostAsks))
    expect(turn.contextSections).toMatchObject({ as: 'context-message', model: 'claude-opus-5-5' })
    const message = at(turn.parts, 'the-message')
    const theSections = sections(turn.parts)
    expect(theSections.length).toBeGreaterThan(5)
    for (const section of theSections) {
      expect(turn.parts.indexOf(section)).toBeGreaterThan(message)
      expect(section.text.startsWith('<system-reminder>'), section.label).toBe(false)
    }
    expect(theSections.find((one) => one.label === 'date')?.text).toBe(
      "Today's date is 2026-10-05.",
    )
    // ⚑ The reminders in the user's role keep their lines: the model got them so.
    const reminders = turn.parts.filter(
      (part) => part.role === 'user' && part.author === 'the-provider',
    )
    expect(reminders.length).toBeGreaterThan(0)
    for (const reminder of reminders) expect(reminder.text).toMatch(/^<system-reminder>\n/)
  })

  it('🔴 a model that takes none (Haiku): at the head of the message, as reminders', () => {
    const turn = found(readTheFirst(answeredBy('claude-haiku-4-5-20251001'), asTheHostAsks))
    expect(turn.contextSections).toMatchObject({
      as: 'reminders',
      model: 'claude-haiku-4-5-20251001',
    })
    const message = at(turn.parts, 'the-message')
    for (const section of sections(turn.parts)) {
      expect(turn.parts.indexOf(section)).toBeLessThan(message)
      expect(section.text).toMatch(/^<system-reminder>\n/)
    }
    expect(turn.contextSections?.said).toContain('as reminders at the head of the message')
  })

  it('⚑ a model this build holds no snapshot of, or no answer yet: as the record keeps them, said', () => {
    const unknown = found(readTheFirst(answeredBy('claude-mystery-9'), asTheHostAsks))
    expect(unknown.contextSections).toMatchObject({ as: 'not-known', model: 'claude-mystery-9' })
    expect(unknown.contextSections?.said).toContain('holds no snapshot of claude-mystery-9')
    const asKept = found(readTheFirst(claude))
    expect(unknown.parts).toEqual(asKept.parts)
    for (const section of sections(unknown.parts)) {
      expect(unknown.parts.indexOf(section)).toBeGreaterThan(at(unknown.parts, 'the-message'))
    }
    const unanswered = found(readTheFirst(answeredBy(null), asTheHostAsks))
    expect(unanswered.contextSections).toMatchObject({ as: 'not-known', model: null })
    expect(unanswered.contextSections?.said).toContain('has not answered this message yet')
  })

  it('⚑ the record’s order is kept within each place, and a turn with no section says nothing', () => {
    const part = (
      label: string,
      role: string,
      text = `<system-reminder>\n${label}\n</system-reminder>`,
    ) => ({ author: 'the-provider', label, role, text }) as const
    const message = { author: 'the-message', label: 'user', role: 'user', text: 'hello' } as const
    const added = [
      { as: 'section', part: part('environment', 'system') },
      { as: 'reminder', part: part('memory', 'user') },
      { as: 'meta', part: part('meta', 'user', 'a line of its own') },
      { as: 'section', part: part('date', 'system') },
    ] as const
    expect(
      claudePartsAsTheModelGotThem(added, message, 'm', false).parts.map((one) => one.label),
    ).toEqual(['environment', 'memory', 'date', 'user', 'meta'])
    expect(
      claudePartsAsTheModelGotThem(added, message, 'm', true).parts.map((one) => one.text),
    ).toEqual([
      '<system-reminder>\nmemory\n</system-reminder>',
      'hello',
      'environment',
      'a line of its own',
      'date',
    ])
    const none = claudePartsAsTheModelGotThem([added[1]], message, 'm', true)
    expect(none.contextSections).toBeNull()
    expect(none.parts.map((one) => one.label)).toEqual(['memory', 'user'])
  })
})
