import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { beyondItsRailsOf, type AgentToolDefinition } from '../src/agent-tools'

/**
 * # ⚑ A verb's word, and the call's own
 *
 * Landing coverage for `beyondItsRailsOf`: what a call does that its rails do not cover is the tool's
 * own word — unless the tool reads the call's ARGUMENTS and says more. ⛔ Arguments that are not a
 * record (null, a string, an array — whatever a provider sent) are never handed to that reading.
 */

const tool = (over: Partial<AgentToolDefinition> = {}): AgentToolDefinition => ({
  name: 'message_agent',
  description: 'Say something to an agent.',
  beyondItsRails: 'nothing-its-rails-do-not-cover',
  input: { interrupt: z.boolean().optional() },
  call: async () => ({ text: 'ok' }),
  ...over,
})

describe('beyondItsRailsOf', () => {
  it('🔴 a tool with no reading of its own is its word, whatever the call says', () => {
    const plain = tool()
    expect(beyondItsRailsOf(plain, {})).toBe('nothing-its-rails-do-not-cover')
    expect(beyondItsRailsOf(plain, { interrupt: true })).toBe('nothing-its-rails-do-not-cover')
    const carded = tool({ beyondItsRails: 'it-destroys-work-in-flight' })
    expect(beyondItsRailsOf(carded, { anything: 1 })).toBe('it-destroys-work-in-flight')
  })

  it('🔴 a tool that reads the call says more for the calls that ask for more, and its word for the rest', () => {
    const reading = tool({
      beyondItsRailsWhen: (args) =>
        args['interrupt'] === true
          ? 'it-destroys-work-in-flight'
          : 'nothing-its-rails-do-not-cover',
    })
    expect(beyondItsRailsOf(reading, { interrupt: true })).toBe('it-destroys-work-in-flight')
    expect(beyondItsRailsOf(reading, { interrupt: false })).toBe('nothing-its-rails-do-not-cover')
    expect(beyondItsRailsOf(reading, { interrupt: 'true' })).toBe('nothing-its-rails-do-not-cover')
    expect(beyondItsRailsOf(reading, {})).toBe('nothing-its-rails-do-not-cover')
  })

  it('⛔ arguments that are not a record are not read: the tool’s own word stands, and the reading is never called', () => {
    let called = 0
    const reading = tool({
      beyondItsRails: 'it-starts-something-outside-this-app',
      beyondItsRailsWhen: () => {
        called += 1
        return 'nothing-its-rails-do-not-cover'
      },
    })
    for (const odd of [null, undefined, 'a string', 7, true, ['interrupt']]) {
      expect(beyondItsRailsOf(reading, odd), JSON.stringify(odd)).toBe(
        'it-starts-something-outside-this-app',
      )
    }
    expect(called).toBe(0)
    // The paired positive: a record IS read.
    expect(beyondItsRailsOf(reading, {})).toBe('nothing-its-rails-do-not-cover')
    expect(called).toBe(1)
  })

  it('⚑ the reading is handed the arguments as they came, not a copy it can corrupt', () => {
    const seen: unknown[] = []
    const reading = tool({
      beyondItsRailsWhen: (args) => {
        seen.push(args)
        return 'nothing-its-rails-do-not-cover'
      },
    })
    const args = { interrupt: true }
    beyondItsRailsOf(reading, args)
    expect(seen[0]).toBe(args)
  })
})
