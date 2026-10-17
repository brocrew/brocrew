import { afterEach, describe, expect, it } from 'vitest'
import SessionPanel from '../../src/renderer/src/components/SessionPanel.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible } from './harness'

/**
 * # ⚑ The agent card says what its agent last said
 *
 * Beside the plate, the card’s bubble shows the agent’s latest words and their age, such as
 * “All tasks are on track. I’m monitoring the team … · 2 min ago”.
 *
 * ⚑ Measured where a person sees it: the words beside the plate rather than under it, the marks a
 * model writes taken off, and a press that shows the message in the conversation. ⛔ The controls: a
 * sub-agent's words are not its agent's, and a conversation that has said nothing draws no bubble.
 */

afterEach(() => unmountAll())

const FIVE_MINUTES = 5 * 60_000

function stateOf(events: TranscriptEvent[], at: number) {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event, at)
  return state
}

const said = (text: string): TranscriptEvent =>
  ({ type: 'assistant_message', text }) as unknown as TranscriptEvent

const panel = (state: ReturnType<typeof createTranscript>, navigated: string[] = []) =>
  mount(
    SessionPanel,
    {
      state,
      mode: 'normal',
      facets: { doing: 'idle', being: 'live' },
      who: 'BroBot',
      profile: 'brobot',
      onNavigate: (itemId: string) => navigated.push(itemId),
    },
    { width: 380, height: 700 },
  )

describe('the agent card says what its agent last said', () => {
  it('🔴 the latest words, beside the plate, as a person reads them, and how long ago', () => {
    const state = stateOf(
      [
        said('An earlier answer.'),
        said('**All tasks are on track.**\n\n- I am monitoring the team\n- and will tell you'),
      ],
      Date.now() - FIVE_MINUTES,
    )
    const m = panel(state)
    const bubble = m.q('card-latest')
    expect(visible(bubble)).toBe(true)
    expect(m.q('card-latest-words').textContent).toBe(
      'All tasks are on track. I am monitoring the team and will tell you',
    )
    expect(m.q('card-latest-ago').textContent).toBe('5m ago')
    // ⚑ Beside the plate, under the name — never under the avatar.
    const plate = m.q('agent-plate').getBoundingClientRect()
    const name = m.q('session-bot-name').getBoundingClientRect()
    expect(plate.right).toBeLessThanOrEqual(bubble.getBoundingClientRect().left)
    expect(name.bottom).toBeLessThanOrEqual(bubble.getBoundingClientRect().top)
  })

  it('🔴 a press shows the message in the conversation', () => {
    const state = stateOf([said('Checking the window states now.')], Date.now())
    const navigated: string[] = []
    const m = panel(state, navigated)
    const bubble = m.q('card-latest')
    expect(bubble.tagName).toBe('BUTTON')
    bubble.click()
    expect(navigated).toEqual([bubble.dataset.item])
    expect(state.items.find((item) => item.id === navigated[0])?.kind).toBe('assistant')
  })

  it('⛔ THE CONTROL — a sub-agent’s words are not its agent’s', () => {
    const state = stateOf([said('The agent’s own words.')], Date.now())
    state.items.push({
      kind: 'assistant',
      id: 'assistant_child',
      text: 'A sub-agent speaking before its card exists.',
      streaming: false,
      parentToolCallId: 'call_task',
    })
    expect(panel(state).q('card-latest-words').textContent).toBe('The agent’s own words.')
  })

  it('⛔ THE CONTROL — a conversation that has said nothing draws no bubble', () => {
    const m = panel(stateOf([], Date.now()))
    expect(m.q('session-bot')).toBeTruthy()
    expect(m.all('card-latest')).toHaveLength(0)
  })
})
