import type { AppDatabase, AppStatement } from './connection'
import type { EventRow, PersistedEvent } from './ledger-row-types'
import type {
  HumanAnswers,
  HumanFinalContext,
  HumanTurnAnswer,
} from '../../shared/human-answer-contracts'
import { HUMAN_CONTEXT_TERM, HUMAN_FINAL_TERM } from './human-answer-index'
import { firstHumanMessageOf, humanPromptOf } from '../../shared/human-turn-answer'

export function createHumanAnswerReader(
  db: Pick<AppDatabase, 'prepare'>,
  selectLastTurn: Pick<AppStatement, 'get'>,
  activeGeneration: (sessionId: string) => number,
  toPersistedEvents: (rows: EventRow[]) => PersistedEvent[],
): {
  firstPersonOpening(sessionId: string, generation: number): string | null
  latestHumanAnswers(sessionId: string): HumanAnswers
  humanFinalsInWindow(
    sessionId: string,
    from: number,
    through: number,
  ): ReadonlyMap<number, HumanFinalContext>
} {
  type HumanPromptRow = EventRow & { turn_id: string | null }
  // The earliest possible person turn stands. An old unmarked row yields no title, even if a
  // later turn has a stamp. Imported conversations and workers can also own a root.
  const firstPersonOpening = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_human_prompt_idx
     WHERE session_id = @session AND generation = @generation
       AND (${HUMAN_CONTEXT_TERM}) AND type = 'user_turn'
       AND json_type(payload, '$.attribution') IS NULL
       AND EXISTS (SELECT 1 FROM provider_session
         WHERE id = @session AND parent_session_id IS NULL AND adopted_at IS NULL)
     ORDER BY ordinal LIMIT 1`,
  )
  const latestHumanPrompt = db.prepare(
    `SELECT ordinal, payload, created_at, turn_id FROM events INDEXED BY events_human_prompt_idx
     WHERE session_id = ? AND generation = ? AND (${HUMAN_CONTEXT_TERM}) AND type = 'user_turn'
     ORDER BY ordinal DESC LIMIT 1`,
  )
  const humanBoundary = db.prepare(
    `SELECT ordinal FROM events INDEXED BY events_human_prompt_idx
     WHERE session_id = ? AND generation = ? AND (${HUMAN_CONTEXT_TERM}) AND type = ?
       AND ordinal > ? ORDER BY ordinal LIMIT 1`,
  )
  const turnOpeningForHuman = db.prepare(
    `SELECT ordinal, payload, created_at, turn_id FROM events INDEXED BY events_turn_opening_idx
     WHERE session_id = ? AND generation = ? AND turn_id = ? AND type = 'user_turn'
     ORDER BY ordinal LIMIT 1`,
  )
  const selectedHumanFinal = db.prepare(
    `SELECT ordinal, payload, created_at FROM events INDEXED BY events_human_final_idx
     WHERE session_id = ? AND generation = ? AND turn_id = ? AND ${HUMAN_FINAL_TERM}
       AND ordinal > ? AND ordinal < ? ORDER BY ordinal DESC LIMIT 1`,
  )
  const finalRowsInHumanWindow = db.prepare(
    `SELECT ordinal, turn_id FROM events INDEXED BY events_session_ordinal_uq
     WHERE session_id = ? AND generation = ? AND ordinal >= ? AND ordinal <= ?
       AND ${HUMAN_FINAL_TERM} ORDER BY ordinal LIMIT 2500`,
  )

  function humanTurnAt(
    sessionId: string,
    generation: number,
    row: HumanPromptRow,
  ): { answer: HumanTurnAnswer; boundedAt: number } | null {
    const opening = toPersistedEvents([row])[0]
    const prompt = opening?.event.type === 'user_turn' ? humanPromptOf(opening.event) : null
    if (prompt === null || row.turn_id === null) return null
    const boundaries = ['reopened', 'status'].map(
      (type) =>
        (
          humanBoundary.get(sessionId, generation, type, row.ordinal) as
            { ordinal: number } | undefined
        )?.ordinal ?? Number.MAX_SAFE_INTEGER,
    )
    const boundedAt = Math.min(...boundaries)
    const final = selectedHumanFinal.get(
      sessionId,
      generation,
      row.turn_id,
      row.ordinal,
      boundedAt,
    ) as EventRow | undefined
    const said = final === undefined ? undefined : toPersistedEvents([final])[0]
    return {
      boundedAt,
      answer: {
        promptOrdinal: row.ordinal,
        prompt,
        final:
          said?.event.type === 'assistant_message'
            ? { text: said.event.text, ordinal: said.ordinal, at: said.at }
            : null,
      },
    }
  }

  return {
    firstPersonOpening(sessionId, generation) {
      const row = firstPersonOpening.get({ session: sessionId, generation }) as
        | EventRow
        | undefined
      if (row === undefined) return null
      const opening = toPersistedEvents([row])[0]
      return opening?.event.type === 'user_turn' ? firstHumanMessageOf(opening.event) : null
    },

    latestHumanAnswers(sessionId) {
      const generation = activeGeneration(sessionId)
      const row = latestHumanPrompt.get(sessionId, generation) as HumanPromptRow | undefined
      const human = row === undefined ? null : humanTurnAt(sessionId, generation, row)
      if (human === null) return { latest: null, active: null }
      const current = selectLastTurn.get(sessionId, generation) as { id: string } | undefined
      return {
        latest: human.answer,
        active:
          current?.id === row?.turn_id && human.boundedAt === Number.MAX_SAFE_INTEGER
            ? { promptOrdinal: human.answer.promptOrdinal, prompt: human.answer.prompt }
            : null,
      }
    },

    humanFinalsInWindow(sessionId, from, through) {
      const generation = activeGeneration(sessionId)
      const selected = new Map<number, HumanFinalContext>()
      const byTurn = new Map<string, ReturnType<typeof humanTurnAt>>()
      const rows = finalRowsInHumanWindow.all(sessionId, generation, from, through) as {
        ordinal: number
        turn_id: string | null
      }[]
      for (const row of rows) {
        if (row.turn_id === null) continue
        let human = byTurn.get(row.turn_id)
        if (human === undefined) {
          const prompt = turnOpeningForHuman.get(sessionId, generation, row.turn_id) as
            HumanPromptRow | undefined
          human = prompt === undefined ? null : humanTurnAt(sessionId, generation, prompt)
          byTurn.set(row.turn_id, human)
        }
        if (human?.answer.final?.ordinal === row.ordinal)
          selected.set(row.ordinal, {
            promptOrdinal: human.answer.promptOrdinal,
            prompt: human.answer.prompt,
          })
      }
      return selected
    },
  }
}
