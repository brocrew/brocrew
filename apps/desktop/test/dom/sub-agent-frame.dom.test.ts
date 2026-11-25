import { afterEach, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import SessionPanel from '../../src/renderer/src/components/SessionPanel.vue'
import CardSection from '../../src/renderer/src/components/CardSection.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

it('frames the running sub-agent with the same padding as a task card and preserves navigation', async () => {
  const state = createTranscript()
  applyEvent(state, { type: 'tool_call', id: 'agent-tool', name: 'Agent', summary: 'Read the map' })
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'started',
    parentToolCallId: 'agent-tool',
    title: 'Read the map',
  })
  const navigated: string[] = []
  const m = mount(
    SessionPanel,
    {
      state,
      facets: { doing: 'idle', being: 'live' },
      who: 'BroBot',
      profile: 'brobot',
      onNavigate: (id: string) => navigated.push(id),
    },
    { width: 380, height: 700 },
  )
  const reference = mount(CardSection, { icon: '#i-bot' })
  await nextTick()
  const agents = m.q('panel-agents')
  expect(agents.textContent).toContain('Running now')
  expect(agents.textContent).toContain('Read the map')
  const actual = getComputedStyle(agents)
  const expected = getComputedStyle(reference.host.querySelector('section')!)
  expect(parseFloat(actual.paddingLeft)).toBeGreaterThan(0)
  for (const property of [
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRadius',
  ] as const)
    expect(actual[property]).toBe(expected[property])
  const row = agents.querySelector<HTMLElement>('[data-cy="panel-row"]')!
  expect(row.getAttribute('aria-disabled')).not.toBe('true')
  expect(row.getAttribute('role')).toBe('button')
  expect(row.tabIndex).toBe(0)
  row.click()
  expect(navigated).toEqual([row.dataset.item])
  row.focus()
  expect(document.activeElement).toBe(row)
  await userEvent.keyboard('{Enter}')
  expect(navigated).toEqual([row.dataset.item, row.dataset.item])
  await userEvent.keyboard(' ')
  expect(navigated).toEqual([row.dataset.item, row.dataset.item, row.dataset.item])
})
