import { describe, expect, it } from 'vitest'
import {
  RAIL_SECTION_REMEMBERED,
  RAIL_SECTIONS,
  railSectionHeading,
  railSectionOf,
} from '../src/renderer/src/lib/rail-sections'
import { DEFAULT_PROFILE_ID, type AgentIdentity } from '../src/shared/runtime-ipc'

/**
 * The rail separates BroBot conversations from other agents’ conversations by the profile
 * each conversation runs as.
 *
 *  1. BroBot's profile is BroBot's in any spelling a person typed it — one fold, `agentName`'s;
 *  2. another identity is another agent's, whatever it is called;
 *  3. ⛔ no profile is NOT BroBot's — a conversation this app ran as nobody (a person's own, found
 *     in a provider's folder) or a record the host has not answered for yet.
 */

describe('which section a conversation is in', () => {
  it("BroBot's profile is BroBot's, in any case spelling", () => {
    expect(DEFAULT_PROFILE_ID).toBe('brobot')
    for (const spelled of ['brobot', 'BroBot', 'BROBOT', 'Brobot']) {
      expect(railSectionOf(spelled), spelled).toBe('brobot')
    }
  })

  it("another identity is another agent's — including one whose name only contains BroBot's", () => {
    for (const other of [
      'reviewer',
      'developer',
      'Dev',
      'default',
      'brobot-2',
      'my-brobot',
      'bro',
    ]) {
      expect(railSectionOf(other), other).toBe('agents')
    }
  })

  it("⛔ no profile is not BroBot's: it goes under the other agents", () => {
    expect(railSectionOf(null)).toBe('agents')
    expect(railSectionOf(undefined)).toBe('agents')
    // ⚑ The pair: the same call with BroBot's id is BroBot's, so `agents` above is the null's.
    expect(railSectionOf(DEFAULT_PROFILE_ID)).toBe('brobot')
  })

  it("the sections are drawn BroBot's first, and each remembers itself under its own key", () => {
    expect(RAIL_SECTIONS).toEqual(['brobot', 'agents'])
    expect(RAIL_SECTION_REMEMBERED.brobot).not.toBe(RAIL_SECTION_REMEMBERED.agents)
    for (const key of RAIL_SECTIONS) expect(RAIL_SECTION_REMEMBERED[key]).toMatch(/^brobot2\./)
  })
})

describe('what each section is called', () => {
  const named = (slug: string, displayName: string | null): AgentIdentity =>
    ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity

  it("BroBot's section is called what every row of it is: BroBot, or the name a person gave it", () => {
    expect(railSectionHeading('brobot', null)).toBe('BroBot')
    expect(railSectionHeading('brobot', [named('brobot', null)])).toBe('BroBot')
    expect(railSectionHeading('brobot', [named('brobot', 'Jarvis')])).toBe('Jarvis')
    // ⚑ Another identity's name does not reach BroBot's heading.
    expect(railSectionHeading('brobot', [named('reviewer', 'Ada')])).toBe('BroBot')
  })

  it('the other section is the other agents, whoever is in it', () => {
    expect(railSectionHeading('agents', null)).toBe('Other agents')
    expect(railSectionHeading('agents', [named('brobot', 'Jarvis')])).toBe('Other agents')
  })
})
