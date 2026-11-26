import { startMapReader } from './panel-run.fixture'
import { expect, it } from 'vitest'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { panelRuns } from '../src/renderer/src/lib/panel-runs'

it('keeps ordinary tools out and joins a workflow with its background identity', () => {
  const state = createTranscript()
  applyEvent(state, { type: 'tool_call', id: 'plain', name: 'Read', summary: 'Read a file' })
  applyEvent(state, {
    type: 'tool_call',
    id: 'workflow-call',
    name: 'Workflow',
    summary: 'Review the map',
  })
  const tool = state.items.find((item) => item.kind === 'tool' && item.callId === 'workflow-call')
  if (tool?.kind !== 'tool') throw new Error('workflow fixture missing')
  tool.workflow = {
    taskId: 'review',
    name: 'Review the map',
    run: { kind: 'workflow' },
    running: true,
    phases: [],
    agents: [],
  }
  state.background.running = [
    { id: 'review', toolCallId: 'workflow-call', description: 'Review the map', kind: 'workflow' },
    { id: 'monitor', description: 'Watch paths', kind: 'monitor', run: { kind: 'monitor' } },
  ]
  const runs = panelRuns(state)
  expect(runs.active).toHaveLength(2)
  expect(runs.active.map((row) => row.group)).toEqual(['Workflows', 'Jobs & monitors'])
  expect(runs.active.some((row) => row.label === 'Read a file')).toBe(false)
})

it('lists only known background endings and keeps reported failure wording', () => {
  const state = createTranscript()
  applyEvent(state, { type: 'tool_call', id: 'command', name: 'Bash', summary: 'Check paths' })
  const tool = state.items.find((item) => item.kind === 'tool')
  if (tool?.kind !== 'tool') throw new Error('command fixture missing')
  tool.background = { id: 'process', outcome: 'failed', summary: 'One path missing' }
  const runs = panelRuns(state)
  expect(runs.active).toHaveLength(0)
  expect(runs.past).toHaveLength(1)
  expect(runs.past[0]).toMatchObject({
    label: 'Check paths',
    failed: true,
    detail: 'One path missing',
  })
})

it('keeps an unreported background kind generic', () => {
  const state = createTranscript()
  state.background.running = [{ id: 'work', description: 'Check paths' }]
  expect(panelRuns(state).active[0]?.group).toBe('Runs')
  state.background.running[0]!.run = {
    kind: 'command',
    input: '[literal command](https://example.test) *keep*',
    progress: '**literal output**',
  }
  expect(panelRuns(state).active[0]).toMatchObject({
    label: '[literal command](https://example.test) *keep*',
    labelIsProse: false,
    detail: '**literal output**',
    detailIsProse: false,
  })
})

it('joins an ended native child with its anchored background ending', () => {
  const state = createTranscript()
  startMapReader(state)
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'ended',
    outcome: 'completed',
  })
  const tool = state.items.find((item) => item.kind === 'tool' && item.callId === 'dispatch')
  if (tool?.kind !== 'tool') throw new Error('dispatch fixture missing')
  tool.background = { id: 'map-reader', outcome: 'completed' }
  expect(panelRuns(state).past).toHaveLength(1)
  expect(panelRuns(state).past[0]?.key).toBe('agent:map-reader')
})
