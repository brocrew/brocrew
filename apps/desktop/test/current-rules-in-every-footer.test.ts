import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { F093World, waitFor } from './lib/f093-host'
import { whatThisAppAdded, withoutWhatThisAppAdds } from './lib/what-this-app-adds'
import { callOn } from './helpers/call-tool'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { TURN_BLOCK_WORDS } from '../src/main/runtime/what-this-app-adds-to-a-turn'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import { CURRENT_RULES_CHARS } from '../src/shared/conversation-title'

// Every turn here runs within a minute of the rules being set.
const HEADING = TURN_BLOCK_WORDS.currentRules('agent', 'just now')
const PERSONS_HEADING = TURN_BLOCK_WORDS.currentRules('person', 'just now')
const SENTENCE = TURN_BLOCK_WORDS.keepCurrentRules

/** The current rules a footer prints, from the heading through the fixed sentence, or `''`. */
function rulesIn(words: string): string {
  const footer = whatThisAppAdded(words)
  const at = footer.indexOf('Your current rules')
  if (at < 0) return ''
  const end = footer.indexOf(SENTENCE, at)
  return end < 0 ? footer.slice(at) : footer.slice(at, end + SENTENCE.length)
}

const wordsOf = (text: string): number => text.split(/\s+/).filter(Boolean).length

/** One real-sized rule, as an agent writes them: 280 characters. */
const PACE =
  "Every turn: look at who's working and the pace (agents running, Claude and Codex points per hour). Targets: Claude 43 an hour, Codex 63. If few agents are working, or Claude is under 43, start real work now; if Codex is over 63, add no more Codex work (never stop running agents)."

const THREE = [
  'Tonight keep the pace at three pieces an hour.',
  'Give new work as soon as a piece comes back.',
  'No heavy runs on the main Mac.',
] as const

