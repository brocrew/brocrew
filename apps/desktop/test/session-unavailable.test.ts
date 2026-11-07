import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SessionUnavailable,
  UNAVAILABLE_REASONS,
  describeUnavailable,
  unavailableContextOf,
  unavailableOf,
} from '../src/main/runtime/session-unavailable'

describe('the sentence a refused open shows a person (100)', () => {
  const INTERNAL = [
    'sess_53d78fdf-3e9b-4b80-bbd0-dce624508cbd',
    'sess_',
    'webContents:',
    'owner:',
    'ownerId',
    'slot',
    'phase',
    'undefined',
    'null',
    '[object',
  ]

  it('every reason has one, and none of them leaks anything internal', () => {
    expect(UNAVAILABLE_REASONS.length).toBeGreaterThanOrEqual(9)

    for (const reason of UNAVAILABLE_REASONS) {
      const sentence = describeUnavailable(reason)
      expect(sentence, reason).not.toBe('')
      expect(sentence, reason).not.toContain(reason)
      for (const internal of INTERNAL) {
        expect(sentence, `${reason} leaked ${internal}`).not.toContain(internal)
      }
      expect(sentence, reason).toMatch(/^[A-Z].*[.!?]$/s)
    }
  })

  it('⛔ no two reasons share a sentence — the argument this file makes three times, asserted once', () => {
    const SAYS_THE_ROWS_OWN_REASON = { 'never-started': 'cannot-be-reopened' } as const
    for (const [split, from] of Object.entries(SAYS_THE_ROWS_OWN_REASON)) {
      expect(UNAVAILABLE_REASONS).toContain(split)
      expect(describeUnavailable(split as never)).toBe(describeUnavailable(from))
      const refusal = 'no turn was ever taken in this one'
      expect(describeUnavailable(split as never, { refusal })).toBe(
        describeUnavailable(from, { refusal }),
      )
      expect(describeUnavailable(split as never, { refusal })).toContain(refusal)
    }
    const sentences = UNAVAILABLE_REASONS.map((reason) => describeUnavailable(reason))
    const seen = new Map<string, string>()
    for (const [index, sentence] of sentences.entries()) {
      const reason = UNAVAILABLE_REASONS[index] as string
      if (reason in SAYS_THE_ROWS_OWN_REASON) continue
      const first = seen.get(sentence)
      expect(first, `${reason} reads exactly like ${first ?? ''}`).toBeUndefined()
      seen.set(sentence, reason)
    }
    expect(seen.size).toBe(
      UNAVAILABLE_REASONS.length - Object.keys(SAYS_THE_ROWS_OWN_REASON).length,
    )
  })

  it('says what is holding the conversation AND what to do about it', () => {
    const actionable = UNAVAILABLE_REASONS.filter(
      (reason) =>
        reason !== 'not-recorded' &&
        reason !== 'read-only' &&
        reason !== 'already-open' &&
        reason !== 'no-input-end' &&
        reason !== 'restored-elsewhere' &&
        reason !== 'started-here',
    )
    for (const reason of actionable) {
      const sentence = describeUnavailable(reason)
      expect(sentence, reason).toMatch(
        /Try again|Start it again|start it again|Open it again|opens by itself|Switch to|shutting down|did not open|answer it there|Take it over|can continue here|a message sent to it waits|A message sent to it waits|Send it a message|send it your message again|did not continue|could not continue|cannot continue yet/,
      )
    }
  })

  it('states how long the one refusal with no other way out has been waiting', () => {
    const waited = describeUnavailable('still-opening', { openingForMs: 42_000 })

    expect(waited).toContain('42s')
    expect(describeUnavailable('still-opening')).not.toContain('undefined')
    expect(describeUnavailable('still-opening')).toContain('waiting for its agent')
    expect(describeUnavailable('still-opening')).not.toContain('in time')
  })

  it('keeps the diagnostic on the error and the id out of the sentence', () => {
    const raw = 'session is already open: sess_53d78fdf (held for webContents:1)'
    const error = new SessionUnavailable('already-open-elsewhere', raw, { openingForMs: 5 })

    expect(error.message).toBe(raw)
    expect(unavailableOf(error)).toBe('already-open-elsewhere')
    expect(unavailableContextOf(error)).toEqual({ openingForMs: 5 })
    expect(describeUnavailable('already-open-elsewhere')).not.toContain('sess_')
  })

  it('leaves no untranslated throw on the path a refused reopen takes', () => {
    const source = readFileSync(
      new URL('../src/main/runtime/runtime-host.ts', import.meta.url),
      'utf8',
    )
    const notThisClass = [
      'unknown session: ${sessionId}',
      'session is still starting: ${sessionId}',
    ]
    const idBearing = [
      ...source.matchAll(
        /throw new (\w+)\(\s*\n?\s*(?:'[^']*',\s*\n?\s*)?`(session[^`]*\$\{(?:id|sessionId)\}[^`]*)`/g,
      ),
    ]
    expect(idBearing.length).toBeGreaterThanOrEqual(4)
    let checked = 0
    for (const match of idBearing) {
      if (notThisClass.some((known) => match[2]?.startsWith(known))) continue
      checked++
      expect(
        match[1],
        `an id-bearing throw is a plain ${match[1]}: ${match[2]?.slice(0, 90)}`,
      ).toBe('SessionUnavailable')
    }
    expect(checked).toBeGreaterThanOrEqual(4)
  })

  it('does not claim to recognise an ordinary failure', () => {
    expect(unavailableOf(new Error('the disk is full'))).toBeNull()
    expect(unavailableOf('a string')).toBeNull()
    expect(unavailableOf(null)).toBeNull()
    expect(unavailableContextOf(new Error('the disk is full'))).toEqual({})
  })
})
