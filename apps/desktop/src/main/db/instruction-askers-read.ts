import type { AppDatabase } from './connection'
import { pendingProposals } from '../../shared/pending-proposals'

type InstructionKey = { readonly type: unknown; readonly askId: string }

/** Listing state needs instruction identities, never the proposed rules or their explanation. */
export function readInstructionAskers(
  db: AppDatabase,
  owners: readonly string[],
  unread: (owner: string, ordinal: number) => void,
): readonly string[] {
  const statement = db.prepare(`SELECT session_id AS conversation, created_at AS at, ordinal,
    CASE WHEN json_valid(payload) THEN json_extract(payload, '$.type') END AS type,
    CASE WHEN json_valid(payload) THEN
      CASE WHEN json_type(payload, '$.askId') = 'text'
        THEN json_extract(payload, '$.askId') END
    END AS askId
    FROM events WHERE session_id IN (SELECT value FROM json_each(?))
      AND type IN ('instruction_proposed', 'instruction_settled')
    ORDER BY created_at, session_id, ordinal`)
  function* rows() {
    for (const row of statement.iterate(JSON.stringify(owners)) as Iterable<{
      conversation: string
      at: number
      ordinal: number
      type: unknown
      askId: unknown
    }>) {
      if (typeof row.askId !== 'string') {
        unread(row.conversation, row.ordinal)
        continue
      }
      yield {
        conversation: row.conversation,
        at: row.at,
        event: { type: row.type, askId: row.askId },
      }
    }
  }
  return pendingProposals<InstructionKey, InstructionKey, { conversation: string; at: number }>(
    rows(),
    {
      settled: (event): event is InstructionKey => event.type === 'instruction_settled',
      id: (event) => event.askId,
      pending: (_event, conversation, at) => ({ conversation, at }),
    },
  ).map((one) => one.conversation)
}
