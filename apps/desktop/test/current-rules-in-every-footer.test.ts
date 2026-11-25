import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { F093World, waitFor } from './lib/f093-host'
import { whatThisAppAdded, withoutWhatThisAppAdds } from './lib/what-this-app-adds'
import { callOn } from './helpers/call-agent-tool'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { TURN_BLOCK_WORDS } from '../src/main/runtime/what-this-app-adds-to-a-turn'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

const HEADING = TURN_BLOCK_WORDS.currentRules
const SENTENCE = TURN_BLOCK_WORDS.keepCurrentRules

/** The current rules a footer prints, from the heading through the fixed sentence, or `''`. */
function rulesIn(words: string): string {
  const footer = whatThisAppAdded(words)
  const at = footer.indexOf(HEADING)
  if (at < 0) return ''
  const end = footer.indexOf(SENTENCE, at)
  return end < 0 ? footer.slice(at) : footer.slice(at, end + SENTENCE.length)
}

const wordsOf = (text: string): number => text.split(/\s+/).filter(Boolean).length

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
    // The window's right panel reads them with the conversation's tasks, as the agent wrote them.
    expect(host.readConversationTasks({ sessionId: me })).toMatchObject({
      ok: true,
      currentRules: THREE.join('\n'),
    })
    expect(host.readConversationTasks({ sessionId: other })).not.toHaveProperty('currentRules')
    const expected = [HEADING, ...THREE.map((line) => `- ${line}`), SENTENCE].join('\n')
    const first = await turn(me, 'Next.')
    expect(rulesIn(first)).toBe(expected)
    // The words three typical lines cost each turn: heading 3, lines 29, the sentence 15.
    expect(wordsOf(rulesIn(first))).toBe(47)
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
    expect(whatThisAppAdded(cleared).split('\n').length).toBe(
      whatThisAppAdded(none).split('\n').length,
    )

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
      currentRules: THREE[0],
    })
    const both = await turn(me, 'Next.')
    expect(rulesIn(both)).toBe([HEADING, `- ${THREE[0]}`, SENTENCE].join('\n'))

    world.end.newest().handle.simulateCompaction(provider === 'claude' ? { after: 123 } : {})
    await waitFor(() => world.countOf(me, 'compaction') > 0, 'the compaction')
    expect(rulesIn(await turn(me, 'After compacting.'))).toBe(
      [HEADING, `- ${THREE[0]}`, SENTENCE].join('\n'),
    )
  })

  it('says what is wrong with text over the status line’s bound, and keeps the old lines', async () => {
    const me = await world.open(host, provider, 'lark')
    await turn(me, 'Hello.')
    await update(me, { current_rules: THREE[2] })
    const refused = await update(me, { current_rules: 'x'.repeat(1281) })
    expect(JSON.stringify(refused)).toContain('current_rules must be text of at most 1280')
    expect(rulesIn(await turn(me, 'Next.'))).toContain(THREE[2])
  })
})
