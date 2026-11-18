import type { TranscriptEvent } from '../src/shared/conversation-events'
import { applyEvent, type TranscriptState } from '../src/renderer/src/lib/transcript'

export function startMapReader(state: TranscriptState): void {
  applyEvent(state, { type: 'tool_call', id: 'dispatch', name: 'Agent', summary: 'Read the map' })
  applyEvent(state, {
    type: 'sub_agent',
    agentId: 'map-reader',
    phase: 'started',
    parentToolCallId: 'dispatch',
    title: 'Read the map',
  })
}

export function mapWorkflowEvents(): TranscriptEvent[] {
  return [
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
  ]
}
