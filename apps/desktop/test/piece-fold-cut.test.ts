import { expect, it } from 'vitest'
import { derivePieces } from '../src/shared/tasks'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { PieceRow } from '../src/shared/task-contracts'
import { piecesAtTheCutAndNow } from '../src/main/db/piece-fold-cut'
import { toPersistedEvents } from '../src/main/db/stored-event-codec'

it.each([false, true])(
  'preserves both whole-fold answers at every lifecycle cut (wake=%s)',
  (backgroundWakesIt) => {
    const events: TranscriptEvent[] = [
      { type: 'status', state: 'working' },
      { type: 'user_turn', text: 'Start the work.', humanInitiated: true },
      {
        type: 'work_given',
        piece: 'first',
        label: 'W1.1',
        parent: 'root',
        title: 'First',
        brief: 'First',
        givenBy: 'giver',
      },
      {
        type: 'work_given',
        piece: 'second',
        label: 'W1.2',
        parent: 'root',
        title: 'Second',
        brief: 'Second',
        givenBy: null,
        messageId: 'brief',
      },
      {
        type: 'message_queued',
        messageId: 'brief',
        kind: 'work',
        text: 'The held brief.',
        drives: 'second',
      },
      {
        type: 'background_work',
        running: [{ id: 'command', description: 'A build' }],
        source: 'test',
      },
      { type: 'scheduled_work', jobs: [{ id: 'job', schedule: '*/5 * * * *' }], source: 'test' },
      { type: 'turn', state: 'completed' },
      { type: 'status', state: 'idle' },
      {
        type: 'message_unqueued',
        messageId: 'brief',
        reason: 'sent',
        text: 'The held brief.',
      },
      { type: 'user_turn', text: 'Continue only the second.', drives: 'second' },
      { type: 'work_interrupted', by: 'a-person' },
      { type: 'turn', state: 'interrupted' },
      {
        type: 'user_turn',
        text: 'Temporary words for the first.',
        drives: 'first',
        askedForTheStop: true,
      },
      {
        type: 'work_status_set',
        piece: 'first',
        by: 'owner',
        line: 'Wait for the answer.',
        waiting: true,
        on: { kind: 'person', request: 'ask' },
      },
      { type: 'request_routed', requestId: 'ask', to: 'the-parent', parent: 'giver' },
      { type: 'request_stranded', requestId: 'ask' },
      { type: 'turn', state: 'completed' },
      { type: 'background_work', running: [], source: 'test' },
      { type: 'scheduled_work', jobs: [], source: 'test' },
      { type: 'work_rebriefed', piece: 'first', brief: 'A fresh brief.', by: 'giver' },
      { type: 'status', state: 'working' },
      {
        type: 'user_turn',
        text: 'Follow up on the first.',
        drives: 'first',
        says: 'follow-up',
        humanInitiated: true,
      },
      {
        type: 'work_replied',
        piece: 'first',
        outcome: 'done',
        summary: 'Finished.',
        resources: [],
      },
      {
        type: 'reply_undelivered',
        piece: 'first',
        parent: 'giver',
        because: 'record-write-failed',
      },
      { type: 'turn', state: 'completed' },
      { type: 'work_taken_back', piece: 'second', by: 'giver' },
      { type: 'work_retitled', piece: 'first', title: 'The finished first', by: null },
    ]
    const rows = events.map((event, ordinal) => ({
      ordinal,
      payload: JSON.stringify(event),
      created_at: ordinal + 1,
    }))
    const options = { backgroundWakesIt }
    const whole = derivePieces('owner', toPersistedEvents(rows), options)
    for (let before = 0; before <= rows.length; before++) {
      const visited: number[] = []
      let closed = false
      function* once() {
        try {
          for (const row of rows) {
            visited.push(row.ordinal)
            yield row
          }
        } finally {
          closed = true
        }
      }
      let earlier: readonly PieceRow[] | null = null
      const current = piecesAtTheCutAndNow(
        'owner',
        once(),
        before,
        options,
        () => {
          throw new Error('The fictional history must be readable')
        },
        (pieces) => {
          earlier = pieces
        },
      )
      expect(current, `current after cut ${before}`).toEqual(whole)
      expect(earlier, `exclusive cut ${before}`).toEqual(
        derivePieces('owner', toPersistedEvents(rows.slice(0, before)), options),
      )
      expect(visited).toEqual(rows.map((one) => one.ordinal))
      expect(closed).toBe(true)
    }
  },
)
