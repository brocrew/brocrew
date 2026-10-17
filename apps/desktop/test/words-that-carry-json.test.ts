import { describe, expect, it } from 'vitest'
import { jsonInWords, SHORTEST_JSON_DRAWN } from '../src/renderer/src/lib/words-with-json'

/**
 * # ⚑ Words that carry JSON — found, never guessed
 *
 * A message carrying `get_agent_status` prose followed by its JSON payload offers raw and
 * formatted views, preserving deterministic JSON content.
 *
 * ⛔ The words are a model's, so their shape is not promised; what is deterministic is the FINDING —
 * a stretch that parses as a whole object or array — and every control below is a stretch that
 * looks like JSON and does not parse, or is too small to be worth a block.
 */

const PAYLOAD = {
  outcome: 'ok',
  agent: { agent: 'sess_2066076d', name: 'BroBot', state: 'idle', pieces: [{ label: 'W1' }] },
}
const PROSE = 'BroBot (brobot) · idle · holds W1 · BroBot2: test it from inside'
/** ⚑ The screenshot's shape — the prose, then the payload, with nothing between them. */
const ADAS_NOTE = `${PROSE}${JSON.stringify(PAYLOAD)}`

describe('jsonInWords', () => {
  it('🔴 the note splits into its prose and its payload, drawn indented', () => {
    const parts = jsonInWords(ADAS_NOTE)
    expect(parts).toEqual([
      { kind: 'words', text: PROSE },
      {
        kind: 'json',
        text: JSON.stringify(PAYLOAD),
        pretty: JSON.stringify(PAYLOAD, null, 2),
      },
    ])
    // ⚑ Nothing is lost: the parts, joined, are the words exactly.
    expect(parts?.map((part) => part.text).join('')).toBe(ADAS_NOTE)
  })

  it('🔴 two values, with words between and after, each found', () => {
    const one = JSON.stringify({ first: 'a value long enough to draw' })
    const two = JSON.stringify([{ second: 1 }, { third: 2 }, { fourth: 3 }])
    const text = `Before ${one} between\n${two} after.`
    const parts = jsonInWords(text)
    expect(parts?.map((part) => part.kind)).toEqual(['words', 'json', 'words', 'json', 'words'])
    expect(parts?.map((part) => part.text).join('')).toBe(text)
  })

  it('🔴 brackets inside a string do not end the value', () => {
    const value = JSON.stringify({ note: 'a } and a ] inside', other: '{ still a string [' })
    const parts = jsonInWords(`see ${value}`)
    expect(parts?.[1]).toMatchObject({ kind: 'json', text: value })
  })

  it('⛔ words with no JSON offer no second view', () => {
    expect(jsonInWords('Done — sent it as a note, word for word.')).toBeNull()
    expect(jsonInWords('')).toBeNull()
  })

  it('⛔ a value the 1,280-character bound cut does not parse, and stays words', () => {
    const cut = `${PROSE}${JSON.stringify(PAYLOAD).slice(0, 60)}`
    expect(jsonInWords(cut)).toBeNull()
  })

  it('⛔ something that only LOOKS like JSON stays words', () => {
    expect(jsonInWords("{outcome: 'ok', agent: 'sess_2066076d', state: 'idle'}")).toBeNull()
    expect(jsonInWords('{"unbalanced": [1, 2, 3}, "and more words here"')).toBeNull()
  })

  it(`⛔ prose brackets under ${String(SHORTEST_JSON_DRAWN)} characters are not drawn as a block`, () => {
    expect(jsonInWords('See the footnote [1] and the list [1, 2, 3].')).toBeNull()
    expect(jsonInWords('An empty object {} is not worth a block.')).toBeNull()
  })

  it('⛔ a number or a string is not formatted — objects and arrays only', () => {
    expect(jsonInWords('"a string that is longer than thirty characters"')).toBeNull()
  })
})
