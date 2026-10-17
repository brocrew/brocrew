import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { clockTime } from '../../src/shared/clock'
import AgentState from '../../src/renderer/src/components/AgentState.vue'
import SessionBot from '../../src/renderer/src/components/SessionBot.vue'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * An agent waiting on another agent keeps its robot and wears one hourglass in the plate's corner,
 * the corner a scheduled wake-up or background command uses. The plate's accessible description
 * says who it waits on, from the one state the caller holds. A wait on a person is not this: it
 * keeps the attention treatment it has, and no hourglass.
 */

afterEach(() => unmountAll())

const GLINT = 'Glint (the owner of W1.2 · Build the pages)'

function plate(props: Record<string, unknown>): Mounted {
  return mount(AgentState, { size: 77, label: 'BroBot', ...props }, { width: 200, height: 200 })
}

const mark = (m: Mounted): HTMLElement | null =>
  m.host.querySelector<HTMLElement>('.work-mark[data-mark="waiting"]')

/** The plate's accessible description, as a screen reader composes it. */
function description(m: Mounted): string | null {
  const ids = m.q('agent-state').getAttribute('aria-describedby')
  if (ids === null) return null
  return ids
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
}

describe('a wait on another agent wears an hourglass', () => {
  it('🔴 one hourglass in the corner, the robot kept, and who it waits on in the description', async () => {
    const m = plate({
      doing: 'idle',
      waiting: 'waiting-on-a-worker',
      state: { is: 'waiting-on-a-worker', on: [GLINT, 'Ada (the owner of W1.3 · Test)'] },
    })
    await nextTick()
    const hourglass = mark(m)
    expect(hourglass).not.toBeNull()
    expect(visible(hourglass!)).toBe(true)
    expect(hourglass!.querySelector('use')!.getAttribute('href')).toBe('#i-hourglass')
    expect(m.host.querySelectorAll('.work-mark')).toHaveLength(1)
    expect(visible(m.q('agent-avatar'))).toBe(true)
    expect(description(m)).toBe(`Waiting on ${GLINT} and Ada (the owner of W1.3 · Test).`)
    expect(hourglass!.title).toBe(description(m))
    // ⚑ The name still says the wait, and nothing in it says a person is needed.
    expect(m.q('agent-state').getAttribute('aria-label')).not.toContain('needs you')
  })

  it('🔴 where the host gave the wait’s start, the description says since when', async () => {
    const began = Date.now() - 12 * 60_000
    const m = plate({
      doing: 'idle',
      waiting: 'waiting-on-a-worker',
      state: { is: 'waiting-on-a-worker', on: [GLINT], since: began },
    })
    await nextTick()
    expect(description(m)).toBe(`Waiting on ${GLINT} since ${clockTime(began)}.`)
    unmountAll()

    // The control: the same wait with no start says no "since".
    const none = plate({
      doing: 'idle',
      waiting: 'waiting-on-a-worker',
      state: { is: 'waiting-on-a-worker', on: [GLINT] },
    })
    await nextTick()
    expect(description(none)).toBe(`Waiting on ${GLINT}.`)
  })

  it('⚑ an owed answer says since when it was asked, where the host gave it', async () => {
    const asked = Date.now() - 5 * 60_000
    const m = plate({
      doing: 'idle',
      owes: [GLINT],
      state: { is: 'owes-an-answer', to: [GLINT], since: asked },
    })
    await nextTick()
    expect(description(m)).toBe(`Owes an answer to ${GLINT} since ${clockTime(asked)}.`)
  })

  it('⚑ a wait on another agent’s answer is the same mark, naming who owes it', async () => {
    const m = plate({
      doing: 'idle',
      waiting: 'waiting-on-an-answer',
      state: { is: 'waiting-on-an-answer', from: GLINT },
    })
    await nextTick()
    expect(mark(m)).not.toBeNull()
    expect(description(m)).toBe(`Waiting on an answer from ${GLINT}.`)
  })

  it('⚑ without the one state the description says the wait, and no name it does not have', async () => {
    const m = plate({ doing: 'idle', waiting: 'waiting-on-a-worker' })
    await nextTick()
    expect(mark(m)).not.toBeNull()
    expect(description(m)).toBe('Waiting on another agent.')
  })

  it('⛔ the controls: a person’s wait, a scheduled wake-up and an ordinary idle wear no hourglass', async () => {
    const person = plate({ doing: 'idle', waiting: 'waiting-on-a-person' })
    const scheduled = plate({ doing: 'idle', scheduled: true })
    const idle = plate({ doing: 'idle' })
    await nextTick()
    for (const m of [person, scheduled, idle]) {
      expect(mark(m)).toBeNull()
      expect(description(m)).toBeNull()
    }
    // The scheduled plate keeps its own clock in that corner.
    expect(scheduled.host.querySelector('.work-mark use')!.getAttribute('href')).toBe('#i-clock')
    // A plate too small for a face is a dot: no corner, no description.
    const dot = plate({ doing: 'idle', waiting: 'waiting-on-a-worker', size: 12 })
    await nextTick()
    expect(dot.host.querySelector('.work-mark')).toBeNull()
    expect(description(dot)).toBeNull()
  })

  it('🔴 the agent card’s plate: the word says the wait, the plate wears the hourglass', async () => {
    const m = mount(
      SessionBot,
      {
        facets: { doing: 'idle', waiting: 'waiting-on-a-worker' },
        who: 'BroBot',
        state: { is: 'waiting-on-a-worker', on: [GLINT] },
      },
      { width: 520, height: 160 },
    )
    await nextTick()
    expect(m.q('session-bot-word').textContent).toContain('waiting on Glint')
    expect(mark(m)).not.toBeNull()
    expect(description(m)).toBe(`Waiting on ${GLINT}.`)
  })
})

