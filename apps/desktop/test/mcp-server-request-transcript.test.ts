import { describe, expect, it } from 'vitest'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type {
  McpServerRequestedEvent,
  McpServerRequestSettledEvent,
} from '../src/shared/runtime-ipc'

const request: McpServerRequestedEvent = {
  type: 'mcp_server_requested',
  requestId: 'fictional-request',
  name: 'fictional-notes',
  url: 'http://127.0.0.1:8765/mcp',
  reaches: 'Read fictional notes.',
  whoGetsIt: 'everyone',
  requestedBy: 'writer',
}
const endings: readonly [Omit<McpServerRequestSettledEvent, 'type' | 'requestId'>, string][] = [
  [
    { ending: 'approved', offered: ['read_notes', 'search_notes'] },
    'The person approved it. It offers: read_notes, search_notes.',
  ],
  [{ ending: 'approved', offered: [] }, 'The person approved it. It offers: no tools.'],
  [
    { ending: 'could-not-register', why: 'Fictional tool name clashes.' },
    'It could not be registered: Fictional tool name clashes.',
  ],
  [{ ending: 'refused' }, 'The person refused it.'],
  [{ ending: 'superseded' }, 'Taken down.'],
]

describe('the MCP request’s own transcript line carries its durable result', () => {
  it.each(endings)(
    'rewrites the waiting line without adding a second notice: %j',
    (ending, words) => {
      const state = createTranscript()
      applyEvent(state, request)
      expect(state.items).toMatchObject([
        {
          kind: 'notice',
          level: 'warn',
          text: 'Asked the person to register the MCP server “fictional-notes” (http://127.0.0.1:8765/mcp). Waiting on them under Waiting on you.',
        },
      ])
      applyEvent(state, {
        type: 'mcp_server_request_settled',
        requestId: request.requestId,
        ...ending,
      })
      expect(state.items).toHaveLength(1)
      expect(state.items).toMatchObject([
        {
          kind: 'notice',
          text: `Asked the person to register the MCP server “fictional-notes” (http://127.0.0.1:8765/mcp). ${words}`,
        },
      ])
      expect(state.items[0]).not.toHaveProperty('request')
    },
  )

  it.each(endings)(
    'a page without the request still says the full outcome: %j',
    (ending, words) => {
      const state = createTranscript()
      applyEvent(state, {
        type: 'mcp_server_request_settled',
        requestId: request.requestId,
        ...ending,
      })
      expect(state.items).toHaveLength(1)
      expect(state.items).toMatchObject([
        { kind: 'notice', text: `Asked the person to register an MCP server earlier. ${words}` },
      ])
    },
  )
})
