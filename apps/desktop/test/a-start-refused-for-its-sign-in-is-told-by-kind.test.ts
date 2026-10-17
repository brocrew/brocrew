import { describe, expect, it } from 'vitest'
import { AuthUnavailableError, NoCodexSignInOnThisComputerError } from '@brobot2/runtime'
import {
  A_REFUSED_ROW_SHOWS,
  A_START_ITS_SIGN_IN_REFUSED,
  aLaunchThatDidNotStart,
  aStartItsLoginOrSettingsRefused,
  aWakeThatDidNotHappen,
} from '../src/main/runtime/agent-tools'

/**
 * # A start refused for its sign-in is told by kind
 *
 * A helper's start can be refused for its Codex sign-in in two ways a person fixes differently: a
 * sign-in that is there and could not be used, or no Codex sign-in for a new agent to copy at its
 * first start. They are told apart by the failure's class, never by its text. The Codex card signs
 * in only BroBot's own profile, so it is named only where that is what helps.
 *
 * A refused row keeps 200 characters, so each sentence opens with what a person does and why.
 */
describe('a start refused for its sign-in is told by kind', () => {
  it('🔴 no sign-in on this computer to copy is its own reason, at a give and at a wake', () => {
    const none = new NoCodexSignInOnThisComputerError('personal Codex auth.json not found at /x')
    expect(aLaunchThatDidNotStart(none)).toEqual({
      rail: 'agent-did-not-start',
      because: 'this-computer-has-no-sign-in-to-copy',
      what: 'no-sign-in-to-copy',
      provider: 'codex',
    })
    expect(aWakeThatDidNotHappen(none)).toMatchObject({
      rail: 'agent-did-not-start',
      because: 'this-computer-has-no-sign-in-to-copy',
      what: 'no-sign-in-to-copy',
    })
    // ⚑ …and a sign-in that is there and could not be used keeps its own.
    expect(aLaunchThatDidNotStart(new AuthUnavailableError('codex', 'expired'))).toMatchObject({
      because: 'its-sign-in-is-unusable',
      what: 'sign-in',
    })
  })

  it('🔴 what a person does opens the sentence, whole inside what a refused row shows', () => {
    const arms = [
      ['sign-in', 'claude', 'claude-sign-in'],
      ['sign-in', 'codex', 'codex-sign-in'],
      ['no-sign-in-to-copy', 'codex', 'no-sign-in-to-copy'],
      ['settings', 'codex', 'codex-settings'],
    ] as const
    for (const [what, provider, kind] of arms) {
      const { lead, more } = A_START_ITS_SIGN_IN_REFUSED[kind]
      expect(lead.length, kind).toBeLessThanOrEqual(A_REFUSED_ROW_SHOWS)
      expect(lead.startsWith('Ask a person to '), kind).toBe(true)
      for (const door of ['give', 'wake'] as const) {
        const said = aStartItsLoginOrSettingsRefused(what, provider, door)
        // ⚑ As the tool's row keeps it: the word, then 200 characters in all.
        const row = `refused (agent-did-not-start): ${said}`.slice(0, 200)
        expect(row, `${kind} at a ${door}`).toContain(lead)
        // …then that nothing was done, the rest for whoever opens it, and what to do meanwhile.
        const nothing =
          door === 'give'
            ? 'Nothing was given, and giving it again will not help until then.'
            : 'Nothing was sent, and sending again will not help until then.'
        expect(said.startsWith(`${lead} ${nothing}`)).toBe(true)
        if (more !== '') expect(said).toContain(` ${more} `)
        expect(said.endsWith('or do it yourself.')).toBe(true)
        expect(said).not.toContain('  ')
      }
    }
  })

  it('🔴 a Codex sentence names only a remedy that reaches that agent', () => {
    // A sign-in that is there and could not be used: the card signs in only BroBot's own, so it is
    // not where that agent is signed in again.
    const used = A_START_ITS_SIGN_IN_REFUSED['codex-sign-in']
    expect(used.lead).toContain('save an API key on the Codex card in Providers')
    expect(used.lead).toContain('sign that agent in from one of its conversations')
    expect(used.more).toContain('the Codex card signs in only BroBot’s own')
    expect(`${used.lead} ${used.more}`).not.toMatch(
      /sign (that|this) agent in[^.:]* on the Codex card/,
    )
    // None to copy, neither this computer's nor BroBot's own: signing in on the card makes BroBot's
    // own, which a new agent then starts on.
    const none = A_START_ITS_SIGN_IN_REFUSED['no-sign-in-to-copy']
    expect(none.lead).toContain(
      'sign in on the Codex card in Providers, or to save an API key there',
    )
    expect(none.more).toContain('where it keeps none, of BroBot’s own')
    for (const kind of ['codex-sign-in', 'no-sign-in-to-copy'] as const) {
      expect(A_START_ITS_SIGN_IN_REFUSED[kind].more).toContain('BroCrew does not need restarting')
    }
    // ⚑ Claude's sign-in is this computer's: its remedy is the same as before.
    expect(A_START_ITS_SIGN_IN_REFUSED['claude-sign-in'].lead).toContain(
      'sign in to Claude Code on this computer again, or to save an API key on the Claude card in Providers',
    )
  })
})