describe('an answer owed to another agent wears a speech bubble in the same corner', () => {
  const ADA = 'Ada (the owner of W1.3 · Test)'
  const owesMark = (m: Mounted): HTMLElement | null =>
    m.host.querySelector<HTMLElement>('.work-mark[data-mark="owes"]')

  it('🔴 one bubble, the robot kept, and who it owes in the description', async () => {
    const m = plate({
      doing: 'idle',
      owes: [GLINT, ADA],
      state: { is: 'owes-an-answer', to: [GLINT, ADA] },
    })
    await nextTick()
    const bubble = owesMark(m)
    expect(bubble).not.toBeNull()
    expect(visible(bubble!)).toBe(true)
    expect(bubble!.querySelector('use')!.getAttribute('href')).toBe('#i-chat')
    expect(m.host.querySelectorAll('.work-mark')).toHaveLength(1)
    expect(visible(m.q('agent-avatar'))).toBe(true)
    expect(description(m)).toBe(`Owes an answer to ${GLINT} and ${ADA}.`)
    expect(bubble!.title).toBe(description(m))
    expect(m.q('agent-state').getAttribute('aria-label')).toContain('owes another agent an answer')
    expect(m.q('agent-state').getAttribute('aria-label')).not.toContain('needs you')
  })

  it('⚑ without the one state, the names come from the facet', async () => {
    const m = plate({ doing: 'idle', owes: [GLINT] })
    await nextTick()
    expect(owesMark(m)).not.toBeNull()
    expect(description(m)).toBe(`Owes an answer to ${GLINT}.`)
  })

  it('🔴 one corner, ranked by the one order: the bubble outranks a worker wait and a schedule', async () => {
    const worker = plate({ doing: 'idle', owes: [GLINT], waiting: 'waiting-on-a-worker' })
    const scheduled = plate({ doing: 'idle', owes: [GLINT], scheduled: true })
    await nextTick()
    for (const m of [worker, scheduled]) {
      expect(owesMark(m)).not.toBeNull()
      expect(m.host.querySelectorAll('.work-mark')).toHaveLength(1)
      expect(description(m)).toBe(`Owes an answer to ${GLINT}.`)
    }
  })

  it('⚑ its own unanswered question ranks first: the hourglass, with the debt still in the name', async () => {
    const m = plate({
      doing: 'idle',
      owes: [ADA],
      waiting: 'waiting-on-an-answer',
      state: { is: 'waiting-on-an-answer', from: GLINT },
    })
    await nextTick()
    expect(owesMark(m)).toBeNull()
    expect(mark(m)).not.toBeNull()
    expect(description(m)).toBe(`Waiting on an answer from ${GLINT}.`)
    expect(m.q('agent-state').getAttribute('aria-label')).toContain('owes another agent an answer')
  })

  it('⛔ the controls: an idle plate, a working one and a dot wear no bubble', async () => {
    const idle = plate({ doing: 'idle' })
    // A running turn outranks the debt in the one order.
    const working = plate({ doing: 'working', owes: [GLINT] })
    const dot = plate({ doing: 'idle', owes: [GLINT], size: 12 })
    await nextTick()
    for (const m of [idle, working, dot]) {
      expect(owesMark(m)).toBeNull()
      expect(description(m)).toBeNull()
    }
    expect(dot.host.querySelector('.work-mark')).toBeNull()
  })

  it('🔴 the agent card’s plate: the word names who it owes, the plate wears the bubble', async () => {
    const m = mount(
      SessionBot,
      {
        facets: { doing: 'idle', owes: [GLINT] },
        who: 'BroBot',
        state: { is: 'owes-an-answer', to: [GLINT] },
      },
      { width: 520, height: 160 },
    )
    await nextTick()
    expect(m.q('session-bot-word').textContent).toContain('owes an answer to Glint')
    expect(owesMark(m)).not.toBeNull()
    expect(description(m)).toBe(`Owes an answer to ${GLINT}.`)
  })
})
