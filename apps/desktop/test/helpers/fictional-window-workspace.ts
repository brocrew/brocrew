import type { AppDatabase } from '../../src/main/db/connection'
import { createSessionStore } from '../../src/main/db/session-store'

/** Fictional history with the reported event/turn/conversation proportions. */
export function seedWindowWorkspace(db: AppDatabase, directory: string) {
  const conversations = 1960
  const turnsPerConversation = 59
  const eventsPerTurn = 89
  const roots = 8
  const words =
    'This fictional conversation checks a recorded implementation and explains the next change. '.repeat(
      20,
    )
  const store = createSessionStore(db, () => 1000)
  const insert = db.prepare(
    'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
  )
  const turn = db.prepare(
    "INSERT INTO turn (id, session_id, generation, ordinal, prompt, opened_at, closed_at, end_reason) VALUES (?, ?, 0, ?, ?, ?, ?, 'completed')",
  )
  const delta = JSON.stringify({ type: 'assistant_delta', text: words })
  const seedOwner = db.transaction((owner: number) => {
    const id = `fictional-scale-${owner}`
    store.create({
      id,
      provider: 'codex',
      profileId: 'brobot',
      cwd: directory,
      approvalMode: 'ask',
      ...(owner < roots ? {} : { parentSessionId: `fictional-scale-${owner % roots}` }),
    })
    let ordinal = 0
    const row = (type: string, payload: object | string) => {
      insert.run(
        `${id}-${ordinal}`,
        id,
        ordinal,
        type,
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        1000 + ordinal,
      )
      ordinal++
    }
    for (let n = 0; n < turnsPerConversation; n++) {
      const requestId = `question-${n}`
      const messageId = `message-${n}`
      turn.run(`${id}-turn-${n}`, id, n, words, 1000 + ordinal, 1000 + ordinal + eventsPerTurn - 1)
      row('launched', { type: 'launched' })
      row('message_queued', { type: 'message_queued', messageId, text: words, kind: 'work' })
      row('message_unqueued', { type: 'message_unqueued', messageId, reason: 'sent' })
      row('user_turn', { type: 'user_turn', sent: words })
      for (let j = 0; j < 80; j++) row('assistant_delta', delta)
      row('question_asked', {
        type: 'question_asked',
        requestId,
        prompt: words,
        context: words,
        questions: [
          { id: 'choice', prompt: 'Which fictional option?', options: ['Keep', 'Change'] },
        ],
      })
      row('request_routed', { type: 'request_routed', requestId, to: 'a-person', parent: null })
      row('request_resolved', { type: 'request_resolved', id: requestId })
      row('turn', { type: 'turn', state: 'completed' })
      row('thinking', { type: 'thinking', phase: 'complete', text: 'Fictional turn complete.' })
    }
  })
  for (let owner = 0; owner < conversations; owner++) {
    seedOwner(owner)
    if (owner % 250 === 249) console.log('Fictional workspace seeded owners', owner + 1)
  }
  db.pragma('wal_checkpoint(TRUNCATE)')
  return {
    conversations,
    roots,
    turns: conversations * turnsPerConversation,
    events: conversations * turnsPerConversation * eventsPerTurn,
    eventsPerTurn,
    textCharacters: words.length,
  }
}
