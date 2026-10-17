import { describe, expect, it } from 'vitest'
import {
  buildCommands,
  filterCommands,
  type PaletteInput,
} from '../src/renderer/src/lib/command-palette'

/**
 * # W4.10 · ⌘K reaches the Providers screen by what a person is looking for (`2caad6d2`)
 *
 * ⚑ `command-palette.test.ts` pins that `go-providers` is built, in the rail's order. What it does
 * not reach is the reason the row carries keywords at all: a person with a key to add, a limit to
 * read or a sign-in to fix types THAT, not the word *Providers*, and the row has to answer it. Each
 * search is paired with one the row must not answer, so a row that matched everything could not pass.
 */

const EMPTY: PaletteInput = { conversations: [], activeId: null, agent: null }
const rows = buildCommands(EMPTY)
const ids = (query: string): string[] => filterCommands(rows, query).map((command) => command.id)

describe('2caad6d2 · the Providers row answers a person’s words', () => {
  it('🔴 its own name ranks it first', () => {
    expect(ids('providers')[0]).toBe('go-providers')
    expect(ids('Prov')[0]).toBe('go-providers')
  })

  it('🔴 a key, a sign-in, a limit, usage, a model or a version all find it', () => {
    for (const query of [
      'api key',
      'key',
      'sign in',
      'login',
      'usage',
      'limit',
      'version',
      'models',
      'settings',
    ]) {
      expect(ids(query), query).toContain('go-providers')
    }
  })

  it('⛔ the control: words about something else do not', () => {
    for (const query of ['history', 'agents', 'xyzzy']) {
      expect(ids(query), query).not.toContain('go-providers')
    }
  })

  it('⚑ it goes to the providers place — the one the rail’s row goes to', () => {
    const row = rows.find((command) => command.id === 'go-providers')
    expect(row?.action).toEqual({ kind: 'go', place: 'providers' })
    expect(row?.group).toBe('go')
  })
})
