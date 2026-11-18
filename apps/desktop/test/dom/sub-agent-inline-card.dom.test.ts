import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SubAgentEntry from '../../src/renderer/src/components/SubAgentEntry.vue'
import type { SubAgentCard } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll } from './harness'

afterEach(unmountAll)

const card: SubAgentCard = {
  agentId: 'map-reader',
  kind: 'Explore',
  title: 'Read the map',
  running: true,
  lastTool: 'Read',
  body: [{ kind: 'prose', id: 'speech', text: 'Private child output '.repeat(100) }],
}

it.each([390, 760])(
  'keeps child output out of the conversation at %i px and opens its transcript',
  async (width) => {
    const opened: unknown[][] = []
    const m = mount(
      SubAgentEntry,
      {
        card,
        onOpenChild: (...args: unknown[]) => opened.push(args),
      },
      { width },
    )
    m.host.style.display = 'block'
    const entry = m.q('subagent-entry')
    const before = entry.getBoundingClientRect()
    expect(before.height).toBe(45)
    expect(entry.textContent).toContain('Explore')
    expect(entry.textContent).toContain('Read the map')
    expect(m.q('subagent-status').textContent).toBe('running')
    m.q('subagent-head').click()
    await nextTick()
    expect(entry.getBoundingClientRect().height).toBe(before.height)
    expect(entry.textContent).not.toContain('Private child output')
    expect(entry.querySelector('[aria-expanded]')).toBeNull()
    const action = m.q('subagent-open-transcript')
    const box = action.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(0)
    expect(box.right).toBeLessThanOrEqual(before.right)
    action.click()
    expect(opened).toEqual([[{ part: 'transcript', agentId: 'map-reader' }, 'Read the map']])
  },
)

it.each(['completed', 'failed', 'interrupted', undefined] as const)(
  'reports the recorded ending %s without inline output',
  (outcome) => {
    const m = mount(SubAgentEntry, {
      card: { ...card, running: false, outcome, summary: 'Full answer' },
    })
    expect(m.q('subagent-status').textContent).toBe(outcome ?? 'ended')
    expect(m.host.textContent).not.toContain('Full answer')
    expect(m.all('subagent-last-tool')).toHaveLength(0)
  },
)

it('omits an unavailable transcript action', () => {
  const m = mount(SubAgentEntry, { card, canOpenTranscript: false })
  expect(m.all('subagent-open-transcript')).toHaveLength(0)
  expect(m.q('subagent-entry').dataset.agentId).toBe(card.agentId)
})
