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
