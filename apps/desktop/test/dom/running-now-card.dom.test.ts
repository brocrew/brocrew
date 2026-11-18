import { afterEach, expect, it } from 'vitest'
import { nextTick, reactive } from 'vue'
import RunningNowCard from '../../src/renderer/src/components/RunningNowCard.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { mount, paneProps, record, unmountAll } from './harness'

afterEach(unmountAll)
const tick = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await nextTick()
}

it('keeps the empty card and history door visible', () => {
  const m = mount(RunningNowCard, { state: createTranscript() }, { width: 380 })
  expect(m.q('running-now-title').textContent).toBe('Running now')
  expect(m.q('panel-agents').textContent).toContain('Nothing running.')
  expect(m.q('past-runs-open').textContent).toContain('(0)')
})

it('deduplicates a native child and background identity and excludes wake-ups from the live count', () => {
  const state = createTranscript()
  applyEvent(state, { type: 'tool_call', id: 'dispatch', name: 'Agent', summary: 'Read the map' })
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'started',
    parentToolCallId: 'dispatch',
    title: 'Read the map',
  })
  state.background.running = [
    { id: 'map-reader', description: 'Read the map' },
    { id: 'command', description: 'Check paths', kind: 'shell' },
  ]
  state.schedule.jobs = [
    { id: 'wake', schedule: '* * * * *', prompt: 'Check the map', listedSince: 1 },
  ]
  const m = mount(RunningNowCard, { state }, { width: 380 })
  expect(m.q('running-now-rows').querySelectorAll('[data-cy="panel-row"]')).toHaveLength(2)
  expect(m.q('panel-agents').querySelector('.count')?.textContent).toContain('2')
  expect(m.q('schedule-open-wake').textContent).toContain('Check the map')
})

it('moves an ended child to searchable past runs without another read', async () => {
  const state = reactive(createTranscript())
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'started',
    title: 'Read the map',
  })
  const m = mount(RunningNowCard, { state }, { width: 760 })
  expect(m.q('running-now-rows').textContent).toContain('Read the map')
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'ended',
    outcome: 'completed',
  })
  await tick()
  expect(m.q('running-now-rows').textContent).toContain('Nothing running.')
  m.q('past-runs-open').click()
  await tick()
  expect(m.q('past-runs-rows').textContent).toContain('Read the map')
  expect(m.q('past-runs-rows').textContent).toContain('Done')
  const query = m.q('past-runs-search') as HTMLInputElement
  query.value = 'absent'
  query.dispatchEvent(new Event('input'))
  await tick()
  expect(m.q('past-runs-dialog').textContent).toContain('No past runs match this view.')
})

it('offers the short missing-output message without fabricating output', async () => {
  const state = createTranscript()
  state.background.running = [{ id: 'command', description: 'Check paths' }]
  const m = mount(RunningNowCard, { state }, { width: 760 })
  m.q('panel-row').click()
  await tick()
  expect(m.host.textContent).toContain('Output not available')
})

it('opens the native transcript through the existing pane reader', async () => {
  const asked: unknown[] = []
  const r = record([
    { type: 'user_turn', text: 'Read the map' },
    { type: 'sub_agent', agentId: 'map-reader', phase: 'started', title: 'Read the map' },
  ])
  const m = mount(
    ConversationPane,
    paneProps({
      record: r,
      drawerOpen: true,
      onReadChildWork: async (what: unknown) => {
        asked.push(what)
        return {
          ok: true,
          part: 'transcript',
          name: 'map-reader.jsonl',
          runId: null,
          taskId: null,
          text: '',
          truncated: false,
          bytes: 0,
          entries: [{ type: 'assistant_message', text: 'Three paths found.' }],
        }
      },
    }),
    { width: 1400, height: 900 },
  )
  m.q('panel-agents').querySelector<HTMLButtonElement>('[data-cy="panel-row"]')!.click()
  await tick()
  expect(asked.length).toBeGreaterThan(0)
  expect(
    asked.every(
      (what) =>
        JSON.stringify(what) === JSON.stringify({ part: 'transcript', agentId: 'map-reader' }),
    ),
  ).toBe(true)
  expect(m.q('child-work-viewer').textContent).toContain('Three paths found.')
})
