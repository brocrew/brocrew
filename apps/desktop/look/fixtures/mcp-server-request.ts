import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { McpServerRequestForAPerson } from '../../src/shared/runtime-ipc'

/** A fictional local notes server, still waiting for the person to approve or refuse it. */
export function aFictionalMcpServerRequest() {
  const request: McpServerRequestForAPerson = {
    conversation: 'fictional-notes-writer',
    at: 1_790_000_000_000,
    askerCalled: 'Notes writer · Draft the weekly summary',
    requested: {
      type: 'mcp_server_requested',
      requestId: 'fictional-notes-request',
      requestedBy: 'notes-writer',
      name: 'notes-library',
      url: 'http://127.0.0.1:8775/fictional-notes/mcp',
      reaches:
        'Read the sample notes library and search its titles. It cannot edit or delete notes.',
      whoGetsIt: 'everyone',
    },
  }
  usePersonsQueue().forget()
  usePersonsQueue().supply(
    { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
    { rows: [], walk: 'every-conversation-that-routed', ledgers: 0, rowsUnread: 0 },
    {
      held: new Set(),
      answerable: new Map(),
      answeredFromHere: new Set(),
      now: request.at + 60_000,
      lastLookAnswered: { questions: true, decisions: true },
    },
    {
      travel() {},
      settle() {},
      takeOver() {},
      open() {},
      async decideMcpServerRequest() {
        return { outcome: 'refused', reason: 'Fictional server is not running.', stillOpen: true }
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    { walked: [request], lastLookAnswered: true, nameOf: () => 'Notes writer' },
  )
}