describe.each(['claude', 'codex'] as const)('current rules on %s', (provider: Provider) => {
  let world: F093World
  let host: RuntimeHost

  beforeEach(() => {
    world = new F093World()
    host = world.buildHost(true)
  })
  afterEach(async () => {
    await world.dispose()
  })

  async function turn(conversation: string, text: string): Promise<string> {
    const before = world.turnsOf(conversation).length
    const ended = world.countOf(conversation, 'turn')
    await host.send(conversation, text, world.window)
    await waitFor(() => world.turnsOf(conversation).length > before, 'the turn to be handed over')
    await waitFor(() => world.countOf(conversation, 'turn') > ended, 'the turn to end')
    return world.turnsOf(conversation).at(-1)!.sent ?? ''
  }

  const update = (conversation: string, args: Record<string, unknown>) =>
    callOn(agentToolsFor(host, conversation), 'update_work', args)

  it('prints the lines and the fixed sentence in every footer, and changes with them', async () => {
    const me = await world.open(host, provider, 'lark')
    const other = await world.open(host, provider, 'wren')
    const none = await turn(me, 'Hello.')
    expect(rulesIn(none)).toBe('')
    expect(whatThisAppAdded(none)).not.toContain('current rules')
    const topBefore = world.end.handed.map((one) => one.options.systemHint ?? null)

    expect(await update(me, { current_rules: THREE.join('\n') })).toMatchObject({
      outcome: 'ok',
    })
    // The window's right panel reads them with the conversation's tasks, with who set them.
    expect(host.readConversationTasks({ sessionId: me })).toMatchObject({
      ok: true,
      currentRules: { text: THREE.join('\n'), by: 'agent', at: expect.any(Number) },
    })
    expect(host.readConversationTasks({ sessionId: other })).not.toHaveProperty('currentRules')
    const expected = [HEADING, ...THREE.map((line) => `- ${line}`), SENTENCE].join('\n')
    const first = await turn(me, 'Next.')
    expect(rulesIn(first)).toBe(expected)
    // The words three typical lines cost each turn: heading 8, lines 29, the sentence 15.
    expect(wordsOf(rulesIn(first))).toBe(52)
    // Every turn, not once: an unchanged turn prints them again.
    expect(rulesIn(await turn(me, 'Again.'))).toBe(expected)
    // Only the conversation whose agent wrote them.
    expect(rulesIn(await turn(other, 'Hello.'))).toBe('')

    // A change replaces them whole; list marks the agent writes are not doubled.
    expect(
      await update(me, { current_rules: '- Pace is now two an hour.\n\n* Stop at 06:00Z.' }),
    ).toMatchObject({ outcome: 'ok' })
    expect(rulesIn(await turn(me, 'After the change.'))).toBe(
      [HEADING, '- Pace is now two an hour.', '- Stop at 06:00Z.', SENTENCE].join('\n'),
    )

    // Empty clears them, and the footer adds nothing again.
    expect(await update(me, { current_rules: '' })).toMatchObject({ outcome: 'ok' })
    const cleared = await turn(me, 'After clearing.')
    expect(rulesIn(cleared)).toBe('')
    expect(host.readConversationTasks({ sessionId: me })).not.toHaveProperty('currentRules')
    const withoutCurrentWork = (words: string): string[] =>
      whatThisAppAdded(words)
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith('Your current work') && line !== TURN_BLOCK_WORDS.updateGivenWork,
        )
    expect(withoutCurrentWork(cleared)).toHaveLength(withoutCurrentWork(none).length)

    // The top is what it was: the lines ride only in footers.
    expect(world.end.handed.map((one) => one.options.systemHint ?? null)).toEqual(topBefore)
    for (const launch of world.end.handed)
      expect(JSON.stringify(launch.options)).not.toContain('three pieces an hour')
    for (const handed of world.turnsOf(me))
      expect(withoutWhatThisAppAdds(handed.sent ?? '')).not.toContain('three pieces an hour')
  })

  it('keeps printing them after a compaction, and sets them beside a status line', async () => {
    const me = await world.open(host, provider, 'lark')
    await turn(me, 'Hello.')
    expect(
      await update(me, { status: 'Working through the list.', current_rules: THREE[0] }),
    ).toMatchObject({ outcome: 'ok', status: 'Working through the list.' })
    // The status line is the task page's to show; the footer says the rules.
    expect(host.readConversationTasks({ sessionId: me })).toMatchObject({
      current: { statusLine: { text: 'Working through the list.' } },
      currentRules: { text: THREE[0], by: 'agent' },
    })
    const both = await turn(me, 'Next.')
    expect(rulesIn(both)).toBe([HEADING, `- ${THREE[0]}`, SENTENCE].join('\n'))

    world.end.newest().handle.simulateCompaction(provider === 'claude' ? { after: 123 } : {})
    await waitFor(() => world.countOf(me, 'compaction') > 0, 'the compaction')
    expect(rulesIn(await turn(me, 'After compacting.'))).toBe(
      [HEADING, `- ${THREE[0]}`, SENTENCE].join('\n'),
    )
  })

  it('a person edits and deletes them, and the footer says the person set them', async () => {
    const me = await world.open(host, provider, 'lark')
    await turn(me, 'Hello.')
    await update(me, { current_rules: THREE.join('\n') })
    expect(await host.setCurrentRulesForAPerson({ conversation: me, text: THREE[1] })).toEqual({
      ok: true,
    })
    expect(host.readConversationTasks({ sessionId: me })).toMatchObject({
      currentRules: { text: THREE[1], by: 'person' },
    })
    const edited = await turn(me, 'After the edit.')
    expect(rulesIn(edited)).toBe([PERSONS_HEADING, `- ${THREE[1]}`, SENTENCE].join('\n'))
    expect(whatThisAppAdded(edited)).not.toContain('ask the person')
    // Heading 9, the line 11 with its mark, the sentence 15.
    expect(wordsOf(rulesIn(edited))).toBe(35)

    // The agent's next change makes them its own again.
    await update(me, { current_rules: THREE[2] })
    expect(rulesIn(await turn(me, 'Agent again.'))).toBe(
      [HEADING, `- ${THREE[2]}`, SENTENCE].join('\n'),
    )

    // Too long is refused and changes nothing; an unknown conversation is said so.
    expect(
      await host.setCurrentRulesForAPerson({ conversation: me, text: 'x'.repeat(321) }),
    ).toEqual({ ok: false, reason: 'Too long: 320 characters at most.' })
    expect(
      await host.setCurrentRulesForAPerson({ conversation: 'no-such-conversation', text: 'x' }),
    ).toEqual({ ok: false, reason: 'Conversation not found.' })

    // Deleting leaves the footer and the panel with nothing.
    expect(await host.setCurrentRulesForAPerson({ conversation: me, text: '' })).toEqual({
      ok: true,
    })
    expect(host.readConversationTasks({ sessionId: me })).not.toHaveProperty('currentRules')
    expect(rulesIn(await turn(me, 'After deleting.'))).toBe('')
  })

  it('keeps printing them after a reopen and after the app restarts, the footer being their only way in', async () => {
    const me = await world.open(host, provider, 'lark')
    await turn(me, 'Hello.')
    await update(me, { current_rules: THREE[1] })
    const expected = [HEADING, `- ${THREE[1]}`, SENTENCE].join('\n')
    expect(rulesIn(await turn(me, 'Before closing.'))).toBe(expected)

    await host.close(me, world.window)
    await host.resumeSession(me, world.window)
    const reopened = await turn(me, 'After a reopen.')
    expect(rulesIn(reopened)).toBe(expected)

    await host.closeAll()
    host = world.buildHost(true)
    await host.resumeSession(me, world.window)
    const restarted = await turn(me, 'After a restart.')
    expect(rulesIn(restarted)).toBe(expected)
    // Read off the ledger into the footer, and nowhere else: not a launch, and not the words in
    // front of the footer, where a first turn's lead travels.
    for (const launch of world.end.handed)
      expect(JSON.stringify(launch.options)).not.toContain(THREE[1])
    for (const sent of [reopened, restarted])
      expect(withoutWhatThisAppAdds(sent)).not.toContain(THREE[1])
  })

  it('holds them to a few lines: over the bound is refused, and older long rules are cut', async () => {
    expect(CURRENT_RULES_CHARS).toBe(320)
    const me = await world.open(host, provider, 'lark')
    await turn(me, 'Hello.')
    // A full rule at the bound is accepted and costs 76 words a turn with its heading and sentence.
    expect(PACE.length).toBeLessThanOrEqual(320)
    await update(me, { current_rules: PACE })
    expect(wordsOf(rulesIn(await turn(me, 'At the bound.')))).toBe(76)

    await update(me, { current_rules: THREE[2] })
    const refused = await update(me, { current_rules: 'x'.repeat(321) })
    expect(JSON.stringify(refused)).toContain('current_rules must be text of at most 320')
    expect(rulesIn(await turn(me, 'Next.'))).toContain(THREE[2])

    // Rules stored before the bound came down, here four pace paragraphs (1,123 characters and
    // 235 words a turn), are printed cut to the bound until they are written again.
    host.setCurrentRules([PACE, PACE, PACE, PACE].join('\n'), { ownerId: `agent:${me}` })
    const cut = rulesIn(await turn(me, 'With older rules.'))
    expect(cut).toBe(
      [HEADING, `- ${PACE}`, `- ${PACE.slice(0, 320 - PACE.length - 1).trimEnd()}…`, SENTENCE].join(
        '\n',
      ),
    )
    expect(wordsOf(cut)).toBe(85)
    // The panel keeps the whole text, so the person can see it is over and shorten it.
    expect(host.readConversationTasks({ sessionId: me })).toMatchObject({
      currentRules: { text: [PACE, PACE, PACE, PACE].join('\n') },
    })
  })
})
