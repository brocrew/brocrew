import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { applyEvent } from '../../src/renderer/src/lib/transcript'
import { mount, paneProps, record, unmountAll } from './harness'

afterEach(unmountAll)
const tick = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await nextTick()
}

it('opens one child transcript and retains its input from the conversation, Running now and Past runs', async () => {
  const input = 'Check the map for three walkers.\nKeep the footpath open.'
  const session = ref(
    record([
      { type: 'user_turn', text: 'Check the route' },
      {
        type: 'sub_agent',
        agentId: 'map-reader',
        phase: 'started',
        title: 'Read the map',
        run: { kind: 'agent', input, progress: 'Checking the footpath' },
      },
    ]),
  )
  const read = vi.fn(async () => ({
    ok: true as const,
    part: 'transcript' as const,
    name: 'map-reader.jsonl',
    runId: null,
    taskId: null,
    text: '',
    truncated: false,
    bytes: 0,
    entries: [{ type: 'assistant_message' as const, text: 'Three paths found.' }],
  }))
  const Host = defineComponent({
    setup: () => () =>
      h(
        ConversationPane,
        paneProps({ record: session.value, drawerOpen: true, onReadChildWork: read }),
      ),
  })
  const m = mount(Host, {}, { width: 1400, height: 900 })
  let expectedState = 'Checking the footpath'
  async function checkViewer(): Promise<void> {
    await tick()
    expect(m.all('child-work-viewer')).toHaveLength(1)
    expect(m.q('child-work-viewer').textContent).toContain('Three paths found.')
    expect(m.q('run-input').textContent).toContain(input)
    expect(m.q('run-state').textContent).toContain(expectedState)
    expect(read).toHaveBeenLastCalledWith({ part: 'transcript', agentId: 'map-reader' })
    m.q('close-overlay').click()
    await tick()
    expect(m.all('child-work-viewer')).toHaveLength(0)
  }
  m.q('subagent-open-transcript').click()
  await checkViewer()
  m.q('panel-row').click()
  await checkViewer()
  applyEvent(session.value.transcript, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'ended',
    outcome: 'completed',
    run: { kind: 'agent', result: 'Map checked' },
  })
  await tick()
  expect(m.q('running-now-rows').querySelectorAll('[data-cy=panel-row]')).toHaveLength(0)
  expectedState = 'Map checked'
  m.q('past-runs-open').click()
  await tick()
  expect(m.q('past-runs-dialog').textContent).toContain('Map checked')
  m.q('panel-row').click()
  await checkViewer()
})
