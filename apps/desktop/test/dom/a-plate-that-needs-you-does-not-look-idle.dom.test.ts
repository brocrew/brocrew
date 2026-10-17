import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AgentState from '../../src/renderer/src/components/AgentState.vue'
import {
  NEEDING_GLYPH,
  NEEDS_YOU,
  SIZES,
  facetsOfState,
} from '../../src/renderer/src/lib/agent-state'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * An agent that needs a person does not look like an idle one. The host's state says it needs a
 * person and not for what, so its plate wears the question mark; where the window knows the kind,
 * the plate wears that kind's glyph. The mark is drawn at every size, the dot's included, and the
 * plate's name says it in words.
 */

afterEach(() => unmountAll())

const plate = (props: object, size: keyof typeof SIZES | number = 'card'): Mounted =>
  mount(AgentState, { size, label: 'BroBot', ...props }, { width: 240, height: 240 })

const glyphOf = (el: Element | null): string | null =>
  el?.querySelector('use')?.getAttribute('href') ?? null

/** The sizes a plate is drawn at: the panel, the header, a Team card, the rail row, and the dot. */
const PLATES = ['hero', 'card', 'row', 'avatar', 'compact'] as const

describe('the host’s “needs you” is marked on the plate', () => {
  const needsYou = facetsOfState({ is: 'needs-you' })

  it('the state claims no kind it was not given, and takes one it is given', () => {
    expect(needsYou).toEqual({ doing: 'idle', waiting: 'waiting-on-a-person' })
    expect(facetsOfState({ is: 'needs-you' }, 'permission').needing).toBe('permission')
  })

  for (const size of PLATES) {
    it(`🔴 at ${size} (${SIZES[size]}px) the plate wears the question mark, and an idle one wears none`, async () => {
      const needing = plate(needsYou, size)
      await nextTick()
      const mark = needing.q('agent-needing')
      expect(visible(mark)).toBe(true)
      expect(glyphOf(mark)).toBe('#i-question')
      expect(mark.title).toBe(NEEDS_YOU)
      // Never the mark alone: the plate's name says it too, and claims no kind.
      const name = needing.q('agent-state').getAttribute('aria-label') ?? ''
      expect(name).toContain(NEEDS_YOU)
      expect(name).not.toContain('(question)')
      unmountAll()

      const idle = plate(facetsOfState({ is: 'idle' }), size)
      await nextTick()
      expect(idle.all('agent-needing')).toHaveLength(0)
      expect(idle.q('agent-state').getAttribute('aria-label')).not.toContain(NEEDS_YOU)
    })
  }

  it('🔴 below the plate’s floor the dot carries the glyph too, larger than an idle dot', async () => {
    const needing = plate(needsYou, 'dot')
    await nextTick()
    const dot = needing.q('agent-dot')
    expect(needing.q('agent-state').dataset['dot']).toBe('true')
    expect(glyphOf(dot)).toBe('#i-question')
    expect(visible(dot.querySelector('svg')!)).toBe(true)
    expect(dot.title).toBe(NEEDS_YOU)
    const needingWidth = dot.getBoundingClientRect().width
    expect(needing.q('agent-state').getAttribute('aria-label')).toContain(NEEDS_YOU)
    unmountAll()

    const idle = plate(facetsOfState({ is: 'idle' }), 'dot')
    await nextTick()
    const plain = idle.q('agent-dot')
    expect(glyphOf(plain)).toBeNull()
    expect(plain.title).toBe('')
    expect(needingWidth).toBeGreaterThan(plain.getBoundingClientRect().width)
  })
})

describe('where the kind is known, the plate wears that kind’s glyph', () => {
  for (const kind of ['permission', 'question', 'plan'] as const) {
    it(`🔴 ${kind}: on the plate and on the dot`, async () => {
      const facets = facetsOfState({ is: 'needs-you' }, kind)
      const big = plate(facets, 'card')
      await nextTick()
      expect(glyphOf(big.q('agent-needing'))).toBe(NEEDING_GLYPH[kind])
      expect(big.q('agent-state').dataset['needing']).toBe(kind)
      unmountAll()

      const small = plate(facets, 'dot')
      await nextTick()
      expect(glyphOf(small.q('agent-dot'))).toBe(NEEDING_GLYPH[kind])
    })
  }
})

describe('the other states are unchanged', () => {
  it('⛔ working, a wait on another agent and an owed answer wear no needs-you mark', async () => {
    for (const state of [
      { is: 'active' },
      { is: 'waiting-on-a-worker', on: ['Glint'] },
      { is: 'waiting-on-an-answer', from: 'Glint' },
      { is: 'owes-an-answer', to: ['Glint'] },
      { is: 'in-the-background', what: [] },
    ] as const) {
      const m = plate(facetsOfState(state as never), 'card')
      await nextTick()
      expect(m.all('agent-needing'), state.is).toHaveLength(0)
      unmountAll()
      const dot = plate(facetsOfState(state as never), 'dot')
      await nextTick()
      expect(glyphOf(dot.q('agent-dot')), state.is).toBeNull()
      unmountAll()
    }
  })
})
