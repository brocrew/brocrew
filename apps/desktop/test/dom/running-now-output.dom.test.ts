import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import RunningNowCard from '../../src/renderer/src/components/RunningNowCard.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { mount, paneProps, record, unmountAll } from './harness'

afterEach(unmountAll)
const tick = async (): Promise<void> => {
  await nextTick()
  await nextTick()
  await nextTick()
}

it.each(['agent', 'workflow'] as const)(
  'uses the short missing-output line for a %s reader miss',
  async (kind) => {
    const events =
      kind === 'agent'
        ? record([
            { type: 'sub_agent', agentId: 'map-reader', phase: 'started', title: 'Read the map' },
          ])
        : record([
            { type: 'tool_call', id: 'workflow-call', name: 'Workflow', summary: 'Review the map' },
            {
              type: 'workflow_run',
              taskId: 'map-review',
              toolUseId: 'workflow-call',
              name: 'Review the map',
              phases: [],
              agents: [],
              source: 'task_progress',
            },
          ])
    const m = mount(
      ConversationPane,
      paneProps({
        record: events,
        drawerOpen: true,
        onReadChildWork: async () => ({ ok: false, reason: 'gone' }),
        onReadWorkflowOutput: async () => ({ ok: false, reason: 'gone' }),
      }),
      { width: 1400, height: 900 },
    )
    m.q('panel-row').click()
    await tick()
    expect(m.host.textContent).toContain('Output not available')
    expect(m.all('child-work-viewer')).toHaveLength(0)
    expect(m.all('workflow-output-viewer')).toHaveLength(0)
  },
)

it('does not put a late missing output into the next conversation', async () => {
  const state = createTranscript()
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'started',
    title: 'Read the map',
  })
  let finish!: (opened: boolean) => void
  const conversation = ref('first')
  const Host = defineComponent({
    setup: () => () =>
      h(RunningNowCard, {
        state,
        conversation: conversation.value,
        onOpenRun: () =>
          new Promise<boolean>((resolve) => {
            finish = resolve
          }),
      }),
  })
  const m = mount(Host, {}, { width: 760, height: 900 })
  m.q('panel-row').click()
  await tick()
  conversation.value = 'second'
  await tick()
  finish(false)
  await tick()
  expect(m.host.textContent).not.toContain('Output not available')
  m.q('past-runs-open').click()
  await tick()
  expect(m.q('past-runs-dialog').textContent).toContain('Past runs')
})
