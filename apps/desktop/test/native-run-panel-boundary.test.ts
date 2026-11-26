import { expect, it } from 'vitest'
import type { NativeRun } from '@brobot2/runtime'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { panelRuns } from '../src/renderer/src/lib/panel-runs'

it.each([
  ['command', 'Commands'],
  ['agent', 'Agents'],
  ['job', 'Jobs & monitors'],
  ['monitor', 'Jobs & monitors'],
  ['workflow', 'Workflows'],
  ['checklist', 'Checklists'],
] as const)('groups %s only by the adapter run kind', (kind, group) => {
  const state = createTranscript()
  for (const legacy of ['local_bash', 'local_agent', 'workflow', 'monitor', undefined]) {
    applyEvent(state, {
      type: 'background_work',
      source: 'fixture',
      running: [
        { id: 'work', kind: legacy, description: 'Old title', run: { kind, input: 'The input' } },
      ],
    })
    expect(panelRuns(state).active).toMatchObject([{ group, label: 'The input' }])
  }
})

it('keeps older rows visible with their title and target in one neutral group', () => {
  const state = createTranscript()
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    running: [{ id: 'old-command', kind: 'local_bash', description: 'Old command title' }],
  })
  expect(panelRuns(state).active).toMatchObject([
    {
      group: 'Runs',
      label: 'Old command title',
      target: { kind: 'background', id: 'old-command' },
    },
  ])
})

it('keeps command input across sparse updates, joins the background identity and prefers its result', () => {
  const state = createTranscript()
  const run: NativeRun = { kind: 'command', input: 'node check.mjs\nDirectory: /sample' }
  applyEvent(state, {
    type: 'tool_call',
    id: 'call',
    name: 'Unrelated tool name',
    summary: 'Short summary',
    run,
  })
  expect(panelRuns(state).active).toHaveLength(1)
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    running: [{ id: 'process', toolCallId: 'call', kind: 'remote_agent', run }],
  })
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    progress: { id: 'process', toolCallId: 'call', run: { progress: 'Checking paths' } },
  })
  expect(panelRuns(state).active).toMatchObject([
    { group: 'Commands', detail: 'Checking paths', run },
  ])
  applyEvent(state, {
    type: 'tool_result',
    id: 'call',
    ok: true,
    summary: 'Short answer',
    run: { result: 'All paths checked' },
  })
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    running: [],
    ended: {
      id: 'process',
      toolCallId: 'call',
      outcome: 'completed',
      run: { result: 'All paths checked' },
    },
  })
  expect(panelRuns(state).active).toHaveLength(0)
  expect(panelRuns(state).past).toMatchObject([
    {
      detail: 'All paths checked',
      run: { ...run, progress: 'Checking paths', result: 'All paths checked' },
    },
  ])
  applyEvent(state, {
    type: 'background_work',
    source: 'fixture',
    progress: { id: 'process', run: { progress: 'Late progress' } },
  })
  expect(state.background.running).toEqual([])
  expect(panelRuns(state).active).toHaveLength(0)
})

it('retains child input across sparse phases independently of legacy role and id kind', () => {
  const state = createTranscript()
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'child',
    phase: 'started',
    idKind: 'thread',
    kind: 'shell',
    title: 'Old title',
    run: { kind: 'agent', input: 'Review the menu' },
  })
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'child',
    phase: 'progress',
    run: { kind: 'agent', progress: 'Comparing menus' },
  })
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'child',
    phase: 'ended',
    outcome: 'completed',
    run: { kind: 'agent', result: 'Menu chosen' },
  })
  expect(panelRuns(state).past).toMatchObject([
    {
      group: 'Agents',
      label: 'Review the menu',
      detail: 'Menu chosen',
      run: { input: 'Review the menu', progress: 'Comparing menus', result: 'Menu chosen' },
    },
  ])
})

it.each(['command', 'job', 'monitor'] as const)(
  'keeps an unfinished native %s honest after turn and session endings',
  (kind) => {
    for (const boundary of ['turn', 'session'] as const) {
      const state = createTranscript()
      applyEvent(state, {
        type: 'tool_call',
        id: 'call',
        name: 'Native work',
        summary: 'Check footpaths',
        run: { kind, input: 'Check the footpaths' },
      })
      if (boundary === 'turn') applyEvent(state, { type: 'turn', state: 'interrupted' })
      else applyEvent(state, { type: 'status', state: 'ended' })
      expect(panelRuns(state).active).toHaveLength(0)
      expect(panelRuns(state).past).toMatchObject([
        { status: 'did not finish', failed: false, run: { kind, input: 'Check the footpaths' } },
      ])
    }
  },
)

it.each([true, false])('keeps a reported tool result distinct from unfinished work (%s)', (ok) => {
  for (const kind of ['command', 'job', 'monitor'] as const) {
    const state = createTranscript()
    applyEvent(state, {
      type: 'tool_call',
      id: 'call',
      name: 'Native work',
      summary: 'Check footpaths',
      run: { kind, input: 'Check the footpaths' },
    })
    applyEvent(state, { type: 'turn', state: 'interrupted' })
    applyEvent(state, { type: 'tool_result', id: 'call', ok, summary: 'Reported result' })
    expect(panelRuns(state).past).toMatchObject([{ status: ok ? 'done' : 'failed', failed: !ok }])
  }
})
