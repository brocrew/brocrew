import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { F093World, waitFor } from './lib/f093-host'
import { whatThisAppAdded } from './lib/what-this-app-adds'
import { callOn } from './helpers/call-tool'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { TURN_BLOCK_WORDS } from '../src/main/runtime/what-this-app-adds-to-a-turn'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'

const CURRENT = 'Your current work: task '

describe.each(['claude', 'codex'] as const)('current work on %s', (provider: Provider) => {
  let world: F093World
  let host: RuntimeHost

  beforeEach(() => {
    world = new F093World()
    host = world.buildHost(true)
  })
  afterEach(async () => {
    await world.dispose()
  })

  /** The footer of the next turn handed over, once that turn has ended. */
  async function footerOf(conversation: string, text: string): Promise<string> {
    const handed = world.turnsOf(conversation).length
    const ended = world.countOf(conversation, 'turn')
    await host.send(conversation, text, world.window)
    await waitFor(() => world.turnsOf(conversation).length > handed, 'the handover')
    await waitFor(() => world.countOf(conversation, 'turn') > ended, 'the end of the turn')
    return whatThisAppAdded(world.turnsOf(conversation).at(-1)!.sent ?? '')
  }
  const currentLine = (footer: string): string | undefined =>
    footer.split('\n').find((line) => line.startsWith(CURRENT))

  it('names the current work once, again after the agent updates it, after a compaction and after a reopen', async () => {
    const me = await world.open(host, provider, 'lark')
    // A fixed name, so a first message does not rename the conversation between turns.
    expect(
      await host.renameConversation({ conversation: me, title: 'Shelf' }, { kind: 'person' }),
    ).toMatchObject({ ok: true })
    const label = world.store.rootOf(me)!.label
    const first = await footerOf(me, 'Hello.')
    expect(currentLine(first)).toMatch(new RegExp(`^${CURRENT}${label.replace('.', '\\.')} · `))
    expect(first).toContain(TURN_BLOCK_WORDS.updateGivenWork)
    // Unchanged, the next turn leaves the line and its nudge out.
    const quiet = await footerOf(me, 'Next.')
    expect(currentLine(quiet)).toBeUndefined()
    expect(quiet).not.toContain(TURN_BLOCK_WORDS.updateGivenWork)

    // The agent's own update of its work is the change the next footer names, with the nudge.
    const tools = agentToolsFor(host, me)
    expect(await callOn(tools, 'update_work', { title: 'Sort the fictional shelf' })).toMatchObject(
      {
        outcome: 'ok',
      },
    )
    const retitled = await footerOf(me, 'After the update.')
    expect(currentLine(retitled)).toContain(`${label} · Sort the fictional shelf, in `)
    expect(retitled).toContain(TURN_BLOCK_WORDS.updateGivenWork)
    expect(currentLine(await footerOf(me, 'Quiet again.'))).toBeUndefined()

    world.end.newest().handle.simulateCompaction(provider === 'claude' ? { after: 123 } : {})
    await waitFor(() => world.countOf(me, 'compaction') > 0, 'the compaction')
    expect(currentLine(await footerOf(me, 'After compacting.'))).toContain(
      'Sort the fictional shelf',
    )
    expect(currentLine(await footerOf(me, 'Quiet after compacting.'))).toBeUndefined()

    await host.close(me, world.window)
    await host.resumeSession(me, world.window)
    expect(currentLine(await footerOf(me, 'After a reopen.'))).toContain('Sort the fictional shelf')
  })
})
