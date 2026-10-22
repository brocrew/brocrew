import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import AgentCard from '../../src/renderer/src/components/AgentCard.vue'
import IconSprite from '../../src/renderer/src/components/IconSprite.vue'
import { createTranscript } from '../../src/renderer/src/lib/transcript'
import { sessionPanel } from '../../src/renderer/src/lib/session-panel'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)
describe('the agent card book door', () => {
  it('opens the current profile book while the launch input door still opens its own record', async () => {
    const state = createTranscript()
    const book = vi.fn()
    const inputs = vi.fn()
    const wrapper = defineComponent({
      setup: () => () =>
        h('section', { style: 'width:100%;height:100%' }, [
          h(IconSprite),
          h(AgentCard, {
            state,
            panel: sessionPanel(state),
            facets: {},
            who: 'Quill',
            profile: 'quill',
            tasks: [],
            canOpen: false,
            mode: 'normal',
            canOpenInputs: true,
            onOpenBook: book,
            onOpenInputs: inputs,
          }),
        ]),
    })
    const view = mount(wrapper, {}, { width: 400, height: 900 })
    view.q('agent-book-button').click()
    expect(book).toHaveBeenCalledExactlyOnceWith('quill')
    expect(inputs).not.toHaveBeenCalled()
    view.q('card-open-inputs').click()
    expect(inputs).toHaveBeenCalledOnce()
    expect(book).toHaveBeenCalledTimes(1)
    await document.fonts.ready
    const glyph = view.q('agent-book-button').querySelector('svg') as SVGSVGElement
    expect(glyph.getBBox().width).toBeGreaterThan(0)
    const header = view.q('session-bot').getBoundingClientRect()
    const door = view.q('agent-book-button').getBoundingClientRect()
    expect(door.left).toBeGreaterThanOrEqual(header.left)
    expect(door.right).toBeLessThanOrEqual(header.right + 1)
    await page.screenshot({
      element: view.q('session-bot'),
      path: '__screenshots__/agent-book-card-preview.png',
    })
  })
  it('does not invent a profile for a card whose identity is unknown', async () => {
    const state = createTranscript()
    const view = mount(AgentCard, {
      state,
      panel: sessionPanel(state),
      facets: {},
      who: 'Unknown',
      profile: null,
      tasks: [],
      canOpen: false,
      mode: 'normal',
    })
    expect(view.host.querySelector('[data-cy="agent-book-button"]')).toBeNull()
  })
})
